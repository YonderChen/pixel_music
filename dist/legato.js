(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./music.js'):root.PixelMusic,typeof module==='object'&&module.exports?require('./audio.js'):root.PixelMusicAudio);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.PixelMusicLegato=api;
})(typeof globalThis==='object'?globalThis:this,function(Music,Audio){
  'use strict';
  const VERSION='legato-flow-v1',RULES=Object.freeze({version:VERSION,maxGlideSeconds:.12,glideFraction:.4,attackSeconds:.14,releaseSeconds:.55,restPolicy:'hold-or-single-bridge-through-boundaries',maxBridgesPerTransition:1,bridgeMinimumDegrees:3,bridgeMinimumBeats:.75});
  const frequency=midi=>440*2**((midi-69)/12),fixed=n=>Math.round(n*1e6)/1e6;
  const level=p=>p.velocity*Math.min(1.15,Math.max(.84,(440/frequency(p.midi))**.1));
  function apply(base){
    if(base.rendererVersion===VERSION)return base;
    if(base.expressionVersion)throw new Error('简化连绵需要原始像素基谱，不叠加回绕音型');
    if(!base.regionMap||!base.performanceEvents?.length)throw new Error('连绵演奏需要像素乐谱');
    const sources=new Map(base.melody.map(e=>[e.id,e])),anchors=[];
    for(const event of base.performanceEvents){
      const source=sources.get(event.sourceEventId),velocity=source?.velocity??event.velocity;
      const regions=event.expressionSupport?.regionIds||event.regionIds||source?.regionIds||[];
      const previous=anchors.at(-1);
      if(previous&&previous.midi===event.midi&&previous.velocity===velocity){
        previous.sourcePerformanceEventIds.push(event.id);previous.regionIds=[...new Set([...previous.regionIds,...regions])];continue;
      }
      anchors.push({...event,id:`flow-target-${anchors.length}`,index:anchors.length,beat:anchors.length?event.beat:0,midi:event.midi,velocity,
        sourcePerformanceEventIds:[event.id],regionIds:regions.slice(),envelope:'legato',origin:'continuous-flow-rule',articulation:'legato-target',kind:'colour-target'});
    }
    const scale=[];for(let n=46;n<=79;n++)if(base.mode.notes.includes(((n-base.root)%12+12)%12))scale.push(n);
    const points=[];let bridges=0;
    for(let i=0;i<anchors.length;i++){
      const current=anchors[i],previous=anchors[i-1];
      if(previous){
        const a=scale.indexOf(previous.midi),b=scale.indexOf(current.midi),gap=current.beat-previous.beat;
        if(a>=0&&b>=0&&Math.abs(b-a)>=RULES.bridgeMinimumDegrees&&gap>=RULES.bridgeMinimumBeats){
          const beat=current.beat-Math.min(.5,gap*.25),midi=scale[a+Math.sign(b-a)*Math.floor(Math.abs(b-a)/2)];
          points.push({...previous,beat,midi,noteName:Music.midiToName(midi),velocity:(previous.velocity+current.velocity)/2,kind:'single-bridge',origin:'single-bridge-rule',sourcePerformanceEventIds:[],
            bridgeSupport:{version:VERSION,anchorPerformanceEventIds:[previous.sourcePerformanceEventIds.at(-1),current.sourcePerformanceEventIds[0]],rule:'one-scale-midpoint'},regionIds:[...new Set([...previous.regionIds,...current.regionIds])]});bridges++;
        }
      }
      points.push(current);
    }
    points.forEach((p,i)=>{p.id=`flow-target-${i}`;p.index=i;});
    points.forEach((p,i)=>{p.endBeat=points[i+1]?.beat??base.totalBeats;p.beats=p.durationBeats=fixed(p.endBeat-p.beat);p.coverageBeats=p.beats;if(!(p.beats>0))throw new Error('连绵时间轴无效');});
    const score={...base,version:'0.6.4-exp',synthVersion:VERSION,rendererVersion:VERSION,sourceScoreHash:base.scoreHash,performanceEvents:points,
      sourceRests:base.rests,sourcePerformanceRests:base.performanceRests,sourceExpressionRests:base.expressionRests||[],rests:[],performanceRests:[],expressionRests:[],
      flowRules:RULES,diagnostics:{...base.diagnostics,actualOnsetCount:1,legato:{version:VERSION,melodyStarts:1,targets:points.length,pitchChanges:points.slice(1).filter((p,i)=>p.midi!==points[i].midi).length,
        heldImageRests:base.rests.length,heldPerformanceRests:base.performanceRests.length,singleBridges:bridges,baseExpression:'original-pixel-colour',restPolicy:RULES.restPolicy}}};
    score.rhythmFingerprint=Music.digestText(JSON.stringify({version:VERSION,continuous:[0,base.totalBeats],targets:points.map(p=>p.beat),tempo:score.tempoMap}));
    score.mappingFingerprint=Music.digestText(JSON.stringify({source:base.mappingFingerprint,targets:points.map(p=>[p.beat,p.endBeat,p.sourcePerformanceEventIds,p.regionIds]),heldImageRests:base.rests}));
    score.scoreHash=fingerprint(score);score.expressionFingerprint=Music.digestText(JSON.stringify({version:VERSION,score:score.scoreHash}));return score;
  }
  function fingerprint(score){return Music.digestText(JSON.stringify({version:VERSION,rules:RULES,tempo:score.tempoMap,totalBeats:score.totalBeats,
    points:score.performanceEvents.map(p=>[p.beat,p.midi,p.velocity]),bass:score.bassEvents,pads:score.padEvents}));}
  function timeline(score){
    const end=Music.beatToTime(score,score.totalBeats),points=score.performanceEvents.map(p=>({...p,seconds:Music.beatToTime(score,p.beat),frequency:frequency(p.midi),level:level(p)}));
    points.forEach((p,i)=>{p.glide=i?Math.min(RULES.maxGlideSeconds,Math.max(.001,((points[i+1]?.seconds??end)-p.seconds)*RULES.glideFraction)):0;});
    const attack=Math.min(RULES.attackSeconds,((points[1]?.seconds??end)-points[0].seconds)*RULES.glideFraction);
    return{points,end,releaseEnd:end+RULES.releaseSeconds,attack};
  }
  function stateAt(plan,seconds){
    let value={frequency:plan.points[0].frequency,level:plan.points[0].level};
    for(let i=1;i<plan.points.length;i++){
      const p=plan.points[i],previous=plan.points[i-1];if(seconds<p.seconds)break;
      const fraction=Math.min(1,(seconds-p.seconds)/p.glide);
      value={frequency:previous.frequency*(p.frequency/previous.frequency)**fraction,level:previous.level+(p.level-previous.level)*fraction};
    }
    if(seconds<plan.attack)value.level*=Math.max(0,seconds)/plan.attack;
    if(seconds>=plan.end)value.level*=Math.max(0,(plan.releaseEnd-seconds)/RULES.releaseSeconds);
    return value;
  }
  function createSession(context,{bpm=88,volume=1}={}){
    const backing=Audio.createSession(context,{bpm,volume}),nodes=new Set(),sources=new Set();let stopped=false;
    const make=method=>{const node=context[method]();nodes.add(node);return node;};
    function schedule(score,start=context.currentTime+.08,tone='warm',fromBeat=0){
      if(stopped)return{start,end:start};if(score.rendererVersion!==VERSION)throw new Error('需要连绵乐谱');if(!['warm','glass','mist'].includes(tone))throw new Error('未知音色');
      backing.schedule({...score,performanceEvents:[]},start,tone,fromBeat);
      const plan=timeline(score),offset=Math.max(0,Music.beatToTime(score,fromBeat));
      if(offset>=plan.releaseEnd)return{start,end:start+score.duration};
      const onset=start+offset,state=stateAt(plan,offset),gain=make('createGain'),filter=make('createBiquadFilter');
      filter.type='lowpass';filter.frequency.setValueAtTime(tone==='glass'?3600:tone==='mist'?1400:2600,onset);gain.connect(filter);filter.connect(backing.output);
      gain.gain.setValueAtTime(.0001,onset);
      const fade=offset?Math.min(.025,(plan.releaseEnd-offset)*.4):plan.attack;
      gain.gain.linearRampToValueAtTime(Math.max(.0001,stateAt(plan,offset+fade).level),onset+fade);
      let cutoff=offset+fade;
      const partials=tone==='glass'?[['sine',1,.76],['sine',2,.12],['sine',4,.025]]:tone==='mist'?[['triangle',1,.35],['sine',1,.52]]:[['sine',1,.75],['triangle',1,.15],['sine',2,.055]];
      for(const [type,ratio,amount]of partials){
        const osc=make('createOscillator'),mix=make('createGain');osc.type=type;mix.gain.value=amount;osc.connect(mix);mix.connect(gain);
        osc.frequency.setValueAtTime(state.frequency*ratio,onset);
        const active=plan.points.find((p,i)=>i&&offset>=p.seconds&&offset<p.seconds+p.glide);
        if(active)osc.frequency.exponentialRampToValueAtTime(active.frequency*ratio,start+active.seconds+active.glide);
        for(let i=1;i<plan.points.length;i++){const p=plan.points[i],previous=plan.points[i-1];if(p.seconds<=offset||p.frequency===previous.frequency)continue;
          osc.frequency.setValueAtTime(previous.frequency*ratio,start+p.seconds);osc.frequency.exponentialRampToValueAtTime(p.frequency*ratio,start+p.seconds+p.glide);
        }
        sources.add(osc);osc.onended=()=>{sources.delete(osc);osc.disconnect();nodes.delete(osc);mix.disconnect();nodes.delete(mix);};
        osc.start(onset);osc.stop(start+plan.releaseEnd+.03);
      }
      for(let i=1;i<plan.points.length;i++){
        const p=plan.points[i],previous=plan.points[i-1],end=p.seconds+p.glide;
        if(end<=cutoff)continue;
        if(p.seconds>cutoff)gain.gain.setValueAtTime(previous.level,start+p.seconds);
        gain.gain.linearRampToValueAtTime(Math.max(.0001,p.level),start+end);cutoff=end;
      }
      if(plan.end>cutoff)gain.gain.setValueAtTime(plan.points.at(-1).level,start+plan.end);
      gain.gain.linearRampToValueAtTime(.0001,start+plan.releaseEnd);
      return{start,end:start+score.duration};
    }
    function dispose(){backing.dispose();for(const node of nodes){try{node.disconnect();}catch{}}nodes.clear();sources.clear();}
    function stop(){if(stopped)return;stopped=true;backing.stop();for(const osc of sources){try{osc.stop(context.currentTime+.03);}catch{}}setTimeout(dispose,50);}
    return{schedule,stop,dispose,output:backing.output,get sourceCount(){return sources.size+backing.sourceCount;}};
  }
  async function renderOffline(score,{tone='warm',sampleRate=22050,volume=1,OfflineContext=globalThis.OfflineAudioContext||globalThis.webkitOfflineAudioContext}={}){
    if(!OfflineContext)throw new Error('当前浏览器不支持离线音频渲染');
    const context=new OfflineContext(1,Math.ceil((score.duration+.1)*sampleRate),sampleRate),session=createSession(context,{bpm:score.bpm,volume});
    session.schedule(score,.05,tone);const buffer=await context.startRendering();session.dispose();return buffer;
  }
  return{VERSION,RULES,apply,fingerprint,timeline,stateAt,createSession,renderOffline};
});
