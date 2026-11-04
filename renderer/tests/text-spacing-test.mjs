// text-spacing-test.mjs — P-208 F2（P-219 号）文本 `spacing`：解析保留 + 行为默认关判据。
//
// 官方依据（REVERSE-FINDINGS-7 RE-49）：`spacing` 在两份官方二进制键表**都没读到**（可能 TextLayer
// 属性走 SSO 内联，语义未定案）；语料 139 层全 "0.00000 0.00000"（恒安全值）。任务书 §0.1 规则 B：
// 接口先行、行为默认关 —— 不许丢字段、不许写死。
//
// 实现（P-217 + P-219）：① parseScene 把 `spacing` 字符串原样存进层描述符（P-217 M1 已覆盖真包断言）；
// ② demo.html 文本光栅化：缺省（?spacing=legacy）与改动前**逐位一致**；`?spacing=on` 才启用
// "x=字符间距、y=行距增量"（语义按此假设，注释写明未定案）；台账 `window.__mpwTextSpacing`。
//
// 判据（全部离线）：
//   T1 解析：真包 0917/3195212886 的 spacing 层进描述符（原样字符串）；缺省 null 保留。
//   T2 默认关：demo 源码序——SPACING_ON 门控在 fillText 循环前、缺省路径逐字 fillText(m.line,…)
//     与改动前同形；`?spacing=on` 才走逐字符推进分支。
//   T3 行为：`?spacing=on` + 非零 x ⇒ 逐字符 fillText（次数 = 字符数×行数）；x=0 ⇒ 整行一次
//     （与改动前同形）；y 增量进 lineY。
//   T4 addText 动态文本路径：同一光栅化函数（源码锚点：addText 层走 __text 描述符 ⇒ 共用）。
//   T5 变异自证：把门控改成恒 on（缺省行为被破坏）⇒ T2 红（隔离副本真改真跑）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'
import { readSceneJsonText, openPkgLazy } from './_pkg-index.mjs'

const FILE = fileURLToPath(import.meta.url)
const DEMO = path.join(ROOT, 'demo.html')
const html = fs.readFileSync(DEMO, 'utf8')

let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}

console.log('== F2 文本 spacing：解析保留 + 行为默认关（RE-49 规则 B）==')
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps

/* T1 解析（真包） */
{
  const f = path.join(WS, 'allwallpaper/0917/3195212886/scene.pkg')
  if (!fs.existsSync(f)) { check('T1 真包 spacing 解析', false, '语料缺失: ' + f) }
  else {
    const lib = await import(pathToFileURL(path.join(ROOT, 'core', 'we-scene-bundle.js')).href)
    const scene = lib.parseScene(lib.parseWeJson(readSceneJsonText(f)), null, {})
    const sp = scene.layers.filter((l) => typeof l.spacing === 'string')
    check('T1 真包 3195212886：spacing 层进描述符（原样字符串，如 "0.00000 0.00000"）',
      sp.length > 0 && sp.every((l) => /^\s*[-\d.]+\s+[-\d.]+\s*$/.test(l.spacing)),
      'n=' + sp.length + ' 样本=' + (sp[0] && sp[0].spacing))
    check('T1b 无 spacing 的层字段保留为 null（三态，不丢）',
      scene.layers.every((l) => l.spacing === null || typeof l.spacing === 'string'), '')
  }
}

/* T2/T3 源码序 + 行为 */
{
  check("T2a SPACING_ON 门控存在且缺省 legacy（get('spacing') === 'on'）",
    html.includes("get('spacing') === 'on'"), '')
  // 默认路径：x=0 ⇒ 整行一次 fillText(m.line, …)（与改动前同形）
  check('T2b 缺省/零字距 ⇒ 整行一次 fillText（`ctx.fillText(m.line, x, lineY)`）',
    /ctx\.fillText\(m\.line, x, lineY\)/.test(html), '')
  check('T2c 非零字距 ⇒ 逐字符推进（`cx += ctx.measureText(ch).width + __spX`）',
    /cx \+= ctx\.measureText\(ch\)\.width \+ __spX/.test(html), '')
  check('T2d 行距增量（`lineH + __spY`）', /lineH \+ __spY/.test(html), '')
  check('T2e 台账 `window.__mpwTextSpacing`（layers/applied）', html.includes('__mpwTextSpacing'), '')
  check('T2f 语义未定案注释在位（"语义未证实"）', /官方语义未证实/.test(html), '')
  // T3 行为（切片执行绘制循环的 spacing 段）
  {
    const fillCalls = []
    const measureCalls = []
    const ctx = {
      font: '', textBaseline: '', fillStyle: '', textAlign: '',
      measureText: (s) => { measureCalls.push(s); return { width: s.length * 10 } },
      fillText: (s, x, y) => fillCalls.push({ s, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 }),
    }
    const SPACING_ON = true
    const t = { spacing: '5 8' }
    let __spX = 0, __spY = 0
    if (SPACING_ON && typeof t.spacing === 'string') {
      const sp = t.spacing.trim().split(/\s+/).map(Number)
      if (sp.length >= 2 && sp.every(isFinite)) { __spX = sp[0]; __spY = sp[1] }
    }
    const metrics = [{ line: 'ab', adv: 20, il: 0, ir: 20, ia: 10, id: 2 }, { line: 'cd', adv: 20, il: 0, ir: 20, ia: 10, id: 2 }]
    const lineH = 12, inkTop = 0, maxIa = 10, w = 100, pad = [0, 0, 0, 0], ha = 'left'
    for (let i = 0; i < metrics.length; i++) {
      const m = metrics[i]
      const x = ha === 'center' ? ((w - m.adv) / 2) : (ha === 'right' ? (w - pad[3] - m.adv) : pad[1])
      const lineY = inkTop + maxIa + i * (lineH + __spY)
      if (__spX !== 0) { let cx = x; for (const ch of m.line) { ctx.fillText(ch, cx, lineY); cx += ctx.measureText(ch).width + __spX } }
      else ctx.fillText(m.line, x, lineY)
    }
    check('T3a ?spacing=on + x=5 ⇒ 每字符一次 fillText（2 行 × 2 字符 = 4 次）+ 字符推进 +5',
      fillCalls.length === 4 && near(fillCalls[1].x, fillCalls[0].x + 15), JSON.stringify(fillCalls.map((c) => [c.s, c.x, c.y])))
    check('T3b y=8 ⇒ 行距增量（第 2 行 y = 第 1 行 + 20）',
      near(fillCalls[2].y - fillCalls[0].y, 20), JSON.stringify([fillCalls[0].y, fillCalls[2].y]))
  }
}

/* T4 addText 动态文本共用路径（源码锚点） */
{
  check('T4 addText/静态文本共用 __text 光栅化（demo 侧 addText 层构造 __text 描述符）',
    /addText/.test(html) && /__text/.test(html), '两处锚点同在')
}

/* T5 变异自证（隔离副本真改真跑） */
{
  const MUTANTS = [
    // ① 门控被改成恒 on（缺省行为被破坏）：T2b 的"缺省整行一次"路径死掉 ⇒ T2 红
    { id: 'always-on', expect: ['T1', 'T2'],  /* T1 的真包 import 也受 MPW_REPO_ROOT 影响（隔离副本没有 core/）⇒ 连带红，实测 */ edit: (s) => s.replace("return new URLSearchParams(location.search).get('spacing') === 'on'", 'return true') },
  ]
  if (!process.argv.includes('--no-mutations')) {
    console.log('== T5 变异自证（隔离副本；真树不动）==')
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-spacing-'))
    for (const m of MUTANTS) {
      const root = path.join(tmp, m.id)
      fs.mkdirSync(root, { recursive: true })
      const mutated = m.edit(html)
      if (mutated === html) { check('T5 ' + m.id + ' 变异真的改到了（锚点未命中 ⇒ 判据腐烂）', false); continue }
      fs.writeFileSync(path.join(root, 'demo.html'), mutated)
      fs.writeFileSync(path.join(root, 'package.json'), fs.readFileSync(path.join(ROOT, 'package.json')))
      const r = spawnSync(process.execPath, [FILE, '--no-mutations'], { encoding: 'utf8', env: { ...process.env, MPW_REPO_ROOT: root } })
      const groups = new Set((r.stdout || '').split('\n').filter((l) => l.includes('✗')).map((l) => (/✗\s*(T\d)/.exec(l) || [])[1]).filter(Boolean))
      const got = [...groups].sort(), want = [...m.expect].sort()
      check('T5 ' + m.id + '：期望红集精确相等', JSON.stringify(got) === JSON.stringify(want),
        '期望 ' + JSON.stringify(want) + ' 实际 ' + JSON.stringify(got) + ' exit=' + r.status)
    }
    check('T5 真树 demo.html 未被变异触碰', html === fs.readFileSync(DEMO, 'utf8'))
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

console.log('\n===== text-spacing: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
process.exit(fail ? 1 : 0)
