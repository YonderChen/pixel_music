/* Image mood (dist/engine/mood.js): valence and arousal move the right way, the mood drives the
 * scale, tempo, instruments and ensemble when options.emotion is on, and with it off the
 * payload is exactly what the upstream rules give. Run: node tests/mood.test.cjs */
const assert = require('node:assert/strict');
const {loadEngine} = require('./engine/harness.cjs');
const {builtIn} = require('./engine/samples.cjs');
const PM = loadEngine(), M = PM.mood;

const typical = {mean_brightness: .45, mean_saturation: .3, warmth: .03, shadow_proportion: .12, contrast: .17,
  high_frequency_energy: .2, texture_entropy: .62};
const at = changes => M.estimate({...typical, ...changes});
assert.ok(Math.abs(at({}).valence - .5) < 1e-12 && Math.abs(at({}).arousal - .5) < 1e-12, 'typical features sit in the middle');
assert.equal(at({}).id, 'calm');
assert.ok(at({mean_brightness: .8}).valence > .7 && at({mean_brightness: .15}).valence < .3, 'brightness moves valence');
assert.ok(at({shadow_proportion: .45}).valence < .5, 'shadows lower valence');
assert.ok(at({contrast: .35, high_frequency_energy: .4}).arousal > .7, 'contrast and detail raise arousal');
assert.equal(at({mean_brightness: .85, mean_saturation: .5, contrast: .3, high_frequency_energy: .4}).id, 'joyful');
assert.equal(at({mean_brightness: .15, contrast: .05, high_frequency_energy: .02, texture_entropy: .3}).id, 'melancholy');
for (const brightness of [0, .3, .6, 1]) for (const contrast of [0, .2, .6]) {
  const m = at({mean_brightness: brightness, contrast});
  assert.ok(m.valence > 0 && m.valence < 1 && m.arousal > 0 && m.arousal < 1, 'scores stay inside (0, 1)');
  assert.ok(m.tempo >= 56 && m.tempo <= 140 && PM.composition.SCALES[m.scale], 'tempo and scale are valid');
}
assert.ok(at({contrast: .4}).tempo > at({contrast: .05}).tempo, 'energetic images play faster');
assert.deepEqual(at({mean_brightness: .9}).valenceReasons, ['画面明亮'], 'reasons name what moved the score');

(async () => {
  const sample = builtIn().find(s => s.name === 'starry-night'), file = Buffer.from(sample.base64, 'base64');
  const {pixels, width, height} = await PM.handler.decodeFile(file);
  for (const rowMethod of ['regions', 'arranged', 'reference', 'transition']) {
    const options = {rowMethod, contourMusic: true};
    const plain = JSON.stringify(PM.scores.prepareScores(pixels, width, height, options).payload);
    assert.equal(JSON.stringify(PM.scores.prepareScores(pixels, width, height, {...options, emotion: false}).payload), plain, `${rowMethod}: off is the upstream payload`);
    const {payload} = PM.scores.prepareScores(pixels, width, height, {...options, emotion: true}), mood = payload.info.emotion;
    assert.equal(payload.settings.emotion, true);
    assert.equal(mood.id, 'tense');
    assert.equal(payload.info.scale_name, mood.scale);
    assert.equal(payload.info.tempo, mood.tempo);
    assert.equal(payload.info.main_instrument, mood.instruments[0]);
    if (rowMethod === 'arranged') assert.equal(payload.variants.parallel.arrangement.ensemble, '夜色弦乐');
    for (const variant of Object.values(payload.variants)) for (const e of variant.events) {
      assert.ok(e.velocity >= .02 && e.velocity <= 1, `${rowMethod}: velocity in range`);
      assert.ok(e.toneScale > 0 && e.attackScale > 0, `${rowMethod}: touch is set`);
    }
  }
  const off = (await PM.handler.handle('/api/generate', {file, key: 'k', options: {rowMethod: 'regions'}})).data;
  assert.equal(off.mood.id, 'tense', 'the page is told the mood even when it does not drive the music');
  assert.equal(off.settings.emotion, undefined);
  console.log('passed: valence and arousal directions, mood labels, tempo and scale ranges, mood-driven scale, tempo, instruments and ensemble, off equals upstream');
})().catch(error => { console.error(error); process.exit(1); });
