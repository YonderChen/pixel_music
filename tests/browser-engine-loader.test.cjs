/* Loader contract of dist/browser-engine.js, without a browser: engine scripts load from
 * relative file URLs, the Blob Worker starts only when needed, images are decoded on the
 * page, nothing is fetched, and cancelling a generation stops the Worker. */
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const scripts=[],workers=[];let fetches=0;
const window={};
const document={currentScript:{src:'file:///demo/browser-engine.js'},
 createElement(tag){
  if(tag==='canvas')return {width:0,height:0,getContext:()=>({drawImage(){},getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4).fill(200)}),putImageData(){}}),toDataURL:()=>'data:image/png;base64,AAAA'};
  return {remove(){}};
 },
 head:{appendChild(script){scripts.push(script.src);queueMicrotask(()=>{(window.PixelMusicEngineModules=window.PixelMusicEngineModules||[]).push(function(PM){});script.onload();});}}};
class Worker{
 constructor(url){assert.ok(url.startsWith('blob:'));workers.push(this);this.messages=[];}
 postMessage(message,transfer){this.messages.push(message);if(message.data?.options?.hold)return;
  // A file the engine cannot decode is answered with needsPixels; the page then sends pixels.
  if(message.data?.file&&message.data.options.webp){queueMicrotask(()=>this.onmessage({data:{id:message.id,needsPixels:true}}));return;}
  const preview=message.path==='/api/generate'?{bytes:new Uint8Array(12),width:2,height:2}:undefined;
  queueMicrotask(()=>this.onmessage({data:{id:message.id,data:{ok:true,image:{}},preview}}));}
 terminate(){this.terminated=true;}
}
window.Worker=Worker;
class ImageData{constructor(data,w,h){this.data=data;this.width=w;this.height=h;}}
const createImageBitmap=async()=>({width:3,height:2,close(){}});
vm.runInNewContext(fs.readFileSync('dist/browser-engine.js','utf8'),{window,document,Worker,URL,Blob,Response,DOMException,TextEncoder,Uint8Array,Uint8ClampedArray,ImageData,createImageBitmap,crypto:globalThis.crypto,atob,Object,JSON,Promise,
 fetch(){fetches++;throw Error('no network allowed');}});
const image=Buffer.from('not decoded by this test').toString('base64');
(async()=>{
 const engine=window.PixelMusicBrowser;
 await engine.request('/api/health');assert.equal(workers.length,0,'no Worker for a health probe');
 const response=await engine.request('/api/generate',{body:JSON.stringify({image,options:{synth:'Simple'}})});
 assert.equal((await response.json()).image.src,'data:image/png;base64,AAAA','the page encodes the preview PNG');
 assert.equal(workers.length,1);assert.ok(scripts.length>=10&&scripts.every(url=>url.startsWith('file:///demo/engine/')),'engine scripts load from relative file URLs');
 const sent=workers[0].messages[0].data;assert.equal(sent.pixels,undefined);assert.equal(sent.file.length,24,'the image file goes to the Worker');assert.match(sent.key,/^[0-9a-f]{64}$/);
 await engine.request('/api/generate',{body:JSON.stringify({image,options:{webp:true}})});
 const retry=workers[0].messages.at(-1).data;assert.equal(retry.width,3);assert.equal(retry.pixels.length,3*2*3,'other formats are decoded on the page');assert.equal(retry.key,workers[0].messages.at(-2).data.key);
 await engine.request('/api/performance',{body:JSON.stringify({synth:'Simple'})});
 const controller=new AbortController();const pending=engine.request('/api/generate',{body:JSON.stringify({image,options:{synth:'Simple',hold:true}}),signal:controller.signal});
 while(!workers[0].messages.some(m=>m.data?.options?.hold))await new Promise(setImmediate);controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(workers[0].terminated,true);
 await engine.request('/api/generate',{body:JSON.stringify({image,options:{synth:'Simple'}})});assert.equal(workers.length,2,'cancelled generation can restart');
 const cancelMusic=new AbortController();const music=engine.request('/api/performance',{body:JSON.stringify({options:{hold:true}}),signal:cancelMusic.signal});await new Promise(setImmediate);cancelMusic.abort();await assert.rejects(music,{name:'AbortError'});assert.equal(workers[1].terminated,true,'cancelled art music stops the Worker');
 assert.equal(fetches,0);engine.reset();console.log('passed: file URL engine scripts, Blob Worker, image files decoded in the Worker with a page fallback, cancellation and no network fetch');
})().catch(error=>{console.error(error);process.exitCode=1;});
