// bench-bandfeed-switch-test.mjs — 测试台工具条「音条源」四档（壁纸 / 麦克风 / 模拟 / 关）**接线门禁**
//
// 判据来源：`../docs/USER-ITEMS-20260920-B.md` §5.3（原文四条，逐条钉住）——
//   ① 静音 / 无源档 ⇒ 渲染器 `source='silent'` 且音条层顶点色的**输入**（128 元数组与交给渲染器的
//      16 段活视图）全 0 —— 如实，不假装有声音；
//   ② `?bandfeed=sim` ⇒ 非 0（形态可见）；
//   ③ `?bandfeed=mic` 且拒绝授权 ⇒ 仍 `silent`，且**不弹第二次**（`getUserMedia` 恰好一次）；
//   ④ 任何档都**不许**为音条自动播放包内音频（不"莫名出声"）。
//
// 三段：
//   A 真源码切片驱动：把 `demo.html` 的 `MPW-BANDFEED` 块（+ `MPW-AUDIOBUFFERS` 块）切出来，
//     注入桩（假 analyser / 假麦克风 / 假 window.parent / 计数用媒体元素）跑**真实分支**
//     —— 与既有 `tests/audio-band-wiring-test.mjs` 同一手法（那一项已用同一段源码跑 T3/T6，
//     本项不重复它的模块级契约断言，只钉"四档开关 + 四条判据"）。
//   B 接线：工具条四档 → URL 参数映射（真纯函数 `bandFeedUrl`）、默认档 = `auto`、
//     `mic` 档没被任何自动路径打开（渲染器侧 auto 档不请求；本批代码不代勾闸门 / 不调 getUserMedia）、
//     状态行在静音与非静音两态下文案不同（真纯函数 `bandFeedStatusPlan` + DOM 挂点静态断言）。
//   C 分辨力自证：四组"改回旧写法 / 改坏"的变异（内存切片 + /tmp 副本，真树只读），
//     对应断言必须**变红**（绿色运行也打印 RED 行）。
//
// 诚实边界（写在这里，免得被当成"全都验过了"）：
//   · 无浏览器 ⇒ **不测**真实权限框弹几次、也不测屏幕上真实的顶点色 —— 这里测的是"喂给顶点色的
//     数据全 0 / 非 0"与"请求次数恰好一次"（`getUserMedia` 调用计数）。
//   · 真机上"拒绝授权"那条链（浏览器权限框 → NotAllowedError）只做了**桩级**驱动；真机读数在
//     `tests/bench-ui-headless-test.mjs`（那一条另跑 headless firefox）。
//
// 运行：node tests/bench-bandfeed-switch-test.mjs   （全过输出 ALL PASS，退出码 0）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  packBands, simulatedBandArray, bandStats, shapeBand, AUDIO_BAND_LEN, AUDIO_BAND_HALF,
  createLiveBands, writeLiveBands, AUDIO_RESPONSE_BANDS,
} from '../core/audio-band-array.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let failed = 0
let passed = 0
const ok = (cond, label, detail) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + label + (detail ? '  ' + detail : ''))
  if (cond) passed++; else failed++
}

const HTML = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8')
const INDEX = fs.readFileSync(path.join(ROOT, 'demo/index.html'), 'utf8')
const PATCH_PATH = path.join(ROOT, 'demo/bench-patch.js')
const PATCH = fs.readFileSync(PATCH_PATH, 'utf8')
const P = await import(pathToFileURL(PATCH_PATH).href)

function slice(src, begin, end) {
  const i = src.indexOf(begin)
  if (i < 0) throw new Error('切片起点缺失: ' + begin)
  const j = src.indexOf(end, i)
  if (j < 0) throw new Error('切片终点缺失: ' + end)
  return src.slice(i, j + end.length)
}
const BAND_BLOCK = slice(HTML, '// ═══ MPW-BANDFEED-BEGIN', '// ═══ MPW-BANDFEED-END ═══')
const BUF_BLOCK = slice(HTML, '// ═══ MPW-AUDIOBUFFERS-BEGIN', '// ═══ MPW-AUDIOBUFFERS-END ═══')

/** 真实来源计数：桩媒体元素（判据④：任何档都不许有人去 `play()` 它们）。 */
const playLog = []
const mediaEl = () => ({ play: () => { playLog.push(1); return Promise.resolve() }, paused: true, volume: 1, muted: false })
const denyErr = () => { const e = new Error('denied by user'); e.name = 'NotAllowedError'; return e }
function fakeAnalyser(values, binCount) {
  const bins = binCount || values.length
  return {
    frequencyBinCount: bins,
    getByteFrequencyData(target) { for (let i = 0; i < bins; i++) target[i] = (values[i % values.length] || 0) & 255 },
  }
}

/** 桩环境：真源码切片（BANDFEED + AUDIOBUFFERS）拼接后用 `new Function` 注入依赖。 */
function makeEnv(opts = {}) {
  const logs = []
  const bandCalls = []
  const win = { parent: null, __mpwAudioBands: null, __mpwAudioBandSource: null, __mpwAudioBandReason: null }
  win.parent = win                                            // 顶层页面：parent === window（不发宿主消息）
  let gumCalls = 0
  if (opts.mic || opts.micPermission) {
    win.navigator = {
      mediaDevices: {
        getUserMedia: () => {
          gumCalls++
          if (opts.mic === 'deny') return Promise.reject(denyErr())
          if (opts.mic === 'throw') throw denyErr()
          return Promise.resolve({ id: 'stream' })
        },
      },
      permissions: { query: () => Promise.resolve({ state: opts.micPermission || 'prompt' }) },
    }
  }
  const micAnalyser = fakeAnalyser(new Array(64).fill(128), 128)
  win.AudioContext = function FakeAC() {
    this.createAnalyser = () => micAnalyser
    this.createMediaStreamSource = () => ({ connect: () => {} })
  }
  win.webkitAudioContext = win.AudioContext
  const analyser = opts.analyser || null
  const sceneAudio = {
    ctx: null, analyser, els: [mediaEl(), mediaEl()],
    freq: analyser ? new Uint8Array(analyser.frequencyBinCount) : null,
    started: !!analyser, vols: [],
  }
  const lib = {
    setAudioBands: (v) => { bandCalls.push(v); return v },
    audioBandsInfo: () => ({ mode: 'auto', hasView: bandCalls.length > 0 }),
  }
  const body = (opts.block || BAND_BLOCK) + '\n' + BUF_BLOCK + `
return { BANDFEED, bandArrayNow, bandFrameTick, audioBuffers, last: () => bandLast, mic: () => bandMic,
         band16: () => bandView16, bandMicStart, silentLogged: () => bandSilentLogged }`
  const fn = new Function(
    'packBands', 'simulatedBandArray', 'bandStats', 'shapeBand', 'AUDIO_BAND_LEN', 'AUDIO_BAND_HALF',
    'createLiveBands', 'writeLiveBands', 'AUDIO_RESPONSE_BANDS', 'lib',
    'sceneAudio', 'location', 'window', 'logf', 'AudioContext', body,
  )
  const api = fn(packBands, simulatedBandArray, bandStats, shapeBand, AUDIO_BAND_LEN, AUDIO_BAND_HALF,
    createLiveBands, writeLiveBands, AUDIO_RESPONSE_BANDS, lib, sceneAudio,
    { search: opts.search || '' }, win, (m) => logs.push(m), win.AudioContext)
  return { api, win, logs, bandCalls, sceneAudio, gum: () => gumCalls }
}
const flush = () => new Promise((r) => setTimeout(r, 0))
/** 128 元全 0？（"顶点色的输入全 0"的机械判据） */
const allZero = (arr) => Array.from(arr).every((v) => v === 0)
/** 交给渲染器的 16 段活视图（`audioprocessing*` / `g_AudioSpectrum*` 的唯一数据入口） */
const viewZero = (v) => !!v && allZero(v.left) && allZero(v.right) && allZero(v.average)

console.log('\n== A 真源码切片：四条判据（?bandfeed= 四档）==')
{
  // ── 判据① 静音 / 无源档 ⇒ silent 且全 0（auto 缺省档；渲染器既有口径） ──
  /* ★2026-09-24 任务 ⑫ **契约变更（auto 无源）**：旧语义（钉死提交 151ce0a 的 demo.html 同一分支，
     见 `git show 151ce0a:demo.html` 的 `bandArrayNow`）是"全 0 + source='silent'"；现改为
     **按时间驱动的占位频谱**（上游 oneincase/webwallgl 的 `createSimulatedAudio` 同款），
     理由 = 用户「没有数据源但音条确实是在动的」+ 全 0 会让作者 shader 的音条高度退化
     （`smoothstep(0,0,0)` 除零 ⇒ 本机不画 / 部分驱动整层白色实心块）。"只要真实源"的档
     （`?bandfeed=real|mic`）仍保持"全 0 + silent"，见下面 A1b。 */
  const eAuto = makeEnv({})
  eAuto.api.bandFrameTick(0.5); eAuto.api.bandFrameTick(0.6)
  const autoStats = bandStats(eAuto.api.last().bands)
  ok(eAuto.api.BANDFEED === 'auto' && eAuto.api.last().source === 'simulated' && autoStats.silent === false,
    'A1 ①缺省档 auto 且没有数据源 ⇒ `source=simulated`（**占位**：按时间驱动的频谱，不是真实音频）',
    `feed=${eAuto.api.BANDFEED} source=${eAuto.api.last().source} reason=${eAuto.api.last().reason}`)
  ok(allZero(eAuto.api.last().bands) === false && eAuto.win.__mpwAudioBandSource === 'simulated' && eAuto.api.last().placeholder === true,
    'A1 ①占位频谱**非全 0** 且 `placeholder=true`（可观测面 `__mpwAudioBandSource="simulated"`；不冒充真实源）',
    `peak=${autoStats.peak} reason=${eAuto.api.last().reason}`)
  ok(viewZero(eAuto.api.band16()) === false && eAuto.api.band16().hasSource === true,
    'A1 ①喂给音条层的 16 段活视图**非 0 + hasSource=true**（顶点色的输入真的在动；屏幕像素不在此项测）',
    `kind=${eAuto.api.band16().kind}`)
  // A1b「只要真实源」档仍是"如实全 0"（占位不会污染它）
  const eReal = makeEnv({ search: '?bandfeed=real' })
  eReal.api.bandFrameTick(0.5)
  const realStats = bandStats(eReal.api.last().bands)
  ok(eReal.api.last().source === 'silent' && allZero(eReal.api.last().bands) && realStats.silent === true,
    'A1b `?bandfeed=real`（只认真实源）无源 ⇒ **仍是全 0 + silent**（占位不越权；旧语义在这条档上原样保留）',
    `source=${eReal.api.last().source} peak=${realStats.peak}`)
  const eOff = makeEnv({ search: '?bandfeed=off' })
  eOff.api.bandFrameTick(0.5)
  ok(eOff.api.last().source === 'off' && allZero(eOff.api.last().bands) && eOff.bandCalls.length === 0,
    "A1 ①「关」档：source='off'、数组全 0、**一次都不注入**渲染器（逐位回到旧行为）",
    `source=${eOff.api.last().source} calls=${eOff.bandCalls.length}`)

  // ── 判据② sim ⇒ 非 0（形态可见） ──
  const eSim = makeEnv({ search: '?bandfeed=sim' })
  eSim.api.bandFrameTick(1.25)
  const simStats = bandStats(eSim.api.last().bands)
  ok(eSim.api.last().source === 'simulated' && simStats.silent === false && simStats.peak > 0.3,
    'A2 ②`?bandfeed=sim` ⇒ 非 0（`silent=false` 且峰值有量级）⇒ 音条形态可见', `peak=${simStats.peak.toFixed(4)}`)
  ok(viewZero(eSim.api.band16()) === false && eSim.api.band16().hasSource === true,
    'A2 ②模拟档的 16 段活视图非 0 且 `hasSource=true`（顶点色的输入真的在动）', `kind=${eSim.api.band16().kind}`)

  // ── 判据③ mic 且拒绝授权 ⇒ 仍 silent 且**不弹第二次** ──
  const eMic = makeEnv({ search: '?bandfeed=mic', mic: 'deny' })
  ok(eMic.api.BANDFEED === 'mic' && eMic.gum() === 1,
    'A3 ③显式 mic 档 ⇒ 请求麦克风**恰好一次**（渲染器侧入口）', `getUserMedia=${eMic.gum()}`)
  await flush()
  ok(eMic.api.mic().status === 'denied', 'A3 ③拒绝授权 ⇒ 麦克风状态如实记为 denied', eMic.api.mic().status)
  for (const t of [0.4, 0.8, 1.2, 1.6]) eMic.api.bandFrameTick(t)          // 多帧不许再弹
  const micStats = bandStats(eMic.api.last().bands)
  ok(eMic.api.last().source === 'silent' && allZero(eMic.api.last().bands) && micStats.silent === true,
    'A3 ③拒绝授权后**仍是 silent 且全 0**（不拿上一次/别人的数据冒充）', `reason=${eMic.api.last().reason}`)
  ok(String(eMic.api.last().reason).startsWith('mic-') && eMic.gum() === 1,
    'A3 ③逐帧不再请求（`getUserMedia` 仍是 1 次）⇒ "不弹第二次"在渲染器侧成立', `calls=${eMic.gum()}`)
  ok(eMic.api.bandMicStart('再次请求（门禁探针）') === false && eMic.gum() === 1,
    'A3 ③直接再叫一次入口也被守卫挡回（`analyser||pending` 守卫）⇒ 第二次连原函数都不调', `calls=${eMic.gum()}`)
  // auto 档**不弹权限框**：浏览器报"未决定"时一次都不请求（缺省档不许自动开麦克风）
  const eAutoMic = makeEnv({ micPermission: 'prompt' })
  await flush(); eAutoMic.api.bandFrameTick(0.5)
  ok(eAutoMic.api.BANDFEED === 'auto' && eAutoMic.gum() === 0 && eAutoMic.api.mic().status === 'idle',
    'A3 ③缺省档 auto 在"未授权/未决定"时**一次都不请求**麦克风（不弹权限框）', `calls=${eAutoMic.gum()}`)

  // ── 判据④ 任何档都不许自动播放包内音频 ──
  const before = playLog.length
  for (const s of ['', '?bandfeed=auto', '?bandfeed=sim', '?bandfeed=real', '?bandfeed=mic', '?bandfeed=off']) {
    const e = makeEnv({ search: s, analyser: fakeAnalyser(new Array(64).fill(60), 128), mic: 'deny' })
    e.api.bandFrameTick(0.5); e.api.bandFrameTick(1.0)
    await flush()
  }
  ok(playLog.length === before,
    'A4 ④渲染器侧：六种档位（含缺省/模拟/真实源在场）跑完，桩媒体元素的 `play()` 调用数 = 0',
    `play()=${playLog.length - before}`)
  ok(!/\.play\s*\(/.test(BAND_BLOCK) && !/\bplay\s*\(/.test(BUF_BLOCK),
    'A4 ④源码级：MPW-BANDFEED / MPW-AUDIOBUFFERS 两块里**没有** `play(` 调用点（"为了拿数据去 play 用户的音频"从构造上不存在）')
}

console.log('\n== B 接线：工具条四档 → 渲染器 URL / 默认档 / 闸门 / 状态行 ==')
{
  // ── B1 四档 → URL 参数映射（真纯函数） ──
  const base = '/WEwebLoader/renderer/index.html?type=scene&src=abc&_t=17'
  const want = { auto: 'bandfeed=auto', mic: 'bandfeed=mic', sim: 'bandfeed=sim', off: 'bandfeed=off' }
  const bad = []
  for (const m of P.BAND_FEED_MODES) {
    const u = P.bandFeedUrl(base, m)
    if (!u.includes('?' + want[m]) && !u.includes('&' + want[m])) bad.push(m + '→' + u)
    if (!u.startsWith(base + '&')) bad.push(m + ' 弄坏了原有查询串：' + u)
  }
  ok(bad.length === 0, 'B1 四个档位各自映射到 `?bandfeed=<mode>`，且原有查询串一字不动', bad.join(' | ') || P.BAND_FEED_MODES.map((m) => P.bandFeedUrl(base, m).split('&').pop()).join(' '))
  ok(P.bandFeedUrl(base + '&bandfeed=sim', 'off') === base + '&bandfeed=off',
    'B1 换档**替换**同名参数（不叠加成两个 bandfeed）', P.bandFeedUrl(base + '&bandfeed=sim', 'off'))
  /* ②(P-228f 2026-10-05) 包内音轨 opt-in：scene 档 + 壁纸档（auto/real）才写 `?audio=1`；
     麦克风/模拟/关都不写（不建媒体元素、不漏音）；web/video 档一个字都不动。 */
  {
    const scene = '/webloader/?type=scene&src=abc&_t=1'
    const hasAudio = (u) => /[?&]audio=1/i.test(u)
    ok(hasAudio(P.audioOptInUrl(scene, P.bandFeedWantsPackageAudio('auto'))) &&
      hasAudio(P.audioOptInUrl(scene, P.bandFeedWantsPackageAudio('real'))) &&
      !hasAudio(P.audioOptInUrl(scene, P.bandFeedWantsPackageAudio('mic'))) &&
      !hasAudio(P.audioOptInUrl(scene, P.bandFeedWantsPackageAudio('sim'))) &&
      !hasAudio(P.audioOptInUrl(scene, P.bandFeedWantsPackageAudio('off'))),
      'B1b ② 包内音轨 opt-in：壁纸档（auto/real）写 `?audio=1`，麦克风/模拟/关不写')
    ok(P.audioOptInUrl('/webloader/?type=web&src=x', true) === '/webloader/?type=web&src=x' &&
      P.audioOptInUrl('https://example.com/x.html?type=scene', true) === 'https://example.com/x.html?type=scene',
      'B1b ② 只对 scene 档 + 两种渲染器入口生效（web 档与外链原样返回）')
    ok(!/[?&]audio=/i.test(P.audioOptInUrl(scene + '&audio=1', false)) &&
      /[?&]audio=1/i.test(P.audioOptInUrl(scene + '&audio=0', true)),
      'B1b ② 换档**替换**同名参数（不叠加、不留旧值）')
  }
  const foreign = 'https://example.com/rendererless/page.html?a=1'
  ok(P.bandFeedUrl(foreign, 'mic') === foreign && P.bandFeedUrl('', 'mic') === '',
    'B1 非渲染器入口 URL（外链 / 空串）原样返回 —— 这条改写碰不到别的东西')

  // ── B2 默认档 = auto（且 HTML 与真函数一致） ──
  const optBlock = (INDEX.match(/<select id="bandfeed">([\s\S]*?)<\/select>/) || [])[1] || ''
  const opts = [...optBlock.matchAll(/<option value="([^"]+)"([^>]*)>/g)].map((x) => ({ v: x[1], attrs: x[2] }))
  const selOpts = opts.filter((o) => /\bselected\b/.test(o.attrs)).map((o) => o.v)
  ok(opts.map((o) => o.v).join(',') === 'auto,mic,sim,off',
    'B2 工具条 `#bandfeed` 恰好四档且顺序 = 壁纸/麦克风/模拟/关（auto/mic/sim/off）', opts.map((o) => o.v).join(','))
  ok(selOpts.length === 1 && selOpts[0] === 'auto',
    'B2 ②**默认档 = auto（壁纸）**：HTML 里只有 `auto` 带 `selected`（不许默认麦克风）', selOpts.join('|'))
  ok(P.BAND_FEED_DEFAULT === 'auto' && P.bandFeedMode(undefined) === 'auto' && P.bandFeedMode('') === 'auto' &&
    P.bandFeedMode('banana') === 'auto' && P.bandFeedMode('MIC') === 'mic',
    'B2 真函数口径一致：缺省/空/非法值回落 `auto`（不静默落 `off`），大小写混写仍认档')
  ok(/#bandfeed/.test(PATCH) && /installBandFeedSrcHook\(/.test(PATCH) && /bandFeedMode\(/.test(PATCH),
    'B2 接线在真源码里：`#bandfeed` / `installBandFeedSrcHook` / `bandFeedMode` 都被 init 路径引用（不是只导出不接线）')
  // 接线是**行为**而非静态：用假原型驱动真 `installBandFeedSrcHook`（与浏览器同一段代码）
  {
    const store = new WeakMap()
    function FakeFrame() {}
    Object.defineProperty(FakeFrame.prototype, 'src', {
      configurable: true,
      get() { return store.get(this) || '' },
      set(v) { store.set(this, String(v)) },
    })
    let mode = 'auto'
    const installed = P.installBandFeedSrcHook(FakeFrame.prototype, () => mode)
    const frame = new FakeFrame()
    frame.src = '/wallpaper-engine-webgl/renderer/index.html?type=scene&src=abc&_t=1'
    const atAuto = frame.src
    mode = 'sim'
    frame.src = '/wallpaper-engine-webgl/renderer/index.html?type=scene&src=abc&_t=2'
    const atSim = frame.src
    mode = 'off'
    frame.src = '/wallpaper-engine-webgl/renderer/index.html?type=scene&src=abc&_t=3'
    const atOff = frame.src
    ok(installed === true && /[?&]bandfeed=auto/.test(atAuto) && /[?&]bandfeed=sim/.test(atSim) && /[?&]bandfeed=off/.test(atOff) &&
      !/bandfeed=sim/.test(atOff) && (atOff.match(/bandfeed=/g) || []).length === 1,
      'B2 行为级：装了 hook 的 iframe `src` 每次写入都带上**当时**的档位（缺省 auto / 换档 sim / 换档 off），且只有一个 bandfeed 参数',
      `${atAuto.split('?')[1]} | ${atSim.split('&').pop()} | ${atOff.split('&').pop()}`)
    const foreign = new FakeFrame()
    P.installBandFeedSrcHook(FakeFrame.prototype, () => 'mic')          // 幂等：第二次不再包（否则会出现两个参数）
    foreign.src = 'https://example.com/not-renderer/index.html?a=1'
    const plain = new FakeFrame()
    plain.src = 'https://example.com/other/page.html?a=1'
    ok(foreign.src === 'https://example.com/not-renderer/index.html?a=1' &&
      plain.src === 'https://example.com/other/page.html?a=1' &&
      P.installBandFeedSrcHook(null, () => 'mic') === false,
      'B2 行为级边界：整段路径不是渲染器入口（含 `not-renderer/index.html` 这种同名尾巴）一字不改；没有可包装的原型返回 false 静默降级')
  }

  // ── B3 mic 档没被任何自动路径打开 ──
  // 切片终点(2026-09-21)：音条源接线块之后**新插入**了「渲染器来源」接线块（同一条 iframe src 链的
  //   另一个档位）。终点锚点因此从 `// ── ⑧` 移到新块的起始注释 —— 切出来的仍是**同一段**音条源代码，
  //   B3 的三条负向断言（不调 getUserMedia / 不代勾闸门 / 不碰 audio=1）口径一字未改，只是边界跟着挪。
  const bandSec = slice(PATCH, '  /* ── ⑩(2026-09-21 · 台账 ../docs/USER-ITEMS-20260920-B.md §5.3)', '  /* ── ⑪(2026-09-21) **渲染器来源两档**')
  // 负向断言必须先在**剥掉注释**的文本上做：本段注释里刻意引用了 `getUserMedia` 当反例
  // （说明"闸门会拒绝它"），不剥注释就会自己把自己判红（与 bench-shell-fixes 同一口径）。
  const bandCode = bandSec.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ')
  ok(!/getUserMedia/.test(bandCode) && !/\.checked\s*=\s*true/.test(bandCode),
    'B3 本批代码**不调** `getUserMedia`、也**不代勾**「启用麦克风」（mic 只能由用户显式勾闸门打开）')
  const micBox = (INDEX.match(/<label class="check" id="mic-box"[\s\S]*?<\/label>/) || [])[0] || ''
  ok(/id="mic-enable"/.test(micBox) && !/\bchecked\b/.test(micBox.replace(/data-i18n[^>]*/, '')),
    'B3 静态：`#mic-enable` 仍然**没有** checked（默认关），mic 档不会因为选了下拉就被打开')
  ok(/micEl\.checked\s*&&\s*bandFeedNow\(\) === 'mic'/.test(PATCH) && !/bandFeedNow\(\) === 'mic'[\s\S]{0,120}micEl\.checked\s*=/.test(PATCH),
    'B3 只有"闸门**本来就开着**且当前是 mic 档"才补一次重挂载（反向：选档不反向改闸门）')
  ok(/const remounted = remountRendererForBandFeed\(\)/.test(PATCH) &&
    /if \(!remounted\) logLine\(t\(curLang, 'log\.bandfeedNoMount'\), true\)/.test(PATCH) &&
    !!P.DICT.zh['log.bandfeedNoMount'] && !!P.DICT.en['log.bandfeedNoMount'],
    'B3 换档后**如实报告有没有真的重挂载**（产物 `Ae()` 在没有已挂载壁纸时会直接返回 ⇒ 不许装作已生效；真机实测过这条分支）')
  ok(!/audio=1/.test(bandSec) && P.bandFeedUrl(base, 'mic').indexOf('audio=1') < 0,
    'B3 音条源接线不碰 `audio=1`（不会顺手把包内音轨拉起来）')

  // ── B4 状态行：静音与非静音两态文案不同（真纯函数）+ DOM 挂点 ──
  const stSilent = P.bandFeedStatusPlan('zh', { feed: 'auto', source: 'silent', reason: 'no-source（?audio=1 的包内音轨 / ?bandfeed=mic 的麦克风都没有）' })
  const stMic = P.bandFeedStatusPlan('zh', { feed: 'mic', source: 'mic', reason: null })
  const stSim = P.bandFeedStatusPlan('zh', { feed: 'sim', source: 'simulated', reason: null })
  const stTrk = P.bandFeedStatusPlan('zh', { feed: 'auto', source: 'analyser', reason: null })
  ok(stSilent.kind === 'silent' && stSilent.silent === true && /音条无数据/.test(stSilent.text) &&
    /麦克风/.test(stSilent.text) && /模拟/.test(stSilent.text),
    'B4 ③静音态写**明确原因 + 两条出路**（"该壁纸没有音源或已静音 —— 可切「麦克风」或「模拟」"）', stSilent.text)
  ok(stSilent.text !== stMic.text && stSilent.text !== stSim.text && stSilent.text !== stTrk.text &&
    stMic.kind === 'live' && stSim.kind === 'live' && stTrk.kind === 'live',
    'B4 静音与非静音两态文案**不同**；非静音态写源类型（包内音轨 / 麦克风 / 模拟）',
    [stTrk.text, stMic.text, stSim.text].join(' | '))
  ok(/包内音轨/.test(stTrk.text) && /麦克风/.test(stMic.text) && /模拟/.test(stSim.text),
    'B4 三种真实源的文案可区分（不会一律写"有数据"）')
  const stGate = P.bandFeedStatusPlan('zh', { feed: 'mic', source: 'silent', reason: 'mic-denied', mic: 'denied' }, { micGateOpen: false })
  const stDenied = P.bandFeedStatusPlan('zh', { feed: 'mic', source: 'silent', reason: 'mic-denied', mic: 'denied' }, { micGateOpen: true })
  ok(/启用麦克风/.test(stGate.text) && /不会请求麦克风/.test(stGate.text) &&
    /授权被拒绝/.test(stDenied.text) && stGate.text !== stDenied.text,
    'B4 ③mic 档静音时区分"闸门没开（一次都不会请求）"与"浏览器拒绝授权"（两态文案不同）',
    stGate.text.slice(-40) + ' || ' + stDenied.text.slice(-40))
  // 第三种状态（本轮实测发现）：测试台今天嵌入的是**产物页**（`demo/renderer/index.html`，不认 `?bandfeed=`）
  // ⇒ 渲染器文档已就绪却什么都不回报时，**不许**一直写"等待渲染器回报"（用户会等一个永不到来的状态）。
  const stIdle = P.bandFeedStatusPlan('zh', null, { rendererReady: false })
  const stNoReport = P.bandFeedStatusPlan('zh', null, { rendererReady: true, feed: 'sim' })
  ok(stIdle.kind === 'idle' && /等待渲染器回报/.test(stIdle.text) && stNoReport.kind === 'unsupported' &&
    /没有回报音条数据源/.test(stNoReport.text) && /模拟/.test(stNoReport.text) && stNoReport.text !== stIdle.text,
    'B4 ③第三种状态（诚实）：渲染器已就绪但没回报 ⇒ 明说"这个渲染器不认 ?bandfeed="并带上当前档位',
    stNoReport.text.slice(0, 46))
  ok(/function bandRendererReady\(\)/.test(PATCH) && /rendererReady: bandRendererReady\(\)/.test(PATCH),
    'B4 "已就绪但没回报"的判定在运行期真的接上了（不是只定义了一个永不进入的分支）')
  /*  ①(2026-10-11 用户第 3 条「去掉调试模式旁边的两项」) `#status-bandfeed` 这个**状态片**已从 UI 移除
      （`demo/index.html` 里不再有它）⇒ 本判据的口径从"页面上有这一行"改成"**读数有稳定入口**"：
      `__benchPatch.bandFeedStatus()` 返回的就是 `bandFeedStatusPlan()` 的同一个计划对象（text/kind/source/
      mode 一个不少），门禁与真机排查读同一份 ⇒ 强度不降（原来读 DOM 的 `data-mpw-*`，现在读计划本身）。 */
  ok(!/id="status-bandfeed"/.test(INDEX) &&
    /bandFeedStatus: \(\) => paintBandFeedStatus\(\)/.test(PATCH),
    'B4 ①状态片已按用户要求从 UI 移除（index.html 无 #status-bandfeed）⇒ 读数入口 = `__benchPatch.bandFeedStatus()` 探针（形状不变：text/kind/source/mode）')
  ok(/el\.textContent = plan\.text/.test(PATCH) && /data-mpw-bandfeed-status/.test(PATCH) &&
    /data-mpw-bandfeed-source/.test(PATCH),
    'B4 运行期确实把计划写进状态行（逻辑保留：节点在时照写；节点不在时探针照样返回同一份计划）')
  const repaints = (PATCH.match(/paintBandFeedStatus\(\)/g) || []).length
  ok(repaints >= 4 && /frameEl\.addEventListener\('load'[\s\S]{0,400}paintBandFeedStatus\(\)/.test(PATCH) &&
    /try \{ paintBandFeedStatus\(\) \} catch \{ \/\* 状态行是只读呈现 \*\/ \}/.test(PATCH),
    'B4 状态行复用**既有**路径重画（init + iframe load + 既有轮询 + 语言切换），不另起一套轮询',
    `paintBandFeedStatus() 出现 ${repaints} 处`)
  // i18n：两语对齐 + HTML 里用到的键都在
  const usedKeys = ['toolbar.bandfeed', 'toolbar.bandfeedTip', 'bandfeed.wallpaper', 'bandfeed.mic', 'bandfeed.sim', 'bandfeed.off']
  const miss = usedKeys.filter((k) => !P.DICT.zh[k] || !P.DICT.en[k])
  const zh = Object.keys(P.DICT.zh), en = Object.keys(P.DICT.en)
  ok(miss.length === 0 && zh.filter((k) => !en.includes(k)).length === 0 && en.filter((k) => !zh.includes(k)).length === 0,
    'B4 i18n：四档与状态行用到的键中英**两边都有**（缺一边会退化成键名原文）', miss.join(',') || 'zh/en 键集合相等')
  ok(/data-i18n="toolbar\.bandfeed"/.test(INDEX) && /data-i18n-title="toolbar\.bandfeedTip"/.test(INDEX) &&
    (optBlock.match(/data-i18n="bandfeed\./g) || []).length === 4,
    'B4 文案走 i18n：HTML 里 `data-i18n` / `data-i18n-title` 都在（选项四条各带一条键）')
}

console.log('\n== C 分辨力自证：改回旧写法 / 改坏 ⇒ 对应断言必须变红 ==')
{
  // 判据函数（真树跑绿、变异体跑红用**同一份**代码；口径不复制）
  const cDefault = (html, api) => {
    const blk = (html.match(/<select id="bandfeed">([\s\S]*?)<\/select>/) || [])[1] || ''
    const sel = [...blk.matchAll(/<option value="([^"]+)"([^>]*)>/g)].filter((x) => /\bselected\b/.test(x[2])).map((x) => x[1])
    return { pass: sel.length === 1 && sel[0] === 'auto' && api.BAND_FEED_DEFAULT === 'auto' && api.bandFeedMode('') === 'auto',
      detail: `selected=${sel.join('|')} default=${api.BAND_FEED_DEFAULT}` }
  }
  const cUrl = (api) => {
    const u = api.bandFeedUrl('/WEwebLoader/renderer/index.html?_t=1', 'auto')
    return { pass: /[?&]bandfeed=auto/.test(u), detail: u }
  }
  const cSilentText = (api) => {
    const s = api.bandFeedStatusPlan('zh', { feed: 'auto', source: 'silent', reason: 'no-source（x）' })
    const l = api.bandFeedStatusPlan('zh', { feed: 'auto', source: 'analyser', reason: null })
    return { pass: s.kind === 'silent' && /音条无数据/.test(s.text) && s.text !== l.text, detail: s.text.slice(0, 28) }
  }
  const cNoPlay = (block, playFrom) => {
    playLog.length = 0
    const e = makeEnv({ block, search: '?bandfeed=auto', analyser: fakeAnalyser(new Array(64).fill(60), 128) })
    e.api.bandFrameTick(0.5)
    return { pass: playLog.length === playFrom && !/\.play\s*\(/.test(block), detail: `play()=${playLog.length - playFrom}` }
  }
  const cHook = (api) => {
    const store = new WeakMap()
    function F() {}
    Object.defineProperty(F.prototype, 'src', {
      configurable: true,
      get() { return store.get(this) || '' },
      set(v) { store.set(this, String(v)) },
    })
    const inst = api.installBandFeedSrcHook(F.prototype, () => 'sim')
    const el = new F()
    el.src = '/WEwebLoader/renderer/index.html?_t=1'
    return { pass: inst === true && /[?&]bandfeed=sim/.test(el.src), detail: el.src }
  }
  /** 第三种状态：渲染器已就绪但没回报 ⇒ 必须与"还在路上"不同（不许一直写"等待渲染器回报"）。 */
  const cNoReport = (api) => {
    const idle = api.bandFeedStatusPlan('zh', null, { rendererReady: false })
    const none = api.bandFeedStatusPlan('zh', null, { rendererReady: true, feed: 'sim' })
    return { pass: none.kind === 'unsupported' && none.text !== idle.text && /模拟/.test(none.text), detail: none.text.slice(0, 34) }
  }

  // 先自证：未变异时这几条判据在本测试里是**绿**的（否则"变异变红"没有意义）
  ok(cDefault(INDEX, P).pass && cUrl(P).pass && cSilentText(P).pass && cNoPlay(BAND_BLOCK, 0).pass &&
    cHook(P).pass && cNoReport(P).pass,
    'C0 六组判据在真树上都是绿的（变异前先自证，免得"红的原因不是变异"）')

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-bandfeed-'))
  const fixImports = (t) => t
    .replace("from './mpw-select.js'", "from '" + pathToFileURL(path.join(ROOT, 'demo/mpw-select.js')).href + "'")
    .replace("from './mpw-select-math.mjs'", "from '" + pathToFileURL(path.join(ROOT, 'demo/mpw-select-math.mjs')).href + "'")
  const importMutant = async (name, src) => {
    const f = path.join(tmp, name)
    fs.writeFileSync(f, fixImports(src))
    return await import(pathToFileURL(f).href)
  }
  const sha = (f) => { const c = fs.readFileSync(f); return c.length + ':' + c.subarray(0, 24).toString('hex') }
  const before = sha(PATCH_PATH)

  // 变异①：默认档改成 mic（HTML 的 selected 与真函数缺省两处一起改）
  {
    const mutHtml = INDEX.replace('<option value="auto" selected', '<option value="mic" selected')
    ok(mutHtml !== INDEX, 'C1 变异①锚点命中（把 HTML 默认档改回 mic）')
    const mutPatch = PATCH.replace("export const BAND_FEED_DEFAULT = 'auto'", "export const BAND_FEED_DEFAULT = 'mic'")
    ok(mutPatch !== PATCH, 'C1 变异①锚点命中（把真函数缺省改回 mic）')
    const MP = await importMutant('bench-bandfeed-m1.mjs', mutPatch)
    const r = cDefault(mutHtml, MP)
    ok(!r.pass, 'C1 ★ 变异①生效：B2「默认档 = auto」在变异体里必红', r.detail)
  }
  // 变异②：URL 拼接里把默认档悄悄换成 off（"打错一个字母静默丢音频响应"的旧口味）
  {
    const mutPatch = PATCH.replace("kept.push('bandfeed=' + bandFeedMode(mode))",
      "kept.push('bandfeed=' + (bandFeedMode(mode) === 'auto' ? 'off' : bandFeedMode(mode)))")
    ok(mutPatch !== PATCH, 'C2 变异②锚点命中（把 auto 档拼成 off）')
    const MP = await importMutant('bench-bandfeed-m2.mjs', mutPatch)
    const r = cUrl(MP)
    ok(!r.pass, 'C2 ★ 变异②生效：B1「auto → bandfeed=auto」在变异体里必红', r.detail)
  }
  // 变异③：删掉状态行的静音原因（静音态直接抄"有数据源"那句 ⇒ 用户看到的就不是原因）
  {
    const mutPatch = PATCH.replace(
      "  const text = t(lang, 'bandfeed.silent') + (why ? '（' + t(lang, why) + '）' : (r ? '（' + r + '）' : ''))",
      "  const text = t(lang, 'bandfeed.srcSim')")
    ok(mutPatch !== PATCH, 'C3 变异③锚点命中（删掉 status plan 里的静音原因拼装）')
    const MP = await importMutant('bench-bandfeed-m3.mjs', mutPatch)
    const r = cSilentText(MP)
    ok(!r.pass, 'C3 ★ 变异③生效：B4「静音态必须写明确原因」在变异体里必红', r.detail)
  }
  // 变异④：为了拿数据去 play 用户的音频（判据④明令禁止的那件事）
  {
    const mutBlock = BAND_BLOCK.replace('  function bandArrayNow(tSec) {',
      '  function bandArrayNow(tSec) {\n    try { sceneAudio.els[0].play() } catch (e) { /* 变异体：为了拿数据先播放 */ }')
    ok(mutBlock !== BAND_BLOCK, 'C4 变异④锚点命中（在 bandArrayNow 里插一次 play()）')
    const r = cNoPlay(mutBlock, 0)
    ok(!r.pass, 'C4 ★ 变异④生效：A4「任何档都不许自动播放包内音频」在变异体里必红', r.detail)
  }
  // 变异⑤：iframe src 包装层退回"原样透传"（档位再也拼不进 URL = 下拉变成摆设）
  {
    const mutPatch = PATCH.replace('set(v) { setter.call(this, audioOptInUrl(bandFeedUrl(v, modeOfNow()), bandFeedWantsPackageAudio(modeOfNow()))) },',
      'set(v) { setter.call(this, v) },')
    ok(mutPatch !== PATCH, 'C5 变异⑤锚点命中（把 src 包装层的 bandfeed 拼接摘掉）')
    const MP = await importMutant('bench-bandfeed-m5.mjs', mutPatch)
    const r = cHook(MP)
    ok(!r.pass, 'C5 ★ 变异⑤生效：B2「iframe src 每次写入都带当前档位」在变异体里必红', r.detail)
  }
  // 变异⑥：把"已就绪但没回报"的诚实分支短路（回到"永远写等待渲染器回报"的旧写法）
  {
    const mutPatch = PATCH.replace('    if (o.rendererReady) {', '    if (false && o.rendererReady) {')
    ok(mutPatch !== PATCH, 'C6 变异⑥锚点命中（短路 rendererReady 的诚实分支）')
    const MP = await importMutant('bench-bandfeed-m6.mjs', mutPatch)
    const r = cNoReport(MP)
    ok(!r.pass, 'C6 ★ 变异⑥生效：B4「已就绪但没回报必须明说」在变异体里必红', r.detail)
  }
  ok(sha(PATCH_PATH) === before, 'C7 真树 demo/bench-patch.js 跑前跑后一致（变异只落内存切片与 ' + path.basename(tmp) + '）', before.slice(0, 16))
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log(failed ? `\n${failed} 项失败（通过 ${passed}）` : `\nALL PASS（${passed} 项）`)
process.exit(failed ? 1 : 0)
