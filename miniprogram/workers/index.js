'use strict';
const PM = require('./engine'), artAudio = require('./art-audio');
let queue = Promise.resolve();
worker.onMessage(message => {
  queue = queue.then(async () => {
    try {
      const result = message.path === '/art/audio' ? {bytes: artAudio(message.data.score)} : await PM.handler.handle(message.path, message.data);
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
    } catch (error) { worker.postMessage({id: message.id, error: error.message || String(error)}); }
  });
});
