(function () {
  'use strict';
  const Strips = window.PixelMusicStrips, Music = window.PixelMusic, ImageAnalysis = window.PixelMusicImage;
  const Audio = window.PixelMusicAudio, Legato = window.PixelMusicLegato, Samples = window.PixelMusicStripSamples;
  const $ = id => document.getElementById(id);
  const E = Object.fromEntries(['workName','mappingLabel','picture','regions','centroids','scan','scanNote','dropHint','timeline',
    'eventCount','pitchTop','pitchBottom','middleTime','endTime','status','stripMode','oldMode','key','tempo','noteCount','duration',
    'mappingHint','tone','backing','backingStatus','play','playText','playIcon','currentNote','seek','clock','restart','abStrip','abOld',
    'comparisonHint','file','export','sample','credit','selectedTitle','selectedReason','selectedCentroid','selectedFeatures',
    'selectedPitch','selectedTime','toast','imageStage'].map(id => [id, $(id)]));
  const S = { mode: 'strip', playing: false, busy: false, loading: false, time: 0, selected: 0, clipEnd: null,
    operation: 0, loadOperation: 0, buffers: new Map(), source: null, output: null, preview: null, animation: 0 };
  const clock = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  const score = () => S.mode === 'strip' ? S.strip : S.old;
  const withBacking = value => E.backing.checked ? value : { ...value, bassEvents: [], padEvents: [] };
  const name = midi => midi === null || midi === undefined ? '休止' : Music.midiToName(midi);
  let toastTimer, resumeAfterSeek = false;

  function toast(message) {
    clearTimeout(toastTimer); E.toast.textContent = message; E.toast.hidden = false;
    toastTimer = setTimeout(() => { E.toast.hidden = true; }, 4200);
  }
  function controls() {
    const disabled = !S.strip || S.loading;
    E.play.disabled = disabled || S.busy;
    E.export.disabled = disabled || S.busy;
    E.abStrip.disabled = E.abOld.disabled = disabled || S.busy;
    E.restart.disabled = E.seek.disabled = disabled;
  }
  function currentTime() {
    return S.playing ? Math.min(S.limit, Math.max(S.startOffset, S.startOffset + S.context.currentTime - S.startedAt)) : S.time;
  }
  function silenceSource() {
    const source = S.source, output = S.output;
    S.source = S.output = null;
    if (!source) return;
    source.onended = null;
    const now = S.context.currentTime;
    output.gain.cancelScheduledValues(now); output.gain.setValueAtTime(output.gain.value, now);
    output.gain.linearRampToValueAtTime(0, now + .02);
    try { source.stop(now + .025); } catch (_) {}
    setTimeout(() => { source.disconnect(); output.disconnect(); }, 40);
  }
  function pause(reset = false) {
    S.time = reset ? 0 : currentTime(); S.operation++;
    S.playing = S.busy = false; cancelAnimationFrame(S.animation); silenceSource();
    S.preview?.stop(); S.preview = null;
    controls(); if (S.strip) paintPlayback();
  }
  async function context() {
    const Constructor = window.AudioContext || window.webkitAudioContext;
    if (!Constructor) throw new Error('当前浏览器不支持音频，请使用 Chrome 或 Safari。');
    if (!S.context || S.context.state === 'closed') S.context = new Constructor();
    if (S.context.state === 'suspended') await S.context.resume();
    return S.context;
  }
  function renderBuffer(value, mode, tone, backing) {
    const key = `${mode}:${value.scoreHash}:${tone}:${backing}`;
    if (!S.buffers.has(key)) {
      const selected = backing ? value : { ...value, bassEvents: [], padEvents: [] };
      const renderer = mode === 'old' ? Legato : Audio;
      const promise = renderer.renderOffline(selected, { tone, sampleRate: 22050 });
      S.buffers.set(key, promise);
      promise.catch(() => S.buffers.delete(key));
    }
    return S.buffers.get(key);
  }
  function rms(buffer, seconds = 12) {
    const data = buffer.getChannelData(0), from = Math.round(.05 * buffer.sampleRate);
    const count = Math.min(Math.round(seconds * buffer.sampleRate), data.length - from);
    let energy = 0; for (let i = 0; i < count; i++) energy += data[from + i] ** 2;
    return Math.sqrt(energy / Math.max(1, count));
  }
  function startBuffer(buffer, value, from, seconds, gain, operation) {
    const ctx = S.context, source = ctx.createBufferSource(), output = ctx.createGain();
    source.buffer = buffer; source.connect(output); output.connect(ctx.destination);
    const start = ctx.currentTime + .025, targetGain = .85 * gain;
    const length = Math.min(seconds || value.duration - from, value.duration - from);
    const fadeIn = Math.min(.015, length / 3);
    output.gain.setValueAtTime(0, start); output.gain.linearRampToValueAtTime(targetGain, start + fadeIn);
    output.gain.setValueAtTime(targetGain, start + Math.max(fadeIn, length - .03));
    output.gain.linearRampToValueAtTime(0, start + length);
    S.source = source; S.output = output; S.startOffset = from; S.startedAt = start; S.limit = from + length;
    S.playing = true; S.busy = false;
    source.onended = () => {
      if (S.operation !== operation || S.source !== source) return;
      S.time = S.limit; S.playing = false; cancelAnimationFrame(S.animation);
      source.disconnect(); output.disconnect(); S.source = S.output = null;
      controls(); paintPlayback();
    };
    source.start(start, from + .05, length);
    controls(); animate();
  }
  async function play({ from = S.time, compare = false } = {}) {
    pause();
    if (compare) S.clipEnd = 12;
    const comparisonMode = S.clipEnd !== null;
    const operation = ++S.operation, value = score(), mode = S.mode, tone = E.tone.value, backing = E.backing.checked;
    S.busy = true; controls(); E.status.textContent = compare ? '准备对照' : '准备声音';
    E.playText.textContent = '正在准备…';
    try {
      await context();
      let buffer, gain = 1;
      if (comparisonMode) {
        const [stripBuffer, oldBuffer] = await Promise.all([
          renderBuffer(S.strip, 'strip', tone, backing), renderBuffer(S.old, 'old', tone, backing),
        ]);
        if (operation !== S.operation) return;
        const a = rms(stripBuffer), b = rms(oldBuffer), target = Math.min(a, b), canMatch = target > 1e-7;
        const gains = canMatch ? { strip: target / a, old: target / b } : { strip: 1, old: 1 };
        buffer = mode === 'strip' ? stripBuffer : oldBuffer; gain = gains[mode];
        S.comparison = { rms: { strip: a, old: b }, gains, matched: canMatch, tone, backing };
        E.comparisonHint.textContent = canMatch ? '前 12 秒响度已匹配；保留两版各自速度。' : '一版为静音，无法匹配响度；保留实际声音供比较。';
      } else buffer = await renderBuffer(value, mode, tone, backing);
      if (operation !== S.operation) return;
      from = compare || from >= (S.clipEnd ?? value.duration) - .02 ? 0 : Math.max(0, from);
      startBuffer(buffer, value, from, comparisonMode ? S.clipEnd - from : 0, gain, operation);
    } catch (error) {
      if (operation === S.operation) { S.busy = false; controls(); paintPlayback(); toast(error.message); }
    }
  }
  function switchMode(mode) {
    pause(true); S.mode = mode; S.selected = 0; S.clipEnd = null; render();
  }
  function regionRefs(event) {
    if (!event) return [];
    if (S.mode === 'strip') return event.sourceRefs.map(ref => ({ id: ref.stripId, rect: ref.rect }));
    const ids = new Set(event.regionIds);
    return S.old.regionMap.filter(ref => ids.has(ref.regionId)).map(ref => ({ id: ref.regionId,
      rect: { x: ref.col / 24, y: ref.row / 5, width: 1 / 24, height: 1 / 5 } }));
  }
  function position(seconds) {
    const value = score();
    if (S.mode === 'strip') return Strips.position(withBacking(value), seconds);
    const old = Music.playbackPosition(value, seconds), beat = old.beat;
    const active = old.tail ? [] : value.performanceEvents.filter(e => beat >= e.beat && beat < e.beat + e.durationBeats);
    return { ...old, active, activeStripIds: active.flatMap(e => regionRefs(e).map(ref => ref.id)),
      accompaniment: E.backing.checked ? [...value.bassEvents, ...value.padEvents].filter(e => beat >= e.beat && beat < e.beat + e.durationBeats) : [] };
  }
  function paintPlayback() {
    const value = score(), seconds = currentTime(), p = position(seconds), end = S.clipEnd ?? value.duration;
    E.seek.max = end; E.seek.value = seconds; E.clock.textContent = `${clock(seconds)} / ${clock(end)}`;
    const current = p.active[0];
    const showCurrent = S.playing || seconds > 0;
    E.currentNote.textContent = !showCurrent ? '—' : p.tail ? '余韵' : current ? name(current.midi) : '留白';
    E.playIcon.textContent = S.playing ? 'Ⅱ' : '▶';
    E.playText.textContent = S.playing ? '暂停演奏' : seconds >= end - .02 ? S.clipEnd ? '再听片段' : '再次演奏' : seconds > 0 ? '继续演奏' : '开始演奏';
    E.status.textContent = S.loading ? '载入图片' : S.busy ? '准备声音' : S.playing ? (p.tail ? '渐渐收尾' : current ? '正在演奏' : '主旋律留白') : seconds >= end - .02 ? S.clipEnd ? '对照结束' : '演奏结束' : seconds > 0 ? '已暂停' : '可以演奏';
    E.status.classList.toggle('playing', S.playing);
    E.scan.hidden = !S.playing && seconds === 0;
    E.scan.style.left = `${Math.min(99.7, p.scanFraction * 100)}%`;
    E.scan.classList.toggle('end', p.scanFraction > .9);
    E.scanNote.textContent = p.tail ? '余韵' : current ? name(current.midi) : '留白';
    const activeIds = new Set(showCurrent ? p.activeStripIds : []);
    E.regions.querySelectorAll('button').forEach(el => el.classList.toggle('active', activeIds.has(el.dataset.region)));
    E.timeline.querySelectorAll('.note').forEach(el => el.classList.toggle('active', showCurrent && p.active.some(e => e.id === el.dataset.event)));
    E.timeline.querySelector('.playhead')?.setAttribute('x1', Math.min(640, p.beat / value.totalBeats * 640));
    E.timeline.querySelector('.playhead')?.setAttribute('x2', Math.min(640, p.beat / value.totalBeats * 640));
    E.backingStatus.textContent = !E.backing.checked ? '伴奏已关闭 · 仅听主旋律' : p.accompaniment.length && S.playing ? '整体伴奏演奏中 · 全图特征＋和声规则' : !value.bassEvents.length && !value.padEvents.length ? '这张图未生成伴奏' : '整体伴奏 · 全图特征＋和声规则';
  }
  function animate() {
    if (!S.playing) return;
    paintPlayback(); S.animation = requestAnimationFrame(animate);
  }
  function render() {
    if (!S.strip) return;
    const value = score(), isStrip = S.mode === 'strip';
    E.workName.textContent = S.name;
    E.mappingLabel.textContent = isStrip ? '条带声化 · 32 条带' : '现有连绵 · 120 区域';
    E.stripMode.setAttribute('aria-pressed', isStrip); E.oldMode.setAttribute('aria-pressed', !isStrip);
    E.key.textContent = `${name(60 + value.root).replace(/\d$/, '')} · ${value.mode.name}`;
    E.tempo.textContent = `${value.bpm} BPM`;
    E.noteCount.textContent = isStrip ? `${value.melody.length} 个音符` : `${value.performanceEvents.length} 个音高目标`;
    E.duration.textContent = `${value.melodyDuration.toFixed(1)} 秒＋余韵`;
    E.mappingHint.textContent = isStrip ? S.analysis.brightness < Strips.RULES.darkThreshold ? '图片过暗，主旋律保留休止；可以换一张明亮的图。' : '亮部重心决定音高；同音合并，暗区留白。伴奏来自全图特征。' : '现有 0.6.4 连绵演奏：像素颜色决定主音，升降时平滑滑接。';
    E.regions.classList.toggle('old', !isStrip);
    E.regions.innerHTML = isStrip ? value.strips.map(strip => `<button type="button" class="region ${strip.midi === null ? 'rest' : ''}" data-index="${strip.index}" data-region="${strip.id}" aria-label="第 ${strip.index + 1} 条带，${name(strip.midi)}" title="条带 ${strip.index + 1} · ${name(strip.midi)}"></button>`).join('') : value.regionMap.map((ref, index) => `<button type="button" class="region" data-index="${index}" data-region="${ref.regionId}" style="grid-column:${ref.col + 1};grid-row:${ref.row + 1}" aria-label="第 ${ref.col + 1} 列第 ${ref.row + 1} 区域，${name(ref.previewRef.midi)}"></button>`).join('');
    const observed = isStrip ? value.strips.filter(s => s.centroid !== null) : [];
    const path = observed.map((s, i) => `${i && observed[i - 1].index === s.index - 1 ? 'L' : 'M'}${(s.index + .5) * 6},${s.centroid * 120}`).join(' ');
    E.centroids.innerHTML = (observed.length ? `<path d="${path}" fill="none" stroke="#d7ff48" stroke-width=".4" opacity=".6"/>` : '') + observed.map(s => `<circle data-index="${s.index}" cx="${(s.index + .5) * 6}" cy="${s.centroid * 120}" r=".9"/>`).join('');
    const events = value.performanceEvents, lo = isStrip ? 48 : Math.min(46, ...events.map(e => e.midi)), hi = isStrip ? 72 : Math.max(79, ...events.map(e => e.midi));
    E.pitchTop.textContent = name(hi); E.pitchBottom.textContent = name(lo);
    let timeline = '';
    for (let i = 0; i <= value.totalBeats; i += 4) timeline += `<line class="grid" x1="${i / value.totalBeats * 640}" x2="${i / value.totalBeats * 640}" y1="0" y2="130"/>`;
    for (const rest of isStrip ? value.rests : []) timeline += `<rect class="rest" x="${rest.beat / value.totalBeats * 640}" y="0" width="${rest.beats / value.totalBeats * 640}" height="130"/>`;
    events.forEach((event, index) => { timeline += `<rect class="note" data-event="${event.id}" data-event-index="${index}" x="${event.beat / value.totalBeats * 640}" y="${6 + (hi - event.midi) / (hi - lo) * 112}" width="${Math.max(1, event.durationBeats / value.totalBeats * 640)}" height="5" rx="1"><title>${name(event.midi)} · ${Music.beatToTime(value,event.beat).toFixed(1)} 秒</title></rect>`; });
    E.timeline.innerHTML = timeline + '<line class="playhead" x1="0" x2="0" y1="0" y2="130"/>';
    E.eventCount.textContent = isStrip ? `${events.length} 个实际音符 · ${value.rests.length} 条带休止` : '连绵音高目标 · 不同于重新敲击';
    E.middleTime.textContent = `${(value.melodyDuration / 2).toFixed(1)} 秒`; E.endTime.textContent = `${value.melodyDuration.toFixed(1)} 秒`;
    E.seek.max = value.duration;
    selectRegion(S.selected); controls(); paintPlayback();
  }
  function selectRegion(index) {
    S.selected = index;
    E.regions.querySelectorAll('button').forEach(el => el.classList.toggle('selected', Number(el.dataset.index) === index));
    E.centroids.querySelectorAll('circle').forEach(el => el.classList.toggle('selected', Number(el.dataset.index) === index));
    const value = score();
    if (S.mode === 'strip') {
      const strip = value.strips[index], event = value.melody.find(e => e.id === strip.eventId);
      E.selectedTitle.textContent = `条带 ${index + 1} / 32 · ${name(strip.midi)}`;
      E.selectedReason.textContent = `${strip.reason}${event?.sourceRefs.length > 1 ? `；与 ${event.sourceRefs.length} 个条带合并为同一个音符。` : '。'}`;
      E.selectedCentroid.textContent = strip.centroid === null ? '无可靠亮部' : `距顶部 ${(strip.centroid * 100).toFixed(1)}%`;
      E.selectedFeatures.textContent = `${strip.brightness.toFixed(3)} / ${strip.contrast.toFixed(3)}`;
      E.selectedPitch.textContent = `${name(strip.targetMidi)} → ${name(strip.midi)}`;
      E.selectedTime.textContent = event ? `${event.startTime.toFixed(2)}–${(event.startTime + event.duration).toFixed(2)} 秒` : `${(strip.beat * value.secondsPerBeat).toFixed(2)}–${((strip.beat + 1) * value.secondsPerBeat).toFixed(2)} 秒 · 休止`;
      E.timeline.querySelectorAll('.note').forEach(el => el.classList.toggle('selected', el.dataset.event === strip.eventId));
    } else {
      const region = value.regionMap[index], note = value.columns[region.col].notes[region.row];
      E.selectedTitle.textContent = `列 ${region.col + 1} · 区域 ${region.row + 1} · ${name(region.previewRef.midi)}`;
      E.selectedReason.textContent = '试听原像素主音；连绵演奏中的中转音由奏法规则生成。';
      E.selectedCentroid.textContent = '颜色映射'; E.selectedFeatures.textContent = `${note.light.toFixed(3)} / ${note.density.toFixed(3)}（纹理）`;
      E.selectedPitch.textContent = name(region.previewRef.midi);
      E.selectedTime.textContent = `${Music.beatToTime(value,region.startBeat).toFixed(2)}–${Music.beatToTime(value,region.endBeat).toFixed(2)} 秒 · 区域读取`;
    }
  }
  async function preview(index, midiOverride = null) {
    pause(); selectRegion(index);
    const operation = S.operation, value = score();
    const event = S.mode === 'strip' ? value.melody.find(e => e.id === value.strips[index].eventId) : value.regionMap[index].previewRef;
    if (!event) return toast('这个条带亮度不足，整曲中也是休止。');
    try {
      const ctx = await context(); if (operation !== S.operation) return;
      S.preview = Audio.createSession(ctx, { bpm: value.bpm, volume: .85 });
      S.preview.voice(midiOverride ?? event.midi, ctx.currentTime + .02, .65, event.velocity, E.tone.value, 'melody', .008, null, { pluck: true, fullDuration: .65 });
      const session = S.preview; setTimeout(() => { session.dispose(); if (S.preview === session) S.preview = null; }, 1000);
    } catch (error) { toast(error.message); }
  }
  function loadSource(source, label, sampleId) {
    const raw = ImageAnalysis.normalizeSource(source), canonical = document.createElement('canvas');
    canonical.width = 192; canonical.height = 120;
    const ctx = canonical.getContext('2d', { willReadFrequently: true }); ctx.fillStyle = '#000'; ctx.fillRect(0,0,192,120); ctx.drawImage(raw,0,0);
    const pixels = ctx.getImageData(0,0,192,120).data;
    S.analysis = Strips.analyze(pixels); S.strip = Strips.compose(S.analysis);
    S.old = Legato.apply(Music.compose(ImageAnalysis.analyzePixels(pixels)));
    S.pixels = pixels; S.name = label; S.sampleId = sampleId; S.buffers.clear(); S.comparison = null;
    S.time = S.selected = 0; S.clipEnd = null;
    E.picture.getContext('2d').drawImage(canonical,0,0);
    E.comparisonHint.textContent = '同图、同音色，匹配响度；保留各自速度。';
    E.credit.innerHTML = sampleId === 'sunset' ? '样本：NASA / JPL / Texas A&M / Cornell · <a href="https://science.nasa.gov/resource/sunset-at-mars-gusev-crater-spirit/" target="_blank" rel="noreferrer">火星日落来源</a>' : sampleId === 'grass' ? '样本：DeviantArt / scikit-image · CC0 · <a href="https://scikit-image.org/docs/0.25.x/api/skimage.data.html#skimage.data.grass" target="_blank" rel="noreferrer">草地来源</a>' : sampleId ? '几何验收样本 · 与上传图片使用相同生成规则' : '你的图片 · 居中裁切为分析画面；透明区域以黑色铺底';
    S.loading = false; render();
  }
  async function loadSample(id) {
    pause(true); const operation = ++S.loadOperation; S.loading = true; controls(); E.status.textContent = '载入图片';
    try {
      const entry = Samples.entries.find(e => e.id === id);
      if (entry.path) {
        const image = await new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('样本图片未能读取，请试试几何样本或上传图片。')); image.src = location.protocol === 'file:' ? window.PixelMusicStripPhotoData[id] : entry.path; });
        if (operation !== S.loadOperation) return; loadSource(image, entry.name.replace('照片 · ',''), id);
      } else loadSource(Samples.canvas(id), entry.name.replace('验收 · ',''), id);
    } catch (error) { if (operation === S.loadOperation) { S.loading = false; controls(); toast(error.message); } }
  }
  async function loadFile(file) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return toast('请选择 JPG、PNG 或 WEBP 图片。');
    if (file.size > 12 * 1024 * 1024) return toast('图片请小于 12MB。');
    pause(true); const operation = ++S.loadOperation, url = URL.createObjectURL(file); S.loading = true; controls();
    try {
      const image = await new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('图片未能解码，请换一张。')); image.src = url; });
      if (operation !== S.loadOperation) return;
      loadSource(image, file.name, null); E.sample.selectedIndex = -1;
    } catch (error) { if (operation === S.loadOperation) { S.loading = false; controls(); toast(error.message); } }
    finally { URL.revokeObjectURL(url); E.file.value = ''; }
  }
  async function exportWav() {
    pause(); const operation = ++S.operation, value = score(), mode = S.mode; S.busy = true; controls(); E.status.textContent = '准备 WAV';
    try {
      await context(); const buffer = await renderBuffer(value, mode, E.tone.value, E.backing.checked);
      if (operation !== S.operation) return;
      const metrics = Audio.inspectBuffer(buffer);
      if (metrics.invalid || metrics.clipped) throw new Error('音频检查未通过，暂时无法保存。');
      const bytes = Audio.wavBytes(buffer), url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
      const link = document.createElement('a'); link.href = url; link.download = `图鸣-${mode === 'strip' ? '条带声化' : '像素连绵'}-${E.tone.value}.wav`;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast('WAV 已准备并交给浏览器保存。');
    } catch (error) { if (operation === S.operation) toast(error.message); }
    finally { if (operation === S.operation) { S.busy = false; controls(); paintPlayback(); } }
  }

  E.play.addEventListener('click', () => S.playing ? pause() : play());
  E.restart.addEventListener('click', () => { pause(true); play({ from: 0 }); });
  E.stripMode.addEventListener('click', () => switchMode('strip')); E.oldMode.addEventListener('click', () => switchMode('old'));
  E.abStrip.addEventListener('click', () => { switchMode('strip'); play({ compare: true }); });
  E.abOld.addEventListener('click', () => { switchMode('old'); play({ compare: true }); });
  for (const el of [E.tone, E.backing]) el.addEventListener('change', () => {
    const wasPlaying = S.playing, time = currentTime(); pause(); S.time = time;
    S.comparison = null; E.comparisonHint.textContent = '同图、同音色，匹配响度；保留各自速度。';
    if (wasPlaying) play({ from: time }); else paintPlayback();
  });
  E.seek.addEventListener('pointerdown', () => { resumeAfterSeek = S.playing; pause(); });
  E.seek.addEventListener('input', () => {
    const next = Number(E.seek.value); if (S.playing) resumeAfterSeek = true;
    pause(); S.time = next; paintPlayback();
  });
  E.seek.addEventListener('change', () => { if (resumeAfterSeek) play({ from: S.time }); resumeAfterSeek = false; });
  E.regions.addEventListener('click', event => { const button = event.target.closest('button'); if (button) preview(Number(button.dataset.index)); });
  E.timeline.addEventListener('click', event => {
    const rect = event.target.closest('[data-event-index]'); if (!rect) return;
    const note = score().performanceEvents[Number(rect.dataset.eventIndex)], refs = regionRefs(note);
    const index = S.mode === 'strip' ? score().strips.findIndex(s => s.id === refs[0]?.id) : score().regionMap.findIndex(s => s.regionId === refs[0]?.id);
    if (index >= 0) preview(index, note.midi);
  });
  E.sample.innerHTML = Samples.entries.map(e => `<option value="${e.id}">${e.name}</option>`).join('');
  E.sample.addEventListener('change', () => loadSample(E.sample.value)); E.file.addEventListener('change', () => loadFile(E.file.files[0]));
  for (const type of ['dragenter','dragover']) E.imageStage.addEventListener(type, event => { event.preventDefault(); E.dropHint.hidden = false; });
  E.imageStage.addEventListener('dragleave', event => { if (!E.imageStage.contains(event.relatedTarget)) E.dropHint.hidden = true; });
  E.imageStage.addEventListener('drop', event => { event.preventDefault(); E.dropHint.hidden = true; loadFile(event.dataTransfer.files[0]); });
  E.export.addEventListener('click', exportWav);
  window.addEventListener('pagehide', () => { pause(); S.context?.close(); });
  window.PixelMusicStripDemo = { snapshot: () => ({ mode: S.mode, sample: S.sampleId, playing: S.playing, busy: S.busy,
    time: currentTime(), bpm: score()?.bpm, name: S.name, comparison: S.comparison,
    activeIds: S.strip ? position(currentTime()).activeStripIds : [], currentMidi: S.strip ? position(currentTime()).active[0]?.midi ?? null : null }),
    scores: () => ({ strip: S.strip, old: S.old }), pixels: () => Array.from(S.pixels || []) };
  loadSample('sunset');
})();
