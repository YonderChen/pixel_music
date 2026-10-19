(function () {
  'use strict';
  // The engine is plain JavaScript (dist/engine/*.js). Its modules are loaded as classic
  // scripts and serialized into a Blob Worker, which also works when opened via file://.
  const ENGINE_FILES = ['core.js', 'libm.js', 'fft.js', 'image.js', 'jpeg.js', 'png.js', 'analysis.js', 'composition.js', 'segmentation.js', 'arranger.js',
    'synth.js', 'soft-mixer.js', 'region-music.js', 'scores.js', 'render.js', 'hover.js', 'handler.js'];
  const root = new URL('./engine/', document.currentScript.src).href;
  const pending = new Map();
  let modules, worker, initializing, serial = 0;

  function loadModules() {
    if (!modules) modules = Promise.all(ENGINE_FILES.map(name => new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = root + name; script.async = false; // run in list order
      script.onload = resolve;
      script.onerror = () => {script.remove(); reject(new Error('运行资源读取失败，请保留完整静态文件夹后重试。'));};
      document.head.appendChild(script);
    }))).then(() => window.PixelMusicEngineModules.slice(), error => {modules = null; throw error;});
    return modules;
  }

  function workerMain() {
    const PM = {};
    for (const module of self.PixelMusicEngineModules) module(PM);
    let queue = Promise.resolve();
    self.onmessage = ({data: message}) => {
      queue = queue.then(async () => {
        try {
          const result = await PM.handler.handle(message.path, message.data);
          if (result.bytes) self.postMessage({id: message.id, bytes: result.bytes.buffer, metrics: result.metrics}, [result.bytes.buffer]);
          else self.postMessage({id: message.id, data: result.data, preview: result.preview, needsPixels: result.needsPixels}, result.preview ? [result.preview.bytes.buffer] : []);
        } catch (error) {self.postMessage({id: message.id, error: String(error && error.message || error)});}
      });
    };
  }

  function reset(reason = new DOMException('计算已取消', 'AbortError')) {
    worker?.terminate(); worker = null; initializing = null;
    for (const job of pending.values()) job.reject(reason);
    pending.clear();
  }
  async function initialize() {
    if (!initializing) initializing = (async () => {
      if (!window.Worker) throw new Error('当前浏览器不支持后台计算，请使用新版 Chrome、Edge 或 Safari。');
      const functions = await loadModules();
      const source = `self.PixelMusicEngineModules = [${functions.map(String).join(',\n')}];\n(${workerMain})();`;
      const url = URL.createObjectURL(new Blob([source], {type: 'text/javascript'}));
      worker = new Worker(url); URL.revokeObjectURL(url);
      worker.onmessage = ({data}) => {
        const job = pending.get(data.id); if (!job) return;
        pending.delete(data.id);
        if (data.error) job.reject(new Error(data.error.split('\n').filter(Boolean).at(-1)));
        else if (data.needsPixels) job.resolve(null);
        else if (data.bytes) job.resolve(new Response(data.bytes, {headers: {'Content-Type': 'audio/wav', 'X-Audio-Rms': String(data.metrics?.first12Rms ?? 0)}}));
        else {
          if (data.preview) data.data.image.src = previewUrl(data.preview);
          job.resolve(new Response(JSON.stringify(data.data), {headers: {'Content-Type': 'application/json'}}));
        }
      };
      worker.onerror = () => {reset(new Error('后台计算意外中断，请重新生成。'));};
    })().catch(error => {initializing = null; throw error;});
    await initializing;
  }

  function base64Bytes(base64) {
    const raw = atob(base64), bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }
  // Formats the engine does not decode itself (WebP, GIF, BMP, HEIC...): the browser's
  // pixels with EXIF orientation applied and no colour management.
  async function decodeImage(bytes) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(new Blob([bytes]), {imageOrientation: 'from-image', colorSpaceConversion: 'none', premultiplyAlpha: 'none'});
    } catch {throw new Error('无法读取这张图片，请换一张 JPG 或 PNG 图片。');}
    const {width, height} = bitmap, canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d', {willReadFrequently: true});
    ctx.drawImage(bitmap, 0, 0); bitmap.close?.();
    const rgba = ctx.getImageData(0, 0, width, height).data, pixels = new Uint8Array(width * height * 3);
    for (let i = 0, j = 0; j < rgba.length; i += 3, j += 4) { pixels[i] = rgba[j]; pixels[i + 1] = rgba[j + 1]; pixels[i + 2] = rgba[j + 2]; }
    return {pixels, width, height};
  }
  function previewUrl({bytes, width, height}) {
    const canvas = document.createElement('canvas'), rgba = new Uint8ClampedArray(width * height * 4);
    canvas.width = width; canvas.height = height;
    for (let i = 0, j = 0; j < rgba.length; i += 3, j += 4) { rgba[j] = bytes[i]; rgba[j + 1] = bytes[i + 1]; rgba[j + 2] = bytes[i + 2]; rgba[j + 3] = 255; }
    canvas.getContext('2d').putImageData(new ImageData(rgba, width, height), 0, 0);
    return canvas.toDataURL('image/png');
  }
  const sortedJson = value => JSON.stringify(value, (key, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));
  // The score key: SHA-256 of the image bytes and the options.
  async function scoreKey(bytes, options) {
    const text = new TextEncoder().encode(sortedJson(options)), all = new Uint8Array(bytes.length + text.length);
    all.set(bytes); all.set(text, bytes.length);
    if (crypto.subtle) return [...new Uint8Array(await crypto.subtle.digest('SHA-256', all))].map(b => b.toString(16).padStart(2, '0')).join('');
    let a = 0x811c9dc5, b = 0x01000193; // insecure contexts: two FNV-1a passes
    for (const v of all) { a = Math.imul(a ^ v, 0x01000193) >>> 0; b = Math.imul(b ^ v, 0x01000193 + 2) >>> 0; }
    return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0') + all.length.toString(16);
  }

  async function request(url, options = {}) {
    // /api names are local RPC identifiers, retained for the UI adapter.
    // No HTTP request is sent: a Blob Worker returns score JSON or WAV bytes.
    const path = new URL(url, 'https://pixelmusic.invalid').pathname;
    if (path === '/api/health') return new Response(JSON.stringify({engine: 'pixelmusic-browser-v1'}));
    const data = options.body ? JSON.parse(options.body) : null;
    const signal = options.signal, aborted = () => new DOMException('计算已取消', 'AbortError');
    if (signal?.aborted) throw aborted();
    if (path === '/api/generate') {
      // JPEG and PNG files are decoded in the Worker exactly as the former engine did.
      const bytes = base64Bytes(data.image), scoreOptions = data.options || {}, key = await scoreKey(bytes, scoreOptions);
      const response = await send(path, {options: scoreOptions, key, file: bytes}, signal, [bytes.buffer]);
      if (response) return response;
      const image = await decodeImage(base64Bytes(data.image));
      if (signal?.aborted) throw aborted();
      return send(path, {options: scoreOptions, key, ...image}, signal, [image.pixels.buffer]);
    }
    return send(path, data, signal);
  }
  async function send(path, data, signal, transfer = []) {
    const aborted = () => new DOMException('计算已取消', 'AbortError');
    await initialize();
    if (signal?.aborted) throw aborted();
    return new Promise((resolve, reject) => {
      const id = ++serial;
      const abort = () => {
        pending.delete(id); reject(aborted());
        if (path === '/api/generate' || path === '/api/performance') reset();
      };
      pending.set(id, {resolve: value => {signal?.removeEventListener('abort', abort); resolve(value);}, reject: error => {signal?.removeEventListener('abort', abort); reject(error);}});
      signal?.addEventListener('abort', abort, {once: true});
      worker.postMessage({id, path, data}, transfer);
    });
  }
  window.PixelMusicBrowser = {request, reset};
})();
