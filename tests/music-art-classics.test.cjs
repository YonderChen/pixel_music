const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const Core=require('../dist/music-art-core.js'),Midi=require('../dist/music-art-midi.js'),Classics=require('../dist/music-art-classics.js');
const folder=path.resolve(__dirname,'../dist/classical-midi'),manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8'));
const samples=Classics.samples();assert.equal(samples.length,6);assert.equal(new Set(samples.map(s=>s.id)).size,6);
const fingerprints=new Set(),records=[];
for(const [i,score] of samples.entries()){
  const entry=manifest.pieces[i],bytes=fs.readFileSync(path.join(folder,entry.file)),original=Midi.parse(bytes);
  assert.equal(score.id,entry.id);assert.equal(score.source.sha256,crypto.createHash('sha256').update(bytes).digest('hex'));
  assert.ok(score.duration<=180&&score.events.length>100&&score.events.length<=5000);
  assert.equal(score.title.includes('节选'),!!entry.excerptSeconds);
  const end=entry.excerptSeconds?entry.excerptSeconds-.8:Infinity;
  const expected=Core.normalize({...original,title:score.title,duration:entry.excerptSeconds||original.duration,events:original.events.filter(n=>n.start<end).map(n=>({...n,duration:Math.min(n.duration,end-n.start)}))});
  assert.deepEqual(Core.normalize(score),expected,'candidate uses the downloaded MIDI notes and timing');
  if(entry.excerptSeconds){assert.ok(original.duration>180);assert.equal(score.duration,150);assert.ok(score.events.every(n=>n.start+n.duration<=149.2001));}
  fingerprints.add(Core.fingerprint(score));
  const ribbon=Core.scene(score,{style:'ribbons'}),geometry=Core.scene(score,{style:'geometry'});
  assert.ok(ribbon.svg.startsWith('<svg')&&geometry.svg.startsWith('<svg'));assert.notEqual(ribbon.svg,geometry.svg);assert.ok(!/NaN|Infinity/.test(ribbon.svg+geometry.svg));
  records.push({title:score.title,duration:score.duration,notes:score.events.length,voices:Core.describe(score).voices.length,originalDuration:score.source.originalDuration});
}
assert.equal(fingerprints.size,6);
const canon=samples.find(s=>s.id==='classical-pachelbel-canon-in-d');assert.equal(Core.describe(canon).voices.length,4);assert.equal(canon.source.license,'CC BY 4.0');
// Load the HTML's actual script order as a classic browser bundle with no fetch.
const window={},context=vm.createContext({window,atob,Uint8Array}),html=fs.readFileSync(path.resolve(__dirname,'../dist/music-art.html'),'utf8');
for(const [,file] of html.matchAll(/<script src="\.\/([^"]+)"/g)){
  if(['browser-engine.js','music-art-app.js'].includes(file))continue;
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../dist',file),'utf8'),context);
}
assert.deepEqual(JSON.parse(JSON.stringify(window.MusicArtClassics.samples())),samples,'file-protocol browser branch matches Node data without network loading');
assert.deepEqual(Classics.samples(),samples,'selecting the catalog repeatedly does not mutate MIDI data');
console.log(JSON.stringify({status:'passed',checkedOn:'2026-10-14',records},null,2));
