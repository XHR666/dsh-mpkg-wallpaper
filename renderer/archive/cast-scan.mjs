// 全 dd 目录扫 CAST 变体 + mul(...).swizzle 形态（从 pkg 内部解压 shader 文本）
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const BUNDLE = '/root/Desktop/DSHarea/we-scene-demo/we-scene-bundle.js'
const SCENE_ROOT = '/root/Desktop/DSHarea/allwallpaper/dd'
const { parsePkg, getEntry } = await import(pathToFileURL(BUNDLE).href)

const dirs = fs.readdirSync(SCENE_ROOT).filter((d) => /^\d+$/.test(d))
const castVariants = new Map()
const mulSwizzle = []
let shaderCount = 0

for (const d of dirs) {
  const p = path.join(SCENE_ROOT, d, 'scene.pkg')
  if (!fs.existsSync(p)) continue
  let pkg
  try {
    const data = new Uint8Array(fs.readFileSync(p))
    pkg = parsePkg(data)
  } catch (e) { continue }
  for (const e of pkg.entries.filter((x) => /\.(vert|frag)$/.test(x.name))) {
    shaderCount++
    const src = new TextDecoder().decode(getEntry(pkg, e.name))
    for (const m of src.matchAll(/\bCAST([0-9][A-Za-z0-9]*)\s*\(/g)) {
      castVariants.set(m[1], (castVariants.get(m[1]) || 0) + 1)
    }
    // mul( ... ).swizzle 形态（转译后会有优先级问题）
    const re = /\bmul\s*\(([^)]*)\)\s*\.\s*(xyzw|xyz|xy|zw|rgba|rgb|rg|w|z|y|x|a|b|g|r)\b/g
    for (const m of src.matchAll(re)) {
      mulSwizzle.push(`${d} ${e.name}: mul(${m[1].slice(0, 60)}...).${m[2]}`)
    }
  }
}

console.log(`shaders total: ${shaderCount}`)
console.log('CAST variants:', [...castVariants.entries()].sort())
console.log(`mul(...).swizzle count: ${mulSwizzle.length}`)
for (const s of mulSwizzle.slice(0, 40)) console.log('  ', s)
