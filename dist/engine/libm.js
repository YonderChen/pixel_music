/* musl libm (as compiled to wasm by Emscripten 3.1.58 for Pyodide 0.27.7), ported operation for operation so results match the former engine bit for bit. */
(self.PixelMusicEngineModules = self.PixelMusicEngineModules || []).push(function (PM) {
  'use strict';
  // Bit access: U[1] is the high word and U[0] the low word of F[0] (little-endian).
  const F = new Float64Array(1), U = new Uint32Array(F.buffer);
  const bits = (hi, lo) => { U[1] = hi; U[0] = lo; return F[0]; };
  // Tables hold the exact bit patterns of musl's data structs (hex uint64 per entry).
  function table(hex) {
    hex = hex.replace(/\s+/g, '');
    const u = new Uint32Array(hex.length / 8);
    for (let i = 0; i < u.length; i += 2) { u[i + 1] = parseInt(hex.substr(i * 8, 8), 16); u[i] = parseInt(hex.substr(i * 8 + 8, 8), 16); }
    return new Float64Array(u.buffer);
  }
  const P1022 = 2 ** -1022, P1009 = 2 ** 1009;

  // __sin / __cos kernels on [-pi/4, pi/4]
  const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04,
    S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
  function ksin(x, y, iy) {
    const z = x * x, w = z * z, r = S2 + z * (S3 + z * S4) + z * w * (S5 + z * S6), v = z * x;
    if (iy === 0) return x + v * (S1 + z * r);
    return x - ((z * (0.5 * y - v * r) - y) - v * S1);
  }
  const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05,
    C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
  function kcos(x, y) {
    const z = x * x, w = z * z, r = z * (C1 + z * (C2 + z * C3)) + w * w * (C4 + z * (C5 + z * C6));
    const hz = 0.5 * z, v = 1.0 - hz;
    return v + (((1.0 - v) - hz) + (z * r - x * y));
  }

  // __rem_pio2: x - n*pi/2 in Y0 + Y1, returns n.
  const toint = 1.5 / 2.220446049250313e-16, pio4 = 0.7853981633974483, invpio2 = 6.36619772367581382433e-01,
    pio2_1 = 1.57079632673412561417e+00, pio2_1t = 6.07710050650619224932e-11, pio2_2 = 6.07710050630396597660e-11,
    pio2_2t = 2.02226624879595063154e-21, pio2_3 = 2.02226624871116645580e-21, pio2_3t = 8.47842766036889956997e-32;
  let Y0 = 0, Y1 = 0;
  function small(x, k, neg) {
    let z;
    if (!neg) { z = x - k * pio2_1; Y0 = z - k * pio2_1t; Y1 = (z - Y0) - k * pio2_1t; return k; }
    z = x + k * pio2_1; Y0 = z + k * pio2_1t; Y1 = (z - Y0) + k * pio2_1t; return -k;
  }
  function medium(x, ix) {
    let fn = x * invpio2 + toint - toint, n = fn | 0, r = x - fn * pio2_1, w = fn * pio2_1t, t;
    if (r - w < -pio4) { n--; fn--; r = x - fn * pio2_1; w = fn * pio2_1t; }
    else if (r - w > pio4) { n++; fn++; r = x - fn * pio2_1; w = fn * pio2_1t; }
    Y0 = r - w;
    // |Y0| >= |x| / 2^16 already rules out the exponent gap below (the common case).
    if (Math.abs(Y0) >= Math.abs(x) * 1.52587890625e-5) { Y1 = (r - Y0) - w; return n; }
    F[0] = Y0;
    const ex = ix >>> 20;
    let ey = (U[1] >>> 20) & 0x7ff;
    if (ex - ey > 16) {
      t = r; w = fn * pio2_2; r = t - w; w = fn * pio2_2t - ((t - r) - w); Y0 = r - w;
      F[0] = Y0; ey = (U[1] >>> 20) & 0x7ff;
      if (ex - ey > 49) { t = r; w = fn * pio2_3; r = t - w; w = fn * pio2_3t - ((t - r) - w); Y0 = r - w; }
    }
    Y1 = (r - Y0) - w;
    return n;
  }
  const TX = new Float64Array(3), TY = new Float64Array(2);
  function remPio2(x) {
    F[0] = x;
    const sign = U[1] >>> 31, ix = U[1] & 0x7fffffff;
    if (ix <= 0x400f6a7a) {
      if ((ix & 0xfffff) === 0x921fb) return medium(x, ix);
      return small(x, ix <= 0x4002d97c ? 1 : 2, sign);
    }
    if (ix <= 0x401c463b) {
      if (ix <= 0x4015fdbc) return ix === 0x4012d97c ? medium(x, ix) : small(x, 3, sign);
      return ix === 0x401921fb ? medium(x, ix) : small(x, 4, sign);
    }
    if (ix < 0x413921fb) return medium(x, ix);
    if (ix >= 0x7ff00000) { Y0 = Y1 = x - x; return 0; }
    let z = bits((U[1] & 0xfffff) | 0x41600000, U[0]), i;
    for (i = 0; i < 2; i++) { TX[i] = z | 0; z = (z - TX[i]) * 16777216; }
    TX[i] = z;
    while (TX[i] === 0) i--;
    const n = remPio2Large(TX, TY, (ix >>> 20) - (0x3ff + 23), i + 1);
    if (sign) { Y0 = -TY[0]; Y1 = -TY[1]; return -n; }
    Y0 = TY[0]; Y1 = TY[1];
    return n;
  }
  function scalbn(x, n) {
    let y = x;
    if (n > 1023) {
      y *= 2 ** 1023; n -= 1023;
      if (n > 1023) { y *= 2 ** 1023; n -= 1023; if (n > 1023) n = 1023; }
    } else if (n < -1022) {
      y *= 2 ** -1022 * 2 ** 53; n += 1022 - 53;
      if (n < -1022) { y *= 2 ** -1022 * 2 ** 53; n += 1022 - 53; if (n < -1022) n = -1022; }
    }
    return y * bits((0x3ff + n) << 20, 0);
  }
  // __rem_pio2_large with prec = 1 (double); the first 66 ipio2 words cover every double exponent.
  const ipio2 = [
    0xA2F983, 0x6E4E44, 0x1529FC, 0x2757D1, 0xF534DD, 0xC0DB62, 0x95993C, 0x439041, 0xFE5163, 0xABDEBB, 0xC561B7,
    0x246E3A, 0x424DD2, 0xE00649, 0x2EEA09, 0xD1921C, 0xFE1DEB, 0x1CB129, 0xA73EE8, 0x8235F5, 0x2EBB44, 0x84E99C,
    0x7026B4, 0x5F7E41, 0x3991D6, 0x398353, 0x39F49C, 0x845F8B, 0xBDF928, 0x3B1FF8, 0x97FFDE, 0x05980F, 0xEF2F11,
    0x8B5A0A, 0x6D1F6D, 0x367ECF, 0x27CB09, 0xB74F46, 0x3F669E, 0x5FEA2D, 0x7527BA, 0xC7EBE5, 0xF17B3D, 0x0739F7,
    0x8A5292, 0xEA6BFB, 0x5FB11F, 0x8D5D08, 0x560330, 0x46FC7B, 0x6BABF0, 0xCFBC20, 0x9AF436, 0x1DA9E3, 0x91615E,
    0xE61B08, 0x659985, 0x5F14A0, 0x68408D, 0xFFD880, 0x4D7327, 0x310606, 0x1556CA, 0x73A8C9, 0x60E27B, 0xC08C6B];
  const PIo2 = [1.57079625129699707031e+00, 7.54978941586159635335e-08, 5.39030252995776476554e-15, 3.28200341580791294123e-22,
    1.27065575308067607349e-29, 1.22933308981111328932e-36, 2.73370053816464559624e-44, 2.16741683877804819444e-51];
  function remPio2Large(x, y, e0, nx) {
    const jk = 4, jp = jk, jx = nx - 1, iq = new Int32Array(20), f = new Float64Array(20), fq = new Float64Array(20), q = new Float64Array(20);
    let jv = ((e0 - 3) / 24) | 0;
    if (jv < 0) jv = 0;
    let q0 = e0 - 24 * (jv + 1), i, j, k, z, fw, n, ih, carry, jz;
    j = jv - jx;
    const m = jx + jk;
    for (i = 0; i <= m; i++, j++) f[i] = j < 0 ? 0.0 : ipio2[j];
    for (i = 0; i <= jk; i++) {
      for (j = 0, fw = 0.0; j <= jx; j++) fw += x[j] * f[jx + i - j];
      q[i] = fw;
    }
    jz = jk;
    for (;;) {
      for (i = 0, j = jz, z = q[jz]; j > 0; i++, j--) {
        fw = (5.9604644775390625e-8 * z) | 0;
        iq[i] = (z - 16777216 * fw) | 0;
        z = q[j - 1] + fw;
      }
      z = scalbn(z, q0);
      z -= 8.0 * Math.floor(z * 0.125);
      n = z | 0;
      z -= n;
      ih = 0;
      if (q0 > 0) {
        i = iq[jz - 1] >> (24 - q0); n += i;
        iq[jz - 1] -= i << (24 - q0);
        ih = iq[jz - 1] >> (23 - q0);
      } else if (q0 === 0) ih = iq[jz - 1] >> 23;
      else if (z >= 0.5) ih = 2;
      if (ih > 0) {
        n += 1; carry = 0;
        for (i = 0; i < jz; i++) {
          j = iq[i];
          if (carry === 0) { if (j !== 0) { carry = 1; iq[i] = 0x1000000 - j; } }
          else iq[i] = 0xffffff - j;
        }
        if (q0 === 1) iq[jz - 1] &= 0x7fffff;
        else if (q0 === 2) iq[jz - 1] &= 0x3fffff;
        if (ih === 2) {
          z = 1.0 - z;
          if (carry !== 0) z -= scalbn(1.0, q0);
        }
      }
      if (z === 0.0) {
        j = 0;
        for (i = jz - 1; i >= jk; i--) j |= iq[i];
        if (j === 0) {
          for (k = 1; iq[jk - k] === 0; k++);
          for (i = jz + 1; i <= jz + k; i++) {
            f[jx + i] = ipio2[jv + i];
            for (j = 0, fw = 0.0; j <= jx; j++) fw += x[j] * f[jx + i - j];
            q[i] = fw;
          }
          jz += k;
          continue;
        }
      }
      break;
    }
    if (z === 0.0) {
      jz -= 1; q0 -= 24;
      while (iq[jz] === 0) { jz--; q0 -= 24; }
    } else {
      z = scalbn(z, -q0);
      if (z >= 16777216) {
        fw = (5.9604644775390625e-8 * z) | 0;
        iq[jz] = (z - 16777216 * fw) | 0;
        jz += 1; q0 += 24;
        iq[jz] = fw;
      } else iq[jz] = z | 0;
    }
    fw = scalbn(1.0, q0);
    for (i = jz; i >= 0; i--) { q[i] = fw * iq[i]; fw *= 5.9604644775390625e-8; }
    for (i = jz; i >= 0; i--) {
      for (fw = 0.0, k = 0; k <= jp && k <= jz - i; k++) fw += PIo2[k] * q[i + k];
      fq[jz - i] = fw;
    }
    fw = 0.0;
    for (i = jz; i >= 0; i--) fw += fq[i];
    y[0] = ih === 0 ? fw : -fw;
    fw = fq[0] - fw;
    for (i = 1; i <= jz; i++) fw += fq[i];
    y[1] = ih === 0 ? fw : -fw;
    return n & 7;
  }

  function sin(x) {
    F[0] = x;
    const ix = U[1] & 0x7fffffff;
    if (ix <= 0x3fe921fb) {
      if (ix < 0x3e500000) return x;
      return ksin(x, 0.0, 0);
    }
    if (ix >= 0x7ff00000) return x - x;
    switch (remPio2(x) & 3) {
      case 0: return ksin(Y0, Y1, 1);
      case 1: return kcos(Y0, Y1);
      case 2: return -ksin(Y0, Y1, 1);
      default: return -kcos(Y0, Y1);
    }
  }
  function cos(x) {
    F[0] = x;
    const ix = U[1] & 0x7fffffff;
    if (ix <= 0x3fe921fb) {
      if (ix < 0x3e46a09e) return 1.0;
      return kcos(x, 0);
    }
    if (ix >= 0x7ff00000) return x - x;
    switch (remPio2(x) & 3) {
      case 0: return kcos(Y0, Y1);
      case 1: return -ksin(Y0, Y1, 1);
      case 2: return -kcos(Y0, Y1);
      default: return ksin(Y0, Y1, 1);
    }
  }

  const atanhi = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
  const atanlo = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
  const aT0 = 3.33333333333329318027e-01, aT1 = -1.99999999998764832476e-01, aT2 = 1.42857142725034663711e-01,
    aT3 = -1.11111104054623557880e-01, aT4 = 9.09088713343650656196e-02, aT5 = -7.69187620504482999495e-02,
    aT6 = 6.66107313738753120669e-02, aT7 = -5.83357013379057348645e-02, aT8 = 4.97687799461593236017e-02,
    aT9 = -3.65315727442169155270e-02, aT10 = 1.62858201153657823623e-02;
  function atan(x) {
    F[0] = x;
    const sign = U[1] >>> 31, ix = U[1] & 0x7fffffff;
    let id, z;
    if (ix >= 0x44100000) {
      if (x !== x) return x;
      z = atanhi[3] + 2 ** -120;
      return sign ? -z : z;
    }
    if (ix < 0x3fdc0000) {
      if (ix < 0x3e400000) return x;
      id = -1;
    } else {
      x = Math.abs(x);
      if (ix < 0x3ff30000) {
        if (ix < 0x3fe60000) { id = 0; x = (2.0 * x - 1.0) / (2.0 + x); }
        else { id = 1; x = (x - 1.0) / (x + 1.0); }
      } else if (ix < 0x40038000) { id = 2; x = (x - 1.5) / (1.0 + 1.5 * x); }
      else { id = 3; x = -1.0 / x; }
    }
    z = x * x;
    const w = z * z;
    const s1 = z * (aT0 + w * (aT2 + w * (aT4 + w * (aT6 + w * (aT8 + w * aT10)))));
    const s2 = w * (aT1 + w * (aT3 + w * (aT5 + w * (aT7 + w * aT9))));
    if (id < 0) return x - x * (s1 + s2);
    z = atanhi[id] - (x * (s1 + s2) - atanlo[id] - x);
    return sign ? -z : z;
  }
  const pi = 3.1415926535897931160E+00, pi_lo = 1.2246467991473531772E-16;
  function atan2(y, x) {
    if (x !== x || y !== y) return x + y;
    F[0] = x;
    let ix = U[1];
    const lx = U[0];
    F[0] = y;
    let iy = U[1];
    const ly = U[0];
    if (ix === 0x3ff00000 && lx === 0) return atan(y);
    const m = ((iy >>> 31) & 1) | ((ix >>> 30) & 2);
    ix &= 0x7fffffff; iy &= 0x7fffffff;
    if ((iy | ly) === 0) {
      switch (m) {
        case 0: case 1: return y;
        case 2: return pi;
        default: return -pi;
      }
    }
    if ((ix | lx) === 0) return m & 1 ? -pi / 2 : pi / 2;
    if (ix === 0x7ff00000) {
      if (iy === 0x7ff00000) {
        switch (m) {
          case 0: return pi / 4;
          case 1: return -pi / 4;
          case 2: return 3 * pi / 4;
          default: return -3 * pi / 4;
        }
      }
      switch (m) {
        case 0: return 0.0;
        case 1: return -0.0;
        case 2: return pi;
        default: return -pi;
      }
    }
    if (ix + (64 << 20) < iy || iy === 0x7ff00000) return m & 1 ? -pi / 2 : pi / 2;
    let z;
    if ((m & 2) && iy + (64 << 20) < ix) z = 0;
    else z = atan(Math.abs(y / x));
    switch (m) {
      case 0: return z;
      case 1: return -z;
      case 2: return pi - (z - pi_lo);
      default: return (z - pi_lo) - pi;
    }
  }

  const B1 = 715094163, B2 = 696219795, P0 = 1.87595182427177009643, P1 = -1.88497979543377169875,
    P2 = 1.621429720105354466140, P3 = -0.758397934778766047437, P4 = 0.145996192886612446982;
  function cbrt(x) {
    F[0] = x;
    let hx = U[1] & 0x7fffffff;
    if (hx >= 0x7ff00000) return x + x;
    if (hx < 0x00100000) {
      F[0] = x * 2 ** 54;
      hx = U[1] & 0x7fffffff;
      if (hx === 0) return x;
      hx = ((hx / 3) >>> 0) + B2;
    } else hx = ((hx / 3) >>> 0) + B1;
    let t = bits((U[1] & 0x80000000) | hx, 0);
    let r = (t * t) * (t / x);
    t = t * ((P0 + r * (P1 + r * P2)) + ((r * r) * r) * (P3 + r * P4));
    F[0] = t;
    const lo = U[0] + 0x80000000;
    if (lo >= 0x100000000) U[1] += 1;
    U[0] = lo & 0xc0000000;
    t = F[0];
    const s = t * t;
    r = x / s;
    const w = t + t;
    r = (r - t) / (w + r);
    return t + t * r;
  }

  const ln2_hi = 6.93147180369123816490e-01, ln2_lo = 1.90821492927058770002e-10, invln2 = 1.44269504088896338700e+00,
    o_threshold = 7.09782712893383973096e+02, Q1 = -3.33333333333331316428e-02, Q2 = 1.58730158725481460165e-03,
    Q3 = -7.93650757867487942473e-05, Q4 = 4.00821782732936239552e-06, Q5 = -2.01099218183624371326e-07;
  function expm1(x) {
    F[0] = x;
    const hx = U[1] & 0x7fffffff, sign = U[1] >>> 31;
    let hi, lo, k, c, t;
    if (hx >= 0x4043687A) {
      if (x !== x) return x;
      if (sign) return -1;
      if (x > o_threshold) return x * 2 ** 1023;
    }
    if (hx > 0x3fd62e42) {
      if (hx < 0x3FF0A2B2) {
        if (!sign) { hi = x - ln2_hi; lo = ln2_lo; k = 1; }
        else { hi = x + ln2_hi; lo = -ln2_lo; k = -1; }
      } else {
        k = (invln2 * x + (sign ? -0.5 : 0.5)) | 0;
        t = k;
        hi = x - t * ln2_hi;
        lo = t * ln2_lo;
      }
      x = hi - lo;
      c = (hi - x) - lo;
    } else if (hx < 0x3c900000) return x;
    else k = 0;
    const hfx = 0.5 * x, hxs = x * hfx;
    const r1 = 1.0 + hxs * (Q1 + hxs * (Q2 + hxs * (Q3 + hxs * (Q4 + hxs * Q5))));
    t = 3.0 - r1 * hfx;
    let e = hxs * ((r1 - t) / (6.0 - x * t));
    if (k === 0) return x - (x * e - hxs);
    e = x * (e - c) - c;
    e -= hxs;
    if (k === -1) return 0.5 * (x - e) - 0.5;
    if (k === 1) {
      if (x < -0.25) return -2.0 * (e - (x + 0.5));
      return 1.0 + 2.0 * (x - e);
    }
    const twopk = bits((0x3ff + k) << 20, 0);
    let y;
    if (k < 0 || k > 56) {
      y = x - e + 1.0;
      if (k === 1024) y = y * 2.0 * 2 ** 1023;
      else y = y * twopk;
      return y - 1.0;
    }
    const u = bits((0x3ff - k) << 20, 0);
    if (k < 20) y = (x - e + (1 - u)) * twopk;
    else y = (x - (e + u) + 1) * twopk;
    return y;
  }
  function tanh(x) {
    F[0] = x;
    const sign = U[1] >>> 31, w = U[1] & 0x7fffffff;
    let t;
    x = Math.abs(x);
    if (w > 0x3fe193ea) {
      if (w > 0x40340000) t = 1 - 0 / x;
      else { t = expm1(2 * x); t = 1 - 2 / (t + 2); }
    } else if (w > 0x3fd058ae) { t = expm1(2 * x); t = t / (t + 2); }
    else if (w >= 0x00100000) { t = expm1(-2 * x); t = -t / (t + 2); }
    else t = x;
    return sign ? -t : t;
  }

  const Lg1 = 6.666666666666735130e-01, Lg2 = 3.999999999940941908e-01, Lg3 = 2.857142874366239149e-01,
    Lg4 = 2.222219843214978396e-01, Lg5 = 1.818357216161805012e-01, Lg6 = 1.531383769920937332e-01, Lg7 = 1.479819860511658591e-01;
  function log1p(x) {
    F[0] = x;
    const hx = U[1];
    let k = 1, c, f;
    if (hx < 0x3fda827a || hx >>> 31) {
      if (hx >= 0xbff00000) {
        if (x === -1) return x / 0.0;
        return (x - x) / 0.0;
      }
      if (((hx << 1) >>> 0) < 0x79400000) return x;
      if (hx <= 0xbfd2bec4) { k = 0; c = 0; f = x; }
    } else if (hx >= 0x7ff00000) return x;
    if (k) {
      const uf = 1 + x;
      F[0] = uf;
      let hu = (U[1] + (0x3ff00000 - 0x3fe6a09e)) >>> 0;
      k = (hu >>> 20) - 0x3ff;
      if (k < 54) {
        c = k >= 2 ? 1 - (uf - x) : x - (uf - 1);
        c /= uf;
      } else c = 0;
      hu = (hu & 0x000fffff) + 0x3fe6a09e;
      U[1] = hu;
      f = F[0] - 1;
    }
    const hfsq = 0.5 * f * f, s = f / (2.0 + f), z = s * s, w = z * z;
    const t1 = w * (Lg2 + w * (Lg4 + w * Lg6)), t2 = z * (Lg1 + w * (Lg3 + w * (Lg5 + w * Lg7))), R = t2 + t1, dk = k;
    return s * (hfsq + R) + (dk * ln2_lo + c) - hfsq + f + dk * ln2_hi;
  }

  const SPLIT = 134217729;
  let SQ_HI = 0, SQ_LO = 0;
  function sq(x) {
    const xc = x * SPLIT, xh = x - xc + xc, xl = x - xh;
    SQ_HI = x * x;
    SQ_LO = xh * xh - SQ_HI + 2 * xh * xl + xl * xl;
  }
  function hypot(x, y) {
    F[0] = x;
    let xh = U[1] & 0x7fffffff, xl = U[0];
    F[0] = y;
    let yh = U[1] & 0x7fffffff, yl = U[0];
    if (xh < yh || (xh === yh && xl < yl)) { let t = xh; xh = yh; yh = t; t = xl; xl = yl; yl = t; }
    const ex = xh >>> 20, ey = yh >>> 20;
    x = bits(xh, xl); y = bits(yh, yl);
    if (ey === 0x7ff) return y;
    if (ex === 0x7ff || (yh | yl) === 0) return x;
    if (ex - ey > 64) return x + y;
    let z = 1;
    if (ex > 0x3ff + 510) { z = 2 ** 700; x *= 2 ** -700; y *= 2 ** -700; }
    else if (ey < 0x3ff - 450) { z = 2 ** -700; x *= 2 ** 700; y *= 2 ** 700; }
    sq(x);
    const hx = SQ_HI, lx = SQ_LO;
    sq(y);
    return z * Math.sqrt(SQ_LO + lx + SQ_HI + hx);
  }

  // exp / exp2 (ARM optimized-routines), shared table __exp_data
  const EXP = table(`
    40671547652b82fe4338000000000000bf762e42fefa0000bd0cf79abc9e3b3a3fdffffffffffdbd3fc555555555543c3fa55555cf172b913f81111167a4d017
    42c80000000000003fe62e42fefa39ef3fcebfbdff82c4243fac6b08d70cf4b53f83b2abd24650cc3f55d7e09b4e3a8400000000000000003ff0000000000000
    3c9b3b4f1a88bf6e3feff63da9fb3335bc7160139cd8dc5d3fefec9a3e778061bc905e7a108766d13fefe315e86e7f853c8cd2523567f6133fefd9b0d3158574
    bc8bce8023f98efa3fefd06b29ddf6de3c60f74e61e6c8613fefc74518759bc83c90a3e45b33d3993fefbe3ecac6f3833c979aa65d837b6d3fefb5586cf9890f
    3c8eb51a92fdeffc3fefac922b7247f73c3ebe3d702f9cd13fefa3ec32d3d1a2bc6a033489906e0b3fef9b66affed31bbc9556522a2fbd0e3fef9301d0125b51
    bc5080ef8c4eea553fef8abdc06c31ccbc91c923b9d5f4163fef829aaea92de03c80d3e3e95c55af3fef7a98c8a58e51bc801b15eaa593483fef72b83c7d517b
    bc8f1ff055de323d3fef6af9388c8dea3c8b898c3f1353bf3fef635beb6fcb75bc96d99c7611eb263fef5be084045cd43c9aecf73e3a2f603fef54873168b9aa
    bc8fe782cb86389d3fef4d5022fcd91d3c8a6f4144a6c38d3fef463b88628cd63c807a05b0e4047d3fef3f49917ddc963c968efde3a8a8943fef387a6e756238
    3c875e18f274487d3fef31ce4fb2a63f3c80472b981fe7f23fef2b4565e27cddbc96b87b3f71085e3fef24dfe1f563813c82f7e16d09ab313fef1e9df51fdee1
    bc3d219b1a6fbffa3fef187fd0dad9903c8b3782720c0ab43fef1285a6e4030b3c6e149289cecb8f3fef0cafa93e2f563c834d754db0abb63fef06fe0a31b715
    3c864201e2ac744c3fef0170fc4cd8313c8fdd395dd3f84a3feefc08b26416ffbc86a3803b8e5b043feef6c55f929ff1bc924aedcc4b50683feef1a7373aa9cb
    bc9907f81b512d8e3feeecae6d05d866bc71d1e83e9436d23feee7db34e59ff7bc991919b3ce1b153feee32dc313a8e53c859f48a72a4c6d3feedea64c123422
    bc9312607a28698a3feeda4504ac801cbc58a78f4817895b3feed60a21f72e2abc7c2c9b67499a1b3feed1f5d950a8973c4363ed60c2ac113feece086061892d
    3c9666093b0664ef3feeca41ed1d00573c6ecce1daa103793feec6a2b5c13cd03c93ff8e3f0f12303feec32af0d7d3de3c7690cebb7aafb03feebfdad5362a27
    3c931dbdeb54e0773feebcb299fddd0dbc8f94340071a38e3feeb9b2769d2ca7bc87deccdc93a3493feeb6daa2cf6642bc78dec6bd0f385f3feeb42b569d4f82
    bc861246ec7b5cf63feeb1a4ca5d920f3c93350518fdd78e3feeaf4736b527da3c7b98b72f8a9b053feead12d497c7fd3c9063e1e21c54093feeab07dd485429
    3c34c7855019c6ea3feea9268a5946b73c9432e62b64c0353feea76f15ad2148bc8ce44a6199769f3feea5e1b976dc09bc8c33c53bef4da83feea47eb03a5585
    bc845378892be9ae3feea34634ccc320bc93cedd785658583feea238825522253c5710aa807e19643feea155d44ca973bc93b3efbf5e22283feea09e667f3bcd
    bc6a12ad8734b9823feea012750bdabfbc6367efb86da9ee3fee9fb23c651a2fbc80dc3d54e088513fee9f7df9519484bc781f647e5a3ecf3fee9f75e8ec5f74
    bc86ee4ac08b7db03fee9f9a48a58174bc8619321e55e68a3fee9feb564267c93c909ccb5e09d4d33feea0694fde5d3fbc7b32dcb94da51d3feea11473eb0187
    3c94ecfd5467c06b3feea1ed0130c1323c65ebe1abd66c553feea2f336cf4e62bc88a1c52fb3cf423feea427543e1a12bc9369b6f13b37343feea589994cce13
    bc805e843a19ff1e3feea71a4623c7adbc94d450d872576e3feea8d99b4492ed3c90ad675b0e8a003feeaac7d98a66993c8db72fc1f0eab43feeace5422aa0db
    bc65b6609cc5e7ff3feeaf3216b5448c3c7bf68359f35f443feeb1ae99157736bc93091fa71e3d833feeb45b0b91ffc6bc5da9b88b6c1e293feeb737b0cdc5e5
    bc6c23f97c90b9593feeba44cbc8520fbc92434322f4f9aa3feebd829fde4e50bc85ca6cd7668e4b3feec0f170ca07ba3c71affc2b91ce273feec49182a3f090
    3c6dd235e10a73bb3feec86319e32323bc87c504226222633feecc667b5de5653c8b1c86e3e231d53feed09bec4a2d33bc91bbd1d3bcbb153feed503b23e255d
    3c90cc319cee31d23feed99e1330b3583c8469846e735ab33feede6b5579fdbfbc82dfcd978e9db43feee36bbfd3f37a3c8c1a7792cb33873feee89f995ad3ad
    bc907b8f4ad1d9fa3feeee07298db666bc55c3d956dcaeba3feef3a2b84f15fbbc90a40e3da6f6403feef9728de5593abc68d6f438ad93343feeff76f2fb5e47
    bc91eee26b588a353fef05b030a1064a3c74ffd70a5fddcd3fef0c1e904bc1d2bc91bdfbfa9298ac3fef12c25bd71e093c736eae30af0cb33fef199bdd85529c
    3c8ee3325c9ffd943fef20ab5fffd07a3c84e08fd10959ac3fef27f12e57d14b3c63cdaf384e1a673fef2f6d9406e7b53c676b2c6c9219683fef3720dcef9069
    bc808a1883ccb5d23fef3f0b555dc3fabc8fad5d3ffffa6f3fef472d4a07897cbc900dae3875a9493fef4f87080d89f23c74a385a63d07a73fef5818dcfba487
    bc82919e2040220f3fef60e316c983983c8e5a50d5c192ac3fef69e603db32853c843a59ac016b4b3fef7321f301b460bc82d52107b43e1f3fef7c97337b9b5f
    bc892ab93b470dc93fef864614f5a1293c74b604603a88d33fef902ee78b3ff63c83c5ec519d72713fef9a51fbc74c83bc8ff7128fd391f03fefa4afa2a490da
    bc8dae98e223747d3fefaf482d8e67f13c8ec3bc41aa20083fefba1bee615a273c842b94c3a9eb323fefc52b376bba973c8a64a931d185ee3fefd0765b6e4540
    bc8e37bae43be3ed3fefdbfdad9cbe143c77893b4d91cd9d3fefe7c1819e90d83c5305c14160cc893feff3c22b8f71f1
  `), EXPU = new Uint32Array(EXP.buffer);
  const InvLn2N = EXP[0], Shift = EXP[1], NegLn2hiN = EXP[2], NegLn2loN = EXP[3], EC2 = EXP[4], EC3 = EXP[5], EC4 = EXP[6], EC5 = EXP[7],
    Shift2 = EXP[8], E2C1 = EXP[9], E2C2 = EXP[10], E2C3 = EXP[11], E2C4 = EXP[12], E2C5 = EXP[13], ET = 14;
  function specialcase(tmp, hi, lo, ki, kpos) {
    let scale, y;
    if ((ki & 0x80000000) === 0) {
      if (kpos) { scale = bits(hi - (1 << 20), lo); return 2 * (scale + scale * tmp); }
      scale = bits(hi - (1009 << 20), lo);
      return P1009 * (scale + scale * tmp);
    }
    scale = bits(hi + (1022 << 20), lo);
    y = scale + scale * tmp;
    if (y < 1.0) {
      let l = scale - y + scale * tmp;
      const h = 1.0 + y;
      l = 1.0 - h + y + l;
      y = (h + l) - 1.0;
      if (y === 0.0) y = 0.0;
    }
    return P1022 * y;
  }
  function exp(x) {
    F[0] = x;
    let abstop = (U[1] >>> 20) & 0x7ff;
    if (((abstop - 0x3c9) >>> 0) >= 0x408 - 0x3c9) {
      if (abstop < 0x3c9) return 1.0 + x;
      if (abstop >= 0x409) {
        if (x === -Infinity) return 0.0;
        if (abstop >= 0x7ff) return 1.0 + x;
        return U[1] >>> 31 ? 0 : Infinity;
      }
      abstop = 0;
    }
    let kd = InvLn2N * x + Shift;
    F[0] = kd;
    const ki = U[0];
    kd -= Shift;
    const r = x + kd * NegLn2hiN + kd * NegLn2loN, idx = ET + 2 * (ki & 127);
    const tail = EXP[idx], hi = EXPU[2 * idx + 3] + (ki << 13), lo = EXPU[2 * idx + 2];
    const r2 = r * r, tmp = tail + r + r2 * (EC2 + r * EC3) + r2 * r2 * (EC4 + r * EC5);
    if (abstop === 0) return specialcase(tmp, hi, lo, ki, false);
    const scale = bits(hi, lo);
    return scale + scale * tmp;
  }
  function exp2(x) {
    F[0] = x;
    let abstop = (U[1] >>> 20) & 0x7ff;
    if (((abstop - 0x3c9) >>> 0) >= 0x408 - 0x3c9) {
      if (abstop < 0x3c9) return 1.0 + x;
      if (abstop >= 0x409) {
        if (x === -Infinity) return 0.0;
        if (abstop >= 0x7ff) return 1.0 + x;
        if (!(U[1] >>> 31)) return Infinity;
        if (x <= -1075.0) return 0;
      }
      if (Math.abs(x) > 928.0) abstop = 0;
    }
    let kd = x + Shift2;
    F[0] = kd;
    const ki = U[0];
    kd -= Shift2;
    const r = x - kd, idx = ET + 2 * (ki & 127);
    const tail = EXP[idx], hi = EXPU[2 * idx + 3] + (ki << 13), lo = EXPU[2 * idx + 2];
    const r2 = r * r, tmp = tail + r * E2C1 + r2 * (E2C2 + r * E2C3) + r2 * r2 * (E2C4 + r * E2C5);
    if (abstop === 0) return specialcase(tmp, hi, lo, ki, true);
    const scale = bits(hi, lo);
    return scale + scale * tmp;
  }

  // log (optimized-routines), table __log_data
  const LOG = table(`
    3fe62e42fefa38003d2ef35793c76730bfe00000000000013fd555555551305bbfcfffffffeb45903fc999b324f10111bfc55575e506c89fbfe0000000000000
    3fd5555555555577bfcffffffffffdcb3fc999999995dd0cbfc55555556745a73fc24924a344de30bfbfffffa4423d653fbc7184282ad6cabfb999eb43b068ff
    3fb78182f7afd085bfb5521375d145cd3ff734f0c3e0de9fbfd7cc7f79e690003ff713786a2ce91fbfd76feec20d00003ff6f26008fab5a0bfd713e31351e000
    3ff6d1a61f138c7dbfd6b85b382878003ff6b1490bc5b4d1bfd65d55908078003ff69147332f0cbabfd602d0761800003ff6719f18224223bfd5a8ca86909000
    3ff6524f99a51ed9bfd54f43560350003ff63356aa8f24c4bfd4f637c36b40003ff614b36b9ddc14bfd49da7fda850003ff5f66452c65c4cbfd445923989a800
    3ff5d867b5912c4fbfd3edf439b0b8003ff5babccb5b90debfd396ce448f70003ff59d61f2d91a78bfd3401e17bda0003ff5805612465687bfd2e9e2ef468000
    3ff56397cee76bd3bfd2941b3830e0003ff54725e2a77f93bfd23ec58cda88003ff52aff42064583bfd1e9e1292790003ff50f22dbb2bddfbfd1956d2b48f800
    3ff4f38f4734ded7bfd141679ab9f8003ff4d843cfde2840bfd0edd094ef98003ff4bd3ec078a3c8bfd09aa518db10003ff4a27fc3e0258abfd047e65263b800
    3ff4880524d48434bfcfeb224586f0003ff46dce1b192d0bbfcf474a7517b0003ff453d9d3391854bfcea4443d1030003ff43a2744b4845abfce020d44e9b000
    3ff420b54115f8fbbfcd60a22977f0003ff40782da3ef4b1bfccc001049590003ff3ee8f5d57fe8fbfcc2029568910003ff3d5d9a00b4ce9bfcb81178d811000
    3ff3bd60c010c12bbfcae2c9ccd3d0003ff3a5242b75dab8bfca45402e1290003ff38d22cd9fd002bfc9a877681df0003ff3755bc5847a1cbfc90c6d69483000
    3ff35dce49ad36e2bfc87120a645c0003ff34679984dd440bfc7d68fb41430003ff32f5cceffcb24bfc73cb83c6270003ff3187775a10d49bfc6a39a9b376000
    3ff301c8373e3990bfc60b3154b7a0003ff2eb4ebb95f841bfc5737d762430003ff2d50a0219a9d1bfc4dc7b8fc230003ff2bef9a8b7fd2abfc4462c51d20000
    3ff2a91c7a0c1babbfc3b08abc8300003ff293726014b530bfc31b996b4900003ff27dfa5757a1f5bfc2875490a440003ff268b39b1d3bbfbfc1f3b9f879a000
    3ff2539d838ff5bdbfc160c8252ca0003ff23eb7aac9083bbfc0ce7f57f720003ff22a012ba940b6bfc03cdc49fea0003ff2157996cc4132bfbf57bdbc4b8000
    3ff201201dd2fc9bbfbe3708964040003ff1ecf4494d480bbfbd17983ef940003ff1d8f5528f6569bfbbf9674ed8a0003ff1c52311577e7cbfbadc79202f6000
    3ff1b17c74cb26e9bfb9c0c3e72880003ff19e010c2c1ab6bfb8a646b372c0003ff18ab07bb670bdbfb78d01b3ac00003ff1778a25efbcb6bfb674f145380000
    3ff1648d354c31dabfb55e0e6d8780003ff151b990275fddbfb4485cdea1e0003ff13f0ea432d24cbfb333d94d6aa0003ff12c8b7210f9dabfb22079f8c56000
    3ff11a3028ecb531bfb10e46986220003ff107fbda8434afbfaffa6c6ad200003ff0f5ee0f4e6bb3bfadda8d4a7740003ff0e4065d2a9fcebfabbcece4850000
    3ff0d244632ca521bfa9a1894012c0003ff0c0a77ce2981abfa788583302c0003ff0af2f83c636d1bfa5715e67d680003ff09ddb98a01339bfa35c8a49658000
    3ff08cabaf52e7dfbfa149e3641540003ff07b9f2f4e28fbbf9e72c082eb80003ff06ab58c358f19bf9a55f1525280003ff059eea5ecf92cbf963d62cf818000
    3ff04949cdd12c90bf9228fb8caa00003ff038c6c6f0ada9bf8c317b20f900003ff02865137932a9bf8419355daa00003ff0182427ea7348bf781203c2ec0000
    3ff008040614b195bf600409792400003fefe01ff726fa1a3f6feff3849000003fefa11cc261ea743f87dc41353d00003fef6310b081992e3f93cea3c4c28000
    3fef25f63ceeadcd3f9b9fc1148900003feee9c8039113e73fa1b0d8ce1100003feeae8078cbb1ab3fa58a5bd001c0003fee741aa29d0c9b3fa95c8340d88000
    3fee3a91830a99b53fad276aef5780003fee01e009609a563fb07598e598c0003fedca01e577bb983fb253f5e30d20003fed92f20b7c91033fb42edd8b380000
    3fed5cac66fb5cce3fb606598757c0003fed272caa5ede9d3fb7da76356a00003fecf26e3e6b2ccd3fb9ab434e1c60003fecbe6da2a779023fbb78c7bb0d6000
    3fec8b266d37086d3fbd431332e720003fec5894bd5d58043fbf0a3171de60003fec26b533bb9f8c3fc067152b9140003febf583eeece73f3fc147858292b000
    3febc4fd75db96c13fc2266ecdca30003feb951e0c864a283fc303d7a6c550003feb65e2c5ef3e2c3fc3dfc33c3310003feb374867c9888b3fc4ba366b7a8000
    3feb094b211d304a3fc5933928d1f0003feadbe885f2ef7e3fc66acd2418f0003feaaf1d31603da23fc740f8ec6690003fea82e63fd358a73fc815c0f51af000
    3fea5740ef09738b3fc8e92954f680003fea2c2a90ab4b273fc9bb3602f840003fea01a01393f2d13fca8bed1c2c00003fe9d79f24db3c1b3fcb5b515c01d000
    3fe9ae2505c7b1903fcc2967ccbcc0003fe9852ef297ce2f3fccf635d54860003fe95cbaeea44b753fcdc1bd3446c0003fe934c69de748383fce8c01b8cfe000
    3fe90d4f2f6752e63fcf5509c01790003fe8e6528effd79d3fd00e6c121fb8003fe8bfce9fcc007c3fd071b80e93d0003fe899c0dabec30e3fd0d46b9e867000
    3fe87427aa2317fb3fd13687334bd0003fe84f00acb39a083fd1980d672348003fe82a49e8653e553fd1f8ffe0cc80003fe8060195f402603fd2595fd7636800
    3fe7e22563e0a3293fd2b9300914a8003fe7beb377dcb5ad3fd31872104360003fe79baa679725c23fd377266dec18003fe77907f21706573fd3d54ffbaf3000
    3fe756cadbd6130c3fd432eee32fe0003fe61000014fb66b3c7e026c91425b3c3fe63000034db4953c8dbfea48005d413fe650000d94d4783c8e7fa786d6a5b7
    3fe67000074e6fad3c61fcea6b54254c3fe68ffffedf0faebc7c7e274c590efd3fe6b0000763c5bcbc8ac16848dcda013fe6d0001e5cc1f63c833f1c9d499311
    3fe6efffeb05f63ebc7e80041ae22d533fe710000e8697803c7bff66710979523fe72ffffc67e9123c8c00e226bd87243fe74fffdf81116abc6e02916ef101d2
    3fe770000f679c90bc67fc71cd549c743fe78ffffa7ec8353c81bec19ef504833fe7affffe20c2e6bc707e1729cc64653fe7cfffed3fc900bc808072087b8b1c
    3fe7efffe9261a763c8dc0286d9df9ae3fe81000049ca3e83c897fd251e54c333fe8300017932c8fbc8afee9b630f3813fe850000633739c3c89bfbf6b6535bc
    3fe87000204289c6bc8bbf65f3117b753fe88fffebf57904bc89006ea23dcb573fe8b00022bc04dfbc7d00df38e04b0a3fe8cfffe50c1b8abc88007146ff9f05
    3fe8effffc918e433c83817bd07a70383fe910001efa5fc73c893e9176dfb4033fe9300013467bb93c7f804e4b9802763fe94fffe6ee076fbc8f7ef0d9ff622e
    3fe96fffde3c12d1bc7082aa962638ba3fe98ffff4458a0dbc87801b9164a8ef3fe9afffdd982e3ebc8740e08a5a93373fe9cfffed49fb663c3fce08c19be000
    3fe9f00020f19c51bc8a3faa27885b0a3fea10001145b0063c74ff489958da563fea300007bbf6fa3c8cbeab8a2b6d183fea500010971d793c88fecadd787930
    3fea70001df52e48bc8f41763dd8abdb3fea90001c593352bc8ebf0284c276123feab0002a4f3e4bbc69fd043cff3f5f3feacfffd7ae1ed1bc823ee7129070b4
    3feaefffee5104783c6a063ee00edea33feb0fffdb650d5b3c5a06c8381f0ab93feb2ffffeaaca57bc79011e74233c1d3feb4fffd995badcbc79ff1068862a9f
    3feb7000249e659c3c8aff45d0864f3e3feb8ffff98716403c7cfe7796c2c3f93febafffd204cb4fbc63ff27eef22bc43febcfffd2415c45bc6cffb7ee3bea21
    3febeffff86309dfbc814103972e0b5c3fec0fffe1b576533c8bc16494b76a193fec2ffff1fa57e3bc64feef8d30c6ed3fec4fffdcbfe424bc843f68bcec4775
    3fec6fffed54b9f73c847ea3f053e0ec3fec8fffeb998fd53c7383068df992f13fecb0002125219abc68fd8e64180e043feccfffdd94469c3c8e7ebe1cc7ea72
    3fecefffeafdc4763c8ebe39ad9f88fe3fed1000169af82b3c757d91a8b95a713fed30000d0ff71d3c89c1906970c7da3fed4fffea790fc4bc580e37c558fe0c
    3fed70002edc87e5bc7f80d64dc10f443fed900021dc82aabc747c8f94fd5c5c3fedafffd86b02833c8c7f1dc521617e3fedd000296c47393c88019eb2ffb153
    3fedefffe54490f53c6e00d2c652cc893fee0fffcdabf694bc7f8340202d69d23fee2fffdb52c8dd3c7b00c1ca1b08643fee4ffff24216ef3c72ffa8b094ab51
    3fee6fffe88a5e11bc57f673b1efbe593fee9000119eff0dbc84808d5e0bc8013feeafffdfa517443c780006d54320b53feed0001a127fa1bc5002f860565c92
    3feef00007babcc4bc8540445d35e6113fef0ffff57a8d02bc4ffb3139ef91053fef30001ee58ac73c8a81acf27311553fef4ffff58234943c8a3f41d4d7c743
    3fef6ffffca94c6bbc6202f41c9878753fef8fffe1f9c4413c777dd1f477e74b3fefafffd2e0e37ebc6f01199a7ca3313fefd0001c77e49e3c7181ee4bceacb1
    3fefeffff7e0c331bc6e05370170875a3ff00ffff465606ebc8a7ead491c0ada3ff02ffff3867a58bc977f69c3fcb2e03ff04ffffdfc0d173c97bffe34cb945b
    3ff0700003cd4d823c820083c0e456cb3ff08ffff9f2cbe8bc6dffdfbe37751a3ff0b000010cda65bc913f7faee626eb3ff0d00001a4d3383c807dfa79489ff7
    3ff0effffadafdfdbc77040570d66bc03ff110000bbafd963c8e80d4846d0b623ff12ffffae5f45d3c9dbffa64fd36ef3ff150000dd59ad93c9a0077701250ae
    3ff170000f21559a3c8dfdf9e2e3deee3ff18ffffc2754263c910030dc3b72733ff1b000123d3c593c997f79800301883ff1cffff8299eb7bc65f932ab9f8c67
    3ff1effff48ad4003c937fbf9da75beb3ff210000c8b86a43c9f806b91fd5b223ff23000038543033c93ffc2eb9fbf333ff24fffffbcf6843c7601e77e2e2e72
    3ff26ffff52921d93c7ffcbb767f0c613ff2900014933a3cbc7202ca3c02412b3ff2b00014556313bc92808233f21f023ff2cfffebfe523bbc88ff7e384fdcf2
    3ff2f0000bb8ad96bc85ff51503041c53ff30ffffb7ae2afbc810071885e289d3ff32ffffeac5f7fbc91ff5d3fb7b7153ff350000ca667563c957f82228b82bd
    3ff3700011fbf7213c8000bac40dd5cc3ff38ffff9592fb9bc943f9d2db2a7513ff3b00004ddd2423c857f6b707638e13ff3cffff5b2c9573c7a023a10bf1231
    3ff3efffeab0b4183c987f6d66b152b03ff410001532aff43c67f8375f1985243ff4300017478b293c8301e672dc51433ff44fffe795b4633c89ff69b8b2895a
    3ff46fffe80475e0bc95c0b19bc2f2543ff48fffef6fc1e73c9b4009f23a2a723ff4afffe5bea704bc94ffb7bf0d7d453ff4d000171027debc99c06471dc6a3d
    3ff4f0000ff03ee23c977f890b85531c3ff5100012dc4bd13c6004657166a4363ff530001605277abc96bfcece2332093ff54fffecdb704cbc8902720505a1d7
    3ff56fffef5f54a93c9bbfe60ec964123ff5900017e610123c887ec581afef903ff5b00003c93e92bc9f41080abf0cc03ff5d0001d4919bcbc98812afb254729
    3ff5efffe7b87a89bc947eb780ed6904
  `);
  const Ln2hi = LOG[0], Ln2lo = LOG[1], LA0 = LOG[2], LA1 = LOG[3], LA2 = LOG[4], LA3 = LOG[5], LA4 = LOG[6],
    LB0 = LOG[7], LB1 = LOG[8], LB2 = LOG[9], LB3 = LOG[10], LB4 = LOG[11], LB5 = LOG[12], LB6 = LOG[13], LB7 = LOG[14],
    LB8 = LOG[15], LB9 = LOG[16], LB10 = LOG[17], LT = 18, LT2 = 18 + 256;
  function log(x) {
    F[0] = x;
    let ihi = U[1];
    const ilo = U[0];
    if (ihi >= 0x3fee0000 && ihi < 0x3ff10900) {
      if (ihi === 0x3ff00000 && ilo === 0) return 0;
      const r = x - 1.0, r2 = r * r, r3 = r * r2;
      let y = r3 * (LB1 + r * LB2 + r2 * LB3 + r3 * (LB4 + r * LB5 + r2 * LB6 + r3 * (LB7 + r * LB8 + r2 * LB9 + r3 * LB10)));
      let w = r * 134217728;
      const rhi = r + w - w, rlo = r - rhi;
      w = rhi * rhi * LB0;
      const hi = r + w;
      let lo = r - hi + w;
      lo += LB0 * rlo * (rhi + r);
      y += lo;
      y += hi;
      return y;
    }
    const top = ihi >>> 16;
    if (top < 0x0010 || top >= 0x7ff0) {
      if (((ihi & 0x7fffffff) | ilo) === 0) return -Infinity;
      if (x === Infinity) return x;
      if ((top & 0x8000) || (top & 0x7ff0) === 0x7ff0) return (x - x) / (x - x);
      F[0] = x * 2 ** 52;
      ihi = U[1] - (52 << 20);
    }
    const tmp = (ihi - 0x3fe60000) >>> 0, i = (tmp >>> 13) & 127, k = (tmp | 0) >> 20;
    const z = bits(ihi - (tmp & 0xfff00000), U[0]);
    const invc = LOG[LT + 2 * i], logc = LOG[LT + 2 * i + 1];
    const r = (z - LOG[LT2 + 2 * i] - LOG[LT2 + 2 * i + 1]) * invc, kd = k;
    const w = kd * Ln2hi + logc, hi = w + r, lo = w - hi + r + kd * Ln2lo;
    const r2 = r * r;
    return lo + r2 * LA0 + r * r2 * (LA1 + r * LA2 + r2 * (LA3 + r * LA4)) + hi;
  }

  // log2 (optimized-routines), table __log2_data
  const LOG2 = table(`
    3ff71547652000003de705fc2eefa200bfe71547652b83393fdec709dc3a04bebfd7154764702ffb3fd2776c50034c48bfcec7b328ea92bc3fca6225e117f92e
    bfe71547652b82fe3fdec709dc3a03f7bfd71547652b7c3f3fd2776c50f05be4bfcec709dd768fe53fca61761ec4e736bfc7153fbc64a79b3fc484d154f01b4a
    bfc289e4a72c383c3fc0b32f285aee663ff724286bb1acf8bfe1095feecdb0003ff6e1f766d2cca1bfe08494bd76d0003ff6a13d0e30d48abfe00143aee8f800
    3ff661ec32d06c85bfdefec5360b40003ff623fa951198f8bfddfdd91ab7e0003ff5e75ba4cf026cbfdcffae0cc790003ff5ac055a214fb8bfdc043811fda000
    3ff571ed0f166e1ebfdb0b67323ae0003ff53909590bf835bfda152f5a2db0003ff5014fed61adddbfd9217f5af860003ff4cab88e487bd0bfd8304db0719000
    3ff49539b4334feebfd74189f9a9e0003ff460cbdfafd569bfd6552bb51990003ff42d664ee4b953bfd56b23a29b10003ff3fb01111dd8a6bfd483650f5fa000
    3ff3c995b70c5836bfd39de937f6a0003ff3991c4ab6fd4abfd2baa1538d60003ff3698e0ce099b5bfd1d98340ca40003ff33ae48213e7b2bfd0fa853a40e000
    3ff30d191985bdb1bfd01d9c32e730003ff2e025cab271d7bfce857da2fa60003ff2b404cf13cd82bfccd3c8633d80003ff288b02c7ccb50bfcb26034c14a000
    3ff25e2263944de5bfc97c1c2f4fe0003ff234563d8615b1bfc7d6023f8000003ff20b46e33eaf38bfc633a71a05e0003ff1e2eefdcda3ddbfc494f5e9570000
    3ff1bb4a580b3930bfc2f9e424e0a0003ff19453847f2200bfc162595afdc0003ff16e06c0d5d73cbfbf9c9a75bd80003ff1485f47b7e4c2bfbc7b575bf9c000
    3ff12358ad0085d1bfb960c60ff480003ff0fef00f532227bfb64ce247b600003ff0db2077d03a8fbfb33f78b20140003ff0b7e6d65980d9bfb0387d1a42c000
    3ff0953efe7b408dbfaa6f9208b500003ff07325cac53b83bfa47a954f7700003ff05197e40d1b5cbf9d23a8c50c00003ff03091c1208ea2bf916a2629780000
    3ff0101025b37e21bf7720f8d8e800003fefc07ef9caa76b3f86fe53b15000003fef4465d3f6f1843fa11ccce10f80003feecc079f84107f3fac4dfc8c8b8000
    3fee573a99975ae83fb3aa321e5740003fede5d6f0bd3de63fb918a0d08b80003fed77b681ff38b33fbe72e9da0440003fed0cb5724de9433fc1dcd2507f6000
    3feca4b2dc0e75633fc476ab03dea0003fec3f8ee8d6cb513fc7074377e220003febdd2b4f020c4c3fc98ede8ba940003feb7d6c006015ca3fcc0db86ad2e000
    3feb20366e2e338f3fce840aafcee0003feac570262950393fd0790ab46780003fea6d01bc2731dd3fd1ac056801c0003fea16d3bc3ff18b3fd2db11d4fee000
    3fe9c2d14967fead3fd406464ec580003fe970e4f47c99023fd52dbe093af0003fe920fb3982bcf23fd651902050d0003fe8d30187f759f13fd771d2cdeaf000
    3fe886e5ebb9f66d3fd88e9c857d90003fe83c97b658b9943fd9a80155e160003fe7f405ffc610223fdabe186ed3d0003fe7ad22181415ca3fdbd0f2aea0e000
    3fe767dcf99eff8c3fdce0a43dbf40003fe6200012b90a8e3c8904ab0644b6053fe66000045734a63c61ff9bea62f7a93fe69fffc325f2c53c827ecfcb3c90ba
    3fe6e00038b95a043c88ff88567393263fe71fffe09994e33c8afd40275f82b13fe7600015590e10bc72fd75b42383413fe7a00012655bd53c7808e67c242b76
    3fe7e0003259e9a6bc6208e426f622b73fe81fffedb4b2d2bc8402461ea5c92f3fe860002dfafcc33c6df7f4a2f29a1f3fe89ffff78c6b50bc8e0453094995fd
    3fe8e00039671566bc8a04f3bec77b453fe91fffe2bf1745bc77fa34400e203c3fe95fffcc5c9fd1bc76ff8005a0695d3fe9a0003bba47673c70f8c4c4ec7e03
    3fe9dfffe7b92da53c8e7fd9478c46023fea1fffd72efdafbc6a0c554dcdae7e3fea5fffde04ff953c867da98ce9b26b3fea9fffca5e8d2bbc8284c9b54c13de
    3feadfffddad03ea3c5812c8ea602e3c3feb1ffff10d3d4dbc8efaddad27789c3feb5fffce21165a3c53cb1719c612373feb9fffd950e6743c73f7d94194ce00
    3febe000139ca8af3c750ac4215d9bc03fec20005b46df993c6beea653e9c1c93fec600040b9f7aebc7c079f274a70d63feca0006255fd8abc7a0b4076e84c1f
    3fecdfffd94c095d3c88f933f99ab5d73fed1ffff975d6cfbc582c08665fe1be3fed5fffa2561c93bc7b04289bd295f33fed9fff9d228b0c3c870251340fa236
    3fede00065bc7e16bc75011e16a4d80c3fee200002f647913c89802f09ef62e03fee600057d7a6d8bc7e0b75580cf7fa3feea00027edc00cbc8c848309459811
    3feee0006cf5cb7cbc8f8027951576f43fef2000782b7dccbc8f81d97274538f3fef6000260c450abc4071002727ffdc3fef9fffe88cd533bc581bdce1fda8b0
    3fefdfffd50f86893c87f91acb918e6e3ff02000042923673c9b7ff3653246813ff05fffe3e3d6683c86fa08ddae957b3ff0a0000a85a757bc57e2de80d3fb91
    3ff0e0001a5f3fccbc91823305c5f0143ff11ffff8afbaf5bc8bfabb6680bac23ff15fffe54d91adbc9d7f121737e7ef3ff1a00011ac36e13c9c000a0516f5ff
    3ff1e00019c84248bc9082fbe4da5da03ff220000ffe5e6ebc88fdd04c9cfb433ff26000269fd8913c8cfe2a7994d1823ff2a00029a6e6dabc700273715e8bc5
    3ff2dfffe0293e393c9b7c39dab2a6f93ff31ffff7dcf0823c7df1336edc52543ff35ffff05a8b60bc9e03564ccd31eb3ff3a0002e0eaecc3c75f0e74bd3a477
    3ff3e000043bb2363c9c7dcb149d88333ff4200002d187ff3c7e08afcf2d3d283ff460000d387cb13c820837856599a63ff4a00004569f89bc89fa5c904fbcd2
    3ff4e000043543f3bc781125ed1753293ff51fffcc027f0f3c9883d8847754dc3ff55ffffd87b36fbc8709e731d028073ff59ffff21df7ba3c87f79f68727b02
    3ff5dfffebfc3481bc9180902e30e93e
  `);
  const InvLn2hi = LOG2[0], InvLn2lo = LOG2[1], GA0 = LOG2[2], GA1 = LOG2[3], GA2 = LOG2[4], GA3 = LOG2[5], GA4 = LOG2[6], GA5 = LOG2[7],
    GB0 = LOG2[8], GB1 = LOG2[9], GB2 = LOG2[10], GB3 = LOG2[11], GB4 = LOG2[12], GB5 = LOG2[13], GB6 = LOG2[14], GB7 = LOG2[15],
    GB8 = LOG2[16], GB9 = LOG2[17], GT = 18, GT2 = 18 + 128;
  function log2(x) {
    F[0] = x;
    let ihi = U[1];
    const ilo = U[0];
    if (ihi >= 0x3feea4af && ihi < 0x3ff0b559) {
      if (ihi === 0x3ff00000 && ilo === 0) return 0;
      const r = x - 1.0;
      F[0] = r; U[0] = 0;
      const rhi = F[0], rlo = r - rhi, hi = rhi * InvLn2hi;
      let lo = rlo * InvLn2hi + r * InvLn2lo;
      const r2 = r * r, r4 = r2 * r2, p = r2 * (GB0 + r * GB1);
      let y = hi + p;
      lo += hi - y + p;
      lo += r4 * (GB2 + r * GB3 + r2 * (GB4 + r * GB5) + r4 * (GB6 + r * GB7 + r2 * (GB8 + r * GB9)));
      y += lo;
      return y;
    }
    const top = ihi >>> 16;
    if (top < 0x0010 || top >= 0x7ff0) {
      if (((ihi & 0x7fffffff) | ilo) === 0) return -Infinity;
      if (x === Infinity) return x;
      if ((top & 0x8000) || (top & 0x7ff0) === 0x7ff0) return (x - x) / (x - x);
      F[0] = x * 2 ** 52;
      ihi = U[1] - (52 << 20);
    }
    const tmp = (ihi - 0x3fe60000) >>> 0, i = (tmp >>> 14) & 63, k = (tmp | 0) >> 20;
    const z = bits(ihi - (tmp & 0xfff00000), U[0]);
    const invc = LOG2[GT + 2 * i], logc = LOG2[GT + 2 * i + 1], kd = k;
    const r = (z - LOG2[GT2 + 2 * i] - LOG2[GT2 + 2 * i + 1]) * invc;
    F[0] = r; U[0] = 0;
    const rhi = F[0], rlo = r - rhi, t1 = rhi * InvLn2hi, t2 = rlo * InvLn2hi + r * InvLn2lo;
    const t3 = kd + logc, hi = t3 + t1, lo = t3 - hi + t1 + t2;
    const r2 = r * r, r4 = r2 * r2;
    const p = GA0 + r * GA1 + r2 * (GA2 + r * GA3) + r4 * (GA4 + r * GA5);
    return lo + r2 * p + hi;
  }

  // pow (optimized-routines), table __pow_log_data; exp part shares __exp_data
  const POW = table(`
    3fe62e42fefa38003d2ef35793c76730bfe0000000000000bfe55555555555603fe00000000000063fe999999959554ebfe555555529a47abff2495b9b4845e9
    3ff0002b8b263fc33ff6a000000000000000000000000000bfd62c82f2b9c8003cfab424283756803ff68000000000000000000000000000bfd5d1bdbf580800
    bd1ca508d8e0f7203ff66000000000000000000000000000bfd5767717455800bd2362a4d5b6506d3ff64000000000000000000000000000bfd51aad872df800
    bce684e49eb067d53ff62000000000000000000000000000bfd4be5f95777800bd041b6993293ee03ff60000000000000000000000000000bfd4618bc21c6000
    3d13d82f484c84cc3ff5e000000000000000000000000000bfd404308686a8003cdc42f3ed820b3a3ff5c000000000000000000000000000bfd3a64c55694800
    3d20b1c6865194603ff5a000000000000000000000000000bfd347dd9a9880003d25594dd4c580923ff58000000000000000000000000000bfd2e8e2bae12000
    3d267b1e99b72bd83ff56000000000000000000000000000bfd2895a13de88003d15ca14b6cfb03f3ff56000000000000000000000000000bfd2895a13de8800
    3d15ca14b6cfb03f3ff54000000000000000000000000000bfd22941fbcf7800bd165a242853da763ff52000000000000000000000000000bfd1c898c1699800
    bd1fafbc68e754043ff50000000000000000000000000000bfd1675cababa8003d1f1fc63382a8f03ff4e000000000000000000000000000bfd1058bf9ae4800
    bd26a8c4fd055a663ff4c000000000000000000000000000bfd0a324e2739000bd0c6bee7ef4030e3ff4a000000000000000000000000000bfd0402594b4d000
    bcf036b89ef42d7f3ff4a000000000000000000000000000bfd0402594b4d000bcf036b89ef42d7f3ff48000000000000000000000000000bfcfb9186d5e4000
    3d0d572aab993c873ff46000000000000000000000000000bfcef0adcbdc60003d2b26b79c86af243ff44000000000000000000000000000bfce27076e2af000
    bd172f4f543fff103ff42000000000000000000000000000bfcd5c216b4fc0003d21ba91bbca681b3ff40000000000000000000000000000bfcc8ff7c79aa000
    3d27794f689f84343ff40000000000000000000000000000bfcc8ff7c79aa0003d27794f689f84343ff3e000000000000000000000000000bfcbc286742d9000
    3d194eb0318bb78f3ff3c000000000000000000000000000bfcaf3c94e80c0003cba4e633fcd90663ff3a000000000000000000000000000bfca23bc1fe2b000
    bd258c64dc46c1ea3ff3a000000000000000000000000000bfca23bc1fe2b000bd258c64dc46c1ea3ff38000000000000000000000000000bfc9525a9cf45000
    bd2ad1d904c1d4e33ff36000000000000000000000000000bfc87fa06520d0003d2bbdbf7fdbfa093ff34000000000000000000000000000bfc7ab890210e000
    3d2bdb9072534a583ff34000000000000000000000000000bfc7ab890210e0003d2bdb9072534a583ff32000000000000000000000000000bfc6d60fe719d000
    bd10e46aa3b2e2663ff30000000000000000000000000000bfc5ff3070a79000bd1e9e439f1050393ff30000000000000000000000000000bfc5ff3070a79000
    bd1e9e439f1050393ff2e000000000000000000000000000bfc526e5e3a1b000bd20de8b90075b8f3ff2c000000000000000000000000000bfc44d2b6ccb8000
    3d170cc16135783c3ff2c000000000000000000000000000bfc44d2b6ccb80003d170cc16135783c3ff2a000000000000000000000000000bfc371fc201e9000
    3cf178864d27543a3ff28000000000000000000000000000bfc29552f81ff000bd248d301771c4083ff26000000000000000000000000000bfc1b72ad52f6000
    bd2e80a41811a3963ff26000000000000000000000000000bfc1b72ad52f6000bd2e80a41811a3963ff24000000000000000000000000000bfc0d77e7cd09000
    3d0a699688e85bf43ff24000000000000000000000000000bfc0d77e7cd090003d0a699688e85bf43ff22000000000000000000000000000bfbfec9131dbe000
    bd2575545ca333f23ff20000000000000000000000000000bfbe27076e2b00003d2a342c2af0003c3ff20000000000000000000000000000bfbe27076e2b0000
    3d2a342c2af0003c3ff1e000000000000000000000000000bfbc5e548f5bc000bd1d0c57585fbe063ff1c000000000000000000000000000bfba926d3a4ae000
    3d253935e85baac83ff1c000000000000000000000000000bfba926d3a4ae0003d253935e85baac83ff1a000000000000000000000000000bfb8c345d631a000
    3d137c294d2f56683ff1a000000000000000000000000000bfb8c345d631a0003d137c294d2f56683ff18000000000000000000000000000bfb6f0d28ae56000
    bd269737c93373da3ff16000000000000000000000000000bfb51b073f0620003d1f025b61c65e573ff16000000000000000000000000000bfb51b073f062000
    3d1f025b61c65e573ff14000000000000000000000000000bfb341d7961be0003d2c5edaccf913df3ff14000000000000000000000000000bfb341d7961be000
    3d2c5edaccf913df3ff12000000000000000000000000000bfb16536eea380003d147c5e768fa3093ff10000000000000000000000000000bfaf0a30c0118000
    3d2d599e83368e913ff10000000000000000000000000000bfaf0a30c01180003d2d599e83368e913ff0e000000000000000000000000000bfab42dd71198000
    3d1c827ae5d6704c3ff0e000000000000000000000000000bfab42dd711980003d1c827ae5d6704c3ff0c000000000000000000000000000bfa77458f632c000
    bd2cfc4634f2a1ee3ff0c000000000000000000000000000bfa77458f632c000bd2cfc4634f2a1ee3ff0a000000000000000000000000000bfa39e87b9fec000
    3cf502b7f526feaa3ff0a000000000000000000000000000bfa39e87b9fec0003cf502b7f526feaa3ff08000000000000000000000000000bf9f829b0e780000
    bd2980267c7e09e43ff08000000000000000000000000000bf9f829b0e780000bd2980267c7e09e43ff06000000000000000000000000000bf97b91b07d58000
    bd288d5493faa6393ff04000000000000000000000000000bf8fc0a8b0fc0000bcdf1e7cf6d3a69c3ff04000000000000000000000000000bf8fc0a8b0fc0000
    bcdf1e7cf6d3a69c3ff02000000000000000000000000000bf7fe02a6b100000bd19e23f0dda40e43ff02000000000000000000000000000bf7fe02a6b100000
    bd19e23f0dda40e43ff00000000000000000000000000000000000000000000000000000000000003ff000000000000000000000000000000000000000000000
    00000000000000003fefc0000000000000000000000000003f80101575890000bd10c76b999d2be83fef80000000000000000000000000003f90205658938000
    bd23dc5b06e2f7d23fef40000000000000000000000000003f98492528c90000bd2aa0ba325a0c343fef00000000000000000000000000003fa0415d89e74000
    3d0111c05cf1d7533feec0000000000000000000000000003fa466aed42e0000bd2c167375bdfd283fee80000000000000000000000000003fa894aa149fc000
    bd197995d05a267d3fee40000000000000000000000000003faccb73cdddc000bd1a68f247d828073fee20000000000000000000000000003faeea31c006c000
    bd0e113e4fc93b7b3fede0000000000000000000000000003fb1973bd1466000bd25325d560d9e9b3feda0000000000000000000000000003fb3bdf5a7d1e000
    3d2cc85ea5db4ed73fed60000000000000000000000000003fb5e95a4d97a000bd2c69063c5d1d1e3fed40000000000000000000000000003fb700d30aeac000
    3cec1e8da99ded323fed00000000000000000000000000003fb9335e5d5940003d23115c3abd47da3fecc0000000000000000000000000003fbb6ac88dad6000
    bd1390802bf768e53feca0000000000000000000000000003fbc885801bc40003d2646d1c65aacd33fec60000000000000000000000000003fbec739830a2000
    bd2dc068afe645e03fec40000000000000000000000000003fbfe89139dbe000bd2534d64fa10afd3fec00000000000000000000000000003fc1178e8227e000
    3d21ef78ce2d07f23febe0000000000000000000000000003fc1aa2b7e23f0003d2ca78e443899343feba0000000000000000000000000003fc2d1610c868000
    3d039d6ccb81b4a13feb80000000000000000000000000003fc365fcb01590003cc62fa8234b72893feb40000000000000000000000000003fc4913d8333b000
    3d25837954fdb6783feb20000000000000000000000000003fc527e5e4a1b0003d2633e8e5697dc73feae0000000000000000000000000003fc6574ebe8c1000
    3d19cf8b2c3c2e783feac0000000000000000000000000003fc6f0128b757000bd25118de59c21e13feaa0000000000000000000000000003fc7898d85445000
    bd1c6610709143053fea60000000000000000000000000003fc8beafeb390000bd073d54aae92cd13fea40000000000000000000000000003fc95a5adcf70000
    3d07f22858a0ff6f3fea00000000000000000000000000003fca93ed3c8ae000bd287243505621693fe9e0000000000000000000000000003fcb31d8575bd000
    bd0c358d4eace1aa3fe9c0000000000000000000000000003fcbd087383be000bd2d4bc4595412b63fe9a0000000000000000000000000003fcc6ffbc6f01000
    bcf1ec72c5962bd23fe960000000000000000000000000003fcdb13db0d49000bd2aff2af715b0353fe940000000000000000000000000003fce530effe71000
    3cc212276041f4303fe920000000000000000000000000003fcef5ade4dd0000bcca211565bb8e113fe900000000000000000000000000003fcf991c6cb3b000
    3d1bcbecca0cdf303fe8c0000000000000000000000000003fd07138604d58003cf89cdb16ed4e913fe8a0000000000000000000000000003fd0c42d67616000
    3d27188b163ceae93fe880000000000000000000000000003fd1178e8227e800bd2c210e63a5f01c3fe860000000000000000000000000003fd16b5ccbacf800
    3d2b9acdf7a516813fe840000000000000000000000000003fd1bf99635a68003d2ca6ed5147bdb73fe820000000000000000000000000003fd214456d0eb800
    3d0a87deba46baea3fe7e0000000000000000000000000003fd2bef07cdc90003d2a9cfa4a5004f43fe7c0000000000000000000000000003fd314f1e1d36000
    bd28e27ad3213cb83fe7a0000000000000000000000000003fd36b6776be10003d116ecdb0f177c83fe780000000000000000000000000003fd3c25277333000
    3d183b54b606bd5c3fe760000000000000000000000000003fd419b423d5e8003d08e436ec90e09d3fe740000000000000000000000000003fd4718dc271c800
    bd2f27ce0967d6753fe720000000000000000000000000003fd4c9e09e173000bd2e20891b0ad8a43fe700000000000000000000000000003fd522ae0738a000
    3d2ebe708164c7593fe6e0000000000000000000000000003fd57bf753c8d0003d1fadedee5d40ef3fe6c0000000000000000000000000003fd5d5bddf596000
    bd0a0b2a08a465dc
  `);
  const PLn2hi = POW[0], PLn2lo = POW[1], PA0 = POW[2], PA1 = POW[3], PA2 = POW[4], PA3 = POW[5], PA4 = POW[6], PA5 = POW[7],
    PA6 = POW[8], PT = 9, SIGN_BIAS = 0x800 << 7;
  let TAIL = 0;
  function logInline(ihi, ilo) {
    const tmp = (ihi - 0x3fe69555) >>> 0, i = (tmp >>> 13) & 127, k = (tmp | 0) >> 20;
    const izhi = (ihi - (tmp & 0xfff00000)) >>> 0, z = bits(izhi, ilo), kd = k;
    const e = PT + 4 * i, invc = POW[e], logc = POW[e + 2], logctail = POW[e + 3];
    const zhi = bits(izhi + (ilo >>> 31), 0), zlo = z - zhi, rhi = zhi * invc - 1.0, rlo = zlo * invc, r = rhi + rlo;
    const t1 = kd * PLn2hi + logc, t2 = t1 + r, lo1 = kd * PLn2lo + logctail, lo2 = t1 - t2 + r;
    const ar = PA0 * r, ar2 = r * ar, ar3 = r * ar2;
    const arhi = PA0 * rhi, arhi2 = rhi * arhi, hi = t2 + arhi2, lo3 = rlo * (ar + arhi), lo4 = t2 - hi + arhi2;
    const p = ar3 * (PA1 + r * PA2 + ar2 * (PA3 + r * PA4 + ar2 * (PA5 + r * PA6)));
    const lo = lo1 + lo2 + lo3 + lo4 + p, y = hi + lo;
    TAIL = hi - y + lo;
    return y;
  }
  function powSpecialcase(tmp, hi, lo, ki) {
    let scale, y;
    if ((ki & 0x80000000) === 0) {
      scale = bits(hi - (1009 << 20), lo);
      return P1009 * (scale + scale * tmp);
    }
    hi = (hi + (1022 << 20)) >>> 0;
    scale = bits(hi, lo);
    y = scale + scale * tmp;
    if (Math.abs(y) < 1.0) {
      const one = y < 0.0 ? -1.0 : 1.0;
      let l = scale - y + scale * tmp;
      const h = one + y;
      l = one - h + y + l;
      y = (h + l) - one;
      if (y === 0.0) y = hi >>> 31 ? -0.0 : 0.0;
    }
    return P1022 * y;
  }
  function expInline(x, xtail, signBias) {
    F[0] = x;
    let abstop = (U[1] >>> 20) & 0x7ff;
    if (((abstop - 0x3c9) >>> 0) >= 0x408 - 0x3c9) {
      if (abstop < 0x3c9) {
        const one = 1.0 + x;
        return signBias ? -one : one;
      }
      if (abstop >= 0x409) {
        if (U[1] >>> 31) return signBias ? -0.0 : 0.0;
        return signBias ? -Infinity : Infinity;
      }
      abstop = 0;
    }
    let kd = InvLn2N * x + Shift;
    F[0] = kd;
    const ki = U[0];
    kd -= Shift;
    let r = x + kd * NegLn2hiN + kd * NegLn2loN;
    r += xtail;
    const idx = ET + 2 * (ki & 127);
    const tail = EXP[idx], hi = (EXPU[2 * idx + 3] + ((ki + signBias) << 13)) >>> 0, lo = EXPU[2 * idx + 2];
    const r2 = r * r, tmp = tail + r + r2 * (EC2 + r * EC3) + r2 * r2 * (EC4 + r * EC5);
    if (abstop === 0) return powSpecialcase(tmp, hi, lo, ki);
    const scale = bits(hi, lo);
    return scale + scale * tmp;
  }
  // 0: not an integer, 1: odd integer, 2: even integer (finite non-zero input)
  function checkint(hi, lo) {
    const e = (hi >>> 20) & 0x7ff;
    if (e < 0x3ff) return 0;
    if (e > 0x3ff + 52) return 2;
    const s = 0x3ff + 52 - e;
    if (s < 32) {
      if (lo & ((1 << s) - 1)) return 0;
      return lo & (1 << s) ? 1 : 2;
    }
    if (lo !== 0 || (hi & ((1 << (s - 32)) - 1))) return 0;
    return hi & (1 << (s - 32)) ? 1 : 2;
  }
  function pow(x, y) {
    let signBias = 0;
    F[0] = x;
    let ixh = U[1], ixl = U[0];
    F[0] = y;
    const iyh = U[1], iyl = U[0];
    let topx = ixh >>> 20;
    const topy = iyh >>> 20;
    if (((topx - 1) >>> 0) >= 0x7fe || ((topy & 0x7ff) - 0x3be) >>> 0 >= 0x43e - 0x3be) {
      const ayh = iyh & 0x7fffffff, axh = ixh & 0x7fffffff;
      if ((ayh | iyl) === 0 || ayh >= 0x7ff00000) {
        if ((ayh | iyl) === 0) return 1.0;
        if (ixh === 0x3ff00000 && ixl === 0) return 1.0;
        if (x !== x || y !== y) return x + y;
        if (axh === 0x3ff00000 && ixl === 0) return 1.0;
        if ((axh < 0x3ff00000) === !(iyh >>> 31)) return 0.0;
        return y * y;
      }
      if ((axh | ixl) === 0 || axh >= 0x7ff00000) {
        let x2 = x * x;
        if (ixh >>> 31 && checkint(iyh, iyl) === 1) x2 = -x2;
        return iyh >>> 31 ? 1 / x2 : x2;
      }
      if (ixh >>> 31) {
        const yint = checkint(iyh, iyl);
        if (yint === 0) return (x - x) / (x - x);
        if (yint === 1) signBias = SIGN_BIAS;
        ixh &= 0x7fffffff;
        topx &= 0x7ff;
      }
      if (((topy & 0x7ff) - 0x3be) >>> 0 >= 0x43e - 0x3be) {
        if (ixh === 0x3ff00000 && ixl === 0) return 1.0;
        const big = ixh > 0x3ff00000 || (ixh === 0x3ff00000 && ixl !== 0);
        if ((topy & 0x7ff) < 0x3be) return big ? 1.0 + y : 1.0 - y;
        return big === (topy < 0x800) ? Infinity : 0.0;
      }
      if (topx === 0) {
        F[0] = x * 2 ** 52;
        ixh = ((U[1] & 0x7fffffff) - (52 << 20)) >>> 0;
        ixl = U[0];
      }
    }
    const hi = logInline(ixh, ixl), lo = TAIL;
    const yhi = bits(iyh, iyl & 0xf8000000), ylo = y - yhi;
    F[0] = hi; U[0] &= 0xf8000000;
    const lhi = F[0], llo = hi - lhi + lo;
    const ehi = yhi * lhi, elo = ylo * lhi + y * llo;
    return expInline(ehi, elo, signBias);
  }

  PM.libm = {sin, cos, atan, atan2, exp, log, log2, log1p, pow, cbrt, tanh, expm1, hypot, exp2};
});
