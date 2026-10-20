/* Pillow's RGB LANCZOS resize (fixed-point, two passes), so analysis sees the same pixels. */
(self.PixelMusicEngineModules = self.PixelMusicEngineModules || []).push(function (PM) {
  'use strict';
  const PRECISION_BITS = 22, ONE = 2 ** PRECISION_BITS;
  const sinc = x => { if (x === 0) return 1; x *= Math.PI; return Math.sin(x) / x; };
  const lanczos = x => (-3 <= x && x < 3 ? sinc(x) * sinc(x / 3) : 0);

  function coefficients(inSize, outSize) {
    let filterscale = inSize / outSize;
    const scale = filterscale;
    if (filterscale < 1) filterscale = 1;
    const support = 3 * filterscale, ksize = Math.ceil(support) * 2 + 1;
    const bounds = new Int32Array(outSize * 2), kk = new Int32Array(outSize * ksize), k = new Float64Array(ksize);
    for (let xx = 0; xx < outSize; xx++) {
      const center = (xx + .5) * scale, ss = 1 / filterscale;
      let ww = 0;
      let xmin = Math.trunc(center - support + .5);
      if (xmin < 0) xmin = 0;
      let xmax = Math.trunc(center + support + .5);
      if (xmax > inSize) xmax = inSize;
      xmax -= xmin;
      for (let x = 0; x < xmax; x++) { const w = lanczos((x + xmin - center + .5) * ss); k[x] = w; ww += w; }
      for (let x = 0; x < xmax; x++) if (ww !== 0) k[x] /= ww;
      for (let x = 0; x < ksize; x++) {
        const v = x < xmax ? k[x] : 0;
        kk[xx * ksize + x] = v < 0 ? Math.trunc(-.5 + v * ONE) : Math.trunc(.5 + v * ONE);
      }
      bounds[xx * 2] = xmin; bounds[xx * 2 + 1] = xmax;
    }
    return {bounds, kk, ksize};
  }
  const clip8 = ss => { const v = Math.floor(ss / ONE); return v < 0 ? 0 : v > 255 ? 255 : v; };

  // pixels: Uint8 RGB, 3 bytes per pixel. Returns {pixels, width, height}.
  function resize(pixels, width, height, outW, outH) {
    if (outW === width && outH === height) return {pixels, width, height};
    const horizontal = coefficients(width, outW), vertical = coefficients(height, outH);
    const first = vertical.bounds[0], last = vertical.bounds[outH * 2 - 2] + vertical.bounds[outH * 2 - 1];
    let source = pixels, sourceH = height, offset = 0;
    if (outW !== width) {
      const rows = last - first, temp = new Uint8Array(rows * outW * 3), {bounds, kk, ksize} = horizontal;
      for (let yy = 0; yy < rows; yy++) {
        const row = (yy + first) * width * 3;
        for (let xx = 0; xx < outW; xx++) {
          const xmin = bounds[xx * 2], xmax = bounds[xx * 2 + 1], k = xx * ksize;
          let s0 = ONE / 2, s1 = ONE / 2, s2 = ONE / 2;
          for (let x = 0; x < xmax; x++) {
            const p = row + (x + xmin) * 3, c = kk[k + x];
            s0 += pixels[p] * c; s1 += pixels[p + 1] * c; s2 += pixels[p + 2] * c;
          }
          const o = (yy * outW + xx) * 3;
          temp[o] = clip8(s0); temp[o + 1] = clip8(s1); temp[o + 2] = clip8(s2);
        }
      }
      source = temp; sourceH = rows; offset = first;
    }
    if (outH === height) return {pixels: source, width: outW, height: outH};
    const out = new Uint8Array(outW * outH * 3), {bounds, kk, ksize} = vertical;
    for (let yy = 0; yy < outH; yy++) {
      const ymin = bounds[yy * 2] - offset, ymax = bounds[yy * 2 + 1], k = yy * ksize;
      for (let xx = 0; xx < outW; xx++) {
        let s0 = ONE / 2, s1 = ONE / 2, s2 = ONE / 2;
        for (let y = 0; y < ymax; y++) {
          const p = ((y + ymin) * outW + xx) * 3, c = kk[k + y];
          s0 += source[p] * c; s1 += source[p + 1] * c; s2 += source[p + 2] * c;
        }
        const o = (yy * outW + xx) * 3;
        out[o] = clip8(s0); out[o + 1] = clip8(s1); out[o + 2] = clip8(s2);
      }
    }
    return {pixels: out, width: outW, height: outH};
  }

  // image_analysis.image_to_rgb_array: longest side at most 512, then floats in 0..1.
  function toRgbArray(pixels, width, height, maxSide = 512) {
    let image = {pixels, width, height};
    const scale = Math.min(1, maxSide / Math.max(width, height));
    if (scale < 1) image = resize(pixels, width, height, Math.max(1, Math.trunc(width * scale)), Math.max(1, Math.trunc(height * scale)));
    const rgb = new Float64Array(image.pixels.length);
    for (let i = 0; i < rgb.length; i++) rgb[i] = image.pixels[i] / 255;
    return {rgb, width: image.width, height: image.height};
  }

  // RGBA (canvas ImageData) to packed RGB bytes.
  function fromRgba(rgba, width, height) {
    const out = new Uint8Array(width * height * 3);
    for (let i = 0, j = 0; i < width * height; i++, j += 4) { out[i * 3] = rgba[j]; out[i * 3 + 1] = rgba[j + 1]; out[i * 3 + 2] = rgba[j + 2]; }
    return out;
  }

  PM.image = {resize, toRgbArray, fromRgba};
});
