#!/usr/bin/env node
// shot-upload-test.mjs — P-88 用户点名「一键连拍上报截图」：POST /shot 原始字节直传 + 📸 连拍按钮/快捷键 + 纯函数边界
// 复现：node shot-upload-test.mjs
//
// ── 为什么需要这个测试 / 证据是什么 ──────────────────────────────────────────
// 用户原话："你加一个功能上报截图的功能 —— 这样我就不用下载下来，点一下不需确认就能直接上传到你的后台，
//   因为我下载下来可能卡不好他的时机"。这条需求的两个不可退让点，各自都要有**可复跑的证据**：
//   ① **抓时机**：单击不是"拍一张"，而是"一段时间内连拍多帧"（默认 60 帧 × ≥100ms），并且取帧必须与
//      渲染帧对齐（同一张画布图连传 60 份毫无价值）。所以"帧节流判定"与"缩放尺寸计算"被抽成**纯函数**
//      `shotScale(w,h,maxW)` / `shotDue(lastMs,nowMs,intervalMs)`，本文件把它们从 `demo.html` 里**真源码切出来**
//      跑边界（等于阈值 / 小于阈值 / 超大图 / 零尺寸）；并断言连拍路径**不存在 setInterval**、取样点在帧末。
//   ② **原分辨率**：要抓的是人物面部/眉毛，缩略图（480×270）看不清 ⇒ 断言读回用的是 `cv.width/height`
//      且只有宽度 >1920 才等比缩（1920 这一档是"肉眼可辨 + 单帧落在 4MB 上限内"的折中）。
// 服务端侧的证据必须是**真进程 + 真字节**：子进程起 `server/we-scene-demo-server.mjs`（空闲端口、临时
//   MPW_REPORTS_DIR、try/finally 必杀），POST 一段**能真解码的最小合法 JPEG**（本文件的 16×16 向量先用
//   仓库自带解码器 `elysia/we-renderer/jpeg.js` 验过），再逐条钉死 200 / ok:true / 文件真的存在 /
//   字节与发送**逐字节相同** / `index.jsonl` 多一行且字段齐全；反面：非图片 content-type 415、
//   单帧 >4MB → 413、`id` 带 `..` → 400（路径逃逸必须挡在门外）。
//
// 断言分组：
//   A 纯函数（从 demo.html 的 MPW-SHOT-PURE 区块切源码跑）：shotScale 5 组边界 + shotDue 5 组边界
//   B 前端源码守卫：按钮 id/挂 #bar/四指针 stop/__mpwSafeDataURL/原分辨率+1920 上限/进度与 ✅ 复原/
//     j·J 绑定/帧末取样点接线/连拍不用 setInterval/**没有新增 `?flag` 式 URL 开关**
//   C 服务端契约：子进程真服务 + 真 JPEG/PNG 字节往返 + index.jsonl 台账 + 415/413/400 反面用例
//     + 服务端源码守卫（shots 自己的 400 帧滚动存在、/report 的 60 份滚动一字未动）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { decodeJpeg } from '../elysia/we-renderer/jpeg.js'
import { ROOT } from './_root.mjs'   // ①(2026-09-16 目录整理) 仓库根（本脚本已移入 tests/）

const HERE = ROOT
let pass = 0, fail = 0
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}

const HTML = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8')
const SERVER_SRC = fs.readFileSync(path.join(ROOT, 'server/we-scene-demo-server.mjs'), 'utf8')
function slice(src, a, b) {
  const i = src.indexOf(a), j = src.indexOf(b)
  if (i < 0 || j < 0 || j < i) throw new Error('demo.html 里找不到区块标记：' + a)
  return src.slice(src.indexOf('\n', i) + 1, src.lastIndexOf('\n', j))
}
const PURE = slice(HTML, '// ═══ MPW-SHOT-PURE-BEGIN', '// ═══ MPW-SHOT-PURE-END')
const BLOCK = slice(HTML, '// ═══ MPW-SHOT-BTN-BEGIN', '// ═══ MPW-SHOT-BTN-END')

// 最小合法 JPEG / PNG 向量（离线生成；JPEG 的合法性由下面的 A0 段用仓库自带解码器当场验证）
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAQABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABQf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCXADqO/9k=', 'base64')
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAFUlEQVR42mPkOmHDgA0wMeAAg1MCANeqAR5Skap5AAAAAElFTkSuQmCC', 'base64')

console.log('[A] 纯函数（demo.html 的 MPW-SHOT-PURE 区块，真源码切出来跑）')
{
  const { shotScale, shotDue } = new Function(PURE + '\nreturn { shotScale, shotDue }')()
  // A0：JPEG 向量先自证"合法"（不然服务端往返测的是一段垃圾字节）
  const dec = decodeJpeg(new Uint8Array(JPG))
  check('A0 测试用 JPEG 向量是合法 baseline JPEG（仓库自带解码器解出 16x16）',
    dec && dec.width === 16 && dec.height === 16 && dec.rgba.length === 16 * 16 * 4,
    dec ? dec.width + 'x' + dec.height + ' rgba=' + dec.rgba.length : 'decode 返回空')
  // shotScale
  const a1 = shotScale(3840, 2160, 1920)
  check('A1 超大图 3840x2160 → 等比缩到 1920x1080（scaled=true，原始尺寸带在 srcW/srcH）',
    a1.w === 1920 && a1.h === 1080 && a1.scaled === true && a1.srcW === 3840 && a1.srcH === 2160, JSON.stringify(a1))
  const a2 = shotScale(1920, 1080, 1920)
  check('A2 **等于阈值** 1920 宽 → 一个像素都不动（scaled=false）',
    a2.w === 1920 && a2.h === 1080 && a2.scaled === false, JSON.stringify(a2))
  const a3 = shotScale(1280, 720, 1920)
  check('A3 小于阈值 → 原分辨率直传（scaled=false）', a3.w === 1280 && a3.h === 720 && a3.scaled === false, JSON.stringify(a3))
  const a4 = shotScale(1921, 1080, 1920)
  check('A4 刚过阈值 1 像素 → 缩到 1920（高按比例四舍五入 = 1079，不是硬截 1080）',
    a4.w === 1920 && a4.h === Math.round(1080 * 1920 / 1921) && a4.h === 1079 && a4.scaled === true && a4.srcW === 1921, JSON.stringify(a4))
  const a5 = shotScale(0, 0, 1920)
  check('A5 零尺寸 → {w:0,h:0}（调用方据此跳过该帧，不抛异常）',
    a5.w === 0 && a5.h === 0 && a5.scaled === false, JSON.stringify(a5))
  const a6 = shotScale(4000, 0, 1920)
  check('A6 半零尺寸（宽有高无）→ 也按 0 处理，绝不除零', a6.w === 0 && a6.h === 0, JSON.stringify(a6))
  // shotDue
  check('A7 首次取样（lastMs=null）→ 立刻到期', shotDue(null, 12345, 100) === true)
  check('A8 **等于阈值**（差 = intervalMs）→ 算到期（>= 不是 >）', shotDue(1000, 1100, 100) === true)
  check('A9 小于阈值（差 = intervalMs-1）→ 不到期', shotDue(1000, 1099, 100) === false)
  check('A10 intervalMs ≤ 0 → 不节流（恒到期）', shotDue(1000, 1000, 0) === true && shotDue(1000, 1000, -5) === true)
  check('A11 lastMs 为 NaN/非数字 → 当首次处理（到期的安全侧）', shotDue(NaN, 5000, 100) === true && shotDue(undefined, 5000, 100) === true)
}

console.log('[B] 前端源码守卫（demo.html 真实区块）')
{
  check('B1 区块标记齐全（MPW-SHOT-BTN-BEGIN/END + MPW-SHOT-PURE-BEGIN/END）',
    HTML.includes('// ═══ MPW-SHOT-BTN-BEGIN') && HTML.includes('// ═══ MPW-SHOT-BTN-END')
    && HTML.includes('// ═══ MPW-SHOT-PURE-BEGIN') && HTML.includes('// ═══ MPW-SHOT-PURE-END'))
  check("B2 按钮 id = 'mpw-shot-btn'", /\.id = 'mpw-shot-btn'/.test(BLOCK))
  check('B3 按钮挂进 #bar（与 🎥 相机 / 🛰 立即上报 同一行）',
    /getElementById\('bar'\)/.test(BLOCK) && /bar\.appendChild\(btn\)/.test(BLOCK))
  check('B4 四种指针事件全 stop（pointerdown/pointerup/mousedown/touchstart）',
    /\['pointerdown', 'pointerup', 'mousedown', 'touchstart'\]/.test(BLOCK) && /\.addEventListener\(evn, stop\)/.test(BLOCK))
  check('B5 画布读回走 __mpwSafeDataURL（污染时返回 null → 记日志跳过，不抛）',
    /window\.__mpwSafeDataURL \? window\.__mpwSafeDataURL\(tc, 'image\/jpeg', QUALITY\)/.test(BLOCK)
    && /连拍读回失败/.test(BLOCK))
  check('B6 原分辨率读回 + 仅 >1920 宽才等比缩（MAXW = 1920；原始尺寸进元数据 ow/oh）',
    /shotScale\(cv\.width, cv\.height, MAXW\)/.test(BLOCK) && /MAXW = 1920/.test(BLOCK)
    && /ow: g\.sc\.srcW, oh: g\.sc\.srcH/.test(BLOCK))
  check('B7 进度文案 = 📸 n/total（实时）', /btn\.textContent = '📸 ' \+ st\.n \+ '\/' \+ st\.total/.test(BLOCK))
  check('B8 完成文案 = ✅ sent/n 且 1.5s 后复原（setTimeout(..., 1500)）',
    /'✅ ' \+ st\.sent \+ '\/' \+ st\.n/.test(BLOCK) && /setTimeout\(\(\) => \{ if \(!st\.on\) resetUi\(\) \}, 1500\)/.test(BLOCK))
  check('B9 第二次点击 = 停止（不是重启）', /if \(st\.on\) burstEnd\('用户第二次点击 = 停止'\)/.test(BLOCK))
  check("B10 默认 60 帧 × 100ms（DEFAULT_N=60 / INTERVAL=100）", /DEFAULT_N = 60, INTERVAL = 100/.test(BLOCK))
  check("B11 快捷键 j = 单帧、J = 连拍（ev.key 判定，且在输入框里不抢键）",
    /k === 'j'/.test(BLOCK) && /k === 'J'/.test(BLOCK) && /tn === 'INPUT' \|\| tn === 'TEXTAREA'/.test(BLOCK))
  check('B12 快捷键写进按钮 title（用户在界面上能看见 j / J）',
    /const BASE_TITLE = [\s\S]{0,700}?快捷键：j = 单帧立即上报（精确抓时机），J（Shift\+j）= 连拍/.test(BLOCK)
    && /btn\.title = BASE_TITLE/.test(BLOCK))
  check('B13 取帧 = 帧末钩子 + shotDue 判到期；**没有 setInterval 调用**（不会硬拍同一张）',
    /window\.__mpwShotFrameTick = function \(tSec, frameNo, canvas\)/.test(BLOCK)
    && /shotDue\(st\.last, now, INTERVAL\)/.test(BLOCK) && !/setInterval\s*\(/.test(BLOCK))
  check('B14 渲染帧循环里真的接了取样点（帧末、传 tSec/帧号/画布）',
    /window\.__mpwShotFrameTick\(tSec, window\.__mpwFrameNo \|\| 0, cv\)/.test(HTML))
  check('B15 多实例安全：钩子认画布（canvas !== cv 直接 return）', /if \(canvas !== cv\) return/.test(BLOCK))
  check('B16 每帧上传完成/失败各一条日志（失败带 HTTP 状态或异常文本，不静默）',
    /已上报 ' \+ job\.kb \+ 'KB/.test(BLOCK) && /上报失败：' \+ \(r\.status \? 'HTTP ' \+ r\.status : '异常 ' \+ r\.error\)/.test(BLOCK))
  check('B17 **没有新增任何 `?flag` 式 URL 开关**（区块内不碰 URLSearchParams/searchParams，URL 里无 ?shot=/?burst=）',
    !/URLSearchParams|searchParams/.test(BLOCK) && !/[?&](shot|burst)=/i.test(HTML) && /const SHOT_URL = '\/shot'/.test(BLOCK))
  check('B18 每帧 POST 的是**原始图片字节**（Blob + content-type: image/jpeg，不是 base64 JSON）',
    /body: new Blob\(\[job\.bytes\], \{ type: 'image\/jpeg' \}\)/.test(BLOCK)
    && /headers: \{ 'content-type': 'image\/jpeg' \}/.test(BLOCK) && !/JSON\.stringify\(job/.test(BLOCK))
  check('B19 单帧 j 与连拍各自计数（连拍途中按 j 不会把连拍顶到 60 提前收尾）',
    /const idx = single \? \(\+\+st\.singles\) : \(\+\+st\.n\)/.test(BLOCK) && /singles: 0/.test(BLOCK))
}

console.log('[C] 服务端契约：子进程真服务（空闲端口 + 临时 MPW_REPORTS_DIR；try/finally 必杀）')
{
  const REP = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-shottest-rep-'))
  const LOG = path.join(REP, 'server.log')
  const logFd = fs.openSync(LOG, 'a')
  let child = null
  try {
    const port = await new Promise((res, rej) => {
      const s = net.createServer()
      s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) })
      s.on('error', rej)
    })
    child = spawn(process.execPath, ['server/we-scene-demo-server.mjs'], {
      cwd: HERE,
      env: { ...process.env, PORT: String(port), MPW_REPORTS_DIR: REP },
      stdio: ['ignore', logFd, logFd],
    })
    const base = 'http://127.0.0.1:' + port
    let ready = false
    for (let i = 0; i < 100 && !ready; i++) {
      if (child.exitCode !== null) break
      try { await fetch(base + '/diag-flags.json', { signal: AbortSignal.timeout(800) }); ready = true } catch { await new Promise((r) => setTimeout(r, 200)) }
    }
    check('C1 子进程服务就绪（端口 ' + port + '，上报目录=临时目录）', ready && child.exitCode === null)
    if (ready) {
      const ID = 'shot-upload-test-id'
      // —— 正例：最小合法 JPEG 真字节直传 ——
      const r1 = await fetch(base + '/shot?id=' + ID + '&tag=burst-07&t=1.234&note=test&w=1920&h=1080&ow=3840&oh=2160&frame=42',
        { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: JPG })
      check('C2 POST /shot（image/jpeg 原始字节）→ 200', r1.status === 200, 'status=' + r1.status)
      const j1 = await r1.json().catch(() => null)
      check('C3 返回 {ok:true, file:"shots/<id>/<ts>-<tag>.jpg", bytes:N}',
        !!j1 && j1.ok === true && j1.bytes === JPG.length && /^shots\/shot-upload-test-id\/\d+-burst-07\.jpg$/.test(String(j1.file || '')),
        JSON.stringify(j1))
      const abs = path.join(REP, String(j1 && j1.file || ''))
      const got = fs.existsSync(abs) ? fs.readFileSync(abs) : null
      check('C4 文件**真的落盘**了（绝对路径存在且是普通文件）', !!got && fs.statSync(abs).isFile(), abs)
      check('C5 落盘字节与发送字节**逐字节相同**（' + JPG.length + 'B）',
        !!got && got.length === JPG.length && Buffer.compare(got, JPG) === 0,
        got ? 'disk=' + got.length + 'B cmp=' + Buffer.compare(got, JPG) : 'missing')
      // —— 台账 index.jsonl ——
      const idxPath = path.join(REP, 'shots', ID, 'index.jsonl')
      const lines = fs.existsSync(idxPath) ? fs.readFileSync(idxPath, 'utf8').trim().split('\n').filter(Boolean) : []
      check('C6 index.jsonl 恰好追加 1 行（一行一条 JSON）', lines.length === 1, 'lines=' + lines.length)
      let rec = null
      try { rec = JSON.parse(lines[0]) } catch { rec = null }
      const need = ['id', 'tag', 't', 'note', 'bytes', 'ts', 'at', 'ua', 'file']
      check('C7 那行 JSON 可解析且字段齐全（' + need.join('/') + '）',
        !!rec && need.every((k) => rec[k] !== undefined && rec[k] !== null), rec ? Object.keys(rec).join(',') : 'unparsable')
      check('C8 台账字段与请求一致（id/tag/t/note/bytes/尺寸/frame）',
        !!rec && rec.id === ID && rec.tag === 'burst-07' && rec.t === '1.234' && rec.note === 'test'
        && rec.bytes === JPG.length && rec.w === 1920 && rec.h === 1080 && rec.ow === 3840 && rec.oh === 2160 && rec.frame === 42,
        rec ? JSON.stringify({ id: rec.id, tag: rec.tag, t: rec.t, bytes: rec.bytes, w: rec.w, ow: rec.ow, frame: rec.frame }) : 'null')
      check('C9 台账带时间戳（ts 数字 + at ISO）与 UA 摘要（非空字符串）',
        !!rec && Number.isFinite(rec.ts) && /^\d{4}-\d\d-\d\dT/.test(String(rec.at)) && typeof rec.ua === 'string' && rec.ua.length > 0,
        rec ? 'ts=' + rec.ts + ' at=' + rec.at + ' ua=' + String(rec.ua).slice(0, 24) : 'null')
      // —— 正例：PNG（同一路由，按类型换扩展名）——
      const r2 = await fetch(base + '/shot?id=' + ID + '&tag=single', { method: 'POST', headers: { 'content-type': 'image/png' }, body: PNG })
      const j2 = await r2.json().catch(() => null)
      check('C10 image/png 也收（落 .png，字节一致）',
        r2.status === 200 && !!j2 && j2.ok === true && /\.png$/.test(String(j2.file))
        && Buffer.compare(fs.readFileSync(path.join(REP, String(j2.file))), PNG) === 0,
        'status=' + r2.status + ' file=' + (j2 && j2.file))
      // —— 反面用例 ——
      const r3 = await fetch(base + '/shot?id=' + ID + '&tag=x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"not":"an image"}' })
      const j3 = await r3.json().catch(() => null)
      check('C11 非图片 content-type（application/json）→ 415 且给出原因',
        r3.status === 415 && !!j3 && j3.ok === false && /content-type/.test(String(j3.error)), 'status=' + r3.status + ' err=' + (j3 && j3.error))
      const big = Buffer.alloc(4 * 1024 * 1024 + 1, 0x41)
      const r4 = await fetch(base + '/shot?id=' + ID + '&tag=toobig', { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: big })
      const j4 = await r4.json().catch(() => null)
      check('C12 单帧 >4MB → 413（并说明上限）',
        r4.status === 413 && !!j4 && j4.ok === false && /too large/.test(String(j4.error)), 'status=' + r4.status + ' err=' + (j4 && j4.error))
      const r5 = await fetch(base + '/shot?id=..&tag=x', { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: JPG })
      const r6 = await fetch(base + '/shot?id=' + encodeURIComponent('../../evil') + '&tag=x', { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: JPG })
      check('C13 id 带 `..` / 含斜杠 → 400（路径逃逸挡在门外）',
        r5.status === 400 && r6.status === 400, 'id=.. → ' + r5.status + '；id=../../evil → ' + r6.status)
      check('C14 逃逸尝试没有在 reports 目录外留下任何文件（shots/ 下无 ../ 目录）',
        !fs.existsSync(path.join(REP, '..', 'evil')) && fs.existsSync(path.join(REP, 'shots')))
      // tag 白名单化（防文件名注入）
      const r7 = await fetch(base + '/shot?id=' + ID + '&tag=' + encodeURIComponent('../../pwn'), { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: JPG })
      const j7 = await r7.json().catch(() => null)
      check('C15 tag 里的 `../` 被白名单化（文件名不含斜杠、仍落在该 id 目录里）',
        r7.status === 200 && !!j7 && !String(j7.file).includes('/../') && path.dirname(path.join(REP, String(j7.file))) === path.join(REP, 'shots', ID),
        'file=' + (j7 && j7.file))
      check('C16 服务端 stdout 打出**绝对落盘路径**（[shot] …，供真机排障）',
        fs.readFileSync(LOG, 'utf8').includes('[shot] ' + path.join(REP, 'shots', ID) + path.sep),
        '日志=' + LOG)
    }
  } catch (e) {
    check('C0 服务端契约测试异常', false, String(e && (e.stack || e.message) || e))
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM')
      await new Promise((res) => {
        const t = setTimeout(() => { try { child.kill('SIGKILL') } catch {} ; res() }, 3000)
        child.once('exit', () => { clearTimeout(t); res() })
      })
    }
    try { fs.closeSync(logFd) } catch {}
    try { fs.rmSync(REP, { recursive: true, force: true }) } catch {}
  }
}

console.log('[D] 服务端源码守卫（两套滚动策略各自独立，上限都从 MPW_LIMITS 取：shots 每 id 400 帧/200MB + 全局 500MB，report 60 份/64MB）')
{
  check('D1 POST /shot 路由存在，且读的是原始 body（不是 JSON 解析）',
    /m = p\.match\(\/\^\\\/shot\$\/\);/.test(SERVER_SRC) && !/JSON\.parse\(body\)[\s\S]{0,200}shots/.test(SERVER_SRC))
  // ①(P-104 2026-09-17 用户发布纪律②) 滚动逻辑从"写死 400 的内联 while"升级成
  //   `pruneShotsId(sid)` + `MPW_LIMITS.shotPerIdMaxFiles/MaxBytes`（数量 + 字节双上限）。
  //   守卫口径随之更新：**行为只增不减**（仍然每 id 滚动、只数图片、index.jsonl 台账不删）。
  check('D2 shots 目录**自己**按"每 id ≤N 帧 + ≤N 字节，超出删最旧"滚动（上限来自 MPW_LIMITS，不再写死 400）',
    /pruneShotsId\(sid\);/.test(SERVER_SRC)
    && /maxFiles: MPW_LIMITS\.shotPerIdMaxFiles/.test(SERVER_SRC)
    && /maxBytes: MPW_LIMITS\.shotPerIdMaxBytes/.test(SERVER_SRC)
    && /filter: \(n\) => \/\\\.\(jpg\|png\)\$\/i\.test\(n\)/.test(SERVER_SRC))
  check('D3 /report 的滚动仍在（60 份 + 合计 64MB），且与 shots 是**两套独立**策略（各自的函数 + 各自的目录）',
    /pruneReports\(dir\)/.test(SERVER_SRC)
    && /maxFiles: MPW_LIMITS\.reportsMaxFiles/.test(SERVER_SRC)
    && /maxBytes: MPW_LIMITS\.reportsMaxBytes/.test(SERVER_SRC)
    && /reportsMaxFiles: numEnv\('MPW_LIMIT_REPORTS_MAX', 60\)/.test(SERVER_SRC)
    && /shotPerIdMaxFiles: numEnv\('MPW_LIMIT_SHOT_FILES', 400\)/.test(SERVER_SRC)
    && /filter: \(n\) => \/\^r\\d\+\\\.json\$\/\.test\(n\)/.test(SERVER_SRC))
  check('D4 4MB 上限与 415/400 三种拒绝路径都在源码里（413/415/400 各一处 res.writeHead）',
    /MAX_SHOT = 4 \* 1024 \* 1024/.test(SERVER_SRC) && /res\.writeHead\(413/.test(SERVER_SRC)
    && /res\.writeHead\(415/.test(SERVER_SRC) && /sid\.includes\('\.\.'\)/.test(SERVER_SRC))
}

console.log('\n===== shot-upload-test: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
process.exit(fail ? 1 : 0)
