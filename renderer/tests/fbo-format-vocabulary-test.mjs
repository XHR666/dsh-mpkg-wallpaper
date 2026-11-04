// fbo-format-vocabulary-test.mjs —— §A #6：FBO 描述符 `format` 词表的**现状基线**（2026-10-10）
//
// 台账 §A #6 的口径：本仓只把 `r8` / `rg88|rg8` **真映射**到 WebGL2 的 R8/RG8（都是 color-renderable）；
// `*_backbuffer`、`rgba8888` 在缺省路径下就是 RGBA8（HDR 档由既有 float 路径决定）⇒ **显式记下不改分配**；
// 其余词表名（`rgba16161616f`/`rgb565`/`bc7`…）同样只记录。
// 语料实测（源码注释内记录）：`rgba_backbuffer` 94 / `rgba8888` 8 / `rg88` 6 / `r8` 1。
//
// 本判据只钉**当前行为**（防止将来被静默改动），不主张官方语义已经查清——官方的 HDR backbuffer
// 语义仍属未确证项；要改本判据必须先拿到权威依据并把台账 #6 更新。
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './_root.mjs'

const rows = []
const ok = (id, why, cond, detail) => rows.push({ id, why, pass: !!cond, detail: String(detail == null ? '' : detail) })
const src = fs.readFileSync(path.join(ROOT, 'core', 'we-scene-bundle.js'), 'utf8')

// A1：真映射的两档（r8 / rg88|rg8）
ok('A1', '`r8` ⇒ o.format = "r8"（真映射，color-renderable）',
  /if \(fmt === 'r8'\) o\.format = 'r8'/.test(src), 'r8 映射存在')
ok('A2', '`rg88` 或 `rg8` ⇒ o.format = "rg8"',
  /else if \(fmt === 'rg88' \|\| fmt === 'rg8'\) o\.format = 'rg8'/.test(src), 'rg8 映射存在')
// A3：其余词表只记录不生效
ok('A3', '其余词表名 ⇒ 只写 o.declaredFormat（不改分配）',
  /else if \(fmt\) o\.declaredFormat = fmt/.test(src), 'declaredFormat 分支存在')
ok('A4', '回退口 `?fbodesc=legacy` 存在（三个键全部按旧行为忽略）',
  /fboDescLegacy\(\)/.test(src) && src.includes('fbodesc'), 'legacy 回退口存在')
ok('A5', '`uvs:"repeat"` 与 `r8`/`rg8` 一样是**生效**项（唯一另一个生效键）',
  /if \(String\(f\.uvs \|\| ''\)\.toLowerCase\(\) === 'repeat'\) o\.wrap = 'repeat'/.test(src), 'uvs repeat 生效')
// A6：语料基数记录在源码注释里（可核对，不进判据阈值）
ok('A7', '官方 `rgba8888` / `*_backbuffer` ⇒ 显式 `o.format = "rgba8"`（与缺省等价，把官方语义写进代码）',
  /else if \(fmt === 'rgba8888' \|\| \/_backbuffer\$\/\.test\(fmt\)\) o\.format = 'rgba8'/.test(src), 'rgba8 显式归一')
ok('A8', '官方 **16F 家族**（rgba16161616f / rgb161616f / rg1616f / r16f）⇒ `o.float = "half"`（走既有 RGBA16F 分配）',
  /fmt === 'rgba16161616f' \|\| fmt === 'rgb161616f' \|\| fmt === 'rg1616f' \|\| fmt === 'r16f'/.test(src)
  && /o\.float = 'half'/.test(src), '16F → half')
ok('A9', '32F（rgba32323232f / rgba32f）⇒ `o.float = "full"`（RGBA32F 分配）',
  /fmt === 'rgba32323232f' \|\| fmt === 'rgba32f'/.test(src) && /o\.float = 'full'/.test(src), '32F → full')
ok('A10', '不可渲染/压缩类（rgb565/rgb888/dxt1|3|5/bc7/rgba1010102/rgb161616/rgba16161616）**不产生** format/float 映射',
  !/o\.format = '(rgb565|rgb888|dxt1|dxt3|dxt5|bc7|rgba1010102)'/.test(src)
  && !/o\.float = '[^']*'.{0,40}(rgb565|rgb888|dxt1|dxt3|dxt5|bc7)/.test(src)
  && /else if \(fmt\) o\.declaredFormat = fmt/.test(src), '只记录')
ok('A11', '回退口覆盖新映射：`fboDescOpts` 首行即 `if (fboDescLegacy()) return null`（`?fbodesc=legacy` ⇒ 逐位回旧）',
  /const fboDescOpts = \(f\) => \{\s*\n\s*if \(fboDescLegacy\(\)\) return null/.test(src), 'legacy 短路在函数首行')
ok('A6', '语料基数在源码注释中留档（rgba_backbuffer 94 / rgba8888 8 / rg88 6 / r8 1）',
  /rgba_backbuffer` 94/.test(src) && /rg88` 6/.test(src), '计数注释存在')

const fail = rows.filter((r) => !r.pass)
for (const r of rows) console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.id + ' ' + r.why + ' — ' + r.detail)
console.log(`===== fbo-format-vocabulary: ${rows.length - fail.length} 通过 / ${fail.length} 失败 =====`)
process.exit(fail.length ? 1 : 0)
