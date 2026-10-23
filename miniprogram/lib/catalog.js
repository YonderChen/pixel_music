module.exports = {
  recipes: [
    {name:'区域分割 / 柔和合成混音',method:'regions',profile:'soft'},
    {name:'编曲版 · 声部分工与和声',method:'arranged',profile:'original'},
    {name:'多特征音高转换 / 原有叠加',method:'transition',profile:'original'},
    {name:'行内参考条带 · 优化 / 柔和合成混音',method:'reference-plus',profile:'soft'},
    {name:'行内参考条带 / 柔和合成混音',method:'reference',profile:'soft'},
    {name:'局部多特征法 / 柔和合成混音',method:'features',profile:'soft'}
  ],
  segments: [{name:'方格种子 · 区域生长',value:'grow'},{name:'四叉树 · 分裂合并',value:'quadtree'},{name:'SLIC 超像素',value:'slic'}],
  orders: [{name:'视线游走',value:'gaze'},{name:'显著度分层',value:'tiers'},{name:'从左到右',value:'scan'},{name:'全图一条路径',value:'path'},{name:'纯显著度排序',value:'salience'}],
  contours: [{name:'起伏动机',value:'motif'},{name:'量化取样 · 滑音',value:'grid'},{name:'线条演奏',value:'lines'},{name:'扫描线 · 竖线与分界交点',value:'sweep'}]
};
