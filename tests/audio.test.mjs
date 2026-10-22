import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  GameAudio, GEAR_TOPS, AUDIO_ASSETS, clamp, approach, gearFromSpeed, rpmFromSpeed, engineSpeedRpm,
  limiterGain, engineRate, engineGain, tyreStandstillGate, screechIntensity, nitroCutoff, windGain,
  impactStrength, impactRate, crossfadeLoop, REVERSE_RPM_CAP,
} from '../dist/audio.js';

const param = (value = 0) => ({
  value,
  setTargetAtTime() {}, setValueAtTime() {}, linearRampToValueAtTime() {},
  exponentialRampToValueAtTime() {}, cancelScheduledValues() {},
});

function node() {
  return {
    connect(target) { return target; },
    disconnect() {},
    start() {}, stop() {},
    gain: param(1), frequency: param(0), playbackRate: param(1), Q: param(1),
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
  createBuffer(channels, length) {
    const data = new Float32Array(length);
    return { getChannelData: () => data, length };
  }
  decodeAudioData(data) { return Promise.resolve({ duration: 1, byteLength: data.byteLength }); }
  resume() { this.state = 'running'; return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
}

const okFetch = async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(8) });
const failFetch = async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) });
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

test('limiterGain is transparent below redline and flutters mildly above it', () => {
  assert.equal(limiterGain(0.9, 1.234), 1);
  const samples = [];
  for (let i = 0; i < 40; i++) samples.push(limiterGain(0.99, i / 30));
  for (const g of samples) assert.ok(g >= 0.6 - 1e-9 && g <= 1 + 1e-9, `limiter ${g}`);
  assert.ok(Math.max(...samples) - Math.min(...samples) > 0.2, 'gain flutters');
});

test('engine rate and gain are monotonic and bounded', () => {
  assert.ok(engineRate(0) < engineRate(0.5));
  assert.ok(engineRate(0.5) < engineRate(1));
  assert.ok(engineRate(1) <= 2.2 && engineRate(0) >= 0.5);
  assert.ok(engineGain(0.5, 1) > engineGain(0.5, 0));
  for (const rpm of [0, 0.3, 1, 5]) {
    for (const throttle of [0, 1, 3]) {
      const g = engineGain(rpm, throttle);
      assert.ok(g >= 0 && g <= 0.24, `gain ${g}`);
    }
  }
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
  assert.equal(out[L - 1], src[L - 1]);
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

test('shipped engine loop wraps without a click (seam step under 30 LSB)', () => {
  const file = fileURLToPath(new URL('../dist/assets/audio/engine-loop.wav', import.meta.url));
  const buf = readFileSync(file);
  assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
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
  const first = buf.readInt16LE(dataOffset);
  const last = buf.readInt16LE(dataOffset + (count - 1) * 2);
  assert.ok(Math.abs(first - last) < 30, `seam step ${first - last}`);
});

test('AUDIO_ASSETS names the shipped files', () => {
  assert.equal(AUDIO_ASSETS.engine, 'engine-loop.wav');
  assert.ok(Object.values(AUDIO_ASSETS).every((f) => /\.(wav|mp3)$/.test(f)));
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
    audio.onPickup();
    audio.onImpact(20);
    audio.onUiClick();
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
  assert.doesNotThrow(() => { audio.onPickup(); audio.onImpact(25); audio.onUiClick(); });
  assert.ok(audio.ctx.created.oscillators > 0, 'procedural sweeps are used when samples are missing');
  audio.dispose();
});

test('GameAudio loads samples in the background and starts the engine loop', async () => {
  const requested = [];
  const fetchFn = async (url) => { requested.push(url); return okFetch(); };
  const audio = new GameAudio({ AudioContextClass: MockAudioContext, fetchFn, assetBase: 'assets/audio/' });
  enableAndUnlock(audio);
  await flush();
  await flush();
  assert.equal(requested.length, 6);
  assert.ok(requested.every((url) => url.startsWith('assets/audio/')));
  assert.equal(audio.debug().loaded.engine, true);
  assert.equal(audio.debug().sampleLayer, true);
  audio.dispose();
});

test('suspends on pause and resumes on unpause only when enabled', () => {
  const audio = new GameAudio({ AudioContextClass: MockAudioContext, fetchFn: null });
  enableAndUnlock(audio);
  audio.setPaused(false);
  assert.equal(audio.ctx.state, 'running');
  audio.setPaused(true);
  assert.equal(audio.ctx.state, 'suspended');
  audio.setPaused(false);
  assert.equal(audio.ctx.state, 'running');
  assert.equal(audio.setEnabled(false), false);
  assert.equal(audio.debug().enabled, false);
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

test('a menu click resumes the context for the click, then leaves it paused', async () => {
  const audio = new GameAudio({ AudioContextClass: MockAudioContext, fetchFn: null });
  enableAndUnlock(audio);
  assert.equal(audio.ctx.state, 'suspended');
  audio.onUiClick();
  assert.equal(audio.ctx.state, 'running', 'click starts the context while the menu is open');
  await new Promise((resolve) => setTimeout(resolve, 340));
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
  assert.equal(d.limiter, 1);
  audio.dispose();
});

test('dispose releases the context and ignores later calls', () => {
  const audio = new GameAudio({ AudioContextClass: MockAudioContext, fetchFn: null });
  enableAndUnlock(audio);
  audio.setPaused(false);
  const ctx = audio.ctx;
  audio.dispose();
  assert.equal(ctx.state, 'closed');
  assert.doesNotThrow(() => { audio.setEnabled(true); audio.unlock(); audio.onPickup(); audio.update(actor(20), 1, false, false, 1); });
  assert.equal(audio.debug().graph, false);
});
