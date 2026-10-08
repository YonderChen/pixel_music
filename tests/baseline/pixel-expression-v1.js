(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./music-v061.js'):root.PixelMusicV061);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.PixelMusicExpressionV1=api;
})(typeof globalThis==='object'?globalThis:this,function(Music){
  'use strict';
  const VERSION='pixel-turn-v1',fixed=n=>Math.round(n*1e6)/1e6;
  // Colour-derived image anchors stay intact. Only the actual performance is arranged.
  function apply(base,{enabled=true}={}){
    if(!enabled)return base;
    const scale=[];for(let n=46;n<=79;n++)if(base.mode.notes.includes(((n-base.root)%12+12)%12))scale.push(n);
    const bySource=new Map(),rules=new Map();
    for(const event of base.performanceEvents){const list=bySource.get(event.sourceEventId)||[];list.push(event);bySource.set(event.sourceEventId,list);}
    for(let i=0;i<base.melody.length-1;i++){
      const source=base.melody[i],next=base.melody[i+1],a=scale.indexOf(source.midi),b=scale.indexOf(next.midi),direction=Math.sign(b-a);
      if(!direction||a<0||b<0||Math.abs(source.beat+source.beats-next.beat)>1e-6)continue;
      // Do not fill image rests, or add a pattern to static colour. Short segments stay intact.
      const event=(bySource.get(source.id)||[]).at(-1);
      if(!event||event.durationBeats<1.25||next.beat-(event.beat+event.durationBeats)>2.25)continue;
      const regions=base.diagnostics.regionFeatures.slice(source.startIndex,source.endIndex+1),light=regions.reduce((s,r)=>s+r.vector[0],0)/regions.length;
      const distance=Math.abs(b-a),travel=scale[a+direction*Math.min(2,distance)],response=distance>1?scale[a+direction]:source.midi;
      const short=event.durationBeats>=2&&light>.5?.5:.25;
      const answer=event.durationBeats>=2&&distance>1?.75:.5;
      const lead=fixed(event.durationBeats-short-answer);
      if(lead<.5)continue;
      rules.set(event.id,{source,next,notes:[source.midi,travel,response],lengths:[lead,short,answer],direction,light:fixed(light)});
    }
    if(!rules.size)return base;
    const events=[],decisions=[];
    for(const original of base.performanceEvents){
      const rule=rules.get(original.id);
      if(!rule){events.push({...original,index:events.length});continue;}
      let beat=original.beat;
      rule.notes.forEach((midi,part)=>{
        const length=rule.lengths[part],derived=part>0;
        const event={...original,id:`${original.id}:turn-${part}`,index:events.length,beat:fixed(beat),beats:length,durationBeats:length,coverageBeats:length,midi,noteName:Music.midiToName(midi),
          velocity:fixed(original.velocity*(part===0?1:part===1?.8:.72)),send:derived?.008:original.send,
          envelope:derived?'pluck':original.envelope,articulation:derived?'pixel-turn':original.articulation,
          origin:derived?'pixel-expression-rule':original.origin};
        if(derived)event.expressionSupport={version:VERSION,ruleId:rule.direction>0?'rising-return':'falling-return',anchorEventIds:[rule.source.id,rule.next.id],
          regionIds:[...new Set([...rule.source.regionIds,...rule.next.regionIds])],reason:'colour-derived-pitch-transition',part,light:rule.light};
        events.push(event);beat+=length;
      });
      decisions.push({eventId:original.id,anchorEventIds:[rule.source.id,rule.next.id],direction:rule.direction,lengths:rule.lengths,pitches:rule.notes});
    }
    const score={...base,version:'0.6.2-exp',expressionVersion:VERSION,baseScoreHash:base.scoreHash,performanceEvents:events,
      diagnostics:{...base.diagnostics,actualOnsetCount:events.length,pixelExpression:{version:VERSION,transitions:rules.size,addedNotes:events.length-base.performanceEvents.length,decisions}}};
    score.rhythmFingerprint=Music.rhythmFingerprint(score);
    score.mappingFingerprint=Music.digestText(JSON.stringify({base:base.mappingFingerprint,version:VERSION,derived:events.filter(e=>e.expressionSupport).map(e=>[e.id,e.sourceEventId,e.expressionSupport])}));
    score.expressionFingerprint=Music.digestText(JSON.stringify({version:VERSION,decisions,rhythm:score.rhythmFingerprint}));
    score.scoreHash=Music.scoreFingerprint(score);return score;
  }
  return {VERSION,apply};
});
