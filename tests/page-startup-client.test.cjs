const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
class Element{
 constructor(){this.handlers={};this.style={};this.classList={toggle(){}};this.attrs={};this.value='';this.width=192;this.height=120;this.parentElement={clientWidth:900,style:{}};}
 addEventListener(kind,fn){this.handlers[kind]=fn;}
 setAttribute(k,v){this.attrs[k]=v;}
 querySelectorAll(){return [];}
 querySelector(){return null;}
 getContext(){return new Proxy({},{get:()=>()=>{}});}
 toDataURL(){return 'data:image/png;base64,AQ==';}
}
const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
get('tone').value='GeneralUser GS';get('mappingStyle').value='Scientific';get('rowCount').value='4';get('rowMethod').value='reference';get('mixProfile').value='soft';get('backing').checked=true;
const region={id:'cell',col:0,row:0,start:0,end:1,midi:null,targetMidi:null,eventId:null,reason:'rest',rect:{x:0,y:0,width:1,height:1},features:{hue:0,saturation:0,brightness:0,contrast:0,texture:0,centroid:.5}};
const variant={events:[],regions:[region],cols:1,rows:4,duration:1,mainCount:0,layerCounts:{},rowMethod:'reference',voices:Array.from({length:4},(_,i)=>({id:'row-'+i,name:'row',instrumentName:'GS'})),mixProfiles:{soft:{voices:['a','b','c','d']},original:{}}};
const payload={key:'test',image:{src:'data:image/png;base64,AQ==',width:192,height:120},info:{bars:4,duration:1,tempo:88,key_name:'C',scale_name:'Major'},settings:{synth:'GeneralUser GS'},variants:{features:structuredClone(variant),reference:structuredClone(variant),parallel:structuredClone(variant)}};
let fail=true,delay=false,aborted=false,generationRequests=0;
const fetch=async(url,options={})=>{
 if(url.endsWith('/api/health')){if(fail)throw new TypeError('Failed to fetch');return {ok:true};}
 if(url.endsWith('/api/generate')){
  generationRequests++;
  if(delay)return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>{aborted=true;reject(new Error('aborted'));},{once:true}));
  return {ok:true,json:async()=>structuredClone(payload)};
 }
 throw new Error('opening the page unexpectedly requested audio');
};
const windows={};const window={addEventListener:(k,v)=>windows[k]=v,PixelMusicStripSamples:{entries:[]}};
class Image{constructor(){this.width=192;this.height=120;}set src(value){queueMicrotask(()=>this.onload());}}
const context=vm.createContext({window,document:{getElementById:get,createElement:()=>new Element()},location:{protocol:'http:',origin:'http://127.0.0.1:4177',hash:'#parallel'},innerHeight:900,Image,fetch,AbortController,performance,setTimeout,clearTimeout,setInterval,clearInterval,requestAnimationFrame(){},cancelAnimationFrame(){},URL,Map,Set,console});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../dist/feature-music-app.js'),'utf8'),context);
const state=()=>window.PixelMusicFeaturesDemo.snapshot();
const until=async(fn)=>{for(let i=0;i<1000;i++){if(fn())return;await new Promise(r=>setTimeout(r,1));}throw new Error('state did not settle');};
(async()=>{
 await until(()=>get('status').textContent==='生成失败');
 assert.equal(state().busy,false);assert.match(get('playText').textContent,/生成失败/);assert.equal(get('retry').disabled,false);
 assert.equal(get('parallelMode').disabled,false);assert.equal(get('featureMode').disabled,false);assert.ok(get('picture').width>0);assert.equal(get('loadState').hidden,true);
 fail=false;get('retry').handlers.click();await until(()=>window.PixelMusicFeaturesDemo.payload()&&!state().busy);
 assert.equal(get('play').disabled,false);assert.equal(get('status').textContent,'可以演奏');
 delay=true;get('retry').handlers.click();await until(()=>generationRequests===2);
 get('referenceMode').handlers.click();assert.equal(state().mode,'reference');assert.equal(get('loadState').hidden,false);
 get('cancelWork').handlers.click();await until(()=>aborted);assert.equal(state().busy,false);assert.equal(get('retry').disabled,false);assert.equal(get('loadState').hidden,true);
 delay=false;get('retry').handlers.click();await until(()=>window.PixelMusicFeaturesDemo.payload()&&!state().busy);
 assert.equal(state().mode,'reference');assert.equal(get('play').disabled,false);assert.equal(get('status').textContent,'可以演奏');
 windows.pagehide();
 const report={status:'passed',checkedOn:'2026-10-11',checks:['network failure restores a retry action and clears generation state','image preview is available before server response','retry recovers without reload','mode controls respond during delayed generation','cancel aborts pending generation','cancelled work cannot overwrite a later successful retry'],generationRequests};
 fs.writeFileSync(path.join(__dirname,'page-startup-client-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});
