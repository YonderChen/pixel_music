/* composition.py of the pinned upstream engine (Simple synthesizer only): key, scale,
 * tempo, instruments, the reference score and its pad, chord, bass and texture layers. */
(self.PixelMusicEngineModules = self.PixelMusicEngineModules || []).push(function (PM) {
  'use strict';
  const {np, analysis} = PM;
  const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const SCALES = {'Major pentatonic': [0, 2, 4, 7, 9], 'Minor pentatonic': [0, 3, 5, 7, 10], 'Major': [0, 2, 4, 5, 7, 9, 11],
    'Natural minor': [0, 2, 3, 5, 7, 8, 10], 'Dorian': [0, 2, 3, 5, 7, 9, 10], 'Lydian': [0, 2, 4, 6, 7, 9, 11]};
  const DISPLAY = {bowed_string: 'Bowed string', bright_bell: 'Bright bell', celesta: 'Celesta', cello: 'Cello-like bass',
    clarinet_like_reed: 'Clarinet-like reed', flute_like_lead: 'Flute-like lead', glass_pad: 'Glass pad', harp: 'Harp',
    kalimba: 'Kalimba', marimba: 'Marimba', music_box: 'Music box', soft_bass: 'Soft bass', soft_piano: 'Soft piano',
    synth_pluck: 'Synth pluck', warm_pad: 'Warm pad'};
  const KEYS = Object.fromEntries(Object.entries(DISPLAY).map(([k, v]) => [v, k]));
  // 10 ** (dB / 20) for the fixed layer gains, as CPython computes them.
  const GAIN = {'0': 1, '-1': .8912509381337456, '-2': .7943282347242815, '-3': .7079457843841379, '-8': .3981071705534972};

  const instrumentLabel = name => (name === 'none' ? '—' : (DISPLAY[name] || name).toLowerCase());
  const instrumentKey = name => (name === 'None' ? 'none' : KEYS[name] || 'soft_piano');

  function computeBarSettings(f) {
    const total = 0 + .4 + .25 + .2 + .15;
    const score = np.clamp(.4 / total * (f.texture_entropy ?? 0) + .25 / total * (f.edge_density ?? 0)
      + .2 / total * (f.high_frequency_energy ?? 0) + .15 / total * (f.periodic_peak_score ?? 0), 0, 1);
    const mn = np.round(np.interp(score, [0, 1], [4, 8])), mx0 = np.round(np.interp(score, [0, 1], [12, 24]));
    const mx = mx0 <= mn ? mn + 1 : mx0, df = np.round(np.interp(score, [0, 1], [6, 16]));
    return [np.clamp(mn, 1, 64), np.clamp(mx, mn + 1, 64), np.clamp(df, mn, mx)];
  }

  function chooseScale(f, requested) {
    if (requested !== 'Automatic' && SCALES[requested]) return requested;
    const b = f.mean_brightness, sat = f.mean_saturation, warm = f.warmth, c = f.contrast;
    if (b > .6) return warm > .06 ? 'Lydian' : 'Major pentatonic';
    if (b > .42) return (warm > .06 && sat > .38) || c > .22 ? 'Dorian' : 'Major pentatonic';
    return warm > .05 && sat > .3 ? 'Dorian' : 'Natural minor';
  }

  function chooseInstruments(f, mode) {
    if (mode === 'Manual') return ['soft_piano', 'harp', 'cello', 'warm_pad', 'soft_piano', 'none'];
    const b = f.mean_brightness, h = f.highlight_proportion, sh = f.shadow_proportion, hi = f.high_frequency_energy,
      lo = f.low_frequency_energy, peak = f.periodic_peak_score, sat = f.mean_saturation, warm = f.warmth, c = f.contrast;
    const main = h > .14 && hi > .28 ? 'bright_bell' : b > .64 ? 'celesta' : peak > .58 ? 'kalimba' : peak > .48 ? 'marimba'
      : warm > .07 && sat > .42 ? 'harp' : c > .25 && hi > .28 ? 'synth_pluck' : 'soft_piano';
    const texture = hi > .44 || h > .16 ? 'bright_bell' : hi > .32 ? 'celesta' : peak > .55 ? 'kalimba' : sat > .45 && warm > .02 ? 'harp' : 'music_box';
    const bass = sh > .26 || b < .36 ? 'cello' : 'soft_bass';
    const pad = (lo > .52 && warm > .04) || sh > .2 ? 'warm_pad' : 'glass_pad';
    return [main, texture, bass, pad, main !== 'soft_piano' ? 'soft_piano' : 'harp', 'none'];
  }

  function describeMood(f) {
    const light = f.mean_brightness > .58 ? 'bright' : f.mean_brightness < .4 ? 'dark' : 'balanced';
    const color = f.warmth > .04 ? 'warm' : f.warmth < -.04 ? 'cool' : 'neutral';
    const contrast = f.contrast > .24 ? 'dynamic' : f.contrast < .13 ? 'soft' : 'moderately dynamic';
    const texture = f.high_frequency_energy > .32 ? 'textured' : f.high_frequency_energy < .18 ? 'smooth' : 'moderately textured';
    const focus = (f.saliency_area ?? 0) < .08 && (f.saliency_peak ?? 0) > .75 ? 'focused' : 'diffuse';
    return `${light}, ${color}, ${contrast}, ${texture}, ${focus}`;
  }

  function buildScaleNotes(root, intervals, low, high) {
    const out = new Set();
    for (let octave = -3; octave < 7; octave++) for (const interval of intervals) {
      const n = root + 12 * octave + interval;
      if (low <= n && n <= high) out.add(n);
    }
    return [...out].sort((a, b) => a - b);
  }

  function chordFromScaleDegree(intervals, degree) {
    const n = intervals.length, at = step => intervals[np.mod(step, n)] + 12 * Math.floor(step / n);
    return [at(degree), at(degree + 2), at(degree + 4)];
  }

  function chooseProgression(scaleName, f) {
    const intervals = SCALES[scaleName] || SCALES['Major pentatonic'], n = intervals.length;
    const seed = Math.trunc(f.dominant_hue * 997 + f.periodic_peak_score * 113 + (f.texture_entropy ?? 0) * 71 + (f.saliency_centroid_x ?? 0) * 53);
    const pools = n >= 7 ? [[0, 4, 5, 3], [0, 5, 3, 4], [0, 2, 5, 4], [0, 3, 1, 4]] : [[0, 2, 3, 4], [0, 3, 2, 1], [0, 1, 4, 2]];
    return pools[np.mod(seed, pools.length)].map(d => chordFromScaleDegree(intervals, np.mod(d, n)));
  }

  // time_slice_statistics(luminance, n): energy, contrast and bright centroid of vertical strips.
  function timeSliceStatistics(light, h, w, slices) {
    const stats = [];
    for (let i = 0; i < slices; i++) {
      const x0 = np.round(i * w / slices), x1 = Math.max(1, np.round((i + 1) * w / slices)), end = Math.max(x0 + 1, x1);
      const v = analysis.view(light, w, 1, 0, h, x0, end), sl = analysis.values(v), cols = end - x0;
      const cut = np.percentile(sl, 35), weights = new Float64Array(sl.length), weighted = new Float64Array(sl.length);
      for (let k = 0; k < sl.length; k++) { weights[k] = Math.max(sl[k] - cut, 0); weighted[k] = Math.floor(k / cols) * weights[k]; }
      const total = np.sum(weights);
      const yc = total <= 1e-12 ? .5 : np.sum(weighted) / np.sum(weights) / Math.max(1, h - 1);
      stats.push({energy: analysis.viewMean(v), contrast: analysis.viewStd(v), y_centroid: yc});
    }
    return stats;
  }

  const note = (start, duration, midi, velocity, instrument, pan, layer) => ({start, duration, midi, velocity, instrument, pan, layer});
  const sortEvents = events => np.sortBy(events, e => [e.start, e.layer, e.midi]);

  /* generate_composition(analysis, bars, complexity, variation, scale, 'Simple', mode, ..., mapping, bpm,
   * 0, -2, 0, -8, -3, -1): the fixed layer gains are the only ones this site uses. `instruments`
   * (main, texture, bass, pad, chord), when given, replaces the automatic choice (image mood). */
  function generateComposition(result, bars, complexity, variation, requestedScale, instrumentMode, mappingStyle, manualBpm, instruments = null) {
    const f = result.features, {luminance: light, width: w, height: h} = result.maps;
    const b = f.mean_brightness, c = f.contrast, sh = f.shadow_proportion, edge = f.edge_density, sat = f.mean_saturation,
      warm = f.warmth, lo = f.low_frequency_energy, hi = f.high_frequency_energy, centroid = f.fourier_centroid,
      bw = f.fourier_bandwidth, peak = f.periodic_peak_score;
    const keyIndex = np.mod(np.round(f.dominant_hue * 12), 12), keyName = KEY_NAMES[keyIndex];
    const scaleName = chooseScale(f, requestedScale), intervals = SCALES[scaleName];
    const root = Math.trunc(np.clamp(48 + keyIndex + np.round(np.interp(b, [0, 1], [-5, 7])), 38, 58));
    let tempo;
    if (mappingStyle === 'Manual' && manualBpm != null) tempo = Math.max(1, manualBpm);
    else if (mappingStyle === 'Scientific') tempo = np.clamp(50 + 70 * edge + 58 * c + 42 * peak + 34 * hi + 22 * centroid - 20 * sh, 48, 152);
    else if (mappingStyle === 'Musical') tempo = np.clamp(82 + 10 * sat + 8 * b - 6 * sh + 4 * warm, 72, 108);
    else tempo = np.clamp(62 + 38 * edge + 28 * c + 20 * peak + 10 * hi - 8 * sh, 56, 132);
    const beat = 60 / tempo;
    bars = Math.trunc(np.clamp(Math.trunc(bars), 1, 64));
    const duration = Math.min(120, bars * 4 * beat);
    const [mainI, texI, bassI, padI, chordI] = instruments || chooseInstruments(f, instrumentMode), soloI = 'none';
    const progression = chooseProgression(scaleName, f);
    const melodyNotes = buildScaleNotes(root, intervals, root + 10, root + 31), bassNotes = buildScaleNotes(root, intervals, root - 18, root + 7);
    const events = [];
    const panBias = np.interp(f.bright_centroid_x, [0, 1], [-.45, .45]), shadowPan = np.interp(f.shadow_centroid_x, [0, 1], [-.35, .35]);
    const padVelocity = np.clamp(.07 + .18 * lo + .04 * (1 - hi), .04, .28), chordVelocity = np.clamp(.28 + .42 * b + .18 * lo, .22, .78);
    const bassVelocity = np.clamp(.3 + .55 * sh + .25 * lo, .22, .86);
    const melodyVelocity = np.clamp(.3 + .3 * f.dynamic_range + .2 * c + .15 * sat, .28, .9);
    const gains = {main: GAIN['0'], texture: GAIN['-2'], bass: GAIN['0'], pad: GAIN['-8'], chord: GAIN['-3']};
    for (let bar = 0; bar < bars; bar++) {
      const start = bar * 4 * beat;
      const chord = progression[(bar + (variation > .45 && bar >= Math.floor(bars / 2) ? 1 : 0)) % progression.length];
      const chordNotes = chord.map(x => root + x);
      for (const n of chordNotes) events.push(note(start, 4.05 * beat, Math.trunc(np.clamp(n + 12, 36, 88)), np.clamp(padVelocity * gains.pad, 0, 1), padI, .15 * PM.libm.sin(bar * .7), 'pad'));
      for (let hit = 0; hit < (hi > .22 ? 2 : 1); hit++) for (const n of chordNotes) {
        events.push(note(start + hit * 2 * beat, 1.75 * beat, Math.trunc(np.clamp(n + 12, 38, 92)),
          np.clamp(chordVelocity * (hit ? .92 : 1) * gains.chord, 0, 1), chordI, panBias * .45, 'chord'));
      }
      const rb = bassNotes.length ? np.minBy(bassNotes, x => [Math.abs(x - (root - 12))]) : root - 12;
      events.push(note(start, 1.55 * beat, rb, np.clamp(bassVelocity * gains.bass, 0, 1), bassI, shadowPan, 'bass'));
      events.push(note(start + 2 * beat, 1.35 * beat, rb + 7, np.clamp(bassVelocity * .82 * gains.bass, 0, 1), bassI, shadowPan * .7, 'bass'));
    }
    const slices = timeSliceStatistics(light, h, w, bars * 8), step = complexity > .52 ? 1 : 2;
    for (let i = 0; i < slices.length; i += step) {
      const sl = slices[i];
      if (sl.energy < .1 && i % 4 !== 0) continue;
      const pos = np.clamp(1 - sl.y_centroid + .18 * (sl.energy - b), 0, 1);
      let midi = melodyNotes[np.round(pos * (melodyNotes.length - 1))];
      const section = Math.min(3, Math.trunc(i / Math.max(1, slices.length) * 4));
      midi += np.round([0, 2, -2, 5][section] * variation);
      const dur = (.42 + .52 * (1 - hi) + .25 * sl.energy) * beat, vel = np.clamp((melodyVelocity + .25 * sl.contrast) * gains.main, 0, 1);
      events.push(note(i * .5 * beat, dur, Math.trunc(np.clamp(midi, 36, 100)), vel, mainI, np.clamp(panBias + .2 * PM.libm.sin(i * .37), -.75, .75), 'main'));
    }
    const density = np.clamp(.2 + .8 * complexity + .75 * hi + .45 * bw, 0, 1);
    if (density > .28 && texI !== 'none') {
      const interval = density > .55 ? .5 * beat : beat;
      for (let j = 0; j < Math.trunc(duration / interval); j++) {
        const t = j * interval, chord = progression[np.mod(np.floorDiv(t, 4 * beat), progression.length)];
        const pat = [...chord, chord[1] + 12, chord[2] + 12];
        events.push(note(t, .34 * beat, Math.trunc(np.clamp(root + pat[j % pat.length] + 12, 45, 96)),
          np.clamp((.16 + .4 * hi + .22 * edge) * gains.texture, 0, 1), texI, np.clamp(-.45 + .9 * ((j % 8) / 7), -.65, .65), 'texture'));
      }
    }
    if (density > .18) {
      const sub = density < .55 ? .5 * beat : .25 * beat;
      for (let j = 0; j < Math.trunc(duration / sub); j++) {
        if (j % 2 === 1 && density < .62) continue;
        events.push(note(j * sub, .08 * beat, [0, 3].includes(j % 4) ? 76 : 72, np.clamp((.1 + .42 * density) * (j % 8 === 0 ? 1 : .62), .05, .55),
          'texture_tick', .55 * PM.libm.sin(j * .91), 'texture'));
      }
    }
    const kept = sortEvents(events.filter(e => e.start < duration));
    const info = {tempo, bars, duration, key_name: keyName, scale_name: scaleName, main_instrument: mainI, texture_instrument: texI,
      bass_instrument: bassI, pad_instrument: padI, chord_instrument: chordI, solo_instrument: soloI, mood: describeMood(f),
      mapping_summary: {Saliency: 'drives the GeneralUser GS solo/accent layer'}};
    return [kept, info];
  }

  PM.composition = {KEY_NAMES, SCALES, instrumentLabel, instrumentKey, computeBarSettings, chooseScale, chooseInstruments,
    describeMood, buildScaleNotes, chooseProgression, timeSliceStatistics, generateComposition, sortEvents};
});
