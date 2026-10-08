(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./music.js'):root.PixelMusic);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.PixelMusicExpression=api;
})(typeof globalThis==='object'?globalThis:this,function(Music){
  'use strict';
  const VERSION='pixel-phrase-v2',fixed=n=>Math.round(n*1e6)/1e6;
  const RULES=Object.freeze({version:VERSION,minimumSlot:.5,minimumNote:.25,maxSourcesPerPhrase:4,maxMotifsPerPhrase:1,maxConnectorDegrees:2});
  // Colour-derived anchors stay intact. Local phrases organize performance;
  // no contour, random motif, hash-selected tune, or global chord pattern.
  function apply(base,{enabled=true}={}){
    if(!enabled)return base;
    const scale=[];for(let n=46;n<=79;n++)if(base.mode.notes.includes(((n-base.root)%12+12)%12))scale.push(n);
    const sourceIndex=new Map(base.melody.map((s,i)=>[s.id,i]));
    const lightOf=source=>{const f=base.diagnostics.regionFeatures.slice(source.startIndex,source.endIndex+1);return f.reduce((v,n)=>v+n.vector[0],0)/f.length;};
    const phrases=[],sourcePhrases=new Map();let cursor=0;
    while(cursor<base.melody.length){
      const start=cursor,first=base.melody[cursor],light=lightOf(first),targetBeats=light>.65?2:light<.35?4:3;
      let end=cursor,total=first.beats;
      while(end+1<base.melody.length&&end-start+1<RULES.maxSourcesPerPhrase){
        const a=base.melody[end],b=base.melody[end+1];
        if(Math.abs(a.beat+a.beats-b.beat)>1e-6)break;
        const moving=new Set(base.melody.slice(start,end+1).map(s=>s.midi)).size>1;
        if(total>=targetBeats&&moving)break;
        end++;total+=b.beats;
      }
      const sources=base.melody.slice(start,end+1),directions=sources.slice(1).map((s,i)=>Math.sign(s.midi-sources[i].midi)).filter(Boolean);
      if(directions.length){
        const turns=directions.slice(1).filter((d,i)=>d!==directions[i]).length;
        const phrase={id:`colour-phrase-${phrases.length}`,beat:first.beat,beats:fixed(sources.at(-1).beat+sources.at(-1).beats-first.beat),sourceIds:sources.map(s=>s.id),targetBeats,light:fixed(light),
          pattern:turns?'neighbor-response':'step-connection',turns,motifUsed:false};
        phrases.push(phrase);sources.forEach(s=>sourcePhrases.set(s.id,phrase));
      }
      cursor=end+1;
    }
    if(!phrases.length)return base;
    const events=[],extraRests=[],decisions=[];let modified=0,motifs=0,firstChangedBeat=null,firstConnectorBeat=null;
    const add=(original,phrase,context,midi,beat,slot,part,kind,accent)=>{
      // Small breaths only; never consume an image rest or an old sparse gap.
      const duration=slot>=.5?fixed(slot-.125):slot;
      events.push({...original,id:`${original.id}:phrase-${part}`,index:events.length,beat:fixed(beat),beats:duration,durationBeats:duration,coverageBeats:slot,
        midi,noteName:Music.midiToName(midi),velocity:fixed(Math.min(.14,original.velocity*accent)),envelope:'pluck',articulation:'colour-phrase',send:.008,origin:'pixel-expression-rule',
        expressionSupport:{version:VERSION,phraseId:phrase.id,kind,ruleId:phrase.pattern,anchorEventIds:[original.sourceEventId,context.id],
          regionIds:[...new Set([...base.melody[sourceIndex.get(original.sourceEventId)].regionIds,...context.regionIds])],reason:'colour-derived-pitch-phrase'}});
      if(kind!=='anchor-rhythm')firstConnectorBeat??=beat;
      if(duration<slot)extraRests.push({beat:fixed(beat+duration),beats:fixed(slot-duration),scope:'performance-melody',sourceEventId:original.sourceEventId,reason:'pixel-expression-breath'});
    };
    for(const original of base.performanceEvents){
      const phrase=sourcePhrases.get(original.sourceEventId),source=base.melody[sourceIndex.get(original.sourceEventId)];
      if(!phrase||original.durationBeats<RULES.minimumSlot){events.push({...original,index:events.length});continue;}
      const members=phrase.sourceIds.map(id=>base.melody[sourceIndex.get(id)]),local=members.indexOf(source);
      const next=members.slice(local+1).find(s=>s.midi!==source.midi),context=next||members.find(s=>s.midi!==source.midi);
      if(!context){events.push({...original,index:events.length});continue;}
      const a=scale.indexOf(source.midi),b=scale.indexOf(context.midi);if(a<0||b<0){events.push({...original,index:events.length});continue;}
      const direction=Math.sign(b-a),near=scale[a+direction],travel=scale[a+direction*Math.min(phrase.turns?1:2,Math.abs(b-a))],duration=original.durationBeats;
      let pitches=[source.midi],lengths=[duration],kinds=['anchor-rhythm'];
      if(next&&!phrase.motifUsed){
        if(duration>=2.25&&phrase.pattern==='step-connection'){
          const lead=lightOf(source)>.6?.75:.5;
          pitches=[source.midi,near,source.midi,travel,source.midi];lengths=[lead,.5,.25,.5,fixed(duration-lead-1.25)];
          kinds=['anchor-rhythm','connection','return','connection','return'];
        }else if(duration>=.75){
          const travelBeats=.25;
          const lead=Math.min(fixed(duration-.5),Math.max(.25,Math.round(duration*.4/.25)*.25));
          pitches=[source.midi,travel,source.midi];lengths=[lead,travelBeats,fixed(duration-lead-travelBeats)];
          kinds=['anchor-rhythm','connection','return'];
        }else{
          // A half-beat slot gets one quarter-beat anticipation, not a rapid trill.
          pitches=[source.midi,travel];lengths=[.25,fixed(duration-.25)];kinds=['anchor-rhythm','connection'];
        }
        phrase.motifUsed=true;motifs++;
      }
      let beat=original.beat;
      pitches.forEach((midi,part)=>{const accent=part===0?(local===0?1.04:.98):kinds[part]==='connection'?.98:.94;add(original,phrase,context,midi,beat,lengths[part],part,kinds[part],accent);beat=fixed(beat+lengths[part]);});
      modified++;firstChangedBeat??=original.beat;
      decisions.push({eventId:original.id,phraseId:phrase.id,anchorEventIds:[source.id,context.id],direction,pattern:phrase.pattern,pitches,lengths});
    }
    if(!modified)return base;
    const score={...base,version:'0.6.3-exp',expressionVersion:VERSION,baseScoreHash:base.scoreHash,performanceEvents:events,
      performanceRests:[...base.performanceRests,...extraRests].sort((a,b)=>a.beat-b.beat),expressionRests:extraRests,
      diagnostics:{...base.diagnostics,actualOnsetCount:events.length,pixelExpression:{version:VERSION,rules:RULES,phraseCount:phrases.length,motifs,modifiedAnchors:modified,
        addedNotes:events.length-base.performanceEvents.length,firstChangedSeconds:fixed(Music.beatToTime(base,firstChangedBeat)),
        firstConnectorSeconds:firstConnectorBeat===null?null:fixed(Music.beatToTime(base,firstConnectorBeat)),phrases:phrases.map(({motifUsed,...p})=>p),decisions}}};
    score.rhythmFingerprint=Music.rhythmFingerprint(score);
    score.mappingFingerprint=Music.digestText(JSON.stringify({base:base.mappingFingerprint,version:VERSION,derived:events.filter(e=>e.expressionSupport).map(e=>[e.id,e.sourceEventId,e.expressionSupport])}));
    score.expressionFingerprint=Music.digestText(JSON.stringify({version:VERSION,decisions,rhythm:score.rhythmFingerprint}));
    score.scoreHash=Music.scoreFingerprint(score);return score;
  }
  return {VERSION,RULES,apply};
});
