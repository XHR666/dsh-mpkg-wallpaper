// tools/mobile-shell-adapt-test.mjs — Z13（2026-11-08）DSH Mobile 移动外壳适配 + 远程慢链路分流判据
//
// 事实依据（Lead 只读探针 + 本轮复核）：
//   · dsh-mobile 0.8.3（profile 内 lib/client.js 45 处命中）注入 html.dsh-native-mobile-active
//     根标记 + [data-dsh-mobile-sidebar(-root)] 外壳 DOM；
//   · 本插件 client.js 在手机 WebView 里同样运行，基线对移动外壳 0 处理；
//   · 有壁纸时 applyTokenOverrides 把宿主 --dsw-alias-bg-layer-1/2 全局改半透明 ⇒ 移动抽屉透字
//     （归因假设，真机 A/B 待验——无手机通道，见报告"未验"）。
// 修复（桌面行为逐字不变，门控严格）：
//   ① mpwMobileShellActive/Sync（html 标记 ∨ 外壳 DOM ∨ 移动UA+窄视口）⇒ body[data-mpw-mobile-shell]；
//   ② 仅移动外壳在场时把 [data-dsh-mobile-sidebar-root] 打成 l1（消费既有 hasImage 门控的
//      l1 实底规则 = 宿主主题面）；桌面/无标记 ⇒ 不打（反向断言）；
//   ③ 移动端壁纸 blur 封顶 12px（按需减弱不关闭）；桌面逐字不变；
//   ④ 远程慢链路（非回环 origin ∨ 移动外壳）：首帧看门狗 15s 步进 + 60s 总预算（有渲染器
//      心跳续等；头 30s 不需证据）——回环/桌面 8s 一步判死逐字不变；holdFallback 对
//      strict-fail + 慢链路追加"网络较慢，继续等待"提示（加载中语义，不误报失败）。
//
// 变异（隔离副本，R2 生效断言 + 期望红集==实际红集）：
//   M1 删移动门控 ⇒ M组红；M2 移动补偿（l1 标记）删除 ⇒ S组红；M3 分流应用到回环 ⇒ W组红。
//
// 用法: node tools/mobile-shell-adapt-test.mjs [--client <path>]

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

const REAL_LOCATION = globalThis.location
const REAL_UA = (globalThis.navigator && globalThis.navigator.userAgent) || ''
function setEnvUA(ua) { try { Object.defineProperty(globalThis, 'navigator', { value: { userAgent: ua, language: 'zh-CN' }, configurable: true }) } catch (e) {} }
function setEnvLocation(hostname) {
  globalThis.location = hostname
    ? { href: 'https://' + hostname + '/', hostname, origin: 'https://' + hostname, search: '', hash: '' }
    : REAL_LOCATION
}

function makeWorld(clientPath, settings) {
  for (const k of Object.keys(globalThis)) if (/^__mpw/.test(k)) { try { delete globalThis[k] } catch {} }
  const ls = { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null }, setItem(k, v) { this._m.set(k, String(v)) }, removeItem(k) { this._m.delete(k) } }
  const r = loadPlugin({ clientPath, quiet: true, localStorage: ls, settings, ctxDecorate: (ctx) => { ctx.theme = { overrideTokens: () => ({ dispose() {} }) } } })
  if (r.applyErrors.length) throw new Error('apply 报错: ' + r.applyErrors[0])
  return r
}
const resetEnv = () => { setEnvUA(REAL_UA); setEnvLocation(null); try { globalThis.document.documentElement.className = '' } catch (e) {} }

/* ---------- 断言套件 ---------- */
async function runSuite(clientPath) {
  const red = []
  const ck = (id, cond, detail) => {
    console.log('  ' + (cond ? '✓ ' : '✗ ') + id + (detail ? '  [' + detail + ']' : ''))
    if (!cond) red.push(id)
  }
  let probe = null
  try {
    makeWorld(clientPath, { enabled: true, image: '', webUrl: '', sceneKey: '' })
    await sleep(30)
    probe = globalThis.__mpwMobileProbe
  } catch (e) { ck('B0', false, String(e.message || e)); return red }
  if (!probe || typeof probe.active !== 'function') { ck('B0', false, '缺 __mpwMobileProbe'); return red }

  /* == M 组：移动门控（①）== */
  resetEnv()
  ck('M1a', probe.active() === false && probe.marked() === false, '桌面桩（无标记/桌面UA）⇒ active=false marked=false')
  globalThis.document.documentElement.className = 'dsh-native-mobile-active'
  ck('M1b', probe.active() === true && probe.sync() === true && probe.marked() === true, 'html 标记 ⇒ active/sync/mark 全真')
  resetEnv()
  const sbEl = globalThis.document.createElement('div')
  sbEl.setAttribute('data-dsh-mobile-sidebar', '')
  globalThis.document.body.appendChild(sbEl)
  const qsOrig = globalThis.document.querySelector
  globalThis.document.querySelector = (sel) => (sel === '[data-dsh-mobile-sidebar]' ? sbEl : qsOrig.call(globalThis.document, sel))
  ck('M1c', probe.active() === true, '[data-dsh-mobile-sidebar] 在 ⇒ active=true')
  globalThis.document.querySelector = qsOrig
  sbEl.remove()
  resetEnv()
  setEnvUA('Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 Chrome/138 Mobile Safari/537.36')
  globalThis.innerWidth = 390
  ck('M1d', probe.active() === true, '移动UA+窄视口 ⇒ active=true')
  setEnvUA('Mozilla/5.0 (X11; Linux x86_64) Firefox/159.0')
  ck('M1e', probe.active() === false, '桌面UA+同视口 ⇒ active=false（窄窗不误伤）')
  setEnvUA('Mozilla/5.0 (Linux; Android 14; Mobile) Chrome/138 Mobile')
  globalThis.innerWidth = 1280
  ck('M1f', probe.active() === false, '移动UA+宽视口 ⇒ active=false（保守组合）')
  globalThis.innerWidth = undefined
  resetEnv()

  /* == S 组：移动补偿（②）—— l1 标记只在移动门控在时打；桌面 DOM 逐字不变 ==
     桩 document.querySelectorAll 恒空（_stub 既有口径）⇒ 按 market-op-panel-test 同款：
     临时替 patch 前的 querySelectorAll 指到登记节点，调 __mpwPopUntruncTest.solidSync 驱动生产实现。 */
  {
    const solidSync = (globalThis.__mpwPopUntruncTest && globalThis.__mpwPopUntruncTest.solidSync) || null
    ck('S0', typeof solidSync === 'function', 'solidSync 入口可用=' + typeof solidSync)
    const sideRoot = globalThis.document.createElement('div')
    sideRoot.setAttribute('data-dsh-mobile-sidebar-root', '')
    globalThis.document.body.appendChild(sideRoot)
    const qsaOrig = globalThis.document.querySelectorAll
    globalThis.document.querySelectorAll = (sel) => (sel === '[data-dsh-mobile-sidebar-root]' ? [sideRoot] : qsaOrig.call(globalThis.document, sel))
    globalThis.document.documentElement.className = 'dsh-native-mobile-active'
    probe.sync()
    if (typeof solidSync === 'function') solidSync()
    ck('S1', sideRoot.getAttribute('data-mpw-solid-surface') === 'l1', '移动门控下 sidebar-root 打 l1=' + JSON.stringify(sideRoot.getAttribute('data-mpw-solid-surface')))
    resetEnv()
    probe.sync()
    if (typeof solidSync === 'function') solidSync()
    ck('S2', !sideRoot.getAttribute('data-mpw-solid-surface'), '无移动门控 ⇒ 撤标（防残留）=' + JSON.stringify(sideRoot.getAttribute('data-mpw-solid-surface')))
    globalThis.document.querySelectorAll = qsaOrig
    sideRoot.remove()
  }
  /* S3: 有壁纸产物里 l1 实底规则在（标记的消费者），无壁纸不在（Z15 既有门控） */
  {
    const cssWall = String(globalThis.__mpwBuildCss({ enabled: true, image: 'data:image/png;base64,iVBORw0KGgo=' }) || '')
    const cssNo = String(globalThis.__mpwBuildCss({ enabled: true, image: '', webUrl: '' }) || '')
    ck('S3', /data-mpw-solid-surface="l1"/.test(cssWall.replace(/\/\*[\s\S]*?\*\//g, '')) && !/data-mpw-solid-surface="l1"/.test(cssNo.replace(/\/\*[\s\S]*?\*\//g, '')),
      'l1 规则：有壁纸在 / 无壁纸不在（消费面双向）')
    /* S4（2026-11-08 review 补强）：真实背景层是外层 [data-dsh-mobile-sidebar]（sidebarCol），
       只标内层 root 仍会看到外层半透明 ⇒ 移动门控实底 CSS 必须同时覆盖外层/内层/::before；
       无壁纸不输出（保持宿主默认）。 */
    const cssWallNoC = cssWall.replace(/\/\*[\s\S]*?\*\//g, '')
    const cssNoNoC = cssNo.replace(/\/\*[\s\S]*?\*\//g, '')
    ck('S4', /data-mpw-mobile-shell\] \[data-dsh-mobile-sidebar\]/.test(cssWallNoC)
      && /--mpw-surface-mobile-sidebar/.test(cssWallNoC)
      && /--mpw-surface-mobile-sidebar:/.test(cssWallNoC)
      && /data-dsh-mobile-sidebar-root/.test(cssWallNoC)
      && /::before/.test(cssWallNoC)
      && !/data-mpw-mobile-shell/.test(cssNoNoC),
      '移动实底 CSS：外层/内层/::before 齐（有壁纸）且无壁纸不输出')
  }

  /* == W 组：远程慢链路分流（③）== */
  resetEnv()
  setEnvLocation('127.0.0.1')
  ck('W1a', probe.slowLink() === false, '回环 origin ⇒ slowLink=false')
  {
    const b = probe.wdBudget(false)
    ck('W1b', b.budget === 8000 && b.step === 0 && b.remote === false, '回环预算=8s 一步判死（既有口径逐字不变）' + JSON.stringify(b))
  }
  setEnvLocation('wallpaper-dsh.example.com')
  ck('W2a', probe.slowLink() === true, '非回环 origin（Cloudflare 隧道）⇒ slowLink=true')
  {
    const b = probe.wdBudget(true)
    ck('W2b', b.budget === 60000 && b.step === 15000 && b.remote === true, '远程预算=15s 步进/60s 总预算' + JSON.stringify(b))
  }
  setEnvLocation('127.0.0.1')
  globalThis.document.documentElement.className = 'dsh-native-mobile-active'
  ck('W2c', probe.slowLink() === true, '回环 + 移动外壳 ⇒ slowLink=true（移动分流）')
  resetEnv()
  /* W3: holdFallback 的慢链路提示分流（strict-fail + 慢链路 ⇒ 追加"网络较慢"；回环 ⇒ 无） */
  {
    const sb = globalThis.__mpwSandbox
    if (!sb || typeof sb.holdFallback !== 'function') { ck('W3', false, '缺 __mpwSandbox.holdFallback'); red.push('W3') } else {
      setEnvLocation('wallpaper-dsh.example.com')
      sb.sceneHintedReset()
      sb.holdFallback('strict-fail', 'ident-r', 'cap-no-first-frame', null)
      const n1 = globalThis.document.getElementById('mpw-sceneNote')
      const t1 = n1 ? String(n1.getAttribute('data-mpw-note-msg') || '') : ''
      ck('W3a', t1.indexOf('网络较慢') >= 0 && t1.indexOf('自动恢复动态') >= 0, '慢链路 strict-fail 提示含"网络较慢/自动恢复"=' + JSON.stringify(t1.slice(-40)))
      setEnvLocation('127.0.0.1')
      sb.sceneHintedReset()
      /* 回环 + 无移动外壳：提示不带慢链路话术（分流可判别）。
         ①(2026-11-08 审查返工 P1-1 R19) 清场改用**生产入口** __mpwSandbox.sceneNoteRemove
         （旧写法用桩 remove()：桩节点 parentElement/parentNode 在 removeChild 后残留 ⇒
         mpwBottomNoteEnsure 的复用判据误判"仍在树"返回离树节点 ⇒ byId 已注销 ⇒ n2 恒 null
         ⇒ 本断言读恒空串、对目标语义零判别力——审查 R1 变异实证"回环也塞话术 W3b 仍绿"）。
         新增前置断言 W3pre：n2 必须真实存在（null ⇒ 显式红），杜绝空转。 */
      sb.sceneNoteRemove()
      sb.holdFallback('strict-fail', 'ident-l', 'cap-no-first-frame', null)
      const n2 = globalThis.document.getElementById('mpw-sceneNote')
      const t2 = n2 ? String(n2.getAttribute('data-mpw-note-msg') || '') : ''
      ck('W3pre', !!n2, '回环 strict-fail 提示条必须真实在（前置，防空转）=' + !!n2)
      ck('W3b', !!n2 && t2.indexOf('网络较慢') < 0, '回环 strict-fail 无慢链路话术=' + JSON.stringify(t2.slice(-30)))
      if (n2 && n2.parentNode) { try { n2.parentNode.removeChild(n2) } catch (e) {} }
      resetEnv()
    }
  }

  return red
}

/* ---------- 变异自证（隔离副本；R2 生效断言） ---------- */
const src0 = fs.readFileSync(REAL_CLIENT, 'utf8')
const mkTmp = (pfx) => fs.mkdtempSync(path.join(os.tmpdir(), pfx))

async function withMutant(id, what, pairs, expectRed) {
  const dir = mkTmp('mpw-z13-mut-')
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
/* M1 删移动门控（sync 恒 false）⇒ 标记永不置 ⇒ M/S 组红 */
await withMutant('M1', '删移动门控（sync 恒 false）',
  [['				const on = mpwMobileShellActive();\n				if (on) { if (!document.body.hasAttribute("data-mpw-mobile-shell")) document.body.setAttribute("data-mpw-mobile-shell", "1") }',
    '				const on = false;\n				if (on) { if (!document.body.hasAttribute("data-mpw-mobile-shell")) document.body.setAttribute("data-mpw-mobile-shell", "1") }']],
  ['M1b', 'S1'])
/* M2 移动补偿删除（sync 里不打 sidebar-root 的 l1）⇒ S1 红（抽屉回退半透明）*/
await withMutant('M2', '移动补偿删除（sidebar-root 不打/不撤 l1）',
  [['				const mbSide = document.querySelectorAll("[data-dsh-mobile-sidebar-root]");\n				const mpwMobileOn = !!(document.body && document.body.hasAttribute("data-mpw-mobile-shell"));\n				for (let i = 0; i < mbSide.length; i++) {\n					const el = mbSide[i];\n					try {\n						if (mpwMobileOn) { if (el.getAttribute("data-mpw-solid-surface") !== "l1") el.setAttribute("data-mpw-solid-surface", "l1"); }\n						else if (el.getAttribute("data-mpw-solid-surface") === "l1") el.removeAttribute("data-mpw-solid-surface");\n					} catch (e) {}\n				}',
    '				const mbSide = document.querySelectorAll("[data-dsh-mobile-sidebar-root]");\n				for (let i = 0; i < mbSide.length; i++) { }']],
  ['S1'])
/* M2b 只删撤标分支：门控撤除后 l1 残留 ⇒ S2 红（对称性可判别） */
await withMutant('M2b', '移动补偿只剩打标、不撤标',
  [['						else if (el.getAttribute("data-mpw-solid-surface") === "l1") el.removeAttribute("data-mpw-solid-surface");\n',
    '						else ;\n']],
  ['S2'])

/* M4 删移动实底 CSS（buildCss 不拼 mpwMobileShellOpaqueCss）⇒ S4 红 */
await withMutant('M4', '删移动外壳实底 CSS 拼装',
  [[' + (hasImage ? mpwMobileShellOpaqueCss() : "")', '']],
  ['S4'])

/* M3 把远程分流应用到回环（预算恒 60s/15s）⇒ W1b/W1a 红（回环 8s 语义被破坏）*/
await withMutant('M3', '把远程分流应用到回环（预算恒 60s）',
  [['		function mpwSceneWdBudget(remote) {\n\t\t\treturn remote ? { budget: 60000, step: 15000, remote: true } : { budget: 8000, step: 0, remote: false };\n\t\t}',
    '		function mpwSceneWdBudget(remote) {\n\t\t\treturn { budget: 60000, step: 15000, remote: true };\n\t\t}']],
  ['W1b'])

console.log('\n===== ' + pass + ' 通过 / ' + fail + ' 失败 =====')
process.exit(fail ? 1 : 0)
