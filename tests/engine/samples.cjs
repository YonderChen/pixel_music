/* Test images: the page's built-in samples plus small synthetic edge cases, as encoded files. */
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {root} = require('./harness.cjs');
function builtIn() {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'dist/sonification-assets/photos.js'), 'utf8'), {window});
  vm.runInNewContext(fs.readFileSync(path.join(root, 'dist/sonification-assets/paintings.js'), 'utf8'), {window});
  const out = [];
  for (const [name, url] of Object.entries(window.PixelMusicStripPhotoData || {})) out.push({name, base64: url.split(',')[1]});
  for (const p of window.PixelMusicPaintings || []) out.push({name: p.id, base64: (p.data || '').split(',')[1] || fs.readFileSync(path.join(root, 'dist', p.path)).toString('base64')});
  return out;
}
module.exports = {builtIn};

// Synthetic images made with Pillow inside the oracle: flat, gradients, stripes, tiny, large.
const SYNTHETIC = `
import io, base64, numpy as np
from PIL import Image, ImageDraw
def enc(img, fmt='PNG', **kw):
    out = io.BytesIO(); img.save(out, format=fmt, **kw); return base64.b64encode(out.getvalue()).decode()
y, x = np.mgrid[:300, :420]
rng = np.random.default_rng(3)
images = {}
images['white'] = enc(Image.new('RGB', (64, 48), 'white'))
images['gradient'] = enc(Image.fromarray(np.stack([x * 255 // 419, y * 255 // 299, (x + y) % 256], 2).astype('uint8')))
stripes = np.zeros((240, 360, 3), 'uint8'); stripes[::40] = 255; stripes[:, ::60, 1] = 200
images['stripes'] = enc(Image.fromarray(stripes))
shapes = Image.new('RGB', (700, 460), (30, 60, 120)); d = ImageDraw.Draw(shapes)
d.ellipse((80, 60, 300, 280), fill=(240, 200, 40)); d.rectangle((380, 200, 650, 420), fill=(200, 40, 60)); d.polygon([(0, 460), (350, 300), (700, 460)], fill=(40, 140, 60))
images['shapes'] = enc(shapes, 'JPEG', quality=88)
noise = (rng.random((1000, 1500, 3)) * 255).astype('uint8'); noise[200:700, 300:900] //= 3
images['large-noise'] = enc(Image.fromarray(noise), 'JPEG', quality=80)
images['tall'] = enc(Image.fromarray(np.stack([y.T[:, :250] % 256, x.T[:, :250] * 0 + 90, (y.T[:, :250] * 3) % 256], 2).astype('uint8')))
images['tiny'] = enc(Image.fromarray((rng.random((9, 13, 3)) * 255).astype('uint8')))
images
`;
function synthetic(py) {
  return Object.entries(py.runPython(SYNTHETIC).toJs({dict_converter: Object.fromEntries})).map(([name, base64]) => ({name, base64}));
}
module.exports.synthetic = synthetic;

// Decode with Pillow exactly as the old engine did (EXIF transpose, convert RGB).
function decode(py, base64) {
  py.globals.set('_b64', base64);
  const [width, height, bytes] = py.runPython(`
import io, base64
from PIL import Image, ImageOps
_img = ImageOps.exif_transpose(Image.open(io.BytesIO(base64.b64decode(_b64)))).convert('RGB')
(_img.width, _img.height, _img.tobytes())`).toJs();
  return {width, height, pixels: Uint8Array.from(bytes)};
}
module.exports.decode = decode;
