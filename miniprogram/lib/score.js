'use strict';
const Core = require('./music-art-core');
function read(raw) {
  const value = typeof raw === 'string' ? JSON.parse(raw) : raw, score = Core.normalize(value), ref = value.audioRef;
  if (ref && ref.kind === 'browser-score' && ['parallel','reference'].includes(ref.variant) && ['soft','original'].includes(ref.profile) && ref.synth === 'Simple' && ref.info && ref.info.duration > 0 && ref.info.duration <= 180 && Array.isArray(ref.events) && ref.events.length <= 5000 && Array.isArray(ref.voices) && ref.voices.length <= 4 && Array.isArray(ref.rows) && ref.rows.every(r=>/^row-[0-3]$/.test(r))) {
    Core.normalize({events:ref.events,duration:ref.info.duration,tempo:ref.info.tempo}); score.audioRef=ref;
  }
  return score;
}
module.exports = {read};
