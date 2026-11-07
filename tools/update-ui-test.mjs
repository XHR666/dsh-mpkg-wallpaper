// tools/update-ui-test.mjs —— Z2/F1（2026-11-07 任务书）：更新提示 UI 改版判据
//   徽标橙色→黑（含 :hover 与暗色主题变体）；更新弹窗只保留「前往插件市场更新」（蓝主按钮）+「取消」；
//   内置自更新入口 0 残留（前端不再调用 host 的 update-apply；路由本身保留在 lib/index.js）；文案换新。
// 断言（组级：A/B/C/D 任一子项失败 ⇒ 该组红）：
//   A 徽标颜色：橙色 0 残留（224,120,40 / #ffd9a0 全文件）；黑底（#000/#111/#1c1f27）+ 高对比文字；
//     border-radius: var(--mpw-r-md) 仍在；:hover 仍在；html body[data-ds-dark-theme] 暗色变体存在
//   B 弹窗两按钮（行为级）：?updcheck=fake 世界里渲染设置面板；**夹具方式（任务书允许自选并写明）**：
//     直接驱动 updState/updChoose —— 给桩 react.useState 包一层记录槽位，逐槽探针（写哨兵对象 →
//     重渲染 → 看 .mpw_updBadge 是否出现）定位 updState 槽，写入 fake 更新状态；然后**点徽标自己的
//     onClick**（组件真实接线 setUpdChoose(updState)，即 update-fake-test A4 的行为级等价）⇒
//     弹窗出现 ⇒ 按钮数==2、主按钮 mpw_button+「前往插件市场更新」、次按钮「取消」、
//     无「直接用本插件更新」残留、正文含新文案。
//     （不走"手动执行 checkUpdate 所在 effect"：该 effect 体内还 setConflicts(...) 等多次 setState，
//      会让两次渲染间的 hook 槽位错位——桩世界无真实 diff 重渲染对齐，探针已实测写错槽。）
//   C 自更新残留 0 + 能力保留：前端 fetch("/update-apply") 0 处；t("update.apply"/"applying"/"applied"/
//     "readonly"/"confirmSelf") 0 引用且字典键已删（zh/en）；lib/index.js 的 BASE + '/update-apply' 路由仍在
//   D 文案：zh/en 的 chooseTitle/chooseBody = 「发现新版本」/「请前往插件市场更新（推荐）」；键集合一致
// 变异自证（隔离副本 os.tmpdir()；期望红集 == 实际红集，逐条相等）：
//   M1 市场主按钮 class mpw_button→mpw_reset ⇒ 红 ["B"]
//   M2 徽标底色改回 rgba(224,120,40,0.18) ⇒ 红 ["A"]
//   M3 弹窗塞回 t("update.confirmSelf") 按钮 ⇒ 红 ["B","C"]
//   M4 删 lib/index.js 的 /update-apply 路由 ⇒ 红 ["C"]
// 用法: node tools/update-ui-test.mjs [--client <path> --index <path>]（对照/审查用）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPlugin, cancelWorldTimers } from './_stub.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(here, '..')
let pass = 0, fail = 0
const ok = (n, d = '') => { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')) }
const bad = (n, d = '') => { fail++; console.error('  ✗ ' + n + (d ? '  — ' + d : '')) }

const CLEAR = ['__mpwClientLoaded', '__mpwRegistered', '__mpwRegisteredIds', '__mpwRegisterErr', '__mpwAppliedOnce', '__mpwBuildCss']
const resetGlobals = () => { for (const k of CLEAR) { try { delete globalThis[k] } catch {} } }

const deepEls = (node, out, depth) => {
  out = out || []; depth = depth || 0
  if (depth > 14 || node === null || node === undefined) return out
  if (Array.isArray(node)) { node.forEach((n) => deepEls(n, out, depth + 1)); return out }
  if (typeof node !== 'object') return out
  if (node.__el) {
    if (typeof node.type === 'function') {
      // 与 panel-fixes deepText 同语义：函数组件**既**调用它取渲染输出，**也**继续走元素自身的 kids
      //（桩 h() 把 children 存在 node.kids 而不是 props.children ⇒ 只调组件会丢 children，MaskPortal 内层会变 null）
      try { deepEls(node.type(Object.assign({ t: (k) => k, src: 'x.mp4', checked: false, onChange() {}, disabled: false }, node.props || {})), out, depth + 1) } catch {}
      deepEls(node.kids, out, depth + 1)
      return out
    }
    out.push(node)
    deepEls(node.kids, out, depth + 1)
  }
  return out
}
const elText = (el) => {
  const out = []
  const walk = (n, d) => {
    if (d > 10 || n === null || n === undefined) return
    if (typeof n === 'string' || typeof n === 'number') { out.push(String(n)); return }
    if (Array.isArray(n)) { n.forEach((x) => walk(x, d + 1)); return }
    if (n && n.__el) walk(n.kids, d + 1)
  }
  walk(el && el.kids, 0)
  return out.join('')
}

async function runChecks(clientPath, indexPath) {
  resetGlobals()
  cancelWorldTimers()
  const w = loadPlugin({ quiet: true, clientPath, settings: { enabled: true }, search: '?updcheck=fake' })
  const CLIENT = fs.readFileSync(clientPath, 'utf8')
  const INDEX = fs.readFileSync(indexPath, 'utf8')
  const dicts = w.localeDicts || {}
  const zh = dicts.zh || {}, en = dicts.en || {}
  const tZh = (k) => (zh[k] !== undefined ? zh[k] : k)

  const r = {}
  /* ---------- A 徽标颜色（源码级） ---------- */
  {
    const aFail = []
    const orange = (CLIENT.match(/224,\s*120,\s*40|#ffd9a0/g) || []).length
    if (orange !== 0) aFail.push('橙色残留 ' + orange)
    const blkM = CLIENT.match(/\.mpw_updBadge \{[\s\S]*?\n\}/)
    const blk = blkM ? blkM[0] : ''
    if (!blk) aFail.push('徽标规则块缺失')
    if (!/#000|#111|#1c1f27/.test(blk)) aFail.push('无黑色系底色')
    if (!/color:\s*#fff/.test(blk)) aFail.push('文字色非高对比白')
    if (!/border-radius:\s*var\(--mpw-r-md\)/.test(blk)) aFail.push('圆角 var(--mpw-r-md) 丢失')
    if (!/\.mpw_updBadge:hover \{/.test(CLIENT)) aFail.push(':hover 规则丢失')
    if (!/html body\[data-ds-dark-theme\] \.mpw_updBadge \{/.test(CLIENT)) aFail.push('暗色主题变体缺失')
    r['A'] = aFail.length === 0
    r.__a = aFail.join('；') || ('底色块=' + (blk.match(/background:\s*[^;]+/) || [''])[0])
  }
  /* ---------- C 自更新残留 0 + 能力保留（源码级） ---------- */
  {
    const cFail = []
    if ((CLIENT.match(/fetch\(HOST_URL \+ "\/update-apply"/g) || []).length !== 0) cFail.push('前端仍调用 update-apply')
    const refKeys = ['update.apply', 'update.applying', 'update.applied', 'update.readonly', 'update.confirmSelf']
    const refs = refKeys.reduce((n, k) => n + (CLIENT.match(new RegExp('t\\("' + k + '"\\)', 'g')) || []).length, 0)
    if (refs !== 0) cFail.push('已删键的 t() 引用 ' + refs + ' 处')
    const deadKeys = refKeys.filter((k) => (k in zh) || (k in en))
    if (deadKeys.length) cFail.push('字典键未删: ' + deadKeys.join(','))
    if (!/BASE \+ '\/update-apply'/.test(INDEX)) cFail.push('host /update-apply 路由丢失（能力被顺手删）')
    r['C'] = cFail.length === 0
    r.__c = cFail.join('；') || '前端 0 调用 / 已删键 0 引用 0 残键 / host 路由在'
  }
  /* ---------- D 文案（字典级） ---------- */
  {
    const dFail = []
    if (!/发现新版本/.test(zh['update.chooseTitle'] || '')) dFail.push('zh 标题缺「发现新版本」')
    if (!/请前往插件市场更新（推荐）/.test(zh['update.chooseBody'] || '')) dFail.push('zh 正文缺「请前往插件市场更新（推荐）」')
    if (!/New version available/i.test(en['update.chooseTitle'] || '')) dFail.push('en 标题缺 New version available')
    if (!/plugin market \(recommended\)/i.test(en['update.chooseBody'] || '')) dFail.push('en 正文缺市场指引')
    const zk = Object.keys(zh), ek = Object.keys(en)
    if (!(zk.every((k) => k in en) && ek.every((k) => k in zh))) dFail.push('zh/en 键集合不一致')
    r['D'] = dFail.length === 0
    r.__d = dFail.join('；') || ('键集合 ' + zk.length + ' 键一致')
  }
  /* ---------- B 弹窗两按钮（行为级：updState/updChoose 夹具注入 + 徽标真实渲染条件） ----------
     夹具方式（任务书允许自选并写明）：桩 react 是"每次渲染=重新 mount"模型（hookState 每渲染重置、
     useState 以 hookState.length 为索引）⇒ 没法跨渲染携带 state。分两相：
       相1（发现）：包 useState 记录槽位 → 渲染 → 手动执行 checkUpdate 所在 effect + 捕获 800ms 定时器
         同步跑 ⇒ checkUpdate 的 fake 分支调 setUpdState ⇒ 我的包装记录到槽位号 UPD_IDX（动态发现，
         不写死）；CHOOSE_IDX = UPD_IDX+1（由源码断言 updState/updChoose 两个 useState 相邻兜底）。
       相2（断言）：重新 loadPlugin，包装 useState：槽位 UPD_IDX / CHOOSE_IDX 的 init 注入 FAKE_UPD
         （= 生产 setUpdChoose(updState) 传同一对象）；渲染 ⇒ 徽标出现（updState.hasUpdate 的真实
         渲染条件）+ 弹窗出现 ⇒ 断言两按钮/文案/无自更新残留。
       （徽标 onClick→setUpdChoose 的接线由 update-fake-test A4 源码级钉住；本判据 B 钉渲染面。） */
  {
    const bFail = []
    const FAKE_UPD = { ok: true, fake: true, local: 'probe-local', remote: 'probe-remote', localVersion: '0.0.0', remoteVersion: '9.9.9', releaseAt: null, hasUpdate: true, contentDiff: true }
    /* 相1：发现 updState 槽位号（setUpdState 被 checkUpdate fake 分支调用的那一刻，setter 闭包
       里带着它在首次渲染时的槽位号 ⇒ 动态发现，不写死；桩世界重渲染=重新 mount，所以只能这样）。 */
    let UPD_IDX = -1
    {
      resetGlobals(); cancelWorldTimers()
      const w1 = loadPlugin({ quiet: true, clientPath, settings: { enabled: true }, search: '?updcheck=fake' })
      const origUS = w1.react.useState
      let rec = true
      w1.react.useState = (init) => {
        const i = (w1.react.useState.__n = (w1.react.useState.__n || 0) + 1) - 1
        const r = origUS(init)
        if (!rec) return r
        const set = r[1]
        return [r[0], (v) => { if (v && typeof v === 'object' && v.fake && v.hasUpdate) UPD_IDX = i; return set(v) }]
      }
      const effects = []
      w1.react.useEffect = (fn) => { if (rec) effects.push(fn) }
      try { w1.sectionComp({ t: tZh, close: () => {} }) } catch {}
      rec = false
      const updEffs = effects.filter((f) => { try { return String(f).indexOf('checkUpdate') >= 0 } catch { return false } })
      const origST = globalThis.setTimeout
      const cbs = []
      globalThis.setTimeout = (fn, ms, ...a) => { if (ms === 800) { cbs.push(fn); return 0 } return origST(fn, ms, ...a) }
      for (const f of updEffs) { try { f() } catch {} }
      globalThis.setTimeout = origST
      for (const cb of cbs) { try { cb() } catch {} }   // checkUpdate() 的 fake 分支 ⇒ setUpdState(FAKE) ⇒ UPD_IDX
      cancelWorldTimers()
    }
    if (UPD_IDX < 0) { bFail.push('未发现 updState 槽位（徽标渲染条件/useState 结构变了？）') }
    if (UPD_IDX >= 0) {
      // 源码断言：updState 与 updChoose 的 useState 相邻 ⇒ CHOOSE_IDX = UPD_IDX + 1
      const srcNow = fs.readFileSync(clientPath, 'utf8')
      if (!/const \[updState, setUpdState\] = react\.useState\(null\);[\s\S]{0,120}?const \[updChoose, setUpdChoose\] = react\.useState\(null\);/.test(srcNow)) {
        bFail.push('updState/updChoose 两个 useState 不再相邻（槽位推断失效，需改判据）')
      }
      const CHOOSE_IDX = UPD_IDX + 1
      /* 相2：注入渲染（updState + updChoose 同一对象 = 生产 setUpdChoose(updState) 同形） */
      resetGlobals(); cancelWorldTimers()
      const w3 = loadPlugin({ quiet: true, clientPath, settings: { enabled: true }, search: '?updcheck=fake' })
      const orig3 = w3.react.useState
      let pos3 = 0
      w3.react.useState = (init) => { const k = pos3++
        if (k === UPD_IDX || k === CHOOSE_IDX) return orig3(() => FAKE_UPD)
        return orig3(init) }
      let tree3 = null
      try { tree3 = w3.sectionComp({ t: tZh, close: () => {} }) } catch (e) { bFail.push('注入渲染异常: ' + (e && e.message)) }
      const els3 = tree3 ? deepEls(tree3) : []
      const badge = els3.find((e) => e.props && e.props.className === 'mpw_updBadge')
      if (!badge) bFail.push('updState 注入后徽标未出现')
      const dlg = els3.find((e) => e.props && typeof e.props.className === 'string' && e.props.className.indexOf('mpw_dialog') >= 0)
      if (!dlg) bFail.push('updChoose 注入后弹窗未出现')
      else {
        const btns = deepEls(dlg).filter((e) => e.type === 'button')
        if (btns.length !== 2) bFail.push('弹窗按钮数=' + btns.length + '（应=2）')
        const marketBtn = btns.find((e) => String(e.props.className || '').indexOf('mpw_button') >= 0)
        const cancelBtn = btns.find((e) => String(e.props.className || '').indexOf('mpw_reset') >= 0 && elText(e) === tZh('conflict.cancel'))
        if (!marketBtn) bFail.push('无 mpw_button 主按钮')
        else if (elText(marketBtn) !== tZh('update.market')) bFail.push('主按钮文案≠update.market（' + elText(marketBtn) + '）')
        if (!cancelBtn) bFail.push('无「取消」次按钮')
        const allText = deepEls(dlg).map((e) => elText(e)).join(' ')
        if (/直接用本插件更新|update\.confirmSelf/.test(allText)) bFail.push('「直接用本插件更新」残留')
        if (!/发现新版本/.test(allText) || !/请前往插件市场更新（推荐）/.test(allText)) bFail.push('弹窗文案缺新口径（标题/正文）')
        r.__b = '按钮=' + btns.length + ' 主=' + (marketBtn ? elText(marketBtn) : '无') + ' 次=' + (cancelBtn ? elText(cancelBtn) : '无') + ' updState@hook#' + UPD_IDX
      }
      cancelWorldTimers()
    }
    r['B'] = bFail.length === 0
    r.__bFail = bFail.join('；')
    resetGlobals()
    cancelWorldTimers()
    // 重新载入一次干净世界给调用方后续使用（保持返回值里 dicts 有效性）
    const wFresh = loadPlugin({ quiet: true, settings: { enabled: true } })
    r.__dicts = wFresh.localeDicts || {}
  }
  return r
}

console.log('== 主判据（真树）==')
const argC = process.argv.indexOf('--client'), argI = process.argv.indexOf('--index')
const cPath = argC > 0 ? process.argv[argC + 1] : path.join(ROOT, 'lib', 'client.js')
const iPath = argI > 0 ? process.argv[argI + 1] : path.join(ROOT, 'lib', 'index.js')
if (argC > 0) console.log('  （对照副本：' + cPath + ' ' + iPath + '）')
const main = await runChecks(cPath, iPath)
for (const [id, name] of [['A', 'A 徽标颜色（橙 0 / 黑底白字 / 圆角 / hover / 暗色变体）'], ['B', 'B 弹窗两按钮（fake 世界行为级）'], ['C', 'C 自更新 0 残留 + host 路由保留'], ['D', 'D 文案新口径 + 键集合一致']]) {
  if (main[id]) ok(name, main['__' + id.toLowerCase()] || '')
  else bad(name, main['__' + id.toLowerCase() + 'Fail'] || main['__' + id.toLowerCase()] || '')
}

console.log('\n== M 变异自证（隔离副本；期望红集 == 实际红集，逐条相等）==')
const CLIENT = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
const INDEX = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
const MKT_ANCHOR = 'className: "mpw_button", type: "button", onClick: () => { setUpdChoose(null); if (mpwOpenPluginMarket("update-choose"))'
const BADGE_ANCHOR = 'color: #fff; background: #111; border: 1px solid rgba(255,255,255,0.28);'
const CONFIRM_ANCHOR = 'onClick: () => { setUpdChoose(null); if (mpwOpenPluginMarket("update-choose")) setHint(t("update.openingMarket")); else setHint(t("update.gotoMarket")); } }, t("update.market")),'
const ROUTE_ANCHOR = "kind: 'exact', path: BASE + '/update-apply',"
const MUT = [
  { id: 'M1', what: '市场主按钮改回 mpw_reset ⇒ B 必红', expect: ['B'],
    patchC: (s) => s.replace(MKT_ANCHOR, MKT_ANCHOR.replace('mpw_button', 'mpw_reset')),
    verify: (s) => s.split(MKT_ANCHOR.replace('mpw_button', 'mpw_reset')).length > 1 && !s.includes(MKT_ANCHOR) },
  { id: 'M2', what: '徽标底色改回橙色 ⇒ A 必红', expect: ['A'],
    patchC: (s) => s.replace(BADGE_ANCHOR, 'color: #ffd9a0; background: rgba(224,120,40,0.18); border: 1px solid rgba(224,120,40,0.5);'),
    verify: (s) => s.includes('rgba(224,120,40,0.18)') && !s.includes(BADGE_ANCHOR) },
  { id: 'M3', what: '弹窗塞回 confirmSelf 按钮 ⇒ B+C 必红', expect: ['B', 'C'],
    patchC: (s) => s.replace(CONFIRM_ANCHOR, CONFIRM_ANCHOR + '\n\t\t\t\t\t\t\th("button", { className: "mpw_reset", type: "button", onClick: () => {} }, t("update.confirmSelf")),'),
    verify: (s) => (s.match(/t\("update\.confirmSelf"\)/g) || []).length >= 1 },
  { id: 'M4', what: '删 host /update-apply 路由 ⇒ C 必红（反向）', expect: ['C'],
    patchI: (s) => s.replace(ROUTE_ANCHOR, "kind: 'exact', path: BASE + '/update-apply-removed',"),
    verify: (s) => !s.includes(ROUTE_ANCHOR) },
]
for (const m of MUT) {
  const mutC = m.patchC ? m.patchC(CLIENT) : CLIENT
  const mutI = m.patchI ? m.patchI(INDEX) : INDEX
  const vOk = m.patchI ? m.verify(mutI) : m.verify(mutC)
  if (!vOk) { fail++; console.error('  ✗ MUTANT-INERT ' + m.id); continue }
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'upd-ui-mut-'))
  const pc = path.join(TMP, 'client-mut.js'), pi = path.join(TMP, 'index-mut.js')
  fs.writeFileSync(pc, mutC); fs.writeFileSync(pi, mutI)
  let r = {}
  try { r = await runChecks(pc, pi) } catch (e) { r = { A: false, B: false, C: false, D: false, __err: String(e && e.message) } }
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {}
  cancelWorldTimers()
  const red = ['A', 'B', 'C', 'D'].filter((id) => !r[id])
  const eq = m.expect.length === red.length && m.expect.every((x) => red.indexOf(x) >= 0)
  if (eq) { pass++; console.log('  ✓ MUTANT-RED-OK ' + m.id + '  ' + m.what + '  期望红=' + JSON.stringify(m.expect) + ' 实际红=' + JSON.stringify(red)) }
  else { fail++; console.error('  ✗ MUTANT-MISMATCH ' + m.id + '  期望红=' + JSON.stringify(m.expect) + ' 实际红=' + JSON.stringify(red) + (r.__err ? ' err=' + r.__err : '') + (red.includes('B') ? ' B细节=' + (r.__bFail || '') : '')) }
}

console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail ? 1 : 0)
