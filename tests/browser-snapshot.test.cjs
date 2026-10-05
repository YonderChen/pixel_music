const assert = require('node:assert/strict');
const Music = require('../dist/music.js'), Image = require('../dist/image-analysis.js');
const Fixtures = require('./fixtures.js'), Extended = require('./rhythm-fixtures.js');
const Snapshot = require('./browser-score-snapshot.json');
const images = [...Fixtures.names, ...Extended.names].map((_, i) => Image.analyzePixels(i < 12 ? Fixtures.pixels(i) : Extended.pixels(i - 12)));
assert.equal(Snapshot.scoreHashes.length, 60);
assert.equal(Music.digestText(JSON.stringify(images.map(i => i.hash))), Snapshot.imageBundleHash, 'browser and Node fixtures must have the same canonical pixels');
images.forEach((image, i) => assert.equal(Music.compose(image).scoreHash, Snapshot.scoreHashes[i], `browser/Node audible-event mismatch at fixture ${i}`));
console.log('Passed: all 60 real-browser score snapshots match Node, including pitch, rhythm, performance, accompaniment and tempo.');
