// shots-prune-complexity-test.mjs —— 台账 §1.1 第 20 项判据：shots 全局清理**复杂度**（2026-10-11）
// 旧实现：每删一帧就 scan() 一次（重读所有 id 目录 + stat 所有文件）⇒ O(n²)。
// 新实现：扫一次 → 全量排序一次 → 顺序删（删除阶段零 readdir/stat）⇒ O(n log n)，策略不变。
// 判据：① 结果正确（总量降到限内、且**最旧的先被删**）② 目录读取次数与 id 数同阶（不随删除数增长）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { ROOT } from './_root.mjs'

const rows = []
const ok = (id, why, cond, detail) => rows.push({ id, why, pass: !!cond, detail: String(detail == null ? '' : detail) })

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-shotsprune-'))
const shots = path.join(tmp, 'shots')
const IDS = 3, PER = 40, FILE = 1024
for (let i = 0; i < IDS; i++) {
  const d = path.join(shots, 'id' + i); fs.mkdirSync(d, { recursive: true })
  for (let j = 0; j < PER; j++) {
    const f = path.join(d, 'f' + String(j).padStart(3, '0') + '.jpg')
    fs.writeFileSync(f, Buffer.alloc(FILE, 7))
    const t = 1700000000 + (i * PER + j)          // 全局唯一递增 mtime ⇒ 最旧的可预知
    fs.utimesSync(f, t, t)
  }
}
const totalBytes = IDS * PER * FILE
const capBytes = Math.floor(totalBytes / 2)        // 只留一半
const child = `
import fs from 'node:fs'
const realReaddir = fs.readdirSync, realStat = fs.statSync
let readdirs = 0, stats = 0
fs.readdirSync = (...a) => { readdirs++; return realReaddir(...a) }
fs.statSync = (...a) => { stats++; return realStat(...a) }
const m = await import(${JSON.stringify(path.join(ROOT, 'server', 'we-scene-demo-server.mjs'))})
const r = m.pruneShotsAll()
console.log(JSON.stringify({ ...r, readdirs, stats }))
`
const env = { ...process.env, MPW_REPORTS_DIR: tmp, MPW_LIMIT_SHOT_TOTAL_BYTES: String(capBytes) }
const res = spawnSync(process.execPath, ['--input-type=module', '-e', child], { env, encoding: 'utf8', timeout: 60000 })
let out = null
try { out = JSON.parse(String(res.stdout).trim().split('\n').pop()) } catch { /* 失败留空 */ }
try {
  ok('D1', '子进程可导入并调用 pruneShotsAll()', !!out, out ? JSON.stringify({ removed: out.removed, freed: out.freedBytes }) : String(res.stderr || '').slice(0, 120))
  if (out) {
    const left = (() => { let n = 0; for (const id of fs.readdirSync(shots)) n += fs.readdirSync(path.join(shots, id)).length; return n })()
    ok('D2', '清理到限内（剩余字节 ≤ 上限）', left * FILE <= capBytes, `剩 ${left} 帧 / 上限 ${capBytes / 1024}KB`)
    ok('D3', '删除量为"超出部分"（公平：不是一次掏空某个 id）', out.removed === IDS * PER - left, `removed=${out.removed}`)
    const survivors = []
    for (const id of fs.readdirSync(shots)) for (const n of fs.readdirSync(path.join(shots, id))) survivors.push(id + '/' + n)
    ok('D4', '**最旧的先被删**（保留的都是较新的）', !survivors.includes('id0/f000.jpg') && survivors.includes('id2/f039.jpg'), survivors.slice(0, 3).join(','))
    ok('D5', '**复杂度**：readdir 次数与 id 数同阶（≤ (ids+1)*2，不随删除数增长）', out.readdirs <= (IDS + 1) * 2, `readdirs=${out.readdirs}（旧实现会 ≈ 删除数+ids）`)
    ok('D6', '无重复 stat（删除阶段零额外 stat）', out.stats <= IDS * PER + 16, `stats=${out.stats}（帧数 ${IDS * PER}）`)
  }
} catch (e) {
  ok('D0', '判据自身可跑', false, String(e.message).slice(0, 100))
}
try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* ignore */ }
const fail = rows.filter((r) => !r.pass)
for (const r of rows) console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.id + ' ' + r.why + ' — ' + r.detail)
console.log(`===== shots-prune-complexity: ${rows.length - fail.length} 通过 / ${fail.length} 失败 =====`)
process.exit(fail.length ? 1 : 0)
