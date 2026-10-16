(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const ids = ['workName','mappingLabel','picture','regions','centroids','scan','scanNote','dropHint','timeline','eventCount','pitchTop','pitchBottom','middleTime','endTime','status','referenceMode','parallelMode','parallelControls','rowCount','rowTracks','mixHint','recipe','recipeHint','key','tempo','noteCount','duration','mappingHint','tone','mappingStyle','backing','backingStatus','play','playText','playIcon','currentNote','seek','clock','restart','abReference','abParallel','comparisonHint','file','export','sample','credit','selectedTitle','selectedReason','selectedLocation','selectedFeatures','selectedPitch','selectedTime','toast','imageStage','connection'];
  ids.push('connectionMessage','retry','loadState','loadMessage','cancelWork');
  ids.push('hoverToggle','hoverState');
  ids.push('segments','segmentMethod','segmentSetting','segmentOrder','orderSetting','contourToggle','contourSetting','softToggle','softSetting');
  ids.push('loopToggle');
  ids.push('musicArt');
  const E = Object.fromEntries(ids.map(id => [id,$(id)]));
  const API = '';
  const RECIPES=Object.freeze([
    {id:'regions-soft',method:'regions',profile:'soft',name:'区域分割 / 柔和合成混音',filename:'区域分割',hint:'按图片内容把画面分成形状各异的区域（可切换分割方式与演奏顺序）；区域按纵向位置分到各声部，上高下低，区域越大音越长；伴奏由实际音符推出和声铺底。'},
    {id:'arranged',method:'arranged',profile:'original',name:'编曲版 · 新 / 声部分工与和声',filename:'编曲版-声部分工与和声',hint:'各行担任主旋律、副旋律、分解和弦与低音，分处不同音区；只有图片变化才换和弦、加密节奏、移动旋律，特征不变处连成长音；乐器按图片情绪从固定组合中选择。'},
    {id:'feature-original',method:'transition',profile:'original',name:'多特征音高转换 · 新 / 原有叠加',filename:'多特征音高转换-原有叠加',hint:'颜色、明暗、饱和度、对比度与纹理共同决定音高；各行使用参考音源演奏量化音阶，再按原有方式叠加。'},
    {id:'reference-soft-plus',method:'reference-plus',profile:'soft',name:'行内参考条带 · 优化 / 柔和合成混音',filename:'行内参考条带优化-柔和合成混音',hint:'沿用行内参考条带的音高与节奏；各行按图片上下分到不同八度，配合音区的柔和音色；伴奏改为由各行实际音符推出的和声铺底，图片不变时和弦也不变。'},
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
    const active=S.busy||S.audioLoading||S.hoverLoading;
    E.loadState.hidden=!active;
    if(active){
      const seconds=Math.max(0,Math.floor((performance.now()-S.workStarted)/1000));
      E.loadMessage.textContent=`${S.busy?'正在读取图片与生成乐谱':S.hoverLoading?'首次准备移动试听音色':'首次准备所选声音'} · 已等待 ${seconds} 秒`;
      if(!S.workTimer)S.workTimer=setInterval(workIndicator,500);
    }else{clearInterval(S.workTimer);S.workTimer=null;}
  }
  async function request(url,options={},timeout=180000){
    const controller=options.controller||new AbortController();let expired=false;
    const timer=setTimeout(()=>{expired=true;controller.abort();},timeout);
    const {controller:_,...fetchOptions}=options;
    try{return await window.PixelMusicBrowser.request(url,{...fetchOptions,signal:controller.signal});}
    catch(error){if(expired)throw new Error('本机处理超时，可以取消后重试。');throw error;}
    finally{clearTimeout(timer);}
  }
  let toastTimer;
  function toast(text) { clearTimeout(toastTimer); E.toast.textContent=text; E.toast.hidden=false; toastTimer=setTimeout(()=>E.toast.hidden=true,4500); }
  function current() { return S.playing ? Math.min(S.limit,Math.max(S.offset,S.offset+S.context.currentTime-S.started)) : S.time; }
  function stop(reset=false) {
    clearHoverNotes();
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
    E.rowCount.disabled=E.recipe.disabled=E.segmentMethod.disabled=E.segmentOrder.disabled=E.contourToggle.disabled=E.softToggle.disabled=S.busy;
    E.segmentSetting.hidden=E.orderSetting.hidden=E.contourSetting.hidden=E.softSetting.hidden=recipe().method!=='regions';
    E.hoverToggle.disabled=!S.payload||S.busy;
    E.loopToggle.disabled=!S.payload||S.busy;
    E.musicArt.setAttribute('aria-disabled',!S.payload||S.busy);
    E.hoverState.textContent=!E.hoverToggle.checked?'开启后，鼠标移到哪里就弹奏哪个区域。':S.busy?'正在生成乐谱，完成后自动准备移动试听。':S.hoverLoading?'准备音色中…完成后移动即可弹奏，可取消。':!S.hoverBank?'音色尚未准备，关闭后重新开启可重试。':S.hoverIndex!==null&&S.hoverIndex!==undefined?`移动试听 · ${S.mode==='parallel'?'第 '+(view().regions[S.hoverIndex].row+1)+(segmentView()?' 声部 · ':' 行 · '):''}${note(view().regions[S.hoverIndex].midi)}`:'移动试听已开启 · 跨区域弹奏，移出图片停止。';
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
    source.onended=()=>{
      if(S.operation!==operation||S.source!==source)return;
      S.source=S.output=null;source.disconnect();output.disconnect();S.hoverAudible=false;
      if(!preview){
        S.playing=false;
        if(E.loopToggle.checked&&!S.clip){
          S.time=0;cancelAnimationFrame(S.animation);
          startBuffer(audio,0,end,gain,operation);
        }else S.time=end;
      }
      paint();
    };
    source.start(start,from,length); if(!preview)animate();
  }
  async function play(compare=false) {
    clearHoverPointer();
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
    const hover=E.hoverToggle.checked&&S.hoverIndex!==null&&S.hoverIndex!==undefined?value.regions[S.hoverIndex]:null;
    const active=hover?value.events.filter(e=>e.id===hover.eventId):value.events.filter(e=>e.layer==='main'&&time>=e.start&&time<e.start+e.duration&&(S.mode!=='parallel'||S.enabledRows[e.row]));
    const show=!!hover||S.playing||time>0;
    // On the single path the other voices only sustain; highlight the newest region alone.
    const lit=value.segmentation?.order==='path'&&active.length?[active.reduce((a,b)=>b.start>a.start?b:a)]:active;
    const activeIds=new Set(hover?[hover.id]:show?lit.flatMap(e=>e.sources.map(ref=>ref.regionId)):[]);
    E.regions.querySelectorAll('button').forEach(button=>button.classList.toggle('active',activeIds.has(button.dataset.region)));
    const segmented=segmentView();if(segmented){drawSegments(activeIds);traceContours(value,hover?value.events.filter(e=>e.id===hover.eventId):show?lit:[]);}
    E.timeline.querySelectorAll('.note').forEach(rect=>{rect.classList.toggle('active',show&&active.some(e=>e.id===rect.dataset.event));rect.classList.toggle('muted',S.mode==='parallel'&&!S.enabledRows[Number(rect.dataset.row)]);});
    const playhead=E.timeline.querySelector('.playhead');
    if(playhead){const x=Math.min(640,(hover?hover.start:time)/S.payload.info.duration*640);playhead.setAttribute('x1',x);playhead.setAttribute('x2',x);}
    const region=hover||value.regions.find(r=>time>=r.start&&time<r.end)||value.regions.at(-1);
    const sounding=segmented&&value.regions.find(r=>activeIds.has(r.id));
    const x=segmented?(hover||sounding)?.centroid.x??0:hover?hover.rect.x+hover.rect.width*.5:S.mode==='parallel'?Math.min(1,time/S.payload.info.duration):region?region.rect.x+region.rect.width*.5:1;
    E.scan.style.left=`${Math.min(99.7,x*100)}%`;E.scan.classList.toggle('end',x>.9);E.scan.classList.toggle('floating',!!segmented);E.scan.hidden=!show;
    const lane=r=>segmented?`${r+1}声部 `:`${r+1}行 `;
    E.scanNote.textContent=hover?`${S.mode==='parallel'?lane(hover.row):''}${note(hover.midi)}`:time>=S.payload.info.duration?'余韵':active.length?active.map(e=>S.mode==='parallel'?`${lane(e.row)}${note(e.midi)}`:note(e.midi)).join(' / '):'留白';
    E.currentNote.textContent=hover?E.scanNote.textContent:show?(S.mode==='parallel'&&active.length?`${new Set(active.map(e=>e.row)).size} ${segmented?'个声部':'行'}发声`:E.scanNote.textContent):'—';
    E.seek.max=end;E.seek.value=time;E.clock.textContent=`${fmt(time)} / ${fmt(end)}`;
    E.playIcon.textContent=S.playing?'Ⅱ':'▶';E.playText.textContent=S.audioLoading?'准备声音 · 点击取消':S.playing?'暂停演奏':time>=end-.02?'再次演奏':time>0?'继续演奏':'开始演奏';
    E.status.textContent=S.busy?'生成中':S.hoverLoading?'准备移动试听':hover?'移动试听':S.audioLoading?'准备声音':S.playing?(time>=S.payload.info.duration?'渐渐收尾':E.loopToggle.checked&&!S.clip?'循环演奏':'正在演奏'):time>=end-.02?(S.clip?'对照结束':'演奏结束'):time>0?'已暂停':'可以演奏';
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
    const segmented=segmentView();if(segmented)drawSegments();
    E.selectedTitle.textContent=segmented?`第 ${region.row+1} 声部 · 显著度第 ${region.salienceRank} 位 · ${note(region.midi)}`:`列 ${region.col+1} · 区域 ${region.row+1} · ${note(region.midi)}`;
    E.selectedReason.textContent=region.reason;
    E.selectedLocation.textContent=segmented?`重心 横向 ${(region.centroid.x*100).toFixed(1)}% · 纵向 ${(region.centroid.y*100).toFixed(1)}% · 面积 ${(region.features.area*100).toFixed(1)}%`:`图片横向 ${(region.rect.x*100).toFixed(1)}% · 纵向 ${(region.rect.y*100).toFixed(1)}%`;
    const f=region.features;
    E.selectedFeatures.textContent=S.mode!=='reference'?`色相 ${(f.hue*360).toFixed(0)}° · 饱和 ${(f.saturation*100).toFixed(0)}% · 亮度 ${f.brightness.toFixed(2)} · 对比 ${f.contrast.toFixed(2)} · 纹理 ${f.texture.toFixed(2)}${f.saliency!==undefined?` · 显著 ${f.saliency.toFixed(2)}`:''}${f.compactness!==undefined?` · 紧凑 ${f.compactness.toFixed(2)} · 实心 ${f.solidity.toFixed(2)} · 方向 ${f.angle.toFixed(0)}° · 伸展 ${f.elongation.toFixed(2)}`:''}`:`亮度 ${f.brightness.toFixed(2)} · 对比 ${f.contrast.toFixed(2)} · 重心 ${(f.centroid*100).toFixed(1)}%`;
    E.selectedPitch.textContent=`${note(region.targetMidi)} → ${note(region.midi)}`;
    const event=view().events.find(e=>e.id===region.eventId);
    E.selectedTime.textContent=event?`${event.start.toFixed(2)}–${(event.start+event.duration).toFixed(2)} 秒`:`${region.start.toFixed(2)}–${region.end.toFixed(2)} 秒 · 未起音`;
    E.timeline.querySelectorAll('.note').forEach(r=>r.classList.toggle('selected',r.dataset.event===region.eventId));
  }
  // Content-shaped regions: a label image (one region index per pixel) drawn on a canvas.
  const segmentView=()=>S.mode==='parallel'&&S.segment&&S.segment.source===view()?.segmentation?S.segment:null;
  function prepareSegments(seg){
    E.segments.hidden=!seg;E.regions.hidden=!!seg;
    if(!seg){S.segment=null;return;}
    if(S.segment?.source===seg)return;
    const raw=atob(seg.labels),labels=new Uint16Array(seg.width*seg.height);
    for(let i=0;i<labels.length;i++)labels[i]=raw.charCodeAt(2*i)|raw.charCodeAt(2*i+1)<<8;
    E.segments.width=seg.width;E.segments.height=seg.height;
    // Pixel outlines stay crisp when scaled up; smooth curves are drawn at screen resolution.
    E.segments.style.imageRendering=seg.outlines?'auto':'pixelated';
    S.segment={source:seg,width:seg.width,height:seg.height,labels,drawn:null};
  }
  // Softened outlines arrive as simplified rings (half pixels); Chaikin rounds them into curves.
  function chaikin(points,closed,passes=3){
    for(let pass=0;pass<passes;pass++){
      const out=closed?[]:[points[0]],n=points.length,last=closed?n:n-1;
      for(let k=0;k<last;k++){const a=points[k],b=points[(k+1)%n];out.push([.75*a[0]+.25*b[0],.75*a[1]+.25*b[1]],[.25*a[0]+.75*b[0],.25*a[1]+.75*b[1]]);}
      if(!closed)out.push(points[n-1]);points=out;
    }
    return points;
  }
  function outlinePaths(g,w,h){
    const sx=w/(2*g.width),sy=h/(2*g.height);
    const toPoints=flat=>{const p=[];for(let i=0;i<flat.length;i+=2)p.push([flat[i]*sx,flat[i+1]*sy]);return p;};
    const trace=(path,points,closed)=>{if(points.length<2)return;path.moveTo(points[0][0],points[0][1]);for(const q of points.slice(1))path.lineTo(q[0],q[1]);if(closed)path.closePath();};
    return g.source.outlines.map(rings=>{
      const fill=new Path2D(),stroke=new Path2D();
      for(const ring of rings){
        const closed=chaikin(toPoints(ring.p),true);trace(fill,closed,true);
        if(!ring.open)trace(stroke,closed,true);else for(const chain of ring.open)trace(stroke,chaikin(toPoints(chain),false),false);
      }
      return {fill,stroke};
    });
  }
  function drawOutlines(g,regions,activeIds){
    const box=E.segments.getBoundingClientRect(),dpr=window.devicePixelRatio||1;
    const w=Math.max(1,Math.round(box.width*dpr)),h=Math.max(1,Math.round(box.height*dpr));
    const key=[...activeIds].sort().join()+'|'+S.selected+'|'+w+'x'+h;if(g.drawn===key)return;g.drawn=key;
    if(E.segments.width!==w||E.segments.height!==h||!g.paths){E.segments.width=w;E.segments.height=h;g.paths=outlinePaths(g,w,h);}
    const c=E.segments.getContext('2d'),dim=activeIds.size>0,tint=(hex,a)=>`rgba(${[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)).join()},${a})`;
    c.clearRect(0,0,w,h);c.lineJoin=c.lineCap='round';
    if(dim){c.fillStyle='rgba(0,0,0,.32)';c.fillRect(0,0,w,h);}
    const lit=[];regions.forEach((r,i)=>{if(activeIds.has(r.id))lit.push(i);});
    for(const i of lit){c.save();c.globalCompositeOperation='destination-out';c.fill(g.paths[i].fill);c.restore();c.fillStyle=tint(rowColors[regions[i].row%4],.42);c.fill(g.paths[i].fill);}
    if(!activeIds.size&&regions[S.selected]){c.fillStyle='rgba(215,255,72,.18)';c.fill(g.paths[S.selected].fill);}
    c.strokeStyle=`rgba(255,255,255,${dim?.32:.58})`;c.lineWidth=1.1*dpr;
    regions.forEach((r,i)=>{if(!activeIds.has(r.id)&&i!==S.selected)c.stroke(g.paths[i].stroke);});
    c.lineWidth=2.4*dpr;
    if(regions[S.selected]&&!activeIds.has(regions[S.selected].id)){c.strokeStyle='#d7ff48';c.stroke(g.paths[S.selected].stroke);}
    for(const i of lit){c.strokeStyle=rowColors[regions[i].row%4];c.stroke(g.paths[i].stroke);}
  }
  function drawSegments(activeIds=S.segment?.activeIds||new Set()){
    const g=segmentView();if(!g)return;g.activeIds=activeIds;
    if(g.source.outlines)return drawOutlines(g,view().regions,activeIds);
    const regions=view().regions,key=[...activeIds].sort().join()+'|'+S.selected;
    if(g.drawn===key)return;g.drawn=key;
    const {width:w,height:h,labels}=g,image=new ImageData(w,h),d=image.data;
    // While regions sound, the silent ones dim so the sounding shapes stand out.
    const dim=activeIds.size>0,active=new Uint8Array(regions.length),colors=rowColors.map(c=>[1,3,5].map(i=>parseInt(c.slice(i,i+2),16)));
    regions.forEach((r,i)=>{if(activeIds.has(r.id))active[i]=1;});
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const p=y*w+x,l=labels[p],o=p*4;
      const edge=(x<w-1&&labels[p+1]!==l)||(y<h-1&&labels[p+w]!==l);
      if(active[l]){const c=colors[regions[l].row%4];d[o]=c[0];d[o+1]=c[1];d[o+2]=c[2];d[o+3]=edge?245:150;}
      else if(l===S.selected){d[o]=215;d[o+1]=255;d[o+2]=72;d[o+3]=edge?235:60;}
      else if(edge){d[o]=255;d[o+1]=255;d[o+2]=255;d[o+3]=dim?70:110;}
      else if(dim){d[o+3]=80;}
    }
    E.segments.getContext('2d').putImageData(image,0,0);
  }
  // With outlines taking part, show the traced edge of each sounding region and a dot on the current note.
  function traceContours(value,sounding){
    if(!value.segmentation?.contour){E.centroids.innerHTML='';return;}
    const w=S.payload.image.width,h=S.payload.image.height,key=sounding.map(e=>e.id).join();
    if(E.centroids.dataset.key===key)return;E.centroids.dataset.key=key;
    const byId=new Map(value.regions.map(r=>[r.id,r]));let svg='';
    for(const e of sounding){
      const r=byId.get(e.sources[0]?.regionId),color=rowColors[(e.row??0)%4];if(!r?.contour)continue;
      svg+=`<polyline points="${(r.contour.length>2?chaikin(r.contour,false,2):r.contour).map(([x,y])=>`${(x*w).toFixed(1)},${(y*h).toFixed(1)}`).join(' ')}" style="stroke:${color};stroke-width:${(w/192).toFixed(2)};opacity:.95"/>`;
      if(e.point)svg+=`<circle cx="${(e.point[0]*w).toFixed(1)}" cy="${(e.point[1]*h).toFixed(1)}" r="${(w/64).toFixed(1)}" style="fill:${color};stroke:#151b12;stroke-width:${(w/384).toFixed(2)}"/>`;
    }
    E.centroids.innerHTML=svg;
  }
  function segmentAt(event){
    const g=segmentView();if(!g)return null;
    const box=E.segments.getBoundingClientRect();
    const x=Math.floor((event.clientX-box.left)/box.width*g.width),y=Math.floor((event.clientY-box.top)/box.height*g.height);
    return x<0||y<0||x>=g.width||y>=g.height?null:g.labels[y*g.width+x];
  }
  function render() {
    const value=view(), info=S.payload.info, main=value.events.filter(e=>e.layer==='main');
    E.referenceMode.setAttribute('aria-pressed',S.mode==='reference');
    E.parallelMode.setAttribute('aria-pressed',S.mode==='parallel');E.parallelControls.hidden=S.mode!=='parallel';
    const seg=S.mode==='parallel'&&value.segmentation;
    E.mappingLabel.textContent=seg?`${seg.regionCount} 个区域 · ${seg.methodName} · ${seg.orderName}`:S.mode==='parallel'?`${value.rows} 行 × ${value.cols} 列 · 横向叠奏`:'参考原谱 · 原项目条带采样';
    prepareSegments(seg);
    E.key.textContent=`${(S.mode==='parallel'&&(value.arrangement||value.harmony)?.key)||info.key_name} · ${{'Major pentatonic':'大调五声','Minor pentatonic':'小调五声','Major':'大调','Natural minor':'自然小调','Dorian':'多利亚','Lydian':'利底亚'}[info.scale_name]||info.scale_name}`;
    E.tempo.textContent=`${info.tempo.toFixed(1)} BPM`;E.noteCount.textContent=`${value.mainCount} 个${pitchMappedView()?'音高片段':'音符'}`;E.duration.textContent=`${info.duration.toFixed(1)} 秒＋余韵`;
    E.mappingHint.textContent=seg?`${seg.orderHint}${seg.contour?' 轮廓参与：边缘起伏成旋律动机，圆润/尖锐决定连奏或断奏与音色，边缘软硬决定起音，斜向伸展滑音、内凹加倚音，被包围的区域由外层给出持续低音。':''} 当前 ${seg.methodName}，共 ${seg.regionCount} 个区域；区域越大音越长，伴奏由实际音符推出和声铺底。`:S.mode==='parallel'?`各行独立分析并从左到右同时演奏；${recipe().hint} 整体伴奏只保留一份。`:'直接运行 Photo Sonification 原始分析、编曲和音源；参考原谱未重新改写旋律。';
    E.regions.style.gridTemplateColumns=`repeat(${value.cols},1fr)`;E.regions.style.gridTemplateRows=`repeat(${value.rows},1fr)`;
    E.regions.classList.toggle('parallel',S.mode==='parallel');
    E.regions.innerHTML=seg?'':value.regions.map((r,i)=>`<button type="button" class="region" data-index="${i}" data-region="${r.id}" style="grid-column:${r.col+1};grid-row:${r.row+1};--voice-color:${rowColors[r.row%4]}" aria-label="列 ${r.col+1} 区域 ${r.row+1}，${note(r.midi)}" title="${note(r.midi)}"></button>`).join('');
    E.centroids.innerHTML='';if(E.centroids.dataset)E.centroids.dataset.key='';
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
    renderTracks();geometry();select(seg?Math.max(0,value.regions.findIndex(r=>r.salienceRank===1)):0);paint();
  }
  function renderTracks(){
    const p=S.payload?.variants.parallel;if(!p)return;
    const soft=recipe().profile==='soft'&&p.mixProfiles?.soft;
    E.recipeHint.textContent=recipe().hint;
    const arrangement=p.arrangement;
    const harmony=p.harmony;
    E.mixHint.textContent=harmony&&soft?`柔和合成混音 · ${soft.voices.join('、')}；和声铺底 ${harmony.progression.join(' → ')}（图片推动 ${harmony.harmonyChanges} 次换和弦），共用轻回声。`:arrangement?`编曲版 · ${arrangement.ensemble}（${arrangement.ensembleReason}）· 和弦 ${arrangement.progression.join(' → ')}（图片推动 ${arrangement.harmonyChanges} 次换和弦）；各声部按角色平衡音量，带混响，共用柔和铺底。`:soft?'柔和合成混音 · 暖键、柔拨弦、圆木琴与轻铃；整体伴奏退后，共用轻回声。':'原有叠加 · 各行使用参考音源自动选出的乐器，播放量化音阶，共用一份整体伴奏。';
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
    if(!S.image)return;invalidateHoverBank();S.loadAbort?.abort();stop(true);S.clip=null;S.busy=true;S.workStarted=performance.now();S.payload=null;S.loadAbort=new AbortController();controls();E.status.textContent='生成中';E.playText.textContent='正在生成乐谱…';E.connection.hidden=true;
    const operation=++S.loadOperation, image=S.image;
    try {
      await showInput(image,operation);if(operation!==S.loadOperation)return;
      const response=await request(API+'/api/generate',{method:'POST',controller:S.loadAbort,body:JSON.stringify({image:image.base64,options:{synth:E.tone.value,mapping:E.mappingStyle.value,backing:E.backing.checked,rowCount:Number(E.rowCount.value),rowMethod:recipe().method,segmentMethod:E.segmentMethod.value,segmentOrder:E.segmentOrder.value,contourMusic:E.contourToggle.checked,segmentSoft:E.softToggle.checked,pitchTransition:'scale',featureMethod:'features'}})});
      const payload=await response.json();if(!response.ok)throw new Error(payload.error||'生成失败');
      if(operation!==S.loadOperation)return;
      S.payload=payload;S.buffers.clear();S.mixMetrics.clear();S.time=0;E.connection.hidden=true;S.solo=null;
      const count=payload.variants.parallel?.rows??4;S.enabledRows=Array.from({length:count},()=>true);
      if(!payload.variants.parallel?.mixProfiles?.soft)throw new Error('乐谱数据不完整，请重新生成。');
      const photo=await new Promise((resolve,reject)=>{const p=new Image();p.onload=()=>resolve(p);p.onerror=()=>reject(new Error('图片显示失败'));p.src=payload.image.src;});
      if(operation!==S.loadOperation)return;
      S.previewSize=payload.image;E.picture.width=payload.image.width;E.picture.height=payload.image.height;E.picture.getContext('2d').drawImage(photo,0,0);
      E.workName.textContent=image.name;E.credit.textContent=image.credit||'你的图片 · 原项目按整张图分析，最长边 512 像素';
      S.busy=false;E.comparisonHint.textContent='同图、同速度，匹配响度；对比原谱与新旋律。';render();if(E.hoverToggle.checked)prepareHoverBank();
    }catch(error){if(operation!==S.loadOperation)return;S.busy=false;E.connection.hidden=false;E.connectionMessage.textContent=`${error.message} 可以点击“重新生成”；请检查静态文件夹是否完整。`;E.status.textContent='生成失败';E.playText.textContent='生成失败 · 请重试';controls();toast(error.message);}
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
  const hoverProfile=()=>S.mode==='parallel'?recipe().profile:'original';
  const hoverBankKey=()=>S.payload?.key+':'+S.mode+':'+hoverProfile();
  function clearHoverNotes(){clearTimeout(S.hoverTimer);S.hoverTimer=null;S.hoverPending=null;S.hoverAudible=false;}
  function clearHoverPointer(){clearHoverNotes();S.hoverIndex=null;S.hoverLastIndex=null;}
  function invalidateHoverBank(clearBank=true){
    S.hoverLoadId=(S.hoverLoadId||0)+1;S.hoverAbort?.abort();S.hoverAbort=null;S.hoverLoading=false;
    if(clearBank)S.hoverBank=null;clearHoverPointer();
  }
  async function prepareHoverBank(){
    if(!S.payload||!E.hoverToggle.checked||S.busy)return;
    const key=hoverBankKey();if(S.hoverBank?.key===key){await ctx();paint();return;}
    if(S.hoverLoading)return;
    const id=S.hoverLoadId=(S.hoverLoadId||0)+1,controller=new AbortController();
    S.hoverAbort=controller;S.hoverLoading=true;S.workStarted=performance.now();paint();
    try{
      await ctx();if(id!==S.hoverLoadId||!E.hoverToggle.checked)return;
      const response=await request(API+'/api/hover-bank',{method:'POST',controller,headers:{'Content-Type':'application/json'},body:JSON.stringify({key:S.payload.key,variant:S.mode,profile:hoverProfile()})});
      const metadata=await response.json();if(!response.ok)throw new Error(metadata.error||'移动试听音色准备失败');
      if(id!==S.hoverLoadId||key!==hoverBankKey()||!E.hoverToggle.checked)return;
      const data=await request(API+metadata.audioUrl,{controller});if(!data.ok)throw new Error('移动试听缓存已失效，请重新开启。');
      const audio=await S.context.decodeAudioData(await data.arrayBuffer());
      if(id!==S.hoverLoadId||key!==hoverBankKey()||!E.hoverToggle.checked)return;
      S.hoverBank={key,metadata,audio};
    }catch(error){if(id===S.hoverLoadId&&E.hoverToggle.checked)toast(error.message);}
    finally{if(id===S.hoverLoadId){S.hoverLoading=false;S.hoverAbort=null;paint();if(S.hoverBank?.key===key&&S.hoverPending!==null&&S.hoverPending!==undefined)scheduleHoverNote();}}
  }
  function scheduleHoverNote(){
    if(S.hoverTimer||!S.hoverBank||S.hoverBank.key!==hoverBankKey())return;
    const wait=Math.max(0,75-(performance.now()-(S.hoverLastPlayed||0)));
    S.hoverTimer=setTimeout(()=>{
      S.hoverTimer=null;const index=S.hoverPending;
      if(index===null||index===undefined||!E.hoverToggle.checked||S.busy||S.hoverBank?.key!==hoverBankKey())return;
      const region=view().regions[index],binding=S.hoverBank.metadata.events[region.eventId];
      if(!binding)return;
      const tone=S.hoverBank.metadata.tones[binding.tone],bank=S.hoverBank;
      stop();S.hoverIndex=index;S.hoverAudible=true;S.hoverLastPlayed=performance.now();
      startBuffer(bank.audio,tone.offset,tone.offset+tone.duration,binding.gain,++S.operation,true);paint();
    },wait);
  }
  function hoverRegion(index,force=false){
    if(!E.hoverToggle.checked||!S.payload||S.busy||!view().regions[index])return;
    if(!force&&S.hoverLastIndex===index)return;
    if(S.playing||S.audioLoading)stop();
    S.hoverLastIndex=index;S.hoverIndex=index;select(index);
    if(!view().regions[index].eventId){stop();paint();return;}
    S.hoverPending=index;paint();if(S.hoverBank?.key===hoverBankKey())scheduleHoverNote();
  }
  function leaveHover(){const sounding=S.hoverAudible;clearHoverPointer();if(sounding)stop();else paint();}
  function mode(value){invalidateHoverBank();stop(true);S.mode=value==='reference'?'reference':'parallel';S.clip=null;if(S.payload){render();if(E.hoverToggle.checked)prepareHoverBank();}else{E.parallelMode.setAttribute('aria-pressed',S.mode==='parallel');E.referenceMode.setAttribute('aria-pressed',S.mode==='reference');E.parallelControls.hidden=S.mode!=='parallel';}}
  async function preview(index) {
    clearHoverPointer();
    stop();select(index);const eventId=view().regions[index].eventId;
    if(!eventId)return toast('这里没有实际主旋律音符。');
    const operation=++S.operation;
    try {
      await ctx();const response=await request(API+'/api/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:S.payload.key,variant:S.mode,eventId,profile:recipe().profile})});
      if(!response.ok)throw new Error('试听暂时不可用');const audio=await S.context.decodeAudioData(await response.arrayBuffer());if(operation!==S.operation)return;
      startBuffer(audio,0,audio.duration,1,operation,true);
    }catch(error){toast(error.message);}
  }
  const paintings=window.PixelMusicPaintings||[];
  const entries=[...paintings,...window.PixelMusicStripSamples.entries,{id:'pitch',name:'音高转换验收 · 多特征渐变'},{id:'rows',name:'结构对照 · 四行线条'},{id:'turns',name:'结构对照 · 上下线条'},{id:'hue',name:'验收 · 等亮横向色带'},{id:'texture',name:'验收 · 同明暗纹理变化'}];
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
    if(entry.data) {
      S.image={base64:entry.data.split(',')[1],name:entry.name.replace(/^名画 · /,''),credit:entry.credit};
    } else if(entry.path) {
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
  E.loopToggle.addEventListener('change',paint);
  E.retry.addEventListener('click',generate);
  E.cancelWork.addEventListener('click',()=>{if(S.busy){S.loadOperation++;S.loadAbort?.abort();S.busy=false;E.status.textContent='已取消';E.playText.textContent='已取消 · 可重新生成';E.connectionMessage.textContent='已取消生成，可以更换图片或重新生成。';E.connection.hidden=false;controls();}else if(S.hoverLoading){E.hoverToggle.checked=false;invalidateHoverBank(false);stop();}else stop();});
  E.referenceMode.addEventListener('click',()=>mode('reference'));E.parallelMode.addEventListener('click',()=>mode('parallel'));
  E.abParallel.addEventListener('click',()=>{mode('parallel');play(true);});E.abReference.addEventListener('click',()=>{mode('reference');play(true);});
  E.rowCount.addEventListener('change',generate);E.segmentMethod.addEventListener('change',generate);E.segmentOrder.addEventListener('change',generate);E.contourToggle.addEventListener('change',generate);E.softToggle.addEventListener('change',generate);
  E.recipe.addEventListener('change',()=>{if(!RECIPES.some(r=>r.id===E.recipe.value))E.recipe.value=RECIPES[0].id;mode('parallel');generate();});
  window.addEventListener('hashchange',()=>{const next=RECIPES.find(r=>'#'+r.id===location.hash);if(next&&next.id!==recipe().id){E.recipe.value=next.id;mode('parallel');generate();}else mode(location.hash==='#reference'?'reference':'parallel');});
  E.rowTracks.addEventListener('change',event=>{if(event.target.matches('[data-row-toggle]'))changeMixer(Number(event.target.dataset.rowToggle),false,event.target.checked);});
  E.rowTracks.addEventListener('click',event=>{const button=event.target.closest('[data-row-solo]');if(button)changeMixer(Number(button.dataset.rowSolo),true);});
  let resumeSeek=false;
  E.seek.addEventListener('pointerdown',()=>{resumeSeek=S.playing;stop();});
  E.seek.addEventListener('input',()=>{const next=Number(E.seek.value);if(S.playing)resumeSeek=true;stop();S.time=next;paint();});
  E.seek.addEventListener('change',()=>{if(resumeSeek)play();resumeSeek=false;});
  E.hoverToggle.addEventListener('change',()=>{if(E.hoverToggle.checked){clearHoverPointer();stop();prepareHoverBank();}else{invalidateHoverBank(false);stop();}});
  E.imageStage.addEventListener('pointermove',event=>{if(event.pointerType!=='mouse'||event.buttons)return;if(event.target===E.segments){const index=segmentAt(event);if(index!==null)hoverRegion(index);return;}const button=event.target.closest('button[data-index]');if(button)hoverRegion(Number(button.dataset.index));});
  E.segments.addEventListener('click',event=>{const index=segmentAt(event);if(index===null)return;if(E.hoverToggle.checked&&event.pointerType!=='touch'&&S.stagePointerType!=='touch'){if(event.detail===0)hoverRegion(index,true);}else preview(index);});
  E.imageStage.addEventListener('pointerdown',event=>{S.stagePointerType=event.pointerType;});
  E.imageStage.addEventListener('pointerleave',leaveHover);
  E.imageStage.addEventListener('pointercancel',leaveHover);
  E.regions.addEventListener('click',event=>{const button=event.target.closest('button');if(button){if(E.hoverToggle.checked&&event.pointerType!=='touch'&&S.stagePointerType!=='touch'){if(event.detail===0)hoverRegion(Number(button.dataset.index),true);}else preview(Number(button.dataset.index));}});
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
  E.musicArt.addEventListener('click',event=>{
    if(!S.payload||S.busy){event.preventDefault();toast('乐谱生成完成后即可送入绘画工作台。');return;}
    try{
      const score=window.MusicArtCore.fromPerformance(S.payload,{mode:S.mode,profile:recipe().profile,rows:S.enabledRows,backing:S.mode==='parallel'?includeRowBackground():E.backing.checked,title:E.workName.textContent+' / '+(S.mode==='parallel'?recipe().name:'参考原谱')});
      const raw=JSON.stringify(score);
      try{localStorage.setItem(window.MusicArtCore.STORAGE_KEY,raw);}catch(_){}
      E.musicArt.href='./music-art.html#score='+encodeURIComponent(raw);stop();
    }catch(error){event.preventDefault();toast('乐曲送入失败：'+error.message);}
  });
  for(const type of ['dragenter','dragover'])E.imageStage.addEventListener(type,event=>{event.preventDefault();E.dropHint.hidden=false;});
  E.imageStage.addEventListener('dragleave',()=>E.dropHint.hidden=true);E.imageStage.addEventListener('drop',event=>{event.preventDefault();E.dropHint.hidden=true;upload(event.dataTransfer.files[0]);});
  window.addEventListener('resize',()=>{geometry();if(segmentView())drawSegments();});window.addEventListener('pagehide',()=>{invalidateHoverBank();S.loadOperation++;S.loadAbort?.abort();S.busy=false;stop();S.context?.close();});
  window.PixelMusicFeaturesDemo={snapshot:()=>({mode:S.mode,recipe:recipe().id,mixProfile:recipe().profile,rowMethod:recipe().method,playing:S.playing,busy:S.busy,audioLoading:!!S.audioLoading,loopEnabled:!!E.loopToggle.checked,hoverEnabled:E.hoverToggle.checked,hoverLoading:!!S.hoverLoading,hoverRegion:S.hoverIndex,hoverAudible:!!S.hoverAudible,time:current(),sample:S.sample,selected:S.selected,recipes:RECIPES.map(r=>({id:r.id,method:r.method,profile:r.profile,name:r.name})),comparison:S.comparison,enabledRows:S.enabledRows.slice(),solo:S.solo}),payload:()=>S.payload};
  controls();mode(S.mode);sample(paintings.length?paintings[0].id:S.mode==='parallel'?'pitch':'sunset');
})();
