# 保留的转换与演奏方式 · Demo 0.6

2026-10-11。按人工选择固定以下三种组合，并保留参考原谱。

| 演奏方式 | 图片到音符的映射 | 混音 |
| --- | --- | --- |
| 多行叠奏 | 多特征音高转换 · 新 | 原有叠加 |
| 多行叠奏 | 行内参考条带 | 柔和合成混音 |
| 多行叠奏 | 局部多特征法 | 柔和合成混音 |
| 参考原谱 | Photo Sonification 原始映射与编曲 | 参考项目音源 |

## 当前入口

打开 [本机 Demo](http://127.0.0.1:4176/feature-music.html#parallel)，在“演奏组合”中选择三种固定配对。默认第一项，也可通过以下链接进入指定组合：

- [多特征音高转换 · 新＋原有叠加](http://127.0.0.1:4176/feature-music.html#feature-original)
- [行内参考条带＋柔和合成混音](http://127.0.0.1:4176/feature-music.html#reference-soft)
- [局部多特征法＋柔和合成混音](http://127.0.0.1:4176/feature-music.html#local-soft)
- [参考原谱](http://127.0.0.1:4176/feature-music.html#reference)

当前页面移除全图蛇形单旋律、独立映射／混音选择及连续滑接选项。旧入口链接进入保留组合，不再进入全图实验。历史算法与测试保留用于复现；本轮只整理入口与配对，不修改三种已选组合的音高或声音算法。

## 保留的操作

2／3／4 行切分、逐行静音与独听、整体伴奏开关、参考音源与速度规则、图片上传、暂停／继续、进度拖动、区域短试听和 WAV 导出继续保留。整体伴奏只保留一份，声音按需生成，等待时可以取消和重试。

“12 秒 · 当前组合”与“12 秒 · 参考原谱”使用同一图片，并匹配实际片段响度。切换组合后，乐谱、声部音色、短试听和导出均使用该组合；导出文件名记录所选映射与混音。

## 映射与声音约定

- **多特征音高转换＋原有叠加**：颜色、明暗、饱和度、对比度与纹理决定音高目标，量化到共用音阶，各行通过参考音源独立演奏后叠加。
- **行内参考条带＋柔和合成混音**：各行按参考条带法生成旋律，用暖键、柔拨弦、圆木琴与轻铃演奏，沿用已有声部平衡与轻回声。
- **局部多特征法＋柔和合成混音**：各行沿用局部多特征与既有跳进控制，再使用同一套柔和合成混音。
- **参考原谱**：继续使用 Photo Sonification 固定版本的原始分析、编曲与音源，不按新组合重新改写主旋律。

参考项目地址：[Photo Sonification](https://github.com/trungtin-dinh/photo_sonification)、[算法说明](https://github.com/trungtin-dinh/photo_sonification/blob/main/documentation_en.md)、[play_music_theory](https://playmusictheory.net/play)。图像映射与声音调整的历史说明见 [PITCH_TRANSITION_DEMO.md](./PITCH_TRANSITION_DEMO.md) 和 [SOFT_MIX_DEMO.md](./SOFT_MIX_DEMO.md)；后续范围以本清单为准。

## 验收

同一图片依次试听三种组合，检查扫描、高亮、静音与独听，再用参考原谱对照。保存 WAV 时确认文件名对应当前组合，浏览器实际保存位置继续由人工确认。

验证：[组合选择、失败重试与导出命名](./tests/page-startup-client-report.json)、[三种组合实际音频与参考原谱](./tests/retained-combinations-api-report.json)、[本机浏览器验收](./tests/retained-combinations-browser-report.json)。自动检查证明配对和功能正确，听感沿用人工选择。
