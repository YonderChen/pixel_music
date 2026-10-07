const assert=require('node:assert/strict'),Snapshot=require('./articulation-browser-snapshot.json'),Music=require('../dist/music.js'),Image=require('../dist/image-analysis.js'),Fixtures=require('./fidelity-fixtures.js');
assert.equal(Snapshot.entries.length,168);
Snapshot.entries.forEach(e=>{const s=Music.compose(Image.analyzePixels(Fixtures.pixels(e.index)),{performanceStyle:e.style});for(const key of ['scoreHash','mappingFingerprint','imageRhythmFingerprint','rhythmFingerprint'])assert.equal(s[key],e[key],e.name+' '+e.style+' '+key);assert.equal(s.performanceEvents.length,e.attacks);});
console.log('Passed: all 168 real-browser/Node sound, mapping, image-rhythm and performance-rhythm snapshots.');
