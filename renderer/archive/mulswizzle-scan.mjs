// 正确扫描 mul(...) 后跟 swizzle 的形态（平衡括号）
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const BUNDLE = '/root/Desktop/DSHarea/we-scene-demo/we-scene-bundle.js'
const SCENE_ROOT = '/root/Desktop/DSHarea/allwallpaper/dd'
const { parsePkg, getEntry } = await import(pathToFileURL(BUNDLE).href)

function matchParen(text, openIdx) {
  let depth = 0
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '(') depth++
    else if (text[i] === ')') { depth--; if (depth === 0) return i }
  }
  return -1
}

const dirs = fs.readdirSync(SCENE_ROOT).filter((d) => /^\d+$/.test(d))
let total = 0
const hits = []
for (const d of dirs) {
  const p = path.join(SCENE_ROOT, d, 'scene.pkg')
  if (!fs.existsSync(p)) continue
  let pkg
  try { pkg = parsePkg(new Uint8Array(fs.readFileSync(p))) } catch { continue }
  for (const e of pkg.entries.filter((x) => /\.(vert|frag)$/.test(x.name))) {
    const src = new TextDecoder().decode(getEntry(pkg, e.name))
    let i = 0
    while (true) {
      const idx = src.indexOf('mul(', i)
      if (idx === -1) break
      if (idx > 0 && /[A-Za-z0-9_]/.test(src[idx - 1])) { i = idx + 4; continue }
      const end = matchParen(src, idx + 3)
      if (end === -1) break
      let j = end + 1
      while (j < src.length && /\s/.test(src[j])) j++
      const sw = src.slice(j).match(/^\.(xyzw|xyz|xy|zw|rgba|rgb|rg|w|z|y|x|a|b|g|r)\b/)
      if (sw) {
        total++
        const lineNo = src.slice(0, idx).split('\n').length
        hits.push(`${d} ${e.name} L${lineNo}: mul(...).${sw[1]} :: ${src.slice(idx, end + 1).replace(/\s+/g, ' ').slice(0, 90)}`)
      }
      i = end + 1
    }
  }
}
console.log(`mul(...).swizzle total: ${total}`)
for (const h of hits) console.log('  ', h)
