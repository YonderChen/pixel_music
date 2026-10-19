/* Shared test harness for the JS engine.
 * loadEngine(): the browser engine modules, as the Worker runs them.
 * loadOracle(): the former Pyodide runtime (Python 3.12, NumPy 2.0.2, Pillow 10.2) with
 * the original Python rules, i.e. what the site computed before the JS engine. The
 * Pyodide files are taken from git history (the commit before they were removed). */
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), cp = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const ORACLE_COMMIT = '976de6f';
const ENGINE_FILES = ['core.js', 'libm.js', 'fft.js', 'image.js', 'jpeg.js', 'png.js', 'analysis.js', 'composition.js', 'segmentation.js', 'arranger.js',
  'synth.js', 'soft-mixer.js', 'region-music.js', 'scores.js', 'render.js', 'hover.js', 'handler.js'];

function loadEngine(files = ENGINE_FILES) {
  // Each file runs as a function of `self` in this realm (a vm context's global lookups are
  // many times slower than a Worker's), so timings reflect the browser.
  const self = {};
  for (const name of files) {
    const file = path.join(root, 'dist/engine', name);
    if (fs.existsSync(file)) vm.compileFunction(fs.readFileSync(file, 'utf8'), ['self'], {filename: file})(self);
  }
  const PM = {};
  for (const module of self.PixelMusicEngineModules) module(PM);
  return PM;
}

function oracleRuntime() {
  const cache = path.join(root, 'build/pyodide-oracle');
  const vendor = 'dist/browser-runtime/vendor/';
  const lock = JSON.parse(cp.execFileSync('git', ['show', ORACLE_COMMIT + ':' + vendor + 'pyodide-lock.json'], {cwd: root, maxBuffer: 1e8}));
  const files = {'pyodide.js': 'pyodide.js', 'pyodide.asm.js': 'pyodide.asm.js', 'pyodide.asm.wasm': 'pyodide.asm.wasm',
    'python_stdlib.zip': 'python_stdlib.zip', 'pyodide-lock.json': 'pyodide-lock.json',
    [lock.packages.numpy.file_name]: 'numpy.whl', [lock.packages.pillow.file_name]: 'pillow.whl'};
  fs.mkdirSync(cache, {recursive: true});
  for (const [target, source] of Object.entries(files)) {
    const out = path.join(cache, target);
    if (!fs.existsSync(out)) fs.writeFileSync(out, cp.execFileSync('git', ['show', ORACLE_COMMIT + ':' + vendor + source], {cwd: root, maxBuffer: 1e8}));
  }
  return cache;
}

async function loadOracle() {
  const cache = oracleRuntime();
  const {loadPyodide} = require(path.join(cache, 'pyodide.js'));
  const py = await loadPyodide({indexURL: cache + '/', packages: ['numpy', 'pillow'], stdout() {}, stderr() {}});
  const sources = [...fs.readdirSync(path.join(root, 'vendor/photo_sonification')).filter(n => n.endsWith('.py')).map(n => 'vendor/photo_sonification/' + n),
    ...['reference_music', 'arranger', 'segmentation', 'region_music', 'soft_row_mixer', 'hover_preview', 'browser_engine'].map(n => `scripts/${n}.py`)];
  for (const name of sources) {
    const target = '/app/' + name;
    py.FS.mkdirTree(path.posix.dirname(target));
    // browser_engine.py (the former Worker adapter) only exists in history.
    const source = fs.existsSync(path.join(root, name)) ? fs.readFileSync(path.join(root, name), 'utf8')
      : cp.execFileSync('git', ['show', ORACLE_COMMIT + ':' + name], {cwd: root, encoding: 'utf8'});
    py.FS.writeFile(target, source);
  }
  py.runPython("import sys; sys.path.insert(0, '/app/scripts'); sys.path.insert(0, '/app/vendor/photo_sonification')");
  return py;
}

// Deterministic pseudo-random numbers for fuzzing.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

module.exports = {root, loadEngine, loadOracle, rng, ENGINE_FILES};
