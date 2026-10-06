const assert = require('node:assert/strict');
const Music = require('./baseline/music-v05.js');
const pc = n => (n % 12 + 12) % 12;
function check(score) {
  assert.equal(score.melody.length, 120);
  assert.equal(new Set(score.melody.map(n => n.regionId)).size, 120);
  assert.equal(score.totalBeats, 64); assert.equal(score.bars.length, 16);
  assert.equal(score.phrases.length, 4);
  score.phrases.forEach(phrase => {
    const notes = score.melody.filter(n => n.phrase === phrase.index);
    assert.equal(notes.length, 30); assert.equal(notes.at(-1).midi, phrase.endingPitch);
  });
  score.bars.forEach(bar => {
    const notes = score.melody.filter(n => n.bar === bar.index);
    assert.ok(notes.length >= 6 && notes.length <= 9);
    assert.equal(notes.length, bar.noteCount);
    assert.equal(notes.reduce((sum, n) => sum + n.beats, 0) + bar.rest, 4);
    assert.ok(notes[0].beat >= bar.beat && notes.at(-1).beat + notes.at(-1).beats <= bar.beat + 4);
    const intervals = [...notes.map(n => [n.beat, n.beat + n.beats]), ...score.rests.filter(r => r.bar === bar.index).map(r => [r.beat, r.beat + r.beats])].sort((a, b) => a[0] - b[0]);
    assert.equal(intervals[0][0], bar.beat); assert.equal(intervals.at(-1)[1], bar.beat + 4);
    intervals.forEach((r, i) => { if (i) assert.equal(r[0], intervals[i - 1][1], 'no lost or overlapping rhythm budget'); });
    assert.ok(score.rests.filter(r => r.bar === bar.index).length <= 1 && bar.rest <= .75);
    let shortRun = 0;
    notes.forEach(n => { shortRun = n.beats === .25 ? shortRun + 1 : 0; assert.ok(shortRun <= 3); });
    if (bar.index % 4 === 3) assert.ok(notes.at(-1).beats >= (bar.index === 15 ? 1 : .75));
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
    score.rests.forEach(rest => assert.ok(note.beat >= rest.beat + rest.beats || note.beat + note.durationBeats <= rest.beat, 'release must leave the planned breath'));
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
    const pos = Music.playbackPosition(score, Music.beatToTime(score, rest.beat + .05));
    assert.equal(pos.rest, true);
    const later = Music.playbackPosition(score, Music.beatToTime(score, rest.beat + rest.beats - .025));
    assert.equal(pos.index, later.index); assert.equal(pos.scanFraction, later.scanFraction);
  });
  for (let beat = 0; beat <= 66; beat += .125) assert.ok(Math.abs(Music.timeToBeat(score, Music.beatToTime(score, beat)) - beat) < 1e-9);
  assert.equal(score.rhythmFingerprint, Music.rhythmFingerprint(score));
  assert.equal(score.scoreHash, Music.scoreFingerprint(score));
  assert.equal(Music.playbackPosition(score, score.melodyDuration + .3).tail, true);
  assert.equal(Music.playbackPosition(score, score.duration).finished, true);
}
module.exports = check;
