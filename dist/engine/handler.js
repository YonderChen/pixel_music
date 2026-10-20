/* browser_engine.py: the local /api routes the page calls, answered inside the Worker.
 * A route returns {data} (JSON) or {bytes, metrics} (a WAV file). */
(self.PixelMusicEngineModules = self.PixelMusicEngineModules || []).push(function (PM) {
  'use strict';
  const R = PM.render;
  const ENTRIES = new Map();

  function ensureAudio(cached, variant) {
    if (cached.waves[variant]) return [cached.waves[variant], cached.audioMetrics[variant]];
    const {payload, context} = cached;
    let wav, metrics;
    if (variant === 'parallel' || variant === 'parallel-soft') {
      if (context.backing && !cached.background) cached.background = R.renderBacking(context);
      if (variant === 'parallel-soft') {
        const result = R.renderSoftRows(context, cached.background);
        ({wav, metrics} = result);
        if (!cached.mixer) cached.mixer = result.storage;
        else Object.assign(cached.mixer.profiles, result.storage.profiles);
        Object.assign(payload.variants.parallel.mixProfiles.soft, result.metadata, {metrics});
      } else {
        const result = R.renderParallel(context.rowEvents, context.reference, context.info, context.voices, context.backing, cached.background);
        ({wav, metrics} = result);
        if (cached.mixer) Object.assign(result.storage.profiles, cached.mixer.profiles);
        cached.mixer = result.storage;
      }
    } else if (variant === 'reference' || variant === 'features') {
      ({wav, metrics} = R.renderScore(payload.variants[variant].events, context.info));
    } else throw new Error('未知音频版本');
    cached.waves[variant] = wav; cached.audioMetrics[variant] = metrics;
    return [wav, metrics];
  }

  function entry(key) {
    if (!ENTRIES.has(key)) throw new Error('乐谱已更新，请重新生成当前图片。');
    return ENTRIES.get(key);
  }
  const wave = (bytes, metrics = {}) => ({bytes, metrics});
  const newEntry = (payload, context) => ({payload, context, waves: {}, audioMetrics: {}, mixer: null, background: null, hoverBanks: {}});

  function mixRows(cached, rows, background, profile) {
    const {wav, metrics} = R.mixRowStems(cached.mixer, rows, background, profile);
    return wave(wav, metrics);
  }

  // The image file as the former engine decoded it (JPEG and PNG); other formats, or files
  // these decoders do not support, are decoded by the page and sent as pixels instead.
  async function decodeFile(bytes) {
    try {
      if (PM.png.isPng(bytes)) return await PM.png.decode(bytes);
      if (bytes[0] === 0xff && bytes[1] === 0xd8) return PM.jpeg.decode(bytes);
    } catch (error) {
      if (!(error instanceof PM.jpeg.Unsupported)) throw error;
    }
    return null;
  }

  // data.file is the image file (or data.pixels / width / height when the page decoded it);
  // data.key identifies image and options.
  async function generate(data) {
    const options = data.options || {}, key = data.key;
    const image = data.file ? await decodeFile(data.file) : data;
    if (!image) return {needsPixels: true};
    const {payload, context, rgb} = PM.scores.prepareScores(image.pixels, image.width, image.height, options);
    payload.key = key;
    payload.browserEngine = true;
    for (const [name, variant] of Object.entries(payload.variants)) variant.audioUrl = `/api/audio/${key}/${name}.wav`;
    for (const [profile, meta] of Object.entries(payload.variants.parallel.mixProfiles))
      meta.audioUrl = `/api/audio/${key}/parallel${profile === 'soft' ? '-soft' : ''}.wav`;
    ENTRIES.clear();
    ENTRIES.set(key, newEntry(payload, context));
    // The preview image (analysis size) goes back as RGB bytes; the page encodes the PNG.
    const preview = Uint8Array.from(rgb, v => PM.np.clip(PM.np.round(v * 255), 0, 255));
    return {data: payload, preview: {bytes: preview, width: payload.image.width, height: payload.image.height}};
  }

  function performance(ref) {
    const records = ref.events;
    if (records.length > 5000 || !(ref.info.duration > 0 && ref.info.duration <= 180)) throw new Error('乐谱超过本轮范围。');
    for (const r of records) if (!(r.start >= 0 && r.start <= 180 && r.duration > 0 && r.duration <= 180 && r.midi >= 0 && r.midi <= 127)) throw new Error('乐谱音符无效。');
    const context = {info: ref.info, synth: ref.synth, rowEvents: records.filter(e => e.layer === 'main'), reference: records, voices: ref.voices,
      backing: ref.backing, fixedMidi: PM.scores.fixedMidi(ref.voices)};
    const cached = newEntry({variants: {reference: {events: records}, parallel: {mixProfiles: {soft: {}}}}}, context);
    if (ref.variant === 'reference') return wave(...ensureAudio(cached, 'reference'));
    ensureAudio(cached, ref.profile === 'soft' ? 'parallel-soft' : 'parallel');
    return mixRows(cached, ref.rows, ref.background, ref.profile);
  }

  // Answers a route; /api/generate is asynchronous (PNG inflating), so callers await the result.
  function handle(path, data) {
    data = data || {};
    if (path === '/api/health') return {data: {engine: 'pixelmusic-browser-v1', offline: true}};
    if (path === '/api/performance') return performance(data);
    if (path === '/api/generate') return generate(data);
    if (path.startsWith('/api/audio/')) {
      const parts = path.split('/');
      return wave(...ensureAudio(entry(parts[3]), parts[4].replace(/\.wav$/, '')));
    }
    if (path === '/api/rowmix') {
      const cached = entry(data.key), profile = data.profile || 'original';
      ensureAudio(cached, profile === 'soft' ? 'parallel-soft' : 'parallel');
      return mixRows(cached, data.rows, data.background, profile);
    }
    if (path === '/api/hover-bank') {
      const cached = entry(data.key), variant = data.variant, profile = variant === 'parallel' ? data.profile : 'original', key = variant + '-' + profile;
      if (!cached.hoverBanks[key]) {
        const [wav, meta] = PM.hover.build(cached.payload.variants[variant], cached.context.info, profile);
        meta.audioUrl = `/api/hover-audio/${data.key}/${key}.wav`;
        cached.hoverBanks[key] = [wav, meta];
      }
      return {data: cached.hoverBanks[key][1]};
    }
    if (path.startsWith('/api/hover-audio/')) {
      const parts = path.split('/'), bank = entry(parts[3]).hoverBanks[parts[4].replace(/\.wav$/, '')];
      if (!bank) throw new Error('移动试听音色尚未准备。');
      return wave(bank[0]);
    }
    if (path === '/api/preview') {
      const cached = entry(data.key), variant = cached.payload.variants[data.variant];
      const record = variant.events.find(e => e.id === data.eventId);
      if (!record) throw new Error('找不到这个音符。');
      let samples;
      if (data.variant === 'parallel' && data.profile === 'soft') samples = PM.softMixer.preview(record, variant.rows);
      else {
        const event = {start: 0, duration: Math.min(.65, record.duration), midi: record.midi, velocity: record.velocity, instrument: record.instrument, pan: record.pan, layer: 'main'};
        samples = PM.synth.renderBackend([event], {...cached.context.info, duration: .7});
      }
      return wave(PM.synth.wavBytes(samples));
    }
    throw new Error('未知浏览器计算操作');
  }

  PM.handler = {handle, decodeFile, entries: ENTRIES};
});
