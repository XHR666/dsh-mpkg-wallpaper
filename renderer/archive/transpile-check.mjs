// 复现三场景所有 shader 的转译，扫描 GLSL ES 编译雷区
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const BUNDLE = process.env.MPW_BUNDLE || path.join(process.env.MPW_ROOT || path.resolve('.', '..'), 'we-scene-demo', 'we-scene-bundle.js') /* ①(2026-11-03 可移植性) */
const SCENES = [
  ['3554161528', 'Hina'],
  ['3544152633', 'GirlCat'],
  ['3327063360', 'Shiroko'],
]
const SCENE_ROOT = process.env.MPW_SCENES || path.join(process.env.MPW_ROOT || path.resolve('.', '..'), 'allwallpaper', 'dd') /* ①(2026-11-03 可移植性) */

const { parsePkg, getEntry, hlsl2glsl } = await import(pathToFileURL(BUNDLE).href)

// includeResolver：模拟 demo 服务器 common.h / common_blending.h
const WS = process.env.MPW_ROOT || path.resolve('.', '..') /* ①(2026-11-03 可移植性) */
const commonH = fs.readFileSync(path.join(WS, 'we-scene-demo', 'common.h'), 'utf8')
const blendH = fs.readFileSync(path.join(WS, 'we-scene-demo', 'common_blending.h'), 'utf8')
const resolver = (name) => {
  const n = name.replace(/^["']|["']$/g, '')
  const base = path.join(process.env.MPW_ROOT || path.resolve('.', '..'), 'we-scene-demo') + '/' /* ①(2026-11-03 可移植性) */
  if (n === 'common.h' || n.endsWith('/common.h')) return commonH
  if (n === 'common_blending.h') return blendH
  for (const f of ['common_blur.h', 'common_perspective.h', 'common_composite.h']) {
    if (n === f || n.endsWith('/' + f)) {
      const p2 = base + f
      return fs.existsSync(p2) ? fs.readFileSync(p2, 'utf8') : null
    }
  }
  return null
}

function scanGlsl(glsl, stage, label) {
  const issues = []
  const lines = glsl.split('\n')
  lines.forEach((l, i) => {
    const n = i + 1
    // 残留 CAST 调用
    const cast = l.match(/\bCAST[0-9][A-Za-z0-9]*\s*\(/)
    if (cast) issues.push(`L${n}: leftover ${cast[0].trim()}`)
    // matN * vecM 尺寸错配（mat4*vec3 / mat3*vec2 / mat2*vec3 等）——排除 vec4、vec1
    const mv = l.match(/\b(mat[234])\s*\*\s*(vec[234])[^.\w]/)
    if (mv) {
      const dimM = +mv[1][3], dimV = +mv[2][3]
      if (dimM !== dimV) issues.push(`L${n}: mat${dimM}*vec${dimV} mismatch :: ${l.trim().slice(0, 100)}`)
    }
    // vecN * matN 恒非法
    const vm = l.match(/\b(vec[234])\s*\*\s*(mat[234])[^.\w]/)
    if (vm) issues.push(`L${n}: vec*mat always invalid :: ${l.trim().slice(0, 100)}`)
    // mat*vec 里 vec 维度匹配但乘的是 vec2 与 mat3 之类已覆盖；补 mat2*vec3
    const mv2 = l.match(/\b(mat[234])\s*\*\s*(vec[234])\b/g)
    // floatN * mat 之类
    const fm = l.match(/\b(float|vec[234])\s*\*\s*mat[234]/)
    if (fm) issues.push(`L${n}: float/vec*mat :: ${l.trim().slice(0, 100)}`)
  })
  return issues
}

const results = []
for (const [sid, label] of SCENES) {
  const pkgPath = path.join(SCENE_ROOT, sid, 'scene.pkg')
  const data = new Uint8Array(fs.readFileSync(pkgPath))
  const pkg = parsePkg(data)
  const shaders = pkg.entries.filter((e) => /\.(vert|frag)$/.test(e.name))
  console.log(`\n######## ${label} (${sid}): ${shaders.length} shaders`)
  let issuesTotal = 0
  for (const e of shaders) {
    const stage = e.name.endsWith('.vert') ? 'vert' : 'frag'
    const src = new TextDecoder().decode(getEntry(pkg, e.name))
    let glsl
    try {
      glsl = hlsl2glsl(src, stage, {}, resolver)
    } catch (err) {
      console.log(`  [THROW] ${e.name}: ${err.message}`)
      issuesTotal++
      continue
    }
    const issues = scanGlsl(glsl, stage, e.path)
    if (issues.length) {
      console.log(`  [ISSUES] ${e.name}`)
      for (const s of issues) console.log(`      ${s}`)
      issuesTotal += issues.length
    }
  }
  results.push([label, shaders.length, issuesTotal])
}
console.log('\n===== 汇总 =====')
for (const [l, n, m] of results) console.log(`${l}: ${n} shaders, ${m} issues`)
