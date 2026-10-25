(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MusicArtPlayback=api;})(typeof window==='object'?window:this,function(){
  'use strict';
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),r=v=>Math.round(v*100)/100;
  const upper=(list,t)=>{let a=0,b=list.length;while(a<b){const m=(a+b)>>1;if(list[m].start<=t)a=m+1;else b=m;}return a;};
  function prepare(model){
    const voices=new Map();
    for(const n of model.notes){const id=n.voice??0;if(!voices.has(id))voices.set(id,[]);voices.get(id).push(n);}
    const tracks=Array.from(voices,([id,notes])=>{
      notes.sort((a,b)=>a.start-b.start||a.midi-b.midi);const groups=[];
      for(const n of notes){let g=groups.at(-1);if(!g||n.start-g.start>.012){g={start:n.start,end:n.end,notes:[],note:n};groups.push(g);}g.notes.push(n);g.end=Math.max(g.end,n.end);if(n.midi+n.velocity*6>g.note.midi+g.note.velocity*6)g.note=n;}
      // Prefer an active, higher main part over long bass/pad notes. Keep that
      // choice for the whole piece so focus never jumps between voices by volume.
      const priority=(notes.some(n=>n.main)?100:0)+notes.reduce((s,n)=>s+n.midi,0)/notes.length+Math.min(12,groups.length/model.score.duration*4);
      return {id,groups,priority,color:notes[0].color};
    }).sort((a,b)=>b.priority-a.priority||String(a.id).localeCompare(String(b.id)));
    const onsets=model.score.events.map(n=>({start:n.start,velocity:n.velocity})).sort((a,b)=>a.start-b.start),accents=[];
    for(const n of onsets){const last=accents.at(-1);if(last&&n.start-last.start<=.012)last.velocity=Math.max(last.velocity,n.velocity);else accents.push({...n});}
    return {model,tracks,accents};
  }
  function frame(prepared,time,playing){
    const {model,tracks,accents}=prepared,t=clamp(time,0,model.score.duration),index=upper(accents,t)-1,onset=accents[index],next=accents[index+1];
    // Each attack gets one short accent. Sustained notes never generate a beat.
    const width=onset?Math.min(.22,next?Math.max(.045,(next.start-onset.start)*.7):.22):.22;
    const pulse=playing&&onset?Math.max(0,1-(t-onset.start)/width)*onset.velocity:0,cursors=[];
    if(playing)for(const track of tracks.slice(0,3)){
      const i=upper(track.groups,t)-1,g=track.groups[i];if(!g||t>=g.end)continue;
      const n=g.note,age=t-g.start,previous=track.groups[i-1],connected=previous&&g.start-previous.end<.35&&Math.hypot(n.x-previous.note.x,n.y-previous.note.y)<360;
      const move=clamp(age/.1,0,1),ease=move*move*(3-2*move),x=model.scroll?Math.min(n.x1,model.scroll.x0+t/model.scroll.duration*(model.scroll.x1-model.scroll.x0)):connected?previous.note.x+(n.x-previous.note.x)*ease:n.x,y=connected&&!model.scroll?previous.note.y+(n.y-previous.note.y)*ease:n.y;
      const gap=track.groups[i+1]?.start-g.start,attack=Math.max(0,1-age/Math.min(.22,Number.isFinite(gap)?Math.max(.045,gap*.7):.22));
      cursors.push({track,group:g,index:i,x,y,attack,progress:clamp(age/(g.end-g.start),0,1),leader:cursors.length===0});
    }
    return {time:t,pulse,cursors};
  }
  function overlay(prepared,time,playing){
    const {model}=prepared,f=frame(prepared,time,playing),scan=model.scroll;let svg='';
    if(scan&&(playing||time>0&&time<scan.duration-.02)){
      const x=r(scan.x0+Math.min(1,time/scan.duration)*(scan.x1-scan.x0));
      if(playing)svg+=`<rect x="${x}" y="0" width="${r(1200-x)}" height="900" fill="${model.palette.paper}" fill-opacity=".62"/>`;
      svg+=`<path d="M${x} ${scan.top-26}V${scan.bottom+26}" stroke="${model.palette.ink}" stroke-opacity=".6" stroke-width="1.6"/>`;
    }
    for(const c of f.cursors){
      const {track,group,index,x,y,attack,leader}=c,n=group.note,color=track.color;
      if(!scan)for(let j=Math.max(1,index-3);j<=index;j++){
        const a=track.groups[j-1],b=track.groups[j],age=f.time-b.start,distance=Math.hypot(a.note.x-b.note.x,a.note.y-b.note.y);
        if(age>2||b.start-a.end>=.35||distance>360)continue;
        svg+=`<path d="M${r(a.note.x)} ${r(a.note.y)}L${r(j===index?x:b.note.x)} ${r(j===index?y:b.note.y)}" fill="none" stroke="${color}" stroke-width="${leader?4:2}" stroke-opacity="${r((leader?.55:.25)*(1-age/2))}" stroke-linecap="round"/>`;
      }
      if(scan)svg+=`<path d="M${n.x} ${n.y}H${r(x)}" stroke="${color}" stroke-width="${leader?7:4}" stroke-opacity=".7" stroke-linecap="round"/>`;
      // One steady cursor per part; the outer ring appears only on a real onset.
      if(attack>0)svg+=`<circle cx="${r(n.x)}" cy="${r(n.y)}" r="${r(14+(1-attack)*18)}" fill="none" stroke="${color}" stroke-width="${leader?3:1.5}" stroke-opacity="${r(attack*(leader?.85:.4))}"/>`;
      svg+=`<circle cx="${r(x)}" cy="${r(y)}" r="${leader?10:6}" fill="${model.palette.paper}" stroke="${color}" stroke-width="${leader?4:2}"/><circle cx="${r(x)}" cy="${r(y)}" r="${leader?3:2}" fill="${color}"/>`;
    }
    return svg;
  }
  function rhythm(prepared,time,playing){
    const {model,tracks}=prepared,f=frame(prepared,time,playing),ink=model.palette.ink,left=64,right=1170,head=300,scale=184;
    let svg=`<rect width="1200" height="180" rx="12" fill="${model.palette.paper}"/>`;
    // Seconds are only a scale; attacks and lengths come from the score's actual
    // timestamps, including tempo changes and irregular meter in imported MIDI.
    for(let s=Math.max(0,Math.ceil(time-(head-left)/scale));s<time+(right-head)/scale;s++){
      const x=r(head+(s-time)*scale);svg+=`<path d="M${x} 28V166" stroke="${ink}" stroke-width="1" stroke-opacity=".12"/>`;
    }
    const lanes=tracks.slice(0,4),height=Math.min(28,116/Math.max(1,lanes.length));
    lanes.forEach((track,i)=>{
      const y=46+i*32;svg+=`<path d="M${left} ${y+height/2}H${right}" stroke="${ink}" stroke-width="1" stroke-opacity=".12"/>`;
      svg+=`<text x="20" y="${y+height/2+8}" fill="${ink}" font-family="sans-serif" font-size="24">${i+1}</text>`;
      const last=upper(track.groups,time+(right-head)/scale);
      for(let j=0;j<last;j++){
        const g=track.groups[j],x0=head+(g.start-time)*scale,x1=head+(g.end-time)*scale;if(x1<left)continue;
        const x=Math.max(left,x0),end=Math.min(right,x1),active=playing&&g.start<=time&&time<g.end;
        svg+=`<rect x="${r(x)}" y="${y}" width="${r(Math.max(2,end-x))}" height="${height-6}" rx="4" fill="${track.color}" fill-opacity="${active?'.85':g.start<time?'.3':'.22'}"/>`;
        if(x0>=left)svg+=`<path d="M${r(x0)} ${y}V${y+height-6}" stroke="${track.color}" stroke-width="${active?4:2}" stroke-opacity="${active?1:.6}"/>`;
      }
    });
    svg+=`<path d="M${head} 26V172" stroke="${ink}" stroke-width="3"/><text x="${head-26}" y="21" fill="${ink}" font-family="sans-serif" font-size="24">现在</text>`;
    if(f.pulse>0)svg+=`<circle cx="${head}" cy="166" r="${r(5+f.pulse*7)}" fill="${ink}"/>`;
    return svg;
  }
  // Interpolate sparse native audio timestamps between real updates. Duplicate
  // samples do not rewind the animation. Cap prediction during a stalled player.
  class Clock{
    constructor(now=()=>Date.now()/1000){this.now=now;this.reset(0);}
    reset(position,duration=180,loop=false){this.position=position;this.sample=position;this.duration=duration;this.loop=loop;this.at=this.now();this.running=false;}
    start(){this.at=this.now();this.started=this.at;this.running=true;}
    value(){let t=this.position+(this.running?Math.min(.6,Math.max(0,this.now()-this.at)):0);return this.loop?t%this.duration:Math.min(this.duration,t);}
    sync(position){
      if(!Number.isFinite(position)||position===this.sample)return;
      // A seek may briefly report the old audio position after onPlay fires.
      if(this.running&&this.now()-this.started<.4&&Math.abs(position-this.value())>.75)return;
      const predicted=this.value(),difference=position-predicted;
      this.position=this.running&&Math.abs(difference)<.2?predicted+difference*.2:position;
      this.sample=position;this.at=this.now();
    }
    pause(){this.position=this.value();this.at=this.now();this.running=false;}
  }
  return {prepare,frame,overlay,rhythm,Clock};
});
