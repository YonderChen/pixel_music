# JavaScript engine parity tests

Each test runs the browser engine (`dist/engine/*.js`) next to the former Pyodide engine
(Python 3.12.7, NumPy 2.0.2, Pillow 10.2 with libjpeg 9c). `harness.cjs` takes the Pyodide runtime
and the original Python rules from Git history (commit `976de6f`) and caches the runtime in
`build/pyodide-oracle/`, so the tests need `git` and the full history, but no Python install. Inputs are the page's built-in samples
plus synthetic edge cases (`samples.cjs`).

| Test | Compares | Result when this engine landed |
| --- | --- | --- |
| `libm-parity` | sin, cos, exp, log, pow, atan2, ... against musl (NumPy and `math`) | bit-exact on tens of thousands of inputs each |
| `core-parity` | NumPy and CPython helpers (sums, percentiles, rounding, set order) | 157 checks exact |
| `jpeg-parity`, `png-parity` | decoded pixels against Pillow | 101 JPEG and 32 PNG files identical |
| `analysis-parity` | every image feature | bit-exact on all samples |
| `composition-parity` | the reference score | 45/45 identical |
| `segmentation-parity` | labels, regions, outlines | 90/90 identical |
| `scores-parity` | full `/api/generate` payloads, 32 recipes per image | 480/480 identical |
| `audio-parity` | every audio route (WAV samples, metrics, hover atlases) | at most 2/32767 apart |

Run one with `node tests/engine/<name>.test.cjs`; `scores-parity` and `audio-parity` take
several minutes and accept an image name filter as the first argument.
