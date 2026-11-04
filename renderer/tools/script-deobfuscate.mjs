// tools/script-deobfuscate.mjs —— 去混淆**单个脚本字段**并把字符串表调用替换成字面量（P-236/§2n 取证同款）
//   语料里的作者脚本是 `_0x…` 混淆（字符串表 base64 + 自带解码器，调用形态 `_0x3123('0x2d','qyka')`）。
//   tests/script-string-decode.mjs 负责"读出字符串表/列出脚本驱动字段"，本工具负责**把整段源码读顺**：
//   在 node:vm 沙箱里只跑到解码器初始化，再把每个调用点替换成解出的字面量。
//   用法：node tools/script-deobfuscate.mjs <scene.pkg|scene.json> <层名> [字段名]
//   例：node tools/script-deobfuscate.mjs ~/x/scene.pkg ldfk visible
// 读数用途：判断"某条分支为什么没走到"（§2n 的 ldfl 连点 4 次、设置族 alpha 的 shared[16] 门都是这么读出来的）。
import fs from 'node:fs'
import vm from 'node:vm'
import * as lib from '../core/we-scene-bundle.js'   // 相对脚本自身位置（公开仓库不得带本机绝对路径）
const [pkgPath, wantName, wantField] = process.argv.slice(2)
if (!pkgPath || !wantName) { console.error('用法: node tools/script-deobfuscate.mjs <scene.pkg> <层名> [字段名]'); process.exit(2) }
const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(pkgPath)))
const sj = JSON.parse(new TextDecoder().decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, ''))
const obj = sj.objects.find((o) => String(o.name) === wantName)
if (!obj) { console.log('找不到层'); process.exit(1) }
const field = wantField || Object.keys(obj).find((k) => obj[k] && typeof obj[k] === 'object' && typeof obj[k].script === 'string')
const v = obj[field]
const text = typeof v === 'string' ? v : v.script
console.log(`层「${wantName}」字段 ${field} · 脚本 ${text.length} 字符 · 兜底值 ${JSON.stringify(v.value)}`)
// 解码字符串表
const calls = [...text.matchAll(/(_0x[0-9a-f]+)\(\s*'(0x[0-9a-f]+)'\s*,\s*'([^']*)'\s*\)/g)].map((m) => ({ fn: m[1], idx: m[2], key: m[3] }))
const fns = [...new Set(calls.map((c) => c.fn))]
let code = text.replace(/\bexport\s+/g, '') + '\n;globalThis.__dec = {' + fns.map((f) => f + ':' + f).join(',') + '};\n'
const sb = { console: { log: () => {}, warn: () => {}, error: () => {} }, Math, Date, JSON, Number, String, Boolean, Array, Object, RegExp, Error, isFinite, isNaN, parseInt, parseFloat,
  atob: (s) => Buffer.from(String(s), 'base64').toString('binary'), btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
  Function, setTimeout: () => 0, setInterval: () => 0, clearTimeout: () => {}, clearInterval: () => {}, localStorage: { getItem: () => null, setItem: () => {} },
  shared: {}, engine: {}, thisScene: {}, thisLayer: {}, parent: {}, window: null, globalThis: null, self: null }
sb.window = sb; sb.globalThis = sb; sb.self = sb
try { vm.runInContext(code, vm.createContext(sb), { timeout: 5000 }) } catch (e) {}
const dec = sb.__dec || {}
const map = new Map()
for (const c of calls) { const fn = dec[c.fn]; if (typeof fn !== 'function') continue; try { const s = fn(c.idx, c.key); if (typeof s === 'string') map.set(c.idx + '|' + c.key, s) } catch (e) {} }
// 把脚本里的 _0x…('0x..','key') 调用替换成解码后的字面量
let readable = text.replace(/(_0x[0-9a-f]+)\(\s*'(0x[0-9a-f]+)'\s*,\s*'([^']*)'\s*\)/g, (mm, fn, idx, key) => JSON.stringify(map.get(idx + '|' + key) ?? mm))
readable = readable.replace(/\bexport\s+/g, '')
console.log('---- 可读化正文（前 1400 字符）----')
const i = readable.indexOf('import*as')
console.log(readable.slice(i >= 0 ? i : Math.max(0, readable.length - 2400)))
console.log('---- 数值常量 ----')
console.log([...new Set([...text.matchAll(/0x[0-9a-f]{1,4}|\b\d{1,6}\b/gi)].map((m) => m[0]))].slice(0, 30).join(' '))
