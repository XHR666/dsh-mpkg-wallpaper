/* 参照来源许可声明：本文件提到的第三方参考实现只作**行为对照**，不复制其代码/注释/常量组织/错误文案：
 *   · references/wer-ref（Aromatic05/wallpaper-engine-renderer，GPL-2.0-only）—— 仅行为对照；
 *   · references/vendor-ref/webwallgl（oneincase/webwallgl，**MIT**）—— 允许移植，本文件仍按"行为规格"独立实现。
 */
// clock-combo-visible-test.mjs —— WEBWALLGL issue #2「时钟层 `visible` 绑 combo、同组 ≥3 变体时
// **偶发同屏两个时钟**」的**官方语义核对 + 合成复现/反证**门禁（无浏览器、无网络、无 GPU）。
//
// ── 先纠正一处命名（避免继续在错的名字上打转）────────────────────────────────────────────
//   本仓 **没有** `recomputeLayerVisibility` / `visibleSelf` / `visibleScript` 这三个符号
//   （`grep -rn` 在 core/ elysia/ demo.html 全 0 命中）。它们属于 `demo/assets/renderer-BOSoB05I.js`
//   （上游 webwallgl 的构建产物，MIT，仅行为对照）：
//     · 上游 `recomputeLayerVisibility(layers)` = `visibleSelf ≠ false` + `parentId` 级联，
//       **完全不看 combo**（grep 产物：`function G0(t){…let r=n.visibleSelf!==!1…}`）；
//     · 上游把 combo→visible 放在 `Wr(objects, properties)`（`du()` → `fu(props,name)` → `H0(value,condition)`）
//       先解析成字面量，再算 visibleSelf。
//   本仓的等价链是：`parseScene` 存 `l.__visibleRaw`/`l.__bindRaw` → `applyRenderConfig` 的
//   RE-06 段（`evalVisibleWithProps` + 父链级联）→ 面板路径 `applyUserProperties`（`writeBindField('visible')`）。
//
// ── 官方语义（真语料，file:line 级）────────────────────────────────────────────────────────
//   · WE 的 combo 属性在 `project.json.general.properties.<name>`：`{"type":"combo","value":"5",
//     "options":[{"label":"字体1","value":"1"},…]}` —— **选项值是 1 起的字符串**（实测
//     `allwallpaper/0917/3448877775/project.json` 的 `b1`：options "1".."5"、默认 "5"）。
//   · 层的 `visible` 形如 `{"user":{"name":"b1","condition":"6"},"value":true}`：每个变体一个 condition，
//     同一组 ≥3 个变体。实测同包 scene.json 里 `b1` 组有 **6 个 `Clock` 层**（condition 1..6），
//     **其中 condition "6" 有两层**（id 502 父 498 `横Clock`、id 531 父 3991 `横Clock`，两层都 authored true）。
//   · 另两个实测形态：属性自身带**门控表达式**（`b1.condition = "time.value"`、`display.condition =
//     "timevarying.value==2"`、`clocklocation.condition = "language.value == 1"`），
//     以及同一属性名下 **authored true 的层多于一层**（`allwallpaper/0917/3299228616` 的
//     `clocklocation` cond"1" 下 `Clock Layer 1` 与 `Clock 12` 都是 true）。
//
// ── 本档的三条复现（合成场景，形状照抄真语料）＋一条反证 + P-184 之后的**新契约** ──────────────
//   C2（★P-184 重写）属性表**存在**但这次求值的 props 缺 `clockstyle` 键：
//      改前 ⇒ 装载路径 `if (!has) return true` ⇒ **3 个变体全部可见**；面板路径 `stats.missing++`
//      直接跳过 ⇒ 保持 authored（**1 个**）⇒ 同一输入两条路径读数不同，同屏几个时钟取决于
//      "最后一次是谁写的"（"偶发"的直接来源）。
//      改后 ⇒ 两条路径都回落**作者默认值**（属性组默认值 `schema[name].value`），读数一致。
//   C2b 状态 (a) 与 (b) **必须可区分**：容器没有 project.json ⇒ 保持"未知 → 可见"（legacy 灾难规避，
//      台账记 `unknownNoTable`）；有表缺键 ⇒ 回落作者默认值（台账记 `defaultsUsed`）。
//   C3 属性被门控关闭（父属性取关）⇒ 绑定不生效、回落 authored value ⇒ 作者存了几个 true
//      就同屏几个时钟（真语料 `dd/3660962877` 该形态下是 **2 个**；本档保留这条既有口径）。
//   C4（★P-184 重写）属性值恰好是 **bool**（面板/URL 传 true）且 condition ≥3 ⇒ 改前
//      `pv === true` 兜底让除 "1" 以外的 condition 全部命中 ⇒ 同屏 ≥2；改后：一行中文警告
//      （层名 + 属性 + 变体数）+ 组级收口 ⇒ **恰好 1 个**；同 condition 重复层（C4b）也绝不 ≥2。
//   C5 反证：props 完整时，逐帧切换 combo 1→2→3 **每帧恰好 1 个可见**、切换原子（无"旧层未隐藏/
//      新旧叠加"的中间帧）、重复 apply 幂等 ⇒ 同屏两层**不可能**是"可见性重算不完备/时序窗口"，
//      只能来自解析口径（C2/C2b/C4）。
//
// ── 变异自证（RED-IF-REVERTED）＋**改前副本**─────────────────────────────────────────────
//   断言体收在 `coreChecks(L)`；真模块全绿，N 个变异体各自期望红集，实测==期望时打印 `MUTANT-RED-OK`。
//   "改前读数"取自**钉死提交** `PRE_CHANGE_COMMIT`（6102c1c，本改动之前的 HEAD）里的
//   `core/we-scene-bundle.js`，**不许用 `git show HEAD:`**（P-181 ⑥ 的教训：提交一旦落地，
//   HEAD 就变成"改后"，变异体与真树逐字相同 ⇒ 变异无差异、红集恒空）。
//
// 用法: node tests/clock-combo-visible-test.mjs [--no-mutation] [--no-corpus] [--verbose]
// 退出码：0 全绿（含 SKIP）/ 1 有断言失败 / 2 用法错误。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { ROOT, WS } from './_root.mjs'

// 改动前的 HEAD（P-184 落地前）。**钉死**，不要顺手更新成新提交：它是"改前读数"的唯一来源。
const PRE_CHANGE_COMMIT = '6102c1c'

const argv = process.argv.slice(2)
if (argv.some((a) => !['--no-mutation', '--no-corpus', '--verbose', '--help'].includes(a))) {
  console.error('未知参数（用法见文件头）'); process.exit(2)
}
if (argv.includes('--help')) { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(0, 30).join('\n')); process.exit(0) }
const NO_MUT = argv.includes('--no-mutation')
const NO_CORPUS = argv.includes('--no-corpus')
const VERBOSE = argv.includes('--verbose')
globalThis.location = globalThis.location || { search: '', href: 'http://localhost/' }
const lib = await import('../core/we-scene-bundle.js')

let passN = 0, failN = 0
const fails = []
const ok = (name, cond, detail) => {
  if (cond) { passN++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { failN++; fails.push(name); console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}
const V = (o) => JSON.stringify(o)
const skip = (m) => console.log('  SKIP ' + m)

// ═════════════════════════ 1 合成场景（形状照抄真语料）════════════════════════════════════
/** 3 变体时钟（条件 "1"/"2"/"3"）+ 可选"同 condition 的第二层"、"门控属性"、"父容器被绑定隐藏"、
 *  "表里没有这个键"、"空属性表"、"作者默认值换档"、"authored true 换档"。
 *  `defVal` 是属性组默认值（= 缺键时要回落的那一档）；`authoredIndex` 是作者存 true 的那一档。 */
function mkSceneJson({ dupSameCond = false, gate = null, defVal = '1', authoredIndex = 0, noKeyInTable = false,
  emptyTable = false, hideParent = false } = {}) {
  const objects = [
    { id: 1, name: 'ClockRoot', origin: '1920 1080 0', scale: '1 1 1', size: '3840 2160', angles: '0 0 0',
      visible: hideParent ? { user: { name: 'blockprop', condition: '0' }, value: true } : true,
      image: 'models/util/composelayer.json' },
  ]
  const conds = ['1', '2', '3']
  const authored = [false, false, false]
  authored[authoredIndex] = true                       // 真语料：只有当前选中的那个变体 authored true
  for (let i = 0; i < 3; i++) {
    objects.push({ id: 11 + i, parent: 1, name: 'Clock ' + (i + 1), origin: '0 0 0', scale: '1 1 1', size: '400 160',
      angles: '0 0 0', text: '12:34', visible: { user: { name: 'clockstyle', condition: conds[i] }, value: authored[i] } })
  }
  if (dupSameCond) objects.push({ id: 14, parent: 1, name: 'Clock 3b', origin: '600 0 0', scale: '1 1 1', size: '400 160',
    angles: '0 0 0', text: '12:34', visible: { user: { name: 'clockstyle', condition: '3' }, value: true } })
  const schema = {}
  if (!emptyTable) {
    if (!noKeyInTable) {
      schema.clockstyle = { type: 'combo', value: defVal, options: [{ label: '字体1', value: '1' }, { label: '字体2', value: '2' }, { label: '字体3', value: '3' }] }
      if (gate) schema.clockstyle.condition = gate               // 真语料形态：b1.condition = "time.value"
    } else {
      // (b2) 表**存在**（有别的键）但没有 `clockstyle`：绑定落到"本层 authored value"
      schema.otherprop = { type: 'bool', value: true }
    }
    if (gate) schema.gateprop = { type: 'bool', value: true }
    if (hideParent) schema.blockprop = { type: 'combo', value: '1', options: [{ label: '开', value: '0' }, { label: '关', value: '1' }] }
  }
  return { scene: { version: 1, camera: null, general: { orthogonalprojection: { width: 3840, height: 2160 }, properties: {} }, objects },
    project: { general: { properties: schema } } }
}
/** 逐层判定（本档自己复刻 RE-06 的"每层绑定 + 父链级联"口径，用于**独立对照**被测实现）。
 *  ⚠ P-184 起第三条参数（schema/hasTable）必须与实现同源，否则对照的是"旧口径 vs 新口径"。 */
function visibleSet(scene, props, schema, L, opts = {}) {
  const gated = L.gatedOffNames(schema, props)
  const byId = new Map(scene.layers.map((l) => [l.id, l]))
  const cache = new Map()
  const visOf = (l) => {
    if (cache.has(l.id)) return cache.get(l.id)
    cache.set(l.id, true)
    let v = L.evalVisibleWithProps((l.__visibleRaw !== undefined) ? l.__visibleRaw : l.visible, props, gated,
      Object.assign({ schema, scene }, opts))
    if (v && l.parent !== undefined && l.parent !== null) { const p = byId.get(l.parent); if (p && !visOf(p)) v = false }
    cache.set(l.id, v)
    return v
  }
  /* bool 值 + ≥3 condition：组级收口（**契约**的独立复刻**：同组最多留一个，优先官方两态命中的那一档，
     其次 authored true，再退组内第一个）。实现在 `settleVisGroups`，本档这份只用于交叉核对。 */
  const perLayer = new Map(scene.layers.map((l) => [l.id, visOf(l)]))
  for (const [name, pv] of Object.entries(props || {})) {
    if (typeof pv !== 'boolean') continue
    const group = scene.layers.filter((l) => {
      const raw = (l.__visibleRaw !== undefined) ? l.__visibleRaw : l.visible
      return L.visBindName(raw) === name && L.visBindCond(raw) !== ''
    })
    if (new Set(group.map((l) => L.visBindCond((l.__visibleRaw !== undefined) ? l.__visibleRaw : l.visible))).size < 3) continue
    const val = (l) => ((l.__visibleRaw !== undefined) ? l.__visibleRaw : l.visible)
    const hit = group.find((l) => L.condMatchesPropValue(pv, L.visBindCond(val(l))) === true)
      || group.find((l) => !!val(l).value) || group[0]
    if (hit) for (const l of group) perLayer.set(l.id, l === hit)
  }
  // 父链级联（用收口后的值；与 RE-06 同序：先逐层、再组级收口、最后级联）
  const cache2 = new Map()
  const finalOf = (l) => {
    if (cache2.has(l.id)) return cache2.get(l.id)
    cache2.set(l.id, true)
    let v = perLayer.get(l.id)
    if (v && l.parent !== undefined && l.parent !== null) { const p = byId.get(l.parent); if (p && !finalOf(p)) v = false }
    cache2.set(l.id, v)
    return v
  }
  return { ids: scene.layers.filter((l) => finalOf(l)).map((l) => l.id), gated }
}
/** 每个候选时钟层的"层 id → visible"快照（逐帧台账用）。 */
const clockIds = (scene, dup) => scene.layers.filter((l) => /^Clock /.test(String(l.name))).map((l) => l.id)

// ═════════════════════════ 2 mock GL（只为"逐帧"这一跳：renderScene 不改 visible，只读它）══════
const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
  FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0, VERTEX_SHADER: 0x8B31,
  FRAGMENT_SHADER: 0x8B30, FLOAT: 0x1406, FLOAT_VEC2: 0x8B50, FLOAT_VEC3: 0x8B51, FLOAT_VEC4: 0x8B52,
  INT: 0x1404, BOOL: 0x8B56, FLOAT_MAT4: 0x8B5C, FLOAT_MAT3: 0x8B5B, SAMPLER_2D: 0x8B5E }
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
function mkGL() {
  let seq = 0, curProg = null
  const mk = (k) => ({ id: k + '#' + (++seq) })
  const handlers = {
    createTexture: () => mk('tex'), createFramebuffer: () => mk('fbo'), createBuffer: () => mk('buf'),
    createVertexArray: () => mk('vao'), createShader: () => mk('sh'), createProgram: () => mk('prog'),
    getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS ? true : (k === CONST.ACTIVE_UNIFORMS ? 1 : (k === CONST.ACTIVE_ATTRIBUTES ? 2 : null))),
    getActiveUniform: () => ({ name: 'g_Texture0', type: CONST.SAMPLER_2D }),
    getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: i === 0 ? 3 : 2 }),
    getAttribLocation: (p, n) => (n === 'a_Position' ? 0 : n === 'a_TexCoord' ? 1 : -1),
    getUniformLocation: (p, n) => ({ p, n }), getShaderParameter: () => true,
    checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE, getError: () => CONST.NO_ERROR,
    getParameter: (k) => (k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0), getShaderInfoLog: () => '', getProgramInfoLog: () => '',
    useProgram: (p) => { curProg = p },
  }
  const gl = new Proxy({}, { get(t, prop) {
    if (prop in handlers) return handlers[prop]
    if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
    return () => {}
  } })
  return { gl }
}
const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
const FRAG = 'uniform sampler2D g_Texture0; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord); }'
const shaderResolver = async (rel) => (String(rel).endsWith('.vert') ? VERT : FRAG)

/** 逐帧台账：给定"属性时间线"，每帧记录每个候选层的 visible。`path` = 'load'（applyRenderConfig）| 'panel'（applyUserProperties）。 */
async function traceFrames({ sceneJson, project, steps, dup = false, L = lib }) {
  const sc = L.parseScene(sceneJson, project)
  const schema = (project.general && project.general.properties) || {}
  const cands = clockIds(sc, dup)
  const { gl } = mkGL()
  const r = L.createRenderer({ getContext: () => gl, width: 3840, height: 2160 }, { shaderResolver, onLog: () => {} })
  const rows = []
  let frame = 0
  for (const st of steps) {
    const props = st.props
    if (st.path === 'load') L.applyRenderConfig(sc, { properties: props, propertiesSchema: schema, hideParticles: true, hideUI: true, log: () => {} })
    else L.applyUserProperties(sc, props, { schema, gated: L.gatedOffNames(schema, props) })
    for (let k = 0; k < (st.frames || 2); k++) {
      await r.render(sc, new Map(), 3840, 2160, 1 / 60)
      frame++
      const vis = cands.filter((id) => sc.layers.find((l) => l.id === id).visible)
      rows.push({ frame, path: st.path, tag: st.tag, prop: st.prop, visible: vis, n: vis.length })
    }
  }
  return { rows, cands, scene: sc }
}

// ═════════════════════════ 3 断言体（对同一个 L 可反复跑 ⇒ 变异自证）══════════════════════
async function coreChecks(L) {
  const out = []
  const add = (id, okv, detail) => out.push({ id, ok: !!okv, detail: detail || '' })
  // 台账读取一律走这里：变异体"不发布台账"时必须让断言**变红**，而不是让 coreChecks 抛异常
  // （抛异常会被变异机制记成"跑挂"、红集为空 ⇒ 变异自证形同虚设）。
  const vs = (sc) => (sc && sc.__visStats) || { kept: 0, hidden: 0, unknownNoTable: 0, defaultsUsed: 0, warns: 0,
    bound: 0, boundMatched: 0, cascaded: 0, boolTieBreak: 0, path: '-', reasons: {}, notes: [] }

  // C1 props 完整（combo 字符串）：3 个取值各恰好 1 层可见
  {
    const { scene, project } = mkSceneJson()
    const sc = L.parseScene(scene, project)
    const schema = project.general.properties
    const got = {}
    for (const v of ['1', '2', '3']) {
      const props = Object.assign(L.propsDefaults(schema), { clockstyle: v })
      L.applyRenderConfig(sc, { properties: props, propertiesSchema: schema, hideParticles: true, hideUI: true, log: () => {} })
      got[v] = clockIds(sc).filter((id) => sc.layers.find((l) => l.id === id).visible)
    }
    add('C1', ['1', '2', '3'].every((v) => got[v].length === 1), V(got))
  }
  // C2（★P-184 **契约变更**）属性表**存在**、props 里缺 `clockstyle` 键 ⇒ 两条路径**同一结果**：
  //   改前（钉死 6102c1c）：装载路径 `[11,12,13]`（"未知 → 可见"）vs 面板路径 `[11]`（跳过不写）
  //   —— 改前的两条读数由 `originChecks` 用钉死提交的模块**实测**（不是本档口述）。
  //   改后：都按属性组默认值回落。本用例特意把默认值设成 "2"、authored true 设在第 1 档（"1"）
  //   ⇒ "恰好等于默认值那一档" 与 "保持 authored" 是**两个不同答案**（[12] vs [11]）：两条路径
  //   都必须给 [12]，谁都别想蒙对。
  {
    const cfg = { defVal: '2', authoredIndex: 0 }
    const { scene, project } = mkSceneJson(cfg)
    const schema = project.general.properties
    const other = L.propsDefaults(schema); delete other.clockstyle
    const sc = L.parseScene(scene, project)
    L.applyRenderConfig(sc, { properties: other, propertiesSchema: schema, hideParticles: true, hideUI: true, log: () => {} })
    const a = clockIds(sc).filter((id) => sc.layers.find((l) => l.id === id).visible)
    const sc2 = L.parseScene(mkSceneJson(cfg).scene, project)
    const st = L.applyUserProperties(sc2, other, { schema, gated: L.gatedOffNames(schema, other) })
    const b = clockIds(sc2).filter((id) => sc2.layers.find((l) => l.id === id).visible)
    const sc3 = L.parseScene(mkSceneJson(cfg).scene, project)
    L.applyRenderConfig(sc3, { properties: {}, propertiesSchema: schema, hideParticles: true, hideUI: true, log: () => {} })
    const c = clockIds(sc3).filter((id) => sc3.layers.find((l) => l.id === id).visible)
    const sc4 = L.parseScene(mkSceneJson(cfg).scene, project)
    L.applyUserProperties(sc4, {}, { schema, gated: L.gatedOffNames(schema, {}) })
    const d = clockIds(sc4).filter((id) => sc4.layers.find((l) => l.id === id).visible)
    add('C2', V(a) === V([12]) && V(b) === V([12]) && V(c) === V([12]) && V(d) === V([12]),
      V({ 装载_缺键: a, 面板_缺键: b, 装载_空props: c, 面板_空props: d, 面板missing计数: st && st.missing }))
  }
  // C2b（★P-184）状态 (a) vs (b) **可区分**：没有属性表 ⇒ 保持"未知 → 可见"（全部变体可见，
  //   台账记 unknownNoTable）；有表缺键 ⇒ 回落作者默认值（1 个可见，台账记 defaultsUsed）。
  //   两条路径在**两种状态**下都必须一致（容器没有 project.json / 包自带属性为空表都算 (a)）。
  {
    const r = {}
    // (a) 状态必须是**真的没有属性表**：像 demo.html 一样 `parseScene(sceneObj, null)`（scene.properties 也是空的），
    //     另加"空表"（project 在但 properties={}）与"场景带表但调用方没传 schema"（legacy 调用点）两档。
    for (const [tag, cfg, proj] of [
      ['无表（容器没有 project.json）', { defVal: '2' }, null],
      ['空表（project 在但 properties 为空）', { defVal: '2', emptyTable: true }, undefined],
      ['场景带表但调用方没传 schema', { defVal: '2' }, undefined],
    ]) {
      const mk = mkSceneJson(cfg)
      const schema = mk.project.general.properties
      const scL = L.parseScene(JSON.parse(JSON.stringify(mk.scene)), proj === null ? null : mk.project)
      // "场景带表但调用方没传 schema"：schema 走 `scene.properties` 回落（不是 null）
      L.applyRenderConfig(scL, { properties: {}, propertiesSchema: (tag.indexOf('带表') >= 0 ? undefined : null), hideParticles: true, hideUI: true, log: () => {} })
      const scP = L.parseScene(JSON.parse(JSON.stringify(mk.scene)), proj === null ? null : mk.project)
      L.applyUserProperties(scP, {}, tag.indexOf('带表') >= 0 ? {} : { schema: null, gated: new Set() })
      r[tag] = { 装: clockIds(scL).filter((id) => scL.layers.find((l) => l.id === id).visible),
        面: clockIds(scP).filter((id) => scP.layers.find((l) => l.id === id).visible),
        台账: { unknownNoTable: vs(scL).unknownNoTable, defaultsUsed: vs(scL).defaultsUsed, reasons: vs(scL).reasons },
        面板台账: { unknownNoTable: vs(scP).unknownNoTable, defaultsUsed: vs(scP).defaultsUsed } }
    }
    const { scene, project } = mkSceneJson({ defVal: '2' })
    const schema = project.general.properties
    const miss = L.propsDefaults(schema); delete miss.clockstyle
    const scB = L.parseScene(JSON.parse(JSON.stringify(scene)), project)
    L.applyRenderConfig(scB, { properties: miss, propertiesSchema: schema, hideParticles: true, hideUI: true, log: () => {} })
    const bIds = clockIds(scB).filter((id) => scB.layers.find((l) => l.id === id).visible)
    const okA = ['无表（容器没有 project.json）', '空表（project 在但 properties 为空）'].every((k) => r[k].装.length === 3 && r[k].面.length === 3
      && r[k].台账 && r[k].台账.unknownNoTable >= 3 && (r[k].台账.reasons.noTable || 0) >= 3)
      && r['场景带表但调用方没传 schema'].装.length === 1 && r['场景带表但调用方没传 schema'].面.length === 1
      && r['场景带表但调用方没传 schema'].台账.defaultsUsed >= 3
    const okB = V(bIds) === V([12]) && vs(scB).defaultsUsed >= 3 && (vs(scB).reasons.tableDefault || 0) >= 3 && vs(scB).unknownNoTable === 0
    add('C2b', okA && okB, V({ 三档: r, 有表缺键: { ids: bIds, 台账: { unknownNoTable: vs(scB).unknownNoTable, defaultsUsed: vs(scB).defaultsUsed, reasons: vs(scB).reasons } } }))
  }
  // C3 ★门控关 ⇒ 回落 authored；作者存了两个 true ⇒ 同屏两个（P-61 既有口径，本改动不动它）
  {
    const { scene, project } = mkSceneJson({ dupSameCond: true, gate: 'gateprop' })
    const sc = L.parseScene(scene, project)
    const schema = project.general.properties
    const on = Object.assign(L.propsDefaults(schema), { gateprop: true })
    L.applyRenderConfig(sc, { properties: on, propertiesSchema: schema, hideParticles: true, hideUI: true, log: () => {} })
    const gateOn = clockIds(sc).filter((id) => sc.layers.find((l) => l.id === id).visible)
    const off = Object.assign(L.propsDefaults(schema), { gateprop: false })
    L.applyRenderConfig(sc, { properties: off, propertiesSchema: schema, hideParticles: true, hideUI: true, log: () => {} })
    const gateOff = clockIds(sc).filter((id) => sc.layers.find((l) => l.id === id).visible)
    // 面板路径同输入必须同结果（改前面板路径对门控层是"跳过不写"，装载路径是"回落 authored"）
    const scP = L.parseScene(mkSceneJson({ dupSameCond: true, gate: 'gateprop' }).scene, project)
    L.applyUserProperties(scP, off, { schema, gated: L.gatedOffNames(schema, off) })
    const gateOffPanel = clockIds(scP).filter((id) => scP.layers.find((l) => l.id === id).visible)
    add('C3', gateOn.length === 1 && gateOff.length === 2 && V(gateOffPanel) === V(gateOff),
      V({ 门控开: gateOn, 门控关: gateOff, 面板_门控关: gateOffPanel }) + '（门控关 ⇒ authored 回落 ⇒ 两个 true 的层同屏，两条路径一致）')
  }
  // C4（★P-184 **契约变更**）bool 值 + ≥3 condition：一行中文警告（层名 + 属性 + 变体数）+ 组级收口
  //   ⇒ **恰好 1 个**变体可见（改前 `pv === true` 兜底 ⇒ 2 个以上）。两条路径读数一致。
  {
    const logs = []
    const { scene, project } = mkSceneJson()
    const sc = L.parseScene(scene, project)
    const schema = project.general.properties
    const props = Object.assign(L.propsDefaults(schema), { clockstyle: true })
    L.applyRenderConfig(sc, { properties: props, propertiesSchema: schema, hideParticles: true, hideUI: true, log: (m) => logs.push(m) })
    const v1 = clockIds(sc).filter((id) => sc.layers.find((l) => l.id === id).visible)
    const sc2 = L.parseScene(mkSceneJson().scene, project)
    const logs2 = []
    const st2 = L.applyUserProperties(sc2, props, { schema, gated: L.gatedOffNames(schema, props), log: (m) => logs2.push(m) })
    const v2 = clockIds(sc2).filter((id) => sc2.layers.find((l) => l.id === id).visible)
    const warnRe = /^⚠ 可见性：bool 值落在属性「clockstyle」的 3 个 condition 上（层「Clock \d」condition "\d"）—— bool 只有 0\/1 两态/
    const warn1 = logs.filter((m) => warnRe.test(m)).length, warn2 = logs2.filter((m) => warnRe.test(m)).length
    const statsOk = vs(sc).warns === 1 && vs(sc2).warns === 1 && (vs(sc).reasons.boolMulti || 0) === 2
    add('C4', V(v1) === V([11]) && V(v2) === V([11]) && warn1 === 1 && warn2 === 1 && statsOk,
      V({ 装载: v1, 面板: v2, 警告行: warn1 + '/' + warn2, 台账: { warns: vs(sc).warns, reasons: vs(sc).reasons, boolTieBreak: vs(sc).boolTieBreak }, 面板警告: logs2.filter((m) => /bool 值/.test(m))[0] }))
  }
  // C4b（★P-184）bool + 同 condition 重复层（作者在同 condition 存了两层 true）⇒ **绝不 ≥2**
  //   （改前 2 个同屏；改后组级收口只留第一个）。
  {
    const { scene, project } = mkSceneJson({ dupSameCond: true })
    const schema = project.general.properties
    const props = Object.assign(L.propsDefaults(schema), { clockstyle: true })
    const sc = L.parseScene(scene, project)
    L.applyRenderConfig(sc, { properties: props, propertiesSchema: schema, hideParticles: true, hideUI: true, log: () => {} })
    const v = clockIds(sc).filter((id) => sc.layers.find((l) => l.id === id).visible)
    add('C4b', v.length === 1, V(v) + '（同 condition 两层 authored true：组级收口后只留 1 个）')
  }
  // C5 反证：逐帧切换原子 + 幂等 + 每帧恰好 1 个可见
  {
    const { scene, project } = mkSceneJson()
    const schema = project.general.properties
    const base = L.propsDefaults(schema)
    const steps = []
    for (const v of ['1', '2', '3', '1']) steps.push({ path: 'panel', tag: 'switch->' + v, prop: v, props: Object.assign({}, base, { clockstyle: v }), frames: 3 })
    const t = await traceFrames({ sceneJson: scene, project, steps, L })
    console.log('  逐帧台账（面板路径，每格 = 该帧可见的时钟层 id）：')
    for (const r of t.rows) console.log('    frame ' + String(r.frame).padStart(2) + '  ' + r.tag.padEnd(12) + ' n=' + r.n + '  ' + V(r.visible))
    const allOne = t.rows.every((r) => r.n === 1)
    // 原子性：任何相邻两帧的可见集要么完全相同、要么"旧层已隐藏 + 新层出现"同时发生（不允许出现 n≥2 的过渡帧）
    const noOverlap = t.rows.every((r) => r.n <= 1)
    // 幂等：同一 props 连续 apply 10 次，可见集不变
    const sc = L.parseScene(scene, project)
    const props = Object.assign({}, base, { clockstyle: '2' })
    L.applyRenderConfig(sc, { properties: props, propertiesSchema: schema, hideParticles: true, hideUI: true, log: () => {} })
    const once = clockIds(sc).filter((id) => sc.layers.find((l) => l.id === id).visible)
    for (let i = 0; i < 9; i++) L.applyUserProperties(sc, props, { schema, gated: L.gatedOffNames(schema, props) })
    const tenth = clockIds(sc).filter((id) => sc.layers.find((l) => l.id === id).visible)
    add('C5', allOne && noOverlap && V(once) === V(tenth),
      V({ 每帧恰好一层: allOne, 无叠加帧: noOverlap, 幂等: V(once) === V(tenth) }))
  }
  // C6 父链级联完备性（容器不可见 ⇒ 变体不可见；恢复后回来）
  {
    const { scene, project } = mkSceneJson({ dupSameCond: true })
    const sc = L.parseScene(scene, project)
    const schema = project.general.properties
    const props = Object.assign(L.propsDefaults(schema), { clockstyle: '3' })
    L.applyRenderConfig(sc, { properties: props, propertiesSchema: schema, hideParticles: true, hideUI: true, log: () => {} })
    const before = clockIds(sc).filter((id) => sc.layers.find((l) => l.id === id).visible)
    const root = sc.layers.find((l) => l.id === 1)
    root.__visibleRaw = false
    L.applyRenderConfig(sc, { properties: props, propertiesSchema: schema, hideParticles: true, hideUI: true, log: () => {} })
    const off = clockIds(sc).filter((id) => sc.layers.find((l) => l.id === id).visible)
    root.__visibleRaw = true
    L.applyRenderConfig(sc, { properties: props, propertiesSchema: schema, hideParticles: true, hideUI: true, log: () => {} })
    const back = clockIds(sc).filter((id) => sc.layers.find((l) => l.id === id).visible)
    add('C6', before.length === 2 && off.length === 0 && V(back) === V(before), V({ 容器开: before, 容器关: off, 再开: back }))
  }
  // C7 独立对照：本档自复刻的"每层绑定 + 级联"与实现逐位一致（3 组配置 × 6 个取值）
  //   ⚠ P-184 起对照必须带上 `{schema, scene}`（口径同源），否则比的是"旧口径 vs 新口径"。
  {
    let same = 0, total = 0, bad = null
    for (const cfg of [{}, { dupSameCond: true }, { dupSameCond: true, gate: 'gateprop' }]) {
      const { scene, project } = mkSceneJson(cfg)
      const schema = project.general.properties
      for (const pv of ['1', '2', '3', true, false, undefined]) {
        const sc = L.parseScene(JSON.parse(JSON.stringify(scene)), project)
        const props = L.propsDefaults(schema)
        if (pv === undefined) delete props.clockstyle; else props.clockstyle = pv
        L.applyRenderConfig(sc, { properties: props, propertiesSchema: schema, hideParticles: true, hideUI: true, log: () => {} })
        const got = clockIds(sc).filter((id) => sc.layers.find((l) => l.id === id).visible).sort()
        const exp = visibleSet(sc, props, schema, L).ids.filter((id) => clockIds(sc).includes(id)).sort()
        total++
        if (V(got) === V(exp)) same++; else bad = V({ cfg, pv, got, exp })
      }
    }
    add('C7', same === total, same + '/' + total + ' 组一致' + (bad ? ' 例:' + bad : ''))
  }
  // C9（★P-184）台账 `scene.__visStats`：五个契约字段齐备且**四种结局各自计数**
  //   （kept 保留 / hidden 隐藏 / unknownNoTable 无表未知→可见 / defaultsUsed 按作者默认值回落 / warns 警告行），
  //   并发布到浏览器探针面（`window.__mpwVisStats`；Node 里临时造一个 window 验证）。
  {
    const { scene, project } = mkSceneJson({ defVal: '2' })
    const schema = project.general.properties
    const miss = L.propsDefaults(schema); delete miss.clockstyle
    const scB = L.parseScene(JSON.parse(JSON.stringify(scene)), project)
    L.applyRenderConfig(scB, { properties: miss, propertiesSchema: schema, hideParticles: true, hideUI: true, log: () => {} })
    const b = vs(scB)
    const scA = L.parseScene(JSON.parse(JSON.stringify(scene)), { general: { properties: {} } })
    L.applyRenderConfig(scA, { properties: {}, propertiesSchema: null, hideParticles: true, hideUI: true, log: () => {} })
    const a = vs(scA)
    const keysOk = b && ['kept', 'hidden', 'unknownNoTable', 'defaultsUsed', 'warns'].every((k) => typeof b[k] === 'number')
    const bOk = keysOk && b.kept === 1 && b.hidden === 2 && b.bound === 3 && b.unknownNoTable === 0 && b.defaultsUsed === 3 && b.warns === 0
    const aOk = a && a.kept === 3 && a.hidden === 0 && a.unknownNoTable === 3 && a.defaultsUsed === 0
    const scP = L.parseScene(JSON.parse(JSON.stringify(scene)), project)
    const prevWin = globalThis.window
    globalThis.window = {}
    let winOk = false
    try {
      L.applyUserProperties(scP, miss, { schema, gated: L.gatedOffNames(schema, miss) })
      const pv = scP.__visStats || null
      winOk = !!(globalThis.window.__mpwVisStats && pv && globalThis.window.__mpwVisStats.defaultsUsed === 3 && globalThis.window.__mpwVisStats === pv)
    } finally { if (prevWin === undefined) delete globalThis.window; else globalThis.window = prevWin }
    add('C9', keysOk && bOk && aOk && winOk, V({ 有表缺键: b && { kept: b.kept, hidden: b.hidden, unknownNoTable: b.unknownNoTable, defaultsUsed: b.defaultsUsed, warns: b.warns, bound: b.bound }, 无表: a && { kept: a.kept, hidden: a.hidden, unknownNoTable: a.unknownNoTable, defaultsUsed: a.defaultsUsed }, window探针: winOk }))
  }
  // C10（★P-184 要求 4）**没有任何用户属性**（空属性表 / 空 props）时两条路径都不炸且结果一致：
  //   容器拿不到属性表 = 状态 (a) ⇒ 保持"未知 → 可见"（改前改后同一条 legacy 口径）。
  {
    const { scene, project } = mkSceneJson({ emptyTable: true })
    const scL = L.parseScene(JSON.parse(JSON.stringify(scene)), project)
    L.applyRenderConfig(scL, { properties: {}, propertiesSchema: null, hideParticles: true, hideUI: true, log: () => {} })
    const l = clockIds(scL).filter((id) => scL.layers.find((x) => x.id === id).visible)
    const scP = L.parseScene(JSON.parse(JSON.stringify(scene)), project)
    L.applyUserProperties(scP, {}, { schema: null })
    const p = clockIds(scP).filter((id) => scP.layers.find((x) => x.id === id).visible)
    const scQ = L.parseScene(JSON.parse(JSON.stringify(scene)), project)
    L.applyUserProperties(scQ, {}, {})                       // 连 opts 都不给（旧调用点的最窄形态）
    const q = clockIds(scQ).filter((id) => scQ.layers.find((x) => x.id === id).visible)
    add('C10', V(l) === V(p) && V(p) === V(q) && l.length === 3, V({ 装载: l, 面板: p, 面板无opts: q }))
  }
  // C11（★P-184）"回落作者默认值"的两种形态必须区分：
  //   ① 表里**定义**了这个键（只是 props 缺）⇒ 用属性组默认值（`defVal`）选变体；
  //   ② 表里**没有**这个键（被改名/跨包引用）⇒ 用本层 authored value。
  //   本用例：默认值 "2"、authored true 在第 1 档 ⇒ ① 得 [12]、② 得 [11]，两者必须不同。
  {
    const s1 = mkSceneJson({ defVal: '2' })
    const schema1 = s1.project.general.properties
    const miss = L.propsDefaults(schema1); delete miss.clockstyle
    const sc1 = L.parseScene(JSON.parse(JSON.stringify(s1.scene)), s1.project)
    L.applyRenderConfig(sc1, { properties: miss, propertiesSchema: schema1, hideParticles: true, hideUI: true, log: () => {} })
    const r1 = clockIds(sc1).filter((id) => sc1.layers.find((l) => l.id === id).visible)
    const s2 = mkSceneJson({ defVal: '2', noKeyInTable: true })
    const schema2 = s2.project.general.properties
    const sc2 = L.parseScene(JSON.parse(JSON.stringify(s2.scene)), s2.project)
    L.applyRenderConfig(sc2, { properties: L.propsDefaults(schema2), propertiesSchema: schema2, hideParticles: true, hideUI: true, log: () => {} })
    const r2 = clockIds(sc2).filter((id) => sc2.layers.find((l) => l.id === id).visible)
    const t1 = vs(sc1), t2 = vs(sc2)
    add('C11', V(r1) === V([12]) && (t1.reasons.tableDefault || 0) === 3 && (t1.reasons.authoredDefault || 0) === 0
      && V(r2) === V([11]) && (t2.reasons.authoredDefault || 0) === 3 && (t2.reasons.tableDefault || 0) === 0,
      V({ 表里有键缺props: { ids: r1, reasons: t1.reasons }, 表里没这个键: { ids: r2, reasons: t2.reasons } }))
  }
  // C12（★P-184）父容器被**绑定**关掉时两条路径一致：装载路径 RE-06 级联隐藏子层；面板路径
  //   改前没有这一步 ⇒ "改任何一个属性"就会把子层写回可见（真语料 `dd/3660962877` 实测：
  //   装载 1 个时钟 → 面板改动后 **2 个**）。改后两条路径都是 [0 个]（父关 ⇒ 子关）。
  {
    const { scene, project } = mkSceneJson({ defVal: '1', hideParent: true })
    const schema = project.general.properties
    const props = Object.assign(L.propsDefaults(schema), { blockprop: '1' })     // cond "0" ≠ "1" ⇒ 父层不可见
    const scL = L.parseScene(JSON.parse(JSON.stringify(scene)), project)
    L.applyRenderConfig(scL, { properties: props, propertiesSchema: schema, hideParticles: true, hideUI: true, log: () => {} })
    const l = clockIds(scL).filter((id) => scL.layers.find((x) => x.id === id).visible)
    const scP = L.parseScene(JSON.parse(JSON.stringify(scene)), project)
    L.applyUserProperties(scP, props, { schema, gated: L.gatedOffNames(schema, props) })
    const p = clockIds(scP).filter((id) => scP.layers.find((x) => x.id === id).visible)
    const scS = L.parseScene(JSON.parse(JSON.stringify(scene)), project)
    L.applyRenderConfig(scS, { properties: props, propertiesSchema: schema, hideParticles: true, hideUI: true, log: () => {} })
    L.applyUserProperties(scS, props, { schema, gated: L.gatedOffNames(schema, props) })
    const seq = clockIds(scS).filter((id) => scS.layers.find((x) => x.id === id).visible)
    add('C12', l.length === 0 && p.length === 0 && seq.length === 0,
      V({ 装载: l, 面板: p, 装载后再面板: seq, 面板台账: { cascaded: vs(scP).cascaded } }))
  }
  return out
}

// ═════════════════════════ 4 跑真模块 ═════════════════════════════════════════════════════
console.log('[C] 合成场景（3 变体时钟；形状照抄真语料 0917/3448877775 的 `b1`、dd/3660962877 的 `b1`）')
const realChecks = await coreChecks(lib)
for (const c of realChecks) ok(c.id, c.ok, c.detail)

// ═════════════════════════ 5 语料核对（真实 scene.json + 真实 project.json）════════════════
console.log('[C8] 语料核对：同组 ≥3 condition 的时钟变体组，逐取值数"同屏几个时钟簇"')
if (NO_CORPUS) skip('--no-corpus')
else {
  const CORPUS = process.env.MPW_SCENE_ROOT || path.join(WS, 'allwallpaper')
  if (!fs.existsSync(CORPUS)) skip('无 ' + CORPUS)
  else {
    const res = scanClockGroups(CORPUS, { maxFiles: Number(process.env.MPW_CLOCK_MAX || 260), maxBytes: 16 << 20 })
    console.log('  扫过容器 ' + res.walked + ' 个（含 scene.json ' + res.withScene + '、有 project.json ' + res.withProj + '、异常 ' + res.skipped.length + '）')
    console.log('  时钟变体组（≥3 condition）：' + res.groups.length + ' 组，涉及 ' + res.pkgs + ' 个包')
    const worst = res.groups.slice().sort((a, b) => b.maxMissing - a.maxMissing).slice(0, 5)
    for (const g of worst) {
      console.log('    ' + g.file.slice(0, 46) + ' prop=' + g.prop + ' type=' + g.type + ' value=' + g.value + ' cond=' + g.condition
        + ' variants=' + g.variants + ' → 完整 props 各取值簇数 ' + V(g.byValue) + ' / 缺键 ' + g.missing + ' / 门控关 ' + (g.gated === null ? '-' : g.gated))
    }
    const actGroups = res.groups.filter((g) => Object.keys(g.byValueActive).length > 0 && g.hasProj)
    const badActive = actGroups.filter((g) => Object.values(g.byValueActive).some((n) => n > 1))
    if (badActive.length) for (const g of badActive) console.log('    ★C8a 例外: ' + g.file + ' prop=' + g.prop + ' ' + V(g.byValueActive))
    ok('C8a 包内有 project.json 且属性未被门控时：完整 props 下每个取值 ≤1 个时钟簇（' + actGroups.length + '/' + res.groups.length + ' 组可测）',
      actGroups.length > 0 && badActive.length === 0,
      badActive.slice(0, 3).map((g) => g.file.slice(-30) + ':' + g.prop + V(g.byValueActive)).join('  '))
    // 无 project.json 的包（含 scene.json 的容器里绝大多数）：整张属性表缺失 ⇒ 连**父容器**的绑定都落回"未知 → 可见"
    const noProj = res.groups.filter((g) => !g.hasProj)
    const noProjMulti = noProj.filter((g) => Object.values(g.byValue).some((n) => n >= 2))
    console.log('    无 project.json 的组：' + noProj.length + '/' + res.groups.length
      + '（其中每取值 ≥2 个时钟簇的 ' + noProjMulti.length + ' 组）—— 含 scene.json 的容器共 ' + res.withScene + ' 个，其中带 project.json 的只有 ' + res.withProj + ' 个')
    if (noProjMulti.length) console.log('      例: ' + noProjMulti.slice(0, 3).map((g) => g.file.slice(-34) + ':' + g.prop + V(g.byValue)).join(' | '))
    ok('C8b ★真语料"整张属性表缺失 ⇒ 同屏 ≥2 个时钟"：' + noProjMulti.length + ' 组（且缺单个键也有 ' + res.groups.filter((g) => g.missing >= 2).length + ' 组）',
      noProjMulti.length > 0, noProjMulti.slice(0, 2).map((g) => g.file.slice(-34) + ':' + g.prop + V(g.byValue)).join('  '))
    const gatedSeen = res.groups.filter((g) => g.gated !== null)
    const gatedRep = gatedSeen.filter((g) => g.gated >= 2)
    ok('C8c 门控关 ⇒ 回落 authored 的**机制**在真语料里可测（' + gatedSeen.length + ' 组命中门控；其中回落成 ≥2 个的 ' + gatedRep.length + ' 组）',
      gatedSeen.length > 0,
      gatedSeen.slice(0, 3).map((g) => g.file.slice(-34) + ':' + g.prop + '→' + g.gated + '（active ' + V(g.byValueActive) + '）').join('  ') + '｜本机语料 0 组因此 ≥2')
    const dup = res.groups.filter((g) => g.dupCond.length > 0 && Object.values(g.byValue).some((n) => n > 1))
    console.log('  同 condition 重复层的组（数据层"两个时钟"形态）：' + dup.length + ' 组'
      + (dup.length ? ' 例: ' + dup.slice(0, 3).map((g) => g.file.slice(-26) + ':' + g.prop + ' dup=' + V(g.dupCond) + ' 簇=' + V(g.byValue)).join(' | ') : ''))
    ok('C8d ★真语料里存在"同一 condition 下两层都 visible、且各自父容器都可见"的组（数据层成因，非渲染器）：' + dup.length + ' 组',
      dup.length > 0, dup.slice(0, 2).map((g) => g.file.slice(-26) + ':' + g.prop + ' ' + V(g.dupCond)).join('  '))
    /* C8e（★P-184 改动读数）**有属性表但 props 缺这个键**（= 键被改名/属性表换了版本）：
       改前每条 condition 全命中（`evalVisibleWithProps` 的"未知 → 可见"）⇒ 真语料 23 组同屏 ≥2；
       改后按属性组默认值回落 ⇒ 同屏 ≤1（默认值那一条 condition 命中；若默认值在语料里根本没有对应层
       ⇒ 0 个，例如 `newproperty3` 默认 "0" 而层是 1..8 —— 这是"属性停在默认值时"的忠实读数）。
       `legacy` 列用 helper 的显式 `hasTable:false` 分支复算改前口径（改前那条 `if (!has) return true`）。 */
    const withT = res.groups.filter((g) => g.hasProj), noT = res.groups.filter((g) => !g.hasProj)
    const legacyMissing = withT.filter((g) => g.missingLegacy >= 2).length
    const nowMissing = withT.filter((g) => g.missing >= 2).length
    const noTMissing = noT.filter((g) => g.missing >= 2).length
    const sibT = res.groups.filter((g) => g.sibling)
    console.log('  缺该键时同屏 ≥2 簇的组：**有属性表**的 ' + withT.length + ' 组里 改前口径 ' + legacyMissing + ' → 改后 ' + nowMissing
      + '；**没有属性表**（状态 a）的 ' + noT.length + ' 组里改后仍有 ' + noTMissing + ' 组 ≥2'
      + '（按设计保持"未知 → 可见"；这就是 C8b 那条残留，台账记 unknownNoTable）')
    console.log('    容器里另有**同级** project.json（官方工坊布局，demo 的 /project/<id> 找的就是它）的组：' + sibT.length
      + ' 组 —— 例 ' + sibT.slice(0, 3).map((g) => g.file.slice(-30) + ':' + g.prop + ' 同级表默认=' + JSON.stringify(g.value)).join(' | '))
    ok('C8e ★真语料"属性表在、props 缺键"不再同屏 ≥2（有表的 ' + withT.length + ' 组）：改前口径 ' + legacyMissing + ' → 改后 ' + nowMissing
      + '；无表的 ' + noT.length + ' 组按 (a) 保持可见（' + noTMissing + ' 组 ≥2）',
      legacyMissing > 0 && nowMissing === 0 && noTMissing === noT.filter((g) => g.missingLegacy >= 2).length,
      withT.filter((g) => g.missingLegacy !== g.missing).slice(0, 4).map((g) => g.file.slice(-30) + ':' + g.prop + ' ' + g.missingLegacy + '→' + g.missing).join('  '))
  }
}

// ═════════════════════════ 5b 改前读数（钉死提交，**不是** HEAD）═══════════════════════════════
// P-181 ⑥ 的教训：`git show HEAD:` 在提交落地后就等于"改后" ⇒ 变异体与真树逐字相同、红集恒空。
// 这里钉死 PRE_CHANGE_COMMIT（改动前的 HEAD），拿它的 core/we-scene-bundle.js 实测**改前两条路径
// 对"缺键"的读数**（装载 `[11,12,13]` vs 面板 `[11]`）——不是本档口述，是跑出来的。
{
  const pre = await (async () => {
    try {
      const src = execFileSync('git', ['show', PRE_CHANGE_COMMIT + ':core/we-scene-bundle.js'], { cwd: ROOT, maxBuffer: 64 << 20 }).toString('utf8')
      const tmp = path.join(os.tmpdir(), 'ckpre-' + PRE_CHANGE_COMMIT + '.mjs')
      fs.rmSync(tmp, { force: true })
      fs.writeFileSync(tmp, src.replace(/from '\.\//g, `from '${path.join(ROOT, 'core')}/`))
      const m = await import('file://' + tmp + '?v=' + Date.now())
      fs.rmSync(tmp, { force: true })
      return m
    } catch (e) {
      console.log('  ✗ 取不到钉死提交 ' + PRE_CHANGE_COMMIT + ' 的 core/we-scene-bundle.js：' + String(e && e.message).slice(0, 140))
      return null
    }
  })()
  if (!pre) {
    ok('C2-pre 改前读数（钉死 ' + PRE_CHANGE_COMMIT + '：装载 [11,12,13] vs 面板 [11]，两条路径分叉）', false, '钉死提交取不到（浅克隆？）⇒ 不静默跳过')
  } else {
    const cfg = { defVal: '2', authoredIndex: 0 }
    const { scene, project } = mkSceneJson(cfg)
    const schema = project.general.properties
    const other = pre.propsDefaults(schema); delete other.clockstyle
    const sc = pre.parseScene(scene, project)
    pre.applyRenderConfig(sc, { properties: other, propertiesSchema: schema, hideParticles: true, hideUI: true, log: () => {} })
    const oldLoad = clockIds(sc).filter((id) => sc.layers.find((l) => l.id === id).visible)
    const sc2 = pre.parseScene(mkSceneJson(cfg).scene, project)
    pre.applyUserProperties(sc2, other, { schema, gated: pre.gatedOffNames(schema, other) })
    const oldPanel = clockIds(sc2).filter((id) => sc2.layers.find((l) => l.id === id).visible)
    // 同一输入、改后两条路径（本档 C2 已断言）：三边必须两两不同 —— 改前分叉、改后收敛
    const nLoad = (() => { const s = lib.parseScene(mkSceneJson(cfg).scene, project); lib.applyRenderConfig(s, { properties: other, propertiesSchema: schema, hideParticles: true, hideUI: true, log: () => {} }); return clockIds(s).filter((id) => s.layers.find((l) => l.id === id).visible) })()
    const nPanel = (() => { const s = lib.parseScene(mkSceneJson(cfg).scene, project); lib.applyUserProperties(s, other, { schema, gated: lib.gatedOffNames(schema, other) }); return clockIds(s).filter((id) => s.layers.find((l) => l.id === id).visible) })()
    ok('C2-pre 改前读数（钉死 ' + PRE_CHANGE_COMMIT + '）：装载 ' + V(oldLoad) + ' ≠ 面板 ' + V(oldPanel)
      + '；改后两条路径都为 ' + V(nLoad) + '（= 属性组默认值 "2" 那一档）',
      V(oldLoad) === V([11, 12, 13]) && V(oldPanel) === V([11]) && V(nLoad) === V([12]) && V(nPanel) === V([12]),
      V({ 改前装载: oldLoad, 改前面板: oldPanel, 改后装载: nLoad, 改后面板: nPanel }))
  }
}

// ═════════════════════════ 6 变异自证（RED-IF-REVERTED）═══════════════════════════════════
if (NO_MUT) console.log('[M] SKIP（--no-mutation）')
else {
  console.log('[M] RED-IF-REVERTED：真源码逐条改回旧写法（副本落 /tmp，真树只读）')
  const SRC_FILE = path.join(ROOT, 'core', 'we-scene-bundle.js')
  const CORE = path.dirname(SRC_FILE)
  const SRC = fs.readFileSync(SRC_FILE, 'utf8')
  const shaOf = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
  const srcSha = shaOf(SRC_FILE)
  const mutants = [
    // N1：把 (b)"有表缺键 ⇒ 回落作者默认值"整条退回"未知 → 可见"（= 改前那份口径）
    { label: 'N1(缺键回落作者默认值 → 退回"未知即全部可见")', expect: ['C2', 'C2b', 'C9', 'C11'],
      pairs: [['    const d = authorDefaultVisible(schema, name, cond, raw)\n    return { visible: d.visible, reason: d.from === \'table\' ? \'tableDefault\' : \'authoredDefault\', name, cond }',
        '    return { visible: true, reason: \'noTable\', name, cond }   // MUTANT']] },
    // N2：面板路径重新"跳过缺键/门控"（改前的 `continue`）⇒ 两条路径再次分叉（C2/C12 必红）
    { label: 'N2(面板路径不再写缺键/门控层的可见性)', expect: ['C2', 'C2b', 'C9', 'C10'],
      pairs: [
        ['        if (key !== \'visible\') continue\n      } else if', '        continue   // MUTANT\n      } else if'],
        ['        if (key !== \'visible\') continue\n      }\n      if (key === \'visible\') {', '        continue   // MUTANT\n      }\n      if (key === \'visible\') {'],
      ] },
    // N3：bool 值重新按 `pv === true` 兜底（除 "1" 以外全命中 ⇒ 同屏 ≥2）
    { label: 'N3(bool 值对非 0/1 的 condition 重新兜底 pv===true)', expect: ['C4', 'C4b', 'C7'],
      pairs: [['    if (c === \'\') return pv === true\n    return null',
        '    if (c === \'\') return pv === true\n    return pv === true   // MUTANT']] },
    // N4：去掉组级收口（同组不强制 ≤1）
    { label: 'N4(去掉 bool 变体组的组级收口)', expect: ['C4', 'C4b', 'C7'],
      pairs: [['      for (const l of group) { const want = (l === hit); if (l.visible !== want) { l.visible = want; t.boolTieBreak++ } }',
        '      // MUTANT: 去掉组级收口']] },
    // N5：被门控关闭的属性按"可见"而不是回落 authored（P-61 那条口径）
    { label: 'N5(被门控关闭的属性仍按"可见"而不是回落 authored)', expect: ['C3'],
      pairs: [['  if (gated && gated.has(name)) return { visible: authored, reason: \'gatedDefault\', name, cond }',
        '  if (gated && gated.has(name)) return { visible: true, reason: \'gatedDefault\', name, cond }   // MUTANT']] },
    // N6：RE-06 去掉父链级联
    { label: 'N6(RE-06 去掉父链级联)', expect: ['C6', 'C12'],
      pairs: [['      if (vis && l.parent !== undefined && l.parent !== null) {\n        const par = byId.get(l.parent)\n        if (par && !visibleOf(par)) vis = false\n      }',
        '      // MUTANT: 去掉父链级联']] },
    // N7：面板路径去掉父链收口（真语料 dd/3660962877 实测：装载 1 个时钟 → 面板 2 个）
    { label: 'N7(面板路径去掉"绑定祖先隐藏 ⇒ 子层隐藏"的收口)', expect: ['C12'],
      pairs: [['  cascadeBoundParents(scene, boundVis, vis)', '  // MUTANT: 去掉父链收口']] },
    // N8：面板路径不再发布台账
    { label: 'N8(面板路径不发布 scene.__visStats)', expect: ['C4', 'C9'],
      pairs: [['  stats.vis = publishVisStats(scene, vis)',
        '  stats.vis = { kept: 0, hidden: 0, unknownNoTable: 0, defaultsUsed: 0, warns: 0 }   // MUTANT：不发布']] },
  ]
  for (const mu of mutants) {
    let body = SRC, missing = null
    for (const [from, to] of mu.pairs) {
      if (!body.includes(from)) { missing = from; break }
      body = body.replace(from, to)
    }
    if (missing) { failN++; console.log('  ✗ ' + mu.label + ' 变异锚点不在源码里：' + V(String(missing).slice(0, 70))); continue }
    const tmp = path.join(os.tmpdir(), 'ckmut-' + mu.label.replace(/[^A-Za-z0-9]/g, '').slice(0, 20) + '.mjs')
    fs.rmSync(tmp, { force: true })
    fs.writeFileSync(tmp, body.replace(/from '\.\//g, `from '${CORE}/`))
    let red = [], detail = ''
    try {
      const mm = await import('file://' + tmp + '?v=' + Date.now() + Math.random())
      const got = await coreChecks(mm)
      red = got.filter((c) => !c.ok).map((c) => c.id)
      detail = got.filter((c) => !c.ok).map((c) => c.id + '(' + c.detail + ')').join(' ')
    } catch (e) { detail = '变异体跑挂：' + String(e && e.message).slice(0, 140) }
    finally { fs.rmSync(tmp, { force: true }) }
    const exp = mu.expect.join(','), act = red.join(',')
    ok('MUTANT-RED-OK｜' + mu.label + '：期望红集 [' + exp + '] == 实际红集 [' + act + ']', exp === act, detail.slice(0, 200))
  }
  const leftovers = fs.readdirSync(os.tmpdir()).filter((f) => /^ckmut-.*\.mjs$/.test(f))
  ok('M-end 真树 core/we-scene-bundle.js 跑前跑后 sha256 相同（副本落 /tmp 且已 unlink）',
    shaOf(SRC_FILE) === srcSha && leftovers.length === 0, 'sha相同=' + (shaOf(SRC_FILE) === srcSha) + ' /tmp残留=' + leftovers.length)
}

// ═════════════════════════ 7 语料扫描实现（有界读；本档独立实现，不复用他档）════════════════
function scanClockGroups(root, { maxFiles = 260, maxBytes = 16 << 20 } = {}) {
  const out = { walked: 0, withScene: 0, withProj: 0, skipped: [], groups: [], pkgs: 0 }
  const files = []
  ;(function walk(d, dep) {
    if (dep > 3 || files.length >= maxFiles) return
    let ents = []
    try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (files.length >= maxFiles) return
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p, dep + 1)
      else if (/\.(pkg|mpkg)$/i.test(e.name)) files.push(p)
    }
  })(root, 0)
  for (const p of files) {
    out.walked++
    let sceneRaw = null, projRaw = null
    try { sceneRaw = readPkgEntry(p, 'scene.json', maxBytes) } catch (e) { out.skipped.push(path.basename(p)); continue }
    if (sceneRaw === null) continue
    out.withScene++
    try { projRaw = readPkgEntry(p, 'project.json', maxBytes) } catch (e) { projRaw = null }
    let j = null, proj = null
    try { j = JSON.parse(sceneRaw) } catch (e) { out.skipped.push(path.basename(p) + ':scene'); continue }
    if (projRaw) { try { proj = JSON.parse(projRaw); out.withProj++ } catch (e) { proj = null } }
    const schema = (proj && ((proj.general && proj.general.properties) || proj.properties)) || {}
    const objs = j.objects || []
    const clocks = objs.filter((o) => o.visible && typeof o.visible === 'object' && o.visible.user && typeof o.visible.user === 'object'
      && /clock|时间/i.test(String(o.name || '')))
    const byProp = new Map()
    for (const o of clocks) { const k = String(o.visible.user.name); if (!byProp.has(k)) byProp.set(k, []); byProp.get(k).push(o) }
    let pkgHit = false
    for (const [name, arr] of byProp) {
      const conds = [...new Set(arr.map((o) => String(o.visible.user.condition)))]
      if (conds.length < 3) continue
      const def = schema[name] || null
      const opts = def && def.options ? def.options.map((o) => o && o.value).filter((x) => x !== undefined) : conds
      const props0 = lib.propsDefaults(schema)
      // ⚠ P-184：求值必须带上属性表（`{schema, hasTable}`），否则量到的是"旧口径"而不是被测实现。
      const evalCount = (props, opts2) => {
        const gated = lib.gatedOffNames(schema, props)
        const byId = new Map(objs.filter((o) => o.id !== undefined).map((o) => [o.id, o]))
        const cache = new Map()
        const visOf = (l) => {
          if (cache.has(l.id)) return cache.get(l.id)
          cache.set(l.id, true)
          let v = (l.visible === undefined) ? true
            : lib.evalVisibleWithProps(l.visible, props, gated, opts2 || { schema, hasTable: Object.keys(schema).length > 0 })
          if (v && l.parent !== undefined && l.parent !== null) { const par = byId.get(l.parent); if (par && !visOf(par)) v = false }
          cache.set(l.id, v); return v
        }
        const shown = arr.filter((o) => visOf(o))
        // 簇 = 去掉"祖先也在 shown 里"的层（父/子同属一个时钟）
        const roots = shown.filter((o) => { let q = o.parent; while (q !== undefined && q !== null) { const par = byId.get(q); if (!par) break; if (shown.includes(par)) return false; q = par.parent } return true })
        return roots.length
      }
      const byValue = {}, byValueActive = {}
      for (const v of opts) {
        const props = Object.assign({}, props0); props[name] = lib.normalizePropValue(def && def.type, v, v)
        const isGated = lib.gatedOffNames(schema, props).has(name)
        byValue[String(v)] = evalCount(props)
        if (!isGated) byValueActive[String(v)] = byValue[String(v)]
      }
      const noKey = Object.assign({}, props0); delete noKey[name]
      let gated = null
      if (def && def.condition) {
        const dep = lib.propConditionNames(String(def.condition))[0]
        if (dep) {
          for (const v of (schema[dep] && schema[dep].options ? schema[dep].options.map((o) => o.value) : ['0', '1'])) {
            const props = Object.assign({}, props0); props[dep] = lib.normalizePropValue(schema[dep] && schema[dep].type, v, v)
            if (lib.gatedOffNames(schema, props).has(name)) { gated = evalCount(props); break }
          }
        }
      }
      const dupCond = (() => { const m = new Map(); for (const o of arr) { const c = String(o.visible.user.condition); m.set(c, (m.get(c) || 0) + 1) } return [...m.entries()].filter(([, n]) => n > 1).map(([c, n]) => c + '×' + n) })()
      out.groups.push({ file: p, hasProj: !!proj, sibling: fs.existsSync(path.join(path.dirname(p), 'project.json')), prop: name, type: def && def.type, value: def && def.value, condition: (def && def.condition) || null,
        variants: arr.length, byValue, byValueActive, dupCond, missing: evalCount(noKey),
        // 改前口径（helper 的显式 `hasTable:false` 分支 = 旧 `if (!has) return true`）：缺键时全部命中
        missingLegacy: evalCount(noKey, { schema: null, hasTable: false }), gated })
      pkgHit = true
    }
    if (pkgHit) out.pkgs++
  }
  return out
}
/** 只读容器目录表 + 指定条目（内存有界；条目绝对偏移 = 目录表结束位置 + entry.offset）。 */
function readPkgEntry(file, want, maxBytes) {
  const fd = fs.openSync(file, 'r')
  try {
    const h = Buffer.alloc(4); fs.readSync(fd, h, 0, 4, 0)
    const ml = h.readUInt32LE(0)
    if (!(ml >= 1 && ml <= 64)) throw new Error('magicLen 异常')
    const mb = Buffer.alloc(ml); fs.readSync(fd, mb, 0, ml, 4)
    if (!/^(PKGV|PKGM|v\d)/i.test(mb.toString('latin1'))) throw new Error('非 PKG 容器')
    const cb = Buffer.alloc(4); fs.readSync(fd, cb, 0, 4, 4 + ml)
    const count = cb.readUInt32LE(0)
    if (count > 200000) throw new Error('入口数异常')
    let pos = 8 + ml, hit = null
    for (let i = 0; i < count; i++) {
      const nb = Buffer.alloc(4); fs.readSync(fd, nb, 0, 4, pos); pos += 4
      const nl = nb.readUInt32LE(0)
      const nbuf = Buffer.alloc(nl); fs.readSync(fd, nbuf, 0, nl, pos); pos += nl
      const ob = Buffer.alloc(8); fs.readSync(fd, ob, 0, 8, pos); pos += 8
      if (nbuf.toString('utf8') === want) hit = { offset: ob.readUInt32LE(0), size: ob.readUInt32LE(4) }
    }
    const tableEnd = pos
    if (!hit) return null
    if (hit.size > maxBytes) throw new Error('条目过大')
    const b = Buffer.alloc(hit.size); fs.readSync(fd, b, 0, hit.size, tableEnd + hit.offset)
    return b.toString('utf8').replace(/^\uFEFF/, '')
  } finally { fs.closeSync(fd) }
}

console.log('\n===== clock-combo-visible: ' + passN + ' 通过 / ' + failN + ' 失败 =====')
if (fails.length) console.log('失败项：\n  - ' + fails.join('\n  - '))
process.exit(failN ? 1 : 0)
