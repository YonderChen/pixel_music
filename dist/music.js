(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./rhythm.js') : root.PixelMusicRhythm, typeof module === 'object' && module.exports ? require('./timing.js') : root.PixelMusicTiming);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PixelMusic = api;
})(typeof globalThis === 'object' ? globalThis : this, function (Rhythm, Timing) {
  'use strict';
  const MODES = { bright: { id: 'bright', name: '明亮五声', notes: [0,2,4,7,9] }, soft: { id: 'soft', name: '柔和大调', notes: [0,2,4,5,7,9,11] }, deep: { id: 'deep', name: '深色小调', notes: [0,2,3,5,7,8,10] } };
  const PHRASES = ['图像第一段','图像第二段','图像第三段','图像第四段'];
  const pc = n => (n % 12 + 12) % 12, clamp = (x, lo, hi) => Math.max(lo, Math.min(hi,x));
  const fixed = x => Math.round(x * 1e6) / 1e6, mean = xs => xs.reduce((a,b)=>a+b,0) / (xs.length || 1);
  const orderedRegions = columns => columns.flatMap((c,i) => i % 2 ? c.notes.slice().reverse() : c.notes);
  const midiToName = midi => `${['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'][pc(midi)]}${Math.floor(midi/12)-1}`;
  function modeOf(value) { return MODES[typeof value === 'string' ? value : value?.id] || MODES.soft; }
  function digestText(text) {
    let a=2166136261,b=2246822507;
    for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619)>>>0;b=Math.imul(b^text.charCodeAt(i),3266489917)>>>0;}
    return a.toString(16).padStart(8,'0')+b.toString(16).padStart(8,'0');
  }
  function validateRegions(columns) {
    if (columns.length !== 24 || columns.some(c=>c.notes.length!==5)) throw new Error('需要 24×5 个图像区域');
    columns.forEach((c,col)=>c.notes.forEach((n,row)=>{if(n.col!==col||n.row!==row||![n.light,n.hue,n.density].every(Number.isFinite))throw new Error('图像区域特征无效');}));
  }
  function mapTargets(raw,root,mode) {
    // Absolute image features choose targets; position and pixel hashes never add a contour.
    const tonic=root<=5?60+root:48+root, allowed=[];
    for(let midi=tonic-2;midi<=Math.min(79,tonic+14);midi++) if(mode.notes.includes(pc(midi-tonic)))allowed.push(midi);
    let previous=null;
    return raw.map((n,sequence)=>{
      const vector=Rhythm.feature(n), target=fixed(tonic+12*vector[0]+2*vector[2]);
      const baseMidi=allowed.slice().sort((a,b)=>Math.abs(a-target)-Math.abs(b-target)||a-b)[0];
      let midi=baseMidi, reason='nearest-scale-tone';
      if(previous && Rhythm.difference(vector,previous.vector)<=.04 && Math.abs(previous.midi-target)<=Math.abs(baseMidi-target)+.35){midi=previous.midi;reason=midi===baseMidi?reason:'within-image-pitch-deadband';}
      const result={...n,sequence,regionId:`${n.col}:${n.row}`,target,baseMidi,midi,vector,pitchDecision:reason};previous=result;return result;
    });
  }
  function voicing(classes, previous,root) {
    let best=null;
    for(let a=45;a<=57;a++)for(let b=a+3;b<=64;b++)for(let c=b+3;c<=69;c++){
      const notes=[a,b,c];if(new Set(notes.map(n=>pc(n-root))).size!==3||!notes.every(n=>classes.includes(pc(n-root))))continue;
      const target=previous||[48,55,60],cost=notes.reduce((s,n,i)=>s+Math.abs(n-target[i]),0)+(c-a>16?3:0);
      if(!best||cost<best.cost)best={notes,cost};
    }
    return best.notes;
  }
  function makeAccompaniment(melody,profile,mode,root,rests) {
    const bassEvents=[],padEvents=[];let previous=null,previousBass=36+root;
    for(const event of melody){
      if(event.performanceEnvelope==='pluck')continue;
      const local=mean(profile.notes.slice(event.startIndex,event.endIndex+1).map(n=>n.complexity)),gain=fixed(Math.min(.028,local*.05));
      if(gain<.003||event.beats<1)continue;
      const degree=mode.notes.indexOf(pc(event.midi-root)),classes=[0,2,4].map(offset=>mode.notes[(Math.max(0,degree)+offset)%mode.notes.length]);
      const chord=voicing(classes,previous,root);previous=chord;
      const bassOptions=[24,36,48].map(o=>pc(event.midi)+o).filter(n=>n>=32&&n<=48).sort((a,b)=>Math.abs(a-previousBass)-Math.abs(b-previousBass)||a-b),bass=bassOptions[0];previousBass=bass;
      const support={regionIds:event.regionIds.slice(),reason:'image-segment-harmony',sourceEventId:event.id,complexity:fixed(local)};
      bassEvents.push({beat:event.beat,durationBeats:fixed(event.beats*.94),midi:bass,velocity:gain,send:.015,envelope:'sustain',featureSupport:support});
      const previousPad=padEvents.at(-1),durationBeats=fixed(event.beats*.98);
      if(previousPad&&previousPad.midi.join()===chord.join()&&previousPad.beat+previousPad.durationBeats>=event.beat-.1&&!rests.some(r=>r.beat>=previousPad.beat&&r.beat<event.beat)){
        previousPad.durationBeats=fixed(event.beat+durationBeats-previousPad.beat);
        previousPad.featureSupport.regionIds.push(...event.regionIds);previousPad.featureSupport.sourceEventIds.push(event.id);
      }else padEvents.push({beat:event.beat,durationBeats,midi:chord,velocity:fixed(gain*.38),send:.025,envelope:'sustain',featureSupport:{...support,regionIds:support.regionIds.slice(),sourceEventIds:[event.id]}});
    }
    return {bassEvents,padEvents};
  }
  function arrangeRegions(columns,root,modeValue,options={}) {
    validateRegions(columns);const mode=modeOf(modeValue),raw=orderedRegions(columns).map(n=>({...n})),targets=mapTargets(raw,root,mode);
    const plan=Rhythm.plan(targets,options.rhythmStructure,options),regionMap=[];
    const melody=plan.groups.map((g,index)=>{
      const features=plan.profile.notes.slice(g.startIndex,g.endIndex+1),velocity=fixed(.09+mean(features.map(n=>n.vector[0]))*.025+mean(features.map(n=>n.vector[3]))*.012);
      const event={...g,id:`voice-${index}`,index,midi:g.midi,noteName:midiToName(g.midi),durationBeats:g.beats,velocity,articulation:'sustain',envelope:'sustain',send:.015,bar:Math.floor(g.beat/4),phrase:Math.min(3,Math.floor(g.beat/16)),featureSupport:{reasons:g.reasons,regionIds:g.regionIds.slice()}};
      g.regionIds.forEach((regionId,i)=>{
        const sequence=g.startIndex+i,source=targets[sequence];
        const entry={regionId,sequence,col:source.col,row:source.row,startBeat:g.beat+g.beats*i/g.regionIds.length,endBeat:g.beat+g.beats*(i+1)/g.regionIds.length,voiceEventId:event.id,previewRef:{midi:event.midi,velocity:event.velocity,send:event.send},target:source.target,baseMidi:source.baseMidi,pitchDecision:source.pitchDecision};
        regionMap.push(entry);Object.assign(columns[source.col].notes[source.row],{midi:event.midi,noteName:event.noteName,sequence,regionId,voiceEventId:event.id});
      });return event;
    });
    const accompaniment=makeAccompaniment(melody,plan.profile,mode,root,plan.rests);
    const bars=Array.from({length:16},(_,index)=>({index,beat:index*4,beats:4,noteCount:melody.filter(n=>n.beat>=index*4&&n.beat<(index+1)*4).length,voiceIds:melody.filter(n=>n.beat<(index+1)*4&&n.beat+n.beats>index*4).map(n=>n.id)}));
    const phrases=PHRASES.map((name,index)=>({index,name,beat:index*16,beats:16}));
    const theme={kind:'image-path',degrees:targets.map(n=>n.midi),signature:digestText(JSON.stringify(targets.map(n=>[n.target,n.midi])))};
    return {
      melody, regionMap, bars, phrases, rests: plan.rests, ...accompaniment,
      totalBeats: 64, tonic: root <= 5 ? 60 + root : 48 + root, root, mode, theme,
      rhythmProfile: {
        version: plan.profile.version, complexity: plan.profile.complexity,
        stableRatio: plan.profile.stableRatio, maxStableRun: plan.profile.maxStableRun, period: plan.profile.period,
      },
      diagnostics: {
        regionCount: 120, onsetCount: melody.length, mergedRegions: 120 - melody.length,
        uniquePitchCount: new Set(melody.map(n => n.midi)).size,
        pitchTransitions: melody.slice(1).filter((n,i) => n.midi !== melody[i].midi).length,
        rhythmSimplified: plan.simplified, thresholds: { ...Rhythm.COEFFICIENTS },
        phaseComplexity: Array.from({length:4},(_,i) => fixed(mean(plan.profile.notes.slice(i*30,i*30+30).map(n => n.complexity)))),
        periodicRetriggers: melody.filter(n => n.reasons.some(r => r.kind === 'measured-period')).length,
        regionFeatures: plan.profile.notes.map(n => ({regionId:n.regionId, vector:n.vector, delta:n.delta, complexity:n.complexity, organizedTexture:n.organized, stable:n.stable})),
        decisions: targets.map(n => ({regionId:n.regionId, target:n.target, baseMidi:n.baseMidi, midi:n.midi, reason:n.pitchDecision})),
        boundaries: melody.map(n => ({voiceId:n.id, regionId:n.regionIds[0], reasons:n.reasons})),
      },
    };
  }
  function audible(event) { return [event.beat,event.beats,event.durationBeats,event.midi,event.velocity,event.envelope,event.send]; }
  const PERFORMANCE_RULES = Object.freeze({ version:'sparse-pluck-v1', minimumSegmentBeats:6, maximumComplexity:.08, maximumFeatureDrift:.035 });
  function makePerformance(score, style) {
    if(!['sparse','continuous'].includes(style))throw new Error('未知演奏方式');
    const events=[],rests=[],decisions=[];
    for(const source of score.melody){
      const features=score.diagnostics.regionFeatures.slice(source.startIndex,source.endIndex+1);
      const complexity=mean(features.map(n=>n.complexity));
      const drift=Math.max(...features.map(n=>Rhythm.difference(n.vector,features[0].vector)));
      const sparse=style==='sparse'&&source.beats>=PERFORMANCE_RULES.minimumSegmentBeats&&complexity<=PERFORMANCE_RULES.maximumComplexity&&drift<=PERFORMANCE_RULES.maximumFeatureDrift&&!source.reasons.some(r=>r.kind==='measured-period');
      const light=mean(features.map(n=>n.vector[0])),chroma=mean(features.map(n=>n.vector[3]));
      const interval=sparse?Math.round((3+.5*(1-light)+.25*chroma)*4)/4:source.beats;
      const noteLength=sparse?Math.round((.9+.25*light)*4)/4:source.durationBeats;
      decisions.push({sourceEventId:source.id,sparse,complexity:fixed(complexity),featureDrift:fixed(drift),intervalBeats:interval,noteBeats:noteLength,reason:sparse?'stable-region-performance-rule':'preserve-image-structure'});
      let stroke=0;
      for(let beat=source.beat;beat<source.beat+source.beats;beat+=interval){
        const remaining=source.beat+source.beats-beat;
        if(sparse&&stroke&&remaining<.75){rests.push({beat,beats:remaining,scope:'performance-melody',sourceEventId:source.id,reason:'performance-rule-trailing-space'});break;}
        const coverageBeats=Math.min(interval,remaining),durationBeats=Math.min(noteLength,remaining);
        const event={...source,id:`${source.id}:stroke-${stroke}`,sourceEventId:source.id,index:events.length,beat,beats:sparse?durationBeats:source.beats,durationBeats,coverageBeats,envelope:sparse?'pluck':'sustain',articulation:sparse?'sparse-repeat':'sustain',send:sparse?.008:source.send,origin:sparse?'performance-rule':'image-structure'};
        events.push(event);
        if(sparse&&coverageBeats>durationBeats)rests.push({beat:beat+durationBeats,beats:coverageBeats-durationBeats,scope:'performance-melody',sourceEventId:source.id,reason:'performance-rule-space'});
        stroke++;
      }
      source.performanceEnvelope=sparse?'pluck':'sustain';
    }
    score.regionMap.forEach(region=>{region.previewRef.envelope=score.melody.find(source=>source.id===region.voiceEventId).performanceEnvelope;});
    return {events,rests,decisions,style,rules:PERFORMANCE_RULES};
  }
  function rhythmFingerprint(score) { return digestText(JSON.stringify({notes:(score.performanceEvents||score.melody).map(n=>[n.beat,n.beats]),rests:[...score.rests,...(score.performanceRests||[])].sort((a,b)=>a.beat-b.beat).map(r=>[r.beat,r.beats])})); }
  function scoreFingerprint(score) {
    if(!score.regionMap)return digestText(JSON.stringify({version:score.version,synthVersion:score.synthVersion,root:score.root,mode:score.mode.id,bpm:score.bpm,tempoMap:score.tempoMap,melody:score.melody.map(n=>[n.regionId,n.beat,n.beats,n.midi,n.durationBeats,n.velocity,n.articulation,n.send]),bars:score.bars.map(b=>[b.beat,b.voicing||b.chord,b.bass]),bass:score.bassEvents,pads:score.padEvents}));
    // Source/mapping metadata has its own signature and must not inflate sound differences.
    return digestText(JSON.stringify({version:score.version,synthVersion:score.synthVersion,bpm:score.bpm,tempoMap:score.tempoMap,melody:(score.performanceEvents||score.melody).map(audible),bass:score.bassEvents.map(audible),pads:score.padEvents.map(audible)}));
  }
  function compose(analysis,options={}) {
    const columns=analysis.columns.map(c=>({notes:c.notes.map(n=>({...n}))})),root=options.root??analysis.root,mode=modeOf(options.modeId||analysis.modeId);
    const arranged=arrangeRegions(columns,root,mode,{...options,rhythmStructure:analysis.rhythmStructure}),bpm=options.bpm??analysis.bpm;
    const score={...analysis,...arranged,columns,bpm,secondsPerBeat:60/bpm,version:'0.6.1',synthVersion:'0.6.1',normalizationVersion:analysis.normalizationVersion||'canonical-fixture-v1'};
    const activities=score.diagnostics.phaseComplexity,average=mean(activities),flat=options.tempo===false||score.rhythmProfile.complexity<.02||Math.max(...activities)-Math.min(...activities)<.02;
    const factor=i=>1+clamp((activities[i]-average)*.08,-.025,.025);
    score.tempoMap=Timing.makeMap(flat?[{beat:0,bpm},{beat:64,bpm}]:[{beat:0,bpm:bpm*factor(0)},{beat:16,bpm:bpm*factor(1)},{beat:32,bpm:bpm*factor(2)},{beat:48,bpm:bpm*factor(3)},{beat:64,bpm:bpm*factor(3)}]);
    score.melodyDuration=Timing.beatToTime(score,64);score.duration=score.melodyDuration+2;
    score.imageRhythmFingerprint=rhythmFingerprint(score);
    const performance=makePerformance(score,options.performanceStyle||'sparse');
    score.performanceEvents=performance.events;score.performanceRests=performance.rests;score.performanceStyle=performance.style;
    Object.assign(score,makeAccompaniment(score.melody,{notes:score.diagnostics.regionFeatures},score.mode,score.root,score.rests));
    score.diagnostics.performanceDecisions=performance.decisions;score.diagnostics.actualOnsetCount=performance.events.length;score.diagnostics.performanceRules=performance.rules;
    score.rhythmFingerprint=rhythmFingerprint(score);score.mappingFingerprint=digestText(JSON.stringify(score.regionMap));
    score.expressionFingerprint=digestText(JSON.stringify({rhythm:score.rhythmFingerprint,bpm,tempo:score.tempoMap,melody:score.performanceEvents.map(n=>[n.durationBeats,n.velocity,n.envelope,n.send]),bass:score.bassEvents.map(audible),pads:score.padEvents.map(audible)}));
    score.scoreHash=scoreFingerprint(score);return score;
  }
  function previewForRegion(score,sequence) { const entry=score.regionMap[sequence];if(!entry)throw new Error('未知图像区域');return {...entry.previewRef,voiceEventId:entry.voiceEventId,regionId:entry.regionId}; }
  function playbackPosition(score,elapsed) {
    const beat=Timing.timeToBeat(score,Math.max(0,elapsed)),tail=beat>=64,rest=score.rests.find(r=>beat>=r.beat&&beat<r.beat+r.beats);
    let index=score.regionMap.findIndex(r=>r.startBeat<=beat&&beat<r.endBeat);
    if(index<0)index=tail?119:score.regionMap.findLastIndex(r=>r.endBeat<=beat);
    const region=index>=0?score.regionMap[index]:null,soundIndex=region?score.melody.findIndex(n=>n.id===region.voiceEventId):-1,note=soundIndex>=0?score.melody[soundIndex]:null;
    const progress=!region?0:rest||tail?1:clamp((beat-region.startBeat)/(region.endBeat-region.startBeat),0,1);
    const performanceIndex=score.performanceEvents?score.performanceEvents.findLastIndex(n=>n.beat<=beat):-1;
    const performanceNote=performanceIndex>=0?score.performanceEvents[performanceIndex]:null;
    const performanceRest=!!performanceNote&&!rest&&!tail&&beat>=performanceNote.beat+performanceNote.durationBeats;
    return {index,region,soundIndex,note,performanceIndex,performanceNote,performanceRest,rest:!!rest||!region,tail,finished:elapsed>=score.duration,scanFraction:region?clamp((region.col+(region.sequence%5+progress)/5)/24,0,1):0,phase:Math.min(3,Math.floor(beat/16)),beat};
  }
  return {MODES,PHRASES,PERFORMANCE_RULES,modeOf,orderedRegions,midiToName,digestText,mapTargets,arrangeRegions,compose,rhythmFingerprint,scoreFingerprint,previewForRegion,playbackPosition,beatToTime:Timing.beatToTime,timeToBeat:Timing.timeToBeat};
});
