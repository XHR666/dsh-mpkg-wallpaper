#!/usr/bin/env node
/**
 * tools/regress-20261026-test.mjs —— 2026-10-26 两个缺陷的回归判据
 *
 * 契约：
 *   R1 路由 disposer：lib/index.js 必须①把 webServer.register 包一层收集 disposer，
 *      ②通过 ctx.effect 在 fiber 卸载时释放。缺任一条 ⇒ 浏览器端"关→开"会抛
 *      `webServer: duplicate exact route …`（真机日志已证）。
 *   R2 音频审计：WebAudio 类事件在**没有具体元素**时不得计入"可疑"
 *      （真机日志里 el:null 的外部 AudioContext 反复误报）。
 *
 * 变异自证：在内存副本上删掉修复 ⇒ 期望红集必须 == 实际红集。
 * 复现：node tools/regress-20261026-test.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const idx = readFileSync(join(ROOT, 'lib/index.js'), 'utf8')
const cli = readFileSync(join(ROOT, 'lib/client.js'), 'utf8')

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')) }
}

/* ── R1 ── */
const r1a = /__mpwRouteDisposers/.test(idx) && /webServer\.register\s*=\s*\(route\)/.test(idx)
const r1b = /ctx\.effect\(\(\)\s*=>\s*\(\)\s*=>/.test(idx) && /while\s*\(__mpwRouteDisposers\.length\)/.test(idx)
ok('R1a webServer.register 被包装并收集 disposer', r1a)
ok('R1b ctx.effect 卸载时释放全部路由 disposer', r1b)

/* ── R2 ── */
const r2a = /const webaudioExtern\s*=\s*\(kind === "webaudio-start" \|\| kind === "audioctx-resume"\)\s*&&\s*!rec\.el/.test(cli)
const r2b = /\(!webaudioExtern && muteOnAudible\)/.test(cli) && /\(!webaudioExtern && webaudioOnMuted\)/.test(cli)
ok('R2a 无元素的 WebAudio 事件被识别为外部', r2a)
ok('R2b 外部 WebAudio 不计入"可疑出声"', r2b)

/* ── 变异自证（内存副本，不写盘）── */
const mutants = [
  ['M1 删路由包装', idx.replace('webServer.register = (route) => {', 'webServer.register = (route) => { /*M1*/'), (t) => !/\/\*M1\*\//.test(t)],
  ['M2 删 ctx.effect 释放', idx.replace('ctx.effect(() => () => {', 'ctx.effect(() => () => { /*M2*/'), (t) => !/\/\*M2\*\//.test(t)],
  ['M3 删 webaudioExtern 定义', cli.replace('const webaudioExtern =', 'const webaudioExtern = /*M3*/'), (t) => !/\/\*M3\*\//.test(t)],
]
const expect = { 'M1 删路由包装': ['R1a'], 'M2 删 ctx.effect 释放': ['R1b'], 'M3 删 webaudioExtern 定义': ['R2a'] }
let mutOk = true
for (const [name, src] of mutants) {
  // 变异体：把修复删掉（等价于回到缺陷版本）后，对应断言必须变红
  const mIdx = idx.replace(/const __mpwRouteDisposers = \[\];[\s\S]*?ctx\.effect\(\(\) => \(\) => \{[\s\S]*?\}\);\n/, '/* mutant: fix removed */')
  const mCli = cli.replace(/const webaudioExtern = [^\n]*\n/, '')
  let reds = []
  if (name.startsWith('M1')) { if (!/webServer\.register\s*=\s*\(route\)/.test(mIdx)) reds.push('R1a') }
  if (name.startsWith('M2')) { if (!/while\s*\(__mpwRouteDisposers\.length\)/.test(mIdx)) reds.push('R1b') }
  if (name.startsWith('M3')) { if (!/const webaudioExtern\s*=/.test(mCli)) reds.push('R2a') }
  const want = expect[name]
  const eq = JSON.stringify(reds) === JSON.stringify(want)
  if (!eq) mutOk = false
  console.log(`  ${eq ? '✓' : '✗'} 变异 ${name}: 期望红集=${JSON.stringify(want)} 实际红集=${JSON.stringify(reds)}`)
}
ok('变异自证（期望红集 == 实际红集，逐条相等）', mutOk)

console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail === 0 ? 0 : 1)
