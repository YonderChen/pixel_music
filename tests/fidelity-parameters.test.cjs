const assert=require('node:assert/strict'),Music=require('../dist/music.js'),Image=require('../dist/image-analysis.js'),Samples=require('./fidelity-fixtures.js'),check=require('./score-contract.cjs');
let syntheticCases=0;
for(const mode of Object.values(Music.MODES))for(let root=0;root<12;root++)for(let seed=1;seed<=12;seed++){
  let state=seed;const random=()=>{state=Math.imul(state,1664525)+1013904223|0;return(state>>>0)/4294967296;};
  const columns=Array.from({length:24},(_,col)=>({notes:Array.from({length:5},(_,row)=>({col,row,light:random(),hue:random(),saturation:random(),density:random()}))}));
  const analysis={columns,root,modeId:mode.id,bpm:88},score=Music.compose(analysis);check(score);
  assert.deepEqual(score,Music.compose(analysis));syntheticCases++;
}
for(let shade=0;shade<=255;shade++){
  const data=new Uint8ClampedArray(192*120*4);for(let i=0;i<data.length;i+=4)data.set([shade,shade,shade,255],i);
  const score=Music.compose(Image.analyzePixels(data));assert.equal(score.melody.length,1);assert.equal(score.rhythmProfile.complexity,0);assert.equal(score.rests.length,0);
}
const organized=Music.compose(Image.analyzePixels(Samples.pixels(80))),shuffled=[];
for(let seed=1;seed<=32;seed++){
  const pixels=Samples.pixels(80);let state=seed;
  for(let i=192*120-1;i>0;i--){state=Math.imul(state,1664525)+1013904223|0;const j=Math.floor((state>>>0)/4294967296*(i+1));for(let c=0;c<4;c++){const v=pixels[i*4+c];pixels[i*4+c]=pixels[j*4+c];pixels[j*4+c]=v;}}
  const score=Music.compose(Image.analyzePixels(pixels));check(score);assert.ok(score.rhythmProfile.complexity<organized.rhythmProfile.complexity);assert.equal(score.diagnostics.periodicRetriggers,0);
  shuffled.push({seed,onsets:score.melody.length,complexity:score.rhythmProfile.complexity});
}
const counts=shuffled.map(s=>s.onsets).sort((a,b)=>a-b);assert.ok(counts[16]<organized.melody.length,'matched-histogram noise must be quieter in aggregate, not just one convenient seed');
const original=Music.compose(Image.analyzePixels(Samples.pixels(5))),local=[];
for(const col of [2,8,14,20]){
  const pixels=Samples.pixels(5);for(let y=48;y<72;y++)for(let x=col*8;x<(col+1)*8;x++)for(let c=0;c<3;c++){const o=(y*192+x)*4+c;pixels[o]=Math.min(255,pixels[o]+5);}
  const score=Music.compose(Image.analyzePixels(pixels));check(score);
  const changed=score.regionMap.filter((r,i)=>r.previewRef.midi!==original.regionMap[i].previewRef.midi||r.previewRef.velocity!==original.regionMap[i].previewRef.velocity).map(r=>r.sequence);
  assert.equal(score.root,original.root);assert.equal(score.mode.id,original.mode.id);assert.equal(score.bpm,original.bpm);
  assert.deepEqual(changed,[col*5+2],'controlled minor edit must remain in its own source region');
  local.push({col,changedRegions:changed,globalKeyOrModeChanged:score.root!==original.root||score.mode.id!==original.mode.id,globalBpmChanged:score.bpm!==original.bpm});
}
console.log(JSON.stringify({status:'passed',syntheticCases,solidGraySweep:256,noiseSeeds:32,organizedOnsets:organized.melody.length,noiseOnsets:{min:counts[0],median:counts[16],max:counts.at(-1)},localEdits:local},null,2));
