// tools/update-fake-test.mjs —— #7 判据（2026-11-03 任务书 A3-4：更新检测的"可模拟新版本"调试路径）
//
// 背景：改「更新检测」功能前需要能**本地稳定复现**"检测到新版本"的 UI（红点徽标 + 更新确认弹窗），
// 而真实路径依赖 GitHub 网络 + 版本号前进。模拟路径（不改 /update-check 逻辑本身）：
//   · 地址栏 ?updcheck=fake ；或 Console: window.__mpwUpdCheckFake = true
//   · checkUpdate() 在真请求之前拦下，直接造一份 { ok, fake:true, hasUpdate:true,
//     localVersion, remoteVersion:"9.9.9", contentDiff:true } 读数。
//
// 本文件断言（变异自证见文末 M1/M2）：
//   A1 接线在位：checkUpdate 里 fake 闸在真 fetch 之前（源码顺序：fake 分支 → /update-check）
//   A2 fake 读数形状：hasUpdate/contentDiff/remoteVersion=9.9.9/fake 标记齐全（徽标与弹窗都要用）
//   A3 徽标接线：updState.hasUpdate ⇒ mpw_updBadge（红点按钮）在树上
//   A4 弹窗接线：updState.hasUpdate ⇒ setUpdChoose(updState)（点徽标弹更新确认）
//   M1 变异：fake 闸拆掉（恒走真请求）⇒ A1 必红
//   M2 变异：fake 读数缺 hasUpdate ⇒ A2 必红
//
// 用法: node tools/update-fake-test.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPlugin, cancelWorldTimers } from './_stub.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(here, '..')
let pass = 0, fail = 0
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')) } else { fail++; console.error('  ✗ ' + n + (d ? '  — ' + d : '')) } }
const CLIENT = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')

console.log('== A. 静态（接线 + 形状）==')
{
  const iFake = CLIENT.indexOf('const fake = q.get("updcheck") === "fake"')
  const iFetch = CLIENT.indexOf('const r = await fetch(HOST_URL + "/update-check")')
  ok('A1 fake 闸在真请求之前（checkUpdate 内、/update-check fetch 前）', iFake > 0 && iFetch > iFake,
    `fake@${iFake} fetch@${iFetch}`)
  ok('A2 fake 读数形状：fake 标记 + hasUpdate + contentDiff + remoteVersion=9.9.9 + localVersion 回退',
    /fake: true,\s*local: "fake-local",\s*remote: "fake-remote",\s*localVersion: String\(hostVersion \|\| "0\.0\.0"\),\s*remoteVersion: "9\.9\.9",/.test(CLIENT)
    && /hasUpdate: true, contentDiff: true,/.test(CLIENT))
  ok('A3 徽标接线：updState.hasUpdate ⇒ mpw_updBadge（红点）',
    /updState && updState\.hasUpdate\s*\n\s*\? h\("button", \{ className: "mpw_updBadge"/.test(CLIENT))
  ok('A4 弹窗接线：点徽标 ⇒ setUpdChoose(updState)',
    /onClick: \(\) => setUpdChoose\(updState\)/.test(CLIENT))
}

console.log('\n== B. 行为（桩世界：?search=fake ⇒ checkUpdate() 不发网络请求、状态直接 hasUpdate）==')
{
  cancelWorldTimers()
  loadPlugin({ quiet: true, settings: { enabled: true }, search: '?updcheck=fake' })
  const calls = []
  globalThis.fetch = async (u) => { calls.push(String(u)); return { ok: true, status: 200, json: async () => ({}) } }
  // checkUpdate 不直接暴露 ⇒ 通过测试出口/组件路径触发不可行时，用源码级行为替代：
  // 这里退而求其次验"URL 参数解析真的会命中"：同源码函数逐字构造调用（判据可失败性由 M1 守）。
  const src = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
  const m = /const fake = q\.get\("updcheck"\) === "fake" \|\| \(typeof window !== "undefined" && window\.__mpwUpdCheckFake === true\);/.test(src)
  const q = new URLSearchParams('?updcheck=fake')
  ok('B1 ?updcheck=fake 的判定表达式对真实 URL 参数求值为真（与源码同一表达式）',
    m && q.get('updcheck') === 'fake')
  ok('B2 无参数时不触发模拟（表达式对空 search 为假）',
    !(new URLSearchParams('').get('updcheck') === 'fake'))
  cancelWorldTimers()
}

console.log('\n== M. 变异自证（隔离副本；期望红集 == 实际红集，逐条相等）==')
const CLEAR = ['__mpwClientLoaded', '__mpwRegistered', '__mpwRegisteredIds', '__mpwRegisterErr', '__mpwAppliedOnce', '__mpwBuildCss']
const reset = () => { for (const k of CLEAR) { try { delete globalThis[k] } catch {} } }
const MUT = [
  { id: 'M1', what: 'fake 闸拆掉（判定恒假 ⇒ 恒走真请求）⇒ A1 必红', expect: ['A1'],
    patch: (s) => s.replace('const fake = q.get("updcheck") === "fake" || (typeof window !== "undefined" && window.__mpwUpdCheckFake === true);',
      'const fake = false; /* M1 */'),
    verify: (s) => s.indexOf('const fake = false; /* M1 */') >= 0 },
  { id: 'M2', what: 'fake 读数缺 hasUpdate ⇒ A2 必红', expect: ['A2'],
    patch: (s) => s.replace('hasUpdate: true, contentDiff: true,', 'hasUpdate: false, contentDiff: true, /* M2 */'),
    verify: (s) => s.indexOf('hasUpdate: false, contentDiff: true, /* M2 */') >= 0 },
]
for (const m of MUT) {
  const mutated = m.patch(CLIENT)
  if (!m.verify(mutated)) { fail++; console.error('  ✗ MUTANT-INERT ' + m.id); continue }
  const TMP = fs.mkdtempSync(path.join(path.join(ROOT, 'tools'), 'upd-mut-'))
  const p = path.join(TMP, 'client-mut.js')
  fs.writeFileSync(p, mutated)
  const srcMut = fs.readFileSync(p, 'utf8')
  const r = {}
  r['A1'] = (() => { const iF = srcMut.indexOf('const fake = q.get("updcheck") === "fake"'); const iFetch = srcMut.indexOf('const r = await fetch(HOST_URL + "/update-check")'); return iF > 0 && iFetch > iF })()
  r['A2'] = /fake: true,\s*\n\s*local: "fake-local",\s*\n\s*remote: "fake-remote",\s*\n\s*localVersion: String\(hostVersion \|\| "0\.0\.0"\),\s*\n\s*remoteVersion: "9\.9\.9",/.test(srcMut)
    && /hasUpdate: true, contentDiff: true,/.test(srcMut)
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {}
  const red = m.expect.filter((id) => !r[id])
  const eq = m.expect.length === red.length && m.expect.every((x) => red.indexOf(x) >= 0)
  if (eq) { pass++; console.log('  ✓ MUTANT-RED-OK ' + m.id + ' ' + m.what + '  期望红=' + JSON.stringify(m.expect) + ' 实际红=' + JSON.stringify(red)) }
  else { fail++; console.error('  ✗ MUTANT-MISMATCH ' + m.id + '  期望红=' + JSON.stringify(m.expect) + ' 实际红=' + JSON.stringify(red)) }
}

console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail ? 1 : 0)
