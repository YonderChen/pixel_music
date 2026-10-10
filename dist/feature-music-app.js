(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const ids = ['workName','mappingLabel','picture','regions','centroids','scan','scanNote','dropHint','timeline','eventCount','pitchTop','pitchBottom','middleTime','endTime','status','featureMode','referenceMode','key','tempo','noteCount','duration','mappingHint','tone','mappingStyle','backing','backingStatus','play','playText','playIcon','currentNote','seek','clock','restart','abFeatures','abReference','comparisonHint','file','export','sample','credit','selectedTitle','selectedReason','selectedLocation','selectedFeatures','selectedPitch','selectedTime','toast','imageStage','connection'];
  const E = Object.fromEntries(ids.map(id => [id,$(id)]));
  const API = location.protocol === 'file:' ? 'http://127.0.0.1:4176' : location.origin;
  const S = { mode:'features', payload:null, image:null, playing:false, busy:false, time:0, clip:null, operation:0, loadOperation:0, buffers:new Map(), selected:0 };
  const notes = ['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
  const note = midi => midi === null || midi === undefined ? '休止' : notes[(midi%12+12)%12] + (Math.floor(midi/12)-1);
  const fmt = t => `${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`;
  const view = () => S.payload?.variants[S.mode];
  let toastTimer;
  function toast(text) { clearTimeout(toastTimer); E.toast.textContent=text; E.toast.hidden=false; toastTimer=setTimeout(()=>E.toast.hidden=true,4500); }
  function current() { return S.playing ? Math.min(S.limit,Math.max(S.offset,S.offset+S.context.currentTime-S.started)) : S.time; }
  function stop(reset=false) {
    S.time=reset?0:current(); S.playing=false; S.operation++; cancelAnimationFrame(S.animation);
    if(S.source) {
      const source=S.source, output=S.output, now=S.context.currentTime;
      source.onended=null; output.gain.cancelScheduledValues(now); output.gain.setValueAtTime(output.gain.value,now); output.gain.linearRampToValueAtTime(0,now+.02);
      try{source.stop(now+.025);}catch(_){}
      setTimeout(()=>{source.disconnect();output.disconnect();},40); S.source=S.output=null;
    }
    paint();
  }
  function controls() {
    for(const el of [E.play,E.restart,E.abFeatures,E.abReference,E.seek,E.export,E.featureMode,E.referenceMode]) el.disabled=!S.payload||S.busy;
  }
  async function ctx() {
    if(!S.context||S.context.state==='closed') S.context=new (window.AudioContext||window.webkitAudioContext)();
    if(S.context.state==='suspended') await S.context.resume(); return S.context;
  }
  async function buffer(mode) {
    const key=S.payload.key+':'+mode;
    if(!S.buffers.has(key)) {
      const url=API+S.payload.variants[mode].audioUrl;
      const pending=fetch(url).then(r=>{if(!r.ok)throw new Error('音频缓存已失效，请重新选择图片生成。');return r.arrayBuffer();}).then(bytes=>S.context.decodeAudioData(bytes));
      S.buffers.set(key,pending); pending.catch(()=>S.buffers.delete(key));
    }
    return S.buffers.get(key);
  }
  function startBuffer(audio,from,end,gain,operation,preview=false) {
    const context=S.context, source=context.createBufferSource(), output=context.createGain(); source.buffer=audio;
    source.connect(output); output.connect(context.destination);
    const start=context.currentTime+.025, length=Math.min(end-from,audio.duration-from), level=gain, fade=Math.min(.003,length/3);
    output.gain.setValueAtTime(0,start); output.gain.linearRampToValueAtTime(level,start+fade);
    output.gain.setValueAtTime(level,start+Math.max(fade,length-.03)); output.gain.linearRampToValueAtTime(0,start+length);
    S.source=source; S.output=output; S.offset=from; S.started=start; S.limit=end;
    S.playing=!preview;
    source.onended=()=>{if(S.operation!==operation||S.source!==source)return;S.source=S.output=null;source.disconnect();output.disconnect();if(!preview){S.time=end;S.playing=false;paint();}};
    source.start(start,from,length); if(!preview)animate();
  }
  async function play(compare=false) {
    stop(); const operation=++S.operation; if(compare)S.clip=12;
    const end=S.clip??view().duration, from=compare||S.time>=end-.02?0:S.time;
    try {
      await ctx(); const audio=await buffer(S.mode); if(operation!==S.operation)return;
      let gain=1;
      if(S.clip) {
        const a=S.payload.variants.features.metrics.first12Rms, b=S.payload.variants.reference.metrics.first12Rms, target=Math.min(a,b);
        gain=target>1e-7?target/(S.mode==='features'?a:b):1;
        E.comparisonHint.textContent=target>1e-7?'同图、同配器，前 12 秒响度匹配。':'一版为静音，保留实际声音供比较。';
        S.comparison={featuresRms:a,referenceRms:b,gain,matched:target>1e-7};
      }
      startBuffer(audio,from,end,gain,operation);
    }catch(error){toast(error.message);paint();}
  }
  function paint() {
    if(!S.payload){controls();return;}
    const value=view(), time=current(), end=S.clip??value.duration;
    const active=value.events.filter(e=>e.layer==='main'&&time>=e.start&&time<e.start+e.duration);
    const show=S.playing||time>0;
    const activeIds=new Set(show?active.flatMap(e=>e.sources.map(ref=>ref.regionId)):[]);
    E.regions.querySelectorAll('button').forEach(button=>button.classList.toggle('active',activeIds.has(button.dataset.region)));
    E.timeline.querySelectorAll('.note').forEach(rect=>rect.classList.toggle('active',show&&active.some(e=>e.id===rect.dataset.event)));
    const playhead=E.timeline.querySelector('.playhead');
    if(playhead){const x=Math.min(640,time/S.payload.info.duration*640);playhead.setAttribute('x1',x);playhead.setAttribute('x2',x);}
    const region=value.regions.find(r=>time>=r.start&&time<r.end)||value.regions.at(-1);
    const x=region?region.rect.x+region.rect.width*.5:1;
    E.scan.style.left=`${Math.min(99.7,x*100)}%`;E.scan.classList.toggle('end',x>.9);E.scan.hidden=!show;
    E.scanNote.textContent=time>=S.payload.info.duration?'余韵':active.length?active.map(e=>note(e.midi)).join(' / '):'留白';
    E.currentNote.textContent=show?E.scanNote.textContent:'—';
    E.seek.max=end;E.seek.value=time;E.clock.textContent=`${fmt(time)} / ${fmt(end)}`;
    E.playIcon.textContent=S.playing?'Ⅱ':'▶';E.playText.textContent=S.playing?'暂停演奏':time>=end-.02?'再次演奏':time>0?'继续演奏':'开始演奏';
    E.status.textContent=S.busy?'生成中':S.playing?(time>=S.payload.info.duration?'渐渐收尾':'正在演奏'):time>=end-.02?(S.clip?'对照结束':'演奏结束'):time>0?'已暂停':'可以演奏';
    E.status.classList.toggle('playing',S.playing);
    const layers=Object.keys(value.layerCounts).filter(k=>k!=='main');
    E.backingStatus.textContent=E.backing.checked?`参考项目编曲 · ${layers.map(k=>({bass:'低音',pad:'铺底',chord:'和弦',texture:'纹理',solo:'独奏'}[k]||k)).join(' / ')}`:'仅听主旋律';
    controls();
  }
  function animate(){if(!S.playing)return;paint();S.animation=requestAnimationFrame(animate);}
  function geometry() {
    if(!S.payload)return;
    const ratio=S.payload.image.width/S.payload.image.height;
    E.imageStage.style.aspectRatio=ratio;
    E.imageStage.style.maxWidth=`${Math.min(E.imageStage.parentElement.clientWidth-52,Math.min(540,innerHeight*.7)*ratio)}px`;
  }
  function select(index) {
    if(!S.payload)return;S.selected=index;
    const region=view().regions[index]; if(!region)return;
    E.regions.querySelectorAll('button').forEach(b=>b.classList.toggle('selected',Number(b.dataset.index)===index));
    E.selectedTitle.textContent=`列 ${region.col+1} · 区域 ${region.row+1} · ${note(region.midi)}`;
    E.selectedReason.textContent=region.reason;
    E.selectedLocation.textContent=`图片横向 ${(region.rect.x*100).toFixed(1)}% · 纵向 ${(region.rect.y*100).toFixed(1)}%`;
    const f=region.features;
    E.selectedFeatures.textContent=S.mode==='features'?`色相 ${(f.hue*360).toFixed(0)}° · 饱和 ${(f.saturation*100).toFixed(0)}% · 亮度 ${f.brightness.toFixed(2)} · 对比 ${f.contrast.toFixed(2)} · 纹理 ${f.texture.toFixed(2)}`:`亮度 ${f.brightness.toFixed(2)} · 对比 ${f.contrast.toFixed(2)} · 重心 ${(f.centroid*100).toFixed(1)}%`;
    E.selectedPitch.textContent=`${note(region.targetMidi)} → ${note(region.midi)}`;
    const event=view().events.find(e=>e.id===region.eventId);
    E.selectedTime.textContent=event?`${event.start.toFixed(2)}–${(event.start+event.duration).toFixed(2)} 秒`:`${region.start.toFixed(2)}–${region.end.toFixed(2)} 秒 · 未起音`;
    E.timeline.querySelectorAll('.note').forEach(r=>r.classList.toggle('selected',r.dataset.event===region.eventId));
  }
  function render() {
    const value=view(), info=S.payload.info, main=value.events.filter(e=>e.layer==='main');
    E.featureMode.setAttribute('aria-pressed',S.mode==='features');E.referenceMode.setAttribute('aria-pressed',S.mode==='reference');
    E.mappingLabel.textContent=S.mode==='features'?`${value.cols} 列 × 4 行 · 全图特征`:'参考原谱 · 原项目条带采样';
    E.key.textContent=`${info.key_name} · ${{'Major pentatonic':'大调五声','Minor pentatonic':'小调五声','Major':'大调','Natural minor':'自然小调','Dorian':'多利亚','Lydian':'利底亚'}[info.scale_name]||info.scale_name}`;
    E.tempo.textContent=`${info.tempo.toFixed(1)} BPM`;E.noteCount.textContent=`${value.mainCount} 个音符`;E.duration.textContent=`${info.duration.toFixed(1)} 秒＋余韵`;
    E.mappingHint.textContent=S.mode==='features'?'二维蛇形读取整张图；颜色、明暗、对比度和纹理共同改变主旋律，明显变化在音阶内保留。':'直接运行 Photo Sonification 原始分析、编曲和音源；参考原谱未重新改写旋律。';
    E.regions.style.gridTemplateColumns=`repeat(${value.cols},1fr)`;E.regions.style.gridTemplateRows=`repeat(${value.rows},1fr)`;
    E.regions.innerHTML=value.regions.map((r,i)=>`<button type="button" class="region" data-index="${i}" data-region="${r.id}" style="grid-column:${r.col+1};grid-row:${r.row+1}" aria-label="列 ${r.col+1} 区域 ${r.row+1}，${note(r.midi)}" title="${note(r.midi)}"></button>`).join('');
    E.centroids.innerHTML='';
    const lo=Math.min(48,...main.map(e=>e.midi)),hi=Math.max(84,...main.map(e=>e.midi));
    E.pitchTop.textContent=note(hi);E.pitchBottom.textContent=note(lo);
    let chart='';
    for(let bar=0;bar<=info.bars;bar++){const x=bar/info.bars*640;chart+=`<line class="grid" x1="${x}" x2="${x}" y1="0" y2="130"/>`;}
    chart+=main.map(e=>`<rect class="note" data-event="${e.id}" x="${e.start/info.duration*640}" y="${6+(hi-e.midi)/(hi-lo)*112}" width="${Math.max(1,Math.min(e.duration,info.duration-e.start)/info.duration*640)}" height="5" rx="1"><title>${note(e.midi)} · ${e.start.toFixed(2)} 秒</title></rect>`).join('');
    E.timeline.innerHTML=chart+'<line class="playhead" x1="0" x2="0" y1="0" y2="130"/>';
    E.eventCount.textContent=`${main.length} 个主旋律音符 · ${value.events.length} 个全曲事件`;
    E.middleTime.textContent=`${(info.duration/2).toFixed(1)} 秒`;E.endTime.textContent=`${info.duration.toFixed(1)} 秒`;
    geometry();select(0);paint();
  }
  async function generate() {
    if(!S.image)return;stop(true);S.clip=null;S.busy=true;controls();E.status.textContent='生成中';E.playText.textContent='正在生成…';
    const operation=++S.loadOperation, image=S.image;
    try {
      const health=await fetch(API+'/api/health'); if(!health.ok)throw new Error('请先双击“启动全图特征Demo.command”。');
      const response=await fetch(API+'/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:image.base64,options:{synth:E.tone.value,mapping:E.mappingStyle.value,backing:E.backing.checked}})});
      const payload=await response.json();if(!response.ok)throw new Error(payload.error||'生成失败');
      if(operation!==S.loadOperation)return;
      S.payload=payload;S.buffers.clear();S.time=0;S.busy=false;E.connection.hidden=true;
      const photo=await new Promise((resolve,reject)=>{const p=new Image();p.onload=()=>resolve(p);p.onerror=()=>reject(new Error('图片显示失败'));p.src=payload.image.src;});
      if(operation!==S.loadOperation)return;
      E.picture.width=payload.image.width;E.picture.height=payload.image.height;E.picture.getContext('2d').drawImage(photo,0,0);
      E.workName.textContent=image.name;E.credit.textContent=image.credit||'你的图片 · 原项目按整张图分析，最长边 512 像素';
      E.comparisonHint.textContent='同图、同配器，匹配响度；对比原谱与新旋律。';render();
    }catch(error){if(operation!==S.loadOperation)return;S.busy=false;E.connection.hidden=false;E.connection.textContent=`${error.message} 本地启动入口：项目中的“启动全图特征Demo.command”。`;E.status.textContent='等待本机音源';controls();toast(error.message);}
  }
  function mode(value){stop(true);S.mode=value;S.clip=null;if(S.payload)render();}
  async function preview(index) {
    stop();select(index);const eventId=view().regions[index].eventId;
    if(!eventId)return toast('这里没有实际主旋律音符。');
    const operation=++S.operation;
    try {
      await ctx();const response=await fetch(API+'/api/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:S.payload.key,variant:S.mode,eventId})});
      if(!response.ok)throw new Error('试听暂时不可用');const audio=await S.context.decodeAudioData(await response.arrayBuffer());if(operation!==S.operation)return;
      startBuffer(audio,0,audio.duration,1,operation,true);
    }catch(error){toast(error.message);}
  }
  const entries=[...window.PixelMusicStripSamples.entries,{id:'hue',name:'验收 · 等亮横向色带'},{id:'texture',name:'验收 · 同明暗纹理变化'}];
  function custom(id) {
    const canvas=document.createElement('canvas');canvas.width=192;canvas.height=120;const c=canvas.getContext('2d');
    if(id==='hue') {
      const colors=['rgb(84,0,0)','rgb(0,25,0)','rgb(0,0,247)','rgb(84,0,0)','rgb(0,0,247)','rgb(0,25,0)','rgb(84,0,0)','rgb(0,0,247)'];
      colors.forEach((color,i)=>{c.fillStyle=color;c.fillRect(i*24,0,24,120);});
    } else {
      c.fillStyle='#808080';c.fillRect(0,0,192,120);
      for(let x=96;x<192;x+=2)for(let y=0;y<120;y+=2){c.fillStyle=(x+y)%4?'#414141':'#bfbfbf';c.fillRect(x,y,2,2);}
    }
    return canvas;
  }
  async function sample(id) {
    stop(true);const entry=entries.find(e=>e.id===id);
    if(entry.path) {
      const data=window.PixelMusicStripPhotoData[id];S.image={base64:data.split(',')[1],name:entry.name,
        credit:id==='sunset'?'NASA / JPL / Texas A&M / Cornell · 火星日落 · 本地信息演示样本':'DeviantArt / scikit-image · 草地 · CC0'};
    } else {
      const canvas=['hue','texture'].includes(id)?custom(id):window.PixelMusicStripSamples.canvas(id);
      S.image={base64:canvas.toDataURL('image/png').split(',')[1],name:entry.name,credit:'几何验收样本 · 与上传图片使用相同生成规则'};
    }
    S.sample=id;await generate();
  }
  async function upload(file) {
    if(!file)return;if(!/^image\/(png|jpeg|webp)$/.test(file.type))return toast('请选择 PNG、JPG 或 WEBP 图片。');
    if(file.size>12*1024*1024)return toast('图片请小于 12MB。');const reading=++S.loadOperation;stop(true);
    const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
    if(reading!==S.loadOperation)return;S.image={base64:encoded.split(',')[1],name:file.name};S.sample=null;E.sample.selectedIndex=-1;await generate();E.file.value='';
  }
  E.play.addEventListener('click',()=>S.playing?stop():play());E.restart.addEventListener('click',()=>{stop(true);play();});
  E.featureMode.addEventListener('click',()=>mode('features'));E.referenceMode.addEventListener('click',()=>mode('reference'));
  E.abFeatures.addEventListener('click',()=>{mode('features');play(true);});E.abReference.addEventListener('click',()=>{mode('reference');play(true);});
  let resumeSeek=false;
  E.seek.addEventListener('pointerdown',()=>{resumeSeek=S.playing;stop();});
  E.seek.addEventListener('input',()=>{const next=Number(E.seek.value);if(S.playing)resumeSeek=true;stop();S.time=next;paint();});
  E.seek.addEventListener('change',()=>{if(resumeSeek)play();resumeSeek=false;});
  E.regions.addEventListener('click',event=>{const button=event.target.closest('button');if(button)preview(Number(button.dataset.index));});
  E.timeline.addEventListener('click',event=>{const rect=event.target.closest('[data-event]');if(!rect)return;const e=view().events.find(e=>e.id===rect.dataset.event),index=view().regions.findIndex(r=>r.id===e.sources[0]?.regionId);if(index>=0)preview(index);});
  E.tone.addEventListener('change',generate);E.backing.addEventListener('change',generate);E.mappingStyle.addEventListener('change',generate);
  E.sample.innerHTML=entries.map(e=>`<option value="${e.id}">${e.name}</option>`).join('');E.sample.addEventListener('change',()=>sample(E.sample.value));
  E.file.addEventListener('change',()=>upload(E.file.files[0]));
  E.export.addEventListener('click',async()=>{try{const response=await fetch(API+view().audioUrl);if(!response.ok)throw new Error('缓存已失效，请重新选择图片生成。');const url=URL.createObjectURL(await response.blob());const a=document.createElement('a');a.href=url;a.download=`图鸣-${S.mode==='features'?'全图特征':'参考原谱'}-${S.payload.settings.synth}.wav`;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);toast('完整 WAV 已交给浏览器保存。');}catch(error){toast(error.message);}});
  for(const type of ['dragenter','dragover'])E.imageStage.addEventListener(type,event=>{event.preventDefault();E.dropHint.hidden=false;});
  E.imageStage.addEventListener('dragleave',()=>E.dropHint.hidden=true);E.imageStage.addEventListener('drop',event=>{event.preventDefault();E.dropHint.hidden=true;upload(event.dataTransfer.files[0]);});
  window.addEventListener('resize',geometry);window.addEventListener('pagehide',()=>{stop();S.context?.close();});
  window.PixelMusicFeaturesDemo={snapshot:()=>({mode:S.mode,playing:S.playing,busy:S.busy,time:current(),sample:S.sample,selected:S.selected,comparison:S.comparison}),payload:()=>S.payload};
  controls();sample('sunset');
})();
