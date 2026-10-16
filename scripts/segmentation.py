"""Content-driven image regions: seeded region growing, quadtree split and SLIC.

All three methods return the same structure, need only NumPy (so they also run
in Pyodide) and are fully deterministic. Colour distances are CIE76 delta E in
Lab, so one threshold means roughly the same visible difference everywhere.
"""
import heapq
import math
from collections import deque
import numpy as np

VERSION = 'segmentation-v1'
METHODS = ('grow', 'quadtree', 'slic')
METHOD_NAMES = {'grow': '方格种子 · 区域生长', 'quadtree': '四叉树 · 分裂合并', 'slic': 'SLIC 超像素'}
MAX_W, MAX_H = 192, 120
MIN_AREA = 24
SEED_STEP = 16

def downsample(rgb):
    """Box-average by an integer factor until the image fits 192x120."""
    h, w, _ = rgb.shape
    f = max(1, math.ceil(max(w / MAX_W, h / MAX_H)))
    if f == 1: return np.asarray(rgb, dtype=float)
    H, W = h // f, w // f
    return np.asarray(rgb[:H * f, :W * f], dtype=float).reshape(H, f, W, f, 3).mean(axis=(1, 3))

def to_lab(rgb):
    linear = np.where(rgb <= .04045, rgb / 12.92, ((rgb + .055) / 1.055) ** 2.4)
    matrix = np.array([[.4124564, .3575761, .1804375], [.2126729, .7151522, .0721750], [.0193339, .1191920, .9503041]])
    xyz = linear @ matrix.T / np.array([.95047, 1., 1.08883])
    e = (6 / 29) ** 3
    f = np.where(xyz > e, np.cbrt(xyz), xyz / (3 * (6 / 29) ** 2) + 4 / 29)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], axis=-1)

def smooth(lab, passes=2):
    """3x3 median, repeated: removes fine texture but keeps sharp colour edges."""
    out = lab
    H, W, _ = lab.shape
    for _ in range(passes):
        p = np.pad(out, ((1, 1), (1, 1), (0, 0)), mode='edge')
        out = np.median(np.stack([p[dy:dy + H, dx:dx + W] for dy in range(3) for dx in range(3)]), axis=0)
    return out

def threshold(detail):
    """delta E threshold: detail 0 -> 24 (coarse), 0.5 -> 12, 1 -> 6 (fine)."""
    return 12 * 2 ** ((.5 - float(np.clip(detail, 0, 1))) * 2)

# ------------------------------------------------------------------ methods

def grow(lab, detail):
    """Seeds on a 16 px grid, calmest first; each grows while pixels stay close to
    the region's running mean and to the neighbour they are reached from."""
    H, W, _ = lab.shape
    limit, local = threshold(detail), threshold(detail) * .6
    values = lab.reshape(-1, 3).tolist()
    labels = [-1] * (H * W)
    seeds = [(y, x) for y in range(SEED_STEP // 2, H, SEED_STEP) for x in range(SEED_STEP // 2, W, SEED_STEP)]
    def calm(seed):
        y, x = seed
        patch = lab[max(0, y - 2):y + 3, max(0, x - 2):x + 3].reshape(-1, 3)
        return (float(patch.var(axis=0).sum()), y, x)
    seeds.sort(key=calm)
    # Pixels no seed reached start regions of their own, in scan order.
    order = [y * W + x for y, x in seeds] + list(range(H * W))
    count = 0
    for start in order:
        if labels[start] >= 0: continue
        labels[start] = count
        total = list(values[start]); size = 1
        queue = deque([start])
        while queue:
            p = queue.popleft(); py, px = divmod(p, W); pv = values[p]
            for q in ((p - W) if py else -1, (p + W) if py < H - 1 else -1, (p - 1) if px else -1, (p + 1) if px < W - 1 else -1):
                if q < 0 or labels[q] >= 0: continue
                v = values[q]
                mean = (total[0] / size, total[1] / size, total[2] / size)
                if math.dist(v, mean) < limit and math.dist(v, pv) < local:
                    labels[q] = count; size += 1
                    total[0] += v[0]; total[1] += v[1]; total[2] += v[2]
                    queue.append(q)
        count += 1
    return np.array(labels, dtype=np.int32).reshape(H, W)

def quadtree(lab, detail):
    """Bottom-up quadtree: start from the smallest blocks and merge four siblings into
    their parent when their means are close and the parent is not too mixed. Small
    details (a sun in haze) survive; uniform areas, even textured ones, become big blocks."""
    H, W, _ = lab.shape
    limit = threshold(detail)
    labels = np.zeros((H, W), dtype=np.int32)
    count = [0]
    def emit(block):
        y0, x0, y1, x1 = block
        labels[y0:y1, x0:x1] = count[0]; count[0] += 1
    def visit(y0, x0, y1, x1):
        """Returns the block if it stays whole (for the parent to consider), else None."""
        # Finest blocks are 3-6 px a side; the split-and-merge pass joins them again.
        if y1 - y0 < 6 or x1 - x0 < 6: return (y0, x0, y1, x1)
        ym, xm = (y0 + y1) // 2, (x0 + x1) // 2
        quarters = [(y0, x0, ym, xm), (y0, xm, ym, x1), (ym, x0, y1, xm), (ym, xm, y1, x1)]
        kept = [visit(*q) for q in quarters]
        if all(kept):
            block = lab[y0:y1, x0:x1].reshape(-1, 3)
            means = [lab[a:c, b:d].reshape(-1, 3).mean(axis=0) for a, b, c, d in quarters]
            close = max(float(np.linalg.norm(m - n)) for i, m in enumerate(means) for n in means[i + 1:]) < limit * .6
            if close and math.sqrt(float(block.var(axis=0).sum())) < limit * 2: return (y0, x0, y1, x1)
        for block in kept:
            if block: emit(block)
        return None
    root = visit(0, 0, H, W)
    if root: emit(root)
    return labels

def slic_count(detail):
    return int(round(20 + 80 * float(np.clip(detail, 0, 1))))

def slic(lab, detail, iterations=10, compactness=10.):
    """Simple linear iterative clustering on a regular grid of K centres."""
    H, W, _ = lab.shape
    k = slic_count(detail)
    S = math.sqrt(H * W / k)
    ys = np.arange(S / 2, H, S); xs = np.arange(S / 2, W, S)
    L = lab[..., 0]
    gy, gx = np.gradient(L)
    gradient = gy ** 2 + gx ** 2
    centres = []
    for cy in ys:
        for cx in xs:
            y, x = int(cy), int(cx)
            # Move each centre to the calmest pixel nearby, off any edge.
            win = gradient[max(0, y - 1):y + 2, max(0, x - 1):x + 2]
            dy, dx = np.unravel_index(int(np.argmin(win)), win.shape)
            y, x = max(0, y - 1) + dy, max(0, x - 1) + dx
            centres.append([*lab[y, x], y, x])
    centres = np.array(centres, dtype=float)
    yy, xx = np.mgrid[0:H, 0:W]
    labels = np.zeros((H, W), dtype=np.int32)
    scale = (compactness / S) ** 2
    for _ in range(iterations):
        distance = np.full((H, W), np.inf)
        for index, (cl, ca, cb, cy, cx) in enumerate(centres):
            y0, y1 = max(0, int(cy - 2 * S)), min(H, int(cy + 2 * S) + 1)
            x0, x1 = max(0, int(cx - 2 * S)), min(W, int(cx + 2 * S) + 1)
            win = lab[y0:y1, x0:x1]
            d = ((win[..., 0] - cl) ** 2 + (win[..., 1] - ca) ** 2 + (win[..., 2] - cb) ** 2
                + scale * ((yy[y0:y1, x0:x1] - cy) ** 2 + (xx[y0:y1, x0:x1] - cx) ** 2))
            better = d < distance[y0:y1, x0:x1]
            distance[y0:y1, x0:x1][better] = d[better]
            labels[y0:y1, x0:x1][better] = index
        for index in range(len(centres)):
            mask = labels == index
            if mask.any(): centres[index] = [*lab[mask].mean(axis=0), yy[mask].mean(), xx[mask].mean()]
    return split_disconnected(labels)

# ------------------------------------------------------------------ shared post-processing

def components(labels):
    """Relabel so that every region is one 4-connected component."""
    H, W = labels.shape
    flat = labels.ravel().tolist(); out = [-1] * (H * W); count = 0
    for start in range(H * W):
        if out[start] >= 0: continue
        value = flat[start]; out[start] = count; queue = deque([start])
        while queue:
            p = queue.popleft(); py, px = divmod(p, W)
            for q in ((p - W) if py else -1, (p + W) if py < H - 1 else -1, (p - 1) if px else -1, (p + 1) if px < W - 1 else -1):
                if q >= 0 and out[q] < 0 and flat[q] == value:
                    out[q] = count; queue.append(q)
        count += 1
    return np.array(out, dtype=np.int32).reshape(H, W)

split_disconnected = components

def adjacency(labels):
    pairs = set()
    for a, b in ((labels[:, :-1], labels[:, 1:]), (labels[:-1, :], labels[1:, :])):
        mask = a != b
        for x, y in zip(a[mask].tolist(), b[mask].tolist()):
            pairs.add((x, y) if x < y else (y, x))
    return pairs

def merge(labels, lab, should_merge):
    """Greedily merge adjacent regions; should_merge(area_a, area_b, delta_e) decides.

    The most similar qualifying pair is merged first; means are area-weighted and
    updated after each merge, so a gradient does not chain into one region.
    """
    n = int(labels.max()) + 1
    flat = labels.ravel()
    area = np.bincount(flat, minlength=n).astype(float).tolist()
    total = np.stack([np.bincount(flat, weights=lab[..., c].ravel(), minlength=n) for c in range(3)], axis=1).tolist()
    neighbours = [set() for _ in range(n)]
    for x, y in adjacency(labels):
        neighbours[x].add(y); neighbours[y].add(x)
    version, parent = [0] * n, list(range(n))
    def distance(a, b):
        return math.dist([v / area[a] for v in total[a]], [v / area[b] for v in total[b]])
    heap = []
    def offer(a, b):
        d = distance(a, b)
        if should_merge(area[a], area[b], d):
            a, b = min(a, b), max(a, b)
            heapq.heappush(heap, (d, a, b, version[a], version[b]))
    for a in range(n):
        for b in neighbours[a]:
            if a < b: offer(a, b)
    while heap:
        _, a, b, va, vb = heapq.heappop(heap)
        if parent[a] != a or parent[b] != b or version[a] != va or version[b] != vb: continue
        keep, gone = (a, b) if (area[a], -a) >= (area[b], -b) else (b, a)
        parent[gone] = keep; area[keep] += area[gone]
        total[keep] = [x + y for x, y in zip(total[keep], total[gone])]
        for other in neighbours[gone]:
            neighbours[other].discard(gone)
            if other != keep: neighbours[other].add(keep); neighbours[keep].add(other)
        neighbours[keep].discard(gone); neighbours[gone] = set()
        version[keep] += 1
        for other in sorted(neighbours[keep]): offer(keep, other)
    def find(i):
        while parent[i] != i: i = parent[i]
        return i
    roots = np.array([find(i) for i in range(n)])
    return roots[labels]

def relabel(labels):
    """Consecutive ids, ordered by first appearance in scan order."""
    _, first, inverse = np.unique(labels.ravel(), return_index=True, return_inverse=True)
    order = np.argsort(np.argsort(first))
    return order[inverse].reshape(labels.shape).astype(np.int32)

def describe(labels, rgb, lab):
    H, W = labels.shape
    n = int(labels.max()) + 1
    flat = labels.ravel()
    yy, xx = np.mgrid[0:H, 0:W]
    area = np.bincount(flat, minlength=n)
    regions = []
    for index in range(n):
        mask = labels == index
        ys, xs = yy[mask], xx[mask]
        pixels = lab[mask]
        regions.append({'id': f'seg-{index}', 'index': index, 'area': int(area[index]), 'areaRatio': float(area[index] / (H * W)),
            'rect': {'x': float(xs.min() / W), 'y': float(ys.min() / H), 'width': float((xs.max() + 1 - xs.min()) / W), 'height': float((ys.max() + 1 - ys.min()) / H)},
            'centroid': {'x': float((xs.mean() + .5) / W), 'y': float((ys.mean() + .5) / H)},
            'meanRgb': rgb[mask].mean(axis=0).tolist(), 'meanLab': pixels.mean(axis=0).tolist(),
            'spread': float(math.sqrt(pixels.var(axis=0).sum()))})
    return regions

def segment(rgb, method='grow', detail=.5):
    """rgb: HxWx3 floats in 0..1 (the analysis image). Returns labels and region records."""
    if method not in METHODS: raise ValueError('未知分割方式')
    small = downsample(rgb)
    lab = to_lab(np.clip(small, 0, 1))
    # Region growing reads a lightly smoothed image, so fine texture does not shatter into specks.
    source = smooth(lab) if method == 'grow' else lab
    labels = {'grow': grow, 'quadtree': quadtree, 'slic': slic}[method](source, detail)
    if method == 'slic':
        # Connectivity leaves fragments; those under a quarter superpixel join a neighbour.
        quarter = labels.size / slic_count(detail) / 4
        labels = merge(labels, lab, lambda a, b, d: min(a, b) < quarter)
        # Superpixels split flat areas by count; neighbours of the same colour become one region.
        labels = merge(labels, lab, lambda a, b, d: d < 2.)
    if method == 'quadtree':
        # Split and merge: neighbouring blocks of similar colour join, across tree boundaries,
        # so shapes are built from blocks instead of a uniform grid.
        similar = threshold(detail) * .5
        labels = merge(labels, lab, lambda a, b, d: d < similar)
    labels = merge(labels, lab, lambda a, b, d: min(a, b) < MIN_AREA)
    labels = relabel(labels)
    return {'version': VERSION, 'method': method, 'detail': float(detail), 'width': labels.shape[1], 'height': labels.shape[0],
        'labels': labels, 'regions': describe(labels, small, lab)}
