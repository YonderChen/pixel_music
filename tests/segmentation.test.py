"""Segmentation invariants for all three methods (run: python3 tests/segmentation.test.py)."""
import pathlib, sys, time
import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import segmentation as seg

def connected(labels, index):
    ys, xs = np.nonzero(labels == index)
    seen, stack, target = {(ys[0], xs[0])}, [(ys[0], xs[0])], set(zip(ys.tolist(), xs.tolist()))
    while stack:
        y, x = stack.pop()
        for q in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if q in target and q not in seen: seen.add(q); stack.append(q)
    return len(seen) == len(target)

white = np.ones((120, 192, 3))
gradient = np.repeat(np.repeat(np.linspace(0, 1, 192)[None, :, None], 120, 0), 3, 2)
yy, xx = np.mgrid[0:120, 0:192]
checker = np.repeat(((yy // 24 + xx // 24) % 2).astype(float)[..., None], 3, 2)
painting = np.asarray(Image.open(ROOT / 'dist/sonification-assets/paintings/starry-night.jpg').convert('RGB')) / 255

for method in seg.METHODS:
    assert len(seg.segment(white, method)['regions']) == 1, method
    for name, image in [('painting', painting), ('checker', checker), ('gradient', gradient)]:
        start = time.perf_counter(); a = seg.segment(image, method); seconds = time.perf_counter() - start
        b = seg.segment(image, method)
        labels = a['labels']
        assert np.array_equal(labels, b['labels']), f'{method}/{name}: not deterministic'
        n = len(a['regions'])
        assert labels.min() == 0 and labels.max() == n - 1 and len(np.unique(labels)) == n, f'{method}/{name}: ids not consecutive'
        assert all(connected(labels, i) for i in range(n)), f'{method}/{name}: region not connected'
        assert sum(r['area'] for r in a['regions']) == labels.size
        assert seconds < 1.5, f'{method}/{name}: {seconds:.2f}s'
        print(f'{method:9s} {name:9s} {n:4d} regions {seconds:.2f}s')

# Region growing follows the gradient as vertical strips, and the checker's 40 squares exactly.
strips = seg.segment(gradient, 'grow')
assert all(r['rect']['height'] == 1 for r in strips['regions']) and len(strips['regions']) >= 3
assert len(seg.segment(checker, 'grow')['regions']) == 40
# Outline features on known shapes.
shape = np.zeros((120, 192), np.int32)
disc = (yy - 60) ** 2 + (xx - 40) ** 2 < 400; shape[disc] = 1
shape[(yy > 20) & (yy < 26) & (xx > 80) & (xx < 180)] = 2
shape[(np.abs((xx - 120) - (60 - yy)) < 3) & (xx > 100) & (xx < 170) & (yy > 30) & (yy < 110) & (shape == 0)] = 3
outline = {int(shape[y, x]): o for o, (y, x) in zip(seg.shapes(shape), [tuple(np.argwhere(shape == v)[0]) for v in range(4)])}
assert outline[1]['compactness'] > .75 and outline[1]['elongation'] < .1 and outline[1]['solidity'] > .9, outline[1]
assert outline[2]['elongation'] > .9 and abs(outline[2]['angle']) < 5
assert outline[3]['elongation'] > .9 and 40 < outline[3]['angle'] < 50
sky = np.zeros((120, 192), np.int32); sky[60:] = 1; sky[40:60, 60:120] = 1
top = seg.shapes(sky)[0]
assert top['edgeSide'] == 'bottom' and len({y for _, y in top['profile']}) == 2  # the skyline, not the frame
# Softened outlines: fewer boundary pixels, still connected, white stays whole, rings close.
def boundary(labels):
    e = np.zeros(labels.shape, bool); e[:, :-1] |= labels[:, :-1] != labels[:, 1:]; e[:-1] |= labels[:-1] != labels[1:]; return int(e.sum())
for method in seg.METHODS:
    assert len(seg.segment(white, method, soft=True)['regions']) == 1
    hard, soft = seg.segment(painting, method), seg.segment(painting, method, soft=True)
    labels = soft['labels']; n = len(soft['regions'])
    assert boundary(labels) < boundary(hard['labels']), method
    assert all(connected(labels, i) for i in range(n)) and labels.max() == n - 1
    rings = seg.outlines(labels)
    assert len(rings) == n and all(r and all(len(x['p']) >= 6 and len(x['p']) % 2 == 0 for x in r) for r in rings)
    print(f'{method:9s} soft      {n:4d} regions, boundary {boundary(hard["labels"])} -> {boundary(labels)} px')
print('passed: softened outlines (shorter, connected, closed rings), shape features (disc, bar, diagonal, skyline), one region for white, deterministic, consecutive ids, connected regions, gradient strips, checker squares')
