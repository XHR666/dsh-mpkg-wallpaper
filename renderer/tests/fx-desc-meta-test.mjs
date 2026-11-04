#!/usr/bin/env node
/**
 * fx-desc-meta-test.mjs —— 两条「官方语义读到了但没接上电」的判据（WE-FULL-REV §5 的 P0-2 / P0-6 / P1-8）
 *
 * 背景（逐条核实的结论，见 `docs/PATCHES.md` P-195/P-196）：
 *  ① material 注解只扫 `.vert`/`.frag` 原文，而 **官方一整批注解写在 include 头里**
 *     （`shaders/common_composite.h` 的 `g_CompositeAlpha`/`g_CompositeOffset`/`g_CompositeColor`）
 *     ⇒ `bindConstants` 既拿不到场景 `constantshadervalues`、也写不出缺省值；
 *     例：`COMPOSITE==1` 的 pass 里 `g_CompositeAlpha` 停在 GL 缺省 **0** ⇒ 该 pass 实际成 no-op。
 *  ② fbo 描述符的 `format`/`width`/`height`/`uvs` 三个键从未被消费（真实用例 `effects/glitter`：
 *     `_rt_GlitterTiles` = 256×256 + `format:"r8"` + `uvs:"repeat"`，我们按层尺寸建 ⇒ 图案频率错）。
 *
 * 判据（都能"改回去必红"）：
 *   A `parseMaterialMeta`/`materialMetaFor` 的行为（含头正文、缺省值、同名后者胜、legacy 屏蔽）
 *   B 两个回退开关的真值表
 *   C **真语料**里这两个键真的存在（不是纸上需求）
 *   D 源码接线（includeBodies 真的传了 / fbo 描述符真的进了分配）
 *   E 变异自证（删 includeBodies ⇒ D 红；删 R8 分支 ⇒ D 红）
 *
 * 跑法：`node tests/fx-desc-meta-test.mjs [--no-mutant]`；`MPW_FXDESC_CORE=<副本>` 供变异子进程使用。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')
const CORE = path.join(ROOT, 'core', 'we-scene-bundle.js')
const CORE_UNDER_TEST = process.env.MPW_FXDESC_CORE || CORE
const NO_MUT = process.argv.includes('--no-mutant')
const WS = path.resolve(ROOT, '..')
const lib = await import(pathToFileURL(CORE_UNDER_TEST).href)

let pass = 0, fail = 0
const ok = (c, name, extra = '') => {
  if (c) { pass++; console.log('  ✓ ' + name + (extra ? '  [' + String(extra).slice(0, 200) + ']' : '')) }
  else { fail++; console.error('  ✗ ' + name + (extra ? '  [' + String(extra).slice(0, 300) + ']' : '')) }
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-fxdesc-'))
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* tmp */ } })

/* 官方头里的注解形态（`shaders/common_composite.h` 的三行，逐字同形） */
const HDR_COMPOSITE = [
  'uniform float g_CompositeAlpha;   // {"material":"compositealpha","default":1}',
  'uniform vec3 g_CompositeOffset;   // {"material":"compositeoffset","default":"0 0 0"}',
  'uniform vec3 g_CompositeColor;    // {"material":"compositecolor","default":"1 1 1"}',
].join('\n')
const STAGE = [
  'uniform float g_Speed;            // {"material":"speed","default":5}',
].join('\n')

/* ── A include 头注解并入 matMeta ── */
console.log('== A material 注解：include 头正文也要扫 ==')
{
  const only = lib.parseMaterialMeta(STAGE)
  ok(!!only.speed && !only.compositealpha, 'A1 只扫 stage 原文 ⇒ 只有 `speed`（复现改动前的"查不到"）', Object.keys(only).join(','))
  const withHdr = lib.materialMetaFor({ vert: '', frag: STAGE, includeBodies: [HDR_COMPOSITE] })
  ok(!!withHdr.compositealpha && !!withHdr.compositeoffset && !!withHdr.compositecolor,
    'A2 并入 include 正文 ⇒ `compositealpha`/`compositeoffset`/`compositecolor` 都进表（P0-2 的根因已修）', Object.keys(withHdr).join(','))
  ok(withHdr.compositealpha.default === 1 && withHdr.compositealpha.uniform === 'g_CompositeAlpha',
    'A3 缺省值被解析出来：`compositealpha` ⇒ default=1 / uniform=`g_CompositeAlpha`', JSON.stringify(withHdr.compositealpha))
  const legacy = lib.materialMetaFor({ vert: '', frag: STAGE, includeBodies: [HDR_COMPOSITE], search: '?fxcomposite=legacy' })
  ok(!legacy.compositealpha && !!legacy.speed, 'A4 `?fxcomposite=legacy` ⇒ 回到"只扫 stage 原文"（回退口真的能关掉它）', Object.keys(legacy).join(','))
  const hdr2 = 'uniform float g_CompositeAlpha;   // {"material":"compositealpha","default":0.25}'
  const win = lib.materialMetaFor({ vert: '', frag: '', includeBodies: [HDR_COMPOSITE, hdr2] })
  ok(win.compositealpha.default === 0.25, 'A5 同名 material 出现在多段里 ⇒ **后者胜**（与"后包含覆盖先包含"一致）', JSON.stringify(win.compositealpha))
  ok(lib.parseMaterialMeta('', null, undefined).constructor === Object, 'A6 空/缺段不抛（`parseMaterialMeta(``, null, undefined)` ⇒ {}）')
  const tc = lib.parseTextureCombos('uniform sampler2D g_Texture1;  // {"combo":"MASK"}')
  ok(tc.length === 1 && tc[0].slot === 1 && tc[0].combo === 'MASK', 'A7 `parseTextureCombos` 一并提到模块作用域且行为不变（纹理 combo 仍按原始 frag 解析）', JSON.stringify(tc))
}

/* ── B 回退开关真值表 ── */
console.log('\n== B 两个回退开关的真值表 ==')
{
  ok(lib.fxCompositeLegacy('?fxcomposite=legacy') === true && lib.fxCompositeLegacy('?fxcomposite=1') === false && lib.fxCompositeLegacy('?x=1') === false,
    'B1 `fxCompositeLegacy`：只认显式 `=legacy`（`?x=1`/其它值一律 false）')
  ok(lib.fboDescLegacy('?fbodesc=legacy') === true && lib.fboDescLegacy('?fbodesc=0') === false && lib.fboDescLegacy('') === false,
    'B2 `fboDescLegacy`：同口径')
  ok(lib.fxCompositeLegacy(undefined) === false && lib.fboDescLegacy(undefined) === false,
    'B3 浏览器路径（`search` 缺省 ⇒ 读 location）在 Node 里不抛、非 legacy（无 location 的夹具也安全）')
}

/* ── C 真语料：这两个键真的被用到 ── */
console.log('\n== C 真语料证据（不是纸上需求）==')
{
  const roots = ['allwallpaper', '.dsh-mpkg-wallpaper'].map((d) => path.join(WS, d)).filter((d) => fs.existsSync(d))
  ok(roots.length > 0, 'C0 找到语料根', roots.map((r) => path.basename(r)).join(','))
  let comp = null, glitter = null
  const scan = (dir, depth) => {
    if (comp && glitter) return
    let list = []
    try { list = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of list) {
      if (comp && glitter) return
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (depth > 0) scan(p, depth - 1); continue }
      if (!/\.(pkg|mpkg)$/i.test(e.name)) continue
      let buf
      try { buf = fs.readFileSync(p) } catch { continue }
      if (!comp && buf.includes('compositealpha')) comp = p
      if (!glitter && buf.includes('_rt_GlitterTiles')) glitter = p
    }
  }
  for (const r of roots) scan(r, 3)
  ok(!!comp, 'C1 语料里真有包声明 `compositealpha`（= P0-2 不是空谈；有该 combo 的 pass 此前是 no-op）', comp ? path.relative(WS, comp) : '（没找到：语料被裁剪？）')
  ok(!!glitter, 'C2 语料里真有包用 `_rt_GlitterTiles`（= P1-8 的 `width/height`+`uvs:"repeat"` 真实用例）', glitter ? path.relative(WS, glitter) : '（没找到）')
}

/* ── D 源码接线 ── */
console.log('\n== D 源码接线（读了但没接上 = 白读）==')
{
  const src = fs.readFileSync(CORE_UNDER_TEST, 'utf8')
  ok(/materialMetaFor\(\{\s*vert:\s*src\.vert,\s*frag:\s*src\.frag,\s*includeBodies:\s*Array\.from\(includeCache\.values\(\)\)/.test(src),
    'D1 `getEffectProgram` 真的把 include 正文喂给了 `materialMetaFor`')
  ok(/getFBO\(fw,\s*fh,\s*ei \+ '\|' \+ f\.name,\s*fboDescOpts\(f\)\)/.test(src),
    'D2 fbo 描述符选项真的传进了 `getFBO(...)`')
  ok(/const wOK = Number\.isFinite\(wRaw\) && wRaw > 0 && wRaw < 65535/.test(src) && /f\.width/.test(src) && /f\.height/.test(src),
    'D3 `fboSizeOf` 读显式 `width`/`height`（u16；65535 = 自适应 ⇒ 不当作显式像素）')
  ok(/gl\.R8/.test(src) && /gl\.RG8/.test(src) && /fmtMode === 'r8'/.test(src) && /fmtMode === 'rg8'/.test(src),
    'D4 `format` 的 `r8`/`rg88` 真的落到 R8/RG8 纹理分配（不是只记一个字段）')
  ok(/fboDescLegacy\(\)/.test(src) && /fxCompositeLegacy\(search\)/.test(src),
    'D5 两个回退开关都在**生产路径**上被读（不是只导出给判据）')
  ok(/wrapMode === 'repeat' \? gl\.REPEAT : gl\.CLAMP_TO_EDGE/.test(src),
    'D6 `uvs:"repeat"` 真的改 FBO 纹理的 WRAP_S/T')
}

/* ── E 变异自证 ── */
if (!NO_MUT) {
  console.log('\n== E 变异自证（副本在 mkdtemp；真树不动）==')
  const { createHash } = await import('node:crypto')
  const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex')
  const before = sha(CORE)
  const src = fs.readFileSync(CORE, 'utf8')
  const mutCore = path.join(tmp, 'core-mut')
  fs.mkdirSync(mutCore, { recursive: true })
  for (const f of fs.readdirSync(path.join(ROOT, 'core'))) {
    const s = path.join(ROOT, 'core', f)
    if (!fs.statSync(s).isFile()) continue
    fs.copyFileSync(s, path.join(mutCore, f))
  }
  const runMutant = (label, from, to, redRe, redName) => {
    const mut = src.split(from).length === 2 ? src.replace(from, to) : null
    if (!mut) { ok(false, label + ' 变异注入成功（锚点唯一）', '锚点没匹配上：' + from.slice(0, 60)); return }
    const copy = path.join(mutCore, 'we-scene-bundle.js')
    fs.writeFileSync(copy, mut)
    const r = spawnSync(process.execPath, [process.argv[1], '--no-mutant'], {
      encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, MPW_FXDESC_CORE: copy },
    })
    const out = (r.stdout || '') + (r.stderr || '')
    ok(redRe.test(out), label, `exit=${r.status} 命中${redName}=${redRe.test(out)}`)
  }
  runMutant('E1 删掉 includeBodies 参数 ⇒ D 组必红（头注解又读不到了）',
    'includeBodies: Array.from(includeCache.values())', 'includeBodies: []', /✗ D1/, 'D1')
  runMutant('E2 删掉 r8 的纹理分配分支 ⇒ D 组必红（format 又只剩记账）',
    "else if (fmtMode === 'r8' && gl.R8) gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, tw, th, 0, gl.RED, gl.UNSIGNED_BYTE, null)",
    'else if (false) void 0', /✗ D4/, 'D4')
  ok(sha(CORE) === before, 'E3 真树 sha256 跑前跑后逐字相同（变异没碰真文件）', sha(CORE).slice(0, 16) + '…')
}

console.log(`\n────\nfx-desc-meta-test：${pass} 通过 / ${fail} 失败`)
if (fail) { console.error('✗ material 注解 / fbo 描述符契约未通过'); process.exit(1) }
console.log('✓ 契约通过：include 头注解进 matMeta + 两个回退口 + 真语料用例 + fbo 描述符接线 + 变异自证')
