// tools/renderer-source-switch-test.mjs — Z11（2026-11-08）测试项「渲染器来源」切换判据
//
// 需求：测试项渲染器区新增一行「渲染器来源」：两个预设按钮
//   · 新接入渲染器（内置，默认）⇒ sceneRendererUrl = ""（同源 /webloader/）
//   · 原仓库渲染器 ⇒ sceneRendererUrl = http://127.0.0.1:8902/webloader/
//     （取值依据：lib/client.js 迁移注释 853–861/8629–8637 行 + MPW_SCENE_REPO_RENDERER_BASE 常量注释；
//      显式回环目标照常过 URL 闸门 —— 不绕过守卫）
// 默认态 = 新接入；active 由当前 section.sceneRendererUrl 派生；切换 = commit(..., true)（落盘 +
// applyFromStorage 重挂）；高级文本框降级为默认折叠的「自定义地址」；hint 显示当前生效地址与
// 健康状态（__mpwRendererOk === false ⇒ 如实显示不可达，不新增静默回退）。
//
// 驱动方式：preset-test 同款 —— 桩 React 渲染 sectionComp，data-* 标记寻按钮，onClick 直调。
// 变异（隔离副本，R2 生效断言 + 期望红集==实际红集）：
//   M1 active 派生颠倒（空≠内置）⇒ A1a/A2a 红；M2 切换不写档 ⇒ A2 红；M3 绕过 URL 闸门 ⇒ A5 红。
//
// 用法: node tools/renderer-source-switch-test.mjs [--client <path>]

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
const sleep = (ms) => new Promise((res) => setTimeout(res, ms))

const REPO = 'http://127.0.0.1:8902/webloader/'
const DEF = '/webloader/'

function findNode(tree, pred) {
  const out = []
  const walk = (n) => {
    if (n == null || typeof n !== 'object') return
    if (Array.isArray(n)) { n.forEach(walk); return }
    if (n.props && pred(n.props)) out.push(n)
    if (n.kids) walk(n.kids)
  }
  walk(tree)
  return out[0] || null
}
const btnOf = (tree, v) => findNode(tree, (p) => p && p['data-mpw-rd-src'] === v && typeof p.onClick === 'function')
const activeOf = (tree, v) => { const b = btnOf(tree, v); return !!b && String(b.props.className || '').indexOf('mpw_tabActive') >= 0 }
const clickBtn = (tree, v) => { const b = btnOf(tree, v); if (!b) return false; try { b.props.onClick(); return true } catch (e) { return false } }

function makeWorld(clientPath, settings) {
  for (const k of Object.keys(globalThis)) if (/^__mpw/.test(k)) { try { delete globalThis[k] } catch {} }
  const ls = { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null }, setItem(k, v) { this._m.set(k, String(v)) }, removeItem(k) { this._m.delete(k) } }
  const r = loadPlugin({ clientPath, quiet: true, localStorage: ls, settings: settings || {}, ctxDecorate: (ctx) => { ctx.theme = { overrideTokens: () => ({ dispose() {} }) } } })
  if (r.applyErrors.length) throw new Error('apply 报错: ' + r.applyErrors[0])
  const zh = r.localeDicts.zh
  const t = (k) => (zh[k] !== undefined ? zh[k] : k)
  const render = () => { try { return r.sectionComp({ t, close: () => {} }) } catch (e) { return { __crash: String(e && e.message || e) } } }
  return { r, ls, t, render }
}
const lsVal = (w) => { try { return String(JSON.parse(w.ls.getItem('dsh.mpkg-wallpaper.v2')).sceneRendererUrl ?? null) } catch (e) { return 'PARSE-ERR' } }
const baseOf = () => { try { return String(globalThis.__mpwSceneTest.rendererBase()) } catch (e) { return 'ERR' } }

/* ---------- 断言套件（真树与变异副本共用；返回红 ID 集） ---------- */
async function runSuite(clientPath) {
  const red = []
  const ck = (id, cond, detail) => {
    console.log('  ' + (cond ? '✓ ' : '✗ ') + id + (detail ? '  [' + detail + ']' : ''))
    if (!cond) red.push(id)
  }

  /* == A1a 默认（空）⇒ 新接入 active、原仓库/自定义不亮；A1b 自定义行折叠 == */
  let w1 = null
  try { w1 = makeWorld(clientPath, { enabled: true, image: '', webUrl: '', sceneKey: '' }) } catch (e) { ck('A0', false, String(e.message || e)); return red }
  const tree1 = w1.render()
  if (tree1.__crash) { ck('A0', false, tree1.__crash); return red }
  ck('A1a', activeOf(tree1, 'builtin') && !activeOf(tree1, 'repo') && !activeOf(tree1, 'custom'),
    'builtin=' + activeOf(tree1, 'builtin') + ' repo=' + activeOf(tree1, 'repo') + ' custom=' + activeOf(tree1, 'custom'))
  ck('A1b', !findNode(tree1, (p) => p && p['data-mpw-rd-custom-row'] !== undefined), '自定义行默认折叠=' + !findNode(tree1, (p) => p && p['data-mpw-rd-custom-row'] !== undefined))
  ck('A1c', lsVal(w1) === 'null' || lsVal(w1) === '""', '默认档 sceneRendererUrl=' + lsVal(w1))
  ck('A1d', baseOf() === DEF, 'rendererBase()=' + baseOf())

  /* == A2 点「原仓库」⇒ 写档 + 生效地址 = 原仓库 + guard 放行记账 == */
  const clickedRepo = clickBtn(tree1, 'repo')
  await sleep(25)   // commit 落盘是 setTimeout(0)
  const tree1b = w1.render()
  ck('A2a', clickedRepo && lsVal(w1) === JSON.stringify(REPO).slice(1, -1), '点击后档内 sceneRendererUrl=' + lsVal(w1))
  ck('A2b', baseOf() === REPO, 'rendererBase()=' + baseOf())
  ck('A2c', activeOf(tree1b, 'repo') && !activeOf(tree1b, 'builtin'), '重渲染后 repo active=' + activeOf(tree1b, 'repo'))
  {
    const g = (() => { try { return globalThis.__mpwSceneTest.urlGuard() } catch (e) { return null } })()
    ck('A2d', !!g && g.allowed >= 1, 'urlGuard 放行记账 allowed=' + (g ? g.allowed : 'null'))
  }

  /* == A3 原仓库档 ⇒ 点「新接入」回到 "" == */
  const w3 = makeWorld(clientPath, { enabled: true, image: '', webUrl: '', sceneKey: '', sceneRendererUrl: REPO })
  const tree3 = w3.render()
  ck('A3a', activeOf(tree3, 'repo') && !activeOf(tree3, 'builtin'), 'repo 档初始 active repo=' + activeOf(tree3, 'repo'))
  const clickedBuiltin = clickBtn(tree3, 'builtin')
  await sleep(25)
  ck('A3b', clickedBuiltin && (lsVal(w3) === '' || lsVal(w3) === 'null'), '点新接入后档内 sceneRendererUrl=' + JSON.stringify(lsVal(w3)))
  ck('A3c', baseOf() === DEF, 'rendererBase()=' + baseOf())

  /* == A4 自定义档 ⇒ custom 亮、builtin/repo 不亮；自定义行展开 == */
  const w4 = makeWorld(clientPath, { enabled: true, image: '', webUrl: '', sceneKey: '', sceneRendererUrl: 'http://127.0.0.1:9999/webloader/' })
  const tree4 = w4.render()
  ck('A4a', activeOf(tree4, 'custom') && !activeOf(tree4, 'builtin') && !activeOf(tree4, 'repo'),
    'custom=' + activeOf(tree4, 'custom') + ' builtin=' + activeOf(tree4, 'builtin') + ' repo=' + activeOf(tree4, 'repo'))
  ck('A4b', !!findNode(tree4, (p) => p && p['data-mpw-rd-custom-row'] !== undefined), '自定义行随自定义态展开')

  /* == A5 安全闸门（不绕过）：非回环目标被拒 + 记账，回落默认回环 == */
  const w5 = makeWorld(clientPath, { enabled: true, image: '', webUrl: '', sceneKey: '', sceneRendererUrl: 'http://example.com/x/' })
  ck('A5a', baseOf() === DEF, '非回环 sceneRendererUrl ⇒ rendererBase 回落默认=' + baseOf())
  {
    const g = (() => { try { return globalThis.__mpwSceneTest.urlGuard() } catch (e) { return null } })()
    ck('A5b', !!g && g.rejected >= 1, 'urlGuard 拒绝记账 rejected=' + (g ? g.rejected : 'null'))
  }

  /* == A6 hint 行在且含生效地址 == */
  {
    const hint = findNode(tree1, (p) => p && p['data-mpw-rd-src-hint'] !== undefined)
    const kidsText = hint ? (function walk(n) { let out = ''; if (typeof n === 'string') out += n; else if (Array.isArray(n)) n.forEach((x) => { out += walk(x) }); else if (n && n.kids) n.kids.forEach((x) => { out += walk(x) }); return out })(hint.kids) : ''
    ck('A6', !!hint && kidsText.length > 0 && kidsText.indexOf(DEF) >= 0, 'hint 含生效地址=' + kidsText.slice(0, 60))
  }

  return red
}

/* ---------- 变异自证（隔离副本；R2 生效断言） ---------- */
const src0 = fs.readFileSync(REAL_CLIENT, 'utf8')
const mkTmp = (pfx) => fs.mkdtempSync(path.join(os.tmpdir(), pfx))

async function withMutant(id, what, pairs, expectRed) {
  const dir = mkTmp('mpw-z11-mut-')
  const f = path.join(dir, 'client.js')
  let mutated = src0
  const applied = []
  for (const [anchor, replacement] of pairs) {
    const n = mutated.split(anchor).length - 1
    const next = mutated.replace(anchor, replacement)
    const okApply = n === 1 && next !== mutated && !next.includes(anchor)
    applied.push(okApply)
    mutated = next
  }
  fs.writeFileSync(f, mutated)
  let red = []
  try { red = await runSuite(f) } catch (e) { red = ['THROW:' + String(e && e.message || e).slice(0, 60)] }
  const eq = applied.every(Boolean) && JSON.stringify(red.slice().sort()) === JSON.stringify(expectRed.slice().sort())
  console.log('  ' + (eq ? 'MUTANT-RED-OK' : 'MUTANT-MISMATCH') + ' ' + id + '  ' + what)
  console.log('    期望红集=' + JSON.stringify(expectRed.slice().sort()) + ' 实际红集=' + JSON.stringify(red.slice().sort()) + ' 变异生效=' + JSON.stringify(applied))
  if (eq) pass++; else fail++
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
}

console.log('== 真树断言（' + path.basename(REAL_CLIENT) + '）==')
const redReal = await runSuite(REAL_CLIENT)
for (const id of redReal) fail++
if (redReal.length === 0) { pass++; console.log('  真树零红 ✓') } else { console.log('  真树红集: ' + JSON.stringify(redReal)); fail++ }

console.log('\n== 变异自证（隔离副本）==')
/* M1 active 派生颠倒（空 ≠ 内置；= 原仓库 ≠ 原仓库态）⇒ 默认/原仓库两态的 active 都错 */
await withMutant('M1', 'active 派生颠倒（默认值语义破坏）',
  [['const srcActive = !mpwRdSrcVal ? "builtin" : (mpwRdSrcVal === MPW_SCENE_REPO_RENDERER_BASE ? "repo" : "custom");',
    'const srcActive = (mpwRdSrcVal === MPW_SCENE_REPO_RENDERER_BASE) ? "builtin" : (!mpwRdSrcVal ? "repo" : "custom");']],
  ['A1a', 'A2c', 'A3a'])
/* M2 切换只改 UI 不写档（repo 按钮去掉 commit）⇒ A2 红 */
await withMutant('M2', '原仓库切换不写档',
  [['commit({ sceneRendererUrl: url }, true);', 'setHint(t("rdx.srcApplied"));']],
  ['A2a', 'A2b', 'A2c', 'A3b', 'A3c'])
/* M3 绕过 URL 闸门（mpwSceneRendererBase 放行任意 raw）⇒ A5 红（非回环不再回落） */
await withMutant('M3', 'mpwSceneRendererBase 绕过守卫放行任意目标',
  [['if (g.ok) return raw;', 'return raw;']],
  ['A5a'])

console.log('\n===== ' + pass + ' 通过 / ' + fail + ' 失败 =====')
process.exit(fail ? 1 : 0)
