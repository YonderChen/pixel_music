const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Fixtures = require('./fixtures.js');
const Snapshot = require('./regression-summary.json');
const Music = require('../dist/music.js'), Image = require('../dist/image-analysis.js');
const projectRoot = path.resolve(__dirname, '..');

function localAsset(page, source) {
  assert.ok(!/^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(source), 'assets must use relative local paths');
  const resolved = path.resolve(path.dirname(page), source.split(/[?#]/)[0]);
  assert.ok(!path.relative(projectRoot, resolved).startsWith('..'), 'assets must remain inside this project');
  assert.ok(fs.statSync(resolved).isFile(), `missing asset: ${source}`);
  return resolved;
}
for (const relativePage of ['dist/index.html', 'tests/listen.html', 'tests/rhythm-listen.html', 'tests/fidelity-listen.html', 'tests/articulation-listen.html']) {
  const page = path.join(projectRoot, relativePage), html = fs.readFileSync(page, 'utf8');
  const sandbox = {}; sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  const scriptTags = [...html.matchAll(/<script\b([^>]*)>/gi)];
  assert.ok(scriptTags.length > 0);
  for (const [, attributes] of scriptTags) {
    assert.ok(!/\btype\s*=\s*["']module["']/i.test(attributes), 'direct-file entry points must not require module fetching');
    const source = attributes.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    assert.ok(source, 'entry points must use inspectable local script files');
    const asset = localAsset(page, source), code = fs.readFileSync(asset, 'utf8');
    assert.ok(!/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|importScripts)\s*\(/.test(code), 'no network-dependent runtime loading');
    assert.ok(!/\bimport\s*\(/.test(code), 'no dynamic module loading');
    const script = new vm.Script(code, { filename: source });
    // Load the actual browser UMD branches in the HTML order. DOM entry scripts are syntax-checked only.
    if (!['app.js', 'listen.js', 'rhythm-listen.js', 'fidelity-listen.js', 'articulation-listen.js'].includes(path.basename(asset))) script.runInContext(context);
  }
  for (const [, attributes] of html.matchAll(/<link\b([^>]*)>/gi)) {
    if (!/\brel\s*=\s*["']stylesheet["']/i.test(attributes)) continue;
    const source = attributes.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    const css = fs.readFileSync(localAsset(page, source), 'utf8');
    assert.ok(!/@import\b|url\(\s*["']?(?:https?:)?\/\//i.test(css), 'no remote CSS or font loading');
  }
  assert.ok(context.PixelMusic && context.PixelMusicImage && context.PixelMusicAudio);
  const score = context.PixelMusic.compose(context.PixelMusicImage.analyzePixels(Fixtures.pixels(5)));
  assert.equal(score.scoreHash, Music.compose(Image.analyzePixels(Fixtures.pixels(5))).scoreHash, 'classic browser exports must produce the canonical score');
  if (relativePage === 'tests/listen.html') {
    assert.ok(context.PixelMusicLegacy && context.PixelMusicFixtures && context.PixelMusicListening);
    assert.equal(context.PixelMusicListening.summarize([]).acceptance, false);
    assert.equal(context.PixelMusicV04.compose(context.PixelMusicImageV04.analyzePixels(Fixtures.pixels(5))).scoreHash, Snapshot.scoreHashes[5], '0.4 comparison must remain frozen');
  }
  if (relativePage === 'tests/rhythm-listen.html') {
    assert.ok(context.PixelMusicV04 && context.PixelMusicImageV04 && context.PixelMusicAudioV04 && context.PixelMusicRhythmFixtures && context.PixelMusicV05);
    assert.equal(context.PixelMusicV05.compose(context.PixelMusicImageV05.analyzePixels(Fixtures.pixels(5))).scoreHash, require('./browser-score-snapshot.json').scoreHashes[5]);
  }
  if (relativePage === 'tests/fidelity-listen.html') {
    assert.equal(context.PixelMusicFidelityFixtures.names.length,84);
    const white=context.PixelMusic.compose(context.PixelMusicImage.analyzePixels(context.PixelMusicFidelityFixtures.pixels(60)));
    assert.equal(white.melody.length,1);assert.equal(white.regionMap.length,120);
    assert.ok(context.PixelMusicV05 && context.PixelMusicImageV05 && context.PixelMusicAudioV05);
    assert.equal(context.PixelMusicV06.compose(context.PixelMusicImageV06.analyzePixels(context.PixelMusicFidelityFixtures.pixels(60))).scoreHash,require('./fidelity-browser-snapshot.json').scores[60].scoreHash);
  }
  if(relativePage==='tests/articulation-listen.html'){
    const white=context.PixelMusic.compose(context.PixelMusicImage.analyzePixels(context.PixelMusicFidelityFixtures.pixels(60)));
    assert.equal(white.performanceEvents.length,22);assert.equal(white.performanceEvents[0].envelope,'pluck');
  }
}
console.log('Passed all five local HTML resource graphs, classic-script exports/order, frozen history and canonical 0.6.1 performance scores. This is not a live file-protocol browser test.');
