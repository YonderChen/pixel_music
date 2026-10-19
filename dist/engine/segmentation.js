/* segmentation.py: content-shaped regions by seeded region growing, a bottom-up quadtree
 * or SLIC, then greedy merging, an optional majority filter, outlines and shape features.
 * Images are flat row-major arrays; colour images hold 3 values per pixel. */
(self.PixelMusicEngineModules = self.PixelMusicEngineModules || []).push(function (PM) {
  'use strict';
  const {np} = PM;
  const VERSION = 'segmentation-v1', METHODS = ['grow', 'quadtree', 'slic'];
  const METHOD_NAMES = {grow: '方格种子 · 区域生长', quadtree: '四叉树 · 分裂合并', slic: 'SLIC 超像素'};
  const MAX_W = 192, MAX_H = 120, MIN_AREA = 24, SEED_STEP = 16;

  // Box average by an integer factor until the image fits 192x120 (channels values per pixel).
  function downsample(data, h, w, channels = 3) {
    const f = Math.max(1, Math.ceil(Math.max(w / MAX_W, h / MAX_H)));
    if (f === 1) return {data: Float64Array.from(data), height: h, width: w};
    const H = Math.floor(h / f), W = Math.floor(w / f), out = new Float64Array(H * W * channels);
    for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) for (let c = 0; c < channels; c++) {
      let s = 0;
      for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) s += data[((Y * f + dy) * w + X * f + dx) * channels + c];
      out[(Y * W + X) * channels + c] = s / (f * f);
    }
    return {data: out, height: H, width: W};
  }

  const M = [[.4124564, .3575761, .1804375], [.2126729, .7151522, .0721750], [.0193339, .1191920, .9503041]];
  const WHITE = [.95047, 1, 1.08883];
  function toLab(rgb) {
    const {pow, cbrt} = PM.libm, n = rgb.length / 3, out = new Float64Array(rgb.length);
    const e = pow(6 / 29, 3), k = 3 * pow(6 / 29, 2);
    const lin = new Float64Array(3), f = new Float64Array(3);
    for (let p = 0; p < n; p++) {
      for (let c = 0; c < 3; c++) {
        const v = np.clip(rgb[p * 3 + c], 0, 1);
        lin[c] = v <= .04045 ? v / 12.92 : pow((v + .055) / 1.055, 2.4);
      }
      for (let c = 0; c < 3; c++) {
        const xyz = (lin[0] * M[c][0] + lin[1] * M[c][1] + lin[2] * M[c][2]) / WHITE[c];
        f[c] = xyz > e ? cbrt(xyz) : xyz / k + 4 / 29;
      }
      out[p * 3] = 116 * f[1] - 16; out[p * 3 + 1] = 500 * (f[0] - f[1]); out[p * 3 + 2] = 200 * (f[1] - f[2]);
    }
    return out;
  }

  // 3x3 median (edge padded), twice.
  function smooth(lab, H, W, passes = 2) {
    let src = lab;
    const win = new Float64Array(9);
    for (let pass = 0; pass < passes; pass++) {
      const out = new Float64Array(src.length);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) {
        let k = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const yy = Math.min(H - 1, Math.max(0, y + dy)), xx = Math.min(W - 1, Math.max(0, x + dx));
          win[k++] = src[(yy * W + xx) * 3 + c];
        }
        win.sort();
        out[(y * W + x) * 3 + c] = win[4];
      }
      src = out;
    }
    return src;
  }

  const threshold = detail => 12 * PM.libm.pow(2, (.5 - np.clip(detail, 0, 1)) * 2);

  // Per-channel mean and summed variance of the listed pixels, as arr.mean(axis=0) / var(axis=0).sum().
  function channelStats(lab, pixels) {
    const k = pixels.length, mean = [0, 0, 0], variance = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (const p of pixels) s += lab[p * 3 + c];
      mean[c] = s / k;
      let v = 0;
      for (const p of pixels) { const d = lab[p * 3 + c] - mean[c]; v += d * d; }
      variance[c] = v / k;
    }
    return {mean, spread: np.sum(variance)};
  }
  function rectPixels(W, y0, x0, y1, x1) {
    const out = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out.push(y * W + x);
    return out;
  }

  const neighbours4 = (p, H, W) => {
    const py = Math.floor(p / W), px = p - py * W;
    return [py ? p - W : -1, py < H - 1 ? p + W : -1, px ? p - 1 : -1, px < W - 1 ? p + 1 : -1];
  };

  function grow(lab, H, W, detail) {
    const limit = threshold(detail), local = threshold(detail) * .6, labels = new Int32Array(H * W).fill(-1);
    const seeds = [];
    for (let y = SEED_STEP / 2; y < H; y += SEED_STEP) for (let x = SEED_STEP / 2; x < W; x += SEED_STEP) seeds.push([y, x]);
    const sorted = np.sortBy(seeds, ([y, x]) => [channelStats(lab, rectPixels(W, Math.max(0, y - 2), Math.max(0, x - 2), Math.min(H, y + 3), Math.min(W, x + 3))).spread, y, x]);
    const order = [...sorted.map(([y, x]) => y * W + x)];
    for (let p = 0; p < H * W; p++) order.push(p);
    const value = p => [lab[p * 3], lab[p * 3 + 1], lab[p * 3 + 2]];
    let count = 0;
    for (const start of order) {
      if (labels[start] >= 0) continue;
      labels[start] = count;
      const total = value(start);
      let size = 1;
      const queue = [start];
      for (let head = 0; head < queue.length; head++) {
        const p = queue[head], pv = value(p);
        for (const q of neighbours4(p, H, W)) {
          if (q < 0 || labels[q] >= 0) continue;
          const v = value(q), mean = [total[0] / size, total[1] / size, total[2] / size];
          if (np.dist(v, mean) < limit && np.dist(v, pv) < local) {
            labels[q] = count; size++;
            total[0] += v[0]; total[1] += v[1]; total[2] += v[2];
            queue.push(q);
          }
        }
      }
      count++;
    }
    return labels;
  }

  function quadtree(lab, H, W, detail) {
    const limit = threshold(detail), labels = new Int32Array(H * W);
    let count = 0;
    const emit = ([y0, x0, y1, x1]) => {
      for (let y = y0; y < y1; y++) labels.fill(count, y * W + x0, y * W + x1);
      count++;
    };
    function visit(y0, x0, y1, x1) {
      if (y1 - y0 < 6 || x1 - x0 < 6) return [y0, x0, y1, x1];
      const ym = Math.floor((y0 + y1) / 2), xm = Math.floor((x0 + x1) / 2);
      const quarters = [[y0, x0, ym, xm], [y0, xm, ym, x1], [ym, x0, y1, xm], [ym, xm, y1, x1]];
      const kept = quarters.map(q => visit(...q));
      if (kept.every(Boolean)) {
        const means = quarters.map(([a, b, c, d]) => channelStats(lab, rectPixels(W, a, b, c, d)).mean);
        let far = -Infinity;
        for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
          let s = 0;
          for (let c = 0; c < 3; c++) { const d = means[i][c] - means[j][c]; s += d * d; }
          far = Math.max(far, Math.sqrt(s));
        }
        if (far < limit * .6 && Math.sqrt(channelStats(lab, rectPixels(W, y0, x0, y1, x1)).spread) < limit * 2) return [y0, x0, y1, x1];
      }
      for (const block of kept) if (block) emit(block);
      return null;
    }
    const root = visit(0, 0, H, W);
    if (root) emit(root);
    return labels;
  }

  const slicCount = detail => np.round(20 + 80 * np.clip(detail, 0, 1));

  // np.arange(start, stop, step) for floats: start + i * ((start + step) - start).
  function arange(start, stop, step) {
    const n = Math.max(0, Math.ceil((stop - start) / step)), out = [];
    const delta = (start + step) - start;
    for (let i = 0; i < n; i++) out.push(i === 0 ? start : i === 1 ? start + step : start + i * delta);
    return out;
  }

  function slic(lab, H, W, detail, iterations = 10, compactness = 10) {
    const {pow} = PM.libm, k = slicCount(detail), S = Math.sqrt(H * W / k);
    const L = new Float64Array(H * W);
    for (let i = 0; i < H * W; i++) L[i] = lab[i * 3];
    const [gy, gx] = np.gradient(L, H, W), gradient = new Float64Array(H * W);
    for (let i = 0; i < H * W; i++) gradient[i] = gy[i] * gy[i] + gx[i] * gx[i];
    const centres = [];
    for (const cy of arange(S / 2, H, S)) for (const cx of arange(S / 2, W, S)) {
      const y = Math.trunc(cy), x = Math.trunc(cx), ya = Math.max(0, y - 1), xa = Math.max(0, x - 1);
      let best = Infinity, by = 0, bx = 0;
      for (let yy = ya; yy < Math.min(H, y + 2); yy++) for (let xx = xa; xx < Math.min(W, x + 2); xx++) {
        if (gradient[yy * W + xx] < best) { best = gradient[yy * W + xx]; by = yy; bx = xx; }
      }
      const p = (by * W + bx) * 3;
      centres.push([lab[p], lab[p + 1], lab[p + 2], by, bx]);
    }
    const labels = new Int32Array(H * W), scale = pow(compactness / S, 2);
    for (let it = 0; it < iterations; it++) {
      const distance = new Float64Array(H * W).fill(Infinity);
      centres.forEach(([cl, ca, cb, cy, cx], index) => {
        const y0 = Math.max(0, Math.trunc(cy - 2 * S)), y1 = Math.min(H, Math.trunc(cy + 2 * S) + 1);
        const x0 = Math.max(0, Math.trunc(cx - 2 * S)), x1 = Math.min(W, Math.trunc(cx + 2 * S) + 1);
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const i = y * W + x, p = i * 3, d0 = lab[p] - cl, d1 = lab[p + 1] - ca, d2 = lab[p + 2] - cb, dy = y - cy, dx = x - cx;
          const d = d0 * d0 + d1 * d1 + d2 * d2 + scale * (dy * dy + dx * dx);
          if (d < distance[i]) { distance[i] = d; labels[i] = index; }
        }
      });
      const members = centres.map(() => []);
      for (let i = 0; i < H * W; i++) members[labels[i]].push(i);
      members.forEach((pixels, index) => {
        if (!pixels.length) return;
        let sy = 0, sx = 0;
        for (const p of pixels) { const y = Math.floor(p / W); sy += y; sx += p - y * W; }
        centres[index] = [...channelStats(lab, pixels).mean, sy / pixels.length, sx / pixels.length];
      });
    }
    return components(labels, H, W);
  }

  // Relabel so every region is one 4-connected component, numbered in scan order.
  function components(labels, H, W) {
    const out = new Int32Array(H * W).fill(-1);
    let count = 0;
    for (let start = 0; start < H * W; start++) {
      if (out[start] >= 0) continue;
      const value = labels[start], queue = [start];
      out[start] = count;
      for (let head = 0; head < queue.length; head++) {
        for (const q of neighbours4(queue[head], H, W)) {
          if (q >= 0 && out[q] < 0 && labels[q] === value) { out[q] = count; queue.push(q); }
        }
      }
      count++;
    }
    return out;
  }

  // Unordered adjacent label pairs, as [a, b] with a < b.
  function adjacency(labels, H, W) {
    const pairs = new Map();
    const add = (x, y) => { const a = Math.min(x, y), b = Math.max(x, y); pairs.set(a * 65536 + b, [a, b]); };
    for (let y = 0; y < H; y++) for (let x = 0; x + 1 < W; x++) if (labels[y * W + x] !== labels[y * W + x + 1]) add(labels[y * W + x], labels[y * W + x + 1]);
    for (let y = 0; y + 1 < H; y++) for (let x = 0; x < W; x++) if (labels[y * W + x] !== labels[(y + 1) * W + x]) add(labels[y * W + x], labels[(y + 1) * W + x]);
    return [...pairs.values()];
  }

  // Binary heap of tuples, popping the smallest in Python's tuple order.
  class Heap {
    constructor() { this.items = []; }
    push(item) {
      const a = this.items;
      a.push(item);
      let i = a.length - 1;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (np.compareTuples(a[i], a[parent]) >= 0) break;
        [a[i], a[parent]] = [a[parent], a[i]]; i = parent;
      }
    }
    pop() {
      const a = this.items, top = a[0], last = a.pop();
      if (a.length) {
        a[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < a.length && np.compareTuples(a[l], a[m]) < 0) m = l;
          if (r < a.length && np.compareTuples(a[r], a[m]) < 0) m = r;
          if (m === i) break;
          [a[i], a[m]] = [a[m], a[i]]; i = m;
        }
      }
      return top;
    }
    get size() { return this.items.length; }
  }

  // Greedily merge adjacent regions, most similar qualifying pair first; shouldMerge(areaA, areaB, deltaE).
  function merge(labels, H, W, lab, shouldMerge) {
    let n = 0;
    for (const v of labels) if (v + 1 > n) n = v + 1;
    const area = new Array(n).fill(0), total = Array.from({length: n}, () => [0, 0, 0]);
    for (let i = 0; i < H * W; i++) {
      const r = labels[i];
      area[r] += 1;
      total[r][0] += lab[i * 3]; total[r][1] += lab[i * 3 + 1]; total[r][2] += lab[i * 3 + 2];
    }
    const neighbours = Array.from({length: n}, () => new Set());
    for (const [x, y] of adjacency(labels, H, W)) { neighbours[x].add(y); neighbours[y].add(x); }
    const version = new Array(n).fill(0), parent = Array.from({length: n}, (_, i) => i), heap = new Heap();
    const distance = (a, b) => np.dist(total[a].map(v => v / area[a]), total[b].map(v => v / area[b]));
    const offer = (a, b) => {
      const d = distance(a, b);
      if (shouldMerge(area[a], area[b], d)) {
        const lo = Math.min(a, b), hi = Math.max(a, b);
        heap.push([d, lo, hi, version[lo], version[hi]]);
      }
    };
    for (let a = 0; a < n; a++) for (const b of neighbours[a]) if (a < b) offer(a, b);
    while (heap.size) {
      const [, a, b, va, vb] = heap.pop();
      if (parent[a] !== a || parent[b] !== b || version[a] !== va || version[b] !== vb) continue;
      const [keep, gone] = np.compareTuples([area[a], -a], [area[b], -b]) >= 0 ? [a, b] : [b, a];
      parent[gone] = keep; area[keep] += area[gone];
      total[keep] = total[keep].map((x, c) => x + total[gone][c]);
      for (const other of neighbours[gone]) {
        neighbours[other].delete(gone);
        if (other !== keep) { neighbours[other].add(keep); neighbours[keep].add(other); }
      }
      neighbours[keep].delete(gone); neighbours[gone] = new Set();
      version[keep]++;
      for (const other of [...neighbours[keep]].sort((x, y) => x - y)) offer(keep, other);
    }
    const find = i => { while (parent[i] !== i) i = parent[i]; return i; };
    const roots = Int32Array.from({length: n}, (_, i) => find(i));
    return labels.map(v => roots[v]);
  }

  // Consecutive ids in order of first appearance.
  function relabel(labels) {
    const ids = new Map();
    return labels.map(v => { if (!ids.has(v)) ids.set(v, ids.size); return ids.get(v); });
  }

  const regionCount = labels => { let n = 0; for (const v of labels) if (v + 1 > n) n = v + 1; return n; };
  function members(labels, n) {
    const out = Array.from({length: n}, () => []);
    for (let i = 0; i < labels.length; i++) out[labels[i]].push(i);
    return out;
  }

  function describe(labels, H, W, rgb, lab) {
    const n = regionCount(labels);
    return members(labels, n).map((pixels, index) => {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, sx = 0, sy = 0;
      for (const p of pixels) {
        const y = Math.floor(p / W), x = p - y * W;
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); sx += x; sy += y;
      }
      const area = pixels.length, labStats = channelStats(lab, pixels);
      return {id: `seg-${index}`, index, area, areaRatio: area / (H * W),
        rect: {x: x0 / W, y: y0 / H, width: (x1 + 1 - x0) / W, height: (y1 + 1 - y0) / H},
        centroid: {x: (sx / area + .5) / W, y: (sy / area + .5) / H},
        meanRgb: channelStats(rgb, pixels).mean, meanLab: labStats.mean, spread: Math.sqrt(labStats.spread)};
    });
  }

  // Majority (mode) filter in a (2r+1)^2 window, keeping the pixel's own label on ties.
  function soften(labels, H, W, passes = 3, radius = 2) {
    const size = 2 * radius + 1, stack = new Int32Array(size * size + 1);
    for (let pass = 0; pass < passes; pass++) {
      const out = new Int32Array(H * W);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        stack[0] = labels[y * W + x];
        let k = 1;
        for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
          stack[k++] = labels[Math.min(H - 1, Math.max(0, y + dy)) * W + Math.min(W - 1, Math.max(0, x + dx))];
        }
        let best = -1, label = stack[0];
        for (let i = 0; i < stack.length; i++) {
          let c = 0;
          for (let j = 0; j < stack.length; j++) if (stack[j] === stack[i]) c++;
          if (c > best) { best = c; label = stack[i]; }
        }
        out[y * W + x] = label;
      }
      labels = out;
    }
    return labels;
  }

  // Boundary rings per region in half pixels (see segmentation.outlines).
  function outlines(labels, H, W, tolerance = .75) {
    const n = regionCount(labels), at = (y, x) => (y < 0 || y >= H || x < 0 || x >= W ? -1 : labels[y * W + x]);
    const edges = Array.from({length: n}, () => new Map());
    for (const [ny, nx, ax, ay, bx, by] of [[-1, 0, 0, 0, 1, 0], [0, 1, 1, 0, 1, 1], [1, 0, 1, 1, 0, 1], [0, -1, 0, 1, 0, 0]]) {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const r = labels[y * W + x], other = at(y + ny, x + nx);
        if (other === r) continue;
        const key = (y + ay) * (W + 1) + x + ax, table = edges[r];
        if (!table.has(key)) table.set(key, []);
        table.get(key).push([[x + bx, y + by], other === -1]);
      }
    }
    function simplify(points) {
      if (points.length < 3) return points;
      const keep = new Array(points.length).fill(false);
      keep[0] = keep[points.length - 1] = true;
      const stack = [[0, points.length - 1]];
      while (stack.length) {
        const [a, b] = stack.pop(), [x0, y0] = points[a], [x1, y1] = points[b], dx = x1 - x0, dy = y1 - y0;
        const norm = np.hypot(dx, dy) || 1;
        let best = 0, found = null;
        for (let k = a + 1; k < b; k++) {
          const d = norm > 1e-9 ? Math.abs(dy * (points[k][0] - x0) - dx * (points[k][1] - y0)) / norm : np.dist(points[k], points[a]);
          if (d > best) { best = d; found = k; }
        }
        if (found !== null && best > tolerance * 2) { keep[found] = true; stack.push([a, found], [found, b]); }
      }
      return points.filter((_, k) => keep[k]);
    }
    const flat = pts => pts.flat();
    return edges.map(table => {
      const rings = [];
      while (table.size) {
        const startKey = table.keys().next().value, start = [startKey % (W + 1), Math.floor(startKey / (W + 1))];
        const corners = [start], framed = [];
        let hereKey = startKey;
        for (;;) {
          const ends = table.get(hereKey), [next, f] = ends.pop();
          if (!ends.length) table.delete(hereKey);
          framed.push(f);
          if (next[0] === start[0] && next[1] === start[1]) break;
          corners.push(next); hereKey = next[1] * (W + 1) + next[0];
        }
        const count = corners.length;
        const mids = corners.map((c, k) => [c[0] + corners[(k + 1) % count][0], c[1] + corners[(k + 1) % count][1]]);
        const far = np.maxBy([...Array(count).keys()], k => [(mids[k][0] - mids[0][0]) ** 2 + (mids[k][1] - mids[0][1]) ** 2]);
        const ring = [...simplify(mids.slice(0, far + 1)), ...simplify([...mids.slice(far), mids[0]]).slice(1, -1)];
        let chains = null;
        if (framed.some(Boolean)) {
          const first = framed.indexOf(true), order = [...Array(count).keys()].map(k => (k + first) % count);
          chains = [];
          let run = [];
          for (const k of order) {
            if (framed[k]) { if (run.length > 1) chains.push(flat(simplify(run))); run = []; }
            else run.push(mids[k]);
          }
          if (run.length > 1) chains.push(flat(simplify(run)));
        }
        rings.push({p: flat(ring), open: chains});
      }
      return rings;
    });
  }

  function hullArea(points) {
    const seen = new Set(), pts = [];
    for (const p of points) { const key = p[0] * 1e6 + p[1]; if (!seen.has(key)) { seen.add(key); pts.push(p); } }
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (pts.length < 3) return 0;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
    for (const p of [...pts].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
    const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)];
    let s = 0;
    for (let i = 0; i < hull.length; i++) { const q = hull[(i - 1 + hull.length) % hull.length]; s += hull[i][0] * q[1] - q[0] * hull[i][1]; }
    return Math.abs(s) / 2;
  }

  // Outline features per region (see segmentation.shapes); boundary is a Uint8Array mask.
  function shapes(labels, H, W) {
    const {atan2, pow} = PM.libm, n = regionCount(labels), all = members(labels, n);
    const inside = (index, y, x) => y >= 0 && y < H && x >= 0 && x < W && labels[y * W + x] === index;
    return all.map((pixels, index) => {
      const area = pixels.length, xs = [], ys = [];
      let perimeter = 0;
      const boundary = new Uint8Array(H * W), corners = [];
      for (const p of pixels) {
        const y = Math.floor(p / W), x = p - y * W;
        xs.push(x); ys.push(y);
        const up = inside(index, y - 1, x), down = inside(index, y + 1, x), left = inside(index, y, x - 1), right = inside(index, y, x + 1);
        perimeter += !up + !down + !left + !right;
        if (!(up && down && left && right)) boundary[p] = 1;
      }
      // np.nonzero order: boundary pixels in scan order, each with its four corners.
      for (const p of pixels) if (boundary[p]) {
        const y = Math.floor(p / W), x = p - y * W;
        corners.push([x, y], [x, y + 1], [x + 1, y], [x + 1, y + 1]);
      }
      const compactness = Math.min(1, 4 * Math.PI * area / Math.max(perimeter, 1) ** 2 / (Math.PI / 4));
      let angle = 0, elongation = 0;
      if (area > 1) {
        const cx = np.mean(xs), cy = np.mean(ys), dx = Float64Array.from(xs, x => x - cx), dy = Float64Array.from(ys, y => y - cy);
        const sxx = np.mean(dx.map(v => v * v)) + 1 / 12, syy = np.mean(dy.map(v => v * v)) + 1 / 12, sxy = np.mean(dx.map((v, i) => v * dy[i]));
        angle = .5 * atan2(-2 * sxy, sxx - syy) * (180 / Math.PI);
        const spread = Math.sqrt(pow(sxx - syy, 2) + 4 * pow(sxy, 2));
        const major = (sxx + syy + spread) / 2, minor = Math.max((sxx + syy - spread) / 2, 1e-9);
        elongation = 1 - Math.sqrt(minor / major);
      }
      const solidity = Math.min(1, area / Math.max(hullArea(corners), 1));
      const tops = new Int32Array(W).fill(-1), bottoms = new Int32Array(W).fill(-1);
      for (const p of pixels) {
        const y = Math.floor(p / W), x = p - y * W;
        if (tops[x] < 0) tops[x] = y;
        bottoms[x] = y;
      }
      const columns = [];
      for (let x = 0; x < W; x++) if (tops[x] >= 0) columns.push(x);
      const hanging = np.mean(columns.map(x => (tops[x] === 0 ? 1 : 0))) > .5 && np.mean(columns.map(x => (bottoms[x] === H - 1 ? 1 : 0))) < .5;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < area; i++) { minX = Math.min(minX, xs[i]); maxX = Math.max(maxX, xs[i]); minY = Math.min(minY, ys[i]); maxY = Math.max(maxY, ys[i]); }
      return {perimeter, compactness, angle, elongation, solidity, edgeSide: hanging ? 'bottom' : 'top',
        profile: columns.map(x => [x, hanging ? bottoms[x] : tops[x]]),
        border: minX === 0 || minY === 0 || maxX === W - 1 || maxY === H - 1, boundary};
    });
  }

  // segment(rgb floats of the analysis image, h x w): labels and region records at the reduced size.
  function segment(rgb, h, w, method = 'grow', detail = .5, soft = false) {
    if (!METHODS.includes(method)) throw new Error('未知分割方式');
    const small = downsample(rgb, h, w), H = small.height, W = small.width;
    const lab = toLab(small.data);
    const source = method === 'grow' ? smooth(lab, H, W) : lab;
    let labels = {grow, quadtree, slic}[method](source, H, W, detail);
    if (method === 'slic') {
      const quarter = H * W / slicCount(detail) / 4;
      labels = merge(labels, H, W, lab, (a, b) => Math.min(a, b) < quarter);
      labels = merge(labels, H, W, lab, (a, b, d) => d < 2);
    }
    if (method === 'quadtree') {
      const similar = threshold(detail) * .5;
      labels = merge(labels, H, W, lab, (a, b, d) => d < similar);
    }
    labels = merge(labels, H, W, lab, (a, b) => Math.min(a, b) < MIN_AREA);
    if (soft) {
      labels = components(soften(labels, H, W), H, W);
      labels = merge(labels, H, W, lab, (a, b) => Math.min(a, b) < MIN_AREA);
    }
    labels = relabel(labels);
    return {version: VERSION, method, detail, soft, width: W, height: H, labels, regions: describe(labels, H, W, small.data, lab), small: small.data};
  }

  PM.segmentation = {VERSION, METHODS, METHOD_NAMES, downsample, toLab, smooth, threshold, grow, quadtree, slic, components, adjacency,
    merge, relabel, describe, soften, outlines, shapes, segment};
});
