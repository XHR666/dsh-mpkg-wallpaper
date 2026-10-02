// tools/chrome-surface-live-probe.mjs —— **真页面（:3080 用户 DSH）**上量四个界面外壳的**实际计算样式**
//
// 为什么要有它（2026-10-02 用户第 1 项反馈）：用户实测"统一虚化/透明度"观感自相矛盾 ——
//   左栏像"壁纸色 + 模糊"、标题栏像"固定白底 + 模糊"、右栏/dock 全透明无模糊，设置弹窗一开左栏发黑。
//   这一轮已经把语义改成"**不虚化 ⇒ 外壳实心**"（`mpwFogModel().shellPct`，见 lib/client.js），
//   但"改完到底长什么样"只能拿**真页面上的 computed 值**说话 —— 不是推理，也不是截图（无头 Firefox 在本机
//   不合成 backdrop-filter，像素判据是假阴性，见 docs/HEADER-FROST.md「像素判据的边界」）。
//
// 这一条不是判据（不入常驻门禁，和别的真机探针同规矩：**必须串行**），它只做**采集 + 如实打印**：
//   · 场景矩阵：`unifyAmount ∈ {0,5,30}` × `sidebarAlpha ∈ {0,45,100}` × `blurFollowUnify ∈ {true,false}`（18 个场景）
//     —— 只在这三个键上做 patch，其余字段（壁纸源/mpkgKey/opacity/…）全部沿用用户真机现值；
//   · 每个场景：写插件自己的 localStorage 键 → **reload** → 等插件就绪 → `getComputedStyle` 采集
//     左栏 / 标题栏（含 `.mpw-hdrFrost` 层）/ 右栏+dock / 聊天区 / 壁纸层 + 主题 + 插件台账 + 三个 CSS token；
//   · 每个场景额外**打开一次设置面板**再采一遍左栏（用户报"设置打开时左栏变黑"；打不开就如实记 `dialog:skipped`）；
//   · 结果落 `tools/probe-out/chrome-surface-live.json`（已在 .gitignore，不入库），stdout 每个场景**一行 JSON** +
//     末尾一张人读表（场景 → 四个表面的 color / alpha / blur）。
//
// 诚实边界（探针一律如实记，不编数字）：
//   · 页面要 DSH 鉴权 Cookie：复用本仓既有机制 `tools/hdr-probe-mint-cookie.mjs`（自签、只读密钥、不落库）；
//     进不去（401/403/被跳登录）⇒ 记 `blocked:<原因>` 并**非零退出**；
//   · 插件没在该页生效（拿不到 `__mpwSectionTest`）⇒ 记 `blocked:plugin-not-active` 并非零退出；
//   · 某个表面在真机上不存在（例如用户布局里没有右栏）⇒ 该表面 `found:false`（不拿别的元素顶替）；
//   · 场景设置**是否真的生效**不靠假设：读 `window.__mpwPersist.read()`（插件内存里的真 section）逐场景对拍，
//     不一致就记 `effectiveMismatch:true`（宿主 settings.json 与 localStorage 的合并裁决可能让本地点不赢）；
//   · 意图 vs 现实都给：`__mpwBuildCss(patch)` 生成的 CSS 里抠出的 token/规则（插件"打算画什么"）
//     ＋ computed 值（页面"实际是什么"）。
//
// ⚠ 副作用（如实写明）：会**写用户真机的插件 localStorage**（`dsh.mpkg-wallpaper.v2`）并在每个场景 reload；
//   脚本结束前把原始整串**还原**（`--keep` 可关掉还原；还原结果记在 JSON 的 `restore` 里并打印）。
//   不写用户的 `settings.json`（插件自己的宿主写回不归本探针管；如出现写回，JSON 里 `hostPuts` 记请求计数）。
//
// 串行纪律（一次只开一个 Firefox）：脚本**自己会 flock**（重新以 `flock <锁> node <自己>` 起一次，
//   `MPW_PROBE_LOCKED=1` 防递归）；也可以按仓库惯例在外面再包一层：
//     flock /tmp/.mpw-firefox.lock -c 'node tools/chrome-surface-live-probe.mjs'
//   锁路径可用 `MPW_FIREFOX_LOCK` 覆盖；确信没有别的浏览器探针在跑时可 `MPW_PROBE_NO_FLOCK=1` 跳过。
//   静音三件套：`_audio-mute.mjs` 的 `withAudioMute()`（探针一律静音，用户实测过"幽灵声音"）。
//
// 用法:
//   node tools/chrome-surface-live-probe.mjs                       # 18 场景，写 tools/probe-out/chrome-surface-live.json
//   node tools/chrome-surface-live-probe.mjs --only amount=0       # 只跑 unifyAmount=0 的场景（调试用）
//   node tools/chrome-surface-live-probe.mjs --out /tmp/x.json --headed --keep
// 退出码: 0 全部采集成功 / 2 blocked（页面/插件拿不到）/ 3 采集到了但有场景失败
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { withAudioMute } from './_audio-mute.mjs'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d }
const has = (n) => argv.includes('--' + n)

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN = path.resolve(HERE, '..')
const AUTHORITY = arg('authority', '127.0.0.1:3080')
const URL0 = 'http://' + AUTHORITY + '/'
const OUT = path.resolve(arg('out', path.join(PLUGIN, 'tools', 'probe-out', 'chrome-surface-live.json')))
const WORK = path.resolve(arg('work', path.join(os.tmpdir(), 'mpw-chrome-surface')))
const COOKIE = path.join(WORK, 'cookie.json')
const HEADED = has('headed')
const KEEP = has('keep')                    // 不还原用户设置（默认还原）
const ONLY = arg('only', '')                // 形如 amount=0 / side=45 / follow=false（子串过滤，调试用）
const SETTLE = Number(arg('settle', '900')) // 每次 reload 后额外等待（插件 apply + React 渲染）
const HOST_WAIT = Number(arg('host-wait', '8000')) // 等宿主外壳（标题栏/右栏/dock）挂上来的上限
const ALLOW_HOST_WRITES = has('allow-host-writes') // 默认**拦掉**插件往宿主写回（见下"副作用"）
/* 可见态开关（默认关；开了才会点宿主 UI）：
   `--open-session` 进到"有会话"的布局（优先点**已有会话行**；没有就点 `[aria-label="新建会话"]` 真按钮
     —— 后者会在你的 DSH 里**新建一条空会话**，如实记在 layout 里）；实测这一步同时会把右栏/dock 带出来。
   `--open-right`   若右栏/dock 还没出来，再按候选控件补点（`展开右侧边栏` / `视图选项` / 菜单…），点不到就记 none。 */
const OPEN_SESSION = has('open-session')
const OPEN_RIGHT = has('open-right')
const KEY4 = String(arg('key4', 'a0-s0-f1,a0-s45-f1,a30-s0-f1,a30-s45-f1')).split(',').map((x) => x.trim()).filter(Boolean)
/* 用户真机的 settings.json（插件会把设置写回这里）。默认：拦掉写回 + 跑前跑后快照比对，
   变了就按快照原样还原 —— 探针只该改浏览器里那份 localStorage，不该动用户的真档。 */
const SETTINGS_JSON = path.resolve(arg('settings', path.join(os.homedir(), '.dsh-mpkg-wallpaper', 'settings.json')))
const SETTINGS_SHOWN = SETTINGS_JSON.replace(os.homedir(), '~')
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')
const STORE = 'dsh.mpkg-wallpaper.v2'

/* ── 0 串行锁：一次只开一个 Firefox（与其它探针共用同一把锁文件） ───────────────────── */
const LOCK = process.env.MPW_FIREFOX_LOCK || path.join(os.tmpdir(), '.mpw-firefox.lock')
if (process.env.MPW_PROBE_LOCKED !== '1' && process.env.MPW_PROBE_NO_FLOCK !== '1') {
  const hasFlock = spawnSync('flock', ['--version'], { stdio: 'ignore' }).status === 0
  if (hasFlock) {
    const wait = String(Number(arg('lock-wait', '900')))
    const r = spawnSync('flock', ['-w', wait, LOCK, process.execPath, fileURLToPath(import.meta.url), ...argv], {
      stdio: 'inherit', env: Object.assign({}, process.env, { MPW_PROBE_LOCKED: '1' }),
    })
    process.exit(r.status === null ? 1 : r.status)
  }
  console.log('⚠ 本机没有 flock ⇒ 本次**没有**加串行锁（同时跑多个浏览器探针会互相干扰；只影响并发安全）')
}

/* ── 1 场景矩阵（只 patch 三个键；其余字段沿用用户真机现值） ──────────────────────── */
const AMOUNTS = [0, 5, 30]
const SIDES = [0, 45, 100]
const FOLLOWS = [true, false]
const scenarios = []
for (const unifyAmount of AMOUNTS) {
  for (const sidebarAlpha of SIDES) {
    for (const blurFollowUnify of FOLLOWS) {
      const id = 'a' + unifyAmount + '-s' + sidebarAlpha + '-f' + (blurFollowUnify ? '1' : '0')
      if (ONLY) {                                     // --only amount=0 / side=45 / follow=false / 或 id 子串（调试用）
        const eq = ONLY.indexOf('=')
        const k = eq > 0 ? ONLY.slice(0, eq) : ''
        const v = eq > 0 ? ONLY.slice(eq + 1) : ''
        const hit = k === 'amount' ? String(unifyAmount) === v
          : k === 'side' ? String(sidebarAlpha) === v
            : k === 'follow' ? String(blurFollowUnify) === v
              : id.includes(ONLY)
        if (!hit) continue
      }
      scenarios.push({ id, patch: { enabled: true, unifyTint: true, unifyAmount, sidebarAlpha, blurFollowUnify } })
    }
  }
}

/* ── 2 采集器（页面侧；只读 computed / 只读钩子，绝不写） ─────────────────────────── */
const COLLECT = () => {
  const csOf = (el) => { try { return el ? getComputedStyle(el) : null } catch (e) { return null } }
  const one = (sel) => {
    let el = null
    try { el = document.querySelector(sel) } catch (e) { return { sel, found: false, err: String(e && e.message || e) } }
    if (!el) return { sel, found: false }
    const s = csOf(el)
    const r = (() => { try { const b = el.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) } } catch (e) { return null } })()
    return {
      sel, found: true, rect: r,
      display: s.display, visibility: s.visibility, opacity: s.opacity,
      backgroundColor: s.backgroundColor, backgroundImage: String(s.backgroundImage || '').slice(0, 120),
      backdropFilter: s.backdropFilter, filter: String(s.filter || '').slice(0, 80),
      zIndex: s.zIndex, position: s.position,
    }
  }
  const tok = (scope, name) => { try { return getComputedStyle(scope).getPropertyValue(name).trim() } catch (e) { return null } }
  const html = document.documentElement
  const body = document.body
  let persist = null
  try { persist = globalThis.__mpwPersist && globalThis.__mpwPersist.read ? globalThis.__mpwPersist.read() : null } catch (e) { persist = { err: String(e && e.message || e) } }
  let ledger = null
  try { ledger = globalThis.__mpwSectionTest && globalThis.__mpwSectionTest.read ? globalThis.__mpwSectionTest.read() : null } catch (e) { ledger = { err: String(e && e.message || e) } }
  let lsRaw = null
  try { lsRaw = localStorage.getItem('dsh.mpkg-wallpaper.v2') } catch (e) { lsRaw = null }
  const s = persist && typeof persist === 'object' ? persist : {}
  return {
    at: new Date().toISOString(),
    theme: {
      dark: !!(body && body.hasAttribute('data-ds-dark-theme')),
      bodyAttrs: body ? Array.from(body.attributes).map((a) => a.name).filter((n) => /^data-(mpw|ds)/.test(n)) : [],
      sidebarFill: tok(body, '--dsw-specific-sidebar-fill'),
      bgBase: tok(body, '--dsw-alias-bg-base'),
    },
    surfaces: {
      sidebarSlot: one('[data-slot="sidebar"]'),
      sidebarCol: one('[class*="sidebarCol"]'),
      header: one('.wSkVaW_header'),
      headerFrost: one('.mpw-hdrFrost'),
      scrollBody: one('.wSkVaW_scrollBody'),
      rightPanel: one('[data-sidebar-right-panel]'),
      dockStrip: one('[data-dockkit-strip]'),
      dockPane: one('[data-dockkit-pane]'),
      overlay: one('[class*="_overlayLayer"]'),
      bgWrap: one('#mpw-bgWrap'),
    },
    tokens: {                                  // 按主对话指定的口径：读 documentElement
      onHtml: {
        chromeAlpha: tok(html, '--mpw-chrome-alpha'),
        chromeBg: tok(html, '--mpw-chrome-bg'),
        unifySurface: tok(html, '--mpw-unify-surface'),
      },
      /* SSOT 在 body（宿主 --dsw-* 也定义在 body；写 :root 会 guaranteed-invalid 继承，
         见 docs/TOKEN-NAMESPACE.md）⇒ 两边都记，免得把"html 上是空串"误读成"没有这个 token"。 */
      onBody: {
        chromeAlpha: tok(body, '--mpw-chrome-alpha'),
        chromeBg: tok(body, '--mpw-chrome-bg'),
        unifySurface: tok(body, '--mpw-unify-surface'),
        surfaceSideFrost: tok(body, '--mpw-surface-side-frost'),
        bgBlur: tok(body, '--mpw-bg-blur'),
      },
    },
    /* 主对话给的哈希（`.wSkVaW_header` / `.mpw-hdrFrost`）可能随宿主构建/视图变化 ⇒ 额外做一次
       **只读发现**：把带 `_header` / `_dockkit` / `data-dockkit*` / `data-sidebar-right-panel` 的元素
       连同它们的真实类名一起记下来（"找不到"要给得出原因，不能只说 found:false）。 */
    discovered: (() => {
      const brief = (e) => {
        const c = csOf(e)
        const b = (() => { try { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) } } catch (err) { return null } })()
        return { cls: String(e.className).slice(0, 80), bg: c.backgroundColor, bf: c.backdropFilter, display: c.display, rect: b,
          visible: !!(b && b.w > 2 && b.h > 2) && c.display !== 'none' && c.visibility !== 'hidden' }
      }
      const pick = (sel, n) => { try { return Array.from(document.querySelectorAll(sel)).slice(0, n || 4).map(brief) } catch (e) { return [{ err: String(e && e.message || e) }] } }
      return {
        headerLike: pick('[class*="_header"]'),
        dockLike: pick('[class*="dock"]', 3),
        rightPanelLike: pick('[data-sidebar-right-panel],[class*="rightPanel"],[class*="rightPanel"]', 3),
        counts: {
          headerHash: (() => { try { return document.querySelectorAll('[class*="_header"]').length } catch (e) { return null } })(),
          exactHeader: (() => { try { return document.querySelectorAll('.wSkVaW_header').length } catch (e) { return null } })(),
          exactHdrFrost: (() => { try { return document.querySelectorAll('.mpw-hdrFrost').length } catch (e) { return null } })(),
          dockkitAttr: (() => { try { return document.querySelectorAll('[data-dockkit-strip],[data-dockkit-pane]').length } catch (e) { return null } })(),
          rightPanelAttr: (() => { try { return document.querySelectorAll('[data-sidebar-right-panel]').length } catch (e) { return null } })(),
          composer: (() => { try { return document.querySelectorAll('[contenteditable="true"],[class*="composer"]').length } catch (e) { return null } })(),
          sessionRows: (() => { try { return document.querySelectorAll('[class*="sessionRow"],[class*="session"]').length } catch (e) { return null } })(),
          bodyChildren: body ? body.children.length : null,
        },
      }
    })(),
    ledger,
    /* 页面跑的是**已安装**的那份插件（不是本仓工作树）⇒ 记一个"产物指纹"，让这次读数可归属到某个构建：
       我们的 `<style data-plugin=…>` 文本长度 + 简易哈希（宿主无关、不读宿主文件系统）。 */
    build: (() => {
      try {
        const st = document.querySelector('style[data-plugin="dsh-mpkg-wallpaper"]')
        const txt = st ? String(st.textContent || '') : ''
        let h = 5381
        for (let i = 0; i < txt.length; i++) h = ((h * 33) ^ txt.charCodeAt(i)) >>> 0
        return { styleLen: txt.length, styleHash: txt ? h.toString(16) : null, hasStyle: !!st }
      } catch (e) { return { err: String(e && e.message || e) } }
    })(),
    effective: {
      unifyTint: s.unifyTint, unifyAmount: s.unifyAmount, sidebarAlpha: s.sidebarAlpha,
      blurFollowUnify: s.blurFollowUnify, enabled: s.enabled, opacity: s.opacity,
      mpkgKey: s.mpkgKey, hasImage: !!(s.image || s.webUrl),
    },
    lsLen: lsRaw ? lsRaw.length : 0,
  }
}

/** 场景的"意图"：让插件自己把这一档的 CSS 生成出来，从文本里抠关键字面量（不猜、不重算）。 */
const intentFromCss = (patch) => {
  try {
    const css = globalThis.__mpwBuildCss ? String(globalThis.__mpwBuildCss(patch) || '') : ''
    if (!css) return null
    const g = (re) => { const m = css.match(re); return m ? m[1].trim() : null }
    return {
      cssLen: css.length,
      buildError: /^\/\*BUILD_ERROR\*\//.test(css),
      chromeAlpha: g(/--mpw-chrome-alpha:\s*([^;}]+)/),
      chromeBg: g(/--mpw-chrome-bg:\s*([^;}]+)/),
      unifySurface: g(/--mpw-unify-surface:\s*([^;}]+)/),
      surfaceSideFrost: g(/--mpw-surface-side-frost:\s*([^;}]+)/),
      hdrFrostRule: g(/(?:\.mpw-hdrFrost|\[data-mpw-hdrfrost\][^{]*)\{([^}]*)\}/),
      sidebarColRule: g(/(?:\[class\*=["']?sidebarCol["']?\])[^{]*\{([^}]*)\}/),
    }
  } catch (e) { return { err: String(e && e.message || e) } }
}

/** 当前布局读数（会话/标题栏/右栏/dock 到底在不在、可不可见）。 */
const LAYOUT = () => {
  const vis = (e) => { try { const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return r.width > 2 && r.height > 2 && c.display !== 'none' && c.visibility !== 'hidden' } catch (err) { return false } }
  const q = (sel) => { try { return Array.from(document.querySelectorAll(sel)) } catch (e) { return [] } }
  const hdrEls = q('.wSkVaW_header')
  const hdrAny = q('[class*="_header"]')
  const rows = q('[class*="sessionRow"]')
  return {
    sessionRows: rows.length, sessionRowVisible: rows.filter(vis).length,
    editors: q('[contenteditable="true"]').length,
    headerExact: hdrEls.length, headerExactVisible: hdrEls.filter(vis).length,
    headerExactCls: hdrEls[0] ? String(hdrEls[0].className) : null,
    headerAny: hdrAny.length, headerAnyVisible: hdrAny.filter(vis).length,
    hdrFrost: q('.mpw-hdrFrost').length, hdrFrostVisible: q('.mpw-hdrFrost').filter(vis).length,
    rightPanel: q('[data-sidebar-right-panel]').length, rightPanelVisible: q('[data-sidebar-right-panel]').filter(vis).length,
    dockStrip: q('[data-dockkit-strip]').length, dockStripVisible: q('[data-dockkit-strip]').filter(vis).length,
    dockPane: q('[data-dockkit-pane]').length, dockPaneVisible: q('[data-dockkit-pane]').filter(vis).length,
    rightbarCollapsed: (() => { const e = document.querySelector('[data-rightbar-collapsed]'); return e ? e.getAttribute('data-rightbar-collapsed') : null })(),
  }
}

/** 打开/进入会话：优先已有会话行（无副作用），否则点"新建会话"真按钮（会新建一条空会话，如实记）。 */
const OPEN_SESSION_FN = async () => {
  const vis = (e) => { try { const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return r.width > 2 && r.height > 2 && c.display !== 'none' } catch (err) { return false } }
  const rows = Array.from(document.querySelectorAll('[class*="sessionRow"]')).filter(vis)
  if (rows.length) { rows[0].click(); return { clicked: 'existing-session-row', rows: rows.length } }
  const btns = Array.from(document.querySelectorAll('button[aria-label="新建会话"]')).filter(vis)
  if (!btns.length) return { clicked: 'none', why: 'no-new-session-button' }
  const prefer = btns.filter((e) => String(e.className).indexOf('newSession') >= 0)
  const el = prefer[0] || btns[btns.length - 1]
  el.click()
  return { clicked: 'new-session-button', cls: String(el.className).slice(0, 40), candidates: btns.length, note: '会在你的 DSH 里新建一条空会话（这是宿主的"新建会话"按钮）' }
}

/** 补开右栏/dock：把可见的候选控件逐个试，返回哪一个把它带出来了。 */
const OPEN_RIGHT_FN = () => {
  const vis = (e) => { try { const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return r.width > 2 && r.height > 2 && c.display !== 'none' } catch (err) { return false } }
  if (document.querySelectorAll('[data-dockkit-strip],[data-sidebar-right-panel]').length) return { clicked: 'already-open' }
  const PATS = [/展开右侧|右侧边栏|右侧面板/, /视图选项/, /菜单|menu/, /dock|工具面板/i]
  const all = Array.from(document.querySelectorAll('button,[role="button"],[tabindex]')).filter(vis)
  for (const p of PATS) {
    const hit = all.find((e) => p.test(((e.getAttribute && (e.getAttribute('aria-label') || e.getAttribute('title'))) || '') + ' ' + (e.textContent || '').trim().slice(0, 24)))
    if (!hit) continue
    hit.click()
    return { clicked: 'by-pattern', pattern: String(p), cls: String(hit.className).slice(0, 40), aria: hit.getAttribute('aria-label') }
  }
  return { clicked: 'none', why: 'no-candidate', visibleControls: all.map((e) => e.getAttribute('aria-label') || String(e.className).slice(0, 24)).filter(Boolean).slice(0, 25) }
}

/* 设置面板：点"设置/Settings"入口（自底向上取最内层可见命中），拿不到就记 skipped。 */
const OPEN_SETTINGS = () => {
  const visible = (e) => { try { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 } catch (err) { return false } }
  const label = (e) => ((e.getAttribute && (e.getAttribute('aria-label') || e.getAttribute('title'))) || '') + ' ' + (e.textContent || '').trim()
  const cands = Array.from(document.querySelectorAll('button,[role="button"],a,li,div,span'))
    .filter((e) => visible(e) && /^\s*(设置|Settings)\s*$/.test(label(e).replace(/\s+/g, ' ').trim()) || (visible(e) && /^(设置|Settings)$/.test(((e.getAttribute && e.getAttribute('aria-label')) || '').trim())))
  cands.sort((a, b) => a.getElementsByTagName('*').length - b.getElementsByTagName('*').length)
  if (!cands.length) return { ok: false, why: 'no-settings-entry' }
  const el = cands[0]
  const info = { ok: true, text: (el.textContent || '').trim().slice(0, 24), aria: el.getAttribute('aria-label') || null, tag: el.tagName }
  try { el.click() } catch (e) { return { ok: false, why: 'click-threw: ' + String(e && e.message || e) } }
  return info
}

/** 设置面板开了没：我们的分区入口 / 可见 overlay 二者之一出现即算开。 */
const DIALOG_STATE = () => {
  const visible = (e) => { try { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 } catch (err) { return false } }
  const ov = Array.from(document.querySelectorAll('[class*="_overlayLayer"]')).filter(visible)
  const nav = Array.from(document.querySelectorAll('button,[role="button"],a,li,div,span'))
    .filter((e) => visible(e) && /壁纸引擎背景|MPKG Wallpaper|壁纸引擎/.test(e.textContent || ''))
  const dialogish = Array.from(document.querySelectorAll('[role="dialog"],[class*="modal"],[class*="Modal"]')).filter(visible)
  return {
    open: nav.length > 0 || ov.length > 0 || dialogish.length > 0,
    navHits: nav.length, overlayVisible: ov.length, dialogish: dialogish.length,
    overlay: ov[0] ? (() => { const s = getComputedStyle(ov[0]); const b = ov[0].getBoundingClientRect(); return { bg: s.backgroundColor, opacity: s.opacity, z: s.zIndex, w: Math.round(b.width), h: Math.round(b.height), cls: String(ov[0].className).slice(0, 60) } })() : null,
  }
}

/* ── 3 主流程 ─────────────────────────────────────────────────────────────────── */
/** 等"会话布局"出现（编辑框 / dock / 会话行 任一）。超时不算失败：如实记 waitedMs。 */
const layoutReady = async (page, ms) => {
  const t0 = Date.now()
  try {
    await page.waitForFunction(() => {
      const q = (sel) => { try { return document.querySelectorAll(sel).length } catch (e) { return 0 } }
      return q('[contenteditable="true"]') > 0 || q('[data-dockkit-strip]') > 0 || q('[class*="sessionRow"]') > 0
    }, null, { timeout: ms })
  } catch (e) { /* 超时继续：由调用方看 after 读数决定 */ }
  return Date.now() - t0
}

/** 按开关把"可见态"弄出来（会话布局 / 右栏 dock），每一步点谁都如实记。 */
const ensureLayout = async (page) => {
  const before = await page.evaluate(LAYOUT)
  const clicks = []
  if (OPEN_SESSION) {
    const need = before.editors === 0 && before.dockStrip === 0 && before.sessionRows === 0
    if (!need) clicks.push({ session: 'already-present' })
    for (let i = 0; need && i < 2; i++) {
      const r = await page.evaluate(OPEN_SESSION_FN)
      r.waitedMs = await layoutReady(page, 20000)
      clicks.push({ session: r })
      const now = await page.evaluate(LAYOUT)
      if (now.editors > 0 || now.dockStrip > 0 || now.sessionRows > 0) break
    }
  }
  if (OPEN_RIGHT) {
    const now = await page.evaluate(LAYOUT)
    if (now.dockStrip > 0 || now.rightPanel > 0) clicks.push({ right: 'already-open' })
    else {
      const r = await page.evaluate(OPEN_RIGHT_FN)
      r.waitedMs = await layoutReady(page, 12000)
      clicks.push({ right: r })
    }
  }
  await page.waitForTimeout(400)
  return { before, clicks, after: await page.evaluate(LAYOUT) }
}

const OUTDIR = path.dirname(OUT)
fs.mkdirSync(OUTDIR, { recursive: true })
fs.mkdirSync(WORK, { recursive: true })

const snapFile = (p) => { try { const b = fs.readFileSync(p); return { sha256: sha256(b), len: b.length, buf: b } } catch (e) { return null } }
const settingsSnap = snapFile(SETTINGS_JSON)
const result = {
  probe: 'chrome-surface-live-probe', at: new Date().toISOString(), authority: AUTHORITY, url: URL0,
  plugin: PLUGIN, out: OUT, matrix: { unifyAmount: AMOUNTS, sidebarAlpha: SIDES, blurFollowUnify: FOLLOWS, fixed: { enabled: true, unifyTint: true } },
  blocked: null, note: null, scenarios: [], hostPuts: 0, hostWritesBlocked: 0, restore: null, pageErrors: [],
  settingsFile: {
    path: SETTINGS_SHOWN, existed: !!settingsSnap,
    before: settingsSnap ? settingsSnap.sha256.slice(0, 12) : null,
    hostWritesBlocked: !ALLOW_HOST_WRITES,
  },
}

const blocked = (why, detail) => {
  result.blocked = { why, detail: detail === undefined ? null : detail, at: new Date().toISOString() }
  fs.writeFileSync(OUT, JSON.stringify(result, null, 1) + '\n')
  console.log('✗ blocked:' + why + (detail ? '  — ' + String(detail).slice(0, 300) : ''))
  console.log('  （已把这次尝试写进 ' + path.relative(PLUGIN, OUT) + '；没有编造任何数字）')
  process.exit(2)
}

let browser = null
try {
  /* ③ 签 Cookie（复用仓库既有机制；密钥只读、不打印、不落库） */
  const relCookie = path.relative(PLUGIN, path.join(PLUGIN, 'tools', 'hdr-probe-mint-cookie.mjs'))
  try {
    execFileSync(process.execPath, [path.join(HERE, 'hdr-probe-mint-cookie.mjs'), '--authority', AUTHORITY, '--out', COOKIE], { cwd: PLUGIN, stdio: ['ignore', 'pipe', 'inherit'] })
  } catch (e) {
    blocked('cookie-mint-failed', String((e && e.stderr) || (e && e.message) || e).slice(0, 300) + '（密钥在 ~/.dsh/.credentials.yaml；见 tools/' + relCookie + '）')
  }
  if (!fs.existsSync(COOKIE)) blocked('cookie-missing', COOKIE)
  const cookie = JSON.parse(fs.readFileSync(COOKIE, 'utf8'))

  let pw = null
  try { pw = await import('playwright') } catch (e) { pw = null }
  const firefox = pw && ((pw.default && pw.default.firefox) || pw.firefox)
  if (!firefox) {
    result.note = 'playwright/没有 firefox 导出'
    fs.writeFileSync(OUT, JSON.stringify(result, null, 1) + '\n')
    console.log('SKIP chrome-surface-live-probe — 本机没有 playwright 的 firefox（未起浏览器、未写设置）')
    process.exit(0)
  }

  browser = await firefox.launch({ headless: !HEADED, firefoxUserPrefs: withAudioMute() })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'zh-CN' })
  await ctx.addCookies([{ name: cookie.name, value: cookie.value, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Strict' }])
  const page = await ctx.newPage()
  /* 默认拦掉"插件 → 宿主 settings.json"的写回：探针只量 CSS，没理由改用户真档。
     GET 照常放行（插件的启动合并要读真档）；写请求回一个 200 {ok:true}（插件认为存了，不会重试）。 */
  if (!ALLOW_HOST_WRITES) {
    await page.route('**/api/mpkg-wallpaper/settings*', (route) => {
      const req = route.request()
      if (req.method() === 'GET' || req.method() === 'HEAD') return route.continue()
      result.hostWritesBlocked++
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, blockedByProbe: 'chrome-surface-live-probe' }) })
    })
  }
  page.on('pageerror', (e) => result.pageErrors.push(String((e && e.message) || e).slice(0, 200)))
  page.on('response', (r) => { try { if (r.url().indexOf('/api/mpkg-wallpaper/settings') >= 0 && r.request().method() !== 'GET') result.hostPuts++ } catch (e) { /* ignore */ } })

  const resp = await page.goto(URL0, { waitUntil: 'domcontentloaded', timeout: 60000 })
  const status = resp ? resp.status() : null
  if (status === 401 || status === 403) blocked('http-' + status, 'DSH 首页要鉴权 Cookie（自签的这枚没被接受？authority=' + AUTHORITY + '）')
  if (!resp || !resp.ok()) blocked('http-' + status, '首页不可用')

  // 等插件就绪（它自己的钩子；等不到 ⇒ 页面在、插件没生效 ⇒ 如实 blocked，不拿别的元素顶替）
  try {
    await page.waitForFunction(() => !!(globalThis.__mpwSectionTest && globalThis.__mpwPersist), null, { timeout: 30000 })
  } catch (e) {
    blocked('plugin-not-active', '页面打开了但没有 __mpwSectionTest/__mpwPersist ⇒ 该页没装/没启用本插件')
  }
  result.page = { title: await page.title(), status }
  result.layoutPlan = { openSession: OPEN_SESSION, openRight: OPEN_RIGHT, key4: KEY4 }
  if (OPEN_SESSION || OPEN_RIGHT) {
    result.layoutInitial = await ensureLayout(page)      // 先弄一次，后面每个场景 reload 后按需补
    await page.waitForTimeout(SETTLE)
  }

  // 备份用户真机设置（整串），供最后还原
  const original = await page.evaluate((k) => { try { return localStorage.getItem(k) } catch (e) { return null } }, STORE)
  result.originalLen = original ? original.length : 0
  const originalSec = (() => { try { return original ? JSON.parse(original) : {} } catch (e) { return {} } })()

  /* ④ 逐场景：写 localStorage → reload → 采集 → 开设置面板再采一遍左栏 */
  for (const sc of scenarios) {
    const rec = { id: sc.id, patch: sc.patch, ok: false }
    try {
      const raw = await page.evaluate(({ k, patch }) => {
        let cur = {}
        try { cur = JSON.parse(localStorage.getItem(k) || '{}') || {} } catch (e) { cur = {} }
        const next = Object.assign({}, cur, patch)
        localStorage.setItem(k, JSON.stringify(next))
        return localStorage.getItem(k)
      }, { k: STORE, patch: sc.patch })
      rec.wroteLen = raw ? raw.length : 0

      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.waitForFunction(() => !!(globalThis.__mpwSectionTest && globalThis.__mpwPersist), null, { timeout: 30000 })
      /* 宿主外壳是异步渲染的：`state:'attached'` 等它进 DOM（标题栏在用户布局里可能是 display:none，
         用默认的 'visible' 会白等满超时）。等不到也如实记 found:false，不拿别的元素顶替。 */
      const waitT0 = Date.now()
      await page.waitForSelector('[class*="sidebarCol"]', { state: 'attached', timeout: HOST_WAIT }).catch(() => {})
      await page.waitForSelector('.wSkVaW_header', { state: 'attached', timeout: HOST_WAIT }).catch(() => {})
      await page.waitForSelector('[data-dockkit-strip]', { state: 'attached', timeout: Math.min(3000, HOST_WAIT) }).catch(() => {})
      await page.waitForTimeout(SETTLE)
      rec.hostChromeWaitMs = Date.now() - waitT0
      /* 可见态：reload 会把宿主的会话/dock 布局丢掉 ⇒ 按开关补回来（补的每一步都记在 rec.layout.clicks） */
      rec.layout = (OPEN_SESSION || OPEN_RIGHT) ? await ensureLayout(page) : { after: await page.evaluate(LAYOUT), clicks: [] }
      rec.headerVisible = rec.layout.after.headerExactVisible > 0 || rec.layout.after.headerAnyVisible > 0

      rec.intent = await page.evaluate(intentFromCss, sc.patch)
      rec.closed = await page.evaluate(COLLECT)
      const eff = rec.closed.effective || {}
      rec.effectiveMismatch = !(Number(eff.unifyAmount) === sc.patch.unifyAmount && Number(eff.sidebarAlpha) === sc.patch.sidebarAlpha && !!eff.blurFollowUnify === sc.patch.blurFollowUnify && eff.unifyTint === true)

      /* 开设置面板（用户报"设置打开时左栏变黑"）—— 拿不到入口就 skipped（不伪造） */
      const opened = await page.evaluate(OPEN_SETTINGS)
      let state = await page.evaluate(DIALOG_STATE)
      if (opened.ok && !state.open) await page.waitForTimeout(1200)
      state = await page.evaluate(DIALOG_STATE)
      if (opened.ok && !state.open) {
        // 最后手段（主对话给的线索）：给可见的 overlay 容器派发一次点击
        const disp = await page.evaluate(() => {
          const els = Array.from(document.querySelectorAll('[class*="_overlayLayer"]'))
          if (!els.length) return { ok: false }
          els[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
          return { ok: true, cls: String(els[0].className).slice(0, 60) }
        })
        await page.waitForTimeout(1200)
        state = await page.evaluate(DIALOG_STATE)
        rec.dialogOpenedBy = state.open ? 'overlay-dispatch' : (disp.ok ? 'overlay-dispatch-no-open' : 'skipped')
      } else {
        rec.dialogOpenedBy = state.open ? 'settings-entry-click' : (opened.ok ? 'settings-entry-no-open' : 'skipped')
      }
      rec.dialog = { entry: opened, state }
      if (state.open) {
        await page.waitForTimeout(400)
        rec.dialogCollect = await page.evaluate(COLLECT)
        /* 设置面板开/关对左栏的影响（用户报"设置打开时左栏变黑"）——只记有界字段，便于人读 */
        const pick = (surf) => (surf && surf.found ? { bg: surf.backgroundColor, bf: surf.backdropFilter, display: surf.display } : null)
        rec.dialogDelta = {
          sidebarCol: { closed: pick(rec.closed.surfaces.sidebarCol), open: pick(rec.dialogCollect.surfaces.sidebarCol) },
          sidebarSlot: { closed: pick(rec.closed.surfaces.sidebarSlot), open: pick(rec.dialogCollect.surfaces.sidebarSlot) },
          overlay: pick(rec.dialogCollect.surfaces.overlay),
        }
        try { await page.keyboard.press('Escape') } catch (e) { /* ignore */ }
        await page.waitForTimeout(300)
        rec.dialogClosedAfterEsc = !(await page.evaluate(DIALOG_STATE)).open
      } else {
        rec.dialogCollect = null
        rec.dialogNote = 'dialog:skipped（入口点不开 ⇒ 这一格如实为空，没有拿"没开面板"当"开了"）'
      }
      rec.ok = true
    } catch (e) {
      rec.error = String((e && e.message) || e).slice(0, 300)
    }
    result.scenarios.push(rec)
    console.log('SCENARIO ' + JSON.stringify({
      id: rec.id, patch: rec.patch, ok: rec.ok, error: rec.error || null,
      effectiveMismatch: rec.effectiveMismatch === true,
      effective: rec.closed ? rec.closed.effective : null,
      dialogOpenedBy: rec.dialogOpenedBy || null,
      layout: rec.layout ? { sessionRows: rec.layout.after.sessionRows, editors: rec.layout.after.editors, headerVisible: rec.layout.after.headerExactVisible + '/' + rec.layout.after.headerAnyVisible, rightPanel: rec.layout.after.rightPanelVisible, dock: rec.layout.after.dockStripVisible } : null,
      left: rec.closed ? rec.closed.surfaces.sidebarCol : null,
      header: rec.closed ? rec.closed.surfaces.headerFrost : null,
      tokens: rec.closed ? rec.closed.tokens.onBody : null,
    }))
  }

  /* ⑤ 还原用户真机设置（默认做；--keep 跳过） */
  if (!KEEP) {
    try {
      await page.evaluate(({ k, raw }) => { try { if (raw === null) localStorage.removeItem(k); else localStorage.setItem(k, raw) } catch (e) { /* ignore */ } }, { k: STORE, raw: original })
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.waitForFunction(() => !!(globalThis.__mpwSectionTest && globalThis.__mpwPersist), null, { timeout: 30000 }).catch(() => {})
      await page.waitForTimeout(500)
      const back = await page.evaluate((k) => { try { return localStorage.getItem(k) } catch (e) { return null } }, STORE)
      const backSec = (() => { try { return JSON.parse(back || '{}') || {} } catch (e) { return {} } })()
      const keys = Array.from(new Set(Object.keys(originalSec).concat(Object.keys(backSec))))
      const diffKeys = keys.filter((k) => JSON.stringify(originalSec[k]) !== JSON.stringify(backSec[k]))
      const MATRIX = ['unifyTint', 'unifyAmount', 'sidebarAlpha', 'blurFollowUnify']
      result.restore = {
        rawMatches: back === original,                 // 插件 load 时可能重写同值（补元键）⇒ 全等只是参考
        len: back ? back.length : 0, originalLen: original ? original.length : 0,
        differingCount: diffKeys.length, differingKeys: diffKeys.slice(0, 12),
        matrixKeysBack: MATRIX.map((k) => ({ k, want: originalSec[k], got: backSec[k], ok: JSON.stringify(originalSec[k]) === JSON.stringify(backSec[k]) })),
        keep: false,
      }
    } catch (e) {
      result.restore = { ok: false, err: String((e && e.message) || e).slice(0, 200), keep: false }
    }
  } else {
    result.restore = { keep: true, note: '--keep：没有还原浏览器 localStorage（探针结束时页面停在最后一个场景的档位）' }
  }
  /* settings.json 快照比对：默认拦了写回 ⇒ 应当逐字节没变；万一变了（例如写了别的路由）就按快照原样还原 */
  if (settingsSnap) {
    const after = snapFile(SETTINGS_JSON)
    const afterSha = after ? after.sha256 : null
    if (afterSha === settingsSnap.sha256) {
      result.settingsFile.after = afterSha.slice(0, 12); result.settingsFile.unchanged = true
    } else if (!KEEP) {
      let restored = false
      try { fs.writeFileSync(SETTINGS_JSON, settingsSnap.buf); restored = sha256(fs.readFileSync(SETTINGS_JSON)) === settingsSnap.sha256 } catch (e) { /* 记在下面 */ }
      result.settingsFile.after = afterSha ? afterSha.slice(0, 12) : null
      result.settingsFile.unchanged = false
      result.settingsFile.restoredFromSnapshot = restored
    } else {
      result.settingsFile.after = afterSha ? afterSha.slice(0, 12) : null
      result.settingsFile.unchanged = false
      result.settingsFile.restoredFromSnapshot = false
      result.settingsFile.note = '--keep：宿主 settings.json 变了也没还原'
    }
  }
} catch (e) {
  result.fatal = String((e && e.stack) || e).slice(0, 800)
} finally {
  try { if (browser) await browser.close() } catch (e) { /* ignore */ }
}

/* ── 4 落盘 + 人读表 ───────────────────────────────────────────────────────────── */
fs.writeFileSync(OUT, JSON.stringify(result, null, 1) + '\n')

const parseColor = (s) => {
  const raw = String(s === undefined || s === null ? '' : s).trim()
  if (!raw) return { raw, alpha: null, kind: 'empty' }
  let m = raw.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/i)
  if (m) {
    let a = m[4] === undefined ? 1 : (m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]))
    if (!Number.isFinite(a)) a = null
    return { raw, r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), alpha: a, kind: 'rgb' }
  }
  if (raw === 'transparent') return { raw, alpha: 0, kind: 'keyword' }
  m = raw.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/i)
  if (m) return { raw, r: Number(m[1]) * 255, g: Number(m[2]) * 255, b: Number(m[3]) * 255, alpha: m[4] === undefined ? 1 : Number(m[4]), kind: 'color-srgb' }
  return { raw, alpha: null, kind: 'unparsed' }
}
const blurOf = (s) => {
  const raw = String(s === undefined || s === null ? '' : s).trim()
  if (!raw || raw === 'none') return null
  const m = raw.match(/blur\(\s*([\d.]+)px\s*\)/i)
  return m ? Number(m[1]) : raw
}
const row = (label, surf) => {
  if (!surf) return { label, found: false }
  if (!surf.found) return { label, found: false }
  const c = parseColor(surf.backgroundColor)
  return { label, found: true, color: c.raw, alpha: c.alpha, blurPx: blurOf(surf.backdropFilter), bf: surf.backdropFilter, display: surf.display }
}

console.log('\n===== 人读表（computed 值；无头 Firefox 本机**不合成** backdrop-filter ⇒ 这里只说明"声明了什么"，不是像素）=====')
console.log('场景'.padEnd(14) + '| ' + '左栏 sidebarCol'.padEnd(34) + '| ' + '标题栏（可见优先，否则记隐藏态）'.padEnd(62) + '| ' + '右栏 rightPanel'.padEnd(30) + '| dockStrip'.padEnd(26) + '| 聊天区 bg')
for (const rec of result.scenarios) {
  const g = (k) => (rec.closed ? rec.closed.surfaces[k] : null)
  const fmt = (surf) => {
    const r = row('', surf)
    if (!r.found) return '（不存在）'
    const a = r.alpha === null ? '?' : r.alpha.toFixed(2)
    const bl = r.blurPx === null ? '无' : (typeof r.blurPx === 'number' ? r.blurPx + 'px' : String(r.blurPx).slice(0, 10))
    return (r.color || '').replace(/\s+/g, '') + ' α=' + a + ' blur=' + bl
  }
  const chat = (() => { const s = g('scrollBody'); if (!s || !s.found) return '（不存在）'; const c = parseColor(s.backgroundColor); return (c.raw || '').replace(/\s+/g, '') + ' α=' + (c.alpha === null ? '?' : c.alpha.toFixed(2)) })()
  const hdrCell = (() => {
    const c = rec.closed || {}
    const sf = c.surfaces || {}
    const one = (surf, tag) => {
      if (!surf || !surf.found) return null
      const col = parseColor(surf.backgroundColor)
      const bl = blurOf(surf.backdropFilter)
      return tag + col.raw.replace(/\s+/g, '') + ' α=' + (col.alpha === null ? '?' : col.alpha.toFixed(2)) + ' blur=' + (bl === null ? '无' : (typeof bl === 'number' ? bl + 'px' : String(bl).slice(0, 8)))
    }
    const exactVis = sf.header && sf.header.found && sf.header.display !== 'none' ? one(sf.header, '.wSkVaW_header ') : null
    const frostVis = sf.headerFrost && sf.headerFrost.found && sf.headerFrost.display !== 'none' ? one(sf.headerFrost, '.mpw-hdrFrost ') : null
    if (exactVis) return (exactVis + (frostVis ? ' + ' + frostVis : '')).slice(0, 60)
    if (frostVis) return frostVis.slice(0, 60)
    const anyVis = ((c.discovered || {}).headerLike || []).find((x) => x && x.visible)
    if (anyVis) return ('〔发现〕' + String(anyVis.cls).split(' ')[0] + ' ' + String(anyVis.bg).replace(/\s+/g, '') + ' blur=' + (blurOf(anyVis.bf) === null ? '无' : blurOf(anyVis.bf) + 'px')).slice(0, 60)
    const hidden = sf.header && sf.header.found ? ('.wSkVaW_header 隐藏(' + String(sf.header.display) + ')') : '（不在 DOM）'
    const anyHidden = ((c.discovered || {}).headerLike || [])[0]
    return (hidden + (anyHidden ? ' / ' + String(anyHidden.cls).split(' ')[0] + ' ' + String(anyHidden.bg).replace(/\s+/g, '') : '')).slice(0, 60)
  })()
  console.log(rec.id.padEnd(14) + '| ' + fmt(g('sidebarCol')).padEnd(34) + '| ' + hdrCell.padEnd(62) + '| ' + fmt(g('rightPanel')).padEnd(30) + '| ' + fmt(g('dockStrip')).padEnd(26) + '| ' + chat)
}

/* ── 关键档小表（主对话要的"左栏/标题栏/右栏 × 关键 4 档"） ───────────────────── */
{
  const cell = (surf) => {
    if (!surf || !surf.found) return '（不在 DOM）'
    const c = parseColor(surf.backgroundColor)
    const bl = blurOf(surf.backdropFilter)
    return c.raw.replace(/\s+/g, '') + ' α=' + (c.alpha === null ? '?' : c.alpha.toFixed(2)) + ' blur=' + (bl === null ? '无' : (typeof bl === 'number' ? bl + 'px' : String(bl).slice(0, 8))) + (surf.display === 'none' ? ' [display:none]' : '')
  }
  console.log('\n===== 关键档（' + KEY4.join(' / ') + '）：左栏 / 标题栏 / 右栏 / dock / 聊天区 =====')
  for (const id of KEY4) {
    const rec = result.scenarios.find((x) => x.id === id)
    if (!rec) { console.log('  ' + id + '  （不在本次矩阵里）'); continue }
    const q = rec.closed ? rec.closed.surfaces : {}
    const lay = rec.layout ? rec.layout.after : {}
    const anyVis = ((rec.closed || {}).discovered || {}).headerLike ? (((rec.closed || {}).discovered.headerLike || []).find((x) => x && x.visible) || {}) : {}
    console.log('  ' + id + ' [' + (rec.patch ? ('amt=' + rec.patch.unifyAmount + ' side=' + rec.patch.sidebarAlpha + ' follow=' + rec.patch.blurFollowUnify) : '') + ']'
      + ' layout(session=' + (lay.sessionRows || 0) + ',header可见=' + ((lay.headerExactVisible || 0) + '/' + (lay.headerAnyVisible || 0)) + ',右栏=' + (lay.rightPanelVisible || 0) + ',dock=' + (lay.dockStripVisible || 0) + ')')
    console.log('     左栏: ' + cell(q.sidebarCol) + '   标题栏: ' + (cell(q.header) + (q.headerFrost && q.headerFrost.found ? ' + ' + cell(q.headerFrost) : '') + (anyVis.cls ? '  〔可见 _header: ' + String(anyVis.cls).split(' ')[0] + ' ' + String(anyVis.bg).replace(/\s+/g, '') + '〕' : '')))
    console.log('     右栏: ' + cell(q.rightPanel) + '   dock: ' + cell(q.dockStrip) + '   聊天区: ' + cell(q.scrollBody))
    console.log('     设置打开时左栏: ' + (rec.dialogDelta ? cell({ found: true, backgroundColor: rec.dialogDelta.sidebarCol.open.bg, backdropFilter: rec.dialogDelta.sidebarCol.open.bf }) : '（未开）'))
  }
}

const okN = result.scenarios.filter((s) => s.ok).length
const failN = result.scenarios.length - okN
const mismatch = result.scenarios.filter((s) => s.effectiveMismatch).length
const dialogs = result.scenarios.filter((s) => s.dialog && s.dialog.state && s.dialog.state.open).length
console.log('\n探针完成：场景 ' + okN + '/' + result.scenarios.length + ' 采集成功' + (failN ? '（失败 ' + failN + '）' : '')
  + '；设置面板打开 ' + dialogs + ' 个场景；effectiveMismatch ' + mismatch + ' 个'
  + '；可见态：会话行>0 的场景 ' + result.scenarios.filter((s) => s.layout && s.layout.after.sessionRows > 0).length + '/' + result.scenarios.length
  + '（标题栏可见 ' + result.scenarios.filter((s) => s.layout && (s.layout.after.headerExactVisible > 0 || s.layout.after.headerAnyVisible > 0)).length + '）'
  + '；宿主 settings 写回：拦掉 ' + result.hostWritesBlocked + ' 次 / 实际发出 ' + result.hostPuts + ' 次'
  + '；settings.json ' + (result.settingsFile ? (result.settingsFile.unchanged ? '逐字节未变 ✓' : ('变了（before ' + result.settingsFile.before + ' → after ' + result.settingsFile.after + '，按快照还原=' + result.settingsFile.restoredFromSnapshot + '）')) : '不存在')
  + (result.restore ? '；还原用户设置 ' + (result.restore.ok === true ? '✓' : (result.restore.keep ? '（--keep 跳过）' : '✗ ' + JSON.stringify(result.restore))) : ''))
console.log('JSON: ' + path.relative(PLUGIN, OUT) + '（' + fs.statSync(OUT).size + ' B）')
if (result.blocked) { console.log('✗ blocked:' + result.blocked.why); process.exit(2) }
if (result.fatal) { console.log('✗ 探针异常：' + result.fatal.split('\n')[0]); process.exit(3) }
process.exit(failN ? 3 : 0)
