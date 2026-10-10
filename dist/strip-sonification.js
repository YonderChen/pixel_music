(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./music.js') : root.PixelMusic,
    typeof module === 'object' && module.exports ? require('./image-analysis.js') : root.PixelMusicImage);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PixelMusicStrips = api;
})(typeof globalThis === 'object' ? globalThis : this, function (Music, Image) {
  'use strict';
  const VERSION = 'strip-sonification-v1', WIDTH = 192, HEIGHT = 120, STRIPS = 32;
  const RULES = Object.freeze({ darkThreshold: .012, maxJump: 7, minMidi: 48, maxMidi: 72, totalBeats: 32, tailSeconds: 1.5 });
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const fixed = n => Math.round(n * 1e6) / 1e6;
  const pc = n => (n % 12 + 12) % 12;
  const nearest = (target, candidates) => candidates.reduce((a, b) => Math.abs(b - target) < Math.abs(a - target) ? b : a);

  function analyze(data) {
    if (data.length !== WIDTH * HEIGHT * 4) throw new Error('需要 192×120 的规范化图片');
    const strips = Array.from({ length: STRIPS }, (_, index) => ({ id: `strip-${index}`, index,
      rect: { x: index / STRIPS, y: 0, width: 1 / STRIPS, height: 1 }, sum: 0, squares: 0, weightedY: 0, count: 0 }));
    const luminance = new Float64Array(WIDTH * HEIGHT);
    let sum = 0, squares = 0, hueX = 0, hueY = 0, saturation = 0, edges = 0, pairs = 0;
    for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
      const index = y * WIDTH + x, offset = index * 4, alpha = data[offset + 3] / 255;
      const r = data[offset] * alpha, g = data[offset + 1] * alpha, b = data[offset + 2] * alpha;
      const value = (.2126 * r + .7152 * g + .0722 * b) / 255;
      const [h, s, l] = Image.rgbToHsl(r, g, b), chroma = s * (1 - Math.abs(2 * l - 1));
      hueX += chroma * Math.cos(h * Math.PI * 2); hueY += chroma * Math.sin(h * Math.PI * 2); saturation += s;
      const strip = strips[Math.floor(x / (WIDTH / STRIPS))];
      strip.sum += value; strip.squares += value * value; strip.weightedY += value * y; strip.count++;
      luminance[index] = value; sum += value; squares += value * value;
      if (x) { edges += Math.abs(value - luminance[index - 1]); pairs++; }
      if (y) { edges += Math.abs(value - luminance[index - WIDTH]); pairs++; }
    }
    const count = WIDTH * HEIGHT, brightness = sum / count, contrast = Math.sqrt(Math.max(0, squares / count - brightness * brightness));
    const hueReliability = Math.hypot(hueX, hueY) / count;
    const hue = (Math.atan2(hueY, hueX) / (Math.PI * 2) + 1) % 1;
    const texture = clamp(edges / pairs / .12, 0, 1);
    return { version: VERSION, imageHash: Image.digestPixels(data), brightness: fixed(brightness), contrast: fixed(contrast),
      saturation: fixed(saturation / count), hue: fixed(hue), hueReliability: fixed(hueReliability), texture: fixed(texture),
      root: hueReliability < .08 ? 0 : Math.round(hue * 12) % 12,
      modeId: brightness < .34 ? 'deep' : saturation / count > .56 ? 'bright' : 'soft',
      bpm: clamp(Math.round(80 + 32 * contrast + 10 * texture), 80, 100),
      strips: strips.map(strip => {
        const mean = strip.sum / strip.count;
        return { id: strip.id, index: strip.index, rect: strip.rect, brightness: fixed(mean),
          contrast: fixed(Math.sqrt(Math.max(0, strip.squares / strip.count - mean * mean))),
          centroid: mean < RULES.darkThreshold ? null : fixed(strip.weightedY / strip.sum / (HEIGHT - 1)) };
      }) };
  }

  function accompaniment(analysis, score) {
    if (!score.melody.length) return { bassEvents: [], padEvents: [] };
    const scale = score.mode.notes, stride = analysis.texture + analysis.contrast > .4 ? 4 : 8;
    const progression = analysis.contrast < .005 ? [0, 0, 0, 0] : analysis.texture > .2 ? [0, scale.length - 2, 3, 0] : [0, 3, 4, 0];
    const bassEvents = [], padEvents = []; let previous = null;
    for (let beat = 0; beat < RULES.totalBeats; beat += stride) {
      const degree = progression[Math.floor(beat / 8)] % scale.length;
      const chord = [0, 2, 4].map(step => pc(score.root + scale[(degree + step) % scale.length]));
      const candidates = [];
      for (let inversion = 0; inversion < 3; inversion++) {
        const pitches = chord.slice().sort((a, b) => a - b).map(n => 48 + n);
        for (let i = 0; i < inversion; i++) pitches.push(pitches.shift() + 12);
        for (const shift of [-12, 0, 12]) {
          const v = pitches.map(n => n + shift);
          if (v.every(n => n >= 45 && n <= 72)) candidates.push(v);
        }
      }
      candidates.sort((a, b) => {
        const cost = v => v.reduce((n, pitch, i) => n + Math.abs(pitch - (previous?.[i] ?? (50 + 4 * i))), 0);
        return cost(a) - cost(b) || a[0] - b[0];
      });
      previous = candidates[0];
      const origin = { type: 'global', reason: '全图特征＋音阶内和声规则', brightness: analysis.brightness, contrast: analysis.contrast, texture: analysis.texture };
      const length = stride - .35;
      bassEvents.push({ id: `bass-${beat}`, voice: 'bass', beat, beats: stride, durationBeats: Math.min(2.4, length),
        midi: 36 + pc(score.root + scale[degree]), velocity: .028, send: .015, envelope: 'pluck', origin });
      padEvents.push({ id: `chord-${beat}`, voice: 'chord', beat, beats: stride, durationBeats: length,
        midi: previous, velocity: fixed(.013 + analysis.brightness * .007), send: .018, envelope: 'sustain', origin });
    }
    return { bassEvents, padEvents };
  }

  function compose(analysis, options = {}) {
    const root = options.root ?? analysis.root, mode = Music.modeOf(options.modeId || analysis.modeId), bpm = options.bpm ?? analysis.bpm;
    if (!(bpm >= 80 && bpm <= 100) || !(root >= 0 && root < 12)) throw new Error('调性或速度超出范围');
    const allowed = [];
    for (let n = RULES.minMidi; n <= RULES.maxMidi; n++) if (mode.notes.includes(pc(n - root))) allowed.push(n);
    let previous = null;
    const strips = analysis.strips.map(strip => {
      const result = { ...strip, beat: strip.index, beats: 1, targetMidi: null, midi: null, eventId: null, reason: '亮度不足，主旋律休止' };
      if (strip.centroid === null) { previous = null; return result; }
      const rawMidi = fixed(RULES.maxMidi - strip.centroid * (RULES.maxMidi - RULES.minMidi));
      const targetMidi = nearest(rawMidi, allowed);
      const candidates = previous === null ? allowed : allowed.filter(n => Math.abs(n - previous) <= RULES.maxJump);
      const midi = nearest(targetMidi, candidates);
      Object.assign(result, { rawMidi, targetMidi, midi, reason: midi !== targetMidi ? '音阶内压缩大跳进' : '亮部重心映射，量化到音阶',
        velocity: fixed(.095 + .025 * strip.brightness + .045 * strip.contrast) });
      previous = midi; return result;
    });
    const melody = [], rests = [];
    for (const strip of strips) {
      if (strip.midi === null) { rests.push({ beat: strip.beat, beats: 1, reason: strip.reason, stripId: strip.id }); continue; }
      let event = melody.at(-1);
      if (!event || event.beat + event.beats !== strip.beat || event.midi !== strip.midi) {
        event = { id: `melody-${melody.length}`, voice: 'melody', beat: strip.beat, beats: 0, midi: strip.midi,
          noteName: Music.midiToName(strip.midi), velocity: 0, send: .008, envelope: 'pluck', sourceRefs: [], origin: 'image-strip' };
        melody.push(event);
      }
      event.velocity = fixed((event.velocity * event.beats + strip.velocity) / (event.beats + 1));
      event.beats++; event.durationBeats = event.beats - .12;
      event.sourceRefs.push({ stripId: strip.id, rect: strip.rect, centroid: strip.centroid, targetMidi: strip.targetMidi, reason: strip.reason });
      strip.eventId = event.id;
    }
    const score = { version: VERSION, mappingVersion: VERSION, normalizationVersion: 'canvas-cover-black-v1',
      imageHash: analysis.imageHash, root, mode, bpm, secondsPerBeat: 60 / bpm, totalBeats: RULES.totalBeats,
      melody, performanceEvents: melody, strips, rests,
      performanceRests: melody.map(e => ({ beat: fixed(e.beat + e.durationBeats), beats: .12, sourceEventId: e.id, reason: '奏法收尾留白' })), regionMap: [],
      melodyDuration: RULES.totalBeats * 60 / bpm, duration: RULES.totalBeats * 60 / bpm + RULES.tailSeconds,
      analysis, ...accompaniment(analysis, { root, mode, melody }) };
    for (const event of [...melody, ...score.bassEvents, ...score.padEvents]) {
      event.startTime = fixed(event.beat * score.secondsPerBeat);
      event.duration = fixed(event.durationBeats * score.secondsPerBeat);
    }
    score.mappingFingerprint = Music.digestText(JSON.stringify(strips.map(s => [s.id, s.rect, s.centroid, s.targetMidi, s.midi, s.eventId])));
    const audible = e => [e.beat, e.durationBeats, e.midi, e.velocity, e.envelope, e.send];
    score.scoreHash = Music.digestText(JSON.stringify({ version: VERSION, root, mode: mode.id, bpm,
      melody: melody.map(audible), bass: score.bassEvents.map(audible), chords: score.padEvents.map(audible) }));
    return score;
  }

  function position(score, seconds) {
    const beat = Math.max(0, seconds) / score.secondsPerBeat, tail = beat >= score.totalBeats;
    const active = score.melody.filter(e => beat >= e.beat && beat < e.beat + e.durationBeats);
    return { beat, tail, finished: seconds >= score.duration, index: tail ? -1 : Math.min(STRIPS - 1, Math.floor(beat)),
      scanFraction: clamp(beat / STRIPS, 0, 1), active,
      activeStripIds: active.flatMap(e => e.sourceRefs.map(r => r.stripId)),
      accompaniment: [...score.bassEvents, ...score.padEvents].filter(e => beat >= e.beat && beat < e.beat + e.durationBeats) };
  }
  return { VERSION, WIDTH, HEIGHT, STRIPS, RULES, analyze, compose, position };
});
