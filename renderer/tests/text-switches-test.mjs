// text-switches-test.mjs — N5（用户决策 A）四类文本可见性开关 + `embed=1` 消费 单测
// 复现：node text-switches-test.mjs
//
// 契约（已冻结，插件白名单 MPW_SCENE_DEBUG_KEYS 已放行）：
//   showclock / showdate / showweekday / showfps（值 0/1）；默认 clock/date/weekday **显示**、fps **隐藏**。
//   实现 = `applyRenderConfig` 的 hideUI 块把四类词从 uiRe 移出、改为按类别 + 开关判定；
//   `?showui`（hideUI=false）仍是"整组全显示"。
//   `embed=1`（插件 iframe 恒带）→ 日志区首次加载即完全收起 + 隐藏手柄（wallpaper iframe pointer-events:none）。
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import path from 'node:path'
import * as lib from '../core/we-scene-bundle.js'

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}

// ── 合成场景：覆盖四类 + 通用 UI + 普通文本 ─────────────────────────────────
const LAYERS = [
  ['Clock', 'clock'], ['时间', 'clock'], ['Clock Container', 'container'],
  ['Date', 'date'], ['日期', 'date'],
  ['D a y', 'weekday'], ['Day', 'weekday'], ['星期', 'weekday'],
  ['帧率显示', 'fps'], ['FPS', 'fps'], ['Frame', 'fps'],
  ['Song Title', 'ui'], ['提示框2', 'ui'], ['歌词', 'ui'], ['Cube', 'ui'],
  ['文本1', 'text'], ['早中晚', 'text'],
]
// ①(N5) 同名**非文本**层（时钟/日期底板 solid、分组层、Frame 框）——必须保持旧口径（隐藏）：
//   它们是包内真实存在的 `Clock`/`Date`/`Day` solid 底板，放出来会让 package-matrix 的
//   透明回退计数 +1~2/包（实测 22 行退化），而用户口径是"四类**文本**做开关"。
const NON_TEXT = [['Clock 底板', 'clock'], ['Date 底板', 'date'], ['Day 分组', 'weekday'], ['Frame 框', 'fps']]
function mkScene() {
  return {
    general: { orthogonalprojection: { width: 3840, height: 2160 } },
    layers: LAYERS.map(([name], i) => ({
      id: 100 + i, name, visible: true, size: [100, 100], scale: [1, 1, 1], origin: [0, 0, 0],
      image: 'models/x.json', parent: undefined, angles: [0, 0, 0], effects: [], __text: { text: 't' },
    })).concat(NON_TEXT.map(([name], i) => ({
      id: 300 + i, name, visible: true, size: [100, 100], scale: [1, 1, 1], origin: [0, 0, 0],
      image: 'models/util/solidlayer.json', solid: true, angles: [0, 0, 0], effects: [],
    }))),
  }
}
const nonTextNames = () => NON_TEXT.map(([n]) => n)
const visOf = (scene) => Object.fromEntries(scene.layers.map((l) => [l.name, !!l.visible]))
const catVis = (v, kind) => LAYERS.filter(([, k]) => k === kind).map(([n]) => v[n])

// 旧实现（修复前 uiRe 逐字复刻）——用于反证"73% 文本被无条件隐藏"
const OLD_UI_RE = /Cube|Song Title|Artist Name|Album Title|Play Icon|Pause Icon|dragAndDrop|clockHide|clockOrientation|textOrientation|Clock Container|Text Container|Rounded Corners|Round R|Round L|(^| )Frame($| )|toggle|Audio|音频|Spectrum|播放|音量|sound|Clock|Date|D a y|Day|时间|日期|星期|Launcher|歌词|Lyrics|music|Music|UI|mp3|MSR|唱片|Spectrum Visualizer|提示框|提示窗|prompt|Prompt/i
function oldHide(scene) {
  for (const l of scene.layers) if (OLD_UI_RE.test(String(l.name || ''))) l.visible = false
}

console.log('[N5] 四类文本开关（合成场景）')

console.log('[T1] 默认口径：clock/date/weekday 显示、fps 隐藏')
{
  const s = mkScene()
  lib.applyRenderConfig(s, { hideUI: true })
  const v = visOf(s)
  check('T1a clock 类全显示（Clock/时间）', catVis(v, 'clock').every(Boolean), JSON.stringify(catVis(v, 'clock')))
  check('T1b date 类全显示（Date/日期）', catVis(v, 'date').every(Boolean), JSON.stringify(catVis(v, 'date')))
  check('T1c weekday 类全显示（D a y/Day/星期）', catVis(v, 'weekday').every(Boolean), JSON.stringify(catVis(v, 'weekday')))
  check('T1d fps 类全隐藏（帧率显示/FPS/Frame）', catVis(v, 'fps').every((x) => x === false), JSON.stringify(catVis(v, 'fps')))
  check('T1e 通用 UI 仍隐藏（Song Title/提示框/歌词/Cube）', catVis(v, 'ui').every((x) => x === false), JSON.stringify(catVis(v, 'ui')))
  check('T1f 普通文本层不受影响', catVis(v, 'text').every(Boolean), JSON.stringify(catVis(v, 'text')))
  check('T1g 容器名仍走 uiRe（Clock Container 隐藏）', v['Clock Container'] === false)
  // 反证旧行为
  const s2 = mkScene()
  oldHide(s2)
  const v2 = visOf(s2)
  check('T1h 旧实现：clock/date/weekday/fps 类别全被隐藏（本测试抓得到旧行为）',
    [...catVis(v2, 'clock'), ...catVis(v2, 'date'), ...catVis(v2, 'weekday')].every((x) => x === false),
    'clock=' + JSON.stringify(catVis(v2, 'clock')) + ' weekday=' + JSON.stringify(catVis(v2, 'weekday')))
}

console.log('[T2] 四个开关逐个生效（只关自己那一类）')
{
  const cases = [['showClock', 'clock'], ['showDate', 'date'], ['showWeekday', 'weekday']]
  for (const [opt, kind] of cases) {
    const s = mkScene()
    lib.applyRenderConfig(s, { hideUI: true, [opt]: false })
    const v = visOf(s)
    const others = LAYERS.filter(([, k]) => k !== kind && (k === 'clock' || k === 'date' || k === 'weekday')).map(([n]) => v[n])
    check('T2 ' + opt + '=false → 只隐藏 ' + kind + ' 类，其他三类仍显示',
      catVis(v, kind).every((x) => x === false) && others.every(Boolean),
      kind + '=' + JSON.stringify(catVis(v, kind)))
  }
  const s = mkScene()
  lib.applyRenderConfig(s, { hideUI: true, showFps: true })
  const v = visOf(s)
  check('T2 showFps=true → fps 类显示（其余三类仍显示）',
    catVis(v, 'fps').every(Boolean) && catVis(v, 'clock').every(Boolean), JSON.stringify(catVis(v, 'fps')))
  const s2 = mkScene()
  lib.applyRenderConfig(s2, { hideUI: true, showClock: true, showDate: true, showWeekday: true, showFps: true })
  const v2 = visOf(s2)
  check('T2 四开关全开 → 四类全显示（= 旧 uiRe 里那批词全部放行）',
    ['clock', 'date', 'weekday', 'fps'].every((k) => catVis(v2, k).every(Boolean)))
  const s3 = mkScene()
  lib.applyRenderConfig(s3, { hideUI: true, showClock: false, showDate: false, showWeekday: false, showFps: false })
  const v3 = visOf(s3)
  check('T2 四开关全关 → 四类全隐藏，通用 UI 也还隐藏，普通文本仍在',
    ['clock', 'date', 'weekday', 'fps'].every((k) => catVis(v3, k).every((x) => x === false)) && catVis(v3, 'text').every(Boolean))
}

console.log('[T2b] 同名非文本层（solid 底板/分组）保持旧口径：始终隐藏（package-matrix 基线不漂移）')
{
  const s = mkScene()
  lib.applyRenderConfig(s, { hideUI: true })
  const v = visOf(s)
  check('T2b1 默认口径：非文本同名层仍隐藏（Clock 底板/Date 底板/Day 分组/Frame）', nonTextNames().every((n) => v[n] === false),
    nonTextNames().map((n) => n + '=' + v[n]).join(' '))
  const s2 = mkScene()
  lib.applyRenderConfig(s2, { hideUI: true, showClock: true, showDate: true, showWeekday: true, showFps: true })
  const v2 = visOf(s2)
  check('T2b2 四开关全开：非文本同名层**仍**隐藏（开关只作用于 __text 层）', nonTextNames().every((n) => v2[n] === false),
    nonTextNames().map((n) => n + '=' + v2[n]).join(' '))
  check('T2b3 同一批开关下文本层确实放出来了（对照）', catVis(v2, 'clock').every(Boolean) && catVis(v2, 'fps').every(Boolean))
}

console.log('[T3] ?showui（hideUI=false）语义不变：整组全显示')
{
  const s = mkScene()
  lib.applyRenderConfig(s, { hideUI: false })
  const v = visOf(s)
  check('T3a showui → 四类 + 通用 UI 全显示（含 fps 与 Song Title）',
    [...catVis(v, 'clock'), ...catVis(v, 'date'), ...catVis(v, 'weekday'), ...catVis(v, 'fps'), ...catVis(v, 'ui')].every(Boolean))
  const s2 = mkScene()
  lib.applyRenderConfig(s2, { hideUI: false, showFps: false })
  check('T3b showui 优先：showui 在时 showX=0 也不再隐藏（避免两套开关打架）',
    visOf(s2)['帧率显示'] === true)
}

console.log('[T4] TIME-VARIATION 时段层豁免仍然生效（showweekday=0 也不误杀 day 层）')
{
  const s = mkScene()
  // 一个真实时段变体组：display 属性 + 4 个名字像时段的层（≥2 个不同 slot 才算组）
  const props = ['morning', 'day', 'dusk', 'night']
  for (const p of props) {
    s.layers.push({ id: 900 + props.indexOf(p), name: p, visible: true, size: [100, 100], scale: [1, 1, 1], origin: [0, 0, 0], image: 'models/x.json', __visibleRaw: { user: { name: 'display', condition: p }, value: true } })
  }
  lib.applyRenderConfig(s, { hideUI: true, showWeekday: false })
  const day = s.layers.find((l) => l.name === 'day')
  check('T4a 时段组内的 day 层不被 showweekday=0 隐藏（timeVariantIds 豁免）', day && day.visible === true, 'day.visible=' + (day && day.visible))
  const s2 = mkScene()
  s2.layers.push({ id: 950, name: 'day', visible: true, size: [100, 100], scale: [1, 1, 1], origin: [0, 0, 0], image: 'models/x.json' })
  lib.applyRenderConfig(s2, { hideUI: true, showWeekday: false })
  check('T4b 非时段组的 day 层仍按开关隐藏', s2.layers.find((l) => l.id === 950).visible === false)
}

console.log('[T5] 真实语料（3327063360：21 个文本层，旧实现只显示 6 个）：可见数对比')
{
  const fs2 = fs
  const p = (process.env.MPW_SCENE_ROOT || path.join(WS, 'allwallpaper', 'dd')) + '/3327063360/scene.pkg'
  if (!fs2.existsSync(p)) { console.log('  (SKIP T5：语料包不存在)') } else {
    const pkg = lib.parsePkg(new Uint8Array(fs2.readFileSync(p)))
    const rd = (b) => new TextDecoder().decode(b).replace(/^\uFEFF/, '')
    const sj = JSON.parse(rd(lib.getEntry(pkg, 'scene.json')))
    const mk = () => lib.parseScene(sj, null, { attachCtx: { readEntry: (n) => lib.getEntry(pkg, n), time: 0 } })
    const count = (fn) => { const s = mk(); fn(s); let t = 0, v = 0; for (const l of s.layers) { if (!l.__text) continue; t++; if (l.visible) v++ } return { t, v } }
    const oldC = count((s) => oldHide(s))
    const defC = count((s) => lib.applyRenderConfig(s, { hideUI: true, sceneId: '3327063360' }))
    const allC = count((s) => lib.applyRenderConfig(s, { hideUI: true, sceneId: '3327063360', showClock: true, showDate: true, showWeekday: true, showFps: true }))
    const noneC = count((s) => lib.applyRenderConfig(s, { hideUI: true, sceneId: '3327063360', showClock: false, showDate: false, showWeekday: false, showFps: false }))
    check('T5a 默认口径可见文本层数 > 旧实现（恢复被无条件隐藏的时钟/日期/星期）', defC.v > oldC.v && defC.v > 0,
      'old=' + oldC.v + '/' + oldC.t + ' default=' + defC.v + ' all4on=' + allC.v + ' all4off=' + noneC.v)
    check('T5b 默认 < 四开关全开（fps 默认隐藏至少 1 层）', defC.v < allC.v, 'default=' + defC.v + ' all4on=' + allC.v)
    check('T5c 四开关全关后仍保留非四类文本（不会把画面文本全清空）', noneC.v > 0 && noneC.v < defC.v, 'all4off=' + noneC.v)
    // ①(N5) 非文本层：clock/date/weekday 三类与旧口径**逐位不变**（这就是 package-matrix 基线不漂移的证明）；
    //   fps 类是**新增类别**（旧 uiRe 只匹配独立词 `Frame`），帧率 widget 的容器/装饰三角一并随开关隐藏
    //   （只藏数字会剩两个悬空三角）→ 差异**只允许**落在 fps 类，且 package-matrix --check 实测无退化。
    {
      const mkA = () => lib.parseScene(sj, null, { attachCtx: { readEntry: (n) => lib.getEntry(pkg, n), time: 0 } })
      const a = mkA()
      lib.applyRenderConfig(a, { hideUI: false, sceneId: '3327063360' })     // 只跑 2.5/粒子/效果，不跑 hideUI
      for (const l of a.layers) if (OLD_UI_RE.test(String(l.name || ''))) l.visible = false   // 旧口径 step5
      const b = mkA()
      lib.applyRenderConfig(b, { hideUI: true, sceneId: '3327063360', showClock: true, showDate: true, showWeekday: true, showFps: true })
      const setOf = (s2) => new Set(s2.layers.filter((l) => !l.__text && l.visible).map((l) => String(l.name || l.id)))
      const A = setOf(a), B = setOf(b)
      const onlyOld = [...A].filter((n) => !B.has(n))
      const onlyNew = [...B].filter((n) => !A.has(n))
      const fpsRe = /帧率|[Ff][Pp][Ss]|(^| )Frame($| )/
      /* ①(P-170 2026-09-21) 音频响应型美术层（本包的 `Audio Bars`）是**另一条**豁免：hideUI 的名字正则里
         含 `Audio|Spectrum|…`，但"名字命中音频美术词 **且** 有特效/粒子/作者绑定"的层现在被放过
         （旧口径把它当 UI 一起藏掉）。它与 N5 文本开关**正交** ⇒ 这条断言只比"文本开关造成的差异"，
         把音频美术层从两侧剔除；剔除这件事本身另有判据（T5e1b），否则"剔除"会变成遮羞布。 */
      const AUDIO_ART_RE = /Audio\s?Bars?|音频|Spectrum|频谱|Visualizer/i
      const dropped = [...new Set([...A, ...B].filter((n) => AUDIO_ART_RE.test(n)))]
      const a2 = [...A].filter((n) => !AUDIO_ART_RE.test(n))
      const b2 = [...B].filter((n) => !AUDIO_ART_RE.test(n))
      const onlyOld2 = a2.filter((n) => !b2.includes(n))
      const onlyNew2 = b2.filter((n) => !a2.includes(n))
      check('T5e 非文本层可见集差异只出现在 fps 类（clock/date/weekday 逐位不变；音频美术层按 P-170 另计）',
        onlyOld2.every((n) => fpsRe.test(n)) && onlyNew2.every((n) => fpsRe.test(n)),
        '共 A=' + A.size + ' B=' + B.size + ' 旧多=[' + onlyOld.join(',') + '] 新多=[' + onlyNew.join(',') + '] 剔除=[' + dropped.join(',') + ']')
      check('T5e1b 被剔除的层确实是音频美术层（本包应为 `Audio Bars`；剔除不是遮羞布）',
        dropped.length > 0 && dropped.every((n) => AUDIO_ART_RE.test(n)) && dropped.some((n) => /^Audio Bars$/i.test(n)),
        dropped.join(','))
      check('T5e2 差异里的名字全部是帧率 widget 成员（帧率位置/帧率三角…）', onlyOld.length > 0 && onlyOld.every((n) => fpsRe.test(n)),
        onlyOld.join(','))
    }
    check('T5d 真实数字冻结（旧 6 → 默认 17 / 全开 18 / 全关 5，共 21 层文本）',
      oldC.v === 6 && defC.v === 17 && allC.v === 18 && noneC.v === 5 && defC.t === 21,
      'old=' + oldC.v + ' default=' + defC.v + ' all4on=' + allC.v + ' all4off=' + noneC.v + ' total=' + defC.t)
  }
}

console.log('[T6] embed=1 消费：日志面板首次加载即收起 + 隐藏手柄')
{
  const HTML = fs.readFileSync(new URL('../demo.html', import.meta.url), 'utf8')
  const i = HTML.indexOf('<script id="mpw-log-panel">')
  const j = HTML.indexOf('</script>', i)
  const SRC = HTML.slice(HTML.indexOf('>', i) + 1, j)
  check('T6a demo.html 解析 embed（代码里有 URLSearchParams(...).get/has(\'embed\')）',
    /URLSearchParams\([^)]*location[^)]*\)\)?[^;]*\.(get|has)\('embed'\)/.test(SRC) || /\.(get|has)\('embed'\)/.test(SRC))
  const mkEl = (id) => ({ id, style: {}, _cls: new Set(), classList: { add(c) { this._c = c }, remove() {} }, setAttribute() {}, addEventListener() {}, textContent: '', title: '' })
  function runPanel(search, store) {
    const els = { log: mkEl('log'), logbar: mkEl('logbar'), logarrow: mkEl('logarrow'), logtip: mkEl('logtip') }
    const win = { innerHeight: 720, PointerEvent: null, addEventListener() {}, location: { search } }
    const ls = { getItem: (k) => (k in store ? store[k] : null), setItem() {} }
    new Function('document', 'window', 'localStorage', SRC)({ getElementById: (id) => els[id] || null }, win, ls)
    return els
  }
  const em = runPanel('?pkgurl=x&embed=1&noreport=1', {})
  check('T6b embed=1 → 日志 height=0 / display:none（壁纸不被遮）', em.log.style.height === '0px' && em.log.style.display === 'none',
    'h=' + em.log.style.height + ' display=' + em.log.style.display)
  check('T6c embed=1 → 手柄隐藏（pointer-events:none 下点不到，不留死 UI）', em.logbar.style.display === 'none', String(em.logbar.style.display))
  check('T6d embed=1 → 箭头已是收起态 ▴', em.logarrow.textContent === '▴', em.logarrow.textContent)
  const noEm = runPanel('?pkgurl=x', {})
  check('T6e 不带 embed → 默认 35% 展开（本机调试语义不变）', noEm.log.style.height === '252px' && noEm.logbar.style.display !== 'none',
    'h=' + noEm.log.style.height)
  const emOff = runPanel('?embed=0', {})
  check('T6f ?embed=0 强制关掉 embed 模式 → 恢复默认展开', emOff.log.style.height === '252px', 'h=' + emOff.log.style.height)
  const emStored = runPanel('?embed=1', { 'mpw-log-h': '0.500' })
  check('T6g 用户手动调过的高度优先（embed 不覆盖 localStorage）', emStored.log.style.height === '360px', 'h=' + emStored.log.style.height)
  const emCollapsed = runPanel('?embed=1', { 'mpw-log-h': 'collapsed' })
  check('T6h 已存 collapsed 仍收起', emCollapsed.log.style.height === '0px')
}

console.log('\n' + (fail === 0 ? '全部通过' : '存在失败') + `：${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
