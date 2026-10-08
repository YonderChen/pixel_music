const assert=require('node:assert/strict'),zlib=require('node:zlib');
const {inputs,manifest}=require('./m0/dataset.cjs');
const {read,readJson,sha256}=require('./m0/utils.cjs');
const G=require('./m0/geometry-fixtures.cjs');
const expected=readJson('tests/m0/dataset-manifest.json');
assert.deepEqual(manifest(),expected,'fixture/annotation SHA or split drift');
const all=inputs();assert.equal(all.length,120);assert.equal(new Set(all.map(p=>p.id)).size,120);
for(const item of all){assert.equal(item.rgba.length,192*120*4);for(let i=3;i<item.rgba.length;i+=4)assert.equal(item.rgba[i],255);}
for(const [kind,count]of[['legacy',84],['geometry',24],['photo',12]])assert.equal(all.filter(p=>p.kind===kind).length,count);
for(const [split,count]of[['regression',84],['calibration',24],['holdout',12]])assert.equal(all.filter(p=>p.split===split).length,count);
const labels=readJson('tests/m0/geometry-annotations.json');assert.equal(labels.fixtures.length,24);
for(const fixture of G.all()){
  const saved=labels.fixtures.find(p=>p.id===fixture.id);assert.deepEqual(saved.annotation,fixture.annotation);assert.equal(saved.inputSha256,sha256(fixture.rgba));
  const palette=G.palettes[fixture.variant];assert.equal(fixture.split,fixture.variant===2?'holdout':'calibration');
  for(const p of [...fixture.annotation.primary,...fixture.annotation.secondary]){
    const rgb=Array.from(fixture.rgba.slice((p.y*192+p.x)*4,(p.y*192+p.x)*4+3));
    assert.deepEqual(rgb,p.observed?palette.foreground:palette.background);
  }
  assert.equal(fixture.annotation.gapRanges.length,fixture.family==='broken'?2:0);
  if(fixture.family==='rising'||fixture.family==='falling')for(let i=1;i<fixture.annotation.primary.length;i++)assert.ok(fixture.family==='rising'?fixture.annotation.primary[i].y<=fixture.annotation.primary[i-1].y:fixture.annotation.primary[i].y>=fixture.annotation.primary[i-1].y);
}
// Small strict RGBA PNG decoder proves that checked-in display pixels == raw input.
// Hashes check all bytes; decoding additionally catches a wrongly paired PNG/RGBA.
function pngRGBA(data){
  assert.equal(data.subarray(0,8).toString('hex'),'89504e470d0a1a0a');let offset=8;const compressed=[];
  while(offset<data.length){const size=data.readUInt32BE(offset),type=data.toString('ascii',offset+4,offset+8),body=data.subarray(offset+8,offset+8+size);assert.equal(body.length,size);
    if(type==='IHDR'){assert.equal(body.readUInt32BE(0),192);assert.equal(body.readUInt32BE(4),120);assert.deepEqual(Array.from(body.subarray(8)),[8,6,0,0,0]);}
    if(type==='IDAT')compressed.push(body);offset+=size+12;if(type==='IEND')break;
  }
  const packed=zlib.inflateSync(Buffer.concat(compressed)),stride=192*4,out=Buffer.alloc(stride*120);assert.equal(packed.length,(stride+1)*120);
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<120;y++){const filter=packed[y*(stride+1)];assert.ok(filter<=4);for(let x=0;x<stride;x++){const i=y*stride+x,a=x>=4?out[i-4]:0,b=y?out[i-stride]:0,c=y&&x>=4?out[i-stride-4]:0;out[i]=(packed[y*(stride+1)+x+1]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;}}
  return out;
}
const sources=readJson('tests/m0/photo-sources.json').photos,metadata=readJson('tests/m0/photo-pixels.json').photos,review=readJson('tests/m0/photo-annotations.json').photos;
assert.equal(sources.length,12);assert.equal(new Set(sources.map(p=>p.sourceSha256)).size,12);assert.equal(review.length,12);
for(const category of ['long-boundary','competing-boundaries','large-low-information-area','high-texture-or-low-contrast']){
  const group=sources.filter(p=>p.category===category);assert.equal(group.length,3);assert.equal(group.filter(p=>p.split==='holdout').length,1);
}
for(const source of sources){
  for(const key of ['url','sourcePage','licensePage'])assert.ok(source[key].startsWith('https://'));assert.ok(source.credit&&source.license);assert.match(source.sourceSha256,/^[a-f0-9]{64}$/);
  if(source.license==='NASA-media-educational-use')assert.ok(source.restrictions);
  const meta=metadata.find(p=>p.id===source.id),label=review.find(p=>p.id===source.id);assert.equal(meta.sourceSha256,source.sourceSha256);assert.equal(meta.normalizationVersion,'fixture-cover-pillow-bilinear-v1');
  assert.equal(sha256(read(meta.pngPath)),meta.pngSha256);assert.equal(sha256(read(meta.rgbaPath)),meta.rgbaSha256);assert.deepEqual(pngRGBA(read(meta.pngPath)),read(meta.rgbaPath));
  const [w,h]=meta.sourceDimensions,[x0,y0,x1,y1]=meta.cropBox;assert.ok(x0>=0&&y0>=0&&x1<=w&&y1<=h&&x1>x0&&y1>y0);assert.ok(Math.abs((x1-x0)/(y1-y0)-1.6)<1e-9);
  assert.equal(label.expectedPolicy,'supported-track-or-explained-fallback');assert.ok(label.observations&&label.regions.length);
  for(const region of label.regions){const [left,top,right,bottom]=region.rect;assert.ok(left>=0&&top>=0&&right<=192&&bottom<=120&&right>left&&bottom>top);assert.ok(['boundary-review','competing-structure','texture-review','low-information'].includes(region.role));}
}
console.log(JSON.stringify({status:'passed',inputs:120,geometry:24,realPhotos:12,calibration:24,holdout:12,distinctPixelInputs:new Set(all.map(p=>sha256(p.rgba))).size,pngRgbaMatches:12,networkUsed:false,contourAlgorithmEvaluated:false}));
