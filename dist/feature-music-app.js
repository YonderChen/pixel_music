(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const ids = ['workName','mappingLabel','picture','regions','centroids','scan','scanNote','dropHint','timeline','eventCount','pitchTop','pitchBottom','middleTime','endTime','status','referenceMode','parallelMode','parallelControls','rowCount','rowTracks','mixHint','recipe','recipeHint','key','tempo','noteCount','duration','mappingHint','tone','mappingStyle','backing','backingStatus','play','playText','playIcon','currentNote','seek','clock','restart','abReference','abParallel','comparisonHint','file','export','sample','credit','selectedTitle','selectedReason','selectedLocation','selectedFeatures','selectedPitch','selectedTime','toast','imageStage','connection'];
  ids.push('connectionMessage','retry','loadState','loadMessage','cancelWork');
  const E = Object.fromEntries(ids.map(id => [id,$(id)]));
  const API = location.protocol === 'file:' ? 'http://127.0.0.1:4176' : location.origin;
  const RECIPES=Object.freeze([
    {id:'feature-original',method:'transition',profile:'original',name:'多特征音高转换 · 新 / 原有叠加',filename:'多特征音高转换-原有叠加',hint:'颜色、明暗、饱和度、对比度与纹理共同决定音高；各行使用参考音源演奏量化音阶，再按原有方式叠加。'},
    {id:'reference-soft',method:'reference',profile:'soft',name:'行内参考条带 / 柔和合成混音',filename:'行内参考条带-柔和合成混音',hint:'各行采用参考条带法生成旋律，以暖键、柔拨弦、圆木琴和轻铃演奏，使用柔和合成混音。'},
    {id:'local-soft',method:'features',profile:'soft',name:'局部多特征法 / 柔和合成混音',filename:'局部多特征法-柔和合成混音',hint:'各行采用局部多特征与原有跳进控制生成旋律，以暖键、柔拨弦、圆木琴和轻铃演奏，使用柔和合成混音。'},
  ]);
  E.recipe.innerHTML=RECIPES.map(r=>`<option value="${r.id}">${r.name}</option>`).join('');
  E.recipe.value=RECIPES.find(r=>'#'+r.id===location.hash)?.id||RECIPES[0].id;
  const recipe=()=>RECIPES.find(r=>r.id===E.recipe.value)||RECIPES[0];
  const S = { mode:location.hash==='#reference'?'reference':'parallel', payload:null, image:null, playing:false, busy:false, time:0, clip:null, operation:0, loadOperation:0, buffers:new Map(), mixMetrics:new Map(), enabledRows:[], solo:null, selected:0 };
  const rowColors=['#f36343','#3b8b80','#7878b6','#ac8647'];
  const notes = ['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
  const note = midi => midi === null || midi === undefined ? '休止' : notes[(midi%12+12)%12] + (Math.floor(midi/12)-1);
  const fmt = t => `${String(Math.floor(t/60)).padStart(2,'0')}:${String(Math.floor(t%60)).padStart(2,'0')}`;
  const view = () => S.payload?.variants[S.mode];
  const pitchMappedView=()=>view()?.rowMethod==='transition';
  function workIndicator(){
    const active=S.busy||S.audioLoading;
    E.loadState.hidden=!active;
    if(active){
      const seconds=Math.max(0,Math.floor((performance.now()-S.workStarted)/1000));
      E.loadMessage.textContent=`${S.busy?'正在读取图片与生成乐谱':'首次准备所选声音'} · 已等待 ${seconds} 秒`;
      if(!S.workTimer)S.workTimer=setInterval(workIndicator,500);
    }else{clearInterval(S.workTimer);S.workTimer=null;}
  }
  async function request(url,options={},timeout=45000){
    const controller=options.controller||new AbortController();let expired=false;
    const timer=setTimeout(()=>{expired=true;controller.abort();},timeout);
    const {controller:_,...fetchOptions}=options;
    try{return await fetch(url,{...fetchOptions,signal:controller.signal});}
    catch(error){if(expired)throw new Error('本机处理超时，可以取消后重试。');throw error;}
    finally{clearTimeout(timer);}
  }
  let toastTimer;
  function toast(text) { clearTimeout(toastTimer); E.toast.textContent=text; E.toast.hidden=false; toastTimer=setTimeout(()=>E.toast.hidden=true,4500); }
  function current() { return S.playing ? Math.min(S.limit,Math.max(S.offset,S.offset+S.context.currentTime-S.started)) : S.time; }
  function stop(reset=false) {
    S.time=reset?0:current(); S.playing=false; S.audioLoading=false; S.operation++; cancelAnimationFrame(S.animation);
    if(S.source) {
      const source=S.source, output=S.output, now=S.context.currentTime;
      source.onended=null; output.gain.cancelScheduledValues(now); output.gain.setValueAtTime(output.gain.value,now); output.gain.linearRampToValueAtTime(0,now+.02);
      try{source.stop(now+.025);}catch(_){}
      setTimeout(()=>{source.disconnect();output.disconnect();},40); S.source=S.output=null;
    }
    paint();
  }
  function controls() {
    for(const el of [E.play,E.restart,E.abReference,E.seek,E.export,E.abParallel]) el.disabled=!S.payload||S.busy;
    E.referenceMode.disabled=E.parallelMode.disabled=false;
    E.abParallel.disabled=!S.payload?.variants.parallel||S.busy;
    for(const el of E.rowTracks.querySelectorAll('input,button'))el.disabled=S.busy;
    E.rowCount.disabled=E.recipe.disabled=S.busy;
    E.retry.disabled=S.busy||!S.image;workIndicator();
  }
  async function ctx() {
    if(!S.context||S.context.state==='closed') S.context=new (window.AudioContext||window.webkitAudioContext)();
    if(S.context.state==='suspended') await S.context.resume(); return S.context;
  }
  const enabledRowIds=()=>S.enabledRows.map((on,i)=>on?`row-${i}`:null).filter(Boolean);
  const includeRowBackground=()=>E.backing.checked&&S.solo===null;
  const mixerKey=(profile=recipe().profile)=>S.payload.key+':parallel:'+profile+':'+S.enabledRows.map(x=>x?'1':'0').join('')+':'+includeRowBackground();
  const partialMix=()=>S.enabledRows.some(on=>!on)||S.solo!==null;
  async function audioResponse(mode,profile=recipe().profile) {
    if(mode==='parallel'&&partialMix())return request(API+'/api/rowmix',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:S.payload.key,rows:enabledRowIds(),background:includeRowBackground(),profile})});
    if(mode==='parallel'&&S.payload.variants.parallel.mixProfiles)return request(API+S.payload.variants.parallel.mixProfiles[profile].audioUrl);
    return request(API+S.payload.variants[mode].audioUrl);
  }
  async function buffer(mode,profile=recipe().profile) {
    const key=mode==='parallel'?mixerKey(profile):S.payload.key+':'+mode;
    if(!S.buffers.has(key)) {
      const meta=S.payload.variants[mode];
      const pending=audioResponse(mode,profile).then(r=>{if(!r.ok)throw new Error('声音准备失败，请重试或重新生成。');const rms=Number(r.headers.get('X-Audio-Rms')??(mode==='parallel'?meta.mixProfiles?.[profile]?.metrics?.first12Rms:meta.metrics?.first12Rms)??0);S.mixMetrics.set(key,rms);return r.arrayBuffer();}).then(bytes=>S.context.decodeAudioData(bytes));
      S.buffers.set(key,pending); pending.catch(()=>{if(S.buffers.get(key)===pending)S.buffers.delete(key);});
      while(S.buffers.size>6)S.buffers.delete(S.buffers.keys().next().value);
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
    S.audioLoading=true;S.workStarted=performance.now();paint();
    const end=S.clip??view().duration, from=compare||S.time>=end-.02?0:S.time;
    try {
      await ctx(); const audio=await buffer(S.mode); if(operation!==S.operation)return;
      let gain=1;
      if(S.clip) {
          await buffer('parallel');await buffer('reference');if(operation!==S.operation)return;
          const a=S.mixMetrics.get(mixerKey());
          const b=S.mixMetrics.get(S.payload.key+':reference'),target=Math.min(a,b);
          gain=target>1e-7?target/(S.mode==='reference'?b:a):1;
          E.comparisonHint.textContent=target>1e-7?'同图、同速度，前 12 秒响度匹配。':'一版为静音，保留实际声音供比较。';
          S.comparison={parallelRms:a,referenceRms:b,gain,matched:target>1e-7,pair:recipe().id};
      }
      S.audioLoading=false;startBuffer(audio,from,end,gain,operation);
    }catch(error){if(operation!==S.operation)return;S.audioLoading=false;toast(error.message);paint();}
  }
  function paint() {
    if(!S.payload){controls();return;}
    const value=view(), time=current(), end=S.clip??value.duration;
    const active=value.events.filter(e=>e.layer==='main'&&time>=e.start&&time<e.start+e.duration&&(S.mode!=='parallel'||S.enabledRows[e.row]));
    const show=S.playing||time>0;
    const activeIds=new Set(show?active.flatMap(e=>e.sources.map(ref=>ref.regionId)):[]);
    E.regions.querySelectorAll('button').forEach(button=>button.classList.toggle('active',activeIds.has(button.dataset.region)));
    E.timeline.querySelectorAll('.note').forEach(rect=>{rect.classList.toggle('active',show&&active.some(e=>e.id===rect.dataset.event));rect.classList.toggle('muted',S.mode==='parallel'&&!S.enabledRows[Number(rect.dataset.row)]);});
    const playhead=E.timeline.querySelector('.playhead');
    if(playhead){const x=Math.min(640,time/S.payload.info.duration*640);playhead.setAttribute('x1',x);playhead.setAttribute('x2',x);}
    const region=value.regions.find(r=>time>=r.start&&time<r.end)||value.regions.at(-1);
    const x=S.mode==='parallel'?Math.min(1,time/S.payload.info.duration):region?region.rect.x+region.rect.width*.5:1;
    E.scan.style.left=`${Math.min(99.7,x*100)}%`;E.scan.classList.toggle('end',x>.9);E.scan.hidden=!show;
    E.scanNote.textContent=time>=S.payload.info.duration?'余韵':active.length?active.map(e=>S.mode==='parallel'?`${e.row+1}行 ${note(e.midi)}`:note(e.midi)).join(' / '):'留白';
    E.currentNote.textContent=show?(S.mode==='parallel'&&active.length?`${new Set(active.map(e=>e.row)).size} 行发声`:E.scanNote.textContent):'—';
    E.seek.max=end;E.seek.value=time;E.clock.textContent=`${fmt(time)} / ${fmt(end)}`;
    E.playIcon.textContent=S.playing?'Ⅱ':'▶';E.playText.textContent=S.audioLoading?'准备声音 · 点击取消':S.playing?'暂停演奏':time>=end-.02?'再次演奏':time>0?'继续演奏':'开始演奏';
    E.status.textContent=S.busy?'生成中':S.audioLoading?'准备声音':S.playing?(time>=S.payload.info.duration?'渐渐收尾':'正在演奏'):time>=end-.02?(S.clip?'对照结束':'演奏结束'):time>0?'已暂停':'可以演奏';
    E.status.classList.toggle('playing',S.playing);
    const layers=Object.keys(value.layerCounts).filter(k=>k!=='main');
    E.backingStatus.textContent=S.mode==='parallel'&&S.solo!==null?`独听第 ${S.solo+1} 行 · 伴奏暂不播放`:E.backing.checked?`${S.mode==='parallel'?'共用一份':''}参考项目编曲 · ${layers.map(k=>({bass:'低音',pad:'铺底',chord:'和弦',texture:'纹理',solo:'独奏'}[k]||k)).join(' / ')}`:'仅听主旋律';
    controls();
  }
  function animate(){if(!S.playing)return;paint();S.animation=requestAnimationFrame(animate);}
  function geometry() {
    const size=S.previewSize||S.payload?.image;if(!size)return;
    const ratio=size.width/size.height;
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
    E.selectedFeatures.textContent=S.mode!=='reference'?`色相 ${(f.hue*360).toFixed(0)}° · 饱和 ${(f.saturation*100).toFixed(0)}% · 亮度 ${f.brightness.toFixed(2)} · 对比 ${f.contrast.toFixed(2)} · 纹理 ${f.texture.toFixed(2)}`:`亮度 ${f.brightness.toFixed(2)} · 对比 ${f.contrast.toFixed(2)} · 重心 ${(f.centroid*100).toFixed(1)}%`;
    E.selectedPitch.textContent=`${note(region.targetMidi)} → ${note(region.midi)}`;
    const event=view().events.find(e=>e.id===region.eventId);
    E.selectedTime.textContent=event?`${event.start.toFixed(2)}–${(event.start+event.duration).toFixed(2)} 秒`:`${region.start.toFixed(2)}–${region.end.toFixed(2)} 秒 · 未起音`;
    E.timeline.querySelectorAll('.note').forEach(r=>r.classList.toggle('selected',r.dataset.event===region.eventId));
  }
  function render() {
    const value=view(), info=S.payload.info, main=value.events.filter(e=>e.layer==='main');
    E.referenceMode.setAttribute('aria-pressed',S.mode==='reference');
    E.parallelMode.setAttribute('aria-pressed',S.mode==='parallel');E.parallelControls.hidden=S.mode!=='parallel';
    E.mappingLabel.textContent=S.mode==='parallel'?`${value.rows} 行 × ${value.cols} 列 · 横向叠奏`:'参考原谱 · 原项目条带采样';
    E.key.textContent=`${info.key_name} · ${{'Major pentatonic':'大调五声','Minor pentatonic':'小调五声','Major':'大调','Natural minor':'自然小调','Dorian':'多利亚','Lydian':'利底亚'}[info.scale_name]||info.scale_name}`;
    E.tempo.textContent=`${info.tempo.toFixed(1)} BPM`;E.noteCount.textContent=`${value.mainCount} 个${pitchMappedView()?'音高片段':'音符'}`;E.duration.textContent=`${info.duration.toFixed(1)} 秒＋余韵`;
    E.mappingHint.textContent=S.mode==='parallel'?`各行独立分析并从左到右同时演奏；${recipe().hint} 整体伴奏只保留一份。`:'直接运行 Photo Sonification 原始分析、编曲和音源；参考原谱未重新改写旋律。';
    E.regions.style.gridTemplateColumns=`repeat(${value.cols},1fr)`;E.regions.style.gridTemplateRows=`repeat(${value.rows},1fr)`;
    E.regions.classList.toggle('parallel',S.mode==='parallel');
    E.regions.innerHTML=value.regions.map((r,i)=>`<button type="button" class="region" data-index="${i}" data-region="${r.id}" style="grid-column:${r.col+1};grid-row:${r.row+1};--voice-color:${rowColors[r.row%4]}" aria-label="列 ${r.col+1} 区域 ${r.row+1}，${note(r.midi)}" title="${note(r.midi)}"></button>`).join('');
    E.centroids.innerHTML='';
    E.centroids.setAttribute('viewBox',`0 0 ${S.payload.image.width} ${S.payload.image.height}`);
    const lo=Math.min(48,...main.map(e=>e.midi)),hi=Math.max(84,...main.map(e=>e.midi));
    const chartHeight=S.mode==='parallel'?value.rows*60:130;
    E.timeline.setAttribute('viewBox',`0 0 640 ${chartHeight}`);E.timeline.style.height=`${chartHeight}px`;E.timeline.parentElement.style.height=`${chartHeight+2}px`;
    E.pitchTop.textContent=S.mode==='parallel'?'第1行':note(hi);E.pitchBottom.textContent=S.mode==='parallel'?`第${value.rows}行`:note(lo);
    let chart='';
    for(let bar=0;bar<=info.bars;bar++){const x=bar/info.bars*640;chart+=`<line class="grid" x1="${x}" x2="${x}" y1="0" y2="${chartHeight}"/>`;}
    if(S.mode==='parallel')for(let row=0;row<value.rows;row++)chart+=`<line class="grid" x1="0" x2="640" y1="${row*60}" y2="${row*60}"/><text x="4" y="${row*60+11}" font-size="9" fill="${rowColors[row]}">第${row+1}行</text>`;
    chart+=main.map(e=>`<rect class="note ${S.mode==='parallel'?'row-note':''}" data-event="${e.id}" data-row="${e.row??''}" style="--voice-color:${rowColors[(e.row??0)%4]}" x="${e.start/info.duration*640}" y="${S.mode==='parallel'?e.row*60+14+(hi-e.midi)/(hi-lo)*37:6+(hi-e.midi)/(hi-lo)*112}" width="${Math.max(1,Math.min(e.duration,info.duration-e.start)/info.duration*640)}" height="5" rx="1"><title>${S.mode==='parallel'?`第${e.row+1}行 · `:''}${note(e.midi)} · ${e.start.toFixed(2)} 秒</title></rect>`).join('');
    E.timeline.innerHTML=chart+`<line class="playhead" x1="0" x2="0" y1="0" y2="${chartHeight}"/>`;
    E.eventCount.textContent=`${main.length} 个${pitchMappedView()?'音高目标 · 参考音源量化演奏':'主旋律音符 · '+value.events.length+' 个全曲事件'}`;
    E.middleTime.textContent=`${(info.duration/2).toFixed(1)} 秒`;E.endTime.textContent=`${info.duration.toFixed(1)} 秒`;
    renderTracks();geometry();select(0);paint();
  }
  function renderTracks(){
    const p=S.payload?.variants.parallel;if(!p)return;
    const soft=recipe().profile==='soft'&&p.mixProfiles?.soft;
    E.recipeHint.textContent=recipe().hint;
    E.mixHint.textContent=soft?'柔和合成混音 · 暖键、柔拨弦、圆木琴与轻铃；整体伴奏退后，共用轻回声。':'原有叠加 · 各行使用参考音源自动选出的乐器，播放量化音阶，共用一份整体伴奏。';
    E.rowTracks.innerHTML=p.voices.map((v,i)=>`<div class="row-track" style="--voice-color:${rowColors[i]}"><label><input type="checkbox" data-row-toggle="${i}" ${S.enabledRows[i]?'checked':''}><i></i>${v.name} <small>${soft?soft.voices[i]:v.instrumentName}</small></label><button type="button" data-row-solo="${i}" aria-pressed="${S.solo===i}">独听</button></div>`).join('');
  }
  function changeMixer(index,solo,desired){
    const wasPlaying=S.playing;stop();
    if(solo){
      if(S.solo===index){S.enabledRows=S.savedRows||S.enabledRows.map(()=>true);S.solo=null;}
      else {if(S.solo===null)S.savedRows=S.enabledRows.slice();S.enabledRows=S.enabledRows.map((_,i)=>i===index);S.solo=index;}
    }else{if(S.solo!==null){S.solo=null;S.savedRows=null;}S.enabledRows[index]=desired;}
    renderTracks();paint();if(wasPlaying||solo)play();
  }
  async function generate() {
    if(!S.image)return;S.loadAbort?.abort();stop(true);S.clip=null;S.busy=true;S.workStarted=performance.now();S.payload=null;S.loadAbort=new AbortController();controls();E.status.textContent='生成中';E.playText.textContent='正在生成乐谱…';E.connection.hidden=true;
    const operation=++S.loadOperation, image=S.image;
    try {
      await showInput(image,operation);if(operation!==S.loadOperation)return;
      const health=await request(API+'/api/health',{controller:S.loadAbort},4000);if(!health.ok)throw new Error('请先双击“启动全图特征Demo.command”。');
      const response=await request(API+'/api/generate',{method:'POST',controller:S.loadAbort,headers:{'Content-Type':'application/json'},body:JSON.stringify({image:image.base64,options:{synth:E.tone.value,mapping:E.mappingStyle.value,backing:E.backing.checked,rowCount:Number(E.rowCount.value),rowMethod:recipe().method,pitchTransition:'scale',featureMethod:'features'}})},20000);
      const payload=await response.json();if(!response.ok)throw new Error(payload.error||'生成失败');
      if(operation!==S.loadOperation)return;
      S.payload=payload;S.buffers.clear();S.mixMetrics.clear();S.time=0;E.connection.hidden=true;S.solo=null;
      const count=payload.variants.parallel?.rows??4;S.enabledRows=Array.from({length:count},()=>true);
      if(recipe().profile==='soft'&&!payload.variants.parallel?.mixProfiles?.soft)throw new Error('当前音源不支持柔和合成混音，请重启本机服务。');
      if(!payload.variants.parallel){if(S.mode==='parallel')S.mode='reference';E.connection.hidden=false;E.connectionMessage.textContent='当前音源是旧版，请重启本机 demo 服务以开启多行叠奏。';}
      const photo=await new Promise((resolve,reject)=>{const p=new Image();p.onload=()=>resolve(p);p.onerror=()=>reject(new Error('图片显示失败'));p.src=payload.image.src;});
      if(operation!==S.loadOperation)return;
      S.previewSize=payload.image;E.picture.width=payload.image.width;E.picture.height=payload.image.height;E.picture.getContext('2d').drawImage(photo,0,0);
      E.workName.textContent=image.name;E.credit.textContent=image.credit||'你的图片 · 原项目按整张图分析，最长边 512 像素';
      S.busy=false;E.comparisonHint.textContent='同图、同速度，匹配响度；对比原谱与新旋律。';render();
    }catch(error){if(operation!==S.loadOperation)return;S.busy=false;E.connection.hidden=false;E.connectionMessage.textContent=`${error.message} 可以点击“重新生成”；若服务未启动，请双击“启动全图特征Demo.command”。`;E.status.textContent='生成失败';E.playText.textContent='生成失败 · 请重试';controls();toast(error.message);}
    finally{if(operation===S.loadOperation){S.busy=false;S.loadAbort=null;controls();}}
  }
  async function showInput(image,operation){
    const photo=await new Promise((resolve,reject)=>{const p=new Image();p.onload=()=>resolve(p);p.onerror=()=>reject(new Error('图片显示失败'));p.src=`data:${image.mime||'image/png'};base64,`+image.base64;});
    if(operation!==S.loadOperation)return;
    const scale=Math.min(1,512/Math.max(photo.width,photo.height));
    S.previewSize={width:Math.max(1,Math.round(photo.width*scale)),height:Math.max(1,Math.round(photo.height*scale))};
    E.picture.width=S.previewSize.width;E.picture.height=S.previewSize.height;E.picture.getContext('2d').drawImage(photo,0,0,E.picture.width,E.picture.height);
    E.regions.innerHTML=E.timeline.innerHTML='';E.scan.hidden=true;E.workName.textContent=image.name;geometry();
  }
  function mode(value){stop(true);S.mode=value==='reference'?'reference':'parallel';S.clip=null;if(S.payload)render();else{E.parallelMode.setAttribute('aria-pressed',S.mode==='parallel');E.referenceMode.setAttribute('aria-pressed',S.mode==='reference');E.parallelControls.hidden=S.mode!=='parallel';}}
  async function preview(index) {
    stop();select(index);const eventId=view().regions[index].eventId;
    if(!eventId)return toast('这里没有实际主旋律音符。');
    const operation=++S.operation;
    try {
      await ctx();const response=await request(API+'/api/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:S.payload.key,variant:S.mode,eventId,profile:recipe().profile})});
      if(!response.ok)throw new Error('试听暂时不可用');const audio=await S.context.decodeAudioData(await response.arrayBuffer());if(operation!==S.operation)return;
      startBuffer(audio,0,audio.duration,1,operation,true);
    }catch(error){toast(error.message);}
  }
  const entries=[...window.PixelMusicStripSamples.entries,{id:'pitch',name:'音高转换验收 · 多特征渐变'},{id:'rows',name:'结构对照 · 四行线条'},{id:'turns',name:'结构对照 · 上下线条'},{id:'hue',name:'验收 · 等亮横向色带'},{id:'texture',name:'验收 · 同明暗纹理变化'}];
  function custom(id) {
    const canvas=document.createElement('canvas');canvas.width=192;canvas.height=120;const c=canvas.getContext('2d');
    if(id==='pitch'){
      for(let x=0;x<192;x++){
        const u=x/191,light=Math.round(45+175*u),reverse=Math.round(220-175*u);
        c.fillStyle=`rgb(${light},${light},${light})`;c.fillRect(x,0,1,30);
        c.fillStyle=`rgb(${reverse},${reverse},${reverse})`;c.fillRect(x,30,1,30);
        c.fillStyle=`hsl(${u*300},70%,45%)`;c.fillRect(x,60,1,30);
        for(let y=90;y<120;y++){const v=x<96?128:((x+y)%4<2?64:192);c.fillStyle=`rgb(${v},${v},${v})`;c.fillRect(x,y,1,1);}
      }
    }else if(id==='rows'||id==='turns'){
      c.fillStyle='#1f2530';c.fillRect(0,0,192,120);
      const colors=['#ffdf83','#aaffe0','#d5cbff','#ff9375'];
      for(let row=0;row<4;row++){c.strokeStyle=colors[row];c.lineWidth=4;c.beginPath();for(let x=0;x<192;x++){const u=x/191;const height=id==='turns'?[u,1-u,1-Math.abs(2*u-1),Math.abs(2*u-1)][row]:.5-.5*Math.sin(x/192*Math.PI*(2+row%2)+(row*.8));const y=row*30+24-18*height;if(x)c.lineTo(x,y);else c.moveTo(x,y);}c.stroke();}
    }else if(id==='hue') {
      const colors=['rgb(84,0,0)','rgb(0,25,0)','rgb(0,0,247)','rgb(84,0,0)','rgb(0,0,247)','rgb(0,25,0)','rgb(84,0,0)','rgb(0,0,247)'];
      colors.forEach((color,i)=>{c.fillStyle=color;c.fillRect(i*24,0,24,120);});
    } else {
      c.fillStyle='#808080';c.fillRect(0,0,192,120);
      for(let x=96;x<192;x+=2)for(let y=0;y<120;y+=2){c.fillStyle=(x+y)%4?'#414141':'#bfbfbf';c.fillRect(x,y,2,2);}
    }
    return canvas;
  }
  async function sample(id) {
    stop(true);E.sample.value=id;const entry=entries.find(e=>e.id===id);
    if(entry.path) {
      const data=window.PixelMusicStripPhotoData[id];S.image={base64:data.split(',')[1],name:entry.name,
        credit:id==='sunset'?'NASA / JPL / Texas A&M / Cornell · 火星日落 · 本地信息演示样本':'DeviantArt / scikit-image · 草地 · CC0'};
    } else {
      const canvas=['pitch','hue','texture','rows','turns'].includes(id)?custom(id):window.PixelMusicStripSamples.canvas(id);
      S.image={base64:canvas.toDataURL('image/png').split(',')[1],name:entry.name,credit:'几何验收样本 · 与上传图片使用相同生成规则'};
    }
    S.sample=id;await generate();
  }
  async function upload(file) {
    if(!file)return;if(!/^image\/(png|jpeg|webp)$/.test(file.type))return toast('请选择 PNG、JPG 或 WEBP 图片。');
    if(file.size>12*1024*1024)return toast('图片请小于 12MB。');const reading=++S.loadOperation;stop(true);
    const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
    if(reading!==S.loadOperation)return;S.image={base64:encoded.split(',')[1],name:file.name,mime:file.type};S.sample=null;E.sample.selectedIndex=-1;await generate();E.file.value='';
  }
  E.play.addEventListener('click',()=>S.playing||S.audioLoading?stop():play());E.restart.addEventListener('click',()=>{stop(true);play();});
  E.retry.addEventListener('click',generate);
  E.cancelWork.addEventListener('click',()=>{if(S.busy){S.loadOperation++;S.loadAbort?.abort();S.busy=false;E.status.textContent='已取消';E.playText.textContent='已取消 · 可重新生成';E.connectionMessage.textContent='已取消生成，可以更换图片或重新生成。';E.connection.hidden=false;controls();}else stop();});
  E.referenceMode.addEventListener('click',()=>mode('reference'));E.parallelMode.addEventListener('click',()=>mode('parallel'));
  E.abParallel.addEventListener('click',()=>{mode('parallel');play(true);});E.abReference.addEventListener('click',()=>{mode('reference');play(true);});
  E.rowCount.addEventListener('change',generate);
  E.recipe.addEventListener('change',()=>{if(!RECIPES.some(r=>r.id===E.recipe.value))E.recipe.value=RECIPES[0].id;mode('parallel');generate();});
  window.addEventListener('hashchange',()=>{const next=RECIPES.find(r=>'#'+r.id===location.hash);if(next&&next.id!==recipe().id){E.recipe.value=next.id;mode('parallel');generate();}else mode(location.hash==='#reference'?'reference':'parallel');});
  E.rowTracks.addEventListener('change',event=>{if(event.target.matches('[data-row-toggle]'))changeMixer(Number(event.target.dataset.rowToggle),false,event.target.checked);});
  E.rowTracks.addEventListener('click',event=>{const button=event.target.closest('[data-row-solo]');if(button)changeMixer(Number(button.dataset.rowSolo),true);});
  let resumeSeek=false;
  E.seek.addEventListener('pointerdown',()=>{resumeSeek=S.playing;stop();});
  E.seek.addEventListener('input',()=>{const next=Number(E.seek.value);if(S.playing)resumeSeek=true;stop();S.time=next;paint();});
  E.seek.addEventListener('change',()=>{if(resumeSeek)play();resumeSeek=false;});
  E.regions.addEventListener('click',event=>{const button=event.target.closest('button');if(button)preview(Number(button.dataset.index));});
  E.timeline.addEventListener('click',event=>{const rect=event.target.closest('[data-event]');if(!rect)return;const e=view().events.find(e=>e.id===rect.dataset.event),index=view().regions.findIndex(r=>r.id===e.sources[0]?.regionId);if(index>=0)preview(index);});
  E.tone.addEventListener('change',generate);E.backing.addEventListener('change',generate);E.mappingStyle.addEventListener('change',generate);
  E.sample.innerHTML=entries.map(e=>`<option value="${e.id}">${e.name}</option>`).join('');E.sample.addEventListener('change',()=>sample(E.sample.value));
  E.file.addEventListener('change',()=>upload(E.file.files[0]));
  E.export.addEventListener('click',async()=>{try{
    const exportMode=S.mode,chosen=recipe(),profile=chosen.profile,synth=S.payload.settings.synth;
    const filename=`图鸣-${exportMode==='parallel'?'多行叠奏-'+chosen.filename:'参考原谱'}-${synth}.wav`;
    const response=await audioResponse(exportMode,profile);if(!response.ok)throw new Error('缓存已失效，请重新选择图片生成。');const url=URL.createObjectURL(await response.blob());
    const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2000);toast('完整 WAV 已交给浏览器保存。');
  }catch(error){toast(error.message);}});
  for(const type of ['dragenter','dragover'])E.imageStage.addEventListener(type,event=>{event.preventDefault();E.dropHint.hidden=false;});
  E.imageStage.addEventListener('dragleave',()=>E.dropHint.hidden=true);E.imageStage.addEventListener('drop',event=>{event.preventDefault();E.dropHint.hidden=true;upload(event.dataTransfer.files[0]);});
  window.addEventListener('resize',geometry);window.addEventListener('pagehide',()=>{S.loadOperation++;S.loadAbort?.abort();S.busy=false;stop();S.context?.close();});
  window.PixelMusicFeaturesDemo={snapshot:()=>({mode:S.mode,recipe:recipe().id,mixProfile:recipe().profile,rowMethod:recipe().method,playing:S.playing,busy:S.busy,audioLoading:!!S.audioLoading,time:current(),sample:S.sample,selected:S.selected,recipes:RECIPES.map(r=>({id:r.id,method:r.method,profile:r.profile,name:r.name})),comparison:S.comparison,enabledRows:S.enabledRows.slice(),solo:S.solo}),payload:()=>S.payload};
  controls();mode(S.mode);sample(S.mode==='parallel'?'pitch':'sunset');
})();
