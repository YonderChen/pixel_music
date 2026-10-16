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
    result = segmentation.segment(maps['rgb'], method, detail)
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

    def keep(members):
        """A voice has at most total / MIN_SLOT notes; the least salient regions give way."""
        capacity = int(total / MIN_SLOT)
        ranked = sorted(members, key=lambda i: (-scores[i], i))
        return set(ranked[:capacity]), ranked[capacity:]

    def weights(seq):
        # Larger regions hold longer; when scanning, salience also lengthens a note.
        return [regions[i]['features']['area'] * ((.5 + score_rank[i]) ** 2 if order_name == 'scan' else 1) for i in seq]

    lanes = [{'offset': engine.OCTAVE_LAYOUT[count][lane], 'previous': None, 'events': [],
        'instrument': f'gm_{GS_LANES[count][lane]:03d}' if synth == 'GeneralUser GS' else SIMPLE_LANES[count][lane]} for lane in range(count)]
    plan = []  # (region index, start beat, length beat)
    if order_name == 'path':
        kept, skipped = keep(range(len(regions)))
        seq = sequence(sorted(kept), 'gaze')
        lengths = slots(weights(seq), total) if seq else []
        plan = list(zip(seq, np.concatenate(([0.], np.cumsum(lengths)[:-1])) if seq else [], lengths))
    else:
        skipped = []
        for lane in range(count):
            kept, dropped = keep([i for i in range(len(regions)) if regions[i]['row'] == lane])
            skipped += dropped
            seq = sequence(sorted(kept), order_name)
            if not seq: continue
            lengths = slots(weights(seq), total)
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
            lane['previous'] = None; continue
        # Keep the pitch class; choose the octave nearest the previous note in this voice.
        candidates = [n for n in allowed if n % 12 == target % 12] or [target]
        previous = lane['previous']
        midi = min(candidates, key=lambda n: (abs(n - previous) if previous is not None else abs(n - target), n))
        lane['previous'] = midi
        played = midi + lane['offset']
        while played < 31: played += 12
        row = region['row']
        record = {'id': f'row-{row}-note-{len(lane["events"])}', 'start': start * beat, 'duration': sounding * beat * .96,
            'midi': played, 'velocity': float(np.clip(.42 + .4 * score_rank[i], .3, .85)), 'instrument': lane['instrument'],
            'pan': -.4 + .8 * row / max(1, count - 1), 'layer': 'main', 'rowId': f'row-{row}', 'row': row,
            'voicePreset': engine.SOFT_LAYOUT[count][row], 'coverageEnd': (start + length) * beat, 'step': step,
            'sources': [{'regionId': region['id'], 'rect': region['rect']}]}
        region.update(midi=played, eventId=record['id'],
            reason=f"显著度第 {region['salienceRank']} 位；{position}发声；区域颜色、明暗、对比与纹理决定音名，面积决定时值")
        lane['events'].append(record)
    for i in skipped:
        regions[i]['reason'] = f"显著度第 {regions[i]['salienceRank']} 位；区域过多，较不显著的区域未单独发声"
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
        'orderHint': ORDER_HINTS[order_name],
        'labels': base64.b64encode(labels.astype('<u2').tobytes()).decode()}
    return events, regions, len(regions), count, voices, meta
