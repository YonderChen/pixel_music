# M0 · 模式、版本与声音出处契约

冻结日期：2026-10-08（北京时间）。任务 B01、B02；规格版本 `visual-score-v1`。

本文约束后续研发，不表示轮廓分析、作曲、视图或路由已实现。可执行示例在 [契约骨架](./tests/m0-contract.cjs) 和 [反例测试](./tests/m0-contract.test.cjs)。它们只验证手工构造的样例，不把几何标注当成算法输出。

## 1. 兼容边界

| 项目 | 像素模式 | 实验轮廓模式 |
| --- | --- | --- |
| 请求模式 | `pixel`（默认） | `contour`（显式选择） |
| 乐谱版本 | `0.6.1` | `0.7.0` |
| 映射版本 | 既有 0.6.1 标识与指纹，不改字段 | `contour-v1` |
| 事件模型 | 保留 `melody`、`regionMap`、奏法事件原形 | `provenance-events-v1`，禁止伪造 `regionMap` |
| 出处 | 蛇形访问、120 个区域的既有引用 | 单条主轨迹，区域↔事件零到多引用 |
| 回退 | 不需要轮廓检测 | 无可靠结构时返回原像素乐谱；单独保存回退信息 |

默认设置：像素、轻奏 `sparse`、暖键 `warm`。两模式可选 `sparse / continuous`、`warm / glass / mist`。轮廓首轮固定：192×120、64 拍、0.25 拍网格、MIDI 48–72、一个声部、恒速 76–104 BPM；无新低音／铺底。三种调式沿用现有五声／大调／小调音阶集合。音色是渲染设置，不改变作曲身份。

[冻结清单](./tests/baseline/v061-manifest.json) 记录五核心模块、三组夹具、假音频环境、旧契约，共十对原始／冻结 SHA。只改 UMD 名字和本地依赖指向；反向恢复后须逐字匹配原始 SHA。历史 v04/v05/v06 不覆盖。冻结捕获输出 [168 条快照](./tests/baseline/v061-score-snapshot.json)，包括完整乐谱 JSON SHA、事件／区域／时间轴 SHA、四种指纹与三音色排程 SHA；测试绝不自动重写期望。

快照 SHA 是文件审计；产品 `imageHash`、`scoreHash` 等仍沿用产品摘要，不能称为密码学哈希。VM 经典脚本检查不是实际浏览器运行；假音频排程不是波形渲染。

## 2. 分析层

`ContourAnalysis`：`schema / version / width / height / imageHash / status / fallbackReason / candidates / tracks / diagnostics`。

- 候选 `id / x / y / strength / observed / supportRect`：x 为整数 0–191，y 可为有限小数 0–119，强度 0–1，最多每列六个；每个候选必须是实际观测。
- 支持矩形 `{x0,y0,x1,y1}` 是半开像素范围，非空且不越画布；候选点必须在其中。相交区域按 8×24 像素单元计算。
- 主轨迹最多一条。点按 x 严格升序，`observed:true` 引用真实候选 ID；追踪补连接仅可 `observed:false,candidateId:null`，不可成为发声证据。
- 可靠状态有一条轨迹且没有回退原因；回退状态零轨迹。诊断记录候选数、有效覆盖率；M2 再补齐支持强度、多尺度一致性、最大缺口、位移／曲率代价、拒绝项与提取参数。
- 透明像素在轮廓入口拒绝，不自动铺底改变规范化身份。边界复制，禁止零填充制造边框。

几何细线以构造中心线为期望；粗色块以顶部边界为期望；双轨等证据时选上轨。不同类型的去重与追踪规则必须记录，不按照片语义命名轨迹。

## 3. 乐谱与出处

`ContourScore` 包含分析身份、配置、调性、恒速时间轴、结构事件、奏法事件、两类休止、区域引用及四种指纹。源事件为 `voiceId:main`，正时长，音阶内，非重叠，覆盖范围不超过第 64 拍。

结构事件 `sourceEvents` 保存 `id / beat / rawBeat / durationBeats / midi / velocity / envelope / origin / sourceRefs`；`origin:image-structure`、`envelope:sustain` 表示源片段，不代表一定用持续包络播放。M3 同时补齐原始终点、音高及量化／合并／冲突诊断；当前骨架检查起点误差 ≤0.125 拍和正网格时长，尚不是完整作曲正确性测试。

`sourceRefs` 保存 `trackId / pointIds / regionIds`，只能引用选中轨迹的真实观测点。区域集合必须恰好等于这些支持矩形相交的区域。事件发声只能解释其观测区间；跨缺口不得保持持续发声，M3 必须以明确结构休止及区间测试约束，而非只靠 ID 合法。

`performanceEvents` 保存实际起音，引用 `sourceEventId`，音高／力度及出处匹配源片段。轻奏 `pluck` 标注 `origin:performance-rule`，不造像素变化；持续 `sustain` 标注 `image-structure`。力度上限 0.15 是首轮安全约束，仍须真实波形验证。

`sourceEvents + structureRests` 完整、不重叠地解释 `[0,64)`；`performanceEvents + performanceRests + structureRests` 再解释实际发声与留白。尾音不算图像结构时间，`duration` 包含扫描结束后的有界释放（骨架上限两秒）。音频不能将奏法自然衰减误解释为另一次起音。

`regionLinks` 包含全部 120 个区域，按列升序、同列行升序。每项 `{regionId,eventIds,notSelectedReason}`；支持多对多、重复轻奏引用同一结构，双向集合严格一致。未参与时 `eventIds:[]` 且理由 `not-on-selected-track`。区域像素试听是独立预览，不混入轮廓乐谱／导出。

## 4. 身份、排序和取舍

M0 固定序列化参考 [identity.cjs](./tests/m0/identity.cjs)，仅用于测试，不加载到产品。身份版本 `contour-identity-v1`：UTF-8、对象 ASCII 字段名按字典序、数组保留规定顺序、有限数字四舍五入九位小数（`Math.round`，负半值向正无穷）、负零转零。不接受 undefined、NaN、Infinity、日期／函数等非 JSON 值。计算时保留原精度，舍入只用于身份，不能改变排程时间。

新摘要采用 FNV-1a 64 位、16 位小写十六进制，输入为 `身份版本 + 换行 + 域 + 换行 + 规范 JSON`；域分开，不能混用。它是确定性摘要，不承诺无碰撞；文件及验收证据仍用 SHA-256。旧像素指纹完全不迁移。

| 域／字段 | 必须包含 | 排除 |
| --- | --- | --- |
| `structure`／`structureFingerprint` | imageHash、提取版本、实际冻结参数、候选与支持矩形、轨迹／观测标记、可靠状态和原因 | UI、运行耗时、音色 |
| `score`／`scoreHash` | 版本、事件模型、映射／奏法／合成模型版本、影响声音的配置、root/mode、实际音高／力度／包络／起止、时间轴、曲长和休止 | 出处、音色选择、显示状态 |
| `mapping`／`mappingFingerprint` | 映射版本、imageHash、源事件 ID 与点／区域引用、实际事件到源事件、完整区域反向索引 | 悬停／选择、坐标缩放 |
| `rhythm`／`rhythmFingerprint` | 映射／奏法版本、实际起音／时长／包络、结构与奏法留白、时间轴 | 音高、颜色、扫描格、音色 |

M2 冻结提取参数；M3 冻结精确投影字段并产生实际四域摘要，现在没有算法输出指纹。测试样例中的 a/b/c/d 占位摘要只校验格式，不能作为正确指纹证据。

候选固定排序：x 升序、强度降序、y 升序、支持矩形坐标升序；完全相同候选去重。ID 用稳定的列号及排序序号，数字补零，不取运行计数／当前时间／随机数。轨迹 `track-main`；源／演奏事件按拍、音高、固定出处排序编号 `source-0000 / event-0000`。集合字段如 pointIds/regionIds 先去重并按数值坐标顺序排列；事件和时间轴数组按时间排序。M2/M3 验证实际实现与规则一致。

最近音阶音并列取低音；时间网格使用 `Math.round(rawBeat/0.25)*0.25`（非负，半格取后格），末尾夹紧 64 拍。同拍同音合并；不同音按真实支持强度取高者、强度相等按固定候选顺序取第一项；被舍弃项保留诊断。不得插入连接音、主音收束或高潮。

## 5. 路由、状态与视图

路由封套 `{requestedMode,actualMode,status,reason,score}` 独立于乐谱。`ready` 时两模式一致，reason=null；`fallback` 仅允许 contour→pixel，原因 `no-reliable-track / low-reliability / transparent-input`。回退乐谱对象不变、版本 0.6.1，界面明确显示实际模式／原因，不能显示 contour-v1 的假成功。程序异常是错误，不是静默回退。

M1 的视图适配器只读。区域／事件索引、选择、图层、缩放、滚动、当前拍位置均属于视图，不修改任何乐谱和指纹。真实音符条以实际排程事件为准，不把 24 根均值柱伪装为乐谱。

图片／模式／作曲设置改变：停止声音，增加操作 token，旧分析结果不能覆盖新请求，用户重新开始播放。换音色复用时间原点，在静音区不复活旧音；图层变化不中断。快速连点不能叠加完整会话。导出捕获深冻结／复制的乐谱、音色、实际模式和版本快照；文件名标明实际模式、映射／合成版本、摘要和音色。失败应可重试，不留下忙碌状态。

状态机和只读适配尚未实现，分别由 V01、I01–I05 验证。M0 只冻结规则和错误示例，不提前计为这些任务完成。
