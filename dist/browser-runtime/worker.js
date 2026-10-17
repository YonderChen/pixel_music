/* The function is serialized into a Blob Worker, including when opened via file://. */
window.PixelMusicWorkerMain = function () {
  'use strict';
  let py, handle, scripts, assets, ready;
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
  let queue = Promise.resolve();
  self.onmessage = event => {
    const message = event.data;
    if (message.init) {ready = initialize(message); return;}
    queue = queue.then(async () => {
      try {
        await ready;
        const result = JSON.parse(handle(JSON.stringify({path: message.path, data: message.data})));
        if (result.file) {
          const bytes = py.FS.readFile(result.file); py.FS.unlink(result.file);
          self.postMessage({id: message.id, bytes: bytes.buffer, metrics: result.metrics}, [bytes.buffer]);
        } else self.postMessage({id: message.id, data: result});
      } catch (error) {self.postMessage({id: message.id, error: String(error.message || error)});}
    });
  };
};
