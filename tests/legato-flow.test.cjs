const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Music=require('../dist/music.js'),Image=require('../dist/image-analysis.js'),Expression=require('../dist/pixel-expression.js'),Flow=require('../dist/legato.js'),F=require('./fidelity-fixtures.js');
const {Context}=require('./fake-audio.cjs'),{jsonSha}=require('./m0/utils.cjs');
let cases=0,schedules=0,resumes=0;const hashes=new Set(),examples=[];
for(let index=0;index<84;index++){
  const analysis=Image.analyzePixels(F.pixels(index));
  for(const style of ['sparse','continuous']){
    const base=Music.compose(analysis,{performanceStyle:style}),before=jsonSha(base),score=Flow.apply(base);
    assert.equal(jsonSha(base),before,'source score immutable');assert.deepEqual(score,Flow.apply(base));assert.equal(Flow.apply(score),score);
    for(const field of ['hash','melody','regionMap','columns','tempoMap','bassEvents','padEvents','duration','totalBeats'])assert.deepEqual(score[field],base[field],field);
    assert.equal(score.version,'0.6.4-exp');assert.equal(score.rendererVersion,Flow.VERSION);assert.equal(score.scoreHash,Flow.fingerprint(score));
    assert.deepEqual(score.rests,[]);assert.deepEqual(score.performanceRests,[]);assert.deepEqual(score.sourceRests,base.rests);assert.deepEqual(score.sourcePerformanceRests,base.performanceRests);
    const points=score.performanceEvents;assert.equal(points[0].beat,0);assert.equal(points.at(-1).endBeat,64);
    if(index===5)assert.ok(score.diagnostics.legato.singleBridges>0,'larger sunset transitions demonstrate a single bridge');
    for(let i=0;i<points.length;i++){
      const p=points[i];assert.ok(p.durationBeats>0);if(i)assert.equal(p.beat,points[i-1].endBeat);
      assert.ok(base.mode.notes.includes(((p.midi-base.root)%12+12)%12));assert.equal(p.envelope,'legato');assert.ok(['continuous-flow-rule','single-bridge-rule'].includes(p.origin));
      if(p.kind==='single-bridge'){
        assert.ok(i&&i+1<points.length);assert.equal(points[i-1].kind,'colour-target');assert.equal(points[i+1].kind,'colour-target');
        assert.ok(p.midi>Math.min(points[i-1].midi,points[i+1].midi)&&p.midi<Math.max(points[i-1].midi,points[i+1].midi),'one intermediate, no return pattern');
        assert.ok(p.bridgeSupport.anchorPerformanceEventIds.every(id=>base.performanceEvents.some(e=>e.id===id)));
      }
    }
    assert.deepEqual(points.flatMap(p=>p.sourcePerformanceEventIds),base.performanceEvents.map(e=>e.id),'every old target is retained or merged');
    if(index>=60&&index<=71){assert.equal(points.length,1);assert.equal(points[0].midi,base.performanceEvents[0].midi);assert.equal(score.bassEvents.length,0);assert.equal(score.padEvents.length,0);}
    const plan=Flow.timeline(score);
    for(let seconds=.2;seconds<plan.end;seconds+=.071){const s=Flow.stateAt(plan,seconds);assert.ok(s.level>.001&&Number.isFinite(s.frequency)&&s.frequency>0,'no envelope holes in entire melody');}
    for(const tone of ['warm','glass','mist']){
      const context=new Context(),session=Flow.createSession(context),shadow={...score,bassEvents:[],padEvents:[]};session.schedule(shadow,.08,tone);
      const oscillators=context.nodes.filter(n=>n.kind==='oscillator');assert.equal(oscillators.length,tone==='mist'?2:3,'one permanent partial bank, not per-note oscillators');
      assert.ok(oscillators.every(n=>n.started===.08&&n.stops.length===1));
      const gain=context.nodes.find(n=>n.kind==='gain'&&n.gain.events.filter(e=>e.type==='linear').length>=2);
      assert.ok(gain);assert.equal(gain.gain.events.filter(e=>e.value<=.0001).length,2,'only initial fade and final release reach silence');
      assert.ok(gain.gain.events.every(e=>e.time>=.08));
      session.dispose();assert.equal(session.sourceCount,0);assert.ok(context.nodes.every(n=>n.disconnected));schedules++;
      for(const beat of [1.5,32.25,63.5]){const c=new Context(),s=Flow.createSession(c);s.schedule(score,.08,tone,beat);s.stop();s.dispose();assert.equal(s.sourceCount,0);resumes++;}
    }
    const change=plan.points.find((p,i)=>i&&p.frequency!==plan.points[i-1].frequency);
    if(change){
      const seconds=change.seconds+change.glide*.5,state=Flow.stateAt(plan,seconds),c=new Context(),s=Flow.createSession(c);
      s.schedule({...score,bassEvents:[],padEvents:[]},.08,'warm',Music.timeToBeat(score,seconds));
      const osc=c.nodes.find(n=>n.kind==='oscillator');assert.ok(Math.abs(osc.frequency.events[0].value-state.frequency)<1e-7,'resume inside the existing glide, not restart a note');s.dispose();
    }
    for(let beat=0;beat<64;beat+=.25){const p=Music.playbackPosition(score,Music.beatToTime(score,beat));assert.equal(p.rest,false);assert.equal(p.performanceRest,false);}
    hashes.add(score.scoreHash);cases++;if([5,60,74].includes(index))examples.push({index,style,targets:points.length,pitchChanges:score.diagnostics.legato.pitchChanges,melodyStarts:1});
  }
}
assert.ok(hashes.size>20,'not a shared tune');
const context=vm.createContext({});for(const file of ['timing','rhythm','music','image-analysis','audio','pixel-expression','legato'])new vm.Script(fs.readFileSync(`dist/${file}.js`,'utf8')).runInContext(context);
context.input=F.pixels(74);const classic=vm.runInContext('PixelMusicLegato.apply(PixelMusic.compose(PixelMusicImage.analyzePixels(input)))',context);
assert.equal(jsonSha(classic),jsonSha(Flow.apply(Music.compose(Image.analyzePixels(F.pixels(74))))));
assert.throws(()=>Flow.apply({performanceEvents:[]}));
assert.throws(()=>Flow.apply(Expression.apply(Music.compose(Image.analyzePixels(F.pixels(74))))),/原始像素/);
console.log(JSON.stringify({status:'passed',cases,schedulingCases:schedules,resumeCases:resumes,distinctHashes:hashes.size,oneMelodyPartialBank:true,noGainResets:true,glideResume:true,classicScriptMatch:true,examples,realAudio:false}));
