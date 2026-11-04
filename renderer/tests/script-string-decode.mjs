#!/usr/bin/env node
// script-string-decode.mjs —— 反混淆脚本的**字符串表解码**（离线只读；给"作者脚本为什么走了这条分支"取证用）
//
// 背景：语料里的作者脚本是 `_0x…` 混淆（字符串表 base64 + 自带的解码器，调用形态 `_0x3123('0x2d','qyka')`）。
//   `docs/reports-2887099508-layers.md` §2d 的取证卡在"某个成员名/常量在编码表里，读不出来"这一步，
//   于是把解码做成可复用工具：在 `node:vm` 沙箱里跑脚本**只到解码器初始化**（顶层 IIFE），捕获解码函数，
//   再把每个调用点 `(idx,key)` 逐个解码 —— 不联网、不起浏览器、不改任何文件。
//
// 用法：
//   node tests/script-string-decode.mjs --pkg <abs scene.pkg> --object 78
//   node tests/script-string-decode.mjs --pkg <abs scene.pkg> --name 'tim logo' [--all]
//   node tests/script-string-decode.mjs --scene <abs scene.json> --object 78
// `--all` = 除映射外还打印去重后的全部字符串（默认只打印映射）。
import fs from 'node:fs'
import vm from 'node:vm'

const argv = process.argv.slice(2)
const val = (k, d = null) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const PKG = val('--pkg'), SCENE = val('--scene')
const WANT_OBJ = val('--object'), WANT_NAME = val('--name')
if (!PKG && !SCENE) { console.error('用法: node tests/script-string-decode.mjs --pkg <abs scene.pkg> | --scene <abs scene.json> --object <idx> | --name <层名>'); process.exit(2) }

const lib = await import(new URL('../core/we-scene-bundle.js', import.meta.url).href)
let objects = []
if (PKG) {
  const pkg = lib.parsePkg(fs.readFileSync(PKG))
  const js = JSON.parse(lib.getEntry(pkg, 'scene.json').toString('utf8'))
  objects = js.objects || []
} else {
  const js = JSON.parse(fs.readFileSync(SCENE, 'utf8'))
  objects = js.objects || []
}
/** 解码一个脚本对象：返回 {ok, fns, calls, map:Map, uniq:string[]}（沙箱只跑到解码器初始化）。 */
function decodeScript(obj) {
  const raw = obj && obj.visible
  const text = typeof raw === 'string' ? raw : String((raw && raw.script) || '')
  if (!text) return { ok: false, text: '', map: new Map(), uniq: [], calls: 0, fns: [] }
  const calls = [...text.matchAll(/(_0x[0-9a-f]+)\(\s*'(0x[0-9a-f]+)'\s*,\s*'([^']*)'\s*\)/g)].map((m) => ({ fn: m[1], idx: m[2], key: m[3] }))
  const fns = [...new Set(calls.map((c) => c.fn))]
  let code = text.replace(/\bexport\s+/g, '')
  code += '\n;globalThis.__dec = {' + fns.map((f) => f + ':' + f).join(',') + '};\n'
  const sandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    Math, Date, JSON, Number, String, Boolean, Array, Object, RegExp, Error, isFinite, isNaN, parseInt, parseFloat,
    atob: (v) => Buffer.from(String(v), 'base64').toString('binary'),
    btoa: (v) => Buffer.from(String(v), 'binary').toString('base64'),
    Function, setTimeout: () => 0, setInterval: () => 0, clearTimeout: () => {}, clearInterval: () => {},
    localStorage: { getItem: () => null, setItem: () => {} },
    shared: {}, engine: {}, thisScene: {}, thisLayer: {}, parent: {}, window: null, globalThis: null, self: null,
  }
  sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox
  const ctx = vm.createContext(sandbox)
  try { vm.runInContext(code, ctx, { timeout: 5000 }) } catch (e) { /* 顶层中断不影响已捕获的解码器 */ }
  const dec = sandbox.__dec || {}
  const map = new Map()
  for (const c of calls) {
    const fn = dec[c.fn]
    if (typeof fn !== 'function') continue
    try { const v = fn(c.idx, c.key); if (typeof v === 'string') map.set(c.idx + '|' + c.key, v) } catch (e) { /* 单点失败跳过 */ }
  }
  return { ok: true, text, map, uniq: [...new Set(map.values())], calls: calls.length, fns }
}

/* ── --sweep：扫"哪些脚本引用了某个层名 / 写了哪些成员"（默认目标 = 中-菜单-浮动） ── */
if (argv.includes('--sweep')) {
  const target = val('--target', '中-菜单-浮动')
  const rows = []
  for (let i = 0; i < objects.length; i++) {
    const d = decodeScript(objects[i])
    if (!d.ok) continue
    const members = d.uniq.filter((x) => /^[a-zA-Z_][a-zA-Z0-9_]{2,24}$/.test(x))
    rows.push({ i, name: String(objects[i].name || ''), id: objects[i].id, calls: d.calls, uniq: d.uniq.length, target: d.uniq.includes(target), members })
  }
  const hit = rows.filter((r) => r.target)
  console.log(`扫到带脚本对象 ${rows.length} 个；引用 "${target}" 的 ${hit.length} 个：`)
  for (const r of hit) console.log(`   objects[${r.i}] ${r.name}（id ${r.id}）· 解码 ${r.uniq} 条 · 成员: ${r.members.join(',')}`)
  console.log('---- 全部带脚本对象（前 30）----')
  for (const r of rows.slice(0, 30)) console.log(`   objects[${r.i}] ${r.name}（id ${r.id}）· ${r.calls} 调用点 · ${r.uniq} 条${r.target ? '  ← 引用目标' : ''}`)
  process.exit(0)
}
/* ── --chain：扫"脚本驱动的字段"（`{script: …}`）与它们引用的层名 ⇒ 看清一张壁纸的**布局链**
   （谁按谁的位置 ± 偏移摆放）。用法：--chain [--target <层名>] ── */
if (argv.includes('--chain')) {
  const decodeAny = (text) => {
    if (!text) return []
    const calls = [...text.matchAll(/(_0x[0-9a-f]+)\(\s*'(0x[0-9a-f]+)'\s*,\s*'([^']*)'\s*\)/g)].map((m) => ({ fn: m[1], idx: m[2], key: m[3] }))
    const fns = [...new Set(calls.map((c) => c.fn))]
    let code = text.replace(/\bexport\s+/g, '')
    code += '\n;globalThis.__dec = {' + fns.map((f) => f + ':' + f).join(',') + '};\n'
    const sb = {
      console: { log: () => {}, warn: () => {}, error: () => {} },
      Math, Date, JSON, Number, String, Boolean, Array, Object, RegExp, Error, isFinite, isNaN, parseInt, parseFloat,
      atob: (v) => Buffer.from(String(v), 'base64').toString('binary'),
      Function, setTimeout: () => 0, setInterval: () => 0, clearTimeout: () => {}, clearInterval: () => {},
      localStorage: { getItem: () => null, setItem: () => {} },
      shared: {}, engine: {}, thisScene: {}, thisLayer: {}, parent: {}, window: null, globalThis: null, self: null,
    }
    sb.window = sb; sb.globalThis = sb; sb.self = sb
    try { vm.runInContext(code, vm.createContext(sb), { timeout: 5000 }) } catch (e) { /* 顶层中断不影响解码 */ }
    const dec = sb.__dec || {}
    const out = new Map()
    for (const c of calls) { const fn = dec[c.fn]; if (typeof fn !== 'function') continue; try { const v = fn(c.idx, c.key); if (typeof v === 'string') out.set(c.idx + '|' + c.key, v) } catch (e) { /* 跳过 */ } }
    return [...new Set(out.values())]
  }
  const names = new Set(objects.map((o) => String(o && o.name || '')))
  const rows = []
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i] || {}
    for (const k of Object.keys(o)) {
      const v = o[k]
      if (!v || typeof v !== 'object' || typeof v.script !== 'string') continue
      const strs = decodeAny(v.script)
      const refs = strs.filter((x) => names.has(x))
      const nums = [...new Set([...v.script.matchAll(/[-+]?0x[0-9a-f]+|\b\d{2,5}\b/gi)].map((m) => m[0]))].slice(0, 8)
      rows.push({ i, name: String(o.name || ''), id: o.id, field: k, refs, nums, fallback: v.value })
    }
  }
  console.log(`脚本驱动字段 ${rows.length} 个（分布在 ${new Set(rows.map((r) => r.i)).size} 个层）：`)
  for (const r of rows) {
    console.log(`   objects[${r.i}] ${r.name}（id ${r.id}）· ${r.field} · 引用层: ${r.refs.join(',') || '—'} · 失败兜底值: ${String(r.fallback).slice(0, 40)}`)
  }
  const target = val('--target')
  if (target) {
    const hits = rows.filter((r) => r.refs.includes(target))
    console.log(`---- 引用 "${target}" 的脚本字段（${hits.length}）----`)
    for (const r of hits) console.log(`   objects[${r.i}] ${r.name} · ${r.field}`)
  }
  process.exit(0)
}

let idx = -1
if (WANT_OBJ != null) idx = Number(WANT_OBJ)
else if (WANT_NAME != null) idx = objects.findIndex((o) => String(o.name || '') === WANT_NAME)
if (!(idx >= 0 && idx < objects.length)) { console.error('找不到对象：--object/--name 至少给一个有效的'); process.exit(2) }
const obj = objects[idx]
const raw = obj.visible
const text = typeof raw === 'string' ? raw : String((raw && raw.script) || '')
if (!text) { console.error(`objects[${idx}]（${obj.name}）没有脚本正文（visible 不是字符串/script）`); process.exit(2) }

const calls = [...text.matchAll(/(_0x[0-9a-f]+)\(\s*'(0x[0-9a-f]+)'\s*,\s*'([^']*)'\s*\)/g)].map((m) => ({ fn: m[1], idx: m[2], key: m[3] }))
const fns = [...new Set(calls.map((c) => c.fn))]
let code = text.replace(/\bexport\s+/g, '')
code += '\n;globalThis.__dec = {' + fns.map((f) => f + ':' + f).join(',') + '};\n'
const sandbox = {
  console: { log: () => {}, warn: () => {}, error: () => {} },
  Math, Date, JSON, Number, String, Boolean, Array, Object, RegExp, Error, isFinite, isNaN, parseInt, parseFloat,
  atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
  btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
  Function, setTimeout: () => 0, setInterval: () => 0, clearTimeout: () => {}, clearInterval: () => {},
  localStorage: { getItem: () => null, setItem: () => {} },
  shared: {}, engine: {}, thisScene: {}, thisLayer: {}, parent: {}, window: null, globalThis: null, self: null,
}
sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.self = sandbox
const ctx = vm.createContext(sandbox)
let err = null
try { vm.runInContext(code, ctx, { timeout: 5000 }) } catch (e) { err = e }
const dec = sandbox.__dec || {}
const out = new Map()
for (const c of calls) {
  const fn = dec[c.fn]
  if (typeof fn !== 'function') continue
  try { const v = fn(c.idx, c.key); if (typeof v === 'string') out.set(c.idx + '|' + c.key, v) } catch (e) { /* 单点解码失败不影响其它 */ }
}
console.log(`objects[${idx}] = ${obj.name}（id ${obj.id}）· 脚本 ${text.length} 字符 · 解码器 ${fns.join(',') || '(未捕获)'} · 调用点 ${calls.length} · 解码 ${out.size}'`)
if (err) console.log(`⚠ 沙箱里顶层执行中断（解码器仍可能已捕获）：${String(err.message).slice(0, 100)}`)
for (const [k, v] of out) console.log('   ', k, '=>', JSON.stringify(v))
if (argv.includes('--all')) {
  console.log('---- 去重（' + new Set(out.values()).size + ' 条）----')
  console.log([...new Set(out.values())].join(' | '))
}

/* ── --call <导出名>[,…]：在**同一个 vm 沙箱**里用**桩门面**真的调一次导出，把"脚本为什么没走到某条分支"
   变成可复核读数（离线、无浏览器）：用 Proxy 记录成员访问 / 赋值 / 调用，桩返回值可继续链式取成员。
   读数：`toplevel`（顶层是否抛）+ `call`（调用是否抛）+ 访问/赋值/调用轨迹（前 40 条）。 ── */
if (val('--call')) {
  const names = String(val('--call')).split(',').map((x) => x.trim()).filter(Boolean)
  const trace = { get: [], set: [], call: [], err: [] }
  const mkStub = (label) => new Proxy(function () {}, {
    get(_t, k) {
      if (typeof k === 'symbol' || k === 'then' || k === 'inspect') return undefined
      trace.get.push(label + '.' + String(k))
      return mkStub(label + '.' + String(k))
    },
    set(_t, k, v) {
      trace.set.push(label + '.' + String(k) + ' = ' + (v && typeof v === 'object' ? '[obj]' : JSON.stringify(v)))
      return true
    },
    apply(_t, _this, args) {
      const a = args.map((x) => (typeof x === 'string' ? JSON.stringify(x) : typeof x === 'number' ? String(x) : '[obj]')).join(', ')
      trace.call.push(label + '(' + a + ')')
      return mkStub(label + '()')
    },
  })
  const shared = new Proxy({}, { get: (t, k) => (k in t ? t[k] : 0), set: (t, k, v) => { t[k] = v; return true } })
  const sb = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    Math, Date, JSON, Number, String, Boolean, Array, Object, RegExp, Error, isFinite, isNaN, parseInt, parseFloat,
    atob: (v) => Buffer.from(String(v), 'base64').toString('binary'),
    Function, setTimeout: () => 0, setInterval: () => 0, clearTimeout: () => {}, clearInterval: () => {},
    localStorage: { getItem: () => null, setItem: () => {} },
    shared, engine: mkStub('engine'), thisScene: mkStub('thisScene'), thisLayer: mkStub('thisLayer'), parent: mkStub('parent'),
    window: null, globalThis: null, self: null,
  }
  sb.window = sb; sb.globalThis = sb; sb.self = sb
  const exportsList = [...new Set([...text.matchAll(/export\s+function\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))]
  let code2 = text.replace(/\bexport\s+/g, '')
  code2 += '\n;globalThis.__exp = {' + exportsList.map((n) => n + ':' + n).join(',') + '};\n'
  const ctx2 = vm.createContext(sb)
  try { vm.runInContext(code2, ctx2, { timeout: 5000 }) } catch (e) { trace.err.push('toplevel: ' + String(e && e.message || e).slice(0, 140)) }
  console.log(`objects[${idx}] = ${obj.name}（id ${obj.id}）· 导出: ${exportsList.join(',') || '(无)'}`)
  for (const n of names) {
    const fn = sb.__exp && sb.__exp[n]
    if (typeof fn !== 'function') { console.log(`   --call ${n}: **没有这个导出**`); continue }
    trace.get.length = 0; trace.set.length = 0; trace.call.length = 0
    let ret = null
    try { ret = fn(mkStub('event')) } catch (e) { trace.err.push(n + ': ' + String(e && e.message || e).slice(0, 160)) }
    console.log(`   --call ${n}: ${ret === undefined ? 'undefined' : (ret && typeof ret === 'object' ? '[obj]' : JSON.stringify(ret))}`)
    if (trace.err.length) console.log('      errors: ' + JSON.stringify(trace.err))
    if (trace.call.length) console.log('      调用: ' + trace.call.slice(0, 12).join(' | '))
    if (trace.set.length) console.log('      赋值: ' + trace.set.slice(0, 12).join(' | '))
    if (trace.get.length) console.log('      读取: ' + trace.get.slice(0, 40).join(' | '))
  }
}

