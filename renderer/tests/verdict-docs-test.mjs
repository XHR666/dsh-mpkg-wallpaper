// verdict-docs-test.mjs —— 判决书/核验文档的**存在性与关键结论**判据（2026-10-11）
// 由来：台账 §1.1 的若干条目以"判决=维持现状"收口（#5/#7/#12/#16/#17/#21），判决书此前只放在工作区
// `docs/reverse/`，**不在仓库**里 ⇒ ①开发看不到 ②`status-consistency` 的 V2（✅ 行须带判据文件或提交号）
// 无法引用。现把判决书镜像进 `docs/` 并加本判据，使"判决"成为**受门禁保护**的交付物。
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './_root.mjs'
const rows = []
const ok = (id, why, cond, detail) => rows.push({ id, why, pass: !!cond, detail: String(detail == null ? '' : detail) })
const DOCS = {
  'MDLE-VERDICT.md': ['MDLE0002', '维持现状', '翻案'],
  'MATERIAL-PASS-VERDICT.md': ['passes', '维持现状', '翻案'],
  'BLEND-WRITEMASK-VERDICT-20261011.md': ['idx8', 'idx12', '翻案'],
  'VIEWPORT-VVPM-VERDICT-20261011.md': ['ViewportViewProjection', '翻案'],
  'CAMERAPARALLAX-OFF-VERIFY-20261011.md': ['cameraparallax', '冻结'],
  'SCENE-SCRIPT-API-DIFF-20261011.md': ['getBone', '缺口'],
}
let n = 0
for (const [f, keys] of Object.entries(DOCS)) {
  const p = path.join(ROOT, 'docs', f)
  const exists = fs.existsSync(p)
  const body = exists ? fs.readFileSync(p, 'utf8') : ''
  const miss = keys.filter((k) => !body.includes(k))
  ok('V' + (++n), f + ' 存在且含关键结论（' + keys.join('/') + '）', exists && miss.length === 0, exists ? (miss.length ? '缺 ' + miss.join(',') : 'ok') : '文件不存在')
}
const fail = rows.filter((r) => !r.pass)
for (const r of rows) console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.id + ' ' + r.why + ' — ' + r.detail)
console.log(`===== verdict-docs: ${rows.length - fail.length} 通过 / ${fail.length} 失败 =====`)
process.exit(fail.length ? 1 : 0)
