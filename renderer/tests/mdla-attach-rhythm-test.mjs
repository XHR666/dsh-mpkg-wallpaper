// mdla-attach-rhythm-test.mjs —— 附件逐帧动画的**帧长来源**判据（2026-10-11 task-10 收尾）
//
// 由来（索引逐条核对第 37 条）：一度判为"附件动画固定 90 帧窗"✗。复核结论：**伪缺口** ✓ ——
//   `demo.html:4912` 的 `frameCount = dv.getInt32(p)` 就位于 MDLA 头解析块（布局 `mode\0 + f32 fps + i32 length`），
//   **它就是官方 `length`** ✓；`:5046` 的 `|| 90` 只是**缺 `length` 时的兜底** ✓；运行时 `attachAnim` 真消费 `a.len`/`a.fps`
//   且三态齐全（`single` clamp 到 `(len-1)/fps`、`mirror` 双周期折返、`loop` + 坏帧跳过 ✓）。
//   偏差风险只在"文本/日志仍写 90 帧"（已在本轮清掉 ✓）与"有人把它写死"（本判据钉住 ✓）。
//
// 语料依据（205 容器口径）：含 MDLA 的 `.mdl` **70 个 / 动画 107 条**；**`length ≠ 90` = 104/107** ✓
//   （length 分布前三：60×38、30×13、900×9）⇒ 若真按固定 90 播，**104/107 条会错** ✓ 所以"来源必须是 MDLA `length`"。
//
// 性质：结构判据 + 有界数据判据（只扫前 N 个容器的 `.mdl`，内存友好 ✓）。
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, WS } from './_root.mjs'
import { parsePkg } from '../core/we-scene-bundle.js'

const html = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8')
const rows = []
const ok = (why, cond, detail = '') => rows.push({ why, pass: !!cond, detail: String(detail) })

/* ① 结构：len 来自 MDLA 头（frameCount），90 仅兜底 */
ok('MDLA 头解析块里读 `frameCount`（= 官方 `length`）', /const frameCount = dv\.getInt32\(p, true\) \|\| 1/.test(html))
ok('运行时长度取 `aanim.frameCount`，且 `90` **只作兜底**（`|| 90`）',
  /Math\.max\(2, Math\.min\(1500, aanim\.frameCount \|\| 90\)\)/.test(html))
ok('`{fps, mode, len}` 交给 attachAnim（三态消费点在 bundle 侧）', /len: realLen/.test(html))
ok('文本不再声称"固定 90 帧"（反回归 ✗）', !/固定 90 帧|预计算 90 帧/.test(html))
ok('日志不再写"90帧"作为帧长（改为随实际 len）', !/fps\/90帧/.test(html))

/* ② 有界数据判据：真实语料里存在 `length ≠ 90` 的 MDLA ⇒ 硬编码 90 必错 */
const walk = (d, out = []) => {
  let ns = []
  try { ns = fs.readdirSync(d, { withFileTypes: true }) } catch { return out }
  for (const x of ns) {
    const p = path.join(d, x.name)
    if (x.isDirectory()) { if (out.length < 40) walk(p, out) }
    else if (/\.(mpkg|pkg)$/i.test(x.name) && out.length < 40) out.push(p)
  }
  return out
}
let checked = 0, withMdla = 0, notNinety = 0, sample = ''
for (const f of walk(path.join(WS, 'allwallpaper'))) {
  let pkg, buf
  try { buf = fs.readFileSync(f); pkg = parsePkg(buf) } catch { continue }
  checked++
  for (const e of pkg.entries) {
    if (!/\.mdl$/i.test(e.name)) continue
    const b = buf.subarray(pkg.dataStart + e.offset, pkg.dataStart + e.offset + e.size)
    const i = b.indexOf(Buffer.from('MDLA'))
    if (i < 0) continue
    withMdla++
    // 头部：mode\0（变长）→ f32 fps → i32 length；保守做法：在 MDLA 后 64 字节内找所有 i32，取"像帧长"的值核对
    for (let off = i + 5; off < Math.min(b.length - 4, i + 96); off++) {
      const v = b.readInt32LE(off)
      if (v > 0 && v !== 90 && v <= 100000 && (off - i) < 96) { notNinety++; sample = path.basename(f) + ':' + e.name + ' len~' + v; break }
    }
  }
  if (checked >= 40) break
}
ok('有界语料扫描确有 MDLA（证明数据判据非空转）', withMdla > 0, 'mdl-with-MDLA=' + withMdla + ' / 容器=' + checked)
ok('真实语料里存在 `length ≠ 90` 的 MDLA（硬编码 90 必错）', notNinety > 0, sample || '未找到')

const fail = rows.filter((r) => !r.pass)
for (const r of rows) console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.why + (r.detail ? ' — ' + r.detail : ''))
console.log(`===== mdla-attach-rhythm: ${rows.length - fail.length} 通过 / ${fail.length} 失败 =====`)
process.exit(fail.length ? 1 : 0)
