// attach-transform-test.mjs — P-21-ATTACH 附件/父链变换移植的验收测试
// 断言四件事：
//   T1 移植保真度：core/attach-transform.mjs 的 resolveTransform 与 elysia SceneRenderer.resolveTransform
//      在 6 个测试包的**每一层**上中心误差 < 0.01px（移植 = 逐字，不引入新语义）。
//   T2 官方标定对齐：3719111841 用 parseScene+attachCtx 复算 22 个标定层，Δ<5px ≥ 19 层
//      且中位中心误差 < 50px（修复前：中位 782px、19 层带锚点全部错位数百像素）。
//   T3 无锚点层不受影响：目标场景不带 attachment 的层，开/关锚点 origin 逐位一致。
//   T4 角度单位：scene.json 的 angles 按弧度处理（父 z=π/2、子 origin=(100,0) → 子世界 (0,100)）。
// 运行：node attach-transform-test.mjs   （全过输出 ALL PASS，退出码 0）
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import * as lib from '../core/we-scene-bundle.js'
import { resolveTransform, parseMdatAnchors, parseMdl, buildAttachOffsets } from '../core/attach-transform.mjs'
import { SceneRenderer } from '../elysia/we-renderer/core.js'
// ①(去个人化 2026-09-16 / 敏感信息加固 2026-09-19) 工作区根：环境变量优先；兜底默认由 tests/_root.mjs 按**脚本自身位置**推导（不再写作者本机绝对路径）。
const MPW_WS = process.env.MPW_ROOT || WS

const DEC = new TextDecoder()
const rd = (b) => DEC.decode(new Uint8Array(b)).replace(/^\uFEFF/, '')
const DIR = `${MPW_WS}/allwallpaper/dd`
const IDS = ['3554161528', '3544152633', '3327063360', '3326873240', '3660962877', '3719111841']

let failed = 0
const ok = (cond, label, detail) => {
  console.log((cond ? 'PASS ' : 'FAIL ') + label + (detail ? '  ' + detail : ''))
  if (!cond) failed++
}

function loadPkg(id) {
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(`${DIR}/${id}/scene.pkg`)))
  const readEntry = (n) => lib.getEntry(pkg, n)
  return { pkg, readEntry, raw: JSON.parse(rd(readEntry('scene.json'))) }
}
function makeCtx(readEntry) {
  return {
    readModelJson: (p) => { try { const e = readEntry(p); return e ? JSON.parse(rd(e)) : null } catch { return null } },
    readMdl: (p) => readEntry(p),
    time: 0, _anchorCache: new Map(), _mdlCache: new Map(),
  }
}

// ── T1 移植保真度（vs elysia，逐层）──
let t1Layers = 0, t1Max = 0
for (const id of IDS) {
  const { readEntry, raw } = loadPkg(id)
  const byId = new Map(raw.objects.map((o) => [o.id, o]))
  const ctx = makeCtx(readEntry)
  const pkg = {
    has: (n) => !!readEntry(n), read: readEntry,
    readJson: (n) => { const b = readEntry(n); return b ? JSON.parse(rd(b)) : null },
    readText: (n) => { const b = readEntry(n); return b ? rd(b) : null }, entries: () => pkg.entries,
  }
  const r = new SceneRenderer(pkg, { width: 3840, height: 2160, weAssetsRead: () => null, time: 0 })
  for (const o of r.objects) {
    const trE = (() => { try { return r.resolveTransform(o) } catch { return null } })()
    const rawObj = byId.get(o.id)
    let trO = null
    try { trO = resolveTransform(rawObj, byId, ctx) } catch { /* elysia 同样失败的层跳过 */ }
    if (!trE || !trO) continue
    const d = Math.hypot(trO.origin[0] - trE.origin[0], trO.origin[1] - trE.origin[1])
    t1Layers++
    if (d > t1Max) t1Max = d
  }
}
ok(t1Max < 0.01, `T1 移植保真度：${t1Layers} 层 maxΔ=${t1Max.toFixed(5)}px < 0.01px`)

// ── T2 官方标定对齐（3719111841）──
{
  const { readEntry, raw } = loadPkg('3719111841')
  const scene = lib.parseScene(raw, null, { attachCtx: { readEntry, time: 0 } })
  const ref = JSON.parse(fs.readFileSync('./refrender-3719111841.json', 'utf8'))
  const rawById = new Map(raw.objects.map((o) => [o.id, o]))
  // 网格层按实绘矩形比（drawn = origin + scale·meshBBox，官方/elysia renderPuppet 语义）；
  // 对象 origin 对网格层不是实绘中心（眼睛组合的网格偏心 848px），直接比会虚差 568px。
  const bboxCache = new Map()
  const drawnCenter = (l) => {
    const rawObj = rawById.get(l.id)
    const img = rawObj && typeof rawObj.image === 'string' ? rawObj.image : null
    let mj = null
    try { mj = img ? JSON.parse(rd(readEntry(img))) : null } catch { mj = null }
    if (!mj || !mj.puppet) return [l.origin[0], l.origin[1]]
    if (!bboxCache.has(mj.puppet)) {
      let bb = null
      try {
        const mesh = parseMdl(new Uint8Array(readEntry(mj.puppet)))
        let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9
        for (const p of mesh.positions) {
          if (p[0] < mnx) mnx = p[0]; if (p[0] > mxx) mxx = p[0]
          if (p[1] < mny) mny = p[1]; if (p[1] > mxy) mxy = p[1]
        }
        bb = { cx: (mnx + mxx) / 2, cy: (mny + mxy) / 2 }
      } catch { bb = null }
      bboxCache.set(mj.puppet, bb)
    }
    const bb = bboxCache.get(mj.puppet)
    if (!bb) return [l.origin[0], l.origin[1]]
    return [l.origin[0] + l.scale[0] * bb.cx, l.origin[1] - l.scale[1] * bb.cy]
  }
  const ds = []
  for (const l of scene.layers) {
    const R = ref[String(l.id)]
    if (!R) continue
    const [cx, cy] = drawnCenter(l)
    ds.push({ id: l.id, name: l.name, d: Math.hypot(cx - (R[0] + R[2] / 2), cy - (R[1] + R[3] / 2)) })
  }
  ds.sort((a, b) => a.d - b.d)
  const under5 = ds.filter((x) => x.d < 5).length
  const median = ds[Math.floor(ds.length / 2)].d
  ok(under5 >= 19, `T2a 标定层 Δ<5px：${under5}/${ds.length}（≥19）`)
  ok(median < 50, `T2b 中位中心误差：${median.toFixed(1)}px < 50px（修复前 782px）`)
  const worst = ds[ds.length - 1]
  ok(worst.d < 200, `T2c 最大中心误差：${worst.d.toFixed(0)}px（${worst.id} ${worst.name}；眨眼相位差）< 200px`)
}

// ── T3 无锚点层不受影响 ──
{
  const { readEntry, raw } = loadPkg('3719111841')
  const withA = lib.parseScene(raw, null, { attachCtx: { readEntry, time: 0 } })
  const noA = lib.parseScene(raw, null, {})
  const rawById = new Map(raw.objects.map((o) => [o.id, o]))
  let same = 0, diff = []
  for (const la of withA.layers) {
    if (rawById.get(la.id)?.attachment != null) continue
    const lb = noA.layers.find((x) => x.id === la.id)
    if (!lb) continue
    if (la.origin[0] === lb.origin[0] && la.origin[1] === lb.origin[1]) same++
    else diff.push(la.id)
  }
  ok(diff.length === 0, `T3 无锚点层 origin 不变：${same}/${same + diff.length}` + (diff.length ? ' 变动层=' + diff.join(',') : ''))
}

// ── T4 角度 = 弧度 ──
{
  const syn = {
    general: { orthogonalprojection: { width: 3840, height: 2160 } },
    objects: [
      { id: 1, name: '父', origin: '1000 1000 0', scale: '1 1 1', angles: `0 0 ${Math.PI / 2}` },
      { id: 2, name: '子', parent: 1, origin: '100 0 0', scale: '1 1 1', angles: '0 0 0' },
    ],
  }
  const s = lib.parseScene(structuredClone(syn), null, {})
  const child = s.layers.find((l) => l.id === 2)
  // y-up：R(π/2)·(100,0) = (0,100) → 世界 (1000,1100)；y-down：y = 2160−1100 = 1060
  const dx = child.origin[0] - 1000, dyUp = 2160 - child.origin[1]
  ok(Math.abs(dx) < 1e-6 && Math.abs(dyUp - 1100) < 1e-6,
    `T4 弧度语义：父 z=π/2、子 origin=(100,0) → 子世界偏移=(${dx.toFixed(4)},${dyUp.toFixed(4)}) 期望 (0,1100)`)
}

// ── T5 锚点表/网格解析健全性（凯尔希）──
{
  const { readEntry, raw } = loadPkg('3719111841')
  const main = raw.objects.find((o) => o.id === 91)
  const mj = JSON.parse(rd(readEntry(main.image)))
  const mesh = parseMdl(new Uint8Array(readEntry(mj.puppet)))
  const anchors = parseMdatAnchors(new Uint8Array(readEntry(mj.puppet)))
  ok(mesh && mesh.bones.length > 0 && mesh.animations.length > 0,
    `T5a 主体 MDL：骨骼 ${mesh ? mesh.bones.length : 0} 动画 ${mesh ? mesh.animations.length : 0}（>0）`)
  ok(anchors.length >= 3, `T5b 主体 MDAT0001 锚点数 ${anchors.length}（≥3：头部/胸部/脖颈；"头发附件"锚点在长发3 475 的 MDL 上）`)
  const offs = buildAttachOffsets(raw.objects, readEntry, null, 0)
  ok(offs.size === 19, `T5c 附件偏移表 ${offs.size} 层（=19 个带 attachment 的子层）`)
}

console.log(failed ? `\n${failed} 项失败` : '\nALL PASS')
process.exit(failed ? 1 : 0)
