const assert = require('node:assert/strict');
const Audio = require('../dist/audio.js');
const Music = require('../dist/music.js');
const Image = require('../dist/image-analysis.js');
const Legacy = require('../dist/legacy.js');
const Fixtures = require('./fixtures.js');
class Param {
  constructor(value = 0) { this.value = value; this.events = []; }
  record(type, value, time) { assert.ok(Number.isFinite(value) && Number.isFinite(time) && time >= 0); this.events.push({ type, value, time }); }
  setValueAtTime(value, time) { this.record('set', value, time); }
  exponentialRampToValueAtTime(value, time) { assert.ok(value > 0); this.record('exponential', value, time); }
  linearRampToValueAtTime(value, time) { this.record('linear', value, time); }
  cancelScheduledValues(time) { assert.ok(Number.isFinite(time)); }
}
class Node {
  constructor() {
    this.gain = new Param(1); this.frequency = new Param(); this.delayTime = new Param();
    this.threshold = new Param(); this.ratio = new Param(); this.knee = new Param(); this.disconnected = false;
  }
  connect() {}
  disconnect() { this.disconnected = true; }
  start(time) { assert.ok(time >= 0); this.started = time; }
  stop(time) { assert.ok(time >= 0); this.stops = (this.stops || []).concat(time); }
}
class Context {
  constructor() { this.currentTime = 0; this.destination = new Node(); this.nodes = []; }
  make() { const n = new Node(); this.nodes.push(n); return n; }
  createGain() { return this.make(); }
  createBiquadFilter() { return this.make(); }
  createDelay() { return this.make(); }
  createDynamicsCompressor() { return this.make(); }
  createOscillator() { const node = this.make(); node.oscillator = true; return node; }
}
const analysis = Image.analyzePixels(Fixtures.pixels(5)), score = Music.compose(analysis), old = Legacy.compose(analysis);
for (const profile of ['legacy', 'plain', 'expressive']) for (const tone of ['warm', 'glass', 'mist']) {
  const context = new Context(), session = Audio.createSession(context, { profile, bpm: score.bpm });
  const selected = profile === 'legacy' ? old : score;
  session.schedule(selected, .08, tone);
  const oscillators = context.nodes.filter(n => n.oscillator);
  assert.equal(session.sourceCount, oscillators.length); assert.ok(oscillators.length > 300);
  oscillators.forEach(osc => assert.ok(osc.stops[0] > osc.started));
  const firstFrequency = oscillators[0].frequency.events[0].value;
  const fundamental = 440 * 2 ** ((selected.melody[0].midi - 69) / 12);
  assert.ok(Math.abs(firstFrequency / fundamental - 1) <= .002);
  const partialCount = profile === 'expressive' && tone !== 'mist' ? 3 : 2;
  selected.melody.forEach((note, index) => {
    const partials = oscillators.slice(index * partialCount, (index + 1) * partialCount);
    assert.equal(partials.length, partialCount, 'all 120 regions must actually schedule a voice');
    partials.forEach(osc => assert.ok(Math.abs(osc.started - (.08 + note.beat * selected.secondsPerBeat)) < 1e-9));
    const expectedFrequency = 440 * 2 ** ((note.midi - 69) / 12);
    assert.ok(Math.abs(partials[0].frequency.events[0].value / expectedFrequency - 1) <= .002, 'scheduled region pitch must match its score');
  });
  session.stop();
  assert.ok(oscillators.every(osc => osc.stops.at(-1) === .03), 'stop must cancel future notes as well');
  session.dispose(); assert.equal(session.sourceCount, 0); assert.ok(context.nodes.every(node => node.disconnected));
}
for (const fromBeat of [3.75, 17, 32.25, 63.5]) {
  const context = new Context(); context.currentTime = 10;
  const session = Audio.createSession(context, { bpm: score.bpm });
  session.schedule(score, context.currentTime + .035 - fromBeat * score.secondsPerBeat, 'glass', fromBeat);
  assert.ok(context.nodes.filter(n => n.oscillator).every(n => n.started >= 10.0349), 'tone switch must never replay old notes in the past');
  session.dispose();
}
const context = new Context(), preview = Audio.createSession(context);
preview.voice(score.melody[12].midi, .02, .65, .12, 'warm');
context.nodes.filter(n => n.oscillator).reverse().forEach(n => n.onended());
assert.equal(preview.sourceCount, 0); preview.dispose();
const samples = new Float32Array([0, .2, -.2, 0]);
const buffer = { sampleRate: 4, duration: 1, getChannelData: () => samples };
const metrics = Audio.inspectBuffer(buffer); assert.equal(metrics.invalid, 0); assert.equal(metrics.clipped, 0);
const wav = new DataView(Audio.wavBytes(buffer));
assert.equal(wav.byteLength, 52); assert.equal(wav.getUint32(40, true), 8);
assert.equal(String.fromCharCode(...new Uint8Array(wav.buffer, 0, 4)), 'RIFF');
console.log('Passed: nine audio profiles/tones, scheduled starts/stops, tone-change continuity, resource cleanup, metrics and WAV encoding.');
