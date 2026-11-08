// tools/wallpaper-fail-identity-test.mjs — Z12（2026-11-08）壁纸加载失败身份保真判据
//
// 现场：壁纸加载失败时，设置「当前壁纸」区显示 类型=Image、名称/内部/预览全无。
// 根因（改前读数，基线 0a2e4b9 探针 /tmp 探针定案）：
//   ① UI 回退 `ext || (section.image ? "image" : "")`：半残/失败档只剩 **host token**
//     （视频/场景的帧地址，带 token/ltoken/folder 参数）时，类型被兜底显示成 "image" ——
//     把没加载出来的视频/场景伪装成"图片壁纸"（误导）。
//   ② 失败态没有面板内提示：底部有错误黑条（mpwBgArmErrorSet），面板「当前壁纸」区毫无表示。
//   ③ 数据层：失败路径本身不清身份（mpwBgArmErrorSet 只藏层+提示）；半残档由既有自愈链
//     处理（token 反推 key → mpwDeriveSourceFromKey/backup 恢复；推不出则明确提示）——
//     墓碑+身份并存的作废逻辑（task-22）也在 —— 本判据把它们全部**钉住**（防回归）。
//
// 修复：① token image 不再兜底成 "image"（真图片 data:/直链照旧）；② 失败态（与黑条同源
// window.__mpwBgArmError）在面板显示「加载失败（源不可用）」+ 类型未知显示 "—" +
// 预览错误占位 "!"；③ 名称/内部按已知身份渲染（不变）。
//
// 三场景（任务书 §2 Z12-1）：A=token-only 半残档刷新；B=墓碑+身份并存（task-22 反例）；
// C=验活失败（mpwBgArmErrorSet 路径，经 __mpwArmNoteProbe 驱动生产实现）。
// 变异（隔离副本，R2 生效断言 + 期望红集==实际红集）：
//   M1 UI 回退改回旧写法 ⇒ A4/C3b/C4 红；M2 失败路径清身份（append 型）⇒ C2 红；
//   M3 墓碑吞身份（task-22 回退）⇒ B1/B3 红（2026-11-08 审查 P2-1：头注释与代码期望红集对齐）。
//
// 用法: node tools/wallpaper-fail-identity-test.mjs [--client <path>]

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const TOKEN_IMG = 'http://127.0.0.1:3080/api/mpkg-wallpaper/raw?custom=1&folder=dd&file=SomeWall.mp4&token=SomeWall.mp4'
const HALF = { enabled: true, image: TOKEN_IMG, converted: '', mpkgKey: '', mpkgName: '', source: '', webUrl: '', sceneKey: '' }
const TOMB = { enabled: true, image: TOKEN_IMG, converted: 'mp4', mpkgKey: 'custommpkg|dd/SomeWall.mp4', mpkgName: 'SomeWall', source: 'SomeWall.mp4', webUrl: '', sceneKey: '', __mpwSrcClearedAt: 1700000000000 }
const REAL_IMG = { enabled: true, image: 'data:image/png;base64,iVBORw0KGgo=', converted: 'image', mpkgKey: '', mpkgName: 'pic.png', source: 'pic.png', webUrl: '', sceneKey: '' }

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
/* 收集子树全部文本（桩 vdom 是 {props,kids} 树；字符串即文本） */
function textOf(n) {
  let out = ''
  const walk = (x) => {
    if (x == null) return
    if (typeof x === 'string') { out += x; return }
    if (typeof x === 'number') { out += String(x); return }
    if (Array.isArray(x)) { x.forEach(walk); return }
    if (x.kids) x.kids.forEach(walk)
  }
  walk(n)
  return out
}

function makeWorld(clientPath, settings, fetchImpl) {
  for (const k of Object.keys(globalThis)) if (/^__mpw/.test(k)) { try { delete globalThis[k] } catch {} }
  const ls = { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null }, setItem(k, v) { this._m.set(k, String(v)) }, removeItem(k) { this._m.delete(k) } }
  const r = loadPlugin({ clientPath, quiet: true, localStorage: ls, settings, fetch: fetchImpl, ctxDecorate: (ctx) => { ctx.theme = { overrideTokens: () => ({ dispose() {} }) } } })
  if (r.applyErrors.length) throw new Error('apply 报错: ' + r.applyErrors[0])
  const zh = r.localeDicts.zh
  const t = (k) => (zh[k] !== undefined ? zh[k] : k)
  const render = () => { try { return r.sectionComp({ t, close: () => {} }) } catch (e) { return { __crash: String(e && e.message || e) } } }
  return { r, ls, t, render }
}
const secOf = () => { try { return globalThis.__mpwPersist.read() || {} } catch (e) { return {} } }
const lsRaw = (w) => { try { return JSON.parse(w.ls.getItem('dsh.mpkg-wallpaper.v2')) || {} } catch (e) { return {} } }

/* ---------- 断言套件 ---------- */
async function runSuite(clientPath) {
  const red = []
  const ck = (id, cond, detail) => {
    console.log('  ' + (cond ? '✓ ' : '✗ ') + id + (detail ? '  [' + detail + ']' : ''))
    if (!cond) red.push(id)
  }

  /* ══ A 组：场景 A —— token-only 半残档：自愈链跑 + 身份不被吞 + UI 不显示伪 image ══ */
  let wA = null
  try { wA = makeWorld(clientPath, HALF) } catch (e) { ck('A0', false, String(e.message || e)); return red }
  await sleep(90)   // heal 同步段 + derive 异步段
  const st = (() => { try { return globalThis.__mpwHealProbe.stats() } catch (e) { return { err: 'no-probe' } } })()
  ck('A1', (st.attempted || 0) >= 1 && st.last && String(st.last.key || '').indexOf('custommpkg|SomeWall.mp4') === 0,
    '自愈链已跑 attempted=' + st.attempted + ' lastKey=' + (st.last && st.last.key))
  const sA = secOf()
  ck('A2', String(sA.image || '').indexOf('token=SomeWall.mp4') >= 0,
    'image（身份线索）保住=' + JSON.stringify(String(sA.image || '').slice(0, 50)))
  /* 派生是异步链（fetch 后微任务）⇒ 轮询等它落定（上限 ~900ms），拿到"明确提示/恢复"任一即可。 */
  let noticeA = ''
  for (let i = 0; i < 18 && !noticeA; i++) {
    await sleep(50)
    const st2 = (() => { try { return globalThis.__mpwHealProbe.stats() } catch (e) { return {} } })()
    if (st2.last && st2.last.ok === true) { noticeA = '__HEALED__'; break }
    noticeA = (() => { try { return String(globalThis.__mpwPersist.takeNoticePending() || '') } catch (e) { return '' } })()
  }
  ck('A3', noticeA.indexOf('推不出') >= 0 || noticeA.indexOf('已从本地备份') >= 0 || noticeA === '__HEALED__',
    '自愈结果明确提示/恢复（不静默）=' + JSON.stringify(noticeA.slice(0, 60)))
  {
    const tree = wA.render()
    if (tree.__crash) { ck('A4', false, tree.__crash); return red }
    const typeNode = findNode(tree, (p) => p && p['data-mpw-wall-type'] === '1')
    const typeText = typeNode ? textOf(typeNode) : ''
    ck('A4', !!typeNode && typeText.indexOf('image') < 0, '类型行不显示伪 image=' + JSON.stringify(typeText))
    ck('A5', !findNode(tree, (p) => p && p['data-mpw-wall-error'] === '1'), '无 arm error 时无失败状态行（两态可判别）')
    /* A6（2026-11-08 review 补漏）：token-only 半残档的 image token 就是可信文件名线索
       ⇒ 名称/内部不能显示"无"（旧 UI 的"名称/内部/预览全无"现场）。只断言显示名，
       不据此猜类型（类型仍由 A4 钉"不显示伪 image"）。 */
    const nameNode = findNode(tree, (p) => p && p.title && String(p.title).indexOf('SomeWall.mp4') >= 0)
    ck('A6', !!nameNode, 'token-only 残档显示名来自 token=' + JSON.stringify(nameNode ? nameNode.title : null))
  }

  /* ══ B 组：场景 B —— 墓碑 + 身份并存（task-22 反例）：身份不被吞、墓碑作废 ══ */
  /* 宿主 /settings GET 应答空档（真机：宿主合并会让 reconcile 跑起来 ⇒ 墓碑作废 + 两处回写）。
     其余请求照旧 404（不喂派生元数据，保持"无宿主元数据"口径）。 */
  const hostSettingsFetch = async (url, o) => {
    const u = String(url)
    if (u.indexOf('/settings') >= 0 && !(o && o.method === 'PUT') && !(o && o.body)) {
      return { ok: true, status: 200, json: async () => ({ settings: {} }), text: async () => '' }
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) }
  }
  let wB = null
  try { wB = makeWorld(clientPath, TOMB, hostSettingsFetch) } catch (e) { ck('B0', false, String(e.message || e)); return red }
  await sleep(60)
  const sB = secOf()
  ck('B1', sB.mpkgKey === 'custommpkg|dd/SomeWall.mp4' && sB.mpkgName === 'SomeWall' && sB.source === 'SomeWall.mp4' && sB.converted === 'mp4',
    '身份四字段全保 key=' + JSON.stringify(sB.mpkgKey) + ' name=' + JSON.stringify(sB.mpkgName) + ' src=' + JSON.stringify(sB.source) + ' conv=' + JSON.stringify(sB.converted))
  ck('B2', secOf().__mpwSrcClearedAt === undefined, '墓碑被作废（合并档无 __mpwSrcClearedAt）=' + JSON.stringify(secOf().__mpwSrcClearedAt ?? null))
  /* 残留存储"就地修好"：下一次任意写（writeSection 的墓碑自动作废）后 ls 也不再带墓碑。 */
  try { globalThis.__mpwSectionTest.write({ opacity: 80 }) } catch (e) {}
  await sleep(30)
  ck('B2b', lsRaw(wB).__mpwSrcClearedAt === undefined, '一次写后存档无墓碑（就地修好）=' + JSON.stringify(lsRaw(wB).__mpwSrcClearedAt ?? null))
  {
    const tree = wB.render()
    const typeNode = findNode(tree, (p) => p && p['data-mpw-wall-type'] === '1')
    const typeText = typeNode ? textOf(typeNode) : ''
    ck('B3', typeText.indexOf('mp4') >= 0, '身份齐全时类型正常显示=' + JSON.stringify(typeText))
  }

  /* ══ C 组：场景 C —— 验活失败（arm error）：身份不清 + 面板失败态 + 恢复半场 ══ */
  let wC = null
  try { wC = makeWorld(clientPath, HALF) } catch (e) { ck('C0', false, String(e.message || e)); return red }
  await sleep(40)
  const arm = globalThis.__mpwArmNoteProbe
  if (!arm || typeof arm.set !== 'function') { ck('C0', false, '缺 __mpwArmNoteProbe'); return red }
  const setC = arm.set('image', TOKEN_IMG, 404, 'host returned ok:false')
  const errC = (() => { try { return arm.errState() } catch (e) { return null } })()
  ck('C1', setC && errC && errC.status === 404, '失败态已置（黑条同源）=' + JSON.stringify(errC))
  const sC1 = secOf()
  ck('C2', String(sC1.image || '').indexOf('token=SomeWall.mp4') >= 0,
    '失败路径不清身份（image 线索在）=' + JSON.stringify(String(sC1.image || '').slice(0, 40)))
  {
    const tree = wC.render()
    const errNode = findNode(tree, (p) => p && p['data-mpw-wall-error'] === '1')
    const errText = errNode ? textOf(errNode) : ''
    ck('C3a', !!errNode && errText.indexOf('加载失败') >= 0, '失败状态行在=' + JSON.stringify(errText.slice(0, 40)))
    const typeNode = findNode(tree, (p) => p && p['data-mpw-wall-type'] === '1')
    const typeText = typeNode ? textOf(typeNode) : ''
    ck('C3b', typeText.indexOf('image') < 0, '失败态类型行不显示伪 image=' + JSON.stringify(typeText))
    const thumbBox = findNode(tree, (p) => p && p['data-mpw-thumb-box'] !== undefined)
    const phText = thumbBox ? textOf(thumbBox) : ''
    ck('C4', phText.indexOf('!') >= 0, '预览错误占位（非空白）=' + JSON.stringify(phText.slice(0, 20)))
  }
  /* 恢复半场：mpwBgArmErrorClear（生产入口）⇒ 面板失败态退场 */
  const cleared = arm.clear()
  const errAfter = (() => { try { return arm.errState() } catch (e) { return 'ERR' } })()
  ck('C5', cleared === true && errAfter === null, '恢复后 errState=' + JSON.stringify(errAfter))
  {
    const tree = wC.render()
    ck('C6', !findNode(tree, (p) => p && p['data-mpw-wall-error'] === '1'), '恢复后失败状态行退场')
  }

  /* ══ D 组：真图片壁纸对照 —— 正常档显示不被收没（防"修过头"）══ */
  {
    const wD = makeWorld(clientPath, REAL_IMG)
    await sleep(30)
    const tree = wD.render()
    const typeNode = findNode(tree, (p) => p && p['data-mpw-wall-type'] === '1')
    const typeText = typeNode ? textOf(typeNode) : ''
    /* source='pic.png' ⇒ 按扩展名显示 png（比 image 更精确，既有行为）；不是误导性的 token-image。 */
    ck('D1', typeText.indexOf('png') >= 0, '真图片档按扩展名显示=' + JSON.stringify(typeText))
    ck('D2', !findNode(tree, (p) => p && p['data-mpw-wall-error'] === '1'), '正常档无失败状态行')
  }
  {
    /* data: 真图片、无扩展名来源 ⇒ 兜底 "image" 保留（真图片 ≠ token，两态可判别）。 */
    const wD2 = makeWorld(clientPath, Object.assign({}, REAL_IMG, { source: '', mpkgName: '', converted: '' }))
    await sleep(30)
    const tree = wD2.render()
    const typeNode = findNode(tree, (p) => p && p['data-mpw-wall-type'] === '1')
    const typeText = typeNode ? textOf(typeNode) : ''
    ck('D1b', typeText.indexOf('image') >= 0, 'data 真图片兜底 image 保留=' + JSON.stringify(typeText))
  }

  return red
}

/* ---------- 变异自证（隔离副本；R2 生效断言） ---------- */
const src0 = fs.readFileSync(REAL_CLIENT, 'utf8')
const mkTmp = (pfx) => fs.mkdtempSync(path.join(os.tmpdir(), pfx))

async function withMutant(id, what, pairs, expectRed) {
  const dir = mkTmp('mpw-z12-mut-')
  const f = path.join(dir, 'client.js')
  let mutated = src0
  const applied = []
  for (const [anchor, replacement, keepAnchor] of pairs) {
    const n = mutated.split(anchor).length - 1
    const next = mutated.replace(anchor, replacement)
    /* R2 生效断言：替换型 ⇒ 旧串不再存在；append 型（keepAnchor）⇒ 锚点保留且替换串有新增内容。 */
    const okApply = n === 1 && next !== mutated && (keepAnchor
      ? (next.includes(anchor) && replacement.length > anchor.length && mutated.split(replacement).length - 1 === 0)
      : !next.includes(anchor))
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
/* M1 UI 回退改回旧写法（token 也兜底成 image）⇒ A4/C3b 红 */
await withMutant('M1', 'typeStr 回退改回旧写法（token 兜底成 image）',
  [['						if (ext === "mpkg" || ext === "pkg") return "scene";\n\t\t\t\t\t\t\tif (ext) return ext;\n\t\t\t\t\t\t\tif (imgIsToken) return "";\n\t\t\t\t\t\t\treturn section.image ? "image" : "";',
    '						if (ext === "mpkg" || ext === "pkg") return "scene";\n\t\t\t\t\t\t\treturn ext || (section.image ? "image" : "");']],
  ['A4', 'C3b', 'C4'])
/* M2 失败路径清身份（坏实现注入 mpwBgArmErrorSet）⇒ C2 红 */
await withMutant('M2', '失败路径清身份（坏实现）',
  [['function mpwBgArmErrorSet(kind, url, status, detail) {\n\t\t\ttry {',
    'function mpwBgArmErrorSet(kind, url, status, detail) {\n\t\t\ttry { try { const wipe = {}; for (const k of MPW_WALLPAPER_ID_KEYS) wipe[k] = null; writeSection(Object.assign({}, readSection(), wipe), true) } catch (e) {}', true]],
  ['C2'])
/* M3 墓碑吞身份（task-22 回退）⇒ B1/B2 红 */
await withMutant('M3', '墓碑+身份并存时吞身份（task-22 回退）',
  [['if (mpwHasAnyWallpaperIdentity(clearStore)) {',
    'if (false) {']],
  ['B1', 'B3'])

console.log('\n===== ' + pass + ' 通过 / ' + fail + ' 失败 =====')
process.exit(fail ? 1 : 0)
