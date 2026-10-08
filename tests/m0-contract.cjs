// M0 executable specification, not a contour detector/composer or runtime router.
const assert = require('node:assert/strict');
const PIXEL_VERSION='0.6.1', SCHEMA='visual-score-v1', CONTOUR_VERSION='contour-v1';
const defaults=Object.freeze({mappingMode:'pixel',performanceStyle:'sparse',tone:'warm',totalBeats:64,timeGrid:.25,midiMin:48,midiMax:72,maxVoices:1});
const modes={bright:[0,2,4,7,9],soft:[0,2,4,5,7,9,11],deep:[0,2,3,5,7,8,10]};
const reasons=['no-reliable-track','low-reliability','transparent-input'];
const finite=(value,lo,hi)=>assert.ok(Number.isFinite(value)&&value>=lo&&value<=hi,'finite bounded value');
const unique=values=>assert.equal(new Set(values).size,values.length,'duplicate ids');
function config(value){
  assert.ok(['pixel','contour'].includes(value.mappingMode));assert.ok(['sparse','continuous'].includes(value.performanceStyle));
  assert.ok(['warm','glass','mist'].includes(value.tone));
  for(const key of ['totalBeats','timeGrid','midiMin','midiMax','maxVoices'])assert.equal(value[key],defaults[key]);return value;
}
function regionsForRect(rect){
  for(const [key,max] of [['x0',191],['x1',192],['y0',119],['y1',120]])finite(rect[key],0,max);
  assert.ok(rect.x1>rect.x0&&rect.y1>rect.y0);
  const ids=[];for(let col=Math.floor(rect.x0/8);col<=Math.ceil(rect.x1/8)-1;col++)for(let row=Math.floor(rect.y0/24);row<=Math.ceil(rect.y1/24)-1;row++)ids.push(`${col}:${row}`);
  return ids;
}
function analysis(value){
  assert.equal(value.schema,SCHEMA);assert.equal(value.version,CONTOUR_VERSION);assert.equal(value.width,192);assert.equal(value.height,120);
  assert.match(value.imageHash,/^[a-f0-9]{64}$/);assert.ok(['reliable','fallback'].includes(value.status));
  unique(value.candidates.map(p=>p.id));const candidates=new Map(value.candidates.map(p=>[p.id,p])), perColumn=new Map();
  for(const p of value.candidates){finite(p.x,0,191);assert.ok(Number.isInteger(p.x));finite(p.y,0,119);finite(p.strength,0,1);assert.equal(p.observed,true);regionsForRect(p.supportRect);assert.ok(p.x>=p.supportRect.x0&&p.x<p.supportRect.x1&&p.y>=p.supportRect.y0&&p.y<p.supportRect.y1);perColumn.set(p.x,(perColumn.get(p.x)||0)+1);}
  assert.ok([...perColumn.values()].every(count=>count<=6));unique(value.tracks.map(t=>t.id));assert.ok(value.tracks.length<=1);
  for(const track of value.tracks){
    let previous=-1;for(const p of track.points){finite(p.x,0,191);finite(p.y,0,119);assert.ok(Number.isInteger(p.x)&&p.x>previous);previous=p.x;assert.equal(typeof p.observed,'boolean');
      if(p.observed){const c=candidates.get(p.candidateId);assert.ok(c);assert.equal(p.x,c.x);assert.equal(p.y,c.y);}else assert.equal(p.candidateId,null);
    }
    assert.ok(track.points.some(p=>p.observed));
  }
  if(value.status==='reliable'){assert.equal(value.tracks.length,1);assert.equal(value.fallbackReason,null);}else{assert.equal(value.tracks.length,0);assert.ok(reasons.includes(value.fallbackReason));}
  assert.equal(value.diagnostics.candidateCount,value.candidates.length);finite(value.diagnostics.validCoverage,0,1);return value;
}
function partition(spans,total=64){
  const sorted=spans.slice().sort((a,b)=>a[0]-b[0]);assert.ok(sorted.length);let end=0;
  for(const [start,stop] of sorted){assert.ok(Math.abs(start-end)<1e-8,'time gap or overlap');assert.ok(stop>start&&stop<=total+1e-8);end=stop;}
  assert.ok(Math.abs(end-total)<1e-8,'time axis incomplete');
}
function score(value,structure){
  analysis(structure);assert.equal(structure.status,'reliable');assert.equal(value.schema,SCHEMA);assert.equal(value.version,'0.7.0');assert.equal(value.mappingVersion,CONTOUR_VERSION);
  config(value.config);assert.equal(value.config.mappingMode,'contour');assert.equal(value.imageHash,structure.imageHash);assert.equal(value.mappingMode,'contour');assert.equal(value.eventModel,'provenance-events-v1');
  finite(value.root,0,11);assert.ok(Number.isInteger(value.root));assert.ok(modes[value.mode.id]);assert.deepEqual(value.mode.notes,modes[value.mode.id]);finite(value.bpm,76,104);assert.equal(value.totalBeats,64);assert.equal(value.secondsPerBeat,60/value.bpm);
  assert.equal(value.tempoMap.length,1);const time=value.tempoMap[0];assert.equal(time.beat,0);assert.equal(time.endBeat,64);assert.equal(time.slope,0);assert.equal(time.seconds,0);assert.equal(time.spb,value.secondsPerBeat);assert.ok(Math.abs(time.endSeconds-64*time.spb)<1e-8);finite(value.duration,time.endSeconds,time.endSeconds+2);
  assert.deepEqual(value.bassEvents,[]);assert.deepEqual(value.padEvents,[]);
  const candidates=new Map(structure.candidates.map(p=>[p.id,p]));const track=structure.tracks[0];const trackIds=new Set(track.points.filter(p=>p.observed).map(p=>p.candidateId));
  function refs(event){assert.ok(event.sourceRefs.length);const regionIds=new Set();
    for(const ref of event.sourceRefs){assert.equal(ref.trackId,track.id);assert.ok(ref.pointIds.length);unique(ref.pointIds);
      const actual=new Set();for(const id of ref.pointIds){assert.ok(trackIds.has(id),'interpolated or foreign point');for(const region of regionsForRect(candidates.get(id).supportRect))actual.add(region);}
      assert.deepEqual(ref.regionIds.slice().sort(),[...actual].sort());ref.regionIds.forEach(id=>regionIds.add(id));
    }return [...regionIds];
  }
  function event(e){assert.equal(e.voiceId,'main');finite(e.beat,0,64);finite(e.durationBeats,.000001,64);assert.ok(e.beat+e.durationBeats<=64+1e-8);assert.ok(Number.isInteger(e.midi));finite(e.midi,48,72);assert.ok(modes[value.mode.id].includes(((e.midi-value.root)%12+12)%12));finite(e.velocity,.000001,.15);assert.ok(['pluck','sustain'].includes(e.envelope));}
  assert.ok(value.sourceEvents.length);unique(value.sourceEvents.map(e=>e.id));const sources=new Map(value.sourceEvents.map(e=>[e.id,e]));
  for(const e of value.sourceEvents){event(e);assert.equal(e.origin,'image-structure');assert.equal(e.envelope,'sustain');finite(e.rawBeat,0,64);assert.ok(Math.abs(e.beat-e.rawBeat)<=.125+1e-8);assert.equal(e.beat/.25,Math.round(e.beat/.25));assert.equal(e.durationBeats/.25,Math.round(e.durationBeats/.25));refs(e);}
  const restSpans=rests=>rests.map(r=>{finite(r.beat,0,64);finite(r.beats,.000001,64);assert.ok(r.beat+r.beats<=64+1e-8);return[r.beat,r.beat+r.beats];});
  partition([...value.sourceEvents.map(e=>[e.beat,e.beat+e.durationBeats]),...restSpans(value.structureRests)]);
  assert.ok(value.performanceEvents.length);unique(value.performanceEvents.map(e=>e.id));let previous=-1;
  const events=new Map(value.performanceEvents.map(e=>[e.id,e])), eventRegions=new Map();
  for(const e of value.performanceEvents){event(e);assert.ok(e.beat>previous);previous=e.beat;const source=sources.get(e.sourceEventId);assert.ok(source);assert.equal(e.midi,source.midi);assert.equal(e.velocity,source.velocity);assert.ok(e.beat>=source.beat&&e.beat+e.durationBeats<=source.beat+source.durationBeats+1e-8);assert.deepEqual(e.sourceRefs,source.sourceRefs);assert.equal(e.origin,e.envelope==='pluck'?'performance-rule':'image-structure');eventRegions.set(e.id,refs(e));}
  partition([...value.performanceEvents.map(e=>[e.beat,e.beat+e.durationBeats]),...restSpans(value.performanceRests),...restSpans(value.structureRests)]);
  assert.equal(value.regionLinks.length,120);unique(value.regionLinks.map(r=>r.regionId));
  for(let i=0;i<120;i++){const r=value.regionLinks[i];assert.equal(r.regionId,`${Math.floor(i/5)}:${i%5}`);unique(r.eventIds);for(const id of r.eventIds){assert.ok(events.has(id));assert.ok(eventRegions.get(id).includes(r.regionId));}for(const [id,ids]of eventRegions)assert.equal(r.eventIds.includes(id),ids.includes(r.regionId));assert.equal(r.notSelectedReason,r.eventIds.length?null:'not-on-selected-track');}
  for(const field of ['structureFingerprint','scoreHash','mappingFingerprint','rhythmFingerprint'])assert.match(value[field],/^[a-f0-9]{16}$/);
  assert.equal(value.regionMap,undefined,'do not forge a pixel regionMap');return value;
}
function route(value){
  assert.ok(['pixel','contour'].includes(value.requestedMode));assert.ok(['pixel','contour'].includes(value.actualMode));
  if(value.status==='fallback'){assert.equal(value.requestedMode,'contour');assert.equal(value.actualMode,'pixel');assert.ok(reasons.includes(value.reason));assert.equal(value.score.version,PIXEL_VERSION);}
  else{assert.equal(value.status,'ready');assert.equal(value.reason,null);assert.equal(value.actualMode,value.requestedMode);assert.equal(value.score.version,value.actualMode==='pixel'?PIXEL_VERSION:'0.7.0');}
  return value;
}
module.exports={PIXEL_VERSION,SCHEMA,CONTOUR_VERSION,defaults,modes,reasons,config,regionsForRect,analysis,partition,score,route};
