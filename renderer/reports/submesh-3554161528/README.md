# reports/submesh-3554161528/ —— P-109（任务书 P1-4）取证原始产物

生成：`node tests/submesh-evidence.mjs`（Node 探针通路；本机浏览器通路拿不到 WebGL，见 PATCHES P-109.4）。
本目录**不做断言**，只存原始证据（结论与数字见 `docs/PATCHES.md` P-109 节）。

| 文件 | 是什么 |
|---|---|
| `ledger-all.json` | `?submesh=all` 的**全量台账**：29 组 ×（顶点数/bbox/质心/影响骨表/父链/三角形归属数/**蒙皮后位移时程 `hist`**/**三角形有向面积变号计数 `invert`**）；271 帧、t=0→9s |
| `ledger-<规格>.json` | 各隔离规格的台账（`16` / `30` / `1` / `16-19,30` / `17*` / `5-8,14,20,29`）⇒ 选中组 + 实绘三角形数 |
| `render.json` | 软栅格化输入：10 个时间点上每组的**蒙皮后顶点**（含 UV）+ 三角形（含变号标记）+ 逐顶点主影响骨 |
| `tex-人物.png` / `tex-人物.json` | 真实贴图 `materials/人物.tex` 解码（1405×2013，供 UV 裁剪判读"这一组画的是脸上哪一块"） |
| `viz-face-uv-groups.png` | 面部贴图放大 6× + 5 个组的 UV 框 ⇒ **眼=b16、瞳孔=b30、眉毛=b17、睫毛=b18/b19** 的判读依据 |
| `viz-face-groups-time.png` | 面部各组在 t=0/0.233/0.4/0.6/1.0/2.5/6.0/8.5s 的软栅格化（**红 = 有向面积变号**）⇒ 0.1–0.9s 与 8.1–8.9s 两段"整片翻出去" |
| `viz-uv-sheet-all-groups.png` | 全部 29 组的贴图 UV 裁剪总表（哪根骨画身上哪一块） |
| `viz-body-t0.png` | 全身分组图（bind 姿态，世界设计像素） |
| `log.txt` | 页面/探针的 `[submesh]` 结构化摘要行（与进设备上报的同一批） |

⚠ `viz-*.png` 是**软栅格化**（PIL 画三角形，不采样贴图颜色）与**贴图裁剪**，**不是** GPU 截图；
本机无 GPU/`/dev/dri`，无头 Firefox 建不了 WebGL 上下文（`AllowWebgl2:false`），Chromium+SwiftShader 在本机 PRoot 下挂起。
