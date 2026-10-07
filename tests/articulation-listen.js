'use strict';
const $=id=>document.getElementById(id),Music=window.PixelMusic,ImageAnalysis=window.PixelMusicImage,Audio=window.PixelMusicAudio,Fixtures=window.PixelMusicFidelityFixtures;
let busy=false,urls=[];
for(const id of ['imageA','imageB'])$(id).innerHTML=Fixtures.names.map((name,i)=>`<option value="${i}">${i+1}. ${name}</option>`).join('');
$('imageA').value='60';$('imageB').value='5';
function score(index,style){return Music.compose(ImageAnalysis.analyzePixels(Fixtures.pixels(index)),{performanceStyle:style});}
function clear(){ $('cards').querySelectorAll('audio').forEach(a=>a.pause());urls.forEach(u=>URL.revokeObjectURL(u));urls=[];$('cards').replaceChildren(); }
function draw(){clear();for(const letter of ['A','B'])$(`canvas${letter}`).getContext('2d').putImageData(new ImageData(Fixtures.pixels(Number($(`image${letter}`).value)),192,120),0,0);}
draw();for(const id of ['imageA','imageB'])$(id).addEventListener('change',draw);for(const id of ['tone','length'])$(id).addEventListener('change',clear);
function setBusy(value){busy=value;for(const id of ['imageA','imageB','tone','length','render','inspect','snapshots','regression','sampleData'])$(id).disabled=value;}
const styleName=style=>style==='sparse'?'轻奏留白':'连续声景';
$('render').addEventListener('click',async()=>{
  if(busy)return;setBusy(true);clear();try{
    const output=[];for(const letter of ['A','B'])for(const style of ['continuous','sparse']){
      const index=Number($(`image${letter}`).value),s=score(index,style),buffer=await Audio.renderOffline(s,{tone:$('tone').value});
      $('progress').textContent=`本机渲染 ${output.length+1}/4…`;const seconds=$('length').value==='full'?buffer.duration:16,count=Math.min(buffer.length,Math.round(seconds*buffer.sampleRate)),fade=seconds<buffer.duration?.03:0,samples=buffer.getChannelData(0);let energy=0,peak=0;
      for(let i=0;i<count;i++){const w=fade?Math.min(1,Math.max(0,(count-1-i)/Math.round(fade*buffer.sampleRate))):1,value=samples[i]*w;energy+=value**2;peak=Math.max(peak,Math.abs(value));}
      output.push({letter,index,style,s,buffer,seconds,fade,rms:Math.sqrt(energy/count),peak});
    }
    const target=Math.min(...output.map(v=>v.rms));$('cards').innerHTML=output.map(v=>{const gain=Math.min(target/Math.max(.0001,v.rms),.85/Math.max(.0001,v.peak)),url=URL.createObjectURL(new Blob([Audio.wavBytes(v.buffer,gain,v.seconds,{fadeOutSeconds:v.fade})],{type:'audio/wav'}));urls.push(url);return`<article><h3>${v.letter} · ${Fixtures.names[v.index]} · ${styleName(v.style)}</h3><audio controls src="${url}" aria-label="${v.letter} ${styleName(v.style)}"></audio><p>${v.s.melody.length} 图像片段 · ${v.s.performanceEvents.length} 次起音 · ${v.s.bpm} BPM</p><a href="${url}" download="PixelMusic-${v.s.version}-${v.style}-${v.index}.wav">保存 WAV</a></article>`;}).join('');
    $('cards').querySelectorAll('audio').forEach(a=>a.addEventListener('play',()=>$('cards').querySelectorAll('audio').forEach(other=>{if(other!==a)other.pause();})));
    $('progress').textContent='四段已生成；同图同速度，短片段淡出后的 RMS 已匹配。';
  }catch(error){$('progress').textContent=`生成失败：${error.message}`;}finally{setBusy(false);}
});
$('inspect').addEventListener('click',()=>{const s=score(Number($('imageA').value),'sparse');$('mapping').textContent=JSON.stringify({imageSegments:s.melody.length,actualAttacks:s.performanceEvents.length,imageRhythmFingerprint:s.imageRhythmFingerprint,actualRhythmFingerprint:s.rhythmFingerprint,decisions:s.diagnostics.performanceDecisions,events:s.performanceEvents,performanceSpaces:s.performanceRests,regions:s.regionMap},null,2);});
$('snapshots').addEventListener('click',()=>{const entries=Fixtures.names.flatMap((name,index)=>['sparse','continuous'].map(style=>{const s=score(index,style);return{index,name,style,imageHash:s.hash,scoreHash:s.scoreHash,mappingFingerprint:s.mappingFingerprint,imageRhythmFingerprint:s.imageRhythmFingerprint,rhythmFingerprint:s.rhythmFingerprint,attacks:s.performanceEvents.length};}));$('snapshotReport').textContent=JSON.stringify({status:'complete',version:'0.6.1',entries},null,2);});
function rmsWindow(buffer,start,end){const samples=buffer.getChannelData(0),a=Math.max(0,Math.round(start*buffer.sampleRate)),b=Math.min(samples.length,Math.round(end*buffer.sampleRate));let energy=0;for(let i=a;i<b;i++)energy+=samples[i]**2;return Math.sqrt(energy/Math.max(1,b-a));}
function checkSparse(buffer,s){
  if(s.performanceEvents.length<2||s.melody.length!==1||s.performanceEvents[0].envelope!=='pluck')return null;
  const e=s.performanceEvents[0],next=s.performanceEvents[1],start=.05+Music.beatToTime(s,e.beat),end=.05+Music.beatToTime(s,e.beat+e.durationBeats),nextStart=.05+Music.beatToTime(s,next.beat);
  const early=rmsWindow(buffer,start+.04,start+.12),late=rmsWindow(buffer,start+(end-start)*.70,start+(end-start)*.85),quiet=rmsWindow(buffer,end+.35,nextStart-.15);
  return{earlyRms:early,lateRms:late,quietRms:quiet,decayRatio:late/early,quietRatio:quiet/early,passed:early>.003&&late/early<.45&&quiet/early<.03};
}
$('regression').addEventListener('click',async()=>{
  if(busy)return;setBusy(true);const data={version:'0.6.1',status:'running',createdAt:new Date().toISOString(),environment:navigator.userAgent,expected:288,cases:[],scores:[],listening:'not-assessed'};$('report').textContent=JSON.stringify({status:'running',completed:0,total:288});
  try{for(let index=0;index<84;index++)for(const style of ['sparse',...([60,61,64,67,68,69,5,74,77,9,81,83].includes(index)?['continuous']:[])]){
    const s=score(index,style);data.scores.push({index,style,scoreHash:s.scoreHash,attacks:s.performanceEvents.length});
    for(const tone of ['warm','glass','mist']){const buffer=await Audio.renderOffline(s,{tone}),metrics=Audio.inspectBuffer(buffer),sparse=style==='sparse'?checkSparse(buffer,s):null,header=new DataView(Audio.wavBytes(buffer));
      const passed=metrics.invalid===0&&metrics.clipped===0&&metrics.peak<.9&&metrics.rms>.003&&metrics.tailPeak<.001&&header.getUint32(40,true)===buffer.length*2&&(!sparse||sparse.passed);
      data.cases.push({index,name:Fixtures.names[index],style,tone,attacks:s.performanceEvents.length,...metrics,sparse,passed});$('report').textContent=JSON.stringify({status:'running',completed:data.cases.length,total:288,last:data.cases.at(-1)},null,2);
    }
  }data.status=data.cases.length===288&&data.cases.every(c=>c.passed)?'passed':'failed';}catch(error){data.status='error';data.error=error.message;}finally{$('report').textContent=JSON.stringify(data,null,2);setBusy(false);}
});
$('sampleData').addEventListener('click',async()=>{if(busy)return;setBusy(true);try{const data=[];for(const style of ['sparse','continuous']){const s=score(60,style),buffer=await Audio.renderOffline(s,{tone:'warm'}),bytes=new Uint8Array(Audio.wavBytes(buffer,1,16,{fadeOutSeconds:.03}));let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);data.push({style,filename:`pixelmusic-0.6.1-white-${style}-warm-16s.wav`,base64:btoa(binary)});}$('sampleReport').textContent=JSON.stringify({status:'complete',files:data});}catch(error){$('sampleReport').textContent=JSON.stringify({status:'error',error:error.message});}finally{setBusy(false);}});
window.addEventListener('pagehide',clear);
