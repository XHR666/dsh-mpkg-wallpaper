// tests/pause-refresh-preserve-test.mjs — task-22（P-347）：**video 档「暂停 + 刷新」必须保住壁纸**
//
// 真机现场（用户原话）：「我刚才用 video 类的 MPKG 壁纸，然后我把壁纸暂停掉刷新页面。在设置里面会把壁纸
//   预览图、包括它的名称和内部具体的文件名称都空着掉，然后把壁纸类型变成 image，包括壁纸也没有了，
//   壁纸变成了白屏，然后左上角有一个那个破损照片的图标」。
//
// 归因结论（README/报告里有两次对照读数）：**是 task-21 引入的回归** ✗，不是既有缺陷 ——
//   task-21 的"清空墓碑"只在写动作**带 `image`/`webUrl`** 时才作废，而**视频 MPKG 的导入是
//   "先写身份（`mpkgKey`/`mpkgName`/`source`/`converted`）、转码完才补 `image`"** ⇒ 墓碑活了下来，
//   下一次刷新把 15 个身份字段整批吃掉（面板预览/名称/内部文件名全空、类型兜底成 image、壁纸白屏）。
//   修复：墓碑的作废/生效判据改成"**该档是否带着任何壁纸身份**"（而不是只看 image/webUrl）。
// 附带：`host media 404 → 重试` 那条路原来用 `img.src=""` 做缓存击穿 —— 按 HTML 规范等于"拿文档 URL
//   当图片"，浏览器必然显示**破损图标**；改成查询参数击穿（`_mpwbust`），且只对 http(s) 目标做。
//
// 用法: node tests/pause-refresh-preserve-test.mjs   （纯 Node：真 lib/client.js 跑在插件自带桩 DOM 里）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { WS } from './_root.mjs'

let pass = 0, fail = 0
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')) } else { fail++; console.error('  ✗ ' + n + (d ? '  — ' + d : '')) } }

const CLIENT = path.join(WS, 'dsh-mpkg-wallpaper', 'lib', 'client.js')
const STUB = pathToFileURL(path.join(WS, 'dsh-mpkg-wallpaper', 'tools', '_stub.mjs')).href
const STORE = 'dsh.mpkg-wallpaper.v2'
const { loadPlugin } = await import(STUB)
const CLIENT0 = fs.readFileSync(CLIENT, 'utf8')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** video 类 MPKG 档（= 用户现场的形状：容器身份 + host image token）。 */
const VIDEO = {
  source: 'bgcs_abydos03.mp4', mpkgKey: 'custommpkg|小鸟游星野01_04.mpkg', mpkgName: '小鸟游星野01_04.mpkg',
  fromMpkg: true, converted: 'mp4', image: 'host:?token=t01_04&index=0',
  entryName: 'scene.json', title: '示例', folderName: '9', mpkgFile: 'a.mpkg', srcRoot: 'container', srcDirPath: '/lib',
}
/** 无关设置（暂停/刷新都不许动它们）。 */
const APPEARANCE = { opacity: 82, blur: 0, zoom: 100, enabled: true, headerBg: true, unifyTint: true, mute: true, npLinkWallpaper: true }
const ID_KEYS = ['image', 'webUrl', 'sceneKey', 'source', 'mpkgKey', 'mpkgName', 'entryName', 'converted', 'fromMpkg', 'slot', 'title', 'folderName', 'mpkgFile', 'srcRoot', 'srcDirPath']

const newLs = (init) => { const m = new Map(Object.entries(init || {}).map(([k, v]) => [k, String(v)])); return { _m: m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _json: (k) => { try { return JSON.parse(m.get(k) || 'null') } catch { return null } } } }
const makeHost = (settings) => {
  const h = { settings: settings ? JSON.parse(JSON.stringify(settings)) : null, puts: 0 }
  h.fetch = async (url, opts) => {
    const u = String(url), m = String((opts && opts.method) || 'GET').toUpperCase()
    const okJson = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o), arrayBuffer: async () => new ArrayBuffer(0) })
    if (u.includes('/api/mpkg-wallpaper/settings')) {
      if (m === 'GET') return okJson({ ok: true, settings: h.settings })
      h.puts++; try { h.settings = JSON.parse(String(opts && opts.body)) } catch {}
      return okJson({ ok: true })
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) }
  }
  return h
}
/** 世界（真 lib/client.js + 桩 DOM + 假宿主）。双重加载护栏要求每次载入前排空上一世界。 */
async function boot({ ls, host, clientPath } = {}) {
  await sleep(320)
  for (const k of Object.keys(globalThis)) if (/^__mpw/.test(k)) { try { delete globalThis[k] } catch {} }
  const P = loadPlugin({ clientPath, quiet: true, localStorage: ls, fetch: (u, o) => host.fetch(u, o) })
  await sleep(40)
  const A = globalThis.__mpwPersist
  if (!A) throw new Error('未取到 __mpwPersist 钩子')
  try { A.bootSettle('test') } catch {}
  await sleep(60)
  return { A, P }
}
const rawLocal = (ls) => ls._json(STORE) || {}
/** 身份字段的"逐字节"快照（读**原始存储**：read() 会隐藏记账键，这里比的是用户档本身）。 */
const idSnap = (s) => { const o = {}; for (const k of ID_KEYS) o[k] = s ? s[k] : void 0; return o }
const sameSnap = (a, b) => JSON.stringify(idSnap(a)) === JSON.stringify(idSnap(b))
const pauseWrite = (A) => A.writePartial(Object.assign({}, A.read(), { npPaused: true }))   // `:5996` 的真写形状

/* ══════════════ P. 暂停 + 刷新：身份必须逐字节保留 ══════════════ */
console.log('\n== P. video 档「暂停 ⇒ 刷新」保住壁纸 ==')
// P1/P2：常规路径（两处同档）
{
  const ls = newLs({ [STORE]: JSON.stringify(Object.assign({}, APPEARANCE, VIDEO, { __mpwLocalAt: Date.now() - 5000 })) })
  const host = makeHost(Object.assign({}, APPEARANCE, VIDEO, { __mpwHostAt: Date.now() - 4000 }))
  const W1 = await boot({ ls, host })
  const before = rawLocal(ls)
  ok('P1 前置：video 档身份齐全（否则后面测的是空档）', before.converted === 'mp4' && !!before.mpkgKey && !!before.image, JSON.stringify(idSnap(before)).slice(0, 120))
  pauseWrite(W1.A)             // 用户点"暂停壁纸"（写 npPaused；身份一个字节都不该动）
  await sleep(80)
  const afterPause = rawLocal(ls)
  ok('P2 暂停这一写不碰身份字段（逐字节相同）', sameSnap(before, afterPause))
  const W2 = await boot({ ls, host })
  const after = rawLocal(ls)
  ok('P3 **刷新后身份逐字节保留**（预览/名称/内部文件名不会空）', sameSnap(before, after), JSON.stringify(idSnap(after)).slice(0, 140))
  ok('P4 类型仍是 video（`converted==="mp4"` ⇒ 面板不会兜底成 image）', after.converted === 'mp4')
  ok('P5 暂停意图仍然持久化（既有契约不破）', after.npPaused === true && W2.A.read().npPaused === true)
  ok('P6 无关设置也没被动（8 项逐字段相同）', Object.keys(APPEARANCE).every((k) => JSON.stringify(after[k]) === JSON.stringify(before[k])))
}
// P7/P8：**回归路径**——索引：导入先写身份、转码完才补 image；期间墓碑不许活下来
{
  const T = Date.now()
  const ls = newLs({ [STORE]: JSON.stringify(Object.assign({}, APPEARANCE, VIDEO, { __mpwLocalAt: T })) })
  const host = makeHost(Object.assign({}, APPEARANCE, VIDEO, { __mpwHostAt: T }))
  const W = await boot({ ls, host })
  // ① 用户先"清除壁纸"（立墓碑）
  W.A.writePartial(Object.assign({}, W.A.read(), W.A.clearPatch(T + 1000)))
  await sleep(80)
  ok('P7 前置：清除后墓碑在两处存储里都在', !!rawLocal(ls).__mpwSrcClearedAt && !!host.settings.__mpwSrcClearedAt)
  // ② 再导入一张 video MPKG：**这一步只写身份，`image` 要等转码完成才补**
  const importPatch = { mpkgKey: VIDEO.mpkgKey, mpkgName: VIDEO.mpkgName, source: VIDEO.source, fromMpkg: true, converted: 'mp4' }
  W.A.commit(importPatch)
  await sleep(80)
  const afterImport = rawLocal(ls)
  ok('P8 导入（先写身份、还没有 image）⇒ **墓碑当场作废**（否则下一次刷新会吃掉身份）',
    afterImport.__mpwSrcClearedAt === void 0 && host.settings.__mpwSrcClearedAt === void 0,
    'local=' + afterImport.__mpwSrcClearedAt + ' host=' + host.settings.__mpwSrcClearedAt)
  // ③ 转码完成 → 补 image（真机是异步的）
  W.A.commit({ image: VIDEO.image })
  await sleep(80)
  const beforeRefresh = rawLocal(ls)
  // ④ 暂停 + 刷新
  pauseWrite(W.A); await sleep(60)
  const W2 = await boot({ ls, host })
  const after = rawLocal(ls)
  ok('P9 **该路径刷新后身份仍逐字节保留**（正中靶心的回归判据）', sameSnap(beforeRefresh, after),
    'before=' + JSON.stringify(idSnap(beforeRefresh)).slice(0, 100) + ' after=' + JSON.stringify(idSnap(after)).slice(0, 100))
  ok('P10 类型仍是 video', after.converted === 'mp4')
}
// P11：用户现场形态（**墓碑与身份并存**，= 实时存储的真实读数）——合成不许吃身份
{
  const T = Date.now()
  const ls = newLs({ [STORE]: JSON.stringify(Object.assign({}, APPEARANCE, VIDEO, { __mpwLocalAt: T, __mpwSrcClearedAt: T - 60000 })) })
  const host = makeHost(Object.assign({}, APPEARANCE, VIDEO, { __mpwHostAt: T, __mpwSrcClearedAt: T - 60000 }))
  const W = await boot({ ls, host })
  const rec = W.A.reconcile(rawLocal(ls), host.settings)
  ok('P11 墓碑所在存储仍带身份 ⇒ 视为过期墓碑，**不吃身份**（用户现场就是这个形状）',
    !!rec.merged.image && !!rec.merged.mpkgKey && rec.merged.__mpwSrcClearedAt === void 0,
    JSON.stringify(idSnap(rec.merged)).slice(0, 140))
}
// P16：**用户现场形态下的端到端开机**（墓碑 + 身份并存于两处存储 ⇒ 开机不许吃身份、且墓碑被就地作废）
{
  const T = Date.now()
  const ls = newLs({ [STORE]: JSON.stringify(Object.assign({}, APPEARANCE, VIDEO, { __mpwLocalAt: T, __mpwSrcClearedAt: T - 60000 })) })
  const host = makeHost(Object.assign({}, APPEARANCE, VIDEO, { __mpwHostAt: T, __mpwSrcClearedAt: T - 60000 }))
  const before = rawLocal(ls)
  const W = await boot({ ls, host })
  const after = rawLocal(ls)
  ok('P16 开机后身份逐字节保留 + 过期墓碑在两处都被作废（真机现场形状）',
    sameSnap(before, after) && after.__mpwSrcClearedAt === void 0 && host.settings.__mpwSrcClearedAt === void 0,
    'after=' + JSON.stringify(idSnap(after)).slice(0, 110) + ' 墓碑 local=' + after.__mpwSrcClearedAt + ' host=' + host.settings.__mpwSrcClearedAt)
}

// P12：双向① —— 播放态刷新同样保留（暂停不是前提）
{
  const ls = newLs({ [STORE]: JSON.stringify(Object.assign({}, APPEARANCE, VIDEO, { __mpwLocalAt: Date.now() })) })
  const host = makeHost(Object.assign({}, APPEARANCE, VIDEO, { __mpwHostAt: Date.now() }))
  const W1 = await boot({ ls, host })
  const before = rawLocal(ls)
  const W2 = await boot({ ls, host })
  ok('P12 双向①：播放态刷新身份同样逐字节保留', sameSnap(before, rawLocal(ls)))
  ok('P13 双向②：该档**有源** ⇒ 不该是半残档（不该进"身份缺失"那条告警）', W2.A.srcMissing(W2.A.read()) === false)
}
// P14：双向② —— 清除后仍然"什么都不加载"（与 task-21 契约不冲突）
{
  const ls = newLs({ [STORE]: JSON.stringify(Object.assign({}, APPEARANCE, VIDEO, { __mpwLocalAt: Date.now() })) })
  const host = makeHost(Object.assign({}, APPEARANCE, VIDEO, { __mpwHostAt: Date.now() }))
  const W1 = await boot({ ls, host })
  W1.A.writePartial(Object.assign({}, W1.A.read(), W1.A.clearPatch(Date.now())))
  await sleep(80)
  const W2 = await boot({ ls, host })
  const s = rawLocal(ls)
  ok('P14 双向②：清除后仍无身份 + 不探渲染器（task-21 契约不冲突）',
    ID_KEYS.every((k) => { const v = s[k]; return v === void 0 || v === null || v === '' || v === false }) && W2.A.probeNeeded() === false)
}
// P15：绝不写空 img.src（静态 + 重试路径改成查询击穿）
{
  ok('P15 源码里不存在 `img.src = ""`（空 src 会被浏览器当成"文档 URL 当图片" ⇒ 破损图标）',
    !/img\.src\s*=\s*""/.test(CLIENT0) && /_mpwbust/.test(CLIENT0))
}

// P17：**已受损档的恢复路**——"身份空、image 是 host token"时，迟到裁决必须接受反推结果
//   （旧写法拿 `readSection().mpkgKey` 与派生 key 比 ⇒ 恒不等 ⇒ 派生结果被当"已换档"丢掉，
//     真机：名称/内部文件名一直空、类型一直兜底成 image）。端到端读数见报告（healed=1, from=derive）。
{
  ok('P17 迟到裁决两边做**同一个**反推（`mpkgKey` 为空时用 image token 反推）再比',
    /nowKey = String\(readSection\(\)\.mpkgKey \|\| ""\) \|\| mpwKeyFromImageToken\(readSection\(\)\.image\)/.test(CLIENT0))
}

/* ══════════════ M. 变异自证：期望红集 == 实际红集 ══════════════ */
console.log('\n== M. 变异自证 ==')
/** 把主体判据压成红集，供变异体逐组跑。 */
const SUITE = async (clientPath) => {
  const red = []
  const ex = (id, cond) => { if (!cond) red.push(id) }
  const cli = fs.readFileSync(clientPath, 'utf8')
  try {
    // 暂停 ⇒ 刷新
    const lsA = newLs({ [STORE]: JSON.stringify(Object.assign({}, APPEARANCE, VIDEO, { __mpwLocalAt: Date.now() - 5000 })) })
    const hostA = makeHost(Object.assign({}, APPEARANCE, VIDEO, { __mpwHostAt: Date.now() - 4000 }))
    const W1 = await boot({ ls: lsA, host: hostA, clientPath })
    const before = rawLocal(lsA)
    pauseWrite(W1.A); await sleep(80)
    const W2 = await boot({ ls: lsA, host: hostA, clientPath })
    ex('P3', sameSnap(before, rawLocal(lsA)))
    ex('P4', rawLocal(lsA).converted === 'mp4')
    ex('P5', W2.A.read().npPaused === true)
    // 清除 → 导入（先身份后 image）→ 补 image → 暂停 → 刷新
    const T = Date.now()
    const lsB = newLs({ [STORE]: JSON.stringify(Object.assign({}, APPEARANCE, VIDEO, { __mpwLocalAt: T })) })
    const hostB = makeHost(Object.assign({}, APPEARANCE, VIDEO, { __mpwHostAt: T }))
    const WB = await boot({ ls: lsB, host: hostB, clientPath })
    WB.A.writePartial(Object.assign({}, WB.A.read(), WB.A.clearPatch(T + 1000))); await sleep(80)
    WB.A.commit({ mpkgKey: VIDEO.mpkgKey, mpkgName: VIDEO.mpkgName, source: VIDEO.source, fromMpkg: true, converted: 'mp4' }); await sleep(80)
    ex('P8', rawLocal(lsB).__mpwSrcClearedAt === void 0 && hostB.settings.__mpwSrcClearedAt === void 0)
    WB.A.commit({ image: VIDEO.image }); await sleep(80)
    const beforeRefresh = rawLocal(lsB)
    pauseWrite(WB.A); await sleep(60)
    await boot({ ls: lsB, host: hostB, clientPath })
    ex('P9', sameSnap(beforeRefresh, rawLocal(lsB)))
    // 用户现场形态
    const TC = Date.now()
    const lsC = newLs({ [STORE]: JSON.stringify(Object.assign({}, APPEARANCE, VIDEO, { __mpwLocalAt: TC, __mpwSrcClearedAt: TC - 60000 })) })
    const hostC = makeHost(Object.assign({}, APPEARANCE, VIDEO, { __mpwHostAt: TC, __mpwSrcClearedAt: TC - 60000 }))
    const WC = await boot({ ls: lsC, host: hostC, clientPath })
    const rec = WC.A.reconcile(rawLocal(lsC), hostC.settings)
    ex('P11', !!rec.merged.image && !!rec.merged.mpkgKey && rec.merged.__mpwSrcClearedAt === void 0)
    // 用户现场形态：端到端开机
    const T16 = Date.now()
    const ls16 = newLs({ [STORE]: JSON.stringify(Object.assign({}, APPEARANCE, VIDEO, { __mpwLocalAt: T16, __mpwSrcClearedAt: T16 - 60000 })) })
    const host16 = makeHost(Object.assign({}, APPEARANCE, VIDEO, { __mpwHostAt: T16, __mpwSrcClearedAt: T16 - 60000 }))
    const before16 = rawLocal(ls16)
    await boot({ ls: ls16, host: host16, clientPath })
    ex('P16', sameSnap(before16, rawLocal(ls16)) && rawLocal(ls16).__mpwSrcClearedAt === void 0 && host16.settings.__mpwSrcClearedAt === void 0)
    // 清除后仍"什么都不加载"
    const lsD = newLs({ [STORE]: JSON.stringify(Object.assign({}, APPEARANCE, VIDEO, { __mpwLocalAt: Date.now() })) })
    const hostD = makeHost(Object.assign({}, APPEARANCE, VIDEO, { __mpwHostAt: Date.now() }))
    const WD = await boot({ ls: lsD, host: hostD, clientPath })
    WD.A.writePartial(Object.assign({}, WD.A.read(), WD.A.clearPatch(Date.now()))); await sleep(80)
    const WE = await boot({ ls: lsD, host: hostD, clientPath })
    ex('P14', ID_KEYS.every((k) => { const v = rawLocal(lsD)[k]; return v === void 0 || v === null || v === '' || v === false }) && WE.A.probeNeeded() === false)
    ex('P15', !/img\.src\s*=\s*""/.test(cli) && /_mpwbust/.test(cli))
    ex('P17', /nowKey = String\(readSection\(\)\.mpkgKey \|\| ""\) \|\| mpwKeyFromImageToken\(readSection\(\)\.image\)/.test(cli))
  } catch (e) { red.push('THROW:' + String((e && e.message) || e).slice(0, 60)) }
  return red.slice().sort()
}
const MUT = [
  { name: 'M1 **完整退回 task-21 的墓碑写法**（作废只看 image/webUrl + 合成时无条件吃身份）', expect: ['P8', 'P11', 'P16'],
    mk: (s) => s
      .replace('if (stale && (mpwHasAnyWallpaperIdentity(next) || mpwHasAnyWallpaperIdentity(prevCache))) delete next[MPW_SRC_CLEARED_KEY];', 'if (next && next[MPW_SRC_CLEARED_KEY] !== void 0 && mpwHasRealSource(next)) delete next[MPW_SRC_CLEARED_KEY];')
      .replace('if (mpwHasAnyWallpaperIdentity(clearStore)) {', 'if (false) {') },
  { name: 'M2 合成时墓碑无条件吃身份（不看过期）', expect: ['P11', 'P16'],
    mk: (s) => s.replace('if (mpwHasAnyWallpaperIdentity(clearStore)) {\n\t\t\t\t\ttry { delete merged[MPW_SRC_CLEARED_KEY] } catch {}\n\t\t\t\t} else {', 'if (false) {\n\t\t\t\t\ttry { delete merged[MPW_SRC_CLEARED_KEY] } catch {}\n\t\t\t\t} else {') },
  { name: 'M3 重试路径退回 `img.src=""`（空 src ⇒ 破损图标）', expect: ['P15'],
    mk: (s) => s.replace(/const cur = img\.src;\n\t\t\t\t\t\t\ttry \{[\s\S]*?\} catch \(e\) \{ try \{ img\.src = cur \} catch \(e2\) \{\} \}/, 'const cur = img.src; img.src = ""; img.src = cur;') },
  { name: 'M4 只去掉"写时作废墓碑"那一半（合成侧的兜底还在 ⇒ 只该 P8 红）', expect: ['P8'],
    mk: (s) => s.replace('if (stale && (mpwHasAnyWallpaperIdentity(next) || mpwHasAnyWallpaperIdentity(prevCache))) delete next[MPW_SRC_CLEARED_KEY];', 'if (false) delete next[MPW_SRC_CLEARED_KEY];') },
  { name: 'M5 清除补丁退回旧 9 键表（清不干净）', expect: ['P14'],
    mk: (s) => s.replace('for (const k of MPW_WALLPAPER_ID_KEYS) p[k] = null;', 'for (const k of ["image","webUrl","sceneKey","source","mpkgKey","mpkgName","converted","fromMpkg","slot"]) p[k] = null;') },
  { name: 'M6 迟到裁决退回"只比 mpkgKey"（受损档永远补不回身份）', expect: ['P17'],
    mk: (s) => s.replace('nowKey = String(readSection().mpkgKey || "") || mpwKeyFromImageToken(readSection().image)', 'nowKey = String(readSection().mpkgKey || "")') },
]
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-pause-'))
let mutBad = 0
for (const m of MUT) {
  const p = path.join(tmp, 'client-' + MUT.indexOf(m) + '.js')
  fs.writeFileSync(p, m.mk(CLIENT0))
  const actual = await SUITE(p)
  const expect = m.expect.slice().sort()
  const same = JSON.stringify(actual) === JSON.stringify(expect)
  if (!same) mutBad++
  console.log((same ? '  ✓ ' : '  ✗ ') + m.name)
  console.log('      期望红集 == 实际红集 : ' + (same ? '是' : '否') + '  期望[' + expect.join(',') + ']  实际[' + actual.join(',') + ']')
}
ok('M 全部 ' + MUT.length + ' 个变异体的「期望红集 == 实际红集」', mutBad === 0, '不一致 ' + mutBad + ' 个')
try { fs.rmSync(tmp, { recursive: true, force: true }) } catch {}

console.log('\n' + (fail === 0 ? '✅ PASS' : '❌ FAIL') + '：' + pass + ' 通过 / ' + fail + ' 失败')
process.exit(fail === 0 ? 0 : 1)
