(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PixelMusicStripSamples = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const WIDTH = 192, HEIGHT = 120;
  const entries = [
    { id: 'sunset', name: '照片 · 火星日落', path: './sonification-assets/mars-sunset.png' },
    { id: 'grass', name: '照片 · 草地纹理', path: './sonification-assets/grass.png' },
    { id: 'up', name: '验收 · 亮带偏上' }, { id: 'down', name: '验收 · 亮带偏下' },
    { id: 'low', name: '验收 · 低对比度' }, { id: 'high', name: '验收 · 高对比度' },
    { id: 'white', name: '验收 · 纯白' }, { id: 'black', name: '验收 · 全黑' },
  ];
  function pixels(id) {
    if (!entries.some(e => e.id === id && !e.path)) throw new Error('没有该几何样本');
    const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
      let value = id === 'white' ? 255 : 0;
      if (id === 'up' || id === 'down') {
        const center = (id === 'up' ? 28 : 90) + Math.round(10 * Math.sin(x / WIDTH * Math.PI * 2));
        value = Math.abs(y - center) < 5 ? 255 : 0;
      }
      if (id === 'low' || id === 'high') value = 128 + (Math.floor(x / 12) % 2 ? 1 : -1) * (id === 'low' ? 18 : 105);
      const i = (y * WIDTH + x) * 4; data[i] = data[i + 1] = data[i + 2] = value; data[i + 3] = 255;
    }
    return data;
  }
  function canvas(id, doc = document) {
    const canvas = doc.createElement('canvas'); canvas.width = WIDTH; canvas.height = HEIGHT;
    canvas.getContext('2d').putImageData(new ImageData(pixels(id), WIDTH, HEIGHT), 0, 0);
    return canvas;
  }
  return { entries, pixels, canvas };
});
