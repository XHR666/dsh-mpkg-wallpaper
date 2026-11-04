// overlay-base-host-wiring-test.mjs —— 宿主接线（demo.html 的 MPW-OVERLAYBASE 段）判据，2026-10-11
// 与 tests/demo-videobase-order-test.mjs 同风格：**离线源码序 + 关键调用**检查（不启动浏览器）。
// 语义与回退位见台账 §E 第 31–33 条；回退位 = `?overlaybase=legacy`（另留 `?nooverlaybase` 逃生门）。
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './_root.mjs'
const src = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8')
const rows = []
const ok = (id, why, cond, detail) => rows.push({ id, why, pass: !!cond, detail: String(detail == null ? '' : detail) })
const iParse = src.indexOf('lib.parseScene(')
const iBlk = src.indexOf('MPW-OVERLAYBASE（')
const iEnd = src.indexOf('MPW-OVERLAYBASE-END')
const iGlob = src.indexOf('window.__sceneLayers = ')
const seg = (iBlk >= 0 && iEnd > iBlk) ? src.slice(iBlk, iEnd) : ''
ok('C1', 'demo.html 含 MPW-OVERLAYBASE 段', iBlk > 0 && iEnd > iBlk, `blk@${iBlk} end@${iEnd}`)
ok('C2', '顺序：parseScene → 我们的段 → END → __sceneLayers（否则层不进测试台读数/首帧）',
  iParse > 0 && iParse < iBlk && iBlk < iEnd && iEnd < iGlob, `${iParse}<${iBlk}<${iEnd}<${iGlob}`)
ok('C3', '回退位：段内以 `lib.OVERLAYBASE_LEGACY` 短路（`?overlaybase=legacy` ⇒ 逐位回到改动前）',
  /lib\.OVERLAYBASE_LEGACY/.test(seg), 'legacy 短路')
ok('C4', '逃生门：`?nooverlaybase` 也可整体关闭', /nooverlaybase/.test(seg), '')
ok('C5', '调用判定 + 注入：`lib.overlayBaseHint(sceneObj,` / `lib.setOverlayBaseTexture(` / `scene.layers.unshift(`',
  /lib\.overlayBaseHint\(sceneObj,/.test(seg) && /lib\.setOverlayBaseTexture\(/.test(seg) && /scene\.layers\.unshift\(/.test(seg), '')
ok('C6', '内存纪律：解码长边封顶（`__cap = 2048`）且用 createImageBitmap 异步解码',
  /__cap = 2048/.test(seg) && /createImageBitmap/.test(seg), '')
ok('C7', '纹理解析兼容：注入前注册进宿主 textures Map（与 MPW-VIDEOBASE 同一约定）',
  /textures\.set\(lib\.OVERLAY_BASE_TEX/.test(seg), '')
const fail = rows.filter((r) => !r.pass)
for (const r of rows) console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.id + ' ' + r.why + (r.detail ? ' — ' + r.detail : ''))
console.log(`===== overlay-base-host-wiring: ${rows.length - fail.length} 通过 / ${fail.length} 失败 =====`)
process.exit(fail.length ? 1 : 0)
