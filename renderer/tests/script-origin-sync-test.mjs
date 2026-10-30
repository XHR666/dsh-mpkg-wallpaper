// script-origin-sync-test.mjs — RE-28 脚本 origin 同步回归测试（离线复现设备症状）
//
// 事故（用户："现在的渲染还是有问题"）：
//   3719111841 在浏览器里只剩几个 mesh 层可见（主体/耳朵/眼睛），所有带 attachment 的**图片层**
//   （头发/衣袖/发片/飘带…）整体飞出画面，背景为清屏灰。设备上报的 DIAG 行是铁证：
//     右侧发@(67,2675) | 底发@(-277,1719) | 衣袖@(-517,2661)   ← 与 **raw authored origin** 逐位相同
//   而 parseScene（父链+附件锚点）算出的是 (2575,743)/(2284,342)/(1948,1965)。
//
//   根因：demo.html 的 RE-28 同步把 raw.origin **直接赋值**给 l.origin，等于把 parseScene 加上去的
//   附件锚点偏移抹掉。CPU 预览（preview.mjs 不跑脚本）因此一直是对的，浏览器一直错 —— 两端分歧点。
//
// 本测试用 bundle 里的共享实现（snapshotAuthoredOrigins / syncScriptOrigins）在 Node 里复现这条链路：
//   T1 现状对照：旧写法（直接赋值）复现设备 DIAG 的 raw 值（证明测试确实抓得到该 bug）
//   T2 不写 origin 的脚本：修完后 origin 与 parseScene 锚点结果**逐位一致**（不再被抹）
//   T3 写 origin 的脚本：增量叠加 = 锚点结果 + (dx,-dy)（脚本语义保留）
//   T4 无锚点层等价性：没有附件锚点的层，新旧实现结果逐位相同（零行为差异）
//
// 用法: node script-origin-sync-test.mjs [sceneId]
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import * as lib from '../core/we-scene-bundle.js'
// ①(去个人化 2026-09-16 / 敏感信息加固 2026-09-19) 工作区根：环境变量优先；兜底默认由 tests/_root.mjs 按**脚本自身位置**推导（不再写作者本机绝对路径）。
const MPW_WS = process.env.MPW_ROOT || WS

const sceneId = process.argv[2] || '3719111841'
const pkgPath = `${MPW_WS}/allwallpaper/dd/${sceneId}/scene.pkg`
if (!fs.existsSync(pkgPath)) { console.error('✗ 缺包: ' + pkgPath); process.exit(1) }

const DEC = new TextDecoder()
const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(pkgPath)))
const sceneJson = JSON.parse(DEC.decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, ''))
const readEntry = (n) => lib.getEntry(pkg, n)
const sceneObj = JSON.parse(JSON.stringify(sceneJson))          // 脚本/同步会改它 → 用副本

let pass = 0, fail = 0
const ok = (cond, name, detail = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  (' + detail + ')' : '')) }
  else { fail++; console.error('  ✗ ' + name + (detail ? '  (' + detail + ')' : '')) }
}

// 设备的 DIAG 采样（reports/r1789221848912.json 的【DIAG】行，y-down 设计坐标）
const DEVICE = { 右侧发: [67, 2675], 底发: [-277, 1719], 衣袖: [-517, 2661] }

console.log(`[T1] 复现设备症状：旧写法（raw.origin 直接赋值）`)
const anchored = lib.parseScene(JSON.parse(JSON.stringify(sceneJson)), null, { attachCtx: { readEntry, time: 0 } })
{
  // 旧实现（回归版）：l.origin = flip(raw authored)
  const H = sceneJson.general.orthogonalprojection.height
  let matched = 0, total = 0
  for (const [name, dev] of Object.entries(DEVICE)) {
    const L = anchored.layers.find((l) => l.name === name)
    const o = (sceneObj.objects || []).find((x) => x.name === name)
    if (!L || !o) continue
    const raw = String(o.origin).trim().split(/\s+/).map(Number)
    const oldOrigin = [raw[0], H - raw[1]]                       // 旧写法的结果
    total++
    const devMatch = Math.abs(oldOrigin[0] - dev[0]) < 1 && Math.abs(oldOrigin[1] - dev[1]) < 1
    const anchorDiff = Math.round(Math.hypot(oldOrigin[0] - L.origin[0], oldOrigin[1] - L.origin[1]))
    if (devMatch) matched++
    console.log(`      ${name}: 旧写法=(${Math.round(oldOrigin[0])},${Math.round(oldOrigin[1])}) 设备DIAG=(${dev[0]},${dev[1]}) ` +
      `锚点后=(${Math.round(L.origin[0])},${Math.round(L.origin[1])}) 与锚点差=${anchorDiff}px`)
  }
  ok(matched === total, 'T1 旧写法结果 == 设备 DIAG（证明测试复现了现场）', `${matched}/${total} 层逐位吻合`)
}

console.log(`\n[T2] 修复后：脚本**不写** origin → 锚点结果保持`)
{
  const sc = lib.parseScene(JSON.parse(JSON.stringify(sceneJson)), null, { attachCtx: { readEntry, time: 0 } })
  const base = lib.snapshotAuthoredOrigins(sceneObj.objects)
  const before = new Map(sc.layers.map((l) => [l.id, [l.origin[0], l.origin[1]]]))
  const n = lib.syncScriptOrigins(sc, sceneObj.objects, base, new Map())
  let same = 0, diff = []
  for (const l of sc.layers) {
    const b = before.get(l.id)
    if (Math.abs(l.origin[0] - b[0]) < 1e-9 && Math.abs(l.origin[1] - b[1]) < 1e-9) same++
    else diff.push(l.name)
  }
  ok(n === 0, 'T2a 无脚本改动 → synced=0', 'synced=' + n)
  ok(same === sc.layers.length, 'T2b 所有层 origin 逐位不变（锚点偏移保住）', `${same}/${sc.layers.length}${diff.length ? ' 变化: ' + diff.slice(0, 5) : ''}`)
  // 与标定表比对：修复后应与 refrender 一致（≤2px），旧写法会差数百 px
  const refFile = `./refrender-${sceneId}.json`
  if (fs.existsSync(refFile)) {
    const ref = JSON.parse(fs.readFileSync(refFile, 'utf8'))
    const isMeshLayer = (l) => {
      try {
        if (!l.image) return false
        const me = readEntry(l.image)
        if (!me) return false
        const mj = JSON.parse(DEC.decode(me).replace(/^\uFEFF/, ''))
        return !!(mj && mj.puppet)
      } catch { return false }
    }
    let worst = 0, worstName = '', n = 0
    for (const l of sc.layers) {
      const r = ref[String(l.id)]
      if (!r) continue
      // 网格层的 l.origin 是网格枢轴（实绘中心 = origin + scale·meshBBox），标定表存的是实绘矩形中心
      // → 不是同一口径（layer-rect-check 才是网格层的裁判）；这里只比图片层。
      if (isMeshLayer(l)) continue
      n++
      const d = Math.hypot(l.origin[0] - (r[0] + r[2] / 2), l.origin[1] - (r[1] + r[3] / 2))
      if (d > worst) { worst = d; worstName = String(l.name) }
    }
    ok(worst < 5, 'T2c 修复后图片层 origin 与标定表一致（layer-rect-check 口径）', `${n} 层，最大 ${worst.toFixed(1)}px @ ${worstName}`)
  }
}

console.log(`\n[T3] 修复后：脚本**写** origin → 增量叠加（脚本语义保留）`)
{
  for (const [name, dx, dy] of [['底发', 120, -45], ['右侧发', -30, 88]]) {
    const rawCopy = JSON.parse(JSON.stringify(sceneJson))
    const sc = lib.parseScene(JSON.parse(JSON.stringify(rawCopy)), null, { attachCtx: { readEntry, time: 0 } })
    const objs = rawCopy.objects
    const base = lib.snapshotAuthoredOrigins(objs)
    const bl = sc.layers.find((l) => l.name === name)
    const before = { origin: [bl.origin[0], bl.origin[1]] }   // ← 必须取副本：同步是就地改写
    const o = objs.find((x) => x.name === name)
    const p = String(o.origin).trim().split(/\s+/).map(Number)
    o.origin = `${p[0] + dx} ${p[1] + dy} 0.00000`                // 模拟脚本改写 authored origin
    const n = lib.syncScriptOrigins(sc, objs, base, new Map())
    const after = sc.layers.find((l) => l.name === name)
    /* ①⑤-2(P-341 2026-10-12 **契约变更**，经 Lead 授权：只改本 T3 块，T1/T2/T4–T7 一字不动)
       脚本 origin 的**官方语义** = 脚本返回值是**该层的局部 origin**，之后**重新走父链合成**
       （`<工作区>/docs/reports/CROP-TEXT-POSITION-DIAGNOSIS.md` §5 H5）——旧期望
       `before + (dx,−dy)`（= 世界增量）就是被改掉的那个口径。
       ⇒ 期望值改用 **oracle**：把该层 authored origin 换成脚本新值后**重新 parseScene**，
         取那一层的 origin（解析期合成 = 官方口径，含父链/弧度/附件锚点/Y 翻转）。
       ⇒ 并**同时**钉住旧口径：`{legacy:true}`（= `?scrorigin=legacy`）必须仍等于 `before + (dx,−dy)`
          —— 两个口径都被断言，判据强度不降反升（任一档被写死 ⇒ 另一档必红）。 */
    const p2 = String(o.origin).trim().split(/\s+/).map(Number)
    const jOracle = JSON.parse(JSON.stringify(sceneJson))                    // 干净副本（parseScene 会就地合成层坐标）
    jOracle.objects.find((x) => x.name === name).origin = `${p2[0]} ${p2[1]} ${p2[2] || 0}`
    const scOracle = lib.parseScene(jOracle, null, { attachCtx: { readEntry, time: 0 } })
    const lOracle = scOracle.layers.find((l) => l.name === name)
    const ex = [lOracle.origin[0], lOracle.origin[1]]                        // oracle（官方语义）
    const exLegacy = [before.origin[0] + dx, before.origin[1] - dy]          // 旧口径（世界增量）
    const err = Math.hypot(after.origin[0] - ex[0], after.origin[1] - ex[1])
    ok(n === 1 && err < 1e-6, `T3 ${name} 脚本值按父链重合成 == oracle（官方语义）`,
      `oracle=(${ex[0].toFixed(1)},${ex[1].toFixed(1)}) 实际=(${after.origin[0].toFixed(1)},${after.origin[1].toFixed(1)}) synced=${n}`)
    // 旧口径必须仍可复现（回退位逐位）
    const rawCopy2 = JSON.parse(JSON.stringify(sceneJson))
    const scL = lib.parseScene(JSON.parse(JSON.stringify(rawCopy2)), null, { attachCtx: { readEntry, time: 0 } })
    const baseL = lib.snapshotAuthoredOrigins(rawCopy2.objects)
    const oL = rawCopy2.objects.find((x) => x.name === name)
    oL.origin = `${p2[0]} ${p2[1]} ${p2[2] || 0}`
    const nL = lib.syncScriptOrigins(scL, rawCopy2.objects, baseL, new Map(), { legacy: true })
    const aL = scL.layers.find((l) => l.name === name)
    const errL = Math.hypot(aL.origin[0] - exLegacy[0], aL.origin[1] - exLegacy[1])
    const differs = Math.hypot(after.origin[0] - aL.origin[0], after.origin[1] - aL.origin[1]) > 1e-6
    ok(nL === 1 && errL < 1e-6, `T3-legacy ${name} \`?scrorigin=legacy\` 必须逐位回旧口径（世界增量）`,
      `旧口径期望=(${exLegacy[0].toFixed(1)},${exLegacy[1].toFixed(1)}) legacy档=(${aL.origin[0].toFixed(1)},${aL.origin[1].toFixed(1)}) synced=${nL}`)
    ok(differs, `T3-split ${name} 两档必须**给出不同读数**（否则契约变更没生效 / 判据是同义反复）`,
      `新=(${after.origin[0].toFixed(1)},${after.origin[1].toFixed(1)}) legacy=(${aL.origin[0].toFixed(1)},${aL.origin[1].toFixed(1)}) 差=${Math.hypot(after.origin[0] - aL.origin[0], after.origin[1] - aL.origin[1]).toFixed(2)}px`)
    // 幂等：同一帧重复调用不应继续漂移
    const again = lib.syncScriptOrigins(sc, objs, base, new Map())
    const err2 = Math.hypot(after.origin[0] - ex[0], after.origin[1] - ex[1])
    ok(again === 0 && err2 < 1e-6, `T3b ${name} 重复同步幂等（不累加）`, 'synced=' + again)
  }
}

console.log(`\n[T4] 无锚点层：新旧实现逐位等价（零行为差异）`)
{
  const rawA = JSON.parse(JSON.stringify(sceneJson))
  const noAnchor = lib.parseScene(rawA, null, {})                // 不带 attachCtx → 无锚点
  const base = lib.snapshotAuthoredOrigins(rawA.objects)
  const objs = rawA.objects
  const dx = 33, dy = -21
  const target = noAnchor.layers.find((l) => !l.__skin && l.origin && objs.some((o) => o.id === l.id && o.name === l.name))
  const o = objs.find((x) => x.id === target.id)
  const p = String(o.origin).trim().split(/\s+/).map(Number)
  o.origin = `${p[0] + dx} ${p[1] + dy} 0.00000`
  lib.syncScriptOrigins(noAnchor, objs, base, new Map())
  const H = sceneJson.general.orthogonalprojection.height
  const oldResult = [p[0] + dx, H - (p[1] + dy)]                  // 旧写法（直接赋值）
  const err = Math.hypot(target.origin[0] - oldResult[0], target.origin[1] - oldResult[1])
  ok(err < 1e-6, `T4 无锚点层结果 == 旧实现（逐位）`, `${target.name} 新=(${target.origin[0].toFixed(1)},${target.origin[1].toFixed(1)}) 旧=(${oldResult[0].toFixed(1)},${oldResult[1].toFixed(1)})`)
}

console.log(`\n[T5] P-237 脚本节点值同步（visible/alpha）：只碰 {script,value}，裸值零回归`)
{
  const mk = () => {
    const raw = [
      { id: 1, name: 'a', visible: { script: 'x', value: true }, alpha: { script: 'y', value: 1 } },
      { id: 2, name: 'b', visible: true, alpha: 1 },                       // 裸值：本函数**不碰**
      { id: 3, name: 'c', visible: { script: 'z', value: false }, alpha: { script: 'w', value: 0.25 } },
      { id: 4, name: 'd', visible: { script: 'q', value: true }, alpha: { script: 'r', value: 'abc' } },   // alpha 非法 ⇒ 丢弃
    ]
    const sc = { layers: raw.map((o) => ({ id: o.id, name: o.name, visible: true, alpha: 1, origin: [0, 0, 0] })) }
    return { raw, sc }
  }
  // T5a 初值：脚本节点把可见性/透明度按 value 写进层
  {
    const { raw, sc } = mk()
    const n = lib.syncScriptValues(sc, raw, {})
    ok(sc.layers[0].visible === true && sc.layers[0].alpha === 1, 'T5a 脚本 value=true/1 ⇒ 层 vis/alpha 保持', JSON.stringify(sc.layers[0]))
    ok(sc.layers[2].visible === false && Math.abs(sc.layers[2].alpha - 0.25) < 1e-6, 'T5a 脚本 value=false/0.25 ⇒ 层 vis=false alpha=0.25', JSON.stringify(sc.layers[2]))
    ok(sc.layers[1].visible === true && sc.layers[1].alpha === 1, 'T5a 裸值层不被本函数改写（零回归面）', JSON.stringify(sc.layers[1]))
    ok(n === 2, 'T5a 只对真正变化的 2 处计数（c 的 visible+alpha 各 1？⇒ 实测 ' + n + '）', 'n=' + n)
  }
  // T5b 脚本改值 ⇒ 层跟着变（改动前：节点是对象 ⇒ 恒不同步）
  {
    const { raw, sc } = mk()
    lib.syncScriptValues(sc, raw, {})
    raw[2].visible.value = true; raw[2].alpha.value = 0.9; raw[0].alpha.value = 0.4
    const n = lib.syncScriptValues(sc, raw, {})
    ok(sc.layers[2].visible === true && Math.abs(sc.layers[2].alpha - 0.9) < 1e-6, 'T5b visible false→true / alpha 0.25→0.9 同步进层', JSON.stringify(sc.layers[2]))
    ok(Math.abs(sc.layers[0].alpha - 0.4) < 1e-6, 'T5b alpha 1→0.4 同步进层', 'alpha=' + sc.layers[0].alpha)
    ok(n === 3, 'T5b 变化处数 = 3', 'n=' + n)
    const again = lib.syncScriptValues(sc, raw, {})
    ok(again === 0, 'T5b 幂等：再同步一次 0 处', 'again=' + again)
  }
  // T5c alpha 非法值丢弃；skip 集合让位给属性动画
  {
    const { raw, sc } = mk()
    lib.syncScriptValues(sc, raw, {})
    ok(sc.layers[3].alpha === 1, 'T5c alpha="abc" ⇒ 保持既有值（不写 NaN）', 'alpha=' + sc.layers[3].alpha)
    const skip = new Set([3])
    raw[2].alpha.value = 0.1
    const n = lib.syncScriptValues(sc, raw, { skip })
    ok(Math.abs(sc.layers[2].alpha - 0.25) < 1e-6 && n === 0, 'T5c skip 集合里的层不写（让位给属性动画）', 'alpha=' + sc.layers[2].alpha + ' n=' + n)
  }
  // T5d 载体 scale/angles（P-242 起默认包含）：按"首帧基线"的**比值/差**写，首帧逐位不变
  {
    // 父链已把 scale 合成 0.5（layer 值）而作者 raw 是 2 ⇒ 首帧基线 = {layer:[0.5..], raw:[2..]}，
    //   脚本把 raw 改成 4 ⇒ 层 scale 应为 0.5×(4/2)=1.0（而不是直接写 4）。
    const raw = [{ id: 9, name: 'e', scale: { script: 's', value: '2.00000 2.00000 2.00000' }, angles: { script: 'a', value: '0 0 10' } }]
    const sc = { layers: [{ id: 9, name: 'e', visible: true, alpha: 1, scale: [0.5, 0.5, 0.5], angles: [0, 0, 3.14159] }] }
    const n0 = lib.syncScriptValues(sc, raw, {})
    ok(n0 === 0 && Math.abs(sc.layers[0].scale[0] - 0.5) < 1e-6, 'T5d 首帧基线：脚本值 == 作者值 ⇒ 层 scale 逐位不变（零回归）', 'n=' + n0 + ' scale=' + sc.layers[0].scale[0])
    raw[0].scale.value = '4.00000 2.00000 2.00000'
    raw[0].angles.value = '0 0 20'
    const n1 = lib.syncScriptValues(sc, raw, {})
    ok(Math.abs(sc.layers[0].scale[0] - 1.0) < 1e-6 && Math.abs(sc.layers[0].scale[1] - 0.5) < 1e-6,
      'T5d scale 用**比值**（0.5×(4/2)=1.0；未变轴保持 0.5）⇒ 父链合成不被覆盖', JSON.stringify(sc.layers[0].scale))
    ok(Math.abs(sc.layers[0].angles[2] - (3.14159 + 10)) < 1e-4,
      'T5d angles 用**差**（父链 π + (20−10)）⇒ 父链求和不被覆盖', 'angles[2]=' + sc.layers[0].angles[2])
    ok(n1 === 2, 'T5d 变化处数 = 2（scale 与 angles 各 1）', 'n=' + n1)
    const onlyVisible = lib.syncScriptValues(sc, raw, { carriers: ['visible'] })
    ok(onlyVisible === 0, 'T5d 显式 carriers 可把载体缩回（回退面）', 'n=' + onlyVisible)
  }
  // T5e 接线：demo.html 有开关与调用点，README 主表登记
  {
    const demo = fs.readFileSync(new URL('../demo.html', import.meta.url), 'utf8')
    const readme = fs.readFileSync(new URL('../docs/README-DIAGNOSTICS.md', import.meta.url), 'utf8')
    ok(/SCRIPT_SYNC_MODE/.test(demo) && /syncScriptValues\(scene, scriptRawObjects/.test(demo), 'T5e demo.html 有 SCRIPT_SYNC_MODE 与 syncScriptValues 调用点')
    ok(/\|\s*`scriptsync`\s*\|/.test(readme), 'T5e README-DIAGNOSTICS 主表登记 scriptsync')
  }
}

console.log(`\n[T6] P-239 压缩 import 形态（\`import*as X from'WEMath'\`）必须能编译并驱动载体`)
{
  const { applySceneScripts, createScriptCache } = await import(new URL('../elysia/scene-scripts.js', import.meta.url).href)
  const run = (src, frames = 5) => {
    const scene = { objects: [{ id: 1, name: 'alphaCarrier', alpha: { script: src, value: 1 } }] }
    const cache = createScriptCache()
    for (let f = 0; f < frames; f++) applySceneScripts(scene, f * 0.25, { scriptCache: cache, renderObjects: scene.objects, shared: {}, canvasSize: { x: 6080, y: 3420 } })
    const e = [...cache.map.values()][0] || {}
    return { value: scene.objects[0].alpha.value, exported: Object.keys(e.exports || {}), error: e.error || null }
  }
  // 压缩形态（实测 0923/2887099508 的 11 个 alpha 载体全是这个写法）：旧正则漏替换 ⇒ 整条脚本 parse error
  const minified = run("var _0x5a8a=['x'];(function(){})();import*as _0x1b8735 from'WEMath';export function update(t){ return _0x1b8735.mix(t, 0, 0.08) }")
  ok('T6 压缩 import ⇒ update 被导出且无 parse error', minified.exported.includes('update') && minified.error === null, JSON.stringify(minified))
  ok('T6 压缩 import ⇒ 载体真的被驱动（0.92^5≈0.659）', Math.abs(minified.value - 0.6591) < 0.005, 'value=' + minified.value)
  // 带空格的规范形态（回归面：改动前就能用的写法必须一字不变）
  const spaced = run("import * as WEMath from 'WEMath';\nexport function update(t){ return WEMath.mix(t, 0, 0.08) }")
  ok('T6 规范 import 形态不回归（同样 0.659）', Math.abs(spaced.value - 0.6591) < 0.005 && spaced.error === null, JSON.stringify(spaced))
  // 单行无分号 + 双引号模块名（作者压缩器的另一种产出）
  const dq = run('import*as W from "WEMath"\nexport function update(t){ return W.mix(t, 0, 0.08) }')
  ok('T6 双引号 + 无分号形态同样可用', Math.abs(dq.value - 0.6591) < 0.005 && dq.error === null, JSON.stringify(dq))
}

console.log(`\n[T7] P-243 脚本 input 指针（syncScriptInput）：就地改、缺项不动、无参零副作用`)
{
  const { syncScriptInput } = await import(new URL('../elysia/scene-scripts.js', import.meta.url).href)
  const input = { cursorWorldPosition: { x: 1920, y: 1080, z: 0 }, cursorDelta: { x: 0, y: 0, z: 0 }, cursorScreenPosition: { x: 640, y: 360 }, cursorLeftDown: false }
  const ref = input.cursorWorldPosition
  const n1 = syncScriptInput(input, { x: 900, y: 500 }, { dx: 5, dy: -7 })
  ok(n1 > 0 && input.cursorWorldPosition.x === 900 && input.cursorWorldPosition.y === 500,
    'T7 指针就地写入 cursorWorldPosition（x/y 生效）', JSON.stringify(input.cursorWorldPosition))
  ok(input.cursorWorldPosition === ref, 'T7 **同一个对象**（脚本在 update 里持有的引用仍有效）', 'same=' + (input.cursorWorldPosition === ref))
  ok(input.cursorDelta.x === 5 && input.cursorDelta.y === -7, 'T7 cursorDelta 按传入 dx/dy 写', JSON.stringify(input.cursorDelta))
  const n2 = syncScriptInput(input, null)
  const n3 = syncScriptInput(null, { x: 1, y: 1 })
  ok(n2 === 0 && n3 === 0, 'T7 无指针/无 input ⇒ 0 副作用', 'n2=' + n2 + ' n3=' + n3)
  const before = JSON.stringify(input.cursorScreenPosition)
  syncScriptInput(input, { x: 901, y: 501 })
  ok(JSON.stringify(input.cursorScreenPosition) === before, 'T7 未给 screen ⇒ cursorScreenPosition 保持原值（零回归）', before)
}

console.log(`\nscript-origin-sync-test：${pass} pass / ${fail} fail`)
if (fail > 0) process.exit(1)
