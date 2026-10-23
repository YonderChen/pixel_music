/* Two dependency-free targets. dist remains the editable web source for compatibility
 * with existing Pages deployments; generated deliveries live exclusively in build/. */
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'build');
const targets = process.argv.slice(2);
if (targets.some(t => !['html', 'miniprogram'].includes(t))) {
  console.error('Usage: npm run build -- [html|miniprogram]'); process.exit(1);
}
const selected = new Set(targets.length ? targets : ['html', 'miniprogram']);
const engineFiles = ['core', 'libm', 'fft', 'image', 'jpeg', 'png', 'analysis', 'composition', 'mood', 'segmentation', 'arranger', 'synth', 'soft-mixer', 'region-music', 'scores', 'render', 'hover', 'handler'];
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
function write(dir, name, value) { const file = path.join(dir, name); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, value); }
function bytes(dir) { return fs.readdirSync(dir, {withFileTypes: true}).reduce((n, e) => n + (e.isDirectory() ? bytes(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0); }
fs.mkdirSync(output, {recursive: true});
// The MIDI generator has no dependencies and is the existing authoritative source.
execFileSync(process.execPath, [path.join(root, 'scripts/package_classical_midi.cjs')], {cwd: root, stdio: 'pipe'});
for (const target of selected) {
  const staging = path.join(output, '.' + target + '-staging'), dest = path.join(output, target);
  fs.rmSync(staging, {recursive: true, force: true});
  try {
    if (target === 'html') {
      fs.cpSync(path.join(root, 'dist'), staging, {recursive: true, filter: file => !file.endsWith('.DS_Store')});
      write(staging, 'index.html', read('dist/feature-music.html'));
    } else {
      // The IDE writes the user's real AppID and local settings into the generated
      // project. Keep them on rebuild unless an explicit source/env AppID replaces it.
      const previousConfigPath = path.join(dest, 'project.config.json');
      const previous = fs.existsSync(previousConfigPath) ? JSON.parse(fs.readFileSync(previousConfigPath, 'utf8')) : {};
      const privatePath = path.join(dest, 'project.private.config.json');
      fs.cpSync(path.join(root, 'miniprogram'), staging, {recursive: true});
      const config = JSON.parse(read('miniprogram/project.config.json'));
      const appid = process.env.WECHAT_APPID || (config.appid !== 'touristappid' ? config.appid : previous.appid || config.appid);
      if (appid !== 'touristappid' && !/^wx[0-9a-f]{16}$/i.test(appid)) throw new Error('WECHAT_APPID 必须是 wx 开头的 18 位 AppID');
      config.appid = appid;
      write(staging, 'project.config.json', JSON.stringify(config, null, 2) + '\n');
      if (fs.existsSync(privatePath)) fs.copyFileSync(privatePath, path.join(staging, 'project.private.config.json'));
      for (const name of ['music-art-core', 'music-art-midi']) write(staging, 'lib/' + name + '.js', read('dist/' + name + '.js'));
      // Convert classic browser globals at build time. No eval, dynamic scripts or
      // Blob workers are used at runtime in the mini program.
      const scope = {window: {}};
      for (const name of ['dist/sonification-assets/paintings.js', 'dist/music-art-classics.js']) vm.runInNewContext(read(name), scope);
      const paintings = scope.window.PixelMusicPaintings;
      write(staging, 'lib/samples.js', 'module.exports = ' + JSON.stringify(paintings.map(p => ({id: p.id, name: p.name, path: '/' + p.path.replace(/^\.\//, ''), credit: p.credit || ''}))) + ';\n');
      for (const p of paintings) { const destFile = path.join(staging, p.path); fs.mkdirSync(path.dirname(destFile), {recursive: true}); fs.copyFileSync(path.join(root, 'dist', p.path), destFile); }
      write(staging, 'lib/classics.js', read('dist/music-art-classics.js'));
      fs.cpSync(path.join(root, 'dist/classical-midi'), path.join(staging, 'classical-midi'), {recursive: true});
      const source = 'const self = {};\nconst {binaryBase64} = require("./base64");\nconst btoa = binaryBase64;\n' + engineFiles.map(n => read('dist/engine/' + n + '.js')).join('\n') + '\nconst PM = {inflate: require("./inflate")};\nfor (const init of self.PixelMusicEngineModules) init(PM);\nmodule.exports = PM;\n';
      write(staging, 'workers/engine.js', source);
      for (const name of ['inflate', 'base64', 'art-audio']) write(staging, 'workers/' + name + '.js', read('shared/' + name + '.js'));
      write(staging, 'lib/base64.js', read('shared/base64.js'));
      fs.cpSync(path.join(root, 'dist/engine/licenses'), path.join(staging, 'licenses'), {recursive: true});
      write(staging, 'licenses/THIRD_PARTY.md', read('dist/engine/THIRD_PARTY.md'));
      // Fail before replacing a working output, rather than handing off a broken app.
      const app = JSON.parse(fs.readFileSync(path.join(staging, 'app.json')));
      for (const page of app.pages) for (const ext of ['js', 'json', 'wxml', 'wxss']) if (!fs.existsSync(path.join(staging, page + '.' + ext))) throw new Error('Missing page: ' + page + '.' + ext);
      if (bytes(staging) > 2 * 1024 * 1024) throw new Error('小程序主包超过 2 MiB，请拆分资源后再构建');
    }
    fs.rmSync(dest, {recursive: true, force: true}); fs.renameSync(staging, dest);
    console.log(target + ' → ' + path.relative(root, dest) + ' (' + (bytes(dest) / 1024).toFixed(1) + ' KiB)');
  } catch (error) { fs.rmSync(staging, {recursive: true, force: true}); throw error; }
}
