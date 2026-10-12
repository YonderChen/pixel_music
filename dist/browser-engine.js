(function () {
  'use strict';
  const root = new URL('./browser-runtime/', document.currentScript.src).href;
  const loaded = new Map(), pending = new Map();
  let worker, initializing, serial = 0, synth = 'GeneralUser GS', fontSent = false;
  function load(name, global) {
    if (!loaded.has(name)) loaded.set(name, new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = root + name;
      script.onload = () => resolve(window[global]);
      script.onerror = () => {loaded.delete(name); script.remove(); reject(new Error('运行资源读取失败，请保留完整静态文件夹后重试。'));};
      document.head.appendChild(script);
    }));
    return loaded.get(name);
  }
  function reset(reason = new DOMException('计算已取消', 'AbortError')) {
    worker?.terminate(); worker = null; initializing = null; fontSent = false;
    for (const job of pending.values()) job.reject(reason);
    pending.clear();
  }
  async function initialize() {
    if (!initializing) initializing = (async () => {
      if (!window.Worker || !window.WebAssembly) throw new Error('当前浏览器不支持后台计算，请使用新版 Chrome、Edge 或 Safari。');
      const [sources, assets, main] = await Promise.all([
        load('sources-data.js', 'PixelMusicRuntimeSources'), load('compute-data.js', 'PixelMusicComputeAssets'), load('worker.js', 'PixelMusicWorkerMain')
      ]);
      const url = URL.createObjectURL(new Blob(['(' + main.toString() + ')();'], {type: 'text/javascript'}));
      worker = new Worker(url); URL.revokeObjectURL(url);
      worker.onmessage = ({data}) => {
        const job = pending.get(data.id); if (!job) return;
        pending.delete(data.id);
        if (data.error) job.reject(new Error(data.error.split('\n').filter(Boolean).at(-1)));
        else job.resolve(data.bytes ? new Response(data.bytes, {headers: {'Content-Type': 'audio/wav', 'X-Audio-Rms': String(data.metrics?.first12Rms ?? 0)}}) : new Response(JSON.stringify(data.data), {headers: {'Content-Type': 'application/json'}}));
      };
      worker.onerror = () => {reset(new Error('后台计算意外中断，请重新生成。'));};
      worker.postMessage({init: true, sources, assets});
    })().catch(error => {initializing = null; throw error;});
    await initializing;
  }
  async function request(url, options = {}) {
    // /api names are local RPC identifiers, retained for the UI adapter.
    // No HTTP request is sent: a Blob Worker returns score JSON or WAV bytes.
    const path = new URL(url, 'https://pixelmusic.invalid').pathname;
    if (path === '/api/health') return new Response(JSON.stringify({engine: 'pixelmusic-browser-v1'}));
    const data = options.body ? JSON.parse(options.body) : null;
    if (path === '/api/generate') synth = data.options.synth;
    if (path === '/api/performance') synth = data.synth;
    const signal = options.signal;
    if (signal?.aborted) throw new DOMException('计算已取消', 'AbortError');
    await initialize();
    let font;
    if (path !== '/api/generate' && synth === 'GeneralUser GS' && !fontSent) font = await load('soundfont-data.js', 'PixelMusicSoundfontData');
    if (signal?.aborted) throw new DOMException('计算已取消', 'AbortError');
    return new Promise((resolve, reject) => {
      const id = ++serial;
      const abort = () => {
        pending.delete(id); reject(new DOMException('计算已取消', 'AbortError'));
        if (path === '/api/generate' || path === '/api/performance') reset();
      };
      pending.set(id, {resolve: value => {signal?.removeEventListener('abort', abort); resolve(value);}, reject: error => {signal?.removeEventListener('abort', abort); reject(error);}});
      signal?.addEventListener('abort', abort, {once: true});
      worker.postMessage({id, path, data, font}); if (font) fontSent = true;
    });
  }
  window.PixelMusicBrowser = {request, reset};
})();
