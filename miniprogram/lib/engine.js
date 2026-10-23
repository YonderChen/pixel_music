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
    if (message.error) job.reject(new Error(message.error)); else job.resolve(message.result);
  });
  if (instance.onError) instance.onError(() => cancel());
  if (/^\/api\/(audio\/|rowmix|hover-bank|hover-audio\/|preview)/.test(path) && latestGenerate) instance.postMessage({id: 0, path: '/api/generate', data: latestGenerate});
}
function request(path, data = {}) {
  return new Promise((resolve, reject) => {
    try {
      if (path === '/api/generate') latestGenerate = data;
      start(path); const id = ++sequence;
      const timer = setTimeout(() => cancel(), 180000);
      pending.set(id, {resolve, reject, timer}); instance.postMessage({id, path, data});
    } catch (error) { cancel(); reject(error); }
  });
}
module.exports = {request, cancel};
