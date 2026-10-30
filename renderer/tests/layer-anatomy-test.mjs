#!/usr/bin/env node
// layer-anatomy-test.mjs —— 「层解剖」工具的冻结值门禁（ZCODE-TASK-20261006 §3.1 判据）
//
// 断言 `tools/layer-anatomy.mjs` 在 **3 个真包**上输出的关键字段与冻结值一致（打包字节 → parseScene
// 是纯函数，同一 core 版本下必然逐位可复现；漂移 = 无意回归或口径改动，两种都该当场红）。
// 冻结值来源：本工具首轮实测（2026-10-07），并与 docs/reports-3463520581-anatomy.md 的
// 第 61/78/79 轮人工读数、docs/reports-3448290956-interactions.md §0/§5.1 交叉核对（逐位吻合）。
//
// 语料缺失时如实 SKIP（不假绿）；用法：node tests/layer-anatomy-test.mjs
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { ROOT } from './_root.mjs'
import { analyzeLayer, resolveCorpusPkg } from '../tools/layer-anatomy.mjs'

let pass = 0, fail = 0
const ok = (c, label, extra = '') => { if (c) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }
const near = (a, b, tol) => Array.isArray(a) && Array.isArray(b) && a.length >= 2 && b.length >= 2
  && Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol
const num = (v) => (v == null ? null : Math.round(Number(v) * 1000) / 1000)

const CASES = [
  { id: '3463520581', name: 'hair kirito front' },
  { id: '3463520581', name: 'hair extra' },
  { id: '3448290956', name: '嘴巴' },
  { id: '2887099508', name: 'r ear1' },
]
const pkgs = {}
for (const c of CASES) {
  if (!pkgs[c.id]) pkgs[c.id] = resolveCorpusPkg(c.id)
}
const available = Object.entries(pkgs).filter(([, p]) => p && fs.existsSync(p))
if (available.length < 3) {
  console.log(`SKIP layer-anatomy — 语料不足：3 个真包只找到 ${available.length} 个（${Object.keys(pkgs).map((k) => k + '=' + (pkgs[k] ? '有' : '缺')).join(', ')}）`)
  process.exit(0)
}

for (const c of CASES) {
  const pkgPath = pkgs[c.id]
  if (!pkgPath || !fs.existsSync(pkgPath)) { console.log(`SKIP ${c.id}/${c.name} — 语料缺失`); continue }
  const a = analyzeLayer({ pkgPath, selector: { name: c.name }, attTime: 0 })
  const tag = `${c.id}/${c.name}`
  if (!a.ok) { ok(false, `${tag} 解析成功`, a.why || ''); continue }

  if (c.id === '3463520581' && c.name === 'hair kirito front') {
    ok(a.layer.index === 57 && a.layer.id === 102, `${tag} 选层（下标 57 / id 102，与 reports-3463520581 第 70 轮一致）`, `idx=${a.layer.index} id=${a.layer.id}`)
    ok(near(a.raw.originXY, [152.696, 815.303], 0.01), `${tag} ① 原始 origin（y-up）`, pt(a.raw.originXY))
    ok(near(a.parsed.origin, [2736.825, 206.429], 0.5), `${tag} ② 合成 origin（含锚点）`, pt(a.parsed.origin))
    ok(near(a.noattach.origin, [2736.782, 199.176], 0.5), `${tag} ②' 无锚 origin（--noattach 口径）`, pt(a.noattach.origin))
    ok(a.attach.delta && Math.abs(a.attach.delta.dx - 0.043) <= 0.05 && Math.abs(a.attach.delta.dy - 7.253) <= 0.05,
      `${tag} ③ 锚点差分 ≈ (0.043, 7.253)（y-down；即报告 61 轮 [0.04, −6.97] y-up）`, JSON.stringify(a.attach.delta))
    ok(a.attach.offsetsMapSize === 58, `${tag} ③ 全包非零锚点 58 条（报告 61 轮"58 条/45ms"）`, String(a.attach.offsetsMapSize))
    ok(a.chain.length === 1 && a.chain[0].id === 34 && a.chain[0].name === 'KIRITO PUPPET', `${tag} ④ 父链 = KIRITO PUPPET(id34)`, JSON.stringify(a.chain))
    ok(a.parentMesh && a.parentMesh.bones === 1 && a.parentMesh.vertices === 163 && a.parentMesh.indices === 882 && a.parentMesh.animations === 1,
      `${tag} ⑤ 父 puppet 网格 = 1 骨 / 163 顶点 / 882 索引 / 1 动画（报告 67 轮）`, JSON.stringify(a.parentMesh))
    ok(a.scripts.length === 0, `${tag} ⑥ 纯数据层（无脚本字段）`, String(a.scripts.length))
  }

  if (c.id === '3463520581' && c.name === 'hair extra') {
    ok(a.layer.id === 270, `${tag} 选层（id 270）`, String(a.layer.id))
    ok(near(a.noattach.origin, [1975.233, 1522.2], 0.5) && near(a.parsed.origin, [1999.101, 816.509], 0.5),
      `${tag} ②③ 无锚 (1975,1522) → 含锚 (1999,817)（报告 79 轮逐位一致）`, `${pt(a.noattach.origin)} → ${pt(a.parsed.origin)}`)
    ok(a.attach.delta && Math.abs(a.attach.delta.dy + 705.691) <= 0.5,
      `${tag} ③ 锚点把 Asuna 头发搬 Δy=−705.7 设计单位（≈148 屏幕像素，报告 79 轮的 705）`, JSON.stringify(a.attach.delta))
  }

  if (c.id === '3448290956' && c.name === '嘴巴') {
    ok(a.layer.index === 12 && a.layer.id === 233, `${tag} 选层（下标 12 / id 233）`, `idx=${a.layer.index} id=${a.layer.id}`)
    ok(near(a.raw.originXY, [1915.245, 554.242], 0.01), `${tag} ① 原始 origin（= 报告 §5.1 引文）`, pt(a.raw.originXY))
    ok(near(a.noattach.origin, [1921.689, 1819.366], 0.5), `${tag} ② 无锚合成 (1921.7, 1819.4)（报告 §5.1 引的就是这个口径）`, pt(a.noattach.origin))
    ok(a.attach.delta && Math.abs(a.attach.delta.dx + 16.022) <= 0.05 && Math.abs(a.attach.delta.dy + 242.816) <= 0.05,
      `${tag} ③ 祖先（左眼白）锚点沿父链传播 Δ=(−16.022, −242.816)（y-down = 直算 y-up [−16.02, +242.82] 取反）`, JSON.stringify(a.attach.delta))
    ok(a.attach.directOffsetYUp === null && a.attach.offsetsMapSize === 1,
      `${tag} ③ 本层自身不在锚点表（偏移挂在祖先 377 左眼白），全包恰 1 条非零锚点（报告 §0"1 层带附件"）`, String(a.attach.offsetsMapSize))
    const chainNames = a.chain.map((x) => x.name).join('→')
    ok(chainNames === 'mouth→可调整组合层→头→左眼白→头位置', `${tag} ④ 父链五级（报告 §5.1 同链）`, chainNames)
    ok(a.scripts.length === 1 && a.scripts[0].field === 'scale', `${tag} ⑥ 脚本字段 = scale ×1`, JSON.stringify(a.scripts.map((s) => s.field)))
    ok(a.packageScripts.fields === 14 && a.packageScripts.layers === 14, `${tag} 全包脚本字段 14 个 / 14 层（报告 §0 同数）`, JSON.stringify(a.packageScripts))
  }

  if (c.id === '2887099508' && c.name === 'r ear1') {
    ok(a.layer.index === 13 && a.layer.id === 162, `${tag} 选层（下标 13 / id 162）`, `idx=${a.layer.index} id=${a.layer.id}`)
    ok(near(a.raw.originXY, [4009.543, 2632.68], 0.01), `${tag} ① 原始 origin（y-up）`, pt(a.raw.originXY))
    ok(near(a.parsed.origin, [4009.543, 787.32], 0.5) && near(a.noattach.origin, [4009.543, 787.32], 0.5) &&
      a.attach.delta && a.attach.delta.dx === 0 && a.attach.delta.dy === 0 && a.attach.offsetsMapSize === 0,
      `${tag} ②③ 无锚点包：合成 = 无锚、全包 0 条锚点`, JSON.stringify(a.attach.delta))
    ok(a.mesh && a.mesh.puppet === 'models/r ear1_puppet.mdl' && a.mesh.vertices === 167 && a.mesh.indices === 891 && a.mesh.bones === 2 && a.mesh.animations === 4,
      `${tag} ⑤ puppet 网格 = 167 顶点 / 891 索引 / 2 骨 / 4 动画`, JSON.stringify(a.mesh))
    ok(a.scripts.length === 1 && a.scripts[0].field === 'visible' && a.scripts[0].exports.includes('cursorClick') && a.scripts[0].refs.includes('r ear1') && a.scripts[0].chars === 11379,
      `${tag} ⑥ 脚本字段 visible·11379 字符·导出 cursorClick·引用自身（点击换耳触发器）`, JSON.stringify(a.scripts.map((s) => ({ f: s.field, e: s.exports, n: s.chars }))))
    ok(a.packageScripts.fields === 73 && a.packageScripts.layers === 40, `${tag} 全包脚本字段 73 个 / 40 层`, JSON.stringify(a.packageScripts))
  }
}

// CLI + --json 契约冒烟：stdout 上必须有一行可解析的 `##JSON## {…}`（core 解析日志已改道 stderr）
{
  const pkgPath = pkgs['2887099508']
  if (pkgPath) {
    let out = ''
    try { out = execFileSync('node', [path.join(ROOT, 'tools/layer-anatomy.mjs'), '--pkg', pkgPath, '--name', 'r ear1', '--json'], { encoding: 'utf8', timeout: 60000 }) } catch (e) { out = String(e.stdout || '') + String(e.stderr || '') }
    const line = out.split('\n').find((l) => l.startsWith('##JSON## '))
    let parsed = null
    try { parsed = JSON.parse(line.slice('##JSON## '.length)) } catch { /* 保持 null */ }
    ok(parsed && parsed.ok && parsed.layer && parsed.layer.id === 162, 'CLI --json 契约：stdout 有可解析 `##JSON##` 行且选层正确', parsed ? 'parsed' : out.slice(0, 120))
  }
}

console.log(`\n── 汇总：PASS=${pass} FAIL=${fail}`)
process.exit(fail > 0 ? 1 : 0)
function pt(v) { return Array.isArray(v) ? `[${v.map((x) => num(x)).join(', ')}]` : String(v) }
