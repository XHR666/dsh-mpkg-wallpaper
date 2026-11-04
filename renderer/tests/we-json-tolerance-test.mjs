// we-json-tolerance-test.mjs —— 官方随包 JSON 的**宽容解析**判据（`parseWeJson`）。
//
// 被验对象：`core/we-scene-bundle.js` 的 `parseWeJson(text)` / `weJsonStats()`，以及**页面与 bundle 里
// 所有"吃容器条目文本"的解析点是否都走了它**（`JSON.parse(rd(...))` 残留 = 静默丢一份官方文件）。
//
// 为什么（官方证据，2026-09-24）：官方随包发布的 `assets/effects/fluidsimulation/effect.json`（10,224 B）
// **自己就带尾逗号**（第 402 行后面紧跟 `}`），标准 `JSON.parse` 直接报
// `Expecting value: line 403 column 2`。WE 照发照用 ⇒ 官方容忍尾逗号（引擎用 jsoncpp，二进制里带
// `allowTrailingCommas`/`allowComments` 开关名）。我们这边凡是"读失败就 catch 成 null"的地方都是**静默**丢：
// 效果链整条消失（官方 fluidsimulation 是 20 pass / 9 FBO）、属性面板空白、`{user:…}` 绑定全部回落。
//
// 三层判据（纯 Node、不读语料、<3s）：
//   S1 结构：bundle 导出 `parseWeJson`/`weJsonStats`；页面与 bundle 里"读条目文本"的解析点**没有**严格的
//      `JSON.parse(rd(` / `JSON.parse(readText(` 残留（自推导扫描，不列行号）。
//   S2 行为：夹具逐条 —— 尾逗号（对象/数组/嵌套/多处）、**字符串内的 `,}` 一个字都不许动**、注释只在
//      尾逗号仍失败时才吃、合法 JSON 逐位等于 `JSON.parse`、真坏 JSON **仍然抛**、BOM 与官方一致地吃掉；
//      计数 `plain/trailingComma/comments/failed` 逐项对得上。
//   S3 官方真样本 + 变异自证：本机有官方 WE 目录时读那份 `fluidsimulation/effect.json` 断言"严格失败、宽容成功"
//      （没装 WE 就 SKIP 那一条，不假绿）；变异：把宽容解析换回 `JSON.parse` ⇒ S2/S3 必红。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ROOT, WS } from './_root.mjs'
/* ①(2026-09-24) **按 ROOT 动态 import**（而不是 `import '../core/…'`）：变异自证要把 `MPW_REPO_ROOT`
   指到隔离副本上跑，静态相对路径会永远指向真树 ⇒ 变异体"改不动"（第一版就是因此假绿）。 */
const lib = await import('file://' + path.join(ROOT, 'core', 'we-scene-bundle.js'))

const FILE = fileURLToPath(import.meta.url)
const DEMO = path.join(ROOT, 'demo.html')
const BUNDLE = path.join(ROOT, 'core/we-scene-bundle.js')
const html = fs.readFileSync(DEMO, 'utf8')
const bundleSrc = fs.readFileSync(BUNDLE, 'utf8')
const WE = process.env.MPW_WE_ASSETS || path.join(WS, 'wallpaper_engine', 'assets')

let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}

console.log('== 官方随包 JSON 的宽容解析（尾逗号/注释）+ 解析点全覆盖 ==')

/* ───────────────── S1：结构（自推导，不硬编码行号） ───────────────── */
check('S1-1 bundle 导出 `parseWeJson` 与 `weJsonStats`',
  /export function parseWeJson\s*\(/.test(bundleSrc) && /export const weJsonStats\s*=/.test(bundleSrc))
{
  /* 自推导：把"读容器条目文本"的解析点找出来 —— 形态是 `JSON.parse(<…rd(…)|readText(…)|sceneJson…>)`。
     允许的写法只有 `(lib.)?parseWeJson(...)`。注释里的举例不算（先剥注释与字符串再扫）。 */
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
  const scan = (src, label) => {
    const t = strip(src)
    const bad = []
    const re = /JSON\.parse\s*\(\s*([^)]{0,120})\)/g
    let m
    while ((m = re.exec(t)) !== null) {
      const arg = m[1]
      if (/(\brd\s*\(|\breadText\s*\(|sceneJson|\.toString\(\s*['"]utf8['"]\s*\)|new TextDecoder)/.test(arg)) bad.push(arg.trim().slice(0, 60))
    }
    return { label, bad }
  }
  const r1 = scan(html, 'demo.html'), r2 = scan(bundleSrc, 'core/we-scene-bundle.js')
  check('S1-2 页面与 bundle 里"读条目文本"的解析点全部走 parseWeJson（0 处严格 JSON.parse 残留）',
    r1.bad.length === 0 && r2.bad.length === 0, JSON.stringify([r1, r2]))
  check('S1-3 页面调用形态是 `lib.parseWeJson(...)`（bundle 内是裸 `parseWeJson(...)`）',
    /lib\.parseWeJson\s*\(/.test(html) && /[^.\w]parseWeJson\s*\(/.test(bundleSrc.replace(/export function parseWeJson/, '')))
}

/* ───────────────── S2：行为夹具 ───────────────── */
const c0 = lib.weJsonStats()
const T = (name, text) => { try { return { ok: true, v: lib.parseWeJson(text) } } catch (e) { return { ok: false, e: String(e.message) } } }
{
  const cases = [
    ['对象尾逗号', '{"a":1,"b":[1,2,],}', { a: 1, b: [1, 2] }],
    ['数组尾逗号', '[1,2,3,]', [1, 2, 3]],
    ['嵌套 + 多处', '{"a":{"b":[{"c":1,},],},}', { a: { b: [{ c: 1 }] } }],
    ['只留一个逗号', '{"a":1,}', { a: 1 }],
    ['合法 JSON 逐位相同', '{"a":[1,{"b":"x"}]}', { a: [1, { b: 'x' }] }],
  ]
  for (const [name, text, want] of cases) {
    const r = T(name, text)
    check('S2-1 ' + name, r.ok && JSON.stringify(r.v) === JSON.stringify(want), r.ok ? JSON.stringify(r.v) : r.e)
  }
  /* 字符串里的 `,}` / `,]` / `//` / `/*` 一律不许动 —— 这是"宽容"最容易写错的地方 */
  const s1 = '{"a":"x,}y","b":"p,]q","c":"line//not-comment","d":"/*keep*/"}'
  const r1 = T('字符串保护', s1)
  check('S2-2 字符串内的 `,}`/`,]`/`//`/`/*` 内容逐位不变', r1.ok && r1.v.a === 'x,}y' && r1.v.b === 'p,]q' &&
    r1.v.c === 'line//not-comment' && r1.v.d === '/*keep*/', r1.ok ? JSON.stringify(r1.v) : r1.e)
  const r2 = T('坏 JSON 仍抛', '{"a":,}')
  check('S2-3 真坏 JSON **仍然抛**（不糊成 undefined）', !r2.ok, r2.ok ? '居然解析成功' : r2.e)
  const r3 = T('BOM', '\uFEFF{"a":1}')
  check('S2-4 带 BOM 的官方文件能解析（与 JSON.parse 的差别之一）', r3.ok && r3.v.a === 1, r3.ok ? 'ok' : r3.e)
  const r4 = T('注释兜底', '{"a":1, // 官方 jsoncpp 允许注释\n "b":2}')
  check('S2-5 尾逗号仍失败时才吃注释（行注释 + 块注释）',
    r4.ok && r4.v.a === 1 && r4.v.b === 2, r4.ok ? JSON.stringify(r4.v) : r4.e)
  const r5 = T('注释里的 }', '{"a":1 /* } , ] */ }')
  check('S2-6 注释里的括号/逗号不影响结构', r5.ok && r5.v.a === 1, r5.ok ? JSON.stringify(r5.v) : r5.e)
  /* 逐例取增量（不写死总数）：每一例该涨哪个计数器是**语义**，不是巧合。 */
  {
    const probe = (text) => { const a = lib.weJsonStats(); T('probe', text); const b = lib.weJsonStats(); return Object.fromEntries(Object.keys(a).map((k) => [k, b[k] - a[k]])) }
    const dTrail = probe('{"a":1,}')
    const dPlain = probe('{"a":1}')
    const dCom = probe('{"a":1 // c\n}')
    const dFail = probe('{"a":,}')
    check('S2-7 计数逐项对得上（尾逗号/合法/注释/失败 各自 +1，且 calls 每例 +1）',
      dTrail.trailingComma === 1 && dTrail.calls === 1 && dPlain.plain === 1 && dCom.comments === 1 && dFail.failed === 1,
      JSON.stringify({ dTrail, dPlain, dCom, dFail }))
    const c1 = lib.weJsonStats()
    check('S2-8 计数是只读快照（weJsonStats() 返回副本，改它不影响内部）',
      (() => { const a = lib.weJsonStats(); a.calls = -999; return lib.weJsonStats().calls !== -999 })(),
      JSON.stringify({ before: c0.calls, after: c1.calls }))
  }
}

/* ───────────────── S3：官方真样本 + 变异自证 ───────────────── */
const OFFICIAL = path.join(WE, 'effects', 'fluidsimulation', 'effect.json')
if (fs.existsSync(OFFICIAL)) {
  const raw = fs.readFileSync(OFFICIAL, 'utf8')
  let strictOk = true
  try { JSON.parse(raw) } catch (e) { strictOk = false }
  const r = T('官方 fluidsimulation', raw)
  check('S3-1 官方 `effects/fluidsimulation/effect.json`：严格 JSON.parse **失败**、parseWeJson **成功**',
    strictOk === false && r.ok && Array.isArray(r.v.passes) && r.v.passes.length === 20 && Array.isArray(r.v.fbos) && r.v.fbos.length === 9,
    JSON.stringify({ strictOk, ok: r.ok, passes: r.ok ? r.v.passes.length : null, fbos: r.ok ? r.v.fbos.length : null }))
} else {
  console.log('  · S3-1 SKIP —— 本机没有官方 WE 目录（' + OFFICIAL + '）')
}

if (!process.argv.includes('--no-mutations')) {
  console.log('== 变异自证（隔离副本；真树不动）==')
  /* 变异：把 `parseWeJson` 的实现改成"直接 JSON.parse"（= 修之前的行为）⇒ S2 的尾逗号/注释夹具与 S3 必红。 */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-wejson-'))
  const root = path.join(tmp, 'mut')
  /* 副本要**整个 core/**（bundle 会 import attach-transform 等）：逐个 copyFileSync —— 本机 /tmp 是 tmpfs，
     递归 `fs.cpSync` 会 EINVAL（本仓既有教训）。 */
  fs.mkdirSync(path.join(root, 'core'), { recursive: true })
  for (const f of fs.readdirSync(path.join(ROOT, 'core'))) {
    const src = path.join(ROOT, 'core', f)
    if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(root, 'core', f))
  }
  const mutated = bundleSrc.replace(/export function parseWeJson\(text\) \{[\s\S]*?\n\}/,
    'export function parseWeJson(text) { return JSON.parse(text) }')
  if (mutated === bundleSrc) check('S3-M 变异锚点命中（解析函数体可替换）', false)
  else {
    fs.writeFileSync(path.join(root, 'core', 'we-scene-bundle.js'), mutated)   // 覆盖成变异体
    fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(root, 'package.json'))
    fs.copyFileSync(DEMO, path.join(root, 'demo.html'))
    const r = spawnSync(process.execPath, [FILE, '--no-mutations'], { encoding: 'utf8', env: { ...process.env, MPW_REPO_ROOT: root } })
    const reds = (r.stdout || '').split('\n').filter((l) => l.includes('✗')).map((l) => (/✗\s*(S\d[^\s]*)/.exec(l) || [])[1]).filter(Boolean)
    const want = reds.length > 0 && reds.every((x) => x.startsWith('S2') || x.startsWith('S3'))
    check('S3-M 变异（parseWeJson 退回严格 JSON.parse）⇒ 只有 S2/S3 变红且确实变红',
      want, 'exit=' + r.status + ' 红=' + JSON.stringify(reds.slice(0, 6)))
    if (want) console.log('    MUTANT-RED-OK 红集=' + JSON.stringify(reds.slice(0, 8)))
  }
  fs.rmSync(tmp, { recursive: true, force: true })
  check('S3-M2 真树 core/we-scene-bundle.js 未被变异触碰', bundleSrc === fs.readFileSync(BUNDLE, 'utf8'))
}

console.log('\n===== we-json-tolerance: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
process.exit(fail ? 1 : 0)
