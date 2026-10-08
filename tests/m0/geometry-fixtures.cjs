// Canonical 192x120 RGBA fixtures, drawn directly in this coordinate space.
// Expected tracks are mathematical construction labels, not detector output.
const W = 192, H = 120;
const families = ['horizontal', 'rising', 'falling', 'wave', 'broken', 'block', 'double', 'noise'];
const palettes = [
  { name: 'dark-on-light', background: [245,245,245], foreground: [20,20,20] },
  { name: 'colour-on-dark', background: [25,35,50], foreground: [235,165,55] },
  { name: 'low-contrast', background: [155,155,155], foreground: [105,105,105] }
];
function create(familyIndex, variant) {
  const family = families[familyIndex], palette = palettes[variant];
  if (!family || !palette) throw new Error('Unknown geometry fixture');
  const rgba = new Uint8ClampedArray(W * H * 4), points = [], secondary = [];
  for (let i=0;i<W*H;i++) rgba.set([...palette.background,255], i*4);
  const pixel = (x,y,rgb) => { if (x>=0&&x<W&&y>=0&&y<H) rgba.set([...rgb,255],(y*W+x)*4); };
  const stroke = (x,y,rgb=palette.foreground) => { for(let dy=-1;dy<=1;dy++)pixel(x,y+dy,rgb); };
  const start = family==='block'?58:12, end = family==='block'?133:179;
  let seed = 314159 + variant;
  const random = () => { seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; };
  if (family==='noise') {
    for(let y=0;y<H;y++)for(let x=0;x<W;x++)pixel(x,y,random()<.5?palette.foreground:palette.background);
  } else {
    for(let x=start;x<=end;x++) {
      let y=60;
      if(family==='rising')y=Math.round(96-(x-start)/(end-start)*72);
      if(family==='falling')y=Math.round(24+(x-start)/(end-start)*72);
      if(family==='wave')y=Math.round(60+24*Math.sin((x-start)/(end-start)*Math.PI*4));
      if(family==='block')y=40;
      if(family==='double')y=36;
      const observed=!(family==='broken'&&((x>=52&&x<=63)||(x>=112&&x<=123)));
      points.push({x,y,observed});
      if(observed)stroke(x,y);
      if(family==='block')for(let py=40;py<=78;py++)pixel(x,py,palette.foreground);
      if(family==='double'){stroke(x,84);secondary.push({x,y:84,observed:true});}
    }
  }
  const id=`geometry-${family}-${variant+1}`;
  return {id,family,variant,palette:palette.name,split:variant===2?'holdout':'calibration',rgba,
    annotation:{schema:'pixelmusic-geometry-annotation-v1',id,width:W,height:H,groundTruthOrigin:'construction-on-normalized-pixels',
      expected:family==='noise'?'fallback':'reliable-track',primary:points,secondary,
      policy:family==='double'?'upper-track-on-equal-evidence':family==='block'?'top-horizontal-boundary':family==='noise'?'independent-pixel-noise-must-not-create-track':'follow-primary',
      direction:family==='rising'?'pitch-nondecreasing':family==='falling'?'pitch-nonincreasing':null,
      gapRanges:family==='broken'?[[52,64],[112,124]]:[],strokeRadius:family==='block'?0:1}}
}
const all = () => families.flatMap((family,index)=>palettes.map((palette,variant)=>create(index,variant)));
module.exports={W,H,families,palettes,create,all};
