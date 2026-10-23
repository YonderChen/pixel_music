/* Portable score audition for the mini program. Uses the web audition's harmonic
 * families and envelopes, a Float32 stereo mix, and a bounded soft limiter instead
 * of the browser-only OfflineAudioContext / DynamicsCompressorNode. */
'use strict';
module.exports = function render(score, rate = 44100) {
  if (!score || !(score.duration > 0 && score.duration <= 180) || !Array.isArray(score.events) || score.events.length > 5000) throw new Error('支持 3 分钟、5000 个音符以内的乐谱');
  const frames = Math.ceil(score.duration * rate), mix = new Float32Array(frames * 2), voices = new Set(score.events.map(e => e.voice)).size;
  for (const e of score.events) {
    if (![e.start,e.duration,e.midi,e.velocity,e.pan].every(Number.isFinite) || e.start < 0 || e.duration <= 0 || e.midi < 0 || e.midi > 127) throw new Error('乐谱音符无效');
    const strings = /strings|pad|midi-(4[0-9]|5[0-5])/.test(e.instrument), bell = /bell|marimba|轻铃|圆木琴|midi-(8|9|10|11|12|13|14|15)/.test(e.instrument);
    const start = Math.round(e.start * rate), length = Math.min(frames - start, Math.ceil((e.duration + .3) * rate)), frequency = 440 * 2 ** ((e.midi - 69) / 12);
    const pan = Math.max(-1, Math.min(1, e.pan)), left = Math.cos((pan + 1) * Math.PI / 4), right = Math.sin((pan + 1) * Math.PI / 4);
    const peak = .22 * e.velocity / Math.sqrt(Math.max(1, voices)) * (e.layer === 'main' ? 1 : .6), attack = strings ? .06 : .012, sustain = strings ? .72 : bell ? .12 : .3;
    for (let i = 0; i < length; i++) {
      const t = i / rate, phase = 2 * Math.PI * frequency * t;
      const tone = bell ? Math.sin(phase) : (Math.sin(phase) + .24 * Math.sin(2 * phase) + .075 * Math.sin(3 * phase) + .025 * Math.sin(4 * phase)) / 1.34;
      const envelope = t < attack ? t / attack : t <= e.duration ? sustain + (1 - sustain) * Math.exp(-(t - attack) / (strings ? .5 : .23)) : (strings ? .65 : .24) * Math.max(0, 1 - (t - e.duration) / .3);
      const v = tone * peak * envelope, at = (start + i) * 2; mix[at] += v * left; mix[at + 1] += v * right;
    }
  }
  const buffer = new ArrayBuffer(44 + frames * 4), view = new DataView(buffer);
  const text = (at, value) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, frames * 4, true);
  for (let i = 0; i < mix.length; i++) view.setInt16(44 + i * 2, Math.round(Math.tanh(mix[i] * 1.5) * .86 * 32767), true);
  return new Uint8Array(buffer);
};
