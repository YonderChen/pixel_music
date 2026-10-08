// Read-only CPU baseline, not a browser or contour algorithm performance claim.
const os=require('node:os'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const {inputs}=require('./dataset.cjs'),{sha256,read}=require('./utils.cjs'),{percentile}=require('./acceptance.cjs');
const Image=require('../../dist/image-analysis.js'),Music=require('../../dist/music.js');
const warmup=5,iterations=30,rows=[];
const summarize=values=>({minMs:Math.min(...values),medianMs:percentile(values,.5),p95Ms:percentile(values,.95),maxMs:Math.max(...values)});
const started=new Date().toISOString();
for(const input of inputs())for(const style of ['sparse','continuous']){
  const inputSha256=sha256(input.rgba),times=[];let hash;
  for(let i=-warmup;i<iterations;i++){
    const start=performance.now(),score=Music.compose(Image.analyzePixels(input.rgba),{performanceStyle:style}),elapsed=performance.now()-start;
    if(hash!==undefined)assert.equal(score.scoreHash,hash,'baseline determinism');hash=score.scoreHash;if(i>=0)times.push(elapsed);
  }
  assert.equal(sha256(input.rgba),inputSha256,'immutable input');
  rows.push({id:input.id,performanceStyle:style,inputSha256,scoreHash:hash,samplesMs:times,...summarize(times)});
}
const result={schema:'pixelmusic-m0-benchmark-v1',evidenceType:'node-cpu-pixel-baseline-only',startedAtUtc:started,finishedAtUtc:new Date().toISOString(),
  environment:{platform:process.platform,arch:process.arch,osRelease:os.release(),cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,memoryBytes:os.totalmem(),node:process.version,executable:process.execPath},
  protocol:{width:192,height:120,inputs:120,styles:['sparse','continuous'],warmupPerCase:warmup,iterationsPerCase:iterations,measuredCases:rows.length,measuredCalls:rows.length*iterations,timed:'analyzePixels + compose; no decode, IO, hashing, view, audio or export',percentile:'nearest-rank',concurrency:1},
  source: ['dist/image-analysis.js','dist/music.js','dist/rhythm.js','dist/timing.js'].map(path=>({path,sha256:sha256(read(path))})),
  aggregate:summarize(rows.flatMap(row=>row.samplesMs)),worstCaseP95Ms:Math.max(...rows.map(row=>row.p95Ms)),rows,contourMeasured:false,browserMeasured:false};
console.log(JSON.stringify(result,null,2));
