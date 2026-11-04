// bench-8901-sync-test.mjs —— `:8901` 部署树漂移检测（`tools/bench-8901-sync.mjs`）的**门禁化判据**
//
// 由来（台账 §1.2 第 39 项）：那一条的状态是「软链 ⇒ 零同步，但**仍需定期跑 `--check` 防漂移**」——
// 也就是**有一个工具、没有定期执行者**。本判据就是那个执行者：把它挂进门禁（`tests/run-all-tests.sh`），
// "定期"由门禁承担；同时**不许**因为"跑判据的机器没有工作区语料/部署树"而把门禁弄成常红 ✗。
//
// 判据分层（三层，缺一层都不算判据）：
//   S1 **前置 + SKIP**：工具在；部署挂载点不存在 ⇒ 打印原样读数并 **SKIP（exit 0）**；
//      工具自己因 `MemAvailable` 红线拒跑（exit 2）⇒ 同样 SKIP（那是环境，不是漂移）；
//   S2 **真树实测**：跑 `--check --json`，断言 exit 0 且 `drifted=false`（形态 + 漂移两栏都打读数）；
//   S3 **分辨力自证**（关键）：在 `/tmp` 造小夹具（`separate-copy` 形态 = 两份独立字节）——
//      ① 改部署侧一个字节 ⇒ **必须 exit 1** 且 `differ` 里正是那个文件；
//      ② 部署侧独有文件 ⇒ **必须 exit 0**（工具口径"仅部署不算漂移、不删"，这条也要被钉住，
//         否则以后有人把 `onlyDeploy` 也算成漂移，判据不会红 ✗）；
//      ③ 不带 `--check` 跑一次（同步）⇒ 再 `--check` ⇒ **exit 0 且 differ 空**（RED → GREEN 闭环）；
//      ④ 挂载点名指向不存在 ⇒ **必须 exit 2**（证明 S1 的 SKIP 分支不是"恒绿"的假分支）。
//
// 为什么 ①②③④ 都要：单看 ①（会红）无法区分"判据真的在看内容"与"工具恒红"；单看 ②③ 无法区分
// "判据真的在跑"与"工具恒绿"。这四条一起才构成"能抓住旧错"的自证（口径同 TESTING.md 的变异自证）。
//
// 内存纪律：夹具一律 <1KB 级；真树那条在本机是 `symlink-same-tree` 形态 ⇒ **工具一个字节都不哈希**；
// 夹具那条只哈希两三个小文件。全程不读语料。
//
// 退出码：0 = 全绿（含 SKIP）/ 1 = 有失败。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { ROOT, WS } from './_root.mjs'

const rows = []
/* 口径：`ok(说明, 布尔, 读数)` —— 三参。⚠ 这里**没有**单独的短 id 参（本文件行数少、说明本身可读）；
   ⚠ 但**布尔必须是第二个实参**：把读数串写在第二个位置会让 `!!cond` 恒真 ⇒ 整份判据变成"假绿"。
   本轮自证：首版把 `ok(说明, 读数)` 当两参用 ⇒ 12 条全"通过"而实际一条没判（S3b/S3c 的真实布尔是 false）。
   现在 `pass` 只取第二个实参，且每次调用都传布尔表达式。 */
const ok = (why, cond, detail) => rows.push({ id: String(why).split(' ')[0], why, pass: cond === true, detail: String(detail == null ? '' : detail) })
const section = (s) => console.log('\n═══ ' + s + ' ═══')

const TOOL = path.join(ROOT, 'tools', 'bench-8901-sync.mjs')
const DEPLOY_ROOT = process.env.BENCH_8901_ROOT || path.join(WS, 'references/vendor-ref/ww-pages')
const MOUNT = process.env.BENCH_8901_MOUNT || 'WEwebLoader'
const DEPLOY_PATH = path.join(DEPLOY_ROOT, MOUNT)

/** 跑工具（**同一份实现**，不改它、不复制它）。返回 { code, json, out }。 */
function runTool(env, args) {
  const r = spawnSync(process.execPath, [TOOL, ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: 120000,
    env: Object.assign({}, process.env, env || {}),
  })
  let json = null
  const i = String(r.stdout || '').indexOf('{')
  if (i >= 0) { try { json = JSON.parse(String(r.stdout).slice(i)) } catch { /* 非 JSON 输出（正常档） */ } }
  return { code: r.status, json, out: String(r.stdout || '') + String(r.stderr || '') }
}
const memAvailableMB = () => {
  try { const m = /MemAvailable:\s+(\d+) kB/.exec(fs.readFileSync('/proc/meminfo', 'utf8')); return m ? Math.round(Number(m[1]) / 1024) : null } catch { return null }
}

section('S1/S2 真树：部署挂载点形态 + `--check` 漂移读数')
ok('S1a 工具在位（`tools/bench-8901-sync.mjs`）', fs.existsSync(TOOL), TOOL)
const avail = memAvailableMB()
console.log(`  MemAvailable=${avail == null ? '(读不到)' : avail + 'MB'} · 挂载点=${DEPLOY_PATH}`)

let skipped = false
if (!fs.existsSync(TOOL)) {
  ok('S1b 工具缺失 ⇒ 前置失败', false, '见上')
} else if (!fs.existsSync(DEPLOY_PATH)) {
  /* ① 工作区没挂部署树（干净克隆 / CI / 别的机器）⇒ 这是**环境缺数据**，不是产品坏 ⇒ 如实 SKIP，
     绝不谎报成通过，也绝不把它弄成常红。读数照打，谁都能看出"这条今天没测到"。 */
  skipped = true
  console.log(`  SKIP S2 —— 部署挂载点不存在：${DEPLOY_PATH}（缺工作区部署树，不是判据通过）`)
} else {
  /* ② 内存红线：工具开跑前读 `MemAvailable`，< 3000MB 直接 exit 2（**用户内存纪律**：那红线是为
     "逐文件哈希几十 MB 的实体副本树"设的）。本机在红线附近游走 ⇒ 这里分两种处置：
       · 若能**我们自己先证明**"这次跑不可能哈希任何东西"（挂载点是软链且 realpath == 仓库 demo/ ⇒
         工具走 `symlink-same-tree`，一个字节都不读）⇒ 加 `--force` 跑（纪律之内，不是绕开纪律）；
       · 否则 ⇒ **如实 SKIP**（宁可没测到，也不在低内存窗口强跑会哈希的档）。
     ⚠ 必须先自己判形态**再** force：不判就 force = 把用户的内存纪律当摆设 ✗。 */
  const repoDemo = path.join(ROOT, 'demo')
  let sameTree = false
  try {
    sameTree = fs.lstatSync(DEPLOY_PATH).isSymbolicLink()
      && fs.realpathSync(DEPLOY_PATH) === fs.realpathSync(repoDemo)
  } catch { sameTree = false }
  let r = runTool({}, ['--check', '--json'])
  let forced = false
  if (r.code === 2 && /MemAvailable/.test(r.out)) {
    if (sameTree) { forced = true; r = runTool({}, ['--check', '--json', '--force']) }
    else {
      skipped = true
      console.log(`  SKIP S2 —— 工具按内存红线拒跑（MemAvailable=${avail}MB）且本档**可能哈希**（形态≠软链同树）：`
        + `宁可没测到，也不在低内存窗口强跑\n${r.out.trim().split('\n').slice(0, 2).join('\n')}`)
    }
  }
  if (!skipped) {
    const j = r.json || {}
    const form = j.identity && j.identity.form
    const drifted = j.drifted
    const d = j.drift || {}
    ok('S2a `--check` 退出码 0（无漂移）', r.code === 0, `code=${r.code}${forced ? ' · --force（已自证软链同树、零哈希）' : ''}`)
    ok('S2b JSON 说 `drifted=false` 且 仅仓库/内容不同 两栏为空',
      drifted === false && (d.onlyRepo || []).length === 0 && (d.differ || []).length === 0,
      `form=${form} onlyRepo=${(d.onlyRepo || []).length} differ=${(d.differ || []).length} onlyDeploy=${(d.onlyDeploy || []).length}`)
    ok('S2c 形态是三种已知形态之一（软链同树 / 同 inode / 实体副本）',
      ['symlink-same-tree', 'same-inode', 'separate-copy'].indexOf(form) >= 0, String(form))
    console.log(`  S2 读数：form=${form} same=${d.same} sizeOnly=${d.sizeOnly} onlyDeploy=${(d.onlyDeploy || []).length} stats=${JSON.stringify(j.stats)}${forced ? ' · forced=true' : ''}`)
  }
}

section('S3 分辨力自证（/tmp 夹具：RED → GREEN 闭环 + 两条反向钉）')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-8901-sync-test-'))
try {
  const ws = path.join(tmp, 'ws')
  const repoDemo = path.join(tmp, 'repo-demo')
  const mountDir = path.join(ws, 'references/vendor-ref/ww-pages', MOUNT)
  const w = (p, c) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c) }
  /* 夹具 = 两份**独立字节**（`separate-copy` 形态）⇒ 工具真的会逐文件 md5 对账（软链形态下它什么都不做，
     那样就测不到"判据会不会红"）。只放 3 个小文件，总字节 <1KB，符合内存纪律。 */
  w(path.join(repoDemo, 'index.html'), '<!doctype html><title>fixture</title>\n')
  w(path.join(repoDemo, 'sub', 'app.js'), 'console.log("fixture-a")\n')
  w(path.join(repoDemo, 'sub', 'style.css'), 'body{color:#123}\n')
  for (const rel of ['index.html', 'sub/app.js', 'sub/style.css']) {
    fs.mkdirSync(path.dirname(path.join(mountDir, rel)), { recursive: true })
    fs.copyFileSync(path.join(repoDemo, rel), path.join(mountDir, rel))
  }
  const ENV = {
    BENCH_8901_WORKSPACE: ws,
    BENCH_8901_ROOT: path.join(ws, 'references/vendor-ref/ww-pages'),
    BENCH_8901_MOUNT: MOUNT,
    BENCH_8901_REPO: repoDemo,
  }
  // ④ 前置反向：挂载点名不存在 ⇒ 工具必须 exit 2（证明 S1 的 SKIP 分支对应的是真错误路径）
  //    ⚠ 必须**同时断言理由文本**：只断言"exit 2"会把"内存红线拒跑"也算通过（两条都是 2）⇒ 假绿。
  const rMiss = runTool(Object.assign({}, ENV, { BENCH_8901_MOUNT: 'NO_SUCH_MOUNT' }), ['--check', '--json', '--force'])
  ok('S3d 挂载点不存在 ⇒ 工具 exit 2 且理由是"部署挂载点不存在"（不是内存红线；否则算假绿）',
    rMiss.code === 2 && /部署挂载点不存在/.test(rMiss.out), `code=${rMiss.code} 理由=${((rMiss.out.split('\n').find((l) => /部署挂载点不存在/.test(l)) || rMiss.out.trim().split('\n')[0] || '').trim()).slice(0, 90)}`)
  // ① 基线：两份一致 ⇒ 绿
  const r0 = runTool(ENV, ['--check', '--json', '--force'])
  ok('S3a0 夹具基线（两份逐字节一致）⇒ exit 0', r0.code === 0 && !!r0.json && r0.json.drifted === false,
    `code=${r0.code} form=${r0.json && r0.json.identity && r0.json.identity.form}`)
  // ② 只改部署侧**一个字节** ⇒ 必须红，且红的是那个文件
  w(path.join(mountDir, 'sub', 'app.js'), 'console.log("fixture-b")\n')
  const r1 = runTool(ENV, ['--check', '--json', '--force'])
  const diffRels = ((r1.json && r1.json.drift && r1.json.drift.differ) || []).map((x) => x.rel)
  ok('S3a ★部署侧改 1 个字节 ⇒ **exit 1**（判据会红）', r1.code === 1 && !!r1.json && r1.json.drifted === true, `code=${r1.code}`)
  ok('S3a2 红的正是那个文件（`sub/app.js`，内容不同）', diffRels.length === 1 && diffRels[0] === 'sub/app.js', JSON.stringify(diffRels))
  // ③ GREEN 闭环：不带 --check 跑一次（同步）⇒ 再 --check ⇒ 0 漂移
  const r3 = runTool(ENV, ['--json', '--force'])
  const r4 = runTool(ENV, ['--check', '--json', '--force'])
  ok('S3c 同步后复检 ⇒ exit 0 且 `differ` 空（RED → GREEN 闭环，工具真的写回去了）',
    r3.code === 0 && !!r3.json && r3.json.written >= 1 && r4.code === 0 && !!r4.json && (r4.json.drift.differ || []).length === 0,
    `sync code=${r3.code} written=${r3.json && r3.json.written} check code=${r4.code} differ=${JSON.stringify((r4.json && r4.json.drift && r4.json.drift.differ) || [])}`)
  // ④ 反向钉（必须在**干净基线**上做，否则 exit 0 会被 app.js 的真漂移掩盖 ⇒ 判据看起来"绿"其实没测到）：
  //    **仅部署侧多一个文件**不算漂移（工具口径：有意保留、不删）
  w(path.join(mountDir, 'sub', 'deploy-only.probe'), 'probe\n')
  const r2 = runTool(ENV, ['--check', '--json', '--force'])
  ok('S3b **仅部署侧独有文件**不算漂移 ⇒ exit 0（口径"不删部署侧独有"，防以后被改成漂移）',
    r2.code === 0 && !!r2.json && (r2.json.drift.onlyDeploy || []).length === 1 && (r2.json.drift.differ || []).length === 0,
    `code=${r2.code} onlyDeploy=${JSON.stringify((r2.json && r2.json.drift && r2.json.drift.onlyDeploy) || [])} differ=${JSON.stringify((r2.json && r2.json.drift && r2.json.drift.differ) || [])}`)
  // ⑤ 再同步一次：部署侧独有文件**不许被删**
  const r5 = runTool(ENV, ['--json', '--force'])
  ok('S3c2 同步**不删**部署侧独有文件（它还在；同步后仍 exit 0）',
    r5.code === 0 && fs.existsSync(path.join(mountDir, 'sub', 'deploy-only.probe')), `sync code=${r5.code} deploy-only.probe`)
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* 清理失败不致命 */ }
}

const fail = rows.filter((r) => !r.pass)
for (const r of rows) console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.why + (r.detail ? ' — ' + r.detail : ''))  // why 自带 "Sxx " 前缀
if (skipped) console.log('  SKIP S2 —— 真树那条今天没测到（见上；S3 自证照跑）')
console.log(`\n===== bench-8901-sync: ${rows.length - fail.length} 通过 / ${fail.length} 失败${skipped ? '（S2 SKIP，非失败）' : ''} =====`)
try { fs.writeSync(1, 'BENCH-8901-SYNC-JSON ' + JSON.stringify({ pass: rows.length - fail.length, failed: fail.map((f) => f.id), skippedRealTree: skipped }) + '\n') } catch { /* 已关 */ }
process.exit(fail.length ? 1 : 0)
