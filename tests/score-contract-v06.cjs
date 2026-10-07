const assert=require('node:assert/strict'),Music=require('./baseline/music-v06.js');
function check(score){
  assert.equal(score.version,'0.6.0');assert.equal(score.regionMap.length,120);assert.ok(score.melody.length>=1&&score.melody.length<=120);
  assert.equal(new Set(score.regionMap.map(r=>r.regionId)).size,120);assert.equal(score.totalBeats,64);assert.equal(score.bars.length,16);
  const ids=new Map(score.melody.map(e=>[e.id,e]));assert.equal(ids.size,score.melody.length);
  score.regionMap.forEach((r,i)=>{
    assert.equal(r.sequence,i);assert.equal(r.col,Math.floor(i/5));assert.equal(r.row,r.col%2?4-i%5:i%5);
    const event=ids.get(r.voiceEventId);assert.ok(event);assert.ok(event.regionIds.includes(r.regionId));
    assert.ok(r.startBeat>=event.beat&&r.endBeat<=event.beat+event.beats+1e-9&&r.endBeat>r.startBeat);
    assert.equal(Music.previewForRegion(score,i).midi,event.midi);assert.equal(score.columns[r.col].notes[r.row].midi,event.midi);
    if(i)assert.ok(r.startBeat>=score.regionMap[i-1].endBeat-1e-9);
    const position=Music.playbackPosition(score,Music.beatToTime(score,(r.startBeat+r.endBeat)/2));assert.equal(position.index,i);assert.equal(position.note.id,event.id);
  });
  assert.deepEqual(score.melody.flatMap(e=>e.regionIds),score.regionMap.map(r=>r.regionId));
  const spans=[...score.melody.map(e=>[e.beat,e.beat+e.beats]),...score.rests.map(r=>[r.beat,r.beat+r.beats])].sort((a,b)=>a[0]-b[0]);
  assert.equal(spans[0][0],0);assert.equal(spans.at(-1)[1],64);spans.forEach((r,i)=>{if(i)assert.equal(r[0],spans[i-1][1]);});
  score.melody.forEach((e,i)=>{
    assert.ok(e.beat*4===Math.round(e.beat*4)&&e.beats*4===Math.round(e.beats*4));assert.ok(e.beats>=.25&&e.durationBeats>0);
    assert.ok(e.midi>=46&&e.midi<=79&&e.velocity>0&&e.velocity<=.15);assert.ok(e.reasons.length>0);
    if(i)assert.ok(e.reasons.some(r=>r.kind!=='image-start'));assert.equal(e.envelope,'sustain');
    score.rests.forEach(r=>assert.ok(e.beat>=r.beat+r.beats||e.beat+e.durationBeats<=r.beat));
  });
  for(const event of [...score.bassEvents,...score.padEvents]){
    assert.ok(event.featureSupport.regionIds.length);assert.equal(event.featureSupport.reason,'image-segment-harmony');
    assert.ok(event.beat>=0&&event.beat+event.durationBeats<=64&&event.durationBeats>0);
    score.rests.forEach(r=>assert.ok(event.beat>=r.beat+r.beats||event.beat+event.durationBeats<=r.beat+1e-9));
  }
  score.bassEvents.forEach(event=>assert.deepEqual(event.featureSupport.regionIds,ids.get(event.featureSupport.sourceEventId).regionIds,'pad merging must not mutate a bass event provenance'));
  score.padEvents.forEach(event=>assert.deepEqual(event.featureSupport.regionIds,event.featureSupport.sourceEventIds.flatMap(id=>ids.get(id).regionIds)));
  assert.equal(score.rhythmFingerprint,Music.rhythmFingerprint(score));assert.equal(score.scoreHash,Music.scoreFingerprint(score));
  for(let beat=0;beat<=66;beat+=.125)assert.ok(Math.abs(Music.timeToBeat(score,Music.beatToTime(score,beat))-beat)<1e-9);
  assert.equal(Music.playbackPosition(score,score.duration).finished,true);
}
module.exports=check;
