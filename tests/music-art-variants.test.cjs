const {test}=require('node:test'),assert=require('node:assert/strict');
const Core=require('../dist/music-art-core'),Classics=require('../dist/music-art-classics');
const styles=['landscape','weave','constellation','garden','tides'];
const art=model=>model.svg.slice(model.svg.indexOf('<rect'));

test('new compositions respond to the music, preserve identity and remain deterministic',()=>{
  for(const score of Core.samples())for(const style of styles){
    const a=Core.scene(score,{style});assert.equal(a.svg,Core.scene(score,{style}).svg);
    assert.equal(a.fingerprint,Core.fingerprint(score));assert.equal(a.notes.length,score.events.length);
    const variations=[{events:score.events.map(e=>({...e,midi:e.midi+7}))},{events:score.events.map((e,i)=>({...e,start:e.start+(i%3)*.08}))},{events:score.events.map(e=>({...e,velocity:e.velocity*.5}))},{tempo:score.tempo+30},{events:score.events.map(e=>({...e,instrument:'guitar'}))}];
    for(const [i,change] of variations.entries())assert.ok(art(a)!==art(Core.scene({...score,...change},{style})),score.id+' / '+style+' responds to '+['pitch','rhythm','dynamics','tempo','timbre'][i]);
    assert.equal(art(a),art(Core.scene({...score,title:'another title',image:{colors:['red']},features:{hue:1}},{style})),'only music determines artwork');
    assert.equal(new Set([0,1,2,3].map(layout=>art(Core.scene(score,{style,layout})))).size,4,'four distinct compositions');
    assert.notEqual(art(a),art(Core.scene(score,{style,detail:.3})));
    for(const n of a.notes){assert.ok(Number.isFinite(n.x)&&Number.isFinite(n.y));assert.ok(a.marks.some(m=>m.x===n.x&&m.y===n.y),'playback lights a drawn mark');}
  }
});
test('all built-in classical scores, palettes and styles render without invalid SVG',()=>{
  for(const score of Classics.samples())for(const style of styles){
    const model=Core.scene(score,{style});assert.ok(!/NaN|Infinity|undefined/.test(model.svg));assert.ok(model.marks.length<=1280);assert.equal(model.notes.length,score.events.length);
  }
  for(const style of Object.keys(Core.STYLES))for(const palette of Object.keys(Core.palettes))assert.ok(!/NaN|Infinity|undefined/.test(Core.scene(Core.samples()[2],{style,palette}).svg));
});
test('silence stays empty, and dense polyphony has bounded drawing cost',()=>{
  const crowded={duration:12,tempo:120,events:Array.from({length:5000},(_,i)=>({start:(i%100)/10,duration:.1,midi:48+i%36,velocity:.5,voice:'v'+i%16,instrument:'piano'}))};
  for(const style of styles){
    const empty=Core.scene({events:[],duration:2},{style});assert.equal(empty.notes.length,0);assert.equal(empty.marks.length,0);
    const model=Core.scene(crowded,{style});assert.ok(model.marks.length<=1280);assert.ok(model.svg.length<2000000);assert.ok(!/NaN|Infinity/.test(model.svg));assert.equal(model.stats.voices.length,16);assert.ok(model.notes.every(n=>Number.isFinite(n.x)&&Number.isFinite(n.y)));
  }
});
test('new styles keep audible rests as gaps and reject inherited option keys',()=>{
  const events=[{start:0,duration:.5,midi:60},{start:.6,duration:.5,midi:65},{start:5,duration:.5,midi:67},{start:5.6,duration:.5,midi:64}];
  const model=Core.scene({duration:7,events},{style:'landscape'});
  assert.equal(model.phraseCount,2,'two mountain masses separated by the musical rest');
  assert.ok(model.marks.every(n=>n.end<2||n.start>=5),'the rest has no musical marks');
  assert.equal(Core.scene({events},{style:'constructor',palette:'constructor'}).style,'ribbons');
});
test('standalone preview embeds its runtime, styles and MIDI downloads',()=>{
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
  const html=fs.readFileSync(path.join(__dirname,'../artifacts/music-art/乐曲成画-自然意象体验.html'),'utf8');
  assert.doesNotMatch(html,/<script\b[^>]*\bsrc=|<link\b[^>]*rel="stylesheet"/);
  const scripts=Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g));assert.equal(scripts.length,4);
  for(const [,js] of scripts)new vm.Script(js);
  assert.match(html,/data:audio\/midi;base64,/);
  assert.doesNotMatch(html,/E\.midiOriginal\.href='\.\/classical-midi\//);
});
