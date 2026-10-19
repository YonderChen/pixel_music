/* Every audio route of the page (whole scores, row mixes, soft mixes, hover atlases, note
 * previews, shared performances) sounds the same as the former Pyodide engine: the 16-bit
 * samples may differ by a few steps (floating-point order in long sums), metrics by 1e-4.
 * Usage: node audio-parity.test.cjs [imageFilter] */
const assert = require('node:assert/strict');
const {loadEngine, loadOracle} = require('./harness.cjs');
const samples = require('./samples.cjs');

const STEP_LIMIT = 4; // int16 steps
function compareWav(label, a, b, out) {
  if (a.length !== b.length) { out.push(`${label}: ${a.length} vs ${b.length} bytes`); return 0; }
  const va = new DataView(a.buffer, a.byteOffset, a.byteLength), vb = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < 44; i++) if (a[i] !== b[i]) { out.push(`${label}: WAV header differs at byte ${i}`); return 0; }
  let worst = 0, differing = 0;
  for (let i = 44; i < a.length; i += 2) { const d = Math.abs(va.getInt16(i, true) - vb.getInt16(i, true)); if (d) differing++; worst = Math.max(worst, d); }
  if (worst > STEP_LIMIT) out.push(`${label}: samples differ by up to ${worst} steps`);
  return {worst, differing, total: (a.length - 44) / 2};
}
function compareMetrics(label, a, b, out) {
  for (const k of Object.keys(b)) if (!(Math.abs(a[k] - b[k]) <= 1e-4 * Math.max(1, Math.abs(b[k])))) out.push(`${label}: metrics.${k} ${a[k]} vs ${b[k]}`);
}
function compareJson(label, a, b, out) {
  const strip = v => JSON.parse(JSON.stringify(v, (k, x) => (k === 'src' || k === 'scoreSha256' || k === 'metrics' ? undefined : typeof x === 'number' ? Number(x.toPrecision(9)) : x)));
  try { assert.deepStrictEqual(strip(a), strip(b)); } catch (error) { out.push(`${label}: JSON differs ${String(error.message).slice(0, 600)}`); }
}

(async () => {
  const [imageFilter] = process.argv.slice(2);
  const PM = loadEngine(), py = await loadOracle();
  py.runPython(`import json, base64, browser_engine
def _call(path, data):
    r = json.loads(browser_engine.handle(json.dumps({'path': path, 'data': json.loads(data)})))
    if 'file' in r:
        import pathlib
        b = pathlib.Path(r['file']).read_bytes()
        return json.dumps({'bytes': base64.b64encode(b).decode(), 'metrics': r['metrics']})
    return json.dumps({'data': r})`);
  const call = (path, data = {}) => {
    py.globals.set('_path', path); py.globals.set('_data', JSON.stringify(data));
    const r = JSON.parse(py.runPython('_call(_path, _data)'));
    if (r.bytes) r.bytes = Uint8Array.from(Buffer.from(r.bytes, 'base64'));
    return r;
  };
  const images = [...samples.builtIn(), ...samples.synthetic(py)].filter(i => !imageFilter || i.name.includes(imageFilter)).filter(i => i.name !== 'tiny');
  const OPTIONS = [{rowMethod: 'reference'}, {rowMethod: 'arranged'}, {rowMethod: 'regions', contourMusic: true, contourStyle: 'sweep'}, {rowMethod: 'transition', backing: false}];
  const failures = [], report = [];
  let worstOverall = 0, checks = 0;
  const pick = images.filter((_, i) => i % 3 === 0);
  for (const [n, {name, base64}] of pick.entries()) {
    const options = {synth: 'Simple', mapping: 'Scientific', backing: true, rowCount: 4, pitchTransition: 'scale', featureMethod: 'features',
      segmentMethod: 'grow', segmentOrder: 'gaze', contourMusic: false, contourStyle: 'motif', segmentSoft: false, ...OPTIONS[n % OPTIONS.length]};
    const out = [];
    const expected = call('/api/generate', {image: base64, options}).data, key = expected.key;
    const actual = (await PM.handler.handle('/api/generate', {file: Uint8Array.from(Buffer.from(base64, 'base64')), options, key})).data;
    compareJson(`${name} generate`, actual, expected, out);
    const routes = [['/api/audio/KEY/reference.wav'], ['/api/audio/KEY/features.wav'], ['/api/audio/KEY/parallel.wav'], ['/api/audio/KEY/parallel-soft.wav']];
    const rows = expected.variants.parallel.voices.map(v => v.id);
    routes.push(['/api/rowmix', {key, rows: rows.slice(0, 1), background: true, profile: 'original'}], ['/api/rowmix', {key, rows: rows.slice(1), background: false, profile: 'soft'}]);
    for (const variant of ['reference', 'parallel']) for (const profile of ['original', 'soft']) {
      if (variant === 'reference' && profile === 'soft') continue;
      routes.push(['/api/hover-bank', {key, variant, profile}], [`/api/hover-audio/KEY/${variant}-${variant === 'parallel' ? profile : 'original'}.wav`]);
    }
    const mainEvent = expected.variants.parallel.events.find(e => e.layer === 'main');
    if (mainEvent) routes.push(['/api/preview', {key, variant: 'parallel', eventId: mainEvent.id, profile: 'soft'}], ['/api/preview', {key, variant: 'parallel', eventId: mainEvent.id, profile: 'original'}]);
    routes.push(['/api/preview', {key, variant: 'reference', eventId: expected.variants.reference.events.find(e => e.layer === 'main').id}]);
    const p = expected.variants.parallel;
    routes.push(['/api/performance', {events: p.events, info: expected.info, synth: 'Simple', voices: p.voices, backing: options.backing, variant: 'parallel', profile: 'soft', rows, background: true}]);
    for (const [route, data = {}] of routes) {
      const path = route.replace('KEY', key), label = `${name} ${path}${data.profile ? ' ' + data.profile : ''}`;
      const e = call(path, data), a = PM.handler.handle(path, data);
      checks++;
      if (e.data) { compareJson(label, a.data, e.data, out); continue; }
      const r = compareWav(label, a.bytes, e.bytes, out);
      compareMetrics(label, a.metrics, e.metrics, out);
      if (r) { worstOverall = Math.max(worstOverall, r.worst); report.push(`${label}: ${r.total} samples, ${r.differing} differ, max ${r.worst} steps`); }
    }
    // generate after hover/soft render: payload soft-mix metadata must match too.
    compareJson(`${name} soft metadata`, PM.handler.entries.get(key).payload.variants.parallel.mixProfiles.soft, JSON.parse(py.runPython(`json.dumps(browser_engine.ENTRIES['${key}']['payload']['variants']['parallel']['mixProfiles']['soft'])`)), out);
    if (out.length) failures.push(...out);
  }
  console.log(report.join('\n'));
  console.log(`${checks} audio/JSON routes checked; worst sample difference ${worstOverall} of 32767 steps`);
  if (failures.length) { console.log('FAILURES\n' + failures.join('\n')); process.exitCode = 1; }
})().catch(error => { console.error(error); process.exitCode = 1; });
