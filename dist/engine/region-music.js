/* region_music.py: content-shaped regions played in order of salience, optionally with
 * their outlines as motifs, as main lines (lines) or as a scan line (sweep). */
(self.PixelMusicEngineModules = self.PixelMusicEngineModules || []).push(function (PM) {
  'use strict';
  const {np, analysis: A, composition: C, segmentation: S} = PM;
  const VERSION = 'region-salience-v1', MIN_SLOT = .25, MAX_HOLD = 4, GAZE_DISTANCE = 1.4, MOTIF_STEP = 10, MOTIF_NOTE = .5;
  const LANE_MOTIF = {2: [4, 2], 3: [4, 3, 2], 4: [4, 3, 3, 2]}, GRACE = .125;
  const STYLES = {motif: '起伏动机', grid: '量化取样 · 滑音', lines: '线条演奏', sweep: '扫描线 · 竖线与分界交点'};
  const GRID_STEP = {2: [.5, .5], 3: [.5, .5, 1], 4: [.5, .5, .5, 1]};
  const LINE_STEP = .5, LINE_SPAN = .25, LINE_PIECE = .06, LINE_NEAR = .3, LINE_BRIDGE = 4;
  const SWEEP_STEP = .5, SWEEP_MATCH = .035, SWEEP_HOLD = .6, SWEEP_BRIDGE = 2;
  const ORDERS = {gaze: '视线游走', tiers: '显著度分层', scan: '从左到右', path: '全图一条路径', salience: '纯显著度'};
  const ORDER_HINTS = {
    gaze: '每个声部从最显著的区域出发，每次走到附近最显著的下一个区域，像眼睛看画。',
    tiers: '每个声部把区域按显著度分成三层，最醒目的一层先从左到右走一遍，再走第二、第三层。',
    scan: '每个声部从左到右依次发声；越醒目的区域越响、越长。',
    path: '全图只有一条视线游走路径，当前区域在自己的声部发声，其他声部延续各自上一个音形成和声。',
    salience: '每个声部严格按显著度从高到低发声，不考虑位置。'};
  const SWEEP_HINT = '扫描线：一条竖线从左到右扫过整幅画，不分声部也不分行；竖线碰到的每一条区域分界线都发音，碰到几条就同时响几个音（只有落在同一个音阶音上的两个交点合成一个）。分界线越高音越高（三个八度，吸附到音阶）；沿同一条分界线走、高度变化不大时延长原音，扫过区域侧边换到新的分界、高度明显变化或到新的一小节时重新起音。分界两侧颜色差越大越响，分界下方区域的颜色决定音色（暖色暖键、黄色木琴、绿色和紫色拨弦、蓝色轻铃，低音区用柔低音）。"分行"在这种方式下不起作用。';
  const LINES_HINT = '线条演奏：选出画面里最长、最清晰的几条边缘作主线，主线断开处由附近高度的较短边缘接续，播放线从左到右扫过，横向位置是时间，边缘的高低是音高（三个八度，吸附到音阶），平缓的坡在音尾短暂滑音；不再按区域顺序发声。';
  const SIMPLE_LANES = {2: ['soft_piano', 'soft_bass'], 3: ['celesta', 'soft_piano', 'soft_bass'], 4: ['celesta', 'soft_piano', 'harp', 'soft_bass']};
  const KERNEL = [1 / 9, 2 / 9, 3 / 9, 2 / 9, 1 / 9];

  const pow = (x, y) => PM.libm.pow(x, y);
  const pyRoundInt = x => np.round(x);
  const last = list => list[list.length - 1];

  // np.convolve(np.pad(ys, 2, mode='edge'), KERNEL, mode='valid'), each output a sequential dot.
  function smoothProfile(ys) {
    if (ys.length < 5) return ys.slice();
    const p = [ys[0], ys[0], ...ys, last(ys), last(ys)];
    return ys.map((_, i) => { let s = 0; for (let k = 0; k < 5; k++) s += p[i + k] * KERNEL[4 - k]; return s; });
  }
  // np.linspace(0, n - 1, count).round().astype(int)
  const spread = (n, count) => Array.from(np.linspace(0, n - 1, count), v => np.round(v));

  // Beats per region, proportional to sqrt(area), at least `minimum`, summing to `total`.
  function slots(areas, total, minimum = MIN_SLOT) {
    const weights = areas.map(Math.sqrt), fixed = weights.map(() => false);
    let share;
    for (;;) {
      const free = total - minimum * fixed.filter(Boolean).length;
      const denominator = Math.max(np.sum(weights.filter((_, i) => !fixed[i])), 1e-12);
      share = weights.map((w, i) => (fixed[i] ? minimum : free * w / denominator));
      const newly = share.map((s, i) => s < minimum && !fixed[i]);
      if (!newly.some(Boolean)) break;
      newly.forEach((n, i) => { if (n) fixed[i] = true; });
    }
    let acc = 0, previous = 0;
    return share.map(s => { acc += s; const edge = np.round(acc / minimum) * minimum, out = edge - previous; previous = edge; return out; });
  }

  // Adjacent label pairs in CPython set order, and each region's neighbour set.
  function neighbourSets(labels, H, W, n) {
    const pairs = new np.PySet();
    const add = (x, y) => pairs.add(x < y ? [x, y] : [y, x]);
    for (let y = 0; y < H; y++) for (let x = 0; x + 1 < W; x++) if (labels[y * W + x] !== labels[y * W + x + 1]) add(labels[y * W + x], labels[y * W + x + 1]);
    for (let y = 0; y + 1 < H; y++) for (let x = 0; x < W; x++) if (labels[y * W + x] !== labels[(y + 1) * W + x]) add(labels[y * W + x], labels[(y + 1) * W + x]);
    const neighbours = Array.from({length: n}, () => new np.PySet());
    for (const [a, b] of pairs) { neighbours[a].add(b); neighbours[b].add(a); }
    return neighbours;
  }

  function labelsBase64(labels) {
    let binary = '';
    for (const v of labels) binary += String.fromCharCode(v & 255, v >> 8 & 255);
    return btoa(binary);
  }

  function build(result, info, options) {
    const count = Math.trunc(options.rowCount ?? 4), method = options.segmentMethod || 'grow', detail = Number(options.segmentDetail ?? .5);
    if (![2, 3, 4].includes(count)) throw new Error('声部数设置无效');
    const {maps, features} = result, soft = Boolean(options.segmentSoft ?? true);
    const seg = S.segment(maps.rgb, maps.height, maps.width, method, detail, soft), labels = seg.labels, parts = seg.regions;
    const H = seg.height, W = seg.width, rgb = seg.small;
    const shrink = map => S.downsample(map, maps.height, maps.width, 1).data;
    const lum = shrink(maps.luminance), saliency = shrink(maps.saliency_map), edge = shrink(maps.edge_map);
    const beat = 60 / info.tempo, bars = Math.max(1, Math.trunc(info.duration / (4 * beat) + 1e-6)), total = bars * 4;
    const root = PM.scores.rootNote(features), scaleSteps = C.SCALES[info.scale_name];
    const allowed = C.buildScaleNotes(root, scaleSteps, root + 10, root + 31);
    const {WEIGHTS, FEATURE_NAMES, OCTAVE_LAYOUT, SOFT_LAYOUT, OCTAVE_NAMES} = PM.scores, AR = PM.arranger;

    const neighbours = neighbourSets(labels, H, W, parts.length);
    const pixelsOf = Array.from({length: parts.length}, () => []);
    for (let p = 0; p < labels.length; p++) pixelsOf[labels[p]].push(p);
    const regions = [], sums = [], scores = [];
    for (const part of parts) {
      const index = part.index, pixels = pixelsOf[index], k = pixels.length;
      const light = Float64Array.from(pixels, p => lum[p]), colours = new Float64Array(k * 3);
      pixels.forEach((p, j) => { colours[j * 3] = rgb[p * 3]; colours[j * 3 + 1] = rgb[p * 3 + 1]; colours[j * 3 + 2] = rgb[p * 3 + 2]; });
      const hsv = A.hsvFeatures(A.contiguous(colours, k, 1, 3), light), edges = Float64Array.from(pixels, p => edge[p]);
      const texture = .5 * A.histogramEntropy(edges) + .5 * Math.min(1, np.mean(edges) * 4);
      const f = {brightness: np.mean(light), hue: hsv.dominant_hue, saturation: hsv.mean_saturation, contrast: np.std(light), texture,
        saliency: np.mean(Float64Array.from(pixels, p => saliency[p])), area: part.areaRatio};
      const vector = [f.brightness, .5 + (f.hue - .5) * f.saturation, f.saturation, Math.min(1, f.contrast * 3), f.texture];
      const near = [...neighbours[index]].map(n => np.dist(part.meanLab, parts[n].meanLab));
      const contrastToNeighbours = near.length ? np.mean(near) : 0;
      f.edgeContrast = contrastToNeighbours;
      scores.push(.55 * f.saliency + .3 * Math.min(1, contrastToNeighbours / 40) + .15 * Math.sqrt(part.areaRatio));
      sums.push(np.sum(vector.map((v, i) => v * WEIGHTS[i])));
      const lane = Math.min(count - 1, Math.trunc(part.centroid.y * count));
      regions.push({id: part.id, index, row: lane, col: 0, rowId: `row-${lane}`, rect: part.rect, centroid: part.centroid, start: 0, end: 0,
        features: f, contributions: Object.fromEntries(FEATURE_NAMES.map((name, i) => [name, vector[i] * WEIGHTS[i]])),
        targetMidi: null, midi: null, eventId: null, reason: '',
        color: '#' + part.meanRgb.slice(0, 3).map(c => np.round(255 * Math.min(1, Math.max(0, c))).toString(16).padStart(2, '0')).join('')});
    }
    const contour = Boolean(options.contourMusic ?? false), style = contour ? options.contourStyle || 'motif' : 'motif';
    if (!STYLES[style]) throw new Error('未知轮廓演奏方式');
    const outlines = contour ? S.shapes(labels, H, W) : null, contained = new Map();
    let concave = 0;
    if (contour) {
      const sharp = outlines.map(o => {
        const values = [];
        for (let p = 0; p < o.boundary.length; p++) if (o.boundary[p]) values.push(edge[p]);
        return values.length ? np.mean(values) : 0;
      });
      const sharpRank = AR.normalize(sharp, .02);
      concave = Math.min(.7, np.percentile(outlines.map(o => o.solidity), 8));
      regions.forEach((region, i) => {
        const o = outlines[i];
        Object.assign(region.features, {compactness: o.compactness, angle: o.angle, elongation: o.elongation, solidity: o.solidity, edgeSharpness: sharpRank[i]});
        const pts = o.profile;
        region.contour = spread(pts.length, Math.min(pts.length, 32)).map(k => [(pts[k][0] + .5) / W, (pts[k][1] + .5) / H]);
        if (neighbours[i].size === 1 && !o.border) contained.set(i, [...neighbours[i]][0]);
      });
    }
    for (const [i, outer] of contained) regions[i].containedBy = regions[outer].id;
    const positions = AR.normalize(sums), scoreRank = AR.normalize(scores, .05);
    const order = np.sortBy([...regions.keys()], i => [-scores[i], i]);
    order.forEach((i, rank) => { regions[i].salienceRank = rank + 1; });

    const orderName = options.segmentOrder || 'gaze';
    if (!ORDERS[orderName]) throw new Error('未知演奏顺序');
    const aspect = H / W, where = i => [regions[i].centroid.x, regions[i].centroid.y * aspect];

    function sequence(members, how) {
      if (how === 'salience') return np.sortBy(members, i => [-scores[i], i]);
      if (how === 'scan') return np.sortBy(members, i => [...where(i), i]);
      if (how === 'tiers') {
        const ranked = np.sortBy(members, i => [-scores[i], i]), tier = new Map();
        ranked.forEach((i, k) => tier.set(i, Math.min(2, Math.floor(k * 3 / Math.max(1, ranked.length)))));
        return np.sortBy(members, i => [tier.get(i), ...where(i), i]);
      }
      const left = new Set(members), path = [];
      let current = left.size ? np.maxBy([...left], i => [scores[i], -i]) : null;
      while (current !== null) {
        path.push(current); left.delete(current);
        if (!left.size) break;
        const here = where(current);
        current = np.maxBy([...left], j => [scoreRank[j] - GAZE_DISTANCE * np.dist(here, where(j)), -j]);
      }
      return path;
    }

    const grid = contour ? MOTIF_NOTE : MIN_SLOT;
    const keep = members => {
      const capacity = Math.trunc(total / grid), ranked = np.sortBy(members, i => [-scores[i], i]);
      return [ranked.slice(0, capacity), ranked.slice(capacity)];
    };
    const weights = seq => seq.map(i => regions[i].features.area * (orderName === 'scan' ? pow(.5 + scoreRank[i], 2) : 1));

    function contourFigure(i, start, length, sounding, midi, velocity, base, lift) {
      const f = regions[i].features, o = outlines[i], row = regions[i].row;
      const xs = o.profile.map(([x]) => x), ys = smoothProfile(o.profile.map(([, y]) => y));
      const height = Math.max(4, regions[i].rect.height * H), home = allowed.indexOf(midi);
      const side = o.edgeSide === 'bottom' ? '下边缘' : '上边缘', bends = new Map();
      let pitches, pickAt, bounds, how, countNotes;
      if (style === 'grid') {
        const step = GRID_STEP[count][row], cells = Math.max(1, pyRoundInt(length / step));
        const cut = Array.from(np.linspace(0, ys.length, cells + 1), Math.trunc);
        const level = [];
        for (let k = 0; k < cells; k++) level.push(np.mean(ys.slice(cut[k], Math.max(cut[k + 1], cut[k] + 1))));
        const mean = np.mean(ys), raw = level.map(l => (mean - l) / height * 5);
        let runs = [], current = null;
        raw.forEach((r, k) => {
          if (current === null) current = Math.trunc(np.clip(np.round(r), -4, 4));
          else if (Math.abs(r - current) > 1.25) current = Math.trunc(np.clip(np.round(r), current - 2, current + 2));
          if (runs.length && last(runs)[0] === current) last(runs)[2] = k + 1;
          else runs.push([current, k, k + 1]);
        });
        const shortest = Math.max(1, pyRoundInt(1 / step)), cap = 2 * LANE_MOTIF[count][row];
        while (runs.length > 1) {
          const k = np.minBy([...runs.keys()], k => [runs[k][2] - runs[k][1], k]);
          if (runs[k][2] - runs[k][1] >= shortest && runs.length <= cap) break;
          const near = [k - 1, k + 1].filter(j => j >= 0 && j < runs.length);
          const j = np.minBy(near, j => [Math.abs(runs[j][0] - runs[k][0]), j]);
          runs[j][1] = Math.min(runs[j][1], runs[k][1]); runs[j][2] = Math.max(runs[j][2], runs[k][2]);
          runs.splice(k, 1);
          const merged = [runs[0]];
          for (const run of runs.slice(1)) { if (run[0] === last(merged)[0]) last(merged)[2] = run[2]; else merged.push(run); }
          runs = merged;
        }
        countNotes = runs.length;
        pitches = runs.map(([d]) => allowed[Math.trunc(np.clip(home + d, 0, allowed.length - 1))]);
        pickAt = runs.map(([, a, b]) => Math.trunc(Math.min(ys.length - 1, Math.floor((cut[a] + cut[b] - 1) / 2))));
        bounds = [...runs.map(([, a]) => start + a * step), start + length];
        for (let k = 0; k < countNotes - 1; k++) {
          if (Math.abs(allowed.indexOf(pitches[k + 1]) - allowed.indexOf(pitches[k])) === 1 && Math.abs(pitches[k + 1] - pitches[k]) <= 2) bends.set(k, pitches[k + 1] - pitches[k]);
        }
        how = [countNotes > 1 ? `${side}按${step < 1 ? '八分' : '四分'}音符格逐格取高度，成 ${countNotes} 个音` : `${side}平缓，一个长音`];
        if (bends.size) how.push(`平缓处滑音 ${bends.size} 处`);
      } else {
        const variation = ys.length > 1 ? np.sum(ys.slice(1).map((y, k) => Math.abs(y - ys[k]))) : 0;
        countNotes = Math.trunc(np.clip(1 + np.round(variation / MOTIF_STEP), 1, LANE_MOTIF[count][row]));
        countNotes = Math.max(1, Math.min(countNotes, pyRoundInt(length / MOTIF_NOTE)));
        pickAt = [...Array(countNotes).keys()].map(k => pyRoundInt((k + .5) / countNotes * (ys.length - 1)));
        const mean = np.mean(ys), raw = pickAt.map(p => Math.trunc(np.clip(np.round((mean - ys[p]) / height * 4), -3, 3)));
        const degrees = [];
        for (const d of raw) degrees.push(degrees.length ? Math.trunc(np.clip(d, last(degrees) - 2, last(degrees) + 2)) : d);
        pitches = degrees.map(d => allowed[Math.trunc(np.clip(home + d, 0, allowed.length - 1))]);
        bounds = [...[...Array(countNotes).keys()].map(k => start + pyRoundInt(k * length / countNotes / MOTIF_NOTE) * MOTIF_NOTE), start + length];
        how = [countNotes > 1 ? `${side}起伏成 ${countNotes} 个音的动机` : `${side}平缓，一个音`];
      }
      const c = f.compactness, e = f.elongation, angle = f.angle, horizontal = e > .6 && Math.abs(angle) < 20;
      const factor = horizontal ? .98 : .72 + .26 * c, tone = .7 + .6 * (1 - c), attack = pow(2, 1.5 - 3 * f.edgeSharpness);
      const notes = [];
      how.push(factor > .9 ? '轮廓圆润，连奏' : '轮廓尖锐，轻断奏', attack < 1 ? '边缘清晰，起音干脆' : '边缘柔和，缓慢起音');
      if (f.solidity <= concave && bounds[1] - bounds[0] >= 1) {
        const grace = lift(allowed[Math.min(home + 1, allowed.length - 1)]);
        notes.push({...base, start: start * beat, duration: GRACE * .9 * beat, midi: grace, velocity: velocity * .75, grace: true,
          toneScale: tone, attackScale: Math.min(attack, 1), point: regions[i].contour[0]});
        how.push('形状内凹，加倚音');
      }
      pitches.forEach((pitch, k) => {
        const begin = bounds[k] + (k === 0 && notes.length ? GRACE : 0), end = bounds[k + 1];
        let hold = !bends.has(k) ? (end - begin) - (1 - factor) * Math.min(end - begin, 1.5) : end - begin;
        if (k === countNotes - 1 && orderName === 'path') hold = Math.max(hold, start + sounding - begin);
        const x = (xs[pickAt[k]] + .5) / W, y = (ys[pickAt[k]] + .5) / H;
        notes.push({...base, start: begin * beat, duration: Math.max(.05, hold * .97) * beat, midi: lift(pitch),
          velocity: np.clip(velocity + .05 * f.edgeSharpness - (k ? .04 : 0), .3, .9), toneScale: tone, attackScale: attack, point: [x, y]});
        if (bends.has(k)) last(notes).bend = bends.get(k);
      });
      if (style !== 'grid' && e > .55 && Math.abs(angle) >= 20 && Math.abs(angle) <= 70 && bounds[bounds.length - 1] - bounds[bounds.length - 2] >= 1) {
        const direction = angle > 0 ? 1 : -1, lastIndex = allowed.indexOf(last(pitches));
        const goal = allowed[Math.trunc(np.clip(lastIndex + direction, 0, allowed.length - 1))];
        if (Math.abs(goal - last(pitches)) > 0 && Math.abs(goal - last(pitches)) <= 2) {
          last(notes).bend = goal - last(pitches);
          how.push('斜向伸展，向' + (direction > 0 ? '上' : '下') + '滑音');
        }
      } else if (horizontal) how.push('横向舒展，长音');
      if (contained.has(i)) how.push('被外层区域包围，外层给出持续低音');
      return [notes, how.join('；')];
    }

    let lanes = [...Array(count).keys()].map(lane => ({offset: OCTAVE_LAYOUT[count][lane], previous: null, events: [], instrument: SIMPLE_LANES[count][lane], last: null}));

    function playLines() {
      const spanScale = C.buildScaleNotes(root, scaleSteps, root - 7, root + 29), pieces = [];
      outlines.forEach((o, i) => {
        const limit = o.edgeSide === 'bottom' ? H - 1 : 0, pts = o.profile.filter(([, y]) => y !== limit);
        if (pts.length < LINE_PIECE * W) return;
        const ys = smoothProfile(pts.map(([, y]) => y)), f = regions[i].features;
        const weight = pts.length / W * (.4 + .6 * f.edgeSharpness) * (.5 + .5 * Math.min(1, f.edgeContrast / 40));
        pieces.push([weight, i, new Map(pts.map(([x], k) => [x, ys[k]]))]);
      });
      const sorted = np.sortBy(pieces, c => [-c[0], c[1]]), accepted = [];
      for (const piece of sorted) {
        const line = piece[2], lineSet = new np.PySet([...line.keys()]);
        const duplicate = accepted.some(([, , other]) => {
          const shared = np.pyIntersection(lineSet, new np.PySet([...other.keys()]));
          return shared.size > .5 * Math.min(line.size, other.size) && np.mean([...shared].map(x => Math.abs(line.get(x) - other.get(x)))) <= 3;
        });
        if (!duplicate) accepted.push(piece);
      }
      let primary = accepted.filter(c => c[2].size >= LINE_SPAN * W).slice(0, count);
      if (!primary.length) {
        const i = order[0], y = Math.trunc(regions[i].centroid.y * (H - 1));
        primary = [[0, i, new Map([...Array(W).keys()].map(x => [x, y]))]];
      }
      primary = np.sortBy(primary, c => [np.mean([...c[2].values()]), c[1]]);
      const tracks = primary.map(([, i, line]) => new Map([...line].map(([x, y]) => [x, [y, i]])));
      const primaryIds = new Set(primary.map(c => c[1]));
      for (const [, i, line] of accepted) {
        if (primaryIds.has(i)) continue;
        let best = null;
        tracks.forEach((track, k) => {
          const free = [...line.keys()].filter(x => !track.has(x));
          if (free.length < LINE_PIECE * W / 2) return;
          const near = Math.abs(np.mean(free.map(x => line.get(x))) - np.mean([...track.values()].map(([y]) => y))) / H;
          if (near <= LINE_NEAR && (best === null || free.length * (1 - near) > best[0])) best = [free.length * (1 - near), k, free];
        });
        if (best) for (const x of best[2]) tracks[best[1]].set(x, [line.get(x), i]);
      }
      const cells = pyRoundInt(total / LINE_STEP), cut = Array.from(np.linspace(0, W, cells + 1), v => np.round(v));
      tracks.forEach((track, laneIndex) => {
        const lane = lanes[laneIndex], runs = [];
        let current = null;
        for (let k = 0; k < cells; k++) {
          const inside = [];
          for (let x = cut[k]; x < Math.max(cut[k + 1], cut[k] + 1); x++) if (track.has(x)) inside.push(track.get(x));
          if (inside.length * 2 < Math.max(1, cut[k + 1] - cut[k])) { current = null; continue; }
          const owner = np.maxBy([...new Set(inside.map(([, i]) => i))], i => [inside.filter(([, j]) => j === i).length, -i]);
          const level = (1 - np.mean(inside.filter(([, j]) => j === owner).map(([y]) => y)) / (H - 1)) * (spanScale.length - 1);
          if (runs.length && last(runs)[4] !== owner) current = null;
          if (current === null || Math.abs(level - current) > .6) current = pyRoundInt(level);
          if (runs.length && last(runs)[0] === current && last(runs)[4] === owner && last(runs)[2] === k && (k * LINE_STEP) % 4) last(runs)[2] = k + 1;
          else runs.push([current, k, k + 1, Math.floor((cut[k] + cut[k + 1]) / 2), owner]);
        }
        for (let k = 0; k + 1 < runs.length; k++) if (runs[k + 1][1] - runs[k][2] <= LINE_BRIDGE) runs[k][2] = runs[k + 1][1];
        runs.forEach(([index, a, b, column, i], k) => {
          const region = regions[i], f = region.features;
          let pitch = spanScale[index];
          while (pitch < 36) pitch += 12;
          const nearestX = np.minBy([...track.keys()], x => [track.get(x)[1] !== i ? 1 : 0, Math.abs(x - column)]);
          const y = (track.get(nearestX)[0] + .5) / H, velocity = np.clip(.45 + .35 * scoreRank[i], .3, .85);
          const note = {instrument: lane.instrument, pan: -.4 + .8 * laneIndex / Math.max(1, count - 1), layer: 'main', rowId: `row-${laneIndex}`,
            row: laneIndex, voicePreset: SOFT_LAYOUT[count][laneIndex], coverageEnd: b * LINE_STEP * beat, step: k,
            sources: [{regionId: region.id, rect: region.rect}], start: a * LINE_STEP * beat, duration: (b - a) * LINE_STEP * beat * .96, midi: pitch,
            velocity: k === 0 || runs[k - 1][2] !== a ? velocity : velocity - .04, toneScale: .8 + .4 * f.saturation,
            attackScale: Math.min(1.5, pow(2, 1.5 - 3 * f.edgeSharpness)), point: [(column + .5) / W, y], id: `row-${laneIndex}-note-${k}`};
          const following = runs[k + 1];
          if (following && following[1] === b && following[4] === i && Math.abs(following[0] - index) === 1 && Math.abs(spanScale[following[0]] - spanScale[index]) <= 2) {
            note.bend = spanScale[following[0]] - spanScale[index]; note.duration = (b - a) * LINE_STEP * beat;
          }
          lane.events.push(note);
        });
        for (const i of new Set(runs.map(r => r[4]))) {
          const region = regions[i], own = lane.events.filter(n => n.sources[0].regionId === region.id);
          const pts = [...track].filter(([, [, j]]) => j === i).map(([x, [y]]) => [x, y]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
          region.contour = spread(pts.length, Math.min(pts.length, 64)).map(k => [(pts[k][0] + .5) / W, (pts[k][1] + .5) / H]);
          Object.assign(region, {row: laneIndex, rowId: `row-${laneIndex}`, col: laneIndex, start: own[0].start, end: last(own).start + last(own).duration,
            midi: own[0].midi, eventId: own[0].id, targetMidi: own[0].midi,
            reason: `第 ${laneIndex + 1} 声部的${primaryIds.has(i) ? '主线' : '接续线'}（${outlines[i].edgeSide === 'bottom' ? '下' : '上'}边缘，`
              + `横跨画面 ${np.round(100 * pts.length / W)} %）：播放线扫到哪里就读哪里的高度，越高音越高；${own.length} 个音，滑音 ${own.filter(n => n.bend).length} 处`});
        }
      });
      const heard = new Set(lanes.flatMap(lane => lane.events.map(n => n.sources[0].regionId)));
      for (const region of regions) if (!heard.has(region.id)) region.reason = `显著度第 ${region.salienceRank} 位；线条演奏只读几条主要边缘，这个区域的边缘没有入选`;
    }

    function timbre(f, pitch) {
      if (pitch < 48) return ['低音区', 4, 'soft_bass', 32];
      if (f.saturation < .15) return ['灰色', 0, 'soft_piano', 0];
      const h = f.hue;
      if (h < .10 || h >= .92) return ['暖色', 0, 'soft_piano', 0];
      if (h < .20) return ['黄色', 2, 'marimba', 12];
      if (h < .45) return ['绿色', 1, 'harp', 46];
      if (h < .72) return ['蓝色', 3, 'celesta', 8];
      return ['紫色', 1, 'kalimba', 108];
    }

    function playSweep() {
      const spanScale = C.buildScaleNotes(root, scaleSteps, root - 7, root + 29), cells = pyRoundInt(total / SWEEP_STEP);
      const cut = Array.from(np.linspace(0, W, cells + 1), v => np.round(v)), lab = parts.map(p => p.meanLab);
      const gap = Math.max(2, pyRoundInt(SWEEP_MATCH * H)), levelOf = y => (1 - y / (H - 1)) * (spanScale.length - 1);
      const strengthOf = (a, b) => { let s = 0; for (let c = 0; c < 3; c++) { const d = lab[a][c] - lab[b][c]; s += d * d; } return Math.sqrt(s); };
      const clipLevel = level => Math.trunc(np.clip(level, 0, spanScale.length - 1));
      function crossings(x) {
        const kept = new Map();
        for (let y = 0; y + 1 < H; y++) {
          const a = labels[y * W + x], b = labels[(y + 1) * W + x];
          if (a === b) continue;
          const c = [y, a, b, strengthOf(a, b)], step = pyRoundInt(levelOf(y));
          if (!kept.has(step) || c[3] > kept.get(step)[3]) kept.set(step, c);
        }
        return np.sortBy([...kept.values()], c => c);
      }
      let threads = [], finished = [], made = 0;
      for (let k = 0; k < cells; k++) {
        const x = Math.min(W - 1, Math.floor((cut[k] + cut[k + 1]) / 2)), point = y => [(x + .5) / W, (y + .5) / H];
        const taken = new Set();
        for (const [y, a, b, strength] of crossings(x)) {
          const near = threads.filter(t => !taken.has(t) && Math.abs(t.y - y) <= gap);
          let t = near.length ? np.minBy(near, t => [Math.abs(t.y - y)]) : null;
          const level = levelOf(y);
          if (t !== null) {
            taken.add(t); t.y = y;
            const restrike = ((k * SWEEP_STEP) % 4 === 0 && t.first < k) || t.upper !== a || t.region !== b;
            if (Math.abs(level - t.level) <= SWEEP_HOLD && !restrike) { t.end = k + 1; t.path.push(point(y)); continue; }
            finished.push({...t});
            const same = Math.abs(level - t.level) <= SWEEP_HOLD;
            const startPoint = t.end === k && Math.abs(last(t.path)[1] - (y + .5) / H) <= 2 * SWEEP_MATCH ? last(t.path) : [cut[k] / W, (y + .5) / H];
            Object.assign(t, {level: same ? t.level : pyRoundInt(level), first: k, end: k + 1, region: b, upper: a, strength, path: [startPoint, point(y)]});
          } else {
            t = {thread: made, y, level: pyRoundInt(level), first: k, end: k + 1, region: b, upper: a, strength, path: [[cut[k] / W, (y + .5) / H], point(y)]};
            made++; threads.push(t); taken.add(t);
          }
        }
        for (const t of threads.filter(t => !taken.has(t) && k + 1 - t.end >= SWEEP_BRIDGE)) { finished.push(t); threads = threads.filter(u => u !== t); }
      }
      finished.push(...threads);
      if (!finished.length) {
        const i = order[0], y = regions[i].centroid.y * (H - 1);
        finished.push({thread: 0, level: pyRoundInt(levelOf(y)), first: 0, end: cells, region: i, upper: i, strength: 0, path: [[0, (y + .5) / H], [1, (y + .5) / H]]});
      }
      const notes = [], byThread = new Map();
      for (const t of np.sortBy(finished, t => [t.thread, t.first])) { if (!byThread.has(t.thread)) byThread.set(t.thread, []); byThread.get(t.thread).push(t); }
      for (const runs of byThread.values()) {
        const merged = [];
        for (const run of runs) {
          const m = last(merged);
          if (m && run.end - run.first < 2 && m.end === run.first && run.upper === m.upper && run.region === m.region) {
            m.end = run.end;
            const height = last(m.path)[1];
            m.path = [...m.path, ...run.path.slice(1).map(([px]) => [px, height])];
          } else merged.push(run);
        }
        merged.forEach((run, k) => {
          const following = merged[k + 1];
          const end = following && following.first - run.end < SWEEP_BRIDGE ? following.first : run.end;
          const i = run.region, f = regions[i].features;
          let pitch = spanScale[clipLevel(run.level)];
          while (pitch < 36) pitch += 12;
          const [family, preset, simple] = timbre(f, pitch);
          const note = {instrument: simple, pan: np.clip(regions[i].centroid.x * .8 - .4, -.4, .4), layer: 'main', rowId: 'row-0', row: 0,
            voicePreset: preset, timbre: family, coverageEnd: end * SWEEP_STEP * beat, step: notes.length,
            sources: [{regionId: regions[i].id, rect: regions[i].rect}], start: run.first * SWEEP_STEP * beat,
            duration: (end - run.first) * SWEEP_STEP * beat * .96, midi: pitch, velocity: np.clip(.32 + .5 * Math.min(1, run.strength / 50), .3, .85),
            toneScale: .7 + .6 * f.saturation * Math.min(1, .4 + f.brightness),
            attackScale: Math.min(1.5, pow(2, 1.5 - 3 * (f.edgeSharpness ?? .5))), point: run.path[1],
            path: run.path.map(([px, py]) => [np.pyRound(px, 4), np.pyRound(py, 4)]), color: regions[i].color, upperColor: regions[run.upper].color};
          if (following && following.first === end && Math.abs(following.level - run.level) === 1) {
            const step = spanScale[clipLevel(following.level)] - spanScale[clipLevel(run.level)];
            if (Math.abs(step) <= 2) { note.bend = step; note.duration = (end - run.first) * SWEEP_STEP * beat; }
          }
          notes.push(note);
        });
      }
      const sortedNotes = np.sortBy(notes, n => [n.start, -n.midi]);
      sortedNotes.forEach((note, n) => { note.id = `row-0-note-${n}`; });
      lanes[0].events = sortedNotes;
      for (const lane of lanes.slice(1)) lane.events = [];
      for (const region of regions) {
        const own = sortedNotes.filter(n => n.sources[0].regionId === region.id);
        if (!own.length) { region.reason = `显著度第 ${region.salienceRank} 位；扫描线没有在这个区域的上边界取到音（分界不够明显，或被附近更清晰的分界代替）`; continue; }
        Object.assign(region, {row: 0, rowId: 'row-0', start: own[0].start, end: Math.max(...own.map(n => n.start + n.duration)), midi: own[0].midi,
          targetMidi: own[0].midi, eventId: own[0].id,
          reason: `显著度第 ${region.salienceRank} 位；扫描线经过这个区域的上边界 ${own.length} 次，边界越高音越高；`
            + `区域是${own[0].timbre}，用${PM.softMixer.VOICES[own[0].voicePreset].name}的音色`});
      }
    }

    let plan = [], skipped = [];
    const schedule = seq => {
      const lengths = slots(weights(seq), total, grid);
      let at = 0;
      return seq.map((i, k) => { const item = [i, at, lengths[k]]; at += lengths[k]; return item; });
    };
    if (style === 'lines') { contained.clear(); playLines(); }
    else if (style === 'sweep') { contained.clear(); playSweep(); }
    else if (orderName === 'path') {
      const [kept, dropped] = keep([...regions.keys()]);
      skipped = dropped;
      const seq = sequence(kept.slice().sort((a, b) => a - b), 'gaze');
      if (seq.length) plan = schedule(seq);
    } else {
      for (let lane = 0; lane < count; lane++) {
        const [kept, dropped] = keep([...regions.keys()].filter(i => regions[i].row === lane));
        skipped.push(...dropped);
        const seq = sequence(kept.slice().sort((a, b) => a - b), orderName);
        if (seq.length) plan.push(...schedule(seq));
      }
    }
    plan = np.sortBy(plan, ([i, start]) => [start, regions[i].row]);
    const following = new Map();
    if (orderName === 'path') {
      const lastOf = new Map();
      for (const [i, start] of plan) {
        const lane = regions[i].row;
        if (lastOf.has(lane)) following.set(lastOf.get(lane), start);
        lastOf.set(lane, i);
      }
    }
    plan.forEach(([i, start, length], step) => {
      const region = regions[i], f = region.features, lane = lanes[region.row];
      let sounding = length;
      if (orderName === 'path') sounding = Math.min(Math.max(MAX_HOLD, length), (following.has(i) ? following.get(i) : total) - start);
      Object.assign(region, {col: step, start: start * beat, end: (start + length) * beat});
      const target = allowed[np.round(positions[i] * (allowed.length - 1))];
      region.targetMidi = target + lane.offset;
      const position = orderName === 'path' ? `按${ORDERS[orderName]}第 ${step + 1} 个` : `按${ORDERS[orderName]}本声部第 ${lane.events.length + 1} 个`;
      if (f.brightness < .03) {
        region.reason = `显著度第 ${region.salienceRank} 位；${position}；暗区休止`;
        lane.previous = null; lane.last = null; return;
      }
      let candidates = allowed.filter(n => np.mod(n, 12) === np.mod(target, 12));
      if (!candidates.length) candidates = [target];
      const previous = lane.previous;
      const midi = np.minBy(candidates, n => [previous !== null ? Math.abs(n - previous) : Math.abs(n - target), n]);
      lane.previous = midi;
      const row = region.row, lift = n => { n += lane.offset; while (n < 31) n += 12; return n; };
      const played = lift(midi);
      const base = {instrument: lane.instrument, pan: -.4 + .8 * row / Math.max(1, count - 1), layer: 'main', rowId: `row-${row}`, row,
        voicePreset: SOFT_LAYOUT[count][row], coverageEnd: (start + length) * beat, step, sources: [{regionId: region.id, rect: region.rect}]};
      const velocity = np.clip(.42 + .4 * scoreRank[i], .3, .85);
      let figure, how;
      if (!contour) {
        figure = [{...base, start: start * beat, duration: sounding * beat * .96, midi: played, velocity}];
        how = '区域颜色、明暗、对比与纹理决定音名，面积决定时值';
      } else [figure, how] = contourFigure(i, start, length, sounding, midi, velocity, base, lift);
      figure.forEach((note, k) => { note.id = `row-${row}-note-${lane.events.length + k}`; });
      if (contour && orderName !== 'path' && lane.last !== null && neighbours[i].has(lane.last) && lane.events.length) {
        const tail = last(lane.events);
        tail.duration = Math.max(tail.duration, figure[0].start - tail.start);
        how += '；与上一个相邻区域连奏衔接';
      }
      lane.last = i;
      const lead = figure.find(n => !n.grace);
      Object.assign(region, {midi: played, eventId: lead.id, reason: `显著度第 ${region.salienceRank} 位；${position}发声；${how}`});
      lane.events.push(...figure);
    });
    for (const i of skipped) regions[i].reason = `显著度第 ${regions[i].salienceRank} 位；区域过多，较不显著的区域未单独发声`;
    let pedal = [];
    if (contour) {
      const indexOf = new Map(regions.map(r => [r.id, r.index]));
      const notes = np.sortBy(lanes.flatMap(lane => lane.events), n => [n.start]);
      for (const note of notes) {
        const outer = contained.get(indexOf.get(note.sources[0].regionId));
        if (outer === undefined) continue;
        const pc = np.mod(allowed[np.round(positions[outer] * (allowed.length - 1))], 12), pitch = 48 + np.mod(pc - 48, 12);
        const begin = note.start, end = note.start + note.duration;
        const same = pedal.filter(q => q.midi === pitch && begin <= q.start + q.duration + 1e-6);
        if (same.length) last(same).duration = Math.max(last(same).duration, end - last(same).start);
        else pedal.push({start: begin, duration: end - begin, midi: pitch, velocity: .34, instrument: 'warm_pad', pan: 0, layer: 'bass'});
      }
      pedal = np.sortBy(pedal, e => [e.start]);
    }
    let events = [];
    const voices = [];
    if (style === 'sweep') {
      events = [...lanes[0].events];
      voices.push({id: 'row-0', row: 0, name: '扫描线 · 每个交点一个音', instrument: lanes[0].instrument, instrumentName: '按区域颜色换音色',
        softName: '按区域颜色换音色', rect: {x: 0, y: 0, width: 1, height: 1}, noteCount: events.length, fixedMidi: true, voicePreset: 0});
      lanes = [];
    }
    lanes.forEach((lane, row) => {
      events.push(...lane.events);
      voices.push({id: `row-${row}`, row, name: `第 ${row + 1} 声部 · ${OCTAVE_NAMES[count][row]}`, instrument: lane.instrument,
        instrumentName: C.instrumentLabel(lane.instrument), rect: {x: 0, y: row / count, width: 1, height: 1 / count}, noteCount: lane.events.length,
        fixedMidi: true, voicePreset: SOFT_LAYOUT[count][row]});
    });
    events = np.sortBy(events, e => [e.start, e.row, e.midi]);
    const meta = {version: VERSION, segmentation: S.VERSION, method, methodName: S.METHOD_NAMES[method], detail, width: W, height: H,
      regionCount: regions.length, order: orderName, orderName: ORDERS[orderName],
      orderHint: style === 'lines' ? LINES_HINT : style === 'sweep' ? SWEEP_HINT : ORDER_HINTS[orderName], sweepSeconds: total * beat, contour,
      contourStyle: style, contourStyleName: STYLES[style], pedal, soft, outlines: soft ? S.outlines(labels, H, W) : null, labels: labelsBase64(labels)};
    return [events, regions, regions.length, voices.length, voices, meta];
  }

  PM.regionMusic = {VERSION, slots, build};
});
