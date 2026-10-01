const STEPS = 24;
const REGION_ROWS = 5;
const SAMPLE_WIDTH = 192;
const SAMPLE_HEIGHT = 120;
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
  regionGrid: document.querySelector("#regionGrid"),
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
  const hashes = [2166136261, 2246822507, 3266489909, 668265263, 374761393, 1274126177, 198491317, 42595009];
  for (const byte of bytes) {
    for (let i = 0; i < hashes.length; i++) {
      hashes[i] = Math.imul((hashes[i] ^ byte ^ i) >>> 0, 16777619 + i * 2) >>> 0;
    }
  }
  return hashes.map(hash => hash.toString(16).padStart(8, "0")).join("");
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
  sample.width = SAMPLE_WIDTH; sample.height = SAMPLE_HEIGHT;
  const sctx = sample.getContext("2d", { willReadFrequently: true });
  const scale = Math.max(SAMPLE_WIDTH / source.width, SAMPLE_HEIGHT / source.height);
  const width = source.width * scale, height = source.height * scale;
  sctx.drawImage(source, (SAMPLE_WIDTH - width) / 2, (SAMPLE_HEIGHT - height) / 2, width, height);
  const imageData = sctx.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
  const data = imageData.data;
  const hash = await digestPixels(data);
  const seed = parseInt(hash.slice(0, 8), 16);
  const random = mulberry32(seed);

  let totalL = 0, totalS = 0, hueX = 0, hueY = 0, edges = 0;
  const regions = Array.from({ length: STEPS * REGION_ROWS }, () => ({ l: 0, s: 0, hx: 0, hy: 0, edge: 0, count: 0 }));
  for (let y = 0; y < SAMPLE_HEIGHT; y++) {
    for (let x = 0; x < SAMPLE_WIDTH; x++) {
      const i = (y * SAMPLE_WIDTH + x) * 4;
      const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
      const col = Math.min(STEPS - 1, Math.floor(x / (SAMPLE_WIDTH / STEPS)));
      const row = Math.min(REGION_ROWS - 1, Math.floor(y / (SAMPLE_HEIGHT / REGION_ROWS)));
      const region = regions[row * STEPS + col];
      totalL += l; totalS += s; hueX += Math.cos(h * Math.PI * 2) * s; hueY += Math.sin(h * Math.PI * 2) * s;
      region.l += l; region.s += s; region.hx += Math.cos(h * Math.PI * 2) * s; region.hy += Math.sin(h * Math.PI * 2) * s; region.count++;
      if (x > 0) {
        const pi = i - 4;
        const diff = (Math.abs(data[i] - data[pi]) + Math.abs(data[i + 1] - data[pi + 1]) + Math.abs(data[i + 2] - data[pi + 2])) / 765;
        if (diff > .16) { edges++; region.edge++; }
      }
    }
  }

  const pixels = SAMPLE_WIDTH * SAMPLE_HEIGHT;
  const avgL = totalL / pixels, avgS = totalS / pixels;
  let hue = Math.atan2(hueY, hueX) / (Math.PI * 2); if (hue < 0) hue += 1;
  const edgeRatio = edges / pixels;
  const root = Math.floor(hue * 12) % 12;
  const mode = avgL < .38 ? MODES.deep : avgS > .48 ? MODES.bright : MODES.soft;
  const bpm = Math.round(72 + clamp(edgeRatio * 260, 0, 44) + Math.floor(random() * 7));

  const columns = Array.from({ length: STEPS }, (_, col) => {
    const notes = Array.from({ length: REGION_ROWS }, (_, row) => {
      const region = regions[row * STEPS + col];
      const l = region.l / region.count;
      const s = region.s / region.count;
      let regionHue = Math.atan2(region.hy, region.hx) / (Math.PI * 2); if (regionHue < 0) regionHue += 1;
      const hashIndex = (row * STEPS + col) % 56;
      const hashValue = parseInt(hash.slice(hashIndex, hashIndex + 2), 16);
      const hueDegree = Math.floor(regionHue * mode.notes.length);
      const lightDegree = Math.floor(l * 3);
      const degree = (hueDegree + lightDegree + hashValue % 2) % mode.notes.length;
      const octaveBase = [72, 67, 60, 53, 43][row];
      const midi = octaveBase + root + mode.notes[degree] + (l > .68 ? 12 : 0);
      const density = clamp(region.edge / region.count * 12, 0, 1);
      return {
        midi,
        noteName: midiToName(midi),
        velocity: .025 + l * .035 + s * .025 + density * .018,
        density,
        row,
        col,
      };
    });
    const averageMidi = notes.reduce((sum, note) => sum + note.midi, 0) / notes.length;
    return { notes, height: clamp(8 + (averageMidi - 48) * 1.5, 8, 48) };
  });

  const stepDuration = 60 / bpm;
  composition = { name, hash, root, mode, bpm, avgL, avgS, edgeRatio, columns, duration: STEPS * stepDuration };
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
  els.stageLabel.textContent = `${STEPS * REGION_ROWS} REGIONS · 点击区域试听`;
  els.uploadLabel.textContent = "更换图片";
  els.play.disabled = false;
  els.empty.classList.add("hidden"); els.dropZone.classList.add("has-image");
  els.noteRail.innerHTML = c.columns.map((column, i) => `<i class="note-bar" data-step="${i}" style="height:${column.height}px"></i>`).join("");
  els.regionGrid.innerHTML = c.columns.flatMap((column, col) =>
    column.notes.map((note, row) => `<button class="region-cell" type="button" style="grid-column:${col + 1};grid-row:${row + 1}" data-col="${col}" data-row="${row}" data-note="${note.noteName}" aria-label="第 ${col + 1} 列第 ${row + 1} 区域，音符 ${note.noteName}"></button>`)
  ).join("");
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

function midiToName(midi) {
  const names = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`;
}

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
  const stepDuration = 60 / c.bpm;
  const start = audioContext.currentTime + .08;
  const bassRoot = 36 + c.root;
  c.columns.forEach((column, index) => {
    const t = start + index * stepDuration;
    const spread = stepDuration * .68 / REGION_ROWS;
    column.notes.slice().reverse().forEach((note, noteIndex) => {
      makeVoice(midiToFreq(note.midi), t + noteIndex * spread, stepDuration * (tone === "mist" ? 1.7 : .72), note.velocity, tone);
    });
    if (index % 4 === 0) makeVoice(midiToFreq(bassRoot + (index % 8 === 4 ? 7 : 0)), t, stepDuration * 3.4, .065, tone);
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
  document.querySelectorAll(".region-cell").forEach(cell => cell.classList.toggle("active", Number(cell.dataset.col) === step));
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
  els.stepLabel.textContent = `00 / ${STEPS}`;
  document.querySelectorAll(".note-bar").forEach(bar => bar.classList.remove("active"));
  document.querySelectorAll(".region-cell").forEach(cell => cell.classList.remove("active"));
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
els.regionGrid.addEventListener("click", async event => {
  const cell = event.target.closest(".region-cell");
  if (!cell || !composition) return;
  audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
  if (audioContext.state === "suspended") await audioContext.resume();
  const note = composition.columns[Number(cell.dataset.col)].notes[Number(cell.dataset.row)];
  makeVoice(midiToFreq(note.midi), audioContext.currentTime + .02, .65, .12, currentTone());
  cell.classList.add("preview");
  setTimeout(() => cell.classList.remove("preview"), 420);
});
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
