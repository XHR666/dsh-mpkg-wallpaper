// we-core-parity-test.mjs — P2-1（C1）黑盒对拍：`packages/we-core`（MIT，独立实现）与
// `core/we-scene-bundle.js`（GPL-3.0-or-later，本仓参考实现）在**同一份真语料**上逐字节一致。
//
// 对拍口径（只比字节结果，不读对方源码）：
//   ① PKG 条目表：magic / version / count / dataStart / fileSize / 每个 {name,offset,size}
//   ② 每个条目的载荷字节：sha256 + 长度
//   ③ TEX：头部字段（format/formatName/flags/尺寸/freeImageFormat/containerMagic/containerVersion/isVideo）、
//      每个 image×mip 的 {width,height,compression} 与**载荷字节**（= 解 LZ4 后的像素/媒体字节）、TEXS sprite
//   ④ 矩阵：确定性伪随机输入下的 mat4Identity/Multiply/Translate/Scale/RotateZ/Ortho/Perspective/LookAt/TransformPoint
//      逐元素（Float32 位）相等
//   ⑤ **变异自证**：把 we-core/src 拷到临时目录后按字节改坏 1 处，断言对拍**必红**（三处独立变异，
//      分别打中 formatName / LZ4 解码 / 正交投影三条比较路径）
//
// 资源：只读 2 个小包（3.9MB + 7.1MB），不整包读大文件；单次 <60s / <300MB（含变异阶段）。
// 缺语料时整体 SKIP（退出 0），与仓库既有条件项口径一致。
//
// 用法: node tests/we-core-parity-test.mjs [--pkg <file.pkg> ...] [--json]
//
// ── 注册待办（**本任务不改 `tests/run-all-tests.sh`**，由主对话登记；建议行）────────────
//   add "we-core-parity" "node tests/we-core-parity-test.mjs" "" "^SKIP we-core-parity"
//   # P2-1（C1）：we-core（MIT）↔ core/** 黑盒对拍（pkg 条目 sha256 / tex mip 载荷字节 / mat4 逐元素）
//   #   + 变异自证；~1s；缺语料 SKIP
// ─────────────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')
const MPW_WS = process.env.MPW_ROOT || path.resolve(ROOT, '..')
const JSON_OUT = process.argv.includes('--json')

const jsonArgIdx = process.argv.indexOf('--json')
const pkgArgs = []
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--pkg') { pkgArgs.push(process.argv[++i]); continue }
  if (i === jsonArgIdx) continue
}
const DEFAULT_PKGS = [
  path.join(MPW_WS, 'allwallpaper', 'dd', '3715743282', 'scene.pkg'),        // 3.9MB：v4/JPEG/PNG + v3/mips10/LZ4
  path.join(MPW_WS, 'allwallpaper', '0917', '3250755486', 'scene.pkg'),      // 7.1MB：v3 GIF 精灵表 + JPEG + R8/LZ4
]
const pkgs = (pkgArgs.length ? pkgArgs : DEFAULT_PKGS).map((p) => path.resolve(p))

const results = []
let failures = 0
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail })
  if (!ok) failures++
  const mark = ok ? '✓' : '✗'
  console.log(`${mark} ${name}${detail ? ' — ' + detail : ''}`)
}

if (JSON_OUT) console.log = (...a) => process.stderr.write(a.join(' ') + '\n')

const sha256 = (bytes) => crypto.createHash('sha256').update(Buffer.from(bytes.buffer ?? bytes, bytes.byteOffset ?? 0, bytes.byteLength ?? bytes.length)).digest('hex')
const present = pkgs.filter((p) => fs.existsSync(p))
if (present.length === 0) {
  console.log(`SKIP we-core-parity（未找到语料：${pkgs.join('、')}；设 MPW_ROOT 或 --pkg 指定）`)
  process.exit(0)
}

// 候选（MIT 包）与参考（本仓 GPL 侧）——**只在此测试里同时 import**，we-core 自身不 import core/**
const core = await import(path.join(ROOT, 'packages', 'we-core', 'src', 'index.js'))
const ref = await import(path.join(ROOT, 'core', 'we-scene-bundle.js'))

// ── ① + ② PKG 条目表与载荷 ────────────────────────────────────────────────────────────
for (const file of present) {
  const rel = path.relative(ROOT, file)
  const buf = fs.readFileSync(file)
  let a, b
  try {
    a = core.parsePkg(buf)
    b = ref.parsePkg(buf)
  } catch (err) {
    check(`${rel}: parsePkg 双方都不抛`, false, err.message)
    continue
  }
  const tableOf = (p) => JSON.stringify({ magic: p.magic, version: p.version, count: p.count, dataStart: p.dataStart, fileSize: p.fileSize, entries: p.entries })
  check(`${rel}: 条目表逐字段相同`, tableOf(a) === tableOf(b), `magic=${a.magic} count=${a.count} dataStart=${a.dataStart} fileSize=${a.fileSize}`)
  check(`${rel}: 条目名集合相同（顺序一致）`, core.entryNames(a).join('\n') === b.entries.map((e) => e.name).join('\n'), `${a.count} 条目`)

  let entryDiff = 0
  let firstBad = ''
  let digest = ''
  for (const e of a.entries) {
    const ea = core.getEntry(a, e.name)
    const eb = ref.getEntry(b, e.name)
    const ha = sha256(ea)
    const hb = sha256(eb)
    if (ha !== hb || ea.length !== eb.length) { entryDiff++; if (!firstBad) firstBad = e.name }
  }
  digest = sha256(Buffer.concat(a.entries.map((e) => Buffer.from(sha256(core.getEntry(a, e.name)), 'hex'))))
  check(`${rel}: 每个条目载荷 sha256 相同`, entryDiff === 0, `${a.count} 条目全等；条目摘要 sha256=${digest.slice(0, 16)}…`)

  // ── ③ TEX 头部 / mip 载荷 / sprite ────────────────────────────────────────────────
  const texEntries = a.entries.filter((e) => /\.tex$/i.test(e.name))
  let metaDiff = 0, mipDiff = 0, byteDiff = 0, spriteDiff = 0, mipCount = 0
  const metaOf = (t) => JSON.stringify({ format: t.format, formatName: t.formatName, flags: t.flags, tw: t.textureWidth, th: t.textureHeight, w: t.width, h: t.height, fif: t.freeImageFormat, cm: t.containerMagic, cv: t.containerVersion, video: t.isVideo })
  const shapeOf = (t) => JSON.stringify(t.images.map((im) => im.map((m) => [m.width, m.height, m.compression])))
  for (const e of texEntries) {
    const ta = core.parseTex(core.getEntry(a, e.name))
    const tb = ref.parseTex(ref.getEntry(b, e.name))
    if (metaOf(ta) !== metaOf(tb)) metaDiff++
    if (shapeOf(ta) !== shapeOf(tb)) mipDiff++
    if (JSON.stringify(ta.sprite) !== JSON.stringify(tb.sprite)) spriteDiff++
    for (let i = 0; i < ta.images.length; i++) {
      for (let j = 0; j < ta.images[i].length; j++) {
        mipCount++
        if (sha256(ta.images[i][j].data) !== sha256(tb.images[i][j].data)) byteDiff++
      }
    }
  }
  check(`${rel}: TEX 头部字段相同`, metaDiff === 0, `${texEntries.length} 个 .tex`)
  check(`${rel}: image×mip 形状（宽高/compression）相同`, mipDiff === 0, `${mipCount} 个 mip`)
  check(`${rel}: mip 载荷字节（LZ4 解压后）逐字节相同`, byteDiff === 0, `${mipCount} 个 mip 的 sha256 全等`)
  check(`${rel}: TEXS 精灵表结构相同`, spriteDiff === 0)
  buf.fill?.(0) // 及时放掉大 Buffer（不依赖 GC 时机）
}

// ── ④ 矩阵：确定性伪随机输入，逐元素（Float32 位）比较 ─────────────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rnd = mulberry32(0x5eed)
const mats = []
for (let i = 0; i < 24; i++) mats.push(Float32Array.from({ length: 16 }, () => (rnd() * 40 - 20)))
const same = (x, y) => x.length === y.length && Array.from(x).every((v, i) => Object.is(v, y[i]))

let mulDiff = 0
for (let i = 0; i < mats.length; i++) {
  for (let j = 0; j < mats.length; j++) if (!same(core.mat4Multiply(mats[i], mats[j]), ref.mat4Multiply(mats[i], mats[j]))) mulDiff++
}
check('mat4Multiply 逐元素相同', mulDiff === 0, `${mats.length * mats.length} 组输入，0 处差异`)

let ctorDiff = 0
const notes = []
for (let i = 0; i < 16; i++) {
  const t = rnd() * 20 - 10
  const orthoArgs = [t, t + 1 + rnd() * 100, rnd() * 8 - 4, rnd() * 8 - 4, -10000 * (1 + i), 10000 * (1 + i)]
  if (!same(core.mat4Ortho(...orthoArgs), ref.mat4Ortho(...orthoArgs))) { ctorDiff++; notes.push('ortho') }
  const perspArgs = [0.2 + rnd() * 2, 0.5 + rnd() * 2, 0.01 + rnd(), 10 + rnd() * 1000]
  if (!same(core.mat4Perspective(...perspArgs), ref.mat4Perspective(...perspArgs))) { ctorDiff++; notes.push('perspective') }
  const eye = [rnd() * 20 - 10, rnd() * 20 - 10, 1 + rnd() * 10]
  const center = [rnd() * 10 - 5, rnd() * 10 - 5, rnd() * 4 - 2]
  if (!same(core.mat4LookAt(eye, center, [0, 1, 0]), ref.mat4LookAt(eye, center, [0, 1, 0]))) { ctorDiff++; notes.push('lookAt') }
  const base = mats[i]
  const tx = t, ty = -t, tz = t / 3
  if (!same(core.mat4Translate(base, tx, ty, tz), ref.mat4Translate(base, tx, ty, tz))) { ctorDiff++; notes.push('translate') }
  const sx = 1 + rnd(), sy = 1 + rnd(), sz = 1 + rnd()
  if (!same(core.mat4Scale(base, sx, sy, sz), ref.mat4Scale(base, sx, sy, sz))) { ctorDiff++; notes.push('scale') }
  const rad = rnd() * 6.28
  if (!same(core.mat4RotateZ(base, rad), ref.mat4RotateZ(base, rad))) { ctorDiff++; notes.push('rotateZ') }
}
check('mat4Ortho/Perspective/LookAt/Translate/Scale/RotateZ 逐元素相同', ctorDiff === 0, notes.length ? [...new Set(notes)].join(',') : '16 轮参数全等')
check('mat4Identity 逐元素相同', same(core.mat4Identity(), ref.mat4Identity()))

let tpDiff = 0
for (const m of mats) {
  for (const [x, y, z] of [[0, 0, 0], [1, 2, 3], [-4.5, 0.25, 8], [123.5, -67.25, 0.5]]) {
    const p1 = core.mat4TransformPoint(m, x, y, z)
    const p2 = ref.mat4TransformPoint(m, x, y, z)
    if (p1.length !== p2.length || p1.some((v, i) => !Object.is(v, p2[i]))) tpDiff++
  }
}
check('mat4TransformPoint 逐元素相同（含 w 除法）', tpDiff === 0, `${mats.length * 4} 组输入`)

// ── ⑤ 变异自证：改坏 we-core 一个字节 ⇒ 对拍必红 ──────────────────────────────────────
const SRC = path.join(ROOT, 'packages', 'we-core', 'src')
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'we-core-mut-'))
let mutantSeq = 0
function copySrc(dir) {
  fs.mkdirSync(dir, { recursive: true })
  for (const f of fs.readdirSync(SRC)) fs.copyFileSync(path.join(SRC, f), path.join(dir, f))
}
function mutate(relFile, token, replacement) {
  const dir = path.join(tmpRoot, 'v' + mutantSeq++)
  copySrc(dir)
  const file = path.join(dir, relFile)
  const src = fs.readFileSync(file, 'utf8')
  const at = src.indexOf(token)
  if (at < 0) throw new Error(`变异目标缺失: ${relFile} :: ${token}`)
  if (src.indexOf(token, at + 1) >= 0) throw new Error(`变异目标不唯一: ${relFile} :: ${token}`)
  const mutated = src.slice(0, at) + replacement + src.slice(at + token.length)
  // 断言"恰好改坏 1 个字节"（长度相同、只有 1 处字符不同）
  let diffs = 0
  for (let i = 0; i < Math.max(src.length, mutated.length); i++) if (src[i] !== mutated[i]) diffs++
  if (src.length !== mutated.length || diffs !== 1) throw new Error(`变异不是单字节: ${relFile} diffs=${diffs}`)
  fs.writeFileSync(file, mutated)
  return dir
}

async function mutatedModule(relFile, token, replacement) {
  const dir = mutate(relFile, token, replacement)
  return import(pathToFileURL(path.join(dir, 'index.js')).href)
}

// 三处变异分别打中 ③formatName / ③LZ4 载荷 / ④正交投影 三条比较路径 —— 用**同一套比较器**跑，
// 断言"必红"，即比较函数在变异体上确实报出差异（而不是拿来一个无关紧要的字节）。
const probeFile = present[0]
const probeBuf = fs.readFileSync(probeFile)
const probePkg = core.parsePkg(probeBuf)
const probeRefPkg = ref.parsePkg(probeBuf)
// 选一个**带 LZ4 mip**的 tex 作探针，否则 LZ4 变异打不中比较路径
const refTexOf = (e) => ref.parseTex(ref.getEntry(probeRefPkg, e.name))
const hasLz4Mip = (e) => refTexOf(e).images.some((im) => im.some((m) => m.compression === 1))
const lz4ProbeEntry = probePkg.entries.find((e) => /\.tex$/i.test(e.name) && hasLz4Mip(e))
const probeTexEntry = lz4ProbeEntry || probePkg.entries.find((e) => /\.tex$/i.test(e.name))
const probeRefTex = probeTexEntry ? refTexOf(probeTexEntry) : null

async function detectByFormatName(mod) {
  const t = mod.parseTex(mod.getEntry(mod.parsePkg(probeBuf), probeTexEntry.name))
  return t.formatName !== probeRefTex.formatName
}
async function detectByMipBytes(mod) {
  const t = mod.parseTex(mod.getEntry(mod.parsePkg(probeBuf), probeTexEntry.name))
  const refMips = probeRefTex.images[0]
  for (let j = 0; j < t.images[0].length; j++) if (sha256(t.images[0][j].data) !== sha256(refMips[j].data)) return true
  return false
}
async function detectByOrtho(mod) {
  const args = [0, 64, 0, 32, -10000, 10000]
  return !same(mod.mat4Ortho(...args), ref.mat4Ortho(...args))
}
const mutations = []
if (probeTexEntry) mutations.push(['format.js', "0: 'ARGB8888'", "0: 'ARGB8889'", 'TEX formatName', detectByFormatName])
if (lz4ProbeEntry) mutations.push(['lz4.js', 'matchLength += 4', 'matchLength += 5', 'LZ4 mip 载荷', detectByMipBytes])
else console.log('· 跳过 LZ4 变异（本语料没有 compression=1 的 mip 作探针）')
mutations.push(['mat4.js', 'out[5] = 2 / (bottom - top)', 'out[5] = 3 / (bottom - top)', 'mat4Ortho', detectByOrtho])
if (!probeTexEntry) console.log('· 跳过 TEX 变异（本语料没有 .tex 条目作探针）')
for (const [file, token, repl, label, detect] of mutations) {
  let mod
  try {
    mod = await mutatedModule(file, token, repl)
  } catch (err) {
    check(`变异自证（${label}）：变异体仍可加载`, false, err.message)
    continue
  }
  let detected = false
  try {
    detected = await detect(mod)
  } catch {
    detected = true // 变异体在对拍路径上抛错 = 对拍同样"红"
  }
  check(`变异自证（${label}）：改坏 ${file} 一个字节后对拍必红`, detected, `探针 ${probeTexEntry.name}；token "${token}" → "${repl}"`)
}

//  pristine 对照：同一批比较器在未变异模块上不得报差异（否则"变红"可能只是比较器恒红）
let pristineRed = 0
if (await detectByFormatName(core)) pristineRed++
if (await detectByMipBytes(core)) pristineRed++
if (await detectByOrtho(core)) pristineRed++
check('变异自证对照：未变异的 we-core 在同一比较器上全绿', pristineRed === 0, `3 条比较路径 0 命中`)

fs.rmSync(tmpRoot, { recursive: true, force: true })

const pass = results.filter((r) => r.ok).length
console.log(`\nwe-core-parity：${pass}/${results.length} 断言通过${failures ? `，${failures} 处红` : ''}`)
if (JSON_OUT) process.stdout.write(JSON.stringify({ pass, fail: failures, results }) + '\n')
process.exit(failures ? 1 : 0)
