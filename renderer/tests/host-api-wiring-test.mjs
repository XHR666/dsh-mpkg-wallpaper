#!/usr/bin/env node
/**
 * host-api-wiring-test.mjs —— 宿主 API「未接线」清零的**会变红的判据**
 *
 * 用户原话（2026-09-25）：「宿主 API `updateWebProps`：⚠ 网页壁纸属性推送未接线（本仓渲染器的 web 档走宿主
 *   注入面）⇒ 本次调用被忽略 —— 你这怎么还有没接线的东西？**你把所有没接线的东西都接上**，你这搞得我都不好测试了」。
 *
 * 本判据钉三件事（都**不靠浏览器**）：
 *   A 源码口径：`updateWebProps`/`setSceneFps`/`pushWheel` 三条宿主 API **真的接到实现**，且"未接线"这种
 *     含糊文案不再出现在这三条的桩里（其它确实不支持的 API 必须写清"不支持 + 替代"，见 D2）。
 *   B 行为：从 `demo.html` 切出 `mpwSceneFps*` 真源码跑真行为（legacy 恒不跳 / 30fps 的跳帧窗口 /
 *     只降不升 / 上限钳制 / 非法值不生效 / 提交帧率记账）。
 *   C 接线位置：帧循环里"跳帧"必须在 fps 计数**之前**返回、"提交记账"必须在渲染结束之后；
 *     web 帧的帧盒换算必须走 `mpwWebFramePoint()`（模块档量不到 ⇒ 丢弃，不投 NaN）。
 *   E 变异自证：把 `setSceneFps` 改回桩 ⇒ A 组必红。
 *
 * 跑法：`node tests/host-api-wiring-test.mjs [--no-mutant]`
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..')
/* 变异自证要驱动**副本**：`MPW_WIRING_DEMO` 指向副本时，本脚本的全部读数都来自它（真树不受影响）。 */
const DEMO = process.env.MPW_WIRING_DEMO || path.join(ROOT, 'demo.html')
const NO_MUT = process.argv.includes('--no-mutant')
const HTML = fs.readFileSync(DEMO, 'utf8')

let pass = 0, fail = 0
const ok = (c, name, extra = '') => {
  if (c) { pass++; console.log('  ✓ ' + name + (extra ? '  [' + String(extra).slice(0, 200) + ']' : '')) }
  else { fail++; console.error('  ✗ ' + name + (extra ? '  [' + String(extra).slice(0, 300) + ']' : '')) }
}

/* ── A 源码口径：三条 API 真接线 ── */
console.log('== A 宿主 API 真接线（桩 → 实现）==')
{
  const mUpdate = /put\('updateWebProps',\s*\(v\)\s*=>\s*\{([\s\S]{0,600}?)\n\s*\}\)/ .exec(HTML)
  ok(!!mUpdate && /mpwWebApplyProps\(v\)/.test(mUpdate[1]), 'A1 `updateWebProps` 调用真实现 `mpwWebApplyProps(v)`（不再是"被忽略"的桩）')
  ok(!!mUpdate && /return\s+!!r\.ok/.test(mUpdate[1]), 'A2 `updateWebProps` **如实返回**送达结果（不是恒 false）', mUpdate ? '' : '锚点没匹配上')
  const mFps = /put\('setSceneFps',\s*\(v\)\s*=>\s*\{([\s\S]{0,600}?)\n\s*\}\)/.exec(HTML)
  ok(!!mFps && /mpwSceneFpsConfigure\(v,\s*'host'\)/.test(mFps[1]), 'A3 `setSceneFps` 调用真实现 `mpwSceneFpsConfigure(v,\'host\')`')
  ok(!!mFps && /return\s+!!r\.ok/.test(mFps[1]), 'A4 `setSceneFps` 如实返回（`legacy/off/0/vsync` 也算"生效到 legacy 档"）')
  const mWheel = /put\('pushWheel',\s*\(([^)]*)\)\s*=>\s*\{([\s\S]{0,900}?)\n\s*\}, false\)/.exec(HTML)
  ok(!!mWheel && /mpwWebControlSend\('wheel'/.test(mWheel[2]), 'A5 `pushWheel` 在 web 档走 `mpwWebControlSend(\'wheel\')`（帧内 shim 支持 `op:\'wheel\'`）')
  ok(!!mWheel && /不支持/.test(mWheel[2]), 'A6 `pushWheel` 在场景档写明"**不支持** + 注入面只有位置/按键"（不再含糊）')
  /* ⚠ 只查 `note('<api>', '…')` 的**桩文案**：历史注释里引用用户原话（"那句『…未接线』"）不算桩，
     所以断言按 `note(` 形参位置定位，而不是全文 grep（否则会把注释误判成桩）。 */
  const noteStub = (api) => new RegExp("note\\('" + api + "',\\s*'[^']*未接线").test(HTML)
  ok(!noteStub('updateWebProps'), 'A7 `updateWebProps` 的**桩文案**已消失（`note(\'updateWebProps\', …未接线…)` 零命中）')
  ok(!noteStub('setSceneFps'), 'A8 `setSceneFps` 的**桩文案**已消失（同上口径）')
}

/* ── B 行为：切片跑 mpwSceneFps* 真源码 ── */
console.log('\n== B `mpwSceneFps*` 真行为（源码切片，不靠浏览器）==')
let api = null
{
  const START = 'const MPW_FPS_TOLERANCE'
  const END = '/* `?fps=` 的唯一权威解析点'
  const i = HTML.indexOf(START), j = HTML.indexOf(END)
  ok(i > 0 && j > i, 'B0 切片锚点命中（`MPW_FPS_TOLERANCE` → `?fps=` 解析点之前）', `i=${i} j=${j}`)
  if (i > 0 && j > i) {
    const block = HTML.slice(i, j)
    ok(/function mpwSceneFpsConfigure/.test(block) && /function mpwSceneFpsSubmit/.test(block),
      'B0b 切片里含 Configure/ShouldSkip/Submit 三个函数（demo.html 结构变了就红）')
    api = new Function('return (function(){' + block + '\nreturn { mpwSceneFpsConfigure, mpwSceneFpsShouldSkip, mpwSceneFpsSubmit, mpwSceneFps } })()')()
  }
  if (!api) { ok(false, 'B0c 切片可执行'); }
  else {
    const S = api.mpwSceneFps
    for (const v of ['', 'legacy', 'off', '0', 'false', 'vsync', 'native']) {
      const r = api.mpwSceneFpsConfigure(v, 'test')
      if (!(r.ok && r.mode === 'legacy')) ok(false, 'B1 取值 `' + v + '` ⇒ legacy 档（每 rAF 一帧 = 改动前）', JSON.stringify(r))
    }
    ok(S.mode === 'legacy' && S.intervalMs === 0 && api.mpwSceneFpsShouldSkip(12345) === false,
      'B1 七种 legacy 取值全部落在 legacy 档，且 legacy 下**恒不跳帧**（含"还没出过帧"这一路）')
    const r30 = api.mpwSceneFpsConfigure('30', 'test')
    ok(r30.ok && r30.mode === 'throttle' && Math.abs(r30.intervalMs - 1000 / 30) < 1e-9, 'B2 `30` ⇒ 抽稀档，intervalMs = 33.33', JSON.stringify(r30))
    api.mpwSceneFpsSubmit(1000)                       // 第一帧提交：建立 lastSubmitAt
    const skip1 = api.mpwSceneFpsShouldSkip(1010)     // 10ms 后 ⇒ 该跳（< 33.33*0.85 = 28.3ms）
    const skip2 = api.mpwSceneFpsShouldSkip(1040)     // 40ms 后 ⇒ 该出
    ok(skip1 === true && skip2 === false, 'B3 跳帧窗口：10ms ⇒ 跳、40ms ⇒ 出（容差 ×0.85，90Hz 屏上仍落在 ~33ms）', `skip(10ms)=${skip1} skip(40ms)=${skip2}`)
    ok(S.skipped >= 1, 'B4 跳帧有计数（`__mpwSceneFps.skipped` 可机读）', 'skipped=' + S.skipped)
    const rBig = api.mpwSceneFpsConfigure('1000', 'test')
    ok(rBig.ok && rBig.want === 240 && rBig.clamped === true, 'B5 只降不升 + 上限钳制：`1000` ⇒ want=240 且如实标 clamped', JSON.stringify(rBig))
    const before = S.mode
    const rBad = api.mpwSceneFpsConfigure('abc', 'test')
    ok(rBad.ok === false && S.mode === before, 'B6 非法值 ⇒ `ok:false` 且**不改**当前档（不静默改行为）', JSON.stringify(rBad))
    api.mpwSceneFpsConfigure('60', 'test')
    const t0 = 2000
    for (let k = 0; k <= 60; k++) api.mpwSceneFpsSubmit(t0 + k * (1000 / 60))
    ok(S.effective >= 55 && S.effective <= 65, 'B7 提交帧率记账：60 帧均匀喂 1s ⇒ `effective` ≈ 60（1s 滚动窗）', 'effective=' + S.effective + ' submitted=' + S.submitted)
  }
}

/* ── C 接线位置：帧循环 + 帧几何 ── */
console.log('\n== C 接线位置（帧循环 / web 帧盒）==')
{
  const iSkip = HTML.indexOf('if (mpwSceneFpsShouldSkip(now)) {')
  const iCount = HTML.indexOf('frames++; ft += (now - last); last = now;')
  ok(iSkip > 0 && iCount > 0 && iSkip < iCount, 'C1 跳帧判断在 **fps 计数之前**（跳过的帧不进 fps 显示）', `skip@${iSkip} count@${iCount}`)
  const iSkipRet = HTML.indexOf('return', iSkip)
  ok(iSkipRet > iSkip && iSkipRet - iSkip < 400, 'C2 跳帧分支就地返回（不把这一帧画完）')
  /* ⚠ 必须从 `MPW_BASELINE.onFrame` 之后**再找**调用点：`function mpwSceneFpsSubmit(now)` 的定义本身
     也含 `mpwSceneFpsSubmit(now)` 这串字符（旧写法 indexOf 会命中定义 ⇒ 假红）。 */
  const iBase = HTML.indexOf('MPW_BASELINE.onFrame(now')
  const iSubmit = iBase > 0 ? HTML.indexOf('mpwSceneFpsSubmit(now)', iBase) : -1
  ok(iSubmit > iBase && iBase > 0 && iSubmit - iBase < 400, 'C3 提交记账在渲染结束之后（与 `MPW_BASELINE.onFrame` 同一段帧尾）', `submit@${iSubmit} baseline@${iBase}`)
  const iToFrame = HTML.indexOf('const toFrame = (ev) => {')
  const iPoint = HTML.indexOf('mpwWebFramePoint(ev.clientX, ev.clientY)')
  ok(iToFrame > 0 && iPoint > iToFrame && iPoint - iToFrame < 300, 'C4 web 帧盒换算走 `mpwWebFramePoint()`（唯一实现）')
  ok(/if \(!p\) return/.test(HTML.slice(iToFrame, iToFrame + 900)), 'C5 量不到帧盒 ⇒ **丢弃这次注入**（不把 NaN 投给帧）')
  const iFwd = HTML.indexOf('const fwd = (op, ev, extra) => {')
  ok(iFwd > 0 && /if \(!p\) return/.test(HTML.slice(iFwd, iFwd + 400)), 'C6 `fwd()` 在 `toFrame` 返回 null 时不发送')
  ok(/let webGeomDropped = 0/.test(HTML) && /webGeomDropped\+\+/.test(HTML), 'C7 丢弃有计数（`webGeomDropped`）')
  ok(/frameGeomModeFromQuery/.test(HTML) && /MPW_WEB_FRAME_RAW/.test(HTML), 'C8 `?frame=` 由模块 `frameGeomModeFromQuery` 归一（页面显式读一次原始值，供 diag-flag-check 双向核对）')
}

/* ── D 其它宿主 API：不支持必须写清"原因 + 替代" ── */
console.log('\n== D 其余宿主 API 的"如实降级"口径 ==')
{
  const stubs = Array.from(HTML.matchAll(/put\('([A-Za-z]+)',\s*\([^)]*\)\s*=>\s*\{\s*note\('([A-Za-z]+)',\s*'([^']*)'/g))
  /* ①(P-261 2026-10-07) 基线跟随：`loadSceneFile` 从"明确降级"变成**真实现**（IndexedDB 交接 +
     `?scenefile=1` 重载）⇒ 降级项 4 → **3**（`setFit` / `restore` / `setWallpaper`）。
     这条判据的本意是"降级项必须可枚举、且**随着能力落地而变少**"⇒ 门限跟着降，
     真正的不变量是 D2（不许用"未接线"这种含糊词）与 D3（每条都要写清原因或替代）。 */
  ok(stubs.length >= 3, 'D1 宿主 API 表里带 `note(...)` 的降级项 ≥ 3 条（可枚举；P-261 后 `loadSceneFile` 已转真能力）', 'n=' + stubs.length)
  const bad = stubs.filter((m) => /未接线/.test(m[3]))
  ok(bad.length === 0, 'D2 **没有任何一条**还用「未接线」这种含糊词（要么接上，要么写清不支持的原因）', bad.map((m) => m[1]).join(',') || '（无）')
  const withWhy = stubs.filter((m) => /没有|不支持|请用|需要|只能|不接/.test(m[3]))
  ok(withWhy.length === stubs.length, 'D3 每条降级都写了**原因或替代**（人话可判断）', withWhy.length + '/' + stubs.length)
  /* ⚠ 光有 `mpwWebControlSend` 不够：送达路由要知道**当前这一帧**（`webFrameEl`）与同源位，
     否则 web 档也会掉进"场景档"分支 —— 这正是上一轮接线半途而废的形态。 */
  ok(/webFrameEl = fr/.test(HTML) && /webFrameSameOrigin = \(plan\.mode === 'compat'\)/.test(HTML),
    'D4 挂 web 帧时登记 `webFrameEl`/`webFrameMode`/`webFrameSameOrigin`（送达路由知道目的地）')
  const shim = fs.readFileSync(path.join(ROOT, 'core', 'we-web-shim.mjs'), 'utf8')
  ok(/case 'props':/.test(shim) && /post\('props-applied'/.test(shim),
    'D5 帧内 shim 应用 props 后**回报** `props-applied`（两端证据：推送侧 + 帧内回执）')
  ok(/d\.op === 'props-applied'/.test(HTML) && /webPropsApplied = \{/.test(HTML),
    'D6 宿主侧真的把回执记进 `__mpwWebFrame.propsApplied`（判据可机读）')
}

/* ── F core/*.mjs 语法闸（2026-09-25 实测踩到的坑） ── */
console.log('\n== F `core/**` 每个模块都要能解析（模板字符串里的反引号会截断整份文件）==')
{
  /* 背景：`core/we-web-shim.mjs` 整体是**模板字符串**（注入帧里的脚本正文），注释里一个反引号就会
     就地截断 ⇒ 整份 shim 语法错误、页面直接"渲染器 module 未启动"。当时 `demo-syntax-check` 只扫
     `demo.html` 的内联脚本、门禁里没有一条覆盖 `core/*.mjs` ⇒ 没人拦住。这里补上。 */
  const bad = []
  for (const f of fs.readdirSync(path.join(ROOT, 'core'))) {
    if (!/\.(mjs|js)$/.test(f)) continue
    const r = spawnSync(process.execPath, ['--check', path.join(ROOT, 'core', f)], { encoding: 'utf8' })
    if (r.status !== 0) bad.push(f + ': ' + String((r.stderr || '').split('\n')[1] || r.status).slice(0, 80))
  }
  ok(bad.length === 0, 'F1 `node --check` 覆盖 core/ 下全部 .mjs/.js（模板字符串类语法错误当场红）', bad.join(' | ') || '全部可解析')
}

/* ── E 变异自证 ── */
if (!NO_MUT) {
  console.log('\n== E 变异自证（副本，真树不动）==')
  const { createHash } = await import('node:crypto')
  const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex')
  const before = sha(DEMO)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-wiring-'))
  /* 变异：把 `setSceneFps` 的真实现换回桩（"未接线"文案 + 恒 false）⇒ A3/A4/A8 必红 */
  const m = /put\('setSceneFps',\s*\(v\)\s*=>\s*\{[\s\S]{0,600}?\n(\s*)\}\)/.exec(HTML)
  let mutated = null
  if (m) {
    const stub = "put('setSceneFps', (v) => { note('setSceneFps', '⚠ 运行期改帧率未接线 ⇒ 本次调用被忽略'); return false }, false)"
    mutated = HTML.slice(0, m.index) + stub + HTML.slice(m.index + m[0].length)
  }
  ok(!!mutated, 'E0 变异注入锚点命中（`setSceneFps` 实现块）')
  if (mutated) {
    const copy = path.join(tmp, 'demo.html')
    fs.writeFileSync(copy, mutated)
    /* 判据脚本对 demo.html 的路径是写死的（ROOT/demo.html）⇒ 用 MPW_WIRING_DEMO 覆盖：
       本脚本读 `MPW_WIRING_DEMO`（没有就用 ROOT/demo.html），这样变异副本能真正驱动它。 */
    const r = spawnSync(process.execPath, [process.argv[1], '--no-mutant'], {
      encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, MPW_WIRING_DEMO: copy },
    })
    const out = (r.stdout || '') + (r.stderr || '')
    const redA = /✗ A[3-8]/.test(out)
    ok(redA, 'E1 把 `setSceneFps` 换回桩 ⇒ A 组必须变红（判据有分辨力）', `exit=${r.status} 命中A=${redA}`)
  }
  fs.rmSync(tmp, { recursive: true, force: true })
  ok(sha(DEMO) === before, 'E2 真树 sha256 跑前跑后逐字相同（变异没碰真文件）', sha(DEMO).slice(0, 16) + '…')
}

console.log(`\n────\nhost-api-wiring-test：${pass} 通过 / ${fail} 失败`)
if (fail) { console.error('✗ 宿主 API 接线未通过'); process.exit(1) }
console.log('✓ 宿主 API 接线通过：updateWebProps/setSceneFps/pushWheel 真送达 + 帧率抽稀真行为 + 帧几何接线 + 如实降级口径 + 变异自证')
