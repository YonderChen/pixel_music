const assert = require('node:assert/strict');
const LIMITS = Object.freeze({geometryCoverage:.9,geometryP95Pixels:4,maxUnlabelledObservationRate:.02,maxGapObservations:0,
  maxOnsetErrorBeats:.125,peak:.98,tailPeak:.001,beatTimeError:1e-8,foregroundSyncP95Ms:50,contourComputeP95Ms:150});
function percentile(values,p=.95){
  assert.ok(values.length>0&&p>0&&p<=1);
  assert.ok(values.every(Number.isFinite));
  const sorted=values.slice().sort((a,b)=>a-b);return sorted[Math.ceil(sorted.length*p)-1];
}
function geometry(annotation,predicted){
  const byX=new Map();
  for(const point of predicted){assert.ok(Number.isInteger(point.x)&&point.x>=0&&point.x<192&&Number.isFinite(point.y)&&point.y>=0&&point.y<120);assert.equal(typeof point.observed,'boolean');assert.ok(!byX.has(point.x),'one point per column in a mono track');byX.set(point.x,point);}
  if(annotation.expected==='fallback')return {passed:predicted.every(p=>!p.observed),negative:true,falseObservations:predicted.filter(p=>p.observed).length};
  const observed=annotation.primary.filter(p=>p.observed), expectedXs=new Set(observed.map(p=>p.x));
  const errors=observed.flatMap(p=>byX.get(p.x)?.observed?[Math.abs(p.y-byX.get(p.x).y)]:[]);
  const matched=errors.filter(e=>e<=LIMITS.geometryP95Pixels).length;
  const gapXs=new Set(annotation.primary.filter(p=>!p.observed).map(p=>p.x));
  const gapObservations=predicted.filter(p=>p.observed&&gapXs.has(p.x)).length;
  const falseOutside=predicted.filter(p=>p.observed&&!expectedXs.has(p.x)&&!gapXs.has(p.x)).length;
  const unlabelledColumns=192-expectedXs.size-gapXs.size;
  const falseRate=falseOutside/Math.max(1,unlabelledColumns);
  const p95=errors.length?percentile(errors):null,coverage=matched/observed.length;
  const ordered=predicted.filter(p=>p.observed&&expectedXs.has(p.x)).slice().sort((a,b)=>a.x-b.x);
  let directionViolations=0;
  for(let i=1;i<ordered.length;i++)if(annotation.direction==='pitch-nondecreasing'?ordered[i].y>ordered[i-1].y:annotation.direction==='pitch-nonincreasing'?ordered[i].y<ordered[i-1].y:false)directionViolations++;
  return {passed:coverage>=LIMITS.geometryCoverage&&p95!==null&&p95<=LIMITS.geometryP95Pixels&&gapObservations===0&&falseRate<=LIMITS.maxUnlabelledObservationRate&&directionViolations===0,
    coverage,matched,expectedColumns:observed.length,p95Pixels:p95,gapObservations,falseOutside,unlabelledObservationRate:falseRate,directionViolations};
}
function audio(metrics,{expectedSound=true}={}){
  for(const key of ['peak','rms','tailPeak','invalid','clipped'])assert.ok(Number.isFinite(metrics[key])&&metrics[key]>=0);
  return metrics.invalid===0&&metrics.clipped===0&&metrics.peak<LIMITS.peak&&metrics.tailPeak<LIMITS.tailPeak&&(!expectedSound||metrics.rms>0);
}
module.exports={LIMITS,percentile,geometry,audio};
