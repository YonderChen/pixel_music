const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const Music = require('./baseline/music-v05.js');
const Image = require('./baseline/image-analysis-v05.js');
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
const check = require('./score-contract-v05.cjs');
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
assert.equal(Music.HARMONIES.length, 3);
const fixtureScores = Fixtures.names.map((name, index) => {
  const analysis = Image.analyzePixels(Fixtures.pixels(index));
  assert.deepEqual(analysis, Image.analyzePixels(Fixtures.pixels(index)));
  const score = Music.compose(analysis); check(score);
  assert.ok(score.bpm >= 76 && score.bpm <= 104 && score.bpm % 2 === 0);
  assert.ok(score.duration >= 38 && score.duration <= 55);
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
assert.ok(changedInPhrase[2] > 0, 'local edit affects its own phrase');
if (original.score.rhythmProfile.signature === edited.score.rhythmProfile.signature) assert.ok(changedInPhrase.filter((_, p) => p !== 2).every(n => n === 0), 'local edit stays in its phrase when all global decisions are unchanged');
else assert.notDeepEqual(original.score.rhythmProfile.anchors, edited.score.rhythmProfile.anchors, 'global rhythm changes must be attributable to a recorded motif boundary');
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
  assert.equal(score.rhythmProfile.signature, original.score.rhythmProfile.signature, 'controlled minor edits preserve the global rhythm motif');
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
