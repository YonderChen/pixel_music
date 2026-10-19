/* Full score payloads (prepare_scores) match the former Pyodide engine for every page recipe.
 * Usage: node scores-parity.test.cjs [imageFilter] [caseFilter] */
const {loadEngine, loadOracle} = require('./harness.cjs');
const samples = require('./samples.cjs');

const BASE = {synth: 'Simple', mapping: 'Scientific', backing: true, rowCount: 4, pitchTransition: 'scale', featureMethod: 'features',
  segmentMethod: 'grow', segmentOrder: 'gaze', contourMusic: false, contourStyle: 'motif', segmentSoft: false};
const CASES = [
  ['reference', {rowMethod: 'reference'}], ['reference-plus', {rowMethod: 'reference-plus'}], ['features', {rowMethod: 'features'}],
  ['transition', {rowMethod: 'transition'}], ['arranged', {rowMethod: 'arranged'}],
  ['reference-3rows-balanced', {rowMethod: 'reference', rowCount: 3, mapping: 'Balanced'}],
  ['arranged-2rows-musical', {rowMethod: 'arranged', rowCount: 2, mapping: 'Musical'}],
  ['features-nobacking', {rowMethod: 'features', backing: false}],
  ...['grow', 'quadtree', 'slic'].flatMap(m => ['gaze', 'tiers', 'scan', 'path', 'salience'].map(o => [`regions-${m}-${o}`, {rowMethod: 'regions', segmentMethod: m, segmentOrder: o}])),
  ['regions-soft', {rowMethod: 'regions', segmentSoft: true}],
  ...['motif', 'grid', 'lines', 'sweep'].flatMap(s => [[`contour-${s}`, {rowMethod: 'regions', contourMusic: true, contourStyle: s}],
    [`contour-${s}-slic-tiers`, {rowMethod: 'regions', contourMusic: true, contourStyle: s, segmentMethod: 'slic', segmentOrder: 'tiers'}]]),
];

// Walks both values; numbers may differ by 1e-9 (relative), everything else must be identical.
function diff(a, b, path, out) {
  if (out.length > 8) return;
  if (typeof a === 'number' && typeof b === 'number') {
    if (a !== b && !(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)))) out.push(`${path}: ${a} vs ${b}`);
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${path}: length ${a.length} vs ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) diff(a[i], b[i], `${path}[${i}]`, out);
    return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in a)) out.push(`${path}.${k}: missing in JS`); else if (!(k in b)) out.push(`${path}.${k}: extra in JS`);
      else diff(a[k], b[k], `${path}.${k}`, out);
    }
    return;
  }
  if (a !== b) out.push(`${path}: ${JSON.stringify(a)?.slice(0, 80)} vs ${JSON.stringify(b)?.slice(0, 80)}`);
}

(async () => {
  const [imageFilter, caseFilter] = process.argv.slice(2);
  const PM = loadEngine(), py = await loadOracle();
  py.runPython(`import reference_music as rm, json, base64, math
def _clean(v):
    if isinstance(v, float) and not math.isfinite(v): return repr(v)
    if isinstance(v, dict): return {k: _clean(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)): return [_clean(x) for x in v]
    return v
def _scores(b64, options):
    payload, _ = rm.prepare_scores(base64.b64decode(b64), json.loads(options))
    payload['image'].pop('src')
    for v in payload['variants'].values(): v.pop('scoreSha256')
    return json.dumps(_clean(payload))`);
  const images = [...samples.builtIn(), ...samples.synthetic(py)].filter(i => !imageFilter || i.name.includes(imageFilter));
  let checked = 0, pyTime = 0, jsTime = 0;
  const failures = [], skipped = [];
  for (const {name, base64} of images) {
    const {width, height, pixels} = samples.decode(py, base64);
    for (const [label, extra] of CASES) {
      if (caseFilter && !label.includes(caseFilter)) continue;
      const options = {...BASE, ...extra};
      py.globals.set('_b64', base64); py.globals.set('_opts', JSON.stringify(options));
      let expected, t = performance.now();
      try { expected = JSON.parse(py.runPython('_scores(_b64, _opts)')); } catch (error) { skipped.push(`${name} ${label}: Python fails (${String(error.message).trim().split('\n').pop()})`); continue; }
      pyTime += performance.now() - t; t = performance.now();
      let actual;
      try { actual = JSON.parse(JSON.stringify(PM.scores.prepareScores(pixels, width, height, options).payload)); } catch (error) { failures.push(`${name} ${label}: JS throws ${error.stack.split('\n').slice(0, 3).join(' | ')}`); continue; }
      jsTime += performance.now() - t;
      const out = [];
      diff(actual, expected, '', out);
      checked++;
      if (out.length) failures.push(`${name} ${label}:\n    ${out.join('\n    ')}`);
    }
  }
  if (skipped.length) console.log(skipped.join('\n'));
  console.log(`${checked - failures.filter(f => !f.includes('JS throws')).length}/${checked} payloads identical (Python ${(pyTime / 1000).toFixed(1)} s, JS ${(jsTime / 1000).toFixed(1)} s)`);
  if (failures.length) { console.log(failures.join('\n')); process.exitCode = 1; }
})().catch(error => { console.error(error); process.exitCode = 1; });
