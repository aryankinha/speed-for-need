// Game audio: procedural engine / tyre / wind / nitro layers mixed with small CC0 samples.
// The AudioContext is created and resumed only after a user gesture. Missing or failed
// asset loads fall back to procedural synthesis; nothing here throws into the game loop.
//
// Samples (see dist/CREDITS.md, "Audio"): Kenney Impact Sounds, Digital Audio, Interface Sounds (CC0),
// and a racing-car engine loop by domasx2 on OpenGameArt (CC0, trimmed and crossfaded here).

export const GEAR_TOPS = [11, 21, 32, 44, 57, 72]; // upper speed (m/s) of gears 1..6; boost reaches ~69 m/s
export const ENGINE_IDLE_RPM = 0.18;
export const REVERSE_RPM_CAP = 0.45;
export const LIMITER_RPM = 0.95;
const SHIFT_FLOOR_RPM = 0.5; // rpm after an upshift, normalised 0..1
const UPDATE_INTERVAL = 1 / 30; // AudioParam writes are throttled to 30 Hz
const MASTER_LEVEL = 0.9;
const LOOP_FADE_SECONDS = 0.2; // equal-power crossfade length for generated noise loops
const GESTURE_EVENTS = ['pointerdown', 'keydown', 'touchend'];

export const AUDIO_ASSETS = {
  engine: 'engine-loop.wav',
  impactHeavy: 'impact-heavy.mp3',
  impactLight: 'impact-light.mp3',
  pickupChime: 'pickup-chime.mp3',
  pickupClink: 'pickup-clink.mp3',
  uiClick: 'ui-click.mp3',
};

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

// Mild rev-limiter feel: near redline the engine gain flutters between 60% and 100%.
export function limiterGain(rpm, time) {
  if (!(rpm >= LIMITER_RPM)) return 1;
  const flutter = 0.5 + 0.5 * Math.cos(2 * Math.PI * 7 * (Number.isFinite(time) ? time : 0));
  return 0.6 + 0.4 * flutter;
}

// Sample playback rate for the engine loop (higher rpm = higher pitch).
export function engineRate(rpm) {
  return clamp(0.62 + 1.5 * clamp(rpm, 0, 1), 0.5, 2.2);
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

function buildGraph(ctx) {
  const gain = (value = 1) => {
    const g = ctx.createGain();
    g.gain.value = value;
    return g;
  };
  const filter = (type, frequency, Q = 0.7) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = Q;
    return f;
  };
  const loop = (buffer) => {
    const s = ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    return s;
  };

  const master = gain(0);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10;
  comp.knee.value = 6;
  comp.ratio.value = 4;
  comp.attack.value = 0.002;
  comp.release.value = 0.2;
  master.connect(comp).connect(ctx.destination);

  const bus = (level) => {
    const b = gain(level);
    b.connect(master);
    return b;
  };
  const busEngine = bus(1);
  const busTyre = bus(0.9);
  const busNitro = bus(1);
  const busWind = bus(1);
  const busSfx = bus(0.9);
  const busUi = bus(0.6);

  // Engine: procedural saw/square stack and the CC0 loop share one mix bus.
  const engineOut = gain(0);
  engineOut.connect(busEngine);
  const engineMix = engineOut;

  const procFilter = filter('lowpass', 600, 1);
  const procGain = gain(1);
  procFilter.connect(procGain).connect(engineMix);
  const procOsc1 = ctx.createOscillator();
  procOsc1.type = 'sawtooth';
  procOsc1.frequency.value = 40;
  procOsc1.connect(procFilter);
  const procOsc2 = ctx.createOscillator();
  procOsc2.type = 'square';
  procOsc2.frequency.value = 20;
  procOsc2.connect(gain(0.5)).connect(procFilter);

  const sampleGain = gain(0);
  sampleGain.connect(filter('lowpass', 2400)).connect(engineMix);

  // Tyres: band-passed white noise with amplitude wobble from a 23 Hz LFO.
  const white = makeNoiseBuffer(ctx, 4, 'white');
  const tyreSrc = loop(white);
  const tyreBP = filter('bandpass', 1400, 1.1);
  const tyreGain = gain(0);
  const tyreLfo = ctx.createOscillator();
  tyreLfo.frequency.value = 23;
  const tyreLfoGain = gain(0);
  tyreLfo.connect(tyreLfoGain).connect(tyreGain.gain);
  tyreSrc.connect(tyreBP).connect(tyreGain).connect(busTyre);

  // Nitro: rising low-pass on high-passed white noise.
  const nitroSrc = loop(white);
  const nitroFilter = filter('lowpass', nitroCutoff(0), 3);
  const nitroGain = gain(0);
  nitroSrc.connect(filter('highpass', 250)).connect(nitroFilter).connect(nitroGain).connect(busNitro);

  // Wind and sea: brown noise. Sea swells via a slow LFO on its gain.
  const brown = makeNoiseBuffer(ctx, 6, 'brown');
  const windSrc = loop(brown);
  const windGainNode = gain(0);
  windSrc.connect(filter('lowpass', 700)).connect(windGainNode).connect(busWind);
  const seaSrc = loop(brown);
  const seaGain = gain(0.06);
  const seaLfo = ctx.createOscillator();
  seaLfo.frequency.value = 0.09;
  const seaLfoGain = gain(0.035);
  seaLfo.connect(seaLfoGain).connect(seaGain.gain);
  seaSrc.connect(filter('lowpass', 320)).connect(seaGain).connect(busWind);

  const sources = [procOsc1, procOsc2, tyreSrc, tyreLfo, nitroSrc, windSrc, seaSrc, seaLfo];
  procOsc1.start();
  procOsc2.start();
  tyreSrc.start();
  tyreLfo.start();
  nitroSrc.start();
  windSrc.start();
  seaSrc.start(0, 1.3);
  seaLfo.start();

  return {
    master, busEngine, busTyre, busNitro, busWind, busSfx, busUi,
    engineOut, procOsc1, procOsc2, procFilter, procGain, sampleGain,
    tyreBP, tyreGain, tyreLfoGain, nitroFilter, nitroGain, windGainNode, seaGain,
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
    this.rpm = ENGINE_IDLE_RPM;
    this.screech = 0;
    this.boostTime = 0;
    this.lastImpactAt = -Infinity;
    this.stopTimer = null;
    this.uiTimer = null;
    this.uiListener = null;
    this.gestureListeners = [];
    this.oneShots = new Set();
    this.values = { gear: 1, rpm: this.rpm, engineRate: 1, engineGain: 0, screech: 0, nitroGain: 0, nitroCutoff: 700, windGain: 0, speed: 0, reverse: false, limiter: 1 };
    this.attachGestures();
  }

  // Creates the context and graph. Only called after a user gesture (see unlock/setEnabled).
  init() {
    if (this.disposed || !this.AudioContextClass) return false;
    if (!this.ctx) {
      try {
        this.ctx = new this.AudioContextClass();
        this.nodes = buildGraph(this.ctx);
      } catch {
        this.ctx = null;
        this.nodes = null;
        return false;
      }
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
          if (key === 'engine') this.startEngineSample();
        })
        .catch(() => {});
    }
  }

  startEngineSample() {
    const n = this.nodes;
    if (!n || !this.ctx || !this.buffers.engine || n.engineSample) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers.engine;
    src.loop = true;
    src.connect(n.sampleGain);
    src.start();
    n.engineSample = src;
    n.sampleGain.gain.setTargetAtTime(0.9, this.ctx.currentTime, 0.2);
    n.procGain.gain.setTargetAtTime(0.35, this.ctx.currentTime, 0.2);
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
          this.syncRunning();
        }, 250);
      }
      return false;
    }
    this.attachGestures();
    if (this.unlocked) return this.activate();
    return true;
  }

  // Creates and fades in audio when enabled and unlocked. Returns the effective enabled state.
  activate() {
    if (!this.enabled || !this.unlocked) return this.enabled;
    if (!this.init()) {
      this.enabled = false;
      return false;
    }
    this.clearStopTimer();
    this.fade(MASTER_LEVEL);
    this.syncRunning();
    return true;
  }

  // Game pause or home screen: the context is suspended and resumed with the game.
  setPaused(paused) {
    this.paused = !!paused;
    if (this.paused && this.nodes) this.silenceDriving();
    this.syncRunning();
  }

  // Ramps driving layers to zero so a suspended engine cannot resume with stale levels.
  silenceDriving() {
    const n = this.nodes;
    const t = this.ctx.currentTime;
    for (const p of [n.engineOut.gain, n.tyreGain.gain, n.nitroGain.gain, n.windGainNode.gain]) {
      p.cancelScheduledValues(t);
      p.setValueAtTime(0, t);
    }
  }

  syncRunning() {
    if (!this.ctx || this.disposed) return;
    const want = this.enabled && !this.paused;
    const state = this.ctx.state;
    if (want && state !== 'running' && state !== 'closed') this.ctx.resume().catch(() => {});
    else if (!want && state === 'running') this.ctx.suspend().catch(() => {});
  }

  fade(level) {
    if (!this.nodes) return;
    const t = this.ctx.currentTime;
    this.nodes.master.gain.cancelScheduledValues(t);
    this.nodes.master.gain.setTargetAtTime(level, t, 0.06);
  }

  canPlay() {
    return !!(this.nodes && this.enabled && !this.paused && !this.disposed);
  }

  // Called once per frame from the driving loop. Internally throttled to 30 Hz.
  update(actor, throttle, handbrake, boosting, dt) {
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
    const th = throttle ? 1 : 0;

    // Engine: rpm follows gear-banded speed (or a low reverse whine) plus a throttle nudge.
    const rpmTarget = clamp(engineSpeedRpm(speed, forward) + th * 0.08, 0, 1);
    this.rpm = approach(this.rpm, rpmTarget, 7, h);
    const rate = engineRate(this.rpm);
    const limiter = limiterGain(this.rpm, t);
    const eg = engineGain(this.rpm, th) * limiter * (reverse ? 0.8 : 1);
    n.engineOut.gain.setTargetAtTime(eg, t, 0.1);
    if (n.engineSample) n.engineSample.playbackRate.setTargetAtTime(rate, t, 0.05);
    n.procOsc1.frequency.setTargetAtTime(30 + this.rpm * 120, t, 0.05);
    n.procOsc2.frequency.setTargetAtTime(15 + this.rpm * 60, t, 0.05);
    n.procFilter.frequency.setTargetAtTime(400 + this.rpm * 1200, t, 0.1);

    // Tyres: silent at standstill, squeal from lateral slide or handbrake.
    const standstill = tyreStandstillGate(speed);
    const screechTarget = screechIntensity(speed, actor.lateralSpeed, handbrake);
    this.screech = approach(this.screech, screechTarget, 10, h);
    n.tyreGain.gain.setTargetAtTime((0.02 + 0.22 * this.screech) * standstill, t, 0.05);
    n.tyreLfoGain.gain.setTargetAtTime(0.08 * this.screech * standstill, t, 0.05);
    n.tyreBP.frequency.setTargetAtTime(1300 + 1100 * this.screech, t, 0.1);

    // Nitro: gain follows boost, filter opens over the length of the boost.
    this.boostTime = boosting ? this.boostTime + h : Math.max(0, this.boostTime - h * 2);
    const cutoff = nitroCutoff(this.boostTime);
    n.nitroGain.gain.setTargetAtTime(boosting ? 0.32 : 0, t, 0.12);
    n.nitroFilter.frequency.setTargetAtTime(cutoff, t, 0.25);

    // Wind rises with speed.
    const wind = windGain(speed);
    n.windGainNode.gain.setTargetAtTime(wind, t, 0.3);

    const v = this.values;
    v.gear = gearFromSpeed(speed);
    v.rpm = this.rpm;
    v.engineRate = rate;
    v.engineGain = eg;
    v.screech = this.screech;
    v.nitroGain = boosting ? 0.32 : 0;
    v.nitroCutoff = cutoff;
    v.windGain = wind;
    v.speed = speed;
    v.reverse = reverse;
    v.limiter = limiter;
  }

  onPickup() {
    if (!this.canPlay()) return;
    const n = this.nodes;
    const t = this.ctx.currentTime;
    this.playBuffer('pickupClink', n.busSfx, 0.55, 1);
    const chime = this.playBuffer('pickupChime', n.busSfx, 0.45, 0.9);
    if (chime) {
      chime.playbackRate.setValueAtTime(0.9, t);
      chime.playbackRate.linearRampToValueAtTime(1.35, t + 0.25);
    } else {
      this.sweep(660, 1320, 0.2, 0.2, n.busSfx);
    }
  }

  onImpact(speed) {
    if (!this.canPlay()) return;
    const t = this.ctx.currentTime;
    if (t - this.lastImpactAt < 0.08) return;
    this.lastImpactAt = t;
    const n = this.nodes;
    const s = impactStrength(speed);
    if (s <= 0) return;
    const rate = impactRate(speed);
    if (!this.playBuffer('impactHeavy', n.busSfx, 0.35 + 0.6 * s, rate)) {
      this.sweep(95, 40, 0.28, 0.55 * s + 0.15, n.busSfx);
    }
    if (s > 0.4) this.playBuffer('impactLight', n.busSfx, 0.2 + 0.4 * s, rate * 1.1);
  }

  // Menu clicks play whenever sound is on, including the paused menu. The context is resumed
  // briefly for the click and suspended again afterwards if the game is still paused.
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

  playBuffer(key, dest, level, rate) {
    const buffer = this.buffers[key];
    if (!buffer || !this.ctx) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = level;
    src.connect(g).connect(dest);
    this.track(src);
    src.start();
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
      ...this.values,
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.enabled = false;
    this.clearStopTimer();
    if (this.uiTimer !== null) clearTimeout(this.uiTimer);
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
    }
    if (this.ctx) {
      try { this.ctx.close().catch(() => {}); } catch {}
    }
    this.ctx = null;
    this.nodes = null;
    this.buffers = {};
  }
}
