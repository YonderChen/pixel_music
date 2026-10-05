'use strict';
const $ = id => document.getElementById(id);
const Music = window.PixelMusicV04, ImageAnalysis = window.PixelMusicImageV04, Legacy = window.PixelMusicLegacy, Audio = window.PixelMusicAudioV04, Fixtures = window.PixelMusicFixtures;
const Listening = window.PixelMusicListening, dimensions = Listening.dimensions;
const ratings = []; let urls = [], currentRound = null, reportData = null, busy = false;
$('fixtureSelect').innerHTML = Fixtures.names.map((name, i) => `<option value="${i}">${i + 1}. ${name}</option>`).join('');
$('fixtureSelect').value = '5';
function drawFixture() {
  const data = Fixtures.pixels(Number($('fixtureSelect').value));
  $('fixtureCanvas').getContext('2d').putImageData(new ImageData(data, Fixtures.width, Fixtures.height), 0, 0);
}
drawFixture();
function clearRound() {
  $('cards').querySelectorAll('audio').forEach(audio => audio.pause());
  urls.forEach(url => URL.revokeObjectURL(url)); urls = []; currentRound = null;
  $('cards').replaceChildren(); $('saveRating').disabled = true; $('revealButton').disabled = true;
}
$('fixtureSelect').addEventListener('change', () => { clearRound(); drawFixture(); });
$('toneSelect').addEventListener('change', clearRound); $('lengthSelect').addEventListener('change', clearRound);
function variants(analysis) {
  const score = Music.compose(analysis), old = Legacy.compose(analysis, { bpm: score.bpm });
  return [{ id: 'legacy', title: '0.3 基线', score: old }, { id: 'plain', title: '0.4 仅升级作曲', score }, { id: 'expressive', title: '0.4 作曲 + 演奏', score }];
}
function shuffled(items) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
function setBusy(value) {
  busy = value; ['renderButton', 'fixtureSelect', 'toneSelect', 'lengthSelect', 'regressionButton'].forEach(id => { $(id).disabled = value; });
}
async function renderRound() {
  if (busy) return;
  clearRound(); setBusy(true);
  try {
    const fixture = Number($('fixtureSelect').value), tone = $('toneSelect').value;
    const analysis = ImageAnalysis.analyzePixels(Fixtures.pixels(fixture));
    const ordered = shuffled(variants(analysis)), rendered = [];
    for (let i = 0; i < ordered.length; i++) {
      $('progress').textContent = `本机渲染 ${i + 1} / 3…`;
      const variant = ordered[i], buffer = await Audio.renderOffline(variant.score, { profile: variant.id, tone });
      const length = $('lengthSelect').value === 'full' ? buffer.duration : 16;
      const samples = buffer.getChannelData(0), count = Math.min(samples.length, Math.round(length * buffer.sampleRate));
      let energy = 0, peak = 0;
      for (let j = 0; j < count; j++) { energy += samples[j] ** 2; peak = Math.max(peak, Math.abs(samples[j])); }
      rendered.push({ ...variant, buffer, length, rms: Math.sqrt(energy / count), peak });
    }
    const target = Math.min(...rendered.map(item => item.rms));
    currentRound = { fixture, tone, length: $('lengthSelect').value, ordered: rendered, revealed: false };
    $('cards').innerHTML = rendered.map((item, i) => {
      const label = String.fromCharCode(65 + i), gain = Math.min(target / item.rms, .85 / item.peak);
      const url = URL.createObjectURL(new Blob([Audio.wavBytes(item.buffer, gain, item.length)], { type: 'audio/wav' })); urls.push(url);
      return `<article><h3 id="variant${i}">版本 ${label}</h3><audio controls preload="auto" src="${url}" aria-label="试听版本 ${label}"></audio><p><a href="${url}" download="pixelmusic-${Fixtures.names[fixture]}-${label}.wav">保存这段音频</a></p><div class="ratings">${dimensions.map((name, d) => `<label>${name}<select id="rate${i}-${d}" aria-label="${label} ${name}"><option value="">未评分</option>${[1, 2, 3, 4, 5].map(n => `<option value="${n}">${n} 分</option>`).join('')}</select></label>`).join('')}</div></article>`;
    }).join('');
    $('cards').querySelectorAll('audio').forEach(audio => audio.addEventListener('play', () => $('cards').querySelectorAll('audio').forEach(other => { if (other !== audio) other.pause(); })));
    $('preferred').value = ''; $('saveRating').disabled = false; $('revealButton').disabled = false;
    $('progress').textContent = `${Fixtures.names[fixture]} · ${tone} · 三组 ${rendered[0].score.bpm} BPM；请先试听、评分，再揭晓。`;
  } catch (error) { $('progress').textContent = `无法渲染：${error.message}`; } finally { setBusy(false); }
}
$('renderButton').addEventListener('click', renderRound);
$('revealButton').addEventListener('click', () => {
  if (!currentRound) return;
  currentRound.revealed = true;
  currentRound.ordered.forEach((item, i) => { $(`variant${i}`).textContent = `${String.fromCharCode(65 + i)} · ${item.title}`; });
});
function summarizeRatings() {
  return Listening.summarize(ratings);
}
$('saveRating').addEventListener('click', () => {
  if (!currentRound || !$('preferred').value) { $('progress').textContent = '请先选择最喜欢的版本并完成全部评分。'; return; }
  const scores = currentRound.ordered.map((item, i) => ({ id: item.id, label: String.fromCharCode(65 + i), values: dimensions.map((_, d) => Number($(`rate${i}-${d}`).value)) }));
  if (scores.some(score => score.values.some(value => value < 1 || value > 5))) { $('progress').textContent = '请完成三组各五项评分，再保存。'; return; }
  const preferredIndex = $('preferred').value.charCodeAt(0) - 65;
  ratings.push({ fixture: currentRound.fixture, fixtureName: Fixtures.names[currentRound.fixture], tone: currentRound.tone, length: currentRound.length, device: $('device').value, revealed: currentRound.revealed, preferredId: currentRound.ordered[preferredIndex].id, scores, recordedAt: new Date().toISOString() });
  $('saveRating').disabled = true;
  const summary = summarizeRatings(); $('ratingSummary').textContent = `已保存 ${summary.totalRounds} 轮，其中 ${summary.blindRounds} 轮为未揭晓盲听；暖键短片段与完整曲目均已覆盖 ${summary.completeWarmFixtures} / 12 张图。${summary.acceptance ? '达到可选试听试验门槛（仍属小样本）。' : '可选试听数据尚不完整，不影响本轮技术交付。'}`;
});
function download(name, value) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
$('exportRatings').addEventListener('click', () => download('pixelmusic-listening-ratings.json', { summary: summarizeRatings(), ratings }));
$('downloadReport').addEventListener('click', () => { if (reportData) download('pixelmusic-audio-regression.json', reportData); });
$('regressionButton').addEventListener('click', async () => {
  if (busy) return;
  setBusy(true); $('downloadReport').disabled = true;
  reportData = { version: '0.4.0', environment: navigator.userAgent, createdAt: new Date().toISOString(), status: 'running', cases: [], scores: [], listening: 'not-assessed' };
  $('report').textContent = JSON.stringify({ status: 'running', completed: 0, total: 108 }, null, 2);
  try {
    for (let fixture = 0; fixture < Fixtures.names.length; fixture++) {
      const analysis = ImageAnalysis.analyzePixels(Fixtures.pixels(fixture)), selected = variants(analysis);
      const score = selected[1].score;
      reportData.scores.push({ fixture, name: Fixtures.names[fixture], scoreHash: score.scoreHash, themeHash: score.theme.signature, root: score.root, modeId: score.mode.id, bpm: score.bpm, noteCount: score.melody.length, barCount: score.bars.length });
      for (const tone of ['warm', 'glass', 'mist']) for (const variant of selected) {
        const buffer = await Audio.renderOffline(variant.score, { profile: variant.id, tone }), metrics = Audio.inspectBuffer(buffer);
        const passed = metrics.invalid === 0 && metrics.clipped === 0 && metrics.peak < .9 && metrics.rms > .003 && metrics.tailPeak < .001;
        reportData.cases.push({ fixture, name: Fixtures.names[fixture], profile: variant.id, tone, ...metrics, passed });
        $('report').textContent = JSON.stringify({ status: 'running', completed: reportData.cases.length, total: 108, lastCase: reportData.cases.at(-1) }, null, 2);
      }
    }
    reportData.status = reportData.cases.every(c => c.passed) ? 'passed' : 'failed';
  } catch (error) { reportData.status = 'error'; reportData.error = error.message; }
  finally { $('report').textContent = JSON.stringify(reportData, null, 2); $('downloadReport').disabled = false; setBusy(false); }
});
window.addEventListener('pagehide', clearRound);
