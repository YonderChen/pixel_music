const assert = require('node:assert/strict');
const Music = require('../dist/music.js'), Image = require('../dist/image-analysis.js');
const Samples = require('./fidelity-fixtures.js'), Rhythm = require('../dist/rhythm.js'), check = require('./score-contract.cjs');
function solid(rgb) {
  const data = new Uint8ClampedArray(192 * 120 * 4);
  for (let i = 0; i < data.length; i += 4) data.set([...rgb, 255], i);
  return data;
}
for (const rgb of [[255,255,255],[0,0,0],[127,127,127],[255,0,0],[0,255,0],[0,0,255]]) {
  const score = Music.compose(Image.analyzePixels(solid(rgb)));
  assert.equal(score.melody.length, 1, `${rgb}: constant pixels must schedule one sustained event, not a song`);
  assert.equal(score.regionMap.length, 120);
  assert.equal(score.rests.length, 0);
  assert.equal(score.bassEvents.length, 0);
  assert.equal(score.padEvents.length, 0);
  assert.equal(score.rhythmProfile.complexity,0);
  assert.equal(score.melody[0].beats,64);
  assert.ok(score.tempoMap.every(segment=>segment.slope===0));
  check(score);
}
const scores=Samples.names.map((name,i)=>{
  const a=Image.analyzePixels(Samples.pixels(i)),before=JSON.stringify(a),s=Music.compose(a);check(s);
  assert.equal(JSON.stringify(a),before);assert.deepEqual(s,Music.compose(a));
  for(const force of [{forceFallback:true},{forceRhythmFallback:true}]){const simple=Music.compose(a,force);check(simple);assert.deepEqual(simple,Music.compose(a,force));assert.equal(simple.diagnostics.rhythmSimplified,true);}
  const fixed=Music.compose(a,{bpm:88,tempo:false});assert.equal(fixed.rhythmFingerprint,s.rhythmFingerprint);
  return s;
});
for(let i=60;i<74;i++)assert.equal(scores[i].melody.length,1,`${Samples.names[i]} must remain one steady sound`);
assert.ok(scores[74].diagnostics.uniquePitchCount>=5&&scores[74].melody.length<40);
const increasing=scores[74].regionMap.map(r=>r.previewRef.midi);assert.ok(increasing.every((m,i)=>!i||m>=increasing[i-1]),'brightness gradient cannot acquire a fake arch');
assert.ok(scores[82].melody.length>1,'cumulative small gradient cannot be merged away');
assert.ok(scores[76].regionMap[47].voiceEventId!==scores[76].regionMap[0].voiceEventId,'small true patch must survive low global complexity');
for(const i of [77,78,79,80])assert.ok(scores[i].diagnostics.periodicRetriggers>0,`${Samples.names[i]} needs measured structure pulses`);
assert.ok(scores[80].melody.length>scores[81].melody.length,'matched histogram noise must not be busier than organized texture');
assert.ok(scores[80].rhythmProfile.complexity>scores[81].rhythmProfile.complexity);
assert.ok(scores[5].melody.length>10&&scores[8].melody.length>10&&scores[5].scoreHash!==scores[8].scoreHash,'rich images cannot all collapse to a drone');
const homogeneous=Array.from({length:120},(_,sequence)=>({col:Math.floor(sequence/5),row:0,light:.5,hue:0,saturation:0,density:0,localSeed:sequence*7301}));
assert.equal(new Set(Music.mapTargets(homogeneous,0,Music.MODES.soft).map(n=>n.midi)).size,1,'sequence and local hashes cannot invent pitches');
assert.equal(Rhythm.difference(Rhythm.feature(homogeneous[0]),Rhythm.feature(homogeneous[119])),0);
for(const s of scores.slice(60,72))assert.equal(s.rhythmFingerprint,scores[60].rhythmFingerprint,'constant colours may share an identical rhythm');
assert.throws(()=>Music.arrangeRegions([],0,'soft'),/24×5/);
console.log(JSON.stringify({status:'passed',samples:scores.length,constantAndNearConstantCases:14,actualVoiceEvents:scores.reduce((a,s)=>a+s.melody.length,0),white:{onsets:scores[60].melody.length,regions:scores[60].regionMap.length,seconds:scores[60].duration},gradient:{events:scores[74].melody.length,pitches:scores[74].diagnostics.uniquePitchCount},matchedHistogram:{organized:scores[80].melody.length,noise:scores[81].melody.length},cases:scores.map((s,i)=>({name:Samples.names[i],onsets:s.melody.length,complexity:s.rhythmProfile.complexity,pitches:s.diagnostics.uniquePitchCount,periodicRetriggers:s.diagnostics.periodicRetriggers,rests:s.rests.length,bpm:s.bpm,scoreHash:s.scoreHash}))},null,2));
