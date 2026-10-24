// Game audio: a recorded idle loop and a firing-order engine voice (cylinder pulses, exhaust formant,
// load-dependent filtering, gear-shift cut with clunk, lift pops, blow-off for turbo cars, rev-limiter
// cut), an EV inverter whine for electric cars, tyres, road, wind, nitro, boost pad, impacts, pickups,
// UI and a pooled set of traffic pass-by voices (distance, filtering, pan and doppler).
// Everything meets on one master bus: DC block -> high shelf -> compressor -> soft clip -> low-pass ->
// fade gain. UI clicks bypass the master so the paused menu stays audible. Impacts and pickups feed a
// short generated reverb that is only connected while it is in use.
//
// The AudioContext is created and resumed only after a user gesture. Missing or failed asset loads fall
// back to procedural synthesis; nothing here throws into the game loop. Sources: dist/CREDITS.md, "Audio".

export const GEAR_TOPS = [11, 21, 32, 44, 57, 72]; // upper speed (m/s) of gears 1..6; boost reaches ~69 m/s
export const ENGINE_IDLE_RPM = 0.18;
export const REVERSE_RPM_CAP = 0.45;
export const LIMITER_RPM = 0.95;
export const CYLINDERS = 6; // default; a four-stroke fires cylinders * rpm / 120 times per second
export const IDLE_RPM = 900;
export const REDLINE_RPM = 6800;
export const HIGH_LOOP_RATIO = 2.6; // rpm ratio (to the car's own idle) at which the high loop plays at its recorded speed
export const LOOP_MAX_RATE = 3; // loop A is never pitch-shifted beyond this
export const LOOP_A_GAIN = 0.25; // loop A level at idle
export const HIGH_LOOP_CEILING = 0.1; // loop B never exceeds this; loop A stays dominant
export const HIGH_LOOP_MAX_RATE = 1.3; // loop B is capped here so the heavy rumble is not pitched into a chipmunk
export const TRAFFIC_VOICES = 4;
export const TRAFFIC_RANGE = 90; // metres: cars beyond this are silent
export const SPEED_OF_SOUND = 343;
const SHIFT_FLOOR_RPM = 0.5; // rpm after an upshift, normalised 0..1
const SHIFT_DIP_SECONDS = 0.075; // firing-rate dip during a gear change
const SHIFT_DIP_DEPTH = 0.12;
const UPDATE_INTERVAL = 1 / 30; // AudioParam writes are throttled to 30 Hz
const MASTER_LEVEL = 0.6;
const PAUSE_SUSPEND_MS = 330; // about 5 time constants of the 60 ms master fade: suspend only once it is silent
const LOOP_FADE_SECONDS = 0.2; // equal-power crossfade length for generated noise loops
const BOOST_PAD_COOLDOWN = 0.4;
const POP_COOLDOWN = 0.15;
const VOICE_DROP_MS = 500; // an idle traffic voice is disconnected this long after its gain has faded to zero
const REVERB_IDLE_MS = 3000; // the reverb send is disconnected this long after the last impact or pickup
const GESTURE_EVENTS = ['pointerdown', 'keydown', 'touchend'];

export const AUDIO_ASSETS = {
  engine: 'engine-idle.wav', // CC-BY 3.0 recording (car idle), see CREDITS
  engineHigh: 'engine-high.wav', // CC-BY 3.0 recording (heavy engine, faster copy), see CREDITS
  impactHeavy: 'impact-heavy.mp3',
  impactLight: 'impact-light.mp3',
  pickupChime: 'pickup-chime.mp3',
  pickupClink: 'pickup-clink.mp3',
  uiClick: 'ui-click.mp3',
  boostWhoosh: 'boost-whoosh.wav', // CC0, SuperTuxKart SFX pack (Scribe)
  boostShort: 'boost-short.wav', // CC0, EZduzziteh
};

// Per-vehicle engine profiles (arcade approximations). Electric cars get an inverter whine instead of combustion events.
const ICE_PROFILES = {
  concept: { cylinders: 8, redline: 6500, turbo: false },
  bmw: { cylinders: 6, redline: 7000, turbo: false },
  nsx: { cylinders: 6, redline: 8000, turbo: false },
  porsche: { cylinders: 6, redline: 6500, turbo: true },
};
const DEFAULT_PROFILE = Object.freeze({ ev: false, turbo: false, cylinders: CYLINDERS, redline: REDLINE_RPM });

export function clamp(value, lo = 0, hi = 1) {
  const v = Number.isFinite(value) ? value : lo;
  return v < lo ? lo : v > hi ? hi : v;
}

// Frame-rate independent exponential approach toward target.
export function approach(current, target, rate, dt) {
  if (!(dt > 0)) return current;
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

// Seamless loop from a buffer: the last fadeLen samples are equal-power crossfaded into the first
// fadeLen samples, and the result is shorter by fadeLen. Output[L-1] and output[0] are adjacent
// samples of the source, so the wrap has no step; the head/tail blend hides the splice.
export function crossfadeLoop(src, fadeLen) {
  const n = src.length;
  const x = Math.max(0, Math.min(Math.floor(fadeLen), n >> 1));
  const len = n - x;
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    if (i < x) {
      const a = (i / x) * (Math.PI / 2);
      out[i] = src[i] * Math.sin(a) + src[len + i] * Math.cos(a);
    } else {
      out[i] = src[i];
    }
  }
  return out;
}

// 1-based gear index for a speed in m/s.
export function gearFromSpeed(speed, tops = GEAR_TOPS) {
  const s = clamp(speed, 0, Infinity);
  for (let i = 0; i < tops.length; i++) if (s < tops[i]) return i + 1;
  return tops.length;
}

// Normalised engine speed 0..1: sweeps up through each gear and drops back on upshift.
export function rpmFromSpeed(speed, tops = GEAR_TOPS) {
  const s = clamp(speed, 0, Infinity);
  const gear = gearFromSpeed(s, tops);
  const lo = gear === 1 ? 0 : tops[gear - 2];
  const hi = tops[Math.min(gear, tops.length) - 1];
  const t = clamp((s - lo) / Math.max(1e-6, hi - lo), 0, 1);
  const floor = gear === 1 ? ENGINE_IDLE_RPM : SHIFT_FLOOR_RPM;
  return floor + (1 - floor) * t;
}

// Reversing (forward speed clearly negative) never sits at forward gear rpm: it whines at a low, capped rpm.
export function engineSpeedRpm(speed, forwardSpeed = 0, tops = GEAR_TOPS) {
  if (Number.isFinite(forwardSpeed) && forwardSpeed < -0.5) {
    return clamp(0.2 + clamp(speed, 0, Infinity) * 0.03, ENGINE_IDLE_RPM, REVERSE_RPM_CAP);
  }
  return rpmFromSpeed(speed, tops);
}

// Normalised rpm (0..1) to real engine rpm: idle at ENGINE_IDLE_RPM, redline at 1.
export function engineRpm(norm, redline = REDLINE_RPM) {
  const t = clamp((clamp(norm, 0, 1.2) - ENGINE_IDLE_RPM) / (1 - ENGINE_IDLE_RPM), 0, 1.2);
  return IDLE_RPM + (redline - IDLE_RPM) * t;
}

// Firing fundamental in Hz for a four-stroke: cylinders * rpm / 120.
export function firingFrequency(norm, cylinders = CYLINDERS, redline = REDLINE_RPM) {
  return (cylinders * engineRpm(norm, redline)) / 120;
}

// Engine character for a car definition from vehicles.js (category ELECTRIC = inverter, no combustion events).
export function engineProfileFor(definition) {
  if (!definition) return DEFAULT_PROFILE;
  if (definition.category === 'ELECTRIC') return { ev: true, turbo: false, cylinders: 0, redline: REDLINE_RPM };
  const p = ICE_PROFILES[definition.profile] || ICE_PROFILES[definition.id];
  if (!p) return DEFAULT_PROFILE;
  return { ev: false, turbo: p.turbo, cylinders: p.cylinders, redline: p.redline };
}

// Rev-limiter fuel cut: depth of the 10 Hz gain chop (0 = none). Applied on its own gain node.
export function limiterDepth(rpm) {
  return rpm >= LIMITER_RPM ? 0.7 : 0;
}

// Playback rate of loop A from the rpm ratio (1 = this car's own idle), clamped to the pitch-shift limit.
export function ratioToRate(ratio) {
  return clamp(Number.isFinite(ratio) ? ratio : 1, 0.7, LOOP_MAX_RATE);
}

// Playback rate of loop A, from the rpm relative to this car's own idle (1 = its idle). Per car: an 8-cylinder
// car at idle plays the loop at rate 1, the same as a 6-cylinder car.
export function engineRate(rpm, profile = DEFAULT_PROFILE) {
  const p = profile.ev ? DEFAULT_PROFILE : profile;
  return ratioToRate(engineRpm(rpm, p.redline) / IDLE_RPM);
}

// Playback rate of loop B from the rpm ratio: 1 at HIGH_LOOP_RATIO times the car's idle, capped.
export function highLoopRate(ratio) {
  return clamp((Number.isFinite(ratio) ? ratio : 1) / HIGH_LOOP_RATIO, 0.7, HIGH_LOOP_MAX_RATE);
}

// Equal-power blend position for loop A and the synth: 0 at idle, 1 at 5x idle (A is out, synth carries it).
export function loopBlend(ratio) {
  return clamp(((Number.isFinite(ratio) ? ratio : 1) - 1) / 4, 0, 1);
}

// Loop A level: 0.25 at idle, fading with cos(blend) so it stays dominant of the recorded layers through the
// mid range. It is driven by the smoothed rpm ratio (level only; pitch uses the faster ratio).
export function loopALevel(ratio) {
  return LOOP_A_GAIN * Math.cos((loopBlend(ratio) * Math.PI) / 2);
}

// Loop B (heavy rumble) level: silent at idle, a smoothstep rise from 1.6x to 2.4x idle, then held at the ceiling.
// Kept below loop A, so it sits underneath as low-mid body. The smooth curve has no step.
export function highLoopLevel(ratio) {
  const x = clamp(((Number.isFinite(ratio) ? ratio : 1) - 1.6) / 0.8, 0, 1);
  return HIGH_LOOP_CEILING * x * x * (3 - 2 * x);
}

export function engineGain(rpm, throttle = 0) {
  return clamp(0.05 + 0.14 * clamp(rpm, 0, 1) + 0.07 * clamp(throttle, 0, 1), 0, 0.24);
}

// Tyres are silent at standstill: full level from 4 m/s upward.
export function tyreStandstillGate(speed) {
  return clamp(clamp(speed, 0, Infinity) / 4, 0, 1);
}

// 0..1 tyre squeal from lateral slide (m/s) and handbrake, gated off at low speed.
export function screechIntensity(speed, lateralSpeed, handbrake = false) {
  const speedFactor = clamp((clamp(speed, 0, Infinity) - 6) / 8, 0, 1);
  const slide = clamp((Math.abs(Number.isFinite(lateralSpeed) ? lateralSpeed : 0) - 1.8) / 5, 0, 1);
  const brake = handbrake ? 0.65 : 0;
  return clamp(Math.max(slide, brake) * speedFactor, 0, 1);
}

// Nitro whoosh low-pass cutoff (Hz) rising over ~1.6 s of continuous boost.
export function nitroCutoff(boostTime) {
  return 700 * 2 ** (clamp(boostTime / 1.6, 0, 1) * 3.2);
}

export function windGain(speed) {
  return 0.02 + 0.1 * clamp(clamp(speed, 0, Infinity) / 60, 0, 1) ** 1.4;
}

export function impactStrength(speed) {
  return clamp((clamp(speed, 0, Infinity) - 2) / 18, 0, 1);
}

// Harder hits play slightly lower.
export function impactRate(speed) {
  return clamp(1.1 - clamp(speed, 0, Infinity) * 0.015, 0.55, 1.1);
}

// Soft clip over the input domain [-domain, domain]: unity slope below the knee, then a smooth ceiling.
// The shaper domain covers +/-2 (about +6 dBFS), so overs are rounded off instead of hard clamped.
export function softClipCurve(samples = 2048, knee = 0.6, ceiling = 0.75, domain = 2) {
  const curve = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const x = ((2 * i) / (samples - 1) - 1) * domain;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + (ceiling - knee) * Math.tanh((a - knee) / (ceiling - knee));
    curve[i] = x < 0 ? -y : y;
  }
  return curve;
}

// Gentle exhaust grit: tanh saturation normalised so small signals pass near unity.
export function gritCurve(samples = 1024, drive = 2.5) {
  const curve = new Float32Array(samples);
  const norm = Math.tanh(drive);
  for (let i = 0; i < samples; i++) {
    const x = (2 * i) / (samples - 1) - 1;
    curve[i] = Math.tanh(drive * x) / norm;
  }
  return curve;
}

// Generated reverb impulse response: a darkened noise tail with a 60 dB decay over `seconds`, a few
// early reflections, and unit energy. Deterministic (seeded), so it is testable.
export function makeImpulseResponse(sampleRate, seconds = 0.5, seed = 12345) {
  const n = Math.max(1, Math.floor(sampleRate * seconds));
  const out = new Float32Array(n);
  let state = seed >>> 0;
  let lp = 0;
  for (let i = 0; i < n; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const white = state / 2147483648 - 1;
    lp += 0.55 * (white - lp);
    out[i] = lp * Math.exp((-6.9 * i) / (sampleRate * seconds));
  }
  for (const [ms, g] of [[11, 0.5], [19, 0.4], [29, 0.3], [41, 0.22]]) {
    const idx = Math.round((ms / 1000) * sampleRate);
    if (idx < n) out[idx] += g;
  }
  let energy = 0;
  for (let i = 0; i < n; i++) energy += out[i] * out[i];
  const k = energy > 0 ? 1 / Math.sqrt(energy) : 0;
  for (let i = 0; i < n; i++) out[i] *= k;
  return out;
}

// Traffic pass-by parameters for one car, written into `out` (no allocation per frame).
// rel = car - player (metres); rvx/rvz = car velocity minus player velocity (m/s); heading = player heading.
export function trafficSpatial(dx, dz, rvx, rvz, heading, out) {
  const fin = (v) => (Number.isFinite(v) ? v : 0);
  dx = fin(dx); dz = fin(dz); rvx = fin(rvx); rvz = fin(rvz); heading = fin(heading);
  const dist = Math.max(1, Math.hypot(dx, dz));
  out.gain = 0.9 / (1 + dist / 7);
  out.cutoff = 250 + 1400 / (1 + dist / 12);
  // Right-hand vector of the player's heading (heading 0 faces -z, right is +x).
  const rx = Math.cos(heading), rz = -Math.sin(heading);
  out.pan = clamp((dx * rx + dz * rz) / dist, -1, 1) * 0.85;
  // Radial closing speed: approaching cars (negative) sound higher, receding cars lower.
  const radial = (dx * rvx + dz * rvz) / dist;
  out.doppler = clamp(SPEED_OF_SOUND / (SPEED_OF_SOUND + radial), 0.8, 1.25);
  return out;
}

// Writes the indices of up to `slots` items whose distance is below `limit` into `outIdx`, nearest first.
// Returns how many were written. No allocation: callers keep the typed arrays.
export function pickNearest(distSq, count, limit, slots, outIdx) {
  let found = 0;
  for (let i = 0; i < count; i++) {
    const d = distSq[i];
    if (!(d < limit)) continue;
    let pos = found < slots ? found : slots - 1;
    if (found >= slots && d >= distSq[outIdx[pos]]) continue;
    if (found < slots) found++;
    while (pos > 0 && distSq[outIdx[pos - 1]] > d) {
      outIdx[pos] = outIdx[pos - 1];
      pos--;
    }
    outIdx[pos] = i;
  }
  return found;
}

function makeNoiseBuffer(ctx, seconds, kind) {
  const target = Math.floor(ctx.sampleRate * seconds);
  const fade = Math.floor(ctx.sampleRate * LOOP_FADE_SECONDS);
  const raw = new Float32Array(target + fade);
  let last = 0;
  for (let i = 0; i < raw.length; i++) {
    const white = Math.random() * 2 - 1;
    if (kind === 'brown') {
      last = (last + 0.02 * white) / 1.02;
      raw[i] = last * 3.5;
    } else {
      raw[i] = white;
    }
  }
  const data = crossfadeLoop(raw, fade);
  const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
  buf.getChannelData(0).set(data);
  return buf;
}

// Smooth 30 Hz control writes. Each call replaces the previous write for this parameter instead of stacking
// automation events: with cancelAndHoldAtTime the pending automation is cut at now; without it (older Safari) the
// events this helper wrote last time are removed by their time and the current value is held. Either way the
// timeline stays at a couple of events per parameter.
const lastRampTime = new WeakMap();
export function ramp(param, value, timeConstant, t) {
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(t);
  } else {
    const last = lastRampTime.get(param);
    param.cancelScheduledValues(last === undefined ? t : last);
    param.setValueAtTime(param.value, t);
  }
  param.setTargetAtTime(value, t, timeConstant);
  lastRampTime.set(param, t);
}

function actorX(a) { return a.x ?? a.state?.x ?? 0; }
function actorZ(a) { return a.z ?? a.state?.z ?? 0; }
function actorHeading(a) { return a.heading ?? a.state?.heading ?? 0; }
function actorSpeed(a) { return a.speed ?? a.state?.speed ?? 0; }
// Velocity from the explicit components when present, otherwise from speed along the heading (forward is (-sin h, -cos h)).
function actorVx(a) { const v = a.vx ?? a.state?.vx; return v ?? -Math.sin(actorHeading(a)) * actorSpeed(a); }
function actorVz(a) { const v = a.vz ?? a.state?.vz; return v ?? -Math.cos(actorHeading(a)) * actorSpeed(a); }

function buildGraph(ctx) {
  const gain = (value = 1) => {
    const g = ctx.createGain();
    g.gain.value = value;
    return g;
  };
  const filter = (type, frequency, Q = 0.7, dB = 0) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = Q;
    f.gain.value = dB;
    return f;
  };
  const loop = (buffer) => {
    const s = ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    return s;
  };
  // Band-limited waveforms: 40 harmonics cover the 340 Hz redline without folding back as aliasing.
  // Amplitudes are given explicitly and normalisation is disabled, so the level is the same in every browser.
  const bandLimited = (kind) => {
    const re = new Float32Array(41);
    const im = new Float32Array(41);
    for (let k = 1; k <= 40; k++) {
      if (kind === 'square' && k % 2 === 0) continue;
      im[k] = 1 / k;
    }
    // Scale so the waveform peaks at 1 in JavaScript, the same in every browser (matches the usual normalised peak).
    let peak = 0;
    for (let n = 0; n < 1024; n++) {
      let v = 0;
      for (let k = 1; k <= 40; k++) v += im[k] * Math.sin((2 * Math.PI * k * n) / 1024);
      peak = Math.max(peak, Math.abs(v));
    }
    for (let k = 1; k <= 40; k++) im[k] /= peak || 1;
    return ctx.createPeriodicWave(re, im, { disableNormalization: true });
  };
  const sawWave = bandLimited('saw');
  const squareWave = bandLimited('square');
  const osc = (type, frequency) => {
    const o = ctx.createOscillator();
    if (type === 'square') o.setPeriodicWave(squareWave);
    else if (type === 'sawtooth') o.setPeriodicWave(sawWave);
    else o.type = type;
    o.frequency.value = frequency;
    return o;
  };

  // Master bus: DC block, high shelf tames harshness, gentle compressor, soft clip caps peaks, fade gain.
  const fade = gain(0);
  const lowpass = filter('lowpass', 9500, 0.5);
  const clipper = ctx.createWaveShaper();
  clipper.curve = softClipCurve();
  clipper.oversample = '2x';
  const makeup = gain(1.25);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -6;
  comp.knee.value = 10;
  comp.ratio.value = 1.5;
  comp.attack.value = 0.01;
  comp.release.value = 0.2;
  const shelf = filter('highshelf', 4000, 0.7, -4);
  const dcBlock = filter('highpass', 20, 0.7);
  const masterIn = gain(1);
  masterIn.connect(dcBlock).connect(shelf).connect(comp).connect(makeup).connect(clipper).connect(lowpass).connect(fade);
  fade.connect(ctx.destination);

  // Buses. Driving layers share busDrive so impacts can duck them together.
  const busDrive = gain(1);
  busDrive.connect(masterIn);
  const busFx = gain(0.9); // dry one-shots: boost pad
  busFx.connect(masterIn);
  const busSfx = gain(0.9); // impacts and pickups: also feed the reverb send
  busSfx.connect(masterIn);
  const busTraffic = gain(0.8);
  busTraffic.connect(masterIn);
  const busUi = gain(0.6); // menu clicks go straight to the output, so the paused menu is audible
  busUi.connect(ctx.destination);

  // Reverb: generated 0.5 s impulse response. The send is only connected while it is in use (see touchReverb).
  const reverbSend = gain(0.22);
  busSfx.connect(reverbSend);
  // The ConvolverNode itself is created on first use and released when idle (see touchReverb), so it costs nothing
  // while no impact or pickup is playing. Only the impulse response buffer is kept.
  const irBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.5), ctx.sampleRate);
  irBuffer.getChannelData(0).set(makeImpulseResponse(ctx.sampleRate, 0.5));
  const reverbWet = gain(0.5);
  reverbWet.connect(masterIn);
  const convolver = null;

  const white = makeNoiseBuffer(ctx, 4, 'white');
  const brown = makeNoiseBuffer(ctx, 6, 'brown');
  // Each noise layer starts at its own random point in the shared buffer, so the layers are not phase-coherent.
  const offsetIn = (buffer) => Math.random() * buffer.length / ctx.sampleRate;

  // Engine voice: three harmonic oscillators at the firing frequency (f, f/2 burble, f*1.012 beating),
  // a tone low-pass that opens with load, a parallel grit shaper and exhaust formant, an exhaust low-pass,
  // then load, rev-limiter cut and gear-shift gain stages.
  const oscA = osc('sawtooth', 45);
  const oscB = osc('square', 22.5);
  const oscC = osc('sawtooth', 45.5);
  const toneSum = gain(1);
  oscA.connect(gain(0.5)).connect(toneSum);
  oscB.connect(gain(0.18)).connect(toneSum);
  oscC.connect(gain(0.3)).connect(toneSum);
  const toneLP = filter('lowpass', 900, 0.7);
  toneSum.connect(toneLP);
  const gritShaper = ctx.createWaveShaper();
  gritShaper.curve = gritCurve();
  gritShaper.oversample = '2x';
  const gritGain = gain(0.1);
  toneLP.connect(gritShaper).connect(filter('lowpass', 2000, 0.7)).connect(gritGain);
  const formant = filter('bandpass', 400, 1.4);
  const formantGain = gain(0.5);
  toneLP.connect(formant).connect(formantGain);
  const mixOut = gain(1);
  toneLP.connect(mixOut);
  gritGain.connect(mixOut);
  formantGain.connect(mixOut);
  // Recorded idle loop joins the voice before the load stage.
  const sampleLP = filter('lowpass', 1400, 0.7);
  const sampleGain = gain(0);
  // Both recorded loops bypass the synth's load stage: their own gains set their level.
  const loopOut = gain(1);
  sampleLP.connect(sampleGain).connect(loopOut);
  // Loop B (heavier recording at higher speed) for the upper revs.
  const sampleHighLP = filter('lowpass', 1800, 0.7);
  const sampleHighGain = gain(0);
  sampleHighLP.connect(sampleHighGain).connect(loopOut);
  const loadGain = gain(0);
  mixOut.connect(filter('lowpass', 3600, 0.6)).connect(loadGain);
  // Rev-limiter: a dedicated gain node chopped by a 10 Hz square LFO (base 1 - d/2, depth d/2).
  const limGain = gain(1);
  loadGain.connect(limGain);
  const limLfo = osc('square', 10);
  const limDepth = gain(0);
  limLfo.connect(limDepth).connect(limGain.gain);
  // Gear-shift cut: a short dip in engine level on each upshift.
  const shiftGain = gain(1);
  limGain.connect(shiftGain).connect(busDrive);
  // The recorded loops pass the rev-limiter chop and the gear-shift dip too.
  loopOut.connect(limGain);

  // Exhaust pop on lift (broadband crack through a 1.8 kHz band) and blow-off flutter (sweeping band, turbo cars).
  const popSrc = loop(white);
  const popBP = filter('bandpass', 1800, 0.9);
  const popGain = gain(0);
  popSrc.connect(popBP).connect(popGain).connect(busDrive);
  const blowSrc = loop(white);
  const blowBP = filter('bandpass', 2600, 2.5);
  const blowGain = gain(0);
  blowSrc.connect(blowBP).connect(blowGain).connect(busDrive);
  // Gear clunk: a short low band-passed noise thud at each upshift.
  const clunkSrc = loop(white);
  const clunkBP = filter('bandpass', 220, 1.2);
  const clunkGain = gain(0);
  clunkSrc.connect(clunkBP).connect(clunkGain).connect(busDrive);

  // Electric inverter whine: a triangle that rises with rpm. Silent for combustion cars.
  const whineOsc = osc('triangle', 200);
  const whineGain = gain(0);
  whineOsc.connect(whineGain).connect(busDrive);

  // Tyres: band-passed noise with a 23 Hz wobble, plus a tonal squeal (sawtooth through a narrow band).
  const tyreSrc = loop(white);
  const tyreBP = filter('bandpass', 1400, 1.1);
  const tyreGain = gain(0);
  const tyreLfo = osc('sine', 23);
  const tyreLfoGain = gain(0);
  tyreLfo.connect(tyreLfoGain).connect(tyreGain.gain);
  tyreSrc.connect(tyreBP).connect(tyreGain).connect(busDrive);
  const squealOsc = osc('sawtooth', 1000);
  const squealBP = filter('bandpass', 1300, 6);
  const squealGain = gain(0);
  squealOsc.connect(squealBP).connect(squealGain).connect(busDrive);

  // Road rumble: low brown noise that grows with speed.
  const roadSrc = loop(brown);
  const roadGain = gain(0);
  roadSrc.connect(filter('lowpass', 180)).connect(roadGain).connect(busDrive);

  // Nitro: rising low-pass on high-passed white noise.
  const nitroSrc = loop(white);
  const nitroFilter = filter('lowpass', nitroCutoff(0), 3);
  const nitroGain = gain(0);
  nitroSrc.connect(filter('highpass', 250)).connect(nitroFilter).connect(nitroGain).connect(busDrive);

  // Wind: brown noise low-passed, plus a bright hiss band that appears only at speed.
  const windSrc = loop(brown);
  const windGainNode = gain(0);
  windSrc.connect(filter('lowpass', 700)).connect(windGainNode).connect(busDrive);
  const hissSrc = loop(white);
  const hissGain = gain(0);
  hissSrc.connect(filter('highpass', 2500)).connect(filter('lowpass', 7000)).connect(hissGain).connect(busDrive);

  // Sea: brown noise with a slow swell on its gain.
  const seaSrc = loop(brown);
  const seaGain = gain(0.05);
  const seaLfo = osc('sine', 0.09);
  const seaLfoGain = gain(0.02);
  seaLfo.connect(seaLfoGain).connect(seaGain.gain);
  seaSrc.connect(filter('lowpass', 320)).connect(seaGain).connect(busDrive);

  // Traffic: a fixed pool of voices. Each has a tone (engine-like, pitch from speed), a noise band (tyre and
  // air rush) and a stereo panner. Created once; updated in place.
  const traffic = [];
  const sources = [oscA, oscB, oscC, limLfo, popSrc, blowSrc, clunkSrc, whineOsc, tyreSrc, tyreLfo, squealOsc, roadSrc, nitroSrc, windSrc, hissSrc, seaSrc, seaLfo];
  for (let i = 0; i < TRAFFIC_VOICES; i++) {
    const tone = osc('sine', 60);
    const toneLP = filter('lowpass', 600, 0.7);
    const toneGain = gain(0.3);
    const noise = loop(brown);
    const noiseBP = filter('bandpass', 700, 0.8);
    const noiseGain = gain(0.7);
    const vg = gain(0);
    const pan = ctx.createStereoPanner();
    tone.connect(toneLP).connect(toneGain).connect(vg);
    noise.connect(noiseBP).connect(noiseGain).connect(vg);
    vg.connect(pan).connect(busTraffic);
    tone.start();
    noise.start(0, offsetIn(brown));
    sources.push(tone, noise);
    traffic.push({ tone, toneLP, vg, pan, noiseBP, live: true, dropTimer: null });
  }

  oscA.start(); oscB.start(); oscC.start(); limLfo.start(); whineOsc.start();
  popSrc.start(0, offsetIn(white)); blowSrc.start(0, offsetIn(white)); clunkSrc.start(0, offsetIn(white));
  tyreSrc.start(0, offsetIn(white)); tyreLfo.start(); squealOsc.start();
  roadSrc.start(0, offsetIn(brown)); nitroSrc.start(0, offsetIn(white)); windSrc.start(0, offsetIn(brown));
  hissSrc.start(0, offsetIn(white));
  seaSrc.start(0, 1.3); seaLfo.start();

  return {
    master: fade, busDrive, busFx, busSfx, busUi, busTraffic, reverbSend, convolver, irBuffer, reverbWet, white,
    oscA, oscB, oscC, toneLP, formant, gritGain, loadGain, limGain, limDepth, shiftGain, sampleLP, sampleGain, sampleHighLP, sampleHighGain,
    popGain, popBP, blowGain, blowBP, clunkGain, clunkBP, whineOsc, whineGain,
    tyreGain, tyreLfoGain, tyreBP, squealOsc, squealBP, squealGain, roadGain,
    nitroFilter, nitroGain, windGainNode, hissGain, seaGain, traffic, loopOut,
    sources, engineSample: null,
  };
}

export class GameAudio {
  constructor({
    assetBase = new URL('./assets/audio/', import.meta.url).href,
    AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext || null,
    fetchFn = typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null,
  } = {}) {
    this.assetBase = assetBase;
    this.AudioContextClass = AudioContextClass;
    this.fetchFn = fetchFn;
    this.ctx = null;
    this.nodes = null;
    this.enabled = false;
    this.unlocked = false;
    this.paused = true;
    this.disposed = false;
    this.buffers = {};
    this.loaded = {};
    this.acc = 0;
    this.trafficAcc = 0;
    this.rpm = ENGINE_IDLE_RPM;
    this.load = 0;
    this.screech = 0;
    this.boostTime = 0;
    this.lastGear = 1;
    this.prevThrottle = 0;
    this.lastPopAt = -Infinity;
    this.dipUntil = -Infinity;
    this.lastImpactAt = -Infinity;
    this.lastBoostPadAt = -Infinity;
    this.masterLevel = 0;
    this.errors = 0; // exceptions swallowed inside the audio step (exposed in debug(), so they cannot hide bugs)
    this.ratioFast = 1; // rpm ratio smoothed over about 0.5 s: sets the loops' pitch
    this.ratioSlow = 1; // rpm ratio smoothed over about 1.5 s: sets the loops' levels
    this.reverbLive = false;
    this.profile = DEFAULT_PROFILE;
    this.trafficDist = new Float64Array(64);
    this.trafficPick = new Int32Array(TRAFFIC_VOICES);
    this.spatial = { gain: 0, cutoff: 0, pan: 0, doppler: 1 };
    this.stopTimer = null;
    this.suspendTimer = null;
    this.uiTimer = null;
    this.reverbTimer = null;
    this.uiListener = null;
    this.gestureListeners = [];
    this.oneShots = new Set();
    this.values = { gear: 1, rpm: this.rpm, firing: firingFrequency(this.rpm), engineRate: 1, engineGain: 0, screech: 0, nitroGain: 0, nitroCutoff: 700, windGain: 0, speed: 0, reverse: false, limiter: 0, ev: false, trafficVoices: 0 };
    this.attachGestures();
  }

  // Creates the context and graph. Only called after a user gesture (see unlock/setEnabled).
  init() {
    if (this.disposed || !this.AudioContextClass) return false;
    if (!this.ctx) {
      let ctx = null;
      try {
        ctx = new this.AudioContextClass();
      } catch {
        return false;
      }
      try {
        this.nodes = buildGraph(ctx);
        this.ctx = ctx;
      } catch {
        // A context that cannot build the graph is closed so it does not leak an audio device.
        try { ctx.close().catch(() => {}); } catch {}
        this.ctx = null;
        this.nodes = null;
        return false;
      }
      try {
        // iOS can move the context to 'interrupted' (calls, locks). Re-sync when that happens.
        this.ctx.onstatechange = () => this.syncRunning();
      } catch {}
      this.loadAssets();
      this.attachUi();
    }
    return true;
  }

  // Any pointer, key or touch counts as a gesture. This unlocks audio the first time and keeps
  // the context resumed on iOS, where it can be interrupted by calls, locks or backgrounding.
  attachGestures() {
    if (typeof document === 'undefined' || this.gestureListeners.length) return;
    const onGesture = () => this.unlock();
    for (const type of GESTURE_EVENTS) {
      document.addEventListener(type, onGesture, { capture: true, passive: true });
      this.gestureListeners.push([document, type, onGesture, { capture: true, passive: true }]);
    }
    const onResume = () => this.syncRunning();
    document.addEventListener('visibilitychange', onResume);
    this.gestureListeners.push([document, 'visibilitychange', onResume]);
    if (typeof window !== 'undefined') {
      window.addEventListener('pageshow', onResume);
      this.gestureListeners.push([window, 'pageshow', onResume]);
    }
  }

  unlock() {
    if (this.disposed) return;
    this.unlocked = true;
    this.activate();
  }

  // Background decode; never blocks and never throws. Missing files simply leave the synth fallback in place.
  loadAssets() {
    if (!this.fetchFn || !this.ctx) return;
    for (const [key, file] of Object.entries(AUDIO_ASSETS)) {
      Promise.resolve()
        .then(() => this.fetchFn(this.assetBase + file))
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.arrayBuffer();
        })
        .then((data) => this.ctx && this.ctx.decodeAudioData(data))
        .then((buffer) => {
          if (!buffer || this.disposed) return;
          this.buffers[key] = buffer;
          this.loaded[key] = true;
          if (key === 'engine' || key === 'engineHigh') this.startEngineSample();
        })
        .catch(() => {});
    }
  }

  // Starts whichever recorded loops have decoded. Each starts at a random offset so the layers are not in phase.
  startEngineSample() {
    const n = this.nodes;
    if (!n || !this.ctx) return;
    const start = (buffer, dest) => {
      const src = this.ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.connect(dest);
      src.start(0, Math.random() * buffer.duration);
      return src;
    };
    if (this.buffers.engine && !n.engineSample) n.engineSample = start(this.buffers.engine, n.sampleLP);
    if (this.buffers.engineHigh && !n.engineHighSample) n.engineHighSample = start(this.buffers.engineHigh, n.sampleHighLP);
  }

  // Menu sound toggle. Returns the effective state: false when Web Audio is unavailable,
  // so the UI label can show Off. Before the first gesture audio is only flagged on; it starts at the first gesture.
  setEnabled(on) {
    const supported = !!this.AudioContextClass && !this.disposed;
    this.enabled = !!on && supported;
    if (!this.enabled) {
      if (this.nodes) {
        this.fade(0);
        this.clearStopTimer();
        this.stopTimer = setTimeout(() => {
          this.stopTimer = null;
          if (!this.enabled && this.masterLevel === 0) this.syncRunning();
        }, PAUSE_SUSPEND_MS);
      }
      return false;
    }
    this.attachGestures();
    if (this.unlocked) return this.activate();
    return true;
  }

  // Creates and fades in audio when enabled and unlocked. Returns the effective enabled state.
  // A gesture while paused creates the graph but keeps the master at silence.
  activate() {
    if (!this.enabled || !this.unlocked) return this.enabled;
    if (!this.init()) {
      this.enabled = false;
      return false;
    }
    this.clearStopTimer();
    this.fade(this.paused ? 0 : MASTER_LEVEL);
    this.syncRunning();
    return true;
  }

  // Game pause or home screen. The master fades out first (about 5 time constants) and the context suspends only
  // once it is silent, so there is no click. Resuming fades back in from silence, so the level never jumps.
  setPaused(paused) {
    const was = this.paused;
    this.paused = !!paused;
    this.clearSuspendTimer();
    if (this.paused) {
      if (this.nodes && !was) this.fade(0);
      this.suspendTimer = setTimeout(() => {
        this.suspendTimer = null;
        if (this.paused && this.masterLevel === 0) this.syncRunning();
      }, PAUSE_SUSPEND_MS);
      return;
    }
    this.syncRunning();
    if (this.nodes && this.enabled) this.fade(MASTER_LEVEL);
  }

  // Idempotent. Resumes whenever sound should play and suspends when it should not, without trusting the cached
  // context state (iOS can leave it stale). While a fade is pending the fade timer does the suspend, so a gesture
  // during the pause fade cannot cut the sound off abruptly.
  syncRunning() {
    if (!this.ctx || this.disposed) return;
    const want = this.enabled && !this.paused;
    if (want) {
      this.ctx.resume().catch(() => {});
      return;
    }
    if (this.suspendTimer !== null || this.stopTimer !== null) return;
    this.ctx.suspend().catch(() => {});
  }

  fade(level, time = 0.06) {
    if (!this.nodes) return;
    this.masterLevel = level;
    const t = this.ctx.currentTime;
    this.nodes.master.gain.cancelScheduledValues(t);
    this.nodes.master.gain.setTargetAtTime(level, t, time);
  }

  canPlay() {
    return !!(this.nodes && this.enabled && !this.paused && !this.disposed);
  }

  // Sets the car's engine character from its vehicles.js definition (category, profile).
  setVehicle(definition) {
    this.profile = engineProfileFor(definition);
    this.values.ev = this.profile.ev;
  }

  // Called once per frame from the driving loop. Internally throttled to 30 Hz.
  // Reads actor.isAirborne directly: airborne unloads the engine and swells the wind.
  // Never throws into the frame loop: any failure inside the audio step is swallowed.
  update(actor, throttle, handbrake, boosting, dt) {
    try {
      this.stepDriving(actor, throttle, handbrake, boosting, dt);
    } catch {
      this.errors++;
    }
  }

  stepDriving(actor, throttle, handbrake, boosting, dt) {
    if (!this.canPlay() || !actor) return;
    this.acc += dt > 0 ? dt : 0;
    if (this.acc < UPDATE_INTERVAL) return;
    const h = this.acc;
    this.acc = 0;

    const n = this.nodes;
    const t = this.ctx.currentTime;
    const speed = actor.speed;
    const forward = actor.forwardSpeed;
    const reverse = Number.isFinite(forward) && forward < -0.5;
    const airborne = actor.isAirborne === true;
    const th = throttle ? 1 : 0;
    const p = this.profile;
    const ev = p.ev;

    // Engine. `ratio` is rpm relative to this car's own idle. Combustion cars: the recorded idle loop (A) fades out
    // as the synth takes over, and a heavier recording (B) fades in for the upper revs; the synth stays as a thin
    // layer. Electric cars: the combustion voices are muted and the inverter whine carries the car.
    const rpmTarget = clamp(engineSpeedRpm(speed, forward) + th * 0.08, 0, 1);
    this.rpm = approach(this.rpm, rpmTarget, 7, h);
    this.load = approach(this.load, th && !airborne ? 1 : 0, 9, h);
    const rpm = this.rpm;
    // Gear sawtooth in rpm is the raw input. Pitch follows a fast ratio (about 0.5 s) so it does not lag; levels follow
    // a slower ratio (about 0.8 s) so the gear sweeps cannot pump the recorded layers.
    const ratio = engineRpm(rpm, p.redline) / IDLE_RPM;
    this.ratioFast = approach(this.ratioFast, ratio, 1 / 0.5, h);
    this.ratioSlow = approach(this.ratioSlow, ratio, 1 / 1.5, h);
    const dip = t < this.dipUntil ? 1 - SHIFT_DIP_DEPTH : 1;
    const firing = firingFrequency(rpm, p.cylinders || CYLINDERS, p.redline) * dip;
    const rate = ratioToRate(this.ratioFast);
    const rateB = highLoopRate(this.ratioFast);
    const lim = ev ? 0 : limiterDepth(rpm);
    let eg = 0;
    let sampleA = 0;
    let sampleB = 0;
    if (ev) {
      ramp(n.loadGain.gain, 0, 0.08, t);
      ramp(n.sampleGain.gain, 0, 0.1, t);
      ramp(n.sampleHighGain.gain, 0, 0.1, t);
    } else {
      ramp(n.oscA.frequency, firing, 0.03, t);
      ramp(n.oscB.frequency, firing * 0.5, 0.03, t);
      ramp(n.oscC.frequency, firing * 1.012, 0.03, t);
      ramp(n.toneLP.frequency, Math.min(2200, 650 + 1000 * this.load + 1.2 * firing), 0.08, t);
      ramp(n.formant.frequency, clamp(2.8 * firing, 220, 900), 0.1, t);
      ramp(n.gritGain.gain, 0.05 + 0.3 * this.load, 0.1, t);
      const blend = loopBlend(this.ratioSlow);
      // Off-throttle the recordings drop to 40%, as a real engine does when it is not under load.
      const offLoad = 0.4 + 0.6 * this.load;
      sampleA = loopALevel(this.ratioSlow) * offLoad;
      sampleB = highLoopLevel(this.ratioSlow) * offLoad;
      eg = engineGain(rpm, this.load) * (reverse ? 0.8 : 1) * (0.35 + 0.65 * Math.sin((blend * Math.PI) / 2));
      ramp(n.loadGain.gain, eg, 0.08, t);
      ramp(n.limGain.gain, 1 - lim / 2, 0.05, t);
      ramp(n.limDepth.gain, lim / 2, 0.05, t);
      ramp(n.sampleGain.gain, sampleA, 0.1, t);
      ramp(n.sampleHighGain.gain, sampleB, 0.1, t);
    }
    if (n.engineSample) ramp(n.engineSample.playbackRate, rate, 0.05, t);
    if (n.engineHighSample) ramp(n.engineHighSample.playbackRate, rateB, 0.05, t);
    // Electric inverter whine: rises with rpm and load. Silent for combustion cars.
    ramp(n.whineOsc.frequency, 170 + 800 * rpm, 0.08, t);
    const whine = ev ? 0.03 * (0.3 + 0.7 * this.load) * clamp(rpm / 0.4, 0, 1) : 0;
    ramp(n.whineGain.gain, whine, 0.1, t);
    this.values.loadTarget = eg;
    this.values.sampleTarget = sampleA;
    this.values.highTarget = sampleB;
    this.values.whineTarget = whine;

    // Gear shift: a level dip, a short rpm dip and a clunk on each upshift.
    const gear = gearFromSpeed(speed);
    if (!ev && gear > this.lastGear && speed > 4 && !reverse) this.shiftCut(t);
    this.lastGear = gear;
    // Lift off the throttle under load: exhaust crack, and blow-off flutter for turbo cars.
    if (!ev && !reverse && this.prevThrottle && !th && !airborne && rpm > 0.4) this.exhaustPop(t, rpm);
    if (!ev && p.turbo && !reverse && this.prevThrottle && !th && !airborne && rpm > 0.7) this.blowOff(t);
    this.prevThrottle = th;

    // Tyres: silent at standstill, squeal from lateral slide or handbrake.
    const standstill = tyreStandstillGate(speed);
    const screechTarget = screechIntensity(speed, actor.lateralSpeed, handbrake);
    this.screech = approach(this.screech, screechTarget, 10, h);
    ramp(n.tyreGain.gain, (0.015 + 0.16 * this.screech) * standstill * (ev ? 1.3 : 1), 0.05, t);
    // Wobble is 14% of the tyre level (a 34% wobble sounded like motorboat flutter).
    ramp(n.tyreLfoGain.gain, 0.025 * this.screech * standstill, 0.05, t);
    ramp(n.tyreBP.frequency, 1300 + 1100 * this.screech, 0.1, t);
    ramp(n.squealGain.gain, 0.09 * Math.pow(this.screech, 1.5) * standstill, 0.06, t);
    ramp(n.squealOsc.frequency, 1000 + 700 * this.screech, 0.08, t);
    ramp(n.squealBP.frequency, 1300 + 900 * this.screech, 0.1, t);
    ramp(n.roadGain.gain, (0.01 + 0.05 * clamp(speed / 50, 0, 1)) * standstill + (ev ? 0.012 * standstill : 0), 0.2, t);

    // Nitro: gain follows boost, filter opens over the length of the boost.
    this.boostTime = boosting ? this.boostTime + h : Math.max(0, this.boostTime - h * 2);
    const cutoff = nitroCutoff(this.boostTime);
    ramp(n.nitroGain.gain, boosting ? 0.3 : 0, 0.12, t);
    ramp(n.nitroFilter.frequency, cutoff, 0.25, t);

    // Wind rises with speed and swells in the air. A bright hiss band joins at high speed.
    const wind = windGain(speed) * (airborne ? 1.8 : 1) * (ev ? 1.2 : 1);
    ramp(n.windGainNode.gain, wind, airborne ? 0.15 : 0.3, t);
    ramp(n.hissGain.gain, 0.002 + 0.012 * Math.pow(clamp(speed / 60, 0, 1), 2), 0.3, t);

    const v = this.values;
    v.gear = gear;
    v.rpm = rpm;
    v.firing = firing;
    v.engineRate = rate;
    v.engineGain = eg;
    v.screech = this.screech;
    v.nitroGain = boosting ? 0.3 : 0;
    v.nitroCutoff = cutoff;
    v.windGain = wind;
    v.speed = speed;
    v.reverse = reverse;
    v.limiter = lim;
    v.ratioSlow = this.ratioSlow;
    v.ratioFast = this.ratioFast;
  }

  // Pooled traffic: the nearest TRAFFIC_VOICES cars within TRAFFIC_RANGE drive the voices, with distance gain and
  // low-pass, stereo pan from bearing, and doppler from the radial speed. Throttled to 30 Hz, no per-frame allocation.
  // Pooled traffic. Never throws into the frame loop.
  updateTraffic(cars, player, dt) {
    try {
      this.stepTraffic(cars, player, dt);
    } catch {
      this.errors++;
    }
  }

  // The nearest TRAFFIC_VOICES cars within TRAFFIC_RANGE drive the voices, with distance gain and low-pass, stereo
  // pan from bearing, and doppler from the radial speed. Throttled to 30 Hz, no per-frame allocation. Non-finite
  // positions or velocities silence the affected voice instead of reaching an AudioParam.
  stepTraffic(cars, player, dt) {
    if (!this.canPlay() || !cars || !player) return;
    this.trafficAcc += dt > 0 ? dt : 0;
    if (this.trafficAcc < UPDATE_INTERVAL) return;
    this.trafficAcc = 0;
    const n = this.nodes;
    const t = this.ctx.currentTime;
    const px = actorX(player), pz = actorZ(player);
    const pvx = actorVx(player), pvz = actorVz(player);
    const ph = actorHeading(player);
    const playerOk = [px, pz, pvx, pvz, ph].every(Number.isFinite);
    const count = Math.min(cars.length, this.trafficDist.length);
    for (let i = 0; i < count; i++) {
      const a = cars[i] && cars[i].actor;
      const dx = a ? actorX(a) - px : NaN, dz = a ? actorZ(a) - pz : NaN;
      this.trafficDist[i] = playerOk && Number.isFinite(dx) && Number.isFinite(dz) ? dx * dx + dz * dz : Infinity;
    }
    const picked = playerOk ? pickNearest(this.trafficDist, count, TRAFFIC_RANGE * TRAFFIC_RANGE, TRAFFIC_VOICES, this.trafficPick) : 0;
    let usableCount = 0;
    for (let v = 0; v < TRAFFIC_VOICES; v++) {
      const voice = n.traffic[v];
      const a = v < picked ? cars[this.trafficPick[v]].actor : null;
      const dx = a ? actorX(a) - px : NaN, dz = a ? actorZ(a) - pz : NaN;
      const vx = a ? actorVx(a) : NaN, vz = a ? actorVz(a) : NaN;
      const usable = !!a && [dx, dz, vx, vz].every(Number.isFinite);
      if (!usable) {
        // Fade out first; disconnect only after the fade has finished, so there is no click.
        ramp(voice.vg.gain, 0, 0.1, t);
        if (voice.live && voice.dropTimer === null) {
          voice.dropTimer = setTimeout(() => {
            voice.dropTimer = null;
            if (voice.live) {
              voice.vg.disconnect(voice.pan);
              voice.live = false;
            }
          }, VOICE_DROP_MS);
        }
        continue;
      }
      usableCount++;
      if (voice.dropTimer !== null) {
        clearTimeout(voice.dropTimer);
        voice.dropTimer = null;
      }
      if (!voice.live) {
        voice.vg.connect(voice.pan);
        voice.live = true;
      }
      const s = this.spatial;
      trafficSpatial(dx, dz, vx - pvx, vz - pvz, ph, s);
      const speedRaw = Math.hypot(vx, vz);
      const speed = Number.isFinite(speedRaw) ? speedRaw : 0;
      ramp(voice.tone.frequency, (45 + 3.4 * speed) * s.doppler, 0.08, t);
      ramp(voice.toneLP.frequency, s.cutoff, 0.1, t);
      ramp(voice.noiseBP.frequency, 500 + 20 * speed, 0.1, t);
      ramp(voice.vg.gain, s.gain * 0.2, 0.1, t);
      ramp(voice.pan.pan, s.pan, 0.1, t);
    }
    this.values.trafficVoices = usableCount;
  }

  // Engine level and firing rate dip for a moment on each upshift, with a short clunk. Combustion cars only.
  shiftCut(t) {
    const n = this.nodes;
    const g = n.shiftGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.35, t + 0.02);
    g.linearRampToValueAtTime(1, t + 0.12);
    this.dipUntil = t + SHIFT_DIP_SECONDS;
    const c = n.clunkGain.gain;
    c.cancelScheduledValues(t);
    c.setValueAtTime(0, t);
    c.linearRampToValueAtTime(0.22, t + 0.004);
    c.exponentialRampToValueAtTime(0.0002, t + 0.07);
  }

  // Exhaust pop: a 90 ms broadband crack through a 1.8 kHz band, louder at higher rpm.
  exhaustPop(t, rpm) {
    if (t - this.lastPopAt < POP_COOLDOWN) return;
    this.lastPopAt = t;
    const g = this.nodes.popGain.gain;
    const level = (0.25 + 0.3 * clamp(rpm, 0, 1)) * (0.85 + 0.3 * Math.random());
    g.cancelScheduledValues(t);
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(level, t + 0.003);
    g.exponentialRampToValueAtTime(0.0002, t + 0.09);
  }

  // Blow-off flutter: a 0.3 s noise hiss through a band that sweeps down.
  blowOff(t) {
    const g = this.nodes.blowGain.gain;
    const f = this.nodes.blowBP.frequency;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(0.2, t + 0.012);
    g.exponentialRampToValueAtTime(0.0002, t + 0.3);
    f.cancelScheduledValues(t);
    f.setValueAtTime(2600, t);
    f.exponentialRampToValueAtTime(1100, t + 0.3);
  }

  // Sidechain-style duck: driving layers drop briefly under a heavy hit, then come back.
  duck(depth, t) {
    const g = this.nodes.busDrive.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(1 - depth, t, 0.012);
    g.setTargetAtTime(1, t + 0.12, 0.25);
  }

  // The reverb send is built and connected on first use, and released after REVERB_IDLE_MS of silence.
  touchReverb() {
    const n = this.nodes;
    if (!n || !this.ctx) return;
    if (!n.convolver) {
      n.convolver = this.ctx.createConvolver();
      n.convolver.buffer = n.irBuffer;
      n.convolver.connect(n.reverbWet);
    }
    if (!this.reverbLive) {
      n.reverbSend.connect(n.convolver);
      this.reverbLive = true;
    }
    if (this.reverbTimer !== null) clearTimeout(this.reverbTimer);
    this.reverbTimer = setTimeout(() => {
      this.reverbTimer = null;
      this.releaseReverb();
    }, REVERB_IDLE_MS);
  }

  releaseReverb() {
    const n = this.nodes;
    if (n && n.convolver) {
      n.reverbSend.disconnect(n.convolver);
      n.convolver.disconnect();
      n.convolver = null;
    }
    this.reverbLive = false;
  }

  onPickup() {
    if (!this.canPlay()) return;
    const n = this.nodes;
    const t = this.ctx.currentTime;
    this.touchReverb();
    this.playBuffer('pickupClink', n.busSfx, 0.55, 1);
    const chime = this.playBuffer('pickupChime', n.busSfx, 0.45, 0.9);
    if (chime) {
      chime.playbackRate.setValueAtTime(0.9, t);
      chime.playbackRate.linearRampToValueAtTime(1.35, t + 0.25);
    } else {
      this.sweep(660, 1320, 0.2, 0.2, n.busSfx);
    }
  }

  // Automatic speed-boost pad (called by the ramp/pad code when the car drives over one).
  // A 0.8 s charge-up (recorded CC0 whoosh, or a noise sweep when samples are missing), then a two-note stinger.
  onBoostPad() {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    if (t - this.lastBoostPadAt < BOOST_PAD_COOLDOWN) return;
    this.lastBoostPadAt = t;
    const n = this.nodes;
    if (this.buffers.boostWhoosh) {
      this.playBuffer('boostWhoosh', n.busFx, 0.5, 1);
    } else {
      const src = this.ctx.createBufferSource();
      src.buffer = n.white;
      src.loop = true;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 2.5;
      bp.frequency.setValueAtTime(350, t);
      bp.frequency.exponentialRampToValueAtTime(3200, t + 0.8);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.4, t + 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.82);
      src.connect(bp).connect(g).connect(n.busFx);
      this.track(src);
      src.start(t);
      src.stop(t + 0.85);
    }
    if (this.buffers.boostShort) {
      this.playBuffer('boostShort', n.busFx, 0.5, 1, t + 0.6);
    } else {
      this.tone(660, t + 0.62, 0.14, 0.12, n.busFx);
      this.tone(990, t + 0.7, 0.2, 0.14, n.busFx);
    }
  }

  onRaceCount(go=false){if(!this.canPlay())return;const t=this.ctx.currentTime;this.tone(go?990:440,t,.16,.18,this.nodes.busSfx);}

  onImpact(speed) {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    const s = impactStrength(speed);
    if (s <= 0) return;
    if (t - this.lastImpactAt < 0.08) return;
    this.lastImpactAt = t;
    const n = this.nodes;
    const rate = impactRate(speed);
    this.touchReverb();
    if (s > 0.35) this.duck(0.45 * s, t);
    if (!this.playBuffer('impactHeavy', n.busSfx, 0.35 + 0.6 * s, rate)) {
      this.sweep(95, 40, 0.28, 0.55 * s + 0.15, n.busSfx);
    }
    if (s > 0.4) this.playBuffer('impactLight', n.busSfx, 0.2 + 0.4 * s, rate * 1.1);
  }

  // Menu clicks play whenever sound is on, including the paused menu. They bypass the master fade.
  // The context is resumed briefly for the click and suspended again afterwards if the game is still paused.
  onUiClick() {
    if (!this.enabled || !this.nodes || this.disposed) return;
    const wasStopped = this.ctx.state !== 'running';
    if (wasStopped) this.ctx.resume().catch(() => {});
    const n = this.nodes;
    if (!this.playBuffer('uiClick', n.busUi, 0.35, 1)) this.sweep(1200, 900, 0.04, 0.1, n.busUi);
    if (this.paused && wasStopped) {
      if (this.uiTimer !== null) clearTimeout(this.uiTimer);
      this.uiTimer = setTimeout(() => {
        this.uiTimer = null;
        this.syncRunning();
      }, 300);
    }
  }

  // Only real menu buttons (pause menu and home screen), never the touch pads.
  attachUi() {
    if (this.uiListener || typeof document === 'undefined') return;
    this.uiListener = (event) => {
      if (event.isTrusted === false) return; // synthetic .click() relays must not double the sound
      const target = event.target;
      if (!target || typeof target.closest !== 'function') return;
      const button = target.closest('button');
      if (!button || button.hasAttribute('data-key')) return;
      if (!button.closest('#menu, #home')) return;
      this.onUiClick();
    };
    document.addEventListener('click', this.uiListener, true);
  }

  // Starts a decoded sample at `when` (absolute context time; omitted or in the past means now).
  playBuffer(key, dest, level, rate, when = 0) {
    const buffer = this.buffers[key];
    if (!buffer || !this.ctx) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = level;
    src.connect(g).connect(dest);
    this.track(src);
    src.start(when);
    return src;
  }

  // Procedural fallback blip: sine sweep with a short decay envelope.
  sweep(fromHz, toHz, duration, peak, dest) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.frequency.setValueAtTime(fromHz, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, toHz), t + duration);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(dest);
    this.track(osc);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  // Short triangle note starting at `start` (absolute context time), with a fast attack and decay.
  tone(freq, start, duration, peak, dest) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, start);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(g).connect(dest);
    this.track(osc);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  track(source) {
    this.oneShots.add(source);
    source.onended = () => this.oneShots.delete(source);
  }

  clearStopTimer() {
    if (this.stopTimer !== null) {
      clearTimeout(this.stopTimer);
      this.stopTimer = null;
    }
  }

  clearSuspendTimer() {
    if (this.suspendTimer !== null) {
      clearTimeout(this.suspendTimer);
      this.suspendTimer = null;
    }
  }

  debug() {
    return {
      graph: !!this.nodes,
      contextState: this.ctx ? this.ctx.state : 'none',
      enabled: this.enabled,
      unlocked: this.unlocked,
      paused: this.paused,
      loaded: { ...this.loaded },
      activeOneShots: this.oneShots.size,
      sampleLayer: !!(this.nodes && this.nodes.engineSample),
      reverbLive: this.reverbLive,
      errors: this.errors,
      masterLevel: this.masterLevel,
      profile: { ...this.profile },
      ...this.values,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.enabled = false;
    this.clearStopTimer();
    this.clearSuspendTimer();
    if (this.uiTimer !== null) clearTimeout(this.uiTimer);
    if (this.reverbTimer !== null) clearTimeout(this.reverbTimer);
    if (this.nodes) for (const voice of this.nodes.traffic) if (voice.dropTimer !== null) clearTimeout(voice.dropTimer);
    this.reverbLive = false;
    for (const [target, type, fn, opts] of this.gestureListeners) target.removeEventListener(type, fn, opts);
    this.gestureListeners = [];
    if (this.uiListener && typeof document !== 'undefined') document.removeEventListener('click', this.uiListener, true);
    this.uiListener = null;
    for (const source of this.oneShots) {
      try { source.stop(); } catch {}
    }
    this.oneShots.clear();
    if (this.nodes) {
      for (const source of this.nodes.sources) {
        try { source.stop(); } catch {}
      }
      if (this.nodes.engineSample) {
        try { this.nodes.engineSample.stop(); } catch {}
      }
      if (this.nodes.engineHighSample) {
        try { this.nodes.engineHighSample.stop(); } catch {}
      }
    }
    if (this.ctx) {
      try { this.ctx.close().catch(() => {}); } catch {}
    }
    this.ctx = null;
    this.nodes = null;
    this.buffers = {};
  }
}
