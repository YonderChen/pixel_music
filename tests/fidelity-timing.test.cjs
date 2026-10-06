const assert=require('node:assert/strict'),Music=require('../dist/music.js'),Image=require('../dist/image-analysis.js'),Samples=require('./fidelity-fixtures.js');
const white=Music.compose(Image.analyzePixels(Samples.pixels(60)));
assert.equal(white.melodyDuration,64*60/76);assert.ok(white.tempoMap.every(s=>s.slope===0));
const indices=[];for(let second=0;second<white.melodyDuration;second+=.1){const p=Music.playbackPosition(white,second);indices.push(p.index);assert.equal(p.soundIndex,0);assert.equal(p.note.id,'voice-0');assert.ok(!p.rest);}
assert.equal(new Set(indices).size,120);assert.ok(indices.every((v,i)=>!i||v>=indices[i-1]));
assert.equal(Music.playbackPosition(white,white.melodyDuration+.5).tail,true);assert.equal(Music.playbackPosition(white,white.duration).finished,true);
const score=Music.compose(Image.analyzePixels(Samples.pixels(6))),rest=score.rests[0];assert.ok(rest);
const a=Music.playbackPosition(score,Music.beatToTime(score,rest.beat+.025)),b=Music.playbackPosition(score,Music.beatToTime(score,rest.beat+rest.beats-.025));
assert.equal(a.rest,true);assert.equal(a.index,b.index);assert.equal(a.scanFraction,b.scanFraction);
const late=structuredClone(white);late.regionMap[0].startBeat=.5;late.melody[0].beat=.5;
assert.equal(Music.playbackPosition(late,Music.beatToTime(late,.25)).index,-1);assert.equal(Music.playbackPosition(late,Music.beatToTime(late,.25)).note,null);
for(const mutate of [s=>s.melody[0].velocity+=.001,s=>s.tempoMap[0].slope+=.001,s=>s.bassEvents[0].beat+=.25]){
  const changed=structuredClone(score);mutate(changed);assert.notEqual(Music.scoreFingerprint(changed),score.scoreHash);
}
const renamed={...white,name:'another-name.png'};assert.equal(Music.scoreFingerprint(renamed),white.scoreHash);
const otherMapping=structuredClone(white);otherMapping.regionMap[0].sequence=10;
assert.equal(Music.scoreFingerprint(otherMapping),white.scoreHash,'mapping metadata cannot pretend the actual sound changed');
console.log('Passed: 120 scan regions/one sustained voice, natural end, real rests, silent entrance and audible-only score fingerprints.');
