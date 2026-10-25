const {test}=require('node:test'),assert=require('node:assert/strict');
const Core=require('../dist/music-art-core'),Playback=require('../dist/music-art-playback');
const note=(start,duration,midi=72,voice='melody',layer='main')=>({start,duration,midi,voice,layer,velocity:.8,instrument:'piano'});
const score=Core.normalize({duration:4,events:[note(0,.4),note(0,.4,76),note(.5,.125,74),note(2,1,79)]});

test('chords share one cursor and accents follow actual attacks, including rests and sustain',()=>{
  const p=Playback.prepare(Core.scene(score,{style:'garden'}));
  assert.equal(p.tracks[0].groups.length,3);assert.equal(p.tracks[0].groups[0].notes.length,2);
  assert.equal(Playback.frame(p,0,true).cursors.length,1);
  assert.ok(Playback.frame(p,0,true).pulse>0);
  assert.equal(Playback.frame(p,.3,true).pulse,0,'a held note does not invent extra beats');
  assert.equal(Playback.frame(p,.75,true).cursors.length,0,'rest clears the voice cursor');
  assert.equal(Playback.frame(p,.75,true).pulse,0);
  assert.ok(Playback.frame(p,.5,true).pulse>0);
  assert.ok(Playback.frame(p,2.01,true).pulse>0);
  assert.equal(Playback.frame(p,2.5,true).pulse,0);
  assert.equal(Playback.frame(p,2.5,true).cursors.length,1,'sustained cursor remains steady');
  assert.equal(Playback.frame(p,2.5,false).cursors.length,0);assert.equal(Playback.frame(p,2,false).pulse,0);
  assert.equal(Playback.overlay(p,.75,true),'','rest leaves the painting quiet');
  assert.equal(Playback.overlay(p,2.5,true),Playback.overlay(p,2.5,true),'seek and loop frames have no accumulated animation state');
});

test('all eight styles retain separate voice timing and limit the visual focus',()=>{
  const dense=Core.normalize({duration:4,events:Array.from({length:8},(_,i)=>note(0,2,80-i*5,'part-'+i,i===0?'main':'pad'))});
  for(const style of Object.keys(Core.STYLES)){
    const model=Core.scene(dense,{style}),p=Playback.prepare(model),f=Playback.frame(p,.4,true);
    assert.ok(p.tracks.length>=8,style+' retains voice identity');
    assert.equal(f.cursors.length,3,style+' shows at most three parts, including a chord-heavy score');
    assert.equal(f.cursors[0].group.note.midi,80,style+' consistently focuses the high main part');
    assert.equal(f.pulse,0);
  }
});

test('rhythm strip preserves irregular onsets and lengths without quantizing to BPM',()=>{
  const irregular=Core.normalize({tempo:120,duration:4,events:[note(.371,.813),note(2.247,.113,76)]});
  const p=Playback.prepare(Core.scene(irregular,{style:'landscape'}));
  assert.equal(Playback.frame(p,.37,true).pulse,0);
  assert.ok(Playback.frame(p,.371,true).pulse>0);
  const svg=Playback.rhythm(p,.371,true);
  assert.match(svg,/x="300" y="46" width="149.59"/,'the .813 second note starts at now and retains its true length');
  assert.match(svg,/x="645.18"/,'the next attack is 1.876 seconds ahead');
  assert.equal(Playback.overlay(p,.371,false),'');
  assert.match(Playback.rhythm(p,.371,false),/现在/,'paused rhythm remains available for orientation');
});

test('native visual clock interpolates coarse audio updates and handles pause, seek, loop and stalls',()=>{
  let now=0;const c=new Playback.Clock(()=>now);
  c.reset(0,10);c.start();now=.12;c.sync(0);assert.equal(c.value(),.12);
  now=.24;c.sync(0);assert.equal(c.value(),.24,'duplicate samples do not restart the clock');
  c.sync(.25);now=.34;assert.ok(Math.abs(c.value()-.342)<1e-8);
  const before=c.value();c.sync(.3);assert.ok(Math.abs(c.value()-before)<.02,'small coarse-time corrections stay below a frame');
  c.pause();const paused=c.value();now=1;assert.equal(c.value(),paused);
  c.reset(3,10);c.start();c.sync(0);assert.equal(c.value(),3,'stale time after seek cannot rewind playback');
  now=1.25;c.sync(3.25);now=1.35;assert.ok(Math.abs(c.value()-3.35)<1e-8);
  now=3;assert.equal(c.value(),3.85,'stalled playback cannot run arbitrarily ahead');
  c.reset(9.8,10,true);c.start();now=3.3;assert.ok(Math.abs(c.value()-.1)<1e-8);
  c.sync(.1);now=3.4;assert.ok(Math.abs(c.value()-.2)<1e-8);
  c.reset(9.8,10,false);c.start();now=4;assert.equal(c.value(),10);
});

test('delivered native art page uses the smooth clock through audio events, seeking and loop changes',async()=>{
  const {host}=require('./helpers/miniprogram-host.cjs'),h=host();h.app.globalData.currentScore=score;
  const page=h.load('art');let now=0;page.clock.now=()=>now;
  try{
    await page.onReady();await page.play();assert.equal(page.data.playing,true);
    const audio=h.audios[0];now=.12;audio.emit('TimeUpdate');page.onTime(page.clock.value());assert.equal(page.time,.12);
    now=.25;audio.currentTime=.25;audio.emit('TimeUpdate');now=.37;page.stop();assert.ok(Math.abs(page.time-.37)<1e-8);
    now=1;assert.ok(Math.abs(page.clock.value()-.37)<1e-8,'pause freezes the picture');
    page.seek({detail:{value:3}});await page.play();audio.currentTime=0;audio.emit('TimeUpdate');assert.equal(page.clock.value(),3);
    page.stop();page.seek({detail:{value:3.9}});page.changeLoop({detail:{value:true}});await page.play();now=1.3;
    assert.ok(Math.abs(page.clock.value()-.2)<1e-8);page.changeLoop({detail:{value:false}});assert.ok(Math.abs(page.clock.value()-.2)<1e-8);
    assert.ok(h.surfaces.get('#rhythm').getContext().ops.some(op=>op[0]==='fillText'&&op[1]==='现在'));
    page.onHide();assert.equal(page.data.playing,false);page.select(1);assert.equal(page.clock.value(),0);
  }finally{page.onUnload();h.clean();}
});
