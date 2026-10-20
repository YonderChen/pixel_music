/* reference_music.py: the reference score, the full-image feature melody and the row
 * ensembles (reference strips, local features, pitch transition, arranged roles, regions),
 * assembled into the payload the page reads. Audio is rendered on demand elsewhere. */
(self.PixelMusicEngineModules = self.PixelMusicEngineModules || []).push(function (PM) {
  'use strict';
  const {np, analysis: A, composition: C} = PM;
  const OCTAVE_LAYOUT = {2: [0, -12], 3: [12, 0, -12], 4: [12, 0, -12, -24]};
  const SOFT_LAYOUT = {2: [0, 4], 3: [3, 0, 4], 4: [3, 0, 1, 4]};
  const OCTAVE_NAMES = {2: ['中音', '低音'], 3: ['高音', '中音', '低音'], 4: ['高音', '中音', '中低音', '低音']};
  const UPSTREAM_SHA = '667d97c1e68de56fe2f5ef2d26784ee8a7308f3f', VERSION = 'full-image-features-v2';
  const PARALLEL_VERSION = 'horizontal-row-ensemble-v1', CONTOUR_VERSION = 'feature-contour-v1', PITCH_TRANSITION_VERSION = 'multi-feature-pitch-v1';
  const WEIGHTS = [.46, .20, .10, .12, .12], FEATURE_NAMES = ['亮度', '色相', '饱和度', '对比度', '纹理'];
  const EVENT_FIELDS = ['start', 'duration', 'midi', 'velocity', 'instrument', 'pan', 'layer'];

  const weighted = vector => vector.map((v, i) => v * WEIGHTS[i]);
  const contributionsOf = vector => Object.fromEntries(FEATURE_NAMES.map((name, i) => [name, vector[i] * WEIGHTS[i]]));
  const pySum = values => values.reduce((a, b) => a + b, 0);
  const pick = (record, fields = EVENT_FIELDS) => Object.fromEntries(fields.map(k => [k, record[k]]));

  function rootNote(f) {
    const key = np.mod(np.round(f.dominant_hue * 12), 12);
    return Math.trunc(np.clip(48 + key + np.round(-5 + 12 * f.mean_brightness), 38, 58));
  }
  const allowedNotes = (f, info) => C.buildScaleNotes(rootNote(f), C.SCALES[info.scale_name], rootNote(f) + 10, rootNote(f) + 31);

  // `emotion` (PM.mood.estimate) replaces the automatic scale, tempo rule and instruments.
  function originalComposition(result, options = {}, emotion = null) {
    const f = result.features;
    let bars = Math.trunc(options.bars || C.computeBarSettings(f)[2]);
    bars = Math.max(4, Math.min(16, bars));
    if ((options.synth || 'Simple') !== 'Simple') throw new Error('未知音源');
    const mapping = options.mapping || 'Scientific';
    if (!['Scientific', 'Balanced', 'Musical'].includes(mapping)) throw new Error('未知映射模式');
    if (!emotion) return C.generateComposition(result, bars, f.auto_complexity, f.auto_variation_strength, 'Automatic', 'Automatic', mapping, null);
    const [events, info] = C.generateComposition(result, bars, PM.mood.complexity(emotion, f.auto_complexity), f.auto_variation_strength,
      emotion.scale, 'Automatic', 'Manual', emotion.tempo, emotion.instruments);
    info.emotion = PM.mood.describe(emotion);
    return [events, info];
  }

  // Colour, brightness, contrast and texture of an image rectangle (_local_features).
  function localFeatures(maps, y0, y1, x0, x1) {
    const {rgb, luminance, width} = maps, lightView = A.view(luminance, width, 1, y0, y1, x0, x1);
    let light = A.values(lightView), h = y1 - y0, w = x1 - x0, mean;
    if (h < 2 || w < 2) {
      // Duplicate boundaries for one-pixel regions (np.repeat), so gradients exist.
      const rh = h < 2 ? h * 2 : h, rw = w < 2 ? w * 2 : w, rep = new Float64Array(rh * rw);
      for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) rep[y * rw + x] = light[Math.floor(y / (rh / h)) * w + Math.floor(x / (rw / w))];
      light = rep; h = rh; w = rw; mean = np.mean(rep);
    } else mean = A.viewMean(lightView);
    const hsv = A.hsvFeatures(A.view(rgb, width, 3, y0, y1, x0, x1), A.values(lightView));
    const [edge] = A.edgeMap(light, h, w), entropy = A.histogramEntropy(edge);
    const spectrum = A.fourier(light, h, w, mean);
    const texture = .5 * entropy + .25 * spectrum.high_frequency_energy + .25 * spectrum.periodic_peak_score;
    const brightness = A.viewMean(lightView), contrast = A.viewStd(lightView), hue = hsv.dominant_hue, saturation = hsv.mean_saturation;
    const vector = [brightness, .5 + (hue - .5) * saturation, saturation, Math.min(1, contrast * 3), texture];
    return [{brightness, hue, saturation, contrast, texture, entropy, highFrequency: spectrum.high_frequency_energy,
      periodicity: spectrum.periodic_peak_score}, vector];
  }

  function serializeReference(events, result, info) {
    const {luminance, width: w, height: h} = result.maps, slices = C.timeSliceStatistics(luminance, h, w, info.bars * 8), n = slices.length;
    const regions = slices.map((stat, index) => {
      const x0 = np.round(index * w / n), x1 = Math.max(np.round(index * w / n) + 1, np.round((index + 1) * w / n));
      return {id: `ref-${index}`, index, col: index, row: 0, rect: {x: x0 / w, y: 0, width: (x1 - x0) / w, height: 1},
        start: index * .5 * 60 / info.tempo, end: (index + 1) * .5 * 60 / info.tempo,
        features: {brightness: stat.energy, contrast: stat.contrast, centroid: stat.y_centroid},
        midi: null, targetMidi: null, eventId: null, reason: '原项目未在此条带起音'};
    });
    const records = events.map((event, index) => {
      const row = {...pick(event), id: `ref-event-${index}`, sources: []};
      if (event.layer === 'main') {
        const region = regions[Math.min(n - 1, np.round(event.start / (60 / info.tempo) / .5))];
        Object.assign(region, {midi: event.midi, targetMidi: event.midi, eventId: row.id, reason: '参考项目原始条带映射与段落变化'});
        row.sources = [{regionId: region.id, rect: region.rect}];
      }
      return row;
    });
    return [records, regions];
  }

  function featurePitchEvents(regions, allowed, voiceId, row, instrument, pan, transition) {
    const events = [], steps = allowed.map((_, i) => i);
    for (const region of regions) {
      const position = np.clip(pySum(Object.values(region.contributions)), 0, 1), index = position * (allowed.length - 1);
      const continuous = np.interp(index, steps, allowed), midi = allowed[np.round(index)];
      Object.assign(region, {pitchPosition: position, curveMidi: continuous, targetMidi: midi});
      if (region.features.brightness < .012) { region.reason = '暗区休止；不跨休止连接音高'; continue; }
      const record = {id: `${voiceId}-note-${events.length}`, start: region.start, duration: region.end - region.start, coverageEnd: region.end,
        midi, curveMidi: continuous, pitchTransition: transition,
        velocity: np.clip(.40 + .18 * region.features.saturation + .3 * region.features.contrast, .3, .8),
        instrument, pan, layer: 'main', rowId: voiceId, row, sources: [{regionId: region.id, rect: region.rect}]};
      Object.assign(region, {midi, eventId: record.id,
        reason: '颜色、明暗、饱和度、对比度与纹理决定音高；' + (transition === 'glide' ? '保留连续音高并平滑滑接' : '吸附到共用音阶并持续连奏')});
      events.push(record);
    }
    return events;
  }

  // Nearest allowed note, at most a fourth from the previous one; ties take the lower note.
  const nearest = (candidates, target) => np.minBy(candidates, n => [Math.abs(n - target), n]);
  const argmax = values => values.reduce((best, v, i) => (v > values[best] ? i : best), 0);

  function fullFeatureMelody(result, info, options = {}) {
    const method = options.featureMethod || 'features';
    if (!['features', 'contour', 'transition'].includes(method)) throw new Error('全图映射设置无效');
    if (method !== 'features') return fullMappedMelody(result, info, options.featurePitchTransition || 'glide', method);
    const {maps, features: F} = result, {rgb, luminance, width: w, height: h} = maps;
    const cols = info.bars * 2, rows = 4, slotSeconds = info.duration / (cols * rows), allowed = allowedNotes(F, info);
    const regions = [], events = [];
    let previousVector = null, previousMidi = null;
    for (let col = 0; col < cols; col++) {
      const order = col % 2 === 0 ? [0, 1, 2, 3] : [3, 2, 1, 0];
      for (const row of order) {
        const sequence = regions.length;
        const x0 = np.round(col * w / cols), x1 = np.round((col + 1) * w / cols), y0 = np.round(row * h / rows), y1 = np.round((row + 1) * h / rows);
        const lightView = A.view(luminance, w, 1, y0, y1, x0, x1), light = A.values(lightView), ph = y1 - y0, pw = x1 - x0;
        const hsv = A.hsvFeatures(A.view(rgb, w, 3, y0, y1, x0, x1), light);
        const [edge] = A.edgeMap(light, ph, pw);
        const brightness = A.viewMean(lightView), contrast = A.viewStd(lightView), entropy = A.histogramEntropy(edge);
        const spectrum = A.fourier(light, ph, pw, A.viewMean(lightView));
        const texture = .5 * entropy + .25 * spectrum.high_frequency_energy + .25 * spectrum.periodic_peak_score;
        const hue = hsv.dominant_hue, saturation = hsv.mean_saturation;
        const vector = [brightness, .5 + (hue - .5) * saturation, saturation, Math.min(1, contrast * 3), texture];
        const contributions = weighted(vector), targetPosition = np.clip(np.sum(contributions), 0, 1);
        const target = allowed[np.round(targetPosition * (allowed.length - 1))];
        const rect = {x: x0 / w, y: y0 / h, width: (x1 - x0) / w, height: (y1 - y0) / h};
        const region = {id: `cell-${sequence}`, index: sequence, col, row, rect, start: sequence * slotSeconds, end: (sequence + 1) * slotSeconds,
          features: {brightness, hue, saturation, contrast, texture, entropy, highFrequency: spectrum.high_frequency_energy,
            periodicity: spectrum.periodic_peak_score},
          contributions: contributionsOf(vector), targetMidi: target, midi: null, eventId: null};
        if (brightness < .012) {
          region.reason = '暗区主旋律休止'; regions.push(region); previousVector = previousMidi = null; continue;
        }
        const delta = previousVector === null ? null : np.sum(vector.map((v, i) => Math.abs(v - previousVector[i]) * WEIGHTS[i]));
        const candidates = previousMidi === null ? allowed : allowed.filter(n => Math.abs(n - previousMidi) <= 5);
        let midi = nearest(candidates, target), reason = '二维区域的颜色、明暗、对比度与纹理共同映射';
        if (previousMidi !== null && delta < 1e-8) { midi = previousMidi; reason = '区域特征相同，保持同音'; }
        else if (previousMidi !== null && delta >= .025 && midi === previousMidi) {
          const difference = vector.map((v, i) => v - previousVector[i]), dominant = argmax(difference.map((d, i) => Math.abs(d) * WEIGHTS[i]));
          const direction = difference[dominant] > 0 ? 1 : -1, neighbours = candidates.filter(n => (n - midi) * direction > 0);
          if (neighbours.length) { midi = np.minBy(neighbours, n => [Math.abs(n - previousMidi)]); reason = '局部特征发生明显变化，保留一级音阶变化'; }
        } else if (midi !== target) reason += '；压缩大跳进';
        Object.assign(region, {midi, reason});
        const velocity = np.clip(.30 + .30 * F.dynamic_range + .20 * F.contrast + .15 * saturation + .25 * contrast, .28, .90);
        let current = events.length ? events[events.length - 1] : null;
        const merge = current && current.midi === midi && Math.abs(current.coverageEnd - region.start) < 1e-7 && delta !== null && delta < .012;
        if (!merge) {
          current = {id: `feature-main-${events.length}`, start: region.start, duration: slotSeconds * .9, midi, velocity,
            instrument: info.main_instrument, pan: (col / Math.max(1, cols - 1) - .5) * .9, layer: 'main', sources: [], coverageEnd: region.end};
          events.push(current);
        } else {
          current.duration = region.end - current.start - slotSeconds * .1;
          current.coverageEnd = region.end;
        }
        current.sources.push({regionId: region.id, rect});
        region.eventId = current.id;
        regions.push(region); previousVector = vector; previousMidi = midi;
      }
    }
    return [events, regions, cols, rows];
  }

  // The row pitch mapper sequenced as one snake voice (featureMethod 'transition').
  function fullMappedMelody(result, info, transition = 'glide', method = 'transition') {
    if (!['scale', 'glide'].includes(transition)) throw new Error('全图音高转折设置无效');
    if (method === 'contour') throw new Error('全图映射设置无效');
    const {maps, features: F} = result, {width: w, height: h} = maps;
    const cols = Math.min(info.bars * 2, w), rows = Math.min(4, h), slot = info.duration / (cols * rows), allowed = allowedNotes(F, info);
    const regions = [];
    for (let col = 0; col < cols; col++) {
      const order = [...Array(rows).keys()];
      if (col % 2) order.reverse();
      for (const row of order) {
        const x0 = np.round(col * w / cols), x1 = np.round((col + 1) * w / cols), y0 = np.round(row * h / rows), y1 = np.round((row + 1) * h / rows);
        const [features, vector] = localFeatures(maps, y0, y1, x0, x1), index = regions.length;
        regions.push({id: `cell-${index}`, index, col, row, rect: {x: x0 / w, y: y0 / h, width: (x1 - x0) / w, height: (y1 - y0) / h},
          start: index * slot, end: (index + 1) * slot, features, contributions: contributionsOf(vector), midi: null, targetMidi: null, eventId: null});
      }
    }
    const events = featurePitchEvents(regions, allowed, 'feature-main', 0, info.main_instrument, 0, transition);
    for (const region of regions) region.reason = '全图蛇形单旋律；' + region.reason;
    return [events, regions, cols, rows];
  }

  const featurePitchMetadata = options => {
    const method = options.featureMethod || 'transition';
    return {featureMethod: method, pitchVersion: method === 'transition' ? PITCH_TRANSITION_VERSION : CONTOUR_VERSION,
      pitchTransition: options.featurePitchTransition || 'glide', voiceName: '暖键 · 连奏', scanOrder: 'column-snake', voiceCount: 1};
  };

  // analyze_image of a horizontal band, re-encoded to 8-bit like Image.fromarray(np.round(rgb * 255)).
  function analyzeBand(rgb, w, y0, y1) {
    const rows = y1 - y0 === 1 ? 2 : y1 - y0, bytes = new Uint8Array(rows * w * 3);
    for (let y = 0; y < rows; y++) {
      const source = (y0 + (y1 - y0 === 1 ? 0 : y)) * w * 3;
      for (let i = 0; i < w * 3; i++) bytes[y * w * 3 + i] = np.round(rgb[source + i] * 255);
    }
    return A.analyzeImage(bytes, w, rows);
  }

  function horizontalRowMelodies(result, info, options = {}) {
    const count = Math.trunc(options.rowCount ?? 4), method = options.rowMethod || 'reference', transition = options.pitchTransition || 'scale';
    if (![2, 3, 4].includes(count) || !['reference', 'reference-plus', 'features', 'transition'].includes(method)) throw new Error('行数或行内映射设置无效');
    if (!['scale', 'glide'].includes(transition)) throw new Error('音高转折设置无效');
    const {maps, features: F} = result, {rgb, width: w, height: h} = maps;
    if (h < count) throw new Error('图片高度不足以分割成所选行数');
    const cols = Math.min(info.bars * (method === 'features' ? 4 : 8), w), allowed = allowedNotes(F, info);
    const events = [], regions = [], voices = [];
    for (let row = 0; row < count; row++) {
      const y0 = np.round(row * h / count), y1 = np.round((row + 1) * h / count);
      const rowAnalysis = analyzeBand(rgb, w, y0, y1), f = rowAnalysis.features;
      const instrument = C.chooseInstruments(f, 'Automatic')[0], voiceId = `row-${row}`;
      voices.push({id: voiceId, row, name: `第 ${row + 1} 行`, instrument, instrumentName: C.instrumentLabel(instrument), features: f,
        rect: {x: 0, y: y0 / h, width: 1, height: (y1 - y0) / h}});
      const rowRegions = [];
      for (let col = 0; col < cols; col++) {
        const x0 = np.round(col * w / cols), x1 = Math.max(np.round(col * w / cols) + 1, np.round((col + 1) * w / cols));
        const [features, vector] = localFeatures(maps, y0, y1, x0, x1);
        const region = {id: `parallel-${row}-${col}`, index: regions.length, row, col, rowId: voiceId,
          rect: {x: x0 / w, y: y0 / h, width: (x1 - x0) / w, height: (y1 - y0) / h},
          start: col * info.duration / cols, end: (col + 1) * info.duration / cols, features, contributions: contributionsOf(vector),
          targetMidi: null, midi: null, eventId: null, reason: '此区域未产生起音'};
        rowRegions.push(region); regions.push(region);
      }
      let previous = null, previousVector = null, rowEvents = [];
      const pan = -.4 + .8 * row / Math.max(1, count - 1);
      if (method === 'transition') rowEvents = featurePitchEvents(rowRegions, allowed, voiceId, row, instrument, pan, transition);
      else if (method === 'reference' || method === 'reference-plus') {
        const offset = method === 'reference-plus' ? OCTAVE_LAYOUT[count][row] : 0;
        const [raw] = C.generateComposition(rowAnalysis, info.bars, f.auto_complexity, f.auto_variation_strength, info.scale_name, 'Automatic', 'Manual', info.tempo);
        const transpose = rootNote(F) - rootNote(f);
        for (const event of raw) {
          if (event.layer !== 'main') continue;
          const region = rowRegions[Math.min(cols - 1, Math.trunc(event.start / info.duration * cols + 1e-7))];
          const target = event.midi + transpose, candidates = previous === null ? allowed : allowed.filter(n => Math.abs(n - previous) <= 5);
          const midi = nearest(candidates, target);
          let played = midi + offset;
          while (played < 31) played += 12;
          const record = {...pick(event), id: `${voiceId}-note-${rowEvents.length}`, midi: played, rowId: voiceId, row,
            pan: np.clip(.55 * event.pan + .45 * pan, -.75, .75), sources: [{regionId: region.id, rect: region.rect}]};
          if (method === 'reference-plus') record.voicePreset = SOFT_LAYOUT[count][row];
          Object.assign(region, {eventId: record.id, midi: played, targetMidi: target + offset,
            reason: '行内参考条带法；统一到全图音阶与速度' + (offset ? '；按图片上下分到不同八度' : ''), originalMidi: event.midi});
          rowEvents.push(record); previous = midi;
        }
      } else {
        for (const region of rowRegions) {
          const fe = region.features, vector = [fe.brightness, .5 + (fe.hue - .5) * fe.saturation, fe.saturation, Math.min(1, fe.contrast * 3), fe.texture];
          const target = allowed[np.round(np.clip(np.sum(weighted(vector)), 0, 1) * (allowed.length - 1))];
          region.targetMidi = target;
          if (fe.brightness < .012) { region.reason = '暗区主旋律休止'; previous = previousVector = null; continue; }
          const delta = previousVector === null ? null : np.sum(vector.map((v, i) => Math.abs(v - previousVector[i]) * WEIGHTS[i]));
          const candidates = previous === null ? allowed : allowed.filter(n => Math.abs(n - previous) <= 5);
          let midi = nearest(candidates, target), reason = '本行局部颜色、明暗、对比度与纹理共同映射';
          if (previous !== null && delta < 1e-8) { midi = previous; reason = '本行区域特征稳定，保持同音'; }
          else if (previous !== null && delta >= .025 && midi === previous) {
            const difference = vector.map((v, i) => v - previousVector[i]), dominant = argmax(difference.map((d, i) => Math.abs(d) * WEIGHTS[i]));
            const direction = difference[dominant] > 0 ? 1 : -1, choices = candidates.filter(n => (n - midi) * direction > 0);
            if (choices.length) { midi = np.minBy(choices, n => [Math.abs(n - previous)]); reason = '本行明显特征变化保留一级音阶变化'; }
          }
          const slot = info.duration / cols;
          const velocity = np.clip(.30 + .30 * f.dynamic_range + .20 * f.contrast + .15 * fe.saturation + .25 * fe.contrast, .28, .90);
          let last = rowEvents.length ? rowEvents[rowEvents.length - 1] : null;
          const merge = last && last.midi === midi && Math.abs(last.coverageEnd - region.start) < 1e-7 && delta !== null && delta < .012;
          if (!merge) {
            last = {id: `${voiceId}-note-${rowEvents.length}`, start: region.start, duration: slot * .9, midi, velocity, instrument, pan,
              layer: 'main', rowId: voiceId, row, sources: [], coverageEnd: region.end};
            rowEvents.push(last);
          } else { last.duration = region.end - last.start - slot * .1; last.coverageEnd = region.end; }
          last.sources.push({regionId: region.id, rect: region.rect});
          Object.assign(region, {midi, eventId: last.id, reason});
          previous = midi; previousVector = vector;
        }
      }
      voices[voices.length - 1].noteCount = rowEvents.length;
      if (method === 'reference-plus') Object.assign(voices[voices.length - 1], {fixedMidi: true, voicePreset: SOFT_LAYOUT[count][row], name: `第 ${row + 1} 行 · ${OCTAVE_NAMES[count][row]}`});
      events.push(...rowEvents);
    }
    return [np.sortBy(events, e => [e.start, e.row, e.midi]), regions, cols, count, voices];
  }

  function arrangedRows(result, info, options = {}) {
    const count = Math.trunc(options.rowCount ?? 4);
    if (![2, 3, 4].includes(count)) throw new Error('行数或行内映射设置无效');
    const {maps, features: F} = result, {width: w, height: h} = maps, AR = PM.arranger;
    if (h < count) throw new Error('图片高度不足以分割成所选行数');
    const beat = 60 / info.tempo;
    let bars = Math.max(1, Math.trunc(info.duration / (4 * beat) + 1e-6)), cols = Math.min(bars * 4, w);
    bars = Math.floor(cols / 4); cols = bars * 4;
    const rows = [], regions = [];
    for (let row = 0; row < count; row++) {
      const y0 = np.round(row * h / count), y1 = np.round((row + 1) * h / count), rowRegions = [];
      for (let col = 0; col < cols; col++) {
        const x0 = np.round(col * w / cols), x1 = Math.max(np.round(col * w / cols) + 1, np.round((col + 1) * w / cols));
        const [features, vector] = localFeatures(maps, y0, y1, x0, x1);
        const region = {id: `parallel-${row}-${col}`, index: regions.length, row, col, rowId: `row-${row}`,
          rect: {x: x0 / w, y: y0 / h, width: (x1 - x0) / w, height: (y1 - y0) / h}, start: col * beat, end: (col + 1) * beat, features,
          contributions: contributionsOf(vector), targetMidi: null, midi: null, eventId: null, reason: '暗区休止，或由前一个音延续'};
        rowRegions.push(region); regions.push(region);
      }
      rows.push(rowRegions);
    }
    const [parts, backing, meta] = AR.arrange(F, info, rootNote(F), rows);
    const reasons = {melody: '主旋律：本行特征在全图中的相对高低决定旋律走向，强拍落在和弦音上；纹理与对比决定节奏疏密',
      counter: '副旋律：本行特征选择和弦内音，以长音衬在主旋律下方并避开碰撞',
      arpeggio: '分解和弦：本行明暗决定音区，纹理与对比决定分解速度',
      bass: '低音：每小节奏和弦根音，本行纹理与对比决定低音律动'};
    const events = [], voices = [], owners = new Set();
    for (let row = 0; row < count; row++) {
      const part = parts[row], role = part.role, voiceId = `row-${row}`;
      const y0 = np.round(row * h / count), y1 = np.round((row + 1) * h / count), rowEvents = [];
      for (const note of part.notes) {
        const [first, last] = note.cells, {cells, ...rest} = note;
        void cells;
        const covered = rows[row].slice(first, Math.max(first + 1, Math.min(last, cols)));
        const record = {...rest, id: `${voiceId}-note-${rowEvents.length}`, instrument: part.instrument, pan: AR.ROLE_PAN[role], layer: 'main',
          rowId: voiceId, row, role, coverageEnd: note.start + note.duration, sources: covered.map(r => ({regionId: r.id, rect: r.rect}))};
        for (const region of covered) {
          const startsHere = region.start - 1e-7 <= record.start && record.start < region.end - 1e-7;
          if ((startsHere && !owners.has(region)) || region.eventId === null) {
            Object.assign(region, {eventId: record.id, midi: record.midi, targetMidi: record.midi, reason: reasons[role]});
            if (startsHere) owners.add(region);
          }
        }
        rowEvents.push(record);
      }
      events.push(...rowEvents);
      voices.push({id: voiceId, row, name: `第 ${row + 1} 行 · ${AR.ROLE_NAMES[role]}`, instrument: part.instrument,
        instrumentName: C.instrumentLabel(part.instrument), rect: {x: 0, y: y0 / h, width: 1, height: (y1 - y0) / h},
        noteCount: rowEvents.length, role, gain: AR.ROLE_GAIN[role]});
    }
    return [np.sortBy(events, e => [e.start, e.row, e.midi]), regions, cols, count, voices, np.sortBy(backing, e => [e.start, e.midi]), meta];
  }

  const isArranged = voices => voices.some(v => v.role);
  const fixedMidi = voices => voices.some(v => v.role || v.fixedMidi);
  const softVoiceNames = (events, voices) => voices.map((v, i) => ('softName' in v ? v.softName
    : PM.softMixer.VOICES['voicePreset' in v ? v.voicePreset : PM.softMixer.presetIndex(events.filter(e => e.rowId === v.id), i)].name));
  const layerCounts = events => {
    const counts = {};
    for (const e of events) counts[e.layer] = (counts[e.layer] || 0) + 1;
    return counts;
  };

  // prepare_scores on decoded RGB bytes: the payload (without the preview image) and the render context.
  function prepareScores(pixels, width, height, options = {}) {
    const result = A.analyzeImage(pixels, width, height), F = result.features;
    const emotion = options.emotion ? PM.mood.estimate(F) : null;
    const [original, info] = originalComposition(result, options, emotion);
    const [reference, referenceRegions] = serializeReference(original, result, info);
    const [featureMain, featureRegions, cols, rows] = fullFeatureMelody(result, info, options);
    const feature = np.sortBy([...reference.filter(r => r.layer !== 'main'), ...featureMain], e => [e.start, e.layer, e.midi]);
    const rowMethod = options.rowMethod, arranged = rowMethod === 'arranged';
    let rowEvents, rowRegions, rowCols, rowCount, voices, backingEvents, arrangement, segmented = null, harmony = null;
    if (arranged) [rowEvents, rowRegions, rowCols, rowCount, voices, backingEvents, arrangement] = arrangedRows(result, info, options);
    else if (rowMethod === 'regions') [rowEvents, rowRegions, rowCols, rowCount, voices, segmented] = PM.regionMusic.build(result, info, options);
    else {
      [rowEvents, rowRegions, rowCols, rowCount, voices] = horizontalRowMelodies(result, info, options);
      backingEvents = reference.filter(e => e.layer !== 'main');
    }
    const backingOn = options.backing ?? true;
    if (rowMethod === 'reference-plus' || rowMethod === 'regions') {
      const beat = 60 / info.tempo;
      [backingEvents, harmony] = PM.arranger.harmonize(rowEvents, info, rootNote(F), Math.max(1, Math.trunc(info.duration / (4 * beat) + 1e-6)));
      if (segmented && segmented.pedal && segmented.pedal.length) backingEvents = np.sortBy([...backingEvents, ...segmented.pedal], e => [e.start, e.midi]);
    }
    if (segmented) delete segmented.pedal;
    if (emotion) {
      // The derived pad follows the mood's pad colour; dynamics and touch shape every voice.
      for (const e of backingEvents || []) if (e.instrument === 'warm_pad') e.instrument = info.pad_instrument;
      PM.mood.shape([reference, featureMain, rowEvents, backingEvents || []], emotion);
    }
    const parallel = np.sortBy([...rowEvents, ...(backingOn ? backingEvents : [])], e => [e.start, e.layer, e.midi]);
    const duration = np.round((info.duration + .8) * 44100) / 44100, variants = {};
    for (const [key, records, regions, w, h] of [['reference', reference, referenceRegions, info.bars * 8, 1], ['features', feature, featureRegions, cols, rows],
      ['parallel', parallel, rowRegions, rowCols, rowCount]]) {
      const audible = records.filter(e => backingOn || e.layer === 'main');
      variants[key] = {events: audible, regions, cols: w, rows: h, duration, mainCount: audible.filter(e => e.layer === 'main').length,
        layerCounts: layerCounts(audible), audioStatus: 'on-demand'};
    }
    Object.assign(variants.parallel, {version: PARALLEL_VERSION, voices, rowMethod: rowMethod || 'reference',
      mixProfiles: {original: {name: '原有叠加'}, soft: {name: '柔和合成混音', version: PM.softMixer.VERSION, voices: softVoiceNames(rowEvents, voices)}}});
    if (rowMethod === 'transition') Object.assign(variants.parallel, {pitchVersion: PITCH_TRANSITION_VERSION, pitchTransition: options.pitchTransition || 'scale'});
    if (arranged) variants.parallel.arrangement = arrangement;
    if (harmony) variants.parallel.harmony = harmony;
    if (segmented) variants.parallel.segmentation = segmented;
    if (['contour', 'transition'].includes(options.featureMethod)) Object.assign(variants.features, featurePitchMetadata(options));
    const payload = {version: VERSION, upstream: UPSTREAM_SHA, info, features: F,
      settings: {synth: options.synth || 'Simple', mapping: options.mapping || 'Scientific', backing: backingOn, randomFactor: 0, ...(emotion ? {emotion: true} : {})},
      image: {width: result.maps.width, height: result.maps.height}, variants};
    const context = {info, synth: options.synth || 'Simple', rowEvents, reference, voices, backing: backingOn};
    if (arranged || harmony) Object.assign(context, {backingEvents, fixedMidi: true});
    return {payload, context, rgb: result.maps.rgb};
  }

  PM.scores = {OCTAVE_LAYOUT, SOFT_LAYOUT, OCTAVE_NAMES, WEIGHTS, FEATURE_NAMES, EVENT_FIELDS, VERSION, rootNote, allowedNotes,
    originalComposition, localFeatures, serializeReference, featurePitchEvents, fullFeatureMelody, horizontalRowMelodies, arrangedRows,
    isArranged, fixedMidi, softVoiceNames, prepareScores};
});
