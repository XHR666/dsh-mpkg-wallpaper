// weassist-prefetch-probe.mjs —— P-206 **真机读数**：`demo.html` 的效果链 `/weassist` 预取 + 同步 reader 注册
//
// 目的（离线判据 `tests/weassist-prefetch-test.mjs` 已钉"预取清单构造 + reader 注册 + legacy 档不注册 + miss 返回 null"；
//   本文件钉"页面里真的这么跑"）：
//   ① 3 个 `PKGM0014` 真包之一（默认 `陈千语_03`，61MB；可 `--pkg` 换）：页面 `__mpwFxResolve` 的
//      **实例/挂上/pass/链摘要**必须与**本进程离线算的**同一组数逐字相同（P-205 报告里的 22/37/25 量级）；
//      `__mpwFxMiss.eff` 必须等于离线台账数（缺的只该是工坊私有效果），且日志里不再只出现"静默"。
//   ② 同一个包加 `?weassist=legacy`（回退口）：**不预取、不注册** ⇒ 挂上 = 0（= 改动前的浏览器读数）。
//      ⚠ ⑥/⑦ 这条对照建立在"该包的效果在包外"上 ⇒ `--pkg` 必须是 PKGM0014 那一类包；把**自足包**当主包跑
//      （只用来做页面冒烟）会让 ⑥/⑦ 如实变红，那不是产品问题（实测踩到过）。
//   ③ `wallpaperE/**` 里一个**包内自带效果**的包（默认 `other/红鸾樱落.mpkg`，9.8MB）：改前/改后链摘要**逐字一致**，
//      且缺省档**一个 `/weassist` 请求都不发**（自足包走"包内优先"快路径）—— 与离线冻结值同数。
//
// 口径：GL 能力前置（`tests/_gl-browser.mjs`：有头优先 + 无 WebGL2 ⇒ SKIP）；同一时刻只挂一个包（内存纪律：
//   可用内存 < 1.4GB 立即停）；URL = `:8902/webloader/?type=scene&id=<id>&pkgpath=<abs>&res=dpr&shell=0`。
// 用法（浏览器类测试一律加锁）：
//   flock /tmp/.mpw-firefox.lock -c 'node tests/weassist-prefetch-probe.mjs'
//   flock /tmp/.mpw-firefox.lock -c 'node tests/weassist-prefetch-probe.mjs --pkg /abs/x.mpkg --skip-selfcontained'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'
import { openPkgLazy, readSceneJsonText } from './_pkg-index.mjs'
import { DEFAULT_ASSETS } from './gen-particle-index.mjs'
import { launchGLBrowser, glCapability, glReading, logGLSkip, glSkipWhy, closeQuiet, findPlaywright } from './_gl-browser.mjs'

const argv = process.argv.slice(2)
const argVal = (k) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : null }
const AUTHORITY = argVal('--authority') || process.env.MPW_PROBE_AUTHORITY || '127.0.0.1:8902'
const RES = argVal('--res') || 'dpr'
const PKG = argVal('--pkg') || path.join(WS, 'allwallpaper/wallpaperE/陈千语/陈千语_03.mpkg')
const PKG_SELF = argVal('--pkg-self') || path.join(WS, 'allwallpaper/wallpaperE/other/红鸾樱落.mpkg')
const SKIP_SELF = argv.includes('--skip-selfcontained')
const OUT = argVal('--out') || path.join(os.tmpdir(), 'mpw-weassist-prefetch-probe.json')   // ⚠ 默认落**临时目录**：读数含本机绝对路径（仓库既有口径：探针落盘读数不入库；要留在仓库请显式 `--out tests/…` 并自行登记 .gitignore）
const MIN_FREE_MB = Number(process.env.MPW_MIN_FREE_MB || 1400)

let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}
const exists = (p) => { try { return fs.existsSync(p) } catch { return false } }

/* ───────────────── 离线基准（与本进程同一份 core；口径 = demo.html 的 loadScene 循环） ───────────────── */
const lib = await import(pathToFileURL(path.join(ROOT, 'core', 'we-scene-bundle.js')).href)
const DEC = new TextDecoder()
const diskWeReader = (rel) => {
  try {
    const p = path.join(DEFAULT_ASSETS, String(rel).replace(/^\/+/, ''))
    return (p.startsWith(DEFAULT_ASSETS) && exists(p)) ? fs.readFileSync(p) : null
  } catch { return null }
}
function chainDigest(rows) {
  let h = 0x811c9dc5
  const s = rows.join('\n')
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0')
}
const chainRow = (ef) => {
  const mps = ef.materialPasses || []
  return JSON.stringify({ f: String((ef && ef.file) || ''), fbos: ef.fbos || null,
    mp: mps.map((m) => ({ s: m.shader, b: m.blending, t: m.target, binds: m.binds, tx: m.textures, c: m.combos, k: m.constants })) })
}
/** 离线基准：同一份 core + 磁盘同语义 reader（= `/weassist` 路由等价物），循环顺序与 demo.html::loadScene 一致。 */
function offlineBaseline(pkgFile, withReader) {
  lib.setWeAssetReader(null)
  lib.resetEffectAssetLedger()          // 台账是**模块级累计**的：每次离线基准前清零，否则多包连跑会累加（实测踩到 78=28+50）
  if (withReader) lib.setWeAssetReader(diskWeReader)
  const pkg = openPkgLazy(pkgFile)
  const scene = lib.parseScene(lib.parseWeJson(readSceneJsonText(pkgFile)), null,
    { attachCtx: { readEntry: (n) => lib.getEntry(pkg, n), time: 0 } })
  const st = { instances: 0, attached: 0, passes: 0, realShaders: 0, sources: {}, matSources: {}, rows: [], missingEffectFiles: 0 }
  for (const l of scene.layers) for (const ef of (l.effects || [])) {
    const r = lib.resolveEffectChain(pkg, ef, (b) => DEC.decode(b))
    st.instances++
    const mps = ef.materialPasses || []
    if (mps.length) { st.attached++; st.passes += mps.length }
    const src = (r && r.source) || 'miss'
    st.sources[src] = (st.sources[src] || 0) + 1
    if (src === 'miss') st.missingEffectFiles++
    for (const mp of mps) {
      const ms = mp.__matSource || 'none'
      st.matSources[ms] = (st.matSources[ms] || 0) + 1
      if (mp.shader) st.realShaders++
    }
    st.rows.push(chainRow(ef))
  }
  st.digest = chainDigest(st.rows)
  st.ledgerEff = lib.effectAssetLedger().eff
  lib.setWeAssetReader(null)
  return st
}

/* ───────────────── 页面读数 ───────────────── */
const READ = function () {
  const out = { ok: false, why: null }
  try {
    const log = (function () { try { const el = document.getElementById('log'); return el ? String(el.textContent || '') : '' } catch (e) { return '' } })()
    const rs = (window.__mpwFxResolve && window.__mpwFxResolve.length) ? window.__mpwFxResolve[window.__mpwFxResolve.length - 1] : null
    out.firstFrame = !!window.__mpwFirstFrame
    out.prefetch = window.__mpwFxPrefetch || null
    out.resolve = rs ? { id: rs.id, instances: rs.instances, attached: rs.attached, passes: rs.passes, realShaders: rs.realShaders,
      sources: rs.sources, matSources: rs.matSources, digest: rs.digest, at: rs.at } : null
    const miss = window.__mpwFxMiss || null
    out.fxMiss = miss ? { eff: miss.eff, mat: miss.mat, shader: miss.shader, files: Object.keys(miss.byFile || {}), last: (miss.last || []).length } : null
    out.logLines = (log.match(/① P-206[^\n]*|⚠ P-205 效果链缺[^\n]*/g) || []).slice(0, 8)
    out.logMissEffect = (log.match(/P-205 效果链缺 effect\.json/g) || []).length
    out.logMissShader = (log.match(/P-205 效果链缺 shader 源/g) || []).length
    out.logResolve = (log.match(/① P-206 效果链解析[^\n]*/g) || []).slice(-1)[0] || null
    out.logPrefetch = (log.match(/① P-206 效果资产预取[^\n]*/g) || []).slice(-1)[0] || null
    out.logError = (log.match(/⚠ P-206[^\n]*|❌ 页面错误[^\n]*|❌ 未处理Promise[^\n]*/g) || []).slice(0, 4)
    out.errLog = log.length
    out.ok = true
  } catch (e) { out.why = String((e && e.message) || e) }
  return out
}
const freeMB = () => { try { return Math.round(os.freemem() / 1048576) } catch { return -1 } }

const pwPath = findPlaywright()
if (!pwPath) { console.log('SKIP weassist-prefetch-probe —— 找不到 playwright'); process.exit(0) }
const pw = createRequire(import.meta.url)(pwPath)
const firefox = (pw.default && pw.default.firefox) || pw.firefox
if (!firefox) { console.log('SKIP weassist-prefetch-probe —— playwright 没有 firefox 导出'); process.exit(0) }

const results = []
const { browser, launchNote } = await launchGLBrowser(firefox)
try {
  const gl = await glCapability(browser)
  if (!gl.webgl2) { logGLSkip('weassist-prefetch-probe', launchNote, gl); glSkipWhy(); await closeQuiet(browser); process.exit(0) }
  console.log('== P-206 真机读数：效果链 /weassist 预取 + 同步 reader 注册 ==')
  console.log('   authority=' + AUTHORITY + '  res=' + RES + '  GL=' + glReading(launchNote, gl))

  /** 挂一个包跑一次（**同一时刻只有一个 context/page**；跑完立刻关，守住内存纪律）。 */
  async function runOne(label, pkgFile, legacy) {
    const free0 = freeMB()
    if (free0 >= 0 && free0 < MIN_FREE_MB) {
      console.log('  ⚠ 可用内存 ' + free0 + 'MB < ' + MIN_FREE_MB + 'MB ⇒ **立即停**（内存纪律），不挂 ' + label)
      return { label, aborted: true, freeMB: free0 }
    }
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    const pageErrors = []
    page.on('pageerror', (e) => pageErrors.push(String((e && e.message) || e).slice(0, 200)))
    const id = path.basename(pkgFile).replace(/\.[^.]+$/, '')
    const url = 'http://' + AUTHORITY + '/webloader/?type=scene&id=' + encodeURIComponent(id)
      + '&pkgpath=' + encodeURIComponent(pkgFile) + '&res=' + RES + '&shell=0'
      + (legacy ? '&weassist=legacy' : '') + '&_t=' + Date.now()
    let st = null
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 })
      const t0 = Date.now()
      for (;;) {
        await page.waitForTimeout(1500)
        st = await page.evaluate(READ)
        // 判据需要的两件事都到齐就停：效果链解析台账 + 首帧（或超时）
        if (st && st.ok && st.resolve && st.firstFrame) break
        if (st && st.ok && st.resolve && Date.now() - t0 > 90000) break
        if (Date.now() - t0 > 150000) break
      }
    } catch (e) { pageErrors.push('探针级异常: ' + String((e && e.message) || e).slice(0, 200)) }
    const free1 = freeMB()
    await ctx.close().catch(() => {})
    const rec = { label, pkg: pkgFile, legacy: !!legacy, url, state: st, pageErrors, freeMB: { before: free0, after: free1 } }
    console.log('\n── ' + label + (legacy ? '（?weassist=legacy）' : '') + '  ' + path.basename(pkgFile))
    console.log('   prefetch: ' + JSON.stringify(st && st.prefetch ? { legacy: st.prefetch.legacy, effects: st.prefetch.effects, materials: st.prefetch.materials,
      shaders: st.prefetch.shaders, requests: st.prefetch.requests, hits: st.prefetch.hits, inPkg: st.prefetch.inPkg, miss: st.prefetch.miss,
      mapSize: st.prefetch.mapSize, bytes: st.prefetch.bytes, truncated: st.prefetch.truncated, registered: st.prefetch.registered, ms: st.prefetch.ms } : null))
    console.log('   resolve : ' + JSON.stringify(st && st.resolve))
    console.log('   fxMiss  : ' + JSON.stringify(st && st.fxMiss ? { eff: st.fxMiss.eff, mat: st.fxMiss.mat, shader: st.fxMiss.shader, files: st.fxMiss.files.length } : null)
      + '  日志缺件行 effect=' + (st && st.logMissEffect) + ' shader=' + (st && st.logMissShader))
    console.log('   日志    : ' + JSON.stringify([(st && st.logPrefetch || '').slice(0, 150), (st && st.logResolve || '').slice(0, 150)]))
    if (st && st.logError && st.logError.length) console.log('   ⚠ 日志异常行: ' + JSON.stringify(st.logError))
    if (pageErrors.length) console.log('   pageerror: ' + JSON.stringify(pageErrors.slice(0, 2)))
    console.log('   内存    : before=' + free0 + 'MB after=' + free1 + 'MB')
    return rec
  }

  /* ① 主包：缺省档（预取 + 注册） */
  const offlineDef = exists(PKG) ? offlineBaseline(PKG, true) : null
  const offlineLeg = exists(PKG) ? offlineBaseline(PKG, false) : null
  if (!offlineDef) {
    check('① 主包存在', false, '语料缺失: ' + PKG)
  } else {
    console.log('   离线基准（磁盘同语义 reader）：' + JSON.stringify({ instances: offlineDef.instances, attached: offlineDef.attached, passes: offlineDef.passes,
      digest: offlineDef.digest, ledgerEff: offlineDef.ledgerEff, missingEffectFiles: offlineDef.missingEffectFiles, sources: offlineDef.sources, matSources: offlineDef.matSources }))
    const a = await runOne('default', PKG, false)
    results.push(a)
    const ra = (a.state && a.state.resolve) || null, pa = (a.state && a.state.prefetch) || null
    check('① 缺省档：页面效果链读数 == 离线读数（实例 ' + offlineDef.instances + ' · 挂上 ' + offlineDef.attached + ' · pass ' + offlineDef.passes + ' · 链摘要 ' + offlineDef.digest + '）',
      !!ra && ra.instances === offlineDef.instances && ra.attached === offlineDef.attached && ra.passes === offlineDef.passes && ra.digest === offlineDef.digest,
      ra ? JSON.stringify({ instances: ra.instances, attached: ra.attached, passes: ra.passes, digest: ra.digest, realShaders: ra.realShaders }) : '无 __mpwFxResolve')
    check('② 缺省档：预取**真的注册了** reader 且发出过请求（requests>0 / registered=true / 命中>0）',
      !!pa && pa.legacy === false && pa.registered === true && pa.requests > 0 && pa.hits > 0 && pa.truncated === false,
      pa ? JSON.stringify({ requests: pa.requests, hits: pa.hits, mapSize: pa.mapSize, registered: pa.registered, truncated: pa.truncated }) : '无 __mpwFxPrefetch')
    check('③ 缺省档：material 全部来自效果自带子树（`weassist-effect-subtree`），且没有 P-206 异常行',
      !!ra && (ra.matSources['weassist-effect-subtree'] || 0) === offlineDef.passes && runtimeOk(a),
      ra ? JSON.stringify(ra.matSources) + ' pageErrors=' + a.pageErrors.length : '无读数')
    check('④ 缺省档：`__mpwFxMiss.eff` == 离线台账（' + offlineDef.ledgerEff + '；只该剩工坊私有效果）'
      + (offlineDef.ledgerEff === 0 ? '，且日志里 0 行"缺 effect.json"（0 缺件 ⇒ 台账对象压根不发布，这本身就是"没有这些效果"）' : '，且日志里仍有缺件行（不再静默）'),
      !!a.state && (offlineDef.ledgerEff === 0
        ? (!a.state.fxMiss || a.state.fxMiss.eff === 0)
        : (!!a.state.fxMiss && a.state.fxMiss.eff === offlineDef.ledgerEff))
      && (offlineDef.ledgerEff > 0 ? a.state.logMissEffect > 0 : a.state.logMissEffect === 0),
      a.state ? ('eff=' + (a.state.fxMiss ? a.state.fxMiss.eff : 'null') + '/' + offlineDef.ledgerEff
        + ' 日志缺件行=' + a.state.logMissEffect + ' byFile=' + (a.state.fxMiss ? a.state.fxMiss.files.length : 0)) : '无 __mpwFxMiss')
    /* ② legacy 档：同一个包 */
    const b = await runOne('legacy', PKG, true)
    results.push(b)
    const rb = (b.state && b.state.resolve) || null, pb = (b.state && b.state.prefetch) || null
    check('⑤ legacy 档：**不预取、不注册**（requests=0 / registered=false / legacy=true）',
      !!pb && pb.legacy === true && pb.requests === 0 && pb.registered === false,
      pb ? JSON.stringify({ legacy: pb.legacy, requests: pb.requests, registered: pb.registered }) : '无 __mpwFxPrefetch')
    check('⑥ legacy 档：同一个包**挂上 = 0**（= 改动前的浏览器读数；离线对照 ' + offlineLeg.attached + '）',
      !!rb && rb.attached === 0 && rb.passes === 0 && offlineLeg.attached === 0,
      rb ? JSON.stringify({ instances: rb.instances, attached: rb.attached, passes: rb.passes, digest: rb.digest }) : '无 __mpwFxResolve')
    check('⑦ legacy 档：缺件**仍不静默**（日志里有 P-205 缺件行 + 台账在）',
      !!b.state && b.state.logMissEffect > 0 && !!b.state.fxMiss && b.state.fxMiss.eff === offlineLeg.ledgerEff,
      b.state ? ('日志缺件行=' + b.state.logMissEffect + ' 台账eff=' + (b.state.fxMiss ? b.state.fxMiss.eff : '?') + '/' + offlineLeg.ledgerEff) : '无读数')
  }

  /* ③ 自足包（包内自带效果）：改前/改后链摘要逐字一致 */
  if (!SKIP_SELF && exists(PKG_SELF)) {
    const offSelf = offlineBaseline(PKG_SELF, false)
    console.log('\n   离线基准（自足包 ' + path.basename(PKG_SELF) + '）：' + JSON.stringify({ instances: offSelf.instances, attached: offSelf.attached,
      passes: offSelf.passes, digest: offSelf.digest, missingEffectFiles: offSelf.missingEffectFiles }))
    const c = await runOne('self-default', PKG_SELF, false)
    const d = await runOne('self-legacy', PKG_SELF, true)
    results.push(c, d)
    const rc = (c.state && c.state.resolve) || null, rd = (d.state && d.state.resolve) || null
    const pc = (c.state && c.state.prefetch) || null
    check('⑧ 自足包：缺省档与 legacy 档**链摘要逐字一致**，且都 == 离线冻结值 ' + offSelf.digest,
      !!rc && !!rd && rc.digest === rd.digest && rc.digest === offSelf.digest && rd.digest === offSelf.digest,
      'default=' + (rc && rc.digest) + ' legacy=' + (rd && rd.digest) + ' offline=' + offSelf.digest)
    check('⑨ 自足包：三档读数全等（实例/挂上/pass），且缺省档**一个 /weassist 请求都不发**（包内优先快路径 ⇒ 不注册）',
      !!rc && !!rd && rc.instances === offSelf.instances && rc.attached === offSelf.attached && rc.passes === offSelf.passes
      && rd.instances === rc.instances && rd.attached === rc.attached && rd.passes === rc.passes
      && ((pc && pc.requests === 0 && pc.registered === false && pc.inPkg.effect > 0) || (pc && pc.requests === 0)),
      (rc ? JSON.stringify({ instances: rc.instances, attached: rc.attached, passes: rc.passes }) : '-') + ' prefetch=' + JSON.stringify(pc ? { requests: pc.requests, inPkg: pc.inPkg, registered: pc.registered } : null))
  } else if (!SKIP_SELF) {
    check('⑧ 自足包存在', false, '语料缺失: ' + PKG_SELF)
  }
} finally { await closeQuiet(browser) }

function runtimeOk(rec) {
  const st = rec.state || {}
  return (rec.pageErrors || []).length === 0 && (!st.logError || st.logError.length === 0) && !!st.resolve && st.resolve.instances > 0
}

console.log('\n== 判据汇总 ==')
console.log('  ' + pass + ' 通过 / ' + fail + ' 失败')
try {
  fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), authority: AUTHORITY, res: RES, pkg: PKG, pkgSelf: PKG_SELF, launchNote, pass, fail, results }, null, 1))
  console.log('  读数已落盘: ' + OUT)
} catch (e) { console.log('  ⚠ 落盘失败: ' + e.message) }
process.exit(fail ? 1 : 0)
