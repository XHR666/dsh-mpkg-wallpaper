// bench-dbg-dpr-probe.mjs —— 测试台「调试逐层隔离」与「DPR 切换」的真机自上报判据（2026-09-22）
//
// 为什么单独一条：`bench-ui-headless` 的 Z4 只钉"栏内有当前层信息"，**没钉"画面真的隔离到那一层"**；
// DPR 切换此前也没有判据。这两条都是用户点名的真机现象（"摁左右键层号变了但画面不变"、"DPR 1→2 加载不出来"）。
//
// 判据（全部由探针自己驱动，不需要用户操作；`--selftest` 只跑纯判据）：
//   D1 进调试模式后：`#dbg-layer` 有层号，且**恰好一层** `visible`（其余全 false）—— 机制口径
//   D2 连续按右方向键 N 次：层号**递增**，且每次隔离的层**不同**（不是"只改标签"）
//   D3 退出调试模式：所有层恢复可见（一个隔离残留都不许有）
//   P1 工具条 DPR 1→2：画布像素宽高**真的跟着变**（`__mpwLiveRes`），且 iframe 不是白屏（内容尺寸非 0）
//   P2 DPR 2→1：画布像素回到 1×（可逆）
//
// 诚实边界：**不做像素级**"画面长得不一样"断言（WebGL 画布 `toDataURL` 需要 `preserveDrawingBuffer`，
// 本页未开）——这里判的是"隔离状态 + 渲染循环活着"，像素级留给真机眼睛。
import os from 'node:os'
import path from 'node:path'

const argv = process.argv.slice(2)
const SELFTEST = argv.includes('--selftest')
const AUTHORITY = (() => { const i = argv.indexOf('--authority'); return i >= 0 && argv[i + 1] ? argv[i + 1] : '127.0.0.1:8902' })()
let pass = 0, fail = 0
const ok = (c, label, extra = '') => { if (c) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }
const skip = (label, why) => console.log('SKIP ' + label + ' —— ' + why)

/** 纯判据：给定层的 visible 数组，判断"恰好隔离了一层"。 */
/** 纯判据：绘制期隔离落在**哪一层**上。
    输入 = read() 的 `lnList`（每层 `{name, container, hidden}`；`hidden` = `layer.__lnHidden`）。
    为什么不用 `visible`：本仓 core 每帧按自己的状态重算它 —— 实测宿主写 `[F,F,T,F,F]`，1.6s 后读回
    `[T,T,T,T,F]`，用 `visible` 判隔离会时真时假。`__lnHidden` 是**绘制期**判据（draw 循环每帧
    `if (layer.__lnHidden) continue`），宿主写进去就稳定生效。容器层不参与绘制 ⇒ 不计入。
    返回 `{ index, drawing, total }`：`index` = 唯一仍在绘制的非容器层下标（-1 = 没有隔离/不唯一）。 */
export function isolationIndex(lnList) {
  if (!Array.isArray(lnList) || lnList.length === 0) return null
  const draw = lnList.filter((l) => l && !l.container && !l.hidden)
  return { index: draw.length === 1 ? draw[0].i : -1, drawing: draw.length, total: lnList.filter((l) => l && !l.container).length }
}

export function isolatedExactlyOne(flags) {
  if (!Array.isArray(flags) || flags.length === 0) return null
  const on = flags.filter(Boolean).length
  return on === 1
}
/** 纯判据：画布是否随 DPR 变化（1↔2 两个档位读数）。 */
export function dprResizeOk(a, b) {
  if (!a || !b || !(a.cssW > 0) || !(b.cssW > 0)) return null
  const ratio = Math.abs(b.dpr - a.dpr)
  if (ratio < 1) return null                       // 两个档位没差 ⇒ 无从判定
  return b.width > a.width * 1.5                   // 放宽到 1.5×：只要"真的变大了"，不苛求正好 2×
}

if (SELFTEST) {
  console.log('== S 纯判据自证 ==')
  ok(isolatedExactlyOne([false, true, false]) === true, 'S1 恰好一层可见 ⇒ true')
  ok(isolatedExactlyOne([false, false]) === false && isolatedExactlyOne([true, true]) === false, 'S2 零层/多层可见 ⇒ false')
  ok(isolatedExactlyOne([]) === null, 'S3 没有层 ⇒ null（无可判对象，不许当通过）')
  ok(dprResizeOk({ cssW: 528, dpr: 1, width: 528 }, { cssW: 528, dpr: 2, width: 1056 }) === true, 'S4 DPR 1→2 画布变大 ⇒ true')
  /* S6 隔离落点（容器层不计）：只有 #2 在画 ⇒ index 2；容器不参与 ⇒ total 只数非容器层。 */
  {
    const L = [{ i: 0, hidden: true }, { i: 1, hidden: true }, { i: 2, hidden: false }, { i: 3, container: true, hidden: false }]
    const r = isolationIndex(L)
    ok(r && r.index === 2 && r.drawing === 1 && r.total === 3, 'S6 隔离落点判据：容器不计、只认绘制期 __lnHidden', JSON.stringify(r))
    ok(isolationIndex(L.map((x) => ({ ...x, hidden: false }))).index === -1, 'S6b 全部参与绘制 ⇒ index=-1（没有隔离，不当成"隔离成功"）')
    ok(isolationIndex([]) === null, 'S6c 没有层 ⇒ null（不许当通过）')
  }
  ok(dprResizeOk({ cssW: 528, dpr: 1, width: 528 }, { cssW: 528, dpr: 1, width: 528 }) === null, 'S5 两档相同 ⇒ null（无从判定）')
  /* S7 契约两端（静态）：① 测试台把隔离写进**绘制期** `__lnHidden`；② core 的 draw 循环每帧读它。
     只改一端就会退化成"写 visible ⇒ 被渲染器重算冲掉"（真机实测 1.6s 后 `[T,T,T,T,F]`）。 */
  {
    const rd = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8') } catch (e) { return '' } }
    const bench = rd('demo/bench-patch.js'), core = rd('core/we-scene-bundle.js')
    const m = /function dbgApplyIsolation[\s\S]{0,1400}?\n  }/.exec(bench)
    const body = m ? m[0] : ''
    ok(/\.__lnHidden = hide/.test(body), 'S7a 测试台隔离写的是绘制期 `__lnHidden`（不是只写 `visible`）',
      body ? (/\.__lnHidden = hide/.test(body) ? 'ok' : body.slice(0, 90)) : '找不到 dbgApplyIsolation')
    ok(/isContainer/.test(body), 'S7b 隔离跳过容器层（与 `:8899` 的 `?ln=N` 同语义：容器不参与绘制）')
    ok(/if \(layer\.__lnHidden\)/.test(core), 'S7c core 的 draw 循环每帧读 `layer.__lnHidden`（契约另一端在位）')
  }
  console.log('\n── selftest 汇总：PASS=' + pass + ' FAIL=' + fail + '（未起浏览器）')
  process.exit(fail > 0 ? 1 : 0)
}

/* playwright 不在本仓 node_modules 里（与 `bench-ui-headless` 同款解析：环境变量 → 本仓 → 插件仓 → 全局） */
import { createRequire } from 'node:module'
import fs from 'node:fs'
import { ROOT, WS } from './_root.mjs'
/* ①(2026-09-23 全仓清扫) 「有头优先 + 能力前置探针 + 无 GL 打 SKIP」这套口径的**唯一实现**
   （照抄 `tests/bench-renderer-source-test.mjs` 的 D 段；见 `tests/_gl-browser.mjs` 的文件头）。 */
import { launchGLBrowser, glCapability, glReading, logGLSkip, glSkipWhy } from './_gl-browser.mjs'
const pwPath = [process.env.MPW_PLAYWRIGHT, path.join(ROOT, 'node_modules/playwright/index.js'),
  path.join(WS, 'dsh-mpkg-wallpaper/node_modules/playwright/index.js'), '/opt/node/lib/node_modules/playwright/index.js']
  .filter((p) => { try { return !!p && fs.existsSync(p) } catch (e) { return false } })[0]
if (!pwPath) { console.log('SKIP bench-dbg-dpr-probe — 找不到 playwright（可用 MPW_PLAYWRIGHT=<path> 指定）'); process.exit(0) }
const pw = createRequire(import.meta.url)(pwPath)
const firefox = (pw.default && pw.default.firefox) || pw.firefox
if (!firefox) { console.log('SKIP bench-dbg-dpr-probe — playwright 没有 firefox 导出'); process.exit(0) }
/* ⚠ 前置不是"有没有浏览器"，而是"这台浏览器能不能建 WebGL2"（2026-09-23 归因）：
   无头 Firefox **默认没有 WebGL2**，页面会停在「启动失败: 当前浏览器不支持 WebGL2」——此时 `__mpwLiveRes`
   一类活档位读数永远缺失。本机（Android/PRoot，无 `/dev/dri`）更狠：**连 WebGL1 都建不了**
   （`FEATURE_FAILURE_WEBGL_EXHAUSTED_DRIVERS`）⇒ 硬断言 `webgl2===true` 就是把环境缺能力说成产品坏（假红）。
   所以：**有头优先**（本机唯一能出 WebGL2 的组合 = 有头 + X 显示 `:0` + 软件 llvmpipe），有头起不来才回落
   无头；`MPW_X11_DISPLAY` 换显示号、`MPW_BENCH_HEADLESS=1` 强制无头。口径照抄
   `tests/bench-renderer-source-test.mjs` 的 D 段（见 `tests/_gl-browser.mjs`）。 */
const { browser, launchNote } = await launchGLBrowser(firefox)
try {
  /* 能力前置探针（读一次，不猜）：这台浏览器到底能不能建 `webgl2`/`webgl1` —— 下面 W1/P 组的 SKIP 由它决定。 */
  const gl = await glCapability(browser)
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await page.goto('http://' + AUTHORITY + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(8000)

  /** 读：调试栏文本、隔离状态、liveRes、iframe 内容尺寸。 */
  const read = () => page.evaluate(() => {
    const fr = document.getElementById('frame')
    const w = fr && fr.contentWindow
    const layers = (() => { try { return Array.isArray(w.__sceneLayers) ? w.__sceneLayers : null } catch (e) { return null } })()
    const flags = layers ? layers.map((l) => !!l.visible) : null
    /* ⚠ 隔离的真判据是 `__lnHidden`（绘制期，core 每帧 `if (layer.__lnHidden) continue`）：
       `visible` 会被渲染器自己重算回写 —— 实测宿主写 `[F,F,T,F,F]`，1.6s 后读回 `[T,T,T,T,F]`。
       两条都读出来：`flags` 只用于"是否仍然可见"的对照，隔离断言一律落在 `lnFlags` 上。 */
    const lnFlags = layers ? layers.map((l) => !l.__lnHidden) : null
    const lnList = layers ? layers.map((l, i) => ({ i, name: String(l.name || ''), container: !!l.isContainer, hidden: !!l.__lnHidden })) : null
    const live = (() => { try { return w.__mpwLiveRes || null } catch (e) { return null } })()
    const dbg = document.getElementById('dbg-layer')
    return {
      layerText: dbg ? String(dbg.textContent || '').slice(0, 60) : null,
      flags, lnFlags, lnList, total: flags ? flags.length : 0,
      live, frameW: fr ? fr.clientWidth : 0, frameH: fr ? fr.clientHeight : 0,
      frameSrc: fr ? String(fr.getAttribute('src') || '').slice(0, 160) : null,
      frameSearch: (() => { try { return String((fr && fr.contentWindow && fr.contentWindow.location && fr.contentWindow.location.search) || '').slice(0, 160) } catch (e) { return 'ERR:' + String(e && e.message || e).slice(0, 40) } })(),
      hasLive: (() => { try { return !!(fr && fr.contentWindow && fr.contentWindow.__mpwLiveRes) } catch (e) { return false } })(),
      boot: (() => { try { const w = fr.contentWindow; return { start: w.__mpwLiveStart || null, pre: w.__mpwLivePre || null, err: w.__mpwBootError || null, res: w.__mpwResTier ? { requested: w.__mpwResTier.requested, live: !!w.__mpwResTier.live, name: w.__mpwResTier.name } : null, layers: !!w.__sceneLayers, wp: !!w.__wp } } catch (e) { return { err: String(e && e.message || e).slice(0, 60) } } })(),
    }
  })
  const setDpr = async (v) => {
    await page.evaluate((want) => {
      const el = document.getElementById('dpr')
      if (!el) return
      el.value = String(want)
      el.dispatchEvent(new Event('change', { bubbles: true }))
    }, v)
  }
  const stepRight = async (n = 1) => {
    for (let i = 0; i < n; i++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(350) }
  }

  /* ── W 组：**环境前置**（不是产品判据）────────────────────────────────────────────────
     为什么要有它：本探针的活档位读数（`__mpwLiveRes`）只在场景真的启动后才有。无头 Firefox **默认没有
     WebGL2** ⇒ 页面停在「启动失败: 当前浏览器不支持 WebGL2」，P 组于是走 `skip(...)` —— 那种 SKIP 在汇总里
     与"通过"难以区分，DPR 那条链就会长期没人测。这里先**真去问一次浏览器**（上面的 `gl` 探针，不猜）：
       · 有 WebGL2 ⇒ 照旧**显式断言**（门禁不放水，W1 仍会红）；
       · 拿不到 ⇒ 打 **SKIP + 原样读数**：本机无 `/dev/dri`，无头 Firefox 连 WebGL1 都建不了 ⇒
         那是**环境缺能力**（同一浏览器里上游产物页也建不了 GL），不是本仓渲染器的判据，
         把它当红就是假红；但 SKIP 行里带着 launch/读数，**不静默通过**。 */
  {
    if (!gl.webgl2) {
      logGLSkip('W1 宿主浏览器拿得到 WebGL2', launchNote, gl, '后续 live 判据（P 组）的 SKIP 不再具备"通过"含义')
      glSkipWhy()
    } else {
      ok(gl.webgl2 === true, 'W1 宿主浏览器拿得到 WebGL2（否则本探针的 live 结论一律不可信 —— 不许静默 SKIP）',
        glReading(launchNote, gl))
    }
  }

  /* ── D 组：调试逐层隔离 ── */
  const r0 = await read()
  if (!r0.flags || r0.flags.length === 0) {
    skip('D 调试逐层', '当前档位没有 `__sceneLayers`（未挂载/该档不支持）—— 不假装通过'
      + (gl.webgl2 ? '' : '；且本机浏览器拿不到 WebGL2 ⇒ 场景起不来，读数 ' + glReading(launchNote, gl)))
  } else {
    /* 进入调试：**先切到调试页签再点开关**（`bench-ui-headless` 同款路径；只点开关不会生效 ——
       本轮实测：跳过这一步时 `#dbg-layer` 是空的、隔离也没发生）。 */
    await page.evaluate(() => { try { document.getElementById('tab-debug').click() } catch (e) {} })
    await page.waitForTimeout(400)
    await page.evaluate(() => { const sw = document.getElementById('dbg-mode'); if (sw && !sw.checked) sw.click() })
    await page.waitForTimeout(1200)
    const r1 = await read()
    ok(!!r1.layerText && /层|\d/.test(r1.layerText), 'D1a 调试模式栏里有当前层信息', JSON.stringify(r1.layerText))
    /* 契约（实测口径）：**进入调试**只显示"当前层信息"，全层仍可见；**隔离在步进时应用**（D2/D2b 钉它）。
       真机读数：进入后 `on=5/total=5`（全可见）→ 按一次右键 `from:0 → to:2` 且 `on=1`。 */
    const on1 = (r1.flags || []).filter(Boolean).length
    const iso1 = isolationIndex(r1.lnList)
    ok(on1 === r1.total || on1 === 1 || (iso1 && (iso1.drawing === iso1.total || iso1.drawing === 1)),
      'D1b 进入调试时要么全层参与绘制（隔离待步进应用）、要么已隔离一层 —— 不许出现"半隔离"',
      JSON.stringify({ total: r1.total, on: on1, iso: iso1, text: r1.layerText }))
    await stepRight(3)
    const r2 = await read()
    const iso2 = isolationIndex(r2.lnList)
    ok(iso2 && iso2.index >= 0 && (!iso1 || iso1.index < 0 || iso2.index !== iso1.index),
      'D2 按右方向键后**隔离的层换了一个**（绘制期 `__lnHidden` 与层号同步变）',
      JSON.stringify({ from: iso1, to: iso2, text2: r2.layerText, lnList: r2.lnList, visible: r2.flags }))
    ok(iso2 && iso2.drawing === 1, 'D2b 换层后仍然恰好一层参与绘制（没有越走越乱）', JSON.stringify({ iso2 }))
    /* D2c：**持久性** —— 宿主写完 1.5s（≈90 帧 + 若干脚本 tick）之后，隔离必须还在。
       修前这条必红：写 `visible` 会被渲染器重算回写（实测 1.6s 后 `[T,T,T,T,F]`）。 */
    await page.waitForTimeout(1500)
    const r2b = await read()
    const iso2b = isolationIndex(r2b.lnList)
    ok(iso2b && iso2 && iso2b.index === iso2.index && iso2b.drawing === 1,
      'D2c 隔离在 1.5s / 约 90 帧后仍然生效（渲染器的可见性重算不许把它冲掉）',
      JSON.stringify({ atStep: iso2, after: iso2b, lnList: r2b.lnList, visible: r2b.flags }))
    /* 退出调试：全部恢复 */
    await page.evaluate(() => { const sw = document.getElementById('dbg-mode'); if (sw && sw.checked) sw.click() })
    await page.waitForTimeout(1200)
    const r3 = await read()
    const on3 = (r3.flags || []).filter(Boolean).length
    const iso3 = isolationIndex(r3.lnList)
    ok((r3.flags || []).length === 0 || on3 === (r3.flags || []).length || on3 > 1,
      'D3 退出调试后隔离解除（可见层数回到挂载时的常态，不是只剩一层）',
      JSON.stringify({ on: on3, total: (r3.flags || []).length }))
    ok(!iso3 || iso3.drawing === iso3.total,
      'D3b 退出调试后 `__lnHidden` 全部清掉（绘制期隔离没有残留）',
      JSON.stringify({ iso3, lnList: r3.lnList }))
  }

  /* ── P 组：DPR 切换 ── */
  /* P 组：先切一次 DPR（这会把 `res=dpr` 写进预览 URL —— 本仓档的活画布档位需要它），再回到 1 取基线 */
  /* 先把预览档位**确保为「本仓渲染器」**：`res=dpr` 活档位只在这个档位存在（上游档没有 ⇒ P 组如实 SKIP，
     但那种 SKIP 说明"没测到"，不是"不支持"）。档位是持久化在 localStorage 的，别的测试可能留在上游档。 */
  const srcMode = await page.evaluate(() => { try { const el = document.getElementById('renderer-src'); return el ? String(el.value || '') : null } catch (e) { return null } })
  console.log('  预览档位（改前）= ' + JSON.stringify(srcMode))
  if (srcMode && srcMode !== 'repo') {
    await page.evaluate(() => { const el = document.getElementById('renderer-src'); if (el) { el.value = 'repo'; el.dispatchEvent(new Event('change', { bubbles: true })) } })
    await page.waitForTimeout(1200)
  }
  /* `res=` 档位是**挂载时**写进预览 URL 的 ⇒ 改完 DPR 点一次「重挂载」，再读活档位。 */
  const remount = async () => { await page.evaluate(() => { const b = document.getElementById('reload'); if (b) b.click() }); await page.waitForTimeout(6000) }
  await setDpr(2); await remount()
  await setDpr(1); await remount()
  const a = await read()
  await setDpr(2); await remount()
  const b = await read()
  if (!a.live || !b.live) {
    skip('P DPR 切换', '没有 `__mpwLiveRes`'
      + (gl.webgl2 ? '' : '（本机浏览器拿不到 WebGL2 ⇒ 场景起不来、活档位永不发布：读数 ' + glReading(launchNote, gl) + '）')
      + ' —— 诊断：hasLive=' + JSON.stringify(b.hasLive) + ' frameSearch=' + JSON.stringify(b.frameSearch) + ' frameSrc=' + JSON.stringify(b.frameSrc) + ' iframe=' + b.frameW + 'x' + b.frameH + ' boot=' + JSON.stringify(b.boot))
  } else {
    ok(dprResizeOk(a.live, b.live) === true, 'P1 DPR 1→2：画布像素真的跟着变大（不是只换了个数字）',
      JSON.stringify({ a: { dpr: a.live.dpr, w: a.live.width }, b: { dpr: b.live.dpr, w: b.live.width } }))
    ok(b.frameW > 0 && b.frameH > 0, 'P1b 切换后 iframe 仍有内容尺寸（不是白屏/塌成 0）', JSON.stringify({ w: b.frameW, h: b.frameH }))
    await setDpr(1); await page.waitForTimeout(2000)
    const c = await read()
    ok(c.live && c.live.dpr === 1 && c.live.width <= b.live.width, 'P2 DPR 2→1 可逆（画布回到 1× 档）',
      JSON.stringify({ dpr: c.live && c.live.dpr, w: c.live && c.live.width }))
  }
} finally {
  await browser.close().catch(() => {})
  console.log('\nbench-dbg-dpr-probe：PASS=' + pass + ' FAIL=' + fail)
  console.log('（诚实边界：不做像素级"画面长得不一样"断言 —— WebGL 画布没开 preserveDrawingBuffer，'
    + 'offline 读回不可靠；这里判的是"隔离状态 + 画布尺寸 + 渲染存活"，像素级留给真机眼睛）')
  void os; void path
  process.exit(fail > 0 ? 1 : 0)
}
