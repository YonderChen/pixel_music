(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./fixtures.js'):root.PixelMusicFixtures,typeof module==='object'&&module.exports?require('./rhythm-fixtures.js'):root.PixelMusicRhythmFixtures);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.PixelMusicFidelityFixtures=api;
})(typeof globalThis==='object'?globalThis:this,function(Base,Extended){
  'use strict';
  const colours=[[255,255,255],[0,0,0],[32,32,32],[96,96,96],[128,128,128],[192,192,192],[254,254,254],[255,0,0],[0,255,0],[0,0,255],[0,255,255],[255,0,255]];
  const extraNames=['精确纯白','精确纯黑','纯灰 32','纯灰 96','纯灰 128','纯灰 192','接近纯白 254','纯红','纯绿','纯蓝','纯青','纯品红','纯白轻微噪声','纯灰轻微噪声','全范围横向灰阶渐变','全范围纵向灰阶渐变','白底局部红色块','同均值细棋盘','同均值横纹','同均值纵纹','七像素有组织纹理','相同颜色分布打乱','微小累积渐变','白底黑色区域'];
  const names=[...Base.names,...Extended.names,...extraNames];
  function extraPixels(index){
    const data=new Uint8ClampedArray(192*120*4);let seed=7301;
    const random=()=>{seed=Math.imul(seed,1664525)+1013904223|0;return(seed>>>0)/4294967296;};
    for(let y=0;y<120;y++)for(let x=0;x<192;x++){
      let rgb;
      if(index<12)rgb=colours[index];
      if(index===12)rgb=[0,0,0].map(()=>255-Math.floor(random()*3));
      if(index===13)rgb=[0,0,0].map(()=>128+Math.floor(random()*5)-2);
      if(index===14||index===15){const value=255*(index===14?x/191:y/119);rgb=[value,value,value];}
      if(index===16)rgb=x>=72&&x<80&&y>=48&&y<72?[230,30,30]:[255,255,255];
      if(index===17||index===18||index===19){const bright=index===17?(Math.floor(x/4)+Math.floor(y/4))%2:index===18?Math.floor(y/4)%2:Math.floor(x/4)%2;rgb=bright?[220,220,220]:[36,36,36];}
      if(index===20||index===21)rgb=(x+y*3)%7<3?[55,90,99]:[193,164,116];
      if(index===22){const value=125+15*x/191;rgb=[value,value,value];}
      if(index===23)rgb=x>=88&&x<96&&y>=24&&y<48?[0,0,0]:[255,255,255];
      data.set([...rgb,255],(y*192+x)*4);
    }
    if(index===21){for(let i=192*120-1;i>0;i--){const j=Math.floor(random()*(i+1));for(let c=0;c<4;c++){const value=data[i*4+c];data[i*4+c]=data[j*4+c];data[j*4+c]=value;}}}
    return data;
  }
  function pixels(index){
    if(!Number.isInteger(index)||index<0||index>=names.length)throw new Error('未知忠实性测试图');
    return index<12?Base.pixels(index):index<60?Extended.pixels(index-12):extraPixels(index-60);
  }
  return {names,extraNames,pixels,width:192,height:120};
});
