const assert=require('node:assert/strict'),{Context}=require('./fake-audio.cjs');
const Audio=require('./baseline/audio-v06.js'),Music=require('./baseline/music-v06.js'),Image=require('./baseline/image-analysis-v06.js'),Samples=require('./fidelity-fixtures.js');
let cases=0,mainEvents=0,regionBindings=0;
for(let i=0;i<Samples.names.length;i++){
  const score=Music.compose(Image.analyzePixels(Samples.pixels(i)));
  for(const tone of ['warm','glass','mist']){
    const context=new Context(),session=Audio.createSession(context,{bpm:score.bpm});session.schedule(score,.08,tone);
    const sources=context.nodes.filter(n=>n.kind==='oscillator');let cursor=0;
    function check(pitch,count,start,end){
      const voices=sources.slice(cursor,cursor+count);cursor+=count;assert.equal(voices.length,count);
      voices.forEach(voice=>{assert.ok(Math.abs(voice.started-start)<1e-9);assert.ok(Math.abs(voice.stops[0]-end-.04)<1e-9);});
      assert.ok(Math.abs(voices[0].frequency.events[0].value/(440*2**((pitch-69)/12))-1)<1e-9);
    }
    score.melody.forEach(e=>{check(e.midi,tone==='mist'?2:3,.08+Music.beatToTime(score,e.beat),.08+Music.beatToTime(score,e.beat+e.durationBeats));mainEvents++;});
    score.bassEvents.forEach(e=>check(e.midi,3,.08+Music.beatToTime(score,e.beat),.08+Music.beatToTime(score,e.beat+e.durationBeats)));
    score.padEvents.forEach(e=>e.midi.forEach((pitch,index)=>check(pitch,2,.08+Music.beatToTime(score,e.beat)+index*.012,.08+Music.beatToTime(score,e.beat+e.durationBeats))));
    assert.equal(cursor,sources.length,'only real events can schedule voices');regionBindings+=score.regionMap.length;
    if(score.melody.length===1&&score.bassEvents.length===0){
      assert.equal(sources.length,tone==='mist'?2:3,'120 scans must not become 120 attacks');
      const gain=context.nodes.find(n=>n.kind==='gain'&&n.gain.events.some(e=>e.type==='exponential'));
      assert.equal(gain.gain.events.length,4,'one attack, one steady plateau, one release');
      assert.equal(gain.gain.events[1].value,gain.gain.events[2].value);
      assert.ok(gain.gain.events[2].time>score.melodyDuration-.3);
    }
    for(const node of context.nodes)for(const param of ['gain','frequency'])node[param].events.forEach((e,j,a)=>{if(j)assert.ok(e.time>=a[j-1].time,'envelope events must be time ordered');});
    session.stop();assert.ok(sources.every(n=>n.stops.at(-1)===.03));session.dispose();assert.equal(session.sourceCount,0);assert.ok(context.nodes.every(n=>n.disconnected));cases++;
  }
  for(const fromBeat of [3.75,17,32.25,63.5]){
    const context=new Context();context.currentTime=10;const session=Audio.createSession(context,{bpm:score.bpm});
    session.schedule(score,10.035-Music.beatToTime(score,fromBeat),'glass',fromBeat);
    assert.ok(context.nodes.filter(n=>n.kind==='oscillator').every(n=>n.started>=10.0349));session.dispose();
  }
}
const white=Music.compose(Image.analyzePixels(Samples.pixels(60))),context=new Context();context.currentTime=10;
const resumed=Audio.createSession(context,{bpm:white.bpm});resumed.schedule(white,10.035-Music.beatToTime(white,32),'warm',32);
const envelope=context.nodes.find(n=>n.gain.events.some(e=>e.type==='exponential')).gain.events;
assert.ok(envelope[1].time-10.035<=.025001,'continued long sound uses a short user-requested crossfade, not its original attack');
resumed.dispose();
const buffer={sampleRate:4,duration:1,getChannelData:()=>new Float32Array([0,.2,-.2,0])},wav=new DataView(Audio.wavBytes(buffer));
assert.equal(wav.getUint32(40,true),8);assert.equal(wav.byteLength,52);assert.equal(Audio.inspectBuffer(buffer).invalid,0);
const clip={sampleRate:4,duration:1,getChannelData:()=>new Float32Array([.5,.5,.5,.5])},faded=new DataView(Audio.wavBytes(clip,1,.5,{fadeOutSeconds:.25}));
assert.equal(faded.getInt16(44,true),16384);assert.equal(faded.getInt16(46,true),0,'diagnostic short clips must end without a hard waveform cut');
console.log(JSON.stringify({status:'passed',scheduleCases:cases,actualMainEvents:mainEvents,regionBindings,resumeCases:Samples.names.length*4,sustainPlateau:true,toneSwitchCrossfade:true,cleanup:true,wavEncoding:true},null,2));
