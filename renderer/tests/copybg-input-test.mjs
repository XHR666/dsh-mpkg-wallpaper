#!/usr/bin/env node
/**
 * copybg-input-test.mjs —— `copybackground` 层的**效果链输入**契约（P-199）
 *
 * 现场：壁纸 `allwallpaper/0923/2887099508/scene.pkg` 有 **64 层 `copybackground:true`**（语料 77 true / 44 false），
 *   其中 28 层既有自己的贴图又有 fx。旧行为把**所有** copybg 层的链输入换成背景拷贝 ⇒ 这些层的内容被背景顶掉
 *   （用户报"基本上渲染不出来有用的内容"）。
 * 依据（三条一致）：①第三方参考实现（WER-ALIGN G2）"solid 层用 composelayer_clearalpha 材质采样主帧缓冲；
 *   **效果层材质注入 COPYBG combo**"；②官方 shader `#if COPYBG` 采 `g_Texture2 = _rt_FullFrameBuffer`
 *   （背景走独立纹理槽）；③本文件 RE-23 注释即"注入 combos.COPYBG=1"。
 * 判据：A 开关真值表 / B 源码接线（有纹理的层不换输入）/ C 真语料读数 / D 变异自证。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')
const CORE = path.join(ROOT, 'core', 'we-scene-bundle.js')
const CORE_UNDER_TEST = process.env.MPW_COPYBG_CORE || CORE
const NO_MUT = process.argv.includes('--no-mutant')
const lib = await import(pathToFileURL(CORE_UNDER_TEST).href)
let pass = 0, fail = 0
const ok = (c, name, extra = '') => {
  if (c) { pass++; console.log('  ✓ ' + name + (extra ? '  [' + String(extra).slice(0, 200) + ']' : '')) }
  else { fail++; console.error('  ✗ ' + name + (extra ? '  [' + String(extra).slice(0, 300) + ']' : '')) }
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-copybg-'))
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* tmp */ } })

console.log('== A 回退开关真值表 ==')
{
  ok(typeof lib.copyBgInputLegacy === 'function', 'A0 `copyBgInputLegacy` 有具名导出（判据直接驱动）')
  ok(lib.copyBgInputLegacy('?copybginput=legacy') === true, 'A1 `?copybginput=legacy` ⇒ true（回到"总是换链输入"）')
  ok(lib.copyBgInputLegacy('?copybginput=1') === false && lib.copyBgInputLegacy('?x=1') === false && lib.copyBgInputLegacy('') === false,
    'A2 只认显式 `=legacy`（其它值/无参 ⇒ false）')
  ok(lib.copyBgInputLegacy(undefined) === false, 'A3 浏览器路径（读 location）在 Node 里不抛、非 legacy')
}

console.log('\n== B 源码接线：有自己纹理的层**不**换链输入 ==')
{
  const src = fs.readFileSync(CORE_UNDER_TEST, 'utf8')
  ok(/if \(\(layer\.copybackground \|\| opts\.copyBackground\) && \(effects\.length > 0 \|\| copyBgInputLegacy\(\)\)\)/.test(src),
    'B0 生产路径的换入门 = `(copybg) && (effects.length > 0 || legacy)`（P-230：**没有效果链的 copybg 层不换入**，画自己的纯色/内容——官方 helper 语义只对有效果链的层存在）')
  ok(/if \(!effTex \|\| copyBgInputLegacy\(\)\) srcTex = rt\.tex/.test(src),
    'B1 生产路径是 `if (!effTex || copyBgInputLegacy()) srcTex = rt.tex`（有纹理 ⇒ 保持层自己的内容）')
  ok(/copyBgEntry = rt/.test(src), 'B2 背景拷贝仍然准备着（COPYBG 槽 / `_rt_FullFrameBuffer` 要它）')
  ok(/mp2\.combos = Object\.assign\(\{\}, mp2\.combos \|\| \{\}, \{ COPYBG: 1 \}\)/.test(src),
    'B3 `COPYBG=1` 仍然逐材质注入（效果层靠这个 combo 才去采背景槽）')
}

console.log('\n== C 真语料读数（这条不是纸上需求）==')
{
  const pkg = path.join(ROOT, '..', 'allwallpaper', '0923', '2887099508', 'scene.pkg')
  if (!fs.existsSync(pkg)) ok(false, 'C0 语料包存在', pkg)
  else {
    const buf = fs.readFileSync(pkg)
    const n = (buf.toString('latin1').match(/"copybackground"\s*:\s*true/g) || []).length
    ok(n >= 40, 'C1 `0923/2887099508` 里 `copybackground:true` 的层数 ≥ 40（实测 ' + n + ' ⇒ 旧行为下这些层内容全被背景顶掉）', 'n=' + n)
    ok(buf.includes('COPYBG') || buf.includes('_rt_FullFrameBuffer'), 'C2 包内确实有 COPYBG / `_rt_FullFrameBuffer` 的使用面（combo 有意义）')
  }
}

if (!NO_MUT) {
  console.log('\n== D 变异自证 ==')
  const { createHash } = await import('node:crypto')
  const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex')
  const before = sha(CORE)
  const src = fs.readFileSync(CORE, 'utf8')
  const from = 'if (!effTex || copyBgInputLegacy()) srcTex = rt.tex'
  const mutated = src.split(from).length === 2 ? src.replace(from, 'srcTex = rt.tex') : null
  if (!mutated) ok(false, 'D0 变异注入成功（锚点唯一）')
  else {
    const mutCore = path.join(tmp, 'core-mut')
    fs.mkdirSync(mutCore, { recursive: true })
    for (const f of fs.readdirSync(path.join(ROOT, 'core'))) {
      const s2 = path.join(ROOT, 'core', f)
      if (!fs.statSync(s2).isFile()) continue
      fs.copyFileSync(s2, path.join(mutCore, f))
    }
    const copy = path.join(mutCore, 'we-scene-bundle.js')
    fs.writeFileSync(copy, mutated)
    const r = spawnSync(process.execPath, [process.argv[1], '--no-mutant'], {
      encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, MPW_COPYBG_CORE: copy },
    })
    const out = (r.stdout || '') + (r.stderr || '')
    ok(/✗ B1/.test(out), 'D1 改回"总是换链输入" ⇒ B 组必红（判据有分辨力）', `exit=${r.status}`)
  }
  ok(sha(CORE) === before, 'D2 真树 sha256 跑前跑后逐字相同', sha(CORE).slice(0, 16) + '…')
}

console.log(`\n────\ncopybg-input-test：${pass} 通过 / ${fail} 失败`)
if (fail) { console.error('✗ copybackground 链输入契约未通过'); process.exit(1) }
console.log('✓ 契约通过：有纹理的 copybg 层保持自己的内容 + 背景只走 COPYBG 槽 + 回退口 + 语料读数 + 变异自证')
