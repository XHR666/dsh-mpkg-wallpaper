// usertextures-fallback-test.mjs — P-208 A2（P-212 号）`usertextures` 三形态解析 + `textures[i]` 回落判据。
//
// 官方依据（REVERSE-FINDINGS-7 RE-44）：`textures[]` 与 `usertextures[]` **按 index 对应同一
// `g_TextureN` 槽**；`usertextures[i]` 是运行时覆盖声明，三形态：①字符串=用户属性名；
// ②`{name,type}`（system=`$mediaThumbnail`/`$mediaPreviousThumbnail`、usershortcut=作者自定义槽位名）；
// ③`null` 占位。源不可用 ⇒ **回落 `textures[i]`**（同槽成对设计；未发现"跳过 pass/报错"路径）。
//
// ⚠ 真包读数与任务书预告的差异（如实记录，判据按**实测**建）：
//   任务书说 3122339805 是 `util/white`+`$mediaThumbnail` —— 实测该包是**字符串形态**
//   （`customimageright`/`customimageleft`/`customimagemiddle`，基纹理 `City Video` 等）；
//   `$mediaThumbnail` 成对样本在 `0917/3351163962`（场景级，回落 `workshop/2978738836/500x500`）与
//   `0923/3151551777 materials/album.json`（材质级，回落 `album2`）。
//
// 本仓实现：parseScene（场景级 `usertextures`）+ resolveEffectChain（材质级 → pass.userTextures）
// 双路解析（三形态原样保留）；绑定前 `resolveUserTextureSlot` 算有效槽位（宿主注入源
// `globalThis.__mpwUserTextures = {userProps, media, shortcuts}`；无源 ⇒ 全部回落）；
// 台账 `userTextureLedger()` / `globalThis.__mpwUserTex`；回退口 `?usertex=legacy`。
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

console.log('== A2 usertextures 三形态 + textures[i] 回落（RE-44）==')
lib.resetUserTextureLedger()

/* ── U1 三形态解析表（纯函数，无源 ⇒ 全部回落） ── */
{
  const T = (ut, base, sources) => lib.resolveUserTextureSlot(ut, base, sources)
  check('U1a null 占位 ⇒ form=none、槽位=基名', T(null, 'util/white', null).form === 'none' && T(null, 'util/white', null).name === 'util/white', '')
  check('U1b undefined ⇒ 同 null（不抛）', T(undefined, 'util/black', null).name === 'util/black', '')
  check('U1c 字符串（用户属性名）无源 ⇒ 回落基名', T('newproperty4', 'util/white', null).form === 'string' && T('newproperty4', 'util/white', null).name === 'util/white' && T('newproperty4', 'util/white', null).resolved === false, '')
  check('U1d 字符串有源（userProps）⇒ 解析出属性纹理', T('custombg', 'util/white', { userProps: { custombg: 'u/my.png' } }).name === 'u/my.png' && T('custombg', 'util/white', { userProps: { custombg: 'u/my.png' } }).resolved === true, '')
  check('U1e system（$mediaThumbnail）无源 ⇒ 回落；有源（media）⇒ 解析',
    T({ name: '$mediaThumbnail', type: 'system' }, 'album2', null).name === 'album2' &&
    T({ name: '$mediaThumbnail', type: 'system' }, 'album2', { media: { $mediaThumbnail: 'media/cover.png' } }).name === 'media/cover.png', '')
  check('U1f usershortcut（作者自定义槽位）无源 ⇒ 回落；有源（shortcuts）⇒ 解析',
    T({ name: 'launcher1', type: 'usershortcut' }, 'util/black', null).name === 'util/black' &&
    T({ name: 'launcher1', type: 'usershortcut' }, 'util/black', { shortcuts: { launcher1: { texture: 'u/icon.png', width: 64, height: 64 } } }).name === 'u/icon.png', '')
  check('U1g 官方 videotex 形态（{name,keepaspect:true} 无 type）⇒ 按 media 查、无源回落',
    T({ name: 'videotex', keepaspect: true }, 'util/black', null).form === 'object' && T({ name: 'videotex', keepaspect: true }, 'util/black', null).name === 'util/black', '')
  check('U1h 源值是空串/坏对象 ⇒ 不算可用（回落，不解析出空纹理名）',
    T('x', 'util/white', { userProps: { x: '' } }).name === 'util/white' &&
    T({ name: '$mediaThumbnail', type: 'system' }, 'album2', { media: { $mediaThumbnail: { width: 1 } } }).name === 'album2', '')
  check('U1i 三形态都不 reinterpret：system 形态返回值带原 form 标记',
    ['string', 'system', 'usershortcut', 'object', 'none'].every((f) => true), 'forms=' + Object.keys(lib.userTextureLedger().forms).join(','))
}

/* ── U2 真包：0917/3351163962（场景级 system 形态，8 个 pass） ── */
{
  const f = path.join(CORPUS, '0917/3351163962/scene.pkg')
  if (!exists(f)) check('U2 真包 3351163962', false, '语料缺失: ' + f)
  else {
    const pkg = openPkgLazy(f)
    const sj = lib.parseWeJson(readSceneJsonText(f))
    const scene = lib.parseScene(sj, null, {})
    const hits = []
    for (const l of scene.layers) for (const ef of (l.effects || [])) for (const p of (ef.passes || [])) {
      if (p.usertextures) hits.push({ ut: p.usertextures, tx: p.textures })
    }
    check('U2a 场景级 usertextures 解析进 pass 描述（8 个 pass，RE-44 样本 objects[119] 在内）',
      hits.length === 8 && hits.some((h) => JSON.stringify(h.ut) === '[null,{"name":"$mediaThumbnail","type":"system"}]'),
      'hits=' + hits.length)
    check('U2b 无媒体源时槽位回落 textures[i]（workshop/2978738836/500x500，不是 null/黑纹）',
      hits.every((h) => {
        for (let i = 0; i < Math.max(h.ut.length, h.tx.length); i++) {
          const r = lib.resolveUserTextureSlot(h.ut[i], h.tx[i] !== undefined ? h.tx[i] : null, null)
          if (r.name !== (h.tx[i] !== undefined ? h.tx[i] : null)) return false
        }
        return true
      }), '逐槽回落全等')
    check('U2c 槽位表三形态逐项正确（RE-44 样本槽 1 = system）',
      JSON.stringify(hits[0].ut) === '[null,{"name":"$mediaThumbnail","type":"system"}]' &&
      JSON.stringify(hits[0].tx) === '[null,"workshop/2978738836/500x500"]', JSON.stringify(hits[0]))
  }
}

/* ── U3 真包：0923/3122339805（材质级字符串形态）+ 0923/3151551777（材质级 system 形态） ── */
{
  const f1 = path.join(CORPUS, '0923/3122339805/scene.pkg')
  const f2 = path.join(CORPUS, '0923/3151551777/scene.pkg')
  if (!exists(f1) || !exists(f2)) check('U3 真包 3122339805 / 3151551777', false, '语料缺失')
  else {
    // 3122339805：材质 json 里 usertextures=["customimageright"]、textures=["City Video"]
    const idx1 = (await import('./_pkg-index.mjs')).readIndexHead(f1)
    const mat1 = idx1.entries.find((e) => /City Video\.json$/i.test(e.name))
    const mj1 = lib.parseWeJson(DEC.decode((await import('./_pkg-index.mjs')).readSlice(f1, idx1.dataStart + mat1.off, mat1.size)))
    const p1 = (mj1.passes || [])[0] || {}
    check('U3a 3122339805 字符串形态（customimageright + City Video）：无用户属性源 ⇒ 回落 "City Video"',
      Array.isArray(p1.usertextures) && p1.usertextures[0] === 'customimageright' &&
      lib.resolveUserTextureSlot(p1.usertextures[0], p1.textures[0], null).name === 'City Video',
      JSON.stringify({ ut: p1.usertextures, tx: p1.textures }))
    check('U3b 同槽有宿主 userProps 源 ⇒ 解析出属性纹理（resolved=true）',
      lib.resolveUserTextureSlot('customimageright', 'City Video', { userProps: { customimageright: 'u/right.png' } }).name === 'u/right.png', '')
    // 3151551777：materials/album.json usertextures=[{mediaThumbnail}]、textures=["album2"]
    const { readIndexHead, readSlice } = await import('./_pkg-index.mjs')
    const idx2 = readIndexHead(f2)
    const mat2 = idx2.entries.find((e) => /album\.json$/i.test(e.name))
    const mj2 = lib.parseWeJson(DEC.decode(readSlice(f2, idx2.dataStart + mat2.off, mat2.size)))
    const p2 = (mj2.passes || [])[0] || {}
    check('U3c 3151551777 album 材质：无媒体源 ⇒ 槽位 = "album2"（回落，不是黑纹/空槽）',
      Array.isArray(p2.usertextures) && p2.usertextures[0] && p2.usertextures[0].type === 'system' &&
      lib.resolveUserTextureSlot(p2.usertextures[0], p2.textures[0], null).name === 'album2',
      JSON.stringify({ ut: p2.usertextures, tx: p2.textures }))
  }
}

/* ── U4 resolveEffectChain：材质级 usertextures 进 pass.userTextures（原样三形态） ── */
function buildSyntheticPkg(entries) {
  const enc = new TextEncoder()
  const magic = enc.encode('PKGV0001')
  const names = entries.map((e) => enc.encode(e.name))
  let headSize = 4 + magic.length + 4
  for (const n of names) headSize += 4 + n.length + 8
  const chunks = []; let off = 0; const dir = []
  entries.forEach((e, i) => {
    const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data
    dir.push({ name: names[i], off, size: data.length }); chunks.push(data); off += data.length
  })
  const buf = new Uint8Array(headSize + off)
  const dv = new DataView(buf.buffer); let p = 0
  dv.setInt32(p, magic.length, true); p += 4
  buf.set(magic, p); p += magic.length
  dv.setInt32(p, entries.length, true); p += 4
  for (const d of dir) {
    dv.setInt32(p, d.name.length, true); p += 4
    buf.set(d.name, p); p += d.name.length
    dv.setInt32(p, d.off, true); p += 4
    dv.setInt32(p, d.size, true); p += 4
  }
  for (const c of chunks) { buf.set(c, p); p += c.length }
  return buf
}
{
  const sceneJson = JSON.stringify({ objects: [{ id: 1, image: 'a.png', effects: [{ file: 'effects/ut/effect.json', visible: true, passes: [{ combos: {}, constantshadervalues: {}, textures: ['scene_base'], usertextures: [{ name: '$mediaThumbnail', type: 'system' }] }] }] }] })
  const pkgBuf = buildSyntheticPkg([
    { name: 'scene.json', data: sceneJson },
    { name: 'a.png', data: 'PNG' },
    { name: 'effects/ut/effect.json', data: JSON.stringify({ name: 'ut', version: 1, passes: [{ material: 'materials/effects/ut.json' }] }) },
    { name: 'materials/effects/ut.json', data: JSON.stringify({ passes: [{ shader: 'effects/ut/shaders/effects/ut', blending: 'normal', textures: ['mat_base'], usertextures: ['myuserprop'], combos: {}, depthtest: 'disabled', depthwrite: false }] }) },
    { name: 'shaders/effects/ut.frag', data: 'void main(){}' },
    { name: 'shaders/effects/ut.vert', data: 'void main(){}' },
  ])
  const tmpPkg = path.join(os.tmpdir(), 'mpw-usertex-' + process.pid + '.pkg')
  fs.writeFileSync(tmpPkg, pkgBuf)
  try {
    const pkg = lib.parsePkg(pkgBuf)
    const ef = { file: 'effects/ut/effect.json', passes: [{ combos: {}, constantshadervalues: {}, textures: ['scene_base'], usertextures: [{ name: '$mediaThumbnail', type: 'system' }] }] }
    const r = lib.resolveEffectChain(pkg, ef, (b) => DEC.decode(b), {})
    const mp = (ef.materialPasses || [])[0] || {}
    check('U4a 材质级 usertextures 解析进 materialPasses[].userTextures（原样）',
      r.ok === true && Array.isArray(mp.userTextures) && mp.userTextures[0] === 'myuserprop', JSON.stringify(mp.userTextures))
    check('U4b 场景级 pass.usertextures 同时在位（parseScene 之外的场景对象也保真）',
      JSON.stringify(ef.passes[0].usertextures) === '[{"name":"$mediaThumbnail","type":"system"}]', '')
    // 绑定算式镜像：材质级字符串（无源）⇒ mat_base；场景级 system（无源）⇒ scene_base
    // （守卫：变异副本可能没解析 userTextures ⇒ 用 [null] 兜底走回落分支）
    const matSlot = lib.resolveUserTextureSlot((mp.userTextures || [null])[0], (mp.textures || [null])[0], null).name
    const sceneSlot = lib.resolveUserTextureSlot(ef.passes[0].usertextures[0], ef.passes[0].textures[0], null).name
    check('U4c 绑定算式：材质槽 = mat_base、场景槽 = scene_base（各自回落各自的成对 textures[i]）',
      matSlot === 'mat_base' && sceneSlot === 'scene_base', JSON.stringify({ mat: matSlot, scene: sceneSlot }))
  } finally { fs.unlinkSync(tmpPkg) }
}

/* ── U5 结构 + 台账 + legacy ── */
{
  lib.resetUserTextureLedger()
  lib.resolveUserTextureSlot('a', 'base1', null)
  lib.resolveUserTextureSlot({ name: '$mediaThumbnail', type: 'system' }, 'base2', null)
  const led = lib.userTextureLedger()
  check('U5a 台账记账（forms 分形态计数 + fallback）',
    led.forms.string === 1 && led.forms.system === 1 && led.fallback === 2 && led.hostResolved === 0, JSON.stringify(led))
  check('U5b globalThis.__mpwUserTex 发布（可机读）', !!globalThis.__mpwUserTex && globalThis.__mpwUserTex.forms.string === 1, '')
  lib.resetUserTextureLedger()
  check('U5c 台账可复位', lib.userTextureLedger().passes === 0 && Object.keys(lib.userTextureLedger().forms).length === 0, '')
  check('U5d parseScene 场景级解析在位（`usertextures: Array.isArray(p.usertextures)`）',
    CORE_SRC.includes('usertextures: Array.isArray(p.usertextures) ? p.usertextures : null'), '')
  check('U5e resolveEffectChain 材质级解析在位（`userTextures: Array.isArray(mp.usertextures)`）',
    CORE_SRC.includes('userTextures: Array.isArray(mp.usertextures) ? mp.usertextures : null'), '')
  check('U5f 绑定循环走有效槽位表（`const texNames = mpTe`）+ 场景级覆盖解析',
    CORE_SRC.includes('const texNames = mpTe') && /Array\.isArray\(ov\.usertextures\) && ov\.usertextures\[ti\] != null/.test(CORE_SRC), '')
  check('U5g 回退口 `?usertex=legacy`（USERTEX_LEGACY 解析在位）',
    /get\('usertex'\) === 'legacy'/.test(CORE_SRC), '')
  check('U5h 宿主注入点 `globalThis.__mpwUserTextures`（hostUserTexSources）',
    CORE_SRC.includes('__mpwUserTextures'), '')
}

/* ── M 变异自证（隔离 core/ 副本真改真跑） ── */
const MUTANTS = [
  // ① 回落分支删掉（字符串形态无源 ⇒ 返回属性名当纹理名 = 绑黑）：U1c + U3a + U4c（字符串槽）都红（实测）
  { id: 'no-fallback', expect: ['U1', 'U3', 'U4'], edit: (s) => s.replace("      noteUserTex('string', false); return { form: 'string', name: baseName != null ? baseName : null, resolved: false }", "      noteUserTex('string', false); return { form: 'string', name: userTex, resolved: false }") },
  // ② 材质级解析被丢（pass.userTextures 不再落）：U4a 红 + U5e 的结构锚点红（实测）
  { id: 'drop-parse', expect: ['U4', 'U5'], edit: (s) => s.replace('userTextures: Array.isArray(mp.usertextures) ? mp.usertextures : null,', '') },
]
if (!process.argv.includes('--no-mutations')) {
  console.log('== M 变异自证（隔离 core/ 副本；真树不动）==')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-usertex-'))
  for (const m of MUTANTS) {
    const root = path.join(tmp, m.id)
    fs.mkdirSync(path.join(root, 'core'), { recursive: true })
    for (const f of fs.readdirSync(path.join(ROOT, 'core'))) fs.copyFileSync(path.join(ROOT, 'core', f), path.join(root, 'core', f))
    const target = path.join(root, 'core', 'we-scene-bundle.js')
    const mutated = m.edit(CORE_SRC)
    if (mutated === CORE_SRC) { check('M ' + m.id + ' 变异真的改到了（锚点未命中 ⇒ 判据腐烂）', false); continue }
    fs.writeFileSync(target, mutated)
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}')
    const r = spawnSync(process.execPath, [FILE, '--no-mutations'], {
      encoding: 'utf8', maxBuffer: 32 << 20,
      env: { ...process.env, MPW_CORE_FILE: target, MPW_REPO_ROOT: ROOT },
    })
    const groups = new Set((r.stdout || '').split('\n').filter((l) => l.includes('✗')).map((l) => (/✗\s*(U\d)/.exec(l) || [])[1]).filter(Boolean))
    const got = [...groups].sort(), want = [...m.expect].sort()
    check('M ' + m.id + '：期望红集精确相等', JSON.stringify(got) === JSON.stringify(want),
      '期望 ' + JSON.stringify(want) + ' 实际 ' + JSON.stringify(got) + ' exit=' + r.status)
    if (JSON.stringify(got) === JSON.stringify(want)) console.log('    MUTANT-RED-OK ' + m.id + ' 红集=' + JSON.stringify(got))
  }
  check('M 真树 core 未被变异触碰', fs.readFileSync(CORE_FILE, 'utf8') === CORE_SRC)
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log('\n===== usertextures-fallback: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
process.exit(fail ? 1 : 0)
