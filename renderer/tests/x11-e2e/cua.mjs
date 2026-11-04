// cua.mjs —— X11 真机自动化底座（①2026-09-19「结合 X11 + computer-use 自己做简单测试」）
//
// 这个文件解决一件事：**让测试脚本能在真实 X 会话里动手**（移鼠标、点、打字、截图），
// 而不是只靠页面内合成事件（`page.mouse.*`）。两者的差别不是风格：
//   · `page.mouse.*` 走 CDP/Juggler 合成事件，绕过 X 服务器的指针状态；
//   · 我们的一类 bug 恰恰在"X → 浏览器 → 画布 → 设计坐标"这条**真链路**上（y 是否翻转、
//     `pointerleave` 是否到、移远后还在不在），合成事件测不出这条链。
//
// 两条通道，按"能做就做、不能做就如实降级"选择：
//   ① **computer-use-linux**（`https://github.com/agent-sh/computer-use-linux`，Rust MCP server，MIT）：
//      走 MCP stdio（本文件自带一个**最小 MCP 客户端**，不需要任何 MCP host 支持）。
//      用它做 `click` / `drag` / `press_key` / `type_text` / `screenshot` / `list_windows`。
//   ② **xdotool**（X11 原生 XTEST）：用它做**纯移动**（`mousemove`）—— MCP 工具面里没有"只移动不点击"
//      的动作（`drag` 会按下再抬起），而"移进去/移出去/移很远"正是指针类 bug 的主证据。
//      插件自己的 X11 点击路径也是 xdotool（README「Native X11 coordinate clicks」），所以这不是绕开它。
//
// 诚实边界（写给下一个人，也是本仓库的老规矩：不许静默）：
//   · 本机是 **Android/proot Ubuntu + 裸 X11（无窗口管理器、无 GNOME、无 AT-SPI）**。
//     `computer-use-linux` 是为 GNOME/Wayland/KDE 等桌面写的，**窗口类/无障碍类工具在这里多半不可用**。
//     所以 `openCua()` **允许失败**：拿不到就返回 `null`，调用方必须自己判断并降级（不抛异常、不假装成功）。
//   · 截图优先走 `scrot`（X11 原生，本机实测可用），不用插件的截图后端 —— 后者依赖 GNOME/portal。
//     插件截图只在 `--cua-shot` 显式要求时用，用来**证明插件通道本身是通的**。
//   · 所有坐标都是**桌面像素**（X11 root 坐标系，左上 origin）。窗口内坐标由调用方换算。
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 目标 X 显示（本机 `:0`；用 `DISPLAY` 覆盖）。 */
export const DISPLAY = process.env.DISPLAY || ':0'
/** 临时产物目录（截图/mutant 之类）：每次进程一个，避免互相覆盖。 */
export const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-x11-'))

/** 跑一条外部命令（同步，带 DISPLAY）。失败抛错，附 stderr 前 300 字。 */
export function run(cmd, args = [], { env = {}, timeout = 20000 } = {}) {
  try {
    return execFileSync(cmd, args, {
      env: { ...process.env, DISPLAY, ...env },
      encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (e) {
    const err = (e.stderr || e.stdout || '').toString().slice(0, 300)
    throw new Error(`${cmd} ${args.join(' ')} 失败：${e.message}${err ? ' | ' + err : ''}`)
  }
}

/** 命令是否存在（`which`）。 */
export function has(cmd) {
  try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true } catch { return false }
}

/** X 显示是否真的在（几何尺寸可读 ⇒ 在）。返回 `{w,h}` 或 null。 */
export function displayGeometry() {
  if (!has('xdotool')) return null
  try {
    const out = run('xdotool', ['getdisplaygeometry']).trim().split(/\s+/)
    const w = Number(out[0]); const h = Number(out[1])
    return (w > 0 && h > 0) ? { w, h } : null
  } catch { return null }
}

/** 桌面截图的**唯一**实现（X11 原生）。`out` 是 png 路径；返回该路径。
 *  ⚠ 不要给 scrot 传 `-D 0`：这个版本的 `-D` 要的是**显示串**（`:0`），传 `0` 会报
 *     "Can't open X display. It *is* running, yeah?"（实测踩过）。统一走 `DISPLAY` 环境变量。 */
export function shot(out) {
  if (!has('scrot')) throw new Error('scrot 不在 PATH 上（本机 X11 截图的唯一依赖）')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  run('scrot', ['-o', '-z', out])
  return out
}

// ── xdotool：指针（纯移动，不点击） ──────────────────────────────────────────
/**
 * 把指针**瞬间**移到桌面坐标 (x,y)。
 * ①(2026-09-19 实测) `xdotool mousemove --sync` 偶发失败（X 服务器忙/指针没法同步到位；真机跑长档时遇到过一次，
 * 整个测试因此抛栈中断）。这里做一次**降级重试**：带 `--sync` 失败 ⇒ 退回不带 `--sync` 的普通 warp，
 * 再读回位置确认；两次都失败才抛（抛之前把当前位置一起报出来，便于定位）。
 * ②(2026-09-19 再实测) **真正的坑不是"失败"而是"挂住"**：`--sync` 等的是"指针到达"事件，
 * 若指针**已经在目标点**（重复点同一个元素时每次 glide 的每一步都落在原地），事件永不到来 ⇒
 * `execFileSync` 只能等满 `timeout`（默认 20 s）才超时，一次 glide(4 步) 就要 80 s，
 * 三次重试 ≈ 4 分钟（`bench-click-test` 的 S10/S11 就是这么慢下来的）。
 * 所以：**(a) 已在目标点直接返回；(b) 给 `--sync` 单独一个 1.5 s 的小超时**，挂住也立刻降级到普通 warp。
 */
export function pointerTo(x, y, { syncTimeout = 1500 } = {}) {
  const X = String(Math.round(x)); const Y = String(Math.round(y))
  try {                                       // ②(a) 已经在目标点：不做无意义的"移动"
    const p = pointerNow()
    if (p.x === Number(X) && p.y === Number(Y)) return
  } catch { /* 读不到位置就照常走下面的路 */ }
  try { run('xdotool', ['mousemove', '--sync', X, Y], { timeout: syncTimeout }); return } catch (e1) {
    try { run('xdotool', ['mousemove', X, Y]) } catch (e2) {
      let now = '(读不到)'
      try { const p = pointerNow(); now = p.x + ',' + p.y } catch { /* ignore */ }
      throw new Error(`指针移不到 (${X},${Y})：sync 档 ${e1.message.slice(0, 80)}；普通档 ${e2.message.slice(0, 80)}；当前位置 ${now}`)
    }
  }
}

/** 当前指针位置 `{x,y}`（`getmouselocation --shell`）。 */
export function pointerNow() {
  const out = run('xdotool', ['getmouselocation', '--shell'])
  const g = (k) => Number((out.match(new RegExp('^' + k + '=(-?\\d+)$', 'm')) || [])[1])
  return { x: g('X'), y: g('Y'), screen: g('SCREEN') }
}

/** 用**真实 X 事件**把指针从当前位置沿直线走到 (x,y)，steps 步（带小停顿，让浏览器能收到中间点）。 */
export async function pointerGlide(x, y, { steps = 12, dwellMs = 40 } = {}) {
  const from = pointerNow()
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    pointerTo(from.x + (x - from.x) * t, from.y + (y - from.y) * t)
    if (dwellMs) await sleep(dwellMs)
  }
  return { from, to: pointerNow() }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── computer-use-linux：最小 MCP 客户端（stdio / 行分隔 JSON-RPC） ────────────
/** 找 `computer-use-linux` 可执行文件：`CUA_BIN` > PATH > 常见安装位置。找不到返回 null。 */
export function findCuaBin() {
  const cands = []
  if (process.env.CUA_BIN) cands.push(process.env.CUA_BIN)
  if (has('computer-use-linux')) {
    try { cands.push(execFileSync('which', ['computer-use-linux'], { encoding: 'utf8' }).trim()) } catch { /* ignore */ }
  }
  cands.push(path.join(os.homedir(), '.local/bin/computer-use-linux'))
  cands.push(path.join(os.homedir(), '.cargo/bin/computer-use-linux'))
  for (const c of cands) { try { if (c && fs.statSync(c).isFile()) return c } catch { /* next */ } }
  return null
}

/**
 * 起一个 `computer-use-linux mcp` 子进程并握手。**失败返回 null**（本机可能压根装不上/启动不了），
 * 调用方据此降级到 xdotool —— 绝不假装工具在场。
 */
export async function openCua({ bin = findCuaBin(), timeoutMs = 20000 } = {}) {
  if (!bin) return null
  const child = spawn(bin, ['mcp'], { env: { ...process.env, DISPLAY }, stdio: ['pipe', 'pipe', 'pipe'] })
  let buf = ''
  const pending = new Map()
  let seq = 0
  let stderr = ''
  child.stderr.on('data', (d) => { stderr += d.toString().slice(0, 4000) })
  child.stdout.on('data', (d) => {
    buf += d.toString()
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
      if (!line) continue
      let msg = null
      try { msg = JSON.parse(line) } catch { continue }
      const p = msg && msg.id != null ? pending.get(msg.id) : null
      if (p) { pending.delete(msg.id); p.resolve(msg) }
    }
  })
  const dead = new Promise((resolve) => child.once('exit', (code) => resolve(code)))
  const send = (method, params) => {
    const id = ++seq
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP ${method} 超时 ${timeoutMs}ms`)) }, timeoutMs)
      pending.set(id, { resolve: (m) => { clearTimeout(timer); resolve(m) } })
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  }
  const api = {
    bin, stderr: () => stderr,
    async init() {
      const r = await send('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'mpw-x11-e2e', version: '1' },
      })
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
      return r.result || null
    },
    async tools() {
      const r = await send('tools/list', {})
      return ((r.result && r.result.tools) || []).map((t) => t.name)
    },
    async call(name, args = {}) {
      const r = await send('tools/call', { name, arguments: args })
      if (r.error) throw new Error(`tools/call ${name} → ${JSON.stringify(r.error).slice(0, 300)}`)
      return r.result
    },
    close() { try { child.stdin.end() } catch { /* ignore */ } try { child.kill('SIGTERM') } catch { /* ignore */ } },
    exited: dead,
  }
  try {
    const init = await api.init()
    if (!init) { api.close(); return null }
    return api
  } catch (e) {
    api.close()
    return null
  }
}

/** 从 MCP `screenshot` 结果里把第一张图落盘；返回 `{file, meta}`。没有图 ⇒ null。 */
export function saveCuaImage(result, out) {
  const content = (result && result.content) || []
  const img = content.find((c) => c && c.type === 'image' && c.data)
  if (!img) return null
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, Buffer.from(img.data, 'base64'))
  return { file: out, mime: img.mimeType || 'image/png', bytes: fs.statSync(out).size }
}

/** 人读的通道小结（测试开头打印一行，让报告自己说明"这次用的是哪条通道"）。 */
export function channelSummary() {
  return {
    display: DISPLAY,
    geometry: displayGeometry(),
    xdotool: has('xdotool'),
    scrot: has('scrot'),
    cuaBin: findCuaBin(),
  }
}
