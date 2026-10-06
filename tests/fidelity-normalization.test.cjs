const assert=require('node:assert/strict'),Image=require('../dist/image-analysis.js');
for(const [width,height,expected] of [[400,200,[-24,0,240,120]],[200,400,[0,-132,192,384]],[192,120,[0,0,192,120]]]){
  let args=null,options=null;const canvas={getContext:(type,opts)=>{assert.equal(type,'2d');options=opts;return{drawImage:(...values)=>{args=values;}};}};
  const doc={createElement:tag=>{assert.equal(tag,'canvas');return canvas;}},source={width,height};
  assert.equal(Image.normalizeSource(source,doc),canvas);assert.equal(canvas.width,192);assert.equal(canvas.height,120);assert.deepEqual(args,[source,...expected]);assert.equal(options.willReadFrequently,true);
}
assert.throws(()=>Image.normalizeSource({width:1,height:1},null),/画布/);
console.log('Passed shared production normalization: landscape, portrait, canonical size and browser-canvas requirement.');
