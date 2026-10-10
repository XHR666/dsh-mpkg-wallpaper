// err-seen-bound-test.mjs —— `mpwErr` 的**去重表有界性**判据（2026-10-11 §1.1#25 资源泄漏第 1 条）
//
// 背景：`MPW_ERR_RING` 一向有界（>40 条 shift ✓），但 `MPW_ERR_SEEN`（同错去重表）原来只有 `set(key, n+1)`
// ⇒ 长会话 / 高频**不同**错误下 **Map 无界增长** ✗。本轮给它上限 + FIFO 淘汰。本判据把该行为钉住：
//   ① 源码里存在上限常量与淘汰语句（结构断言）；
//   ② **动态**：把 `lib/client.js` 的该段整块切出来，在带 `window/localStorage/fetch/document` 假对象的环境里
//      求值 500 个**不同** key 的错误 ⇒ `__mpwErrSeenSize()` 必须 ≤ 上限；
//   ③ 同一 key 反复命中 ⇒ 计数仍单调（去重语义没被淘汰逻辑破坏）。
// 边界：只切**手写头部**的那一小段（不含任何 MPW-*-BEGIN 生成区），与 `tools/bundle-equivalence-test.mjs` 关注的区域无关。
import fs from 'node:fs'
import path from 'node:path'
const ROOT = path.resolve(import.meta.dirname, '..')
const src = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
const rows = []
const ok = (why, cond, detail = '') => rows.push({ why, pass: !!cond, detail: String(detail) })

const mMax = /const MPW_ERR_SEEN_MAX = (\d+);/.exec(src)
ok('源码含去重表上限常量 MPW_ERR_SEEN_MAX', !!mMax, mMax ? 'MAX=' + mMax[1] : '未找到')
ok('源码含 FIFO 淘汰语句（size > MAX ⇒ delete 最早插入键）',
  /if \(MPW_ERR_SEEN\.size > MPW_ERR_SEEN_MAX\) MPW_ERR_SEEN\.delete\(MPW_ERR_SEEN\.keys\(\)\.next\(\)\.value\)/.test(src), '')

// ── 动态：切出手写段（MPW_ERR_RING ⇒ mpwErr 的 try 块结束），在假环境里求值
const begin = src.indexOf('const MPW_ERR_RING = [];')
/* 边界要在**函数闭合之后**：原写法切在 `try { console.error(` 中间 ⇒ 片段不闭合 ✗。
   改为切到 `mpwErr` 之后的**下一个同级函数定义**之前（含完整 mpwErr，排除下一个函数）。 */
const fnStart = src.indexOf('function mpwErr(', begin)
const end = src.indexOf('\n\t\tfunction ', fnStart)   // mpwErr 之后的第一个同级函数 ⇒ 片段恰好含完整 mpwErr
ok('能定位待求值的手写段（不跨生成区）', begin > 0 && end > begin, `begin=${begin} end=${end}`)
let size = () => -1, n1 = -1, n2 = -1
if (begin > 0 && end > begin) {
  const frag = src.slice(begin, end)
  const win = {}
  const localStorage = { getItem: () => null, setItem: () => {} }
  const document = { location: { href: 'about:blank' } }
  const fetch = () => Promise.resolve({ ok: true })
  const consoleFake = { error: () => {} }
  const HOST_URL = 'http://127.0.0.1'
  try {
    const fn = new Function('window', 'localStorage', 'document', 'fetch', 'console', 'HOST_URL',
      frag + '\n; return { size: () => MPW_ERR_SEEN.size, err: (w, e) => mpwErr(w, e), max: MPW_ERR_SEEN_MAX };')
    const api = fn(win, localStorage, document, fetch, consoleFake, HOST_URL)
    for (let i = 0; i < 500; i++) api.err('probe' + i, new Error('e' + i))   // 500 个**不同** key
    size = api.size()
    n1 = api.err('dup', new Error('same'))
    n2 = api.err('dup', new Error('same'))
    var maxSeen = api.max
  } catch (e) { ok('手写段可独立求值', false, String(e && e.message || e).slice(0, 120)) }
  ok('500 个不同 key 后去重表大小 ≤ 上限', size >= 0 && maxSeen && size <= maxSeen, `size=${size} max=${maxSeen}`)
  ok('同一 key 反复命中去重计数仍单调（1 ⇒ 2）', n1 === 1 && n2 === 2, `n1=${n1} n2=${n2}`)
}

const fail = rows.filter((r) => !r.pass)
for (const r of rows) console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.why + (r.detail ? ' — ' + r.detail : ''))
console.log(`===== err-seen-bound: ${rows.length - fail.length} 通过 / ${fail.length} 失败 =====`)
process.exit(fail.length ? 1 : 0)
