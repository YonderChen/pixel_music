(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PixelMusicTiming = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  function makeMap(points) {
    let seconds = 0;
    return points.slice(0, -1).map((point, i) => {
      const next = points[i + 1], beats = next.beat - point.beat;
      if (!(beats > 0 && point.bpm > 0 && next.bpm > 0)) throw new Error('速度时间轴无效');
      const spb = 60 / point.bpm, endSpb = 60 / next.bpm;
      const segment = { beat: point.beat, endBeat: next.beat, spb, slope: (endSpb - spb) / beats, seconds, endSeconds: seconds + beats * (spb + endSpb) / 2 };
      seconds = segment.endSeconds;
      return segment;
    });
  }
  function beatToTime(score, beat) {
    if (!score.tempoMap?.length) return beat * score.secondsPerBeat;
    const map = score.tempoMap, last = map.at(-1);
    if (beat >= last.endBeat) return last.endSeconds + (beat - last.endBeat) * (last.spb + last.slope * (last.endBeat - last.beat));
    const segment = map.find(s => beat < s.endBeat) || last, x = Math.max(0, beat - segment.beat);
    return segment.seconds + x * segment.spb + segment.slope * x * x / 2;
  }
  function timeToBeat(score, time) {
    if (!score.tempoMap?.length) return Math.max(0, time) / score.secondsPerBeat;
    const map = score.tempoMap, last = map.at(-1);
    if (time >= last.endSeconds) return last.endBeat + (time - last.endSeconds) / (last.spb + last.slope * (last.endBeat - last.beat));
    const segment = map.find(s => time < s.endSeconds) || last, delta = Math.max(0, time - segment.seconds);
    const x = 2 * delta / (segment.spb + Math.sqrt(segment.spb * segment.spb + 2 * segment.slope * delta));
    return segment.beat + x;
  }
  return { makeMap, beatToTime, timeToBeat };
});
