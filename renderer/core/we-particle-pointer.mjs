// core/we-particle-pointer.mjs —— 粒子侧的「鼠标尾迹」指针通路（照抄上游，非独立实现）
//
// ①(P-136 用户第 4 项：照抄上游 MIT 实现) 来源 oneincase/webwallgl
//   · renderer/vendor/we-scene/render/particles.js:663-672（图层变换字段 originX/Y/Z、scaleX/Y、angleZ）
//   · renderer/vendor/we-scene/render/particles.js:686-697（`setPointer`）
//   · renderer/vendor/we-scene/render/particles.js:830-851（`mapsequencearoundcontrolpoint` 投放块）
//   · renderer/vendor/we-scene/render/particles.js:1010-1024（`vortex` 块）
//   · renderer/vendor/we-scene/render/particles.js:1154-1163（`_cpPos`）
//   · renderer/src/scene-mount.ts:1670-1676（每帧把活指针推进粒子系统）
//   （MIT © 2026 oneincase），源码 checkout 见 THIRD-PARTY.md §14，许可全文随仓库在
//   `demo/LICENSE-webwallgl-MIT.txt`。
//
// 用户第 4 项的原话是「你直接把 oneincase 跟鼠标尾迹有关的代码，你看看直接复制过来就算了」——
// 也就是**要照抄，不要按行为契约重写**。本仓库此前对 upstream 的纪律是"只引行为结论、
// 不复制代码"（THIRD-PARTY.md §8/§10）；本节按用户直接指令改成**允许复制**并登记（THIRD-PARTY.md §14）。
//
// ─────────────────────────────────────────────────────────────────────────────
// 逐块「照抄 / 适配」对照表（改了什么必须写在这里，不许悄悄改）
//
//  块 | 上游行号 | 处置
//  ---|---------|-----
//  A  | particles.js:663-672 | **逐字**，只有 `this.` → `sys.`；**唯一例外**是 angleZ 那一行见 A-1
//  B  | particles.js:686-697 | **逐字**，只有 `this.` → `sys.`；落点字段名 `this.pointer` → `sys.pointerLocal`（见 B-1）
//  C  | particles.js:830-851 | 位置部分（830-845）**逐字**（仅把 `p.x = …` 赋值形改成返回值）；
//     |                  | 初速部分（846-850）**未照抄**：上游用 `Math.random()`，本仓库必须用系统自己的
//     |                  | 确定性 RNG（见 C-1）
//  D  | particles.js:1010-1024 | **逐字**（仅把 `p.vx += …` 改成返回值），音频门控保留在本仓库算子层
//  E  | particles.js:1154-1163 | **逐字**，只有 `this.` → `sys.`、`this.controlPoints` → `sys.localControlPoints`
//  F  | scene-mount.ts:1670-1676 | **逐字语义**：每帧把**活指针**写进粒子系统，指针**不进**重建签名；
//     |                  | 另加"最后已知指针"影子（见 F-1）——上游在这一块的**下游**没有兜住"无指针"
//  G  | particles.js:698-707 | `attachFollow(parent, mode, offset)` **逐字**，只有 `this.` → `sys.`、
//     |                  | `this._syncFollow()` → `syncFollow(sys)`（见 G-1）
//  H  | particles.js:709-713 | `leaderParticle()` **逐字**（`pool` 的取法见 H-1）
//  I  | particles.js:724-743 | `_syncFollow()` **逐字**，只有 `this.` → `sys.`、方法调用改成自由函数（见 I-1/I-2）
//
//  G-1/H-1/I-1（P-144 子系追加 · 必须说明）：这三块是 P-144 为 `children` 的
//      `eventfollow` / `static` 两个 type 照抄的。上游的"池"是**环形缓冲的定长 pool**
//      （`this.pool`，槽位里有 `alive` 标志），本仓库是**紧凑数组** `sys.particles`
//      （死亡即 `splice`，数组里全是活粒子）⇒ `leaderParticle` 的循环体逐字可用，
//      只有"池从哪来"这一处改成 `sys.particles`。随之：上游 `leaderParticle()` 返回的
//      是**环形缓冲里第一个活槽**，本仓库返回的是**最早出生的活粒子**（发射序）；
//      上游的 `originX/originY` 就是它的模拟原点，本仓库的模拟原点是数组 `sys.origin`
//      ⇒ `syncFollowOrigin(sys)` 是**本仓库独有的适配层**（不是照抄），把照抄来的
//      `originX/Y/Z` 镜像进 `sys.origin` 并重跑 `syncLayerTransform`。
//  I-2（父粒子坐标口径 · 必须说明）：上游 `host.x/host.y` 是**父系局部**坐标（渲染期才乘父系
//      变换），本仓库 `p.pos` 出生时就是**绝对世界坐标** ⇒ `mode === 'particle'` 那一行不能
//      照抄字面，改成 `host_world + (localToWorld(parent, off) − parent.origin)`；
//      与上游 `localToWorld(parent, host_local + off)` 在代数上同一个式子（见 `syncFollow` 的注释）。
//
//  A-1（角度单位 · 必须说明）：上游那一行是 `this.angleZ = ((la[2] || 0) * Math.PI) / 180`
//      ——它拿到的 `layer.angles` 是**度**。本仓库 `scene.json` 的 `angles` 是**弧度**
//      （①(P-21-ATTACH) 语料实测 π/π/2；bundle 直收、不再 ×π/180），故这里去掉 `× π/180`，
//      并把符号取成与 `spawnParticle` 的 `cos(-angle)` 同一手性。**这一行不是逐字**，其余各行逐字。
//  B-1（字段名 · 必须说明）：上游把局部指针写进 `this.pointer`，而本仓库 `sys.pointer` 已被
//      `tests/pointer-leave-test.mjs`（64 断言）钉成「**世界设计坐标**（y 向下）」——
//      改成上游的局部空间会让 A1b/A2b/A3b/A3c/P4b 五条断言变红。按任务纪律「上游行为与既有断言
//      冲突 ⇒ 先报告、不要擅自改断言」，这里**不动 `sys.pointer`**，把上游的局部指针落到
//      **新字段 `sys.pointerLocal`**，两条语义并存（冲突报告见 P-136 台账「未证实项」）。
//  C-1（随机源 · 必须说明）：上游 847 行是 `const k = Math.random()`（**非确定性**，与它的
//      `rng` 流不是同一个）。本仓库每次渲染必须可复现（门禁会逐位比两次运行），故初速仍吃
//      系统自己的 `rng()`；位置投放（830-845）**不含随机数**，逐字照抄不受影响。
//  F-1（**离开窗口** · 必须说明 · 本模块新增的唯一块）：块 F 只做了上游那半句——「有指针就
//      `setPointer`」；上游**没有**规定"这一帧没有指针"时下游该怎么办，于是它自己下游的两处
//      退化路径都是**把圆心换掉**：
//        · `particles.js:1011` 涡流 `const base = this._cpPos(v.cp) || [0, 0, 0]` —— `_cpPos` 无指针
//          返回 null ⇒ 圆心变成**系统原点**（本仓库 `sys.origin` = 图层原点；全屏尾迹层就是**画面中心**）；
//        · 吸附算子里 `cp.offset`（层空间）被当世界坐标用 ⇒ 退化成画面左上角。
//      上游自己的宿主（`pointer.js` 的 `pushExternalLeave`）**保留最后位置**，所以它从不触发这两条；
//      本仓库 P-118/P-121 的语义是「离开 ⇒ 无指针」（`sys.pointer = null`，64 断言钉住）⇒ 必须自己
//      兜住"无指针"：块 F 在这里**追加**一个"最后已知指针"影子（`sys.pointerShadow` +
//      `sys.pointerLocalShadow` + `sys.pointerLeaveFrames`），并给出 `shadowCpWorld()` /
//      `finishTrailInPlace()` 两个适配入口。照抄块 A/B/C/D/E/G/H/I 一行未动（`cpPos` 仍按上游
//      在无指针时返回 null）。行为与判据见 `tests/trail-leave-test.mjs`。
// ─────────────────────────────────────────────────────────────────────────────
//
// 为什么这一份照抄能修好「看不见尾迹」：上游的指针是**每帧推进的活输入**
// （`scene-mount.ts:1670-1676` 在 `advance()` 之前调 `ps.setPointer(wx, py)`），粒子系统
// **只在时间轴上增量前进**，于是"光标走过的路径"被留在已存活粒子的坐标里 —— 那就是尾迹。
// 本仓库此前把指针坐标放进了粒子系统的**重建签名**（`core/we-scene-bundle.js` 的 `__sig`），
// 指针一动就整系统从 t=0 重放、且重放全程只用**当前**这一个坐标 ⇒ 历史被抹平、花瓣永远
// 糊在光标上（数字见 P-136 台账：尾迹跨度 67px → 1175px）。照抄本模块 = 把指针变成活输入。

/**
 * 块 A：图层变换字段。
 *
 * ①(P-136 用户第 4 项：照抄上游 MIT 实现) 来源 oneincase/webwallgl
 * renderer/vendor/we-scene/render/particles.js:663-672（MIT © 2026 oneincase），
 * 除 angleZ 的单位（见文件头 A-1）外未做语义改写。
 *
 * 上游 `syncLayerTransform()` 的 663-672 行；上游 673-684 行是精灵 quad 的非等比拉伸
 * （`sysScale` / `spriteStretchX/Y`），**与鼠标尾迹无关，未复制**（任务纪律：不复制无关大段）。
 *
 * @param {object} sys  本仓库的粒子系统对象
 * @param {{origin?:number[],scale?:number[],angles?:number[]}} layer
 */
export function syncLayerTransform(sys, layer) {
  const lo = layer && layer.origin ? layer.origin : [0, 0, 0]
  const ls = layer && layer.scale ? layer.scale : [1, 1, 1]
  const la = layer && layer.angles ? layer.angles : [0, 0, 0]
  sys.originX = lo[0] || 0
  sys.originY = lo[1] || 0
  sys.originZ = lo[2] || 0
  sys.scaleX = ls[0] === 0 ? 1 : ls[0]
  sys.scaleY = ls[1] === 0 ? 1 : ls[1]
  // ①(P-136 适配 A-1) 上游：`this.angleZ = ((la[2] || 0) * Math.PI) / 180`
  //   本仓库 angles 是弧度、手性与 spawnParticle 的 cos(-angle) 一致 ⇒ 去掉 ×π/180 并取负。
  sys.angleZ = -(la[2] || 0)
}

/**
 * 块 B：宿主每帧提供鼠标位置（世界像素）；转到局部空间供控制点使用。
 *
 * ①(P-136 用户第 4 项：照抄上游 MIT 实现) 来源 oneincase/webwallgl
 * renderer/vendor/we-scene/render/particles.js:686-697（MIT © 2026 oneincase），未做语义改写
 * （仅 `this.` → `sys.`，落点字段 `this.pointer` → `sys.pointerLocal`，理由见文件头 B-1）。
 *
 * 上游 `renderer/src/scene-mount.ts:1674` 每帧在 `advance()` **之前**调用它；本仓库同序。
 *
 * @param {number} worldX 世界像素（y 向下，本仓库口径）
 * @param {number} worldY 世界像素（y 向下）
 */
export function setPointer(sys, worldX, worldY) {
  const dx = worldX - sys.originX
  const dy = worldY - sys.originY
  const c = Math.cos(-sys.angleZ)
  const s = Math.sin(-sys.angleZ)
  sys.pointerLocal = {
    x: (dx * c - dy * s) / (sys.scaleX || 1),
    y: (dx * s + dy * c) / (sys.scaleY || 1),
  }
}

/**
 * 块 E：控制点当前位置（局部空间）。
 *
 * ①(P-136 用户第 4 项：照抄上游 MIT 实现) 来源 oneincase/webwallgl
 * renderer/vendor/we-scene/render/particles.js:1154-1163（MIT © 2026 oneincase），未做语义改写
 * （仅 `this.` → `sys.`、`this.controlPoints` → `sys.localControlPoints`）。
 *
 * `sys.localControlPoints[i].offset` 是**本地 y 向下**的偏移 —— 上游的局部空间是 y 向上，
 * 所以上游存 authored offset 原值；本仓库在 buildParticleSystem 里把 authored（y 向上）
 * 的 `offset[1]` 取了负存进来（数据口径，不改这里的算式）。
 *
 * @returns {[number,number,number]|null} 局部空间控制点位置；无该控制点/无指针 ⇒ null
 */
export function cpPos(sys, id) {
  const cp = sys.localControlPoints.find((c) => c.id === id)
  if (!cp) return null
  if (cp.lockToPointer) {
    if (!sys.pointerLocal) return null
    return [sys.pointerLocal.x + cp.offset[0], sys.pointerLocal.y + cp.offset[1], cp.offset[2]]
  }
  return cp.offset
}

/**
 * 局部 → 世界（本仓库口径：世界即渲染设计像素、y 向下）。
 *
 * 逐字取自上游 `render()` 里的 `toWorld`（`particles.js:1300-1305`）的**前两行**：
 *   `const px = lx * sx; const py = ly * sy; return [ox + px*cos - py*sin, …]`
 * 唯一差别：上游第三个分量要做 `projH - (…)`（它的局部是 y 向上，要翻到投影空间），
 * 本仓库的世界本身就是 y 向下 ⇒ 不做那次翻转。
 *
 * @param {number[]} lo 局部空间坐标（y 向下，本仓库口径）
 * @returns {[number,number,number]}
 */
export function localToWorld(sys, lo) {
  const px = lo[0] * sys.scaleX
  const py = lo[1] * sys.scaleY
  const cos = Math.cos(sys.angleZ)
  const sin = Math.sin(sys.angleZ)
  return [sys.originX + px * cos - py * sin, sys.originY + px * sin + py * cos, sys.originZ + lo[2]]
}

/**
 * `cpPos`（上游 `_cpPos`）+ `localToWorld`（上游 `toWorld`）的复合 —— 控制点的**世界**位置。
 *
 * @returns {[number,number,number]|null}
 */
export function cpWorld(sys, id) {
  const lo = cpPos(sys, id)
  if (!lo) return null
  return localToWorld(sys, lo)
}

/**
 * 块 C（位置部分）：`mapsequencearoundcontrolpoint` 绕控制点按 count 等分圆轮流投放。
 *
 * ①(P-136 用户第 4 项：照抄上游 MIT 实现) 来源 oneincase/webwallgl
 * renderer/vendor/we-scene/render/particles.js:830-845（MIT © 2026 oneincase），
 * 除把 `p.x = …` 三个赋值改成返回值外未做语义改写。
 *
 * 上游 846-850 的初速用 `Math.random()`，本仓库**未照抄**（见文件头 C-1）：
 * 调用方仍吃确定性的 `rng()`，算式（三轴共用同一个随机数）与上游同构。
 *
 * 坐标：本函数在**局部空间**算（与上游同），调用方用 `toWorldLocal` 落到世界。
 *
 * @param {[number,number,number]} around 控制点当前位置（局部空间，来自 `cpPos`）
 * @param {number} seqIndex 轮转序号（调用方每次投放 +1）
 * @param {number} count   `count`（等分份数）
 * @param {number[]} bounds `bounds`（[start, end] 圆周参数）
 * @param {number} rmin    `em.distanceMin[0]`
 * @param {number} rmax    `em.distanceMax[0]`
 */
export function mapSequenceAroundControlPoint(around, seqIndex, count, bounds, rmin, rmax) {
  const n = count
  const i = seqIndex
  const u = n > 0 ? (i % n) / n : 0
  const t = bounds[0] + (bounds[1] - bounds[0]) * u
  const ang = t * Math.PI * 2
  const rad = rmax > 0 ? rmax : rmin
  return [around[0] + Math.cos(ang) * rad, around[1] + Math.sin(ang) * rad, around[2]]
}

/**
 * 块 D：`vortex` 的切向加速（绕控制点）。
 *
 * ①(P-136 用户第 4 项：照抄上游 MIT 实现) 来源 oneincase/webwallgl
 * renderer/vendor/we-scene/render/particles.js:1010-1024（MIT © 2026 oneincase），
 * 除把 `p.vx += …` 两个赋值改成返回值外未做语义改写。
 *
 * 上游 1019-1020 的音频门控 `vK`（`v.audioMode ? audioGate(...) : 1`）由本仓库算子层
 * 的 `audioK` 提供（等价：无音频视图时 audioK = 1），故本函数不含音频参数。
 *
 * ①(vortex-chirality 2026-09-23) **切向方向本批翻转，并加了 `tangentSign` 档位**。
 *   取 `radial = (dx, dy) = p − center`、`axis = (0,0,1)`：
 *     · `tangentSign = +1`（**新默认**）= `(dy, −dx)` = `radial × axis` = `−axis × radial`；
 *     · `tangentSign = −1`（`?pvortex=legacy`）= `(−dy, +dx)` = `axis × radial`（= 改动前的实现，
 *       也正是上游 `particles.js:1010-1024` 在 `78718843` **之前**的符号）。
 *   依据（**必须如实声明，不要写成"对齐官方"**）：本机**没有**任何 WE 官方反编译产物、
 *   官方资产里也**没有**方向定义（`magic_vortex` 预设与官方元素预览场景都只锁字段集）。
 *   `+1` 的依据是**第三方参考实现的多实现共识** —— `references/wer-ref`（`relative.cross(axis)`）
 *   与 `open-wallpaper-engine`（`-axis.cross(radial)`）**同源**（共享 `contropoint` 误拼，只能算
 *   一条口径）+ **上游 oneincase/webwallgl 带理由的单向翻转**（commit `78718843`，v1.4.1，
 *   自述为对齐官方观测）；`references/lwe-ref`（`cross(axis, radial)`）用老符号，但它在
 *   `vortex_v2` 语义上可验证地偏离官方数据（`flags&2` 被当成环形，而官方 `magic_vortex_orb.json`
 *   是 `flags:2` **且**带 ring 字段）⇒ 权重最低。
 *   ⇒ 这是"证据更强的一方"，**不是**"已证实的一方"；官方级结论需要真机录 WE 出帧对拍。
 *   完整取证：`docs/VORTEX-CHIRALITY-RE-20260923.md`；档位常量见 `core/we-scene-bundle.js`
 *   的 `VORTEX_MODE`（唯一调用点在同一文件的 vortex 分支）。
 *
 * @param {number} px 粒子 x（与 base 同一空间）
 * @param {number} py 粒子 y
 * @param {number[]} base 控制点当前位置（与粒子同一空间）
 * @param {{offset:number[],distanceInner:number,distanceOuter:number,speedInner:number,speedOuter:number}} v
 * @param {number} dt
 * @param {number} [tangentSign=1] 切向手性：`+1` = `(dy,−dx)`（默认）、`−1` = `(−dy,+dx)`（legacy）
 * @returns {[number,number]|null} `[dvx, dvy]`；距离 < 1e-3（上游 `continue`）⇒ null
 */
export function vortexSwirl(px, py, base, v, dt, tangentSign = 1) {
  const dx = px - (base[0] + v.offset[0])
  const dy = py - (base[1] + v.offset[1])
  const dist = Math.hypot(dx, dy)
  if (dist < 1e-3) return null
  const span = v.distanceOuter - v.distanceInner
  const k = span > 0 ? Math.min(1, Math.max(0, (dist - v.distanceInner) / span)) : 0
  const speed = v.speedInner + (v.speedOuter - v.speedInner) * k
  // ①(vortex-chirality) 手性由 `tangentSign` 决定，默认 = `(dy, −dx)`
  const s = tangentSign >= 0 ? 1 : -1
  return [(s * dy / dist) * speed * dt, (-s * dx / dist) * speed * dt]
}

/**
 * 块 F：上游 `renderer/src/scene-mount.ts:1670-1676` 的每帧推进语义 ——
 *
 *   世界指针位置：locktopointer 的控制点用它做吸引/排斥（controlpointattract）。
 *   if (pointerSrc.state.has) { const { wx, wy, originY } = pointerSrc.state;
 *     const py = originY != null ? originY : wy;
 *     for (const ps of particleSystems) ps.setPointer(wx, py); }
 *
 * 关键**不在于**这几行的字面，而在于它是**每帧**调用、并且指针**从不参与**粒子系统的
 * 构造/缓存签名 —— 系统只在时间轴上增量前进，指针路径因此留在粒子坐标里（= 尾迹）。
 *
 * 本仓库把这条语义放在这里，由 `core/we-scene-bundle.js` 的 `renderParticleLayer`
 * 在 `simulateParticleSystem()` **之前**调用一次。
 *
 * ①(尾迹离开 2026-09-19 · 见文件头 F-1) 本函数额外记下**最后已知指针**（影子）：上游宿主
 *   在"指针离开"时保留最后位置，本仓库的语义是"离开 ⇒ 无指针"，两者差这一层记忆 ——
 *   没有它，下游（涡流/吸附）会退化到 `sys.origin`（图层原点 = 全屏尾迹层的**画面中心**）。
 *   `sys.pointer` 的对外语义**不变**（null = 本帧无活指针 ⇒ 锁指针发射器不发射）。
 *
 * @param {object} sys 粒子系统
 * @param {[number,number]|null} pointerWorld 设计坐标（y 向下）；null = 本帧无指针
 * @returns {boolean} 是否推进了指针（false = 本帧无指针 ⇒ lockToPointer 发射器不发射）
 */
export function pushPointerFrame(sys, pointerWorld) {
  if (pointerWorld) {
    setPointer(sys, pointerWorld[0], pointerWorld[1])
    // 影子（世界坐标）= 本帧活指针；`pointerLocalShadow` 是**照抄来的** `setPointer` 的产物，
    // 供 `shadowCpWorld` 在无指针帧上重建"锁指针控制点在最后离开点"的局部坐标。
    sys.pointerShadow = [pointerWorld[0], pointerWorld[1]]
    sys.pointerLocalShadow = sys.pointerLocal ? { x: sys.pointerLocal.x, y: sys.pointerLocal.y } : null
    sys.pointerLeaveFrames = 0
    return true
  }
  if (sys.pointerShadow) sys.pointerLeaveFrames = (sys.pointerLeaveFrames || 0) + 1
  return false
}

/**
 * ①(尾迹离开 2026-09-19 · 不是照抄，是本仓库适配层)：离开后**就地收尾**的帧数窗口（**策略值**）。
 *
 * 为什么是 1：既有门禁 `tests/pointer-leave-test.mjs` 的 P3b 是"离开后**连续 3 帧**存活粒子为 0"
 * （第 1 帧就算），另有 D1b/G5/G1/G1b/G2b/G2c/G3a/G3e 同口径 —— 那条断言属于**另一条线**，
 * 本批纪律是"不改别人的断言"，所以渲染器侧取 1 帧：离开帧当场结束（用户口径"挪出去就直接消失"）。
 * `finishTrailInPlace(sys, k)` 本身是**有界衰减**（k 帧内每帧严格更少、alpha 逐帧渐隐、第 k 帧归零），
 * k>1 的性质由 `tests/trail-leave-test.mjs` 在单元层逐条钉住 ⇒ 将来若把 P3b 放宽到"第 2 帧起为 0"，
 * 把这里改成 2~4 就是**一行**的事（判据已经就位，不需要重写逻辑）。
 */
export const TRAIL_FINISH_FRAMES = 1

/**
 * ①(尾迹离开 2026-09-19 · 适配层)：最后已知指针（世界设计坐标）；从未有过指针 ⇒ null。
 * @returns {[number,number]|null}
 */
export function pointerShadowWorld(sys) {
  return sys && sys.pointerShadow ? [sys.pointerShadow[0], sys.pointerShadow[1]] : null
}

/**
 * ①(尾迹离开 2026-09-19 · 适配层)：**不落到 null 的** `cpPos` —— 锁指针控制点在"无指针"帧上的
 * 当前位置 = 最后已知指针 + authored offset（局部空间）。与照抄块 E 的 `cpPos` 的差别只有一处：
 * 拿不到指针时用影子而不是返回 null（上游 `if (!this.pointer) return null` 一字未动，仍在 `cpPos` 里）。
 *
 * @returns {[number,number,number]|null} null = 从未有过指针（此时保持旧行为：下游退化为层原点）
 */
export function shadowCpPos(sys, id) {
  const cp = (sys.localControlPoints || []).find((c) => c.id === id)
  if (!cp) return null
  const P = sys.pointerLocal || sys.pointerLocalShadow
  if (!P) return null
  if (cp.lockToPointer) return [P.x + cp.offset[0], P.y + cp.offset[1], cp.offset[2]]
  return cp.offset
}

/** ①(尾迹离开 2026-09-19 · 适配层)：`shadowCpPos` 的世界坐标版本（`localToWorld` 与照抄块同式）。 */
export function shadowCpWorld(sys, id) {
  const lo = shadowCpPos(sys, id)
  if (!lo) return null
  return localToWorld(sys, lo)
}

/**
 * ①(尾迹离开 2026-09-19 · 适配层)：一帧"就地收尾" —— 把**尾迹的尾巴**（最先出生的粒子）按剩余
 * 窗口比例丢弃，并把留下的粒子按同一比例压 alpha（可见的渐隐，而不是凭空消失）。
 *
 * 为什么不直接 `particles.length = 0`（P-136 的旧写法）：那会让"收尾"没有可观测口径 ——
 * 粒子数、质心、alpha 全都在同一帧归零，出问题时（比如力中心被换到画面中心）无从度量。
 * 就地收尾保证：
 *   · 粒子数**每帧严格下降**，`k` 帧内归零（k = `sys.trailFinishFrames`，缺省 `TRAIL_FINISH_FRAMES`）；
 *   · 留下的粒子位置**一帧都不改**（本函数只动 alpha 与数组头部，不碰 `p.pos`）；
 *   · 丢的是**最老的**（`sys.particles` 是发射序紧凑数组）⇒ 最后剩下的正好是"离开点那一簇"。
 *
 * 成本：只在"锁指针层 + 本帧无指针 + 还有粒子"时进入，最多 k 帧，每帧 O(存活粒子)；
 * 稳态（指针在画面内）**一次都不进**。
 *
 * @param {object} sys 粒子系统
 * @param {number} [k] 收尾窗口帧数（缺省取策略值）；k=1 ⇒ 本帧归零（现网策略，见常量注释）
 * @returns {number} 收尾后剩余粒子数
 */
export function finishTrailInPlace(sys, k) {
  const P = sys.particles || []
  const n = P.length
  if (!n) return 0
  const win = Math.max(1, Math.floor(k || sys.trailFinishFrames || TRAIL_FINISH_FRAMES))
  const frames = (sys.pointerLeaveFrames || 0)
  const left = Math.max(1, win - (frames - 1))   // 含本帧在内还剩几帧收尾
  const drop = Math.max(1, Math.ceil(n / left))
  P.splice(0, Math.min(drop, n))
  const f = Math.max(0, 1 - 1 / left)
  for (const p of P) {
    p.alpha *= f
    // alpha 类算子（alphafade/alphachange/oscillatealpha）每帧会**从基准值重算** alpha，
    // 只乘 `p.alpha` 会被它们覆盖 ⇒ 基准一起压（没有这些字段的层 = 空操作）。
    if (typeof p._initAlpha === 'number') p._initAlpha *= f
    if (p.oscAlpha && typeof p.oscAlpha.base === 'number') p.oscAlpha.base *= f
  }
  sys.count = P.length
  return P.length
}

/**
 * 块 G：子级挂到父系统 —— `eventfollow` 跟父粒子走，`static` 跟父系统 origin 走。
 *
 * ①(P-144 子系：照抄上游 MIT 实现) 来源 oneincase/webwallgl
 * renderer/vendor/we-scene/render/particles.js:698-707（MIT © 2026 oneincase），
 * 除 `this.` → `sys.`、`this._syncFollow()` → `syncFollow(sys)` 外未做语义改写。
 * 上游调用方：`renderer/src/scene-mount.ts:1551`（建完子系就立刻挂）。
 *
 * @param {object} sys 子系粒子系统
 * @param {object|null} parent 父系粒子系统
 * @param {'particle'|'origin'|null} mode
 * @param {number[]} offset 子系 authored origin（父系局部坐标）
 */
export function attachFollow(sys, parent, mode, offset) {
  sys._followParent = parent || null
  sys._followMode = mode === 'particle' || mode === 'origin' ? mode : null
  const o = offset || [0, 0, 0]
  sys._followOffset = [o[0] || 0, o[1] || 0, o[2] || 0]
  // 立即对一次：否则首帧（以及 eventfollow 在父粒子尚未生成时）会停在
  // 未加 offset 的父 origin，Matrix 33 列叠成一坨。
  syncFollow(sys)
}

/**
 * 块 H：取"领队"父粒子（上游 `leaderParticle`，particles.js:709-713 逐字）。
 *
 * ①(P-144 子系：照抄上游 MIT 实现) 来源 oneincase/webwallgl particles.js:709-713
 * （MIT © 2026 oneincase）。循环体逐字；"池"由上游的定长环形 `this.pool` 换成本仓库的
 * 紧凑数组 `sys.particles`（见文件头 H-1）。
 *
 * @returns {object|null} 最早出生的活粒子；无 ⇒ null
 */
export function leaderParticle(sys) {
  const pool = sys.particles || []
  for (let i = 0; i < pool.length; i++) if (pool[i].alive) return pool[i]
  return null
}

/**
 * 块 I：把子系原点的当前值对到父粒子 / 父系统 origin（上游 `_syncFollow`，
 * particles.js:724-743 逐字）。
 *
 * ①(P-144 子系：照抄上游 MIT 实现) 来源 oneincase/webwallgl particles.js:724-743
 * （MIT © 2026 oneincase），除 `this.` → `sys.`、`parent.leaderParticle()` →
 * `leaderParticle(parent)`、`parent.localToWorld(...)` → `localToWorld(parent, ...)`
 * 外未做语义改写。上游注释（"children.origin 是父系统局部坐标，必须走 localToWorld"）保留。
 *
 * ⚠ 本仓库的模拟原点是 `sys.origin`（数组），照抄来的这一块只写 `originX/originY`
 * ⇒ 调用方必须再跑一次 `syncFollowOrigin(sys)`（本仓库独有的适配层，见文件头 I-1）。
 * ⚠ 父粒子的坐标口径（**适配 I-2，必须说明**）：上游 `host.x/host.y` 是**父系局部**
 * 坐标（它渲染期再乘父系变换），本仓库 `p.pos` 出生时就是**绝对世界坐标**。两边
 * 逐字同构的写法是 `localToWorld(parent, host_local + off)`；把 `host_local` 换成
 * 世界坐标后等价于 `host_world + (localToWorld(parent, off) − parent.origin)`
 * ⇒ 除了这一处减法（去掉 origin 平移、只留 R·S 的偏移向量），算式与上游一致。
 */
export function syncFollow(sys) {
  const parent = sys._followParent
  const mode = sys._followMode
  if (!parent || !mode) return
  const off = sys._followOffset
  // children.origin 是父系统局部坐标，必须走 localToWorld（含图层 scale/旋转）。
  // 以前直接加到世界 origin 上：2974757317 层 scale=1.5、43 列 × 60px 只铺了
  // 2520px，掉落代码挤在画面左侧一条带里，铺不满 3840 宽。
  if (mode === 'particle') {
    const host = leaderParticle(parent)
    if (!host) return
    const w = localToWorld(parent, [off[0], off[1], off[2]])
    sys.originX = host.pos[0] + (w[0] - parent.originX)
    sys.originY = host.pos[1] + (w[1] - parent.originY)
  } else {
    const w = localToWorld(parent, [off[0], off[1], off[2]])
    sys.originX = w[0]
    sys.originY = w[1]
  }
}

/**
 * 本仓库适配层（**不是照抄**）：把照抄块 I 写好的 `originX/originY/originZ`
 * 镜像进本仓库真正用于模拟的 `sys.origin`，并重跑 `syncLayerTransform`（指针/控制点
 * 那一套也吃 originX/originY）。
 *
 * 为什么必须分开：本仓库每颗粒子的 `pos` 在出生那一刻就写成**绝对世界坐标**
 * （`spawnParticle`：`wx = sys.origin[0] + …`）⇒ 原点一移，"新粒子在新位置出生、
 * 老粒子留在原地漂" —— 这正是拖尾的成因；而上游是渲染期再加 origin（粒子存局部坐标）。
 * 两种口径在"原点不动"时逐位等价，在 eventfollow 下观感同构（见 P-144 台账）。
 *
 * @returns {boolean} 有没有真的对上（false = 无父系/无模式/`eventfollow` 父系没有活粒子）
 */
export function syncFollowOrigin(sys) {
  syncFollow(sys)
  if (!sys.origin || typeof sys.origin.length !== 'number') return false
  if (sys._followMode === 'particle' && leaderParticle(sys._followParent || {}) === null) return false
  sys.origin[0] = sys.originX
  sys.origin[1] = sys.originY
  sys.origin[2] = sys.originZ || 0
  syncLayerTransform(sys, { origin: sys.origin, scale: [sys.scaleX, sys.scaleY, 1], angles: [0, 0, -sys.angleZ] })
  return true
}
