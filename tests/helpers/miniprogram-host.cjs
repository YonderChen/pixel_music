/* Runs the delivered Page controllers and Worker RPC against a local wx test host.
 * It tests state and real engine/audio/file flow, not native device performance. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),os=require('node:os'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'../../build/miniprogram');
function fresh(file){const module={exports:{}};vm.compileFunction(fs.readFileSync(file,'utf8'),['require','module','exports'],{filename:file})(createRequire(file),module,module.exports);return module.exports;}
function context(){const ops=[];return new Proxy({ops,createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4).fill(120)})},{get(object,key){if(key in object)return object[key];return (...args)=>ops.push([key,...args]);}});}
function canvas(){const c=context();return {width:320,height:240,getContext:()=>c,createImage:()=>{const image={width:640,height:480};Object.defineProperty(image,'src',{set(){queueMicrotask(()=>image.onload());}});return image;}};}
function host({workerClone=structuredClone}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pixel-mini-')),shared=[],workers=[],audios=[],app={globalData:{currentScore:null}},surfaces=new Map(),calls=[],requests=[];
  function selectorQuery(page){let selector;const q={select(s){selector=s;return q;},fields(){return q;},exec(fn){let c=surfaces.get(selector);if(!c){c=canvas();surfaces.set(selector,c);}fn([{node:c,width:332,height:selector==='#picture'?page.data.stageHeight:selector==='#rhythm'?49.8:249,left:29,top:300}]);}};return q;}
  const packaged=p=>p.startsWith(dir)?p:path.join(root,p);
  const manager={mkdirSync:fs.mkdirSync.bind(fs),readdirSync:fs.readdirSync.bind(fs),unlinkSync:fs.unlinkSync.bind(fs),writeFile(o){fs.writeFile(o.filePath,typeof o.data==='string'?o.data:Buffer.from(o.data),error=>error?o.fail(error):o.success());},readFile(o){fs.readFile(packaged(o.filePath),(error,bytes)=>error?o.fail(error):o.success({data:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)}));}};
  // wx.mkdirSync's second argument is a recursive flag rather than Node's options.
  manager.mkdirSync=(p,recursive)=>fs.mkdirSync(p,{recursive});
  const wx={env:{USER_DATA_PATH:dir},getFileSystemManager:()=>manager,getWindowInfo:()=>({pixelRatio:1,windowWidth:390}),createOffscreenCanvas:()=>canvas(),
    createSelectorQuery(){throw new Error('Canvas helpers must use the Page instance query');},
    getImageInfo(o){o.success({width:512,height:400});},
    createWorker(){const engine=fresh(path.join(root,'workers/engine.js'));let receive,send,terminated=false;
      const native={onMessage(fn){receive=fn;},postMessage(value){if(!terminated)queueMicrotask(()=>send&&send(workerClone(value)));}};
      vm.compileFunction(fs.readFileSync(path.join(root,'workers/index.js'),'utf8'),['require','worker'],{filename:'worker'})(name=>name==='./engine'?engine:require(path.join(root,'workers',name)),native);
      const worker={onMessage(fn){send=fn;},onError(){},postMessage(value){calls.push(value.path);requests.push(structuredClone(value));if(!terminated)receive(workerClone(value));},terminate(){terminated=true;}};workers.push(worker);return worker;},
    createInnerAudioContext(){const callbacks={};const audio={currentTime:0,volume:1,loop:false,emit(event){callbacks[event]?.();},pause(){callbacks.Pause&&callbacks.Pause();},stop(){audio.currentTime=0;callbacks.Stop&&callbacks.Stop();},seek(t){audio.currentTime=t;},play(){callbacks.Play&&callbacks.Play();},destroy(){}};for(const event of ['TimeUpdate','Play','Pause','Stop','Ended','Error','Canplay'])audio['on'+event]=fn=>callbacks[event]=fn;Object.defineProperty(audio,'src',{get(){return audio.file;},set(v){audio.file=v;queueMicrotask(()=>callbacks.Canplay&&callbacks.Canplay());}});audios.push(audio);return audio;},
    createWebAudioContext(){return {state:'running',destination:{},decodeAudioData(bytes,resolve){resolve({duration:(bytes.byteLength-44)/176400});},createBufferSource(){return {connect(){},disconnect(){},start(){},stop(){}};},close(){}};},
    shareFileMessage(o){shared.push({name:o.fileName,bytes:fs.readFileSync(o.filePath)});o.success();},
    navigateTo(o){calls.push(o.url);},navigateBack(){calls.push('back');},redirectTo(o){calls.push(o.url);},
    canvasToTempFilePath(o){const file=path.join(dir,'export.png');fs.writeFileSync(file,Buffer.from([137,80,78,71]));o.success({tempFilePath:file});},saveImageToPhotosAlbum(o){calls.push('album');o.success();}
  };
  global.wx=wx;global.getApp=()=>app;global.getCurrentPages=()=>[{},{}];
  // Every host owns independent module state (not a worker left over from a test).
  for(const name of Object.keys(require.cache))if(name.startsWith(root))delete require.cache[name];
  return {wx,app,dir,shared,calls,requests,workers,audios,surfaces,load(name){let spec;global.Page=p=>spec=p;delete require.cache[require.resolve(path.join(root,'pages',name,'index.js'))];require(path.join(root,'pages',name,'index.js'));const page={...spec,data:structuredClone(spec.data),createSelectorQuery(){return selectorQuery(this);},setData(value,done){Object.assign(this.data,value);if(done)done();}};page.onLoad();return page;},clean(){require(path.join(root,'lib/engine')).cancel();fs.rmSync(dir,{recursive:true,force:true});delete global.wx;delete global.Page;delete global.getApp;delete global.getCurrentPages;}};
}
module.exports={host,fresh,context,root};
