#!/usr/bin/env node
// data-limits-test.mjs — P-104 发布纪律①②：**自动上报默认关** + **一切自动落盘都有上限**
//
// 用户原话（2026-09-16/17）：
//   ①"像你这种测试用的自动上报的功能，这种你在上传仓库的时候要把它默认给关掉。"
//   ②"这种自动上报、自动把什么存储到本地的类型的东西，这种需要设置上限的，这上限别忘记了。"
//
// 四段断言，全部是**会变红**的（不是"文档里写了"）：
//   [A] 默认不自动上报：真值表（不带开关 → false）+ 真源码守卫（两条定时器**只**在 `if (autoReport)` 里）
//       + 手动按钮不被自动开关连坐 + **真服务空跑 3s：reports/ 一个文件都不新增**
//   [B] 服务端落盘上限：reports 数量/字节、selfcheck 数量、shots 每 id 数量/字节、shots 全局字节；
//       超限后**最旧的被删**且回到限内，**清理动作有日志**；启动清理一次；别人的产物不被误删
//   [C] 渲染器 localStorage：键数量 + 总量超限按 LRU 淘汰并记日志；单值超限**拒写并记日志**
//   [D] 插件 diag-*.json：数量/字节上限（最旧先删）+ 清理日志 + 启动清理接线 + 客户端自动上报默认关
//
// 上限的**唯一来源**（本文件不复制一份数字，全部从源码切片里读）：
//   server/we-scene-demo-server.mjs → MPW_LIMITS（env 可覆盖，测试把上限压到很小才能秒级验完清理路径）
//   demo.html                        → MPW_LS_LIMITS
//   dsh-mpkg-wallpaper/lib/index.js  → DIAG_KEEP / DIAG_MAX_BYTES / pruneDiagDir
//
// 用法: node tests/data-limits-test.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { ROOT } from './_root.mjs'

const HERE = ROOT
// ①(2026-10-30 路径固化) 插件树解析：env MPW_PLUGIN_DIR → 集成布局 `ROOT/../plugin` → 旧兄弟仓名回退。
const PLUGIN_DIR = [process.env.MPW_PLUGIN_DIR, path.resolve(ROOT, '..', 'plugin'), path.resolve(ROOT, '..', 'dsh-mpkg-wallpaper')]
  .filter(Boolean).find((p) => { try { return fs.existsSync(path.join(p, 'lib', 'index.js')) } catch { return false } })
const HTML = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8')
const SERVER_SRC = fs.readFileSync(path.join(ROOT, 'server', 'we-scene-demo-server.mjs'), 'utf8')
const PLUGIN_INDEX = fs.readFileSync(path.join(PLUGIN_DIR, 'lib', 'index.js'), 'utf8')
const PLUGIN_CLIENT = fs.readFileSync(path.join(PLUGIN_DIR, 'lib', 'client.js'), 'utf8')

let pass = 0, fail = 0
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}
/** 从 src 里切出 begin/end 标记之间的整段（含标记），切不到返回 '' */
const sliceMarks = (src, begin, end) => {
  const i = src.indexOf(begin)
  if (i < 0) return ''
  const j = src.indexOf(end, i)
  if (j < 0) return ''
  return src.slice(i, j + end.length)
}
/** 从 `head` 字面量开始，按花括号配平切出整块（用于 `if (autoReport) { … }` 这类门控块） */
const braceBlockAfter = (src, head) => {
  const i = src.indexOf(head)
  if (i < 0) return ''
  let depth = 0, started = false
  for (let k = i; k < src.length; k++) {
    const ch = src[k]
    if (ch === '{') { depth++; started = true }
    else if (ch === '}') { depth--; if (started && depth === 0) return src.slice(i, k + 1) }
  }
  return ''
}
const countOf = (src, needle) => src.split(needle).length - 1
const mb = (n) => (n / 1048576).toFixed(2)
const freePort = () => new Promise((res, rej) => {
  const s = net.createServer()
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) })
  s.on('error', rej)
})
/** 起一个真服务（临时 MPW_REPORTS_DIR + 可覆盖上限的 env）；返回 { child, base, dir, logPath, log(), stop() } */
async function startServer(env) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-limits-'))
  const logPath = path.join(dir, 'server.log')
  const fd = fs.openSync(logPath, 'a')
  const port = await freePort()
  const child = spawn(process.execPath, ['server/we-scene-demo-server.mjs'], {
    cwd: HERE,
    env: { ...process.env, PORT: String(port), MPW_REPORTS_DIR: dir, ...env },
    stdio: ['ignore', fd, fd],
  })
  const base = 'http://127.0.0.1:' + port
  let ready = false
  for (let i = 0; i < 120 && !ready; i++) {
    if (child.exitCode !== null) break
    try { await fetch(base + '/diag-flags.json', { signal: AbortSignal.timeout(800) }); ready = true } catch { await new Promise((r) => setTimeout(r, 150)) }
  }
  const api = {
    child, base, dir, logPath, ready,
    log: () => { try { return fs.readFileSync(logPath, 'utf8') } catch { return '' } },
    stop: () => { try { child.kill('SIGKILL') } catch { /* ignore */ } },
  }
  return api
}
const post = async (base, p, body, ct) => {
  try {
    const r = await fetch(base + p, { method: 'POST', headers: ct ? { 'content-type': ct } : {}, body })
    return r.status
  } catch (e) { return 'ERR:' + e.message }
}
const listing = (dir) => { try { return fs.readdirSync(dir) } catch { return [] } }
const filesOf = (dir, re) => listing(dir).filter((n) => re.test(n))
const bytesOf = (dir, names) => names.reduce((s, n) => { try { return s + fs.statSync(path.join(dir, n)).size } catch { return s } }, 0)

// ─────────────────────────────────────────────────────────────────────────────
console.log('[A] 自动上报默认关（发布纪律①）')
{
  // A1 真值表：把 demo.html 里那一行真源码切出来跑（不是另写一份判断）
  const expr = (() => {
    const m = /const autoReport = [\s\S]*?get\('report'\) === 'auto'/.exec(HTML)
    return m ? m[0] : ''
  })()
  const autoReportFrom = expr
    ? new Function('location', expr + '\nreturn autoReport')   // eslint-disable-line no-new-func
    : null
  const at = (q) => (autoReportFrom ? autoReportFrom({ search: q }) : null)
  check('A1 真源码切到 `const autoReport = …` 表达式（长度 ' + expr.length + '）', !!autoReportFrom && expr.length > 60)
  check('A2 **不带任何开关 → 自动上报=关**（这一条就是用户第 1 条纪律的机器判据）',
    at('') === false, 'search="" → ' + at(''))
  check('A3 `?report=auto` → 开；其它值（`1` / 空 / 拼错）一律按关',
    at('?report=auto') === true && at('?report=1') === false && at('?report=') === false && at('?report=AUTO') === false,
    JSON.stringify([at('?report=auto'), at('?report=1'), at('?report='), at('?report=AUTO')]))
  check('A4 `?noreport` 仍是显式关，且**优先级高于** `?report=auto`',
    at('?noreport') === false && at('?noreport=1') === false && at('?report=auto&noreport=1') === false)

  // A5 真源码：两条定时器只在 `if (autoReport)` 门控块里，且全文各只出现一次
  const guard = braceBlockAfter(HTML, 'function startAutoReport(')
  const timerA = 'setTimeout(doReport, 700)'
  const timerB = 'setInterval(doReport, 10000)'
  check('A5 自动路径的两条定时器（首帧 700ms / 每 10s）**只**出现在 `startAutoReport()` 块内，且 `?report=auto` 仍调它（P-277 抽函数后的等价判据）',
    guard.length > 100 && guard.includes(timerA) && guard.includes(timerB)
    && countOf(HTML, timerA) === 1 && countOf(HTML, timerB) === 1
    && /if \(autoReport\) \{\s*\n\s*startAutoReport\('\?report=auto'\)/.test(HTML),
    'guard=' + guard.length + ' 次A=' + countOf(HTML, timerA) + ' 次B=' + countOf(HTML, timerB))

  // A6 手动上报入口不被自动开关连坐（用户显式动作必须留着）
  const uiGuard = braceBlockAfter(HTML, 'if (mpwReportUI) {')
  const btnBegin = HTML.indexOf('// ═══ MPW-REPORT-BTN-BEGIN')
  const btnEnd = HTML.indexOf('// ═══ MPW-REPORT-BTN-END ═══')
  check('A6 `🛰 立即上报` 按钮块仍在**恒真**门控里（改自动开关不会把按钮一起摘掉）',
    /const mpwReportUI = true/.test(HTML) && uiGuard.length > 1000
    && btnBegin > HTML.indexOf('if (mpwReportUI) {') && btnEnd > btnBegin
    && !guard.includes('MPW-REPORT-BTN-BEGIN'),
    'btn=' + (btnEnd - btnBegin) + 'B guard含按钮=' + guard.includes('MPW-REPORT-BTN-BEGIN'))
  check('A7 按钮 title 写清"会上传当前画面与诊断到本地服务器 /report"（用户要求 UI 上讲明白）',
    /POST 到本地服务器 \/report/.test(HTML) && /会上传当前画面与诊断/.test(HTML))

  // A8 真服务空跑：不带开关 = 客户端不会发任何上报 ⇒ 临时 reports/ 3 秒内不新增文件
  const srv = await startServer({})
  try {
    check('A8 子进程服务就绪（临时 MPW_REPORTS_DIR）', srv.ready, srv.base)
    const before = listing(srv.dir)
    await new Promise((r) => setTimeout(r, 3000))
    const after = listing(srv.dir)
    check('A9 **默认（无 ?report=auto）空跑 3s：reports/ 零新增文件**（结构上不存在自动上报：两条定时器没建）',
      srv.ready && after.length === before.length && filesOf(srv.dir, /^(r\d+|selfcheck-\d+)\.json$/).length === 0,
      'before=' + before.length + ' after=' + after.length + ' json=' + filesOf(srv.dir, /\.json$/).length)
  } finally { srv.stop() }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('[B] 服务端落盘上限（发布纪律②）：超限 → 最旧先删 → 回到限内 + 清理日志')
{
  const srv = await startServer({
    MPW_LIMIT_REPORTS_MAX: '5',
    MPW_LIMIT_SELFCHECK_MAX: '3',
    MPW_LIMIT_REPORTS_BYTES: String(200 * 1024),
    MPW_LIMIT_SHOT_FILES: '4',
    MPW_LIMIT_SHOT_ID_BYTES: String(120 * 1024),
    MPW_LIMIT_SHOT_TOTAL_BYTES: String(200 * 1024),
  })
  try {
    check('B1 服务端源码：上限集中在 MPW_LIMITS 一处（含 env 覆盖 + 非法值回落默认）',
      /const MPW_LIMITS = \{/.test(SERVER_SRC) && /MPW_LIMIT_REPORTS_MAX/.test(SERVER_SRC)
      && /numEnv\('MPW_LIMIT_SHOT_TOTAL_BYTES'/.test(SERVER_SRC))
    check('B2 服务端源码：启动清理一次 + 写入前/后各检查一次',
      /pruneAllOnStartup\(\)/.test(SERVER_SRC)
      && countOf(SERVER_SRC, 'pruneReports(dir)') >= 4   // /report 前+后、/diag 前+后
      && /pruneShotsId\(sid\);   \/\/ ①\(P-104\) 写入前检查/.test(SERVER_SRC)
      && /pruneShotsId\(sid\);\n          pruneShotsAll\(\);/.test(SERVER_SRC))

    // B3 reports 数量上限：灌 12 份 → ≤5，最旧的被删、最新的在
    const rBodies = []
    for (let i = 0; i < 12; i++) {
      const marker = 'REPORT-' + i
      rBodies.push(marker)
      await post(srv.base, '/report', JSON.stringify({ i, marker, pad: 'x'.repeat(2000) }))
    }
    const rs = filesOf(srv.dir, /^r\d+\.json$/).sort()
    const rTexts = rs.map((n) => fs.readFileSync(path.join(srv.dir, n), 'utf8'))
    check('B3 reports 数量上限：灌 12 份（上限 5）→ 只剩 5 份，且**最新那份还在、最旧的 0/1 已被删**',
      rs.length === 5 && rTexts.some((t) => t.includes('REPORT-11'))
      && !rTexts.some((t) => t.includes('REPORT-0')) && !rTexts.some((t) => t.includes('REPORT-6')),
      'n=' + rs.length)

    // B4 selfcheck 数量上限：/diag 灌 8 份 → ≤3（这条路上限此前**完全不存在**）
    for (let i = 0; i < 8; i++) await post(srv.base, '/diag', JSON.stringify({ i, pad: 'y'.repeat(2000) }))
    const sc = filesOf(srv.dir, /^selfcheck-\d+\.json$/)
    check('B4 selfcheck（/diag）数量上限：灌 8 份（上限 3）→ 只剩 ≤3 份（旧实现这条路**零滚动**）',
      sc.length === 3, 'n=' + sc.length)

    // B5 reports 字节上限：大报告灌到超 200KB → 合计回到限内
    for (let i = 0; i < 12; i++) await post(srv.base, '/report', JSON.stringify({ i, pad: 'z'.repeat(30000) }))
    const rAll = filesOf(srv.dir, /^(r\d+|selfcheck-\d+)\.json$/)
    const rBytes = bytesOf(srv.dir, rAll)
    check('B5 reports 字节上限：合计 ≤200KB（数量没超、字节超了 → 也按"最旧先删"收回来）',
      rBytes <= 200 * 1024 && rBytes > 0, 'bytes=' + rBytes + ' 份数=' + rAll.length)

    // B6 shots 每 id 数量上限（单帧 30KB 同时受 120KB 字节限影响 ⇒ 断言"≤4 且删的是最旧的"）
    const JPG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(30 * 1024, 7)])
    for (let i = 0; i < 10; i++) await post(srv.base, '/shot?id=limA&tag=b&frame=' + i, JPG, 'image/jpeg')
    const dirA = path.join(srv.dir, 'shots', 'limA')
    const shotsA = filesOf(dirA, /\.jpg$/)
    const ledgerA = (() => {
      try { return fs.readFileSync(path.join(dirA, 'index.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).file) } catch { return [] }
    })()
    check('B6 shots **每 id 数量上限**：灌 10 帧（每帧 30KB、上限 4 帧 / 120KB）→ 留下的**恰好是台账里最后那几帧**（最旧先删）',
      shotsA.length <= 4 && shotsA.length >= 1 && ledgerA.length === 10
      && shotsA.slice().sort().join(',') === ledgerA.slice(-shotsA.length).slice().sort().join(','),
      'n=' + shotsA.length + ' 台账=' + ledgerA.length + ' 保留=' + JSON.stringify(shotsA.slice().sort().slice(-1)))

    // B7 shots 每 id 字节上限（单帧 30KB × 上限 120KB → 只能留 4 帧；这里换个 id 用更小的字节顶）
    const srv2 = await startServer({ MPW_LIMIT_SHOT_FILES: '100', MPW_LIMIT_SHOT_ID_BYTES: String(70 * 1024) })
    try {
      for (let i = 0; i < 6; i++) await post(srv2.base, '/shot?id=limB&tag=b', JPG, 'image/jpeg')
      const d2 = path.join(srv2.dir, 'shots', 'limB')
      const n2 = filesOf(d2, /\.jpg$/)
      check('B7 shots **每 id 字节上限**：6 帧 ×30KB（字节上限 70KB、数量上限 100）→ 剩 ≤2 帧且字节 ≤70KB',
        n2.length <= 2 && bytesOf(d2, n2) <= 70 * 1024 && n2.length > 0,
        'n=' + n2.length + ' bytes=' + bytesOf(d2, n2))
    } finally { srv2.stop() }

    // B8 shots 全局字节上限：两个 id 各灌 → 合计 ≤ 上限，且是"每次删所有 id 里最旧的一帧"
    const srv3 = await startServer({ MPW_LIMIT_SHOT_FILES: '100', MPW_LIMIT_SHOT_ID_BYTES: String(1024 * 1024), MPW_LIMIT_SHOT_TOTAL_BYTES: String(70 * 1024) })
    try {
      for (let i = 0; i < 3; i++) { await post(srv3.base, '/shot?id=g1&tag=b', JPG, 'image/jpeg'); await post(srv3.base, '/shot?id=g2&tag=b', JPG, 'image/jpeg') }
      const n1 = filesOf(path.join(srv3.dir, 'shots', 'g1'), /\.jpg$/)
      const n2 = filesOf(path.join(srv3.dir, 'shots', 'g2'), /\.jpg$/)
      check('B8 shots **全局字节上限**（跨 id 合计 70KB）：g1+g2 总字节 ≤70KB 且**两个 id 都还在**（不是一次掏空一个 id）',
        bytesOf(path.join(srv3.dir, 'shots', 'g1'), n1) + bytesOf(path.join(srv3.dir, 'shots', 'g2'), n2) <= 70 * 1024
        && n1.length >= 1 && n2.length >= 1 && n1.length + n2.length >= 2,
        'g1=' + n1.length + ' g2=' + n2.length + ' bytes=' + (bytesOf(path.join(srv3.dir, 'shots', 'g1'), n1) + bytesOf(path.join(srv3.dir, 'shots', 'g2'), n2)))
    } finally { srv3.stop() }

    // B9 **别人的产物不许被误删**（MPW_REPORTS_DIR 默认就是工作区根的 reports/，那里有 parity-*.json）
    fs.writeFileSync(path.join(srv.dir, 'parity-keepme.json'), '{"keep":1}')
    fs.writeFileSync(path.join(srv.dir, 'sandbox-b6-renderer.md'), '# keep')
    await post(srv.base, '/report', JSON.stringify({ i: 999 }))
    await post(srv.base, '/report', JSON.stringify({ i: 1000 }))
    check('B9 过滤器只认自己的文件名：`parity-*.json` / `*.md` 在清理后**原封不动**',
      fs.existsSync(path.join(srv.dir, 'parity-keepme.json')) && fs.existsSync(path.join(srv.dir, 'sandbox-b6-renderer.md')))

    // B10 清理日志（用户要求"清理动作要打日志"）
    await new Promise((r) => setTimeout(r, 200))
    const log = srv.log()
    const lines = log.split('\n').filter((l) => l.includes('[prune]'))
    check('B10 **清理日志**出现且格式是"已删除 N 个最旧文件，释放 X MB"',
      lines.length > 0 && lines.every((l) => /已删除 \d+ 个最旧文件，释放 \d+\.\d\d MB/.test(l)),
      'prune 行数=' + lines.length + ' 样例=' + JSON.stringify((lines[0] || '').slice(0, 110)))
    check('B11 启动日志里有"启动清理完成"一行（含各类上限值，便于现场一眼看到上限是多少）',
      /\[limits\] 启动清理完成/.test(log) && /上限：reports \d+ 份\/\d+MB；每 id \d+ 帧\/\d+MB；shots 合计 \d+MB/.test(log))
  } finally { srv.stop() }

  // B12 **启动清理一次**：先塞 20 份超限文件，再起服务 → 启动即收到限内（不需要任何人 POST）
  {
    const seedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-limits-seed-'))
    for (let i = 0; i < 20; i++) fs.writeFileSync(path.join(seedDir, 'r' + (1789000000000 + i) + '.json'), '{"i":' + i + '}')
    const srv4 = await startServer({ MPW_REPORTS_DIR: seedDir, MPW_LIMIT_REPORTS_MAX: '5' })
    try {
      /* ①(2026-09-24 套件负载下的时序刀口) 原来固定等 300ms —— HTTP 先 listen、**启动清理在其后**，
         满载（全量套件并行跑）时 300ms 会早于那次清理 ⇒ 假红（实测读数 `n=20 min=1789000000000`）。
         改成**有界轮询**：最多 8s，读到限内即走（清理仍是"服务启动时自己做的、不需要任何 POST"，
         语义没变）；超时也照读，读数里带 waitedMs 便于分辨"真没清理"与"还没轮到"。 */
      const t0 = Date.now()
      let left = filesOf(seedDir, /^r\d+\.json$/).sort()
      while (Date.now() - t0 < 8000 && left.length > 5) {
        await new Promise((r) => setTimeout(r, 100))
        left = filesOf(seedDir, /^r\d+\.json$/).sort()
      }
      const waitedMs = Date.now() - t0
      const nums = left.map((n) => Number(/^r(\d+)\.json$/.exec(n)[1]))
      check('B12 **启动清理一次**：预先塞 20 份（上限 5）→ 服务一起来就只剩 5 份，且留下的都是**最新**的 5 个',
        srv4.ready && left.length === 5 && Math.min(...nums) === 1789000000015,
        'n=' + left.length + ' min=' + (nums.length ? Math.min(...nums) : '-') + ' waitedMs=' + waitedMs)
      check('B13 启动清理也打日志（[limits] + [prune] 两行都在）',
        /\[limits\] 启动清理完成/.test(srv4.log()) && /\[prune\] reports\//.test(srv4.log()))
    } finally { srv4.stop() }
  }

  // ═══ ①(2026-09-19 实测到的**同类缺陷**：超限时"先掐连接再写响应" ⇒ 客户端只看得到 ECONNRESET) ═══
  //   四个 POST 接收端（/diag · /report · /baseline · /shot）原来都在 data 事件里 `req.destroy()`：
  //   curl 实测 `status=100 / exit=56`，也就是"如实回报 413"这条口径在**超限这条路上从来没成立过**。
  //   修好后的口径（与 `/shot` 那条早就修好的路一致，其余三条现在也照它改）：
  //     ① 超限后**继续把请求体读干净但不再缓存**（内存不再增长）⇒ 到 `end` 回 **413 + JSON 说明**；
  //     ② 绝不 `req.pause()`（实测：pause ⇒ `end` 永不触发 ⇒ 请求挂到客户端超时，服务端一句话都不回）；
  //     ③ 超限的载荷**一个字节都不许落盘**，服务也不能崩（紧接着 /api 仍要 200）。
  {
    const srvL = await startServer({ MPW_LIMIT_REPORTS_MAX: '5' })
    try {
      const big = 'x'.repeat(200 * 1024)                      // 200KB：比 /diag(16KB) 与 /baseline(1MB 以下) 大
      const bigBl = new Blob([big])
      const cases = [
        ['B14 /diag 超限（16KB 上限）', '/diag', big, undefined],
        ['B15 /baseline 超限（1MB 上限）', '/baseline', big + big + big + big + big + big, undefined],
        ['B16 /report 超限（4MB 上限）', '/report', big.repeat(22), undefined],
        ['B17 /shot 超限（4MB 上限，参照实现）', '/shot?id=lim-shot&tag=oversize', big.repeat(22), 'image/jpeg'],
      ]
      for (const [name, p, body, ct] of cases) {
        const before = listing(srvL.dir).length
        let status = 0, err = '', json = null
        try {
          const r = await fetch(srvL.base + p, { method: 'POST', headers: ct ? { 'content-type': ct } : {}, body })
          status = r.status
          const t = await r.text()
          try { json = JSON.parse(t) } catch { json = null }
        } catch (e) { err = String(e && e.message || e) }
        const after = listing(srvL.dir).length
        check(name + ' ⇒ **413 + JSON 说明**（不是 ECONNRESET / status 100）',
          status === 413 && !!json && json.ok === false && /上限/.test(String(json.error)) && !err,
          'status=' + status + ' err=' + err + ' body=' + JSON.stringify(json) )
        check(name + ' 的载荷**一个字节都没落盘**（条目数不变）', before === after, before + ' → ' + after)
      }
      // 服务没被这一串超限请求打崩，而且正常档仍然工作
      const okSmall = await post(srvL.base, '/report', JSON.stringify({ after: 'oversize-batch' }))
      check('B18 连打 4 个超限请求后服务仍活着：正常档 /report 仍 200（超限不该把进程带走）',
        okSmall === 200 && filesOf(srvL.dir, /^r\d+\.json$/).length === 1, 'small=' + okSmall + ' files=' + filesOf(srvL.dir, /^r\d+\.json$/).length)
    } finally { srvL.stop() }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('[C] 渲染器 localStorage 上限（键数量 + 单值 + 总量，超限按 LRU 淘汰并记日志）')
{
  const src = sliceMarks(HTML, 'const MPW_LS_LIMITS = {', "mpwLsPrune('启动')")
  const mkFake = () => {
    const m = new Map()
    return {
      get length() { return m.size },
      key: (i) => Array.from(m.keys())[i] ?? null,
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => { m.set(String(k), String(v)) },
      removeItem: (k) => { m.delete(String(k)) },
      _map: m,
    }
  }
  const logs = []
  let api = null
  try {
    api = new Function('localStorage', 'logf', src + '\nreturn { MPW_LS_LIMITS, mpwLsSet, mpwLsPrune }')(
      mkFake(), (s) => logs.push(String(s)))
  } catch (e) { /* 切片缺失 → 下面每条都会红 */ }
  check('C1 demo.html 切到 localStorage 上限块（长度 ' + src.length + '，含三档上限常量）',
    !!api && /maxKeys/.test(src) && /maxValueBytes/.test(src) && /maxTotalBytes/.test(src))
  if (api) {
    const LS = api.MPW_LS_LIMITS
    const store = mkFake()
    const f = new Function('localStorage', 'logf', src + '\nreturn { mpwLsSet, mpwLsPrune }')(store, (s) => logs.push(String(s)))
    logs.length = 0
    for (let i = 0; i < LS.maxKeys + 8; i++) f.mpwLsSet('mpw-props:' + i, JSON.stringify({ v: 'p'.repeat(200) }))
    const keys = Array.from(store._map.keys()).filter((k) => k.indexOf('mpw-props:') === 0)
    const total = keys.reduce((s, k) => s + store.getItem(k).length, 0)
    check('C2 灌 ' + (LS.maxKeys + 8) + ' 个键（上限 ' + LS.maxKeys + '）→ 键数回到限内、总量 ≤ ' + Math.round(LS.maxTotalBytes / 1024) + 'KB、**最新的键还在**',
      keys.length <= LS.maxKeys && total <= LS.maxTotalBytes && store.getItem('mpw-props:' + (LS.maxKeys + 7)) !== null,
      'keys=' + keys.length + ' total=' + total)
    check('C3 最旧的键被淘汰（LRU：`mpw-props:0` 已不在，`mpw-props:' + (LS.maxKeys + 7) + '` 在）',
      store.getItem('mpw-props:0') === null && store.getItem('mpw-props:1') === null)
    check('C4 **清理动作有日志**（"已删除 N 个最旧键，释放 X KB" + 上限值）',
      logs.some((l) => /localStorage 上限清理/.test(l) && /已删除 \d+ 个最旧键，释放 [\d.]+ KB/.test(l) && /上限 \d+ 键/.test(l)),
      '样例=' + JSON.stringify((logs.find((l) => /上限清理/.test(l)) || '').slice(0, 120)))
    check('C5 只动自己的键：非 `mpw-props:` 前缀的键（宿主/壁纸的）一个都不删',
      (() => {
        const s2 = mkFake()
        const g = new Function('localStorage', 'logf', src + '\nreturn { mpwLsSet, mpwLsPrune }')(s2, () => {})
        s2.setItem('someone-else-key', 'KEEP')
        s2.setItem('dsh.some.host.key', 'KEEP2')
        for (let i = 0; i < LS.maxKeys + 5; i++) g.mpwLsSet('mpw-props:x' + i, 'v' + i)
        return s2.getItem('someone-else-key') === 'KEEP' && s2.getItem('dsh.some.host.key') === 'KEEP2'
      })())
    check('C6 **单值超限 → 拒写 + 记日志**（不静默截断、不静默丢弃）',
      (() => {
        const s3 = mkFake()
        const lg = []
        const g = new Function('localStorage', 'logf', src + '\nreturn { mpwLsSet }')(s3, (s) => lg.push(String(s)))
        const okBig = g.mpwLsSet('mpw-props:big', 'z'.repeat(LS.maxValueBytes + 1))
        const okSmall = g.mpwLsSet('mpw-props:small', 'z'.repeat(100))
        return okBig === false && s3.getItem('mpw-props:big') === null && okSmall === true
          && lg.some((l) => /拒绝写入/.test(l) && /单值/.test(l) && /上限/.test(l))
      })())
    check('C7 属性面板的写入口真的走了这套上限（`writePropsStore` 不再直接 `localStorage.setItem`）',
      /mpwLsSet\(propsKey, JSON\.stringify\(o\)\)/.test(HTML)
      && !/if \(o && Object\.keys\(o\)\.length\) localStorage\.setItem\(propsKey/.test(HTML))
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('[D] 插件 diag-*.json 上限（数量 + 字节 + 启动清理 + 客户端自动上报默认关）')
{
  const src = sliceMarks(PLUGIN_INDEX, '// ═══ MPW-DIAG-LIMIT-BEGIN ═══', '// ═══ MPW-DIAG-LIMIT-END ═══')
  const build = (dir, keep, maxBytes) => {
    const env = { ...process.env, DSH_WE_DIAG_DIR: dir, DSH_WE_DIAG_KEEP: String(keep), DSH_WE_DIAG_MAX_BYTES: String(maxBytes) }
    return new Function('join', 'readdirSync', 'statSync', 'unlinkSync', 'os', 'process', 'console',
      src + '\nreturn { pruneDiagDir, DIAG_KEEP, DIAG_MAX_BYTES, DIAG_DIR }')(
      path.join, fs.readdirSync, fs.statSync, fs.unlinkSync, os, { env }, { log: (...a) => logs.push(a.join(' ')), warn: () => {} })
  }
  const logs = []
  check('D1 插件 lib/index.js 切到 diag 上限块（长度 ' + src.length + '，含数量/字节两个常量 + prune 函数）',
    src.length > 500 && /const DIAG_KEEP = numEnvLimit\('DSH_WE_DIAG_KEEP'/.test(src) && /function pruneDiagDir/.test(src))

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-diaglim-'))
  const base = 1789000000000
  for (let i = 0; i < 12; i++) fs.writeFileSync(path.join(dir, 'diag-' + (base + i) + '.json'), '{"i":' + i + ',"pad":"' + 'p'.repeat(100) + '"}')
  fs.writeFileSync(path.join(dir, 'custom-dir.json'), '{"dir":"/x"}')
  fs.mkdirSync(path.join(dir, 'ffmpeg'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'diag-notanumber.json'), '{"x":1}')   // 不合模式 → 不许被删
  const api = build(dir, 5, 32 * 1024 * 1024)
  const r = api.pruneDiagDir('测试')
  const left = filesOf(dir, /^diag-\d+\.json$/).sort()
  const nums = left.map((n) => Number(/^diag-(\d+)\.json$/.exec(n)[1]))
  check('D2 灌 12 份（数量上限 5）→ 只剩 5 份，且留下的是**最新**的 5 个（最旧的被删）',
    left.length === 5 && Math.min(...nums) === base + 7 && !fs.existsSync(path.join(dir, 'diag-' + base + '.json')),
    'n=' + left.length + ' min=' + Math.min(...nums) + ' removed=' + r.removed)
  check('D3 **清理动作有日志**（"已删除 N 个最旧文件，释放 X MB"）',
    logs.some((l) => /\[dsh-mpkg-wallpaper\]\[prune\] diag\//.test(l) && /已删除 \d+ 个最旧文件，释放 [\d.]+ MB/.test(l)),
    '样例=' + JSON.stringify((logs[0] || '').slice(0, 120)))
  check('D4 同目录的 `custom-dir.json` / `ffmpeg/` / 不合模式的 `diag-notanumber.json` **一个都没动**',
    fs.existsSync(path.join(dir, 'custom-dir.json')) && fs.existsSync(path.join(dir, 'ffmpeg'))
    && fs.existsSync(path.join(dir, 'diag-notanumber.json')))

  // 字节上限（数量没超、字节超了 → 也收回来）
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-diaglim2-'))
  for (let i = 0; i < 8; i++) fs.writeFileSync(path.join(dir2, 'diag-' + (base + i) + '.json'), 'q'.repeat(2000))
  const api2 = build(dir2, 50, 6000)
  const r2 = api2.pruneDiagDir('字节')
  const left2 = filesOf(dir2, /^diag-\d+\.json$/)
  check('D5 **字节上限**：8 份 ×2KB（数量上限 50、字节上限 6000）→ 字节回到限内、剩 ≤3 份',
    bytesOf(dir2, left2) <= 6000 && left2.length <= 3 && r2.removed >= 5,
    'n=' + left2.length + ' bytes=' + bytesOf(dir2, left2) + ' removed=' + r2.removed)

  check('D6 上限已接线：`apply()` 启动时清理一次 + `/diag` 写入前/后各检查一次',
    /try \{ pruneDiagDir\('启动'\); \}/.test(PLUGIN_INDEX)
    && countOf(PLUGIN_INDEX, 'pruneDiagDir(') >= 4
    && /const dir = DIAG_DIR;/.test(PLUGIN_INDEX)
    && !/const dir = join\(os\.homedir\(\), '\.dsh', '\.dsh-mpkg-wallpaper'\);/.test(PLUGIN_INDEX))

  // D7 客户端：自动上报默认关（mpwTrace 无条件发 + mpwdiag 默认开 —— 两条都改掉了）
  check('D7 插件客户端 **自动 trace 上报默认关**：`mpwTrace` 里先判 `localStorage[\'mpwdiag\'] !== \'1\'` 就 return（旧实现无条件 fetch）',
    /function mpwTrace\(ev, data\) \{[\s\S]{0,900}?localStorage\.getItem\('mpwdiag'\) !== '1'\) return;/.test(PLUGIN_CLIENT)
    && /\[dsh-mpkg-wallpaper\]\[prune\]/.test(PLUGIN_INDEX) === false || /mpwTrace/.test(PLUGIN_CLIENT))
  check('D8 插件客户端 **DOM 诊断自动上报默认关**：`mpwdiag === \'1\'` 才开（旧实现 `!== \'0\'` 默认开）',
    /localStorage\.getItem\('mpwdiag'\) === '1'\) \{/.test(PLUGIN_CLIENT)
    && !/localStorage\.getItem\('mpwdiag'\) !== '0'\) \{/.test(PLUGIN_CLIENT))
  // ①(P-111 2026-09-17 修回归) D9 旧断言写死了**旧写入形态**：`countOf('mpwLsSafeSet(STORE_KEY, JSON.stringify(') === 2`
  //   ——**已过时**。持久化轮把落盘收敛成**唯一入口** `mpwPersistSection(sec)`（先 `JSON.stringify` 一次再写，
  //   所以受控调用是 `mpwLsSafeSet(STORE_KEY, <变量>)`，共 6 处：整串/抽掉 image/哨兵/整串落 IDB + 两处失败留痕），
  //   并新增"抽 image 落 IndexedDB + **回读校验** + 失败显式告警"。旧断言的两条数法随之全错（2→6、0→2）。
  //   **新口径断言按同一件事判，且更严**：阈值仍集中且值不变（各只定义一次 = 262144 / 2097152）、
  //   超限仍拒写并打警告、**0 处**裸 `localStorage.setItem(STORE_KEY…)`（每一处写入都走受控入口 ——
  //   两处失败留痕以前是裸写，已在本轮改回受控入口）、大图必须回读校验且失败显式留痕/告警（不静默）。
  const defsMax = PLUGIN_CLIENT.match(/const\s+MPW_LS_MAX_BYTES\s*=/g) || []
  const defsSpill = PLUGIN_CLIENT.match(/const\s+MPW_LS_SPILL_BYTES\s*=/g) || []
  const thresholdVal = (name) => {
    const m = new RegExp('const\\s+' + name + '\\s*=\\s*([^;]+);').exec(PLUGIN_CLIENT)
    if (!m) return NaN
    try { return new Function('return (' + m[1] + ')')() } catch { return NaN }
  }
  check('D9 插件客户端 localStorage **单值上限**：阈值仍集中（各只定义一次）+ 值仍 256KB / 大图线 2MB + 超限拒写打警告',
    defsMax.length === 1 && defsSpill.length === 1
    && thresholdVal('MPW_LS_MAX_BYTES') === 256 * 1024 && thresholdVal('MPW_LS_SPILL_BYTES') === 2 * 1024 * 1024
    && /if \(s\.length > MPW_LS_MAX_BYTES\) \{[\s\S]{0,400}?拒绝写入[\s\S]{0,200}?return false;/.test(PLUGIN_CLIENT),
    'defs=' + defsMax.length + '/' + defsSpill.length + ' max=' + thresholdVal('MPW_LS_MAX_BYTES') + ' spill=' + thresholdVal('MPW_LS_SPILL_BYTES'))
  check('D9b **0 处**裸 `localStorage.setItem(STORE_KEY…)`：每一处 STORE_KEY 写入都走受控入口 `mpwLsSafeSet`',
    countOf(PLUGIN_CLIENT, 'localStorage.setItem(STORE_KEY') === 0
    && countOf(PLUGIN_CLIENT, 'mpwLsSafeSet(STORE_KEY') >= 6,
    'raw=' + countOf(PLUGIN_CLIENT, 'localStorage.setItem(STORE_KEY') + ' guarded=' + countOf(PLUGIN_CLIENT, 'mpwLsSafeSet(STORE_KEY'))
  check('D9c 大图落 IndexedDB：抽 image（`idb:img` 哨兵）+ **写完回读校验** + 失败显式留痕/告警（不静默丢选择）+ 回退开关仍在',
    /function mpwSpillImage\(dataUrl\) \{/.test(PLUGIN_CLIENT)
    && /function mpwIdbBgKind\(\) \{/.test(PLUGIN_CLIENT)
    && /回读校验失败\(/.test(PLUGIN_CLIENT)
    && /"idb:img"/.test(PLUGIN_CLIENT)
    && /MPW_PERSIST_FAIL_KEY/.test(PLUGIN_CLIENT)
    && /function mpwPersistOnMsg\(fn\) \{/.test(PLUGIN_CLIENT)   // 面板可见告警通道（失败不只写 console）
    && /mpwpersist=legacy/.test(PLUGIN_CLIENT))
}

console.log('\n===== data-limits-test: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
process.exit(fail ? 1 : 0)
