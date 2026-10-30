# LIBRARY-MANIFEST.md — 全语料清单与「哪些是视频壁纸」结论（任务书 C4，2026-09-13）

> 工具：`node library-manifest.mjs`（表格）/ `--json`（机读，同时落 `we-scene-demo/library-manifest.json`）/
> `--only video`（只看视频类）。扫描范围：`allwallpaper/dd/*/scene.pkg`（22）+ `allwallpaper/wallpaperE/**`（60）+
> `allwallpaper/wallpapertest1/*.mpkg`（6）= **88 容器**。
>
> 为什么要有它：砂狼白子02_08 那类「mpkg 里 project.json 写 type=scene、实际是 wallpaper.mp4 + 一份
> scene.json」的容器，按场景渲染=黑屏/只剩文本（P-33 定案按视频播）。本清单按**内容**（有 .mp4 条目或
> project.json.file 指向 mp4）判定类型，不信任声明。

## 一句话结论

**88 个容器里 67 个含视频：45 个纯视频壁纸 + 22 个「视频+scene.json」混合容器（全部在 wallpaperE，
均为 4 条目小包：project.json + scene.json + mp4 + preview，scene 侧只有脚本驱动的文本层，无纹理无网格）。
纯 scene 容器 21 个（dd 的 11 个 + wallpaperE/other 与 wallpapertest1 的 10 个），是渲染器回归的主体语料。**

## 类型分布

| 类型 | 数量 | 说明 |
|---|---|---|
| scene | 21 | 有 scene.json、无 mp4。dd 11 个（3544152633/3719111841/3554161528/3327063360/3326873240/3660962877/3721991999/3470764447/3778592720/3715743282/3669681034）+ wallpaperE/other 4 个 + wallpapertest1 6 个 |
| scene+video | 22 | **视频壁纸（带可选文本叠加）**。scene 侧有脚本内容的 11 个见下表；「视频作底层+场景文本叠加」链路当前不存在（P-33，待产品决策） |
| video | 45 | 纯 mp4（3 条目：project.json + mp4 + preview），按视频壁纸播放即可 |

## scene+video 全名单（= 视频壁纸，**不要按场景渲染**）

| 来源 | 容器（【+scene】= scene 侧有脚本） |
|---|---|
| wallpaperE/砂狼白子 | 砂狼白子_1、_2、_3、_5、02_01、02_02、11_01（纯视频）；_4【3 段】、02_08【1 段，即 P-33 定案那只】、02_10【5 段】、11_03【**119 段**，全语料脚本最多】、11_05【4 段】 |
| wallpaperE/洛茜 | 洛茜_01/02/03/04/05/06/08/09/12/13（纯视频）；_07【34 段】、_10、_11【1 段】 |
| wallpaperE/小鸟游星野 | _01、_02、_09、_11、_12、01_04、01_11、04_2、04_7、11_01（纯视频）；_13、11_10【1 段】 |
| wallpaperE/庄方宜 | _2（纯视频）；_19、_24、_3、_4、_6、_7【14 段】 |
| wallpaperE/伊蕾娜 | _04、_05、1_8（纯视频）；_08 |
| wallpaperE/流萤 | 流萤_06、_09、01_03（纯视频） |
| wallpaperE/纳西妲 | _02、_03、_04、_08、_10（纯视频） |
| wallpaperE/遐蝶 | _01、_02、_15（纯视频）；_09 |
| wallpaperE/洛琪希 | _01、1_1（纯视频）；1_3 |
| wallpaperE/洁尔佩塔 | _4【3 段】 |
| wallpaperE/莱万汀 | zmd_12【1 段】 |
| wallpaperE/佩丽卡 | zmd_08 |
| wallpaperE/终末地 | zmd_01（纯视频） |

（完整机读数据含条目数/纹理数/脚本段数/MDL 数/预览图：`we-scene-demo/library-manifest.json`）

## 给 A/B 回归集的选样依据

- **渲染语义回归** → 纯 scene 容器。规模最大的：3544152633（255 条目/38 纹理/51 脚本/1 MDL）、
  红鸾樱落（149/38/20/**6 MDL**，蒙皮最重）、3719111841（147/44/3/5 MDL，附件锚点基准）、
  3554161528（134/32/5/1）、夜莺 time_variation alone（132/24/72/1，脚本最重的纯 scene）。
- **脚本宿主回归** → 砂狼白子11_03（119 段）+ 夜莺 alone（72 段）+ 流萤 customize firefly（105 段，wallpapertest1）。
- **dd 的 11 个纯 scene 容器全部无预览图**（scene.pkg 不含 preview）；wallpaperE/wallpapertest1 的都有
  （preview.gif/jpg）——视觉对照时注意 dd 场景要用官方截图（Testphoto/）。
- **勿入渲染回归**：67 个含视频容器（上表）。插件侧（B）按视频壁纸链路处理；若未来做「视频+文本叠加」，
  scene+video 的 22 个就是那条链路的全部语料。
