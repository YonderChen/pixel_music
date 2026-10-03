const assert = require('node:assert/strict');
const Music = require('../dist/music.js'), Image = require('../dist/image-analysis.js'), Legacy = require('../dist/legacy.js'), Fixtures = require('./fixtures.js');
// Captured from the pre-refactor 0.3 app, including its pixel hash, key, mode and tempo.
const digests = ['6deaf0ac60e5dc12', '0dfbfef93185e967', '9ab5e43e0b1aa868', '46b2883d96992e4f', '1a1b7e6a67fbaea2', '276632c0494cbac8', 'fcb47a1775653c9f', '0dc7d4e17b3727e1', 'ec4a8e1da1bc86eb', '72a6724514c84347', '67262fbcf0021bda', 'bae2ca3a50635ee0'];
Fixtures.names.forEach((name, i) => {
  const score = Legacy.compose(Image.analyzePixels(Fixtures.pixels(i)));
  const compact = JSON.stringify({ hash: score.hash, root: score.root, mode: score.mode.name, bpm: score.bpm, notes: score.melody.map(n => [n.col, n.row, n.midi, n.beat, n.beats, n.strong]), bars: score.bars.map(b => [b.bass, b.chord]) });
  assert.equal(Music.digestText(compact), digests[i], `0.3 regression: ${name}`);
});
console.log('Passed 12 original 0.3 golden score/analysis regressions.');
