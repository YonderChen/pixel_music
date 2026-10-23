'use strict';
const Files = require('./files');
class Player {
  constructor(onTime, onState, onError) {
    this.audio = wx.createInnerAudioContext({useWebAudioImplement: true});
    this.audio.obeyMuteSwitch = false;
    this.audio.onTimeUpdate(() => onTime(this.audio.currentTime || 0));
    this.audio.onPlay(() => { this.playing = true; onState(true); });
    this.audio.onPause(() => { this.playing = false; onState(false); });
    this.audio.onStop(() => { this.playing = false; onState(false); });
    this.audio.onEnded(() => { this.playing = false; onState(false); });
    this.audio.onError(error => { this.playing = false; onState(false); onError(new Error(error.errMsg || '音频播放失败')); });
    this.audio.onCanplay(() => { this.ready = true; if (this.awaiting) { this.awaiting = false; this.audio.seek(this.position || 0); this.audio.play(); } });
  }
  async load(bytes) {
    const generation = this.generation = (this.generation || 0) + 1;
    const path = await Files.write(bytes);
    if (generation !== this.generation) { Files.remove(path); return false; }
    this.audio.stop(); this.ready = false; Files.remove(this.path); this.path = path; this.audio.src = path; return true;
  }
  play(position = 0, loop = false) { this.position = position; this.audio.loop = loop; if (!this.ready) { this.awaiting = true; return; } this.audio.seek(position); this.audio.play(); }
  pause() { this.awaiting = false; this.audio.pause(); }
  seek(time) { this.position = time; this.audio.seek(time); }
  destroy() { this.generation = (this.generation || 0) + 1; this.audio.destroy(); Files.remove(this.path); }
}
module.exports = Player;
