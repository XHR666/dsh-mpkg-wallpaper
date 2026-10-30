// demo-syntax-check.mjs — 提取 demo.html 的全部内联 <script> 做语法检查
// 为什么需要：demo.html 是单文件 4000+ 行，内联脚本语法错误在浏览器里只表现为"整页白屏"，
// 而它不在任何 Node 测试的覆盖范围内（run-all-tests.sh 里只有 bundle 的 node --check）。
// 用法: node demo-syntax-check.mjs [demo.html]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

// ①(2026-09-18) 默认扫**两个**页面：仓库根 demo.html（渲染器页）与 demo/index.html（测试台页）。
//   测试台的入口现在带一个内联"过期补丁自检"守卫（新 HTML + 旧补丁的缓存混合体只能由它发现并自动重载），
//   内联脚本语法错在浏览器里只表现为整页白屏 ⇒ 必须和 demo.html 一样过语法门禁。
const FILES = process.argv[2] ? [process.argv[2]] : ['demo.html', 'demo/index.html']
let m, i = 0, fail = 0
const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'demo-syn-'))
for (const file of FILES) {
const src = fs.readFileSync(file, 'utf8')
const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
while ((m = re.exec(src))) {
  const attrs = m[1] || ''
  const body = m[2] || ''
  if (/\bsrc\s*=/.test(attrs)) continue                 // 外链脚本不查
  if (!body.trim()) continue
  i++
  const isModule = /type\s*=\s*["']module["']/.test(attrs)
  const line = src.slice(0, m.index).split('\n').length
  const f = path.join(tmpdir, `blk${i}.${isModule ? 'mjs' : 'js'}`)
  fs.writeFileSync(f, body)
  try {
    execFileSync('node', ['--check', f], { stdio: 'pipe' })
    console.log(`  ✓ 内联脚本 #${i}（${isModule ? 'module' : 'classic'}，起始行 ${line}，${body.split('\n').length} 行）`)
  } catch (e) {
    fail++
    const out = String((e.stderr || e.stdout || '') || e.message).split('\n').slice(0, 6).join('\n     ')
    console.error(`  ✗ 内联脚本 #${i}（起始行 ${line}）语法错误:\n     ${out}`)
  }
}
}
// 清理放**循环之后**（第一版把 rmSync 落在循环体内 ⇒ 扫第二个文件时临时目录已不在，写 blk9.js ENOENT）
try { fs.rmSync(tmpdir, { recursive: true, force: true }) } catch {}
if (!i) { console.error('✗ 未找到内联脚本'); process.exit(1) }
console.log(`demo 内联脚本语法：${i - fail}/${i} 通过（扫 ${FILES.join(' + ')}）`)
if (fail) process.exit(1)
