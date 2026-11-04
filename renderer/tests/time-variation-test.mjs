#!/usr/bin/env node
// time-variation-test.mjs — 日月循环（时间变化）补丁回归（PATCHES P-55）
//
// 覆盖用户第 5 项（pkg 3326873240「夜莺Night Day Night Gradient」）的 5 个根因与修法：
//   RC1 `applyUserProperties({})` 恒空 → 脚本拿不到 `timevarying`（T2/T3）
//   RC2 层引用缺 `getVideoTexture()` → 作者脚本每帧抛错（T1/T3）
//   RC3 `hideUI` 正则 `/Day/i` 误杀时段层 `day`（T4）
//   RC4 `window.__mpwUserProps` 从没人写（T3 跑 demo.html 真实解析片段）
//   RC5 逐层调试看不到被筛掉的层 + 插件转发的方向键无人接（T7/T8）
// 另覆盖渲染器自带通路（R1/R1b）：变体组识别、hour→时段、`?time=` 钉层、reassert（T5/T6）。
//
// 全部无 GL / 无浏览器：作者脚本走真实脚本宿主（elysia/scene-scripts.js）；
// demo.html 的 URL 解析 / 角标按钮 / 入站 message 监听用**从文件切出的真实源码**在无 DOM 环境执行。
// 确定性：脚本路径（只认 new Date().getHours()）用子进程 + TZ 钉死（`--tz-probe`），其余用显式 hour。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { applySceneScripts, createScriptCache, makeSceneRef, videoTexRefShared } from '../elysia/scene-scripts.js'
import { applyRenderConfig, applyTimeVariation, timeVariantGroups, timeVariantIds, slotOfTimeLayer } from '../core/we-scene-bundle.js'
import { ROOT } from './_root.mjs'   // ①(2026-09-16 目录整理) 根文件（demo.html / bundle / icons）在仓库根

const HERE = path.dirname(fileURLToPath(import.meta.url))
const HTML = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8')

let pass = 0, fail = 0
const ok = (c, n, d = '') => { if (c) { pass++; console.log('  ✓ ' + n + (d ? '  (' + d + ')' : '')) } else { fail++; console.error('  ✗ ' + n + (d ? '  (' + d + ')' : '')) } }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ── 真实语料夹具（3326873240）────────────────────────────────────────────────
// 作者脚本逐字抄自 docs/TIME-VARIATION-RESEARCH.md §2.2（= scene.pkg 内
// scene.json objects[id=6852].visible.script；docs/TIME-VARIATION-PATCH.md §5 V2 用的同一份）。
const AUTHOR_SCRIPT = `'use strict';

var displayVideo = ["morning", "day", "dusk", "night", "mddn"];
var electDisplay = false;
var timeVarying = false;
var morningtime = 5, daytime = 9, dusktime = 16, nighttime = 19;

export function init() {
    displayVideo = displayVideo.map(video => thisScene.getLayer(video));
    // displayVideo.forEach(video => video.getVideoTexture().stop());
    // displayVideo.forEach(layer => layer.visible = false);
}

var playVideo = function(num) {
    displayVideo.forEach((video, i) => {
        if(i === num) {
            video.getVideoTexture().play();
            video.visible = true;
        } else {
            video.getVideoTexture().pause();
            video.visible = false;
        }
    });
}

export function update() {
    var time = new Date();
    var hours = time.getHours();
    // console.log(hours);
    if(timeVarying)
    {
        if(hours > morningtime && hours <= daytime) {
            playVideo(0);
        } else if (hours > daytime && hours <= dusktime) {
            playVideo(1);
        } else if (hours > dusktime && hours <= nighttime) {
            playVideo(2);
        } else {
            playVideo(3);
        }
    }
    if(electDisplay && !timeVarying)
    {
        for(let i = 0; i < displayVideo.length; i++)
        {
            if(i == electDisplay) playVideo(i);
        }
    }
}

export function applyUserProperties(changedUserProperties) {
    if(changedUserProperties.hasOwnProperty('display'))
    {
        electDisplay = changedUserProperties.display;
    }
    if(changedUserProperties.hasOwnProperty('timevarying'))
    {
        timeVarying = changedUserProperties.timevarying;
    }
    if(changedUserProperties.hasOwnProperty('morningtime'))
    {
        morningtime = changedUserProperties.morningtime;
    }
    if(changedUserProperties.hasOwnProperty('daytime'))
    {
        daytime = changedUserProperties.daytime;
    }
    if(changedUserProperties.hasOwnProperty('dusktime'))
    {
        dusktime = changedUserProperties.dusktime;
    }
    if(changedUserProperties.hasOwnProperty('nighttime'))
    {
        nighttime = changedUserProperties.nighttime;
    }
}
`

// project.json general.properties 的展开值（2026-09-14 实测：display="0"、timevarying=true、
// morningtime/daytime/dusktime/nighttime = "4"/"9"/"17"/"20"，textinput 即字符串）
const PROPS = { display: '0', timevarying: true, morningtime: '4', daytime: '9', dusktime: '17', nighttime: '20' }

const TIME_LAYERS = [
  { id: 718, name: 'morning', cond: '0' },
  { id: 781, name: 'day', cond: '1' },
  { id: 899, name: 'dusk', cond: '2' },
  { id: 960, name: 'night', cond: '3' },
  { id: 1210, name: 'mddn', cond: '4' },
]
// 最小 scene.layers 形状（applyRenderConfig / applyTimeVariation 只读这些字段）
const mkScene = () => ({
  layers: TIME_LAYERS.map((l, i) => ({
    id: l.id, name: l.name, parent: 193, size: [3840, 2160], image: 'tex/' + l.name + '.json',
    origin: [1920, 1080, 0], scale: [1, 1, 1], angles: [0, 0, 0], solid: false, isContainer: false,
    visible: i === 0, __visibleRaw: { user: { condition: l.cond, name: 'display' }, value: i === 0 },
  })),
})
const visSet = (s) => s.layers.filter((l) => l.visible && TIME_LAYERS.some((t) => t.id === l.id)).map((l) => l.name)
const expectSlot = (h) => (h > 4 && h <= 9) ? 'morning' : (h > 9 && h <= 17) ? 'day' : (h > 17 && h <= 20) ? 'dusk' : 'night'

// ── 作者脚本夹具：载体层（id 6852 后处理层）+ 5 个时段层对象 ──────────────
const mkScriptScene = () => ({
  objects: [
    { id: 6852, name: '后处理层', visible: { script: AUTHOR_SCRIPT, value: true } },
    ...TIME_LAYERS.map((l, i) => ({ id: l.id, name: l.name, visible: i === 0 })),
  ],
})
// 跑一次真实脚本宿主，返回 {vis, errs}（vis = 脚本写回后可见的时段层名）
function runAuthorScript(opts = {}) {
  const scene = mkScriptScene()
  const errs = []
  applySceneScripts(scene, 0, {
    scriptCache: createScriptCache(),
    renderObjects: scene.objects,
    userProps: opts.userProps,
    noUserProps: opts.noUserProps,
    onError: (stage, e) => errs.push(stage + ':' + ((e && e.message) || e)),
  })
  const objs = scene.objects.filter((o) => TIME_LAYERS.some((t) => t.id === o.id))
  return { vis: objs.filter((o) => o.visible === true).map((o) => o.name), errs }
}

// ── TZ 子进程探针模式：脚本路径的 hour→时段（脚本内部只认 new Date().getHours()）──
if (process.argv[2] === '--tz-probe') {
  const a = runAuthorScript({ userProps: PROPS })
  const b = runAuthorScript({ userProps: PROPS, noUserProps: () => true })   // 旧行为（RC1 回退开关）
  console.log(JSON.stringify({ localHour: new Date().getHours(), slot: a.vis[0] || null, scriptVis: a.vis, authoredVis: b.vis, errs: a.errs.concat(b.errs) }))
  process.exit(0)
}

// ── demo.html 真实源码切片（?time/?hour 解析 / 角标按钮 / 入站监听）────────────
function slice(html, startMarker, endMarker, label) {
  const i = html.indexOf(startMarker)
  if (i < 0) throw new Error('切片起点未找到（demo.html 结构变了？）: ' + label)
  const j = html.indexOf(endMarker, i)
  if (j < 0) throw new Error('切片终点未找到（demo.html 结构变了？）: ' + label)
  return html.slice(i, j + endMarker.length)
}
const R2_SRC = slice(HTML, '// ── TIME-VARIATION（2026-09-14 第5项）', "logf('⚠ TIME-VARIATION 初始化失败: ' + e.message) }", 'R2 ?time/?hour 解析')
// ①(2026-09-25 音频线后修复) `demo.html` 现在有**两个** `window.addEventListener('message', (ev) => {`：
//   先是音频策略/停源监听（`mpw-audio-policy` / park，行 ~4739），后才是本判据要钉的 `mpw-ln-key` 入站监听（行 ~6471）。
//   旧写法从**第一个**匹配点切起 ⇒ 片子里含音频监听整段 + 两段之间的边界 ⇒ `new Function` 直接
//   SyntaxError（Unexpected token 'catch'），整套 `time-variation` 判红 —— 这是"判据锚在实现文本上"的老病。
//   现改为：**先定位结束标记，再向前找最近的那个起点** ⇒ 永远只切 `mpw-ln-key` 那一个监听，
//   以后往前面再加多少个 message 监听都不会再弄坏这条判据（意图不变：仍是"跑 demo.html 的真源码"）。
const MSG_SRC = (() => {
  const START = "window.addEventListener('message', (ev) => {"
  const END = '} catch (e) { /* 桥接失败不影响渲染 */ }\n    })'
  const j = HTML.indexOf(END)
  if (j < 0) throw new Error('切片终点未找到（demo.html 结构变了？）: mpw-ln-key 入站监听')
  const i = HTML.lastIndexOf(START, j)
  if (i < 0) throw new Error('切片起点未找到（demo.html 结构变了？）: mpw-ln-key 入站监听')
  return HTML.slice(i, j + END.length)
})()
const CTRL_SRC = slice(HTML, 'const ctrlAction = () => {', "if (cur.__lnNoSubMesh) { cur.__lnNoSubMesh = false; return }   // 停在别的层上也能退出该模式\n      enterGroup()\n    }", 'Q7 Ctrl 统一处理')
const BTN_SRC = slice(HTML, '// ②(2026-09-14 用户第 2 项)', "tag.__tvBtn.textContent = (isT && window.__mpwTime.pinned) ? '恢复时钟' : '加载此层'", '逐层调试角标/加载此层按钮')
// ②(P-64-MEDIA 轮顺带) 逐层调试的"移动语义"两处真源码：
//    · LN_MOVE_SRC = `lnTarget`/`moveBy`（未进入调试时 → 落第 0 层；已在调试中 → curPos()+delta）
//    · KB_SRC      = 键盘 keydown 路径（与插件转发的 mpw-ln-key 路径必须同构）
const LN_MOVE_SRC = (() => {
  const m = /const lnTarget = \(pos, entering, delta\) =>[^\n]*\n\s*const moveBy = \(delta\) =>[^\n]*/.exec(HTML)
  if (!m) throw new Error('切片起点未找到（demo.html 结构变了？）: lnTarget/moveBy')
  return m[0]
})()
const KB_SRC = slice(HTML, "window.addEventListener('keydown', (ev) => {\n      const k = ev.key", '    }, true)', 'R4b 键盘路径')
// 用真源码造一个 moveBy：把闭包里的 __lnOnly 换成 ref.v（测试可读写），setPos/curPos 由调用方注入
const mkMoveBy = (setPos, curPos, ref) => new Function('setPos', 'curPos', 'ref',
  'var __lnOnly = ref.v;\n' + LN_MOVE_SRC + '\nreturn function (delta) { __lnOnly = ref.v; return moveBy(delta) }'
)(setPos, curPos, ref)
const PROPS_SRC = slice(HTML, 'let propsMap = null', 'if (propsMap) window.__mpwUserProps = propsMap\n    } catch {}', 'S3 用户属性表')
for (const [label, src, params] of [
  ['R2', R2_SRC, ['lib', 'scene', 'propsMap', 'logf', 'location', 'window']],
  ['MSG', MSG_SRC, ['window', '__lnStart', 'setPos', 'curPos', 'stack', 'apply', 'scene', 'ctrlAction', 'moveBy']],
  ['KB', KB_SRC, ['window', '__lnStart', 'setPos', 'curPos', 'stack', 'apply', 'scene', 'ctrlAction', 'moveBy', 'swallow']],
  ['CTRL', CTRL_SRC, ['window', '__lnStart', 'scene', 'stack', 'logf', 'enterGroup']],
  ['BTN', BTN_SRC, ['tag', 'cur', '__lnOnly', 'scene', 'curPos', 'curList', 'stack', 'total', 'inGroup', 'smNote', 'document', 'window', 'apply']],
]) {
  try { new Function(...params, (label === 'MSG' || label === 'CTRL') ? 'let __lnOnly = __lnStart;\n' + src : src) } catch (e) { console.error('  ✗ 切片语法无效 [' + label + ']: ' + e.message); fail++ }
}

console.log('[T1] getVideoTexture()：4 个层引用工厂都返回可调用的 noop 句柄（RC2）')
{
  const ref = makeSceneRef([{ id: 1, name: 'morning', visible: true }])
  const l = ref.getLayer('morning')
  ok(typeof l.getVideoTexture === 'function', 'T1a thisScene.getLayer() 层引用有 getVideoTexture')
  const v = l.getVideoTexture()
  const calls = []
  let threw = null
  try {
    v.play(); calls.push(v.isPlaying())
    v.pause(); calls.push(v.isPlaying())
    v.stop(); calls.push(v.isPlaying())
    calls.push(v.getCurrentTime(), v.rate)
    v.setCurrentTime(3)
  } catch (e) { threw = e.message }
  ok(threw === null && eq(calls, [true, false, false, 0, 1]), 'T1b play/pause/stop/isPlaying/getCurrentTime/rate 全部 no-op 不抛', JSON.stringify(calls) + (threw ? ' threw=' + threw : ''))
  ok(videoTexRefShared(null).isPlaying() === false, 'T1c 空引用（emptyLayerRef 路径）同样安全')
  // 4 条工厂路径：thisScene.getLayer / thisLayer / thisLayer.getParent(空) / thisLayer.getParent(有父)
  const VID = `'use strict';
export function update() {
  var a = thisScene.getLayer('morning').getVideoTexture();
  var b = thisLayer.getVideoTexture();
  var c = thisLayer.getParent().getVideoTexture();
  var d = thisScene.getLayer('__nope__').getVideoTexture();
  a.play(); b.pause(); c.stop(); d.play();
  return [a.isPlaying(), b.isPlaying(), c.isPlaying(), d.isPlaying(), typeof a.rate, typeof a.setCurrentTime, a.getCurrentTime()].join('|');
}`
  const scene = { objects: [{ id: 9001, parent: 2, text: { script: VID, value: 'x' } }, { id: 2, name: 'p' }] }
  const errs = []
  applySceneScripts(scene, 0, { scriptCache: createScriptCache(), renderObjects: scene.objects, onError: (s, e) => errs.push(s + ':' + e.message) })
  ok(scene.objects[0].text.value === 'true|false|false|true|number|function|0' && !errs.length,
    'T1d 4 条工厂路径（getLayer/thisLayer/getParent 空/有父）全部可调用', String(scene.objects[0].text.value) + ' errs=' + JSON.stringify(errs.slice(0, 2)))
}

console.log('\n[T2] RC1：真实用户属性送进 applyUserProperties（作者脚本按时钟选层）')
{
  const { vis, errs } = runAuthorScript({ userProps: PROPS })
  const h = new Date().getHours()
  ok(errs.length === 0, 'T2a 无脚本错误（尤其没有 getVideoTexture is not a function）', JSON.stringify(errs.slice(0, 3)))
  ok(eq(vis, [expectSlot(h)]), 'T2b 5 层里只有当前时段的层可见（补丁前恒为 morning）', 'localHour=' + h + ' → ' + JSON.stringify(vis))
  const b = runAuthorScript({ userProps: PROPS, noUserProps: () => true })
  ok(eq(b.vis, ['morning']), 'T2c ?nouserprops=1 回退旧行为（全部停在 authored：只剩 morning）', JSON.stringify(b.vis))
  const c = runAuthorScript({ userProps: {} })
  ok(eq(c.vis, ['morning']), 'T2d 没有属性表时同样停在 authored', JSON.stringify(c.vis))
}

console.log('\n[T3] RC4：window.__mpwUserProps 由 demo.html 真实解析片段写入')
{
  const run = (search, projectJson) => {
    const win = {}
    const fn = new Function('fetch', 'id', 'lib', 'pkg', 'rd', 'location', 'window', 'logf',
      'return (async () => {' + PROPS_SRC + '})()')
    return fn(
      async () => (projectJson ? { ok: true, json: async () => projectJson } : null),
      '3326873240', { getEntry: () => null }, {}, () => '', { search }, win, () => {},
    ).then(() => win)
  }
  const w1 = await run('?id=3326873240', { general: { properties: { timevarying: { value: true }, display: { value: '0' }, morningtime: { value: '4' } } } })
  ok(w1.__mpwUserProps && w1.__mpwUserProps.timevarying === true && w1.__mpwUserProps.display === '0' && w1.__mpwUserProps.morningtime === '4',
    'T3a window.__mpwUserProps = project.json 展开值（脚本宿主读的就是它）', JSON.stringify(w1.__mpwUserProps))
  const w2 = await run('?props=display=3,timevarying=false', null)
  ok(w2.__mpwUserProps && w2.__mpwUserProps.display === '3' && w2.__mpwUserProps.timevarying === 'false',
    'T3b ?props= 覆盖也写进 window.__mpwUserProps（零改动 workaround 仍可用）', JSON.stringify(w2.__mpwUserProps))
}

console.log('\n[T4] RC3/R1b：hideUI 不再误杀名为 `day` 的时段层；星期/时钟文本改由 N5 开关控制')
{
  const s = mkScene()
  s.layers.push({ id: 4881, name: 'Day', parent: 193, size: [200, 80], origin: [0, 0, 0], scale: [1, 1, 1], visible: true, __visibleRaw: true })
  const ids = timeVariantIds(s)
  ok(TIME_LAYERS.every((t) => ids.has(t.id)) && !ids.has(4881), 'T4a 变体组 = 5 个时段层（UI 层 `Day` 不在组内）', 'ids=' + [...ids].join(','))
  applyRenderConfig(s, { properties: { display: '1', timevarying: 'false' }, hideUI: true })
  const by = (n) => s.layers.find((l) => l.name === n)
  ok(by('day').visible === true, 'T4b display=1 + hideUI → `day` 可见（补丁前被 /Day/i 抹掉）')
  // ①(N5 2026-09-14 用户决策 A) 口径变更：**四类开关只作用于文本层（`__text`）**。
  //   本 fixture 的 `Day` 不是文本层（无 `__text`）→ 保持旧行为（隐藏）；真正的星期**文本**层默认显示。
  //   RC3 的本意（不误杀时段层 `day`）继续由 T4b/T4c2 守着。
  ok(by('Day').visible === false, 'T4c 非文本的 `Day` 层默认仍隐藏（N5 开关只对文本层生效，package-matrix 基线不漂移）')
  {
    const sN5 = mkScene()
    sN5.layers.push({ id: 4881, name: 'Day', parent: 193, size: [200, 80], origin: [0, 0, 0], scale: [1, 1, 1], visible: true, __visibleRaw: true })
    sN5.layers.push({ id: 4882, name: 'Day', parent: 193, size: [200, 80], origin: [0, 0, 0], scale: [1, 1, 1], visible: true, __visibleRaw: true, __text: { text: 'Mon' } })
    applyRenderConfig(sN5, { hideUI: true })
    const texts = sN5.layers.filter((l) => l.name === 'Day' && l.__text)
    ok(texts.every((l) => l.visible === true), 'T4c2 同名**文本** `Day` 层默认显示（N5：showweekday 缺省=1）')
    const sN6 = mkScene()
    sN6.layers.push({ id: 4882, name: 'Day', parent: 193, size: [200, 80], origin: [0, 0, 0], scale: [1, 1, 1], visible: true, __visibleRaw: true, __text: { text: 'Mon' } })
    applyRenderConfig(sN6, { hideUI: true, showWeekday: false })
    ok(sN6.layers.find((l) => l.name === 'Day').visible === false && sN6.layers.find((l) => l.name === 'day').visible === true,
      'T4c3 ?showweekday=0 → 文本 `Day` 隐藏，时段层 `day` 仍被 timeVariantIds 豁免（豁免未被削弱）')
  }
  ok(by('morning').visible === false && by('night').visible === false, 'T4d 其它时段层按属性绑定保持隐藏')
  const s2 = mkScene()
  applyRenderConfig(s2, { properties: PROPS, hideUI: true })
  ok(eq(visSet(s2), ['morning']), 'T4e 默认属性 + hideUI → 基线仍是 morning（与真机上报逐位一致）', JSON.stringify(visSet(s2)))
  // ②(偏差记录 P-55) 假阳性回归：只有**单一** "day" 字样的 UI 组不得被判成时段变体组 ——
  //   真实语料里 3544152633 的 `clockdraganddrop`[Clock,DAY DATE TIME(EN/JP)] 与
  //   3660962877 的 `week1`[横Day,竖Day] 都曾被 R1b 的豁免放出来（时钟/星期 UI 层现形、audit 24→25 层）。
  const s3 = mkScene()
  const mkUi = (id, name, cond) => ({ id, name, parent: 193, size: [100, 100], origin: [0, 0, 0], scale: [1, 1, 1], visible: true, __visibleRaw: { user: { condition: cond, name: 'clockdraganddrop' }, value: true } })
  s3.layers.push(mkUi(5001, 'Clock', '0'), mkUi(5002, 'DAY DATE TIME (EN)', '1'), mkUi(5003, 'DAY DATE TIME (JP)', '2'))
  const gs3 = timeVariantGroups(s3)
  ok(gs3.length === 1 && gs3[0].name === 'display' && !timeVariantIds(s3).has(5001), 'T4f 只有单一 "day" 字样的 UI 组（Clock/DAY DATE TIME）不算时段变体组')
  // N5 后这些层默认显示（clock/date/weekday 三类默认开）——但**豁免不越界**仍要可证：
  // 四类开关全关时它们必须全部隐藏（= 它们没有混进 timeVariantIds 豁免名单）。
  const s4 = mkScene()
  s4.layers.push(mkUi(5001, 'Clock', '0'), mkUi(5002, 'DAY DATE TIME (EN)', '1'), mkUi(5003, 'DAY DATE TIME (JP)', '2'))
  applyRenderConfig(s4, { properties: PROPS, hideUI: true, showClock: false, showDate: false, showWeekday: false, showFps: false })
  ok([5001, 5002, 5003].every((i) => s4.layers.find((l) => l.id === i).visible === false), 'T4g 四类开关全关 → 这些 UI 层全部隐藏（豁免不越界）')
  applyRenderConfig(s3, { properties: PROPS, hideUI: true })
  ok([5001, 5002, 5003].every((i) => s3.layers.find((l) => l.id === i).visible === false), 'T4g2 非文本的 Clock/DAY DATE TIME 层仍隐藏（N5 开关只放文本层）')
  ok(eq(visSet(s3), ['morning']), 'T4h 同一场景里的真时段组不受影响')
}

console.log('\n[T5] R1：渲染器自带通路 —— 变体组识别 / hour→时段 / ?time= 钉层 / reassert')
{
  ok(slotOfTimeLayer('mddn') === null && slotOfTimeLayer('morning') === 'morning' && slotOfTimeLayer('Night') === 'night',
    'T5a 时段名识别（mddn = 渐变档，时钟不选）')
  const g = timeVariantGroups(mkScene())
  ok(g.length === 1 && g[0].name === 'display' && g[0].members.length === 5, 'T5b 识别出 1 个 `display` 变体组（5 层）', JSON.stringify(g.map((x) => x.name + ':' + x.members.length)))
  const table = [[3, 'night'], [4, 'night'], [6, 'morning'], [9, 'morning'], [12, 'day'], [17, 'day'], [18, 'dusk'], [20, 'dusk'], [21, 'night'], [22, 'night']]
  const bad = []
  for (const [hour, slot] of table) {
    const s = mkScene()
    const tv = applyTimeVariation(s, { properties: PROPS, hour })
    if (tv.picked !== slot || !eq(visSet(s), [slot])) bad.push(hour + ':' + tv.picked + '/' + JSON.stringify(visSet(s)))
  }
  ok(!bad.length, 'T5c hour→时段（含 4/9/17/20 边界半开区间 (a,b]）', table.map(([h, s]) => h + '→' + s).join(' ') + (bad.length ? ' BAD=' + bad.join(',') : ''))
  const s3 = mkScene()
  const clock = applyTimeVariation(s3, { properties: PROPS, hour: null })
  ok(clock.mode === 'clock' && clock.picked === expectSlot(new Date().getHours()), 'T5d 无 hour 覆盖时用真实时钟', 'localHour=' + clock.hour + ' → ' + clock.picked)
  const s4 = mkScene()
  const pin = applyTimeVariation(s4, { properties: PROPS, hour: 12, time: 'night' })
  ok(pin.mode === 'pin' && pin.pinned === 'night' && eq(visSet(s4), ['night']), 'T5e ?time=night&hour=12 → 无视时钟钉住 night')
  const s5 = mkScene()
  const byCond = applyTimeVariation(s5, { properties: PROPS, hour: 12, time: '2' })
  ok(byCond.pinned === 'dusk', 'T5f ?time=2（display 条件值）→ dusk')
  const s6 = mkScene()
  const byName = applyTimeVariation(s6, { properties: PROPS, hour: 12, time: 'mddn' })
  ok(byName.pinned === 'mddn' && eq(visSet(s6), ['mddn']), 'T5g ?time=mddn → 渐变层（时钟路径永不选它）')
  const s7 = mkScene()
  const bogus = applyTimeVariation(s7, { properties: PROPS, hour: 12, time: 'bogus' })
  ok(bogus.mode === 'clock' && bogus.picked === 'day', 'T5h ?time=bogus 未命中 → 回退时钟（不黑屏）')
  const s8 = mkScene()
  const tv8 = applyTimeVariation(s8, { properties: PROPS, hour: 12 })
  ok(tv8.pin('dusk') === true && eq(visSet(s8), ['dusk']), 'T5i 加载此层 = pin(层名)')
  for (const l of s8.layers) l.visible = false          // 模拟脚本 4Hz 抢走可见性
  ok(tv8.reassert() === true && eq(visSet(s8), ['dusk']), 'T5j reassert() 把被脚本抢走的时段扳回用户钉的层')
  ok(tv8.clearPin() === true && eq(visSet(s8), ['day']), 'T5k 恢复时钟 → 回到 hour=12 的 day')
  ok(tv8.isTimeLayer(s8.layers.find((l) => l.name === 'day')) === true && tv8.isTimeLayer({ id: 4881, name: 'Day' }) === false, 'T5l isTimeLayer 只认组内层')
  ok(applyTimeVariation({ layers: [] }, { properties: PROPS }) === null, 'T5m 无变体组 → 返回 null（普通场景零影响）')
}

console.log('\n[T6] R2：demo.html 的 ?time= / ?hour= 解析（跑真实源码片段）')
{
  const run = (search) => {
    const calls = []
    const win = {}
    new Function('lib', 'scene', 'propsMap', 'logf', 'location', 'window', R2_SRC)(
      { applyTimeVariation: (scene, opts) => { calls.push(opts); return { fake: true } } },
      { layers: [] }, PROPS, () => {}, { search }, win)
    return { opts: calls[0], win }
  }
  const a = run('?id=3326873240&time=dusk&hour=14')
  ok(a.opts && a.opts.time === 'dusk' && a.opts.hour === 14 && a.opts.properties === PROPS && typeof a.opts.log === 'function',
    'T6a ?time=dusk&hour=14 → 两个覆盖都透传（含 properties/log）', JSON.stringify({ time: a.opts.time, hour: a.opts.hour }))
  ok(a.win.__mpwTime && a.win.__mpwTime.fake === true, 'T6b 结果挂到 window.__mpwTime（脚本/开关都读它）')
  const b = run('?id=3326873240')
  ok(b.opts && b.opts.time === null && b.opts.hour === null, 'T6c 无参数 → time/hour 均为 null（走真实时钟）')
  const c = run('?time=morning&hour=abc')
  ok(c.opts.hour !== null && !isFinite(c.opts.hour), 'T6d ?hour=abc → NaN（applyTimeVariation 内部按"无覆盖"处理）')
  const tv = applyTimeVariation(mkScene(), { properties: PROPS, time: c.opts.time, hour: c.opts.hour })
  ok(tv.mode === 'pin' && tv.picked === 'morning', 'T6e 非法 hour + ?time=morning → 仍按 time 钉 morning')
}

console.log('\n[T7] R4c：插件转发的 {type:mpw-ln-key} 入站监听（demo.html 真实源码片段）')
{
  const build = () => {
    const handlers = []
    const calls = []
    let toggleResult = true
    const win = {
      addEventListener: (t, h) => { if (t === 'message') handlers.push(h) },
      __mpwTime: {
        pinned: null,
        pin: (n) => { calls.push(['pin', n]); return true },
        clearPin: () => { calls.push(['clearPin']); return true },
        isTimeLayer: (l) => !!(l && TIME_LAYERS.some((t) => t.name === l.name)),
      },
      __mpwTimeToggle: () => { calls.push(['toggle']); return toggleResult },
      __setToggle: (v) => { toggleResult = v },
    }
    // 12 层：夹住 ↑/↓ 的 ±10 步进，避免 clamp 干扰断言
    const scene = { layers: [{ id: 1, name: 'plain' }, { id: 718, name: 'morning' }, ...Array.from({ length: 10 }, (_, i) => ({ id: 100 + i, name: 'l' + i }))] }
    const state = { ln: -1 }
    const holder = { set: null }                             // 让 setPos 像真实 demo 一样回写闭包里的 __lnOnly
    const setPos = (p) => { calls.push(['setPos', p]); state.ln = Math.max(0, Math.min(scene.layers.length - 1, p)); if (holder.set) holder.set(state.ln) }
    // ②(P-64-MEDIA) curPos 用**真实口径**（空栈 = __lnOnly；有栈 = 栈顶 pos），不再 `Math.max(0, …)` 夹死
    const stack = []
    const curPos = () => (stack.length ? stack[stack.length - 1].pos : state.ln)
    const ref = { get v() { return state.ln }, set v(x) { state.ln = x } }
    const moveBy = mkMoveBy(setPos, curPos, ref)             // ← 用 demo.html 里那段真源码建
    const apply = () => calls.push(['apply'])
    const api = new Function('window', '__lnStart', 'setPos', 'curPos', 'stack', 'apply', 'scene', 'ctrlAction', 'moveBy',
      'let __lnOnly = __lnStart;\n' + MSG_SRC + '\nreturn { get ln(){return __lnOnly}, set ln(v){__lnOnly=v} }'
    )(win, state.ln, setPos, curPos, stack, apply, scene, () => calls.push(['ctrlAction']), moveBy)
    holder.set = (v) => { api.ln = v }
    const send = (data) => handlers.forEach((h) => h({ data }))
    return { api, send, calls, stack, win, state, handlers, moveBy }
  }
  // ②(P-64-MEDIA) 键盘路径（demo.html 的 keydown 监听）单独驱动：与 mpw-ln-key 路径做**同构断言**
  const buildKeys = () => {
    const handlers = []
    const calls = []
    const scene = { layers: [{ id: 1, name: 'plain' }, ...Array.from({ length: 11 }, (_, i) => ({ id: 100 + i, name: 'l' + i }))] }
    const state = { ln: -1 }
    const win = {
      addEventListener: (t, h) => { if (t === 'keydown') handlers.push(h) },
      __mpwTime: { pinned: null, pin: () => true, clearPin: () => true, isTimeLayer: () => false },
      __mpwTimeToggle: () => false,
    }
    const holder = { set: null }                             // 与 MSG 路径同款：setPos 要回写切片里的 __lnOnly
    const setPos = (p) => { calls.push(['setPos', p]); state.ln = Math.max(0, Math.min(scene.layers.length - 1, p)); if (holder.set) holder.set(state.ln) }
    const stack = []
    const curPos = () => (stack.length ? stack[stack.length - 1].pos : state.ln)
    const ref = { get v() { return state.ln }, set v(x) { state.ln = x } }
    const moveBy = mkMoveBy(setPos, curPos, ref)
    new Function('window', '__lnStart', 'setPos', 'curPos', 'stack', 'apply', 'scene', 'ctrlAction', 'moveBy', 'swallow',
      'let __lnOnly = __lnStart;\n' + KB_SRC + '\nwindow.__lnApi = { get ln(){return __lnOnly}, set ln(v){__lnOnly=v} }'
    )(win, state.ln, setPos, curPos, stack, () => calls.push(['apply']), scene, () => calls.push(['ctrlAction']), moveBy, () => calls.push(['swallow']))
    holder.set = (v) => { if (win.__lnApi) win.__lnApi.ln = v }
    const send = (key) => handlers.forEach((h) => h({ key, preventDefault() {}, stopImmediatePropagation() {} }))
    return { api: win.__lnApi, send, calls, stack, win, state }
  }
  ok(MSG_SRC.includes("'mpw-time-set'") && MSG_SRC.includes("d.key === 'Control'"), 'T7a 切片是正确的入站监听（含 mpw-time-set + Q7 新增的 Control 分支）')
  const h = build()
  ok(h.handlers.length === 1, 'T7b demo.html 装上了入站 message 监听（补丁前一个都没有）')
  h.send(null); h.send({ type: 'mpw-other', key: 'ArrowRight' }); h.send('mpw-ln-key')
  ok(h.calls.length === 0, 'T7c 非本协议/畸形消息一律忽略')
  h.send({ type: 'mpw-ln-key', key: 'Home' })
  ok(h.calls.length === 0, 'T7d 未进入调试时 Home 不生效（与键盘语义一致：只有 ←/→ 能开始）')
  h.send({ type: 'mpw-ln-key', key: 'ArrowRight' })
  ok(eq(h.calls, [['setPos', 0], ['apply']]) && h.api.ln === 0,
    'T7e mpw-ln-key ArrowRight 被接受；**首次进入 = 第 0 层（角标"第 1/n 层"）**'
    + '（用户 bug「按一下右键直接切到第 2 层，而不是从第 1 层开始」已修；期望值由 lnTarget 语义推导，'
    + '不再抄旧 off-by-one 数字）', JSON.stringify(h.calls))
  h.calls.length = 0
  h.send({ type: 'mpw-ln-key', key: 'ArrowLeft' })
  h.send({ type: 'mpw-ln-key', key: 'ArrowUp' })
  h.send({ type: 'mpw-ln-key', key: 'ArrowDown' })
  ok(eq(h.calls, [['setPos', -1], ['apply'], ['setPos', 10], ['apply'], ['setPos', 0], ['apply']]),
    'T7f 进入后 ←/→ ±1、↑/↓ ±10（第 0 层再 ← 得 -1，由 setPos 钳回第 0 层）—— 与键盘路径同构', JSON.stringify(h.calls))
  // ②(P-64-MEDIA 轮顺带) **路径等价性**：同一次按键序列，键盘 keydown 路径与插件 mpw-ln-key 转发路径
  //   必须产生逐项相同的 setPos 序列与相同落点（单边改动会在这里立刻红）
  {
    // 键盘路径多一层 `swallow(ev)` 记账（防止按键传给宿主页），比较时剥掉它
    const strip = (a) => a.filter((c) => c[0] !== 'swallow')
    const seq = ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown']
    const kb = buildKeys(); seq.forEach((k) => kb.send(k))
    const mp = build(); seq.forEach((k) => mp.send({ type: 'mpw-ln-key', key: k }))
    ok(eq(strip(kb.calls), mp.calls) && kb.api.ln === mp.api.ln && kb.api.ln === 0,
      'T7f2 键盘路径 与 插件转发路径 **逐项同构**（同序列 → 同 setPos 序列、同落点 = 第 0 层；'
      + '键盘侧多出的 swallow 是"别把键传给宿主页"的记账，已剥离后比较）',
      'kb=' + JSON.stringify(strip(kb.calls)) + ' msg=' + JSON.stringify(mp.calls))
    const kb2 = buildKeys(); kb2.send('ArrowUp')
    const mp2 = build(); mp2.send({ type: 'mpw-ln-key', key: 'ArrowUp' })
    ok(eq(strip(kb2.calls), mp2.calls) && kb2.calls.length === 0 && mp2.calls.length === 0,
      'T7f3 未进入调试时 ↑ 在两条路径上都被忽略（只有 ←/→ 能开始；键盘语义 = 插件转发语义）',
      'kb=' + JSON.stringify(kb2.calls))
    const kb3 = buildKeys(); kb3.send('ArrowLeft')
    const mp3 = build(); mp3.send({ type: 'mpw-ln-key', key: 'ArrowLeft' })
    ok(eq(strip(kb3.calls), mp3.calls) && kb3.api.ln === 0 && mp3.api.ln === 0 && eq(strip(kb3.calls), [['setPos', 0], ['apply']]),
      'T7f4 ← 首次进入也落第 0 层（与 → 同落点：选定"保守、与用户原话一致"的口径）', JSON.stringify(strip(kb3.calls)))
  }
  h.calls.length = 0
  h.api.ln = 1                                             // 当前层 = morning（时段层）
  h.send({ type: 'mpw-ln-key', key: 'Home' })
  ok(eq(h.calls, [['toggle'], ['apply']]) && h.api.ln === 1, 'T7g Home 停在时段层上 → 钉层/恢复时钟（不退出调试）', JSON.stringify(h.calls))
  h.calls.length = 0
  h.api.ln = 0                                             // 当前层 = plain（非时段层）
  h.win.__setToggle(false)
  h.send({ type: 'mpw-ln-key', key: 'Home' })
  ok(eq(h.calls, [['toggle'], ['apply']]) && h.api.ln === -1 && h.stack.length === 0, 'T7h 非时段层 Home → 维持原语义（退出调试）')
  h.calls.length = 0
  h.api.ln = 1
  h.send({ type: 'mpw-ln-key', key: 'Alt' })
  ok(h.api.ln === -1 && h.stack.length === 0 && eq(h.calls, [['apply']]), 'T7i Alt 仍可随时退出（逃逸口保留）')
  h.calls.length = 0
  h.api.ln = 1
  h.send({ type: 'mpw-ln-key', key: 'Control' })
  ok(eq(h.calls, [['ctrlAction'], ['apply']]), 'T7j（Q7）Control 进入共享 ctrlAction（旧实现落到 else return = 死键）；Alt 已于 T7i 验证仍可退出', JSON.stringify(h.calls))
  h.calls.length = 0
  h.send({ type: 'mpw-time-set', name: 'dusk' })
  ok(eq(h.calls, [['pin', 'dusk'], ['apply']]), 'T7k 预留 {type:mpw-time-set,name} → pin（插件侧将来加按钮零改动）')
  h.calls.length = 0
  h.send({ type: 'mpw-time-set', name: 'auto' })
  h.send({ type: 'mpw-time-set', name: 'clock' })
  h.send({ type: 'mpw-time-set' })
  ok(eq(h.calls, [['clearPin'], ['apply'], ['clearPin'], ['apply'], ['clearPin'], ['apply']]), 'T7l auto/clock/空名 → 恢复时钟', JSON.stringify(h.calls))
}

console.log('\n[Q7] Ctrl 进出"网格单块不可拆（MDL 单材质块）"：ctrlAction 真实源码切片')
{
  const mk = (layers, ln, subCount, stack0 = []) => {
    const calls = []
    const win = subCount ? { __mpwSubMeshCount: subCount } : {}
    const st = { stack: stack0.slice() }
    const api = new Function('window', '__lnStart', 'scene', 'stack', 'logf', 'enterGroup',
      'let __lnOnly = __lnStart;\n' + CTRL_SRC + '\nreturn { ctrl: ctrlAction, get ln(){return __lnOnly}, set ln(v){__lnOnly=v} }'
    )(win, ln, { layers }, st.stack, (m) => calls.push(String(m)), () => calls.push('enterGroup'))
    return { api, stack: st.stack, calls }
  }
  const mesh = { id: 7, name: '主体', __skin: true }
  // ① 单材质块（当前语料常态）：进 → 出
  const a = mk([{ id: 1, name: 'plain' }, mesh], 1)
  a.api.ctrl()
  ok(a.api.ln === 1 && mesh.__lnNoSubMesh === true && mesh.__subMeshOnly == null, 'Q7a 单块网格 Ctrl#1 → 进"不可拆"模式（__lnNoSubMesh=true）', JSON.stringify({ no: mesh.__lnNoSubMesh, sub: mesh.__subMeshOnly }))
  a.api.ctrl()
  ok(mesh.__lnNoSubMesh === false && a.api.ln === 1, 'Q7b 单块网格 Ctrl#2 → **退出**该模式（旧实现无清零点，永远卡住）', JSON.stringify({ no: mesh.__lnNoSubMesh }))
  ok(/网格单块，不可拆（MDL 单材质块）：Ctrl 退出/.test(HTML), 'Q7c 角标文案明说"Ctrl 退出"（旧文案只写"不可拆"，用户没有出路提示）')
  ok(HTML.includes("else if (k === 'Control') ctrlAction()") && HTML.includes('cur.__lnNoSubMesh = !cur.__lnNoSubMesh') && !/cur\.__subMeshOnly == null\) \? 0/.test(HTML),
    'Q7d 键盘路径改为调用共享 ctrlAction（旧内联分支已删，单块改为可逆）')
  ok(a.calls.some((m) => /已退出网格子块模式/.test(m)), 'Q7e 退出时日志可查', a.calls.join(' | ').slice(0, 120))
  // ② 多材质块（未来 MDL）：0→1→2→退出（原语义不变）
  const m3 = { id: 8, name: '多块', __skin: true }
  const b = mk([m3], 0, { 8: 3 })
  b.api.ctrl(); const s0 = m3.__subMeshOnly
  b.api.ctrl(); const s1 = m3.__subMeshOnly
  b.api.ctrl(); const s2 = m3.__subMeshOnly
  b.api.ctrl(); const s3 = m3.__subMeshOnly
  ok(s0 === 0 && s1 === 1 && s2 === 2 && s3 === null, 'Q7f 多块网格 Ctrl 循环 0→1→2→整块（原行为保留）', JSON.stringify([s0, s1, s2, s3]))
  // ③ 组内 → 退一级组合（原语义不变）
  const c = mk([{ id: 1 }, { id: 2 }, mesh], 1, null, [{ id: 9, list: [0, 2], pos: 1 }])
  c.api.ctrl()
  ok(c.stack.length === 0 && c.api.ln === 2, 'Q7g 组内 Ctrl → 退一级组合（原语义）', JSON.stringify({ ln: c.api.ln, stack: c.stack.length }))
  // ④ 普通层 → enterGroup（原语义不变）
  const d = mk([{ id: 1, name: 'plain' }], 0)
  d.api.ctrl()
  ok(d.calls.includes('enterGroup'), 'Q7h 普通层 Ctrl → enterGroup()（进入组合，原语义）')
}

console.log('\n[T8] 逐层调试 UX：时段层标记 + [加载此层] 按钮 + （已跳过）括号提示')
{
  const mkTag = () => ({
    id: '__mpwLnTag', children: [], style: {}, _text: '', __tvBtn: undefined,
    appendChild(c) { this.children = this.children.filter((x) => x !== c); this.children.push(c); c.parentNode = this; return c },
    get textContent() { return this._text },
    // 真 DOM 语义：写 textContent 会清空所有子节点（补丁原稿把按钮挂在赋值之前 → 会被同一次 apply() 摘掉）
    set textContent(v) { this._text = String(v); for (const c of this.children) c.parentNode = null; this.children = [] },
  })
  const doc = { createElement: () => ({ id: '', style: {}, onclick: null, parentNode: null, textContent: '' }) }
  const run = (tag, ln, cur, pinned = null) => {
    const calls = []
    const win = { __mpwTime: { pinned, isTimeLayer: (l) => !!(l && TIME_LAYERS.some((t) => t.name === l.name)) }, __mpwTimeToggle: () => { calls.push('toggle'); return true } }
    new Function('tag', 'cur', '__lnOnly', 'scene', 'curPos', 'curList', 'stack', 'total', 'inGroup', 'smNote', 'document', 'window', 'apply', BTN_SRC)(
      tag, cur, ln, { layers: [cur] }, () => 0, () => [cur], [], () => 1, false, '', doc, win, () => calls.push('apply'))
    return calls
  }
  const tag = mkTag()
  const morning = { id: 718, name: 'morning', visible: false }
  const r1 = run(tag, 0, morning)
  ok(tag.children.length === 1 && tag.children[0] === tag.__tvBtn && tag.__tvBtn.style.display === 'inline-block',
    'T8a 时段层：按钮已挂在角标上且可见（偏差修正：textContent 赋值之后重新挂回）')
  ok(tag.textContent.includes('[时段层]') && tag.textContent.includes('（已跳过：该层不可见）'),
    'T8b 角标带 [时段层] 标记 + （已跳过：该层不可见）括号提示', JSON.stringify(tag.textContent.slice(0, 80)))
  ok(tag.__tvBtn.textContent === '加载此层' && tag.__tvBtn.id === '__mpwTimeBtn', 'T8c 未钉住时按钮文案 = 加载此层')
  const r2 = run(tag, 0, morning, 'morning')                // 第二次 apply()：textContent 先清空子节点（按钮闭包仍属第一次 run）
  ok(tag.children.length === 1 && tag.__tvBtn.textContent === '恢复时钟', 'T8d 多次 apply() 后按钮仍在（不会被 textContent 摘掉）+ 已钉住时文案 = 恢复时钟')
  tag.__tvBtn.onclick({ preventDefault() {}, stopPropagation() {} })
  ok(eq(r1, ['toggle', 'apply']) && r2.length === 0, 'T8e 按钮点击 = __mpwTimeToggle() + apply()（与 Home 同一条路径；按钮只创建一次，闭包保持）', JSON.stringify(r1))
  run(tag, 0, { id: 1, name: 'plain', visible: true })
  ok(tag.__tvBtn.style.display === 'none' && !tag.textContent.includes('[时段层]') && !tag.textContent.includes('已跳过'),
    'T8f 非时段层：按钮隐藏、无标记、无括号提示')
  run(tag, 0, { id: 2, name: '组合', visible: true, isContainer: true })
  ok(tag.textContent.includes('（已跳过：组合容器不绘制）'), 'T8g 组合容器：括号提示说明不绘制原因')
}

console.log('\n[T9] 脚本路径 hour→时段：子进程 + TZ 钉死（morning/day/dusk/night 四档）')
{
  const utcHour = new Date().getUTCHours()
  const targets = [[6, 'morning'], [12, 'day'], [18, 'dusk'], [22, 'night']]
  const bad = []
  for (const [target, slot] of targets) {
    let off = target - utcHour
    // 归一到 [-11, 11]（Etc/GMT∓N 只到 ±12，且必须走"模 24"而不是 JS 取余——
    // ①(修 2026-09-14 UTC 19 时段实测) 旧式 `((off+12)%24)-12` 对 off<-12 会给出 -13…-23：
    //   `Etc/GMT+13` 这样的名字 ICU 不认识 → TZ **静默回退 UTC** → localHour 变成 UTC 小时，
    //   T9 在 UTC 19:00–23:59 这 5 小时窗口里必然假红（与渲染逻辑无关的测试自身缺陷）。
    off = ((off % 24) + 24) % 24
    if (off > 11) off -= 24
    const tz = 'Etc/GMT' + (off <= 0 ? '+' : '-') + Math.abs(off)
    let out
    try {
      out = execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--tz-probe'], { env: { ...process.env, TZ: tz }, encoding: 'utf8', timeout: 30000 })
    } catch (e) { bad.push(tz + ' 子进程失败: ' + (e.message || '').slice(0, 80)); continue }
    let j
    try { j = JSON.parse(out.trim().split('\n').pop()) } catch { bad.push(tz + ' 输出非 JSON: ' + out.slice(0, 60)); continue }
    const okScript = j.slot === slot && Math.abs(j.localHour - target) <= 1
    const okNoProps = eq(j.authoredVis, ['morning'])
    const okErrs = !(j.errs || []).some((x) => /getVideoTexture/.test(x))
    if (!(okScript && okNoProps && okErrs)) bad.push(tz + ' localHour=' + j.localHour + ' slot=' + j.slot + ' authored=' + JSON.stringify(j.authoredVis) + ' errs=' + JSON.stringify((j.errs || []).slice(0, 2)))
    else console.log('    ' + tz + ' localHour=' + j.localHour + ' → ' + j.slot + '（nouserprops 回退 ' + JSON.stringify(j.authoredVis) + '）')
  }
  ok(!bad.length, 'T9 作者脚本在四档 TZ 下选出正确时段层，且 ?nouserprops 回退稳定', bad.join(' | '))
}

console.log('\n' + (fail ? '✗' : '✓') + ' time-variation: ' + pass + ' 通过 / ' + fail + ' 失败')
process.exit(fail ? 1 : 0)
