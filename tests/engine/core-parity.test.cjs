/* Core numeric helpers reproduce NumPy / CPython results bit for bit. */
const assert = require('node:assert/strict');
const {loadEngine, loadOracle, rng} = require('./harness.cjs');
(async () => {
  const {np} = loadEngine(['core.js', 'libm.js']), py = await loadOracle(), random = rng(7);
  const call = (code, data) => JSON.parse(py.runPython(`import json, math, numpy as np\ndata = json.loads(${JSON.stringify(JSON.stringify(data))})\n${code}`));
  const values = n => Array.from({length: n}, () => (random() - .3) * 10 ** Math.floor(random() * 6 - 3));
  let checks = 0;
  for (const n of [1, 3, 7, 8, 9, 15, 16, 17, 100, 127, 128, 129, 255, 500, 1000, 4099, 8192, 8193, 20000, 50000, 92160, 174592]) {
    const a = values(n);
    const [s, m, sd, med, p] = call('json.dumps([float(np.sum(np.array(data))), float(np.mean(np.array(data))), float(np.std(np.array(data))), float(np.median(np.array(data))), [float(np.percentile(np.array(data), q)) for q in (0, 8, 10, 35, 50, 75, 90, 96, 99.7, 100)]])', a);
    assert.equal(np.sum(a), s, 'sum ' + n); assert.equal(np.mean(a), m, 'mean ' + n); assert.equal(np.std(a), sd, 'std ' + n);
    assert.equal(np.median(a), med, 'median ' + n);
    assert.deepEqual([0, 8, 10, 35, 50, 75, 90, 96, 99.7, 100].map(q => np.percentile(a, q)), p, 'percentile ' + n);
    checks += 5;
  }
  for (const [H, W, y0, y1, x0, x1] of [[50, 60, 5, 30, 3, 20], [50, 60, 5, 30, 0, 60], [341, 512, 0, 341, 1, 512], [512, 341, 0, 512, 0, 30], [512, 341, 0, 128, 0, 64], [512, 341, 0, 512, 7, 8], [300, 300, 0, 300, 0, 299], [120, 192, 3, 4, 0, 50]]) {
    const a = values(H * W);
    const expected = call(`a = np.array(data['a']).reshape(${H}, ${W}); v = a[${y0}:${y1}, ${x0}:${x1}]\njson.dumps([float(np.sum(v)), float(np.mean(v))])`, {a});
    const s = np.sumView(Float64Array.from(a), y0 * W + x0, y1 - y0, x1 - x0, W, 1);
    assert.equal(s, expected[0], `view ${H}x${W}[${y0}:${y1},${x0}:${x1}]`);
    assert.equal(s / ((y1 - y0) * (x1 - x0)), expected[1]);
    const rgb = values(H * W * 3);
    const channel = call(`a = np.array(data).reshape(${H}, ${W}, 3)\njson.dumps([float(np.sum(a[..., 0])), float(np.sum(a[${y0}:${y1}, ${x0}:${x1}, 2]))])`, rgb);
    assert.equal(np.sumView(Float64Array.from(rgb), 0, H, W, W * 3, 3), channel[0], 'channel view');
    assert.equal(np.sumView(Float64Array.from(rgb), (y0 * W + x0) * 3 + 2, y1 - y0, x1 - x0, W * 3, 3), channel[1], 'channel sub-view');
    checks += 4;
  }
  const xs = values(200).map(Math.abs), rounding = [.5, 1.5, 2.5, -.5, -1.5, -2.5, 2.4999999, 7.5000001, 1e15 + .5, ...values(50)];
  const scalar = call('json.dumps([[round(x) for x in data["r"]], [float(np.round(x)) for x in data["r"]], [x % 1.0 for x in data["r"]], [x % -6.0 for x in data["r"]], [float(np.interp(x, [0, 1], [-5, 7])) for x in data["x"]], [float(np.interp(x, [0, .3, 1, 4], [3, 9, 2, 5])) for x in data["x"]], np.linspace(-.45, .45, 7).tolist(), np.linspace(0, 1, 65).tolist(), np.linspace(3, 3, 4).tolist(), np.hanning(1).tolist(), np.hanning(7).tolist(), np.hanning(64).tolist()])', {r: rounding, x: xs.map(x => x / 100)});
  assert.deepEqual(rounding.map(np.round), scalar[0]); assert.deepEqual(rounding.map(np.round), scalar[1].map(x => x + 0));
  assert.deepEqual(rounding.map(x => np.mod(x, 1)), scalar[2]); assert.deepEqual(rounding.map(x => np.mod(x, -6)), scalar[3]);
  assert.deepEqual(xs.map(x => np.interp(x / 100, [0, 1], [-5, 7])), scalar[4]);
  assert.deepEqual(xs.map(x => np.interp(x / 100, [0, .3, 1, 4], [3, 9, 2, 5])), scalar[5]);
  assert.deepEqual(Array.from(np.linspace(-.45, .45, 7)), scalar[6]); assert.deepEqual(Array.from(np.linspace(0, 1, 65)), scalar[7]);
  assert.deepEqual(Array.from(np.linspace(3, 3, 4)), scalar[8]);
  assert.deepEqual(Array.from(np.hanning(1)), scalar[9]); assert.deepEqual(Array.from(np.hanning(7)), scalar[10]); assert.deepEqual(Array.from(np.hanning(64)), scalar[11]);
  checks += 12;
  const g = values(13 * 9), [gy, gx] = np.gradient(Float64Array.from(g), 13, 9);
  assert.deepEqual([Array.from(gy), Array.from(gx)], call('a = np.array(data).reshape(13, 9)\ngy, gx = np.gradient(a)\njson.dumps([gy.ravel().tolist(), gx.ravel().tolist()])', g));
  const points = Array.from({length: 300}, () => [values(3), values(3)]);
  assert.deepEqual(points.map(([p, q]) => np.dist(p, q)), call('json.dumps([math.dist(p, q) for p, q in data])', points));
  assert.deepEqual(points.map(([p, q]) => np.hypot(p[0] - q[0], p[1] - q[1])), call('json.dumps([math.hypot(p[0] - q[0], p[1] - q[1]) for p, q in data])', points));
  checks += 3;
  console.log(`core parity: ${checks} checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
