(function (root, factory) {
  const music = typeof module === 'object' && module.exports ? require('./music.js') : root.PixelMusic;
  const api = factory(music);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PixelMusicLegacy = api;
})(typeof globalThis === 'object' ? globalThis : this, function (music) {
  'use strict';
  // Frozen 0.3 note/rhythm selection. Do not tune this while tuning the new composer.
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  function arrangeRegions(columns, root, modeValue) {
    const mode = music.modeOf(modeValue);
    const harmonyScale = mode.id === 'deep' ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
    const progression = [0, 5, 3, 4, 0, 5, 3, 4, 3, 1, 4, 0];
    const raw = music.orderedRegions(columns);
    const phraseContour = [0, 2, 4, 3, 2, 1, 2, 4, 3, 1];
    const motif = raw.slice(0, 10).map((note, index) => phraseContour[index] + Math.round((note.light - .5) * 2 + (note.hue - .5) * 2));
    const rhythm = [.5, .25, .25, .5, .5, .25, .25, .5, .5, .5];
    const closingRhythm = [.5, .25, .25, .5, .25, .25, .25, .25, .5, 1];
    const tonic = 60 + root, allowed = [];
    for (let octave = -1; octave <= 2; octave++) for (const degree of mode.notes) {
      const midi = tonic + octave * 12 + degree;
      if (midi >= tonic - 5 && midi <= tonic + 14) allowed.push(midi);
    }
    let previous = tonic + 4, beat = 0;
    const bars = progression.map((degree, index) => ({ index, beat: index * 4, chord: [degree, degree + 2, degree + 4].map(d => harmonyScale[d % 7] + Math.floor(d / 7) * 12), bass: 36 + root + harmonyScale[degree] }));
    const melody = raw.map((region, index) => {
      const barIndex = Math.floor(index / 10), position = index % 10, bar = bars[barIndex];
      const beats = (barIndex === 11 ? closingRhythm : rhythm)[position];
      const strong = Math.abs(beat - Math.round(beat)) < .001;
      const pitchClasses = bar.chord.map(pitch => pitch % 12);
      const contour = clamp(motif[position] + (barIndex >= 4 && barIndex < 8 ? 1 : 0), 0, mode.notes.length);
      const motifPitch = mode.notes[contour % mode.notes.length] + Math.floor(contour / mode.notes.length) * 12;
      const regionalOffset = (region.light - .5) * 3 + (2 - region.row) * .35 + region.density * .6 + (region.signature ?? 0) * .5;
      const closing = index >= raw.length - 4;
      const target = closing ? tonic + Math.max(0, 3 - (index - (raw.length - 4))) : tonic + motifPitch + regionalOffset;
      const harmonicCandidates = allowed.filter(midi => (!strong || pitchClasses.includes((midi - tonic + 12) % 12)) && (!closing || midi <= tonic + 7));
      const nearby = harmonicCandidates.filter(midi => Math.abs(midi - previous) <= 7);
      const candidates = nearby.length ? nearby : harmonicCandidates;
      const midi = index === raw.length - 1 ? tonic : candidates.reduce((best, value) => {
        const score = pitch => Math.abs(pitch - target) + Math.abs(pitch - previous) * .3 + Math.max(0, Math.abs(pitch - previous) - 5) * 5;
        return score(value) < score(best) ? value : best;
      }, candidates[0]);
      previous = midi;
      const event = { ...region, midi, noteName: music.midiToName(midi), regionId: `${region.col}:${region.row}`, index, sequence: index, beat, beats, durationBeats: beats, bar: barIndex, strong };
      Object.assign(region, { midi, noteName: event.noteName, sequence: index });
      beat += beats; return event;
    });
    return { melody, bars, totalBeats: beat, tonic, root, mode, rests: [], phrases: [] };
  }
  function compose(analysis, options = {}) {
    const columns = analysis.columns.map(c => ({ notes: c.notes.map(n => ({ ...n })) }));
    const root = analysis.legacy.root, mode = music.modeOf(analysis.legacy.modeId);
    const arranged = arrangeRegions(columns, root, mode);
    const bpm = options.bpm ?? analysis.legacy.bpm, secondsPerBeat = 60 / bpm;
    const score = { ...analysis, ...arranged, columns, version: '0.3.0', synthVersion: '0.3.0', bpm, secondsPerBeat, melodyDuration: 48 * secondsPerBeat, duration: 48 * secondsPerBeat + 1.8 };
    score.scoreHash = music.scoreFingerprint(score);
    return score;
  }
  return { arrangeRegions, compose };
});
