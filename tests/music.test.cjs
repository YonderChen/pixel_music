const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const Music = require('../dist/music.js');
const Image = require('../dist/image-analysis.js');
const Legacy = require('../dist/legacy.js');
const Fixtures = require('./fixtures.js');
const pc = n => (n % 12 + 12) % 12;

function imageRegions(seed) {
  let state = seed;
  const random = () => { state = Math.imul(state, 1664525) + 1013904223 | 0; return (state >>> 0) / 4294967296; };
  return Array.from({ length: 24 }, (_, col) => ({ notes: Array.from({ length: 5 }, (_, row) => ({
    col, row, light: random(), hue: random(), density: random(), velocity: .04 + random() * .04, saturation: random(), signature: random() - .5, localSeed: state >>> 0,
  })) }));
}
function check(score) {
  assert.equal(score.melody.length, 120);
  assert.equal(new Set(score.melody.map(n => n.regionId)).size, 120);
  assert.equal(score.totalBeats, 64); assert.equal(score.bars.length, 16);
  assert.equal(score.phrases.length, 4); assert.equal(score.rests.length, 7);
  score.phrases.forEach(phrase => {
    const notes = score.melody.filter(n => n.phrase === phrase.index);
    assert.equal(notes.length, 30); assert.equal(notes.at(-1).midi, phrase.endingPitch);
  });
  score.bars.forEach(bar => {
    const notes = score.melody.filter(n => n.bar === bar.index);
    assert.equal(notes.length, bar.index % 2 ? 7 : 8);
    assert.equal(notes.reduce((sum, n) => sum + n.beats, 0) + bar.rest, 4);
    assert.equal(notes[0].beat, bar.beat);
    assert.ok(bar.voicing.every((pitch, i) => !i || pitch > bar.voicing[i - 1]));
    assert.ok(bar.voicing.every(pitch => bar.classes.includes(pc(pitch - score.root))));
    assert.ok(bar.classes.includes(pc(bar.bass - score.root)), 'bass must remain part of the harmony');
    if (bar.index) {
      assert.ok(Math.abs(bar.bass - score.bars[bar.index - 1].bass) <= 7, 'avoid abrupt bass register resets');
      bar.voicing.forEach((pitch, voice) => assert.ok(Math.abs(pitch - score.bars[bar.index - 1].voicing[voice]) <= 7, 'keep inner voices smooth'));
    }
  });
  const midi = score.melody.map(n => n.midi);
  assert.ok(Math.max(...midi) - Math.min(...midi) <= 19);
  assert.ok(Math.max(...midi) <= 79, 'transposition must not drive melody into a shrill register');
  assert.ok(new Set(midi).size >= 4);
  assert.equal(score.melody.at(-1).midi, score.tonic);
  assert.equal(score.melody[score.diagnostics.climaxIndex].role, 'climax');
  assert.equal(midi[score.diagnostics.climaxIndex], Math.max(...midi));
  assert.equal(midi.filter(p => p === Math.max(...midi)).length, 1, 'one main melodic climax');
  score.melody.forEach((note, index) => {
    assert.ok(Number.isFinite(note.beat) && note.beats >= .25 && note.durationBeats > 0);
    assert.ok(!index || note.beat > score.melody[index - 1].beat);
    assert.ok(!index || Math.abs(note.midi - score.melody[index - 1].midi) <= 7);
    assert.equal(note.col, Math.floor(index / 5));
    assert.equal(note.row, note.col % 2 ? 4 - index % 5 : index % 5);
    assert.equal(score.columns[note.col].notes[note.row].midi, note.midi);
    if (note.weight === 1) assert.ok(score.bars[note.bar].classes.includes(pc(note.midi - score.tonic)));
    if (note.anchorPitch != null) assert.equal(note.midi, note.anchorPitch);
    const rest = score.rests.find(r => r.bar === note.bar);
    if (rest) assert.ok(note.beat + note.durationBeats <= rest.beat, 'release must leave the planned breath');
    if (!score.bars[note.bar].classes.includes(pc(note.midi - score.tonic))) {
      let resolved = false;
      for (let j = index + 1; j <= Math.min(index + 2, 119); j++) {
        const next = score.melody[j];
        assert.ok(Math.abs(next.midi - score.melody[j - 1].midi) <= 3, 'connecting tones resolve by step');
        if (score.bars[next.bar].classes.includes(pc(next.midi - score.tonic))) { resolved = true; break; }
      }
      assert.ok(resolved, 'no unresolved connecting tone');
    }
  });
  score.rests.forEach(rest => {
    const pos = Music.playbackPosition(score, (rest.beat + .1) * score.secondsPerBeat);
    assert.equal(pos.rest, true); assert.equal(pos.note.bar, rest.bar);
    const later = Music.playbackPosition(score, (rest.beat + rest.beats - .05) * score.secondsPerBeat);
    assert.equal(pos.index, later.index); assert.equal(pos.scanFraction, later.scanFraction);
  });
  assert.equal(Music.playbackPosition(score, score.melodyDuration + .3).tail, true);
  assert.equal(Music.playbackPosition(score, score.duration).finished, true);
}
const started = performance.now(); let count = 0, maxMs = 0, fallbackCount = 0, syntheticFallbackCases = 0;
for (const mode of Object.values(Music.MODES)) for (let root = 0; root < 12; root++) for (let seed = 1; seed <= 12; seed++) {
  const analysis = { columns: imageRegions(seed), root, modeId: mode.id, bpm: 88 };
  const before = JSON.stringify(analysis), start = performance.now(), score = Music.compose(analysis);
  maxMs = Math.max(maxMs, performance.now() - start); fallbackCount += score.diagnostics.fallbacks;
  check(score); assert.equal(JSON.stringify(analysis), before, 'composer must not mutate analysis');
  assert.deepEqual(score, Music.compose(analysis)); count++;
  if (seed === 1) {
    const fallback = Music.compose(analysis, { forceFallback: true }); check(fallback);
    assert.equal(fallback.diagnostics.fallbacks, 4);
    assert.deepEqual(fallback, Music.compose(analysis, { forceFallback: true }), 'fallback must be deterministic in every key and mode');
    syntheticFallbackCases++;
  }
  const oldColumns = imageRegions(seed), old = Legacy.arrangeRegions(oldColumns, root, mode);
  assert.equal(old.melody.length, 120); assert.equal(old.totalBeats, 48); assert.equal(old.melody.at(-1).midi, 60 + root);
  assert.ok(old.melody.every((note, i) => !i || Math.abs(note.midi - old.melody[i - 1].midi) <= 7));
  old.melody.forEach(note => {
    assert.equal(oldColumns[note.col].notes[note.row].midi, note.midi);
    if (note.strong) assert.ok(old.bars[note.bar].chord.some(pitch => pc(pitch) === pc(note.midi - old.tonic)));
  });
}
assert.equal(Object.keys(Music.RHYTHMS).length, 8);
assert.equal(Music.HARMONIES.length, 3);
const fixtureScores = Fixtures.names.map((name, index) => {
  const analysis = Image.analyzePixels(Fixtures.pixels(index));
  assert.deepEqual(analysis, Image.analyzePixels(Fixtures.pixels(index)));
  const score = Music.compose(analysis); check(score);
  assert.ok(score.bpm >= 80 && score.bpm <= 96);
  assert.ok(score.duration >= 42 && score.duration <= 50);
  const fallback = Music.compose(analysis, { forceFallback: true }); check(fallback);
  assert.equal(fallback.diagnostics.fallbacks, 4);
  return { name, analysis, score };
});
assert.ok(new Set(fixtureScores.map(f => f.score.scoreHash)).size >= 10, 'fixture melodies should not collapse to one song');
assert.ok(new Set(fixtureScores.map(f => f.score.theme.signature)).size >= 5, 'whole-image themes must show variation, not just different keys and tempos');
assert.ok(new Set(fixtureScores.map(f => JSON.stringify(f.score.melody.map(n => n.midi - f.score.tonic)))).size >= 10, 'transposition alone must not count as melodic variety');
const original = fixtureScores[5], edited = fixtureScores[11];
assert.notEqual(original.analysis.hash, edited.analysis.hash);
assert.notEqual(original.score.scoreHash, edited.score.scoreHash, 'score fingerprint includes expressive event changes, not pitch alone');
const changed = original.score.melody.map((n, i) => n.midi !== edited.score.melody[i].midi || n.velocity !== edited.score.melody[i].velocity);
assert.ok(changed.some(Boolean), 'local edit must affect audible musical parameters');
assert.equal(original.score.theme.signature, edited.score.theme.signature, 'small edit must not rewrite the whole theme');
assert.equal(original.score.harmonyIndex, edited.score.harmonyIndex);
assert.equal(original.score.mode.id, edited.score.mode.id); assert.equal(original.score.root, edited.score.root);
assert.equal(original.score.bpm, edited.score.bpm, 'minor local edit should preserve overall tempo in this controlled fixture');
const changedInPhrase = [0, 1, 2, 3].map(p => changed.slice(p * 30, p * 30 + 30).filter(Boolean).length);
assert.ok(changedInPhrase[2] > 0 && changedInPhrase.filter((_, p) => p !== 2).every(n => n === 0), 'local edit stays in its phrase when global decisions are unchanged');
const spatialEdits = [2, 8, 14, 20].map(col => {
  const pixels = Fixtures.pixels(5);
  for (let y = 48; y < 72; y++) for (let x = col * 8; x < (col + 1) * 8; x++) {
    const offset = (y * Fixtures.width + x) * 4;
    for (let channel = 0; channel < 3; channel++) pixels[offset + channel] = Math.min(255, pixels[offset + channel] + 5);
  }
  const score = Music.compose(Image.analyzePixels(pixels)); check(score);
  assert.equal(score.root, original.score.root); assert.equal(score.mode.id, original.score.mode.id);
  assert.equal(score.bpm, original.score.bpm); assert.equal(score.harmonyIndex, original.score.harmonyIndex);
  assert.equal(score.theme.signature, original.score.theme.signature);
  const changes = [0, 1, 2, 3].map(phrase => score.melody.slice(phrase * 30, phrase * 30 + 30)
    .filter((note, i) => note.midi !== original.score.melody[phrase * 30 + i].midi || note.velocity !== original.score.melody[phrase * 30 + i].velocity).length);
  const expectedPhrase = Math.floor(col / 6);
  assert.ok(changes[expectedPhrase] > 0, 'all four image spans must influence their own music');
  assert.ok(changes.every((n, phrase) => phrase === expectedPhrase || n === 0), 'small edits must remain local in controlled fixtures');
  return { col, row: 2, changedByPhrase: changes, globalDecisionsChanged: false };
});
assert.throws(() => Image.analyzePixels(new Uint8Array(3)), /RGBA/);
assert.throws(() => Music.arrangeRegions([], 0, 'soft'), /24×5/);
for (const shade of [0, 255]) {
  const rgba = new Uint8ClampedArray(192 * 120 * 4);
  for (let i = 0; i < rgba.length; i += 4) rgba.set([shade, shade, shade, 255], i);
  const analysis = Image.analyzePixels(rgba), score = Music.compose(analysis); check(score);
  assert.equal(analysis.root, 0, 'achromatic input has no arbitrary colour-derived key');
  assert.equal(score.mode.id, shade === 0 ? 'deep' : 'soft');
}
console.log(JSON.stringify({ status: 'passed', syntheticCases: count, legacyCases: count, pixelFixtures: fixtureScores.length, fallbackCases: fixtureScores.length, syntheticFallbackCases, fallbackCount, maxComposeMs: Math.round(maxMs), elapsedMs: Math.round(performance.now() - started), localEditChangedByPhrase: changedInPhrase, spatialEdits, fixtureHashes: fixtureScores.map(f => ({ name: f.name, scoreHash: f.score.scoreHash, mode: f.score.mode.id, root: f.score.root })) }, null, 2));
