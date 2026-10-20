/* image_analysis.py: brightness, colour, edges, Fourier texture and saliency features.
 * Views address a rectangle of a larger image without copying, because NumPy's sums
 * over a view add up in a different order than over a copy. */
(self.PixelMusicEngineModules = self.PixelMusicEngineModules || []).push(function (PM) {
  'use strict';
  const {np} = PM;
  const TAU = 2 * Math.PI;

  // A rectangle of an H x W image with `channels` interleaved values per pixel.
  function view(d, width, channels, y0 = 0, y1, x0 = 0, x1 = width) {
    const height = d.length / (width * channels);
    if (y1 === undefined) y1 = height;
    return {d, off: (y0 * width + x0) * channels, rows: y1 - y0, cols: x1 - x0, rs: width * channels, cs: channels};
  }
  const contiguous = (d, rows, cols, channels = 1) => ({d, off: 0, rows, cols, rs: cols * channels, cs: channels});
  // Copy one channel of a view into a contiguous array.
  function values(v, channel = 0) {
    const out = new Float64Array(v.rows * v.cols);
    let k = 0;
    for (let y = 0; y < v.rows; y++) {
      const base = v.off + y * v.rs + channel;
      for (let x = 0; x < v.cols; x++) out[k++] = v.d[base + x * v.cs];
    }
    return out;
  }
  const viewSum = (v, channel = 0) => np.sumView(v.d, v.off + channel, v.rows, v.cols, v.rs, v.cs);
  const viewMean = (v, channel = 0) => viewSum(v, channel) / (v.rows * v.cols);
  // np.std of a view: the mean in the view's order, the squares as a new contiguous array.
  function viewStd(v, channel = 0) {
    const n = v.rows * v.cols, m = viewMean(v, channel), x = values(v, channel);
    for (let i = 0; i < n; i++) { const d = x[i] - m; x[i] = d * d; }
    return Math.sqrt(np.sum(x) / n);
  }

  function luminance(rgb) {
    const n = rgb.length / 3, out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = .2126 * rgb[i * 3] + .7152 * rgb[i * 3 + 1] + .0722 * rgb[i * 3 + 2];
    return out;
  }

  // rgb_to_hsv_features(rgb, luminance); rgbView has 3 channels, light is a contiguous copy.
  function hsvFeatures(rgbView, light) {
    const n = rgbView.rows * rgbView.cols, r = values(rgbView, 0), g = values(rgbView, 1), b = values(rgbView, 2);
    const sat = new Float64Array(n), weights = new Float64Array(n), hue = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const mx = Math.max(Math.max(r[i], g[i]), b[i]), mn = Math.min(Math.min(r[i], g[i]), b[i]), diff = mx - mn;
      sat[i] = mx > 1e-12 ? diff / Math.max(mx, 1e-12) : 0;
      let h = 0;
      if (diff > 1e-12) {
        if (mx === b[i]) h = (r[i] - g[i]) / diff + 4;
        else if (mx === g[i]) h = (b[i] - r[i]) / diff + 2;
        else if (mx === r[i]) h = np.mod((g[i] - b[i]) / diff, 6);
      }
      hue[i] = np.mod(h / 6, 1);
      weights[i] = sat[i] * (.25 + light[i]);
    }
    const weightSum = np.sum(weights);
    let hueMean = 0;
    if (!(weightSum <= 1e-12)) {
      const s = new Float64Array(n), c = new Float64Array(n);
      // Hues repeat a lot (8-bit colours), so sin and cos are cached per angle.
      const trig = new Map();
      for (let i = 0; i < n; i++) {
        const angle = TAU * hue[i];
        let sc = trig.get(angle);
        if (sc === undefined) { sc = [PM.libm.sin(angle), PM.libm.cos(angle)]; trig.set(angle, sc); }
        s[i] = weights[i] * sc[0]; c[i] = weights[i] * sc[1];
      }
      hueMean = np.mod(PM.libm.atan2(np.sum(s), np.sum(c)) / TAU, 1);
    }
    return {mean_saturation: np.mean(sat), dominant_hue: hueMean, warmth: viewMean(rgbView, 0) - viewMean(rgbView, 2)};
  }

  // compute_edge_map(luminance) on a contiguous h x w array: [normalized magnitude, density].
  function edgeMap(light, h, w) {
    const [gy, gx] = np.gradient(light, h, w), mag = new Float64Array(h * w);
    for (let i = 0; i < mag.length; i++) mag[i] = Math.sqrt(gx[i] * gx[i] + gy[i] * gy[i]);
    const norm = np.normalize01(mag), threshold = np.percentile(norm, 75), cut = Math.max(.08, threshold);
    let count = 0;
    for (let i = 0; i < norm.length; i++) if (norm[i] > cut) count++;
    return [norm, count / norm.length];
  }

  const EDGES64 = np.linspace(0, 1, 65);
  function histogramEntropy(data, bins = 64) {
    const edges = bins === 64 ? EDGES64 : np.linspace(0, 1, bins + 1), hist = new Float64Array(bins);
    for (let i = 0; i < data.length; i++) {
      const a = data[i];
      if (!(a >= 0 && a <= 1)) continue;
      let index = Math.trunc((a - 0) / 1 * bins);
      if (index === bins) index -= 1;
      if (a < edges[index]) index -= 1;
      if (a >= edges[index + 1] && index !== bins - 1) index += 1;
      hist[index] += 1;
    }
    const total = np.sum(hist);
    if (total <= 1e-12) return 0;
    const terms = [];
    for (const count of hist) if (count / total > 0) { const p = count / total; terms.push(p * PM.libm.log2(p)); }
    if (terms.length <= 1) return 0;
    return np.clamp(-np.sum(terms) / PM.libm.log2(bins), 0, 1);
  }

  function centerOfMass(weight, h, w) {
    const total = np.sum(weight);
    if (total <= 1e-12) return [.5, .5];
    const xs = new Float64Array(h * w), ys = new Float64Array(h * w);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; xs[i] = x * weight[i]; ys[i] = y * weight[i]; }
    return [np.sum(xs) / total / Math.max(1, w - 1), np.sum(ys) / total / Math.max(1, h - 1)];
  }

  function symmetry(light, h, w) {
    const lr = new Float64Array(h * w), tb = new Float64Array(h * w);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      lr[i] = Math.abs(light[i] - light[y * w + (w - 1 - x)]);
      tb[i] = Math.abs(light[i] - light[(h - 1 - y) * w + x]);
    }
    return np.clamp(.7 * (1 - np.mean(lr)) + .3 * (1 - np.mean(tb)), 0, 1);
  }

  function saliencyMap(rgb, light, edge, h, w) {
    const n = h * w, mean = [0, 0, 0];
    for (let i = 0; i < n; i++) { mean[0] += rgb[i * 3]; mean[1] += rgb[i * 3 + 1]; mean[2] += rgb[i * 3 + 2]; }
    for (let c = 0; c < 3; c++) mean[c] /= n;
    const distance = new Float64Array(n), lightDistance = new Float64Array(n), lightMean = np.mean(light);
    for (let i = 0; i < n; i++) {
      const dr = rgb[i * 3] - mean[0], dg = rgb[i * 3 + 1] - mean[1], db = rgb[i * 3 + 2] - mean[2];
      distance[i] = Math.sqrt(dr * dr + dg * dg + db * db);
      lightDistance[i] = Math.abs(light[i] - lightMean);
    }
    const colorRarity = np.normalize01(distance), lightRarity = np.normalize01(lightDistance);
    const hueSat = hsvFeatures(contiguous(rgb, h, w, 3), light).mean_saturation;
    const total = 0 + .42 + .34 + .24, we = .42 / total, wc = .34 / total, wl = .24 / total;
    const edgeNorm = np.normalize01(edge), base = new Float64Array(n), centre = new Float64Array(n);
    const xn = new Float64Array(n), yn = new Float64Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      base[i] = we * edgeNorm[i] + wc * colorRarity[i] + wl * lightRarity[i];
      xn[i] = x / Math.max(1, w - 1); yn[i] = y / Math.max(1, h - 1);
      const dx = xn[i] - .5, dy = yn[i] - .5;
      centre[i] = Math.sqrt(dx * dx + dy * dy);
    }
    const centreNorm = np.normalize01(centre), mixed = new Float64Array(n);
    for (let i = 0; i < n; i++) mixed[i] = (1 - .12) * base[i] + .12 * (1 - centreNorm[i]);
    const saliency = np.normalize01(mixed);
    const threshold = Math.max(.2, np.percentile(saliency, 96)), weight = new Float64Array(n);
    let area = 0, peak = -Infinity;
    for (let i = 0; i < n; i++) {
      if (saliency[i] >= threshold) { weight[i] = saliency[i]; area++; }
      if (saliency[i] > peak) peak = saliency[i];
    }
    const [cx, cy] = centerOfMass(weight, h, w), weightSum = np.sum(weight);
    let spread = 0;
    if (!(weightSum <= 1e-12)) {
      const terms = new Float64Array(n);
      for (let i = 0; i < n; i++) { const dx = xn[i] - cx, dy = yn[i] - cy; terms[i] = weight[i] * (dx * dx + dy * dy); }
      spread = Math.sqrt(np.sum(terms) / (np.sum(weight) + 1e-12));
    }
    return [saliency, {saliency_peak: n ? peak : 0, saliency_mean: n ? np.mean(saliency) : 0, saliency_area: n ? area / n : 0,
      saliency_centroid_x: cx, saliency_centroid_y: cy, saliency_spread: np.clamp(spread / .45, 0, 1), saliency_colorfulness: hueSat}];
  }

  function fftFreqShifted(n) {
    const out = new Float64Array(n), val = 1 / n, half = (n - 1 >> 1) + 1, shift = n >> 1;
    for (let i = 0; i < n; i++) {
      const k = i < half ? i : i - n; // fftfreq order
      out[(i + shift) % n] = k * val;
    }
    return out;
  }

  // The frequency grid of an h x w spectrum depends only on its size: normalized radius
  // and the horizontal / vertical direction masks, cached because bands repeat sizes.
  const GRIDS = new Map();
  function frequencyGrid(h, w) {
    const key = h + 'x' + w;
    let grid = GRIDS.get(key);
    if (grid) return grid;
    const fy = fftFreqShifted(h), fx = fftFreqShifted(w), n = h * w;
    const radius = new Float64Array(n), horizontal = new Uint8Array(n), vertical = new Uint8Array(n);
    let maxRadius = -Infinity;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, theta = PM.libm.atan2(fy[y], fx[x]);
      radius[i] = Math.sqrt(fx[x] * fx[x] + fy[y] * fy[y]);
      horizontal[i] = Math.abs(PM.libm.sin(theta)) < .38;
      vertical[i] = Math.abs(PM.libm.cos(theta)) < .38;
      if (radius[i] > maxRadius) maxRadius = radius[i];
    }
    const scale = Math.max(maxRadius, 1e-12);
    for (let i = 0; i < n; i++) radius[i] /= scale;
    if (GRIDS.size > 64) GRIDS.clear();
    grid = {r: radius, horizontal, vertical};
    GRIDS.set(key, grid);
    return grid;
  }

  // analyze_fourier(luminance) with random_factor 0, on a contiguous h x w array.
  // `mean` is the mean of the source view, which NumPy sums in its own order.
  function fourier(light, h, w, mean = np.mean(light)) {
    const wy = h > 1 ? np.hanning(h) : Float64Array.of(1), wx = w > 1 ? np.hanning(w) : Float64Array.of(1);
    const windowed = new Float64Array(h * w);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) windowed[y * w + x] = (light[y * w + x] - mean) * (wy[y] * wx[x]);
    const raw = PM.fft.fft2Magnitude(windowed, h, w);
    const sy = h >> 1, sx = w >> 1, n = h * w, power = new Float64Array(n), {r, horizontal: hMask, vertical: vMask} = frequencyGrid(h, w);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const m = raw[((y + h - sy) % h) * w + (x + w - sx) % w]; // fftshift
      power[y * w + x] = m * m;
    }
    for (let i = 0; i < n; i++) if (r[i] < .025) power[i] = 0;
    const total = Math.max(np.sum(power), 1e-12);
    const pick = test => { const out = []; for (let i = 0; i < n; i++) if (test(i)) out.push(power[i]); return out; };
    const low = np.sum(pick(i => r[i] >= .025 && r[i] < .14)) / total;
    const mid = np.sum(pick(i => r[i] >= .14 && r[i] < .34)) / total;
    const high = np.sum(pick(i => r[i] >= .34)) / total;
    const weighted = new Float64Array(n);
    for (let i = 0; i < n; i++) weighted[i] = r[i] * power[i];
    const centroid = np.sum(weighted) / total;
    for (let i = 0; i < n; i++) { const d = r[i] - centroid; weighted[i] = d * d * power[i]; }
    const bandwidth = Math.sqrt(np.sum(weighted) / total);
    const horizontal = np.sum(pick(i => hMask[i])) / total;
    const vertical = np.sum(pick(i => vMask[i])) / total;
    const valid = pick(i => power[i] > 0);
    let peak = 0;
    if (valid.length) {
      const [lo, hi] = np.percentiles(valid, [90, 99.7]);
      peak = np.clamp(PM.libm.log1p(hi / (lo + 1e-12)) / 5, 0, 1);
    }
    return {low_frequency_energy: low, mid_frequency_energy: mid, high_frequency_energy: high, fourier_centroid: centroid,
      fourier_bandwidth: bandwidth, horizontal_frequency_energy: horizontal, vertical_frequency_energy: vertical,
      diagonal_frequency_energy: np.clamp(1 - horizontal - vertical, 0, 1), periodic_peak_score: peak, fourier_noise_sigma: 0};
  }

  // analyze_image(image, random_factor=0) on packed RGB bytes.
  function analyzeImage(pixels, width, height) {
    const {rgb, width: w, height: h} = PM.image.toRgbArray(pixels, width, height);
    const light = luminance(rgb), n = h * w;
    const [pLow, pHigh] = np.percentiles(light, [5, 95]);
    const shadowCut = Math.max(.18, pLow + .03), highlightCut = Math.min(.82, pHigh - .03);
    const [edge, edgeDensity] = edgeMap(light, h, w);
    const entropy = histogramEntropy(edge, 64);
    const spectrum = fourier(light, h, w);
    const hsv = hsvFeatures(contiguous(rgb, h, w, 3), light);
    const [saliency, saliencyFeatures] = saliencyMap(rgb, light, edge, h, w);
    const meanLight = np.mean(light);
    const bright = new Float64Array(n), shadowWeight = new Float64Array(n), highWeight = new Float64Array(n);
    let shadows = 0, highlights = 0;
    for (let i = 0; i < n; i++) {
      bright[i] = Math.max(light[i] - meanLight, 0);
      if (light[i] < shadowCut) { shadowWeight[i] = 1 - light[i]; shadows++; }
      if (light[i] > highlightCut) { highWeight[i] = light[i]; highlights++; }
    }
    const sym = symmetry(light, h, w);
    const features = {analysis_width: w, analysis_height: h, mean_brightness: meanLight, contrast: np.std(light),
      dynamic_range: pHigh - pLow, shadow_proportion: shadows / n, highlight_proportion: highlights / n, edge_density: edgeDensity,
      texture_entropy: entropy, symmetry_score: sym,
      auto_complexity: np.clamp(.25 + (.9 - .25) * entropy, .25, .9),
      auto_variation_strength: np.clamp(.25 + (.85 - .25) * (1 - sym), .25, .85),
      bright_centroid_x: centerOfMass(bright, h, w)[0], shadow_centroid_x: centerOfMass(shadowWeight, h, w)[0],
      highlight_centroid_x: centerOfMass(highWeight, h, w)[0], image_noise_sigma: 0, ...hsv, ...saliencyFeatures, ...spectrum};
    return {features, maps: {rgb, luminance: light, edge_map: edge, saliency_map: saliency, width: w, height: h}};
  }

  PM.analysis = {view, contiguous, values, viewSum, viewMean, viewStd, luminance, hsvFeatures, edgeMap, histogramEntropy, centerOfMass,
    symmetry, saliencyMap, fourier, analyzeImage};
});
