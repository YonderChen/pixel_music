# 图鸣 · PixelMusic

一个将图片特征映射为音乐、将乐谱生成抽象画的浏览器实验。图片分析与声音生成都在浏览器里完成，不上传图片。

## 现在怎么用

- 在线：<https://pixel-music.pages.dev>。图片演奏页是 `dist/index.html`（与 `dist/feature-music.html` 相同），乐曲成画页是 `dist/music-art.html`。
- 本地：直接双击 `dist/index.html`，或见下文“本地运行”。不需要安装依赖，也不需要启动计算服务。
- 发布：Cloudflare Pages 只从 `release` 分支发布，推送 master 不会更新正式站。发布当前 master 用 `git fetch origin master && git push origin origin/master:release`，详见 [静态部署说明](./docs/STATIC_WEB_DEMO.md#cloudflare-发布)。
- 文档：各阶段的说明与报告都在 [docs/](./docs/)，[文档索引](./docs/README.md) 标出了哪些仍描述当前功能、哪些是历史记录。下文按版本从新到旧排列；越往下越是历史记录，其中提到的本机服务、GS 采样音源和 `127.0.0.1` 地址都已不再使用。

## 最新：区域分割 Demo 0.9

"演奏组合"新增并默认选中"区域分割 / 柔和合成混音"：图片按内容分成形状各异的区域，可在"方格种子 · 区域生长""四叉树 · 分裂合并""SLIC 超像素"之间切换；区域按纵向位置分到各声部，演奏顺序可选视线游走（默认）、显著度分层、从左到右、全图一条路径或纯显著度，区域越大音越长。打开"轮廓参与"后，区域边缘起伏成旋律动机，形状决定奏法、音色、起音与滑音，被包围的区域由外层给出持续低音。"柔化轮廓"把锯齿边界磨圆并画成平滑曲线。纯白图只有一个区域、一个长音。[说明与验证](./docs/REGION_DEMO.md)

打开"轮廓参与"后可在四种"轮廓演奏方式"之间切换：起伏动机（默认）、量化取样 · 滑音、线条演奏（横向时间、纵向音高），以及扫描线（一条竖线从左到右扫过，经过的每条区域分界都发声，分界越高音越高，区域颜色决定音色）。[轮廓如何参与演奏](./docs/CONTOUR_MUSIC.md)

乐曲成画新增"扫描长卷"画风：横向是时间、纵向是音高，播放时竖线扫过，亮度随声音衰减。[乐曲成画说明](./docs/MUSIC_ART_DEMO.md#2026-10-17--参照图片演奏的优化)

## 编曲版与参考条带优化版 Demo 0.8.1

"演奏组合"新增两项：
- "编曲版 · 声部分工与和声"：各行分担主旋律、副旋律、分解和弦与低音；和弦、节奏与旋律只随图片变化而变化，纯色图几乎静止。
- "行内参考条带 · 优化 / 柔和合成混音"：沿用参考条带的每个音，按图片上下分八度、按音区配柔和音色，伴奏改为由实际音符推出的和声铺底。

两者都修正了上游 MIDI 时间编码（当时在 GS 采样音源下发现，GS 现已移除）；原三种组合保留用于 A/B 试听。样本新增 7 幅公有领域世界名画，默认打开《星月夜》。[说明与验证](./docs/ARRANGED_DEMO.md)

## 静态网页版 0.7

现在无需启动本机计算服务，整个 `dist` 文件夹就是网站；本地可双击 `dist/index.html` 或 `dist/feature-music.html`。三种保留组合、参考原谱、Simple 音源、移动试听、循环和乐曲成画均使用浏览器计算。可选 `.command` 现在只打开文件。

[静态部署与验收说明](./docs/STATIC_WEB_DEMO.md)。需要 ZIP 交付包时，在项目根目录按需生成：

```sh
node scripts/package_classical_midi.cjs
python3 scripts/package_browser_runtime.py --archive
```

输出为本地 `图鸣-静态网页版.zip`，已加入 Git 忽略规则；日常提交只更新页面、资源和生成脚本。解压后上传全部文件即可发布。资源均随包提供，首次加载较大；服务器建议开启 gzip／Brotli。双击路径已做代码验证，实际浏览器双击验收仍请人工确认。

同一份 `dist` 也发布为 Claude Artifact 站点。`python3 scripts/build_claude_artifact.py` 生成 `build/claude-artifact/`：拆分超过 16 MB 单文件上限的计算资源，去掉主页面的文档外壳，再把整个文件夹发布到原 Artifact 链接。Artifact 页面内无法下载文件（保存 WAV、原 MIDI、PNG／SVG 导出）。

下面记录此前实验版本。旧版原生服务与 Python 脚本保留作算法对照，不再是当前网页的运行前提。原像素连绵工作台移至 `dist/pixel-music-legacy.html`。

## 新方向：乐曲成画 Demo 0.1

新增 [乐曲成画工作台](./dist/music-art.html)：将乐谱生成“曲线色层”或“几何色块”抽象画，支持六首古典 MIDI 候选、三首原创样曲对照、现有乐曲送入、MIDI／乐谱 JSON 导入、边听边看、循环及 PNG／SVG 导出。绘画只读取音乐数据。[使用与验收](./docs/MUSIC_ART_DEMO.md)。

## 历史：三种保留组合 Demo 0.6

0.6.2 新增进度条下方的“循环播放”开关，整曲播完后自动从头继续，播放中可随时开启或关闭；12 秒对照与单音试听仍播放一次。循环复用音频缓存，暂停和移动试听会停止整曲。[使用与验收](./docs/RETAINED_COMBINATIONS.md)。

0.6.1 新增图片上方的“移动试听”开关：开启并准备音色后，鼠标进入哪个区域就弹奏哪个音符；停在同一区域不重复，移出图片停止。三种组合与参考原谱均支持，点击试听保留。[使用与验收](./docs/RETAINED_COMBINATIONS.md)。

按人工选择固定三种多行叠奏组合：多特征音高转换 · 新＋原有叠加、行内参考条带＋柔和合成混音、局部多特征法＋柔和合成混音。参考原谱继续保留，页面使用一个组合选择框，保留分行、静音／独听、伴奏、原谱对照与 WAV 导出。[打开 Demo](./dist/feature-music.html#feature-original)，[保留清单与验收](./docs/RETAINED_COMBINATIONS.md)。全图蛇形及其它组合退出当前界面，历史实现保留用于复现。

## 柔和混音 Demo 0.4.1

多行叠奏新增默认“柔和合成混音”，参考 play_music_theory 的合成音色、包络、声部平衡与轻回声思路。保留相同图片乐谱及原有叠加，提供等响度试听、逐行独听和当前混音 WAV 导出。[直接体验](./dist/feature-music.html#reference-soft)，[调整与验收说明](./docs/SOFT_MIX_DEMO.md)。

0.4.1 修复打开页面等待过重与失败后主要按钮持续禁用的问题：图片与乐谱先显示，音频按需生成，支持取消与重新生成；声音输出保持一致。

## 多行横向叠奏 Demo 0.3

本机工作台新增“多行叠奏”入口：将图片分成 2／3／4 行，各行从左到右同时演奏，共享音阶与速度，支持逐行静音、独听、分行时间轴及当前组合 WAV 导出。[方向与验收说明](./docs/HORIZONTAL_ROWS_DEMO.md)。当时需要本机音源服务，现在由静态网页版取代。

## 全图特征旋律 Demo 0.2

当时双击 `启动全图特征Demo.command` 会启动本机音源服务，使用 Photo Sonification 的分析、编曲与 GS 采样音源，提供参考原谱对照；新版主旋律由二维区域的色相、饱和度、明暗、对比度与纹理共同生成，详见 [交付与验收说明](./docs/FEATURE_DEMO_DELIVERY.md)。现在 GS 音源与 FluidSynth 准备脚本都已删除，`.command` 只打开静态网页；旧本机服务 `scripts/reference_server.py` 仍可运行，但只有 Simple 音源。

## 条带声化 Demo 0.1

新增独立实验入口：[dist/sonification.html](./dist/sonification.html)，直接双击即可打开。32 条带从左到右演奏，亮部重心决定音高，配合整体伴奏、来源高亮、暂停／进度拖动、区域试听和同图 12 秒响度匹配对照。初版待人工试听验收；运行与检查见 [交付说明](./docs/STRIP_DEMO_DELIVERY.md)。现有工作台保留如下。

## 历史：简化连绵演奏实验

此前 **0.6.4-exp / 连绵演奏**：仍按像素颜色计算主音，不检测轮廓；主旋律持续发声、音高平滑滑接，较大升降最多一个中转，不叠加v2回绕。打开 `dist/pixel-music-legacy.html` 后，用“12秒 · 原始／律动／连绵”作同响度对照。原始0.6.1和颗粒律动v2仍可切回。

[本轮交付记录](./docs/LEGATO_DELIVERY.md) 与 [验证摘要](./tests/legato-flow-summary.json) 已完成；用户可以试听后决定新的尝试方向，本轮不再自动调整。

[原轮廓改造计划](./docs/VISUAL_SCORE_REDEVELOPMENT_PLAN.md) 已按用户最新方向暂缓，保留原M0记录，不作为当前执行入口。当前快速实验不等于原33项方案完成。

[M0历史交付报告](./docs/M0_IMPLEMENTATION_REPORT.md) 汇总当时的冻结基线与23套验证。当前UI接入实验已有变化，M0封板SHA检查不再适用于当前UI，不更新旧摘要来假装未改。实验检查运行 `node tests/pixel-expression.test.cjs`，旧核心仍保留作精确对照。

## 本地运行

直接双击打开 `dist/index.html` 即可使用，不需要安装依赖或启动服务。

如果浏览器限制本地文件，也可以在 `pixel_music` 目录启动仅本机可访问的静态文件服务器：

```bash
python3 -m http.server 4174 --bind 127.0.0.1
```

然后访问 `http://127.0.0.1:4174/dist/index.html`。监听项目根目录也能打开内部试听页；这不是在线发布。

## 历史：像素连绵工作台 0.6 的能力

以下各节记录的是旧工作台 `dist/pixel-music-legacy.html`（0.6.x）及其测试，不是当前图片演奏页。

- 上传、拖放 JPG / PNG / WEBP 图片
- 将图片居中裁切、规范化为 192×120 像素，分别显示图像指纹与乐谱事件指纹
- PixelMusic 0.6.1：24×5 个区域沿蛇形路径访问，每个区域保留声音出处与点击试听
- 120 个区域与实际起音分离：相同声音可以跨区域、跨小节持续，不强制敲击 120 次
- 纯色图仍只有一个图像音高片段，默认用稀疏同音轻奏与自然衰减代替长时间蜂鸣；纯白 22 次起音，不是 120 次敲击
- 可选“连续声景”保留原来的持续音；两种奏法不增加旋律、高潮或和弦循环
- 特征驱动音高目标与结构边界，累计漂移避免吞并渐变；周期、方向与相位支持纹理起音
- 多尺度、居中的色彩周期统计区分组织纹理与噪声；没有图片依据，不用位置或哈希补音
- 图像片段与演奏事件分开：结构起音来自图片，稳定长段的轻奏间隔来自明确标注的奏法规则
- 仍为 64 拍、16 个时间参考小节；四段导航只表示图像位置，不强制四段音乐剧情
- 速度设计范围 76–104 BPM、2 BPM 一档；有依据的局部速度变化复用统一时间轴，纯色保持恒速
- 低音／铺底是有区域依据的条件事件；纯色默认无伴奏，既有转位平滑保留
- 轻奏有攻击、衰减与释放，间隔真正安静；连续模式使用持续包络；音色切换不移动播放／扫描时间原点，也不在留白里复活旧音
- 可点击任何区域短试听，多个区域可以试听同一个声音，这是正确映射而非缺失音符
- 暖键（默认）、晶体、弦雾三种本地合成音色，无在线音源
- 120 个区域按音频时间高亮，奏法留白时扫描仍前进；自然结束保留尾音
- 播放中切换音色不重置进度或改变乐谱，响应式移动端布局
- 图像、区域映射、实际节奏与完整声音事件分别计算指纹；扫描格不冒充起音差异
- 在本机生成并保存完整音乐 WAV，不上传图片或音频

确定性约定是“相同规范化像素、作曲版本和设置 → 相同乐谱事件”。图片解码、缩放、色彩管理可能因浏览器而异；不承诺不同图片绝不撞谱，也不承诺最终 WAV 字节跨浏览器完全相同。摘要不是密码学哈希。

## 轻奏与连续声景对照

直接打开 `tests/articulation-listen.html`，或点击工作台的“轻奏与长音 · 本地对照试听”。默认比较纯白与夕阳，四段使用同图、同音高、同速度，匹配片段 RMS。可查看图像片段／实际起音／留白，生成 168 组跨环境快照，运行 288 组真实音频回归，并生成纯白暖键的 16 秒示例 WAV 数据。

本次不把奏法留白解释成像素变化。84 图中仅 26 图包含满足条件的稳定长段；夕阳、完整横向渐变和棋盘等原图像节奏未套用固定脉冲。

## 历史图像忠实性对照

直接打开 `tests/fidelity-listen.html`。默认比较纯白与完整灰阶渐变，生成冻结 0.5 与冻结 0.6 共四段音频，匹配片段 RMS 响度。提供三个档：

- 完整表达：各图自己的速度、音高、包络与条件伴奏。
- 固定速度：统一 88 BPM，保留各图原音高及伴奏。
- 仅起音结构：同音高、无伴奏、88 BPM，保留长音与重触发的真实区别，不把长音切回 120 次起音。

诊断页还可查看区域与事件的双向映射、生成 84 图快照、运行 324 组真实音频回归，以及纯白／夕阳的 PNG、JPG、WEBP 真编解码与 18 次渲染检查；无需安装依赖。工作台的“也试试纯白图片”仅提供示例内容，不是生成器的白图特殊分支。

历史 `tests/rhythm-listen.html` 保留 0.4 → 0.5 对照，`tests/listen.html` 保留 0.3 → 0.4 盲听与可选评分；均使用冻结模块。评分只在页面内存中，需手动导出，不上传、不自动代填。

按用户要求，本轮不以主观评分作为完成条件。自动测试能够证明节奏结构有差异、音乐约束和音频安全满足要求，不代表“所有人都觉得更好听”。

## 编曲检查（旧工作台）

安装了 Node.js 的环境可运行：

```bash
node tests/articulation.test.cjs
node tests/articulation-audio.test.cjs
node tests/articulation-browser.test.cjs
node tests/local-bundle.test.cjs
```

这些检查覆盖 84 图两种奏法、与旧图像事件的精确对照、504 组图／奏法／音色排程（25,716 个实际起音）、自然衰减、留白中接续、168 个真实浏览器／Node 快照及五页经典脚本资源图。

0.6 忠实性基线测试仍可运行：

```bash
node tests/fidelity.test.cjs
node tests/fidelity-parameters.test.cjs
node tests/fidelity-audio.test.cjs
node tests/fidelity-timing.test.cjs
node tests/fidelity-browser.test.cjs
node tests/fidelity-normalization.test.cjs
```

这些检查覆盖 84 图常规与简化路径、432 组跨调式／调性参数、256 档纯灰、32 组相同颜色分布噪声对照、252 组排程、336 组途中接续，以及真实 Chromium／Node 的声音、映射与节奏快照。

更早的历史回归继续运行，旧约束不会强加给当前奏法：

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

其中六个 `fidelity` 专项使用冻结 0.6，`music / rhythm / audio / timing / browser-snapshot` 使用冻结 0.5；`baseline` 为 0.4，`legacy` 验证 0.3 兼容，`listening` 仅检验历史统计工具。五个 HTML 的资源图与经典脚本顺序由 `local-bundle` 检查，不冒充实时 `file://` 浏览器测试。

旧工作台的 288 组真实音频检查全部通过，54 组轻奏波形确认自然衰减与静音间隔。用户于 2026-10-07 针对 0.6.1 的本地功能确认清单回复“都正常”，完成两种奏法播放、区域试听与 WAV 保存的直接 HTML 验收。此项是用户手动确认，不是文件协议自动化测试，也不是主观听感评分。0.6 的 324 组渲染、18 次格式检查与手动确认继续保留为历史，不替代新版证据。

旧工作台 0.6.x 的实现与验证见 [ARTICULATION_IMPLEMENTATION_REPORT.md](./docs/ARTICULATION_IMPLEMENTATION_REPORT.md)、[tests/articulation-regression-summary.json](./tests/articulation-regression-summary.json)。原 [IMAGE_FIDELITY_ADJUSTMENT_PLAN.md](./docs/IMAGE_FIDELITY_ADJUSTMENT_PLAN.md)、[FIDELITY_IMPLEMENTATION_REPORT.md](./docs/FIDELITY_IMPLEMENTATION_REPORT.md)、[tests/fidelity-regression-summary.json](./tests/fidelity-regression-summary.json) 保留为 0.6 历史；0.5 与 0.4 的报告也不覆盖。
