'use strict';
const Music = window.PixelMusic, ImageAnalysis = window.PixelMusicImage, Audio = window.PixelMusicAudio;
const STEPS = 24, REGION_ROWS = 5;
const SCALE_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const els = Object.fromEntries(Object.entries({
  file: 'fileInput', canvas: 'imageCanvas', dropZone: 'dropZone', empty: 'emptyState', scanLine: 'scanLine',
  regionGrid: 'regionGrid', noteRail: 'noteRail', stageLabel: 'stageLabel', stepLabel: 'stepLabel',
  title: 'workTitle', status: 'statusPill', key: 'keyMetric', tempo: 'tempoMetric', color: 'colorMetric',
  texture: 'textureMetric', fingerprint: 'fingerprintValue', scoreHash: 'scoreHashValue',
  phraseTracker: 'phraseTracker', phraseLabel: 'phraseLabel', uploadLabel: 'uploadLabel',
  play: 'playButton', playLabel: 'playLabel', sample: 'sampleButton', toast: 'toast',
}).map(([key, id]) => [key, document.getElementById(id)]));
let audioContext, audioSession, composition = null, canonicalImage = null, displaySource = null;
let isPlaying = false, animationId = 0, playbackStart = 0, playbackToken = 0, loadToken = 0;
let regionCells = [], noteBars = [], lastActive = -1, lastPhrase = -1;

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
  const canvas = document.createElement('canvas');
  canvas.width = ImageAnalysis.WIDTH; canvas.height = ImageAnalysis.HEIGHT;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const scale = Math.max(canvas.width / source.width, canvas.height / source.height);
  const width = source.width * scale, height = source.height * scale;
  context.drawImage(source, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  return canvas;
}
function analyzeSource(source, name) {
  const canonical = normalizeSource(source);
  const data = canonical.getContext('2d').getImageData(0, 0, canonical.width, canonical.height).data;
  const score = Music.compose(ImageAnalysis.analyzePixels(data)); score.name = name;
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
  els.key.textContent = `${SCALE_NAMES[c.root]} · ${c.mode.name}`; els.tempo.textContent = `${c.bpm} BPM`;
  els.color.textContent = c.avgS > .5 ? '浓郁' : c.avgS > .27 ? '柔和' : '低饱和';
  els.texture.textContent = c.edgeRatio > .12 ? '繁复' : c.edgeRatio > .065 ? '适中' : '平静';
  els.fingerprint.textContent = c.hash.slice(0, 16).toUpperCase().match(/.{1,4}/g).join(' ');
  els.scoreHash.textContent = `${c.version} · ${c.scoreHash.toUpperCase().match(/.{1,4}/g).join(' ')}`;
  els.stageLabel.textContent = `120 音 · 16 小节 · ${Math.round(c.duration)} 秒`;
  els.phraseLabel.textContent = '主题 · 回应 · 发展 · 回归';
  els.uploadLabel.textContent = '更换图片'; els.play.disabled = false;
  els.empty.classList.add('hidden'); els.dropZone.classList.add('has-image');
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
async function togglePlayback() {
  if (!composition) return;
  if (isPlaying) return stopPlayback();
  const token = ++playbackToken, score = composition; els.play.disabled = true;
  try {
    const context = await getAudioContext();
    if (token !== playbackToken || score !== composition) return;
    audioSession = Audio.createSession(context, { bpm: score.bpm });
    playbackStart = context.currentTime + .08; audioSession.schedule(score, playbackStart, currentTone());
    isPlaying = true; els.play.classList.add('is-playing'); els.playLabel.textContent = '停止演奏';
    els.status.className = 'status-pill playing'; animatePlayback();
  } catch (error) { stopPlayback(); showToast(error.message || '声音暂时无法播放，请重试'); }
  finally { els.play.disabled = !composition; }
}
function animatePlayback() {
  if (!isPlaying || !composition) return;
  const elapsed = Math.max(0, audioContext.currentTime - playbackStart), position = Music.playbackPosition(composition, elapsed);
  if (position.finished) return stopPlayback();
  const { note, index, rest, tail } = position;
  els.scanLine.classList.add('active'); els.scanLine.classList.toggle('breathing', rest || tail);
  els.scanLine.style.transform = `translateX(${position.scanFraction * els.dropZone.clientWidth}px)`;
  els.scanLine.firstElementChild.textContent = tail ? '余韵' : rest ? '呼吸' : note.noteName;
  if (lastActive !== index) {
    regionCells.forEach(cell => cell.classList.toggle('active', Number(cell.dataset.sequence) === index));
    noteBars.forEach((bar, col) => bar.classList.toggle('active', col === note.col));
    els.stepLabel.textContent = `${String(index + 1).padStart(3, '0')} / 120`; lastActive = index;
  }
  if (lastPhrase !== note.phrase) {
    [...els.phraseTracker.children].forEach((item, i) => item.classList.toggle('active', i === note.phrase)); lastPhrase = note.phrase;
  }
  els.phraseLabel.textContent = `${Music.PHRASES[note.phrase]} · 第 ${note.bar + 1} / 16 小节${rest ? ' · 呼吸' : tail ? ' · 余韵' : ''}`;
  els.status.textContent = rest ? '乐句呼吸' : tail ? '渐渐收尾' : '正在演奏';
  animationId = requestAnimationFrame(animatePlayback);
}
function stopPlayback() {
  playbackToken++; cancelAnimationFrame(animationId); audioSession?.stop(); audioSession = null; isPlaying = false;
  els.play.classList.remove('is-playing'); els.playLabel.textContent = '开始听画'; els.play.disabled = !composition;
  els.scanLine.classList.remove('active', 'breathing'); els.scanLine.style.transform = 'translateX(0)';
  els.stepLabel.textContent = '000 / 120';
  regionCells.forEach(cell => cell.classList.remove('active')); noteBars.forEach(bar => bar.classList.remove('active'));
  [...els.phraseTracker.children].forEach(item => item.classList.remove('active'));
  lastActive = -1; lastPhrase = -1; els.phraseLabel.textContent = '主题 · 回应 · 发展 · 回归';
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
els.regionGrid.addEventListener('click', async event => {
  const cell = event.target.closest('.region-cell'); if (!cell || !composition) return;
  const note = composition.melody[Number(cell.dataset.sequence)];
  try {
    const context = await getAudioContext(), preview = Audio.createSession(context, { bpm: composition.bpm, volume: .85 });
    preview.voice(note.midi, context.currentTime + .02, .65, .12, currentTone());
    cell.classList.add('preview'); setTimeout(() => cell.classList.remove('preview'), 420); setTimeout(() => preview.stop(), 950);
  } catch (error) { showToast(error.message); }
});
document.querySelectorAll('input[name="tone"]').forEach(input => input.addEventListener('change', () => {
  if (!isPlaying) return;
  const elapsed = Math.max(0, audioContext.currentTime - playbackStart);
  audioSession.stop(); audioSession = Audio.createSession(audioContext, { bpm: composition.bpm });
  playbackStart = audioContext.currentTime + .035 - elapsed;
  audioSession.schedule(composition, playbackStart, currentTone(), elapsed / composition.secondsPerBeat);
}));
['dragenter', 'dragover'].forEach(type => els.dropZone.addEventListener(type, event => { event.preventDefault(); els.dropZone.classList.add('dragging'); }));
['dragleave', 'drop'].forEach(type => els.dropZone.addEventListener(type, event => { event.preventDefault(); els.dropZone.classList.remove('dragging'); }));
els.dropZone.addEventListener('drop', event => loadFile(event.dataTransfer.files[0]));
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(drawDisplay, 80); });
window.addEventListener('pagehide', stopPlayback);
