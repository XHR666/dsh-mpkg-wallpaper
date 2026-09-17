#!/usr/bin/env node
/**
 * bs-compat-probe.mjs —— better-sidebar 适配的**真机 DOM 探针**（无头 Firefox + DSH 会话 Cookie）
 *
 * 为什么需要它（2026-09-17 第 1 项「壁纸插件对 better-sidebar 的适配」）：
 *   我们的 bsCompat 规则全部挂在 `[data-dsh-better-sidebar]` 作用域 + CSS Modules 类名子串
 *   （`[class*="_bottomPanel"]` 等）上，而 better-sidebar 的类名前缀是构建期哈希、DOM 结构
 *   随版本变（0.19 起右列交还 DSH 原生侧栏、旧浮窗被删除）。**能不能匹配到**只有真实页面能回答：
 *   本脚本把真实 DSH 页面加载进无头 Firefox，逐一数出这些选择器命中了几个元素、
 *   body 上有没有 `data-mpw-bs-version`，并取宿主 /ping 的实际应答。
 *
 * 用法（可复跑）：
 *   node tools/hdr-probe-mint-cookie.mjs --authority 127.0.0.1:3080 --out /tmp/ffprobe/cookie.json
 *   node tools/bs-compat-probe.mjs --label before
 *   node tools/bs-compat-probe.mjs --url http://127.0.0.1:36311/?token=… --cookie /tmp/ffprobe-probe/cookie.json --label after
 *
 * 参数：
 *   --url <u>      目标 URL（默认 http://127.0.0.1:3080/）
 *   --cookie <f>   Cookie JSON（默认 /tmp/ffprobe/cookie.json，格式 {name,value}）
 *   --out <dir>    证据目录（默认 tools/probe-out/）
 *   --label <s>    证据标签（默认 before）
 *   --wait <ms>    额外等待（默认 2500；页面加载后等插件 effect 跑完）
 *   --headed       非无头（调试用）
 *
 * 输出：<out>/bs-compat-<label>.json + .txt（人读一屏）
 * 纪律：只读页面（不改任何 DOM）；每次只开一个无头浏览器，跑完立刻关闭。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(here, '..')
const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
const URL0 = arg('url', 'http://127.0.0.1:3080/')
const COOKIE_FILE = arg('cookie', '/tmp/ffprobe/cookie.json')
const OUT_DIR = path.resolve(ROOT, arg('out', 'tools/probe-out'))
const LABEL = arg('label', 'before')
const WAIT_MS = Number(arg('wait', '2500'))
const HEADED = argv.includes('--headed')
// --settings '<json>'：把外观设置（bsCompat/bsFloat/bsReveal/bsAlpha…）预置进插件 localStorage，
//   这样探针能验证"bsCompat 规则**确实被生成**、并且**确实绑到该版本的 DOM 锚点**上"。
//   （不预置时 bsCompat 默认关 → 我们一条规则都不进页面，探针只能看到"没规则"这种空结论。）
const SETTINGS = (() => { try { return arg('settings', '') ? JSON.parse(arg('settings', '')) : null } catch (e) { console.error('✗ --settings 不是合法 JSON: ' + e.message); process.exit(2) } })()
// --synthetic：在真实页面里往 **[data-dsh-better-sidebar] 子树**插一个合成面板（用该版本产物里
//   真实存在的 CSS Modules 类名后缀），读 computed 值 ⇒ 证明我们的选择器与该版本类名仍能匹配。
//   只在探针实例上跑（插完即删），不影响任何常驻进程。
const SYNTHETIC = argv.includes('--synthetic')

/** 页内采集（纯读）：数选择器命中数 + 取 body 属性 + 宿主 /ping 应答。 */
function pageCollector() {
  const n = (s) => { try { return document.querySelectorAll(s).length } catch { return -1 } }
  const cls = (el) => String((el && el.className) || '').split(/\s+/).filter(Boolean).slice(0, 2).join('.')
  return (async () => {
    const styles = [...document.querySelectorAll('style')].map((s) => s.textContent || '')
    const mpw = styles.filter((t) => t.indexOf('mpw') >= 0 || t.indexOf('data-mpw') >= 0)
    const ping = await fetch('/api/mpkg-wallpaper/ping', { credentials: 'same-origin' })
      .then((r) => r.json()).catch((e) => ({ error: String(e && e.message || e) }))
    const roots = [...document.querySelectorAll('[data-dsh-better-sidebar]')]
    const panelHosts = [...document.querySelectorAll('[data-dsh-panel-host]')]
    return {
      href: location.href.replace(/token=[^&]*/, 'token=<redacted>'),
      bodyBsVersion: document.body.getAttribute('data-mpw-bs-version'),
      bodyAttrs: [...document.body.attributes].map((a) => a.name).filter((k) => k.indexOf('mpw') >= 0).sort(),
      ping,
      counts: {
        bsRoot: n('[data-dsh-better-sidebar]'),
        panelHost: n('[data-dsh-panel-host]'),
        panelHostDegraded: n('[data-dsh-panel-host-degraded]'),
        panel: n('[data-dsh-panel]'),
        pane: n('[data-dsh-pane]'),
        bottomPanel: n('[data-dsh-bottom-panel]'),
        bottomToggle: n('[data-dsh-bottom-toggle]'),
        floatWindow: n('[data-dsh-float-window]'),
        versionGateHit: n('body[data-mpw-bs-version]'),
        scopeBottomPanelClass: n('[data-dsh-better-sidebar] [class*="_bottomPanel"]'),
        scopePanelClass: n('[data-dsh-better-sidebar] [class*="_panel"]'),
        scopePaneClass: n('[data-dsh-better-sidebar] [class*="_pane"]'),
        scopeTabBarClass: n('[data-dsh-better-sidebar] [class*="_tabBar"]'),
        scopeTerminalWrapClass: n('[data-dsh-better-sidebar] [class*="_terminalWrap"]'),
        scopeEditorHeaderClass: n('[data-dsh-better-sidebar] [class*="_editorHeader"]'),
        scopeBrowserBarClass: n('[data-dsh-better-sidebar] [class*="_browserBar"]'),
        scopeAddBarClass: n('[data-dsh-better-sidebar] [class*="_addBar"]'),
        bsSettingsNav: n('[data-dsh-better-sidebar-settings-nav]'),
      },
      bsRootClasses: roots.map(cls).slice(0, 4),
      panelHostBoxes: panelHosts.slice(0, 4).map((el) => {
        const cs = getComputedStyle(el)
        return { cls: cls(el), position: cs.position, zIndex: cs.zIndex, bg: cs.backgroundColor, transform: (el.style && el.style.transform) || '', rect: (({ x, y, width, height }) => ({ x, y, width, height }))(el.getBoundingClientRect()) }
      }),
      mpwStyles: {
        total: styles.length,
        ours: mpw.length,
        hasBsCompatScope: mpw.some((t) => t.indexOf('[data-dsh-better-sidebar]') >= 0),
        hasVersionGate: mpw.some((t) => t.indexOf('data-mpw-bs-version') >= 0),
        hasBottomPanelRule: mpw.some((t) => t.indexOf('_bottomPanel') >= 0),
      },
      bgWrap: (() => { const w = document.querySelector('.mpw-bgWrap'); if (!w) return null; const cs = getComputedStyle(w); return { display: cs.display, hasMedia: !!w.querySelector('img, video, iframe, canvas') } })(),
    }
  })()
}

async function loadPlaywright() {
  const cands = [
    path.join(ROOT, 'node_modules', 'playwright', 'index.mjs'),
    path.join(ROOT, 'node_modules', 'playwright-core', 'index.mjs'),
    path.join(ROOT, '..', 'node_modules', 'playwright', 'index.mjs'),
  ]
  for (const c of cands) if (fs.existsSync(c)) return await import(pathToFileURL(c).href)
  throw new Error('找不到 playwright（试过 ' + cands.join(' / ') + '）')
}

if (!fs.existsSync(COOKIE_FILE)) { console.error('✗ 缺少鉴权 Cookie 文件 ' + COOKIE_FILE + '（先跑 tools/hdr-probe-mint-cookie.mjs）'); process.exit(2) }
const cookie = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'))
const host = (() => { try { return new URL(URL0).hostname } catch { return '127.0.0.1' } })()

const { firefox } = await loadPlaywright()
const browser = await firefox.launch({ headless: !HEADED })
const bctx = await browser.newContext({ viewport: { width: 1292, height: 810 }, deviceScaleFactor: 1 })
await bctx.addCookies([{ name: cookie.name, value: cookie.value, domain: host, path: '/', httpOnly: true, sameSite: 'Strict' }])
const page = await bctx.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String((e && e.message) || e).slice(0, 200)))
// 预置外观设置（localStorage 在页面脚本之前写入，插件启动即读到）
if (SETTINGS) {
  const key = (() => { try { const m = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8').match(/STORE_KEY\s*=\s*["'`]([^"'`]+)["'`]/); return m ? m[1] : 'dsh-mpkg-wallpaper.v2' } catch { return 'dsh-mpkg-wallpaper.v2' } })()
  await page.addInitScript(([k, v]) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }, [key, SETTINGS])
}
let data = null, err = null, synth = null
try {
  await page.goto(URL0, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForTimeout(Math.max(0, WAIT_MS))
  data = await page.evaluate(pageCollector)
  if (SYNTHETIC) {
    synth = await page.evaluate(() => {
      const root = document.querySelector('[data-dsh-better-sidebar]')
      if (!root) return { error: '页面里没有 [data-dsh-better-sidebar] 根节点' }
      const host = document.createElement('div')
      host.id = 'mpw-probe-synth'
      const panel = document.createElement('div'); panel.className = 'nArs4W_bottomPanel'
      const tabBar = document.createElement('div'); tabBar.className = 'nArs4W_tabBar'
      const pane = document.createElement('div'); pane.className = 'nArs4W_paneBody'
      panel.appendChild(tabBar); panel.appendChild(pane); host.appendChild(panel)
      // ①(2026-09-17) 稳定属性锚点（0.19 新增，无类名）单独测一遍：类名哈希将来再换时，
      //   面板级规则靠这两条属性继续命中——这是本次加固的**直接**证据。
      const panelAttr = document.createElement('div'); panelAttr.setAttribute('data-dsh-bottom-panel', '')
      const paneAttr = document.createElement('div'); paneAttr.setAttribute('data-dsh-pane', 'probe')
      panelAttr.appendChild(paneAttr); host.appendChild(panelAttr)
      root.appendChild(host)
      const cs = (el) => { const c = getComputedStyle(el); return { radius: c.borderRadius, margin: c.margin, overflow: c.overflow, bg: c.backgroundColor, color: c.color } }
      const out = { panel: cs(panel), tabBar: cs(tabBar), pane: cs(pane), panelByAttr: cs(panelAttr), paneByAttr: cs(paneAttr), versionAttr: document.body.getAttribute('data-mpw-bs-version') }
      host.remove()
      return out
    })
  }
} catch (e) { err = String((e && e.message) || e) } finally { await browser.close() }

fs.mkdirSync(OUT_DIR, { recursive: true })
const out = { label: LABEL, url: URL0.replace(/token=[^&]*/, 'token=<redacted>'), at: new Date().toISOString(), settings: SETTINGS, error: err, pageErrors, data, synthetic: synth }
fs.writeFileSync(path.join(OUT_DIR, 'bs-compat-' + LABEL + '.json'), JSON.stringify(out, null, 2) + '\n')

const lines = []
lines.push('# better-sidebar 适配探针  label=' + LABEL + '  ' + out.at)
lines.push('URL: ' + out.url + (err ? '   ✗ 加载失败: ' + err : ''))
if (data) {
  lines.push('body[data-mpw-bs-version] = ' + JSON.stringify(data.bodyBsVersion) + '   (body 上的 mpw 属性: ' + data.bodyAttrs.join(' ') + ')')
  lines.push('宿主 /ping = ' + JSON.stringify(data.ping))
  lines.push('better-sidebar 根节点 [data-dsh-better-sidebar] = ' + data.counts.bsRoot + '  类名样本: ' + data.bsRootClasses.join(' | '))
  lines.push('选择器命中数（我们的 bsCompat 依赖这些）:')
  for (const [k, v] of Object.entries(data.counts)) lines.push('  ' + k.padEnd(26) + ' = ' + v)
  lines.push('我们的 <style>: ' + data.mpwStyles.ours + ' / 共 ' + data.mpwStyles.total
    + '  | bsCompat 作用域写法=' + data.mpwStyles.hasBsCompatScope + ' 版本门控=' + data.mpwStyles.hasVersionGate + ' _bottomPanel 规则=' + data.mpwStyles.hasBottomPanelRule)
  lines.push('[data-dsh-panel-host] 计算样式: ' + JSON.stringify(data.panelHostBoxes))
  if (synth) lines.push('合成锚点绑定（该版本真实类名 + 我们的选择器）: ' + JSON.stringify(synth))
  lines.push('壁纸层 .mpw-bgWrap = ' + JSON.stringify(data.bgWrap))
}
if (pageErrors.length) lines.push('页面异常: ' + pageErrors.slice(0, 5).join(' | '))
fs.writeFileSync(path.join(OUT_DIR, 'bs-compat-' + LABEL + '.txt'), lines.join('\n') + '\n')
console.log(lines.join('\n'))
process.exit(err ? 1 : 0)
