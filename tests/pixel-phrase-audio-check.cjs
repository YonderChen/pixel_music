// Optional inspection of actual downloaded PCM WAVs; pass explicit local files.
const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const files=process.argv.slice(2);
assert.ok(files.length,'Usage: node tests/pixel-phrase-audio-check.cjs /absolute/path.wav [another.wav]');
function inspect(file){
  const bytes=fs.readFileSync(file);assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WAVE');
  assert.equal(bytes.readUInt16LE(20),1);assert.equal(bytes.readUInt16LE(22),1);assert.equal(bytes.readUInt16LE(34),16);assert.equal(bytes.length,44+bytes.readUInt32LE(40));
  const sampleRate=bytes.readUInt32LE(24),frames=(bytes.length-44)/2,samples=new Float64Array(frames);let peak=0,energy=0,tailPeak=0,clipped=0;
  for(let i=0;i<frames;i++){const n=bytes.readInt16LE(44+i*2)/32768,v=Math.abs(n);samples[i]=n;peak=Math.max(peak,v);energy+=n*n;if(v>=.98)clipped++;if(i>=frames-Math.ceil(sampleRate*.1))tailPeak=Math.max(tailPeak,v);}
  assert.ok(peak<.98&&clipped===0&&energy>0&&tailPeak<.001,'real WAV safety');
  return{samples,metrics:{source:file,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),sampleRate,frames,seconds:frames/sampleRate,peak,rms:Math.sqrt(energy/frames),tailPeak,clipped,headerValid:true}};
}
const data=files.map(inspect),report={status:'passed',evidenceType:'downloaded-PCM-WAV-inspection',files:data.map(d=>d.metrics),subjectiveQualityNotProven:true};
if(data.length===2){
  assert.equal(data[0].metrics.sampleRate,data[1].metrics.sampleRate);
  const length=Math.min(data[0].samples.length,data[1].samples.length,Math.floor(data[0].metrics.sampleRate*12));
  const a=data[0].samples.subarray(0,length),b=data[1].samples.subarray(0,length),rms=v=>Math.sqrt(v.reduce((s,n)=>s+n*n,0)/v.length),ar=rms(a),br=rms(b);
  let error=0,dot=0;for(let i=0;i<length;i++){const x=a[i]/ar,y=b[i]/br;error+=(x-y)**2;dot+=x*y;}
  report.first12Seconds={normalizedDifferenceRms:Math.sqrt(error/length),correlation:dot/length};
}
console.log(JSON.stringify(report));
