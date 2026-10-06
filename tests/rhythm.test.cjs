const assert = require('node:assert/strict');
const Music = require('./baseline/music-v05.js'), Image = require('./baseline/image-analysis-v05.js');
const Rhythm = require('./baseline/rhythm-v05.js'), Fixtures = require('./fixtures.js'), Extended = require('./rhythm-fixtures.js');
const OldMusic = require('./baseline/music-v04.js'), OldImage = require('./baseline/image-analysis-v04.js');
const check = require('./score-contract-v05.cjs');
const onset = score => new Set(score.melody.map(n => Math.round(n.beat * 4)));
function distance(a, b) {
  const aa = onset(a), bb = onset(b);
  return 1 - [...aa].filter(x => bb.has(x)).length / new Set([...aa, ...bb]).size;
}
const samples = [...Fixtures.names.map((name, i) => ({ name, pixels: Fixtures.pixels(i) })), ...Extended.names.map((name, i) => ({ name, pixels: Extended.pixels(i) }))];
const scores = samples.map(sample => {
  const analysis = Image.analyzePixels(sample.pixels), score = Music.compose(analysis, { bpm: 88, tempo: false });
  check(score);
  assert.equal(score.melody.length, 120); assert.equal(score.totalBeats, 64);
  assert.deepEqual(score, Music.compose(analysis, { bpm: 88, tempo: false }));
  const fallback = Music.compose(analysis, { bpm: 88, tempo: false, forceRhythmFallback: true });
  assert.deepEqual(fallback, Music.compose(analysis, { bpm: 88, tempo: false, forceRhythmFallback: true }));
  assert.equal(fallback.diagnostics.rhythmSimplified, true);
  check(fallback);
  check(Music.compose(analysis, { forceFallback: true }));
  for (const candidate of [score, fallback]) {
    candidate.phrases.forEach(p => {
      assert.equal(candidate.melody.filter(n => n.phrase === p.index).length, 30);
      const counts = candidate.bars.slice(p.index * 4, p.index * 4 + 4).map(b => b.noteCount);
      counts.forEach((n, i) => assert.ok(n >= 6 && n <= 9 && (!i || Math.abs(n - counts[i - 1]) <= 2)));
    });
    candidate.bars.forEach(b => assert.equal(candidate.melody.filter(n => n.bar === b.index).reduce((sum, n) => sum + n.beats, 0) + b.rest, 4));
    candidate.rests.forEach(r => candidate.melody.forEach(n => assert.ok(n.beat >= r.beat + r.beats || n.beat + n.durationBeats <= r.beat)));
  }
  const otherTempo = Music.compose(analysis, { bpm: 100, tempo: false });
  assert.equal(otherTempo.rhythmFingerprint, score.rhythmFingerprint, 'tempo alone cannot count as rhythmic variety');
  assert.notEqual(otherTempo.expressionFingerprint, score.expressionFingerprint);
  const pitchless = { ...score, bpm: 43, melody: score.melody.map(n => ({ ...n, midi: 60, velocity: .01, durationBeats: .01 })) };
  assert.equal(Music.rhythmFingerprint(pitchless), score.rhythmFingerprint, 'pitch, velocity and gate must not inflate rhythm variety');
  return score;
});
const fixtureUnique = new Set(scores.slice(0, 12).map(s => s.rhythmFingerprint)).size;
const extendedUnique = new Set(scores.slice(12).map(s => s.rhythmFingerprint)).size;
assert.ok(fixtureUnique >= 8); assert.ok(extendedUnique >= 32);
const fallbackUnique = new Set(samples.slice(0, 12).map(s => Music.compose(Image.analyzePixels(s.pixels), { forceRhythmFallback: true }).rhythmFingerprint)).size;
assert.ok(fallbackUnique >= 8, 'simplified path must still be image-driven');
const old = Fixtures.names.map((_, i) => OldMusic.compose(OldImage.analyzePixels(Fixtures.pixels(i)), { bpm: 88 }));
assert.equal(new Set(old.map(Music.rhythmFingerprint)).size, 1, 'frozen baseline reproduces the diagnosed failure');
const pairs = [[0, 1], [2, 8], [7, 10]].map(([a, b]) => ({ a: samples[a].name, b: samples[b].name, onsetJaccardDistance: distance(scores[a], scores[b]) }));
pairs.forEach(pair => assert.ok(pair.onsetJaccardDistance >= .20, 'contrasting structures need substantial onset differences'));
const localDistance = distance(scores[5], scores[11]); assert.ok(localDistance < .15, 'local change should preserve most of the existing pulse');
const distances = [];
for (let a = 12; a < scores.length; a++) for (let b = a + 1; b < scores.length; b++) if (Math.floor((a - 12) / 6) !== Math.floor((b - 12) / 6)) distances.push(distance(scores[a], scores[b]));
distances.sort((a, b) => a - b);
assert.ok(distances[Math.floor(distances.length / 2)] >= .20);
const natural = samples.map(s => Music.compose(Image.analyzePixels(s.pixels)));
natural.forEach(check);
assert.ok(new Set(natural.map(s => s.bpm)).size >= 6, 'global speed needs perceptible range');
assert.ok(natural.every(s => s.bpm >= 76 && s.bpm <= 104));
assert.ok(Image.analyzePixels(Fixtures.pixels(10)).rhythmStructure.organizedTexture < Image.analyzePixels(Fixtures.pixels(1)).rhythmStructure.organizedTexture, 'random noise is not organized texture');
assert.ok(natural[10].bpm < natural[1].bpm, 'noise must not blindly outrun organized structure');
// Opposite directions are both measured rather than using only horizontal pixel edges.
const horizontal = Image.analyzePixels(Extended.pixels(6)), vertical = Image.analyzePixels(Extended.pixels(7));
assert.ok(horizontal.columns.flatMap(c => c.notes).some(n => n.horizontalVariation > 0));
assert.ok(vertical.columns.flatMap(c => c.notes).some(n => n.verticalVariation > 0));
assert.equal(Object.isFrozen(Rhythm.COEFFICIENTS), true);
console.log(JSON.stringify({ status: 'passed', imageCount: samples.length, fixedBpm: 88, baselineRhythms: 1, fixtureRhythms: fixtureUnique, extendedRhythms: extendedUnique, simplifiedRhythms: fallbackUnique, substantialOnsetThreshold: .20, contrastingPairs: pairs, localEditOnsetDistance: localDistance, crossFamilyOnsetDistance: { min: distances[0], median: distances[Math.floor(distances.length / 2)], max: distances.at(-1), pairs: distances.length }, tempos: [...new Set(natural.map(s => s.bpm))].sort((a, b) => a - b), fixtures: natural.slice(0, 12).map((s, i) => ({ name: samples[i].name, bpm: s.bpm, scoreHash: s.scoreHash, rhythmFingerprint: s.rhythmFingerprint, allocations: s.diagnostics.allocations, rests: s.rests.length })) }, null, 2));
