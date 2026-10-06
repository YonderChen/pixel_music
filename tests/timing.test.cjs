const assert = require('node:assert/strict');
const Timing = require('./baseline/timing-v05.js'), Music = require('./baseline/music-v05.js');
const Image = require('./baseline/image-analysis-v05.js'), Fixtures = require('./fixtures.js');
const maps = [
  [{ beat: 0, bpm: 88 }, { beat: 64, bpm: 88 }],
  [{ beat: 0, bpm: 76 }, { beat: 16, bpm: 104 }, { beat: 32, bpm: 76 }, { beat: 64, bpm: 84 }],
  [{ beat: 0, bpm: 104 }, { beat: 60, bpm: 104 }, { beat: 64, bpm: 98 }],
];
maps.forEach(points => {
  const score = { tempoMap: Timing.makeMap(points) }; let previous = -1;
  for (let beat = 0; beat <= 68; beat += .03125) {
    const time = Timing.beatToTime(score, beat); assert.ok(time > previous); previous = time;
    assert.ok(Math.abs(Timing.timeToBeat(score, time) - beat) < 1e-9);
  }
  score.tempoMap.forEach((segment, i) => {
    assert.ok(Math.abs(Timing.beatToTime(score, segment.beat) - segment.seconds) < 1e-9);
    if (i) assert.ok(Math.abs(segment.spb - (score.tempoMap[i - 1].spb + score.tempoMap[i - 1].slope * (score.tempoMap[i - 1].endBeat - score.tempoMap[i - 1].beat))) < 1e-9);
  });
});
assert.throws(() => Timing.makeMap([{ beat: 0, bpm: 0 }, { beat: 64, bpm: 88 }]), /无效/);
const score = Music.compose(Image.analyzePixels(Fixtures.pixels(5))), fixed = Music.compose(Image.analyzePixels(Fixtures.pixels(5)), { bpm: 88, tempo: false });
assert.equal(fixed.melodyDuration, 64 * 60 / 88);
assert.equal(Music.rhythmFingerprint(score), Music.rhythmFingerprint(fixed));
assert.equal(score.duration, Music.beatToTime(score, 64) + 2);
assert.ok(score.tempoMap.at(-1).slope > 0, 'terminal slowing is smooth');
for (const mutate of [s => s.bassEvents[0].beat += .25, s => s.padEvents[0].durationBeats -= .25, s => s.tempoMap[0].slope += .001]) {
  const edited = structuredClone(score); mutate(edited);
  assert.notEqual(Music.scoreFingerprint(edited), score.scoreHash, 'full score fingerprint must include accompaniment and tempo');
}
const lateEntrance = { ...score, melody: score.melody.map((n, i) => i ? n : { ...n, beat: .5 }) };
assert.equal(Music.playbackPosition(lateEntrance, Music.beatToTime(lateEntrance, .25)).index, -1);
assert.equal(Music.playbackPosition(lateEntrance, Music.beatToTime(lateEntrance, .25)).note, null);
assert.equal(Music.playbackPosition(lateEntrance, Music.beatToTime(lateEntrance, .25)).scanFraction, 0);
console.log('Passed: constant/accelerating/decelerating timelines, monotonic inverse, continuous speed, duration, fingerprints and silent entrance.');
