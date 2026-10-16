"""Content-shaped regions played in order of salience.

The image is segmented (region growing, quadtree or SLIC). Each region's vertical
centroid picks a voice band (upper regions sound higher). Inside a band, regions
sound from the most to the least salient; a larger region holds a longer note.
Pitch comes from the region's own colour, brightness, contrast and texture.
"""
import base64
import math
import numpy as np

import segmentation

VERSION = 'region-salience-v1'
MIN_SLOT = .25  # beats
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

    events, voices = [], []
    for lane in range(count):
        members = [i for i in order if regions[i]['row'] == lane]
        capacity = int(total / MIN_SLOT)
        playing, skipped = members[:capacity], members[capacity:]
        lengths = slots([regions[i]['features']['area'] for i in playing], total) if playing else []
        offset = engine.OCTAVE_LAYOUT[count][lane]
        inst = f'gm_{GS_LANES[count][lane]:03d}' if synth == 'GeneralUser GS' else SIMPLE_LANES[count][lane]
        cursor, previous, lane_events = 0., None, []
        for i, length in zip(playing, lengths):
            region = regions[i]; f = region['features']
            region.update(col=len(lane_events), start=cursor * beat, end=(cursor + length) * beat)
            target = allowed[round(float(positions[i]) * (len(allowed) - 1))]
            region['targetMidi'] = target + offset
            if f['brightness'] < .03:
                region['reason'] = f"显著度第 {region['salienceRank']} 位；暗区休止"
                cursor += length; previous = None; continue
            # Keep the pitch class; choose the octave nearest the previous note in this voice.
            options_ = [n for n in allowed if n % 12 == target % 12] or [target]
            midi = min(options_, key=lambda n: (abs(n - previous) if previous is not None else abs(n - target), n))
            previous = midi
            played = midi + offset
            while played < 31: played += 12
            record = {'id': f'row-{lane}-note-{len(lane_events)}', 'start': cursor * beat, 'duration': length * beat * .96,
                'midi': played, 'velocity': float(np.clip(.42 + .4 * score_rank[i], .3, .85)), 'instrument': inst,
                'pan': -.4 + .8 * lane / max(1, count - 1), 'layer': 'main', 'rowId': f'row-{lane}', 'row': lane,
                'voicePreset': engine.SOFT_LAYOUT[count][lane], 'coverageEnd': (cursor + length) * beat,
                'sources': [{'regionId': region['id'], 'rect': region['rect']}]}
            region.update(midi=played, eventId=record['id'],
                reason=f"显著度第 {region['salienceRank']} 位，本声部第 {len(lane_events) + 1} 个发声；区域颜色、明暗、对比与纹理决定音名，面积决定时值")
            lane_events.append(record)
            cursor += length
        for i in skipped:
            regions[i]['reason'] = f"显著度第 {regions[i]['salienceRank']} 位；本声部区域过多，较不显著的区域未单独发声"
        events.extend(lane_events)
        voices.append({'id': f'row-{lane}', 'row': lane, 'name': f'第 {lane + 1} 声部 · {engine.OCTAVE_NAMES[count][lane]}',
            'instrument': inst, 'instrumentName': engine.upstream_composition.instrument_label(inst),
            'rect': {'x': 0, 'y': lane / count, 'width': 1, 'height': 1 / count}, 'noteCount': len(lane_events), 'fixedMidi': True,
            'voicePreset': engine.SOFT_LAYOUT[count][lane]})
    events.sort(key=lambda e: (e['start'], e['row'], e['midi']))
    meta = {'version': VERSION, 'segmentation': segmentation.VERSION, 'method': method, 'methodName': segmentation.METHOD_NAMES[method],
        'detail': detail, 'width': W, 'height': H, 'regionCount': len(regions),
        'labels': base64.b64encode(labels.astype('<u2').tobytes()).decode()}
    return events, regions, len(regions), count, voices, meta
