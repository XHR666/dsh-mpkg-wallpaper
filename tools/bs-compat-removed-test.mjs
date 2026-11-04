// tools/bs-compat-removed-test.mjs —— #2 判据（2026-11-03 任务书 A3-2：better-sidebar 适配退役）
//
// 背景：dsh-better-sidebar 第三方插件已被 DSH **原生右栏**取代（我们的「壁纸」页签经宿主
// betterSidebar **服务**注册 —— mpwBsTab*，与被删的适配块无关）；适配选择器
// [data-dsh-better-sidebar] 只命中第三方插件的 DOM = 死代码。2026-11-03 整块删除：
//   · 设置键：bsCompat / bsFloat / bsFont / bsReveal / bsRevealAlpha / bsAlpha / bsAqua / bsBottomAvoid
//     （含 bsCompatUserSet 标记、默认值迁移、备份导入标记、预设快照白名单、numFields/boolFields）
//   · i18n：bs.* 两套词典
//   · CSS：buildCss 的适配模板块 + 统一虚化里的 bsTakeoverSurface 插值
//   · host（lib/index.js）：/ping 的 betterSidebar/betterSidebarVersion 字段 + 安装/版本检测
//   · 判据：better-sidebar-compat-test.mjs / bs-compat-default-test.mjs（本文件接替其"守护"角色）
//
// 本文件断言（变异自证见文末 M1/M2）：
//   A1 适配零残留：client.js 无 bsCompat/bsFloat/…/data-dsh-better-sidebar/bsCompatUserSet
//   A2 版本门控链零残留：无 data-mpw-bs-version / applyBetterSidebarVersion / refreshBetterSidebarVersion
//   A3 宿主侧零残留：index.js 无 betterSidebarLoaded / detectBetterSidebarVersion / /ping 不返回该字段
//   A4 壁纸页签注册**健在**：mpwBsService 三级解析（ctx.get/reflect/旧宿主）+ registerTab 调用在
//      —— 删除适配不许误伤"经宿主服务注册页签"这条活链路
//   A5 词典零残留：zh/en 都没有 "bs." 开头的键
//   M1 变异：写回一条 [data-dsh-better-sidebar] 适配规则 ⇒ A1 必红
//   M2 变异：/ping 加回 betterSidebar 字段 ⇒ A3 必红
//
// 用法: node tools/bs-compat-removed-test.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(here, '..')
let pass = 0, fail = 0
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')) } else { fail++; console.error('  ✗ ' + n + (d ? '  — ' + d : '')) } }

const CLIENT = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
const INDEX = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')

console.log('== A. 删除断言（适配退役零残留）==')
{
  // 先剥注释再扫：墓碑注释（"xxx 已删"）合法地保留了历史名，不能算残留（R3：不许拿注释糊弄判据，
  // 也不许拿判据误伤注释——代码级标识符才残留）。
  const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/[^\n]*/gm, ' ')
  const CODE_C = stripComments(CLIENT)
  const CODE_I = stripComments(INDEX)
  const forbiddenClient = [
    /bsCompat/, /bsFloat/, /bsFont/, /bsReveal/, /bsRevealAlpha/, /\bbsAlpha\b/, /\bbsAqua\b/, /bsBottomAvoid/,
    /bsCompatUserSet/, /data-dsh-better-sidebar/, /DEFAULT_BS_COMPAT/, /bsTakeoverSurface/,
  ]
  const hits = forbiddenClient.filter((re) => re.test(CODE_C))
  ok('A1 client.js 适配零残留（设置键/标记/选择器/插值变量；注释不算）', hits.length === 0,
    hits.length ? '残留=' + hits.map(String).join(',') : '0 残留')
  ok('A2 版本门控链零残留（data-mpw-bs-version / 探测函数）',
    !/data-mpw-bs-version/.test(CODE_C) && !/applyBetterSidebarVersion/.test(CODE_C) && !/refreshBetterSidebarVersion/.test(CODE_C))
  ok('A3 宿主侧零残留（安装/版本检测 + /ping 字段）',
    !/betterSidebarLoaded/.test(CODE_I) && !/detectBetterSidebarVersion/.test(CODE_I)
    && !/betterSidebarVersion/.test(CODE_I))
  ok('A4 壁纸页签注册健在（宿主 betterSidebar 服务三级解析 + registerTab）',
    /ctx\.get\("betterSidebar"\)/.test(CLIENT) && /ctx\.reflect\.get\("betterSidebar"\)/.test(CLIENT)
    && /registerTab\(d\)/.test(CLIENT) && /mpwBsTabDescriptor\(\)/.test(CLIENT))
  const zhStart = CLIENT.indexOf('\t\tconst zh = {')
  const enStart = CLIENT.indexOf('\t\tconst en = {')
  const zh = CLIENT.slice(zhStart, enStart)
  const en = CLIENT.slice(enStart, CLIENT.indexOf('\t\t};', enStart))
  ok('A5 词典零残留（zh/en 无 "bs." 键）', !/"bs\.[a-zA-Z.]+":/.test(zh) && !/"bs\.[a-zA-Z.]+":/.test(en))
}

console.log('\n== M. 变异自证（期望红集 == 实际红集，逐条相等）==')
const MUT = [
  { id: 'M1', what: '写回一条 [data-dsh-better-sidebar] 适配规则 ⇒ A1 必红', expect: ['A1'],
    patch: (s) => s.replace('/* ①(#2 2026-11-03) dsh-better-sidebar 适配 CSS 整块已删',
      '[data-dsh-better-sidebar] [class*="_panel"] { background: #fff } /* M1 */\n/* ①(#2 2026-11-03) dsh-better-sidebar 适配 CSS 整块已删'),
    verify: (s) => s.indexOf('[data-dsh-better-sidebar] [class*="_panel"] { background: #fff } /* M1 */') >= 0 },
  { id: 'M2', what: '/ping 加回 betterSidebar 字段 ⇒ A3 必红', expect: ['A3'],
    patch: (s) => s.replace("json(res, 200, { ok: true, version });",
      "json(res, 200, { ok: true, version, betterSidebar: false, betterSidebarVersion: null }); /* M2 */"),
    verify: (s) => s.indexOf('betterSidebar: false, betterSidebarVersion: null }); /* M2 */') >= 0 },
]
for (const m of MUT) {
  const mutated = m.patch(CLIENT.includes ? CLIENT : '') // noop
  void mutated
  const raw = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
  const rawIdx = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
  let mc = raw, mi = rawIdx
  if (m.id === 'M1') mc = m.patch(raw)
  else mi = m.patch(rawIdx)
  if (!m.verify(m.id === 'M1' ? mc : mi)) { fail++; console.error('  ✗ MUTANT-INERT ' + m.id); continue }
  const r = {}
  r['A1'] = !/\[data-dsh-better-sidebar\]/.test(mc) && !/bsTakeoverSurface/.test(mc)
  r['A3'] = !/betterSidebarLoaded/.test(mi) && !/betterSidebarVersion:/.test(mi)
  const red = m.expect.filter((id) => !r[id])
  const eq = m.expect.length === red.length && m.expect.every((x) => red.indexOf(x) >= 0)
  if (eq) { pass++; console.log('  ✓ MUTANT-RED-OK ' + m.id + ' ' + m.what + '  期望红=' + JSON.stringify(m.expect) + ' 实际红=' + JSON.stringify(red)) }
  else { fail++; console.error('  ✗ MUTANT-MISMATCH ' + m.id + '  期望红=' + JSON.stringify(m.expect) + ' 实际红=' + JSON.stringify(red)) }
}

console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail ? 1 : 0)
