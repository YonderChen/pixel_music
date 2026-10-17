const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),Core=require('../dist/music-art-core.js'),Classics=require('../dist/music-art-classics.js');
const downloads=[],downloadUrls=[],nodes=new Map(),windows={},requests=[],sources=[],renders=[];let createdContext,holdAudio=false,holdSynth=false,holdImage=false;const pendingAudio=[],pendingSynth=[],pendingImages=[];
class Element{
 constructor(){this.handlers={};this.value='';this.checked=false;this.style={};this.attrs={};this.children=[];this.innerHTML='';this.disabled=false;}
 addEventListener(k,fn){this.handlers[k]=fn;}setAttribute(k,v){this.attrs[k]=v;}appendChild(child){this.children.push(child);}remove(){}scrollIntoView(){}
 click(){if(this.download){downloads.push(this.download);downloadUrls.push(this.href);}}getContext(){return {drawImage(){}};}toBlob(fn){queueMicrotask(()=>fn(new Blob(['png'])));}
}
const get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};get('palette').value='auto';get('detail').value='.6';
const param=()=>({value:1,setValueAtTime(){},linearRampToValueAtTime(){},cancelScheduledValues(){},setTargetAtTime(){}});
class AudioContext{
 constructor(){createdContext=this;this.state='running';this.currentTime=0;this.destination={};}resume(){return Promise.resolve();}close(){this.state='closed';}
 decodeAudioData(){return Promise.resolve({duration:19.8});}
 createBufferSource(){const source={loop:false,connect(){},disconnect(){},start(...args){this.args=args;},stop(){this.stopped=true;}};sources.push(source);return source;}
 createGain(){return {connect(){},disconnect(){},gain:param()};}
}
class OfflineAudioContext{
 constructor(ch,frames,rate){this.duration=frames/rate;this.destination={};this.notes=[];this.suspended=[];this.suspendTimes=[];renders.push(this);}
 createDynamicsCompressor(){return {connect(){},threshold:{},knee:{},ratio:{},attack:{},release:{}};}createPeriodicWave(){return {};}
 createOscillator(){const n={connect(){},frequency:{},setPeriodicWave(){},start(t){this.startAt=t;},stop(t){this.stopAt=t;}};this.notes.push(n);return n;}
 createGain(){return {connect(){},gain:param()};}createStereoPanner(){return {connect(){},pan:{}};}
 suspend(t){this.suspendTimes.push(t);return {then:fn=>this.suspended.push(fn)};}resume(){}
 startRendering(){this.suspended.splice(0).forEach(fn=>fn());const result={duration:this.duration};return holdSynth?new Promise(resolve=>pendingSynth.push(()=>resolve(result))):Promise.resolve(result);}
}
class Image{set src(v){if(holdImage)pendingImages.push(()=>this.onload());else queueMicrotask(()=>this.onload());}}
const audioRef={kind:'browser-score',variant:'parallel',profile:'soft',synth:'Simple',info:{duration:19,tempo:88},events:Core.samples()[2].events,rows:['row-0'],voices:[{id:'row-0'}]};
const imported={...Core.samples()[2],audioRef};
const fetch=async(url,options)=>{requests.push(url);if(holdAudio)return new Promise((resolve,reject)=>{pendingAudio.push(()=>resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)}));options.signal.addEventListener('abort',()=>reject(new Error('cancelled')));});return {ok:true,arrayBuffer:async()=>new ArrayBuffer(4)};};
const window={MusicArtCore:Core,MusicArtClassics:Classics,PixelMusicBrowser:{request:fetch},AudioContext,OfflineAudioContext,addEventListener:(k,fn)=>windows[k]=fn};
const context=vm.createContext({window,document:{getElementById:get,querySelector:()=>new Element(),createElement:()=>new Element(),body:new Element()},localStorage:{getItem:()=>JSON.stringify(imported)},location:{protocol:'file:',hash:'#current'},innerWidth:1000,Image,fetch,AbortController,Float32Array,Blob,URL,performance,setTimeout,clearTimeout,requestAnimationFrame:fn=>setTimeout(fn,1),cancelAnimationFrame:clearTimeout,console});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../dist/music-art-app.js'),'utf8'),context);
const state=()=>window.PixelMusicArtDemo.snapshot(),click=id=>get(id).handlers.click();
const until=async(fn)=>{for(let i=0;i<2000;i++){if(fn())return;await new Promise(r=>setTimeout(r,1));}throw new Error('state did not settle');};
const choose=id=>{get('score').value=id;get('score').handlers.change();};
(async()=>{
 assert.equal(state().score,'current');assert.equal(state().playing,false);assert.equal(requests.length,0,'no audio work on open');assert.ok(get('artwork').innerHTML.startsWith('<svg'));
 assert.deepEqual(get('score').children.map(g=>[g.label,g.children.length]),[['当前与导入乐曲',1],['古典名曲 · MIDI',6],['原创演示样曲',3]]);
 await click('play');assert.equal(state().playing,true);assert.equal(requests.length,1);
 click('saveScore');const saved=await(await globalThis.fetch(downloadUrls.at(-1))).json();assert.equal(saved.audioRef.kind,'browser-score','saved JSON keeps portable original audio settings');
 createdContext.currentTime=.8;const source=sources.at(-1),fingerprint=state().fingerprint;click('geometry');assert.equal(state().playing,true);assert.equal(sources.at(-1),source);assert.equal(state().fingerprint,fingerprint);
 get('loop').checked=true;get('loop').handlers.change();assert.equal(source.loop,true);
 createdContext.currentTime+=source.buffer.duration+1;assert.ok(state().time<2);
 const beforeOff=state().time;get('loop').checked=false;get('loop').handlers.change();assert.equal(source.loop,false);assert.ok(Math.abs(state().time-beforeOff)<1e-8,'disabling after wrap retains current position');
 click('play');const paused=state().time;assert.equal(state().playing,false);await click('play');assert.equal(sources.at(-1).args[1],paused);assert.equal(requests.length,1,'resume reuses decoded original');
 get('seek').handlers.pointerdown();get('seek').value='3';get('seek').handlers.input();get('seek').handlers.change();await until(()=>state().playing);assert.equal(sources.at(-1).args[1],3);
 click('play');choose('slow');holdSynth=true;const preparing=click('play');await until(()=>pendingSynth.length===1);choose('fast');pendingSynth.shift()();await preparing;assert.equal(state().playing,false,'late synthesis cannot play an old score');assert.equal(state().score,'fast');
 holdSynth=false;await click('play');assert.equal(state().playing,true);assert.equal(renders.at(-1).notes.length,96);click('play');
 click('scroll');assert.equal(get('artEdition').textContent,'扫描长卷');assert.equal(get('legend').hidden,false);await click('play');createdContext.currentTime+=1;await new Promise(r=>setTimeout(r,5));
 assert.match(get('listeningOverlay').innerHTML,/<rect[^>]*fill-opacity=".62"/,'unplayed part of the scroll is veiled while playing');assert.match(get('listeningOverlay').innerHTML,/<path d="M[\d.]+ 92V818"/,'scan line is drawn');
 click('play');assert.doesNotMatch(get('listeningOverlay').innerHTML,/<rect/,'pausing reveals the whole painting');click('geometry');assert.equal(get('legend').hidden,true);
 for(const score of Classics.samples()){
   choose(score.id);assert.equal(state().notes,score.events.length);assert.equal(get('classicalSource').hidden,false);assert.equal(get('midiSource').href,score.source.sourceUrl);assert.equal(get('midiOriginal').download,score.source.file);
   assert.equal(get('sourceHint').textContent.includes('节选'),!!score.source.excerptSeconds);
   await click('play');assert.equal(state().playing,true);assert.equal(renders.at(-1).notes.length,score.events.length);assert.ok(renders.at(-1).suspendTimes.length>10&&renders.at(-1).suspendTimes.every(t=>t<score.duration),'notes join the render window by window');click('play');
 }
 choose('classical-pachelbel-canon-in-d');click('saveScore');const classicalSaved=await(await globalThis.fetch(downloadUrls.at(-1))).json();assert.equal(classicalSaved.source.license,'CC BY 4.0');
 get('json').files=[{size:100,text:async()=>JSON.stringify({...classicalSaved,source:{...classicalSaved.source,sourceUrl:'javascript:alert(1)'}})}];await get('json').handlers.change();
 assert.equal(get('midiSource').href,classicalSaved.source.sourceUrl,'import retains attribution using only trusted catalog URLs');
 click('saveScore');assert.equal((await(await globalThis.fetch(downloadUrls.at(-1))).json()).source.typesetter,'Michael Fischer v. Mollard');
 choose('fast');assert.equal(get('classicalSource').hidden,true);
 const originalTitle=get('artTitle').textContent;holdImage=true;const exporting=click('png');choose('woven');click('ribbons');pendingImages.shift()();await exporting;assert.ok(downloads.at(-1).includes(originalTitle+'-几何色块.png'),'export filename preserves the work clicked before async rasterization');holdImage=false;
 let finishFile;get('json').files=[{size:20,text:()=>new Promise(resolve=>{finishFile=resolve;})}];const uploading=get('json').handlers.change();choose('slow');finishFile(JSON.stringify(Core.samples()[1]));await uploading;assert.equal(state().score,'slow','late file read cannot override a later choice');
 get('json').files=[{size:20,text:async()=>JSON.stringify(Core.samples()[1])}];await get('json').handlers.change();assert.equal(state().notes,96);assert.match(state().score,/upload-/);
 choose('current');holdAudio=true;
 // Use a fresh source key to test cancellation before decode (clear the existing cache via a new incoming score).
 windows.storage({key:Core.STORAGE_KEY,newValue:JSON.stringify({...imported,audioRef:{...audioRef,profile:'original'}})});
 const waiting=click('play');await until(()=>pendingAudio.length===1);click('play');pendingAudio.shift()();await waiting;assert.equal(state().playing,false);assert.equal(state().loading,false);
 holdAudio=false;await click('play');const exiting=sources.at(-1),staleEnd=exiting.onended;windows.pagehide();staleEnd();assert.equal(state().playing,false);assert.equal(createdContext.state,'closed');
 const report={status:'passed',checkedOn:'2026-10-17',checks:['page opens with a complete image and no audio preparation','original sound plays and resumes from cached audio','style changes preserve music, timing and source','loop wrap and disabling loop retain current position','seek resumes at the selected time','late synthesis and file reads cannot overwrite a later selection','samples synthesize their actual score notes','six classical MIDI candidates are grouped, drawn and synthesized with source links and excerpt labels','classical JSON exports retain attribution and imports restore only trusted catalog URLs','PNG filename stays attached to the clicked score and style','JSON import works and original preparation can be cancelled','page exit stops sound and ignores stale end callbacks','scan scroll shows a scan line and veils the unplayed part while playing','long scores build synth notes window by window']};
 fs.writeFileSync(path.join(__dirname,'music-art-client-report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
})().catch(e=>{windows.pagehide?.();console.error(e);process.exitCode=1;});
