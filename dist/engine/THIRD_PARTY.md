# Browser engine sources

The image-to-music engine in this folder is plain JavaScript; nothing is downloaded at run time.
It reproduces the rules and numerics of the former in-browser Python engine (Pyodide 0.27.7,
NumPy 2.0.2, Pillow 10.2) so that scores come out the same. Ported or reimplemented work:

| Component | Used for | Source | License |
| --- | --- | --- | --- |
| Photo Sonification rules | image analysis, reference composition, Simple synthesizer | [trungtin-dinh/photo_sonification](https://github.com/trungtin-dinh/photo_sonification), commit `667d97c1e68de56fe2f5ef2d26784ee8a7308f3f` | MIT; licenses/LICENSE.photo-sonification.txt |
| musl libm | `libm.js`, the FFT twiddles and `hypot` in `fft.js` | [musl](https://musl.libc.org/), as built into Pyodide 0.27.7 | MIT and the Sun Microsystems notice; licenses/LICENSE.musl.txt |
| pocketfft (C++, NumPy 2.0 copy) | `fft.js` | [numpy/numpy `numpy/fft/pocketfft`](https://github.com/numpy/numpy/tree/v2.0.2/numpy/fft) | BSD 3-Clause; licenses/LICENSE.pocketfft.txt |
| NumPy | summation order, percentiles, `round`, `linspace`, `gradient`, `convolve` semantics in `core.js` | [numpy/numpy](https://github.com/numpy/numpy) 2.0.2 | BSD; licenses/LICENSE.numpy.txt |
| CPython | set iteration order, tuple hashing and `round` in `core.js` | [python/cpython](https://github.com/python/cpython/tree/v3.12.7) 3.12.7 | PSF; licenses/LICENSE.cpython.txt |
| Pillow | Lanczos resize in `image.js`; PNG modes, `convert('RGB')` and `exif_transpose` in `png.js` / `jpeg.js` | [python-pillow/Pillow](https://github.com/python-pillow/Pillow) 10.2.0 | HPND; licenses/LICENSE.pillow.txt |
| IJG libjpeg 9c | `jpeg.js` (IDCTs translated from `jidctint.c`; decoding pipeline reimplemented). This software is based in part on the work of the Independent JPEG Group. | [Independent JPEG Group](https://www.ijg.org/), jpegsrc.v9c as used by Emscripten's libjpeg port | IJG license; licenses/LICENSE.libjpeg.txt |

The project's own rules (`scripts/reference_music.py`, `arranger.py`, `segmentation.py`,
`region_music.py`, `soft_row_mixer.py`, `hover_preview.py`) are ported module by module.
The Python files, and the upstream Photo Sonification copy in `vendor/photo_sonification/`, were removed
from the repository after the port; the tests in `tests/engine/` read them from git history (commit `976de6f`).

Mixing and pitch transition design reference: [play_music_theory](https://playmusictheory.net/play). Its application code and sounds are not copied.
