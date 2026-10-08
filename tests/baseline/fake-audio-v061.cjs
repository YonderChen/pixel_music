const assert=require('node:assert/strict');
class Param{
  constructor(value=0){this.value=value;this.events=[];}
  record(type,value,time){assert.ok(Number.isFinite(value)&&Number.isFinite(time)&&time>=0);this.events.push({type,value,time});}
  setValueAtTime(v,t){this.record('set',v,t);} exponentialRampToValueAtTime(v,t){assert.ok(v>0);this.record('exponential',v,t);} linearRampToValueAtTime(v,t){this.record('linear',v,t);} cancelScheduledValues(t){assert.ok(t>=0);}
}
class Node{
  constructor(kind){this.kind=kind;for(const name of ['gain','frequency','delayTime','threshold','ratio','knee'])this[name]=new Param(name==='gain'?1:0);this.disconnected=false;}
  connect(){} disconnect(){this.disconnected=true;} start(time){assert.ok(time>=0);this.started=time;} stop(time){assert.ok(time>=0);this.stops=(this.stops||[]).concat(time);}
}
class Context{
  constructor(){this.currentTime=0;this.destination=new Node('destination');this.nodes=[];}
  make(kind){const node=new Node(kind);this.nodes.push(node);return node;}
  createGain(){return this.make('gain');} createBiquadFilter(){return this.make('filter');} createDelay(){return this.make('delay');} createDynamicsCompressor(){return this.make('compressor');} createOscillator(){return this.make('oscillator');}
}
module.exports={Param,Node,Context};
