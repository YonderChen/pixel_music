(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MusicArtMidi=api;})(typeof window==='object'?window:this,function(){
  'use strict';
  function parse(buffer,title='导入的 MIDI'){
    const bytes=new Uint8Array(buffer),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let pos=0;
    const need=n=>{if(pos+n>bytes.length)throw new Error('MIDI 文件不完整。');};
    const u8=()=>{need(1);return bytes[pos++];},u16=()=>{need(2);const v=view.getUint16(pos);pos+=2;return v;},u32=()=>{need(4);const v=view.getUint32(pos);pos+=4;return v;};
    const text=n=>{need(n);const s=String.fromCharCode(...bytes.slice(pos,pos+n));pos+=n;return s;};
    const vlq=()=>{let v=0;for(let i=0;i<4;i++){const b=u8();v=(v<<7)|(b&127);if(!(b&128))return v;}throw new Error('MIDI 时间编码无效。');};
    if(text(4)!=='MThd')throw new Error('请选择标准 MIDI 文件（.mid）。');
    const header=u32();if(header<6)throw new Error('MIDI 文件头无效。');
    const format=u16(),tracks=u16(),division=u16();need(header-6);pos+=header-6;
    if(format>1||division&0x8000||!division)throw new Error('本轮支持 MIDI 0／1 型与常规拍号计时。');
    if(tracks>128)throw new Error('MIDI 音轨过多，请选较小的片段。');
    const tempos=[{tick:0,value:500000}],raw=[];let maxTick=0;
    for(let track=0;track<tracks;track++){
      if(text(4)!=='MTrk')throw new Error('MIDI 音轨无效。');const length=u32();need(length);const end=pos+length;
      let tick=0,running=0;const programs=Array(16).fill(0),pan=Array(16).fill(0),active=new Map(),held=new Map(),pedal=Array(16).fill(false);
      const close=(n,at)=>{if(at>n.tick)raw.push({...n,endTick:at});};
      while(pos<end){
        tick+=vlq();maxTick=Math.max(maxTick,tick);let status=u8();
        if(status<128){pos--;if(!running)throw new Error('MIDI 连续事件缺少状态。');status=running;}
        else if(status<240)running=status;
        if(status===255){running=0;const type=u8(),size=vlq();need(size);if(type===81&&size===3)tempos.push({tick,value:(bytes[pos]<<16)|(bytes[pos+1]<<8)|bytes[pos+2]});pos+=size;}
        else if(status===240||status===247){running=0;const size=vlq();need(size);pos+=size;}
        else if(status>=240)throw new Error('MIDI 包含不支持的系统事件。');
        else{
          const type=status>>4,ch=status&15,a=u8(),b=type===12||type===13?0:u8();if(a>127||b>127)throw new Error('MIDI 音符编码无效。');
          const id=ch+':'+a;
          if(type===9&&b>0){if(!active.has(id))active.set(id,[]);active.get(id).push({tick,midi:a,velocity:b/127,instrument:ch===9?'percussion':'midi-'+programs[ch],voice:'track-'+track+'-'+ch,layer:ch===9?'texture':'main',pan:pan[ch]});}
          else if(type===8||(type===9&&b===0)){const n=active.get(id)?.shift();if(n){if(pedal[ch]){if(!held.has(ch))held.set(ch,[]);held.get(ch).push(n);}else close(n,tick);}}
          else if(type===12)programs[ch]=a;
          else if(type===11){if(a===10)pan[ch]=(b-64)/64;if(a===64){const on=b>=64;if(pedal[ch]&&!on){(held.get(ch)||[]).forEach(n=>close(n,tick));held.delete(ch);}pedal[ch]=on;}}
        }
        if(pos>end)throw new Error('MIDI 音轨长度不正确。');if(raw.length>5000)throw new Error('本轮支持最多 5000 个音符，请截取一个片段。');
      }
      for(const values of active.values())values.forEach(n=>close(n,tick));for(const values of held.values())values.forEach(n=>close(n,tick));pos=end;
    }
    tempos.sort((a,b)=>a.tick-b.tick);const timeline=[];
    for(const t of tempos){if(t.value<=0)continue;const prior=timeline.at(-1);const time=prior?prior.time+(t.tick-prior.tick)*prior.value/1e6/division:0;if(prior?.tick===t.tick)timeline.pop();timeline.push({...t,time});}
    const seconds=tick=>{let i=timeline.length-1;while(i>0&&timeline[i].tick>tick)i--;const t=timeline[i];return t.time+(tick-t.tick)*t.value/1e6/division;};
    const events=raw.map(n=>({start:seconds(n.tick),duration:seconds(n.endTick)-seconds(n.tick),midi:n.midi,velocity:n.velocity,instrument:n.instrument,voice:n.voice,layer:n.layer,pan:n.pan}));
    if(!events.length)throw new Error('这份 MIDI 没有可演奏的音符。');
    return {title,tempo:60e6/timeline[0].value,duration:seconds(maxTick)+.8,events};
  }
  return {parse};
});
