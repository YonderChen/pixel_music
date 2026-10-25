'use strict';
const Core=require('../../lib/music-art-core'), Midi=require('../../lib/music-art-midi'), Classics=require('../../lib/classics'), Score=require('../../lib/score');
const Canvas=require('../../lib/canvas'), Svg=require('../../lib/svg-canvas'), Engine=require('../../lib/engine'), Files=require('../../lib/files'), Player=require('../../lib/player');
const Errors=require('../../lib/errors'), Playback=require('../../lib/music-art-playback');
const styles=['garden','landscape','tides','weave','constellation','ribbons','geometry','scroll'].map(value=>({name:Core.STYLES[value],value})),palettes=[{name:'自动配色',value:'auto'},...Object.keys(Core.palettes).map(value=>({name:Core.palettes[value].name,value}))];
const fmt=t=>Math.floor(t/60).toString().padStart(2,'0')+':'+Math.floor(t%60).toString().padStart(2,'0');
Page({
  data:{library:[],scoreIndex:0,styles,palettes,styleIndex:0,paletteIndex:0,detail:60,title:'',source:'',fingerprint:'',noteCount:0,voiceCount:0,families:[],time:0,duration:1,clock:'00:00 / 00:00',playing:false,loading:false,loop:false,hasOriginal:false,audioMode:0,audioModes:['原组合音色','乐谱合成试听'],hasMidi:false,exporting:false,status:'准备画作…',error:''},
  onLoad(){this.job=0;this.layout=0;this.time=0;this.clock=new Playback.Clock();this.scores=Classics.samples().concat(Core.samples());const current=getApp().globalData.currentScore;if(current)this.scores.unshift(Object.assign({id:'current'},current));this.setData({library:this.scores.map((s,i)=>({id:i,title:s.title}))});this.player=new Player(t=>{if(this.data.playing)this.clock.sync(t);},playing=>{
      clearInterval(this.timer);
      if(playing){this.clock.reset(this.playPosition,this.data.duration,this.data.loop);this.clock.start();}
      else this.clock.pause();
      this.setData({playing});this.onTime(this.clock.value());
      if(playing)this.timer=setInterval(()=>this.onTime(this.clock.value()),33);
    },error=>this.fail(error));},
  async onReady(){try{this.surface=await Canvas.get(this,'#art');this.rhythmSurface=await Canvas.get(this,'#rhythm');this.select(0);}catch(error){this.fail(error);}},
  onHide(){this.stop();if(this.data.loading)this.cancel();},
  onUnload(){this.job++;clearInterval(this.timer);this.player.destroy();Engine.cancel();},
  onShareAppMessage(){return {title:'图鸣 · 让乐曲成为画作',path:'/pages/art/index'};},
  fail(error){this.setData(Errors.describe(error));},
  stop(){clearInterval(this.timer);this.clock.pause();this.player.pause();this.setData({playing:false});this.onTime(this.clock.value());},
  cancel(){this.job++;Engine.cancel();this.stop();this.setData({loading:false,status:'已取消，可以重新播放'});},
  select(index){this.job++;Engine.cancel();this.stop();this.score=Score.read(this.scores[index]);this.layout=0;this.audioKey=null;this.time=0;this.clock.reset(0,this.score.duration,this.data.loop);const s=this.scores[index],source=s.source;this.score.source=source;
    this.setData({scoreIndex:index,title:this.score.title,time:0,loading:false,duration:this.score.duration,hasOriginal:!!this.score.audioRef,audioMode:0,hasMidi:!!source,
      source:source?source.work+' · '+source.instrumentation+' · '+source.typesetter+' · '+source.license:this.score.audioRef?'使用图片演奏送入时的音符、声部与原组合音色':'乐谱合成试听 · 本机生成',status:'画作已完成，点击播放可对照音乐',error:''});this.render();},
  changeScore(event){this.select(Number(event.detail.value));},
  changeVisual(event){this.setData({[event.currentTarget.dataset.key]:Number(event.detail.value)});this.render();},
  changeDetail(event){this.setData({detail:Number(event.detail.value)});this.render();},
  rearrange(){this.layout=(this.layout+1)%4;this.render();},
  changeAudio(event){this.stop();this.job++;if(this.data.loading)Engine.cancel();this.audioKey=null;this.setData({audioMode:Number(event.detail.value),loading:false});},
  changeLoop(event){const t=this.clock.value();this.setData({loop:event.detail.value});this.player.audio.loop=event.detail.value;this.clock.reset(t,this.data.duration,event.detail.value);if(this.data.playing)this.clock.start();},
  render(){if(!this.score||!this.surface)return;try{this.model=Core.scene(this.score,{style:styles[this.data.styleIndex].value,palette:palettes[this.data.paletteIndex].value,detail:this.data.detail/100,layout:this.layout});
    this.playback=Playback.prepare(this.model);
    this.base=wx.createOffscreenCanvas({type:'2d',width:1200,height:900});Svg.draw(this.base.getContext('2d'),this.model.svg,1200,900);
    this.setData({styleHint:Core.STYLE_INFO[this.model.style],fingerprint:this.model.fingerprint,noteCount:this.score.events.length,voiceCount:this.model.stats.voices.length,families:this.model.families});this.onTime(this.time);
    }catch(error){this.fail(error);}},
  draw(){
    if(!this.surface||!this.base||!this.model)return;
    const c=this.surface.context,w=this.surface.canvas.width,h=this.surface.canvas.height;
    c.clearRect(0,0,w,h);c.drawImage(this.base,0,0,w,h);
    Svg.draw(c,Playback.overlay(this.playback,this.time,this.data.playing),w,h);
    if(this.rhythmSurface){const s=this.rhythmSurface;s.context.clearRect(0,0,s.canvas.width,s.canvas.height);Svg.draw(s.context,Playback.rhythm(this.playback,this.time,this.data.playing),s.canvas.width,s.canvas.height,1200,180);}
  },
  onTime(time){this.time=time;if(!this.data.playing||!this.lastUi||Date.now()-this.lastUi>=100){this.lastUi=Date.now();this.setData({time,clock:fmt(time)+' / '+fmt(this.data.duration)});}this.draw();},
  async prepareAudio(){const job=this.job,original=this.data.hasOriginal&&this.data.audioMode===0,key=Core.fingerprint(this.score)+(original?':original':':synth');if(this.audioKey===key&&this.player.path)return;
    const result=await Engine.request(original?'/api/performance':'/art/audio',original?this.score.audioRef:{score:this.score});if(job!==this.job)throw new Error('计算已取消');if(!await this.player.load(result.bytes)||job!==this.job)throw new Error('计算已取消');this.audioKey=key;},
  async play(){if(this.data.loading){this.cancel();return;}if(this.data.playing){this.stop();return;}const job=++this.job;this.setData({loading:true,error:'',status:'首次准备声音…'});
    try{await this.prepareAudio();if(job!==this.job)return;this.setData({loading:false,status:'跟随声部光标；音符经过竖线时发声，长条表示延音'});this.playPosition=this.time>=this.data.duration-.02?0:this.time;this.player.play(this.playPosition,this.data.loop);}
    catch(error){if(job===this.job){this.setData({loading:false});this.fail(error);}}
  },
  seek(event){this.stop();this.clock.reset(Number(event.detail.value),this.data.duration,this.data.loop);this.onTime(this.clock.value());this.player.seek(this.time);},
  restart(){if(this.data.loading)this.cancel();this.stop();this.onTime(0);this.play();},
  backToImage(){if(getCurrentPages().length>1)wx.navigateBack();else wx.redirectTo({url:'/pages/studio/index'});},
  async importScore(){try{const result=await new Promise((resolve,reject)=>wx.chooseMessageFile({count:1,type:'file',extension:['mid','midi','json'],success:resolve,fail:reject})),file=result.tempFiles[0];if(file.size>2*1024*1024)throw new Error('请选择 2 MB 以内的 MIDI 或 JSON');const bytes=await Files.read(file.path);const raw=/\.midi?$/i.test(file.name)?Midi.parse(new Uint8Array(bytes),file.name.replace(/\.midi?$/i,'')):JSON.parse(this.utf8(new Uint8Array(bytes)));const score=Score.read(raw);this.scores.push(score);this.setData({library:this.scores.map((s,i)=>({id:i,title:s.title}))});this.select(this.scores.length-1);}catch(error){if(!/cancel/.test(error.errMsg||''))this.fail(error);}},
  utf8(bytes){let binary='';for(const b of bytes)binary+='%'+b.toString(16).padStart(2,'0');return decodeURIComponent(binary).replace(/^\uFEFF/,'');},
  async share(data,extension,name=this.score.title){const path=await Files.write(data,extension);try{await Files.share(path,'图鸣-'+name+'.'+extension);}finally{Files.remove(path);}},
  async exportSvg(){try{await this.share(this.model.svg,'svg');}catch(error){if(!/cancel/.test(error.errMsg||''))this.fail(error);}},
  async exportScore(){try{await this.share(JSON.stringify(this.score,null,2),'json');}catch(error){if(!/cancel/.test(error.errMsg||''))this.fail(error);}},
  async exportWav(){const job=++this.job;this.setData({loading:true,error:'',status:'正在准备 WAV…'});try{await this.prepareAudio();if(job!==this.job)return;this.setData({loading:false,status:'WAV 已生成'});await Files.share(this.player.path,'图鸣-'+this.score.title+'.wav');}catch(error){if(job===this.job){this.setData({loading:false});if(!/cancel/.test(error.errMsg||''))this.fail(error);}}},
  async exportMidi(){try{const source=this.score.source;if(source)await this.share(await Files.read('/classical-midi/'+source.file),'mid',source.work);}catch(error){if(!/cancel/.test(error.errMsg||''))this.fail(error);}},
  async savePng(){this.setData({exporting:true,error:''});try{const surface=await Canvas.get(this,'#export');surface.canvas.width=2400;surface.canvas.height=1800;Svg.draw(surface.context,this.model.svg,2400,1800);const filePath=await Canvas.exportPng(surface.canvas);await new Promise((resolve,reject)=>wx.saveImageToPhotosAlbum({filePath,success:resolve,fail:reject}));this.setData({status:'PNG 已保存到相册'});}catch(error){this.fail(error);}finally{this.setData({exporting:false});}}
});
