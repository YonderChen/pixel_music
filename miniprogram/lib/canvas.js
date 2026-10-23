'use strict';
function get(page, selector) {
  return new Promise((resolve, reject) => wx.createSelectorQuery().in(page).select(selector).fields({node: true, size: true, rect: true}).exec(results => {
    const result = results[0]; if (!result || !result.node) return reject(new Error('画布尚未就绪'));
    const ratio = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio;
    const canvas = result.node; canvas.width = Math.max(1, Math.round(result.width * ratio)); canvas.height = Math.max(1, Math.round(result.height * ratio));
    resolve({canvas, context: canvas.getContext('2d'), width: result.width, height: result.height, left: result.left, top: result.top, ratio});
  }));
}
async function pixels(surface, path, maxSide = 512) {
  const image = surface.canvas.createImage();
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('图片读取失败，请改用 JPG 或 PNG')); image.src = path; });
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height)), width = Math.max(1, Math.round(image.width * scale)), height = Math.max(1, Math.round(image.height * scale));
  const c = surface.context; c.clearRect(0, 0, width, height); c.drawImage(image, 0, 0, width, height);
  const rgba = c.getImageData(0, 0, width, height).data, out = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) { out[j] = rgba[i]; out[j + 1] = rgba[i + 1]; out[j + 2] = rgba[i + 2]; }
  return {pixels: out, width, height};
}
function exportPng(canvas, width = 2400, height = 1800) { return new Promise((resolve, reject) => wx.canvasToTempFilePath({canvas, destWidth: width, destHeight: height, fileType: 'png', success: r => resolve(r.tempFilePath), fail: reject})); }
module.exports = {get, pixels, exportPng};
