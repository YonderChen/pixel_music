/* reference_music.py's audio side: whole-score renders, per-row stems and their mixes.
 * Stems are kept as int16 PCM, exactly what the former engine stored as WAV bytes. */
(self.PixelMusicEngineModules = self.PixelMusicEngineModules || []).push(function (PM) {
  'use strict';
  const {np} = PM, S = PM.synth, SR = S.SR;

  // audio_to_wav_bytes followed by _pcm: the int16 samples a stem keeps.
  function quantize(audio) {
    const out = new Int16Array(audio.length);
    for (let i = 0; i < audio.length; i++) { const v = audio[i]; out[i] = (v < -1 ? -1 : v > 1 ? 1 : v) * 32767; } // truncates like astype
    return out;
  }
  const pcmValue = v => v / 32767;
  function pcmPeak(stem) { let m = 0; for (let i = 0; i < stem.length; i++) { const a = Math.abs(stem[i]); if (a > m) m = a; } return m / 32767; }

  const audioMetrics = audio => S.metrics(audio);
  const toEvents = records => records.map(r => ({start: r.start, duration: r.duration, midi: r.midi, velocity: r.velocity,
    instrument: r.instrument, pan: r.pan, layer: r.layer}));

  // render_score: render_backend, then the page's own master normalization.
  function renderScore(records, info) {
    const samples = S.normalizeMaster(S.renderBackend(toEvents(records), info));
    return {wav: S.wavBytes(samples), metrics: audioMetrics(samples)};
  }

  const backingRecords = context => (context.backingEvents && context.backingEvents.length ? context.backingEvents : context.reference.filter(e => e.layer !== 'main'));
  const renderBacking = context => quantize(S.normalizeMaster(S.renderBackend(toEvents(backingRecords(context)), context.info)));

  // _level_gain: brings the RMS of the sounding 2048-frame blocks to the target.
  function levelGain(stem, target = .1) {
    const block = 2048, frames = stem.length / 2, count = Math.floor(frames / block);
    if (!count) return 1;
    const energy = new Float64Array(count), tmp = new Float64Array(block * 2);
    for (let b = 0; b < count; b++) {
      for (let i = 0; i < block * 2; i++) { const v = pcmValue(stem[b * block * 2 + i]); tmp[i] = v * v; }
      energy[b] = np.mean(tmp);
    }
    let mx = -Infinity;
    for (const e of energy) mx = Math.max(mx, e);
    const loud = energy.filter(e => e > Math.max(mx * 1e-3, 1e-10));
    return loud.length ? Math.min(8, target / Math.sqrt(np.mean(loud))) : 1;
  }

  const isArranged = voices => voices.some(v => v.role);

  // mix_row_stems: enabled rows (and the background) at the stored gains, then the master stage.
  function mixRowStems(storage, enabledRows = null, includeBackground = true, profile = 'original') {
    const ids = enabledRows === null || enabledRows === undefined ? storage.rowIds : enabledRows;
    if (new Set(ids).size !== ids.length || ids.some(key => !storage.rowIds.includes(key))) throw new Error('声部选择无效');
    if (profile !== 'original' && profile !== 'soft') throw new Error('未知混音风格');
    const source = profile === 'original' ? storage : storage.profiles.soft;
    const size = storage.frames, samples = new Float64Array(size * 2), voiceGain = source.voiceGain || {};
    for (const key of ids) {
      const stem = source.wav[key], rowGain = source.rowGain, gain = key in voiceGain ? voiceGain[key] : 1;
      for (let i = 0; i < samples.length; i++) samples[i] += pcmValue(stem[i]) * rowGain * gain;
    }
    if (includeBackground && source.wav.background) {
      const stem = source.wav.background, gain = source.backgroundGain ?? 1;
      for (let i = 0; i < samples.length; i++) samples[i] += pcmValue(stem[i]) * gain;
    }
    const [ml, mr] = S.channelMeans(samples);
    for (let i = 0; i < samples.length; i += 2) { samples[i] -= ml; samples[i + 1] -= mr; }
    let out;
    if (profile === 'soft') out = PM.softMixer.master(samples, source.masterGain);
    else { out = samples; for (let i = 0; i < out.length; i++) out[i] = np.clip(out[i] * source.masterGain, -.98, .98); }
    return {wav: S.wavBytes(out), metrics: audioMetrics(out)};
  }

  // render_parallel(..., include_soft=False): one normalized stem per row plus the shared backing.
  function renderParallel(events, reference, info, voices, backing, backgroundStem = null) {
    const stems = {}, rowIds = voices.map(v => v.id), voiceGain = {};
    for (const v of voices) voiceGain[v.id] = Number(v.gain ?? 1);
    let backgroundGain = isArranged(voices) ? PM.arranger.BACKING_GAIN : 1;
    for (const key of [...rowIds, ...(backing ? ['background'] : [])]) {
      if (key === 'background' && backgroundStem) { stems[key] = backgroundStem; continue; }
      const records = key !== 'background' ? events.filter(e => e.rowId === key) : reference.filter(e => e.layer !== 'main');
      stems[key] = quantize(S.normalizeMaster(S.renderBackend(toEvents(records), info)));
    }
    if (isArranged(voices)) {
      for (const key of rowIds) voiceGain[key] *= levelGain(stems[key]);
      if (stems.background) backgroundGain *= levelGain(stems.background);
    }
    const frames = stems[rowIds[0]].length / 2, rowGain = .8 / Math.sqrt(rowIds.length), full = new Float64Array(frames * 2);
    for (const key of rowIds) { const stem = stems[key], g = voiceGain[key]; for (let i = 0; i < full.length; i++) full[i] += pcmValue(stem[i]) * rowGain * g; }
    if (stems.background) { const stem = stems.background; for (let i = 0; i < full.length; i++) full[i] += pcmValue(stem[i]) * backgroundGain; }
    const dc = S.channelMeans(full);
    for (let i = 0; i < full.length; i += 2) { full[i] -= dc[0]; full[i + 1] -= dc[1]; }
    const level = S.rms(full);
    let masterGain = Math.min(1, .16 / Math.max(level, 1e-12));
    if (isArranged(voices)) masterGain = Math.min(4, .085 / Math.max(level, 1e-12));
    let bound = 0;
    for (const key of rowIds) bound += pcmPeak(stems[key]) * rowGain * voiceGain[key];
    if (stems.background) bound += pcmPeak(stems.background) * backgroundGain;
    masterGain = Math.min(masterGain, .86 / Math.max(bound + 1e-6, 1e-12));
    const storage = {wav: stems, rowIds, frames, rowGain, masterGain, dc, profiles: {}};
    if (isArranged(voices)) Object.assign(storage, {voiceGain, backgroundGain});
    return {...mixRowStems(storage), storage};
  }

  // render_soft_rows: the soft mixer's stems, mastered with its own gain.
  function renderSoftRows(context, backgroundStem = null) {
    const frames = np.round((context.info.duration + .8) * SR), ids = context.voices.map(v => v.id);
    const background = backgroundStem ? Float64Array.from(backgroundStem, pcmValue) : null;
    const [stems, gain, metadata] = PM.softMixer.prepare(context.rowEvents, ids, frames, background);
    if (context.voices.some(v => 'voicePreset' in v)) metadata.voices = PM.scores.softVoiceNames(context.rowEvents, context.voices);
    const wav = {};
    for (const [key, data] of Object.entries(stems)) wav[key] = quantize(data);
    const storage = {rowIds: ids, frames, profiles: {soft: {wav, rowGain: 1, masterGain: gain, metadata}}};
    return {...mixRowStems(storage, null, true, 'soft'), storage, metadata};
  }

  PM.render = {quantize, audioMetrics, renderScore, renderBacking, levelGain, mixRowStems, renderParallel, renderSoftRows, isArranged};
});
