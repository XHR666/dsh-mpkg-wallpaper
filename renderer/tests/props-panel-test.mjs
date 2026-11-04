// props-panel-test.mjs — P-61 官方属性面板（WE `project.json → general.properties`）单测
// 复现：node props-panel-test.mjs
//
// 被测对象（全部是真包数据，无合成属性表）：
//   · 真包 hina 3554161528：project.json **35 条**属性（类型 bool/slider/color/combo/group + 3 条无 type
//     的 HTML 营销块 + 编辑器配色 schemecolor）；scene.pkg 内 scene.json 的层属性绑定
//     （id398 时钟层：visible←clock、pointsize←size、color←newproperty24、alpha←newproperty25；
//      text.scriptproperties 里 combo 三选一的 useYYYYMMDD/useMMDDYYYY/useDDMMYYYY）。
//   · demo.html 的 `#mpw-props-panel` 区块（按 MPW-PROPS-PANEL 标记切片 + 假 DOM 跑真实代码）。
//
// 断言分组：T0 切片/颜色换算 / T1 渲染计数与排序 / T2 condition 门控（含"不生效"）/
//   T3 二三级联动 / T4 绑定生效（真包 + 合成父子层 origin-scale）/ T5 combo 脚本属性（含端到端跑脚本）/
//   T6 持久化与恢复默认 / T7 URL `?props=` 最高优先 / T8 condition 表达式求值器（语料真实表达式）/
//   T9 N5 四类开关与包自带开关不打架。
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import path from 'node:path'
import * as lib from '../core/we-scene-bundle.js'

let pass = 0, fail = 0, skipped = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}

// ── 真包定位（与 text-switches/mdla-walk 同口径：语料缺失则整体 SKIP）─────────
const ID = '3554161528'
// ①(P-87 2026-09-15 版权) 原来的第二候选 `<repo>/samples/wallpapers/<id>` 已随**真实壁纸整体移除**删除
//   （本仓库不再分发任何第三方壁纸）。真包只从本机语料取；取不到就走下面的优雅 SKIP（门禁不红）。
const CANDIDATES = [
  (process.env.MPW_SCENE_ROOT || path.join(WS, 'allwallpaper', 'dd')) + '/' + ID,
]
const DIR = CANDIDATES.find((d) => fs.existsSync(d + '/project.json') && fs.existsSync(d + '/scene.pkg'))
if (!DIR) {
  console.log('SKIP props-panel（语料里找不到 ' + ID + ' 的 project.json + scene.pkg）')
  process.exit(0)
}
const SCHEMA = JSON.parse(fs.readFileSync(DIR + '/project.json', 'utf8')).general.properties
const PKG = lib.parsePkg(new Uint8Array(fs.readFileSync(DIR + '/scene.pkg')))
const rd = (b) => new TextDecoder().decode(b).replace(/^\uFEFF/, '')
const sceneJsonOf = () => JSON.parse(rd(lib.getEntry(PKG, 'scene.json')))

console.log('[P-61] 官方属性面板（真包 ' + ID + '：' + DIR + '）')

// ── 假 DOM（足够跑 demo.html 的 MPW-PROPS-PANEL 区块）───────────────────────
// ④(P-124 用户第 6 项) **DOM 保真度**：真实 DOM 元素没有 `parent` 属性（只有 `parentNode`）。
//   旧版假 DOM 给每个节点塞了非标准别名 `parent`，于是"浮窗清理代码写成 `wrap.parent` ⇒
//   浏览器里永远摘不掉旧节点（点一次叠一层、阴影越来越重）"这个只在真机复现的 bug 被假绿了。
//   现在节点默认仍带 `parent` 别名（历史断言用），但 `strictDom:true` 的节点**不提供**它 ——
//   取色浮窗的清理路径必须在 strictDom 下通过（= 与浏览器同一套属性面）。
function mkEl(tag, opts) {
  const strict = !!(opts && opts.strictDom)
  const el = {
    tagName: String(tag || 'div').toUpperCase(), id: '', className: '', type: '', textContent: '', title: '',
    value: '', checked: false, disabled: false, hidden: false, min: '', max: '', step: '',
    style: {}, children: [], parentNode: null, ownerDocument: null, _attrs: {}, _ls: {},
    get firstChild() { return el.children.length ? el.children[0] : null },
    appendChild(c) { c.parentNode = el; if (!strict) c.parent = el; el.children.push(c); return c },
    removeChild(c) {
      const i = el.children.indexOf(c)
      if (i >= 0) el.children.splice(i, 1)
      c.parentNode = null
      if (Object.prototype.hasOwnProperty.call(c, 'parent')) c.parent = null
      return c
    },
    setAttribute(k, v) { el._attrs[k] = String(v) },
    getAttribute(k) { return el._attrs[k] },
    addEventListener(t, h) { (el._ls[t] = el._ls[t] || []).push(h) },
    // ②(P-64 第16项) 浮窗取色器要用的 DOM 面：移除监听 / contains / 矩形 / classList（假 DOM 只做到"够跑真代码"）
    removeEventListener(t, h) { const a = el._ls[t] || []; const i = a.indexOf(h); if (i >= 0) a.splice(i, 1) },
    contains(n) { if (n === el) return true; for (const c of el.children) if (c.contains && c.contains(n)) return true; return false },
    getBoundingClientRect() { return { top: 40, left: 8, right: 64, bottom: 60, width: 56, height: 20 } },
    get classList() { return { add() {}, remove() {}, contains() { return false } } },
    fire(t, ev) { for (const h of (el._ls[t] || [])) h(Object.assign({ target: el, preventDefault() {}, stopPropagation() {} }, ev || {})) },
    click() { el.fire('click') },
  }
  if (!strict) el.parent = null          // 非标准别名：只为历史断言保留，strictDom 下不提供（见上）
  return el
}
const HTML = fs.readFileSync(new URL('../demo.html', import.meta.url), 'utf8')
function sliceBlock(src, begin, end) {
  const i = src.indexOf(begin)
  const j = src.indexOf(end, i)
  if (i < 0 || j < 0) throw new Error('demo.html 里找不到区块标记: ' + begin)
  return src.slice(src.indexOf('\n', i) + 1, src.lastIndexOf('\n', j))
}
const PANEL_SRC = sliceBlock(HTML, '// ═══ MPW-PROPS-PANEL-BEGIN', '// ═══ MPW-PROPS-PANEL-END')
function runPanelBlock(opts) {
  const strict = !!(opts && opts.strictDom)
  const doc = { createElement: (t) => mkEl(t, { strictDom: strict }), body: mkEl('body', { strictDom: strict }), _ls: {} }
  // ②(P-64 第16项) 浮窗取色器要 document/window 级监听（点外部/Esc 关）→ 假 DOM 也提供
  doc.addEventListener = (t, h) => { (doc._ls[t] = doc._ls[t] || []).push(h) }
  doc.removeEventListener = (t, h) => { const a = doc._ls[t] || []; const i = a.indexOf(h); if (i >= 0) a.splice(i, 1) }
  doc.fire = (t, ev) => { for (const h of (doc._ls[t] || [])) h(Object.assign({ target: doc.body, preventDefault() {} }, ev || {})) }
  const win = { _ls: {}, innerWidth: 1280, innerHeight: 800 }
  win.addEventListener = (t, h) => { (win._ls[t] = win._ls[t] || []).push(h) }
  win.removeEventListener = (t, h) => { const a = win._ls[t] || []; const i = a.indexOf(h); if (i >= 0) a.splice(i, 1) }
  win.fire = (t, ev) => { for (const h of (win._ls[t] || [])) h(Object.assign({ target: doc.body, preventDefault() {} }, ev || {})) }
  const API = new Function('document', 'window', PANEL_SRC + '\nreturn window.__mpwPropsPanel')(doc, win)
  return { API, doc, win }
}
// 用真模型建面板；hooks 复刻 demo.html 的 onChange/onReset 语义（类型规范化 + 就地改 propsMap）
function buildPanel(model, opts = {}) {
  const { API, doc } = runPanelBlock()
  const host = mkEl('div')
  host.id = 'mpw-props-panel'
  host.ownerDocument = doc
  const calls = []
  const store = opts.store || {}
  const props = model.values
  const api = API.build(host, model, {
    onChange: (k, v) => {
      const t = SCHEMA[k] && SCHEMA[k].type
      props[k] = lib.normalizePropValue(t, v, props[k])
      for (const kk of Object.keys(store)) delete store[kk]
      Object.assign(store, opts.overrides ? opts.overrides(props) : {})
      calls.push({ k, v: props[k] })
      API.refresh(host, lib.propsPanelModel(SCHEMA, props, { locked: model.locked }), api.rows, {})
    },
    onReset: () => {
      const d = lib.propsDefaults(SCHEMA)
      for (const k of Object.keys(props)) delete props[k]
      Object.assign(props, d)
      for (const kk of Object.keys(store)) delete store[kk]
      calls.push({ reset: true })
      API.refresh(host, lib.propsPanelModel(SCHEMA, props, { locked: model.locked }), api.rows, {})
    },
  })
  return { api, host, calls, props, store, API }
}
const rowsOf = (host, cls) => host.children.filter((c) => String(c.className).split(' ').indexOf(cls) >= 0)
const layersWithBinds = (scene) => scene.layers.filter((l) => l.__bindRaw).map((l) => l.id)
function mkScene(props) {
  const s = lib.parseScene(sceneJsonOf(), null, { attachCtx: { readEntry: (n) => lib.getEntry(PKG, n), time: 0 } })
  lib.applyRenderConfig(s, {
    properties: props, propertiesSchema: SCHEMA, sceneId: ID, hideUI: true, log: () => {},
  })
  return s
}
const D = lib.mergeUserProps({ schema: SCHEMA })
const model = lib.propsPanelModel(SCHEMA, D.props, { locked: D.locked })

console.log('[T0] 面板区块可切片执行 + 颜色换算（WE = 线性 0..1，不是 0..255）')
{
  const { API } = runPanelBlock()
  check('T0a 区块可切出并返回 __mpwPropsPanel.build（' + PANEL_SRC.split('\n').length + ' 行）', typeof API.build === 'function')
  check('T0b 作者色 "0.5294117647058824 0.4627450980392157 0.8313725490196079" → #8776d4',
    API.colorToHex('0.5294117647058824 0.4627450980392157 0.8313725490196079') === '#8776d4',
    API.colorToHex('0.5294117647058824 0.4627450980392157 0.8313725490196079'))
  check('T0c 反算 #8776d4 → 0..1 浮点（往返一致）',
    API.colorToHex(API.hexToColor('#8776d4')) === '#8776d4', API.hexToColor('#8776d4'))
  check('T0d 面板换算与 bundle 的 colorPropToHex/hexToColorProp 口径一致（两处实现交叉验证）',
    ['0.52941 0.46275 0.83137', '1 1 1', '0 0 0', '0.2 0.4 0.6'].every((c) => API.colorToHex(c) === lib.colorPropToHex(c))
    && API.hexToColor('#ff8800') === lib.hexToColorProp('#ff8800'), API.colorToHex('0.2 0.4 0.6'))
  check('T0e 线性口径而非 0..255：0.5 → #808080（若按 0..255 会得到 #000000）', API.colorToHex('0.5 0.5 0.5') === '#808080')
  check('T0f slider 读数按 precision 格式化（hina newproperty 精度 3）', API.fmtValue(0.5, 3) === '0.500' && API.fmtValue(32, 2) === '32.00')
}

console.log('[T1] 面板渲染计数 / 排序 / 标签（真包 35 条）')
{
  // 口径（与 bundle propsPanelModel 注释一致）：rendered = 面板上真实出现的条目数（控件 + group 标题）
  //   35 条 − 5 条跳过 = 30：schemecolor（编辑器配色）+ 3 条无 type 的 HTML 营销块
  //   + brhidemarketingwords（bool，只控制那 3 条被跳过的 HTML 块 = 空功能开关）。
  //   30 条里 5 条是 group（粒子/音频组件/音频识别/时间组件/投喂）→ 可操作控件 25 个。
  check('T1a 35 条 → 渲染 30 条（跳过 5）', model.counts.total === 35 && model.counts.rendered === 30 && model.counts.skipped === 5,
    JSON.stringify(model.counts))
  check('T1b 跳过分类：HTML 无 type 3 / 编辑器配色 1 / 空功能开关 1 / 未实现类型 0',
    model.counts.skippedHtml === 3 && model.counts.skippedEditor === 1 && model.counts.skippedDead === 1 && model.counts.skippedUnimpl === 0)
  check('T1c 被跳过的键逐条对得上（不渲染、不猜）',
    JSON.stringify(model.skipped) === JSON.stringify({
      html: ['newproperty2', 'newproperty3', 'newproperty4'], editor: ['schemecolor'], unimpl: [], dead: ['brhidemarketingwords'],
    }), JSON.stringify(model.skipped))
  check('T1d 控件 25 个 + 分组标题 5 个 = 30 条', model.counts.controls === 25 && model.counts.groups === 5)
  const orders = model.items.map((i) => i.order)
  check('T1e 按 order 升序（100…133；前 5 条被跳过 → 首条 order=102）',
    orders.every((o, i) => i === 0 || orders[i - 1] <= o) && orders[0] === 102 && orders[orders.length - 1] === 131,
    'orders=' + orders.join(','))
  check('T1f group 按 order 落在正确位置（粒子 105 / 音频组件 110 / 音频识别 117 / 时间组件 122 / 投喂 131）',
    JSON.stringify(model.groups.map((g) => g.key + '@' + g.order)) === JSON.stringify([
      'newproperty9@105', 'newproperty10@110', 'newproperty15@117', 'newproperty20@122', 'newproperty26@131',
    ]), model.groups.map((g) => g.key + '@' + g.order).join(' '))
  const np1 = model.items.find((i) => i.key === 'newproperty1')
  check('T1g `<br>` → 换行、去掉 HTML 尖括号', np1.label === '开场动画\nOpening animation', JSON.stringify(np1.label))
  check('T1h 所有标签都不含 HTML 标签残留', model.items.every((i) => !/<[^>]*>/.test(i.label)))
  const combo = model.items.find((i) => i.key === 'newproperty23')
  check('T1i combo 选项来自 project.json options（3 项，值按字符串）',
    combo.options.length === 3 && combo.options[2].value === '3' && combo.options[2].label === 'YYYY/MM/DD',
    JSON.stringify(combo.options))
  const sizeIt = model.items.find((i) => i.key === 'size')
  check('T1j slider 范围/精度取自 project.json（size 1..40 step1 precision1）',
    sizeIt.min === 1 && sizeIt.max === 40 && sizeIt.step === 1 && sizeIt.precision === 1)
  check('T1k condition 条目数 13（真包实测）', model.counts.conditions === 13, String(model.counts.conditions))
  {
    const { host, api } = buildPanel(model)
    const rowKeys = Object.keys(api.rows).filter((k) => !api.rows[k].group)
    check('T1l 假 DOM 面板：25 个 .row + 5 个 .grp（= 模型逐条落地）',
      rowsOf(host, 'row').length === 25 && rowsOf(host, 'grp').length === 5,
      'rows=' + rowsOf(host, 'row').length + ' grp=' + rowsOf(host, 'grp').length)
    check('T1m 被跳过的 5 条没有控件行', ['schemecolor', 'newproperty2', 'newproperty3', 'newproperty4', 'brhidemarketingwords'].every((k) => !api.rows[k]))
    check('T1n 控件类型逐类落地（bool→checkbox / slider→range / color→色块按钮(P-64) / combo→select）',
      api.rows.clock.ctrl.type === 'checkbox' && api.rows.size.ctrl.type === 'range'
      && api.rows.newproperty24.ctrl.tagName === 'BUTTON' && api.rows.newproperty24.ctrl.className === 'mpw_colorSwatch'
      && api.rows.newproperty23.ctrl.tagName === 'SELECT',
      [api.rows.clock.ctrl.type, api.rows.size.ctrl.type, api.rows.newproperty24.ctrl.tagName, api.rows.newproperty23.ctrl.tagName].join('/'))
    check('T1o range 的 min/max/step 来自模型', api.rows.size.ctrl.min === '1' && api.rows.size.ctrl.max === '40' && api.rows.size.ctrl.step === '1')
    check('T1p 颜色控件初值 = 作者色 #8776d4', api.rows.newproperty24.ctrl.value === '#8776d4', api.rows.newproperty24.ctrl.value)
    check('T1q combo 初值 = "3"（字符串，脚本 condition 同口径）', api.rows.newproperty23.ctrl.value === '3', api.rows.newproperty23.ctrl.value)
    check('T1r 行内读数/作者默认提示存在', api.rows.clock.readout.textContent === '开' && /默认/.test(api.rows.newproperty23.readout.title))
    // 状态统计（进 window.__mpwProps.panel）；②(P-64) 起新增 skipped/decor 两个字段（跳过条目 / HTML 图片条目）
    check('T1s api.state() = {count:35, rendered:30, controls:25, hidden:0, skipped:5, decor:0}',
      JSON.stringify(api.state()) === JSON.stringify({ count: 35, rendered: 30, controls: 25, hidden: 0, skipped: 5, decor: 0 }), JSON.stringify(api.state()))
  }
}

console.log('[T2] condition 门控：父项关掉 → 子项不显示**且不生效**')
{
  const off = lib.gatedOffNames(SCHEMA, { ...D.props, clock: false })
  const want = ['_24h', 'newproperty21', 'newproperty22', 'newproperty23', 'newproperty24', 'newproperty25', 'size']
  check('T2a clock=false → 门控关闭集合 = ' + want.join('/'), want.every((k) => off.has(k)) && off.size === want.length, [...off].join(','))
  const m2 = lib.propsPanelModel(SCHEMA, { ...D.props, clock: false })
  const hidden = m2.items.filter((i) => !i.visible).map((i) => i.key)
  check('T2b 这 7 条在面板里都不显示（其余 23 条照常）',
    want.every((k) => m2.items.find((i) => i.key === k).visible === false) && m2.items.filter((i) => i.visible).length === 23,
    'hidden=' + hidden.join(','))
  check('T2c conditionSummary 也记账（total=13 / off 列表）', m2.conditionSummary.total === 13 && m2.conditionSummary.off.length === 7)
  const m1 = lib.propsPanelModel(SCHEMA, D.props)
  check('T2d clock=true（作者默认）→ 7 条全部显示', want.every((k) => m1.items.find((i) => i.key === k).visible === true))
  {
    const m = lib.propsPanelModel(SCHEMA, { ...D.props, clock: false })
    const { api } = buildPanel(m)
    check('T2e 假 DOM：门控关闭的行 display:none + hidden=true（不占位、点不到）',
      want.every((k) => api.rows[k].row.style.display === 'none' && api.rows[k].row.hidden === true)
      && api.rows.newproperty16.row.style.display === '', 'clock=false 时 size 行 display=' + api.rows.size.row.style.display)
    // 动态联动：勾上 clock → 7 行立刻出现（无需刷新页面）
    api.rows.clock.ctrl.checked = true
    api.rows.clock.ctrl.fire('change')
    check('T2f 勾上「时间/clock」后 7 行立刻显示（condition 实时联动）',
      want.every((k) => api.rows[k].row.style.display !== 'none' && api.rows[k].row.hidden === false)
      && api.rows.clock.ctrl.checked === true)
  }
  // "不生效"：门控关闭时该属性的绑定不写入真实层
  {
    const s = mkScene({ ...D.props, clock: false, size: 40 })
    const l = s.layers.find((x) => x.id === 398)
    check('T2g clock=false + size=40 → 时钟层 pointsize 保持作者值 20（门控下绑定不生效）',
      l.__text.pointsize === 20, 'pointsize=' + l.__text.pointsize)
    const s2 = mkScene({ ...D.props, clock: true, size: 40 })
    check('T2h clock=true + size=40 → pointsize=40（对照组）', s2.layers.find((x) => x.id === 398).__text.pointsize === 40)
  }
}

console.log('[T3] 二三级联动（子项关掉 → 孙项消失）')
{
  const m = lib.propsPanelModel(SCHEMA, { ...D.props, newproperty22: false })
  check('T3a newproperty22(日期)=false → newproperty23(格式) 隐藏（二级）',
    m.items.find((i) => i.key === 'newproperty23').visible === false
    && m.items.find((i) => i.key === 'newproperty22').visible === true)
  const m2 = lib.propsPanelModel(SCHEMA, { ...D.props, newproperty18: false })
  check('T3b newproperty18(高光)=false → newproperty(强度) 隐藏',
    m2.items.find((i) => i.key === 'newproperty').visible === false && m2.items.find((i) => i.key === 'newproperty18').visible === true)
  const m3 = lib.propsPanelModel(SCHEMA, { ...D.props, newproperty11: false })
  check('T3c newproperty11(音频条)=false → 颜色/条数/间距 3 条隐藏，歌曲名那条不受影响',
    ['newproperty12', 'newproperty13', 'newproperty14'].every((k) => m3.items.find((i) => i.key === k).visible === false)
    && m3.items.find((i) => i.key === 'newproperty16').visible === true)
  const m4 = lib.propsPanelModel(SCHEMA, { ...D.props, newproperty16: false })
  check('T3d newproperty16(歌曲名)=false → 颜色/不透明度 2 条隐藏，且**真实层** id1592 也被绑定关掉',
    ['color', 'newproperty17'].every((k) => m4.items.find((i) => i.key === k).visible === false)
    && mkScene({ ...D.props, newproperty16: false }).layers.find((x) => x.id === 1592).visible === false)
  // 三级：clock=false → newproperty22 关闭 → newproperty23 也关闭（传递闭包，T2 已验；这里验"父值仍为真也不显示"）
  const m5 = lib.propsPanelModel(SCHEMA, { ...D.props, clock: false })
  check('T3e 三级传递：clock=false 时 newproperty22 的值仍是 true，但 newproperty23 依然隐藏',
    m5.values.newproperty22 === true && m5.items.find((i) => i.key === 'newproperty23').visible === false)
}

console.log('[T4] 绑定生效（真包 scene.json + bundle 绑定解析 → 真实渲染字段）')
{
  const binds = layersWithBinds(mkScene(D.props))
  check('T4a 真包里识别出 14 个绑定层（语料实测：visible/alpha/color/pointsize）',
    binds.length === 14, 'ids=' + binds.join(','))
  const s = mkScene({ ...D.props, clock: false })
  const l = s.layers.find((x) => x.id === 398)
  check('T4b clock=false → 时钟层 id398.visible=false（字符串形态 {user:"clock"} 绑定被解开）', l.visible === false, 'visible=' + l.visible)
  const s2 = mkScene({ ...D.props, clock: true })
  check('T4c clock=true → id398.visible=true（对照）', s2.layers.find((x) => x.id === 398).visible === true)
  const s3 = mkScene({ ...D.props, clock: true, size: 40, newproperty24: '1 0 0', newproperty25: 0.5 })
  const l3 = s3.layers.find((x) => x.id === 398)
  check('T4d size=40 → 该层 pointsize=40（文本字号绑定）', l3.__text.pointsize === 40, 'pointsize=' + l3.__text.pointsize)
  check('T4e newproperty24="1 0 0" → 该层 color=[1,0,0]（文本颜色，线性 0..1）',
    JSON.stringify(l3.__text.color) === JSON.stringify([1, 0, 0]), JSON.stringify(l3.__text.color))
  check('T4f newproperty25=0.5 → 该层 alpha=0.5', l3.alpha === 0.5, 'alpha=' + l3.alpha)
  check('T4g 作者默认色仍可复现（0.529/0.462/0.831）',
    (() => { const a = mkScene(D.props).layers.find((x) => x.id === 398).__text.color; return Math.abs(a[0] - 0.52941) < 1e-4 && Math.abs(a[2] - 0.83137) < 1e-4 })(),
    JSON.stringify(mkScene(D.props).layers.find((x) => x.id === 398).__text.color))
  // 反向：类型不合的绑定不写入（真包唯一实测样本：id1592 pointsize←bool 高光属性）
  check('T4h 类型不合的绑定不写坏字段：id1592 pointsize←newproperty18(bool) 保持作者值 10',
    mkScene({ ...D.props, newproperty18: true }).layers.find((x) => x.id === 1592).__text.pointsize === 10,
    'pointsize=' + mkScene(D.props).layers.find((x) => x.id === 1592).__text.pointsize)
  // 面板重复改动 = 幂等（同一 props 反复 apply 结果一致）
  {
    const scene = mkScene(D.props)
    lib.applyUserProperties(scene, { ...D.props, size: 40 }, { schema: SCHEMA })
    const a = scene.layers.find((x) => x.id === 398).__text.pointsize
    lib.applyUserProperties(scene, { ...D.props, size: 40 }, { schema: SCHEMA })
    const b = scene.layers.find((x) => x.id === 398).__text.pointsize
    check('T4i 绑定应用幂等（面板连拖滑杆不累积漂移）', a === 40 && b === 40, a + '/' + b)
  }
  // 合成层：根层 origin 绑定（y-up→y-down 翻转）与子层 origin/scale 绑定（父链累计变换）
  {
    const synth = {
      general: { orthogonalprojection: { width: 3840, height: 2160 } },
      projH: 2160,
      layers: [
        { id: 1, name: 'root', visible: true, origin: [100, 100, 0], scale: [1, 1, 1], size: [10, 10], image: 'm.json', effects: [], __bindRaw: { origin: { user: 'pos', value: '100 100 0' } } },
        { id: 2, name: 'child', visible: true, origin: [200, 300, 0], scale: [2, 2, 1], size: [10, 10], image: 'm.json', effects: [], __bindRaw: {}, __localOrigin: [10, 20, 0], __authOriginWorld: [200, 300, 0], __parentXf: { cos: 1, sin: 0, sx: 2, sy: 2, pz: 1 }, __parentScale: [2, 2, 1] },
      ],
    }
    synth.layers[1].__bindRaw = { origin: { user: 'cpos', value: '10 20 0' }, scale: { user: 'cscale', value: '1 1 1' } }
    lib.applyUserProperties(synth, { pos: '500 700 0', cpos: '20 40 0', cscale: '3 3 1' }, { schema: null })
    check('T4j 根层 origin 绑定 → [x, projH−y]（编辑器 y-up → 渲染 y-down，与 parseScene 同口径）',
      JSON.stringify(synth.layers[0].origin) === JSON.stringify([500, 2160 - 700, 0]), JSON.stringify(synth.layers[0].origin))
    check('T4k 子层 origin 绑定 → 局部增量 × 父链累计缩放/旋转后叠加到作者世界位',
      JSON.stringify(synth.layers[1].origin) === JSON.stringify([200 + 10 * 2, 300 + 20 * 2, 0]), JSON.stringify(synth.layers[1].origin))
    check('T4l 子层 scale 绑定 → 乘父链缩放（3×2=6）', JSON.stringify(synth.layers[1].scale) === JSON.stringify([6, 6, 1]), JSON.stringify(synth.layers[1].scale))
  }
}

console.log('[T5] combo → 脚本属性（日期格式三选一）')
{
  const sj = sceneJsonOf()
  const st = lib.applyScriptProps(sj, { ...D.props, newproperty23: '1' })
  const sp = sj.objects.find((o) => o.id === 398).text.scriptproperties
  check('T5a newproperty23="1" → useMMDDYYYY=true 且 useYYYYMMDD=false（combo 形态 {user:{condition,name}}）',
    sp.useMMDDYYYY === true && sp.useYYYYMMDD === false && sp.useDDMMYYYY === false,
    'MMDD=' + sp.useMMDDYYYY + ' YYYY=' + sp.useYYYYMMDD + ' DD=' + sp.useDDMMYYYY)
  lib.applyScriptProps(sj, { ...D.props, newproperty23: '3' })
  const sp3 = sj.objects.find((o) => o.id === 398).text.scriptproperties
  check('T5b 改回 "3" → useYYYYMMDD=true、useMMDDYYYY=false（同一对象可反复重解析）',
    sp3.useYYYYMMDD === true && sp3.useMMDDYYYY === false)
  check('T5c 普通形态 {user:"_24h"} 也解析：_24h=false → use24hFormat=false',
    sp3.use24hFormat === false && sp3.displayDate === true, 'use24hFormat=' + sp3.use24hFormat)
  check('T5d 解析统计可观测（' + st.scripts + ' 个脚本属性块 / ' + st.resolved + ' 条来自用户属性）',
    st.scripts >= 3 && st.resolved >= 5, JSON.stringify(st))
  // 端到端：解析后的字面量真的被脚本宿主消费（elysia/scene-scripts.js 每帧读 obj.scriptproperties）
  {
    const { applySceneScripts, createScriptCache } = await import('../elysia/scene-scripts.js')
    const sj2 = sceneJsonOf()
    lib.applyScriptProps(sj2, { ...D.props, newproperty23: '1', clock: true, newproperty22: true }, { schema: SCHEMA })
    const errs = []
    applySceneScripts(sj2, 0, { scriptCache: createScriptCache(), renderObjects: sj2.objects, userProps: D.props, canvasSize: { x: 3840, y: 2160 }, onError: (s, e) => errs.push(s + ':' + e.message) })
    const got = String(sj2.objects.find((o) => o.id === 398).text.value || '')
    const now = new Date()
    const p = (n) => String(n).padStart(2, '0')
    const want = p(now.getMonth() + 1) + '/' + p(now.getDate()) + '/' + now.getFullYear()
    check('T5e 端到端：脚本宿主跑完，时钟文本日期段 = MMDD/YYYY（选项 1）', got.split('\n')[1] === want,
      JSON.stringify(got) + ' 期望日期段=' + want + (errs.length ? ' errs=' + errs.slice(0, 2).join(',') : ''))
    lib.applyScriptProps(sj2, { ...D.props, newproperty23: '3', clock: true, newproperty22: true }, { schema: SCHEMA })
    applySceneScripts(sj2, 0.1, { scriptCache: createScriptCache(), renderObjects: sj2.objects, userProps: D.props, canvasSize: { x: 3840, y: 2160 }, onError: () => {} })
    const got3 = String(sj2.objects.find((o) => o.id === 398).text.value || '')
    check('T5f 端到端：选项 3 → YYYY/MM/DD（默认口径）', got3.split('\n')[1] === now.getFullYear() + '/' + p(now.getMonth() + 1) + '/' + p(now.getDate()),
      JSON.stringify(got3))
  }
}

console.log('[T6] 持久化（localStorage 按 sceneId 分键）与「恢复作者默认」')
{
  const stored = { clock: false, size: 40 }
  const m = lib.mergeUserProps({ schema: SCHEMA, stored, url: {} })
  check('T6a localStorage 改动生效（clock=false / size=40）', m.props.clock === false && m.props.size === 40)
  check('T6b 未改动的项仍是作者默认（newproperty23="3" 字符串 / opacity=0.55）',
    m.props.newproperty23 === '3' && Math.abs(m.props.opacity - 0.55) < 1e-9, JSON.stringify([m.props.newproperty23, m.props.opacity]))
  check('T6c 无 stored 时 = 作者默认（clock=true）', lib.mergeUserProps({ schema: SCHEMA, stored: {}, url: {} }).props.clock === true)
  // 面板改动 → 差异表（只有改动项进 localStorage）
  {
    const env = buildPanel(lib.propsPanelModel(SCHEMA, { ...D.props }, { locked: D.locked }), {
      store: {},
      overrides: (props) => {
        const def = lib.propsDefaults(SCHEMA); const out = {}
        for (const k of Object.keys(props)) if (JSON.stringify(props[k]) !== JSON.stringify(def[k])) out[k] = props[k]
        return out
      },
    })
    env.api.rows.clock.ctrl.checked = false
    env.api.rows.clock.ctrl.fire('change')
    check('T6d 取消勾选「时间/clock」→ 回调值 false（bool 规范化成 boolean，不是字符串 "0"）',
      env.calls.length === 1 && env.calls[0].k === 'clock' && env.calls[0].v === false, JSON.stringify(env.calls))
    check('T6e 差异表只记改动项（{clock:false}）', JSON.stringify(env.store) === JSON.stringify({ clock: false }), JSON.stringify(env.store))
    env.api.rows.size.ctrl.value = '33'
    env.api.rows.size.ctrl.fire('input')
    check('T6f slider 改动进差异表且是 number（33 而非 "33"，脚本属性 origin.x 等要靠数字）',
      env.store.size === 33 && typeof env.store.size === 'number', JSON.stringify(env.store))
    check('T6g 重新装载（模拟刷新）= stored 生效：clock=false / size=33',
      lib.mergeUserProps({ schema: SCHEMA, stored: env.store, url: {} }).props.clock === false
      && lib.mergeUserProps({ schema: SCHEMA, stored: env.store, url: {} }).props.size === 33)
    env.api.reset.click()
    check('T6h 点「恢复作者默认」→ 差异表清空 + props 回默认（clock=true / size=20）',
      Object.keys(env.store).length === 0 && env.props.clock === true && env.props.size === 20, JSON.stringify(env.store))
    check('T6i 恢复默认后刷新同样的 stored（空表）= 作者默认', lib.mergeUserProps({ schema: SCHEMA, stored: env.store, url: {} }).props.size === 20)
    check('T6j 面板区块里有「恢复作者默认」按钮（真源码）', /恢复作者默认/.test(PANEL_SRC) && /onReset/.test(PANEL_SRC))
  }
  check('T6k demo.html 用按 sceneId 分键的 localStorage 键 + 读写包了 try（不透明源降级）',
    /'mpw-props:' \+ id/.test(HTML) && /typeof localStorage === 'undefined'/.test(HTML) && /writePropsStore/.test(HTML))
}

console.log('[T7] URL `?props=` 优先级最高（覆盖面板与 localStorage）')
{
  const url = lib.parsePropsQuery('clock=0,size=40')
  const m = lib.mergeUserProps({ schema: SCHEMA, stored: { clock: true, size: 20, opacity: 0.2 }, url })
  check('T7a URL > localStorage > 作者默认（clock/size 取 URL，opacity 取 stored）',
    m.props.clock === false && m.props.size === 40 && Math.abs(m.props.opacity - 0.2) < 1e-9, JSON.stringify([m.props.clock, m.props.size, m.props.opacity]))
  check('T7b locked 集合 = 被 URL 钉住的键', m.locked.has('clock') && m.locked.has('size') && !m.locked.has('opacity'), [...m.locked].join(','))
  const model7 = lib.propsPanelModel(SCHEMA, m.props, { locked: m.locked })
  check('T7c 面板显示 URL 值（clock=false → 复选框未勾 / size=40 → range 值 40）',
    model7.items.find((i) => i.key === 'clock').value === false && model7.items.find((i) => i.key === 'size').value === 40)
  check('T7d 被 URL 锁定的项标记 locked（控件置灰）',
    model7.items.find((i) => i.key === 'clock').locked === true && model7.items.find((i) => i.key === 'opacity').locked === false)
  {
    const { api } = buildPanel(model7)
    check('T7e 假 DOM：锁定项 disabled=true + data-locked="1"，未锁定项可点',
      api.rows.clock.ctrl.disabled === true && api.rows.clock.row.getAttribute('data-locked') === '1'
      && api.rows.opacity.ctrl.disabled === false, 'title=' + api.rows.clock.row.title)
  }
  check('T7f URL 覆盖后 condition 判定用的也是 URL 值：clock=0 → size 行隐藏',
    lib.propsPanelModel(SCHEMA, m.props, { locked: m.locked }).items.find((i) => i.key === 'size').visible === false)
  const s = mkScene(m.props)
  check('T7g URL clock=0 一路生效到真实层（id398 visible=false）', s.layers.find((x) => x.id === 398).visible === false)
  check('T7h 旧写法仍兼容：单键 `?props=clock=0`（无逗号）与多键同口径',
    JSON.stringify(lib.parsePropsQuery('clock=0')) === JSON.stringify({ clock: '0' }))
}

console.log('[T8] condition 表达式求值器（语料真实表达式，非只支持 name.value）')
{
  const P = {
    appdocksettings: true, appdockenabled: true, appdocksetup: false,
    newproperty54: false, newproperty59: true, tishi: 0, timevarying: false, clock: true, display: '2',
  }
  check('T8a `a.value == true && b.value == true && c.value == true`（语料 24 次）→ false',
    lib.evalPropCondition('appdocksettings.value == true && appdockenabled.value == true && appdocksetup.value == true', P) === false)
  check('T8b 同式去掉 c → true', lib.evalPropCondition('appdocksettings.value == true && appdockenabled.value == true', P) === true)
  check('T8c `x.value || y.value`（语料 4 次）→ true', lib.evalPropCondition('newproperty54.value || newproperty59.value', P) === true)
  check('T8d `tishi.value==0`（无空格、数字比较）→ true；==1 → false',
    lib.evalPropCondition('tishi.value==0', P) === true && lib.evalPropCondition('tishi.value==1', P) === false)
  check('T8e `!timevarying.value` → true', lib.evalPropCondition('!timevarying.value', P) === true)
  check('T8f 组合 `!a.value && (b.value==0 || c.value)` → true',
    lib.evalPropCondition('!timevarying.value && (tishi.value==0 || clock.value)', P) === true)
  check('T8g 裸属性名（无 .value）与 `!=` 也支持', lib.evalPropCondition('clock', P) === true && lib.evalPropCondition('display != "3"', P) === true)
  check('T8h 引用名提取（门控传递闭包靠它）',
    JSON.stringify(lib.propConditionNames('a.value == true && b.value || !c.value')) === JSON.stringify(['a', 'b', 'c']))
  check('T8i 解析失败 fail-open（显示控件，绝不因作者笔误把整组藏起来）',
    lib.evalPropCondition('this is @@ broken', P) === true && lib.evalPropCondition('', P) === true)
  check('T8j 未知名不炸（视为 undefined/false）', lib.evalPropCondition('nope.value', P) === false)
}

console.log('[T9] 与 N5 四类文本开关不打架（包自带开关优先；无属性表时 N5 逐位不变）')
{
  const D2 = lib.mergeUserProps({ schema: SCHEMA }).props
  const mk = (bind) => ({
    general: {}, projH: 1080,
    layers: [
      { id: 1, name: 'Clock', visible: true, size: [10, 10], scale: [1, 1, 1], origin: [0, 0, 0], image: 'models/x.json', effects: [], __text: { text: 't' }, __visibleRaw: bind ? { user: 'clock', value: true } : true, __bindRaw: bind ? { visible: { user: 'clock', value: true } } : undefined },
      { id: 2, name: 'Clock', visible: true, size: [10, 10], scale: [1, 1, 1], origin: [0, 0, 0], image: 'models/x.json', effects: [], __text: { text: 't' } },
    ],
  })
  const s1 = mk(true)
  lib.applyRenderConfig(s1, { properties: D2, propertiesSchema: SCHEMA, hideUI: true, showClock: false, log: () => {} })
  check('T9a 包自带 `clock` bool 开关 + 该层可见性绑定该属性 → `?showclock=0` 不再隐藏它（面板驱动）',
    s1.layers[0].visible === true, 'bound Clock visible=' + s1.layers[0].visible)
  check('T9b 同场景里**未绑定**的同名 Clock 层仍按 N5 旧口径隐藏（豁免只给绑定层）', s1.layers[1].visible === false)
  const s2 = mk(true)
  lib.applyRenderConfig(s2, { properties: D2, hideUI: true, showClock: false, log: () => {} })
  check('T9c 无属性表（旧调用点 package-matrix/preview 等）→ N5 行为逐位不变（绑定层也隐藏）', s2.layers[0].visible === false)
  const s3 = mk(true)
  lib.applyRenderConfig(s3, { properties: D2, propertiesSchema: SCHEMA, hideUI: true, showClock: true, log: () => {} })
  check('T9d showclock 缺省/为 1 时照旧显示（两套开关默认不冲突）', s3.layers[0].visible === true && s3.layers[1].visible === true)
  check('T9e demo.html 接线：propertiesSchema 进 applyRenderConfig + 面板改动即时重应用（applyUserProperties/applyScriptProps）+ 就地改 __mpwUserProps（脚本宿主下帧读到）',
    /propertiesSchema: propsSchema/.test(HTML) && /lib\.applyUserProperties\(scene, propsMap/.test(HTML)
    && /lib\.applyScriptProps\(sceneObj, propsMap/.test(HTML) && /window\.__mpwUserProps = propsMap/.test(HTML))
}

console.log('[T10] demo.html 装载块真源码切片：改动即时生效链路（面板 → propsMap → 真实层 → 脚本属性 → localStorage → 诊断）')
{
  // 切片 = demo.html 里 P-61 面板装载段（`let propsPanel = null` … 装载 + 诊断常备）。
  // 为什么切真源码：本机 PRoot 起不了 Chromium（见 headless-shot.mjs 记录的降级链），
  // 浏览器实跑不可得 → 用假 DOM + 真包把"装载"这一步也纳入单测。
  //   注意 end marker 必须带行首换行 + 恰好 2 空格缩进：缩进 6 空格的同名行在 applyAll 里
  //   （第一次出现），用宽松写法会把 installPropsPanel 从中间截断 → 切片语法错。
  const SRC = sliceBlock(HTML, '  let propsPanel = null\n', "\n  // ①(2026-09-12) ?isolate=名称(逗号分隔)")
  const mkEnv = (search, schema, props, locked) => {
    const { API, doc } = runPanelBlock()
    const win = { __mpwPropsPanel: API }
    const store = {}
    // 复刻切片单元交出来的 ctx（真实实现见 demo.html：save=writePropsStore、key='mpw-props:'+id；
    // 键格式另由 T6k 在真源码上断言）
    const save = (o) => {
      if (o && Object.keys(o).length) store['mpw-props:' + ID] = JSON.stringify(o)
      else delete store['mpw-props:' + ID]
    }
    win.__mpwPropsCtx = { map: props, schema, locked, store: {}, save, key: 'mpw-props:' + ID }
    const logs = []
    const sceneObj = sceneJsonOf()
    const scene = lib.parseScene(sceneObj, null, { attachCtx: { readEntry: (n) => lib.getEntry(PKG, n), time: 0 } })
    lib.applyRenderConfig(scene, { properties: props, propertiesSchema: schema, sceneId: ID, hideUI: true, log: () => {} })
    const doc2 = Object.assign({}, doc)
    const bar = mkEl('div')
    doc2.getElementById = (id) => (id === 'bar' ? bar : null)
    doc2.body = mkEl('body')
    const g = new Function('document', 'window', 'localStorage', 'location', 'lib', 'scene', 'sceneObj', 'logf', 'URLSearchParams',
      SRC + '\nreturn { propsPanel, propsDiagPayload }')
    const r = g(doc2, win, { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v) }, removeItem: (k) => { delete store[k] } },
      { search }, lib, scene, sceneObj, (m) => logs.push(String(m)), URLSearchParams)
    let diagErr = null
    try { r.propsDiagPayload() } catch (e) { diagErr = (e && e.message) || String(e) }
    return { r, win, doc2, bar, store, logs, scene, sceneObj, API, diagErr }
  }
  const P0 = lib.mergeUserProps({ schema: SCHEMA })
  const env = mkEnv('?id=' + ID, SCHEMA, P0.props, P0.locked)
  check('T10a 装载成功：面板挂进 #bar、body 里有 #mpw-props-panel、window.__mpwProps 已就位',
    !!env.r.propsPanel && env.bar.children.some((c) => c.id === 'mpw-props-btn')
    && env.doc2.body.children.some((c) => c.id === 'mpw-props-panel')
    && env.win.__mpwProps && env.win.__mpwProps.rendered === 30,
    'panel=' + !!env.r.propsPanel + ' props=' + JSON.stringify(env.win.__mpwProps && { r: env.win.__mpwProps.rendered, c: env.win.__mpwProps.controls }) + ' diagErr=' + env.diagErr)
  check('T10b 诊断字段齐备（count/rendered/skipped/conditions/values + controls/groups/locked/stored/lastApply）',
    ['count', 'rendered', 'skipped', 'conditions', 'values', 'controls', 'groups', 'locked', 'stored', 'skippedByReason', 'urlProps', 'panel', 'lastApply']
      .every((k) => k in env.win.__mpwProps), Object.keys(env.win.__mpwProps).join(','))
  check('T10c 初始不写 localStorage（无改动 = 无差异表）', Object.keys(env.store).length === 0)
  // 取消勾选「时间/clock」→ 真实层 + 脚本属性 + localStorage + 诊断
  const clockRow = env.r.propsPanel.api.rows.clock
  clockRow.ctrl.checked = false
  clockRow.ctrl.fire('change')
  check('T10d 点掉 clock → 真实层 id398.visible=false（浏览器里"改动即时生效"的那条链路）',
    env.scene.layers.find((x) => x.id === 398).visible === false)
  check('T10e 同一引用：window.__mpwUserProps.clock === false（脚本宿主下帧读到，不必刷新）',
    env.win.__mpwUserProps && env.win.__mpwUserProps.clock === false)
  check('T10f localStorage 差异表 = {"clock":false}', env.store['mpw-props:' + ID] === JSON.stringify({ clock: false }), env.store['mpw-props:' + ID])
  // 注意：`__mpwPropsApply`/`__mpwScriptProps` 由 bundle 在 **浏览器**（typeof window !== 'undefined'）里挂，
  //   Node 单测拿不到 → lastApply 允许为 null；本组用"真实层字段"证明链路（T10d/T10j/T10k）。
  check('T10g 诊断更新：values.clock=false / conditions.off 7 条（lastApply 浏览器侧才有）',
    env.win.__mpwProps.values.clock === false && env.win.__mpwProps.conditions.off.length === 7
    && (env.win.__mpwProps.lastApply === null || env.win.__mpwProps.lastApply.applied > 0),
    'off=' + env.win.__mpwProps.conditions.off.join(',') + ' lastApply=' + JSON.stringify(env.win.__mpwProps.lastApply))
  check('T10h 面板同步：7 行被门控隐藏（size/_24h/newproperty22…）',
    ['size', '_24h', 'newproperty22', 'newproperty23', 'newproperty24', 'newproperty25', 'newproperty21']
      .every((k) => env.r.propsPanel.api.rows[k].row.style.display === 'none'))
  check('T10i 门控下不改真实字段：clock=false 时 pointsize 仍是作者值 20',
    env.scene.layers.find((x) => x.id === 398).__text.pointsize === 20)
  // 勾回来 + 拖字号 → 字号绑定生效
  clockRow.ctrl.checked = true
  clockRow.ctrl.fire('change')
  const sizeRow = env.r.propsPanel.api.rows.size
  sizeRow.ctrl.value = '36'
  sizeRow.ctrl.fire('input')
  check('T10j 勾回 clock + 拖 size=36 → 真实层 pointsize=36 且差异表含两项',
    env.scene.layers.find((x) => x.id === 398).__text.pointsize === 36
    && JSON.parse(env.store['mpw-props:' + ID]).size === 36, env.store['mpw-props:' + ID])
  // combo → 脚本属性（demo 侧链路：select 改动 → applyScriptProps → 脚本宿主对象上的字面量）
  const combo = env.r.propsPanel.api.rows.newproperty23
  combo.ctrl.value = '1'
  combo.ctrl.fire('change')
  const sp = env.sceneObj.objects.find((o) => o.id === 398).text.scriptproperties
  check('T10k 面板选「MM/DD/YYYY」→ sceneObj 里脚本属性字面量 useMMDDYYYY=true（宿主下帧读它）',
    sp.useMMDDYYYY === true && sp.useYYYYMMDD === false, 'MMDD=' + sp.useMMDDYYYY + ' YYYY=' + sp.useYYYYMMDD)
  {
    // 端到端（demo 路径）：面板改的 combo → 脚本宿主跑一帧 → 时钟文本日期段按所选格式
    const { applySceneScripts, createScriptCache } = await import('../elysia/scene-scripts.js')
    applySceneScripts(env.sceneObj, 0, { scriptCache: createScriptCache(), renderObjects: env.sceneObj.objects, userProps: env.win.__mpwUserProps, canvasSize: { x: 3840, y: 2160 }, onError: () => {} })
    const txt = String(env.sceneObj.objects.find((o) => o.id === 398).text.value || '')
    const n = new Date(), p2 = (x) => String(x).padStart(2, '0')
    check('T10l 端到端：面板选「MM/DD/YYYY」后脚本宿主产出的日期段就是 MM/DD/YYYY',
      txt.split('\n')[1] === p2(n.getMonth() + 1) + '/' + p2(n.getDate()) + '/' + n.getFullYear(), JSON.stringify(txt))
  }
  // 「恢复作者默认」
  env.r.propsPanel.api.reset.click()
  check('T10m 恢复作者默认 → 差异表清空 + 真实层 pointsize 回 20 + clock=true',
    Object.keys(env.store).length === 0 && env.scene.layers.find((x) => x.id === 398).__text.pointsize === 20
    && env.scene.layers.find((x) => x.id === 398).visible === true)
  // ?nopanel / embed
  const np = mkEnv('?id=' + ID + '&nopanel', SCHEMA, lib.mergeUserProps({ schema: SCHEMA }).props, new Set())
  check('T10n ?nopanel：不建面板（无 #mpw-props-panel / 无按钮），但绑定仍生效、__mpwProps 仍上报',
    np.r.propsPanel === null && !np.doc2.body.children.some((c) => c.id === 'mpw-props-panel')
    && !np.bar.children.some((c) => c.id === 'mpw-props-btn') && !!np.win.__mpwProps && np.win.__mpwProps.panel === null)
  const em = mkEnv('?id=' + ID + '&embed=1', SCHEMA, lib.mergeUserProps({ schema: SCHEMA }).props, new Set())
  const emRoot = em.doc2.body.children.find((c) => c.id === 'mpw-props-panel')
  const emBtn = em.bar.children.find((c) => c.id === 'mpw-props-btn')
  check('T10o embed=1（壁纸 iframe）：面板默认收起 + 按钮隐藏（pointer-events:none 下不留死 UI）',
    emRoot && emRoot.className === '' && emBtn && emBtn.style.display === 'none',
    'className="' + (emRoot && emRoot.className) + '" btn=' + (emBtn && emBtn.style.display))
  const ub = mkEnv('?id=' + ID + '&props=clock=0', SCHEMA, lib.mergeUserProps({ schema: SCHEMA, url: lib.parsePropsQuery('clock=0') }).props,
    lib.mergeUserProps({ schema: SCHEMA, url: lib.parsePropsQuery('clock=0') }).locked)
  check('T10p URL ?props=clock=0：装载时真实层已关 + 面板控件置灰 + 改它被忽略（记一条日志）',
    ub.scene.layers.find((x) => x.id === 398).visible === false
    && ub.r.propsPanel.api.rows.clock.ctrl.disabled === true
    && ub.logs.some((m) => /被 URL \?props= 锁定/.test(m) || /锁定/.test(m)),
    (ub.logs.filter((m) => /锁定/.test(m))[0] || '').slice(0, 60))
}


// ═══════════════════════════════════════════════════════════════════════════════
// P-64（用户第 5/6/11/14/15/16/17/18/22 项）新增断言
//   T11 实体解码 / T12 `<img>` 条目 / T13 排版·输入框·勾选框 / T14 浮窗取色器+图标 /
//   T15 改文本与属性即时生效（invalidateUserProps + 时段选层重算）
// ═══════════════════════════════════════════════════════════════════════════════
const CORPUS = process.env.MPW_SCENE_ROOT || path.join(WS, 'allwallpaper', 'dd')
const MOON_DIR = CORPUS + '/3326873240'
const MOON_SCHEMA = fs.existsSync(MOON_DIR + '/project.json')
  ? JSON.parse(fs.readFileSync(MOON_DIR + '/project.json', 'utf8')).general.properties : null
const CSS = (() => { const m = /<style>([\s\S]*?)<\/style>/.exec(HTML); return m ? m[1] : '' })()

console.log('[T11] P-64 用户第 11 项：HTML 实体解码（只改**显示**，不动识别层的键名/condition）')
{
  const { API } = runPanelBlock()
  // 真机原样（日月循环 3326873240 的 x/x1/x2/x3/y/y1/y2/y3）：首个 `&nbsp` **没有分号**，
  //   bundle 的 propLabel 只替换 /&nbsp;/g → 面板上显示成 "&nbsp星期位置X"（用户报的那条）
  const REAL = '&nbsp星期位置X  Week position X'
  check('T11a 真机串 `&nbsp星期位置X  Week position X` → `星期位置X Week position X`（legacy 无分号 + 空白折叠）',
    API.displayLabel(REAL) === '星期位置X Week position X', JSON.stringify(API.displayLabel(REAL)))
  check('T11b 带分号形式（`&nbsp;&nbsp;&nbsp;A`）同样吃干净，且不再有残留实体',
    API.displayLabel('&nbsp;&nbsp;&nbsp;A') === 'A' && !/&[a-zA-Z#]/.test(API.displayLabel('&nbsp;&nbsp;&nbsp;A')),
    JSON.stringify(API.displayLabel('&nbsp;&nbsp;&nbsp;A')))
  check('T11c 命名实体真值表：&amp; &lt; &gt; &quot; &#39; &apos; 全部还原成字符',
    API.displayLabel('a&amp;b') === 'a&b' && API.displayLabel('&lt;b&gt;') === '<b>'
    && API.displayLabel('&quot;q&quot;') === '"q"' && API.displayLabel('&#39;s&#39;') === "'s'"
    && API.displayLabel('&apos;t&apos;') === "'t'",
    [API.displayLabel('a&amp;b'), API.displayLabel('&lt;b&gt;'), API.displayLabel('&quot;q&quot;'), API.displayLabel('&#39;s&#39;')].join(' | '))
  check('T11d 数字实体（十进制 / 十六进制 / 不常见码点）也能解',
    API.displayLabel('A&#160;B') === 'A B' && API.displayLabel('x&#x27;y') === "x'y" && API.decodeEntities('&#x1F5BC;') === '\uD83D\uDDBC',
    [API.displayLabel('A&#160;B'), API.displayLabel('x&#x27;y'), API.decodeEntities('&#x1F5BC;')].join(' | '))
  check('T11e 只解一次：`&amp;lt;` → `&lt;`（不会二次解码成 `<`）', API.decodeEntities('&amp;lt;') === '&lt;', API.decodeEntities('&amp;lt;'))
  check('T11f legacy 消歧：`&ltx`/`&ampx` 不是实体 → 原样保留（不误伤作者普通文本）',
    API.decodeEntities('&ltx') === '&ltx' && API.decodeEntities('&ampx') === '&ampx')
  check('T11g 未知实体原样保留（`&foo;` 不消失、不猜）', API.decodeEntities('&foo; &bar') === '&foo; &bar', API.decodeEntities('&foo; &bar'))
  check('T11h 换行按作者意图保留，行内多空格按 HTML 折叠成 1 个',
    API.displayLabel('A  B\nC   D') === 'A B\nC D' && API.displayLabel('A&nbsp;\nB') === 'A\nB',
    JSON.stringify(API.displayLabel('A  B\nC   D')) + ' / ' + JSON.stringify(API.displayLabel('A&nbsp;\nB')))
  check('T11i 识别层零改动：解码只发生在显示出口，`it.key`/`condition` 不被改写',
    API.displayLabel('x') === 'x' && lib.propLabel('&nbsp星期位置X') === '&nbsp星期位置X',
    'propLabel(原样)=' + lib.propLabel('&nbsp星期位置X'))
  if (MOON_SCHEMA) {
    let bad = 0, total = 0, samples = []
    for (const [k, v] of Object.entries(MOON_SCHEMA)) {
      total++
      const out = API.displayLabel(lib.propLabel(v && v.text))
      if (/&[a-zA-Z#][a-zA-Z0-9]*;?/.test(out)) { bad++; if (samples.length < 3) samples.push(k + '=' + JSON.stringify(out.slice(0, 30))) }
    }
    check('T11j 日月循环 3326873240 全表 ' + total + ' 条作者 text：解码后**零**实体残留（含 31 条无分号 &nbsp）',
      bad === 0 && total === 104, 'bad=' + bad + ' ' + samples.join(','))
  } else check('T11j SKIP（语料里没有 3326873240/project.json）', true)
  {
    // 全语料扫描（只读 project.json，不碰 scene.pkg）：把"面板会显示出来的实体"一网打尽
    let pkgs = 0, bad = 0, badSample = []
    try {
      for (const d1 of fs.readdirSync(CORPUS)) {
        const dir = CORPUS + '/' + d1
        if (!fs.existsSync(dir + '/project.json')) continue
        pkgs++
        const sc = JSON.parse(fs.readFileSync(dir + '/project.json', 'utf8')).general.properties || {}
        for (const [k, v] of Object.entries(sc)) {
          const out = API.displayLabel(lib.propLabel(v && v.text))
          if (/&[a-zA-Z#][a-zA-Z0-9]*;?/.test(out)) { bad++; if (badSample.length < 3) badSample.push(d1 + ':' + k) }
          for (const o of ((v && v.options) || [])) {
            const ol = API.displayLabel(lib.propLabel(o && o.label))
            if (/&[a-zA-Z#][a-zA-Z0-9]*;?/.test(ol)) { bad++; if (badSample.length < 3) badSample.push(d1 + ':' + k + '.opt') }
          }
        }
      }
    } catch (e) { /* 语料缺目录 → 只报 0 */ }
    check('T11k 全语料 ' + pkgs + ' 包属性标签/选项标签：解码后零实体残留', bad === 0, 'bad=' + bad + ' ' + badSample.join(','))
  }
}

console.log('[T12] P-64 用户第 14 项：`imgsrc http photogz…` 超长名是什么 + 显示收敛（日月循环 3326873240）')
{
  const { API, doc } = runPanelBlock()
  if (!MOON_SCHEMA) {
    check('T12 SKIP（语料里没有 3326873240/project.json）', true)
  } else {
    const D2 = lib.mergeUserProps({ schema: MOON_SCHEMA })
    const model2 = lib.propsPanelModel(MOON_SCHEMA, D2.props, { locked: D2.locked })
    const imgItems = model2.items.filter((i) => /^imgsrc/.test(i.key))
    check('T12a 该包有 10 条 `imgsrc…` 键名（作者 text 是 `<img src=…>`，type=color/bool/text 都有）',
      imgItems.length === 10 && imgItems.some((i) => i.type === 'color') && imgItems.some((i) => i.type === 'bool'),
      imgItems.map((i) => i.type).join(','))
    const pureHtml = imgItems.filter((i) => lib.propLabel(MOON_SCHEMA[i.key].text) === '')
    check('T12b 键名长到 195 字符；10 条里 ' + pureHtml.length + ' 条 `propLabel` 归一化后**是空串**（面板旧写法只能回退显示整条键名）',
      imgItems.every((i) => i.key.length >= 60) && pureHtml.length === 9
      && imgItems.every((i) => /<img\b/i.test(MOON_SCHEMA[i.key].text)),
      'maxKey=' + Math.max(...imgItems.map((i) => i.key.length)) + ' pureHtml=' + pureHtml.length)
    const sizeKey = imgItems.map((i) => i.key).find((k) => API.imgSizeOf(MOON_SCHEMA[k].text) === '2000×1')
    check('T12c 判据：`<img …>` → htmlKindOf="img"，并从 width/height 属性抓出作者写的尺寸',
      imgItems.every((i) => API.htmlKindOf(MOON_SCHEMA[i.key].text) === 'img') && !!sizeKey && API.imgSizeOf(MOON_SCHEMA[sizeKey].text) === '2000×1',
      'sizeKey=' + (sizeKey ? sizeKey.slice(0, 18) + '…' : 'none'))
    const labelled = imgItems.map((i) => API.labelFor(i, MOON_SCHEMA))
    check('T12d 显示名收敛：纯 HTML 的 → `🖼 图片 <宽×高>`；带作者文字的 → 作者文字。**没有任何一条**再显示 `imgsrc…` 键名',
      labelled.filter((s, i) => pureHtml.indexOf(imgItems[i]) >= 0).every((s) => /^🖼 图片( \d+×\d+)?$/.test(s))
      && labelled.every((s) => !/^imgsrc/.test(s) && s.length <= 40),
      labelled.map((s) => s.slice(0, 12)).slice(0, 4).join(' | '))
    check('T12e 悬停 title 保留全文（键名 + 作者 HTML 原文 + 一句"这是什么"）',
      /key: imgsrc/.test(API.labelTitleFor(imgItems[0], MOON_SCHEMA))
      && /<img src=/.test(API.labelTitleFor(imgItems[0], MOON_SCHEMA))
      && /分隔线/.test(API.labelTitleFor(imgItems[0], MOON_SCHEMA)),
      API.labelTitleFor(imgItems[0], MOON_SCHEMA).split('\n')[2])
    check('T12f 非 HTML 的空标签条目退化策略：截断键名 + 省略号（≤24 字符），不再横向顶破行',
      API.labelFor({ key: 'a'.repeat(60), type: 'text', label: '' }, {}) === 'a'.repeat(24) + '…'
      && API.labelFor({ key: 'short', type: 'text', label: '' }, {}) === 'short')
    // 真建一次面板：标签文本 + title + data-bound 都落地
    const host2 = mkEl('div'); host2.ownerDocument = doc
    const api2 = API.build(host2, model2, { schema: MOON_SCHEMA, boundNames: { } })
    const k0 = imgItems[0].key
    check('T12g 面板行：标签就是占位符、title 带原文、行未被裁剪（lb 无 maxHeight 内联样式）',
      api2.rows[k0].label.textContent === labelled[0] && /<img/.test(api2.rows[k0].label.title)
      && !api2.rows[k0].label.style.maxHeight,
      JSON.stringify(api2.rows[k0].label.textContent))
    check('T12h 第 6 项：`data-bound` 标出"这条在场景里没被引用"（作者装饰图片）',
      api2.rows[k0].row.getAttribute('data-bound') === '0'
      && api2.rows[k0].row.getAttribute('data-bound') === '0')
    // 真机第 11 项的直接证据：面板上 `x` 行的标签就是 `星期位置X Week position X`
    check('T12m 面板行 `x`（作者 text 首个 &nbsp 无分号）渲染成 `星期位置X Week position X`，无任何 `&`；combo 选项标签同样清洗',
      api2.rows.x.label.textContent === '星期位置X Week position X'
      && !/&/.test(api2.rows.x.label.textContent)
      && api2.rows.display.ctrl.children.every((o) => !/&/.test(String(o.textContent))),
      JSON.stringify(api2.rows.x.label.textContent))
    const last = model2.items[model2.items.length - 1]
    check('T12i 最后一条 = 声明（order=202 / text / 1083 字符，用户第 17 项说的"翻不到底"那条）',
      last.order === 202 && last.type === 'text' && MOON_SCHEMA[last.key].text.length > 1000,
      'order=' + last.order + ' type=' + last.type + ' len=' + MOON_SCHEMA[last.key].text.length)
    check('T12j 该条的完整文本**全部**进 DOM（旧实现被 max-height:2.6em 裁掉大半）',
      api2.rows[last.key].label.textContent.length === API.displayLabel(last.label).length
      && api2.rows[last.key].label.textContent.length > 1000,
      'domLength=' + api2.rows[last.key].label.textContent.length)
    // ⑤(第 6 项) 尾部"跳过的条目"清单：把没渲染的类型也解析出来给用户看（默认折叠）
    const skTot = ['html', 'editor', 'unimpl', 'dead'].reduce((n, k) => n + model2.skipped[k].length, 0)
    check('T12k 尾部清单登记了全部跳过条目（日月循环 2 条：schemecolor 编辑器配色 + newproperty39 scenetexture），默认折叠',
      model2.skipped.editor.length === 1 && model2.skipped.unimpl.length === 1 && skTot === 2
      && /跳过 2 条/.test(api2.footer.children[0].textContent) && api2.skipBox.hidden === true
      && api2.skipBox.children.length === 2,
      JSON.stringify([api2.footer.children[0].textContent, api2.skipBox.children.map((c) => c.textContent.slice(0, 28))]))
    api2.skipBtn.fire('click')
    check('T12l 点「显示跳过的条目」→ 展开并逐条给出**原因 + 原始 type**（scenetexture / 编辑器配色），按钮文案翻转',
      api2.skipBox.hidden === false && api2.skipBtn.textContent === '收起跳过的条目'
      && api2.skipBox.children.some((c) => /scenetexture/.test(c.textContent))
      && api2.skipBox.children.some((c) => /schemecolor/.test(c.textContent)),
      api2.skipBox.children.map((c) => c.textContent.slice(0, 40)).join(' || '))
  }
}

console.log('[T13] P-64 用户第 17/18/22 项：行高由文本决定（末行可滚到）/ 输入框灰边 / Uiverse 勾选框（mpw_ 前缀）')
{
  // 第 17 项根因：旧 CSS 是 `.lb{flex:1;white-space:pre-line;overflow:hidden;text-overflow:ellipsis;max-height:2.6em}`
  //   + `.row{align-items:center}` → 行高被旁边控件钳住，长文本被裁且**永远滚不到**。
  const lbRule = /#mpw-props-panel \.lb\{([^}]*)\}/.exec(CSS)
  const rowRule = /#mpw-props-panel \.row\{([^}]*)\}/.exec(CSS)
  const panelRule = /#mpw-props-panel\{([^}]*)\}/.exec(CSS)
  check('T13a .lb 不再有 max-height / overflow:hidden / text-overflow:ellipsis（裁剪三件套已删）',
    !!lbRule && !/max-height/.test(lbRule[1]) && !/overflow\s*:\s*hidden/.test(lbRule[1]) && !/text-overflow/.test(lbRule[1]),
    lbRule && lbRule[1].slice(0, 90))
  check('T13b .lb 允许换行：white-space:pre-line + overflow-wrap:anywhere + min-width:0',
    !!lbRule && /white-space:pre-line/.test(lbRule[1]) && /overflow-wrap:anywhere/.test(lbRule[1]) && /min-width:0/.test(lbRule[1]))
  check('T13c .row 改 align-items:flex-start（行高 = max(文本排版高, 控件高)，控件不再决定行末位置）',
    !!rowRule && /align-items:flex-start/.test(rowRule[1]))
  check('T13d 容器 overflow-y:auto + 底部 padding 18px + scroll-padding-bottom（最后一行能完整滚进视野）',
    !!panelRule && /overflow-y:auto/.test(panelRule[1]) && /padding:6px 8px 18px/.test(panelRule[1]) && /scroll-padding-bottom:18px/.test(panelRule[1]),
    panelRule && panelRule[1].slice(0, 80))
  const PANEL_CSS = (CSS.match(/#mpw-props-panel[^{]*\{[^}]*\}/g) || []).join('\n')
  check('T13e 旧字符串回归守卫：`max-height:2.6em` / `text-overflow:ellipsis` 在**面板自己的规则**里已绝迹',
    !/max-height:2\.6em/.test(PANEL_CSS) && !/text-overflow:ellipsis/.test(PANEL_CSS) && PANEL_CSS.length > 200)
  {
    const { API, doc } = runPanelBlock()
    const host = mkEl('div'); host.ownerDocument = doc
    const D3 = lib.mergeUserProps({ schema: SCHEMA })
    const m3 = lib.propsPanelModel(SCHEMA, D3.props, { locked: D3.locked })
    const api3 = API.build(host, m3, { schema: SCHEMA })
    check('T13f 每行标签 textContent = 清洗后的全文（DOM 里没有 ellipsis 截断的中间态）',
      Object.keys(api3.rows).filter((k) => !api3.rows[k].group)
        .every((k) => api3.rows[k].label.textContent === API.labelFor(api3.rows[k].item, SCHEMA)))
    const icoRule = /#mpw-props-panel \.ico\{([^}]*)\}/.exec(CSS)
  const ROWS_SRC = (() => { const i = HTML.indexOf('var rows = {}, order = []'); const j = HTML.indexOf('host.appendChild(ft)', i); return (i >= 0 && j > i) ? HTML.slice(i, j) : '' })()
  check('T13f2 行宽不因图标变化：**行/分组**构建段里零 `API.icon(` 调用（唯一的图标在表头「恢复默认」按钮），且 `.ico` 固定 14px + flex:0 0 auto',
    !!icoRule && /flex:0 0 auto/.test(icoRule[1]) && /width:14px/.test(icoRule[1]) && /height:14px/.test(icoRule[1])
    && ROWS_SRC.length > 800 && !/API\.icon\(/.test(ROWS_SRC)
    && /reset\.appendChild\(API\.icon\(doc, 'undo'\)\)/.test(HTML),
    '行段 ' + ROWS_SRC.length + ' 字符内 API.icon 调用 ' + ((ROWS_SRC.match(/API\.icon\(/g) || []).length))
  check('T13g 行结构 = .lb + .ct（控件容器 flex:none）+ .vl，控件不参与标签宽度分配',
      !!api3.rows.clock.row.children.find((c) => c.className === 'lb')
      && !!api3.rows.clock.row.children.find((c) => c.className === 'ct')
      && !!api3.rows.clock.row.children.find((c) => c.className === 'vl'))
  }
  // 第 18 项：输入框 = DSH 口径（灰边 → 聚焦黑边；不要黄框/outline 高亮）
  const inRule = /#mpw-props-panel input\[type=text\],#mpw-props-panel select\{([^}]*)\}/.exec(CSS)
  const inFocus = /#mpw-props-panel input\[type=text\]:focus,#mpw-props-panel select:focus\{([^}]*)\}/.exec(CSS)
  check('T13h 输入框 1px 灰边（#666）+ 去默认高亮（outline:none）', !!inRule && /border:1px solid #666/.test(inRule[1]) && /outline:none/.test(inRule[1]), inRule && inRule[1].slice(0, 70))
  check('T13i :focus 把灰换成黑（深色主题=亮前景 #eee）+ 无 box-shadow 光晕', !!inFocus && /border-color:#eee/.test(inFocus[1]) && /box-shadow:none/.test(inFocus[1]))
  check('T13j 输入框规则里没有任何黄色/品牌色描边（用户点名的"黄色边框"）',
    !!inRule && !/#fc8|#ffc|#ff0|yellow|gold/i.test(inRule[1]) && !!inFocus && !/#fc8|#ffc|#ff0|yellow|gold/i.test(inFocus[1]))
  /* 1(2026-10-12 集成修正)：原判据扫的是**整页**第一个 <style>（CSS）=> 新加的**效果面板**
     （MPW-FX-PANEL，**另一个面板**）有颜色滑杆 => 用了原生 input[type=color] => 被误伤。
     本条原意 = 「**属性面板**里不再有原生色控件」=> 扫描范围收敛到**属性面板自己的 CSS 切片**：
     面板样式段的**整段区域**（起点 = 面板自己的第一条样式，终点 = 第 16 项那个浮窗取色器的
     末条 `.mpw_picker*` 规则；浮窗是**面板自己**的控件，所以留在切片内）—— 不是"只收带
     `#mpw-props-panel` 前缀的选择器"：夹在面板样式段中间、**没写前缀**的裸规则也在切片里 ⇒ 照样抓得住。
     强度不减 + 不空转：切片退化（两个锚点定位失败 / 长度不够）本条也红（下面的长度门槛）；
     T13k-mut 把违规规则塞进**真 demo.html 的 CSS 文本**里、再走**同一个**切片函数与**同一个**判据 */
  const propsPanelSliceOf = (css) => {
    const cands = [css.indexOf('#mpw-props-panel'), css.indexOf('.mpw_picker')].filter((i) => i >= 0)
    const s = cands.length ? Math.min(...cands) : -1
    const rules = css.match(/\.mpw_picker[^{]*\{[^}]*\}/g) || []
    const tail = rules[rules.length - 1] || ''
    const e = tail ? css.lastIndexOf(tail) + tail.length : -1
    return (s >= 0 && e > s) ? css.slice(s, e) : ''
  }
  const t13kOk = (css) => {
    const sl = propsPanelSliceOf(css)
    return sl.length > 2000 && !/input\[type=color\]/.test(sl)
  }
  const PROPS_PANEL_CSS = propsPanelSliceOf(CSS)
  const FX_COLOR_RULES = (CSS.match(/#mpw-fx-panel[^{]*input\[type=color\][^{]*\{[^}]*\}/g) || []).length
  check('T13k 面板里不再有 `input[type=color]`（第 16 项换成浮窗色块；旁边 MPW-FX-PANEL 的色滑杆不在切片内）',
    t13kOk(CSS),
    '面板切片 ' + PROPS_PANEL_CSS.length + ' 字符（#mpw-props-panel* + .mpw_picker* 浮窗）· 效果面板 MPW-FX-PANEL 的原生色控件规则 ' + FX_COLOR_RULES + ' 条在切片外')
  /* ★分辨力自证（**接线**版，不是"切片 + 违规串"那种同义反复）：违规规则插进**真 demo.html 的 CSS
     文本**里、面板切片**内部**的锚点（面板自己的 `.lb` 规则之前）⇒ 同一个 t13kOk 必须翻转。
     切片为空或函数写坏时这条会红（说明"上面那条绿"确实是判据在工作，不是空转）。 */
  const MUT_COLOR_RULE = 'input[type=color]{color:red}'
  const CSS_MUT = CSS.replace('#mpw-props-panel .lb{', MUT_COLOR_RULE + '\n#mpw-props-panel .lb{')
  check('T13k-mut 分辨力自证：把 `input[type=color]` 规则塞进真 demo.html 的面板切片里 ⇒ 上面必红',
    CSS_MUT !== CSS && t13kOk(CSS) && !t13kOk(CSS_MUT),
    '变异后切片 ' + propsPanelSliceOf(CSS_MUT).length + ' 字符；t13kOk: 真=' + t13kOk(CSS) + ' 变异=' + t13kOk(CSS_MUT))
  // 第 22 项：Uiverse 勾选框，类名加 mpw_ 前缀
  check('T13l Uiverse 勾选框样式在：.mpw_cb / .mpw_checkmark + 1.3em 方块 + 原作者的紫粉渐变',
    /#mpw-props-panel \.mpw_cb\{/.test(CSS) && /#mpw-props-panel \.mpw_checkmark\{/.test(CSS)
    && /height:1\.3em;width:1\.3em/.test(CSS)
    && /linear-gradient\(45deg,rgb\(100,61,219\) 0%,rgb\(217,21,239\) 100%\)/.test(CSS))
  check('T13m 勾选态/未选态/对勾位移三条选择器齐备（照抄 Uiverse，仅换前缀）',
    /\.mpw_cb input:checked ~ \.mpw_checkmark\{/.test(CSS) && /\.mpw_cb input ~ \.mpw_checkmark\{/.test(CSS)
    && /\.mpw_cb \.mpw_checkmark:after\{/.test(CSS))
  const CSS_NOCOMMENT = CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  check('T13n 没有裸 `.container` / `.checkmark` 类（前缀就是防打架的全部意义）',
    !/(^|[^_a-zA-Z-])\.container\b/.test(CSS_NOCOMMENT) && !/(^|[^_a-zA-Z-])\.checkmark\b/.test(CSS_NOCOMMENT))
  {
    const { API, doc } = runPanelBlock()
    const host = mkEl('div'); host.ownerDocument = doc
    const D4 = lib.mergeUserProps({ schema: SCHEMA })
    const m4 = lib.propsPanelModel(SCHEMA, D4.props, { locked: D4.locked })
    const api4 = API.build(host, m4, { schema: SCHEMA })
    const r = api4.rows.clock
    const wrap = r.row.children.find((c) => c.className === 'ct').children[0]
    check('T13o bool 控件结构 = <label class="mpw_cb"><input type=checkbox><div class="mpw_checkmark">（input 在 checkmark **之前**，`~` 选择器才生效）',
      wrap.tagName === 'LABEL' && wrap.className === 'mpw_cb' && wrap.children[0] === r.ctrl
      && wrap.children[1].className === 'mpw_checkmark' && r.ctrl.type === 'checkbox')
    check('T13p 换成 Uiverse 结构后取值链路不变：checked/disabled/change 仍走同一个 input',
      (r.ctrl.checked = false) === false && r.readValue() === false && r.ctrl.disabled === false)
  }
}

console.log('[T14] P-64 用户第 16 项：浮窗 HSV 取色器（与插件 dsh-mpkg-wallpaper 同一套）+ 图标集')
{
  const { API, doc, win: win0 } = runPanelBlock()
  check('T14a 图标集对齐 docs/SVG-ICONS.md：settings 路径逐字一致 + 去 lucide 类名 + currentColor 线条',
    API.ICONS.settings.indexOf('M9.671 4.136a2.34 2.34 0 0 1 4.659 0') > 0
    && API.ICONS.settings.indexOf('stroke="currentColor"') > 0 && API.ICONS.settings.indexOf('fill="none"') > 0
    && !/class="lucide/.test(API.ICONS.settings) && !/xmlns=/.test(API.ICONS.settings))
  // ③(P-64 用户第 2 条反馈) `<svg viewBox>` 无 width/height 时按替换元素默认 300×150 参与布局 →
  //   在面板外（顶栏）没有 CSS 约束可兜，整条被撑宽。**尺寸必须写进 svg 本身**。
  check('T14a2 每个图标 svg 都带显式 width/height=' + API.ICON_SIZE + ' + display:block（缺了就会按 300×150 撑宽容器）',
    Object.keys(API.ICONS).every((k) => {
      const s2 = API.ICONS[k]
      return new RegExp('width="' + API.ICON_SIZE + '"').test(s2) && new RegExp('height="' + API.ICON_SIZE + '"').test(s2)
        && /viewBox="0 0 24 24"/.test(s2) && /display:block/.test(s2)
    }),
    Object.keys(API.ICONS).length + ' 个图标全部显式定尺寸（缺尺寸的：' + (Object.keys(API.ICONS).filter((k) => !/width="14"/.test(API.ICONS[k])).join(',') || '无') + '）')
  check('T14a3 顶栏 ⚙ 按钮**不含 SVG**（用户第 2 条反馈：整条顶栏被 SVG 撑宽）——回落成 P-64 之前的文字形态',
    (() => {
      const host = mkEl('div'); host.ownerDocument = doc
      const D0 = lib.mergeUserProps({ schema: SCHEMA })
      const m0 = lib.propsPanelModel(SCHEMA, D0.props, { locked: D0.locked })
      const api0 = API.build(host, m0, { schema: SCHEMA })
      void api0
      // 顶栏按钮在装载块里构造（不在面板块）→ 用源码断言：btnEl.textContent = '⚙ 属性' 且不再 appendChild(icon)
      return /btnEl\.textContent = '⚙ 属性'/.test(HTML) && !/btnIcon\.innerHTML = API\.ICONS\.settings/.test(HTML)
    })())
  check('T14b undo-2 / images / moon / sun / refresh-cw / eye / eye-off 等用户给的图标都在（含第 7 项未知的占位说明）',
    ['undo', 'images', 'moon', 'sun', 'refresh', 'eye', 'eyeOff', 'download', 'play', 'warn'].every((k) => API.ICONS[k] && /viewBox="0 0 24 24"/.test(API.ICONS[k])))
  check('T14c 面板按钮用图标而非 emoji：恢复默认按钮里是 undo-2 的 path',
    (() => {
      const host = mkEl('div'); host.ownerDocument = doc
      const D5 = lib.mergeUserProps({ schema: SCHEMA })
      const m5 = lib.propsPanelModel(SCHEMA, D5.props, { locked: D5.locked })
      const api5 = API.build(host, m5, { schema: SCHEMA })
      return api5.reset.children.some((c) => c.className === 'ico' && /M9 14 4 9l5-5/.test(String(c.innerHTML)))
    })())
  // 开浮窗：点色块（hina newproperty24 是 color，绑到真实层 color）
  const host = mkEl('div'); host.ownerDocument = doc
  const D6 = lib.mergeUserProps({ schema: SCHEMA })
  const props6 = D6.props
  const m6 = lib.propsPanelModel(SCHEMA, props6, { locked: D6.locked })
  const scene6 = mkScene(props6)
  const boundColorLayer = (() => {
    for (const l of scene6.layers) if (l.__bindRaw && l.__bindRaw.color && (l.__bindRaw.color.user === 'newproperty24' || (l.__bindRaw.color.user || {}).name === 'newproperty24')) return l
    return null
  })()
  const calls = []
  const api6 = API.build(host, m6, {
    schema: SCHEMA,
    onChange: (k, v) => { props6[k] = lib.normalizePropValue(SCHEMA[k] && SCHEMA[k].type, v, props6[k]); calls.push([k, props6[k]]); lib.applyUserProperties(scene6, props6, { schema: SCHEMA }) },
  })
  const sw = api6.rows.newproperty24.ctrl
  check('T14d 色块按钮：class=mpw_colorSwatch + data-mpw-picker-anchor=键名 + 初值=作者色 hex（插件同款锚点约定）',
    sw.className === 'mpw_colorSwatch' && sw.getAttribute('data-mpw-picker-anchor') === 'newproperty24' && sw.value === '#8776d4',
    sw.value)
  check('T14e 未点开时没有浮窗（按需创建，不是常驻 DOM）', API.pickerOpen() === false)
  sw.fire('click')
  const wrap = API.pickerEl()
  const cls = wrap ? wrap.children.map((c) => c.className) : []
  check('T14f 点色块 → 浮窗出现，结构 = 色相条 + SV 面板 + 底部（预览/hex 输入/确定），类名 mpw_picker*',
    API.pickerOpen() === true && wrap.className === 'mpw_pickerWrap'
    && cls.join(',') === 'mpw_pickerHue,mpw_pickerSV,mpw_pickerBottom'
    && wrap.parent === doc.body, cls.join(','))
  check('T14g 浮窗定位做了上/下防溢出（内联 left/top 有值；插件同款 wrapH≈190）',
    /px$/.test(String(wrap.style.left)) && /px$/.test(String(wrap.style.top)), wrap.style.left + ',' + wrap.style.top)
  const hexInput = wrap.children[2].children[1]
  const okBtn = wrap.children[2].children[2]
  hexInput.value = '#ff8800'
  hexInput.fire('change')
  check('T14h hex 输入框回车/change 立即刷新预览与手柄位置（hexToHsv→refresh）',
    wrap.children[2].children[0].style.background === '#ff8800' && hexInput.value === '#ff8800',
    String(wrap.children[2].children[0].style.background))
  okBtn.fire('click')
  check('T14i 点「确定」→ 浮窗关闭 + 通过 onChange 写回**线性 0..1**（#ff8800 → "1 0.533333 0"）',
    API.pickerOpen() === false && calls.length === 1 && calls[0][0] === 'newproperty24' && calls[0][1] === '1 0.533333 0',
    JSON.stringify(calls[0] || null))
  check('T14j 写回穿透到真实渲染层：该层 color = [1, 0.533333, 0]（面板→bundle→层字段）',
    !!boundColorLayer && Math.abs(boundColorLayer.color[0] - 1) < 1e-6 && Math.abs(boundColorLayer.color[1] - 0.533333) < 1e-6 && Math.abs(boundColorLayer.color[2]) < 1e-6,
    JSON.stringify(boundColorLayer && boundColorLayer.color))
  check('T14k 色块自身跟着变成新色（无原生 color input 也有视觉反馈）', sw.value === '#ff8800', sw.value)
  check('T14l 0..1 ↔ hex 往返：面板 API 与 bundle 两处实现一致（含 0/1 边界与 0.5）',
    ['0 0 0', '1 1 1', '0.5 0.5 0.5', '0.2 0.4 0.6'].every((c) => API.hexToColor(API.colorToHex(c)) === lib.hexToColorProp(lib.colorPropToHex(c)))
    && API.colorToHex(API.hexToColor('#ff8800')) === '#ff8800')
  check('T14m API.hexToColor 与 hsv 往返（#808080 → hsv → #808080）稳定',
    API.hsvToHex(API.hexToHsv('#808080').h, API.hexToHsv('#808080').s, API.hexToHsv('#808080').v) === '#808080')
  // 关闭路径：Esc + 点外部（插件同款，且 window 监听成对增删不泄漏）
  sw.fire('click'); await new Promise((r) => setTimeout(r, 1))
  doc.fire('keydown', { key: 'Escape' })
  check('T14n Esc 关闭浮窗', API.pickerOpen() === false && (doc._ls.mousedown || []).length === 0,
    'open=' + API.pickerOpen() + ' listeners=' + (doc._ls.mousedown || []).length)
  sw.fire('click'); await new Promise((r) => setTimeout(r, 1))
  doc.fire('mousedown', { target: mkEl('div') })
  check('T14o 点浮窗外部关闭浮窗（且 document 上的 outside 监听已解绑，不泄漏）',
    API.pickerOpen() === false && (doc._ls.mousedown || []).length === 0,
    'listeners=' + (doc._ls.mousedown || []).length)
  // 快速"开→确定→开→Esc"（不 await）：插件里 setTimeout 注册 outside 的写法会漏掉一个永不解除的监听
  for (let i = 0; i < 3; i++) { sw.fire('click'); API.closePicker() }
  sw.fire('click'); await new Promise((r) => setTimeout(r, 1)); API.closePicker()
  await new Promise((r) => setTimeout(r, 1))
  check('T14p 重复开关不堆积监听：document 的 mousedown 与 window 的 mousemove/mouseup 全部归零（延后注册带实例校验）',
    API.pickerOpen() === false && (doc._ls.mousedown || []).length === 0
    && (win0._ls.mousemove || []).length === 0 && (win0._ls.mouseup || []).length === 0,
    'doc.mousedown=' + (doc._ls.mousedown || []).length + ' win.mousemove=' + (win0._ls.mousemove || []).length + ' win.mouseup=' + (win0._ls.mouseup || []).length)
}

console.log('[T15] P-64 用户第 5/15 项：改文本/属性即时生效（文本同步取值 + invalidateUserProps + 时段选层重算）')
{
  // ①(demo.html 真源码切片) 文本同步取值：`{user:...}` 绑定时以用户属性为准
  const TS_SRC = sliceBlock(HTML, '// ═══ MPW-P64-TEXT-SYNC-BEGIN', '// ═══ MPW-P64-TEXT-SYNC-END')
  const f = new Function(TS_SRC + '\nreturn mpwTextSyncValue')()
  const gatedSet = new Set(['lockedProp'])
  check('T15a 文本同步取值真值表：绑定 + 用户表有值 → 用户值（面板改完不再被改回作者默认）',
    f({ user: 'newproperty55', value: '作者默认' }, { newproperty55: '面板改的新文字' }, () => false) === '面板改的新文字')
  check('T15b 绑定 + 用户表没这个键 → 回作者默认；被 condition 门控 → 也回作者默认',
    f({ user: 'x', value: 'authored' }, {}, () => false) === 'authored'
    && f({ user: 'lockedProp', value: 'authored' }, { lockedProp: 'user' }, (n) => gatedSet.has(n)) === 'authored')
  check('T15c 非绑定形态不受影响：脚本写回的 `{script,value}` / 裸字符串照旧',
    f({ script: 'x', value: 'scriptOut' }, { a: 1 }, () => false) === 'scriptOut' && f('plain', {}, () => false) === 'plain')
  check('T15d 真包证据：日月循环 3326873240 层 2045 文本1 的 text 节点就是 `{user:"newproperty55"}` 形态（第 5 项根因）',
    MOON_SCHEMA ? MOON_SCHEMA.newproperty55.type === 'textinput' && String(MOON_SCHEMA.newproperty55.text).indexOf('自定义文字') >= 0 : true,
    MOON_SCHEMA ? JSON.stringify(MOON_SCHEMA.newproperty55.value) : 'SKIP')

  // ②(invalidateUserProps) 真缓存 + 真函数：证明"只跑一次"的陷阱与面板复位修复
  const { applySceneScripts, createScriptCache, invalidateUserProps } = await import('../elysia/scene-scripts.js')
  const cache = createScriptCache()
  // 观测点 = 脚本节点自己的 value（`applyUserProperties` 存下收到的值，`update()` 返回它 →
  //   宿主写回 {script,value}.value）。NSL 跑在 vm 沙箱里，脚本里的 globalThis 不是宿主 global，不能用它观察。
  const scriptScene = { objects: [{ id: 7, text: { script: "var last=''; export function applyUserProperties(p){ last = p.custom } export function update(){ return last }", value: '' } }] }
  const run1 = (props) => {
    applySceneScripts(scriptScene, 0, { scriptCache: cache, renderObjects: scriptScene.objects, userProps: props, onError: () => {} })
    return scriptScene.objects[0].text.value
  }
  const v1 = run1({ custom: 'A' })
  const v2 = run1({ custom: 'B' })
  check('T15e 缓存陷阱实证：不复位时 applyUserProperties **只跑一次** → 第 2 次改属性脚本仍停在 A（"改了不生效"）',
    v1 === 'A' && v2 === 'A', 'v1=' + JSON.stringify(v1) + ' v2=' + JSON.stringify(v2))
  const nInv = invalidateUserProps(cache)
  const v3 = run1({ custom: 'C' })
  check('T15f 复位后（invalidateUserProps 返回复位条目数）脚本重新收到整张属性表：A → C',
    nInv >= 1 && v3 === 'C', 'nInv=' + nInv + ' v3=' + JSON.stringify(v3))

  // ③(装载块真源码切片) 面板改值 → 调 invalidate + 重算时段选层（合成场景：5 个时段层绑同一个 display）
  const SRC = sliceBlock(HTML, '  let propsPanel = null\n', "\n  // ①(2026-09-12) ?isolate=名称(逗号分隔)")
  check('T15g 装载块真源码里确实接了这两步（invalidateScriptPropsCache + applyTimeVariation 重算）',
    /invalidateScriptPropsCache\(\)/.test(SRC) && /lib\.applyTimeVariation\(scene/.test(SRC) && /TIME_PROP_KEYS/.test(SRC)
    && /boundNames: boundNames/.test(SRC) && /schema: propsSchema/.test(SRC))
  const SYN_SCHEMA = {
    timevarying: { type: 'bool', text: '随现实时间变化', value: true, order: 100, index: 0 },
    display: {
      type: 'combo', text: '时间段选择', value: '0', order: 101, index: 1, condition: '!timevarying.value',
      options: [{ label: '清晨 Morning', value: '0' }, { label: '白天 Day', value: '1' }, { label: '黄昏 Dusk', value: '2' }, { label: '夜晚 Night', value: '3' }, { label: '昼夜渐变', value: '4' }],
    },
    morningtime: { type: 'textinput', text: '清晨开始时间', value: '5', order: 102, index: 2, condition: 'timevarying.value' },
    opacity: { type: 'slider', text: '透明度', value: 50, min: 0, max: 100, step: 1, order: 103, index: 3 },
  }
  const mkSynScene = () => ({
    projH: 1080,
    layers: [
      { id: 11, name: 'morning', visible: true, __visibleRaw: { user: { name: 'display', condition: '0' }, value: true }, __bindRaw: { visible: { user: { name: 'display', condition: '0' }, value: true } } },
      { id: 12, name: 'day', visible: false, __visibleRaw: { user: { name: 'display', condition: '1' }, value: false } },
      { id: 13, name: 'dusk', visible: false, __visibleRaw: { user: { name: 'display', condition: '2' }, value: false } },
      { id: 14, name: 'night', visible: false, __visibleRaw: { user: { name: 'display', condition: '3' }, value: false } },
      { id: 15, name: 'mddn', visible: false, __visibleRaw: { user: { name: 'display', condition: '4' }, value: false } },
    ],
  })
  const mkSynEnv = (search, opts = {}) => {
    const { API, doc } = runPanelBlock()
    const win = { __mpwPropsPanel: API }
    const store = {}
    const synScene = mkSynScene()
    const synObj = { objects: [{ id: 7, text: { script: "var d=''; export function applyUserProperties(p){ d = p.display } export function update(){ return d }", value: '' }, scriptproperties: { tint: { user: 'morningtime', value: '5' } } }] }
    const logs = []
    win.__mpwPropsCtx = { map: opts.props, schema: SYN_SCHEMA, locked: new Set(), store: {}, save: (o) => { Object.assign(store, o) }, key: 'mpw-props:syn', cache: opts.cache || null, invalidate: opts.invalidate || null }
    const doc2 = Object.assign({}, doc)
    const bar = mkEl('div')
    doc2.getElementById = (id) => (id === 'bar' ? bar : null)
    doc2.body = mkEl('body')
    const g = new Function('document', 'window', 'localStorage', 'location', 'lib', 'scene', 'sceneObj', 'logf', 'URLSearchParams',
      SRC + '\nreturn { propsPanel, propsDiagPayload, propsPanelTimeArg, invalidateScriptPropsCache, propsBoundNames }')
    const r = g(doc2, win, { getItem: () => null, setItem: () => {}, removeItem: () => {} }, { search }, lib, synScene, synObj, (m) => logs.push(String(m)), URLSearchParams)
    return { r, win, doc2, bar, logs, scene: synScene, sceneObj: synObj, store }
  }
  const P = lib.mergeUserProps({ schema: SYN_SCHEMA })
  const inv = { n: 0 }
  const cache2 = createScriptCache()
  const env = mkSynEnv('?id=syn&hour=8', { props: P.props, cache: cache2, invalidate: (c) => { inv.n++; return invalidateUserProps(c) } })
  // 装载时的那一次（demo.html 主流程用同一个 propsPanelTimeArg 取参）
  env.win.__mpwTime = lib.applyTimeVariation(env.scene, Object.assign({ properties: P.props, log: () => {} }, env.r.propsPanelTimeArg(P.props, SYN_SCHEMA)))
  check('T15h 纯净装载：timevarying=true（默认）→ 按现实时钟选层；?hour=8 落在 morning（阈值 5/9/16/19）',
    env.r.propsPanelTimeArg(P.props, SYN_SCHEMA).time === null && env.win.__mpwTime.picked === 'morning' && env.scene.layers[0].visible === true,
    'picked=' + env.win.__mpwTime.picked)
  check('T15i `?time=` 仍是最高优先（P-61 口径不变）',
    mkSynEnv('?id=syn&time=3', { props: P.props }).r.propsPanelTimeArg(P.props, SYN_SCHEMA).time === '3')
  check('T15i2 display 被 condition 门控时（timevarying=true）**不**接管选层：即使 URL 把 display 设成 3 也走时钟',
    env.r.propsPanelTimeArg(Object.assign({}, P.props, { display: '3' }), SYN_SCHEMA).time === null)
  const tvRow = env.r.propsPanel.api.rows.timevarying
  tvRow.ctrl.checked = false
  tvRow.ctrl.fire('change')
  check('T15j 面板关掉「随现实时间变化」→ 内置时段选层**当帧重算**（timevarying=false + display="0" → 钉住 morning）',
    env.win.__mpwTime.mode === 'pin' && env.win.__mpwTime.picked === 'morning' && env.scene.layers[0].visible === true && env.scene.layers[3].visible === false,
    'mode=' + env.win.__mpwTime.mode + ' picked=' + env.win.__mpwTime.picked)
  const dpRow = env.r.propsPanel.api.rows.display
  dpRow.ctrl.value = '3'
  dpRow.ctrl.fire('change')
  check('T15k 面板选「夜晚 Night」(display=3) → 真实层 night 可见 / morning 关掉（用户第 15 项"改面板画面要跟着变"）',
    env.scene.layers[3].visible === true && env.scene.layers[0].visible === false && env.win.__mpwTime.picked === 'night',
    'picked=' + env.win.__mpwTime.picked + ' night=' + env.scene.layers[3].visible)
  check('T15l 每次改动都复位脚本缓存（invalidate 被调用，且真 cache 的条目 userPropsApplied 归 false）',
    inv.n >= 2 && env.r.invalidateScriptPropsCache() >= 0)
  {
    // 面板 → 脚本宿主端到端：把 env.sceneObj 的脚本挂进同一个 cache，跑 1 趟 → 改面板 → 再过 1 趟
    const runFrame = (t) => {
      applySceneScripts(env.sceneObj, t, { scriptCache: cache2, renderObjects: env.sceneObj.objects, userProps: env.win.__mpwUserProps, onError: () => {} })
      return env.sceneObj.objects[0].text.value
    }
    const v0 = runFrame(0)
    const before = [...cache2.map.values()].every((e) => e.userPropsApplied)
    dpRow.ctrl.value = '1'
    dpRow.ctrl.fire('change')     // ← 面板改值：内部 invalidateUserProps(cache2)
    const reset = [...cache2.map.values()].every((e) => !e.userPropsApplied)
    const v1 = runFrame(0.3)
    check('T15m 端到端：面板改值 → 缓存条目复位 → 脚本下一趟收到 display="1"（改前 ' + JSON.stringify(v0) + ' → 改后 ' + JSON.stringify(v1) + '）',
      before && reset && v1 === '1' && v0 !== '1', 'v0=' + JSON.stringify(v0) + ' reset=' + reset + ' v1=' + JSON.stringify(v1))
  }
  {
    const tRef = env.win.__mpwTime
    const opRow = env.r.propsPanel.api.rows.opacity
    opRow.ctrl.value = '80'
    opRow.ctrl.fire('input')
    check('T15n 与时段无关的属性（透明度）改动**不**重算选层（不抢层、不刷日志）：__mpwTime 引用不变',
      env.win.__mpwTime === tRef)
  }
  check('T15o 诊断新增字段（README 已登记）：entityDecoded / decorRows / timeVariation / scriptCache',
    ['entityDecoded', 'decorRows', 'timeVariation', 'scriptCache'].every((k) => k in env.win.__mpwProps)
    && env.win.__mpwProps.scriptCache.on === true && env.win.__mpwProps.timeVariation.picked === 'day',
    JSON.stringify({ tv: env.win.__mpwProps.timeVariation, sc: env.win.__mpwProps.scriptCache }))
  {
    // 无缓存（默认路径）：invalidate 不该被调用、诊断 scriptCache.on=false
    const env2 = mkSynEnv('?id=syn&hour=8', { props: lib.mergeUserProps({ schema: SYN_SCHEMA }).props })
    const r2 = env2.r.propsPanel.api.rows.timevarying
    r2.ctrl.checked = false
    r2.ctrl.fire('change')
    check('T15p `?scriptcache=0` 路径（无缓存句柄）：invalidate 是 0 次空操作、诊断 scriptCache.on=false —— 逐位等于改动前行为',
      env2.win.__mpwProps.scriptCache.on === false && env2.r.invalidateScriptPropsCache() === 0)
  }
  {
    // ②(P-64 第 6 项) `propsBoundNames`：层 `__bindRaw` + scene.json 原文里的 `"user"` 都算
    const bn = mkSynEnv('?id=syn', { props: lib.mergeUserProps({ schema: SYN_SCHEMA }).props }).r.propsBoundNames()
    check('T15r propsBoundNames 两路都通：层 `__bindRaw` → display；scene.json 原文 `"user"`（scriptproperties 里 combo/字符串形态）→ morningtime',
      bn.has('display') && bn.has('morningtime') && !bn.has('opacity'), [...bn].join(','))
  }
  check('T15q 脚本缓存接线（裁定 1 后 = 默认开、`?scriptcache=0` 关）：createScriptCache/invalidateUserProps 从 scene-scripts.js 导入并挂 window',
    // ①(P-243 起) 该 import 行还会带别的运行时入口（`syncScriptInput` 等）⇒ 收尾用 `[^}]*}` 容错，
    //   判据仍是"这四个名字同一条 import + 两条 window 挂载 + 默认开"。
    /import \{ applySceneScripts, createScriptCache, invalidateUserProps, dispatchScriptEvent[^}]*\}/.test(HTML)
    && /window\.__mpwScriptCache = sceneScriptCache/.test(HTML) && /window\.__mpwInvalidateUserProps = invalidateUserProps/.test(HTML)
    && /get\('scriptcache'\) !== '0'/.test(HTML))
}


// ═══════════════════════════════════════════════════════════════════════════════
// T16（P-64-MEDIA 用户第 9④ 项）媒体集成宿主接线（demo 侧）：真源码切片 + 假 DOM/假宿主 + 真包端到端
//   用户诉求：歌名/歌手/封面/进度/时长 + 音频响应。P-62 宿主侧已 109 断言，这里只钉**接线**。
// ═══════════════════════════════════════════════════════════════════════════════
console.log('[T16] P-64-MEDIA：媒体集成宿主接进 demo.html（P-62 四陷阱 A/B/C/D + 无媒体零派发 + ?media= 首帧投递 + ?lyrics=）')
{
  const { createScriptCache, dispatchScriptEvent, applySceneScripts } = await import('../elysia/scene-scripts.js')
  const { createMediaHost } = await import('../elysia/media-host.js')
  const { resolveLyrics, lyricsOverrideFromSearch } = await import('../elysia/media-lyrics.js')
  // 媒体块**整段**切片（含 `initMediaHost` IIFE）→ 能真跑"装载 + 首帧投递 + tick"完整路径。
  //   模块作用域依赖只有两个（sceneScriptCache / logf）→ 作为入参注入（切片单元自洽的既有口径）。
  const MEDIA_SRC = sliceBlock(HTML, '// `?media=k=v,k=v` → 对象（值内不出现逗号', '  // ═══ MPW-MEDIA-END ═══')
  const mkMedia = (opts = {}) => {
    const win = opts.win || {}
    const cache = opts.cache === undefined ? createScriptCache() : opts.cache
    const sceneAudio = opts.sceneAudio || { analyser: null, freq: null }
    const loc = { search: opts.search || '?id=x' }
    const logs = []
    const f = new Function('lib', 'pkg', 'location', 'window', 'sceneAudio', 'URLSearchParams',
      'createMediaHost', 'dispatchScriptEvent', 'resolveLyrics', 'lyricsOverrideFromSearch', 'sceneScriptCache', 'logf',
      MEDIA_SRC + '\nreturn { parseMediaQuery, buildMediaPatch, applyMediaQuery, mpwMediaResolveLyrics, mpwMediaLyrics, mpwMediaTick, pending: () => mpwMediaPendingInject, host: () => mpwMediaHost }')
    const api = f(lib, opts.pkg || { entries: [] }, loc, win, sceneAudio, URLSearchParams, createMediaHost, dispatchScriptEvent,
      resolveLyrics, lyricsOverrideFromSearch, cache, (m) => logs.push(String(m)))
    return { api, win, loc, sceneAudio, cache, logs, host: api.host(), createScriptCache }
  }

  // ── ① 注入解析（真源码）────────────────────────────────────────────────────
  const q = mkMedia({ search: '?media=title=Test%20Song,artist=Somebody,position=12.5,duration=200,playback=playing,color=%23ff8800' })
  const parsed = q.api.parseMediaQuery(q.loc.search)
  check('T16a `?media=` 真源码解析：逗号分键、百分号解码、键名小写（title/artist/position/duration/playback/color）',
    parsed && parsed.title === 'Test Song' && parsed.artist === 'Somebody' && parsed.position === '12.5'
    && parsed.duration === '200' && parsed.playback === 'playing' && parsed.color === '#ff8800',
    JSON.stringify(parsed))
  check('T16b 无 `?media=` → null；`?media=`（空）→ 也不注入；空键丢弃',
    q.api.parseMediaQuery('?id=3554161528') === null && q.api.parseMediaQuery('?media=') === null
    && Object.keys(q.api.parseMediaQuery('?media=,,=x,title=')).length === 1,
    JSON.stringify([q.api.parseMediaQuery('?media='), q.api.parseMediaQuery('?media=,,=x,title=')]))
  const patch = q.api.buildMediaPatch(parsed, () => null)
  check('T16c buildMediaPatch：数值字段数字化、color → 线性 0..1、playback 原样（交给 media-host 归一化）',
    patch.position === 12.5 && patch.duration === 200 && patch.playback === 'playing'
    && Array.isArray(patch.primaryColor) && Math.abs(patch.primaryColor[0] - 1) < 1e-6 && Math.abs(patch.primaryColor[1] - 0.533333) < 1e-6,
    JSON.stringify(patch))
  const coverPatch = q.api.buildMediaPatch({ cover: 'images/cover.png' }, () => new Uint8Array([1, 2, 3]))
  check('T16d `cover=<包内路径>` → coverBytes + 由扩展名推 coverMime（渲染端建纹理用）',
    coverPatch.coverBytes instanceof Uint8Array && coverPatch.coverBytes.length === 3 && coverPatch.coverMime === 'image/png',
    JSON.stringify({ mime: coverPatch.coverMime, n: coverPatch.coverBytes.length }))

  // ── ② 真媒体宿主：注入 → 官方事件顺序 + 无媒体零派发 ─────────────────────
  {
    const env = mkMedia({ search: '?media=title=夜莺Night,artist=Test,duration=200,position=30,playback=playing' })
    env.api.mpwMediaTick()                       // 首帧 → 投递挂起的注入
    const st = env.host.getState()
    check('T16e 注入后宿主状态 = 注入值（title/artist/duration/position/playback）',
      st.title === '夜莺Night' && st.artist === 'Test' && st.duration === 200 && st.position === 30 && st.playback === 1,
      JSON.stringify({ t: st.title, a: st.artist, d: st.duration, p: st.position, pb: st.playback }))
    check('T16f 官方事件顺序 = status → properties → thumbnail(有则) → timeline（P-62 语义）',
      env.host.events.map((e) => e.name).join(',') === 'mediaStatusChanged,mediaPropertiesChanged,mediaTimelineChanged'
      || env.host.events.map((e) => e.name).join(',') === 'mediaStatusChanged,mediaPropertiesChanged,mediaThumbnailChanged,mediaTimelineChanged',
      env.host.events.map((e) => e.name).join(','))
    check('T16f2 `?media=` 不在装载时投递（cache 里没有脚本条目 → 会白丢），而是挂起到首帧',
      env.api.pending() === null && env.host.events.length > 0)
    const env2 = mkMedia({ search: '?id=x' })
    env2.api.mpwMediaTick()
    check('T16g **没有媒体时什么都不派发**（P-62 §5.4）：applyMediaQuery → null、tick 0 事件、hasMedia=false、宿主仍在（不报错）',
      env2.api.applyMediaQuery(env2.host, '?id=x', null) === null && env2.host.events.length === 0
      && env2.host.getState().hasMedia === false && !!env2.win.__mpwMedia)
  }

  // ── ③ 真实源（🔊 音频面板音轨）+ 进度节流 + 频谱原地更新 ────────────────────
  {
    const el = { paused: false, currentTime: 5, duration: 100 }
    const win = { __mpwAudio: { current: { path: 'sounds/リテラチュア.mp3', mime: 'audio/mpeg', size: 1, el } } }
    const env = mkMedia({ win })
    const host = env.host
    const upCalls = []
    const origUp = host.updatePosition
    host.updatePosition = (s) => { upCalls.push(s); return origUp(s) }
    env.api.mpwMediaTick()
    check('T16h 真实源：音频面板在播 → setMedia（歌名=文件名、时长=元素真值）+ playback=playing',
      host.getState().title === 'リテラチュア' && host.getState().duration === 100 && host.getState().playback === 1,
      JSON.stringify({ t: host.getState().title, d: host.getState().duration, pb: host.getState().playback }))
    env.api.mpwMediaTick(); env.api.mpwMediaTick()
    check('T16i 进度节流：同一帧内连调 3 次 tick **0** 次 updatePosition（250ms 节流），但宿主 tick() 已按墙钟推进进度',
      upCalls.length === 0 && host.getState().livePosition >= 5,
      'updatePosition=' + JSON.stringify(upCalls) + ' live=' + host.getState().livePosition.toFixed(3))
    const before = host.events.length
    el.paused = true
    env.api.mpwMediaTick()
    const afterPause = host.events.slice(before).map((e) => e.name)
    env.api.mpwMediaTick()
    check('T16j 元素暂停 → mediaPlaybackChanged(paused) 恰好一次（状态不变不重发）',
      host.getState().playback === 2 && afterPause.filter((n) => n === 'mediaPlaybackChanged').length === 1
      && host.events.slice(before).length === afterPause.length,
      afterPause.join(','))
    // 频谱：假 analyser（0..255 字节）→ setAudioSpectrum(Float32Array) → 同一对象原地更新
    const freq = new Uint8Array(64).fill(128)
    env.sceneAudio.analyser = { getByteFrequencyData: (dst) => dst.set(freq) }
    env.sceneAudio.freq = new Uint8Array(64)
    env.api.mpwMediaTick()
    const sp = host.getSpectrum()
    const b1 = host.audioBuffers(16), b2 = host.audioBuffers(16)
    check('T16k 频谱接线：analyser → setAudioSpectrum → 脚本侧 registerAudioBuffers 读到非零（同一对象原地更新）',
      sp.volume > 0.4 && b1 === b2 && b1.average.length === 16 && b1.average[0] > 0.4,
      'volume=' + sp.volume.toFixed(3) + ' avg0=' + b1.average[0].toFixed(3) + ' sameObj=' + (b1 === b2))
    check('T16l 陷阱 B 真源码：`audioBuffers` 走 `mpwMediaHost.audioBuffers(n)`（旧"每次新对象"写法只在无宿主时回退）',
      /audioBuffers: \(n\) => \(mpwMediaHost \? mpwMediaHost\.audioBuffers\(n\) : audioBuffers\(n\)\)/.test(HTML))
  }

  // ── ④ 真包端到端：`?media=` 首帧投递 → hina 3554161528 歌曲名层 id1592（用户"歌名点亮"的证据链）──
  {
    const cache = createScriptCache()
    const sceneObj2 = sceneJsonOf()
    const env = mkMedia({ cache, search: '?id=' + ID + '&media=title=P-64%20注入曲,artist=P-64%20歌手,duration=200,position=30,playback=playing' })
    const node = sceneObj2.objects.find((o) => o.id === 1592).text
    const authored = node.value
    const runFrame = (t) => applySceneScripts(sceneObj2, t, {
      canvasSize: { x: 3840, y: 2160 }, scriptCache: cache, renderObjects: sceneObj2.objects,
      frametime: 1 / 60, audioBuffers: env.host.audioBuffers, onError: () => {},
    })
    runFrame(0)                                  // 首帧：脚本编译进 cache
    env.api.mpwMediaTick()                       // 紧接着投递挂起的 `?media=`（demo 帧循环的真实顺序）
    runFrame(0.3)
    check('T16j2 端到端（真包 hina id1592）：`?media=title=…` 首帧投递 → 层脚本产出 = 注入 title（歌名点亮）',
      authored !== 'P-64 注入曲' && node.value === 'P-64 注入曲',
      JSON.stringify(authored) + ' → ' + JSON.stringify(node.value))
    check('T16j4 同一路径的 playback/timeline 也到位（position=30 秒 / duration=200 → 进度 0.15）',
      (() => { const s = env.host.getState(); return s.playback === 1 && s.duration === 200 && Math.abs(s.position - 30) < 1e-6 })(),
      JSON.stringify({ pb: env.host.getState().playback, d: env.host.getState().duration, p: env.host.getState().position }))
    env.host.clearMedia()
    runFrame(0.6)
    check('T16j3 clearMedia() → mediaStatusChanged{enabled:false} 且 hasMedia=false；hina 脚本没有该回调 → 层文本保持上一次值（官方语义：清媒体≠清作者层）',
      env.host.getState().hasMedia === false && env.host.events.some((e) => e.name === 'mediaStatusChanged' && e.payload && e.payload.enabled === false)
      && node.value === 'P-64 注入曲' && [...cache.map.values()].every((e) => !(e.updateErrors > 0)),
      'hasMedia=' + env.host.getState().hasMedia + ' text=' + JSON.stringify(node.value))
  }

  // ── ⑤ 歌词：包内自带才用（不联网）+ `?lyrics=` 覆盖/关闭 ────────────────────
  {
    const LRC = '[00:01.00]第一行\n[00:05.50]第二行'
    const env = mkMedia({})
    const rec = []
    const stub = { setLyrics: (lines, o) => rec.push({ n: lines.length, path: o && o.path }) }
    const r1 = env.api.mpwMediaLyrics(stub, 'sounds/a.mp3', 'a', { search: '?id=x', entryPaths: ['sounds/a.mp3', 'sounds/a.lrc'], readText: () => LRC })
    check('T16m `?id=x`（无覆盖）：包内有同主名 .lrc → 自动命中并交给宿主（探测优先，不联网）',
      r1 && r1.path === 'sounds/a.lrc' && rec.length === 1 && rec[0].n === 2, JSON.stringify(r1 && r1.path))
    const rec2 = []
    const r2 = env.api.mpwMediaLyrics({ setLyrics: (l, o) => rec2.push(o && o.path) }, 'sounds/a.mp3', 'a', { search: '?lyrics=other/x.lrc', entryPaths: ['sounds/a.lrc', 'other/x.lrc'], readText: () => LRC })
    check('T16n `?lyrics=<包内路径>` 覆盖生效（手工入口）', r2 && r2.path === 'other/x.lrc' && rec2[0] === 'other/x.lrc', JSON.stringify(r2 && r2.path))
    const r3 = env.api.mpwMediaLyrics({ setLyrics: () => { throw new Error('不该设歌词') } }, 'sounds/a.mp3', 'a', { search: '?lyrics=0', entryPaths: ['sounds/a.lrc'], readText: () => LRC })
    check('T16o `?lyrics=0` 显式关闭 → null（不设歌词、不报错）', r3 === null)
    const r4 = env.api.mpwMediaLyrics({ setLyrics: () => { throw new Error('不该设歌词') } }, 'sounds/a.mp3', 'a', { search: '?id=x', entryPaths: ['sounds/a.mp3', 'images/x.png'], readText: () => null })
    check('T16p 包内**没有** .lrc → 跳过（语料 22 包实测 0 命中；不联网抓）', r4 === null)
    // 真包条目表全量扫描：hina 没有 .lrc → 整体跳过（P-62 §6 结论在**接线后**的复现）
    const pkgEntries = (() => { const out = []; try { for (const e of (PKG.entries || [])) out.push(e && (e.name || e.path)) } catch (e) { /* ignore */ } ; return out.filter(Boolean) })()
    const noneReal = env.api.mpwMediaResolveLyrics({ search: '?id=' + ID, entryPaths: pkgEntries, mediaPath: 'sounds/x.mp3', mediaName: 'x' })
    check('T16p2 真包 hina 条目表（' + pkgEntries.length + ' 条）全量扫描：没有任何 .lrc → 歌词整体跳过、不报错（不联网）',
      noneReal === null && pkgEntries.length > 50 && !pkgEntries.some((p) => /\.lrc$/i.test(p)),
      'entries=' + pkgEntries.length + ' lrc=' + pkgEntries.filter((p) => /\.lrc$/i.test(p)).length)
  }

  // ── ⑥ 装载接线（源码级）：四陷阱 A/C/D + 首帧投递 + 默认开关真值表 ─────────
  const lineCache = /const scriptCacheOn = \(\(\) => \{[\s\S]*?\}\)\(\)/.exec(HTML)[0]
  const evalCacheOn = (search) => new Function('location', 'URLSearchParams', lineCache + '\nreturn scriptCacheOn')({ search }, URLSearchParams)
  check('T16q 裁定 1：`?scriptcache` **默认开**；`?scriptcache=0` 关；`?scriptcache=1` 也开（显式）',
    evalCacheOn('?id=3554161528') === true && evalCacheOn('?id=x&scriptcache=0') === false && evalCacheOn('?id=x&scriptcache=1') === true,
    '默认=' + evalCacheOn('?id=x') + ' =0→' + evalCacheOn('?scriptcache=0'))
  check('T16r 陷阱 A：媒体宿主只在有缓存时创建；`?scriptcache=0` 时明确日志并返回（不建宿主）',
    /\(function initMediaHost\(\) \{[\s\S]{0,320}?if \(!sceneScriptCache\)/.test(HTML)
    && /不建媒体宿主（P-62 陷阱 A/.test(HTML))
  check('T16s 陷阱 C：`scriptCache.shared = scriptShared`（传了 cache 后 opts.shared 会被顶掉）',
    /sceneScriptCache\.shared = scriptShared/.test(HTML))
  check('T16t 陷阱 D：属性面板改值 → `invalidateUserProps`（`invalidateScriptPropsCache` 在 applyAll 里）',
    /invalidateScriptPropsCache\(\)/.test(HTML) && /window\.__mpwInvalidateUserProps = invalidateUserProps/.test(HTML))
  check('T16u 媒体事件出口 = `dispatchScriptEvent(sceneScriptCache, name, payload, { onError })`；`?media=` 首帧后才投递（此前 cache 无条目）',
    /dispatch: \(name, payload\) => dispatchScriptEvent\(sceneScriptCache, name, payload/.test(HTML)
    && /mpwMediaPendingInject = \{ patch, lyrics/.test(HTML)
    && /if \(mpwMediaPendingInject\) \{/.test(HTML))
  check('T16v 对外入口：`window.__mpwMedia`（set/play/pause/stop/position/spectrum/lyrics/cover/state/repush）+ `window.__mpwMediaState` 诊断快照',
    /window\.__mpwMedia = \{/.test(HTML) && /window\.__mpwMediaState = mpwMediaHost\.getState\(\)/.test(HTML)
    && /repush: \(\) =>/.test(HTML))
  check('T16v2 `?scriptcache=0` 时面板/诊断口径一致：`invalidateScriptPropsCache` 0 次空操作 + 不建宿主（逃生口可解释）',
    /if \(!propsCache\) return 0/.test(HTML))
  {
    // 诊断字段：面板 `__mpwProps.media`（README 已登记）
    const { API, doc } = runPanelBlock()
    const win = { __mpwPropsPanel: API }
    const store = {}
    const doc2 = Object.assign({}, doc)
    const bar = mkEl('div')
    doc2.getElementById = (id) => (id === 'bar' ? bar : null)
    doc2.body = mkEl('body')
    const D7 = lib.mergeUserProps({ schema: SCHEMA })
    win.__mpwPropsCtx = { map: D7.props, schema: SCHEMA, locked: D7.locked, store: {}, save: (o) => Object.assign(store, o), key: 'mpw-props:' + ID }
    win.__mpwMediaState = { hasMedia: true, title: 'T', artist: 'A', playback: 1, livePosition: 12.34, duration: 200, lyricsPath: 'lyrics/a.lrc', coverUrl: '', coverBytes: null }
    const SRC2 = sliceBlock(HTML, '  let propsPanel = null\n', "\n  // ①(2026-09-12) ?isolate=名称(逗号分隔)")
    const g = new Function('document', 'window', 'localStorage', 'location', 'lib', 'scene', 'sceneObj', 'logf', 'URLSearchParams',
      SRC2 + '\nreturn { propsPanel, propsDiagPayload }')
    const scene7 = mkScene(D7.props)
    const r7 = g(doc2, win, { getItem: () => null, setItem: () => {}, removeItem: () => {} }, { search: '?id=' + ID }, lib, scene7, sceneJsonOf(), () => {}, URLSearchParams)
    const d7 = r7.propsDiagPayload()
    check('T16w 诊断新增 `media` 字段（README __mpwProps 表已登记）：title/playback/position/duration/lyricsPath/cover',
      d7.media && d7.media.title === 'T' && d7.media.playback === 1 && Math.abs(d7.media.position - 12.34) < 1e-6
      && d7.media.duration === 200 && d7.media.lyricsPath === 'lyrics/a.lrc' && d7.media.cover === false,
      JSON.stringify(d7.media))
    check('T16x 无媒体时 `media: null`（不污染既有上报字段）',
      (() => { delete win.__mpwMediaState; const d = r7.propsDiagPayload(); return d.media === null })())
  }
}

console.log('[T17] P-68 交接 ⑤.2（P-64-MEDIA 轮顺带）：上报 videoStats + `?diag` 采样坐标通用换算（不再写死 1280×720）')
{
  const DIAG_SRC = (() => { const i = HTML.indexOf('if (diagMode) {'); const j = HTML.indexOf("logf('【DIAG】'", i); return (i >= 0 && j > i) ? HTML.slice(i, j) : '' })()
  check('T17a 上报 payload 里 `videoStats` 与 `particleBudget` 同层（P-68 交接 ①：29 字段视频链取证接进 /report）',
    /particleBudget: \(renderer && renderer\.particleStats\) \|\| null,\s*\n\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*videoStats: \(renderer && renderer\.videoStats\) \|\| null,/.test(HTML)
    || /videoStats: \(renderer && renderer\.videoStats\) \|\| null,/.test(HTML),
    (/videoStats: \(renderer && renderer\.videoStats\)/.exec(HTML) || [''])[0])
  check('T17b `?diag` 采样块里**没有**写死的 1279/1280/`/3`（P-68 交接 ②：画布换档后坐标不再整体偏）',
    !!DIAG_SRC && !/\b1279\b/.test(DIAG_SRC) && !/\b1280\b/.test(DIAG_SRC) && !/\/\s*3\b/.test(DIAG_SRC),
    'block=' + DIAG_SRC.length + ' 字符')
  check('T17c 采样坐标走 `mpwDesignToCanvas(设计坐标, cv.width, cv.height, projW, projH)`，投影宽缺省 3840×2160',
    /mpwDesignToCanvas\(p\[0\] \+ dx, p\[1\] \+ dy, cv\.width, cv\.height, projW, projH\)/.test(DIAG_SRC)
    && /scene\.general\.orthogonalprojection/.test(DIAG_SRC)
    && /Number\(__proj\.width\) > 0 \? Number\(__proj\.width\) : 3840/.test(DIAG_SRC))
  {
    const m = /function mpwDesignToCanvas[\s\S]*?\n  \}/.exec(HTML)
    const f = m ? new Function(m[0] + '\nreturn mpwDesignToCanvas')() : null
    check('T17d 换算真值表（**两轴正比、不翻 y**：世界系 y-down 与 `l.origin` 同空间）：中心 → 各档画布中心；角落按 [0, cv-1] 钳位',
      !!f && JSON.stringify(f(1920, 1080, 1280, 720, 3840, 2160)) === '[640,360]'
      && JSON.stringify(f(1920, 1080, 1920, 1080, 3840, 2160)) === '[960,540]'
      && JSON.stringify(f(0, 0, 1280, 720, 3840, 2160)) === '[0,0]'
      && JSON.stringify(f(3840, 2160, 1920, 1080, 3840, 2160)) === '[1919,1079]'
      && JSON.stringify(f(100, 100, 1920, 1080, 0, 0)) === '[50,50]',
      f ? JSON.stringify([f(1920, 1080, 1280, 720, 3840, 2160), f(0, 0, 1280, 720, 3840, 2160), f(3840, 2160, 1920, 1080, 3840, 2160), f(100, 100, 1920, 1080, 0, 0)]) : 'missing')
    const a = f && f(960, 540, 1280, 720, 3840, 2160), b = f && f(960, 540, 1920, 1080, 3840, 2160), c = f && f(960, 540, 3840, 2160, 3840, 2160)
    check('T17e 两档自检（P-68 要求）：同一设计坐标在 720p/1080p/2160p 三档采到**比例一致**的位置',
      !!f && Math.abs(a[0] / 1280 - b[0] / 1920) < 1e-9 && Math.abs(b[0] / 1920 - c[0] / 3840) < 1e-9
      && Math.abs(a[1] / 720 - b[1] / 1080) < 1e-9 && Math.abs(b[1] / 1080 - c[1] / 2160) < 1e-9,
      '设计(960,540)：720p=(' + a + ') 1080p=(' + b + ') 2160p=(' + c + ')' + ' ｜ 720p(1920,1080)=' + f(1920, 1080, 1280, 720, 3840, 2160) + ' vs 1080p=' + f(1920, 1080, 1920, 1080, 3840, 2160))
  }
}
  // ── ② 帧率取证三字段（P-64-MEDIA 轮顺带，用户"帧率太低"主诉）──────────────────
  check('T17f `/report` payload 里 `fps` / `frameMs` / `resTier` 与 `particleBudget`/`videoStats` 同级',
    /particleBudget: \(renderer && renderer\.particleStats\) \|\| null,[\s\S]{0,400}?videoStats: \(renderer && renderer\.videoStats\) \|\| null,[\s\S]{0,900}?fps: \(\(\) => \{[\s\S]{0,900}?frameMs: \(\(\) => \{[\s\S]{0,400}?resTier: \(\(\) => \{/.test(HTML))
  const RING_AT = HTML.indexOf('frameDeltaRing.push(now - last)')
  const FRAME_FN = HTML.indexOf('const frame = (now) => {')
  const RAF_AFTER = HTML.indexOf('rafId = requestAnimationFrame(frame);', FRAME_FN)
  /* ①(2026-09-25 宿主 API 接线) 帧率抽稀（`?fps=`/`__wp.setSceneFps`）的**跳帧**分支也必须自排下一帧
     （否则单实例下一次跳帧就把循环弄死）⇒ `requestAnimationFrame(frame)` 从 2 处变 3 处。判据意图不变：
     **不新起循环/计时器**、`frameDeltaRing.push` 仍只有一处、中位仍在既有 `ft > 500` 分支里刷新；
     新增的第 3 处必须落在 `mpwSceneFpsShouldSkip` 的跳帧分支内（不是另起一条循环）。 */
  const rafSites = (HTML.match(/requestAnimationFrame\(frame\)/g) || []).length
  const skipRearm = /if \(mpwSceneFpsShouldSkip\(now\)\) \{[\s\S]{0,220}?requestAnimationFrame\(frame\)/.test(HTML)
  check('T17g `frameMs` 复用已有帧循环时间戳：`frameDeltaRing.push` 只有一处、位于 `frame(now)` 内（**不新起 rAF/计时器**），中位在既有 `ft > 500` 分支里刷新；帧率抽稀的跳帧分支只在同一条循环上自排',
    RING_AT > FRAME_FN && RING_AT < RAF_AFTER && (HTML.match(/frameDeltaRing\.push\(/g) || []).length === 1
    && /if \(ft > 500\) \{[\s\S]{0,700}?window\.__mpwFrameMsP50 = s2\[/.test(HTML)
    && rafSites === 3 && skipRearm,
    'push@' + RING_AT + ' frame@' + FRAME_FN + ' raf=' + rafSites + ' 处 skipRearm=' + skipRearm)
  {
    // 三字段真值表（切真源码 IIFE，喂假 document/window）
    const i = HTML.indexOf('fps: (() => {')
    const j = HTML.indexOf('meshGeom: (window.__mpwMeshGeom', i)
    const src = (i >= 0 && j > i) ? HTML.slice(i, j) : ''
    const mk = (docTxt, win) => {
      const d = { getElementById: (id) => (id === 'fps' ? { textContent: docTxt } : null) }
      return new Function('document', 'window', 'return {' + src + '}')(d, win || {})
    }
    const a = mk('58 fps', {})
    check('T17h `fps` 取 #fps 元素显示值（取整）；元素空/无 → 回落 window.__mpwFps；再没有 → null',
      a.fps === 58 && mk('', { __mpwFps: 42 }).fps === 42 && mk('', {}).fps === null && mk('120 fps', {}).fps === 120,
      JSON.stringify([a.fps, mk('', { __mpwFps: 42 }).fps, mk('', {}).fps]))
    const b = mk('', { __mpwFrameMsP50: 12.3456 })
    check('T17h2 `frameMs` = 滚动中位保留 1 位小数（12.3456 → 12.3）；缺失 → null',
      b.frameMs === 12.3 && mk('', {}).frameMs === null && mk('', { __mpwFrameMsP50: NaN }).frameMs === null,
      JSON.stringify([b.frameMs, mk('', {}).frameMs]))
    const c = mk('', { __mpwResTier: { name: '1080p', width: 1920, height: 1080, legacy: false, capW: 1920, capH: 1080 } })
    check('T17h3 `resTier` 只带 {name,width,height,legacy}（不把 P-68 的整坨全局塞进上报）；缺失 → null',
      c.resTier && c.resTier.name === '1080p' && c.resTier.width === 1920 && c.resTier.height === 1080
      && c.resTier.legacy === false && Object.keys(c.resTier).join(',') === 'name,width,height,legacy'
      && mk('', {}).resTier === null,
      JSON.stringify(c.resTier))
  }
console.log('[T18] 用户第 2 条反馈：逐层调试「未开启时按 → 直接跳到第 2 层」应改为从第 1 层开始')
{
  const m = /const lnTarget = \(pos, entering, delta\) => \(entering \? 0 : pos \+ delta\)/.exec(HTML)
  const f = m ? new Function(m[0] + '\nreturn lnTarget')() : null
  check('T18a 根因修掉：`curPos()` 不再把"未进入调试(-1)"夹成 0（旧代码 `: Math.max(0, __lnOnly)` 已消失，注释里的追溯说明不算）',
    /const curPos = \(\) => \(stack\.length \? stack\[stack\.length - 1\]\.pos : __lnOnly\)/.test(HTML)
    && !/:\s*Math\.max\(0, __lnOnly\)/.test(HTML))
  check('T18b 入口语义（真源码切片）：未进入调试时 →/←/↑/↓ 一律落到第 0 层 = 角标"第 1/n 层"；已进入调试时按 delta 正常移动',
    !!f && f(-1, true, 1) === 0 && f(-1, true, -1) === 0 && f(-1, true, 10) === 0
    && f(0, false, 1) === 1 && f(3, false, -1) === 2 && f(1, false, 10) === 11,
    f ? JSON.stringify([f(-1, true, 1), f(-1, true, -1), f(0, false, 1), f(3, false, -1)]) : 'missing')
  check('T18c 两条按键路径（本地 keydown + 插件 `mpw-ln-key` 转发）都走 `moveBy`，且旧的 `setPos(curPos() + 1)` 已绝迹',
    (HTML.match(/moveBy\(/g) || []).length >= 4 && !/setPos\(curPos\(\) \+ 1\)/.test(HTML) && !/setPos\(curPos\(\) - 1\)/.test(HTML),
    'moveBy 出现 ' + ((HTML.match(/moveBy\(/g) || []).length) + ' 次')
  check('T18d 无鼠标右键分支需要改：逐层调试块里没有 contextmenu/mousedown 处理（用户说的"右键"= 键盘 →，含插件转发路径）',
    (() => {
      const i = HTML.indexOf('let __lnOnly = (() =>')
      const j = HTML.indexOf('逐层调试失败不影响渲染', i)
      const blk = (i >= 0 && j > i) ? HTML.slice(i, j) : ''
      return blk.length > 2000 && !/contextmenu/.test(blk) && !/addEventListener\('mousedown'/.test(blk)
    })())
  check('T18e 首次进入的首层不被"组合容器"逻辑吃掉：`setPos(0)` 空栈时 `__lnOnly = list[0] = 0`（容器展开只在 Ctrl 分支）',
    /if \(stack\.length\) \{ stack\[stack\.length - 1\]\.pos = q; __lnOnly = list\[q\] \} else __lnOnly = list\[q\]/.test(HTML)
    && /else if \(k === 'Control'\) ctrlAction\(\)/.test(HTML))
}
console.log('[T19] P-64-MEDIA 轮顺带：`layerHealth` 归因（visible/visibleBy）+ `layerHealthSummary` + `missingLayers`（用户：分不清"隐藏"与"该画没画"）')
{
  const HEALTH_SRC = sliceBlock(HTML, '// ═══ MPW-HEALTH-BEGIN', '// ═══ MPW-HEALTH-END')
  const mkHealth = (layers, led, skips, errs, opt) => {
    const q = new URLSearchParams(opt && opt.search ? opt.search : '?id=x')
    const loc = { search: (opt && opt.search) || '?id=x' }
    const f = new Function('lib', 'location', 'URLSearchParams',
      HEALTH_SRC + '\nreturn { mpwLayerHealth, MPW_HEALTH_UI_RE, MPW_HEALTH_CAT_RE }')
    const api = f(lib, loc, URLSearchParams)
    const catOn = {
      clock: q.get('showclock') !== '0', date: q.get('showdate') !== '0',
      weekday: q.get('showweekday') !== '0', fps: q.get('showfps') === '1',
    }
    return api.mpwLayerHealth({ layers }, led || [], skips || [], errs || {},
      { uiRe: api.MPW_HEALTH_UI_RE, catRe: api.MPW_HEALTH_CAT_RE, catOn, propsSchema: (opt && opt.propsSchema) || null, propsMap: (opt && opt.propsMap) || null, time: (opt && opt.time) || null })
  }
  // 桩场景：①可见有纹理但从未进台账（= 用户说的"该渲染却没渲染"）
  //   ②uiRe 命中（Song Title）且被隐藏；③容器；④userProp 绑定关掉；⑤时段层；⑥N5:clock；⑦script；⑧author
  const layers = [
    { id: 1, name: '该画没画层', visible: true, textureName: 'tex1', size: [100, 100] },
    { id: 2, name: 'Song Title', visible: false, textureName: 'tex2', size: [100, 100] },
    { id: 3, name: '容器A', visible: true, isContainer: true, size: [100, 100] },
    { id: 4, name: '时钟文本', visible: false, __bindRaw: { visible: { user: 'clock', value: true } }, __text: {}, size: [10, 10] },
    { id: 5, name: 'night', visible: false, size: [10, 10] },
    { id: 6, name: 'Clock Text', visible: false, __text: {}, size: [10, 10] },
    { id: 7, name: '脚本关的层', visible: false, __visibleRaw: { script: 'return false', value: true }, size: [10, 10] },
    { id: 8, name: '作者关的层', visible: false, size: [10, 10] },
  ]
  const led = [{ n: '时钟文本', rd: [0, 0, 10, 10], px: '#fff', t: 'tex4' }]
  const timeStub = { isTimeLayer: (l) => l.id === 5 }
  const r = mkHealth(layers, led, [], {}, { time: timeStub, propsSchema: { clock: { type: 'bool', value: true } }, propsMap: { clock: true } })
  const by = (n) => r.layerHealth.find((h) => h.name === n)
  check('T19a 桩场景：**可见 + 有纹理 + 从未进台账**的层落进 `missing`（而不是 invisible），带索引与层名',
    r.layerHealthSummary.missing === 1 && r.missingLayers.length === 1
    && r.missingLayers[0].name === '该画没画层' && r.missingLayers[0].i === 0
    && r.layerHealthSummary.invisible === 5 && r.layerHealthSummary.skipped === 1,
    JSON.stringify(r.layerHealthSummary) + ' ' + JSON.stringify(r.missingLayers))
  check('T19b uiRe 命中的层落进 `invisible` 且 `visibleBy="uiRe"`（TASK-A 字段契约 + 新归因字段并存）',
    by('Song Title').visible === false && by('Song Title').visibleBy === 'uiRe' && by('Song Title').drawn === 0
    && by('Song Title').skipReason === 'invisible')
  check('T19c 归因镜像逐字等于 bundle 里那两个谓词（bundle 一改，本断言立刻红）',
    (() => {
      const ui = /const uiRe = (\/[^\n]*?\/i)/.exec(HTML) || /const MPW_HEALTH_UI_RE = (\/[^\n]*?\/i)/.exec(HTML)
      const b = (() => { try { return fs.readFileSync(new URL('../core/we-scene-bundle.js', import.meta.url), 'utf8') } catch (e) { return '' } })()
      const m = /const uiRe = (\/[^\n]*?\/i)/.exec(b)
      const d = /const MPW_HEALTH_UI_RE = (\/[^\n]*?\/i)/.exec(HTML)
      return !!m && !!d && m[1] === d[1]
    })(),
    (() => { const d = /const MPW_HEALTH_UI_RE = (\/[^\n]*?\/i)/.exec(HTML); return d ? d[1].slice(0, 40) + '…' : 'missing' })())
  const rN5 = mkHealth(layers, led, [], {}, { time: timeStub, search: '?showclock=0' })
  check('T19d 其余归因分桶：容器=container / userProp:<名> / timeVariant / N5:<类别>（`?showclock=0`）/ script / author',
    by('容器A').visibleBy === 'container' && by('时钟文本').visibleBy === 'userProp:clock'
    && by('night').visibleBy === 'timeVariant'
    && rN5.layerHealth.find((h) => h.name === 'Clock Text').visibleBy === 'N5:clock'
    && by('脚本关的层').visibleBy === 'script' && by('作者关的层').visibleBy === 'author',
    ['容器A', '时钟文本', 'night'].map((n) => n + '=' + by(n).visibleBy).join(' ')
    + ' ClockText(?showclock=0)=' + rN5.layerHealth.find((h) => h.name === 'Clock Text').visibleBy
    + ' 脚本关的层=' + by('脚本关的层').visibleBy + ' 作者关的层=' + by('作者关的层').visibleBy)
  check('T19e 可见层 `visibleBy=null`（没被谁关掉）；被 N5 开关放开的层不误判（?showclock=1 时 `Clock Text` 不再算 N5）',
    by('该画没画层').visibleBy === null
    && mkHealth(layers, led, [], {}, { time: timeStub, search: '?showclock=1' }).layerHealth.find((h) => h.name === 'Clock Text').visibleBy === 'author')
  check('T19f userProp 且被 condition 门控 → `userProp:<名>(gated)`（P-61 门控语义在归因里可见）',
    (() => {
      const g = mkHealth(layers, led, [], {}, { time: timeStub, propsSchema: { clock: { type: 'bool', value: true, condition: 'other.value' }, other: { type: 'bool', value: false } }, propsMap: { clock: true, other: false } })
      return g.layerHealth.find((h) => h.name === '时钟文本').visibleBy === 'userProp:clock(gated)'
    })())
  check('T19g 汇总齐全且自洽（total = drawn + invisible + skipped + missing；台账非空时必须给出可判定数字）',
    // ①(P-75) 新增 `ledgerSamples`/`ledgerEmpty` 两键：`missing` 只有在**台账真的采到**时才可判定
    Object.keys(r.layerHealthSummary).join(',') === 'total,drawn,invisible,skipped,missing,ledgerSamples,ledgerEmpty'
    && r.layerHealthSummary.total === layers.length && r.layerHealthSummary.drawn === 1
    && r.layerHealthSummary.skipped === 1 && r.layerHealthSummary.invisible === 5 && r.layerHealthSummary.missing === 1
    && r.layerHealthSummary.ledgerEmpty === false && r.layerHealthSummary.ledgerSamples >= 1,
    JSON.stringify(r.layerHealthSummary))
  check('T19h `missingLayers` 上限 30 条（不把上百层塞进上报）——**用非空台账**，否则测的是另一条规则',
    (() => {
      const many = []
      for (let i = 0; i < 50; i++) many.push({ id: 100 + i, name: 'm' + i, visible: true, textureName: 't', size: [10, 10] })
      // ①(P-75) 台账给 1 条无关记录：让"非空"成立，才能测到 30 条截断（旧版用空台账，测到的其实是下面 T19k 的假阳性）
      const rr = mkHealth(many, [{ n: '无关层', rd: [0, 0, 1, 1], px: [0, 0, 0], t: 'layer' }], [], {})
      return rr.missingLayers.length === 30 && rr.layerHealthSummary.missing === 30
    })())
  // ①(P-75 2026-09-15) **我自己的诊断 bug 回归**：台账没采到 ⇒ `missing` 不可判定，
  //   绝不允许把"所有可见层"报成 missing（真机实测：ledger=0 → missing=25；ledger=25 → missing=0，完全反相关）。
  //   假阳性比没有更糟：会让人去追几十个根本不存在的"该画没画"。
  check('T19k 台账为空 ⇒ `missing` 记 null（不可判定）、`missingLayers` 为空、`ledgerEmpty=true`（旧实现会把全部可见层报成 missing）',
    (() => {
      const many = []
      for (let i = 0; i < 50; i++) many.push({ id: 200 + i, name: 'n' + i, visible: true, textureName: 't', size: [10, 10] })
      const rr = mkHealth(many, [], [], {})
      return rr.missingLayers.length === 0
        && rr.layerHealthSummary.missing === null
        && rr.layerHealthSummary.ledgerEmpty === true
        && rr.layerHealthSummary.ledgerSamples === 0
        && rr.layerHealthSummary.invisible === 0   // 这些层是"可见"的，只是这次没采到 → 不能算 invisible 也不能算 missing
    })())
  check('T19i 上报接线：payload 里有 `layerHealth`/`layerHealthSummary`/`missingLayers`，且健康行由纯函数产出（真源码）',
    /layerHealth: layerHealth,/.test(HTML) && /layerHealthSummary: layerHealthSummary,/.test(HTML)
    && /missingLayers: missingLayers,/.test(HTML) && /const __health = mpwLayerHealth\(scene, window\.__mpwLayerLedger/.test(HTML))
  check('T19j 页内汇总行文案区分"不可见"/"该画没画"/"本次未采样"（P-75：missing=null 时不得显示成数字）',
    // ①(P-75) 断言口径随之更新：不再要求直接拼 `missing`，而是要求**分支处理 null**
    /const healthSummary = '本帧 ' \+ layerHealth\.length \+ ' 层：'/.test(HTML)
    && /layerHealthSummary\.invisible \+ ' 不可见 \/ '/.test(HTML)
    && /layerHealthSummary\.missing === null/.test(HTML)
    && /本次未采样/.test(HTML)
    && /: layerHealthSummary\.missing \+ ' 该画没画'/.test(HTML))
}
console.log('[T20] P-64-MEDIA 轮顺带：手动上报按钮（用户"记得检验一下是否真正生效"）—— 4 次自动上限不得挡住手动')
{
  const GATE_SRC = (() => {
    const m = /const MPW_MAX_AUTO_REPORTS = 4[\s\S]*?function mpwReportCommit\(state, seq\) \{[\s\S]*?\n  \}/.exec(HTML)
    return m ? m[0] : ''
  })()
  const ARM_SRC = (() => { const m = /function mpwArmLedger\(ms\) \{[\s\S]*?\n  \}/.exec(HTML); return m ? m[0] : '' })()
  const BTN_SRC = sliceBlock(HTML, '// ═══ MPW-REPORT-BTN-BEGIN', '// ═══ MPW-REPORT-BTN-END ═══')
  check('T20a 真源码切片齐备：上报闸门 + 台账采集窗口 + 按钮块（`?noreport` 时整块不装载）',
    GATE_SRC.length > 200 && ARM_SRC.length > 80 && BTN_SRC.length > 800 && /if \(autoReport\) \{/.test(HTML),
    'gate=' + GATE_SRC.length + ' arm=' + ARM_SRC.length + ' btn=' + BTN_SRC.length)
  // ① 闸门语义（纯函数，真源码）：自动 4 次封顶；**手动永远放行**（旧实现把手动也挡掉）
  {
    const g = new Function(GATE_SRC + '\nreturn { mpwReportGate, mpwReportCommit }')()
    const gate = g.mpwReportGate
    const st = { count: 0, auto: 0 }
    const autos = [], seqs = []
    // 复刻真实节奏：每次自动上报 = gate → POST 成功 → commit（失败的回合不 commit）
    for (let i = 0; i < 6; i++) {
      const r = gate(st, false)
      autos.push(r.run)
      if (r.run) { seqs.push(r.seq); g.mpwReportCommit(st, r.seq) }
    }
    check('T20b 自动路径：第 5 次起被 4 次上限挡掉（`run=false` 且置 cleared）；计数只由"提交"推进',
      JSON.stringify(autos) === JSON.stringify([true, true, true, true, false, false]) && st.auto === 4 && st.count === 4
      && JSON.stringify(seqs) === JSON.stringify([1, 2, 3, 4]),
      JSON.stringify({ autos, seqs, st }))

    const m1 = gate(st, true), m2 = gate(st, true)
    check('T20c **核心回归**：自动预算已耗尽（auto=4）时，手动上报仍然 `run=true`、序号继续涨（#N 继续涨）',
      m1.run === true && m2.run === true && m1.seq === 5 && m2.seq === 5 && st.auto === 4,
      JSON.stringify({ m1, m2, st }))
    check('T20d 手动不消耗自动预算（auto 不变）、也不置 cleared（清定时器只发生在自动被挡时）；失败不提交 → 计数不涨',
      m1.cleared === false && m2.cleared === false && st.auto === 4
      && g.mpwReportCommit(st, 5) === 5 && st.count === 5,
      JSON.stringify(st))
  }
  // ② 按钮块（假 DOM + 真源码）：点一下 → 恰好一次 POST；500 → ❌ 不增计数；成功 → #N
  {
    const mkEnv = (fetchImpl) => {
      const bar = mkEl('div'); bar.id = 'bar'
      const logbar = mkEl('div'); logbar.id = 'logbar'
      const doc = {
        createElement: (t) => mkEl(t),
        getElementById: (id) => (id === 'logbar' ? logbar : (id === 'bar' ? bar : null)),
      }
      const win = {}
      const state = { count: 0, auto: 4 }          // ← 自动预算**已耗尽**（旧实现会被挡掉）
      const gApi = new Function(GATE_SRC + '\nreturn { mpwReportGate, mpwReportCommit }')()
      const gate = gApi.mpwReportGate
      const mpwArmLedger = new Function('window', 'setTimeout', ARM_SRC + '\nreturn mpwArmLedger')(win, (fn, ms) => 0)
      const posts = []
      const logs = []
      const doReport = (opts) => {
        const gr = gate(state, !!(opts && opts.manual))
        if (!gr.run) return Promise.resolve({ ok: false, skipped: 'auto-cap' })
        win.__mpwLedgerWant = false
        mpwArmLedger(5)
        return Promise.resolve(fetchImpl(posts.length, gr.seq)).then((res) => {
          if (res && res.ok) win.__setCount(gApi.mpwReportCommit(state, gr.seq))   // 复刻真实 doReport：成功才计数
          return res
        })
      }
      const f = new Function('document', 'window', 'doReport', 'mpwArmLedger', 'setTimeout', 'fetch', 'logf',
        'let reportCount = 0;\n' + BTN_SRC + '\nwindow.__setCount = function (v) { reportCount = v };\nreturn { reportBtn }')
      const api = f(doc, win, doReport, mpwArmLedger, (fn, ms) => 0, fetchImpl, (m) => logs.push(m))
      return { api, bar, logbar, win, state, posts, logs }
    }
    // 成功路径
    {
      const env = mkEnv(() => { env0.posts.push('post'); return Promise.resolve({ ok: true, status: 200 }) })
      var env0 = env
      env.api.reportBtn.fire('click')
      await new Promise((r) => setTimeout(r, 10))
      check('T20e 点按钮（自动预算已耗尽）→ **恰好一次** /report POST，且按钮显示 `✅ 已上报 #N`（N = 累计数）',
        env.posts.length === 1 && env.state.count === 1 && /^✅ 已上报 #\d+$/.test(env.api.reportBtn.textContent),
        'posts=' + env.posts.length + ' count=' + env.state.count + ' btn=' + JSON.stringify(env.api.reportBtn.textContent))
    }
    // 失败路径（500）
    {
      const env = mkEnv(() => { env1.posts.push('post'); return Promise.resolve({ ok: false, status: 500 }) })
      var env1 = env
      env.api.reportBtn.fire('click')
      await new Promise((r) => setTimeout(r, 10))
      check('T20f POST 返回 500 → 按钮 `❌ 上报失败`，且**不**增计数（旧实现静默吞掉，用户看不出有没有生效）',
        env.posts.length === 1 && env.state.count === 0 && env.api.reportBtn.textContent === '❌ 上报失败',
        'posts=' + env.posts.length + ' count=' + env.state.count + ' btn=' + JSON.stringify(env.api.reportBtn.textContent))
    }
    // 台账采集窗口（用户最容易漏的一条）
    {
      const env = mkEnv(() => { env2.posts.push('post'); return Promise.resolve({ ok: true, status: 200 }) })
      var env2 = env
      env.win.__mpwLedgerWant = false
      env.api.reportBtn.fire('click')
      await new Promise((r) => setTimeout(r, 10))
      check('T20g 手动上报同样**重置台账采集窗口**（`__mpwLedgerWant=true` + 清空 `__mpwLayerLedger`），否则下一次上报台账是空的',
        env.win.__mpwLedgerWant === true && Array.isArray(env.win.__mpwLayerLedger) && env.win.__mpwLayerLedger.length === 0,
        'want=' + env.win.__mpwLedgerWant + ' ledger=' + JSON.stringify(env.win.__mpwLayerLedger))
    }
    // 连点保护 + 按钮在 logbar 里
    {
      const env = mkEnv(() => { env3.posts.push('post'); return new Promise((r) => setTimeout(() => r({ ok: true, status: 200 }), 5)) })
      var env3 = env
      env.api.reportBtn.fire('click'); env.api.reportBtn.fire('click'); env.api.reportBtn.fire('click')
      await new Promise((r) => setTimeout(r, 20))
      check('T20h busy 期间连点只发一次（不会一次点击灌三份上报）；按钮挂在**顶部工具栏 `#bar`**（不在 `#logbar` 内）',
        env.posts.length === 1 && env.bar.children.some((c) => c.id === 'mpw-report-btn')
        && env.logbar.children.every((c) => c.id !== 'mpw-report-btn')
        && env.api.reportBtn.parent === env.bar,
        'posts=' + env.posts.length + ' inBar=' + env.bar.children.some((c) => c.id === 'mpw-report-btn')
        + ' inLogbar=' + env.logbar.children.some((c) => c.id === 'mpw-report-btn'))
    }
  }
  // ③ 源码级：手动路径复用同一个 doReport（不另写 payload）+ 日志行区分手动/自动
  check('T20i 手动路径复用同一个 `doReport({manual:true})`（同一份 payload 构造），日志行 `🛰 已手动上报 #N`（自动为 `已自动上报`）',
    /Promise\.resolve\(\)\.then\(\(\) => doReport\(\{ manual: true \}\)\)/.test(HTML)
    && /logf\('🛰 已' \+ \(manual \? '手动' : '自动'\) \+ '上报 #'/.test(HTML)
    && /window\.__mpwReport = \{ now: \(\) => doReport\(\{ manual: true \}\)/.test(HTML))
}
console.log('[T21] P-64-MEDIA 轮顺带（侦察报告）：台账 `rect`/`px` 口径统一成 y-down（顶左原点，与 layers[].origin 同空间）')
{
  const m = /function mpwLedgerYDown\(yA, yB, H, oyPx\) \{[\s\S]*?\n  \}/.exec(HTML)
  const f = m ? new Function(m[0] + '\nreturn mpwLedgerYDown')() : null
  check('T21a 锚定换算真值表：GL 底左输入 + origin 在顶部 → 翻成 (0..100)；本身就是 y-down → 不翻；满屏对称两种都等价',
    !!f && JSON.stringify(f(980, 1080, 1080, 100)) === JSON.stringify({ y0: 0, y1: 100, flipped: true })
    && JSON.stringify(f(0, 100, 1080, 100)) === JSON.stringify({ y0: 0, y1: 100, flipped: false })
    && f(0, 1080, 1080, 540).flipped === false,
    f ? JSON.stringify([f(980, 1080, 1080, 100), f(0, 100, 1080, 100)]) : 'missing')
  check('T21b 取不到 origin（无锚）→ 按"GL 底左 → y-down"默认换算（不是不换算）',
    !!f && JSON.stringify(f(0, 100, 1080, null)) === JSON.stringify({ y0: 980, y1: 1080, flipped: true })
    && f(0, 100, 1080, undefined).y0 === 980)
  check('T21c 真源码接线：`onLayerDraw` 用 `mpwLedgerYDown(yA, yB, info.height, oyPx)`（锚 = layer.origin 经投影高换算）'
    + '，`rd` 与 `px` 同一套 y（px 再由 y-down 换回 GL 底左、经 `mpwSamplePixel` 诚实取样）',
    /const yy = mpwLedgerYDown\(yA, yB, info\.height, oyPx\)/.test(HTML)
    && /const y0 = yy\.y0, y1 = yy\.y1/.test(HTML)
    && /Number\(layer\.origin\[1\]\) \/ projH \* info\.height/.test(HTML)
    // ①(2026-09-23) 取样统一走 `mpwSamplePixel`（读失败返回 null，不再把"没读到"当 0,0,0）：
    //   契约从"裸 readPixels(cx, H-1-cyTop…)"升级为"同一个 y-down→GL 换算 + 诚实取样助手"。
    && /mpwSamplePixel\(renderer\.gl, cx, info\.height - 1 - cyTop\)/.test(HTML)
    && /function mpwSamplePixel\(gl, x, y\)[\s\S]{0,420}?gl\.readPixels\(x \| 0, y \| 0, 1, 1/.test(HTML)
    && /rd: \[Math\.round\(x0 \* k\), Math\.round\(y0 \* k\)/.test(HTML))
  check('T21d 口径文档化：README 写明 `rect`/`px` 是 y-down（顶左原点）且与 `layers[].origin` 同空间',
    /`rect`[\s\S]{0,80}y-down/.test(fs.readFileSync(new URL('../docs/README-DIAGNOSTICS.md', import.meta.url), 'utf8'))
    || /y-down（顶左原点）/.test(fs.readFileSync(new URL('../docs/README-DIAGNOSTICS.md', import.meta.url), 'utf8')))
}
console.log('[T22] P-64-MEDIA 轮顺带：按钮位置语义（点手动上报不得收起日志）+ `?bones=` 结构化回传')
{
  // ── ① 真机 bug 回归：按钮在 #bar → 点它**不**改变日志面板折叠态（旧版挂 #logbar 会被 pointerdown 判定吃掉）
  const LOG_PANEL_SRC = (() => {
    const i = HTML.indexOf('<script id="mpw-log-panel">')
    const j = HTML.indexOf('</script>', i)
    return (i >= 0 && j > i) ? HTML.slice(HTML.indexOf('>', i) + 1, j) : ''
  })()
  const BTN_SRC = sliceBlock(HTML, '// ═══ MPW-REPORT-BTN-BEGIN', '// ═══ MPW-REPORT-BTN-END ═══')
  check('T22a 日志面板块与按钮块都能切片（按钮块不再挂在 logbar 里：源码里 `getElementById(\'bar\')`）',
    LOG_PANEL_SRC.length > 800 && BTN_SRC.length > 800
    && /getElementById\('bar'\)/.test(BTN_SRC) && !/getElementById\('logbar'\)/.test(BTN_SRC))
  {
    // 迷你 DOM（带冒泡）：pointerdown 从按钮沿 parent 链上冒泡，直到被 stopPropagation 截断
    const mkEv = () => ({ _stop: false, preventDefault() {}, stopPropagation() { this._stop = true } })
    const mkNode = (id) => {
      const n = { id, style: {}, title: '', textContent: '', _attrs: {}, _cls: new Set(), listeners: {}, children: [], parent: null,
        classList: { add: (c) => n._cls.add(c), remove: (c) => n._cls.delete(c), contains: (c) => n._cls.has(c) },
        setAttribute: (k, v) => { n._attrs[k] = String(v) },
        getAttribute: (k) => n._attrs[k],
        addEventListener: (t, h) => { (n.listeners[t] = n.listeners[t] || []).push(h) },
        appendChild(c) { c.parent = n; n.children.push(c); return c },
        fire(t, ev) { for (const h of (n.listeners[t] || [])) h(Object.assign({ preventDefault() {}, cancelable: true }, ev)) },
        closest(sel) { let p = n; while (p) { if (sel === '#' + p.id) return p; p = p.parent } return null } }
      return n
    }
    const buildWorld = () => {
      const els = { log: mkNode('log'), logbar: mkNode('logbar'), logarrow: mkNode('logarrow'), logtip: mkNode('logtip'), bar: mkNode('bar') }
      const win = { innerHeight: 720, PointerEvent: function PointerEvent() {}, listeners: {} }
      win.addEventListener = (t, h) => { (win.listeners[t] = win.listeners[t] || []).push(h) }
      const winFire = (t, ev) => { for (const h of (win.listeners[t] || [])) h(Object.assign({ preventDefault() {}, cancelable: true }, ev)) }
      const store = {}
      const doc = { getElementById: (id) => els[id] || null, createElement: (t) => mkNode('') }
      const logApi = new Function('document', 'window', 'localStorage', LOG_PANEL_SRC + '\nreturn window.__mpwLogPanel')(doc, win, { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v) } })
      const f = new Function('document', 'window', 'doReport', 'mpwArmLedger', 'setTimeout', 'fetch', 'logf',
        'let reportCount = 0;\n' + BTN_SRC + '\nwindow.__setCount = function (v) { reportCount = v };\nreturn { reportBtn }')
      const btn = f(doc, win, () => Promise.resolve({ ok: true, status: 200 }), () => {}, () => 0, () => Promise.resolve({ ok: true, status: 200 }), () => {}).reportBtn
      return { els, win, winFire, logApi, btn }
    }
    // 真机路径：pointerdown 从按钮开始，冒泡到祖先（按钮 stopPropagation → 到不了 logbar）
    const w = buildWorld()
    const before = w.logApi.state().collapsed
    const ev = mkEv()
    w.btn.fire('pointerdown', ev)
    for (let p = w.btn.parent; p && !ev._stop; p = p.parent) p.fire('pointerdown', ev)
    w.winFire('pointerup', { clientX: 0, clientY: 0 })
    check('T22b **真机 bug 回归**：点 `#mpw-report-btn` 后日志面板折叠态不变（按钮在 `#bar`，pointerdown 冒泡到不了 `#logbar`）',
      w.logApi.state().collapsed === before && w.btn.closest('#logbar') === null,
      'collapsed=' + w.logApi.state().collapsed + ' before=' + before + ' closest=null')
    // 测"测试能不能抓到 bug"：把同一颗按钮挪进 #logbar（旧位置）→ 同样的 event 序列必须把它收起
    const w2 = buildWorld()
    const clone = mkNode('mpw-report-btn')
    clone.addEventListener('pointerdown', (e) => e.stopPropagation())
    w2.els.logbar.appendChild(clone)
    w2.els.logbar.fire('pointerdown', mkEv())
    w2.winFire('pointerup', { clientX: 0, clientY: 0 })
    check('T22c 反证（测试有效性）：把按钮放回 `#logbar` 内，同样的 pointerdown/pointerup 序列**确实会**收起日志'
      + ' —— 证明 T22b 不是假绿（根因是 pointerdown 早于 mousedown，旧 stop 列表漏了它）',
      w2.logApi.state().collapsed === true, 'collapsed=' + w2.logApi.state().collapsed)
    check('T22d 按钮的 stop 列表含 `pointerdown`/`pointerup`（以后被挪进任何可拖动容器都不会复发；不靠给 #logbar 加特判）',
      /b\.addEventListener\('pointerdown', stop\)/.test(BTN_SRC) && /b\.addEventListener\('pointerup', stop\)/.test(BTN_SRC)
      && /b\.addEventListener\('mousedown', stop\)/.test(BTN_SRC) && /b\.addEventListener\('touchstart', stop\)/.test(BTN_SRC)
      && !/logbar[\s\S]{0,60}特判/.test(BTN_SRC))
  }
  // ── ② `?bones=` 结构化回传（两向断言：有 → 带上且帧数一致；无 → 键不出现）
  {
    const PAYLOAD_SNIPPET = /\.\.\.\(typeof window\.__mpwBones !== 'undefined' \? \{ bones: window\.__mpwBones \} : \{\}\),/.exec(HTML)
    const mkW = (bones) => {
      const win = {}
      if (bones !== undefined) win.__mpwBones = bones
      const f = new Function('window', 'return { ' + PAYLOAD_SNIPPET[0].replace(/,\s*$/, '') + ' }')
      return f(win)
    }
    const stub = { layer: '主体', id: 42, nb: 7, frames: [{ t: 1, bones: [[0.1, 1, 2]], flips: [0] }, { t: 2, bones: [[0.2, 3, 4]], flips: [1] }] }
    const on = mkW(stub)
    check('T22e `window.__mpwBones` 存在（`?bones=` 打开）→ payload `bones` 字段带上它，帧数与桩一致（不受 slice(-6000) 截断）',
      !!on && on.bones === stub && on.bones.frames.length === 2 && on.bones.nb === 7, JSON.stringify(Object.keys(on || {})))
    const off = mkW(undefined)
    check('T22f `window.__mpwBones` 不存在（未开 `?bones=`）→ payload **不含** `bones` 键（默认不写、不改变任何行为）',
      !!off && !('bones' in off) && Object.keys(off).length === 0, JSON.stringify(off))
    check('T22g 日志白名单已放行 `[bones]`（每 2s 一行不再被过滤掉）+ payload 位置在 `shot` 之前（同一对象、无额外包装）',
      /l\.indexOf\('\[bones\]'\) >= 0/.test(HTML) && PAYLOAD_SNIPPET && /\.\.\.\(__shotData \? \{ shot: __shotData \} : \{\}\),/.test(HTML))
  }
}

console.log('[T23] P-124 用户第 6 项（④⑤⑥）：浮窗"再点一次关掉"·最多一个、颜色读数只留 3 位小数、面板滚动跟随、面板收起即关')
{
  // ④+⑥ 全部在 **strictDom**（没有非标准 `parent` 别名 ⇒ 与浏览器同一套属性面）下跑真源码切片：
  //   旧代码 `wrap.parent.removeChild(wrap)` 在浏览器里恒为 undefined ⇒ 旧浮窗永远摘不掉。
  const tick = () => new Promise((r) => setTimeout(r, 1))
  const strict = { strictDom: true }
  const countWraps = (body) => body.children.filter((c) => c.className === 'mpw_pickerWrap').length
  const { API, doc, win } = runPanelBlock(strict)
  const pickerAnchor = () => (typeof API.pickerAnchor === 'function' ? API.pickerAnchor() : undefined)
  const host = mkEl('div', strict); host.ownerDocument = doc
  const D7 = lib.mergeUserProps({ schema: SCHEMA })
  const props7 = D7.props
  const m7 = lib.propsPanelModel(SCHEMA, props7, { locked: D7.locked })
  const calls7 = []
  const api7 = API.build(host, m7, {
    schema: SCHEMA,
    onChange: (k, v) => { props7[k] = lib.normalizePropValue(SCHEMA[k] && SCHEMA[k].type, v, props7[k]); calls7.push([k, props7[k]]) },
  })
  const swA = api7.rows.newproperty24.ctrl
  const swB = api7.rows.newproperty12.ctrl
  // 计数桩：① body.removeChild 摘掉了什么；② doc/window 的 removeEventListener 次数 = 旧实例 cleanup 真跑了吗
  const removed = []
  const rmBody = doc.body.removeChild
  doc.body.removeChild = (c) => { removed.push(c && c.className); return rmBody(c) }
  const teardown = { doc: 0, win: 0 }
  const rmDoc = doc.removeEventListener, rmWin = win.removeEventListener
  doc.removeEventListener = (t, h) => { teardown.doc++; return rmDoc(t, h) }
  win.removeEventListener = (t, h) => { teardown.win++; return rmWin(t, h) }
  check('T23a 前置：同一面板里两个真包颜色项都是色块按钮（newproperty24 / newproperty12）',
    swA.className === 'mpw_colorSwatch' && swB.className === 'mpw_colorSwatch' && swA !== swB)
  // ── 现场 1：同一个色块连点两次 = 关（用户原话"点一下再点一下，不会给它关掉，而是叠加几个在上面"）
  swA.fire('click')
  const w1 = API.pickerEl()
  check('T23b 点色块 A → 恰好 1 个浮窗 + PICKER.anchor = A（锚点参与 toggle 判定）',
    countWraps(doc.body) === 1 && !!w1 && w1.className === 'mpw_pickerWrap' && pickerAnchor() === swA,
    'wraps=' + countWraps(doc.body) + ' anchorIsA=' + (pickerAnchor() === swA))
  const rm0 = removed.length, tdDoc0 = teardown.doc, tdWin0 = teardown.win
  swA.fire('click')
  check('T23c **同一个色块再点一次 = 关闭**：body 里 .mpw_pickerWrap 计数 = 0（strictDom：摘节点只能靠标准 parentNode）',
    countWraps(doc.body) === 0 && API.pickerOpen() === false && API.pickerEl() === null,
    'wraps=' + countWraps(doc.body) + ' open=' + API.pickerOpen())
  check('T23d 关闭真的走了旧实例的 cleanup（计数桩：body 摘掉 1 个 .mpw_pickerWrap + doc 解绑 2 个监听 + window 解绑 3 个：mousemove/mouseup/scroll）',
    removed.length === rm0 + 1 && removed[removed.length - 1] === 'mpw_pickerWrap'
    && teardown.doc === tdDoc0 + 2 && teardown.win === tdWin0 + 3,
    'removed=' + JSON.stringify(removed.slice(rm0)) + ' doc+=' + (teardown.doc - tdDoc0) + ' win+=' + (teardown.win - tdWin0))
  check('T23e 关闭后监听不残留：doc.mousedown / win.mousemove / win.mouseup / win.scroll 全为 0',
    (doc._ls.mousedown || []).length === 0 && (win._ls.mousemove || []).length === 0
    && (win._ls.mouseup || []).length === 0 && (win._ls.scroll || []).length === 0,
    'doc.mousedown=' + (doc._ls.mousedown || []).length + ' win='
    + [(win._ls.mousemove || []).length, (win._ls.mouseup || []).length, (win._ls.scroll || []).length].join('/'))
  // ── 现场 2：点 A 再点 B —— 先关旧的再开新的（任何时刻页面里最多一个浮窗）
  let rectB = { top: 40, left: 8, right: 64, bottom: 60, width: 56, height: 20 }
  swB.getBoundingClientRect = () => rectB
  swA.fire('click'); await tick()
  const wA = API.pickerEl()
  doc.fire('mousedown', { target: swB })     // 真机事件顺序：mousedown（点外部）→ click（开新的）
  const midCount = countWraps(doc.body)
  swB.fire('click')
  const wB = API.pickerEl()
  check('T23f 点 A 再点 B：.mpw_pickerWrap 计数恒为 1、PICKER.el 换成 B 的浮窗、A 的节点已被真摘掉',
    midCount === 0 && countWraps(doc.body) === 1 && !!wB && wB !== wA && wB.className === 'mpw_pickerWrap'
    && pickerAnchor() === swB && !doc.body.children.includes(wA),
    'mid=' + midCount + ' wraps=' + countWraps(doc.body) + ' sameEl=' + (wB === wA))
  // ── 现场 3：⑥(a) 滚动跟随（window capture 收任意滚动容器的 scroll）
  check('T23g 开浮窗时定位 = 锚点矩形同步（top = rect.top - 10、left = rect.right + 8，插件同款口径）',
    wB.style.top === '30px' && wB.style.left === '72px', wB.style.left + ',' + wB.style.top)
  rectB = { top: 300, left: 8, right: 64, bottom: 320, width: 56, height: 20 }
  win.fire('scroll')
  check('T23h **面板滚动一次 → 浮窗跟着色块走**（top/left 与新矩形同步，而不是停在开浮窗那一刻的位置）',
    wB.style.top === '290px' && wB.style.left === '72px', wB.style.left + ',' + wB.style.top)
  rectB = { top: 700, left: 8, right: 64, bottom: 720, width: 56, height: 20 }
  win.fire('scroll')
  check('T23i 跟随后仍走"上下防溢出"同一套公式（锚点贴屏幕底 ⇒ 向上弹：700-198-6=496）',
    wB.style.top === '496px', wB.style.top)
  // ── 现场 4：⑥(b) 兜底 —— 锚点不可见（面板 display:none / 行被 condition 隐藏）
  rectB = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }
  win.fire('scroll')
  check('T23j 锚点矩形 0×0（面板收起/行隐藏）→ 滚一次即自动关闭，不留悬空浮窗',
    API.pickerOpen() === false && countWraps(doc.body) === 0, 'wraps=' + countWraps(doc.body))
  // ── 现场 5：⑤ 颜色读数只留前 3 位小数（**只改显示**）
  const r24 = api7.rows.newproperty24.readout
  check('T23k 颜色行读数 = 3 位小数（真机症状：满精度 0.5294117647058824… 太长，行尾位置被撑歪）',
    /^\d(\.\d{1,3})?( \d(\.\d{1,3})?){2}$/.test(r24.textContent) && !/\.\d{4,}/.test(r24.textContent)
    && r24.textContent === '0.529 0.463 0.831', JSON.stringify(r24.textContent))
  check('T23l 作者默认提示（title）同口径截断 + 新 API `fmtColorReadout` 边界稳（"1 1 1" 原样、空值空串）',
    r24.title === '作者默认: 0.529 0.463 0.831'
    && typeof API.fmtColorReadout === 'function' && API.fmtColorReadout('1 1 1') === '1 1 1'
    && API.fmtColorReadout('') === '' && API.fmtColorReadout('0 0 0') === '0 0 0',
    r24.title)
  swA.fire('click')
  const wA2 = API.pickerEl()
  const hexIn = wA2.children[2].children[1], okBtn = wA2.children[2].children[2]
  hexIn.value = '#ff8800'
  hexIn.fire('change')
  okBtn.fire('click')
  API.refresh(host, lib.propsPanelModel(SCHEMA, props7, { locked: D7.locked }), api7.rows, {})
  check('T23m 只截显示不改值：emit 收到的仍是满精度（hexToColor 6 位小数 "1 0.533333 0"），读数显示 3 位',
    calls7.length === 1 && calls7[0][0] === 'newproperty24' && calls7[0][1] === '1 0.533333 0'
    && r24.textContent === '1 0.533 0', JSON.stringify(calls7[0] || null) + ' readout=' + JSON.stringify(r24.textContent))
  // ── 现场 7：④ "任何时刻最多一个浮窗"的兜底网（真机场景：旧实例的 cleanup 被外部摘掉/被覆盖 ⇒ body 里有残留）
  {
    const stray = mkEl('div', strict)
    stray.className = 'mpw_pickerWrap'
    doc.body.appendChild(stray)
    swA.fire('click')
    check('T23q 开新浮窗前先把 body 里的残留浮窗清掉（按类名兜底）⇒ .mpw_pickerWrap 计数恒为 1，PICKER.el 不是残留那个',
      countWraps(doc.body) === 1 && !doc.body.children.includes(stray) && API.pickerEl() !== stray,
      'wraps=' + countWraps(doc.body))
    API.closePicker()
    check('T23r 兜底网不改变正常关闭路径：计数 0、pickerOpen=false', countWraps(doc.body) === 0 && API.pickerOpen() === false)
  }
  // ── 现场 6：⑥(b) 面板整体收起（⚙ 属性 再点一次 = 同一条 setOpen 路径）⇒ 浮窗必须同步关
  {
    const SRC = sliceBlock(HTML, '  let propsPanel = null\n', "\n  // ①(2026-09-12) ?isolate=名称(逗号分隔)")
    const lr = runPanelBlock()
    const winx = { __mpwPropsPanel: lr.API }
    const propsx = lib.mergeUserProps({ schema: SCHEMA }).props
    winx.__mpwPropsCtx = { map: propsx, schema: SCHEMA, locked: new Set(), store: {}, save: () => {}, key: 'mpw-props:' + ID }
    const sceneObj = sceneJsonOf()
    const scene = lib.parseScene(sceneObj, null, { attachCtx: { readEntry: (n) => lib.getEntry(PKG, n), time: 0 } })
    lib.applyRenderConfig(scene, { properties: propsx, propertiesSchema: SCHEMA, sceneId: ID, hideUI: true, log: () => {} })
    const doc2 = Object.assign({}, lr.doc)
    const bar = mkEl('div')
    doc2.getElementById = (id) => (id === 'bar' ? bar : null)
    doc2.body = mkEl('body')
    const g = new Function('document', 'window', 'localStorage', 'location', 'lib', 'scene', 'sceneObj', 'logf', 'URLSearchParams',
      SRC + '\nreturn { propsPanel, propsDiagPayload }')
    const r = g(doc2, winx, { getItem: () => null, setItem: () => {}, removeItem: () => {} }, { search: '?id=' + ID }, lib, scene, sceneObj, () => {}, URLSearchParams)
    const root = doc2.body.children.find((c) => c.id === 'mpw-props-panel')
    const btn = bar.children.find((c) => c.id === 'mpw-props-btn')
    check('T23n 前置：装载后面板打开（className="open"）+ 顶栏有 ⚙ 属性 按钮（收起走同一条 setOpen）',
      !!root && root.className === 'open' && !!btn, 'root="' + (root && root.className) + '" btn=' + !!btn)
    r.propsPanel.api.rows.newproperty24.ctrl.fire('click')
    // 注意：浮窗挂在面板块自己的 document.body 上（真机上与装载块同一个 document；测试里装载块用 doc2 隔离）
    const opened = countWraps(lr.doc.body)
    btn.fire('click')                                  // 收起面板
    check('T23o **面板整体收起 ⇒ 取色浮窗自动关闭**（用户原话"属性这个选项整体关闭的情况下，你取色盘不会自动关闭"）',
      opened === 1 && countWraps(lr.doc.body) === 0 && lr.API.pickerOpen() === false && root.className === '',
      'before=' + opened + ' after=' + countWraps(lr.doc.body) + ' root="' + root.className + '"')
    await tick()
    check('T23p 收起路径不泄漏：延后 arm 的 outside 监听没挂上（PICKER.el 已空 ⇒ arm 的实例校验拒绝）',
      (lr.doc._ls.mousedown || []).length === 0, 'doc.mousedown=' + (lr.doc._ls.mousedown || []).length)
  }
}

console.log('\n' + (fail === 0 ? '全部通过' : '存在失败') + `：${pass} 通过 / ${fail} 失败` + (skipped ? ' / ' + skipped + ' 跳过' : ''))
process.exit(fail === 0 ? 0 : 1)
