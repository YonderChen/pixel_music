"""Content-shaped regions played in order of salience.

The image is segmented (region growing, quadtree or SLIC). Each region's vertical
centroid picks a voice band (upper regions sound higher). The order inside a band
is selectable (an eye-like walk by default); a larger region holds a longer note.
Pitch comes from the region's own colour, brightness, contrast and texture.
"""
import base64
import math
import numpy as np

import segmentation

VERSION = 'region-salience-v1'
MIN_SLOT = .25  # beats
MAX_HOLD = 4.  # beats a voice may sustain on the single path
GAZE_DISTANCE = 1.4  # salience given up per image width travelled
MOTIF_STEP = 10  # pixels of edge rise and fall per extra motif note
MOTIF_NOTE = .5  # beats: with outlines, notes and region slots sit on a half-beat grid
# Most motif notes per voice, top to bottom: the upper voice moves, the bass stays calm.
LANE_MOTIF = {2: [4, 2], 3: [4, 3, 2], 4: [4, 3, 3, 2]}
GRACE = .125  # beats
# How the outline plays: the original short motif, the edge read cell by cell on a quantize grid,
# or the main edges of the picture read as lines (left to right is time, height is pitch).
STYLES = {'motif': '起伏动机', 'grid': '量化取样 · 滑音', 'lines': '线条演奏', 'sweep': '扫描线 · 竖线与分界交点'}
GRID_STEP = {2: [.5, .5], 3: [.5, .5, 1.], 4: [.5, .5, .5, 1.]}  # beats per edge sample, top to bottom
LINE_STEP = .5  # beats: the line score reads the picture on an eighth-note grid
LINE_SPAN = .25  # a main line must cross at least this share of the picture width
LINE_PIECE = .06  # shorter edges than this never sing
LINE_NEAR = .3  # a continuing edge stays within this share of the picture height of its voice
LINE_BRIDGE = 4  # grid cells: a shorter break in a line holds the previous note
SWEEP_STEP = .5  # beats: the scan line reads one column per eighth note
SWEEP_MATCH = .035  # share of the picture height: a crossing this close to last column's one continues it
SWEEP_HOLD = .6  # scale steps a crossing may drift before it plays a new note
SWEEP_BRIDGE = 2  # grid cells: a boundary the line loses for a moment keeps its note
ORDERS = {'gaze': '视线游走', 'tiers': '显著度分层', 'scan': '从左到右', 'path': '全图一条路径', 'salience': '纯显著度'}
ORDER_HINTS = {
    'gaze': '每个声部从最显著的区域出发，每次走到附近最显著的下一个区域，像眼睛看画。',
    'tiers': '每个声部把区域按显著度分成三层，最醒目的一层先从左到右走一遍，再走第二、第三层。',
    'scan': '每个声部从左到右依次发声；越醒目的区域越响、越长。',
    'path': '全图只有一条视线游走路径，当前区域在自己的声部发声，其他声部延续各自上一个音形成和声。',
    'salience': '每个声部严格按显著度从高到低发声，不考虑位置。'}
SWEEP_HINT = '扫描线：一条竖线从左到右扫过整幅画，不分声部也不分行；竖线碰到的每一条区域分界线都发音，碰到几条就同时响几个音（只有落在同一个音阶音上的两个交点合成一个）。分界线越高音越高（三个八度，吸附到音阶）；沿同一条分界线走、高度变化不大时延长原音，扫过区域侧边换到新的分界、高度明显变化或到新的一小节时重新起音。分界两侧颜色差越大越响，分界下方区域的颜色决定音色（暖色暖键、黄色木琴、绿色和紫色拨弦、蓝色轻铃，低音区用柔低音）。"分行"在这种方式下不起作用。'
LINES_HINT = '线条演奏：选出画面里最长、最清晰的几条边缘作主线，主线断开处由附近高度的较短边缘接续，播放线从左到右扫过，横向位置是时间，边缘的高低是音高（三个八度，吸附到音阶），平缓的坡在音尾短暂滑音；不再按区域顺序发声。'
# Used by the reference-engine mix and the painting page; the soft mix uses voicePreset.
SIMPLE_LANES = {2: ['soft_piano', 'soft_bass'], 3: ['celesta', 'soft_piano', 'soft_bass'], 4: ['celesta', 'soft_piano', 'harp', 'soft_bass']}

def shrink(map2d):
    """Block-average a 2D analysis map to the segmentation resolution."""
    return segmentation.downsample(np.repeat(np.asarray(map2d, dtype=float)[..., None], 3, axis=2))[..., 0]

def slots(areas, total, minimum=MIN_SLOT):
    """Beats per region, proportional to sqrt(area), at least `minimum`, summing to `total`."""
    weights = np.sqrt(np.asarray(areas, dtype=float))
    fixed = np.zeros(len(weights), bool)
    while True:
        free = total - minimum * fixed.sum()
        share = np.where(fixed, minimum, free * weights / max(weights[~fixed].sum(), 1e-12))
        newly = (share < minimum) & ~fixed
        if not newly.any(): break
        fixed |= newly
    # Snap the boundaries (not the lengths) to a quarter-beat grid, so the total is exact.
    edges = np.round(np.cumsum(share) / minimum) * minimum
    return np.diff(np.concatenate(([0.], edges)))

def build(analysis, info, options, engine):
    """Returns events, regions, voices and segmentation metadata, in the row-ensemble shape."""
    count = int(options.get('rowCount', 4))
    method = options.get('segmentMethod', 'grow')
    detail = float(options.get('segmentDetail', .5))
    if count not in (2, 3, 4): raise ValueError('声部数设置无效')
    synth = options.get('synth', 'Simple')
    maps, features = analysis['maps'], analysis['features']
    soft = bool(options.get('segmentSoft', True))
    result = segmentation.segment(maps['rgb'], method, detail, soft=soft)
    labels, parts = result['labels'], result['regions']
    H, W = labels.shape
    rgb = segmentation.downsample(maps['rgb'])
    lum, saliency, edge = shrink(maps['luminance']), shrink(maps['saliency_map']), shrink(maps['edge_map'])
    beat = 60 / info.tempo
    bars = max(1, int(info.duration / (4 * beat) + 1e-6))
    total = bars * 4
    root = engine.root_note(features)
    allowed = engine.upstream_composition.build_scale_notes(root, engine.upstream_composition.SCALES[info.scale_name], root + 10, root + 31)

    neighbours = [set() for _ in parts]
    for a, b in segmentation.adjacency(labels):
        neighbours[a].add(b); neighbours[b].add(a)
    flat = labels.ravel()
    regions, sums, scores = [], [], []
    for part in parts:
        index = part['index']
        mask = flat == index
        light = lum.ravel()[mask]
        hsv = engine.upstream_analysis.rgb_to_hsv_features(rgb.reshape(-1, 3)[mask][:, None, :], light[:, None])
        edges = edge.ravel()[mask]
        texture = .5 * engine.upstream_analysis.normalized_histogram_entropy(edges) + .5 * min(1., float(edges.mean()) * 4)
        f = {'brightness': float(light.mean()), 'hue': hsv['dominant_hue'], 'saturation': hsv['mean_saturation'],
            'contrast': float(light.std()), 'texture': float(texture), 'saliency': float(saliency.ravel()[mask].mean()),
            'area': part['areaRatio']}
        vector = np.array([f['brightness'], .5 + (f['hue'] - .5) * f['saturation'], f['saturation'], min(1, f['contrast'] * 3), f['texture']])
        contrast_to_neighbours = np.mean([math.dist(part['meanLab'], parts[n]['meanLab']) for n in neighbours[index]]) if neighbours[index] else 0.
        f['edgeContrast'] = float(contrast_to_neighbours)
        # Salience: the saliency map, how much the region stands out from its neighbours, and size.
        scores.append(.55 * f['saliency'] + .3 * min(1., contrast_to_neighbours / 40) + .15 * math.sqrt(part['areaRatio']))
        sums.append(float(np.sum(vector * engine.WEIGHTS)))
        lane = min(count - 1, int(part['centroid']['y'] * count))
        regions.append({'id': part['id'], 'index': index, 'row': lane, 'col': 0, 'rowId': f'row-{lane}', 'rect': part['rect'],
            'centroid': part['centroid'], 'start': 0., 'end': 0., 'features': f,
            'contributions': dict(zip(engine.FEATURE_NAMES, (vector * engine.WEIGHTS).tolist())),
            'targetMidi': None, 'midi': None, 'eventId': None, 'reason': '',
            'color': '#' + ''.join(f'{int(round(255 * min(1., max(0., c)))):02x}' for c in part['meanRgb'][:3])})
    contour = bool(options.get('contourMusic', False))
    style = options.get('contourStyle', 'motif') if contour else 'motif'
    if style not in STYLES: raise ValueError('未知轮廓演奏方式')
    outlines = segmentation.shapes(labels) if contour else None
    contained = {}
    if contour:
        flat_edge = edge.ravel()
        sharp = [float(flat_edge[o['boundary'].ravel()].mean()) if o['boundary'].any() else 0. for o in outlines]
        sharp_rank = engine.arranger.normalize(sharp, .02)
        # Ornaments mark the clearly concave shapes only: the most concave 15 % of this image.
        concave = min(.7, float(np.percentile([o['solidity'] for o in outlines], 8)))
        for i, (region, o) in enumerate(zip(regions, outlines)):
            region['features'].update(compactness=o['compactness'], angle=o['angle'], elongation=o['elongation'],
                solidity=o['solidity'], edgeSharpness=float(sharp_rank[i]))
            pts = o['profile']
            pick = np.linspace(0, len(pts) - 1, min(len(pts), 32)).round().astype(int)
            region['contour'] = [[(pts[k][0] + .5) / W, (pts[k][1] + .5) / H] for k in pick]
            # A region whose only neighbour is one other region, away from the border, sits inside it.
            if len(neighbours[i]) == 1 and not o['border']: contained[i] = next(iter(neighbours[i]))
    for i, outer in contained.items(): regions[i]['containedBy'] = regions[outer]['id']
    # Pitch uses the image's own feature range, like the arranged ensemble.
    positions = engine.arranger.normalize(sums)
    score_rank = engine.arranger.normalize(scores, .05)
    order = sorted(range(len(regions)), key=lambda i: (-scores[i], i))
    for rank, i in enumerate(order): regions[i]['salienceRank'] = rank + 1

    order_name = options.get('segmentOrder', 'gaze')
    if order_name not in ORDERS: raise ValueError('未知演奏顺序')
    aspect = H / W
    def where(i): return (regions[i]['centroid']['x'], regions[i]['centroid']['y'] * aspect)

    def sequence(members, how):
        """Order region indices: salience, eye-like walk, salience tiers or left to right."""
        if how == 'salience': return sorted(members, key=lambda i: (-scores[i], i))
        if how == 'scan': return sorted(members, key=lambda i: (where(i), i))
        if how == 'tiers':
            ranked = sorted(members, key=lambda i: (-scores[i], i))
            tier = {i: min(2, k * 3 // max(1, len(ranked))) for k, i in enumerate(ranked)}
            return sorted(members, key=lambda i: (tier[i], where(i), i))
        # Gaze: start at the most salient region, then step to the most salient nearby one.
        left = set(members); current = max(left, key=lambda i: (scores[i], -i)) if left else None; path = []
        while current is not None:
            path.append(current); left.discard(current)
            if not left: break
            here = where(current)
            current = max(left, key=lambda j: (score_rank[j] - GAZE_DISTANCE * math.dist(here, where(j)), -j))
        return path

    grid = MOTIF_NOTE if contour else MIN_SLOT
    def keep(members):
        """A voice has at most total / grid notes; the least salient regions give way."""
        capacity = int(total / grid)
        ranked = sorted(members, key=lambda i: (-scores[i], i))
        return set(ranked[:capacity]), ranked[capacity:]

    def weights(seq):
        # Larger regions hold longer; when scanning, salience also lengthens a note.
        return [regions[i]['features']['area'] * ((.5 + score_rank[i]) ** 2 if order_name == 'scan' else 1) for i in seq]

    def contour_figure(i, start, length, sounding, midi, velocity, base, lift):
        # The region's edge becomes a short motif; its shape sets articulation, tone and glide.
        # Kept calm on purpose: half-beat grid, small steps, fewer notes in lower voices.
        f = regions[i]['features']; o = outlines[i]; row = regions[i]['row']
        xs = np.array([x for x, _ in o['profile']], float); ys = np.array([y for _, y in o['profile']], float)
        if len(ys) >= 5: ys = np.convolve(np.pad(ys, 2, mode='edge'), [1 / 9, 2 / 9, 3 / 9, 2 / 9, 1 / 9], mode='valid')
        height = max(4., regions[i]['rect']['height'] * H)
        home = allowed.index(midi)
        side = '下边缘' if o['edgeSide'] == 'bottom' else '上边缘'
        bends = {}
        if style == 'grid':
            # Read the edge cell by cell on a quantize grid: a longer edge plays longer, a busier edge plays more notes.
            step = GRID_STEP[count][row]
            cells = max(1, int(round(length / step)))
            cut = np.linspace(0, len(ys), cells + 1).astype(int)
            level = np.array([ys[a:max(b, a + 1)].mean() for a, b in zip(cut[:-1], cut[1:])])
            # Height above the edge's mean, in scale steps; the note only changes after a clear move,
            # and moves at most two steps at a time, like the motif.
            raw = (ys.mean() - level) / height * 5
            runs, current = [], None  # [degree, first cell, cell after the last]
            for k, r in enumerate(raw):
                if current is None: current = int(np.clip(round(r), -4, 4))
                elif abs(r - current) > 1.25: current = int(np.clip(round(r), current - 2, current + 2))
                if runs and runs[-1][0] == current: runs[-1][2] = k + 1
                else: runs.append([current, k, k + 1])
            # Calm the line: notes shorter than a beat, and notes beyond twice the motif limit,
            # fold into the neighbour closest in pitch.
            shortest, cap = max(1, int(round(1 / step))), 2 * LANE_MOTIF[count][row]
            while len(runs) > 1:
                k = min(range(len(runs)), key=lambda k: (runs[k][2] - runs[k][1], k))
                if runs[k][2] - runs[k][1] >= shortest and len(runs) <= cap: break
                near = [j for j in (k - 1, k + 1) if 0 <= j < len(runs)]
                j = min(near, key=lambda j: (abs(runs[j][0] - runs[k][0]), j))
                runs[j][1], runs[j][2] = min(runs[j][1], runs[k][1]), max(runs[j][2], runs[k][2]); del runs[k]
                merged = [runs[0]]
                for run in runs[1:]:
                    if run[0] == merged[-1][0]: merged[-1][2] = run[2]
                    else: merged.append(run)
                runs = merged
            count_ = len(runs)
            pitches = [allowed[int(np.clip(home + d, 0, len(allowed) - 1))] for d, _, _ in runs]
            pick = [int(min(len(ys) - 1, (cut[a] + cut[b] - 1) // 2)) for _, a, b in runs]
            bounds = [start + a * step for _, a, _ in runs] + [start + length]
            # A gentle slope (one scale step to the next note) glides into it instead of jumping.
            for k in range(count_ - 1):
                if abs(allowed.index(pitches[k + 1]) - allowed.index(pitches[k])) == 1 and abs(pitches[k + 1] - pitches[k]) <= 2:
                    bends[k] = float(pitches[k + 1] - pitches[k])
            how = [f'{side}按{"八分" if step < 1 else "四分"}音符格逐格取高度，成 {count_} 个音' if count_ > 1 else f'{side}平缓，一个长音']
            if bends: how.append(f'平缓处滑音 {len(bends)} 处')
        else:
            variation = float(np.sum(np.abs(np.diff(ys)))) if len(ys) > 1 else 0.
            count_ = int(np.clip(1 + round(variation / MOTIF_STEP), 1, LANE_MOTIF[count][row]))
            count_ = max(1, min(count_, int(round(length / MOTIF_NOTE))))
            pick = [int(round((k + .5) / count_ * (len(ys) - 1))) for k in range(count_)]
            # A higher stretch of the edge plays a higher scale step; neighbouring notes move by at most two steps.
            raw = np.clip(np.round((ys.mean() - ys[pick]) / height * 4), -3, 3).astype(int).tolist()
            degrees = []
            for d in raw: degrees.append(d if not degrees else int(np.clip(d, degrees[-1] - 2, degrees[-1] + 2)))
            pitches = [allowed[int(np.clip(home + d, 0, len(allowed) - 1))] for d in degrees]
            bounds = [start + round(k * length / count_ / MOTIF_NOTE) * MOTIF_NOTE for k in range(count_)] + [start + length]
            how = [f'{side}起伏成 {count_} 个音的动机' if count_ > 1 else f'{side}平缓，一个音']
        c, e, angle = f['compactness'], f['elongation'], f['angle']
        horizontal = e > .6 and abs(angle) < 20
        factor = .98 if horizontal else .72 + .26 * c  # round or flat -> legato, jagged -> lightly detached
        tone = .7 + .6 * (1 - c)                       # jagged outlines sound a little brighter
        attack = 2 ** (1.5 - 3 * f['edgeSharpness'])   # hard edges attack fast, soft edges swell in
        notes = []
        how += ['轮廓圆润，连奏' if factor > .9 else '轮廓尖锐，轻断奏', '边缘清晰，起音干脆' if attack < 1 else '边缘柔和，缓慢起音']
        if f['solidity'] <= concave and bounds[1] - bounds[0] >= 1:
            grace = lift(allowed[min(home + 1, len(allowed) - 1)])
            notes.append(dict(base, start=start * beat, duration=GRACE * .9 * beat, midi=grace, velocity=velocity * .75, grace=True,
                toneScale=tone, attackScale=min(attack, 1.), point=regions[i]['contour'][0]))
            how.append('形状内凹，加倚音')
        for k, pitch in enumerate(pitches):
            begin = bounds[k] + (GRACE if k == 0 and notes else 0)
            end = bounds[k + 1]
            # Detached notes leave at most half a beat of air, so large regions still sound.
            hold = (end - begin) - (1 - factor) * min(end - begin, 1.5) if k not in bends else end - begin
            # On the single path the last note keeps sounding under the following regions.
            if k == count_ - 1 and order_name == 'path': hold = max(hold, start + sounding - begin)
            x = (xs[pick[k]] + .5) / W; y = (ys[pick[k]] + .5) / H
            notes.append(dict(base, start=begin * beat, duration=max(.05, hold * .97) * beat, midi=lift(pitch),
                velocity=float(np.clip(velocity + .05 * f['edgeSharpness'] - (.04 if k else 0), .3, .9)), toneScale=tone,
                attackScale=attack, point=[x, y]))
            if k in bends: notes[-1]['bend'] = bends[k]
        if style != 'grid' and e > .55 and 20 <= abs(angle) <= 70 and bounds[-1] - bounds[-2] >= 1:
            direction = 1 if angle > 0 else -1
            last = allowed.index(pitches[-1])
            goal = allowed[int(np.clip(last + direction, 0, len(allowed) - 1))]
            # Glide a whole tone at most: wider slides sound out of tune.
            if 0 < abs(goal - pitches[-1]) <= 2:
                notes[-1]['bend'] = float(goal - pitches[-1])
                how.append('斜向伸展，向' + ('上' if direction > 0 else '下') + '滑音')
        elif horizontal: how.append('横向舒展，长音')
        if i in contained: how.append('被外层区域包围，外层给出持续低音')
        return notes, '；'.join(how)

    lanes = [{'offset': engine.OCTAVE_LAYOUT[count][lane], 'previous': None, 'events': [],
        'instrument': SIMPLE_LANES[count][lane]} for lane in range(count)]
    def play_lines():
        """Line score: the clearest long edges become lines; x is time, height is pitch, colour picks the voice."""
        span_scale = engine.upstream_composition.build_scale_notes(root, engine.upstream_composition.SCALES[info.scale_name], root - 7, root + 29)
        pieces = []
        for i, o in enumerate(outlines):
            limit = H - 1 if o['edgeSide'] == 'bottom' else 0
            # Only a real boundary sings: the stretch of edge lying on the picture frame is skipped.
            pts = [(x, y) for x, y in o['profile'] if y != limit]
            if len(pts) < LINE_PIECE * W: continue
            xs = [x for x, _ in pts]; ys = np.array([y for _, y in pts], float)
            if len(ys) >= 5: ys = np.convolve(np.pad(ys, 2, mode='edge'), [1 / 9, 2 / 9, 3 / 9, 2 / 9, 1 / 9], mode='valid')
            weight = len(pts) / W * (.4 + .6 * regions[i]['features']['edgeSharpness']) * (.5 + .5 * min(1., regions[i]['features']['edgeContrast'] / 40))
            pieces.append((weight, i, dict(zip(xs, ys.tolist()))))
        pieces.sort(key=lambda c: (-c[0], c[1]))
        accepted = []
        for weight, i, line in pieces:
            # The sky's lower edge and the hill's upper edge are one boundary: keep it once.
            if any(len(set(line) & set(other)) > .5 * min(len(line), len(other))
                and np.mean([abs(line[x] - other[x]) for x in set(line) & set(other)]) <= 3 for _, _, other in accepted): continue
            accepted.append((weight, i, line))
        primary = [c for c in accepted if len(c[2]) >= LINE_SPAN * W][:count]
        if not primary:
            # Nothing crosses the picture (a plain image): the most salient region holds one flat line.
            i = order[0]; y = float(int(regions[i]['centroid']['y'] * (H - 1)))
            primary = [(0., i, {x: y for x in range(W)})]
        primary.sort(key=lambda c: (np.mean(list(c[2].values())), c[1]))  # the highest line takes the top voice
        tracks = [{x: (y, i) for x, y in line.items()} for _, i, line in primary]
        # Shorter edges take over where a voice's main line stops, if they sit near that voice's height,
        # so the music does not fall silent where one edge ends.
        for weight, i, line in accepted:
            if any(i == j for _, j, _ in primary): continue
            best = None
            for k, track in enumerate(tracks):
                free = [x for x in line if x not in track]
                if len(free) < LINE_PIECE * W / 2: continue
                near = abs(np.mean([line[x] for x in free]) - np.mean([y for y, _ in track.values()])) / H
                if near <= LINE_NEAR and (best is None or len(free) * (1 - near) > best[0]): best = (len(free) * (1 - near), k, free)
            if best: tracks[best[1]].update({x: (line[x], i) for x in best[2]})
        cells = int(round(total / LINE_STEP))
        cut = np.linspace(0, W, cells + 1).round().astype(int)
        primary_ids = {i for _, i, _ in primary}
        for lane_index, track in enumerate(tracks):
            lane = lanes[lane_index]
            runs, current = [], None  # [scale index, first cell, cell after the last, column, region]
            for k in range(cells):
                inside = [track[x] for x in range(cut[k], max(cut[k + 1], cut[k] + 1)) if x in track]
                if len(inside) * 2 < max(1, cut[k + 1] - cut[k]): current = None; continue
                owner = max(set(i for _, i in inside), key=lambda i: (sum(j == i for _, j in inside), -i))
                level = (1 - float(np.mean([y for y, j in inside if j == owner])) / (H - 1)) * (len(span_scale) - 1)
                if runs and runs[-1][4] != owner: current = None
                # Hold the note until the line clearly moves, so pixel jitter does not chatter.
                if current is None or abs(level - current) > .6: current = int(round(level))
                # A bar line re-strikes a long note so a flat horizon stays audible.
                if runs and runs[-1][0] == current and runs[-1][4] == owner and runs[-1][2] == k and (k * LINE_STEP) % 4: runs[-1][2] = k + 1
                else: runs.append([current, k, k + 1, (cut[k] + cut[k + 1]) // 2, owner])
            # A short break in the line is held over rather than left silent.
            for run, following in zip(runs, runs[1:]):
                if following[1] - run[2] <= LINE_BRIDGE: run[2] = following[1]
            for k, (index, a, b, column, i) in enumerate(runs):
                region, f = regions[i], regions[i]['features']
                pitch = span_scale[index]
                while pitch < 36: pitch += 12
                y = (track[min(track, key=lambda x: (track[x][1] != i, abs(x - column)))][0] + .5) / H
                velocity = float(np.clip(.45 + .35 * score_rank[i], .3, .85))
                note = {'instrument': lane['instrument'], 'pan': -.4 + .8 * lane_index / max(1, count - 1), 'layer': 'main',
                    'rowId': f'row-{lane_index}', 'row': lane_index, 'voicePreset': engine.SOFT_LAYOUT[count][lane_index],
                    'coverageEnd': b * LINE_STEP * beat, 'step': k, 'sources': [{'regionId': region['id'], 'rect': region['rect']}],
                    'start': a * LINE_STEP * beat, 'duration': (b - a) * LINE_STEP * beat * .96, 'midi': pitch,
                    'velocity': velocity if k == 0 or runs[k - 1][2] != a else velocity - .04, 'toneScale': .8 + .4 * f['saturation'],
                    'attackScale': float(min(1.5, 2 ** (1.5 - 3 * f['edgeSharpness']))), 'point': [(column + .5) / W, y], 'id': f'row-{lane_index}-note-{k}'}
                following = runs[k + 1] if k + 1 < len(runs) else None
                # A gentle slope along one edge (one scale step, at most a whole tone) glides into the next note.
                if following and following[1] == b and following[4] == i and abs(following[0] - index) == 1 and abs(span_scale[following[0]] - span_scale[index]) <= 2:
                    note['bend'] = float(span_scale[following[0]] - span_scale[index]); note['duration'] = (b - a) * LINE_STEP * beat
                lane['events'].append(note)
            for i in dict.fromkeys(r[4] for r in runs):
                region, own = regions[i], [n for n in lane['events'] if n['sources'][0]['regionId'] == regions[i]['id']]
                pts = sorted((x, y) for x, (y, j) in track.items() if j == i)
                pick = np.linspace(0, len(pts) - 1, min(len(pts), 64)).round().astype(int)
                region['contour'] = [[(pts[k][0] + .5) / W, (pts[k][1] + .5) / H] for k in pick]
                region.update(row=lane_index, rowId=f'row-{lane_index}', col=lane_index, start=own[0]['start'],
                    end=own[-1]['start'] + own[-1]['duration'], midi=own[0]['midi'], eventId=own[0]['id'], targetMidi=own[0]['midi'],
                    reason=f"第 {lane_index + 1} 声部的{'主线' if i in primary_ids else '接续线'}（{'下' if outlines[i]['edgeSide'] == 'bottom' else '上'}边缘，"
                    f"横跨画面 {round(100 * len(pts) / W)} %）：播放线扫到哪里就读哪里的高度，越高音越高；{len(own)} 个音，滑音 {sum(1 for n in own if n.get('bend'))} 处")
        heard = {n['sources'][0]['regionId'] for lane in lanes for n in lane['events']}
        for region in regions:
            if region['id'] not in heard: region['reason'] = f"显著度第 {region['salienceRank']} 位；线条演奏只读几条主要边缘，这个区域的边缘没有入选"

    def timbre(f, pitch):
        """Colour picks the timbre of a crossing: (family, soft preset, Simple instrument, GM program)."""
        if pitch < 48: return '低音区', 4, 'soft_bass', 32
        if f['saturation'] < .15: return '灰色', 0, 'soft_piano', 0
        h = f['hue']
        if h < .10 or h >= .92: return '暖色', 0, 'soft_piano', 0
        if h < .20: return '黄色', 2, 'marimba', 12
        if h < .45: return '绿色', 1, 'harp', 46
        if h < .72: return '蓝色', 3, 'celesta', 8
        return '紫色', 1, 'kalimba', 108

    def play_sweep():
        """Scan line: a vertical line sweeps left to right and every region boundary it crosses sounds.
        No voices or rows: a higher crossing plays higher, the colour difference across it sets loudness,
        the colour below it picks the timbre."""
        span_scale = engine.upstream_composition.build_scale_notes(root, engine.upstream_composition.SCALES[info.scale_name], root - 7, root + 29)
        cells = int(round(total / SWEEP_STEP))
        cut = np.linspace(0, W, cells + 1).round().astype(int)
        lab = [np.array(part['meanLab']) for part in parts]
        gap = max(2, int(round(SWEEP_MATCH * H)))
        level_of = lambda y: (1 - y / (H - 1)) * (len(span_scale) - 1)
        def crossings(x):
            # Every boundary the line crosses sounds; the colour difference across it only sets how loud.
            column = labels[:, x]; found = []
            for y in np.nonzero(column[:-1] != column[1:])[0]:
                a, b = int(column[y]), int(column[y + 1]); found.append((int(y), a, b, float(np.linalg.norm(lab[a] - lab[b]))))
            # Two crossings that land on the same scale step would be one pitch anyway: the clearer one plays it.
            kept = {}
            for c in found:
                step = int(round(level_of(c[0])))
                if step not in kept or c[3] > kept[step][3]: kept[step] = c
            return sorted(kept.values())
        # Each boundary the line follows is a thread; a thread holds its note while the crossing stays near its pitch.
        threads, finished, made = [], [], 0
        for k in range(cells):
            x = min(W - 1, (cut[k] + cut[k + 1]) // 2); point = lambda y: [(x + .5) / W, (y + .5) / H]
            taken = set()
            for y, a, b, strength in crossings(x):
                near = [t for t in threads if id(t) not in taken and abs(t['y'] - y) <= gap]
                t = min(near, key=lambda t: abs(t['y'] - y)) if near else None
                level = level_of(y)
                if t is not None:
                    taken.add(id(t)); t['y'] = y
                    # Holding on along one boundary keeps the note; a new boundary (the line passed a region's side),
                    # a clear change of height or a new bar strikes again.
                    restrike = (k * SWEEP_STEP) % 4 == 0 and t['first'] < k or (t['upper'], t['region']) != (a, b)
                    if abs(level - t['level']) <= SWEEP_HOLD and not restrike:
                        t['end'] = k + 1; t['path'].append(point(y)); continue
                    finished.append(dict(t)); same = abs(level - t['level']) <= SWEEP_HOLD
                    start_point = t['path'][-1] if t['end'] == k and abs(t['path'][-1][1] - (y + .5) / H) <= 2 * SWEEP_MATCH else [cut[k] / W, (y + .5) / H]
                    t.update(level=t['level'] if same else int(round(level)), first=k, end=k + 1, region=b, upper=a, strength=strength,
                        path=[start_point, point(y)])
                else:
                    t = {'thread': made, 'y': y, 'level': int(round(level)), 'first': k, 'end': k + 1, 'region': b, 'upper': a,
                        'strength': strength, 'path': [[cut[k] / W, (y + .5) / H], point(y)]}
                    made += 1; threads.append(t); taken.add(id(t))
            # A boundary the line has left for a moment keeps its note; a longer break ends it.
            for t in [t for t in threads if id(t) not in taken and k + 1 - t['end'] >= SWEEP_BRIDGE]:
                finished.append(t); threads.remove(t)
        finished += threads
        if not finished:
            # Nothing to cross (a plain picture): the most salient region holds one note across the sweep.
            i = order[0]; y = float(regions[i]['centroid']['y'] * (H - 1))
            finished.append({'thread': 0, 'level': int(round(level_of(y))), 'first': 0, 'end': cells, 'region': i, 'upper': i, 'strength': 0.,
                'path': [[0., (y + .5) / H], [1., (y + .5) / H]]})
        notes = []
        by_thread = {}
        for t in sorted(finished, key=lambda t: (t['thread'], t['first'])): by_thread.setdefault(t['thread'], []).append(t)
        for runs in by_thread.values():
            # A single-eighth wobble in height along the same boundary joins the note before it, so it does not chatter.
            merged = []
            for run in runs:
                if merged and run['end'] - run['first'] < 2 and merged[-1]['end'] == run['first'] \
                        and (run['upper'], run['region']) == (merged[-1]['upper'], merged[-1]['region']):
                    merged[-1]['end'] = run['end']; merged[-1]['path'] += [[px, merged[-1]['path'][-1][1]] for px, _ in run['path'][1:]]
                else: merged.append(run)
            for k, run in enumerate(merged):
                following = merged[k + 1] if k + 1 < len(merged) else None
                end = following['first'] if following and following['first'] - run['end'] < SWEEP_BRIDGE else run['end']
                i = run['region']; f = regions[i]['features']; pitch = span_scale[int(np.clip(run['level'], 0, len(span_scale) - 1))]
                while pitch < 36: pitch += 12
                family, preset, simple, program = timbre(f, pitch)
                note = {'instrument': simple, 'pan': float(np.clip(regions[i]['centroid']['x'] * .8 - .4, -.4, .4)), 'layer': 'main',
                    'rowId': 'row-0', 'row': 0, 'voicePreset': preset, 'timbre': family, 'coverageEnd': end * SWEEP_STEP * beat,
                    'step': len(notes), 'sources': [{'regionId': regions[i]['id'], 'rect': regions[i]['rect']}],
                    'start': run['first'] * SWEEP_STEP * beat, 'duration': (end - run['first']) * SWEEP_STEP * beat * .96, 'midi': pitch,
                    'velocity': float(np.clip(.32 + .5 * min(1., run['strength'] / 50), .3, .85)),
                    'toneScale': float(.7 + .6 * f['saturation'] * min(1., .4 + f['brightness'])),
                    'attackScale': float(min(1.5, 2 ** (1.5 - 3 * f.get('edgeSharpness', .5)))),
                    'point': run['path'][1], 'path': [[round(px, 4), round(py, 4)] for px, py in run['path']],
                    'color': regions[i]['color'], 'upperColor': regions[run['upper']]['color']}
                # One scale step on to the next crossing of the same boundary glides there in the note's tail.
                if following and following['first'] == end and abs(following['level'] - run['level']) == 1:
                    step = span_scale[int(np.clip(following['level'], 0, len(span_scale) - 1))] - span_scale[int(np.clip(run['level'], 0, len(span_scale) - 1))]
                    if abs(step) <= 2: note['bend'] = float(step); note['duration'] = (end - run['first']) * SWEEP_STEP * beat
                notes.append(note)
        notes.sort(key=lambda n: (n['start'], -n['midi']))
        for n, note in enumerate(notes): note['id'] = f'row-0-note-{n}'
        lanes[0]['events'] = notes
        for lane in lanes[1:]: lane['events'] = []
        for region in regions:
            own = [n for n in notes if n['sources'][0]['regionId'] == region['id']]
            if not own:
                region['reason'] = f"显著度第 {region['salienceRank']} 位；扫描线没有在这个区域的上边界取到音（分界不够明显，或被附近更清晰的分界代替）"; continue
            region.update(row=0, rowId='row-0', start=own[0]['start'], end=max(n['start'] + n['duration'] for n in own),
                midi=own[0]['midi'], targetMidi=own[0]['midi'], eventId=own[0]['id'],
                reason=f"显著度第 {region['salienceRank']} 位；扫描线经过这个区域的上边界 {len(own)} 次，边界越高音越高；"
                    f"区域是{own[0]['timbre']}，用{engine.soft_row_mixer.VOICES[own[0]['voicePreset']]['name']}的音色")

    plan = []  # (region index, start beat, length beat)
    skipped = []
    if style == 'lines':
        contained.clear(); play_lines()
    elif style == 'sweep':
        contained.clear(); play_sweep()
    elif order_name == 'path':
        kept, skipped = keep(range(len(regions)))
        seq = sequence(sorted(kept), 'gaze')
        lengths = slots(weights(seq), total, grid) if seq else []
        plan = list(zip(seq, np.concatenate(([0.], np.cumsum(lengths)[:-1])) if seq else [], lengths))
    else:
        skipped = []
        for lane in range(count):
            kept, dropped = keep([i for i in range(len(regions)) if regions[i]['row'] == lane])
            skipped += dropped
            seq = sequence(sorted(kept), order_name)
            if not seq: continue
            lengths = slots(weights(seq), total, grid)
            plan += list(zip(seq, np.concatenate(([0.], np.cumsum(lengths)[:-1])), lengths))
    plan.sort(key=lambda item: (item[1], regions[item[0]]['row']))
    # On the single path, each voice keeps sounding until its own next note: the others form the harmony.
    following = {}
    if order_name == 'path':
        last = {}
        for i, start, length in plan:
            lane = regions[i]['row']
            if lane in last: following[last[lane]] = start
            last[lane] = i
    for step, (i, start, length) in enumerate(plan):
        region = regions[i]; f = region['features']; lane = lanes[region['row']]
        sounding = length
        # A voice holds into the next regions (at most MAX_HOLD beats past its own slot) until its next note.
        if order_name == 'path': sounding = float(min(max(MAX_HOLD, length), following.get(i, total) - start))
        start, length = float(start), float(length)
        region.update(col=step, start=start * beat, end=(start + length) * beat)
        target = allowed[round(float(positions[i]) * (len(allowed) - 1))]
        region['targetMidi'] = target + lane['offset']
        position = f"按{ORDERS[order_name]}第 {step + 1} 个" if order_name == 'path' else f"按{ORDERS[order_name]}本声部第 {len(lane['events']) + 1} 个"
        if f['brightness'] < .03:
            region['reason'] = f"显著度第 {region['salienceRank']} 位；{position}；暗区休止"
            lane['previous'] = None; lane['last'] = None; continue
        # Keep the pitch class; choose the octave nearest the previous note in this voice.
        candidates = [n for n in allowed if n % 12 == target % 12] or [target]
        previous = lane['previous']
        midi = min(candidates, key=lambda n: (abs(n - previous) if previous is not None else abs(n - target), n))
        lane['previous'] = midi
        row = region['row']
        def lift(n, offset=lane['offset']):
            n += offset
            while n < 31: n += 12
            return n
        played = lift(midi)
        base = {'instrument': lane['instrument'], 'pan': -.4 + .8 * row / max(1, count - 1), 'layer': 'main', 'rowId': f'row-{row}',
            'row': row, 'voicePreset': engine.SOFT_LAYOUT[count][row], 'coverageEnd': (start + length) * beat, 'step': step,
            'sources': [{'regionId': region['id'], 'rect': region['rect']}]}
        velocity = float(np.clip(.42 + .4 * score_rank[i], .3, .85))
        if not contour:
            figure = [dict(base, start=start * beat, duration=sounding * beat * .96, midi=played, velocity=velocity)]
            how = '区域颜色、明暗、对比与纹理决定音名，面积决定时值'
        else:
            figure, how = contour_figure(i, start, length, sounding, midi, velocity, base, lift)
        for k, note in enumerate(figure): note['id'] = f'row-{row}-note-{len(lane["events"]) + k}'
        # Adjacent regions in a row join smoothly: the previous note holds until this one begins.
        last = lane.get('last')
        if contour and order_name != 'path' and last is not None and last in neighbours[i] and lane['events']:
            tail = lane['events'][-1]; tail['duration'] = max(tail['duration'], figure[0]['start'] - tail['start'])
            how += '；与上一个相邻区域连奏衔接'
        lane['last'] = i
        lead = next(n for n in figure if not n.get('grace'))
        region.update(midi=played, eventId=lead['id'], reason=f"显著度第 {region['salienceRank']} 位；{position}发声；{how}")
        lane['events'].extend(figure)
    for i in skipped:
        regions[i]['reason'] = f"显著度第 {regions[i]['salienceRank']} 位；区域过多，较不显著的区域未单独发声"
    # Containment: while an enclosed region sounds, its surrounding region holds a low pedal tone.
    pedal = []
    if contour:
        index_of = {r['id']: r['index'] for r in regions}
        notes = sorted((n for lane in lanes for n in lane['events']), key=lambda n: n['start'])
        for note in notes:
            outer = contained.get(index_of[note['sources'][0]['regionId']])
            if outer is None: continue
            pc = allowed[round(float(positions[outer]) * (len(allowed) - 1))] % 12
            pitch = 48 + (pc - 48) % 12
            begin, end = note['start'], note['start'] + note['duration']
            same = [q for q in pedal if q['midi'] == pitch and begin <= q['start'] + q['duration'] + 1e-6]
            if same: same[-1]['duration'] = max(same[-1]['duration'], end - same[-1]['start'])
            else:
                pedal.append({'start': begin, 'duration': end - begin, 'midi': pitch, 'velocity': .34,
                    'instrument': 'warm_pad', 'pan': 0, 'layer': 'bass'})
        pedal.sort(key=lambda e: e['start'])
    events, voices = [], []
    if style == 'sweep':
        # The scan line has no rows: one track holds every crossing, its timbre picked note by note from colour.
        events = list(lanes[0]['events'])
        voices.append({'id': 'row-0', 'row': 0, 'name': '扫描线 · 每个交点一个音', 'instrument': lanes[0]['instrument'],
            'instrumentName': '按区域颜色换音色', 'softName': '按区域颜色换音色', 'rect': {'x': 0, 'y': 0, 'width': 1, 'height': 1},
            'noteCount': len(events), 'fixedMidi': True, 'voicePreset': 0})
        lanes = []
    for row, lane in enumerate(lanes):
        events.extend(lane['events'])
        voices.append({'id': f'row-{row}', 'row': row, 'name': f'第 {row + 1} 声部 · {engine.OCTAVE_NAMES[count][row]}',
            'instrument': lane['instrument'], 'instrumentName': engine.upstream_composition.instrument_label(lane['instrument']),
            'rect': {'x': 0, 'y': row / count, 'width': 1, 'height': 1 / count}, 'noteCount': len(lane['events']), 'fixedMidi': True,
            'voicePreset': engine.SOFT_LAYOUT[count][row]})
    events.sort(key=lambda e: (e['start'], e['row'], e['midi']))
    meta = {'version': VERSION, 'segmentation': segmentation.VERSION, 'method': method, 'methodName': segmentation.METHOD_NAMES[method],
        'detail': detail, 'width': W, 'height': H, 'regionCount': len(regions), 'order': order_name, 'orderName': ORDERS[order_name],
        'orderHint': LINES_HINT if style == 'lines' else SWEEP_HINT if style == 'sweep' else ORDER_HINTS[order_name], 'sweepSeconds': total * beat, 'contour': contour,
        'contourStyle': style, 'contourStyleName': STYLES[style], 'pedal': pedal, 'soft': soft,
        # Smooth outlines for drawing; hit-testing keeps using the label image.
        'outlines': segmentation.outlines(labels) if soft else None,
        'labels': base64.b64encode(labels.astype('<u2').tobytes()).decode()}
    return events, regions, len(regions), len(voices), voices, meta
