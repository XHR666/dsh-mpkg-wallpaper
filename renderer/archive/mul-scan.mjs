// 找出所有 mul(...) 调用，标注参数形态，便于定位 mat*vec 错配
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const BUNDLE = process.env.MPW_BUNDLE || path.join(process.env.MPW_ROOT || path.resolve('.', '..'), 'we-scene-demo', 'we-scene-bundle.js') /* ①(2026-11-03 可移植性) */
const SCENES = [['3554161528', 'Hina'], ['3544152633', 'GirlCat'], ['3327063360', 'Shiroko']]
const SCENE_ROOT = process.env.MPW_SCENES || path.join(process.env.MPW_ROOT || path.resolve('.', '..'), 'allwallpaper', 'dd') /* ①(2026-11-03 可移植性) */
const { parsePkg, getEntry, hlsl2glsl } = await import(pathToFileURL(BUNDLE).href)

const WS = process.env.MPW_ROOT || path.resolve('.', '..') /* ①(2026-11-03 可移植性) */
const commonH = fs.readFileSync(path.join(WS, 'we-scene-demo', 'common.h'), 'utf8')
const blendH = fs.readFileSync(path.join(WS, 'we-scene-demo', 'common_blending.h'), 'utf8')
const resolver = (name) => {
  const n = name.replace(/^["']|["']$/g, '')
  if (n === 'common.h') return commonH
  if (n === 'common_blending.h') return blendH
  if (n.endsWith('/common.h')) return commonH
  return null
}

function matchParen(text, openIdx) {
  let depth = 0
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') { depth--; if (depth === 0) return i }
  }
  return -1
}

function findMuls(src) {
  const out = []
  let i = 0
  while (true) {
    const idx = src.indexOf('mul(', i)
    if (idx === -1) break
    if (idx > 0 && /[A-Za-z0-9_]/.test(src[idx - 1])) { i = idx + 4; continue }
    const end = matchParen(src, idx + 3)
    if (end === -1) break
    const inner = src.slice(idx + 4, end)
    const [a, b] = inner.split(',').map((s) => s.trim())
    const brief = (s) => {
      if (!s) return '?'
      const lead = s.replace(/^\(/, '').trim()
      const m = lead.match(/^(vec[234]|mat[234]|float[234]x?[234]?|float|half|float3x3|float4x4|int)\b/)
      if (m) return m[1]
      const mm = lead.match(/^(g_[A-Za-z0-9_]+)/)
      if (mm) return mm[1]
      return lead.slice(0, 24)
    }
    out.push({ line: src.slice(0, idx).split('\n').length, a, b, ta: brief(a), tb: brief(b), raw: inner })
    i = end + 1
  }
  return out
}

for (const [sid, label] of SCENES) {
  const data = new Uint8Array(fs.readFileSync(path.join(SCENE_ROOT, sid, 'scene.pkg')))
  const pkg = parsePkg(data)
  const shaders = pkg.entries.filter((e) => /\.(vert|frag)$/.test(e.name))
  console.log(`\n######## ${label} (${sid})`)
  for (const e of shaders) {
    const src = new TextDecoder().decode(getEntry(pkg, e.name))
    const muls = findMuls(src)
    if (!muls.length) continue
    const stage = e.name.endsWith('.vert') ? 'vert' : 'frag'
    const glsl = hlsl2glsl(src, stage, {}, resolver)
    const glslLines = glsl.split('\n')
    for (const m of muls) {
      // 找到转译输出里对应行
      const rel = glslLines.findIndex((l) => l.includes('*') && /vec[234]/.test(l) && l.includes('transpose'))
      console.log(`  ${e.name} L${m.line}: mul(${m.ta}, ${m.tb})`)
      // 输出对应 glsl 片段（模糊：打印含 transpose 的乘法行）
    }
    // 打印所有含 transpose(...) * 的 glsl 行
    glslLines.forEach((l, i) => {
      const t = /transpose\([^)]*\)\s*\*\s*(vec[234])/.exec(l)
      if (t) console.log(`      [glsl L${i + 1}] transpose(...) * ${t[1]} :: ${l.trim().slice(0, 110)}`)
    })
  }
}
