// script-frametime-cap-test.mjs —— 脚本单帧 dt 封顶（上游 9e287ea）的判据
//
// 为什么要有它：一次卡顿（切档重挂、GC、页面从后台恢复）会把 frameDt 变成几百毫秒，脚本拿它做平滑/积分时
// 部件会"甩出画面再荡回来"。修法是**封顶 0.05s**（20fps 下限），关键是"正常帧必须逐位不变"——
// 所以这条门禁的判据顺序是：先证**正常帧不变**，再证**异常帧被夹住**，最后证**接线真的接上了**。
//
// 判据：
//   A 纯函数 `mpwCapScriptDt`：正常帧（≤0.05）**逐位透传**（含 0 —— 官方语义"首帧可能为 0"）；
//     异常帧（>0.05）夹到 0.05；坏值（NaN/Infinity/负数/非数）退回 1/60（与既有守卫同口径）
//   B 接线：`frametime:` 与 `runSceneScripts(...)` 两个真实喂入点都过这个函数（源码级 + 锚点）
//   C 乘倍率的**顺序**：封顶在 `mpwSceneDt` **之前**（卡顿是帧级事实；rate 只放大正常那一档）
//   D 分辨力自证：把封顶那行改掉（临时副本）⇒ A 组的"异常帧被夹住"必红，且真树 sha 不变
//
// 运行：node tests/script-frametime-cap-test.mjs   （全过 ALL PASS，退出码 0）
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import os from 'node:os'
import { ROOT } from './_root.mjs'

const DEMO = path.join(ROOT, 'demo.html')
let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}
/** 从 demo.html 切一个函数（按名字找头、再按花括号配对；与 `scene-intro-black-test` 同款做法）。 */
function sliceFn(src, header) {
  const i = src.indexOf(header)
  if (i < 0) throw new Error('切片起点未找到（demo.html 结构变了？）：' + header)
  let k = src.indexOf('(', i), paren = 0
  for (; k < src.length; k++) {
    if (src[k] === '(') paren++
    else if (src[k] === ')') { paren--; if (paren === 0) break }
  }
  let j = src.indexOf('{', k), depth = 0
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}') { depth--; if (depth === 0) break }
  }
  return src.slice(i, j + 1)
}
const SRC = fs.readFileSync(DEMO, 'utf8')
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')

/* ── A 纯函数 ── */
const CONST_LINE = SRC.match(/const MPW_MAX_SCRIPT_FRAME_DT = [\d.]+/)[0]
const FN = sliceFn(SRC, 'function mpwCapScriptDt(dt) {')
const cap = new Function(CONST_LINE + '\n' + FN + '\nreturn mpwCapScriptDt')()
const MAXV = Number(CONST_LINE.split('=')[1])

console.log('== A 纯函数：正常帧逐位不变，异常帧夹住 ==')
ok('A1 定义存在且阈值 = 0.05（20fps 下限）', MAXV === 0.05, 'MAX=' + MAXV)
ok('A2 正常帧**逐位透传**（1/60 / 0.02 / 0.0499 一字不改）',
  cap(1 / 60) === 1 / 60 && cap(0.02) === 0.02 && cap(0.0499) === 0.0499,
  JSON.stringify([cap(1 / 60), cap(0.02), cap(0.0499)]))
ok('A3 **首帧 0 原样保留**（官方语义"可能为 0"；换成 1/60 会改首帧行为）', cap(0) === 0, 'cap(0)=' + cap(0))
ok('A4 卡顿帧被夹到 0.05（0.5 / 5 / 100 秒都夹）',
  cap(0.5) === 0.05 && cap(5) === 0.05 && cap(100) === 0.05,
  JSON.stringify([cap(0.5), cap(5), cap(100)]))
ok('A5 坏值退回 1/60（NaN / Infinity / -1 / 非数，与既有守卫同口径）',
  cap(NaN) === 1 / 60 && cap(Infinity) === 1 / 60 && cap(-1) === 1 / 60 && cap('x') === 1 / 60,
  JSON.stringify([cap(NaN), cap(Infinity), cap(-1), cap('x')]))
ok('A6 边界值 0.05 本身不夹（> 才夹，避免把 20fps 的正常帧也算异常）', cap(0.05) === 0.05)

console.log('\n== B/C 接线（两个真实喂入点 + 乘倍率顺序）==')
ok('B1 `frametime:` 走这个函数（不再是裸 frameDt）',
  /frametime:\s*mpwCapScriptDt\(frameDt\)/.test(SRC) && !/frametime:\s*\(typeof frameDt/.test(SRC))
ok('B2 `runSceneScripts(...)` 的那一路也过封顶',
  /runSceneScripts\(tSec,\s*mpwSceneDt\(mpwCapScriptDt\(frameDt\)\)\)/.test(SRC))
ok('B3 封顶在乘倍率**之前**（`mpwSceneDt(mpwCapScriptDt(...))`，不是反过来）',
  SRC.includes('mpwSceneDt(mpwCapScriptDt(frameDt))') && !SRC.includes('mpwCapScriptDt(mpwSceneDt(frameDt))'))
ok('B4 只有一个阈值定义点（禁止散落魔数）',
  (SRC.match(/MPW_MAX_SCRIPT_FRAME_DT\s*=/g) || []).length === 1,
  '定义点=' + (SRC.match(/MPW_MAX_SCRIPT_FRAME_DT\s*=/g) || []).length)

console.log('\n== D 分辨力自证（改回去必须变红；真树不许变）==')
{
  const before = sha(DEMO)
  const mutated = SRC.replace('return v > MPW_MAX_SCRIPT_FRAME_DT ? MPW_MAX_SCRIPT_FRAME_DT : v', 'return v')
  ok('D1 变异体真的改了（否则下面的对照没意义）', mutated !== SRC)
  const mConst = mutated.match(/const MPW_MAX_SCRIPT_FRAME_DT = [\d.]+/)[0]
  const mFn = sliceFn(mutated, 'function mpwCapScriptDt(dt) {')
  const mCap = new Function(mConst + '\n' + mFn + '\nreturn mpwCapScriptDt')()
  ok('D2 把封顶去掉 ⇒ "卡顿帧被夹住"必红（A4 那组在变异体上不成立）',
    mCap(0.5) === 0.5 && mCap(0.5) !== 0.05, 'mutant cap(0.5)=' + mCap(0.5))
  ok('D3 真树 sha256 跑前跑后一致（变异只落在内存里）', sha(DEMO) === before, before.slice(0, 16))
  void os
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败')
if (fail === 0) console.log('✓ 脚本单帧 dt 封顶通过：正常帧逐位不变 / 首帧 0 保留 / 卡顿帧夹到 0.05 / 坏值口径一致 / 两个喂入点都接线 / 有分辨力')
process.exit(fail > 0 ? 1 : 0)
