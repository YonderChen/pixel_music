/* Region segmentation (all methods, with and without soft outlines) matches the former Pyodide engine. */
const assert = require('node:assert/strict');
const {loadEngine, loadOracle} = require('./harness.cjs');
const samples = require('./samples.cjs');
(async () => {
  const PM = loadEngine(), py = await loadOracle();
  if (!PM.libm) { console.log('(libm.js missing: using Math.* stand-ins)'); PM.libm = {pow: Math.pow, cbrt: Math.cbrt, atan2: Math.atan2}; }
  py.runPython(`import image_analysis as ia, segmentation as seg, json, base64, numpy as np
def _seg(b64, method, soft):
    a = ia.analyze_image(ia.open_image_from_bytes(base64.b64decode(b64)), random_factor=0)
    r = seg.segment(a['maps']['rgb'], method, .5, soft=soft)
    shapes = seg.shapes(r['labels'])
    return json.dumps({'labels': r['labels'].ravel().tolist(), 'regions': r['regions'], 'size': [r['height'], r['width']],
      'shapes': [{k: v for k, v in s.items() if k != 'boundary'} | {'boundary': np.nonzero(s['boundary'].ravel())[0].tolist()} for s in shapes],
      'outlines': seg.outlines(r['labels']) if soft else None})`);
  const images = [...samples.builtIn(), ...samples.synthetic(py)].filter(s => s.name !== 'tiny');
  const report = [], mismatched = [];
  const close = (a, b, path) => {
    if (typeof a === 'number' && typeof b === 'number') { if (a !== b) throw new Error(`${path}: ${a} vs ${b}`); return; }
    if (Array.isArray(b)) { if (a.length !== b.length) throw new Error(`${path}: length ${a.length} vs ${b.length}`); b.forEach((v, i) => close(a[i], v, `${path}[${i}]`)); return; }
    if (b && typeof b === 'object') { for (const k of Object.keys(b)) close(a[k], b[k], `${path}.${k}`); return; }
    if (a !== b) throw new Error(`${path}: ${a} vs ${b}`);
  };
  for (const {name, base64} of images) {
    const {width, height, pixels} = samples.decode(py, base64);
    const analysis = PM.analysis.analyzeImage(pixels, width, height), {rgb, width: w, height: h} = analysis.maps;
    for (const method of ['grow', 'quadtree', 'slic']) for (const soft of [false, true]) {
      py.globals.set('_b64', base64);
      const e = JSON.parse(py.runPython(`_seg(_b64, '${method}', ${soft ? 'True' : 'False'})`));
      const r = PM.segmentation.segment(rgb, h, w, method, .5, soft);
      const label = `${name} ${method}${soft ? ' soft' : ''}`;
      try {
        assert.deepEqual([r.height, r.width], e.size);
        close(Array.from(r.labels), e.labels, 'labels');
        close(r.regions, e.regions, 'regions');
        const shapes = PM.segmentation.shapes(r.labels, r.height, r.width).map(s => ({...s, profile: s.profile, boundary: [...s.boundary.keys()].filter(i => s.boundary[i])}));
        close(shapes, e.shapes, 'shapes');
        if (soft) close(PM.segmentation.outlines(r.labels, r.height, r.width), e.outlines, 'outlines');
        report.push(`${label}: ${r.regions.length} regions identical`);
      } catch (error) { mismatched.push(`${label}: ${error.message}`); }
    }
  }
  console.log(report.join('\n'));
  console.log(`${report.length}/${report.length + mismatched.length} segmentations identical`);
  if (mismatched.length) { console.log(mismatched.join('\n')); process.exitCode = 1; }
})().catch(error => { console.error(error); process.exitCode = 1; });
