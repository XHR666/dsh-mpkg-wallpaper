#!/usr/bin/env node
/**
 * zcode-final-live-probe.mjs —— ZCode 最终任务（2026-11-06）真机验证探针
 *
 * 对**真实 DSH（:3080）**跑一轮只读验证（自签 Cookie + 单个 headless Firefox；不重启 DSH、
 * 不写用户设置、不碰用户已开的页面 —— 探针是独立的一个浏览器客户端）：
 *
 *   Z2 沙箱（P0-2 token-first）：
 *     S1 boot 恢复旧存档（legacy webUrl）⇒ 观察到 挂起(deferred) → token 到手 → 原地 strictify → strict 挂载；
 *     S2 场景帧 sandbox 属性**无** allow-same-origin、URL 带 sandbox=strict 且 pkgurl 内带 st=；
 *     S3 父页面读场景帧 contentDocument 被拒（跨源/不透明源）；
 *     S4 渲染器真出画（cap.firstFrame）+ 壁纸层可见（截图人眼复核）。
 *
 *   Z1 错误日志 UI：
 *     E1 设置段「提交反馈」旁存在「查看错误日志」按钮；
 *     E2 空态：示例长条在、无原始 <pre>、每块有导出、背景无残留块；
 *     E3 真实错误：__mpwErrProbe 后出现「错误 #N」长条，且**不显示** message 文本；
 *     E4 逐块导出 JSON 字段齐全（app/version/url/userAgent/exportedAt/index/error{at,where,message,sample}）；
 *     E5 导出全部含 entries[]；清除日志后回到示例态；关闭弹窗后背景 0 块。
 *
 *   Z3 渲染器壁纸态 DOM（对 /webloader/?embed=1&noui=1 另开一个页签做运行时 DOM 检查）：
 *     R1 html 带 mpw-noui；R2 #bar/#fps/#log/#logbar/#__mpwLnTag/#__mpwHealthTag 全部不存在。
 *
 * 用法：node tools/zcode-final-live-probe.mjs [--out /tmp/zcode-live] [--authority 127.0.0.1:3080]
 * 前置：DSH 在跑 + 本插件已 symlink 进 profile + **同一时刻没有其它浏览器实例**（跑前看 free -m）。
 * 副作用：只读浏览（设置界面导航、打开/关闭错误日志弹窗、__mpwErrProbe 写入的是**本探针页自己**
 *          的内存错误环，随页关闭即消失；不动用户档位/设置）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { withAudioMute } from './_audio-mute.mjs'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
/* ①(对抗审查 P1-1 2026-11-06) 默认输出目录不得写死 /tmp 字面量（仓库红线：临时目录一律 os.tmpdir()，
   cross-platform 的 code-tmp-literal 静态门禁会抓）。 */
const OUT = arg('out', path.join(os.tmpdir(), 'zcode-live'))
const AUTHORITY = arg('authority', '127.0.0.1:3080')
const PLUGIN = path.resolve(import.meta.dirname, '..')

fs.mkdirSync(OUT, { recursive: true })
const COOKIE = path.join(OUT, 'cookie.json')
execFileSync(process.execPath, [path.join(PLUGIN, 'tools', 'hdr-probe-mint-cookie.mjs'), '--authority', AUTHORITY, '--out', COOKIE], { stdio: 'inherit' })
const cookie = JSON.parse(fs.readFileSync(COOKIE, 'utf8'))

const pwEntry = [process.env.MPW_PLAYWRIGHT, path.join(PLUGIN, 'node_modules/playwright/index.js'), '/opt/node/lib/node_modules/playwright/index.js'].filter(Boolean)
  .find((p) => { try { return fs.statSync(p).isFile() } catch { return false } })
if (!pwEntry) { console.log('SKIP zcode-final-live-probe — 找不到 playwright'); process.exit(0) }
const pw = await import(pathToFileURL(pwEntry).href)
const firefox = (pw.default && pw.default.firefox) || pw.firefox

let pass = 0, fail = 0
const ok = (c, name, extra = '') => { if (c) { pass++; console.log('PASS ' + name + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + name + (extra ? '  ' + extra : '')) } }
const shot = async (page, name) => { try { await page.screenshot({ path: path.join(OUT, name) }); console.log('SHOT ' + name) } catch (e) { console.log('SHOT-FAIL ' + name + ': ' + e.message) } }

const browser = await firefox.launch({ headless: true, firefoxUserPrefs: withAudioMute() })
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await ctx.addCookies([{ name: cookie.name, value: cookie.value, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' }])
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)))

  /* ═══ Z2：boot 恢复旧存档 ⇒ token-first strict 挂载 ═══ */
  console.log('\n== Z2 场景沙箱（真机 boot → 恢复路径 → strict） ==')
  await page.goto('http://' + AUTHORITY + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })
  // 观察恢复路径时序：deferred 出现 → 消费 → 帧以 strict 挂载（含直挂 strict 的存档，两种都算绿）
  let sawDeferred = false
  const t0 = Date.now()
  let sb = null, frameInfo = null
  while (Date.now() - t0 < 45000) {
    sb = await page.evaluate(() => {
      try {
        const w = window.__mpwSandbox
        if (!w) return null
        const f = document.querySelector('iframe.mpw-webFrame')
        return {
          diag: w.diag(),
          src: f ? String(f.getAttribute('src') || '') : '',
          sandbox: f ? String(f.getAttribute('sandbox') || '') : null,
          dsandbox: f ? String(f.getAttribute('data-mpw-sandbox') || '') : null,
        }
      } catch (e) { return { err: String(e && e.message) } }
    }).catch(() => null)
    if (sb && sb.diag && sb.diag.deferred) sawDeferred = true
    if (sb && sb.src && /[?&]sandbox=strict(&|$)/.test(sb.src)) break
    await page.waitForTimeout(500)
  }
  ok(!!sb && !!sb.diag, 'S0 插件客户端加载且沙箱测试入口在', sb && sb.err ? String(sb.err) : '')
  if (sb && sb.diag) console.log('   恢复时序：deferred 观察到=' + sawDeferred + ' diag.last=' + JSON.stringify(sb.diag.last) + ' tokens=' + sb.diag.tokens.length)
  ok((sb || {}).sandbox !== null && (sb || {}).sandbox !== undefined, 'S0b 场景帧元素在', String((sb || {}).sandbox))
  const strictOk = !!sb && /[?&]sandbox=strict(&|$)/.test(sb.src)
  ok(strictOk, 'S1 场景帧以 strict URL 挂载（旧存档恢复 → token-first）', String((sb || {}).src).slice(0, 110))
  ok(sawDeferred || !!(sb && sb.diag && sb.diag.tokens.length), 'S1b 观察到挂起(deferred)或 token 缓存（token-first 链路）', 'sawDeferred=' + sawDeferred)
  ok(!!sb && sb.sandbox !== null && sb.sandbox.indexOf('allow-same-origin') < 0 && sb.sandbox.indexOf('allow-scripts') >= 0, 'S2 sandbox 属性 = strict 集（无 allow-same-origin）', String((sb || {}).sandbox))
  ok(!!sb && decodeURIComponent(sb.src).indexOf('st=') >= 0, 'S2b pkgurl 内带 st=<token>', '')
  ok(!!sb && sb.dsandbox === 'strict', 'S2c data-mpw-sandbox=strict', String((sb || {}).dsandbox))
  // S3：contentDocument 读取必须发生在**导航提交之后**（src 赋值后初瞬还是继承父源的 about:blank，
  // 早读会得到假"可读"）——上面 45s 轮询早已跨过导航，这里再读才算数。
  const readAttempt = await page.evaluate(() => {
    const f = document.querySelector('iframe.mpw-webFrame')
    try { const d = f && f.contentDocument; return { read: !!d, title: d && d.title, href: (() => { try { return d && d.location && d.location.href } catch (e) { return 'inaccessible' } })() } }
    catch (e) { return { blocked: true, name: e.name, message: String(e.message || e).slice(0, 100) } }
  })
  ok(!!readAttempt && (readAttempt.blocked === true || readAttempt.read === false), 'S3 父页面读场景帧 contentDocument 被拒/为 null（导航后读）', JSON.stringify(readAttempt))
  // 真出画：cap.firstFrame（大包可能慢；轮到 120s；期间失败表/提示可能先落，迟到首帧仍恢复）。
  // ⚠ 本机 headless Firefox **无 WebGL2**（tools/zcode-final-live-probe 同环境实测 webgl2=false，
  //   与档位/沙箱无关）⇒ 无头环境里渲染器必然 ok:false；firstFrame 只能由负责人在真机页面复核。
  let cap = null
  const t1 = Date.now()
  while (Date.now() - t1 < 90000) {
    cap = await page.evaluate(() => { try { return window.__mpwSandbox ? window.__mpwSandbox.cap() : null } catch { return null } }).catch(() => null)
    if (cap && cap.firstFrame) break
    await page.waitForTimeout(1500)
  }
  const glOk = await page.evaluate(() => { try { const c = document.createElement('canvas'); return !!c.getContext('webgl2') } catch { return false } }).catch(() => false)
  if (!glOk) {
    console.log('SKIP S4/S5b — 本机 headless 无 WebGL2（渲染器无法出画，与沙箱档无关；firstFrame 待真机复核）。cap=' + JSON.stringify(cap && { ok: cap.ok, firstFrame: cap.firstFrame, opaque: cap.opaque, errs: cap.errs }))
  } else {
    ok(!!cap && cap.firstFrame === true, 'S4 渲染器真出画（cap.firstFrame）', JSON.stringify(cap && { ok: cap.ok, firstFrame: cap.firstFrame, opaque: cap.opaque, tainted: cap.tainted }))
  }
  const vis = await page.evaluate(() => {
    const w = document.getElementById('mpw-bgWrap')
    const f = document.querySelector('iframe.mpw-webFrame')
    const r = w && w.getBoundingClientRect()
    return { wrapVisible: !!w && String(w.getAttribute('data-mpw-bg-error') || '') === '', wrapRect: r ? [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] : null,
      frameOpacity: f ? String(f.style.opacity || '') : null, deferMark: w ? String(w.getAttribute('data-mpw-scene-defer') || '') : null }
  }).catch(() => null)
  ok(!!vis && vis.wrapVisible && vis.wrapRect && vis.wrapRect[2] > 800 && vis.wrapRect[3] > 600, 'S5 壁纸层满屏可见（无源不可用状态/无黑屏）', JSON.stringify(vis))
  /* ①(对抗审查 P1-2) 兜底提示必须落在**壁纸面**：无 WebGL 环境 strict 必失败 ⇒ 提示条应在；
     硬件 GL 出画成功 ⇒ 提示条应退场。 */
  const noteLive = await page.evaluate(() => { const n = document.getElementById('mpw-sceneNote'); return n ? String(n.textContent || '') : null }).catch(() => null)
  if (!glOk) ok(!!noteLive && noteLive.indexOf('刷新壁纸') >= 0, 'S6 strict 失败（无 WebGL 环境）⇒ 壁纸面底部提示条在', noteLive ? noteLive.slice(0, 60) : 'missing')
  else ok(!noteLive, 'S6 出画成功 ⇒ 壁纸面底部提示条已退场', String(noteLive))
  if (glOk) {
    ok(!!vis && vis.frameOpacity === '1', 'S5b 场景帧 opacity=1（已出画）', String(vis && vis.frameOpacity))
    ok(!!vis && vis.deferMark === null, 'S5c 挂起标记已摘除', String(vis && vis.deferMark))
  }
  await shot(page, 'z2-wallpaper-strict.png')

  /* ═══ Z3：渲染器壁纸态（embed=1&noui=1）运行时 DOM ═══ */
  console.log('\n== Z3 渲染器壁纸态 DOM（运行时） ==')
  const p2 = await ctx.newPage()
  await p2.goto('http://' + AUTHORITY + '/webloader/?embed=1&noui=1', { waitUntil: 'load', timeout: 60000 })
  await p2.waitForTimeout(2500)   // 等 DOMContentLoaded 清理与任何延迟创建
  const r3 = await p2.evaluate(() => ({
    htmlCls: String(document.documentElement.className || ''),
    debugNodes: ['bar', 'fps', 'log', 'logbar', '__mpwLnTag', '__mpwHealthTag'].map((id) => ({ id, present: !!document.getElementById(id) })).filter((x) => x.present),
    errlogVisible: [...document.querySelectorAll('.mpw_errlog,.mpw_errBlock')].filter((e) => e.offsetParent).length,
  })).catch((e) => ({ err: String(e && e.message) }))
  ok(!r3.err && /mpw-noui/.test(r3.htmlCls), 'R1 html.mpw-noui（壁纸态）', String(r3.htmlCls))
  ok(!r3.err && r3.debugNodes.length === 0, 'R2 #bar/#fps/#log/#logbar/#__mpwLnTag/#__mpwHealthTag 全部不在 DOM', JSON.stringify(r3.debugNodes))
  await shot(p2, 'z3-renderer-noui.png')
  await p2.close()

  /* ═══ Z1：错误日志 UI（真 GUI 导航） ═══ */
  console.log('\n== Z1 错误日志 UI（设置段真 GUI） ==')
  const SETTINGS = '[data-slot="sidebar.settings"]'
  await page.waitForSelector(SETTINGS, { timeout: 30000 })
  await page.evaluate((sel) => { const b = document.querySelector(sel + ' button') || document.querySelector(sel); if (b) b.click() }, SETTINGS)
  await page.waitForTimeout(1200)
  /* ①(真机 2026-11-06) sidebar.settings 点开的是一个**弹出菜单**（设置/意见反馈/登录），
     设置页要再点菜单里的「设置」项。 */
  const menuSet = await page.evaluate(() => {
    const items = [...document.querySelectorAll('button,[role="menuitem"],li,a,div')]
      .filter((e) => (e.textContent || '').trim() === '设置' && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0 && (e.children || []).length <= 3)
    const el = items[items.length - 1]
    if (!el) return { found: false }
    ;(el.closest('button,[role="menuitem"],li') || el).click()
    return { found: true }
  }).catch((e) => ({ found: false, err: String(e && e.message) }))
  console.log('   菜单「设置」点击：' + JSON.stringify(menuSet))
  await page.waitForTimeout(2500)
  const nav = await page.evaluate(() => {
    const all = [...document.querySelectorAll('*')].filter((e) => /DSH壁纸引擎|壁纸引擎/.test((e.textContent || '').trim()) && (e.textContent || '').trim().length <= 8 && e.getBoundingClientRect().width > 0)
    const el = all[all.length - 1]
    if (!el) return { found: false }
    ;(el.closest('button,[role="tab"],[role="button"],li') || el).click()
    return { found: true, text: (el.textContent || '').trim().slice(0, 20) }
  }).catch((e) => ({ found: false, err: String(e && e.message) }))
  ok(!!nav && nav.found, 'E0 进入插件设置段「DSH壁纸引擎」', JSON.stringify(nav))
  await page.waitForTimeout(2000)
  const btns = await page.evaluate(() => [...document.querySelectorAll('button,a')]
    .filter((e) => e.offsetParent && /提交反馈|查看错误日志/.test(e.textContent || ''))
    .map((e) => ({ text: e.textContent.trim(), tag: e.tagName })))
  ok(btns.some((b) => b.text.indexOf('查看错误日志') >= 0), 'E1 「查看错误日志」按钮在「提交反馈」旁', JSON.stringify(btns))
  // 空态
  await page.evaluate(() => { try { window.__mpwErrRingClear() } catch (e) {} })
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button,a')].find((e) => e.offsetParent && /查看错误日志/.test(e.textContent || ''))
    if (b) b.click()
  })
  let modalUp = true
  try { await page.waitForSelector('.mpw_dialog_errlog', { timeout: 10000 }) } catch (e) { modalUp = false }
  ok(modalUp, 'E1b 点击后错误日志弹窗打开', modalUp ? '' : 'timeout')
  await page.waitForTimeout(400)
  const empty = await page.evaluate(() => {
    const m = document.querySelector('.mpw_dialog_errlog')
    const bs = m ? [...m.querySelectorAll('.mpw_errBlock')] : []
    return {
      modal: !!m, blocks: bs.length, sample: !!m?.querySelector('.mpw_errBlockSample'),
      widths: bs.map((b) => Math.round(b.getBoundingClientRect().width)),
      heights: bs.map((b) => Math.round(b.getBoundingClientRect().height)),
      rawPre: m?.querySelectorAll('pre.mpw_errlog').length || 0,
      exportButtons: bs.map((b) => [...b.querySelectorAll('button')].map((x) => x.innerText.trim())),
      backgroundBlocks: [...document.querySelectorAll('.mpw_errBlock')].filter((e) => e.offsetParent && (!m || !m.contains(e))).length,
      modalText: m ? m.innerText.slice(0, 300) : '',
    }
  })
  ok(empty.modal && empty.sample, 'E2 空态弹窗 + 示例长条在', JSON.stringify({ sample: empty.sample, blocks: empty.blocks }))
  ok(empty.rawPre === 0, 'E2b 无原始日志 <pre>（不显示具体日志）', 'rawPre=' + empty.rawPre)
  ok(empty.heights.length >= 1 && empty.heights.every((h) => h >= 40), 'E2c 长条高度 ≥40px（长条布局）', JSON.stringify(empty.heights))
  ok(empty.widths.length >= 1 && empty.widths[0] >= 380, 'E2c-b 长条宽度接近弹窗内容宽（整行长条）', JSON.stringify(empty.widths))
  ok(empty.exportButtons.some((a) => a.some((t) => /导出/.test(t))), 'E2d 示例块带导出按钮', JSON.stringify(empty.exportButtons))
  ok(empty.backgroundBlocks === 0, 'E2e 背景无残留块', String(empty.backgroundBlocks))
  await shot(page, 'z1-errlog-empty.png')
  // 关闭（**只**用遮罩点击——Escape 会把整个设置页关掉，真机 2026-11-06 实测）→ 注入真实错误 → 重开
  const closeErrLog = () => page.evaluate(() => {
    const m = document.querySelector('.mpw_dialog_errlog')
    if (!m) return 'no-modal'
    const mask = m.closest('[class*="mask"],[class*="Mask"]') || m.parentElement
    if (mask) { mask.click(); return 'mask-clicked' }
    return 'no-mask'
  })
  console.log('   close#1: ' + await closeErrLog())
  await page.waitForTimeout(600)
  await page.evaluate(() => { try { window.__mpwErrProbe('zcode-ui-check', 'probe-message-must-not-render') } catch (e) {} })
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button,a')].find((e) => e.offsetParent && /查看错误日志/.test(e.textContent || ''))
    if (b) b.click()
  })
  let modalUp2 = true
  try { await page.waitForSelector('.mpw_dialog_errlog', { timeout: 10000 }) } catch (e) { modalUp2 = false }
  ok(modalUp2, 'E3- reopen 弹窗再次打开', modalUp2 ? '' : 'timeout')
  await page.waitForTimeout(400)
  const real = await page.evaluate(() => {
    const m = document.querySelector('.mpw_dialog_errlog')
    const bs = m ? [...m.querySelectorAll('.mpw_errBlock')] : []
    return {
      blocks: bs.length, sample: !!m?.querySelector('.mpw_errBlockSample'),
      texts: bs.map((b) => b.innerText),
      joined: bs.map((b) => b.innerText).join('\n'),
      exportButtons: bs.map((b) => [...b.querySelectorAll('button')].map((x) => x.innerText.trim())),
    }
  })
  ok(real.blocks >= 1 && !real.sample, 'E3 真实错误出现为独立长条（示例条退场）', 'blocks=' + real.blocks)
  ok(real.joined.indexOf('probe-message-must-not-render') < 0 && real.joined.indexOf('zcode-ui-check') < 0, 'E3b 长条**不显示** message/where 文本', real.texts[0] ? real.texts[0].replace(/\n/g, ' | ').slice(0, 80) : '')
  ok(real.exportButtons.every((a) => a.some((t) => /导出/.test(t))) && real.exportButtons.length >= 1, 'E3c 每块都有导出按钮', JSON.stringify(real.exportButtons))
  await shot(page, 'z1-errlog-real.png')
  // 逐块导出（挂钩 URL.createObjectURL 截获 blob 内容）
  await page.evaluate(() => {
    window.__mpwExportCapture = []
    const orig = URL.createObjectURL.bind(URL)
    URL.createObjectURL = (blob) => { const u = orig(blob); try { blob.text().then((t) => window.__mpwExportCapture.push(t)).catch(() => {}) } catch (e) {} return u }
  })
  await page.evaluate(() => {
    const m = document.querySelector('.mpw_dialog_errlog')
    const blk = m && [...m.querySelectorAll('.mpw_errBlock')].find((b) => !b.classList.contains('mpw_errBlockSample'))
    const btn = blk && [...blk.querySelectorAll('button')].find((x) => /导出/.test(x.innerText) && !/全部/.test(x.innerText))
    if (btn) btn.click()
  })
  await page.waitForTimeout(800)
  const one = await page.evaluate(() => (window.__mpwExportCapture || []).map((t) => { try { return JSON.parse(t) } catch { return null } }))
  const oneOk = one.length >= 1 && one[0] && one[0].app === 'dsh-mpkg-wallpaper' && typeof one[0].version === 'string'
    && typeof one[0].url === 'string' && typeof one[0].userAgent === 'string' && typeof one[0].exportedAt === 'string'
    && one[0].error && typeof one[0].error.at === 'number' && typeof one[0].error.where === 'string'
    && typeof one[0].error.message === 'string' && typeof one[0].error.sample === 'boolean' && one[0].index >= 1
  ok(oneOk, 'E4 逐块导出 JSON 字段齐全（app/version/url/userAgent/exportedAt/index/error.at/where/message/sample）', JSON.stringify(one[0] ? Object.keys(one[0]) : one))
  // 导出全部 + 清除
  await page.evaluate(() => {
    const m = document.querySelector('.mpw_dialog_errlog')
    const btn = m && [...m.querySelectorAll('button')].find((x) => /导出全部/.test(x.innerText || ''))
    if (btn) btn.click()
  })
  await page.waitForTimeout(800)
  const all = await page.evaluate(() => (window.__mpwExportCapture || []).slice(1).map((t) => { try { return JSON.parse(t) } catch { return null } }))
  ok(all.length >= 1 && Array.isArray(all[0].entries) && all[0].entries.length >= 1 && all[0].count >= 1, 'E5 导出全部含 entries[] + count', JSON.stringify(all[0] ? { count: all[0].count, n: all[0].entries.length } : all.length))
  await page.evaluate(() => {
    const m = document.querySelector('.mpw_dialog_errlog')
    const btn = m && [...m.querySelectorAll('button')].find((x) => /清除日志/.test(x.innerText || ''))
    if (btn) btn.click()
  })
  await page.waitForTimeout(500)
  const cleared = await page.evaluate(() => {
    const m = document.querySelector('.mpw_dialog_errlog')
    const bs = m ? [...m.querySelectorAll('.mpw_errBlock')] : []
    return { sample: !!m?.querySelector('.mpw_errBlockSample'), real: bs.filter((b) => !b.classList.contains('mpw_errBlockSample')).length }
  })
  ok(cleared.sample && cleared.real === 0, 'E6 清除日志 ⇒ 回到示例/空态', JSON.stringify(cleared))
  await page.evaluate(() => { const m = document.querySelector('.mpw_dialog_errlog'); const mask = m && (m.closest('[class*="mask"],[class*="Mask"]') || m.parentElement); if (mask) mask.click() })
  await page.waitForTimeout(400)
  const bg = await page.evaluate(() => ({
    modal: !!document.querySelector('.mpw_dialog_errlog'),
    backgroundBlocks: [...document.querySelectorAll('.mpw_errBlock,.mpw_errlog')].filter((e) => e.offsetParent).length,
  }))
  ok(bg.modal === false && bg.backgroundBlocks === 0, 'E7 关闭后：弹窗不在、背景无日志块', JSON.stringify(bg))
  ok(errs.length === 0, 'E8 整轮 0 个 pageerror（除探针注入的预期错误外）', JSON.stringify(errs.slice(0, 3)))
  await shot(page, 'z1-after-close.png')

  console.log('\n── 结果: PASS=' + pass + ' FAIL=' + fail + '（截图/读数目录: ' + OUT + '）')
} finally {
  try { await browser.close() } catch { /* ignore */ }
}
process.exit(fail ? 1 : 0)
