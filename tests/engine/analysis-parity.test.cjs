/* Image resize and feature analysis match the former Pyodide engine. */
const assert = require('node:assert/strict');
const {loadEngine, loadOracle} = require('./harness.cjs');
const samples = require('./samples.cjs');
(async () => {
  const PM = loadEngine(), py = await loadOracle();
  py.runPython('import image_analysis as ia, numpy as np, json');
  const images = [...samples.builtIn(), ...samples.synthetic(py)];
  const report = [];
  for (const {name, base64} of images) {
    const {width, height, pixels} = samples.decode(py, base64);
    py.globals.set('_b64', base64);
    const expected = py.runPython(`
_img = ia.open_image_from_bytes(base64.b64decode(_b64))
_a = ia.analyze_image(_img, random_factor=0)
_m = _a['maps']
json.dumps({'features': _a['features'], 'rgb': _m['rgb'].ravel().tolist(), 'lum': _m['luminance'].ravel().tolist(),
  'edge': _m['edge_map'].ravel().tolist(), 'sal': _m['saliency_map'].ravel().tolist(), 'shape': list(_m['luminance'].shape)})`);
    const e = JSON.parse(expected), actual = PM.analysis.analyzeImage(pixels, width, height);
    assert.deepEqual([actual.maps.height, actual.maps.width], e.shape, name + ' size');
    const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
    assert.ok(same(actual.maps.rgb, e.rgb), name + ' resized pixels');
    assert.ok(same(actual.maps.luminance, e.lum), name + ' luminance');
    const maxDiff = (a, b) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);
    const exact = [], close = [];
    for (const [key, value] of Object.entries(e.features)) {
      const diff = Math.abs(actual.features[key] - value);
      if (diff === 0) exact.push(key); else close.push(key + ' ' + diff.toExponential(1));
      assert.ok(diff < 1e-9, `${name} ${key}: ${actual.features[key]} vs ${value}`);
    }
    assert.equal(Object.keys(actual.features).length, Object.keys(e.features).length, name + ' feature keys');
    report.push(`${name} ${width}x${height}: ${exact.length} exact, edge max diff ${maxDiff(actual.maps.edge_map, e.edge).toExponential(1)}, saliency ${maxDiff(actual.maps.saliency_map, e.sal).toExponential(1)}; not bit-exact: ${close.join(', ') || 'none'}`);
  }
  console.log(report.join('\n'));
})().catch(error => { console.error(error); process.exitCode = 1; });
