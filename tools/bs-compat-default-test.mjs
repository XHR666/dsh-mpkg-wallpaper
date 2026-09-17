// tools/bs-compat-default-test.mjs —— 「dsh-better-sidebar 适配」总开关 bsCompat 的**默认值与存量迁移**回归
//
// 背景（用户裁定）：底部面板悬浮适配（圆角外壳 + 单层裁切 + 零边距 + strip 挪进面板）已真机定案，
//   而总开关 `bsCompat` 默认 `false` ⇒ **没人看得见**。裁定：默认改 **true**，并且
//   **只迁移"从没显式设过"的存量用户**，用户手动关过的**绝不覆盖**。
//
// 为什么需要 `bsCompatUserSet` 标记（而不是"看 bsCompat 是不是 false"）：
//   `commit()` 走的是 `writeSection(Object.assign({}, readSection(), patch))`（整段合并后落盘）
//   ⇒ **每次**保存都会把 `bsCompat` 一起写进去 ⇒ 光看值分不出"用户关的"和"旧默认带下来的"。
//
// 判定口径：`悬浮适配生效` = 产物里存在底部面板根规则且带 `border-radius: 14px`
//   （与 tools/better-sidebar-compat-test.mjs 的 F1 同口径）。
//
// 卫生：夹具走 mkdtemp，exit 兜底删除；每份 < 1MB；不写仓库内目录。
// 用法: node tools/bs-compat-default-test.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..')
const clientPath = path.join(repoRoot, 'lib', 'client.js')
/* 变异子进程：用被改坏的副本当被测实现；同时禁止再嵌套变异（防 fork 炸弹） */
const MUT_CLIENT = process.env.MPW_BS_MUT_CLIENT ? path.resolve(process.env.MPW_BS_MUT_CLIENT) : clientPath
const NO_MUT = process.argv.includes('--no-mutations') || !!process.env.MPW_BS_MUT_CLIENT

/* 真实断言助手（本仓教训：ok(name, detail) 恒真 = 假绿） */
let pass = 0, fail = 0
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')) }
  else { fail++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-bs-default-'))
let cleaned = false
const cleanup = () => { if (cleaned) return; cleaned = true; try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* 删不掉也不抛 */ } }
process.on('exit', cleanup)

const { loadPlugin } = await import('./_stub.mjs')
/* _stub 只能给 globalThis 打桩一次 ⇒ 重复装载前必须清掉它登记的模块标记（与 better-sidebar-compat-test 同法） */
const CLEAR = ['__mpwClientLoaded', '__mpwRegistered', '__mpwBsVerAt', '__mpwGlobalWired', '__mpwInlineWatcher', '__mpwStyleWatch', '__mpwBuildCss', '__mpwSectionTest']
const reset = () => { for (const k of CLEAR) { try { delete globalThis[k] } catch { /* 删不掉也不抛 */ } } }
const RULES = (css) => [...String(css).replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]])
/** ①「总开关生效」= 产物里有 bsCompat 作用域（[data-dsh-better-sidebar]）的规则 —— 这只由 bsCompat 决定 */
const BS_BLOCK = (css) => RULES(css).some(([sel]) => /\[data-dsh-better-sidebar\]/.test(sel))
/** ②「底部悬浮适配几何」= 面板根规则带 border-radius:14px —— 这需要 bsCompat **且** 子开关 bsFloat
 *  （与 tools/better-sidebar-compat-test.mjs 的 F1 同口径；因此这一层断言里 bsFloat 固定为 true，
 *   保证**唯一变量**是被测的 bsCompat）。 */
const ADOPTED = (css) => RULES(css).some(([sel, body]) => /\[data-dsh-bottom-panel\]|\[class\*="_bottomPanel"\]/.test(sel) && /border-radius\s*:\s*14px/.test(body))
/** 等落盘防抖（writeSection 的 localStorage 落盘是 ~1s 定时器；不等就会读到旧值 ⇒ 假红） */
const settle = () => new Promise((r) => setTimeout(r, 1300))
/** 以给定"存储里的设置"装载一次，返回产物 CSS（__mpwBuildCss 会合并 readSection()） */
const boot = (settings) => {
  reset()
  loadPlugin({ quiet: true, clientPath: MUT_CLIENT, settings: settings || {} })
  return String((globalThis.__mpwBuildCss ? globalThis.__mpwBuildCss({ image: true, enabled: true }) : '') || '')
}
const section = () => (globalThis.__mpwSectionTest ? globalThis.__mpwSectionTest.read() : { err: 'no-hook' })
const persisted = () => { try { return JSON.parse(globalThis.localStorage.getItem('dsh.mpkg-wallpaper.v2') || '{}') } catch (e) { return {} } }

console.log('══ bsCompat 默认值与存量迁移（用户裁定：默认开 + 只迁移"从没设过"的人）══')
console.log(`被测实现：${path.relative(repoRoot, MUT_CLIENT)}`)

if (NO_MUT) console.log('（变异子进程：跳过变异段）')

/* ── ① 默认档（无任何存储）⇒ 适配生效 ── */
console.log('\n== ① 默认档（无任何存储）==')
/* 注意：bsCompat 是**总闸**，它自己不开子开关时不产出任何规则（产物里那条 `[data-dsh-better-sidebar]`
   只出现在注释里）⇒ "默认档生效"必须用一个子开关来观测。这里固定用 bsFloat（底部面板悬浮适配），
   它在修前是"总闸默认 false ⇒ 永远看不到"的那个功能。 */
const cssDefaultFloat = boot({ enabled: true, image: true, bsFloat: true })
ok('★ 默认档（无任何存储）+ 子开关 bsFloat ⇒ 底部悬浮适配几何**生效**（border-radius:14px）', ADOPTED(cssDefaultFloat), `len=${cssDefaultFloat.length}`)
ok('★ 总闸确实是开的（产物里有 bsCompat 作用域规则）', BS_BLOCK(cssDefaultFloat), '')
const s1 = section()
ok('★ 读到的 bsCompat === true（新默认）', s1.bsCompat === true, JSON.stringify(s1))
ok('★ 没被误打"用户设过"标记（默认档不该算用户设过）', s1.bsCompatUserSet === false, JSON.stringify(s1))

/* ── ② 用户显式关过（带标记）⇒ 不生效、且**迁移不发生** ── */
console.log('\n== ② 用户显式关过（bsCompat:false + bsCompatUserSet:true）==')
const cssOff = boot({ enabled: true, image: true, bsCompat: false, bsCompatUserSet: true, bsFloat: true })
ok('★ 适配**不生效**（尊重用户手动关：连 bsCompat 作用域规则都不生成）', !BS_BLOCK(cssOff) && !ADOPTED(cssOff), `len=${cssOff.length}`)
const s2 = section()
ok('★ **迁移不发生**（有标记的用户一字不动）', s2.bsCompat === false && s2.bsCompatUserSet === true, JSON.stringify(s2))

/* ── ③ 存量用户（无标记 + 旧默认 false）⇒ 迁移到 true；再手动关 ⇒ 保持关 ── */
console.log('\n== ③ 存量用户迁移 + 迁移后手动关 ==')
const cssLegacy = boot({ enabled: true, image: true, bsCompat: false, bsFloat: true })
ok('★ 存量用户（无标记、旧默认 false）⇒ 迁移到新默认 true（适配生效）', BS_BLOCK(cssLegacy) && ADOPTED(cssLegacy), `len=${cssLegacy.length}`)
const s3 = section()
ok('★ 迁移**不打**标记（用户仍算"从没设过"）', s3.bsCompat === true && s3.bsCompatUserSet === false, JSON.stringify(s3))
const w = globalThis.__mpwSectionTest ? globalThis.__mpwSectionTest.write({ bsCompat: false }) : 'no-hook'
const s4 = section()
ok('★ 迁移后手动关 ⇒ 关（并打上"用户设过"标记）', s4.bsCompat === false && s4.bsCompatUserSet === true, `write=${w} / ${JSON.stringify(s4)}`)
ok('★ 手动关之后适配确实不生效', !BS_BLOCK(String(globalThis.__mpwBuildCss({ image: true, enabled: true }) || '')), '')
await settle()   // writeSection 的 localStorage 落盘是防抖定时器（~1s）：不等就会读到旧值
const pj = persisted()
ok('★ 落盘里带上了 bsCompatUserSet（重启后不会被迁移回去）', pj.bsCompat === false && pj.bsCompatUserSet === true,
  JSON.stringify({ bsCompat: pj.bsCompat, bsCompatUserSet: pj.bsCompatUserSet }))
/* 真·「重启」= 用**落盘的那份 section** 当新会话的存储再装一次（_stub 的 localStorage 每次新建，
   直接传 opts.settings 就是"重启后读到的那份配置"，语义等价且不需要自己实现一套存储桩）。 */
reset()
loadPlugin({ quiet: true, clientPath: MUT_CLIENT, settings: pj })
const replay = { s: section(), css: String((globalThis.__mpwBuildCss ? globalThis.__mpwBuildCss({ image: true, enabled: true }) : '') || '') }
ok('★ 「重启」后仍是关（标记随落盘生效，不会被再次迁移）',
  replay.s.bsCompat === false && replay.s.bsCompatUserSet === true && !BS_BLOCK(replay.css), JSON.stringify(replay.s))

/* ── 变异自证 ── */
if (!NO_MUT) {
  console.log('\n== ④ 分辨力自证 ==')
  const src = fs.readFileSync(clientPath, 'utf8')
  const MUTS = [
    {
      id: 'userset-check-removed', expect: '②',
      why: '删掉"用户设置过就不迁移"的判断（无脑迁移 ⇒ 手动关过的用户被覆盖）',
      mut: (t) => t.replace('const bsMigrate = s0.bsCompatUserSet === true ? null : DEFAULT_BS_COMPAT;', 'const bsMigrate = DEFAULT_BS_COMPAT;'),
    },
    {
      id: 'old-default-false-restored', expect: '①',
      why: '把默认值改回旧行为（DEFAULT_BS_COMPAT = false ⇒ 默认档看不到悬浮适配）',
      mut: (t) => t.replace('const DEFAULT_BS_COMPAT = true;', 'const DEFAULT_BS_COMPAT = false;'),
    },
    {
      id: 'marker-never-set', expect: '③',
      why: '写入口不再打"用户设过"标记（迁移后会一直被抬回 true）',
      mut: (t) => t.replace('if (prevEff !== void 0 && !!next.bsCompat !== !!prevEff) next.bsCompatUserSet = true;', 'if (false) next.bsCompatUserSet = true;'),
    },
  ]
  for (const m of MUTS) {
    const mutated = m.mut(src)
    if (mutated === src) { ok(`变异 ${m.id} 注入成功`, false, '注入点没匹配上（源码改了？）'); continue }
    const copy = path.join(tmpRoot, 'mut-' + m.id + '.js')
    fs.writeFileSync(copy, mutated)
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--no-mutations'], {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 60000,
      env: { ...process.env, MPW_BS_MUT_CLIENT: copy },
    })
    const out = (r.stdout || '') + (r.stderr || '')
    const GROUPS = {
      '①': /✗ ★ .*(bsCompat 作用域规则|悬浮适配几何|读到的 bsCompat|默认档)/,
      '②': /✗ ★ .*(适配\*\*不生效|迁移不发生)/,
      '③': /✗ ★ .*(迁移后手动关|手动关之后|落盘里带上了|「重启」后仍是关)/,
    }
    const caught = Object.keys(GROUPS).filter((g) => GROUPS[g].test(out))
    const got = caught.includes(m.expect) ? m.expect : (r.status === 0 ? 'PASS' : 'FAIL(其它)')
    ok(`变异 ${m.id}：期望 ${m.expect} 变红，实际 ${got}`, got === m.expect, `${m.why}  [exit=${r.status}]`)
    if (got !== m.expect) console.error('      ↑ 实际报红分组：[' + caught.join(',') + ']；RED 行：'
      + out.split('\n').filter((l) => /^\s*✗/.test(l)).slice(0, 3).join(' | '))
  }
}

cleanup()
console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail) { console.error('✗ bsCompat 默认值/迁移回归未通过'); process.exit(1) }
console.log('✓ bsCompat 默认值/迁移通过：默认档生效、手动关过的绝不被迁移、迁移后手动关持久生效')
