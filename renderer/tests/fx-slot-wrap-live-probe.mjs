#!/usr/bin/env node
/**
 * fx-slot-wrap-live-probe.mjs —— **真 GL** 取证：效果链输入槽（ti>=1）的 wrap 到底有没有落到 REPEAT
 *
 * 为什么要有它：`tests/tex-wrap-repeat-test.mjs` 的 G 组是用**假 GL** 直接驱动 `fxSlotWrap()`
 *   （证明函数语义 + 接线），但"真实渲染时效果 pass 真的走到这一步了吗"它证明不了。
 *   本探针在**真 WebGL2 上下文**里包一层 `activeTexture`/`bindTexture`/`texParameteri`，
 *   记录"哪个纹理槽、哪个轴、写成了什么"，然后挂一张**语料里真带 waterripple 的包**跑起来：
 *     · 默认档：应看到 **unit>=1 上有 REPEAT 写入**（= 规则真的在效果 pass 里生效）；
 *     · `?texwrap=clamp` 档：同样的包应看到 **unit>=1 一条 REPEAT 都没有**（= 回退开关真的能关掉它）。
 *   两档读数不同 ⇒ 这条契约在真机上可 A/B；两档读数相同 ⇒ 本探针会如实说"没量到差异"。
 *
 * 用法：
 *   node tests/fx-slot-wrap-live-probe.mjs                       # 默认语料（dd/3721991999，属性 waterripple=true）
 *   node tests/fx-slot-wrap-live-probe.mjs --pkg /abs/scene.pkg  # 换包
 *   node tests/fx-slot-wrap-live-probe.mjs --json
 *
 * 诚实边界：本机是桌面 Firefox + llvmpipe（软件渲染），不是用户的 Adreno 830；
 *   量的是"GL 调用/参数"这一层，**不是画面**（画面级 60 秒衰减对拍见 §报告，需真机/长跑）。
 *   环境不满足（无 playwright / 无 WebGL2 / :8902 不可达）⇒ SKIP + exit 2，绝不把"没测到"说成"通过"。
 */
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { launchGLBrowser, glCapability, glReading, closeQuiet, findPlaywright } from './_gl-browser.mjs'

const argv = process.argv.slice(2)
const argOf = (n, d) => { const i = argv.indexOf('--' + n); if (i >= 0 && argv[i + 1]) return argv[i + 1]; const eq = argv.find((a) => a.startsWith('--' + n + '=')); return eq ? eq.slice(n.length + 1) : d }
const JSON_ONLY = argv.includes('--json')
const AUTHORITY = argOf('authority', '127.0.0.1:8902')
const RES = argOf('res', 'dpr')
const WS_ROOT = path.resolve(import.meta.dirname, '..', '..')
const PKG = argOf('pkg', path.join(WS_ROOT, 'allwallpaper', 'dd', '3721991999', 'scene.pkg'))
const WAIT_MS = Number(argOf('wait-ms', '12000'))

const say = (...a) => { if (!JSON_ONLY) console.log(...a) }
const out = { authority: AUTHORITY, pkg: PKG, variants: [], ok: null, why: null }

const pwPath = findPlaywright()
if (!pwPath) { console.log('SKIP fx-slot-wrap-live-probe —— 找不到 playwright（可用 MPW_PLAYWRIGHT=<path> 指定）'); process.exit(2) }
const pw = createRequire(import.meta.url)(pwPath)
const firefox = (pw.default && pw.default.firefox) || pw.firefox
if (!firefox) { console.log('SKIP fx-slot-wrap-live-probe —— playwright 没有 firefox 导出'); process.exit(2) }

/* 页面脚本之前装记录器：把"槽位 → 纹理 → wrap 写入"留痕。
   ⚠ 只记录 `TEXTURE_2D` 且参数是 `WRAP_S`/`WRAP_T` 的写入；别的调用一律原样放行。 */
const INIT = () => {
  const P = { unit: 0, tex: null, rows: [], err: null }
  try {
    window.__mpwWrapProbe = P
    let seq = 0
    for (const proto of [window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype,
      window.WebGLRenderingContext && window.WebGLRenderingContext.prototype]) {
      if (!proto || proto.__mpwWrapProbe) continue
      proto.__mpwWrapProbe = true
      const oa = proto.activeTexture, ob = proto.bindTexture, ot = proto.texParameteri
      proto.activeTexture = function (u) { try { P.unit = Number(u) - Number(this.TEXTURE0) } catch (e) {} return oa.apply(this, arguments) }
      proto.bindTexture = function (t, x) { try { if (Number(t) === 3553) P.tex = x } catch (e) {} return ob.apply(this, arguments) }
      proto.texParameteri = function (t, p, v) {
        try {
          if (Number(t) === 3553 && (Number(p) === 10242 || Number(p) === 10243)) {
            const id = P.tex ? (P.tex.__mpwWrapId || (P.tex.__mpwWrapId = 'tex' + (++seq))) : '(无绑定)'
            P.rows.push({ unit: P.unit, axis: Number(p) === 10242 ? 'S' : 'T', id: id,
              v: Number(v) === 10497 ? 'REPEAT' : (Number(v) === 33071 ? 'CLAMP' : String(v)) })
          }
        } catch (e) { P.err = String((e && e.message) || e) }
        return ot.apply(this, arguments)
      }
    }
  } catch (e) { P.err = String((e && e.message) || e) }
}

const summary = (rows) => {
  const at = (f) => rows.filter(f)
  const slot1Repeat = at((r) => r.unit >= 1 && r.v === 'REPEAT')
  const slot0Repeat = at((r) => r.unit === 0 && r.v === 'REPEAT')
  const slot1Clamp = at((r) => r.unit >= 1 && r.v === 'CLAMP')
  const slot0Clamp = at((r) => r.unit === 0 && r.v === 'CLAMP')
  const units1 = [...new Set(slot1Repeat.map((r) => r.unit))].sort((a, b) => a - b)
  return { total: rows.length, slot1Repeat: slot1Repeat.length, slot0Repeat: slot0Repeat.length,
    slot1Clamp: slot1Clamp.length, slot0Clamp: slot0Clamp.length,
    slot1RepeatUnits: units1, slot1RepeatTextures: [...new Set(slot1Repeat.map((r) => r.id))].length }
}

const { browser, launchNote } = await launchGLBrowser(firefox)
try {
  const gl = await glCapability(browser)
  if (!gl.webgl2) {
    say('SKIP fx-slot-wrap-live-probe —— 本机没有 WebGL2（' + launchNote + '）；GL 调用类读数一律不可信')
    await closeQuiet(browser)
    process.exit(2)
  }
  say('   GL 前置: ' + glReading(launchNote, gl))
  for (const [label, extraQ] of [['默认档（P-194 规则生效）', ''], ['回退档 `?texwrap=clamp`', '&texwrap=clamp']]) {
    const ctx = await browser.newContext({ viewport: { width: 640, height: 480 } })
    const page = await ctx.newPage()
    const errs = []
    page.on('pageerror', (e) => { if (errs.length < 4) errs.push(String((e && e.message) || e).slice(0, 200)) })
    await page.addInitScript(INIT)
    const url = 'http://' + AUTHORITY + '/webloader/?type=scene&id=' + encodeURIComponent(path.basename(PKG).replace(/\.[^.]+$/, ''))
      + '&pkgpath=' + encodeURIComponent(PKG) + '&res=' + encodeURIComponent(RES) + '&shell=0' + extraQ
    const rec = { label, url, rows: 0, errs, summary: null, canvas: null }
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.waitForTimeout(WAIT_MS)
      /* 渲染可能发生在顶层页或某个子帧（`?shell=0` 两种历史形态都见过）⇒ 逐帧找"装了记录器且真的有读数"的那一个 */
      let best = null
      for (const fr of page.frames()) {
        try {
          const r = await fr.evaluate(() => {
            const P = window.__mpwWrapProbe
            if (!P) return null
            const c = document.querySelector('canvas')
            return { rows: P.rows, err: P.err, canvas: c ? { w: c.width, h: c.height } : null }
          })
          if (!r) continue
          if (!best || (r.rows || []).length > (best.rows || []).length) best = { rows: r.rows || [], err: r.err, canvas: r.canvas, href: fr.url() }
        } catch (e) { /* 跨源/正在导航：跳过这一帧 */ }
      }
      rec.rows = best ? best.rows.length : 0
      rec.canvas = best ? best.canvas : null
      rec.found = !!best
      rec.href = best ? String(best.href).slice(0, 90) : null
      rec.summary = summary(best ? best.rows : [])
      say('\n── ' + label)
      say('   URL: ' + url.slice(0, 150))
      say('   画布: ' + JSON.stringify(rec.canvas) + '   读数帧: ' + (rec.href || '(未找到)') + '   wrap 写入总条数: ' + rec.rows)
      say('   槽位读数: ' + JSON.stringify(rec.summary))
      if (errs.length) say('   页面错误(前 4): ' + JSON.stringify(errs))
    } catch (e) { rec.err = String((e && e.message) || e); say('   探针异常: ' + rec.err) }
    out.variants.push(rec)
    await ctx.close().catch(() => {})
  }
  const a = out.variants[0] && out.variants[0].summary
  const b = out.variants[1] && out.variants[1].summary
  if (a && b) {
    out.ok = a.slot1Repeat > 0 && b.slot1Repeat === 0
    out.why = out.ok
      ? '默认档在槽位>=1 上有 REPEAT 写入（' + a.slot1Repeat + ' 条，覆盖 ' + a.slot1RepeatUnits.length + ' 个槽 / ' + a.slot1RepeatTextures + ' 个纹理对象），回退档一条都没有 ⇒ 规则生效且可关'
      : '两档没有形成预期差异（默认=' + a.slot1Repeat + ' 条、回退=' + b.slot1Repeat + ' 条）⇒ 本探针如实判"没量到"，别当成通过'
    say('\n判决: ' + out.why)
  } else {
    out.why = '至少一档没读到 wrap 写入（渲染未发生 / 该包没走到效果 pass）'
    say('\n判决: ' + out.why)
  }
} finally {
  await closeQuiet(browser).catch(() => {})
}
if (JSON_ONLY) console.log(JSON.stringify(out, null, 1))
process.exit(out.ok === true ? 0 : (out.ok === false ? 1 : 2))
