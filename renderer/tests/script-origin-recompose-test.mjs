// script-origin-recompose-test.mjs —— ⑤-2(P-341) 脚本 origin 的**官方语义**：局部 origin + 重新父链合成
//
// 背景（`<工作区>/docs/reports/CROP-TEXT-POSITION-DIAGNOSIS.md` §5 H5，已确认）：
//   旧实现（`core/we-scene-bundle.js` `syncScriptOrigins`）把脚本给出的 origin 当**世界增量**：
//     `l.origin += (脚本值 − authored)`，加在**已合成世界坐标**上 ✗
//   官方语义 = 脚本 `update(value)` 返回的是**该层的局部 origin**，之后**照常走父链合成** ✓
//   ⇒ 带父级的层（真机 `Clock.parent=3991`）误差 = 父链偏移 ✗。
//
// **判据的裁判（oracle）= 仓库自己的解析期合成**：同一份 objects，把该层的 authored origin 换成
//   脚本给出的新值后重新 `parseScene()` ⇒ 那一层的 origin 就是"官方合成结果"（解析期那条路每帧都在用、
//   含父链/弧度/附件锚点/Y 翻转的既有口径）。被测的是 `syncScriptOrigins()` 的运行期结果。
//   ⇒ 判据不是"同一个式子算两遍"：oracle 走解析期，被测走运行期脚本同步。
//
// 断言（任一不满足 → 退出码 1）：
//   T1 主断言（F-B：父 scale=2、父 origin=(100,50)、子局部改 Δ=(100,−50)）：
//      `l.origin` 必须 == oracle ±1px（**改动前必红**：旧口径只加世界增量，丢了父 scale 因子 2）
//   T2 级联断言（F-C：祖父→父→子，只改**父**的局部 origin，子不动）：
//      子的世界 origin 必须 == oracle ±1px（**改动前必红**：旧口径只看"自己的 origin 变没变" ⇒ 子被跳过）
//   T3 变异自证①（防"永远红"）：父链**恒等**（F-A）时，两种口径必须给出**同一个**值
//   T4 变异自证②（差异可算）：F-B 两口径的差必须**恰好** = (Δx, −Δy) 在 y-down 下的 (100, 50)
//      —— 即父链因子 (s−1)·Δ 被真的施加了；打印「期望红集 == 实际红集」
//   T5 回退位：`{legacy:true}`（= `?scrorigin=legacy`）必须逐位回到旧口径（对 F-B 与 oracle 不同）
//   T6 真实包结构读数（有语料时；缺则 SKIP）：真包 `窗畔弦歌` 的 Clock（parent=3991）父链累计变换
//
// 用法: node tests/script-origin-recompose-test.mjs
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { WS } from './_root.mjs'

const REPO = path.resolve(import.meta.dirname, '..')
/* 被测 bundle 可换（`MPW_BUNDLE=/tmp/we-scene-bundle.js.bak2` = 改动前的备份）
   ⇒ 同一条判据在两个实现上各跑一次，「期望红集 == 实际红集」这条自证可以跨实现做。 */
const BUNDLE = process.env.MPW_BUNDLE || path.join(REPO, 'core/we-scene-bundle.js')
const lib = await import(pathToFileURL(BUNDLE).href)
let pass = 0, fail = 0
const ok = (c, label, extra = '') => { if (c) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }
const skip = (label, why) => console.log('SKIP ' + label + ' —— ' + why)
const PROJ = { width: 1920, height: 1080 }
const PROJH = PROJ.height
const fmtV = (v) => '[' + (v ? v.map((x) => (Math.round(x * 1000) / 1000)).join(', ') : '-') + ']'

/* ── 夹具（合成 scene.json；origin 用真实语料形态 `{script, value}`） ── */
const scr = (value) => ({ script: 'export function update(value){ return value }', scriptproperties: {}, value })
const FIX = {
  // F-A 父链恒等：父在原点、scale 1 ⇒ 两种口径必须同值
  A: {
    objs: [
      { id: 1, name: 'P', origin: '0 0 0', scale: '1 1 1', angles: '0 0 0' },
      { id: 2, name: 'C', parent: 1, origin: scr('10 20 0'), scale: '1 1 1', angles: '0 0 0' },
    ],
    id: 2, from: '10 20 0', to: '30 60 0',   // Δlocal = (20, 40)
  },
  // F-B 父 scale=2、父 origin=(100,50)：Δlocal = (100, −50) ⇒ 两口径 y-down 差恰为 (100, 50)
  B: {
    objs: [
      { id: 1, name: 'P', origin: '100 50 0', scale: '2 2 1', angles: '0 0 0' },
      { id: 2, name: 'C', parent: 1, origin: scr('10 20 0'), scale: '1 1 1', angles: '0 0 0' },
    ],
    id: 2, from: '10 20 0', to: '110 -30 0',  // Δlocal = (100, −50)
  },
  // F-C 级联：祖父 → 父（脚本改父）→ 子（脚本没碰）
  C: {
    objs: [
      { id: 1, name: 'G', origin: '0 0 0', scale: '1 1 1', angles: '0 0 0' },
      { id: 2, name: 'P', parent: 1, origin: scr('10 20 0'), scale: '1 1 1', angles: '0 0 0' },
      { id: 3, name: 'C', parent: 2, origin: '5 5 0', scale: '1 1 1', angles: '0 0 0' },
    ],
    id: 2, from: '10 20 0', to: '110 70 0',   // Δlocal(父) = (100, 50) ⇒ 子必须跟着走
    child: 3,
  },
}
const clone = (o) => JSON.parse(JSON.stringify(o))
const parseWith = (objs) => lib.parseScene({ general: { orthogonalprojection: PROJ }, objects: objs }, null, {})
/** oracle：把**被脚本改写的那一层**（`mutateId`，缺省 = 被测层）的 authored origin 换成脚本新值后
    **重新解析** ⇒ 官方合成结果。级联夹具里"被改的是父、被测的是子"，两者必须分开传。 */
function oracleOf(fix, readId, mutateId) {
  const mid = (mutateId === undefined || mutateId === null) ? readId : mutateId
  const objs = clone(fix.objs).map((o) => (o.id === mid ? Object.assign({}, o, { origin: fix.to }) : o))
  const sc = parseWith(objs)
  const l = sc.layers.find((x) => x.id === readId)
  return l ? l.origin.slice() : null
}
/** 被测：解析 authored 旧值 → 把 raw.origin.value 改成脚本新值 → 跑 syncScriptOrigins。 */
function runtimeOf(fix, id, opts) {
  const objs = clone(fix.objs)
  const sc = parseWith(objs)
  const base = lib.snapshotAuthoredOrigins(objs)
  const raw = objs.find((o) => o.id === id)
  if (raw.origin && typeof raw.origin === 'object') raw.origin.value = fix.to
  else raw.origin = fix.to
  const n = lib.syncScriptOrigins(sc, objs, base, null, opts)
  const l = sc.layers.find((x) => x.id === id)
  return { origin: l ? l.origin.slice() : null, synced: n, scene: sc, base, objs }
}
const dist = (a, b) => (!a || !b) ? Infinity : Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]))

/* ── T1 主断言 ── */
console.log('══ T1/T2 主断言：运行期结果 == 解析期 oracle（±1px） ══')
{
  const want = oracleOf(FIX.B, FIX.B.id)
  const got = runtimeOf(FIX.B, FIX.B.id, null)
  const d = dist(got.origin, want)
  ok(d <= 1, 'T1 F-B 父 scale=2：脚本值必须按父链合成（oracle 解析期结果）',
    'oracle=' + fmtV(want) + ' 运行期=' + fmtV(got.origin) + ' 最大差=' + (isFinite(d) ? d.toFixed(3) + 'px' : '∞'))
}
/* ── T2 级联断言 ── */
{
  const want = oracleOf(FIX.C, FIX.C.child, FIX.C.id)
  const got = runtimeOf(FIX.C, FIX.C.id, null)
  const ln = got.scene.layers.find((x) => x.id === FIX.C.child)
  const d = dist(ln ? ln.origin : null, want)
  ok(d <= 1, 'T2 F-C 级联：只改**父**的局部 origin ⇒ **子**的世界 origin 必须跟着走（oracle ±1px）',
    'oracle=' + fmtV(want) + ' 运行期=' + fmtV(ln && ln.origin) + ' 最大差=' + (isFinite(d) ? d.toFixed(3) + 'px' : '∞'))
}
/* ── T3/T4 变异自证 ── */
console.log('\n══ T3/T4 变异自证（防"永远红"） ══')
{
  // T3 父链恒等 ⇒ 两口径同值
  const wantA = oracleOf(FIX.A, FIX.A.id)
  const gotA = runtimeOf(FIX.A, FIX.A.id, null)
  const dA = dist(gotA.origin, wantA)
  ok(dA <= 1, 'T3 父链恒等（F-A）⇒ 两种口径必须同值（判据既能红也能绿）',
    'oracle=' + fmtV(wantA) + ' 运行期=' + fmtV(gotA.origin) + ' 最大差=' + dA.toFixed(3) + 'px')

  // T4 F-B 两口径之差必须恰好 = (Δx, −Δy) 在 y-down 下 = (100, 50)
  const wantB = oracleOf(FIX.B, FIX.B.id)
  const nowB = runtimeOf(FIX.B, FIX.B.id, null).origin
  const legB = runtimeOf(FIX.B, FIX.B.id, { legacy: true }).origin
  const dNow = dist(nowB, wantB), dLeg = dist(legB, wantB)
  const gotDiff = [(nowB[0] - legB[0]), (nowB[1] - legB[1])]
  const wantDiff = [100, 50]   // Δlocal=(100,−50)、父 scale=2 ⇒ (s−1)·Δ = (100,−50)（editor）⇒ y-down 取反 y = (100, +50)
  const diffOk = Math.abs(gotDiff[0] - wantDiff[0]) <= 1 && Math.abs(gotDiff[1] - wantDiff[1]) <= 1
  ok(dNow <= 1 && diffOk, 'T4 F-B 两口径之差必须恰好 = (100, 50)（= 父链因子 (s−1)·Δ 在 y-down 下的值）',
    '新口径=' + fmtV(nowB) + ' legacy=' + fmtV(legB) + ' 实测差=' + fmtV(gotDiff) + ' 期望差=' + fmtV(wantDiff))
  const expectedRed = new Set(['legacy'])
  const actualRed = new Set()
  if (dNow > 1) actualRed.add('default')
  if (dLeg > 1) actualRed.add('legacy')
  const sameSets = expectedRed.size === actualRed.size && [...expectedRed].every((k) => actualRed.has(k))
  ok(sameSets, 'T4b 期望红集 == 实际红集（新口径必须绿、legacy 档必须红）',
    '期望=' + JSON.stringify([...expectedRed]) + ' 实际=' + JSON.stringify([...actualRed]) + '（新口径差 ' + dNow.toFixed(3) + 'px / legacy 差 ' + dLeg.toFixed(3) + 'px）')
}
/* ── T5 回退位逐位 ── */
{
  const legB = runtimeOf(FIX.B, FIX.B.id, { legacy: true }).origin
  const wantLegacyDelta = (() => {
    // 旧口径的可算值：authored 世界 origin + (Δlocal_x, −Δlocal_y)
    const sc = parseWith(clone(FIX.B.objs))
    const a = sc.layers.find((x) => x.id === FIX.B.id).origin.slice()
    return [a[0] + 100, a[1] + 50]   // Δlocal=(100,−50) ⇒ y-down 加 +50
  })()
  const d = dist(legB, wantLegacyDelta)
  ok(d <= 1, 'T5 `?scrorigin=legacy`（这里用 {legacy:true}）必须逐位回到旧口径（世界增量）',
    'legacy=' + fmtV(legB) + ' 旧口径可算值=' + fmtV(wantLegacyDelta) + ' 最大差=' + d.toFixed(3) + 'px')
}
/* ── T6 真实包读数 ── */
{
  const pkgPath = path.join(WS, 'allwallpaper', '1004', '夜莺night——blue_archive_小鸟游星野_窗畔弦歌.mpkg')
  if (!fs.existsSync(pkgPath)) skip('T6 真包父链读数', '语料不在：<工作区>/allwallpaper/1004/…窗畔弦歌.mpkg')
  else {
    const { parsePkg, readPkgEntry, entryNames, getEntry } = await import(path.join(REPO, 'packages/we-core/src/pkg.js'))
    const pkg = parsePkg(new Uint8Array(fs.readFileSync(pkgPath)))
    const names = entryNames(pkg)
    const sj = names.find((x) => x === 'scene.json')
    const ent = pkg.entries.find((x) => (x.name || x.path) === sj)
    const j = JSON.parse(Buffer.from(readPkgEntry(pkg, ent)).toString('utf8').replace(/^\uFEFF/, ''))
    const sc = lib.parseScene(j, null, { attachCtx: { readEntry: (n) => getEntry(pkg, n), time: 0 } })
    const clock = sc.layers.filter((l) => l.__text && l.__text.scriptDriven).find((l) => Array.isArray(l.__localOrigin) && l.__parentXf)
    if (!clock) skip('T6 真包父链读数', '该包里没找到"脚本驱动 origin + 带父级"的文本层')
    else {
      const x = clock.__parentXf
      ok(true, 'T6 真包读数：`' + String(clock.name || clock.id) + '` 是脚本驱动 + 带父级（父链累计 cos/sin=' + x.cos.toFixed(3) + '/' + x.sin.toFixed(3)
        + '，scale=' + x.sx.toFixed(3) + '×' + x.sy.toFixed(3) + '）⇒ 旧口径每改 Δlocal 就少乘这个因子',
        'authored 局部=' + fmtV(clock.__localOrigin) + ' 旧口径世界=' + fmtV(clock.__authOriginWorld))
    }
  }
}

console.log('\n结果: PASS ' + pass + ' / FAIL ' + fail)
process.exit(fail ? 1 : 0)
