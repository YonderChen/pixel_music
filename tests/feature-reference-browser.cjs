const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const output='/private/tmp/pixelmusic-features-qa';fs.mkdirSync(output,{recursive:true});
const report={status:'running',errors:[],checks:[],renders:[],subjectivelyApproved:false};
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
 try{
  const page=await browser.newPage({viewport:{width:1365,height:1120},acceptDownloads:true});
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('response',r=>{if(r.status()>=400&&!r.url().endsWith('favicon.ico'))report.errors.push(r.status()+' '+r.url());});
  const response=await page.goto('http://127.0.0.1:4176/feature-music.html');assert.equal(response.status(),200);
  const ready=async()=>page.waitForFunction(()=>window.PixelMusicFeaturesDemo?.payload()&&!window.PixelMusicFeaturesDemo.snapshot().busy&&!document.querySelector('#play').disabled,{},{timeout:90000});
  await ready();
  let data=await page.evaluate(()=>window.PixelMusicFeaturesDemo.payload());
  assert.equal(data.settings.synth,'Simple');assert.match(data.variants.features.backend,/Simple procedural synthesizer/);
  assert.equal(await page.locator('.region').count(),data.variants.features.regions.length);
  await page.screenshot({path:path.join(output,'desktop.png'),fullPage:true});
  await page.click('#play');await page.waitForFunction(()=>window.PixelMusicFeaturesDemo.snapshot().playing);await page.waitForTimeout(180);await page.click('#play');
  const paused=await page.evaluate(()=>window.PixelMusicFeaturesDemo.snapshot().time);await page.waitForTimeout(150);assert.equal(await page.evaluate(()=>window.PixelMusicFeaturesDemo.snapshot().time),paused);
  await page.click('#play');await page.waitForFunction(()=>window.PixelMusicFeaturesDemo.snapshot().playing);
  await page.evaluate(()=>{const el=document.querySelector('#seek');el.value='5';el.dispatchEvent(new Event('input'));el.dispatchEvent(new Event('change'));});
  await page.waitForFunction(()=>window.PixelMusicFeaturesDemo.snapshot().playing&&window.PixelMusicFeaturesDemo.snapshot().time>=5);
  const sync=await page.evaluate(()=>{const state=window.PixelMusicFeaturesDemo.snapshot(),p=window.PixelMusicFeaturesDemo.payload();return {state,actual:[...document.querySelectorAll('.region.active')].map(b=>b.dataset.region).sort(),expected:p.variants.features.events.filter(e=>e.layer==='main'&&state.time>=e.start&&state.time<e.start+e.duration).flatMap(e=>e.sources.map(s=>s.regionId)).sort()};});
  assert.deepEqual(sync.actual,sync.expected);await page.click('#play');
  await page.locator('.region[data-index="10"]').click();await page.waitForTimeout(500);
  assert.match(await page.locator('#selectedFeatures').textContent(),/色相.*饱和.*亮度.*对比.*纹理/);
  report.checks.push('real playback / pause-resume / seeking / source highlights / cell preview');
  await page.click('#abFeatures');await page.waitForFunction(()=>window.PixelMusicFeaturesDemo.snapshot().playing);
  assert.equal(await page.locator('#seek').getAttribute('max'),'12');
  const match=await page.evaluate(()=>window.PixelMusicFeaturesDemo.snapshot().comparison);assert.ok(match.matched&&match.gain<=1);
  await page.click('#play');await page.click('#play');await page.waitForFunction(()=>window.PixelMusicFeaturesDemo.snapshot().playing);
  await page.evaluate(()=>{const e=document.querySelector('#seek');e.value='11.8';e.dispatchEvent(new Event('input'));e.dispatchEvent(new Event('change'));});
  await page.waitForFunction(()=>!window.PixelMusicFeaturesDemo.snapshot().playing&&document.querySelector('#status').textContent==='对照结束');
  await page.click('#abReference');await page.waitForFunction(()=>window.PixelMusicFeaturesDemo.snapshot().playing&&window.PixelMusicFeaturesDemo.snapshot().mode==='reference');
  await page.click('#play');await page.click('#featureMode');
  report.checks.push('same-picture original/feature comparison / RMS attenuation / retained 12-second boundary');
  for(const id of ['hue','texture','grass','white','black']){
   await page.selectOption('#sample',id);await ready();
   data=await page.evaluate(()=>window.PixelMusicFeaturesDemo.payload());
   assert.equal(await page.evaluate(()=>window.PixelMusicFeaturesDemo.snapshot().sample),id);
   const pitches=data.variants.features.events.filter(e=>e.layer==='main').map(e=>e.midi);
   if(id==='hue'||id==='texture')assert.ok(new Set(pitches).size>1,id+' should alter actual pitch');
   if(id==='white')assert.equal(data.variants.features.mainCount,1);
   if(id==='black')assert.equal(data.variants.features.mainCount,0);
   for(const mode of ['features','reference']){const m=data.variants[mode].metrics;assert.equal(m.invalid,0);assert.equal(m.clipped,0);assert.ok(m.peak<.98);}
   report.renders.push({sample:id,mainNotes:data.variants.features.mainCount,distinctPitches:new Set(pitches).size,metrics:data.variants.features.metrics});
  }
  await page.selectOption('#sample','hue');await ready();
  await page.uncheck('#backing');await ready();assert.deepEqual(Object.keys((await page.evaluate(()=>window.PixelMusicFeaturesDemo.payload())).variants.features.layerCounts),['main']);
  await page.selectOption('#tone','Simple');await ready();assert.equal((await page.evaluate(()=>window.PixelMusicFeaturesDemo.payload())).settings.synth,'Simple');
  await page.selectOption('#mappingStyle','Balanced');await ready();assert.equal((await page.evaluate(()=>window.PixelMusicFeaturesDemo.payload())).settings.mapping,'Balanced');
  await page.check('#backing');await ready();
  report.checks.push('horizontal colour / texture / pure colour / black / all settings use actual reference core');
  for(const type of ['image/png','image/jpeg','image/webp']){
   const encoded=await page.evaluate(type=>{const c=document.createElement('canvas');c.width=256;c.height=192;const ctx=c.getContext('2d');ctx.fillStyle='#ef8646';ctx.fillRect(0,0,128,192);ctx.fillStyle='#245e8a';ctx.fillRect(128,0,128,192);return c.toDataURL(type).split(',')[1];},type);
   const filename='全图验收.'+type.split('/')[1];await page.setInputFiles('#file',{name:filename,mimeType:type,buffer:Buffer.from(encoded,'base64')});await ready();
   await page.waitForFunction(filename=>document.querySelector('#workName').textContent===filename,filename);
   data=await page.evaluate(()=>window.PixelMusicFeaturesDemo.payload());assert.equal(data.image.width,256);assert.equal(data.image.height,192);
  }
  for(const mode of ['features','reference']){
   await page.click(mode==='features'?'#featureMode':'#referenceMode');
   const pending=page.waitForEvent('download');await page.click('#export');const download=await pending;
   const file=path.join(output,mode+'.wav');await download.saveAs(file);const bytes=fs.readFileSync(file);
   assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.readUInt16LE(22),2);assert.equal(bytes.readUInt32LE(24),44100);
   const payload=await page.evaluate(()=>window.PixelMusicFeaturesDemo.payload());assert.equal(require('node:crypto').createHash('sha256').update(bytes).digest('hex'),payload.variants[mode].wavSha256);
  }
  report.checks.push('whole uncropped PNG/JPEG/WEBP / real stereo 44.1kHz WAV downloads / downloaded bytes match rendered engine audio');
  await page.click('#featureMode');await page.setViewportSize({width:390,height:844});
  const sizes=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,stage:document.querySelector('#imageStage').getBoundingClientRect().width,region:document.querySelector('.region').getBoundingClientRect().width,cols:window.PixelMusicFeaturesDemo.payload().variants.features.cols}));
  assert.ok(sizes.scroll<=sizes.width);assert.ok(Math.abs(sizes.region/sizes.stage-1/sizes.cols)<.001);
  await page.evaluate(()=>{document.querySelector('#toast').hidden=true;});await page.screenshot({path:path.join(output,'mobile.png'),fullPage:true});
  const local=await browser.newPage();local.on('pageerror',e=>report.errors.push(e.message));
  await local.goto('file://'+path.resolve('dist/feature-music.html'));await local.waitForFunction(()=>window.PixelMusicFeaturesDemo?.payload()&&!window.PixelMusicFeaturesDemo.snapshot().busy,{},{timeout:90000});
  await local.click('#play');await local.waitForFunction(()=>window.PixelMusicFeaturesDemo.snapshot().playing);await local.click('#play');
  report.checks.push('mobile geometry / file page connects to running loopback engine and plays');
  assert.deepEqual(report.errors,[]);report.status='passed';
 }finally{await browser.close();fs.writeFileSync(path.join(output,'browser-report.json'),JSON.stringify(report,null,2)+'\n');}
 console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});
