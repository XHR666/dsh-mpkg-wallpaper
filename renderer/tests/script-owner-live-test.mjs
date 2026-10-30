// script-owner-live-test.mjs — P-60 脚本宿主 thisLayer 错绑回归测试
//
// 事故（用户第 1 项："时间/日期显示像是你做的，不像壁纸自己的"，并怀疑坐标不对）：
//   真机 3554161528（hina）时钟层 id=398 的 `origin` 脚本把**歌曲名层 id=1592 的 origin**
//   写进了自己——`reports/r1789397997210.json` 的 layers[] 里 id 398 与 1592 的 rawOrigin
//   逐位相同（2833,1379），而包内 scene.json 里 398 的 authored origin 是 (1195.38159,1337.07593)。
//   代码注释里把这条记为"parsed origin 与期望 Δ1638 且恰等于另一层"的疑案（demo.html:2886）。
//
//   根因（Node 里用真实脚本宿主复现 + 探针定案）：
//     `elysia/scene-scripts.js` 的 makeOwnerRef().layerRef()/objectRef() 把
//     `const obj = ref.current` 写在**工厂函数体开头**，而 makeLayer()/makeObject() 在
//     compileScript 的 context 字面量里**只调用一次**；编译结果又按脚本源缓存（cache.get(src)）。
//     → thisLayer/thisObject 捕获的是"编译那一刻"的 ref.current = **上一个脚本节点 setOwner
//       留下的对象**。每个"某层第一个被编译的脚本属性"都拿错 owner；同一层的第 2/3 个属性
//       因为编译时 ref.current 恰好已是本层而"看起来正常"——所以症状只在首属性上出现。
//
// 本测试不依赖任何真实包（合成场景即可复现），并额外在真包存在时校验 398 的 authored origin 不被改写。
//
// 覆盖：
//   T1 首属性绑定：B 层第一个脚本属性必须看到 B 自己（旧实现看到 A）
//   T2 三属性一致：B 的 origin/scale/text 三个属性都看到 B（漏掉"只有首属性错"的假修复）
//   T3 写回目标：B 的脚本写 origin/visible 只改 B，绝不改 A（旧实现污染 A）
//   T4 多帧缓存命中：第 2/3 帧（cache hit 路径）仍然是 B
//   T5 真包回归（有包才跑）：3554161528 跑完脚本后 id 398 origin == authored
//
// 用法: node script-owner-live-test.mjs
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import { applySceneScripts, createScriptCache } from '../elysia/scene-scripts.js'
// ①(去个人化 2026-09-16 / 敏感信息加固 2026-09-19) 工作区根：环境变量优先；兜底默认由 tests/_root.mjs 按**脚本自身位置**推导（不再写作者本机绝对路径）。
const MPW_WS = process.env.MPW_ROOT || WS

let pass = 0, fail = 0
const ok = (cond, name, detail = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  (' + detail + ')' : '')) }
  else { fail++; console.error('  ✗ ' + name + (detail ? '  (' + detail + ')' : '')) }
}

// ═══ 合成场景：A 先于 B 被收集（复刻 1592 在 398 之前）═══
const SRC_SEEN = `'use strict';
export function update(value) {
  shared.__seen = shared.__seen || [];
  shared.__seen.push(thisLayer.id + '|' + thisObject.id);
  return value;
}`
const SRC_WRITE = `'use strict';
export function update(value) {
  // ①字符串与 Vec3 两种写法都要落到 (4242,2424)：字符串按 "x y z" 解析
  //   （旧 setter 用 v[0]/v[1] 索引字符串 → 写成 "4 2 4"，静默写坏坐标）
  thisLayer.origin = (value === 'vec') ? new Vec3(4242, 2424, 0) : '4242 2424 0';
  thisLayer.visible = false;
  return value;
}`
const mkScene = () => ({
  objects: [
    // A：id 1592，先出现，带一个脚本属性（旧实现会把它变成 B 的 owner）
    { id: 1592, name: '', origin: '2833.34644 1378.56702 0.00000', text: { script: SRC_SEEN, value: 'song' } },
    // B：id 398，名称与 A 相同（都是空串），三个脚本属性
    {
      id: 398, name: '', size: '410 167 0',
      origin: { script: SRC_SEEN, value: '1195.38159 1337.07593 0.00000' },
      scale: { script: SRC_SEEN, value: '1.00000 1.00000 1.00000' },
      text: { script: SRC_SEEN, value: '00:00' },
    },
  ],
})
const run = (scene, frames = 1, extra = {}) => {
  const cache = createScriptCache()
  cache.shared.__seen = []
  for (let i = 0; i < frames; i++) {
    applySceneScripts(scene, i / 30, { canvasSize: [3840, 2160], userProps: {}, scriptCache: cache, renderObjects: scene.objects, runtime: i / 30, frametime: 1 / 30, ...extra })
  }
  return { seen: cache.shared.__seen, scene }
}
const originOf = (scene, id) => {
  const o = scene.objects.find((x) => x.id === id)
  const v = o.origin && typeof o.origin === 'object' ? o.origin.value : o.origin
  return String(v).trim().split(/\s+/).slice(0, 2).map(Number)
}
const near = (a, b, eps = 1e-4) => Math.abs(a - b) <= eps

// ═══ T1/T2 首属性与三属性绑定 ═══
{
  const { seen } = run(mkScene())
  // A 的 text + B 的 origin/scale/text = 4 次
  const bSeen = seen.filter((s) => s.endsWith('|398')).length
  const wrongOwner = seen.filter((s) => { const [l, o] = s.split('|'); return l !== o })
  ok(seen.length === 4, 'T1a 四个脚本属性各跑一次', 'seen=' + JSON.stringify(seen))
  ok(bSeen === 3, 'T1b B 层三个属性都看到 thisLayer.id=398', 'B 命中 ' + bSeen + '/3')
  ok(wrongOwner.length === 0, 'T2 thisLayer 与 thisObject 始终等于所属层（无跨层错绑）', wrongOwner.length ? '错绑: ' + wrongOwner.join(',') : '4/4 正确')
}

// ═══ T3 写回目标（旧实现会把 B 的首属性写进 A）═══
{
  const scene = {
    objects: [
      { id: 1592, name: '', origin: '2833.34644 1378.56702 0.00000', text: { script: SRC_SEEN, value: 'song' } },
      {
        id: 398, name: '',
        origin: { script: SRC_WRITE, value: '1195.38159 1337.07593 0.00000' },
        scale: { script: SRC_SEEN, value: '1.00000 1.00000 1.00000' },
      },
    ],
  }
  run(scene, 1, { userProps: {} })
  const a = originOf(scene, 1592), b = originOf(scene, 398)
  ok(near(a[0], 2833.34644) && near(a[1], 1378.56702), 'T3a A 层 origin 未被 B 的脚本污染', 'A=' + a.join(','))
  ok(near(b[0], 4242) && near(b[1], 2424), 'T3b B 层 origin 被自己的脚本正确改写（字符串 "x y z"）', 'B=' + b.join(','))
  ok(scene.objects.find((x) => x.id === 1592).visible !== false, 'T3c A 层 visible 未被 B 的脚本改成 false')
  ok(scene.objects.find((x) => x.id === 398).visible === false, 'T3d B 层 visible=false 生效')
}

// ═══ T4 多帧（cache hit）仍然绑定正确 ═══
{
  const { seen } = run(mkScene(), 3)
  const bSeen = seen.filter((s) => s.endsWith('|398')).length
  const wrong = seen.filter((s) => { const [l, o] = s.split('|'); return l !== o })
  ok(bSeen === 9, 'T4a 三帧 × 三属性 = 9 次都看到 398', 'B 命中 ' + bSeen + '/9')
  ok(wrong.length === 0, 'T4b 三帧内无错绑', wrong.length ? wrong.join(',') : '12/12 正确')
}

// ═══ T5 真包回归（3554161528 id398 时钟层 origin 不得被 1592 改写）═══
const PKG = `${MPW_WS}/allwallpaper/dd/3554161528/scene.pkg`
if (!fs.existsSync(PKG)) {
  console.log('  ~ T5 SKIP script-owner-live（缺真包 ' + PKG + '）')
} else {
  const lib = await import('../core/we-scene-bundle.js')
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(PKG)))
  const sceneJson = JSON.parse(new TextDecoder().decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, ''))
  const projectJson = JSON.parse(fs.readFileSync(`${MPW_WS}/allwallpaper/dd/3554161528/project.json`, 'utf8'))
  const userProps = {}
  for (const [k, v] of Object.entries(projectJson.general.properties)) userProps[k] = v && typeof v === 'object' && 'value' in v ? v.value : v
  const authored = (() => { const o = sceneJson.objects.find((x) => x.id === 398); return String(o.origin.value).trim().split(/\s+/).slice(0, 2).map(Number) })()
  const scene = JSON.parse(JSON.stringify(sceneJson))
  const cache = createScriptCache()
  const errs = []
  applySceneScripts(scene, 0, { canvasSize: [3840, 2160], userProps, scriptCache: cache, renderObjects: scene.objects, runtime: 0, frametime: 1 / 60, onError: (p, e) => errs.push(p + ': ' + e.message) })
  const after = originOf(scene, 398)
  ok(near(after[0], authored[0]) && near(after[1], authored[1]),
    'T5 真包 3554161528 时钟层 id398 origin 跑完脚本仍为 authored',
    authored.join(',') + ' → ' + after.join(','))
  ok(errs.length === 0, 'T5b 真包脚本无报错', errs.slice(0, 3).join(' / ') || '0 错')
}

console.log('\n' + (fail === 0 ? '✓ script-owner-live 全部通过' : '✗ script-owner-live 失败') + '：' + pass + ' 通过 / ' + fail + ' 失败')
process.exit(fail === 0 ? 0 : 1)
