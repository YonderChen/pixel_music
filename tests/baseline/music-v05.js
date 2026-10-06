(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./rhythm-v05.js') : root.PixelMusicRhythmV05, typeof module === 'object' && module.exports ? require('./timing-v05.js') : root.PixelMusicTimingV05);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PixelMusicV05 = api;
})(typeof globalThis === 'object' ? globalThis : this, function (Rhythm, Timing) {
  'use strict';
  const MODES = {
    bright: { id: 'bright', name: '明亮五声', notes: [0, 2, 4, 7, 9] },
    soft: { id: 'soft', name: '柔和大调', notes: [0, 2, 4, 5, 7, 9, 11] },
    deep: { id: 'deep', name: '深色小调', notes: [0, 2, 3, 5, 7, 8, 10] },
  };
  const PHRASES = ['主题呈示', '主题回应', '中段发展', '回归收束'];
  const HARMONIES = [
    { name: '温柔问答', degrees: [0, 0, 3, 4, 0, 5, 3, 0, 5, 3, 1, 4, 0, 3, 4, 0] },
    { name: '舒展回环', degrees: [0, 5, 3, 4, 0, 3, 4, 0, 5, 3, 4, 4, 0, 5, 4, 0] },
    { name: '静谧起伏', degrees: [0, 3, 0, 4, 0, 5, 3, 0, 3, 0, 1, 4, 0, 3, 4, 0] },
  ];
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const pc = n => (n % 12 + 12) % 12;
  const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
  const audibleValue = n => Math.round(n * 1e6) / 1e6;
  function comparePaths(a, b) {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  }
  const midiToName = midi => `${['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'][pc(midi)]}${Math.floor(midi / 12) - 1}`;
  const orderedRegions = columns => columns.flatMap((column, col) => col % 2 ? column.notes.slice().reverse() : column.notes);
  function digestText(text) {
    let a = 2166136261, b = 2246822507;
    for (let i = 0; i < text.length; i++) {
      a = Math.imul(a ^ text.charCodeAt(i), 16777619) >>> 0;
      b = Math.imul(b ^ text.charCodeAt(i), 3266489917) >>> 0;
    }
    return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
  }
  function modeOf(value) {
    const id = typeof value === 'string' ? value : value?.id || Object.keys(MODES).find(id => MODES[id].name === value?.name);
    return MODES[id] || MODES.soft;
  }
  function validateRegions(columns) {
    if (columns.length !== 24 || columns.some(c => c.notes.length !== 5)) throw new Error('需要 24×5 个图像区域');
    columns.forEach((column, col) => column.notes.forEach((note, row) => {
      if (note.col !== col || note.row !== row || !Number.isFinite(note.light) || !Number.isFinite(note.hue) || !Number.isFinite(note.density)) throw new Error('图像区域特征无效');
    }));
  }
  function summarize(regions) {
    return { light: mean(regions.map(n => n.light)), density: mean(regions.map(n => n.density)), saturation: mean(regions.map(n => n.saturation ?? .4)) };
  }
  function makeTheme(raw) {
    // Six spatially balanced bins: neither the left edge nor the most colourful pixel owns the theme.
    const anchors = Array.from({ length: 6 }, (_, bin) => {
      const start = bin * 20, slice = raw.slice(start, start + 20);
      const summary = summarize(slice);
      const representative = slice.map((note, index) => ({ note, index, turn: index ? Math.abs(note.light - slice[index - 1].light) : 0 }))
        .sort((a, b) => (b.turn * .3 + b.note.density * .15) - (a.turn * .3 + a.note.density * .15) || a.index - b.index)[0];
      const circularColour = mean(slice.map(n => Math.cos(n.hue * Math.PI * 2) * (n.saturation ?? .4)));
      return { regionId: `${representative.note.col}:${representative.note.row}`, light: summary.light, colour: circularColour, density: summary.density };
    });
    const delta = anchors.at(-1).light - anchors[0].light;
    const texture = mean(anchors.map(a => a.density));
    const kind = delta > .16 ? 'rising' : delta < -.16 ? 'falling' : texture > .65 ? 'wave' : 'arch';
    const shapes = { rising: [0, 1, 2, 4, 3, 1], falling: [3, 4, 2, 1, 2, 0], arch: [0, 2, 4, 3, 2, 1], wave: [0, 3, 2, 4, 1, 2] };
    const degrees = shapes[kind].map((degree, i) => clamp(degree + Math.round((anchors[i].light - .5) * 4 + anchors[i].colour * .8), 0, 5));
    return { kind, anchors, degrees, signature: digestText(JSON.stringify({ kind, degrees })) };
  }
  function chordVoicing(classes, previous, root) {
    const candidates = [];
    for (let low = 45; low <= 57; low++) for (let mid = low + 3; mid <= 64; mid++) for (let high = mid + 3; high <= 69; high++) {
      const notes = [low, mid, high];
      if (new Set(notes.map(n => pc(n - root))).size !== 3 || !notes.every(n => classes.includes(pc(n - root)))) continue;
      const target = previous || [48 + root % 5, 55 + root % 5, 60 + root % 5];
      const cost = notes.reduce((sum, n, i) => sum + Math.abs(n - target[i]), 0) + (high - low > 16 ? 3 : 0);
      candidates.push({ notes, cost });
    }
    candidates.sort((a, b) => a.cost - b.cost || a.notes[0] - b.notes[0] || a.notes[1] - b.notes[1] || a.notes[2] - b.notes[2]);
    return candidates[0].notes;
  }
  function makeBars(root, mode, summaries) {
    const scale = mode.id === 'deep' ? MODES.deep.notes : MODES.soft.notes;
    const selector = summaries.reduce((sum, s) => sum + s.density, 0) / 4;
    const harmonyIndex = selector > .55 ? 1 : summaries[0].light < .38 ? 2 : 0;
    let previous = null, previousBass = 36 + root;
    const bars = HARMONIES[harmonyIndex].degrees.map((degree, index) => {
      const chord = [degree, degree + 2, degree + 4].map(d => scale[d % 7] + Math.floor(d / 7) * 12);
      const classes = chord.map(pc);
      const voicing = chordVoicing(classes, previous, root); previous = voicing;
      const bassClass = pc(root + scale[degree]);
      const bassOptions = [bassClass + 24, bassClass + 36, bassClass + 48].filter(n => n >= 32 && n <= 48);
      bassOptions.sort((a, b) => Math.abs(a - previousBass) - Math.abs(b - previousBass) || a - b);
      let bass = bassOptions[0], bassRole = 'root';
      if (Math.abs(bass - previousBass) > 7 && index !== 15) {
        const fifthClass = pc(root + chord[2]);
        const fifths = [fifthClass + 24, fifthClass + 36, fifthClass + 48].filter(n => n >= 32 && n <= 48)
          .sort((a, b) => Math.abs(a - previousBass) - Math.abs(b - previousBass) || a - b);
        if (Math.abs(fifths[0] - previousBass) < Math.abs(bass - previousBass)) { bass = fifths[0]; bassRole = 'fifth'; }
      }
      previousBass = bass;
      return { index, beat: index * 4, chord, classes, voicing, bass, bassRole, phrase: Math.floor(index / 4), harmony: HARMONIES[harmonyIndex].name };
    });
    return { bars, harmonyIndex };
  }
  function metricalWeight(beat) {
    const position = beat % 4;
    return position === 0 ? 1 : position === 2 ? .7 : Number.isInteger(position) ? .38 : .16;
  }
  function candidateCost(pitch, event, state, tonic) {
    const delta = pitch - state.pitch, interval = Math.abs(delta);
    const repeating = pitch === state.pitch ? state.repeats + 1 : 0;
    let cost = Math.abs(pitch - event.target) * .8 + interval * .22 + Math.max(0, interval - 4) * .6;
    if (repeating > 1) cost += (repeating - 1) * .85;
    if (Math.abs(state.delta) >= 4 && Math.sign(delta) === Math.sign(state.delta)) cost += .8;
    if (!event.chordClasses.includes(pc(pitch - tonic))) cost += event.weight * .7 + .2;
    cost += Math.abs(pitch - event.endingPitch) * event.closingWeight;
    // Only a tiny local tie preference; no global-image hash avalanche.
    cost += ((event.localSeed >>> (pc(pitch) % 16)) & 3) * .003;
    return { cost, delta, repeating };
  }
  function searchPhrase(events, allowed, previous, tonic, width, fullCandidates) {
    let states = [{ pitch: previous, delta: 0, repeats: 0, pending: 0, cost: 0, path: [] }];
    for (const event of events) {
      let candidates = event.anchorPitch == null ? allowed.filter(pitch => pitch < event.peakPitch &&
        (event.weight !== 1 || event.chordClasses.includes(pc(pitch - tonic)))) : [event.anchorPitch];
      candidates.sort((a, b) => Math.abs(a - event.target) - Math.abs(b - event.target) || a - b);
      if (!fullCandidates) candidates = candidates.slice(0, 5);
      const next = [];
      for (const state of states) for (const pitch of candidates) {
        const chordTone = event.chordClasses.includes(pc(pitch - tonic));
        const step = Math.abs(pitch - state.pitch);
        if (step > 7 || (state.pending && step > 3)) continue;
        const pending = chordTone ? 0 : state.pending ? state.pending - 1 : 2;
        if (!chordTone && pending === 0) continue;
        const scored = candidateCost(pitch, event, state, tonic);
        next.push({ pitch, delta: scored.delta, repeats: scored.repeating, pending, cost: Math.round((state.cost + scored.cost) * 1e8) / 1e8, path: state.path.concat(pitch) });
      }
      next.sort((a, b) => a.cost - b.cost || comparePaths(a.path, b.path));
      // Keep distinct future-relevant states, not 24 copies of one local ending.
      const unique = new Map();
      for (const state of next) {
        const key = `${state.pitch}:${state.delta}:${state.repeats}:${state.pending}`;
        if (!unique.has(key)) unique.set(key, state);
        if (unique.size === width) break;
      }
      states = [...unique.values()];
      if (!states.length) return null;
    }
    return states.filter(s => !s.pending)[0] || null;
  }
  function arrangeRegions(columns, root, modeValue, options = {}) {
    validateRegions(columns);
    const mode = modeOf(modeValue), raw = orderedRegions(columns).map(n => ({ ...n }));
    const tonic = root <= 5 ? 60 + root : 48 + root;
    const theme = makeTheme(raw), summaries = Array.from({ length: 4 }, (_, p) => summarize(raw.slice(p * 30, p * 30 + 30)));
    const { bars, harmonyIndex } = makeBars(root, mode, summaries);
    const allowed = [];
    for (let midi = tonic; midi <= tonic + 14; midi++) if (mode.notes.includes(pc(midi - tonic))) allowed.push(midi);
    const peakBar = bars[10];
    const peakPitch = allowed.filter(midi => peakBar.classes.includes(pc(midi - tonic))).at(-1);
    const phraseEnds = [tonic + 7, tonic, tonic + 7, tonic];
    const rhythmPlan = Rhythm.plan(raw, options.rhythmStructure, options);
    const events = [], rests = rhythmPlan.rests;
    let rawIndex = 0;
    for (const bar of bars) {
      const rhythm = rhythmPlan.bars[bar.index];
      bar.rhythm = `generated-${bar.index}`; bar.rest = rhythm.rest; bar.activity = rhythm.activity; bar.noteCount = rhythm.count;
      rhythm.events.forEach(({ beat, beats: span, accent }) => {
        const region = raw[rawIndex], phrasePosition = rawIndex % 30;
        const motifIndex = Math.floor(phrasePosition / 5) % 6;
        const degree = theme.degrees[motifIndex];
        const degreePitch = mode.notes[degree % mode.notes.length] + Math.floor(degree / mode.notes.length) * 12;
        const localColour = Math.cos(region.hue * Math.PI * 2) * (region.saturation ?? .4);
        const local = (region.light - summaries[bar.phrase].light) * 4 + localColour * .65 + (2 - region.row) * .18;
        const development = bar.phrase === 2 ? Math.sin(phrasePosition / 29 * Math.PI) * 4 : 0;
        const closingWeight = phrasePosition >= 24 ? (phrasePosition - 23) * .25 : 0;
        const target = tonic + degreePitch + local + development + [0, .8, 1.4, .4, -.7][phrasePosition % 5];
        const event = {
          ...region, regionId: `${region.col}:${region.row}`, index: rawIndex, sequence: rawIndex,
          beat, beats: span, durationBeats: span, accent, bar: bar.index, phrase: bar.phrase,
          role: phrasePosition === 29 ? 'ending' : phrasePosition === 0 ? 'opening' : 'connection',
          weight: metricalWeight(beat), chordClasses: bar.classes, target,
          endingPitch: phraseEnds[bar.phrase], closingWeight, peakPitch,
          localSeed: region.localSeed ?? Math.round((region.signature ?? 0) * 255 + 128), anchorPitch: null,
        };
        if (phrasePosition === 0) {
          const developmentStart = allowed.filter(pitch => pitch <= tonic + 7 && bar.classes.includes(pc(pitch - tonic)))
            .sort((a, b) => Math.abs(a - tonic - 4) - Math.abs(b - tonic - 4) || a - b)[0];
          const starts = [tonic, tonic + mode.notes[2], developmentStart, tonic];
          event.anchorPitch = starts[bar.phrase];
        }
        if (phrasePosition === 29) event.anchorPitch = phraseEnds[bar.phrase];
        events.push(event); rawIndex++;
      });
    }
    const peakEvent = events.filter(n => n.bar === 10).sort((a, b) => Math.abs(a.beat % 4 - 2) - Math.abs(b.beat % 4 - 2) || a.index - b.index)[0];
    peakEvent.anchorPitch = peakPitch; peakEvent.role = 'climax';
    events.forEach(event => {
      const distance = Math.abs(event.index - peakEvent.index);
      if (event.phrase === 2 && distance <= 5) event.target = Math.max(event.target, peakPitch - distance * 1.7);
    });
    let previous = tonic, fallbacks = 0;
    const phrases = [];
    for (let phrase = 0; phrase < 4; phrase++) {
      const slice = events.slice(phrase * 30, phrase * 30 + 30);
      let found = options.forceFallback ? null : searchPhrase(slice, allowed, previous, tonic, options.beamWidth || 24, false);
      if (!found) { fallbacks++; found = searchPhrase(slice, allowed, previous, tonic, 192, true); }
      if (!found) throw new Error('乐句搜索无法满足结构约束');
      slice.forEach((event, i) => { event.midi = found.path[i]; event.noteName = midiToName(event.midi); event.strong = event.weight === 1; });
      previous = found.pitch;
      phrases.push({ index: phrase, name: PHRASES[phrase], beat: phrase * 16, beats: 16, startIndex: phrase * 30, endIndex: phrase * 30 + 29, endingPitch: phraseEnds[phrase], cost: found.cost });
    }
    events.forEach((event, index) => {
      const next = events[index + 1], interval = next ? Math.abs(next.midi - event.midi) : 0;
      const phraseProgress = (index % 30) / 29;
      const phraseShape = .86 + .14 * Math.sin(phraseProgress * Math.PI);
      const sectionGain = [.88, .94, 1.06, .87][event.phrase];
      const localGain = .96 + (event.light - .5) * .12 + event.density * .04;
      event.velocity = clamp(.12 * phraseShape * sectionGain * localGain * (.87 + event.weight * .13) * event.accent, .065, .15);
      const separated = !next || next.beat > event.beat + event.beats || event.role === 'ending';
      event.articulation = separated ? 'release' : interval === 0 ? 'repeat' : interval > 3 ? 'detached' : 'legato';
      event.durationBeats = event.beats * (separated ? .88 : interval === 0 ? .82 : interval > 3 ? .9 : 1) + (!separated && interval > 0 && interval <= 3 ? Math.min(.045, event.beats * .08) : 0);
      event.send = separated ? .015 : .055;
      event.velocity = audibleValue(event.velocity); event.durationBeats = audibleValue(event.durationBeats); event.accent = audibleValue(event.accent);
      Object.assign(columns[event.col].notes[event.row], { midi: event.midi, noteName: event.noteName, sequence: index, regionId: event.regionId });
    });
    rests.forEach(rest => { rest.scope = rest.bar % 4 === 3 && rest.beat % 4 >= 2 ? 'ensemble' : 'melody'; });
    const accompaniment = makeAccompaniment(bars, events, rests, options.rhythmStructure);
    [...accompaniment.bassEvents, ...accompaniment.padEvents].forEach(event => { event.velocity = audibleValue(event.velocity); event.durationBeats = audibleValue(event.durationBeats); });
    return { melody: events, bars, phrases, rests, ...accompaniment, rhythmProfile: { anchors: rhythmPlan.profile.anchors, motif: rhythmPlan.profile.motif, activity: rhythmPlan.profile.activity, stableRatio: rhythmPlan.profile.stableRatio, maxStableRun: rhythmPlan.profile.maxStableRun, version: rhythmPlan.profile.version }, totalBeats: 64, tonic, mode, root, theme, harmonyIndex, diagnostics: { fallbacks, rhythmSimplified: rhythmPlan.simplified, rhythmSimplifiedBars: rhythmPlan.simplifiedBars, allocations: rhythmPlan.allocations, phraseActivity: rhythmPlan.allocations.map((_, p) => mean(rhythmPlan.profile.notes.slice(p * 30, p * 30 + 30).map(n => n.activity))), beamWidth: options.beamWidth || 24, climaxIndex: peakEvent.index, cadence: mode.id === 'deep' ? 'natural-minor' : 'dominant-tonic' } };
  }
  function makeAccompaniment(bars, melody, rests, structure = {}) {
    const bassEvents = [], padEvents = [];
    for (const bar of bars) {
      const notes = melody.filter(n => n.bar === bar.index), breath = rests.find(r => r.bar === bar.index && r.scope === 'ensemble');
      const end = breath?.beat ?? bar.beat + 4, start = bar.index % 4 === 0 ? bar.beat : notes[0].beat;
      const second = bar.activity > .28 && notes.length >= 8 ? notes.filter(n => n.beat >= bar.beat + 1.5 && n.beat < end - .5).sort((a, b) => b.accent - a.accent || a.beat - b.beat)[0] : null;
      const attacks = second && second.beat > start + 1 ? [start, second.beat] : [start];
      attacks.forEach((beat, i) => bassEvents.push({ beat, durationBeats: Math.max(.1, ((attacks[i + 1] ?? end) - beat) * .91), midi: bar.bass, velocity: .029 * [.87, .94, 1, .84][bar.phrase] * (i ? .72 : 1), bar: bar.index, phrase: bar.phrase, send: .025 }));
      const broken = bar.activity > .32 && (structure.periodicity ?? 0) > .35 && second;
      const padAttacks = broken ? [start, second.beat] : [start];
      padAttacks.forEach((beat, i) => {
        const durationBeats = Math.max(.1, (padAttacks[i + 1] ?? end) - beat - (breath ? .05 : .025));
        const previous = padEvents.at(-1);
        if (!broken && previous && previous.endBar === bar.index - 1 && previous.midi.join() === bar.voicing.join() && previous.beat + previous.durationBeats >= beat - .1 && !rests.some(r => r.scope === 'ensemble' && r.beat >= previous.beat && r.beat < beat)) {
          previous.durationBeats = beat + durationBeats - previous.beat; previous.endBar = bar.index;
        } else padEvents.push({ beat, durationBeats, midi: bar.voicing.slice(), velocity: .015 * [.87, .94, 1, .84][bar.phrase] * (i ? .7 : 1), bar: bar.index, endBar: bar.index, phrase: bar.phrase, send: breath ? .025 : .10 });
      });
    }
    return { bassEvents, padEvents };
  }
  function rhythmFingerprint(score) {
    return digestText(JSON.stringify({ notes: score.melody.map(n => [n.beat, n.beats]), rests: score.rests.map(r => [r.beat, r.beats]) }));
  }
  function scoreFingerprint(score) {
    return digestText(JSON.stringify({ version: score.version, synthVersion: score.synthVersion, root: score.root, mode: score.mode.id, bpm: score.bpm, tempoMap: score.tempoMap, melody: score.melody.map(n => [n.regionId, n.beat, n.beats, n.midi, n.durationBeats, n.velocity, n.articulation, n.send]), bars: score.bars.map(b => [b.beat, b.voicing || b.chord, b.bass]), bass: score.bassEvents, pads: score.padEvents }));
  }
  function compose(analysis, options = {}) {
    const columns = analysis.columns.map(c => ({ notes: c.notes.map(n => ({ ...n })) }));
    const root = options.root ?? analysis.root, mode = modeOf(options.modeId || analysis.modeId);
    const arranged = arrangeRegions(columns, root, mode, { ...options, rhythmStructure: analysis.rhythmStructure });
    const bpm = options.bpm ?? analysis.bpm, secondsPerBeat = 60 / bpm;
    const score = {
      ...analysis, ...arranged, columns, bpm, secondsPerBeat, version: '0.5.0',
      synthVersion: '0.5.0', normalizationVersion: analysis.normalizationVersion || 'canonical-fixture-v1',
    };
    const activities = score.diagnostics.phraseActivity, average = mean(activities);
    const factor = i => 1 + clamp((quantizedActivity(activities[i]) - quantizedActivity(average)) * .10, -.035, .035);
    score.tempoMap = Timing.makeMap(options.tempo === false ? [{ beat: 0, bpm }, { beat: 64, bpm }] : [{ beat: 0, bpm }, { beat: 16, bpm: bpm * factor(1) }, { beat: 32, bpm: bpm * factor(2) }, { beat: 48, bpm: bpm * factor(3) }, { beat: 60, bpm: bpm * .985 }, { beat: 64, bpm: bpm * .94 }]);
    score.melodyDuration = Timing.beatToTime(score, 64); score.duration = score.melodyDuration + 2;
    score.rhythmFingerprint = rhythmFingerprint(score);
    score.rhythmProfile.signature = digestText(JSON.stringify(score.rhythmProfile.anchors));
    score.diagnostics.rhythmDecisionMargins = Rhythm.describe(orderedRegions(columns), analysis.rhythmStructure).anchorMargins;
    score.accompanimentFingerprint = digestText(JSON.stringify({ bass: score.bassEvents.map(n => [n.beat, n.durationBeats]), pads: score.padEvents.map(n => [n.beat, n.durationBeats]) }));
    score.expressionFingerprint = digestText(JSON.stringify({ rhythm: score.rhythmFingerprint, bpm, tempo: score.tempoMap, melody: score.melody.map(n => [n.durationBeats, n.velocity, n.articulation, n.send]), bass: score.bassEvents, pads: score.padEvents }));
    score.scoreHash = scoreFingerprint(score);
    const intervals = score.melody.slice(1).map((n, i) => n.midi - score.melody[i].midi);
    let run = 1, maxRepeatRun = 1;
    intervals.forEach(interval => { run = interval === 0 ? run + 1 : 1; maxRepeatRun = Math.max(run, maxRepeatRun); });
    score.diagnostics.stepRatio = intervals.filter(n => Math.abs(n) <= 3).length / intervals.length;
    score.diagnostics.largeLeaps = intervals.filter(n => Math.abs(n) >= 5).length;
    score.diagnostics.maxRepeatRun = maxRepeatRun;
    return score;
  }
  function quantizedActivity(x) { return Math.round(x * 8) / 8; }
  function playbackPosition(score, elapsed) {
    const beat = Timing.timeToBeat(score, Math.max(0, elapsed));
    if (beat < score.melody[0].beat) return { index: -1, note: null, rest: true, tail: false, finished: false, scanFraction: 0 };
    let index = 0;
    while (index < score.melody.length - 1 && score.melody[index + 1].beat <= beat) index++;
    const note = score.melody[index];
    const rest = score.rests?.find(r => beat >= r.beat && beat < r.beat + r.beats);
    const tail = beat >= score.totalBeats;
    const next = score.melody[index + 1];
    const progress = rest || tail ? 1 : clamp((beat - note.beat) / Math.min(note.beats, (next?.beat ?? score.totalBeats) - note.beat), 0, 1);
    return { index, note, rest: !!rest, tail, finished: elapsed >= score.duration, scanFraction: clamp((note.col + (index % 5 + progress) / 5) / 24, 0, 1) };
  }
  return { MODES, PHRASES, HARMONIES, arrangeRegions, compose, orderedRegions, summarize, makeTheme, midiToName, modeOf, scoreFingerprint, rhythmFingerprint, playbackPosition, digestText, beatToTime: Timing.beatToTime, timeToBeat: Timing.timeToBeat };
});
