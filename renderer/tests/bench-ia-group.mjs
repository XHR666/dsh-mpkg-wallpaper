// bench-ia-group.mjs —— issue #0924a **A 线（:8902 测试台 UI）12 条的浏览器档**（共享实现）
//
// 为什么抽成模块：这组判据要能被**两个入口**跑到 ——
//   ① `tests/bench-ui-headless-test.mjs`（既有的整页门禁，IA 组插在 G10 之前）；
//   ② `tests/bench-issue0924a-ia-browser-test.mjs`（**单跑这一组**的窄入口：整页门禁会被
//      与本线无关的、别的线正在改的渲染器面（`__wp` 方法缺失 → 未捕获异常 → 全局错误条）挡在半路，
//      而本线的读数不该跟着拿不到）。
// 判据一律经 `__benchPatch` 的探针（门禁与真机同一个入口），不含任何本机绝对路径/目录名。
//
// 用法（模块内）：await runIaGroup({ page, ok, VIEW })
export function scanSlack(g) {
  return (g && Number.isFinite(Number(g.slack))) ? Number(g.slack) : Number((g && g.scrollHeight - g.clientHeight - g.scrollTop) || 0)
}
export async function runIaGroup({ page, ok, VIEW = { w: 1360, h: 900 } }) {

    /* ── IA1 第 1 条：快捷根那一行不再溢出、不再"一字一行" ──────────────────────────────── */
    const dg = await page.evaluate(async () => {
      const wait = (n) => new Promise((r) => setTimeout(r, n))
      const btn = document.getElementById('pick-lib')
      if (!btn) return { error: 'no-pick-lib' }
      /* 产物在 boot 里会 disable 它（静态托管分支），补丁在 0/800/2500ms 各解禁一次 ⇒
         这里**等它可用**再点（不然"点了一下没反应"会被误读成"对话框溢出"）。 */
      for (let i = 0; i < 40 && btn.disabled; i++) await wait(200)
      const wasDisabled = !!btn.disabled
      if (btn.disabled) btn.disabled = false        // 判据是"对话框那一行的布局"，不是产物解禁的时序
      await wait(2600)                              // 产物在 0/800/2500ms 各摘一次入口链 ⇒ 等它settle
      btn.click()
      for (let i = 0; i < 25; i++) { await wait(200); if (document.getElementById('bench-fs-dialog')) break }
      const api = window.__benchPatch
      const g = api && api.dirboxGeometry ? api.dirboxGeometry() : null
      return { g, wasDisabled, disabled: btn.disabled, hasDialog: !!document.getElementById('bench-fs-dialog'), fs: api && api.fsState ? api.fsState() : null }
    })
    console.log('  IA1 读数 dirboxGeometry=' + JSON.stringify(dg.g) +
      ' · hasDialog=' + JSON.stringify(dg.hasDialog) + ' · disabled=' + JSON.stringify(dg.disabled) + '/' + JSON.stringify(dg.wasDisabled) +
      ' · fs=' + JSON.stringify(dg.fs && { state: dg.fs.state, rows: dg.fs.rows, err: dg.fs.lastErr }))
    ok(!!dg.g && dg.g.open === true && dg.g.count >= 3,
      'IA1a 「选择文件夹」对话框的快捷根那一行能量到（≥3 条 chip）', JSON.stringify(dg.g && { open: dg.g.open, count: dg.g.count }))
    ok(!!dg.hasDialog && !!dg.g && dg.g.open === true && dg.g.overflow === false && dg.g.lineChars.length === 0,
      'IA1b ★快捷根**一个都不越界**、**没有一条被压成一字一行**（`overflow=false` 且每块高度/宽度都可读）',
      JSON.stringify(dg.g && { overflow: dg.g.overflow, worst: dg.g.worst, lineChars: dg.g.lineChars }))
    if (dg.g && dg.g.chips) {
      const minW = Math.min(...dg.g.chips.map((c) => c.w))
      ok(dg.g.open === true && dg.g.chips.length >= 3 && dg.g.chips.every((c) => c.h <= 30 && c.w >= 40),
        'IA1c 每块 chip 都是"一行高、够宽"（改前：flex 收缩 + 不换行 ⇒ 竖排 + 后面的根被裁掉）',
        JSON.stringify({ minW, heights: dg.g.chips.map((c) => c.h), labels: dg.g.chips.map((c) => c.label.slice(0, 18)) }))
    }
    /* ── IA2 第 4 条：通用溢出自检（面板/下拉/工具条/对话框）两种宽度各量一次 ─────────────── */
    const overflowAt = async (w) => {
      await page.setViewportSize({ width: w, height: 760 })
      await page.waitForTimeout(450)
      return await page.evaluate(() => {
        const api = window.__benchPatch
        const p = api && api.panelOverflowProbe ? api.panelOverflowProbe() : null
        if (!p) return null
        const badSels = new Set(p.bad.map((b) => b.sel))
        const detail = p.rows.filter((r) => r.present && badSels.has(r.sel)).map((r) => ({ sel: r.sel, rect: r.rect, clientW: r.clientW, scrollW: r.scrollW, clientH: r.clientH, scrollH: r.scrollH, ox: r.overflowXStyle, oy: r.overflowYStyle }))
        return { ok: p.ok, count: p.count, bad: p.bad, spill: p.spill || [], spillCount: p.spillCount || 0, detail, viewport: p.viewport, checked: p.rows.filter((r) => r.present).length }
      })
    }
    const ofWide = await overflowAt(1360)
    const ofNarrow = await overflowAt(760)
    console.log('  IA2 读数 宽=' + JSON.stringify(ofWide) + '\n             窄=' + JSON.stringify(ofNarrow))
    ok(!!ofWide && ofWide.ok === true && ofWide.checked >= 8,
      'IA2a ★1360px 宽档：**所有"有范围的显示"都没有裁剪式溢出**（面板/下拉/工具条/对话框；滚动区与浮层按设计放行）',
      JSON.stringify(ofWide && { bad: ofWide.bad.slice(0, 4), spill: (ofWide.spill || []).slice(0, 3), checked: ofWide.checked }))
    ok(!!ofNarrow && ofNarrow.ok === true,
      'IA2b ★760px 窄档同样 0 处裁剪式溢出（同一份自检覆盖两种布局）',
      JSON.stringify(ofNarrow && { bad: ofNarrow.bad.slice(0, 4), spill: (ofNarrow.spill || []).slice(0, 3), checked: ofNarrow.checked }))
    /* 改前复现（**同一把尺子**：`dirboxGeometry()`，与 IA1 逐字同一入口）：把快捷根那一行改回旧规则
       （`.bench-dirbox-tools` 的老样子：不换行、chip 可逐字折断、没有自身滚动）**并把对话框压到 300px 宽**
       —— 那正是用户机型上"显示不下"的条件。改前读数 = chip 被压成一字一行（`lineChars` 非空）/ 越出窗口；
       撤掉注入后必须回绿。 */
    const beforeRepro = await page.evaluate(() => {
      const st = document.createElement('style'); st.id = 'ia-before-chips'
      st.textContent = '.bench-dirbox-roots{display:flex!important;flex-wrap:nowrap!important;max-height:none!important;overflow:visible!important;align-items:center!important;gap:6px!important;padding:7px 12px!important}'
        + '.bench-dirbox-roots button{flex:0 1 auto!important;min-width:0!important;max-width:100%!important;white-space:normal!important;overflow:visible!important;text-overflow:clip!important}'
        + '#bench-fs-dialog .bench-dirbox-win{width:300px!important;max-width:300px!important}'
      document.head.appendChild(st)
      const before = window.__benchPatch.dirboxGeometry()
      st.remove()
      const after = window.__benchPatch.dirboxGeometry()
      const brief = (g) => (g ? { open: g.open, count: g.count, overflow: g.overflow, lineChars: g.lineChars.length, minW: g.chips.length ? Math.min(...g.chips.map((c) => c.w)) : null, maxH: g.chips.length ? Math.max(...g.chips.map((c) => c.h)) : null } : null)
      return { before: brief(before), after: brief(after) }
    })
    console.log('  IA2 改前复现读数=' + JSON.stringify(beforeRepro))
    ok(!!dg.g && dg.g.open === true && !!beforeRepro.before && (beforeRepro.before.lineChars > 0 || beforeRepro.before.overflow === true) &&
      !!beforeRepro.after && beforeRepro.after.lineChars === 0 && beforeRepro.after.overflow === false,
      'IA2c ★改前/改后成对读数（同一入口 `dirboxGeometry()`）：按旧规则 + 300px 窄窗复现后，快捷根**当场被判"一字一行/越界"**；' +
      '撤掉注入立刻回绿 —— 证明 IA1b/IA1c 的绿灯不是恒真',
      JSON.stringify(beforeRepro))
    await page.setViewportSize({ width: VIEW.w, height: VIEW.h })
    await page.waitForTimeout(300)
    //  自检窗口用完即关（不留第二个 `.bench-dirbox`，不然 F3e1 的单例不变式会被后面重跑时撞上）
    await page.keyboard.press('Escape').catch(() => {})
    await page.evaluate(() => { const b = document.querySelector('.bench-dirbox'); if (b && b.parentNode) b.parentNode.removeChild(b) })

    /* ── IA3 第 7/8 条：调试页签灰框 + ON/OFF 文案与配色 ─────────────────────────────── */
    const dbg = await page.evaluate(async () => {
      const api = window.__benchPatch
      const wait = (n) => new Promise((r) => setTimeout(r, n))
      const tab = document.getElementById('tab-debug')
      if (tab) tab.click()
      await wait(300)
      const rgb = (s) => (String(s).match(/\d+/g) || []).map(Number)
      const off = api.dbgTabState ? api.dbgTabState() : null
      api.setDebugMode(true)
      await wait(300)
      const on = api.dbgTabState ? api.dbgTabState() : null
      api.setDebugMode(false)
      await wait(200)
      const back = api.dbgTabState ? api.dbgTabState() : null
      return { off, on, back, offRgb: off ? rgb(off.color) : null, onRgb: on ? rgb(on.color) : null }
    })
    console.log('  IA3 读数 dbgTabState=' + JSON.stringify({ off: dbg.off && { text: dbg.off.text, aria: dbg.off.ariaSelected, cls: dbg.off.cls, boxGray: dbg.off.boxGray, bg: dbg.off.bg, color: dbg.off.color }, on: dbg.on && { text: dbg.on.text, color: dbg.on.color }, back: dbg.back && dbg.back.text }))
    ok(!!dbg.off && /调试模式·OFF|Debug mode·OFF/.test(String(dbg.off.text)) && /调试模式·ON|Debug mode·ON/.test(String(dbg.on && dbg.on.text)),
      'IA3a ★第 8 条：勾选态是唯一依据 —— 未勾 `调试模式·OFF`、勾上 `调试模式·ON`、再取消又回 `·OFF`',
      JSON.stringify({ off: dbg.off && dbg.off.text, on: dbg.on && dbg.on.text, back: dbg.back && dbg.back.text }))
    ok(!!dbg.off && dbg.off.ariaSelected === 'true' && /active/.test(String(dbg.off.cls)) && dbg.off.boxGray === true,
      'IA3b ★第 7 条：调试页签被选中时有**灰框/灰底**（`aria-selected=true` + `.active` + 非透明背景/灰框）',
      JSON.stringify(dbg.off && { aria: dbg.off.ariaSelected, cls: dbg.off.cls, bg: dbg.off.bg, boxShadow: dbg.off.boxShadow }))
    ok(!!dbg.onRgb && dbg.onRgb.length >= 3 && dbg.onRgb[1] > dbg.onRgb[0] && dbg.onRgb[1] > dbg.onRgb[2],
      'IA3c ON 的配色是**绿**（G 通道最大）', JSON.stringify(dbg.onRgb))
    ok(!!dbg.offRgb && dbg.offRgb.length >= 3 && dbg.offRgb[0] > dbg.offRgb[1] && dbg.offRgb[0] > dbg.offRgb[2],
      'IA3d OFF 的配色是**红**（R 通道最大）', JSON.stringify(dbg.offRgb))

    /* ── IA4 第 9 条：输出区的字与诊断栏同一套可读配色（浅色主题下也算对比度）───────────── */
    const logFg = await page.evaluate(async () => {
      const d = document.documentElement
      const old = d.dataset.theme
      const parse = (c) => (String(c).match(/[\d.]+/g) || []).map(Number)
      const lum = (c) => {
        const [r, g, b] = parse(c).slice(0, 3).map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4) })
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
      }
      const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); const hi = Math.max(l1, l2), lo = Math.min(l1, l2); return (hi + 0.05) / (lo + 0.05) }
      const read = () => {
        const body = document.getElementById('logbody'), diag = document.getElementById('diag-body')
        const cs = getComputedStyle(body)
        const bg = getComputedStyle(document.getElementById('logs') || body).backgroundColor
        return { color: cs.color, bg, ratio: ratio(cs.color, bg), diag: getComputedStyle(diag).color }
      }
      const out = {}
      for (const theme of ['dark', 'light']) {
        d.dataset.theme = theme
        await new Promise((r) => setTimeout(r, 120))
        out[theme] = read()
      }
      d.dataset.theme = old || 'dark'
      await new Promise((r) => setTimeout(r, 120))
      return out
    })
    console.log('  IA4 读数 =' + JSON.stringify(logFg))
    ok(!!logFg.dark && logFg.dark.color === logFg.dark.diag && !!logFg.light && logFg.light.color === logFg.light.diag,
      'IA4a ★第 9 条：输出区（`#logbody`）的字色与渲染器诊断栏（`#diag-body`）**逐字相同**（两主题各一次）',
      JSON.stringify(logFg))
    ok(!!logFg.light && logFg.light.ratio >= 4.5 && !!logFg.dark && logFg.dark.ratio >= 4.5,
      'IA4b ★浅色主题下输出区对比度 ≥ 4.5:1（改前是产物写死的 `#ccc` 配 `#f3f3f3` 面板 ⇒ 约 1.6:1，"淡灰色看不清"）',
      JSON.stringify({ light: logFg.light && logFg.light.ratio, dark: logFg.dark && logFg.dark.ratio }))

    /* ── IA5 第 16 条：来新消息时不把用户从上面拽到底 ─────────────────────────────────── */
    const scrollTest = await page.evaluate(async () => {
      const api = window.__benchPatch
      const body = document.getElementById('logbody')
      /* 输出区被收起 / 高度为 0 时"滚上去"无从谈起（那是 vacuous 通过）⇒ 先确保它真的有可视高度：
         收起态由 `#main.logs-collapsed` 表达，这里显式展开并把高度撑到 200px（门禁只是要测滚动语义）。 */
      const main = document.getElementById('main')
      const tabLogs = document.getElementById('tab-logs')
      if (tabLogs) tabLogs.click()                  // 诊断/调试页签下 `#logbody` 是 display:none ⇒ 先切回输出页
      if (main) main.classList.remove('logs-collapsed')
      const logs = document.getElementById('logs')
      if (logs) { logs.style.minHeight = '200px'; logs.style.display = 'flex' }
      await new Promise((r) => setTimeout(r, 250))
      for (let i = 0; i < 40; i++) api.logAppend('IA-填充行 ' + i)
      await new Promise((r) => setTimeout(r, 60))
      body.scrollTop = 0
      await new Promise((r) => setTimeout(r, 60))
      const before = api.logScrollState()
      api.logAppend('IA-用户正在看上面的日志')
      await new Promise((r) => setTimeout(r, 60))
      const afterTop = api.logScrollState()
      body.scrollTop = body.scrollHeight
      await new Promise((r) => setTimeout(r, 60))
      api.logAppend('IA-用户贴在底部')
      await new Promise((r) => setTimeout(r, 60))
      const afterBottom = api.logScrollState()
      return { before, afterTop, afterBottom, scrollable: body.scrollHeight > body.clientHeight,
        geom: { clientH: body.clientHeight, scrollH: body.scrollHeight, bodyDisplay: getComputedStyle(body).display, view: logs ? String(logs.getAttribute('data-view') || '') : '', logsH: logs ? logs.clientHeight : -1, mainCls: main ? String(main.className || '') : '' } }
    })
    console.log('  IA5 读数（补丁路径）= ' + JSON.stringify({ scrollable: scrollTest.scrollable, geom: scrollTest.geom, before: scrollTest.before && scrollTest.before.scrollTop, afterTop: scrollTest.afterTop && scrollTest.afterTop.scrollTop, afterBottom: scrollTest.afterBottom && { scrollTop: scrollTest.afterBottom.scrollTop, atBottom: scrollTest.afterBottom.atBottom, slack: scanSlack(scrollTest.afterBottom) } }))
    ok(scrollTest.scrollable && scrollTest.afterTop.scrollTop === scrollTest.before.scrollTop,
      'IA5a ★第 16 条：用户滚在上面时来新消息（补丁路径 `logAppend`）⇒ `scrollTop` **一个像素都不动**（改前无条件 `scrollTop = scrollHeight`）',
      JSON.stringify({ before: scrollTest.before && scrollTest.before.scrollTop, after: scrollTest.afterTop && scrollTest.afterTop.scrollTop, slackBefore: scanSlack(scrollTest.before) }))
    ok(scrollTest.afterBottom && scanSlack(scrollTest.afterBottom) <= 2,
      'IA5b 用户本来就贴在底部 ⇒ 仍然继续跟随（不是"永远不跟随"的另一个极端）；容差 2px（② 起从 24px 收紧）',
      JSON.stringify({ slack: scanSlack(scrollTest.afterBottom), atBottom: scrollTest.afterBottom && scrollTest.afterBottom.atBottom }))

    /*  ── IA5c–IA5g(issue0924a2 用户第 16 条复测) **真实产物路径**：`POST /diag` ⇒ 服务端 SSE ⇒
        产物自己的日志函数 `X.appendChild(a),X.scrollTop=X.scrollHeight`（minified，改不了）
        —— 上一版就是漏了这条路，所以"还是会往下跳"。这里用**真路径**量，并且用 `logScrollGuardSet(false)`
        当场 A/B（关掉守卫 = 改前行为 ⇒ 必须复现那一跳），证明判据不恒真。 ───────────────────── */
    const art = await page.evaluate(async () => {
      const api = window.__benchPatch
      const wait = (n) => new Promise((r) => setTimeout(r, n))
      const body = document.getElementById('logbody')
      const ping = async (msg) => {
        try { await fetch('/diag', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msg, source: 'ia5' }) }) } catch { /* 服务端没起：下面按读数判 */ }
        await wait(700)
      }
      const read = () => { const g = api.logScrollProbe(); return { top: body.scrollTop, slack: body.scrollHeight - body.clientHeight - body.scrollTop, probe: g } }
      for (let i = 0; i < 40; i++) api.logAppend('IA5-填充 ' + i)
      await wait(120)
      body.scrollTop = 0
      await wait(200)
      const beforeUp = read()
      await ping('IA5-ARTIFACT-UP')
      const afterArtifactUp = read()
      //  用户滚回底部（真实手势 + 定位）⇒ 跟随恢复
      body.dispatchEvent(new WheelEvent('wheel', { deltaY: 240, bubbles: true }))
      body.scrollTop = body.scrollHeight
      await wait(200)
      await ping('IA5-ARTIFACT-BOTTOM')
      const atBottom = read()
      /*  A/B（**确定性**，不靠 SSE 时机）：逐字复刻产物那两下 —— `appendChild(x); scrollTop = scrollHeight`
          在**同一拍**里，守卫开/关各来一次。为什么不用真 SSE 做 A/B：守卫一关，**任何**晚到的行都会把
          视图拉到底，量"用户滚上去"的前置状态会被它抢掉（本轮实测假红/假绿都出现过）。 */
      const fire = () => { const s = document.createElement('span'); s.textContent = 'IA5-AB-LINE'; body.appendChild(s); body.scrollTop = body.scrollHeight }
      /* ①(P-225 附) **IA5f 竞态修复**：首跑该判据读 `before:0`（scrollTop=0 一拍后日志体的
         scrollHeight 还没长出来 ⇒ slack=0 的竞态）⇒ FAIL；单独重跑 PASS（before:13211）。
         改法：`scrollTop=0` 后用**有界等待**等 `slack > 0`（≤2s，25ms 一拍）再读前置状态——
         **判据意图不变**：日志滚动守卫仍然必须被验证（A/B 两侧的前置状态都等到位才比，
         不比"还没长出内容"的空表）；变异体（守卫改回无条件滚动）照旧必红（IA5f/IA5g 两侧
         的对照语义没有放松）。 */
      const waitSlack = async () => { for (let i = 0; i < 80; i++) { if (body.scrollHeight - body.clientHeight - body.scrollTop > 100) break; await wait(25) } }
      body.scrollTop = 0
      await wait(250)
      await waitSlack()
      const onBefore = read()
      fire()
      await wait(250)
      const onAfter = read()
      const guardOff = api.logScrollGuardSet(false)
      /* 守卫关着时**任何**晚到的行都会把视图拉到底 ⇒ 先 `scrollTop=0` 再等 slack 的前置根本不成立
         （真机实测 `offBefore.slack` 恒 0，判据因此假红）。改成**同一拍**的确定性对照：
         手动置顶后立刻 `fire()`（= 产物那两下：appendChild + scrollTop=scrollHeight），
         守卫关 ⇒ 当场到底（slack≈0）；守卫开（IA5e）⇒ scrollTop 一个像素都不动。意图不变、去竞态。 */
      body.scrollTop = 0
      const offBefore = read()
      fire()
      await wait(250)
      const offAfter = read()
      const guardOn = api.logScrollGuardSet(true)
      body.scrollTop = 0
      await wait(250)
      await waitSlack()
      const onBefore2 = read()
      fire()
      await wait(250)
      const onAfter2 = read()
      return { beforeUp, afterArtifactUp, atBottom, guardOff, onBefore, onAfter, offBefore, offAfter, guardOn, onBefore2, onAfter2 }
    })
    console.log('  IA5c 读数（真实产物路径 POST /diag）=' + JSON.stringify(art))
    ok(art.beforeUp.slack > 100 && art.afterArtifactUp.top === art.beforeUp.top && art.afterArtifactUp.probe && art.afterArtifactUp.probe.droppedWrites > 0,
      'IA5c ★★用户复测的主判据：用户滚在上面时，**产物那条**（`/api/diag-stream` → `X.scrollTop=X.scrollHeight`）新消息到来 ⇒ `scrollTop` 一个像素都不动（守卫丢弃它并计数 `droppedWrites`）',
      JSON.stringify({ before: art.beforeUp.top, after: art.afterArtifactUp.top, dropped: art.afterArtifactUp.probe && art.afterArtifactUp.probe.droppedWrites }))
    ok(scanSlack(art.atBottom) <= 2,
      'IA5d 用户自己滚回底部之后 ⇒ 跟随恢复（新消息继续贴底）',
      JSON.stringify({ slack: scanSlack(art.atBottom), reason: art.atBottom.probe && art.atBottom.probe.lastReason }))
    ok(art.onBefore.slack > 100 && art.onAfter.top === art.onBefore.top && art.onAfter.probe.droppedWrites > art.onBefore.probe.droppedWrites,
      'IA5e ★守卫在位：复刻产物那一拍（`appendChild` + `scrollTop = scrollHeight` **同一拍**）⇒ `scrollTop` 一个像素都不动，且丢弃计数 +1',
      JSON.stringify({ before: art.onBefore.top, after: art.onAfter.top, dropped: [art.onBefore.probe.droppedWrites, art.onAfter.probe.droppedWrites] }))
    ok(art.guardOff && art.guardOff.guard === false && scanSlack(art.offAfter) <= 2 && art.offBefore.top === 0,
      'IA5f ★★A/B 对照（同一入口 `logScrollGuardSet(false)` = 改前行为）：守卫一关，**同样两下**当场把视图拉到底（slack → 0）⇒ IA5c/IA5e 的绿灯不是恒真',
      JSON.stringify({ guardOff: art.guardOff && { guard: art.guardOff.guard, follow: art.guardOff.follow }, before: scanSlack(art.offBefore), after: scanSlack(art.offAfter) }))
    ok(art.guardOn && art.guardOn.guard === true && art.onBefore2.slack > 100 && art.onAfter2.top === art.onBefore2.top,
      'IA5g 重新打开守卫 ⇒ 同一条件下不再跳（对照可逆）',
      JSON.stringify({ top: art.onAfter2.top, guard: art.guardOn && art.guardOn.guard }))

    /*  ── IA10(用户第 3 条) 音量控件在 **NP 卡片内部**（滑条 + 静音第四键）＋ 那条独立音量行已撤 ──── */
    const vol10 = await page.evaluate(async () => {
      const api = window.__benchPatch
      const wait = (n) => new Promise((r) => setTimeout(r, n))
      const props = document.querySelector('#props')
      if (props) { props.hidden = false; props.removeAttribute('hidden') }
      const host = document.querySelector('#np-host')
      if (host) host.style.display = ''
      const collapsed = { hasVolume: !!document.querySelector('#np-volume'), bar: !!document.querySelector('#np-volbar') }
      let geo = null
      for (let i = 0; i < 6; i++) {
        geo = api.npGeometry ? api.npGeometry() : null
        if (geo && geo.volumeVisible) break
        const tap = document.querySelector('#np-host .snd-tap')
        if (tap) tap.click()
        await wait(900)
      }
      return {
        collapsed,
        geo,
        slider: api.npVolumeSlider ? api.npVolumeSlider() : null,
        mute: api.npMuteKey ? api.npMuteKey() : null,
        volbarGone: !document.querySelector('#np-volbar') && !document.querySelector('#np-volnum'),
        clockSpans: [...document.querySelectorAll('#np-mount .snd-clock span')].map((x) => String(x.textContent || '')),
      }
    })
    console.log('  IA10 读数 =' + JSON.stringify(vol10))
    ok(vol10.volbarGone && vol10.collapsed.bar === false,
      'IA10a ★★用户第 3 条：卡片下面那条独立音量行（`#np-volbar` / `#np-volnum`）**不存在**（改前：它就在 NP 卡片正下方）',
      JSON.stringify({ volbarGone: vol10.volbarGone, bar: vol10.collapsed.bar }))
    ok(!!vol10.geo && vol10.geo.volumeVisible === true && vol10.geo.volumeInCard === true && vol10.geo.volumeInCardX === true &&
      vol10.geo.volumeOverflow === false && vol10.geo.muteInCard === true && vol10.geo.volKeyPresent === true,
      'IA10b ★★音量控件（滑条 + 静音第四键）在 **NP 卡片内部**：`volumeInCard/volumeInCardX/muteInCard` 为真、`volumeOverflow` 为假（几何判据：滑条矩形 ⊆ `.snd-box` 矩形）',
      JSON.stringify(vol10.geo && { v: vol10.geo.volumeVisible, inCard: vol10.geo.volumeInCard, inX: vol10.geo.volumeInCardX, ovf: vol10.geo.volumeOverflow, mute: vol10.geo.muteInCard, slider: vol10.geo.slider, card: vol10.geo.card }))
    ok(!!vol10.geo && vol10.geo.volumeInStrip === false && vol10.geo.stripHasVolume === false,
      'IA10c 传输条 `#np-audio`（壁纸配置**最下面**那一行）里没有音量控件 —— 用户第 2 条的要求继续成立',
      JSON.stringify({ inStrip: vol10.geo && vol10.geo.volumeInStrip, stripHas: vol10.geo && vol10.geo.stripHasVolume }))
    ok(!!vol10.slider && vol10.slider.present === true && vol10.slider.inCard === true && !!vol10.mute && vol10.mute.present === true,
      'IA10d 探针读数（门禁与真机同一入口）：`npVolumeSlider()` 给出 `#np-volume`（present/inCard/value/disabled/pct）+ `npMuteKey()` 给出第四键（pressed/muted/disabled）',
      JSON.stringify({ slider: vol10.slider, mute: vol10.mute }))
    ok(vol10.collapsed.hasVolume === false,
      'IA10e 收起态（胶囊）里**没有**音量滑条节点（组件只在卡片展开时渲染它 —— 胶囊的几何一个像素都不多）',
      JSON.stringify(vol10.collapsed))

    /*  ── IA11(用户第 7 条) 换渲染器档：未选择壁纸 ⇒ **不许**凭空加载上一次那张 ─────────────────── */
    const tier11 = await page.evaluate(async () => {
      const api = window.__benchPatch
      const wait = (n) => new Promise((r) => setTimeout(r, n))
      const frameSrc = () => String((document.getElementById('frame') || {}).getAttribute?.('src') || '')
      const curText = () => String((document.getElementById('current') || {}).textContent || '')
      const pick = async (id) => {
        let li = null
        for (let i = 0; i < 40; i++) {
          li = [...document.querySelectorAll('#list li[data-id]')].find((x) => !id || x.dataset.id === id) || [...document.querySelectorAll('#list li[data-id]')][0]
          if (li) break
          await wait(250)
        }
        if (!li) return null
        li.click(); await wait(3200)
        return String(li.dataset.id || '')
      }
      const picked = await pick('')
      const afterPick = { src: frameSrc().slice(0, 60), cur: curText().slice(0, 24), active: document.querySelectorAll('#list li.active').length }
      /*  ⚠前面的组可能已经固定了好几张（`#editor-tabs` 里一串标签）⇒ 只点一次 `×` 会**回落到相邻那张**。
          用户的场景是"我把上面选过的所有壁纸都叉掉了" ⇒ 这里也一直叉到空为止（最多 8 次，防御性上限）。 */
      const closedTabs = []
      for (let i = 0; i < 8; i++) {
        const x = document.querySelector('.wp-x-cur') || document.querySelector('#editor-tabs .wp-x')
        if (!x) break
        closedTabs.push(String(x.dataset.id || ''))
        x.click()
        await wait(2600)
        if (document.querySelectorAll('#list li.active').length === 0 && !frameSrc()) break
      }
      const clear = api.artifactClearProbe ? api.artifactClearProbe() : null
      const afterClose = { src: frameSrc(), cur: curText().slice(0, 24), active: document.querySelectorAll('#list li.active').length, clear, nothing: api.nothingSelected ? api.nothingSelected() : null, closedTabs }
      const sel = document.getElementById('renderer-src')
      const mode0 = sel ? sel.value : ''
      if (sel) { sel.value = 'upstream'; sel.dispatchEvent(new Event('change', { bubbles: true })) }
      await wait(2600)
      let canvas = null
      try { const d = document.getElementById('frame').contentDocument; canvas = d ? d.querySelectorAll('canvas').length : null } catch (e) { canvas = 'err' }
      const afterSwitch = { src: frameSrc(), cur: curText().slice(0, 24), active: document.querySelectorAll('#list li.active').length, empty: (document.getElementById('empty') || {}).style?.display, canvas }
      //  产物自己那个「重挂载」按钮（不经过补丁的守卫）：`w` 已清 ⇒ 应当什么都不做
      const reload = document.getElementById('reload')
      if (reload) reload.click()
      await wait(2200)
      const afterArtifactReload = { src: frameSrc(), cur: curText().slice(0, 24), active: document.querySelectorAll('#list li.active').length }
      //  「新窗口」这一下现在应该什么都不开
      const opened = []
      const orig = window.open
      window.open = (...a) => { opened.push(String(a[0] || '')); return null }
      const ob = document.getElementById('open')
      if (ob) ob.click()
      await wait(300)
      window.open = orig
      //  收尾：切回本仓档 + 重新选一张（证明守卫不会误伤正常选择）
      if (sel) { sel.value = 'repo'; sel.dispatchEvent(new Event('change', { bubbles: true })) }
      await wait(1200)
      const reselect = await pick('')
      await wait(2500)
      const afterReselect = { id: reselect, src: frameSrc().slice(0, 60), active: document.querySelectorAll('#list li.active').length, cur: curText().slice(0, 24) }
      //  回到"未选择"（后面各组按空态走；IA8 之前也已经把舞台释放过）
      for (let i = 0; i < 8; i++) {
        const x2 = document.querySelector('.wp-x-cur') || document.querySelector('#editor-tabs .wp-x')
        if (!x2) break
        x2.click()
        await wait(2200)
        if (document.querySelectorAll('#list li.active').length === 0 && !frameSrc()) break
      }
      return { picked, afterPick, afterClose, mode0, afterSwitch, afterArtifactReload, opened, afterReselect, final: { src: frameSrc(), cur: curText().slice(0, 24) } }
    })
    console.log('  IA11 读数 =' + JSON.stringify(tier11))
    ok(tier11.afterClose.active === 0 && /未选择壁纸|No wallpaper/i.test(tier11.afterClose.cur) && !tier11.afterClose.src,
      'IA11a 前提成立：叉掉最后一张壁纸之后确实是"未选择壁纸"态（`#current` 文案 + 0 个 `.active` + `#frame` 无 src）',
      JSON.stringify({ cur: tier11.afterClose.cur, active: tier11.afterClose.active, src: tier11.afterClose.src }))
    ok(!!tier11.afterClose.clear && tier11.afterClose.clear.ran === true && tier11.afterClose.clear.cleared === true,
      'IA11b ★★真因修法：借产物自己的 `ht()` 把它的"当前项"（`w`）清成 null（`artifactClearProbe().cleared === true`）—— 只有这样 `Ae()` 才会在第一行 `if(!w)return` 收手',
      JSON.stringify(tier11.afterClose.clear))
    ok(!tier11.afterSwitch.src && /未选择壁纸|No wallpaper/i.test(tier11.afterSwitch.cur) && tier11.afterSwitch.active === 0 &&
      (tier11.afterSwitch.canvas === 0 || tier11.afterSwitch.canvas === null),
      'IA11c ★★用户第 7 条主判据：切到「上游产物」档**没有加载任何壁纸**（`#frame` 仍无 src、`#current` 还是"未选择壁纸"、预览里没有 canvas、列表 0 个 `.active`）—— 改前：src 变成 `…&src=<最后那张>…` 且 canvas = 1',
      JSON.stringify(tier11.afterSwitch))
    ok(!tier11.afterArtifactReload.src && tier11.afterArtifactReload.active === 0,
      'IA11d 产物自己那个「重挂载」按钮也不再凭空挂壁纸（`w` 已清 ⇒ `Ae()` 直接返回）',
      JSON.stringify(tier11.afterArtifactReload))
    ok(tier11.opened.length === 0,
      'IA11e 「新窗口」在未选择壁纸时**什么都不打开**（改前：`w && window.open(…)` 会打开叉掉的那张；用户报的"新窗口"就是这一下）',
      JSON.stringify(tier11.opened))
    ok(tier11.afterReselect.active === 1 && !!tier11.afterReselect.src && String(tier11.afterReselect.src).length > 0,
      'IA11f 守卫**不误伤**：切回本仓档后重新选一张壁纸，预览照常挂载（`#frame` 有 src + 1 个 `.active`）',
      JSON.stringify(tier11.afterReselect))

    /* ── IA6 第 11 条：说明/壁纸设置只显示一种语言 + 两语 API 列表同源 ─────────────────── */
    const bil = await page.evaluate(() => {
      const d = document.documentElement
      const api = window.__benchPatch
      const old = String(d.lang || '')
      const read = () => api.docBilingualProbe()
      d.lang = 'zh-CN'
      const zh = read()
      d.lang = 'en'
      const en = read()
      d.lang = old || 'zh-CN'
      return { zh, en }
    })
    const brief11 = (b) => b && { lang: b.lang, isEn: b.isEn, hidden: b.hiddenBlocks, langFilterOk: b.langFilterOk, visible: b.visibleBlocks, wpset: b.wpset }
    console.log('  IA6 读数 =' + JSON.stringify({ zh: brief11(bil.zh), en: brief11(bil.en) }))
    ok(!!bil.zh && bil.zh.langFilterOk === true && !!bil.en && bil.en.langFilterOk === true,
      'IA6a ★第 11 条：中文档下 `.lang-en` 全被 `display:none`、英文档下 `.lang-zh` 全被 `display:none`（两个方向都验）',
      JSON.stringify({ zh: brief11(bil.zh), en: brief11(bil.en) }))
    ok(!!bil.zh && bil.zh.wpset && bil.zh.wpset.sameRows === true && bil.zh.wpset.zhRows === bil.zh.wpset.enRows && bil.zh.wpset.zhRows >= 20,
      'IA6b ★壁纸设置两语表格**逐表逐行同键**（中英同源；改前英文表缺行）',
      JSON.stringify(bil.zh && bil.zh.wpset))

    /* ── IA7 第 17 条：壁纸配置里没有裸的原生 select ──────────────────────────────────── */
    const sel7 = await page.evaluate(() => (window.__benchPatch.propsSelectProbe ? window.__benchPatch.propsSelectProbe() : null))
    console.log('  IA7 读数 propsSelectProbe=' + JSON.stringify(sel7))
    ok(!!sel7 && (sel7.panel === false || sel7.native === 0),
      'IA7 ★第 17 条：壁纸配置面板里**没有未增强的原生 `<select>`**（`native === 0`；全部走 `mpw-select.js` 自绘）',
      JSON.stringify(sel7))

    /* ── IA8 第 19 条：释放要真的停干净（日志不再增长 + 轮询停 + iframe 清空）───────────── */
    const rel = await page.evaluate(async () => {
      const api = window.__benchPatch
      const wait = (n) => new Promise((r) => setTimeout(r, n))
      const lines0 = (document.getElementById('logbody') || { children: [] }).children.length
      const btn = document.getElementById('release')
      if (btn) btn.click()
      await wait(2600)
      const p = api.releaseQuietProbe ? api.releaseQuietProbe() : null
      const lines1 = (document.getElementById('logbody') || { children: [] }).children.length
      await wait(1200)
      const lines2 = (document.getElementById('logbody') || { children: [] }).children.length
      return { lines0, lines1, lines2, probe: p, hasRelease: !!btn }
    })
    console.log('  IA8 读数 releaseQuietProbe=' + JSON.stringify({ lines: [rel.lines0, rel.lines1, rel.lines2], probe: rel.probe }))
    ok(rel.hasRelease && rel.lines2 === rel.lines1,
      'IA8a ★第 19 条：点「释放」之后再等 1.2s，输出区**一行都没多**（改前：没选中壁纸时这一点击是空操作，日志一直在刷）',
      JSON.stringify({ lines: [rel.lines0, rel.lines1, rel.lines2] }))
    ok(!!rel.probe && rel.probe.quiet === true && rel.probe.pollRunning === false && rel.probe.frameBlank === true,
      'IA8b ★释放三件套的读数：门闩在位、那条 1.2s 轮询已停、预览 iframe 已清空（`about:blank`）',
      JSON.stringify(rel.probe))
    ok(!!rel.probe && rel.probe.artifactChainDetached === true,
      'IA8c ★产物那条会抛错的 `#release.onclick` 已被摘掉（`artifactChainDetached=true`）—— 改前它每次都抛 ' +
      '`TypeError: E().release is not a function`（默认档的 `__wp` 没有 release），点击等于没做，还弹全局错误条盖住页签条',
      JSON.stringify(rel.probe && { detached: rel.probe.artifactChainDetached, saved: rel.probe.artifactChainSaved }))
  
}
