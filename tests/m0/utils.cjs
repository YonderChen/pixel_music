const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const jsonSha = value => sha256(JSON.stringify(value));
const read = relative => fs.readFileSync(path.join(root, relative));
const readJson = relative => JSON.parse(read(relative));
function audioTrace(Audio, score, tone, fromBeat = 0) {
  const { Context } = require('../baseline/fake-audio-v061.cjs');
  const context = new Context();
  const session = Audio.createSession(context, { bpm: score.bpm });
  session.schedule(score, .08, tone, fromBeat);
  const trace = context.nodes.map(node => ({
    kind: node.kind, type: node.type ?? null, started: node.started ?? null,
    stops: node.stops ?? [],
    params: Object.fromEntries(['gain', 'frequency', 'delayTime', 'threshold', 'ratio', 'knee'].map(name => [name, { value: node[name].value, events: node[name].events }]))
  }));
  session.dispose();
  return trace;
}
module.exports = { root, sha256, jsonSha, read, readJson, audioTrace };
