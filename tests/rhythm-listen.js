'use strict';
const $ = id => document.getElementById(id);
const Music = window.PixelMusic, Analysis = window.PixelMusicImage, Audio = window.PixelMusicAudio;
const OldMusic = window.PixelMusicV04, OldAnalysis = window.PixelMusicImageV04, OldAudio = window.PixelMusicAudioV04;
const Fixtures = window.PixelMusicFixtures, Extended = window.PixelMusicRhythmFixtures;
const names = [...Fixtures.names, ...Extended.names], pixels = i => i < 12 ? Fixtures.pixels(i) : Extended.pixels(i - 12);
let urls = [], busy = false, reportData = null;
for (const id of ['imageA', 'imageB']) $(id).innerHTML = names.map((name, i) => `<option value="${i}">${i + 1}. ${name}</option>`).join('');
$('imageB').value = '1';
function clearAudio() { $('cards').querySelectorAll('audio').forEach(a => a.pause()); urls.forEach(url => URL.revokeObjectURL(url)); urls = []; $('cards').replaceChildren(); }
function draw() {
  clearAudio();
  for (const letter of ['A', 'B']) $(`canvas${letter}`).getContext('2d').putImageData(new ImageData(pixels(Number($(`image${letter}`).value)), 192, 120), 0, 0);
}
draw();
for (const id of ['imageA', 'imageB']) $(id).addEventListener('change', draw);
for (const id of ['comparisonMode', 'tone', 'length']) $(id).addEventListener('change', clearAudio);
function setBusy(value) { busy = value; for (const id of ['renderComparison', 'runRegression', 'imageA', 'imageB', 'comparisonMode', 'tone', 'length']) $(id).disabled = value; }
function makeVariant(index, old, mode) {
  const rgba = pixels(index), composer = old ? OldMusic : Music, analyzer = old ? OldAnalysis : Analysis;
  let score = composer.compose(analyzer.analyzePixels(rgba), mode === 'complete' ? {} : { bpm: 88, tempo: false });
  if (mode === 'rhythm') {
    score = { ...score, melody: score.melody.map(n => ({ ...n, midi: 60, durationBeats: n.beats * .88, velocity: .12, send: 0 })), bars: [], bassEvents: [], padEvents: [] };
  }
  return { score, engine: old ? OldAudio : Audio, version: old ? '0.4' : '0.5', mode, index };
}
async function renderComparison() {
  if (busy) return; setBusy(true); clearAudio();
  try {
    const variants = ['A', 'B'].flatMap(letter => [true, false].map(old => ({ ...makeVariant(Number($(`image${letter}`).value), old, $('comparisonMode').value), letter })));
    const rendered = [];
    for (const variant of variants) {
      $('progress').textContent = `本机渲染 ${rendered.length + 1} / 4…`;
      const buffer = await variant.engine.renderOffline(variant.score, { tone: $('tone').value });
      const length = $('length').value === 'full' ? buffer.duration : 16;
      const count = Math.min(buffer.length, Math.round(length * buffer.sampleRate)), source = buffer.getChannelData(0);
      let energy = 0, peak = 0;
      for (let i = 0; i < count; i++) { energy += source[i] ** 2; peak = Math.max(peak, Math.abs(source[i])); }
      rendered.push({ ...variant, buffer, length, rms: Math.sqrt(energy / count), peak });
    }
    const target = Math.min(...rendered.map(v => v.rms));
    $('cards').innerHTML = rendered.map(v => {
      const gain = Math.min(target / Math.max(.0001, v.rms), .85 / Math.max(.0001, v.peak));
      const url = URL.createObjectURL(new Blob([v.engine.wavBytes(v.buffer, gain, v.length)], { type: 'audio/wav' })); urls.push(url);
      const rhythm = Music.rhythmFingerprint(v.score);
      return `<article><h3>${v.letter} · ${names[v.index]} · ${v.version}</h3><audio controls src="${url}"></audio><p class="muted">${v.score.bpm} BPM · 节奏 ${rhythm}</p><a href="${url}" download="PixelMusic-${v.version}-${v.index}-${v.mode}.wav">保存 WAV</a></article>`;
    }).join('');
    $('cards').querySelectorAll('audio').forEach(audio => audio.addEventListener('play', () => $('cards').querySelectorAll('audio').forEach(other => { if (other !== audio) other.pause(); })));
    $('progress').textContent = '四段已生成，已匹配片段 RMS 响度；节奏隔离版仅用于诊断，不是正常作品。';
  } catch (error) { $('progress').textContent = `渲染失败：${error.message}`; } finally { setBusy(false); }
}
$('renderComparison').addEventListener('click', renderComparison);
async function runRegression() {
  if (busy) return; setBusy(true); $('saveReport').disabled = true;
  const cases = [], scores = [];
  reportData = { version: '0.5.0', status: 'running', createdAt: new Date().toISOString(), environment: navigator.userAgent, expectedCases: 276, cases, scores, listening: 'not-assessed' };
  $('report').textContent = JSON.stringify({ status: 'running', completed: 0, total: 276 });
  try {
    for (let index = 0; index < names.length; index++) {
      const full = makeVariant(index, false, 'complete');
      scores.push({ index, name: names[index], imageHash: full.score.hash, bpm: full.score.bpm, scoreHash: full.score.scoreHash, rhythmFingerprint: full.score.rhythmFingerprint });
      const variants = [full, ...(index < 12 ? [makeVariant(index, true, 'complete'), makeVariant(index, false, 'melody')] : [])];
      for (const tone of ['warm', 'glass', 'mist']) for (const variant of variants) {
        const buffer = await variant.engine.renderOffline(variant.score, { tone }), metrics = Audio.inspectBuffer(buffer);
        const wav = new DataView(Audio.wavBytes(buffer));
        const passed = metrics.invalid === 0 && metrics.clipped === 0 && metrics.peak < .9 && metrics.rms > .003 && metrics.tailPeak < .001 && wav.getUint32(40, true) === buffer.length * 2;
        cases.push({ index, name: names[index], version: variant.version, mode: variant.mode, tone, ...metrics, passed });
        $('report').textContent = JSON.stringify({ status: 'running', completed: cases.length, total: 276, last: cases.at(-1) }, null, 2);
      }
      if (index < 12) for (const old of [true, false]) {
        const variant = makeVariant(index, old, 'rhythm'), buffer = await variant.engine.renderOffline(variant.score), metrics = Audio.inspectBuffer(buffer);
        cases.push({ index, name: names[index], version: variant.version, mode: 'rhythm', tone: 'warm', ...metrics, passed: metrics.invalid === 0 && metrics.clipped === 0 && metrics.rms > .003 && metrics.peak < .9 && metrics.tailPeak < .001 });
      }
    }
    reportData.status = cases.length === 276 && cases.every(c => c.passed) ? 'passed' : 'failed';
  } catch (error) { reportData.status = 'error'; reportData.error = error.message; }
  finally { $('report').textContent = JSON.stringify(reportData, null, 2); $('saveReport').disabled = false; setBusy(false); }
}
$('runRegression').addEventListener('click', runRegression);
$('checkScores').addEventListener('click', () => {
  const scores = names.map((name, index) => {
    const { score } = makeVariant(index, false, 'complete');
    return { index, name, imageHash: score.hash, scoreHash: score.scoreHash, rhythmFingerprint: score.rhythmFingerprint };
  });
  $('scoreReport').textContent = JSON.stringify({ status: 'complete', version: '0.5.0', scores }, null, 2);
});
$('saveReport').addEventListener('click', () => {
  if (!reportData) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'pixelmusic-0.5-audio-regression.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 3000);
});
window.addEventListener('pagehide', clearAudio);
