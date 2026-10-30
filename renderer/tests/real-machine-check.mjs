#!/usr/bin/env node
// real-machine-check.mjs —— ①(§5-⑧ 2026-09-17「回归自动化：把真机验证里能自动化的部分全自动化」)
//
// 这条线的目标只有一个：**不再靠人肉点**。真机验证里"必须用眼/用手"的部分（画面对不对、
// 磨砂注入是否被合成、时间线可见性是否符合作者意图）留人工（清单见 docs/REAL-MACHINE-AUTOMATION.md §4），
// 但**面板冒烟 / 属性变更 / 壁纸切换 / 日志区收纳**这些"结构可判定"的部分全部自动化 —— 就是本脚本。
//
// 被测对象：**http://127.0.0.1:8899/**（`server/we-scene-demo-server.mjs`）。
//   ⚠ 任务书里写的 `http://127.0.0.1:8899/demo.html` **实测是 404**（`server/we-scene-demo-server.mjs:366-371`
//   只登记了 `p === '/' || p === '/index.html'`，两者都读仓库根的 `demo.html` 字节流）——
//   所以 8899 的"落地页"与"渲染器 demo 页"是**同一个字节流、两个 URL**。本脚本用 `/`，
//   并把 "`/demo.html` 仍是 404" 作为**信息**记录（不是断言：免得以后真加了路由反而变红）。
//
// 三个靶子：
//   A 落地页 `/`                          —— 服务/字节/模块启动/无报错/日志区收纳（与包无关）
//   B 自带合成样例 `?id=sample-synthetic`  —— 场景解析/属性面板/属性变更/面板开合（仓库自带，不依赖语料）
//   C 第二份包（语料里有就切，没有就记 null）—— 壁纸切换耗时（整页导航口径）
//
// 断言口径：**只用 DOM / computed style / localStorage / 页面自己的句柄**，不做像素对比
//   （本机无 GPU：`backdrop-filter` 不合成、WebGL2 直接拿不到 ⇒ 像素类断言在这里必假红）。
//   复用既有契约，不另造口径：
//     · `tests/log-panel-collapse-test.mjs`（Q8b/8c/8d/8f/8g/8h/8i/8j/8k/8l/8m/8s/8t）—— 日志区默认 35vh、
//       箭头 ▾/▴ 翻转、`localStorage['mpw-log-h']`、End/Enter 键盘、拖动改比例
//     · `tests/props-panel-test.mjs`（T6 持久化）—— `localStorage['mpw-props:<id>']` + `window.__mpwProps`
//     · `tests/fullscreen-recenter-test.mjs` —— ⚠ 它**不是**"全屏按钮"测试，是"近整屏层 origin 兜底"的
//       纯函数测试；页面里**没有**全屏按钮（`grep -c requestFullscreen demo.html` = 0）
//     · `tests/baseline-test.mjs` / `core/baseline-metrics.mjs` —— 报告字段路径与基线快照同源
//       （`startup.totalMs` / `fps.median` / `switch.swapTo.ms` / `vramProxy.textureBytesEst`），
//       好让 `tests/baseline-trend.mjs` 用**同一套** `tools/baseline-diff.mjs` 阈值对拍。
//
// 用法：
//   node tests/real-machine-check.mjs                 # 默认打 8899
//   node tests/real-machine-check.mjs --url=http://127.0.0.1:8899
//   node tests/real-machine-check.mjs --json          # 末尾追加机读汇总
//   node tests/real-machine-check.mjs --no-report     # 不写 reports/real-machine/*.json（调试用）
//   node tests/real-machine-check.mjs --require       # 「无浏览器/无服务」也判 FAIL（默认按条件项 SKIP）
// 退出码：0 = 全绿（含条件项 SKIP）；1 = 有断言失败；2 = 用法错误。
// 条件项约定（与 `jpeg-decode` 同口径）：不可用时**第一行**打印 `SKIP real-machine-check …` 并退出 0。
import { AUDIO_MUTE_PREFS } from './_audio-mute.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')  // 仓库根
const REPO_ROOT = path.resolve(ROOT, '..')                                     // 工作区根（MPW_ROOT 的语义）
const NAME = 'real-machine-check'
const argv = process.argv.slice(2)
const flag = (n) => argv.includes('--' + n)
const opt = (n, d) => { const h = argv.find((a) => a.startsWith('--' + n + '=')); return h ? h.slice(n.length + 3) : d }
const badArg = argv.find((a) => !/^--(url|out)=/.test(a) && !/^--(json|no-report|require|help)$/.test(a))
if (badArg) {
  console.error('未知参数：' + badArg)
  console.error('用法：node tests/real-machine-check.mjs [--url=http://127.0.0.1:8899] [--json] [--no-report] [--require]')
  process.exit(2)
}
if (flag('help')) { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 46).join('\n')); process.exit(0) }

const BASE = opt('url', 'http://127.0.0.1:8899').replace(/\/+$/, '')
const JSON_OUT = flag('json')
const REQUIRE = flag('require')
const WRITE_REPORT = !flag('no-report')
const SAMPLE_ID = process.env.MPW_RM_SAMPLE_ID || 'sample-synthetic'  // 仓库自带合成样例：不依赖本机语料
//   （env 覆盖只为自测/排障：`MPW_RM_SAMPLE_ID=0000000000` 应让本脚本**变红**，用来证明断言真的会红）
const SECOND_IDS = ['3554161528', '3327063360', '3719111841']   // 语料里挑一个当"另一个壁纸"（切包用）
const VIEWPORT = { width: 1280, height: 800 }                   // ⚠ 见 docs/REAL-MACHINE-AUTOMATION.md §5：
//   窄窗口下属性面板（fixed top:38px left:8px width:min(360px,42vw)）会盖住 `#bar` 折行后的 ⚙ 按钮 ⇒ 点不到。
//   1280 宽时按钮在 x≈490、面板只到 x≈368，互不遮挡 —— 这是**测试靶子的取景**，不是产品断言。
// 浏览器模块解析顺序：`MPW_PLAYWRIGHT` 一旦设置就**只认它**（排障/自测用），否则按"工作区自带的
// playwright → 全局 playwright"依次试（本机就是第一个）。
const PLAYWRIGHT = process.env.MPW_PLAYWRIGHT
  ? [process.env.MPW_PLAYWRIGHT]
  : [path.join(REPO_ROOT, 'dsh-mpkg-wallpaper/node_modules/playwright/index.mjs'), 'playwright']
const PAGE_TIMEOUT = Number(process.env.MPW_RM_TIMEOUT || 25000)      // 等「日志到终态」的上限
// 等 `__mpwModuleStarted` 的上限：正常 ~1s；断了就早点判红，别把整条门禁拖成分钟级
//   （实测：模块图断掉时若沿用 25s，本脚本会跑 ~4 分钟才收尾 —— 见 docs/REAL-MACHINE-AUTOMATION.md §3）
const MODULE_WAIT = Number(process.env.MPW_RM_MODULE_WAIT || 12000)
const MAX_REPORTS = 50                    // reports/real-machine 只留最新 50 份（很小，但别无限长）
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-rm-'))
process.on('exit', () => { try { fs.rmSync(SCRATCH, { recursive: true, force: true }) } catch (e) { /* ignore */ } })

const checks = []
const push = (group, name, ok, detail) => { checks.push({ group, name, ok: !!ok, detail: detail === undefined ? '' : String(detail) }) }
const notes = []
const skips = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const rm = (s) => String(s).replace(BASE, '')

/** 「已知良性 404」白名单：每条必须写清"为什么良性"+"证据"。**只有真的良性才进这里。** */
export const BENIGN_404 = [
  {
    re: /^\/refrender\/[^/]+$/,
    why: '官方标定 refrender 采样：可选诊断产物，取不到只是"没有对照数据"，页面继续建档 ⇒ 良性',
    evidence: '本机实测 `/` 与 `/?id=sample-synthetic` 都 404 这一条，而日志继续走到 `scene.json 解析: N layers`、0 pageerror/0 console error；仓内对照件是**离线文件** `ref-render-3719111841.json`，不经该 URL',
  },
  {
    re: /^\/favicon\.ico$/,
    why: '浏览器自动请求站点图标；demo.html 没有 <link rel=icon>，页面不依赖它（取不到只是标签页没图标，不影响渲染/建档）',
    evidence: '①2026-09-23 起 :8899 **有**这条路由：`web/pwa-inject.mjs` 的 PWA_ROUTES 把品牌图 32×32 发在 `/favicon.ico`，`tests/pwa-test.mjs` F6 对真服务断言 200 + `image/png`；②本条目按"纵深防御"保留：更早的构建（或没带 `web/icons/brand-32.png` 的部署）仍会 404，而该请求**一定是浏览器自发**、与页面行为无关',
  },
  {
    re: /^\/weassist\//,
    why: '包外资产三级回退链的第二级（本机 WE 安装目录 /weassist/<basename>）：命中不到就落第三级（sans-serif / 内置材质），是**契约内**的失败',
    evidence: 'tests/text-font-fallback-test.mjs：「404·reject·空体都不抛异常且落第三级」；开关表见 docs/README-DIAGNOSTICS.md',
  },
]
/**
 * 分类一条失败请求：`{allow:true, why, kind}` 或 `{allow:false}`。
 * `/pkg/<id>` **只在页面自己已报「包 404」时**才放行（语料缺失＝环境事实，不是渲染器回归）。
 */
export function classifyFailure(pathname, logText) {
  for (const e of BENIGN_404) if (e.re.test(pathname)) return { allow: true, why: e.why, kind: 'benign-404' }
  const m = /^\/pkg\/([^/]+)$/.exec(pathname)
  if (m && logText && logText.indexOf('pkg HTTP 404（id=' + m[1]) >= 0) {
    return { allow: true, why: '测试机语料里没有这个包（页面已明确报 404 并优雅收尾）', kind: 'corpus-absent' }
  }
  return { allow: false }
}

// ── 汇总 ─────────────────────────────────────────────────────────────────────
function finish(report, code) {
  const failed = checks.filter((c) => !c.ok)
  console.log('')
  console.log('══ real-machine-check：' + (checks.length - failed.length) + '/' + checks.length + ' 通过'
    + (skips.length ? '，' + skips.length + ' 条件项跳过' : '') + (failed.length ? '，' + failed.length + ' 失败' : ''))
  for (const s of skips) console.log('   – SKIP ' + s)
  for (const f of failed) console.log('   ✗ ' + f.group + ' / ' + f.name + (f.detail ? '  — ' + f.detail : ''))
  for (const n of notes) console.log('   · ' + n)
  if (JSON_OUT) {
    console.log(JSON.stringify({
      name: NAME, ok: failed.length === 0, base: BASE,
      counts: { total: checks.length, passed: checks.length - failed.length, failed: failed.length, skipped: skips.length },
      failed: failed.map((f) => ({ group: f.group, name: f.name, detail: f.detail })),
      skipped: skips, report: report ? report.file : null, notes,
    }))
  }
  process.exit(code)
}

// ── 0. 前置：服务 / 浏览器（不可用 → SKIP，条件项约定）────────────────────────
async function probeServer() {
  try {
    const r = await fetch(BASE + '/', { signal: AbortSignal.timeout(5000) })
    return { ok: r.status === 200, status: r.status, body: r.ok ? await r.text() : '' }
  } catch (e) { return { ok: false, status: 0, error: (e && e.message) || String(e), body: '' } }
}
async function loadPlaywright() {
  for (const spec of PLAYWRIGHT) {
    try { return await import(/^[a-z@]/.test(spec) && !spec.includes('/') ? spec : pathToFileURL(path.resolve(spec)).href) } catch (e) { /* 试下一个 */ }
  }
  return null
}

const srv = await probeServer()
if (!srv.ok) {
  const why = '服务不可用：' + BASE + '/ → ' + (srv.status || srv.error)
  if (REQUIRE) { push('precondition', 'server', false, why); console.log('✗ ' + why); finish(null, 1) }
  console.log('SKIP ' + NAME + '（' + why + '）')
  console.log('起服务：cd <仓库根> && node server/we-scene-demo-server.mjs 8899（条件项：无服务按 SKIP 计，门禁不红）')
  process.exit(0)
}
const pw = await loadPlaywright()
if (!pw) {
  const why = '找不到 Playwright（试过：' + PLAYWRIGHT.join(' / ') + '）'
  if (REQUIRE) { push('precondition', 'playwright', false, why); console.log('✗ ' + why); finish(null, 1) }
  console.log('SKIP ' + NAME + '（' + why + '）')
  console.log('可用 MPW_PLAYWRIGHT=<playwright/index.mjs 绝对路径> 指定；条件项：无浏览器按 SKIP 计，门禁不红。')
  process.exit(0)
}

// ── 服务侧静态事实（不需要浏览器）──────────────────────────────────────────
const servedBytes = Buffer.from(srv.body, 'utf8')
const diskHtml = fs.readFileSync(path.join(ROOT, 'demo.html'))
push('server', 'root-200', srv.status === 200, 'GET ' + BASE + '/ → ' + srv.status)
push('server', 'served-equals-disk-demo-html', servedBytes.equals(diskHtml), '服务 ' + servedBytes.length + 'B vs demo.html ' + diskHtml.length + 'B')
// 夹具（<1MB，退出时必删）：把服务返回的字节落盘再逐字节比对 —— 证明"落地页 = demo.html 字节流"
const servedFixture = path.join(SCRATCH, 'served.html')
fs.writeFileSync(servedFixture, servedBytes)
push('server', 'fixture-byte-identical', fs.readFileSync(servedFixture).equals(diskHtml), '夹具 ' + path.basename(SCRATCH) + '/served.html')
try {
  const r = await fetch(BASE + '/demo.html', { signal: AbortSignal.timeout(5000) })
  notes.push('GET /demo.html → ' + r.status + (r.status === 404
    ? '（任务书写它是 demo 页 URL；实测 404，真正的页面是 `/`，见文件头）'
    : '（任务书里的 URL；本服务对它的状态与 404 不同，但页面口径仍以 `/` 为准 —— 本行只是如实记录）'))
} catch (e) { notes.push('GET /demo.html 探测失败：' + ((e && e.message) || e)) }

// ── 1. 起浏览器（一次一个实例）─────────────────────────────────────────────
let browser = null
let report = null
let logAll = ''            // 各页日志累积（用于 /pkg/ 白名单判据：页面自己报的 404）
const pageErrors = [], consoleErrors = [], failedReq = []
const timings = { navToModuleStartedMs: null, navToSceneParsedMs: null, switchToMs: null, switchToId: null }
let webgl2 = null, ua = '', deviceInfo = {}, surfaces = null, surfacesB = null, layers = null
const allow = [], deny = []

try {
  try { browser = await pw.firefox.launch({ firefoxUserPrefs: { ...AUDIO_MUTE_PREFS }, headless: true }) } catch (e) {
    const why = 'Firefox 启动失败：' + ((e && e.message) || e)
    if (REQUIRE) { push('precondition', 'firefox', false, why); console.log('✗ ' + why); finish(null, 1) }
    console.log('SKIP ' + NAME + '（' + why + '）')
    console.log('装浏览器：npx playwright install firefox（条件项：无浏览器按 SKIP 计，门禁不红）')
    process.exit(0)
  }
  push('precondition', 'firefox-launched', true, browser.version() + ' @ ' + VIEWPORT.width + 'x' + VIEWPORT.height)
  const ctx = await browser.newContext({ viewport: VIEWPORT })
  const wire = (p) => {
    p.on('pageerror', (e) => pageErrors.push({ url: rm(p.url()), message: String((e && e.message) || e).slice(0, 300) }))
    p.on('console', (m) => { if (m.type() === 'error') consoleErrors.push({ url: rm(p.url()), message: m.text().slice(0, 300) }) })
    p.on('requestfailed', (r) => failedReq.push({ url: rm(r.url()), status: 0, reason: (r.failure() && r.failure().errorText) || 'requestfailed' }))
    p.on('response', (r) => { if (r.status() >= 400) failedReq.push({ url: rm(r.url()), status: r.status, reason: 'HTTP ' + r.status() }) })
  }
  const logTextOf = (p) => p.evaluate(() => (document.getElementById('log') || {}).textContent || '').catch(() => '')
  /** 等日志到终态（建档完成 / 开始渲染 / 启动失败）——比死等固定秒数快，也更准。 */
  async function waitLog(p, re, ms = PAGE_TIMEOUT) {
    const t = Date.now()
    for (;;) {
      const txt = await logTextOf(p)
      logAll += '\n' + txt
      if (re.test(txt)) return { ok: true, txt, ms: Date.now() - t }
      if (Date.now() - t > ms) return { ok: false, txt, ms: Date.now() - t }
      await sleep(80)
    }
  }
  async function open(url) {
    const p = await ctx.newPage(); wire(p)
    const tNav = Date.now()                       // 导航起点：所有耗时口径都相对它（与基线采集器同口径）
    const r = await p.goto(url, { waitUntil: 'load', timeout: PAGE_TIMEOUT })
    await p.waitForFunction(() => !!window.__mpwModuleStarted, null, { timeout: MODULE_WAIT }).catch(() => {})
    const started = await p.evaluate(() => !!window.__mpwModuleStarted).catch(() => false)
    await dismissEnvOverlay(p)                    // ⓪(task-19) 无 GPU 机器上的全屏空态占位会盖住交互元素
    return { p, status: r ? r.status() : 0, tNav, moduleStartedMs: started ? Date.now() - tNav : null }
  }
  /*  ⓪(2026-10-13 task-19) **无 GPU 机器上的环境性遮挡**：demo.html 的空态占位 `#mpw-empty-state`
      在"没有 WebGL2"这一档上显示成 `position:fixed;inset:0;z-index:2147483000;pointer-events:auto`
      的**全屏**元素（`data-mpw-empty="no-webgl"`）—— 这是**产品预期行为**（用户看到"壁纸无法出画：
      本设备/浏览器没有可用的 WebGL2"，而不是一块黑屏），但它会盖住 `#logbar` / 属性面板 / 工具条按钮：
      Playwright 的 hit-test 如实报 `<div id="mpw-empty-state" data-mpw-empty="no-webgl">…</div>
      intercepts pointer events`（2026-10-13 实测），于是本判据里"点一下看反应"的那些断言
      （Q8 开合 / 拖拽、属性面板开合、蒙皮按钮）在无 GPU 机器上**够不着元素** ⇒ 30s 超时抛异常。
      处置：只对**环境分支**（`kind === 'no-webgl'`）用页面自己公开的探针句柄 `__mpwEmptyState.hide()`
      撤掉并进 notes；**其它 kind 不撤**（"取包失败 / 无首帧"是**真信号**，那种情况下后面的红是对的）。
      ⚠ 断言口径一条不动：撤掉的只是"环境遮罩"，被测的仍是 `#logbar` / 面板自己的契约；
      占位本身（"无 GPU 必须明说，不许黑屏"）由 `tests/empty-state-no-black-test.mjs` 判。 */
  async function dismissEnvOverlay(p) {
    /* 先判档：**有** WebGL2 的机器走健康路径（`mpwEmptyStatePlan({hasFrame})` ⇒ show=false，占位永远不显示）
       ⇒ 只查一次、立刻返回，不给健康机器加等待；**没有** WebGL2 ⇒ 空态占位**必然**出现
       （plan 的 `no-webgl` 分支），等它（≤6s，含 7s 看门狗那条路的时间余量）。 */
    const env = await p.evaluate(() => {
      let gpu = null
      try { gpu = !!document.getElementById('sc').getContext('webgl2') } catch (e) { gpu = false }
      const el = document.getElementById('mpw-empty-state')
      return {
        gpu,
        present: !!el,
        kind: el ? String(el.getAttribute('data-mpw-empty') || '') : '',
        visible: !!(el && getComputedStyle(el).display !== 'none'),
        hasHide: !!(window.__mpwEmptyState && typeof window.__mpwEmptyState.hide === 'function'),
      }
    }).catch(() => null)
    if (!env) return { note: 'overlay-state-unreadable' }
    const tries = env.gpu ? 1 : 30
    let last = env
    for (let i = 0; i < tries; i++) {
      if (last.visible && last.kind === 'no-webgl') {
        if (!last.hasHide) {
          notes.push('无 GPU 环境：空态占位（no-webgl）在，但页面没有公开 `__mpwEmptyState.hide()` ⇒ 结构性交互可能够不着元素')
          return last
        }
        await p.evaluate(() => { try { window.__mpwEmptyState.hide() } catch (e) { /* 已撤 */ } })
        if (!notes.some((n) => /先撤掉 demo\.html 的全屏空态占位/.test(n))) {
          notes.push('无 GPU 环境：先撤掉 demo.html 的全屏空态占位（data-mpw-empty=no-webgl，z-index 2147483000）再做结构性交互；'
            + '占位本身由 tests/empty-state-no-black-test.mjs 判')
        }
        return Object.assign({}, last, { dismissed: true })
      }
      if (!last.gpu) {
        if (last.visible && last.kind && last.kind !== 'no-webgl') return last      // 真信号：不撤，让后面的红说话
        if (i === tries - 1) break
        await sleep(200)
        last = await p.evaluate(() => {
          const el = document.getElementById('mpw-empty-state')
          return {
            gpu: false,
            present: !!el,
            kind: el ? String(el.getAttribute('data-mpw-empty') || '') : '',
            visible: !!(el && getComputedStyle(el).display !== 'none'),
            hasHide: !!(window.__mpwEmptyState && typeof window.__mpwEmptyState.hide === 'function'),
          }
        }).catch(() => last)
      } else break
    }
    return Object.assign({}, last, { note: 'overlay-not-shown' })
  }

  // ── A. 落地页 `/`：加载、无报错、日志区收纳（与包无关）───────────────────
  {
    const { p, status, moduleStartedMs } = await open(BASE + '/')
    timings.navToModuleStartedMs = moduleStartedMs
    push('pageA', 'http-status-200', status === 200, 'GET / → ' + status)
    push('pageA', 'module-started', moduleStartedMs !== null,
      '__mpwModuleStarted=true（这条会抓住"import 的文件服务器没路由"⇒ 整页停在 loading…；实测 P-110 的 /puppet-skin.js 就是这样断的）')
    const settled = moduleStartedMs === null ? { ok: false, txt: await logTextOf(p), ms: 0 } : await waitLog(p, /启动失败|开始渲染|首帧/)
    push('pageA', 'boot-reached-terminal-state', settled.ok, moduleStartedMs === null
      ? '模块没启动 ⇒ 不再等终态日志（当前日志 ' + JSON.stringify(settled.txt.slice(0, 60)) + '）' : settled.ms + 'ms 内日志到终态')
    const caps = await p.evaluate(() => (window.__mpwCap ? window.__mpwCap() : null))
    push('pageA', 'cap-handle', !!caps && caps.type === 'mpw-cap' && caps.v === 1, JSON.stringify(caps))
    push('pageA', 'cap-sceneId-empty-without-id', !!caps && String(caps.sceneId) === '', '落地页无 ?id ⇒ sceneId=""（收到 ' + JSON.stringify(caps && caps.sceneId) + '）')
    webgl2 = await p.evaluate(() => { try { return !!document.getElementById('sc').getContext('webgl2') } catch (e) { return false } })
    ua = await p.evaluate(() => navigator.userAgent)
    deviceInfo = await p.evaluate(() => ({ dpr: devicePixelRatio, cores: navigator.hardwareConcurrency || null, canvas: [document.getElementById('sc').width, document.getElementById('sc').height], canvasCss: [document.getElementById('sc').style.width, document.getElementById('sc').style.height] }))
    notes.push('本机 WebGL2=' + webgl2 + (webgl2 ? '' : '（无 GPU ⇒ 页面以 `❌ 启动失败: 当前浏览器不支持 WebGL2` 收尾：**像素/帧率类断言在本机不可做**，见 docs/REAL-MACHINE-AUTOMATION.md §4）'))
    checkSurfaces(await p.evaluate(probeSurfaces), settled.txt)
    await checkLogPanel(p)
    await p.close()
  }

  // ── B. 自带样例包页面：场景解析 / 属性面板 / 属性变更 ─────────────────────
  {
    const urlB = BASE + '/?id=' + SAMPLE_ID
    const { p, status, tNav } = await open(urlB)
    push('pageB', 'http-status-200', status === 200, 'GET /?id=' + SAMPLE_ID + ' → ' + status)
    const modUp = await p.evaluate(() => !!window.__mpwModuleStarted).catch(() => false)
    const settled = modUp ? await waitLog(p, /启动失败|开始渲染|首帧/) : { ok: false, txt: await logTextOf(p), ms: 0 }
    const parsed = (settled.txt.match(/scene\.json 解析: (\d+) layers/) || [])[1]
    layers = parsed ? Number(parsed) : null
    // 口径：**导航** → 日志出现 `scene.json 解析`（不是"等日志函数自身的耗时"）
    timings.navToSceneParsedMs = Number.isFinite(layers) ? (Date.now() - tNav) : null
    push('pageB', 'scene-parsed', Number.isFinite(layers) && layers > 0, '日志 `scene.json 解析: ' + parsed + ' layers`（' + settled.ms + 'ms）')
    const caps = await p.evaluate(() => (window.__mpwCap ? window.__mpwCap() : null))
    push('pageB', 'cap-sceneId-matches', !!caps && String(caps.sceneId) === SAMPLE_ID, 'sceneId=' + JSON.stringify(caps && caps.sceneId))
    push('pageB', 'cap-errors-not-silent', !!caps && (caps.ok || (Array.isArray(caps.errs) && caps.errs.length > 0)), 'cap.ok=' + (caps && caps.ok) + ' errs=' + JSON.stringify(caps && caps.errs) + '（无 GPU 时必须**如实**报错，不许静默 ok:true）')
    const dg = await p.evaluate(() => (window.__mpwProps ? { panel: window.__mpwProps.panel, controls: window.__mpwProps.controls, groups: window.__mpwProps.groups, stored: window.__mpwProps.stored } : null))
    push('pageB', 'props-diag-handle', !!dg && !!dg.panel, 'window.__mpwProps.panel=' + JSON.stringify(dg && dg.panel))
    surfacesB = await p.evaluate(probeSurfaces)           // 页 B 自己的面快照（别拿页 A 的行数冒充）
    const rows = surfacesB.rows
    push('pageB', 'props-rows-rendered', rows >= 1, rows + ' 行渲染（样例包 project.json 的属性表）')
    push('pageB', 'props-default-open', await p.evaluate(() => {
      const el = document.querySelector('div#mpw-props-panel'), btn = document.getElementById('mpw-props-btn')
      if (!el || !btn) return false
      return /(^|\s)open(\s|$)/.test(el.className) && getComputedStyle(el).display === 'block'
        && btn.getAttribute('aria-expanded') === 'true' && localStorage.getItem('mpw-props-open') === null
    }), 'demo.html:3744-3762：localStorage 无记录 ⇒ open=true（默认展开、不写回）')
    // 属性变更：点一个 bool 的**可见控件** → localStorage['mpw-props:<id>'] 记下新值（props-panel-test T6 契约）
    //   ⚠ 真实 input[type=checkbox] 是 Uiverse 口径的"视觉隐藏"控件（opacity:0 / 0×0 / absolute），
    //   可见的是它的父 `<label class="mpw_cb">`（内含 .mpw_checkmark）⇒ **必须点 label**，
    //   直接点 input 会因 not visible 卡住（Playwright 实测）。
    const cbl = p.locator('div#mpw-props-panel label.mpw_cb').first()
    if (await cbl.count()) {
      const cb = cbl.locator('input[type=checkbox]')
      const before = await cb.isChecked()
      await cbl.click(); await sleep(350)
      const after = await cb.isChecked()
      const store = await p.evaluate((id) => { const s = localStorage.getItem('mpw-props:' + id); try { return s ? JSON.parse(s) : null } catch (e) { return 'parse-error' } }, SAMPLE_ID)
      const key = store && typeof store === 'object' ? Object.keys(store).find((k) => store[k] === !before) : null
      push('pageB', 'props-change-flips-ui', after === !before, '勾选框 ' + before + ' → ' + after + '（点 label.mpw_cb）')
      push('pageB', 'props-change-persists', !!key, 'localStorage[mpw-props:' + SAMPLE_ID + ']=' + JSON.stringify(store))
      push('pageB', 'props-change-reaches-model', !!key && await p.evaluate((k) => !!(window.__mpwProps && window.__mpwProps.values && k in window.__mpwProps.values), key), '__mpwProps.values 含改动键 ' + key + '（属性值真的写进模型，不只是存了 localStorage）')
      push('pageB', 'props-diag-reflects-store', await p.evaluate((k) => !!(window.__mpwProps && Array.isArray(window.__mpwProps.stored) && window.__mpwProps.stored.includes(k)), key), '__mpwProps.stored 含改动键 ' + key)
    } else {
      skips.push('pageB/props-change（样例包面板里找不到 label.mpw_cb 勾选控件，' + rows + ' 行）')
    }
    // 面板开合：按钮 → class / display / aria / localStorage 四处同口径
    const readProps = () => p.evaluate(() => {
      const el = document.querySelector('div#mpw-props-panel'), btn = document.getElementById('mpw-props-btn')
      return { cls: el ? el.className : null, d: el ? getComputedStyle(el).display : null, aria: btn ? btn.getAttribute('aria-expanded') : null, ls: localStorage.getItem('mpw-props-open') }
    })
    const clickProps = async () => { try { await p.click('#mpw-props-btn', { timeout: 5000 }) } catch (e) { return String((e && e.message) || e).split('\n')[0] } return '' }
    const err1 = await clickProps(); await sleep(250); const c1 = await readProps()
    const err2 = await clickProps(); await sleep(250); const c2 = await readProps()
    push('propsPanel', 'close-on-click', c1.d === 'none' && !/(^|\s)open(\s|$)/.test(String(c1.cls)) && c1.aria === 'false' && c1.ls === '0', JSON.stringify(c1) + (err1 ? ' 点击报错: ' + err1 : ''))
    push('propsPanel', 'open-on-second-click', c2.d === 'block' && /(^|\s)open(\s|$)/.test(String(c2.cls)) && c2.aria === 'true' && c2.ls === '1', JSON.stringify(c2) + (err2 ? ' 点击报错: ' + err2 : ''))
    await p.close()
    // 刷新后保持（localStorage 契约；此刻 ls='1'）
    const r2 = await open(urlB)
    // 面板是 loadScene 之后才装的 ⇒ 必须等它出现再读（只等 __mpwModuleStarted 太早）
    await r2.p.waitForSelector('div#mpw-props-panel', { timeout: PAGE_TIMEOUT }).catch(() => {})
    const persisted = await r2.p.evaluate(() => {
      const el = document.querySelector('div#mpw-props-panel')
      return { d: el ? getComputedStyle(el).display : null, ls: localStorage.getItem('mpw-props-open'), aria: document.getElementById('mpw-props-btn') ? document.getElementById('mpw-props-btn').getAttribute('aria-expanded') : null }
    })
    push('propsPanel', 'persists-across-reload', persisted.d === 'block' && persisted.ls === '1' && persisted.aria === 'true', JSON.stringify(persisted) + '（上一页点开后 ls=1 ⇒ 重载仍开）')
    await r2.p.close()
    // 工具栏按钮真的改 URL（蒙皮 y 方向切换；整页导航口径）
    const r3 = await open(urlB)
    const skinErr = await r3.p.click('#mpw-skin-toggle', { timeout: 5000 }).then(() => '').catch((e) => String((e && e.message) || e).split('\n')[0])
    if (skinErr) push('pageB', 'skin-toggle-clickable', false, skinErr)
    await sleep(1500)
    const afterUrl = r3.p.url()
    push('pageB', 'skin-toggle-navigates', /skiny=0/.test(afterUrl), '点击后 URL=' + afterUrl)
    const lbl = await r3.p.evaluate(() => (document.getElementById('mpw-skin-state') || {}).textContent || '').catch(() => '')
    push('pageB', 'skin-toggle-label-flips', /\+y/.test(lbl), '#mpw-skin-state=' + JSON.stringify(lbl) + '（demo.html:84-88 的文案契约）')
    await r3.p.close()
  }

  // ── C. 壁纸切换耗时（整页导航口径；语料没第二个包就 SKIP 这一项）───────────
  {
    let second = null
    for (const id of SECOND_IDS) {
      try { const r = await fetch(BASE + '/pkg/' + id, { signal: AbortSignal.timeout(8000) }); if (r.status === 200) { second = id; break } } catch (e) { /* 试下一个 */ }
    }
    if (!second) {
      skips.push('switch/swapTo（本机语料没有第二个包：' + SECOND_IDS.join('/') + ' 的 /pkg/<id> 都非 200）')
    } else {
      const r = await open(BASE + '/?id=' + second)
      const modUpS = await r.p.evaluate(() => !!window.__mpwModuleStarted).catch(() => false)
      const settled = modUpS ? await waitLog(r.p, /启动失败|开始渲染|首帧/) : { ok: false, txt: '', ms: 0 }
      const ok = /scene\.json 解析: \d+ layers/.test(settled.txt)
      timings.switchToMs = Date.now() - r.tNav     // 整页导航口径（与 baseline 的 switch.swapTo.ms 同义）
      timings.switchToId = second
      push('switch', 'swapTo-loads-other-package', ok, '切到 ' + second + '：' + timings.switchToMs + 'ms 内解析完场景（整页导航口径）')
      await r.p.close()
    }
  }

  // ── 收尾：失败请求分类（逐条列清楚）────────────────────────────────────
  for (const f of failedReq) {
    const cls = classifyFailure(new URL(BASE + f.url).pathname, logAll)
    const list = cls.allow ? allow : deny
    const seen = list.find((x) => x.url === f.url && x.status === f.status)
    if (seen) { seen.count++; continue }                      // 同一条失败请求会被重试 ⇒ 归并计数，别刷屏
    list.push(Object.assign({}, f, { count: 1 }, cls.allow ? { why: cls.why, kind: cls.kind } : {}))
  }
  push('errors', 'no-page-error', pageErrors.length === 0, pageErrors.length + ' 条：' + JSON.stringify(pageErrors.slice(0, 3)))
  push('errors', 'no-console-error', consoleErrors.length === 0, consoleErrors.length + ' 条：' + JSON.stringify(consoleErrors.slice(0, 3)))
  push('errors', 'no-unallowlisted-request-failure', deny.length === 0,
    (deny.length ? deny.length + ' 条未放行：' + JSON.stringify(deny.slice(0, 5)) : '0 条未放行') + '；白名单命中 ' + allow.length + ' 条' + (allow.length ? '（' + [...new Set(allow.map((a) => a.kind))].join('/') + '）' : ''))
  push('errors', 'allowlist-documented', BENIGN_404.every((e) => e.why && e.evidence), BENIGN_404.length + ' 条白名单每条都有"为什么良性 + 证据"')

  // ── 报告（机读、很小）──────────────────────────────────────────────────
  const failedChecks = checks.filter((c) => !c.ok)
  report = {
    kind: 'real-machine', schema: 1, at: new Date().toISOString(), id: SAMPLE_ID, url: BASE + '/?id=' + SAMPLE_ID,
    source: 'playwright-firefox-headless', ua,
    device: Object.assign({ viewport: [VIEWPORT.width, VIEWPORT.height] }, deviceInfo),
    webgl2, gpu: !!webgl2,
    // ⚠ 字段路径与 `core/baseline-metrics.mjs` 的快照同源 ⇒ tests/baseline-trend.mjs 能用
    //   tools/baseline-diff.mjs 的**同一套阈值**对拍（不另造口径）。
    startup: {
      navToModuleStartedMs: timings.navToModuleStartedMs,
      navToFirstFrameMs: null, firstFrameToReadyMs: null,
      totalMs: timings.navToSceneParsedMs, readyReason: webgl2 ? 'scene-parsed' : 'scene-parsed(no-webgl2)',
      note: '本机口径：导航→`scene.json 解析: N layers`（无 GPU 永远到不了首帧；有 GPU 的真机数字仍由 ?baseline=1 采集器产出）',
    },
    fps: { median: null, p1Low: null, min: null, max: null, windowMs: 500, note: '无 WebGL2 ⇒ 0 帧；不编造数字' },
    frames: { n: 0, p50: null, p95: null, p99: null, max: null },
    render: { available: false, note: '无 WebGL2 ⇒ 没有渲染帧；render.* 需 ?perf=1 + 真 GPU' },
    counts: { layers: layers === null ? null : layers, propsRows: surfacesB ? surfacesB.rows : null, propsGroups: surfacesB ? surfacesB.groups : null },
    vramProxy: { textureBytesEst: null, note: '浏览器拿不到真实显存（WebGL 无此 API）；无 GPU 时采集器也不产出代理值' },
    switch: timings.switchToMs === null ? { swapTo: null, swapBack: null } : { swapTo: { ms: timings.switchToMs, toId: timings.switchToId }, swapBack: null },
    surfaces, surfacesB,
    checks: { total: checks.length, passed: checks.length - failedChecks.length, failed: failedChecks.map((c) => c.group + '/' + c.name) },
    pageErrors, consoleErrors, failedRequests: deny, allowlistedRequests: allow,
    skipped: skips, notes,
  }
  await ctx.close()
} catch (e) {
  // 任何**未预期**的异常（页面结构变了、选择器点不到…）都记成一条失败断言：
  // 报告照写、汇总照打、退出码 1 —— 不许"崩栈"这种没法机读的失败方式。
  const why = String((e && e.stack) || e).split('\n').slice(0, 3).join(' | ')
  push('runner', 'no-unexpected-exception', false, why)
  /*  ⓪(2026-10-13 task-19) **立刻打印**这条失败 —— 旧写法只 `push()` 进 `checks`，而"报告构建"在 try 内：
      只要异常发生在报告构建**之前**，`report` 就一直是 `null` ⇒ 后面 :408 `report.file=…` 先崩，
      `finish()`（唯一打印 checks 的地方）**根本到不了** ⇒ 门禁日志里只剩一个 TypeError，**真因被吃掉**
      （2026-10-13 实测：日志只有 `Cannot set properties of null (setting 'file')`，没有任何判据读数）。 */
  console.log('✗ runner/no-unexpected-exception  ' + why)
} finally {
  if (browser) await browser.close().catch(() => {})
}

// ── 写盘 + 滚动上限（只动 reports/real-machine，绝不碰 reports/baselines）────
/*  ⓪(2026-10-13 task-19) **写盘前必须确认 `report` 是对象**。
    报告构建（`report = {…}`）在 try 内，而异常可能发生在它**之前**：此时 `report` 仍是 `null`，
    旧写法照样落盘 ⇒ 磁盘上出现 5 字节的 `null`（= `JSON.stringify(null)` 的**完整**产物，不是半截文件），
    下一行 `report.file = …` 立刻 TypeError ⇒ 进程死在 `finish()` 之前：**没有汇总、异常真因也被吃掉**
    （catch 只 `push` 不打印），还连带把 `tests/baseline-trend.mjs` 弄红（"顶层不是 JSON 对象"）。
    现在：不是对象就**不写盘**并打印明确理由；失败本身已由 `runner/no-unexpected-exception` 记账，退出码 1。
    ⚠ 这里**不是**"缺环境就豁免"：SKIP 只留给 try **之前**的前置条件（服务不可达 / 无 Playwright /
    浏览器起不来，见文件上半段）；进了 try 之后的异常都是页面/契约层面的事实 ⇒ **明确 FAIL + 理由**。 */
if (WRITE_REPORT && report && typeof report === 'object' && !Array.isArray(report)) {
  const dir = path.join(ROOT, 'reports', 'real-machine')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, Date.now() + '.json')
  fs.writeFileSync(file, JSON.stringify(report, null, 1) + '\n')
  report.file = path.relative(ROOT, file)
  const all = fs.readdirSync(dir).filter((f) => /^\d+\.json$/.test(f)).sort()
  for (const f of all.slice(0, Math.max(0, all.length - MAX_REPORTS))) fs.unlinkSync(path.join(dir, f))
  console.log('报告：' + report.file + '（' + fs.statSync(file).size + 'B；目录上限 ' + MAX_REPORTS + ' 份，超限删最旧）')
} else if (WRITE_REPORT) {
  console.log('报告未写盘：本次采集在"报告构建"之前就失败了（见上面 ✗ runner/no-unexpected-exception）——'
    + '不落盘、不产生 5 字节的 `null` 半截文件（那会让 baseline-trend 报"顶层不是 JSON 对象"）')
}

/** 页面自评函数（在浏览器里跑；**纯 DOM/computed style**，不碰像素）。 */
function probeSurfaces() {
  const q = (s) => document.querySelector(s)
  const dl = (s) => { const e = q(s); return e ? getComputedStyle(e).display : null }
  const div = q('div#mpw-props-panel')
  return {
    bar: !!q('#bar'), barLinks: q('#bar') ? q('#bar').querySelectorAll('a').length : 0,
    barButtons: q('#bar') ? q('#bar').querySelectorAll('button').length : 0,
    canvas: !!q('#sc'), canvasDisplay: dl('#sc'), canvasPos: q('#sc') ? getComputedStyle(q('#sc')).position : null,
    fps: !!q('#fps'), fpsText: q('#fps') ? q('#fps').textContent.trim() : null,
    log: !!q('#log'), logOverflow: q('#log') ? getComputedStyle(q('#log')).overflow : null, logChars: q('#log') ? q('#log').textContent.length : 0,
    logbar: !!q('#logbar'), arrow: q('#logarrow') ? q('#logarrow').textContent : null,
    tip: q('#logtip') ? q('#logtip').textContent : null,
    barAria: q('#logbar') ? q('#logbar').getAttribute('aria-expanded') : null,
    skinBtn: !!q('#mpw-skin-toggle'), skinState: q('#mpw-skin-state') ? q('#mpw-skin-state').textContent : null,
    propsBtn: !!q('#mpw-props-btn'), propsDiv: !!div,
    propsDivCls: div ? div.className : null, propsDivDisplay: dl('div#mpw-props-panel'),
    propsBtnAria: q('#mpw-props-btn') ? q('#mpw-props-btn').getAttribute('aria-expanded') : null,
    rows: document.querySelectorAll('div#mpw-props-panel .row').length,
    groups: document.querySelectorAll('div#mpw-props-panel .grp').length,
    audioBtn: !!q('#mpw-audio-btn'), audioPanel: !!q('div#mpw-audio-panel'),
    fullscreenCtl: !!(q('[id*=fullscreen]') || q('[class*=fullscreen]') || q('[title*=全屏]')),
    themeCtl: !!(q('[id*=theme]') || q('[class*=theme]') || q('[title*=主题]')),
  }
}
/** 关键交互面：存在性 + 它们在页面上的真实形态（表格来源，不猜）。 */
function checkSurfaces(s, logTxt) {
  surfaces = s
  push('surface', 'toolbar', s.bar && s.barLinks >= 6, '#bar 存在：' + s.barLinks + ' 个链接 + ' + s.barButtons + ' 个按钮')
  push('surface', 'canvas-fixed', s.canvas && s.canvasPos === 'fixed' && s.canvasDisplay === 'block', '#sc position=' + s.canvasPos + ' display=' + s.canvasDisplay + ' 画布=' + JSON.stringify(deviceInfo.canvas))
  push('surface', 'fps-indicator', s.fps, '#fps=' + JSON.stringify(s.fpsText) + '（无 GPU 时恒为 "--"：只断言存在，不断言数值）')
  push('surface', 'log-area', s.log && s.logOverflow === 'auto', '#log overflow=' + s.logOverflow + '（Q8e 契约）+ ' + logTxt.length + 'B 文本')
  push('surface', 'log-area-has-text', logTxt.length > 0, '日志非空（' + logTxt.split('\n').filter(Boolean).length + ' 行）')
  push('surface', 'log-handle', s.logbar && s.arrow === '▾' && s.barAria === 'true', 'Q8d/Q8f：箭头 ' + s.arrow + ' / aria-expanded=' + s.barAria)
  push('surface', 'skin-toggle', s.skinBtn && /skiny=默认/.test(s.skinState || ''), JSON.stringify(s.skinState))
  push('surface', 'props-button', s.propsBtn && s.barButtons >= 2, '#mpw-props-btn 已装进 #bar（demo.html:3761）')
  push('surface', 'props-panel-div', s.propsDiv && s.rows >= 1, 'div#mpw-props-panel：' + s.rows + ' 行 / ' + s.groups + ' 分组')
  notes.push('🔊 音频面板：' + (s.audioBtn ? 'present' : 'absent')
    + '（无 GPU ⇒ 启动在装音频面板之前就收尾；音轨枚举那一半由 tests/audio-panel-test.mjs / audio-panel-real-test.mjs 覆盖，真机点击见 docs/REAL-MACHINE-AUTOMATION.md §4 #5）')

  push('surface', 'fullscreen-absent', !s.fullscreenCtl, 'grep -c requestFullscreen demo.html = 0 ⇒ 页面**没有**全屏按钮（如实记录，不判失败；任务书里的 fullscreen-recenter-test 是"近整屏层兜底"的纯函数测试）')
  push('surface', 'theme-absent', !s.themeCtl, '页面**没有**主题切换控件（demo.html 全文件无 theme 控件；如实记录，不判失败）')
}
/** 日志区收纳：复用 log-panel-collapse-test 的 Q8 契约在真 DOM 上钉一遍。 */
async function checkLogPanel(p) {
  const H = VIEWPORT.height
  const l0 = await p.evaluate(() => ({ h: getComputedStyle(document.getElementById('log')).height, bottom: getComputedStyle(document.getElementById('logbar')).bottom, arrow: document.getElementById('logarrow').textContent, api: window.__mpwLogPanel.state() }))
  push('logPanel', 'default-35vh', Math.abs(parseFloat(l0.h) - H * 0.35) <= 1, 'Q8b：' + l0.h + '（期望 ' + H * 0.35 + 'px）')
  push('logPanel', 'handle-bottom-follows-log', l0.bottom === l0.h, 'Q8c：bar.bottom=' + l0.bottom)
  await p.click('#logbar'); await sleep(250)
  const l1 = await p.evaluate(() => ({
    h: getComputedStyle(document.getElementById('log')).height, d: getComputedStyle(document.getElementById('log')).display,
    arrow: document.getElementById('logarrow').textContent, cls: document.getElementById('logbar').className,
    bottom: getComputedStyle(document.getElementById('logbar')).bottom, ls: localStorage.getItem('mpw-log-h'),
    api: window.__mpwLogPanel.state(),
  }))
  push('logPanel', 'collapse-on-click', l1.h === '0px' && l1.d === 'none', 'Q8g：height=' + l1.h + ' display=' + l1.d)
  push('logPanel', 'collapsed-pill', l1.bottom === '0px' && /(^|\s)collapsed(\s|$)/.test(l1.cls), 'Q8h：bottom=' + l1.bottom + ' class=' + JSON.stringify(l1.cls))
  push('logPanel', 'arrow-flips-up', l1.arrow === '▴', 'Q8i：箭头 ▾ → ' + l1.arrow)
  push('logPanel', 'persists-collapsed', l1.ls === 'collapsed' && l1.api.collapsed === true, 'Q8j：localStorage[mpw-log-h]=' + JSON.stringify(l1.ls))
  await p.click('#logbar'); await sleep(250)
  const l2 = await p.evaluate(() => ({ h: getComputedStyle(document.getElementById('log')).height, d: getComputedStyle(document.getElementById('log')).display, arrow: document.getElementById('logarrow').textContent, api: window.__mpwLogPanel.state() }))
  push('logPanel', 'expand-on-click', parseFloat(l2.h) > 0 && l2.d !== 'none' && l2.arrow === '▾' && l2.api.collapsed === false, 'Q8k：' + l2.h + ' / 箭头 ' + l2.arrow)
  await p.focus('#logbar')
  await p.keyboard.press('End'); await sleep(250)
  const k1 = await p.evaluate(() => ({ h: getComputedStyle(document.getElementById('log')).height, api: window.__mpwLogPanel.state() }))
  await p.keyboard.press('Enter'); await sleep(250)
  const k2 = await p.evaluate(() => ({ h: getComputedStyle(document.getElementById('log')).height, api: window.__mpwLogPanel.state() }))
  push('logPanel', 'keyboard-end-collapses', k1.h === '0px' && k1.api.collapsed === true, 'Q8s：End → ' + k1.h)
  push('logPanel', 'keyboard-enter-expands', parseFloat(k2.h) > 0 && k2.api.collapsed === false, 'Q8t：Enter → ' + k2.h)
  const box = await p.locator('#logbar').boundingBox()
  await p.mouse.move(box.x + 400, box.y + 8); await p.mouse.down()
  await p.mouse.move(box.x + 400, box.y + 8 - 100, { steps: 6 }); await p.mouse.up(); await sleep(250)
  const d1 = await p.evaluate(() => ({ h: parseFloat(getComputedStyle(document.getElementById('log')).height), ls: Number(localStorage.getItem('mpw-log-h')) }))
  push('logPanel', 'drag-up-grows', d1.h > parseFloat(k2.h) + 50, 'Q8l：' + k2.h + ' → ' + d1.h + 'px（上拖 100px）')
  push('logPanel', 'drag-saves-fraction', Number.isFinite(d1.ls) && Math.abs(d1.ls - d1.h / H) <= 0.005, 'Q8m：localStorage[mpw-log-h]=' + d1.ls + '（≈' + (d1.h / H).toFixed(3) + '）')
}

finish(report, checks.some((c) => !c.ok) ? 1 : 0)
