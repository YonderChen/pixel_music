# 文档索引

这里放各阶段的说明、计划与报告。项目总览与使用方式见 [仓库 README](../README.md)。

## 描述当前功能

| 文档 | 内容 |
| --- | --- |
| [STATIC_WEB_DEMO.md](./STATIC_WEB_DEMO.md) | 静态网页版：本地打开、资源与打包脚本、Cloudflare 从 `release` 分支发布 |
| [IMAGE_MOOD.md](./IMAGE_MOOD.md) | 图片情绪：愉悦度与能量的计算、九种情绪，以及它们如何决定调式、速度、乐器与力度 |
| [REGION_DEMO.md](./REGION_DEMO.md) | 区域分割（默认演奏组合）：三种分割、五种演奏顺序、轮廓参与、四种轮廓演奏方式、柔化轮廓 |
| [CONTOUR_MUSIC.md](./CONTOUR_MUSIC.md) | “轮廓参与”默认方式（起伏动机）按代码逐步说明 |
| [MUSIC_ART_DEMO.md](./MUSIC_ART_DEMO.md) | 乐曲成画：曲线色层、几何色块、扫描长卷，古典 MIDI 与导入导出 |
| [ARRANGED_DEMO.md](./ARRANGED_DEMO.md) | 编曲版与参考条带优化版（0.8.1） |
| [RETAINED_COMBINATIONS.md](./RETAINED_COMBINATIONS.md) | 仍保留的三种多行组合与参考原谱，移动试听与循环播放 |

## 历史记录

以下文档记录的是当时的方案和验收，保留作对照，不代表现在的界面或运行方式。其中提到的本机服务（`127.0.0.1:4176`）、GS 采样音源与 FluidSynth 都已移除。0.10 改为纯 JavaScript 后，文中引用的 Python 脚本（`scripts/*.py`、`vendor/photo_sonification/`）、Python 测试（`tests/*.test.py`）、依赖本机服务的浏览器测试和 `启动全图特征Demo.command` 也已删除，可在 Git 历史（提交 `976de6f`）中查到；这些测试当时生成的 `*-report.json` 仍保留在 `tests/` 作为验收记录。

- 图片演奏页的早期阶段：[FEATURE_DEMO_DELIVERY.md](./FEATURE_DEMO_DELIVERY.md)（0.2）、[HORIZONTAL_ROWS_DEMO.md](./HORIZONTAL_ROWS_DEMO.md)（0.3）、[SOFT_MIX_DEMO.md](./SOFT_MIX_DEMO.md)（0.4）、[PITCH_CONTOUR_DEMO.md](./PITCH_CONTOUR_DEMO.md)（0.5）、[PITCH_TRANSITION_DEMO.md](./PITCH_TRANSITION_DEMO.md)（0.5.2）、[PHOTO_SONIFICATION_DEMO_PLAN.md](./PHOTO_SONIFICATION_DEMO_PLAN.md)（方向计划）
- 条带声化实验（`dist/sonification.html`）：[STRIP_DEMO_DELIVERY.md](./STRIP_DEMO_DELIVERY.md)
- 旧像素工作台（`dist/pixel-music-legacy.html`）：[MELODY_OPTIMIZATION_PLAN.md](./MELODY_OPTIMIZATION_PLAN.md)、[IMPLEMENTATION_REPORT.md](./IMPLEMENTATION_REPORT.md)（0.4）、[RHYTHM_OPTIMIZATION_PLAN.md](./RHYTHM_OPTIMIZATION_PLAN.md)、[RHYTHM_IMPLEMENTATION_REPORT.md](./RHYTHM_IMPLEMENTATION_REPORT.md)（0.5）、[IMAGE_FIDELITY_ADJUSTMENT_PLAN.md](./IMAGE_FIDELITY_ADJUSTMENT_PLAN.md)、[FIDELITY_IMPLEMENTATION_REPORT.md](./FIDELITY_IMPLEMENTATION_REPORT.md)（0.6）、[ARTICULATION_IMPLEMENTATION_REPORT.md](./ARTICULATION_IMPLEMENTATION_REPORT.md)（0.6.1）、[PIXEL_MELODIC_EXPERIMENT_PLAN.md](./PIXEL_MELODIC_EXPERIMENT_PLAN.md)、[LEGATO_DELIVERY.md](./LEGATO_DELIVERY.md)（0.6.4-exp）
- 暂缓的可视乐谱改造计划及其 M0 基线：[VISUAL_SCORE_REDEVELOPMENT_PLAN.md](./VISUAL_SCORE_REDEVELOPMENT_PLAN.md)、[M0_CONTRACT_SPEC.md](./M0_CONTRACT_SPEC.md)、[M0_ACCEPTANCE_SPEC.md](./M0_ACCEPTANCE_SPEC.md)、[M0_IMPLEMENTATION_REPORT.md](./M0_IMPLEMENTATION_REPORT.md)。其中“横向时间、纵向音高”的轮廓作曲思路后来以区域分割里的“线条演奏”和“扫描线”方式实现，见 [REGION_DEMO.md](./REGION_DEMO.md#轮廓演奏方式对比实验)。
