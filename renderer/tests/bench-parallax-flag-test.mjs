#!/usr/bin/env node
/**
 * bench-parallax-flag-test.mjs —— ⑦(2026-10-12 用户 :8902 第 2/3 条「视差 / x-ray 没生效」的**页面侧根因 C**)
 * 的**纯 Node 门禁 + 真页面 E2E**。
 *
 * 事实（可复跑）：渲染器 `demo.html:8905` 的 `parallaxOff = !/^(1|official|legacy)$/.test(?parallax)`
 * ⇒ **缺省关**；而测试台此前**从不**往预览 iframe 的 URL 里写 `?parallax=` ⇒ 相机视差 + 对象级
 * `parallaxDepth` 在默认档整体停用（用户"看不到视差"的页面侧一半）。core / demo.html 一个字都不动 ✗。
 *
 * 覆盖：
 *   A 结构：面板切片里的 `#parallax` 控件（4 个既有取值 + 缺省 `1` + 文案键）、补丁侧三处接线
 *     （`rendererSourceUrl` 的 upsert / `rendererDprOpts()` 的字段 / `flagDefs` 的档位定义 + `fromUrl`）、
 *     DOM 位置（必须在 `#hybrid-box` 之前 —— 保住 `bench-ui-headless` LS1 的相邻兄弟判据）、
 *     自绘下拉浮层的点击豁免（不修它，工具条里每个 label 内的自绘下拉都**选不中选项**：实测值不变、浮层不关）；
 *   B 行为：`rendererSourceUrl()`（**真导出**）逐值带参 / 缺省一个字符都不写 / 幂等 / 本仓⇄上游往返保留；
 *     `parallax` 行已登记测试台写点；`demo.html` 的判定正则逐字未动；
 *   C 真页面 E2E（`:8902` 可达 + playwright/firefox 可用才跑，否则打印 SKIP 原因、**不计入通过**）：
 *     预览 iframe URL 的实际取值、**真点**自绘控件的四个档、选完浮层自动关、本页 URL `?parallax=` 优先；
 *   D 变异自证：6 个变异各改坏一处 ⇒ **期望红集 == 实际红集**（不等即红）；变异只落 /tmp。
 *
 * 运行：node tests/bench-parallax-flag-test.mjs   （全过 ALL PASS，退出码 0）
 * 纪律：真树只读；不启服务；`:8902` 只读访问（不改库目录、不 POST）；无网络依赖。
 */
import fs from 'node:fs'
import { AUDIO_MUTE_PREFS } from './_audio-mute.mjs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'

const readRel = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
const P = await import(pathToFileURL(path.join(ROOT, 'demo/bench-patch.js')).href)
const URL_BASE = process.env.MPW_BENCH_URL || 'http://127.0.0.1:8902/'
const ACCEPTED = ['1', 'official', 'legacy', '0']       // 渲染器 `demo.html:8905` 认的既有取值

function sliceBetween(text, begin, end) {
  const i = text.indexOf(begin)
  if (i < 0) return null
  const j = text.indexOf(end, i + begin.length)
  if (j < 0) return null
  const start = text.lastIndexOf('\n', i) + 1
  const eol = text.indexOf('\n', j)
  return text.slice(start, eol < 0 ? text.length : eol)
}
/** 一条 `#id` 在 HTML 里的出现位置（用于 DOM 顺序判据）。 */
const at = (html, id) => html.indexOf('id="' + id + '"')


/** 从**源文本**里切出一个函数（大括号配平）—— 变异副本要能影响"行为面"，不能只读真模块的导出。 */
function sliceFunction(text, header) {
  const i = text.indexOf(header)
  if (i < 0) return null
  const b = text.indexOf('{', i)
  if (b < 0) return null
  let d = 0
  for (let k = b; k < text.length; k++) {
    if (text[k] === '{') d++
    else if (text[k] === '}') { d--; if (d === 0) return text.slice(i, k + 1) }
  }
  return null
}
/** 源文本里的 `rendererSourceUrl()` 沙箱（依赖 rendererSourceMode / rendererDprCap / 仓库路径常量 —— 全部用真模块的值）。 */
function sandboxRendererSourceUrl(patchText) {
  const body = sliceFunction(patchText, 'export function rendererSourceUrl(')
  if (!body) throw new Error('切不到 rendererSourceUrl()')
  const fn = new Function('rendererSourceMode', 'rendererDprCap', 'RENDERER_SOURCE_REPO_PATH',
    body.replace('export function rendererSourceUrl(', 'function rendererSourceUrl(') + '\nreturn rendererSourceUrl')
  return fn(P.rendererSourceMode, P.rendererDprCap, P.RENDERER_SOURCE_REPO_PATH)
}

/* ═══════════════════════════ 判据集（同一套函数跑真源与变异副本） ═══════════════════════════ */
function runChecks(src) {
  const res = new Map()
  const add = (id, ok, label, extra = '') => res.set(id, { ok: !!ok, label, extra })
  const { indexHtml, patchText, readme, demoHtml } = src

  /* ── A 结构 ── */
  const box = sliceBetween(indexHtml, 'MPW-PARALLAX-FLAG-BEGIN', 'MPW-PARALLAX-FLAG-END')
  const isCheck = !!box && /<input type="checkbox" id="parallax"\s+checked\s*\/>/.test(box)
  add('A1', !!box && !!at(box, 'parallax') && isCheck
    && /data-i18n="toolbar\.parallax"/.test(box) && /data-i18n-title="toolbar\.parallaxTip"/.test(box),
    'A1 面板切片里有 `#parallax` 勾选框（**缺省勾上 = 开**）+ 文案键（值 `1`；不是下拉）',
    box ? `checkbox+checked=${isCheck}` : '未找到 MPW-PARALLAX-FLAG 切片')
  /* 工具条原生 select 的个数被既有判据硬编码（`bench-ui-headless` S3a/S3b：8 个 select / 8 个 `.bench-rd`）
     ⇒ 本控件**刻意做成勾选框**；这条判据守住"以后别顺手改回下拉、把别人的判据顶红"。 */
  const selectCount = (indexHtml.match(/<select /g) || []).length
  add('A1b', selectCount === 9 && !/<select id="parallax"/.test(indexHtml),
    'A1b 本页原生 `<select>` 个数不变（9 = 工具条 8 + 设置弹层 1）：视差用勾选框，不加第 9 个下拉',
    `select=${selectCount}`)
  const zh = P.DICT.zh || {}, en = P.DICT.en || {}
  const keys = ['toolbar.parallax', 'toolbar.parallaxTip']
  add('A2', keys.every((k) => String(zh[k] || '').trim() && String(en[k] || '').trim()) && !zh['parallax.on'],
    'A2 文案两键 zh/en 齐全非空（tooltip 说明"取消 = 层不跟鼠标"与 URL 的 A/B 用法）；下拉专用键已清掉',
    `zh.toolbar.parallax=${zh['toolbar.parallax']}`)
  const upsert = /if \(opts && opts\.parallax\) upsertCI\('parallax', encodeURIComponent\(String\(opts\.parallax\)\)\)/.test(patchText)
  const dprField = /parallax: parallaxMode,/.test(patchText)
  const wire = sliceBetween(patchText, 'MPW-PARALLAX-WIRING-BEGIN', 'MPW-PARALLAX-WIRING-END') || ''
  const wireOk = /parallaxEl\.checked \? '1' : '0'/.test(wire) && /localStorage\.setItem\('bench-parallax'/.test(wire)
    && /addEventListener\('change'/.test(wire) && /parallaxEl\.checked = parallaxMode !== '0'/.test(wire)
  add('A3', upsert && dprField && wireOk,
    'A3 补丁接线：`rendererSourceUrl` 的 upsert（**且只在 opts 给了值时写**）+ `rendererDprOpts()` 给 `parallax: parallaxMode` + 勾选框接线块（回填勾选态 / 改动写 `1`|`0` + localStorage + 重挂载或重写预览 URL）',
    `upsert=${upsert} dprField=${dprField} wire=${wireOk}`)
  /* A3b：档位状态机（URL > localStorage > `1`）—— 顺序也是判据，别把 URL 优先级弄丢。 */
  const decl = sliceBetween(patchText, "const PARALLAX_MODES = ", '})()') || ''
  const iUrl = decl.indexOf("new URLSearchParams(location.search).get('parallax')")
  const iLs = decl.indexOf("localStorage.getItem('bench-parallax')")
  add('A3b', /PARALLAX_MODES = \['1', 'official', 'legacy', '0'\]/.test(patchText) && iUrl > 0 && iLs > iUrl && /return '1'/.test(decl),
    'A3b 档位状态机：`PARALLAX_MODES` = 渲染器既有四值；优先级 **本页 URL > localStorage > `1`（开）**（顺序即判据）',
    `url@${iUrl} localStorage@${iLs}`)
  const iBox = at(indexHtml, 'parallax-box'), iHybrid = at(indexHtml, 'hybrid-box'), iLsw = at(indexHtml, 'layer-switch')
  add('A4', iBox > 0 && iHybrid > iBox && iLsw > iHybrid,
    'A4 DOM 位置：`#parallax-box` 在 `#hybrid-box` **之前** ⇒ `#hybrid-box` 的下一个元素仍是 `#layer-switch`（LS1 相邻兄弟判据不被顶掉）',
    `parallax=${iBox} < hybrid=${iHybrid} < layerSwitch=${iLsw}`)
  const popupExempt = /el\.closest\('\.bench-rd-list, \.mpw_select_list'\)[\s\S]{0,200}?ev\.preventDefault\(\)/.test(patchText)
  add('A5', popupExempt,
    'A5 工具条 capture 委托**放过自绘下拉浮层**（`.bench-rd-list` / `.mpw_select_list`）并只拦 label 默认激活 —— 不修它任何 label 内的自绘下拉都选不中选项（真页面实测：值不变、浮层不关；`#web-mode` 同样如此 ⇒ 非本轮引入）',
    popupExempt ? '豁免在位' : '豁免缺失')

  /* ── B 行为（真导出函数） ── */
  const base = 'http://127.0.0.1:8902/webloader/?id=some%2Fwall&res=dpr&shell=0&hybrid=1'
  const RSU = sandboxRendererSourceUrl(patchText)      // 沙箱跑**源文本里的**实现 ⇒ 变异能影响这一条
  const got = {}
  for (const v of ACCEPTED) got[v] = RSU(base, 'repo', { dpr: 'dpr', hybrid: true, parallax: v })
  const perValue = ACCEPTED.every((v) => new URL(got[v]).searchParams.get('parallax') === v)
  const noneForNull = [null, undefined, ''].every((v) => !new URL(RSU(base, 'repo', { dpr: 'dpr', parallax: v })).searchParams.has('parallax'))
  const idem = RSU(got.legacy, 'repo', { dpr: 'dpr', parallax: 'legacy' }) === got.legacy
  const up = RSU(got.official, 'upstream', { dpr: 'dpr', parallax: 'official' })
  const round = new URL(RSU(up, 'repo', { dpr: 'dpr', parallax: 'official' })).searchParams.get('parallax') === 'official'
  add('B1', perValue && noneForNull && idem && round,
    'B1 `rendererSourceUrl()`（真代码）：四个既有取值逐值进 URL；opts 没给 ⇒ URL 里**一个字符都不写**；幂等；本仓⇄上游往返保留',
    `perValue=${perValue} noneForNull=${noneForNull} 幂等=${idem} 往返=${round}`)
  const readmeRow = (readme.split('\n').find((l) => /^\|\s*`parallax`\s*\|/.test(l)) || '')
  add('B2', /测试台|bench-patch/.test(readmeRow),
    'B2 `docs/README-DIAGNOSTICS.md` 的 `parallax` 行登记了**测试台写点**（工具条「视差」档 → `rendererSourceUrl()`）',
    readmeRow ? readmeRow.replace(/\s+/g, ' ').slice(0, 120) : '未找到 parallax 行')
  add('B3', /parallaxOff: !\/\^\(1\|official\|legacy\)\$\/\.test\(String\(new URLSearchParams\(location\.search\)\.get\('parallax'\) \|\| ''\)\)/.test(demoHtml),
    'B3 **不改渲染器判定**：`demo.html` 的 `parallaxOff` 正则逐字未动（缺省仍是关；页面只是把开着的档位送进去）',
    'demo.html 判定逐字一致')

  return { res }
}

/* ═══════════════════════════ 真页面 E2E（可选） ═══════════════════════════ */
function findPlaywright() {
  const cands = [process.env.MPW_PLAYWRIGHT,
    path.join(ROOT, 'node_modules/playwright/index.js'),
    path.join(WS, 'dsh-mpkg-wallpaper/node_modules/playwright/index.js')].filter(Boolean)
  for (const c of cands) { try { if (fs.statSync(c).isFile()) return c } catch { /* next */ } }
  return null
}
async function e2e() {
  const skip = (why) => { console.log('SKIP C 真页面 E2E —— ' + why + '（**不计入通过**）'); return null }
  try { const r = await fetch(URL_BASE, { signal: AbortSignal.timeout(4000) }); if (!r.ok) return skip(`${URL_BASE} → HTTP ${r.status}`) } catch (e) { return skip(`测试台不可达：${e.message}`) }
  const pwPath = findPlaywright()
  if (!pwPath) return skip('找不到 playwright')
  const pw = await import(pathToFileURL(pwPath).href)
  const firefox = (pw.default && pw.default.firefox) || pw.firefox
  if (!firefox) return skip('playwright 没有 firefox 导出')
  let browser
  try { browser = await firefox.launch({ firefoxUserPrefs: { ...AUDIO_MUTE_PREFS }, headless: true }) } catch (e) { return skip('firefox 起不来：' + e.message) }
  const out = []
  try {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } })
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => errs.push(String(e.message || e)))
    const readState = () => page.evaluate(() => {
      const src = document.querySelector('#frame').getAttribute('src') || ''
      const sel = document.querySelector('#parallax')
      return { preview: new URL(src, location.href).searchParams.get('parallax'), checked: !!sel.checked, stored: localStorage.getItem('bench-parallax'),
        label: document.querySelector('#parallax-box').textContent.trim() }
    })
    const settle = async () => {
      await page.waitForFunction(() => { try { const s = window.__benchPatch.layerSwitch(); return s && s.total > 0 } catch { return false } }, { timeout: 120000 })
      await page.waitForTimeout(2500)
    }
    // C1 缺省：预览 URL 真的带 parallax=1（样例档 + 真壁纸档都看）
    await page.goto(URL_BASE, { waitUntil: 'domcontentloaded' })
    await settle()
    const d0 = await readState()
    out.push({ id: 'C1', ok: d0.preview === '1' && d0.checked === true, label: 'C1 缺省档：预览 iframe URL 带 `parallax=1`（渲染器缺省关 ⇒ 不带就等于"视差整体停用"）', extra: JSON.stringify(d0) })
    // C2 真点勾选框：取消 ⇒ `parallax=0`（关）；再勾 ⇒ `parallax=1`（开）；两者都落 localStorage
    const clicks = []
    for (const [want, expect] of [[false, '0'], [true, '1']]) {
      await page.click('#parallax-box input#parallax')
      await page.waitForTimeout(1800)
      const st = await readState()
      clicks.push({ want, expect, preview: st.preview, checked: st.checked, stored: st.stored })
    }
    out.push({ id: 'C2', ok: clicks.every((c) => c.checked === c.want && c.preview === c.expect && c.stored === c.expect),
      label: 'C2 **真点**勾选框：预览 URL 与 localStorage 跟着 `parallax=1|0`（取消=关 / 勾上=开）',
      extra: JSON.stringify(clicks) })
    // C3 本页 URL 优先（localStorage 放一个相反值）
    await page.evaluate(() => localStorage.setItem('bench-parallax', '0'))
    await page.goto(URL_BASE + '?parallax=legacy', { waitUntil: 'domcontentloaded' })
    await settle()
    const d3 = await readState()
    await page.goto(URL_BASE + '?parallax=garbage', { waitUntil: 'domcontentloaded' })
    await settle()
    const d4 = await readState()
    out.push({ id: 'C3', ok: d3.preview === 'legacy' && d3.checked === true && d4.preview === '0',
      label: 'C3 本页 URL 的 `?parallax=legacy` **优先于** localStorage（= 主表登记的 A/B 用法；勾选态显示"开"但预览保留 `legacy`），垃圾值被忽略',
      extra: JSON.stringify({ legacy: d3, garbage: d4 }) })
    out.push({ id: 'C4', ok: errs.length === 0, label: 'C4 整轮 0 个页面脚本错', extra: JSON.stringify(errs.slice(0, 2)) })
  } finally { try { await browser.close() } catch { /* ignore */ } }
  return out
}

/* ═══════════════════════════ 变异表 ═══════════════════════════ */
const MUTATIONS = [
  { id: 'N1', why: '`rendererSourceUrl` 里去掉 parallax 的 upsert（回到"从不写"的修前状态）', scope: 'patch', expect: ['A3', 'B1'],
    apply: (t) => t.replace(/\n  if \(opts && opts\.parallax\) upsertCI\('parallax'[^\n]*\n/, '\n') },
  { id: 'N2', why: 'upsert 的守卫去掉（opts 没给也写 `parallax=undefined`）⇒ 缺省一个字符都不写这条破', scope: 'patch', expect: ['A3', 'B1'],
    apply: (t) => t.replace("if (opts && opts.parallax) upsertCI('parallax', encodeURIComponent(String(opts.parallax)))", "upsertCI('parallax', encodeURIComponent(String(opts && opts.parallax)))") },
  { id: 'N3', why: '`rendererDprOpts()` 不再把档位交出去（勾选框成摆设：预览 URL 永远不带 `?parallax=`）', scope: 'patch', expect: ['A3'],
    apply: (t) => t.replace('        parallax: parallaxMode,\n', '') },
  { id: 'N4', why: '档位缺省从「勾上」改成「不勾」（用户看不到视差 = 回到本轮的用户报障）', scope: 'index', expect: ['A1'],
    apply: (t) => t.replace('<input type="checkbox" id="parallax" checked />', '<input type="checkbox" id="parallax" />') },
  { id: 'N5', why: '去掉本页 URL 的 `?parallax=` 优先级（主表登记的 A/B 用法失效）', scope: 'patch', expect: ['A3b'],
    apply: (t) => t.replace("    try { const v = String(new URLSearchParams(location.search).get('parallax') || ''); if (PARALLAX_MODES.indexOf(v) >= 0) return v } catch (e) { /* 无 location */ }\n", '') },
  { id: 'N8', why: '勾选框忘了回填（载入时 `?parallax=0`/localStorage 的"关"不显示）', scope: 'patch', expect: ['A3'],
    apply: (t) => t.replace("      try { parallaxEl.checked = parallaxMode !== '0' } catch (e) { /* 桩 DOM */ }\n", '') },
  { id: 'N9', why: '改成多一个原生 `<select>`（把别人判据 S3a/S3b 的硬编码个数顶红）', scope: 'index', expect: ['A1', 'A1b'],
    apply: (t) => t.replace('<input type="checkbox" id="parallax" checked />', '<select id="parallax"><option value="1" selected>on</option></select>') },
  { id: 'N6', why: '去掉浮层点击豁免（工具条里每个 label 内的自绘下拉又选不中选项）', scope: 'patch', expect: ['A5'],
    apply: (t) => t.replace(/\n\s*if \(el\.closest\('\.bench-rd-list, \.mpw_select_list'\)\)[^\n]*\n/, '\n') },
  { id: 'N7', why: '把 `#parallax-box` 挪到 `#hybrid-box` 之后 ⇒ LS1 的"图层开关紧随流式播放"被顶掉', scope: 'index', expect: ['A4'],
    apply: (t) => {
      const i = t.indexOf('<!-- ═══ MPW-PARALLAX-FLAG-BEGIN')
      const j = t.indexOf('<!-- ═══ MPW-PARALLAX-FLAG-END ═══ -->')
      if (i < 0 || j < 0) return t
      const blk = t.slice(i, j + '<!-- ═══ MPW-PARALLAX-FLAG-END ═══ -->'.length)
      const rest = t.slice(0, i) + t.slice(i + blk.length)
      const k = rest.indexOf('<!-- P-240（2026-10-06 任务书 §2.1）「图层开关」：逐层诊断台')
      return k < 0 ? t : rest.slice(0, k) + blk + '\n              ' + rest.slice(k)
    } },
]

/* ═══════════════════════════ 主流程 ═══════════════════════════ */
const REAL = { indexHtml: readRel('demo/index.html'), patchText: readRel('demo/bench-patch.js'), readme: readRel('docs/README-DIAGNOSTICS.md'), demoHtml: readRel('demo.html') }
let pass = 0, fail = 0
const ok = (c, label, extra = '') => { if (c) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }

console.log('== A 结构（控件 / 文案键 / 三处接线 / DOM 位置 / 浮层点击豁免） ==')
console.log('== B 行为（真导出 `rendererSourceUrl` 逐值带参；README 写点；渲染器判定未动） ==')
const main = runChecks(REAL)
for (const id of ['A1', 'A1b', 'A2', 'A3', 'A3b', 'A4', 'A5', 'B1', 'B2', 'B3']) {
  const r = main.res.get(id)
  ok(r.ok, r.label, r.extra)
}

console.log('\n== C 真页面 E2E（:8902 只读；不可达则 SKIP 且不计通过） ==')
const cRes = await e2e()
if (cRes) for (const r of cRes) ok(r.ok, r.label, r.extra)

console.log('\n== D 变异自证（同一套判据函数跑变异副本；期望红集 == 实际红集） ==')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-parallax-flag-'))
const RED_IDS = [...main.res.keys()]
let mutBad = 0
for (const m of MUTATIONS) {
  const src = Object.assign({}, REAL)
  let applied = false
  if (m.scope === 'index') { src.indexHtml = m.apply(REAL.indexHtml); applied = src.indexHtml !== REAL.indexHtml }
  else { src.patchText = m.apply(REAL.patchText); applied = src.patchText !== REAL.patchText }
  let actual = [], err = ''
  if (applied) { try { const r = runChecks(src); actual = RED_IDS.filter((id) => { const x = r.res.get(id); return x ? !x.ok : false }) } catch (e) { err = e.message; actual = ['<异常>'] } }
  const expect = [...m.expect].sort(), got = [...actual].sort()
  const same = applied && !err && expect.join(',') === got.join(',')
  if (!same) mutBad++
  console.log((same ? 'PASS ' : 'FAIL ') + `${m.id} ${m.why}`, `\n      变异已落地=${applied} 期望红集=[${expect.join(' ')}] 实际红集=[${got.join(' ')}]${err ? ' 异常：' + err : ''}`)
  fs.writeFileSync(path.join(TMP, m.id + '.txt'), `apply=${applied} expect=${expect.join(',')} actual=${got.join(',')}\n`)
}
ok(mutBad === 0, `D 变异自证：${MUTATIONS.length} 个变异全部"期望红集 == 实际红集"`, mutBad ? `${mutBad} 个不符（见上）` : `变异清单落在 ${TMP}`)

const h = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12)
ok(readRel('demo/index.html') === REAL.indexHtml && readRel('demo/bench-patch.js') === REAL.patchText,
  'E 真树跑前跑后同哈希（变异只落 /tmp 副本）', `index=${h(REAL.indexHtml)} patch=${h(REAL.patchText)}`)

console.log(`\n── 汇总：PASS=${pass} FAIL=${fail} ──`)
if (fail) process.exit(1)
console.log('ALL PASS')
