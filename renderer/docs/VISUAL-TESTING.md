# VISUAL-TESTING.md — 视觉回归工具链使用说明（MERGED-2 第 3 项 A）

> 工具：`headless-shot.mjs`（截图取证）+ `visual-diff.mjs`（对比打分）。只动工具，不改渲染语义。

## 一、headless-shot.mjs（截图）

```bash
node headless-shot.mjs "http://127.0.0.1:8899/?id=3719111841" /tmp/kalt.png 8000 960 540
```

- **两级策略**：① Playwright/Chromium(SwiftShader) 6 档降级链（base → single-process → 小视口 →
  disable-gpu → old-headless → swiftshader-gl），每档独立子进程 + 90s 硬超时，证据落
  `/tmp/headless-evidence.json`；② 全部失败 → **CPU 预览兜底**（preview.mjs）。
- `SHOT_MODE=cpu`：跳过降级链直通 CPU 兜底（本机已判定不可用时的省时开关）；`SHOT_MODE=chain` 强制完整链。
- 退出码：0=拿到截图；1=截图成功但有 error 级日志；2=连兜底也失败。
- **本机（PRoot 环境）headless 判定：不可用**（2026-09-12 实测，9 组参数 3 类失败模式：
  多进程档任何导航挂起（连 about:blank）、single-process 档启动即崩、NetworkServiceInProcess 无效）。
  证据：`/tmp/headless-evidence.json`。真机/正常 Linux 上链路自动可用。
- **CPU 预览局限**：不画 puppet 蒙皮网格（网格层走简化路径）、无效果链 FBO、无粒子、
  文本/视频纹理不产出像素——只验证层几何/纹理绑定/可见性。**不能**用来判定 GPU 着色语义。

## 二、visual-diff.mjs（对比打分）

```bash
node visual-diff.mjs --id 3719111841 --out /tmp/vd/          # 分数+热图+JSON，首跑写基线
node visual-diff.mjs --id 3719111841 --ab "?att=legacy"      # 两开关各渲一次，分数并排
node visual-diff.mjs --id 3719111841 --check                 # 与 visual-baseline.json 比对，退化非零退出
node visual-diff.mjs --id 3719111841 --ref <图片路径>         # 显式指定参照
```

**参照优先级**：① `allwallpaper/dd/<id>/preview.gif`（官方缩略图，取 -ss 0.5s 中段帧）
② `Testphoto/TP*/` 用户截图（TP↔id 映射登记在脚本顶部 `TP_MAP`，先探黑边再 cover-fit）
③ `refrender-<id>.json` 几何判据（跑 layer-rect-check --refrender，中位偏差 px 折算分数）。

**流程**：当前渲染 960×540 → 按参照 aspect 居中 cover 裁剪 → 灰度 1/4 分辨率 ±8px 互相关对齐
（命中后全分辨率 ±1 复检）→ SSIM（8×8 窗，自实现）+ MAE → 差异热图 PNG（ffmpeg rawvideo，无 npm 依赖）。

**怎么写基线**：首跑（或 `--write-baseline`）把当前分数写进 `visual-baseline.json`。
之后改动渲染语义后跑 `--check`：SSIM 跌 >0.02 或 MAE 涨 >15% → 非零退出。

**怎么读热图**：红=差异大、黄绿=差异小。配合象限定位后用 `?isolate=<层名>` 只渲染该层对照。

## 三、当前基线分数（2026-09-12，CPU 预览路径 + preview.gif 参照）

| id | SSIM | MAE | 对齐offset | 备注 |
|---|---|---|---|---|
| 3719111841 | 0.4808 | 0.1252 | (14,-2) | 凯尔希；79px 眼睛层残差待定项在热图上可见 |
| 3544152633 | 0.4335 | 0.1110 | (-7,5) | GirlCat；纹理 PNG 类无法在 Node 光栅 → CPU 预览缺部分大层 |
| 3554161528 | 0.3587 | 0.1037 | (15,-1) | HDR+相机动画包；preview 是入场后帧，当前渲 t=0 运镜起点 |
| 3327063360 | 0.3091 | 0.2859 | (100,-9) | 大 offset=投影/时间相位差异，属"同基线相对值"适用场景 |

**分数的语义（重要）**：这些都是**同基线相对值**，不是绝对相似度——
1. 官方 preview.gif 是 192×192 方形投影，到 16:9 设计画布的映射未定（P-24 待定项）→ cover 居中裁剪是启发式；
2. 本机走 CPU 预览兜底（局限见上）；3. 官方缩略图的帧相位与 t=0 渲染未必对齐。
分数用途 = **检测回归**（改渲染代码前后对比），不是"和官方像不像"的绝对判定。

**A/B 的局限**：`--ab` 机制可用（URL 正确、两分数并排），但本机 CPU 预览不解析
`?att=legacy` 等 demo 开关（preview.mjs 固定走官方 attachCtx 路径）→ 3719111841 实测 Δ=0.0000。
A/B 的判别力要等 headless 可用（真机/正常 Linux）或给 preview.mjs 移植对应开关之后。

## 四、局限清单（何时不可信）

1. headless 不可用环境 → 全部走 CPU 预览：蒙皮/效果/粒子差异**测不到**；
2. preview.gif 方形投影未定 → 对齐 offset 大（如 3327063360 的 (100,-9)）时分数主要反映投影差；
3. 视频壁纸容器（PKGM0014）无 scene 层可渲，本工具不适用；
4. GIF 帧相位：官方缩略图取 0.5s 处一帧，动画型壁纸的相位差会压低 SSIM——回归判定只看**同基线**的相对变化。
