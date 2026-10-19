/* The libm.js port of musl reproduces the former engine's math.* and NumPy ufunc results bit for bit. */
const assert = require('node:assert/strict');
const {loadEngine, loadOracle, rng} = require('./harness.cjs');
(async () => {
  const {libm} = loadEngine(['core.js', 'libm.js']), py = await loadOracle(), random = rng(11);
  // Doubles travel as big-endian bit patterns in hex, so -0, NaN, ±Infinity and subnormals survive JSON.
  const F = new Float64Array(1), U = new Uint32Array(F.buffer);
  const hex = x => { F[0] = x; return U[1].toString(16).padStart(8, '0') + U[0].toString(16).padStart(8, '0'); };
  const unhex = h => { U[1] = parseInt(h.slice(0, 8), 16); U[0] = parseInt(h.slice(8), 16); return F[0]; };
  const same = (a, b) => Object.is(a, b);
  const unit = () => random() + random() * 2 ** -32; // 53 random bits
  const uniform = (lo, hi) => lo + (hi - lo) * unit();
  const logUniform = (lo, hi) => 2 ** uniform(Math.log2(lo), Math.log2(hi));
  const signed = x => (random() < .5 ? -x : x);
  const many = (n, f) => Array.from({length: n}, f);
  const anyDouble = () => { U[1] = (random() * 2 ** 32) >>> 0; U[0] = (random() * 2 ** 32) >>> 0; return F[0]; };
  const nextUp = (x, k) => { F[0] = x; const lo = U[0] + k; U[1] += Math.floor(lo / 2 ** 32); U[0] = lo; return F[0]; };
  const SPECIAL = [0, -0, Infinity, -Infinity, NaN, 5e-324, -5e-324, 2.2250738585072014e-308, 2.225073858507201e-308, -2.2250738585072014e-308,
    1, -1, .5, -.5, 2, -2, 3, -3, 1e-300, 1e300, -1e300, 1.7976931348623157e308, -1.7976931348623157e308, 2 ** -27, 2 ** -54, 2 ** -60, 2 ** 52, 2 ** 53, 2 ** 64];
  const near = (x, spread = 4) => many(2 * spread + 1, (_, k) => nextUp(x, k - spread)).filter(Number.isFinite);
  const audioPhases = n => many(n, () => {
    const f = logUniform(20, 4000), t = Math.floor(random() * 120 * 44100) / 44100;
    return random() < .5 ? 2 * Math.PI * f * t : (2 * Math.PI * f / 44100) * Math.floor(t * 44100);
  });
  const angles = [
    ...many(8000, () => uniform(0, Math.PI / 4)), ...many(4000, () => uniform(-10, 10)), ...many(6000, () => signed(uniform(0, 1e4))),
    ...many(3000, () => signed(logUniform(1e-12, 1))), ...audioPhases(12000), ...many(2000, () => signed(logUniform(1e4, 1e9))),
    ...many(300, () => signed(logUniform(1e9, 1e308))), ...many(400, () => Math.floor(uniform(-4e4, 4e4)) * Math.PI / 4).flatMap(x => near(x, 2)),
    ...many(200, () => Math.floor(uniform(-2e6, 2e6)) * Math.PI / 2).flatMap(x => near(x, 1)), ...many(3000, anyDouble),
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap(k => near(k * Math.PI / 4, 30)), ...SPECIAL];
  const logArgs = [
    ...many(8000, () => logUniform(5e-324, 1.7e308)), ...many(6000, () => uniform(.9, 1.1)), ...many(3000, () => 1 + signed(logUniform(1e-17, .1))),
    ...many(4000, () => uniform(0, 100)), ...many(2000, () => logUniform(5e-324, 2.2e-308)), ...many(2000, () => -logUniform(1e-10, 1e10)),
    ...many(4000, anyDouble), ...near(1, 40), ...SPECIAL];
  const pairs = (xs, ys) => xs.map((x, i) => [x, ys[i]]);
  const grid = (xs, ys) => xs.flatMap(x => ys.map(y => [x, y]));
  const powSpecial = [...SPECIAL, -4, 4, .25, -.25, 2.4, 1 / 3, -1 / 3, .16, -.5, 1023, 1024, -1074, -1075, 1e10, 2 ** 63, -(2 ** 63), 2 ** -70, 1 + 2 ** -52, 1 - 2 ** -53];
  const powArgs = [
    ...grid(many(3000, () => uniform(0, 10)), [2.4, .16, 1 / 3, -.5, 2, .5, 1 / 2.4, 1.5]),
    ...pairs(many(12000, () => uniform(0, 10)), many(12000, () => uniform(-20, 20))),
    ...many(6000, () => [2, Math.floor(uniform(-1200, 1200)) / 12 + (random() < .3 ? uniform(-1, 1) / 100 : 0)]),
    ...many(2000, () => [2, (Math.floor(uniform(0, 128)) - 69) / 12]).map(([b, e]) => [b, e]),
    ...pairs(many(3000, () => -logUniform(1e-3, 1e3)), many(3000, () => Math.floor(uniform(-40, 40)))),
    ...pairs(many(3000, () => logUniform(1e-300, 1e300)), many(3000, () => uniform(-3, 3))),
    ...pairs(many(1500, () => logUniform(5e-324, 1e-300)), many(1500, () => uniform(-1, 1))),
    ...pairs(many(2000, () => uniform(.999, 1.001)), many(2000, () => signed(logUniform(1, 1e12)))),
    ...pairs(many(2000, anyDouble), many(2000, anyDouble)), ...grid(powSpecial, powSpecial)];
  const cases = {
    sin: {math: 'math.sin', np: 'np.sin', args: angles.map(x => [x])},
    cos: {math: 'math.cos', np: 'np.cos', args: angles.map(x => [x])},
    atan: {math: 'math.atan', np: 'np.arctan', args: [...many(15000, () => signed(logUniform(1e-20, 1e20))), ...many(15000, () => uniform(-3, 3)),
      ...many(2000, anyDouble), ...SPECIAL].map(x => [x])},
    atan2: {math: 'math.atan2', np: 'np.arctan2', args: [
      ...pairs(many(15000, () => uniform(-1, 1)), many(15000, () => uniform(-1, 1))),
      ...pairs(many(10000, () => signed(logUniform(1e-30, 1e30))), many(10000, () => signed(logUniform(1e-30, 1e30)))),
      ...pairs(many(3000, anyDouble), many(3000, anyDouble)), ...grid(SPECIAL, SPECIAL)]},
    exp: {math: 'math.exp', np: 'np.exp', args: [...many(25000, () => uniform(-750, 710)), ...many(8000, () => uniform(-2, 2)),
      ...many(3000, () => signed(logUniform(1e-20, 1))), ...many(3000, () => uniform(-745.2, -708)), ...many(1000, () => uniform(709, 709.8)),
      ...near(709.782712893384, 20), ...near(-745.1332191019411, 20), ...near(-708.3964185322641, 20), ...many(2000, anyDouble), ...SPECIAL].map(x => [x])},
    exp2: {math: 'math.exp2', np: 'np.exp2', args: [...many(20000, () => uniform(-1080, 1030)), ...many(8000, () => Math.floor(uniform(-1200, 1200)) / 12),
      ...many(5000, () => uniform(-2, 2)), ...many(3000, () => uniform(-1076, -1020)), ...many(2000, () => signed(logUniform(1e-20, 1))),
      ...near(1024, 10), ...near(-1022, 10), ...near(-1074, 10), ...near(-1075, 10), ...near(928, 10), ...many(2000, anyDouble), ...SPECIAL].map(x => [x])},
    log: {math: 'math.log', np: 'np.log', args: logArgs.map(x => [x])},
    log2: {math: 'math.log2', np: 'np.log2', args: logArgs.map(x => [x])},
    log1p: {math: 'math.log1p', np: 'np.log1p', args: [...logArgs, ...many(10000, () => uniform(-1, 1)), ...many(4000, () => signed(logUniform(1e-20, 1))),
      ...near(-1, 10)].map(x => [x])},
    pow: {math: 'math.pow', np: 'np.power', extra: 'lambda x, y: x ** y', args: powArgs},
    cbrt: {math: 'math.cbrt', np: 'np.cbrt', args: [...many(15000, () => signed(logUniform(5e-324, 1.7e308))), ...many(10000, () => uniform(-30, 30)),
      ...many(3000, () => signed(logUniform(5e-324, 2.2e-308))), ...many(3000, anyDouble), ...many(200, (_, k) => k - 100), ...SPECIAL].map(x => [x])},
    tanh: {math: 'math.tanh', np: 'np.tanh', args: [...many(15000, () => uniform(-25, 25)), ...many(10000, () => uniform(-1, 1)),
      ...many(4000, () => signed(logUniform(1e-310, 1))), ...near(.5493061443340549, 20), ...near(.25541281188299536, 20), ...near(20, 10),
      ...many(2000, anyDouble), ...SPECIAL].map(x => [x])},
    expm1: {math: 'math.expm1', np: 'np.expm1', args: [...many(15000, () => uniform(-60, 712)), ...many(10000, () => uniform(-2, 2)),
      ...many(5000, () => signed(logUniform(1e-20, 1))), ...near(709.782712893384, 10), ...near(38.816242111356935, 10), ...many(2000, anyDouble), ...SPECIAL].map(x => [x])},
    // CPython 3.12's math.hypot is its own vector_norm, not libm's hypot: compared for information only.
    hypot: {math: 'math.hypot', np: 'np.hypot', informational: 'math.hypot', args: [
      ...pairs(many(15000, () => uniform(-10, 10)), many(15000, () => uniform(-10, 10))),
      ...pairs(many(8000, () => signed(logUniform(1e-300, 1e300))), many(8000, () => signed(logUniform(1e-300, 1e300)))),
      ...pairs(many(3000, () => logUniform(1e150, 1.7e308)), many(3000, () => logUniform(1e-20, 1e308))),
      ...pairs(many(3000, () => logUniform(5e-324, 1e-150)), many(3000, () => logUniform(5e-324, 1e-150))),
      ...pairs(many(3000, anyDouble), many(3000, anyDouble)), ...grid(SPECIAL, SPECIAL)]},
  };
  const code = `
import json, math, struct, numpy as np
d = json.loads(payload)
args = [np.array([int(h, 16) for h in col], dtype=np.uint64).view(np.float64) for col in d['args']]
enc = lambda v: '%016x' % struct.unpack('>Q', struct.pack('>d', v))[0]
def scalar(fn):
    out = []
    for vals in zip(*[a.tolist() for a in args]):
        try:
            r = fn(*vals)
        except (ValueError, OverflowError, ZeroDivisionError):
            r = None
        out.append(enc(r) if isinstance(r, float) else None)
    return out`;
  const failures = [];
  for (const [name, c] of Object.entries(cases)) {
    const fn = libm[name], n = c.args.length, arity = c.args[0].length;
    const columns = Array.from({length: arity}, (_, j) => c.args.map(a => hex(a[j])));
    py.globals.set('payload', JSON.stringify({args: columns}));
    const out = JSON.parse(py.runPython(`${code}
with np.errstate(all='ignore'):
    vec = ['%016x' % v for v in ${c.np}(*args).view(np.uint64).tolist()]
json.dumps({'math': scalar(${c.math}), 'np': vec${c.extra ? `, 'extra': scalar(${c.extra})` : ''}})`));
    const refs = {[c.math]: out.math, [c.np]: out.np, ...(c.extra ? {'x ** y': out.extra} : {})};
    const got = c.args.map(a => fn(...a.map(v => unhex(hex(v)))));
    const summary = [];
    let npVsMath = 0;
    for (const [ref, values] of Object.entries(refs)) {
      let checked = 0, bad = 0;
      values.forEach((h, i) => {
        if (h === null) return;
        checked++;
        if (!same(got[i], unhex(h))) {
          bad++;
          if (bad <= 5 && ref !== c.informational) failures.push(`${name}(${c.args[i].map(v => `${v} [${hex(v)}]`).join(', ')}) = ${got[i]} [${hex(got[i])}], ${ref} gives ${unhex(h)} [${h}]`);
        }
      });
      summary.push(`${ref} ${checked - bad}/${checked}${ref === c.informational ? ' (informational)' : ''}`);
      if (bad && ref !== c.informational) failures.push(`${name}: ${bad} of ${checked} differ from ${ref}`);
    }
    out.math.forEach((h, i) => { if (h !== null && !same(unhex(h), unhex(out.np[i]))) npVsMath++; });
    console.log(`${name}: ${n} inputs, bit-exact vs ${summary.join(', ')}; ${c.np} vs ${c.math}: ${npVsMath ? npVsMath + ' differ' : 'identical'}`);
  }
  assert.deepEqual(failures, []);
  console.log('libm parity: all functions bit-exact');
})().catch(error => { console.error(error); process.exitCode = 1; });
