/* audio.py's Simple additive synthesizer, master normalization and WAV encoding.
 * Stereo audio is interleaved: frame i is [2i] (left) and [2i + 1] (right). */
(self.PixelMusicEngineModules = self.PixelMusicEngineModules || []).push(function (PM) {
  'use strict';
  const {np} = PM, L = PM.libm;
  const SR = 44100, TARGET_PEAK = .86, TARGET_RMS = .16, TWO_PI = 2 * Math.PI;

  // np.linspace with endpoint True or False: start + i * step.
  function linspace(start, stop, num, endpoint = true) {
    if (endpoint) return np.linspace(start, stop, num);
    const out = new Float64Array(num), step = (stop - start) / num;
    for (let i = 0; i < num; i++) out[i] = i * step + start;
    return out;
  }

  function adsr(n, attack, decay, sustain, release) {
    const env = new Float64Array(Math.max(1, n)).fill(sustain);
    const a = Math.trunc(Math.max(1, attack * SR)), d = Math.trunc(Math.max(1, decay * SR)), r = Math.trunc(Math.max(1, release * SR));
    const na = Math.min(n, a), nad = Math.min(n, a + d);
    env.set(linspace(0, 1, na, false), 0);
    if (nad > na) env.set(linspace(1, sustain, nad - na, false), na);
    const rs = Math.max(0, n - r), fade = linspace(1, 0, n - rs);
    for (let i = rs; i < n; i++) env[i] *= fade[i - rs];
    return env;
  }

  const GM = {bell: [8, 9, 10, 11, 14, 98, 112], marimba: [12, 13, 108], harp: [46, 104, 105, 106, 107]};
  function gmToSimple(instrument) {
    if (!instrument.startsWith('gm_')) return instrument;
    const p = Number.parseInt(instrument.slice(3), 10);
    if (!Number.isFinite(p)) return 'soft_piano';
    if (GM.bell.includes(p)) return 'bright_bell';
    if (GM.marimba.includes(p)) return 'marimba';
    if (GM.harp.includes(p)) return 'harp';
    if (p >= 32 && p <= 39) return 'soft_bass';
    if (p >= 40 && p <= 51) return 'bowed_string';
    if (p >= 64 && p <= 79) return 'flute_like_lead';
    if (p >= 80 && p <= 87) return 'synth_pluck';
    if (p >= 88 && p <= 103) return 'warm_pad';
    return 'soft_piano';
  }

  // sum(a * sin(2 pi freq m t) for m, a in partials), accumulated partial by partial.
  function partialSum(n, freq, partials) {
    const sig = new Float64Array(n);
    for (const [m, a] of partials) {
      const w = TWO_PI * freq * m;
      for (let i = 0; i < n; i++) sig[i] += a * L.sin(w * (i / SR));
    }
    return sig;
  }
  // Vibrato phase: 2 pi freq cumsum(1 + depth sin(2 pi rate t)) / sr.
  function vibratoPhase(n, freq, depth, rate) {
    const phase = new Float64Array(n), w = TWO_PI * rate, scale = TWO_PI * freq;
    let acc = 0;
    for (let i = 0; i < n; i++) { acc += 1 + depth * L.sin(w * (i / SR)); phase[i] = scale * acc / SR; }
    return phase;
  }
  const BELL = [[1, 1], [2.41, .55], [3.77, .30], [5.93, .16], [8.12, .06]], BOX = [[1, 1], [2.01, .45], [3.02, .24], [4.17, .12]];
  const PIANO = [[1, 1], [2, .42], [3, .20], [4, .10], [5, .04]];

  function synthesizeNote(freq, duration, instrument, velocity) {
    instrument = gmToSimple(instrument);
    const n = Math.max(1, np.round(duration * SR));
    velocity = np.clamp(velocity, 0, 1);
    if (instrument === 'none') return new Float64Array(n);
    let sig, env;
    const decayEnv = rate => { const out = new Float64Array(n), d = Math.max(duration, 1e-6); for (let i = 0; i < n; i++) out[i] = L.exp(-rate * (i / SR) / d); return out; };
    const times = (a, b) => { for (let i = 0; i < a.length; i++) a[i] *= b[i]; return a; };
    if (instrument === 'soft_piano') {
      sig = partialSum(n, freq, PIANO);
      env = times(decayEnv(2.7), adsr(n, .008, .12, .20, Math.min(.20, duration * .35)));
    } else if (['music_box', 'bright_bell', 'celesta', 'kalimba'].includes(instrument)) {
      sig = partialSum(n, freq, instrument === 'bright_bell' ? BELL : BOX);
      env = times(decayEnv(4.2), adsr(n, .002, .07, .08, Math.min(.15, duration * .4)));
    } else if (['harp', 'synth_pluck', 'marimba'].includes(instrument)) {
      sig = partialSum(n, freq, [1, 2, 3, 4, 5, 6, 7].map(k => [k, 1 / L.pow(k, 1.25)]));
      env = times(decayEnv(4.8), adsr(n, .004, .07, .09, Math.min(.16, duration * .35)));
    } else if (instrument === 'warm_pad' || instrument === 'glass_pad') {
      const phase = vibratoPhase(n, freq, .0025, 4.5);
      sig = phase.map(p => .75 * L.sin(p) + .24 * L.sin(2.01 * p) + .12 * L.sin(3.98 * p));
      env = adsr(n, Math.min(.65, duration * .45), .45, .78, Math.min(.75, duration * .5));
    } else if (instrument === 'cello' || instrument === 'bowed_string') {
      const phase = vibratoPhase(n, freq, .004, 5.1);
      sig = phase.map(p => .75 * L.sin(p) + .33 * L.sin(2 * p) + .17 * L.sin(3 * p));
      env = adsr(n, .07, .18, .72, Math.min(.35, duration * .4));
    } else if (instrument === 'soft_bass') {
      const w1 = TWO_PI * freq, w2 = TWO_PI * 2 * freq;
      sig = new Float64Array(n);
      for (let i = 0; i < n; i++) { const t = i / SR; sig[i] = .92 * L.sin(w1 * t) + .30 * L.sin(w2 * t); }
      env = adsr(n, .015, .12, .58, Math.min(.25, duration * .35));
    } else {
      const w = TWO_PI * freq;
      sig = new Float64Array(n);
      for (let i = 0; i < n; i++) sig[i] = L.sin(w * (i / SR));
      env = adsr(n, .01, .10, .50, Math.min(.20, duration * .4));
    }
    let mx = 0;
    for (let i = 0; i < n; i++) { sig[i] *= env[i]; mx = Math.max(mx, Math.abs(sig[i])); }
    const scale = mx > 1e-12 ? mx : 1;
    for (let i = 0; i < n; i++) sig[i] = (mx > 1e-12 ? sig[i] / scale : sig[i]) * velocity;
    return sig;
  }

  const midiToFreq = midi => 440 * L.pow(2, (midi - 69) / 12);

  // render_events(..., normalize=False): the raw stereo mix of a score, (duration + .8) s long.
  function renderEvents(events, duration) {
    const total = np.round((duration + .8) * SR), audio = new Float64Array(total * 2);
    for (const ev of events) {
      if (ev.duration <= 0 || ev.instrument === 'none') continue;
      const start = np.round(ev.start * SR);
      if (start >= total) continue;
      const tone = synthesizeNote(midiToFreq(ev.midi), ev.duration, ev.instrument, ev.velocity);
      const end = Math.min(total, start + tone.length), pan = np.clamp(ev.pan, -1, 1);
      const left = L.cos((pan + 1) * Math.PI / 4), right = L.sin((pan + 1) * Math.PI / 4);
      for (let i = start; i < end; i++) { audio[2 * i] += tone[i - start] * left; audio[2 * i + 1] += tone[i - start] * right; }
    }
    return audio;
  }

  // Column means of an interleaved stereo buffer (np.mean(audio, axis=0)).
  function channelMeans(audio) {
    let l = 0, r = 0;
    for (let i = 0; i < audio.length; i += 2) { l += audio[i]; r += audio[i + 1]; }
    const n = audio.length / 2;
    return [l / n, r / n];
  }
  function rms(audio, frames = audio.length / 2) {
    const sq = new Float64Array(frames * 2);
    for (let i = 0; i < sq.length; i++) sq[i] = audio[i] * audio[i];
    return Math.sqrt(np.mean(sq));
  }
  function peak(audio) {
    let m = 0;
    for (let i = 0; i < audio.length; i++) { const a = Math.abs(audio[i]); if (a > m) m = a; }
    return m;
  }

  function normalizeMaster(audio, targetPeak = TARGET_PEAK, targetRms = TARGET_RMS) {
    const out = new Float64Array(audio.length);
    for (let i = 0; i < audio.length; i++) { const v = audio[i]; out[i] = Number.isFinite(v) ? v : 0; }
    if (!out.length) return out;
    const [ml, mr] = channelMeans(out);
    for (let i = 0; i < out.length; i += 2) { out[i] -= ml; out[i + 1] -= mr; }
    const level = rms(out);
    if (level > targetRms && level > 1e-12) { const g = targetRms / level; for (let i = 0; i < out.length; i++) out[i] *= g; }
    const p = peak(out);
    if (p > targetPeak && p > 1e-12) { const g = targetPeak / p; for (let i = 0; i < out.length; i++) out[i] *= g; }
    for (let i = 0; i < out.length; i++) { const v = out[i]; out[i] = v < -.98 ? -.98 : v > .98 ? .98 : v; }
    return out;
  }

  // render_backend(events, info, 'Simple').
  const renderBackend = (events, info) => normalizeMaster(renderEvents(events, info.duration));

  function wavBytes(audio) {
    const frames = audio.length / 2, buffer = new ArrayBuffer(44 + frames * 4), view = new DataView(buffer);
    const text = (offset, s) => { for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i)); };
    text(0, 'RIFF'); view.setUint32(4, 36 + frames * 4, true); text(8, 'WAVE'); text(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true); view.setUint32(24, SR, true);
    view.setUint32(28, SR * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, frames * 4, true);
    const pcm = new Int16Array(buffer, 44); // little-endian on every browser platform
    for (let i = 0; i < audio.length; i++) { const v = audio[i]; pcm[i] = (v < -1 ? -1 : v > 1 ? 1 : v) * 32767; }
    return new Uint8Array(buffer);
  }
  // _pcm(wav): the int16 samples back as floats / 32767.
  function pcm(wav) {
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength), n = (wav.byteLength - 44) / 2, out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = view.getInt16(44 + i * 2, true) / 32767;
    return out;
  }

  function metrics(audio) {
    let invalid = 0, clipped = 0, p = 0;
    for (let i = 0; i < audio.length; i++) { const v = audio[i]; if (!Number.isFinite(v)) invalid++; const a = Math.abs(v); if (a >= .98) clipped++; if (a > p) p = a; }
    const frames = audio.length / 2;
    return {peak: p, rms: rms(audio), invalid, clipped, first12Rms: rms(audio, Math.min(frames, 12 * SR)), seconds: frames / SR};
  }

  PM.synth = {SR, linspace, adsr, synthesizeNote, midiToFreq, renderEvents, normalizeMaster, renderBackend, wavBytes, pcm, metrics, channelMeans, rms, peak};
});
