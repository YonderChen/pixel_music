/* Image mood (this project's own rule, not part of the upstream engine): valence (gloomy to
 * pleasant) and arousal (calm to energetic) from the whole-image features, after the
 * colour-emotion findings of Valdez & Mehrabian (1994): brightness and saturation raise
 * pleasure, saturation, contrast and detail raise arousal. The page always asks for it, and the mood
 * chooses the scale, tempo, note density, instruments and dynamics; without options.emotion (the
 * parity tests) nothing here runs. */
(self.PixelMusicEngineModules = self.PixelMusicEngineModules || []).push(function (PM) {
  'use strict';
  const {np} = PM;
  const VERSION = 'image-mood-v1', LOW = .42, HIGH = .58;

  // Each term is weight * (feature - typical value); its sign says which way it pushes.
  const VALENCE = [
    {key: 'mean_brightness', weight: 1.3, centre: .45, up: '画面明亮', down: '画面偏暗'},
    {key: 'mean_saturation', weight: .55, centre: .3, up: '色彩饱和', down: '色彩淡'},
    {key: 'warmth', weight: .5, centre: .03, up: '色调偏暖', down: '色调偏冷'},
    {key: 'shadow_proportion', weight: -.7, centre: .12, up: '阴影多', down: '阴影少'}];
  const AROUSAL = [
    {key: 'contrast', weight: 1.6, centre: .17, up: '明暗对比强', down: '明暗对比柔和'},
    {key: 'high_frequency_energy', weight: .9, centre: .2, up: '细节丰富', down: '画面平滑'},
    {key: 'mean_saturation', weight: .5, centre: .3, up: '色彩浓烈', down: '色彩素淡'},
    {key: 'texture_entropy', weight: .6, centre: .62, up: '纹理繁密', down: '纹理稀疏'},
    {key: 'warmth', weight: .25, centre: .03, up: '暖色跳跃', down: '冷色沉静'}];

  /* [valence band][arousal band], low to high. scale: the six engine scales; instruments:
   * main, texture, bass, pad, chord for the Simple synthesizer; ensemble: arranged version. */
  const MOODS = [
    [{id: 'melancholy', name: '忧郁', scale: 'Natural minor', ensemble: 'night-strings',
      instruments: ['soft_piano', 'music_box', 'cello', 'warm_pad', 'harp']},
     {id: 'wistful', name: '惆怅', scale: 'Minor pentatonic', ensemble: 'night-strings',
      instruments: ['harp', 'celesta', 'cello', 'warm_pad', 'soft_piano']},
     {id: 'tense', name: '紧张', scale: 'Natural minor', ensemble: 'night-strings',
      instruments: ['bowed_string', 'celesta', 'cello', 'warm_pad', 'soft_piano']}],
    [{id: 'still', name: '沉静', scale: 'Dorian', ensemble: 'cool-mist',
      instruments: ['soft_piano', 'celesta', 'soft_bass', 'glass_pad', 'harp']},
     {id: 'calm', name: '平和', scale: 'Major pentatonic', ensemble: 'warm-chamber',
      instruments: ['soft_piano', 'music_box', 'soft_bass', 'warm_pad', 'harp']},
     {id: 'lively', name: '动感', scale: 'Dorian', ensemble: 'wooden-steps',
      instruments: ['synth_pluck', 'kalimba', 'soft_bass', 'warm_pad', 'soft_piano']}],
    [{id: 'serene', name: '恬静', scale: 'Lydian', ensemble: 'cool-mist',
      instruments: ['harp', 'music_box', 'soft_bass', 'glass_pad', 'soft_piano']},
     {id: 'bright', name: '明朗', scale: 'Major pentatonic', ensemble: 'morning-piano',
      instruments: ['celesta', 'music_box', 'soft_bass', 'glass_pad', 'soft_piano']},
     {id: 'joyful', name: '欢快', scale: 'Major', ensemble: 'wooden-steps',
      instruments: ['marimba', 'bright_bell', 'soft_bass', 'glass_pad', 'harp']}]];
  const VALENCE_NAMES = ['低', '中', '高'], AROUSAL_NAMES = ['低', '中', '高'];
  const band = v => (v < LOW ? 0 : v < HIGH ? 1 : 2);

  function score(f, terms) {
    const parts = terms.map(t => ({...t, value: t.weight * ((f[t.key] ?? t.centre) - t.centre)}));
    // tanh keeps extreme images off the 0 and 1 ends without flattening the middle.
    const total = .5 + .5 * Math.tanh(2 * parts.reduce((a, p) => a + p.value, 0)), direction = total >= .5 ? 1 : -1;
    // The two terms that moved the score most in the direction it moved; up/down name the feature above/below typical.
    const reasons = parts.filter(p => p.value * direction > .015).sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 2)
      .map(p => (p.value > 0) === (p.weight > 0) ? p.up : p.down);
    return [total, reasons];
  }

  function estimate(f) {
    const [valence, valenceReasons] = score(f, VALENCE), [arousal, arousalReasons] = score(f, AROUSAL);
    const mood = MOODS[band(valence)][band(arousal)];
    // Tempo follows arousal (56 to 140 BPM), a little faster for pleasant images.
    const tempo = np.clip(Math.round(58 + 80 * arousal + 8 * (valence - .5)), 56, 140);
    return {version: VERSION, id: mood.id, name: mood.name, valence, arousal,
      valenceLevel: VALENCE_NAMES[band(valence)], arousalLevel: AROUSAL_NAMES[band(arousal)],
      valenceReasons, arousalReasons, scale: mood.scale, tempo, ensemble: mood.ensemble, instruments: mood.instruments.slice(),
      // Note density of the reference score; dynamics, timbre and attack of every voice.
      complexityShift: .5 * (arousal - .5), accent: .6 + .8 * arousal, textureGain: np.clip(.45 + 1.1 * arousal, .45, 1.15),
      toneScale: .82 + .36 * valence, attackScale: np.clip(1.45 - .9 * arousal, .55, 1.45)};
  }

  const complexity = (emotion, base) => np.clip(base + emotion.complexityShift, 0, 1);

  /* Dynamics and touch of the finished events, each object once (layers share objects):
   * velocity spread around each layer's mean grows with arousal, percussive texture fades for
   * calm images, and the soft mixer's timbre darkens and attack slows for gloomy, calm ones. */
  function shape(lists, emotion) {
    const events = [...new Set(lists.flat())], sums = {};
    for (const e of events) (sums[e.layer] = sums[e.layer] || [0, 0])[0] += e.velocity, sums[e.layer][1]++;
    for (const e of events) {
      const [total, n] = sums[e.layer], centre = total / n;
      let velocity = centre + (e.velocity - centre) * emotion.accent;
      if (e.layer === 'texture') velocity *= emotion.textureGain;
      e.velocity = np.clip(velocity, .02, 1);
      e.toneScale = (e.toneScale ?? 1) * emotion.toneScale;
      e.attackScale = (e.attackScale ?? 1) * emotion.attackScale;
    }
    return events.length;
  }

  // The summary the page shows.
  function describe(emotion) {
    const keys = ['version', 'id', 'name', 'valence', 'arousal', 'valenceLevel', 'arousalLevel', 'valenceReasons', 'arousalReasons',
      'scale', 'tempo', 'ensemble', 'instruments'];
    return Object.fromEntries(keys.map(k => [k, emotion[k]]));
  }

  PM.mood = {VERSION, MOODS, estimate, complexity, shape, describe};
});
