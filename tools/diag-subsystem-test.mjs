// tools/diag-subsystem-test.mjs —— MASTER-TODO §5 第 3 项「诊断自证闭环」的回归门禁
//
// 需求原文：「插件诊断 payload 补齐关键子系统状态（磨砂、侧栏、时间线是否被影响、壁纸类型/路径、
//   shim 是否注入、视频解码状态…），并让用户一次点击就能把状态发回 ⇒ 以后所有真机 bug 都能一轮定位」。
//
// 本文件断言四件事（每条都是"会变红"的判据，不是打印）：
//   A. **payload 组装**（假 DOM，跑生产实现）：
//      · 字段表里每个子系统都出现在 payload 里，且**每个字段带 provenance**（来源）；
//      · 读得到 ⇒ value 非空 + degraded=null；
//      · **读不到 ⇒ 字段仍在**，value=null + degraded.reason（绝不静默省略）；
//      · 部分子来源读不到 ⇒ degraded={reason:"partial",partial:[…]}（不静默残缺）；
//      · 视频子系统真能从 <video> 读出 readyState/videoWidth/error → decoding 判据。
//   B. **一键发送**：POST /diag 拿到宿主返回的落点（`{ok:true,file}`），payload 里确实带 subsystems；
//      宿主不可用（fetch 抛错 / 500）⇒ 自动改走**下载 JSON**（离线可用），两条路径都有断言。
//   C. **上限**：客户端单份 payload 字节上限（超出先砍可选段、再截断超长字符串，并写 truncated 标记）；
//      宿主侧 diag 目录"数量 + 合计字节"双上限、最旧先删（直接调 lib/index.js 的 pruneDiagDir 真实现）。
//   D. **分辨力自证**（防假绿）：三条变异注入 mkdtemp 副本，分别必须让 A/B/C 变红。
//
// 卫生：所有夹具走 mkdtemp；`process.on('exit')` 兜底删除；每份夹具 < 1MB；不写仓库内目录。
// 用法: node tools/diag-subsystem-test.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { loadPlugin } from './_stub.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..')
const clientPath = path.join(repoRoot, 'lib', 'client.js')
const argOf = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d }
const MUT_CLIENT = process.env.MPW_DIAG_MUT_CLIENT ? path.resolve(process.env.MPW_DIAG_MUT_CLIENT) : clientPath
/* 变异子进程只跑 A 段：C 段会写几十 MB 夹具（本机内存/IO 吃紧），没必要在子进程里重跑 */
const ONLY_A = process.argv.includes('--only-a')
/* 变异子进程**不许再跑变异段**（否则子进程又生孙进程 = fork 炸弹，实测把用例挂到超时） */
const NO_MUT = process.argv.includes('--no-mutations') || !!process.env.MPW_DIAG_MUT_CLIENT

/* 真实断言助手（本仓教训：ok(name, detail) 恒真 = 假绿） */
let pass = 0, fail = 0
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  ' + detail : '')) }
  else { fail++; console.error('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-diag-test-'))
let cleaned = false
const cleanup = () => { if (cleaned) return; cleaned = true; try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* 删不掉也不抛 */ } }
process.on('exit', cleanup)

/* diag 目录夹具：必须在 loadPlugin 之前设好 env（lib/index.js 在模块顶层读 DSH_WE_DIAG_DIR） */
const diagDir = path.join(tmpRoot, 'diagdir')
fs.mkdirSync(diagDir, { recursive: true })
process.env.DSH_WE_DIAG_DIR = diagDir
/* 字节上限的行为验证用一个**小上限**（env 就是给这个用的）：夹具从 ~38MB 降到 ~2.4MB。
   出厂默认值（32MB）另用静态断言钉住（见 C5），两者都不丢。 */
process.env.DSH_WE_DIAG_MAX_BYTES = String(2 * 1024 * 1024)

const HOST = await import('../lib/index.js')
const hostTest = HOST.__mpwTest

console.log('══ 诊断自证闭环（MASTER-TODO §5 第 3 项）══')
console.log(`产物：${path.relative(repoRoot, MUT_CLIENT)} · diag 目录夹具：${diagDir}`)

/* ── 场景 1：健康假 DOM（元素齐全、computed 有值） ── */
function installHealthyDom() {
  const mk = (tag) => document.createElement(tag)
  const img = mk('img'); img.id = 'mpw-bgImg'; img.src = 'http://127.0.0.1:3080/custom-folder/w/bg.png'
  const vid = mk('video'); vid.id = 'mpw-bgVideo'
  Object.assign(vid, { readyState: 4, networkState: 1, paused: false, ended: false, muted: true, loop: true, playbackRate: 1, currentTime: 12.5, duration: 30, videoWidth: 1920, videoHeight: 1080, error: null })
  const wrap = mk('div'); wrap.id = 'mpw-bgWrap'
  const frame = mk('iframe'); frame.className = 'mpw-webFrame'
  frame.setAttribute('src', 'http://127.0.0.1:3080/mpw-web-shim?mpwshim=1&u=x'); frame.setAttribute('sandbox', 'allow-scripts')
  frame.__mpwShimOk = true; frame.__mpwShimFellBack = false
  wrap.querySelector = (sel) => (sel.indexOf('iframe') >= 0 ? frame : (sel.indexOf('canvas') >= 0 ? null : null))
  const header = mk('header'); header.className = 'wSkVaW_header'
  const side = mk('div'); side.className = 'pI_x6G_sidebarCol'
  const rail = mk('div'); rail.className = 'eGxaPq_mark'
  document.querySelector = (sel) => {
    if (sel.indexOf('sidebarCol') >= 0) return side
    if (sel.indexOf('eGxaPq_mark') >= 0) return rail
    return null
  }
  const cs = (el, pseudo) => ({
    getPropertyValue: (n) => (n === '--dsw-specific-sidebar-fill' ? '#f5f6f7' : (n === '--mpw-rail-ink' ? 'rgba(0, 0, 0, 0.42)' : (n === '--mpw-rail-halo' ? 'rgba(255, 255, 255, 0.55)' : (n === '--mpw-surface-frost-top' ? 'color-mix(in srgb, #151517 35%, transparent)' : '')))),
    backgroundColor: 'rgba(255, 255, 255, 0.35)', backdropFilter: 'blur(30px)', boxShadow: 'rgba(255,255,255,0.55) 0 0 0 1px',
    overflow: 'visible', position: 'fixed', display: 'block', visibility: 'visible', opacity: '1',
  })
  globalThis.getComputedStyle = cs
  // 恢复被坏场景打坏的 getElementById（stub 的 byId 表在闭包里，用一个足够用的替身）
  const byId = { 'mpw-bgImg': img, 'mpw-bgVideo': vid, 'mpw-bgWrap': wrap }
  document.getElementById = (id) => byId[String(id)] || null
  globalThis.window.__mpwWallpaperState = { state: 'direct', detail: 'fps=30' }
  try { document.body.setAttribute('data-mpw-rsblur', 'on') } catch { /* stub 没有就跳过 */ }
}
/* ── 场景 2：读不到的假 DOM（getComputedStyle / querySelector 全抛） ── */
function installBrokenDom() {
  globalThis.getComputedStyle = () => { throw new Error('getComputedStyle-unavailable') }
  document.querySelector = () => { throw new Error('querySelector-unavailable') }
  document.getElementById = () => { throw new Error('getElementById-unavailable') }
}

const loaded = loadPlugin({ clientPath: MUT_CLIENT, settings: { enabled: true, image: 'data:image/png;base64,AAAA', converted: 'png' }, quiet: true })
if (loaded.applyErrors.length) { console.error('✗ apply() 报错：' + loaded.applyErrors.slice(0, 2).join(' | ')); process.exit(1) }
if (!globalThis.__mpwDiagTest) { console.error('✗ 未暴露 __mpwDiagTest'); process.exit(1) }
const T = globalThis.__mpwDiagTest

/* 必备子系统（brief 点名 + 我们自己加的 surfaceTokens/sceneHealth）——少一个就是回归 */
const REQUIRED = ['frost', 'sidebarAffected', 'railAffected', 'wallpaper', 'shim', 'video', 'surfaceTokens', 'sceneHealth']

console.log('\n== A. payload 组装（假 DOM，跑生产实现）==')
const spec = T.spec()
const specIds = spec.map((x) => x.id)
ok('★ 字段表可枚举且每个字段带 provenance', spec.length > 0 && spec.every((x) => typeof x.provenance === 'string' && x.provenance.length > 10),
  `${spec.length} 个字段：${specIds.join(', ')}`)
ok('★ brief 点名的子系统全部在字段表里', REQUIRED.every((id) => specIds.includes(id)),
  '缺：' + REQUIRED.filter((id) => !specIds.includes(id)).join(', ') || '无')

installHealthyDom()
const healthy = T.subsystems()
ok('★ payload 带 schema + fieldCount', healthy.schema === T.schema && healthy.fieldCount === spec.length, `${healthy.schema} / ${healthy.fieldCount}`)
ok('★ 健康 DOM：每个字段都有值且 degraded=null',
  REQUIRED.every((id) => healthy.fields[id] && healthy.fields[id].value !== null && healthy.fields[id].degraded === null),
  REQUIRED.filter((id) => !healthy.fields[id] || healthy.fields[id].value === null || healthy.fields[id].degraded).map((id) => id + '=' + JSON.stringify(healthy.fields[id] && healthy.fields[id].degraded)).join(' | '))
ok('★ 健康 DOM：壁纸类型/路径读到了（brief 点名）',
  healthy.fields.wallpaper.value.type === 'image' && healthy.fields.wallpaper.value.converted === 'png' && /bg\.png$/.test(healthy.fields.wallpaper.value.dom.mediaCurrentSrc || ''),
  JSON.stringify({ type: healthy.fields.wallpaper.value.type, src: healthy.fields.wallpaper.value.dom.mediaCurrentSrc }))
ok('★ 健康 DOM：shim 是否注入读到了（brief 点名）',
  healthy.fields.shim.value.shimUrl === true && healthy.fields.shim.value.shimOk === true,
  JSON.stringify(healthy.fields.shim.value).slice(0, 140))
const v = T.subsystems().fields.video.value
ok('★ 健康 DOM：视频解码状态读到了（readyState/videoWidth/decoding）',
  v.present === true && v.readyState === 4 && v.videoWidth === 1920 && v.decoding === 'ok',
  JSON.stringify({ readyState: v.readyState, w: v.videoWidth, decoding: v.decoding, hostState: v.hostState }))
ok('★ 健康 DOM：时间线"是否被我们影响"读到了（ours 门控）',
  healthy.fields.railAffected.value.found === true && healthy.fields.railAffected.value.ours !== undefined,
  JSON.stringify(healthy.fields.railAffected.value).slice(0, 140))
ok('★ 健康 DOM：磨砂子系统读到了（injected/px/reason）',
  healthy.fields.frost.value && typeof healthy.fields.frost.value.injected === 'boolean',
  JSON.stringify(healthy.fields.frost.value).slice(0, 140))
ok('★ 表面 token 段读到了（§5 第 1 项联动）',
  healthy.fields.surfaceTokens.value['--mpw-surface-frost-top'] !== null,
  JSON.stringify(healthy.fields.surfaceTokens.value).slice(0, 140))

/* 读不到 ⇒ 字段仍在 + degraded（**这条就是"绝不静默省略"的红线**） */
installBrokenDom()
const broken = T.subsystems()
const missingKeys = REQUIRED.filter((id) => !(id in broken.fields))
ok('★★ 读不到时字段**仍然存在**（不静默省略）', missingKeys.length === 0, missingKeys.length ? '消失的字段：' + missingKeys.join(', ') : `${REQUIRED.length}/${REQUIRED.length} 个字段都在`)
/* 主来源是 DOM 的字段（读不到 ⇒ 必须 value:null + degraded，不许伪装成"没有该子系统"） */
const DOM_BOUND = ['sidebarAffected', 'railAffected', 'surfaceTokens', 'shim', 'video']
const domOk = DOM_BOUND.every((id) => {
  const f = broken.fields[id]
  return f && f.value === null && f.degraded && typeof f.degraded.reason === 'string' && f.degraded.reason.length > 0
})
ok('★★ DOM 类子系统读不到 ⇒ value:null + degraded.reason（不伪装成"没有"）', domOk,
  DOM_BOUND.map((id) => id + '=' + JSON.stringify(broken.fields[id] && broken.fields[id].degraded && broken.fields[id].degraded.reason)).join(' | '))
/* 主来源不是 DOM 的字段（frost/sceneHealth 读 JS 状态、wallpaper 走持久化）：仍必须有值，
   只是把"读不到的 DOM 子来源"记进 degraded.partial —— 这就是"不静默残缺"。 */
const partialOk = ['wallpaper', 'frost', 'sceneHealth'].every((id) => {
  const f = broken.fields[id]
  return f && f.provenance && (f.degraded === null || typeof f.degraded.reason === 'string')
})
ok('★★ 非 DOM 类子系统要么有值、要么显式 degraded（不许静默）', partialOk,
  ['wallpaper', 'frost', 'sceneHealth'].map((id) => id + '=' + JSON.stringify(broken.fields[id] && broken.fields[id].degraded)).join(' | '))
ok('★ wallpaper 在 DOM 坏掉时仍能给出持久化侧的类型/路径，并把 DOM 子来源记为 partial',
  broken.fields.wallpaper.value !== null && broken.fields.wallpaper.degraded && /bgElements/.test(JSON.stringify(broken.fields.wallpaper.degraded.partial || [])),
  JSON.stringify(broken.fields.wallpaper.degraded).slice(0, 200))
ok('★ degraded 里带上"哪几个子来源读不到"（partial 明细）',
  REQUIRED.some((id) => { const d = broken.fields[id] && broken.fields[id].degraded; return d && ((d.partial && d.partial.length) || d.kind === 'throw' || d.reason === 'unreadable:empty') }),
  JSON.stringify(broken.fields.sidebarAffected.degraded).slice(0, 200))
ok('★ 每个字段的 provenance 在 degraded 时也保留（能指回来源）',
  REQUIRED.every((id) => broken.fields[id] && broken.fields[id].provenance === spec.find((x) => x.id === id).provenance),
  '')
installHealthyDom()
ok('★ collect() 里确实挂了 subsystems 段（默认上报/一键上报同一份）',
  !!(T.collect().subsystems && T.collect().subsystems.fields && T.collect().subsystems.fields.video),
  'at=' + T.collect().at)

if (ONLY_A) { cleanup(); console.log(`\n[--only-a] A 段结果: ${pass} 通过, ${fail} 失败`); process.exit(fail ? 1 : 0) }

console.log('\n== B. 一键发送：POST /diag 拿落点；宿主不可用 ⇒ 下载 JSON ==')
/* _stub 只能装载一次（它给 globalThis 打桩）⇒ 这里改**换 globalThis.fetch**，
   模块内的 `fetch(...)` 在调用时解析全局 ⇒ 走的就是生产那条路径。 */
const realFetch = globalThis.fetch
const sentBodies = []
/* B1: 宿主正常 */
globalThis.fetch = async (url, o) => {
  sentBodies.push({ url: String(url), body: o && o.body ? JSON.parse(o.body) : null })
  return { ok: true, status: 200, json: async () => ({ ok: true, file: '/tmp/fake/diag-123.json' }) }
}
{
  const r = await T.send('test')
  ok('★ 发送成功时带回宿主落点（file）', r.ok === true && /diag-123\.json$/.test(String(r.file)), JSON.stringify(r).slice(0, 160))
  const sent = sentBodies[sentBodies.length - 1]
  ok('★ 发出去的 payload 里带 subsystems + 每个字段的 provenance',
    !!(sent && sent.body && sent.body.subsystems && sent.body.subsystems.fields && Object.values(sent.body.subsystems.fields).every((f) => f.provenance)),
    sent ? `字段 ${Object.keys(sent.body.subsystems.fields).length} 个 / why=${sent.body.why}` : '(没抓到 /diag 请求)')
  ok('★ payload 带 why 标记（人工 vs 自动可区分）', !!(sent && sent.body && sent.body.why), String(sent && sent.body && sent.body.why))
}
/* B2: 宿主不可用（fetch 抛错）⇒ 必须下载 JSON（离线可用） */
const clicks = []
{
  globalThis.fetch = async () => { throw new Error('host-unreachable') }
  const origCreate = document.createElement.bind(document)
  document.createElement = (tag) => { const el = origCreate(tag); if (tag === 'a') el.click = () => clicks.push({ name: el.download, href: el.href }); return el }
  globalThis.Blob = class { constructor(parts) { this.size = String((parts && parts[0]) || '').length } }
  globalThis.URL.createObjectURL = () => 'blob:mpw-fake'
  globalThis.URL.revokeObjectURL = () => {}
  const r = await T.manual()
  ok('★ 宿主不可用时自动改走**下载 JSON**（离线兜底）', r.ok === false && r.download && r.download.ok === true && /^mpw-diag-.*\.json$/.test(String(r.download.name)),
    JSON.stringify({ error: r.error, download: r.download }).slice(0, 200))
  ok('★ 下载确实触发了 <a download>（文件名/URL 对）', clicks.length === 1 && /^mpw-diag-.*\.json$/.test(clicks[0].name) && clicks[0].href === 'blob:mpw-fake',
    JSON.stringify(clicks).slice(0, 160))
  ok('★ 下载的字节数与 payload 一致（非空）', Number(r.download.bytes) > 1000, 'bytes=' + r.download.bytes)
}
/* B3: 宿主 500 ⇒ 也走下载 */
{
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({ ok: false, error: 'disk-full' }) })
  const r = await T.manual()
  ok('★ 宿主 500（写盘失败）也走下载兜底', r.ok === false && r.download && r.download.ok === true && /host-500/.test(String(r.error)),
    JSON.stringify({ error: r.error, dl: r.download && r.download.name }).slice(0, 160))
}
globalThis.fetch = realFetch

console.log('\n== C. 上限：客户端单份字节上限 + 宿主目录数量/字节双上限 ==')
{
  const T3 = globalThis.__mpwDiagTest
  ok('★ 客户端上限常量存在且被暴露（测试用）', Number(T3.maxBytes) > 0, 'MPW_DIAG_MAX_BYTES=' + T3.maxBytes)
  // C1: 小 payload 不动
  const small = { at: 'x', note: 'y' }
  const r1 = T3.fit(JSON.parse(JSON.stringify(small)), 4096)
  ok('★ 未超限时不改动 payload（truncated=null）', r1.truncated === null && !r1.data.truncated, 'bytes=' + r1.bytes)
  // C2: 超限 ⇒ 先砍可选段（groups/thumbSources）
  const big = { at: 'x', groups: { a: 'g'.repeat(30000) }, thumbSources: new Array(500).fill({ k: 'x'.repeat(50) }), keep: 'must-stay' }
  const r2 = T3.fit(big, 4096)
  ok('★ 超限时先砍可选段（groups/thumbSources）并留 truncated 标记',
    r2.data.truncated && r2.data.truncated.reason === 'payload-over-cap' && !('groups' in r2.data) && !('thumbSources' in r2.data),
    JSON.stringify(r2.data.truncated || null).slice(0, 200))
  ok('★ 砍完仍在 cap 内 且**必需字段没被丢**', r2.bytes <= 4096 && r2.data.keep === 'must-stay', `bytes=${r2.bytes} / cap=4096`)
  // C3: 超大字符串字段 ⇒ 截断（保结构、保字段名）
  const r3 = T3.fit({ at: 'x', huge: 'z'.repeat(200000), keep: 'k' }, 8192)
  ok('★ 还超时截断超长字符串字段（保字段名 + 标注 [truncated]）',
    r3.bytes <= 8192 && typeof r3.data.huge === 'string' && /\[truncated\]$/.test(r3.data.huge) && r3.data.keep === 'k',
    `bytes=${r3.bytes} / huge.len=${String(r3.data.huge || '').length} / truncated=${JSON.stringify(r3.data.truncated || null)}`)
  // C4: 上限是**单份**的；真实 payload 远小于上限（留出余量证明默认档不会触发瘦身）
  const real = T3.fit(T3.collect(), T3.maxBytes)
  ok('★ 真实 payload 远小于 cap（默认档不触发瘦身）', real.truncated === null && real.bytes < T3.maxBytes / 4, `${real.bytes} B / cap ${T3.maxBytes} B`)
}
/* C5: 宿主 diag 目录：数量 + 合计字节双上限、最旧先删（调 index.js 的真实现） */
{
  const lim = hostTest.limits
  const idxSrc = fs.readFileSync(path.join(repoRoot, 'lib', 'index.js'), 'utf8')
  ok('★ 宿主端双上限常量在（数量 + 字节）', lim.DIAG_KEEP > 0 && lim.DIAG_MAX_BYTES > 0, `KEEP=${lim.DIAG_KEEP} / MAX_BYTES=${lim.DIAG_MAX_BYTES}（本用例用 env 压到 2MB 做行为验证）`)
  ok('★ 出厂默认上限是 50 个 / 32MB（静态断言，防被 env 覆盖掩盖）',
    /DSH_WE_DIAG_KEEP',\s*50\)/.test(idxSrc) && /DSH_WE_DIAG_MAX_BYTES',\s*32 \* 1024 \* 1024\)/.test(idxSrc),
    (idxSrc.match(/const DIAG_KEEP = [^;]+;/) || [''])[0] + ' | ' + (idxSrc.match(/const DIAG_MAX_BYTES = [^;]+;/) || [''])[0])
  const mk = (n, bytes) => {
    const t = 1700000000000 + n
    const f = path.join(diagDir, 'diag-' + t + '.json')
    fs.writeFileSync(f, 'x'.repeat(bytes))
    fs.utimesSync(f, new Date(t), new Date(t))
    return f
  }
  for (const f of fs.readdirSync(diagDir)) fs.rmSync(path.join(diagDir, f), { force: true })
  // 数量超限：写 KEEP+7 个 1KB 文件
  const names = []
  for (let i = 0; i < lim.DIAG_KEEP + 7; i++) names.push(path.basename(mk(i, 1024)))
  const r = hostTest.pruneDiagDir('测试-数量')
  const left = fs.readdirSync(diagDir).sort()
  ok('★ 数量上限：清理后 ≤ DIAG_KEEP', left.length <= lim.DIAG_KEEP, `剩 ${left.length} 个（上限 ${lim.DIAG_KEEP}），删了 ${r.removed} 个`)
  ok('★ 最旧先删（保留下来的都是最新的）', names.slice(-lim.DIAG_KEEP).every((n) => left.includes(n)) && !left.includes(names[0]),
    `保留了最新的 ${lim.DIAG_KEEP} 个；最旧的 ${names[0]} 已删=${!left.includes(names[0])}`)
  // 字节超限：2 个各 0.6×MAX 的文件 ⇒ 必须删到 ≤ MAX
  for (const f of fs.readdirSync(diagDir)) fs.rmSync(path.join(diagDir, f), { force: true })
  const half = Math.floor(lim.DIAG_MAX_BYTES * 0.6)
  mk(1000, half); mk(2000, half)
  const r2 = hostTest.pruneDiagDir('测试-字节')
  const total = fs.readdirSync(diagDir).reduce((s, n) => s + fs.statSync(path.join(diagDir, n)).size, 0)
  ok('★ 字节上限：清理后合计 ≤ DIAG_MAX_BYTES', total <= lim.DIAG_MAX_BYTES, `剩 ${(total / 1048576).toFixed(2)} MB（上限 ${(lim.DIAG_MAX_BYTES / 1048576).toFixed(0)} MB），删了 ${r2.removed} 个`)
  ok('★ 字节超限时也是最旧先删', fs.readdirSync(diagDir).length === 1 && fs.readdirSync(diagDir)[0] === 'diag-1700000002000.json',
    fs.readdirSync(diagDir).join(','))
  // 不碰非 diag-*.json 的文件
  fs.writeFileSync(path.join(diagDir, 'custom-dir.json'), 'x'.repeat(2048))
  hostTest.pruneDiagDir('测试-只认 diag 模式')
  ok('★ 只清理 diag-<数字>.json，不碰同目录其它文件', fs.existsSync(path.join(diagDir, 'custom-dir.json')), '')
  for (const f of fs.readdirSync(diagDir)) fs.rmSync(path.join(diagDir, f), { force: true })
}

/* ── D. 分辨力自证 ── */
if (NO_MUT) { cleanup(); console.log(`\n[子进程] 结果: ${pass} 通过, ${fail} 失败（跳过 D 段：变异子进程不再嵌套）`); process.exit(fail ? 1 : 0) }
console.log('\n== D. 分辨力自证：把"不静默省略 / 上限 / 字段表"改坏必须变红 ==')
const MUTS = [
  {
    id: 'degraded-swallowed', expect: 'A',
    why: '把字段级包装改成"读不到就 return null 丢掉 degraded"（= 静默省略）',
    from: 'return Object.assign({ value: null, degraded: { reason: String((e && e.message) || e).slice(0, 200), kind: "throw", partial: __mpwDiagIssues.slice(0, 8) } }, base);',
    to: 'return null;',
  },
  {
    id: 'field-removed', expect: 'A',
    why: '从字段表里删掉 video 子系统（brief 点名要求"视频解码状态"）',
    from: '{ id: "video", provenance: "#mpw-bgVideo 的 readyState',
    to: '{ id: "video__renamed", provenance: "#mpw-bgVideo 的 readyState',
  },
  {
    id: 'cap-disabled', expect: 'C',
    why: '把单份 payload 字节上限关掉（mpwDiagFit 直接原样返回 ⇒ 不再瘦身）',
    from: 'const cap = Number(maxBytes) > 0 ? Number(maxBytes) : MPW_DIAG_MAX_BYTES;',
    to: 'const cap = Number.MAX_SAFE_INTEGER;',
  },
  {
    id: 'cap-marker-dropped', expect: 'C',
    why: '超限时不再写 truncated 标记（= 静默瘦身，用户看不出 payload 被动过）',
    from: 'if (truncated) data.truncated = truncated;',
    to: 'if (false) data.truncated = truncated;',
  },
]
const src = fs.readFileSync(clientPath, 'utf8')
for (const m of MUTS) {
  const mutated = src.replace(m.from, m.to)
  if (mutated === src) { ok(`变异 ${m.id} 注入成功`, false, '注入点没匹配上（源码改了？）'); continue }
  const copy = path.join(tmpRoot, 'mut-' + m.id + '.js')
  fs.writeFileSync(copy, mutated)
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, MPW_DIAG_MUT_CLIENT: copy } })
  const out = (r.stdout || '') + (r.stderr || '')
  const failedA = /✗ ★★? (DOM 类|非 DOM 类|读不到时|brief 点名的|字段表|payload 带|健康 DOM|wallpaper 在)/.test(out)
  const failedC = /✗ ★ (客户端上限常量|未超限时|超限时先砍|砍完仍在|还超时截断|真实 payload)/.test(out)
  const got = failedA ? 'A' : (failedC ? 'C' : (r.status === 0 ? 'PASS' : 'FAIL(其它)'))
  ok(`变异 ${m.id}：期望 ${m.expect} 变红，实际 ${got}`, got === m.expect, `${m.why}  [exit=${r.status}]`)
}

cleanup()
console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail) { console.error('✗ 诊断自证闭环未通过'); process.exit(1) }
console.log('✓ 诊断自证闭环通过：子系统字段带来源、读不到=显式 degraded、一键发送/离线下载、客户端与宿主双侧上限')
