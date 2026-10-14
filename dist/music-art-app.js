(function(){
  'use strict';
  const Core=window.MusicArtCore,$=id=>document.getElementById(id);
  const E=Object.fromEntries(['score','sourceHint','ribbons','geometry','palette','detail','arrange','artwork','artTitle','artEdition','paletteName','musicSignature','noteCount','voiceCount','tempo','pitchRange','play','playIcon','playText','restart','loop','clock','seek','playStatus','listeningOverlay','png','svg','saveScore','midi','json','toast','audioChoice','audioMode'].map(id=>[id,$(id)]));
  for(const id of ['exportResult','pngFile','exportPreview','classicalSource','midiSource','midiOriginal','midiCredit','midiLicense'])E[id]=$(id);
  const S={library:new Map(),score:null,model:null,style:'ribbons',layout:0,context:null,playing:false,loading:false,time:0,operation:0,importOperation:0,buffers:new Map(),exporting:false};
  const fmt=t=>`${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`;
  const pitch=m=>['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'][m%12]+(Math.floor(m/12)-1);
  let toastTimer;
  function toast(message){clearTimeout(toastTimer);E.toast.textContent=message;E.toast.hidden=false;toastTimer=setTimeout(()=>E.toast.hidden=true,5000);}
  function audioRef(ref){
    if(ref?.kind==='browser-score'&&['parallel','reference'].includes(ref.variant)&&['soft','original'].includes(ref.profile)&&['Simple','GeneralUser GS'].includes(ref.synth)&&ref.info?.duration>0&&ref.info.duration<=180&&Array.isArray(ref.events)&&ref.events.length<=5000&&Array.isArray(ref.voices)&&ref.voices.length<=4&&Array.isArray(ref.rows)&&ref.rows.every(r=>/^row-[0-3]$/.test(r))){
      Core.normalize({duration:ref.info.duration,events:ref.events,tempo:ref.info.tempo});
      return ref;
    }
    return null;
  }
  function readCurrent(raw){
    const data=JSON.parse(raw),score=Core.normalize(data);score.audioRef=audioRef(data.audioRef);score.legacyAudio=!!data.audioRef&&!score.audioRef;
    const source=Array.from(S.library.values()).find(s=>s.source&&s.source.id===data.source?.id&&s.source.sha256===data.source?.sha256)?.source;
    if(source)score.source=source;return score;
  }
  function options(){
    E.score.innerHTML='';
    const groups=[['当前与导入乐曲',([id])=>id==='current'||id.startsWith('upload-')],['古典名曲 · MIDI',([id,score])=>id!=='current'&&!id.startsWith('upload-')&&!!score.source],['原创演示样曲',([id,score])=>id!=='current'&&!id.startsWith('upload-')&&!score.source]];
    for(const [label,match] of groups){
      const entries=Array.from(S.library).filter(match);if(!entries.length)continue;
      const group=document.createElement('optgroup');group.label=label;
      for(const [id,score] of entries){const option=document.createElement('option');option.value=id;option.textContent=(id==='current'?'当前乐曲 · ':id.startsWith('upload-')?'导入 · ':'')+score.title;group.appendChild(option);}
      E.score.appendChild(group);
    }
  }
  Core.samples().forEach(score=>S.library.set(score.id,score));
  window.MusicArtClassics.samples().forEach(score=>S.library.set(score.id,score));
  let imported=false;
  try{const raw=localStorage.getItem(Core.STORAGE_KEY);if(raw){S.library.set('current',readCurrent(raw));imported=true;}}catch(error){toast('当前乐曲未能读取：'+error.message);}
  if(location.hash.startsWith('#score='))try{S.library.set('current',readCurrent(decodeURIComponent(location.hash.slice(7))));imported=true;}catch(error){toast('送入的乐曲未能读取：'+error.message);}
  options();
  function current(){
    if(!S.playing)return S.time;
    const elapsed=Math.max(0,S.offset+S.context.currentTime-S.started);
    return S.source?.loop?elapsed%S.audio.duration:Math.min(S.audio.duration,elapsed);
  }
  function stop(reset=false){
    S.time=reset?0:current();S.playing=false;S.loading=false;S.operation++;S.abort?.abort();S.abort=null;cancelAnimationFrame(S.frame);
    if(S.source){const source=S.source,gain=S.gain,now=S.context.currentTime;source.onended=null;gain.gain.cancelScheduledValues(now);gain.gain.setValueAtTime(gain.gain.value,now);gain.gain.linearRampToValueAtTime(0,now+.02);try{source.stop(now+.025);}catch(_){}setTimeout(()=>{source.disconnect();gain.disconnect();},40);S.source=S.gain=null;}
    paint();
  }
  function select(id){
    S.importOperation++;stop(true);S.score=S.library.get(id);if(!S.score)return;E.score.value=id;S.layout=0;S.audio=null;
    E.audioChoice.hidden=!S.score.audioRef;E.audioMode.value=S.score.audioRef?'original':'synth';
    const source=S.score.source;E.classicalSource.hidden=!source;
    if(source){
      E.sourceHint.textContent=source.work+' · '+source.instrumentation+' · '+(source.excerptSeconds?'开头 2 分 30 秒节选':'完整 MIDI 乐谱')+'；以本机合成音色试听。';
      E.midiSource.href=source.sourceUrl;E.midiOriginal.href='./classical-midi/'+source.file;E.midiOriginal.download=source.file;
      E.midiCredit.textContent='MIDI 编谱／维护：'+source.typesetter+' · Mutopia Project · ';E.midiLicense.textContent=source.license;E.midiLicense.href=source.licenseUrl;
    }else E.sourceHint.textContent=S.score.legacyAudio?'已读取旧版乐谱，当前采用乐谱合成试听；从图片演奏页重新送入即可恢复原组合音色。':S.score.audioRef?'使用送入时的音符与声部，试听音源对应当时的组合及静音选择。':id.startsWith('upload-')?'使用导入乐谱的音高、时序、力度与声部；以本机合成音色试听。':'三首原创演示样曲用不同的旋律与节奏作对照。';
    draw();
  }
  function draw(){
    if(!S.score)return;
    S.model=Core.scene(S.score,{style:S.style,palette:E.palette.value,detail:Number(E.detail.value),layout:S.layout});
    E.artwork.innerHTML=S.model.svg;E.artTitle.textContent=S.score.title;E.artEdition.textContent=(S.style==='ribbons'?'曲线色层':'几何色块')+' / 0'+(S.layout+1);
    if(S.svgUrl)URL.revokeObjectURL(S.svgUrl);S.svgUrl=URL.createObjectURL(new Blob([S.model.svg],{type:'image/svg+xml'}));E.svg.href=S.svgUrl;E.svg.download=filename(S.score.title,S.style,'svg');
    E.exportResult.hidden=true;
    E.ribbons.setAttribute('aria-pressed',S.style==='ribbons');E.geometry.setAttribute('aria-pressed',S.style==='geometry');
    E.paletteName.textContent=S.model.palette.name;E.musicSignature.textContent='音乐指纹 '+S.model.fingerprint;
    E.noteCount.textContent=S.score.events.length;E.voiceCount.textContent=S.model.stats.voices.length+(S.model.stats.voices.length>8?' · 绘出主要 8 部':'');
    E.tempo.textContent=Math.round(S.score.tempo)+' BPM';E.pitchRange.textContent=S.score.events.length?S.model.stats.range.map(pitch).join('–'):'休止';paint();
  }
  function paint(){
    if(!S.score)return;
    const t=current(),duration=S.audio?.duration??S.score.duration;
    E.seek.max=duration;E.seek.value=t;E.clock.textContent=fmt(t)+' / '+fmt(duration);
    E.playIcon.textContent=S.playing?'Ⅱ':S.loading?'×':'▶';E.playText.textContent=S.loading?'准备声音 · 点击取消':S.playing?'暂停聆听':t>0&&t<duration-.02?'继续聆听':'聆听这首乐曲';
    E.playStatus.textContent=S.loading?'首次准备声音，画作和设置仍可操作。':S.playing?(E.loop.checked?'循环聆听 · ':'正在聆听 · ')+'光点对应当前发声位置':t>=duration-.02?'乐曲结束，画作完整保留。':t>0?'已暂停，画作完整保留。':'画作已完成，点击播放可对照音乐。';
    const active=S.playing?S.model.marks.filter(m=>t>=m.start&&t<m.end).slice(0,24):[];
    E.listeningOverlay.innerHTML=active.map(m=>`<circle cx="${m.x}" cy="${m.y}" r="10" fill="${m.color}" fill-opacity=".18" stroke="${m.color}" stroke-width="1.5"/><circle cx="${m.x}" cy="${m.y}" r="3" fill="${m.color}"/>`).join('');
  }
  function animate(){if(!S.playing)return;paint();S.frame=requestAnimationFrame(animate);}
  async function context(){if(!S.context||S.context.state==='closed')S.context=new (window.AudioContext||window.webkitAudioContext)();if(S.context.state==='suspended')await S.context.resume();return S.context;}
  async function synthesize(score,operation){
    const Offline=window.OfflineAudioContext||window.webkitOfflineAudioContext;
    const offline=new Offline(2,Math.ceil(score.duration*44100),44100),compressor=offline.createDynamicsCompressor();
    compressor.threshold.value=-18;compressor.knee.value=22;compressor.ratio.value=5;compressor.attack.value=.008;compressor.release.value=.15;compressor.connect(offline.destination);
    const voices=Core.describe(score).voices.length,real=new Float32Array([0,0,0,0,0]),imag=new Float32Array([0,1,.24,.075,.025]),wave=offline.createPeriodicWave(real,imag);
    for(let i=0;i<score.events.length;i++){
      if(i%100===0){await new Promise(requestAnimationFrame);if(operation!==S.operation)throw new Error('声音准备已取消。');}
      const e=score.events[i],osc=offline.createOscillator(),gain=offline.createGain(),pan=offline.createStereoPanner();
      const strings=/strings|pad|midi-(4[0-9]|5[0-5])/.test(e.instrument),bell=/bell|marimba|轻铃|圆木琴|midi-(8|9|10|11|12|13|14|15)/.test(e.instrument);
      if(bell)osc.type='sine';else osc.setPeriodicWave(wave);
      osc.frequency.value=440*2**((e.midi-69)/12);pan.pan.value=e.pan;
      const start=e.start,end=Math.min(score.duration-.001,start+e.duration+.3),peak=.22*e.velocity/Math.sqrt(Math.max(1,voices))*(e.layer==='main'?1:.6),attack=strings?.06:.012;
      gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(peak,Math.min(start+attack,end));
      gain.gain.setTargetAtTime(peak*(strings?.72:bell?.12:.3),Math.min(start+attack,end),strings?.5:.23);
      gain.gain.setValueAtTime(peak*(strings?.65:.24),Math.max(start+attack,Math.min(start+e.duration,end-.025)));
      gain.gain.linearRampToValueAtTime(0,end);osc.connect(gain);gain.connect(pan);pan.connect(compressor);osc.start(start);osc.stop(end);
    }
    return offline.startRendering();
  }
  async function buffer(operation){
    const original=E.audioMode.value==='original'&&S.score.audioRef,key=Core.fingerprint(S.score)+':'+(original?JSON.stringify(S.score.audioRef):'synth');
    if(S.buffers.has(key))return S.buffers.get(key);
    let audio;
    if(original){
      if(S.score.audioRef.kind==='browser-score'){
        const controller=new AbortController();S.abort=controller;
        try{const response=await window.PixelMusicBrowser.request('/api/performance',{body:JSON.stringify(S.score.audioRef),signal:controller.signal});audio=await S.context.decodeAudioData(await response.arrayBuffer());}
        finally{if(S.abort===controller)S.abort=null;}
      }else throw new Error('请从图片演奏页重新送入当前乐曲。');
    }else audio=await synthesize(S.score,operation);
    if(operation!==S.operation)return null;S.buffers.set(key,audio);while(S.buffers.size>3)S.buffers.delete(S.buffers.keys().next().value);return audio;
  }
  async function play(){
    stop();const operation=++S.operation;S.loading=true;paint();
    try{
      await context();if(operation!==S.operation)return;
      const audio=await buffer(operation);if(operation!==S.operation||!audio)return;
      S.audio=audio;S.loading=false;const source=S.context.createBufferSource(),gain=S.context.createGain();source.buffer=audio;source.loop=E.loop.checked;source.loopStart=0;source.loopEnd=audio.duration;
      source.connect(gain);gain.connect(S.context.destination);S.source=source;S.gain=gain;S.offset=S.time>=audio.duration-.02?0:S.time;S.started=S.context.currentTime+.025;S.playing=true;
      gain.gain.setValueAtTime(0,S.started);gain.gain.linearRampToValueAtTime(1,S.started+.01);
      source.onended=()=>{if(operation!==S.operation||S.source!==source)return;S.time=audio.duration;S.playing=false;S.source=S.gain=null;source.disconnect();gain.disconnect();cancelAnimationFrame(S.frame);paint();};
      source.start(S.started,S.offset);animate();
    }catch(error){if(operation!==S.operation)return;S.loading=false;toast(error.name==='AbortError'?'声音准备超时，可以重试或切换音源。':error.message);paint();}
  }
  function filename(title,style,extension){return '图鸣-'+Array.from(title.replace(/[\\/:*?"<>|]/g,'-')).slice(0,48).join('')+'-'+(style==='ribbons'?'曲线色层':'几何色块')+'.'+extension;}
  function download(blob,extension,title=S.score.title,style=S.style){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename(title,style,extension);document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);}
  E.png.addEventListener('click',async()=>{
    if(S.exporting)return;S.exporting=true;E.png.disabled=true;const svg=S.model.svg,title=S.score.title,style=S.style;
    const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
    try{const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('图片导出失败，请重试。'));img.src=url;});const canvas=document.createElement('canvas');canvas.width=2400;canvas.height=1800;canvas.getContext('2d').drawImage(image,0,0,2400,1800);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('图片导出失败。');
      if(S.pngUrl)URL.revokeObjectURL(S.pngUrl);S.pngUrl=URL.createObjectURL(blob);E.pngFile.href=S.pngUrl;E.pngFile.download=filename(title,style,'png');E.exportPreview.src=S.pngUrl;E.exportPreview.alt=title+'的完整静态画作导出预览';E.exportResult.hidden=false;
      download(blob,'png',title,style);toast('PNG 已生成 · 可点击下方链接或右键预览图片保存。');
    }catch(error){toast(error.message);}finally{URL.revokeObjectURL(url);S.exporting=false;E.png.disabled=false;}
  });
  E.saveScore.addEventListener('click',()=>{
    const score=Core.normalize(S.score);if(S.score.audioRef?.kind==='browser-score')score.audioRef=S.score.audioRef;
    if(S.score.source)score.source=S.score.source;
    download(new Blob([JSON.stringify(score,null,2)],{type:'application/json'}),'json');
  });
  let uploadId=0;
  async function upload(file,kind){
    if(!file)return;if(file.size>2*1024*1024){toast('请导入小于 2MB 的乐谱文件。');return;}
    const operation=++S.importOperation;
    try{const raw=kind==='midi'?window.MusicArtMidi.parse(await file.arrayBuffer(),file.name.replace(/\.midi?$/i,'')):JSON.parse(await file.text());if(operation!==S.importOperation)return;const score=kind==='json'?readCurrent(JSON.stringify(raw)):Core.normalize(raw),id='upload-'+(++uploadId);S.library.set(id,score);options();select(id);toast('已根据导入的乐谱生成画作。');}catch(error){if(operation===S.importOperation)toast(error.message);}finally{E[kind].value='';}
  }
  E.midi.addEventListener('change',()=>upload(E.midi.files[0],'midi'));E.json.addEventListener('change',()=>upload(E.json.files[0],'json'));
  E.score.addEventListener('change',()=>select(E.score.value));
  function style(value){S.style=value;draw();if(innerWidth<=740)document.querySelector('.gallery').scrollIntoView({behavior:'smooth',block:'start'});}
  E.ribbons.addEventListener('click',()=>style('ribbons'));E.geometry.addEventListener('click',()=>style('geometry'));
  E.palette.addEventListener('change',draw);E.detail.addEventListener('change',draw);E.arrange.addEventListener('click',()=>{S.layout=(S.layout+1)%4;draw();});
  E.audioMode.addEventListener('change',()=>{const playing=S.playing;stop();S.audio=null;if(playing)play();});
  E.play.addEventListener('click',()=>S.playing||S.loading?stop():play());E.restart.addEventListener('click',()=>{stop(true);play();});
  E.loop.addEventListener('change',()=>{if(S.playing){const time=current();S.offset=time;S.started=S.context.currentTime;S.source.loop=E.loop.checked;}paint();});
  let resume=false;E.seek.addEventListener('pointerdown',()=>{resume=S.playing;stop();});E.seek.addEventListener('input',()=>{if(S.playing)resume=true;const value=Number(E.seek.value);stop();S.time=value;paint();});E.seek.addEventListener('change',()=>{if(resume)play();resume=false;});
  window.addEventListener('storage',event=>{if(event.key!==Core.STORAGE_KEY||!event.newValue)return;try{const value=readCurrent(event.newValue),chosen=E.score.value;S.library.set('current',value);options();E.score.value=chosen;if(chosen==='current'&&!S.playing&&!S.loading)select('current');else toast('收到新的当前乐曲，可以在选择框中打开。');}catch(error){toast(error.message);}});
  window.addEventListener('pagehide',()=>{stop();S.context?.close();if(S.svgUrl)URL.revokeObjectURL(S.svgUrl);if(S.pngUrl)URL.revokeObjectURL(S.pngUrl);});
  window.PixelMusicArtDemo={snapshot:()=>({style:S.style,score:E.score.value,fingerprint:S.model?.fingerprint,layout:S.layout,playing:S.playing,loading:S.loading,time:current(),notes:S.score?.events.length,voices:S.model?.stats.voices.length}),score:()=>Core.normalize(S.score)};
  select(imported&&(location.hash==='#current'||location.hash.startsWith('#score='))?'current':'slow');
})();
