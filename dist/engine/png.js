/* PNG decoding as the former engine's Pillow 10.2 did it: its mode for each bit depth and
 * colour type, then convert('RGB') (alpha dropped, 16-bit samples by their high byte,
 * 16-bit grey clipped to 255) and ImageOps.exif_transpose. A canvas would instead
 * premultiply alpha and round 16-bit samples. Inflating uses the browser's
 * DecompressionStream, so decode() is asynchronous. */
(self.PixelMusicEngineModules = self.PixelMusicEngineModules || []).push(function (PM) {
  'use strict';
  const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
  const fail = message => { throw new PM.jpeg.Unsupported(message); };
  const CHANNELS = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4};
  const ADAM7 = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];

  const isPng = bytes => SIGNATURE.every((v, i) => bytes[i] === v);

  async function inflate(data) {
    if (typeof DecompressionStream !== 'function') fail('no DecompressionStream');
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function unfilter(raw, pos, width, height, bitsPerPixel, rows) {
    const stride = Math.ceil(width * bitsPerPixel / 8), bpp = Math.max(1, bitsPerPixel >> 3);
    let previous = new Uint8Array(stride);
    for (let y = 0; y < height; y++) {
      if (pos + 1 + stride > raw.length) fail('truncated image data');
      const type = raw[pos++], line = raw.slice(pos, pos + stride);
      pos += stride;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? line[i - bpp] : 0, b = previous[i], c = i >= bpp ? previous[i - bpp] : 0;
        let p;
        switch (type) {
          case 0: p = 0; break;
          case 1: p = a; break;
          case 2: p = b; break;
          case 3: p = (a + b) >> 1; break;
          case 4: { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; break; }
          default: fail('bad filter');
        }
        line[i] = (line[i] + p) & 255;
      }
      rows(y, line);
      previous = line;
    }
    return pos;
  }

  // Sample k (0-based) of a row at the given bit depth.
  function sample(line, k, depth) {
    if (depth === 8) return line[k];
    if (depth === 16) return (line[2 * k] << 8) | line[2 * k + 1];
    const perByte = 8 / depth, byte = line[(k / perByte) | 0], shift = 8 - depth * (k % perByte + 1);
    return (byte >> shift) & ((1 << depth) - 1);
  }

  async function decode(bytes) {
    if (!isPng(bytes)) fail('not a PNG');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), idat = [];
    let pos = 8, header = null, palette = null, orientation = 1;
    while (pos + 8 <= bytes.length) {
      const length = view.getUint32(pos), type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8)), data = bytes.subarray(pos + 8, pos + 8 + length);
      pos += 12 + length;
      if (type === 'IHDR') { const d = new DataView(data.buffer, data.byteOffset, data.byteLength); header = {width: d.getUint32(0), height: d.getUint32(4), depth: data[8], color: data[9], interlace: data[12]}; }
      else if (type === 'PLTE') palette = data;
      else if (type === 'IDAT') idat.push(data);
      else if (type === 'eXIf') orientation = exifOrientation(data);
      else if (type === 'IEND') break;
    }
    if (!header || !idat.length) fail('no image data');
    const {width, height, depth, color, interlace} = header, channels = CHANNELS[color];
    if (!channels || !width || !height) fail('unsupported PNG');
    if (color === 3 && !palette) fail('missing palette');
    let total = 0;
    for (const d of idat) total += d.length;
    const joined = new Uint8Array(total);
    total = 0;
    for (const d of idat) { joined.set(d, total); total += d.length; }
    const raw = await inflate(joined), pixels = new Uint8Array(width * height * 3), bitsPerPixel = channels * depth;
    // Pillow mode, then convert('RGB'), for one pixel.
    const put = (x, y, line, k) => {
      const d = (y * width + x) * 3;
      let r, g, b;
      if (color === 0) {
        const v = sample(line, k, depth);
        r = depth === 1 ? v * 255 : depth === 2 ? v * 0x55 : depth === 4 ? v * 0x11 : depth === 8 ? v : Math.min(v, 255);
        g = b = r;
      } else if (color === 3) {
        const i = sample(line, k, depth);
        if (3 * i + 2 < palette.length) { r = palette[3 * i]; g = palette[3 * i + 1]; b = palette[3 * i + 2]; } else r = g = b = 0; // beyond the palette: black, as Pillow pads it
      } else {
        const at = c => (depth === 16 ? line[2 * (k * channels + c)] : line[k * channels + c]);
        if (color === 4) r = g = b = at(0);
        else { r = at(0); g = at(1); b = at(2); }
      }
      pixels[d] = r; pixels[d + 1] = g; pixels[d + 2] = b;
    };
    if (!interlace) unfilter(raw, 0, width, height, bitsPerPixel, (y, line) => { for (let x = 0; x < width; x++) put(x, y, line, x); });
    else {
      let at = 0;
      for (const [x0, y0, dx, dy] of ADAM7) {
        const w = Math.ceil((width - x0) / dx), h = Math.ceil((height - y0) / dy);
        if (w <= 0 || h <= 0) continue;
        at = unfilter(raw, at, w, h, bitsPerPixel, (y, line) => { for (let x = 0; x < w; x++) put(x0 + x * dx, y0 + y * dy, line, x); });
      }
    }
    return PM.jpeg.transpose(pixels, width, height, orientation);
  }

  // Orientation from an eXIf chunk (a bare TIFF structure).
  function exifOrientation(data) {
    if (data.length < 8) return 1;
    const little = data[0] === 0x49, u16 = p => (little ? data[p] | (data[p + 1] << 8) : (data[p] << 8) | data[p + 1]);
    const u32 = p => (little ? (data[p] | (data[p + 1] << 8) | (data[p + 2] << 16)) + data[p + 3] * 16777216 : data[p] * 16777216 + ((data[p + 1] << 16) | (data[p + 2] << 8) | data[p + 3]));
    const ifd = u32(4);
    if (ifd + 2 > data.length) return 1;
    for (let i = 0, n = u16(ifd); i < n && ifd + 14 + i * 12 <= data.length; i++) if (u16(ifd + 2 + i * 12) === 0x0112) return u16(ifd + 10 + i * 12);
    return 1;
  }

  PM.png = {isPng, decode};
});
