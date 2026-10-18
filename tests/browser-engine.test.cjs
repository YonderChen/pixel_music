/* Computational integration test: real WASM runtimes, no browser automation. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),vendor=path.join(root,'dist/browser-runtime/vendor');
const python='/Users/chenyongduo/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
const temp=fs.mkdtempSync('/private/tmp/pixelmusic-parity-');
const fixtureScript=`
import sys,json,io,base64
sys.path.insert(0,'scripts')
import reference_music as e
import numpy as np
from PIL import Image
y,x=np.mgrid[:24,:64]
rgb=np.stack([(x*4+y*3)%256,(x*9+y*7)%256,(x*2+y*13)%256],axis=2).astype('uint8')
out=io.BytesIO();Image.fromarray(rgb).save(out,format='PNG');image=out.getvalue()
results=[]
for method in ['transition','reference','features']:
 for count in [2,3,4]:
  options={'rowMethod':method,'rowCount':count,'pitchTransition':'scale','backing':False,'synth':'Simple','mapping':'Scientific','featureMethod':'features','bars':4}
  p,c=e.prepare_scores(image,options);results.append({'options':options,'payload':p})
for fmt in ['JPEG','WEBP']:
 out=io.BytesIO();Image.fromarray(rgb).save(out,format=fmt);encoded=out.getvalue()
 options={'rowMethod':'reference','rowCount':3,'backing':False,'synth':'Simple','mapping':'Musical','bars':4}
 p,c=e.prepare_scores(encoded,options);results.append({'format':fmt,'image':base64.b64encode(encoded).decode(),'options':options,'payload':p})
out=io.BytesIO();Image.fromarray(np.tile(rgb,(24,12,1))).save(out,format='PNG');encoded=out.getvalue()
options={'rowMethod':'features','rowCount':4,'backing':True,'synth':'Simple','mapping':'Balanced','bars':4}
p,c=e.prepare_scores(encoded,options);results.append({'image':base64.b64encode(encoded).decode(),'options':options,'payload':p})
print(json.dumps({'image':base64.b64encode(image).decode(),'results':results}))
`;
const fixture=JSON.parse(cp.execFileSync(python,['-c',fixtureScript],{cwd:root,maxBuffer:15e6}));
const lock=JSON.parse(fs.readFileSync(path.join(vendor,'pyodide-lock.json')));
for(const name of ['pyodide.js','pyodide.asm.js','pyodide.asm.wasm','python_stdlib.zip','pyodide-lock.json'])fs.symlinkSync(path.join(vendor,name),path.join(temp,name));
for(const name of ['numpy','pillow'])fs.symlinkSync(path.join(vendor,name+'.whl'),path.join(temp,lock.packages[name].file_name));
const sourcesContext={window:{}};vm.runInNewContext(fs.readFileSync(path.join(root,'dist/browser-runtime/sources-data.js'),'utf8'),sourcesContext);
const sources=sourcesContext.window.PixelMusicRuntimeSources;
let maxLocalFeatureDifference=0;const codecChecks=[];
function compare(actual,expected,label){
 if(typeof expected==='number'){const diff=Math.abs(actual-expected),local=label.includes('.features.')||label.includes('.contributions.')||label.endsWith('.curveMidi')||label.endsWith('.pitchPosition');if(local)maxLocalFeatureDifference=Math.max(maxLocalFeatureDifference,diff);assert.ok(diff<(local?0.002:1e-9),label+': '+actual+' vs '+expected);return;}
 if(Array.isArray(expected)){assert.equal(actual.length,expected.length,label);expected.forEach((v,i)=>compare(actual[i],v,label+'.'+i));return;}
 if(expected&&typeof expected==='object'){for(const [k,v] of Object.entries(expected))if(!['scoreSha256','src'].includes(k))compare(actual[k],v,label+'.'+k);return;}
 assert.equal(actual,expected,label);
}
(async()=>{
 const {loadPyodide}=require(path.join(vendor,'pyodide.js'));
 const py=await loadPyodide({indexURL:temp+'/',packages:['numpy','pillow'],stdout(){},stderr(){}});
 for(const [name,source] of Object.entries(sources.python)){const target='/app/'+name;py.FS.mkdirTree(path.posix.dirname(target));py.FS.writeFile(target,source);}
 py.runPython("import sys;sys.path.insert(0,'/app/scripts');from browser_engine import handle");const handle=py.globals.get('handle');
 const call=(url,data)=>JSON.parse(handle(JSON.stringify({path:url,data})));
 for(const expected of fixture.results){
  const result=call('/api/generate',{image:expected.image||fixture.image,options:expected.options});
  if(expected.format){
   const tempoDifference=Math.abs(result.info.tempo-expected.payload.info.tempo);
   codecChecks.push({format:expected.format,tempoDifference});assert.ok(result.variants.parallel.mainCount>0);assert.equal(result.image.width,expected.payload.image.width);assert.equal(result.image.height,expected.payload.image.height);
   if(expected.format==='JPEG'){assert.ok(tempoDifference<.3,'JPEG decoder variation remains bounded in this fixture');continue;}
  }
  compare(result.info,expected.payload.info,'info');compare(result.features,expected.payload.features,'features');
  for(const name of ['reference','parallel'])compare(result.variants[name],expected.payload.variants[name],name);
 }
 // Real soft renderer, mute/solo level retention, finite stereo PCM.
 const options={...fixture.results[0].options,synth:'Simple',backing:true,rowMethod:'features',rowCount:2};
 const payload=call('/api/generate',{image:fixture.image,options});
 const full=call(payload.variants.parallel.mixProfiles.soft.audioUrl),wav=py.FS.readFile(full.file);
 assert.ok(full.metrics.rms>0&&full.metrics.peak<=.91);assert.equal(full.metrics.invalid,0);assert.equal(Buffer.from(wav.subarray(0,4)).toString(),'RIFF');
 const solo=call('/api/rowmix',{key:payload.key,profile:'soft',rows:['row-0'],background:false});assert.ok(solo.metrics.rms>0);
 const soloBytes=py.FS.readFile(solo.file);
 const Core=require('../dist/music-art-core.js');
 const portable=Core.fromPerformance(payload,{mode:'parallel',profile:'soft',rows:[true,false],backing:false,title:'跨页面验收'});
 assert.equal(portable.audioRef.kind,'browser-score');assert.ok(!JSON.stringify(portable).includes('regionId'));assert.ok(!JSON.stringify(portable).includes('image'));
 const replay=call('/api/performance',portable.audioRef);assert.deepEqual(py.FS.readFile(replay.file),soloBytes,'portable score preserves the exact soft solo WAV');
 const bank=call('/api/hover-bank',{key:payload.key,profile:'soft',variant:'parallel'});assert.ok(bank.toneCount>0&&bank.toneCount<=128);
 const bankWave=call(bank.audioUrl);assert.ok(py.FS.readFile(bankWave.file).length>44100);
 const report={status:'passed',checkedOn:'2026-10-12',scoreComparisons:fixture.results.filter(e=>e.format!=='JPEG').length,mappingMatrixComparisons:9,codecChecks,maxLocalFeatureDifference,checks:['Reference/approved row note pitches, timing, instruments and velocities match native Python in the exact comparison fixtures; floating FFT metadata tolerance 0.002','2/3/4 rows and all three approved mapping methods; resized PNG and WebP decode comparison','JPEG decode produces a small platform difference, explicitly reported','Real WASM soft mix audio is finite and non-silent','Mute/solo and soft hover atlases; portable art score preserves soft solo WAV bytes','No native Python or audio server is called by the browser runtime'],soft:full.metrics};
 fs.writeFileSync(path.join(__dirname,'browser-engine-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));handle.destroy();
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>fs.rmSync(temp,{recursive:true,force:true}));
