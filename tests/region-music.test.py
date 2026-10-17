"""Region music: salience order, timing and fidelity (run: python3 tests/region-music.test.py)."""
import io, pathlib, sys
import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import reference_music as engine

def png(array):
    buffer = io.BytesIO(); Image.fromarray(array.astype(np.uint8)).save(buffer, format='PNG'); return buffer.getvalue()

images = {'white': png(np.full((120, 192, 3), 255)), 'starry-night': (ROOT / 'dist/sonification-assets/paintings/starry-night.jpg').read_bytes(),
    'impression-sunrise': (ROOT / 'dist/sonification-assets/paintings/impression-sunrise.jpg').read_bytes()}
for name, image in images.items():
    for method, order, contour in [(m, o, c) for m in ('grow', 'quadtree', 'slic') for o in ('gaze', 'tiers', 'scan', 'path', 'salience') for c in (False, True)]:
        for rows in (2, 4):
            payload, context = engine.prepare_scores(image, {'rowCount': rows, 'rowMethod': 'regions', 'segmentMethod': method, 'segmentOrder': order, 'contourMusic': contour, 'synth': 'Simple'})
            info, variant = payload['info'], payload['variants']['parallel']
            main = [e for e in variant['events'] if e['layer'] == 'main']
            regions = {r['id']: r for r in variant['regions']}
            assert variant['segmentation']['regionCount'] == len(variant['regions']) and variant['rows'] == rows
            assert len({e['id'] for e in main}) == len(main)
            for e in main:
                assert 0 <= e['start'] and e['start'] + e['duration'] <= info['duration'] + 1e-6, (name, method, e)
                region = regions[e['sources'][0]['regionId']]
                # With outlines, one region owns a short motif; its first (non-grace) note is the region's event.
                assert region['eventId'] == e['id'] if not contour else any(n['id'] == region['eventId'] for n in main)
                if contour: assert e['start'] >= region['start'] - 1e-6 and e['start'] < region['end'] + 1e-6
            for lane in range(rows):
                lane_events = sorted((e for e in main if e['row'] == lane), key=lambda e: e['start'])
                firsts = [e for k, e in enumerate(lane_events) if k == 0 or e['sources'][0]['regionId'] != lane_events[k - 1]['sources'][0]['regionId']]
                ranks = [regions[e['sources'][0]['regionId']]['salienceRank'] for e in firsts]
                if order == 'salience': assert ranks == sorted(ranks), f'{name}/{method}: lane {lane} not in salience order'
                if order == 'gaze' and ranks:
                    lane_ranks = [r['salienceRank'] for r in variant['regions'] if r['row'] == lane and r['features']['brightness'] >= .03]
                    assert ranks[0] == min(lane_ranks), f'{name}/{method}: gaze must start at the most salient region'
                if order == 'scan':
                    xs = [regions[e['sources'][0]['regionId']]['centroid']['x'] for e in firsts]
                    assert xs == sorted(xs), f'{name}/{method}: scan must go left to right'
                for a, b in zip(lane_events, lane_events[1:]): assert a['start'] + a['duration'] <= b['start'] + 1e-6
            if name == 'white':
                assert len(variant['regions']) == 1 and len(main) == 1 and main[0]['duration'] > info['duration'] * .9
            print(f'{name:18s} {method:8s} {order:8s} contour {contour!s:5s} rows {rows}: {len(variant["regions"]):3d} regions, {len(main):3d} notes, chords {"→".join(variant["harmony"]["progression"])}')
# The two outline styles added for comparison: edge read on a quantize grid, and the main edges read as lines.
for name, image in images.items():
    for method, order, style, rows in [(m, o, s, r) for m in ('grow', 'quadtree', 'slic') for o in ('gaze', 'path') for s in ('grid', 'lines', 'sweep') for r in (2, 4)]:
        payload, context = engine.prepare_scores(image, {'rowCount': rows, 'rowMethod': 'regions', 'segmentMethod': method, 'segmentOrder': order,
            'contourMusic': True, 'contourStyle': style, 'synth': 'Simple'})
        info, variant = payload['info'], payload['variants']['parallel']
        main = [e for e in variant['events'] if e['layer'] == 'main']
        regions = {r['id']: r for r in variant['regions']}
        assert variant['segmentation']['contourStyle'] == style and len({e['id'] for e in main}) == len(main) and main
        for e in main:
            assert 0 <= e['start'] and e['start'] + e['duration'] <= info['duration'] + 1e-6, (name, method, style, e)
            region = regions[e['sources'][0]['regionId']]
            assert any(n['id'] == region['eventId'] for n in main) and region['start'] - 1e-6 <= e['start'] < region['end'] + 1e-6
            # A glide ends on the next note of its voice, one scale step away.
            if e.get('bend'): assert abs(e['bend']) <= 3
        for lane in range(rows):
            lane_events = sorted((e for e in main if e['row'] == lane), key=lambda e: e['start'])
            for a, b in zip(lane_events, lane_events[1:]): assert a['start'] + a['duration'] <= b['start'] + 1e-6
            if style in ('lines', 'sweep'):
                # Each voice reads its line (a main edge, continued by nearby edges) left to right.
                xs = [e['point'][0] for e in lane_events]; assert xs == sorted(xs)
                assert all(abs(e['bend']) <= 2 for e in lane_events if e.get('bend'))
        if style == 'sweep':
            # The scan line sounds where it crosses boundaries: a note's path runs left to right inside its own time span.
            span = variant['segmentation']['sweepSeconds']
            for e in main:
                xs = [p[0] for p in e['path']]; assert xs == sorted(xs) and e['color'].startswith('#')
                assert abs(xs[0] - e['start'] / span) <= .01, (name, method, e['start'], xs[0])
            assert not variant['segmentation'].get('pedal') and len({e['row'] for e in main}) <= rows
            if name == 'white': assert len(main) == 1
        if style == 'lines':
            assert len({e['row'] for e in main}) <= rows and not variant['segmentation'].get('pedal')
            # Shorter edges carry on where a main line stops: the picture is never silent for more than two beats.
            beat = 60 / info['tempo']; ends = sorted((e['start'], e['start'] + e['duration']) for e in main); reach = ends[0][1]
            for begin, end in ends[1:]: assert begin - reach <= 2 * beat + 1e-6, (name, method, begin, reach); reach = max(reach, end)
            if name == 'white': assert len({e['midi'] for e in main}) == 1 and main[-1]['start'] + main[-1]['duration'] > info['duration'] * .9
        print(f'{name:18s} {method:8s} {order:8s} style {style:5s} rows {rows}: {len(main):3d} notes, {sum(1 for e in main if e.get("bend")):3d} glides')
print('passed: contour on/off, five orders (salience, gaze start, left-to-right checked),  one region owns each note, no overlaps, white is one held note; grid, line and scan-line styles keep voices in order, lines and the scan line read left to right')
