const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const inflate=require('../shared/inflate'),base64=require('../shared/base64'),{loadEngine}=require('./engine/harness.cjs'),{builtIn}=require('./engine/samples.cjs'),{host,fresh,context,root}=require('./helpers/miniprogram-host.cjs');
const mini=fresh(path.join(root,'workers/engine.js')),web=loadEngine(),Core=require('../dist/music-art-core');
const starry=()=>Buffer.from(builtIn().find(s=>s.name==='starry-night').base64,'base64');
function wav(bytes){const b=Buffer.from(bytes);assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.toString('ascii',8,12),'WAVE');assert.equal(b.readUInt32LE(4),b.length-8);assert.equal(b.readUInt32LE(24),44100);assert.equal(b.readUInt16LE(22),2);assert.ok(b.subarray(44).some(v=>v!==0),'audio is not silent');return b;}
test('portable inflate handles stored/fixed/dynamic blocks, long distances and corruption',()=>{
  const inputs=[Buffer.alloc(0),Buffer.from('图鸣hello'.repeat(12000)),Buffer.from(Array.from({length:200000},(_,i)=>(i*17+(i>>8))&255))];
  for(const input of inputs)for(const opts of [{level:0},{level:9},{strategy:zlib.constants.Z_FIXED}])assert.deepEqual(Buffer.from(inflate(zlib.deflateSync(input,opts))),input);
  const packed=zlib.deflateSync(inputs[1]);assert.throws(()=>inflate(packed,1024),/损坏/);assert.throws(()=>inflate(packed.subarray(0,packed.length-3)),/损坏/);const bad=Buffer.from(packed);bad[bad.length-1]^=1;assert.throws(()=>inflate(bad),/损坏/);
  for(const input of inputs){const encoded=base64.binaryBase64(input.toString('latin1'));assert.equal(encoded,input.toString('base64'));assert.deepEqual(Buffer.from(base64.decode(encoded)),input);}
});
test('delivered image engine matches web scores for all six combinations and region styles',async()=>{
  const file=starry(),image=await mini.handler.decodeFile(file);
  for(const method of ['regions','arranged','transition','reference-plus','reference','features']){
    const options={rowMethod:method,bars:4,rowCount:4,emotion:true,contourMusic:true};
    assert.deepEqual(mini.scores.prepareScores(image.pixels,image.width,image.height,options).payload,web.scores.prepareScores(image.pixels,image.width,image.height,options).payload,method);
  }
  for(const segmentMethod of ['grow','quadtree','slic'])for(const contourStyle of ['motif','grid','lines','sweep']){
    const options={rowMethod:'regions',bars:4,rowCount:2,emotion:true,segmentMethod,contourStyle,contourMusic:true};
    const {payload}=mini.scores.prepareScores(image.pixels,image.width,image.height,options);assert.ok(payload.variants.parallel.regions.length);assert.ok(payload.variants.parallel.events.every(e=>Number.isFinite(e.start)&&Number.isFinite(e.duration)));
  }
});
test('portable PNG inflate preserves browser pixels and Simple audio bytes',async()=>{
  const png=fs.readFileSync(path.resolve(__dirname,'../dist/icon-192.png'));assert.deepEqual(await mini.png.decode(png),await web.png.decode(png));
  const score=[{start:0,duration:.25,midi:60,velocity:.65,instrument:'soft_piano',pan:.2,layer:'main'}];
  assert.deepEqual(mini.render.renderScore(score,{duration:.5}).wav,web.render.renderScore(score,{duration:.5}).wav);
});
test('three art styles reuse the core SVG, render its paths and synthesize MIDI locally',()=>{
  const svg=require('../build/miniprogram/lib/svg-canvas'),renderer=require('../shared/art-audio'),classics=require('../build/miniprogram/lib/classics');
  for(const score of Core.samples())for(const style of ['ribbons','geometry','scroll']){const model=Core.scene(score,{style}),c=context();svg.draw(c,model.svg,1200,900);assert.ok(c.ops.length>100);assert.ok(c.ops.some(op=>op[0]==='fill'));}
  const midi=classics.samples()[0];const short=Core.normalize({...midi,duration:2,events:midi.events.filter(e=>e.start<1).map(e=>({...e,duration:Math.min(.4,e.duration)}))});const bytes=wav(renderer(short));assert.ok(bytes.length>=short.duration*44100*4);assert.throws(()=>renderer({...short,duration:181}),/3 分钟/);
});
test('studio runs image → score → WAV, tracks, comparison, preview and art transfer through wx RPC',async()=>{
  const h=host(),page=h.load('studio');
  try{
    await page.onReady();assert.equal(page.data.error,'');assert.equal(page.data.ready,true);assert.equal(page.data.mood.name,'紧张');assert.equal(page.data.tracks.length,4);
    await page.play();assert.equal(page.data.playing,true);assert.equal(page.data.loading,false);wav(fs.readFileSync(page.player.path));page.stop();
    page.toggleTrack({currentTarget:{dataset:{index:1}}});assert.equal(page.data.tracks[1].enabled,false);await page.exportWav();assert.equal(h.shared.length,1);wav(h.shared[0].bytes);
    await page.previewRegion(page.view().regions.findIndex(r=>r.eventId));assert.ok(page.previewSource);
    page.openArt();const score=h.app.globalData.currentScore;assert.equal(score.audioRef.kind,'browser-score');assert.ok(!JSON.stringify(score).includes('regionId'));assert.ok(h.calls.includes('/pages/art/index'));
    // Background cancellation discards the worker; later mixing restores its image
    // before requesting stems, rather than failing with an expired score key.
    require('../build/miniprogram/lib/engine').cancel();page.audioKey=null;await page.play();assert.equal(page.data.error,'');assert.equal(page.data.playing,true);assert.ok(h.workers.length>=2);page.stop();
    await page.compare({currentTarget:{dataset:{mode:'reference'}}});assert.equal(page.data.reference,true);page.onTime(12.1);assert.equal(page.data.playing,false);assert.equal(page.time,12);
    await page.compare({currentTarget:{dataset:{mode:'parallel'}}});assert.equal(page.data.reference,false);assert.equal(h.requests.filter(r=>r.path==='/api/rowmix').at(-1).data.profile,'soft');page.stop();
    assert.ok(h.surfaces.get('#picture').getContext().ops.some(o=>o[0]==='drawImage'));
  }finally{page.onUnload();h.clean();}
});
test('undeclared photo privacy scope does not block any built-in sample',async()=>{
  const h=host(),page=h.load('studio');let choices=0;
  h.wx.chooseMedia=options=>{choices++;assert.deepEqual(options.mediaType,['image']);assert.deepEqual(options.sourceType,['album','camera']);options.fail({errMsg:'chooseMedia:fail api scope is not declared in the privacy agreement'});};
  h.wx.authorize=()=>assert.fail('built-in samples must not request device permission');
  h.wx.requirePrivacyAuthorize=()=>assert.fail('built-in samples must not require privacy authorization');
  try{
    await page.onReady();assert.equal(choices,0);assert.equal(page.data.ready,true);
    const payload=page.payload,pathBefore=page.path;
    await page.chooseImage();assert.equal(choices,1);assert.equal(page.payload,payload);assert.equal(page.path,pathBefore);assert.equal(page.data.ready,true);
    assert.equal(page.data.status,'相册/拍照暂不可用');assert.match(page.data.error,/隐私声明/);assert.match(page.data.error,/内置样图/);
    for(let i=0;i<page.data.samples.length;i++){
      await page.changeSample({detail:{value:String(i)}});
      assert.equal(page.data.ready,true,page.data.samples[i].name);assert.equal(page.data.error,'');assert.equal(page.path,page.data.samples[i].path);assert.equal(page.data.name,page.data.samples[i].name);assert.ok(page.preview.bytes.byteLength>0);
    }
    assert.equal(choices,1,'sample changes never open the album/camera');
    const before={status:page.data.status,error:page.data.error,path:page.path};
    h.wx.chooseMedia=o=>o.fail({errMsg:'chooseMedia:fail cancel'});await page.chooseImage();assert.deepEqual({status:page.data.status,error:page.data.error,path:page.path},before);
    h.wx.chooseMedia=o=>o.success({tempFiles:[{tempFilePath:page.data.samples[0].path}]});await page.chooseImage();assert.equal(page.data.name,'我的图片');assert.equal(page.data.ready,true);assert.equal(page.data.error,'');
  }finally{page.onUnload();h.clean();}
});
test('regenerate retries a failed startup canvas query and then loads the preset',async()=>{
  const h=host(),page=h.load('studio'),createQuery=page.createSelectorQuery;let attempts=0;
  page.createSelectorQuery=function(){if(attempts++===0)throw new Error('画布暂不可用');return createQuery.call(this);};
  try{
    await page.onReady();assert.equal(page.data.ready,false);assert.equal(page.data.busy,false);assert.match(page.data.error,/画布暂不可用/);assert.equal(page.decodeSurface,undefined);
    await page.generate();assert.equal(page.data.ready,true);assert.equal(page.data.error,'');assert.ok(page.preview.bytes.byteLength>0);assert.ok(page.surface);assert.equal(page.data.mood.name,'紧张');
  }finally{page.onUnload();h.clean();}
});
test('preset files and Canvas fallback pixels survive native Worker binary serialization',async()=>{
  // A JSON-style bridge loses TypedArray methods and length. ArrayBuffer remains
  // binary; testing only structuredClone would miss this native compatibility bug.
  function nativeClone(value){
    if(value instanceof ArrayBuffer)return value.slice(0);
    if(ArrayBuffer.isView(value))return Object.fromEntries(Object.entries(value));
    if(Array.isArray(value))return value.map(nativeClone);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,nativeClone(v)]));
    return value;
  }
  const h=host({workerClone:nativeClone}),page=h.load('studio');
  try{
    await page.onReady();assert.equal(page.data.ready,true);assert.equal(page.data.error,'');assert.equal(page.data.mood.name,'紧张');
    assert.ok(h.requests.find(r=>r.path==='/api/generate').data.file instanceof ArrayBuffer);assert.ok(page.preview.bytes.byteLength>0);
    h.wx.getImageInfo=o=>o.success({width:5000,height:4000});await page.generate();
    assert.equal(page.data.ready,true);assert.equal(page.data.error,'');assert.ok(h.requests.filter(r=>r.path==='/api/generate').at(-1).data.pixels instanceof ArrayBuffer);assert.ok(page.preview.bytes.byteLength>0);
  }finally{page.onUnload();h.clean();}
});
test('art page handles current original audio, all styles, exports and imported MIDI',async()=>{
  const h=host();
  const image=await mini.handler.handle('/api/generate',{file:starry(),key:'art',options:{rowMethod:'regions',bars:4,emotion:true}});
  h.app.globalData.currentScore=Core.fromPerformance(image.data,{mode:'parallel',profile:'soft',rows:[true,true,true,true],backing:true,title:'当前图片'});
  const page=h.load('art');
  try{
    await page.onReady();assert.equal(page.data.error,'');assert.equal(page.data.hasOriginal,true);assert.equal(page.data.library.length,10);
    await page.play();assert.equal(page.data.playing,true);wav(fs.readFileSync(page.player.path));page.stop();
    for(const i of [1,2,0])page.changeVisual({currentTarget:{dataset:{key:'styleIndex'}},detail:{value:i}});assert.equal(page.data.error,'');
    await page.exportSvg();await page.exportScore();assert.ok(h.shared[0].bytes.toString().startsWith('<svg'));assert.equal(JSON.parse(h.shared[1].bytes).audioRef.kind,'browser-score');
    await page.savePng();assert.ok(h.calls.includes('album'));
    page.select(1);assert.equal(page.data.hasMidi,true);await page.exportMidi();assert.equal(h.shared.at(-1).bytes.toString('ascii',0,4),'MThd');
    const fixture=path.resolve(__dirname,'fixtures/music-art-validation.mid');h.wx.chooseMessageFile=o=>o.success({tempFiles:[{path:fixture,size:fs.statSync(fixture).size,name:'测试.mid'}]});
    const read=h.wx.getFileSystemManager().readFile;h.wx.getFileSystemManager().readFile=o=>o.filePath===fixture?o.success({data:fs.readFileSync(fixture)}):read(o);
    await page.importScore();assert.equal(page.data.error,'');assert.equal(page.score.title,'测试');assert.equal(page.data.noteCount,3);await page.play();assert.equal(page.data.playing,true);wav(fs.readFileSync(page.player.path));
  }finally{page.onUnload();h.clean();}
});
test('worker cancellation rejects pending operations and permits regeneration',async()=>{
  const h=host();try{const e=require('../build/miniprogram/lib/engine');const request=e.request('/api/generate',{file:starry(),key:'cancel',options:{rowMethod:'regions',bars:4}});e.cancel();await assert.rejects(request,/取消/);const next=await e.request('/api/generate',{file:starry(),key:'next',options:{rowMethod:'regions',bars:4}});assert.equal(next.data.key,'next');}finally{h.clean();}
});
test('worker failures preserve the computation stack for native debugging',async()=>{
  const h=host();try{
    const e=require('../build/miniprogram/lib/engine');await assert.rejects(e.request('/unknown'),error=>{
      assert.match(error.message,/未知浏览器计算操作/);assert.match(error.stack,/handle/);return true;
    });
  }finally{h.clean();}
});
