// Pure M0 serialization reference only. It is not loaded by the product.
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PixelMusicIdentitySpecM0=api;})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const VERSION='contour-identity-v1';
  function normalize(value){
    if(value===null||typeof value==='string'||typeof value==='boolean')return value;
    if(typeof value==='number'){
      if(!Number.isFinite(value)||Math.abs(value)>1e6)throw new Error('Invalid identity number');
      const rounded=Math.round(value*1e9)/1e9;return Object.is(rounded,-0)?0:rounded;
    }
    if(Array.isArray(value))return value.map(normalize);
    if(typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype){
      const result={};for(const key of Object.keys(value).sort()){
        if(!/^[a-zA-Z0-9_-]+$/.test(key))throw new Error('Identity keys must be ASCII');result[key]=normalize(value[key]);
      }return result;
    }
    throw new Error('Unsupported identity value');
  }
  const canonical=value=>JSON.stringify(normalize(value));
  function fnv64(text){
    let hash=0xcbf29ce484222325n;for(const byte of new TextEncoder().encode(text))hash=BigInt.asUintN(64,(hash^BigInt(byte))*0x100000001b3n);
    return hash.toString(16).padStart(16,'0');
  }
  const fingerprint=(domain,payload)=>fnv64(VERSION+'\n'+domain+'\n'+canonical(payload));
  return {VERSION,normalize,canonical,fnv64,fingerprint};
});
