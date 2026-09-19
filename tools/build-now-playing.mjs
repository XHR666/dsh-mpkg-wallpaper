// tools/build-now-playing.mjs —— 把 lib/now-playing-math.js + lib/now-playing.js
// **逐字节内联**进 lib/client.js 的生成区（MPW-NP-GEN-START/END）。
//
// 为什么需要这一步（不是偷懒，是宿主的硬约束）：
//   宿主 `dsh-client-modules` 把 package.json `exports["./client"]` 指向的**那一个文件**
//   整体 readFileSync 下发给浏览器；浏览器侧是 lazy CJS 表，遇到"非 graph row 的说明符"
//   直接 throw ⇒ `lib/client.js` 里出现任何**相对** import/require，线上就是"模块解析失败"
//   整块挂掉（本机却一切正常）。判据是 `tools/integrity-check.mjs` 第 ⑩ 节。
//   形态依据：`docs/CLIENT-JS-SPLIT-ASSESSMENT.md` §3(A)「源 + 生成内联」——该文档同时
//   写明了它的代价：**必须**配一条"生成物与源一致"的漂移门禁，否则就是重演
//   `tools/inline-lg-bundle.mjs` 变成死工具的老坑。
//
// 漂移门禁（**两条独立实现**，都在 check.sh 第 2 步里常驻跑）：
//   ① `node tools/build-now-playing.mjs --check` —— 本工具自己复算一遍，与产物里的**整块**生成区比；
//   ② `tools/now-playing-test.mjs` 的 A 组 —— 从产物里把两份源的正文各自抠出来，与源文件逐字节比，
//      并断言生成区在 buildCss 之前、只多 3 个绑定（A2/A3/A4/A5）。
//   两条都要：① 防"生成器与产物不一致"，② 防"产物里的正文被手改过"。
//
// 用法：
//   node tools/build-now-playing.mjs            # 生成/刷新（写 lib/client.js）
//   node tools/build-now-playing.mjs --check    # 只核对，不写；漂移则 exit 1
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..')
const MATH = path.join(repoRoot, 'lib', 'now-playing-math.js')
const COMP = path.join(repoRoot, 'lib', 'now-playing.js')
const CLIENT = path.join(repoRoot, 'lib', 'client.js')

export const GEN_START = '// >>> MPW-NP-GEN-START (generated — do not edit by hand)'
export const GEN_END = '// <<< MPW-NP-GEN-END'
/* ①(NP-1) 内联正文**逐字节、不缩进**。
   为什么不留缩进（第一版就是缩进的，被门禁抓到）：`lib/now-playing.js` 里有一个**多行模板字符串**
   （`NP_CSS`）。给每一行加 3 个 tab 会连模板字符串的**内容**一起改 ⇒ 运行期 CSS 与源不再逐字节相同，
   "生成区 == 源" 的漂移判据就得靠"再算一遍缩进"来兜，而那是**可复算但不等价**的弱判据。
   逐字节内联后：源文件 == 生成区里那一段 == 运行期拿到的字符串，三者同一份，判据最硬。
   代价只有一处：72KB 的正文在 client.js 里不缩进（外面有 MPW-NP-GEN-START/END 标记圈住，
   区块开头也写明了"生成区、不要手改"）。 */
export const GEN_INDENT = ''

/** 保留给"确实需要缩进"的场合；当前恒等（见上方注释）。 */
export function indentBlock(text, pad = GEN_INDENT) {
  const norm = text.replace(/\r\n/g, '\n')
  if (!pad) return norm
  return norm.split('\n').map((l) => (l.length ? pad + l : l)).join('\n')
}

/** 生成区内联块的正文（不含首尾标记行）。纯函数 ⇒ 门禁可以用它复算。 */
export function buildRegionBody(mathSrc, compSrc) {
  return [
    GEN_START,
    '\t\t/* ①(NP-1) Now playing —— 生成区起点。',
    '\t\t   源：lib/now-playing-math.js + lib/now-playing.js（逐字节内联，见本区块末尾）',
    '\t\t   生成：node tools/build-now-playing.mjs      漂移门禁：tools/now-playing-test.mjs',
    '\t\t   手改这一区会被门禁判红；要改就改源文件再重跑生成器。',
    '\t\t   为什么不是 require：宿主把 exports["./client"] 指向的**一个文件**整体下发，',
    '\t\t   client.js 里出现任何相对 require 线上必挂（tools/integrity-check.mjs 第 ⑩ 节）。 */',
    '\t\tconst MPW_NP_MATH = (function () {',
    '\t\t\tconst module = { exports: {} };',
    indentBlock(mathSrc),
    '\t\t\treturn module.exports;',
    '\t\t})();',
    '\t\tconst MPW_NP = (function () {',
    '\t\t\tconst module = { exports: {} };',
    indentBlock(compSrc),
    '\t\t\treturn module.exports;',
    '\t\t})();',
    '\t\t/* 生成区对外只暴露两个名字：CSS 文本（进 buildCss）与工厂（挂载用）。 */',
    '\t\tconst MPW_NP_CSS = MPW_NP.NP_CSS;',
    GEN_END,
  ].join('\n')
}

/** 在 client.js 里定位生成区（返回 {start,end} 字符下标；没有则 null）。 */
export function findRegion(src) {
  const s = src.indexOf(GEN_START)
  if (s < 0) return null
  const e = src.indexOf(GEN_END, s)
  if (e < 0) return null
  return { start: s, end: e + GEN_END.length }
}

/** 生成新 client.js 文本。没有生成区时插在 `function buildCss(` 之前（常量必须先于使用点定义）。 */
export function applyRegion(src, body) {
  const cur = findRegion(src)
  if (cur) return src.slice(0, cur.start) + body + src.slice(cur.end)
  const anchor = '\t\tfunction buildCss(section) {'
  const i = src.indexOf(anchor)
  if (i < 0) throw new Error('client.js 里找不到插入锚点：' + anchor)
  return src.slice(0, i) + body + '\n' + src.slice(i)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const check = process.argv.includes('--check')
  const mathSrc = fs.readFileSync(MATH, 'utf8').replace(/\n$/, '')
  const compSrc = fs.readFileSync(COMP, 'utf8').replace(/\n$/, '')
  const client = fs.readFileSync(CLIENT, 'utf8')
  const body = buildRegionBody(mathSrc, compSrc)
  const next = applyRegion(client, body)
  if (next === client) {
    console.log('✓ Now playing 生成区已是最新（' + body.length + ' 字符）')
    process.exit(0)
  }
  if (check) {
    console.error('✗ Now playing 生成区与源不一致（漂移）：重跑 node tools/build-now-playing.mjs')
    process.exit(1)
  }
  fs.writeFileSync(CLIENT, next)
  /* 单位更正（①(NP-2)）：原先把 `String.length` 标成"字节"——那对中文是错的
     （一个汉字 3 字节、length 只算 1）。两个数都给，各自标对。 */
  const bytes = (s) => Buffer.byteLength(s, 'utf8')
  console.log('✓ 已刷新 lib/client.js 的 Now playing 生成区：' + body.length + ' 字符'
    + '（client.js ' + bytes(client) + ' → ' + bytes(next) + ' 字节 / '
    + client.length + ' → ' + next.length + ' 字符）')
}
