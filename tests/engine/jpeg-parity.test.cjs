/* JPEG files decode to exactly the pixels the former engine's Pillow produced
 * (libjpeg-turbo islow IDCT, fancy upsampling, EXIF orientation). */
const assert = require('node:assert/strict');
const {loadEngine, loadOracle} = require('./harness.cjs');
const samples = require('./samples.cjs');
const CASES = `
import io, base64, numpy as np
from PIL import Image, ImageFile
ImageFile.MAXBLOCK = 1 << 24
rng = np.random.default_rng(7)
def picture(w, h, mode='RGB'):
    y, x = np.mgrid[:h, :w]
    a = np.stack([(x * 255 // max(1, w - 1)), (y * 255 // max(1, h - 1)), ((x * 7 + y * 3) % 256)], 2).astype(float)
    a += rng.normal(0, 25, a.shape); a[h // 3: h // 2, w // 4: w // 2] = [220, 30, 40]
    img = Image.fromarray(np.clip(a, 0, 255).astype('uint8'))
    return img.convert(mode)
out = []
for w, h in [(1, 1), (7, 5), (16, 16), (17, 13), (33, 31), (300, 200), (641, 479)]:
    for sub in (0, 1, 2):
        for prog in (False, True):
            for q in (35, 90):
                b = io.BytesIO(); picture(w, h).save(b, 'JPEG', quality=q, subsampling=sub, progressive=prog, optimize=(q == 90))
                out.append((f'{w}x{h} sub{sub} {"prog" if prog else "base"} q{q}', base64.b64encode(b.getvalue()).decode()))
for prog in (False, True):
    b = io.BytesIO(); picture(97, 61, 'L').save(b, 'JPEG', quality=80, progressive=prog)
    out.append((f'gray {"prog" if prog else "base"}', base64.b64encode(b.getvalue()).decode()))
for o in range(1, 9):
    img = picture(45, 29); ex = Image.Exif(); ex[0x0112] = o
    b = io.BytesIO(); img.save(b, 'JPEG', quality=85, exif=ex.tobytes())
    out.append((f'orientation {o}', base64.b64encode(b.getvalue()).decode()))
out
`;
(async () => {
  const PM = loadEngine(), py = await loadOracle();
  const cases = py.runPython(CASES).toJs().map(([name, base64]) => ({name, base64}));
  for (const s of samples.builtIn()) if (s.base64.startsWith('/9j/')) cases.push(s);
  const failures = [];
  for (const {name, base64} of cases) {
    const expected = samples.decode(py, base64);
    let actual;
    try { actual = PM.jpeg.decode(Uint8Array.from(Buffer.from(base64, 'base64'))); } catch (error) { failures.push(`${name}: throws ${error.stack.split('\n').slice(0, 2).join(' ')}`); continue; }
    if (actual.width !== expected.width || actual.height !== expected.height) { failures.push(`${name}: size ${actual.width}x${actual.height} vs ${expected.width}x${expected.height}`); continue; }
    let differ = 0, worst = 0, first = -1;
    for (let i = 0; i < expected.pixels.length; i++) { const d = Math.abs(actual.pixels[i] - expected.pixels[i]); if (d) { differ++; if (first < 0) first = i; } worst = Math.max(worst, d); }
    if (differ) failures.push(`${name}: ${differ}/${expected.pixels.length} values differ, max ${worst}, first at pixel ${(first / 3) | 0} (x ${((first / 3) | 0) % expected.width}, y ${(((first / 3) | 0) / expected.width) | 0})`);
  }
  console.log(`${cases.length - failures.length}/${cases.length} JPEG files decode identically`);
  if (failures.length) { console.log(failures.join('\n')); process.exitCode = 1; }
})().catch(error => { console.error(error); process.exitCode = 1; });
