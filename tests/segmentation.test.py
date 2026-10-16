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
print('passed: one region for white, deterministic, consecutive ids, connected regions, gradient strips, checker squares')
