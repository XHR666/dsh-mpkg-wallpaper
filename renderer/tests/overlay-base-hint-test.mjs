// overlay-base-hint-test.mjs —— "全叠加层 + 有 preview" 档判据（2026-10-11，只读功能）
// 台账 §E 第 31/32 条：丛雨 / 逆流茶会(x-ray) 命中（真机表现为噪声/马赛克）；妃咲等正常档不命中。
import fs from 'node:fs'
import path from 'node:path'
import { parsePkg, overlayBaseHint, parseScene, getOverlayBaseHint } from '../core/we-scene-bundle.js'
import { WS } from './_root.mjs'

const rows = []
const ok = (id, why, cond, detail) => rows.push({ id, why, pass: !!cond, detail: String(detail == null ? '' : detail) })

function sceneOf(mpkgPath) {
  const pkg = parsePkg(fs.readFileSync(mpkgPath))
  const names = pkg.entries.map((e) => e.name)
  const e = pkg.entries.find((x) => x.name === 'scene.json')
  if (!e) return { names, json: null }
  const start = pkg.dataStart + e.offset
  return { names, json: JSON.parse(fs.readFileSync(mpkgPath).subarray(start, start + e.size).toString('utf8')) }
}
const A = path.join(WS, 'allwallpaper', '1004', '丛雨.mpkg')
const B = path.join(WS, 'allwallpaper', '1004', '夜莺night——【parallax_视差】blue_archive_妃咲_kisaki_月下独酌【蔚蓝档案】.mpkg')
try {
  const a = sceneOf(A); const ha = overlayBaseHint(a.json, a.names)
  ok('A1', '丛雨档命中（图片层全 copybackground + 有 preview）', ha.suggest === true, JSON.stringify(ha))
  const b = sceneOf(B); const hb = overlayBaseHint(b.json, b.names)
  ok('A2', '妃咲正常档**不**命中（cb=0）', hb.suggest === false, JSON.stringify(hb))
  ok('A3', '无 preview 时永不命中', overlayBaseHint({ objects: [{ image: 'x', copybackground: true }] }, ['scene.json']).suggest === false, '')
  ok('A4', '有 preview 但图片层非全叠加 ⇒ 不命中', overlayBaseHint({ objects: [{ image: 'x' }, { image: 'y', copybackground: true }] }, ['preview.jpg']).suggest === false, '')
  ok('A5', '无图片层（纯粒子档）⇒ 不命中', overlayBaseHint({ objects: [{ particle: 'p' }] }, ['preview.jpg']).suggest === false, '')
  ok('A6', '接线：`parseScene(sceneJson, project, {entryNames})` 会把判定存进模块级读数',
    (() => { const a2 = sceneOf(A); parseScene(a2.json, null, { entryNames: a2.names }); const h = getOverlayBaseHint(); return !!(h && h.suggest === true) })(), 'overlay-base 已接入 parseScene（只读）')
  ok('A7', '诊断开关 `?overlaybase=1` 已登记在主表（只读读数，不改渲染）',
    /^\| `overlaybase` \|/m.test(fs.readFileSync(path.join(WS, 'we-scene-demo', 'docs', 'README-DIAGNOSTICS.md'), 'utf8')), 'docs 行存在')
} catch (e) {
  ok('A0', '语料可读（丛雨/妃咲两档）', false, String(e.message).slice(0, 80))
}
const fail = rows.filter((r) => !r.pass)
for (const r of rows) console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.id + ' ' + r.why + ' — ' + r.detail)
console.log(`===== overlay-base-hint: ${rows.length - fail.length} 通过 / ${fail.length} 失败 =====`)
process.exit(fail.length ? 1 : 0)
