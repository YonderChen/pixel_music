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
ORDERS = {'gaze': '视线游走', 'tiers': '显著度分层', 'scan': '从左到右', 'path': '全图一条路径', 'salience': '纯显著度'}
ORDER_HINTS = {
    'gaze': '每个声部从最显著的区域出发，每次走到附近最显著的下一个区域，像眼睛看画。',
    'tiers': '每个声部把区域按显著度分成三层，最醒目的一层先从左到右走一遍，再走第二、第三层。',
    'scan': '每个声部从左到右依次发声；越醒目的区域越响、越长。',
    'path': '全图只有一条视线游走路径，当前区域在自己的声部发声，其他声部延续各自上一个音形成和声。',
    'salience': '每个声部严格按显著度从高到低发声，不考虑位置。'}
# Used by the reference-engine mix and the painting page; the soft mix uses voicePreset.
GS_LANES = {2: [0, 32], 3: [11, 0, 32], 4: [11, 0, 46, 32]}
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
    synth = options.get('synth', 'GeneralUser GS')
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
            'targetMidi': None, 'midi': None, 'eventId': None, 'reason': ''})
    contour = bool(options.get('contourMusic', False))
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
        variation = float(np.sum(np.abs(np.diff(ys)))) if len(ys) > 1 else 0.
        count_ = int(np.clip(1 + round(variation / MOTIF_STEP), 1, LANE_MOTIF[count][row]))
        count_ = max(1, min(count_, int(round(length / MOTIF_NOTE))))
        pick = [int(round((k + .5) / count_ * (len(ys) - 1))) for k in range(count_)]
        height = max(4., regions[i]['rect']['height'] * H)
        # A higher stretch of the edge plays a higher scale step; neighbouring notes move by at most two steps.
        raw = np.clip(np.round((ys.mean() - ys[pick]) / height * 4), -3, 3).astype(int).tolist()
        degrees = []
        for d in raw: degrees.append(d if not degrees else int(np.clip(d, degrees[-1] - 2, degrees[-1] + 2)))
        home = allowed.index(midi)
        pitches = [allowed[int(np.clip(home + d, 0, len(allowed) - 1))] for d in degrees]
        c, e, angle = f['compactness'], f['elongation'], f['angle']
        horizontal = e > .6 and abs(angle) < 20
        factor = .98 if horizontal else .72 + .26 * c  # round or flat -> legato, jagged -> lightly detached
        tone = .7 + .6 * (1 - c)                       # jagged outlines sound a little brighter
        attack = 2 ** (1.5 - 3 * f['edgeSharpness'])   # hard edges attack fast, soft edges swell in
        bounds = [start + round(k * length / count_ / MOTIF_NOTE) * MOTIF_NOTE for k in range(count_)] + [start + length]
        notes = []
        side = '下边缘' if o['edgeSide'] == 'bottom' else '上边缘'
        how = [f'{side}起伏成 {count_} 个音的动机' if count_ > 1 else f'{side}平缓，一个音',
            '轮廓圆润，连奏' if factor > .9 else '轮廓尖锐，轻断奏', '边缘清晰，起音干脆' if attack < 1 else '边缘柔和，缓慢起音']
        if f['solidity'] <= concave and bounds[1] - bounds[0] >= 1:
            grace = lift(allowed[min(home + 1, len(allowed) - 1)])
            notes.append(dict(base, start=start * beat, duration=GRACE * .9 * beat, midi=grace, velocity=velocity * .75, grace=True,
                toneScale=tone, attackScale=min(attack, 1.), point=regions[i]['contour'][0]))
            how.append('形状内凹，加倚音')
        for k, pitch in enumerate(pitches):
            begin = bounds[k] + (GRACE if k == 0 and notes else 0)
            end = bounds[k + 1]
            # Detached notes leave at most half a beat of air, so large regions still sound.
            hold = (end - begin) - (1 - factor) * min(end - begin, 1.5)
            # On the single path the last note keeps sounding under the following regions.
            if k == count_ - 1 and order_name == 'path': hold = max(hold, start + sounding - begin)
            x = (xs[pick[k]] + .5) / W; y = (ys[pick[k]] + .5) / H
            notes.append(dict(base, start=begin * beat, duration=max(.05, hold * .97) * beat, midi=lift(pitch),
                velocity=float(np.clip(velocity + .05 * f['edgeSharpness'] - (.04 if k else 0), .3, .9)), toneScale=tone,
                attackScale=attack, point=[x, y]))
        if e > .55 and 20 <= abs(angle) <= 70 and bounds[-1] - bounds[-2] >= 1:
            direction = 1 if angle > 0 else -1
            last = allowed.index(pitches[-1])
            goal = allowed[int(np.clip(last + direction, 0, len(allowed) - 1))]
            notes[-1]['bend'] = float(goal - pitches[-1])
            how.append('斜向伸展，向' + ('上' if direction > 0 else '下') + '滑音')
        elif horizontal: how.append('横向舒展，长音')
        if i in contained: how.append('被外层区域包围，外层给出持续低音')
        return notes, '；'.join(how)

    lanes = [{'offset': engine.OCTAVE_LAYOUT[count][lane], 'previous': None, 'events': [],
        'instrument': f'gm_{GS_LANES[count][lane]:03d}' if synth == 'GeneralUser GS' else SIMPLE_LANES[count][lane]} for lane in range(count)]
    plan = []  # (region index, start beat, length beat)
    if order_name == 'path':
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
                    'instrument': 'gm_089' if synth == 'GeneralUser GS' else 'warm_pad', 'pan': 0, 'layer': 'bass'})
        pedal.sort(key=lambda e: e['start'])
    events, voices = [], []
    for row, lane in enumerate(lanes):
        events.extend(lane['events'])
        voices.append({'id': f'row-{row}', 'row': row, 'name': f'第 {row + 1} 声部 · {engine.OCTAVE_NAMES[count][row]}',
            'instrument': lane['instrument'], 'instrumentName': engine.upstream_composition.instrument_label(lane['instrument']),
            'rect': {'x': 0, 'y': row / count, 'width': 1, 'height': 1 / count}, 'noteCount': len(lane['events']), 'fixedMidi': True,
            'voicePreset': engine.SOFT_LAYOUT[count][row]})
    events.sort(key=lambda e: (e['start'], e['row'], e['midi']))
    meta = {'version': VERSION, 'segmentation': segmentation.VERSION, 'method': method, 'methodName': segmentation.METHOD_NAMES[method],
        'detail': detail, 'width': W, 'height': H, 'regionCount': len(regions), 'order': order_name, 'orderName': ORDERS[order_name],
        'orderHint': ORDER_HINTS[order_name], 'contour': contour, 'pedal': pedal, 'soft': soft,
        # Smooth outlines for drawing; hit-testing keeps using the label image.
        'outlines': segmentation.outlines(labels) if soft else None,
        'labels': base64.b64encode(labels.astype('<u2').tobytes()).decode()}
    return events, regions, len(regions), count, voices, meta
