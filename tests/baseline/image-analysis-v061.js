(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./rhythm-v061.js') : root.PixelMusicRhythmV061);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PixelMusicImageV061 = api;
})(typeof globalThis === 'object' ? globalThis : this, function (Rhythm) {
  'use strict';
  const WIDTH = 192, HEIGHT = 120, COLS = 24, ROWS = 5;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min; s = l > .5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    return [h, s, l];
  }
  function digestPixels(bytes) {
    const hashes = [2166136261, 2246822507, 3266489909, 668265263, 374761393, 1274126177, 198491317, 42595009];
    for (const byte of bytes) for (let i = 0; i < hashes.length; i++) hashes[i] = Math.imul((hashes[i] ^ byte ^ i) >>> 0, 16777619 + i * 2) >>> 0;
    return hashes.map(hash => hash.toString(16).padStart(8, '0')).join('');
  }
  function firstRandom(seed) {
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  function spatialStructure(data, block = 4) {
    // Centred multi-scale differences distinguish organized texture from independent noise.
    const w = WIDTH / block, h = HEIGHT / block, cells = Array.from({ length: w * h }, () => [0, 0, 0]);
    const regions = Array.from({ length: COLS * ROWS }, () => ({ variation: 0, pairs: 0, raw: 0, rawPairs: 0, horizontal: 0, vertical: 0 }));
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
      const offset = (y * WIDTH + x) * 4, cell = cells[Math.floor(y / block) * w + Math.floor(x / block)];
      const region = regions[Math.floor(y / 24) * COLS + Math.floor(x / 8)];
      for (let c = 0; c < 3; c++) cell[c] += data[offset + c] / (block * block * 255);
      for (const delta of [x % 8 ? 4 : 0, y % 24 ? WIDTH * 4 : 0]) if (delta) {
        const diff = [0, 1, 2].reduce((s, c) => s + Math.abs(data[offset + c] - data[offset + c - delta]), 0) / 765;
        region.raw += diff; region.rawPairs++;
      }
    }
    const horizontal = [], vertical = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, region = regions[Math.floor(y / (24 / block)) * COLS + Math.floor(x / (8 / block))];
      for (const [valid, delta, direction] of [[x % (8 / block), 1, 'horizontal'], [y % (24 / block), w, 'vertical']]) if (valid) {
        const diff = cells[i].reduce((s, c, channel) => s + Math.abs(c - cells[i - delta][channel]), 0) / 3;
        region.variation += diff; region.pairs++; region[direction] += diff;
      }
      horizontal.push(cells[i].map((c, channel) => x ? c - cells[i - 1][channel] : 0));
      vertical.push(cells[i].map((c, channel) => y ? c - cells[i - w][channel] : 0));
    }
    function repetition(values, direction) {
      let best = { strength: 0, lag: 0, phasePixels: 0, direction: direction === 1 ? 'horizontal' : 'vertical' };
      for (let lag = 2; lag <= 12; lag++) {
        for (let channel = 0; channel < 3; channel++) {
          const pairs = [];
          for (let y = 1; y < h; y++) for (let x = 1; x < w; x++) {
            if ((direction === 1 ? x : y) <= lag) continue;
            pairs.push([values[y * w + x][channel], values[y * w + x - lag * direction][channel]]);
          }
          const ma = pairs.reduce((s, p) => s + p[0], 0) / pairs.length, mb = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
          let product = 0, aa = 0, bb = 0;
          pairs.forEach(([a, b]) => { product += (a - ma) * (b - mb); aa += (a - ma) ** 2; bb += (b - mb) ** 2; });
          const strength = aa > .002 && bb > .002 ? Math.max(0, product / Math.sqrt(aa * bb)) : 0;
          if (strength > best.strength + 1e-6) {
            let phase = 0, maximum = 0;
            values.forEach((v, i) => { if (Math.abs(v[channel] - ma) > maximum) { maximum = Math.abs(v[channel] - ma); phase = direction === 1 ? i % w : Math.floor(i / w); } });
            best = { ...best, strength: Math.round(strength * 1e6) / 1e6, lag, pixels: lag * block, phasePixels: phase * block, scale: block };
          }
        }
      }
      return best;
    }
    const hp = repetition(horizontal, 1), vp = repetition(vertical, w), period = hp.strength >= vp.strength ? hp : vp, periodicity = period.strength;
    const features = regions.map(r => {
      const coarseVariation = r.variation / Math.max(1, r.pairs), rawVariation = r.raw / Math.max(1, r.rawPairs);
      const organization = clamp(coarseVariation / (rawVariation + .003), 0, 1);
      return { coarseVariation, rawVariation, organization, horizontalVariation: r.horizontal / Math.max(1, r.pairs), verticalVariation: r.vertical / Math.max(1, r.pairs) };
    });
    const organizedTexture = features.reduce((s, r) => s + clamp(r.coarseVariation / .18, 0, 1) * r.organization, 0) / features.length * (.35 + .65 * periodicity);
    return { features, periodicity, period: periodicity ? period : null, organizedTexture, version: 'box4-centred-colour-period-v2' };
  }
  function analyzePixels(data, width = WIDTH, height = HEIGHT) {
    if (width !== WIDTH || height !== HEIGHT || data.length !== width * height * 4) throw new Error('需要 192×120 的规范化 RGBA 图像');
    const hash = digestPixels(data), structure = spatialStructure(data), fine = spatialStructure(data, 2);
    // Fine periodic patterns survive; unorganized high-frequency noise does not get promoted.
    if (fine.periodicity > .72 && fine.periodicity >= structure.periodicity - .03 && fine.organizedTexture > structure.organizedTexture + .01) {
      structure.periodicity = fine.periodicity; structure.period = fine.period;
      structure.features = structure.features.map((feature,i) => ({ ...feature, coarseVariation: Math.max(feature.coarseVariation, fine.features[i].coarseVariation), organization: Math.max(feature.organization, fine.features[i].organization) }));
    }
    const trustedPeriod = Math.max(0, (structure.periodicity - .72) / .28);
    structure.features = structure.features.map(feature => ({ ...feature, coarseVariation: Math.max(feature.coarseVariation, feature.rawVariation * trustedPeriod * .45), organization: Math.max(feature.organization, trustedPeriod * .8) }));
    structure.organizedTexture = structure.features.reduce((s,feature) => s + clamp(feature.coarseVariation / .18,0,1) * feature.organization,0) / 120 * (.35 + .65 * structure.periodicity);
    const accum = Array.from({ length: COLS * ROWS }, () => ({ l: 0, s: 0, hx: 0, hy: 0, rgb: [0,0,0], edge: 0, count: 0, seed: 2166136261 }));
    let totalL = 0, totalS = 0, hx = 0, hy = 0, edges = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4, [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      const col = Math.floor(x / 8), row = Math.floor(y / 24), region = accum[row * COLS + col];
      const vx = Math.cos(h * Math.PI * 2) * s, vy = Math.sin(h * Math.PI * 2) * s;
      totalL += l; totalS += s; hx += vx; hy += vy;
      region.l += l; region.s += s; region.hx += vx; region.hy += vy; region.count++;
      for (let c = 0; c < 3; c++) region.rgb[c] += data[i + c];
      for (let c = 0; c < 4; c++) region.seed = Math.imul(region.seed ^ data[i + c], 16777619) >>> 0;
      if (x > 0) {
        const diff = (Math.abs(data[i] - data[i - 4]) + Math.abs(data[i + 1] - data[i - 3]) + Math.abs(data[i + 2] - data[i - 2])) / 765;
        if (diff > .16) { edges++; region.edge++; }
      }
    }
    const count = width * height, avgL = totalL / count, avgS = totalS / count, edgeRatio = edges / count;
    const hue = (Math.atan2(hy, hx) / (Math.PI * 2) + 1) % 1;
    const legacyHue = Math.atan2(hy, hx) / (Math.PI * 2);
    const legacyRoot = Math.floor((legacyHue < 0 ? legacyHue + 1 : legacyHue) * 12) % 12;
    const columns = Array.from({ length: COLS }, (_, col) => ({ notes: Array.from({ length: ROWS }, (_, row) => {
      const region = accum[row * COLS + col], light = region.l / region.count, saturation = region.s / region.count;
      const density = clamp(region.edge / region.count * 12, 0, 1);
      const rh = Math.atan2(region.hy, region.hx) / (Math.PI * 2);
      const regionHue = rh < 0 ? rh + 1 : rh;
      const [featureHue, featureSaturation, featureLight] = rgbToHsl(...region.rgb.map(v => v / region.count));
      const index = (row * COLS + col) % 56, legacySignature = parseInt(hash.slice(index, index + 2), 16) / 255 - .5;
      return { col, row, light, saturation, hue: regionHue, featureHue, featureSaturation, featureLight, density, ...structure.features[row * COLS + col], localSeed: region.seed, signature: legacySignature, velocity: .025 + light * .035 + saturation * .025 + density * .018 };
    }) }));
    const profile = Rhythm.describe(columns.flatMap((column, col) => col % 2 ? column.notes.slice().reverse() : column.notes), structure);
    const flat = columns.flatMap(c => c.notes), chroma = n => n.featureSaturation * (1 - Math.abs(2 * n.featureLight - 1));
    const colourX = flat.reduce((s,n) => s + chroma(n) * Math.cos(n.featureHue * Math.PI * 2),0) / 120, colourY = flat.reduce((s,n) => s + chroma(n) * Math.sin(n.featureHue * Math.PI * 2),0) / 120;
    const colourReliability = Math.hypot(colourX, colourY), effectiveHue = (Math.atan2(colourY, colourX) / (Math.PI * 2) + 1) % 1, effectiveS = flat.reduce((s,n) => s + n.featureSaturation,0) / 120;
    return {
      hash, columns, avgL, avgS, hue, edgeRatio,
      normalizationVersion: 'canvas-cover-rgba-v1', fingerprintVersion: 'fnv-family-v1',
      root: colourReliability < .08 ? 0 : Math.round(effectiveHue * 12) % 12,
      modeId: avgL < .34 ? 'deep' : effectiveS > .56 ? 'bright' : 'soft',
      bpm: profile.bpm,
      rhythmStructure: { periodicity: structure.periodicity, period: structure.period, organizedTexture: structure.organizedTexture, version: structure.version },
      rhythmActivity: profile.activity,
      complexity: profile.complexity,
      decisionMargins: { modeLight: Math.abs(avgL - .34), modeSaturation: Math.abs(effectiveS - .56), colourReliability, rootBoundary: .5 - Math.abs(effectiveHue * 12 - Math.round(effectiveHue * 12)) },
      legacy: { root: legacyRoot, modeId: avgL < .38 ? 'deep' : avgS > .48 ? 'bright' : 'soft', bpm: Math.round(72 + clamp(edgeRatio * 260, 0, 44) + Math.floor(firstRandom(parseInt(hash.slice(0, 8), 16)) * 7)) },
    };
  }
  function normalizeSource(source, doc = globalThis.document) {
    if (!doc) throw new Error('图像规范化需要浏览器画布');
    const canvas = doc.createElement('canvas'); canvas.width = WIDTH; canvas.height = HEIGHT;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const scale = Math.max(WIDTH / source.width, HEIGHT / source.height), width = source.width * scale, height = source.height * scale;
    context.drawImage(source, (WIDTH - width) / 2, (HEIGHT - height) / 2, width, height);
    return canvas;
  }
  return { WIDTH, HEIGHT, COLS, ROWS, analyzePixels, digestPixels, rgbToHsl, normalizeSource };
});
