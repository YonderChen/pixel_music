// Local Chromium QA: no account, profile or external services are used.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const url = process.env.DEMO_URL || 'http://127.0.0.1:4175/dist/sonification.html';
const output = process.env.DEMO_QA_DIR || '/private/tmp/pixelmusic-strip-qa';
fs.mkdirSync(output, { recursive: true });
const report = { status: 'running', url, errors: [], audio: [], checks: [], screenshots: [], subjectivelyApproved: false };
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1365, height: 1100 }, acceptDownloads: true });
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) report.errors.push(`${response.status()} ${response.url()}`); });
    const response = await page.goto(url); if (response) assert.equal(response.status(), 200);
    await page.waitForFunction(() => window.PixelMusicStripDemo?.scores().strip && !document.querySelector('#play').disabled);
    const initial = await page.evaluate(() => window.PixelMusicStripDemo.snapshot());
    assert.equal(initial.sample, 'sunset'); assert.equal(initial.mode, 'strip');
    await page.screenshot({ path: path.join(output,'desktop.png'), fullPage: true }); report.screenshots.push('desktop.png');
    const sample = async id => {
      await page.selectOption('#sample', id);
      await page.waitForFunction(id => window.PixelMusicStripDemo.snapshot().sample === id && !document.querySelector('#play').disabled, id);
    };
    await sample('up');
    await page.click('#play'); await page.waitForFunction(() => window.PixelMusicStripDemo.snapshot().playing);
    await page.waitForTimeout(220); await page.click('#play');
    const paused = await page.evaluate(() => window.PixelMusicStripDemo.snapshot().time);
    await page.waitForTimeout(180); assert.equal(await page.evaluate(() => window.PixelMusicStripDemo.snapshot().time), paused);
    await page.click('#play'); await page.waitForFunction(() => window.PixelMusicStripDemo.snapshot().playing);
    assert.ok(await page.evaluate(p => window.PixelMusicStripDemo.snapshot().time >= p, paused));
    await page.evaluate(() => { const el = document.querySelector('#seek'); el.value = '8'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
    await page.waitForFunction(() => window.PixelMusicStripDemo.snapshot().playing && window.PixelMusicStripDemo.snapshot().time >= 8);
    await page.waitForTimeout(80);
    const sync = await page.evaluate(() => ({ state: window.PixelMusicStripDemo.snapshot(), active: [...document.querySelectorAll('.region.active')].map(el => el.dataset.region),
      scan: parseFloat(document.querySelector('#scan').style.left), note: document.querySelector('#currentNote').textContent }));
    assert.deepEqual(sync.active.sort(), sync.state.activeIds.sort()); assert.ok(sync.scan > 30 && sync.scan < 45);
    await page.click('#play');
    await page.evaluate(() => {
      const original = window.PixelMusicAudio.createSession;
      window.__previews = [];
      window.PixelMusicAudio.createSession = (...args) => {
        const session = original(...args), voice = session.voice;
        session.voice = (...params) => { window.__previews.push(params[0]); return voice(...params); }; return session;
      };
    });
    await page.locator('.region[data-index="10"]').click();
    await page.waitForFunction(() => window.__previews.length > 0);
    assert.equal(await page.evaluate(() => window.__previews.at(-1)), await page.evaluate(() => window.PixelMusicStripDemo.scores().strip.strips[10].midi));
    report.checks.push('pause freezes / resume / playing seek / audio-clock highlight / matching region preview');
    await page.click('#abStrip'); await page.waitForFunction(() => window.PixelMusicStripDemo.snapshot().playing && window.PixelMusicStripDemo.snapshot().comparison);
    const comparison = await page.evaluate(() => window.PixelMusicStripDemo.snapshot().comparison);
    assert.ok(comparison.matched);
    assert.ok(Math.abs(comparison.rms.strip * comparison.gains.strip - comparison.rms.old * comparison.gains.old) < 1e-8);
    assert.ok(comparison.gains.strip <= 1 && comparison.gains.old <= 1);
    await page.click('#play'); await page.click('#play');
    await page.waitForFunction(() => window.PixelMusicStripDemo.snapshot().playing);
    assert.equal(await page.locator('#seek').getAttribute('max'), '12');
    await page.evaluate(() => { const el=document.querySelector('#seek'); el.value='11.8'; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
    await page.waitForFunction(() => !window.PixelMusicStripDemo.snapshot().playing && document.querySelector('#status').textContent === '对照结束');
    assert.equal(await page.evaluate(() => window.PixelMusicStripDemo.snapshot().time), 12);
    await page.click('#abOld'); await page.waitForFunction(() => window.PixelMusicStripDemo.snapshot().mode === 'old' && window.PixelMusicStripDemo.snapshot().playing);
    await page.click('#backing'); await page.waitForFunction(() => window.PixelMusicStripDemo.snapshot().playing);
    await page.selectOption('#tone','glass'); await page.waitForFunction(() => window.PixelMusicStripDemo.snapshot().playing);
    await page.click('#stripMode'); assert.equal(await page.evaluate(() => window.PixelMusicStripDemo.snapshot().playing), false);
    await page.click('#abStrip'); await sample('down'); await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => window.PixelMusicStripDemo.snapshot().playing), false);
    report.checks.push('both comparison modes / RMS attenuation / comparison stays 12s after pause and seek / accompaniment and tone resume / cancelled preparation');
    await page.selectOption('#tone','warm'); if (!await page.isChecked('#backing')) await page.check('#backing');
    for (const id of ['sunset','grass','up','down','low','high','white','black']) {
      await sample(id);
      const metrics = await page.evaluate(async () => {
        const score = window.PixelMusicStripDemo.scores().strip, rows = [];
        for (const tone of ['warm','glass','mist']) {
          const buffer = await window.PixelMusicAudio.renderOffline(score, { tone, sampleRate: 22050 });
          rows.push({ tone, ...window.PixelMusicAudio.inspectBuffer(buffer) });
        }
        return { sample: window.PixelMusicStripDemo.snapshot().sample, notes: score.melody.length, rows };
      });
      for (const row of metrics.rows) {
        assert.equal(row.invalid, 0); assert.equal(row.clipped, 0); assert.ok(row.peak < .98); assert.ok(row.tailPeak < .001);
        if (id === 'black') assert.equal(row.rms, 0); else assert.ok(row.rms > .00001);
      }
      report.audio.push(metrics);
    }
    await page.locator('.region[data-index="0"]').click();
    await page.waitForTimeout(50); assert.match(await page.locator('#toast').textContent(), /休止/);
    await page.click('#abStrip'); await page.waitForFunction(() => window.PixelMusicStripDemo.snapshot().playing && window.PixelMusicStripDemo.snapshot().comparison);
    assert.equal(await page.evaluate(() => window.PixelMusicStripDemo.snapshot().comparison.matched), false);
    await page.click('#play');
    await sample('white'); await page.click('#play'); await page.waitForFunction(() => window.PixelMusicStripDemo.snapshot().playing);
    assert.equal(await page.locator('.region.active').count(), 32); await page.click('#play');
    report.checks.push('24 real OfflineAudio renders / silent black / no invented black pitch / merged-white sources');
    for (const type of ['image/png','image/jpeg','image/webp']) {
      const bytes = await page.evaluate(type => {
        const canvas = document.createElement('canvas'); canvas.width = 380; canvas.height = 240;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#234259'; ctx.fillRect(0,0,380,240);
        ctx.fillStyle = '#ffcf76'; ctx.beginPath(); ctx.arc(240,70,50,0,Math.PI*2); ctx.fill();
        return canvas.toDataURL(type).split(',')[1];
      }, type);
      const filename = `上传测试.${type.split('/')[1]}`;
      await page.setInputFiles('#file', { name: filename, mimeType: type, buffer: Buffer.from(bytes,'base64') });
      await page.waitForFunction(filename => window.PixelMusicStripDemo.snapshot().name === filename, filename);
      assert.equal(await page.evaluate(() => window.PixelMusicStripDemo.snapshot().sample), null);
    }
    const uploadHash = await page.evaluate(() => window.PixelMusicStripDemo.scores().strip.scoreHash);
    await page.click('#oldMode'); await page.click('#stripMode');
    assert.equal(await page.evaluate(() => window.PixelMusicStripDemo.scores().strip.scoreHash), uploadHash);
    const downloadPromise = page.waitForEvent('download'); await page.click('#export'); const download = await downloadPromise;
    const wavPath = path.join(output,'strip-demo.wav'); await download.saveAs(wavPath);
    const wav = fs.readFileSync(wavPath); assert.equal(wav.toString('ascii',0,4),'RIFF'); assert.equal(wav.length,44 + wav.readUInt32LE(40));
    report.checks.push('PNG/JPEG/WEBP uploads / stable score after mode switches / actual WAV download');
    await sample('up'); await page.click('#play'); await page.waitForFunction(() => window.PixelMusicStripDemo.snapshot().playing);
    await page.evaluate(() => { const el=document.querySelector('#seek'); el.value=String(Number(el.max)-.15); el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change')); });
    await page.waitForFunction(() => !window.PixelMusicStripDemo.snapshot().playing && document.querySelector('#status').textContent === '演奏结束');
    await page.click('#restart'); await page.waitForFunction(() => window.PixelMusicStripDemo.snapshot().playing);
    assert.ok(await page.evaluate(() => window.PixelMusicStripDemo.snapshot().time < 1)); await page.click('#play');
    await page.setViewportSize({ width: 390, height: 844 });
    const size = await page.evaluate(() => {
      const stage=document.querySelector('#imageStage').getBoundingClientRect(), button=document.querySelector('.region').getBoundingClientRect();
      return { scroll:document.documentElement.scrollWidth, viewport:innerWidth, fraction:button.width/stage.width };
    });
    assert.ok(size.scroll <= size.viewport); assert.ok(Math.abs(size.fraction - 1/32) < .001);
    await page.waitForTimeout(100); await page.evaluate(() => { document.querySelector('#toast').hidden=true; });
    await page.screenshot({ path:path.join(output,'mobile.png'), fullPage:true }); report.screenshots.push('mobile.png');
    report.checks.push('natural end / restart / mobile no overflow / source geometry after resize');
    const filePage = await browser.newPage();
    filePage.on('pageerror', error => report.errors.push(`file: ${error.message}`));
    await filePage.goto('file://' + path.resolve('dist/sonification.html'));
    await filePage.waitForFunction(() => window.PixelMusicStripDemo?.scores().strip && !document.querySelector('#play').disabled);
    await filePage.click('#play'); await filePage.waitForFunction(() => window.PixelMusicStripDemo.snapshot().playing);
    await filePage.click('#play');
    await filePage.selectOption('#sample','grass'); await filePage.waitForFunction(() => window.PixelMusicStripDemo.snapshot().sample === 'grass');
    await filePage.setInputFiles('#file', { name:'本地测试.png', mimeType:'image/png', buffer:fs.readFileSync(path.resolve('dist/sonification-assets/mars-sunset.png')) });
    await filePage.waitForFunction(() => window.PixelMusicStripDemo.snapshot().name === '本地测试.png');
    const fileDownloadPromise=filePage.waitForEvent('download'); await filePage.click('#export');
    const fileDownload=await fileDownloadPromise; await fileDownload.saveAs(path.join(output,'strip-demo-file.wav'));
    report.checks.push('direct file:// launch / both photos / uploaded image / real playback / actual WAV download');
    assert.deepEqual(report.errors, []);
    report.status = 'passed';
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(output,'browser-report.json'), JSON.stringify(report,null,2));
  }
  console.log(JSON.stringify({ status:report.status, checks:report.checks, realAudioRenders:report.audio.length*3, output }));
})().catch(error => { console.error(error); process.exitCode=1; });
