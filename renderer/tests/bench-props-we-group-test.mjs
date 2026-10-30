// bench-props-we-group-test.mjs — P-201（2026-09-25 · 壁纸配置面板）「渲染器设置（WE 自带）」这一组的判据集
//
// 用户报的 bug（原话）：「壁纸配置里面 we 自带选项，它是打不开的……他这里只显示了有一项，而且展不开。
//   他那个自带的一些设置，是针对每一个壁纸都有的。」
// 澄清后：「we 自带选项 = 我向你提出的那几个选项（Flip 和 Show color options 什么什么的）」。
//
// 改前真机读数（`:8902` 真页面 + 真语料根）：
//   {"wePresent":true,"weCount":1,"weNames":["schemecolor"],"collapsed":false,"firstChildIsWeGroup":true}
// —— 这一组当时是从**壁纸属性行**里"分类"出来的（`propsRows().filter(isWeBuiltinPropRow)`），
//    真语料里只有 `schemecolor` 会被命中，而它同时在 `PROPS_HIDDEN_NAMES` 里 ⇒ 表头报「1 项」、
//    点开一行都看不见（折叠本身是通的，只是里面没有内容）。而用户要的那几项**根本不在 `project.json` 里**。
//
// 应然（= 本文件的判据）：这一组是**补丁自己画的固定清单**（`WE_RENDERER_ITEMS`，每张壁纸一样），
//   每一项**直接驱动渲染器 API 并即时生效**；本仓没做的项**照实写一行**（未实现 / WE 客户端自带），
//   不静默少项；计数**只算可见项**；缺省展开、点表头可收起再展开。
//
// 判据分层（与仓库既有门禁同款）：
//   A 段（纯 Node，无浏览器）：清单与 DICT 的真源逐项对账 + 源码级钉子（不再从属性行分类 / 计数只算可见项 /
//     缺省展开 / 唯一驱动点 / 组内无裸 select）。
//   B 段（浏览器，GL 前置）：真页面上逐项对账（名称/状态/API 落点/几何可见）+ 默认展开 + 点击两态可逆 +
//     **即时生效**（改一项后 `__wp` 侧读数真的变：`displayState()` / `#sc` 内联样式 / `__mpwHostCalls`）+
//     隐藏行不计入计数 + 空闲不自激。拿不到 WebGL2 ⇒ SKIP 并打印原样读数（不谎报成红，也不静默通过）。
//   变异自证（**只在内存/临时目录里**，真树一字不动）：①缺省展开改回收起 ②某项驱动改成空实现
//     ③把隐藏行（面板里别的行）重新算进计数 —— 三个变异各自必须让本文件变红，且红的正是被变异掉的那条。
//
// 用法:
//   node tests/bench-props-we-group-test.mjs                     # A + B + 变异（B 需要 :8902 在跑）
//   node tests/bench-props-we-group-test.mjs --no-mutant          # 变异子进程用
//   node tests/bench-props-we-group-test.mjs --no-browser
//   node tests/bench-props-we-group-test.mjs --no-static          # 只跑 B 段（+变异）
//   MPW_WE_GROUP_BASE=http://127.0.0.1:8931                       # 换被测服务（变异阶段指向镜像静态面）
//   MPW_WE_GROUP_PATCH=/tmp/…/bench-patch.js                      # 换 A 段读的被测补丁（变异阶段指向副本）
// 退出码：0 全绿（含 SKIP）/ 1 有失败或变异没变红 / 2 用法错误
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { ROOT } from './_root.mjs'

const argv = process.argv.slice(2)
const KNOWN = ['--no-mutant', '--no-browser', '--no-static', '--json']
let NO_MUTANT = false, NO_BROWSER = false, NO_STATIC = false, JSON_OUT = false
for (const a of argv) {
  if (a === '--no-mutant') { NO_MUTANT = true; continue }
  if (a === '--no-browser') { NO_BROWSER = true; continue }
  if (a === '--no-static') { NO_STATIC = true; continue }
  if (a === '--json') { JSON_OUT = true; continue }
  if (!KNOWN.includes(a)) { console.error('✗ 未知参数 ' + a); process.exit(2) }
}
const BASE = process.env.MPW_WE_GROUP_BASE || 'http://127.0.0.1:8902'
const DEMO_DIR = path.join(ROOT, 'demo')
const PATCH_PATH = process.env.MPW_WE_GROUP_PATCH || path.join(DEMO_DIR, 'bench-patch.js')
const SERVER = path.join(ROOT, 'server', 'we-scene-demo-server-8902.mjs')

/* ── 断言小工具（与 tests/ 既有风格一致：GOOD/FAIL 两行都打，人读与机读同一份）─────────────────
   名字带**稳定的前缀编号**（A1/B2/…）：变异自证按前缀认"红的正是被变异掉的那条"。 */
let pass = 0
const failed = []
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + String(detail).slice(0, 300) + ']' : '')) }
  else { failed.push({ name, detail: String(detail == null ? '' : detail).slice(0, 400) }); console.log('FAIL ' + name + (detail ? '  [' + String(detail).slice(0, 400) + ']' : '')) }
}
const section = (t) => console.log('\n── ' + t + ' ' + '─'.repeat(Math.max(0, 76 - t.length)))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/*  ⚠(2026-09-25 真机踩到) 慢加载时 `demo/index.html` 的**"过期补丁自检"会自己重载一次**
    （load + 1.5s 时若 `#bench-site-style`/`__benchShell` 还没就绪就 `location.reload()`；sessionStorage
    守卫保证只重载一次）。重载窗口里的 `page.evaluate` 会抛 "Execution context was destroyed"
    ⇒ 这不是产品坏（那正是它该做的自愈），但门禁必须扛住：evaluate 重试 + 先等"页面不再重载"。 */
async function safeEval(page, fn, arg) {
  let last = null
  for (let i = 0; i < 4; i++) {
    try { return await page.evaluate(fn, arg) } catch (e) {
      last = e
      await sleep(600 + i * 500)
      try { await page.waitForFunction(() => !!(window.__benchPatch && window.__benchShell), null, { timeout: 8000 }) } catch { /* 继续重试 */ }
    }
  }
  throw last
}
/** 等"页面不再自己重载"：文档身份（`performance.timeOrigin`）连续 2s 不变。 */
async function waitPageStable(page, ms = 15000) {
  const t0 = Date.now()
  let prev = null, stable = 0
  while (Date.now() - t0 < ms) {
    let id = null
    try { id = await page.evaluate(() => performance.timeOrigin) } catch { id = null }
    if (id !== null && id === prev) { stable++; if (stable >= 4) return true } else stable = 0
    prev = id
    await sleep(500)
  }
  return false
}

/* ══════════════════════════ 清单 = 判据（**独立于实现**手写）══════════════════════════════════════
   ⚠ 这里是"实现自己证明自己"的反面：本表按 `demo/index.html` 的 `#page-wpset` §1「WE 自带选项 ↔ 本页 API」
   逐行手抄（+ 用户口径点名的垂直翻转 / 按显示器）。实现改了清单而没改这里 ⇒ A1/A2 立刻红。
   `group` 只是本文件的分组标签，用来判"用户要的那 5 组一个都没漏"。 */
const CHECKLIST = [
  { id: 'flipH', status: 'impl', kind: 'bool', api: '__wp.setDisplay({flipH})', group: 'flip' },
  { id: 'colorOptions', status: 'impl', kind: 'bool', api: '__wp.setDisplay({colorOptions})', group: 'colorOptions' },
  { id: 'brightness', status: 'impl', kind: 'range', api: '__wp.setDisplay({brightness})', group: 'color4' },
  { id: 'contrast', status: 'impl', kind: 'range', api: '__wp.setDisplay({contrast})', group: 'color4' },
  { id: 'saturation', status: 'impl', kind: 'range', api: '__wp.setDisplay({saturation})', group: 'color4' },
  { id: 'hue', status: 'impl', kind: 'range', api: '__wp.setDisplay({hue})', group: 'color4' },
  { id: 'playbackRate', status: 'impl', kind: 'range', api: '__wp.setPlaybackRate(r)', group: 'playbackRate' },
  { id: 'volume', status: 'impl', kind: 'range', api: '__wp.setVolume(v)', group: 'volume' },
  { id: 'flipV', status: 'no', kind: 'note', api: '', group: 'we-builtin-note' },
  { id: 'alignment', status: 'other', kind: 'note', api: '', group: 'we-builtin-note' },
  { id: 'parallaxReaction', status: 'no', kind: 'note', api: '', group: 'we-builtin-note' },
  { id: 'recording', status: 'we', kind: 'note', api: '', group: 'we-builtin-note' },
  { id: 'perMonitor', status: 'we', kind: 'note', api: '', group: 'we-builtin-note' },
]
/** 用户点名"本仓已实现、不许漏"的 5 组（少一组即判失败）。 */
const REQUIRED_GROUPS = ['flip', 'colorOptions', 'color4', 'playbackRate', 'volume']
/** 即时生效的驱动读数（B5）：每项给一个"驱动值 + 渲染器侧应有的读数"。
 *  ⚠ 顺序有讲究：`colorOptions`（总开关）**必须最后** —— 它一关，四项就**不进 filter 串**（渲染器契约），
 *  先关它再验四项的 CSS filter 会假红。最后关它反而能当一条**总开关判据**（`gate: true`）。 */
const DRIVE = [
  { id: 'flipH', value: true, read: { key: 'flipH', want: true }, css: 'scaleX(-1)' },
  { id: 'brightness', value: 1.5, read: { key: 'brightness', want: 1.5 }, css: 'brightness(1.5)' },
  { id: 'contrast', value: 1.4, read: { key: 'contrast', want: 1.4 }, css: 'contrast(1.4)' },
  { id: 'saturation', value: 1.6, read: { key: 'saturation', want: 1.6 }, css: 'saturate(1.6)' },
  { id: 'hue', value: 30, read: { key: 'hue', want: 30 }, css: 'hue-rotate(30deg)' },
  { id: 'playbackRate', value: 1.5, read: { key: 'playbackRate', want: 1.5 } },
  { id: 'volume', value: 0.25, read: null },        // 音量没有 getter：读 `__mpwHostCalls.setVolume` 计数器 + 面板音频读数
  { id: 'colorOptions', value: false, read: { key: 'colorOptions', want: false }, gate: true },
]
const NEUTRAL = { flipH: false, colorOptions: true, brightness: 1, contrast: 1, saturation: 1, hue: 0, playbackRate: 1 }

// ── A 段（纯 Node）────────────────────────────────────────────────────────────────────────────────
async function staticStage() {
  section('A 段（纯 Node）：清单 / DICT / 源码级钉子')
  let P = null
  try { P = await import(pathToFileURL(PATCH_PATH).href) } catch (e) {
    ok('A0 被测补丁可导入（' + path.relative(ROOT, PATCH_PATH) + '）', false, String((e && e.message) || e)); return
  }
  const items = Array.isArray(P.WE_RENDERER_ITEMS) ? P.WE_RENDERER_ITEMS : []
  ok('A0 被测补丁可导入且导出 `WE_RENDERER_ITEMS`', items.length > 0, path.relative(ROOT, PATCH_PATH) + ' · ' + items.length + ' 项')

  /* A1 项数与清单逐项相等（**顺序在内**：清单顺序 = 文档顺序 = 面板顺序）。 */
  const gotIds = items.map((it) => String(it.id))
  const wantIds = CHECKLIST.map((c) => c.id)
  ok('A1 清单项与判据清单**逐项相等**（顺序在内，不静默少项/多项）',
    gotIds.length === wantIds.length && gotIds.every((x, i) => x === wantIds[i]),
    JSON.stringify({ got: gotIds, want: wantIds }))

  /* A2 本仓已实现的 5 组一个不漏 + 每项驱动落点逐字相等。 */
  const groups = new Set(CHECKLIST.map((c) => c.group))
  const missingGroups = REQUIRED_GROUPS.filter((g) => !groups.has(g))
  const implWant = CHECKLIST.filter((c) => c.status === 'impl')
  const implGot = P.weRendererImplItems(items)
  const routes = implGot.map((it) => P.weRendererApiRoute(it))
  ok('A2 ★用户点名的 5 组（水平翻转 / 颜色选项总开关 / 亮度·对比度·饱和度·色调偏移 / 播放速度 / 音量）一个不漏',
    missingGroups.length === 0 && implGot.length === implWant.length,
    JSON.stringify({ missingGroups, implGot: implGot.map((i) => i.id) }))
  ok('A2a 每个 impl 项的驱动落点与判据清单逐字相等（`__wp.setDisplay({键})` / `setPlaybackRate` / `setVolume`）',
    routes.every((r, i) => r === implWant[i].api) && implGot.every((it, i) => it.id === implWant[i].id),
    JSON.stringify(routes))
  ok('A2b 非 impl 项**照实写一行**（`no`=未实现 / `we`=WE 自带 / `other`=本页实现在别处），没有一项是静默省掉的',
    items.length === CHECKLIST.length && items.every((it, i) => it.status === CHECKLIST[i].status && it.kind === CHECKLIST[i].kind),
    JSON.stringify(items.map((it) => it.id + ':' + it.status + '/' + it.kind)))

  /* A3 每项的中英标签 + 非 impl 项的中英原因都在 DICT（不靠硬编码中文）。 */
  const missKey = []
  for (const it of CHECKLIST) {
    for (const lang of ['zh', 'en']) {
      if (!P.DICT[lang] || !P.DICT[lang]['props.we.' + it.id]) missKey.push(lang + ':' + it.id)
      if (it.status !== 'impl' && (!P.DICT[lang] || !P.DICT[lang]['props.we.why.' + it.id])) missKey.push(lang + ':why.' + it.id)
    }
  }
  ok('A3 清单每项的中英标签 + 非 impl 项的中英原因都在 DICT 里', missKey.length === 0, JSON.stringify(missKey.slice(0, 6)))
  const zk = Object.keys(P.DICT.zh || {}), ek = Object.keys(P.DICT.en || {})
  ok('A3a DICT 中英键集合相等（新键两份都加了）',
    zk.length === ek.length && zk.every((k) => ek.includes(k)), zk.length + '/' + ek.length)

  /* A4 不再从"壁纸属性行"里分类（改前那条采集表达式必须彻底消失）。 */
  const src = fs.readFileSync(PATCH_PATH, 'utf8')
  const oldHarvest = /const we = rows\.filter\(isWeBuiltinPropRow\)/
  const oldCount = /body\.querySelectorAll\('\.prop, \.prop-text'\)\.length/
  ok('A4 ★这一组不再从属性行"分类"（旧采集 `propsRows().filter(isWeBuiltinPropRow)` 已删）+ 计数不再用未过滤的行数',
    !oldHarvest.test(src) && !oldCount.test(src), JSON.stringify({ harvest: oldHarvest.test(src), oldCount: oldCount.test(src) }))

  /* A5 计数只算可见项：`weVisibleItems` 是唯一的行集合，且带 `!el.hidden` 过滤。 */
  ok('A5 ★计数只算可见项（`weVisibleItems()` 里过滤 `!el.hidden`，探针与表头共用它）',
    /function weVisibleItems\(group\)/.test(src) &&
    /return \[\.\.\.group\.querySelectorAll\('\[data-we-item\]'\)\]\.filter\(\(el\) => !el\.hidden\)/.test(src) &&
    /const n = weVisibleItems\(group\)\.length/.test(src) &&
    /weCount: items\.length/.test(src),
    'weVisibleItems + 表头/探针共用')

  /* A6 缺省展开：只有存了 `'1'` 才收起（`localStorage` 不可用 ⇒ 展开）。 */
  ok('A6 ★缺省展开（`weGroupCollapsed()` 只在存了 `1` 时返回 true）+ 折叠状态仍记 localStorage',
    /String\(localStorage\.getItem\(WE_GROUP_COLLAPSED_LS\) \|\| ''\) === '1'/.test(src) &&
    /localStorage\.setItem\(WE_GROUP_COLLAPSED_LS/.test(src) &&
    /head\.addEventListener\('click', toggle\)/.test(src) && /'aria-expanded'/.test(src),
    'default=expanded + 持久化 + aria')

  /* A7 唯一驱动点：`weApplyItem` 真调渲染器 API；控件事件回到 `weItemChanged`。 */
  ok('A7 ★驱动是**真调**渲染器 API（`wp.setDisplay({[it.arg]: val})` / `wp.setPlaybackRate(val)` / 音量走唯一真源）',
    /function weApplyItem\(item, raw\)/.test(src) && /wp\.setDisplay\(\{ \[it\.arg\]: val \}\)/.test(src) &&
    /wp\.setPlaybackRate\(val\)/.test(src) && /setVideoVolume\(v\)/.test(src) &&
    /addEventListener\('change', \(\) => \{ weItemChanged\(item, !!input\.checked\) \}\)/.test(src) &&
    /addEventListener\('input', \(\) => \{ weItemChanged\(item, Number\(input\.value\)\) \}\)/.test(src),
    'weApplyItem 唯一驱动点')

  /* A8 组内控件只有 checkbox / range（用户第 17 条：面板里不许有未增强的原生 `<select>`）。 */
  const groupBlock = src.slice(src.indexOf('function weGroupRow('), src.indexOf('function weItemChanged('))
  ok('A8 组内控件只有 `checkbox` / `range`（不新增原生 `<select>` —— 面板里那个数必须是 0）',
    groupBlock.length > 200 && !/createElement\('select'\)/.test(groupBlock) &&
    /input\.type = 'checkbox'/.test(groupBlock) && /input\.type = 'range'/.test(groupBlock),
    'groupBlock ' + groupBlock.length + 'B')

  /* A9 组壳仍然**排在最前**（用户原话"它上面永远有这几个选项"）+ 探针字段齐。 */
  ok('A9 组壳仍插在 `#props-body` 最前 + 探针 `propsGroups()` 给出只算可见项的项清单/几何读数',
    /propsBody\.insertBefore\(group, propsBody\.firstChild\)/.test(src) &&
    /weDrawn: group \? items\.filter\(h\)\.length : 0/.test(src) &&
    /weHiddenAdopted: body \?/.test(src),
    'first + weDrawn/weHiddenAdopted')
}

// ── B 段（浏览器，GL 前置）────────────────────────────────────────────────────────────────────────
async function browserStage() {
  section('B 段（浏览器 · 真页面 + 真渲染器）：' + BASE)
  if (NO_BROWSER) { console.log('SKIP B 段（--no-browser）'); return }
  const { launchGLBrowser, glCapability, closeQuiet, logGLSkip, findPlaywright } = await import('./_gl-browser.mjs')
  let up = false
  try { const r = await fetch(BASE + '/__health', { signal: AbortSignal.timeout(4000) }); up = r.ok } catch { up = false }
  if (!up) { console.log(`SKIP B 段（浏览器）—— 测试台不可达：${BASE}（起服务：node server/we-scene-demo-server-8902.mjs 8902）`); return }
  let marker = null
  try { const r = await fetch(BASE + '/bundle.js', { method: 'HEAD', signal: AbortSignal.timeout(6000) }); marker = r.headers.get('x-bench-served') } catch { marker = null }
  if (marker !== 'local') { console.log(`SKIP B 段（浏览器）—— ${BASE} 不是"渲染器面本地直供"的新服务（X-Bench-Served=${marker}）；重启 :8902 后再跑`); return }
  const pwPath = findPlaywright()
  if (!pwPath) { console.log('SKIP B 段（浏览器）—— 找不到 playwright'); return }
  const pw = await import(pathToFileURL(pwPath).href)
  const firefox = (pw.default && pw.default.firefox) || pw.firefox
  if (!firefox) { console.log('SKIP B 段（浏览器）—— playwright 没有 firefox 导出'); return }
  const { browser, launchNote } = await launchGLBrowser(firefox)
  try {
    const gl = await glCapability(browser)
    console.log('B 段浏览器：' + launchNote + ' · GL=' + JSON.stringify(gl))
    if (!gl.webgl2) { logGLSkip('B 段（渲染器设置组）', launchNote, gl); return }
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
    const page = await ctx.newPage()
    const pageErrs = []
    page.on('pageerror', (e) => pageErrs.push(String((e && e.message) || e).slice(0, 200)))
    await page.goto(BASE + '/?benchlib=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 45000 })
    try { await page.waitForFunction(() => !!(window.__benchPatch && window.__benchShell), null, { timeout: 30000 }) } catch { /* 下面按读数判 */ }
    /*  ①(2026-09-25 真机踩到) 先等页面**不再自己重载**：慢加载时 `demo/index.html` 的"过期补丁自检"
        会 `location.reload()` 一次（sessionStorage 守卫只一次），重载窗口里的 evaluate 会抛
        "Execution context was destroyed" ⇒ 不先等它，B 段会在那一拍假红（`safeEval` 只是第二道保险）。 */
    const stablePage = await waitPageStable(page)
    console.log('  B1 前置：页面稳定（无自动重载）=' + stablePage)

    /* 选一张壁纸：优先"属性里有 `schemecolor`（内部隐藏行）"的那张（数据驱动）⇒ 顺带能判"隐藏行不计入计数"。 */
    const target = await pickInternalTarget(BASE)
    const selected = await selectWallpaper(page, target.id)
    let settled = await settlePanel(page)
    /*  ②渲染器就绪（`__wp` 发布）是**异步**的（iframe 导航 + demo.html 解析）⇒ 有界等它：
        否则 B1 会在"面板已画好、渲染器还没就绪"那一拍上假红。 */
    const readyT0 = Date.now()
    while (Date.now() - readyT0 < 20000) {
      if (settled && settled.ready && (settled.avail || []).slice(0, 8).every((x) => x === true)) break
      await sleep(500)
      settled = await safeEval(page, pageProbe.snapshot)
    }
    console.log('  B1 读数 target=' + JSON.stringify(target) + ' selected=' + JSON.stringify(selected) + ' settled=' + JSON.stringify(settled))
    ok('B1 前置：页面稳定 + 面板画出了这一组 + 渲染器已发布 `__wp`（8 个 impl 项都标可用）',
      stablePage === true && !!settled && settled.count > 0 && settled.drawn > 0 && settled.ready === true &&
      (settled.avail || []).slice(0, 8).every((x) => x === true),
      JSON.stringify({ stablePage, ready: settled && settled.ready, count: settled && settled.count, drawn: settled && settled.drawn, avail: settled && settled.avail }))

    /* B2 项数与清单**逐项相等**：名称 / 状态 / API 落点 / 几何（每一项都真的画出来了）。 */
    const items = await readItems(page)
    const gotIds = items.map((x) => x.id)
    const wantIds = CHECKLIST.map((c) => c.id)
    const sameOrder = gotIds.length === wantIds.length && gotIds.every((x, i) => x === wantIds[i])
    const apiOk = items.every((x, i) => CHECKLIST[i] && x.api === CHECKLIST[i].api)
    const statusOk = items.every((x, i) => CHECKLIST[i] && x.status === CHECKLIST[i].status)
    const labelOk = items.every((x) => String(x.label || '').length > 0)
    ok('B2 ★组里的项与判据清单**逐项相等**：名称（顺序在内）+ 状态 + API 落点 + 每项都有标签',
      sameOrder && apiOk && statusOk && labelOk && items.every((x) => x.h > 0),
      JSON.stringify({ got: gotIds, api: items.map((x) => x.api), bad: items.filter((x, i) => !CHECKLIST[i] || x.api !== CHECKLIST[i].api).map((x) => x.id) }))
    ok('B2a 表头计数 = 清单项数（**只算可见项**；改前那条"未过滤行数"的表头报 1 项）',
      String(settled.header || '').includes(String(CHECKLIST.length)) && settled.count === CHECKLIST.length,
      JSON.stringify({ header: settled.header, count: settled.count }))
    ok('B2b 组壳仍然**排在 `#props-body` 最前**（用户原话"它上面永远有这几个选项"）',
      settled.firstChildIsWeGroup === true, JSON.stringify({ first: settled.firstChildIsWeGroup }))
    /* B2c 状态行（渲染器未就绪 / `?display=legacy` 总回退才显示）：本档渲染器就绪 ⇒ 必须**藏起来且清空**
       （不许对正常状态误报），且它不是 `[data-we-item]` ⇒ 不进项数（上面 B2/B2a 已覆盖）。 */
    const notice = await safeEval(page, () => {
      const el = document.querySelector('.bench-props-group[data-group="we"] .bench-we-status')
      if (!el) return null
      return { hidden: !!el.hidden, text: String(el.textContent || ''), h: Math.round(el.getBoundingClientRect().height), counted: !!el.dataset.weItem }
    })
    ok('B2c 渲染器就绪时"未就绪 / 总回退"那一行**不显示也不占位**（对正常状态不误报），且它不算这一组的项',
      !!notice && notice.hidden === true && notice.h === 0 && notice.text === '' && notice.counted === false,
      JSON.stringify(notice))

    /* B3 默认展开：`dataset.collapsed='0'` / `aria-expanded=true` / 组体不是 display:none / 行几何可见。 */
    const exp0 = await readExpand(page)
    ok('B3 ★默认展开：`data-collapsed="0"` + `aria-expanded="true"` + 组体可见 + 13 行**几何上都看得见**（weDrawn === weCount）',
      exp0.collapsed === false && exp0.aria === 'true' && exp0.display !== 'none' && exp0.count === CHECKLIST.length && exp0.drawn === CHECKLIST.length,
      JSON.stringify(exp0))

    /* B4 点表头：收起（display:none / aria=false）→ 再展开（两态可逆，行数不变）。 */
    const b4 = await toggleTwice(page)
    ok('B4 ★点表头 ⇒ 收起（`data-collapsed="1"` + `aria-expanded="false"` + 组体 `display:none` + 行几何 0），再点一次 ⇒ 展开回来（项数始终不变）',
      b4.a.collapsed === true && b4.a.aria === 'false' && b4.a.display === 'none' && b4.a.drawn === 0 &&
      b4.b.collapsed === false && b4.b.aria === 'true' && b4.b.display !== 'none' && b4.b.drawn === CHECKLIST.length &&
      b4.a.count === CHECKLIST.length && b4.b.count === CHECKLIST.length,
      JSON.stringify(b4))

    /* B5 **即时生效**：逐项改一次，`__wp` 侧的读数必须真的变（不是"控件动了、渲染器没动"）。 */
    const drove = []
    for (const d of DRIVE) {
      const r = await driveItem(page, d.id, d.value)
      drove.push({ id: d.id, ...r })
      if (d.read) {
        const got = r.st && r.st[d.read.key]
        ok('B5-' + d.id + ' 改这一项后**渲染器侧读数**真的变（`__wp.displayState().' + d.read.key + '` = ' + d.read.want + '）' +
          (d.css ? ' + `#sc` 内联样式含 `' + d.css + '`' : ''),
          !!r.st && got === d.read.want && (!d.css || String(r.scFilter + ' ' + r.scTransform).includes(d.css)),
          JSON.stringify({ got: got === undefined ? null : got, want: d.read.want, filter: r.scFilter, transform: r.scTransform, avail: r.avail }))
      } else {
        ok('B5-volume 改这一项后**渲染器侧**真的收到 `setVolume`（`__mpwHostCalls.setVolume` 增加 + `__wp.setVolume` 存在）',
          r.callsAfter > r.callsBefore && r.audioVol === d.value && !!r.capsSetVolume,
          JSON.stringify({ before: r.callsBefore, after: r.callsAfter, audioVol: r.audioVol, caps: r.capsSetVolume }))
      }
      if (d.gate) {
        /* 总开关判据：此时四项仍是刚才那些**非中性**值（1.5/1.4/1.6/30），但 filter 串里一项都不该有。 */
        const f = String(r.scFilter || '')
        ok('B5-colorOptions-gate 总开关关掉后四项**完全不进 filter 串**（值仍被记住，只是不参与）',
          !/brightness\(|contrast\(|saturate\(|hue-rotate\(/.test(f),
          JSON.stringify({ filter: f, stillStored: r.st && { b: r.st.brightness, c: r.st.contrast, s: r.st.saturation, h: r.st.hue } }))
      }
    }
    console.log('  B5 驱动读数：' + JSON.stringify(drove.map((x) => ({ id: x.id, ok: x.ok, st: x.st ? { flipH: x.st.flipH, colorOptions: x.st.colorOptions, b: x.st.brightness, c: x.st.contrast, s: x.st.saturation, h: x.st.hue, rate: x.st.playbackRate } : null }))))

    /* B6 隐藏的内部行**绝不**计入：有就如实记一条读数，计数必须仍然是清单长度。 */
    const hidden = await readHidden(page)
    ok('B6 ★被隐藏的内部行（`schemecolor` 这类）**不计入**这一组的项数与名称（有的话如实记在 `weHiddenAdopted`）',
      hidden.count === CHECKLIST.length && hidden.adopted >= 0 &&
      hidden.names.length === CHECKLIST.length && !hidden.names.some((n) => /^schemecolor$|^ui_/i.test(String(n))) &&
      (hidden.adopted === 0 || hidden.adoptedHiddenInside === hidden.adopted),
      JSON.stringify(hidden))
    console.log('  B6 读数：' + JSON.stringify(hidden))

    /* B7 本仓渲染器档下 8 项都可用（`data-we-avail=1` / 控件未禁用）—— 不可用要**如实**标出来，不许假装可用。 */
    const avail = await readAvail(page)
    ok('B7 本仓渲染器档下 8 个 impl 项都标 `data-we-avail="1"` 且控件未禁用（不可用时必须如实标 0，不许假装可用）',
      avail.impl.every((x) => x.avail === '1' && x.disabled === false) && avail.notes.every((x) => x.avail === '0'),
      JSON.stringify(avail))

    /* B8 空闲不自激：这一组自身在 3s 内**几乎零** DOM 变更（有自激环时是 100+ 条 / 2.5s）。 */
    const idle = await readIdle(page)
    ok('B8 空闲不自激：3s 内这一组自身变更数 ≤ 10 且指纹未变（防止"写 DOM → 观察者 → 再写"的环）',
      idle.mutations <= 10 && idle.sigSame === true && idle.sameNode === true,
      JSON.stringify(idle))

    /* B9 复位（用**控件自己**写回中性）⇒ 渲染器侧回到中性：证明双向都通，也不把状态留给下一个门禁。 */
    for (const [k, v] of Object.entries(NEUTRAL)) await driveItem(page, k, v)
    const back = await readNeutral(page)
    ok('B9 用同一组控件写回中性 ⇒ 渲染器侧 `displayState()` 回到中性默认（`#sc` 不再有 filter / transform）',
      back.neutral === true && back.filter === '' && back.transform === '',
      JSON.stringify(back))
    ok('B9a 整轮顶层页 0 个脚本错', pageErrs.length === 0, JSON.stringify(pageErrs.slice(0, 4)))

    /* B10（用户澄清「we 的自带选项是针对**所有**壁纸都有的」）：换**另一张**壁纸后这一组还在，
       项与清单**逐项不变**（与那张壁纸的 `project.json` 无关）。 */
    const other = (await safeEval(page, () => [...document.querySelectorAll('#list li[data-id]')].map((l) => String(l.dataset.id || ''))))
      .find((id) => id && id !== target.id)
    if (other) {
      await selectWallpaper(page, other)
      const s2 = await settlePanel(page, 14000)
      ok('B10 ★换一张壁纸后这一组**仍然在、项与清单逐项不变**（用户口径"针对每一张壁纸都有"，不依赖 `project.json`）',
        !!s2 && s2.item === other && s2.count === CHECKLIST.length &&
        JSON.stringify(s2.names) === JSON.stringify(CHECKLIST.map((c) => c.id)) && s2.drawn === CHECKLIST.length,
        JSON.stringify({ from: target.id, to: other, count: s2 && s2.count, names: s2 && s2.names, drawn: s2 && s2.drawn }))
    } else {
      console.log('  B10 SKIP：库里只有一张壁纸，换包判据无从对照（读数 ' + JSON.stringify({ library: target.library }) + '）')
    }
  } finally {
    await closeQuiet(browser)
  }
}

// ── B 段用到的页面读写（全部走真 DOM / 真 `__wp`）────────────────────────────────────────────────
const pageProbe = {
  /** 面板 + 组的稳定读数（判"面板画完了"用）。 */
  snapshot: () => {
    const p = window.__benchPatch.propsPanel()
    const g = window.__benchPatch.propsGroups()
    const gp = document.querySelector('.bench-props-group[data-group="we"]')
    const head = gp && gp.querySelector('.bench-props-group-head')
    const body = gp && gp.querySelector('.bench-props-group-body')
    return {
      item: p.item, rows: p.rows, hidden: p.hiddenNames, state: p.state,
      count: g.weCount, drawn: g.weDrawn, adopted: g.weHiddenAdopted, ready: g.weReady, legacy: g.weLegacy,
      header: g.weHeaderCount, firstChildIsWeGroup: g.firstChildIsWeGroup,
      collapsed: g.collapsed, aria: head ? head.getAttribute('aria-expanded') : null,
      display: body ? getComputedStyle(body).display : null,
      avail: g.weAvail, names: g.weNames,
      sig: gp ? gp.dataset.weSig : null,
    }
  },
}

async function pickInternalTarget(base) {
  try {
    const lib = await (await fetch(base + '/api/library', { signal: AbortSignal.timeout(8000) })).json()
    const items = (lib && lib.items) || []
    for (const it of items.slice(0, 6)) {
      try {
        const p = await (await fetch(base + '/api/props?item=' + encodeURIComponent(it.itemId), { signal: AbortSignal.timeout(8000) })).json()
        if (((p && p.props) || []).some((x) => String(x.name || '').toLowerCase() === 'schemecolor')) {
          return { id: it.itemId, library: items.length, hasInternal: true }
        }
      } catch { /* 下一张 */ }
    }
    return { id: items[0] ? items[0].itemId : null, library: items.length, hasInternal: false }
  } catch (e) { return { id: null, library: 0, hasInternal: false, err: String((e && e.message) || e).slice(0, 90) } }
}
async function selectWallpaper(page, id) {
  const clicked = await safeEval(page, (want) => {
    const lis = [...document.querySelectorAll('#list li[data-id]')]
    const target = (want && lis.find((l) => String(l.dataset.id) === want)) || lis[0]
    if (!target) return null
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return String(target.dataset.id || '')
  }, id)
  return clicked
}
/** 等面板稳定：连续两次读数相同（产物分几批画行，改前实测 3.2s 时还差一行）。 */
async function settlePanel(page, ms = 18000) {
  const t0 = Date.now()
  let prev = '', stable = 0, last = null
  while (Date.now() - t0 < ms) {
    await page.waitForTimeout(400)
    last = await safeEval(page, pageProbe.snapshot)
    const s = JSON.stringify(last)
    if (s === prev && last.rows > 0) { stable++; if (stable >= 2) break } else stable = 0
    prev = s
  }
  return last
}
const readItems = (page) => safeEval(page, () => {
  const body = document.querySelector('.bench-props-group[data-group="we"] .bench-props-group-body')
  if (!body) return []
  return [...body.querySelectorAll('[data-we-item]')].map((el) => ({
    id: String(el.dataset.weItem || ''), status: String(el.dataset.weStatus || ''), api: String(el.dataset.weApi || ''),
    label: String((el.querySelector('.bench-we-label') || {}).textContent || ''),
    h: Math.round(el.getBoundingClientRect().height),
  }))
})
const readExpand = (page) => safeEval(page, () => {
  const s = (() => { const p = window.__benchPatch.propsPanel(); const g = window.__benchPatch.propsGroups()
    const gp = document.querySelector('.bench-props-group[data-group="we"]')
    const head = gp && gp.querySelector('.bench-props-group-head'); const body = gp && gp.querySelector('.bench-props-group-body')
    return { count: g.weCount, drawn: g.weDrawn, collapsed: g.collapsed, aria: head && head.getAttribute('aria-expanded'),
      display: body ? getComputedStyle(body).display : null, rows: p.rows } })()
  return s
})
/** 点表头两次：第一次用**真鼠标**（`page.click`，证明命中测试通），第二次用元素 click（两态可逆）。 */
async function toggleTwice(page) {
  const headSel = '.bench-props-group[data-group="we"] .bench-props-group-head'
  await page.locator(headSel).scrollIntoViewIfNeeded().catch(() => {})
  try { await page.click(headSel, { timeout: 8000 }) } catch { await safeEval(page, (sel) => { const h = document.querySelector(sel); if (h) h.click() }, headSel) }
  await page.waitForTimeout(250)
  const a = await readExpand(page)
  await safeEval(page, (sel) => { const h = document.querySelector(sel); if (h) h.click() }, headSel)
  await page.waitForTimeout(250)
  const b = await readExpand(page)
  return { a, b }
}
/** 改一项：勾选框派发 `change`、滑条派发 `input`（与用户操作同一条事件链）；随后读**渲染器侧**真值。 */
async function driveItem(page, id, value) {
  const r = await safeEval(page, async ({ id, value }) => {
    const el = document.getElementById('bench-we-' + id)
    if (!el) return { ok: false, why: 'no-control' }
    if (el.type === 'checkbox') { el.checked = !!value; el.dispatchEvent(new Event('change', { bubbles: true })) }
    else { el.value = String(value); el.dispatchEvent(new Event('input', { bubbles: true })) }
    await new Promise((r2) => setTimeout(r2, 260))
    const fr = document.querySelector('#frame')
    const w = fr && fr.contentWindow
    let d = null
    try { d = fr.contentDocument } catch { /* 跨源 */ }
    const sc = d && d.getElementById('sc')
    const wp = w && w.__wp
    const out = { ok: true, avail: el.disabled ? '0' : '1', callsBefore: null, callsAfter: null, audioVol: null, capsSetVolume: null }
    try { out.st = wp && wp.displayState ? wp.displayState() : null } catch { out.st = null }
    out.scFilter = sc ? String(sc.style.filter || '') : null
    out.scTransform = sc ? String(sc.style.transform || '') : null
    return out
  }, { id, value })
  if (id === 'volume') {
    // 音量没有 getter ⇒ 单独读"渲染器侧的调用台账"（计数器在**驱动前**读一次、驱动后再读一次）
    const calls = await safeEval(page, async () => {
      const fr = document.querySelector('#frame'); const w = fr && fr.contentWindow
      const before = ((w && w.__mpwHostCalls) || {}).setVolume || 0
      const el = document.getElementById('bench-we-volume')
      el.value = '0.25'; el.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r2) => setTimeout(r2, 320))
      const after = ((w && w.__mpwHostCalls) || {}).setVolume || 0
      const a = window.__benchPatch.npAudio ? window.__benchPatch.npAudio() : null
      return { before, after, audioVol: a ? a.vol : null, caps: !!((w && w.__mpwHostCaps) || {}).setVolume }
    })
    r.callsBefore = calls.before; r.callsAfter = calls.after; r.audioVol = calls.audioVol; r.capsSetVolume = calls.caps
  }
  return r
}
const readHidden = (page) => safeEval(page, () => {
  const g = window.__benchPatch.propsGroups()
  const body = document.querySelector('.bench-props-group[data-group="we"] .bench-props-group-body')
  const adoptedHiddenInside = body ? [...body.querySelectorAll('.prop, .prop-text')].filter((el) => el.hidden).length : 0
  const panelHidden = window.__benchPatch.propsPanel().hiddenNames || []
  return { count: g.weCount, names: g.weNames, adopted: g.weHiddenAdopted, adoptedHiddenInside, panelHidden }
})
const readAvail = (page) => safeEval(page, () => {
  const body = document.querySelector('.bench-props-group[data-group="we"] .bench-props-group-body')
  const rows = body ? [...body.querySelectorAll('[data-we-item]')] : []
  const impl = [], notes = []
  for (const el of rows) {
    const rec = { id: String(el.dataset.weItem || ''), avail: String(el.dataset.weAvail || ''), disabled: null }
    const input = el.querySelector('input')
    if (input) rec.disabled = !!input.disabled
    ;(rec.disabled === null ? notes : impl).push(rec)
  }
  return { impl, notes }
})
const readIdle = (page) => safeEval(page, () => new Promise((res) => {
  const gp = document.querySelector('.bench-props-group[data-group="we"]')
  if (!gp) return res({ mutations: -1, sigSame: false, sameNode: false })
  const sig0 = gp.dataset.weSig
  let n = 0
  const mo = new MutationObserver((rs) => { n += rs.length })
  mo.observe(gp, { childList: true, subtree: true, characterData: true, attributes: true })
  setTimeout(() => {
    mo.disconnect()
    const gp2 = document.querySelector('.bench-props-group[data-group="we"]')
    res({ mutations: n, sigSame: !!gp2 && gp2.dataset.weSig === sig0, sameNode: gp2 === gp })
  }, 3000)
}))
const readNeutral = (page) => safeEval(page, () => {
  const fr = document.querySelector('#frame'); const w = fr && fr.contentWindow
  let d = null
  try { d = fr.contentDocument } catch { /* 跨源 */ }
  const sc = d && d.getElementById('sc')
  const st = (w && w.__wp && w.__wp.displayState) ? w.__wp.displayState() : null
  const want = { flipH: false, colorOptions: true, brightness: 1, contrast: 1, saturation: 1, hue: 0, playbackRate: 1 }
  return { st: st && { flipH: st.flipH, colorOptions: st.colorOptions, brightness: st.brightness, contrast: st.contrast, saturation: st.saturation, hue: st.hue, playbackRate: st.playbackRate },
    neutral: !!st && Object.keys(want).every((k) => st[k] === want[k]),
    filter: sc ? String(sc.style.filter || '') : null, transform: sc ? String(sc.style.transform || '') : null }
})

/* ══════════════════════════ 变异自证（真树一字不动）═══════════════════════════════════════════════
   做法：把一个**镜像静态面**（`demo/` 里除 `bench-patch.js` 外全是软链，补丁是改过的真副本）交给
   **同一个真服务**（`MPW_BENCH_STATIC_DIR=<镜像>`），另起一个端口，然后让本文件自己当子进程跑
   （`--no-mutant` 防递归、`MPW_WE_GROUP_BASE`/`MPW_WE_GROUP_PATCH` 指向镜像）。
   ⇒ 不需要往真树写一个字节，"必红"也是真页面上的读数，不是源码正则的自证。 */
const MUTATIONS = [
  {
    name: '① 缺省展开改回收起（用户"展不开"的那一版行为）',
    expects: ['B3', 'A6'],
    apply(src) {
      const from = "try { return String(localStorage.getItem(WE_GROUP_COLLAPSED_LS) || '') === '1' } catch { return false }"
      const to = "try { return String(localStorage.getItem(WE_GROUP_COLLAPSED_LS) || '1') === '1' } catch { return true }"
      if (src.split(from).length !== 2) return { error: '锚点未命中唯一位置：weGroupCollapsed' }
      return { patch: src.replace(from, to) }
    },
  },
  {
    name: '② 播放速度这一项的驱动改成空实现（控件动了、渲染器没动）',
    expects: ['B5-playbackRate', 'B9'],
    apply(src) {
      const from = [
        "      if (it.api === 'setPlaybackRate') {",
        "        if (typeof wp.setPlaybackRate !== 'function') return { ok: false, reason: 'no-cap', api: 'setPlaybackRate' }",
        '        const val = Number(raw)',
        '        wp.setPlaybackRate(val)',
        "        return { ok: true, api: 'setPlaybackRate', sent: val }",
        '      }',
      ].join('\n')
      const to = [
        "      if (it.api === 'setPlaybackRate') {",
        "        return { ok: true, api: 'setPlaybackRate', sent: Number(raw) }   // 变异：不调渲染器",
        '      }',
      ].join('\n')
      if (src.split(from).length !== 2) return { error: '锚点未命中唯一位置：weApplyItem/setPlaybackRate' }
      return { patch: src.replace(from, to) }
    },
  },
  {
    name: '③ 把隐藏行（以及面板里别的行）重新算进计数（用户"只显示有一项"的那一版口径）',
    expects: ['B2'],
    apply(src) {
      const from = "    return [...group.querySelectorAll('[data-we-item]')].filter((el) => !el.hidden)"
      const to = "    return [...propsBody.querySelectorAll('[data-we-item], .prop, .prop-text')]   // 变异：未过滤 + 把面板里别的行也算进来"
      if (src.split(from).length !== 2) return { error: '锚点未命中唯一位置：weVisibleItems' }
      return { patch: src.replace(from, to) }
    },
  },
]

const freePort = () => new Promise((res, rej) => {
  const s = net.createServer()
  s.on('error', rej)
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) })
})
async function waitHealth(base, ms) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(base + '/__health', { signal: AbortSignal.timeout(2000) }); if (r.ok) return true } catch { /* 还没起 */ }
    await sleep(300)
  }
  return false
}
/** 镜像静态面：`demo/` 的每个条目软链到真树，`bench-patch.js` 换成改过的真副本（**不动真树**）。 */
/**  ⚠⚠(2026-09-25 真机踩到，**别删这两条**)
 *  ① 为什么不能**软链**镜像：:8902 的静态面每条路径都过 `safeJoin()` 的 **realpath 前缀校验**
 *     （"静态路径越出静态根" ⇒ 403）—— 实测软链镜像下 `/index.html`、`/mpw-select.js`、`/assets/*`
 *     全 403，页面连补丁都加载不了（`window.__benchPatch` undefined）。硬链接的真身就在镜像根里
 *     ⇒ 校验通过，且不复制字节。
 *  ② 为什么**绝不碰软链**（`isSymlink` 跳过）：本机（PRoot/termux 文件系统）对**软链**调 `fs.linkSync()`
 *     会把**源软链自己的目标串**追加写坏 —— 实测 `demo/samples -> ../samples` 被写成
 *     `../samples000100010001`（每次链接追加 4 字节；三个变异 = 三次）。这是环境缺陷，不是本仓的 bug，
 *     但镜像必须绕开它（`demo/samples` 只是个便利入口，页面加载用不到；样例包走服务的 `/pkg` 路由）。
 *  ③ `bench-patch.js` **必须先 unlink 再写**：硬链接与真树**同一个 inode**，直接 writeFile 会把真树改掉。 */
function isSymlink(p) { try { return fs.lstatSync(p).isSymbolicLink() } catch { return false } }
/** 镜像静态面：`demo/` 里每个条目**硬链接**（不是软链）到真树，`bench-patch.js` 换成改过的真副本。 */
function linkTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true })
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name), d = path.join(dst, name)
    let st = null
    try { st = fs.lstatSync(s) } catch { continue }
    if (st.isSymbolicLink()) {
      //  **不 linkSync**（见上面 ②）：软链一律复制真身；真身是目录则跳过
      let real = null
      try { real = fs.realpathSync(s) } catch { real = null }
      if (!real) continue
      let rst = null
      try { rst = fs.statSync(real) } catch { continue }
      if (rst.isDirectory()) continue
      try { fs.copyFileSync(real, d) } catch { /* 跳过 */ }
      continue
    }
    if (st.isDirectory()) { linkTree(s, d); continue }
    try { fs.linkSync(s, d) } catch { try { fs.copyFileSync(s, d) } catch { /* 跳过 */ } }
  }
}
function buildMirrorDemo(mtDir, idx, patchSrc) {
  const dir = path.join(mtDir, 'demo' + idx)
  fs.mkdirSync(dir, { recursive: true })
  for (const name of fs.readdirSync(DEMO_DIR)) {
    if (name === 'bench-patch.js') continue
    const s = path.join(DEMO_DIR, name), d = path.join(dir, name)
    if (isSymlink(s)) continue                     //  **软链一律跳过**（见上面 ②；`demo/samples` 就是它）
    let st = null
    try { st = fs.lstatSync(s) } catch { continue }
    if (st.isDirectory()) { linkTree(s, d); continue }
    try { fs.linkSync(s, d) } catch { try { fs.copyFileSync(s, d) } catch { /* 跳过 */ } }
  }
  const patchDst = path.join(dir, 'bench-patch.js')
  try { fs.rmSync(patchDst, { force: true }) } catch { /* 不存在 */ }     // 万一是硬链接：先断开，别写穿真树
  fs.writeFileSync(patchDst, patchSrc)
  return dir
}
const runChild = (args, env, ms) => new Promise((resolve) => {
  const child = spawn(process.execPath, [path.resolve(import.meta.dirname, 'bench-props-we-group-test.mjs'), ...args], {
    cwd: ROOT, env: Object.assign({}, process.env, env), stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  })
  let out = ''
  child.stdout.on('data', (c) => { out += c.toString() })
  child.stderr.on('data', (c) => { out += c.toString() })
  const killGroup = (sig) => { try { process.kill(-child.pid, sig) } catch { try { child.kill(sig) } catch { /* 已退 */ } } }
  const t = setTimeout(() => killGroup('SIGKILL'), ms || 300000)
  child.on('close', (code) => { clearTimeout(t); resolve({ code, out, __kill: () => killGroup('SIGKILL') }) })
})
const parseChildJson = (out) => {
  const line = out.split('\n').filter((l) => l.startsWith('BENCH-WE-GROUP-JSON ')).pop()
  if (!line) return null
  try { return JSON.parse(line.slice('BENCH-WE-GROUP-JSON '.length)) } catch { return null }
}

async function mutateRed() {
  section('变异自证（镜像静态面 + 另一个端口；真树一字不动）')
  const before = fs.readFileSync(PATCH_PATH, 'utf8')
  const mtDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-we-group-mut-'))
  const rows = []
  try {
    for (let i = 0; i < MUTATIONS.length; i++) {
      const m = MUTATIONS[i]
      const r = m.apply(before)
      if (r.error) { ok(`变异${i + 1} 可施加（锚点唯一）`, false, r.error); continue }
      const demoDir = buildMirrorDemo(mtDir, i + 1, r.patch)
      const port = await freePort()
      const base = 'http://127.0.0.1:' + port
      const srv = spawn(process.execPath, [SERVER, String(port)], {
        cwd: ROOT, env: Object.assign({}, process.env, { MPW_BENCH_STATIC_DIR: demoDir }), stdio: ['ignore', 'pipe', 'pipe'], detached: true,
      })
      const killSrv = () => { try { process.kill(-srv.pid, 'SIGKILL') } catch { try { srv.kill('SIGKILL') } catch { /* 已退 */ } } }
      let res = null
      try {
        const up = await waitHealth(base, 20000)
        if (!up) { ok(`变异${i + 1} 镜像服务起得来（port ${port}）`, false, 'waitHealth 超时'); continue }
        res = await runChild(['--no-mutant'], { MPW_WE_GROUP_BASE: base, MPW_WE_GROUP_PATCH: path.join(demoDir, 'bench-patch.js') })
      } finally {
        killSrv()
        try { srv.stdout && srv.stdout.destroy() } catch { /* ignore */ }
        try { srv.stderr && srv.stderr.destroy() } catch { /* ignore */ }
      }
      const j = parseChildJson(res.out)
      //  子进程汇总行里的 `failed` 已经是**字符串数组**（断言名）⇒ 别按对象取 `.name`（踩过：全 undefined）
      const redNames = ((j && j.failed) || []).map((f) => (typeof f === 'string' ? f : String((f && f.name) || '')))
      const redLines = res.out.split('\n').filter((l) => l.startsWith('FAIL')).slice(0, 6)
      console.log(`\n─── 变异 ${i + 1}：${m.name}`)
      console.log(`    被测服务 = ${base}（静态面 = 镜像）· 子进程退出码 = ${res.code}（要求 1）`)
      console.log(`    RED 行（原文）：\n${redLines.map((l) => '      ' + l).join('\n') || '      (无 FAIL 行)'}`)
      ok(`变异${i + 1} 必红：子进程退出码 1 且有 FAIL`, res.code === 1 && redNames.length > 0,
        `code=${res.code} fails=${redNames.join(' | ').slice(0, 240)}`)
      const hit = m.expects.filter((e) => redNames.some((n) => n.startsWith(e)))
      ok(`变异${i + 1} 红的正是被变异掉的那条（${m.expects.join(' / ')}）`, hit.length > 0,
        `命中=${hit.join(',') || '无'} 实际=${redNames.join(' | ').slice(0, 300)}` + (j ? '' : ' · 子进程读数缺失，尾部输出=' + JSON.stringify(res.out.slice(-300))))
      rows.push({ i: i + 1, name: m.name, code: res.code, red: redNames, hit })
    }
  } finally {
    try { fs.rmSync(mtDir, { recursive: true, force: true }) } catch { /* 清理失败不致命 */ }
  }
  const after = fs.readFileSync(PATCH_PATH, 'utf8')
  ok('真树 bench-patch.js 跑前跑后逐字相同（变异只在镜像静态面里；并行编辑会假红）', before === after,
    before === after ? 'sha 相同（' + before.length + 'B）' : '内容变了 ' + before.length + '→' + after.length)
  console.log('MUTANT-RED-OK ' + JSON.stringify(rows.map((r) => ({ i: r.i, code: r.code, hit: r.hit }))))
}

/* ══════════════════════════ 主流程 ═══════════════════════════════════════════════════════════════
   ⚠ 整段包在 try/catch 里：**任何**未预期的异常（页面重载、探针超时、镜像服务起不来…）都必须落成
   一条 FAIL + 仍然打印机读汇总行 —— 变异自证靠那条汇总认"红的正是被变异掉的那条"，崩溃会让它瞎。 */
console.log('bench-props-we-group-test（P-201「渲染器设置（WE 自带）」固定清单 + 真驱动）· 被测服务 ' + BASE)
try {
  if (!NO_STATIC) await staticStage()
  if (!NO_BROWSER) await browserStage()
  if (!NO_MUTANT) await mutateRed()
} catch (e) {
  ok('主流程未抛异常（A/B/变异三段任何异常都要落成 FAIL，不能只剩退出码）', false,
    String((e && e.stack) || (e && e.message) || e).slice(0, 500))
}

console.log('\n===== bench-props-we-group: ' + pass + ' 通过 / ' + failed.length + ' 失败 =====')
console.log('BENCH-WE-GROUP-JSON ' + JSON.stringify({ pass, failed: failed.map((f) => f.name), total: pass + failed.length }))
if (JSON_OUT) { /* 机读行已在上面 */ }
process.exit(failed.length === 0 ? 0 : 1)
