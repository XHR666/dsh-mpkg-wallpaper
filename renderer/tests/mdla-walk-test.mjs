// mdla-walk-test.mjs — N4（第2项 成因3）MDLA 记录游走修正 + fps 解析单测
// 复现：node mdla-walk-test.mjs   （需要语料包 3544152633；缺包打印 SKIP 退出 0）
//
// 问题（docs/VIDEO-AND-TWITCH-RESEARCH.md §2.2）：`_parseMdl` 假定"下一条动画记录紧跟在
//   segBytes*boneCount 之后"，但每条记录段数据之后还有**一段长度不定的尾部**（girl 实测 131 字节），
//   于是 animations[1..3] 的 id 读成 0、name 读成乱码；文件真实值 id=71/73/94、
//   name="Animation 2/3/4"（头在 132193/174961/259849）。`an.fps` 也从未解析（硬编码 30）。
//   本测试同时锁死"帧数据本身不变"（新旧游走的 segs 必须逐位相同）——避免修 id 时踩坏采样。
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import path from 'node:path'
import * as lib from '../core/we-scene-bundle.js'
import { installPuppet } from '../elysia/we-renderer/puppet.js'
import { Buffer as MpwBuffer } from '../elysia/buffer.js'

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}

const SCENE_ID = '3544152633'
const ROOT = process.env.MPW_ROOT || WS
const SCENE_ROOT = process.env.MPW_SCENE_ROOT || path.join(ROOT, 'allwallpaper', 'dd')
const PKG = path.join(SCENE_ROOT, SCENE_ID, 'scene.pkg')
if (!fs.existsSync(PKG)) { console.log('SKIP mdla-walk-test：语料包不存在 ' + PKG); process.exit(0) }

const H = {}
installPuppet(H)
const raw = new Uint8Array(fs.readFileSync(PKG))
const pkg = lib.parsePkg(raw)
const rd = (b) => new TextDecoder().decode(b).replace(/^\uFEFF/, '')
const sceneJson = JSON.parse(rd(lib.getEntry(pkg, 'scene.json')))
const girl = sceneJson.objects.find((o) => o && o.name === 'girl')
const mj = JSON.parse(rd(lib.getEntry(pkg, girl.image)))
const u8 = lib.getEntry(pkg, mj.puppet)
const buf = new MpwBuffer(u8.buffer, u8.byteOffset, u8.byteLength)
const mesh = H._parseMdl(buf)
const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)

// 旧游走（修复前实现逐字复刻）：段尾即下一条头 + `f0 41` 扫描重新同步
function legacyWalk() {
  const mdla = buf.indexOf('MDLA')
  let p = mdla + 9 + 4
  const animCount = dv.getUint32(p, true); p += 4
  const out = []
  for (let a = 0; a < animCount && p + 12 < buf.length; a++) {
    const id = dv.getInt32(p, true); p += 8
    const ne = buf.indexOf(0, p); if (ne < 0) break
    const name = buf.toString('utf8', p, ne); p = ne + 1
    const le = buf.indexOf(0, p); if (le < 0) break
    p = le + 1
    while (p + 1 < buf.length && !(buf[p] === 0xf0 && buf[p + 1] === 0x41)) p++
    p += 2
    const frameCount = dv.getUint16(p, true); p += 2
    p += 2; p += 4
    const boneCount = dv.getUint32(p, true); p += 4
    p += 4
    const segBytes = dv.getUint32(p, true); p += 4
    const segs = []
    for (let b = 0; b < boneCount && p + (b + 1) * segBytes <= buf.length; b++) segs.push(p + b * segBytes)
    out.push({ id, name, frameCount, boneCount, segBytes, segs })
    p += segBytes * boneCount
  }
  return out
}

console.log('[N4] MDLA 记录游走 + fps（真实包 ' + SCENE_ID + ' / ' + mj.puppet + '）')

console.log('[T1] 新解析：id / name / fps / 帧数据')
{
  const want = [
    { id: 65, name: 'Animation 1', fc: 180, sb: 6516, seg0: 47354, off: 47305 },
    { id: 71, name: 'Animation 2', fc: 90, sb: 3276, seg0: 132242, off: 132193 },
    { id: 73, name: 'Animation 3', fc: 180, sb: 6516, seg0: 175010, off: 174961 },
    { id: 94, name: 'Animation 4', fc: 180, sb: 6516, seg0: 259898, off: 259849 },
  ]
  check('T1a 四条动画', mesh.animations.length === 4, 'n=' + mesh.animations.length)
  for (let i = 0; i < want.length; i++) {
    const a = mesh.animations[i] || {}
    const w = want[i]
    check('T1b' + i + ' anim' + i + ' id=' + w.id + ' name="' + w.name + '" fc=' + w.fc + ' segBytes=' + w.sb,
      a.id === w.id && a.name === w.name && a.frameCount === w.fc && a.segBytes === w.sb && a.segs[0] === w.seg0,
      'got id=' + a.id + ' name="' + a.name + '" fc=' + a.frameCount + ' sb=' + a.segBytes + ' seg0=' + (a.segs || [])[0])
  }
  check('T1c fps 已解析（4 条全 30）', mesh.animations.every((a) => a.fps === 30), 'fps=' + mesh.animations.map((a) => a.fps).join(','))
  check('T1d loop 令牌解析（"loop"）', mesh.animations.every((a) => a.loop === 'loop'), mesh.animations.map((a) => a.loop).join(','))
  check('T1e boneCount/segs 长度一致（13 骨）', mesh.animations.every((a) => a.boneCount === 13 && a.segs.length === 13))
}

console.log('[T2] 旧游走的缺陷（反证：旧实现读到的 id/name）')
{
  const old = legacyWalk()
  check('T2a 旧实现 anim[1..3] id 全是 0', old.slice(1).every((a) => a.id === 0), 'ids=' + old.map((a) => a.id).join(','))
  check('T2b 旧实现 anim[1..3] name 是乱码（含控制/非 ASCII 字节）',
    old.slice(1).every((a) => /[^\x20-\x7e]/.test(a.name) || a.name.length < 2), old.slice(1).map((a) => JSON.stringify(a.name)).join(' '))
  check('T2c 旧实现 anim0 的 id/name 正确（顺序游走只对第 0 条成立）', old[0].id === 65 && old[0].name === 'Animation 1')
  // 关键回归不变量：新旧游走的**帧数据**必须逐位相同（只有 id/name/fps 是新增信息）
  const same = mesh.animations.length === old.length && mesh.animations.every((a, i) =>
    a.frameCount === old[i].frameCount && a.boneCount === old[i].boneCount && a.segBytes === old[i].segBytes && a.segs.join(',') === old[i].segs.join(','))
  check('T2d 新旧游走帧数据逐位一致（segs/frameCount/segBytes 全同 → 采样不受影响）', same,
    mesh.animations.map((a, i) => a.segs[0] + '==' + (old[i] || {}).segs?.[0]).join(' '))
}

console.log('[T3] id 匹配恢复官方语义（demo/elysia 的 animationlayers[].animation）')
{
  const al = (sceneJson.objects.find((o) => o.name === 'girl').animationlayers || [])
  const ids = al.map((x) => x.animation)
  check('T3a 声明 id = 65/71/73/94（包内原文）', JSON.stringify(ids) === '[65,71,73,94]', JSON.stringify(ids))
  const found = al.map((x) => mesh.animations.findIndex((m) => m.id === x.animation))
  check('T3b 每条声明 id 都能直接命中动画（不再需要数字后缀/索引回退）', JSON.stringify(found) === '[0,1,2,3]', JSON.stringify(found))
  // id 命中与"数字后缀回退"在正确解析后必须给出同一索引（否则 id 修复会改变层选择）
  const bySuffix = al.map((x) => { const m = String(x.name || '').match(/(\d+)/); return m ? parseInt(m[1], 10) - 1 : -1 })
  check('T3c id 命中 == 名字数字后缀回退（层选择不变）', JSON.stringify(found) === JSON.stringify(bySuffix),
    'id=' + JSON.stringify(found) + ' suffix=' + JSON.stringify(bySuffix))
}

console.log('[T4] 采样仍可区分不同动画（id 修好后选到的是真动画）')
{
  const nb = mesh.bones.length, bones = mesh.bones
  const p0 = H._sampleAnimRT(mesh, mesh.animations[0], 10, nb, bones)
  const p1 = H._sampleAnimRT(mesh, mesh.animations[1], 10, nb, bones)
  const p3 = H._sampleAnimRT(mesh, mesh.animations[3], 10, nb, bones)
  const d = (a, b) => a.reduce((s, r, i) => s + Math.abs(r.tx - b[i].tx) + Math.abs(r.ty - b[i].ty), 0)
  check('T4a anim0/anim1/anim3 帧 10 姿势互不相同', d(p0, p1) > 1 && d(p0, p3) > 1 && d(p1, p3) > 1,
    'd01=' + d(p0, p1).toFixed(1) + ' d03=' + d(p0, p3).toFixed(1) + ' d13=' + d(p1, p3).toFixed(1))
  const inf = mesh.animations.every((a) => {
    const rt = H._sampleAnimRT(mesh, a, 0, nb, bones)
    return rt.every((r) => isFinite(r.tx) && isFinite(r.ty) && isFinite(r.angle))
  })
  check('T4b 每条动画帧 0 姿势有限（segs 偏移没跑偏）', inf)
}

console.log('[T5] demo.html 蒙皮准备块真跑（P-59 A1：裸 frameCount → ReferenceError → skinLayers 恒空 = 全语料 meshDraws 0）')
{
  // 做法：从 demo.html 抽出**真实**的蒙皮准备块（`const skinLayers = []` → `if (skinLayers.length) logf('① 蒙皮层:`），
  //   用真包 scene 在 node 里跑一遍；再把唯一那行改回旧写法做**变异验证**（旧写法必须 0 层 + 报错日志）。
  //   这块代码就是设备上报里 meshDraws/skins/layers[].skin 三个字段的来源（skinLayers → __skinReady → onMeshLayer），
  //   所以"skinLayers 非空"等价于"meshDraws > 0"。
  const HTML = fs.readFileSync(new URL('../demo.html', import.meta.url), 'utf8')
  const i0 = HTML.indexOf('const skinLayers = []')
  const i1 = HTML.indexOf("if (skinLayers.length) logf('① 蒙皮层:")
  check('T5a 从 demo.html 提取到蒙皮准备块', i0 > 0 && i1 > i0, 'offset=' + i0 + ' len=' + (i1 - i0))
  const code = HTML.slice(i0, i1) + '\n}'   // 补 if (skinEnabled) { 的收尾大括号
  // ①(P-111 2026-09-17 修回归) 蒙皮块引用的**外层符号**必须与 demo.html 同源注入。
  //   P-110 起块内多了一行 `lib.bindWorldChain(mesh.bones, { legacy: BIND_ORDER_LEGACY })`，
  //   而 `BIND_ORDER_LEGACY` 是 demo.html 顶层 const（`?bindorder=legacy` 的解析点，与 `?att=legacy` 同形）。
  //   旧 harness 的 `new Function(...)` 只传 lib/pkg/rd/puppetHelper/MpwBuffer/scene/logf/location/window 九个参数
  //   ⇒ 块内裸引用 `BIND_ORDER_LEGACY` 立刻 ReferenceError，被块自己的 catch 吞成"蒙皮准备失败"日志
  //   ⇒ skinLayers 恒空、T5c/T5e/T5g/T5h 集体变红（**真机不红**：同一顶层作用域里 const 就在上方）。
  //   修法：**从 demo.html 原文里抽出那行声明**（不复制表达式、不写死布尔），注入到被 eval 的块前面 ——
  //   与浏览器里的作用域形状一致；声明被改名/删除时 T5a2 直接变红（分辨力），不会静默退化成"参数缺失"。
  const declLine = (HTML.match(/^[ \t]*const BIND_ORDER_LEGACY = .*$/m) || [''])[0].trim()
  check('T5a2 demo.html 顶层声明了蒙皮块引用的 `BIND_ORDER_LEGACY`，且本 harness 抽到同一行原文',
    /^const BIND_ORDER_LEGACY = .*URLSearchParams\(location\.search\)\.get\('bindorder'\) === 'legacy'$/.test(declLine),
    declLine || '(未抽到)')
  check('T5b 蒙皮块用的是 anim.frameCount 兜底（不再是裸 frameCount）',
    code.includes('frameCount: (anim && anim.frameCount) || rawLen') && !/\bframeCount\s*,/.test(code),
    (code.match(/frameCount[^,;]{0,40}/g) || []).slice(0, 3).join(' | '))
  const runSkin = (src, id) => {
    const p2 = id === SCENE_ID ? pkg : lib.parsePkg(new Uint8Array(fs.readFileSync(path.join(SCENE_ROOT, id, 'scene.pkg'))))
    const entry2 = (n) => { const e = lib.getEntry(p2, n); return e ? new Uint8Array(e) : null }
    const scene2 = lib.parseScene(JSON.parse(rd(entry2('scene.json'))), null, { attachCtx: { readEntry: entry2, time: 0 } })
    const logs = [], win = {}
    const fn = new Function('lib', 'pkg', 'rd', 'puppetHelper', 'MpwBuffer', 'scene', 'logf', 'location', 'window',
      '"use strict";\n' + declLine + '\n' + src + '\n; return { n: skinLayers.length, fc: skinLayers.map((l) => l.__skin && l.__skin.frameCount), errs: window.__mpwSkinErrs || [] }')
    return Object.assign(fn(lib, p2, rd, H, MpwBuffer, scene2, (m) => logs.push(String(m)), { search: '' }, win), { logs })
  }
  const fixed = runSkin(code, SCENE_ID)
  check('T5c 修复后：蒙皮层层数 > 0（Girl and cat 实测 1 层 girl）', fixed.n > 0, 'skins=' + fixed.n + ' frameCount=' + JSON.stringify(fixed.fc))
  check('T5d 每层 __skin.frameCount 是正整数（相位周期可用）', fixed.fc.length === fixed.n && fixed.fc.every((v) => Number.isFinite(v) && v > 0), JSON.stringify(fixed.fc))
  check('T5e 修复后无蒙皮错误日志', fixed.logs.every((m) => m.indexOf('蒙皮准备失败') < 0), JSON.stringify(fixed.logs.slice(0, 2)))
  // 变异验证：把修复行改回旧写法（裸 frameCount）→ 必须复现"0 层 + 报错"
  const mutated = code.replace('frameCount: (anim && anim.frameCount) || rawLen', 'frameCount')
  const broken = runSkin(mutated, SCENE_ID)
  check('T5f 变异（裸 frameCount）→ skinLayers 恒空（复现设备上报 meshDraws=0）', broken.n === 0, 'skins=' + broken.n)
  check('T5g 变异时不再静默：catch 报出 frameCount is not defined', broken.logs.some((m) => m.indexOf('蒙皮准备失败') >= 0 && m.indexOf('frameCount') >= 0),
    JSON.stringify(broken.logs.filter((m) => m.indexOf('蒙皮准备失败') >= 0).slice(0, 1)))
  // 第二个真包（凯尔希 3719111841，5 个蒙皮层）：有包才跑
  const PKG2 = path.join(SCENE_ROOT, '3719111841', 'scene.pkg')
  if (fs.existsSync(PKG2)) {
    const k = runSkin(code, '3719111841')
    check('T5h 凯尔希 3719111841：蒙皮层 5 层（设备上报 25→0 的那 5 层）', k.n === 5, 'skins=' + k.n + ' fc=' + JSON.stringify(k.fc))
  } else console.log('  SKIP T5h（无 3719111841 语料包）')
}

console.log('\n' + (fail === 0 ? '全部通过' : '存在失败') + `：${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
