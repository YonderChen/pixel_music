/* JPEG decoding as the former engine's Pillow did it: IJG libjpeg 9c (Emscripten's port)
 * with its defaults, i.e. the islow IDCT, chroma upsampled by scaled IDCTs (16x16, 16x8,
 * 8x16) and then box replication, its YCbCr tables, followed by ImageOps.exif_transpose.
 * Browsers decode JPEG with other upsampling and rounding, which moves pixels by up to ~80
 * levels at colour edges and changes the music. Baseline and progressive Huffman JPEGs
 * with 1 or 3 components are handled; anything else throws and the page decodes it. */
(self.PixelMusicEngineModules = self.PixelMusicEngineModules || []).push(function (PM) {
  'use strict';
  const ZIGZAG = Int32Array.from([0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21,
    28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63]);

  class Unsupported extends Error {}
  const fail = message => { throw new Unsupported(message); };

  // Canonical Huffman table as code -> value lookups per length (as jdhuff's maxcode/valptr).
  function huffman(counts, symbols) {
    const maxcode = new Int32Array(18).fill(-1), valptr = new Int32Array(17), mincode = new Int32Array(17);
    let code = 0, k = 0;
    for (let len = 1; len <= 16; len++) {
      valptr[len] = k; mincode[len] = code;
      code += counts[len - 1]; k += counts[len - 1];
      maxcode[len] = counts[len - 1] ? code - 1 : -1;
      code <<= 1;
    }
    maxcode[17] = 0x7fffffff;
    return {maxcode, valptr, mincode, symbols};
  }

  function parse(bytes) {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) fail('not a JPEG');
    const quant = [], dc = [], ac = [], scans = [];
    let frame = null, restart = 0, adobe = null, jfif = false, orientation = 1, pos = 2;
    const u16 = p => (bytes[p] << 8) | bytes[p + 1];
    while (pos < bytes.length) {
      if (bytes[pos] !== 0xff) { pos++; continue; }
      const marker = bytes[pos + 1];
      if (marker === 0xff) { pos++; continue; }
      pos += 2;
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
      if (marker === 0xd9) break;
      const length = u16(pos), seg = pos + 2, end = pos + length;
      if (marker === 0xdb) {
        for (let p = seg; p < end;) {
          const pq = bytes[p] >> 4, tq = bytes[p] & 15, table = new Int32Array(64);
          p++;
          for (let i = 0; i < 64; i++) { table[ZIGZAG[i]] = pq ? u16(p + 2 * i) : bytes[p + i]; }
          p += pq ? 128 : 64;
          quant[tq] = table;
        }
      } else if (marker === 0xc4) {
        for (let p = seg; p < end;) {
          const tc = bytes[p] >> 4, th = bytes[p] & 15, counts = bytes.subarray(p + 1, p + 17);
          let total = 0;
          for (const c of counts) total += c;
          const table = huffman(counts, bytes.slice(p + 17, p + 17 + total));
          (tc ? ac : dc)[th] = table;
          p += 17 + total;
        }
      } else if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        if (bytes[seg] !== 8) fail('only 8-bit JPEG');
        const height = u16(seg + 1), width = u16(seg + 3), count = bytes[seg + 5], components = [];
        for (let i = 0; i < count; i++) {
          const p = seg + 6 + i * 3;
          components.push({id: bytes[p], h: bytes[p + 1] >> 4, v: bytes[p + 1] & 15, tq: bytes[p + 2]});
        }
        if (!height || !width) fail('missing size');
        frame = {progressive: marker === 0xc2, width, height, components};
      } else if (marker >= 0xc3 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        fail('unsupported JPEG process');
      } else if (marker === 0xdd) {
        restart = u16(seg);
      } else if (marker === 0xe0) {
        if (bytes[seg] === 0x4a && bytes[seg + 1] === 0x46 && bytes[seg + 2] === 0x49 && bytes[seg + 3] === 0x46 && bytes[seg + 4] === 0) jfif = true;
      } else if (marker === 0xe1) {
        if (orientation === 1 && bytes[seg] === 0x45 && bytes[seg + 1] === 0x78 && bytes[seg + 2] === 0x69 && bytes[seg + 3] === 0x66) orientation = exifOrientation(bytes, seg + 6, end);
      } else if (marker === 0xee) {
        if (length >= 14 && bytes[seg] === 0x41 && bytes[seg + 1] === 0x64 && bytes[seg + 2] === 0x6f && bytes[seg + 3] === 0x62 && bytes[seg + 4] === 0x65) adobe = bytes[seg + 11];
      } else if (marker === 0xda) {
        if (!frame) fail('scan before frame');
        const count = bytes[seg], comps = [];
        for (let i = 0; i < count; i++) {
          const id = bytes[seg + 1 + i * 2], t = bytes[seg + 2 + i * 2];
          const component = frame.components.find(c => c.id === id);
          if (!component) fail('unknown component');
          comps.push({component, dc: dc[t >> 4], ac: ac[t & 15]});
        }
        const p = seg + 1 + count * 2;
        const scan = {comps, ss: bytes[p], se: bytes[p + 1], ah: bytes[p + 2] >> 4, al: bytes[p + 2] & 15, restart, start: end};
        pos = decodeScan(bytes, frame, scan);
        continue;
      }
      pos = end;
    }
    if (!frame) fail('no frame');
    return {frame, quant, adobe, jfif, orientation};
  }

  function exifOrientation(bytes, tiff, end) {
    const little = bytes[tiff] === 0x49;
    const u16 = p => (little ? bytes[p] | (bytes[p + 1] << 8) : (bytes[p] << 8) | bytes[p + 1]);
    const u32 = p => (little ? (bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16)) + bytes[p + 3] * 16777216 : bytes[p] * 16777216 + ((bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3]));
    const ifd = tiff + u32(tiff + 4);
    if (ifd + 2 > end) return 1;
    const count = u16(ifd);
    for (let i = 0; i < count; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > end) break;
      if (u16(e) === 0x0112) return u16(e + 8);
    }
    return 1;
  }

  // Lays out every component's coefficient blocks over whole MCUs.
  function prepare(frame) {
    if (frame.blocks) return;
    const hmax = Math.max(...frame.components.map(c => c.h)), vmax = Math.max(...frame.components.map(c => c.v));
    frame.hmax = hmax; frame.vmax = vmax;
    frame.mcusX = Math.ceil(frame.width / (8 * hmax)); frame.mcusY = Math.ceil(frame.height / (8 * vmax));
    for (const c of frame.components) {
      c.width = Math.ceil(frame.width * c.h / hmax); c.height = Math.ceil(frame.height * c.v / vmax);
      c.blocksX = Math.ceil(c.width / 8); c.blocksY = Math.ceil(c.height / 8);
      c.stride = frame.mcusX * c.h; c.rows = frame.mcusY * c.v;
      c.coefs = new Int16Array(c.stride * c.rows * 64);
      c.pred = 0;
    }
    frame.blocks = true;
  }

  function decodeScan(bytes, frame, scan) {
    prepare(frame);
    let pos = scan.start, bitBuffer = 0, bitCount = 0, marker = false;
    function bit() {
      if (!bitCount) {
        if (marker) { bitBuffer = 0; bitCount = 8; }
        else {
          let b = bytes[pos];
          if (b === 0xff) {
            const next = bytes[pos + 1];
            if (next === 0) pos += 2;
            else { marker = true; b = 0; } // a marker: feed zeros as libjpeg does
          } else pos++;
          if (pos > bytes.length) { marker = true; b = 0; }
          bitBuffer = b; bitCount = 8;
        }
      }
      bitCount--;
      return (bitBuffer >> bitCount) & 1;
    }
    const bits = n => { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | bit(); return v; };
    const extend = (v, n) => (n && v < (1 << (n - 1)) ? v - (1 << n) + 1 : v);
    function symbol(table) {
      if (!table) fail('missing Huffman table');
      let code = bit(), len = 1;
      while (code > table.maxcode[len]) { code = (code << 1) | bit(); if (++len > 16) return 0; }
      return table.symbols[table.valptr[len] + code - table.mincode[len]];
    }
    const {ss, se, ah, al} = scan, progressive = frame.progressive;
    let eobrun = 0;

    function baseline(c, off, tables) {
      const coefs = c.coefs, t = symbol(tables.dc), diff = t ? extend(bits(t), t) : 0;
      c.pred += diff;
      coefs[off] = c.pred;
      for (let k = 1; k < 64;) {
        const rs = symbol(tables.ac), r = rs >> 4, s = rs & 15;
        if (!s) { if (r !== 15) break; k += 16; continue; }
        k += r;
        if (k > 63) break;
        coefs[off + ZIGZAG[k]] = extend(bits(s), s);
        k++;
      }
    }
    function dcFirst(c, off, tables) {
      const t = symbol(tables.dc), diff = t ? extend(bits(t), t) : 0;
      c.pred += diff;
      c.coefs[off] = c.pred * (1 << al);
    }
    function dcRefine(c, off) { if (bit()) c.coefs[off] |= 1 << al; }
    function acFirst(c, off, tables) {
      if (eobrun) { eobrun--; return; }
      for (let k = ss; k <= se;) {
        const rs = symbol(tables.ac), r = rs >> 4, s = rs & 15;
        if (!s) {
          if (r < 15) { eobrun = (1 << r) - 1; if (r) eobrun += bits(r); break; }
          k += 16; continue;
        }
        k += r;
        if (k > 63) break;
        c.coefs[off + ZIGZAG[k]] = extend(bits(s), s) * (1 << al);
        k++;
      }
    }
    // decode_mcu_AC_refine (jdphuff.c).
    function acRefine(c, off, tables) {
      const p1 = 1 << al, m1 = -1 << al, coefs = c.coefs;
      const correct = z => { if (bit() && (coefs[z] & p1) === 0) coefs[z] += coefs[z] >= 0 ? p1 : m1; };
      let k = ss;
      if (!eobrun) {
        for (; k <= se; k++) {
          const rs = symbol(tables.ac);
          let r = rs >> 4, s = rs & 15;
          if (s) s = bit() ? p1 : m1;
          else if (r !== 15) { eobrun = 1 << r; if (r) eobrun += bits(r); break; }
          // Skip already-nonzero coefficients (refining each) and r zero ones.
          do {
            const z = off + ZIGZAG[k];
            if (coefs[z]) correct(z);
            else if (--r < 0) break;
            k++;
          } while (k <= se);
          if (s && k <= 63) coefs[off + ZIGZAG[k]] = s;
        }
      }
      if (eobrun > 0) {
        for (; k <= se; k++) { const z = off + ZIGZAG[k]; if (coefs[z]) correct(z); }
        eobrun--;
      }
    }

    let decode;
    if (!progressive) decode = baseline;
    else if (ss === 0) decode = ah ? dcRefine : dcFirst;
    else decode = ah ? acRefine : acFirst;
    if (progressive && ss === 0 && se !== 0) fail('bad progressive scan');

    const comps = scan.comps;
    for (const s of comps) s.component.pred = 0;
    let units;
    const single = comps.length === 1;
    if (single) { const c = comps[0].component; units = c.blocksX * c.blocksY; }
    else units = frame.mcusX * frame.mcusY;
    const interval = scan.restart || 0;
    for (let n = 0; n < units; n++) {
      if (interval && n && n % interval === 0) {
        // Restart: drop the remaining bits, find RSTn, reset predictions and EOB runs.
        bitCount = 0; marker = false;
        while (pos < bytes.length && !(bytes[pos] === 0xff && bytes[pos + 1] >= 0xd0 && bytes[pos + 1] <= 0xd7)) pos++;
        pos += 2;
        for (const s of comps) s.component.pred = 0;
        eobrun = 0;
      }
      if (single) {
        const c = comps[0].component, bx = n % c.blocksX, by = (n / c.blocksX) | 0;
        decode(c, (by * c.stride + bx) * 64, comps[0]);
      } else {
        const mx = n % frame.mcusX, my = (n / frame.mcusX) | 0;
        for (const s of comps) {
          const c = s.component;
          for (let v = 0; v < c.v; v++) for (let h = 0; h < c.h; h++)
            decode(c, ((my * c.v + v) * c.stride + mx * c.h + h) * 64, s);
        }
      }
    }
    // Continue after the scan's entropy-coded data, at the next marker.
    if (marker) { while (pos < bytes.length && bytes[pos] !== 0xff) pos++; }
    while (pos < bytes.length - 1 && !(bytes[pos] === 0xff && bytes[pos + 1] !== 0 && !(bytes[pos + 1] >= 0xd0 && bytes[pos + 1] <= 0xd7))) pos++;
    return pos;
  }

  // jidctint.c (libjpeg 9c), translated statement for statement with 32-bit integer
  // arithmetic (Math.imul, >>), as the wasm build computes it.
  const ws = new Int32Array(8 * 16), RS = (x, n) => x >> n;
  // IDCT_range_limit: sample_range_limit - RANGE_SUBSET, indexed by (x + RANGE_CENTER) & RANGE_MASK.
  const RL = new Uint8Array(1024);
  for (let i = 0; i < 1024; i++) RL[i] = Math.min(255, Math.max(0, i - 384));
  function idctislow(coefs, off, q, out, outOff, outStride) {
    let ctr, inptr, outptr, quantptr, tmp0, tmp1, tmp10, tmp11, tmp12, tmp13, tmp2, tmp3, wsptr, z1, z2, z3;
    inptr = off;
    quantptr = 0;
    wsptr = 0;
    for (ctr = 8; ctr > 0; ctr--) {
      if (coefs[inptr + 8*1] == 0 && coefs[inptr + 8*2] == 0 &&
          coefs[inptr + 8*3] == 0 && coefs[inptr + 8*4] == 0 &&
          coefs[inptr + 8*5] == 0 && coefs[inptr + 8*6] == 0 &&
          coefs[inptr + 8*7] == 0) {
        let dcval = Math.imul(coefs[inptr + 8*0], q[quantptr + 8*0]) << 2;
        ws[wsptr + 8*0] = dcval;
        ws[wsptr + 8*1] = dcval;
        ws[wsptr + 8*2] = dcval;
        ws[wsptr + 8*3] = dcval;
        ws[wsptr + 8*4] = dcval;
        ws[wsptr + 8*5] = dcval;
        ws[wsptr + 8*6] = dcval;
        ws[wsptr + 8*7] = dcval;
        inptr++;
        quantptr++;
        wsptr++;
        continue;
      }
      z2 = Math.imul(coefs[inptr + 8*0], q[quantptr + 8*0]);
      z3 = Math.imul(coefs[inptr + 8*4], q[quantptr + 8*4]);
      z2 <<= 13;
      z3 <<= 13;
      z2 += 1 << (13-2-1);
      tmp0 = z2 + z3;
      tmp1 = z2 - z3;
      z2 = Math.imul(coefs[inptr + 8*2], q[quantptr + 8*2]);
      z3 = Math.imul(coefs[inptr + 8*6], q[quantptr + 8*6]);
      z1 = Math.imul(z2 + z3, 4433);
      tmp2 = z1 + Math.imul(z2, 6270);
      tmp3 = z1 - Math.imul(z3, 15137);
      tmp10 = tmp0 + tmp2;
      tmp13 = tmp0 - tmp2;
      tmp11 = tmp1 + tmp3;
      tmp12 = tmp1 - tmp3;
      tmp0 = Math.imul(coefs[inptr + 8*7], q[quantptr + 8*7]);
      tmp1 = Math.imul(coefs[inptr + 8*5], q[quantptr + 8*5]);
      tmp2 = Math.imul(coefs[inptr + 8*3], q[quantptr + 8*3]);
      tmp3 = Math.imul(coefs[inptr + 8*1], q[quantptr + 8*1]);
      z2 = tmp0 + tmp2;
      z3 = tmp1 + tmp3;
      z1 = Math.imul(z2 + z3, 9633);
      z2 = Math.imul(z2, - 16069);
      z3 = Math.imul(z3, - 3196);
      z2 += z1;
      z3 += z1;
      z1 = Math.imul(tmp0 + tmp3, - 7373);
      tmp0 = Math.imul(tmp0, 2446);
      tmp3 = Math.imul(tmp3, 12299);
      tmp0 += z1 + z2;
      tmp3 += z1 + z3;
      z1 = Math.imul(tmp1 + tmp2, - 20995);
      tmp1 = Math.imul(tmp1, 16819);
      tmp2 = Math.imul(tmp2, 25172);
      tmp1 += z1 + z3;
      tmp2 += z1 + z2;
      ws[wsptr + 8*0] = RS(tmp10 + tmp3, 13-2);
      ws[wsptr + 8*7] = RS(tmp10 - tmp3, 13-2);
      ws[wsptr + 8*1] = RS(tmp11 + tmp2, 13-2);
      ws[wsptr + 8*6] = RS(tmp11 - tmp2, 13-2);
      ws[wsptr + 8*2] = RS(tmp12 + tmp1, 13-2);
      ws[wsptr + 8*5] = RS(tmp12 - tmp1, 13-2);
      ws[wsptr + 8*3] = RS(tmp13 + tmp0, 13-2);
      ws[wsptr + 8*4] = RS(tmp13 - tmp0, 13-2);
      inptr++;
      quantptr++;
      wsptr++;
    }
    wsptr = 0;
    for (ctr = 0; ctr < 8; ctr++) {
      outptr = outOff + ctr * outStride;
      z2 = ws[wsptr + 0] +
             (((512) << (2+3)) +
              (1 << (2+2)));
      if (ws[wsptr + 1] == 0 && ws[wsptr + 2] == 0 && ws[wsptr + 3] == 0 && ws[wsptr + 4] == 0 &&
          ws[wsptr + 5] == 0 && ws[wsptr + 6] == 0 && ws[wsptr + 7] == 0) {
        let dcval = RL[RS(z2, 2+3)
                                    & 1023];
        out[outptr + 0] = dcval;
        out[outptr + 1] = dcval;
        out[outptr + 2] = dcval;
        out[outptr + 3] = dcval;
        out[outptr + 4] = dcval;
        out[outptr + 5] = dcval;
        out[outptr + 6] = dcval;
        out[outptr + 7] = dcval;
        wsptr += 8;
        continue;
      }
      z3 = ws[wsptr + 4];
      tmp0 = (z2 + z3) << 13;
      tmp1 = (z2 - z3) << 13;
      z2 = ws[wsptr + 2];
      z3 = ws[wsptr + 6];
      z1 = Math.imul(z2 + z3, 4433);
      tmp2 = z1 + Math.imul(z2, 6270);
      tmp3 = z1 - Math.imul(z3, 15137);
      tmp10 = tmp0 + tmp2;
      tmp13 = tmp0 - tmp2;
      tmp11 = tmp1 + tmp3;
      tmp12 = tmp1 - tmp3;
      tmp0 = ws[wsptr + 7];
      tmp1 = ws[wsptr + 5];
      tmp2 = ws[wsptr + 3];
      tmp3 = ws[wsptr + 1];
      z2 = tmp0 + tmp2;
      z3 = tmp1 + tmp3;
      z1 = Math.imul(z2 + z3, 9633);
      z2 = Math.imul(z2, - 16069);
      z3 = Math.imul(z3, - 3196);
      z2 += z1;
      z3 += z1;
      z1 = Math.imul(tmp0 + tmp3, - 7373);
      tmp0 = Math.imul(tmp0, 2446);
      tmp3 = Math.imul(tmp3, 12299);
      tmp0 += z1 + z2;
      tmp3 += z1 + z3;
      z1 = Math.imul(tmp1 + tmp2, - 20995);
      tmp1 = Math.imul(tmp1, 16819);
      tmp2 = Math.imul(tmp2, 25172);
      tmp1 += z1 + z3;
      tmp2 += z1 + z2;
      out[outptr + 0] = RL[RS(tmp10 + tmp3,
                                                13+2+3)
                              & 1023];
      out[outptr + 7] = RL[RS(tmp10 - tmp3,
                                                13+2+3)
                              & 1023];
      out[outptr + 1] = RL[RS(tmp11 + tmp2,
                                                13+2+3)
                              & 1023];
      out[outptr + 6] = RL[RS(tmp11 - tmp2,
                                                13+2+3)
                              & 1023];
      out[outptr + 2] = RL[RS(tmp12 + tmp1,
                                                13+2+3)
                              & 1023];
      out[outptr + 5] = RL[RS(tmp12 - tmp1,
                                                13+2+3)
                              & 1023];
      out[outptr + 3] = RL[RS(tmp13 + tmp0,
                                                13+2+3)
                              & 1023];
      out[outptr + 4] = RL[RS(tmp13 - tmp0,
                                                13+2+3)
                              & 1023];
      wsptr += 8;
    }
  }
  function idct16x16(coefs, off, q, out, outOff, outStride) {
    let ctr, inptr, outptr, quantptr, tmp0, tmp1, tmp10, tmp11, tmp12, tmp13, tmp2, tmp20, tmp21, tmp22, tmp23, tmp24, tmp25, tmp26, tmp27, tmp3, wsptr, z1, z2, z3, z4;
    inptr = off;
    quantptr = 0;
    wsptr = 0;
    for (ctr = 0; ctr < 8; ctr++, inptr++, quantptr++, wsptr++) {
      tmp0 = Math.imul(coefs[inptr + 8*0], q[quantptr + 8*0]);
      tmp0 <<= 13;
      tmp0 += 1 << (13-2-1);
      z1 = Math.imul(coefs[inptr + 8*4], q[quantptr + 8*4]);
      tmp1 = Math.imul(z1, 10703);
      tmp2 = Math.imul(z1, 4433);
      tmp10 = tmp0 + tmp1;
      tmp11 = tmp0 - tmp1;
      tmp12 = tmp0 + tmp2;
      tmp13 = tmp0 - tmp2;
      z1 = Math.imul(coefs[inptr + 8*2], q[quantptr + 8*2]);
      z2 = Math.imul(coefs[inptr + 8*6], q[quantptr + 8*6]);
      z3 = z1 - z2;
      z4 = Math.imul(z3, 2260);
      z3 = Math.imul(z3, 11363);
      tmp0 = z3 + Math.imul(z2, 20995);
      tmp1 = z4 + Math.imul(z1, 7373);
      tmp2 = z3 - Math.imul(z1, 4926);
      tmp3 = z4 - Math.imul(z2, 4176);
      tmp20 = tmp10 + tmp0;
      tmp27 = tmp10 - tmp0;
      tmp21 = tmp12 + tmp1;
      tmp26 = tmp12 - tmp1;
      tmp22 = tmp13 + tmp2;
      tmp25 = tmp13 - tmp2;
      tmp23 = tmp11 + tmp3;
      tmp24 = tmp11 - tmp3;
      z1 = Math.imul(coefs[inptr + 8*1], q[quantptr + 8*1]);
      z2 = Math.imul(coefs[inptr + 8*3], q[quantptr + 8*3]);
      z3 = Math.imul(coefs[inptr + 8*5], q[quantptr + 8*5]);
      z4 = Math.imul(coefs[inptr + 8*7], q[quantptr + 8*7]);
      tmp11 = z1 + z3;
      tmp1  = Math.imul(z1 + z2, 11086);
      tmp2  = Math.imul(tmp11,   10217);
      tmp3  = Math.imul(z1 + z4, 8956);
      tmp10 = Math.imul(z1 - z4, 7350);
      tmp11 = Math.imul(tmp11,   5461);
      tmp12 = Math.imul(z1 - z2, 3363);
      tmp0  = tmp1 + tmp2 + tmp3 -
              Math.imul(z1, 18730);
      tmp13 = tmp10 + tmp11 + tmp12 -
              Math.imul(z1, 15038);
      z1    = Math.imul(z2 + z3, 1136);
      tmp1  += z1 + Math.imul(z2, 589);
      tmp2  += z1 - Math.imul(z3, 9222);
      z1    = Math.imul(z3 - z2, 11529);
      tmp11 += z1 - Math.imul(z3, 6278);
      tmp12 += z1 + Math.imul(z2, 16154);
      z2    += z4;
      z1    = Math.imul(z2, - 5461);
      tmp1  += z1;
      tmp3  += z1 + Math.imul(z4, 8728);
      z2    = Math.imul(z2, - 10217);
      tmp10 += z2 + Math.imul(z4, 25733);
      tmp12 += z2;
      z2    = Math.imul(z3 + z4, - 11086);
      tmp2  += z2;
      tmp3  += z2;
      z2    = Math.imul(z4 - z3, 3363);
      tmp10 += z2;
      tmp11 += z2;
      ws[wsptr + 8*0]  = RS(tmp20 + tmp0,  13-2);
      ws[wsptr + 8*15] = RS(tmp20 - tmp0,  13-2);
      ws[wsptr + 8*1]  = RS(tmp21 + tmp1,  13-2);
      ws[wsptr + 8*14] = RS(tmp21 - tmp1,  13-2);
      ws[wsptr + 8*2]  = RS(tmp22 + tmp2,  13-2);
      ws[wsptr + 8*13] = RS(tmp22 - tmp2,  13-2);
      ws[wsptr + 8*3]  = RS(tmp23 + tmp3,  13-2);
      ws[wsptr + 8*12] = RS(tmp23 - tmp3,  13-2);
      ws[wsptr + 8*4]  = RS(tmp24 + tmp10, 13-2);
      ws[wsptr + 8*11] = RS(tmp24 - tmp10, 13-2);
      ws[wsptr + 8*5]  = RS(tmp25 + tmp11, 13-2);
      ws[wsptr + 8*10] = RS(tmp25 - tmp11, 13-2);
      ws[wsptr + 8*6]  = RS(tmp26 + tmp12, 13-2);
      ws[wsptr + 8*9]  = RS(tmp26 - tmp12, 13-2);
      ws[wsptr + 8*7]  = RS(tmp27 + tmp13, 13-2);
      ws[wsptr + 8*8]  = RS(tmp27 - tmp13, 13-2);
    }
    wsptr = 0;
    for (ctr = 0; ctr < 16; ctr++) {
      outptr = outOff + ctr * outStride;
      tmp0 = ws[wsptr + 0] +
               (((512) << (2+3)) +
                (1 << (2+2)));
      tmp0 <<= 13;
      z1 = ws[wsptr + 4];
      tmp1 = Math.imul(z1, 10703);
      tmp2 = Math.imul(z1, 4433);
      tmp10 = tmp0 + tmp1;
      tmp11 = tmp0 - tmp1;
      tmp12 = tmp0 + tmp2;
      tmp13 = tmp0 - tmp2;
      z1 = ws[wsptr + 2];
      z2 = ws[wsptr + 6];
      z3 = z1 - z2;
      z4 = Math.imul(z3, 2260);
      z3 = Math.imul(z3, 11363);
      tmp0 = z3 + Math.imul(z2, 20995);
      tmp1 = z4 + Math.imul(z1, 7373);
      tmp2 = z3 - Math.imul(z1, 4926);
      tmp3 = z4 - Math.imul(z2, 4176);
      tmp20 = tmp10 + tmp0;
      tmp27 = tmp10 - tmp0;
      tmp21 = tmp12 + tmp1;
      tmp26 = tmp12 - tmp1;
      tmp22 = tmp13 + tmp2;
      tmp25 = tmp13 - tmp2;
      tmp23 = tmp11 + tmp3;
      tmp24 = tmp11 - tmp3;
      z1 = ws[wsptr + 1];
      z2 = ws[wsptr + 3];
      z3 = ws[wsptr + 5];
      z4 = ws[wsptr + 7];
      tmp11 = z1 + z3;
      tmp1  = Math.imul(z1 + z2, 11086);
      tmp2  = Math.imul(tmp11,   10217);
      tmp3  = Math.imul(z1 + z4, 8956);
      tmp10 = Math.imul(z1 - z4, 7350);
      tmp11 = Math.imul(tmp11,   5461);
      tmp12 = Math.imul(z1 - z2, 3363);
      tmp0  = tmp1 + tmp2 + tmp3 -
              Math.imul(z1, 18730);
      tmp13 = tmp10 + tmp11 + tmp12 -
              Math.imul(z1, 15038);
      z1    = Math.imul(z2 + z3, 1136);
      tmp1  += z1 + Math.imul(z2, 589);
      tmp2  += z1 - Math.imul(z3, 9222);
      z1    = Math.imul(z3 - z2, 11529);
      tmp11 += z1 - Math.imul(z3, 6278);
      tmp12 += z1 + Math.imul(z2, 16154);
      z2    += z4;
      z1    = Math.imul(z2, - 5461);
      tmp1  += z1;
      tmp3  += z1 + Math.imul(z4, 8728);
      z2    = Math.imul(z2, - 10217);
      tmp10 += z2 + Math.imul(z4, 25733);
      tmp12 += z2;
      z2    = Math.imul(z3 + z4, - 11086);
      tmp2  += z2;
      tmp3  += z2;
      z2    = Math.imul(z4 - z3, 3363);
      tmp10 += z2;
      tmp11 += z2;
      out[outptr + 0]  = RL[RS(tmp20 + tmp0,
                                                 13+2+3)
                               & 1023];
      out[outptr + 15] = RL[RS(tmp20 - tmp0,
                                                 13+2+3)
                               & 1023];
      out[outptr + 1]  = RL[RS(tmp21 + tmp1,
                                                 13+2+3)
                               & 1023];
      out[outptr + 14] = RL[RS(tmp21 - tmp1,
                                                 13+2+3)
                               & 1023];
      out[outptr + 2]  = RL[RS(tmp22 + tmp2,
                                                 13+2+3)
                               & 1023];
      out[outptr + 13] = RL[RS(tmp22 - tmp2,
                                                 13+2+3)
                               & 1023];
      out[outptr + 3]  = RL[RS(tmp23 + tmp3,
                                                 13+2+3)
                               & 1023];
      out[outptr + 12] = RL[RS(tmp23 - tmp3,
                                                 13+2+3)
                               & 1023];
      out[outptr + 4]  = RL[RS(tmp24 + tmp10,
                                                 13+2+3)
                               & 1023];
      out[outptr + 11] = RL[RS(tmp24 - tmp10,
                                                 13+2+3)
                               & 1023];
      out[outptr + 5]  = RL[RS(tmp25 + tmp11,
                                                 13+2+3)
                               & 1023];
      out[outptr + 10] = RL[RS(tmp25 - tmp11,
                                                 13+2+3)
                               & 1023];
      out[outptr + 6]  = RL[RS(tmp26 + tmp12,
                                                 13+2+3)
                               & 1023];
      out[outptr + 9]  = RL[RS(tmp26 - tmp12,
                                                 13+2+3)
                               & 1023];
      out[outptr + 7]  = RL[RS(tmp27 + tmp13,
                                                 13+2+3)
                               & 1023];
      out[outptr + 8]  = RL[RS(tmp27 - tmp13,
                                                 13+2+3)
                               & 1023];
      wsptr += 8;
    }
  }
  function idct16x8(coefs, off, q, out, outOff, outStride) {
    let ctr, inptr, outptr, quantptr, tmp0, tmp1, tmp10, tmp11, tmp12, tmp13, tmp2, tmp20, tmp21, tmp22, tmp23, tmp24, tmp25, tmp26, tmp27, tmp3, wsptr, z1, z2, z3, z4;
    inptr = off;
    quantptr = 0;
    wsptr = 0;
    for (ctr = 8; ctr > 0; ctr--) {
      if (coefs[inptr + 8*1] == 0 && coefs[inptr + 8*2] == 0 &&
          coefs[inptr + 8*3] == 0 && coefs[inptr + 8*4] == 0 &&
          coefs[inptr + 8*5] == 0 && coefs[inptr + 8*6] == 0 &&
          coefs[inptr + 8*7] == 0) {
        let dcval = Math.imul(coefs[inptr + 8*0], q[quantptr + 8*0]) << 2;
        ws[wsptr + 8*0] = dcval;
        ws[wsptr + 8*1] = dcval;
        ws[wsptr + 8*2] = dcval;
        ws[wsptr + 8*3] = dcval;
        ws[wsptr + 8*4] = dcval;
        ws[wsptr + 8*5] = dcval;
        ws[wsptr + 8*6] = dcval;
        ws[wsptr + 8*7] = dcval;
        inptr++;
        quantptr++;
        wsptr++;
        continue;
      }
      z2 = Math.imul(coefs[inptr + 8*0], q[quantptr + 8*0]);
      z3 = Math.imul(coefs[inptr + 8*4], q[quantptr + 8*4]);
      z2 <<= 13;
      z3 <<= 13;
      z2 += 1 << (13-2-1);
      tmp0 = z2 + z3;
      tmp1 = z2 - z3;
      z2 = Math.imul(coefs[inptr + 8*2], q[quantptr + 8*2]);
      z3 = Math.imul(coefs[inptr + 8*6], q[quantptr + 8*6]);
      z1 = Math.imul(z2 + z3, 4433);
      tmp2 = z1 + Math.imul(z2, 6270);
      tmp3 = z1 - Math.imul(z3, 15137);
      tmp10 = tmp0 + tmp2;
      tmp13 = tmp0 - tmp2;
      tmp11 = tmp1 + tmp3;
      tmp12 = tmp1 - tmp3;
      tmp0 = Math.imul(coefs[inptr + 8*7], q[quantptr + 8*7]);
      tmp1 = Math.imul(coefs[inptr + 8*5], q[quantptr + 8*5]);
      tmp2 = Math.imul(coefs[inptr + 8*3], q[quantptr + 8*3]);
      tmp3 = Math.imul(coefs[inptr + 8*1], q[quantptr + 8*1]);
      z2 = tmp0 + tmp2;
      z3 = tmp1 + tmp3;
      z1 = Math.imul(z2 + z3, 9633);
      z2 = Math.imul(z2, - 16069);
      z3 = Math.imul(z3, - 3196);
      z2 += z1;
      z3 += z1;
      z1 = Math.imul(tmp0 + tmp3, - 7373);
      tmp0 = Math.imul(tmp0, 2446);
      tmp3 = Math.imul(tmp3, 12299);
      tmp0 += z1 + z2;
      tmp3 += z1 + z3;
      z1 = Math.imul(tmp1 + tmp2, - 20995);
      tmp1 = Math.imul(tmp1, 16819);
      tmp2 = Math.imul(tmp2, 25172);
      tmp1 += z1 + z3;
      tmp2 += z1 + z2;
      ws[wsptr + 8*0] = RS(tmp10 + tmp3, 13-2);
      ws[wsptr + 8*7] = RS(tmp10 - tmp3, 13-2);
      ws[wsptr + 8*1] = RS(tmp11 + tmp2, 13-2);
      ws[wsptr + 8*6] = RS(tmp11 - tmp2, 13-2);
      ws[wsptr + 8*2] = RS(tmp12 + tmp1, 13-2);
      ws[wsptr + 8*5] = RS(tmp12 - tmp1, 13-2);
      ws[wsptr + 8*3] = RS(tmp13 + tmp0, 13-2);
      ws[wsptr + 8*4] = RS(tmp13 - tmp0, 13-2);
      inptr++;
      quantptr++;
      wsptr++;
    }
    wsptr = 0;
    for (ctr = 0; ctr < 8; ctr++) {
      outptr = outOff + ctr * outStride;
      tmp0 = ws[wsptr + 0] +
               (((512) << (2+3)) +
                (1 << (2+2)));
      tmp0 <<= 13;
      z1 = ws[wsptr + 4];
      tmp1 = Math.imul(z1, 10703);
      tmp2 = Math.imul(z1, 4433);
      tmp10 = tmp0 + tmp1;
      tmp11 = tmp0 - tmp1;
      tmp12 = tmp0 + tmp2;
      tmp13 = tmp0 - tmp2;
      z1 = ws[wsptr + 2];
      z2 = ws[wsptr + 6];
      z3 = z1 - z2;
      z4 = Math.imul(z3, 2260);
      z3 = Math.imul(z3, 11363);
      tmp0 = z3 + Math.imul(z2, 20995);
      tmp1 = z4 + Math.imul(z1, 7373);
      tmp2 = z3 - Math.imul(z1, 4926);
      tmp3 = z4 - Math.imul(z2, 4176);
      tmp20 = tmp10 + tmp0;
      tmp27 = tmp10 - tmp0;
      tmp21 = tmp12 + tmp1;
      tmp26 = tmp12 - tmp1;
      tmp22 = tmp13 + tmp2;
      tmp25 = tmp13 - tmp2;
      tmp23 = tmp11 + tmp3;
      tmp24 = tmp11 - tmp3;
      z1 = ws[wsptr + 1];
      z2 = ws[wsptr + 3];
      z3 = ws[wsptr + 5];
      z4 = ws[wsptr + 7];
      tmp11 = z1 + z3;
      tmp1  = Math.imul(z1 + z2, 11086);
      tmp2  = Math.imul(tmp11,   10217);
      tmp3  = Math.imul(z1 + z4, 8956);
      tmp10 = Math.imul(z1 - z4, 7350);
      tmp11 = Math.imul(tmp11,   5461);
      tmp12 = Math.imul(z1 - z2, 3363);
      tmp0  = tmp1 + tmp2 + tmp3 -
              Math.imul(z1, 18730);
      tmp13 = tmp10 + tmp11 + tmp12 -
              Math.imul(z1, 15038);
      z1    = Math.imul(z2 + z3, 1136);
      tmp1  += z1 + Math.imul(z2, 589);
      tmp2  += z1 - Math.imul(z3, 9222);
      z1    = Math.imul(z3 - z2, 11529);
      tmp11 += z1 - Math.imul(z3, 6278);
      tmp12 += z1 + Math.imul(z2, 16154);
      z2    += z4;
      z1    = Math.imul(z2, - 5461);
      tmp1  += z1;
      tmp3  += z1 + Math.imul(z4, 8728);
      z2    = Math.imul(z2, - 10217);
      tmp10 += z2 + Math.imul(z4, 25733);
      tmp12 += z2;
      z2    = Math.imul(z3 + z4, - 11086);
      tmp2  += z2;
      tmp3  += z2;
      z2    = Math.imul(z4 - z3, 3363);
      tmp10 += z2;
      tmp11 += z2;
      out[outptr + 0]  = RL[RS(tmp20 + tmp0,
                                                 13+2+3)
                               & 1023];
      out[outptr + 15] = RL[RS(tmp20 - tmp0,
                                                 13+2+3)
                               & 1023];
      out[outptr + 1]  = RL[RS(tmp21 + tmp1,
                                                 13+2+3)
                               & 1023];
      out[outptr + 14] = RL[RS(tmp21 - tmp1,
                                                 13+2+3)
                               & 1023];
      out[outptr + 2]  = RL[RS(tmp22 + tmp2,
                                                 13+2+3)
                               & 1023];
      out[outptr + 13] = RL[RS(tmp22 - tmp2,
                                                 13+2+3)
                               & 1023];
      out[outptr + 3]  = RL[RS(tmp23 + tmp3,
                                                 13+2+3)
                               & 1023];
      out[outptr + 12] = RL[RS(tmp23 - tmp3,
                                                 13+2+3)
                               & 1023];
      out[outptr + 4]  = RL[RS(tmp24 + tmp10,
                                                 13+2+3)
                               & 1023];
      out[outptr + 11] = RL[RS(tmp24 - tmp10,
                                                 13+2+3)
                               & 1023];
      out[outptr + 5]  = RL[RS(tmp25 + tmp11,
                                                 13+2+3)
                               & 1023];
      out[outptr + 10] = RL[RS(tmp25 - tmp11,
                                                 13+2+3)
                               & 1023];
      out[outptr + 6]  = RL[RS(tmp26 + tmp12,
                                                 13+2+3)
                               & 1023];
      out[outptr + 9]  = RL[RS(tmp26 - tmp12,
                                                 13+2+3)
                               & 1023];
      out[outptr + 7]  = RL[RS(tmp27 + tmp13,
                                                 13+2+3)
                               & 1023];
      out[outptr + 8]  = RL[RS(tmp27 - tmp13,
                                                 13+2+3)
                               & 1023];
      wsptr += 8;
    }
  }
  function idct8x16(coefs, off, q, out, outOff, outStride) {
    let ctr, inptr, outptr, quantptr, tmp0, tmp1, tmp10, tmp11, tmp12, tmp13, tmp2, tmp20, tmp21, tmp22, tmp23, tmp24, tmp25, tmp26, tmp27, tmp3, wsptr, z1, z2, z3, z4;
    inptr = off;
    quantptr = 0;
    wsptr = 0;
    for (ctr = 0; ctr < 8; ctr++, inptr++, quantptr++, wsptr++) {
      tmp0 = Math.imul(coefs[inptr + 8*0], q[quantptr + 8*0]);
      tmp0 <<= 13;
      tmp0 += 1 << (13-2-1);
      z1 = Math.imul(coefs[inptr + 8*4], q[quantptr + 8*4]);
      tmp1 = Math.imul(z1, 10703);
      tmp2 = Math.imul(z1, 4433);
      tmp10 = tmp0 + tmp1;
      tmp11 = tmp0 - tmp1;
      tmp12 = tmp0 + tmp2;
      tmp13 = tmp0 - tmp2;
      z1 = Math.imul(coefs[inptr + 8*2], q[quantptr + 8*2]);
      z2 = Math.imul(coefs[inptr + 8*6], q[quantptr + 8*6]);
      z3 = z1 - z2;
      z4 = Math.imul(z3, 2260);
      z3 = Math.imul(z3, 11363);
      tmp0 = z3 + Math.imul(z2, 20995);
      tmp1 = z4 + Math.imul(z1, 7373);
      tmp2 = z3 - Math.imul(z1, 4926);
      tmp3 = z4 - Math.imul(z2, 4176);
      tmp20 = tmp10 + tmp0;
      tmp27 = tmp10 - tmp0;
      tmp21 = tmp12 + tmp1;
      tmp26 = tmp12 - tmp1;
      tmp22 = tmp13 + tmp2;
      tmp25 = tmp13 - tmp2;
      tmp23 = tmp11 + tmp3;
      tmp24 = tmp11 - tmp3;
      z1 = Math.imul(coefs[inptr + 8*1], q[quantptr + 8*1]);
      z2 = Math.imul(coefs[inptr + 8*3], q[quantptr + 8*3]);
      z3 = Math.imul(coefs[inptr + 8*5], q[quantptr + 8*5]);
      z4 = Math.imul(coefs[inptr + 8*7], q[quantptr + 8*7]);
      tmp11 = z1 + z3;
      tmp1  = Math.imul(z1 + z2, 11086);
      tmp2  = Math.imul(tmp11,   10217);
      tmp3  = Math.imul(z1 + z4, 8956);
      tmp10 = Math.imul(z1 - z4, 7350);
      tmp11 = Math.imul(tmp11,   5461);
      tmp12 = Math.imul(z1 - z2, 3363);
      tmp0  = tmp1 + tmp2 + tmp3 -
              Math.imul(z1, 18730);
      tmp13 = tmp10 + tmp11 + tmp12 -
              Math.imul(z1, 15038);
      z1    = Math.imul(z2 + z3, 1136);
      tmp1  += z1 + Math.imul(z2, 589);
      tmp2  += z1 - Math.imul(z3, 9222);
      z1    = Math.imul(z3 - z2, 11529);
      tmp11 += z1 - Math.imul(z3, 6278);
      tmp12 += z1 + Math.imul(z2, 16154);
      z2    += z4;
      z1    = Math.imul(z2, - 5461);
      tmp1  += z1;
      tmp3  += z1 + Math.imul(z4, 8728);
      z2    = Math.imul(z2, - 10217);
      tmp10 += z2 + Math.imul(z4, 25733);
      tmp12 += z2;
      z2    = Math.imul(z3 + z4, - 11086);
      tmp2  += z2;
      tmp3  += z2;
      z2    = Math.imul(z4 - z3, 3363);
      tmp10 += z2;
      tmp11 += z2;
      ws[wsptr + 8*0]  = RS(tmp20 + tmp0,  13-2);
      ws[wsptr + 8*15] = RS(tmp20 - tmp0,  13-2);
      ws[wsptr + 8*1]  = RS(tmp21 + tmp1,  13-2);
      ws[wsptr + 8*14] = RS(tmp21 - tmp1,  13-2);
      ws[wsptr + 8*2]  = RS(tmp22 + tmp2,  13-2);
      ws[wsptr + 8*13] = RS(tmp22 - tmp2,  13-2);
      ws[wsptr + 8*3]  = RS(tmp23 + tmp3,  13-2);
      ws[wsptr + 8*12] = RS(tmp23 - tmp3,  13-2);
      ws[wsptr + 8*4]  = RS(tmp24 + tmp10, 13-2);
      ws[wsptr + 8*11] = RS(tmp24 - tmp10, 13-2);
      ws[wsptr + 8*5]  = RS(tmp25 + tmp11, 13-2);
      ws[wsptr + 8*10] = RS(tmp25 - tmp11, 13-2);
      ws[wsptr + 8*6]  = RS(tmp26 + tmp12, 13-2);
      ws[wsptr + 8*9]  = RS(tmp26 - tmp12, 13-2);
      ws[wsptr + 8*7]  = RS(tmp27 + tmp13, 13-2);
      ws[wsptr + 8*8]  = RS(tmp27 - tmp13, 13-2);
    }
    wsptr = 0;
    for (ctr = 0; ctr < 16; ctr++) {
      outptr = outOff + ctr * outStride;
      z2 = ws[wsptr + 0] +
             (((512) << (2+3)) +
              (1 << (2+2)));
      z3 = ws[wsptr + 4];
      tmp0 = (z2 + z3) << 13;
      tmp1 = (z2 - z3) << 13;
      z2 = ws[wsptr + 2];
      z3 = ws[wsptr + 6];
      z1 = Math.imul(z2 + z3, 4433);
      tmp2 = z1 + Math.imul(z2, 6270);
      tmp3 = z1 - Math.imul(z3, 15137);
      tmp10 = tmp0 + tmp2;
      tmp13 = tmp0 - tmp2;
      tmp11 = tmp1 + tmp3;
      tmp12 = tmp1 - tmp3;
      tmp0 = ws[wsptr + 7];
      tmp1 = ws[wsptr + 5];
      tmp2 = ws[wsptr + 3];
      tmp3 = ws[wsptr + 1];
      z2 = tmp0 + tmp2;
      z3 = tmp1 + tmp3;
      z1 = Math.imul(z2 + z3, 9633);
      z2 = Math.imul(z2, - 16069);
      z3 = Math.imul(z3, - 3196);
      z2 += z1;
      z3 += z1;
      z1 = Math.imul(tmp0 + tmp3, - 7373);
      tmp0 = Math.imul(tmp0, 2446);
      tmp3 = Math.imul(tmp3, 12299);
      tmp0 += z1 + z2;
      tmp3 += z1 + z3;
      z1 = Math.imul(tmp1 + tmp2, - 20995);
      tmp1 = Math.imul(tmp1, 16819);
      tmp2 = Math.imul(tmp2, 25172);
      tmp1 += z1 + z3;
      tmp2 += z1 + z2;
      out[outptr + 0] = RL[RS(tmp10 + tmp3,
                                                13+2+3)
                              & 1023];
      out[outptr + 7] = RL[RS(tmp10 - tmp3,
                                                13+2+3)
                              & 1023];
      out[outptr + 1] = RL[RS(tmp11 + tmp2,
                                                13+2+3)
                              & 1023];
      out[outptr + 6] = RL[RS(tmp11 - tmp2,
                                                13+2+3)
                              & 1023];
      out[outptr + 2] = RL[RS(tmp12 + tmp1,
                                                13+2+3)
                              & 1023];
      out[outptr + 5] = RL[RS(tmp12 - tmp1,
                                                13+2+3)
                              & 1023];
      out[outptr + 3] = RL[RS(tmp13 + tmp0,
                                                13+2+3)
                              & 1023];
      out[outptr + 4] = RL[RS(tmp13 - tmp0,
                                                13+2+3)
                              & 1023];
      wsptr += 8;
    }
  }

  const IDCT = {'8x8': idctislow, '16x16': idct16x16, '16x8': idct16x8, '8x16': idct8x16};

  // jpeg_calc_output_dimensions: chroma is scaled up in the IDCT where the ratio is a power of 2.
  function scaledSize(max, factor) {
    let ssize = 1;
    while (8 * ssize <= 8 && max % (factor * ssize * 2) === 0) ssize *= 2;
    return 8 * ssize;
  }

  // Component samples over its whole block grid, each block DCT_h x DCT_v samples.
  function samples(frame, c, q) {
    if (!q) fail('missing quantization table');
    let h = scaledSize(frame.hmax, c.h), v = scaledSize(frame.vmax, c.v);
    if (h > v * 2) h = v * 2; else if (v > h * 2) v = h * 2;
    const idct = IDCT[h + 'x' + v];
    if (!idct) fail('unsupported IDCT size');
    const stride = c.stride * h, out = new Uint8Array(stride * c.rows * v);
    for (let by = 0; by < c.rows; by++) for (let bx = 0; bx < c.stride; bx++)
      idct(c.coefs, (by * c.stride + bx) * 64, q, out, by * v * stride + bx * h, stride);
    return {data: out, stride, h, v};
  }

  // jdsample.c (9c): what the IDCT did not scale is replicated (box filter).
  function upsample(frame, c, plane) {
    const W = frame.width, H = frame.height, out = new Uint8Array(W * H), {data, stride} = plane;
    const inH = c.h * plane.h / 8, inV = c.v * plane.v / 8;
    if (frame.hmax % inH || frame.vmax % inV) fail('unsupported sampling');
    const hx = frame.hmax / inH, vx = frame.vmax / inV;
    for (let y = 0; y < H; y++) {
      const i = ((y / vx) | 0) * stride, o = y * W;
      if (hx === 1) out.set(data.subarray(i, i + W), o);
      else for (let x = 0; x < W; x++) out[o + x] = data[i + ((x / hx) | 0)];
    }
    return out;
  }

  // jdcolor.c tables.
  const CR_R = new Int32Array(256), CB_B = new Int32Array(256), CR_G = new Int32Array(256), CB_G = new Int32Array(256);
  for (let i = 0, x = -128; i < 256; i++, x++) {
    CR_R[i] = (91881 * x + 32768) >> 16; CB_B[i] = (116130 * x + 32768) >> 16;
    CR_G[i] = -46802 * x; CB_G[i] = -22553 * x + 32768; // FIX(0.714136286), FIX(0.344136286)
  }
  const clamp = v => (v < 0 ? 0 : v > 255 ? 255 : v);

  // ImageOps.exif_transpose on packed RGB.
  function transpose(pixels, width, height, orientation) {
    if (orientation < 2 || orientation > 8) return {pixels, width, height};
    const swap = orientation >= 5, W = swap ? height : width, H = swap ? width : height, out = new Uint8Array(pixels.length);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let sx, sy;
      switch (orientation) {
        case 2: sx = width - 1 - x; sy = y; break;
        case 3: sx = width - 1 - x; sy = height - 1 - y; break;
        case 4: sx = x; sy = height - 1 - y; break;
        case 5: sx = y; sy = x; break;
        case 6: sx = y; sy = height - 1 - x; break;
        case 7: sx = width - 1 - y; sy = height - 1 - x; break;
        default: sx = width - 1 - y; sy = x;
      }
      const s = (sy * width + sx) * 3, d = (y * W + x) * 3;
      out[d] = pixels[s]; out[d + 1] = pixels[s + 1]; out[d + 2] = pixels[s + 2];
    }
    return {pixels: out, width: W, height: H};
  }

  function decode(bytes) {
    const {frame, quant, adobe, jfif, orientation} = parse(bytes);
    if (!frame.blocks) fail('no image data');
    const {width, height, components} = frame;
    if (components.length !== 1 && components.length !== 3) fail('only grayscale or 3-component JPEG');
    const planes = components.map(c => upsample(frame, c, samples(frame, c, quant[c.tq]))), W = width;
    const pixels = new Uint8Array(width * height * 3);
    if (components.length === 1) {
      const g = planes[0];
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const v = g[y * W + x], d = (y * width + x) * 3; pixels[d] = pixels[d + 1] = pixels[d + 2] = v; }
    } else {
      // default_decompress_parms (9c): component ids first, then JFIF, then Adobe's transform flag.
      const id = components.map(c => c.id).join(',');
      let rgb;
      if (id === '1,2,3') rgb = false;
      else if (id === '82,71,66') rgb = true;
      else if (id === '1,34,35' || id === '114,103,98') fail('big gamut colour space');
      else if (jfif) rgb = false;
      else rgb = adobe === 0;
      const [Y, Cb, Cr] = planes;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = y * W + x, d = (y * width + x) * 3;
        if (rgb) { pixels[d] = Y[i]; pixels[d + 1] = Cb[i]; pixels[d + 2] = Cr[i]; continue; }
        const l = Y[i], cb = Cb[i], cr = Cr[i];
        pixels[d] = clamp(l + CR_R[cr]);
        pixels[d + 1] = clamp(l + ((CB_G[cb] + CR_G[cr]) >> 16));
        pixels[d + 2] = clamp(l + CB_B[cb]);
      }
    }
    return transpose(pixels, width, height, orientation);
  }

  PM.jpeg = {decode, transpose, Unsupported};
});
