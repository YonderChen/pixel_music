const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
class Element{
 constructor(){this.handlers={};this.style={};this.classList={toggle(){}};this.value='';this.checked=false;this.parentElement={clientWidth:900,style:{}};}
 addEventListener(k,fn){this.handlers[k]=fn;}setAttribute(){}querySelectorAll(){return [];}querySelector(){return null;}
 getContext(){return new Proxy({},{get:()=>()=>{}});}toDataURL(){return 'data:image/png;base64,AQ==';}
}
const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
get('tone').value='GeneralUser GS';get('mappingStyle').value='Scientific';get('rowCount').value='4';
const region={id:'r0',col:0,row:0,start:0,end:12,midi:60,targetMidi:60,eventId:'e0',reason:'features',rect:{x:0,y:0,width:1,height:1},features:{hue:.2,saturation:.5,brightness:.5,contrast:.1,texture:.2,centroid:.5}};
const variant={regions:[region],events:[{id:'e0',layer:'main',midi:60,row:0,start:0,duration:12,sources:[{regionId:'r0'}]}],rows:4,cols:1,duration:14,mainCount:1,layerCounts:{main:1},voices:Array.from({length:4},(_,i)=>({id:'row-'+i,name:'row',instrumentName:'GS'})),mixProfiles:{original:{audioUrl:'/audio/parallel.wav'},soft:{audioUrl:'/audio/soft.wav',voices:['a','b','c','d']}}};
const payload={key:'score',image:{width:192,height:120,src:'data:image/png;base64,AQ=='},info:{bars:4,duration:12,tempo:88,key_name:'C',scale_name:'Major'},variants:{parallel:variant,reference:{...variant,audioUrl:'/audio/reference.wav'}},settings:{synth:'GeneralUser GS'}};
const sources=[],requests=[],frames=new Map();let audioContext,frameId=0;
class AudioContext{
 constructor(){audioContext=this;this.state='running';this.currentTime=0;this.destination={};}
 resume(){return Promise.resolve();}close(){this.state='closed';}
 decodeAudioData(){return Promise.resolve({duration:14});}
 createBufferSource(){const node={connect(){},disconnect(){},start(...args){this.startArgs=args;},stop(){this.stopped=true;}};sources.push(node);return node;}
 createGain(){return {connect(){},disconnect(){},gain:{value:1,cancelScheduledValues(){},setValueAtTime(){},linearRampToValueAtTime(){}}};}
}
const fetch=async(url,options={})=>{
 requests.push(url);
 if(url.endsWith('/api/health'))return {ok:true};
 if(url.endsWith('/api/generate'))return {ok:true,json:async()=>structuredClone(payload)};
 if(url.endsWith('/api/preview')||url.includes('/audio/'))return {ok:true,headers:{get(){return '.1';}},arrayBuffer:async()=>new ArrayBuffer(4)};
 throw new Error('unexpected request '+url);
};
const windows={},window={AudioContext,addEventListener:(k,v)=>windows[k]=v,PixelMusicStripSamples:{entries:[]}};
class Image{constructor(){this.width=192;this.height=120;}set src(v){queueMicrotask(()=>this.onload());}}
const context=vm.createContext({window,document:{getElementById:get,createElement:()=>new Element()},location:{protocol:'http:',origin:'http://127.0.0.1:4176',hash:'#parallel'},innerHeight:900,Image,fetch,AbortController,performance,setTimeout,clearTimeout,setInterval,clearInterval,requestAnimationFrame(fn){const id=++frameId;frames.set(id,fn);return id;},cancelAnimationFrame(id){frames.delete(id);},URL,Map,Set,console});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../dist/feature-music-app.js'),'utf8'),context);
const state=()=>window.PixelMusicFeaturesDemo.snapshot();
const until=async(fn)=>{for(let i=0;i<1000;i++){if(fn())return;await new Promise(r=>setTimeout(r,1));}throw new Error('state did not settle');};
const toggle=on=>{get('loopToggle').checked=on;get('loopToggle').handlers.change();};
const finish=node=>{audioContext.currentTime=node.startArgs[0]+node.startArgs[2];node.onended();};
const click=id=>get(id).handlers.click();
(async()=>{
 await until(()=>window.PixelMusicFeaturesDemo.payload()&&!state().busy);
 assert.equal(state().loopEnabled,false);assert.equal(get('loopToggle').disabled,false);
 await click('play');const first=sources.at(-1);finish(first);
 assert.equal(state().playing,false);assert.equal(state().time,14);assert.equal(get('status').textContent,'演奏结束');
 await click('play');const second=sources.at(-1),requestCount=requests.length;toggle(true);
 assert.equal(sources.at(-1),second,'enabling during playback must not restart the current song');
 for(let i=0;i<3;i++){
  const previous=sources.at(-1);finish(previous);
  assert.equal(state().playing,true);assert.equal(state().time,0);assert.equal(sources.at(-1).buffer,second.buffer);
  assert.equal(sources.at(-1).startArgs[1],0,'each repeat starts at the beginning');
  assert.equal(frames.size,1,'repeats keep one animation chain');
 }
 assert.equal(requests.length,requestCount,'repeats reuse decoded audio without HTTP requests');
 const last=sources.at(-1);toggle(false);assert.equal(sources.at(-1),last);finish(last);
 assert.equal(state().playing,false);assert.equal(state().time,14);
 toggle(true);await click('play');const playing=sources.at(-1),staleEnd=playing.onended;
 audioContext.currentTime=playing.startArgs[0]+2.5;click('play');const pausedCount=sources.length;
 assert.equal(state().playing,false);assert.equal(state().time,2.5);assert.equal(playing.onended,null);
 staleEnd();assert.equal(sources.length,pausedCount,'a paused source cannot restart a loop');
 await click('play');assert.equal(sources.at(-1).startArgs[1],2.5,'resume retains its position');
 get('seek').handlers.pointerdown();get('seek').value='10';get('seek').handlers.input();get('seek').handlers.change();
 await until(()=>state().playing);assert.equal(sources.at(-1).startArgs[1],10);finish(sources.at(-1));assert.equal(state().time,0);
 await click('restart');assert.equal(sources.at(-1).startArgs[1],0);
 get('referenceMode').handlers.click();await click('play');finish(sources.at(-1));assert.equal(state().playing,true);assert.equal(state().mode,'reference');
 get('parallelMode').handlers.click();assert.equal(state().loopEnabled,true);
 get('recipe').value='reference-soft';get('recipe').handlers.change();await until(()=>window.PixelMusicFeaturesDemo.payload()&&!state().busy);
 await click('play');finish(sources.at(-1));assert.equal(state().playing,true);assert.equal(state().mixProfile,'soft');
 get('regions').handlers.click({target:{dataset:{index:'0'},closest(){return this;}},detail:1});
 await until(()=>requests.at(-1).endsWith('/api/preview'));await until(()=>sources.at(-1).startArgs);
 const preview=sources.at(-1),previewCount=sources.length;finish(preview);assert.equal(sources.length,previewCount,'single-note audition does not loop');assert.equal(state().playing,false);
 click('abReference');await until(()=>state().playing);const clip=sources.at(-1),clipCount=sources.length;
 assert.equal(clip.startArgs[2],12);finish(clip);assert.equal(sources.length,clipCount,'12-second comparison does not loop');assert.equal(get('status').textContent,'对照结束');
 get('parallelMode').handlers.click();await click('play');const unloading=sources.at(-1),staleUnload=unloading.onended;
 windows.pagehide();staleUnload();assert.equal(state().playing,false);assert.equal(sources.at(-1),unloading);
 const report={status:'passed',checkedOn:'2026-10-11',checks:['default single playback; switch can be enabled or disabled during playback','three consecutive repeats start from zero and reuse decoded audio without requests','one animation chain per repeat','pause invalidates stale end callbacks and resume preserves position','seek and restart work during loop playback','reference and soft mix loop; setting survives recipe changes','single-note previews and 12-second comparisons do not loop','page exit stops playback without restarting'],repeats:6};
 fs.writeFileSync(path.join(__dirname,'loop-playback-client-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
})().catch(e=>{windows.pagehide?.();console.error(e);process.exitCode=1;});
