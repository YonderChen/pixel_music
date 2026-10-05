(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PixelMusicRhythmFixtures = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const families = ['方向渐变', '周期条纹', '棋盘尺度', '彩色波形', '几何圆形', '空间块面', '放射环形', '噪声强度'];
  const names = families.flatMap(name => Array.from({ length: 6 }, (_, i) => `${name} ${i + 1}`));
  function pixels(index) {
    if (!Number.isInteger(index) || index < 0 || index >= names.length) throw new Error('未知节奏测试图');
    const data = new Uint8ClampedArray(192 * 120 * 4), family = Math.floor(index / 6), v = index % 6;
    let seed = 137;
    const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
    for (let y = 0; y < 120; y++) for (let x = 0; x < 192; x++) {
      const u = x / 191, t = y / 119, r = Math.hypot(u - .35 - v * .045, t - .5);
      let rgb;
      if (family === 0) { const d = v % 2 ? t : u; rgb = [40 + d * (100 + v * 20), 60 + (1 - d) * 120, 80 + d * 60]; }
      if (family === 1) rgb = Math.floor((v % 2 ? y : x) / (6 + v * 5)) % 2 ? [205, 170, 115] : [40, 72, 92];
      if (family === 2) rgb = (Math.floor(x / (8 + v * 4)) + Math.floor(y / (12 + v * 4))) % 2 ? [220, 215, 210] : [30, 45, 60];
      if (family === 3) rgb = [128 + 100 * Math.sin(u * (5 + v * 3) + t * 4), 128 + 85 * Math.cos(t * (4 + v * 2)), 130 + 70 * Math.sin(u * 7 - t * (2 + v))];
      if (family === 4) rgb = r < .12 + v * .035 ? [238, 147, 86] : r < .3 + v * .02 ? [70, 128, 119] : [165, 181, 195];
      if (family === 5) { const block = (Math.floor(x / (24 + v * 7)) + Math.floor(y / (18 + v * 3)) * 3) % 4; rgb = [[38, 63, 88], [175, 119, 103], [220, 202, 151], [81, 141, 132]][block]; }
      if (family === 6) { const d = Math.sin(r * (15 + v * 8) + Math.atan2(t - .5, u - .5) * (v % 3)); rgb = [140 + 100 * d, 125 - 60 * d, 145 + 40 * d]; }
      if (family === 7) { const strength = (v + 1) / 6; rgb = [145 + (random() - .5) * 240 * strength, 130 + (random() - .5) * 240 * strength, 120 + (random() - .5) * 240 * strength]; }
      data.set([...rgb, 255], (y * 192 + x) * 4);
    }
    return data;
  }
  return { names, pixels, families };
});
