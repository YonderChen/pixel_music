/* hover_preview.py: one compact note atlas per view, so pointer movement never renders audio. */
(self.PixelMusicEngineModules = self.PixelMusicEngineModules || []).push(function (PM) {
  'use strict';
  const {np} = PM, S = PM.synth, SR = S.SR;
  const VERSION = 'hover-note-atlas-v1', GATE = .3125, CLIP = 1, STRIDE = 1.5, LEAD = .0625, VELOCITY = .65;

  const compareKeys = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]);

  function build(variant, info, profile) {
    const soft = profile === 'soft';
    const records = variant.events.filter(e => e.layer === 'main' && e.instrument !== 'none');
    const keyOf = e => (soft ? [Math.trunc(e.row ?? 0), e.midi] : [e.instrument, e.midi]);
    const representatives = new Map();
    for (const e of records) representatives.set(JSON.stringify(keyOf(e)), e);
    const keys = [...representatives.keys()].map(k => JSON.parse(k)).sort(compareKeys);
    if (keys.length > 128) throw new Error('移动试听音色过多，请减少分行或更换图片。');
    const frameCount = np.round(CLIP * SR), samples = new Float64Array(Math.max(1, keys.length) * frameCount * 2), pieces = new Map();
    if (soft) {
      for (const key of keys) {
        const record = {...representatives.get(JSON.stringify(key)), duration: GATE, velocity: VELOCITY};
        pieces.set(JSON.stringify(key), PM.softMixer.preview(record, variant.rows).slice(0, frameCount * 2));
      }
    } else {
      // One render per instrument, rather than one per tile.
      for (const instrument of [...new Set(keys.map(k => k[0]))].sort()) {
        const group = keys.filter(k => k[0] === instrument);
        const notes = group.map((k, i) => ({start: i * STRIDE + LEAD, duration: GATE, midi: k[1], velocity: VELOCITY, instrument, pan: 0, layer: 'main'}));
        const rendered = S.renderBackend(notes, {...info, duration: group.length * STRIDE, tempo: 8});
        group.forEach((k, i) => {
          const start = np.round((i * STRIDE + LEAD) * SR);
          pieces.set(JSON.stringify(k), rendered.slice(start * 2, (start + frameCount) * 2));
        });
      }
    }
    keys.forEach((key, i) => {
      const piece = S.normalizeMaster(pieces.get(JSON.stringify(key)), .55, .12), frames = piece.length / 2;
      // Cached clips end smoothly; the client fades the previous clip on movement.
      const attack = np.round(.003 * SR), release = np.round(.025 * SR);
      const up = np.linspace(0, 1, attack), down = np.linspace(1, 0, release);
      for (let f = 0; f < attack; f++) { piece[2 * f] *= up[f]; piece[2 * f + 1] *= up[f]; }
      for (let k = 0; k < release; k++) { const f = frames - release + k; piece[2 * f] *= down[k]; piece[2 * f + 1] *= down[k]; }
      samples.set(piece, i * frameCount * 2);
    });
    const lookup = new Map(keys.map((key, i) => [JSON.stringify(key), i]));
    const events = {};
    for (const e of records) {
      const ratio = np.clip(e.velocity / VELOCITY, 0, 1.5);
      events[e.id] = {tone: lookup.get(JSON.stringify(keyOf(e))), gain: soft ? Math.sqrt(ratio) : ratio};
    }
    const metadata = {version: VERSION, profile, toneCount: keys.length, gateSeconds: GATE,
      tones: keys.map((_, i) => ({offset: i * frameCount / SR, duration: frameCount / SR})), events};
    return [S.wavBytes(samples), metadata];
  }

  PM.hover = {VERSION, build};
});
