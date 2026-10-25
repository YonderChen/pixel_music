'use strict';
let instance, sequence = 0, latestGenerate;
const pending = new Map();
function cancel() {
  if (instance) instance.terminate(); instance = null;
  for (const job of pending.values()) { clearTimeout(job.timer); job.reject(new Error('计算已取消，请重新生成或播放')); }
  pending.clear();
}
function start(path) {
  if (instance) return;
  instance = wx.createWorker('workers/index.js');
  instance.onMessage(message => {
    const job = pending.get(message.id); if (!job) return;
    pending.delete(message.id); clearTimeout(job.timer);
    if (message.error) {
      const error = new Error(message.error);
      if (message.stack) error.stack = message.stack;
      job.reject(error);
    } else job.resolve(message.result);
  });
  if (instance.onError) instance.onError(() => cancel());
  if (/^\/api\/(audio\/|rowmix|hover-bank|hover-audio\/|preview)/.test(path) && latestGenerate) instance.postMessage({id: 0, path: '/api/generate', data: latestGenerate});
}
function request(path, data = {}) {
  return new Promise((resolve, reject) => {
    try {
      // Use the binary type explicitly supported by WeChat's Worker bridge.
      // Passing Uint8Array directly can turn it into a plain numeric-key object,
      // losing .length/.subarray and corrupting image analysis on native runtimes.
      const wire = Object.assign({}, data);
      for (const key of ['file', 'pixels']) if (ArrayBuffer.isView(wire[key])) {
        const bytes = wire[key]; wire[key] = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      }
      if (path === '/api/generate') latestGenerate = wire;
      start(path); const id = ++sequence;
      const timer = setTimeout(() => cancel(), 180000);
      pending.set(id, {resolve, reject, timer}); instance.postMessage({id, path, data: wire});
    } catch (error) { cancel(); reject(error); }
  });
}
module.exports = {request, cancel};
