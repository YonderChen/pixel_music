// Standalone, offline review copy of the art workbench. No server or npm packages.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),read=name=>fs.readFileSync(path.join(root,'dist',name),'utf8');
const icon='data:image/svg+xml,'+encodeURIComponent(read('favicon.svg'));
let html=read('music-art.html');
html=html.replace(/<link\b[^>]*>/g,tag=>{
  const stylesheet=tag.match(/href="\.\/([^"?]+\.css)(?:\?[^"]*)?"/);
  return stylesheet?'<style>'+read(stylesheet[1])+'</style>':'';
}).replace('src="./favicon.svg"','src="'+icon+'"');
html=html.replace(/<script src="\.\/([^"]+)"><\/script>/g,(_,name)=>{
  if(name==='browser-engine.js')return '';
  let js=read(name);
  // Image-side audio needs the full engine folder. This portable review file uses
  // its existing score synthesizer for every imported score, including transfers.
  if(name==='music-art-app.js')js=js.replace('score.audioRef=audioRef(data.audioRef);score.legacyAudio=!!data.audioRef&&!score.audioRef;','score.audioRef=null;score.legacyAudio=false;');
  return '<script>'+js.replace(/<\/script/gi,'<\\/script')+'</script>';
});
html=html.replace(/href="\.\/feature-music.html#parallel"/g,'href="#"');
html=html.replace(/href="\.\/music-art.html"/g,'href="#"');
html=html.replace('<a href="#">图片演奏</a>','<span>离线体验</span>');
html=html.replace('回到图片演奏 ↗','独立体验版 · 本机合成试听');
// MIDI bytes are already embedded in the trusted catalog; make their download
// links portable as well, without needing the original classical-midi folder.
const manifest=JSON.parse(read('classical-midi/manifest.json'));
const midiData=Object.fromEntries(manifest.pieces.map(piece=>[piece.file,'data:audio/midi;base64,'+fs.readFileSync(path.join(root,'dist/classical-midi',piece.file)).toString('base64')]));
html=html.replace("E.midiOriginal.href='./classical-midi/'+source.file;","E.midiOriginal.href="+JSON.stringify(midiData)+'[source.file];');
const file=path.join(root,'artifacts/music-art/乐曲成画-自然意象体验.html');
html=html.replace(/[ \t]+$/gm,'');
fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,html);
console.log(path.relative(root,file)+' ('+(Buffer.byteLength(html)/1024).toFixed(1)+' KiB)');
