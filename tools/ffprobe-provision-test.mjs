// ffprobe-provision-test.mjs —— 审计 F5 的判据：**自带下载也要把 ffprobe 装回来** + **ffprobe 缺席时的次选探测**
//
// 病（审计 F5，2026-10-03 收口）：静态资产表是**单个二进制**（ffmpeg-static 的 ffmpeg-\*）+ 魔数校验
//   ⇒ 资产里不可能有 ffprobe；`downloadFfmpeg()` 也只写 ffmpeg 本体 ⇒ `resolveFfprobe()` 的后两级
//   （ffmpeg 同目录 / DATA_DIR/ffmpeg/）在这类机器上永远落空 ⇒ `/probe` 的 `verdict.playable` 恒 null
//   ⇒ "能直读就别转码"这条闸门**只在这类机器上失效**（4K 源会被整片重编码）。
//
// 修（两条都做，判据全在本文件）：
//   ① 首选：下载链**成对**取回 ffprobe（同源 ffmpeg-static 同 tag 的 ffprobe-\* 资产；
//      sha256 钉值命中则强校验（linux-arm64 已核实钉入）+ 长度下限 + 魔数逐条校验；
//      **ffprobe 失败不影响 ffmpeg 本体**）。`/ffmpeg-check` 新增 `ffprobe:{found,path,version}`
//      （既有字段一律不动）；`/ffmpeg-uninstall` 成对卸载；下载成功重置 `resolveFfprobe` 记忆化
//      （desktop-compat C1–C3 钉的"同进程同对象"语义在无下载时不变）。
//   ② 次选：`ffmpeg -hide_banner -i <file>` 的 stderr 解析（`parseFfmpegStderrMeta` 纯函数）喂
//      `buildProbeInfo`；成功的 info 带 `probeSource:'ffmpeg-i'`（ffprobe 路径 = `'ffprobe'`）——
//      台账字段，判据/客户端不读它。两条路都拿不到 ⇒ 照旧 playable=null（**不猜**）。
//
// 判据结构：
//   A 组 静态：出口/资产名派生/钉值表/校验三件套/三个路由的形状
//   B 组 行为：**桩下载端点**（真 HTTP；DSH_WE_FFMPEG_URL 同款 env 覆盖）——
//             好 ffprobe 落盘且 resolveFfprobe 随即命中 sibling、坏魔数**不落盘无残留**、
//             钉值不匹配必拒、ffmpeg 成功+ffprobe 失败不影响本体、双已在位零请求早退
//   C 组 行为：parseFfmpegStderrMeta 喂真实形状 stderr；系统有 ffmpeg 时真编一小段再走
//             `probeVideoInfoFfmpegI` 端到端（probeSource='ffmpeg-i'）；ffprobe 缺席（假 PATH）
//             时 `getVideoProbe` 真的落到次选
//   D 组 变异自证：parseFfmpegStderrMeta 砍掉 Video 分支 ⇒ 次选必 null（判据必红）
//
// 用法: node tools/ffprobe-provision-test.mjs [--data-dir <dir>]   （DSH_HOME 指临时目录，绝不碰用户数据）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawnSync, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d }
const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(here, '..')
const SERVER = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const SERVER_CODE = stripComments(SERVER)

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) } else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) } }

/* ── 隔离：DSH_HOME 指临时目录（必须在 import 前——lib/index.js 在 import 时读它算 DATA_DIR） */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-ffprobe-provision-'))
process.env.DSH_HOME = TMP
const DATA_DIR = path.join(TMP, '.dsh-mpkg-wallpaper')
const mod = await import(path.join(ROOT, 'lib', 'index.js'))
const T = mod.__mpwTest
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/* ── 桩下载端点：按"第 N 个请求"决定给什么（第 1 个=ffmpeg 本体，第 2 个=ffprobe——
      下载链的顺序就是 ffmpeg 成功后才补 ffprobe；单请求臂各自起新 server 避免歧义）。 */
function makeStubServer(plan) {
  // plan: [{ status, body:Buffer }] —— 超出计划长度回 404
  let hits = 0
  const srv = http.createServer((req, res) => {
    const step = plan[Math.min(hits, plan.length - 1)]
    hits++
    if (!step || step.status !== 200) { res.writeHead(step && step.status || 404); res.end(); return }
    res.writeHead(200, { 'Content-Length': String(step.body.length) })
    res.end(step.body)
  })
  srv.hits = () => hits
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv)))
}
const elfBuf = (mb) => { const b = Buffer.alloc(mb * 1024 * 1024, 0x61); b[0] = 0x7f; b[1] = 0x45; b[2] = 0x4c; b[3] = 0x46; return b }   // 21MB ELF 魔数
const junkBuf = (mb) => { const b = Buffer.alloc(mb * 1024 * 1024, 0x00); b[0] = 0xde; b[1] = 0xad; return b }
const closeStub = (srv) => new Promise((r) => srv.close(() => r()))
const ffmpegDir = () => path.join(DATA_DIR, 'ffmpeg')
const fpTarget = () => path.join(ffmpegDir(), T.ffprobeExeName())
const ffTarget = () => path.join(ffmpegDir(), process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
const rmDir = (d) => { try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ } }

console.log('== A 组：静态（出口 / 资产派生 / 钉值 / 校验三件套 / 路由形状）==')
ok('A1 __mpwTest 出口齐全：downloadFfprobe/ffprobeAssetName/ffprobeExeName/ffmpegDataDir/parseFfmpegStderrMeta/probeVideoInfoFfmpegI/resetFfprobeMemo',
  ['downloadFfprobe', 'ffprobeAssetName', 'ffprobeExeName', 'ffmpegDataDir', 'parseFfmpegStderrMeta', 'probeVideoInfoFfmpegI']
    .every((n) => typeof T[n] === 'function') && typeof T.resetFfprobeMemo === 'function')
ok('A2 资产名派生 = ffmpeg 资产名把 ffmpeg- 前缀换成 ffprobe-（同 tag 同源）',
  (() => { const a = T.ffprobeAssetName(); const re = /function ffprobeAssetName\(\) \{[^}]*replace\(\/\^ffmpeg-\/, 'ffprobe-'\)/.test(SERVER_CODE); return !!a && a.indexOf('ffprobe-') === 0 && re })(),
  JSON.stringify({ asset: T.ffprobeAssetName() }))
ok('A3 钉值表存在且 linux-arm64 已核实钉入（下载实测 sha256）',
  /const FFPROBE_STATIC_SHA256 = \{[\s\S]*?'ffprobe-linux-arm64':\s*'[0-9a-f]{64}'/.test(SERVER))
ok('A4 ffprobe 下载校验三件套 + 原子落盘 + 记忆化失效都在源码里',
  /downloadFfmpegToFile\(url, tmp, ctrl\.signal, \{ minBytes: 20 \* 1024 \* 1024 \}\)/.test(SERVER_CODE)
  && /const want = FFPROBE_STATIC_SHA256\[asset\];/.test(SERVER_CODE)
  && /renameSync\(tmp, target\);/.test(SERVER_CODE)
  && /__ffprobeResolved = void 0;/.test(SERVER_CODE))
ok('A5 路由形状：/ffmpeg-check 带 ffprobe 字段、/ffmpeg-download 响应带 ffprobe、/ffmpeg-uninstall 成对卸载',
  /ffprobe: \{ found: !!fp, path: fp \? fp\.path : null, version: fpVersion \}/.test(SERVER_CODE)
  && /ffprobe: r\.ffprobe \|\| null/.test(SERVER_CODE)
  && /removedFfprobe: removedFp/.test(SERVER_CODE))

console.log('== C1 组：parseFfmpegStderrMeta（真实 stderr 形状，先于切 PATH 的臂）==')
const REAL_STDERR = [
  "Input #0, matroska,webm, from '/x/y.mkv':",
  "  Duration: 00:01:30.04, start: 0.000000, bitrate: 4569 kb/s",
  "    Stream #0:0(eng): Video: h264 (High), yuv420p(tv, bt709), 3840x2160 [SAR 1:1 DAR 16:9], 60 fps, 60 tbr, 1k tbn (default)",
  "    Stream #0:1(eng): Audio: opus, 48000 Hz, stereo, fltp (default)",
].join('\n')
{
  const m = T.parseFfmpegStderrMeta(REAL_STDERR)
  ok('C1a container/video/profile/pixFmt/宽高/fps/audio 全解析', m.container === 'matroska,webm' && m.video === 'h264' && m.videoProfile === 'High'
    && m.pixFmt === 'yuv420p' && m.width === 3840 && m.height === 2160 && m.rFrameRate === '60/1' && m.audio === 'opus'
    && Math.abs(m.duration - 90.04) < 0.01, JSON.stringify(m))
  const info = T.buildProbeInfo(m, Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]))
  ok('C1b 喂 buildProbeInfo ⇒ matroska 里的 h264+opus 判"可直读"（判据表口径）且色彩字段留空（不猜）',
    info.browserPlayable.playable === true && info.pixFmt === 'yuv420p' && info.colorRange === '' && info.colorSpace === '',
    JSON.stringify(info.browserPlayable))
}

/* 真 ffmpeg 端到端（系统有 ffmpeg 才跑；没有就如实 SKIP——canned 臂已覆盖解析逻辑） */
const hasSysFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0
const hasSysFfprobe = spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0
if (hasSysFfmpeg) {
  const gen = path.join(TMP, 'gen.mp4')
  try {
    execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'testsrc=duration=0.2:size=320x240:rate=30',
      '-f', 'lavfi', '-i', 'sine=duration=0.2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', gen],
      { stdio: 'ignore', timeout: 60000 })
    const viaProbe = T.probeVideoInfo(gen)
    const viaI = T.probeVideoInfoFfmpegI(gen)
    ok('C1c 真 mp4 端到端：ffprobe 路 probeSource=ffprobe、ffmpeg-i 路 probeSource=ffmpeg-i，两者 codec/宽高/fps 一致',
      !!viaProbe && viaProbe.probeSource === 'ffprobe' && !!viaI && viaI.probeSource === 'ffmpeg-i'
      && viaI.video === viaProbe.video && viaI.width === viaProbe.width && viaI.fps === viaProbe.fps,
      JSON.stringify({ ffprobe: viaProbe && { v: viaProbe.video, w: viaProbe.width, fps: viaProbe.fps }, ffmpegI: viaI && { v: viaI.video, w: viaI.width, fps: viaI.fps } }))
    if (hasSysFfprobe) {
      ok('C1d 双路 verdict 一致（ffprobe 与 ffmpeg-i 对同一文件给出同一个 playable）',
        JSON.stringify(viaProbe.browserPlayable) === JSON.stringify(viaI.browserPlayable),
        JSON.stringify({ a: viaProbe.browserPlayable, b: viaI.browserPlayable }))
    }
  } catch (e) {
    console.log('  SKIP C1c/C1d — 系统 ffmpeg 编 lavfi 样片失败（' + String(e && e.message || e).slice(0, 80) + '）')
  }
} else {
  console.log('  SKIP C1c/C1d — 本机没有系统 ffmpeg')
}

/* ── B 组：桩下载端点（行为）。切 PATH 前先做"系统 ffprobe 在场"读数，之后全部在假 PATH 下进行。 */
console.log('== B 组：桩下载端点（真 HTTP；假 PATH ⇒ 系统 ffprobe/ffmpeg 都不可见）==')
const STUB_PATH = TMP + '/bin'
fs.mkdirSync(STUB_PATH, { recursive: true })
const REAL_PATH = process.env.PATH
process.env.PATH = STUB_PATH          // spawnSync('ffprobe'/'ffmpeg') 全部 ENOENT ⇒ 探测链只剩 sibling/env
delete process.env.DSH_WE_FFPROBE
delete process.env.DSH_WE_FFMPEG
T.resetFfprobeMemo()
rmDir(ffmpegDir())

ok('B0 前置：假 PATH 下 resolveFfprobe()=null（sibling 目录还没有 ffprobe）', T.resolveFfprobe() === null)
{
  /* B1 的桩必须给**钉值命中的真内容**（linux-arm64 已钉 sha256 ⇒ 任意桩内容都会被 sha256 校验正确拒掉）。
     样本从 MPW_FFPROBE_SAMPLE 读（真实 ffprobe 二进制；跑测试的人自备）。没有 ⇒ 如实 SKIP 本臂
     （失败路径 B2/B3 与次选 C2 不受影响；"落盘 + 记忆化失效"的正路径在有样本的机器上验证）。 */
  const sample = (process.env.MPW_FFPROBE_SAMPLE || '').trim()
  const sampleOk = sample && fs.existsSync(sample) && fs.statSync(sample).size >= 20 * 1024 * 1024
    && sha256(fs.readFileSync(sample)) === ('9c741c0dedaf503106732d819d7f9ecf1d991ca923cc688d3d52aa4d6d51222d')
  if (!sampleOk) {
    console.log('  SKIP B1/B1b/B1c — 没有 MPW_FFPROBE_SAMPLE（真实 ffprobe-linux-arm64，sha256 须与钉值一致）⇒ "好下载落盘"臂无法在钉值校验下伪造')
  } else {
    const real = fs.readFileSync(sample)
    const srv = await makeStubServer([{ status: 200, body: real }])
    process.env.DSH_WE_FFMPEG_URL = 'http://127.0.0.1:' + srv.address().port + '/blob'
    const r = await T.downloadFfprobe()
    const landed = fs.existsSync(fpTarget())
    ok('B1 好 ffprobe 落盘：路径=DATA_DIR/ffmpeg/ffprobe、大小=响应字节、sha256 记录、pinned=true',
      r.ok === true && r.path === fpTarget() && landed && r.size === real.length && r.sha256 === sha256(real) && r.pinned === true,
      JSON.stringify({ ok: r.ok, size: r.size, pinned: r.pinned }))
    const mem = T.resolveFfprobe()
    ok('B1b 下载后 resolveFfprobe 立即命中 sibling（记忆化被重置，不是旧 null）',
      !!mem && mem.source === 'sibling' && mem.path === fpTarget(), JSON.stringify(mem))
    ok('B1c 无 .part 残留', fs.readdirSync(ffmpegDir()).filter((n) => n.indexOf('.part') >= 0).length === 0)
    await closeStub(srv); delete process.env.DSH_WE_FFMPEG_URL
  }
}
{
  // 钉值不匹配（本平台钉了 arm64 ⇒ 换内容必拒）：换一个合法 ELF 但内容不同
  rmDir(ffmpegDir()); T.resetFfprobeMemo()
  const srv = await makeStubServer([{ status: 200, body: elfBuf(22) }])
  process.env.DSH_WE_FFMPEG_URL = 'http://127.0.0.1:' + srv.address().port + '/blob'
  let threw = null
  try { await T.downloadFfprobe() } catch (e) { threw = String(e && e.message || e) }
  ok('B2 钉值 sha256 不匹配 ⇒ 拒绝且不落盘无残留', !!threw && threw.indexOf('sha256 mismatch') >= 0 && !fs.existsSync(fpTarget()), threw || 'no-throw')
  await closeStub(srv); delete process.env.DSH_WE_FFMPEG_URL
}
{
  // 坏魔数（"校验失败也当成功"的变异等价臂：守卫若被删，这里就会落盘）
  rmDir(ffmpegDir()); T.resetFfprobeMemo()
  const srv = await makeStubServer([{ status: 200, body: junkBuf(21) }])
  process.env.DSH_WE_FFMPEG_URL = 'http://127.0.0.1:' + srv.address().port + '/blob'
  let threw = null
  try { await T.downloadFfprobe() } catch (e) { threw = String(e && e.message || e) }
  ok('B3 坏魔数 ⇒ 拒绝且不落盘无残留（变异"校验失败也当成功"必红臂）', !!threw && threw.indexOf('magic') >= 0 && !fs.existsSync(fpTarget()), threw || 'no-throw')
  await closeStub(srv); delete process.env.DSH_WE_FFMPEG_URL
}
{
  // ffmpeg 成功 + ffprobe 失败 ⇒ 本体照常就位、ffprobe 如实报错。
  // ffmpeg 本体也有钉值（FFMPEG_STATIC_SHA256）⇒ 第 1 个请求必须给真内容（MPW_FFMPEG_SAMPLE）；没有就如实 SKIP。
  const ffSample = (process.env.MPW_FFMPEG_SAMPLE || '').trim()
  const ffOk = ffSample && fs.existsSync(ffSample) && fs.statSync(ffSample).size >= 20 * 1024 * 1024
    && sha256(fs.readFileSync(ffSample)) === '237800b37bb65a81ad47871c6c8b7c45c0a3ca62a5b3f9d2a7a9a2dd9a338271'
  if (!ffOk) {
    console.log('  SKIP B4 — 没有 MPW_FFMPEG_SAMPLE（真实 ffmpeg-linux-arm64，sha256 须与既有钉值一致）⇒ "ffmpeg 成功 + ffprobe 失败"臂无法伪造')
  } else {
    rmDir(ffmpegDir()); T.resetFfprobeMemo()
    const srv = await makeStubServer([{ status: 200, body: fs.readFileSync(ffSample) }, { status: 200, body: junkBuf(21) }])
    process.env.DSH_WE_FFMPEG_URL = 'http://127.0.0.1:' + srv.address().port + '/blob'
    const r = await T.downloadFfmpeg()
    ok('B4 ffmpeg 成功 + ffprobe 失败 ⇒ 本体落盘、返回 ffprobe.ok=false 带 error、不阻塞主下载',
      fs.existsSync(ffTarget()) && r && r.ffprobe && r.ffprobe.ok === false && typeof r.ffprobe.error === 'string' && !fs.existsSync(fpTarget()),
      JSON.stringify({ ff: fs.existsSync(ffTarget()), ffprobe: r && r.ffprobe }))
    await closeStub(srv); delete process.env.DSH_WE_FFMPEG_URL
  }
}
{
  // 双已在位 ⇒ 早退且零请求（ffprobe 记 skipped）。B4 后 ffprobe 缺席（故意）⇒ 手工补位（早退只看 existsSync）
  if (!fs.existsSync(fpTarget())) fs.writeFileSync(fpTarget(), Buffer.alloc(1024, 7))
  const srv = await makeStubServer([{ status: 500, body: Buffer.alloc(4) }])
  process.env.DSH_WE_FFMPEG_URL = 'http://127.0.0.1:' + srv.address().port + '/blob'
  const r = await T.downloadFfmpeg()
  ok('B5 ffmpeg/ffprobe 都已在位 ⇒ downloadFfmpeg 早退、ffprobe 记 skipped、零 HTTP 请求',
    r && r.path === ffTarget() && r.ffprobe && r.ffprobe.ok === true && r.ffprobe.skipped === 'already-present' && srv.hits() === 0,
    JSON.stringify({ hits: srv.hits(), ffprobe: r && r.ffprobe }))
  await closeStub(srv); delete process.env.DSH_WE_FFMPEG_URL
}

console.log('== C2 组：ffprobe 缺席时 getVideoProbe 落到次选（桩 ffmpeg 吐真实 stderr 形状）==')
{
  T.resetFfprobeMemo()
  const stubFf = path.join(STUB_PATH, 'ffmpeg')
  fs.writeFileSync(stubFf, '#!/bin/sh\nif [ "$1" = "-version" ]; then echo "ffmpeg version 4.4.2"; exit 0; fi\necho "' + REAL_STDERR.replace(/"/g, '\\"') + '" >&2\nexit 1\n', { mode: 0o755 })
  process.env.DSH_WE_FFMPEG = stubFf
  const dummy = path.join(TMP, 'dummy.mkv')
  fs.writeFileSync(dummy, Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(2048, 7)]))
  const info = T.getVideoProbe({ type: 'file', path: dummy })
  ok('C2 ffprobe 全链不可见 ⇒ 次选接住：probeSource=ffmpeg-i、codec/宽高来自 stderr、playable=true（matroska+h264+opus 可直读）',
    !!info && info.probeSource === 'ffmpeg-i' && info.video === 'h264' && info.width === 3840 && info.fps === 60
      && info.browserPlayable.playable === true, JSON.stringify(info && { src: info.probeSource, v: info.video, w: info.width, p: info.browserPlayable }))
  delete process.env.DSH_WE_FFMPEG
}
process.env.PATH = REAL_PATH

console.log('== D 组：变异自证（真源零改动）==')
{
  /* sliceFn 只在 desktop-compat 里对 lib/index.js 的模块级函数用过；这里复刻同一手法 */
  const sliceFn = (src, name) => {
    const i = src.indexOf('function ' + name + '(')
    if (i < 0) throw new Error('缺少函数 ' + name)
    let d = 0, started = false
    for (let j = i; j < src.length; j++) {
      if (src[j] === '{') { d++; started = true } else if (src[j] === '}') { d--; if (started && d === 0) return src.slice(i, j + 1) }
    }
    throw new Error('函数体不配平 ' + name)
  }
  const real = new Function('return (' + sliceFn(SERVER, 'parseFfmpegStderrMeta') + ')')()
  const mutSrc = sliceFn(SERVER, 'parseFfmpegStderrMeta').replace(': Video: ', ': Xideo: ')
  const mut = new Function('return (' + mutSrc + ')')()
  const mReal = real(REAL_STDERR), mMut = mut(REAL_STDERR)
  ok('D1 砍掉 Video 分支 ⇒ 次选拿不到 video ⇒ probeVideoInfoFfmpegI 必 null（判据必红）；真源照常解析',
    mReal.video === 'h264' && !mMut.video && mMut.container === 'matroska,webm',
    JSON.stringify({ real: mReal.video, mut: mMut.video }))
  ok('D2 次选判据"解析不出视频流 ⇒ null"在真源里（不猜）',
    /if \(!meta\.video\) return null;/.test(SERVER_CODE) && /if \(!meta\.video\) return null;/.test(stripComments(sliceFn(SERVER, 'probeVideoInfoFfmpegI'))))
}

fs.rmSync(TMP, { recursive: true, force: true })
console.log(`\n===== ffprobe-provision: ${pass} 通过 / ${fail} 失败 =====`)
if (!fail) console.log('✓ F5 收口：下载链成对装 ffprobe（校验失败不落盘）、ffprobe 缺席机器有次选探测、台账带 probeSource')
process.exit(fail ? 1 : 0)
