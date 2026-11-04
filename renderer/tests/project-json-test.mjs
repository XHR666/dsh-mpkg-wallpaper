#!/usr/bin/env node
// project-json-test.mjs — P-85 官方 project.json 查找链（core/scene-project-json.mjs）+ 服务端路由契约
// 复现：node project-json-test.mjs
//
// ── 为什么需要这个测试 / 证据是什么 ──────────────────────────────────────────
// WE 工坊布局 = **一个壁纸一个目录**，目录里三件套：scene.pkg + project.json + preview.gif。
// project.json **不是** scene.pkg 里的条目（getEntry(pkg,'project.json') 恒 null，语料 6/6 实测），
// 它是**同级文件**。此前服务端 /project/<id> 只读 <MPW_SCENE_ROOT>/<id>/project.json，这份文件
// 不在的部署恒 404 ⇒ demo 的 propsSchema=null，连锁三件事：
//   ① 属性面板空白；② visible:{user:{condition:…}} 的条件门控全走"属性表缺失→按可见"的灾难
//   规避分支 ⇒ 砂狼白子 3327063360 的 4 个 Clock 变体（id 394/639/8183/7186）**同时可见**
//   （正确行为只有 1 个：官方表 b1 默认 "4"，只有 condition=="4" 的 639 该显示）；③ 用户属性
//   绑定全回落作者默认值。而**用户本机 Steam 工坊目录**（…/steamapps/workshop/content/431960/<id>/）
//   里三样俱全（实测 6/6）—— resolver 就是把这一档接进来。
//
// 断言分组：
//   A 查找顺序（临时目录造 5 档同名文件：显式目录 → env → 语料目录 → 工坊目录 → allwallpaper 扁平；
//     命中最高优先级；逐个删掉验证逐档降级；坏 JSON 不致命、继续往下找）
//   B 真包 6 个（3554161528/3544152633/3327063360/3719111841/3326873240/3660962877）：
//     readProjectProperties 非空；命中档位合法；把语料目录档挖掉后必须命中 we-workshop
//     （⚠ 本机 allwallpaper/dd/<id>/ 当前恰好也带 project.json（与工坊副本逐字节一致，cmp 实测）
//       ⇒ 默认命中 scene-root；"dd 下没有"这一前提在本机当前状态不成立，故工坊档用场景隔离单独钉死）
//   C 条件门控真值（用户第 3 项的核心不变量）：白子官方 schema 默认值下 4 个 Clock 变体**恰好 1 个**
//     可见 = condition 与 b1 默认值相等的那一个；"秒"（1192，绑 newproperty49）可见；
//     属性表缺失时 4 个全可见（= 修复前 bug 形态，作对照钉进断言）
//   D hina 3554161528：官方 schema 非空，且 scene.json 全部 {user:…} 绑定引用的属性名都在 schema 里
//   E 优雅降级：不存在的 id → null 且不抛异常
//   F 服务端路由契约（子进程起 server/we-scene-demo-server.mjs，随机空闲端口，try/finally 必杀）：
//     /project/<真包> 200 + general.properties + 响应头 x-project-source；不存在的 id 404
//
// bundle 侧消费的导出（core/we-scene-bundle.js 实际导出名，均已核对）：
//   propsDefaults(schema) / resolveUserBinding(bind, props) / evalVisibleWithProps(raw, props, gated)
//   / gatedOffNames(schema, props)（:1415/:1569/:1591/:1547）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import * as lib from '../core/we-scene-bundle.js'
import { projectJsonCandidates, projectJsonProbe, readProjectJson, readProjectProperties, findWorkshopDir } from '../core/scene-project-json.mjs'   // ①(2026-09-16) 服务端依赖留仓库根
import { ROOT, WS } from './_root.mjs'   // ①(2026-09-16 目录整理) 仓库根（本脚本已移入 tests/）

const HERE = ROOT
let pass = 0, fail = 0
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}
const rd = (b) => new TextDecoder().decode(b).replace(/^\uFEFF/, '')

// ── 临时根（A 组用；结束必清理）─────────────────────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-projtest-'))
const cleanup = () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} }

console.log('[A] 查找顺序：5 档同名文件 → 命中最高优先级 → 逐档删除逐档降级 → 坏 JSON 不致命')
{
  const ID = '4319609999'
  const dExplicit = path.join(TMP, 'explicit')
  const dEnv = path.join(TMP, 'envdir')
  const dScene = path.join(TMP, 'scenes')
  const dWs = path.join(TMP, 'workshop')
  const dRoot = path.join(TMP, 'root')                      // allwallpaper-flat = <root>/allwallpaper/<id>/
  for (const d of [dExplicit, dEnv, dScene, dWs, path.join(dRoot, 'allwallpaper', ID)]) fs.mkdirSync(d, { recursive: true })
  const OPTS = { root: dRoot, dir: dExplicit, sceneRoot: dScene, workshopDir: dWs }
  // env 档（MPW_PROJECT_JSON_DIR）只能由进程环境提供：保存→钉住→finally 恢复，避免污染同进程后续断言
  const ENV_SAVED = process.env.MPW_PROJECT_JSON_DIR
  process.env.MPW_PROJECT_JSON_DIR = dEnv
  try {
    const tiers = [
      ['explicit-dir', path.join(dExplicit, ID, 'project.json')],
      ['env-MPW_PROJECT_JSON_DIR', path.join(dEnv, ID, 'project.json')],
      ['scene-root', path.join(dScene, ID, 'project.json')],
      ['we-workshop', path.join(dWs, ID, 'project.json')],
      ['allwallpaper-flat', path.join(dRoot, 'allwallpaper', ID, 'project.json')],
    ]
    const cands = projectJsonCandidates(ID, OPTS)
    const bySource = (s) => cands.filter((c) => c.source === s)
    /* ①(可移植性审计 PA-52 2026-09-24) 这里原来断言"候选**正好** 5 档且顺序逐字"——那是把实现的
       候选表当契约钉死（同一族自我循环，见 PA-37）。现在断言的是**顺序契约与可解释性**：
       显式档之间的相对顺序不得变；通用候选（库根自身/父目录/home…）允许增加。 */
    check('A1 显式档相对顺序 = 显式→env→语料→工坊（候选表允许增加通用档；只钉顺序不钉总数）',
      ['explicit-dir', 'env-MPW_PROJECT_JSON_DIR', 'scene-root', 'we-workshop'].every((s) => bySource(s).length >= 1) &&
      cands.findIndex((c) => c.source === 'explicit-dir') < cands.findIndex((c) => c.source === 'env-MPW_PROJECT_JSON_DIR') &&
      cands.findIndex((c) => c.source === 'env-MPW_PROJECT_JSON_DIR') < cands.findIndex((c) => c.source === 'scene-root') &&
      cands.findIndex((c) => c.source === 'scene-root') < cands.findIndex((c) => c.source === 'we-workshop'),
      JSON.stringify(cands.map((c) => c.source)))
    check('A1b 每条候选都带 source/from/why（"采用了哪条 / 谁给的 / 为什么"三个字段都要能如实回报）',
      cands.length > 0 && cands.every((c) => c.source && c.from && c.why),
      JSON.stringify(cands.find((c) => !(c.source && c.from && c.why)) || `n=${cands.length}`))
    check('A2 五档候选路径逐档指向各自目录（按 source 取第一条）',
      JSON.stringify(tiers.map(([src]) => { const c = bySource(src)[0]; return c ? c.path : null })) === JSON.stringify(tiers.map((t) => t[1])),
      JSON.stringify(cands.map((c) => c.source + '=' + c.path)))
    for (const [src, p] of tiers) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify({ __tier: src })) }
    let r = readProjectJson(ID, OPTS)
    check('A3 五档俱全 → 命中最高优先级（explicit-dir）', !!r && r.source === 'explicit-dir' && r.json.__tier === 'explicit-dir',
      r ? r.source + ' tier=' + r.json.__tier : 'null')
    const degrade = async () => { r = readProjectJson(ID, OPTS) }
    fs.unlinkSync(tiers[0][1]); await degrade()
    check('A4 删掉显式档 → 降到 env-MPW_PROJECT_JSON_DIR', !!r && r.source === 'env-MPW_PROJECT_JSON_DIR', r && r.source)
    fs.unlinkSync(tiers[1][1]); await degrade()
    check('A5 再删 env 档 → 降到 scene-root', !!r && r.source === 'scene-root', r && r.source)
    fs.unlinkSync(tiers[2][1]); await degrade()
    check('A6 再删语料档 → 降到 we-workshop（本次要接进来的那一档）', !!r && r.source === 'we-workshop', r && r.source)
    fs.unlinkSync(tiers[3][1]); await degrade()
    check('A7 再加工坊档 → 降到 allwallpaper-flat', !!r && r.source === 'allwallpaper-flat', r && r.source)
    fs.unlinkSync(tiers[4][1]); await degrade()
    check('A8 全删 → null（不抛）', r === null)
    fs.writeFileSync(tiers[0][1], '{ 这不是 JSON !!')            // 坏 JSON 放最高档
    fs.writeFileSync(tiers[1][1], JSON.stringify({ __tier: 'env-MPW_PROJECT_JSON_DIR' }))
    r = readProjectJson(ID, OPTS)
    check('A9 坏 JSON 不致命：跳过坏档继续往下找 → 命中 env 档', !!r && r.source === 'env-MPW_PROJECT_JSON_DIR', r && r.source)
    fs.writeFileSync(tiers[0][1], JSON.stringify({ general: { properties: { p1: { type: 'bool', value: true } } } }))
    const pr = readProjectProperties(ID, OPTS)
    check('A10 readProjectProperties 取 general.properties 且带 source',
      !!pr && pr.source === 'explicit-dir' && pr.properties && pr.properties.p1 && pr.properties.p1.value === true,
      pr && pr.source)
    /* ①(PA-52 2026-09-24) 通用候选三连：旧实现把 `<root>/allwallpaper/dd`（作者语料布局）当**默认值**，
       于是别人 import 这个包只会去探那一棵树。现在候选表全部由入参/库根推导 —— 下面三条把
       "别处的布局也找得到" 与 "一个都没有就 null（不抛、不硬用错路径）" 变成机器判据。 */
    const GID = '4319609998'                                   // 合成 id：本机语料/工坊里不可能存在
    const gRoot = path.join(TMP, 'generic-root')
    fs.mkdirSync(path.join(gRoot, GID), { recursive: true })
    fs.writeFileSync(path.join(gRoot, GID, 'project.json'), JSON.stringify({ __tier: 'library-root' }))
    const g1 = readProjectJson(GID, { root: gRoot })
    check('A11 只有 <库根自身>/<id>/project.json 时也找得到（source=library-root，from 说明是哪条候选）',
      !!g1 && g1.source === 'library-root' && g1.json.__tier === 'library-root' && /库根自身/.test(String(g1.from || '')),
      g1 ? g1.source + ' from=' + g1.from : 'null')

    const gParent = path.join(TMP, 'generic-parent')
    const gRoot2 = path.join(gParent, 'repo')
    fs.mkdirSync(path.join(gParent, GID), { recursive: true })
    fs.writeFileSync(path.join(gParent, GID, 'project.json'), JSON.stringify({ __tier: 'library-parent' }))
    fs.mkdirSync(gRoot2, { recursive: true })
    const g2 = readProjectJson(GID, { root: gRoot2 })
    check('A12 只有 <库根的父目录>/<id>/project.json 时 → source=library-parent',
      !!g2 && g2.source === 'library-parent' && g2.json.__tier === 'library-parent', g2 ? g2.source + ' from=' + g2.from : 'null')

    const probe = projectJsonProbe(GID, { root: path.join(TMP, 'nothing-here') })
    check('A13 一个候选都不存在 → null（不抛）且 probe 逐条如实记账（没有"静默用错路径"）',
      probe.found === null && probe.attempts.length >= 3 && probe.attempts.every((a) => a.exists === false && a.path && a.source),
      'attempts=' + probe.attempts.length + ' found=' + JSON.stringify(probe.found))
    check('A14 readProjectJson 绝不返回不存在的路径（候选只探测、不硬用）',
      !probe.found && (!g1 || fs.existsSync(g1.path)) && (!g2 || fs.existsSync(g2.path)))
  } finally {
    if (ENV_SAVED === undefined) delete process.env.MPW_PROJECT_JSON_DIR
    else process.env.MPW_PROJECT_JSON_DIR = ENV_SAVED
  }
}

// ── 真包数据定位（语料目录 + Steam 工坊目录）────────────────────────────────
const IDS = ['3554161528', '3544152633', '3327063360', '3719111841', '3326873240', '3660962877']
const WORKSHOP = findWorkshopDir()   // ①(2026-09-19 敏感信息加固) 原名 WS，让位给 tests/_root.mjs 的“工作区根” WS
const SCENE_ROOT = process.env.MPW_SCENE_ROOT || path.join(WS, 'allwallpaper', 'dd')
const sceneJsonOf = (id) => {
  for (const rt of [SCENE_ROOT, WORKSHOP]) {
    if (!rt) continue
    const p = path.join(rt, id, 'scene.pkg')
    try {
      if (!fs.existsSync(p)) continue
      const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(p)))
      return JSON.parse(rd(lib.getEntry(pkg, 'scene.json')))
    } catch { /* 下一个候选 */ }
  }
  return null
}

console.log('[B] 真包 6 个：readProjectProperties 非空 + 命中档位合法 + 工坊档隔离可达')
for (const id of IDS) {
  const pr = readProjectProperties(id)
  check('B1 ' + id + ' 属性表非空', !!pr && pr.properties && Object.keys(pr.properties).length > 0,
    pr ? 'source=' + pr.source + ' keys=' + Object.keys(pr.properties).length : 'null')
  check('B2 ' + id + ' 命中档位 = 语料档（scene-root / scene-root-workspace）或工坊档（本机真实存在的两族档）',
    !!pr && (pr.source === 'scene-root' || pr.source === 'scene-root-workspace' || pr.source === 'we-workshop'), pr && pr.source)
  const pw = readProjectProperties(id, { sceneRoot: path.join(TMP, 'no-such-scene-root') }) // 挖掉语料档
  check('B3 ' + id + ' 挖掉语料档后必命中 we-workshop（Steam 工坊目录 431960/<id>/）',
    !!pw && pw.source === 'we-workshop' && Object.keys(pw.properties).length > 0, pw && pw.source)
}

console.log('[C] 条件门控真值：白子 3327063360 的 4 个 Clock 变体恰好 1 个可见（= condition==b1 默认值），"秒"可见')
{
  const ID = '3327063360'
  const CLOCK_IDS = [394, 639, 8183, 7186]
  const SEC_ID = 1192
  const pj = readProjectJson(ID)
  const schema = pj && pj.json && pj.json.general && pj.json.general.properties
  check('C1 官方 schema 非空且含 b1', !!schema && !!schema.b1, schema ? 'keys=' + Object.keys(schema).length + ' b1.type=' + schema.b1.type : 'null')
  const props = lib.propsDefaults(schema)                     // 作者默认值表（= 面板初值）
  const gated = lib.gatedOffNames(schema, props)
  const scene = sceneJsonOf(ID)
  const byId = {}
  for (const o of (scene && scene.objects) || []) byId[o.id] = o
  check('C2 scene.json 里 4 个 Clock 变体齐且 visible 形如 {user:{condition,name:"b1"},value}',
    CLOCK_IDS.every((id) => byId[id] && byId[id].visible && typeof byId[id].visible === 'object'
      && byId[id].visible.user && typeof byId[id].visible.user === 'object' && byId[id].visible.user.name === 'b1'
      && typeof byId[id].visible.user.condition === 'string'),
    CLOCK_IDS.map((id) => id + ':cond=' + (byId[id] && byId[id].visible && byId[id].visible.user && byId[id].visible.user.condition)).join(' '))
  const visWithProps = CLOCK_IDS.filter((id) => lib.evalVisibleWithProps(byId[id].visible, props, gated))
  const expected = CLOCK_IDS.filter((id) => String(byId[id].visible.user.condition) === String(props.b1))
  check('C3 默认属性下恰好 1 个 Clock 变体可见', visWithProps.length === 1,
    '可见 id=' + visWithProps.join(',') + ' / 共 ' + CLOCK_IDS.length + ' 个变体')
  check('C4 可见的正是 condition 与 b1 默认值相等的那一个', visWithProps.length === 1 && expected.length === 1 && visWithProps[0] === expected[0],
    '选中 id=' + visWithProps.join(',') + '（condition "' + (byId[visWithProps[0]] || { visible: { user: {} } }).visible.user.condition + '" == b1 默认 "' + props.b1 + '"）')
  const visNoProps = CLOCK_IDS.filter((id) => lib.evalVisibleWithProps(byId[id].visible, null, null))
  check('C5 对照（修复前 bug 形态）：属性表缺失时 4 个变体全部按可见', visNoProps.length === CLOCK_IDS.length,
    '全可见 id=' + visNoProps.join(','))
  const sec = byId[SEC_ID]
  check('C6 "秒"（id ' + SEC_ID + '，绑 newproperty49）默认可见',
    !!sec && lib.evalVisibleWithProps(sec.visible, props, gated) === true,
    'visible=' + JSON.stringify(sec && sec.visible) + ' newproperty49 默认=' + props.newproperty49)
}

console.log('[D] hina 3554161528：schema 非空 + scene.json 全部 {user:…} 绑定都能在 schema 里找到')
{
  const ID = '3554161528'
  const pj = readProjectJson(ID)
  const schema = pj && pj.json && pj.json.general && pj.json.general.properties
  check('D1 官方 schema 非空', !!schema && Object.keys(schema).length > 0,
    schema ? 'keys=' + Object.keys(schema).length + ' source=' + pj.source : 'null')
  const scene = sceneJsonOf(ID)
  const names = []
  const walk = (o) => {
    if (Array.isArray(o)) { o.forEach(walk); return }
    if (!o || typeof o !== 'object') return
    if ('user' in o) {
      const u = o.user
      const n = typeof u === 'string' ? u : (u && typeof u === 'object' && u.name)
      if (n && !names.includes(n)) names.push(n)
    }
    for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v)
  }
  walk(scene)
  const missing = names.filter((n) => !(n in schema))
  check('D2 绑定引用的属性名全部能在 schema 找到（缺失列表必须为空）', missing.length === 0,
    '绑定名 ' + names.length + ' 个；缺失=' + JSON.stringify(missing))
}

console.log('[E] 优雅降级：不存在的 id → null 且不抛')
{
  let r1 = 'unset', threw1 = null
  try { r1 = readProjectJson('0000000000') } catch (e) { threw1 = e.message }
  check('E1 readProjectJson("0000000000") = null 且不抛异常', !threw1 && r1 === null, threw1 ? 'threw=' + threw1 : 'null')
  let r2 = 'unset', threw2 = null
  try { r2 = readProjectProperties('99999999999999') } catch (e) { threw2 = e.message }
  check('E2 readProjectProperties("99999999999999") = null 且不抛异常', !threw2 && r2 === null, threw2 ? 'threw=' + threw2 : 'null')
}

console.log('[F] 服务端路由契约：子进程起 server/we-scene-demo-server.mjs（随机空闲端口；try/finally 必杀）')
{
  let child = null
  try {
    const port = await new Promise((res, rej) => {
      const s = net.createServer()
      s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) })
      s.on('error', rej)
    })
    child = spawn(process.execPath, ['server/we-scene-demo-server.mjs'], {
      cwd: HERE,
      env: { ...process.env, PORT: String(port) },
      stdio: 'ignore',
    })
    // 等服务就绪（最多 ~20s）：任何 HTTP 应答都算就绪
    const base = 'http://127.0.0.1:' + port
    let ready = false
    for (let i = 0; i < 100 && !ready; i++) {
      if (child.exitCode !== null) break
      try { await fetch(base + '/diag-flags.json', { signal: AbortSignal.timeout(800) }); ready = true } catch { await new Promise((r) => setTimeout(r, 200)) }
    }
    check('F1 子进程服务在空闲端口 ' + port + ' 就绪', ready && child.exitCode === null)
    if (ready) {
      const r = await fetch(base + '/project/3554161528')
      check('F2 GET /project/3554161528 → 200', r.status === 200, 'status=' + r.status)
      const j = await r.json().catch(() => null)
      check('F3 响应体是官方 project.json（含 general.properties）',
        !!j && j.general && j.general.properties && Object.keys(j.general.properties).length > 0,
        j && j.general && j.general.properties ? 'keys=' + Object.keys(j.general.properties).length : 'null')
      const src = r.headers.get('x-project-source')
      check('F4 响应头 x-project-source 标出来源（语料档 scene-root / scene-root-workspace，或工坊档 we-workshop）',
        src === 'scene-root' || src === 'scene-root-workspace' || src === 'we-workshop', 'x-project-source=' + src)
      const r2 = await fetch(base + '/project/0000000000')
      check('F5 不存在的 id → 404 no project.json', r2.status === 404, 'status=' + r2.status)
    }
  } catch (e) {
    check('F0 服务端契约测试异常', false, String(e && e.message || e))
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM')
      await new Promise((res) => {
        const t = setTimeout(() => { try { child.kill('SIGKILL') } catch {} ; res() }, 3000)
        child.once('exit', () => { clearTimeout(t); res() })
      })
    }
  }
}

cleanup()
console.log('\n===== project-json-test: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
process.exit(fail ? 1 : 0)
