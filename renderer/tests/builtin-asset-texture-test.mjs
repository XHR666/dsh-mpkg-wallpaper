// builtin-asset-texture-test.mjs —— 「官方**包外内置素材**」像素源判据（本轮新增）
//
// 背景（离线实测）：包内纹理表查不到、又不是 `$` 开头宿主系统纹理时，resolveTextureName 老口径直接
// `null`/回落 ⇒ `particle/halo_6`（自定义 effect 的圆形精灵；`effects/xray` 的 g_Texture2 默认值就是它）、
// `util/white`、`particle/beam/beam_1` 这类官方内置素材名**永远没有像素源**。本仓实测语料结论
// （core/we-scene-bundle.js:10014）：halo 家族**全部是「RGB 恒 255 + 形状在 alpha」**。
//
// 判据：A 段 = 纯函数语义（不碰 GL）；B 段 = 接线（源码级：回落必须在 `return null` 之前 + 有台账）。
import fs from 'node:fs'
import path from 'node:path'
import { builtinAssetTextureRGBA } from '../core/we-scene-bundle.js'
import { ROOT } from './_root.mjs'

const rows = []
const ok = (id, why, cond, detail) => rows.push({ id, why, pass: !!cond, detail: String(detail == null ? '' : detail) })
const alphaAt = (t, x, y) => t.rgba[((y * t.width + x) * 4) + 3]
const rgbAt = (t, x, y) => Array.from(t.rgba.slice(((y * t.width + x) * 4), ((y * t.width + x) * 4) + 3))

const w = builtinAssetTextureRGBA('util/white')
ok('A1', 'util/white = 1×1 不透明纯白', w && w.width === 1 && w.height === 1 && rgbAt(w, 0, 0).join() === '255,255,255' && alphaAt(w, 0, 0) === 255, JSON.stringify(w && Array.from(w.rgba)))
const bk = builtinAssetTextureRGBA('util/black')
ok('A2', 'util/black = 1×1 不透明纯黑', bk && rgbAt(bk, 0, 0).join() === '0,0,0' && alphaAt(bk, 0, 0) === 255, bk && JSON.stringify(Array.from(bk.rgba)))
const h6 = builtinAssetTextureRGBA('particle/halo_6')
ok('A3', 'particle/halo_6 = 64×64、中心不透明、角落透明', h6 && h6.width === 64 && alphaAt(h6, 32, 32) === 255 && alphaAt(h6, 0, 0) === 0, h6 && `中心=${alphaAt(h6, 32, 32)} 角落=${alphaAt(h6, 0, 0)}`)
ok('A4', 'halo 家族语义：RGB 恒 255、形状只在 alpha（语料结论 :10014）', h6 && rgbAt(h6, 32, 32).join() === '255,255,255' && rgbAt(h6, 63, 63).join() === '255,255,255', h6 && JSON.stringify(rgbAt(h6, 63, 63)))
/* 取样点说明：tier 6 的**平台**半径 inner=0.48（≈x47）⇒ 46 处仍是满 alpha，必须取到平台之外
   （x52 在 [inner,outer] 的衰减段、x62 已越过 outer ⇒ 0）才能验证"单调"。 */
ok('A5', '径向单调衰减（中心 > 衰减段 > 外沿）', h6 && alphaAt(h6, 32, 32) > alphaAt(h6, 52, 32) && alphaAt(h6, 52, 32) > alphaAt(h6, 62, 32), h6 && `${alphaAt(h6, 32, 32)} > ${alphaAt(h6, 52, 32)} > ${alphaAt(h6, 62, 32)}`)
const h1 = builtinAssetTextureRGBA('particle/halo')
ok('A6', 'halo 无后缀 = 1 档，与 halo_6 是不同档位（外沿半径不同）', h1 && h1.width === 64 && alphaAt(h1, 45, 32) !== alphaAt(h6, 45, 32), h1 && `halo=${alphaAt(h1, 45, 32)} halo_6=${alphaAt(h6, 45, 32)}`)
ok('A7', '越界档位被夹到 1..8（halo_99 不抛、不越界）', (() => { const t = builtinAssetTextureRGBA('particle/halo_99'); return t && t.width === 64 && alphaAt(t, 32, 32) === 255 })(), 'halo_99 ok')
const beam = builtinAssetTextureRGBA('particle/beam/beam_1')
ok('A8', 'particle/beam/beam_1 = 横向衰减光柱（中列 > 边缘列）', beam && beam.width === 8 && alphaAt(beam, 3, 32) > alphaAt(beam, 0, 32), beam && `中=${alphaAt(beam, 3, 32)} 边=${alphaAt(beam, 0, 32)}`)
ok('A9', '未知名字 → null（不误伤、不臆造）', builtinAssetTextureRGBA('nope/not-a-real-asset') === null && builtinAssetTextureRGBA('') === null && builtinAssetTextureRGBA(null) === null, 'nope/"" /null ⇒ null')

const src = fs.readFileSync(path.join(ROOT, 'core', 'we-scene-bundle.js'), 'utf8')
const iCall = src.indexOf('builtinAssetTextureRGBA(name)')
const iNull = src.indexOf('return null\n  }', iCall)
ok('B1', '接线：resolveTextureName 在 return null 之前查内置素材表', iCall > 0 && iNull > iCall, `call@${iCall} null@${iNull}`)
ok('B2', '台账 __mpwBuiltinTex 已挂 globalThis（真机可诊断）', src.includes('globalThis.__mpwBuiltinTex') && src.includes('__builtinTexLedger.hits++'), 'ledger ok')
ok('B3', '缓存：同一名字只建一次 GL 纹理（builtinTexCache）', src.includes('builtinTexCache.get(name)') && src.includes('builtinTexCache.set(name, t)'), 'cache ok')
ok('B4', '内置源失败不改变既有行为（try/catch 兜住）', /builtinAssetTextureRGBA\(name\)[\s\S]{0,700}catch \(e\) \{ \/\* 忽略/.test(src), 'try/catch ok')

const fail = rows.filter((r) => !r.pass)
for (const r of rows) console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.id + ' ' + r.why + ' — ' + r.detail)
console.log(`===== builtin-asset-texture: ${rows.length - fail.length} 通过 / ${fail.length} 失败 =====`)
if (process.argv.includes('--json')) console.log('BUILTIN-ASSET-TEXTURE-JSON ' + JSON.stringify({ pass: rows.length - fail.length, fail: fail.length, rows }))
process.exit(fail.length ? 1 : 0)
