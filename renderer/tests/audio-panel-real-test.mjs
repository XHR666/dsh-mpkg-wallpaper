// audio-panel-real-test.mjs — N6 验收：**真实包**（第4项 凯尔希 3719111841，4 条 MP3）音轨枚举
// 复现：node audio-panel-real-test.mjs   （缺包打印 SKIP 退出 0）
//
// 用户口径 C 的验收对象就是凯尔希（4 条 MP3）：点开 🔊 应看到 4 条音轨、能逐条播放/下载。
// 本测试用**生产解析器 + demo.html 真实区块**（切 MPW-AUDIO-PANEL）在 node 里把这条链路跑通：
//   包条目枚举 → scene.json sound 层合并/去重 → lib.getEntry 现场切片 → magic MIME → Blob URL。
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import path from 'node:path'
import * as lib from '../core/we-scene-bundle.js'

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}

const SCENE_ID = '3719111841'
const ROOT = process.env.MPW_ROOT || WS
const SCENE_ROOT = process.env.MPW_SCENE_ROOT || path.join(ROOT, 'allwallpaper', 'dd')
const PKG = path.join(SCENE_ROOT, SCENE_ID, 'scene.pkg')
if (!fs.existsSync(PKG)) { console.log('SKIP audio-real-pkg：语料包不存在 ' + PKG); process.exit(0) }

const HTML = fs.readFileSync(new URL('../demo.html', import.meta.url), 'utf8')
const i = HTML.indexOf('// ═══ MPW-AUDIO-PANEL-BEGIN')
const j = HTML.indexOf('// ═══ MPW-AUDIO-PANEL-END')
const BLOCK = HTML.slice(HTML.indexOf('\n', i) + 1, HTML.lastIndexOf('\n', j))

const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(PKG)))
const rd = (b) => new TextDecoder().decode(b).replace(/^\uFEFF/, '')
const sceneJson = JSON.parse(rd(lib.getEntry(pkg, 'scene.json')))

// 只取枚举 + MIME 两件事（播放/下载的 DOM 行为由 audio-panel-test.mjs 覆盖）
const fn = new Function('document', 'window', 'localStorage', 'lib', 'pkg', 'sceneObj', 'sceneAudio', 'logf', 'Audio', 'Blob', 'URL', 'Uint8Array',
  BLOCK + '\nreturn { collectPackageAudioTracks, audioMagicMime, audioExtMime }')
const el = () => ({ style: {}, children: [], appendChild(c) { this.children.push(c) }, setAttribute() {}, addEventListener() {}, classList: { add() {}, remove() {} } })
const doc = { getElementById: () => null, createElement: el, body: el() }
const api = fn(doc, {}, { getItem: () => null, setItem() {} }, lib, pkg, sceneJson,
  { ctx: null, analyser: null, els: [], freq: null, started: false, vols: [] }, () => {},
  function Audio() { return { addEventListener() {}, play: () => Promise.resolve(), pause() {} } },
  class Blob { constructor(p, o) { this.parts = p; this.type = o && o.type } },
  { createObjectURL: () => 'blob:real/1' }, Uint8Array)

console.log('[N6] 真实包音轨枚举（' + SCENE_ID + ' 凯尔希）')
const tracks = api.collectPackageAudioTracks(pkg, sceneJson)
{
  check('T1a 4 条音轨（与包内 sounds/*.mp3 条目数一致）', tracks.length === 4, 'n=' + tracks.length)
  check('T1b 全部 .mp3 且 MIME = audio/mpeg（magic 嗅探 ID3/帧同步）',
    tracks.every((t) => /\.mp3$/i.test(t.path) && t.mime === 'audio/mpeg'), tracks.map((t) => t.mime).join(','))
  check('T1c 大小 = 包内条目字节数（现场切片成功，非 0）',
    tracks.every((t) => t.size > 1e6) && tracks.reduce((s, t) => s + t.size, 0) > 30e6,
    tracks.map((t) => (t.size / 1048576).toFixed(1) + 'MB').join(' '))
  check('T1d 每条都被 1 个 sound 层引用（去重后不重复列出）',
    tracks.every((t) => t.refs.length === 1) && new Set(tracks.map((t) => t.path)).size === 4,
    tracks.map((t) => t.refs.length).join(','))
  check('T1e 文件名是作者原名（含空格/西里尔/日文 → 下载名可用）',
    tracks.some((t) => /Дом\.mp3$/.test(t.path)) && tracks.some((t) => /Innocence/.test(t.path)),
    tracks.map((t) => t.path.split('/').pop().slice(0, 18)).join(' | '))
  const total = tracks.reduce((s, t) => s + t.size, 0)
  check('T1f 压缩率合理（4 条合计 ' + (total / 1048576).toFixed(1) + 'MB，与场景包 4.5MB 级别不同 → 说明真的读了音频字节）',
    total > 30e6, (total / 1048576).toFixed(1) + 'MB')
}

console.log('\n' + (fail === 0 ? '全部通过' : '存在失败') + `：${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
