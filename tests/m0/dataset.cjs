// Offline dataset reader. Downloads and normalization are never test side effects.
const F = require('../baseline/fidelity-fixtures-v061.js');
const G = require('./geometry-fixtures.cjs');
const { read, readJson, sha256, jsonSha } = require('./utils.cjs');
function inputs() {
  return [
    ...F.names.map((name,index)=>({id:`legacy-${String(index).padStart(2,'0')}`,kind:'legacy',split:'regression',name,index,rgba:F.pixels(index)})),
    ...G.all().map(({id,family,palette,split,rgba})=>({id,kind:'geometry',split,family,palette,rgba})),
    ...readJson('tests/m0/photo-sources.json').photos.map(({id,category,split})=>({id,kind:'photo',split,category,rgba:new Uint8ClampedArray(read(`tests/m0/photos/${id}.rgba`))}))
  ];
}
function manifest() {
  const annotations=readJson('tests/m0/geometry-annotations.json').fixtures;
  const review=readJson('tests/m0/photo-annotations.json').photos;
  const photos=readJson('tests/m0/photo-pixels.json').photos;
  return {schema:'pixelmusic-m0-dataset-v1',version:'m0-fixtures-v1',frozenOn:'2026-10-08',width:192,height:120,channels:4,
    counts:{legacy:84,geometry:24,photos:12,total:120,calibration:24,holdout:12,regression:84},
    sourceManifest:'tests/m0/photo-sources.json',photoMetadata:'tests/m0/photo-pixels.json',photoAnnotations:'tests/m0/photo-annotations.json',geometryAnnotations:'tests/m0/geometry-annotations.json',
    inputs:inputs().map(({rgba,...item})=>({...item,rgbaSha256:sha256(rgba),
      ...(item.kind==='geometry'?{annotationSha256:jsonSha(annotations.find(a=>a.id===item.id).annotation)}:{}),
      ...(item.kind==='photo'?{annotationSha256:jsonSha(review.find(a=>a.id===item.id)),...photos.find(p=>p.id===item.id)}:{})}))};
}
module.exports={inputs,manifest};
if(require.main===module)console.log(JSON.stringify(manifest(),null,2));
