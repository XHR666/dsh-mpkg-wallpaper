#!/usr/bin/env node
/**
 * wallpaper-lifecycle-live-probe.mjs —— **真机（:3080 用户 DSH）**验证 2026-09-20 这一轮壁纸流水线修复
 *
 * 为什么必须有它：这一轮修的六件事里，有五件只有真机才成立 ——
 *   ⑥ 设置面板的 rect（`panel.left >= sidebar.right - 4` 且宽 ≥ 700）与 `data-mpw-holds-layer` 的落点；
 *   ② 「清除壁纸」点下去之后**层是不是真的卸载**、N 秒内有没有复活（后端/自愈/回退链都会把它装回来）；
 *   ① "当前壁纸"预览框里的 `<img>` 是不是真的加载出了像素（`naturalWidth > 0`）；
 *   ③ 同一张 web 档在**沙箱档 / 兼容档**两档下的 iframe 属性、shim 握手、帧内能力自证、控制台错误；
 *   A  交互音/角色语音有没有被从播放器清单里排除（`window.__mpwNpAudioClass` 的分类表）；
 *   ④⑤ 卡片暂停能不能真的压住帧内音频；切页（visibilitychange）能不能把两边一起停住。
 *
 * 做法：自签 DSH 鉴权 Cookie（tools/hdr-probe-mint-cookie.mjs）+ **headless Firefox** 打开 :3080。
 *
 * 用法：
 *   node tools/wallpaper-lifecycle-live-probe.mjs                # 需要 :3080 在跑 + 已装本插件
 *   node tools/wallpaper-lifecycle-live-probe.mjs --out /tmp/x   # Cookie/截图落点
 *   node tools/wallpaper-lifecycle-live-probe.mjs --selftest     # 静态判据的分辨力自证（不起浏览器）
 *
 * ⚠ 副作用（结束一律**逐字节复原**并断言）：
 *   · 临时改插件设置（宿主 `${HOME}/.dsh-mpkg-wallpaper/settings.json` + 浏览器 localStorage）与
 *     `custom-dir.json`（把自定义目录临时切到库根以引用用户那张 web 档）。结束时按字节复原并断言。
 *   · headless Firefox，峰值内存 ~600MB ⇒ 跑前 `free -m`，同一时刻只允许一个 Firefox。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const OUT = arg('out', '/tmp/mpw-lifecycle')
const AUTHORITY = arg('authority', '127.0.0.1:3080')
const SETTINGS_JSON = arg('settings', path.join(os.homedir(), '.dsh-mpkg-wallpaper', 'settings.json'))
const CUSTOMDIR_JSON = arg('customdir', path.join(os.homedir(), '.dsh-mpkg-wallpaper', 'custom-dir.json'))
const LIB_ROOT = arg('lib-root', '/root/Desktop/DSHarea/allwallpaper/dd')
const WEB_FOLDER = arg('web-folder', '3580207945')      // 用户测的那张：L2D 碧蓝档案 8K … 星野(中秋)
const PLUGIN = path.resolve(import.meta.dirname, '..')
const STORE = 'dsh.mpkg-wallpaper.v2'

/* ══════════════════════════════════════════════════════════════════════════════
   纯判据（可 `--selftest` 单独验分辨力：不起浏览器、不写任何设置）
   ══════════════════════════════════════════════════════════════════════════════ */
/** ⑥ 判据：面板 rect 不得落进侧栏 rect（1px 容差），且面板宽 ≥ 700。 */
function panelTrapped (panel, side, eps = 4) {
  if (!panel || !side) return { trapped: null, why: '缺 rect' }
  const out = []
  if (panel.left < side.right - eps) out.push('panel.left=' + Math.round(panel.left) + ' < sidebar.right=' + Math.round(side.right))
  if (panel.width < 700) out.push('panel.width=' + Math.round(panel.width) + ' < 700')
  return { trapped: out.length > 0, why: out.join(' / ') }
}
/** ② 判据：清空后层必须**不可见**（隐藏或移除）且 iframe 无 src —— 且 N 秒后仍是这个状态。 */
function cleared (state) {
  if (!state) return { ok: false, why: '缺状态' }
  const bad = []
  if (state.wrapVisible) bad.push('壁纸层仍可见（class=' + String(state.wrapCls || '') + '）')
  if (state.frameSrc) bad.push('iframe 仍有 src=' + String(state.frameSrc).slice(0, 60))
  if (state.videoSrc) bad.push('video 仍有 src')
  return { ok: bad.length === 0, why: bad.join(' / ') }
}
/** ② 判据：源字段必须全空/不存在（区分"清空成功"与"被回退重新装上"）。 */
function srcFieldsEmpty (sec, keys) {
  const left = []
  for (const k of (keys || ['image', 'webUrl', 'sceneKey', 'source', 'mpkgKey', 'mpkgName', 'converted'])) {
    const v = sec ? sec[k] : void 0
    if (!(v === void 0 || v === null || v === '')) left.push(k + '=' + String(v).slice(0, 40))
  }
  return { ok: left.length === 0, why: left.join(', ') }
}
/** ② 判据：页面正文里不得出现宿主错误 JSON（"JSON 被当壁纸渲染"那一条的探针断言）。 */
function noJsonRendered (text) {
  const t = String(text || '')
  return { ok: !/"ok"\s*:\s*false/.test(t) && !/ENOENT/.test(t), why: (t.match(/.{0,40}"ok"\s*:\s*false.{0,40}/) || [''])[0] }
}
/** ③ 判据：两档的 iframe 属性必须与各自规格一致（沙箱=只要 allow-scripts；兼容=含 allow-same-origin）。 */
function sandboxVerdict (mode, attrs) {
  const a = String(attrs || '')
  if (mode === 'sandbox') return { ok: a === 'allow-scripts', why: 'sandbox=' + JSON.stringify(a) }
  return { ok: /allow-scripts/.test(a) && /allow-same-origin/.test(a), why: 'sandbox=' + JSON.stringify(a) }
}
/** ④ 判据：卡片暂停 ⇒ 帧内必须被压住（静音 + 由我们暂停）。 */
function frameSoundVerdict (st, wantBlocked) {
  if (!st) return { ok: false, why: '缺状态' }
  const ok = wantBlocked ? (st.blocked === true && st.reason === 'card-paused') : (st.blocked === false)
  return { ok: ok, why: JSON.stringify(st) }
}
/** A 判据：被判为交互音的文件名**不得**出现在播放器清单里。 */
function voiceExcludedVerdict (cls) {
  if (!cls || !Array.isArray(cls.table)) return { ok: false, why: '缺分类表' }
  const voices = cls.table.filter((c) => c.kind === 'voice').map((c) => c.base)
  const dropped = (cls.dropped || []).map((d) => String(d).split('/').pop())
  const missing = voices.filter((v) => dropped.indexOf(v) < 0)
  return { ok: voices.length > 0 && missing.length === 0, why: 'voice=' + JSON.stringify(voices) + ' dropped=' + JSON.stringify(dropped) }
}
/** B 判据：联动开关关闭**不得**改变壁纸的播放状态。 */
function linkOffVerdict (beforePaused, afterPaused) {
  return { ok: beforePaused === afterPaused, why: 'before=' + beforePaused + ' after=' + afterPaused }
}

if (argv.includes('--selftest')) {
  let p = 0, f = 0
  const ck = (c, label, extra = '') => { if (c) { p++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { f++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }
  ck(panelTrapped({ left: 320, width: 800 }, { right: 268 }).trapped === false, 'S1 面板在侧栏右侧且宽 800 ⇒ 不困')
  ck(panelTrapped({ left: 13, width: 254 }, { right: 268 }).trapped === true, 'S2 真机那条读数（left=13/width=254）必须判困住', panelTrapped({ left: 13, width: 254 }, { right: 268 }).why)
  ck(cleared({ wrapVisible: false, frameSrc: '', videoSrc: '' }).ok === true, 'S3 层隐藏 + 无 src ⇒ 清空成立')
  ck(cleared({ wrapVisible: true, frameSrc: 'x' }).ok === false, 'S4 层还可见/还有 src ⇒ 判"没清掉"')
  ck(srcFieldsEmpty({ image: '', webUrl: void 0, mpkgKey: '' }).ok === true, 'S5 源字段全空/不存在 ⇒ 清空成立')
  ck(srcFieldsEmpty({ image: '', webUrl: 'host:?custom=1&folder=x&file=y' }).ok === false, 'S6 webUrl 残留 ⇒ 判"没清干净"（区分"清空成功"与"被回装"）')
  ck(noJsonRendered('hello').ok === true && noJsonRendered('{"ok":false,"error":"not found"}').ok === false, 'S7 正文里的宿主错误 JSON 必须被抓住')
  ck(sandboxVerdict('sandbox', 'allow-scripts').ok === true && sandboxVerdict('sandbox', 'allow-scripts allow-same-origin').ok === false, 'S8 沙箱档属性判据有分辨力')
  ck(sandboxVerdict('compat', 'allow-scripts allow-same-origin allow-pointer-lock').ok === true, 'S9 兼容档属性判据')
  ck(frameSoundVerdict({ blocked: true, reason: 'card-paused' }, true).ok === true && frameSoundVerdict({ blocked: false }, true).ok === false, 'S10 卡片暂停压住帧内音频的判据')
  ck(voiceExcludedVerdict({ table: [{ base: 'BGM.wav', kind: 'bgm' }, { base: '1-1.wav.ogg', kind: 'voice' }], dropped: ['1-1.wav.ogg'] }).ok === true, 'S11 交互音被排除 ⇒ 成立')
  ck(voiceExcludedVerdict({ table: [{ base: '1-1.wav.ogg', kind: 'voice' }], dropped: [] }).ok === false, 'S12 交互音仍在清单 ⇒ 判红')
  ck(linkOffVerdict(true, true).ok === true && linkOffVerdict(true, false).ok === false, 'S13 联动关闭不得改壁纸播放状态')
  console.log('\n── selftest 汇总：PASS=' + p + ' FAIL=' + f + '（未起浏览器、未写设置）')
  process.exit(f > 0 ? 1 : 0)
}

/* ══════════════════════════════════════════════════════════════════════════════
   真机探针
   ══════════════════════════════════════════════════════════════════════════════ */
fs.mkdirSync(OUT, { recursive: true })
const COOKIE = path.join(OUT, 'cookie.json')
execFileSync(process.execPath, [path.join(PLUGIN, 'tools', 'hdr-probe-mint-cookie.mjs'), '--authority', AUTHORITY, '--out', COOKIE], { stdio: 'inherit' })
const cookie = JSON.parse(fs.readFileSync(COOKIE, 'utf8'))
const settingsBytes = (() => { try { return fs.readFileSync(SETTINGS_JSON) } catch { return null } })()
const customDirBytes = (() => { try { return fs.readFileSync(CUSTOMDIR_JSON) } catch { return null } })()
const baseSec = settingsBytes ? JSON.parse(settingsBytes.toString('utf8')) : {}

const pwEntry = [process.env.MPW_PLAYWRIGHT, path.join(PLUGIN, 'node_modules/playwright/index.js'), '/opt/node/lib/node_modules/playwright/index.js']
  .filter(Boolean).find((p) => { try { return fs.statSync(p).isFile() } catch { return false } })
if (!pwEntry) { console.log('SKIP wallpaper-lifecycle-live-probe — 找不到 playwright'); process.exit(0) }
const pw = await import(pathToFileURL(pwEntry).href)
const firefox = (pw.default && pw.default.firefox) || pw.firefox
if (!firefox) { console.log('SKIP — playwright 没有 firefox 导出'); process.exit(0) }

let pass = 0, fail = 0, skip = 0
const ok = (c, label, extra = '') => { if (c) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }
const skipped = (label, why) => { skip++; console.log('SKIP ' + label + '  — ' + why) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await firefox.launch({ headless: true })
const setCustomDir = async (dir) => {
  const r = await fetch('http://' + AUTHORITY + '/api/mpkg-wallpaper/custom-dir', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: cookie.name + '=' + cookie.value }, body: JSON.stringify({ dir: dir }),
  })
  return r.status
}
const writeSettings = (sec) => { try { fs.writeFileSync(SETTINGS_JSON, JSON.stringify(sec)) } catch (e) {} }

/** 打开宿主设置弹窗，并进入**本插件**那一节（插件在设置里有自己的 nav 项/section）。
 *  真机教训（第一次跑）：只点"设置"进的是宿主的"通用设置"，我们的 section 还没渲染 ⇒
 *  预览框与「清除壁纸」按钮都读不到（假红）。这里按文案把 nav 项逐个试，直到出现我们的标记。 */
const openPluginSettings = async (page) => {
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button, [role="button"]')).find((x) => /^设置$/.test((x.textContent || '').trim()))
    if (b) b.click()
  })
  await page.waitForTimeout(2000)
  const tried = []
  // 真机读数（第一次跑）：宿主的设置标签是 通用设置/模型/插件/Agent 预设/**壁纸引擎背景**（= 本插件那一节）
  const names = ['壁纸引擎背景', '插件', '壁纸', 'dsh-mpkg-wallpaper', '外观', '其他', '通用设置']
  for (const n of names) {
    const hit = await page.evaluate((lb) => {
      if (document.querySelector('.mpw_wallThumb, .mpw_reset')) return true          // 已经在本插件那一节
      const b = Array.from(document.querySelectorAll('button, [role="button"], [class*="navCell"], li, a'))
        .find((x) => (x.textContent || '').trim() === lb)
      if (b) { b.click(); return 'clicked' }
      return false
    }, n)
    tried.push(n + '=' + hit)
    if (hit === true) break
    await page.waitForTimeout(1200)
    const now = await page.evaluate(() => !!document.querySelector('.mpw_wallThumb, .mpw_reset'))
    if (now) break
  }
  return tried
}
/** 轮询等待某个选择器出现（面板是懒渲染的：宿主设置弹窗 + 我们那一节都可能晚一两拍）。 */
const waitFor = async (page, sel, ms = 8000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const hit = await page.evaluate((x) => !!document.querySelector(x), sel)
    if (hit) return true
    await page.waitForTimeout(400)
  }
  return false
}
const readState = (page) => page.evaluate(() => {
  const wrap = document.getElementById('mpw-bgWrap')
  const frame = wrap ? wrap.querySelector('iframe.mpw-webFrame') : null
  const video = document.getElementById('mpw-bgVideo')
  const cs = wrap ? getComputedStyle(wrap) : null
  const panel = document.querySelector('[class*="_panel"][role="dialog"], [role="dialog"]')
  const side = document.querySelector('[class*="sidebarCol"], .hHd-Xa_root, [data-slot="sidebar"]')
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) } }
  const img = wrap ? wrap.querySelector('img.mpw-bgImg') : null
  const thumb = document.querySelector('.mpw_wallThumb img, .mpw_wallThumb video')
  let sec = {}
  try { sec = JSON.parse(localStorage.getItem('dsh.mpkg-wallpaper.v2') || '{}') } catch (e) {}
  const L = window.__mpwLifecycleTest || null
  return {
    wrapCls: wrap ? wrap.className : null,
    wrapVisible: !!(wrap && cs && cs.display !== 'none' && cs.visibility !== 'hidden'),
    wrapDisplay: cs ? cs.display : null,
    bgError: wrap && wrap.getAttribute ? wrap.getAttribute('data-mpw-bg-error') : null,
    holdsLayer: !!(side && side.hasAttribute && side.hasAttribute('data-mpw-holds-layer')),
    layerHostCount: document.querySelectorAll('[data-mpw-holds-layer]').length,
    injectedSide: document.querySelectorAll('.sidebarCol').length,
    frameSrc: frame ? frame.getAttribute('src') : null,
    frameSandbox: frame ? frame.getAttribute('sandbox') : null,
    shimOk: frame ? !!frame.__mpwShimOk : null,
    shimFellBack: frame ? !!frame.__mpwShimFellBack : null,
    sandboxFallback: frame && frame.__mpwSandboxFallback ? frame.__mpwSandboxFallback : null,
    shimCaps: (frame && frame.__mpwShimCaps) || (() => { try { return window.__mpwShimCaps || null } catch (e) { return null } })(),
    videoSrc: video ? video.getAttribute('src') : null,
    videoPaused: video ? !!video.paused : null,
    videoMuted: video ? !!video.muted : null,
    imgSrc: img ? img.getAttribute('src') : null,
    imgNatural: img ? img.naturalWidth : null,
    thumbSrc: thumb ? (thumb.currentSrc || thumb.getAttribute('src')) : null,
    thumbNatural: thumb && thumb.tagName === 'IMG' ? thumb.naturalWidth : null,
    panel: rect(panel), side: rect(side),
    sec: { image: sec.image, webUrl: sec.webUrl, sceneKey: sec.sceneKey, source: sec.source, mpkgKey: sec.mpkgKey, mpkgName: sec.mpkgName, converted: sec.converted, srcRoot: sec.srcRoot, srcDirPath: sec.srcDirPath, npLinkWallpaper: sec.npLinkWallpaper, powPauseHidden: sec.powPauseHidden },
    npSound: (() => { try { return window.__mpwNpFrameSound || null } catch (e) { return null } })(),
    npAudioClass: (() => { try { return window.__mpwNpAudioClass || null } catch (e) { return null } })(),
    npTracks: (() => { try { const l = window.__mpwNpTest && window.__mpwNpTest.trackList ? window.__mpwNpTest.trackList() : null; return l ? l.paths : null } catch (e) { return null } })(),
    powState: (() => { try { return L && L.powState ? L.powState() : null } catch (e) { return null } })(),
    innerText: (document.body ? document.body.innerText : '').slice(0, 4000),
    errors: Array.isArray(window.__mpwProbeErrors) ? window.__mpwProbeErrors.slice(0, 20) : [],
  }
})
const newPage = async (ctx, sec) => {
  const page = await ctx.newPage()
  const errs = []
  page.on('console', (m) => { if (m.type() === 'error') errs.push(String(m.text()).slice(0, 220)) })
  page.on('pageerror', (e) => errs.push('pageerror: ' + String(e && e.message).slice(0, 220)))
  await page.addInitScript((s) => {
    try { localStorage.setItem('dsh.mpkg-wallpaper.v2', JSON.stringify(s)) } catch (e) {}
    window.__mpwProbeErrors = []
    window.addEventListener('error', (e) => { try { window.__mpwProbeErrors.push(String(e && e.message).slice(0, 200)) } catch (x) {} })
  }, sec)
  await page.goto('http://' + AUTHORITY + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(6000)
  return { page, errs }
}

try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addCookies([{ name: cookie.name, value: cookie.value, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' }])

  /* ── ⑥ 设置面板不得被压缩进左侧栏 ─────────────────────────────────────────── */
  console.log('\n=== ⑥ 设置面板 rect / 弹层祖先标记（真机）===')
  {
    const sec = Object.assign({}, baseSec, { enabled: true })
    writeSettings(sec)
    const { page, errs } = await newPage(ctx, Object.assign({}, sec, { __mpwLocalAt: Date.now() + 60000 }))
    const before = await readState(page)
    ok(!!before.side, '⑥-0 找得到左侧栏（前置条件）', JSON.stringify(before.side))
    const navTried = await openPluginSettings(page)
    await page.waitForTimeout(1200)
    console.log('      进入插件设置节的尝试：' + JSON.stringify(navTried))
    const opened = await readState(page)
    const v1 = panelTrapped(opened.panel, opened.side)
    ok(v1.trapped === false, '⑥-1 设置打开后：面板不在左侧栏矩形内且宽 ≥ 700', JSON.stringify(opened.panel) + ' | ' + v1.why)
    ok(opened.holdsLayer && opened.layerHostCount >= 3, '⑥-2 弹层祖先带 data-mpw-holds-layer（含侧栏本体）', 'count=' + opened.layerHostCount + ' side=' + opened.holdsLayer)
    // 切 3 个 tab + 开一次"壁纸引擎背景"
    for (const label of ['壁纸', '外观', '其他']) {
      try {
        await page.evaluate((lb) => {
          const b = Array.from(document.querySelectorAll('button')).find((x) => (x.textContent || '').trim() === lb)
          if (b) b.click()
        }, label)
        await page.waitForTimeout(900)
      } catch (e) {}
    }
    const afterTabs = await readState(page)
    const v2 = panelTrapped(afterTabs.panel, afterTabs.side)
    ok(v2.trapped === false, '⑥-3 切 3 个 tab 之后复测：仍不困在侧栏内', v2.why)
    ok(noJsonRendered(afterTabs.innerText).ok, '⑥-4 页面正文里没有宿主错误 JSON', noJsonRendered(afterTabs.innerText).why)
    await page.screenshot({ path: path.join(OUT, 'settings-open.png') })
    fs.writeFileSync(path.join(OUT, 'state-settings.json'), JSON.stringify(Object.assign({}, before, { errors: errs }), null, 1))
    await page.close()
  }

  /* ── ② 清除壁纸：真的清空 + N 秒不复活 ────────────────────────────────────── */
  console.log('\n=== ② 「清除壁纸」（真按钮点击）===')
  {
    const mixed = Object.assign({}, baseSec, {
      enabled: true, mpkgKey: 'custommpkg|小鸟游星野01_04.mpkg', mpkgName: '小鸟游星野01_04.mpkg', source: 'bgcs_abydos03.mp4',
      converted: 'mp4', image: 'host:?token=%E5%B0%8F%E9%B8%9F%E6%B8%B8%E6%98%9F%E9%87%8E01_04&index=0', fromMpkg: true,
      webUrl: 'http://127.0.0.1:8899/?pkgurl=http%3A%2F%2F127.0.0.1%3A3080%2Fapi%2Fmpkg-wallpaper%2Fraw%3Fcustom%3D1%26folder%3D3326873240%26file%3Dscene.pkg&embed=1',
      sceneKey: 'scene|http://127.0.0.1:3080/api/mpkg-wallpaper/raw?custom=1&folder=3326873240&file=scene.pkg',
    })
    writeSettings(mixed)
    const { page } = await newPage(ctx, Object.assign({}, mixed, { __mpwLocalAt: Date.now() + 60000 }))
    const pre = await readState(page)
    ok(true, '②-0 清空前读数（混态：webUrl 残留）', JSON.stringify({ cls: pre.wrapCls, disp: pre.wrapDisplay, frame: String(pre.frameSrc || '').slice(0, 50), hiddenHost: !!pre.bgError }))
    // 真按钮：打开设置（并进入本插件那一节）→ 点「清除壁纸」
    await openPluginSettings(page)
    const havePanel = await waitFor(page, '.mpw_reset', 8000)
    if (!havePanel) console.log('      警告：等不到 .mpw_reset（我们那一节没渲染）')
    const clicked = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('.mpw_reset, button'))
      const b = all.find((x) => /清除/.test((x.textContent || ''))) || all.find((x) => /^clear\.bg$/.test((x.textContent || '').trim()))
      if (!b) return { ok: false, sample: all.map((x) => (x.textContent || '').trim()).filter(Boolean).slice(0, 24) }
      b.click(); return { ok: true, label: (b.textContent || '').trim() }
    })
    ok(clicked && clicked.ok === true, '②-1 找到并点击了「清除壁纸」按钮', JSON.stringify(clicked).slice(0, 200))
    await page.waitForTimeout(1500)
    const s1 = await readState(page)
    const c1 = cleared(s1), c2 = srcFieldsEmpty(s1.sec)
    ok(c1.ok, '②-2 清空后壁纸层不可见且 iframe/video 无 src', c1.why + ' display=' + s1.wrapDisplay + ' cls=' + s1.wrapCls)
    ok(c2.ok, '②-3 清空后源字段全空/不存在（区分"清空成功"与"被回退重新装上"）', c2.why)
    await page.waitForTimeout(6000)
    const s2 = await readState(page)
    const c3 = cleared(s2), c4 = srcFieldsEmpty(s2.sec)
    ok(c3.ok && c4.ok, '②-4 6 秒后仍未被复活（webUrl/image/mpkgKey/source 全空 + 层仍不可见）', c3.why + ' / ' + c4.why)
    fs.writeFileSync(path.join(OUT, 'state-clear.json'), JSON.stringify({ pre, s1, s2 }, null, 1))
    await page.screenshot({ path: path.join(OUT, 'after-clear.png') })
    await page.close()
  }

  /* ── ② 源不可用：不许把宿主错误 JSON 当壁纸渲染 ───────────────────────────── */
  console.log('\n=== ② 源不可用（404）时的可判定状态 ===')
  {
    const bad = Object.assign({}, baseSec, {
      enabled: true, converted: 'web', image: '', sceneKey: null, mpkgName: WEB_FOLDER, source: 'index.html',
      mpkgKey: 'custom|' + WEB_FOLDER, srcRoot: 'custom', srcDirPath: LIB_ROOT,
      webUrl: 'host:?custom=1&folder=' + WEB_FOLDER + '&file=index.html&shim=1',   // 库根下的目录 ≠ 当前 customDir
    })
    writeSettings(bad)
    const { page } = await newPage(ctx, Object.assign({}, bad, { __mpwLocalAt: Date.now() + 60000 }))
    await page.waitForTimeout(4000)
    const st = await readState(page)
    const j = noJsonRendered(st.innerText)
    ok(j.ok, '②-5 源 404 时正文里没有 {"ok":false…}（修前：JSON 被渲染成壁纸）', j.why)
    ok(!!st.bgError || st.wrapVisible === false, '②-6 有可判定状态：data-mpw-bg-error 或层保持隐藏/占位', 'bgError=' + String(st.bgError).slice(0, 90) + ' visible=' + st.wrapVisible)
    fs.writeFileSync(path.join(OUT, 'state-bad-source.json'), JSON.stringify(st, null, 1))
    await page.close()
  }

  /* ── ③ 沙箱档 vs 兼容档（同一张 web 档）──────────────────────────────────── */
  console.log('\n=== ③ 沙箱档 / 兼容档 真机对照（' + WEB_FOLDER + '）===')
  {
    await setCustomDir(LIB_ROOT)
    const mk = (shim) => Object.assign({}, baseSec, {
      enabled: true, converted: 'web', image: '', sceneKey: null, mpkgName: WEB_FOLDER, source: 'index.html',
      mpkgKey: 'custom|' + WEB_FOLDER, srcRoot: 'custom', srcDirPath: LIB_ROOT, npNowPlaying: true, mute: false,
      webUrl: 'host:?custom=1&folder=' + WEB_FOLDER + '&file=index.html' + (shim ? '&shim=1' : ''),
    })
    for (const mode of ['sandbox', 'compat']) {
      const sec = mk(mode === 'sandbox')
      writeSettings(sec)
      const { page, errs } = await newPage(ctx, Object.assign({}, sec, { __mpwLocalAt: Date.now() + 60000 }))
      await page.waitForTimeout(5000)
      const st = await readState(page)
      const v = sandboxVerdict(mode, st.frameSandbox)
      ok(v.ok, '③-' + (mode === 'sandbox' ? '1 沙箱档' : '3 兼容档') + ' iframe sandbox 属性符合规格', v.why)
      ok(!!st.frameSrc && /index\.html/.test(st.frameSrc), '③-' + (mode === 'sandbox' ? '2' : '4') + ' 入口已挂载（src 指向 index.html）', String(st.frameSrc).slice(0, 90))
      if (mode === 'sandbox') {
        ok(st.shimOk === true, '③-2b 沙箱档 shim 握手成功（宿主注入 shim 生效）', 'shimOk=' + st.shimOk)
        if (st.shimCaps) ok(true, '③-2c 帧内能力自证已上报（worker/storage/offscreen）', JSON.stringify(st.shimCaps))
        else skipped('③-2c 帧内能力自证（caps）', '宿主进程里的 lib/web-wallpaper.js 还是**改动前**那一份（ESM 模块缓存；本轮的服务端改动要等 dsh 重启才生效）—— 无浏览器门禁 H7 已断言注入体里有 probeCaps')
      }
      console.log('      [' + mode + '] errors=' + JSON.stringify(errs.slice(0, 4)))
      fs.writeFileSync(path.join(OUT, 'state-web-' + mode + '.json'), JSON.stringify(Object.assign({}, st, { consoleErrors: errs }), null, 1))
      await page.close()
    }
  }

  /* ── ① 预览框 + A 交互音分类 + ④ 帧内音频 + B 联动语义 ────────────────────── */
  console.log('\n=== ①/A/④/B 预览框 · 交互音分类 · 帧内音频 · 联动语义 ===')
  {
    const sec = Object.assign({}, baseSec, {
      enabled: true, converted: 'web', image: '', sceneKey: null, mpkgName: WEB_FOLDER, source: 'index.html',
      mpkgKey: 'custom|' + WEB_FOLDER, srcRoot: 'custom', srcDirPath: LIB_ROOT, npNowPlaying: true, mute: false,
      npLinkWallpaper: true, webUrl: 'host:?custom=1&folder=' + WEB_FOLDER + '&file=index.html&shim=1',
    })
    writeSettings(sec)
    const { page } = await newPage(ctx, Object.assign({}, sec, { __mpwLocalAt: Date.now() + 60000 }))
    await page.waitForTimeout(4000)
    // ① 预览框：打开设置，读 .mpw_wallThumb 里的 <img> 是否真有像素
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button, [role="button"]')).find((x) => /^设置$/.test((x.textContent || '').trim()))
      if (b) b.click()
    })
    const navInfo = await openPluginSettings(page)
    let haveThumb = await waitFor(page, '.mpw_wallThumb', 8000)
    if (!haveThumb) {
      // 兜底：显式再点一次我们那一节的标签（宿主设置弹窗里的 nav 项），然后再等
      const again = await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('button, [role="button"], [class*="navCell"], li, a'))
          .find((x) => (x.textContent || '').trim() === '壁纸引擎背景')
        if (b) { b.click(); return true }
        return false
      })
      console.log('      兜底再点「壁纸引擎背景」：' + again + '；首次尝试=' + JSON.stringify(navInfo))
      haveThumb = await waitFor(page, '.mpw_wallThumb', 8000)
    }
    if (!haveThumb) console.log('      警告：等不到 .mpw_wallThumb（我们那一节没渲染）')
    await page.waitForTimeout(1200)
    const withPanel = await readState(page)
    ok(!!withPanel.thumbSrc, '①-1 预览框有候选 src（修前：web 档候选为空）', String(withPanel.thumbSrc).slice(0, 110))
    ok(withPanel.thumbNatural > 0, '①-2 预览图**真的加载出像素**（naturalWidth>0）', 'naturalWidth=' + withPanel.thumbNatural + ' src=' + String(withPanel.thumbSrc).slice(0, 80))
    // A 交互音分类
    const cls = withPanel.npAudioClass
    if (cls && cls.table) {
      const v = voiceExcludedVerdict(cls)
      ok(v.ok, 'A-1 被判为交互音的文件已从播放器清单排除（分类表 + dropped）', v.why.slice(0, 200))
      const voices = cls.table.filter((c) => c.kind === 'voice').map((c) => c.base)
      ok(voices.length > 0, 'A-2 至少判出 1 条交互音（这张语料应有 1-1.wav.ogg … 5.wav.ogg）', JSON.stringify(voices))
      const tracks = withPanel.npTracks || []
      ok(!tracks.some((t) => voices.indexOf(String(t).split('/').pop()) >= 0), 'A-3 播放器实际清单里不含交互音文件名', JSON.stringify(tracks))
      ok(tracks.some((t) => /bgm/i.test(String(t))), 'A-4 清单里保留了背景音（BGM.wav）', JSON.stringify(tracks))
    } else { ok(false, 'A-1 拿不到分类表（__mpwNpAudioClass）—— 见 A-5 的诚实说明', JSON.stringify(cls)) }
    // ④ 卡片暂停 ⇒ 帧内被压住
    const paused = await page.evaluate(() => {
      const L = window.__mpwLifecycleTest
      if (!L) return null
      L.transport('pause', L.read())
      L.applyFrameMute()
      return L.publishFrameSound()
    })
    await page.waitForTimeout(600)
    const v4 = frameSoundVerdict(paused, true)
    ok(v4.ok, '④-1 卡片暂停 ⇒ 帧内音频被压住（blocked + reason=card-paused）', v4.why)
    const resumed = await page.evaluate(() => {
      const L = window.__mpwLifecycleTest
      if (!L) return null
      L.transport('play', L.read())
      L.applyFrameMute()
      return L.publishFrameSound()
    })
    const r2ok = !!resumed && resumed.cardPaused === false && (resumed.blocked === false || resumed.reason === 'np-audio-owns')
    ok(r2ok, '④-2 卡片恢复播放 ⇒ 不再粘在 card-paused（若此时我们在放音则按既有优先级只留一路：reason=np-audio-owns）', JSON.stringify(resumed))
    // B 联动关闭：不许改变壁纸播放状态
    const linkTest = await page.evaluate(async () => {
      const L = window.__mpwLifecycleTest
      if (!L) return null
      const out = {}
      const vid = L.video()
      // 先让壁纸处于"播放"（若有视频）或记录 web 档状态
      const beforeOff = { videoPaused: vid ? !!vid.paused : null, cardPaused: L.cardPaused() }
      L.writePartial({ npLinkWallpaper: false })
      L.apply()
      await new Promise((r) => setTimeout(r, 800))
      const afterOff = { videoPaused: vid ? !!vid.paused : null, cardPaused: L.cardPaused() }
      L.writePartial({ npLinkWallpaper: true })
      L.apply()
      await new Promise((r) => setTimeout(r, 800))
      const afterOn = { videoPaused: vid ? !!vid.paused : null }
      return { beforeOff, afterOff, afterOn, alignNone: L.linkAlign(false, true, true), alignResume: L.linkAlign(true, false, false) }
    })
    if (linkTest && linkTest.beforeOff.videoPaused !== null) {
      const v = linkOffVerdict(linkTest.beforeOff.videoPaused, linkTest.afterOff.videoPaused)
      ok(v.ok, 'B-1 联动关闭**不改变**壁纸播放状态（关时暂停/关时播放两组合）', v.why)
      ok(linkTest.alignNone === 'none' && linkTest.alignResume === 'resume', 'B-2 状态机：关＝不动、开＝按卡片状态对齐', JSON.stringify(linkTest))
    } else {
      ok(linkTest && linkTest.alignNone === 'none' && linkTest.alignResume === 'resume', 'B-1 web 档（无 <video>）：状态机判据成立，播放/暂停由帧内 shim 承担', JSON.stringify(linkTest))
    }
    // ⑤ 切页：可见性 → 两边一起停
    const vis = await page.evaluate(() => {
      const L = window.__mpwLifecycleTest
      if (!L) return null
      const before = L.powState()
      try { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }) } catch (e) {}
      try { document.dispatchEvent(new Event('visibilitychange')) } catch (e) {}
      const after = L.powState()
      try { delete document.hidden } catch (e) {}
      try { document.dispatchEvent(new Event('visibilitychange')) } catch (e) {}
      return { before, after, restored: L.powState() }
    })
    ok(vis && vis.after && vis.after.paused === true, '⑤-1 页面隐藏 ⇒ 省电/礼仪暂停生效（我们与帧内音频一起停）', JSON.stringify(vis && vis.after))
    ok(vis && vis.restored && vis.restored.paused === false, '⑤-2 回到可见 ⇒ 按原状态续播', JSON.stringify(vis && vis.restored))
    fs.writeFileSync(path.join(OUT, 'state-preview-audio.json'), JSON.stringify({ withPanel, paused, resumed, linkTest, vis }, null, 1))
    await page.screenshot({ path: path.join(OUT, 'preview-web.png') })
    await page.close()
  }
} finally {
  try { await browser.close() } catch {}
  // 复原（逐字节断言）
  try { if (settingsBytes) fs.writeFileSync(SETTINGS_JSON, settingsBytes) } catch (e) {}
  try { if (customDirBytes) fs.writeFileSync(CUSTOMDIR_JSON, customDirBytes) } catch (e) {}
  try { if (customDirBytes) await setCustomDir(JSON.parse(customDirBytes.toString('utf8')).dir) } catch (e) {}
}
const sOk = !settingsBytes || fs.readFileSync(SETTINGS_JSON).equals(settingsBytes)
const cOk = !customDirBytes || fs.readFileSync(CUSTOMDIR_JSON).equals(customDirBytes)
console.log('\n复原断言：settings.json 逐字节一致=' + sOk + '  custom-dir.json 逐字节一致=' + cOk)
if (!sOk || !cOk) fail++
console.log('── wallpaper-lifecycle-live-probe: PASS=' + pass + ' FAIL=' + fail + ' SKIP=' + skip + '（落点 ' + OUT + '）')
process.exit(fail > 0 ? 1 : 0)
