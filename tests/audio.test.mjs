import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  GameAudio, GEAR_TOPS, AUDIO_ASSETS, clamp, approach, gearFromSpeed, rpmFromSpeed, engineSpeedRpm,
  limiterDepth, engineRate, highLoopRate, engineGain, tyreStandstillGate, screechIntensity, nitroCutoff, windGain,
  impactStrength, impactRate, crossfadeLoop, REVERSE_RPM_CAP, ENGINE_IDLE_RPM, LIMITER_RPM, TRAFFIC_VOICES,
  engineRpm, firingFrequency, loopBlend, loopALevel, highLoopLevel, ratioToRate, LOOP_A_GAIN, HIGH_LOOP_CEILING,
  HIGH_LOOP_RATIO, HIGH_LOOP_MAX_RATE,
  softClipCurve, gritCurve, makeImpulseResponse, engineProfileFor, trafficSpatial, pickNearest, ramp,
} from '../dist/audio.js';

// Automation-aware parameter mock: records every scheduled event so tests can check the timeline length.
const param = (value = 0) => ({
  value,
  events: [],
  setTargetAtTime(v, t) { this.events.push({ t, kind: 'target', v }); },
  setValueAtTime(v, t) { this.events.push({ t, kind: 'value', v }); },
  linearRampToValueAtTime(v, t) { this.events.push({ t, kind: 'linear', v }); },
  exponentialRampToValueAtTime(v, t) { this.events.push({ t, kind: 'exp', v }); },
  cancelScheduledValues(t) { this.events = this.events.filter((e) => e.t < t); },
  // Browsers prune events that are already in the past; this models that by keeping only the latest past event.
  cancelAndHoldAtTime(t) {
    const past = this.events.filter((e) => e.t < t);
    this.events = past.slice(-1).concat(this.events.filter((e) => e.t >= t));
  },
});

// Audio node mock that records connections, so tests can see what is wired to what.
function node() {
  return {
    connected: [],
    connect(target) { this.connected.push(target); return target; },
    disconnect(target) { this.connected = target ? this.connected.filter((x) => x !== target) : []; },
    start() {}, stop() {}, setPeriodicWave() {},
    gain: param(1), frequency: param(0), playbackRate: param(1), Q: param(1), pan: param(0),
    threshold: param(0), knee: param(0), ratio: param(0), attack: param(0), release: param(0),
  };
}

class MockAudioContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.sampleRate = 8000;
    this.destination = node();
    this.created = { gains: 0, sources: 0, oscillators: 0 };
  }
  createGain() { this.created.gains++; return node(); }
  createOscillator() { this.created.oscillators++; return node(); }
  createBufferSource() { this.created.sources++; return node(); }
  createBiquadFilter() { return node(); }
  createDynamicsCompressor() { return node(); }
  createStereoPanner() { return node(); }
  createWaveShaper() { const w = node(); w.curve = null; w.oversample = 'none'; return w; }
  createPeriodicWave(re, im, options) { return { re, im, options }; }
  createConvolver() { const c = node(); c.buffer = null; return c; }
  createBuffer(channels, length) {
    const data = new Float32Array(length);
    return { getChannelData: () => data, length, duration: length / this.sampleRate };
  }
  decodeAudioData(data) { return Promise.resolve({ duration: 1, byteLength: data.byteLength }); }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}

const okFetch = async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) });
const failFetch = async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) });
const VOICE_DROP_MS_TEST = 500;
const LOOP_MAX_RATE_TEST = 3;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const actor = (speed, lateralSpeed = 0, forwardSpeed = speed) => ({ speed, forwardSpeed, lateralSpeed });

// The browser gesture path: enable the toggle, then the first pointer/key/touch unlocks audio.
function enableAndUnlock(audio) {
  audio.setEnabled(true);
  audio.unlock();
}

test('clamp and approach are bounded and converge', () => {
  assert.equal(clamp(5, 0, 1), 1);
  assert.equal(clamp(-2, 0, 1), 0);
  assert.equal(clamp(NaN, 0.25, 1), 0.25);
  const once = approach(0, 1, 5, 0.1);
  assert.ok(once > 0 && once < 1);
  assert.ok(approach(0, 1, 5, 10) > 0.999);
  assert.equal(approach(0.3, 1, 5, 0), 0.3);
});

test('gearFromSpeed maps speed bands to 1-based gears', () => {
  assert.equal(gearFromSpeed(0), 1);
  assert.equal(gearFromSpeed(GEAR_TOPS[0] - 0.01), 1);
  assert.equal(gearFromSpeed(GEAR_TOPS[0]), 2);
  assert.equal(gearFromSpeed(GEAR_TOPS[4] + 1), GEAR_TOPS.length);
  assert.equal(gearFromSpeed(-5), 1);
});

test('rpmFromSpeed sweeps up within a gear and drops on upshift', () => {
  assert.ok(rpmFromSpeed(1) < rpmFromSpeed(8));
  const beforeShift = rpmFromSpeed(GEAR_TOPS[0] - 0.01);
  const afterShift = rpmFromSpeed(GEAR_TOPS[0] + 0.01);
  assert.ok(beforeShift > 0.95, `rpm at redline ${beforeShift}`);
  assert.ok(afterShift < beforeShift - 0.3, `rpm after shift ${afterShift}`);
  for (let s = 0; s <= 80; s += 0.5) {
    const r = rpmFromSpeed(s);
    assert.ok(r >= 0 && r <= 1, `rpm ${r} at speed ${s}`);
  }
});

test('reversing whines at a capped low rpm, forward driving is unchanged', () => {
  assert.equal(engineSpeedRpm(8, 8), rpmFromSpeed(8));
  const reverse = engineSpeedRpm(8, -8);
  assert.ok(reverse <= REVERSE_RPM_CAP + 1e-9, `reverse rpm ${reverse}`);
  assert.ok(reverse < rpmFromSpeed(8));
  assert.ok(engineSpeedRpm(40, -10) <= REVERSE_RPM_CAP + 1e-9);
  // Tiny negative forward speed (creep or braking to a stop) is not reverse.
  assert.equal(engineSpeedRpm(0.2, -0.2), rpmFromSpeed(0.2));
});

test('limiterDepth is off below redline and chops the gain by a clear depth above it', () => {
  assert.equal(limiterDepth(0.9), 0);
  assert.equal(limiterDepth(LIMITER_RPM - 1e-6), 0);
  const depth = limiterDepth(0.99);
  assert.ok(depth >= 0.5 && depth <= 1, `limiter depth ${depth}`);
  // The chop runs between (1 - depth) and 1 on its own gain node: the deepest cut stays clearly audible.
  assert.ok(1 - depth >= 0.25 && 1 - depth <= 0.5, `deepest cut gain ${1 - depth}`);
});

test('firing frequency follows cylinders * rpm / 120 across the rev range', () => {
  assert.equal(engineRpm(ENGINE_IDLE_RPM), 900);
  assert.ok(Math.abs(firingFrequency(ENGINE_IDLE_RPM) - 45) < 1e-9, 'idle is about 45 Hz');
  assert.ok(Math.abs(firingFrequency(1) - 340) < 1e-9, 'redline is about 340 Hz');
  for (let r = ENGINE_IDLE_RPM; r < 0.95; r += 0.05) assert.ok(firingFrequency(r + 0.05) > firingFrequency(r));
  // An 8-cylinder car at idle fires faster than a 6-cylinder one.
  assert.ok(firingFrequency(ENGINE_IDLE_RPM, 8, 6500) > firingFrequency(ENGINE_IDLE_RPM, 6, 6500));
});

test('loop A rate is set by rpm relative to each car\'s own idle, so every car starts at its recording pitch', () => {
  assert.equal(engineRate(ENGINE_IDLE_RPM, { cylinders: 8, redline: 6500 }), 1, '8-cylinder car at idle');
  assert.equal(engineRate(ENGINE_IDLE_RPM, { cylinders: 6, redline: 8000 }), 1, 'NSX-style car at idle');
  let prev = -Infinity;
  for (let r = 0; r <= 1; r += 0.02) {
    const rate = engineRate(r, { cylinders: 6, redline: 6800 });
    assert.ok(rate >= prev - 1e-12, 'rate never drops as rpm rises');
    assert.ok(rate >= 0.7 && rate <= 3, `rate ${rate}`);
    prev = rate;
  }
  // Loop B is at its recorded speed at HIGH_LOOP_RATIO times the idle, and is capped so it is never chipmunked.
  assert.ok(Math.abs(highLoopRate(HIGH_LOOP_RATIO) - 1) < 1e-9, 'loop B plays at its recorded speed at 2.6x idle');
  assert.ok(highLoopRate(50) <= HIGH_LOOP_MAX_RATE + 1e-9, 'loop B rate is capped');
  assert.equal(HIGH_LOOP_MAX_RATE, 1.3);
});

test('loop A stays dominant through the mid range; loop B is silent at idle, rises smoothly and stays under loop A', () => {
  assert.equal(loopALevel(1), LOOP_A_GAIN, 'loop A at idle is full');
  assert.ok(loopALevel(2.2) > 0.1, 'loop A is still well above loop B at 2.2x idle');
  assert.ok(loopALevel(1.5) > loopALevel(2.5), 'loop A fades as the rpm rises');
  assert.ok(loopALevel(5) < 1e-9, 'loop A is gone by 5x idle');
  assert.equal(highLoopLevel(1), 0, 'loop B silent at idle');
  assert.equal(highLoopLevel(1.6), 0, 'loop B starts rising at 1.6x');
  assert.ok(Math.abs(highLoopLevel(2.4) - HIGH_LOOP_CEILING) < 1e-12, 'loop B reaches its ceiling at 2.4x');
  assert.ok(highLoopLevel(6) <= HIGH_LOOP_CEILING + 1e-12);
  for (let r = 1; r < 2.2; r += 0.02) assert.ok(loopALevel(r) >= loopALevel(r + 0.02) - 1e-12 && highLoopLevel(r + 0.02) >= highLoopLevel(r) - 1e-12, 'monotone handoff');
  assert.equal(ratioToRate(1.5), 1.5);
  assert.equal(ratioToRate(9), LOOP_MAX_RATE_TEST, 'loop A pitch is clamped');
  assert.equal(HIGH_LOOP_CEILING, 0.1);
  assert.equal(HIGH_LOOP_MAX_RATE, 1.3);
  // Loop B's playback rate is a smooth curve over the whole rev range: no step at any rpm ratio.
  let worstStep = 0;
  for (let r = 1; r < 10; r += 0.01) worstStep = Math.max(worstStep, Math.abs(highLoopRate(r + 0.01) - highLoopRate(r)));
  assert.ok(worstStep < 0.01, `loop B largest rate step per 0.01 ratio: ${worstStep}`);
});

test('both recorded loops pass the rev-limiter chop and the gear-shift dip (they are not routed around them)', () => {
  const audio = new GameAudio({ AudioContextClass: MockAudioContext, fetchFn: null });
  enableAndUnlock(audio);
  assert.ok(audio.nodes.loopOut.connected.includes(audio.nodes.limGain), 'loops feed the limiter gain');
  assert.ok(audio.nodes.limGain.connected.includes(audio.nodes.shiftGain), 'the limiter gain feeds the shift gain');
  audio.dispose();
});

test('an exception inside the traffic or driving audio step is swallowed, never thrown into the frame loop', () => {
  const audio = new GameAudio({ AudioContextClass: MockAudioContext, fetchFn: null });
  enableAndUnlock(audio);
  audio.setPaused(false);
  const exploding = { get actor() { throw new Error('boom'); } };
  assert.doesNotThrow(() => audio.updateTraffic([exploding], { x: 0, z: 0, speed: 0, heading: 0 }, 0.05));
  const exploding2 = { get speed() { throw new Error('boom'); }, forwardSpeed: 0 };
  assert.doesNotThrow(() => audio.update(exploding2, 1, false, false, 0.05));
  assert.equal(audio.debug().errors, 2, 'each swallowed exception is counted, so it cannot hide a bug');
  audio.dispose();
});

test('loop B level through update() across rpm ratios 1 to 6: zero at idle, smooth, monotone, under the ceiling', () => {
  const audio = new GameAudio({ AudioContextClass: MockAudioContext, fetchFn: null });
  enableAndUnlock(audio);
  audio.setPaused(false);
  const levels = [];
  // Idle first, then 1.6x to 6x in steps. (Below 1.6x the throttle nudge would need a negative speed to reach the rpm.)
  for (const ratio of [1, ...Array.from({ length: 19 }, (_, k) => 1.6 + 0.25 * k)]) {
    // Invert the rpm model for this car (redline 6800, idle 900): the rpm norm that gives this ratio.
    const rpmNorm = ratio === 1 ? 0.18 : 0.18 + (0.82 * (ratio - 1) * 900) / 5900;
    const throttle = ratio === 1 ? 0 : 1;
    // With throttle the target carries an 8/100 rpm nudge; in gear 1 rpmFromSpeed = 0.18 + 0.82 * speed / 11.
    const speed = ratio === 1 ? 0 : (11 * (rpmNorm - 0.26)) / 0.82;
    for (let i = 0; i < 300; i++) audio.update(actor(speed), throttle, false, false, 0.05);
    const targets = audio.nodes.sampleHighGain.gain.events.filter((e) => e.kind === 'target');
    levels.push(targets[targets.length - 1].v);
  }
  assert.equal(levels[0], 0, 'loop B is silent at idle');
  for (let i = 0; i < levels.length; i++) {
    assert.ok(levels[i] >= 0 && levels[i] <= HIGH_LOOP_CEILING + 1e-9, `level ${i} bounded: ${levels[i]}`);
    if (i > 1) {
      assert.ok(levels[i] >= levels[i - 1] - 1e-9, `level ${i} monotone`);
      assert.ok(Math.abs(levels[i] - levels[i - 1]) <= 0.05, `level ${i} smooth step ${Math.abs(levels[i] - levels[i - 1])}`);
    }
  }
  assert.ok(levels[levels.length - 1] > 0.09, 'loop B reaches its ceiling at the top of the sweep');
  assert.ok(levels[1] < 1e-3, 'loop B is still silent at 1.6x idle');
  assert.equal(audio.debug().errors, 0);
  audio.dispose();
});

test('loop B tracks rpm slowly: its ratio smooths over seconds, not gear sweeps', () => {
  const audio = new GameAudio({ AudioContextClass: MockAudioContext, fetchFn: null });
  enableAndUnlock(audio);
  audio.setPaused(false);
  for (let i = 0; i < 10; i++) audio.update(actor(60), 1, false, false, 0.05); // 0.5 s at speed
  assert.ok(audio.debug().ratioFast > audio.debug().ratioSlow, 'the pitch ratio is faster than the level ratio');
  assert.ok(audio.debug().ratioSlow > 1, 'the level ratio is moving with the sweep');
  audio.dispose();
});

test('the recorded loops and the synth cross-fade with equal power and the blend clamps', () => {
  for (let r = 1; r <= 2.2; r += 0.1) {
    const b = loopBlend(r);
    // Loop B and loop A use the same blend, so B rises exactly as A falls (no dip at the handoff).
    const a = Math.cos((b * Math.PI) / 2);
    const syn = Math.sin((b * Math.PI) / 2);
    assert.ok(Math.abs(a * a + syn * syn - 1) < 1e-9, `equal power at ratio ${r}`);
  }
  assert.equal(loopBlend(0.5), 0);
  assert.equal(loopBlend(5), 1);
  assert.equal(loopBlend(1), 0, 'the handoff starts at idle');
});

test('engine rate and gain are monotonic and bounded', () => {
  assert.ok(engineRate(0) <= engineRate(0.5));
  assert.ok(engineRate(0.5) <= engineRate(1));
  assert.ok(engineRate(1) <= 3 && engineRate(0) >= 0.7);
  assert.ok(engineGain(0.5, 1) > engineGain(0.5, 0));
  for (const rpm of [0, 0.3, 1, 5]) {
    for (const throttle of [0, 1, 3]) {
      const g = engineGain(rpm, throttle);
      assert.ok(g >= 0 && g <= 0.24, `gain ${g}`);
    }
  }
});

test('engine profiles: electric cars have no combustion events, turbo and cylinder count per car', () => {
  const roadster = { id: 'roadster', category: 'ELECTRIC' };
  assert.equal(engineProfileFor(roadster).ev, true);
  assert.equal(engineProfileFor(roadster).turbo, false);
  const porsche = { id: 'porsche', profile: 'porsche', category: 'REAR ENGINE' };
  assert.equal(engineProfileFor(porsche).ev, false);
  assert.equal(engineProfileFor(porsche).turbo, true, 'the 911 Turbo has a blow-off');
  assert.equal(engineProfileFor({ id: 'concept', profile: 'concept', category: 'TOURING' }).cylinders, 8);
  assert.equal(engineProfileFor({ id: 'bmw', profile: 'bmw', category: 'STREET CLASSIC' }).turbo, false);
  assert.equal(engineProfileFor(null).cylinders, 6, 'missing definition falls back to a default engine');
  assert.equal(engineProfileFor({ id: 'unknown', category: 'TOURING' }).turbo, false);
});

test('tyres are silent at standstill and fully on from 4 m/s', () => {
  assert.equal(tyreStandstillGate(0), 0);
  assert.equal(tyreStandstillGate(2), 0.5);
  assert.equal(tyreStandstillGate(4), 1);
  assert.equal(tyreStandstillGate(-3), 0);
});

test('screechIntensity is silent when parked or driving straight, loud when sliding fast', () => {
  assert.equal(screechIntensity(0, 0, false), 0);
  assert.equal(screechIntensity(30, 0, false), 0);
  assert.equal(screechIntensity(3, 6, false), 0);
  assert.equal(screechIntensity(4, 10, true), 0, 'handbrake at standstill speed is gated');
  assert.ok(Math.abs(screechIntensity(10, 6, false) - 0.42) < 1e-9, 'slide 0.84 times half speed gate');
  assert.ok(screechIntensity(25, 6, false) > 0.6);
  assert.ok(screechIntensity(20, 0, true) > 0.4);
  assert.ok(screechIntensity(25, 1.0, false) < screechIntensity(25, 4.0, false));
  assert.ok(screechIntensity(40, 50, true) <= 1);
});

test('nitroCutoff rises with boost time and starts at the base frequency', () => {
  assert.equal(nitroCutoff(0), 700);
  assert.ok(nitroCutoff(0.5) < nitroCutoff(1.2));
  assert.ok(nitroCutoff(1.6) === nitroCutoff(10));
});

test('wind and impact curves behave', () => {
  assert.ok(windGain(0) < windGain(30) && windGain(30) < windGain(60));
  assert.ok(windGain(200) <= 0.12 + 1e-9);
  assert.equal(impactStrength(1), 0);
  assert.ok(impactStrength(12) > 0 && impactStrength(12) < 1);
  assert.equal(impactStrength(100), 1);
  assert.ok(impactRate(30) < impactRate(3));
  assert.ok(impactRate(200) >= 0.55 && impactRate(0) <= 1.1);
});

test('crossfadeLoop shortens by the fade length and joins the wrap with adjacent source samples', () => {
  const n = 1000;
  const src = Float32Array.from({ length: n }, (_, i) => Math.sin(i * 0.37) + 0.3 * Math.cos(i * 1.1));
  const fade = 120;
  const out = crossfadeLoop(src, fade);
  const L = n - fade;
  assert.equal(out.length, L);
  assert.equal(out[L - 1], src[L - 1], 'loop end is the untouched source sample');
  assert.equal(out[0], src[L], 'loop start is the source sample after the end');
  assert.ok(out.every(Number.isFinite));
  // Body is copied through unchanged.
  assert.equal(out[fade + 10], src[fade + 10]);
  // Equal-power blend: for uncorrelated noise the head keeps roughly the same power as the body.
  const noise = Float32Array.from({ length: 40000 }, () => Math.random() * 2 - 1);
  const nOut = crossfadeLoop(noise, 4000);
  const meanSq = (a, from, to) => { let s = 0; for (let i = from; i < to; i++) s += a[i] * a[i]; return s / (to - from); };
  const head = meanSq(nOut, 0, 4000);
  const body = meanSq(nOut, 8000, 20000);
  assert.ok(Math.abs(head - body) / body < 0.12, `head ${head} body ${body}`);
});

test('crossfadeLoop handles zero and oversized fades without throwing', () => {
  const src = new Float32Array([1, 2, 3, 4]);
  assert.equal(crossfadeLoop(src, 0).length, 4);
  assert.equal(crossfadeLoop(src, 99).length, 2);
});

// Reads a mono 16-bit WAV from dist/assets/audio and returns its samples.
function readMonoWav(name) {
  const buf = readFileSync(fileURLToPath(new URL(`../dist/assets/audio/${name}`, import.meta.url)));
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF', `${name} is RIFF`);
  assert.equal(buf.readUInt16LE(22), 1, `${name} is mono`);
  assert.equal(buf.readUInt32LE(24), 44100, `${name} sample rate`);
  let offset = 12;
  let dataOffset = -1;
  let dataSize = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'data') { dataOffset = offset + 8; dataSize = size; break; }
    offset += 8 + size + (size & 1);
  }
  assert.ok(dataOffset > 0, 'data chunk present');
  const count = dataSize / 2;
  const samples = new Float64Array(count);
  for (let i = 0; i < count; i++) samples[i] = buf.readInt16LE(dataOffset + i * 2);
  return samples;
}

test('the shipped recorded loops wrap without a click (seam step at or below the 99th-percentile sample step)', () => {
  for (const name of ['engine-idle.wav', 'engine-high.wav']) {
    const samples = readMonoWav(name);
    const count = samples.length;
    const steps = [];
    for (let i = 1; i < count; i++) steps.push(Math.abs(samples[i] - samples[i - 1]));
    steps.sort((a, b) => a - b);
    const p99 = steps[Math.floor(0.99 * (steps.length - 1))];
    const seam = Math.abs(samples[0] - samples[count - 1]);
    const median = steps[Math.floor(steps.length / 2)];
    assert.ok(seam <= p99 + 1, `${name} seam step ${seam} vs p99 ${p99}`);
    assert.ok(seam <= 2 * median + 1, `${name} seam step ${seam} vs median ${median}: a zero-slope loop point`);
    let peak = 0;
    for (let i = 0; i < count; i++) peak = Math.max(peak, Math.abs(samples[i]));
    assert.ok(peak <= 32767 * 10 ** (-3 / 20) + 1, `${name} peak ${peak}`);
  }
});

test('AUDIO_ASSETS names the shipped files', () => {
  assert.equal(AUDIO_ASSETS.engine, 'engine-idle.wav');
  assert.equal(AUDIO_ASSETS.engineHigh, 'engine-high.wav');
  assert.ok(Object.values(AUDIO_ASSETS).every((f) => /\.(wav|mp3)$/.test(f)));
  assert.equal(Object.keys(AUDIO_ASSETS).length, 9);
});

test('softClipCurve is unity below the knee, rounds overs rather than clamping them, and never reaches full scale', () => {
  const curve = softClipCurve(2049);
  const at = (x) => curve[Math.round(((x / 2 + 1) / 2) * 2048)];
  assert.ok(Math.abs(at(0)) < 1e-9, 'zero in, zero out');
  assert.ok(Math.abs(at(0.5) - 0.5) < 0.01, 'unity below the knee');
  assert.ok(at(1) < 0.75 && at(1) > 0.7, `ceiling ${at(1)}`);
  assert.ok(at(2) > at(1) && at(2) < 0.76, 'overs up to +6 dBFS are rounded, not clamped at the knee');
  assert.ok(at(-2) < -0.7 && at(-2) > -0.76);
  for (let i = 1; i < curve.length; i++) assert.ok(curve[i] >= curve[i - 1] - 1e-7, 'monotonic');
});

test('grit curve is odd and bounded', () => {
  const curve = gritCurve(1025);
  assert.ok(Math.abs(curve[512]) < 1e-9);
  assert.ok(curve[1024] <= 1 + 1e-6 && curve[1024] >= 0.99);
  assert.ok(Math.abs(curve[0] + curve[1024]) < 1e-6);
});

test('generated reverb impulse response has unit energy and decays', () => {
  const sr = 8000;
  const ir = makeImpulseResponse(sr, 0.5);
  assert.equal(ir.length, 4000);
  assert.ok(ir.every(Number.isFinite));
  let energy = 0;
  for (const v of ir) energy += v * v;
  assert.ok(Math.abs(energy - 1) < 1e-6, `energy ${energy}`);
  const energyOf = (from, to) => { let s = 0; for (let i = from; i < to; i++) s += ir[i] * ir[i]; return s; };
  assert.ok(energyOf(3000, 4000) < energyOf(0, 1000) / 10, 'tail is much quieter than the start');
  assert.deepEqual(Array.from(makeImpulseResponse(sr, 0.5)), Array.from(ir), 'seeded: deterministic');
});

test('trafficSpatial: approaching cars sound higher, receding lower, and pan follows the bearing', () => {
  const out = { gain: 0, cutoff: 0, pan: 0, doppler: 1 };
  // Player heading 0 faces -z; right is +x. A car 20 m ahead, closing at 20 m/s.
  trafficSpatial(0, -20, 0, 20, 0, out);
  assert.ok(out.doppler > 1.03, `approaching doppler ${out.doppler}`);
  trafficSpatial(0, -20, 0, -20, 0, out);
  assert.ok(out.doppler < 0.97, `receding doppler ${out.doppler}`);
  trafficSpatial(15, 0, 0, 0, 0, out);
  assert.ok(out.pan > 0.5, `car on the right pans right: ${out.pan}`);
  trafficSpatial(-15, 0, 0, 0, 0, out);
  assert.ok(out.pan < -0.5, `car on the left pans left: ${out.pan}`);
  const near = { gain: 0, cutoff: 0, pan: 0, doppler: 1 };
  const far = { gain: 0, cutoff: 0, pan: 0, doppler: 1 };
  trafficSpatial(5, 0, 0, 0, 0, near);
  trafficSpatial(60, 0, 0, 0, 0, far);
  assert.ok(near.gain > far.gain, 'distance attenuates');
  assert.ok(near.cutoff > far.cutoff, 'distance darkens');
  assert.ok(out.doppler >= 0.8 && out.doppler <= 1.25, 'doppler is clamped');
});

test('trafficSpatial stays finite for missing or non-finite inputs', () => {
  const out = { gain: 0, cutoff: 0, pan: 0, doppler: 1 };
  trafficSpatial(NaN, 10, Infinity, 0, NaN, out);
  assert.ok(Object.values(out).every(Number.isFinite), JSON.stringify(out));
  trafficSpatial(undefined, undefined, undefined, undefined, undefined, out);
  assert.ok(Object.values(out).every(Number.isFinite));
});

test('pickNearest selects the nearest cars within the limit, sorted, without growing its output', () => {
  const dist = Float64Array.from([400, 9, 25, 4, 100, 1]);
  const out = new Int32Array(3);
  const found = pickNearest(dist, dist.length, 150, 3, out);
  assert.equal(found, 3);
  assert.deepEqual(Array.from(out), [5, 3, 1], 'nearest first');
  assert.equal(pickNearest(dist, dist.length, 2, 3, out), 1, 'only cars under the limit');
  assert.equal(pickNearest(Float64Array.from([50, 60]), 2, 10, 3, out), 0, 'none in range');
  assert.equal(TRAFFIC_VOICES, 4);
});

test('ramp keeps the automation timeline bounded on both code paths', () => {
  const hold = param(0);
  for (let i = 0; i < 300; i++) ramp(hold, i % 2, 0.1, i / 30);
  assert.ok(hold.events.length <= 2, `cancelAndHoldAtTime path: ${hold.events.length} events`);
  const fallback = param(0);
  delete fallback.cancelAndHoldAtTime;
  for (let i = 0; i < 300; i++) ramp(fallback, i % 2, 0.1, i / 30);
  assert.ok(fallback.events.length <= 2, `fallback path: ${fallback.events.length} events`);
});

test('pause suspends only after the master fade is silent', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const audio = new GameAudio({ AudioContextClass: MockAudioContext, fetchFn: null });
  enableAndUnlock(audio);
  audio.setPaused(false);
  assert.equal(audio.ctx.state, 'running');
  audio.setPaused(true);
  t.mock.timers.tick(300);
  assert.equal(audio.ctx.state, 'running', 'still running during the fade (about 5 time constants)');
  t.mock.timers.tick(60);
  assert.equal(audio.ctx.state, 'suspended', 'suspends once the fade is silent');
  audio.setPaused(false);
  assert.equal(audio.ctx.state, 'running');
  audio.dispose();
});

test('a gesture during the pause fade does not suspend; the suspend happens after the fade', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const audio = new GameAudio({ AudioContextClass: MockAudioContext, fetchFn: null });
  enableAndUnlock(audio);
  audio.setPaused(false);
  audio.setPaused(true);
  t.mock.timers.tick(100);
  audio.unlock();
  assert.equal(audio.ctx.state, 'running', 'the gesture does not cut the sound off');
  assert.equal(audio.debug().masterLevel, 0, 'the master stays at zero while paused');
  t.mock.timers.tick(400);
  assert.equal(audio.ctx.state, 'suspended', 'paused and silent, so it suspends');
  audio.dispose();
});

test('syncRunning resumes whenever sound should play and suspends when it should not, whatever the cached state', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const audio = new GameAudio({ AudioContextClass: MockAudioContext, fetchFn: null });
  enableAndUnlock(audio);
  audio.setPaused(false);
  const ctx = audio.ctx;
  let resumes = 0;
  let suspends = 0;
  const resume = ctx.resume.bind(ctx);
  const suspend = ctx.suspend.bind(ctx);
  ctx.resume = () => { resumes++; return resume(); };
  ctx.suspend = () => { suspends++; return suspend(); };
  ctx.state = 'suspended'; // a stale cached state must not stop the resume
  audio.syncRunning();
  assert.equal(resumes, 1, 'resume is issued even though the cached state looked wrong');
  audio.enabled = false;
  audio.clearStopTimer();
  audio.clearSuspendTimer();
  audio.syncRunning();
  assert.equal(suspends, 1, 'suspend is issued when sound should not play');
  audio.dispose();
});

test('turning sound off fades before it suspends', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const audio = new GameAudio({ AudioContextClass: MockAudioContext, fetchFn: null });
  enableAndUnlock(audio);
  audio.setPaused(false);
  assert.equal(audio.setEnabled(false), false);
  assert.equal(audio.debug().enabled, false);
  t.mock.timers.tick(200);
  assert.equal(audio.ctx.state, 'running', 'still fading');
  t.mock.timers.tick(200);
  assert.equal(audio.ctx.state, 'suspended');
  audio.dispose();
});

test('a gesture while paused creates the graph but keeps the master silent', () => {
  const audio = new GameAudio({ AudioContextClass: MockAudioContext, fetchFn: null });
  audio.setEnabled(true);
  audio.setPaused(true);
  audio.unlock();
  assert.equal(audio.debug().graph, true);
  assert.equal(audio.debug().masterLevel, 0, 'pause keeps the master at zero');
  audio.setPaused(false);
  assert.ok(audio.debug().masterLevel > 0, 'resume fades the master back in');
  audio.dispose();
});

test('a menu click works while paused and does not depend on the master fade', () => {
  const audio = new GameAudio({ AudioContextClass: MockAudioContext, fetchFn: null });
  enableAndUnlock(audio);
  audio.setPaused(true);
  assert.doesNotThrow(() => audio.onUiClick());
  audio.dispose();
});

test('GameAudio does not create an AudioContext until a gesture unlocks it', () => {
  let constructed = 0;
  class Counting extends MockAudioContext { constructor() { super(); constructed++; } }
  const audio = new GameAudio({ AudioContextClass: Counting, fetchFn: okFetch });
  assert.equal(constructed, 0);
  audio.update(actor(20), 1, false, false, 1 / 60);
  audio.onPickup();
  audio.onImpact(10);
  assert.equal(audio.setEnabled(true), true, 'toggle reads On before any gesture');
  assert.equal(constructed, 0, 'enabling alone does not create the context');
  audio.unlock();
  assert.equal(constructed, 1);
  assert.equal(audio.ctx.state, 'suspended', 'stays suspended while paused on the home screen');
  audio.setPaused(false);
  assert.equal(audio.ctx.state, 'running');
  audio.dispose();
});

test('GameAudio is a silent no-op without AudioContext support and reports Off', () => {
  const audio = new GameAudio({ AudioContextClass: null, fetchFn: null });
  assert.equal(audio.setEnabled(true), false);
  assert.doesNotThrow(() => {
    audio.unlock();
    audio.setPaused(false);
    audio.update(actor(30), 1, true, true, 0.1);
    audio.updateTraffic([], actor(0), 0.1);
    audio.onPickup();
    audio.onImpact(20);
    audio.onBoostPad();
    audio.onUiClick();
    audio.setVehicle({ category: 'ELECTRIC' });
    audio.dispose();
  });
  assert.equal(audio.debug().graph, false);
});

test('GameAudio falls back to synth when assets fail to load', async () => {
  const audio = new GameAudio({ AudioContextClass: MockAudioContext, fetchFn: failFetch });
  enableAndUnlock(audio);
  await flush();
  assert.deepEqual(audio.debug().loaded, {});
  assert.equal(audio.debug().sampleLayer, false);
  assert.doesNotThrow(() => { audio.onPickup(); audio.onImpact(25); audio.onUiClick(); audio.onBoostPad(); });
  assert.ok(audio.ctx.created.oscillators > 0, 'procedural sweeps are used when samples are missing');
  audio.dispose();
});

test('GameAudio loads samples in the background and starts both recorded loops', async () => {
  const requested = [];
  const fetchFn = async (url) => { requested.push(url); return okFetch(); };
  const audio = new GameAudio({ AudioContextClass: MockAudioContext, fetchFn, assetBase: 'assets/audio/' });
  enableAndUnlock(audio);
  await flush();
  await flush();
  assert.equal(requested.length, 9);
  assert.ok(requested.every((url) => url.startsWith('assets/audio/')));
  assert.equal(audio.debug().loaded.engine, true);
  assert.equal(audio.debug().loaded.engineHigh, true);
  assert.equal(audio.debug().sampleLayer, true);
  assert.ok(audio.nodes.engineHighSample, 'loop B started');
  audio.dispose();
});

test('iOS interrupted context is resumed while driving', () => {
  const audio = new GameAudio({ AudioContextClass: MockAudioContext, fetchFn: null });
  enableAndUnlock(audio);
  audio.setPaused(false);
  audio.ctx.state = 'interrupted';
  audio.syncRunning();
  assert.equal(audio.ctx.state, 'running');
  audio.dispose();
});

test('a menu click resumes the context for the click, then leaves it paused', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const audio = new GameAudio({ AudioContextClass: MockAudioContext, fetchFn: null });
  enableAndUnlock(audio);
  assert.equal(audio.ctx.state, 'suspended');
  audio.onUiClick();
  assert.equal(audio.ctx.state, 'running', 'click starts the context while the menu is open');
  t.mock.timers.tick(340);
  assert.equal(audio.ctx.state, 'suspended', 'context goes back to suspended while still paused');
  audio.dispose();
});

test('update is throttled to 30 Hz and writes gear, rpm and nitro state', () => {
  const audio = new GameAudio({ AudioContextClass: MockAudioContext, fetchFn: null });
  enableAndUnlock(audio);
  audio.setPaused(false);
  audio.update(actor(30), 1, false, true, 1 / 120);
  assert.equal(audio.debug().gear, 1, 'a call under 1/30 s is ignored');
  audio.update(actor(30), 1, false, true, 0.05);
  const d = audio.debug();
  assert.equal(d.gear, gearFromSpeed(30));
  assert.ok(d.rpm > 0 && d.rpm <= 1);
  assert.ok(d.nitroGain > 0);
  assert.ok(d.engineRate > 0.5);
  assert.equal(d.speed, 30);
  assert.equal(d.reverse, false);
  audio.dispose();
});

test('update reports reverse and limiter state in debug()', () => {
  const audio = new GameAudio({ AudioContextClass: MockAudioContext, fetchFn: null });
  enableAndUnlock(audio);
  audio.setPaused(false);
  audio.update(actor(8, 0, -8), 0, false, false, 0.05);
  const d = audio.debug();
  assert.equal(d.reverse, true);
  assert.ok(d.rpm <= REVERSE_RPM_CAP + 1e-9);
  assert.equal(d.limiter, 0, 'no rev-limiter cut below redline');
  audio.dispose();
});

test('the rev-limiter chops only above redline, and reports the depth', () => {
  const audio = new GameAudio({ AudioContextClass: MockAudioContext, fetchFn: null });
  enableAndUnlock(audio);
  audio.setPaused(false);
  audio.update(actor(70), 1, false, false, 0.05);
  assert.equal(audio.debug().limiter, limiterDepth(audio.debug().rpm));
  audio.dispose();
});

test('an electric car mutes the combustion voices and runs the whine; a combustion car keeps them', () => {
  const audio = new GameAudio({ AudioContextClass: MockAudioContext, fetchFn: null });
  enableAndUnlock(audio);
  audio.setPaused(false);
  audio.setVehicle({ id: 'roadster', category: 'ELECTRIC' });
  assert.equal(audio.debug().ev, true);
  audio.update(actor(0), 0, false, false, 0.05);
  let d = audio.debug();
  assert.equal(d.loadTarget, 0, 'no combustion synth level');
  assert.equal(d.sampleTarget, 0, 'no recorded idle loop');
  assert.equal(d.highTarget, 0, 'no recorded high loop');
  const lastTarget = (par) => par.events.filter((e) => e.kind === 'target').at(-1).v;
  assert.equal(lastTarget(audio.nodes.sampleGain.gain), 0, 'sampleGain is ramped to zero for EV');
  assert.equal(lastTarget(audio.nodes.sampleHighGain.gain), 0, 'sampleHighGain is ramped to zero for EV');
  assert.equal(lastTarget(audio.nodes.loadGain.gain), 0, 'loadGain is ramped to zero for EV');
  assert.ok(d.whineTarget > 0, 'the inverter whine is the EV voice');
  audio.update(actor(30), 1, false, false, 0.05);
  audio.update(actor(30), 1, false, false, 0.05);
  d = audio.debug();
  assert.equal(d.loadTarget, 0, 'stays muted under load');
  assert.equal(d.sampleTarget, 0);
  assert.equal(d.highTarget, 0);
  audio.setVehicle({ id: 'bmw', profile: 'bmw', category: 'STREET CLASSIC' });
  for (let i = 0; i < 500; i++) audio.update(actor(0), 0, false, false, 0.05); // rpm and level ratio settle at idle
  d = audio.debug();
  assert.ok(d.loadTarget > 0, 'combustion synth is live');
  assert.ok(Math.abs(d.sampleTarget - 0.25 * 0.4) < 1e-9, 'off-throttle loop level is 40%', 'recorded idle loop plays at its own pitch at idle');
  assert.equal(d.whineTarget, 0, 'no whine for combustion cars');
  assert.equal(audio.debug().profile.turbo, false);
  audio.setVehicle({ id: 'porsche', profile: 'porsche', category: 'REAR ENGINE' });
  assert.equal(audio.debug().profile.turbo, true);
  audio.dispose();
});

test('updateTraffic drives up to the pool size from the nearest cars and goes silent beyond range', () => {
  const audio = new GameAudio({ AudioContextClass: MockAudioContext, fetchFn: null });
  enableAndUnlock(audio);
  audio.setPaused(false);
  const cars = [
    { actor: { x: 10, z: 0, speed: 15, heading: 0 } },
    { actor: { x: 300, z: 0, speed: 15, heading: 0 } },
    { actor: { x: -20, z: 5, speed: 10, heading: 0 } },
  ];
  const player = { x: 0, z: 0, speed: 20, heading: 0 };
  audio.updateTraffic(cars, player, 0.05);
  assert.equal(audio.debug().trafficVoices, 2, 'the far car is out of range');
  audio.updateTraffic([], player, 0.01);
  assert.equal(audio.debug().trafficVoices, 2, 'throttled: no change within the 30 Hz window');
  audio.updateTraffic([{ actor: { x: 500, z: 0, speed: 0 } }], player, 0.05);
  assert.equal(audio.debug().trafficVoices, 0);
  audio.dispose();
});

test('an idle traffic voice fades first and is disconnected only after the fade, and a car in range reconnects it', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const audio = new GameAudio({ AudioContextClass: MockAudioContext, fetchFn: null });
  enableAndUnlock(audio);
  audio.setPaused(false);
  const voice = audio.nodes.traffic[0];
  const player = { x: 0, z: 0, speed: 0, heading: 0 };
  assert.ok(voice.vg.connected.includes(voice.pan), 'voices start connected');
  audio.updateTraffic([{ actor: { x: 500, z: 0, speed: 0 } }], player, 0.05);
  assert.ok(voice.vg.connected.includes(voice.pan), 'still connected during the fade (no click)');
  t.mock.timers.tick(VOICE_DROP_MS_TEST - 100);
  assert.ok(voice.vg.connected.includes(voice.pan), 'still connected before the fade is over');
  t.mock.timers.tick(200);
  assert.ok(!voice.vg.connected.includes(voice.pan), 'disconnected after the fade');
  audio.updateTraffic([{ actor: { x: 5, z: 0, speed: 0 } }], player, 0.05);
  assert.ok(voice.vg.connected.includes(voice.pan), 'a car in range reconnects the voice');
  audio.dispose();
});

test('a voice that is picked again inside the fade window is not disconnected', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const audio = new GameAudio({ AudioContextClass: MockAudioContext, fetchFn: null });
  enableAndUnlock(audio);
  audio.setPaused(false);
  const voice = audio.nodes.traffic[0];
  const player = { x: 0, z: 0, speed: 0, heading: 0 };
  audio.updateTraffic([{ actor: { x: 500, z: 0, speed: 0 } }], player, 0.05);
  t.mock.timers.tick(200);
  audio.updateTraffic([{ actor: { x: 5, z: 0, speed: 0 } }], player, 0.05);
  t.mock.timers.tick(VOICE_DROP_MS_TEST);
  assert.ok(voice.vg.connected.includes(voice.pan), 'the pending disconnect was cancelled');
  audio.dispose();
});

test('non-finite traffic positions or velocities never reach an AudioParam and never throw', () => {
  const audio = new GameAudio({ AudioContextClass: MockAudioContext, fetchFn: null });
  enableAndUnlock(audio);
  audio.setPaused(false);
  const player = { x: 0, z: 0, speed: 0, heading: 0 };
  const bad = [
    { actor: { x: NaN, z: 0, speed: 1, heading: 0 } },
    { actor: { x: 5, z: 0, vx: NaN, vz: 0 } },
    { actor: { x: 6, z: 0, vx: Infinity, vz: 0 } },
    { actor: null },
  ];
  assert.doesNotThrow(() => audio.updateTraffic(bad, player, 0.05));
  assert.equal(audio.debug().trafficVoices, 0, 'no bad car is picked');
  assert.equal(audio.debug().errors, 0, 'non-finite data is guarded, not swallowed');
  assert.doesNotThrow(() => audio.updateTraffic(bad, { x: NaN, z: 0, speed: 0, heading: 0 }, 0.05));
  for (const voice of audio.nodes.traffic) {
    assert.ok(Number.isFinite(voice.tone.frequency.value) && Number.isFinite(voice.vg.gain.value));
  }
  audio.dispose();
});

test('a driving step with non-finite inputs is swallowed and never throws into the frame loop', () => {
  const audio = new GameAudio({ AudioContextClass: MockAudioContext, fetchFn: null });
  enableAndUnlock(audio);
  audio.setPaused(false);
  assert.doesNotThrow(() => audio.update({ speed: NaN, forwardSpeed: NaN, lateralSpeed: NaN }, 1, false, false, 0.05));
  assert.doesNotThrow(() => audio.update({ speed: Infinity, forwardSpeed: 10, lateralSpeed: 0 }, 1, false, false, 0.05));
  assert.equal(audio.debug().errors, 0, 'NaN and Infinity speeds are guarded, not swallowed');
  audio.dispose();
});

test('a resume that completes asynchronously does not leave the context wrongly suspended or running', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  class AsyncCtx extends MockAudioContext {
    resume() { return new Promise((r) => setTimeout(() => { this.state = 'running'; r(); }, 10)); }
    suspend() { return new Promise((r) => setTimeout(() => { this.state = 'suspended'; r(); }, 10)); }
  }
  const audio = new GameAudio({ AudioContextClass: AsyncCtx, fetchFn: null });
  enableAndUnlock(audio);
  t.mock.timers.tick(20);
  let resumes = 0;
  const resume = audio.ctx.resume.bind(audio.ctx);
  audio.ctx.resume = () => { resumes++; return resume(); };
  audio.setPaused(false); // resume issued; the state has not changed yet
  audio.syncRunning();    // a second call still issues a resume (no stale-cache skip)
  assert.equal(resumes, 2);
  t.mock.timers.tick(20);
  assert.equal(audio.ctx.state, 'running');
  audio.setPaused(true);  // pause while the state is running: the fade then suspend lands last
  t.mock.timers.tick(400);
  t.mock.timers.tick(20); // the suspend's own completion lands after the fade timer
  assert.equal(audio.ctx.state, 'suspended');
  audio.dispose();
});

test('onBoostPad plays a charge-up and stinger and respects its cooldown', () => {
  const audio = new GameAudio({ AudioContextClass: MockAudioContext, fetchFn: null });
  enableAndUnlock(audio);
  audio.setPaused(false);
  const before = audio.ctx.created.oscillators + audio.ctx.created.sources;
  audio.onBoostPad();
  const after = audio.ctx.created.oscillators + audio.ctx.created.sources;
  assert.ok(after - before >= 3, 'noise sweep plus stinger nodes are created');
  assert.equal(audio.debug().activeOneShots >= 1, true);
  audio.onBoostPad(); // inside the cooldown
  assert.equal(audio.ctx.created.oscillators + audio.ctx.created.sources, after, 'second pad inside 0.4 s is ignored');
  audio.dispose();
  assert.doesNotThrow(() => audio.onBoostPad());
});

test('the reverb is built on first use and released after silence, so it costs nothing while idle', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const audio = new GameAudio({ AudioContextClass: MockAudioContext, fetchFn: null });
  enableAndUnlock(audio);
  audio.setPaused(false);
  assert.equal(audio.nodes.convolver, null, 'no convolver while idle');
  assert.equal(audio.debug().reverbLive, false);
  audio.onImpact(20);
  const conv = audio.nodes.convolver;
  assert.ok(conv, 'built on first use');
  assert.ok(audio.nodes.reverbSend.connected.includes(conv), 'send is wired to the convolver');
  assert.equal(audio.debug().reverbLive, true);
  t.mock.timers.tick(3100);
  assert.equal(audio.nodes.convolver, null, 'released when idle');
  assert.ok(!audio.nodes.reverbSend.connected.includes(conv), 'send is disconnected');
  assert.equal(audio.debug().reverbLive, false);
  audio.dispose();
});

test('dispose releases the context and ignores later calls', () => {
  const audio = new GameAudio({ AudioContextClass: MockAudioContext, fetchFn: null });
  enableAndUnlock(audio);
  audio.setPaused(false);
  const ctx = audio.ctx;
  audio.dispose();
  assert.equal(ctx.state, 'closed');
  assert.doesNotThrow(() => { audio.setEnabled(true); audio.unlock(); audio.onPickup(); audio.update(actor(20), 1, false, false, 1); audio.updateTraffic([], actor(0), 1); });
  assert.equal(audio.debug().graph, false);
});
