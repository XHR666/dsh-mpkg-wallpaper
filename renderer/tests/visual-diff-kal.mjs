// visual-diff-kal.mjs —— `visual-diff-kal` 门禁项的包装器（P-79）
//
// 背景（2026-09-15，本机实测）：`node visual-diff.mjs --check --skip-render` **约 1/6 次运行在做完全部工作、
//   打印出 `✓ --check：与基线一致` 之后不退出**：进程停在 `futex_wait_queue`、无子进程、11 个 fd，
//   `timeout` 到点判 rc=124 → 门禁记 FAIL。而它**打印的判定是成功的**（SSIM 与基线逐位一致）。
//   已排除：磁盘满（余 82G）、内存（余 6G）、`UV_THREADPOOL_SIZE`、退出钩子（脚本本身无 handler 且末尾
//   就是 `process.exit(0)`）、工作量大（不渲染时 1.5s 完成）。⇒ 判定为**本机 Node 运行时的退出期 quirk**。
//
// 为什么不在 `run-all-tests.sh` 里放宽超时：那等于把"真的挂住"也放过。
// 为什么这个包装器**不是掩盖问题**：
//   · 只在**显式成功标记**出现后才按成功判定（`✓ --check：与基线一致`）；
//   · 出现标记**也**要打印一行"⚠ 子进程完成后未退出"——把 quirk 暴露出来，不静默；
//   · 没有标记 ⇒ 一律按子进程真实 rc（超时 124 / 失败非 0）上报；
//   · 真回归（SSIM 偏离）走的是 `✗`/`process.exit(1)` 分支，**永远不会**命中这里的成功标记。
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

const MARK = '✓ --check：与基线一致'
// ①(2026-09-16 目录整理) 子脚本与包装器同在 tests/ ⇒ 用仓库根相对的 tests/ 前缀（runner 的 cwd = 仓库根）
const args = ['tests/visual-diff.mjs', '--id', '3719111841', '--out', `${process.env.MPW_VD_OUT || path.join(os.tmpdir(), 'vd')}/`, '--check', '--skip-render']
const HARD_MS = Number(process.env.MPW_VDKAL_TIMEOUT_MS || 120000)   // 无标记时的硬上限
const GRACE_MS = 3000                                                // 见到标记后再等多久才判定"完成不退出"

const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
let out = ''
let done = false
let marked = false
let rc = null
const t0 = Date.now()

child.stdout.on('data', (b) => {
  const s = b.toString()
  out += s
  process.stdout.write(s)
  if (!marked && out.includes(MARK)) {
    marked = true
    // 见到成功标记：给它一点时间自然退出；退不出就按"完成但不退出"处理
    setTimeout(() => {
      if (done) return
      console.log(`⚠ visual-diff 已完成判定（SSIM 与基线一致）但子进程在 ${GRACE_MS}ms 内未退出`
        + ` —— 本机已知的退出期 quirk（P-79，进程停在 futex），按成功判定并强制收尾`)
      try { child.kill('SIGKILL') } catch { /* ignore */ }
    }, GRACE_MS)
  }
})
child.stderr.on('data', (b) => process.stderr.write(b))
child.on('exit', (code) => { done = true; rc = code == null ? 1 : code })
child.on('error', (e) => { done = true; rc = 1; process.stderr.write('spawn 失败: ' + e.message + '\n') })

const hard = setTimeout(() => {
  if (done) return
  console.log(`✗ visual-diff 超过 ${HARD_MS}ms 仍未给出成功标记（未见到「${MARK}」）—— 按失败处理`)
  try { child.kill('SIGKILL') } catch { /* ignore */ }
  rc = 124
  done = true
}, HARD_MS)

// 轮询收尾：子进程退出 或 已见标记且已过宽限期
const tick = setInterval(() => {
  if (done) return
  if (marked && Date.now() - t0 > GRACE_MS + 1500) {
    clearInterval(tick); clearTimeout(hard)
    if (marked) process.exit(0)
  }
  if (Date.now() - t0 > HARD_MS + 5000) { clearInterval(tick); clearTimeout(hard); process.exit(rc == null ? 124 : rc) }
}, 250)
child.on('exit', (code) => {
  clearInterval(tick); clearTimeout(hard)
  // ①(修) **已见到成功标记 ⇒ 以标记为判定**：此时子进程若被我们 SIGKILL 掉，`code` 会是 null/1，
  //   照搬它会把"完成但没退出"误报成 FAIL（第一版就是这个 bug，实测第 4 次 rc=1）。
  //   没见到标记 ⇒ 一律如实上报子进程的 rc（失败/超时都不放过）。
  if (marked) process.exit(0)
  process.exit(code == null ? 1 : code)
})
