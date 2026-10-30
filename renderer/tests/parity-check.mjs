#!/usr/bin/env node
// parity-check.mjs — W11 平价基线（任务书 C1）：真机 GPU 实际画的 vs CPU 预览基准，逐层对账
//
// 解决什么事故：本项目三次栽在「CPU 预览对、真机 GL 错」且没人及时发现——
//   ① 附件锚点（19 个附件层整体偏移数百 px）② 脚本 origin 覆盖（raw.origin 抹掉锚点）
//   ③ ownSizes 把附件层尺寸换成网格 bbox（人物被拉伸 ~1/1.9）。
//   每次都靠人肉看截图才发现。本工具把「两端一致性」变成机器验收：
//   设备侧 = reports/r*.json 的 layerLedger[]（compositeLayer 只记上屏趟的设计坐标矩形 rd=[l,t,w,h]
//            + 矩形中心 readPixels 颜色 px + 纹理种类 t）；
//   CPU 侧 = 本地 parseScene(attachCtx) + applyRenderConfig({sceneId}) 复算**同口径**矩形
//            （与 preview.mjs layerMVP / demo 台账同样的两角点法），像素用 preview.mjs 光栅采样
//            （REFR=0，与浏览器默认父链合成一致）。
//
// 怎么用（Node only，无浏览器依赖）：
//   node parity-check.mjs                    # 所有「有上报且有本地 scene.pkg」的场景
//   node parity-check.mjs 3719111841 3544152633   # 指定场景
//   node parity-check.mjs --tol 4,0.15       # 阈值：矩形中心 px,像素色差比例（默认 2,0.10）
//   node parity-check.mjs --no-px            # 只对账矩形（不出 CPU 预览图，快）
//   node parity-check.mjs --strict           # known-issues.json 白名单条目也计失败
//   node parity-check.mjs --top 20           # 差异表行数（默认 12）
//
// 判定口径：
//   rect：|glRect中心 − cpuRect中心| > rectTol 或 |Δw|,|Δh| > sizeTol(默认 6px，吸收台账 ×3 取整噪声) → 越界；
//        文本层/脚本驱动层（原始 scene.json 里对象自身/属性值带脚本或为其后代）位置由脚本运行时改写，
//        CPU 基线只有 authored 静态值 → 记 soft(text)/soft(scripted) 列出不算失败。历史三大事故
//        （附件锚点/脚本 origin 覆盖/ownSizes）全是非文本层，仍在严格路径上。
//   px  ：单点跨管线对比天然有噪声（混合模式/HDR/过滤/解码），按实证校准三档——
//        · soft（列出不算失败）：蒙皮(KI-8)/fx/文本/脚本/UI/uvRect/半透明/中心出屏/纹理兜底(t≠layer)/colorBlendMode≠0；
//        · FAIL：① 设备中心像素=清屏色而 CPU 有内容（「没画上」签名，P-32 事故类）；
//               ② 平均色差 > hardPx（默认 max(0.6,pxFrac)——实测 blend=6 层合法差到 0.63，内容级错误更极端，P-36 黑纹理类）；
//        · diff（advisory）：介于两者之间的管线级差异，报告不判失败。
//   白名单：we-scene-demo/known-issues.json（每条带证据），命中记 known(KI-x) 不判失败（--strict 除外）。
//   ①(2026-09-24 可移植性审计 PA-34/PA-38) **台账防腐烂**：`knownFor()` 只在命中时豁免、不命中不报错 ⇒
//      内容哈希当 scene 键（重新打包就换哈希）、层名/场景改名都会让豁免**静默失效**。现在每轮都跑
//      `tests/known-ledger-audit.mjs` 的审计：键必须是可复算的场景身份（`*` 或工坊 id 形态）、
//      affects 必须落在真在用的口径上、rect 不许全局豁免、**对账过的场景里条目必须至少命中一次**，
//      违规一律判红（退出码 1）。只想记录"按什么结构分类"的条目用 `scope:'structural'` + `affects:[]`
//      （分类 ≠ 豁免），并要求其 `classify.rule` 有消费方实现（见本文件 classifyNoLocalScene）。
//   已知三类分叉自动标注：ownSizes 嫌疑（skin 层 gl/cpu 尺寸比 0.3–0.75）、
//   附件锚点/脚本 origin 嫌疑（gl 中心命中「无锚点期望」而非「锚点后期望」）。
//
// 输出：每场景 reports/parity-<id>.json + 终端差异 Top-N 表。
// 退出码：0 = 全部通过 / 无可对账数据（CI 条件项 SKIP 语义，不红）；1 = 存在越界差异；2 = 用法错误。
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { makeKnownLedger } from './known-ledger-audit.mjs'   // ①(PA-34) 台账匹配 + 防腐烂判据（纯函数，可被别的门禁复用）

const ROOT = process.env.MPW_ROOT || WS; // ①(去个人化) 可覆盖
const DEMO = path.join(ROOT, 'we-scene-demo')
const REPORTS = path.join(ROOT, 'reports')
const DD = path.join(ROOT, 'allwallpaper', 'dd')

// ---- 参数 ----
const args = process.argv.slice(2)
const argOf = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null }
let rectTol = 2, pxFrac = 0.10
const tolArg = argOf('--tol')
if (tolArg) {
  const [r, p] = tolArg.split(',').map(Number)
  if (!r || (p !== undefined && !(p >= 0))) { console.error('用法: --tol <rectPx>,<pxFrac>'); process.exit(2) }
  rectTol = r; if (p !== undefined) pxFrac = p
}
const sizeTol = Math.max(6, rectTol * 3)
const hardPx = Math.max(0.6, pxFrac)   // 实测校准：blend=6 层合法单点差到 0.63；内容级错误更极端
const NO_PX = args.includes('--no-px')
const STRICT = args.includes('--strict')
const TOPN = Number(argOf('--top') || 12)
// 位置参数 = 场景 id 白名单（--tol/--top 的值不算）
const VALUE_FLAGS = new Set(['--tol', '--top'])
const wantScenes = []
for (let i = 0; i < args.length; i++) {
  if (VALUE_FLAGS.has(args[i])) { i++; continue }
  if (args[i].startsWith('--')) continue
  wantScenes.push(args[i])
}

const lib = await import(path.join(DEMO, 'core/we-scene-bundle.js'))
const DEC = new TextDecoder()
const rd = (b) => DEC.decode(b).replace(/^\uFEFF/, '')

// ---- known-issues 白名单 ----
// ①(2026-09-16 目录整理) known-issues.json 随测试脚本收进 tests/（它只被测试消费）
// ①(PA-34 2026-09-24) 匹配逻辑（逐字同旧 knownFor 语义）+ **防腐烂审计**一起搬进 known-ledger-audit.mjs：
//   纯函数 ⇒ 能被 tests/portability-audit-fix-test.mjs 用合成台账证明"腐烂必红"，也能在下面的
//   SKIP 早退路径里照跑（否则"没有上报"这条路上台账永远不被检查 = 又一个盲点）。
const KNOWN_DOC = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'known-issues.json'), 'utf8'))
const KNOWN = KNOWN_DOC.issues || KNOWN_DOC

// ---- 结构性判据（`scope:'structural'` 的 KI 条目：**分类 ≠ 豁免**）----
// ①(PA-34) KI-7 原来用 mpkg **内容哈希**当 scene 键豁免整张包的 rect+px。改成一般规则：
//   「容器里没有 scene.pkg 但有 wallpaper.mp4 ⇒ 视频壁纸，不参与 scene 对账」——这条判据对**任何**
//   视频壁纸容器成立，不需要点名任何 id/哈希。判据必须**可举证**：找不到容器或容器读不了 ⇒
//   如实说"未判定"，不许假装分类成功（也不许静默什么都不说）。
const CONTAINER_CAP_MB = Number(process.env.MPW_W9_MAX_MB || 128)
const CONTAINER_DIRS = (() => {
  const home = (() => { try { return os.homedir() } catch { return '' } })()
  const dirs = [process.env.MPW_PLUGIN_CACHE, home ? path.join(home, '.dsh-mpkg-wallpaper') : null, DD, path.dirname(DD)]
  try {
    for (const e of fs.readdirSync(path.dirname(DD), { withFileTypes: true })) if (e.isDirectory()) dirs.push(path.join(path.dirname(DD), e.name))
  } catch { /* 语料根不存在：容器候选就少几条，不影响判定 */ }
  return [...new Set(dirs.filter(Boolean))]
})()

function classifyNoLocalScene(id) {
  for (const dir of CONTAINER_DIRS) {
    const p = path.join(dir, String(id) + '.mpkg')
    let st = null
    try { st = fs.statSync(p) } catch { continue }
    if (st.size > CONTAINER_CAP_MB * 1048576) return { rule: 'video-wallpaper', hit: false, why: `${p} 超过 ${CONTAINER_CAP_MB}MB 上限（MPW_W9_MAX_MB 可调），未解析 ⇒ 不假装判定` }
    try {
      const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(p)))
      const names = (pkg.entries || []).map((e) => e.name)
      const hasScene = names.includes('scene.pkg')
      const video = names.find((n) => /(^|\/)wallpaper\.(mp4|webm)$/i.test(n))
      return video && !hasScene
        ? { rule: 'video-wallpaper', hit: true, why: `${path.relative(ROOT, p)}：有 ${video}、无 scene.pkg ⇒ 视频壁纸（按分类跳过，不是豁免）` }
        : { rule: 'video-wallpaper', hit: false, why: `${path.relative(ROOT, p)}：hasScene=${hasScene} hasVideo=${!!video} ⇒ 不符合该分类` }
    } catch (e) { return { rule: 'video-wallpaper', hit: false, why: `${path.relative(ROOT, p)} 解析失败：${(e && e.message) || e}` } }
  }
  return { rule: 'video-wallpaper', hit: false, why: '本机找不到该场景的容器（无法判定分类）' }
}

const LEDGER = makeKnownLedger(KNOWN_DOC, { implementedRules: ['video-wallpaper'] })
const knownFor = (sceneId, layerName, aspect) => LEDGER.knownFor(sceneId, layerName, aspect)

/** 本机能看到的场景 id（上报索引 ∪ 本地语料目录）——审计用它判"scene 键还是不是可复算的身份"。 */
function knownSceneIds() {
  const s = new Set([...reportsByScene.keys()].map(String))
  const roots = [DD]
  try { for (const e of fs.readdirSync(path.dirname(DD), { withFileTypes: true })) if (e.isDirectory()) roots.push(path.join(path.dirname(DD), e.name)) } catch { /* 无语料：集合里只有上报索引 */ }
  for (const r of roots) {
    try { for (const e of fs.readdirSync(r, { withFileTypes: true })) if (e.isDirectory() && /^\d{6,12}$/.test(e.name)) s.add(e.name) } catch { /* 单条读不到不影响其它候选 */ }
  }
  return s
}

/** 台账审计 + 打印。返回 true = 无腐烂。**三条退出路径都要调它**（含 SKIP 早退）。 */
function auditLedger() {
  const res = LEDGER.audit({ knownSceneIds: knownSceneIds(), implementedRules: ['video-wallpaper'] })
  console.log('\n── known-issues 台账审计（防腐烂：豁免必须仍然命中；内容哈希键 / 整口径豁免 / 0 命中 一律判红）──')
  console.log(`  条目 ${LEDGER.entries.length}：豁免型 ${res.exempting.length} / 结构性 ${res.structural.length}；本次实际豁免 ${res.applied.reduce((s, x) => s + x.n, 0)} 条（${res.applied.map((x) => x.id + '×' + x.n).join(' ') || '无'}）`)
  for (const n of res.notes) console.log('  · ' + n.msg)
  for (const w of res.warnings) console.log('  ⚠ ' + w.msg)
  for (const e of res.errors) console.error('  ✗ ' + e.msg)
  if (res.errors.length) { console.error(`  ⇒ 台账防腐烂判红 ${res.errors.length} 条（豁免腐烂 = 对账口径已经悄悄变了，先修台账）`); return false }
  console.log('  ✓ 台账无腐烂：键可复算、口径合法、对账过的场景里条目都命中')
  return true
}
// applyRenderConfig 同款 UI 名单（CPU 预览未过 hideUI → 这些层像素口径不同）
const uiRe = /Cube|Song Title|Artist Name|Album Title|Play Icon|Pause Icon|dragAndDrop|clockHide|clockOrientation|textOrientation|Clock Container|Text Container|Rounded Corners|Round R|Round L|(^| )Frame($| )|toggle|Audio|音频|Spectrum|播放|音量|sound|Clock|Date|D a y|Day|时间|日期|星期|Launcher|歌词|Lyrics|music|Music|UI|mp3|MSR|唱片|Spectrum Visualizer|提示框|提示窗|prompt|Prompt/i

// ---- 上报选择：同场景取「台账条目最多」的一份（并列取最新）----
function pickReports() {
  const byScene = new Map()
  for (const f of fs.readdirSync(REPORTS).filter((f) => /^r\d+\.json$/.test(f))) {
    let d
    try { d = JSON.parse(fs.readFileSync(path.join(REPORTS, f), 'utf8')) } catch { continue }
    const led = d.layerLedger || []
    if (!led.length) continue
    const id = String(d.id || '').replace(/[?&].*$/, '')
    if (!id) continue
    const prev = byScene.get(id)
    // ①(P-75d 2026-09-15) **新近优先，而不是"台账条数最多的那份"**。
    //   旧评分 `led.length*1e13 + mtimeMs` 让"条目多"压倒一切 ⇒ 渲染管线一改（例如 P-69 那次
    //   全语料投影修正），parity 仍拿**改动之前**的真机上报跟**改动之后**的 CPU 参考比，
    //   于是每一层都报"镜像差"（实测 cat Δc=1014 = 2160−2×573，正是镜像指纹；而那份上报
    //   17:38 早于 P-69 落地的 18:0x）。设备数据的价值在于"是不是当前渲染器画的"，
    //   **过期的样本再多也是错的**。现在：mtime 主导，台账条数只作同一次会话内的并列打破。
    const score = fs.statSync(path.join(REPORTS, f)).mtimeMs * 1e3 + Math.min(led.length, 999)
    if (!prev || score > prev.score) byScene.set(id, { file: f, data: d, score, led })
  }
  return byScene
}

// ---- 矩阵（与 preview.mjs layerMVP / demo 台账同语义：列主序、y-down 正交）----
function mul(a, b) {
  const o = new Float64Array(16)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]
    o[c * 4 + r] = s
  }
  return o
}
const ident = () => { const m = new Float64Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m }
// y-down NDC 正交（demo 台账同约定：行向量矩阵 + transpose=false → NDC y 与设计坐标同向，
// 设计坐标 = (ndc·0.5+0.5)·proj，x/y 同式、无需再翻；P-32 已用 mock-GL 逐位验证）
// ①(P-69 修正) 这里原本写 `m[5]=+2/ch, m[13]=-1` → clip_y = 2y/ch−1 ⇒ 世界 y=0 落在 NDC −1（视口**底**）。
//   那是错的（GL 里 NDC +1 才是视口顶）：真机台账 rd 一直是这个镜像空间的量，所以它与本模型
//   "一起错"才一直绿 —— 也正是 P-69 那个全语料镜像 bug 能活这么久的原因（盲点）。
//   现在与 buildCamera 修正后的口径、preview.mjs 的 orthoYDown、MESH_VERT 四处一致。
const orthoYDown = (cw, ch) => { const m = ident(); m[0] = 2 / cw; m[5] = -2 / ch; m[12] = -1; m[13] = 1; return m }
const translate = (m, x, y, z) => { const t = ident(); t[12] = x; t[13] = y; t[14] = z; return mul(m, t) }
const scaleM = (m, x, y, z) => { const s = ident(); s[0] = x; s[5] = y; s[10] = z; return mul(m, s) }
const rotZ = (m, rad) => { const c = Math.cos(rad), sn = Math.sin(rad); const r = ident(); r[0] = c; r[1] = sn; r[4] = -sn; r[5] = c; return mul(m, r) }

// 与 demo 台账同样的两角点法（A=(-0.5,-0.5), B=(0.5,0.5)）→ 设计坐标矩形 [l,t,w,h]
function cpuRect(layer, projW, projH) {
  const lw = layer.size[0] * layer.scale[0]
  const lh = layer.size[1] * layer.scale[1]
  if (!(lw > 0) || !(lh > 0)) return null
  let m = ident()
  m = translate(m, layer.origin[0], layer.origin[1], layer.origin[2] || 0)
  m = rotZ(m, -layer.angles[2])
  m = scaleM(m, lw, lh, 1)
  const off = lib.alignmentOffsetForToken(layer.alignment, lw, lh)
  m = translate(m, off[0], -off[1], 0)
  m = mul(orthoYDown(projW, projH), m)
  const pt = (x, y) => [m[0] * x + m[4] * y + m[12], m[1] * x + m[5] * y + m[13]]
  const A = pt(-0.5, -0.5), B = pt(0.5, 0.5)
  const dx = (v) => (v * 0.5 + 0.5) * projW
  // ①(P-75c 2026-09-15) **y 的反解必须跟着投影一起翻**：修正后 `clip_y = 1 − 2·y/ch`
  //   ⇒ `y = (1 − clip_y)·ch/2`。旧实现两轴同式 `(v·0.5+0.5)·projH`，那是**旧（错）投影**
  //   （`clip_y = 2y/ch − 1`）的反解 ⇒ P-69 改了 `orthoYDown` 却漏了这里，于是本参考
  //   **仍然把每个四边形层镜像**：真机花朵画在 y=1641（正确），本参考算成 519，
  //   Δc=1122 —— 正好等于 2160−2×519 的镜像量（实测 Δc=1121.5 ✓ 就是这个 bug 的指纹）。
  const dy = (v) => (1 - v) * 0.5 * projH
  const x0 = Math.min(dx(A[0]), dx(B[0])), x1 = Math.max(dx(A[0]), dx(B[0]))
  const y0 = Math.min(dy(A[1]), dy(B[1])), y1 = Math.max(dy(A[1]), dy(B[1]))
  return { rect: [x0, y0, x1 - x0, y1 - y0], center: [(x0 + x1) / 2, (y0 + y1) / 2] }
}

// ---- CPU 期望场景（锚点后 = 浏览器默认语义；无锚点 = 分叉嫌疑对照）----
const sceneCache = new Map()
// 从原始 scene.json 收集「脚本驱动层」：对象自身/属性值（origin、color 等可为 {script,value}）带脚本，
// 或是脚本对象的后代 —— 这些层的设备端位置/颜色由脚本在运行时改写（如 398 的 origin 即拖拽存储位置脚本），
// CPU 基线只有 authored 静态值 → rect/px 判 soft(scripted)，不算失败但列出。
function collectScriptedKeys(sj) {
  const keys = new Set()
  const devKeyOf = (o) => String(o.name || o.id).slice(0, 20)
  const propHasScript = (o) => {
    for (const k of Object.keys(o)) {
      const v = o[k]
      if (v && typeof v === 'object' && !Array.isArray(v) && (v.script !== undefined || v.scriptproperties !== undefined)) return true
    }
    return false
  }
  const walk = (o, inherited) => {
    if (!o || typeof o !== 'object') return
    if (Array.isArray(o)) { for (const x of o) walk(x, inherited); return }
    const isScripted = inherited || o.script !== undefined || o.scriptproperties !== undefined || o.scripts !== undefined || propHasScript(o)
    if (isScripted && (o.name !== undefined || o.id !== undefined)) keys.add(devKeyOf(o))
    for (const k of Object.keys(o)) if (typeof o[k] === 'object') walk(o[k], isScripted)
  }
  walk(sj, false)
  return keys
}
function cpuScenes(id) {
  if (sceneCache.has(id)) return sceneCache.get(id)
  const pkgPath = path.join(DD, id, 'scene.pkg')
  if (!fs.existsSync(pkgPath)) { sceneCache.set(id, null); return null }
  let out = null
  try {
    const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(pkgPath)))
    const readEntry = (n) => lib.getEntry(pkg, n)
    const sj = JSON.parse(rd(readEntry('scene.json')))
    const scene = lib.parseScene(JSON.parse(JSON.stringify(sj)), null, { attachCtx: { readEntry, time: 0 } })
    lib.applyRenderConfig(scene, { sceneId: id })   // hideUI/眼窗白名单/RE-06 可见性（与 demo 默认一致）
    const noAnchor = lib.parseScene(JSON.parse(JSON.stringify(sj)), null, {})  // 无 attachCtx：raw 父链合并
    const g = scene.general || {}
    const op = g.orthogonalprojection || {}
    // ①(P-63 2026-09-14 butterfly.many1 Δc=117.4 定案) **补上 demo 渲染前必跑的第 3 阶段**：
    //   生产调用点 demo.html:2911 → applyScriptedFullscreenFallback（bundle:1296-1321）。
    //   旧 CPU 参考只跑 parseScene+applyRenderConfig ⇒ 漏掉"近整屏层居中兜底"这一遍，
    //   凡被兜底搬动过的层必然报 Δc（本包 butterfly.many1 gl=[240,135,…] vs cpu=[345.4,184.7,…]）。
    //   证据（docs/BUTTERFLY-PARITY-DELTA.md）：设备 rd/origin 逐位等于兜底后矩形；补跑后 Δc=0.00；
    //   6 个包 94 行台账里兜底只搬动这 1 行，其余 93 行 Δc 前后逐位不变（零连带）。
    //   ⚠ 本行只让**参考**与生产管线对齐；兜底启发式本身是否越界（非脚本层也被搬）
    //   是另一个问题，见 docs/BUTTERFLY-PARITY-DELTA.md ⑥（需官方 preview.gif 判读），不在本行处理。
    lib.applyScriptedFullscreenFallback(scene, { canvasW: op.width || 3840, canvasH: op.height || 2160 })
    // 清屏色（「没画上」签名判据）：场景 clearcolor + demo 页灰底 178（clearenabled=false 时设备看到的是页面底色）
    let clears = [[178, 178, 178]]
    if (g.clearenabled !== false && g.clearcolor) {
      const p = String(g.clearcolor).trim().split(/\s+/).map(Number)
      if (p.length >= 3 && p.every((v) => v >= 0 && v <= 1)) clears.push([Math.round(p[0] * 255), Math.round(p[1] * 255), Math.round(p[2] * 255)])
    }
    out = { scene, noAnchor, scriptedKeys: collectScriptedKeys(sj), projW: op.width || 3840, projH: op.height || 2160, clears }
  } catch (e) { console.error(`  [parity] ${id} CPU 侧解析失败: ${e.message}`) }
  sceneCache.set(id, out)
  return out
}

// ---- CPU 预览光栅（preview.mjs 子进程，REFR=0 与浏览器默认父链一致）----
const PW = 960, PH = 540
function previewSamples(id, designPts) {
  // ①(PA-09/PA-11 2026-09-24) 临时 PNG 不再写死 `/tmp`（Windows 没有 /tmp、macOS 是 /private/tmp 软链、
  //   容器里常是小容量 tmpfs）⇒ 走 os.tmpdir()（同目录的 headless-shot/preview 早就是这个口径）。
  const png = path.join(os.tmpdir(), `parity-prev-${id}.png`)
  try {
    execFileSync('node', [path.join(DEMO, 'preview.mjs'), id, png, String(PW), String(PH)],
      { env: { ...process.env, REFR: '0' }, timeout: 240000, stdio: ['ignore', 'ignore', 'ignore'] })
    const py = `import sys, json
from PIL import Image
img = Image.open(sys.argv[1]).convert("RGB")
pts = json.load(sys.stdin)
print(json.dumps([list(img.getpixel((int(x), int(y)))) for x, y in pts]))`
    const pts = designPts.map(([x, y, w, h]) => [
      Math.max(0, Math.min(PW - 1, Math.round(x / w * PW))),
      Math.max(0, Math.min(PH - 1, Math.round(y / h * PH)))])
    return JSON.parse(execFileSync('python3', ['-c', py, png], { input: JSON.stringify(pts), timeout: 60000 }))
  } catch (e) {
    console.error(`  [parity] ${id} CPU 预览不可用（${String(e.message).split('\n')[0]}）→ px 记 no-baseline`)
    return null
  }
}

// ---- 主流程 ----
const reportsByScene = pickReports()
const sceneIds = [...reportsByScene.keys()].sort()
  .filter((id) => !wantScenes.length || wantScenes.includes(id))
let anyFail = false, compared = 0

if (!sceneIds.length) {
  console.log('SKIP parity-check：无可对账上报（reports/ 无含 layerLedger 的 r*.json）')
  // ①(PA-34) 早退路径也要审台账：否则"没有上报"这条路上豁免腐烂永远不被发现（盲点）。
  const ledgerOk = auditLedger()
  process.exit(ledgerOk ? 0 : 1)
}

for (const id of sceneIds) {
  const { file, data: rep, led } = reportsByScene.get(id)
  LEDGER.markCompared(id)
  console.log('\n' + '═'.repeat(96))
  console.log(`场景 ${id}  上报 ${file}  at=${rep.at}  台账 ${led.length} 层  阈值 rect≤${rectTol}px(size≤${sizeTol}) px≤${(pxFrac * 100).toFixed(0)}%`)
  const cs = cpuScenes(id)
  if (!cs) {
    // ①(PA-34) 原来只写死一句"（mpkg/视频壁纸类，见 known-issues KI-7）"。现在跑**结构性判据**并如实报：
    //   命中 ⇒ 打印命中哪条规则与证据；不命中 ⇒ 明说"分类未判定"，不假装知道原因。
    const cls = classifyNoLocalScene(id)
    LEDGER.markStructural(cls.rule, cls.hit, cls.why)
    console.log('  SKIP：无本地 scene.pkg —— ' + (cls.hit ? `结构性判据 ${cls.rule} 命中：${cls.why}` : `分类**未判定**（${cls.why}）`))
    continue
  }

  const { scene, noAnchor, scriptedKeys, projW, projH, clears } = cs
  // CPU 期望层（可见、非容器、非粒子、尺寸非退化）；键 = 设备台账同款约定（name||id，截 20 字符）
  const devKey = (l) => String(l.name || l.id).slice(0, 20)
  const cpuByName = new Map()
  const cpuDegenerate = new Map()   // authored size 0×0：设备按纹理尺寸兜底绘制，CPU 侧不比（soft）
  const cpuLayers = []
  scene.layers.forEach((l, i) => {
    if (!l.visible || l.particle || l.isContainer) return
    const key = devKey(l)
    const r = cpuRect(l, projW, projH)
    if (!r) { if (!cpuDegenerate.has(key)) cpuDegenerate.set(key, []); cpuDegenerate.get(key).push(l); return }
    const na = noAnchor.layers.find((x) => x.name === l.name) || l
    cpuLayers.push({ idx: i, layer: l, ...r, noAnchorCenter: [na.origin[0], na.origin[1]] })
    if (!cpuByName.has(key)) cpuByName.set(key, [])
    cpuByName.get(key).push(cpuLayers[cpuLayers.length - 1])
  })
  // 上报 layers[] 元数据（skin/fx，按名配对）
  const repMeta = new Map()
  for (const L of rep.layers || []) {
    if (!repMeta.has(L.n)) repMeta.set(L.n, [])
    repMeta.get(L.n).push(L)
  }

  // 逐台账条目对账
  const rows = []
  const usedCpu = new Set()
  for (const e of led) {
    const cands = (cpuByName.get(e.n) || []).filter((c) => !usedCpu.has(c.idx))
    const cpu = cands[0]
    if (!cpu) {
      const deg = cpuDegenerate.get(e.n)
      rows.push(deg && deg.length
        ? { name: e.n, verdict: 'soft(size0)', glRect: e.rd, glPx: e.px, notes: [], why: 'authored size 0×0：设备按纹理尺寸兜底绘制（P-34 白/透明兜底层），CPU 侧无比对口径' }
        : { name: e.n, verdict: 'no-cpu', glRect: e.rd, notes: [], why: 'CPU 侧无同名可绘层（设备特殊路径/RE-06 可见性差异）' })
      continue
    }
    usedCpu.add(cpu.idx)
    const meta = (repMeta.get(e.n) || [{}])[0]
    const glC = [e.rd[0] + e.rd[2] / 2, e.rd[1] + e.rd[3] / 2]
    const dc = Math.hypot(glC[0] - cpu.center[0], glC[1] - cpu.center[1])
    const dw = Math.abs(e.rd[2] - cpu.rect[2]), dh = Math.abs(e.rd[3] - cpu.rect[3])
    const notes = []
    let caliber = 'size-box', caliberNote = null
    // 已知三类分叉的自动标注
    if (meta.skin === 1) {
      // ①(修复 2026-09-14) 这里原来写的是 `gl.rect`，但本作用域里设备侧矩形变量叫 `e.rd`
      //   （`gl` 是更早版本的名字）→ 真机上报一旦含 skin=1 的层就抛 `ReferenceError: gl is not defined`，
      //   整个 parity-check 崩掉（门禁红）。改回 `e.rd` 并对 0 尺寸做保护。
      const cw = cpu.rect[2] || 1, ch = cpu.rect[3] || 1
      const ratio = ((e.rd[2] / cw) + (e.rd[3] / ch)) / 2
      // ①(新A-(b) 2026-09-14) **第二口径标注（只增信息，不改判定/阈值）**：
      //   蒙皮网格层的设备矩形=**网格顶点 bbox 经 origin/scale 变换**，而 CPU 侧 rect 用**作者 size 框** ⇒
      //   两者本就不是同一把尺子，比值 <1 属口径差（官方标定 refrender-3719111841.json 已验证设备侧 ≤1.4px）。
      //   这里把"设备口径（bbox）"显式记进产物，便于人工对照；判定仍走上方的软/硬两类规则。
      caliber = 'mesh-bbox'
      caliberNote = `设备口径=网格 bbox；CPU 口径=size 框 ⇒ 比值 ${ratio.toFixed(3)}（口径差，非错位）`
      if (ratio > 0.3 && ratio < 0.75) notes.push(caliberNote + '；历史实测 ~0.53')
    }
    const dNoAnchor = Math.hypot(glC[0] - cpu.noAnchorCenter[0], glC[1] - cpu.noAnchorCenter[1])
    if (dNoAnchor <= Math.max(rectTol * 2, 4) && dc > rectTol) notes.push(`附件锚点/脚本origin 嫌疑（中心命中无锚点期望 Δ${dNoAnchor.toFixed(1)}px，锚点后期望 Δ${dc.toFixed(1)}px）`)
    // rect 判定：文本层/脚本驱动层的设备端位置由脚本运行时改写（CPU 基线=authored 静态值）
    // → 记 soft 列出不算失败；其余越界走白名单，白名单外即 FAIL。
    let verdict, known = null
    if (dc <= rectTol && dw <= sizeTol && dh <= sizeTol) verdict = 'ok'
    else if (cpu.layer.__text !== undefined && cpu.layer.__text !== null) verdict = 'soft(text)'
    else if (scriptedKeys.has(e.n)) verdict = 'soft(scripted)'
    else {
      known = knownFor(id, e.n, 'rect')
      verdict = known ? `known(${known.id})` : 'FAIL(rect)'
    }
    rows.push({ caliber, caliberNote, name: e.n, verdict, glRect: e.rd, glCenter: glC, glT: e.t, cpuRect: cpu.rect.map((v) => +v.toFixed(1)), rectΔc: +dc.toFixed(1), Δwh: `${Math.round(dw)},${Math.round(dh)}`, glPx: e.px, meta, cpu, notes })
  }

  // ①(新A-(b)) 场景级口径提示：多少层属于"设备=网格bbox / CPU=size框"的口径差（纯信息）
  {
    const meshLayers = rows.filter((r) => r.caliber === 'mesh-bbox')
    if (meshLayers.length) console.log(`  ⓘ 口径提示：${meshLayers.length} 层为蒙皮网格（设备口径=网格 bbox，CPU 口径=size 框，比值非 1 属口径差；判据未变，明细见 reports/parity-${id}.json 的 caliber/caliberNote）`)
  }

  // px 对账（三档：soft 口径受限 / FAIL 铁证 / diff 管线级 advisory，见文件头）
  if (!NO_PX) {
    const need = rows.filter((r) => r.glPx && r.cpu)
    const samples = need.length ? previewSamples(id, need.map((r) => [r.glCenter[0], r.glCenter[1], projW, projH])) : []
    const nearClear = (px) => px && clears.some((c) => Math.abs(px[0] - c[0]) <= 3 && Math.abs(px[1] - c[1]) <= 3 && Math.abs(px[2] - c[2]) <= 3)
    need.forEach((r, i) => {
      const cpuPx = samples ? samples[i] : null
      if (!cpuPx) { r.cpuPx = null; r.pxΔ = null; r.pxVerdict = 'no-baseline'; return }
      r.cpuPx = cpuPx
      const d = (Math.abs(r.glPx[0] - cpuPx[0]) + Math.abs(r.glPx[1] - cpuPx[1]) + Math.abs(r.glPx[2] - cpuPx[2])) / 3 / 255
      r.pxΔ = +d.toFixed(3)
      const l = r.cpu.layer, m = r.meta
      const soft = []
      if (m.skin === 1) soft.push('skin(KI-8)')
      if ((m.fx | 0) > 0) soft.push('fx')
      if (l.__text !== undefined && l.__text !== null) soft.push('text')
      if (scriptedKeys.has(r.name)) soft.push('scripted')
      if (uiRe.test(r.name)) soft.push('ui')
      if (l.uvRect) soft.push('uvRect')
      if (l.alpha !== undefined && l.alpha < 0.95) soft.push(`alpha=${l.alpha}`)
      if (r.glCenter[0] < 0 || r.glCenter[0] > projW || r.glCenter[1] < 0 || r.glCenter[1] > projH) soft.push('center-offscreen')
      if (r.glT && r.glT !== 'layer') soft.push(`fallback-tex(${r.glT})`)
      if ((l.colorBlendMode | 0) !== 0) soft.push(`blend=${l.colorBlendMode}`)
      if (soft.length) { r.pxVerdict = `soft(${soft.join(',')})`; return }
      if (d <= pxFrac) { r.pxVerdict = 'ok'; return }
      // 「没画上」签名：设备中心=清屏色而 CPU 有内容（P-32 事故类）→ 铁证
      if (nearClear(r.glPx) && !nearClear(cpuPx)) {
        const k = knownFor(id, r.name, 'px')
        r.pxVerdict = k ? `known(${k.id})` : 'FAIL(clear-miss)'
        return
      }
      // 极端色差（内容级错误，P-36 黑纹理类）→ 铁证
      if (d > hardPx) {
        const k = knownFor(id, r.name, 'px')
        r.pxVerdict = k ? `known(${k.id})` : 'FAIL(px)'
        return
      }
      // 其余：管线级差异（HDR/bloom/过滤/解码），advisory
      r.pxVerdict = 'diff'
    })
  }

  // 汇总与落盘
  const fails = rows.filter((r) => r.verdict.startsWith('FAIL') || (r.pxVerdict || '').startsWith('FAIL'))
  const knowns = rows.filter((r) => r.verdict.startsWith('known') || (r.pxVerdict || '').startsWith('known'))
  const softs = rows.filter((r) => (r.pxVerdict || '').startsWith('soft'))
  const diffs = rows.filter((r) => r.pxVerdict === 'diff')
  const size0 = rows.filter((r) => r.verdict === 'soft(size0)')
  const noCpu = rows.filter((r) => r.verdict === 'no-cpu')
  const cpuOnly = cpuLayers.filter((c) => !usedCpu.has(c.idx))
  const failCount = STRICT ? fails.length + knowns.length : fails.length
  if (failCount) anyFail = true
  compared++

  console.log(`  对账 ${rows.length} 层：ok ${rows.length - fails.length - knowns.length - noCpu.length - size0.length} | 越界 ${fails.length} | known ${knowns.length} | px-soft ${softs.length} | px-diff(advisory) ${diffs.length} | size0 ${size0.length} | no-cpu ${noCpu.length} | CPU-only(未上屏) ${cpuOnly.length}`)
  const top = rows.filter((r) => r.verdict !== 'ok' || (r.pxVerdict && r.pxVerdict !== 'ok'))
    .sort((a, b) => (b.rectΔc || 0) - (a.rectΔc || 0)).slice(0, TOPN)
  if (top.length) {
    console.log(`  差异 Top-${top.length}（层 | 判定 | Δ中心 | Δwh | pxΔ | 附注）：`)
    for (const r of top) {
      console.log(`    ${String(r.name).padEnd(12)} ${String(r.verdict + '/' + (r.pxVerdict || '-')).padEnd(26)} Δc=${String(r.rectΔc ?? '-').padStart(7)} Δwh=${String(r.Δwh || '-').padStart(9)} pxΔ=${String(r.pxΔ ?? '-').padStart(6)}${r.notes && r.notes.length ? ' ⚑ ' + r.notes.join('；') : ''}${r.why ? ' · ' + r.why : ''}`)
      if (r.verdict.startsWith('FAIL') || (r.pxVerdict || '').startsWith('FAIL')) {
        console.log(`        gl=[${r.glRect}] cpu=[${r.cpuRect}] glPx=${JSON.stringify(r.glPx)} cpuPx=${JSON.stringify(r.cpuPx)}`)
      }
    }
  }
  if (noCpu.length) console.log(`  no-cpu：${noCpu.map((r) => r.name).slice(0, 8).join('、')}${noCpu.length > 8 ? '…' : ''}`)
  const suspicious = rows.filter((r) => r.notes && r.notes.length)
  if (suspicious.length) console.log(`  ⚑ 分叉嫌疑标注：${suspicious.length} 层（见上表附注；ownSizes/锚点两类即历史三大事故的两类）`)

  const outJson = {
    scene: id, report: { file, at: rep.at }, generated: new Date().toISOString(),
    tol: { rect: rectTol, size: sizeTol, px: pxFrac }, strict: STRICT,
    summary: { rows: rows.length, fail: fails.length, known: knowns.length, softPx: softs.length, diffPx: diffs.length, size0: size0.length, noCpu: noCpu.length, cpuOnly: cpuOnly.length, verdict: failCount ? 'FAIL' : 'PASS' },
    // ①(PA-34/PA-35) 豁免计数落进产物：人读 JSON 时能直接看到"本次 px/rect 各被哪条 KI 豁免了几层"
    knownLedger: { entries: LEDGER.entries.length, applied: [...LEDGER.hitCounts.entries()].map(([ki, n]) => ({ ki, n })) },
    layers: rows.map((r) => ({
      name: r.name, verdict: r.verdict, pxVerdict: r.pxVerdict || null,
      // ①(P-63 随修) caliber/caliberNote 之前**算完就丢**（行内 push 了却不在 JSON 里），
      //   于是顶层那个"ⓘ 口径提示"指向的 `reports/parity-*.json 的 caliber/caliberNote` 是空的。
      //   新A 决策 (b)：**展示两种口径、不改判定** —— 这里把第二口径如实落盘。
      caliber: r.caliber || null, caliberNote: r.caliberNote || null,
      glRect: r.glRect, cpuRect: r.cpuRect || null, rectΔcenter: r.rectΔc ?? null, Δwh: r.Δwh || null,
      glPx: r.glPx || null, cpuPx: r.cpuPx || null, pxΔ: r.pxΔ ?? null,
      notes: r.notes || [], why: r.why || null,
    })),
  }
  fs.writeFileSync(path.join(REPORTS, `parity-${id}.json`), JSON.stringify(outJson, null, 1))
  console.log(`  → reports/parity-${id}.json（verdict=${outJson.summary.verdict}）`)
}

console.log('\n' + '═'.repeat(96))
const ledgerOk = auditLedger()
if (!compared) {
  console.log('SKIP parity-check：有上报但均无本地 scene.pkg')
  process.exit(ledgerOk ? 0 : 1)
}
console.log((anyFail || !ledgerOk) ? `✗ parity-check：存在越界差异或台账腐烂（见上）` : `✓ parity-check：${compared} 场景对账完成，无越界差异（known/soft 见各场景 JSON）`)
process.exit((anyFail || !ledgerOk) ? 1 : 0)
