# 图鸣 0.7 · 静态网页版

图片转音乐和乐曲成画均可在浏览器中运行。无需安装 Python、FluidSynth，也无需启动计算服务。

## 打开方式

- 本地调试：保留解压后的完整文件夹，双击其中的 `index.html` 或 `feature-music.html`。源码工作区的入口在 `dist` 中。
- 发布：正式站是 <https://pixel-music.pages.dev>，由 Cloudflare 从 `release` 分支发布，见下文“Cloudflare 发布”。自建服务器时，将静态部署包解压后的文件全部上传到网站目录，访问 `index.html`；也可以直接发布整个 `dist` 文件夹。
- 乐曲成画：点击图片演奏页的“把当前乐曲画出来”；或直接打开 `music-art.html` 试样曲、MIDI 与乐谱 JSON。

所有资源随文件夹提供，不依赖 CDN。图片不上传，计算和声音生成在浏览器的后台线程中完成。浏览器要求用户点击播放后才能出声。

## 保留的演奏组合

下表是 0.7 当时的组合。之后又新增了编曲版与参考条带优化版（[0.8.1](./ARRANGED_DEMO.md)）和区域分割（[0.9](./REGION_DEMO.md)，现为默认组合），都同样在浏览器中运行。

| 转换方法 | 演奏与混音 |
| --- | --- |
| 多行叠奏 · 多特征音高转换 · 新 | 原有叠加 |
| 多行叠奏 · 行内参考条带 | 柔和合成混音 |
| 多行叠奏 · 局部多特征法 | 柔和合成混音 |
| 参考原谱 | Photo Sonification 核心规则，Simple 合成 |

保留 2／3／4 行、静音与独听、完整编曲、点击／移动试听、循环、暂停／进度拖动、12 秒对照以及 WAV 导出。

乐曲成画通过乐谱传递当前音源、混音及声部选择，不传递原图片；原组合试听也在浏览器生成。地址片段传递兼容本地文件，不依赖两个页面共享缓存。旧版服务缓存记录请从图片演奏页重新送入。

保存该乐曲的 JSON 后，再次导入绘画页，也能恢复原组合试听。

## 资源与部署

图片演奏页与乐曲成画页共用 `ui.css`（配色、字体、按钮、开关等组件），各自的版式分别在 `studio.css` 与 `music-art.css`；`sonification.css` 只服务旧的条带声化 Demo。品牌图标与分享资源为 `favicon.svg`、`icon-192.png`、`icon-512.png`、`icon-maskable-512.png`、`apple-touch-icon.png`、`og-image.png` 和 `site.webmanifest`。

当前 `dist` 同时包含手写 HTML／CSS／JavaScript 页面、浏览器计算引擎（`engine/`，纯 JavaScript）和生成文件，仍作为开发与部署目录提交。`index.html` 是 `feature-music.html` 的副本；`music-art-classics.js` 由古典 MIDI 文件与清单生成。

日常修改页面可直接预览。修改古典 MIDI 清单或文件后，运行 `node scripts/package_classical_midi.cjs`；修改 `feature-music.html` 后运行 `node scripts/package_static_site.cjs` 同步 `index.html`，该脚本默认不生成 ZIP。

需要交付 ZIP 时，在项目根目录运行：

```sh
node scripts/package_classical_midi.cjs
node scripts/package_static_site.cjs --archive
```

生成的 `图鸣-静态网页版.zip` 仅用于本地交付，已加入 Git 忽略规则，不随日常代码提交更新。网页运行不读取这个 ZIP，可直接发布完整 `dist` 目录。

为保留现有音乐效果，图片分析与编曲继续执行同一套规则。0.10 起，原来在浏览器里用 Pyodide（WebAssembly 版 Python，约 40 MB）运行的 Python 算法全部改写为纯 JavaScript（`dist/engine/`）：图片分析、参考原谱、行内乐谱、编曲、区域分割、Simple 合成、柔和混音与移动试听。为让结果逐音一致，引擎按原运行环境逐运算复刻了 NumPy 的求和顺序、pocketfft、musl 数学库和 CPython 的集合顺序与舍入。JPG 与 PNG 由引擎自己解码，复刻原引擎所用的 IJG libjpeg 9c 与 Pillow 规则，像素与原来完全相同（浏览器自带的 JPG 解码与之相差最多约 80 级，会改变乐谱）；WebP、GIF、HEIC 等其他格式仍由浏览器解码。

GS 采样音源已移除（音色库 31 MiB，超过 Cloudflare 单文件 25 MiB 的上限），参考原谱和"原有叠加"统一使用 Simple 合成。整站约 1.7 MB（此前约 43 MB），计算引擎约 0.3 MB，首次打开不再需要下载大文件。

服务器建议启用 gzip／Brotli 和静态缓存。以 nginx 为例，默认的 `gzip_types` 只包含 HTML，需要加入 `application/javascript`。给 `engine/` 设置缓存（例如 `expires 7d;`）后，再次打开基本无需重新下载；文件名不带版本号，更新部署后如需立即生效可缩短缓存时间。网页加载后不需要后端接口、跨域权限、账户或密钥。使用限制性 CSP 时，需要允许 `script-src 'self' blob:`、`worker-src blob:` 和 `img-src 'self' data: blob:`；现有内联样式也需要相应许可。

这里的“纯前端”不含 WebAssembly 或 Python 运行时，计算全部是普通 JavaScript；后续小程序可直接复用 `dist/engine/`，只需替换图片解码与后台线程的接入方式。

## Cloudflare 发布

网站由 Cloudflare Pages 的 Git 集成发布：构建命令留空，输出目录 `dist`，根目录 `/`。只有推送到 `release` 分支才会更新正式站；日常提交推送 master 不会发布。

发布当前 master：

```sh
git fetch origin master
git push origin origin/master:release
```

Cloudflare 后台对应设置（Pages 项目 → Settings → Builds & deployments → Branch control）：生产分支为 `release`，预览分支设为 None。Cloudflare 单个文件上限 25 MiB，超过时那次部署失败，正式站保持上一版本；`dist/_headers` 为 `engine/` 设置一天缓存，Cloudflare 会自动压缩 JavaScript。

## 本轮验证

以下是 0.7 发布时的验证记录。当时网页还带 GS 采样音源（浏览器版 FluidSynth），GS 现已移除，相关两条只作历史保留。

- 纯静态 HTTP 服务：三种组合与参考原谱生成／播放、循环、移动试听缓存及乐曲成画链路。
- 9 组真实计算对照：三种方法 × 2／3／4 行，音高、起音、时值、力度与配器一致；局部 FFT 元数据最大差异约 0.00033，来自运行平台浮点计算。
- PNG、JPG、WebP 解码和大图缩放检查通过。测试 JPG 的跨平台解码差异带来约 0.204 BPM 的速度差；不承诺任意压缩图片都与旧本机版逐音一致。
- 真实 WASM 渲染：GS、Simple、柔和混音、静音／独听与两类移动音色缓存均生成有限、非静音音频；送入绘画页的柔和独听 WAV 与原页面逐字节一致。
- 本地兼容：脚本以相对文件路径加载，二进制内嵌，后台使用 Blob Worker；代码测试确认不调用 `fetch(file://…)` 或本机接口。验收浏览器的安全策略禁止访问 `file://`，因此未完成实际双击打开的浏览器验收，请在你的 Chrome／Edge／Safari 中试一次。个别浏览器若限制本地 Worker，可使用服务器网址调试。
- GS 采用浏览器版 FluidSynth，与原本机 2.6.1 版本不同，不能宣称波形完全相同。没有替换成简化音色，也没有修正原项目 MIDI 时值编码行为；最终听感仍以人工试听为准。

核心计算检查：`tests/engine/` 下的对照测试把 JavaScript 引擎与原 Pyodide 引擎（从 Git 历史取出，首次运行时缓存到 `build/pyodide-oracle/`）逐项比较，例如 `node tests/engine/scores-parity.test.cjs`、`node tests/engine/audio-parity.test.cjs`；本地路径检查：`node tests/browser-engine-loader.test.cjs`。对照测试需要开发环境，发布文件运行不需要。

开源项目、固定版本、许可与来源见 `engine/THIRD_PARTY.md`。
