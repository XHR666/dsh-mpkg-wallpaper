// script-corpus-audit.mjs — 脚本兼容层/转译层**全语料**审计
//
// 用户要求："再检查一下有没有其他的 api 是错误的之类的，包括兼容层在翻译的时候有没有翻译错误的"。
// 做法（数据驱动，不靠猜）：
//   ① 把语料里**每一个**脚本（dd 场景 scene.pkg + wallpaperE/wallpapertest1 的 .mpkg）都取出来；
//   ② 用真实脚本宿主（elysia/scene-scripts.js，转译 + vm 替身）在 Node 里**真跑** t=0..2；
//   ③ 聚合运行期错误（X is not defined / X is not a function / 其它 TypeError）→ 缺哪些 API、影响哪些包；
//   ④ 静态扫描：脚本里 `base.method(` 的 base，若既不在沙箱上下文、也不是脚本内声明/形参 → 潜在缺 API
//      （能抓到被 try/catch 吞掉、或走 default 分支才触发的缺口）。
//
// 用法: node script-corpus-audit.mjs [--verbose] [--json out.json]
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import path from 'node:path'
import { applySceneScripts, createScriptCache } from '../elysia/scene-scripts.js'

const ROOT = process.env.MPW_ROOT || WS
const verbose = process.argv.includes('--verbose')
const jsonIdx = process.argv.indexOf('--json')
const DEC = new TextDecoder()

/* ---------- 取包里的 scene.json ---------- */
function sceneJsonFromPkg(pkgPath) {
  const lib = globalThis.__lib
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(pkgPath)))
  const e = lib.getEntry(pkg, 'scene.json')
  return e ? JSON.parse(DEC.decode(e).replace(/^\uFEFF/, '')) : null
}
// .mpkg（PKGMxxxx）：头部 → 条目表 → 数据段顺序存放；只取需要的小条目，不读大视频
function sceneJsonFromMpkg(p) {
  const fd = fs.openSync(p, 'rb')
  try {
    const head = Buffer.alloc(1 << 22)                    // 4MB 足够覆盖头部 + 小条目
    const n = fs.readSync(fd, head, 0, head.length, 0)
    const buf = head.subarray(0, n)
    let pos = 0
    const vlen = buf.readUInt32LE(pos); pos += 4
    pos += vlen
    const total = buf.readUInt32LE(pos); pos += 4
    const entries = []
    for (let i = 0; i < total; i++) {
      const nl = buf.readUInt32LE(pos); pos += 4
      const name = buf.subarray(pos, pos + nl).toString('utf8'); pos += nl
      const index = buf.readUInt32LE(pos); pos += 4
      const size = buf.readUInt32LE(pos); pos += 4
      entries.push({ name, index, size })
    }
    const want = new Set(['scene.json', 'project.json'])
    for (const en of entries) {
      const base = en.name.replace(/^\/+/, '')
      if (!want.has(base)) { pos += en.size; continue }
      if (pos + en.size > buf.length) return null         // 超出读入窗口（少见）
      const txt = buf.subarray(pos, pos + en.size).toString('utf8')
      pos += en.size
      if (base === 'scene.json') return JSON.parse(txt.replace(/^\uFEFF/, ''))
    }
    return null
  } catch { return null } finally { fs.closeSync(fd) }
}

/* ---------- 收集脚本 ---------- */
function collectScripts(sj) {
  const out = []
  for (const o of (sj && sj.objects) || []) {
    if (typeof o.script === 'string' && o.script.trim()) out.push({ id: o.id, name: o.name, where: 'object', src: o.script })
    if (o.text && typeof o.text.script === 'string' && o.text.script.trim()) out.push({ id: o.id, name: o.name, where: 'text', src: o.text.script })
  }
  return out
}

/* ---------- 宿主提供的 API 名单（静态扫描用） ---------- */
const SANDBOX_KEYS = new Set([
  '__WEColor', '__WEMath', '__exports', '__scriptProps', '__scriptProperties', 'Date', 'Math', 'console', 'JSON',
  'Number', 'String', 'Boolean', 'Object', 'Array', 'Set', 'Map', 'Promise', 'parseFloat', 'parseInt', 'isNaN',
  'isFinite', 'Infinity', 'NaN', 'undefined', 'Vec3', 'Vec2', 'WEMath', 'WEColor', 'input', 'createScriptProperties',
  'thisScene', 'engine', 'shared', 'thisObject', 'thisLayer', 'localStorage',
])

/* ---------- 语料枚举 ---------- */
globalThis.__lib = await import('../core/we-scene-bundle.js')
const packs = []
for (const d of fs.readdirSync(path.join(ROOT, 'allwallpaper/dd'))) {
  const p = path.join(ROOT, 'allwallpaper/dd', d, 'scene.pkg')
  if (fs.existsSync(p)) packs.push({ id: d, kind: 'dd', p })
}
for (const dir of ['wallpaperE', 'wallpapertest1']) {
  const base = path.join(ROOT, 'allwallpaper', dir)
  if (!fs.existsSync(base)) continue
  for (const sub of fs.readdirSync(base)) {
    const sd = path.join(base, sub)
    if (!fs.statSync(sd).isDirectory()) { if (sd.endsWith('.mpkg')) packs.push({ id: sub.replace(/\.mpkg$/, ''), kind: dir, p: sd }); continue }
    for (const f of fs.readdirSync(sd)) if (f.endsWith('.mpkg')) packs.push({ id: f.replace(/\.mpkg$/, ''), kind: dir + '/' + sub, p: path.join(sd, f) })
  }
}

/* ---------- 跑语料 ---------- */
const errAgg = new Map()      // 归一化错误 → { n, packs:Set, sample }
const staticGaps = new Map()  // base 名 → { n, packs:Set, sample }
let packOk = 0, packTotal = 0, scriptTotal = 0

for (const pk of packs) {
  let sj = null
  try { sj = pk.kind === 'dd' ? sceneJsonFromPkg(pk.p) : sceneJsonFromMpkg(pk.p) } catch { sj = null }
  if (!sj) continue
  const scripts = collectScripts(sj)
  if (!scripts.length) { packTotal++; packOk++; continue }
  packTotal++; scriptTotal += scripts.length

  // ① 真跑（t=0..2），收集运行期错误
  const errs = []
  const cache = createScriptCache()
  try {
    for (let t = 0; t < 3; t++) applySceneScripts(sj, t, { scriptCache: cache, onError: (st, e) => errs.push(st + ':' + ((e && e.message) || e)) })
  } catch (e) { errs.push('host:' + e.message) }
  // 归一化：只把数字折成 N（保留 '属性名' 这类关键信息，否则分不清 reading 'x' 还是 'arg'）
  const norm = (m) => String(m).replace(/×\d+/g, '').replace(/\b\d+(\.\d+)?\b/g, 'N')
  for (const e of errs) {
    const k = norm(e)
    const rec = errAgg.get(k) || { n: 0, packs: new Set(), sample: e }
    rec.n++; rec.packs.add(pk.id)
    errAgg.set(k, rec)
  }
  if (!errs.length) packOk++
  if (verbose && errs.length) console.log(`  ${pk.id}: ${[...new Set(errs)].slice(0, 3).join(' | ')}`)

  // ② 静态扫描 `base.method(` 的 base 是否未知
  for (const sc of scripts) {
    const src = sc.src
    const localDecl = new Set()
    for (const m of src.matchAll(/\b(?:var|let|const|function|class)\s+([A-Za-z_$][\w$]*)/g)) localDecl.add(m[1])
    for (const m of src.matchAll(/\(([^)]*)\)\s*(?:=>|\{)/g)) for (const a of m[1].split(',')) { const t = a.trim().split(/[=\s]/)[0]; if (/^[A-Za-z_$][\w$]*$/.test(t)) localDecl.add(t) }
    const bases = new Map()
    for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g)) {
      const b = m[1]
      if (SANDBOX_KEYS.has(b) || localDecl.has(b) || b === 'globalThis' || b === 'window') continue
      bases.set(b, (bases.get(b) || new Set()).add(m[2]))
    }
    for (const [b, ms] of bases) {
      const rec = staticGaps.get(b) || { n: 0, packs: new Set(), methods: new Set(), sample: null }
      rec.n++; rec.packs.add(pk.id)
      for (const x of ms) rec.methods.add(x)
      if (!rec.sample) rec.sample = (sc.name || sc.id) + ':' + [...ms].slice(0, 3).join('/')
      staticGaps.set(b, rec)
    }
  }
}

console.log(`\n语料：${packs.length} 个容器，${packTotal} 个有 scene.json，含脚本容器 ${packTotal - packOk} 个、脚本 ${scriptTotal} 段`)
console.log(`\n=== ① 运行期错误聚合（真跑 t=0..2）===`)
const errRows = [...errAgg.entries()].sort((a, b) => b[1].n - a[1].n)
if (!errRows.length) console.log('  ✓ 无错误')
for (const [k, v] of errRows.slice(0, 25)) console.log(`  ×${String(v.n).padEnd(4)} [${v.packs.size} 包] ${k}`)
console.log(`\n=== ② 静态扫描：未知的调用基对象（可能是缺 API，也可能是脚本内动态构造）===`)
const gapRows = [...staticGaps.entries()].sort((a, b) => b[1].packs.size - a[1].packs.size || b[1].n - a[1].n)
if (!gapRows.length) console.log('  ✓ 无')
for (const [b, v] of gapRows.slice(0, 20)) console.log(`  ${b.padEnd(20)} ${v.packs.size} 包 / ${v.n} 处  方法: ${[...v.methods].slice(0, 6).join(', ')}   例: ${v.sample}`)

// --strict：把"缺 API"类错误（is not defined / is not a function）判为失败 → 可进门禁
if (process.argv.includes('--strict')) {
  const hard = errRows.filter(([k]) => /is not defined|is not a function/.test(k))
  if (hard.length) {
    console.error('\n✗ 仍存在缺 API 类脚本错误 ' + hard.length + ' 类：')
    for (const [k, v] of hard) console.error(`   ×${v.n} [${v.packs.size} 包] ${k}`)
    process.exit(1)
  }
  console.log('\n✓ 全语料无"缺 API"类脚本错误（is not defined / is not a function）')
}
if (jsonIdx > 0 && process.argv[jsonIdx + 1]) {
  fs.writeFileSync(process.argv[jsonIdx + 1], JSON.stringify({
    packs: packs.length, packsWithScene: packTotal, scripts: scriptTotal,
    errors: errRows.map(([k, v]) => ({ err: k, n: v.n, packs: [...v.packs] })),
    staticGaps: gapRows.map(([b, v]) => ({ base: b, n: v.n, packs: [...v.packs], methods: [...v.methods] })),
  }, null, 1))
  console.log('\n已写出 ' + process.argv[jsonIdx + 1])
}
