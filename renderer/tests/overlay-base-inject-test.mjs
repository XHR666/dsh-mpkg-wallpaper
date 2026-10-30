// overlay-base-inject-test.mjs —— 基底回退（语义修复）判据，2026-10-11
// 命中类档（丛雨/逆流茶会 x-ray）：把包内 preview 缩略图当基底层垫最下；`?overlaybase=legacy` 回退。
import fs from 'node:fs'
import path from 'node:path'
import { parsePkg, overlayBaseHint, setOverlayBaseTexture, shouldInjectOverlayBase,
         injectOverlayBaseLayer, OVERLAY_BASE_TEX, hasOverlayBaseTexture, OVERLAYBASE_LEGACY } from '../core/we-scene-bundle.js'
import { WS } from './_root.mjs'
const rows = []
const ok = (id, why, cond, detail) => rows.push({ id, why, pass: !!cond, detail: String(detail == null ? '' : detail) })
function sceneOf(p) {
  const buf = fs.readFileSync(p); const pkg = parsePkg(buf)
  const names = pkg.entries.map((e) => e.name)
  const e = pkg.entries.find((x) => x.name === 'scene.json')
  const start = pkg.dataStart + e.offset
  return { names, json: JSON.parse(buf.subarray(start, start + e.size).toString('utf8')) }
}
const A = path.join(WS, 'allwallpaper', '1004', '丛雨.mpkg')
try {
  const a = sceneOf(A); const hint = overlayBaseHint(a.json, a.names)
  ok('B1', '判定命中（丛雨）', hint.suggest === true, JSON.stringify(hint))
  ok('B2', '未提供纹理时**不**注入（宿主未接线 ⇒ 零影响）',
    shouldInjectOverlayBase(hint, {}) === false && hasOverlayBaseTexture() === false, 'hasOverlayBaseTexture=false')
  const rgba = new Uint8Array(8 * 8 * 4).fill(200)
  ok('B3', 'setOverlayBaseTexture 接受合法 RGBA', setOverlayBaseTexture(rgba, 8, 8) === true, '8x8')
  const scene = { layers: [{ image: 'x.tex', copybackground: true, size: [10, 10] }, { particle: 'p' }] }
  const r = injectOverlayBaseLayer(scene, hint, {})
  ok('B4', '注入生效：新增 1 层且在最前', r.injected === true && r.index === 0 && scene.layers.length === 3, JSON.stringify(r))
  ok('B5', '基底层：纹理=合成名 + copybackground 已清 + 标记 __overlayBase',
    scene.layers[0].image === OVERLAY_BASE_TEX && scene.layers[0].textureName === OVERLAY_BASE_TEX
    && scene.layers[0].copybackground === false && scene.layers[0].__overlayBase === true, '')
  const scene2 = { layers: [{ image: 'x.tex', copybackground: true }] }
  const r2 = injectOverlayBaseLayer(scene2, hint, { overlayBaseLegacy: true })
  ok('B6', '`?overlaybase=legacy` ⇒ 完全不注入（回退位有效）', r2.injected === false && scene2.layers.length === 1, JSON.stringify(r2))
  const scene3 = { layers: [{ image: 'x.tex' }] }
  ok('B7', '未命中档（suggest=false）⇒ 不注入', injectOverlayBaseLayer(scene3, { suggest: false }, {}).injected === false, '')
  ok('B8', '回退常量存在且为布尔（`?overlaybase=legacy` 读取处）', typeof OVERLAYBASE_LEGACY === 'boolean', String(OVERLAYBASE_LEGACY))
} catch (e) {
  ok('B0', '语料/接线可读', false, String(e.message).slice(0, 80))
}
const fail = rows.filter((x) => !x.pass)
for (const x of rows) console.log((x.pass ? '  ✓ ' : '  ✗ ') + x.id + ' ' + x.why + ' — ' + x.detail)
console.log(`===== overlay-base-inject: ${rows.length - fail.length} 通过 / ${fail.length} 失败 =====`)
process.exit(fail.length ? 1 : 0)
