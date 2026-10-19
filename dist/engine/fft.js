/* NumPy 2.0's complex FFT (C++ pocketfft: radix 2/3/4/5/7/8/11 passes, the generic
 * pass, Bluestein for large prime factors) and abs(fft2) of a real image, operation for
 * operation, so the Fourier features round exactly as the former engine did. That
 * engine's libm (musl) sin, cos and hypot are reproduced too: Math.* differ in the last
 * bit for some inputs, and tempo and note choices sit on exact boundaries of these values. */
(self.PixelMusicEngineModules = self.PixelMusicEngineModules || []).push(function (PM) {
  'use strict';

  // musl's kernels, exact for |x| <= pi/4 (all the twiddle angles are in that range).
  function cosKernel(x) {
    if (Math.abs(x) < 1.0536712127723509e-8) return 1;
    const z = x * x, w = z * z;
    const r = z * (4.16666666666666019037e-02 + z * (-1.38888888888741095749e-03 + z * 2.48015872894767294178e-05))
      + w * w * (-2.75573143513906633035e-07 + z * (2.08757232129817482790e-09 + z * -1.13596475577881948265e-11));
    const hz = .5 * z, v = 1 - hz;
    return v + (((1 - v) - hz) + (z * r - x * 0));
  }
  function sinKernel(x) {
    if (Math.abs(x) < 1.4901161193847656e-8) return x;
    const z = x * x, w = z * z;
    const r = 8.33333333332248946124e-03 + z * (-1.98412698298579493134e-04 + z * 2.75573137070700676789e-06)
      + z * w * (-2.50507602534068634195e-08 + z * 1.58969099521155010221e-10);
    return x + z * x * (-1.66666666666666324348e-01 + z * r);
  }

  // musl hypot: squares split into exact high and low parts, then one sqrt.
  const SPLIT = 134217729;
  const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
  const exponent = x => { f64[0] = x; return u32[1] >>> 20 & 0x7ff; };
  function hypot(x, y) {
    x = Math.abs(x); y = Math.abs(y);
    if (x < y) { const t = x; x = y; y = t; }
    const ex = exponent(x), ey = exponent(y);
    if (ey === 0x7ff) return y;
    if (ex === 0x7ff || y === 0) return x;
    if (ex - ey > 64) return x + y;
    let z = 1;
    if (ex > 0x3ff + 510) { z = 2 ** 700; x *= 2 ** -700; y *= 2 ** -700; }
    else if (ey < 0x3ff - 450) { z = 2 ** -700; x *= 2 ** 700; y *= 2 ** 700; }
    // sq(x) and sq(y) inlined: [hi, lo] with hi = x * x and lo its exact rounding error.
    const xc = x * SPLIT, xh = x - xc + xc, xl = x - xh, hx = x * x, lx = xh * xh - hx + 2 * xh * xl + xl * xl;
    const yc = y * SPLIT, yh = y - yc + yc, yl = y - yh, hy = y * y, ly = yh * yh - hy + 2 * yh * yl + yl * yl;
    return z * Math.sqrt(ly + lx + hy + hx);
  }

  // (pi / 4) / n rounded once to double, as 0.25L*pi/n in 128-bit long double.
  function quarterPiOver(n) {
    const hi = Math.PI / 4, lo = 1.2246467991473532e-16 / 4, q = hi / n;
    // q * n exactly (Dekker), so the remainder and the low part of pi refine q.
    const p = q * n, c = q * SPLIT, qh = c - (c - q), ql = q - qh, d = n * SPLIT, nh = d - (d - n), nl = n - nh;
    const pl = ((qh * nh - p) + qh * nl + ql * nh) + ql * nl;
    return q + ((hi - p) - pl + lo) / n;
  }

  // sincos_2pibyn: exp(-+2 pi i k / n) from two tables, as pocketfft builds them.
  function twiddleTable(n) {
    const ang = quarterPiOver(n);
    const calc = (x, n) => {
      x *= 8;
      if (x < 4 * n) {
        if (x < 2 * n) {
          if (x < n) return [cosKernel(x * ang), sinKernel(x * ang)];
          return [sinKernel((2 * n - x) * ang), cosKernel((2 * n - x) * ang)];
        }
        x -= 2 * n;
        if (x < n) return [-sinKernel(x * ang), cosKernel(x * ang)];
        return [-cosKernel((2 * n - x) * ang), sinKernel((2 * n - x) * ang)];
      }
      x = 8 * n - x;
      if (x < 2 * n) {
        if (x < n) return [cosKernel(x * ang), -sinKernel(x * ang)];
        return [sinKernel((2 * n - x) * ang), -cosKernel((2 * n - x) * ang)];
      }
      x -= 2 * n;
      if (x < n) return [-sinKernel(x * ang), -cosKernel(x * ang)];
      return [-cosKernel((2 * n - x) * ang), -sinKernel((2 * n - x) * ang)];
    };
    const nval = Math.floor((n + 2) / 2);
    let shift = 1;
    while (2 ** shift * 2 ** shift < nval) shift++;
    const mask = 2 ** shift - 1, size2 = Math.floor((nval + mask) / (mask + 1));
    const v1 = new Float64Array(2 * (mask + 1)), v2 = new Float64Array(2 * size2);
    v1[0] = 1; v2[0] = 1;
    for (let i = 1; i <= mask; i++) { const [r, s] = calc(i, n); v1[2 * i] = r; v1[2 * i + 1] = s; }
    for (let i = 1; i < size2; i++) { const [r, s] = calc(i * (mask + 1), n); v2[2 * i] = r; v2[2 * i + 1] = s; }
    return idx => {
      let sign = 1;
      if (2 * idx > n) { idx = n - idx; sign = -1; }
      const a = 2 * (idx & mask), b = 2 * Math.floor(idx / (mask + 1));
      const x1r = v1[a], x1i = v1[a + 1], x2r = v2[b], x2i = v2[b + 1];
      const im = x1r * x2i + x1i * x2r;
      return [x1r * x2r - x1i * x2i, sign < 0 ? -im : im];
    };
  }

  const TW3 = [-.5], TW3I = [.8660254037844386];
  const R5 = [.30901699437494745, -.8090169943749475], I5 = [.9510565162951535, .5877852522924731];
  const R7 = [.6234898018587335, -.2225209339563144, -.9009688679024191], I7 = [.7818314824680298, .9749279121818236, .4338837391175581];
  const R11 = [.8412535328311812, .41541501300188644, -.14231483827328514, -.6548607339452851, -.9594929736144974];
  const I11 = [.5406408174555976, .9096319953545183, .9898214418809327, .7557495743542583, .28173255684142967];
  // For each output pair u, p-u: which cosine and signed sine constants multiply the sums
  // and differences of inputs (j, p-j), in pocketfft's order.
  const ODD = {
    3: {r: TW3, i: TW3I, rows: [[[1, 1]]]},
    5: {r: R5, i: I5, rows: [[[1, 1], [2, 1]], [[2, 1], [1, -1]]]},
    7: {r: R7, i: I7, rows: [[[1, 1], [2, 1], [3, 1]], [[2, 1], [3, -1], [1, -1]], [[3, 1], [1, -1], [2, 1]]]},
    11: {r: R11, i: I11, rows: [[[1, 1], [2, 1], [3, 1], [4, 1], [5, 1]], [[2, 1], [4, 1], [5, -1], [3, -1], [1, -1]],
      [[3, 1], [5, -1], [2, -1], [1, 1], [4, 1]], [[4, 1], [3, -1], [1, 1], [5, 1], [2, -1]], [[5, 1], [1, -1], [4, 1], [2, -1], [3, 1]]]},
  };

  // res = special_mul<fwd>(v, w)
  function smul(fwd, vr, vi, wa, w, out, o) {
    const wr = wa[2 * w], wi = wa[2 * w + 1];
    if (fwd) { out[o] = vr * wr + vi * wi; out[o + 1] = vi * wr - vr * wi; }
    else { out[o] = vr * wr - vi * wi; out[o + 1] = vr * wi + vi * wr; }
  }

  function passOdd(p, fwd, ido, l1, cc, ch, wa) {
    const {r, i: si, rows} = ODD[p], m = (p - 1) / 2, sign = fwd ? -1 : 1;
    const x = rows.map(row => row.map(([k]) => r[k - 1]));
    const y = rows.map(row => row.map(([k, s]) => s * sign * si[k - 1]));
    const tpr = new Float64Array(m + 1), tpi = new Float64Array(m + 1), tmr = new Float64Array(m + 1), tmi = new Float64Array(m + 1);
    const CC = (a, b, c) => 2 * (a + ido * (b + p * c)), CH = (a, b, c) => 2 * (a + ido * (b + l1 * c));
    for (let k = 0; k < l1; k++) for (let i = 0; i < ido; i++) {
      const c0 = CC(i, 0, k), t0r = cc[c0], t0i = cc[c0 + 1];
      let sr = t0r, sumI = t0i;
      for (let j = 1; j <= m; j++) {
        const a = CC(i, j, k), b = CC(i, p - j, k);
        tpr[j] = cc[a] + cc[b]; tpi[j] = cc[a + 1] + cc[b + 1]; tmr[j] = cc[a] - cc[b]; tmi[j] = cc[a + 1] - cc[b + 1];
        sr += tpr[j]; sumI += tpi[j];
      }
      const h0 = CH(i, k, 0);
      ch[h0] = sr; ch[h0 + 1] = sumI;
      for (let u = 1; u <= m; u++) {
        const xu = x[u - 1], yu = y[u - 1];
        let car = t0r, cai = t0i;
        for (let j = 1; j <= m; j++) { car += xu[j - 1] * tpr[j]; cai += xu[j - 1] * tpi[j]; }
        let cbi = yu[0] * tmr[1], cbr = yu[0] * tmi[1];
        for (let j = 2; j <= m; j++) { cbi += yu[j - 1] * tmr[j]; cbr += yu[j - 1] * tmi[j]; }
        cbr = -cbr;
        const h1 = CH(i, k, u), h2 = CH(i, k, p - u);
        if (i === 0) { ch[h1] = car + cbr; ch[h1 + 1] = cai + cbi; ch[h2] = car - cbr; ch[h2 + 1] = cai - cbi; }
        else {
          smul(fwd, car + cbr, cai + cbi, wa, i - 1 + (u - 1) * (ido - 1), ch, h1);
          smul(fwd, car - cbr, cai - cbi, wa, i - 1 + (p - u - 1) * (ido - 1), ch, h2);
        }
      }
    }
  }

  function pass2(fwd, ido, l1, cc, ch, wa) {
    for (let k = 0; k < l1; k++) for (let i = 0; i < ido; i++) {
      const a = 2 * (i + ido * 2 * k), b = 2 * (i + ido * (1 + 2 * k)), h0 = 2 * (i + ido * k), h1 = 2 * (i + ido * (k + l1));
      ch[h0] = cc[a] + cc[b]; ch[h0 + 1] = cc[a + 1] + cc[b + 1];
      const dr = cc[a] - cc[b], di = cc[a + 1] - cc[b + 1];
      if (i === 0) { ch[h1] = dr; ch[h1 + 1] = di; } else smul(fwd, dr, di, wa, i - 1, ch, h1);
    }
  }

  function pass4(fwd, ido, l1, cc, ch, wa) {
    const CC = (a, b, c) => 2 * (a + ido * (b + 4 * c)), CH = (a, b, c) => 2 * (a + ido * (b + l1 * c));
    for (let k = 0; k < l1; k++) for (let i = 0; i < ido; i++) {
      const c0 = CC(i, 0, k), c1 = CC(i, 1, k), c2 = CC(i, 2, k), c3 = CC(i, 3, k);
      const t2r = cc[c0] + cc[c2], t2i = cc[c0 + 1] + cc[c2 + 1], t1r = cc[c0] - cc[c2], t1i = cc[c0 + 1] - cc[c2 + 1];
      const t3r = cc[c1] + cc[c3], t3i = cc[c1 + 1] + cc[c3 + 1];
      let t4r = cc[c1] - cc[c3], t4i = cc[c1 + 1] - cc[c3 + 1];
      if (fwd) { const t = t4r; t4r = t4i; t4i = -t; } else { const t = t4r; t4r = -t4i; t4i = t; }
      const h0 = CH(i, k, 0), h1 = CH(i, k, 1), h2 = CH(i, k, 2), h3 = CH(i, k, 3);
      ch[h0] = t2r + t3r; ch[h0 + 1] = t2i + t3i;
      if (i === 0) {
        ch[h2] = t2r - t3r; ch[h2 + 1] = t2i - t3i;
        ch[h1] = t1r + t4r; ch[h1 + 1] = t1i + t4i;
        ch[h3] = t1r - t4r; ch[h3 + 1] = t1i - t4i;
      } else {
        smul(fwd, t1r + t4r, t1i + t4i, wa, i - 1, ch, h1);
        smul(fwd, t2r - t3r, t2i - t3i, wa, i - 1 + (ido - 1), ch, h2);
        smul(fwd, t1r - t4r, t1i - t4i, wa, i - 1 + 2 * (ido - 1), ch, h3);
      }
    }
  }

  const HSQT2 = .7071067811865476;
  function pass8(fwd, ido, l1, cc, ch, wa) {
    const CC = (a, b, c) => 2 * (a + ido * (b + 8 * c)), CH = (a, b, c) => 2 * (a + ido * (b + l1 * c));
    const rot90 = (r, i) => (fwd ? [i, -r] : [-i, r]);
    for (let k = 0; k < l1; k++) for (let i = 0; i < ido; i++) {
      const g = j => CC(i, j, k);
      let a1r = cc[g(1)] + cc[g(5)], a1i = cc[g(1) + 1] + cc[g(5) + 1], a5r = cc[g(1)] - cc[g(5)], a5i = cc[g(1) + 1] - cc[g(5) + 1];
      let a3r = cc[g(3)] + cc[g(7)], a3i = cc[g(3) + 1] + cc[g(7) + 1], a7r = cc[g(3)] - cc[g(7)], a7i = cc[g(3) + 1] - cc[g(7) + 1];
      let t;
      t = a1r; a1r += a3r; a3r = t - a3r; t = a1i; a1i += a3i; a3i = t - a3i;
      [a3r, a3i] = rot90(a3r, a3i);
      [a7r, a7i] = rot90(a7r, a7i);
      t = a5r; a5r += a7r; a7r = t - a7r; t = a5i; a5i += a7i; a7i = t - a7i;
      if (fwd) {
        t = a5r; a5r = HSQT2 * (a5r + a5i); a5i = HSQT2 * (a5i - t);
        t = a7r; a7r = HSQT2 * (a7i - a7r); a7i = HSQT2 * (-t - a7i);
      } else {
        t = a5r; a5r = HSQT2 * (a5r - a5i); a5i = HSQT2 * (a5i + t);
        t = a7r; a7r = HSQT2 * (-a7r - a7i); a7i = HSQT2 * (t - a7i);
      }
      let a0r = cc[g(0)] + cc[g(4)], a0i = cc[g(0) + 1] + cc[g(4) + 1], a4r = cc[g(0)] - cc[g(4)], a4i = cc[g(0) + 1] - cc[g(4) + 1];
      let a2r = cc[g(2)] + cc[g(6)], a2i = cc[g(2) + 1] + cc[g(6) + 1], a6r = cc[g(2)] - cc[g(6)], a6i = cc[g(2) + 1] - cc[g(6) + 1];
      t = a0r; a0r += a2r; a2r = t - a2r; t = a0i; a0i += a2i; a2i = t - a2i;
      [a6r, a6i] = rot90(a6r, a6i);
      t = a4r; a4r += a6r; a6r = t - a6r; t = a4i; a4i += a6i; a6i = t - a6i;
      const out = [[a0r + a1r, a0i + a1i], [a4r + a5r, a4i + a5i], [a2r + a3r, a2i + a3i], [a6r + a7r, a6i + a7i],
        [a0r - a1r, a0i - a1i], [a4r - a5r, a4i - a5i], [a2r - a3r, a2i - a3i], [a6r - a7r, a6i - a7i]];
      for (let u = 0; u < 8; u++) {
        const h = CH(i, k, u);
        if (i === 0 || u === 0) { ch[h] = out[u][0]; ch[h + 1] = out[u][1]; }
        else smul(fwd, out[u][0], out[u][1], wa, i - 1 + (u - 1) * (ido - 1), ch, h);
      }
    }
  }

  function passg(fwd, ido, ip, l1, cc, ch, wa, csarr) {
    const ipph = Math.floor((ip + 1) / 2), idl1 = ido * l1;
    const CH = (a, b, c) => 2 * (a + ido * (b + l1 * c)), CC = (a, b, c) => 2 * (a + ido * (b + ip * c));
    const CX = (a, b, c) => 2 * (a + ido * (b + l1 * c)), X2 = (a, b) => 2 * (a + idl1 * b);
    const wal = new Float64Array(2 * ip);
    wal[0] = 1;
    for (let i = 1; i < ip; i++) { wal[2 * i] = csarr[2 * i]; wal[2 * i + 1] = fwd ? -csarr[2 * i + 1] : csarr[2 * i + 1]; }
    for (let k = 0; k < l1; k++) for (let i = 0; i < ido; i++) { const h = CH(i, k, 0), c = CC(i, 0, k); ch[h] = cc[c]; ch[h + 1] = cc[c + 1]; }
    for (let j = 1, jc = ip - 1; j < ipph; j++, jc--) for (let k = 0; k < l1; k++) for (let i = 0; i < ido; i++) {
      const a = CC(i, j, k), b = CC(i, jc, k), h1 = CH(i, k, j), h2 = CH(i, k, jc);
      ch[h1] = cc[a] + cc[b]; ch[h1 + 1] = cc[a + 1] + cc[b + 1]; ch[h2] = cc[a] - cc[b]; ch[h2 + 1] = cc[a + 1] - cc[b + 1];
    }
    for (let k = 0; k < l1; k++) for (let i = 0; i < ido; i++) {
      let tr = ch[CH(i, k, 0)], ti = ch[CH(i, k, 0) + 1];
      for (let j = 1; j < ipph; j++) { tr += ch[CH(i, k, j)]; ti += ch[CH(i, k, j) + 1]; }
      cc[CX(i, k, 0)] = tr; cc[CX(i, k, 0) + 1] = ti;
    }
    for (let l = 1, lc = ip - 1; l < ipph; l++, lc--) {
      const w1r = wal[2 * l], w1i = wal[2 * l + 1], w2r = wal[4 * l], w2i = wal[4 * l + 1];
      for (let ik = 0; ik < idl1; ik++) {
        const h0 = X2(ik, 0), h1 = X2(ik, 1), h2 = X2(ik, 2), hm1 = X2(ik, ip - 1), hm2 = X2(ik, ip - 2), xl = X2(ik, l), xc = X2(ik, lc);
        cc[xl] = ch[h0] + w1r * ch[h1] + w2r * ch[h2];
        cc[xl + 1] = ch[h0 + 1] + w1r * ch[h1 + 1] + w2r * ch[h2 + 1];
        cc[xc] = -w1i * ch[hm1 + 1] - w2i * ch[hm2 + 1];
        cc[xc + 1] = w1i * ch[hm1] + w2i * ch[hm2];
      }
      let iwal = 2 * l, j = 3, jc = ip - 3;
      for (; j < ipph - 1; j += 2, jc -= 2) {
        iwal += l; if (iwal > ip) iwal -= ip;
        const xr = wal[2 * iwal], xi = wal[2 * iwal + 1];
        iwal += l; if (iwal > ip) iwal -= ip;
        const x2r = wal[2 * iwal], x2i = wal[2 * iwal + 1];
        for (let ik = 0; ik < idl1; ik++) {
          const a = X2(ik, j), b = X2(ik, j + 1), c = X2(ik, jc), d = X2(ik, jc - 1), xl = X2(ik, l), xc = X2(ik, lc);
          cc[xl] += ch[a] * xr + ch[b] * x2r;
          cc[xl + 1] += ch[a + 1] * xr + ch[b + 1] * x2r;
          cc[xc] -= ch[c + 1] * xi + ch[d + 1] * x2i;
          cc[xc + 1] += ch[c] * xi + ch[d] * x2i;
        }
      }
      for (; j < ipph; j++, jc--) {
        iwal += l; if (iwal > ip) iwal -= ip;
        const xr = wal[2 * iwal], xi = wal[2 * iwal + 1];
        for (let ik = 0; ik < idl1; ik++) {
          const a = X2(ik, j), c = X2(ik, jc), xl = X2(ik, l), xc = X2(ik, lc);
          cc[xl] += ch[a] * xr;
          cc[xl + 1] += ch[a + 1] * xr;
          cc[xc] -= ch[c + 1] * xi;
          cc[xc + 1] += ch[c] * xi;
        }
      }
    }
    for (let j = 1, jc = ip - 1; j < ipph; j++, jc--) for (let k = 0; k < l1; k++) for (let i = 0; i < ido; i++) {
      const a = CX(i, k, j), b = CX(i, k, jc);
      const t1r = cc[a], t1i = cc[a + 1], t2r = cc[b], t2i = cc[b + 1];
      if (ido === 1 || i === 0) { cc[a] = t1r + t2r; cc[a + 1] = t1i + t2i; cc[b] = t1r - t2r; cc[b + 1] = t1i - t2i; }
      else {
        smul(fwd, t1r + t2r, t1i + t2i, wa, (j - 1) * (ido - 1) + i - 1, cc, a);
        smul(fwd, t1r - t2r, t1i - t2i, wa, (jc - 1) * (ido - 1) + i - 1, cc, b);
      }
    }
  }

  class Cfftp {
    constructor(length) {
      this.length = length;
      this.fact = [];
      if (length === 1) return;
      let len = length;
      while (len % 8 === 0) { this.fact.push({fct: 8}); len /= 8; }
      while (len % 4 === 0) { this.fact.push({fct: 4}); len /= 4; }
      if (len % 2 === 0) {
        len /= 2;
        this.fact.push({fct: 2});
        const last = this.fact.length - 1, t = this.fact[0].fct;
        this.fact[0].fct = this.fact[last].fct; this.fact[last].fct = t;
      }
      for (let d = 3; d * d <= len; d += 2) while (len % d === 0) { this.fact.push({fct: d}); len /= d; }
      if (len > 1) this.fact.push({fct: len});
      const twiddle = twiddleTable(length);
      let l1 = 1;
      for (const f of this.fact) {
        const ip = f.fct, ido = length / (l1 * ip);
        f.tw = new Float64Array(2 * Math.max(0, (ip - 1) * (ido - 1)));
        for (let j = 1; j < ip; j++) for (let i = 1; i < ido; i++) {
          const [r, s] = twiddle(j * l1 * i), o = 2 * ((j - 1) * (ido - 1) + i - 1);
          f.tw[o] = r; f.tw[o + 1] = s;
        }
        if (ip > 11) {
          f.tws = new Float64Array(2 * ip);
          for (let j = 0; j < ip; j++) { const [r, s] = twiddle(j * l1 * ido); f.tws[2 * j] = r; f.tws[2 * j + 1] = s; }
        }
        l1 *= ip;
      }
    }
    exec(c, fwd) {
      const n = this.length;
      if (n === 1) return;
      let l1 = 1, p1 = c, p2 = new Float64Array(2 * n);
      for (const f of this.fact) {
        const ip = f.fct, l2 = ip * l1, ido = n / l2;
        if (ip === 4) pass4(fwd, ido, l1, p1, p2, f.tw);
        else if (ip === 8) pass8(fwd, ido, l1, p1, p2, f.tw);
        else if (ip === 2) pass2(fwd, ido, l1, p1, p2, f.tw);
        else if (ip === 3 || ip === 5 || ip === 7 || ip === 11) passOdd(ip, fwd, ido, l1, p1, p2, f.tw);
        else { passg(fwd, ido, ip, l1, p1, p2, f.tw, f.tws); const t = p1; p1 = p2; p2 = t; }
        const t = p1; p1 = p2; p2 = t;
        l1 = l2;
      }
      if (p1 !== c) c.set(p1);
    }
  }

  function largestPrimeFactor(n) {
    let res = 1;
    while (n % 2 === 0) { res = 2; n /= 2; }
    for (let x = 3; x * x <= n; x += 2) while (n % x === 0) { res = x; n /= x; }
    return n > 1 ? n : res;
  }
  function costGuess(n) {
    const ni = n;
    let result = 0;
    while (n % 2 === 0) { result += 2; n /= 2; }
    for (let x = 3; x * x <= n; x += 2) while (n % x === 0) { result += x <= 5 ? x : 1.1 * x; n /= x; }
    if (n > 1) result += n <= 5 ? n : 1.1 * n;
    return result * ni;
  }
  function goodSizeCmplx(n) {
    if (n <= 12) return n;
    let best = 2 * n;
    for (let f11 = 1; f11 < best; f11 *= 11) for (let f117 = f11; f117 < best; f117 *= 7) for (let f1175 = f117; f1175 < best; f1175 *= 5) {
      let x = f1175;
      while (x < n) x *= 2;
      for (;;) {
        if (x < n) x *= 3;
        else if (x > n) { if (x < best) best = x; if (x & 1) break; x /= 2; }
        else return n;
      }
    }
    return best;
  }

  class Blue {
    constructor(n) {
      this.n = n; this.n2 = goodSizeCmplx(2 * n - 1); this.plan = new Cfftp(this.n2);
      const n2 = this.n2, tmp = twiddleTable(2 * n), bk = this.bk = new Float64Array(2 * n);
      bk[0] = 1;
      let coeff = 0;
      for (let m = 1; m < n; m++) {
        coeff += 2 * m - 1;
        if (coeff >= 2 * n) coeff -= 2 * n;
        const [r, s] = tmp(coeff); bk[2 * m] = r; bk[2 * m + 1] = s;
      }
      const tbkf = new Float64Array(2 * n2), xn2 = 1 / n2;
      tbkf[0] = bk[0] * xn2; tbkf[1] = bk[1] * xn2;
      for (let m = 1; m < n; m++) {
        tbkf[2 * m] = tbkf[2 * (n2 - m)] = bk[2 * m] * xn2;
        tbkf[2 * m + 1] = tbkf[2 * (n2 - m) + 1] = bk[2 * m + 1] * xn2;
      }
      this.plan.exec(tbkf, true);
      this.bkf = tbkf.slice(0, 2 * (Math.floor(n2 / 2) + 1));
    }
    exec(c, fwd) {
      const {n, n2, bk, bkf} = this, akf = new Float64Array(2 * n2);
      for (let m = 0; m < n; m++) smul(fwd, c[2 * m], c[2 * m + 1], bk, m, akf, 2 * m);
      const zr = akf[0] * 0, zi = akf[1] * 0;
      for (let m = n; m < n2; m++) { akf[2 * m] = zr; akf[2 * m + 1] = zi; }
      this.plan.exec(akf, true);
      const conv = (m, w) => smul(!fwd, akf[2 * m], akf[2 * m + 1], bkf, w, akf, 2 * m);
      conv(0, 0);
      for (let m = 1; m < Math.floor((n2 + 1) / 2); m++) { conv(m, m); conv(n2 - m, m); }
      if (n2 % 2 === 0) conv(n2 / 2, n2 / 2);
      this.plan.exec(akf, false);
      for (let m = 0; m < n; m++) smul(fwd, akf[2 * m], akf[2 * m + 1], bk, m, c, 2 * m);
    }
  }

  const plans = new Map();
  function plan(n) {
    let p = plans.get(n);
    if (!p) {
      const lpf = n < 50 ? 0 : largestPrimeFactor(n);
      if (lpf * lpf <= n) p = new Cfftp(n);
      else p = 1.5 * 2 * costGuess(goodSizeCmplx(2 * n - 1)) < costGuess(n) ? new Blue(n) : new Cfftp(n);
      plans.set(n, p);
    }
    return p;
  }

  // np.fft.fft of interleaved complex values (in place copy returned).
  function fft(re, im) {
    const n = re.length, c = new Float64Array(2 * n);
    for (let i = 0; i < n; i++) { c[2 * i] = re[i]; c[2 * i + 1] = im ? im[i] : 0; }
    plan(n).exec(c, true);
    const outRe = new Float64Array(n), outIm = new Float64Array(n);
    for (let i = 0; i < n; i++) { outRe[i] = c[2 * i]; outIm[i] = c[2 * i + 1]; }
    return [outRe, outIm];
  }

  // np.abs(np.fft.fft2(a)) of a real h x w array: rows first, then columns.
  function fft2Magnitude(a, h, w) {
    const data = new Float64Array(2 * h * w), row = new Float64Array(2 * w), col = new Float64Array(2 * h);
    const rowPlan = plan(w), colPlan = plan(h);
    for (let y = 0; y < h; y++) {
      row.fill(0);
      for (let x = 0; x < w; x++) row[2 * x] = a[y * w + x];
      rowPlan.exec(row, true);
      data.set(row, 2 * y * w);
    }
    const magnitude = new Float64Array(h * w);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) { col[2 * y] = data[2 * (y * w + x)]; col[2 * y + 1] = data[2 * (y * w + x) + 1]; }
      colPlan.exec(col, true);
      for (let y = 0; y < h; y++) magnitude[y * w + x] = hypot(col[2 * y], col[2 * y + 1]);
    }
    return magnitude;
  }

  PM.fft = {fft, fft2Magnitude, hypot, sinKernel, cosKernel};
});
