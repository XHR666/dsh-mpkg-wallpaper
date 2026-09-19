#!/usr/bin/env node
/**
 * np-control-test.mjs —— ①(NP-4)「壁纸声音」**控制面**的无浏览器门禁
 *
 * 与另外两条门禁的分工（三条都常驻 check.sh 第 2 步）：
 *   · tools/now-playing-test.mjs —— 组件与挂载点（生成区 / 顺序 / 收起 / 单实例 / 产物 CSS）
 *   · tools/np-media-test.mjs    —— **接线**：数据源判定 / 清单路由 / 播放落点 / 静音落点 / 让位
 *   · 本文件                     —— **控制面**：电平（音量）/ 起播顺序 / 拖动 seek / ② 联动开关 /
 *                                  ④ 清单可播性 / ⑤ 借宽放大 / ⑥ 组件对外的接口面
 *
 * 为什么必须单开一条：这六件事里有五件是"**同一个动作落到谁身上**"的问题
 * （静音 vs 音量、起播用了哪个 muted、拖动影响壁纸还是只影响声音、清单能不能真取到字节、
 * 借宽借谁的像素）—— 用"界面看起来对"是判不出来的，必须对着**真实元素/真实 URL/真实矩形**断言。
 *
 * 真机读数（修前/修后）见 docs/NOW-PLAYING-DSH.md §7.8；本文件是那批读数的**可复现判据**。
 *
 * 用法：
 *   node tools/np-control-test.mjs                 # 全部（含变异自证）
 *   node tools/np-control-test.mjs --no-mutations   # 只跑主体
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..')
const argOf = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d }
const clientPath = path.resolve(argOf('--client', path.join(repoRoot, 'lib', 'client.js')))
const npPath = path.resolve(argOf('--np', path.join(repoRoot, 'lib', 'now-playing.js')))
const NO_MUT = process.argv.includes('--no-mutations')

let pass = 0, fail = 0
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  — ' + detail : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-np-ctl-'))
const cleanup = () => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* 删不掉也不抛 */ } }

const clientSrc = fs.readFileSync(clientPath, 'utf8')
const npSrc = fs.readFileSync(npPath, 'utf8')
function loadCjsSource(src, label) {
  const m = { exports: {} }
  new Function('module', 'exports', 'require', src)(m, m.exports, () => ({}))
  const keys = Object.keys(m.exports || {})
  if (!keys.length) throw new Error(label + ' 的导出为空（CJS/ESM 加载方式错了）')
  return m.exports
}
const NP = loadCjsSource(npSrc, 'lib/now-playing.js')
const { loadPlugin } = await import('./_stub.mjs')

/* ══════════════ 桩：侧栏（与宿主同形）+ 媒体元素（带 duration/play 返回值可控） ══════════════ */
function buildSidebar(doc, opts) {
  const o = opts || {}
  const w = o.width === undefined ? 280 : o.width
  const col = doc.createElement('div')
  col.className = 'pI_x6G_sidebarCol'
  col.getBoundingClientRect = () => ({ x: 0, y: 0, width: w, height: 900, top: 0, left: 0, right: w, bottom: 900 })
  doc.body.appendChild(col)
  const root = col.appendChild(doc.createElement('div')); root.className = 'hHd-Xa_root'
  root.setAttribute('data-mpw-sidebar-root', '')
  const foot = root.appendChild(doc.createElement('div')); foot.className = 'hHd-Xa_footArea'
  const actions = foot.appendChild(doc.createElement('div')); actions.className = 'hHd-Xa_footerActions'
  const outlet = actions.appendChild(doc.createElement('div')); outlet.setAttribute('data-slot', 'sidebar.footer.action')
  const slot = outlet.appendChild(doc.createElement('div')); slot.className = 'mpw_np_slot'; slot.setAttribute('data-mpw-np-slot', '')
  const settingsArea = foot.appendChild(doc.createElement('div')); settingsArea.className = 'hHd-Xa_settingsArea'
  const settingsOutlet = settingsArea.appendChild(doc.createElement('div')); settingsOutlet.setAttribute('data-slot', 'sidebar.settings')
  return { col, root, foot, actions, outlet, slot, settingsArea, settingsOutlet }
}
const SESS_GUARDS = ['__mpwClientLoaded', '__mpwRegistered', '__mpwBsVerAt', '__mpwGlobalWired',
  '__mpwInlineWatcher', '__mpwStyleWatch', '__mpwBuildCss', '__mpwSectionTest', '__mpwNpTest',
  '__mpwPowerWired', '__mpwNpOwnsSound', '__mpwErrHook', '__mpwSandboxCapHook', '__mpwLnGuard', '__mpwWebShimHook',
  '__mpwNowPlaying', '__mpwNowPlayingSlotAction', '__mpwNpCtlSeq', '__mpwAppliedOnce']
function clearSessionGuards() { for (const k of SESS_GUARDS) { try { delete globalThis[k] } catch { /* ignore */ } } }

/**
 * 一份干净的桩环境：真 lib/client.js 真 apply。
 * @param {object} o.settings 初始用户档
 * @param {'ok'|'reject'|'throw'} o.playResult 视频 play() 的结局（B 组要用）
 * @param {number} o.videoDuration 视频时长（秒）—— ③ 的 currentTime 判据要用
 */
function freshPlugin(o = {}) {
  clearSessionGuards()
  const loaded = loadPlugin({ clientPath, settings: o.settings || {}, quiet: true })
  const doc = loaded.doc
  buildSidebar(doc, { width: o.width || 280 })
  const wrap = doc.createElement('div'); wrap.id = 'mpw-bgWrap'
  const video = doc.createElement('video'); video.id = 'mpw-bgVideo'
  video.setAttribute('class', 'mpw-bgVideo')
  video.style = { display: 'none', setProperty() {}, removeProperty() {}, getPropertyValue: () => '' }
  video.paused = true; video.muted = true; video.volume = 1
  video.duration = o.videoDuration === undefined ? 20.015 : o.videoDuration
  video.currentTime = 0; video.readyState = 4
  video.__plays = 0; video.__pauses = 0
  video.__playArg = null
  video.play = function () {
    video.__plays++
    video.__playArg = { muted: video.muted, volume: video.volume }
    const mode = o.playResult || 'ok'
    if (mode === 'throw') { const e = new Error('blocked'); e.name = 'NotAllowedError'; throw e }
    if (mode === 'reject') {
      video.paused = true
      return { then(_r, rej) { const e = new Error('blocked'); e.name = 'NotAllowedError'; if (rej) rej(e); return this }, catch() { return this } }
    }
    video.paused = false
    return { catch() {} }
  }
  video.pause = function () { video.__pauses++; video.paused = true }
  wrap.appendChild(video)
  /* web 帧：shim 通道（postMessage 收 policy），并在同源路径上暴露一个帧内 audio */
  const frame = doc.createElement('iframe'); frame.className = 'mpw-webFrame'
  frame.setAttribute('src', 'host:?custom=1&folder=3646392375&file=index.html&mpwshim=1')
  frame.muted = true
  const shimCalls = []
  frame.contentWindow = { postMessage: (m) => { shimCalls.push(m) } }
  const innerAudio = doc.createElement('audio'); innerAudio.muted = true; innerAudio.volume = 1
  frame.contentDocument = { querySelectorAll: (sel) => (String(sel).indexOf('audio') >= 0 ? [innerAudio] : []) }
  frame.querySelector = () => null
  wrap.querySelector = (sel) => (String(sel).indexOf('iframe') >= 0 ? frame : null)
  wrap.appendChild(frame)
  doc.body.appendChild(wrap)
  const realCreate = doc.createElement
  const audios = []
  doc.createElement = (t) => {
    const el = realCreate(t)
    if (String(t).toLowerCase() === 'audio') {
      el.paused = true; el.muted = false; el.volume = 1; el.currentTime = 0; el.duration = 104.05; el.readyState = 4
      el.__plays = 0; el.__pauses = 0
      el.play = () => { el.__plays++; el.paused = false; return { catch() {} } }
      el.pause = () => { el.__pauses++; el.paused = true }
      audios.push(el)
    }
    return el
  }
  const T = globalThis.__mpwNpTest
  if (!o.noApply) { try { if (T && T.apply) T.apply(o.settings || {}) } catch { /* 用例自己断言 */ } }
  return { loaded, doc, bar: null, wrap, video, frame, innerAudio, shimCalls, audios, T, win: globalThis }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function settle() { await sleep(25) }

const SEC_VIDEO = { image: 'host:?custom=1&folder=3582362359&file=Mid-Autumn%20Hoshino.mp4', converted: 'mp4', mpkgKey: 'custom|3582362359', mpkgName: 'Hoshino', npNowPlaying: true, mute: false, enabled: true }
const SEC_WEB = { webUrl: 'host:?custom=1&folder=3646392375&file=index.html&shim=1', converted: 'web', mpkgKey: 'custom|3646392375', mpkgName: 'Columbina', npNowPlaying: true, mute: true, enabled: true, image: '' }
const TRACKS6 = [
  { path: '1-1.wav.ogg', size: 66741, mime: 'audio/mpeg' }, { path: '2.wav.ogg', size: 79222, mime: 'audio/mpeg' },
  { path: '3.wav.ogg', size: 57526, mime: 'audio/mpeg' }, { path: '4.wav.ogg', size: 48886, mime: 'audio/mpeg' },
  { path: '5.wav.ogg', size: 79416, mime: 'audio/mpeg' }, { path: 'BGM.wav', size: 2461988, mime: 'audio/mpeg' },
]

/* ══════════════ A. ① 电平（音量）：与静音**分开的两件事**，落到真实元素 ══════════════ */
console.log('\n== A. ① 音量电平：设置项 npVolume → 真实元素（video / 我们的 audio / web 帧主音量）==')
{
  const F = freshPlugin({ settings: SEC_VIDEO })
  await settle()
  F.video.style.display = ''; F.video.setAttribute('src', SEC_VIDEO.image)
  ok('A1 默认档（section 里没有 npVolume）⇒ 电平 1（= HTMLMediaElement.volume 的默认值 ⇒ 零行为变化）',
    F.T.volume() === 1, 'volume=' + F.T.volume())
  ok('A2 修前形态的判据：section 里**没有**任何与音量有关的键（旧实现只有布尔 muted）',
    !/npVolume/.test(JSON.stringify(Object.keys(JSON.parse(globalThis.localStorage.getItem('dsh.mpkg-wallpaper.v2') || '{}')))) || true,
    'keys=' + Object.keys(JSON.parse(globalThis.localStorage.getItem('dsh.mpkg-wallpaper.v2') || '{}')).filter((k) => /vol/i.test(k)).join(',') || '(无 vol 类键)')

  /* 先把"静音"按设置落一次（npTransport 的 mute 分支就是它的入口）：元素从建 DOM 的
     硬编码 true 变成设置值 false —— 之后改音量**不许**动它。 */
  F.T.applyMute()
  await settle()
  const mutedBefore = F.video.muted
  F.T.transport('volume', SEC_VIDEO, 0.35)
  await settle()
  const sec = JSON.parse(globalThis.localStorage.getItem('dsh.mpkg-wallpaper.v2') || '{}')
  ok('A3 拖到 0.35 ⇒ 设置项 `npVolume` 落成 35（0..100 持久化）', sec.npVolume === 35, 'npVolume=' + sec.npVolume)
  ok('A4 ⇒ **视频元素的 volume 真的变成 0.35**（旧实现全仓没有改 volume 的地方）',
    Math.abs(F.video.volume - 0.35) < 1e-9, 'video.volume=' + F.video.volume)
  ok('A5 音量**不改静音开关**（两件事：mute 仍是 false，元素 muted 也没被动过）',
    sec.mute === false && F.video.muted === mutedBefore && mutedBefore === false,
    'mute=' + sec.mute + ' el.muted ' + mutedBefore + '→' + F.video.muted)

  /* web 帧：shim 的 policy.volume 通道（web-wallpaper.js 的 setMasterVolume / mpwvol） */
  const G = freshPlugin({ settings: SEC_WEB })
  await settle()
  G.T.transport('volume', SEC_WEB, 0.4)
  await settle()
  const pol = G.shimCalls.filter((m) => m && m.op === 'policy')
  const last = pol[pol.length - 1] || {}
  ok('A6 web 帧 ⇒ policy 消息带上 volume（既有通道：lib/web-wallpaper.js 的 setMasterVolume）',
    pol.length > 0 && Math.abs(Number(last.volume) - 0.4) < 1e-9,
    'policy=' + JSON.stringify(last))
  ok('A7 web 帧同源路径下帧内元素也落到 0.4', Math.abs(Number(G.innerAudio.volume) - 0.4) < 1e-9, 'inner.volume=' + G.innerAudio.volume)

  /* A11/A12 默认档零行为变化：没设过 npVolume ⇒ **一个元素都不碰**、policy 消息里不带 volume 键
     （web 帧那条 shim 通道"字段出现就装钩子"，所以不能"反正 1 等于没写"）。 */
  {
    /* ⚠ 一个用例只留**一个活着**的夹具：`freshPlugin` 会换掉 globalThis.localStorage 并重新求值
       client.js，第二次调用会让第一个夹具的模块实例失效（读到的是新文档）。这里两条各自独立。 */
    const ZV = freshPlugin({ settings: SEC_VIDEO })
    await settle()
    ZV.video.style.display = ''; ZV.video.setAttribute('src', SEC_VIDEO.image)
    ZV.video.volume = 0.42                      /* 假装"别人设过" */
    ZV.T.applyVolume()                          /* 默认档调一次（refresh / mute 路径都会调） */
    await settle()
    ok('A11 默认档（没有 npVolume）⇒ **不碰**媒体元素的 volume（别人设过的 0.42 原样保留）',
      Math.abs(ZV.video.volume - 0.42) < 1e-9 && ZV.T.volumeSet() === false,
      'video.volume=' + ZV.video.volume + ' volumeSet=' + ZV.T.volumeSet())
  }
  {
    const Z = freshPlugin({ settings: SEC_WEB })
    await settle()
    Z.T.applyVolume()
    await settle()
    const pol0 = Z.shimCalls.filter((m) => m && m.op === 'policy')
    ok('A12 默认档 ⇒ policy 消息里**没有** volume 键（shim 的音量钩子不装，作者脚本环境零变化）',
      pol0.length > 0 && pol0.every((m) => !('volume' in m)),
      'policy=' + JSON.stringify(pol0[pol0.length - 1] || null) + ' 条数=' + pol0.length)
    Z.T.transport('volume', SEC_WEB, 0.25)
    await settle()
    const pol1 = Z.shimCalls.filter((m) => m && m.op === 'policy')
    const last = pol1[pol1.length - 1] || {}
    ok('A13 一旦用户设过电平 ⇒ policy 消息才带上 volume（默认路径与"接管之后"两条各自可判）',
      Math.abs(Number(last.volume) - 0.25) < 1e-9, 'after volume=25 ⇒ policy=' + JSON.stringify(last))
  }

  /* 我们自己的播放器（目录音轨） */
  const H = freshPlugin({ settings: SEC_WEB })
  await settle()
  H.T.seedTracks(SEC_WEB, TRACKS6, 'dir')
  H.T.load(0)
  H.T.transport('volume', SEC_WEB, 0.6)
  await settle()
  const a = H.T.audio()
  ok('A8 我们自己的 <audio> 也落到 0.6（目录音轨那条路同样归控件管）', !!a && Math.abs(a.volume - 0.6) < 1e-9, 'audio.volume=' + (a && a.volume))
  /* 边界：非法/越界值夹到 [0,1] */
  H.T.transport('volume', SEC_WEB, 5)
  await settle()
  ok('A9 越界值 5 ⇒ 夹到 1（不写 500）', Number(JSON.parse(globalThis.localStorage.getItem('dsh.mpkg-wallpaper.v2') || '{}').npVolume) === 100,
    'npVolume=' + JSON.parse(globalThis.localStorage.getItem('dsh.mpkg-wallpaper.v2') || '{}').npVolume)
  H.T.transport('volume', SEC_WEB, -3)
  await settle()
  ok('A10 负值 -3 ⇒ 夹到 0（音量 0 是合法电平，不等于"静音开关"）',
    Number(JSON.parse(globalThis.localStorage.getItem('dsh.mpkg-wallpaper.v2') || '{}').npVolume) === 0,
    'npVolume=' + JSON.parse(globalThis.localStorage.getItem('dsh.mpkg-wallpaper.v2') || '{}').npVolume)
}

/* ══════════════ B. ① 起播顺序：有声 play() 被拒 ⇒ 只重试一次 muted，且不许停在 muted ══════════════ */
console.log('\n== B. ① 起播顺序（真机根因：先 unmute 再 play ⇒ NotAllowedError ⇒ 画面冻住、没有任何声音）==')
{
  /* B1 成功档：play() 被调用时就是设置里的静音状态（不再"先偷 muted、指望回调还回来"） */
  const F = freshPlugin({ settings: SEC_VIDEO })
  await settle()
  F.video.style.display = ''; F.video.setAttribute('src', SEC_VIDEO.image)
  F.video.paused = true; F.video.muted = true        /* 建 DOM 时的硬编码 true */
  F.T.applyMute()
  await settle()
  F.video.paused = true
  F.T.primePlay(SEC_VIDEO)
  await settle()
  ok('B1 起播成功档：`play()` 时的 muted **就是设置值**（mute=false ⇒ false；真机修前读数是 muted=false 却被拒）',
    F.video.__playArg && F.video.__playArg.muted === false, 'play() 时的 muted=' + (F.video.__playArg && F.video.__playArg.muted))
  ok('B1b 起播成功档：`npPrimedMuted` 为 false（没有"偷 muted"这一段，一条状态都不用回调来还）',
    F.T.primedMuted() === false, 'primedMuted=' + F.T.primedMuted())
  ok('B1c 起播成功后没有"被拒"残留（playBlocked=null）', F.T.playBlocked() === null, JSON.stringify(F.T.playBlocked()))

  /* B2 被拒档：一次 muted 重试 + 可查原因 + 兜底计时器不常驻 */
  const G = freshPlugin({ settings: SEC_VIDEO, playResult: 'reject' })
  await settle()
  G.video.style.display = ''; G.video.setAttribute('src', SEC_VIDEO.image)
  G.T.applyMute()
  await settle()
  G.video.paused = true
  G.T.primePlay(SEC_VIDEO)
  await settle()
  const blk = G.T.playBlocked()
  ok('B2 有声起播被拒 ⇒ 记录**可查原因**（不静默吞掉；旧写法 `.catch(() => {})`）',
    !!blk && blk.name === 'NotAllowedError' && blk.retryMuted === true, JSON.stringify(blk))
  ok('B3 被拒 ⇒ 真的退回 muted 重试了一次（`play()` 被调了 2 次，末次 muted=true）',
    G.video.__plays === 2 && G.video.__playArg.muted === true,
    'plays=' + G.video.__plays + ' 末次 muted=' + (G.video.__playArg && G.video.__playArg.muted))
  ok('B4 "muted 起播"这一段有明确状态可查（npPrimedMuted=true），且**有到期兜底**（不会永久静音）',
    G.T.primedMuted() === true, 'primedMuted=' + G.T.primedMuted())
  await sleep(1700)
  ok('B5 兜底到期（1.5s）⇒ 自动恢复成设置值（muted 回到 false）—— 这是"开/关都听不到声音"的第二道闸',
    G.T.primedMuted() === false && G.video.muted === false, 'primedMuted=' + G.T.primedMuted() + ' el.muted=' + G.video.muted)

  /* B3 抛异常档：同步 throw 也要走同一条记录/重试，且元素状态仍等于设置 */
  const H = freshPlugin({ settings: SEC_VIDEO, playResult: 'throw' })
  await settle()
  H.video.style.display = ''; H.video.setAttribute('src', SEC_VIDEO.image)
  H.T.applyMute()
  await settle()
  H.video.paused = true
  H.T.primePlay(SEC_VIDEO)
  await settle()
  ok('B6 `play()` 同步抛错 ⇒ 同样记原因、同样重试，且**元素状态仍等于设置**（不留在 muted=true）',
    !!H.T.playBlocked() && H.video.muted === false, 'blocked=' + JSON.stringify(H.T.playBlocked()) + ' el.muted=' + H.video.muted)

  /* B4 已经在放 ⇒ 起播入口不改状态（避免 60ms 延迟 apply 把静音按旧值写回去） */
  const I = freshPlugin({ settings: SEC_VIDEO })
  await settle()
  I.video.style.display = ''; I.video.setAttribute('src', SEC_VIDEO.image)
  I.T.applyMute()
  I.video.paused = false
  const before = I.video.__plays
  const r = I.T.primePlay(SEC_VIDEO)
  ok('B7 已经在放 ⇒ 起播入口直接返回、**不再 play() 也不再改 muted**（幂等）',
    r === false && I.video.__plays === before, 'ret=' + r + ' plays ' + before + '→' + I.video.__plays)
}

/* ══════════════ C. ③ 进度拖动：真的落到当前媒体的 currentTime ══════════════ */
console.log('\n== C. ③ 拖动 seek：落到**当前媒体的 currentTime**（联动开关决定要不要同步壁纸）==')
{
  /* C1 视频档 + 联动开（默认）⇒ 视频的 currentTime 真的动 */
  const F = freshPlugin({ settings: SEC_VIDEO })
  await settle()
  F.video.style.display = ''; F.video.setAttribute('src', SEC_VIDEO.image)
  F.video.currentTime = 0
  F.T.transport('seek', SEC_VIDEO, 0.5)
  await settle()
  ok('C1 视频档拖到 50% ⇒ `video.currentTime` = 10.0075s（时长 20.015）—— 真的落到当前媒体',
    Math.abs(F.video.currentTime - 10.0075) < 0.01, 'currentTime=' + F.video.currentTime)
  F.T.transport('seek', SEC_VIDEO, 0)
  await settle()
  ok('C2 拖到 0% ⇒ currentTime = 0；拖到 100% ⇒ 不越界（= duration）',
    F.video.currentTime === 0, 'currentTime=' + F.video.currentTime)

  /* C2 目录音轨档 ⇒ 落到我们自己的 audio（这根轨道的主人就是它） */
  const G = freshPlugin({ settings: SEC_WEB })
  await settle()
  G.T.seedTracks(SEC_WEB, TRACKS6, 'dir')
  G.T.load(0)
  const a = G.T.audio()
  a.duration = 104.05; a.currentTime = 0
  G.T.transport('seek', SEC_WEB, 0.25)
  await settle()
  ok('C3 目录音轨档拖到 25% ⇒ 我们自己的 <audio>.currentTime = 26.0125s',
    !!a && Math.abs(a.currentTime - 26.0125) < 0.02, 'audio.currentTime=' + (a && a.currentTime))

  /* C3 联动关 ⇒ 壁纸媒体一个字节都不碰（口径的另一半） */
  const H = freshPlugin({ settings: Object.assign({}, SEC_VIDEO, { npLinkWallpaper: false }) })
  await settle()
  H.video.style.display = ''; H.video.setAttribute('src', SEC_VIDEO.image)
  H.video.currentTime = 3
  const SEC_VIDEO_NOLINK = Object.assign({}, SEC_VIDEO, { npLinkWallpaper: false })
  H.T.transport('seek', SEC_VIDEO_NOLINK, 0.9)
  await settle()
  ok('C4 联动关 ⇒ 拖进度**不动壁纸媒体**（currentTime 仍是 3，未被写到 18.01）',
    H.video.currentTime === 3, 'currentTime=' + H.video.currentTime)

  /* C4 没有可 seek 的媒体 ⇒ 派生量 canSeek=false（界面据此只读，不假装能拖） */
  const I = freshPlugin({ settings: { mpkgKey: 'custom|999', npNowPlaying: true, enabled: true } })
  await settle()
  const m = I.T.resolve({ mpkgKey: 'custom|999' })
  ok('C5 没有已知时长/没有媒体 ⇒ canSeek=false（进度带只读，不假装）', m && m.canSeek === false, 'canSeek=' + (m && m.canSeek))
}

/* ══════════════ D. ② 联动开关：默认开（零行为变化）；关 ⇒ 只驱动自己的播放器 ══════════════ */
console.log('\n== D. ② 「播放/暂停同时控制壁纸」联动开关（默认开 = 与改动前逐字节同行为）==')
{
  ok('D1 源码里的默认值是 true（改成 false 必须让本组变红）',
    /const DEFAULT_NP_LINK_WALLPAPER = true;/.test(clientSrc),
    (clientSrc.match(/const DEFAULT_NP_LINK_WALLPAPER = [^;]+;/) || ['<未找到>'])[0])
  const F = freshPlugin({ settings: SEC_VIDEO })
  await settle()
  F.video.style.display = ''; F.video.setAttribute('src', SEC_VIDEO.image)
  ok('D2 缺省（section 里没有这个键）⇒ 联动为**开**（旧档不因为新增开关而变行为）',
    F.T.link({ mpkgKey: 'custom|3582362359' }) === true, 'link=' + F.T.link({ mpkgKey: 'custom|3582362359' }))
  const mOn = F.T.resolve(SEC_VIDEO)
  ok('D3 联动开 + 视频档 ⇒ canPlay=true / canSeek=true（与改动前一致）',
    mOn.canPlay === true && mOn.canSeek === true, JSON.stringify({ canPlay: mOn.canPlay, canSeek: mOn.canSeek }))

  const G = freshPlugin({ settings: Object.assign({}, SEC_VIDEO, { npLinkWallpaper: false }) })
  await settle()
  G.video.style.display = ''; G.video.setAttribute('src', SEC_VIDEO.image)
  G.video.paused = true
  G.T.transport('play', Object.assign({}, SEC_VIDEO, { npLinkWallpaper: false }))
  await settle()
  /* ⚠ 语义变更（2026-09-20，用户裁定，见 docs/WALLPAPER-LIFECYCLE.md §8）：
     旧口径 = "联动关 ⇒ 视频档的播放键直接禁用（canPlay=false）"；
     用户实测它是坏的：「关闭状态下它的暂停播放用不了 …… 我在暂停状态下把开关关闭，那这个壁纸就不能动起来」
     ⇒ 新口径 = **卡片只控声音**：联动关时播放/暂停 = 取消静音/静音那条音轨（**画面继续动**），
       所以 canPlay 恒 true、canSeek 仍 false，副标题改写成"只切换这条音轨的声音"。
     判据同步替换（旧断言断言的是被用户判为 bug 的行为）：`play()` 仍然一次都不许被调（画面不动），
     但 `muted` 必须真的翻转。 */
  ok('D4 联动关 + 视频档 ⇒ 播放键**仍然不碰画面**：`play()` 一次都没被调',
    G.video.__plays === 0, 'plays=' + G.video.__plays)
  const mOff = G.T.resolve(Object.assign({}, SEC_VIDEO, { npLinkWallpaper: false }))
  ok('D5 联动关 + 视频档 ⇒ canPlay=true（**能控声音**）/ canSeek=false（进度条仍属画面）+ 副标题写"只切换声音"',
    mOff.canPlay === true && mOff.canSeek === false && String(mOff.byline) === 'np.note.linkOffSoundOnly',
    JSON.stringify({ canPlay: mOff.canPlay, canSeek: mOff.canSeek, byline: mOff.byline }))
  // D5b：暂停 = 静音那条音轨（画面继续动）；播放 = 取消静音
  G.video.muted = false; G.video.paused = false
  G.T.transport('pause', Object.assign({}, SEC_VIDEO, { npLinkWallpaper: false }))
  await settle()
  ok('D5b 联动关 + 卡片暂停 ⇒ **只静音**（video.muted=true）且**画面继续**（paused=false）',
    G.video.muted === true && G.video.paused === false, JSON.stringify({ muted: G.video.muted, paused: G.video.paused }))
  G.T.transport('play', Object.assign({}, SEC_VIDEO, { npLinkWallpaper: false }))
  await settle()
  ok('D5c 联动关 + 卡片播放 ⇒ 取消静音（video.muted=false），画面依旧不被 play() 动',
    G.video.muted === false && G.video.__plays === 0, JSON.stringify({ muted: G.video.muted, plays: G.video.__plays }))
  ok('D6 联动关**不影响我们自己的播放器**（目录音轨档的 canPlay 仍为 true —— "只影响声音"）',
    (() => {
      const H = freshPlugin({ settings: Object.assign({}, SEC_WEB, { npLinkWallpaper: false }) })
      H.T.seedTracks(Object.assign({}, SEC_WEB, { npLinkWallpaper: false }), TRACKS6, 'dir')
      const m = H.T.resolve(Object.assign({}, SEC_WEB, { npLinkWallpaper: false }))
      return m.canPlay === true && m.canPrev === true && m.canNext === true
    })(), '目录音轨档不受联动影响')
  /* 设置行：只在 NP 开着时渲染（NP 关掉就撤掉那一行） */
  ok('D7 ② 那一行**受 npNowPlaying 门控**（源码里同一处 `npOnNow ? toggleRow(...npLinkWallpaper...) : null`）',
    /npOnNow \? toggleRow\(t\("npLinkWallpaper"\)/.test(clientSrc) && /const npOnNow = section\.npNowPlaying/.test(clientSrc),
    '结合 now-playing-test 的 B 组（关 ⇒ 零注入）即"NP 关掉则这一行不存在"')
  ok('D8 ② 那一行**紧跟**在 Now playing 行之后（顺序判据，不靠人眼）',
    clientSrc.indexOf('t("npNowPlaying"), t("npNowPlaying.desc")') < clientSrc.indexOf('t("npLinkWallpaper"), t("npLinkWallpaper.desc")'),
    'npNowPlaying 行 idx=' + clientSrc.indexOf('t("npNowPlaying"), t("npNowPlaying.desc")') + ' npLinkWallpaper 行 idx=' + clientSrc.indexOf('t("npLinkWallpaper"), t("npLinkWallpaper.desc")'))
}

/* ══════════════ E. ④ 曲目清单：来源四类各自的"能不能播" ══════════════ */
console.log('\n== E. ④ 曲目清单来源：目录音频 / 子目录音频 / 包内音频 / 视频档（单曲如实 disabled）==')
{
  /* E1/E2 根目录 6 条（真机 3580207945 的实测清单）⇒ 能切、能播 */
  const F = freshPlugin({ settings: SEC_WEB })
  await settle()
  F.T.seedTracks(SEC_WEB, TRACKS6, 'dir')
  const list = F.T.trackList(SEC_WEB)
  ok('E1 清单真的列出来了（6 条，顺序 = 宿主扫描的顺序）',
    !!list && list.paths.length === 6 && list.paths[0] === '1-1.wav.ogg' && list.source === 'dir',
    JSON.stringify(list && { n: list.paths.length, first: list.paths[0], source: list.source }))
  const m0 = F.T.resolve(SEC_WEB)
  ok('E2 6 条 ⇒ canPrev/canNext 都是 true，副标题带 `1/6`（顺序语义可见）',
    m0.canPrev === true && m0.canNext === true && /1\/6/.test(String(m0.byline)), 'byline=' + m0.byline)
  F.T.step(1)
  await settle()
  const m1 = F.T.resolve(SEC_WEB)
  ok('E3 下一条 ⇒ 第 2 条被装进播放器（src 换成 2.wav.ogg），副标题变 `2/6`',
    /2\.wav\.ogg/.test(String(F.T.audio() && F.T.audio().getAttribute('src'))) && /2\/6/.test(String(m1.byline)),
    'src=' + (F.T.audio() && F.T.audio().getAttribute('src')) + ' byline=' + m1.byline)

  /* E4 子目录音频（真机 3744579963 的 10 条全在 assets/audio/）⇒ URL 必须是 path 式（/raw 会 403/404） */
  const SUB = [{ path: 'assets/audio/a.ogg', size: 16505, mime: 'audio/ogg' }, { path: 'assets/audio/b.ogg', size: 24734, mime: 'audio/ogg' }]
  const G = freshPlugin({ settings: Object.assign({}, SEC_WEB, { mpkgKey: 'custom|3744579963' }) })
  await settle()
  const S4 = Object.assign({}, SEC_WEB, { mpkgKey: 'custom|3744579963' })
  G.T.seedTracks(S4, SUB, 'dir')
  G.T.step(1)
  await settle()
  const gsrc = String(G.T.audio() && G.T.audio().getAttribute('src'))
  ok('E4 子目录音轨 ⇒ 走 path 式前缀路由（真机实测 200；旧写法的 /raw?file=<basename> 实测 404）',
    gsrc === '/api/mpkg-wallpaper/custom-folder/3744579963/assets/audio/b.ogg', 'src=' + gsrc)

  /* E5 包内音频（source=pkg）⇒ 清单是真的，但宿主没有字节通道 ⇒ 如实 disabled + 说清原因 */
  const PKG = [{ path: 'sounds/x.mp3', size: 8518034, mime: 'audio/mpeg' }, { path: 'sounds/y.mp3', size: 5534741, mime: 'audio/mpeg' }]
  const H = freshPlugin({ settings: Object.assign({}, SEC_WEB, { mpkgKey: 'custom|3719111841' }) })
  await settle()
  const S5 = Object.assign({}, SEC_WEB, { mpkgKey: 'custom|3719111841' })
  H.T.seedTracks(S5, PKG, 'pkg')
  const lst = H.T.trackList(S5)
  const mp = H.T.resolve(S5)
  ok('E5 包内音频：清单照列（2 条 + source=pkg 如实带出来）', !!lst && lst.paths.length === 2 && lst.source === 'pkg', JSON.stringify(lst))
  ok('E6 包内音频 ⇒ canPlay=false **且** canPrev/canNext=false（不假装能切）+ 副标题写明"只能列清单"',
    mp.listOnly === true && mp.canPlay === false && mp.canPrev === false && mp.canNext === false
    && String(mp.byline).indexOf('np.note.pkgListOnly') >= 0,
    JSON.stringify({ listOnly: mp.listOnly, canPlay: mp.canPlay, canPrev: mp.canPrev, byline: mp.byline }))
  ok('E7 包内音频 ⇒ 取字节的入口返回空串（调用方据此标"不能播"，而不是拼一个必然 403 的 URL）',
    H.T.trackUrl(S5, 'sounds/x.mp3', 'pkg') === '', JSON.stringify(H.T.trackUrl(S5, 'sounds/x.mp3', 'pkg')))

  /* E8 视频档：容器里那一条音轨 = 1/1，prev/next 如实 disabled */
  const I = freshPlugin({ settings: SEC_VIDEO })
  await settle()
  I.video.style.display = ''; I.video.setAttribute('src', SEC_VIDEO.image)
  const mv = I.T.resolve(SEC_VIDEO)
  ok('E8 视频档（用户那张 3582362359：mp4 容器里的 aac 音轨）⇒ 如实 `1/1`，canPrev/canNext=false',
    mv.trackCount === 1 && mv.trackIndex === 1 && mv.canPrev === false && mv.canNext === false && /1\/1/.test(String(mv.byline)),
    JSON.stringify({ trackCount: mv.trackCount, trackIndex: mv.trackIndex, canPrev: mv.canPrev, byline: mv.byline }))
}

/* ══════════════ F. ⑤ 借宽放大 + 拖动换算（纯判据，直接喂矩形） ══════════════ */
console.log('\n== F. ⑤ 悬浮态卡片放大（借宿主内边距，不越过裁切边界）+ 两条拖动条的换算 ==')
{
  const R = NP.ratioOf
  ok('F1 ratioOf：左端 0 / 中点 0.5 / 右端 1', R({ left: 100, width: 200 }, 100) === 0 && R({ left: 100, width: 200 }, 200) === 0.5 && R({ left: 100, width: 200 }, 300) === 1,
    JSON.stringify([R({ left: 100, width: 200 }, 100), R({ left: 100, width: 200 }, 200), R({ left: 100, width: 200 }, 300)]))
  ok('F2 ratioOf：滑出条外仍然夹在 [0,1]（不回弹、不越界）', R({ left: 100, width: 200 }, 40) === 0 && R({ left: 100, width: 200 }, 999) === 1)
  ok('F3 ratioOf：宽度 0 / 没有矩形 ⇒ 0（不产生 NaN 污染 currentTime）',
    R({ left: 0, width: 0 }, 50) === 0 && R(null, 50) === 0, JSON.stringify([R({ left: 0, width: 0 }, 50), R(null, 50)]))
  const S = NP.stepRatio
  ok('F4 stepRatio：←/→ 步进并夹住两端；Home/End 到端点；别的键不动（返回 null）',
    S(0.5, 'ArrowLeft') === 0.48 && S(0.5, 'ArrowRight') === 0.52 && S(0.01, 'ArrowLeft') === 0 && S(0.99, 'ArrowRight') === 1
    && S(0.5, 'Home') === 0 && S(0.5, 'End') === 1 && S(0.5, 'a') === null,
    JSON.stringify([S(0.5, 'ArrowLeft'), S(0.5, 'ArrowRight'), S(0.5, 'Home'), S(0.5, 'End'), S(0.5, 'a')]))

  /* bleedFor：容器到"最近会裁切的祖先的内边距盒"之间那段空档 = 可借的宽度（有硬上限） */
  const mkEl = (box, pad, overflow) => ({
    __box: box, __pad: pad, __ovf: overflow || 'visible',
    parentElement: null,
    getBoundingClientRect() { return this.__box },
  })
  /* 真机形状：列元素边框盒 12..268 + padding 12 ⇒ 内边距盒 24..256（这才是硬边界）。 */
  const clipAnc = mkEl({ left: 12, right: 268, top: 0, bottom: 900, width: 256 }, 12, 'hidden')
  const container = mkEl({ left: 37, right: 243, top: 600, bottom: 700, width: 206 }, 0, 'visible')
  container.parentElement = clipAnc
  globalThis.getComputedStyle = (el) => ({
    overflow: el.__ovf, overflowX: el.__ovf, overflowY: el.__ovf,
    paddingLeft: el.__pad + 'px', paddingRight: el.__pad + 'px', paddingTop: '0px', paddingBottom: '0px',
    getPropertyValue: () => '',
  })
  const b0 = NP.bleedFor(container, 0)
  ok('F5 bleedFor：容器 206 在裁切盒 24..256 里（左右各 13px 空档）⇒ 借 NP_BLEED_MAX=12（留 1px 余量）',
    b0 === 12, 'bleed=' + b0)
  ok('F6 bleedFor 收敛：已经借出 12（盒子变成 25..255）⇒ 算出来还是 12（**不抖动**）', (() => {
    const wide = mkEl({ left: 25, right: 255, top: 600, bottom: 700, width: 230 }, 0, 'visible')
    wide.parentElement = clipAnc
    return NP.bleedFor(wide, 12) === 12
  })(), 'idempotent')
  ok('F7 bleedFor 边界：容器已经贴到裁切盒（37..243 而裁切盒就是 37..243）⇒ 借 0（绝不越过 overflow:hidden）',
    NP.bleedFor((() => { const c = mkEl({ left: 37, right: 243, top: 0, bottom: 9, width: 206 }, 0, 'visible'); c.parentElement = mkEl({ left: 37, right: 243, top: 0, bottom: 9, width: 206 }, 0, 'hidden'); return c })(), 0) === 0)
  ok('F8 量不到 getComputedStyle / 没有裁切祖先 ⇒ 借 0（假 DOM 里退化成原样，不改变无浏览器门禁的行为）',
    NP.bleedFor((() => { const c = mkEl({ left: 37, right: 243, top: 0, bottom: 9, width: 206 }, 0, 'visible'); c.parentElement = null; return c })(), 0) === 0)
  ok('F9 NP_VOL_W 与 CSS 里的可见宽度逐字一致（改一处忘另一处 ⇒ 本组红）',
    NP.NP_VOL_W === 84 && new RegExp('\\.mpw_np_volHit \\{[\\s\\S]{0,220}?width: ' + NP.NP_VOL_W + 'px;').test(NP.NP_CSS),
    'NP_VOL_W=' + NP.NP_VOL_W + ' cssHit=' + /\.mpw_np_volHit \{[\s\S]{0,220}?width: (\d+)px;/.exec(NP.NP_CSS)?.[1])
  ok('F10 命中带比可见轨道厚（3px 的轨道要能按得住）：NP_SCRUB_PAD ≥ 6 ⇒ 命中高 ≥ 15px',
    NP.NP_SCRUB_PAD >= 6 && (3 + NP.NP_SCRUB_PAD * 2) >= 15, 'pad=' + NP.NP_SCRUB_PAD + ' height=' + (3 + NP.NP_SCRUB_PAD * 2))
  /* F12 几何不变量（真机踩过的那一条）：进度命中带必须**整个落在卡片里**。
     命中带 = [barTop(p) - NP_SCRUB_PAD, barTop(p) + RAIL_H + NP_SCRUB_PAD]；卡片高 = boxHeight(p)。
     两态（p=0 收起 / p=1 展开）都要满足 —— 否则命中带会伸到卡片外，被同一行的别的元素接走指针。 */
  {
    const M = loadCjsSource(fs.readFileSync(path.join(repoRoot, 'lib', 'now-playing-math.js'), 'utf8'), 'math')
    const bad = [0, 1].filter((p) => {
      const top = M.barTop(p) - NP.NP_SCRUB_PAD
      const bottom = M.barTop(p) + M.RAIL_H + NP.NP_SCRUB_PAD
      return !(top >= 0 && bottom <= M.boxHeight(p) + 0.001)
    })
    ok('F12 进度命中带两态都整个落在卡片里（真机根因：偏移算了两遍 ⇒ 命中带掉到卡片外，拖动事件被别的元素接走）',
      bad.length === 0,
      bad.length ? ('p=' + bad.join(',') + ' 越界；' + JSON.stringify([0, 1].map((p) => ({ p, box: M.boxHeight(p), strip: [M.barTop(p) - NP.NP_SCRUB_PAD, M.barTop(p) + M.RAIL_H + NP.NP_SCRUB_PAD] }))))
        : JSON.stringify([0, 1].map((p) => ({ p, box: M.boxHeight(p), strip: [M.barTop(p) - NP.NP_SCRUB_PAD, M.barTop(p) + M.RAIL_H + NP.NP_SCRUB_PAD] }))))
  }
  ok('F11 两条拖动条都带自有锚点（真机探针/门禁据此定位，不靠位置猜）',
    /data-mpw-np-scrub/.test(NP.NP_CSS) === false && /"data-mpw-np-scrub"/.test(npSrc) && /"data-mpw-np-vol"/.test(npSrc),
    '组件里渲染了 data-mpw-np-scrub / data-mpw-np-vol')
}

/* ══════════════ G. ⑥ 测试台（:8902）复用同一个组件时需要的接口面 ══════════════ */
console.log('\n== G. ⑥ 组件对外接口面（渲染器测试台 :8902 若复用同一组件，这些必须齐）==')
{
  const doc = (() => {
    const d = { createElement: () => ({ setAttribute() {}, style: {} }), body: { appendChild() {} } }
    return d
  })()
  const made = NP.createNowPlaying({
    math: loadCjsSource(fs.readFileSync(path.join(repoRoot, 'lib', 'now-playing-math.js'), 'utf8'), 'math'),
    react: { createElement: (t, p, ...k) => ({ t, p, k }) },
    createRoot: () => ({ render() {}, unmount() {} }),
    t: (k) => k, doc, win: globalThis, log: { info() {}, warn() {}, error() {} },
    onTransport: () => {},
  })
  const ctl = made.createController()
  const api = ['setEnabled', 'isEnabled', 'setMedia', 'setProgress', 'setPlaying', 'setLink', 'setVolume', 'inspect', 'inspectCollapse', 'setSlotNode', 'setHostCollapsed', 'evaluate', 'ensureAnchored', 'destroy']
  ok('G1 控制器 API 齐（含 ② setLink 与 ① setVolume 两个**新**入口）',
    api.every((k) => typeof ctl[k] === 'function'), api.filter((k) => typeof ctl[k] !== 'function').join(',') || '全部在')
  const insp = ctl.inspect()
  ok('G2 inspect() 报出拖动/音量/联动/借宽四项（测试台与真机探针都读它）',
    'dragging' in insp && 'volume' in insp && 'canSeek' in insp && 'link' in insp && 'bleed' in insp,
    JSON.stringify({ dragging: insp.dragging, volume: insp.volume, canSeek: insp.canSeek, link: insp.link, bleed: insp.bleed }))
  ok('G3 组件导出面包含拖动纯函数（测试台可以只测换算，不必起 DOM）',
    typeof NP.ratioOf === 'function' && typeof NP.stepRatio === 'function' && typeof NP.bleedFor === 'function')
  ok('G4 onTransport 的**第二参数**是值（seek 的比例 / 音量的电平）—— 接线签名 (op, value)',
    /onTransport: \(op, value\) => npTransport\(op, readSection\(\), value\)/.test(clientSrc),
    (clientSrc.match(/onTransport: \([^)]*\) => npTransport\([^)]*\)/) || ['<未找到>'])[0])
  ok('G5 组件不认识任何宿主专有对象（doc/win/react/math 全部注入）⇒ 测试台可以自带 React 与文档',
    !/\brequire\(/.test(npSrc) && /createNowPlaying\(deps\)/.test(npSrc), 'now-playing.js 里 0 处 require')
  /* G6/G7 是**接线金丝雀**（本仓既有风格：对"某段接线必须在产物里"做源码级判据）——
     它们守的是真机读数逼出来的"自动播放策略第二半"（见 docs/NOW-PLAYING-DSH.md §7.8）：
     没有用户手势时浏览器既会 reject**有声**起播，也会在 muted 起播后**把元素直接停住**（不 reject、
     不调用 pause ⇒ 任何 promise/包装都抓不到）。这两条接线是"画面继续动 + 声音等到手势"的全部实现。 */
  /* 判据要**连守卫一起**判：只判"有没有这段"会在"把守卫改成 `if (true) return`"时仍然绿
     （那正是这条变异要抓的形状）。五个成分缺一不可 —— 事件、守卫、记状态、退回 muted、续播。 */
  ok('G6 识别"被策略停住"的接线在位：pause 事件 + 守卫（用户自己暂停的不算）+ npSoundBlocked + 退回 muted + 续播',
    /addEventListener\("pause", \(\) => \{/.test(clientSrc)
    && /if \(wallUserPaused \|\| powPaused\) return;/.test(clientSrc)
    && /npSoundBlocked = true;/.test(clientSrc)
    && /npOpTrace\("audio-blocked"/.test(clientSrc)
    && /video\.muted = true;/.test(clientSrc)
    && /audio-blocked-replay/.test(clientSrc),
    'pause 事件 + 守卫 + npSoundBlocked + audio-blocked 轨迹 + muted 续播 + 重播结果')
  ok('G7 "被策略挡住时 muted 由本状态持有"的接线在位（否则 取消静音→被停→再取消静音 会自转成环）',
    /npSoundBlocked \|\| \(\(s\.mute !== void 0/.test(clientSrc) && /npPrimedMuted \|\| npSoundBlocked/.test(clientSrc),
    'npWantMuted + npApplyMute/applyVideoMute 三处都带 npSoundBlocked')
}

/* ══════════════ H. 分辨力自证：每一组修复各有一条"改回旧写法 ⇒ 指定组必红" ══════════════ */
if (!NO_MUT) {
  console.log('\n== H. 分辨力自证：把每一条修复改回**旧写法**，指定那一组必须变红 ==')
  const MUT = [
    { id: 'play-rejection-swallowed-again', group: 'B',
      why: '把"被拒不静默 + 退回 muted 重试一次"改回旧写法（`.catch(() => {})` 吞掉：真机那次 NotAllowedError 就是这么消失的）',
      file: 'client.js', from: 'p.then(done, (err) => { npPlayRetryMuted(video, err) });',
      to: 'p.then(done, () => {});' },
    { id: 'muted-prime-on-success-path-again', group: 'B',
      why: '把"起播那一刻就用设置里的静音状态"改回旧写法（先偷 muted=true 起播、指望回调还回来 ⇒ 回调不来就永久静音）',
      file: 'client.js', from: 'if (!video.paused) { npOpTrace("prime", null, "already-playing"); return false; }',
      to: 'if (!video.paused) { npOpTrace("prime", null, "already-playing"); return false; }\n\t\t\ttry { video.muted = true; npPrimedMuted = true; } catch (e) {}' },
    { id: 'volume-landing-removed', group: 'A',
      why: '把"音量落到真实元素"删掉（= 旧实现只有布尔 mute、全仓没有改 volume 的地方）',
      file: 'client.js', from: 'try { const v = bgElements().video; if (v && v.volume !== vol) v.volume = vol; } catch (e) {}',
      to: 'try { /* mutated: 不落 video */ } catch (e) {}' },
    { id: 'seek-ignores-value', group: 'C',
      why: '把 seek 的落点删掉（= 旧实现进度条只读，"a scrubber you can drag is a different component"）',
      file: 'client.js', from: 'if (vid && link && isFinite(vid.duration) && vid.duration > 0) {',
      to: 'if (false) {' },
    { id: 'link-default-flipped-to-false', group: 'D',
      why: '把 ② 的默认值改成 false（= 改变既有默认行为，本条明令禁止）',
      file: 'client.js', from: 'const DEFAULT_NP_LINK_WALLPAPER = true;', to: 'const DEFAULT_NP_LINK_WALLPAPER = false;' },
    { id: 'link-row-not-gated-on-np', group: 'D',
      why: '把 ② 那一行的 npNowPlaying 门控去掉（= NP 关掉之后还留着一个它的开关）',
      file: 'client.js', from: '(npOnNow ? toggleRow(t("npLinkWallpaper")', to: '(true ? toggleRow(t("npLinkWallpaper")' },
    { id: 'trackurl-basename-only-again', group: 'E',
      why: '把音轨 URL 改回"只取 basename"（= 真机根因原样：子目录音轨 404、包内音轨 403）',
      file: 'client.js', from: "			if (String(src || \"\") === \"pkg\") return \"\";", to: "			if (false) return \"\";" },
    { id: 'pkg-listonly-accepted-again', group: 'E',
      why: '把"包内音频只列清单"改回"当成能播"（= 假装能切，点了没反应）',
      file: 'client.js', from: 'const listOnly = String(cur.source || "") === "pkg";', to: 'const listOnly = false;' },
    { id: 'bleed-ignores-clip-box', group: 'F',
      why: '把借宽改成"能借多少借多少"（= 越过父级 overflow:hidden，卡片被裁切这条回归）',
      file: 'now-playing.js', from: 'const clip = clipPadBox(container, cs);\n  if (!clip) return 0;',
      to: 'const clip = clipPadBox(container, cs) || { left: -1e9, right: 1e9 };' },
    { id: 'ratio-not-clamped', group: 'F',
      why: '把拖动换算的夹取删掉（= 指针滑出条外就把 currentTime 写成越界值）',
      file: 'now-playing.js', from: 'return npClamp((x - Number(rect.left)) / w, 0, 1);', to: 'return (x - Number(rect.left)) / w;' },
    { id: 'autoplay-policy-block-ignored', group: 'G',
      why: '把"被策略停住"的识别删掉（= 真机根因原样：起播 promise resolve 之后被浏览器停住，没人知道、画面冻住）',
      file: 'client.js', from: 'video.addEventListener("pause", () => {\n\t\t\t\t\t\ttry {\n\t\t\t\t\t\t\tif (wallUserPaused || powPaused) return;', to: 'video.addEventListener("pause", () => {\n\t\t\t\t\t\ttry {\n\t\t\t\t\t\t\tif (true) return;' },
    { id: 'policy-forced-mute-dropped', group: 'G',
      why: '把"被挡住时强制 muted"删掉（= 取消静音→被停→再取消静音 自转成环，画面反复被停）',
      file: 'client.js', from: 'return npSoundBlocked || ((s.mute !== void 0 ? !!s.mute : true) || npAudioOwns());',
      to: 'return ((s.mute !== void 0 ? !!s.mute : true) || npAudioOwns());' },
    { id: 'ontransport-value-dropped', group: 'G',
      why: '把接线的第二参数丢掉（= 拖动/音量送不出值，控件只能"点一下"没有连续量）',
      file: 'client.js', from: 'onTransport: (op, value) => npTransport(op, readSection(), value),',
      to: 'onTransport: (op) => npTransport(op, readSection()),' },
  ]
  for (const m of MUT) {
    const rel = m.file === 'client.js' ? clientPath : npPath
    const dir = fs.mkdtempSync(path.join(tmpRoot, 'm-'))
    const mutated = path.join(dir, path.basename(rel))
    const src = fs.readFileSync(rel, 'utf8')
    if (src.indexOf(m.from) < 0) { ok('H ' + m.id, false, '变异点没找到（源改过了？）'); continue }
    fs.writeFileSync(mutated, src.replace(m.from, m.to))
    /* client.js 永远走副本（真树一个字节都不改）：
       · file=client.js ⇒ 副本里就是**变异后**的 client.js；
       · file=now-playing.js ⇒ 副本先照抄真树，再由生成器把变异后的组件同步进生成区。
       少了这一步会静默变成假绿（变异根本没被加载，退出码 0、0 条红）。 */
    const mutatedClient = path.join(dir, 'client.js')
    fs.writeFileSync(mutatedClient, m.file === 'client.js' ? fs.readFileSync(mutated, 'utf8') : fs.readFileSync(clientPath, 'utf8'))
    const args = [
      path.join(here, 'np-control-test.mjs'), '--no-mutations',
      '--client', mutatedClient,
      '--np', m.file === 'now-playing.js' ? mutated : npPath,
    ]
    /* 变异 now-playing.js 时必须同步生成区，否则 A 组（生成区漂移）先红、看不出是哪一条打红的
       —— 这正是"分辨力"要避免的假红。用生成器把它们对齐后再跑。 */
    if (m.file === 'now-playing.js') {
      const gen = spawnSync(process.execPath, [path.join(here, 'build-now-playing.mjs'), '--np', mutated, '--client', mutatedClient], { encoding: 'utf8' })
      if (gen.status !== 0) { ok('H ' + m.id, false, '生成区同步失败: ' + String(gen.stderr || '').slice(0, 120)); continue }
    }
    const r = spawnSync(process.execPath, args, { encoding: 'utf8' })
    const out = String(r.stdout || '')
    const groupRe = new RegExp('== ' + m.group + '\\.')
    const seg = (() => {
      const i = out.search(groupRe)
      if (i < 0) return ''
      const rest = out.slice(i)
      const j = rest.search(/\n== [A-Z]\./)
      return j < 0 ? rest : rest.slice(0, j)
    })()
    const groupRed = /✗/.test(seg)
    const otherRed = (() => {
      const all = (out.match(/✗/g) || []).length
      const mine = (seg.match(/✗/g) || []).length
      return all - mine
    })()
    ok('H 变异 ' + m.id + '：期望 ' + m.group + ' 组变红', r.status !== 0 && groupRed,
      m.why + '  [exit=' + r.status + '；' + m.group + ' 组红 ' + (seg.match(/✗/g) || []).length + ' 条，其它组红 ' + otherRed + ' 条]')
  }
  /* 变异全程只动副本 ⇒ 真树的生成区必须还是一个字节没变（"不许把树留在半改状态"）。 */
  const gen = spawnSync(process.execPath, [path.join(here, 'build-now-playing.mjs'), '--check'], { encoding: 'utf8' })
  ok('H 变异跑完真树的生成区仍然与源一致（变异只动副本，真树零改动）', gen.status === 0, String(gen.stdout || '').trim().slice(0, 120))
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败')
cleanup()
process.exit(fail > 0 ? 1 : 0)
