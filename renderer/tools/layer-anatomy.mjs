#!/usr/bin/env node
// layer-anatomy.mjs —— 「层解剖」：给一个包 + 层名/下标，打印该层**从原始数据到渲染层**的全链读数
// （纯 Node，无浏览器；ZCODE-TASK-20261006 §3.1 / P-251 台账）。
//
// 与既有工具的分工：
//   · tests/layer-rect-check.mjs  = 层的**实绘矩形**工作台（对齐/网格 bbox/标定对比）；
//   · tests/script-string-decode.mjs --chain = 全包**脚本字段清单**（谁引用谁）；
//   · tools/script-deobfuscate.mjs = 单字段**正文可读化**；
//   · 本工具 = 把**同一个层**的 raw / parseScene（父链合成）/ 附件锚点（开关差分）/ puppet 网格 /
//     脚本驱动字段（沙箱解码，同 --chain 能力）**一次看全**，并出 `--md` 一页报告与 `--json` 机读。
//
// 用法：
//   node tools/layer-anatomy.mjs --pkg <scene.pkg 路径> --name <层名> [--t=<秒>] [--md] [--json]
//   node tools/layer-anatomy.mjs --pkg <…> --index <__sceneLayers 下标> [--md]
//   node tools/layer-anatomy.mjs --pkg <…> --id <对象 id> [--md]
//   node tools/layer-anatomy.mjs --id-corpus <语料 id> [--libroot 0923] …   # 在 $MPW_ROOT/allwallpaper/<根>/ 下找包
//
// 读数口径（与 docs/reports-3463520581-anatomy.md 第 61/78/79 轮一致）：
//   ① 原始 = scene.json 的 authored 值（y-up，未翻转未合成）；
//   ② parseScene 后 = 父链合成 + 翻转（y-down）后的 layer.origin；
//   ③ 附件锚点 = 「开 attachCtx」与「关(--noattach 同款 uniformFlipY)」两次 parseScene 的 origin 差分，
//      并与 core/attach-transform.mjs 的 buildAttachOffsets 直算值对账。
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { pathToFileURL } from 'node:url'
import * as lib from '../core/we-scene-bundle.js'
import { parseMdl, buildAttachOffsets } from '../core/attach-transform.mjs'

const DEC = new TextDecoder()

/** 在语料根里定位包：$MPW_ROOT(或 WS)/allwallpaper/<libroot>/<id>/scene.pkg；libroot 缺省逐个探测。 */
export function resolveCorpusPkg(id, libroot) {
  const ws = process.env.MPW_ROOT || path.resolve(import.meta.dirname, '..', '..')
  const roots = libroot ? [libroot] : ['0923', 'dd', '0917', '1004', 'wallpaperE']
  for (const r of roots) {
    for (const f of ['scene.pkg', 'project.json']) {
      const p = path.join(ws, 'allwallpaper', r, id, f)
      if (fs.existsSync(p)) return p
    }
  }
  return null
}

const num3 = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 1000) / 1000 : v)
const pt = (v) => {
  if (Array.isArray(v)) return `[${v.map(num3).join(', ')}]`
  if (v && typeof v === 'object') {
    if ('value' in v) {
      const inner = Array.isArray(v.value) ? `[${v.value.map(num3).join(', ')}]` : String(v.value)
      const anim = (v.animation && (v.animation.c0 || v.animation.c1)) ? ' +关键帧动画' : (v.script ? ' +脚本' : '')
      return `${inner}${anim}`
    }
    return JSON.stringify(v).slice(0, 120)
  }
  return String(v)
}

/** 单字段脚本解码（与 tests/script-string-decode.mjs 的 decodeAny 同一技术：vm 沙箱只跑到解码器初始化）。 */
function decodeScriptStrings(text) {
  if (!text) return { map: new Map(), exports: [], toplevelError: null }
  const calls = [...text.matchAll(/(_0x[0-9a-f]+)\(\s*'(0x[0-9a-f]+)'\s*,\s*'([^']*)'\s*\)/g)].map((m) => ({ fn: m[1], idx: m[2], key: m[3] }))
  const fns = [...new Set(calls.map((c) => c.fn))]
  //  ①(P-239 同族) 压缩形态 `import*as X from'Y'`（不带空格）会让 vm 顶层 parse 直接抛
  //  "import declarations may only appear at top level of a module" ⇒ 解码器 IIFE 没跑到、整条解码落空。
  //  解码只需要字符串表解码器 ⇒ 把 import 行（压缩/规范两种形态）剥掉再进沙箱，`export` 照旧剥。
  let code = String(text)
    .replace(/import\s*\*\s*as\s+\w+\s*from\s*['"][^'"]*['"]\s*;?/g, '')
    .replace(/import\s+(?:\{[^}]*\}|\w+)\s*from\s*['"][^'"]*['"]\s*;?/g, '')
    .replace(/\bexport\s+/g, '')
  code += '\n;globalThis.__dec = {' + fns.map((f) => f + ':' + f).join(',') + '};\n'
  const sb = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    Math, Date, JSON, Number, String, Boolean, Array, Object, RegExp, Error, isFinite, isNaN, parseInt, parseFloat,
    atob: (v) => Buffer.from(String(v), 'base64').toString('binary'),
    btoa: (v) => Buffer.from(String(v), 'binary').toString('base64'),
    Function, setTimeout: () => 0, setInterval: () => 0, clearTimeout: () => {}, clearInterval: () => {},
    localStorage: { getItem: () => null, setItem: () => {} },
    shared: {}, engine: {}, thisScene: {}, thisLayer: {}, parent: {}, window: null, globalThis: null, self: null,
  }
  sb.window = sb; sb.globalThis = sb; sb.self = sb
  let toplevelError = null
  try { vm.runInContext(code, vm.createContext(sb), { timeout: 5000 }) } catch (e) { toplevelError = String((e && e.message) || e) }
  const dec = sb.__dec || {}
  const map = new Map()
  for (const c of calls) {
    const fn = dec[c.fn]
    if (typeof fn !== 'function') continue
    try { const v = fn(c.idx, c.key); if (typeof v === 'string') map.set(c.idx + '|' + c.key, v) } catch { /* 单点失败跳过 */ }
  }
  const exports2 = [...new Set([...String(text).matchAll(/export\s+function\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))]
  return { map, exports: exports2, toplevelError }
}

/** 包级摘要：脚本驱动字段计数（与 script-string-decode --chain 的统计口径一致）。 */
export function packageScriptSummary(objects) {
  const names = new Set(objects.map((o) => String((o && o.name) || '')))
  const rows = []
  for (let i = 0; i < (objects || []).length; i++) {
    const o = objects[i] || {}
    for (const k of Object.keys(o)) {
      const v = o[k]
      if (!v || typeof v !== 'object' || typeof v.script !== 'string') continue
      const { map } = decodeScriptStrings(v.script)
      const strs = [...new Set(map.values())]
      rows.push({ index: i, name: String(o.name || ''), id: o.id, field: k, refs: strs.filter((x) => names.has(x)), decoded: strs.length, fallback: v.value })
    }
  }
  return { fields: rows.length, layers: new Set(rows.map((r) => r.index)).size, rows }
}

/** 主入口：解析包并返回某一层的全链解剖（纯函数；fs 只在给 pkgPath 时用）。 */
export function analyzeLayer({ pkgPath, pkgBytes = null, selector = {}, attTime = 0 }) {
  const buf = pkgBytes || fs.readFileSync(pkgPath)
  const pkg = lib.parsePkg(new Uint8Array(buf))
  const readEntry = (n) => lib.getEntry(pkg, n)
  const sceneRaw = JSON.parse(DEC.decode(new Uint8Array(readEntry('scene.json'))).replace(/^\uFEFF/, ''))
  const objects = sceneRaw.objects || []
  const byId = new Map(objects.map((o) => [o.id, o]))

  // 两次 parseScene：开/关附件锚点（差分 = 静态锚点烘焙量；与 layer-rect-check --noattach 同款）
  const withAttach = lib.parseScene(sceneRaw, null, { attachCtx: { readEntry, time: attTime } })
  const noAttach = lib.parseScene(sceneRaw, null, { uniformFlipY: true })
  const layerById = new Map(withAttach.layers.map((l) => [l.id, l]))
  const layerNoAttById = new Map(noAttach.layers.map((l) => [l.id, l]))

  // 选层：--index = __sceneLayers 下标；--id = 对象 id；--name = 先精确后唯一子串
  let raw = null, index = -1, nameAmbiguous = null
  if (selector.index != null && Number.isFinite(Number(selector.index))) {
    index = Math.trunc(Number(selector.index))
    const l = withAttach.layers[index]
    raw = l ? byId.get(l.id) : null
  } else if (selector.id != null) {
    raw = byId.get(Number(selector.id)) || null
    index = raw ? withAttach.layers.findIndex((l) => l.id === raw.id) : -1
  } else if (selector.name != null) {
    const want = String(selector.name)
    let hit = objects.filter((o) => String(o.name || '') === want)
    if (!hit.length) hit = objects.filter((o) => String(o.name || '').includes(want))
    //  变体包同名层成对（主变体 + "lil" 变体）：解析期两者都"可见"（运行期才被用户属性条件区分），
    //  离线无法判运行期 ⇒ 取**首个**（id 最小 = 主变体），其余命中如实列进 nameAmbiguous 供人工核对。
    if (hit.length > 1) nameAmbiguous = hit.map((o) => ({ id: o.id, name: String(o.name || '') }))
    if (hit.length) { raw = hit[0]; index = withAttach.layers.findIndex((l) => l.id === raw.id) }
  }
  if (!raw) return { ok: false, why: 'selector 未命中唯一层（--name 精确/唯一子串、--index、--id 任一）', sceneLayers: withAttach.layers.length, objects: objects.length }

  const parsed = layerById.get(raw.id) || {}
  const parsedNo = layerNoAttById.get(raw.id) || {}
  const att = (Array.isArray(parsed.origin) && Array.isArray(parsedNo.origin))
    ? { dx: num3(parsed.origin[0] - parsedNo.origin[0]), dy: num3(parsed.origin[1] - parsedNo.origin[1]) }
    : null
  // 与 buildAttachOffsets 直算值对账（注意它是 y-up：差分是 y-down，两者应满足 dy ≈ −offY）
  const offsets = (() => { try { return buildAttachOffsets(objects, readEntry, null, attTime) } catch { return new Map() } })()
  const offDirect = offsets.get(raw.id) || null

  // 父链（raw 语义）+ 合成后子父距离
  const chain = []
  {
    let cur = raw, guard = 0
    while (cur && cur.parent != null && guard++ < 32) {
      const p = byId.get(cur.parent)
      if (!p) { chain.push({ id: cur.parent, missing: true }); break }
      const pc = layerById.get(p.id), cc = layerById.get(cur.id)
      const dist = (pc && cc && Array.isArray(pc.origin) && Array.isArray(cc.origin))
        ? num3(Math.hypot(cc.origin[0] - pc.origin[0], cc.origin[1] - pc.origin[1])) : null
      chain.push({ id: p.id, name: String(p.name || ''), dist: dist })
      cur = p
    }
  }

  // puppet 网格（本层 image 的 model.json 带 puppet 键才有）+ 父层网格
  const modelInfo = (o) => {
    if (!o || typeof o.image !== 'string') return null
    try {
      const e = readEntry(o.image)
      const mj = e ? JSON.parse(DEC.decode(new Uint8Array(e)).replace(/^\uFEFF/, '')) : null
      if (!mj || !mj.puppet) return { hasModelJson: !!mj, puppet: null }
      const mesh = parseMdl(new Uint8Array(readEntry(mj.puppet)))
      return {
        hasModelJson: true, puppet: mj.puppet,
        vertices: mesh && mesh.positions ? mesh.positions.length : null,
        indices: mesh && mesh.indices ? mesh.indices.length : null,
        bones: mesh && Array.isArray(mesh.bones) ? mesh.bones.length : null,
        animations: mesh && Array.isArray(mesh.animations) ? mesh.animations.length : null,
      }
    } catch (e) { return { error: String((e && e.message) || e) } }
  }

  // 本层脚本驱动字段（解码 + 引用层名 + 数值常量 + 对象级 scriptproperties）
  const names = new Set(objects.map((o) => String((o && o.name) || '')))
  const scripts = []
  for (const k of Object.keys(raw)) {
    const v = raw[k]
    if (!v || typeof v !== 'object' || typeof v.script !== 'string') continue
    const { map, exports: exps, toplevelError } = decodeScriptStrings(v.script)
    const strs = [...new Set(map.values())]
    scripts.push({
      field: k, chars: v.script.length, exports: exps, toplevelError,
      refs: strs.filter((x) => names.has(x)),
      decodedSample: strs.slice(0, 10),
      constants: [...new Set([...v.script.matchAll(/[-+]?0x[0-9a-f]+|\b\d{2,5}\b/gi)].map((m) => m[0]))].slice(0, 8),
      fallback: v.value,
    })
  }

  const kind = raw.image ? 'image' : (raw.particle ? 'particle' : (raw.text ? 'text' : (raw.sound ? 'sound' : (raw.light ? 'light' : (raw.model ? 'model' : 'container')))))
  const parseVec = (s) => (typeof s === 'string' ? s.trim().split(/\s+/).slice(0, 2).map(Number) : (Array.isArray(s) ? s.slice(0, 2).map(Number) : null))
  return {
    ok: true,
    pkg: pkgPath ? path.basename(pkgPath) : '(bytes)',
    scene: { layers: withAttach.layers.length, canvas: sceneRaw.general && sceneRaw.general.orthogonalprojection ? { w: sceneRaw.general.orthogonalprojection.width, h: sceneRaw.general.orthogonalprojection.height } : null, objects: objects.length },
    layer: { index, id: raw.id, name: String(raw.name || ''), kind, nameAmbiguous },
    raw: {
      origin: raw.origin, originXY: parseVec(raw.origin), scale: raw.scale, angles: raw.angles, visible: raw.visible, alpha: raw.alpha,
      parent: raw.parent, attachment: raw.attachment, image: raw.image, model: raw.model,
      size: raw.size, alignment: raw.alignment || 'center', color: raw.color,
      scriptproperties: raw.scriptproperties || null,
      scriptFields: Object.keys(raw).filter((k) => raw[k] && typeof raw[k] === 'object' && typeof raw[k].script === 'string'),
    },
    parsed: {
      origin: parsed.origin || null, scale: parsed.scale || null, size: parsed.size || null,
      alpha: parsed.alpha, visible: parsed.visible, alignment: parsed.alignment,
      isContainer: !!parsed.isContainer, textureName: parsed.textureName || null,
      animLayers: !!parsed.animLayers, modelDropped: !!parsed.__modelDropped,
    },
    noattach: { origin: parsedNo.origin || null },
    attach: { delta: att, directOffsetYUp: offDirect ? [num3(offDirect[0]), num3(offDirect[1])] : null, offsetsMapSize: offsets.size },
    chain,
    mesh: modelInfo(raw),
    parentMesh: raw.parent != null ? modelInfo(byId.get(raw.parent)) : null,
    scripts,
    packageScripts: (() => { let n = 0, layers = 0; for (const o of objects) { const f = Object.keys(o || {}).filter((k) => o[k] && typeof o[k] === 'object' && typeof o[k].script === 'string'); if (f.length) { n += f.length; layers++ } } return { fields: n, layers } })(),
  }
}

/* ── 文本 / Markdown 渲染 ─────────────────────────────────────────────────────── */
export function renderMd(a) {
  if (!a.ok) return `# 层解剖：未命中\n\n${a.why}（包内 ${a.objects} 对象 / ${a.sceneLayers} 层）\n`
  const L = []
  L.push(`# 层解剖：${a.layer.name}（${a.pkg} · ${a.scene.layers} 层 · 下标 ${a.layer.index} · id ${a.layer.id} · ${a.layer.kind}）`)
  L.push('')
  L.push('## ① 原始（scene.json authored，y-up）')
  L.push('')
  L.push('| 字段 | 值 |')
  L.push('|---|---|')
  for (const [k, v] of Object.entries(a.raw)) {
    if (v == null || (Array.isArray(v) && !v.length)) continue
    L.push(`| \`${k}\` | \`${typeof v === 'object' ? pt(v) : String(v)}\` |`)
  }
  L.push('')
  L.push('## ② parseScene 后（父链合成 + 翻转，y-down）')
  L.push('')
  L.push('| 字段 | 值 |')
  L.push('|---|---|')
  L.push(`| origin（合成） | \`${pt(a.parsed.origin)}\` |`)
  L.push(`| scale / size | \`${pt(a.parsed.scale)}\` / \`${pt(a.parsed.size)}\` |`)
  L.push(`| alpha / visible / alignment | ${a.parsed.alpha} / ${a.parsed.visible} / ${a.parsed.alignment} |`)
  L.push(`| isContainer / textureName / animLayers / modelDropped | ${a.parsed.isContainer} / ${a.parsed.textureName || '—'} / ${a.parsed.animLayers} / ${a.parsed.modelDropped} |`)
  L.push('')
  L.push('## ③ 附件锚点（开 vs 关 两次 parseScene 差分）')
  L.push('')
  L.push(`- 关锚点 origin：\`${pt(a.noattach.origin)}\``)
  L.push(`- **锚点差分（y-down）：\`${a.attach.delta ? `Δ=(${a.attach.delta.dx}, ${a.attach.delta.dy})` : '—'}\`；buildAttachOffsets 直算（y-up）：\`${a.attach.directOffsetYUp ? pt(a.attach.directOffsetYUp) : '未命中（0 偏移）'}\`（全包 ${a.attach.offsetsMapSize} 条非零）`)
  if (a.chain.length) {
    L.push('')
    L.push('## ④ 父链（raw 语义 → 合成后子父距离，设计单位）')
    L.push('')
    L.push('| 级 | 父 id | 父名 | 子父距离 |')
    L.push('|---|---|---|---|')
    a.chain.forEach((c, i) => L.push(`| ${i + 1} | ${c.id} | ${c.name}${c.missing ? '（缺失）' : ''} | ${c.dist ?? '—'} |`))
  }
  if (a.mesh || a.parentMesh) {
    L.push('')
    L.push('## ⑤ puppet 网格（parseMdl）')
    L.push('')
    const meshLine = (m, tag) => m ? (m.puppet
      ? `- ${tag}：puppet=\`${m.puppet}\` 顶点 ${m.vertices} / 索引 ${m.indices} / 骨骼 ${m.bones} / 动画 ${m.animations}${m.error ? `（⚠ ${m.error}）` : ''}`
      : `- ${tag}：模型 JSON 无 \`puppet\` 键（非网格层${m.hasModelJson ? '，model.json 在' : ''}）${m.error ? `（⚠ ${m.error}）` : ''}`) : null
    const l1 = meshLine(a.mesh, `本层 image=${a.raw.image || '—'}`)
    if (l1) L.push(l1)
    const l2 = a.parentMesh ? meshLine(a.parentMesh, '父层') : null
    if (l2) L.push(l2)
  }
  L.push('')
  L.push(`## ⑥ 脚本驱动字段（本层 ${a.scripts.length} 个；全包 ${a.packageScripts.fields} 个 / ${a.packageScripts.layers} 层）`)
  L.push('')
  if (!a.scripts.length) L.push('（本层无 `{script}` 字段 —— 纯数据层）')
  else {
    L.push('| 字段 | 字符 | 导出 | 引用层名 | 数值常量 | 兜底值 |')
    L.push('|---|---|---|---|---|---|')
    for (const s of a.scripts) {
      L.push(`| \`${s.field}\` | ${s.chars} | ${s.exports.join(',') || '—'}${s.toplevelError ? ' ⚠顶层中断' : ''} | ${s.refs.join(',') || '—'} | ${s.constants.join(',') || '—'} | \`${JSON.stringify(s.fallback)}\` |`)
    }
    const sp = a.raw.scriptproperties
    if (sp) L.push(`\n对象级 \`scriptproperties\`：\`${JSON.stringify(sp)}\`（P-236 链：覆盖脚本默认值）`)
  }
  L.push('')
  return L.join('\n')
}

/* ── CLI ─────────────────────────────────────────────────────────────────────── */
const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isMain) {
  const argv = process.argv.slice(2)
  const val = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
  let pkgPath = val('--pkg')
  const corpusId = val('--id-corpus')
  if (!pkgPath && corpusId) pkgPath = resolveCorpusPkg(corpusId, val('--libroot'))
  if (!pkgPath || !fs.existsSync(pkgPath)) {
    console.error('用法: node tools/layer-anatomy.mjs (--pkg <scene.pkg> | --id-corpus <语料 id> [--libroot 0923]) (--name <层名> | --index <下标> | --id <对象 id>) [--t=<秒>] [--md] [--json]')
    process.exit(2)
  }
  const tIdx = argv.findIndex((a) => a.startsWith('--t='))
  //  core 解析期会直接 console.log（如 `[P-152] MDLS bone layout rescued …`）—— 统计期间改道 stderr，
  //  保证 stdout 只有本工具自己的输出（--json 的机读行不受污染）。
  const origLog = console.log
  console.log = (...args) => process.stderr.write(args.join(' ') + '\n')
  let a
  try {
    a = analyzeLayer({
      pkgPath,
      selector: { name: val('--name'), index: argv.includes('--index') ? Number(val('--index')) : null, id: argv.includes('--id') ? Number(val('--id')) : null },
      attTime: tIdx >= 0 ? Number(argv[tIdx].slice(4)) || 0 : 0,
    })
  } finally { console.log = origLog }
  if (argv.includes('--json')) console.log('##JSON## ' + JSON.stringify(a))
  else console.log(renderMd(a))   // 缺省即 --md（本工具的输出就是一页 Markdown）
  process.exit(a.ok ? 0 : 1)
}
