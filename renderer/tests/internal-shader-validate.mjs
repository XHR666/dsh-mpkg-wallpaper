// internal-shader-validate.mjs — 校验**我们引擎内置**的 shader 常量（glsl-validate 只覆盖效果链转译产物）
// 用法: node internal-shader-validate.mjs
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
// ①(去个人化 2026-09-16 / 敏感信息加固 2026-09-19) 工作区根：环境变量优先；兜底默认由 tests/_root.mjs 按**脚本自身位置**推导（不再写作者本机绝对路径）。
const MPW_WS = process.env.MPW_ROOT || WS

const src = fs.readFileSync(`${MPW_WS}/we-scene-demo/core/we-scene-bundle.js`, 'utf8')
// 任意 `const NAME = \`#version 300 es ...\`` 形式都收集（避免命名后缀漏检）
const re = /const\s+([A-Z][A-Z0-9_]*)\s*=\s*`(#version 300 es[\s\S]*?)`/g
let m, n = 0, bad = 0
const tmp = path.join(os.tmpdir(), 'mpw-shader.glsl')
while ((m = re.exec(src))) {
  const name = m[1], body = m[2]
  const stage = /(VS|VERT)$/.test(name) ? 'vert' : 'frag'
  fs.writeFileSync(tmp, body)
  n++
  try {
    execFileSync('glslangValidator', ['-S', stage, tmp], { stdio: 'pipe' })
    console.log(`✓ ${name} (${stage})`)
  } catch (e) {
    bad++
    const out = String(e.stdout || e.message || '').slice(0, 700)
    console.error(`✗ ${name} (${stage})\n${out}`)
  }
}
console.log(`\n内置 shader 编译：${n - bad}/${n} 通过` + (bad ? ' ✗' : ' ✓'))
process.exit(bad ? 1 : 0)
