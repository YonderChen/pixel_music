'use strict';
const PM = require('./engine'), artAudio = require('./art-audio');
let queue = Promise.resolve();
worker.onMessage(message => {
  queue = queue.then(async () => {
    try {
      const data = message.data;
      for (const key of ['file', 'pixels']) if (data && data[key] !== undefined) {
        if (data[key] instanceof ArrayBuffer) data[key] = new Uint8Array(data[key]);
        if (!(data[key] instanceof Uint8Array)) throw new Error('图片数据传输失败，请重新生成。');
      }
      const result = message.path === '/art/audio' ? {bytes: artAudio(data.score)} : await PM.handler.handle(message.path, data);
      // WeChat serializes ArrayBuffers; it has no browser transfer-list argument.
      if (result.bytes) {
        const bytes = result.bytes;
        result.bytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      }
      if (result.preview) result.preview.bytes = result.preview.bytes.buffer;
      worker.postMessage({id: message.id, result});
      // WAV files are persisted by the host. Keep only stems for the current image,
      // instead of retaining another full WAV for every requested version.
      for (const entry of PM.handler.entries.values()) { entry.waves = {}; entry.audioMetrics = {}; }
    } catch (error) { worker.postMessage({id: message.id, error: error.message || String(error), stack: error.stack}); }
  });
});
