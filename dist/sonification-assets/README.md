# 内置照片

这些样本用于本地图片声化功能演示与验收，不用于在线发布或产品宣传。来自项目已有的规范化测试图片，保留署名与原来源。

- `mars-sunset.png`：NASA / JPL / Texas A&M / Cornell，[火星日落来源](https://science.nasa.gov/resource/sunset-at-mars-gusev-crater-spirit/)，项目素材记录为 NASA media educational use。
- `grass.png`：DeviantArt / scikit-image，CC0-1.0，[草地来源](https://scikit-image.org/docs/0.25.x/api/skimage.data.html#skimage.data.grass)。

`photos.js` 是这两张 PNG 的 Base64 副本，用于直接打开本地文件时读取画布，内容与独立 PNG 一致。原有来源记录见 `tests/m0/photo-sources.json`。

## 世界名画

`paintings/` 中的 7 幅名画均为公有领域作品，取自 Wikimedia Commons（2026-10-14），按 16:10 截取代表性区域并缩放为 384×240 JPG，供图片演奏页作为默认样本。`paintings.js` 是它们的 Base64 副本及署名。

| 文件 | 作品 | Commons 文件 |
| --- | --- | --- |
| `starry-night.jpg` | 梵高《星月夜》1889，纽约现代艺术博物馆 | [Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg](https://commons.wikimedia.org/wiki/File:Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg) |
| `great-wave.jpg` | 葛饰北斋《神奈川冲浪里》约 1831 | [Tsunami_by_hokusai_19th_century.jpg](https://commons.wikimedia.org/wiki/File:Tsunami_by_hokusai_19th_century.jpg) |
| `impression-sunrise.jpg` | 莫奈《印象·日出》1872，玛摩丹莫奈美术馆 | [Monet_-_Impression,_Sunrise.jpg](https://commons.wikimedia.org/wiki/File:Monet_-_Impression,_Sunrise.jpg) |
| `pearl-earring.jpg` | 维米尔《戴珍珠耳环的少女》约 1665，莫瑞泰斯皇家美术馆（局部） | [1665_Girl_with_a_Pearl_Earring.jpg](https://commons.wikimedia.org/wiki/File:1665_Girl_with_a_Pearl_Earring.jpg) |
| `mona-lisa.jpg` | 达·芬奇《蒙娜丽莎》1503–1519，卢浮宫（局部） | [Mona_Lisa,_by_Leonardo_da_Vinci,_from_C2RMF_retouched.jpg](https://commons.wikimedia.org/wiki/File:Mona_Lisa,_by_Leonardo_da_Vinci,_from_C2RMF_retouched.jpg) |
| `the-kiss.jpg` | 克里姆特《吻》1907–1908，美景宫美术馆（局部） | [The_Kiss_-_Gustav_Klimt_-_Google_Cultural_Institute.jpg](https://commons.wikimedia.org/wiki/File:The_Kiss_-_Gustav_Klimt_-_Google_Cultural_Institute.jpg) |
| `thousand-li.jpg` | 王希孟《千里江山图》北宋 1113，故宫博物院（局部） | [1c_Wang_Ximeng…(section)_Palace_museum,_Beijing.jpg](https://commons.wikimedia.org/wiki/File:1c_Wang_Ximeng._A_Thousand_Li_of_Rivers_and_Mountains._(51,3x1191,5cm)1113._(section)_Palace_museum,_Beijing.jpg) |
