'use strict';
const $=id=>document.getElementById(id),Music=window.PixelMusicV06,Analysis=window.PixelMusicImageV06,Audio=window.PixelMusicAudioV06;
const OldMusic=window.PixelMusicV05,OldAnalysis=window.PixelMusicImageV05,OldAudio=window.PixelMusicAudioV05,Samples=window.PixelMusicFidelityFixtures;
let busy=false,urls=[],reportData=null;
for(const id of ['imageA','imageB'])$(id).innerHTML=Samples.names.map((name,i)=>`<option value="${i}">${i+1}. ${name}</option>`).join('');
$('imageA').value='60';$('imageB').value='74';
function variant(index,old,mode='complete'){
  const composer=old?OldMusic:Music,analyzer=old?OldAnalysis:Analysis;
  let score=composer.compose(analyzer.analyzePixels(Samples.pixels(index)),mode==='complete'?{}:{bpm:88,tempo:false});
  if(mode==='rhythm')score={...score,melody:score.melody.map(n=>({...n,midi:60,velocity:.12,send:0})),bassEvents:[],padEvents:[],bars:[]};
  return{score,engine:old?OldAudio:Audio,index,version:old?'0.5':'0.6',mode};
}
function clearAudio(){ $('cards').querySelectorAll('audio').forEach(a=>a.pause());urls.forEach(u=>URL.revokeObjectURL(u));urls=[];$('cards').replaceChildren(); }
function draw(){clearAudio();for(const letter of ['A','B']){const index=Number($(`image${letter}`).value),{score}=variant(index,false);$(`canvas${letter}`).getContext('2d').putImageData(new ImageData(Samples.pixels(index),192,120),0,0);$(`stats${letter}`).textContent=`120 区域 · ${score.melody.length} 次起音 · ${score.diagnostics.uniquePitchCount} 个音高 · ${score.bpm} BPM`;}}
for(const id of ['imageA','imageB'])$(id).addEventListener('change',draw);
for(const id of ['tone','length','comparisonMode'])$(id).addEventListener('change',clearAudio);
function setBusy(value){busy=value;for(const id of ['imageA','imageB','tone','length','comparisonMode','renderComparison','runRegression','checkScores','inspectMapping','checkDecode'])$(id).disabled=value;}
draw();
$('renderComparison').addEventListener('click',async()=>{
  if(busy)return;setBusy(true);clearAudio();
  try{
    const variants=['A','B'].flatMap(letter=>[true,false].map(old=>({...variant(Number($(`image${letter}`).value),old,$('comparisonMode').value),letter}))),rendered=[];
    for(const v of variants){$('progress').textContent=`本机渲染 ${rendered.length+1} / 4…`;const buffer=await v.engine.renderOffline(v.score,{tone:$('tone').value}),seconds=$('length').value==='full'?buffer.duration:16,fadeOutSeconds=seconds<buffer.duration?.03:0,source=buffer.getChannelData(0),count=Math.min(source.length,Math.round(seconds*buffer.sampleRate));let energy=0,peak=0;for(let i=0;i<count;i++){const fade=fadeOutSeconds?Math.min(1,Math.max(0,(count-1-i)/Math.round(fadeOutSeconds*buffer.sampleRate))):1,value=source[i]*fade;energy+=value**2;peak=Math.max(peak,Math.abs(value));}rendered.push({...v,buffer,seconds,fadeOutSeconds,rms:Math.sqrt(energy/count),peak});}
    const target=Math.min(...rendered.map(v=>v.rms));
    $('cards').innerHTML=rendered.map(v=>{const gain=Math.min(target/Math.max(.0001,v.rms),.85/Math.max(.0001,v.peak)),url=URL.createObjectURL(new Blob([Audio.wavBytes(v.buffer,gain,v.seconds,{fadeOutSeconds:v.fadeOutSeconds})],{type:'audio/wav'}));urls.push(url);return`<article><h3>${v.letter} · ${Samples.names[v.index]} · ${v.version}</h3><audio controls src="${url}" aria-label="${v.letter} ${v.version}"></audio><p>${v.score.melody.length} 次起音 · ${v.score.bpm} BPM</p><a href="${url}" download="PixelMusic-${v.version}-${v.index}.wav">保存 WAV</a></article>`;}).join('');
    $('cards').querySelectorAll('audio').forEach(a=>a.addEventListener('play',()=>$('cards').querySelectorAll('audio').forEach(other=>{if(other!==a)other.pause();})));
    $('progress').textContent='四段已生成并匹配片段 RMS；新版长音没有被切回 120 次起音。';
  }catch(error){$('progress').textContent=`渲染失败：${error.message}`;}finally{setBusy(false);}
});
$('inspectMapping').addEventListener('click',()=>{const {score}=variant(Number($('imageA').value),false);$('mappingReport').textContent=JSON.stringify({version:score.version,onsets:score.melody.length,complexity:score.rhythmProfile.complexity,events:score.melody,regions:score.regionMap,diagnostics:score.diagnostics},null,2);});
$('checkScores').addEventListener('click',()=>{const scores=Samples.names.map((name,index)=>{const {score}=variant(index,false);return{index,name,imageHash:score.hash,scoreHash:score.scoreHash,mappingFingerprint:score.mappingFingerprint,rhythmFingerprint:score.rhythmFingerprint,onsets:score.melody.length};});$('scoreReport').textContent=JSON.stringify({status:'complete',version:'0.6.0',imageBundleHash:Music.digestText(JSON.stringify(scores.map(s=>s.imageHash))),scores},null,2);});
function plateau(buffer){const source=buffer.getChannelData(0),rms=[];for(const second of [2,8,16,24,32]){let energy=0,count=0;for(let i=Math.round(second*buffer.sampleRate);i<Math.min(source.length,Math.round((second+.5)*buffer.sampleRate));i++){energy+=source[i]**2;count++;}rms.push(Math.sqrt(energy/count));}return{windowRms:rms,maxMinRatio:Math.max(...rms)/Math.min(...rms)};}
$('runRegression').addEventListener('click',async()=>{
  if(busy)return;setBusy(true);$('saveReport').disabled=true;
  reportData={version:'0.6.0',status:'running',createdAt:new Date().toISOString(),environment:navigator.userAgent,cases:[],scores:[],listening:'not-assessed',expectedCases:324};
  $('report').textContent=JSON.stringify({status:'running',completed:0,total:324});
  try{
    for(let index=0;index<Samples.names.length;index++){
      const current=variant(index,false);reportData.scores.push({index,name:Samples.names[index],imageHash:current.score.hash,scoreHash:current.score.scoreHash,rhythmFingerprint:current.score.rhythmFingerprint,mappingFingerprint:current.score.mappingFingerprint,onsets:current.score.melody.length});
      const variants=[current,...(index<12?[variant(index,true)]:[]),...([60,74,77,81,5,76].includes(index)?[variant(index,false,'rhythm'),variant(index,true,'rhythm')]:[])];
      for(const v of variants)for(const tone of ['warm','glass','mist']){
        const buffer=await v.engine.renderOffline(v.score,{tone}),metrics=Audio.inspectBuffer(buffer),header=new DataView(Audio.wavBytes(buffer));
        const steady=v.version==='0.6'&&v.score.melody.length===1&&v.score.bassEvents.length===0?plateau(buffer):null;
        const passed=metrics.invalid===0&&metrics.clipped===0&&metrics.peak<.9&&metrics.rms>.003&&metrics.tailPeak<.001&&header.getUint32(40,true)===buffer.length*2&&(!steady||steady.maxMinRatio<1.15);
        reportData.cases.push({index,name:Samples.names[index],version:v.version,mode:v.mode,tone,onsets:v.score.melody.length,...metrics,steady,passed});
        $('report').textContent=JSON.stringify({status:'running',completed:reportData.cases.length,total:324,last:reportData.cases.at(-1)},null,2);
      }
    }
    reportData.status=reportData.cases.length===324&&reportData.cases.every(c=>c.passed)?'passed':'failed';
  }catch(error){reportData.status='error';reportData.error=error.message;}finally{$('report').textContent=JSON.stringify(reportData,null,2);$('saveReport').disabled=false;setBusy(false);}
});
$('saveReport').addEventListener('click',()=>{if(!reportData)return;const url=URL.createObjectURL(new Blob([JSON.stringify(reportData,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='pixelmusic-0.6-audio-regression.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),3000);});
$('checkDecode').addEventListener('click',async()=>{
  if(busy)return;setBusy(true);const results=[];$('decodeReport').textContent='正在本机解码与渲染…';
  try{
    for(const sampleIndex of [60,5])for(const format of ['png','jpg','webp']){
      const golden=variant(sampleIndex,false).score,input=document.createElement('canvas');input.width=192;input.height=120;
      input.getContext('2d').putImageData(new ImageData(Samples.pixels(sampleIndex),192,120),0,0);
      const mimeType=format==='jpg'?'image/jpeg':`image/${format}`;
      const blob=await new Promise(resolve=>input.toBlob(resolve,mimeType,.90));
      if(!blob||blob.type!==mimeType)throw new Error(`${format} 编码器未返回指定格式`);
      const bytes=new Uint8Array(await blob.arrayBuffer());
      const magicVerified=format==='png'?bytes.slice(0,8).join() === '137,80,78,71,13,10,26,10':format==='jpg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP';
      if(!magicVerified)throw new Error(`${format} 文件头校验失败`);
      const url=URL.createObjectURL(blob),image=new Image();
      try{await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error(`${format} 解码失败`));image.src=url;});}finally{URL.revokeObjectURL(url);}
      const canvas=Analysis.normalizeSource(image),score=Music.compose(Analysis.analyzePixels(canvas.getContext('2d').getImageData(0,0,192,120).data));
      const tones=[];for(const tone of ['warm','glass','mist']){const buffer=await Audio.renderOffline(score,{tone}),metrics=Audio.inspectBuffer(buffer),steady=sampleIndex===60?plateau(buffer):null;tones.push({tone,...metrics,steady,passed:metrics.invalid===0&&metrics.clipped===0&&metrics.peak<.9&&metrics.rms>.003&&metrics.tailPeak<.001&&(!steady||steady.maxMinRatio<1.15)});}
      const passed=score.regionMap.length===120&&score.melody.length>=1&&score.melody.length<=120&&tones.every(t=>t.passed)&&(format!=='png'||score.scoreHash===golden.scoreHash)&&(sampleIndex!==60||score.melody.length===1);
      results.push({sampleIndex,sampleName:Samples.names[sampleIndex],format,mimeType,byteLength:bytes.length,magicVerified,width:image.width,height:image.height,imageHash:score.hash,scoreHash:score.scoreHash,onsets:score.melody.length,tones,passed});
    }
    $('decodeReport').textContent=JSON.stringify({status:results.every(r=>r.passed)?'passed':'failed',normalizer:'production ImageAnalysis.normalizeSource',results},null,2);
  }catch(error){$('decodeReport').textContent=JSON.stringify({status:'error',error:error.message,results},null,2);}finally{setBusy(false);}
});
window.addEventListener('pagehide',clearAudio);
