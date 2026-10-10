'use strict';
const Music = window.PixelMusic, ImageAnalysis = window.PixelMusicImage, Audio = window.PixelMusicAudio, Expression = window.PixelMusicExpression, Legato = window.PixelMusicLegato;
const STEPS = 24, REGION_ROWS = 5;
const SCALE_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const els = Object.fromEntries(Object.entries({
  file: 'fileInput', canvas: 'imageCanvas', dropZone: 'dropZone', empty: 'emptyState', scanLine: 'scanLine',
  regionGrid: 'regionGrid', noteRail: 'noteRail', stageLabel: 'stageLabel', stepLabel: 'stepLabel',
  title: 'workTitle', status: 'statusPill', key: 'keyMetric', tempo: 'tempoMetric', color: 'colorMetric',
  texture: 'textureMetric', fingerprint: 'fingerprintValue', scoreHash: 'scoreHashValue', rhythmHash: 'rhythmHashValue', mappingHash: 'mappingHashValue', export: 'exportButton',
  phraseTracker: 'phraseTracker', phraseLabel: 'phraseLabel', uploadLabel: 'uploadLabel',
  play: 'playButton', playLabel: 'playLabel', sample: 'sampleButton', whiteSample: 'whiteSampleButton', gradientSample: 'gradientSampleButton', expressionHint: 'expressionHint', abOriginal: 'abOriginalButton', abExpression: 'abExpressionButton', abFlow: 'abFlowButton', toast: 'toast',
}).map(([key, id]) => [key, document.getElementById(id)]));
let audioContext, audioSession, composition = null, canonicalImage = null, displaySource = null, currentAnalysis = null;
let isPlaying = false, animationId = 0, playbackStart = 0, playbackToken = 0, loadToken = 0, previewTimer = 0;
let regionCells = [], noteBars = [], lastActive = -1, lastPhrase = -1;
const comparisonProbes=new Map();

function drawDisplay() {
  if (!canonicalImage) return;
  const rect = els.dropZone.getBoundingClientRect(), ratio = Math.min(window.devicePixelRatio || 1, 2);
  els.canvas.width = Math.max(480, Math.round(rect.width * ratio));
  els.canvas.height = Math.max(360, Math.round(rect.height * ratio));
  // Same source crop as analysis, but retain original resolution for a crisp preview.
  const width = Math.min(displaySource.width, displaySource.height * 1.6), height = width / 1.6;
  els.canvas.getContext('2d').drawImage(displaySource, (displaySource.width - width) / 2, (displaySource.height - height) / 2, width, height, 0, 0, els.canvas.width, els.canvas.height);
}
function normalizeSource(source) {
  return ImageAnalysis.normalizeSource(source);
}
function analyzeSource(source, name) {
  const canonical = normalizeSource(source);
  const data = canonical.getContext('2d').getImageData(0, 0, canonical.width, canonical.height).data;
  currentAnalysis=ImageAnalysis.analyzePixels(data);
  comparisonProbes.clear();
  const score = composeCurrent(); score.name = name;
  canonicalImage = canonical; displaySource = source; composition = score;
  drawDisplay(); renderComposition();
}
function createSample() {
  const source = document.createElement('canvas'); source.width = 1200; source.height = 820;
  const ctx = source.getContext('2d'), sky = ctx.createLinearGradient(0, 0, 0, source.height);
  sky.addColorStop(0, '#224f68'); sky.addColorStop(.48, '#ea6c4d'); sky.addColorStop(1, '#201923');
  ctx.fillStyle = sky; ctx.fillRect(0, 0, source.width, source.height);
  ctx.fillStyle = '#ffd66d'; ctx.beginPath(); ctx.arc(840, 290, 115, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(32,25,35,.72)';
  for (let x = -120; x < 1300; x += 150) {
    const height = 130 + ((x * 17) % 180 + 180) % 180; ctx.fillRect(x, source.height - height, 118, height);
  }
  ctx.strokeStyle = 'rgba(255,235,180,.32)'; ctx.lineWidth = 9;
  for (let i = 0; i < 7; i++) {
    ctx.beginPath(); ctx.moveTo(0, 520 + i * 33); ctx.bezierCurveTo(280, 470 + i * 24, 570, 650 - i * 10, 1200, 540 + i * 31); ctx.stroke();
  }
  return source;
}
function renderComposition() {
  const c = composition;
  els.title.textContent = c.name.replace(/\.[^.]+$/, '').slice(0, 20) || '未命名图像';
  els.status.textContent = '可以演奏'; els.status.className = 'status-pill ready';
  els.key.textContent = `${SCALE_NAMES[c.root]} · ${c.mode.name}`; els.tempo.textContent = `${c.bpm} BPM${c.tempoMap.some(s => s.slope !== 0) ? ' · 随图变化' : ' · 稳定'}`;
  els.color.textContent = c.avgS > .5 ? '浓郁' : c.avgS > .27 ? '柔和' : '低饱和';
  els.texture.textContent = c.edgeRatio > .12 ? '繁复' : c.edgeRatio > .065 ? '适中' : '平静';
  els.fingerprint.textContent = c.hash.slice(0, 16).toUpperCase().match(/.{1,4}/g).join(' ');
  els.scoreHash.textContent = `${c.version} · ${c.scoreHash.toUpperCase().match(/.{1,4}/g).join(' ')}`;
  els.rhythmHash.textContent = c.rhythmFingerprint.toUpperCase().match(/.{1,4}/g).join(' ');
  els.mappingHash.textContent = c.mappingFingerprint.toUpperCase().match(/.{1,4}/g).join(' ');
  els.export.disabled = false;
  const flow=c.rendererVersion===Legato.VERSION;
  els.stageLabel.textContent = flow ? `120 区域 · 1 次连绵起音 · ${c.diagnostics.legato.pitchChanges} 次换音 · ${Math.round(c.duration)} 秒` : `120 区域 · ${c.performanceEvents.length} 次起音 · ${Math.round(c.duration)} 秒`;
  const expression=c.diagnostics.pixelExpression;
  els.expressionHint.textContent = flow ? `简化连绵：只用像素主音，${c.diagnostics.legato.singleBridges} 个单中转音，不叠加v2回绕；持续滑接，旧留白不再断声。纯色是一条稳定长音。` : expression ? `v2：${expression.phraseCount} 个颜色短句，增加 ${expression.addedNotes} 音；第 ${expression.firstChangedSeconds.toFixed(1)} 秒开始改变奏法${expression.firstConnectorSeconds===null?'':`，第 ${expression.firstConnectorSeconds.toFixed(1)} 秒出现连接音`}。主音来自像素，区域点击试听原音。` : currentExpressionMode()==='on' ? 'v2已载入：这张图没有可组织的音高升降，保留原曲；纯色不补旋律。' : '原始像素映射，未加入短句组织。';
  els.abOriginal.disabled=false;els.abExpression.disabled=false;els.abFlow.disabled=false;syncStyleControls();
  els.phraseLabel.textContent = flow ? '主旋律全段连绵，区域点击仍试听原像素音' : c.melody.length === 1 ? c.performanceStyle==='sparse'?'图像稳定，轻奏同音，间隔留白':'图像稳定，连续声景' : '图像决定音高与结构，稳定长段采用轻奏留白';
  els.uploadLabel.textContent = '更换图片'; els.play.disabled = false;
  els.empty.classList.add('hidden'); els.dropZone.classList.add('has-image');
  els.dropZone.classList.toggle('light-image', c.avgL > .72);
  els.noteRail.innerHTML = c.columns.map((column, i) => {
    const average = column.notes.reduce((sum, note) => sum + note.midi, 0) / REGION_ROWS;
    return `<i class="note-bar" data-step="${i}" style="height:${Math.max(8, Math.min(48, 10 + (average - 56) * 2))}px"></i>`;
  }).join('');
  els.regionGrid.innerHTML = c.columns.flatMap((column, col) => column.notes.map((note, row) =>
    `<button class="region-cell" type="button" style="grid-column:${col + 1};grid-row:${row + 1}" data-col="${col}" data-row="${row}" data-sequence="${note.sequence}" data-note="${note.noteName}" aria-label="第 ${col + 1} 列第 ${row + 1} 区域，音符 ${note.noteName}"></button>`
  )).join('');
  regionCells = [...els.regionGrid.querySelectorAll('.region-cell')]; noteBars = [...els.noteRail.children];
  lastActive = -1; lastPhrase = -1;
}
async function getAudioContext() {
  const Constructor = window.AudioContext || window.webkitAudioContext;
  if (!Constructor) throw new Error('当前浏览器不支持声音合成');
  audioContext ||= new Constructor();
  if (audioContext.state === 'suspended') await audioContext.resume();
  return audioContext;
}
function currentTone() { return document.querySelector('input[name="tone"]:checked').value; }
function currentPerformanceStyle() { return document.querySelector('input[name="performanceStyle"]:checked').value; }
function currentExpressionMode() { return document.querySelector('input[name="pixelExpression"]:checked').value; }
function syncStyleControls(){document.querySelectorAll('input[name="performanceStyle"]').forEach(input=>{input.disabled=currentExpressionMode()==='flow';});}
function rendererFor(score){return score.rendererVersion===Legato.VERSION?Legato:Audio;}
function composeCurrent() { const mode=currentExpressionMode(),base=Music.compose(currentAnalysis,{performanceStyle:currentPerformanceStyle()});return mode==='flow'?Legato.apply(base):Expression.apply(base,{enabled:mode==='on'}); }
async function togglePlayback({ seconds = 0, volume = 1 } = {}) {
  if (!composition) return;
  if (isPlaying) return stopPlayback();
  const token = ++playbackToken, score = composition; els.play.disabled = true;
  try {
    const context = await getAudioContext();
    if (token !== playbackToken || score !== composition) return;
    audioSession = rendererFor(score).createSession(context, { bpm: score.bpm, volume });
    playbackStart = context.currentTime + .08; audioSession.schedule(score, playbackStart, currentTone());
    isPlaying = true; els.play.classList.add('is-playing'); els.playLabel.textContent = '停止演奏';
    els.status.className = 'status-pill playing'; animatePlayback();
    if(seconds>0)previewTimer=setTimeout(()=>{stopPlayback();showToast(`${seconds}秒对照结束，可以切换另一版`);},(seconds+.08)*1000);
  } catch (error) { stopPlayback(); showToast(error.message || '声音暂时无法播放，请重试'); }
  finally { els.play.disabled = !composition; }
}
function animatePlayback() {
  if (!isPlaying || !composition) return;
  const elapsed = Math.max(0, audioContext.currentTime - playbackStart), position = Music.playbackPosition(composition, elapsed);
  if (position.finished) return stopPlayback();
  const { note, index, rest, tail, phase, performanceRest } = position;
  els.scanLine.classList.add('active'); els.scanLine.classList.toggle('breathing', rest || tail || performanceRest);
  els.scanLine.style.transform = `translateX(${position.scanFraction * els.dropZone.clientWidth}px)`;
  els.scanLine.firstElementChild.textContent = tail ? '余韵' : rest ? '边界' : performanceRest ? '留白' : position.performanceNote?.noteName || note?.noteName || '等待';
  if (!note) {
    regionCells.forEach(cell => cell.classList.remove('active')); noteBars.forEach(bar => bar.classList.remove('active'));
    els.stepLabel.textContent = '000 / 120'; els.status.textContent = '等待起音';
    animationId = requestAnimationFrame(animatePlayback); return;
  }
  if (lastActive !== index) {
    regionCells.forEach(cell => cell.classList.toggle('active', Number(cell.dataset.sequence) === index));
    noteBars.forEach((bar, col) => bar.classList.toggle('active', col === position.region.col));
    els.stepLabel.textContent = `${String(index + 1).padStart(3, '0')} / 120`; lastActive = index;
  }
  if (lastPhrase !== phase) {
    [...els.phraseTracker.children].forEach((item, i) => item.classList.toggle('active', i === phase)); lastPhrase = phase;
  }
  const role=position.performanceNote?.expressionSupport?.kind;
  const flow=composition.rendererVersion===Legato.VERSION;
  els.phraseLabel.textContent = flow ? `${Music.PHRASES[phase]} · 连绵音高目标 ${position.performanceIndex+1} / ${composition.performanceEvents.length}${tail?' · 余韵':' · 平滑换音，持续发声'}` : `${Music.PHRASES[phase]} · 起音 ${position.performanceIndex + 1} / ${composition.performanceEvents.length}${rest ? ' · 图像边界留白' : tail ? ' · 余韵' : performanceRest ? ' · 主旋律留白，扫描继续' : role==='anchor-rhythm' ? ' · 颜色短句主音' : role==='connection' ? ' · 音阶连接' : role==='return' ? ' · 短句回应' : position.performanceNote?.envelope==='pluck' ? ' · 轻奏同音' : ''}`;
  els.status.textContent = tail ? '渐渐收尾' : flow ? '正在连绵演奏' : rest ? '图像边界留白' : performanceRest ? '轻奏留白' : '正在演奏';
  animationId = requestAnimationFrame(animatePlayback);
}
function stopPlayback() {
  playbackToken++; clearTimeout(previewTimer); previewTimer=0; cancelAnimationFrame(animationId); audioSession?.stop(); audioSession = null; isPlaying = false;
  els.play.classList.remove('is-playing'); els.playLabel.textContent = '开始听画'; els.play.disabled = !composition;
  els.scanLine.classList.remove('active', 'breathing'); els.scanLine.style.transform = 'translateX(0)';
  els.stepLabel.textContent = '000 / 120';
  regionCells.forEach(cell => cell.classList.remove('active')); noteBars.forEach(bar => bar.classList.remove('active'));
  [...els.phraseTracker.children].forEach(item => item.classList.remove('active'));
  lastActive = -1; lastPhrase = -1; els.phraseLabel.textContent = '第一段 · 第二段 · 第三段 · 第四段';
  if (composition) { els.status.textContent = '可以演奏'; els.status.className = 'status-pill ready'; }
}
function loadFile(file) {
  if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) return showToast('请选择 JPG、PNG 或 WEBP 图片');
  if (file.size > 12 * 1024 * 1024) return showToast('图片请小于 12MB');
  stopPlayback(); const token = ++loadToken, url = URL.createObjectURL(file), image = new Image();
  image.onload = () => {
    try { if (token === loadToken) analyzeSource(image, file.name); }
    catch (error) { showToast(error.message || '这张图片暂时无法编曲'); }
    finally { URL.revokeObjectURL(url); }
  };
  image.onerror = () => { URL.revokeObjectURL(url); if (token === loadToken) showToast('这张图片暂时无法读取'); }; image.src = url;
}
function loadSample() {
  loadToken++; stopPlayback();
  try { analyzeSource(createSample(), '黄昏样本'); } catch (error) { showToast(error.message); }
}
function showToast(message) {
  els.toast.textContent = message; els.toast.classList.add('show');
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => els.toast.classList.remove('show'), 3200);
}
els.file.addEventListener('change', event => { loadFile(event.target.files[0]); event.target.value = ''; });
els.play.addEventListener('click', togglePlayback); els.sample.addEventListener('click', loadSample);
async function compareExcerpt(mode){
  if(!currentAnalysis||!composition)return;
  const name=composition.name;stopPlayback();const token=playbackToken,analysis=currentAnalysis,tone=currentTone();
  document.querySelector(`input[name="pixelExpression"][value="${mode}"]`).checked=true;
  const original=Music.compose(analysis,{performanceStyle:currentPerformanceStyle()}),expressed=Expression.apply(original),flow=Legato.apply(original);
  composition={off:original,on:expressed,flow}[mode];composition.name=name;renderComposition();els.play.disabled=true;els.status.textContent='准备同响度对照…';
  try{
    await getAudioContext(); // Resume within the user's gesture, before offline preparation.
    const probe=score=>{
      const key=`${score.scoreHash}:${tone}`;
      if(!comparisonProbes.has(key))comparisonProbes.set(key,rendererFor(score).renderOffline(score,{tone}).then(buffer=>{
        const samples=buffer.getChannelData(0),from=Math.floor(.05*buffer.sampleRate),to=Math.min(samples.length,from+12*buffer.sampleRate);let energy=0;
        for(let i=from;i<to;i++)energy+=samples[i]*samples[i];return Math.sqrt(energy/(to-from));
      }).catch(error=>{comparisonProbes.delete(key);throw error;}));
      return comparisonProbes.get(key);
    };
    const [a,b,c]=await Promise.all([probe(original),probe(expressed),probe(flow)]);
    if(token!==playbackToken||analysis!==currentAnalysis||tone!==currentTone())return;
    if(![a,b,c].every(n=>n>0&&Number.isFinite(n)))throw new Error('对照音频暂时无法准备');
    const target=Math.min(a,b,c),volume=target/({off:a,on:b,flow:c}[mode]);
    els.abFlow.dataset.lastComparison=JSON.stringify({seconds:12,tone,mode,rmsOriginal:a,rmsExpression:b,rmsFlow:c,gainOriginal:target/a,gainExpression:target/b,gainFlow:target/c,targetRms:target});
    await togglePlayback({seconds:12,volume});
  }catch(error){if(token===playbackToken)showToast(error.message||'对照试听暂时无法准备');}
  finally{if(token===playbackToken){els.play.disabled=!composition;if(!isPlaying)els.status.textContent='可以演奏';}}
}
els.abOriginal.addEventListener('click',()=>compareExcerpt('off'));
els.abExpression.addEventListener('click',()=>compareExcerpt('on'));
els.abFlow.addEventListener('click',()=>compareExcerpt('flow'));
els.whiteSample.addEventListener('click', () => {
  loadToken++; stopPlayback();
  const source = document.createElement('canvas'); source.width = 192; source.height = 120;
  source.getContext('2d').fillStyle = '#fff'; source.getContext('2d').fillRect(0,0,192,120);
  try { analyzeSource(source,'纯白样本'); } catch(error) { showToast(error.message); }
});
els.gradientSample.addEventListener('click',()=>{
  loadToken++;stopPlayback();
  const source=document.createElement('canvas');source.width=192;source.height=120;
  const ctx=source.getContext('2d'),gradient=ctx.createLinearGradient(0,0,192,0);
  gradient.addColorStop(0,'#202028');gradient.addColorStop(.5,'#ece2d0');gradient.addColorStop(1,'#304c79');
  ctx.fillStyle=gradient;ctx.fillRect(0,0,192,120);
  try{analyzeSource(source,'渐变升降样本');}catch(error){showToast(error.message);}
});
els.export.addEventListener('click', async () => {
  if (!composition) return;
  const score = composition, tone = currentTone(); els.export.disabled = true; els.export.textContent = '正在本机生成 WAV…';
  try {
    const buffer = await rendererFor(score).renderOffline(score, { tone }), metrics = Audio.inspectBuffer(buffer);
    if (metrics.invalid || metrics.clipped) throw new Error('音频校验未通过，暂不保存');
    const wav=Audio.wavBytes(buffer),view=new DataView(wav),fileName=`PixelMusic-${score.version}-${score.rendererVersion||score.expressionVersion||'original'}-${score.scoreHash}-${tone}.wav`;
    // A small local diagnostic, no PCM/image data or upload. Rendering is not proof
    // that a browser granted the later download request.
    const flowContinuity=score.rendererVersion===Legato.VERSION?inspectFlowContinuity(buffer,score):null;
    els.export.dataset.lastRender=JSON.stringify({scoreHash:score.scoreHash,expressionVersion:score.rendererVersion||score.expressionVersion||'original',tone,sampleRate:buffer.sampleRate,frames:buffer.length,wavBytes:wav.byteLength,flowContinuity,
      headerValid:view.getUint32(0)===0x52494646&&view.getUint32(8)===0x57415645&&view.getUint32(40,true)+44===wav.byteLength,metrics,fileName});
    const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
    const link = document.createElement('a'); link.href = url; link.download = fileName; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 3000); showToast('音乐已生成，已请求浏览器保存');
  } catch (error) { showToast(error.message || '音乐暂时无法保存'); }
  finally { els.export.disabled = !composition; els.export.textContent = '保存这张图的音乐 · WAV'; }
});
els.regionGrid.addEventListener('click', async event => {
  const cell = event.target.closest('.region-cell'); if (!cell || !composition) return;
  const note = Music.previewForRegion(composition, Number(cell.dataset.sequence));
  try {
    const context = await getAudioContext(), preview = Audio.createSession(context, { bpm: composition.bpm, volume: .85 });
    preview.voice(note.midi, context.currentTime + .02, .65, note.velocity, currentTone(), 'melody', note.send, null, { sustain: note.envelope!=='pluck',pluck:note.envelope==='pluck',fullDuration:.65 });
    cell.classList.add('preview'); setTimeout(() => cell.classList.remove('preview'), 420); setTimeout(() => preview.stop(), 950);
  } catch (error) { showToast(error.message); }
});
function inspectFlowContinuity(buffer,score){
  const samples=buffer.getChannelData(0),rate=buffer.sampleRate,windowFrames=Math.round(rate*.05),from=Math.round(rate*.25),to=Math.min(samples.length,Math.floor((.05+score.melodyDuration)*rate));
  let minimumRms=Infinity,maximumRms=0,quietWindows=0,windows=0;
  for(let start=from;start+windowFrames<=to;start+=windowFrames){let energy=0;for(let i=start;i<start+windowFrames;i++)energy+=samples[i]*samples[i];const rms=Math.sqrt(energy/windowFrames);minimumRms=Math.min(minimumRms,rms);maximumRms=Math.max(maximumRms,rms);if(rms<.001)quietWindows++;windows++;}
  return{windowSeconds:.05,windows,minimumRms,maximumRms,quietWindows,measured:'whole-64-beat-melody-excluding-entry-and-release'};
}
document.querySelectorAll('input[name="tone"]').forEach(input => input.addEventListener('change', () => {
  if (!isPlaying) return;
  const continuedAt = audioContext.currentTime + .015;
  const volume=audioSession.output.gain.value;audioSession.stop(); audioSession = rendererFor(composition).createSession(audioContext, { bpm: composition.bpm, volume });
  // Keep the original audio/scan clock; only the user's timbre change is crossfaded.
  audioSession.schedule(composition, playbackStart, currentTone(), Music.timeToBeat(composition, continuedAt - playbackStart));
}));
document.querySelectorAll('input[name="performanceStyle"], input[name="pixelExpression"]').forEach(input=>input.addEventListener('change',()=>{
  syncStyleControls();
  if(!currentAnalysis||!composition)return;
  const name=composition.name,wasPlaying=isPlaying;stopPlayback();
  composition=composeCurrent();composition.name=name;renderComposition();
  if(wasPlaying)showToast('已切换表达／奏法，请重新开始听画');
}));
['dragenter', 'dragover'].forEach(type => els.dropZone.addEventListener(type, event => { event.preventDefault(); els.dropZone.classList.add('dragging'); }));
['dragleave', 'drop'].forEach(type => els.dropZone.addEventListener(type, event => { event.preventDefault(); els.dropZone.classList.remove('dragging'); }));
els.dropZone.addEventListener('drop', event => loadFile(event.dataTransfer.files[0]));
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(drawDisplay, 80); });
window.addEventListener('pagehide', stopPlayback);
syncStyleControls();
