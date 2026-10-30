# 上游可移植清单剩余 6 项 —— 逐条取证 + 可执行补丁方案（2026-09-19）

> **本轮只写本文档。** 没有改任何代码或既有文档：`core/**`、`demo/**`、`tests/**`、`server/**`、`web/**`、
> `docs/PATCHES.md`、`THIRD-PARTY.md`、`docs/COPYING-RULES.md` 一字未动；没跑门禁；没启动浏览器；
> 没 `git add/commit/push`。全部数字来自本轮**只读命令实测**（命令与输出逐条抄在下面），
> 每处引用都给**可 grep 的锚点串** + 快照 md5。

---

## 0. 口径（先读，否则本文的行号/计数会误导你）

| 项 | 值 |
|---|---|
| 上游 | `oneincase/webwallgl`（**MIT © 2026 oneincase**），本地检出 `<UP>` = `references/vendor-ref/webwallgl/`（remote `https://github.com/oneincase/webwallgl.git`） |
| 上游范围 | `git log --oneline b61e891..fdfc578` = **11 个提交**（1.3.17 → 1.3.23）。本文行号取**修复提交**（可 `git show <sha>:<path> \| grep -n` 原样复现）；最终树 `fdfc578` 行号不同，落地时请重新锚定 |
| 上游基线 | `docs/UPSTREAM-1.3.17-1.3.23.md`（md5 `6dcea5f8250aeeeef2b41758312a7fc3`）。**本文不重复它的结论**，只补它没做的三件事：① 本仓语料影响面（跑命令数出来）② 落到"改哪个文件/哪一行/开关叫什么/要不要重生成 `diag-flags.json`"的补丁方案 ③ 可证伪判据 + 变异自证设计 + 排序 |
| 我们的语料 | `allwallpaper/**`（98 个 `.pkg/.mpkg`）+ `~/.dsh-mpkg-wallpaper/*.mpkg`（5 个）= **103 个候选**；其中**带 `scene.json` 的 56 个**（21 个 `scene.pkg` + 35 个场景 `.mpkg`）、PKGM 视频容器 **46** 个、壳 1 个 |
| 语料统计工具 | 本轮自写**流式 PKGV/PKGM 读取器**（`node --input-type=module` heredoc，逐 entry `readSync`，**从不整包 `readFileSync`**；本机最大包 792MB 全程只读 entry 表 + ≤8MB 的 JSON entry）。全文见 **§附 A**，数字都可复现。每条命令跑前 `free -m` |
| 本文快照 | `core/we-scene-bundle.js` md5 **`c582515d6aecbed5d51c3e1886153303`**（**12512 行**）、`demo.html` `4368917ea784ed095dbac68502c61dd4`（7039 行）、`elysia/scene-scripts.js` `0a0d7bc18c6a95e24c42f0cf06de6100`（1622 行）、`elysia/media-host.js` `b3ea5d618b178469a92da70dd3970d10`（544 行）、`core/attach-transform.mjs` `4d89c19327109f805dab6787fdf798fd`（594 行）、`core/puppet-skin.js` `a2ba45c50b9b43bd969c55ba088de57b`、`elysia/we-renderer/puppet.js` `9284084d74fe72c4d2eda8d9cd6b9003` |
| ⚠ 行号漂移 | `core/we-scene-bundle.js` 写作期间被**另一个写入者**改过（本仓 `HEAD` 在写作中从 `36c6a0c` 走到 `de60ce6`）：本文行号只对上面那个 md5 有效。**每处都附锚点串**，落地时按锚点重新定位 |
| 许可纪律 | `references/` 里上游源码是 **MIT ⇒ 可移植，但必须登记**；`references/wer-ref/`（GPL-2.0-only）与 `references/we-layerd-ref/`（无许可）**本轮仍只引行为结论**。GPL 仓可以收 MIT。逐项"能不能抄 / 抄了登记到哪里"见 **§附 B** |
| P 编号 | `docs/PATCHES.md` 已用到 **P-148**；基线文档 §3.3 建议的 P-134–P-138 **已被占用**（P-136 指针尾迹 / P-139 Kaltsit / P-140 vapor / P-141 脚本 API / P-142 测试台 / P-143 下拉 / P-144 粒子 children / P-145…P-148 另线）⇒ 这六项建议 **P-149 – P-154**（分配见 §7） |
| 门禁现状 | `grep -c '^add "' tests/run-all-tests.sh` = **111**。新增门禁一律 `add "<名>" "node tests/<名>-test.mjs" "" "^SKIP <名>"  # 注释` 追加一行 |

---

## 1. `overbright`（材质常量 `ui_editor_properties_overbright`·粒子实例亮度）

**一句话**：**能抄但不必抄**（契约只有 4 行，按规格重写即可）；本仓**今天就有 25 个粒子层的亮度是错的**（最大 5×、最小 0.17×）。

### 1.1 上游是什么

* 语义：粒子材质 `passes[].constantshadervalues.ui_editor_properties_overbright`，**缺省 1**，**乘在精灵实例 RGB 上（不动 alpha）**；取值**必须显式判空**——`Number(null) === 0`，键缺失若走 `Number()` 就变成 0（整层全黑）。
* 出处（`git show 19c5fab:renderer/vendor/we-scene/render/particles.js | sed -n '590,600p'`）：

```
    const rawOb = cv ? cv.ui_editor_properties_overbright : undefined
    const ob = Number(rawOb)
    this.overbright = rawOb == null || !Number.isFinite(ob) ? 1 : Math.max(0, ob)
```

* 消费点：同文件 `:1300` —— `const bright = (this._ov.brightness || 1) * (this.overbright ?? 1)`（`_ov` = `instanceoverride`）。
* CPU 参考光栅必须**同构**：`git show 19c5fab:scripts/particle-raster.mjs | sed -n '60,66p'` 里同一行公式，注释明写"改一边必改另一边"。
* 上游自报影响面（`19c5fab` commit message）："全库 68 壁纸 / 159 材质带该键（0.17–10）此前全被静默丢弃"。

### 1.2 我们现在是什么 —— **完全没有（0 实现）**

本轮实测（排 `node_modules` 与 `demo/assets/*.js` vendored 产物）：

```
### overbright — 行数/出现次数
core/we-scene-bundle.js        lines=0  occ=0
core/attach-transform.mjs      lines=0  occ=0
core/puppet-skin.js            lines=0  occ=0
core/we-pointer-source.mjs     lines=0  occ=0
core/we-particle-pointer.mjs   lines=0  occ=0
demo.html                      lines=0  occ=0
elysia/scene-scripts.js        lines=0  occ=0
elysia/media-host.js           lines=0  occ=0
elysia/we-renderer/particles.js lines=0 occ=0
elysia/we-renderer/textures.js lines=0  occ=0
tests/*.mjs 合计: 0
demo/assets/*.js（vendored 产物，只作对照）: 0
```

⇒ **全仓 0 行 / 0 次出现**（与基线文档"0 命中"一致，本轮把它变成了逐文件的行数+次数两列）。

我们今天有什么（**有但语义不同**）：

* 粒子材质是**在宿主里**解析的：`demo.html:2005`（锚点 `// 粒子层：def.material → pass.textures[0]`）→ `demo.html:2021-2022`：
  `const pass = material && material.passes && material.passes[0]` / `const texName = pass && pass.textures && pass.textures[0]`。
  **它只取 `textures[0]` 与 `blending`，`constantshadervalues` 整块被丢弃**（`demo.html:2027`）。
* 渲染端每颗粒子的颜色在 `core/we-scene-bundle.js:11443-11446` 装配：

```
      const colorR = Math.max(0, Math.min(1, p.color[0] || 0))
      ...
      vis.push([p, sz, a, colorR, colorG, colorB, frameUV, ratioP])
```

  ⇒ 没有 `bright` 因子，且**每通道已被钳到 `[0,1]`**（这一点直接决定补丁写法，见 1.4）。
* `layer.brightness`（`:8723` 的 `g_Brightness`、`:10564` 的 `color4`）是**图层/文本**的亮度，与粒子实例无关；`?bright=` 是显示滤镜（`DISPLAY_KEYS`，`:109`）。

### 1.3 语料影响面（命令 + 真实输出）

工具：§附 A 的流式扫描器（join 规则：`objects[].particle` → `particles/**/*.json` 预设图（深度 ≤4）→ `preset.material` → `materials/**/*.json` 的 `passes[].constantshadervalues`）。

```
[1] overbright: materials= 38 materialPkgs= 15 values= {"1":13,"2":4,"5":2,"1.33":5,"1.47":1,"1.1":3,"1.21":2,"0.17":1,"1.77":1,"0.66":1,"0.25":2,"1.01":3}
[1] layers(joined via preset graph)= 54 layerPkgs= 15 particleObjsJoined= 238
[1] overbright 非1 层(包::层::材质值)
    0917/3195212886/scene.pkg :: 苍月草 :: [1.33]
    0917/3233141951/scene.pkg :: 鼠标 :: [1.33]
    0917/3351163962/scene.pkg :: Hearts :: [1.47]
    0917/3448877775/scene.pkg :: rain_drop_screen :: [1.1]
    0917/3509243656/scene.pkg :: star1 :: [1.21]
    0917/3509243656/scene.pkg :: star2 :: [1.21]
    0917/3509243656/scene.pkg :: new_particle_system :: [0.17]   ← 该层两处
    dd/3544152633/scene.pkg :: Shooting star-blue-2 :: [2]
    dd/3544152633/scene.pkg :: reactive Stars :: [5]
    dd/3554161528/scene.pkg :: 雪景远景 :: [1.77]（两处）
    dd/3554161528/scene.pkg :: cherry blossoms on cursor :: [1.21]
    dd/3660962877/scene.pkg :: cherry blossoms on cursor :: [1.33]
    dd/3715743282/scene.pkg :: 灰烬大 :: [0.66]
    dd/3719111841/scene.pkg :: Glass Shards :: [5]
    dd/3719111841/scene.pkg :: Bokeh Hex :: [0.25]
    dd/3719111841/scene.pkg :: Bokeh Cir :: [0.25]
    （另有 夜莺/流萤、红鸾樱落、wallpapertest1 三处跨语料根重复）
[1] overbright 恰为1 的层数: 29 总层数: 54
```

* **受影响**：材质 **38 个**、粒子层 **54 个**、命中包 **15 个**（其中跨语料根重复：红鸾樱落 ×3、夜莺/流萤 ×3、`~mpkg/d5007a52…` ≡ 夜莺；**互不相同的 `scene.pkg` 是 11 个**）。
* **真正会变画面的**：值 ≠ 1 的层 **25 个**（值 = 1 的 13 个材质不变 ⇒ 必须逐位不变，见 1.5）。
* 极值：`reactive Stars` / `Glass Shards` = **5**（今天暗 5 倍）、`Bokeh Hex`/`Bokeh Cir` = **0.25**（今天亮 4 倍，与上游 3151551777 的病一模一样）、`new_particle_system` = **0.17**。

### 1.4 补丁方案

| 步骤 | 文件 | 锚点 / 行 | 内容 |
|---|---|---|---|
| ① 取值（宿主） | `demo.html` | `:2021-2027`（锚点 `const pass = material && material.passes && material.passes[0]`） | 在 `pass` 拿到之后、`layer.particleBlending` 之前加：<br>`const obRaw = pass && pass.constantshadervalues ? pass.constantshadervalues.ui_editor_properties_overbright : undefined`<br>`const obN = Number(obRaw)`<br>`layer.__particleOverbright = (obRaw == null \|\| !Number.isFinite(obN)) ? 1 : Math.max(0, obN)` |
| ①b 子系 | `demo.html` | `:1999`（锚点 `out.set(c.name, { def: cdef, texName: texName,`） | 子系已在同一段拿到 `pass` ⇒ 把 `overbright` 一起放进 map 条目，供子系自己的实例色使用（**不要**继承父层因子） |
| ② 乘进去（渲染端） | `core/we-scene-bundle.js` | `:11443-11446`（锚点 `vis.push([p, sz, a, colorR, colorG, colorB, frameUV, ratioP])`） | `const obf = (layer.__particleOverbright ?? 1)`；三通道 `* obf`。**注意同处的 `Math.min(1, …)`**：必须**先乘后钳**，或对 `obf > 1` 不设上界——否则 `overbright=5` 会被钳回 1，等于没修 |
| ②b 子系路径 | `core/we-scene-bundle.js` | `:11748`（锚点 `function renderParticleChildren`）之后同一段装配 | 用子系自己的因子（与 ①b 对应） |

* **开关名建议**：`?overbright=legacy`（缺省 = 修复后；`legacy` = 恒 1，逐位回到今天）。**不要**复用 `?bright=`（那是显示滤镜，语义完全不同）。
* 开关的写法照本仓既有惯例（正则字面量，便于 `diag-flag-check` 规则 (c) 抓到）：见 `core/puppet-skin.js:112-115` 的 `bindOrderLegacy(search)`（`/[?&]bindorder=legacy/`）。
* **`web/diag-flags.json` 必须重生成**：在 `docs/README-DIAGNOSTICS.md` 主表加一行 → `node tests/diag-flag-check.mjs`（该脚本只读代码、只写 `web/diag-flags.json`，代码有·文档无会退出码 1）。
* 登记：`docs/PATCHES.md` 记 **P-149**；台账行与 `THIRD-PARTY.md` 段落见 §附 B。

### 1.5 可证伪判据（新门禁 `particle-overbright`，无浏览器/无 GPU）

1. **取值契约**（纯函数级）：`constantshadervalues` 为 `{ui_editor_properties_overbright: 0.25}` → 0.25；`{0.17}` → 0.17；`{}`（**键缺失**）→ **1**；`{ui_editor_properties_overbright: "abc"}` → 1；`{…: -3}` → 0（`Math.max(0,·)`）；无 material → 1。
2. **端到端数字（真包，修前 → 修后）**：`dd/3719111841` 的 `Bokeh Hex`/`Bokeh Cir` 实例 RGB 均值比 = **1.00 → 0.25**（±1e-3）；`dd/3544152633` 的 `reactive Stars` = **1.00 → 5.00**；`0917/3509243656` 的 `new_particle_system` = **1.00 → 0.17**。同时断言**顶点流其余字段逐位不变**（位置/尺寸/UV 的 sha256）。
3. **语料计数守卫**（防"忘了覆盖某条路径"）：`overbright≠1` 的层 = **25**、材质 = **25**（38 − 13）；值 = 1 的 13 个材质对应层整帧**逐位不变**。
4. **变异自证（RED-IF-REVERTED，2 组，只在 `/tmp` 真文件副本上做，真树 sha256 跑完不变）**：
   * R1 把取值改回 `Number(rawOb)`（去掉判空）⇒ 断言 1 的"键缺失 = 1"**必须变红**（会得到 0）。
   * R2 把 `Math.min(1,…)` 移回乘之前 ⇒ 断言 2 的"5.00"**必须变红**（会得到 1.00）。
   * R3（可选）删掉子系那条 ⇒ 子系断言变红。

### 1.6 风险与回退

* 改到的路径：宿主粒子上料（`demo.html`）+ 实例色装配（`core/we-scene-bundle.js` 粒子段）。**不碰** 149 个系统共用的层投影/合成主干，也**不碰** `elysia/we-renderer/particles.js`（那份是 elysia 渲染器，与 demo 主链不是同一条）。
* `overbright = 1` 的层（29/54 层、13/38 材质）：因子 1 ⇒ **逐位不变**；门禁里用 sha256 钉住。
* 回退：`?overbright=legacy` 单开关逐位回退（不需要"逐位回退到某个 commit"）。
* 对既有门禁的影响：`particle-children`（P-144）里有"父系顶点流逐位不变"的断言——**它会因为实例色变化而变红**，必须同批把该断言改成"结构字段不变（位置/尺寸/UV）"，或让那套断言走 `?overbright=legacy`。**这是本项唯一需要改动既有测试的地方，必须在 P-149 里显式落地。**

### 1.7 工作量与依赖

* **S**（近 1 段宿主 + 1 段装配 + 1 个门禁）。
* 依赖：无。可**立即做**；与 P-150/P-153 并行（见 §7）。

---

## 2. 封面 mip 链 + 三级优先级（`$mediaThumbnail`）

**一句话**：**契约能抄（MIT），实现自研**；本仓**今天有 10 个包的封面槽是空的**（`$mediaThumbnail` 只在 `usertextures` 里，而 `usertextures` 我们一处都没解析）；但上游那个"mip 链不重建 ⇒ 永远显示旧占位封面"的坑**在本仓不可能复现**——因为我们**从不读 mip**（实测 `LINEAR_MIPMAP` 全仓 0 行）。

### 2.1 上游是什么

三块契约（`8ea8214`）：

1. **上传后必须重建 mip 链**（`git show 8ea8214:renderer/src/scene-mount.ts | sed -n '855,890p'`，两处）：

```
          // [we-scene patch 2388299037] **必须重建 mip 链**：纹理是 makeTextureMip
          // 建的（MIN_FILTER=LINEAR_MIPMAP_LINEAR），挂载时的 mip 链来自程序化
          // 占位封面。只写 level 0 而 mipmap 不更新时，缩小的封面 quad（层 100×100
          // 放大 3.46 后 346px 采样 512 纹理）按 LOD≈0.56 在 level0/1 之间三线性
          // 插值，采到的仍是**旧占位环**……
          gl.generateMipmap(gl.TEXTURE_2D);
```

   第二处在同一段（`prev` = `$mediaPreviousThumbnail`，交叉淡入用），锚点 `// 同上：不重建 mip 会采到旧占位封面`。
2. **封面/元数据三级优先级**：外部真实封面 > 模拟/测试封面 > 壁纸内置封面；**外部源按 `hasMedia` 门控**（停播时不占驱动位）；模拟封面只在媒体启用时注册（commit message 逐条写了）。
3. **parse 侧 `usertextures` 合并 + 回落**（`git show 8ea8214:renderer/vendor/we-scene/scene/parse.js | grep -n textureFallbacks` → `:480/:489/:490/:499`）：合并时把**被覆盖的原槽名**另存 `pass.textureFallbacks`；渲染端**只在保留名（`$` 开头）查不到条目时**回落到它（`renderer.js:2696-2709`）。

### 2.2 我们现在是什么 —— **完全没有（槽名解析 0 实现）；mip 侧"有但语义不同"**

* **`usertextures` 在渲染器里 0 命中**：

```
$ for f in core/we-scene-bundle.js elysia/scene-scripts.js elysia/media-host.js demo.html; do printf '%-28s %s\n' "$f" "$(grep -c usertextures $f)"; done
core/we-scene-bundle.js      0
elysia/scene-scripts.js      0
elysia/media-host.js         0
demo.html                    1        ← 唯一一处是注释（见下）
```
* `$mediaThumbnail` / `$mediaPreviousThumbnail` 在 `core/we-scene-bundle.js` **0 命中**；`resolveTextureName`（`:8798`，锚点 `function resolveTextureName`）只有 `_rt_*` 分支，**没有 `$` 保留名分支**；查不到就 `return null` ⇒ 调用点 `:10955` 兜底成 1×1 透明纹理（`:8652` 的 `transparentTex`）。
* 唯一相关数据源：`elysia/media-host.js:357-361 getCoverForTexture()` 返回 `{kind:'url',url}` 或 `{kind:'bytes',bytes,mime}`；**唯一消费点** `demo.html:6934`（`cover: () => mpwMediaHost.getCoverForTexture()`）——**只喂面板，从不建 GL 纹理**。
* **失效注释（必须同批更正）**：`demo.html:6742-6743` 写"封面进画面走官方材质纹理槽 `$mediaThumbnail`（`effects[].passes[].usertextures`）—— 那一段解析在 `core/we-scene-bundle.js` 里（本文件无权改）"。**与事实不符**（bundle 0 命中）。
* **mip 侧**：`makeTexture`（`:12107`）`MIN_FILTER=LINEAR`（`:12153`）；`makeTextureMip`（`:12196`）`MIN_FILTER=LINEAR`（`:12207`）、`generateMipmap` **只对 POT 调用**（`:12251`）。实测：

```
### LINEAR_MIPMAP 行数/出现次数
core/we-scene-bundle.js        lines=0 occ=0
demo.html                      lines=0 occ=0
elysia/we-renderer/textures.js lines=0 occ=0
elysia/media-host.js           lines=0 occ=0
elysia/demo-elysia.js          lines=0 occ=0
```

  ⇒ **我们从不读 mip**。两个后果：(a) 上游那个失败模式（旧占位 mip 被三线性采到）在本仓**不可能发生**；(b) 上游要的"缩小采样按 mip 淡化细线"的观感我们**也没有**。所以"mip 重建"这条契约要么与"启用 mip 过滤"**同批**做，要么先不做（见 2.4 分两步）。

### 2.3 语料影响面

`usertextures` 在语料里出现在**三个层级**（本轮用 JSON 路径遍历实测）：

```
### 3544152633 :: scene.json  (usertextures nodes: 4)
     $.objects[41].effects[0].passes[0].usertextures = [null,{"name":"$mediaPreviousThumbnail","type":"system"},{"name":"$mediaThumbnail","type":"system"}]
     $.objects[46].effects[0].passes[0].usertextures = （同上）
     $.objects[47].effects[0].passes[0].usertextures = （同上）
     $.objects[62].effects[0].passes[0].usertextures = [null,{"name":"$mediaThumbnail","type":"system"}]
### 3544152633 :: materials/workshop/3200298808/placeholder.json  (usertextures nodes: 1)
     $.passes[0].usertextures = [{"name":"$mediaThumbnail","type":"system"}]
### 3351163962 :: scene.json  (usertextures nodes: 10)
     $.objects[8].instance.usertextures = ["pbr2"]                    ← 作者贴图名（非保留名）
     $.objects[119].effects[0].passes[0].usertextures = [null,{"name":"$mediaThumbnail","type":"system"}]
     $.objects[119].effects[1].passes[0].usertextures = [null,{"name":"$mediaPreviousThumbnail","type":"system"}]
     （objects[120]/[123]/[124] 同形）
### 3326873240 :: scene.json  (usertextures nodes: 2)
     $.objects[25].effects[0].passes[0].usertextures = [null,{"name":"$mediaPreviousThumbnail","type":"system"}]
     $.objects[25].instance.usertextures = [{"name":"$mediaThumbnail","type":"system"}]
```

token 计数（同一扫描器）：

```
TOK "usertextures"             occ=102 entries=26 pkgs=17
TOK "$mediaThumbnail"          occ=19  entries=12 pkgs=11
TOK "$mediaPreviousThumbnail"  occ=15  entries=9  pkgs=9
TOK "mediaThumbnailChanged"    occ=77  entries=19 pkgs=14
### [2] $media* 引用分布: materials= 2  presets= 0  scene.json= 19  other= 0
    dd/3544152633/scene.pkg::materials/workshop/3200298808/placeholder.json($mediaThumbnail)
    dd/3660962877/scene.pkg::materials/workshop/3449579583/placeholder.json($mediaThumbnail)
### `$` 开头的 material `passes[].textures` 条目 = 0
```

* **今天空着的封面槽**：`$mediaThumbnail` + `$mediaPreviousThumbnail` = **34 次**（19+15）、落在 **21 个 entry**（12+9，两集合有重叠 ⇒ 去重后 ≤21）、**11 个包**；其中**材质级的 2 个**（`3544152633`、`3660962877` 的 `placeholder.json`，即相框/TV 屏那类"占位图"层）——这 2 个是**纯 renderer 侧**就能修好的确定性收益；其余在 `scene.json`（`objects[].effects[].passes[]` 与 `objects[].instance`），走的是同一条 pass 归一化路径，一并修复。
* 内联 `scene.json` 的 `usertextures` 节点（JSON 路径遍历实测 3 个包）：`3544152633` **4 处**（全在 `objects[].effects[].passes[]`）、`3351163962` **10 处**（1 处是 `objects[8].instance.usertextures = ["pbr2"]`，其余为 `objects[119]/[120]/[123]/[124]` 的 effects pass）、`3326873240` **2 处**（1 effects + 1 `objects[25].instance`）⇒ **effects 内联 pass 合计 ≥ 14 处、`instance.usertextures` 2 处**（其余 `usertextures` 计数在 `materials/*.json` 里）。
* 保留名**只从 `usertextures` 进来**（`$` 开头的 `passes[].textures` 条目 = 0）⇒ 不做 `usertextures` 合并，保留名机制就没有入口。
* `mediaThumbnailChanged` 77 次 / 14 包 ⇒ 脚本侧回调面已经接（`elysia/media-host.js` 会派发），缺的只是**纹理槽**。

### 2.4 补丁方案（**建议分两步，第二步独立开关**）

**第一步（P-150a，低风险、收益确定）**：

| 步骤 | 文件 | 锚点 / 行 | 内容 |
|---|---|---|---|
| ① `usertextures` 合并 | `core/we-scene-bundle.js` | `resolveEffectChain`（`:2629`），push 块 `:2666-2675`（锚点 `effect.materialPasses.push({`） | 读 `mp.usertextures`：槽 `i` 有条目则覆盖 `textures[i]`，并把**被覆盖的原值**存 `textureFallbacks[i]`（未覆盖时 `textureFallbacks[i] = textures[i]`）；元素为字符串或 `{name,type:'system'}` 两种形态 |
| ①b 内联 effects | 同上（同一函数逐层调用） | `objects[].effects[].passes[]` 的材质来源 | 与 ① 同一实现（语料内联 effects pass **≥14 处**，见 2.3） |
| ①c 粒子实例 | `demo.html` | `:2021-2022` | `pass.usertextures[0]` 优先于 `pass.textures[0]`（如 `3351163962 objects[8] = ["pbr2"]`） |
| ② 保留名解析 | `core/we-scene-bundle.js` | `resolveTextureName` `:8798`（在 `_rt_` 分支**之前**） | `if (name[0] === '$') { const t = textures.get(name); if (t) return t; const fb = fallbackFor(name); return fb ?? null }` |
| ③ 宿主喂纹理 | `demo.html` | 媒体块（消费点 `:6934`，`mpwMediaTick` 一带） | 用 `getCoverForTexture()` 的 url/bytes 解码成 `{rgba,w,h}` → `textures.set('$mediaThumbnail', …)`；旧封面顺位到 `$mediaPreviousThumbnail`；**门控 = `hasMedia`**（`elysia/media-host.js:226 hasThumbnail` 已有等价判据），停播不占槽 ⇒ 槽回落 `textureFallbacks` |
| ④ 注释更正 | `demo.html` | `:6742-6743` | 改成"解析在 `resolveEffectChain` 的 `usertextures` 分支里"（本轮实测：原注释与事实不符） |

**第二步（P-150b，独立开关 `?covermip=official`）**：仅当同时把该纹理的 `MIN_FILTER` 提升为 `LINEAR_MIPMAP_LINEAR` 时，才在上传 level 0 后补 `gl.generateMipmap`（POT 时；NPOT 保持 `LINEAR`，理由见 `:12246-12251` 的既有注释：Adreno 大 NPOT `generateMipmap` 静默失败）。**缺省关闭**——理由：本仓全链 `LINEAR`，单独加 `generateMipmap` 是死代码；而全局改过滤策略会动到**所有**纹理的观感（149 个系统），风险与"让封面框有图"的收益不成比例。

* **开关名**：`?cover=legacy`（关掉 `usertextures` 合并与保留名解析 ⇒ 回到今天：槽 = `null` → 透明兜底）；第二步 `?covermip=official`（缺省 off）。
* **`web/diag-flags.json` 必须重生成**（两个新开关都要进 `docs/README-DIAGNOSTICS.md` 主表 → 跑 `tests/diag-flag-check.mjs`）。
* 登记：**P-150** + 台账行 + `THIRD-PARTY.md` 段（§附 B）。
* 既有门禁影响：`media-host` 门禁（109 断言，真包 `3554161528`+`3544152633`+`3660962877`）会经过这条路径 ⇒ 需要**同批**加"槽命中 = 封面纹理、未命中 = 透明"的断言，避免它变成隐式回归。

### 2.5 可证伪判据（新门禁 `media-cover-slot`）

1. **合并语义**（纯数据级）：`textures=[A,B]` + `usertextures=[null,{name:'$mediaThumbnail',type:'system'}]` ⇒ 生效槽 = `[A,'$mediaThumbnail']`、`textureFallbacks = [A,B]`；`usertextures` 缺省 ⇒ 逐位等于今天。
2. **三级优先级（桩）**：外部源（`hasMedia=true`）> 测试/模拟封面 > 内置 `textureFallbacks`；`hasMedia=false` ⇒ **必须落到内置**（不得空白）。
3. **真包数字**：`dd/3544152633`（槽 1/2）、`dd/3660962877`（槽 0）——修前 `entry === transparentTex`（1×1），修后 `entry.width > 1` 且内容 = 桩封面；`_rt_*` 之外的包内纹理**一条都不变**。
4. **变异自证（3 组）**：R1 删掉 `usertextures` 合并 ⇒ 落红；R2 保留名查不到时不回落 `textureFallbacks` ⇒ "内置可达"落红；R3 去掉 `hasMedia` 门控 ⇒ "停播不占槽"落红。

### 2.6 风险与回退

* 第一步改 `resolveEffectChain`（**所有**效果层共用的归一化）+ `resolveTextureName`（所有纹理解析共用）⇒ 必须"缺省行为逐位不变"作为回归闸门（语料 56 个场景包逐帧 sha256 / 或至少效果层帧摘要）。
* 第二步只碰一张封面纹理的过滤参数 → 风险独立，开关独立。
* 回退：`?cover=legacy` / `?covermip=official`。
* 依赖：无硬前置。与 P-151 **同函数**（`resolveTextureName`）⇒ **必须串行**。

### 2.7 工作量与依赖

* 第一步 **M**；第二步 **S**。建议先落第一步（它带来全部可见收益）。

---

## 3. copybackground z 序捕获（合成源不能预渲染）

**一句话**：**只可参考行为、必须自研**（我们**没有** `groupTarget` / `compositeFBOs` 结构）；本仓语料影响面比上游小两个数量级（**2 个材质 / 1 个包**），风险却是六项里最高的 ⇒ **最后做**。

### 3.1 上游是什么（`6ea9d14`）

* 现象：**内容 = 身后已渲染画面**的合成源（`copybackground`）**不能在预渲染阶段做**——预渲染跑在主循环之前、画布只有 clearcolor，做出来是空图。
* 正解（`git show 6ea9d14:renderer/vendor/we-scene/render/renderer.js`）：

```
1634:  let groupTarget = null
1637:  // 空 composelayer 源在主循环走到该层 z 序时由 captureEmptyComposeAtZOrder 回读画布填入。
1641:  const pendingEmptyCompose = new Map()
1647:  const zOrderComposePersist = new Map()
1893:  async function captureEmptyComposeAtZOrder(layer, cam, viewProj, width, height, time) {
1894:    if (!compositeEnabled || groupTarget) return
2122:        if (pendingEmptyCompose.has(layer.id)) {
2123:          await captureEmptyComposeAtZOrder(layer, cam, viewProj, width, height, time)
2250:    pendingEmptyCompose.clear()
2254:    for (const [n, fbo] of zOrderComposePersist) compositeFBOs.set(n, fbo)
```

  路由（`:2314-2320`）：`const isEmptyCompose = src.isContainer && !src.hasChildren && srcImage.indexOf('models/util/composelayer') === 0 && !(src.effects||[]).some(e=>e.visible)`；注释紧接着写明"**copybackground 源同样不能在预渲染里做**"。
* 五条契约：① 登记待捕获 → ② 主循环走到它的 **z 序**再捕获 → ③ 带可见效果链的源必须走完整 `renderLayer`（否则只有静止副本）→ ④ 捕获必须 `await` 且**传场景时间**（`g_Time=0` 时 scroll 不流动）→ ⑤ 成品**留一帧**给排在源之前的引用方。
* 上游自报影响面：全库 **44 处** copybackground 合成源引用；空 `composelayer` 源 23 处行为不变。

### 3.2 我们现在是什么 —— **有但语义不同（只做了"消费方"，没做"生产方"）**

* 我们**已实现**：`copybackground` 解析（`:1554`，锚点 `copybackground: !!o.copybackground`）与该层**自身**效果链的 COPYBG 语义：

```
10650:    if (layer.copybackground || opts.copyBackground) {
10652:        const rt = getFBO(width, height, 'copybackground')
10661:          // ①(RE-23 官方) 层 copybackground=true → 该层**每个**效果材质注入 combos.COPYBG=1
10940:        if (copyBgEntry && (name === '_rt_FullFrameBuffer' || name === '_rt_default' || name === 'fullframebuffer')) {
```

* 我们**没有实现**：把"某个 copybackground 层"的成品**发布成命名合成源**给别的层用。证据：

```
$ grep -n 'copybackground\|_rt_imageLayerComposite\|_rt_FullFrameBuffer\|compositeFBO\|pendingEmptyCompose\|groupTarget' core/we-scene-bundle.js
1554:      copybackground: !!o.copybackground,
8801:      if (name.startsWith('_rt_imageLayerComposite')) return inputFBO
10645:    // ①(RE-08 #1 官方语义 2026-09-12) copybackground：该层的效果链**输入 = 背景帧缓冲的拷贝**
10652:        const rt = getFBO(width, height, 'copybackground')
10940:        if (copyBgEntry && (name === '_rt_FullFrameBuffer' …
```
  `pendingEmptyCompose` / `compositeFBOs` / `groupTarget` / `zOrderComposePersist` = **0 命中**。
* `resolveTextureName`（`:8798-8806`）对 `_rt_imageLayerComposite*` **返回引用方自己的 `inputFBO`** —— 正是上游改动**之前**的行为；其余 `_rt_*` 落命名 FBO 或 `textures.get()` → `null`。
* `effectFBOs` 是**逐层**的（`:10756` 每层 `new Map()`）⇒ 跨层合成源今天**必然解析失败**。

### 3.3 语料影响面

```
[3] copybackground: layers= 3 pkgs= 2
    names: wallpaperE/洛琪希/洛琪希1_3.mpkg :: QQ图片20230220222256
           wallpaperE/砂狼白子/砂狼白子02_10.mpkg :: sunaookami-shiroko-blue-archive-desktop-wallpaperwaifu.com
           wallpaperE/砂狼白子/砂狼白子02_10.mpkg :: Clock
TOK "copybackground"             occ=42 entries=10 pkgs=9
TOK "_rt_imageLayerComposite"    occ=12 entries=6  pkgs=5
[3] COMPREF 0917/3509243656/scene.pkg | materials/models/自制天空盒02/材质.json | ["_rt_imageLayerComposite_589_a"]
[3] COMPREF 0917/3509243656/scene.pkg | materials/models/Hollow Cylinder/diffuse_0.json | ["_rt_imageLayerComposite_433_a"]
```

* `copybackground=true` 的**层**只有 **3 个 / 2 个包**（上游是 44 处引用）；真正以 `_rt_imageLayerComposite_<源层id>_<后缀>` 采样合成源的**材质**只有 **2 个 / 1 个包**（`0917/3509243656`：`自制天空盒02` 采 `…_589_a`、`Hollow Cylinder` 采 `…_433_a`）。
* 另外 4 个包的 `scene.json` 里出现过 `_rt_imageLayerComposite`（`3327063360`、`3554161528`、`洛茜_07`、`砂狼白子11_03`）——本轮**只做了 token 命中计数，没有定位它们的 JSON 路径**（脚本？pass.bind？对象材质覆盖？）⇒ **影响面可能被低估，见 §8 U-1**。
* 引用方今天是"拿自己的输入 FBO 当合成源"⇒ 画面错但不是黑屏（`3509243656` 是天空盒/圆柱体，错的是 AO/遮挡内容）。

### 3.4 补丁方案

| 步骤 | 文件 | 锚点 / 行 | 内容 |
|---|---|---|---|
| ① 新结构 | `core/we-scene-bundle.js` | 主循环之前（与 `:10756` 同级作用域） | `const compositeSources = new Map()`（键 = `_rt_imageLayerComposite_<源层id>_<后缀>` + 源层 id；值 = `{fbo,w,h,frame}`，跨帧存活） |
| ② 发布 | 同上 | 主层循环 `:10126`（锚点 `if (!__layerVis \|\| layer.isContainer)`）内、**源层画完效果链之后** | 若该层 `copybackground` 且被引用（预扫一遍引用集合），把它的**效果链出口 FBO**（不是裸 blit）登记进 `compositeSources`；出口 FBO 是否等于成品**必须先出探针数字**（见 3.5） |
| ③ 解析 | 同上 | `resolveTextureName` `:8798-8806` | `_rt_imageLayerComposite*` 分支改为：先查 `compositeSources`（命中即返回），未命中再退回 `inputFBO`（保旧行为） |
| ④ 留一帧 | 同上 | 帧末 | 允许消费"上一帧成品"（引用方排在源之前的情况）；每帧末 GC `frame` 落后 >2 的条目 |
| ⑤ 开关 | 同上 | 与 `PFRAME_MODE`/`PQUAD_MODE` 同形 | `?composite=legacy` = 回到"返回引用方 `inputFBO`" |

* 新增副作用：`compositeSources` 持有的 FBO **不能**被既有的 FBO 池回收（`getFBO` 复用逻辑需检查）——这是本项最容易踩的内存坑。
* 登记：**P-151** + 台账行 + `THIRD-PARTY.md` 段（§附 B）。若最终**照抄**了上游 `captureEmptyComposeAtZOrder` 的任何片段，必须把登记从"按规格重写"升级为"照抄"并附逐行对照表（照 `THIRD-PARTY.md` §14/§15 的格式）。

### 3.5 可证伪判据（新门禁 `composite-zoomorder`）

1. **接线断言**（无浏览器）：引用集合 = 2（`…_589_a` / `…_433_a`）；源层 id 589/433 与 `copybackground=true` 的层一致；`?composite=legacy` 时 `resolveTextureName` 对这两个名字返回引用方 `inputFBO`（逐位等于今天）。
2. **内容断言**（真包 `0917/3509243656`）：修后合成源纹理中心像素**非零**且**时间差分非零**（证明效果链在跑，而不是静止副本）；修前 = 引用方输入（另一组数字）。
3. **顺序断言**：构造"引用方排在源之前"的合成样本 ⇒ 靠"留一帧"仍能取到上一帧成品（否则落红）。
4. **变异自证（2 组）**：R1 把分支改回 `return inputFBO` ⇒ 1/2 落红；R2 去掉"留一帧" ⇒ 3 落红。
5. **回归闸门**：其余 55 个场景包**逐帧摘要不变**（合成源只在 1 个包里被引用）。

### 3.6 风险与回退

* **风险：高**。改的是 `resolveTextureName` + 主层循环出口 + FBO 生命周期；`docs/UNTOUCHED-AREAS.md` 的口径（改主干必须 A/B）在这里适用。
* 回退：`?composite=legacy` 单开关；建议先合并 ①②（只发布、不改解析）+ 观测日志，再加 ③。
* 与 P-150（封面）：**同函数 `resolveTextureName` ⇒ 必须串行**。
* 依赖：建议在 P-150 之后（先让 `resolveTextureName` 增加一条"保留名"分支的模式稳定下来，再加"合成源"分支）。

### 3.7 工作量与依赖

* **L**（含 FBO 生命周期 + 探针 + 逐位回归）。

---

## 4. MDLS 变长骨名（variable-length bone names）

**一句话**：**可移植为"判据契约"、解析器自研**；但**本仓语料 0 命中**——本轮把基线文档 §4 U-7 的"未证实"证实为**我们没失步**（43 个 `.mdl` / 35 个含 MDLS，布局 A 全合法、非法骨 0）。

### 4.1 上游是什么（`be3c246`）

* 三种布局：**A** 固定 78B（`id@1 / parent@5 / matrix@13(64B) / name cstr@77`）；**B** 骨名前置变长；**C** 骨名前置 + 矩阵后变长 JSON 元数据。固定步进在**第一个命名骨之后永久失步**（`parent` 读成 `0x3F800000`/负值、矩阵退化成垃圾）。
* 策略（`git show be3c246:renderer/vendor/we-scene/render/mdl-parse.js | sed -n '302,308p'`）：

```
// 策略：**先按 A 固定布局整体解析并校验**（parent 全合法 + 每矩阵两列单位长度 +
// 平移有限），通过就逐位采用（旧模型零回归）；任一骨非法才判定为 B/C 变长布局，
// 顺序重解析：记录起点是 name cstr（UTF-8，可空），其后 12B 头在 ~80B 窗口内用
// 「id 有界 + parent 合法 + len 恰 64 + 矩阵正交有限」严格合取定位……
// 重扫必须拿全所有骨且全合法才采用，否则回退固定解析，绝不返回残缺骨架。
```

  函数锚点（`grep -n '^function'`）：`parseSkeleton` `:309`、`parseFixed` `:321`、`findHeader` `:343`。
* 同提交第三块：**零动画且无覆写的 puppet 不能再提前 return**（`git show be3c246:renderer/vendor/we-scene/render/mdl-skin.js | sed -n '174,181p'` 的 `identityEarlyOut`；`:302-304` 保持返回 `null` 的旧契约）——早退会让 `_world` 停在未填充的零矩阵 ⇒ 附着点 `cur=(0,0)` ⇒ 挂件被反向拽飞。**这一块属于 P-139/Kaltsit 域**（基线文档 §3.3 移植项 #6），本轮不重复设计。
* 上游自报影响面：**238 个 MDLS 骨架，236 逐位不变、2 个"旧坏→新好"**。

### 4.2 我们现在是什么 —— **有但只覆盖布局 A；且没有任何校验**

两套同源实现（都是**布局 A 定步**）：

```
core/attach-transform.mjs:154-183   （锚点 `  // 骨骼（MDLS）+ 动画（MDLA）`）
      let p = mdlsOffset + 9 ; p += 4 ; const boneCount = dv.getUint32(p, true) ; p += 4
      tmp = buf[p] ; type = dv.getUint32(p+1) ; parent = dv.getInt32(p+5) ; len = dv.getUint32(p+9)
      if (len === 0 || len > 4096) { 改按 10 字节头重读 }
      p += 9 + headExtra ; p += 4 ; 读 16 个 float ; p += len ; 跳过 NUL 结尾的骨名
elysia/we-renderer/puppet.js:312-330 （同一写法，注释自述"骨骼头变体"）
```

* `core/puppet-skin.js:52`（锚点 `const mdls = indexOfBytes(buf, 'MDLS', 9)`）**只取偏移，不解析骨**。
* **没有校验**：解析完不检查 `parent ∈ [-1, boneCount)`、不检查矩阵是否正交有限 ⇒ 一旦遇到布局 B/C，会**静默产出垃圾骨架**（这正是上游要修的病）。

### 4.3 语料影响面（本轮实跑**我们的真实解析器**）

命令：`import { parseMdl } from core/attach-transform.mjs`，对 43 个 `.mdl` entry 逐个跑（同时独立复刻 `core/attach-transform.mjs:159-183` 的定步循环做校验）。

```
mdl rows: 43
布局A 全合法(MDLS 解析无异常): 35 | 有异常: 0 | bones累计: 332 | 非法骨(mat/parent): 0 | 首记录疑似名字前置: 0
   3233141951 | models/龙_puppet.mdl | 2.01MB | bones: 21 badMat: 0 badParent: 0 | parseMdl.bones: 21
   3233141951 | models/头_puppet.mdl | 0.71MB | bones: 20 badMat: 0 badParent: 0 | parseMdl.bones: 20
   3554161528 | models/人物_puppet.mdl | 0.51MB | bones: 32 badMat: 0 badParent: 0 | parseMdl.bones: 32
   3719111841 | models/眼睛组合_puppet.mdl | 0.16MB | bones: 14 …  | parseMdl.bones: 14
   3509243656 | models/球体04/球体04.mdl | 26.79MB | bones: - noMDLS | parseMdl.bones: 0
   （其余 38 行同理；8 个 .mdl 无 MDLS = 静态网格）
### [4] .mdl entries= 43 pkgs= 11 bytes= 45.6MB
```

* **布局 B/C 命中 = 0**；`parseMdl().bones.length` 与声明 `boneCount` 逐一相等（1…32 骨）；矩阵非正交/平移非有限 = **0**。
* ⇒ 本项是**健壮性补丁**（保护"将来导入的包"），**今天没有可见收益**；价值在于"以后不回归 + 别人的包不炸"。

### 4.4 补丁方案

| 步骤 | 文件 | 锚点 / 行 | 内容 |
|---|---|---|---|
| ① 校验 | `core/attach-transform.mjs` | `:154-183`（锚点 `// 骨骼（MDLS）+ 动画（MDLA）`） | 布局 A 解析后加整体校验：`parent ∈ [-1, boneCount)`、每骨旋转部分两行单位长（±0.05）、平移有限、骨名以 NUL 终止 |
| ② 顺序重扫 | 同上 | 紧接 ① | 仅当 ① 失败：从 `mdlsOffset+17` 起按"name cstr → 严格合取定位 12B 头（id 有界 + parent 合法 + `len==64` + 矩阵正交有限）→ 矩阵（+ 可选 JSON cstr）"顺序重解析；**拿全且全合法才采用**，否则回退 ①（**绝不返回残缺骨架**） |
| ③ 同构 | `elysia/we-renderer/puppet.js` | `:312-330` | 两种做法：(a) 同构再写一遍；(b) 让它 `import { parseMdl } from '../core/attach-transform.mjs'` 复用唯一实现。**建议 (b)**（与 `core/puppet-skin.js` 的"唯一实现处"先例一致），但那是改 elysia 渲染器 ⇒ 单独一条 P 或并入本条并显式登记 |
| ④ 开关 | 同上 | 与 `bindOrderLegacy` 同形 | `?mdls=legacy` = 跳过校验与重扫（逐位回到今天） |

* 登记：**P-152** + 台账行 + `THIRD-PARTY.md` 段（§附 B）。
* 不要碰 `core/attach-transform.mjs:301` 的"无 `animationlayers` 时强套 `animation[0]`"（`identityEarlyOut` 的对应物）——**那是 P-139 的域**（基线文档 §2 bug#5 D1），本轮只交叉引用，避免两条线改同一函数。

### 4.5 可证伪判据（新门禁 `mdl-bone-layout`）

1. **零回归（最重要）**：43 个 `.mdl` 的**逐骨位姿 sha256 与修前完全相同**（今天 35/35 合法 ⇒ 加固不得改变任何现有包；骨数、parent 序列、bind 矩阵逐位比对）。
2. **正向能力**：合成 3 个布局 B 样本（骨名前置 + 变长名）与 1 个布局 C 样本（矩阵后 JSON）⇒ legacy 路径产生 parent 越界/矩阵非正交（断言"确实坏"），新路径解析出全合法骨且骨数 = 声明。
3. **保守性**：损坏样本（截断/骨数超界）⇒ 必须回退布局 A 且**不抛异常**；断言"返回的骨数组长度 == 声明骨数 或 空数组（绝无残缺中间态）"。
4. **变异自证（2 组）**：R1 去掉整体校验（永远走 A）⇒ 2 落红；R2 让重扫"拿不全也采用" ⇒ 3 落红。
5. 语料计数守卫：`MDLS` 骨架 = **35**、`.mdl` = **43**（语料被裁剪时按子集下限并打印）。

### 4.6 风险与回退

* 风险：**低-中**。纯解析加固 + 逐位回归闸门；但**必须**有 4.5-1 的逐位守卫，否则会像上游那样动到 236/238 个骨架（上游是靠"先校验后采用"才做到的）。
* 回退：`?mdls=legacy`。
* 依赖：与 P-139（Kaltsit 附着）**同文件不同函数** ⇒ 建议**排在 P-139 之后**合并，避免冲突。

### 4.7 工作量与依赖

* **M**。

---

## 5. `localStorage` 共享持久

**一句话**：**能抄（MIT，70 行）但建议按规格重写**；本仓**今天有 8 个包在用**，语义是"记住拖拽位置/时钟显隐"——**重开壁纸就复位**。**默认行为要不要变成持久化需要用户拍板**（与本仓"脚本沙箱不碰宿主存储"的既有纪律冲突）。

### 5.1 上游是什么（`9beb420`）

`git show 9beb420:renderer/vendor/we-scene/render/storage.js | sed -n '34,60p'`：

```
export function makeSandboxStorage(screenProvider, globalProvider) {
  const mem = new Map()
  const screen = normalizeProvider(screenProvider) || memProvider(mem)
  const global = normalizeProvider(globalProvider) || null
  // 选后端：LOCATION_GLOBAL 且有全局后端才走全局；其余（含非法值）一律 screen。
  const backendFor = (location) =>
    location === LOCATION_GLOBAL && global ? global : screen
  const api = {
    LOCATION_SCREEN,
    LOCATION_GLOBAL,
    getItem(key, location = LOCATION_SCREEN) { … },
    setItem(key, value, location = LOCATION_SCREEN) { … },
    // WE 文档名是 delete（保留字，脚本里只能 localStorage.delete(k) 成员调用，合法）；
    // DOM 名 removeItem 与语料别名 remove 都给。
    delete(key, location = LOCATION_SCREEN) { … },
    removeItem(key, location = LOCATION_SCREEN) { … },
    clear(location = LOCATION_SCREEN) { … },
    key(index, location = LOCATION_SCREEN) { … },
  }
```

* 契约：**同一张壁纸的全部脚本（五个 eval 点）共享一份**、**跨会话持久**；两级 `LOCATION_SCREEN`（缺省）/`LOCATION_GLOBAL`；`delete`（WE 文档名）+ `removeItem`（DOM 名）+ `remove`（语料别名）+ `get/set`；`key(index)`；约 100KB。

### 5.2 我们现在是什么 —— **有但语义不同（进程内、逐沙箱、不共享、不持久）**

`elysia/scene-scripts.js:1018-1032`（锚点 `// ①(修复 2026-09-12) WE 的 localStorage 是**脚本 API**`）：

```
    localStorage: (() => {
      const m = new Map();
      const get = (k, dflt) => (m.has(String(k)) ? m.get(String(k)) : (dflt !== undefined ? dflt : null));
      return {
        get, set: (k, v) => { m.set(String(k), v); }, remove: (k) => { m.delete(String(k)); },
        has: (k) => m.has(String(k)), clear: () => m.clear(),
        getItem: (k) => get(k), setItem: (k, v) => { m.set(String(k), v); }, removeItem: (k) => { m.delete(String(k)); },
      };
    })(),
```

* 构造点：`compileScript(source, opts)`（`:898` 起）里的沙箱 env ⇒ **逐脚本一份 Map**（注释自述"**不碰**宿主页面的存储"，`:1023`）。
* 缺口：**无** `delete`、`key()`、`keys()`、`LOCATION_SCREEN`/`LOCATION_GLOBAL`；**不跨脚本共享**、**不跨会话持久**。
* 既有的跨脚本通道是 `shared`：`createScriptCache()`（`:1196-1197` `return { map: new Map(), shared: {} }`，注释"每个 SceneRenderer 实例一个"）→ env 里以 `shared` 暴露（`:1141`）⇒ 同生命周期、**也不持久**。
* 宿主注入点：`applySceneScripts(scene, time, opts)`（`:1459`）已经在透传 `opts`（`audioBuffers`/`getVideoTexture`/`nodeFilter`…）⇒ 加一个 `opts.storageProvider` 是**顺着现有缝**的。
* 宿主页面自己有 41 处 `localStorage`（`demo.html`，UI 状态如 `:414` 的资源管理器折叠比例），**与脚本沙箱无关**；opaque-origin 探测在 `demo.html:166-172` 已有，可直接复用。

### 5.3 语料影响面

```
### [5] localStorage 调用（按包）
    dd/3326873240/scene.pkg                 -> {"set":5,"get":5}    keysample: storageName, thisLayer.origin,"miDragable",storageName,"miShowClock"
    dd/3327063360/scene.pkg                 -> {"set":5,"get":5}    （同上）
    dd/3554161528/scene.pkg                 -> {"remove":1,"set":1,"get":2}
    dd/3660962877/scene.pkg                 -> {"get":1,"set":1}    STORAGE_KEY, parent.origin
    wallpaperE/流萤/夜莺night——…崩坏星穹铁道.mpkg -> {"set":5,"get":5}  ← ≡ wallpapertest1 同名包 ≡ ~mpkg/d5007a52…
    wallpaperE/砂狼白子/砂狼白子11_03.mpkg   -> {"set":5,"get":5}
TOK "localStorage"    occ=66 entries=8 pkgs=8   （全部在 scene.json 里）
TOK "LOCATION_SCREEN" occ=0  entries=0 pkgs=0
TOK "LOCATION_GLOBAL" occ=0  entries=0 pkgs=0
TOK "resizeScreen"    occ=0  entries=0 pkgs=0
```

* **8 个包命中**（含跨语料根重复：夜莺/流萤 ×3）⇒ 互不相同的包 **6 个**；调用面**只有 `get/set/remove`**；键样 = `storageName`、`"miDragable"`、`"miShowClock"`、`STORAGE_KEY` ⇒ 语义 = **"记住拖拽后的位置 / 时钟显隐 / 面板状态"**。
* `LOCATION_*` = **0 命中** ⇒ 两级作用域今天没有语料需求（但契约要按上游补齐，缺省 `LOCATION_SCREEN`）。
* 收益：**重开壁纸不再复位** + 同壁纸多脚本共享（`3326873240`/`3327063360` 的 `storageName` 形态就是"生产者写、消费者读"）。

### 5.4 补丁方案

| 步骤 | 文件 | 锚点 / 行 | 内容 |
|---|---|---|---|
| ① 共享 | `elysia/scene-scripts.js` | `createScriptCache()` `:1196-1197`；env 构造 `:1024` | 把存储实例挂到 `cache.shared`（如 `cache.shared.__storage = makeSandboxStorage(...)`），env 的 `localStorage` 从它构造 ⇒ 同一壁纸全部脚本共享（`shared` 已有先例/注释 `:1512`） |
| ② 持久（**需用户拍板**） | `elysia/scene-scripts.js` + `demo.html` | `applySceneScripts` `:1459` 的 `opts` | 新增 `opts.storageProvider`（`{get(k),set(k,v),remove(k),keys()}`）；宿主用 `mpw.<包id>.<key>` 作键、页面 `localStorage` 作后端；**任何异常/opaque origin 一律静默降级为内存**（复用 `demo.html:166-172` 的探测） |
| ③ API 补齐 | `elysia/scene-scripts.js` | `:1024-1032` | 加 `delete(k)`、`key(i)`、`keys()`、`LOCATION_SCREEN`/`LOCATION_GLOBAL` 常量与第三参 `location`（缺省 `LOCATION_SCREEN`） |
| ④ 开关 | 同上 | 同形正则 | `?scriptstore=persist`（**建议缺省 = legacy**：不改变今天的默认行为，等用户拍板后再翻默认）；或反向 `?scriptstore=legacy` 若用户选择默认持久 |

* **纪律变更点（必须在文档里写清、由用户确认）**：现有注释的纪律是"不碰宿主存储"（`:1023`）。改成持久化 = 与本仓既有纪律冲突；`dsh-mpkg-wallpaper`（**插件仓，另一个仓库**）的 web 壁纸侧已有 `localStorage` facade（WP-1 的"opaque origin 下访问即抛"），**那是插件侧、与渲染器侧这份无关**，两边**不要互相引用实现**。
* 登记：**P-153** + 台账行 + `THIRD-PARTY.md` 段（§附 B；若照抄 `storage.js` 则升级为"照抄"并附逐行对照）。

### 5.5 可证伪判据（新门禁 `script-storage-persist`）

1. **共享**：真包 `dd/3326873240` 的写法（生产者写 `storageName`、消费者读）⇒ 脚本 B 读到脚本 A 写的值；**修前**：读到 `null`（各拿一个 Map）。
2. **持久**：用同一 `storageProvider` 新建一个 cache（模拟"重开壁纸"）⇒ 值仍在；换一个 provider（另一张壁纸）⇒ 读不到（命名空间隔离）。
3. **降级**：provider 的 `get/set` 抛错 ⇒ 脚本**不报错**、退化为内存（断言 `onError` 调用次数 = 0）；opaque origin 桩下同。
4. **API 面**：`delete/removeItem/remove/key/keys/LOCATION_*` 逐个断言；缺省 location = `LOCATION_SCREEN`。
5. **变异自证（3 组）**：R1 把存储实例改回"逐沙箱 `new Map()`" ⇒ 1 落红；R2 去掉 provider 透传 ⇒ 2 落红；R3 去掉 try/catch ⇒ 3 落红。
6. 语料计数守卫：命中包 **8**、调用面 `{get,set,remove}`（`LOCATION_*` = 0）。

### 5.6 风险与回退

* 风险：**低**（改的是沙箱 env 构造 + 宿主注入点；不动渲染主干）。唯一真风险是**纪律**（脚本能落地数据）⇒ 用开关把默认行为的选择权交给用户。
* 回退：`?scriptstore=legacy`（或反向）。
* 对既有门禁的影响：`scene-scripts` 相关门禁（`scene-script-api-gaps` / `media-host`）会经过 env 构造 ⇒ 必须保证"legacy 缺省下逐位不变"。

### 5.7 工作量与依赖

* **S–M**；依赖：**用户拍板**（默认是否持久）。可与任何项并行（**不同文件**）。

---

## 6. REPEAT 采样器（无界 UV 的 util 贴图）

**一句话**：**一行级契约，自研即可**；但**本仓语料 0 命中**（`util/clouds_256` = 0 次 / 0 包）⇒ 今天用户看不到差别，属"语料外/新包"的健壮性补丁。

### 6.1 上游是什么（`4b7b07e`）

`git show 4b7b07e:renderer/vendor/we-scene/render/gl-util.js | sed -n '39,47p'`：

```
export function makeTexture(gl, rgba, width, height, bitmap = null, opts = null) {
  …
  // 云效果（util/clouds_256）的 uv 随 g_Time 无界增长，必须 REPEAT —— CLAMP 下
  // 漂一会儿整片天空会被拉成边缘那一行（959417181）。
  const wrap = opts && opts.wrap === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE
```

* **谁 REPEAT**：`git show 4b7b07e:renderer/src/scene-mount.ts | grep -n wrap` → `:786` 只有一处：`utilName === "util/clouds_256" ? { wrap: "repeat" } : null` ⇒ 是**名字名单**，不是全局改。
* `util/black` / `util/clouds_256` 是**程序化生成**的内置 util 贴图（`particle-textures.js:1304-1310 buildBuiltinUtilTexture`）；非内置名必须返回 `null`（**不得吞掉** pkg/其它来源）。
* 上游自报影响面：`util/clouds_256` **×36 处 / 20 张壁纸**；`util/black` ×8。

### 6.2 我们现在是什么 —— **完全没有（0 行 REPEAT）**

```
$ grep -c REPEAT core/we-scene-bundle.js
0
$ grep -o REPEAT core/*.mjs elysia/we-renderer/*.js | wc -l      # 连 core/*.mjs 与 elysia 渲染器一起数
0
### [6] wrap sites（全部 CLAMP_TO_EDGE，共 6 对 12 行）
8199/8200、8292/8293、8341/8342、8508/8509（宿主上传纹理路径）
12151/12152（makeTexture）、12205/12206（makeTextureMip）
```

* `makeTexture(gl, rgba, width, height, bitmap = null, fmt = null)`（**:12107**）——**第 6 个位置参数已经是 `fmt`**（`:12109` 注释说明它承载 `.tex` format）；照上游那样在第 6 位加 `opts` 会**直接撞车**（见 6.4）。
* util 安装清单只有 3 个名：`demo.html:5191`（锚点 `for (const un of ['util/noise', 'util/noflow', 'util/white'])`），重建点 `:5163-5166`（`util/white`/`util/noflow` 是 1×1、`util/noise` 是 256×256 程序化 RG 噪声）；elysia 侧清单 5 个名（`elysia/demo-elysia.js:34`，含 `black`/`unity_white`，**无 `clouds_256`**）。
* **本机 WE 资产里 `clouds_256.tex` 存在**（`ls wallpaper_engine/assets/materials/util/` 实测：`clouds_256.tex`、`clouds_256.png`、`clouds_256.tex-json`、`black.tex` …），服务端路由 `/weassist/materials/<name>.tex` 也已在用（`demo.html:5194`）——**但没有一条代码路径去取它**。

### 6.3 语料影响面

```
### [6] util/* 全语料直方图（JSON entry 全文正则）
    util/composelayer.json          occ=162 pkgs=22   ← 内置**模型**名，不是贴图
    util/solidlayer.json            occ=117 pkgs=23   ← 同上
    util/white                      occ=39  pkgs=7
    util/fullscreenlayer.json       occ=19  pkgs=16
    util/solidlayer_instance_4.json occ=11  pkgs=8
    util/solidlayer_depthtest.json  occ=8   pkgs=2
    util/solidlayer_instance_depthtest_4.json occ=6 pkgs=1
    util/black                      occ=6   pkgs=6
    util/solidlayer_instance.json   occ=2   pkgs=1
TOK "util/clouds_256"   occ=0 entries=0 pkgs=0
### 含 godrays 效果的包（3 个）
    0917/3448877775  | 0917/3509243656 | 夜莺night——【time_variation_时间变化】…
    → 其材质**不引用任何 util 贴图**（`materials/effects/godrays_*.json` 无 `textures`，槽 0 = `previous`）
```

* `util/clouds_256` = **0 次 / 0 包**；真正的 util **贴图**只有 `util/white`（39/7）与 `util/black`（6/6），**两者都是 1×1 ⇒ wrap 无意义**。其余 `util/*` 命中全是**内置模型路径**。
* 含 godrays 的 3 个包用的是**包内自带 shader/material**，与 `util/clouds_256` 无关 ⇒ **今天 REPEAT 的收益 = 0**。
* 上游那张"云静止"的病（959417181）在我们的语料里**没有对应包**。

### 6.4 补丁方案

| 步骤 | 文件 | 锚点 / 行 | 内容 |
|---|---|---|---|
| ① 传参 | `core/we-scene-bundle.js` | `makeTexture` `:12107`、`makeTextureMip` `:12196` | **不能**用第 6 位（已被 `fmt` 占用）：加**第 7 参**或改成 options 对象（`{fmt, wrap}`）；缺省 `wrap = 'clamp'` ⇒ 逐位回退 |
| ② 名单 | 同上 + `demo.html` | `:12151-12152`、`:12205-12206` + `:5191-5195` | `const REPEAT_TEXTURES = new Set(['util/clouds_256'])`；装 util 纹理时按名单传 `{wrap:'repeat'}`。**不做全局改** |
| ③ 补资产 | `demo.html` | `:5191` 的清单 | 加 `util/clouds_256`（+ 可选 `util/black`）；服务端 `/weassist/materials/util/clouds_256.tex` 已可用，本机资产在 |
| ④ 开关 | 同上 | 同形正则 | `?wrap=legacy` = 全部 CLAMP（逐位回到今天） |

* 登记：**P-154** + 台账行 + `THIRD-PARTY.md` 段（可并入 P-149 的同一条目，见 §附 B）。
* 名单纪律：**宁窄不宽**——上游只对 `clouds_256` 开 REPEAT，我**没有**找到对其它 util 名开 REPEAT 的证据（§8 U-9）⇒ 名单先只放一个名。

### 6.5 可证伪判据（新门禁 `texture-repeat-wrap`，无浏览器 / mock GL）

1. **参数级**：`makeTexture(gl, …, {wrap:'repeat'})` ⇒ `TEXTURE_WRAP_S/T == gl.REPEAT`；缺省 / `{wrap:'clamp'}` ⇒ `CLAMP_TO_EDGE`；`makeTextureMip` 同。
2. **名单级**：装 util 纹理后，`util/clouds_256` = REPEAT，`util/white`/`util/noise`/包内 pkg 纹理 = CLAMP（**逐名断言，防"顺手全局改"**）。
3. **采样级（CPU 复算，不用 GPU）**：可平铺检查——`clouds_256` 的接缝列差 < 内部列差均值 ×1.6（上游契约"贴图必须可平铺"）；对一张合成可平铺贴图，`f(u+1,v) == f(u,v)`（模拟 REPEAT）而 CLAMP 下 `f(u>1,v) == f(1,v)`（**两种 wrap 的读数必须不同**）。
4. **变异自证（2 组）**：R1 把名单匹配删掉（恒 CLAMP）⇒ 2 落红；R2 把 `opts.wrap` 忽略 ⇒ 1 落红。
5. 语料计数守卫：`util/clouds_256` 引用 = **0**（今天门禁的这部分只能靠合成贴图 + mock GL；真包验证要等一张带云的包进语料——**这正是"收益 0"的量化表述**）。

### 6.6 风险与回退

* 风险：**低**（新增可选参数 + 名字名单）。唯一要小心的是 `makeTexture` 的**位置参数兼容**（第 6 位是 `fmt`，`:12107`；调用点 `:8650`/`:8652`/`:11369` 与 `demo.html` 多处）。
* 回退：`?wrap=legacy`。
* 与 P-150b **同函数**（`makeTextureMip` 的 mip 过滤参数）⇒ 二者若同批做，请共用同一个 options 形参，否则会有两套参数风格。

### 6.7 工作量与依赖

* **S**。

---

## 7. 排序表（收益 ÷ 风险）与并行性

### 7.1 排序（建议落地顺序）

| 排名 | 项 | P 编号 | 用户可见收益 | 风险 | 收益/风险 | 工作量 | 语料证据 |
|---|---|---|---|---|---|---|---|
| 1 | `overbright` | **P-149** | **高**：25 个粒子层亮度今天就是错的（最大 5×、最小 0.17×；Bokeh 0.25 亮 4 倍糊屏） | 低 | **最高** | S | 38 材质 / 54 层 / 15 包 |
| 2 | 封面槽 + 三级优先级（第一步） | **P-150a** | **高**：10 个包的封面/相框/TV 槽今天是空的（材质级 2 个包确定性可见） | 中低 | 高 | M | `$media*` 34 次 / 11 包（材质级 2，内联 effects ≥14 pass） |
| 3 | `localStorage` 共享持久 | **P-153** | 中：8 个包重开壁纸后位置/时钟复位 | 低 | 中高（**需用户拍板默认值**） | S–M | 66 次 / 8 包，只有 `get/set/remove` |
| 4 | MDLS 布局校验（判据先行） | **P-152** | **今天 0**（35/35 合法）；护"将来/别人的包" | 低-中 | 中（防回归） | M | 43 `.mdl` / 35 MDLS / 非法骨 0 |
| 5 | 封面 mip 重建（第二步） | **P-150b** | 低（本仓从不读 mip ⇒ 只有与 mip 过滤同批才有意义） | 中（动全局过滤策略才有风险） | 低 | S | `LINEAR_MIPMAP` 全仓 0 |
| 6 | REPEAT 采样器 | **P-154** | **今天 0**（`util/clouds_256` 0 命中） | 低 | 低（语料外健壮性） | S | 0 次 / 0 包 |
| 7 | copybackground z 序捕获 | **P-151** | 小：2 个材质 / 1 个包（3 层 true / 2 包） | **高**（主干 + FBO 生命周期） | **最低** | L | 2 材质 / 1 包 |

### 7.2 可并行性（按**是否碰同一文件/同一函数**判定）

**文件/函数重叠矩阵**（✗ = 同一函数或同一文件同一段 ⇒ 不能同时改）：

| | P-149 | P-150 | P-151 | P-152 | P-153 | P-154 |
|---|---|---|---|---|---|---|
| 改 `demo.html` | 粒子材质段 `:2005-2028` | 媒体段 `:6934` + util 段 `:5191` + 注释 `:6742` | — | — | 媒体/存储注入段 | util 段 `:5191` |
| 改 `core/we-scene-bundle.js` | 粒子色段 `:11443` | `resolveEffectChain` `:2629` + `resolveTextureName` `:8798` | `resolveTextureName` `:8798` + 主循环 `:10126` | — | — | `makeTexture` `:12107` |
| 改其它文件 | — | — | — | `core/attach-transform.mjs` + `elysia/we-renderer/puppet.js` | `elysia/scene-scripts.js` | — |

* **三条线可真正并行（文件级不重叠 ⇒ 不同 agent 同时改不会冲突）**：
  * **线 A = P-149**（`demo.html` 粒子段 + bundle 粒子色段）
  * **线 B = P-153**（`elysia/scene-scripts.js` + 宿主注入点；只有 `demo.html` 媒体段一行注入，与线 A 的段不重叠）
  * **线 C = P-152**（`core/attach-transform.mjs` + `elysia/we-renderer/puppet.js`；与 A/B 完全不重叠）
* **必须串行的一条链**：**P-150 → P-151 →（P-154 与 P-150b）**——三者都落在 `resolveTextureName` / `makeTexture(Mip)` 这组函数上。顺序理由：P-150 先加"保留名分支"（低风险、收益确定），P-151 再加"合成源分支"（高风险、收益小），P-154/P-150b 最后共用同一个 options 形参。
* **冲突提醒**：P-149 会让 `tests/particle-children-test.mjs`（P-144，61 断言）里的"父系顶点流逐位不变"变红 ⇒ 该断言必须在 P-149 同批调整（改为结构字段不变或走 `?overbright=legacy`）。**这是六项里唯一已知会碰既有门禁的地方。**

---

## 8. 诚实清单（证据不足 / 未证实 / 猜测）

| 编号 | 内容 |
|---|---|
| **U-1** | `_rt_imageLayerComposite` 在 **4 个包的 `scene.json`** 里出现（`3327063360`、`3554161528`、`洛茜_07`、`砂狼白子11_03`），本轮**只做了 token 命中计数，没有定位它们的 JSON 路径**（是脚本内字符串？`pass.bind`？对象材质覆盖？）⇒ **P-151 的"2 材质/1 包"可能低估**。落 P-151 前必须先跑一次 JSON 路径定位。 |
| **U-2** | 我**没有跑渲染器**（用户禁止启动浏览器，本机也无 GPU 断言）⇒ 所有"修前画面是空的/错的"都是**从代码路径读出来的**（如 `entry === null → transparentTex`、`resolveTextureName` 返回 `inputFBO`），**没有像素证据**。像素级结论一律留给各自门禁的探针。 |
| **U-3** | 语料计数里的"包数"按**包目录名**去重，而语料有跨根重复：红鸾樱落 ×3、夜莺/流萤 ×3、`~mpkg/d5007a52…` ≡ 夜莺。所以"15 个命中包"里**互不相同的 `scene.pkg` 是 11 个**；`overbright` 的 25 层同样含重复。**未逐包做 md5 同一性核验**（按大小+内容特征判断为重复）。 |
| **U-4** | `overbright` 的"层"是**通过 preset→children 图（深度 ≤4）**join 出来的；`preset.material` 缺失、`instance` 非字符串/非 `{value}` 形态的层会被漏掉（本轮 join 到 54 层，而语料共有 **238 个粒子对象**）⇒ **54 是下限，不是精确值**。 |
| **U-5** | 上游行号取的是**修复提交**（`19c5fab`/`8ea8214`/`6ea9d14`/`be3c246`/`9beb420`/`4b7b07e`）。若按最终树 `fdfc578`（1.3.23）落地，行号会不同（`particles.js`/`scene-mount.ts` 在 11 个提交间都变过）⇒ 落地时必须用 `git show <sha>:<path> \| grep -n` 重新锚定。 |
| **U-6** | MDLS：我只验证了"**现有语料在布局 A 下全合法**"，**没有**构造布局 B/C 的合成样本（那是补丁的门禁任务）⇒ "重扫算法能修好 B/C"这一点**在本轮未证实**（只证实了上游自己这么写、且上游用 238 个骨架做过回归）。 |
| **U-7** | `LINEAR_MIPMAP` / `REPEAT` / `usertextures` 的"0 命中"是对**指定文件**实测（`core/we-scene-bundle.js`、`demo.html`、`elysia/we-renderer/textures.js`、`elysia/media-host.js`、`elysia/demo-elysia.js`，`REPEAT` 另含 `core/*.mjs`）；`elysia/vendor/**`（vendored 第三方）**未逐一扫**。 |
| **U-8** | P-150③ 的可行性依赖"宿主能把 `coverUrl`/`coverBytes` 解码成 `{rgba,w,h}`"——`demo.html:6934` 只暴露了 `getCoverForTexture()` 的**描述符**，**我没有找到**现成的解码调用点 ⇒ **未证实**（落地第一步前先 grep 宿主解码器）。 |
| **U-9** | REPEAT 的名单是否应含其它 util 名（`util/noise`/`util/noflow`）：上游**只**对 `clouds_256` 开 REPEAT，我在本轮**没有**找到反例或补例 ⇒ 名单先只放一个名（宁窄不宽）。 |
| **U-10** | 上游 `storage.js` 我读了 `:34-70`（API 面）与别名注释，**没有**读 `normalizeProvider`/`memProvider` 的实现，也**没有**核"约 100KB"上限落在哪一行 ⇒ 若按"照抄"落地，需补读整文件。 |
| **U-11** | `resizeScreen` / `timeOfDay` / `ambientcolor` / `instanceoverride` 的命中数字（0/0/0/…）是**顺带**数的，**不属本轮六项**，未做补丁方案（它们在同一提交 `9beb420` 里，属"下一批"）。 |
| **U-12** | `core/attach-transform.mjs:301`（无 `animationlayers` 时强套 `animation[0]`）我**本轮没有复核**（属 P-139 域），文中只按基线文档交叉引用，**未独立验证**。 |

---

## 附 A：复现本文全部数字的命令（只读）

```bash
# 0) 环境（每条重命令前先看内存）
free -m

# 1) 上游：定位修复提交与行号（本文所有 <UP> 行号都用这个口径）
cd references/vendor-ref/webwallgl
git log --oneline b61e891..fdfc578                      # 11 个提交
git show 19c5fab:renderer/vendor/we-scene/render/particles.js | grep -n overbright
git show 8ea8214:renderer/src/scene-mount.ts | grep -n generateMipmap
git show 8ea8214:renderer/vendor/we-scene/scene/parse.js | grep -n textureFallbacks
git show 6ea9d14:renderer/vendor/we-scene/render/renderer.js | grep -n 'pendingEmptyCompose\|zOrderComposePersist'
git show be3c246:renderer/vendor/we-scene/render/mdl-parse.js | sed -n '302,308p'
git show 9beb420:renderer/vendor/we-scene/render/storage.js | sed -n '34,60p'
git show 4b7b07e:renderer/vendor/we-scene/render/gl-util.js | sed -n '39,47p'
git show 4b7b07e:renderer/src/scene-mount.ts | grep -n wrap

# 2) 我们：0 命中的三处（行数 vs 出现次数都要看）
cd ../../we-scene-demo
grep -c overbright core/we-scene-bundle.js demo.html elysia/we-renderer/particles.js   # 全 0
grep -c usertextures core/we-scene-bundle.js                                           # 0
grep -c LINEAR_MIPMAP core/we-scene-bundle.js demo.html elysia/we-renderer/textures.js # 全 0
grep -c REPEAT core/we-scene-bundle.js                                                  # 0
grep -n 'TEXTURE_WRAP_S' core/we-scene-bundle.js                                        # 6 对全 CLAMP_TO_EDGE
grep -n 'localStorage' elysia/scene-scripts.js | head                                   # :1018-1032 逐沙箱 Map
grep -c '^add "' tests/run-all-tests.sh                                                 # 111
grep -o 'P-1[0-9][0-9]' docs/PATCHES.md | sed 's/P-//' | sort -n | uniq | tail          # 最大 P-148

# 3) 语料：流式扫描器（不整包 readFileSync；§附 A.1 全文）
node --input-type=module < scan-corpus.mjs
```

### A.1 语料扫描器全文（本轮实际运行的版本）

> 说明：只用 `fs.openSync/readSync` 读 **entry 表** 与**单个 JSON entry**（≤8MB），**从不**把 220–792MB 的包整体读进内存；
> 输出即本文 §1.3/§2.3/§3.3/§5.3/§6.3 的数字来源。改用例：把 `ROOTS` 换成你的语料根即可。

```js
import fs from "node:fs"; import path from "node:path"
const ROOTS=["<WS>/allwallpaper","<HOME>/.dsh-mpkg-wallpaper"]      // ← 按需替换
const pkgs=[]
const walk=(p)=>{let st;try{st=fs.statSync(p)}catch{return}; if(st.isFile()){if(/\.(pkg|mpkg)$/i.test(p))pkgs.push(p);return} for(const f of fs.readdirSync(p))walk(path.join(p,f))}
ROOTS.forEach(walk)
const T0=["localStorage","LOCATION_SCREEN","LOCATION_GLOBAL","resizeScreen","timeOfDay",
  "util/clouds_256","util/black","_rt_imageLayerComposite","_rt_FullFrameBuffer","copybackground",
  "$mediaThumbnail","$mediaPreviousThumbnail","usertextures","ui_editor_properties_overbright",
  "ui_editor_properties","\"script\"","applyUserProperties","mediaThumbnailChanged"]
const tok={}; T0.forEach(t=>tok[t]={occ:0,entries:0,pkgs:new Set(),sample:new Set()})
const stat={scenePkgs:0,videoPkgs:0,otherPkgs:[],parsed:0,objs:0,copybgTrue:0,particleObjs:0,
  usertexObjs:0,overLayers:0,overLayerPkgs:new Set(),overMats:0,overMatPkgs:new Set(),overVals:{},
  overJoin:0,mdl:{ents:0,pkgs:new Set(),bytes:0}}
const classify=(p)=>{let fd;try{fd=fs.openSync(p,"r");const b=Buffer.alloc(64);fs.readSync(fd,b,0,64,0);fs.closeSync(fd)
  const ml=b.readUInt32LE(0); if(ml<1||ml>64)return "bad"; const m=b.toString("latin1",4,4+ml)
  return /^PKGV/i.test(m)?"PKGV":/^PKGM/i.test(m)?"PKGM":/^v\d/i.test(m)?"vShell":"bad:"+m}catch{return "open"}}
for(const f of pkgs){
  const id=path.basename(path.dirname(f)); const kind=classify(f)
  let fd;try{fd=fs.openSync(f,"r")}catch{continue}
  try{
    const st=fs.fstatSync(fd); const hl=Math.min(1<<22,st.size); const head=Buffer.alloc(hl); fs.readSync(fd,head,0,hl,0)
    const ml=head.readUInt32LE(0); const cnt=head.readUInt32LE(4+ml); let p=8+ml; const ents=[]
    for(let i=0;i<cnt;i++){if(p+12>head.length)throw new Error("table");const nl=head.readUInt32LE(p);p+=4
      const name=head.toString("utf8",p,p+nl);p+=nl;const off=head.readUInt32LE(p);p+=4;const size=head.readUInt32LE(p);p+=4
      ents.push({name,off,size})}
    const ds=p
    if(!ents.some(e=>/^scene\.json$/i.test(e.name))){ if(kind==="PKGM")stat.videoPkgs++; else stat.otherPkgs.push(id+":"+kind); fs.closeSync(fd); continue }
    stat.scenePkgs++
    const texts=new Map()
    for(const e of ents){ if(!/\.json$/i.test(e.name)||e.size>8<<20)continue
      const b=Buffer.alloc(e.size); fs.readSync(fd,b,0,e.size,ds+e.off); texts.set(e.name,b.toString("utf8").replace(/^\uFEFF/,"")) }
    const all=[...texts.entries()]
    for(const t of T0){ for(const [n,s] of all){ const c=(s.split(t).length-1)
      if(c){tok[t].occ+=c;tok[t].entries++;tok[t].pkgs.add(id); if(tok[t].sample.size<6)tok[t].sample.add(id+"::"+n)} } }
    let scene=null; try{scene=JSON.parse(texts.get("scene.json"))}catch{}
    if(!scene){stat.otherPkgs.push(id+":sceneJSONparse"); fs.closeSync(fd); continue}
    stat.parsed++
    const objs=scene.objects||[]; stat.objs+=objs.length
    const materials=new Map(), presets=new Map()
    for(const [n,s] of all){ if(/^materials\//i.test(n)){try{materials.set(n,JSON.parse(s))}catch{}}
      else if(/^particles\//i.test(n)){try{presets.set(n,JSON.parse(s))}catch{}} }
    const norm=(v)=>typeof v==="string"?v:(v&&typeof v.value==="string"?v.value:null)
    for(const o of objs){ if(o.copybackground===true||(o.copybackground&&o.copybackground.value===true))stat.copybgTrue++
      if(o.particle)stat.particleObjs++
      if(o.usertextures)stat.usertexObjs++ }
    const obMats=new Set(); let ov=0
    for(const [n,j] of materials){ for(const pass of (j.passes||[])){const c=pass&&pass.constantshadervalues
      if(c&&Object.prototype.hasOwnProperty.call(c,"ui_editor_properties_overbright")){obMats.add(n);ov++
        const k=String(c.ui_editor_properties_overbright);stat.overVals[k]=(stat.overVals[k]||0)+1}}}
    stat.overMats+=ov; if(ov)stat.overMatPkgs.add(id)
    const matOfPreset=(name,depth,seen)=>{ if(depth>4||seen.has(name))return []; seen.add(name); const j=presets.get(name); if(!j)return []
      const out=[]; const m=norm(j.material); if(m)out.push(m)
      for(const ch of (j.children||[])){const cn=norm(ch&&ch.name); if(cn)out.push(...matOfPreset(cn,depth+1,seen))} return out }
    for(const o of objs){ const pn=norm(o.particle); if(!pn)continue; const ms=matOfPreset(pn,0,new Set())
      if(ms.some(m=>obMats.has(m)||obMats.has("materials/"+m.replace(/^materials\//,"")))){stat.overLayers++;stat.overLayerPkgs.add(id)}
      stat.overJoin++ }
    for(const e of ents) if(/\.mdl$/i.test(e.name)){stat.mdl.ents++;stat.mdl.pkgs.add(id);stat.mdl.bytes+=e.size}
    fs.closeSync(fd)
  }catch(e){stat.otherPkgs.push(id+":"+String(e.message).slice(0,40)); try{fs.closeSync(fd)}catch{}}
}
console.log("scenePkgs:",stat.scenePkgs,"PKGM:",stat.videoPkgs,"other:",stat.otherPkgs)
console.log("[1] overbright mats=",stat.overMats,"matPkgs=",stat.overMatPkgs.size,"values=",JSON.stringify(stat.overVals))
console.log("[1] layers=",stat.overLayers,"layerPkgs=",stat.overLayerPkgs.size,"particleObjsJoined=",stat.overJoin)
console.log("[4] .mdl=",stat.mdl.ents,"pkgs=",stat.mdl.pkgs.size)
for(const t of T0) console.log("TOK",JSON.stringify(t),"occ=",tok[t].occ,"entries=",tok[t].entries,"pkgs=",tok[t].pkgs.size)
```

### A.2 MDLS 布局校验（§4.3 的数字来源）

```bash
cd we-scene-demo && node --input-type=module <<'EOF'
import { parseMdl } from "/abs/path/we-scene-demo/core/attach-transform.mjs"
// 对每个 .mdl entry：① 复刻 core/attach-transform.mjs:159-183 的布局 A 定步循环并校验
//   （parent ∈ [-1,boneCount)、两行单位长 ±0.05、平移有限、骨名 NUL 终止）
//   ② 用真实 parseMdl() 交叉核对 bones.length
// 输出：mdl rows: 43 / 布局A 全合法: 35 / 有异常: 0 / 非法骨: 0 / 首记录疑似名字前置: 0
EOF
```

---

## 附 B：许可与登记（六项各自"能不能抄 / 抄了登记到哪里"）

**登记的三个落点**（本轮**都没有改**，落地时同批写）：

1. `docs/COPYING-RULES.md` **§4 借鉴台账**（六列：`# / 来源仓库 / 文件(上游路径) / commit / SPDX / 引入日期 / 谁引入 / 进哪个仓库 / 处置`）—— 现有最后一行是 **#13（P-144 粒子 children）**，本文六项建议 **#14 起**。
2. `THIRD-PARTY.md` —— 现有最后一段是 **§15（P-144）**，本文六项建议 **§16 起**（MIT 全文已在 **§6.2** 随仓，可指向，不必重复粘贴）。
3. `docs/PATCHES.md` —— 每条一个 **P 编号**（本文建议 P-149 – P-154），含"官方语义出处 / 我们的实现 / 判据 / 未证实项"四段。

> `THIRD-PARTY.md` §14/§15（P-136/P-144）与台账 #12/#13 是**别的线**的既有条目，**不要动**，只在末尾追加。
> 上游源码检出 `references/vendor-ref/webwallgl/` **在仓库外、不入发布物**（`THIRD-PARTY.md:611-612`）；引用纪律：上游代码**单处最多引 3–5 行**并标 `file:line`，**不抄注释/文案**。

| 项 | P | 上游许可 | 本轮判定 | 落点（我们的文件） | 登记要求 |
|---|---|---|---|---|---|
| `overbright` | **P-149** | MIT（`19c5fab`） | **契约级（4 行）⇒ 按规格重写，不照抄** | `core/we-scene-bundle.js`（粒子色段）、`demo.html`（粒子材质段） | 台账 #14 + `THIRD-PARTY.md` §16（**"按规格独立实现"**口径，与 #9/#10 同形）+ PATCHES P-149；引 3 行公式即可 |
| 封面槽 / 三级优先级 / mip | **P-150a/b** | MIT（`8ea8214`） | **契约 + parse 语义 ⇒ 按规格重写**（我们的 pass 归一化结构与上游不同） | `core/we-scene-bundle.js`（`resolveEffectChain` / `resolveTextureName`）、`demo.html`（媒体段 + 更正 `:6742` 注释） | 台账 #15 + §17 + P-150；**若最终照抄了 `parse.js:480-499` 的任何片段，必须升级为"照抄"并附逐行对照表** |
| copybackground z 序 | **P-151** | MIT（`6ea9d14`） | **只可参考行为 ⇒ 自研**（我们无 `groupTarget`/`compositeFBOs`） | `core/we-scene-bundle.js`（`resolveTextureName` + 主循环） | 台账 #16 + §18 + P-151；若照抄 `captureEmptyComposeAtZOrder` 任何片段 ⇒ 升级为"照抄"+ 对照表（照 §14/§15 格式） |
| MDLS 变长骨名 | **P-152** | MIT（`be3c246`） | **判据契约可移植，解析器自研** | `core/attach-transform.mjs`（+ 可选 `elysia/we-renderer/puppet.js` 复用唯一实现） | 台账 #17 + §19 + P-152；"先校验后重扫、绝不返回残缺骨架"作为**判据**引用 |
| `localStorage` 共享持久 | **P-153** | MIT（`9beb420`） | **可直接照抄（约 70 行）**，但**建议按规格重写**以匹配我们的沙箱（`shared` 已有先例） | `elysia/scene-scripts.js`（env + `createScriptCache`）、`demo.html`（provider 注入） | 台账 #18 + §20 + P-153；**若照抄 `storage.js:34-102`：SPDX MIT、保留声明、附逐行对照表** |
| REPEAT 采样器 | **P-154** | MIT（`4b7b07e`） | **一行级契约 ⇒ 自研**（无可抄之物） | `core/we-scene-bundle.js`（`makeTexture`/`makeTextureMip` 第 7 参）、`demo.html`（util 清单） | 台账 #19 + §21 + P-154（允许把 P-149/P-154 并入同一条 `THIRD-PARTY.md` 条目，但 **PATCHES 各记一条 P**） |

**共享口径（六项通用）**：`references/wer-ref`（GPL-2.0-only）与 `references/we-layerd-ref`（无许可）在本文里**只出现在"行为对照"位置**，没有任何代码/注释/常量组织被引用；上述六项的上游全部是 **MIT** 的 `oneincase/webwallgl`。
