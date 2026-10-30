// clampuvs-wrap-test.mjs — P-208 A7（P-210 号）层级 `clampuvs` ⇒ 内容纹理采样器判据。
//
// 官方依据（REVERSE-FINDINGS-7 RE-47）：`clampuvs` 是**纹理/采样器侧**配置（官方 10 个 `.tex-json`
// 侧车 + declarations.json imageshaders config 都带这个键；PC/APK shader 全树 `grep CLAMP` 0 命中）；
// 层级字段是 workshop 行为：语料 48 包 1261 层 = **true 1258 / false 3**（本轮复扫一致），此前 core 完全没读。
//
// 本仓口径（与 P-168/P-194 共存）：
//   `true` ⇒ 该层内容纹理 CLAMP_TO_EDGE；显式 `false` ⇒ 官方 .tex 头缺省 REPEAT；
//   `null`（缺字段）⇒ 维持现状（P-168 名单口径，3422 层零回归）；`?clampuvs=legacy` 整条不生效；
//   wrap 是纹理对象级状态 ⇒ 与效果输入槽规则（P-194）按"各自 draw 前各自设置"共存，冲突进
//   `__mpwTexWrapConflicts` 台账（A13 兜底），不静默。
//
// 判据四层（全部离线：真包 + mock-GL；不起浏览器、不解纹理）：
//   C1 语料三态解析（真包）：3589454154 = 73 true / 57 null；3572877776 = 136 true / 1 false。
//   C2 运行时（mock-GL）：true ⇒ S/T=CLAMP_TO_EDGE；false ⇒ S/T=REPEAT；null ⇒ 零 GL 调用；
//      legacy ⇒ 零 GL 调用；快路径（同态重入零冗余）；冲突台账（A13）+ globalThis 发布。
//   C3 接线：compositeLayer 里真的调了 `layerClampUvWrap`（源码序）；`clampuvs` 字段在 parseScene 的
//      层描述符里（不是被丢掉）。
//   C4 变异自证：隔离 core/ 副本真改真跑 ⇒ 期望红集精确相等（真树零改动）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'
import { openPkgLazy, readSceneJsonText } from './_pkg-index.mjs'

const FILE = fileURLToPath(import.meta.url)
const CORE_FILE = process.env.MPW_CORE_FILE || path.join(ROOT, 'core', 'we-scene-bundle.js')
const CORE_SRC = fs.readFileSync(CORE_FILE, 'utf8')
const lib = await import(pathToFileURL(CORE_FILE).href)
const MPW_WS = process.env.MPW_ROOT || WS
const CORPUS = path.join(MPW_WS, 'allwallpaper')
const DEC = new TextDecoder()
const exists = (p) => { try { return fs.existsSync(p) } catch { return false } }

let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}

console.log('== A7 层级 clampuvs ⇒ 内容纹理采样器（RE-47）==')

/** mock-GL：只记 texParameteri 的 (pname, value)；常量用真 WebGL2 数值。 */
function mkGL() {
  const calls = []
  const gl = {
    TEXTURE_2D: 0x0DE1, TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803,
    CLAMP_TO_EDGE: 0x812F, REPEAT: 0x2901, TEXTURE0: 0x84C0,
    activeTexture() {}, bindTexture() {},
    texParameteri(_t, pname, value) { calls.push([pname, value]) },
  }
  return { gl, calls }
}
const mkTex = (props = {}) => Object.assign({}, props)

/* ── C1 语料三态解析 ── */
{
  const f1 = path.join(CORPUS, '0923/3589454154/scene.pkg')
  const f2 = path.join(CORPUS, '0923/3572877776/scene.pkg')
  if (!exists(f1) || !exists(f2)) {
    check('C1 语料三态解析', false, '语料缺失: ' + f1 + ' / ' + f2)
  } else {
    const s1 = lib.parseScene(lib.parseWeJson(readSceneJsonText(f1)), null, {})
    const s2 = lib.parseScene(lib.parseWeJson(readSceneJsonText(f2)), null, {})
    const t1 = s1.layers.filter((l) => l.clampuvs === true).length
    const n1 = s1.layers.filter((l) => l.clampuvs == null).length
    const t2 = s2.layers.filter((l) => l.clampuvs === true).length
    const fl2 = s2.layers.filter((l) => l.clampuvs === false).length
    check('C1a 3589454154：130 层 = 73 true（CLAMP 请求）+ 57 null（维持现状）——三态不被丢',
      s1.layers.length === 130 && t1 === 73 && n1 === 57, 'true=' + t1 + ' null=' + n1)
    check('C1b 3572877776：显式 false 层也被解析进描述符（官方 .tex 头缺省 = REPEAT）',
      s2.layers.length === 137 && t2 === 136 && fl2 === 1, 'true=' + t2 + ' false=' + fl2)
  }
}

/* ── C2 运行时（mock-GL） ── */
{
  lib.resetTexWrapConflictLedger()
  const { gl, calls } = mkGL()
  const tex = mkTex()
  check('C2a clampuvs:true ⇒ S/T 双双 CLAMP_TO_EDGE，返回 clamp',
    lib.layerClampUvWrap(gl, tex, true, 'materials/x.tex') === 'clamp' &&
    calls.some(([p, v]) => p === gl.TEXTURE_WRAP_S && v === gl.CLAMP_TO_EDGE) &&
    calls.some(([p, v]) => p === gl.TEXTURE_WRAP_T && v === gl.CLAMP_TO_EDGE) &&
    tex.__mpwWrapNow === 'clamp', JSON.stringify({ n: calls.length, now: tex.__mpwWrapNow }))
  const n0 = calls.length
  check('C2b 快路径：同态重入 ⇒ 零冗余 texParameteri',
    lib.layerClampUvWrap(gl, tex, true, 'materials/x.tex') === 'clamp' && calls.length === n0, 'calls=' + (calls.length - n0))
  check('C2c clampuvs:null（缺字段）⇒ 不动 wrap（维持 P-168 现状）、返回 null',
    lib.layerClampUvWrap(gl, mkTex(), null, 'materials/y.tex') === null, '')
  check('C2d ?clampuvs=legacy ⇒ 整条不生效（零 GL 调用、返回 null）',
    lib.layerClampUvWrap(gl, mkTex(), true, 'materials/z.tex', '?clampuvs=legacy') === null &&
    lib.layerClampUvWrap(gl, mkTex(), false, 'materials/z.tex', '?clampuvs=legacy') === null, '')
  // false ⇒ REPEAT
  const t2 = mkTex()
  check('C2e clampuvs:false（显式）⇒ S/T 双双 REPEAT（官方 .tex 头缺省）',
    lib.layerClampUvWrap(gl, t2, false, 'materials/w.tex') === 'repeat' &&
    calls.some(([p, v]) => p === gl.TEXTURE_WRAP_S && v === gl.REPEAT) &&
    t2.__mpwWrapNow === 'repeat', JSON.stringify(t2.__mpwWrapNow))
  // A13 冲突台账：该纹理先被效果槽要求 REPEAT，再被 clamp 层要求 CLAMP ⇒ 冲突记 1 条、最终 CLAMP
  const t3 = mkTex({ __mpwWrapReq: 'repeat', __mpwWrapNow: 'repeat', __mpwName: 'materials/both.tex' })
  const before = lib.texWrapConflictLedger().conflicts
  lib.layerClampUvWrap(gl, t3, true, 'materials/both.tex')
  const led = lib.texWrapConflictLedger()
  check('C2f 冲突台账（A13）：repeat(效果槽)→clamp(层) 的纹理记 1 条冲突 + globalThis.__mpwTexWrapConflicts 发布',
    led.conflicts === before + 1 && led.last[led.last.length - 1].want === 'clamp' &&
    Array.isArray(globalThis.__mpwTexWrapConflicts), JSON.stringify(led.last[led.last.length - 1] || {}))
  check('C2g 冲突后最终态 = CLAMP（层内容语义赢在它自己的 draw）',
    t3.__mpwWrapNow === 'clamp', JSON.stringify(t3.__mpwWrapNow))
  // P-194 共存：fxSlotWrap 对已 __mpwWrapNow='clamp' 的纹理（被 clamp 层改走）能重新落 REPEAT
  const entry = {}
  const t4 = mkTex({ __mpwWrapNow: 'clamp', __mpwWrapReq: 'clamp', __mpwName: 'materials/slot.tex' })
  lib.resetTexWrapConflictLedger()
  const mode4 = lib.fxSlotWrap(gl, entry, 1, t4, '')
  check('C2h 与 P-194 共存：clamp 被层改走后，效果输入槽重新落 REPEAT（不因旧 sticky 而失效）',
    mode4 === 'repeat' && t4.__mpwWrapNow === 'repeat' && entry.samplerWrapRepeat === true,
    JSON.stringify({ mode: mode4, now: t4.__mpwWrapNow }))
  lib.resetTexWrapConflictLedger()
}

/* ── C3 接线（源码序） ── */
{
  check('C3a parseScene 层描述符带 clampuvs 三态（不是被丢掉）',
    CORE_SRC.includes('clampuvs: o.clampuvs === true ? true : (o.clampuvs === false ? false'), '')
  check('C3b compositeLayer 绘制路径真的调了 layerClampUvWrap（TEXTURE0 绑定前）',
    CORE_SRC.includes('layerClampUvWrap(gl, inputTex, layer.clampuvs, layer.textureName)'), '')
  check('C3c fxSlotWrap 记账 __mpwWrapNow（两路径的状态机共享同一纹理字段）',
    (CORE_SRC.match(/t\.__mpwWrapNow = 'repeat'/g) || []).length >= 1, '')
  check('C3d 台账可复位（resetTexWrapConflictLedger 导出）',
    /export function resetTexWrapConflictLedger\(/.test(CORE_SRC), '')
}

/* ── C4 变异自证（隔离 core/ 副本真改真跑） ── */
const MUTANTS = [
  // ① wrap 执行器整个变成 no-op（回到"完全忽略 clampuvs"）：C2 全组必红（C2 组编号 → 红集 'C2'）
  { id: 'wrap-noop', expect: ['C2'], edit: (s) => s.replace('export function layerClampUvWrap(gl, tex, mode, name, search) {\n  try {', 'export function layerClampUvWrap(gl, tex, mode, name, search) {\n  try { return null;') },
  // ② parseScene 不再解析 clampuvs（字段被丢）：C1 必红；C3a 的结构判据钉着同一行 ⇒ 也红（实测）
  { id: 'parse-drop', expect: ['C1', 'C3'], edit: (s) => s.replace(/clampuvs: o\.clampuvs === true \? true[^\n]*\n/, '') },
]
if (!process.argv.includes('--no-mutations')) {
  console.log('== C4 变异自证（隔离 core/ 副本；真树不动）==')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-clampuvs-'))
  for (const m of MUTANTS) {
    const root = path.join(tmp, m.id)
    fs.mkdirSync(path.join(root, 'core'), { recursive: true })
    for (const f of fs.readdirSync(path.join(ROOT, 'core'))) fs.copyFileSync(path.join(ROOT, 'core', f), path.join(root, 'core', f))
    const target = path.join(root, 'core', 'we-scene-bundle.js')
    const mutated = m.edit(CORE_SRC)
    if (mutated === CORE_SRC) { check('C4 ' + m.id + ' 变异真的改到了（锚点未命中 ⇒ 判据腐烂）', false); continue }
    fs.writeFileSync(target, mutated)
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}')
    const r = spawnSync(process.execPath, [FILE, '--no-mutations'], {
      encoding: 'utf8', maxBuffer: 32 << 20,
      env: { ...process.env, MPW_CORE_FILE: target, MPW_REPO_ROOT: ROOT },
    })
    const groups = new Set((r.stdout || '').split('\n').filter((l) => l.includes('✗')).map((l) => (/✗\s*(C\d)/.exec(l) || [])[1]).filter(Boolean))
    const got = [...groups].sort(), want = [...m.expect].sort()
    check('C4 ' + m.id + '：期望红集精确相等', JSON.stringify(got) === JSON.stringify(want),
      '期望 ' + JSON.stringify(want) + ' 实际 ' + JSON.stringify(got) + ' exit=' + r.status)
    if (JSON.stringify(got) === JSON.stringify(want)) console.log('    MUTANT-RED-OK ' + m.id + ' 红集=' + JSON.stringify(got))
  }
  check('C4 真树 core 未被变异触碰', fs.readFileSync(CORE_FILE, 'utf8') === CORE_SRC)
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log('\n===== clampuvs-wrap: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
process.exit(fail ? 1 : 0)
