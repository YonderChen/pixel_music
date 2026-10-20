/* arranger.py: rows take musical roles (melody, counter-line, broken chords, bass) over one
 * progression, and harmonize() infers a pad from the notes the rows actually play. */
(self.PixelMusicEngineModules = self.PixelMusicEngineModules || []).push(function (PM) {
  'use strict';
  const {np} = PM;
  const VERSION = 'arranged-ensemble-v1';
  const ROLES = {2: ['melody', 'bass'], 3: ['melody', 'arpeggio', 'bass'], 4: ['melody', 'counter', 'arpeggio', 'bass']};
  const ROLE_NAMES = {melody: '主旋律', counter: '副旋律', arpeggio: '分解和弦', bass: '低音'};
  const REGISTERS = {melody: [67, 86], counter: [55, 74], arpeggio: [50, 74], bass: [33, 52]};
  const ROLE_GAIN = {melody: 1, counter: .55, arpeggio: .5, bass: .62};
  const ROLE_PAN = {melody: .06, counter: -.4, arpeggio: .42, bass: -.08};
  const BACKING_GAIN = .42, REVERB_SEND = 72;
  const CHANGE = .012, MOVE = .025, HARMONY_CHANGE = .015, STILL = .05;
  const PARENT = {'Major pentatonic': [0, 2, 4, 5, 7, 9, 11], 'Major': [0, 2, 4, 5, 7, 9, 11], 'Lydian': [0, 2, 4, 6, 7, 9, 11],
    'Natural minor': [0, 2, 3, 5, 7, 8, 10], 'Minor pentatonic': [0, 2, 3, 5, 7, 8, 10], 'Dorian': [0, 2, 3, 5, 7, 9, 10]};
  const PROGRESSIONS = {
    major: [[0, 4, 5, 3], [0, 5, 3, 4], [0, 3, 5, 4], [5, 3, 0, 4]],
    lydian: [[0, 1, 0, 1], [0, 1, 5, 4], [0, 4, 1, 0], [0, 5, 1, 4]],
    minor: [[0, 5, 2, 6], [0, 3, 6, 2], [0, 5, 3, 6], [0, 6, 5, 6]],
    dorian: [[0, 3, 0, 3], [0, 3, 6, 0], [0, 6, 3, 0], [0, 2, 3, 6]]};
  const FAMILY = {'Major pentatonic': 'major', 'Major': 'major', 'Lydian': 'lydian', 'Natural minor': 'minor', 'Minor pentatonic': 'minor', 'Dorian': 'dorian'};
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const ENSEMBLES = [
    {id: 'wooden-steps', name: '木琴轻步', simple: {melody: 'marimba', counter: 'harp', arpeggio: 'kalimba', bass: 'soft_bass', pad: 'warm_pad'}},
    {id: 'night-strings', name: '夜色弦乐', simple: {melody: 'soft_piano', counter: 'cello', arpeggio: 'harp', bass: 'soft_bass', pad: 'warm_pad'}},
    {id: 'warm-chamber', name: '暖木室内乐', simple: {melody: 'flute_like_lead', counter: 'clarinet_like_reed', arpeggio: 'harp', bass: 'cello', pad: 'warm_pad'}},
    {id: 'cool-mist', name: '冷雾电钢', simple: {melody: 'soft_piano', counter: 'celesta', arpeggio: 'harp', bass: 'soft_bass', pad: 'glass_pad'}},
    {id: 'morning-piano', name: '晨光钢琴', simple: {melody: 'soft_piano', counter: 'bowed_string', arpeggio: 'harp', bass: 'soft_bass', pad: 'warm_pad'}}];

  function chooseEnsemble(f) {
    const b = f.mean_brightness, warm = f.warmth, hi = f.high_frequency_energy;
    if (hi > .34 && b > .45) return [ENSEMBLES[0], '细节丰富且明亮'];
    if (b < .38) return [ENSEMBLES[1], '整体偏暗'];
    if (warm > .05) return [ENSEMBLES[2], '色调偏暖'];
    if (warm < -.03) return [ENSEMBLES[3], '色调偏冷'];
    return [ENSEMBLES[4], '明暗与冷暖均衡'];
  }
  const chordPcs = (rootPc, parent, degree) => [0, 1, 2].map(k => (rootPc + parent[(degree + 2 * k) % 7]) % 12);
  function chordName(rootPc, parent, degree) {
    const pcs = chordPcs(rootPc, parent, degree), third = np.mod(pcs[1] - pcs[0], 12), fifth = np.mod(pcs[2] - pcs[0], 12);
    return NOTE_NAMES[pcs[0]] + (third === 4 ? '' : fifth === 6 ? 'dim' : 'm');
  }
  function notesWith(pcs, low, high) {
    const out = [];
    for (let n = low; n <= high; n++) if (pcs.has(n % 12)) out.push(n);
    return out;
  }
  // Centre on the image median; uniform images stay near the middle.
  function normalize(values, minimumHalfSpan = .03) {
    if (!values.length) return [];
    const [lo, mid, hi] = np.percentiles(values, [10, 50, 90]), half = Math.max((hi - lo) / 2, minimumHalfSpan);
    return values.map(v => np.clip(.5 + (v - mid) / (2 * half), 0, 1));
  }
  function smooth(values) {
    if (values.length < 3) return values.slice();
    const p = [values[0], ...values, values[values.length - 1]];
    return values.map((_, i) => .25 * p[i] + .5 * p[i + 1] + .25 * p[i + 2]);
  }
  const activity = f => .55 * f.texture + .3 * Math.min(1, f.contrast * 3) + .15 * f.saturation;
  const pySum = values => values.reduce((a, b) => a + b, 0);
  const absDiffSum = (a, b) => np.pairwise(a.map((v, i) => Math.abs(v - b[i])), 0, a.length, 1);
  const contributionValues = r => Object.values(r.contributions);

  function arrange(features, info, rootMidi, rows) {
    const count = rows.length, roles = ROLES[count], beat = 60 / info.tempo, bars = Math.max(1, Math.floor(rows[0].length / 4));
    const rootPc = rootMidi % 12, parent = PARENT[info.scale_name] || PARENT.Major;
    const melodyPcs = new Set(PM.composition.SCALES[info.scale_name].map(i => (rootPc + i) % 12));
    const family = FAMILY[info.scale_name] || 'major';
    const choice = (features.mean_saturation > .35 ? 1 : 0) * 2 + (features.contrast > .2 ? 1 : 0);
    const loop = PROGRESSIONS[family][choice];
    // With the image mood on, the mood names the ensemble instead of brightness and warmth.
    const mood = info.emotion, [ensemble, ensembleReason] = mood
      ? [ENSEMBLES.find(e => e.id === mood.ensemble), `图片情绪${mood.name}`] : chooseEnsemble(features);
    const vectors = rows.map(row => row.map(contributionValues));
    const deltas = vectors.map(v => [Infinity, ...v.slice(1).map((x, i) => absDiffSum(x, v[i]))]);
    const band = [];
    for (let b = 0; b < bars; b++) {
      const acc = [0, 0, 0, 0, 0];
      let n = 0;
      for (let r = 0; r < count; r++) for (let c = b * 4; c < b * 4 + 4; c++) { vectors[r][c].forEach((x, k) => { acc[k] += x; }); n++; }
      band.push(acc.map(x => x / n));
    }
    let step = 0;
    const degrees = [];
    for (let b = 0; b < bars; b++) {
      if (b && absDiffSum(band[b], band[b - 1]) >= HARMONY_CHANGE) step += 1;
      degrees.push(loop[step % 4]);
    }
    if (step && bars >= 2) degrees[degrees.length - 1] = 0;
    const chords = degrees.map(d => chordPcs(rootPc, parent, d));
    const acts = rows.map(row => row.map(r => activity(r.features)));
    const relative = normalize(acts.flat(), .04);
    const cap = a => (a < STILL ? -1 : a < .14 ? 0 : a < .28 ? 1 : 2);
    const levels = acts.map((row, index) => row.map((a, k) => { const v = relative[index * row.length + k]; return Math.min(v < .38 ? 0 : v < .72 ? 1 : 2, cap(a)); }));
    const sums = rows.map(row => row.map(r => pySum(contributionValues(r))));
    const contours = sums.map(values => smooth(normalize(values)));
    const motion = sums.map(values => np.clip(np.std(values) / .04, 0, 1));
    const dark = rows.map(row => row.map(r => r.features.brightness < .03));
    const barLevel = (row, bar) => np.round(np.sum(levels[row].slice(bar * 4, bar * 4 + 4)) / 4);
    const barChanged = (row, bar) => Math.max(...deltas[row].slice(bar * 4, bar * 4 + 4)) >= CHANGE;
    const mean4 = (values, bar) => np.sum(values.slice(bar * 4, bar * 4 + 4)) / 4;
    const note = (onset, length, midi, velocity, factor) => {
      const first = Math.trunc(onset);
      return {start: onset * beat, duration: length * factor * beat, midi, velocity, cells: [first, Math.max(first + 1, Math.trunc(Math.ceil(onset + length - 1e-6)))],
        span: [onset, onset + length], factor};
    };
    const tie = (notes, row, limit = 4) => {
      const out = [];
      for (const n of notes) {
        const p = out[out.length - 1];
        let still = false;
        if (p && p.midi === n.midi && Math.abs(p.span[1] - n.span[0]) < 1e-6 && n.span[1] - p.span[0] <= limit + 1e-6) {
          let m = -Infinity;
          for (let c = n.cells[0]; c < n.cells[1]; c++) m = Math.max(m, deltas[row][c]);
          still = m < CHANGE;
        }
        if (still) {
          p.span = [p.span[0], n.span[1]]; p.cells = [p.cells[0], n.cells[1]];
          p.duration = (p.span[1] - p.span[0]) * n.factor * beat;
        } else out.push(n);
      }
      return out;
    };
    let melodyLine = [];
    const results = {};
    const order = np.sortBy([...Array(count).keys()], i => [roles[i] !== 'melody' ? 1 : 0]);
    for (const index of order) {
      const role = roles[index], [low, high] = REGISTERS[role], contour = contours[index], row = rows[index];
      const inst = ensemble.simple[role];
      let notes = [];
      if (role === 'melody') {
        let previous = null, repeats = 0, lastLeap = 0;
        for (let bar = 0; bar < bars; bar++) for (const half of [0, 2]) {
          const b0 = bar * 4 + half, level = Math.max(0, levels[index][b0], levels[index][b0 + 1]);
          const front = acts[index][b0] >= acts[index][b0 + 1];
          let cells = [[2], front ? [1, 1] : [1.5, .5], front ? [.5, .5, 1] : [1, .5, .5]][level];
          const phraseEnd = bar % 4 === 3 && half === 2 && barChanged(index, bar), final = bar === bars - 1 && half === 2;
          if (phraseEnd || final) cells = [2];
          let position = 0;
          for (const length of cells) {
            const onset = b0 + position, cell = Math.trunc(onset);
            position += length;
            if (dark[index][cell]) { previous = null; continue; }
            const target = low + contour[cell] * (high - low), strong = onset % 2 === 0 || length >= 1.5;
            let candidates;
            if (final && step) candidates = notesWith(new Set([rootPc]), low, high);
            else if (strong) candidates = notesWith(new Set(chords[bar]), low, high);
            else candidates = notesWith(new Set([...melodyPcs, ...chords[bar]]), low, high);
            const change = deltas[index][cell];
            const cost = n => {
              let value = Math.abs(n - target);
              if (previous !== null) {
                const interval = n - previous;
                value += .7 * Math.max(0, Math.abs(interval) - 5);
                if (n === previous) {
                  if (change < CHANGE) value -= 1.2;
                  else if (change >= MOVE && repeats >= 1) value += 1.6;
                }
                if (Math.abs(lastLeap) > 4 && interval * lastLeap > 0) value += 2.5;
              }
              return value;
            };
            const midi = np.minBy(candidates, n => [cost(n), n]);
            repeats = midi === previous ? repeats + 1 : 0;
            lastLeap = previous === null ? 0 : midi - previous;
            previous = midi;
            const f = row[cell].features, phrase = ((bar % 4) * 4 + half + position - length) / 16;
            const velocity = .5 + .2 * Math.min(1, f.contrast * 3) + .08 * f.saturation + .08 * motion[index] * PM.libm.sin(Math.PI * phrase) + (onset % 4 === 0 ? .05 : 0);
            notes.push(note(onset, length, midi, np.clip(velocity, .35, .9), phraseEnd && !final ? .75 : .96));
          }
        }
        notes = tie(notes, index);
        melodyLine = notes.map(n => [n.span[0] * beat, n.span[1] * beat, n.midi]);
      } else if (role === 'counter') {
        let previous = null;
        for (let bar = 0; bar < bars; bar++) {
          const cells = barLevel(index, bar) <= 0 || bar === bars - 1 ? [4] : [2, 2];
          let position = 0;
          for (const length of cells) {
            const onset = bar * 4 + position;
            position += length;
            if (dark[index][onset]) { previous = null; continue; }
            const target = low + contour[onset] * (high - low), start = onset * beat, end = (onset + length) * beat;
            const above = melodyLine.filter(([s, e]) => s < end && e > start).map(x => x[2]);
            const still = Math.max(...deltas[index].slice(onset, onset + length)) < CHANGE;
            const cost = n => {
              let value = .45 * Math.abs(n - target) + (previous !== null ? .55 * Math.abs(n - previous) : 0);
              if (previous !== null && n === previous && still) value -= 1.2;
              if (n % 12 === chords[bar][0]) value += 1.2;
              for (const m of above) {
                if (n > m - 3) value += 6;
                if ([1, 2, 10, 11].includes(np.mod(m - n, 12))) value += 4;
              }
              return value;
            };
            const midi = np.minBy(notesWith(new Set(chords[bar]), low, high), n => [cost(n), n]);
            previous = midi;
            const f = row[onset].features;
            notes.push(note(onset, length, midi, np.clip(.42 + .16 * Math.min(1, f.contrast * 3), .3, .66), .97));
          }
        }
        notes = tie(notes, index);
      } else if (role === 'arpeggio') {
        const patterns = [[1], [0, 1, 2, 1], [0, 2, 3, 2, 1, 2, 3, 2], [0, 1, 2, 3, 4, 3, 2, 1]];
        for (let bar = 0; bar < bars; bar++) {
          if (dark[index].slice(bar * 4, bar * 4 + 4).every(Boolean)) continue;
          let level = barLevel(index, bar);
          if (bar === bars - 1) level = Math.min(level, 0);
          const centre = low + mean4(contour, bar) * (high - low - 12);
          const roots = notesWith(new Set([chords[bar][0]]), low, high - 7), base = np.minBy(roots, n => [Math.abs(n - centre)]);
          const voicing = notesWith(new Set(chords[bar]), base, Math.min(base + 17, high)).slice(0, 5);
          const pattern = patterns[level + 1], beats = 4 / pattern.length;
          pattern.forEach((degree, k) => {
            const onset = bar * 4 + k * beats, cell = Math.trunc(onset);
            if (dark[index][cell]) return;
            const ring = Math.min(beats * 1.8, bar * 4 + 4 - onset) / beats;
            const velocity = .34 + .12 * Math.max(0, levels[index][cell]) / 2 + (k === 0 && pattern.length > 1 ? .05 : 0);
            notes.push(note(onset, beats, voicing[Math.min(degree, voicing.length - 1)], np.clip(velocity, .28, .58), ring));
          });
        }
        notes = tie(notes, index);
      } else {
        let previous = null;
        const boost = count === 2 ? 1 : 0;
        for (let bar = 0; bar < bars; bar++) {
          if (dark[index].slice(bar * 4, bar * 4 + 4).every(Boolean)) { previous = null; continue; }
          let level = barLevel(index, bar);
          level = bar === bars - 1 ? -1 : level >= 0 ? Math.min(2, level + boost) : -1;
          const target = low + 3 + mean4(contour, bar) * (high - low - 10);
          const roots = notesWith(new Set([chords[bar][0]]), low, high - 7);
          const root = np.minBy(roots, n => [previous !== null ? Math.abs(n - previous) + .3 * Math.abs(n - target) : Math.abs(n - target)]);
          const fifth = root + np.mod(chords[bar][2] - chords[bar][0], 12), octave = root + 12 <= high ? root + 12 : root;
          const plan = [[[0, 4, root]], [[0, 4, root]], [[0, 2, root], [2, 2, fifth]], [[0, 1, root], [1, 1, fifth], [2, 1, octave], [3, 1, fifth]]][level + 1];
          previous = root;
          for (const [offset, length, midi] of plan) {
            const onset = bar * 4 + offset;
            if (dark[index][onset]) continue;
            const velocity = .56 + (offset === 0 && plan.length > 1 ? .06 : 0) + .1 * Math.max(0, levels[index][onset]) / 2;
            notes.push(note(onset, length, midi, np.clip(velocity, .4, .78), .94));
          }
        }
        notes = tie(notes, index);
      }
      for (const n of notes) { delete n.span; delete n.factor; }
      results[index] = {role, instrument: inst, notes};
    }
    const backing = padEvents(chords, beat, ensemble.simple.pad), names = degrees.map(d => chordName(rootPc, parent, d));
    const meta = {version: VERSION, ensemble: ensemble.name, ensembleReason, key: NOTE_NAMES[rootPc], progression: compress(names),
      harmonyChanges: step, roles: roles.map(r => ROLE_NAMES[r]), reverbSend: REVERB_SEND};
    return [results, backing, meta];
  }

  const compress = names => names.filter((n, i) => i === 0 || n !== names[i - 1]);
  const samePcs = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  function padEvents(chords, beat, inst) {
    const backing = [];
    let voicing = null, start = 0;
    const all = [...chords, null];
    for (let bar = 0; bar < all.length; bar++) {
      const pcs = all[bar];
      if (pcs !== null && bar && samePcs(pcs, chords[bar - 1])) continue;
      if (voicing !== null) for (const midi of voicing) {
        backing.push({start: start * 4 * beat, duration: ((bar - start) * 4 + .05) * beat, midi, velocity: .3, instrument: inst, pan: 0, layer: 'pad'});
      }
      if (pcs === null) break;
      const options = triadVoicings(pcs, 52, 72).map(v => v.slice().sort((a, b) => a - b));
      const previous = voicing;
      voicing = np.minBy(options, v => [previous && previous.length ? pySum(v.map((a, i) => i < previous.length ? Math.abs(a - previous[i]) : 0)) : Math.abs(v[0] - 57)]);
      start = bar;
    }
    return backing;
  }

  function triadVoicings(pcs, low, high) {
    const set = new Set(pcs), out = [];
    for (const bass of notesWith(set, low, high)) {
      const voice = [bass];
      for (let k = 0; k < 2; k++) {
        const used = new Set(voice.map(v => v % 12)), last = voice[voice.length - 1];
        for (let n = last + 1; n < last + 13; n++) if (set.has(n % 12) && !used.has(n % 12)) { voice.push(n); break; }
      }
      if (voice[voice.length - 1] <= high + 4) out.push(voice);
    }
    return out;
  }

  function harmonize(events, info, rootMidi, bars) {
    const beat = 60 / info.tempo, rootPc = rootMidi % 12, parent = PARENT[info.scale_name] || PARENT.Major;
    const triads = [...Array(7).keys()].map(d => chordPcs(rootPc, parent, d));
    const usable = [...Array(7).keys()].filter(d => !chordName(rootPc, parent, d).endsWith('dim'));
    const degrees = [];
    let previous = null;
    for (let bar = 0; bar < bars; bar++) {
      const lo = bar * 4 * beat, hi = (bar + 1) * 4 * beat, weight = new Float64Array(12);
      for (const e of events) {
        const overlap = Math.min(hi, e.start + e.duration) - Math.max(lo, e.start);
        if (overlap > 0) weight[np.mod(e.midi, 12)] += overlap * e.velocity;
      }
      const total = np.sum(weight);
      if (total <= 1e-9) { degrees.push(previous !== null ? previous : 0); continue; }
      const score = d => { const inside = pySum(triads[d].map(pc => weight[pc])); return inside - .6 * (total - pySum(triads[d].map(pc => weight[pc]))); };
      const best = np.maxBy(usable, d => [score(d), d === 0 ? 1 : 0, -d]);
      const keep = previous !== null ? previous : 0;
      const degree = score(keep) >= score(best) - .25 * total ? keep : best;
      degrees.push(degree); previous = degree;
    }
    const chords = degrees.map(d => triads[d]), names = degrees.map(d => chordName(rootPc, parent, d));
    return [padEvents(chords, beat, 'warm_pad'), {key: NOTE_NAMES[rootPc], progression: compress(names),
      harmonyChanges: names.slice(1).filter((n, i) => n !== names[i]).length}];
  }

  PM.arranger = {VERSION, ROLES, ROLE_NAMES, ROLE_GAIN, ROLE_PAN, BACKING_GAIN, normalize, smooth, arrange, harmonize, padEvents};
});
