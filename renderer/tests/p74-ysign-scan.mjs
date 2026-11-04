// p74-ysign-scan.mjs — P-74 ③ 取证：语料里**所有带方向/重力的算子与 initializer**的 y 符号一致性表
// 判据（可机器复核）：
//   · 作者矢量（编辑器 y-up）进入 `p.vel`（渲染 y-down）时必须翻 y；
//   · "是否受影响" = 该参数的 y 在语料里是否是**定号**的（min/max 同号、或 gravity 非 0）。
//     定号 ⇒ 翻/不翻在**分布**上不可互换（如 velocityrandom 0 -10 0 .. 0 -100 0）；
//     对称/零 ⇒ 翻不翻对分布等价（如湍流的随机相位、rotationrandom）。
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import * as lib from '../core/we-scene-bundle.js'
// ①(去个人化 2026-09-16 / 敏感信息加固 2026-09-19) 工作区根：环境变量优先；兜底默认由 tests/_root.mjs 按**脚本自身位置**推导（不再写作者本机绝对路径）。
const MPW_WS = process.env.MPW_ROOT || WS
const DIR = `${MPW_WS}/allwallpaper/dd`
const dec = new TextDecoder()
const ids = fs.readdirSync(DIR).filter((d) => fs.existsSync(`${DIR}/${d}/scene.pkg`))
const num = (v, d) => { if (v == null) return d; if (typeof v === 'object') v = v.value; const n = Number(String(v).trim().split(/\s+/)[0]); return isFinite(n) ? n : d }
const vec = (v) => { if (v == null) return null; if (typeof v === 'object' && !Array.isArray(v)) v = v.value; const p = String(v).trim().split(/\s+/).map(Number); return p.length >= 3 && p.every(isFinite) ? p : null }
const stat = {}   // key -> {layers:Set, defSign:{}, instances}
const bump = (k) => (stat[k] = stat[k] || { layers: new Set(), pos: 0, neg: 0, zero: 0, sym: 0, samples: [] })
for (const id of ids) {
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(`${DIR}/${id}/scene.pkg`)))
  const sj = JSON.parse(dec.decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, ''))
  for (const o of (sj.objects || [])) {
    if (!o || typeof o.particle !== 'string') continue
    let def = null; try { const e = lib.getEntry(pkg, o.particle); if (e) def = JSON.parse(dec.decode(e)) } catch {}
    if (!def) continue
    const L = String(o.name || o.id)
    for (const ini of (def.initializer || [])) {
      const n = ini && ini.name
      if (n === 'velocityrandom') {
        const a = vec(ini.min), b = vec(ini.max); if (!a || !b) continue
        const s = bump('initializer.velocityrandom  min[1]..max[1]')
        s.layers.add(id + '/' + L)
        const lo = Math.min(a[1], b[1]), hi = Math.max(a[1], b[1])
        if (lo === 0 && hi === 0) s.zero++; else if (lo >= 0) s.pos++; else if (hi <= 0) s.neg++; else s.sym++
        if (s.samples.length < 6) s.samples.push(L + ' [' + a[1] + ',' + b[1] + ']')
      } else if (n === 'turbulentvelocityrandom') {
        bump('initializer.turbulentvelocityrandom  (forward/right 锥角)').layers.add(id + '/' + L)
      }
    }
    for (const op of (def.operator || [])) {
      const n = op && op.name
      if (n === 'movement') {
        const g = vec(op.gravity)
        const s = bump('operator.movement  gravity[1]')
        s.layers.add(id + '/' + L)
        if (!g || g[1] === 0) s.zero++; else if (g[1] > 0) s.pos++; else s.neg++
        if (s.samples.length < 6 && g) s.samples.push(L + ' gravity.y=' + g[1])
      } else if (n === 'oscillateposition') {
        const m = vec(op.mask)
        bump('operator.oscillateposition  mask[1] 振幅方向').layers.add(id + '/' + L)
        if (m) { const s = stat['operator.oscillateposition  mask[1] 振幅方向']; m[1] === 0 ? s.zero++ : s.pos++ }
      } else if (n === 'controlpointattract') {
        bump('operator.controlpointattract  目标点 y').layers.add(id + '/' + L)
      } else if (n === 'vortex' || n === 'turbulence') {
        bump('operator.' + n + '  (轴/振幅)').layers.add(id + '/' + L)
      }
    }
    for (const em of (def.emitter || [])) {
      const key = 'emitter.' + (em.name || 'boxrandom') + '  origin[1]/directions[1]'
      const s = bump(key); s.layers.add(id + '/' + L)
      const or = vec(em.origin), di = vec(em.directions)
      if (or) { or[1] === 0 ? s.zero++ : (or[1] > 0 ? s.pos++ : s.neg++) }
      if (di) { di[1] === 0 ? s.zero++ : (di[1] > 0 ? s.pos++ : s.neg++) }
    }
  }
}
console.log('算子/参数 × 语料 y 分量符号分布（pos=正 / neg=负 / zero=零 / sym=跨零对称）')
console.log('参数'.padEnd(52) + '层数  pos neg zero sym   样例')
for (const [k, v] of Object.entries(stat)) {
  console.log(k.padEnd(52) + String(v.layers.size).padStart(4) + String(v.pos).padStart(5)
    + String(v.neg).padStart(4) + String(v.zero).padStart(5) + String(v.sym).padStart(5) + '   ' + v.samples.slice(0, 3).join(' | '))
}
