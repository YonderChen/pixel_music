(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MusicArtCore=api;})(typeof window==='object'?window:this,function(){
  'use strict';
  const VERSION='music-art-v1',STORAGE_KEY='pixelmusic-art-performance-v1',W=1200,H=900;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const num=(v,f=0)=>Number.isFinite(Number(v))?Number(v):f;
  const round=v=>Math.round(v*10000)/10000;
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  function hash(value){let n=2166136261;for(const c of value){n^=c.charCodeAt(0);n=Math.imul(n,16777619);}return n>>>0;}
  const palettes={
    clay:{name:'陶土与青绿',paper:'#f4efe3',ink:'#334d49',colors:['#ba5841','#dd9c59','#547c75','#a5b5a0']},
    blue:{name:'靛蓝与雾紫',paper:'#f0eee7',ink:'#233d59',colors:['#365b7e','#7c849e','#b59c98','#c6b899']},
    moss:{name:'苔绿与麦金',paper:'#f2efe1',ink:'#3c5147',colors:['#637b5b','#ac914f','#b76a4b','#9aaca0']}
  };
  // Timbre families mirror the image side's sweep mode, where region colour chose the voice
  // (warm→暖键, yellow→圆木琴, green→柔拨弦, blue→轻铃, low→柔低音); here the voice chooses the colour.
  const FAMILIES={keys:'暖键',marimba:'圆木琴',pluck:'柔拨弦',bell:'轻铃',pad:'铺底弦乐',bass:'柔低音'};
  const familyColors={
    clay:{keys:'#ba5841',marimba:'#d39a3c',pluck:'#5f8a5a',bell:'#3f6f94',pad:'#8a6f9e',bass:'#2f4743'},
    blue:{keys:'#b4644f',marimba:'#c9a44f',pluck:'#5d8a78',bell:'#365b7e',pad:'#7c749e',bass:'#233d59'},
    moss:{keys:'#b76a4b',marimba:'#ac914f',pluck:'#637b5b',bell:'#4f7896',pad:'#8b7a98',bass:'#34473e'}
  };
  function family(e){
    const name=String(e.instrument).toLowerCase(),program=name.startsWith('midi-')?Number(name.slice(5)):null;
    if(/bass|低音/.test(name)||(program>=32&&program<40))return 'bass';
    if(/bell|轻铃/.test(name)||(program>=8&&program<16&&program!==12&&program!==13))return 'bell';
    if(/marimba|圆木琴/.test(name)||program===12||program===13)return 'marimba';
    if(/guitar|pluck|柔拨弦/.test(name)||(program>=24&&program<32)||(program>=104&&program<112))return 'pluck';
    if(/strings|pad|string|铺底/.test(name)||(program>=40&&program<56)||(program>=88&&program<96))return 'pad';
    return e.midi<48?'bass':'keys';
  }
  // Same envelope classes as the page's score synthesizer, so playback marks fade with the sound.
  const envelope=instrument=>/strings|pad|midi-(4[0-9]|5[0-5])/.test(instrument)?'strings':/bell|marimba|轻铃|圆木琴|midi-(8|9|10|11|12|13|14|15)/.test(instrument)?'bell':'keys';
  function timbre(instrument){const name=String(instrument).toLowerCase(),program=name.startsWith('midi-')?Number(name.slice(5)):null;if(/bell|轻铃/.test(name)||(program>=8&&program<16))return .9;if(/marimba|圆木琴/.test(name))return .75;if(/guitar|pluck|柔拨弦/.test(name)||(program>=24&&program<40))return .6;if(/strings|pad/.test(name)||(program>=40&&program<56))return .15;if(/percussion/.test(name))return 1;return .35;}
  function normalize(input){
    if(!input||!Array.isArray(input.events))throw new Error('请选择包含音符的乐谱。');
    if(input.events.length>5000)throw new Error('本轮支持最多 5000 个音符，请选较短的片段。');
    const events=input.events.filter(e=>e&&Number.isFinite(Number(e.midi))&&e.midi!==null&&num(e.duration)>0&&num(e.velocity,.65)>0&&e.instrument!=='none').map(e=>({
      start:round(Math.max(0,num(e.start))),duration:round(clamp(num(e.duration),.005,180)),midi:clamp(Math.round(num(e.midi)),0,127),
      velocity:round(clamp(num(e.velocity,.65),.01,1)),instrument:String(e.instrument??'piano').slice(0,64),pan:round(clamp(num(e.pan),-1,1)),
      voice:String(e.voice??e.rowId??(e.layer==='main'?'melody':e.layer??'melody')).slice(0,64),layer:String(e.layer??'main').slice(0,24)
    })).sort((a,b)=>a.start-b.start||a.voice.localeCompare(b.voice)||a.midi-b.midi);
    const musicalDuration=Math.max(0,...events.map(e=>e.start+e.duration));
    const duration=round(Math.max(.5,num(input.duration),musicalDuration));
    if(duration>180)throw new Error('本轮支持 3 分钟以内的乐曲，请截取一个片段。');
    return {version:VERSION,title:String(input.title??'未命名乐曲').slice(0,100),tempo:round(clamp(num(input.tempo,90),20,300)),duration,events};
  }
  function fingerprint(score){return hash(JSON.stringify([score.tempo,score.duration,score.events.map(e=>[e.start,e.duration,e.midi,e.velocity,e.instrument,e.pan,e.voice,e.layer])])).toString(16).padStart(8,'0');}
  function fromPerformance(payload,selection){
    const value=payload.variants[selection.mode],parallel=selection.mode==='parallel';
    const events=value.events.filter(e=>!parallel||e.layer!=='main'||selection.rows[e.row]).filter(e=>e.layer==='main'||selection.backing).map(e=>({start:e.start,duration:e.duration,midi:e.midi,velocity:e.velocity,instrument:parallel&&selection.profile==='soft'&&e.layer==='main'?value.mixProfiles.soft.voices?.[e.row]??e.instrument:e.instrument,pan:e.pan,voice:e.rowId??e.layer,layer:e.layer}));
    const score=normalize({title:selection.title,tempo:payload.info.tempo,duration:value.duration,events});
    const key=payload.key,profile=selection.profile;
    if(payload.browserEngine){
      const fields=['id','start','duration','midi','velocity','instrument','pan','layer','rowId','row','pitchTransition','curveMidi','voicePreset','toneScale','attackScale','bend'];
      score.audioRef={kind:'browser-score',variant:selection.mode,profile,synth:payload.settings.synth,backing:payload.settings.backing,background:selection.backing,rows:selection.rows.map((on,i)=>on?'row-'+i:null).filter(Boolean),info:payload.info,voices:(value.voices||[]).map(v=>Object.fromEntries(Object.entries({id:v.id,row:v.row,name:v.name,role:v.role,gain:v.gain,fixedMidi:v.fixedMidi,voicePreset:v.voicePreset}).filter(([,x])=>x!==undefined))),events:value.events.map(e=>Object.fromEntries(fields.filter(f=>e[f]!==undefined).map(f=>[f,e[f]])))};
      return score;
    }
    score.audioRef=parallel&&selection.rows.some(on=>!on)?{kind:'rowmix',key,rows:selection.rows.map((on,i)=>on?'row-'+i:null).filter(Boolean),background:selection.backing,profile}:
      {kind:'wave',url:parallel?value.mixProfiles[profile].audioUrl:value.audioUrl};
    return score;
  }
  function describe(score){
    const list=score.events,weight=list.reduce((s,e)=>s+e.duration*e.velocity,0)||1;
    const pitch=list.reduce((s,e)=>s+e.midi*e.duration*e.velocity,0)/weight;
    const groups=new Map();
    list.forEach(e=>{if(!groups.has(e.voice))groups.set(e.voice,[]);groups.get(e.voice).push(e);});
    const voices=Array.from(groups,([id,events])=>({id,events,energy:events.reduce((s,e)=>s+e.duration*e.velocity,0),main:events.some(e=>e.layer==='main')})).sort((a,b)=>Number(b.main)-Number(a.main)||b.energy-a.energy||a.id.localeCompare(b.id));
    const classes=Array(12).fill(0);list.forEach(e=>classes[e.midi%12]+=e.duration*e.velocity);
    const dominant=classes.indexOf(Math.max(...classes));
    return {pitch,voices,dominant,density:list.length/score.duration,velocity:list.reduce((s,e)=>s+e.velocity,0)/Math.max(1,list.length),range:list.length?[Math.min(...list.map(e=>e.midi)),Math.max(...list.map(e=>e.midi))]:[0,0]};
  }
  function groupNotes(voice,duration,count){
    const bins=new Map();
    for(const e of voice.events){const i=Math.min(count-1,Math.floor(e.start/duration*count));if(!bins.has(i))bins.set(i,[]);bins.get(i).push(e);}
    return Array.from(bins,([i,events])=>{
      const weight=events.reduce((s,e)=>s+e.duration*e.velocity,0);
      return {start:Math.min(...events.map(e=>e.start)),end:Math.max(...events.map(e=>e.start+e.duration)),midi:events.reduce((s,e)=>s+e.midi*e.duration*e.velocity,0)/weight,
        velocity:events.reduce((s,e)=>s+e.velocity,0)/events.length,duration:events.reduce((s,e)=>s+e.duration,0)/events.length,count:events.length,voice:voice.id,bin:i,instrument:events[0].instrument};
    });
  }
  // Shared composition coordinates are a drawing convention. Only music enters here.
  function point(scene,n,voiceIndex,t=n.start/scene.score.duration){
    const pace=clamp((scene.score.tempo-90)/90,-.5,1.5);
    const turn=scene.layout*.19,angle=-2.55+t*(5.2+pace*.32)+turn;
    const pitch=clamp((n.midi-60)/36,-.8,1.2),velocity=n.velocity;
    const compose=p=>{const sx=[1,1.03,.84,.95][scene.layout],sy=[1,.77,1.15,1][scene.layout],rotation=[0,.1,-.1,-.36][scene.layout],x=(p.x-600)*sx,y=(p.y-450)*sy;return {x:600+x*Math.cos(rotation)-y*Math.sin(rotation),y:450+x*Math.sin(rotation)+y*Math.cos(rotation),angle:p.angle+rotation};};
    if(scene.style==='ribbons'){
      const radius=218+voiceIndex*21+pitch*108+velocity*35+pace*18+timbre(n.instrument)*18;
      return compose({x:600+Math.cos(angle)*radius*1.36+(t-.5)*90,y:452+Math.sin(angle)*radius*.87-pitch*25,angle});
    }
    const radius=168+voiceIndex*38+pitch*100+timbre(n.instrument)*18;
    return compose({x:600+Math.cos(angle)*radius*1.24,y:450+Math.sin(angle)*radius*.95,angle});
  }
  const STYLES={ribbons:'曲线色层',geometry:'几何色块',scroll:'扫描长卷'};
  // Scan-scroll: the image side's sweep read backwards. Time runs left to right, pitch bottom to top,
  // each voice's melody becomes a boundary line with its colour field below, and every note is drawn
  // where the playback scan line will cross it.
  const SCROLL={x0:104,x1:1100,top:118,bottom:792};
  function shade(hex,amount,palette){
    if(!amount)return hex;const target=amount<0?palette.ink:palette.paper,f=Math.abs(amount),c=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)),a=c(hex),b=c(target);
    return '#'+a.map((v,i)=>Math.round(v+(b[i]-v)*f).toString(16).padStart(2,'0')).join('');
  }
  function scroll(model,paletteId){
    const {score,stats,palette}=model,colors=familyColors[paletteId],D=score.duration;
    const lo0=stats.range[0]-2,hi0=stats.range[1]+2,pad=Math.max(0,24-(hi0-lo0))/2,lo=lo0-pad,hi=hi0+pad;
    const x=t=>round(SCROLL.x0+t/D*(SCROLL.x1-SCROLL.x0)),y=m=>round(SCROLL.bottom-(m-lo)/(hi-lo)*(SCROLL.bottom-SCROLL.top));
    model.scroll={...SCROLL,duration:D,lo,hi};
    let grid='',fields='',lines='',notes='';
    for(let m=Math.ceil(lo/12)*12;m<=hi;m+=12)grid+=`<path d="M${SCROLL.x0} ${y(m)}H${SCROLL.x1}" stroke="${palette.ink}" stroke-opacity=".09" stroke-width=".8" stroke-dasharray="1 5"/><text x="${SCROLL.x0-10}" y="${round(y(m)+4.5)}" text-anchor="end" font-family="ui-monospace,Menlo,monospace" font-size="13" fill="${palette.ink}" fill-opacity=".5">C${m/12-1}</text>`;
    const used=new Set();
    const voices=stats.voices.map(v=>{const counts={};v.events.forEach(e=>counts[family(e)]=(counts[family(e)]??0)+e.duration*e.velocity);const mean=v.events.reduce((s,e)=>s+e.midi,0)/v.events.length,top=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];return {...v,family:top==='keys'&&mean<55?'bass':top,mean};}).sort((a,b)=>b.mean-a.mean);
    const gapLimit=Math.max(.6,D/40),slice=Math.max(.12,D/240);
    const seen={};
    voices.forEach((voice,vi)=>{
      // Voices sharing a timbre keep its hue but step in shade, so parts stay apart.
      const rank=seen[voice.family]=(seen[voice.family]??-1)+1,color=shade(colors[voice.family],[0,-.32,.3,-.55,.5][rank%5],palette),quiet=voice.main?1:.55;
      // The boundary is the voice's upper envelope: the highest note sounding in each short slice, smoothed
      // into a ridge so fast figures read as one line, the way a region edge reads in a photo. Rests break it.
      const ridge=[];for(const e of voice.events){const a=Math.floor(e.start/slice),b=Math.max(a,Math.ceil((e.start+e.duration)/slice)-1);for(let i=a;i<=b;i++)ridge[i]=Math.max(ridge[i]??-1,e.midi);}
      const runs=[];let run=null;for(let i=0;i<ridge.length;i++){if(ridge[i]===undefined){if(run&&(i-run.end)*slice>gapLimit)run=null;continue;}if(!run){run={points:[],end:i};runs.push(run);}run.points.push([i,ridge[i]]);run.end=i;}
      for(const {points} of runs){
        const pts=points.map(([i],k)=>{const a=points[Math.max(0,k-1)][1],b=points[k][1],c=points[Math.min(points.length-1,k+1)][1];return {x:x((i+.5)*slice),y:y((a+2*b+c)/4)};});
        if(pts.length===1)pts.push({x:pts[0].x+2,y:pts[0].y});
        const d=smooth(pts),xa=pts[0].x,xb=pts.at(-1).x;
        fields+=`<path d="${d} L${xb} ${SCROLL.bottom+30} L${xa} ${SCROLL.bottom+30} Z" fill="${color}" fill-opacity="${round(.14*quiet)}"/>`;
        lines+=`<path d="${d}" fill="none" stroke="${color}" stroke-width="${round(1.4+1*quiet)}" stroke-opacity="${round(.8*quiet)}" stroke-linejoin="round" stroke-linecap="round"/>`;
      }
      for(const e of voice.events){
        const fam=family(e),c=fam===voice.family?color:colors[fam];used.add(fam);
        const xs=x(e.start),w=Math.max(3,x(e.start+e.duration)-xs),h=round(3+e.velocity*6),yy=y(e.midi);
        notes+=`<rect x="${xs}" y="${round(yy-h/2)}" width="${round(w)}" height="${h}" rx="${round(h/2)}" fill="${c}" fill-opacity="${round((.42+.4*e.velocity)*quiet)}"/>`;
        if(w>8)notes+=`<circle cx="${xs}" cy="${yy}" r="${round(1.2+e.velocity*1.4)}" fill="${palette.ink}" fill-opacity="${round(.32*quiet)}"/>`;
        model.notes.push({x:xs,y:yy,x1:round(xs+w),start:e.start,end:e.start+e.duration,midi:e.midi,velocity:e.velocity,envelope:envelope(e.instrument),main:e.layer==='main',color:c});
        model.marks.push({x:xs,y:yy,start:e.start,end:e.start+e.duration,voice:voice.id,color:c});
      }
    });
    model.families=Object.keys(FAMILIES).filter(f=>used.has(f)).map(f=>({id:f,name:FAMILIES[f],color:colors[f]}));
    return grid+fields+lines+notes;
  }
  function smooth(points){
    if(!points.length)return '';if(points.length===1)return `M${round(points[0].x)},${round(points[0].y)}`;
    let p=`M${round(points[0].x)},${round(points[0].y)}`;
    for(let i=0;i<points.length-1;i++){
      const a=points[Math.max(0,i-1)],b=points[i],c=points[i+1],d=points[Math.min(points.length-1,i+2)];
      p+=` C${round(b.x+(c.x-a.x)/6)},${round(b.y+(c.y-a.y)/6)} ${round(c.x-(d.x-b.x)/6)},${round(c.y-(d.y-b.y)/6)} ${round(c.x)},${round(c.y)}`;
    }return p;
  }
  function scene(input,options={}){
    const score=normalize(input),stats=describe(score),style=STYLES[options.style]?options.style:'ribbons';
    const auto=stats.pitch>72?'blue':stats.dominant%3===0?'moss':'clay';
    const palette=palettes[options.palette]??palettes[auto],detail=clamp(num(options.detail,.6),.25,1),layout=((Math.floor(num(options.layout))%4)+4)%4;
    const model={score,stats,style,palette,detail,layout,fingerprint:fingerprint(score),width:W,height:H,marks:[],notes:[],families:[]};
    const voices=stats.voices.slice(0,8),counts=style==='ribbons'?Math.round(56+detail*72):Math.round(14+detail*26);
    let body=`<rect width="1200" height="900" fill="${palette.paper}"/><defs><pattern id="paper" width="9" height="9" patternUnits="userSpaceOnUse"><path d="M1 2h.7M6 6h.6" stroke="${palette.ink}" stroke-opacity=".055" stroke-width=".6"/></pattern><clipPath id="artBounds"><rect x="76" y="70" width="1048" height="760" rx="2"/></clipPath></defs><rect width="1200" height="900" fill="url(#paper)"/><g clip-path="url(#artBounds)">`;
    const phraseSpan=score.duration/8;
    if(style==='scroll')body+=scroll(model,options.palette&&palettes[options.palette]?options.palette:auto);
    else for(let vi=voices.length-1;vi>=0;vi--){
      const voice=voices[vi],color=palette.colors[vi%4],color2=palette.colors[(vi+1)%4];
      const notes=groupNotes(voice,score.duration,counts),quiet=voice.main?1:.48;
      if(style==='ribbons'){
        const phrases=[];
        notes.forEach(n=>{let last=phrases.at(-1);if(!last||n.start-last.at(-1).end>score.duration/counts*1.8){last=[];phrases.push(last);}last.push(n);});
        for(const phrase of phrases){
          const center=phrase.map(n=>point(model,n,vi)),mean=phrase.reduce((s,n)=>s+n.velocity,0)/phrase.length;
          if(center.length===1){const p=center[0],n=phrase[0];body+=`<ellipse cx="${round(p.x)}" cy="${round(p.y)}" rx="${round(18+n.duration/score.duration*180)}" ry="${round(7+n.velocity*13)}" fill="${color}" fill-opacity=".3" transform="rotate(${round(p.angle*180/Math.PI)} ${round(p.x)} ${round(p.y)})"/>`;}
          else{
            const width=20+mean*24;
            const rim=phrase.map((n,i)=>({...center[i],x:center[i].x+Math.cos(center[i].angle)*width,y:center[i].y+Math.sin(center[i].angle)*width*.74}));
            body+=`<path d="${smooth(center)} L${round(rim.at(-1).x)},${round(rim.at(-1).y)} ${smooth(rim.slice().reverse()).replace(/^M/,'L')} Z" fill="${color}" fill-opacity="${round(.23*quiet)}"/>`;
            const instrument=voice.events[0].instrument.toLowerCase(),dashed=/pluck|guitar|marimba|bell|柔拨弦|圆木琴|轻铃|midi-(8|9|10|11|12|13|14|15|24|25|26|27)/.test(instrument);
            const traces=Math.round(10+detail*20);
            for(let k=0;k<traces;k++){
              const f=k/(traces-1),pts=phrase.map((n,i)=>{const spread=(f-.5)*(42+44*n.velocity),p=center[i];return {x:p.x+Math.cos(p.angle)*spread,y:p.y+Math.sin(p.angle)*spread*.74};});
              body+=`<path d="${smooth(pts)}" fill="none" stroke="${k%5===0?color2:color}" stroke-width="${round(k%5===0?1.8:1.1)}" ${dashed&&k%3===0?'stroke-dasharray="2 4"':''} stroke-opacity="${round((.44+.3*mean)*quiet)}"/>`;
            }
          }
        }
        notes.forEach(n=>{const p=point(model,n,vi);model.marks.push({...p,start:n.start,end:n.end,voice:n.voice,color});});
      }else{
        notes.forEach(n=>{
          const p=point(model,n,vi),durationRatio=clamp(n.duration/phraseSpan,.015,1);
          const w=18+Math.sqrt(durationRatio)*105,h=13+n.velocity*45,angle=p.angle*180/Math.PI+90;
          const shape=(Math.round(n.midi)+hash(voice.events[0].instrument)%3)%3;
          let mark;
          if(shape===0)mark=`<ellipse cx="0" cy="0" rx="${round(w*.58)}" ry="${round(h*.65)}"/>`;
          else if(shape===1)mark=`<rect x="${round(-w/2)}" y="${round(-h/2)}" width="${round(w)}" height="${round(h)}" rx="${round(3+n.velocity*7)}"/>`;
          else mark=`<path d="M${round(-w*.6)} ${round(h*.42)} L0 ${round(-h*.8)} L${round(w*.6)} ${round(h*.42)} Z"/>`;
          const opacity=round((.34+.36*n.velocity)*quiet);
          body+=`<g transform="translate(${round(p.x)} ${round(p.y)}) rotate(${round(angle)})" fill="${color}" fill-opacity="${opacity}" stroke="${palette.ink}" stroke-opacity=".28" stroke-width=".7">${mark}</g>`;
          if(n.count>2)body+=`<circle cx="${round(p.x)}" cy="${round(p.y)}" r="${round(2+Math.min(n.count,8)*.6)}" fill="${color2}" fill-opacity=".8"/>`;
          model.marks.push({...p,start:n.start,end:n.end,voice:n.voice,color});
        });
      }
    }
    if(style!=='scroll')voices.forEach((voice,vi)=>{const color=palette.colors[vi%4];for(const e of voice.events)model.notes.push({...point(model,e,vi),start:e.start,end:e.start+e.duration,midi:e.midi,velocity:e.velocity,envelope:envelope(e.instrument),main:e.layer==='main',color,voice:vi});});
    if(!score.events.length)body+=`<circle cx="600" cy="450" r="100" fill="none" stroke="${palette.ink}" stroke-opacity=".16" stroke-width=".8"/>`;
    body+='</g>';
    model.svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900" viewBox="0 0 1200 900" role="img" aria-label="${escape(score.title)}的${STYLES[style]}画作"><title>${escape(score.title)}</title><desc>音乐决定形态、疏密和层次。${score.events.length}个音符，${stats.voices.length}个声部。</desc>${body}</svg>`;
    return model;
  }
  function samples(){
    const make=(id,title,tempo,events)=>({id,...normalize({title,tempo,duration:Math.max(...events.map(e=>e.start+e.duration))+.8,events})});
    const event=(start,duration,midi,velocity,voice='melody',instrument='piano',layer='main')=>({start,duration,midi,velocity,voice,instrument,layer,pan:voice==='bass'?-.25:.15});
    const slow=[],fast=[],woven=[];
    const melody=[60,64,67,71,69,67,64,62,60,64,67,72,71,67,64,60];
    melody.forEach((m,i)=>slow.push(event(i*1.2,1.05,m,.5+.13*Math.sin(i*.8))));
    for(let i=0;i<4;i++){slow.push(event(i*4.8,4.2,36+[0,5,7,0][i],.35,'bass','strings','bass'));slow.push(event(i*4.8,4.1,55+[0,5,2,0][i],.26,'pad','strings','pad'));}
    const jumps=[72,79,76,84,79,74,81,76];
    for(let i=0;i<64;i++){const beat=i*.29;fast.push(event(beat,.14+(i%4===0?.1:0),jumps[i%8]+(i>=32?-5:0),i%4===0?.83:.55,'melody','marimba'));if(i%2===0)fast.push(event(beat,.2,43+[0,0,5,7][Math.floor(i/8)%4],.45,'bass','pluck','bass'));}
    for(let i=0;i<32;i++){
      const t=i*.6;woven.push(event(t,.52,60+[0,2,7,4,9,7,4,2][i%8],.62,'keys','piano'));
      woven.push(event(t+.3,.45,72+[7,4,2,0,2,4,7,9][i%8],.38+.17*(i%4===0),'bells','bell'));
      if(i%4===0)woven.push(event(t,2.15,36+[0,5,7,0][Math.floor(i/4)%4],.43,'bass','strings','bass'));
    }
    return [make('slow','缓慢的回声',72,slow),make('fast','轻快的步伐',132,fast),make('woven','交织的声部',100,woven)];
  }
  return {VERSION,STORAGE_KEY,STYLES,normalize,fingerprint,fromPerformance,describe,scene,point,samples,palettes,family};
});
