const assert=require('node:assert/strict'),C=require('./m0-contract.cjs');
const {create}=require('./m0/geometry-fixtures.cjs');
const {sha256,jsonSha}=require('./m0/utils.cjs');
const F=require('./baseline/fidelity-fixtures-v061.js'),I=require('./baseline/image-analysis-v061.js'),M=require('./baseline/music-v061.js');
let rejected=0;
const clone=value=>JSON.parse(JSON.stringify(value));
function specimens(){
  const fixture=create(0,0), candidates=fixture.annotation.primary.map(p=>({id:`p-${p.x}`,x:p.x,y:p.y,strength:.8,observed:true,supportRect:{x0:p.x,x1:p.x+1,y0:p.y-1,y1:p.y+2}}));
  const analysis={schema:C.SCHEMA,version:C.CONTOUR_VERSION,width:192,height:120,imageHash:sha256(fixture.rgba),status:'reliable',fallbackReason:null,candidates,
    tracks:[{id:'track-main',points:candidates.map(p=>({x:p.x,y:p.y,observed:true,candidateId:p.id}))}],diagnostics:{candidateCount:candidates.length,validCoverage:candidates.length/192}};
  const regionIds=[...new Set(candidates.flatMap(p=>C.regionsForRect(p.supportRect)))];
  const source={id:'source-0',voiceId:'main',beat:4,rawBeat:64*12/191,durationBeats:56,midi:60,velocity:.1,envelope:'sustain',origin:'image-structure',sourceRefs:[{trackId:'track-main',pointIds:candidates.map(p=>p.id),regionIds}]};
  const event={...clone(source),id:'event-0',sourceEventId:source.id};
  const score={schema:C.SCHEMA,version:'0.7.0',mappingVersion:C.CONTOUR_VERSION,mappingMode:'contour',eventModel:'provenance-events-v1',imageHash:analysis.imageHash,
    config:{...C.defaults,mappingMode:'contour',performanceStyle:'continuous'},root:0,mode:{id:'soft',notes:C.modes.soft},bpm:88,totalBeats:64,secondsPerBeat:60/88,duration:64*60/88+.45,
    tempoMap:[{beat:0,endBeat:64,spb:60/88,slope:0,seconds:0,endSeconds:64*60/88}],sourceEvents:[source],performanceEvents:[event],structureRests:[{beat:0,beats:4},{beat:60,beats:4}],performanceRests:[],bassEvents:[],padEvents:[],
    regionLinks:Array.from({length:120},(_,i)=>{const regionId=`${Math.floor(i/5)}:${i%5}`,selected=regionIds.includes(regionId);return{regionId,eventIds:selected?['event-0']:[],notSelectedReason:selected?null:'not-on-selected-track'};}),
    structureFingerprint:'a'.repeat(16),scoreHash:'b'.repeat(16),mappingFingerprint:'c'.repeat(16),rhythmFingerprint:'d'.repeat(16)};
  return{analysis,score};
}
const sample=specimens(),before=jsonSha(sample);C.config(C.defaults);C.analysis(sample.analysis);C.score(sample.score,sample.analysis);assert.equal(jsonSha(sample),before);
function reject(mutate){const example=specimens();mutate(example);assert.throws(()=>C.score(example.score,example.analysis));rejected++;}
for(const mutate of [
  e=>e.score.version='0.6.1',e=>e.score.mappingMode='pixel',e=>e.score.regionMap=[],e=>e.score.config.timeGrid=.5,
  e=>e.score.config.maxVoices=2,e=>e.score.sourceEvents[0].midi=61,e=>e.score.sourceEvents[0].beat=5,
  e=>e.score.performanceEvents[0].midi=64,e=>e.score.performanceEvents[0].durationBeats=61,
  e=>e.score.performanceEvents[0].velocity=Infinity,e=>e.score.performanceEvents[0].sourceEventId='missing',
  e=>e.score.performanceEvents[0].origin='performance-rule',e=>e.score.performanceEvents[0].sourceRefs[0].pointIds.push('interpolated'),
  e=>e.score.bassEvents.push({midi:36}),e=>e.score.structureRests=[],e=>e.score.performanceRests=[{beat:6,beats:1}],
  e=>e.score.regionLinks.pop(),e=>e.score.regionLinks[0].eventIds=['event-0'],e=>e.score.regionLinks.find(r=>r.eventIds.length).eventIds=[],
  e=>e.score.tempoMap[0].slope=.01,e=>e.score.scoreHash='unversioned',e=>e.analysis.candidates[0].observed=false,
  e=>e.analysis.tracks[0].points[0].candidateId=null,e=>e.analysis.candidates[0].supportRect.x1=193,
  e=>e.analysis.status='fallback',e=>e.analysis.diagnostics.validCoverage=NaN
])reject(mutate);
const sparse=specimens();sparse.score.config.performanceStyle='sparse';sparse.score.performanceEvents=[];sparse.score.performanceRests=[];
for(let beat=4;beat<60;beat+=3){const durationBeats=Math.min(1.25,60-beat),event={...clone(sparse.score.sourceEvents[0]),id:`pluck-${beat}`,beat,durationBeats,sourceEventId:'source-0',origin:'performance-rule',envelope:'pluck'};sparse.score.performanceEvents.push(event);if(beat+durationBeats<Math.min(beat+3,60))sparse.score.performanceRests.push({beat:beat+durationBeats,beats:Math.min(beat+3,60)-beat-durationBeats});}
for(const link of sparse.score.regionLinks)if(link.eventIds.length)link.eventIds=sparse.score.performanceEvents.map(e=>e.id);
C.score(sparse.score,sparse.analysis);
const pixel=M.compose(I.analyzePixels(F.pixels(60))),pixelBefore=jsonSha(pixel);
for(const reason of C.reasons){const route={requestedMode:'contour',actualMode:'pixel',status:'fallback',reason,score:pixel};C.route(route);assert.equal(route.score,pixel);assert.equal(jsonSha(pixel),pixelBefore);}
C.route({requestedMode:'pixel',actualMode:'pixel',status:'ready',reason:null,score:pixel});
C.route({requestedMode:'contour',actualMode:'contour',status:'ready',reason:null,score:sample.score});
assert.throws(()=>C.route({requestedMode:'contour',actualMode:'pixel',status:'fallback',reason:'program-error',score:pixel}));rejected++;
const fallback={...sample.analysis,status:'fallback',fallbackReason:'transparent-input',tracks:[]};C.analysis(fallback);
console.log(JSON.stringify({status:'passed',rejectedMalformedExamples:rejected,continuousAndSparseContractExamples:true,multiEventRegionLinks:true,fallbackPreservesPixelObject:true,implementationEvidence:'specification-examples-only; contour runtime not implemented'}));
module.exports={specimens};
