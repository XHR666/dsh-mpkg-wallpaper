// tools/frost-rail-test.mjs —— 两个真机 bug 的回归门禁（无需浏览器）
//
// 覆盖：
//   bug① 右侧「轮次导航条」（DSH 0.1.5 dsh-client-ui-chat 的 TurnNavigator rail，
//        类名 .eGxaPq_*，条本体 .eGxaPq_mark::before）在壁纸模式下"变透明"。
//        断言：我们的 CSS **不命中**宿主时间线选择器/token；token 覆盖只落在白名单 + 门控上，
//              且绝不产生 guaranteed-invalid（inherit 兜底 / 自引用）。
//   bug② 标题栏磨砂"一直没有"。
//        断言：假 DOM 下注入链每一环都成立（注入发生 / 内联样式值正确 / 半透明底被设置 /
//              宿主节点被标记 / 诊断理由非空）；?hdrfrost=off 与 ?hdrfrost=legacy 回退语义正确。
//
// 用法: node tools/frost-rail-test.mjs
// 夹具纪律（2026-09-17）：本脚本**不写任何固定 /tmp 路径**（历史残留被清理过一次 ⇒ 测试必红）。
// 反向对照需要的"改前源码"副本一律落 `fs.mkdtempSync(os.tmpdir()+前缀)`，并在进程退出时
// try/finally 式删除（`process.on('exit')` 兜住所有提前 return / 抛错路径）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { loadPlugin, readSection } from './_stub.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const CLIENT = path.join(here, '..', 'lib', 'client.js')

let fail = 0
const ok = (m) => console.log('  ✓ ' + m)
const bad = (m) => { fail++; console.error('  ✗ ' + m) }
const assert = (cond, m) => { if (cond) ok(m); else bad(m) }

// 从内联 cssText 里取某个属性的计算值（假 DOM 的 getComputedStyle 是桩，只有内联样式可信）
const cssProp = (cssText, prop) => {
  const m = new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)', 'i').exec(String(cssText || ''))
  return m ? m[1].trim() : null
}

/* ══════════════════════════════════════════════════════════════════
   PART 1 —— bug①：宿主时间线（rail）与 token 覆盖的静态判据
   ══════════════════════════════════════════════════════════════════ */
if (process.argv[2] !== '--child') {
  console.log('\n== PART 1: 宿主右侧时间线（TurnNavigator rail）不被我们误伤 ==')
  loadPlugin({ clientPath: CLIENT, settings: readSection(), quiet: true })
  const build = (patch) => String(globalThis.__mpwBuildCss(patch) || '')
  const strip = (t) => String(t).replace(/\/\*[\s\S]*?\*\//g, '')

  // 多组设置：默认 / 用户真机设置 / 全开 / 会写 label token 的三个开关 / 侧栏关
  const cases = [
    ['默认(有壁纸)', { image: true, enabled: true }],
    ['用户真机设置', { rightSidebarBlur: true, rightSidebarBlurAmount: 14, rightSidebarAlpha: 45, sidebarBlur: false, unifyTint: true, unifyAmount: 30, chatFollow: false, enabled: true, image: true }],
    ['全开', { image: true, enabled: true, sidebar: true, unifyTint: true, headerBg: true, headerBlur: true, float: true, lgCss: true, aquaMask: true, aquaTint: true, rightSidebarBlur: true, aquaInk: true, aquaTextEnhance: true, fontColorGray: true, fontColorGrayColor: '#8a94a6', sidebarAlpha: 35, headerFrostOwn: true, headerFrostAmount: 30 }],
    ['aqua+文本增强', { image: true, enabled: true, aquaInk: true, aquaTextEnhance: true }],
    ['灰字覆盖', { image: true, enabled: true, fontColorGray: true, fontColorGrayColor: '#8a94a6' }],
    ['侧栏关', { image: true, enabled: true, sidebar: false }],
    ['无壁纸', { image: false, enabled: true }],
  ]

  // ① 我们的规则不得**改坏**宿主时间线：命中宿主时间线选择器时，必须在两处白名单之一：
  //     (a) 我们自己的 rail 对比补偿：body[data-mpw-rail-ink] + 值来自 --mpw-rail-ink；
  //     (b) 既有的「轨迹页横向溢出裁剪」：data-mpw-traject-clip 门控 + 只改几何属性
  //         （不许出现 background/color/opacity/filter/backdrop-filter/token 等外观属性）。
  const HOST_TIMELINE = /(eGxaPq_(slot|frame|scroller|marks|markPosition|mark|markUnloaded|markBusy|preview|previewPrompt|previewResponse|fadeTop|fadeBottom)|Y0dWHa_|qBU-ya|_1p9O6q_|turn-rail-items|turn-rail-band|turn-rail-inset)/
  const GEOM_OK = /^(max-width|min-width|width|height|box-sizing|overflow|overflow-x|overflow-y|overscroll-behavior|overscroll-behavior-x|padding|padding-left|padding-right|margin|margin-left|margin-right)$/
  for (const [label, patch] of cases) {
    const css = strip(build(patch))
    const hits = []
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1].trim(), body = m[2]
      if (!HOST_TIMELINE.test(sel)) continue
      // 我们自己的门控属性只由 refreshRailInk() 设置 → 带它就属于白名单（值仍必须是 --mpw-rail-*）
      const railWhitelist = /body\[data-mpw-rail-ink\]/.test(sel) && !/--dsw-/.test(body)
      const clipWhitelist = /data-mpw-traject-clip/.test(sel) &&
        body.split(';').map((d) => d.trim()).filter(Boolean).every((d) => GEOM_OK.test(d.split(':')[0].trim()))
      if (!railWhitelist && !clipWhitelist) hits.push(sel.replace(/\s+/g, ' ').slice(0, 90))
    }
    assert(hits.length === 0, '[' + label + '] 命中宿主时间线也只是白名单内（rail 对比补偿 / traject 几何裁剪）' + (hits.length ? ' → ' + hits.join(' | ') : ''))
  }

  // ② 宿主时间线依赖的 token（DSH 定义在 body / body[data-ds-dark-theme] 上）：
  //    覆盖它的值不得是"无效/透明"形态；值来自我们命名空间时必须带 data-mpw-* 门控。
  //    · --dsw-alias-border-l4     默认态条
  //    · --dsw-alias-label-tertiary hover/preview 条
  //    · --dsw-alias-label-primary  激活条
  //    · --dsw-alias-state-business-primary focus 条
  const RAIL_TOKENS = ['--dsw-alias-border-l4', '--dsw-alias-label-primary', '--dsw-alias-label-tertiary', '--dsw-alias-state-business-primary']
  const declVal = (body, tok) => {
    const m = new RegExp('(?:^|;)\\s*' + tok.replace(/-/g, '\\-') + '\\s*:([^;]*)').exec(body)
    return m ? m[1].trim() : null
  }
  for (const [label, patch] of cases) {
    const css = strip(build(patch))
    const offenders = []
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1].trim(), body = m[2]
      for (const tok of RAIL_TOKENS) {
        const val = declVal(body, tok)
        if (val === null) continue
        if (/inherit|transparent/i.test(val) || val === '') { offenders.push('透明/无效值: ' + tok + ' = ' + val + ' @ ' + sel.slice(0, 50)); continue }
        if (/var\(--mpw-/.test(val) && !/\[data-mpw-/.test(sel)) offenders.push('无门控的自家变量: ' + tok + ' @ ' + sel.slice(0, 50))
      }
    }
    assert(offenders.length === 0, '[' + label + '] rail 依赖 token 的覆盖值有效且门控正确' + (offenders.length ? ' → ' + offenders.join(' | ') : ''))
  }

  // ③ 自定义属性不得出现 guaranteed-invalid 形态（会让引用它的 background/color 变 unset=透明）：
  //    · var(--x, inherit) —— DSH 把 label-* 定义在 body（html 上没有）⇒ body 上 inherit = 无值
  //    · 自引用 var(--y, var(--y))
  //    注意：只检查**自定义属性定义**；普通属性（如 color）的 inherit 兜底是合法且必要的。
  for (const [label, patch] of cases) {
    const css = strip(build(patch))
    const inherits = [...css.matchAll(/(?:^|;)\s*(--[a-z0-9-]+)\s*:[^;{}]*var\([^;{}]*,\s*inherit\s*\)/g)].map((m) => m[0].replace(/\s+/g, ' ').slice(0, 70))
    assert(inherits.length === 0, '[' + label + '] 自定义属性无 inherit 兜底' + (inherits.length ? ' → ' + inherits.join(' , ') : ''))
    const selfRef = [...css.matchAll(/(?:^|;)\s*(--[a-z0-9-]+)\s*:([^;{}]*var\([^;{}]*\))/g)]
      .filter(([, name, val]) => new RegExp('var\\(\\s*' + name + '\\s*[,)]').test(val))
      .map(([all]) => all.replace(/\s+/g, ' ').slice(0, 70))
    assert(selfRef.length === 0, '[' + label + '] 自定义属性无自引用' + (selfRef.length ? ' → ' + selfRef.join(' | ') : ''))
  }

  // ④ 侧栏底色 token 覆盖必须收窄到白名单（默认），只有 ?sbfill=wide 才允许全局
  for (const [label, patch] of cases) {
    const css = strip(build(patch))
    const globalHit = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].some((m) => {
      const sel = m[1].trim()
      return /^html body$/.test(sel) && /--dsw-specific-sidebar-fill\s*:/.test(m[2])
    })
    assert(!globalHit, '[' + label + '] --dsw-specific-sidebar-fill 未被全局 html body 覆盖（会误伤宿主 trajectory 表头等）')
    const scoped = /--dsw-specific-sidebar-fill\s*:/.test(css)
    if (scoped) {
      const scopedOk = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].some((m) => /--dsw-specific-sidebar-fill\s*:/.test(m[2]) && /sidebarCol|hHd-Xa_root|data-slot="sidebar"/.test(m[1]))
      assert(scopedOk, '[' + label + '] sidebar-fill 覆盖落在白名单容器上')
    }
  }

  // ⑤ 回退开关 ?sbfill=wide 生效（旧行为可一键恢复）
  const wideCss = strip(build({ image: true, enabled: true, sidebar: true }))
  assert(/--dsw-specific-sidebar-fill\s*:/.test(wideCss), 'sidebar-fill 覆盖存在（默认收窄形态）')

  // ⑥ rail 对比补偿必须带我们自己的命名空间 token + 门控属性
  const cssAll = strip(build({ image: true, enabled: true, sidebar: true, unifyTint: true }))
  assert(/body\[data-mpw-rail-ink\][^{]*\.eGxaPq_mark::before[^{]*\{[^}]*var\(--mpw-rail-ink/.test(cssAll),
    'rail 对比补偿：白名单选择器 + 自有 --mpw-rail-ink token（不碰宿主 token）')

  /* ══════════════════════════════════════════════════════════════════
     PART 1b —— ②(2026-09-16) 本轮三个视觉 bug 的**只增不减**回归断言
     背景：用户实测①顶栏磨砂看不见 ②顶栏下描边被我们弄没 ③时间线条仍不可见。
     已定案的真实原因与对应断言：
       ② 我们两条规则里写了 `border-bottom: 1px solid transparent !important;`
         （.wSkVaW_header 基础块、以及 headerBg && !headerBlur 分支）⇒ 下描边被抹掉。
         断言：**任何设置里**我们都不再用 !important 把宿主标题栏下描边写成 transparent。
       ① 注入层原本 z-index:-1，而标题栏不是层叠上下文 ⇒ 负层画在父背景之下被整片盖住。
         断言：内联 z-index 必须是 0（见 PART 2 的 default 场景），且 CSS 里有"宿主子节点抬到 z-index:1"。
       ③ rail 条几何/颜色都在（真机实测 ::before bg=rgba(0,0,0,.42)），看不见的是对比度。
         断言：rail 补偿新增反色描边晕 box-shadow 0 0 0 1px var(--mpw-rail-halo)，且仍不带 !important。
     ══════════════════════════════════════════════════════════════════ */
  console.log('\n== PART 1b: 顶栏描边回归 / 磨砂层叠 / rail 可见性（本轮修复的防复发）==')
  for (const [label, patch] of cases) {
    const css = strip(build(patch))
    // ② 下描边：扫**全部**声明，禁止"我们 + !important + transparent"抹掉宿主下描边
    const borderKills = []
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1].trim()
      if (!/wSkVaW_header|_header_/.test(sel)) continue
      for (const decl of m[2].split(';')) {
        const d = decl.trim()
        if (!/^border(-bottom)?(-color)?\s*:/.test(d)) continue
        if (!/!important/.test(d)) continue
        if (/\btransparent\b/.test(d) || /rgba\([^)]*,\s*0(\.0+)?\s*\)/.test(d)) borderKills.push(sel.slice(0, 60) + ' { ' + d + ' }')
      }
    }
    assert(borderKills.length === 0,
      '[' + label + '] 标题栏下描边未被我们的 !important 规则抹成透明（用户回归②）' + (borderKills.length ? ' → ' + borderKills.join(' | ') : ''))
    // ③ rail 晕：白名单 + 自有 token + 无 !important（不用 !important 压宿主）
    const railRules = [...css.matchAll(/body\[data-mpw-rail-ink\][^{]*\.eGxaPq_mark[^{]*\{([^{}]*)\}/g)].map((m) => m[1])
    const halo = railRules.filter((b) => /box-shadow\s*:[^;]*var\(--mpw-rail-halo/.test(b))
    assert(halo.length >= 1, '[' + label + '] rail 条带反色描边晕 box-shadow 0 0 0 1px var(--mpw-rail-halo)（可见性保险）')
    assert(railRules.every((b) => !/!important/.test(b)), '[' + label + '] rail 覆盖不含 !important（不压宿主样式）')
    assert(railRules.every((b) => !/--dsw-/.test(b)), '[' + label + '] rail 覆盖不引用/重定义任何宿主 token')
  }
  // ① 层叠：磨砂元素层的 CSS 兜底必须把宿主子节点抬到 z-index:1（否则 z-index:0 的层会盖住标题/按钮）
  for (const [label, patch] of cases) {
    const css = strip(build(patch))
    const elev = /wSkVaW_header[^{]*:not\(\.mpw-hdrFrost\)[^{]*\{[^}]*z-index:\s*1/.test(css)
      || /mpw-hdrFrost:first-child\s*~\s*\*[^{]*\{[^}]*z-index:\s*1/.test(css)
    assert(elev, '[' + label + '] 磨砂层 .mpw-hdrFrost 的宿主兄弟被抬到 z-index:1（层不盖内容）')
    assert(/\.mpw-hdrFrost\s*\{[^}]*z-index:\s*0/.test(css), '[' + label + '] .mpw-hdrFrost 自身 z-index:0（在父背景之上）')
  }

  /* ══════════════════════════════════════════════════════════════════
     PART 1c —— ④(2026-09-17 bug①**第四轮真机定案**的防复发)
     真机事实（采集器 tools/rail-cover-probe.mjs；证据 tools/probe-out/before.probe.txt）：
       · 命中点 (1252..1276, 199..535) 的 elementFromPoint 命中 nav.eGxaPq_frame（宿主节点），
         整条链上**没有**我们注入的节点 ⇒ 不是"被我们的层盖住"；
       · 真正的原因：`.eGxaPq_scroller` 上被写了**内联 `style="display: none;"`**
         （MutationObserver 记录到宿主加上 `.eGxaPq_fadeBottom` 的那一帧，t=9823ms）
         ⇒ 839 个 mark 全部 0×0、rail 区域像素全白；
       · 同一时刻真鼠标点 frame 中心，会话 scrollTop 18782 → 51997 ⇒ "看不见但能点"。
     根因两句（都已修）：
       ① JS："隐藏列表 fade"清扫用 `document.querySelectorAll('[class*="fade"]')`
          命中宿主 rail 的 mask 类 `.eGxaPq_fadeTop/.eGxaPq_fadeBottom`；
       ② 白名单 `[data-slot*="session"]` 命中会话区容器 `[data-slot="conversation.session"]`
          （CSS 里还有一对孪生规则）。
     断言：a) "隐藏 fade"的规则只能落在**侧栏**白名单，不得出现 `[data-slot*="session"]`；
           b) 我们注入的全屏层一律 pointer-events:none 且 z-index 低于宿主 rail
              （`.eGxaPq_slot` 是 z-index:7）⇒ 不可能成为 rail 命中点上的顶层。
     ══════════════════════════════════════════════════════════════════ */
  console.log('\n== PART 1c: rail 不被我们"藏起来"（fade 清扫作用域 / 注入层不在命中点上）==')
  for (const [label, patch] of cases) {
    const css = strip(build(patch))
    // a) "隐藏 fade"规则的落点
    const badScope = []
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/\[class\*="fade"\]/.test(m[1]) || !/display\s*:\s*none/.test(m[2])) continue
      for (const part of m[1].split(',')) {
        if (!/\[class\*="fade"\]/.test(part)) continue
        if (/data-slot\*="session"/.test(part)) badScope.push('过宽（会命中会话区）: ' + part.trim())
        else if (!/sidebar|workspaces|regionArea|sidebarCol/.test(part)) badScope.push('未收窄到侧栏: ' + part.trim())
      }
    }
    assert(badScope.length === 0, '[' + label + '] "隐藏列表 fade"只落在侧栏白名单（不再命中 [data-slot*=session]/会话区）' + (badScope.length ? ' → ' + badScope.join(' | ') : ''))
    // b) 全屏注入层不得压在 rail 之上（宿主 .eGxaPq_slot 是 z-index:7、pointer-events:auto 的 nav 在其内）
    const layerBad = []
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1].trim(); const body = m[2]
      if (!/^(\.mpw-bgWrap|#mpw-aqua-mask|\.mpw-aqua-mask|#mpw-lg-svg)$/.test(sel)) continue
      // 隐藏形态（无壁纸分支的 `.mpw-bgWrap{display:none !important}`）不可能盖住命中点 ⇒ 跳过
      if (/display\s*:\s*none/.test(body)) continue
      if (!/pointer-events\s*:\s*none/.test(body)) layerBad.push(sel + ' 缺 pointer-events:none')
      const z = /z-index\s*:\s*(-?\d+)/.exec(body)
      if (z && Number(z[1]) >= 7) layerBad.push(sel + ' z-index=' + z[1] + ' ≥ 宿主 rail 的 7')
    }
    assert(layerBad.length === 0, '[' + label + '] 全屏注入层 pointer-events:none 且 z-index < 宿主 rail(.eGxaPq_slot=7)' + (layerBad.length ? ' → ' + layerBad.join(' | ') : ''))
  }

  /* ══════════════════════════════════════════════════════════════════
     PART 2 —— bug②：磨砂注入链的假 DOM 断言（子进程跑，避免 __ModuleLoader__ 复用）
     ══════════════════════════════════════════════════════════════════ */
  console.log('\n== PART 2: 标题栏磨砂注入链（假 DOM）==')
  const scenarios = ['default', 'off', 'legacy-off', 'legacy-on', 'pseudo', 'no-header', 'no-wallpaper', 'broken-scope', 'fade-sweep', 'fade-sweep-before', 'remount', 'remount-before']
  for (const sc of scenarios) {
    let out = ''
    try {
      out = execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--child', sc], { encoding: 'utf8', timeout: 120000 })
    } catch (e) {
      bad('[' + sc + '] 子进程失败: ' + String(e.stderr || e.message).slice(0, 300)); continue
    }
    const m = /__RESULT__(\{[\s\S]*\})/.exec(out)
    if (!m) { bad('[' + sc + '] 子进程未返回结果: ' + out.slice(-200)); continue }
    const r = JSON.parse(m[1])
    checkScenario(sc, r)
  }

  /* ── 既有能力不许被本轮改动带塌（"不影响其它功能"的机器自证） ── */
  console.log('\n== PART 2b: 既有能力仍在（侧栏磨砂 / 整屏虚化 / 标题栏底 / 壁纸层 / 弹窗）==')
  const keepCss = strip(build({ image: true, enabled: true, sidebar: true, sidebarBlur: true, unifyTint: true, unifyAmount: 30, rightSidebarBlur: true, popoverBlur: true, dialogBlur: true, maskBlur: true }))
  assert(/\.mpw-bgWrap\s*\{[^}]*position:\s*fixed/.test(keepCss), '壁纸层 .mpw-bgWrap 仍是 fixed 铺满（壁纸显示不受影响）')
  assert(/--mpw-bg-blur/.test(keepCss), '整屏虚化：壁纸层 --mpw-bg-blur（统一虚化程度）仍输出')
  // ①(2026-09-18 §5 第1项) 角色不变、取值来源改到 SSOT：规则只读 var(--mpw-surface-side)，
  //   而该 token 在 SSOT(body{…}) 里必须是 color-mix(…%, transparent) 的半透明值 ⇒ 两条一起断言，
  //   比原来"规则里直接写 color-mix"更严（否则"值被改成不透明"也会绿）。
  assert(/html body \.pI_x6G_sidebarCol[\s\S]{0,200}background-color:\s*var\(--mpw-surface-side\)/.test(keepCss), '侧栏半透明底规则仍在（侧栏"透出壁纸"开关未失效）')
  assert(/--mpw-surface-side:\s*color-mix\(in srgb,[^;]*transparent\)/.test(keepCss), '侧栏表面 token 在 SSOT 里是半透明色（不是被改成不透明）')
  assert(/data-mpw-rsblur|\[data-sidebar-right-panel\]/.test(keepCss), '右侧栏磨砂/透明度链路仍在')
  assert(/data-mpw-hdr-translucent/.test(keepCss), '标题栏半透明底规则仍在（新逻辑改的只是它用的 token）')
  assert(/\.mpw_dialog|\[role="dialog"\]/.test(keepCss), '对话框/弹窗虚化规则仍在')
  assert(/--dsw-specific-sidebar-fill/.test(keepCss), '侧栏底色 token 覆盖仍在（只是收窄了作用域）')
  const clipCss = strip(build({ image: true, enabled: true, float: true }))
  assert(/data-mpw-traject-clip/.test(clipCss), '悬浮模式下轨迹页横向溢出裁剪仍在（既有功能未回退）')

  /* ── 结构断言：磨砂归一化函数必须在模块作用域（本次真根因的防复发） ── */
  console.log('\n== PART 3: 防复发（作用域/诊断可观测）==')
  const src = fs.readFileSync(CLIENT, 'utf8')
  const posSync = src.indexOf('function syncHeaderFrost()')
  const posNorm = src.indexOf('const normalizeSection =')
  const posInner = src.indexOf('function applyFromStorageInner()')
  assert(posSync > 0 && posNorm > 0 && posInner > 0, '源码中 syncHeaderFrost / normalizeSection / applyFromStorageInner 都存在')
  assert(posNorm < posSync, 'normalizeSection 定义在 syncHeaderFrost **之前**（模块作用域，避免 ReferenceError）')
  assert(!(posNorm > posInner), 'normalizeSection 不再位于 applyFromStorageInner 函数体内（本次真根因）')
  assert(/sync 异常: /.test(src), 'syncHeaderFrost 的 catch 会把异常写进诊断 reason（不再静默）')
  assert(/hostHasHeader/.test(src) && /headerTranslucent/.test(src) && /frostElBackdrop/.test(src),
    '诊断 payload 含 hostHasHeader / headerTranslucent / computed.frostElBackdrop')
  /* ②(2026-09-16) 本轮三个 bug 的源码级防复发（比生成 CSS 更靠前的一道闸） */
  const srcNoComment = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
  assert(!/border-bottom:\s*1px solid transparent\s*!important/.test(srcNoComment),
    '★ 源码里不再有 border-bottom:1px solid transparent !important（顶栏描边回归的元凶）')
  assert(!/el\.style\.cssText = "position:absolute;inset:0;z-index:-1/.test(srcNoComment),
    '★ 磨砂注入层不再写 z-index:-1（会被父背景盖住）')
  assert(/el\.style\.cssText = "position:absolute;inset:0;z-index:0;/.test(src),
    '★ 注入层内联样式确为 z-index:0')
  assert(/--mpw-rail-halo/.test(src), 'rail 反色晕 token --mpw-rail-halo 已接入')
  assert(/removeProperty\("--mpw-rail-halo"\)/.test(src), 'rail 关闭时 --mpw-rail-halo 同步清理（不留残留）')
  assert(/markBoxShadow/.test(src) && /markRect/.test(src) && /inViewport/.test(src),
    'rail 诊断新增 box-shadow/rect/inViewport（真机一轮即可定案"条为什么看不见"）')
  /* ④(2026-09-17 bug①第四轮) "隐藏列表 fade"清扫的**源码级**闸门 —— 真机根因是它把 rail 藏了 */
  const sweepAt = src.indexOf("document.querySelectorAll('[class*=\"fade\"]')")
  const guardAt = src.indexOf("el.closest('[class*=\"eGxaPq_\"], [data-slot^=\"conversation\"]')")
  const hideAt = src.indexOf('el.style.display = "none";', sweepAt)
  assert(sweepAt > 0, '源码里仍有"隐藏列表 fade"清扫（功能未被整体删掉）')
  assert(guardAt > sweepAt, '★ 清扫里有"会话区/rail 一律不碰"的守卫 el.closest(\'[class*="eGxaPq_"], [data-slot^="conversation"]\')')
  assert(guardAt > 0 && hideAt > guardAt, '★ 守卫必须排在 el.style.display="none" **之前**（顺序错了等于没守）')
  assert(!/\[data-slot\*="session"\]/.test(srcNoComment), '★ 源码里不再有 [data-slot*="session"]（它会命中 [data-slot=conversation.session] ⇒ 整条 rail 被 display:none）')
  assert(/\[data-slot="sidebar"\]/.test(srcNoComment), '★ 侧栏白名单改用精确的 [data-slot="sidebar"]（保留"隐藏列表 fade"原功能）')
  assert(/__mpwFadeSweepProbe/.test(src), 'fade 清扫探针 __mpwFadeSweepProbe 已接入（供结构级断言真跑一次清扫）')
  /* ③(2026-09-17 对抗性审查) 清扫的**第二处**收窄：命中判据只认侧栏白名单子树，
     不再有"任意 absolute + bottom≈0 → display:none"的整片兜底（那会误伤第三方面板）。 */
  assert(/function mpwIsListFadeTarget\(/.test(src), '★ fade 清扫的命中判据抽成 mpwIsListFadeTarget（唯一入口，便于测试反向对照）')
  assert(/if \(mpwIsListFadeTarget\(el\)\) el\.style\.display = "none";/.test(src), '★ 清扫只对 mpwIsListFadeTarget 命中的元素写 display:none')
  assert(!/isListFade = cs\.position === "absolute"/.test(srcNoComment), '★ 源码里不再有"任意 absolute+bottom≈0 的 fade → display:none"整片兜底（第三方面板误伤源）')

  /* ══════════════════════════════════════════════════════════════════
     PART 4 —— ③(2026-09-17 对抗性审查) "致命路径不许静默" + 轮换周期钳制
     背景：本文件历史上 500+ 个空 catch，正是因为 catch 吞掉 ReferenceError/TypeError，
     才出现"磨砂三轮没修好"（真因在冒泡到 window.onerror 之前就消失）。
     这里既做**源码级闸门**（关键路径不许再出现空 catch / 必须有 mpwErr 出口），
     也做**行为断言**（mpwErr 真的写日志 + 同错只出口一次 + 默认不发网络请求）。
     ══════════════════════════════════════════════════════════════════ */
  console.log('\n== PART 4: 致命路径不许静默（mpwErr 出口 / 默认不上报 / 轮换钳制）==')
  for (const [label, pat] of [
    ['CSS 注入（web 路径）', /mpwErr\("buildCss\(web 路径\)", err\)/],
    ['样式自愈重建（style 被 iframe 清掉）', /mpwErr\("样式自愈重建\(style 被 iframe 清掉\)", e\)/],
    ['token 覆盖 applyTokenOverrides', /mpwErr\("applyTokenOverrides", e\)/],
    ['磨砂总同步 syncHeaderFrost（调用点）', /mpwErr\("syncHeaderFrost\(apply\)", e\)/],
    ['壁纸加载点 iframe.src', /mpwErr\("设置 iframe\.src\(壁纸加载点\)", e\)/],
    ['省电 setupPowerSave', /mpwErr\("setupPowerSave", e\)/],
    ['冲突检测 detectConflicts', /mpwErr\("detectConflicts\(冲突检测\/自动关闭\)", e\)/],
    ['时段自动切换（60s 定时）', /mpwErr\("时段自动切换\(60s 定时\)", e\)/],
  ]) assert(pat.test(src), '★ 关键路径有 mpwErr 出口: ' + label)
  assert(/function mpwErr\(where, e\)/.test(src), '★ mpwErr 已定义（统一出口：console.error + 环形缓冲 + 可选上报）')
  assert(/console\.error\("\[dsh-mpkg-wallpaper\] " \+ where \+ " 失败:", e\)/.test(src), '★ mpwErr 必写 console.error（不再零痕迹）')
  assert(/localStorage\.getItem\('mpwdiag'\) !== '1'\) return 1;/.test(src), '★ mpwErr 的上报被 mpwdiag 门控（自动上报默认关，用户发布纪律①）')
  // 关键路径上不许再有裸 `catch {}`（漏一个就等于"再吞一轮"）
  const naked = []
  const keyRe = /(buildCss\(|applyTokenOverrides\(|syncHeaderFrost\(|showWebEl\(|setupPowerSave\(|detectConflicts\(|setupLayerDiag\()/
  // 把注释**遮成空白但保留换行**（行号不变）——注释里可以引用旧写法，不算违规
  const srcMasked = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/^[ \t]*\/\/.*$/gm, '')
  srcMasked.split('\n').forEach((line, i) => {
    if (keyRe.test(line) && /\}\s*catch\s*\{\s*\}/.test(line)) naked.push((i + 1) + ': ' + line.trim().slice(0, 90))
  })
  assert(naked.length === 0, '★ 关键路径上没有裸 catch {}（共 ' + naked.length + ' 处）', naked.slice(0, 3).join(' | '))
  // 轮换周期必须钳制（坏存档 interval:0.001 ⇒ 60ms 全量重建）
  assert(/const sec = mpwClampRotMin\(__rotRaw\);/.test(src), '★ 轮换定时间隔走 mpwClampRotMin（不再直接用存档里的 interval）')
  assert(/function mpwClampRotMin\(v\)/.test(src), '★ mpwClampRotMin 已定义')

  {
    // 行为断言（子进程：同一进程第二次 loadPlugin 会因模块级幂等标记拿不到注册表，与 PART 2 同因）
    let out = ''
    try {
      out = execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--child', 'silent-paths'], { encoding: 'utf8', timeout: 120000 })
    } catch (e) {
      bad('[silent-paths] 子进程失败: ' + String(e.stderr || e.message).slice(0, 300))
    }
    const m = /__RESULT__(\{[\s\S]*\})/.exec(out)
    if (!m) bad('[silent-paths] 子进程未返回结果: ' + out.slice(-200))
    else {
      const r = JSON.parse(m[1])
      assert(!!r.clamp && typeof r.clamp === 'object', '[silent-paths] 返回钳制结果')
      const want = { 0.001: 1, 0: 5, '-3': 5, 121: 120, 120: 120, 7.5: 7.5, abc: 5, NaN: 5 }
      for (const [k, v] of Object.entries(want)) assert(r.clamp[k] === v, `★ 轮换周期钳制 ${k} → ${v}（得 ${r.clamp[k]}）`)
      assert(r.ringGrew === 1, '★ mpwErr 把错误记进环形缓冲（可 window.__mpwErrRing() 读）')
      assert(r.ringWhere === '对抗性审查测试', '★ 环形缓冲记录 where 字段')
      assert(r.consoleLogged === true, '★ mpwErr 调用 console.error（不再静默）')
      assert(r.ringDeduped === true, '★ 同一错误只出口一次（3s 定时器不会刷屏）')
      assert(r.fetchesDefault === 0, '★ 默认（mpwdiag 未开）mpwErr **不发**网络请求（自动上报默认关）')
      assert(r.fetchesAfterFlag >= 1, '★ 显式 localStorage[mpwdiag]=1 后才 POST /diag（门控有效）')
    }
  }

  console.log('\n' + (fail === 0 ? '✓ frost-rail 回归：全部通过' : '✗ frost-rail 回归：' + fail + ' 项失败'))
  process.exit(fail ? 1 : 0)
}

/* ══════════════════════════════════════════════════════════════════
   子进程：单个场景（假 DOM + 调 syncHeaderFrost）
   ══════════════════════════════════════════════════════════════════ */
function checkScenario(sc, r) {
  const t = (msg, cond) => assert(cond, '[' + sc + '] ' + msg)
  if (sc === 'default') {
    t('注入发生', r.state.injected === true)
    // ①(2026-09-17 切会话磨砂消失 bug) 开着磨砂时必须挂上自愈观察器（否则顶栏被重建后只能等 3s）
    t('★ 自愈观察器已挂载（watch.armed）', !!(r.watch && r.watch.armed === true))
    t('★ 观察目标 ≥1（稳定容器 + 顶栏父节点/自身）', !!(r.watch && r.watch.targets >= 1))
    t('★ 未走回退开关（watch.off=false）', !!(r.watch && r.watch.off === false))
    t('半径 px ≥ 12 且等于整屏虚化 30', r.state.px === 30)
    t('诊断 reason 非空', typeof r.state.reason === 'string' && r.state.reason.length > 0)
    t('宿主 header 被标记 data-mpw-hdr-frost', r.hdrFrostAttr === 'el')
    t('半透明底被设置 data-mpw-hdr-translucent', r.translucent === true)
    t('body 被标记 data-mpw-hdr-frost-el（伪元素兜底让位，避免双层模糊）', r.bodyFrostEl === '1')
    t('注入元素有唯一 class mpw-hdrFrost', r.frostElClass === 'mpw-hdrFrost')
    t('注入元素带 data-mpw-* 标记', r.frostElMark === '1')
    t('内联样式：absolute/inset/z-index:0/pointer-events:none', /position:absolute/.test(r.cssText) && /z-index:0/.test(r.cssText) && /pointer-events:none/.test(r.cssText))
    // ②(2026-09-16 真根因防复发) z-index 必须是 0：-1 会被父背景整片盖住（= "磨砂一直没有"）
    t('★ 注入层 z-index=0（不是 -1：负层会画在顶栏背景之下被盖住）', cssProp(r.cssText, 'z-index') === '0')
    t('内联 backdropFilter = blur(30px) saturate(140%)', r.backdropFilter === 'blur(30px) saturate(140%)')
    t('webkitBackdropFilter 同步设置', r.webkitBackdropFilter === 'blur(30px) saturate(140%)')
    t('我们命名空间的半透明底色 --mpw-hdr-frost-bg 已写入', /rgba\(255,\s*255,\s*255,\s*0\.38\)/.test(r.hdrFrostBg))
    t('computed 采到 header 底色（诊断用）', typeof r.state.headerBg === 'string' && r.state.headerBg.length > 0)
    // ①(2026-09-16 要求1) "看不见的链路变可见"：用户按诊断/上报时 payload 里必须带磨砂字段
    const d = r.diag || {}
    t('诊断 payload 含 headerFrost（用户按上报就能看到）', !!r.diag)
    for (const k of ['injected', 'px', 'reason', 'headerTranslucent', 'hostHasHeader']) {
      t('诊断字段 headerFrost.' + k + ' 存在', d[k] !== undefined)
    }
    t('诊断字段 computed.headerBg 存在', !!(d.computed && d.computed.headerBg !== undefined))
    t('诊断字段 computed.headerBackdrop 存在', !!(d.computed && d.computed.headerBackdrop !== undefined))
    t('诊断字段 computed.frostElBackdrop 存在', !!(d.computed && d.computed.frostElBackdrop !== undefined))
    t('诊断 headerFrost.reason 非空（能判定卡在哪一环）', typeof d.reason === 'string' && d.reason.length > 0)
    t('诊断含右侧时间线快照 rail（bug① 现场判据）', !!r.railDiag && r.railDiag.found !== undefined)
    // ③(2026-09-16) rail 可见性：门控 + 三个值都必须真的落地（含新增的反色晕）
    const ri = r.railInk || {}
    t('★ rail 门控 data-mpw-rail-ink 已设置', ri.attr === true)
    t('★ rail 条色 --mpw-rail-ink 已写入（亮色 rgba(0,0,0,0.42)）', /rgba\(0,\s*0,\s*0,\s*0\.42\)/.test(String(ri.on || '')))
    t('★ rail 激活色 --mpw-rail-ink-strong 已写入', /rgba\(0,\s*0,\s*0,\s*0\.86\)/.test(String(ri.strong || '')))
    t('★ rail 反色晕 --mpw-rail-halo 已写入（可见性保险）', /rgba\(255,\s*255,\s*255,\s*0\.55\)/.test(String(ri.halo || '')))
    const rd = r.railDiag || {}
    if (rd.found === true) {
      for (const k of ['markBeforeBgRaw', 'markBoxShadow', 'markRect', 'inViewport', 'visibility', 'tokens']) {
        t('rail 诊断字段 rail.' + k + ' 存在', rd[k] !== undefined)
      }
      t('rail 诊断 tokens 含 --mpw-rail-halo（晕色现场值）', !!(rd.tokens && rd.tokens.mpwRailHalo !== undefined))
    } else {
      t('rail 节点不存在时诊断如实上报 found=false（并带 err/说明）', rd.found === false)
    }
  }
  if (sc === 'off') {
    t('?hdrfrost=off → 不注入', r.state.injected === false)
    t('?hdrfrost=off → 无半透明属性（彻底关，不是"只关半透明"）', r.translucent === false)
    t('?hdrfrost=off → 无 body 标记', r.bodyFrostEl === null)
    t('?hdrfrost=off → 诊断 reason 说明原因', /hdrfrost=off/.test(r.state.reason))
    // ①(2026-09-17) 关掉磨砂就必须把自愈观察器一起撤掉：不留观察器、不留回调
    t('★ ?hdrfrost=off → 自愈观察器未挂载（不留观察器）', !!(r.watch && r.watch.armed === false))
    t('★ ?hdrfrost=off → 观察器未残留（targets=0）', !!(r.watch && r.watch.targets === 0))
  }
  if (sc === 'legacy-off') {
    t('?hdrfrost=legacy + 三个开关全关 → 不注入（旧门控语义）', r.state.injected === false)
    t('legacy 未满足时 reason 说明门控', /legacy/.test(r.state.reason))
  }
  if (sc === 'legacy-on') {
    t('?hdrfrost=legacy + headerBg/headerBlur 开 → 注入', r.state.injected === true)
    t('legacy 注入时 reason 标注 legacy', /legacy/.test(r.state.reason))
  }
  if (sc === 'pseudo') {
    t('?hdrblur=pseudo → 不注入元素（走宿主伪元素对照）', r.state.injected === false)
    t('?hdrblur=pseudo → body 标记被清（伪元素兜底生效）', r.bodyFrostEl === null)
    t('?hdrblur=pseudo → reason 说明对照模式', /hdrblur=pseudo/.test(r.state.reason))
    t('★ ?hdrblur=pseudo → 自愈观察器也撤掉（没有元素层可补）', !!(r.watch && r.watch.armed === false))
  }
  if (sc === 'no-header') {
    t('找不到宿主 header → 不注入且不抛错', r.state.injected === false)
    t('hostHasHeader=false 上报（可判定卡在哪一环）', r.state.hostHasHeader === false)
    t('reason 非空（可诊断）', typeof r.state.reason === 'string' && r.state.reason.length > 0)
  }
  if (sc === 'no-wallpaper') {
    t('无壁纸 + 开关全关 → 不注入（不凭空加磨砂）', r.state.injected === false)
  }
  if (sc === 'broken-scope') {
    // 回归对照：把模块级 normalizeSection 删掉（= 修复前的旧结构）→ 异常必须被**记录**而不是静默
    t('作用域缺失时 sync 不崩（外层仍安全）', r.syncOk === true)
    t('异常被写进 reason（本次修复前这里是空的）', /sync 异常/.test(r.state.reason) && /normalizeSection/.test(r.state.reason))
    t('此时不注入（异常链可见）', r.state.injected === false)
  }
  /* ④(2026-09-17 bug①**第四轮真机根因**) "隐藏列表 fade"清扫不得把宿主 rail 藏掉。
     真机取证（tools/rail-cover-probe.mjs）：DSH 的 .eGxaPq_scroller 在可滚动时会挂
     .eGxaPq_fadeTop/.eGxaPq_fadeBottom（类名含 "fade"），祖先 [data-slot="conversation.session"]
     被旧白名单 [data-slot*="session"] 命中 ⇒ 整条 rail 被内联 display:none
     ⇒ "条看不见、但点 frame 还能跳轮次"。 */
  if (sc === 'fade-sweep') {
    t('★ 会话区 rail（.eGxaPq_scroller + fade 类 + [data-slot=conversation.session] 祖先）不被内联 display:none',
      r.fadeSweepOk === true && r.railDisplay !== 'none' && r.railDisplay === '')
    t('★ 侧栏列表 fade（[data-slot=workspaces] 内）仍被隐藏（原功能未回退）', r.sidebarDisplay === 'none')
    // ③(2026-09-17 对抗性审查) 侧栏**之外**的 fade（第三方面板，absolute+bottom:0）不得被碰
    t('★ 侧栏之外的第三方 fade 不被内联 display:none（清扫作用域硬闸门，防"与 bug① 同类"的误伤）',
      r.tpFadeDisplay === '')
    t('清扫跑通（探针返回值 ok）', r.sweepResult === true)
  }
  if (sc === 'fade-sweep-before') {
    // 反向对照：把修复**改回旧写法**（去掉会话区守卫 + 恢复 [data-slot*="session"] 白名单 +
    //   恢复"absolute+bottom≈0"整片兜底）⇒ rail 与第三方 fade 都必须**确实被藏**。
    //   若这里不红，说明上面的断言没有分辨力（假绿）。
    t('（对照）旧写法下 rail 确实被内联 display:none（证明断言有分辨力）', r.railDisplay === 'none')
    t('（对照）旧写法下第三方 fade 也被内联 display:none（证明新断言有分辨力）', r.tpFadeDisplay === 'none')
  }
  /* ①(2026-09-17 切会话磨砂消失 bug) 顶栏被宿主重建 ⇒ 磨砂必须**自己**回来（不能靠 3s 保险：
     本进程 setInterval 是空桩）。断言分三层：观察器挂上了 / 幂等没堆实例 / 重建后确实补回来了。 */
  if (sc === 'remount') {
    const rm = r.remount || {}
    t('★ 观察器已挂载（watch.armed）', !!(rm.watchBefore && rm.watchBefore.armed === true))
    t('★ 观察目标含稳定容器 + 顶栏父节点（targets ≥ 2）', !!(rm.watchBefore && rm.watchBefore.targets >= 2))
    t('★ 幂等：连调 5 次 sync 不新建观察器实例（桩 created 不增）',
      rm.moCreated === rm.moCreatedBeforeFire)
    t('★ 幂等：任一时刻只有 1 个活着的手动观察器实例（不堆叠）', rm.moLive === 1)
    t('★ 顶栏重建后磨砂层自己回来了（不依赖 3s 保险；本进程里它不存在）', rm.recovered === true)
    t('★ 由观察器触发补同步（watch.hits ≥ 1）', typeof rm.hits === 'number' && rm.hits >= 1)
    t('★ 恢复很快（< 300ms；去抖 50ms + 一次同步）', typeof rm.recoveredMs === 'number' && rm.recoveredMs < 300)
    t('★ 新顶栏里是**我们注入的层**（.mpw-hdrFrost 是新顶栏的第一个子节点）', rm.newHdrFrostEl === true)
    t('★ 新顶栏被重新标记 data-mpw-hdr-frost=el', rm.newHdrMarked === 'el')
    t('★ 新顶栏的半透明底也补上了（模糊不会被不透明底挡住）', rm.newHdrTranslucent === true)
    t('★ 诊断 injected=true（真机 diag 同一字段，可自证）', rm.injected === true)
    // 说明：被丢弃的旧顶栏节点（已脱离文档）里残留的那份层无需清理 ——
    // document.querySelector 只搜文档树，cleanup 不会误命中它；这里不做无意义断言。
  }
  if (sc === 'remount-before') {
    // 反向对照：源码里删掉"挂自愈观察器"那一行（= 修复前行为）⇒ 观察器不存在、层永远不回来。
    // 这一条只要变绿，就说明 remount 的断言没有分辨力（假绿）。
    const rm = r.remount || {}
    t('（对照）修复前：观察器未挂载', !!(rm.watchBefore && rm.watchBefore.armed === false))
    t('（对照）修复前：顶栏重建后磨砂层**没有**回来（证明断言有分辨力）', rm.recovered === false)
    t('（对照）修复前：没有观察器触发（hits=0）', rm.hits === 0)
  }
}

/* ══════════════════════════════════════════════════════════════════
   子进程实现
   ══════════════════════════════════════════════════════════════════ */
if (process.argv[2] === '--child') {
  const sc = process.argv[3]
  await runChild(sc)
}

async function runChild(sc) {
  const { loadPlugin: load } = await import('./_stub.mjs')
  /* ③(2026-09-17 对抗性审查) PART 4 的行为断言：mpwErr 出口 + 上报门控 + 轮换钳制。
     必须独立进程：同一进程二次 loadPlugin 会因模块级幂等标记拿不到注册表（与 PART 2 同因）。 */
  if (sc === 'silent-paths') {
    const L = load({ clientPath: CLIENT, settings: readSection(), quiet: true })
    const clamp = globalThis.__mpwClampRotMin
    const probe = globalThis.__mpwErrProbe
    const ring = globalThis.__mpwErrRing
    const clampOut = {}
    for (const v of [0.001, 0, -3, 121, 120, 7.5, 'abc', NaN]) clampOut[String(v)] = typeof clamp === 'function' ? clamp(v) : null
    let ringGrew = -1, ringWhere = null, consoleLogged = false, ringDeduped = false
    let fetchesDefault = -1, fetchesAfterFlag = -1
    if (typeof probe === 'function' && typeof ring === 'function') {
      const before = ring().length
      const f0 = L.fetchCalls.length
      const errs = []
      const orig = console.error
      console.error = (...a) => { errs.push(a.map((x) => (x && x.message) || String(x)).join(' ')) }
      try { probe('对抗性审查测试', 'boom-probe') } finally { console.error = orig }
      const after = ring()
      ringGrew = after.length - before
      ringWhere = after.length ? after[after.length - 1].where : null
      consoleLogged = errs.some((s) => /对抗性审查测试/.test(s))
      fetchesDefault = L.fetchCalls.length - f0
      probe('对抗性审查测试', 'boom-probe')
      ringDeduped = ring().length === after.length
      globalThis.localStorage.setItem('mpwdiag', '1')
      const f1 = L.fetchCalls.length
      probe('对抗性审查测试-上报', 'boom-probe-2')
      fetchesAfterFlag = L.fetchCalls.length - f1
      globalThis.localStorage.removeItem('mpwdiag')
    }
    console.log('__RESULT__' + JSON.stringify({ clamp: clampOut, ringGrew, ringWhere, consoleLogged, ringDeduped, fetchesDefault, fetchesAfterFlag }))
    return
  }
  const SCEN = {
    default: { settings: { enabled: true, image: true, unifyTint: true, unifyAmount: 30 }, search: '' },
    off: { settings: { enabled: true, image: true, unifyTint: true, unifyAmount: 30 }, search: '?hdrfrost=off' },
    'legacy-off': { settings: { enabled: true, image: true, headerBg: false, headerBlur: false, unifyTint: false }, search: '?hdrfrost=legacy' },
    'legacy-on': { settings: { enabled: true, image: true, headerBg: true, headerBlur: true, unifyTint: false }, search: '?hdrfrost=legacy' },
    pseudo: { settings: { enabled: true, image: true, unifyTint: true, unifyAmount: 30 }, search: '?hdrblur=pseudo' },
    'no-header': { settings: { enabled: true, image: true, unifyTint: true, unifyAmount: 30 }, search: '' },
    'no-wallpaper': { settings: { enabled: true, image: '', headerBg: false, headerBlur: false, unifyTint: false }, search: '' },
    'broken-scope': { settings: { enabled: true, image: true, unifyTint: true, unifyAmount: 30 }, search: '', breakScope: true },
    'fade-sweep': { settings: { enabled: true, image: true, unifyTint: true, unifyAmount: 30 }, search: '' },
    'fade-sweep-before': { settings: { enabled: true, image: true, unifyTint: true, unifyAmount: 30 }, search: '', revertFadeSweep: true },
    // ①(2026-09-17 用户实测"切会话时顶栏磨砂先消失、约 3 秒才回来")：顶栏被宿主重建后的自愈
    remount: { settings: { enabled: true, image: true, unifyTint: true, unifyAmount: 30 }, search: '' },
    // 反向对照：把"挂自愈观察器"那一行从源码里删掉（= 修复前的旧行为）⇒ 断言必须变红
    'remount-before': { settings: { enabled: true, image: true, unifyTint: true, unifyAmount: 30 }, search: '', revertRemount: true },
  }[sc]

  let clientPath = CLIENT
  // 临时夹具目录（mkdtemp + 退出即删）：只放"改前源码"副本，KB~百KB 级，跑完不留痕。
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-rail-'))
  process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })
  if (SCEN.breakScope) {
    // 把模块级的 __asStr/normalizeSection 定义整段删掉，模拟"定义在别的函数体内"的旧结构
    const raw = fs.readFileSync(CLIENT, 'utf8')
    const a = raw.indexOf('\t\tconst __asStr = (v) => {')
    const b = raw.indexOf('\t\t/**', raw.indexOf('\t\tconst normalizeSection = (s0) => {'))
    if (a < 0 || b < 0) { console.log('__RESULT__' + JSON.stringify({ syncOk: false, state: { reason: '测试自身失败：找不到可裁剪的定义块' } })); return }
    const cut = raw.slice(0, a) + raw.slice(b)
    clientPath = path.join(TMP, 'client-broken-scope.js')
    fs.writeFileSync(clientPath, cut)
  }
  if (SCEN.revertFadeSweep) {
    // 反向对照用：把"隐藏列表 fade"清扫改回**修复前**的写法（去掉会话区守卫、白名单用
    // [data-slot*="session"]）→ 用来证明 fade-sweep 断言真的能分辨修复前后（不是假绿）。
    const raw = fs.readFileSync(CLIENT, 'utf8')
    let cut = raw
      .replace(/\t\t\t\tif \(el\.closest\('\[class\*="eGxaPq_"\], \[data-slot\^="conversation"\]'\)\) return;\n/, '')
      .replace('[data-slot*="workspaces"], [data-slot="sidebar"], [class*="regionArea"], [class*="sidebarCol"]',
        '[data-slot*="workspaces"], [data-slot*="session"], [class*="regionArea"], [class*="sidebarCol"]')
      // ③(2026-09-17 对抗性审查) 修复前还有第二个缺陷：**侧栏之外的兜底**
      //   （任意 absolute + bottom≈0 的 fade 元素 → display:none）。只删守卫 + 换白名单
      //   还不够，必须把兜底也还原，否则"第三方 fade 被误伤"这条反向对照根本测不出来。
      //   注意：必须**锚定函数体**（含上一行 closest 白名单），否则会误伤代码注释里的同名字符串。
      .replace(/\t\t\treturn !!p;\n/, [
        'let isListFade = !!p;',
        '\t\t\t\tif (!isListFade) {',
        '\t\t\t\t\tif (el.style.display === "none") return false;',
        '\t\t\t\t\ttry {',
        '\t\t\t\t\t\tconst cs = getComputedStyle(el);',
        '\t\t\t\t\t\tisListFade = cs.position === "absolute" && (cs.bottom === "0px" || parseFloat(cs.bottom) <= 1);',
        '\t\t\t\t\t} catch {}',
        '\t\t\t\t}',
        '\t\t\t\treturn !!isListFade;',
        '',
      ].join('\n'))
    if (cut === raw) { console.log('__RESULT__' + JSON.stringify({ sweepResult: '测试自身失败：未能改回旧写法', railDisplay: null, sidebarDisplay: null, fadeSweepOk: false })); return }
    if (!/let isListFade = !!p;/.test(cut)) { console.log('__RESULT__' + JSON.stringify({ sweepResult: '测试自身失败：兜底未被还原（闸门写法变了？同步改测试）', railDisplay: null, sidebarDisplay: null, fadeSweepOk: false })); return }
    clientPath = path.join(TMP, 'client-fade-sweep-before.js')
    fs.writeFileSync(clientPath, cut)
  }
  if (SCEN.revertRemount) {
    // 反向对照用：把 syncHeaderFrost 末尾"挂自愈观察器"那一行删掉 = **修复前的旧行为**
    //   （宿主重建顶栏丢掉注入层后，只能等 3s 低频保险；本测试环境里 setInterval 是空桩
    //    ⇒ 层永远不会回来）。用来证明 remount 断言真的能分辨修复前后（不是假绿）。
    const raw = fs.readFileSync(CLIENT, 'utf8')
    const ARM_LINE = '\t\t\t\ttry { armHeaderFrostWatch(); } catch (e) { mpwErr("armHeaderFrostWatch", e); }\n'
    if (raw.indexOf(ARM_LINE) < 0) {
      console.log('__RESULT__' + JSON.stringify({ remountFail: '测试自身失败：找不到 armHeaderFrostWatch() 调用行（闸门写法变了？同步改测试）' }))
      return
    }
    const cut = raw.replace(ARM_LINE, '\t\t\t\t/* 变异用例：不挂自愈观察器（= 修复前行为） */\n')
    clientPath = path.join(TMP, 'client-remount-before.js')
    fs.writeFileSync(clientPath, cut)
  }

  class FakeStyle {
    constructor() { this._p = new Map() }
    setProperty(k, v) { this._p.set(String(k), String(v)) }
    removeProperty(k) { this._p.delete(String(k)) }
    getPropertyValue(k) { return this._p.get(String(k)) || '' }
    // ①(2026-09-17) 真 CSSStyleDeclaration 的 display 是访问器；插件里写的是
    //   `el.style.display = "none"`（属性赋值）而不是 setProperty ⇒ 假 style 也要有访问器，
    //   否则"rail 有没有被内联 display:none"根本量不到（会变成假绿）。
    get display() { return this._p.get('display') || '' }
    set display(v) { if (v === '' || v === null || v === undefined) this._p.delete('display'); else this._p.set('display', String(v)) }
    set cssText(v) { for (const part of String(v).split(';')) { const i = part.indexOf(':'); if (i > 0) this._p.set(part.slice(0, i).trim(), part.slice(i + 1).trim()) } }
    get cssText() { return [...this._p].map(([k, v]) => k + ':' + v).join(';') }
  }
  class FakeEl {
    constructor(tag = 'div', cls = '') {
      this.tagName = String(tag).toUpperCase(); this.className = cls; this.style = new FakeStyle()
      this.children = []; this._attrs = new Map(); this.parentElement = null; this.nodeType = 1
      // ①(2026-09-17 切会话磨砂消失 bug) 真 DOM 的 classList：自愈观察器的回调靠
      //   `n.classList.contains('mpw-hdrFrost')` 区分"我们自己插的层"与"宿主重建"，桩里必须有。
      const self = this
      this.classList = {
        contains: (c) => String(self.className || '').split(/\s+/).includes(c),
        add: (c) => { if (!self.classList.contains(c)) self.className = (self.className ? self.className + ' ' : '') + c },
        remove: (c) => { self.className = String(self.className || '').split(/\s+/).filter((x) => x && x !== c).join(' ') },
      }
    }
    setAttribute(k, v) { this._attrs.set(k, v === undefined ? '' : String(v)) }
    getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null }
    removeAttribute(k) { this._attrs.delete(k) }
    hasAttribute(k) { return this._attrs.has(k) }
    appendChild(c) { this.children.push(c); c.parentElement = this; return c }
    insertBefore(c, ref) { const i = ref ? this.children.indexOf(ref) : 0; this.children.splice(i < 0 ? 0 : i, 0, c); c.parentElement = this; return c }
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c }
    remove() { if (this.parentElement) this.parentElement.removeChild(this) }
    // ①(2026-09-17) closest 用**本地选择器匹配器**（见 matchSel），让"我们会不会命中 rail"
    //   这类断言能在假 DOM 上离线复算，而不是只做字符串匹配。
    closest(sel) { for (let n = this; n; n = n.parentElement) if (matchSel(n, sel)) return n; return null }
    matches(sel) { return matchSel(this, sel) }
    querySelector(sel) {
      const m = /^:scope\s*>\s*\.([\w-]+)$/.exec(sel)
      if (m) return this.children.find((c) => String(c.className).split(/\s+/).includes(m[1])) || null
      return null
    }
    querySelectorAll() { return [] }
    getBoundingClientRect() { return { x: 0, y: 0, width: 1200, height: 48, top: 0, left: 0, right: 1200, bottom: 48 } }
    get firstChild() { return this.children[0] || null }
  }

  /* ①(2026-09-17 切会话磨砂消失 bug) 可手动触发的 MutationObserver 桩（只覆盖生产代码用到的 API）：
     observe/disconnect/takeRecords + 静态 fire（把一条 mutation 派发给"仍在观察该目标"的实例）。
     为什么必须有它：本机无头环境没有真 DOM，而"顶栏被宿主重建后磨砂能不能自己回来"正是本轮
     bug 的唯一判据；又因为桩里 `setInterval` 是空的（_stub.mjs），层被丢掉之后**唯一**能把它
     补回来的通路就是自愈观察器 ⇒ 断言天然有分辨力（修复前必红）。 */
  class FakeMO {
    constructor(cb) { this.cb = cb; this.targets = []; FakeMO.instances.push(this); FakeMO.created++ }
    observe(t, o) { this.targets.push({ t, o }) }
    disconnect() { this.targets = [] }
    takeRecords() { return [] }
    static fire(target, added, removed) {
      const rec = { target, addedNodes: added || [], removedNodes: removed || [] }
      for (const inst of FakeMO.instances) {
        if (!inst.targets.some((x) => x.t === target)) continue
        try { inst.cb([rec], inst) } catch {}
      }
    }
  }
  FakeMO.instances = []; FakeMO.created = 0
  globalThis.__FakeMO = FakeMO

  /* ── 极简选择器匹配器（只覆盖本插件 CSS/JS 里实际出现的语法）────────────────
     tag / .class / [attr] / [attr="v"] / [attr*="v"] / [attr^="v"] / [attr$="v"] / :not(...)，
     组合子只支持后代（空格）与子代（>），选择器列表用逗号。目的：给
     "我们的 fade 清扫会不会命中宿主 rail" 一个可离线复算的结构级判定。 */
  const parseCompound = (s) => {
    const out = { tag: null, classes: [], attrs: [], nots: [] }
    let rest = String(s).trim()
    rest = rest.replace(/:not\(([^)]*)\)/g, (_, inner) => { out.nots.push(inner.trim()); return '' })
    while (rest) {
      if (rest[0] === '.') { const m = /^\.([\w-]+)/.exec(rest); if (!m) break; out.classes.push(m[1]); rest = rest.slice(m[0].length); continue }
      if (rest[0] === '[') { const m = /^\[([\w-]+)(?:([*^$]?=)"?([^"\]]*)"?)?\]/.exec(rest); if (!m) break; out.attrs.push({ name: m[1], op: m[2] || null, val: m[3] === undefined ? null : m[3] }); rest = rest.slice(m[0].length); continue }
      const m = /^([A-Za-z][\w-]*|\*)/.exec(rest); if (!m) break; out.tag = m[1]; rest = rest.slice(m[0].length)
    }
    return out
  }
  const matchCompound = (el, comp) => {
    if (!el || el.nodeType !== 1) return false
    if (comp.tag && comp.tag !== '*' && String(el.tagName).toLowerCase() !== comp.tag.toLowerCase()) return false
    const cls = String(el.className || '')
    for (const c of comp.classes) if (!cls.split(/\s+/).includes(c)) return false
    for (const a of comp.attrs) {
      const v = el.getAttribute ? el.getAttribute(a.name) : null
      if (v === null || v === undefined) return false
      if (a.op === null) continue
      const sv = String(v)
      if (a.op === '=' && sv !== a.val) return false
      if (a.op === '*=' && !sv.includes(a.val)) return false
      if (a.op === '^=' && !sv.startsWith(a.val)) return false
      if (a.op === '$=' && !sv.endsWith(a.val)) return false
    }
    for (const n of comp.nots) if (matchSel(el, n)) return false
    return true
  }
  const splitTop = (sel, sep) => {
    const out = []; let cur = ''; let depth = 0
    for (const ch of String(sel)) {
      if (ch === '(' || ch === '[') depth++
      else if (ch === ')' || ch === ']') depth--
      if (depth === 0 && ch === sep) { out.push(cur); cur = ''; continue }
      cur += ch
    }
    out.push(cur); return out
  }
  const splitSel = (sel) => {
    const seq = []; let comb = ' '
    for (const tokRaw of splitTop(String(sel).replace(/>/g, ' > '), ' ')) {
      const tok = tokRaw.trim(); if (!tok) continue
      if (tok === '>') { comb = '>'; continue }
      seq.push({ comp: parseCompound(tok), comb }); comb = ' '
    }
    return seq
  }
  const matchSel = (el, sel) => splitTop(sel, ',').some((one) => {
    const seq = splitSel(one)
    if (!seq.length) return false
    if (!matchCompound(el, seq[seq.length - 1].comp)) return false
    let node = el
    for (let i = seq.length - 2; i >= 0; i--) {
      const need = seq[i + 1].comb
      if (need === '>') {
        node = node.parentElement
        if (!node || !matchCompound(node, seq[i].comp)) return false
      } else {
        let p = node.parentElement; let hit = null
        while (p) { if (matchCompound(p, seq[i].comp)) { hit = p; break } p = p.parentElement }
        if (!hit) return false
        node = hit
      }
    }
    return true
  })

  load({ clientPath, settings: SCEN.settings, search: SCEN.search, quiet: true })

  const hdr = new FakeEl('header', 'wSkVaW_header')
  const body = new FakeEl('body', '')
  const html = new FakeEl('html', '')
  const noHeader = sc === 'no-header'
  /* ①(2026-09-17 切会话磨砂消失 bug) 重挂载场景的装置：真机结构 = 稳定容器 > 顶栏
     （`div[data-slot="main.conversation"] > header.wSkVaW_header`；真机实测切会话时顶栏换新、
     容器不换 ⇒ 观察器就挂在容器上）。 */
  const REMOUNT = sc === 'remount' || sc === 'remount-before'
  const convRoot = new FakeEl('div', ''); convRoot.setAttribute('data-slot', 'main.conversation')
  if (REMOUNT) { convRoot.appendChild(hdr); globalThis.MutationObserver = globalThis.__FakeMO }
  globalThis.__hdrNow = hdr
  globalThis.document.querySelector = (sel) => {
    if (noHeader) return null
    if (/wSkVaW_header/.test(sel)) return globalThis.__hdrNow
    if (REMOUNT && /main\.conversation/.test(sel)) return convRoot
    return null
  }
  // ②(2026-09-16) 壁纸层三件套：没有它们 applyFromStorageInner 会早退（`if (!img||!video||!wrap) return`），
  //   rail 对比补偿（refreshRailInk）这个调用点就走不到 → 回归断言会变成"永远量不到"的假绿/假红。
  const bgWrapEl = new FakeEl('div', 'mpw-bgWrap'); bgWrapEl.id = 'mpw-bgWrap'
  const bgImgEl = new FakeEl('img', 'mpw-bgImg'); bgImgEl.id = 'mpw-bgImg'
  const bgVideoEl = new FakeEl('video', 'mpw-bgVideo'); bgVideoEl.id = 'mpw-bgVideo'
  bgImgEl.setAttribute('src', 'data:image/png;base64,iVBORw0KGgo=')
  globalThis.document.getElementById = (id) => (id === 'mpw-bgWrap' ? bgWrapEl : id === 'mpw-bgImg' ? bgImgEl : id === 'mpw-bgVideo' ? bgVideoEl : null)
  globalThis.document.createElement = (tag) => new FakeEl(tag)
  globalThis.document.body = body
  globalThis.document.documentElement = html
  globalThis.getComputedStyle = (el) => ({
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    backdropFilter: (el && el.style && el.style.getPropertyValue && el.style.getPropertyValue('backdrop-filter')) || 'none',
    webkitBackdropFilter: 'none',
    // ③(2026-09-17 对抗性审查) 第三方面板的 fade：**故意**给"absolute + bottom:0"
    //   （正是修复前兜底的命中条件）⇒ 旧写法会把它内联 display:none，新写法必须不碰。
    position: el && el.__tpFade ? 'absolute' : 'relative',
    bottom: el && el.__tpFade ? '0px' : 'auto',
    overflow: 'visible', zIndex: 'auto',
    getPropertyValue: (k) => (el && el.style && el.style.getPropertyValue ? el.style.getPropertyValue(k) : ''),
  })

  /* ④(2026-09-17 bug①第四轮) **结构级**装置：两个假 fade 节点 + 真祖先链，用来真跑一次
     "隐藏列表 fade"清扫（applyDialogInline），判定"我们会不会把宿主 rail 藏掉"：
       · rail：div.eGxaPq_scroller.eGxaPq_fadeTop.eGxaPq_fadeBottom
               ← nav.eGxaPq_frame ← div.eGxaPq_slot ← div[data-slot="conversation.session"]
         （真机 DOM 形状，见 tools/probe-out/before.probe.json 的祖先链）
       · 侧栏列表 fade：div.hHd-Xa_listFade ← div[data-slot="sidebar.workspaces"]（原功能：应被隐藏） */
  const convSession = new FakeEl('div', ''); convSession.setAttribute('data-slot', 'conversation.session')
  const railSlot = new FakeEl('div', 'eGxaPq_slot'); convSession.appendChild(railSlot)
  const railFrame = new FakeEl('nav', 'eGxaPq_frame'); railSlot.appendChild(railFrame)
  const railScroller = new FakeEl('div', 'eGxaPq_scroller eGxaPq_fadeTop eGxaPq_fadeBottom'); railFrame.appendChild(railScroller)
  const sidebarWrap = new FakeEl('div', 'hHd-Xa_regionArea'); sidebarWrap.setAttribute('data-slot', 'sidebar.workspaces')
  const sidebarFade = new FakeEl('div', 'hHd-Xa_fadeBottom'); sidebarWrap.appendChild(sidebarFade)
  /* ③(2026-09-17 对抗性审查) 第三个假 fade：**第三方插件的底部渐隐**（不在侧栏、不在会话区），
     故意做成 absolute + bottom:0 —— 修复前的"整片兜底"会把它内联 display:none（误伤宿主/他插件）。 */
  const tpPanel = new FakeEl('div', 'someVendor_panel')
  const tpFade = new FakeEl('div', 'someVendor_fadeBottom'); tpFade.__tpFade = true; tpPanel.appendChild(tpFade)
  globalThis.document.querySelectorAll = (sel) => {
    if (/\[class\*="fade"\]/.test(sel)) return [railScroller, sidebarFade, tpFade]
    return []
  }
  let sweepResult = null
  try { sweepResult = globalThis.__mpwFadeSweepProbe ? globalThis.__mpwFadeSweepProbe() : 'no-probe' } catch (e) { sweepResult = 'throw:' + (e && e.message) }

  const T = globalThis.__mpwHdrFrostTest
  if (!T) { console.log('__RESULT__' + JSON.stringify({ syncOk: false, state: { reason: '钩子 __mpwHdrFrostTest 未注册' } })); return }
  // ③(2026-09-16) 显式跑一次 rail 计算（假 DOM 缺元素时 boot 会早退，避免断言永远量不到）
  try { if (globalThis.__mpwRailSync) globalThis.__mpwRailSync() } catch {}
  const syncRes = T.sync()
  const state = T.state() || {}
  const el = T.frostEl()

  /* ①(2026-09-17 切会话磨砂消失 bug) 顶栏重挂载自愈的**行为**断言：
     · 本进程 `setInterval` 是空桩（_stub.mjs）⇒ 3s 低频保险完全不存在，层丢掉后能补回来的
       唯一通路就是自愈观察器（这就是红/绿分水岭，修复前必红）；
     · 触发装置 = 宿主重建顶栏：真机实测 header 节点换新、`[data-slot="main.conversation"]`
       容器不换 ⇒ 手动向容器派发一条 childList mutation（added=新顶栏）； */
  let remountOut = null
  if (REMOUNT) {
    const before = T.watch()
    for (let i = 0; i < 5; i++) T.sync()               // 幂等：连调 5 次不得堆出第二个观察器
    const afterIdem = T.watch()
    const madeBeforeFire = globalThis.__FakeMO.created
    const hdr2 = new FakeEl('header', 'wSkVaW_header')
    convRoot.removeChild(globalThis.__hdrNow)
    convRoot.appendChild(hdr2)
    globalThis.__hdrNow = hdr2
    const t0 = Date.now()
    globalThis.__FakeMO.fire(convRoot, [hdr2], [])
    let recoveredMs = null
    while (Date.now() - t0 < 1000) {
      if (T.frostEl()) { recoveredMs = Date.now() - t0; break }
      await new Promise((r) => setTimeout(r, 10))
    }
    const st2 = T.state() || {}
    remountOut = {
      watchBefore: before, watchAfterIdem: afterIdem,
      moCreatedBeforeFire: madeBeforeFire, moCreated: globalThis.__FakeMO.created,
      moLive: globalThis.__FakeMO.instances.filter((x) => x.targets.length).length,
      recovered: !!T.frostEl(), recoveredMs,
      injected: !!st2.injected, hits: (T.watch() || {}).hits,
      newHdrFrostEl: !!(hdr2.querySelector(':scope > .mpw-hdrFrost')),
      newHdrTranslucent: hdr2.hasAttribute('data-mpw-hdr-translucent'),
      newHdrMarked: hdr2.getAttribute('data-mpw-hdr-frost'),
      oldHdrHasFrostEl: !!(hdr.querySelector(':scope > .mpw-hdrFrost')),
    }
  }

  const collected = (() => { try { return T.collect() } catch { return null } })()
  console.log('__RESULT__' + JSON.stringify({
    syncOk: !!(syncRes && syncRes.ok),
    state,
    diag: collected && collected.headerFrost ? collected.headerFrost : null,
    railDiag: collected && collected.rail ? collected.rail : null,
    translucent: hdr.hasAttribute('data-mpw-hdr-translucent'),
    hdrFrostAttr: hdr.getAttribute('data-mpw-hdr-frost'),
    bodyFrostEl: body.getAttribute('data-mpw-hdr-frost-el'),
    frostElClass: el ? el.className : null,
    frostElMark: el ? el.getAttribute('data-mpw-hdr-frost') : null,
    cssText: el ? el.style.cssText : '',
    frostElZ: el ? cssProp(el.style.cssText, 'z-index') : null,
    railInk: (() => { try { return globalThis.__mpwRailInkProbe ? globalThis.__mpwRailInkProbe() : null } catch { return null } })(),
    // ④(2026-09-17 bug①第四轮) fade 清扫的结构级结果（rail 绝不能被内联 display:none）
    sweepResult,
    fadeSweepOk: sweepResult === true,
    railDisplay: railScroller.style.display,
    tpFadeDisplay: tpFade.style.display,
    sidebarDisplay: sidebarFade.style.display,
    backdropFilter: el ? el.style.backdropFilter : null,
    webkitBackdropFilter: el ? el.style.webkitBackdropFilter : null,
    hdrFrostBg: html.style.getPropertyValue('--mpw-hdr-frost-bg'),
    // ①(2026-09-17 切会话磨砂消失 bug) 自愈观察器现场 + 重挂载恢复结果
    watch: (() => { try { return T.watch ? T.watch() : null } catch { return null } })(),
    remount: remountOut,
  }))
}
