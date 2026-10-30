// mip-rt-slot-default-test.mjs -- _rt_MipMappedFrameBuffer slot-default binding (2026-10-11)
//
// Official evidence (official asset tree, no disassembly needed):
//   wallpaper_engine/assets/shaders/generic4.frag:68
//     uniform sampler2D g_Texture3; // {"hidden":true,"default":"_rt_MipMappedFrameBuffer"}
//     uniform float g_Texture3MipMapInfo;   (companion; guarded by #if REFLECTION)
//   Same declaration in 7 sibling official shaders (generic3, genericimage2/3/4, chroma4, foliage4, fur4).
//   Semantics: engine binds a mip-chained copy of the frame buffer for reflection sampling.
// Our repo: no mip chain yet (mipChainMissing ledger), so bind the frame copy itself;
//   previously the slot stayed UNBOUND -> sampled black while official reflects the scene.
// Corpus trigger surface (205 containers): 2 passes / 1 container.
// Rollback: ?miprt=legacy  (restores "slot left unbound" bit-for-bit).
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, WS } from './_root.mjs'

const src = fs.readFileSync(path.join(ROOT, 'core', 'we-scene-bundle.js'), 'utf8')
const rows = []
const ok = (why, cond, detail = '') => rows.push({ why, pass: !!cond, detail: String(detail) })

ok('slot whitelist binds _rt_MipMappedFrameBuffer to the frame copy',
  /name === '_rt_MipMappedFrameBuffer'/.test(src) && /copyBgEntry && !__mipRtLegacy/.test(src))
ok('rollback ?miprt=legacy exists', /get\('miprt'\) === 'legacy'/.test(src))
ok('mipChainMissing ledger retained (we still have no mip chain)',
  /mipChainMissing/.test(src))
ok('binding is gated on copyBgEntry (no new binding when there is no frame copy)',
  /if \(copyBgEntry && !__mipRtLegacy &&/.test(src))

// official evidence must still be on disk (guards against silent asset drift)
// 官方素材树是**工作区级**资源（不在仓库内）⇒ 用相对/环境变量定位，缺失时跳过该断言
// （2026-10-11 修：原为硬编码绝对路径，导致 publish-check 常红、check.sh 退出码 1 ✗）
const WSROOT = process.env.DSH_WS || path.resolve(ROOT, '..')
const off = process.env.MPW_WE_ASSETS || path.join(WSROOT, 'wallpaper_engine', 'assets', 'shaders')
let declaring = 0
try {
  for (const f of fs.readdirSync(off)) {
    if (!/\.(frag|vert)$/.test(f)) continue
    const t = fs.readFileSync(path.join(off, f), 'utf8')
    if (t.includes('"_rt_MipMappedFrameBuffer"')) declaring++
  }
} catch (e) { declaring = -1 }
if (declaring < 0) {
  console.log('  SKIP official-asset guard: 官方素材树不在本机（' + off + '）')
} else {
  ok('official shaders still declare the RT as a slot default (>=8 expected)', declaring >= 8, 'declaring=' + declaring)
}

const fail = rows.filter((r) => !r.pass)
for (const r of rows) console.log((r.pass ? '  OK  ' : '  FAIL') + ' ' + r.why + (r.detail ? ' -- ' + r.detail : ''))
console.log('===== mip-rt-slot-default: ' + (rows.length - fail.length) + ' passed / ' + fail.length + ' failed =====')
process.exit(fail.length ? 1 : 0)
