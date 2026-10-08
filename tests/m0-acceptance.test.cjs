const assert=require('node:assert/strict');
const {all}=require('./m0/geometry-fixtures.cjs');
const A=require('./m0/acceptance.cjs');
let examples=0;
for(const fixture of all()){
  const truth=fixture.annotation,ideal=truth.primary.map(p=>({...p}));
  assert.ok(A.geometry(truth,ideal).passed);
  if(truth.expected==='reliable-track'){
    assert.equal(A.geometry(truth,ideal.map(p=>({...p,y:p.y+6}))).passed,false,'bad y cannot hide in matched-only P95');examples++;
    assert.equal(A.geometry(truth,[]).passed,false);examples++;
    assert.equal(A.geometry(truth,[...ideal,...[0,1,2,3].map(x=>({x,y:60,observed:true}))]).passed,false);examples++;
    if(truth.gapRanges.length){assert.equal(A.geometry(truth,ideal.map(p=>({...p,observed:true}))).passed,false);examples++;}
  }else{assert.equal(A.geometry(truth,[{x:60,y:60,observed:true}]).passed,false);examples++;}
}
assert.equal(A.percentile([1,2,3,4,5,6,7,8,9,10]),10);assert.equal(A.percentile(Array.from({length:100},(_,i)=>i+1)),95);
for(const fixture of all().filter(f=>f.annotation.direction)){
  const reversedLocally=fixture.annotation.primary.map(p=>({...p}));
  reversedLocally[1].y=reversedLocally[0].y+(fixture.family==='rising'?1:-1);
  assert.equal(A.geometry(fixture.annotation,reversedLocally).passed,false,'even low-error reversed direction must fail');examples++;
}
assert.ok(A.audio({peak:.2,rms:.04,tailPeak:.00001,invalid:0,clipped:0}));
for(const bad of [{invalid:1},{clipped:1},{peak:.99},{tailPeak:.01},{rms:0}])assert.equal(A.audio({peak:.2,rms:.04,tailPeak:.00001,invalid:0,clipped:0,...bad}),false);
assert.ok(A.audio({peak:0,rms:0,tailPeak:0,invalid:0,clipped:0},{expectedSound:false}));
assert.throws(()=>A.audio({peak:NaN,rms:0,tailPeak:0,invalid:0,clipped:0}));
console.log(JSON.stringify({status:'passed',geometryFixtures:24,rejectedBadPredictionExamples:examples,metricsDefinitions:'nearest-rank-P95; coverage plus false-observation and gap checks',contourAlgorithmMeasured:false}));
