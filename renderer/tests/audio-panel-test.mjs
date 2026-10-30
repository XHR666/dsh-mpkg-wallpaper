// audio-panel-test.mjs — N6（用户决策 C）:8899 顶栏 🔊 音频面板单测（切 demo.html 真实区块 + 假 DOM/假包）
// 复现：node audio-panel-test.mjs
//
// 契约（TASK-RENDERER-QUEUE.md「N6 细化规格」）：
//   ① 枚举 = 包内音频条目（pkg.entries 的 mp3/ogg/oga/opus/wav/flac/m4a/aac）∪ scene.json sound 层引用，
//      同一文件只列一次并标注"被 N 层引用"；
//   ② 每条 = 现场切片 + Blob + magic 嗅探 MIME（扩展名会说谎 → 字节优先）；
//   ③ UI = 顶栏 🔊 按钮 + 面板（文件名/大小/时长/格式/引用数 + ▶︎/⏸ + ↓ 下载），开关状态记 localStorage；
//   ④ 复用场景 sound 层的同一个 AudioContext/analyser，暴露 window.__mpwAudio + 每帧 __mpwAudioFrame
//      （**只留接口位，本批不实现效果**）；⑤ 仓库不预置任何音频文件、开机不读整条音轨（内存口径）。
import fs from 'node:fs'

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}

const HTML = fs.readFileSync(new URL('../demo.html', import.meta.url), 'utf8')
function sliceBlock(src) {
  const i = src.indexOf('// ═══ MPW-AUDIO-PANEL-BEGIN')
  const j = src.indexOf('// ═══ MPW-AUDIO-PANEL-END')
  if (i < 0 || j < 0) throw new Error('demo.html 里找不到 MPW-AUDIO-PANEL 区块标记')
  return src.slice(src.indexOf('\n', i) + 1, src.lastIndexOf('\n', j))
}
const BLOCK = sliceBlock(HTML)

// ── 假 DOM ────────────────────────────────────────────────────────────────
function mkEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(), id: '', className: '', type: '', textContent: '', title: '',
    style: { cssText: '' }, children: [], _attrs: {}, _ls: {},
    appendChild(c) { el.children.push(c); return c },
    setAttribute(k, v) { el._attrs[k] = String(v) },
    getAttribute(k) { return el._attrs[k] },
    addEventListener(t, h) { (el._ls[t] = el._ls[t] || []).push(h) },
    fire(t, ev) { for (const h of (el._ls[t] || [])) h(Object.assign({ preventDefault() { this._pd = 1 }, target: el }, ev)) },
    click() { el._clicked = (el._clicked || 0) + 1; el.fire('click') },
  }
  return el
}
function mkEnv(opts = {}) {
  const store = opts.store || {}
  const els = { bar: mkEl('div') }
  const body = mkEl('body')
  const doc = { getElementById: (id) => els[id] || null, createElement: (t) => mkEl(t), body }
  let ctxCount = 0
  const analyser = {
    fftSize: 0, smoothingTimeConstant: 0, frequencyBinCount: 8, _samples: 0,
    connect() {}, getByteFrequencyData(arr) { this._samples++; for (let i = 0; i < arr.length; i++) arr[i] = 128 },
  }
  function FakeAudioContext() {
    ctxCount++
    this.state = 'suspended'; this.destination = { id: 'dest' }
    this.createAnalyser = () => analyser
    this.createMediaElementSource = () => ({ connect() {} })
    this.resume = () => { this.state = 'running' }
  }
  const audios = []
  function FakeAudio() {
    const el = mkEl('audio')
    el.play = () => { el._played = (el._played || 0) + 1; return Promise.resolve() }
    el.pause = () => { el._paused = (el._paused || 0) + 1 }
    el.duration = 12.5
    audios.push(el)
    return el
  }
  const blobs = []
  const urls = []
  let urlN = 0
  const win = { AudioContext: FakeAudioContext }
  const ls = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v) } }
  const logs = []
  const reads = []
  const lib = opts.lib || { getEntry: () => null }
  const wrappedLib = { getEntry: (p, path) => { reads.push(path); return lib.getEntry(p, path) } }
  const sceneAudio = opts.sceneAudio || { ctx: null, analyser: null, els: [], freq: null, started: false, vols: [] }
  // ①(P-112-BANDGEOM 2026-09-17) `audioFrameTick` 现在顺带调 `bandFrameTick(tSec)`（128 元频段数组接线，
  //   那个函数在**另一个切片块**里 ⇒ 本 harness 必须注入，否则引用不到外层符号、被 try/catch 吞掉，
  //   本项的 T5b 会以 "len=null" 假红）。口径与 PATCHES P-111.5 第 2 条一致：切片 harness 要跟着注入新符号。
  //   顺带把它记下来 —— "每帧真的调到了频段接线"本身就是一条接线断言（默认关时真函数自己直接返回）。
  const bandTicks = []
  const fn = new Function('document', 'window', 'localStorage', 'lib', 'pkg', 'sceneObj', 'sceneAudio', 'logf', 'Audio', 'Blob', 'URL', 'Uint8Array', 'bandFrameTick',
    BLOCK + '\nreturn { audioMagicMime, audioExtMime, audioHeadBytes, collectPackageAudioTracks, installAudioPanel, audioFrameTick, ensureAudioCtx, audioPanel, AUDIO_EXT_RE }')
  const api = fn(doc, win, ls, wrappedLib, opts.pkg || { entries: [] }, opts.sceneObj || { objects: [] }, sceneAudio, (m) => logs.push(String(m)),
    FakeAudio, class FakeBlob { constructor(parts, o) { blobs.push({ parts, type: o && o.type }); this.size = (parts && parts[0] && parts[0].length) || 0 } },
    { createObjectURL: (b) => { const u = 'blob:fake/' + (++urlN); urls.push({ u, b }); return u } },
    Uint8Array, (t) => { bandTicks.push(t) })
  return { api, doc, win, ls, store, els, body, analyser, audios, blobs, urls, logs, reads, sceneAudio, bandTicks, ctxCount: () => ctxCount }
}

const u8 = (arr) => new Uint8Array(arr)
const ID3 = () => u8([0x49, 0x44, 0x33, 0x03, 0, 0, 0, 0, 0, 0])
const RIFF = () => { const a = new Uint8Array(44); const s = 'RIFF'; for (let i = 0; i < 4; i++) a[i] = s.charCodeAt(i); const w = 'WAVE'; for (let i = 0; i < 4; i++) a[8 + i] = w.charCodeAt(i); return a }
const FLAC = () => { const a = new Uint8Array(32); const s = 'fLaC'; for (let i = 0; i < 4; i++) a[i] = s.charCodeAt(i); return a }
const OGG = () => { const a = new Uint8Array(32); const s = 'OggS'; for (let i = 0; i < 4; i++) a[i] = s.charCodeAt(i); return a }
const MP4 = () => { const a = new Uint8Array(64); const s = 'ftyp'; for (let i = 0; i < 4; i++) a[4 + i] = s.charCodeAt(i); return a }
const MPEG = () => u8([0xff, 0xfb, 0x90, 0x00, 0x11, 0x22])
const panelOf = (env) => env.body.children.find((c) => c.id === 'mpw-audio-panel')
const btnOf = (env) => env.els.bar.children.find((c) => c.id === 'mpw-audio-btn')
const rowsOf = (env) => panelOf(env).children.filter((c) => c.className === 'row')

console.log('[N6] 🔊 音频面板（demo.html 真实区块 + 假 DOM）')
check('T0a 区块可切出且可独立执行', typeof mkEnv({}).api.installAudioPanel === 'function', BLOCK.split('\n').length + ' 行')

console.log('[T1] magic 嗅探 MIME（字节优先，扩展名会说谎）')
{
  const { api } = mkEnv({})
  check('T1a RIFF/WAVE → audio/wav', api.audioMagicMime(RIFF()) === 'audio/wav', api.audioMagicMime(RIFF()))
  check('T1b ID3 → audio/mpeg', api.audioMagicMime(ID3()) === 'audio/mpeg')
  check('T1c MPEG 帧同步 0xff 0xfb → audio/mpeg', api.audioMagicMime(MPEG()) === 'audio/mpeg')
  check('T1d fLaC → audio/flac', api.audioMagicMime(FLAC()) === 'audio/flac')
  check('T1e OggS → audio/ogg', api.audioMagicMime(OGG()) === 'audio/ogg')
  check('T1f ftyp(MP4) → audio/mp4', api.audioMagicMime(MP4()) === 'audio/mp4')
  check('T1g 未知字节 → 空（交给扩展名兜底）', api.audioMagicMime(u8([0, 1, 2, 3, 4, 5, 6, 7])) === '')
  check('T1h 扩展名兜底表', api.audioExtMime('a/b.mp3') === 'audio/mpeg' && api.audioExtMime('x.opus') === 'audio/ogg' && api.audioExtMime('x.m4a') === 'audio/mp4')
  check('T1i 12 字节头部足够判定（零拷贝口径）', api.audioMagicMime(ID3().subarray(0, 12)) === 'audio/mpeg' && api.audioMagicMime(RIFF().subarray(0, 12)) === 'audio/wav')
}

console.log('[T2] 枚举：包内条目 ∪ sound 层引用（去重 + 被 N 层引用）；**开机不读整条音轨**')
{
  const pkg = { entries: [
    { name: 'audio/theme.mp3', size: 1000 }, { name: 'audio/bgm2.ogg', size: 2000 }, { name: 'audio/hit.wav', size: 3000 },
    { name: 'scene.json', size: 10 }, { name: 'textures/a.tex', size: 99 }, { name: 'audio/readme.txt', size: 5 },
  ] }
  const sceneObj = { objects: [
    { id: 1, name: '音轨A', sound: 'audio/theme.mp3', playbackmode: 'loop' },
    { id: 2, name: '音轨B', sound: ['audio/theme.mp3', 'audio/extra.mp3'] },
    { id: 3, name: '组', objects: [{ id: 4, name: '音轨C', sound: 'audio/sub/voice.mp3' }] },
  ] }
  const bytes = { 'audio/theme.mp3': ID3(), 'audio/bgm2.ogg': OGG(), 'audio/hit.wav': RIFF(), 'audio/extra.mp3': MPEG(), 'audio/sub/voice.mp3': MPEG() }
  const env = mkEnv({ pkg, sceneObj, lib: { getEntry: (p, path) => bytes[path] || null } })
  const tracks = env.api.audioPanel.tracks
  const paths = tracks.map((t) => t.path)
  check('T2a 5 条音轨（3 条目 + 2 仅被 sound 层引用），非音频条目被排除',
    paths.length === 5 && !paths.includes('audio/readme.txt') && !paths.includes('scene.json'), JSON.stringify(paths))
  const theme = tracks.find((t) => t.path === 'audio/theme.mp3')
  check('T2b 去重：theme.mp3 只列一次，标注被 2 层引用', theme && theme.refs.length === 2, JSON.stringify(theme && theme.refs))
  const voice = tracks.find((t) => t.path === 'audio/sub/voice.mp3')
  check('T2c 嵌套 objects 里的 sound 层也枚举到', !!voice && voice.refs[0] === '音轨C')
  check('T2d 大小取条目索引（1000/2000/3000）+ MIME 已判定',
    theme.size === 1000 && tracks.find((t) => t.path === 'audio/bgm2.ogg').mime === 'audio/ogg' && tracks.find((t) => t.path === 'audio/hit.wav').mime === 'audio/wav')
  check('T2e 排序稳定（按路径）', paths.join(',') === [...paths].sort().join(','))
  // 内存口径：安装面板不得把整条音轨读进内存（只允许 ≤16 字节的头部读）
  check('T2f 开机不 materialize（0 个 Blob；每条只读 ≤16 字节头部）', env.blobs.length === 0 && env.reads.length === tracks.length,
    'reads=' + env.reads.length + ' blobs=' + env.blobs.length)
  const pkg2 = { entries: [{ name: 'audio/liar.mp3', size: 44 }] }
  const { api: api2 } = mkEnv({ pkg: pkg2, sceneObj: { objects: [] }, lib: { getEntry: () => RIFF() } })
  check('T2g 扩展名说谎（.mp3 实为 WAV）→ MIME 以字节为准 = audio/wav',
    api2.collectPackageAudioTracks(pkg2, { objects: [] })[0].mime === 'audio/wav')
}

console.log('[T3] UI：顶栏按钮 + 面板行（名称/大小/格式/引用 + ▶︎ + ↓）')
{
  const pkg = { entries: [{ name: 'audio/theme.mp3', size: 1048576 }, { name: 'audio/hit.wav', size: 2048 }] }
  const sceneObj = { objects: [{ id: 1, name: '音轨A', sound: 'audio/theme.mp3' }] }
  const bytes = { 'audio/theme.mp3': ID3(), 'audio/hit.wav': RIFF() }
  const env = mkEnv({ pkg, sceneObj, lib: { getEntry: (p, path) => bytes[path] || null } })
  const btn = btnOf(env)
  check('T3a 顶栏出现 🔊 按钮', !!btn && /🔊/.test(btn.textContent), btn && btn.textContent)
  const panel = panelOf(env)
  check('T3b 面板已挂到 body，默认关闭（class 无 open）', !!panel && panel.className === '')
  let rows = rowsOf(env)
  check('T3c 每条音轨一行（2 行）', rows.length === 2, 'rows=' + rows.length)
  const dl = rows[0].children.find((c) => c.tagName === 'A')
  check('T3d ↓ 下载：download=作者的原始文件名（含扩展名）', dl && dl.getAttribute('download') === 'hit.wav', dl && JSON.stringify(dl._attrs))
  const play = rows[0].children.find((c) => c.tagName === 'BUTTON')
  check('T3e ▶︎ 按钮初始态', play.textContent === '▶︎')
  check('T3f 面板头显示条数与"现场解析"口径', /2 条/.test(panel.children[0].textContent), panel.children[0].textContent)
  const themeRow = rowsOf(env).find((r) => r.children[1].textContent === 'theme.mp3')
  const wavRow = rowsOf(env).find((r) => r.children[1].textContent === 'hit.wav')
  check('T3g 行内元信息：大小(MB/KB) + 格式 + 被 N 层引用',
    themeRow && wavRow && /1\.0MB/.test(themeRow.children[2].textContent) && /被 1 层引用/.test(themeRow.children[2].textContent)
      && /2KB/.test(wavRow.children[2].textContent) && /audio\/wav/.test(wavRow.children[2].textContent),
    (themeRow ? themeRow.children[2].textContent : '?') + ' | ' + (wavRow ? wavRow.children[2].textContent : '?'))
  // 展开面板 → 才 materialize（Blob URL + <audio>），时长随后由 loadedmetadata 填入
  btn.fire('click')
  check('T3h 展开面板 → 逐条 materialize（2 个 Blob + 2 个 <audio>）', env.blobs.length === 2 && env.audios.length === 2,
    'blobs=' + env.blobs.length + ' audios=' + env.audios.length)
  env.audios[0].fire('loadedmetadata')
  const withDur = rowsOf(env).find((r) => /12\.5s/.test(r.children[2].textContent))
  check('T3i loadedmetadata → 时长写进行内元信息', !!withDur, rowsOf(env).map((r) => r.children[2].textContent).join(' | '))
  // 下载：点击 → 生成带 blob href 的临时 <a download> 并触发 click
  const dlLive = rowsOf(env).find((r) => r.children[0].textContent === '▶︎' || r.children[0].textContent === '⏸').children.find((c) => c.tagName === 'A')
  dlLive.fire('click')
  const tmp = env.body.children.filter((c) => c.tagName === 'A' && /^blob:fake\//.test(String(c.getAttribute('href'))))
  check('T3j 点 ↓ → 用 blob URL 触发 <a download> 下载', tmp.length >= 1 && tmp[0].getAttribute('download') && tmp[0]._clicked === 1,
    JSON.stringify(tmp.map((c) => c._attrs)))
  // 播放/暂停
  const play2 = rowsOf(env)[0].children.find((c) => c.tagName === 'BUTTON')
  play2.fire('click')
  check('T3k 点 ▶︎ → play() + 按钮变 ⏸', env.audios[0]._played === 1 && play2.textContent === '⏸')
  check('T3l 播放中 → window.__mpwAudio.current 指向该音轨（预留接口已发布）',
    env.win.__mpwAudio && env.win.__mpwAudio.current && !!env.win.__mpwAudio.current.path,
    JSON.stringify(env.win.__mpwAudio && env.win.__mpwAudio.current))
  check('T3m 复用同一个 AudioContext/analyser（ctx/analyser 已发布）',
    !!env.win.__mpwAudio.ctx && !!env.win.__mpwAudio.analyser && env.ctxCount() === 1, 'ctxCount=' + env.ctxCount())
  play2.fire('click')
  check('T3n 再点 → pause() + current 清空', env.audios[0]._paused === 1 && env.win.__mpwAudio.current === null)
  check('T3o Blob type = 嗅探 MIME', env.blobs.some((b) => b.type === 'audio/wav') && env.blobs.some((b) => b.type === 'audio/mpeg'),
    env.blobs.map((b) => b.type).join(','))
}

console.log('[T4] 面板开关状态记 localStorage（刷新保持）')
{
  const env = mkEnv({ pkg: { entries: [{ name: 'a.mp3', size: 100 }] }, lib: { getEntry: () => ID3() } })
  const btn = btnOf(env), panel = panelOf(env)
  btn.fire('click')
  check('T4a 点按钮 → 面板打开 + localStorage=1', panel.className === 'open' && env.store['mpw-audio-open'] === '1', JSON.stringify(env.store))
  btn.fire('click')
  check('T4b 再点 → 关闭 + localStorage=0', panel.className === '' && env.store['mpw-audio-open'] === '0')
  const env2 = mkEnv({ pkg: { entries: [{ name: 'a.mp3', size: 100 }] }, lib: { getEntry: () => ID3() }, store: { 'mpw-audio-open': '1' } })
  check('T4c 重载（localStorage=1）→ 面板直接展开并已 materialize', panelOf(env2).className === 'open' && env2.audios.length === 1)
}

console.log('[T5] 每帧钩子位 __mpwAudioFrame（只留位，不实现效果）')
{
  const env = mkEnv({ pkg: { entries: [{ name: 'a.mp3', size: 100 }] }, lib: { getEntry: () => ID3() } })
  env.api.audioFrameTick()
  check('T5a 未挂钩子 → 不取样（零成本默认路径）', env.analyser._samples === 0)
  let got = null
  env.win.__mpwAudioFrame = (freq) => { got = freq }
  env.api.ensureAudioCtx()
  env.api.audioFrameTick()
  check('T5b 挂了钩子 → 每帧回调收到频域数组', !!got && got.length === 8 && env.analyser._samples === 1, 'len=' + (got && got.length))
  env.win.__mpwAudioFrame = () => { throw new Error('effect boom') }
  let threw = null
  try { env.api.audioFrameTick() } catch (e) { threw = e.message }
  check('T5c 钩子抛错不影响渲染（被吞）', threw === null)
  // ①(P-112-BANDGEOM) 接线断言：每帧钩子位里**真的**调了频段接线（`?bandfeed=` 默认关 ⇒ 真函数第一行直接返回）
  check('T5d 每帧顺带喂 128 元频段接线（bandFrameTick 被调用；`?bandfeed=` 关时零成本）',
    env.bandTicks.length === 3, 'calls=' + env.bandTicks.length)
}

console.log('[T6] 复用既有 AudioContext（?audio=1 的场景 sound 层先建过）')
{
  let ctxCount = 0
  function AC() { ctxCount++; this.state = 'running'; this.destination = {}; this.createAnalyser = () => ({ frequencyBinCount: 4, connect() {} }); this.createMediaElementSource = () => ({ connect() {} }) }
  const sceneAudio = { ctx: null, analyser: null, els: [], freq: null, started: true, vols: [] }
  const env = mkEnv({ pkg: { entries: [{ name: 'a.mp3', size: 100 }] }, lib: { getEntry: () => ID3() }, sceneAudio })
  sceneAudio.ctx = new AC()
  sceneAudio.analyser = sceneAudio.ctx.createAnalyser()
  const before = ctxCount
  env.api.ensureAudioCtx()
  check('T6a 已有 ctx → 不再新建（复用同一个）', ctxCount === before)
}

console.log('[T7] 边界：包内无音轨 / 空包 / 条目读取失败')
{
  const env = mkEnv({ pkg: { entries: [{ name: 'scene.json', size: 10 }] }, sceneObj: { objects: [{ id: 1, name: 'x' }] } })
  const panel = panelOf(env)
  check('T7a 无音轨 → 面板给明确空态，不抛错', !!panel && panel.children.some((c) => /没有音频文件/.test(c.textContent)),
    panel.children.map((c) => c.textContent).join(' | ').slice(0, 80))
  const env2 = mkEnv({ pkg: null, sceneObj: null, lib: { getEntry: () => null } })
  check('T7b pkg/sceneObj 为 null → 不抛错（空列表）', env2.api.audioPanel.tracks.length === 0)
  const env3 = mkEnv({ pkg: { entries: [{ name: 'bad.mp3', size: 10 }] }, lib: { getEntry: () => { throw new Error('越界') } } })
  check('T7c 头部读取抛错 → 回退扩展名 MIME，不中断面板', env3.api.audioPanel.tracks[0].mime === 'audio/mpeg')
  const env4 = mkEnv({ pkg: { entries: [{ name: 'gone.mp3', size: 10 }] }, lib: { getEntry: () => null } })
  btnOf(env4).fire('click')
  const play4 = rowsOf(env4)[0].children.find((c) => c.tagName === 'BUTTON')
  let threw = null
  try { play4.fire('click') } catch (e) { threw = e.message }
  check('T7d 切片失败（条目缺失）→ 不崩、无 Blob、有日志', threw === null && env4.blobs.length === 0 && env4.logs.some((m) => /切片失败/.test(m)),
    env4.logs.join('|').slice(0, 60))
}

console.log('[T8] 仓库不预置音频 + README 登记（页面内 UI 表）')
{
  const dir = new URL('.', import.meta.url).pathname
  const bad = fs.readdirSync(dir).filter((f) => /\.(mp3|ogg|oga|opus|wav|flac|m4a|aac)$/i.test(f))
  check('T8a 仓库根目录没有新增音频文件', bad.length === 0, bad.join(','))
  check('T8b demo.html 内无内联音频（data:audio）', !/data:audio/i.test(HTML))
  const readme = fs.readFileSync(new URL('../docs/README-DIAGNOSTICS.md', import.meta.url), 'utf8')
  check('T8c README 页面内 UI 表已登记 🔊 音频面板', /mpw-audio-panel|🔊/.test(readme))
}

console.log('\n' + (fail === 0 ? '全部通过' : '存在失败') + `：${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
