const assert = require('node:assert/strict');
const vm = require('node:vm');
const { read, readJson, sha256, jsonSha, audioTrace } = require('./m0/utils.cjs');
const manifest = readJson('tests/baseline/v061-manifest.json');
const expected = readJson('tests/baseline/v061-score-snapshot.json');
const { capture } = require('./m0/capture-v061.cjs');
const Music = require('../dist/music.js'), Image = require('../dist/image-analysis.js'), Audio = require('../dist/audio.js');
const FrozenMusic = require('./baseline/music-v061.js');
const Samples = require('./baseline/fidelity-fixtures-v061.js');
const check = require('./score-contract-v061.cjs');
for (const pair of manifest.pairs) {
  const frozen = read(pair.frozen);
  assert.equal(sha256(frozen), pair.frozenSha256, pair.frozen);
  const original = pair.transform === 'require-frozen-music'
    ? frozen.toString().replace("require('./baseline/music-v061.js')", "require('../dist/music.js')")
    : frozen.toString().replace(/-v061\.js/g, '.js').replace(/(PixelMusic(?:Timing|Rhythm|Image|Audio|FidelityFixtures|RhythmFixtures|Fixtures)?)V061\b/g, '$1');
  assert.equal(sha256(original), pair.sourceSha256, 'only declared freeze renames: ' + pair.source);
}
assert.deepEqual(capture(), expected, 'frozen inputs and snapshots must never drift');
const sandbox = {}; sandbox.window = sandbox;
const context = vm.createContext(sandbox);
for (const name of ['timing', 'rhythm', 'music', 'image-analysis', 'audio']) new vm.Script(read(`tests/baseline/${name}-v061.js`).toString()).runInContext(context);
let resumes = 0;
for (const entry of expected.scores) {
  const input = Samples.pixels(entry.index), before = sha256(input);
  const analysis = Image.analyzePixels(input), score = Music.compose(analysis, { performanceStyle: entry.performanceStyle });
  assert.equal(sha256(input), before); check(score);
  assert.deepEqual(score, FrozenMusic.compose(analysis, { performanceStyle: entry.performanceStyle }));
  assert.equal(jsonSha(score), entry.fullScoreSha256);
  const browserScore = context.PixelMusicV061.compose(context.PixelMusicImageV061.analyzePixels(input), { performanceStyle: entry.performanceStyle });
  assert.equal(jsonSha(browserScore), entry.fullScoreSha256, 'classic-script frozen branch');
  for (const tone of ['warm', 'glass', 'mist']) {
    assert.equal(jsonSha(audioTrace(Audio, score, tone)), entry.audioTraces[tone]);
    for (const fromBeat of [.5, 1.5, 32.25, 63.5]) {
      assert.deepEqual(audioTrace(Audio, score, tone, fromBeat), audioTrace(require('./baseline/audio-v061.js'), score, tone, fromBeat)); resumes++;
    }
  }
}
console.log(JSON.stringify({ status: 'passed', frozenFiles: manifest.pairs.length, images: 84, exactScores: 168, audioSchedulingCases: 504, resumeCases: resumes, frozenClassicScriptSnapshots: 168, realAudioRendered: false }));
