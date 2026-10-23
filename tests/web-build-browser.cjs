/* Optional end-to-end check of the actual HTML delivery. Uses a temporary browser
 * profile and a loopback-only static server; no login or external services. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const root=path.resolve(__dirname,'../build/html'),output=path.resolve(__dirname,'../build/verification');
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.mid':'audio/midi'};
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname==='/'?'/index.html':new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404);res.end();}else{res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');res.end(bytes);}});});
(async()=>{
  fs.mkdirSync(output,{recursive:true});await new Promise((resolve,reject)=>{server.on('error',reject);server.listen(0,'127.0.0.1',resolve);});let browser;
  const errors=[],checks=[];
  try{
    browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
    const page=await browser.newPage({viewport:{width:1280,height:900},acceptDownloads:true});page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.PixelMusicFeaturesDemo?.payload()&&!window.PixelMusicFeaturesDemo.snapshot().busy);
    assert.equal(await page.evaluate(()=>window.PixelMusicFeaturesDemo.payload().mood.name),'紧张');checks.push('built HTML generates a score with the real Blob Worker');
    await page.click('#play');await page.waitForFunction(()=>window.PixelMusicFeaturesDemo.snapshot().playing,{},{timeout:60000});await page.click('#play');checks.push('generated audio decodes and plays');
    const downloadPromise=page.waitForEvent('download');await page.click('#export');const download=await downloadPromise;await download.saveAs(path.join(output,'html-export.wav'));assert.equal(fs.readFileSync(path.join(output,'html-export.wav')).toString('ascii',0,4),'RIFF');checks.push('WAV download');
    const popupPromise=page.waitForEvent('popup');await page.click('#musicArt');const art=await popupPromise;art.on('pageerror',e=>errors.push(e.message));await art.waitForFunction(()=>window.PixelMusicArtDemo?.snapshot().score==='current'&&!document.getElementById('audioChoice').hidden);
    assert.equal(await art.locator('#audioMode').inputValue(),'original');await art.click('#play');await art.waitForFunction(()=>window.PixelMusicArtDemo.snapshot().playing,{},{timeout:60000});await art.click('#play');
    const pngPromise=art.waitForEvent('download');await art.click('#png');const png=await pngPromise;await png.saveAs(path.join(output,'html-art.png'));const bytes=fs.readFileSync(path.join(output,'html-art.png'));assert.equal(bytes.readUInt32BE(16),2400);assert.equal(bytes.readUInt32BE(20),1800);checks.push('current score transfer, art playback and 2400×1800 PNG export');
    await page.screenshot({path:path.join(output,'html-studio.png'),fullPage:true});await art.screenshot({path:path.join(output,'html-art-page.png'),fullPage:true});
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'html-browser.json'),JSON.stringify({status:'passed',checks,errors},null,2)+'\n');console.log(checks.join('\n'));
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
