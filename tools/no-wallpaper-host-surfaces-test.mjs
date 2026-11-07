// tools/no-wallpaper-host-surfaces-test.mjs — Z15（2026-11-08）无壁纸宿主浮层门控判据
//
// 现场（2026-11-08 用户报）：无壁纸（image 与 webUrl 都空）时，左侧栏会话 hover 预览
//（[class*="_copyable_"]/[class*="_card_38jqx_"]）、宿主 tooltip（[role="tooltip"]/_bubble_）
// 与右侧轮次导航悬停预览（.eGxaPq_preview/.Y0dWHa_preview）整块透明；有壁纸时的半透明
// 磨砂是既有设计（不许改坏）。
//
// 根因（改前读数，0a2e4b9 基线实测）：buildUiCss 被 buildCss **两条 return 路径**都调用
//（有壁纸主线 21199 / 无壁纸早退线 19057），其中 tooltip/轮次预览家族表面规则消费
// --mpw-pop-surface(-dark)/--mpw-pop-blur/--mpw-sess-preview-* —— 这组 token 只在有壁纸
// 主线（popSurface 段 tok()）落值 ⇒ 无壁纸 var() 无 fallback ⇒ invalid at computed-value
// time ⇒ background 变 transparent。改前无壁纸产物 379 条规则里 tooltip 族 4 命中、
// rail 预览族 4 命中；2026-11-06 的 noImagePopCss 只兜了 menu/listbox 家族，漏了这两族。
//
// 修复 = ① buildUiCss 内 uiHasImage（= !!(image||webUrl)，与 applyTokenOverrides 同口径）
// 门控包裹三组规则（有壁纸时文本逐字不变）；② applyTokenOverrides 顶部维护
// body[data-mpw-no-wallpaper] 标记；③ __mpwNoWallpaperProbe 生产重入钩子（storage 事件
// 处理器同款三步）供运行时切换判据。
//
// 双向断言：A 组（无壁纸 ⇒ 表面覆盖规则 0 命中 + 规则体不消费壁纸-only token）×
// B 组（有壁纸 image/webUrl ⇒ 各族规则计数 ≥ 基线，防"收没了"）。
// 变异自证（隔离副本，R2 生效断言 + 期望红集==实际红集）：
//   M1 删 uiHasImage 门控（规则无条件输出）⇒ A 红；M2 门控反转 ⇒ B 红；M3 标记不设置 ⇒ C/D 红。
//
// 用法: node tools/no-wallpaper-host-surfaces-test.mjs [--client <path>]

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPlugin } from './_stub.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const argClient = process.argv.indexOf('--client')
const REAL_CLIENT = argClient > 0 ? process.argv[argClient + 1] : path.join(here, '..', 'lib', 'client.js')

let pass = 0, fail = 0
const ok = (id, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + id + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + id + (detail ? '  [' + detail + ']' : '')) }
}

const IMG = 'data:image/png;base64,iVBORw0KGgo='
const NOWALL = { enabled: true, image: '', webUrl: '', sceneKey: '' }
const WALL_IMG = { enabled: true, image: IMG, webUrl: '', sceneKey: '' }
const WALL_WEB = { enabled: true, image: '', webUrl: 'https://wallpaper.example/x.html', sceneKey: '' }

/* 基线计数（本修复在基线 0a2e4b9 上实测：有壁纸 image 档各族命中数）。
   语义：修复后有壁纸时规则必须"一条都不少"；低于基线 ⇒ 有壁纸观感被收没（B 红）。 */
const BASE = { TIP: 8, BUB: 6, COPY: 4, RAILP: 4 }
const TIP = (s) => /\[role="tooltip"\]|\[role="alert"\]/.test(s)
const BUB = (s) => /\[class\*="_bubble_"\]/.test(s)
const COPY = (s) => /\[class\*="_copyable_"\]|\[class\*="_card_38jqx_"\]/.test(s)
const RAILP = (s) => /\.eGxaPq_preview|\.Y0dWHa_preview/.test(s)
const FAMS = [['TIP', TIP], ['BUB', BUB], ['COPY', COPY], ['RAILP', RAILP]]

const strip = (t) => String(t).replace(/\/\*[\s\S]*?\*\//g, '')
const rulesOf = (t) => [...strip(t).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].replace(/\s+/g, ' ').trim(), m[2].replace(/\s+/g, ' ').trim()])
/* 规则体去掉自定义属性声明后，再看是否消费壁纸-only token（只定义不消费不算——
   --mpw-surface-panel-menu 的定义块在无壁纸时无害：其消费者都在有壁纸主线）。 */
const bodyConsumesWallToken = (body) => {
  const real = body.replace(/(^|;)\s*--[\w-]+\s*:[^;]*/g, '$1')
  return /var\(--mpw-pop-surface|var\(--mpw-pop-blur\)|var\(--mpw-sess-preview-/.test(real)
}

/* 同进程多次载入前必须清 __mpw* 窗口级标记：client.js 首句 `if (globalThis.__mpwClientLoaded)
   return ...` 防重复注册（bgwrap-visible-test 同款 reset），否则第二次拿到的是上一次实例。 */
function reset() {
  for (const k of Object.keys(globalThis)) if (/^__mpw/.test(k)) { try { delete globalThis[k] } catch {} }
}

/* 桩 ctx 没有 theme.overrideTokens（生产宿主才有）⇒ applyTokenOverrides 会在第一道守卫早退、
   无壁纸标记/C 组 token 链路根本跑不到。这里补最小 theme 桩（issue5-surface-test 同款）。 */
const withTheme = (extra) => (ctx) => {
  const rec = { tokenCalls: [] }
  ctx.theme = { overrideTokens: (name, tokens) => { rec.tokenCalls.push(tokens); return { dispose() {} } } }
  if (typeof extra === 'function') extra(ctx, rec)
}

function buildCssOf(clientPath, patch) {
  reset()
  const r = loadPlugin({ clientPath, settings: patch, quiet: true })
  if (r.applyErrors.length) throw new Error('apply 报错: ' + r.applyErrors[0])
  const fn = globalThis.__mpwBuildCss
  if (typeof fn !== 'function') throw new Error('未暴露 __mpwBuildCss')
  const css = String(fn(Object.assign({}, patch)) || '')
  return css
}

function domOf(clientPath, settings, decorate) {
  reset()
  const r = loadPlugin({ clientPath, settings, quiet: true, ctxDecorate: decorate })
  if (r.applyErrors.length) throw new Error('apply 报错: ' + r.applyErrors[0])
  return r
}

/* ---------- 全套断言（真树与变异副本共用；返回红 ID 集） ---------- */
async function runSuite(clientPath) {
  const red = []
  const ck = (id, cond, detail) => {
    console.log('  ' + (cond ? '✓ ' : '✗ ') + id + (detail ? '  [' + detail + ']' : ''))
    if (!cond) red.push(id)
  }

  /* == A 组：无壁纸 ⇒ tooltip/轮次预览表面覆盖规则 0 命中（含计数清单）== */
  let noWallCss = ''
  try { noWallCss = buildCssOf(clientPath, NOWALL) } catch (e) { ck('A0', false, String(e.message || e)); return red }
  const noWallRules = rulesOf(noWallCss)
  for (const [name, f] of FAMS) {
    const hits = noWallRules.filter(([s]) => f(s))
    ck('A1.' + name, hits.length === 0, '命中=' + hits.length + (hits.length ? ' 例:' + hits[0][0].slice(0, 70) : '（0 命中）'))
  }
  /* A2a（本 bug 指纹，严格 0）：tooltip/轮次预览族规则体不得消费壁纸-only token；
     A2b（菜单族豁免留证）：其余消费者必须全部属于菜单族，且产物带 noImagePopCss 的
     不透明兜底签名（2026-11-06 修复，靠"后位 + 更高特异性"压住这些消费 ⇒ 无透明后果；
     若有人删掉该兜底，这里红）。 */
  const consume = noWallRules.filter(([, b]) => bodyConsumesWallToken(b))
  const MENU_FAM = /QsffPG_menu|ZKlsPq_menu|data-menu-material|data-trigger-menu|JObwrW_panel|_menu/
  const nonMenu = consume.filter(([s]) => !MENU_FAM.test(s))
  ck('A2a', nonMenu.length === 0, '非菜单族消费壁纸-only token=' + nonMenu.length + (nonMenu.length ? ' 例:' + nonMenu[0][0].slice(0, 70) : ''))
  const hasNoImagePop = /background-color:\s*var\(--mpw-surface-panel,\s*#ffffff\)\s*!important/.test(strip(noWallCss))
  ck('A2b', consume.length === 0 || (nonMenu.length === 0 && hasNoImagePop),
    '消费者=' + consume.length + ' 全部菜单族=' + (nonMenu.length === 0) + ' noImagePopCss 兜底在=' + hasNoImagePop)
  const defs = (strip(noWallCss).match(/--mpw-(?:pop-surface|pop-blur|pop-surface-dark|sess-preview-surface)\s*:/g) || []).length
  ck('A3', defs === 0, '无壁纸产物定义 pop/sess token=' + defs)

  /* == B 组：有壁纸（image / webUrl）⇒ 各族规则计数 ≥ 基线（防"收没了"）== */
  for (const [label, patch] of [['B1', WALL_IMG], ['B2', WALL_WEB]]) {
    let css = ''
    try { css = buildCssOf(clientPath, patch) } catch (e) { ck(label, false, String(e.message || e)); continue }
    const rules = rulesOf(css)
    const counts = FAMS.map(([name, f]) => [name, rules.filter(([s]) => f(s)).length])
    const short = counts.filter(([n, c]) => c < BASE[n])
    ck(label, short.length === 0, counts.map(([n, c]) => n + '=' + c + '>=' + BASE[n]).join(' ') + (short.length ? ' 不足:' + short.map(([n]) => n) : ''))
  }
  {
    let cssW = ''
    try { cssW = buildCssOf(clientPath, WALL_IMG) } catch (e) { cssW = '' }
    const defsW2 = (strip(cssW).match(/--mpw-pop-surface\s*:/g) || []).length
    ck('B3', defsW2 >= 1, '有壁纸产物 --mpw-pop-surface 定义=' + defsW2 + '（规则消费有源）')
  }

  /* == C 组：假 DOM 标记（data-mpw-no-wallpaper）== */
  try {
    const r1 = domOf(clientPath, NOWALL, withTheme())
    const marked = !!(r1.doc.body && r1.doc.body.hasAttribute('data-mpw-no-wallpaper'))
    ck('C1', marked, '无壁纸 loadPlugin ⇒ body 标记=' + marked)
  } catch (e) { ck('C1', false, String(e.message || e)) }
  try {
    const r2 = domOf(clientPath, WALL_IMG, withTheme())
    const marked = !!(r2.doc.body && r2.doc.body.hasAttribute('data-mpw-no-wallpaper'))
    ck('C2', !marked, '有壁纸 loadPlugin ⇒ body 标记=' + marked)
  } catch (e) { ck('C2', false, String(e.message || e)) }
  try {
    /* C3 机制一致性：有壁纸时 token 覆盖确实半透明化（补偿规则存在的前提）；
       独立 oracle = ctx.theme.overrideTokens 的实参（不经 buildCss）。 */
    let rec = null
    reset()
    const r3 = loadPlugin({ clientPath, settings: WALL_IMG, quiet: true, ctxDecorate: withTheme((ctx, r) => { rec = r }) })
    void r3
    const calls = rec ? rec.tokenCalls : []
    const hasLayer = calls.some((t) => t && t['--dsw-alias-bg-layer-1'])
    ck('C3', hasLayer, 'overrideTokens 调用含 --dsw-alias-bg-layer-1=' + hasLayer + '（calls=' + calls.length + '）')
  } catch (e) { ck('C3', false, String(e.message || e)) }

  /* == D 组：运行时切换（清壁纸/重新选壁纸无需刷新）==
     writeSection 的落盘是 setTimeout(0) 异步（instant 档也一样）⇒ 每次写后等一个 tick 再 reapply，
     模拟真实"写完存储才重入"的时序；boot 收尾（host-error 路径）先等它落定。 */
  try {
    reset()
    const r = loadPlugin({ clientPath, settings: NOWALL, quiet: true, ctxDecorate: withTheme() })
    void r
    await new Promise((res) => setTimeout(res, 30))
    const probe = globalThis.__mpwNoWallpaperProbe
    if (!probe || typeof probe.reapply !== 'function') { ck('D0', false, '缺 __mpwNoWallpaperProbe'); return red }
    ck('D0', probe.marked() === true, '初始无壁纸 marked=' + probe.marked())
    const w1 = globalThis.__mpwSectionTest.write({ image: IMG, webUrl: '', sceneKey: '' })
    await new Promise((res) => setTimeout(res, 15))
    const re1 = probe.reapply()
    ck('D1', w1 === true && re1 === true && probe.marked() === false, 'write(image) + reapply ⇒ marked=' + probe.marked() + ' w=' + w1 + ' r=' + JSON.stringify(re1))
    const w2 = globalThis.__mpwSectionTest.write({ image: '', webUrl: '', sceneKey: '' })
    await new Promise((res) => setTimeout(res, 15))
    const re2 = probe.reapply()
    ck('D2', w2 === true && re2 === true && probe.marked() === true, 'write(空) + reapply ⇒ marked=' + probe.marked() + ' w=' + w2 + ' r=' + JSON.stringify(re2))
  } catch (e) { ck('D0', false, String(e.message || e)) }

  return red
}

console.log('== 真树断言（' + path.basename(REAL_CLIENT) + '）==')
const redReal = await runSuite(REAL_CLIENT)
for (const id of redReal) fail++
if (redReal.length === 0) pass++ // 真树零红本身计一次通过位
else { console.log('  真树红集: ' + JSON.stringify(redReal)); fail++ }

/* ---------- 变异自证（隔离副本；R2：断言变异生效） ---------- */
const src0 = fs.readFileSync(REAL_CLIENT, 'utf8')
const mkTmp = (pfx) => fs.mkdtempSync(path.join(os.tmpdir(), pfx))
const MUT_ANCHOR = '${uiHasImage ? `'
const MUT_COUNT = src0.split(MUT_ANCHOR).length - 1

async function withMutant(id, what, mutate, expectRed) {
  const dir = mkTmp('mpw-z15-mut-')
  const f = path.join(dir, 'client.js')
  let mutated = src0
  let applied = false
  try { [mutated, applied] = mutate(src0) } catch (e) { applied = false }
  fs.writeFileSync(f, mutated)
  let red = []
  try { red = await runSuite(f) } catch (e) { red = ['THROW:' + String(e && e.message || e).slice(0, 60)] }
  const eq = applied && JSON.stringify(red.slice().sort()) === JSON.stringify(expectRed.slice().sort())
  console.log('  ' + (eq ? 'MUTANT-RED-OK' : 'MUTANT-MISMATCH') + ' ' + id + '  ' + what)
  console.log('    期望红集=' + JSON.stringify(expectRed.slice().sort()) + ' 实际红集=' + JSON.stringify(red.slice().sort()) + ' 变异生效=' + applied)
  if (eq) pass++; else fail++
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
}

console.log('\n== 变异自证（隔离副本）==')
/* M1 删门控：三处 ${uiHasImage ? ` → ${true ? ` ⇒ 无壁纸也输出 tooltip 规则 ⇒ A 红 */
await withMutant('M1', '删 uiHasImage 门控（无壁纸也输出表面覆盖规则）',
  (src) => {
    const n = src.split(MUT_ANCHOR).length - 1
    if (n !== MUT_COUNT || MUT_COUNT < 3) return [src, false]
    const out = src.split(MUT_ANCHOR).join('${true ? `')
    return [out, !out.includes(MUT_ANCHOR) && out.split('${true ? `').length - 1 === MUT_COUNT]
  },
  ['A1.TIP', 'A1.BUB', 'A1.COPY', 'A1.RAILP', 'A2a', 'A2b'])
/* M2 把三组规则整体删掉（${false ? ` 永不输出）⇒ 有壁纸收没 ⇒ B 红；
   无壁纸本就 0 命中 ⇒ A 仍绿（双向分辨力所在） */
await withMutant('M2', '删光三组门控规则（有壁纸观感被收没）',
  (src) => {
    const n = src.split(MUT_ANCHOR).length - 1
    if (n !== MUT_COUNT || MUT_COUNT < 3) return [src, false]
    const out = src.split(MUT_ANCHOR).join('${false ? `')
    return [out, out.split(MUT_ANCHOR).length - 1 === 0]
  },
  ['B1', 'B2'])
/* M3 标记不设置（清壁纸后不撤规则等价面）⇒ C1/D2 红（D1 摘除分支仍在 ⇒ 保持绿） */
await withMutant('M3', 'applyTokenOverrides 不设置无壁纸标记',
  (src) => {
    const anchor = 'else document.body.setAttribute("data-mpw-no-wallpaper", "1");'
    const n = src.split(anchor).length - 1
    if (n !== 1) return [src, false]
    const out = src.replace(anchor, 'else ;')
    return [out, !out.includes(anchor)]
  },
  ['C1', 'D0', 'D2'])

console.log('\n===== ' + pass + ' 通过 / ' + fail + ' 失败 =====')
process.exit(fail ? 1 : 0)
