const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const scripts=[],workers=[];let fetches=0;
const window={},assets={'sources-data.js':['PixelMusicRuntimeSources',{scripts:{},python:{}}],'compute-data.js':['PixelMusicComputeAssets',{}],'worker.js':['PixelMusicWorkerMain',function(){}],'soundfont-data.js':['PixelMusicSoundfontData','AQ==']};
const document={currentScript:{src:'file:///demo/browser-engine.js'},createElement(){return {remove(){}};},head:{appendChild(script){scripts.push(script.src);const name=new URL(script.src).pathname.split('/').pop();queueMicrotask(()=>{const [key,value]=assets[name];window[key]=value;script.onload();});}}};
class Worker{
 constructor(url){assert.ok(url.startsWith('blob:'));workers.push(this);this.messages=[];}
 postMessage(message){this.messages.push(message);if(message.init)return;if(message.data?.hold)return;queueMicrotask(()=>this.onmessage({data:{id:message.id,data:{ok:true}}}));}
 terminate(){this.terminated=true;}
}
window.Worker=Worker;window.WebAssembly=WebAssembly;
vm.runInNewContext(fs.readFileSync('dist/browser-engine.js','utf8'),{window,document,Worker,WebAssembly,URL,Blob,Response,DOMException,fetch(){fetches++;throw Error('no network allowed');}});
(async()=>{
 const engine=window.PixelMusicBrowser;
 await engine.request('/api/health');assert.equal(workers.length,0,'no heavy runtime for a health probe');
 await engine.request('/api/generate',{body:JSON.stringify({options:{synth:'Simple'}})});
 assert.equal(workers.length,1);assert.ok(scripts.every(url=>url.startsWith('file:///demo/browser-runtime/')));assert.equal(fetches,0);
 await engine.request('/api/performance',{body:JSON.stringify({synth:'GeneralUser GS'})});assert.ok(scripts.some(url=>url.endsWith('soundfont-data.js')));
 const controller=new AbortController();const pending=engine.request('/api/generate',{body:JSON.stringify({options:{synth:'Simple'},hold:true}),signal:controller.signal});
 await new Promise(setImmediate);controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(workers[0].terminated,true);
 await engine.request('/api/generate',{body:JSON.stringify({options:{synth:'Simple'}})});assert.equal(workers.length,2,'cancelled generation can restart');
 const cancelMusic=new AbortController();const music=engine.request('/api/performance',{body:JSON.stringify({synth:'Simple',hold:true}),signal:cancelMusic.signal});await new Promise(setImmediate);cancelMusic.abort();await assert.rejects(music,{name:'AbortError'});assert.equal(workers[1].terminated,true,'cancelled art music stops the computational Worker');
 assert.equal(fetches,0);engine.reset();console.log('passed: file URL scripts, Blob Worker, lazy SoundFont, cancellation and no network fetch');
})().catch(error=>{console.error(error);process.exitCode=1;});
