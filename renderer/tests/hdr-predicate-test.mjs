// hdr-predicate-test.mjs — P-58 H0：自动 HDR 判据真值表单测（无浏览器/无 GL）
// 复现：node hdr-predicate-test.mjs
//
// 问题（docs/MODEL-INDIRECTION-RESEARCH.md §4，第1项 hina 3554161528 白屏）：
//   层实际画在**默认帧缓冲**（compositeLayer 无条件 bindFramebuffer(null)），而帧末
//   presentHdrScene 把 **从未被写入** 的 RGBA16F 纹理全屏合成 ⇒ 正确画面被整屏替换成白/空。
//   mock-GL 实证（hina 默认路径）：进 HDR FBO 的 draw = 0、采样该纹理的 draw = 1（全屏 present）。
//   熔断器（hdrForceLdrSession）只看层绘制期间的 gl.getError()，层画在默认 FB 上不报错 → 拦不住。
//   hina 是全语料唯一 general.hdr=true 且 general.bloom=false 的包（bloom 是 HDR 唯一消费者）。
//
// 本测试断言的是**生产判据**（core/we-scene-bundle.js 的 resolveHdrWant，renderScene 用的同一份逻辑）
// 在 hdr × bloom × ?hdr=0/1 × 会话熔断 四维上的真值表；并断言 hina/3778592720 两个真实包的
// general 取值各自落在预期分支（真实值取自包内 scene.json）。
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import * as lib from '../core/we-scene-bundle.js'
import fs from 'node:fs'
import path from 'node:path'

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}

// ── T1 自动分支：只有 hdr 且 bloom 都为真才开 HDR ──
console.log('[T1] 自动分支（无 ?hdr 显式值，会话未熔断）')
{
  const cases = [
    [{ hdr: true, bloom: true }, true, 'hdr=true bloom=true → 开（HDR 有消费者）'],
    [{ hdr: true, bloom: false }, false, 'hdr=true bloom=false → 关（hina 的根因组合）'],
    [{ hdr: false, bloom: true }, false, 'hdr=false bloom=true → 关（3778592720 的真实组合）'],
    [{ hdr: false, bloom: false }, false, 'hdr=false bloom=false → 关'],
    [{}, false, '无 hdr/bloom 键 → 关'],
    [{ hdr: { value: true }, bloom: { value: true } }, true, '对象形状 {value:true} → 开'],
    [{ hdr: { value: true }, bloom: { value: false } }, false, 'hdr 对象真、bloom 对象假 → 关'],
    [{ hdr: true, bloom: { value: true } }, true, '混合形状（bool + 对象）→ 开'],
    [{ hdr: 'true', bloom: 'true' }, false, '字符串 "true" 不算真（与旧判据逐位一致）'],
    [{ hdr: 1, bloom: 1 }, false, '数字 1 不算真（与旧判据逐位一致）'],
    [{ hdr: { value: 'true' }, bloom: true }, false, 'value 非布尔 true → 关'],
  ]
  for (const [g, want, label] of cases) {
    const got = lib.resolveHdrWant({}, g, null)
    check('T1 ' + label, got === want, 'got=' + got)
  }
}

// ── T2 ?hdr=0 语义不变：无论 general 怎么配都强制 LDR ──
console.log('[T2] ?hdr=0（强制 LDR）语义不变')
{
  const zeros = [0, false, '0']
  let bad = []
  for (const z of zeros) for (const g of [{ hdr: true, bloom: true }, { hdr: true, bloom: false }, { hdr: { value: true }, bloom: { value: true } }]) {
    if (lib.resolveHdrWant({ hdr: z }, g, null) !== false) bad.push(JSON.stringify([z, g]))
  }
  check('T2a 0 / false / "0" 三形态在 hdr+bloom 场景下都返回 false', bad.length === 0, bad.join(' '))
  check('T2b ?hdr=0 不受会话熔断状态影响（恒 false）', lib.resolveHdrWant({ hdr: 0 }, { hdr: true, bloom: true }, true) === false)
}

// ── T3 ?hdr=1 强制路径不变：即使 bloom 关、即使会话已熔断也走 HDR ──
console.log('[T3] ?hdr=1（强制尝试浮点 RT）语义不变')
{
  const ones = [1, true, '1']
  let bad = []
  for (const o of ones) {
    for (const g of [{}, { hdr: false, bloom: false }, { hdr: true, bloom: false }]) {
      if (lib.resolveHdrWant({ hdr: o }, g, null) !== true) bad.push(JSON.stringify([o, g]))
    }
    // P-41 A1：显式强制不受自动路径熔断影响（诊断用）
    if (lib.resolveHdrWant({ hdr: o }, { hdr: true, bloom: true }, true) !== true) bad.push('forceLdr+' + JSON.stringify(o))
  }
  check('T3a 1 / true / "1" 三形态在任意 general（含 bloom=false）下都返回 true', bad.length === 0, bad.join(' '))
  check('T3b 显式强制不被会话熔断拦截（hdrForceLdrSession=true）', bad.length === 0)
}

// ── T4 会话熔断（P-41 A1）只作用于自动分支 ──
console.log('[T4] hdrForceLdrSession 只关自动分支')
{
  check('T4a 熔断 + hdr=true/bloom=true → 关（不是 false 以外的假值）', lib.resolveHdrWant({}, { hdr: true, bloom: true }, true) === false)
  check('T4b 熔断为 false/undefined/null 时自动分支照常开', [false, undefined, null].every((v) => lib.resolveHdrWant({}, { hdr: true, bloom: true }, v) === true))
}

// ── T5 真实包 general 取值（hina 与 bloom=true/hdr=false 的对照包）──
console.log('[T5] 真实包 general 分支（allwallpaper/dd，缺包自动 SKIP）')
{
  const DD = process.env.MPW_SCENE_ROOT || path.join(WS, 'allwallpaper', 'dd')
  const genOf = (id) => {
    const p = path.join(DD, id, 'scene.pkg')
    if (!fs.existsSync(p)) return null
    const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(p)))
    const sj = JSON.parse(new TextDecoder().decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, ''))
    return (sj.general) || {}
  }
  const hina = genOf('3554161528')
  if (!hina) console.log('  SKIP hina 3554161528 不在语料目录（条件项不红）')
  else {
    check('T5a hina general.hdr=true 且 general.bloom=false（本批次的事实基础）',
      hina.hdr === true && hina.bloom === false, `hdr=${hina.hdr} bloom=${hina.bloom}`)
    check('T5b hina 自动判据 → LDR（修前是 HDR → 白屏）', lib.resolveHdrWant({}, hina, null) === false)
    check('T5c hina ?hdr=1 仍可强制 HDR（诊断逃生口）', lib.resolveHdrWant({ hdr: 1 }, hina, null) === true)
  }
  const bloomOnly = genOf('3778592720')
  if (!bloomOnly) console.log('  SKIP 3778592720 不在语料目录')
  else {
    // 该包 hdr=false/bloom=true：修前修后**都必须**是 LDR（本批不改它的行为）
    check('T5d 3778592720（bloom=true, hdr=false）判据仍为 LDR（零行为变化）',
      lib.resolveHdrWant({}, bloomOnly, null) === false, `hdr=${bloomOnly.hdr} bloom=${bloomOnly.bloom}`)
  }
}

console.log('\n' + (fail === 0 ? '全部通过' : '存在失败') + `：${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
