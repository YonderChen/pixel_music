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
let currentSource = null;
let audioBus = null;
let playbackStart = 0;

// Two image columns form a four-beat bar; every region still owns one melody event.
function arrangeRegions(columns, root, mode) {
  const minor = mode === MODES.deep;
  const harmonyScale = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const progression = [0, 5, 3, 4, 0, 5, 3, 4, 3, 1, 4, 0];
  const raw = columns.flatMap((column, col) => col % 2 ? column.notes.slice().reverse() : column.notes);
  const phraseContour = [0, 2, 4, 3, 2, 1, 2, 4, 3, 1];
  const motif = raw.slice(0, 10).map((note, index) =>
    phraseContour[index] + Math.round((note.light - .5) * 2 + (note.hue - .5) * 2)
  );
  const rhythm = [.5, .25, .25, .5, .5, .25, .25, .5, .5, .5];
  const closingRhythm = [.5, .25, .25, .5, .25, .25, .25, .25, .5, 1];
  const tonic = 60 + root;
  const allowed = [];
  for (let octave = -1; octave <= 2; octave++) {
    for (const degree of mode.notes) {
      const midi = tonic + octave * 12 + degree;
      if (midi >= tonic - 5 && midi <= tonic + 14) allowed.push(midi);
    }
  }
  let previous = tonic + 4;
  let beat = 0;
  const bars = progression.map((degree, index) => {
    const chord = [degree, degree + 2, degree + 4].map(d => harmonyScale[d % 7] + Math.floor(d / 7) * 12);
    return { index, beat: index * 4, chord, bass: 36 + root + harmonyScale[degree] };
  });
  const melody = raw.map((region, index) => {
    const barIndex = Math.floor(index / 10), position = index % 10;
    const bar = bars[barIndex];
    const beats = (barIndex === 11 ? closingRhythm : rhythm)[position];
    const strong = Math.abs(beat - Math.round(beat)) < .001;
    const pitchClasses = bar.chord.map(pitch => pitch % 12);
    const contour = clamp(motif[position] + (barIndex >= 4 && barIndex < 8 ? 1 : 0), 0, mode.notes.length);
    const motifPitch = mode.notes[contour % mode.notes.length] + Math.floor(contour / mode.notes.length) * 12;
    const regionalOffset = (region.light - .5) * 3 + (2 - region.row) * .35 + region.density * .6 + (region.signature ?? 0) * .5;
    const closing = index >= raw.length - 4;
    const target = closing ? tonic + Math.max(0, 3 - (index - (raw.length - 4))) : tonic + motifPitch + regionalOffset;
    const harmonicCandidates = allowed.filter(midi =>
      (!strong || pitchClasses.includes((midi - tonic + 12) % 12)) && (!closing || midi <= tonic + 7)
    );
    const nearby = harmonicCandidates.filter(midi => Math.abs(midi - previous) <= 7);
    const candidates = nearby.length ? nearby : harmonicCandidates;
    const last = index === raw.length - 1;
    const midi = last ? tonic : candidates.reduce((best, value) => {
      const score = pitch => Math.abs(pitch - target) + Math.abs(pitch - previous) * .3 + Math.max(0, Math.abs(pitch - previous) - 5) * 5;
      return score(value) < score(best) ? value : best;
    }, candidates[0]);
    previous = midi;
    const event = { ...region, midi, noteName: midiToName(midi), index, beat, beats, bar: barIndex, strong };
    Object.assign(region, { midi, noteName: event.noteName, sequence: index });
    beat += beats;
    return event;
  });
  return { melody, bars, totalBeats: beat };
}

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
      const density = clamp(region.edge / region.count * 12, 0, 1);
      return {
        velocity: .025 + l * .035 + s * .025 + density * .018,
        density,
        light: l,
        hue: regionHue,
        signature: hashValue / 255 - .5,
        row,
        col,
      };
    });
    return { notes };
  });

  const arrangement = arrangeRegions(columns, root, mode);
  const secondsPerBeat = 60 / bpm;
  const melodyDuration = arrangement.totalBeats * secondsPerBeat;
  composition = { name, hash, root, mode, bpm, avgL, avgS, edgeRatio, columns, ...arrangement, secondsPerBeat, melodyDuration, duration: melodyDuration + 1.8 };
  columns.forEach(column => {
    const averageMidi = column.notes.reduce((sum, note) => sum + note.midi, 0) / REGION_ROWS;
    column.height = clamp(10 + (averageMidi - 58) * 2, 8, 48);
  });
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
  els.stageLabel.textContent = `120 音 · 12 小节 · ${Math.round(c.duration)} 秒`;
  els.uploadLabel.textContent = "更换图片";
  els.play.disabled = false;
  els.empty.classList.add("hidden"); els.dropZone.classList.add("has-image");
  els.noteRail.innerHTML = c.columns.map((column, i) => `<i class="note-bar" data-step="${i}" style="height:${column.height}px"></i>`).join("");
  els.regionGrid.innerHTML = c.columns.flatMap((column, col) =>
    column.notes.map((note, row) => {
      const sequence = note.sequence;
      return `<button class="region-cell" type="button" style="grid-column:${col + 1};grid-row:${row + 1}" data-col="${col}" data-row="${row}" data-sequence="${sequence}" data-note="${note.noteName}" aria-label="第 ${col + 1} 列第 ${row + 1} 区域，音符 ${note.noteName}"></button>`;
    })
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

function prepareAudio() {
  audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
  if (audioBus) return;
  audioBus = audioContext.createGain();
  const compressor = audioContext.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.ratio.value = 3;
  const delay = audioContext.createDelay(1);
  const feedback = audioContext.createGain();
  const wet = audioContext.createGain();
  const damp = audioContext.createBiquadFilter();
  delay.delayTime.value = .24;
  feedback.gain.value = .18;
  wet.gain.value = .14;
  damp.type = "lowpass"; damp.frequency.value = 2200;
  audioBus.connect(compressor);
  audioBus.connect(delay); delay.connect(damp); damp.connect(wet); wet.connect(compressor);
  damp.connect(feedback); feedback.connect(delay);
  compressor.connect(audioContext.destination);
}

function makeVoice(freq, start, duration, gainValue, tone, attackOverride = null) {
  const master = audioContext.createGain();
  const filter = audioContext.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(tone === "glass" ? 5200 : tone === "warm" ? 1900 : 1100, start);
  const attack = attackOverride ?? (tone === "mist" ? .18 : .025);
  const peak = Math.max(.001, gainValue);
  master.gain.setValueAtTime(0.0001, start);
  master.gain.exponentialRampToValueAtTime(peak, start + Math.min(attack, duration * .2));
  master.gain.exponentialRampToValueAtTime(peak * .68, start + duration * .7);
  master.gain.exponentialRampToValueAtTime(.0001, start + duration);
  master.connect(filter); filter.connect(audioBus);

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
    osc.onended = () => {
      osc.disconnect(); mix.disconnect();
      if (index === types.length - 1) { master.disconnect(); filter.disconnect(); }
      scheduledNodes = scheduledNodes.filter(node => node !== osc);
    };
  });
}

function scheduleComposition() {
  const c = composition, tone = currentTone();
  const start = audioContext.currentTime + .08;
  c.melody.forEach(note => {
    const noteDuration = note.beats * c.secondsPerBeat;
    const t = start + note.beat * c.secondsPerBeat;
    makeVoice(
      midiToFreq(note.midi),
      t,
      noteDuration + Math.min(.16, noteDuration * .32),
      (.09 + note.velocity * .65) * (note.strong ? 1 : .82),
      tone,
      Math.min(.05, noteDuration * .12)
    );
  });
  c.bars.forEach(bar => {
    const t = start + bar.beat * c.secondsPerBeat;
    makeVoice(midiToFreq(bar.bass), t, c.secondsPerBeat * 4.15, .035, "warm", .08);
    bar.chord.forEach((pitch, index) => {
      makeVoice(midiToFreq(48 + c.root + pitch), t + index * .025, c.secondsPerBeat * 4.2, .016, "mist", .24);
    });
  });
  playbackStart = start;
  animatePlayback();
}

async function togglePlayback() {
  if (!composition) return;
  if (isPlaying) return stopPlayback();
  prepareAudio();
  if (audioContext.state === "suspended") await audioContext.resume();
  isPlaying = true;
  els.play.classList.add("is-playing"); els.playLabel.textContent = "停止演奏";
  els.status.textContent = "正在演奏"; els.status.className = "status-pill playing";
  scheduleComposition();
}

function animatePlayback() {
  if (!isPlaying || !composition) return;
  const elapsed = Math.max(0, audioContext.currentTime - playbackStart);
  const totalNotes = STEPS * REGION_ROWS;
  let noteIndex = 0;
  while (noteIndex < totalNotes - 1 && composition.melody[noteIndex + 1].beat * composition.secondsPerBeat <= elapsed) noteIndex++;
  const note = composition.melody[noteIndex];
  const step = note.col;
  const columnStart = composition.melody[step * REGION_ROWS].beat;
  const nextColumn = composition.melody[(step + 1) * REGION_ROWS]?.beat ?? composition.totalBeats;
  const columnProgress = clamp((elapsed / composition.secondsPerBeat - columnStart) / (nextColumn - columnStart), 0, 1);
  els.scanLine.classList.add("active");
  els.scanLine.style.transform = `translateX(${(step + columnProgress) / STEPS * els.dropZone.clientWidth}px)`;
  els.scanLine.firstElementChild.textContent = note.noteName;
  els.stepLabel.textContent = `${String(noteIndex + 1).padStart(3, "0")} / ${totalNotes}`;
  document.querySelectorAll(".note-bar").forEach((bar, index) => bar.classList.toggle("active", index === step));
  document.querySelectorAll(".region-cell").forEach(cell => cell.classList.toggle("active", Number(cell.dataset.sequence) === noteIndex));
  if (elapsed >= composition.duration) return stopPlayback();
  animationId = requestAnimationFrame(animatePlayback);
}

function stopPlayback() {
  cancelAnimationFrame(animationId);
  scheduledNodes.forEach(node => { try { node.stop(); } catch (_) {} });
  scheduledNodes = [];
  isPlaying = false;
  els.play.classList.remove("is-playing"); els.playLabel.textContent = "开始听画";
  els.scanLine.classList.remove("active"); els.scanLine.style.transform = "translateX(0)";
  els.stepLabel.textContent = `000 / ${STEPS * REGION_ROWS}`;
  document.querySelectorAll(".note-bar").forEach(bar => bar.classList.remove("active"));
  document.querySelectorAll(".region-cell").forEach(cell => cell.classList.remove("active"));
  if (composition) { els.status.textContent = "可以演奏"; els.status.className = "status-pill ready"; }
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
  prepareAudio();
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
