# HTML / 微信小程序双端构建

项目不需要 npm 依赖。安装 Node.js 20 或以上版本后，在项目根目录执行：

```sh
npm run build
```

生成两个相互独立的交付目录：

| 命令 | 输出 | 用途 |
| --- | --- | --- |
| `npm run build` | `build/html/`、`build/miniprogram/` | 同时构建两端 |
| `npm run build:html` | `build/html/` | 静态 HTML 网站 |
| `npm run build:miniprogram` | `build/miniprogram/` | 原生微信小程序工程 |

也可以执行 `npm run build -- html` 或 `npm run build -- miniprogram`。输出在 `.gitignore` 的 `build/` 中；不要直接编辑生成目录，下次构建会替换它。构建不上传、不发布，不需要账号或网络。构建时会先运行现有古典 MIDI 生成脚本，并同步 HTML 输出的首页。

## HTML

将 `build/html/` 整个目录交给任意静态托管服务即可。它保留现有 `dist/` 的页面和资源：`index.html` 是图片演奏入口，`music-art.html` 是乐曲成画入口。也可直接双击首页；若浏览器限制本地 Worker，请通过本地 HTTP 服务器预览：

```sh
python3 -m http.server 4174 --directory build/html --bind 127.0.0.1
```

浏览器打开 `http://127.0.0.1:4174`。现有 Cloudflare Pages 从 `dist/` 发布的配置继续有效；如要改用统一构建，将构建命令设为 `npm run build:html`，输出目录设为 `build/html`。

`dist/` 仍是现有网页的可编辑源码目录，不是本次构建输出。历史工作台也随目录保留；其中指向仓库 `tests/` 的开发试听链接不作为静态交付入口。

## 微信小程序

1. 运行 `npm run build:miniprogram`。
2. 微信开发者工具 → 导入项目，选择 `build/miniprogram/`，编译类型选择“小程序”。
3. 默认使用 `touristappid`，便于本地查看源码与基础调试。需要完整模拟、真机预览或上传时使用自己的小程序 AppID。
4. 不需要“构建 npm”，也不需要配置计算服务器或请求域名。

正式 AppID 可在构建时注入，避免把个人配置写入仓库：

```sh
WECHAT_APPID=wx0123456789abcdef npm run build:miniprogram
```

示例 AppID 需要替换成真实值。也可以修改 `miniprogram/project.config.json` 中的 `appid` 作为项目默认值。构建后的 `project.config.json` 直接位于导入目录根部。后续重建会保留已在开发者工具中填写的 AppID，以及生成目录中的 `project.private.config.json`（例如本地基础库版本），避免重新变回测试账号。AppID 优先级为：`WECHAT_APPID` → 源配置中的真实 AppID → 已生成工程的 AppID → `touristappid`。本地配置仍只在忽略的 `build/` 中，不会随源码提交。

工程默认基础库为 3.7.0；如开发者工具提示下载基础库，可使用工具中已安装的更新稳定版本。

小程序是 WXML / WXSS / JavaScript 原生页面，没有用 `web-view` 包网站。图片与乐谱均在本机处理，声音由本机 Worker 生成。构建检查主包体积，超过 2 MiB 会失败并保留上次成功输出。

画布初始化通过页面实例的 `createSelectorQuery()` 查询节点，避免公共模块内的全局查询丢失页面作用域、回调不执行而停在“准备读取样图”。查询会在 5 秒后给出超时提示，“重新生成”会重新尝试初始化。图片文件与像素通过 `ArrayBuffer` 传给 Worker，再在 Worker 内恢复为 `Uint8Array`；直接跨线程传递 TypedArray 在部分微信运行环境会丢失数组类型与长度，导致后续图片分析失败。

### 功能

- 图片演奏：相册/拍照、七幅名画、六种演奏组合、参考原谱、图片情绪、2/3/4 声部、三种区域分割、五种演奏顺序、四种轮廓演奏方式、轮廓柔化、伴奏、静音/独听。
- 聆听：播放/暂停、进度拖动、循环、按住滑动试听、12 秒响度匹配对照、WAV 导出。
- 乐曲成画：接收当前组合、六首古典 MIDI、三首原创样曲、从微信会话导入 MIDI/JSON、八种画风（含植物、山水、潮汐）、配色/细节/构图、音画同步。
- 导出：2400 × 1800 PNG 保存相册，SVG、JSON、WAV 与内置原始 MIDI 通过系统文件分享窗口导出。导出文件不自动发送给任何人。

### 两端共用与差异

- `dist/engine/` 为计算引擎的唯一源码。构建将 18 个模块静态合并成小程序 Worker 的 CommonJS 模块；不在运行时执行 `eval` 或加载 Blob 脚本。图片演奏沿用现有算法、乐谱和合成音色。
- PNG 解码新增可注入的解压函数。网页仍用 `DecompressionStream`，小程序使用 `shared/inflate.js`，相同 PNG 的解码像素保持一致。
- 原生页面在 `miniprogram/`。`dist/music-art-core.js` 与 MIDI 解析器在构建时复用；画作使用原核心生成的 SVG 路径，由 Canvas 绘制，而不是重新设计一套构图。
- 图片演奏送入绘画页的“原组合音色”继续调用共用合成引擎。小程序的“乐谱合成试听”（内置曲、导入 MIDI/JSON 的默认声音）使用 `shared/art-audio.js`；沿用网页的谐波类别与包络，使用软限幅替代浏览器 `OfflineAudioContext` 的动态压缩器，波形与浏览器该试听模式不完全相同。音符、节奏与画作不变。
- 超过 400 万像素的手机图片先缩到最长边 512，再分析，防止全尺寸解码导致内存峰值；其他平台图片解码/缩放可能有像素差异，因此这类大图不承诺与网页逐音一致。较小 JPG/PNG 使用共用解码规则。其他格式通过微信 Canvas 解码，支持范围取决于设备。
- 计算可取消；应用进入后台会停止播放并取消计算。重新播放时如 Worker 已被释放，会先恢复当前图片数据。仅保留当前页面的一个整曲 WAV 文件和至多八个短试听缓冲，避免按混音组合累积长音频缓存。Worker 仍需要当前图片的分轨，长曲和复杂轮廓的性能需要真机核验。

小程序账号的类目、备案、隐私指引、相册/选图相关权限及上传审核在微信后台处理。请在后台如实配置隐私指引；使用拍照、选图和保存相册时遵循平台授权流程。构建本身不会替你注册、备案或发布。

### 相册选图报 `api scope is not declared in the privacy agreement`

这表示当前 AppID 的《小程序用户隐私保护指引》尚未声明接口涉及的信息类型，属于微信后台配置，不是图片解码失败。页面的“相册选图 / 拍照”调用 `wx.chooseMedia`；下面的“内置样图”下拉列表只读包内文件，不调用该接口，不需要相册或摄像头权限。

1. 登录 [微信公众平台](https://mp.weixin.qq.com/)，选择与开发者工具当前 AppID 相同的小程序账号。
2. 在“设置 / 账号设置”中找到“用户隐私保护指引”（部分后台在“服务内容声明”中），更新指引。按实际功能声明下表中的信息类型和用途。
3. 按后台提示完成提交并确认配置已生效；体验版也需使用对应生效的指引。随后重新编译或重新进入小程序，在微信官方隐私弹窗中同意后，再测试相册选图和拍照。

| 功能 / 接口 | 需要核对的隐私声明 | 本项目的实际用途 |
| --- | --- | --- |
| 选图 / `wx.chooseMedia` | 选中的照片或视频信息 | 读取用户主动选择的图片，在本机分析颜色和轮廓，生成音乐，不上传图片 |
| 拍照 / `wx.chooseMedia` 的 camera 来源 | 摄像头 | 用户主动拍照后，在本机生成图片音乐 |
| MIDI/JSON 导入 / `wx.chooseMessageFile` | 选中的文件 | 读取用户主动选择的乐谱文件，在本机生成画作与试听 |
| 保存 PNG / `wx.saveImageToPhotosAlbum` | 相册（仅写入）权限 | 将用户生成的画作保存到手机相册 |

此项目没有录音功能，不需要为合成播放添加麦克风声明。未配置选图声明时仍可先用“内置样图”体验。`app.json` 的 `__usePrivacyCheck__` 不替代后台声明；关闭该字段、添加 `scope.camera` 或切换到旧选图接口均不能完成上述后台配置。本项目保留微信官方隐私授权弹窗，不会自动同意或绕过授权。

依据：[腾讯官方隐私指引适配说明](https://cloud.tencent.cn/document/product/1301/97930)、[微信隐私协议开发指南](https://developers.weixin.qq.com/miniprogram/dev/framework/user-privacy/PrivacyAuthorize.html)。

## 验证

```sh
npm run test:build
```

检查两端交付完整性、小程序依赖闭包与体积、各页面事件、纯 JS PNG 解压、六种组合乐谱一致性、三种分割与四种轮廓、Simple WAV 一致性，以及通过 wx 测试宿主运行的图片→声音→画作→导出、MIDI 导入、取消和后台恢复。

若本机安装了 macOS 微信开发者工具，还会调用其官方 WXML / WXSS 编译器检查页面；其他系统可用 `WECHAT_COMPILER_DIR` 指向含有 `wcc` 与 `wcsc` 的目录。未安装时会明确跳过该项。测试宿主不代表微信真机环境，手机的生成速度、音画同步、权限弹窗与文件分享需要在开发者工具/真机继续验收。

装有 `@napi-rs/canvas` 时（可通过 `CANVAS_MODULE` 指定），还会将全部画风的 Canvas 输出与原 SVG 栅格化结果做像素比较，并在 `build/verification/` 保存预览。可选的 `npm run test:web-build` 会使用 Playwright 与本地 Chrome 检查 HTML 产物的真实 Worker、播放、跨页传谱与 WAV/PNG 下载；通过 `PLAYWRIGHT_MODULE` 和 `BROWSER_EXECUTABLE` 指定工具位置。构建命令本身不依赖这些测试工具。
