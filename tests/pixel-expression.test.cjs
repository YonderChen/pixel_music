const assert=require('node:assert/strict'),vm=require('node:vm');
const fs=require('node:fs'),Music=require('../dist/music.js'),Image=require('../dist/image-analysis.js'),Expression=require('../dist/pixel-expression.js'),F=require('./fidelity-fixtures.js');
const FrozenMusic=require('./baseline/music-v061.js'),FrozenImage=require('./baseline/image-analysis-v061.js');
const {audioTrace,jsonSha}=require('./m0/utils.cjs'),Audio=require('../dist/audio.js');
let processed=0,changed=0,added=0,schedules=0,resumes=0;const examples=[],patterns=new Set(),hashes=new Set();
function partition(score){
  const spans=[...score.performanceEvents.map(e=>[e.beat,e.beat+e.durationBeats]),...score.performanceRests.map(r=>[r.beat,r.beat+r.beats]),...score.rests.map(r=>[r.beat,r.beat+r.beats])].sort((a,b)=>a[0]-b[0]);
  let end=0;for(const [a,b]of spans){assert.ok(Math.abs(a-end)<1e-6,'gap/overlap');assert.ok(b>a);end=b;}assert.ok(Math.abs(end-64)<1e-6);
}
for(let index=0;index<F.names.length;index++){
  const rgba=F.pixels(index),analysis=Image.analyzePixels(rgba),frozenAnalysis=FrozenImage.analyzePixels(rgba);
  for(const style of ['sparse','continuous']){
    const base=Music.compose(analysis,{performanceStyle:style}),before=jsonSha(base),result=Expression.apply(base),off=Expression.apply(base,{enabled:false});
    assert.equal(off,base);assert.equal(jsonSha(base),before);assert.deepEqual(base,FrozenMusic.compose(frozenAnalysis,{performanceStyle:style}));
    assert.deepEqual(result.melody,base.melody);assert.deepEqual(result.regionMap,base.regionMap);assert.deepEqual(result.tempoMap,base.tempoMap);
    assert.deepEqual(result.bassEvents,base.bassEvents);assert.deepEqual(result.padEvents,base.padEvents);assert.deepEqual(result.rests,base.rests);
    for(const rest of base.performanceRests)assert.ok(result.performanceRests.some(r=>JSON.stringify(r)===JSON.stringify(rest)),'old sparse gap preserved');
    for(const rest of result.expressionRests||[])assert.ok(rest.beats===.125&&rest.reason==='pixel-expression-breath');
    assert.deepEqual(result,Expression.apply(base));assert.equal(result.hash,base.hash);partition(result);
    assert.equal(new Set(result.performanceEvents.map(e=>e.id)).size,result.performanceEvents.length);
    const sources=new Map(base.melody.map(e=>[e.id,e]));
    for(const [i,event]of result.performanceEvents.entries()){
      assert.equal(event.index,i);assert.ok(Number.isFinite(event.velocity)&&event.velocity>0&&event.velocity<=.15);assert.ok(event.durationBeats>0&&event.beat+event.durationBeats<=64+1e-6);
      assert.ok(result.mode.notes.includes(((event.midi-result.root)%12+12)%12));assert.ok(event.midi>=46&&event.midi<=79);
      const source=sources.get(event.sourceEventId);assert.ok(source);assert.ok(event.beat>=source.beat&&event.beat+event.durationBeats<=source.beat+source.beats+1e-6);
      if(event.expressionSupport){
        assert.equal(event.origin,'pixel-expression-rule');assert.equal(event.expressionSupport.anchorEventIds.length,2);assert.ok(event.expressionSupport.anchorEventIds.every(id=>sources.has(id)));
        assert.ok(event.durationBeats>=.25);assert.ok(['anchor-rhythm','connection','return'].includes(event.expressionSupport.kind));
        if(event.expressionSupport.kind==='anchor-rhythm')assert.equal(event.midi,source.midi);
        else {const scale=[];for(let midi=46;midi<=79;midi++)if(result.mode.notes.includes(((midi-result.root)%12+12)%12))scale.push(midi);assert.ok(Math.abs(scale.indexOf(event.midi)-scale.indexOf(source.midi))<=2,'bounded smooth connector');}
        const regionIds=[...new Set(event.expressionSupport.anchorEventIds.flatMap(id=>sources.get(id).regionIds))];assert.deepEqual(event.expressionSupport.regionIds,regionIds);
      }
      else assert.equal(event.midi,source.midi);
    }
    for(const source of base.melody){const old=base.performanceEvents.find(e=>e.sourceEventId===source.id),fresh=result.performanceEvents.find(e=>e.sourceEventId===source.id);assert.equal(fresh.beat,old.beat);assert.equal(fresh.midi,old.midi);}
    if(result!==base){
      changed++;added+=result.diagnostics.pixelExpression.addedNotes;assert.equal(result.version,'0.6.3-exp');assert.equal(result.expressionVersion,'pixel-phrase-v2');
      assert.equal(result.scoreHash,Music.scoreFingerprint(result));assert.equal(result.rhythmFingerprint,Music.rhythmFingerprint(result));assert.notEqual(result.scoreHash,base.scoreHash);
      const diagnostic=result.diagnostics.pixelExpression;diagnostic.phrases.forEach(p=>patterns.add(p.pattern));assert.ok(diagnostic.motifs<=diagnostic.phraseCount);
      for(const p of diagnostic.phrases)assert.ok(diagnostic.decisions.filter(d=>d.phraseId===p.id&&d.pitches.length>1).length<=1,'at most one motif per phrase');
      hashes.add(result.scoreHash);
    }
    if(index>=60&&index<=71)assert.equal(result,base,'pure colours never get a new melody');
    for(const tone of ['warm','glass','mist']){const trace=audioTrace(Audio,result,tone);assert.ok(trace.length>0);schedules++;for(const fromBeat of [1.5,32.25,63.5]){audioTrace(Audio,result,tone,fromBeat);resumes++;}}
    processed++;if([5,60,74,75].includes(index))examples.push({index,name:F.names[index],style,original:base.performanceEvents.length,experimental:result.performanceEvents.length,phrases:result.diagnostics.pixelExpression?.phraseCount||0,firstConnectorSeconds:result.diagnostics.pixelExpression?.firstConnectorSeconds??null});
  }
}
assert.ok(examples.filter(e=>[5,74,75].includes(e.index)).every(e=>e.phrases>0&&e.firstConnectorSeconds!==null&&e.firstConnectorSeconds<2),'representative colours must change early, not 28 seconds later');
assert.equal(patterns.size,2,'real local direction changes choose different treatments');assert.ok(hashes.size>20,'not one common generated song');
const sandbox={};sandbox.window=sandbox;const context=vm.createContext(sandbox);
for(const file of ['timing','rhythm','music','image-analysis','pixel-expression'])new vm.Script(fs.readFileSync(`dist/${file}.js`,'utf8')).runInContext(context);
const browserInput=F.pixels(74);context.input=browserInput;
const vmScore=vm.runInContext('PixelMusicExpression.apply(PixelMusic.compose(PixelMusicImage.analyzePixels(input)))',context);
assert.equal(jsonSha(vmScore),jsonSha(Expression.apply(Music.compose(Image.analyzePixels(browserInput)))));
console.log(JSON.stringify({status:'passed',version:Expression.VERSION,cases:processed,changedCases:changed,addedNotes:added,schedulingCases:schedules,resumeCases:resumes,classicScriptVmMatch:true,patterns:[...patterns],distinctChangedScoreHashes:hashes.size,examples,realAudio:false}));
