const assert = require('node:assert/strict');
const Strips = require('../dist/strip-sonification.js');
const Samples = require('../dist/sonification-samples.js');
const Music = require('../dist/music.js');
const Audio = require('../dist/audio.js');
const Fixtures = require('./fidelity-fixtures.js');
const { Context } = require('./fake-audio.cjs');

function verify(score) {
  assert.equal(score.strips.length, 32); assert.equal(score.totalBeats, 32);
  assert.ok(score.bpm >= 80 && score.bpm <= 100);
  const sounding = score.strips.filter(s => s.midi !== null);
  assert.equal(score.melody.reduce((n, e) => n + e.sourceRefs.length, 0), sounding.length);
  for (const strip of score.strips) {
    assert.ok(strip.rect.x >= 0 && strip.rect.x + strip.rect.width <= 1);
    assert.equal(strip.beat, strip.index);
    if (strip.centroid === null) { assert.equal(strip.midi, null); assert.equal(strip.eventId, null); continue; }
    assert.ok(strip.centroid >= 0 && strip.centroid <= 1);
    assert.ok(strip.midi >= 48 && strip.midi <= 72);
    assert.ok(score.mode.notes.includes(((strip.midi - score.root) % 12 + 12) % 12));
    const event = score.melody.find(e => e.id === strip.eventId);
    assert.ok(event.sourceRefs.some(ref => ref.stripId === strip.id));
    assert.equal(event.midi, strip.midi, 'region preview and whole-song pitch');
    const previous = score.strips[strip.index - 1];
    if (previous?.midi !== null && previous?.midi !== undefined) assert.ok(Math.abs(previous.midi - strip.midi) <= 7);
  }
  for (const event of [...score.melody, ...score.bassEvents, ...score.padEvents]) {
    assert.ok(event.durationBeats > 0 && event.beat + event.durationBeats <= 32);
    assert.equal(event.startTime, Math.round(event.beat * score.secondsPerBeat * 1e6) / 1e6);
    for (const pitch of Array.isArray(event.midi) ? event.midi : [event.midi]) {
      assert.ok(score.mode.notes.includes(((pitch - score.root) % 12 + 12) % 12));
    }
  }
  for (const event of [...score.bassEvents, ...score.padEvents]) {
    assert.equal(event.origin.type, 'global'); assert.equal(event.sourceRefs, undefined);
  }
  for (const seconds of [0, .1, 3, 8, score.melodyDuration - .05, score.melodyDuration + .1]) {
    const p = Strips.position(score, seconds);
    assert.deepEqual(p.active.map(e => e.id), score.melody.filter(e => e.startTime <= seconds + 1e-6 && seconds < e.startTime + e.duration - 1e-6).map(e => e.id));
    if (p.tail) assert.equal(p.active.length, 0);
  }
}
let cases = 0, schedules = 0;
for (const id of ['up','down','low','high','white','black']) {
  const analysis = Strips.analyze(Samples.pixels(id));
  for (let root = 0; root < 12; root++) for (const modeId of ['bright','soft','deep']) {
    const options = { root, modeId };
    const score = Strips.compose(analysis, options); verify(score);
    assert.deepEqual(score, Strips.compose(Strips.analyze(Samples.pixels(id)), options)); cases++;
  }
}
for (let i = 0; i < 84; i++) {
  const analysis = Strips.analyze(Fixtures.pixels(i)), score = Strips.compose(analysis); verify(score); cases++;
  for (const tone of ['warm','glass','mist']) for (const fromBeat of [0, 5.5, 31.8, 32.1]) {
    const context = new Context(); context.currentTime = 10;
    const session = Audio.createSession(context, { bpm: score.bpm });
    session.schedule(score, 10.04 - Music.beatToTime(score, fromBeat), tone, fromBeat);
    assert.ok(context.nodes.filter(n => n.kind === 'oscillator').every(n => n.started >= 10.039999));
    session.stop(); session.dispose(); assert.equal(session.sourceCount, 0); schedules++;
  }
}
const upper = Strips.compose(Strips.analyze(Samples.pixels('up'))), lower = Strips.compose(Strips.analyze(Samples.pixels('down')));
upper.strips.forEach((s, i) => assert.ok(s.targetMidi > lower.strips[i].targetMidi && s.midi > lower.strips[i].midi));
assert.equal(upper.bpm, lower.bpm); assert.equal(upper.root, lower.root); assert.equal(upper.mode.id, lower.mode.id);
assert.ok(Strips.analyze(Samples.pixels('high')).bpm > Strips.analyze(Samples.pixels('low')).bpm);
const white = Strips.compose(Strips.analyze(Samples.pixels('white'))), black = Strips.compose(Strips.analyze(Samples.pixels('black')));
assert.equal(white.melody.length, 1); assert.equal(white.melody[0].sourceRefs.length, 32);
assert.equal(black.melody.length, 0); assert.equal(black.rests.length, 32); assert.equal(black.padEvents.length, 0); assert.equal(black.bassEvents.length, 0);
const gapPixels = Samples.pixels('up');
for (let y = 0; y < 120; y++) for (let x = 72; x < 96; x++) for (let c = 0; c < 3; c++) gapPixels[(y * 192 + x) * 4 + c] = 0;
const gap = Strips.compose(Strips.analyze(gapPixels)); verify(gap);
assert.equal(gap.rests.length, 4); assert.ok(gap.melody.every(e => !(e.beat < 12 && e.beat + e.beats > 12)));
assert.equal(Strips.position(gap, 13 * gap.secondsPerBeat).active.length, 0);
const alphaPixels = Samples.pixels('white'); for (let i = 3; i < alphaPixels.length; i += 4) alphaPixels[i] = 0;
assert.equal(Strips.compose(Strips.analyze(alphaPixels)).melody.length, 0);
assert.throws(() => Strips.analyze(new Uint8Array(4)));
console.log(JSON.stringify({ status: 'passed', scoreCases: cases, schedules, checks: ['scale/range/jumps','source links','repeatability','up/down','contrast','merge/rests','silent black','transparent black','audio adapter/resume'] }));
