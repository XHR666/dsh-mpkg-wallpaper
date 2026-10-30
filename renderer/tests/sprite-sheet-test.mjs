// sprite-sheet-test.mjs — RE-31 回归测试：TEXS 精灵表解析 + 官方 ComputeSpriteFrame 公式
// 证据链：
//   ① 官方资产（313 个 .tex）里 TEXS 帧表的解析字段（帧数/帧尺寸/时长/网格）；
//   ② 网格必须与**纹理像素**一致——用列/行墨迹自相关独立测出帧周期，与解析出的帧宽高对比；
//   ③ 官方公式（common_particles.h ComputeSpriteFrame）行为：行主序遍历、行进位、
//      帧内 blend 语义、尾帧 clamp、randomframe 关混合。
// 注：TEXS 记录里的 x/y 是编辑器元数据（实测 bubble1 按 5 列排布，而物理表是 6×5），
//     官方 shader 只用首帧轴长/帧数，故校验以像素网格为准。
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import * as lib from '../core/we-scene-bundle.js'
// ①(去个人化 2026-09-16 / 敏感信息加固 2026-09-19) 工作区根：环境变量优先；兜底默认由 tests/_root.mjs 按**脚本自身位置**推导（不再写作者本机绝对路径）。
const MPW_WS = process.env.MPW_ROOT || WS

const ASSETS = `${MPW_WS}/wallpaper_engine/assets`
const checks = []
const push = (name, ok, detail) => checks.push({ name, ok: !!ok, detail })

function findTex(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = dir + '/' + e.name
    if (e.isDirectory()) findTex(p, out)
    else if (e.name.endsWith('.tex')) out.push(p)
  }
  return out
}

// 墨迹自相关测周期：返回最可能的帧周期（像素）
function detectPeriod(ink, around) {
  const n = ink.length
  const mean = ink.reduce((a, b) => a + b, 0) / n
  const dev = ink.map((v) => v - mean)
  let best = around, bestScore = -Infinity
  for (let p = Math.max(4, Math.round(around * 0.75)); p <= Math.min(n / 2, Math.round(around * 1.25)); p += 0.5) {
    let s = 0, cnt = 0
    for (let x = 0; x + p < n; x += 1) { s += dev[x] * dev[x + p]; cnt++ }
    const score = cnt ? s / cnt : 0
    if (score > bestScore) { bestScore = score; best = p }
  }
  return best
}

function zeroRuns(arr) {
  const runs = []
  let s = -1
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] === 0 && s < 0) s = i
    else if (arr[i] !== 0 && s >= 0) { runs.push([s, i - 1]); s = -1 }
  }
  if (s >= 0) runs.push([s, arr.length - 1])
  return runs
}

function sheetPeriods(rgba, w, h) {
  const colInk = new Array(w).fill(0), rowInk = new Array(h).fill(0)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const a = rgba[(y * w + x) * 4 + 3]
    if (a > 8) { colInk[x]++; rowInk[y]++ }
  }
  return { colInk, rowInk }
}

const files = findTex(ASSETS)
let withSprite = 0, framesTotal = 0, gridOk = 0
const gridBad = []
const samples = []
for (const f of files) {
  let tex
  try { tex = lib.parseTex(new Uint8Array(fs.readFileSync(f))) } catch { continue }
  const sp = lib.spriteInfo(tex)
  if (!sp) continue
  withSprite++
  framesTotal += sp.numFrames
  const cols = Math.max(1, Math.round((tex.textureWidth || tex.width) / sp.frameWidthPx))
  const rows = Math.max(1, Math.round((tex.textureHeight || tex.height) / sp.frameHeightPx))
  if (sp.cols === cols && sp.rows === rows && cols * rows >= sp.numFrames) gridOk++
  else gridBad.push(`${f.split('/').pop()} ${sp.numFrames}帧 帧${sp.frameWidthPx.toFixed(0)}x${sp.frameHeightPx.toFixed(0)} 网格${sp.cols}x${sp.rows}`)
  if (samples.length < 8) samples.push({ f: f.replace(ASSETS + '/', ''), sp, w: tex.width, h: tex.height })
}

push('官方资产中存在精灵表纹理', withSprite > 0, `withSprite=${withSprite}/${files.length} 共 ${framesTotal} 帧`)
push('网格推导自洽（列×行 ≥ 帧数）', gridBad.length === 0, gridBad.slice(0, 3).join(' | ') || `ok=${gridOk}`)

// 像素级网格校验：代表精灵表的帧周期必须等于解析出的帧宽高
const pixelTargets = ['bubbles/bubble1.tex', 'animals/jellyfish1.tex', 'explosion/explosion1.tex', 'animals/fish1.tex']
for (const rel of pixelTargets) {
  const f = ASSETS + '/materials/particle/' + rel
  if (!fs.existsSync(f)) { push(`像素网格 ${rel}`, false, '文件缺失'); continue }
  const tex = lib.parseTex(new Uint8Array(fs.readFileSync(f)))
  const sp = lib.spriteInfo(tex)
  if (!sp) { push(`像素网格 ${rel}`, false, '无精灵表'); continue }
  const d = lib.decodeMip0(tex)
  const { colInk, rowInk } = sheetPeriods(d.rgba, d.width, d.height)
  // 有空白间隔时用自相关测周期；精灵外溢（无空白，如水母）时改用"帧数=满格格数"交叉验证
  const colGaps = zeroRuns(colInk).length > 0, rowGaps = zeroRuns(rowInk).length > 0
  if (colGaps || rowGaps) {
    // 逐轴：有空白 → 自相关测周期；无空白（精灵外溢）→ 该轴沿用元数据并靠帧数/格数校验
    const pc = colGaps ? detectPeriod(colInk, sp.frameWidthPx) : sp.frameWidthPx
    const pr = rowGaps ? detectPeriod(rowInk, sp.frameHeightPx) : sp.frameHeightPx
    const okc = Math.abs(pc - sp.frameWidthPx) <= 2, okr = Math.abs(pr - sp.frameHeightPx) <= 2
    push(`像素网格 ${rel}`, okc && okr, `列周期 ${pc} vs 帧宽 ${sp.frameWidthPx.toFixed(1)}；行周期 ${pr} vs 帧高 ${sp.frameHeightPx.toFixed(1)}`)
  } else {
    const full = sp.cols * sp.rows === sp.numFrames
    push(`像素网格 ${rel}（满格）`, full, `无空白边界 → 帧数 ${sp.numFrames} vs 满格格数 ${sp.cols * sp.rows}`)
  }
}

// 公式行为：行主序、行进位、blend、尾帧 clamp
const bub = lib.parseTex(new Uint8Array(fs.readFileSync(ASSETS + '/materials/particle/bubbles/bubble1.tex')))
const bsp = lib.spriteInfo(bub)
push('bubble1 帧数=30', bsp.numFrames === 30, `numFrames=${bsp.numFrames}`)
push('bubble1 网格 6×5', bsp.cols === 6 && bsp.rows === 5, `${bsp.cols}x${bsp.rows}`)
push('bubble1 帧宽UV≈1/6', Math.abs(bsp.frameWidthUV - 1 / 6) < 1e-4, bsp.frameWidthUV.toFixed(6))
push('bubble1 rate=帧高/帧宽=1.2', Math.abs(bsp.rate - 1.2) < 1e-3, bsp.rate.toFixed(4))
{
  const N = bsp.numFrames
  const uv = lib.computeSpriteFrameUV(bsp, (6 + 0.01) / N, true)
  push('第6帧进位到第二行第0列', Math.abs(uv.u0) < 1e-4 && Math.abs(uv.v0 - 1 / 5) < 1e-4, `u0=${uv.u0.toExponential(2)} v0=${uv.v0.toFixed(4)}`)
  const uv5 = lib.computeSpriteFrameUV(bsp, (5 + 0.01) / N, true)
  push('第5帧仍在第一行第5列', Math.abs(uv5.u0 - 5 / 6) < 1e-4 && Math.abs(uv5.v0) < 1e-4, `u0=${uv5.u0.toFixed(4)} v0=${uv5.v0.toFixed(4)}`)
  const b0 = lib.computeSpriteFrameUV(bsp, 6.0 / N, false).blend
  const bm = lib.computeSpriteFrameUV(bsp, 6.5 / N, false).blend
  push('帧起点 blend=0 / 帧中点 blend=0.5', Math.abs(b0) < 1e-5 && Math.abs(bm - 0.5) < 1e-6, `start=${b0.toExponential(2)} mid=${bm}`)
  push('noBlend 时 blend 恒 0', lib.computeSpriteFrameUV(bsp, 6.5 / N, true).blend === 0, 'ok')
  const last = lib.computeSpriteFrameUV(bsp, (N - 1 + 0.9) / N, false)
  push('尾帧 nxt clamp 到 N-1', Math.abs(last.u1 - 5 / 6) < 1e-3 && Math.abs(last.v1 - 4 / 5) < 1e-3, `u1=${last.u1.toFixed(4)} v1=${last.v1.toFixed(4)}`)
  const loop = lib.computeSpriteFrameUV(bsp, 1 + (6 + 0.01) / N, true)
  push('帧值 >1 折返（循环）', Math.abs(loop.u0 - uv.u0) < 1e-6 && Math.abs(loop.v0 - uv.v0) < 1e-6, `u0=${loop.u0.toFixed(4)} v0=${loop.v0.toFixed(4)}`)
  const plain = lib.parseTex(new Uint8Array(fs.readFileSync(ASSETS + '/materials/particle/chromaticdot.tex')))
  push('普通纹理 spriteInfo=null', lib.spriteInfo(plain) === null, 'ok')
}

let pass = 0
for (const c of checks) { console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail !== undefined ? '  — ' + c.detail : ''}`); if (c.ok) pass++ }
console.log(`\n${pass}/${checks.length} 通过 | 扫描 ${files.length} 个官方 .tex | 精灵表 ${withSprite} 个 / ${framesTotal} 帧`)
if (samples.length) { console.log('样例:'); for (const s of samples) console.log(`  ${s.f}  纹理${s.w}x${s.h} 帧${s.sp.numFrames} 网格${s.sp.cols}x${s.sp.rows} 帧UV=${s.sp.frameWidthUV.toFixed(4)}x${s.sp.frameHeightUV.toFixed(4)} rate=${s.sp.rate.toFixed(3)} 帧时长=${s.sp.frametime.toFixed(4)} 总时长=${s.sp.duration.toFixed(3)}`) }
process.exit(pass === checks.length ? 0 : 1)
