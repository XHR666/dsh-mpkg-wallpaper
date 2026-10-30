#!/usr/bin/env node
// cuiliuti-builtin-fx-test.mjs — ①(2026-10-12) 上游 `oneincase/webwallgl`（**MIT**）**内置效果
//   「磁流体（cuiliuti）」**移植的判据（纯 Node / 无浏览器 / 无网络 / 无 GL / 秒级）。
//
// 为什么需要它：这是本仓**第一个"上游编辑器内置效果"**的移植 —— 素材（shader 源 + 参数面）不在
//   任何 `scene.pkg` 里、也不在 WE 安装目录，而是从上游 `editor/effects.ts` 逐字节照抄进
//   `core/we-scene-bundle.js` 的内置素材表。既有判据形态都盖不住它：
//     · 源码形态断言（正则找字符串）证明不了"参数真的进了画面"；
//     · 假 GL 证明的是**接线**（uniform 传没传），不证明**数值**；
//     · playwright 真 GL 是条件项（缺环境 SKIP）⇒ 不能当门禁的硬判据。
//   ⇒ 本档用 `tests/_glsl-cpu.mjs`（GLSL 子集 → JS 转译器）**离线数值**跑**仓库里真实那份 frag 源**，
//   再配"真源码切片 + 假 DOM"验面板、配"真 core + 合成 pkg"验三级效果链。
//
// ── 断言分组 ─────────────────────────────────────────────────────────────────────────
//   A 切片与静态锚点：`demo.html` 的 `MPW-FX-PANEL`（面板）/ `MPW-FX-MOUNT`（装载）两段真源码切片；
//     切片自足（无 import/export、不碰页面绑定）；装载块**只读 core 的清单**（没有第二张手抄表）；
//     `?cuiliuti=off` 三处一致（代码权威读点 + README 主表行 + `web/diag-flags.json` 条目）；
//     三个读点（effect.json / material / shader）都走同一个 `builtinEffectAsset()`。
//     ⚠ A4 含 `web/diag-flags.json` 那条（照 `gyro-parallax-test.mjs` A4 的惯例）⇒ 该生成物必须与代码
//       同步；不同步就先跑 `node tests/diag-flag-check.mjs` 重生成（门禁里它排在**本项之前**，会先跑）。
//   B 参数面 + 面板（**真切片 + 假 DOM**）：B0 **前置钉** = core 的 `CUILIUTI_PARAMS` 与上游**冻结表**
//     `UP_FACE`（10 条 key/type/default/min/max/step/label 逐字段；与 sha 锁同性质的独立取证哨兵
//     —— "面板 == core""uniform == core"这类**自洽**判据拦不住 core 自己少一条/改范围，只有它能拦）；
//     面板：清单/中英文案；**署名行含原作者与收录者**；许可行含 MIT + 上游地址；
//     滑杆**数量/名字/范围/步长/缺省**逐条 == `core` 的参数面（**单一来源**）；换一张**合成参数面**
//     ⇒ 面板跟着变（证明"不是两处手抄"）；拖滑杆/取色 ⇒ 回调拿到正确值；`refresh()` 只改读数不改结构。
//   C 数值行为（`_glsl-cpu.mjs` 跑真 frag 源）：① shader 源与上游**逐字节**一致（sha256 冻结回归锁，
//     另可选用 `MPW_WWGL_EDITOR=` 指上游产物做逐字节对拍）；② uniform 声明 ↔ 参数面同源（key/uniform/
//     default、声明注释里的 `"range"`、**声明段逐字节 == `builtinEffectUniformDecls(参数面)`**，
//     且每个 uniform 在函数体里真被读）；③ 默认档统计量落区间；④ `alpha` 只缩
//     alpha 通道；⑤ `liquid` 真的是**乘**在液体项上（通道隔离）；⑥ `blobs` 单调 + `int()` 截断；
//     ⑦ `speed` 的时标真进 shader（`speed=0` ⇒ 时间不变）；⑧ **10 个滑杆逐个在画面上有落点**（无死滑杆）。
//   D 接线（真 core + 合成 pkg / 合成 `/weassist` 读取器）：三级链顺序（**包内 → `/weassist` → 内置表**，
//     前两级命中时内置表**不抢**）；前两级 miss ⇒ 真的挂上；`?cuiliuti=off` ⇒ 逐位回到接线前；
//     实例形状 == scene.json 形状；`key → material → uniform` 整链闭合；**署名三处**。
//   E 变异自证（`MUTANT-RED-OK` **10 组**，全部**语义级**）：空实现 shader（`void main() {}`）/
//     参数写死（blobs、alpha）/ **逻辑取反**（`1.0 - smoothstep(...)` → `smoothstep(...)`）/
//     core 参数面本体**改一条 min/max** / core 参数面本体**删一条**（后两条只有 B0 抓得住）/
//     面板滑杆**手抄**成死表 / 面板范围写死 / 署名行丢掉收录者 / README 主表行删掉
//     ⇒ **期望红集 == 实际红集**，且红集**不过滤**（变异体跑满整组，实际红的每一个 id 都必须列出来，
//     不许"只统计我点名的那几条"）。每组都先验"廉价档基线下真源码 0 红"（E0）。
//     ⚠ 这里**没有**"改一个字符 ⇒ sha256 变"那种**逻辑必然**充数：sha 锁 C1 读的是**模块里那份源**
//     （`lib.CUILIUTI_SRC`），而变异体改的是判据喂给数值电池的 `env.frag` ⇒ C1 在变异档里**恒绿、也恒
//     不算数**（10 组红集里一个 C1 都没有）。真正被判的是**数值/参数面/面板**这些"改了却可能照样绿"的判据。
//
// ── 诚实边界（本档**不做**什么）─────────────────────────────────────────────────────────
//   · 数值那半是**同一份源码**在 float64 上的离线转译（`_glsl-cpu.mjs` 自己的头部声明了边界：
//     不是 GLSL 编译器、末位会与 float32 有差）⇒ 本档只用**比例关系 / 区间 / 单调性 / 逐位相等
//     （同实现内）**这类对末位不敏感的读数；唯一逐位敏感的 sha256 是**冻结回归锁**（只跟本份源码的
//     自身历史比），不当跨实现真值。
//   · 面板/装载块是 demo.html 里的**经典脚本** ⇒ 切片后用 `new Function('window', …)` 求值（与浏览器
//     里"当普通 script 跑"同一条路），**不是** ESM import（那两段没有 export）。
//   · 装载块的**渲染**落点（`resolveEffectChain` 真的把 pass 挂上）在 D 组用真 core + 合成包证明；
//     真 GL 的像素产物不在本档（它不需要 GL，也刻意不依赖 playwright）。
//
// 用法：
//   node tests/cuiliuti-builtin-fx-test.mjs
//   可选：MPW_WWGL_EDITOR=<上游 editor/effects.ts 或 2.2.0-beta1 的 app.asar 路径>
//         ⇒ C1u 组去上游产物里抽同一段 shader **逐字节**对拍；不给/读不到 ⇒ 打印 SKIP（不红）。
// 读数：**53 断言**（A 6 / B 12 / C 10 / D 14 / E 11 —— 另 C1u 是条件项，设了 `MPW_WWGL_EDITOR` 才计）、
//   **10 组** `MUTANT-RED-OK`、实测 ~20-25s（离线数值那半是主要开销：每像素 100 步 raymarch × blobs 个
//   元球，纯 JS 转译跑；10 个变异体各跑满一整组 ⇒ 时间是"红集可核对"的代价）。
// 退出码：0 全绿 / 1 有断言失败。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { ROOT } from './_root.mjs'
import { compileFrag } from './_glsl-cpu.mjs'
import * as lib from '../core/we-scene-bundle.js'

let passN = 0, failN = 0
const redOrder = []
const fails = []
const ok = (id, name, cond, detail) => {
  if (cond) { passN++; console.log('  ✓ ' + id + ' ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { failN++; redOrder.push(id); fails.push(id + ' ' + name); console.log('  ✗ ' + id + ' ' + name + (detail ? '  [' + detail + ']' : '')) }
}
const skip = (id, name, why) => console.log('  ○ ' + id + ' SKIP ' + name + '  [' + why + ']')
const V = JSON.stringify
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')
const bytesOf = (s) => Buffer.byteLength(s)

/* ═════════════════════════ 真源码切片（demo.html 两段）═════════════════════════════════════ */
const DEMO = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8')
const README = fs.readFileSync(path.join(ROOT, 'docs', 'README-DIAGNOSTICS.md'), 'utf8')
const CORE = fs.readFileSync(path.join(ROOT, 'core', 'we-scene-bundle.js'), 'utf8')
const THIRD = fs.readFileSync(path.join(ROOT, 'THIRD-PARTY.md'), 'utf8')
const FLAGS_JSON = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'web', 'diag-flags.json'), 'utf8')) } catch (e) { return null } })()

/** 按标记行切片：起点 = BEGIN 那一行的**行尾之后**，终点 = END 标记之前（标记行本身不进切片）。 */
function sliceBlock(text, beg, end) {
  const i = text.indexOf(beg)
  if (i < 0) return ''
  const b = text.indexOf('\n', i)
  const j = text.indexOf(end, b < 0 ? i : b)
  if (b < 0 || j < 0) return ''
  return text.slice(b + 1, j)
}
const PANEL = sliceBlock(DEMO, '// ═══ MPW-FX-PANEL-BEGIN', '// ═══ MPW-FX-PANEL-END')
const MOUNT = sliceBlock(DEMO, '// ═══ MPW-FX-MOUNT-BEGIN', '// ═══ MPW-FX-MOUNT-END')

/** 切片的**唯一**消费口径：面板块是经典脚本 ⇒ 用一个假 `window` 求值，取它挂上去的 API。 */
function panelApiOf(panelText) {
  const w = {}
  const f = new Function('window', panelText + '\n;return window.__mpwFxPanel')   // eslint-disable-line no-new-func
  return f(w)
}

/* ── 假 DOM（只用面板块真会碰的那些 API；class/tag 选择器、textContent、监听器）─────────────── */
function mkDoc() {
  const matches = (c, sel) => (sel.charAt(0) === '.'
    ? String(c.className || '').split(/\s+/).indexOf(sel.slice(1)) >= 0
    : String(c.tagName) === sel.toLowerCase())
  const qsa = (root, sel) => {
    const out = []
    const rec = (n) => { for (const c of n.children || []) { if (matches(c, sel)) out.push(c); rec(c) } }
    rec(root)
    return out
  }
  const el = (tag) => ({
    tagName: String(tag).toLowerCase(), nodeType: 1, children: [], attrs: {}, listeners: {}, parent: null,
    className: '', id: '', type: '', value: '', min: '', max: '', step: '', title: '', textContent: '', selected: false,
    appendChild(c) { this.children.push(c); if (c && typeof c === 'object') c.parent = this; return c },
    setAttribute(k, v) { this.attrs[k] = String(v) },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f) },
    dispatch(t, ev) { const L = (this.listeners[t] || []).slice(); for (const f of L) f(ev || { type: t }); return L.length },
    querySelector(sel) { const r = qsa(this, sel); return r.length ? r[0] : null },
    querySelectorAll(sel) { return qsa(this, sel) },
  })
  return {
    createElement: (t) => el(t),
    createTextNode: (s) => ({ nodeType: 3, textContent: String(s), children: [] }),
  }
}
const textOf = (e) => {
  if (!e) return ''
  let s = typeof e.textContent === 'string' ? e.textContent : ''
  for (const c of e.children || []) s += textOf(c)
  return s
}
const findAll = (root, pred) => {
  const out = []
  const rec = (n) => { for (const c of n.children || []) { if (pred(c)) out.push(c); rec(c) } }
  rec(root)
  return out
}
const byClass = (root, cls) => findAll(root, (e) => String(e.className || '').split(/\s+/).indexOf(cls) >= 0)
const byParam = (root, tag) => findAll(root, (e) => e.tagName === tag && e.attrs['data-param'] !== undefined)

/* ═════════════════════════ 环境（变异只换其中一项）═══════════════════════════════════════ */
const FILES = lib.builtinEffectFiles()
const FRAG_REL = 'shaders/effects/wwgl_cuiliuti.frag'
const VERT_REL = 'shaders/effects/wwgl_cuiliuti.vert'
const EFFECT_REL = 'effects/wwgl_cuiliuti/effect.json'
const MAT_REL = 'materials/effects/wwgl_cuiliuti.json'
const CATALOG = lib.builtinEffectCatalog()
const FX = CATALOG[0]
const PARAMS = lib.CUILIUTI_PARAMS
const UNAME = {}
for (const p of PARAMS) UNAME[p.key] = lib.builtinEffectUniformName(p.key)

/**
 * ★上游参数面**冻结表**（10 条，逐字段）—— 与下面 `UP_SHA` 同性质的**独立取证哨兵**，不是从 core 反推的。
 *   取证口径（2026-10-12，与 shader 那两路同源）：上游 `editor/effects.ts` 的 `CUILIUTI_PARAMS`
 *   （`id: "cuiliuti"` 的 key/type/default/min/max/step 六字段）+ 本仓面板用的 zh/en 文案
 *   （上游把文案放在 i18n 的 `fxp.<key>`，同一个 key、同一条文案）。
 *   为什么**必须**有它：B4（面板 == core）与 C2/C10（uniform == core）都是**自洽**判据 —— core 少一条、
 *   或把某条 max 改小，面板与 shader 会**一起**跟着变，那些判据照样全绿（E 组 M9/M10 就是这两条变异的
 *   "自洽档也全绿"证明）。只有这张独立冻结面抓得住"core 参数面自己漂了"。
 *   顺序 = 面板行序（上游数组序）。
 *   ⚠ 改这一面（哪怕只是文案）必须**同步改这张表** —— 与 sha 锁同一条纪律。
 */
const UP_FACE = [
  ['liquid', 'color', [0, 0, 0], null, null, null, '液体颜色', 'Liquid color'],
  ['alpha', 'float', 1, 0, 1, 0.01, '不透明度', 'Opacity'],
  ['blobs', 'float', 80, 20, 120, 1, '球体数量', 'Blob count'],
  ['speed', 'float', 1, 0.1, 3, 0.05, '速度', 'Speed'],
  ['scale', 'float', 1, 0.5, 2, 0.05, '液体大小', 'Fluid size'],
  ['motion', 'float', 1, 0, 3, 0.05, '运动范围', 'Motion range'],
  ['fusion', 'float', 1, 0.1, 2, 0.05, '融合度', 'Blending'],
  ['edge1', 'color', [0.2, 0.5, 0.9], null, null, null, '边缘光颜色 1', 'Edge glow color 1'],
  ['edge2', 'color', [0.871, 0.435, 0.086], null, null, null, '边缘光颜色 2', 'Edge glow color 2'],
  ['edgeglow', 'float', 1, 0, 2, 0.05, '边缘光强度', 'Edge glow intensity'],
]
/** 参数面一条 → 冻结表的同一投影（color 的 min/max/step 缺省 ⇒ null，不是"没比"）。 */
const faceProj = (p) => [p.key, p.type, p.default,
  p.min === undefined ? null : p.min, p.max === undefined ? null : p.max, p.step === undefined ? null : p.step,
  (p.label && p.label.zh) || '', (p.label && p.label.en) || '']
/** 参数面 → `uniform` 名表（与 core 的 `p.uniform` 同一算式；两边互校）。 */
function unameOfFace(params) {
  const m = {}
  for (const p of params) m[p.key] = lib.builtinEffectUniformName(p.key)
  return m
}
/** 参数面 → 面板吃的 fx 形状（`uniform` 由 key 推 ⇒ 面板只看这一份数据，与 `builtinEffectCatalog()` 同形）。 */
function fxOfFace(params) {
  return Object.assign({}, FX, {
    params: params.map((p) => Object.assign({}, p, { uniform: lib.builtinEffectUniformName(p.key) })),
  })
}
/**
 * 参数面 → **`g_Fx*` 声明段**（唯一那支笔 = core 的 `builtinEffectUniformDecls()`）。
 *   只换声明段、`CUILIUTI_SRC` 正文原样 ⇒ 变异体里"参数面是单一来源、声明由它生成"这条接线**仍然成立**
 *   （否则变异就不是"参数面漂了"，而是"shader 坏了"）。真档必须**逐字节等于** frag 里那 10 行（C2 验它）。
 */
function declsFromFace(fragText, params) {
  const found = fragText.match(/^uniform (?:float|vec2|vec3|vec4) g_Fx\w+; \/\/ \{.*\}$/gm) || []
  if (!found.length) return null
  return fragText.replace(found.join('\n'), lib.builtinEffectUniformDecls(params))
}
/** 参数面 → 常数表（core 的编码算式；`builtinEffectConstants` 读的是 core 内部那张表 ⇒ 变异档要能换掉）。 */
function encodeFace(params, values) {
  const out = {}
  for (const p of params) {
    const has = values && Object.prototype.hasOwnProperty.call(values, p.key)
    out[p.key] = lib.builtinEffectEncodeValue(p, has ? values[p.key] : p.default)
  }
  return out
}

/**
 * 一副"环境"（E 组的变异体只换其中一项；真档 = 仓库里真实那份）。
 * `params`/`uname`/`fx` 一起喂给 B/C ⇒ "面板/数值都从**这一个**参数面推导"在变异体里也成立。
 */
function baseEnv() {
  return {
    demo: DEMO, panel: PANEL, mount: MOUNT, readme: README, frag: FILES[FRAG_REL], core: CORE, third: THIRD,
    params: PARAMS, uname: UNAME, fx: FX, catalog: CATALOG,
    encode: (values) => lib.builtinEffectConstants('cuiliuti', values),
  }
}

/* ═════════════════════════ A 切片与静态锚点 ══════════════════════════════════════════════ */
function checkA(env, only) {
  const res = []
  const push = (id, name, cond, detail) => { if (!only || only.indexOf(id) >= 0) res.push({ id, name, ok: !!cond, detail: detail || '' }) }

  push('A1', '★面板块真源码切片拿得到（' + bytesOf(env.panel) + ' B）且**自足**（无 import/export、不碰页面绑定）',
    env.panel.length > 8000 && !/^\s*(import|export)\b/m.test(env.panel)
    && !/\blib\.|\blogf\b|\bPAGE\b|\bscene\b|\bdocument\b|\blocation\b|\blocalStorage\b/.test(env.panel),
    'bytes=' + bytesOf(env.panel) + ' 无ESM=' + !/^\s*(import|export)\b/m.test(env.panel))
  push('A2', '★装载块真源码切片拿得到（' + bytesOf(env.mount) + ' B）',
    env.mount.length > 5000, 'bytes=' + bytesOf(env.mount))
  push('A3', '★装载块**只读 core 的清单**：catalog / entry / resolveEffectChain 三处调用都在（没有第二张手抄表）',
    /lib\.builtinEffectCatalog\(\)/.test(env.mount) && /lib\.builtinEffectEntry\(/.test(env.mount)
    && /lib\.resolveEffectChain\(/.test(env.mount) && /lib\.cuiliutiOff\(\)/.test(env.mount) && /nopanel/.test(env.mount))
  // A4：`?cuiliuti=off` 的**两侧硬判据**（代码权威读点 + README 主表行）由 `diag-flag-check.mjs`
  //   做**双向**校验；`web/diag-flags.json` 是那份判据的**生成物**（`generatedAt` 一变就重写，
  //   门禁里必然重生成）⇒ 这里**不要求**它是新档（否则等于要求提交一个生成物），只在它**已含**
  //   `cuiliuti` 时验它指的就是 core 那个读点（含 ⇒ 一致；不含 ⇒ 按"生成物滞后"记一行，不红）。
  {
    const jFlag = (FLAGS_JSON && (FLAGS_JSON.flags || []).find((f) => f && f.name === 'cuiliuti')) || null
    const jSites = jFlag ? (jFlag.sites || []).map((s) => String((s && s.pattern) || '') + '@' + String((s && s.file) || '')).join('；') : ''
    const jOk = jFlag === null || /cuiliuti/.test(jSites)
    push('A4', '★`?cuiliuti=off` 两侧一致：代码权威读点 + README 主表行（+ 生成物 `diag-flags.json` 含该项时须一致）',
      /\bget\(\s*'cuiliuti'\s*\)/.test(env.core) && /location\.search/.test(env.core)
      && /^\| `cuiliuti` \|/m.test(env.readme) && jOk,
      'code=' + /\bget\(\s*'cuiliuti'\s*\)/.test(env.core) + ' readme=' + /^\| `cuiliuti` \|/m.test(env.readme)
      + ' json=' + (jFlag === null ? '未含（生成物滞后，非判据）' : V(jSites)))
  }
  push('A5', '★三个读点（effect.json / material / shader）都走同一个 `builtinEffectAsset()` 查表',
    env.core.includes('const bi = builtinEffectAsset(file, opts && opts.search)')
    && env.core.includes('const biMat = builtinEffectAsset(p.material, opts && opts.search)')
    && env.core.includes('const biSh = builtinEffectAsset(rel, opts && opts.search)'))
  push('A6', '★`?cuiliuti=off` 的等价档齐（`off`/`legacy`/`0`），且**没有**引进别的开关名',
    /v === 'off' \|\| v === 'legacy' \|\| v === '0'/.test(env.core)
    && (env.core.match(/'cuiliuti'/g) || []).length >= 2)
  return res
}

/* ═════════════════════════ B 面板（真切片 + 假 DOM）═══════════════════════════════════════ */
function checkB(env, only) {
  const res = []
  const push = (id, name, cond, detail) => { if (!only || only.indexOf(id) >= 0) res.push({ id, name, ok: !!cond, detail: detail || '' }) }

  // B0 **前置钉**：core 的参数面 == 上游冻结面（`UP_FACE`；与 `UP_SHA` 同性质的独立哨兵）。
  // 为什么排在面板之前：面板/ uniform 那几条都是"与 core 自洽"，core 自己漂了它们看不出来（见 UP_FACE 注释）。
  {
    const proj = env.params.map(faceProj)
    const same = proj.length === UP_FACE.length && V(proj) === V(UP_FACE)
    const drift = []
    if (!same) {
      for (let i = 0; i < Math.max(proj.length, UP_FACE.length); i++) {
        if (V(proj[i]) !== V(UP_FACE[i])) drift.push((UP_FACE[i] || proj[i] || [])[0] + ' ' + V(proj[i]) + ' ≠ ' + V(UP_FACE[i]))
      }
    }
    push('B0', '★core 参数面 == 上游**冻结面**（' + UP_FACE.length + ' 条，key/type/default/min/max/step/label 逐字段；'
      + '删一条 / 改一条 min/max 必红）',
      same, same ? (proj.length + ' 条全对上（顺序 = 面板行序）') : ('漂移 ' + drift.length + ' 处: ' + drift.join(' | ')))
  }

  let api = null
  try { api = panelApiOf(env.panel) } catch (e) { api = null }
  if (!api || typeof api.build !== 'function') {
    for (const id of ['B1', 'B2', 'B3', 'B4', 'B5', 'B5b', 'B6', 'B7', 'B8', 'B9']) push(id, '面板块求值/API 可用', false, 'err=no __mpwFxPanel')
    return res
  }
  const doc = mkDoc()
  const calls = []
  const values = {}
  for (const p of env.params) values[p.key] = Array.isArray(p.default) ? p.default.slice() : p.default
  const h = api.build({
    doc, fx: env.fx, fxList: env.catalog, values: values, lang: 'zh',
    layers: [{ label: '0 · 背景 3840×2160' }], layerIndex: 0, appliedCount: 0,
    onParam: (k, v) => calls.push({ k, v }),
  })
  const rows = byParam(h.root, 'label')
  const tabs = findAll(h.root, (e) => e.attrs['data-fx'] !== undefined)
  const names = findAll(h.root, (e) => String(e.className || '').indexOf('fxp-name') >= 0)

  push('B1', '效果清单 = core 的 catalog（' + env.catalog.length + ' 条；tab 的 data-fx = id、标题 = 中文案）',
    tabs.length === env.catalog.length && tabs[0].attrs['data-fx'] === 'cuiliuti' && tabs[0].textContent === '磁流体',
    'tabs=' + V(tabs.map((t) => [t.attrs['data-fx'], t.textContent])))
  const enTitle = (() => { try { return panelApiOf(env.panel).titleOf(env.fx, 'en') } catch (e) { return '' } })()
  push('B1b', '英文档标题（core 的 `title.en`）', enTitle === 'Ferrofluid', V(enTitle))

  // ── 署名（用户要求「效果面板（选中效果后显示作者）」）──
  const authLine = api.authorLine(env.fx, 'zh')
  const authEn = api.authorLine(env.fx, 'en')
  const signEl = byClass(h.root, 'fxp-sign')[0]
  push('B2', '★署名行含原作者（Hope麻匪 / HopeMafei）与收录者（0ran 收录），且**进了 DOM**',
    authLine.indexOf('Hope麻匪') >= 0 && authLine.indexOf('HopeMafei') >= 0 && authLine.indexOf('0ran') >= 0
    && authLine.indexOf('收录') >= 0 && authEn.indexOf('collected by 0ran') >= 0
    && !!signEl && String(signEl.attrs['data-author'] || '').indexOf('HopeMafei') >= 0
    && textOf(byClass(h.root, 'fxp-author')[0]) === authLine,
    'zh=' + V(authLine) + ' en=' + V(authEn))
  push('B3', '★许可行含 MIT 与上游地址（与 effect.json 的 description 同源）',
    api.licenseLine(env.fx, 'zh').indexOf('MIT') >= 0 && api.licenseLine(env.fx, 'zh').indexOf('github.com/oneincase/webwallgl') >= 0
    && textOf(byClass(h.root, 'fxp-license')[0]) === api.licenseLine(env.fx, 'zh')
    && textOf(byClass(h.root, 'fxp-note')[0]).indexOf('HopeMafei') >= 0,
    V(api.licenseLine(env.fx, 'zh')))

  // ── 滑杆：数量 / 名字 / 范围 / 步长 / 缺省 **全部**来自 core 的参数面（单一来源）──
  const rowsModel = api.rowsOf(env.fx, values, 'zh')
  const rowDetail = []
  let rowsOk = rows.length === env.params.length && rowsModel.length === env.params.length
  for (let i = 0; i < env.params.length; i++) {
    const p = env.params[i], r = rows[i], m = rowsModel[i]
    const input = r ? r.querySelector('input') : null
    const val = r ? r.querySelector('.fxp-val') : null
    const isColor = p.type === 'color'
    const expValue = isColor ? m.hex : String(p.default)
    const expReadout = isColor
      ? p.default.map((x) => Math.round(x * 1000) / 1000).join(' ')
      : api.fmtNum(p.default, api.precisionOf(p))
    const good = !!r && !!m && !!input
      && r.attrs['data-param'] === p.key && m.key === p.key && m.uniform === env.uname[p.key]
      && (names[i] ? textOf(names[i]) === ((p.label && p.label.zh) || p.key) : false)
      && String(r.title || '').indexOf(p.key + ' → ' + env.uname[p.key]) === 0
      && (isColor
        ? (input.type === 'color' && input.value === expValue)
        : (input.type === 'range' && String(input.min) === String(p.min) && String(input.max) === String(p.max)
          && String(input.step) === String(p.step) && String(input.value) === String(p.default)))
      && !!val && textOf(val) === expReadout
    if (!good) rowDetail.push(p.key + (r ? '' : '(缺行)'))
    rowsOk = rowsOk && good
  }
  push('B4', '★滑杆**数量/名字/范围/步长/缺省**逐条 == core 参数面（' + env.params.length + ' 项，不手抄）',
    rowsOk, rowsOk ? ('rows=' + rows.length + ' 全对上') : ('不一致: ' + V(rowDetail)))

  // ── 单一来源自证：换一张**合成**参数面 ⇒ 面板必须跟着变 ──
  const synth = {
    id: 'synth-xyz', title: { zh: '合成', en: 'Synth' }, author: 'A', collectedBy: '', license: 'MIT', upstream: '',
    note: { zh: '', en: '' },
    params: [
      { key: 'k1', type: 'float', default: 3, min: 3, max: 7, step: 0.25, uniform: 'g_FxK1', label: { zh: '甲', en: 'A' } },
      { key: 'k2', type: 'color', default: [1, 0, 0], uniform: 'g_FxK2', label: { zh: '乙', en: 'B' } },
      { key: 'k3', type: 'float', default: -2, min: -5, max: -1, step: 1, uniform: 'g_FxK3', label: { zh: '丙', en: 'C' } },
      { key: 'k4', type: 'float', default: 0.5, min: 0.05, max: 0.95, step: 0.05, uniform: 'g_FxK4', label: { zh: '丁', en: 'D' } },
      { key: 'k5', type: 'float', default: 9, min: 9, max: 9, step: 1, uniform: 'g_FxK5', label: { zh: '戊', en: 'E' } },
    ],
  }
  const hs = api.build({ doc: mkDoc(), fx: synth, fxList: [synth], values: {}, lang: 'en', layers: [], layerIndex: 0 })
  const sRows = byParam(hs.root, 'label')
  const sOk = sRows.length === synth.params.length && synth.params.every((p, i) => {
    const input = sRows[i] ? sRows[i].querySelector('input') : null
    if (!input || sRows[i].attrs['data-param'] !== p.key) return false
    if (p.type === 'color') return input.value === api.colorToHex(p.default)
    return String(input.min) === String(p.min) && String(input.max) === String(p.max) && String(input.step) === String(p.step)
  })
  push('B5', '★单一来源自证：换一张**合成**参数面（5 项、含负范围/单点范围/颜色）⇒ 面板跟着变（' + synth.params.length + ' 行）',
    sOk, sOk ? ('rows=' + sRows.length + ' 逐项对上') : ('实际 ' + sRows.length + ' 行: ' + V(sRows.map((r) => r.attrs['data-param']))))
  push('B5b', '★`rowsOf` 对合成面也算得出（数量守恒 + uniform 透传）',
    api.rowsOf(synth, {}, 'en').length === synth.params.length
    && api.rowsOf(synth, {}, 'en').map((r) => r.uniform).join(',') === synth.params.map((p) => p.uniform).join(','))

  // ── 不手抄：两段切片里不许出现参数 key / uniform 名字面量 ──
  const literal = ['g_Fx'].concat(env.params.map((p) => p.key)).filter((k) => new RegExp('\\b' + k + '\\b').test(env.panel) || new RegExp('\\b' + k + '\\b').test(env.mount))
  push('B6', '★面板/装载切片里**没有**任何参数 key 或 uniform 名字面量（手抄就会漂移）',
    literal.length === 0, literal.length ? ('命中: ' + V(literal)) : '0 命中')

  // ── 交互：拖滑杆 / 取色 ──
  const blobsRow = rows[env.params.findIndex((p) => p.key === 'blobs')]
  const blobsIn = blobsRow ? blobsRow.querySelector('input') : null
  if (blobsIn) { blobsIn.value = '42'; blobsIn.dispatch('input') }
  const liqRow = rows[env.params.findIndex((p) => p.key === 'liquid')]
  const liqIn = liqRow ? liqRow.querySelector('input') : null
  if (liqIn) { liqIn.value = '#3380e6'; liqIn.dispatch('input') }
  const cBlobs = calls.filter((c) => c.k === 'blobs').pop()
  const cLiq = calls.filter((c) => c.k === 'liquid').pop()
  push('B7', '交互：拖滑杆 ⇒ `onParam(key, Number(value))`；取色 ⇒ 0..1 三元（与 core 的编码量纲一致）',
    !!cBlobs && cBlobs.v === 42 && !!cLiq && Array.isArray(cLiq.v) && cLiq.v.length === 3
    && Math.abs(cLiq.v[0] - 0.2) < 1e-9 && Math.abs(cLiq.v[1] - 0.501961) < 1e-6 && Math.abs(cLiq.v[2] - 0.901961) < 1e-6,
    V(calls.slice(-2)))
  push('B8', '`colorToHex` / `hexToColor` 往返（0..1 线性 ↔ `#rrggbb`，6 位小数）',
    api.colorToHex([0.2, 0.5, 0.9]) === '#3380e6'
    && V(api.hexToColor('#3380e6')) === V([0.2, 0.501961, 0.901961])
    && V(api.rowsOf(env.fx, {}, 'zh').filter((r) => r.type === 'color').map((r) => r.hex)) === V(['#000000', '#3380e6', '#de6f16']),
    api.colorToHex([0.2, 0.5, 0.9]) + ' / ' + V(api.hexToColor('#3380e6')))

  // ── refresh：只改读数，不重建结构 ──
  h.refresh(Object.assign({}, values, { blobs: 100, alpha: 0.25 }), 2)
  const blobsRow2 = byParam(h.root, 'label').filter((r) => r.attrs['data-param'] === 'blobs')[0]
  const alphaRow2 = byParam(h.root, 'label').filter((r) => r.attrs['data-param'] === 'alpha')[0]
  const bIn2 = blobsRow2 ? blobsRow2.querySelector('input') : null
  const aIn2 = alphaRow2 ? alphaRow2.querySelector('input') : null
  push('B9', '`refresh(values, appliedCount)` 只改读数/控件值（行数不变、控件还是原来那些、状态文案更新）',
    byParam(h.root, 'label').length === env.params.length && !!bIn2 && String(bIn2.value) === '100'
    && !!aIn2 && String(aIn2.value) === '0.25'
    && textOf(byClass(h.root, 'fxp-stat')[0]).indexOf('已应用 2 处') >= 0,
    'blobs=' + (bIn2 && bIn2.value) + ' alpha=' + (aIn2 && aIn2.value) + ' stat=' + V(textOf(byClass(h.root, 'fxp-stat')[0])))
  return res
}

/* ═════════════════════════ C 数值行为（真 frag 源 → _glsl-cpu）═════════════════════════════ */
const C_IDS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8', 'C9', 'C10']
const UP_SHA = '6e42fc87c151b3a67a6f4fa495df9eea7190ec846507a66e068abbb29f1a8d92'
const UP_BYTES = 5073

/** 可选：去上游产物里抽同一段 shader（`editor/effects.ts` 或发布包 `app.asar`），逐字节对拍。 */
function upstreamShaderBytes() {
  const p = process.env.MPW_WWGL_EDITOR
  if (!p) return { skip: 'MPW_WWGL_EDITOR 未设' }
  let raw = null
  try { raw = fs.readFileSync(p) } catch (e) { return { skip: '读不到 ' + p } }
  let i = raw.indexOf('const CUILIUTI_SRC = `')
  if (i >= 0) {   // 上游 .ts 源
    const s = i + 'const CUILIUTI_SRC = `'.length
    const e = raw.indexOf('`', s)
    return e > s ? { text: raw.subarray(s, e).toString('utf8'), how: 'editor/effects.ts' } : { skip: 'ts 里找不到收尾反引号' }
  }
  i = raw.indexOf('#define PI 3.1415927')
  if (i >= 0) {   // 发布包内联（minified bundle 里是**真**多行模板字面量）
    const tail = 'gl_FragColor = vec4(col, g_FxAlpha * edgeAlpha);\n}'
    const e = raw.indexOf(tail, i)
    return e > i ? { text: raw.subarray(i, e + tail.length).toString('utf8'), how: 'app.asar 内联' } : { skip: 'asar 里找不到收尾' }
  }
  return { skip: '该文件里既没有 CUILIUTI_SRC 也没有内联 shader' }
}

/** 编译缓存：同一份 frag 文本只转译一次（全量档 / 变异基线 / 各变异体都要用真源码那一份）。 */
const RUNNER_CACHE = new Map()
function runnerFor(fragText) {
  if (!RUNNER_CACHE.has(fragText)) RUNNER_CACHE.set(fragText, compileFrag(fragText))
  return RUNNER_CACHE.get(fragText)
}

/**
 * C 组的数值电池。`cfg.sweep` = blobs 单调性的取样点（变异档只取两端 ⇒ 省时）；
 * 其余分支断言的探针/时刻**固定**（N=6、t=1.1 —— 时刻非零是为了让 `speed` 这条能显形）。
 * `only` = 只跑这几条 id（变异电池用；**不改断言口径**，只改跑哪些）。
 */
function checkC(env, cfg, only) {
  const res = []
  const push = (id, name, cond, detail) => { if (!only || only.indexOf(id) >= 0) res.push({ id, name, ok: !!cond, detail: detail || '' }) }
  const failAll = (why) => { for (const id of C_IDS) push(id, '数值电池（编译失败 ⇒ 全红）', false, why) }

  // C1 摘要冻结锁（不依赖转译器：先钉"抄进来的就是上游那份"）
  push('C1', '★shader 源与上游**逐字节**一致（冻结回归锁：' + UP_BYTES + ' B / sha256 ' + UP_SHA.slice(0, 12) + '…）',
    sha256(lib.CUILIUTI_SRC) === UP_SHA && bytesOf(lib.CUILIUTI_SRC) === UP_BYTES,
    bytesOf(lib.CUILIUTI_SRC) + 'B ' + sha256(lib.CUILIUTI_SRC).slice(0, 12))
  const up = upstreamShaderBytes()
  // 变异电池（`cfg.quiet`）不重复打这一行 SKIP：同一个事实打 10 遍只会把红集埋掉。
  if (up.skip) { if (!cfg.quiet) skip('C1u', '上游产物逐字节对拍', up.skip) } else {
    push('C1u', '★上游产物逐字节对拍（' + up.how + '）', up.text === lib.CUILIUTI_SRC,
      up.text === lib.CUILIUTI_SRC ? '一致' : ('不一致：上游 ' + bytesOf(up.text) + 'B ' + sha256(up.text).slice(0, 12)))
  }

  let sh = null
  try { sh = runnerFor(env.frag) } catch (e) { failAll('compileFrag: ' + ((e && e.message) || e)); return res }

  const LO = 0.2, HI = 0.8
  const cache = new Map()
  const probe = (over, time, N, raw) => {
    const key = N + '|' + time + '|' + V(over) + '|' + V(raw || null)
    if (cache.has(key)) return cache.get(key)
    const vals = env.encode(over || {})
    const u = { g_Time: time, g_TexelSize: [1 / 64, 1 / 64] }
    for (const p of env.params) {
      const v = vals[p.key]
      u[env.uname[p.key]] = p.type === 'color' ? String(v).split(' ').map(Number) : vals[p.key]
    }
    if (raw) for (const k of Object.keys(raw)) u[k] = raw[k]
    const out = []
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        out.push(sh.run(u, { v_TexCoord: [LO + (HI - LO) * (x + 0.5) / N, LO + (HI - LO) * (y + 0.5) / N] }).gl_FragColor)
      }
    }
    cache.set(key, out)
    return out
  }
  const litOf = (a, t) => a.filter((p) => p[3] > (t === undefined ? 0.05 : t)).length
  const maxAbs = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) for (let k = 0; k < 4; k++) m = Math.max(m, Math.abs(a[i][k] - b[i][k])); return m }
  const relDiff = (a, b) => { let d = 0, s = 0; for (let i = 0; i < a.length; i++) for (let k = 0; k < 4; k++) { d += Math.abs(a[i][k] - b[i][k]); s += Math.abs(b[i][k]) } return s ? d / s : 0 }
  const meanLit = (a, ch) => { const l = a.filter((p) => p[3] > 0.05); return l.length ? l.reduce((s, p) => s + p[ch], 0) / l.length : 0 }

  // C2 uniform 声明 ↔ 参数面同源（core 的 materialMetaFor 就是"shader 注释 → material 名 → uniform"那座桥）
  {
    const meta = lib.materialMetaFor({ vert: FILES[VERT_REL], frag: env.frag })
    const keys = Object.keys(meta)
    let same = keys.length === env.params.length && env.params.every((p) => meta[p.key]
      && meta[p.key].uniform === env.uname[p.key]
      && String(meta[p.key].default) === String(env.encode({})[p.key]))
    if (same) for (const p of env.params) if (!new RegExp('uniform\\s+\\w+\\s+' + env.uname[p.key] + '\\s*;').test(env.frag)) same = false
    if (same) {   // 每个 uniform 在**函数体**里真被读（把声明行抠掉再找名字）
      const body = env.frag.replace(/uniform\s+\w+\s+g_Fx\w+\s*;[^\n]*\n/g, '')
      for (const p of env.params) if (!body.includes(env.uname[p.key])) same = false
    }
    // ★声明注释里的 `"range":[min,max]` 也必须**就是参数面那一对**（float 有、color 没有）：
    //   只对上"哪条参数"、对不上"哪对范围"，滑杆与 shader 常量声明就只是半个同源。
    let rangeOk = same
    if (same) for (const p of env.params) {
      const line = (env.frag.match(new RegExp('uniform\\s+\\w+\\s+' + env.uname[p.key] + '\\s*;[^\\n]*')) || [''])[0]
      const rm = /"range":\[([-\d.]+),([-\d.]+)\]/.exec(line)
      const want = (p.min === undefined || p.max === undefined) ? null : [p.min, p.max]
      if (want === null) { if (rm) rangeOk = false } else if (!rm || Number(rm[1]) !== want[0] || Number(rm[2]) !== want[1]) rangeOk = false
    }
    // ★声明段**逐字节**由参数面生成（`builtinEffectUniformDecls()` 是 core 唯一那支笔）⇒ 参数面一改，
    //   shader 的声明必须跟着改（不是两处各写一遍）。
    const declOk = same && declsFromFace(env.frag, env.params) === env.frag
    push('C2', '★uniform 声明 ↔ 参数面**同源**（key → uniform、default、`"range"` 注释、声明段由 `builtinEffectUniformDecls()` 逐字节生成、每个 uniform 在函数体里被读）',
      same && rangeOk && declOk,
      'meta=' + keys.length + ' 项 range=' + rangeOk + ' decls逐字节=' + declOk + (same ? '' : ' 缺=' + V(env.params.filter((p) => !meta[p.key]).map((p) => p.key))))
  }

  // C3 默认档统计量落区间（"给一组参数 ⇒ 统计量落在预期区间"）
  {
    const a = probe({ blobs: 20 }, 0, 8)
    const n = a.length
    const litFrac = litOf(a) / n
    const meanA = a.reduce((s, p) => s + p[3], 0) / n
    const sumRGB = a.reduce((s, p) => s + p[0] + p[1] + p[2], 0)
    push('C3', '★默认档（liquid 黑 / alpha 1 / edgeglow 1 / blobs 20、t=0、8×8 中心探针）统计量落区间',
      litFrac >= 0.05 && litFrac <= 0.30 && meanA >= 0.02 && meanA <= 0.40 && sumRGB >= 1 && sumRGB <= 10,
      'lit=' + litOf(a) + '/' + n + ' meanA=' + meanA.toFixed(4) + ' sumRGB=' + sumRGB.toFixed(3))
  }

  // C4 alpha：只缩 alpha 通道（线性），不碰 RGB
  {
    const N = 6, T = 1.1
    const a1 = probe({ blobs: 20, alpha: 1 }, T, N)
    const a5 = probe({ blobs: 20, alpha: 0.5 }, T, N)
    const a0 = probe({ blobs: 20, alpha: 0 }, T, N)
    let lit = 0, maxErr = 0, rgbSame = true
    for (let i = 0; i < a1.length; i++) {
      if (a1[i][3] > 1e-9) { lit++; maxErr = Math.max(maxErr, Math.abs(a5[i][3] / a1[i][3] - 0.5)) }
      if (a1[i][0] !== a0[i][0] || a1[i][1] !== a0[i][1] || a1[i][2] !== a0[i][2]) rgbSame = false
    }
    push('C4', '★`alpha` 只缩 alpha 通道：ratio 恰 0.5、`alpha=0` ⇒ 全 0、RGB 逐位不变（' + lit + ' 个亮像素）',
      lit > 0 && maxErr <= 1e-12 && a0.every((p) => p[3] === 0) && rgbSame && a1.some((p) => p[3] > 0.5),
      'lit=' + lit + ' maxErr=' + maxErr.toExponential(2) + ' rgbSame=' + rgbSame)
  }

  // C5 liquid：乘在液体项上（通道隔离）—— 不是"给哪个通道就只画哪个通道"的裁剪，而是整项被染色
  {
    const N = 6, T = 1.1
    const r = probe({ blobs: 20, liquid: [1, 0, 0] }, T, N)
    const b = probe({ blobs: 20, liquid: [0, 0, 1] }, T, N)
    const w = probe({ blobs: 20, liquid: [1, 1, 1] }, T, N)
    const rM = [meanLit(r, 0), meanLit(r, 1), meanLit(r, 2)]
    const bM = [meanLit(b, 0), meanLit(b, 1), meanLit(b, 2)]
    const wM = [meanLit(w, 0), meanLit(w, 1), meanLit(w, 2)]
    const wSpread = (Math.max.apply(null, wM) - Math.min.apply(null, wM)) / Math.max.apply(null, wM)
    push('C5', '★`liquid` 是**乘**在液体项上：红色档 R 通道占优（>3× 另两通道）、蓝色档对称、白色档三通道齐平',
      rM[0] > 0.5 && rM[0] > 3 * Math.max(rM[1], rM[2])
      && bM[2] > 0.5 && bM[2] > 3 * Math.max(bM[0], bM[1]) && wSpread < 0.05,
      'red=' + V(rM.map((x) => +x.toFixed(3))) + ' blue=' + V(bM.map((x) => +x.toFixed(3))) + ' whiteSpread=' + wSpread.toFixed(4))
  }

  // C6 blobs：单调（更多球体 ⇒ 覆盖更大）+ int 截断（20.9 ≡ 20，而 21 ≠ 20 ⇒ 不是四舍五入）
  {
    const lit = cfg.sweep.map((b) => litOf(probe({ blobs: b }, 0, 6)))
    let mono = true
    for (let i = 1; i < lit.length; i++) if (!(lit[i] > lit[i - 1])) mono = false
    const a20 = probe({ blobs: 20 }, 1.1, 6)
    const a209 = probe({ blobs: 20.9 }, 1.1, 6)
    const a21 = probe({ blobs: 21 }, 1.1, 6)
    const trunc = maxAbs(a209, a20) === 0
    const differs = maxAbs(a21, a20) > 1e-6
    push('C6', '★`blobs` 单调（' + cfg.sweep.join('<') + ' ⇒ 覆盖 ' + lit.join('<') + '）+ `int()` 截断（20.9≡20 且 21≠20）',
      mono && trunc && differs,
      'lit=' + V(lit) + ' trunc=' + trunc + ' 21≠20=' + differs + '(' + maxAbs(a21, a20).toExponential(2) + ')')
  }

  // C7 speed：时标真的进 shader（speed=0 ⇒ 时间不变；speed=1 ⇒ 随时间变）
  {
    const N = 6
    const s0a = probe({ blobs: 20 }, 1.1, N, { g_FxSpeed: 0 })
    const s0b = probe({ blobs: 20 }, 5.1, N, { g_FxSpeed: 0 })
    const s1a = probe({ blobs: 20 }, 1.1, N)
    const s1b = probe({ blobs: 20 }, 5.1, N)
    const d0 = maxAbs(s0a, s0b), d1 = relDiff(s1a, s1b)
    push('C7', '★`speed` 的时标真进 shader：`g_FxSpeed=0` ⇒ 两个时刻**逐位相同**；缺省 1 ⇒ 明显不同',
      d0 === 0 && d1 > 0.1, 'speed0 maxAbs=' + d0 + ' speed1 relDiff=' + d1.toFixed(3))
  }

  // C8 10 个滑杆逐个在画面上有落点（无死滑杆）
  {
    const N = 6, T = 1.1
    const eps = { liquid: 1e-2, alpha: 1e-2, blobs: 1e-2, speed: 1e-2, scale: 1e-2, motion: 1e-2, fusion: 1e-2, edge1: 1e-3, edge2: 1e-3, edgeglow: 1e-3 }
    const pert = { liquid: [1, 0, 0], alpha: 0.5, blobs: 60, speed: 2.5, scale: 1.6, motion: 2.0, fusion: 1.8, edge1: [1, 0, 0], edge2: [0, 1, 0], edgeglow: 1.9 }
    const base = probe({ blobs: 20 }, T, N)
    const dead = []
    for (const p of env.params) {
      const over = { blobs: 20 }
      over[p.key] = pert[p.key]
      const a = probe(over, T, N)
      if (!(maxAbs(a, base) > (eps[p.key] || 1e-3))) dead.push(p.key)
    }
    push('C8', '★' + env.params.length + ' 个滑杆**逐个**在画面上有落点（无死滑杆；边缘光三项量级小 ⇒ 门限 1e-3）',
      dead.length === 0, dead.length ? ('无落点: ' + V(dead)) : '全部 > 门限')
  }

  // C9 编码点（唯一编码点 = core 的 builtinEffectConstants：夹取 / 量化 / 形状）
  {
    const c = lib.builtinEffectConstants('cuiliuti', { blobs: 999, alpha: -1, fusion: 1.234567, liquid: [2, -1, 0.5], nosuch: 1 })
    push('C9', '编码点 `builtinEffectConstants()`：越界夹取到 min/max、量化 1e-4、颜色 = "a b c"、未知键忽略、缺省补缺省',
      c.blobs === 120 && c.alpha === 0 && c.fusion === 1.2346 && c.liquid === '1 0 0.5' && c.nosuch === undefined
      && c.scale === 1 && lib.builtinEffectConstants('nope', {}) === null,
      V(c))
  }

  // C10 静态：每个参数 key 在 shader 里都有 uniform 声明（防"面板有滑杆、shader 没这项"）
  {
    const miss = env.params.filter((p) => !new RegExp('uniform\\s+\\w+\\s+' + env.uname[p.key] + '\\s*;\\s*//\\s*\\{"material":"' + p.key + '"').test(env.frag)).map((p) => p.key)
    push('C10', '★每个参数 key 在 frag 里都有**带 material 名**的 uniform 声明（面板↔shader 同源锚点）',
      miss.length === 0, miss.length ? ('缺: ' + V(miss)) : env.params.length + '/' + env.params.length)
  }
  return res
}

/* ═════════════════════════ D 接线（真 core + 合成包）═════════════════════════════════════ */
function mkPkg(files) {
  const enc = new TextEncoder()
  let off = 0
  const entries = [], chunks = []
  for (const name of Object.keys(files)) {
    const b = typeof files[name] === 'string' ? enc.encode(files[name]) : files[name]
    entries.push({ name, offset: off, size: b.length })
    chunks.push(b)
    off += b.length
  }
  const buf = new Uint8Array(off)
  let p = 0
  for (const c of chunks) { buf.set(c, p); p += c.length }
  return { entries, dataStart: 0, buf, fileSize: buf.length }
}
const dec = new TextDecoder()
const entryOf = () => lib.builtinEffectEntry('cuiliuti', {})

function checkD() {
  const res = []
  const push = (id, name, cond, detail) => res.push({ id, name, ok: !!cond, detail: detail || '' })

  push('D1', '查表三形态（id / 目录名 / effect.json 全路径）+ 未收录 ⇒ null + `BUILTIN_EFFECT_IDS`',
    lib.builtinEffectDef('cuiliuti') === lib.builtinEffectDef('wwgl_cuiliuti')
    && lib.builtinEffectDef('cuiliuti') === lib.builtinEffectDef(EFFECT_REL)
    && lib.builtinEffectDef('nope') === null && lib.builtinEffectDef('') === null
    && V(lib.BUILTIN_EFFECT_IDS) === V(['cuiliuti']) && FX.id === 'cuiliuti' && FX.dir === 'wwgl_cuiliuti')
  push('D2', '四个文件都在文件表里（effect.json / material / frag / vert），且 frag 头带署名注释',
    !!FILES[EFFECT_REL] && !!FILES[MAT_REL] && !!FILES[FRAG_REL] && !!FILES[VERT_REL]
    && FILES[FRAG_REL].indexOf('Hope麻匪') >= 0 && FILES[FRAG_REL].indexOf('0ran') >= 0 && FILES[FRAG_REL].indexOf('MIT') >= 0)
  push('D3', '★内置表三处资产都查得到；`?cuiliuti=off`（及 `legacy`/`0`）⇒ 三处**一致**返回 null；`on` ⇒ 照常命中',
    [EFFECT_REL, MAT_REL, FRAG_REL, VERT_REL].every((rel) => {
      const hit = lib.builtinEffectAsset(rel)
      return hit && hit.source === 'builtin' && hit.text === FILES[rel]
    })
    && ['?cuiliuti=off', '?cuiliuti=legacy', '?cuiliuti=0'].every((q) => [EFFECT_REL, MAT_REL, FRAG_REL, VERT_REL].every((rel) => lib.builtinEffectAsset(rel, q) === null))
    && lib.builtinEffectAsset(FRAG_REL, '?cuiliuti=on') !== null
    && lib.builtinEffectAsset('effects/other/effect.json') === null)
  push('D4', '回退位口径与既有开关同款（显式 search 优先；`cuiliuti=off` 之外不误伤）',
    lib.cuiliutiOff('?cuiliuti=off') === true && lib.cuiliutiOff('?cuiliuti=legacy') === true
    && lib.cuiliutiOff('?cuiliuti=0') === true && lib.cuiliutiOff('?x=1') === false && lib.cuiliutiOff('') === false)

  // ── 三级链：包内 → /weassist → 内置表 ──（`resolveEffectChain` 的产物**写在传入的 effect 对象上**）
  const pkgFiles = {}
  pkgFiles[EFFECT_REL] = FILES[EFFECT_REL]
  pkgFiles[MAT_REL] = FILES[MAT_REL]
  const en1 = entryOf()
  const inPkg = lib.resolveEffectChain(mkPkg(pkgFiles), en1, (b) => dec.decode(b))
  push('D5', '★三级链第 1 级：**包内命中** ⇒ 用包内的，内置表不参与（不抢作者的素材）',
    !!inPkg && inPkg.ok === true && inPkg.source === 'pkg' && (en1.materialPasses || []).length === 1
    && en1.materialPasses[0].shader === 'effects/wwgl_cuiliuti' && en1.materialPasses[0].__matSource === 'pkg',
    'ok=' + (inPkg && inPkg.ok) + ' source=' + (inPkg && inPkg.source) + ' mat=' + en1.materialPasses[0].__matSource)
  const wa = (rel) => (rel === EFFECT_REL || rel === MAT_REL) ? FILES[rel] : null
  const en2 = entryOf()
  const inWa = lib.resolveEffectChain(mkPkg({}), en2, (b) => dec.decode(b), { weAssetReader: wa })
  push('D6', '★三级链第 2 级：**`/weassist` 命中** ⇒ 用 `/weassist` 的，内置表不参与',
    !!inWa && inWa.ok === true && String(inWa.source || '').indexOf('weassist') === 0
    && (en2.materialPasses || []).length === 1 && String(en2.materialPasses[0].__matSource || '').indexOf('weassist') === 0,
    'ok=' + (inWa && inWa.ok) + ' source=' + (inWa && inWa.source) + ' mat=' + en2.materialPasses[0].__matSource)
  const en3 = entryOf()
  const inBi = lib.resolveEffectChain(mkPkg({}), en3, (b) => dec.decode(b), { weAssetReader: () => null })
  push('D7', '★三级链第 3 级：前两级**都 miss** ⇒ 内置表接管，效果真的挂上（source=builtin、pass 指到内置 shader）',
    !!inBi && inBi.ok === true && inBi.source === 'builtin'
    && (en3.materialPasses || []).length === 1
    && en3.materialPasses[0].shader === 'effects/wwgl_cuiliuti'
    && en3.__fxSource === 'builtin' && en3.fbos.length === 0,
    'ok=' + (inBi && inBi.ok) + ' source=' + (inBi && inBi.source) + ' pass=' + V((en3.materialPasses || []).map((m) => m.shader)))
  const en4 = entryOf()
  const inOff = lib.resolveEffectChain(mkPkg({}), en4, (b) => dec.decode(b), { weAssetReader: () => null, search: '?cuiliuti=off' })
  push('D8', '★`?cuiliuti=off` ⇒ 逐位回到接线前：三级只剩两级 ⇒ miss + 官方 passthrough 回落语义（不留半个 pass）',
    !!inOff && inOff.ok === false && inOff.miss === 'effect'
    && (en4.fbos || []).length === 0 && (en4.commands || []).length === 0
    && (en4.materialPasses || []).length === 0 && !!en4.__fxMiss && en4.__fxMiss.kind === 'effect',
    'ok=' + (inOff && inOff.ok) + ' miss=' + (inOff && inOff.miss) + ' fxMiss=' + V(en4.__fxMiss && en4.__fxMiss.kind))

  // ── 实例形状 + 常量编码 + key→material→uniform 闭合 ──
  const inst = lib.builtinEffectEntry('cuiliuti', { blobs: 100, alpha: 0.5, liquid: [1, 0, 0] })
  push('D9', '★实例形状 == scene.json 形状（file/visible/passes[0].constantshadervalues），且滑杆值真进常数表',
    inst.file === EFFECT_REL && inst.visible === true && Array.isArray(inst.passes) && inst.passes.length === 1
    && inst.passes[0].constantshadervalues.blobs === 100 && inst.passes[0].constantshadervalues.alpha === 0.5
    && inst.passes[0].constantshadervalues.liquid === '1 0 0'
    && inst.passes[0].textures.length === 0 && inst.passes[0].usertextures === null,
    V(inst.passes[0].constantshadervalues))
  {
    const meta = lib.materialMetaFor({ vert: FILES[VERT_REL], frag: FILES[FRAG_REL] })
    const c0 = lib.builtinEffectConstants('cuiliuti', {})
    const closed = PARAMS.every((p) => meta[p.key] && meta[p.key].uniform === UNAME[p.key]
      && String(meta[p.key].default) === String(c0[p.key]))
    push('D10', '★`滑杆 key → material 名 → uniform` 整链闭合（面板写 key、shader 读 uniform，中间不靠人工对齐）',
      closed && Object.keys(meta).length === PARAMS.length, 'meta=' + Object.keys(meta).length + ' 项')
  }
  push('D11', 'shader 读点：`builtinEffectAsset()` 给出的 frag/vert 与文件表**逐字节**相同',
    lib.builtinEffectAsset(FRAG_REL).text === FILES[FRAG_REL] && lib.builtinEffectAsset(VERT_REL).text === FILES[VERT_REL])

  // ── 署名三处（①面板行在 B2/B3、②effect.json description、③源码注释 + THIRD-PARTY 清单）──
  const desc = JSON.parse(FILES[EFFECT_REL]).description
  push('D12', '★署名第二处：`effect.json` 的 description 写明 作者/收录/许可(MIT)/出处（工程自包含地带着版权）',
    desc.indexOf('Hope麻匪') >= 0 && desc.indexOf('HopeMafei') >= 0 && desc.indexOf('0ran') >= 0
    && desc.indexOf('MIT') >= 0 && desc.indexOf('github.com/oneincase/webwallgl') >= 0
    && desc.indexOf('作者') >= 0 && desc.indexOf('收录') >= 0,
    V(desc.split('\n')[1] || ''))
  push('D13', '★署名第三处：源码注释（core 段头 + 生成的 frag 头 + demo.html 面板段头）都写明原作者/收录者/上游/许可',
    /Hope麻匪/.test(CORE) && /HopeMafei/.test(CORE) && /0ran/.test(CORE)
    && /github\.com\/oneincase\/webwallgl/.test(CORE) && /MIT/.test(CORE)
    && /原作作者：Hope麻匪|原作者：Hope麻匪/.test(FILES[FRAG_REL])
    && FILES[FRAG_REL].indexOf('上游：oneincase/webwallgl（MIT）') >= 0
    && /Hope麻匪/.test(PANEL) && /oneincase\/webwallgl/.test(PANEL) && /MIT/.test(PANEL))
  push('D14', '★第三方清单：`THIRD-PARTY.md` 有一条承接 §19 的条目（HopeMafei / 0ran / MIT / 上游地址 / 本仓文件）',
    /^## 20\./m.test(THIRD) && /HopeMafei/.test(THIRD) && /0ran/.test(THIRD)
    && /github\.com\/oneincase\/webwallgl/.test(THIRD) && /MIT/.test(THIRD)
    && /cuiliuti/.test(THIRD))
  return res
}

/* ═════════════════════════ 跑 A–D ════════════════════════════════════════════════════════ */
console.log('[A] `demo.html` 真源码切片（MPW-FX-PANEL / MPW-FX-MOUNT）+ 静态锚点')
for (const r of checkA(baseEnv())) ok(r.id, r.name, r.ok, r.detail)

console.log('\n[B] 参数面 + 面板：真切片 + 假 DOM（上游冻结面 / 署名行 / 滑杆单一来源 / 交互）')
for (const r of checkB(baseEnv())) ok(r.id, r.name, r.ok, r.detail)

console.log('\n[C] 数值行为：`tests/_glsl-cpu.mjs` 跑**仓库里真实那份** frag 源（无 GL / 无浏览器）')
for (const r of checkC(baseEnv(), { sweep: [20, 80, 120] })) ok(r.id, r.name, r.ok, r.detail)

console.log('\n[D] 接线：真 core + 合成 pkg / 合成 `/weassist` 读取器（三级链 / 回退位 / 署名）')
for (const r of checkD()) ok(r.id, r.name, r.ok, r.detail)

/* ═════════════════════════ E 变异自证（期望红集 == 实际红集）══════════════════════════════ */
console.log('\n[E] MUTANT-RED-OK：把真源码/真切片逐条改坏 ⇒ 期望红集 == 实际红集')
// ⚠ 变异电池**不过滤**（`only = null`）：每个变异体跑整组，红集 = 实际红的**全部** id。
//   为什么不留"只统计这几条"的口子：那会把"别的判据也红了"藏起来（红集看着干净，其实判据更早就响了）。
//   代价 = 每个变异体跑满一整组（数值那组是主要开销，见文件头读数），换来的是红集**可核对**。
const CHEAP = { sweep: [20, 120], quiet: true }
{
  const base = checkC(baseEnv(), CHEAP, null).filter((r) => !r.ok).map((r) => r.id)
  ok('E0', '★变异电池的**基线**：真源码在廉价档（sweep=' + V(CHEAP.sweep) + '）下 0 红（否则下面的红集不可信）',
    base.length === 0, base.length ? ('基线就红: ' + V(base)) : '0 红')
}
const hardcodedRows = (() => {
  // 「手抄」变异体：把 core 的参数面**逐字段准确**抄进面板（准确的手抄也要变红 —— 它迟早漂移）
  const rows = CATALOG[0].params.map((p) => ({ key: p.key, type: p.type, default: p.default, min: p.min, max: p.max, step: p.step, uniform: p.uniform, label: p.label }))
  return 'var params = ' + JSON.stringify(rows) + ';'
})()
const MUTANTS = [
  {
    tag: 'M1', label: 'shader 换空实现（`void main() {}` —— 一个像素都不写）', kind: 'num',
    mutate: (env) => { env.frag = env.frag.replace(lib.CUILIUTI_SRC, 'void main() {}') },
    // 全组红集（不过滤，见本节开头）：C2 = 一个 uniform 都没被读（空 main）；C3 覆盖/亮度、C4 alpha、
    // C5 liquid、C6 blobs 单调、C7 时间不再改变任何像素、C8 十根滑杆全无落点 ⇒ 数值面整体崩塌。
    expect: ['C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8'],
  },
  {
    tag: 'M2', label: '把 `blobs` 写死进 shader（`int(g_FxBlobs)` → `80`）', kind: 'num',
    mutate: (env) => { env.frag = env.frag.replace('int(g_FxBlobs)', '80') },
    // C2 红 = `g_FxBlobs` 在函数体里**再也不被读**（写死的直接证据）；C3 红是**正确级联**：C3 探的就是
    // `blobs=20` 那一档，shader 把它钉成 80 ⇒ 画出来的不是那一档；C6 单调/截断、C8 落点一起红。
    expect: ['C2', 'C3', 'C6', 'C8'],
  },
  {
    tag: 'M3', label: '把 `alpha` 写死进 shader（`g_FxAlpha * edgeAlpha` → `edgeAlpha`）', kind: 'num',
    mutate: (env) => { env.frag = env.frag.replace('g_FxAlpha * edgeAlpha', 'edgeAlpha') },
    // C2 红 = `g_FxAlpha` 不再被读；C4 = alpha 通道比例不再随滑杆走；C8 = `alpha` 这根滑杆没有落点。
    expect: ['C2', 'C4', 'C8'],
  },
  {
    tag: 'M4', label: '面板把 core 的参数面**手抄**成死表（抄得再准也变红）', kind: 'panel',
    mutate: (env) => { env.panel = env.panel.replace('var params = (fx && fx.params) || []', hardcodedRows) },
    // 手抄还**直接**触发了两条：B6（切片里出现了参数 key 字面量）、B5b（`rowsOf` 不再看 `fx.params`）
    expect: ['B5', 'B5b', 'B6'],
  },
  {
    tag: 'M5', label: '面板把滑杆范围写死（min/max/step 恒 0/1/1）', kind: 'panel',
    mutate: (env) => { env.panel = env.panel.replace('ri2.min = String(r.min); ri2.max = String(r.max); ri2.step = String(r.step)', "ri2.min = '0'; ri2.max = '1'; ri2.step = '1'") },
    expect: ['B4', 'B5'],
  },
  {
    tag: 'M6', label: '署名行丢掉收录者（`fx.collectedBy` 分支短路）', kind: 'panel',
    mutate: (env) => { env.panel = env.panel.replace('if (fx.collectedBy) s +=', 'if (false) s +=') },
    expect: ['B2'],
  },
  {
    tag: 'M7', label: 'README 主表删掉 `cuiliuti` 行（文档有·代码无 / 代码有·文档无 的那一侧）', kind: 'doc',
    mutate: (env) => { env.readme = env.readme.replace(/^\| `cuiliuti` \|.*$/m, '') },
    expect: ['A4'],
  },
  {
    // ★逻辑取反（用户点名的第三类语义变异）：`1.0 - smoothstep(...)` → `smoothstep(...)`
    //   背景与主体互换 ⇒ 覆盖比例/平均 alpha 直接爆掉（C3）、blobs 的单调方向翻过来（C6）、
    //   边缘光三项被淹掉（C8）。**不是**"改一字 ⇒ 摘要变"那种逻辑必然：这里红的是**数值判据**，
    //   而且 sha 锁（C1）根本不在这个电池里（`only` 只跑 C3/C4/C5/C6/C8）。
    tag: 'M8', label: '`edgeAlpha` 的 `1.0 - smoothstep(...)` **逻辑取反**（背景⇄主体互换）', kind: 'num',
    mutate: (env) => { env.frag = env.frag.replace('1.0 - smoothstep(0.001, 0.001 + EDGE_SMOOTHNESS, endD)', 'smoothstep(0.001, 0.001 + EDGE_SMOOTHNESS, endD)') },
    // C3 = 覆盖比例/平均 alpha 从"少数亮"翻成"几乎全亮"；C6 = blobs 越多**亮像素越少**（单调方向翻转）；
    // C8 = 边缘光三项被整片背景淹没（落点 < 门限）；C7 也红：取反后"随时间变"的那部分被背景摊薄，
    // 相对差掉到门限下（**如实计入红集**，不为了让红集好看而把它排除）。
    expect: ['C3', 'C6', 'C7', 'C8'],
  },
  {
    // ★core **参数面本体**漂移之一：改一条的 min/max（`blobs` max 120 → 90）。
    //   注意这个变异体里"单一来源"这条接线**仍然成立**（面板与 shader 都由这张表重生成）⇒
    //   B4（面板 == core）/ C2/C10（uniform == core）**全绿**，只有 B0（== 上游冻结面）抓得住。
    tag: 'M9', label: 'core 参数面**改一条 min/max**（`blobs` max 120 → 90；面板与声明都跟着变）', kind: 'face',
    mutate: (env) => {
      env.params = env.params.map((p) => (p.key === 'blobs' ? Object.assign({}, p, { max: 90 }) : p))
      env.uname = unameOfFace(env.params)
      env.fx = fxOfFace(env.params)
      env.encode = (v) => encodeFace(env.params, v)
      env.frag = declsFromFace(env.frag, env.params)
    },
    expect: ['B0'],
  },
  {
    // ★core **参数面本体**漂移之二：删一条（`edgeglow`）。同样地，面板少一根滑杆、shader 少一条声明 ——
    //   自洽档（B4/B5/B5b/B6/C2/C10）全绿，只有 B0 的"10 条逐字段"能抓住"少了一条"。
    tag: 'M10', label: 'core 参数面**删一条**（`edgeglow` ⇒ 面板少一根滑杆、声明少一条）', kind: 'faceDel',
    mutate: (env) => {
      env.params = env.params.filter((p) => p.key !== 'edgeglow')
      env.uname = unameOfFace(env.params)
      env.fx = fxOfFace(env.params)
      env.encode = (v) => encodeFace(env.params, v)
      env.frag = declsFromFace(env.frag, env.params)
    },
    expect: ['B0'],
  },
]
const BATTERY = {
  num: (env) => checkC(env, CHEAP, null),
  panel: (env) => checkB(env, null),
  doc: (env) => checkA(env, null),
  // 参数面本体**改 min/max**：整组都跑 —— "自洽档"（B4 面板 == core、C2/C10 uniform == core）全绿才是这条
  // 变异的要害（core 自己改了范围，跟着它推导的两侧当然一起变），红的必须**只有** B0。
  face: (env) => checkB(env, null).concat(checkC(env, CHEAP, null)),
  // 参数面本体**删一条**：只能跑面板/静态那组 —— 删掉的那条 uniform 声明没了，`CUILIUTI_SRC` 正文还在读它
  // （`g_FxEdgeglow is not defined`）⇒ 数值电池**整组不可执行**（这本身就是"删参数"的真实后果，
  //   不是判据的毛病）；红集只统计能执行的那组。
  faceDel: (env) => checkB(env, null),
}
for (const mu of MUTANTS) {
  const env0 = baseEnv()
  const env = baseEnv()
  let missing = null
  try { mu.mutate(env) } catch (e) { missing = (e && e.message) || String(e) }
  // 变异必须真的落到源码/参数面上（锚点不在 ⇒ 是判据自己的错，不是"没变红"）
  const changed = env.frag !== env0.frag || env.panel !== env0.panel || env.readme !== env0.readme || env.params !== env0.params
  if (missing || !changed) {
    failN++
    console.log('  ✗ E ' + mu.tag + ' 变异锚点不在真源码里 (' + mu.label + ')' + (missing ? ' 抛=' + missing : ''))
    fails.push('E ' + mu.tag + ' 锚点缺失')
    continue
  }
  let got = null, err = null
  try { got = BATTERY[mu.kind](env, mu).filter((r) => !r.ok).map((r) => r.id) } catch (e) { err = (e && e.message) || String(e) }
  const exp = mu.expect.slice().sort()
  const act = got ? got.slice().sort() : null
  const eqSets = !!act && act.length === exp.length && act.every((x, i) => x === exp[i])
  if (eqSets) {
    passN++
    console.log('  MUTANT-RED-OK ' + mu.tag + '（' + mu.label + '）⇒ 红集 = ' + V(act))
  } else {
    failN++
    console.log('  ✗ E ' + mu.tag + '（' + mu.label + '）红集不符：期望 ' + V(exp) + ' 实际 ' + V(act) + (err ? ' 抛=' + err : ''))
    fails.push('E ' + mu.tag + ' 红集不符')
  }
}

/* ═════════════════════════ 汇总 ═══════════════════════════════════════════════════════════ */
console.log('\n' + (failN === 0 ? 'ALL PASS' : 'FAILED') + '：' + passN + ' 项通过 / ' + failN + ' 项失败'
  + (redOrder.length ? '（红: ' + redOrder.join(',') + '）' : ''))
if (failN) console.log('  失败清单：\n   - ' + fails.join('\n   - '))
process.exit(failN ? 1 : 0)
