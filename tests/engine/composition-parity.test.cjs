/* The reference score (upstream generate_composition) matches the former Pyodide engine. */
const assert = require('node:assert/strict');
const {loadEngine, loadOracle} = require('./harness.cjs');
const samples = require('./samples.cjs');
(async () => {
  const PM = loadEngine(), py = await loadOracle();
  py.runPython(`import image_analysis as ia, composition as uc, reference_music as rm, json, base64, dataclasses
def _events(b64, mapping):
    a = ia.analyze_image(ia.open_image_from_bytes(base64.b64decode(b64)), random_factor=0)
    ev, info = rm.original_composition(a, {'mapping': mapping})
    return json.dumps({'events': [dataclasses.asdict(e) for e in ev], 'info': {k: v for k, v in dataclasses.asdict(info).items()},
      'bars': list(uc.compute_bar_settings(a['features']))})`);
  const images = [...samples.builtIn(), ...samples.synthetic(py)];
  let checked = 0;
  const mismatched = [];
  const report = [];
  for (const {name, base64} of images) {
    const {width, height, pixels} = samples.decode(py, base64);
    const result = PM.analysis.analyzeImage(pixels, width, height), f = result.features;
    for (const mapping of ['Scientific', 'Balanced', 'Musical']) {
      py.globals.set('_b64', base64);
      let e;
      try { e = JSON.parse(py.runPython(`_events(_b64, ${JSON.stringify(mapping)})`)); } catch (error) { report.push(`${name} ${mapping}: the Python engine fails (${String(error.message).trim().split('\n').pop()})`); continue; }
      const settings = PM.composition.computeBarSettings(f);
      assert.equal(JSON.stringify(settings), JSON.stringify(e.bars), name + ' bar settings ' + JSON.stringify([settings, e.bars, ['texture_entropy','edge_density','high_frequency_energy','periodic_peak_score'].map(k => f[k])]));
      const bars = Math.max(4, Math.min(16, settings[2]));
      const [events, info] = PM.composition.generateComposition(result, bars, f.auto_complexity, f.auto_variation_strength, 'Automatic', 'Automatic', mapping, null);
      for (const key of ['tempo', 'bars', 'duration', 'key_name', 'scale_name', 'main_instrument', 'texture_instrument', 'bass_instrument', 'pad_instrument', 'chord_instrument', 'mood'])
        assert.ok(key === 'tempo' || key === 'duration' ? Math.abs(info[key] - e.info[key]) < 1e-9 : info[key] === e.info[key], `${name} ${mapping} info.${key}: ${info[key]} vs ${e.info[key]}`);
      const diffs = [];
      if (events.length !== e.events.length) diffs.push(`count ${events.length} vs ${e.events.length}`);
      let maxDiff = 0;
      events.forEach((ev, i) => {
        const x = e.events[i];
        if (!x) return;
        if (['midi', 'instrument', 'layer'].some(k => ev[k] !== x[k])) diffs.push(`event ${i} ${ev.layer} ${ev.midi} vs ${x.layer} ${x.midi}`);
        for (const k of ['start', 'duration', 'velocity', 'pan']) maxDiff = Math.max(maxDiff, Math.abs(ev[k] - x[k]));
      });
      if (!diffs.length) assert.ok(maxDiff < 1e-9, `${name} ${mapping} float diff ${maxDiff}`);
      if (diffs.length) mismatched.push(`${name} ${mapping} (tempo ${info.tempo === e.info.tempo ? 'exact' : 'off by ' + (info.tempo - e.info.tempo)}): ${diffs.slice(0, 3).join('; ')}`);
      checked++;
      report.push(`${name} ${mapping}: ${events.length} events, max float diff ${maxDiff.toExponential(1)}`);
    }
  }
  console.log(report.join('\n') + `\n${checked - mismatched.length}/${checked} scores identical`);
  if (mismatched.length) { console.log(mismatched.join('\n')); process.exitCode = 1; }
})().catch(error => { console.error(error); process.exitCode = 1; });
