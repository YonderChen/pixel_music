/* PNG files decode to exactly the RGB pixels the former engine's Pillow produced
 * (every bit depth and colour type, interlacing, palettes, alpha dropped, EXIF orientation). */
const {loadEngine, loadOracle} = require('./harness.cjs');
const samples = require('./samples.cjs');
const CASES = `
import io, base64, zlib, struct, numpy as np
from PIL import Image
rng = np.random.default_rng(11)
def enc(img, **kw):
    b = io.BytesIO(); img.save(b, 'PNG', **kw); return base64.b64encode(b.getvalue()).decode()
def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
def raw_png(w, h, depth, color, rows, plte=None, interlace=0):
    # Rows are given unfiltered; each gets a random filter type is not needed: filter 0 and Paeth via Pillow cases.
    out = b'\\x89PNG\\r\\n\\x1a\\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, depth, color, 0, 0, interlace))
    if plte is not None: out += chunk(b'PLTE', plte)
    out += chunk(b'IDAT', zlib.compress(b''.join(b'\\x00' + r for r in rows))) + chunk(b'IEND', b'')
    return base64.b64encode(out).decode()
out = []
w, h = 37, 23
rgb = rng.integers(0, 256, (h, w, 3), dtype=np.uint8); rgb[5:15, 4:20] = [10, 200, 30]
img = Image.fromarray(rgb)
for interlace in (False, True):
    tag = ' interlaced' if interlace else ''
    out.append(('rgb8' + tag, enc(img, interlace=interlace)))
    out.append(('rgba8' + tag, enc(Image.fromarray(np.dstack([rgb, rng.integers(0, 256, (h, w), dtype=np.uint8)])), interlace=interlace)))
    out.append(('gray8' + tag, enc(img.convert('L'), interlace=interlace)))
    out.append(('la8' + tag, enc(img.convert('LA'), interlace=interlace)))
    out.append(('bilevel' + tag, enc(img.convert('1'), interlace=interlace)))
    out.append(('palette256' + tag, enc(img.convert('P', palette=Image.ADAPTIVE, colors=256), interlace=interlace)))
    out.append(('palette16' + tag, enc(img.convert('P', palette=Image.ADAPTIVE, colors=16), interlace=interlace, bits=4)))
    out.append(('palette4' + tag, enc(img.convert('P', palette=Image.ADAPTIVE, colors=4), interlace=interlace, bits=2)))
    out.append(('gray16' + tag, enc(Image.fromarray((rng.integers(0, 600, (h, w))).astype(np.uint16)), interlace=interlace)))
p = img.convert('P', palette=Image.ADAPTIVE, colors=8); p.info['transparency'] = 3
out.append(('palette trns', enc(p, transparency=3)))
out.append(('rgb trns', enc(img, transparency=(10, 200, 30))))
# Hand-built: 16-bit RGB and RGBA, 2/4-bit grey, a short palette with out-of-range indices.
r16 = rng.integers(0, 65536, (h, w, 3), dtype=np.uint16)
out.append(('rgb16', raw_png(w, h, 16, 2, [r16[y].astype('>u2').tobytes() for y in range(h)])))
r16a = rng.integers(0, 65536, (h, w, 4), dtype=np.uint16)
out.append(('rgba16', raw_png(w, h, 16, 6, [r16a[y].astype('>u2').tobytes() for y in range(h)])))
la16 = rng.integers(0, 65536, (h, w, 2), dtype=np.uint16)
out.append(('la16', raw_png(w, h, 16, 4, [la16[y].astype('>u2').tobytes() for y in range(h)])))
for depth in (2, 4):
    per = 8 // depth; vals = rng.integers(0, 1 << depth, (h, w))
    rows = []
    for y in range(h):
        bits = 0; row = bytearray()
        for x in range(0, w, per):
            byte = 0
            for k in range(per):
                byte = (byte << depth) | (int(vals[y, x + k]) if x + k < w else 0)
            row.append(byte)
        rows.append(bytes(row))
    out.append((f'gray{depth}', raw_png(w, h, depth, 0, rows)))
idx = rng.integers(0, 12, (h, w), dtype=np.uint8)
out.append(('short palette', raw_png(w, h, 8, 3, [idx[y].tobytes() for y in range(h)], plte=bytes(range(60, 60 + 18)))))
for o in (3, 6, 8):
    ex = Image.Exif(); ex[0x0112] = o
    out.append((f'orientation {o}', enc(img, exif=ex.tobytes())))
big = Image.fromarray(rng.integers(0, 256, (480, 640, 3), dtype=np.uint8))
out.append(('640x480', enc(big)))
out
`;
(async () => {
  const PM = loadEngine(), py = await loadOracle();
  const cases = py.runPython(CASES).toJs().map(([name, base64]) => ({name, base64}));
  for (const s of samples.builtIn()) if (s.base64.startsWith('iVBOR')) cases.push(s);
  const failures = [];
  for (const {name, base64} of cases) {
    let expected;
    try { expected = samples.decode(py, base64); } catch (error) { console.log(`${name}: Pillow cannot open it, skipped`); continue; }
    let actual;
    try { actual = await PM.png.decode(Uint8Array.from(Buffer.from(base64, 'base64'))); } catch (error) { failures.push(`${name}: throws ${error.message}`); continue; }
    if (actual.width !== expected.width || actual.height !== expected.height) { failures.push(`${name}: size ${actual.width}x${actual.height} vs ${expected.width}x${expected.height}`); continue; }
    let differ = 0, first = -1;
    for (let i = 0; i < expected.pixels.length; i++) if (actual.pixels[i] !== expected.pixels[i]) { differ++; if (first < 0) first = i; }
    if (differ) failures.push(`${name}: ${differ}/${expected.pixels.length} values differ, first at ${first}: ${actual.pixels.slice(first - first % 3, first - first % 3 + 3)} vs ${expected.pixels.slice(first - first % 3, first - first % 3 + 3)}`);
  }
  console.log(`${cases.length - failures.length}/${cases.length} PNG files decode identically`);
  if (failures.length) { console.log(failures.join('\n')); process.exitCode = 1; }
})().catch(error => { console.error(error); process.exitCode = 1; });
