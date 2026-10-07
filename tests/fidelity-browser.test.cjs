const assert=require('node:assert/strict'),Snapshot=require('./fidelity-browser-snapshot.json'),Music=require('./baseline/music-v06.js'),Image=require('./baseline/image-analysis-v06.js'),Samples=require('./fidelity-fixtures.js');
const analyses=Samples.names.map((_,i)=>Image.analyzePixels(Samples.pixels(i)));
assert.equal(Snapshot.scores.length,84);assert.equal(Music.digestText(JSON.stringify(analyses.map(a=>a.hash))),Snapshot.imageBundleHash);
analyses.forEach((a,i)=>{const s=Music.compose(a),expected=Snapshot.scores[i];for(const key of ['scoreHash','mappingFingerprint','rhythmFingerprint'])assert.equal(s[key],expected[key],Samples.names[i]+' '+key);assert.equal(s.melody.length,expected.onsets);});
console.log('Passed: 84 actual browser/Node complete sound, mapping and rhythm snapshots.');
