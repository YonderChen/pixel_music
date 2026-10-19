/* Numeric helpers with NumPy / CPython semantics, so the JS engine reproduces the
 * former Pyodide results: half-even rounding, floor modulo, NumPy's pairwise
 * summation order, linear percentiles, np.interp, np.gradient and math.dist. */
(self.PixelMusicEngineModules = self.PixelMusicEngineModules || []).push(function (PM) {
  'use strict';
  const BUFFER = 8192; // NumPy's reduction buffer size

  // Python round() / np.round(): half to even.
  function round(x) {
    const f = Math.floor(x), d = x - f;
    if (d < .5) return f;
    if (d > .5) return f + 1;
    return f % 2 === 0 ? f : f + 1;
  }
  // Python float % (also np.mod / np.remainder for floats).
  function mod(a, b) {
    let m = a % b;
    if (m !== 0 && (b < 0) !== (m < 0)) m += b;
    else if (m === 0) m = b < 0 ? -0 : 0;
    return m;
  }
  // Python float // (snaps the quotient like CPython's float_floor_div).
  function floorDiv(vx, wx) {
    let m = vx % wx, div = (vx - m) / wx;
    if (m) { if ((wx < 0) !== (m < 0)) { m += wx; div -= 1; } }
    if (div) { let f = Math.floor(div); if (div - f > .5) f += 1; return f; }
    return 0 * (vx / wx);
  }
  const clip = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
  // utils.clamp: float(max(lo, min(hi, x)))
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  // NumPy pairwise_sum for float64 (n values from a[off], step `stride`).
  function pairwise(a, off, n, stride) {
    stride = stride || 1;
    if (n < 8) {
      let res = 0;
      for (let i = 0; i < n; i++) res += a[off + i * stride];
      return res;
    }
    if (n <= 128) {
      let r0 = a[off], r1 = a[off + stride], r2 = a[off + 2 * stride], r3 = a[off + 3 * stride],
        r4 = a[off + 4 * stride], r5 = a[off + 5 * stride], r6 = a[off + 6 * stride], r7 = a[off + 7 * stride];
      let i = 8;
      const limit = n - (n % 8);
      for (; i < limit; i += 8) {
        const p = off + i * stride;
        r0 += a[p]; r1 += a[p + stride]; r2 += a[p + 2 * stride]; r3 += a[p + 3 * stride];
        r4 += a[p + 4 * stride]; r5 += a[p + 5 * stride]; r6 += a[p + 6 * stride]; r7 += a[p + 7 * stride];
      }
      let res = ((r0 + r1) + (r2 + r3)) + ((r4 + r5) + (r6 + r7));
      for (; i < n; i++) res += a[off + i * stride];
      return res;
    }
    let n2 = Math.floor(n / 2);
    n2 -= n2 % 8;
    return pairwise(a, off, n2, stride) + pairwise(a, off + n2 * stride, n - n2, stride);
  }
  /* np.sum of a contiguous array (or any list of numbers). NumPy 2.0 (as in Pyodide) feeds a
   * reduction through its 8192-element buffer and adds up the pairwise sum of each fill. */
  function sum(a) {
    const n = a.length;
    if (n <= BUFFER) return pairwise(a, 0, n, 1);
    let acc = 0;
    for (let i = 0; i < n; i += BUFFER) acc += pairwise(a, i, Math.min(BUFFER, n - i), 1);
    return acc;
  }
  const mean = a => sum(a) / a.length;

  // np.sum over a 2D view: rows x cols starting at `off`, row stride `rs`, column stride `cs`.
  let scratch = new Float64Array(BUFFER);
  function sumView(a, off, rows, cols, rs, cs) {
    if (rows === 0 || cols === 0) return 0;
    if (rows * cols <= BUFFER && (rows === 1 || cols === 1 || rs === cols * cs)) return pairwise(a, off, rows * cols, cols === 1 ? rs : cs);
    let acc = 0, k = 0;
    for (let y = 0; y < rows; y++) {
      const base = off + y * rs;
      for (let x = 0; x < cols; x++) {
        scratch[k++] = a[base + x * cs];
        if (k === BUFFER) { acc += pairwise(scratch, 0, k, 1); k = 0; }
      }
    }
    if (k) acc += pairwise(scratch, 0, k, 1);
    return acc;
  }

  // np.std / np.var (ddof 0) of a contiguous array.
  function std(a) {
    const n = a.length, m = sum(a) / n, x = new Float64Array(n);
    for (let i = 0; i < n; i++) { const d = a[i] - m; x[i] = d * d; }
    return Math.sqrt(sum(x) / n);
  }

  // np.percentile(values, q), method 'linear'. `sorted` must be ascending.
  function percentileSorted(sorted, q) {
    const n = sorted.length, virtual = (n - 1) * (q / 100);
    if (virtual >= n - 1) return sorted[n - 1];
    const previous = Math.floor(virtual), gamma = virtual - previous;
    const a = sorted[previous], b = sorted[previous + 1], diff = b - a;
    return gamma >= .5 ? b - diff * (1 - gamma) : a + diff * gamma;
  }
  const sortedCopy = values => Float64Array.from(values).sort();
  const percentile = (values, q) => percentileSorted(sortedCopy(values), q);
  function percentiles(values, qs) {
    const sorted = sortedCopy(values);
    return qs.map(q => percentileSorted(sorted, q));
  }
  // np.median of a list of numbers.
  function median(values) {
    const s = sortedCopy(values), n = s.length, k = n >> 1;
    return n % 2 ? s[k] / 1 : (s[k - 1] + s[k]) / 2;
  }

  // np.interp for a scalar x.
  function interp(x, xp, fp) {
    const n = xp.length;
    if (x >= xp[n - 1]) return fp[n - 1];
    if (x < xp[0]) return fp[0];
    let j = 0;
    while (j < n - 1 && xp[j + 1] <= x) j++;
    if (j === n - 1) return fp[j];
    if (xp[j] === x) return fp[j];
    const slope = (fp[j + 1] - fp[j]) / (xp[j + 1] - xp[j]);
    let r = slope * (x - xp[j]) + fp[j];
    if (Number.isNaN(r)) r = slope * (x - xp[j + 1]) + fp[j + 1];
    return r;
  }

  // np.linspace(start, stop, num) (endpoint=True).
  function linspace(start, stop, num) {
    const out = new Float64Array(num);
    if (num === 1) { out[0] = start; return out; }
    const div = num - 1, delta = stop - start, step = delta / div;
    for (let i = 0; i < num; i++) out[i] = step === 0 ? (i / div) * delta + start : i * step + start;
    out[num - 1] = stop;
    return out;
  }

  // np.gradient of an h x w array (unit spacing, edge_order 1). Returns [gy, gx].
  function gradient(a, h, w) {
    const gy = new Float64Array(h * w), gx = new Float64Array(h * w);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        gy[i] = y === 0 ? (a[i + w] - a[i]) / 1 : y === h - 1 ? (a[i] - a[i - w]) / 1 : (a[i + w] - a[i - w]) / 2;
        gx[i] = x === 0 ? (a[i + 1] - a[i]) / 1 : x === w - 1 ? (a[i] - a[i - 1]) / 1 : (a[i + 1] - a[i - 1]) / 2;
      }
    }
    return [gy, gx];
  }

  // utils.normalize01
  function normalize01(a) {
    const n = a.length, out = new Float64Array(n);
    if (!n) return out;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) { if (a[i] < lo) lo = a[i]; if (a[i] > hi) hi = a[i]; }
    if (hi - lo < 1e-12) return out;
    const span = hi - lo;
    for (let i = 0; i < n; i++) out[i] = (a[i] - lo) / span;
    return out;
  }

  // np.hanning(M)
  function hanning(m) {
    if (m < 1) return new Float64Array(0);
    if (m === 1) return Float64Array.of(1);
    const out = new Float64Array(m);
    for (let i = 0; i < m; i++) { const n = 1 - m + 2 * i; out[i] = .5 + .5 * PM.libm.cos(Math.PI * n / (m - 1)); }
    return out;
  }

  // ---- CPython math.dist / math.hypot (vector_norm with error-free products)
  const SPLIT = 134217729;
  function twoProductError(x, y, z) {
    let t = x * SPLIT; const xh = t - (t - x), xl = x - xh;
    t = y * SPLIT; const yh = t - (t - y), yl = y - yh;
    return ((xh * yh - z) + xh * yl + xl * yh) + xl * yl;
  }
  const frexpView = new DataView(new ArrayBuffer(8));
  function frexpExponent(x) {
    frexpView.setFloat64(0, x);
    const bits = (frexpView.getUint16(0) >> 4) & 0x7ff;
    if (bits === 0) return frexpExponent(x * 2 ** 64) - 64;
    return bits - 1022;
  }
  function vectorNorm(vec, max) {
    const n = vec.length;
    if (max === Infinity) return max;
    if (Number.isNaN(max)) return NaN;
    if (max === 0 || n <= 1) return max;
    const scale = 2 ** -frexpExponent(max);
    let csum = 1, frac1 = 0, frac2 = 0;
    for (let i = 0; i < n; i++) {
      const x = vec[i] * scale;
      const hi = x * x, lo = twoProductError(x, x, hi);
      const s = csum + hi, sLo = (csum - s) + hi;
      csum = s; frac1 += lo; frac2 += sLo;
    }
    let h = Math.sqrt(csum - 1 + (frac1 + frac2));
    const hi = -h * h, lo = twoProductError(-h, h, hi);
    const s = csum + hi, sLo = (csum - s) + hi;
    csum = s; frac1 += lo; frac2 += sLo;
    const x = csum - 1 + (frac1 + frac2);
    h += x / (2 * h);
    return h / scale;
  }
  function dist(p, q) {
    const diffs = new Array(p.length);
    let max = 0, nan = false;
    for (let i = 0; i < p.length; i++) {
      const x = Math.abs(p[i] - q[i]);
      diffs[i] = x; if (Number.isNaN(x)) nan = true; if (x > max) max = x;
    }
    return vectorNorm(diffs, nan ? NaN : max);
  }
  function hypot(...values) {
    let max = 0;
    const abs = values.map(v => { const x = Math.abs(v); if (x > max) max = x; return x; });
    return vectorNorm(abs, max);
  }

  // Sort helpers: compare tuples like Python.
  function compareTuples(a, b) {
    for (let i = 0; i < a.length; i++) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    return 0;
  }
  const sortBy = (items, key) => items.map((item, i) => [key(item), i, item])
    .sort((a, b) => compareTuples(a[0], b[0]) || a[1] - b[1]).map(x => x[2]);
  const minBy = (items, key) => {
    let best, bestKey;
    for (const item of items) { const k = key(item); if (bestKey === undefined || compareTuples(k, bestKey) < 0) { best = item; bestKey = k; } }
    return best;
  };
  const maxBy = (items, key) => {
    let best, bestKey;
    for (const item of items) { const k = key(item); if (bestKey === undefined || compareTuples(k, bestKey) > 0) { best = item; bestKey = k; } }
    return best;
  };

  // CPython's set of small non-negative ints or int pairs, iterated in its own slot order
  // (wasm32 build: 32-bit hashes). Only the iteration order matters here, e.g. for sums.
  const XX1 = 2654435761, XX2 = 2246822519, XX5 = 374761393;
  function pyHash(key) {
    if (typeof key === 'number') return key;
    let acc = XX5;
    for (const lane of key) {
      acc = (acc + Math.imul(lane, XX2)) >>> 0;
      acc = ((acc << 13) | (acc >>> 19)) >>> 0;
      acc = Math.imul(acc, XX1) >>> 0;
    }
    acc = (acc + (key.length ^ (XX5 ^ 3527539))) >>> 0;
    return acc === 0xffffffff ? 1546275796 : acc;
  }
  class PySet {
    constructor(items = []) { this.mask = 7; this.table = new Array(8).fill(null); this.fill = 0; this.ids = new Map(); for (const x of items) this.add(x); }
    static id(key) { return typeof key === 'number' ? key : key.join(','); }
    slot(table, mask, hash) {
      let perturb = hash >>> 0, i = (hash >>> 0) & mask;
      for (;;) {
        if (table[i] === null) return i;
        if (i + 9 <= mask) for (let j = 1; j <= 9; j++) if (table[i + j] === null) return i + j;
        perturb >>>= 5;
        i = (i * 5 + 1 + perturb) & mask;
      }
    }
    add(key) {
      const id = PySet.id(key);
      if (this.ids.has(id)) return;
      const hash = pyHash(key);
      this.table[this.slot(this.table, this.mask, hash)] = {key, hash};
      this.ids.set(id, key);
      this.fill++;
      if (this.fill * 5 >= this.mask * 3) {
        const used = this.ids.size;
        let size = 8;
        while (size <= used * 4) size *= 2;
        const old = this.table;
        this.table = new Array(size).fill(null); this.mask = size - 1;
        for (const entry of old) if (entry) this.table[this.slot(this.table, this.mask, entry.hash)] = entry;
      }
    }
    has(key) { return this.ids.has(PySet.id(key)); }
    get size() { return this.ids.size; }
    *[Symbol.iterator]() { for (const entry of this.table) if (entry) yield entry.key; }
  }
  // a & b for two PySets: walks the smaller one, keeping its order.
  function pyIntersection(a, b) {
    const [small, large] = b.size > a.size ? [a, b] : [b, a], out = new PySet();
    for (const key of small) if (large.has(key)) out.add(key);
    return out;
  }

  // Python's round(x, digits): the decimal nearest the exact binary value, ties to even.
  function pyRound(x, digits) {
    if (!isFinite(x) || x === 0) return x;
    const exact = Math.abs(x).toFixed(100), point = exact.indexOf('.');
    const keep = exact.slice(0, point + 1 + digits), rest = exact.slice(point + 1 + digits);
    let up = rest[0] > '5' || (rest[0] === '5' && /[1-9]/.test(rest.slice(1)));
    if (rest[0] === '5' && !up && !/[1-9]/.test(rest.slice(1))) up = (Number(keep[keep.length - 1]) % 2) === 1;
    let value = Number(keep);
    if (up) value = Number((BigInt(keep.replace('.', '')) + 1n).toString().padStart(keep.length - 1, '0').replace(new RegExp(`(\\d{${digits}})$`), '.$1'));
    return x < 0 ? -value : value;
  }

  PM.np = {round, mod, floorDiv, clip, clamp, pairwise, sum, mean, sumView, std, percentile, percentiles, percentileSorted,
    median, interp, linspace, gradient, normalize01, hanning, dist, hypot, compareTuples, sortBy, minBy, maxBy, PySet, pyIntersection, pyRound};
});
