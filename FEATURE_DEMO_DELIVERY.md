# 图鸣 · 全图特征旋律 Demo 0.2

日期：2026-10-10。初版功能验证通过，待人工试听。

## 启动

双击项目根目录的 [启动全图特征Demo.command](./启动全图特征Demo.command)。它会启动本机音源并自动打开 `http://127.0.0.1:4176/feature-music.html`。关闭启动脚本的终端窗口即可停止服务。

本机的 NumPy、Pillow、FluidSynth 与音色库已准备。生成过程中不上传图片到外部服务。原项目音源需要 Python，因此本版使用本机服务；只打开页面而未启动音源时会显示启动提示。

## 这次具体改了什么

1. **真正复用参考项目**：保留 Photo Sonification 的图像分析、FFT、显著性、自动调式、节奏速度、自动配器、和声、纹理、低音、铺底及显著区域独奏。直接运行原项目的代码与 GeneralUser GS 音色库，通过 FluidSynth 渲染，提供“参考原谱”对照。
2. **全图二维区域**：原图按参考项目规则缩小到最长边 512 像素，保留整幅比例，不居中裁掉画面。将图像分为 `小节数 × 2` 列、4 行，按列蛇形遍历，每个区域占半拍；全部分析像素被区域完整覆盖。
3. **多特征进入主旋律音高**：每个区域计算色相、饱和度、亮度、对比度与纹理。纹理综合梯度熵、局部高频能量及周期性。各特征均参与音阶位置计算，而非只影响速度和伴奏。
4. **保留可听的变化**：目标量化到参考项目选定的音阶，相邻有效区域的跳进最多 5 半音。明显特征变化落入同一个音高格时，尽可能保留一级音阶变化并记录原因；仅在特征基本稳定、实际音高相同时合并。
5. **公平对照**：两种模式使用相同图片、速度、音源及非主旋律事件；全图模式只替换主旋律。两个 12 秒按钮按实际音频 RMS 匹配响度。
6. **播放和检查**：音频时钟驱动真实音符及来源区域高亮，支持暂停、继续、进度拖动、区域试听及完整双声道 44.1 kHz WAV 保存。

“参考原谱”指本机运行固定版本源码所生成的结果，不承诺与网站在不同版本、图片、参数或系统音源条件下的音频字节完全相同。

## 建议人工验收

- 选择“等亮横向色带”。它的亮部纵向位置不变，横向颜色变化应产生不同音高。
- 选择“同明暗纹理变化”。左右两部分平均明暗接近，纹理差异应进入旋律，而不仅是伴奏变化。
- 上传自己的图，先关闭“完整编曲”，观察并试听每个局部区域的实际音高，再开启编曲检查整体音乐。
- 用“12 秒 · 参考原谱／全图特征”比较。同图同设置下，判断参考音源是否接近预期，以及新旋律是否更能表达图像变化。
- 暂停、拖动并继续；点击区域时核对选中区域的目标／实际音高及特征说明。

有限的区域采样、音阶和音域无法保证每一个像素或极小数值变化都产生不同音符。本版的验收口径是整图覆盖、五类局部特征参与音高、受控的明显变化在实际旋律中可辨。纯色主旋律可保持同音；黑图的主旋律休止，参考规则的整体编曲仍可能发声，可关闭编曲单独验收。

## 验证证据

- [核心验证](./tests/reference-features-report.json)：横向亮度、等亮色相、饱和度、对比度／纹理、纵向内容、20 个独立空间颜色样本、稳定／暗区、整图像素覆盖、确定性及来源对应。
- [浏览器验证](./tests/feature-reference-browser-report.json)：实际 GS 播放、同步、暂停／拖动、两版对照、设置切换、PNG／JPEG／WEBP 整图上传、手机布局、区域试听与 WAV 下载。
- 原谱音符的开始、时长、音高、力度、乐器、声像和声部逐项与直接运行原函数的输出一致；两个模式的非主旋律事件完全一致。
- 下载的 WAV 字节与原音源生成文件的 SHA-256 一致；实际声音检查无异常数值或削波。测试通过不等于主观听感已验收。

复测时使用包含 NumPy 与 Pillow 的 Python：

```bash
python3 tests/reference-features.test.py
python3 scripts/reference_server.py --port 4176
node tests/feature-reference-browser.cjs
```

本机启动脚本自动选择 Codex 捆绑 Python。FluidSynth 为项目内运行库，没有安装或升级系统软件；当前准备脚本适用于本机 macOS arm64，依赖已存在的 Homebrew libsndfile。迁移到其它机器需配置当地 Python 与 FluidSynth，不能仅复制 HTML。

## 源码与许可

参考项目：[Photo Sonification](https://github.com/trungtin-dinh/photo_sonification)，固定提交 `667d97c1e68de56fe2f5ef2d26784ee8a7308f3f`。五个核心模块保持原样，来源摘要见 [UPSTREAM.json](./vendor/photo_sonification/UPSTREAM.json)，保留 [MIT 许可证](./vendor/photo_sonification/LICENSE.txt)。

GeneralUser GS 2.0.3 BETA 为 S. Christian Collins 的音色库，使用参考仓库的原始文件，附带从库中提取的 [许可与署名](./vendor/photo_sonification/soundfonts/LICENSE-GeneralUser-GS.txt)。FluidSynth 及运行库的来源、校验值和许可证记录在本机 `.reference-runtime/manifest.json`；运行库不纳入 Git。

上一版 [条带 Demo](./dist/sonification.html) 与 [交付说明](./STRIP_DEMO_DELIVERY.md) 保留为历史对照。当前执行方向以本说明及优化文档中的最新调整为准。
