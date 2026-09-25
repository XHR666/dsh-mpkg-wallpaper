// tools/props-panel-wiring-test.mjs —— 插件设置里「WE 自带壁纸选项」面板的**离线判据**
//
// 背景（用户报的 bug，2026-09-24）：
//   用户原话「壁纸配置里面 we 自带的选项，它是打不开的……他这里只显示了有一项，而且展不开。
//   他那个自带的一些设置，是针对每一个壁纸都有的」。
//   根因：面板把官方 `project.json → general.properties` 当**只读清单**、且**默认折叠**成一个
//   「展开全部（N）」按钮（`propsToShow = propsExpanded ? propsShown : []`）⇒ 用户只看到一项、
//   展不开；`group` / `condition` / `min·max·step` 全被 `extractProjectInfo` 丢掉；写好可调通道的
//   `setProp()` 是**死代码**（0 处调用）⇒ 选项根本不可调。
//
// 本测试断言（离线、无浏览器；桩 React + 真包语料）：
//   A 语料/模型：全字段保留、分组归属、condition 显隐（含白名单外按"未知"照显示）
//   B 面板：默认展开（该显示 N 项就 N 项）、分组可折叠、每类控件到位、控件**真的写进 propEdits**
//   C 变异：把修复改回去 ⇒ 上面必红（逐条读数打印）
// 用法: node tools/props-panel-wiring-test.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPlugin } from './_stub.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(here, '..')
const CLIENT = path.join(ROOT, 'lib', 'client.js')
const WS = path.join(ROOT, '..')   // 工作区根（语料在 <ws>/allwallpaper）

let pass = 0, fail = 0
const fails = []
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; fails.push(name); console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}

/* ── 真实语料：有 group + condition 的真包（缺语料则整段 SKIP，门禁不红） ── */
const REAL = path.join(WS, 'allwallpaper', '0917', '3509243656', 'project.json')
const REAL_B = path.join(WS, 'allwallpaper', '0917', '3195212886', 'project.json')
const hasCorpus = fs.existsSync(REAL)

/* ══════════ 源码切片：纯函数（模型/解析）——与 lib 同源，改哪断言哪 ══════════ */
function sliceComment(src, beginMark, endMark) {
  const b = src.indexOf(beginMark)
  if (b < 0) throw new Error('缺少标记块 ' + beginMark)
  const i = src.lastIndexOf('/*', b)
  const e = src.indexOf('*/', src.indexOf(endMark, b))
  return src.slice(i, e + 2)
}
function sliceFn(src, name) {
  const i = src.indexOf('function ' + name + '(')
  if (i < 0) throw new Error('缺少函数 ' + name)
  let d = 0, started = false
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') { d++; started = true }
    else if (src[j] === '}') { d--; if (started && d === 0) return src.slice(i, j + 1) }
  }
  throw new Error('函数体不配平 ' + name)
}
function loadPure(src) {
  const code = [
    sliceComment(src, 'MPW-WEJSON-BEGIN', 'MPW-WEJSON-END'),
    sliceFn(src, 'cleanLabel'), sliceFn(src, 'safePropKey'), sliceFn(src, 'extractProjectInfo'),
    sliceComment(src, 'MPW-PROPS-MODEL-BEGIN', 'MPW-PROPS-MODEL-END'),
    sliceFn(src, 'mpwPropColorToHex'), sliceFn(src, 'mpwPropHexToColor'),
  ].join('\n')
  return new Function(code + '\n;return { extractProjectInfo, mpwPropsModel, mpwPropCondEval, mpwPropKind, mpwPropColorToHex, mpwPropHexToColor };')()
}

/* ══════════ 挂载面板：桩 React（hook 游标每轮归零 = 真 React 的按序语义） ══════════ */
function loadWorld(srcText) {
  const tmp = path.join(os.tmpdir(), 'mpw-props-test-' + process.pid + '-' + Math.random().toString(36).slice(2) + '.js')
  fs.writeFileSync(tmp, srcText)
  // 插件自身的三个**幂等守卫**必须清掉（module 顶层 __mpwClientLoaded、apply 的 __mpwAppliedOnce、
  // 注册的 __mpwRegistered）——否则第二个"世界"（变异跑）拿不到 sectionComp/注册被跳过。
  for (const k of ['__mpwAppliedOnce', '__mpwClientLoaded', '__mpwRegistered', '__mpwRegisteredIds', '__mpwRegisterErr']) { try { delete globalThis[k] } catch {} }
  let world
  try { world = loadPlugin({ clientPath: tmp, quiet: true }) } finally { try { fs.unlinkSync(tmp) } catch {} }
  const state = []
  let cursor = 0
  world.react.useState = (init) => {
    const i = cursor++
    if (state[i] === undefined) state[i] = typeof init === 'function' ? init() : init
    return [state[i], (v) => { state[i] = typeof v === 'function' ? v(state[i]) : v }]
  }
  const render = (props) => { cursor = 0; return world.sectionComp(Object.assign({ t: (k) => k, close: () => {} }, props || {})) }
  const ls = () => { try { return JSON.parse(globalThis.localStorage.getItem('dsh.mpkg-wallpaper.v2') || '{}') } catch { return {} } }
  return { world, render, ls, state }
}
function walk(n, out = [], depth = 0) {
  if (!n || depth > 8) return out
  if (Array.isArray(n)) { for (const x of n) walk(x, out, depth); return out }
  const stub = { t: (k) => k, checked: false, onChange() {}, options: [], value: '', name: '', placeholder: '' }
  if (typeof n === 'function') { try { walk(n(stub), out, depth + 1) } catch (e) {} return out }
  if (typeof n !== 'object') return out
  if (typeof n.type === 'function') { try { walk(n.type(Object.assign({}, stub, n.props || {})), out, depth + 1) } catch (e) {} return out }
  if (n.__el) out.push(n)
  if (n.kids) walk(n.kids, out, depth)
  return out
}
const cls = (n) => String((n.props && n.props.className) || '')
const elText = (n) => {
  let s = ''
  const rec = (x) => {
    if (x == null) return
    if (Array.isArray(x)) { x.forEach(rec); return }
    if (typeof x === 'string' || typeof x === 'number') { s += String(x); return }
    if (typeof x === 'object') { if (x.kids) rec(x.kids); if (x.props && x.props.children) rec(x.props.children) }
  }
  rec(n.kids); rec(n.props && n.props.children)
  return s
}
const isPropRow = (n) => cls(n).split(' ').includes('mpw_prop')

/* ══════════ 夹具：合成属性表（每类一条，计数可精确断言） ══════════ */
const SYNTH = [
  { key: 'grp1', label: '分组一', value: '', type: 'group', order: 0 },
  { key: 'b1', label: '开关', value: false, type: 'bool', order: 1 },
  { key: 's1', label: '滑杆', value: 2, type: 'slider', min: 0, max: 10, step: 0.5, order: 2 },
  { key: 'c1', label: '下拉', value: '1', type: 'combo', options: [{ label: '甲', value: '1' }, { label: '乙', value: '2' }], order: 3 },
  { key: 'col1', label: '颜色', value: '0 0 0', type: 'color', order: 4 },
  { key: 't1', label: '文本', value: 'abc', type: 'textinput', order: 5 },
  { key: 'gated', label: '被开关门控', value: 1, type: 'slider', min: 0, max: 2, step: 1, condition: 'b1.value==false', order: 6 },
  { key: 'note1', label: '作者说明', value: '', type: 'text', order: 7 },
  { key: 'tex1', label: '贴图', value: '', type: 'scenetexture', order: 8 },
  { key: 'schemecolor', label: '编辑器配色', value: '0 0 0', type: 'color', order: 9 },
  { key: 'weird', label: '未知条件', value: 1, type: 'slider', min: 0, max: 2, step: 1, condition: 'clock.value > 3', order: 10 },
]

/* ══════════ 断言集（A + B）；变异时复用，期望至少一条红 ══════════ */
function runChecks(srcText, pure, opts = {}) {
  const results = []
  const t = (name, ok, detail) => { results.push({ name, ok, detail }); check(name, ok, detail) }
  return runChecksInner(srcText, pure, opts, t, results)
}

async function runChecksInner(srcText, pure, opts, t, results) {
  // ① 语料真值**必须**由**本次传入的** pure 提取（变异跑若复用基线的 realInfo，M3 这类
  //   "丢字段"的变异会假绿 —— 判据必须跟着被变异的那份源码走）
  const realInfo = hasCorpus ? pure.extractProjectInfo(fs.readFileSync(REAL, 'utf8')) : null
  /* ── A1：官方字段全保留（旧实现把 group/condition/min/max/step 丢掉） ── */
  if (realInfo) {
    const p = realInfo.properties
    t('A1 真包 233 条属性全量提取（旧实现丢无 text 行）', p.length === 233, '提取=' + p.length)
    const withGroup = p.filter((x) => x.type === 'group').length
    t('A1b 分组头 21 条在提取结果里', withGroup === 21, 'group=' + withGroup)
    // 真值独立取自包内原文（宽容解析：官方允许尾逗号），不写死数字
    const rawP = (() => {
      try {
        const j = JSON.parse(fs.readFileSync(REAL, 'utf8').replace(/,\s*([}\]])/g, '$1'))
        return (j.general && j.general.properties) || {}
      } catch { return null }
    })()
    const truthCond = rawP ? Object.values(rawP).filter((x) => x && typeof x.condition === 'string').length : -1
    const withCond = p.filter((x) => typeof x.conditions === 'string').length
    const nonEmpty = p.filter((x) => x.conditions).length
    t('A1c condition 字段被保留（条数 == 包内原文真值）', truthCond >= 2 && withCond === truthCond && nonEmpty >= 2,
      '提取=' + withCond + ' 原文真值=' + truthCond + ' 非空=' + nonEmpty)
    const sl = p.find((x) => x.type === 'slider' && typeof x.max === 'number' && typeof x.step === 'number')
    t('A1d slider 的 min/max/step 被保留', !!sl, sl ? sl.key + ' min=' + sl.min + ' max=' + sl.max + ' step=' + sl.step : '无')
  } else {
    t('A1 真包语料缺失 ⇒ SKIP', true, 'SKIP')
  }

  /* ── A2/A3：模型计数 + 分组归属 ── */
  const syn = pure.mpwPropsModel(SYNTH, {})
  t('A2 合成表：分组 1 / 控件 7 / 说明 1 / 只读 1 / 跳过 1',
    syn.counts.groups === 1 && syn.counts.controls === 7 && syn.counts.notes === 1 && syn.counts.readonly === 1 && syn.counts.skipped === 1,
    JSON.stringify(syn.counts))
  const kids = syn.rows.filter((r) => r.group === 'grp1' && r.kind !== 'group')
  t('A3 分组归属：组内子项 depth=1 且 group 指向组键', kids.length >= 8 && kids.every((r) => r.depth === 1), '子项=' + kids.length)

  /* ── A4：condition 门控（真值翻转 ⇒ 隐藏集合跟着变） ── */
  const gatedOff = pure.mpwPropsModel(SYNTH, {}).rows.find((r) => r.key === 'gated')
  const gatedOn = pure.mpwPropsModel(SYNTH, { b1: true }).rows.find((r) => r.key === 'gated')
  t('A4 condition=b1.value==false：b1=false 可见 / b1=true 隐藏',
    gatedOff.visible === true && gatedOn.visible === false, 'off=' + gatedOff.visible + ' on=' + gatedOn.visible)

  /* ── A5：白名单外条件 ⇒ 未知但**照显示**（宁多显示不误藏）+ 记账 ── */
  const weird = pure.mpwPropsModel(SYNTH, {}).rows.find((r) => r.key === 'weird')
  t('A5 白名单外条件按"未知"照显示并记账',
    weird.visible === true && weird.condResult === null && pure.mpwPropsModel(SYNTH, {}).counts.condUnknown === 1,
    'visible=' + weird.visible + ' condResult=' + weird.condResult)

  if (realInfo) {
    const p = realInfo.properties
    const m0 = pure.mpwPropsModel(p, {})              // 包内默认 cnen1 = true
    const m1 = pure.mpwPropsModel(p, { cnen1: false }) // 用户把它关掉
    const row = (m, k) => m.rows.find((r) => r.key === k)
    t('A4b 真包 condition 联动（cnen1 翻转 ⇒ _2/_3d 显隐互换）',
      row(m0, '_2').visible === true && row(m0, '_3d').visible === false && row(m1, '_2').visible === false && row(m1, '_3d').visible === true,
      '默认: _2=' + row(m0, '_2').visible + ' _3d=' + row(m0, '_3d').visible + ' | 关掉: _2=' + row(m1, '_2').visible + ' _3d=' + row(m1, '_3d').visible)
    t('A2b 真包模型：group 21 / 控件 ≥180 / 隐藏 ≥1',
      m0.counts.groups === 21 && m0.counts.controls >= 180 && m0.counts.hidden >= 1, JSON.stringify(m0.counts))
  }

  /* ── B：面板挂载（合成表，计数精确） ── */
  const W = loadWorld(srcText)
  globalThis.__mpwSectionTest.write({
    enabled: true, image: 'idb:blob', fromMpkg: true, mpkgKey: 'x.mpkg|1', mpkgName: 'x.mpkg',
    converted: 'scene', source: 'p.gif', info: { title: 'T', properties: SYNTH }, propEdits: {},
  })
  const rows0 = W.render()
  const all0 = walk(rows0)
  const propRows0 = all0.filter(isPropRow)
  // 面板渲染的行 = 可见 **且非 skip**（schemecolor 等只登记不渲染）
  const expected = pure.mpwPropsModel(SYNTH, {}).rows.filter((r) => r.visible && r.kind !== 'skip').length
  t('B1 默认展开：无点击即渲染全部可见行（旧行为=0 行，只有一个「展开全部」按钮）',
    propRows0.length === expected && propRows0.length >= 9, '行数=' + propRows0.length + ' 期望=' + expected)

  const groupBtns = all0.filter((n) => n.type === 'button' && n.props && n.props['data-mpw-propgroup'])
  t('B2 分组头渲染为可折叠按钮', groupBtns.length === 1 && /分组一/.test(elText(groupBtns[0])), '分组按钮=' + groupBtns.length)
  if (groupBtns.length) {
    // 期望：收起后 = 组头自己 1 行（子项里 skip 的条目本来就不渲染，不能算进"可见子项"）
    const renderedKids = pure.mpwPropsModel(SYNTH, {}).rows.filter((r) => r.visible && r.kind !== 'skip' && r.kind !== 'group').length
    groupBtns[0].props.onClick({ currentTarget: {} })
    const rows1 = walk(W.render()).filter(isPropRow).length
    t('B2b 点分组头 ⇒ 子项收起（行数下降 = 已渲染子项数）', rows1 === propRows0.length - renderedKids && rows1 === 1,
      propRows0.length + ' → ' + rows1 + '（已渲染子项 ' + renderedKids + '）')
  } else t('B2b 点分组头 ⇒ 子项收起', false, '没有分组按钮')

  // ① 只在**属性行内**数控件：面板别处也有 range（外观滑杆）/文本输入/下拉，全树计数会假绿
  const inProps = []
  for (const r of propRows0) walk(r, inProps)
  const rangeEls = inProps.filter((n) => n.type === 'input' && n.props.type === 'range' && n.props['data-mpw-prop'])
  const swEls = inProps.filter((n) => n.type === 'button' && n.props.role === 'switch')
  const colorEls = inProps.filter((n) => n.type === 'input' && n.props.type === 'color' && n.props['data-mpw-prop'])
  const textEls = inProps.filter((n) => n.type === 'input' && n.props['data-mpw-prop'] && n.props.type === 'text')
  const comboBtns = inProps.filter((n) => n.type === 'button' && cls(n).includes('mpw_selectBtn'))
  if (process.env.MPW_PROPS_DEBUG) console.log('    [debug] range=' + JSON.stringify(rangeEls.map((n) => n.props['data-mpw-prop'])) + ' text=' + JSON.stringify(textEls.map((n) => n.props['data-mpw-prop'])) + ' color=' + JSON.stringify(colorEls.map((n) => n.props['data-mpw-prop'])) + ' combo=' + comboBtns.length)
  t('B3 每类属性都有**真控件**：bool→开关 / slider→range / color→取色 / textinput→文本框 / combo→下拉',
    swEls.length === 1 && rangeEls.length === 3 && colorEls.length === 1 && textEls.length === 1 && comboBtns.length === 1,
    '开关=' + swEls.length + ' range=' + rangeEls.length + ' color=' + colorEls.length + ' text=' + textEls.length + ' combo=' + comboBtns.length)
  const sl = rangeEls.find((n) => n.props['data-mpw-prop'] === 's1')
  t('B3b slider 控件带包内量程 min/max/step',
    !!sl && String(sl.props.min) === '0' && String(sl.props.max) === '10' && String(sl.props.step) === '0.5',
    sl ? 'min=' + sl.props.min + ' max=' + sl.props.max + ' step=' + sl.props.step : '缺 s1')

  /* ── B4：接线（控件 → propEdits 落盘；旧实现是只读文本行 + 死代码 setProp） ── */
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  if (swEls.length) swEls[0].props.onClick()
  await wait(60)
  let pe = (W.ls().propEdits || {})['x.mpkg|1'] || {}
  t('B4 bool 开关写进 propEdits 并落盘', pe.b1 === true, 'propEdits=' + JSON.stringify(pe))
  if (sl) {
    sl.props.onChange({ target: { value: '7' } })
    sl.props.onMouseUp({ target: { value: '7' } })
    await wait(400)
    pe = (W.ls().propEdits || {})['x.mpkg|1'] || {}
    t('B4b 滑杆落盘（拖动防抖后写入真实数值）', pe.s1 === 7, 'propEdits.s1=' + JSON.stringify(pe.s1))
  } else t('B4b 滑杆落盘', false, '缺 s1 控件')

  /* ── B5：条件联动端到端（面板层）：把 controller 关掉 ⇒ 被门控项消失 ── */
  const rowsAfter = walk(W.render()).filter(isPropRow)
  const gatedRow = rowsAfter.find((n) => /被开关门控/.test(elText(n)))
  t('B5 端到端联动：b1 打开后 condition=b1.value==false 的项从面板消失', !gatedRow || (pe.b1 === true && !gatedRow),
    'gatedRow=' + (gatedRow ? '仍在' : '已消失'))

  return { results, W }
}

/* ══════════════════════════ 主流程 ══════════════════════════ */
console.log('[props-panel] WE 自带壁纸选项面板：默认展开 + 逐项控件 + 分组/条件 + 接线判据')
const src = fs.readFileSync(CLIENT, 'utf8')
const pure = loadPure(src)
if (!hasCorpus) console.log('  ⚠ 语料缺失（' + REAL + '）⇒ 真包相关断言 SKIP')

console.log('\n== A/B 基线（当前实现）==')
const base = await runChecks(src, pure, {})
console.log('  基线：' + (base.results.filter((r) => r.ok).length) + '/' + base.results.length + ' 通过')

/* ── C：变异必红（把修复改回去，必须至少一条红；红名单要含预期的那些人） ── */
console.log('\n== C 变异必红（改回去 ⇒ 判据必须红）==')
const MUTATIONS = [
  {
    id: 'M1', name: '把「默认展开」改回旧行为（propsExpanded 初值 false）',
    build: (s) => s.replace('const [propsExpanded, setPropsExpanded] = react.useState(true);', 'const [propsExpanded, setPropsExpanded] = react.useState(false);'),
    expect: 'B1',
  },
  {
    id: 'M2', name: '把 bool 控件改回**只读文本行**（旧的 span.mpw_propValue）',
    build: (s) => s.replace('h(Toggle, { checked: !!shown, onChange: (v) => setProp(row.key, !!v) }),', 'h("span", { className: "mpw_propValue" }, fmt(shown)),'),
    expect: 'B3',
  },
  {
    id: 'M3', name: '`extractProjectInfo` 丢掉 group/condition（回到旧字段表）',
    build: (s) => s.replace('group: typeof p.group === "string" && p.group ? p.group : null,', 'group: null,')
      .replace('conditions: typeof p.condition === "string" ? p.condition : (typeof p.conditions === "string" ? p.conditions : null),', 'conditions: null,'),
    expect: 'A4b',
  },
  {
    id: 'M4', name: '把 `setProp` 换回空实现（选项改不动 = 旧死代码口径）',
    build: (s) => s.replace('const setProp = (key, value, instant) => {\n\t\t\t\tconst key2 = section.mpkgKey;', 'const setProp = (key, value, instant) => {\n\t\t\t\tif (1) return;\n\t\t\t\tconst key2 = section.mpkgKey;'),
    expect: 'B4',
  },
  {
    id: 'M5', name: '分组头改回普通行（不渲染 data-mpw-propgroup 折叠按钮）',
    build: (s) => s.replace('"data-mpw-propgroup": row.key,', '"data-mpw-propgroup-x": row.key,'),
    expect: 'B2',
  },
]
const mutRows = []
for (const m of MUTATIONS) {
  const msrc = m.build(src)
  if (msrc === src) { check(m.id + ' 变异可施加', false, '替换点没命中（源码漂移）'); mutRows.push([m.id, '未命中', '-']); continue }
  const before = fail
  const beforeFails = fails.length
  console.log('\n-- ' + m.id + ' ' + m.name)
  if (process.env.MPW_PROPS_DEBUG) console.log('    [debug] 变异命中=' + (msrc !== src) + ' 源码长度 ' + src.length + '→' + msrc.length)
  let reds = []
  try {
    const r = await runChecks(msrc, loadPure(msrc), {})
    reds = r.results.filter((x) => !x.ok).map((x) => x.name)
  } catch (e) {
    reds = ['抛错：' + (e && e.message)]
  }
  const expectedRed = reds.some((n) => n.indexOf(m.expect) === 0)
  const mine = fails.length - beforeFails
  // 变异轮的 check() 已把红计入全局 fail/失败清单；这里把它归零（清单也截回去），
  // 最终汇总只反映**基线**（变异本身用"必红"这条 check 记分）
  fail = before
  fails.length = beforeFails
  check(m.id + ' 必红（期望 ' + m.expect + '）', expectedRed && mine > 0, '红=' + (reds.length ? reds.join(' / ') : '无'))
  mutRows.push([m.id, expectedRed ? '必红 ✓' : '未见红 ✗', reds.slice(0, 3).join(' / ') || '-'])
}

console.log('\n── 变异读数表 ──')
for (const [id, verdict, reds] of mutRows) console.log('  ' + id + '  ' + verdict + '  ' + reds)

console.log('\n' + (fail === 0 ? '✓ 全部通过' : '✗ 存在失败项') + '：通过 ' + pass + ' / 失败 ' + fail)
if (fails.length) console.log('  失败清单：\n   - ' + fails.join('\n   - '))
process.exit(fail === 0 ? 0 : 1)
