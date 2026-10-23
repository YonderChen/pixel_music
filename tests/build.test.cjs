const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),os=require('node:os');
const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),html=path.join(root,'build/html'),mini=path.join(root,'build/miniprogram');
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
test('HTML delivery copies existing assets and both active pages resolve packaged resources',()=>{
  assert.equal(fs.readFileSync(path.join(html,'index.html'),'utf8'),fs.readFileSync(path.join(root,'dist/feature-music.html'),'utf8'));
  for(const file of files(path.join(root,'dist'))){if(file.endsWith('.DS_Store')||file.endsWith('/index.html'))continue;assert.deepEqual(fs.readFileSync(path.join(html,path.relative(path.join(root,'dist'),file))),fs.readFileSync(file));}
  for(const name of ['index.html','feature-music.html','music-art.html']){const page=path.join(html,name),text=fs.readFileSync(page,'utf8');for(const match of text.matchAll(/(?:src|href)="([^"#?]+)(?:[?#][^"]*)?"/g)){const value=match[1];if(/^(https?:|data:|blob:|mailto:)/.test(value))continue;assert.ok(fs.existsSync(path.resolve(path.dirname(page),value)),name+' → '+value);}}
});
test('mini program output is self-contained, below the package cap and has working assets',()=>{
  const config=JSON.parse(fs.readFileSync(path.join(mini,'project.config.json'))),app=JSON.parse(fs.readFileSync(path.join(mini,'app.json')));
  assert.equal(config.compileType,'miniprogram');assert.equal(config.appid,process.env.WECHAT_APPID||JSON.parse(fs.readFileSync(path.join(root,'miniprogram/project.config.json'))).appid);assert.equal(app.workers,'workers');
  const all=files(mini);assert.ok(all.reduce((n,p)=>n+fs.statSync(p).size,0)<2*1024*1024);
  for(const page of app.pages)for(const ext of ['js','json','wxml','wxss'])assert.ok(fs.existsSync(path.join(mini,page+'.'+ext)));
  for(const file of all.filter(p=>p.endsWith('.js'))){new vm.Script(fs.readFileSync(file,'utf8'),{filename:file});for(const m of fs.readFileSync(file,'utf8').matchAll(/require\(['"]([^'"]+)['"]\)/g)){assert.ok(m[1].startsWith('.'),'runtime has no npm dependency');assert.ok(fs.existsSync(path.resolve(path.dirname(file),m[1]+(path.extname(m[1])?'':'.js'))),file+' → '+m[1]);}}
  for(const sample of require('../build/miniprogram/lib/samples'))assert.ok(fs.existsSync(path.join(mini,sample.path)));
  for(const sample of require('../build/miniprogram/lib/classics').samples())assert.ok(fs.existsSync(path.join(mini,'classical-midi',sample.source.file)));
  for(const page of app.pages){const js=fs.readFileSync(path.join(mini,page+'.js'),'utf8'),view=fs.readFileSync(path.join(mini,page+'.wxml'),'utf8');for(const m of view.matchAll(/(?:bind\w+|catch\w+)="([a-zA-Z]\w*)"/g))assert.ok(new RegExp('\\b'+m[1]+'\\s*\\(').test(js),page+' handler '+m[1]);}
});
test('WeChat official WXML and WXSS compilers accept both pages when installed',t=>{
  const bin=process.env.WECHAT_COMPILER_DIR||'/Applications/wechatwebdevtools.app/Contents/Resources/app.asar.unpacked/node_modules/wcc-exec';
  if(!fs.existsSync(path.join(bin,'wcc'))){t.skip('Set WECHAT_COMPILER_DIR to the official compiler directory');return;}
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'pixel-wx-compile-'));
  try{execFileSync(path.join(bin,'wcc'),['-o',path.join(tmp,'wxml.js'),'pages/studio/index.wxml','pages/art/index.wxml'],{cwd:mini});execFileSync(path.join(bin,'wcsc'),['-o',path.join(tmp,'wxss.js'),'app.wxss','pages/studio/index.wxss','pages/art/index.wxss'],{cwd:mini});assert.ok(fs.statSync(path.join(tmp,'wxml.js')).size>10000);assert.ok(fs.statSync(path.join(tmp,'wxss.js')).size>1000);}finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
test('invalid targets and AppIDs fail without replacing a working delivery',()=>{
  const before=fs.readFileSync(path.join(mini,'project.config.json'),'utf8');
  assert.throws(()=>execFileSync(process.execPath,['scripts/build.cjs','invalid'],{cwd:root,stdio:'pipe'}),/Command failed/);
  assert.throws(()=>execFileSync(process.execPath,['scripts/build.cjs','miniprogram'],{cwd:root,env:{...process.env,WECHAT_APPID:'bad'},stdio:'pipe'}),/Command failed/);
  assert.equal(fs.readFileSync(path.join(mini,'project.config.json'),'utf8'),before);
});
test('browser Worker transfers keep cached WAVs intact for a later export',async()=>{
  const blobs=new Map();let sequence=0;
  class ObjectURL extends URL{static createObjectURL(blob){const url='blob:test-'+(++sequence);blobs.set(url,blob);return url;}static revokeObjectURL(){}}
  class Worker{
    constructor(url){this.self={postMessage:(message,transfer)=>{const data=structuredClone(message,{transfer});queueMicrotask(()=>this.onmessage({data}));}};this.ready=blobs.get(url).text().then(source=>vm.runInNewContext(source,{self:this.self}));}
    postMessage(data){this.ready.then(()=>this.self.onmessage({data}));}terminate(){}
  }
  const window={Worker},document={currentScript:{src:'https://example.invalid/browser-engine.js'},createElement:()=>({}),head:{appendChild(script){window.PixelMusicEngineModules=[function(PM){const bytes=new Uint8Array([82,73,70,70,1,2,3,4]);PM.handler={handle:async()=>({bytes})};}];queueMicrotask(()=>script.onload());}}};
  vm.runInNewContext(fs.readFileSync(path.join(html,'browser-engine.js'),'utf8'),{window,document,Worker,URL:ObjectURL,Blob,Response,DOMException,Map,Uint8Array,queueMicrotask});
  const first=await window.PixelMusicBrowser.request('/api/audio/cache/test.wav'),second=await window.PixelMusicBrowser.request('/api/audio/cache/test.wav');
  assert.deepEqual(Buffer.from(await first.arrayBuffer()),Buffer.from([82,73,70,70,1,2,3,4]));assert.deepEqual(Buffer.from(await second.arrayBuffer()),Buffer.from([82,73,70,70,1,2,3,4]));window.PixelMusicBrowser.reset();
});
