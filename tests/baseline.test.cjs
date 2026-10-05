const assert = require('node:assert/strict');
const Music = require('./baseline/music-v04.js'), Image = require('./baseline/image-analysis-v04.js');
const Fixtures = require('./fixtures.js'), Snapshot = require('./regression-summary.json');
Fixtures.names.forEach((_, i) => assert.equal(Music.compose(Image.analyzePixels(Fixtures.pixels(i))).scoreHash, Snapshot.scoreHashes[i]));
console.log('Passed: all 12 frozen 0.4 score snapshots.');
