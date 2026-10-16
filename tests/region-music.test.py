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
print('passed: contour on/off, five orders (salience, gaze start, left-to-right checked),  one region owns each note, no overlaps, white is one held note')
