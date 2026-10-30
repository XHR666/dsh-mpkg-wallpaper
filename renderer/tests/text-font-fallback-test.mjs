#!/usr/bin/env node
// text-font-fallback-test.mjs — 文本字体**四级来源链**回归
//
// 契约（P-81 冻结，P-86 扩一级）：
//   ① 包内 `lib.getEntry(pkg, fp)` **优先且逐位不变**（包内有就必须用包内的，**绝不触碰网络级**）；
//   ② 包内没有（或长度为 0）→ **仓库自带** `/assets/fonts/<文件>`（P-86 新增：server/we-scene-demo-server.mjs
//      的 `/assets/fonts/(.+)` → 本仓库 `assets/fonts/**`，只放**我们有权分发**的字体）；
//      `?repofonts=off` ⇒ 整级跳过，逐位回到 P-81 的三级链；
//   ③ 仓库没有 → `/weassist/fonts/<basename>`（basename 要 encodeURIComponent），即**用户本机 WE 安装
//      目录**的 `assets/fonts/**`；公开副本没装 WE ⇒ 该路由 404 ⇒ **不抛异常**，落第四级；
//   ④ 都没有 → 回退 `sans-serif`（改动前行为）+ 日志写明"缺失→回退"+试过的 URL。
//   另：`textFontLoaded` 语义 = "**字节真的到手**"；来源判定失败的 fp 记 `textFontMissing`，
//   否则（a）后面几级永远轮不到、（b）`ensureTextTexture` 每帧重复 404。
//
// 本文件做六件事（T1/T2/T2s/T5 纯 Node + 真服务器，无浏览器；T3/T3b 需本机真包，缺则 SKIP）：
//   [T1] 从 demo.html **节选真源码**求值纯函数 textFontSourceOf / textFontNextTier / repoFontUrl /
//        weFontUrl / REPO_FONT_ALIASES → 四级顺序 + 每一级 URL 形状（含空格与 CJK 的编码、
//        WE 引用名 → 仓库文件名的映射表）。
//   [T2] 节选真源码 `ensureTextFont`（+ `textFontFamily`），用桩 lib/pkg/fetch/Blob/URL/FontFace/document
//        跑十四个场景（包内有 / 仓库 200 / 仓库 404→WE 200 / 仓库异常/空体 / 四级全缺 /
//        `?repofonts=off` 两态 / 包内空字节 / systemfont_ / FontFace 抛错 / 去重 / 别名），逐条比对日志、
//        集合语义、family、字节与 magic。
//   [T2s] 源码级守卫：钉死语义，防止改回"没拿到也 loaded"或把某一级写丢。
//   [T3] 真包 3554161528（hina）真数据：时钟层 id398 的 `fonts/Monofur-PK7og.ttf` 在包内**不存在** ⇒
//        必须走第②级"仓库自带"（用**仓库里那个真文件**当响应体，断言 169,452 B + sfnt magic + family）；
//        另一文本层 id1592 的 `fonts/千图马克手写体.ttf` 在包内**存在** ⇒ 必须走第①级。
//   [T3b] 真包 3327063360（砂狼白子）真数据：时钟层 id639（默认可见的那个 Clock）引用
//        `fonts/spincycle_3d_ot.otf` ⇒ 同样必须走第②级（真文件 44,228 B + OTTO magic）；
//        并断言它**不是** WE 目录里那份旧 build（证明没从 WE 复制）。
//   [T4] 仓库资产/许可一致性：每个字体文件存在、sha256 与 THIRD-PARTY.md 一致、许可/声明文件齐全、
//        映射表目标文件在磁盘上、THIRD-PARTY.md 每行有条目、bvfonts.com 回链在三处（含字体目录说明
//        文件与 demo.html）、未取到的 8bitOperatorPlus8-Regular.ttf **确实没被塞进来**。
//   [T5] 真服务器：`/assets/fonts/<名>` 200 + content-type + 字节数 + sfnt/OTTO magic（含带空格文件名、
//        别名文件名、licenses 文本），未知文件 404、`%2e%2e%2f` 穿越 404。
//   [T6]（可选，`MPW_FONT_E2E=1` 才跑）真服务器 + 真包 + 无头 chromium：断言 demo 日志里出现
//        `🔤 文本字体 Monofur-PK7og.ttf：仓库自带`（WE 资产目录被指向不存在的路径 ⇒ 只能是第②级命中），
//        以及 `?repofonts=off` 时同一字体变成 `缺失→回退 sans-serif`。
//        ⚠ 环境实况（2026-09-15 本机）：这台的 chromium（playwright 151）在 proot 容器里**能启动、
//        能开 about:blank，但渲染进程一加载 demo 就会崩/挂起**（`browser.newPage()` 不返回、
//        `page.setContent` 报 "Target page, context or browser has been closed"）⇒ 本节**未在本机跑通**，
//        只作为"有真实浏览器时的一条可选验证入口"保留；**不要**把它当成已验证的断言。
//        四级链的"真的命中哪一级"由 T2/T3/T3b（真包 + 真字节）与 T5（真服务器 200）覆盖。
//
// 用法：node text-font-fallback-test.mjs
//   缺真包时 T3/T3b 输出 `SKIP …`（门禁条件项）；T1/T2/T2s/T4/T5 永远跑。
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import * as lib from '../core/we-scene-bundle.js'
import { ROOT, WS } from './_root.mjs'   // ①(2026-09-16 目录整理) 仓库根（本脚本已移入 tests/）

const HERE = ROOT
const HTML = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8')
const SERVER = path.join(ROOT, 'server/we-scene-demo-server.mjs')
const FONT_DIR = path.join(HERE, 'assets', 'fonts')
const LIC_DIR = path.join(FONT_DIR, 'licenses')
const THIRD_PARTY = path.join(ROOT, 'THIRD-PARTY.md')
const FONTS_README = path.join(FONT_DIR, 'README.md')
const SCENE_ROOT = process.env.MPW_SCENE_ROOT || path.join(path.dirname(HERE), 'allwallpaper', 'dd')
const PKG_HINA = path.join(SCENE_ROOT, '3554161528')
const PKG_SHIROKO = path.join(SCENE_ROOT, '3327063360')
const WE_FONT_DIR = process.env.MPW_WE_FONTS || path.join(path.dirname(HERE), 'wallpaper_engine', 'assets', 'fonts')

let pass = 0, fail = 0
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')) }
}
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
const magic4 = (buf) => Buffer.from(buf.slice(0, 4)).toString('hex')

// ── 冻结契约：仓库里应有的字体（文件名 / 字节 / sha256 / 魔数）+ 许可文件清单 ──
//    这些值同时出现在 THIRD-PARTY.md §4.1，测试两边交叉核对（任一侧漂移都会红）。
const REPO_FONTS = [
  { file: 'Blackout 2 AM.ttf', bytes: 28308, sha: '48e96e2a3e9be781e1884b670a69434612c319fe21b6595813f1193f69cea2d0', magic: '00010000', ref: 'fonts/Blackout 2 AM.ttf', type: 'font/ttf' },
  { file: 'monof55.ttf', bytes: 169452, sha: '025676779b4ea99781930b6916ce3c575f9bfda77e1d726e8d70032c007b2b44', magic: '00010000', ref: 'fonts/Monofur-PK7og.ttf', type: 'font/ttf' },
  { file: 'NotoSans-Regular.ttf', bytes: 569208, sha: 'b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5', magic: '00010000', ref: 'fonts/NotoSans-Regular.ttf', type: 'font/ttf' },
  { file: 'RobotoMono-Regular.ttf', bytes: 125748, sha: 'af0bff7599c3df3831755c16e39b3c496df74b8c8d8a1161b14dc8461be17cb4', magic: '00010000', ref: 'fonts/RobotoMono-Regular.ttf', type: 'font/ttf' },
  { file: 'Segment7Standard.otf', bytes: 10464, sha: 'f35b8ce74c9aedbd51e790b178c5dfbfe62068772db6e924a455247781cc7356', magic: '4f54544f', ref: 'fonts/Segment7Standard.otf', type: 'font/otf' },
  { file: 'spincycle_3d_ot.otf', bytes: 44228, sha: 'cc4a580ac0d112ef0eb5199fe08d497a5875fd24c2361038dc6c847a3962da4d', magic: '4f54544f', ref: 'fonts/spincycle_3d_ot.otf', type: 'font/otf' },
  { file: 'Twemoji.Mozilla.ttf', bytes: 1474284, sha: '6d90152ee0d29e82fe2a87793af5aa4b7ad13e6538360889e141e81ed299ee8e', magic: '00010000', ref: 'fonts/TwemojiMozilla.ttf', type: 'font/ttf' },
  // ①(2026-09-18) 8bitOperatorPlus8-Regular.ttf 的现行版（同作者、CC0-1.0）——`ref` 是被映射的 WE 引用名
  { file: 'PixelOperator8.ttf', bytes: 19944, sha: '5cccb9ef6cf18977b6e5721d49a1a6e78dd6a6f1c4f69537470f7dc1dc829ffc', magic: '00010000', ref: 'fonts/8bitOperatorPlus8-Regular.ttf', type: 'font/ttf' },
]
const LICENSE_FILES = [
  'OFL-Blackout.markdown', 'OFL-Monofur-debian-copyright.txt', 'monofur-author-OFL-email.txt',
  'monofur-monof_tt-notice.txt', 'OFL-NotoSans.txt', 'OFL-RobotoMono.txt', 'OFL-Segment7.txt',
  'Twemoji-Mozilla-LICENSE.md', 'Apache-2.0.txt', 'CC-BY-4.0-Twemoji-attribution.txt',
  'spincycle-bvfonts-README.txt', 'spincycle-bvfonts-TOU.txt', 'CC0-1.0-PixelOperator.txt',
]
// 明确**不入库**的：7 个查不到再分发授权的（§4.5）。原先还有 `8bitOperatorPlus8-Regular.ttf`——
// ①(2026-09-18) 它已收口：改用作者现行版 `PixelOperator8.ttf`（CC0-1.0），见 THIRD-PARTY §4.7
const NOT_BUNDLED = ['Alcubierre.otf', 'Atami-Regular.otf', 'CursedTimerUlil-Aznm.ttf', 'Lazer84.ttf', 'kust.ttf', 'opensticks.ttf', 'summer85.ttf']
// Spin Cycle 3D：作者官方 zip 里那份（报告 §2.6 记的官方 build）与 WE 目录那份（旧 build）——必须不同
const SPIN_OFFICIAL_SHA = 'cc4a580ac0d112ef0eb5199fe08d497a5875fd24c2361038dc6c847a3962da4d'
const SPIN_WE_SHA = '41a1e603f5befa0bb2d5c657a8858d8c9368bbb65d09c756bcaa49c2afcd48c8'

// ── 从 demo.html 节选真源码（与 text-layout-test.mjs 同一套做法：花括号配对取整段） ──
function extractFn(src, header) {
  const start = src.indexOf(header)
  if (start < 0) throw new Error('未找到: ' + header)
  let i = src.indexOf('{', start), depth = 0
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) break }
  }
  return src.slice(start, i + 1)
}
function extractLine(src, header) {
  const line = src.split('\n').find((l) => l.includes(header))
  if (!line) throw new Error('未找到: ' + header)
  const s = line.indexOf(header)
  const end = line.lastIndexOf('}')            // 单行箭头函数带体（mpwHash）取到收尾花括号；纯表达式行取整行
  return (end > s ? line.slice(s, end + 1) : line.slice(s)).trim()
}
const SRC_SOURCE_OF = extractLine(HTML, 'const textFontSourceOf = ')
const SRC_NEXT_TIER = extractLine(HTML, 'const textFontNextTier = ')
const SRC_REPO_URL = extractLine(HTML, 'const repoFontUrl = ')
const SRC_WE_URL = extractLine(HTML, 'const weFontUrl = ')
const SRC_REPO_NAME = extractFn(HTML, 'const repoFontNameOf = (fp) => {')
const SRC_ALIASES = extractFn(HTML, 'const REPO_FONT_ALIASES = {')
const SRC_TIER_LABEL = extractLine(HTML, 'const textFontTierLabel = ')
const SRC_REPO_OFF = HTML.split('\n').find((l) => l.includes("get('repofonts')")) || ''
const SRC_HASH = extractLine(HTML, 'const mpwHash = ')
const SRC_ENSURE = extractFn(HTML, 'async function ensureTextFont(fp) {')
const SRC_FAMILY = extractFn(HTML, 'const textFontFamily = (layer) =>')

// ── 桩环境：把 ensureTextFont 需要的一切注入（不碰真 DOM / 真网络 / 真字体） ──
const WE_BYTES = new Uint8Array([0x00, 0x01, 0x00, 0x00, 0xAA])   // 5 字节假字体
function mkEnv({ entries = {}, repo = 'ok', we = 'ok', faceLoadThrows = false, repoBytes = null, weBytes = null, repoFontsOff = false } = {}) {
  const st = { logs: [], fetched: [], blobs: [], fontFaces: [], added: [], objectUrls: [],
    loaded: new Set(), pending: new Set(), missing: new Set() }
  const libStub = { getEntry: (p, name) => (Object.prototype.hasOwnProperty.call(entries, name) ? entries[name] : null) }
  const logf = (m) => st.logs.push(String(m))
  const BlobStub = class { constructor(parts, opts) { this.parts = parts; this.type = opts && opts.type; st.blobs.push(this) } }
  const URLStub = { createObjectURL: (b) => { st.objectUrls.push(b); return 'blob:stub/' + st.objectUrls.length } }
  const FontFaceStub = class {
    constructor(family, source) { this.family = family; this.source = source; st.fontFaces.push(this) }
    async load() { if (faceLoadThrows) throw new Error('字体解析失败(桩)'); this.status = 'loaded'; return this }
  }
  const documentStub = { fonts: { add: (f) => { st.added.push(f) } } }
  const fetchStub = async (u) => {
    st.fetched.push(String(u))
    const isRepo = String(u).startsWith('/assets/fonts/')
    const mode = isRepo ? repo : we
    if (mode === 'throw') throw new Error('network down(桩)')
    if (mode === '404') return { ok: false, status: 404, arrayBuffer: async () => null }
    if (mode === 'empty') return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0) }
    const b = (isRepo ? repoBytes : weBytes) || WE_BYTES
    return { ok: true, status: 200, arrayBuffer: async () => b.slice().buffer }
  }
  const mpwHash = new Function(SRC_HASH + '\nreturn mpwHash')()
  const helpers = new Function(
    [SRC_ALIASES, SRC_REPO_NAME, SRC_SOURCE_OF, SRC_NEXT_TIER, SRC_REPO_URL, SRC_WE_URL, SRC_TIER_LABEL].join('\n') +
    '\nreturn { REPO_FONT_ALIASES, repoFontNameOf, textFontSourceOf, textFontNextTier, repoFontUrl, weFontUrl, textFontTierLabel }')()
  // ①(P-135 乙 2026-09-19) demo.html 的两级网络降级现在走模块级 `fetchT/bufT/withTimeout`（统一超时包装：
  //   成功原值、失败/超时 null、成功路径零日志）。切片环境按**同一语义**注入这三个 + 两个阈值常量；
  //   被测口径（四级来源判定 / URL 形状 / 每级日志原文 / 集合语义）一字未变，只是"谁负责吞异常"换了位置。
  const fetchT = async (u) => { try { return await fetchStub(u) } catch (e) { return null } }
  const bufT = async (r) => { if (!r || !r.ok) return null; try { return await r.arrayBuffer() } catch (e) { return null } }
  const withTimeout = async (p) => { try { return await p } catch (e) { return null } }
  const ensureTextFont = new Function('lib', 'pkg', 'logf', 'mpwHash', 'Blob', 'URL', 'FontFace', 'document', 'fetch',
    'fetchT', 'bufT', 'withTimeout', 'NET_TIMEOUT_MS', 'DECODE_TIMEOUT_MS',
    'textFontLoaded', 'textFontPending', 'textFontMissing', 'textFontSourceOf', 'textFontNextTier', 'repoFontUrl', 'weFontUrl',
    'repoFontsOff', 'textFontTierLabel',
    SRC_ENSURE + '\nreturn ensureTextFont')(
    libStub, {}, logf, mpwHash, BlobStub, URLStub, FontFaceStub, documentStub, fetchStub,
    fetchT, bufT, withTimeout, 8000, 8000,
    st.loaded, st.pending, st.missing, helpers.textFontSourceOf, helpers.textFontNextTier, helpers.repoFontUrl, helpers.weFontUrl,
    repoFontsOff, helpers.textFontTierLabel)
  const familyOf = new Function('textFontLoaded', 'mpwHash', SRC_FAMILY + '\nreturn textFontFamily')(st.loaded, mpwHash)
  return { st, ensureTextFont, familyOf, mpwHash, repoFontsOff, ...helpers }
}
const LOGS = (st) => st.logs.join(' ⏎ ')

// ═══ T1 纯函数：四级来源判定 + 每一级 URL 形状（不依赖真包/服务器） ═══
console.log('[T1] 纯函数（从 demo.html 节选求值）：四级来源判定 + `/assets/fonts/` 与 `/weassist/fonts/` URL 形状')
{
  const H = mkEnv()
  check('T1a 包内字节长度 > 0 ⇒ 来源 = pkg（**包内优先**，不碰网络级）', H.textFontSourceOf(8127808) === 'pkg', H.textFontSourceOf(8127808))
  check('T1b 包内没有 ⇒ 来源 = repo（**P-86 新增的"仓库自带"一级**，不再是直接落 WE）',
    H.textFontSourceOf(0) === 'repo' && H.textFontSourceOf(undefined) === 'repo' && H.textFontSourceOf(null) === 'repo',
    [H.textFontSourceOf(0), H.textFontSourceOf(undefined), H.textFontSourceOf(null)])
  check('T1b2 `?repofonts=off` ⇒ 来源 = we（**逐位回到 P-81 三级链**：包内没有就直接问本机 WE）',
    H.textFontSourceOf(0, true) === 'we' && H.textFontSourceOf(8127808, true) === 'pkg',
    [H.textFontSourceOf(0, true), H.textFontSourceOf(8127808, true)])
  check('T1c 包内**空字节**（长度 0）也算"没有" ⇒ repo（契约："或长度为 0"）',
    H.textFontSourceOf(new Uint8Array(0).length) === 'repo')
  check('T1c2 降级顺序单一真值：repo → we → null（null = 最后落到字面量 sans-serif）',
    H.textFontNextTier('repo') === 'we' && H.textFontNextTier('we') === null && H.textFontNextTier('pkg') === null,
    [H.textFontNextTier('repo'), H.textFontNextTier('we'), H.textFontNextTier('pkg')])
  check('T1c3 三个来源标签齐备且**互不重复**（日志/上报靠它区分命中哪一级）',
    H.textFontTierLabel.pkg === '包内' && H.textFontTierLabel.repo === '仓库自带' && H.textFontTierLabel.we === 'WE 内置' &&
    new Set(Object.values(H.textFontTierLabel)).size === 3, H.textFontTierLabel)

  check('T1d 第②级 URL = /assets/fonts/<文件>（真机时钟字体 Monofur 走**别名** monof55.ttf：上游发布名）',
    H.repoFontUrl('fonts/Monofur-PK7og.ttf') === '/assets/fonts/monof55.ttf', H.repoFontUrl('fonts/Monofur-PK7og.ttf'))
  check('T1e **带空格的真 WE 自带字体**在仓库级也必须编码（`Blackout 2 AM.ttf`，仓库里就是同名文件）',
    H.repoFontUrl('fonts/Blackout 2 AM.ttf') === '/assets/fonts/Blackout%202%20AM.ttf' &&
    !H.repoFontUrl('fonts/Blackout 2 AM.ttf').includes('+') && !H.repoFontUrl('fonts/Blackout 2 AM.ttf').includes(' '),
    H.repoFontUrl('fonts/Blackout 2 AM.ttf'))
  check('T1f Twemoji 走别名（上游发布名 `Twemoji.Mozilla.ttf` 带点号）',
    H.repoFontUrl('fonts/TwemojiMozilla.ttf') === '/assets/fonts/Twemoji.Mozilla.ttf', H.repoFontUrl('fonts/TwemojiMozilla.ttf'))
  check('T1g 不在映射表里的名字**恒等**（kust / Segment7 / spincycle / 带目录前缀的 workshop 路径）',
    H.repoFontUrl('fonts/kust.ttf') === '/assets/fonts/kust.ttf' &&
    H.repoFontUrl('fonts/Segment7Standard.otf') === '/assets/fonts/Segment7Standard.otf' &&
    H.repoFontUrl('fonts/spincycle_3d_ot.otf') === '/assets/fonts/spincycle_3d_ot.otf' &&
    H.repoFontUrl('fonts/workshop/3219510589/LEMONMILK-Bold.otf') === '/assets/fonts/LEMONMILK-Bold.otf',
    [H.repoFontUrl('fonts/kust.ttf'), H.repoFontUrl('fonts/workshop/3219510589/LEMONMILK-Bold.otf')])
  check('T1h 映射表**只有**那三个键（防止有人悄悄把别的字体改名）——`8bitOperatorPlus8-Regular.ttf` 是 2026-09-18 收口时新增的（现行版 Pixel Operator 8，CC0-1.0）',
    JSON.stringify(Object.keys(H.REPO_FONT_ALIASES).sort()) === JSON.stringify(['8bitOperatorPlus8-Regular.ttf', 'Monofur-PK7og.ttf', 'TwemojiMozilla.ttf']),
    Object.keys(H.REPO_FONT_ALIASES))

  check('T1i 第③级 URL = /weassist/fonts/<basename>（真机时钟字体 Monofur，P-81 原样）',
    H.weFontUrl('fonts/Monofur-PK7og.ttf') === '/weassist/fonts/Monofur-PK7og.ttf', H.weFontUrl('fonts/Monofur-PK7og.ttf'))
  check('T1j 第③级带空格文件名必须编码（`Blackout 2 AM.ttf`，本机 WE assets/fonts 里真实存在）',
    H.weFontUrl('fonts/Blackout 2 AM.ttf') === '/weassist/fonts/Blackout%202%20AM.ttf' &&
    !H.weFontUrl('fonts/Blackout 2 AM.ttf').includes('+') && !H.weFontUrl('fonts/Blackout 2 AM.ttf').includes(' '),
    H.weFontUrl('fonts/Blackout 2 AM.ttf'))
  check('T1k 编码后 decodeURIComponent 还原出的是**basename**（服务端 decodeURIComponent 后按文件名取）',
    decodeURIComponent(H.weFontUrl('fonts/Blackout 2 AM.ttf')) === '/weassist/fonts/Blackout 2 AM.ttf' &&
    decodeURIComponent(H.weFontUrl('fonts/Monofur-PK7og.ttf').replace('/weassist/fonts/', '')) === 'Monofur-PK7og.ttf')
  check('T1l CJK basename（包内那层的 `千图马克手写体.ttf`）也被编码，URL 里不留裸非 ASCII',
    H.weFontUrl('fonts/千图马克手写体.ttf') === '/weassist/fonts/' + encodeURIComponent('千图马克手写体.ttf') &&
    !/[\u4e00-\u9fa5]/.test(H.weFontUrl('fonts/千图马克手写体.ttf')) &&
    decodeURIComponent(H.weFontUrl('fonts/千图马克手写体.ttf')) === '/weassist/fonts/千图马克手写体.ttf')
  check('T1m 没有目录前缀的裸文件名同样只取 basename（`fp.indexOf("/")` 无关）',
    H.weFontUrl('kust.ttf') === '/weassist/fonts/kust.ttf' && H.weFontUrl('a/b/c/Lazer84.ttf') === '/weassist/fonts/Lazer84.ttf')
  check('T1n 四级都没有时的字面回退是 `sans-serif`（textFontFamily 未 loaded 分支）',
    H.familyOf({ __text: { font: 'fonts/Monofur-PK7og.ttf' } }) === 'sans-serif' &&
    H.familyOf({ __text: { font: '' } }) === 'sans-serif' && H.familyOf({}) === 'sans-serif')
  check('T1o `?repofonts=off` 的解析写法与 diag-flag-check 抓取口径同形（`new URLSearchParams(location.search).get(...)`）',
    /new URLSearchParams\(location\.search\)\.get\('repofonts'\)/.test(HTML) && HTML.includes("=== 'off'"))
}

// ═══ T2 桩环境跑真源码 `ensureTextFont`：四级场景 + 集合语义 ═══
console.log('[T2] 桩 fetch/Blob/FontFace：包内 / 仓库 200 / 仓库 404→WE 200 / 异常 / 空体 / 全缺 / ?repofonts=off')
const MONO = 'fonts/Monofur-PK7og.ttf'
const QIANTU = 'fonts/千图马克手写体.ttf'
{
  // ① 包内有（8127808 B，真包千图那层的真实字节数）
  const A = mkEnv({ entries: { [QIANTU]: new Uint8Array(8127808) }, repo: 'ok', we: 'ok' })
  await A.ensureTextFont(QIANTU)
  check('T2a 包内有 ⇒ **fetch 一次都没发生**（绝不走第②③级）', A.st.fetched.length === 0, A.st.fetched)
  check('T2b 包内有 ⇒ 日志写"包内"且**不含**"仓库自带"/"WE 内置"',
    LOGS(A.st).includes('🔤 文本字体 千图马克手写体.ttf：包内') && !LOGS(A.st).includes('仓库自带') && !LOGS(A.st).includes('WE 内置'), LOGS(A.st))
  check('T2c 包内有 ⇒ textFontLoaded 命中、missing 为空、FontFace 真的注册（family = mpw-<hash>）',
    A.st.loaded.has(QIANTU) && A.st.missing.size === 0 && A.st.added.length === 1 &&
    A.st.fontFaces[0].family === 'mpw-' + A.mpwHash(QIANTU) && A.familyOf({ __text: { font: QIANTU } }) === 'mpw-' + A.mpwHash(QIANTU),
    { loaded: [...A.st.loaded], family: A.st.fontFaces[0] && A.st.fontFaces[0].family })
  check('T2d 包内有 ⇒ Blob 类型按扩展名 .ttf ⇒ font/ttf，字节就是包内那批',
    A.st.blobs.length === 1 && A.st.blobs[0].type === 'font/ttf' && A.st.blobs[0].parts[0].length === 8127808,
    A.st.blobs[0] && A.st.blobs[0].type)

  // ② 包内没有（真包时钟层）→ 第②级"仓库自带" 200
  const B = mkEnv({ entries: {}, repo: 'ok', we: 'ok' })
  await B.ensureTextFont(MONO)
  check('T2e 包内没有 ⇒ **只请求一次**，且 URL = 仓库级 `/assets/fonts/monof55.ttf`（走别名，**不碰 WE**）',
    B.st.fetched.length === 1 && B.st.fetched[0] === '/assets/fonts/monof55.ttf', B.st.fetched)
  check('T2f 仓库级 200 ⇒ 日志 = `🔤 文本字体 Monofur-PK7og.ttf：仓库自带`（P-86 真机上报要看到的原文）',
    B.st.logs.includes('🔤 文本字体 Monofur-PK7og.ttf：仓库自带'), LOGS(B.st))
  check('T2g 仓库级 200 ⇒ 字节**真的进了 FontFace**（5 字节桩体、family = mpw-<hash>）',
    B.st.blobs.length === 1 && B.st.blobs[0].parts[0].length === WE_BYTES.length &&
    B.st.blobs[0].type === 'font/ttf' && B.st.fontFaces[0].family === 'mpw-' + B.mpwHash(MONO) &&
    B.familyOf({ __text: { font: MONO } }) === 'mpw-' + B.mpwHash(MONO))
  check('T2h 仓库级 200 ⇒ loaded.add(fp)，missing 里没有它（"真的拿到字节"才 loaded）',
    B.st.loaded.has(MONO) && !B.st.missing.has(MONO) && B.st.pending.size === 0)
  check('T2h2 仓库级命中时**从不**请求 `/weassist/fonts/…`（第③级只在上一级失败后才试）',
    !B.st.fetched.some((u) => u.startsWith('/weassist/')), B.st.fetched)

  // ③ 仓库级 404（公开副本没自带这个字体）→ 落第③级本机 WE
  const C = mkEnv({ entries: {}, repo: '404', we: 'ok' })
  await C.ensureTextFont(MONO)
  check('T2i 仓库级 404 ⇒ 继续降级：两次请求，顺序 = 仓库级 → WE 级',
    C.st.fetched.length === 2 && C.st.fetched[0] === '/assets/fonts/monof55.ttf' && C.st.fetched[1] === '/weassist/fonts/Monofur-PK7og.ttf',
    C.st.fetched)
  check('T2j 仓库级 404 + WE 200 ⇒ 日志 = `…：WE 内置`（**不是**缺失），且 loaded 命中',
    C.st.logs.includes('🔤 文本字体 Monofur-PK7og.ttf：WE 内置') && C.st.loaded.has(MONO) && !C.st.missing.has(MONO), LOGS(C.st))

  // ④ 仓库级网络异常（服务器没起 / file:// 打开）→ 落第③级
  const D = mkEnv({ entries: {}, repo: 'throw', we: 'ok' })
  let threw = null
  try { await D.ensureTextFont(MONO) } catch (e) { threw = e }
  check('T2k 仓库级 fetch reject ⇒ **不抛异常**（catch(()=>null) 吞掉）且继续降级到 WE 级成功',
    threw === null && D.st.logs.includes('🔤 文本字体 Monofur-PK7og.ttf：WE 内置') && D.st.fetched.length === 2, LOGS(D.st))

  // ⑤ 仓库级 200 但空体 → 不能拿空 Blob 去 new FontFace，继续降级
  const E = mkEnv({ entries: {}, repo: 'empty', we: 'ok' })
  await E.ensureTextFont(MONO)
  check('T2l 仓库级 200 但 **0 字节** ⇒ 仍算失败 → 降级到 WE 级（不 new 空 FontFace）',
    E.st.fetched.length === 2 && E.st.logs.includes('🔤 文本字体 Monofur-PK7og.ttf：WE 内置') && E.st.fontFaces.length === 1, LOGS(E.st))

  // ⑥ 仓库级 404 + WE 级 404（公开副本没装 WE）→ 第④级 sans-serif
  const F = mkEnv({ entries: {}, repo: '404', we: '404' })
  let threw2 = null
  try { await F.ensureTextFont(MONO) } catch (e) { threw2 = e }
  check('T2m 两级都 404 ⇒ **不抛异常**（await 正常返回）', threw2 === null, threw2 && threw2.message)
  check('T2n 两级都 404 ⇒ 日志含"缺失→回退 sans-serif"且含**试过的两个 URL**（真机排查用）',
    F.st.logs.length === 1 && F.st.logs[0].includes('🔤 文本字体 Monofur-PK7og.ttf：缺失→回退 sans-serif') &&
    F.st.logs[0].includes('/assets/fonts/monof55.ttf') && F.st.logs[0].includes('/weassist/fonts/Monofur-PK7og.ttf') &&
    !F.st.logs[0].includes('WE 内置') && !F.st.logs[0].includes('仓库自带'), LOGS(F.st))
  check('T2o 两级都 404 ⇒ **不写 textFontLoaded**（语义 = 字节真的到手）、写 textFontMissing、无 FontFace/blob',
    !F.st.loaded.has(MONO) && F.st.missing.has(MONO) && F.st.fontFaces.length === 0 && F.st.blobs.length === 0 && F.st.added.length === 0,
    { loaded: [...F.st.loaded], missing: [...F.st.missing] })
  check('T2p 两级都 404 ⇒ textFontFamily 回退字面量 `sans-serif`（就是第④级要的行为）',
    F.familyOf({ __text: { font: MONO } }) === 'sans-serif', F.familyOf({ __text: { font: MONO } }))
  await F.ensureTextFont(MONO); await F.ensureTextFont(MONO)
  check('T2q missing 去重：再调两次**不再发请求也不重复打日志**（否则每帧一次 404）',
    F.st.fetched.length === 2 && F.st.logs.length === 1, { fetched: F.st.fetched.length, logs: F.st.logs.length })

  // ⑦ 仓库级 404 + WE 级网络异常
  const G = mkEnv({ entries: {}, repo: '404', we: 'throw' })
  await G.ensureTextFont(MONO)
  check('T2r WE 级 fetch reject ⇒ 同样不抛异常、落第④级（catch(()=>null) 吞掉）',
    G.st.logs[0].includes('缺失→回退 sans-serif') && !G.st.loaded.has(MONO) && G.st.missing.has(MONO), LOGS(G.st))

  // ⑧ `?repofonts=off`：整级跳过仓库自带，逐位回到 P-81 三级链
  const H2 = mkEnv({ entries: {}, repo: 'ok', we: 'ok', repoFontsOff: true })
  await H2.ensureTextFont(MONO)
  check('T2s `?repofonts=off` + WE 200 ⇒ **只请求 WE 一次**，URL = /weassist/fonts/Monofur-PK7og.ttf',
    H2.st.fetched.length === 1 && H2.st.fetched[0] === '/weassist/fonts/Monofur-PK7og.ttf', H2.st.fetched)
  check('T2t `?repofonts=off` ⇒ 日志仍是 `…：WE 内置`（命中哪一级看得见），loaded 命中',
    H2.st.logs.includes('🔤 文本字体 Monofur-PK7og.ttf：WE 内置') && H2.st.loaded.has(MONO), LOGS(H2.st))
  check('T2u `?repofonts=off` ⇒ **完全不请求** `/assets/fonts/**`（关掉就是关掉）',
    !H2.st.fetched.some((u) => u.startsWith('/assets/fonts/')), H2.st.fetched)
  const H3 = mkEnv({ entries: {}, repo: 'ok', we: '404', repoFontsOff: true })
  await H3.ensureTextFont(MONO)
  check('T2v `?repofonts=off` + WE 404 ⇒ missing + 日志写明"被回退开关关闭"，**不误导成"拿不到"**',
    H3.st.fetched.length === 1 && H3.st.missing.has(MONO) &&
    H3.st.logs[0].includes('?repofonts=off 关了仓库自带一级') && H3.st.logs[0].includes('缺失→回退 sans-serif'), LOGS(H3.st))
  const H4 = mkEnv({ entries: { [MONO]: new Uint8Array(32) }, repoFontsOff: true })
  await H4.ensureTextFont(MONO)
  check('T2w `?repofonts=off` 不影响第①级：包内有照样走包内、零 fetch',
    H4.st.fetched.length === 0 && H4.st.logs.includes('🔤 文本字体 Monofur-PK7og.ttf：包内'), LOGS(H4.st))

  // ⑨ 包内**空字节**（长度为 0）也必须落第②级
  const I = mkEnv({ entries: { [MONO]: new Uint8Array(0) }, repo: 'ok', we: 'ok' })
  await I.ensureTextFont(MONO)
  check('T2x 包内条目存在但长度为 0 ⇒ 照样走第②级（契约："包内没有**或长度为 0**"）',
    I.st.fetched.length === 1 && I.st.fetched[0] === '/assets/fonts/monof55.ttf' &&
    I.st.logs.includes('🔤 文本字体 Monofur-PK7og.ttf：仓库自带'), LOGS(I.st))

  // ⑩ systemfont_* 完全不进链
  const J = mkEnv({ entries: {}, repo: 'ok', we: 'ok' })
  await J.ensureTextFont('systemfont_arial')
  check('T2y `systemfont_*` 不进链：不发请求、不入任何集合，family 直接是真名 Arial',
    J.st.fetched.length === 0 && J.st.loaded.size === 0 && J.st.missing.size === 0 &&
    J.familyOf({ __text: { font: 'systemfont_arial' } }) === 'Arial', LOGS(J.st))

  // ⑪ 现有 catch 分支（FontFace.load 抛错）保持改动前行为与日志
  const K = mkEnv({ entries: { [QIANTU]: new Uint8Array(16) }, repo: 'ok', we: 'ok', faceLoadThrows: true })
  await K.ensureTextFont(QIANTU)
  check('T2z 保留现有异常日志 `⚠ 文本字体加载失败 …`，且不再挂起（pending 清空）',
    K.st.logs.some((m) => m.startsWith('⚠ 文本字体加载失败 ' + QIANTU) && m.includes('字体解析失败(桩)')) && K.st.pending.size === 0,
    LOGS(K.st))

  // ⑫ 别名 + 空格 URL（用真字节，走仓库级）
  const L = mkEnv({ entries: {}, repo: 'ok', repoBytes: fs.existsSync(path.join(FONT_DIR, 'spincycle_3d_ot.otf')) ? new Uint8Array(fs.readFileSync(path.join(FONT_DIR, 'spincycle_3d_ot.otf'))) : WE_BYTES })
  await L.ensureTextFont('fonts/spincycle_3d_ot.otf')
  check('T2aa 仓库级 URL 对未重命名文件恒等（spincycle_3d_ot.otf）且 Blob 类型按 .otf ⇒ font/otf',
    L.st.fetched[0] === '/assets/fonts/spincycle_3d_ot.otf' && L.st.blobs[0].type === 'font/otf' &&
    L.st.logs.includes('🔤 文本字体 spincycle_3d_ot.otf：仓库自带'), LOGS(L.st))
  const M = mkEnv({ entries: {}, repo: 'ok' })
  await M.ensureTextFont('fonts/Blackout 2 AM.ttf')
  check('T2ab 带空格文件名在仓库级也走编码 URL，且日志里的名字仍是**原文**（真机好对号）',
    M.st.fetched[0] === '/assets/fonts/Blackout%202%20AM.ttf' && M.st.logs.includes('🔤 文本字体 Blackout 2 AM.ttf：仓库自带'),
    [M.st.fetched, LOGS(M.st)])
}

// ═══ T2s 源码级回归守卫（钉死语义，防止改回"没拿到也 loaded"或把某一级写丢） ═══
console.log('[T2s] 源码级守卫：textFontLoaded 语义 + 四级链完整 + 调用点不挂起')
{
  check('T2s1 旧的 `if (!bytes) { textFontLoaded.add(fp); return }` 已删除（它会顶掉后面几级兜底）',
    !/if \(!bytes\) \{ textFontLoaded\.add\(fp\); return \}/.test(HTML))
  check('T2s2 缺失路径写的是 `textFontMissing.add(fp)` 且**同分支内**没有 `textFontLoaded.add(fp)`',
    /if \(!bytes \|\| !bytes\.length\) \{[\s\S]{0,400}?textFontMissing\.add\(fp\)[\s\S]{0,400}?return\s*\}[\s\S]{0,200}?const blob/.test(SRC_ENSURE) &&
    !/textFontMissing\.add\(fp\)[\s\S]{0,120}?textFontLoaded\.add\(fp\)/.test(SRC_ENSURE))
  check('T2s3 四级来源都在（包内 getEntry / repoFontUrl / weFontUrl / 缺失回退）且日志各带来源标签',
    /lib\.getEntry\(pkg, fp\)/.test(SRC_ENSURE) && /repoFontUrl\(fp\)/.test(SRC_ENSURE) && /weFontUrl\(fp\)/.test(SRC_ENSURE) &&
    /repoFontsOff/.test(SRC_ENSURE) && /缺失→回退 sans-serif/.test(SRC_ENSURE) &&
    /textFontTierLabel = \{ pkg: '包内', repo: '仓库自带', we: 'WE 内置' \}/.test(HTML))
  check('T2s4 `ensureTextFont` 早退包含 textFontMissing（否则每帧重发 404）',
    /textFontLoaded\.has\(fp\) \|\| textFontMissing\.has\(fp\)/.test(SRC_ENSURE))
  check('T2s5 **调用点** `ensureTextTexture` 也认 missing（否则缺字体的层每帧 return false、永远不渲染）',
    /if \(t\.font && !textFontLoaded\.has\(t\.font\) && !textFontMissing\.has\(t\.font\)\) \{ ensureTextFont\(t\.font\); return false \}/.test(HTML))
  // ①(P-135 乙 2026-09-19) 口径更新：网络级取字节改为 `bufT(await fetchT(url, …))`（统一超时包装）。
  //   "ok 才取字节 + 异常吞掉"的语义**没有变**，只是搬进那两个 helper（T2s6b 直接断言 helper 的源码语义）。
  check('T2s6 网络级取字节仍"ok 才取字节 + 异常吞掉"（P-135 乙 起 = bufT(await fetchT(url, …))）',
    /bufT\(await fetchT\(url, null, NET_TIMEOUT_MS, '文本字体'\), url, NET_TIMEOUT_MS, '文本字体字节'\)/.test(SRC_ENSURE))
  check('T2s6b helper 语义未走样：bufT 非 ok 不读正文 / fetchT 带超时 / withTimeout 到点返回 null',
    /function bufT\(r, url, ms, label\) \{\s*\n\s*if \(!r \|\| !r\.ok\) return Promise\.resolve\(null\)/.test(HTML) &&
    /function fetchT\(url, opts, ms, label\) \{\s*\n\s*const lim = ms \|\| NET_TIMEOUT_MS/.test(HTML) &&
    /function withTimeout\(p, ms, label\) \{/.test(HTML) && /MPW_TIMED_OUT/.test(HTML))
  check('T2s7 降级是**逐级**的：循环里先取当前级 URL，失败才 `textFontNextTier`（不是一次并发全试）',
    /while \(tier !== 'pkg' && \(!bytes \|\| !bytes\.length\)\) \{[\s\S]{0,600}?tier = textFontNextTier\(tier\)/.test(SRC_ENSURE))
  check('T2s8 服务端有 `/assets/fonts/(.+)` 路由，且带 `startsWith(base)` 穿越防护与 font/ttf·font/otf content-type',
    /p\.match\(\/\^\\\/assets\\\/fonts\\\/\(\.\+\)\$\/\)/.test(fs.readFileSync(SERVER, 'utf8')) &&
    /const base = path\.join\(REPO_ROOT, 'assets', 'fonts'\)/.test(fs.readFileSync(SERVER, 'utf8')) &&
    /full\.startsWith\(base\)/.test(fs.readFileSync(SERVER, 'utf8')) &&
    /'font\/ttf'/.test(fs.readFileSync(SERVER, 'utf8')) && /'font\/otf'/.test(fs.readFileSync(SERVER, 'utf8')))
}

// ═══ T4 仓库资产 / 许可 / 文档一致性（不依赖真包；真的算一遍 sha256） ═══
console.log('[T4] 仓库自带字体：文件 / sha256 / 映射表 / 许可文件 / THIRD-PARTY 条目 / 回链 / 未收录项')
{
  const doc = fs.existsSync(THIRD_PARTY) ? fs.readFileSync(THIRD_PARTY, 'utf8') : ''
  check('T4a THIRD-PARTY.md 存在且有 `## 4. Fonts bundled with this project` 一节', doc.includes('## 4. Fonts bundled with this project'))
  check('T4a2 该节指向调研原始记录 docs/FONT-REDISTRIBUTION-RESEARCH.md（不把改动写进那份记录）',
    doc.includes('docs/FONT-REDISTRIBUTION-RESEARCH.md'))
  check('T4b 每个字体文件存在、字节数与冻结契约一致、**sha256 与 THIRD-PARTY.md 里记录的一致**（真算）',
    REPO_FONTS.every((f) => {
      const p = path.join(FONT_DIR, f.file)
      if (!fs.existsSync(p)) return false
      const st = fs.statSync(p), sha = sha256(p)
      return st.size === f.bytes && sha === f.sha && doc.includes(sha) && doc.includes(f.file)
    }), REPO_FONTS.map((f) => [f.file, fs.existsSync(path.join(FONT_DIR, f.file)) ? sha256(path.join(FONT_DIR, f.file)) : 'MISSING']))
  check('T4b2 每个字体文件的 sfnt 魔数与扩展名相符（.ttf ⇒ 00010000、.otf ⇒ 4f54544f/OTTO）',
    REPO_FONTS.every((f) => magic4(fs.readFileSync(path.join(FONT_DIR, f.file))) === f.magic),
    REPO_FONTS.map((f) => [f.file, magic4(fs.readFileSync(path.join(FONT_DIR, f.file)))]))
  check('T4c assets/fonts/ 下**没有**未登记的字体文件（每个 .ttf/.otf 都在冻结契约里）',
    fs.readdirSync(FONT_DIR).filter((f) => /\.(ttf|otf)$/i.test(f)).sort().join('|') === REPO_FONTS.map((f) => f.file).sort().join('|'),
    fs.readdirSync(FONT_DIR).filter((f) => /\.(ttf|otf)$/i.test(f)))
  check('T4d 许可/声明文件齐全（OFL 逐字体 + Apache 全文 + CC-BY 归属声明 + spincycle TOU/README + monofur 声明与作者邮件）',
    LICENSE_FILES.every((f) => fs.existsSync(path.join(LIC_DIR, f))), LICENSE_FILES.filter((f) => !fs.existsSync(path.join(LIC_DIR, f))))
  check('T4d2 OFL 全文真的在（每份 OFL 文件都含前言 + "Permission is hereby granted, free of charge" 正文与 `SIL Open Font License` 抬头）',
    ['OFL-Blackout.markdown', 'OFL-Monofur-debian-copyright.txt', 'OFL-NotoSans.txt', 'OFL-RobotoMono.txt', 'OFL-Segment7.txt']
      .every((f) => {
        const t = fs.readFileSync(path.join(LIC_DIR, f), 'utf8')
        return /SIL Open Font License/i.test(t) && /Preamble/i.test(t) && /Permission is hereby granted, free of charge/.test(t)
      }))
  check('T4d3 Apache 全文 + CC-BY 归属声明（含许可链接与"未修改"声明）齐备',
    /Apache License/.test(fs.readFileSync(path.join(LIC_DIR, 'Apache-2.0.txt'), 'utf8')) &&
    /creativecommons\.org\/licenses\/by\/4\.0/.test(fs.readFileSync(path.join(LIC_DIR, 'CC-BY-4.0-Twemoji-attribution.txt'), 'utf8')) &&
    /NONE\./m.test(fs.readFileSync(path.join(LIC_DIR, 'CC-BY-4.0-Twemoji-attribution.txt'), 'utf8')))
  check('T4e 映射表与磁盘一致：每个"WE 引用名"经 repoFontUrl 得到的文件都**真的存在**',
    REPO_FONTS.every((f) => {
      const m = /^\/assets\/fonts\/(.+)$/.exec(new Function(SRC_ALIASES + '\n' + SRC_REPO_NAME + '\n' + SRC_REPO_URL + '\nreturn repoFontUrl')()(f.ref))
      return m && fs.existsSync(path.join(FONT_DIR, decodeURIComponent(m[1])))
    }), REPO_FONTS.map((f) => f.ref))
  check('T4f assets/fonts/README.md 存在，含**回链 bvfonts.com** + 每个字体文件名 + 指向 THIRD-PARTY.md',
    fs.existsSync(FONTS_README) && /bvfonts\.com/.test(fs.readFileSync(FONTS_README, 'utf8')) &&
    REPO_FONTS.every((f) => fs.readFileSync(FONTS_README, 'utf8').includes(f.file)) &&
    /THIRD-PARTY\.md/.test(fs.readFileSync(FONTS_README, 'utf8')))
  check('T4g demo.html（渲染器源码）里也有 bvfonts.com 回链/署名（条件③"显著处回链"的第三处）',
    /bvfonts\.com/.test(HTML))
  // ①(P-111 2026-09-17 修回归) 旧断言写死了英文列名 `How this repository satisfies it` —— **已过时**：
  //   本轮文档整理把 §4.6.1 的表改成**双语三列**「逐条义务（作者条款原话 / the author's words）｜
  //   我们如何满足（how we satisfy it）｜待律师确认项（pending counsel）」，并把旧表第三列 `Evidence`
  //   逐条并进"如何满足"列、另起「未定项」段（正是不许把"已满足"与"待确认"混为一谈的那条要求）。
  //   断言改成**按新口径判同一件事**：逐条件对照表在 + 作者原话列在 + 我们如何满足列在 + 证据
  //   （官方字节数与 WE 副本之差）留在本节内 + 待确认项如实分列；不再钉某一句英文措辞。
  const spinSec = (doc.match(/#### 4\.6\.1[\s\S]*?(?=\n### 4\.7)/) || [''])[0]
  const spinRows = (spinSec.match(/^\|\s*[1-9]\s*\|/gm) || []).length
  check('T4h THIRD-PARTY.md 的 Spin Cycle 节有逐条件对照表（作者原话 / 我们如何满足 / 证据 + 待确认项分列）',
    /condition by condition/.test(doc)
    && /逐条义务（作者条款原话 \/ the author's words）/.test(spinSec)
    && /我们如何满足（how we satisfy it）/.test(spinSec)
    && /待律师确认项（pending counsel）/.test(spinSec)
    && spinRows >= 6
    && /bvfonts\.com\/fonts\/details\.php\?id=44/.test(spinSec)
    && /44,228/.test(spinSec) && /44,640/.test(spinSec) && /sha256/.test(spinSec)
    && /未定项/.test(spinSec), 'rows=' + spinRows + ' len=' + spinSec.length)
  check('T4h2 spincycle TOU 快照文件带**抓取日期**与页面 sha256（作者保留改条款的权利 ⇒ 必须留快照）',
    /Fetched:\s+2026-09-15/.test(fs.readFileSync(path.join(LIC_DIR, 'spincycle-bvfonts-TOU.txt'), 'utf8')) &&
    /46b8adfc72583bc6d003f272fd377ff14c76fd07dd5e4f96be56506f80434fc9/.test(fs.readFileSync(path.join(LIC_DIR, 'spincycle-bvfonts-TOU.txt'), 'utf8')))
  check('T4i Spin Cycle 用的是**作者官方 zip 里那份**（sha256 = 报告 §2.6 记的官方 build），**不是** WE 目录那份旧 build',
    sha256(path.join(FONT_DIR, 'spincycle_3d_ot.otf')) === SPIN_OFFICIAL_SHA &&
    sha256(path.join(FONT_DIR, 'spincycle_3d_ot.otf')) !== SPIN_WE_SHA)
  check('T4j monofur 走 OFL 路径：Debian copyright（含 OFL 全文）+ 作者本人 2018 邮件 + 上游随附声明文件都在',
    /SIL-OFL-1\.1/.test(fs.readFileSync(path.join(LIC_DIR, 'OFL-Monofur-debian-copyright.txt'), 'utf8')) &&
    /licensed under SIL Open Font License version 1\.1/.test(fs.readFileSync(path.join(LIC_DIR, 'monofur-author-OFL-email.txt'), 'utf8')) &&
    /freeware and can be distributed as long as they are[\s\S]{0,20}?together with this text file/.test(fs.readFileSync(path.join(LIC_DIR, 'monofur-monof_tt-notice.txt'), 'utf8')))
  check('T4k 未收录项**确实没被塞进仓库**（7 个查不到再分发授权的字体）',
    NOT_BUNDLED.every((f) => !fs.existsSync(path.join(FONT_DIR, f))),
    NOT_BUNDLED.filter((f) => fs.existsSync(path.join(FONT_DIR, f))))
  check('T4k2 THIRD-PARTY.md §4.7 如实记录了 8bitOperator 的**收口**（旧版 undownloadable / 现行版 CC0-1.0 / 字形不完全相同）与早先试过的渠道',
    /### 4\.7/.test(doc) && /8bitOperatorPlus8-Regular\.ttf/.test(doc) && /Pixel Operator/.test(doc) && /CC0/.test(doc) &&
    /undownloadable/i.test(doc) && /deviantart/i.test(doc) && /404s/.test(doc) && /0 hits/.test(doc))
  if (fs.existsSync(WE_FONT_DIR)) {
    check('T4l （信息项）仓库文件与 WE 目录副本的关系与 THIRD-PARTY §4.4 记载一致：Blackout/monofur 同哈希、spincycle 必不同',
      sha256(path.join(WE_FONT_DIR, 'Blackout 2 AM.ttf')) === REPO_FONTS[0].sha &&
      sha256(path.join(WE_FONT_DIR, 'Monofur-PK7og.ttf')) === REPO_FONTS[1].sha &&
      sha256(path.join(WE_FONT_DIR, 'spincycle_3d_ot.otf')) === SPIN_WE_SHA)
  } else {
    console.log('  · （信息项跳过）本机没有 WE 目录 ' + WE_FONT_DIR + '：跳过"与 WE 副本关系"对照')
  }
}

// ═══ T5 真服务器：`/assets/fonts/**` 路由（200/404/穿越/content-type/magic/字节数） ═══
console.log('[T5] 真服务器：/assets/fonts/<名> 200 + content-type + 字节数 + magic；未知 404；%2e%2e%2f 穿越 404')
{
  const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) }) })
  const port = await freePort()
  const base = 'http://127.0.0.1:' + port
  let child = null
  try {
    child = spawn(process.execPath, [SERVER], {
      cwd: HERE,
      env: { ...process.env, PORT: String(port), MPW_SCENE_ROOT: SCENE_ROOT, MPW_PKG_EXTRACT: path.join(path.dirname(HERE), 'dsh-mpkg-wallpaper', 'lib', 'pkg-extract.js') },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let ready = false
    for (let i = 0; i < 40 && !ready; i++) {
      try { await fetch(base + '/diag-flags.json', { signal: AbortSignal.timeout(800) }); ready = true } catch { await new Promise((r) => setTimeout(r, 200)) }
    }
    check('T5a 服务器在随机空闲端口起来了（/diag-flags.json 可达）', ready)

    for (const f of REPO_FONTS) {
      const r = await fetch(base + '/assets/fonts/' + encodeURIComponent(f.file))
      const buf = Buffer.from(await r.arrayBuffer())
      check('T5b `' + f.file + '` → 200 + ' + f.type + ' + ' + f.bytes + ' B + magic ' + f.magic,
        r.status === 200 && (r.headers.get('content-type') || '') === f.type && buf.length === f.bytes && magic4(buf) === f.magic,
        [r.status, r.headers.get('content-type'), buf.length, magic4(buf)])
    }
    const rSpace = await fetch(base + '/assets/fonts/Blackout%202%20AM.ttf')
    check('T5c 带空格文件名（%20 编码）也 200（浏览器端 encodeURIComponent 后的真实形态）',
      rSpace.status === 200 && (await rSpace.arrayBuffer()).byteLength === 28308, rSpace.status)
    const rAlias = await fetch(base + '/assets/fonts/Twemoji.Mozilla.ttf')
    check('T5d 别名文件名 `Twemoji.Mozilla.ttf` 200（映射表的落点真的是磁盘上这个名字）',
      rAlias.status === 200 && (await rAlias.arrayBuffer()).byteLength === 1474284, rAlias.status)
    const rLic = await fetch(base + '/assets/fonts/licenses/spincycle-bvfonts-TOU.txt')
    const licText = await rLic.text()
    check('T5e `licenses/` 也能取到（text/plain）+ 里面确实有 bvfonts.com 回链',
      rLic.status === 200 && (rLic.headers.get('content-type') || '').startsWith('text/plain') && /bvfonts\.com/.test(licText),
      [rLic.status, rLic.headers.get('content-type')])
    const r404 = await fetch(base + '/assets/fonts/NoSuchFont.ttf')
    check('T5f 不存在的字体 → 404（不是 200 空体）', r404.status === 404, r404.status)
    const rNotBundled = await fetch(base + '/assets/fonts/8bitOperatorPlus8-Regular.ttf')
    check('T5g **未收录**的字体（8bitOperator…）→ 404（证明真的没被塞进仓库）', rNotBundled.status === 404, rNotBundled.status)
    const rTrav = await fetch(base + '/assets/fonts/%2e%2e%2f%2e%2e%2fpackage.json')
    check('T5h 路径穿越（`%2e%2e%2f` 编码的 ../..）→ 404，**不**泄漏仓库外文件', rTrav.status === 404, rTrav.status)
    const rTrav2 = await fetch(base + '/assets/fonts/%2e%2e%2fdemo.html')
    check('T5h2 相邻目录探测（`%2e%2e%2fdemo.html`）→ 404', rTrav2.status === 404, rTrav2.status)
    const rWe = await fetch(base + '/weassist/fonts/' + encodeURIComponent('Monofur-PK7og.ttf'))
    check('T5i 第③级路由（/weassist/fonts/）仍在（本机装了 WE ⇒ 200；没装 ⇒ 404，两种都算通过）',
      rWe.status === 200 || rWe.status === 404, rWe.status)
  } finally {
    if (child) { try { child.kill('SIGKILL') } catch {} }
  }
}

// ═══ T3 真包 3554161528（hina）真数据 ═══
const hinaOk = fs.existsSync(path.join(PKG_HINA, 'scene.pkg'))
if (!hinaOk) {
  console.log('SKIP T3 真包 ' + PKG_HINA + '/scene.pkg 不存在（条件项）')
} else {
  console.log('[T3] 真包 3554161528（hina）：时钟层缺字体 ⇒ 第②级"仓库自带"（用仓库真文件当响应体）')
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(path.join(PKG_HINA, 'scene.pkg'))))
  const scene = JSON.parse(new TextDecoder().decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, ''))
  const objs = scene.objects || scene.layers || []      // 官方 scene.json 顶层是 `objects`（不是 `layers`）
  const fontEntries = pkg.entries.filter((e) => /\.(ttf|otf)$/i.test(e.name)).map((e) => e.name)
  check('T3a 真包字体条目清单就是这一条（⇒ 时钟层的 Monofur 确实不在包内）',
    fontEntries.length === 1 && fontEntries[0] === QIANTU, fontEntries)
  check('T3b `lib.getEntry(pkg, "fonts/Monofur-PK7og.ttf")` === null（第①级拿不到）',
    lib.getEntry(pkg, MONO) === null)
  const q = lib.getEntry(pkg, QIANTU)
  check('T3c 包内那层 `fonts/千图马克手写体.ttf` 真的有字节（8127808 B）',
    !!q && q.length === 8127808, q && q.length)
  const textLayers = objs.filter((l) => l.text)
  const clock = textLayers.find((l) => l.font === MONO)
  const packIn = textLayers.find((l) => l.font === QIANTU)
  check('T3d scene.json 里恰好两层文本，字体分别是 Monofur（时钟）与千图马克（另一层）',
    textLayers.length === 2 && !!clock && !!packIn, textLayers.map((l) => [l.id, l.font]))
  check('T3e 时钟层 id398 引用的就是 `fonts/Monofur-PK7og.ttf`（= 用户第 1 项那个时钟）',
    !!clock && clock.id === 398, clock && { id: clock.id, font: clock.font })

  // 端到端：真包 + **仓库里那个真文件** ⇒ 时钟层必须命中第②级并把真字节交给 FontFace
  const monoReal = new Uint8Array(fs.readFileSync(path.join(FONT_DIR, 'monof55.ttf')))
  const A = mkEnv({
    entries: Object.fromEntries(pkg.entries.filter((e) => /\.(ttf|otf)$/i.test(e.name)).map((e) => [e.name, lib.getEntry(pkg, e.name)])),
    repo: 'ok', we: 'ok', repoBytes: monoReal,
  })
  await A.ensureTextFont(clock.font)
  check('T3f **端到端**：真包字节 + 时钟层 font ⇒ 命中第②级"仓库自带"，URL = /assets/fonts/monof55.ttf，**不碰 WE**',
    A.st.fetched.length === 1 && A.st.fetched[0] === '/assets/fonts/monof55.ttf' &&
    A.st.logs.includes('🔤 文本字体 Monofur-PK7og.ttf：仓库自带'), LOGS(A.st))
  check('T3f2 **端到端**：交给 FontFace 的字节 = 仓库真文件（169,452 B + sfnt magic 00010000），family = mpw-<hash>',
    A.st.blobs.length === 1 && A.st.blobs[0].parts[0].length === 169452 &&
    magic4(A.st.blobs[0].parts[0]) === '00010000' &&
    A.st.fontFaces[0].family === 'mpw-' + A.mpwHash(MONO))
  check('T3f3 **端到端**：textFontFamily(时钟层) 返回已注册的 `mpw-<hash>`（⇒ 该层真的会用这个字体，而不是 sans-serif）',
    A.familyOf({ __text: { font: clock.font } }) === 'mpw-' + A.mpwHash(MONO),
    A.familyOf({ __text: { font: clock.font } }))
  await A.ensureTextFont(packIn.font)
  check('T3g **端到端**：包内那层（千图马克）仍走第①级，fetch 总数**仍然是 1**（包内有就绝不走网络级）',
    A.st.fetched.length === 1 && A.st.loaded.has(QIANTU) && A.st.logs.includes('🔤 文本字体 千图马克手写体.ttf：包内'), LOGS(A.st))
  // `?repofonts=off` 在同一真包上逐位回到 P-81（WE 级）
  const A2 = mkEnv({
    entries: Object.fromEntries(pkg.entries.filter((e) => /\.(ttf|otf)$/i.test(e.name)).map((e) => [e.name, lib.getEntry(pkg, e.name)])),
    repo: 'ok', we: 'ok', repoFontsOff: true,
  })
  await A2.ensureTextFont(clock.font)
  check('T3h `?repofonts=off` + 真包 ⇒ 时钟层回到第③级（只请求 /weassist/fonts/Monofur-PK7og.ttf，日志 `WE 内置`）',
    A2.st.fetched.length === 1 && A2.st.fetched[0] === '/weassist/fonts/Monofur-PK7og.ttf' &&
    A2.st.logs.includes('🔤 文本字体 Monofur-PK7og.ttf：WE 内置'), LOGS(A2.st))
}

// ═══ T3b 真包 3327063360（砂狼白子）真数据：时钟引用 spincycle_3d_ot.otf ═══
if (!fs.existsSync(path.join(PKG_SHIROKO, 'scene.pkg'))) {
  console.log('SKIP T3b 真包 ' + PKG_SHIROKO + '/scene.pkg 不存在（条件项）')
} else {
  console.log('[T3b] 真包 3327063360（砂狼白子）：时钟层引用 spincycle_3d_ot.otf ⇒ 第②级"仓库自带"')
  const SPIN = 'fonts/spincycle_3d_ot.otf'
  const pkg2 = lib.parsePkg(new Uint8Array(fs.readFileSync(path.join(PKG_SHIROKO, 'scene.pkg'))))
  const scene2 = JSON.parse(new TextDecoder().decode(lib.getEntry(pkg2, 'scene.json')).replace(/^\uFEFF/, ''))
  const objs2 = scene2.objects || scene2.layers || []
  const clocks = objs2.filter((l) => l.text && l.font === SPIN)
  check('T3b1 该包的文本层里有人引用 `fonts/spincycle_3d_ot.otf`（时钟字体）', clocks.length >= 1, clocks.map((l) => l.id))
  check('T3b2 默认可见的那个 Clock 变体 id639 就是 spincycle（P-85 已裁定 639 的 condition=4 == 默认值）',
    clocks.some((l) => l.id === 639), clocks.map((l) => l.id))
  check('T3b3 spincycle 不在包内（第①级拿不到）⇒ 只能靠第②/③级',
    lib.getEntry(pkg2, SPIN) === null)
  const spinReal = new Uint8Array(fs.readFileSync(path.join(FONT_DIR, 'spincycle_3d_ot.otf')))
  const S = mkEnv({
    entries: Object.fromEntries(pkg2.entries.filter((e) => /\.(ttf|otf)$/i.test(e.name)).map((e) => [e.name, lib.getEntry(pkg2, e.name)])),
    repo: 'ok', we: 'ok', repoBytes: spinReal,
  })
  await S.ensureTextFont(SPIN)
  check('T3b4 **端到端**：命中第②级"仓库自带"，URL = /assets/fonts/spincycle_3d_ot.otf（恒等名），日志可读',
    S.st.fetched.length === 1 && S.st.fetched[0] === '/assets/fonts/spincycle_3d_ot.otf' &&
    S.st.logs.includes('🔤 文本字体 spincycle_3d_ot.otf：仓库自带'), LOGS(S.st))
  check('T3b5 **端到端**：交给 FontFace 的字节 = 作者官方 build（44,228 B + OTTO magic），family = mpw-<hash>',
    S.st.blobs.length === 1 && S.st.blobs[0].parts[0].length === 44228 && magic4(S.st.blobs[0].parts[0]) === '4f54544f' &&
    S.st.fontFaces[0].family === 'mpw-' + S.mpwHash(SPIN) && S.st.blobs[0].type === 'font/otf')
  check('T3b6 **端到端**：textFontFamily(白子时钟层) 返回已注册的 `mpw-<hash>`（⇒ 时钟真的用上这个字形）',
    S.familyOf({ __text: { font: SPIN } }) === 'mpw-' + S.mpwHash(SPIN))
  const S2 = mkEnv({
    entries: Object.fromEntries(pkg2.entries.filter((e) => /\.(ttf|otf)$/i.test(e.name)).map((e) => [e.name, lib.getEntry(pkg2, e.name)])),
    repo: 'ok', we: '404', repoFontsOff: true,
  })
  await S2.ensureTextFont(SPIN)
  check('T3b7 `?repofonts=off` ⇒ 同一时钟层回到第③级；本机 WE 也没有时落 `sans-serif`（日志含被关说明）',
    S2.st.fetched.length === 1 && S2.st.fetched[0] === '/weassist/fonts/spincycle_3d_ot.otf' &&
    S2.st.missing.has(SPIN) && S2.familyOf({ __text: { font: SPIN } }) === 'sans-serif', LOGS(S2.st))
}

// ═══ T6（可选）真浏览器端到端：真服务器 + 真包 + 无头 chromium ═══
if (process.env.MPW_FONT_E2E === '1') {
  console.log('[T6] 真浏览器端到端（MPW_FONT_E2E=1）：demo 日志里的来源行必须是"仓库自带"')
  const freePort = () => new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) }) })
  const port = await freePort()
  const base = 'http://127.0.0.1:' + port
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-font-e2e-'))
  let child = null, browser = null
  try {
    child = spawn(process.execPath, [SERVER], {
      cwd: HERE,
      env: {
        ...process.env, PORT: String(port),
        MPW_ROOT: tmpRoot,                                                   // 假根：下面 WE 资产目录也指到假根 ⇒ /weassist 必 404
        MPW_WE_ASSETS: path.join(tmpRoot, 'wallpaper_engine', 'assets'),
        MPW_SCENE_ROOT: SCENE_ROOT,
        MPW_REPORTS_DIR: path.join(tmpRoot, 'reports'),
        MPW_PKG_EXTRACT: path.join(path.dirname(HERE), 'dsh-mpkg-wallpaper', 'lib', 'pkg-extract.js'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let ready = false
    for (let i = 0; i < 40 && !ready; i++) {
      try { await fetch(base + '/diag-flags.json', { signal: AbortSignal.timeout(800) }); ready = true } catch { await new Promise((r) => setTimeout(r, 200)) }
    }
    const weOff = await fetch(base + '/weassist/fonts/Monofur-PK7og.ttf')
    check('T6a 前提成立：本轮的 `/weassist/fonts/` 是 404（WE 资产目录指向不存在的假根）⇒ 命中第②级只可能是仓库自带',
      weOff.status === 404, weOff.status)
    const PW = process.env.MPW_PLAYWRIGHT || path.join(WS, 'dsh-mpkg-wallpaper', 'node_modules', 'playwright', 'index.mjs')
    const { chromium } = await import(PW)
    browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox', '--disable-dev-shm-usage'] })
    const grab = async (url) => {
      const page = await browser.newPage({ viewport: { width: 640, height: 360 } })
      const console_ = []
      page.on('console', (m) => console_.push(m.text()))
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.waitForTimeout(9000)
      const log = await page.evaluate(() => (document.getElementById('log') ? document.getElementById('log').textContent : ''))
      await page.close()
      return log + '\n' + console_.join('\n')
    }
    const logOn = await grab(base + '/?id=3554161528&noreport=1')
    check('T6b 真机日志出现 `🔤 文本字体 Monofur-PK7og.ttf：仓库自带`（四级链第②级真的生效）',
      logOn.includes('🔤 文本字体 Monofur-PK7og.ttf：仓库自带'), logOn.split('\n').filter((l) => l.includes('文本字体')).slice(0, 6))
    check('T6b2 同一轮里 Monofur **没有**出现"WE 内置"/"缺失→回退"（证明命中的确实是第②级）',
      !/Monofur-PK7og\.ttf：WE 内置/.test(logOn) && !/Monofur-PK7og\.ttf：缺失/.test(logOn),
      logOn.split('\n').filter((l) => l.includes('Monofur')).slice(0, 4))
    const logSpin = await grab(base + '/?id=3327063360&noreport=1')
    check('T6c 白子 3327063360 真机日志出现 `🔤 文本字体 spincycle_3d_ot.otf：仓库自带`（时钟字形来自仓库）',
      logSpin.includes('🔤 文本字体 spincycle_3d_ot.otf：仓库自带'), logSpin.split('\n').filter((l) => l.includes('spincycle')).slice(0, 4))
    const logOff = await grab(base + '/?id=3554161528&noreport=1&repofonts=off')
    check('T6d `?repofonts=off` 真机日志：Monofur 变成"缺失→回退 sans-serif"+写明被开关关闭（回到 P-81 三级）',
      /Monofur-PK7og\.ttf：缺失→回退 sans-serif/.test(logOff) && /repofonts=off 关了仓库自带一级/.test(logOff),
      logOff.split('\n').filter((l) => l.includes('Monofur') || l.includes('repofonts')).slice(0, 4))
  } finally {
    if (browser) { try { await browser.close() } catch {} }
    if (child) { try { child.kill('SIGKILL') } catch {} }
  }
} else {
  console.log('· T6 真浏览器端到端未跑（要跑：MPW_FONT_E2E=1 node text-font-fallback-test.mjs；⚠ 本机 chromium 在 proot 容器里跑 demo 会崩/挂起，见文件头说明）')
}

console.log('\n' + (fail ? '✗' : '✅') + ' text-font-fallback-test：' + pass + ' 断言通过 / ' + fail + ' 失败')
process.exit(fail ? 1 : 0)
