const STEPS = 16;
const SCALE_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const MODES = {
  bright: { name: "明亮五声", notes: [0, 2, 4, 7, 9] },
  soft: { name: "柔和大调", notes: [0, 2, 4, 5, 7, 9, 11] },
  deep: { name: "深色小调", notes: [0, 2, 3, 5, 7, 8, 10] },
};

const els = {
  file: document.querySelector("#fileInput"),
  canvas: document.querySelector("#imageCanvas"),
  dropZone: document.querySelector("#dropZone"),
  empty: document.querySelector("#emptyState"),
  scanLine: document.querySelector("#scanLine"),
  noteRail: document.querySelector("#noteRail"),
  stageLabel: document.querySelector("#stageLabel"),
  stepLabel: document.querySelector("#stepLabel"),
  title: document.querySelector("#workTitle"),
  status: document.querySelector("#statusPill"),
  key: document.querySelector("#keyMetric"),
  tempo: document.querySelector("#tempoMetric"),
  color: document.querySelector("#colorMetric"),
  texture: document.querySelector("#textureMetric"),
  fingerprint: document.querySelector("#fingerprintValue"),
  uploadLabel: document.querySelector("#uploadLabel"),
  play: document.querySelector("#playButton"),
  playLabel: document.querySelector("#playLabel"),
  sample: document.querySelector("#sampleButton"),
  toast: document.querySelector("#toast"),
};

let audioContext;
let composition = null;
let isPlaying = false;
let scheduledNodes = [];
let animationId = 0;
let playStartedAt = 0;
let currentSource = null;

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > .5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

async function digestPixels(bytes) {
  if (crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, "0")).join("");
  }
  let hash = 2166136261;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0").repeat(8);
}

function fitCanvasToStage() {
  const rect = els.dropZone.getBoundingClientRect();
  const ratio = Math.min(devicePixelRatio || 1, 2);
  els.canvas.width = Math.max(480, Math.round(rect.width * ratio));
  els.canvas.height = Math.max(360, Math.round(rect.height * ratio));
}

function drawCover(image) {
  fitCanvasToStage();
  const ctx = els.canvas.getContext("2d", { willReadFrequently: true });
  const cw = els.canvas.width, ch = els.canvas.height;
  const scale = Math.max(cw / image.width, ch / image.height);
  const w = image.width * scale, h = image.height * scale;
  ctx.clearRect(0, 0, cw, ch);
  ctx.drawImage(image, (cw - w) / 2, (ch - h) / 2, w, h);
}

function createSample() {
  const source = document.createElement("canvas");
  source.width = 1200; source.height = 820;
  const ctx = source.getContext("2d");
  const sky = ctx.createLinearGradient(0, 0, 0, source.height);
  sky.addColorStop(0, "#224f68"); sky.addColorStop(.48, "#ea6c4d"); sky.addColorStop(1, "#201923");
  ctx.fillStyle = sky; ctx.fillRect(0, 0, source.width, source.height);
  ctx.fillStyle = "#ffd66d"; ctx.beginPath(); ctx.arc(840, 290, 115, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(32,25,35,.72)";
  for (let x = -120; x < 1300; x += 150) {
    const height = 130 + ((x * 17) % 180 + 180) % 180;
    ctx.fillRect(x, source.height - height, 118, height);
  }
  ctx.strokeStyle = "rgba(255,235,180,.32)"; ctx.lineWidth = 9;
  for (let i = 0; i < 7; i++) {
    ctx.beginPath(); ctx.moveTo(0, 520 + i * 33); ctx.bezierCurveTo(280, 470 + i * 24, 570, 650 - i * 10, 1200, 540 + i * 31); ctx.stroke();
  }
  return source;
}

async function analyzeSource(source, name) {
  const sample = document.createElement("canvas");
  sample.width = 96; sample.height = 96;
  const sctx = sample.getContext("2d", { willReadFrequently: true });
  const scale = Math.max(96 / source.width, 96 / source.height);
  const width = source.width * scale, height = source.height * scale;
  sctx.drawImage(source, (96 - width) / 2, (96 - height) / 2, width, height);
  const imageData = sctx.getImageData(0, 0, 96, 96);
  const data = imageData.data;
  const hash = await digestPixels(data);
  const seed = parseInt(hash.slice(0, 8), 16);
  const random = mulberry32(seed);

  let totalL = 0, totalS = 0, hueX = 0, hueY = 0, edges = 0;
  const slices = Array.from({ length: STEPS }, () => ({ l: 0, s: 0, hx: 0, hy: 0, edge: 0, yWeight: 0, count: 0 }));
  for (let y = 0; y < 96; y++) {
    for (let x = 0; x < 96; x++) {
      const i = (y * 96 + x) * 4;
      const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      const slice = slices[Math.min(STEPS - 1, Math.floor(x / (96 / STEPS)))];
      totalL += l; totalS += s; hueX += Math.cos(h * Math.PI * 2) * s; hueY += Math.sin(h * Math.PI * 2) * s;
      slice.l += l; slice.s += s; slice.hx += Math.cos(h * Math.PI * 2) * s; slice.hy += Math.sin(h * Math.PI * 2) * s;
      slice.yWeight += (1 - y / 95) * (s * .45 + l * .55); slice.count++;
      if (x > 0) {
        const pi = i - 4;
        const diff = (Math.abs(data[i] - data[pi]) + Math.abs(data[i + 1] - data[pi + 1]) + Math.abs(data[i + 2] - data[pi + 2])) / 765;
        if (diff > .16) { edges++; slice.edge++; }
      }
    }
  }

  const pixels = 96 * 96;
  const avgL = totalL / pixels, avgS = totalS / pixels;
  let hue = Math.atan2(hueY, hueX) / (Math.PI * 2); if (hue < 0) hue += 1;
  const edgeRatio = edges / pixels;
  const root = Math.floor(hue * 12) % 12;
  const mode = avgL < .38 ? MODES.deep : avgS > .48 ? MODES.bright : MODES.soft;
  const bpm = Math.round(72 + clamp(edgeRatio * 260, 0, 44) + Math.floor(random() * 7));

  const events = slices.map((slice, index) => {
    const l = slice.l / slice.count;
    const s = slice.s / slice.count;
    let sh = Math.atan2(slice.hy, slice.hx) / (Math.PI * 2); if (sh < 0) sh += 1;
    const vertical = slice.yWeight / slice.count;
    const degree = Math.floor(clamp((vertical * .7 + l * .3) * mode.notes.length * 1.8, 0, mode.notes.length * 2 - .01));
    const octave = degree >= mode.notes.length ? 1 : 0;
    const scaleNote = mode.notes[degree % mode.notes.length];
    const hashNudge = parseInt(hash.slice((index * 2) % 48, (index * 2) % 48 + 2), 16) % 3 - 1;
    const midi = 57 + root + scaleNote + octave * 12 + (index % 4 === 3 ? hashNudge : 0);
    const density = clamp(slice.edge / slice.count * 10, 0, 1);
    return { midi, velocity: .16 + l * .3 + s * .1, density, hue: sh, height: clamp(12 + (midi - 54) * 2.1, 8, 48) };
  });

  composition = { name, hash, root, mode, bpm, avgL, avgS, edgeRatio, events, duration: 16 * (60 / bpm) * .5 };
  renderComposition();
}

function renderComposition() {
  const c = composition;
  els.title.textContent = c.name.replace(/\.[^.]+$/, "").slice(0, 20) || "未命名图像";
  els.status.textContent = "可以演奏"; els.status.className = "status-pill ready";
  els.key.textContent = `${SCALE_NAMES[c.root]} · ${c.mode.name}`;
  els.tempo.textContent = `${c.bpm} BPM`;
  els.color.textContent = c.avgS > .5 ? "浓郁" : c.avgS > .27 ? "柔和" : "低饱和";
  els.texture.textContent = c.edgeRatio > .12 ? "繁复" : c.edgeRatio > .065 ? "适中" : "平静";
  els.fingerprint.textContent = c.hash.slice(0, 16).toUpperCase().match(/.{1,4}/g).join(" ");
  els.stageLabel.textContent = "PIXELMUSIC 0.1";
  els.uploadLabel.textContent = "更换图片";
  els.play.disabled = false;
  els.empty.classList.add("hidden"); els.dropZone.classList.add("has-image");
  els.noteRail.innerHTML = c.events.map((e, i) => `<i class="note-bar" data-step="${i}" style="height:${e.height}px"></i>`).join("");
}

async function loadFile(file) {
  if (!file || !file.type.startsWith("image/")) return showToast("请选择 JPG、PNG 或 WEBP 图片");
  if (file.size > 12 * 1024 * 1024) return showToast("图片请小于 12MB");
  stopPlayback();
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.onload = async () => {
    currentSource = image;
    drawCover(image);
    await analyzeSource(image, file.name);
    URL.revokeObjectURL(url);
  };
  image.onerror = () => { URL.revokeObjectURL(url); showToast("这张图片暂时无法读取"); };
  image.src = url;
}

function loadSample() {
  stopPlayback();
  currentSource = createSample();
  drawCover(currentSource);
  analyzeSource(currentSource, "黄昏样本");
}

function midiToFreq(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

function currentTone() { return document.querySelector('input[name="tone"]:checked').value; }

function makeVoice(freq, start, duration, gainValue, tone) {
  const master = audioContext.createGain();
  const filter = audioContext.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(tone === "glass" ? 5200 : tone === "warm" ? 1900 : 1100, start);
  master.gain.setValueAtTime(0.0001, start);
  master.gain.exponentialRampToValueAtTime(Math.max(.001, gainValue), start + (tone === "mist" ? .18 : .025));
  master.gain.exponentialRampToValueAtTime(.0001, start + duration);
  master.connect(filter); filter.connect(audioContext.destination);

  const types = tone === "glass" ? ["sine", "triangle"] : tone === "warm" ? ["triangle", "sine"] : ["sawtooth", "sine"];
  types.forEach((type, index) => {
    const osc = audioContext.createOscillator();
    const mix = audioContext.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq * (index ? (tone === "glass" ? 2 : 1.003) : 1), start);
    mix.gain.value = index ? .2 : tone === "mist" ? .32 : .72;
    osc.connect(mix); mix.connect(master);
    osc.start(start); osc.stop(start + duration + .05);
    scheduledNodes.push(osc);
  });
}

function scheduleComposition() {
  const c = composition, tone = currentTone();
  const stepDuration = (60 / c.bpm) * .5;
  const start = audioContext.currentTime + .08;
  const bassRoot = 36 + c.root;
  c.events.forEach((event, index) => {
    const t = start + index * stepDuration;
    makeVoice(midiToFreq(event.midi), t, stepDuration * (tone === "mist" ? 1.8 : .88), event.velocity, tone);
    if (index % 4 === 0) makeVoice(midiToFreq(bassRoot + (index % 8 === 4 ? 7 : 0)), t, stepDuration * 3.5, .09, tone);
    if (event.density > .56) makeVoice(midiToFreq(event.midi + 12), t + stepDuration / 2, stepDuration * .35, event.velocity * .36, tone);
  });
  playStartedAt = performance.now() + 80;
  animatePlayback();
}

async function togglePlayback() {
  if (!composition) return;
  if (isPlaying) return stopPlayback();
  audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === "suspended") await audioContext.resume();
  isPlaying = true;
  els.play.classList.add("is-playing"); els.playLabel.textContent = "停止演奏";
  els.status.textContent = "正在演奏"; els.status.className = "status-pill playing";
  scheduleComposition();
}

function animatePlayback() {
  if (!isPlaying || !composition) return;
  const elapsed = Math.max(0, (performance.now() - playStartedAt) / 1000);
  const progress = clamp(elapsed / composition.duration, 0, 1);
  const step = Math.min(STEPS - 1, Math.floor(progress * STEPS));
  els.scanLine.classList.add("active");
  els.scanLine.style.transform = `translateX(${progress * els.dropZone.clientWidth}px)`;
  els.scanLine.firstElementChild.textContent = String(step + 1).padStart(2, "0");
  els.stepLabel.textContent = `${String(step + 1).padStart(2, "0")} / ${STEPS}`;
  document.querySelectorAll(".note-bar").forEach((bar, index) => bar.classList.toggle("active", index === step));
  if (progress >= 1) return stopPlayback(false);
  animationId = requestAnimationFrame(animatePlayback);
}

function stopPlayback(resetAudio = true) {
  cancelAnimationFrame(animationId);
  scheduledNodes.forEach(node => { try { node.stop(); } catch (_) {} });
  scheduledNodes = [];
  isPlaying = false;
  els.play.classList.remove("is-playing"); els.playLabel.textContent = "开始听画";
  els.scanLine.classList.remove("active"); els.scanLine.style.transform = "translateX(0)";
  els.stepLabel.textContent = "00 / 16";
  document.querySelectorAll(".note-bar").forEach(bar => bar.classList.remove("active"));
  if (composition) { els.status.textContent = "可以演奏"; els.status.className = "status-pill ready"; }
  if (resetAudio && audioContext?.state === "running") audioContext.suspend();
}

function showToast(message) {
  els.toast.textContent = message; els.toast.classList.add("show");
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => els.toast.classList.remove("show"), 2600);
}

els.file.addEventListener("change", event => loadFile(event.target.files[0]));
els.play.addEventListener("click", togglePlayback);
els.sample.addEventListener("click", loadSample);
document.querySelectorAll('input[name="tone"]').forEach(input => input.addEventListener("change", () => { if (isPlaying) { stopPlayback(); togglePlayback(); } }));

["dragenter", "dragover"].forEach(type => els.dropZone.addEventListener(type, event => { event.preventDefault(); els.dropZone.classList.add("dragging"); }));
["dragleave", "drop"].forEach(type => els.dropZone.addEventListener(type, event => { event.preventDefault(); els.dropZone.classList.remove("dragging"); }));
els.dropZone.addEventListener("drop", event => loadFile(event.dataTransfer.files[0]));
let resizeTimer;
window.addEventListener("resize", () => {
  if (!currentSource) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => drawCover(currentSource), 80);
});
