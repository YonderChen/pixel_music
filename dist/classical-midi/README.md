# 古典 MIDI 候选曲目

文件于 2026-10-14 下载自 Mutopia Project。以下链接记录对应版本及编谱者；`.mid` 文件保留下载时的原始字节，卡农从官方 MIDI 压缩包提取总谱文件 `canon_per_3_violini_e_basso.mid`。

| 曲目 | 编谱者 / 维护者 | 许可 | 来源 |
| --- | --- | --- | --- |
| 贝多芬《致爱丽丝》WoO 59 | Stelios Samelis | Public Domain | [Mutopia 931](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=931) |
| 巴赫《C 大调前奏曲》BWV 846 | Tobias Erbsland | Public Domain | [Mutopia 5](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=5) |
| 莫扎特《土耳其进行曲》K. 331 第三乐章 | Rune Zedeler and Chris Sawer | Public Domain | [Mutopia 108](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=108) |
| 肖邦《小狗圆舞曲》Op. 64 No. 1 | Magnus Lewis-Smith | Public Domain | [Mutopia 483](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=483) |
| 德彪西《月光》（《贝加莫组曲》L. 75 第三乐章） | Keith OHara | Public Domain | [Mutopia 1778](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1778) |
| 帕赫贝尔《D 大调卡农》（三把小提琴与大提琴） | Michael Fischer v. Mollard | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | [Mutopia 2047](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=2047) |

Public Domain 表示编谱者已将其编谱贡献置于公有领域，见 [Mutopia 许可说明](https://www.mutopiaproject.org/legal.html)。卡农的编谱贡献按 CC BY 4.0 提供，复制与修改时须保留上述署名、来源及许可链接；不暗示编谱者为本项目背书。

候选列表完整读取《致爱丽丝》《C 大调前奏曲》《小狗圆舞曲》。另三首超过工作台 3 分钟上限，取开头 149.2 秒的音符（跨边界音符截短），并留 0.8 秒尾音，共 2 分 30 秒；界面明确显示“节选”。原始 MIDI 文件本身未修改。

`manifest.json` 保存来源及节选设置。运行 `node scripts/package_classical_midi.cjs`（项目根目录）可重新生成 `music-art-classics.js`。生成脚本仅读取本地文件，不联网；内嵌 MIDI 字节使双击本地 HTML 时也可选择这些乐曲。
