# 图鸣 · PixelMusic

一个将图片像素确定性映射为音乐的网页版 MVP。所有图像分析和声音合成都在浏览器本地完成。

## 本地运行

直接双击打开 `dist/index.html` 即可使用，不需要安装依赖或启动服务。

如果浏览器限制本地文件，也可以在 `pixel_music` 目录启动仅本机可访问的静态文件服务器：

```bash
python3 -m http.server 4174 --bind 127.0.0.1
```

然后访问 `http://127.0.0.1:4174/dist/index.html`。监听项目根目录也能打开内部试听页；这不是在线发布。

## 当前能力

- 上传、拖放 JPG / PNG / WEBP 图片
- 将图片居中裁切、规范化为 192×120 像素，分别显示图像指纹与乐谱事件指纹
- PixelMusic 0.6.0：24×5 个区域沿蛇形路径访问，每个区域保留声音出处与点击试听
- 120 个区域与实际起音分离：相同声音可以跨区域、跨小节持续，不强制敲击 120 次
- 纯色图是一次起音、一个稳定音高，没有固定高潮、和弦进行、句间变速或内部力度弧线
- 特征驱动音高目标与结构边界，累计漂移避免吞并渐变；周期、方向与相位支持纹理起音
- 多尺度、居中的色彩周期统计区分组织纹理与噪声；没有图片依据，不用位置或哈希补音
- 起音次数 1–120、时值及边界留白随图片变化，不再要求每小节最低音符数
- 仍为 64 拍、16 个时间参考小节；四段导航只表示图像位置，不强制四段音乐剧情
- 速度设计范围 76–104 BPM、2 BPM 一档；有依据的局部速度变化复用统一时间轴，纯色保持恒速
- 低音／铺底是有区域依据的条件事件；纯色默认无伴奏，既有转位平滑保留
- 真正的持续包络与起止淡入淡出；音色切换接续当前长音，不移动播放／扫描时间原点
- 可点击任何区域短试听，多个区域可以试听同一个声音，这是正确映射而非缺失音符
- 暖键（默认）、晶体、弦雾三种本地合成音色，无在线音源
- 120 个区域按音频时间高亮，长音内扫描仍前进；自然结束保留尾音
- 播放中切换音色不重置进度或改变乐谱，响应式移动端布局
- 图像、区域映射、实际节奏与完整声音事件分别计算指纹；扫描格不冒充起音差异
- 在本机生成并保存完整音乐 WAV，不上传图片或音频

确定性约定是“相同规范化像素、作曲版本和设置 → 相同乐谱事件”。图片解码、缩放、色彩管理可能因浏览器而异；不承诺不同图片绝不撞谱，也不承诺最终 WAV 字节跨浏览器完全相同。摘要不是密码学哈希。

## 图像忠实性对照

直接打开 `tests/fidelity-listen.html`，或点击工作台的“图像忠实性 · 本地对照试听”。默认比较纯白与完整灰阶渐变，生成冻结 0.5 与新版 0.6 共四段音频，匹配片段 RMS 响度。提供三个档：

- 完整表达：各图自己的速度、音高、包络与条件伴奏。
- 固定速度：统一 88 BPM，保留各图原音高及伴奏。
- 仅起音结构：同音高、无伴奏、88 BPM，保留长音与重触发的真实区别，不把长音切回 120 次起音。

诊断页还可查看区域与事件的双向映射、生成 84 图快照、运行 324 组真实音频回归，以及纯白／夕阳的 PNG、JPG、WEBP 真编解码与 18 次渲染检查；无需安装依赖。工作台的“也试试纯白图片”仅提供示例内容，不是生成器的白图特殊分支。

历史 `tests/rhythm-listen.html` 保留 0.4 → 0.5 对照，`tests/listen.html` 保留 0.3 → 0.4 盲听与可选评分；均使用冻结模块。评分只在页面内存中，需手动导出，不上传、不自动代填。

按用户要求，本轮不以主观评分作为完成条件。自动测试能够证明节奏结构有差异、音乐约束和音频安全满足要求，不代表“所有人都觉得更好听”。

## 编曲检查

安装了 Node.js 的环境可运行：

```bash
node tests/fidelity.test.cjs
node tests/fidelity-parameters.test.cjs
node tests/fidelity-audio.test.cjs
node tests/fidelity-timing.test.cjs
node tests/fidelity-browser.test.cjs
node tests/fidelity-normalization.test.cjs
node tests/local-bundle.test.cjs
```

这些检查覆盖 84 图常规与简化路径、432 组跨调式／调性参数、256 档纯灰、32 组相同颜色分布噪声对照、252 组排程、336 组途中接续，以及真实 Chromium／Node 的声音、映射与节奏快照。

历史回归继续运行，旧约束不会强加给 0.6：

```bash
node tests/music.test.cjs
node tests/rhythm.test.cjs
node tests/audio.test.cjs
node tests/timing.test.cjs
node tests/baseline.test.cjs
node tests/legacy.test.cjs
node tests/listening.test.cjs
node tests/browser-snapshot.test.cjs
```

其中 `music / rhythm / audio / timing / browser-snapshot` 使用冻结 0.5；`baseline` 为 0.4，`legacy` 验证 0.3 兼容，`listening` 仅检验历史统计工具。四个 HTML 的资源图与经典脚本顺序由 `local-bundle` 检查，不冒充实时 `file://` 浏览器测试。

本轮 324 组真实音频回归及 18 次格式渲染已通过，63 组单持续音的中段 RMS 最大／最小比不超过 1.001；纯白仍遍历全部 120 区域。用户于 2026-10-07 手动确认直接打开 0.6 HTML 后，生成、播放、高亮、区域试听与 WAV 保存均正常；这不是文件协议自动化测试，也不是沿用 0.5 的旧确认。

本轮设计见 [IMAGE_FIDELITY_ADJUSTMENT_PLAN.md](./IMAGE_FIDELITY_ADJUSTMENT_PLAN.md)，实施与验证状态见 [FIDELITY_IMPLEMENTATION_REPORT.md](./FIDELITY_IMPLEMENTATION_REPORT.md)，机器摘要见 [tests/fidelity-regression-summary.json](./tests/fidelity-regression-summary.json)。0.5 的 [RHYTHM_IMPLEMENTATION_REPORT.md](./RHYTHM_IMPLEMENTATION_REPORT.md) 和 0.4 的 [IMPLEMENTATION_REPORT.md](./IMPLEMENTATION_REPORT.md) 保留为历史。
