const assert=require('node:assert/strict'),{Context}=require('./fake-audio.cjs'),Audio=require('../dist/audio.js'),Music=require('../dist/music.js'),Image=require('../dist/image-analysis.js'),Samples=require('./fidelity-fixtures.js');
let scheduled=0,attacks=0;
for(let i=0;i<Samples.names.length;i++)for(const performanceStyle of ['sparse','continuous'])for(const tone of ['warm','glass','mist']){
  const score=Music.compose(Image.analyzePixels(Samples.pixels(i)),{performanceStyle}),context=new Context(),session=Audio.createSession(context,{bpm:score.bpm});
  session.schedule(score,.08,tone);const oscillators=context.nodes.filter(n=>n.kind==='oscillator');let cursor=0;
  function verify(event,pitch,partials,stagger=0){
    const voices=oscillators.slice(cursor,cursor+partials);cursor+=partials;assert.equal(voices.length,partials);
    voices.forEach(voice=>{assert.ok(Math.abs(voice.started-.08-Music.beatToTime(score,event.beat)-stagger)<1e-9);assert.ok(Math.abs(voice.stops[0]-.08-Music.beatToTime(score,event.beat+event.durationBeats)-.04)<1e-9);});
    assert.ok(Math.abs(voices[0].frequency.events[0].value/(440*2**((pitch-69)/12))-1)<1e-9);
  }
  score.performanceEvents.forEach(e=>{verify(e,e.midi,tone==='mist'?2:3);attacks++;});
  score.bassEvents.forEach(e=>verify(e,e.midi,3));score.padEvents.forEach(e=>e.midi.forEach((m,k)=>verify(e,m,2,k*.012)));
  assert.equal(cursor,oscillators.length,'image regions must not be scheduled again');
  for(const node of context.nodes)for(const property of ['gain','frequency'])node[property].events.forEach((e,j,events)=>{if(j)assert.ok(e.time>=events[j-1].time);});
  const envelopes=context.nodes.filter(n=>n.kind==='gain'&&n.gain.events.some(e=>e.type==='exponential'));
  score.performanceEvents.forEach((event,index)=>{if(event.envelope==='pluck'){const values=envelopes[index].gain.events.map(e=>e.value);assert.ok(values.length>=5);assert.ok(values[1]>values[2]&&values[2]>values[3]&&values[3]>values[4],'each sparse note must decay naturally, not hold a beep');}});
  session.stop();assert.ok(oscillators.every(o=>o.stops.at(-1)===.03));session.dispose();assert.equal(session.sourceCount,0);scheduled++;
}
const white=Music.compose(Image.analyzePixels(Samples.pixels(60)));
for(const fromBeat of [.1,.5,1.5,2.5,3.4,32.25,63.5]){
  const context=new Context();context.currentTime=10;const session=Audio.createSession(context,{bpm:white.bpm});
  session.schedule(white,10.035-Music.beatToTime(white,fromBeat),'warm',fromBeat);
  const oscillators=context.nodes.filter(n=>n.kind==='oscillator');assert.ok(oscillators.every(o=>o.started>=10.0349));
  if(fromBeat===1.5||fromBeat===2.5)assert.ok(oscillators.every(o=>o.started>=10.035+Music.beatToTime(white,3)-Music.beatToTime(white,fromBeat)-1e-9),'changing tone in a gap must not restart an expired note');
  session.dispose();
}
console.log(JSON.stringify({status:'passed',schedulingCases:scheduled,actualMelodyAttacks:attacks,decayEnvelope:true,gapResume:true,cleanup:true},null,2));
