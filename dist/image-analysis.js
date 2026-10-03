(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PixelMusicImage = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
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
  function analyzePixels(data, width = WIDTH, height = HEIGHT) {
    if (width !== WIDTH || height !== HEIGHT || data.length !== width * height * 4) throw new Error('需要 192×120 的规范化 RGBA 图像');
    const hash = digestPixels(data);
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
      return { col, row, light, saturation, hue: regionHue, density, localSeed: region.seed, signature: legacySignature, velocity: .025 + light * .035 + saturation * .025 + density * .018 };
    }) }));
    return {
      hash, columns, avgL, avgS, hue, edgeRatio,
      normalizationVersion: 'canvas-cover-rgba-v1', fingerprintVersion: 'fnv-family-v1',
      root: avgS < .08 ? 0 : Math.round(hue * 12) % 12,
      modeId: avgL < .34 ? 'deep' : avgS > .56 ? 'bright' : 'soft',
      bpm: 80 + Math.round((clamp(edgeRatio * 130, 0, 12) + avgL * 3) / 4) * 4,
      decisionMargins: { modeLight: Math.abs(avgL - .34), modeSaturation: Math.abs(avgS - .56), colourReliability: avgS, rootBoundary: .5 - Math.abs(hue * 12 - Math.round(hue * 12)) },
      legacy: { root: legacyRoot, modeId: avgL < .38 ? 'deep' : avgS > .48 ? 'bright' : 'soft', bpm: Math.round(72 + clamp(edgeRatio * 260, 0, 44) + Math.floor(firstRandom(parseInt(hash.slice(0, 8), 16)) * 7)) },
    };
  }
  return { WIDTH, HEIGHT, COLS, ROWS, analyzePixels, digestPixels, rgbToHsl };
});
