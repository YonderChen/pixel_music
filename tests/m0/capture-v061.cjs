// Explicit baseline capture only. Tests never rewrite their expected values.
const { sha256, jsonSha, read, audioTrace } = require('./utils.cjs');
const Music = require('../baseline/music-v061.js');
const Image = require('../baseline/image-analysis-v061.js');
const Audio = require('../baseline/audio-v061.js');
const Samples = require('../baseline/fidelity-fixtures-v061.js');
function capture() {
  const entries = [];
  for (let index = 0; index < Samples.names.length; index++) {
    const pixels = Samples.pixels(index), analysis = Image.analyzePixels(pixels);
    for (const performanceStyle of ['sparse', 'continuous']) {
      const score = Music.compose(analysis, { performanceStyle });
      entries.push({ index, name: Samples.names[index], performanceStyle,
        inputSha256: sha256(pixels), imageHash: analysis.hash,
        fullScoreSha256: jsonSha(score), scoreHash: score.scoreHash,
        mappingFingerprint: score.mappingFingerprint,
        imageRhythmFingerprint: score.imageRhythmFingerprint,
        rhythmFingerprint: score.rhythmFingerprint,
        performanceEventsSha256: jsonSha(score.performanceEvents),
        regionMapSha256: jsonSha(score.regionMap), tempoMapSha256: jsonSha(score.tempoMap),
        audioTraces: Object.fromEntries(['warm', 'glass', 'mist'].map(tone => [tone, jsonSha(audioTrace(Audio, score, tone))]))
      });
    }
  }
  return { version: '0.6.1', schema: 'pixelmusic-baseline-snapshot-v1',
    evidenceType: 'node-events-and-fake-audio-scheduling', images: 84, entries: entries.length,
    audioSchedulingCases: entries.length * 3, scores: entries };
}
function manifest() {
  const moduleNames = ['timing', 'rhythm', 'music', 'image-analysis', 'audio'];
  const pairs = moduleNames.map(name => ({ source: `dist/${name}.js`, frozen: `tests/baseline/${name}-v061.js`, transform: 'rename-umd-and-local-requires-v061' }));
  for (const name of ['fixtures', 'rhythm-fixtures', 'fidelity-fixtures']) pairs.push({ source: `tests/${name}.js`, frozen: `tests/baseline/${name}-v061.js`, transform: 'rename-fixture-umd-and-local-requires-v061' });
  pairs.push({ source: 'tests/fake-audio.cjs', frozen: 'tests/baseline/fake-audio-v061.cjs', transform: 'identity' });
  pairs.push({ source: 'tests/score-contract.cjs', frozen: 'tests/score-contract-v061.cjs', transform: 'require-frozen-music' });
  return { schema: 'pixelmusic-freeze-manifest-v1', version: '0.6.1', frozenOn: '2026-10-07',
    pairs: pairs.map(pair => ({ ...pair, sourceSha256: sha256(read(pair.source)), frozenSha256: sha256(read(pair.frozen)) })),
    production: ['dist/index.html', 'dist/styles.css', 'dist/app.js', 'dist/legacy.js', ...moduleNames.map(name => `dist/${name}.js`)].map(file => ({ path: file, sha256: sha256(read(file)) })) };
}
module.exports = { capture, manifest };
if (require.main === module) console.log(JSON.stringify(process.argv.includes('--manifest') ? manifest() : capture(), null, 2));
