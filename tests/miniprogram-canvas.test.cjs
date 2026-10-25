const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../miniprogram/lib/canvas.js'),'utf8');
function harness(){
  const timers=new Set(),module={exports:{}};let callback;
  const context={},canvas={width:0,height:0,getContext:()=>context},result={node:canvas,width:320,height:240,left:10,top:20};
  const query={select(selector){assert.equal(selector,'#picture');return query;},fields(options){assert.equal(options.node,true);return query;},exec(fn){callback=fn;}};
  const page={createSelectorQuery:()=>query};
  const wx={createSelectorQuery(){assert.fail('global SelectorQuery loses Page scope');},getWindowInfo:()=>({pixelRatio:2})};
  vm.runInNewContext(source,{module,wx,Uint8Array,setTimeout(fn){timers.add(fn);return fn;},clearTimeout(fn){timers.delete(fn);}});
  return {api:module.exports,page,canvas,context,result,timers,reply(value=[result]){callback(value);}};
}
test('Canvas helper queries through the Page instance and sizes the returned canvas',async()=>{
  const h=harness(),pending=h.api.get(h.page,'#picture');h.reply();const value=await pending;
  assert.equal(value.context,h.context);assert.equal(value.canvas,h.canvas);assert.equal(h.canvas.width,640);assert.equal(h.canvas.height,480);assert.equal(value.left,10);assert.equal(h.timers.size,0);
});
test('missing nodes and asynchronous context errors reject instead of hanging startup',async()=>{
  const h=harness(),missing=h.api.get(h.page,'#picture');h.reply([null]);await assert.rejects(missing,/画布尚未就绪/);assert.equal(h.timers.size,0);
  h.canvas.getContext=()=>{throw new Error('native context unavailable');};const broken=h.api.get(h.page,'#picture');assert.doesNotThrow(()=>h.reply());await assert.rejects(broken,/native context unavailable/);assert.equal(h.timers.size,0);
});
test('a dropped native query callback times out and its late response cannot alter the canvas',async()=>{
  const h=harness(),pending=h.api.get(h.page,'#picture');for(const timer of h.timers)timer();await assert.rejects(pending,/初始化超时/);assert.equal(h.timers.size,0);
  h.reply();assert.equal(h.canvas.width,0);assert.equal(h.canvas.height,0);
  const retry=h.api.get(h.page,'#picture');h.reply();assert.equal((await retry).canvas,h.canvas);
});
