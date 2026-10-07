const assert=require('node:assert/strict'),Music=require('../dist/music.js'),Image=require('../dist/image-analysis.js'),Samples=require('./fidelity-fixtures.js');
const OldMusic=require('./baseline/music-v06.js'),OldImage=require('./baseline/image-analysis-v06.js');
const check=require('./score-contract.cjs');
const imageEvents=score=>score.melody.map(n=>[n.beat,n.beats,n.midi,n.durationBeats,n.velocity,n.send]);
let alteredImages=0;const results=[];
for(let index=0;index<Samples.names.length;index++){
  const a=Image.analyzePixels(Samples.pixels(index)),before=JSON.stringify(a),s=Music.compose(a),continuous=Music.compose(a,{performanceStyle:'continuous'}),old=OldMusic.compose(OldImage.analyzePixels(Samples.pixels(index)));
  assert.equal(s.version,'0.6.1');assert.equal(JSON.stringify(a),before);assert.deepEqual(s,Music.compose(a));
  check(s);check(continuous);
  assert.deepEqual(imageEvents(s),imageEvents(old),'image pitch, grouping and rhythm must not change');
  assert.deepEqual(continuous.performanceEvents.map(n=>[n.beat,n.beats,n.midi,n.durationBeats,n.velocity,n.send]),imageEvents(old));
  assert.deepEqual(continuous.tempoMap,old.tempoMap);assert.equal(s.imageRhythmFingerprint,old.rhythmFingerprint);
  assert.equal(s.regionMap.length,120);assert.equal(new Set(s.regionMap.map(r=>r.regionId)).size,120);
  assert.deepEqual(s.regionMap.map(r=>[r.regionId,r.startBeat,r.endBeat]),old.regionMap.map(r=>[r.regionId,r.startBeat,r.endBeat]));
  const sources=new Map(s.melody.map(e=>[e.id,e]));
  s.performanceEvents.forEach((event,i)=>{
    const source=sources.get(event.sourceEventId);assert.ok(source);assert.equal(event.midi,source.midi);assert.equal(event.velocity,source.velocity);
    assert.ok(!i||event.beat>s.performanceEvents[i-1].beat);assert.ok(event.durationBeats>0&&event.beat+event.durationBeats<=source.beat+source.beats);
    if(event.envelope==='pluck'){assert.equal(event.origin,'performance-rule');assert.ok(event.durationBeats<=1.25);assert.ok(source.beats>=6);}
  });
  const spans=[...s.performanceEvents.map(e=>[e.beat,e.beat+e.beats]),...s.performanceRests.map(r=>[r.beat,r.beat+r.beats]),...s.rests.map(r=>[r.beat,r.beat+r.beats])].sort((x,y)=>x[0]-y[0]);
  assert.equal(spans[0][0],0);assert.equal(spans.at(-1)[1],64);spans.forEach((span,i)=>{if(i)assert.ok(Math.abs(span[0]-spans[i-1][1])<1e-9);});
  const pulsedIds=new Set(s.diagnostics.performanceDecisions.filter(d=>d.sparse).map(d=>d.sourceEventId));
  s.bassEvents.forEach(e=>assert.ok(!pulsedIds.has(e.featureSupport.sourceEventId)));
  s.padEvents.forEach(e=>assert.ok(e.featureSupport.sourceEventIds.every(id=>!pulsedIds.has(id))));
  for(const region of s.regionMap){const preview=Music.previewForRegion(s,region.sequence);assert.equal(preview.midi,sources.get(region.voiceEventId).midi);}
  const fixed=Music.compose(a,{bpm:88,tempo:false});assert.equal(fixed.rhythmFingerprint,s.rhythmFingerprint);
  assert.equal(Music.scoreFingerprint(s),s.scoreHash);assert.equal(Music.rhythmFingerprint(s),s.rhythmFingerprint);
  if(pulsedIds.size)alteredImages++;
  results.push({index,name:Samples.names[index],imageSegments:s.melody.length,attacks:s.performanceEvents.length,pulsedSegments:pulsedIds.size,scoreHash:s.scoreHash});
}
const white=Music.compose(Image.analyzePixels(Samples.pixels(60)));
assert.equal(white.melody.length,1);assert.equal(white.performanceEvents.length,22);assert.equal(new Set(white.performanceEvents.map(e=>e.midi)).size,1);
assert.equal(white.bassEvents.length,0);assert.equal(white.padEvents.length,0);assert.equal(white.rests.length,0);assert.ok(white.performanceRests.length>0);
for(let i=1;i<white.performanceEvents.length;i++)assert.equal(white.performanceEvents[i].beat-white.performanceEvents[i-1].beat,3);
const gap=white.performanceRests[0],p1=Music.playbackPosition(white,Music.beatToTime(white,gap.beat+.1)),p2=Music.playbackPosition(white,Music.beatToTime(white,gap.beat+gap.beats-.1));
assert.ok(p1.performanceRest&&p2.performanceRest);assert.equal(p1.rest,false);assert.ok(p2.index>p1.index&&p2.scanFraction>p1.scanFraction,'performance silence must not freeze image scanning');
for(const index of [5,74,77]){const s=Music.compose(Image.analyzePixels(Samples.pixels(index)));assert.ok(s.diagnostics.performanceDecisions.every(d=>!d.sparse),'do not overlay a common pulse on rich, gradual or periodic short image events');}
assert.throws(()=>Music.compose(Image.analyzePixels(Samples.pixels(60)),{performanceStyle:'unknown'}),/演奏方式/);
console.log(JSON.stringify({status:'passed',images:84,alteredImages,white:{attacks:22,pitchCount:1,intervalSeconds:Music.beatToTime(white,3),firstNoteSeconds:Music.beatToTime(white,1.25),sourceRegions:120},results},null,2));
