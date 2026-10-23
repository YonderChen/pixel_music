'use strict';
const Engine = require('../../lib/engine'), Files = require('../../lib/files'), Canvas = require('../../lib/canvas'), Player = require('../../lib/player');
const Catalog = require('../../lib/catalog'), samples = require('../../lib/samples'), Core = require('../../lib/music-art-core'), {decode} = require('../../lib/base64');
const Errors = require('../../lib/errors');
const colors = ['#ba5841','#547c75','#7c849e','#ac914f'];
const format = t => Math.floor(t/60).toString().padStart(2,'0') + ':' + Math.floor(t%60).toString().padStart(2,'0');
const note = n => n === null || n === undefined ? '休止' : ['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'][n%12] + (Math.floor(n/12)-1);
Page({
  data: {samples, sampleIndex:0, name:samples[0].name, credit:samples[0].credit, recipes:Catalog.recipes, segments:Catalog.segments, orders:Catalog.orders, contours:Catalog.contours,
    recipeIndex:0, segmentIndex:0, orderIndex:0, contourIndex:0, rowCounts:[2,3,4], rowIndex:2, contour:true, soft:true, backing:true, reference:false, loop:false, touchPreview:false,
    stageHeight:230, ready:false, busy:false, loading:false, playing:false, tracks:[], solo:-1, time:0, duration:1, tempo:'—', scale:'—', noteCount:0, clock:'00:00 / 00:00', status:'准备读取样图', selection:'轻触图片，试听对应区域。', error:''},
  onLoad() { this.job=0; this.scrollTop=0; this.path=samples[0].path; this.time=0; this.previewBuffers=new Map(); this.player=new Player(t=>this.onTime(t),playing=>this.setData({playing}),error=>this.fail(error)); },
  async onReady() { try { this.decodeSurface=await Canvas.get(this,'#decode'); this.decodeSurface.canvas.width=this.decodeSurface.canvas.height=512; await this.generate(); } catch(error) {this.fail(error);} },
  onHide() { this.stop(); this.stopPreview(); if(this.data.busy)this.cancel(); },
  onUnload() { this.job++; clearInterval(this.timer); this.player.destroy(); this.stopPreview(); if(this.previewContext)this.previewContext.close(); Engine.cancel(); },
  onPageScroll(event) { this.scrollTop=event.scrollTop; },
  onShareAppMessage() { return {title:'图鸣 · 让图片成为音乐',path:'/pages/studio/index'}; },
  fail(error) { this.setData(Errors.describe(error)); },
  mode() {return this.data.reference?'reference':'parallel';},
  profile() {return this.data.reference?'original':Catalog.recipes[this.data.recipeIndex].profile;},
  view() {return this.payload && this.payload.variants[this.mode()];},
  stop() {clearInterval(this.timer); this.player.pause(); this.setData({playing:false}); this.compareEnd=null;},
  cancel() {this.job++; Engine.cancel(); this.stop(); this.setData({busy:false,loading:false,status:'已取消，可以重试'});},
  async chooseImage() {
    try {const result=await new Promise((resolve,reject)=>wx.chooseMedia({count:1,mediaType:['image'],sourceType:['album','camera'],sizeType:['original'],success:resolve,fail:reject})); this.path=result.tempFiles[0].tempFilePath; this.setData({name:'我的图片',credit:'你的图片 · 本机处理，不上传'}); await this.generate();}
    catch(error) {if(!/cancel/.test(error.errMsg || ''))this.fail(error);}
  },
  changeSample(event) {const index=Number(event.detail.value), sample=samples[index]; this.path=sample.path; this.setData({sampleIndex:index,name:sample.name,credit:sample.credit}); return this.generate();},
  changeSetting(event) {this.setData({[event.currentTarget.dataset.key]:Number(event.detail.value)}); this.generate();},
  changeSwitch(event) {this.setData({[event.currentTarget.dataset.key]:event.detail.value}); this.generate();},
  changeMode(event) {this.stop(); this.setData({reference:event.detail.value,time:0}); this.time=0; this.audioKey=null; this.prepareView();},
  changeLoop(event) {this.setData({loop:event.detail.value}); this.player.audio.loop=event.detail.value;},
  changePreview(event) {this.stop(); this.stopPreview(); this.setData({touchPreview:event.detail.value});},
  async generate() {
    if(!this.decodeSurface || !this.path)return;
    this.stop(); this.stopPreview(); Engine.cancel(); const job=++this.job; this.audioKey=null; this.previewBuffers.clear();
    this.setData({busy:true,ready:false,loading:false,error:'',status:'正在读取图片与生成乐谱…'});
    try {
      const d=this.data, options={synth:'Simple',emotion:true,backing:d.backing,rowCount:d.rowCounts[d.rowIndex],rowMethod:Catalog.recipes[d.recipeIndex].method,
        segmentMethod:Catalog.segments[d.segmentIndex].value,segmentOrder:Catalog.orders[d.orderIndex].value,contourMusic:d.contour,contourStyle:Catalog.contours[d.contourIndex].value,segmentSoft:d.soft,pitchTransition:'scale',featureMethod:'features'};
      const info=await new Promise((resolve,reject)=>wx.getImageInfo({src:this.path,success:resolve,fail:reject}));
      if(job!==this.job)return;
      const data={key:'wx-'+job+'-'+Date.now(),options};
      // Avoid decoding multi-megapixel phone photos into many full-size arrays.
      // Smaller JPG/PNG files retain the shared decoder and its exact pixel rules.
      if(info.width*info.height>4000000)Object.assign(data,await Canvas.pixels(this.decodeSurface,this.path));
      else data.file=new Uint8Array(await Files.read(this.path));
      if(job!==this.job)return;
      let result=await Engine.request('/api/generate',data);
      if(result.needsPixels){delete data.file; Object.assign(data,await Canvas.pixels(this.decodeSurface,this.path)); result=await Engine.request('/api/generate',data);}
      if(job!==this.job)return;
      this.payload=result.data; this.time=0; this.preview=result.preview;
      const m=this.payload.mood;
      this.setData({busy:false,ready:true,time:0,solo:-1,tracks:this.payload.variants.parallel.voices.map((v,i)=>({id:v.id,name:v.name,enabled:true})),
        mood:m,valence:Math.round(m.valence*100),arousal:Math.round(m.arousal*100),moodReason:m.valenceReasons.concat(m.arousalReasons).join('、'),tempo:Math.round(this.payload.info.tempo),scale:this.payload.info.scale_name,
        duration:this.payload.info.duration,status:'可以演奏 · 轻触图片试听区域'});
      await this.prepareCanvas(); if(job!==this.job)return; this.prepareView();
    } catch(error) {if(job===this.job){this.setData({busy:false,loading:false});this.fail(error);}}
  },
  async prepareCanvas() {
    const info=wx.getWindowInfo?wx.getWindowInfo():wx.getSystemInfoSync(), width=info.windowWidth-58;
    await new Promise(resolve=>this.setData({stageHeight:Math.round(width*this.preview.height/this.preview.width)},resolve));
    this.surface=await Canvas.get(this,'#picture');this.surfaceScroll=this.scrollTop;
    this.base=wx.createOffscreenCanvas({type:'2d',width:this.preview.width,height:this.preview.height});
    const c=this.base.getContext('2d'),image=c.createImageData(this.preview.width,this.preview.height), rgb=new Uint8Array(this.preview.bytes);
    for(let i=0,j=0;i<rgb.length;i+=3,j+=4){image.data[j]=rgb[i];image.data[j+1]=rgb[i+1];image.data[j+2]=rgb[i+2];image.data[j+3]=255;} c.putImageData(image,0,0);
  },
  prepareView() {
    const v=this.view();if(!v)return;this.labels=null;
    if(v.segmentation){const raw=decode(v.segmentation.labels);this.labels=new Uint16Array(raw.length/2);for(let i=0;i<this.labels.length;i++)this.labels[i]=raw[2*i]|raw[2*i+1]<<8;}
    this.setData({noteCount:v.events.filter(e=>e.layer==='main').length,duration:v.duration,clock:format(this.time)+' / '+format(v.duration),selection:'轻触图片，试听对应区域。'}); this.draw();
  },
  mixData(mode=this.mode()) {return {key:this.payload.key,rows:this.data.tracks.map((v,i)=>v.enabled?'row-'+i:null).filter(Boolean),background:this.data.backing&&this.data.solo<0,profile:mode==='reference'?'original':Catalog.recipes[this.data.recipeIndex].profile};},
  async prepareAudio(mode=this.mode()) {
    const job=this.job;
    const data=this.mixData(mode), key=JSON.stringify([mode,data]);
    if(this.audioKey===key&&this.player.path)return this.metrics;
    const result=mode==='reference'?await Engine.request(this.payload.variants.reference.audioUrl):await Engine.request('/api/rowmix',data);
    if(job!==this.job)throw new Error('计算已取消');
    if(!await this.player.load(result.bytes)||job!==this.job)throw new Error('计算已取消');this.audioKey=key;this.metrics=result.metrics;return result.metrics;
  },
  async play() {
    if(this.data.loading){this.cancel();return;}if(this.data.playing){this.stop();return;}if(!this.payload)return;
    this.stopPreview();const job=++this.job;this.setData({busy:true,loading:true,error:'',status:'正在生成声音…'});
    try{await this.prepareAudio();if(job!==this.job)return;this.setData({busy:false,loading:false,status:'正在演奏'});this.begin(this.time>=this.data.duration-.02?0:this.time);}
    catch(error){if(job===this.job){this.setData({busy:false,loading:false});this.fail(error);}}
  },
  begin(time,loop=this.data.loop){this.player.audio.volume=1;this.player.play(time,loop);clearInterval(this.timer);this.timer=setInterval(()=>{if(this.data.playing){this.onTime(this.player.audio.currentTime||0);}},80);},
  onTime(time){if(this.compareEnd&&time>=this.compareEnd){const end=this.compareEnd;this.stop();time=end;}this.time=time;this.setData({time,clock:format(time)+' / '+format(this.data.duration)});this.draw();},
  seek(event){this.stop();this.time=Number(event.detail.value);this.player.seek(this.time);this.onTime(this.time);},
  restart(){this.stop();this.time=0;this.setData({time:0});this.play();},
  toggleTrack(event){this.stop();const i=Number(event.currentTarget.dataset.index),tracks=this.data.tracks.map((v,j)=>Object.assign({},v,{enabled:j===i?!v.enabled:v.enabled}));this.setData({tracks,solo:-1});this.audioKey=null;},
  soloTrack(event){this.stop();const i=Number(event.currentTarget.dataset.index),solo=this.data.solo===i?-1:i;this.setData({solo,tracks:this.data.tracks.map((v,j)=>Object.assign({},v,{enabled:solo<0||j===i}))});this.audioKey=null;},
  async compare(event){
    this.stop();const mode=event.currentTarget.dataset.mode,job=++this.job;this.setData({busy:true,loading:true,error:'',status:'准备 12 秒响度匹配对照…'});
    try{const other=mode==='parallel'?'reference':'parallel',a=await this.prepareAudio(other),b=await this.prepareAudio(mode);if(job!==this.job)return;
      this.setData({reference:mode==='reference',busy:false,loading:false,status:'12 秒对照 · 已匹配响度'});this.prepareView();this.compareEnd=Math.min(12,this.data.duration);this.begin(0,false);
      const target=Math.min(a.first12Rms,b.first12Rms);this.player.audio.volume=target>1e-7?Math.min(1,target/b.first12Rms):1;
    }catch(error){if(job===this.job){this.setData({busy:false,loading:false});this.fail(error);}}
  },
  async exportWav(){const job=++this.job;this.stop();this.setData({busy:true,loading:true,error:'',status:'正在准备 WAV…'});try{await this.prepareAudio();if(job!==this.job)return;this.setData({busy:false,loading:false,status:'WAV 已生成'});await Files.share(this.player.path,'图鸣-'+this.data.name+'.wav');}catch(error){if(job===this.job){this.setData({busy:false,loading:false});if(!/cancel/.test(error.errMsg||''))this.fail(error);}}},
  openArt(){
    if(this.payload&&this.data.ready){const score=Core.fromPerformance(this.payload,{mode:this.mode(),profile:this.profile(),rows:this.data.tracks.map(t=>t.enabled),backing:this.data.backing&&this.data.solo<0,title:this.data.name});getApp().globalData.currentScore=score;}
    this.stop();wx.navigateTo({url:'/pages/art/index'});
  },
  draw(){
    if(!this.surface||!this.base||!this.view())return;const c=this.surface.context,w=this.surface.canvas.width,h=this.surface.canvas.height,v=this.view(),t=this.time;
    c.clearRect(0,0,w,h);c.drawImage(this.base,0,0,w,h);const active=v.events.filter(e=>e.layer==='main'&&t>=e.start&&t<e.start+e.duration&&(this.data.reference||this.data.tracks[e.row]&&this.data.tracks[e.row].enabled)),ids=new Set(active.flatMap(e=>(e.sources||[]).map(s=>s.regionId)));
    const seg=v.segmentation;
    if(seg&&seg.outlines){seg.outlines.forEach((rings,i)=>{const r=v.regions[i],lit=ids.has(r.id)||i===this.selected;c.beginPath();for(const ring of rings){for(let k=0;k<ring.p.length;k+=2){const x=ring.p[k]/(2*seg.width)*w,y=ring.p[k+1]/(2*seg.height)*h;if(!k)c.moveTo(x,y);else c.lineTo(x,y);}c.closePath();}if(lit){c.fillStyle=colors[r.row%4];c.globalAlpha=.3;c.fill();c.globalAlpha=1;}c.strokeStyle=lit?colors[r.row%4]:'rgba(255,255,255,.45)';c.lineWidth=lit?3:1;c.stroke();});}
    else if(!seg){v.regions.forEach((r,i)=>{if(ids.has(r.id)||i===this.selected){c.fillStyle='rgba(186,88,65,.35)';c.fillRect(r.rect.x*w,r.rect.y*h,r.rect.width*w,r.rect.height*h);}});}
    else if(this.labels){const overlay=wx.createOffscreenCanvas({type:'2d',width:seg.width,height:seg.height}),o=overlay.getContext('2d'),image=o.createImageData(seg.width,seg.height);for(let y=0;y<seg.height;y++)for(let x=0;x<seg.width;x++){const p=y*seg.width+x,label=this.labels[p],edge=x+1<seg.width&&this.labels[p+1]!==label||y+1<seg.height&&this.labels[p+seg.width]!==label,lit=ids.has(v.regions[label].id)||label===this.selected;if(edge||lit){image.data[p*4]=lit?186:255;image.data[p*4+1]=lit?88:255;image.data[p*4+2]=lit?65:255;image.data[p*4+3]=edge?170:75;}}o.putImageData(image,0,0);c.drawImage(overlay,0,0,w,h);}
    for(const e of active)if(e.path){c.beginPath();e.path.forEach((p,i)=>i?c.lineTo(p[0]*w,p[1]*h):c.moveTo(p[0]*w,p[1]*h));c.strokeStyle=e.color||'#e8ffbf';c.lineWidth=4;c.stroke();}
    if(this.data.playing||t>0){const x=Math.min(1,t/(seg&&seg.sweepSeconds||v.duration))*w;c.strokeStyle='#fff9df';c.lineWidth=2*this.surface.ratio;c.beginPath();c.moveTo(x,0);c.lineTo(x,h);c.stroke();}
  },
  regionAt(event){if(!this.surface||!this.view())return -1;const p=event.touches[0]||event.changedTouches[0];if(!p)return -1;const x=(p.x!==undefined?p.x:p.clientX-this.surface.left)/this.surface.width,y=(p.y!==undefined?p.y:p.clientY+(this.scrollTop-this.surfaceScroll)-this.surface.top)/this.surface.height;if(x<0||y<0||x>=1||y>=1)return -1;const v=this.view(),seg=v.segmentation;return seg?this.labels[Math.floor(y*seg.height)*seg.width+Math.floor(x*seg.width)]:v.regions.findIndex(r=>x>=r.rect.x&&x<r.rect.x+r.rect.width&&y>=r.rect.y&&y<r.rect.y+r.rect.height);},
  touchStart(event){this.stop();this.previewRegion(this.regionAt(event));},
  touchMove(event){if(this.data.touchPreview&&Date.now()-(this.lastTouch||0)>90){this.lastTouch=Date.now();this.previewRegion(this.regionAt(event));}},
  touchEnd(){this.lastRegion=null;if(this.data.touchPreview)this.stopPreview();},
  stopPreview(){this.previewJob=(this.previewJob||0)+1;if(this.previewSource){try{this.previewSource.stop();}catch(_){}this.previewSource.disconnect();this.previewSource=null;}},
  async previewRegion(index){
    if(index<0||!this.payload||this.data.busy||index===this.lastRegion)return;this.lastRegion=index;this.selected=index;this.draw();const r=this.view().regions[index];this.setData({selection:note(r.midi)+' · '+(r.reason||'')});if(!r.eventId)return;
    this.stopPreview();const job=this.previewJob,key=this.mode()+':'+this.profile()+':'+r.eventId;
    try{if(!this.previewContext)this.previewContext=wx.createWebAudioContext();if(this.previewContext.state==='suspended')await this.previewContext.resume();let buffer=this.previewBuffers.get(key);
      if(!buffer){const result=await Engine.request('/api/preview',{key:this.payload.key,variant:this.mode(),profile:this.profile(),eventId:r.eventId});buffer=await new Promise((resolve,reject)=>this.previewContext.decodeAudioData(result.bytes,resolve,reject));if(job!==this.previewJob)return;this.previewBuffers.set(key,buffer);if(this.previewBuffers.size>8)this.previewBuffers.delete(this.previewBuffers.keys().next().value);}
      if(job!==this.previewJob)return;const source=this.previewContext.createBufferSource();source.buffer=buffer;source.connect(this.previewContext.destination);this.previewSource=source;source.start();
    }catch(error){if(job===this.previewJob)this.fail(error);}
  }
});
