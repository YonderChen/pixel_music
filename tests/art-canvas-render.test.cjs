const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
test('native art renderer matches SVG rasterization for every composition',async t=>{
  let canvas;
  try{canvas=require(process.env.CANVAS_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas'));}
  catch(_){t.skip('Set CANVAS_MODULE to @napi-rs/canvas for pixel comparison');return;}
  const Core=require('../dist/music-art-core'),Svg=require('../build/miniprogram/lib/svg-canvas'),out=path.resolve(__dirname,'../build/verification');fs.mkdirSync(out,{recursive:true});
  for(const style of Object.keys(Core.STYLES)){
    const model=Core.scene(Core.samples()[2],{style,palette:'blue'}),native=canvas.createCanvas(1200,900),reference=canvas.createCanvas(1200,900);
    Svg.draw(native.getContext('2d'),model.svg,1200,900);const img=await canvas.loadImage(Buffer.from(model.svg));reference.getContext('2d').drawImage(img,0,0);
    const a=native.getContext('2d').getImageData(0,0,1200,900).data,b=reference.getContext('2d').getImageData(0,0,1200,900).data;let total=0,pixels=0;
    for(let i=0;i<a.length;i+=4){let diff=0;for(let c=0;c<3;c++){const d=Math.abs(a[i+c]-b[i+c]);total+=d;diff+=d;}if(diff>90)pixels++;}
    const mean=total/(1200*900*3),large=pixels/(1200*900);t.diagnostic(style+': mean RGB error '+mean.toFixed(3)+', large differences '+(large*100).toFixed(2)+'%');
    fs.writeFileSync(path.join(out,style+'-canvas.png'),native.toBuffer('image/png'));fs.writeFileSync(path.join(out,style+'-svg.png'),reference.toBuffer('image/png'));
    assert.ok(mean<2,style+' preserves the paths, colours, texture and layering');assert.ok(large<.025,style+' has no missing major shape');
  }
});

test('native playback overlay and rhythm strip preserve the shared SVG timing display',async t=>{
  let canvas;
  try{canvas=require(process.env.CANVAS_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas'));}
  catch(_){t.skip('Set CANVAS_MODULE to @napi-rs/canvas for pixel comparison');return;}
  const Core=require('../dist/music-art-core'),Playback=require('../dist/music-art-playback'),Svg=require('../build/miniprogram/lib/svg-canvas'),out=path.resolve(__dirname,'../build/verification');
  fs.mkdirSync(out,{recursive:true});
  for(const style of ['garden','scroll']){
    const model=Core.scene(Core.samples()[1],{style}),p=Playback.prepare(model),time=.61;
    const overlay=Playback.overlay(p,time,true),rhythm=Playback.rhythm(p,time,true),native=canvas.createCanvas(1200,1080),ref=canvas.createCanvas(1200,1080),c=native.getContext('2d');
    Svg.draw(c,model.svg,1200,900);Svg.draw(c,overlay,1200,900);c.save();c.translate(0,900);Svg.draw(c,rhythm,1200,180,1200,180);c.restore();
    const image=await canvas.loadImage(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1080">${model.svg}${overlay}<g transform="translate(0 900)">${rhythm}</g></svg>`));ref.getContext('2d').drawImage(image,0,0);
    const a=c.getImageData(0,0,1200,1080).data,b=ref.getContext('2d').getImageData(0,0,1200,1080).data;let diff=0;
    for(let i=0;i<a.length;i+=4)for(let k=0;k<3;k++)diff+=Math.abs(a[i+k]-b[i+k]);
    assert.ok(diff/(1200*1080*3)<2,style+' overlay, rhythm bars and playhead are consistent across renderers');
    fs.writeFileSync(path.join(out,style+'-rhythm-playback.png'),native.toBuffer('image/png'));
  }
});
