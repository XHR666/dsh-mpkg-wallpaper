// bench-issue0924a-ia-browser-test.mjs —— issue #0924a / #0924a2 A 线判据的**浏览器窄入口**（只跑 IA 组）
//
// 为什么单独一个入口：判据集本身在 `tests/bench-ia-group.mjs`（与 `bench-ui-headless-test.mjs` 共用同一份实现），
// 但整页门禁是一条**很长的链**（N/R/S/F/T/W/M/X/Y/G/Z/P/G10 各组），任何一环被**别的线**正在改的面
// （例如渲染器 `__wp` 少了产物要调的方法 ⇒ 未捕获异常 ⇒ 全局错误条 `#bench-errorbar` 盖住页面 ⇒ Playwright
// 点击重试 30s 后超时）挡在半路，本线的读数就一条都拿不到。这个入口把"本线 12 条"的浏览器读数**单独**跑出来：
//   · 只做"开页 → 跑 IA 组"这两步（IA 组自己会**受控地**动它需要的开关：换渲染器档后切回、选完壁纸后叉空），
//     其余交互面（舞台/音条源/属性保存…）一律不碰，避免踩到与本线无关的东西；
//   · IA 组 2026-09-25 扩到 **38 条**（原 23 条）：新增 IA5c–IA5f（用户第 16 条复测：**产物那条**无条件
//     `scrollTop=scrollHeight` 也要挡住 + 守卫 A/B）、IA10（用户第 3 条：音量控件在卡片内部）、
//     IA11（用户第 7 条：未选择壁纸时换档不许凭空挂壁纸）；
//   · 输出与整页门禁**同款**的 `PASS/FAIL` 行，便于对账。
//
// 用法（必须包文件锁，全机同时只允许一个 Firefox）：
//   flock /tmp/.mpw-firefox.lock -c 'node tests/bench-issue0924a-ia-browser-test.mjs'
// 参数：--url=<测试台地址，默认 http://127.0.0.1:8902/>
import { AUDIO_MUTE_PREFS } from './_audio-mute.mjs'
import { pathToFileURL } from 'node:url'
import { findPlaywright } from './_gl-browser.mjs'

const argv = process.argv.slice(2)
const argOf = (n, d) => { const i = argv.indexOf(n); if (i >= 0 && argv[i + 1]) return argv[i + 1]; const eq = argv.find((a) => a.startsWith(n + '=')); return eq ? eq.slice(n.length + 1) : d }
const URL_BASE = argOf('--url', process.env.MPW_BENCH_URL || 'http://127.0.0.1:8902/')
const VIEW = { w: Number(argOf('--w', 1360)), h: Number(argOf('--h', 900)) }

let pass = 0
let fail = 0
const ok = (c, label, extra = '') => { if (c) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }
const skip = (why) => { console.log('SKIP bench-issue0924a-ia — ' + why); process.exit(0) }

const pwPath = findPlaywright()
if (!pwPath) skip('找不到 playwright（本机未装）')
const pw = await import(pathToFileURL(pwPath).href)
const firefox = (pw.default && pw.default.firefox) || pw.firefox
if (!firefox) skip('playwright 没有 firefox 导出')

let up = false
try { const r = await fetch(URL_BASE, { signal: AbortSignal.timeout(5000) }); up = r.ok } catch { up = false }
if (!up) skip(`测试台不可达：${URL_BASE}（起服务：node server/we-scene-demo-server-8902.mjs 8902）`)

const browser = await firefox.launch({ firefoxUserPrefs: { ...AUDIO_MUTE_PREFS }, headless: true, env: { ...process.env, MOZ_WEBGL_FORCE_SOFTWARE: '1', LIBGL_ALWAYS_SOFTWARE: '1' } })
try {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log('  note: pageerror ' + String((e && e.message) || e).slice(0, 140)))
  await page.setViewportSize({ width: VIEW.w, height: VIEW.h })
  await page.goto(URL_BASE, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForFunction(() => !!(window.__benchPatch && window.__benchShell), null, { timeout: 45000 })
  await page.waitForFunction(() => document.querySelectorAll('#list li[data-id]').length > 0, null, { timeout: 30000 }).catch(() => {})
  const { runIaGroup } = await import('./bench-ia-group.mjs')
  await runIaGroup({ page, ok, VIEW })

  /* ══════════════════ IA9 第 5 条：换库之后侧栏**立刻重画**（端到端，用临时夹具服务）══════════════
     为什么必须来这一趟：第 5 条的症状（"列表还留着上一次选择的内容、缩略图加载不出来"）只在**真的换库**
     那一刻出现；而门禁不许点常驻 `:8902` 的「就选这个目录」（那会改用户的库目录 —— `bench-ui-headless`
     的 F3e 注释里写死了这条纪律）。所以这里**另起一份临时夹具服务**（临时目录里的两个库，谁也不碰），
     在它上面把「开对话框 → 进子目录 → 就选这个目录」整条链跑完，读 `libRefreshProbe()`。 */
  {
    const os = await import('node:os')
    const fsp = await import('node:fs')
    const path2 = await import('node:path')
    const http2 = await import('node:http')
    const { spawn } = await import('node:child_process')
    const ROOT = path2.resolve(import.meta.dirname, '..')
    const fx = fsp.mkdtempSync(path2.join(os.tmpdir(), 'bench-0924a-ia-'))
    const libA = path2.join(fx, 'libA'), libB = path2.join(fx, 'libB')
    const sample = path2.join(ROOT, 'samples', 'sample-synthetic', 'scene.pkg')
    const mk = (lib, id, title) => {
      const dir = path2.join(lib, id)
      fsp.mkdirSync(dir, { recursive: true })
      if (fsp.existsSync(sample)) fsp.copyFileSync(sample, path2.join(dir, 'scene.pkg'))
      fsp.writeFileSync(path2.join(dir, 'project.json'), JSON.stringify({ title }, null, 1))
    }
    mk(libA, 'iaA1', 'IA-A 库的壁纸')
    mk(libB, 'iaB1', 'IA-B 库的壁纸')
    mk(libB, 'iaB2', 'IA-B 库的第二张')
    fsp.mkdirSync(path2.join(fx, 'reports'), { recursive: true })
    const port = await new Promise((resolve) => { const s2 = http2.createServer(); s2.listen(0, '127.0.0.1', () => { const p2 = s2.address().port; s2.close(() => resolve(p2)) }) })
    const child = spawn(process.execPath, [path2.join(ROOT, 'server', 'we-scene-demo-server-8902.mjs'), String(port)], {
      cwd: ROOT,
      env: Object.assign({}, process.env, {
        MPW_ROOT: fx, MPW_LIBRARY_DIR: libA, MPW_PICK_ROOT: fx,
        MPW_BENCH_STATIC_DIR: path2.join(ROOT, 'demo'), MPW_REPORTS_DIR: path2.join(fx, 'reports'),
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    try {
      const health = async () => { try { const r = await fetch(`http://127.0.0.1:${port}/__health`, { signal: AbortSignal.timeout(3000) }); return r.ok } catch { return false } }
      const t0 = Date.now()
      while (!(await health())) { if (Date.now() - t0 > 25000) throw new Error('夹具服务 25s 没起来'); await new Promise((r) => setTimeout(r, 150)) }
      const page2 = await browser.newPage()
      await page2.setViewportSize({ width: VIEW.w, height: VIEW.h })
      await page2.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await page2.waitForFunction(() => !!(window.__benchPatch && window.__benchShell), null, { timeout: 45000 })
      await page2.waitForFunction(() => document.querySelectorAll('#list li[data-id]').length > 0, null, { timeout: 30000 }).catch(() => {})
      const r = await page2.evaluate(async () => {
        const wait = (n) => new Promise((res) => setTimeout(res, n))
        const api = window.__benchPatch
        const before = { rows: document.querySelectorAll('#list li[data-id]').length, ids: [...document.querySelectorAll('#list li[data-id]')].map((li) => li.dataset.id), dir: api.fsState().path }
        const btn = document.getElementById('pick-lib')
        if (btn) { for (let i = 0; i < 40 && btn.disabled; i++) await wait(200); if (btn.disabled) btn.disabled = false; await wait(2600); btn.click() }
        for (let i = 0; i < 30; i++) { await wait(200); if (document.getElementById('bench-fs-dialog')) break }
        //  进 B 库：直接点快捷根里的"库根的上一级"再进 libB（用行点击走同一条浏览链）
        const pathNow = () => { try { const el = document.querySelector('#bench-fs-dialog .bench-dirbox-path'); return el ? String(el.dataset.path || el.textContent || '') : '' } catch { return '' } }
        const nav = async (name) => {
          for (let i = 0; i < 25; i++) {
            const row = [...document.querySelectorAll('#bench-fs-list .bench-dirbox-row')].find((x) => String(x.textContent || '').includes(name))
            if (row) { row.click(); await wait(700); return true }
            await wait(200)
          }
          return false
        }
        const chips = [...document.querySelectorAll('.bench-dirbox-roots button')]
        const up = chips.find((b) => /上一级|Up one level/.test(b.textContent || ''))
        if (up && !up.disabled) { up.click(); await wait(900) }      // 从 libA 退到夹具根（libA 与 libB 都在它下面）
        const gotB = await nav('libB')
        const atB = /libB$/.test(pathNow())
        const confirm = document.getElementById('bench-fs-confirm')
        const confirmDisabled = confirm ? confirm.disabled : null
        if (confirm && !confirm.disabled) confirm.click()
        let probe = null
        for (let i = 0; i < 60; i++) { await wait(250); probe = api.libRefreshProbe(); if (probe && probe.ran) break }
        await wait(1500)
        const logLines = [...document.querySelectorAll('#logbody > *')].map((x) => String(x.textContent || ''))
        return {
          before, gotB, atB, dialogPath: pathNow(), confirmDisabled, probe: api.libRefreshProbe(),
          rows: document.querySelectorAll('#list li[data-id]').length,
          ids: [...document.querySelectorAll('#list li[data-id]')].map((li) => li.dataset.id),
          dir: (() => { try { return api.fsState().path } catch { return '' } })(),
          refreshLog: logLines.filter((l) => /重画侧栏|Sidebar re-rendered/.test(l)).slice(-1)[0] || '',
        }
      })
      console.log('  IA9 读数 =' + JSON.stringify(r))
      ok(r.before.ids.includes('iaA1') && r.gotB === true && r.atB === true && r.rows === 2 && r.ids.includes('iaB1') && r.ids.includes('iaB2'),
        'IA9a ★第 5 条：换库成功后侧栏**立刻换成新库的行**（改前：还是旧库的 `<li>`，旧 itemId 的缩略图 404）',
        JSON.stringify({ before: r.before, dialogPath: r.dialogPath, atB: r.atB, after: { rows: r.rows, ids: r.ids } }))
      /* ⚠`fsState().path` 是**对话框**的路径：成功提交后对话框已关闭 ⇒ 那里是空串（实测踩过）。
         所以这里比的是"新库根"本身（夹具目录以 /libB 结尾）+ 行数 + 走没走那条链。 */
      ok(!!r.probe && r.probe.ran === true && /\/libB$/.test(String(r.probe.rootDir || '')) && r.probe.rows === 2,
        'IA9b ★`libRefreshProbe()` 自述：走了产物那条重载链（`ran=true`）、签名/行数都落到新库',
        JSON.stringify(r.probe))
      ok(/重画侧栏|Sidebar re-rendered/.test(r.refreshLog),
        'IA9c 输出区留下可读的一行（"换库后重画侧栏：N 项"），不是静默刷新', r.refreshLog.slice(0, 90))
      await page2.close()
    } catch (e) {
      ok(false, 'IA9 换库即刷新（端到端夹具）', String((e && e.message) || e).slice(0, 200))
    } finally {
      try { child.kill('SIGKILL') } catch { /* 已退 */ }
      try { fsp.rmSync(fx, { recursive: true, force: true }) } catch { /* 清理失败不致命 */ }
    }
  }

  console.log(`\n── 汇总：PASS=${pass} FAIL=${fail}`)
  process.exitCode = fail > 0 ? 1 : 0
} finally {
  try { await browser.close() } catch { /* ignore */ }
}
