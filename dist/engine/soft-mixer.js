/* soft_row_mixer.py: the additive soft-row renderer, its shared light echo, crowd
 * compensation and master. The FFT one-pole filter is computed recursively here; the
 * truncated kernel it stood for differs by less than 1e-9 of the signal. */
(self.PixelMusicEngineModules = self.PixelMusicEngineModules || []).push(function (PM) {
  'use strict';
  const {np} = PM, L = PM.libm;
  const SR = 44100, VERSION = 'soft-row-mix-v1', GLIDE = .18, ROW_VOICES = 4;
  const VOICES = [
    {name: '暖键', partials: [1, .24, .075, .025], attack: .012, decay: .58, sustain: .18, release: .14, cutoff: 3600, gain: 1},
    {name: '柔拨弦', partials: [1, .12, .17, .04, .045], attack: .014, decay: .36, sustain: .13, release: .12, cutoff: 2200, gain: .96},
    {name: '圆木琴', partials: [1, .045, .015, .16], attack: .010, decay: .27, sustain: .10, release: .10, cutoff: 3100, gain: 1.05},
    {name: '轻铃', partials: [1, .06, .025, .12, .012], attack: .016, decay: .82, sustain: .12, release: .18, cutoff: 4500, gain: .88},
    {name: '柔低音', partials: [1, .32, .09, .03], attack: .02, decay: .9, sustain: .3, release: .2, cutoff: 1100, gain: 1.05}];

  const presetIndex = (events, row) => (events.length && 'voicePreset' in events[0] ? events[0].voicePreset : row % ROW_VOICES);
  const stereoOf = (row, count) => {
    const pan = count === 1 ? 0 : -.48 + .96 * row / (count - 1);
    return [L.cos((pan + 1) * Math.PI / 4), L.sin((pan + 1) * Math.PI / 4)];
  };

  function renderVoice(events, frames, row, count) {
    if (events.length && ['scale', 'glide'].includes(events[0].pitchTransition)) return renderConnectedVoice(events, frames, row, count);
    const stemPreset = VOICES[presetIndex(events, row)], samples = new Float64Array(frames * 2), activity = new Float32Array(frames);
    const [sl, sr] = stereoOf(row, count);
    for (const event of events) {
      const preset = 'voicePreset' in event ? VOICES[event.voicePreset] : stemPreset;
      const start = Math.max(0, np.round(event.start * SR)), gate = Math.max(1 / SR, event.duration);
      const size = Math.min(frames - start, Math.ceil((gate + preset.release * 5) * SR));
      if (size <= 0) continue;
      const attack = preset.attack * (event.attackScale ?? 1), cutoff = preset.cutoff * (event.toneScale ?? 1), bend = event.bend ?? 0;
      const envelope = new Float64Array(size), t = new Float64Array(size);
      for (let i = 0; i < size; i++) {
        t[i] = i / SR;
        const held = Math.min(t[i], gate);
        envelope[i] = (1 - L.exp(-held / attack)) * (preset.sustain + (1 - preset.sustain) * L.exp(-held / preset.decay))
          * L.exp(-Math.max(0, t[i] - gate) / preset.release);
      }
      const frequency = 440 * L.pow(2, (event.midi - 69) / 12);
      let phase = null;
      if (bend) {
        const span = Math.min(GLIDE, .4 * gate);
        phase = new Float64Array(size);
        let acc = 0;
        for (let i = 0; i < size; i++) {
          phase[i] = 2 * Math.PI * acc / SR;
          const ramp = np.clip((Math.min(t[i], gate) - (gate - span)) / span, 0, 1);
          acc += frequency * L.pow(2, bend * ramp * ramp * (3 - 2 * ramp) / 12);
        }
      }
      const signal = new Float64Array(size);
      let energy = 0, partialDecay = null;
      preset.partials.forEach((amplitude, index) => {
        const harmonic = index + 1, hz = harmonic * frequency;
        if (hz >= SR * .45) return;
        amplitude /= Math.sqrt(1 + L.pow(hz / cutoff, 4));
        const w = 2 * Math.PI * hz;
        if (harmonic === 1) for (let i = 0; i < size; i++) signal[i] += amplitude * 1 * (bend ? L.sin(harmonic * phase[i]) : L.sin(w * t[i]));
        else {
          // Upper partials settle sooner; the decay curve is the same for each of them.
          if (!partialDecay) { partialDecay = new Float64Array(size); for (let i = 0; i < size; i++) partialDecay[i] = .35 + .65 * L.exp(-t[i] / .32); }
          for (let i = 0; i < size; i++) signal[i] += amplitude * partialDecay[i] * (bend ? L.sin(harmonic * phase[i]) : L.sin(w * t[i]));
        }
        energy += L.pow(amplitude, 2);
      });
      const norm = Math.sqrt(Math.max(energy, 1e-9)), velocity = np.clip(event.velocity, 0, 1);
      const compensation = np.clip(L.pow(440 / Math.max(60, frequency), .16), .82, 1.3);
      const level = .14 * preset.gain * Math.sqrt(velocity) * compensation;
      for (let i = 0; i < size; i++) {
        const v = signal[i] / norm * envelope[i] * level, f = start + i;
        samples[2 * f] += v * sl; samples[2 * f + 1] += v * sr;
        activity[f] += envelope[i] * velocity;
      }
    }
    return [samples, activity];
  }

  function renderConnectedVoice(events, frames, row, count) {
    const preset = VOICES[presetIndex(events, row)], samples = new Float64Array(frames * 2), activity = new Float32Array(frames);
    const [sl, sr] = stereoOf(row, count), phrases = [];
    for (const event of np.sortBy(events, e => [e.start])) {
      const lastPhrase = phrases[phrases.length - 1], end = lastPhrase && lastPhrase[lastPhrase.length - 1];
      if (!lastPhrase || event.start > end.start + end.duration + 1 / SR) phrases.push([]);
      phrases[phrases.length - 1].push(event);
    }
    for (const phrase of phrases) {
      const start = Math.max(0, np.round(phrase[0].start * SR)), final = phrase[phrase.length - 1];
      const gate = Math.max(1, np.round((final.start + final.duration) * SR) - start);
      const size = Math.min(frames - start, gate + np.round(preset.release * 5 * SR));
      if (size <= 0) continue;
      const frequency = new Float64Array(size), velocity = new Float64Array(size);
      let previous = null, previousVelocity = phrase[0].velocity, cursor = 0;
      for (const event of phrase) {
        const end = Math.min(size, np.round((event.start + event.duration) * SR) - start), length = end - cursor;
        if (length <= 0) continue;
        const pitch = event.pitchTransition === 'glide' ? event.curveMidi : event.midi, target = 440 * L.pow(2, (pitch - 69) / 12);
        if (previous === null) previous = target;
        const tau = event.pitchTransition === 'scale' ? .002 : Math.min(.09, Math.max(.02, event.duration / 6));
        for (let i = 0; i < length; i++) {
          frequency[cursor + i] = target + (previous - target) * L.exp(-(i / SR) / tau);
          velocity[cursor + i] = event.velocity + (previousVelocity - event.velocity) * L.exp(-i / (SR * .025));
        }
        previous = target + (previous - target) * L.exp(-length / (SR * tau));
        previousVelocity = event.velocity + (previousVelocity - event.velocity) * L.exp(-length / (SR * .025));
        cursor = end;
      }
      frequency.fill(previous, cursor); velocity.fill(previousVelocity, cursor);
      let acc = 0;
      const phase = new Float64Array(size);
      for (let i = 0; i < size; i++) { phase[i] = 2 * Math.PI * acc / SR; acc += frequency[i]; }
      const partialCount = preset.partials.length, amplitudes = new Float64Array(partialCount);
      let cachedFrequency = NaN, cachedVelocity = NaN, norm = 1, compensation = 1, velocityLevel = 0;
      for (let i = 0; i < size; i++) {
        const t = i / SR, held = Math.min(t, gate / SR);
        const envelope = (1 - L.exp(-held / preset.attack)) * (.48 + .52 * L.exp(-held / preset.decay)) * L.exp(-Math.max(0, t - gate / SR) / preset.release);
        // Partial amplitudes depend only on the frequency, which holds steady between glides.
        if (frequency[i] !== cachedFrequency) {
          cachedFrequency = frequency[i];
          let energy = 0;
          for (let k = 0; k < partialCount; k++) {
            const hz = (k + 1) * cachedFrequency;
            amplitudes[k] = preset.partials[k] / Math.sqrt(1 + L.pow(hz / preset.cutoff, 4)) * (hz < SR * .45 ? 1 : 0);
            energy += amplitudes[k] * amplitudes[k];
          }
          norm = Math.sqrt(Math.max(energy, 1e-9));
          compensation = np.clip(L.pow(440 / Math.max(60, cachedFrequency), .16), .82, 1.3);
        }
        if (velocity[i] !== cachedVelocity) { cachedVelocity = velocity[i]; velocityLevel = Math.sqrt(np.clip(cachedVelocity, 0, 1)); }
        let signal = 0;
        for (let k = 0; k < partialCount; k++) signal += amplitudes[k] * L.sin((k + 1) * phase[i]);
        signal /= norm;
        const level = .14 * preset.gain * velocityLevel * compensation;
        const v = signal * envelope * level, f = start + i;
        samples[2 * f] += v * sl; samples[2 * f + 1] += v * sr;
        activity[f] += envelope * velocity[i];
      }
    }
    return [samples, activity];
  }

  // Causal one-pole low-pass per channel.
  function lowpass(samples, hz) {
    const a = L.exp(-2 * Math.PI * hz / SR), b = 1 - a, out = new Float64Array(samples.length);
    let yl = 0, yr = 0;
    for (let i = 0; i < samples.length; i += 2) {
      yl = b * samples[i] + a * yl; yr = b * samples[i + 1] + a * yr;
      out[i] = yl; out[i + 1] = yr;
    }
    return out;
  }
  const minus = (x, y) => x.map((v, i) => v - y[i]);

  function lightEcho(samples) {
    const filtered = lowpass(minus(samples, lowpass(samples, 240)), 3000), result = Float64Array.from(samples);
    const delay = np.round(.28 * SR), frames = samples.length / 2;
    for (let repeat = 1; repeat < 6; repeat++) {
      const offset = repeat * delay;
      if (offset >= frames) break;
      const gain = L.pow(.24, repeat - 1);
      for (let i = offset * 2; i < samples.length; i++) result[i] += filtered[i - offset * 2] * .13 * gain;
    }
    return result;
  }

  function prepare(events, rowIds, frames, background = null) {
    const stems = {}, activity = new Float64Array(frames);
    rowIds.forEach((key, row) => {
      const [stem, active] = renderVoice(events.filter(e => e.rowId === key), frames, row, rowIds.length);
      stems[key] = stem;
      for (let i = 0; i < frames; i++) activity[i] += active[i];
    });
    const target = Float64Array.from(activity, a => 1 / Math.sqrt(1 + .65 * Math.max(0, a - .5)));
    const hop = 128, knots = [], smooth = 1 - L.exp(-hop / (SR * .075));
    let previous = target[0];
    for (let i = 0; i < frames; i += hop) { previous += (np.mean(target.subarray(i, i + hop)) - previous) * smooth; knots.push(previous); }
    const bus = new Float64Array(frames);
    for (let i = 0; i < frames; i++) {
      const k = Math.floor(i / hop), x0 = k * hop;
      bus[i] = k + 1 < knots.length ? knots[k] + (knots[k + 1] - knots[k]) / hop * (i - x0) : knots[knots.length - 1];
    }
    for (const key of rowIds) {
      const scaled = stems[key].map((v, i) => v * bus[i >> 1]);
      stems[key] = lightEcho(scaled);
    }
    if (background) {
      const filtered = lowpass(minus(background, lowpass(background, 85)), 5200), level = PM.synth.rms(filtered);
      const gain = Math.min(.55, .019 / Math.max(level, 1e-9));
      stems.background = filtered.map(v => v * gain);
    }
    const full = new Float64Array(frames * 2);
    for (const stem of Object.values(stems)) for (let i = 0; i < full.length; i++) full[i] += stem[i];
    const gain = Math.min(3.5, .085 / Math.max(PM.synth.rms(full), 1e-9));
    const names = rowIds.map((key, row) => VOICES[presetIndex(events.filter(e => e.rowId === key), row)].name);
    const transition = events.find(e => 'pitchTransition' in e);
    return [stems, gain, {version: VERSION, voices: names, pitchTransition: transition ? transition.pitchTransition : 'struck',
      echoSeconds: .28, echoWet: .13, echoLowCutHz: 240, fixedSoloGain: true, masterGain: gain, peakCeiling: .9}];
  }

  function master(samples, gain) {
    const [ml, mr] = PM.synth.channelMeans(samples), out = new Float64Array(samples.length), frames = samples.length / 2;
    for (let i = 0; i < samples.length; i += 2) {
      out[i] = .9 * L.tanh((samples[i] - ml) * gain / .9);
      out[i + 1] = .9 * L.tanh((samples[i + 1] - mr) * gain / .9);
    }
    const tail = Math.min(frames, np.round(.025 * SR)), fade = np.linspace(1, 0, tail);
    for (let k = 0; k < tail; k++) { const f = frames - tail + k; out[2 * f] *= fade[k]; out[2 * f + 1] *= fade[k]; }
    return out;
  }

  function preview(event, count = 4) {
    const record = {...event, start: 0, duration: Math.min(.65, event.duration)}, frames = np.round(1.5 * SR);
    const [samples] = renderVoice([record], frames, Math.trunc(event.row ?? 0), count);
    return master(lightEcho(samples), 1.5);
  }

  PM.softMixer = {VERSION, VOICES, presetIndex, renderVoice, lowpass, lightEcho, prepare, master, preview};
});
