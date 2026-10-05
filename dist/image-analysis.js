(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./rhythm.js') : root.PixelMusicRhythm);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PixelMusicImage = api;
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
  function spatialStructure(data) {
    // 4×4 box averages retain broad structure and suppress independent pixel noise.
    const w = WIDTH / 4, h = HEIGHT / 4, cells = Array.from({ length: w * h }, () => [0, 0, 0]);
    const regions = Array.from({ length: COLS * ROWS }, () => ({ variation: 0, pairs: 0, raw: 0, rawPairs: 0, horizontal: 0, vertical: 0 }));
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
      const offset = (y * WIDTH + x) * 4, cell = cells[Math.floor(y / 4) * w + Math.floor(x / 4)];
      const region = regions[Math.floor(y / 24) * COLS + Math.floor(x / 8)];
      for (let c = 0; c < 3; c++) cell[c] += data[offset + c] / (16 * 255);
      for (const delta of [x % 8 ? 4 : 0, y % 24 ? WIDTH * 4 : 0]) if (delta) {
        const diff = [0, 1, 2].reduce((s, c) => s + Math.abs(data[offset + c] - data[offset + c - delta]), 0) / 765;
        region.raw += diff; region.rawPairs++;
      }
    }
    const horizontal = [], vertical = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, region = regions[Math.floor(y / 6) * COLS + Math.floor(x / 2)];
      for (const [valid, delta, direction] of [[x % 2, 1, 'horizontal'], [y % 6, w, 'vertical']]) if (valid) {
        const diff = cells[i].reduce((s, c, channel) => s + Math.abs(c - cells[i - delta][channel]), 0) / 3;
        region.variation += diff; region.pairs++; region[direction] += diff;
      }
      horizontal.push(x ? cells[i].reduce((s, c, channel) => s + c - cells[i - 1][channel], 0) / 3 : 0);
      vertical.push(y ? cells[i].reduce((s, c, channel) => s + c - cells[i - w][channel], 0) / 3 : 0);
    }
    function repetition(values, direction) {
      let best = 0;
      for (let lag = 2; lag <= 12; lag++) {
        let product = 0, aa = 0, bb = 0;
        for (let y = 1; y < h; y++) for (let x = 1; x < w; x++) {
          if ((direction === 1 ? x : y) <= lag) continue;
          const a = values[y * w + x], b = values[y * w + x - lag * direction];
          product += a * b; aa += a * a; bb += b * b;
        }
        if (aa > .00001 && bb > .00001) best = Math.max(best, product / Math.sqrt(aa * bb));
      }
      return clamp(best, 0, 1);
    }
    const periodicity = Math.max(repetition(horizontal, 1), repetition(vertical, w));
    const features = regions.map(r => {
      const coarseVariation = r.variation / Math.max(1, r.pairs), rawVariation = r.raw / Math.max(1, r.rawPairs);
      const organization = clamp(coarseVariation / (rawVariation + .003), 0, 1);
      return { coarseVariation, rawVariation, organization, horizontalVariation: r.horizontal / Math.max(1, r.pairs), verticalVariation: r.vertical / Math.max(1, r.pairs) };
    });
    const organizedTexture = features.reduce((s, r) => s + clamp(r.coarseVariation / .18, 0, 1) * r.organization, 0) / features.length * (.35 + .65 * periodicity);
    return { features, periodicity, organizedTexture, version: 'box4-spatial-v1' };
  }
  function analyzePixels(data, width = WIDTH, height = HEIGHT) {
    if (width !== WIDTH || height !== HEIGHT || data.length !== width * height * 4) throw new Error('需要 192×120 的规范化 RGBA 图像');
    const hash = digestPixels(data), structure = spatialStructure(data);
    const accum = Array.from({ length: COLS * ROWS }, () => ({ l: 0, s: 0, hx: 0, hy: 0, edge: 0, count: 0, seed: 2166136261 }));
    let totalL = 0, totalS = 0, hx = 0, hy = 0, edges = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4, [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      const col = Math.floor(x / 8), row = Math.floor(y / 24), region = accum[row * COLS + col];
      const vx = Math.cos(h * Math.PI * 2) * s, vy = Math.sin(h * Math.PI * 2) * s;
      totalL += l; totalS += s; hx += vx; hy += vy;
      region.l += l; region.s += s; region.hx += vx; region.hy += vy; region.count++;
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
      const index = (row * COLS + col) % 56, legacySignature = parseInt(hash.slice(index, index + 2), 16) / 255 - .5;
      return { col, row, light, saturation, hue: regionHue, density, ...structure.features[row * COLS + col], localSeed: region.seed, signature: legacySignature, velocity: .025 + light * .035 + saturation * .025 + density * .018 };
    }) }));
    const profile = Rhythm.describe(columns.flatMap((column, col) => col % 2 ? column.notes.slice().reverse() : column.notes), structure);
    return {
      hash, columns, avgL, avgS, hue, edgeRatio,
      normalizationVersion: 'canvas-cover-rgba-v1', fingerprintVersion: 'fnv-family-v1',
      root: avgS < .08 ? 0 : Math.round(hue * 12) % 12,
      modeId: avgL < .34 ? 'deep' : avgS > .56 ? 'bright' : 'soft',
      bpm: profile.bpm,
      rhythmStructure: { periodicity: structure.periodicity, organizedTexture: structure.organizedTexture, version: structure.version },
      rhythmActivity: profile.activity,
      decisionMargins: { modeLight: Math.abs(avgL - .34), modeSaturation: Math.abs(avgS - .56), colourReliability: avgS, rootBoundary: .5 - Math.abs(hue * 12 - Math.round(hue * 12)) },
      legacy: { root: legacyRoot, modeId: avgL < .38 ? 'deep' : avgS > .48 ? 'bright' : 'soft', bpm: Math.round(72 + clamp(edgeRatio * 260, 0, 44) + Math.floor(firstRandom(parseInt(hash.slice(0, 8), 16)) * 7)) },
    };
  }
  return { WIDTH, HEIGHT, COLS, ROWS, analyzePixels, digestPixels, rgbToHsl };
});
