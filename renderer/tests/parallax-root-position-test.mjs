// parallax-root-position-test.mjs —— 视差**参考点**取"顶层祖先位置"的判据（2026-10-11，2026-10-12 P-348 改造）
//
// 官方依据（✅ 官方 Android `.so`，本档 2026-10-12 **重新从 APK 反汇编复核**，不再是转述）：
//   `unzip -p <WS>/Androidapk/壁纸引擎_2.8.8.apk lib/arm64-v8a/libscenejni.so > /tmp/libscenejni.so`
//   `objdump -d --start-address=0x2557be0 --stop-address=0x2557c90 /tmp/libscenejni.so`
//     `2557bf4 bl _ZNK10Renderable9GetParentEv@plt` + `2557c04-2557c14` 循环 ⇒ `x22` = **最顶层祖先**
//     `2557c28 ldr d2,[x22,#248]`（**参考点位置**） 与 `2557c30 ldr d2,[x22,#320]`（**parallaxDepth**）
//     用的是**同一个 `x22`** ⇒ 官方**参考点与 depth 都取顶层祖先**，且**没有**"子层自己写了就用子层"的分支。
//   （桌面 x86-64 独立复现：`reports/parallax-official-align-20260924.md` §5.1 表第 4/5 行。）
//
// ⚠ **本档 2026-10-12 的改造原因（血的教训）**：本档原先只有**正则级**断言 —— 其中一条是
//   `ok('?parpos=legacy 回退支存在', /parPosLegacy|parposLegacy/.test(src))`，即"**这个名字出现在源码里**"。
//   P-309 落地时那个三元**写错位**了（else 支误接 `PARALLAX_OFF_LEGACY`），`?parpos=legacy` 从来不起作用、
//   反而 `?paroff=legacy` 会悄悄把参考点退回本层 —— 而这条**放空的判据**照样全绿 ⇒ bug 躲了一整轮 ✗。
//   现在把那条换成**行为级**门（子进程真跑 `tests/parallax-root-ref-test.mjs`，要求它退出码 0、
//   五条口径断言**真的出现且为真**、且变异自证 ≥3 组 `MUTANT-RED-OK`）+ 一条**反回归**结构断言。
//   本档**不再**用"名字存在"当证据。
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { ROOT, WS } from './_root.mjs'
import { parsePkg } from '../core/we-scene-bundle.js'

const src = fs.readFileSync(path.join(ROOT, 'core', 'we-scene-bundle.js'), 'utf8')
const rows = []
const ok = (why, cond, detail = '') => rows.push({ why, pass: !!cond, detail: String(detail) })

/* ① 结构：参考点与 depth **同源**（保留：它钉的是接线形状；行为由 ② 覆盖） */
ok('存在 `parPosSrc`（参考点来源）且非 legacy 时取 `parDepthSrc`（与 depth 同源 = 官方同一 x22 语义）',
  /const parPosSrc\s*=\s*[^\n]*parDepthSrc/.test(src))
ok('两处公式（X/Y）都用 `parPosSrc` 的位置而不是裸 `ox/oy`',
  /parOffX\s*=\s*\(\(po?x|parPosSrc/.test(src) && !/parOffX = \(\(ox - camCx\) \+ parDispX\) \* dpx \* parAmount/.test(src))
ok('depth 取根的既有实现未被破坏（反回归 ✗）',
  /const parDepthSrc = \(parRoot && parRoot\.parallaxDepth\) \? parRoot : layer/.test(src))
/* ①b 反回归：三条 legacy 档必须**同形**（显式 opts 优先，否则各自读自己的 `?…=legacy`）。
   2026-10-12 之前 `__parPosLegacy` 是错位三元、`__parOffLegacy` 只判"传没传" —— 两条都钉死。 */
ok('三个 legacy 档同形：`__parOffLegacy` / `__parPosLegacy` 都判**值**（`? !!opts.… : …_LEGACY`）',
  /const __parOffLegacy = \(opts\.parallaxOffLegacy !== undefined\)\s*\n\s*\? !!opts\.parallaxOffLegacy : PARALLAX_OFF_LEGACY/.test(src) &&
  /const __parPosLegacy = \(opts\.parallaxPosLegacy !== undefined\)\s*\n\s*\? !!opts\.parallaxPosLegacy : PARALLAX_POS_LEGACY/.test(src) &&
  /const PARALLAX_POS_LEGACY = \(\(\) => \{/.test(src))
ok('反回归：源码里**不再**出现 P-309 那个错位三元（`?parpos` 的 IIFE 直接接三元 / else 支接 `PARALLAX_OFF_LEGACY`）✗',
  !/get\('parpos'\) === 'legacy'[\s\S]{0,80}\? !!opts\.parallaxOffLegacy : PARALLAX_OFF_LEGACY/.test(src))

/* ② 行为级门（**替换掉原先那条放空的正则断言**）：子进程真跑行为判据 + 变异自证 */
{
  const child = spawnSync(process.execPath, [path.join(ROOT, 'tests', 'parallax-root-ref-test.mjs')],
    { encoding: 'utf8', timeout: 300000, env: process.env })
  const out = String(child.stdout || '') + String(child.stderr || '')
  const NEED = ['REF-ROOT-DEFAULT', 'REF-POS-LEGACY-URL', 'REF-POS-LEGACY-OPT',
    'REF-OFF-LEGACY-DOES-NOT-MOVE-REF', 'OFF-GATE-OPT-FALSE']
  const missing = NEED.filter((id) => !out.includes('✓ ' + id))
  const mut = (out.match(/MUTANT-RED-OK/g) || []).length
  ok('行为级：`tests/parallax-root-ref-test.mjs` 退出码 0（"回退位真的能回退"由它给出读数）',
    child.status === 0, 'status=' + child.status + (out ? '' : '（无输出）'))
  ok('行为级：五条口径断言真的跑了且**为真**（' + NEED.length + ' 条，缺 ' + missing.length + '）',
    missing.length === 0, missing.length ? '缺：' + missing.join(', ') : '全部命中 ✓ ' + NEED.join(' ✓ '))
  ok('行为级：变异自证 ≥3 组且全部 `MUTANT-RED-OK`（期望红集 == 实际红集）',
    mut >= 3 && out.includes('全部 MUTANT-RED-OK'), 'MUTANT-RED-OK=' + mut)
  ok('行为级：真包夹具（语料在时）没有被 SKIP 成"全绿"',
    /parallax-root-ref: \d+ 通过/.test(out) && !/parallax-root-ref: 0 通过/.test(out),
    (out.match(/===== parallax-root-ref:[^=]*=====/) || ['(未找到汇总行)'])[0].trim())
}

/* ③ 数据级夹具：真包两例（根位置 ≠ 本层位置）——直接读容器，不依赖 GL */
const fixtures = [
  ['0917/3195212886', '轻度：子「嘴」vs 根「纯色占位符」Δpos≈123.84px'],
  ['dd/3470764447', '重度：子「Clock」vs 根「组件」Δpos≈1028.76px'],
]
for (const [rel, desc] of fixtures) {
  let found = null
  const base = path.join(WS, 'allwallpaper', rel)
  for (const cand of [base + '.mpkg', base + '.pkg', path.join(base, 'scene.pkg'), path.join(base, 'scene.mpkg')]) {
    if (fs.existsSync(cand)) { found = cand; break }
  }
  if (!found && fs.existsSync(base) && fs.statSync(base).isDirectory()) {
    const inner = fs.readdirSync(base).find((f) => /\.(mpkg|pkg)$/i.test(f))
    if (inner) found = path.join(base, inner)
  }
  let diff = null
  if (found) { try { const pkg = parsePkg(fs.readFileSync(found)); diff = pkg.entries.length } catch (e) { diff = null } }
  ok('夹具存在且可解析：' + rel + '（' + desc + '）', !!found && diff !== null, found ? ('条目=' + diff) : '未找到容器')
}

const fail = rows.filter((r) => !r.pass)
for (const r of rows) console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.why + (r.detail ? ' — ' + r.detail : ''))
console.log(`===== parallax-root-position: ${rows.length - fail.length} 通过 / ${fail.length} 失败 =====`)
process.exit(fail.length ? 1 : 0)
