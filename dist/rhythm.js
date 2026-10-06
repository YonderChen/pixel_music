(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PixelMusicRhythm = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
  const mean = xs => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const fixed = x => Math.round(x * 1e6) / 1e6;
  const quant = (x, steps) => Math.round(x * steps) / steps;
  const COEFFICIENTS = Object.freeze({ version: 'image-fidelity-v1', changeScale: .20, textureScale: .18, noiseFloor: .012, boundary: .09, cumulativeBoundary: .07, periodicConfidence: .72, periodicTexture: .13 });
  function feature(n) {
    const light = n.featureLight ?? n.light, hue = n.featureHue ?? n.hue;
    const chroma = (n.featureSaturation ?? n.saturation ?? 0) * (1 - Math.abs(2 * light - 1));
    return [quant(light, 128), quant(chroma * Math.cos(hue * Math.PI * 2), 64), quant(chroma * Math.sin(hue * Math.PI * 2), 64), quant(chroma, 64)];
  }
  function difference(a, b) { return fixed(Math.max(Math.abs(a[0] - b[0]), Math.hypot(a[1] - b[1], a[2] - b[2]) / 1.5, Math.abs(a[3] - b[3]) * .5)); }
  function colourDistance(a, b) { return difference(feature(a), feature(b)); }
  function describe(raw, structure = {}) {
    const vectors = raw.map(feature), periodicity = structure.periodicity || 0;
    const notes = raw.map((n, i) => {
      const delta = i ? difference(vectors[i], vectors[i - 1]) : 0;
      const change = clamp((delta - COEFFICIENTS.noiseFloor) / COEFFICIENTS.changeScale);
      const texture = clamp(((n.coarseVariation ?? 0) - COEFFICIENTS.noiseFloor) / COEFFICIENTS.textureScale) * (n.organization ?? 0);
      const organized = texture * (.25 + .75 * periodicity);
      const complexity = fixed(clamp(.50 * change + .35 * organized + .15 * periodicity * change));
      return { ...n, vector: vectors[i], delta, change, organized: fixed(organized), texture: fixed(texture), complexity, activity: complexity, salience: fixed(clamp(delta / .30)), stable: delta <= .025 && texture < .08 };
    });
    let run = 0, maxStableRun = 0;
    notes.forEach(n => { run = n.stable ? run + 1 : 0; n.stableRun = run; maxStableRun = Math.max(maxStableRun, run); });
    const complexity = fixed(mean(notes.map(n => n.complexity)));
    return { notes, complexity, activity: complexity, stableRatio: mean(notes.map(n => Number(n.stable))), maxStableRun, periodicity, period: structure.period || null, version: COEFFICIENTS.version, bpm: clamp(Math.round((76 + 28 * complexity) / 2) * 2, 76, 104) };
  }
  function periodicBin(n, profile) {
    const p = profile.period;
    if (!p || p.strength < COEFFICIENTS.periodicConfidence || n.texture < COEFFICIENTS.periodicTexture) return null;
    const coordinate = p.direction === 'horizontal' ? n.col * 8 + 4 : n.row * 24 + 12;
    return Math.floor((coordinate - p.phasePixels) / p.pixels);
  }
  function groupTargets(targets, profile) {
    const groups = [];
    targets.forEach((target, i) => {
      const n = profile.notes[i], previous = profile.notes[i - 1], group = groups.at(-1), reasons = [];
      if (!group) reasons.push({ kind: 'image-start' });
      else {
        const drift = difference(n.vector, profile.notes[group.startIndex].vector);
        if (target.midi !== group.midi) reasons.push({ kind: 'pitch-target-change', target: target.target, baseMidi: target.baseMidi, previousMidi: group.midi });
        if (n.delta > COEFFICIENTS.boundary) reasons.push({ kind: 'spatial-boundary', distance: n.delta });
        if (drift > COEFFICIENTS.cumulativeBoundary) reasons.push({ kind: 'cumulative-colour-drift', distance: drift, anchorRegion: group.regionIds[0] });
        const bin = periodicBin(n, profile), previousBin = periodicBin(previous, profile);
        if (bin !== null && previousBin !== null && bin !== previousBin) reasons.push({ kind: 'measured-period', ...profile.period, phaseBin: bin, previousPhaseBin: previousBin });
      }
      if (reasons.length) groups.push({ startIndex: i, endIndex: i, midi: target.midi, regionIds: [target.regionId], reasons });
      else { group.endIndex = i; group.regionIds.push(target.regionId); }
    });
    return groups;
  }
  function plan(targets, structure, options = {}) {
    const profile = describe(targets, structure), groups = groupTargets(targets, profile);
    const simplified = !!(options.forceRhythmFallback || options.forceFallback);
    const restTicks = groups.map((g, i) => {
      const next = groups[i + 1];
      if (!next || g.regionIds.length < 5) return 0;
      const slice = profile.notes.slice(g.startIndex, g.endIndex + 1), boundary = profile.notes[next.startIndex];
      return mean(slice.map(n => n.complexity)) < .10 && boundary.delta > .30 ? boundary.delta > .65 ? 2 : 1 : 0;
    });
    const minimums = restTicks.map(r => 2 + r), remaining = 256 - minimums.reduce((a, b) => a + b, 0);
    if (remaining < 0) throw new Error('声音片段超出 64 拍时间预算');
    const weights = groups.map(g => {
      const slice = profile.notes.slice(g.startIndex, g.endIndex + 1);
      return g.regionIds.length * (simplified ? 1 : 1 - mean(slice.map(n => n.complexity)) * .35 + slice[0].salience * .15);
    }), total = weights.reduce((a, b) => a + b, 0);
    const ideal = weights.map(w => remaining * w / total), ticks = ideal.map((v, i) => minimums[i] + Math.floor(v));
    const priority = ideal.map((v, i) => ({ i, fraction: fixed(v - Math.floor(v)) })).sort((a, b) => b.fraction - a.fraction || a.i - b.i);
    for (let i = 0, extra = 256 - ticks.reduce((a, b) => a + b, 0); i < extra; i++) ticks[priority[i].i]++;
    let cursor = 0; const rests = [];
    groups.forEach((g, i) => {
      g.beat = cursor / 4; g.beats = (ticks[i] - restTicks[i]) / 4;
      cursor += ticks[i];
      if (restTicks[i]) rests.push({ beat: cursor / 4 - restTicks[i] / 4, beats: restTicks[i] / 4, scope: 'ensemble', regionId: g.regionIds.at(-1), reason: 'measured-spatial-boundary', distance: profile.notes[groups[i + 1].startIndex].delta });
    });
    return { groups, profile, rests, simplified, totalBeats: 64 };
  }
  return { COEFFICIENTS, feature, difference, colourDistance, describe, groupTargets, plan };
});
