(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./timing.js') : root.PixelMusicTiming);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PixelMusicAudio = api;
})(typeof globalThis === 'object' ? globalThis : this, function (Timing) {
  'use strict';
  const freq = midi => 440 * 2 ** ((midi - 69) / 12);
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  function createSession(context, { profile = 'expressive', bpm = 88, volume = 1 } = {}) {
    if (!['legacy', 'plain', 'expressive'].includes(profile)) throw new Error('未知演奏版本');
    const nodes = new Set(), sources = new Set();
    const make = method => { const node = context[method](); nodes.add(node); return node; };
    const output = make('createGain'), compressor = make('createDynamicsCompressor');
    output.gain.value = volume;
    compressor.threshold.value = profile === 'expressive' ? -16 : -18;
    compressor.ratio.value = profile === 'expressive' ? 2.2 : 3;
    compressor.knee.value = profile === 'expressive' ? 18 : 30;
    compressor.connect(output); output.connect(context.destination);
    const dry = make('createGain'), delay = context.createDelay(2), feedback = make('createGain'), damp = make('createBiquadFilter'), wet = make('createGain');
    nodes.add(delay); dry.connect(compressor);
    delay.delayTime.value = profile === 'expressive' ? 60 / bpm * .75 : .24;
    feedback.gain.value = profile === 'expressive' ? .16 : .18;
    wet.gain.value = profile === 'expressive' ? .65 : .14;
    damp.type = 'lowpass'; damp.frequency.value = 2100;
    delay.connect(damp); damp.connect(wet); wet.connect(compressor); damp.connect(feedback); feedback.connect(delay);
    let stopped = false;
    function voice(midi, start, duration, velocity, tone, role = 'melody', send = .055, legacyAttack = null) {
      if (stopped || duration <= 0) return;
      const gain = make('createGain'), filter = make('createBiquadFilter'), sendGain = make('createGain');
      const frequency = freq(midi), expressive = profile === 'expressive';
      const peak = Math.max(.001, velocity) * (expressive ? clamp((440 / frequency) ** .1, .84, 1.15) : 1);
      const attack = expressive ? Math.min(duration * .16, role === 'pad' ? .16 : tone === 'mist' ? .038 : .009) : Math.min(duration * .2, legacyAttack ?? (tone === 'mist' ? .18 : .025));
      filter.type = 'lowpass'; filter.frequency.setValueAtTime(expressive ? (tone === 'glass' ? 3600 : tone === 'warm' ? 2600 : 1400) : (tone === 'glass' ? 5200 : tone === 'warm' ? 1900 : 1100), start);
      gain.gain.setValueAtTime(.0001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + attack);
      if (expressive && role !== 'pad') gain.gain.exponentialRampToValueAtTime(peak * .72, start + Math.max(attack + .001, duration * .25));
      gain.gain.exponentialRampToValueAtTime(peak * (expressive ? role === 'pad' ? .7 : .42 : .68), start + duration * .7);
      gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
      gain.connect(filter); filter.connect(dry); filter.connect(sendGain); sendGain.connect(delay);
      sendGain.gain.value = expressive ? send : 1;
      const partials = !expressive ? (tone === 'glass' ? [['sine', 1, .72], ['triangle', 2, .2]] : tone === 'warm' ? [['triangle', 1, .72], ['sine', 1.003, .2]] : [['sawtooth', 1, .32], ['sine', 1.003, .2]])
        : tone === 'glass' ? [['sine', 1, .76], ['sine', 2, .12], ['sine', 3.99, .025]]
          : tone === 'warm' ? [['sine', 1, .75], ['triangle', 1, .15], ['sine', 2, .055]]
            : [['triangle', .999, .35], ['sine', 1.001, .52]];
      let live = partials.length;
      partials.forEach(([type, ratio, amount]) => {
        const osc = make('createOscillator'), mix = make('createGain');
        osc.type = type; osc.frequency.setValueAtTime(frequency * ratio, start); mix.gain.value = amount;
        osc.connect(mix); mix.connect(gain); sources.add(osc);
        osc.onended = () => {
          sources.delete(osc); osc.disconnect(); mix.disconnect(); nodes.delete(osc); nodes.delete(mix);
          if (--live === 0) { gain.disconnect(); filter.disconnect(); sendGain.disconnect(); nodes.delete(gain); nodes.delete(filter); nodes.delete(sendGain); }
        };
        osc.start(start); osc.stop(start + duration + .04);
      });
    }
    function schedule(score, start = context.currentTime + .08, tone = 'warm', fromBeat = 0) {
      const spb = score.secondsPerBeat, time = beat => Timing.beatToTime(score, beat);
      score.melody.forEach((note, index) => {
        const expressive = profile === 'expressive';
        const nominal = time(note.beat + note.beats) - time(note.beat);
        let endTime = expressive ? time(note.beat + note.durationBeats) : time(note.beat + note.beats) + Math.min(.16, nominal * .32);
        if (profile === 'plain') {
          const rest = score.rests.find(r => r.beat >= note.beat && time(r.beat) < endTime);
          if (rest) endTime = Math.min(endTime, time(rest.beat));
        }
        if (endTime <= time(fromBeat)) return;
        const onset = Math.max(note.beat, fromBeat);
        const duration = endTime - time(onset);
        const gain = expressive ? note.velocity : profile === 'legacy' ? (.09 + note.velocity * .65) * (note.strong ? 1 : .82) : .12 * (note.weight === 1 ? 1 : .82);
        voice(note.midi, start + time(onset), duration, gain, tone, 'melody', note.send, Math.min(.05, nominal * .12));
      });
      if (score.bassEvents && profile !== 'legacy') {
        for (const event of score.bassEvents) {
          const onset = Math.max(event.beat, fromBeat), duration = time(event.beat + event.durationBeats) - time(onset);
          voice(event.midi, start + time(onset), duration, event.velocity, 'warm', 'bass', event.send);
        }
        for (const event of score.padEvents) {
          const onset = Math.max(event.beat, fromBeat), duration = time(event.beat + event.durationBeats) - time(onset);
          event.midi.forEach((pitch, index) => voice(pitch, start + time(onset) + index * .012, duration - index * .012, event.velocity, 'mist', 'pad', event.send));
        }
      } else score.bars.forEach(bar => {
        if (bar.beat + 4.2 <= fromBeat) return;
        const offset = Math.max(0, fromBeat - bar.beat), t = start + (bar.beat + offset) * spb;
        if (profile === 'legacy') {
          voice(bar.bass, t, spb * (4.15 - offset), .035, 'warm', 'bass', 1, .08);
          bar.chord.forEach((pitch, index) => voice(48 + score.root + pitch, t + index * .025, spb * (4.2 - offset), .016, 'mist', 'pad', 1, .24));
          return;
        }
        const phraseGain = [.85, .92, 1, .8][bar.phrase];
        const length = bar.index === 15 ? 4 : bar.rest ? 3.35 : 3.9;
        voice(bar.bass, t, spb * (length - offset), .032 * phraseGain, 'warm', 'bass', .035);
        bar.voicing.forEach((pitch, index) => voice(pitch, t + index * .015, spb * (length - offset), .017 * phraseGain, 'mist', 'pad', bar.rest ? .035 : .13));
      });
      return { start, end: start + score.duration };
    }
    function stop() {
      if (stopped) return;
      stopped = true;
      // Release output first; scheduled future notes and delay feedback are also silenced.
      const now = context.currentTime;
      output.gain.cancelScheduledValues(now); output.gain.setValueAtTime(output.gain.value, now); output.gain.linearRampToValueAtTime(.0001, now + .025);
      sources.forEach(osc => { try { osc.stop(now + .03); } catch (_) {} });
      setTimeout(dispose, 50);
    }
    function dispose() {
      nodes.forEach(node => { try { node.disconnect(); } catch (_) {} }); nodes.clear(); sources.clear();
    }
    return { voice, schedule, stop, dispose, output, get sourceCount() { return sources.size; }, profile };
  }
  async function renderOffline(score, { profile = 'expressive', tone = 'warm', sampleRate = 22050, OfflineContext = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext, volume = 1 } = {}) {
    if (!OfflineContext) throw new Error('当前浏览器不支持离线音频渲染');
    const context = new OfflineContext(1, Math.ceil((score.duration + .1) * sampleRate), sampleRate);
    const session = createSession(context, { profile, bpm: score.bpm, volume });
    session.schedule(score, .05, tone);
    const buffer = await context.startRendering(); session.dispose();
    return buffer;
  }
  function inspectBuffer(buffer) {
    const samples = buffer.getChannelData(0), rate = buffer.sampleRate;
    let peak = 0, energy = 0, invalid = 0, clipped = 0, tailPeak = 0;
    samples.forEach((sample, i) => {
      if (!Number.isFinite(sample)) invalid++;
      const value = Math.abs(sample); peak = Math.max(peak, value); energy += sample * sample;
      if (value >= .98) clipped++;
      if (i > samples.length - rate * .1) tailPeak = Math.max(tailPeak, value);
    });
    return { peak, rms: Math.sqrt(energy / samples.length), invalid, clipped, tailPeak, seconds: samples.length / rate };
  }
  function wavBytes(buffer, gain = 1, seconds = buffer.duration) {
    const source = buffer.getChannelData(0), length = Math.min(source.length, Math.round(seconds * buffer.sampleRate));
    const bytes = new ArrayBuffer(44 + length * 2), view = new DataView(bytes);
    const write = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
    write(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); write(8, 'WAVE'); write(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, buffer.sampleRate, true);
    view.setUint32(28, buffer.sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, length * 2, true);
    for (let i = 0; i < length; i++) view.setInt16(44 + i * 2, Math.round(clamp(source[i] * gain, -1, 1) * 32767), true);
    return bytes;
  }
  return { createSession, renderOffline, inspectBuffer, wavBytes };
});
