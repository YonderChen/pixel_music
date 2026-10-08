(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PixelMusicFixturesV061 = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  // Original procedural fixtures. No downloaded images or personal photos.
  const names = ['纯色', '黑白棋盘', '明暗渐变', '彩色渐变', '低饱和风景', '夕阳', '高对比建筑', '几何人像', '抽象图案', '密集纹理', '噪声', '局部变化对照'];
  const width = 192, height = 120;
  const mix = (a, b, t) => a.map((v, i) => v * (1 - t) + b[i] * t);
  const ellipse = (x, y, cx, cy, rx, ry) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 < 1;
  function pixels(index) {
    if (!Number.isInteger(index) || index < 0 || index >= names.length) throw new Error('未知测试图');
    const data = new Uint8ClampedArray(width * height * 4);
    let seed = 103;
    const random = () => { seed = Math.imul(seed, 1664525) + 1013904223 | 0; return (seed >>> 0) / 4294967296; };
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const u = x / (width - 1), v = y / (height - 1);
      let rgb;
      if (index === 0) rgb = [133, 174, 165];
      else if (index === 1) rgb = (Math.floor(x / 16) + Math.floor(y / 16)) % 2 ? [230, 230, 230] : [25, 25, 25];
      else if (index === 2) rgb = [1, 1, 1].map(() => 35 + 190 * u);
      else if (index === 3) rgb = [120 + 100 * Math.sin(u * Math.PI * 2), 130 + 95 * Math.sin(u * Math.PI * 2 + 2), 130 + 95 * Math.sin(u * Math.PI * 2 + 4)];
      else if (index === 4) rgb = v < .55 ? mix([171, 182, 193], [204, 198, 190], v / .55) : mix([124, 139, 134], [89, 108, 105], (v - .55) / .45);
      else if (index === 5 || index === 11) {
        rgb = mix([58, 88, 119], [235, 144, 94], Math.min(1, v * 1.5));
        if (ellipse(x, y, 138, 42, 18, 18)) rgb = [255, 222, 141];
        if (y > 90 - ((Math.floor(x / 15) * 17) % 24)) rgb = [48, 41, 57];
        if (index === 11 && x >= 128 && x < 136 && y >= 48 && y < 72) rgb = mix(rgb, [108, 203, 198], .65);
      } else if (index === 6) rgb = v > .25 + (Math.floor(x / 13) % 4) * .13 ? [23, 32, 43] : [228, 230, 214];
      else if (index === 7) {
        rgb = mix([209, 186, 181], [128, 146, 158], v);
        if (ellipse(x, y, 96, 124, 50, 47)) rgb = [86, 105, 124];
        if (ellipse(x, y, 96, 53, 28, 34)) rgb = [209, 159, 127];
        if (ellipse(x, y, 96, 35, 30, 22)) rgb = [52, 45, 48];
        if ((ellipse(x, y, 85, 53, 3, 2) || ellipse(x, y, 106, 53, 3, 2))) rgb = [53, 45, 46];
      } else if (index === 8) rgb = [128 + 80 * Math.sin(u * 17 + v * 8), 120 + 65 * Math.cos(v * 23), 156 + 65 * Math.cos(u * 12 - v * 9)];
      else if (index === 9) rgb = (x + y * 3) % 7 < 3 ? [55, 90, 99] : [193, 164, 116];
      else rgb = [random() * 255, random() * 255, random() * 255];
      const offset = (y * width + x) * 4; data.set([...rgb, 255], offset);
    }
    return data;
  }
  return { names, width, height, pixels };
});
