# Browser runtime sources

The frontend contains all runtime assets locally. No CDN is required at run time.

| Component | Version / source | License |
| --- | --- | --- |
| Photo Sonification rules | [trungtin-dinh/photo_sonification](https://github.com/trungtin-dinh/photo_sonification), commit `667d97c1e68de56fe2f5ef2d26784ee8a7308f3f` | MIT; vendor/LICENSE.photo-sonification.txt |
| Pyodide | [pyodide/pyodide](https://github.com/pyodide/pyodide/tree/0.27.7), 0.27.7; fixed release assets from cdn.jsdelivr.net/pyodide/v0.27.7/full/ | MPL 2.0; vendor/LICENSE.pyodide.txt |
| CPython runtime | [python/cpython](https://github.com/python/cpython/tree/v3.12.7), 3.12.7 | PSF and included notices; vendor/LICENSE.cpython.txt |
| NumPy | [numpy/numpy](https://github.com/numpy/numpy), 2.0.2 Pyodide wheel | BSD and included notices; vendor/LICENSE.numpy.txt |
| Pillow | [python-pillow/Pillow](https://github.com/python-pillow/Pillow), 10.2.0 Pyodide wheel | HPND and included notices; vendor/LICENSE.pillow.txt |
| js-synthesizer | [jet2jet/js-synthesizer](https://github.com/jet2jet/js-synthesizer), npm 1.13.0 | BSD 3-Clause; vendor/LICENSE.js-synthesizer.txt |
| FluidSynth WASM | [jet2jet/fluidsynth-emscripten](https://github.com/jet2jet/fluidsynth-emscripten), 2.4.6 bundled with js-synthesizer 1.13.0 | LGPL 2.1; vendor/LICENSE.fluidsynth.txt |
| GeneralUser GS | [S. Christian Collins](https://www.schristiancollins.com/generaluser.php), existing unmodified 2.0.3 BETA bank | GeneralUser license v2.0; vendor/LICENSE-GeneralUser-GS.txt |

The static bundles encode unmodified runtime binaries as base64 so ordinary relative script tags can load them even from a local file URL. `sources-data.js` also contains the pinned source rules, existing project adapters, and the browser adapter. The repository's `scripts/package_browser_runtime.py` rebuilds these bundles and checks the Pyodide wheel hashes against its release lockfile. FluidSynth can be replaced by rebuilding `sources-data.js` with a compatible libfluidsynth.js. Upstream projects linked above provide the corresponding sources and build instructions.

Mixing and pitch transition design reference: [play_music_theory](https://playmusictheory.net/play). Its application code and sounds are not copied into this runtime.
