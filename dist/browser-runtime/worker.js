/* The function is serialized into a Blob Worker, including when opened via file://. */
window.PixelMusicWorkerMain = function () {
  'use strict';
  let py, handle, scripts, assets, ready, fluidReady, font, currentSynth;
  const scriptUrls = new Map();
  const realImport = self.importScripts.bind(self);
  function decode(base64) {
    const raw = atob(base64), bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }
  function script(name) {
    if (!scriptUrls.has(name)) scriptUrls.set(name, URL.createObjectURL(new Blob([scripts[name]], {type: 'text/javascript'})));
    return scriptUrls.get(name);
  }
  self.importScripts = (...urls) => realImport(...urls.map(url => scripts[url.split('/').pop()] ? script(url.split('/').pop()) : url));
  self.fetch = async (url, options) => {
    const name = String(url instanceof Request ? url.url : url).split('/').pop();
    if (assets[name]) {
      const bytes = decode(assets[name]);
      return new Response(bytes, {headers: {'Content-Type': name.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream'}});
    }
    if (name === 'pyodide-lock.json') return new Response(scripts[name], {headers: {'Content-Type': 'application/json'}});
    // Runtime assets are bundled. Fail visibly instead of contacting a CDN.
    throw new Error('缺少离线运行资源：' + name);
  };
  async function initialize(data) {
    scripts = data.sources.scripts; assets = data.assets;
    realImport(script('pyodide.js'));
    py = await loadPyodide({indexURL: 'https://pixelmusic.invalid/runtime/', packages: ['numpy', 'pillow'], stdout: () => {}, stderr: text => console.warn(text)});
    for (const [path, source] of Object.entries(data.sources.python)) {
      const target = '/app/' + path;
      py.FS.mkdirTree(target.slice(0, target.lastIndexOf('/'))); py.FS.writeFile(target, source);
    }
    py.runPython("import sys; sys.path.insert(0, '/app/scripts'); from browser_engine import handle");
    handle = py.globals.get('handle');
    assets = null; // Packages are installed in the Worker filesystem.
  }
  async function prepareFluid(base64) {
    if (!fluidReady) fluidReady = (async () => {
      font = decode(base64);
      realImport(script('libfluidsynth.js'), script('js-synthesizer.js'));
      await JSSynth.waitForReady();
    })();
    return fluidReady;
  }
  self.renderGeneralUser = (bytes, duration, sr) => {
    const synth = new JSSynth.Synthesizer();
    try {
      synth.init(sr, {initialGain: .45});
      // These methods do their native work synchronously, returning resolved promises.
      synth.loadSFont(font.buffer).catch(error => console.error(error));
      if (!Module._fluid_synth_sfcount(synth.getRawSynthesizer())) throw new Error('GS 音色库未能加载。');
      synth.addSMFDataToPlayer(bytes.buffer).catch(error => console.error(error));
      synth.playPlayer().catch(error => console.error(error));
      const frames = Math.round((duration + .8) * sr), output = new Float32Array(frames * 2);
      for (let start = 0; start < frames; start += 1024) {
        const size = Math.min(1024, frames - start), left = new Float32Array(size), right = new Float32Array(size);
        synth.render([left, right]);
        for (let i = 0; i < size; i++) {output[(start+i)*2] = left[i]; output[(start+i)*2+1] = right[i];}
      }
      return new Uint8Array(output.buffer);
    } finally {synth.close();}
  };
  let queue = Promise.resolve();
  self.onmessage = event => {
    const message = event.data;
    if (message.init) {ready = initialize(message); return;}
    queue = queue.then(async () => {
      try {
        await ready;
        if (message.path === '/api/generate') currentSynth = message.data.options.synth;
        if (message.path === '/api/performance') currentSynth = message.data.synth;
        const audio = !['/api/health', '/api/generate'].includes(message.path);
        if (audio && currentSynth === 'GeneralUser GS') await prepareFluid(message.font);
        const result = JSON.parse(handle(JSON.stringify({path: message.path, data: message.data})));
        if (result.file) {
          const bytes = py.FS.readFile(result.file); py.FS.unlink(result.file);
          self.postMessage({id: message.id, bytes: bytes.buffer, metrics: result.metrics}, [bytes.buffer]);
        } else self.postMessage({id: message.id, data: result});
      } catch (error) {self.postMessage({id: message.id, error: String(error.message || error)});}
    });
  };
};
