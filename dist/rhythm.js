(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PixelMusicRhythm = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
  const mean = xs => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const quantize = x => Math.round(x * 8) / 8;
  const COEFFICIENTS = Object.freeze({ changeScale: .22, textureScale: .18, colourScale: .24, stabilityThreshold: .10, version: 'spatial-rhythm-v1' });
  function colourDistance(a, b) {
    const d = Math.abs(a.hue - b.hue), saturation = Math.min(a.saturation ?? .4, b.saturation ?? .4);
    return Math.min(d, 1 - d) * 2 * saturation + Math.abs((a.saturation ?? .4) - (b.saturation ?? .4)) * .25;
  }
  function describe(raw, structure = {}) {
    const notes = raw.map((n, i) => {
      const previous = raw[Math.max(0, i - 1)], next = raw[Math.min(raw.length - 1, i + 1)];
      const change = clamp((Math.abs(n.light - previous.light) + Math.abs(n.light - next.light)) / (2 * COEFFICIENTS.changeScale));
      const colour = clamp((colourDistance(n, previous) + colourDistance(n, next)) / (2 * COEFFICIENTS.colourScale));
      const texture = clamp((n.coarseVariation ?? n.density * .09) / COEFFICIENTS.textureScale);
      const organization = n.organization ?? .6;
      const activity = clamp(.48 * change + .27 * texture * organization + .25 * colour);
      return { ...n, change, colour, texture, activity, salience: clamp(.65 * change + .35 * colour), stable: activity < COEFFICIENTS.stabilityThreshold };
    });
    let stableRun = 0, maxStableRun = 0;
    notes.forEach(n => { stableRun = n.stable ? stableRun + 1 : 0; n.stableRun = stableRun; maxStableRun = Math.max(maxStableRun, stableRun); });
    const stableRatio = mean(notes.map(n => Number(n.stable)));
    const spatialChange = mean(notes.map(n => n.change));
    const colourContrast = mean(notes.map(n => n.colour));
    const organizedTexture = structure.organizedTexture ?? mean(notes.map(n => n.texture * (n.organization ?? .6)));
    const activity = clamp(.45 * spatialChange + .30 * organizedTexture + .15 * colourContrast + .10 * (1 - stableRatio));
    // A small global quantization protects the motif from insignificant local edits.
    const anchorMargins = [];
    const anchors = Array.from({ length: 6 }, (_, i) => {
      const slice = notes.slice(i * 20, i * 20 + 20);
      const values = { light: mean(slice.map(n => n.light)), activity: mean(slice.map(n => n.activity)), colour: mean(slice.map(n => n.colour)), texture: mean(slice.map(n => n.texture)) };
      anchorMargins.push(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, .0625 - Math.abs(value - quantize(value))])));
      return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, quantize(value)]));
    });
    const lightMean = mean(anchors.map(a => a.light));
    const motif = Array.from({ length: 8 }, (_, i) => {
      const a = anchors[Math.floor(i * 6 / 8)], b = anchors[(Math.floor(i * 6 / 8) + 1) % 6];
      // This is a generated duration contour, not a lookup of complete rhythm templates.
      return 2 + (a.light - lightMean) * 2.6 + (b.light - a.light) * 1.8 + a.colour * .8 - a.activity * 1.1 + a.texture * (i % 2 ? -.45 : .45);
    });
    return { notes, anchors, anchorMargins, motif, activity, stableRatio, maxStableRun, spatialChange, colourContrast, organizedTexture, bpm: clamp(Math.round((76 + 28 * activity) / 2) * 2, 76, 104), version: COEFFICIENTS.version };
  }
  function allocate(slice, phase, motif) {
    const windows = Array.from({ length: 4 }, (_, i) => slice.slice(Math.floor(i * 30 / 4), Math.floor((i + 1) * 30 / 4)));
    const demand = windows.map((w, i) => mean(w.map(n => n.activity)) * 3.8 + mean(w.map(n => n.salience)) * .5 - (i === 3 ? .5 : 0) + (motif[i * 2] - 2) * .35 + (phase === 1 && i === 2 ? .3 : phase === 3 && i === 3 ? -.3 : 0));
    const center = mean(demand); let best = null;
    for (let a = 6; a <= 9; a++) for (let b = 6; b <= 9; b++) for (let c = 6; c <= 9; c++) {
      const d = 30 - a - b - c, counts = [a, b, c, d];
      if (d < 6 || d > 9 || counts.some((n, i) => i && Math.abs(n - counts[i - 1]) > 2)) continue;
      const cost = counts.reduce((s, n, i) => s + (n - (7.5 + demand[i] - center)) ** 2, 0);
      if (!best || cost < best.cost - 1e-9) best = { counts, cost };
    }
    return best.counts;
  }
  function searchBar(slice, barIndex, profile, previous, simplified, allowRest) {
    const count = slice.length, lastBar = barIndex % 4 === 3, final = barIndex === 15;
    const activity = mean(slice.map(n => n.activity)), stable = mean(slice.map(n => Number(n.stable)));
    const restTicks = !allowRest || barIndex === 0 ? 0 : clamp(Math.round((.45 - activity) * 2 + stable * 1.1 + (lastBar && !final ? .6 : 0) + (Math.floor(barIndex / 4) === 1 ? .25 : 0)), 0, 3);
    const positions = restTicks ? Array.from(new Set([...(barIndex % 4 ? [0] : []), 2, Math.floor(count / 2), count - 2, ...(!final ? [count] : [])])) : [-1];
    let winner = null;
    for (const restAt of positions) {
      const boundary = slice[Math.min(count - 1, Math.max(0, restAt))];
      const pauseCost = !restTicks ? 0 : restAt === count ? lastBar ? -.2 : .3 : restAt === 0 ? .18 - boundary.salience * .4 : .12 - boundary.salience * .75;
      let states = [{ tick: 0, run: 0, last: 2, cost: pauseCost, spans: [] }];
      for (let i = 0; i < count; i++) {
        const next = new Map(), region = slice[i];
        const motifPosition = Math.floor(i * 8 / count), motif = profile.motif[(motifPosition + (barIndex % 2 ? 2 : 0)) % 8];
        const phase = Math.floor(barIndex / 4);
        const average = (16 - restTicks) / count;
        const desired = clamp(average + (motif - mean(profile.motif)) * .7 + region.salience * 1.15 - (region.activity - activity) * 1.8 + (phase === 1 && i % 3 === 1 ? .25 : 0), 1, 5);
        for (const state of states) for (const span of [1, 2, 3, 4, 6]) {
          const tick = state.tick + (i === restAt ? restTicks : 0), end = tick + span;
          const run = span === 1 ? state.run + 1 : 0;
          const minimumEnd = i === count - 1 ? final ? 4 : lastBar ? 3 : 2 : 1;
          if (run > 3 || span < minimumEnd || end > 16 || end + (count - i - 1) + (restAt > i ? restTicks : 0) > 16) continue;
          if (i === count - 1 && end + (restAt === count ? restTicks : 0) !== 16) continue;
          const onsetStrength = tick % 8 === 0 ? 1 : tick % 4 === 0 ? .55 : .15;
          let cost = state.cost + (span - desired) ** 2 * .62 + Math.abs(span - state.last) * .08;
          cost += region.salience * (1 - onsetStrength) * .6;
          if (span === 1 && state.last === 1) cost += .18;
          if (span >= 4 && tick % 2) cost += .12;
          // Reuse the image motif, but local activity is allowed to depart from the previous bar.
          if (previous && !simplified) cost += Math.abs(span - previous[Math.floor(i * previous.length / count)]) * .08;
          if (restTicks && i === restAt) cost += (.55 - region.salience) * .3 + (restAt === 0 ? .25 : 0);
          cost = Math.round(cost * 1e8) / 1e8;
          const candidate = { tick: end, run, last: span, cost, spans: state.spans.concat(span) };
          const key = `${end}:${run}:${span}`, existing = next.get(key);
          if (!existing || cost < existing.cost - 1e-9) next.set(key, candidate);
        }
        states = [...next.values()];
      }
      const candidate = states.sort((a, b) => a.cost - b.cost || (a.spans.join(',') < b.spans.join(',') ? -1 : a.spans.join(',') > b.spans.join(',') ? 1 : 0))[0];
      if (candidate && (!winner || candidate.cost < winner.cost - 1e-9)) winner = { ...candidate, restAt, restTicks };
    }
    if (!winner && (!simplified || allowRest)) return { ...searchBar(slice, barIndex, profile, previous, true, false), simplified: true };
    if (!winner) throw new Error('节奏预算无法满足约束');
    let tick = 0; const events = [], rests = [];
    winner.spans.forEach((span, i) => {
      if (i === winner.restAt) { rests.push({ beat: barIndex * 4 + tick / 4, beats: winner.restTicks / 4, bar: barIndex, phrase: Math.floor(barIndex / 4) }); tick += winner.restTicks; }
      events.push({ beat: barIndex * 4 + tick / 4, beats: span / 4, accent: clamp(.75 + slice[i].salience * .2 + (tick % 8 === 0 ? .12 : 0), .75, 1.08) }); tick += span;
    });
    if (winner.restAt === count) rests.push({ beat: barIndex * 4 + tick / 4, beats: winner.restTicks / 4, bar: barIndex, phrase: Math.floor(barIndex / 4) });
    return { events, rests, spans: winner.spans, count, activity, rest: winner.restTicks / 4, cost: winner.cost, simplified: !!simplified };
  }
  function plan(raw, structure, options = {}) {
    const profile = describe(raw, structure), bars = [], rests = []; let cursor = 0, previous = null;
    const allocations = [];
    for (let phrase = 0; phrase < 4; phrase++) {
      previous = null;
      const slice = profile.notes.slice(phrase * 30, phrase * 30 + 30), counts = allocate(slice, phrase, profile.motif); allocations.push(counts);
      let offset = 0;
      const pauseCandidates = counts.slice(0, 3).map((count, i) => {
        const window = slice.slice(offset, offset + count); offset += count;
        return { i, activity: mean(window.map(n => n.activity)), score: mean(window.map(n => Number(n.stable))) - mean(window.map(n => n.activity)) + window.at(-1).salience * .25 + mean(window.map(n => Math.min(n.stableRun, 5) / 5)) * .08 };
      }).filter(c => (phrase || c.i) && c.activity < .26).sort((a, b) => b.score - a.score || a.i - b.i);
      const pauseBar = pauseCandidates[0]?.i;
      counts.forEach((count, i) => {
        const slice = profile.notes.slice(cursor, cursor + count), bar = searchBar(slice, phrase * 4 + i, profile, previous, !!options.forceRhythmFallback, i === 3 || i === pauseBar);
        bars.push(bar); rests.push(...bar.rests); cursor += count; previous = bar.spans;
      });
    }
    return { profile, bars, rests, allocations, simplified: bars.some(b => b.simplified), simplifiedBars: bars.flatMap((b, i) => b.simplified ? [i] : []) };
  }
  return { COEFFICIENTS, colourDistance, describe, plan };
});
