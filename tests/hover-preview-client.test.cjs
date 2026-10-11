const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
class Element{
 constructor(){this.handlers={};this.style={};this.classList={toggle(){}};this.value='';this.parentElement={clientWidth:900,style:{}};}
 addEventListener(k,fn){this.handlers[k]=fn;}setAttribute(){}querySelectorAll(){return [];}querySelector(){return null;}
 getContext(){return new Proxy({},{get:()=>()=>{}});}toDataURL(){return 'data:image/png;base64,AQ==';}
}
const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
get('tone').value='GeneralUser GS';get('mappingStyle').value='Scientific';get('rowCount').value='4';
const regions=Array.from({length:4},(_,i)=>({id:'r'+i,index:i,col:i,row:0,start:i,end:i+1,midi:i===2?null:[60,64,0,67][i],targetMidi:i===2?null:60,eventId:i===2?null:'e'+i,reason:'features',rect:{x:i/4,y:0,width:.25,height:.25},features:{hue:.2,saturation:.5,brightness:.5,contrast:.1,texture:.2,centroid:.5}}));
const events=regions.filter(r=>r.eventId).map(r=>({id:r.eventId,start:r.start,duration:1,midi:r.midi,row:0,rowId:'row-0',layer:'main',sources:[{regionId:r.id,rect:r.rect}]}));
const variant={regions,events,rows:4,cols:4,duration:4.8,mainCount:3,layerCounts:{main:3},rowMethod:'transition',voices:Array.from({length:4},(_,i)=>({id:'row-'+i,name:'row',instrumentName:'GS'})),mixProfiles:{original:{},soft:{voices:['a','b','c','d']}}};
const payload={key:'score',image:{width:192,height:120,src:'data:image/png;base64,AQ=='},info:{bars:4,duration:4,tempo:88,key_name:'C',scale_name:'Major'},variants:{parallel:variant,reference:structuredClone(variant)},settings:{synth:'GeneralUser GS'}};
payload.variants.reference.audioUrl='/api/audio/reference.wav';
const plays=[],stops=[],requests=[],held=[];let holdBank=true,generations=0,createdContext;
class AudioContext{
 constructor(){createdContext=this;this.state='running';this.currentTime=0;this.destination={};}resume(){this.state='running';return Promise.resolve();}close(){this.state='closed';}
 decodeAudioData(){return Promise.resolve({duration:3});}
 createBufferSource(){const node={connect(){},disconnect(){},start(...args){plays.push(args);},stop(){stops.push(node);}};return node;}
 createGain(){return {connect(){},disconnect(){},gain:{value:1,cancelScheduledValues(){},setValueAtTime(){},linearRampToValueAtTime(){}}};}
}
const metadata={audioUrl:'/api/hover-audio/score/bank.wav',tones:[{offset:0,duration:1},{offset:1,duration:1},{offset:2,duration:1}],events:{e0:{tone:0,gain:1},e1:{tone:1,gain:.9},e3:{tone:2,gain:.8}}};
const fetch=async(url,options={})=>{
 if(options.signal?.aborted)throw new Error('aborted');requests.push({url,body:options.body?JSON.parse(options.body):null});
 if(url.endsWith('/api/health'))return {ok:true};
 if(url.endsWith('/api/generate')){generations++;const p=structuredClone(payload);p.key='score'+generations;return {ok:true,json:async()=>p};}
 if(url.endsWith('/api/hover-bank')){if(holdBank)return new Promise(resolve=>held.push(()=>resolve({ok:true,json:async()=>metadata})));return {ok:true,json:async()=>metadata};}
 if(url.includes('/api/hover-audio/'))return {ok:true,arrayBuffer:async()=>new ArrayBuffer(4)};
 if(url.endsWith('/api/preview'))return {ok:true,arrayBuffer:async()=>new ArrayBuffer(4)};
 if(url.endsWith('/api/audio/reference.wav'))return {ok:true,headers:{get(){return '.1';}},arrayBuffer:async()=>new ArrayBuffer(4)};
 throw new Error('unexpected audio request '+url);
};
const windows={},window={AudioContext,addEventListener:(k,v)=>windows[k]=v,PixelMusicStripSamples:{entries:[]}};
class Image{constructor(){this.width=192;this.height=120;}set src(v){queueMicrotask(()=>this.onload());}}
const context=vm.createContext({window,document:{getElementById:get,createElement:()=>new Element()},location:{protocol:'http:',origin:'http://127.0.0.1:4177',hash:'#parallel'},innerHeight:900,Image,fetch,AbortController,performance,setTimeout,clearTimeout,setInterval,clearInterval,requestAnimationFrame(){},cancelAnimationFrame(){},URL,Map,Set,console});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../dist/feature-music-app.js'),'utf8'),context);
const state=()=>window.PixelMusicFeaturesDemo.snapshot();
const until=async(fn)=>{for(let i=0;i<1000;i++){if(fn())return;await new Promise(r=>setTimeout(r,1));}throw new Error('state did not settle');};
const button=i=>({dataset:{index:String(i)},closest(){return this;}});
const move=(i,extra={})=>get('imageStage').handlers.pointermove({pointerType:'mouse',buttons:0,target:button(i),...extra});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 await until(()=>window.PixelMusicFeaturesDemo.payload()&&!state().busy);
 assert.equal(requests.length,2,'page opening must not request a hover bank');
 get('hoverToggle').checked=true;get('hoverToggle').handlers.change();await until(()=>held.length===1);
 move(0);move(1);move(3);assert.equal(plays.length,0);assert.equal(state().hoverRegion,3);
 held.shift()();await until(()=>plays.length===1);assert.equal(plays[0][1],2,'only the latest region plays after loading');
 const requestCount=requests.length;
 for(let i=0;i<20;i++)move(3);await wait(100);assert.equal(plays.length,1,'stationary region cannot retrigger');
 move(0);move(1);move(3);await until(()=>plays.length===2);assert.equal(plays.at(-1)[1],2);
 assert.equal(requests.length,requestCount,'pointer movement must never make audio requests');
 move(2);assert.equal(state().hoverAudible,false);assert.match(get('hoverState').textContent,/休止/);
 const before=plays.length;move(0);get('imageStage').handlers.pointerleave();await wait(100);
 assert.equal(plays.length,before,'leaving cancels the pending note');assert.equal(state().hoverRegion,null);
 move(1,{pointerType:'touch'});move(1,{buttons:1});assert.equal(plays.length,before);
 get('hoverToggle').checked=false;get('hoverToggle').handlers.change();move(0);await wait(100);assert.equal(plays.length,before);
 get('regions').handlers.click({target:button(0),detail:1});await until(()=>plays.length===before+1);
 assert.ok(requests.some(r=>r.url.endsWith('/api/preview')),'click audition stays available when hover is off');
 get('hoverToggle').checked=true;get('hoverToggle').handlers.change();await wait(5);
 assert.equal(requests.filter(r=>r.url.endsWith('/api/hover-bank')).length,1,'re-enabling reuses the prepared bank');
 get('imageStage').handlers.pointerdown({pointerType:'touch'});get('regions').handlers.click({target:button(1),detail:1,pointerType:'touch'});
 await until(()=>plays.length===before+2);assert.equal(requests.filter(r=>r.url.endsWith('/api/preview')).length,2,'touch click stays available with hover enabled');
 get('imageStage').handlers.pointerdown({pointerType:'mouse'});
 get('referenceMode').handlers.click();await until(()=>held.length===1);move(0);
 get('hoverToggle').checked=false;get('hoverToggle').handlers.change();held.shift()();await wait(100);
 assert.equal(plays.length,before+2,'cancelled preparation cannot play stale data');
 holdBank=false;get('hoverToggle').checked=true;get('hoverToggle').handlers.change();await until(()=>!state().hoverLoading);
 assert.equal(requests.filter(r=>r.url.endsWith('/api/hover-bank')).at(-1).body.variant,'reference');
 assert.equal(requests.filter(r=>r.url.endsWith('/api/hover-bank')).at(-1).body.profile,'original');
 move(1);await until(()=>plays.length===before+3);assert.equal(plays.at(-1)[1],1);
 assert.equal(state().time,0,'hover must not move full-song playback progress');
 get('imageStage').handlers.pointerleave();assert.equal(state().hoverAudible,false);assert.ok(stops.length>0);
 await get('play').handlers.click();assert.equal(state().playing,true);createdContext.currentTime=.425;
 move(0);assert.equal(state().playing,false);assert.ok(Math.abs(state().time-.4)<1e-8);
 await until(()=>state().hoverAudible);get('imageStage').handlers.pointerleave();assert.ok(Math.abs(state().time-.4)<1e-8);
 get('hoverToggle').checked=false;get('hoverToggle').handlers.change();windows.pagehide();
 const report={status:'passed',checkedOn:'2026-10-11',checks:['no audio prep on open','latest region only while loading and during fast sweeps',
 'same region does not repeat','no HTTP requests while moving','rests stop the previous sound','leave cancels notes immediately',
 'touch and drag do not trigger mouse audition','click mode and touch tap preserved','toggle reuses bank','cancelled mode preparation cannot play stale data',
 'reference uses original voice','full-song time unchanged','entering hover pauses full playback and preserves its position'],noteStarts:plays.length};
 fs.writeFileSync(path.join(__dirname,'hover-preview-client-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
})().catch(e=>{windows.pagehide?.();console.error(e);process.exitCode=1;});
