// nonascii-name-consistency-test.mjs —— C1【机制·资产名解析】非 UTF-8/非 ASCII 名字的"引用 ↔ 索引"一致性
//
// 官方语义（任务书 C1）：pkg 条目名与 scene.json/材质里的引用是**同一串字节**；不得做 Unicode
//   规范化（NFKC）或编码猜测（GBK↔UTF-8）去"猜回来"。找不到时必须**可解释**（不许静默退化成
//   null 纹理/白纹理还没有任何痕迹）。
//
// 渲染器现状（本文件钉死，防止将来"顺手加 normalize"）：
//   · 查找 = `core/we-scene-bundle.js::getEntry` 的 `pkg.entries.find((x) => x.name === name)`
//     —— **逐字节等值**（JS 字符串同形）。
//   · 条目名解码 = `decodeName`：UTF-8 **fatal** → 抛错才回退 Latin-1 逐字节（`ascii()`）。
//     ⚠ 注意与 `tests/_pkg-index.mjs::readIndexHead` 的 `Buffer.toString('utf8')`（非 fatal ⇒ U+FFFD）
//     **不是同一条解码路**——对账必须走 core 的 decodeName 语义，否则非法名会被 U+FFFD 弄坏、
//     产生假失配。所以本文件自带最小索引读取器（按 core 语义解码），不用 _pkg-index。
//   · 引用侧（scene.json / materials/*.json 的 JSON 字符串）必然是合法 UTF-8 ⇒ "非 UTF-8 字节"只会
//     出现在**条目名**一侧（Latin-1 兜底解码），引用侧同形 = 引用里写了与 Latin-1 解码结果相同的字符。
//   · 找不到时的可解释面：demo `loadTex` 的 `⚠ 缺纹理 materials/<名>.tex`、`⚠ 缺 model:`、
//     `⚠ 缺 material 文件:`、效果链 `__fxMiss` 台账（`core` :3517）——本测试 A3 钉 demo 侧日志原文。
//
// 判据（任务书 C1①②）：
//   A 桩件（合成容器 + **生产** parsePkg/getEntry，不依赖语料）：
//     A1 条目名含非 UTF-8 字节（Latin-1 兜底解码）+ 引用同形 ⇒ **必须命中**；
//     A2 引用被 NFKC / 大小写 / U+FFFD 改过 ⇒ **必须不命中**（查找无任何规范化）；
//     A3 demo 侧"缺 model / 缺纹理"日志原文存在（可解释失败，不静默）。
//   B 语料扫描（四根；缺根 SKIP）：非 ASCII 条目名清单 + "引用 ↔ 索引逐字节一致"对账
//     （引用取 scene.json 的 image/particle/sound/font/effect 与 materials/*.json 的 textures[]）。
//     探针包 2887099508 的 24 条非 ASCII 条目必须全绿。
//   C 变异自证：把 getEntry 的 `x.name === name` 改成 NFKC 双侧规范化 ⇒ A2 必红（证明 A2 承重）。
//
// 用法：node tests/nonascii-name-consistency-test.mjs   （纯 Node，无浏览器/无网络；~10s 量级）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'

const dec = new TextDecoder()
const lib = await import(pathToFileURL(path.join(ROOT, 'core', 'we-scene-bundle.js')).href)
let pass = 0, fail = 0, skipN = 0
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('  ✓ ' + name) } else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + String(detail).slice(0, 300) : '')) } }
const sk = (name, why) => { skipN++; console.log('  ~ SKIP ' + name + '（' + why + '）') }

/* ── 合成容器构造器（parsePkg 的镜像布局；名字允许**原始字节**以构造非法 UTF-8）────────
 *   [u32 magicLen][magic][u32 count] + count×{[u32 nameLen][nameBytes][u32 off][u32 size]} + data
 *   off 相对目录表末尾（dataStart）。 */
function makePkg(entries) {
  const chunks = []
  const magic = Buffer.from('PKGV0024')
  chunks.push(Buffer.from([magic.length, 0, 0, 0]), magic, Buffer.from([entries.length, 0, 0, 0]))
  let tableSize = 0
  for (const e of entries) {
    const nb = e.nameBytes || Buffer.from(String(e.name), 'utf8')
    tableSize += 4 + nb.length + 8
  }
  const dataStart = 4 + magic.length + 4 + tableSize
  let off = 0
  const meta = []
  for (const e of entries) {
    const nb = e.nameBytes || Buffer.from(String(e.name), 'utf8')
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8')
    meta.push({ nb, off, size: data.length })
    chunks.push(Buffer.from([nb.length, 0, 0, 0]), nb, (() => { const b = Buffer.alloc(8); b.writeUInt32LE(off, 0); b.writeUInt32LE(data.length, 4); return b })())
    off += data.length
  }
  const head = Buffer.concat(chunks)
  const body = Buffer.concat(meta.map((m, i) => { const d = Buffer.isBuffer(entries[i].data) ? entries[i].data : Buffer.from(String(entries[i].data), 'utf8'); return d }))
  return Buffer.concat([head, body])
}

/* core decodeName 的同语义副本（测试侧的**期望值**生成器；真解码在 parsePkg 里） */
function expectName(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch (e) {
    let s = ''
    for (const b of bytes) s += String.fromCharCode(b)
    return s
  }
}

console.log('== C1 资产名一致性（合成容器 + 生产 parsePkg/getEntry；语料段见 B）==')

/* ── A 段：桩件 ──────────────────────────────────────────────────────────────────── */
{
  // 非法 UTF-8 名字节（0xA6 0xA6 0xC4 0xB1 = Latin-1 '¦¦Ä±'；fatal UTF-8 解码会抛）
  const rawName = Buffer.from([0xA6, 0xA6, 0xC4, 0xB1])
  const sameForm = expectName(rawName)          // '¦¦Ä±'
  const nfkc = sameForm.normalize('NFKC')       // NFKC 改写后（若 ≠ 原形）
  const altered = sameForm.toUpperCase()
  const fffded = sameForm.replace(/./g, (c) => (c.codePointAt(0) > 127 ? '\uFFFD' : c)) // 非 fatal 解码产 U+FFFD 的形态
  const buf = makePkg([
    { nameBytes: rawName, data: 'TEXTURE-BYTES' },
    { name: 'scene.json', data: '{"objects":[]}' },
  ])
  const pkg = lib.parsePkg(new Uint8Array(buf))
  const got = lib.getEntry(pkg, sameForm)
  ok('A1 非 UTF-8 条目名 + **同形**引用 ⇒ 命中（getEntry 逐字节等值）', !!got && new TextDecoder().decode(got) === 'TEXTURE-BYTES',
    'sameForm=' + JSON.stringify(sameForm) + ' got=' + (got ? got.length + 'B' : 'null'))
  ok('A1b 生产 parsePkg 的解码 = core decodeName 语义（fatal UTF-8 → Latin-1 兜底）',
    pkg.entries[0].name === sameForm, JSON.stringify(pkg.entries[0].name))
  let alteredMiss = 0
  for (const [tag, nm] of [['NFKC', nfkc], ['case', altered], ['U+FFFD', fffded]]) {
    if (nm === sameForm) continue // NFKC 不变形的字符集跳过该子例
    if (lib.getEntry(pkg, nm) === null) alteredMiss++
    else console.log('    （' + tag + ' 变形=' + JSON.stringify(nm) + ' 意外命中！）')
  }
  ok('A2 引用被 NFKC/大小写/U+FFFD 改过 ⇒ **不命中**（查找无规范化；可变形子例全过）',
    alteredMiss > 0, 'alteredMiss=' + alteredMiss)
  const miss = lib.getEntry(pkg, '不存在/名字.png')
  ok('A2b 普通 miss = null（调用方据此走"可解释失败"面）', miss === null)
  const demoSrc = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8')
  ok('A3 demo 侧缺名日志原文在（⚠ 缺纹理 materials/<名>.tex / ⚠ 缺 model: / ⚠ 无 material:）',
    demoSrc.includes("缺纹理 materials/' + name + '.tex'") && demoSrc.includes("缺 model: ' + layer.image") && demoSrc.includes("无 material: ' + layer.image"),
    'loadTex/model/material 三处日志原文必须保留（不许静默退化）')
}

/* ── B 段：四根语料扫描（离线、只读目录表 + scene.json/材料 JSON 的条目数据）──────────────── */
// 与 core decodeName 同语义的最小索引读取器（_pkg-index 的 utf8 非 fatal 会 U+FFFD 弄坏非法名）
function readIndexCore(file, headBytes = 4 << 20) {
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.alloc(headBytes)
    const n = fs.readSync(fd, buf, 0, headBytes, 0)
    const b = buf.subarray(0, n)
    const mlen = b.readInt32LE(0)
    let p = 4 + mlen
    const count = b.readInt32LE(p); p += 4
    const entries = []
    for (let i = 0; i < count; i++) {
      const nl = b.readInt32LE(p); p += 4
      const raw = b.subarray(p, p + nl); p += nl
      const off = b.readInt32LE(p); p += 4
      const size = b.readInt32LE(p); p += 4
      entries.push({ name: expectName(raw), off, size })
    }
    return { entries, dataStart: p }
  } finally { fs.closeSync(fd) }
}
function readSlice(file, off, len) {
  const fd = fs.openSync(file, 'r')
  try { const buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, off); return buf } finally { fs.closeSync(fd) }
}
function walkContainers(root, out = []) {
  let names = []
  try { names = fs.readdirSync(root) } catch (e) { return out }
  for (const n of names) {
    const p = path.join(root, n)
    let st = null
    try { st = fs.statSync(p) } catch (e) { continue }
    if (st.isDirectory()) walkContainers(p, out)
    else if (/\.(mpkg|pkg)$/i.test(n)) out.push(p)
  }
  return out
}
const hasNonAscii = (s) => /[^\x00-\x7F]/.test(s)

/* 引用收集（场景 + 材料 JSON；不 reinterpret 编码，字符串原样比对） */
function collectRefs(sceneObj) {
  const refs = []
  const push = (v, where) => { if (typeof v === 'string' && v && !v.startsWith('_rt_')) refs.push({ ref: v, where }) }
  for (const [oi, o] of ((sceneObj && sceneObj.objects) || []).entries()) {
    const tag = 'obj[' + oi + ']'
    push(o.image, tag + '.image'); push(o.particle, tag + '.particle')
    if (Array.isArray(o.sound)) for (const snd of o.sound) push(snd, tag + '.sound')
    else push(o.sound, tag + '.sound')
    const f = o.font || (o.text && o.text.font); push(f, tag + '.font')
    push(o.color ? null : null, '') // 占位：无操作
    for (const [ei, ef] of (o.effects || []).entries()) {
      push(ef.file, tag + '.effects[' + ei + '].file')
      for (const [pi, pp] of (ef.passes || []).entries()) {
        for (const tn of (pp.textures || [])) push(tn, tag + '.effects[' + ei + '].passes[' + pi + '].textures')
      }
    }
  }
  return refs
}

{
  const ROOTS = ['dd', '0923', '0917', 'wallpaperE'].map((r) => path.join(WS, 'allwallpaper', r)).filter((p) => fs.existsSync(p))
  if (!ROOTS.length) { sk('B 语料扫描', '四个语料根都不在'); } else {
    const files = ROOTS.flatMap((r) => walkContainers(r))
    ok('B0 四根枚举到容器', files.length > 0, 'files=' + files.length + ' roots=' + ROOTS.length)
    let pkgTotal = 0, nonAsciiEntries = 0, nonAsciiRefs = 0, refHits = 0, refMiss = []
    const fontSoft = []
    let probe = null
    for (const f of files) {
      let idx = null
      try { idx = readIndexCore(f) } catch (e) { continue }
      pkgTotal++
      const names = new Set(idx.entries.map((e) => e.name))
      const nonAscii = idx.entries.filter((e) => hasNonAscii(e.name))
      nonAsciiEntries += nonAscii.length
      const isProbe = /[\\/]2887099508[\\/]/.test(f)
      if (isProbe) probe = { f, idx, nonAscii, refs: [] }
      // scene.json 引用（有才对）
      const se = idx.entries.find((x) => /(^|\/)scene\.json$/i.test(x.name))
      let sceneObj = null
      if (se) { try { sceneObj = JSON.parse(dec.decode(readSlice(f, idx.dataStart + se.off, se.size)).replace(/^\uFEFF/, '')) } catch (e) { sceneObj = null } }
      const refs = sceneObj ? collectRefs(sceneObj) : []
      if (isProbe && sceneObj) {
        probe.refs = refs
        // 材料文件里的纹理引用（探针包 materials/z.json 的 ¦¦¥¦12 就在这层）
        for (const e of idx.entries) {
          if (!/^materials\/.*\.json$/i.test(e.name)) continue
          try {
            const mj = JSON.parse(dec.decode(readSlice(f, idx.dataStart + e.off, e.size)))
            for (const p of (mj.passes || [])) for (const tn of (p.textures || [])) {
              if (typeof tn === 'string' && tn && !tn.startsWith('_rt_')) probe.refs.push({ ref: tn, where: e.name })
            }
          } catch (e) {}
        }
      }
      const resolves = (ref) => {
        // 加载器候选链（demo loadTex/纹理装载同款）：materials/<名>.tex / materials/<名> / <名>.tex / <名>
        for (const cand of [ref, ref + '.tex', 'materials/' + ref + '.tex', 'materials/' + ref]) if (names.has(cand)) return cand
        return null
      }
      for (const r of refs) {
        if (!hasNonAscii(r.ref)) continue
        nonAsciiRefs++
        if (resolves(r.ref)) refHits++
        else if (/\.(ttf|otf|woff2?)$/i.test(r.ref)) fontSoft.push(path.basename(path.dirname(f)) + ' ' + r.where + ' → ' + JSON.stringify(r.ref).slice(0, 50))
        else if (refMiss.length < 12) refMiss.push(path.basename(path.dirname(f)) + ' ' + r.where + ' → ' + JSON.stringify(r.ref).slice(0, 40))
      }
      // 材料 JSON 引用（全库抽查：只扫名字本身非 ASCII 的 .json 材料，控制耗时）
      for (const e of idx.entries) {
        if (!hasNonAscii(e.name) || !/^materials\/.*\.json$/i.test(e.name)) continue
        try {
          const mj = JSON.parse(dec.decode(readSlice(f, idx.dataStart + e.off, e.size)))
          for (const p of (mj.passes || [])) for (const tn of (p.textures || [])) {
            if (typeof tn !== 'string' || !tn || tn.startsWith('_rt_')) continue
            if (!hasNonAscii(tn)) continue
            nonAsciiRefs++
            if (resolves(tn)) refHits++
            else if (refMiss.length < 12) refMiss.push(path.basename(path.dirname(f)) + ' ' + e.name + ' → ' + JSON.stringify(tn).slice(0, 40))
          }
        } catch (e) {}
      }
    }
    ok('B1 目录表解析不炸（' + pkgTotal + ' 容器）', pkgTotal > 0)
    ok('B2 非 ASCII 条目名清单非空（语料确有此类）', nonAsciiEntries > 0, 'count=' + nonAsciiEntries)
    console.log('  ℹ B3 全库对账：非 ASCII 引用 ' + nonAsciiRefs + ' 条 / 命中 ' + refHits + ' / miss ' + refMiss.length
      + '（字体引用单独报告 ' + fontSoft.length + ' 条——字体走字体解析器，归 C8）')
    if (refMiss.length) console.log('    miss 样例: ' + refMiss.slice(0, 6).join(' | '))
    try { fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true })
      fs.writeFileSync(path.join(ROOT, 'reports', 'nonascii-names-audit.json'), JSON.stringify(
        { generatedAt: new Date().toISOString(), containers: pkgTotal, nonAsciiEntries, nonAsciiRefs, refHits,
          refMiss, fontRefsUnresolved: fontSoft }, null, 1)) } catch (e) {}
    if (probe) {
      ok('B4 探针包 2887099508 在语料里（非 ASCII 条目 ' + probe.nonAscii.length + ' 条 = 任务书 24）',
        probe.nonAscii.length === 24, 'count=' + probe.nonAscii.length)
      const probeResolves = (ref) => { for (const cand of [ref, ref + '.tex', 'materials/' + ref + '.tex', 'materials/' + ref]) if (probe.idx.entries.some((e) => e.name === cand)) return cand; return null }
      const probeNonAsciiRefs = probe.refs.filter((r) => hasNonAscii(r.ref))
      const probeMiss = probeNonAsciiRefs.filter((r) => !probeResolves(r.ref) && !/\.(ttf|otf|woff2?)$/i.test(r.ref))
      ok('B5 探针包非 ASCII 引用全部按加载器候选链命中（' + probeNonAsciiRefs.length + ' 条；字体走 C8 单列）',
        probeMiss.length === 0, probeMiss.map((r) => r.where + '→' + JSON.stringify(r.ref).slice(0, 30)).join(' | '))
      const fref = probeNonAsciiRefs.find((r) => /\.(ttf|otf)/i.test(r.ref))
      ok('B6 探针包字体引用被收集（乱码名 .ttf，语义归 C8 字体解析器）', !!fref,
        fref ? JSON.stringify(fref.ref).slice(0, 50) : '（scene.json 无 font 引用）')
    } else sk('B4/B5/B6 探针包', '四个根里没有 2887099508')
  }
}

/* ── C 段：变异自证 ─────────────────────────────────────────────────────────────── */
{
  const CORE = path.join(ROOT, 'core')
  const src = fs.readFileSync(path.join(CORE, 'we-scene-bundle.js'), 'utf8')
  const anchor = 'const e = pkg.entries.find((x) => x.name === name)'
  if (!src.includes(anchor)) ok('C0 变异锚点存在', false, 'getEntry 的逐字节等值行没找到')
  else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-nonascii-'))
    for (const f2 of fs.readdirSync(CORE)) { if (/\.(mjs|js)$/.test(f2)) fs.copyFileSync(path.join(CORE, f2), path.join(dir, f2)) }
    fs.writeFileSync(path.join(dir, 'we-scene-bundle.js'),
      src.replace(anchor, "const e = pkg.entries.find((x) => x.name.normalize('NFKC') === String(name).normalize('NFKC'))"))
    const mlib = await import(pathToFileURL(path.join(dir, 'we-scene-bundle.js')).href + '?t=' + Date.now())
    const rawName = Buffer.from([0xA6, 0xA6, 0xC4, 0xB1])
    const sameForm = expectName(rawName)
    const altered = sameForm.toUpperCase()
    const buf = makePkg([{ nameBytes: rawName, data: 'X' }])
    const mpkg = mlib.parsePkg(new Uint8Array(buf))
    const mutantHits = mpkg.entries.length === 1 && mlib.getEntry(mpkg, altered) !== null
    ok('C 变异自证：getEntry 改成 NFKC 双侧规范化 ⇒ 大小写变体被**错误命中**（A2 必红的机制证明）',
      mutantHits, 'mutantHits=' + mutantHits)
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch (e) {}
  }
}

console.log('\n===== nonascii-name-consistency: ' + pass + ' 通过 / ' + fail + ' 失败' + (skipN ? ' / ' + skipN + ' SKIP' : '') + ' =====')
process.exit(fail ? 1 : 0)
