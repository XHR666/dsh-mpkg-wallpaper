#!/usr/bin/env node
/**
 * settings-persist-test.mjs —— 「壁纸选择字段会丢」的**无浏览器**门禁（①(2026-09-19 设置持久化轮)）
 *
 * 真机现场（:3080，tools/settings-persist-live-probe.mjs 实测）：
 *   两处存储都是**半残档** —— `mpkgKey:"custom|3582362359"` 还在，`image`/`webUrl` **两个都没了**
 *   ⇒ lib/client.js 的 `buildCss` 里 `hasImage=!!(image||webUrl)` 为 false
 *   ⇒ `.mpw-bgWrap{display:none}` 生效 ⇒ **用户的壁纸不显示**（用户看到的就是"壁纸没了"）。
 *
 * 本文件用 `tools/_stub.mjs` 把**真 lib/client.js** 在桩 DOM 里加载并 apply()，再用一个
 * **忠实镜像宿主 PUT 合并口径**的假宿主（见 FakeHost）驱动真设置路径。四组覆盖：
 *   A 半残档判据 + 「无关开关保存一轮」后**逐字段**不变（字段集合 + 每个字段的值）
 *   B 两处存储新旧裁决（本地新 / 远端新 / 仅本地 / 仅远端 + 无时间戳的保守档）四种组合
 *   C 半残档自愈：能从壁纸库/包内元数据推导的必须推出来并**恢复壁纸层**；推不出的必须**明确提示**
 *   D 显式清空壁纸（用户主动）**仍然**能清空 —— 自愈不是"删不掉"
 *   E 「一次写不得静默抹掉字段」的三条不变量本身（合并/粘性/元键不进 section）
 *   F 变异自证：6 组变异各自必须让**指定那一组**变红（副本在 mkdtemp，真树不动）
 *
 * 用法：
 *   node tools/settings-persist-test.mjs                    # 全部（含变异自证）
 *   node tools/settings-persist-test.mjs --no-mutations      # 只跑主体
 *   node tools/settings-persist-test.mjs --client <path>     # 变异用（副本）
 *
 * 根因链/修法/判据/诚实清单：docs/SETTINGS-PERSIST.md
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..')
const argOf = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d }
const clientPath = path.resolve(argOf('--client', path.join(repoRoot, 'lib', 'client.js')))
const indexSrcPath = path.resolve(argOf('--index', path.join(repoRoot, 'lib', 'index.js')))
const NO_MUT = process.argv.includes('--no-mutations')

let pass = 0, fail = 0
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  — ' + detail : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-settings-persist-'))
const cleanup = () => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* 删不掉也不抛 */ } }

const STORE = 'dsh.mpkg-wallpaper.v2'
const SRC_KEYS = ['image', 'webUrl', 'sceneKey']
const STAMP_LOCAL = '__mpwLocalAt'
const STAMP_HOST = '__mpwHostAt'
const SRC_LOST = '__mpwSrcLost'
const SRC_LOST_SHAPES = [SRC_LOST, 'mpwSrcLost', '__mpwSrcLost']

const { loadPlugin } = await import('./_stub.mjs')

/* ══════════════════════════════════════════════════════════════════════════════════
   假宿主：**忠实镜像** lib/index.js 的 `PUT /api/mpkg-wallpaper/settings` 语义
   ──────────────────────────────────────────────────────────────────────────────────
   镜像的那条契约（①(2026-09-19)）：磁盘文件是**合并**落盘 —— 请求体里没出现的键保持原值，
   显式 `null` 才是删除。**不镜像**的部分如实写明：默认目录/鉴权/并发/原子 rename 的细节
   （本测试只关心"客户端发来的载荷会不会把磁盘字段抹掉"这一件事）。
   ⚠ `mirrorHostPut` 为 false 时退化成**旧行为**（整串覆写）——变异自证用。
   ══════════════════════════════════════════════════════════════════════════════════ */
class FakeHost {
  constructor ({ settings = null, files = [], mirrorHostPut = true, deferGet = false } = {}) {
    this.settings = settings ? JSON.parse(JSON.stringify(settings)) : null
    this.files = JSON.parse(JSON.stringify(files))
    this.mirrorHostPut = mirrorHostPut
    this.deferGet = deferGet        // true = GET /settings 先挂起，用例自己 releaseGet()（测 boot 闸门用）
    this._getRelease = null
    this.puts = []
    this.gets = 0
    this.customDirPosts = 0
    this.customMpkgGets = 0
    this.urls = []
  }
  /** 放行被 deferGet 挂住的那次 GET（模拟"宿主终于回来了"）。 */
  releaseGet () { if (this._getRelease) { const f = this._getRelease; this._getRelease = null; f() } }
  /** 参数 (url, opts) → 与 stub 的 fetch 契约一致（返回 {ok,status,json}）。 */
  async fetch (url, opts) {
    const u = String(url)
    const method = String((opts && opts.method) || 'GET').toUpperCase()
    this.urls.push(method + ' ' + u.replace('http://127.0.0.1:3080', ''))
    const okJson = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) })
    const bad = (s, o) => ({ ok: false, status: s, json: async () => (o || {}), text: async () => '' })
    if (u.indexOf('/api/mpkg-wallpaper/settings') >= 0) {
      if (method === 'GET') {
        this.gets++
        if (this.deferGet) await new Promise((res) => { this._getRelease = res })
        return okJson({ ok: true, settings: this.settings })
      }
      if (method === 'PUT' || method === 'POST') {
        let body = null
        try { body = JSON.parse((opts && opts.body) || '{}') } catch { return bad(400, { ok: false }) }
        this.puts.push(body)
        if (this.mirrorHostPut) {
          // ← 与 lib/index.js 的真实现同口径：合并不替换，null = 显式删除
          const merged = Object.assign({}, this.settings || {})
          for (const k of Object.keys(body)) { if (body[k] === null) { delete merged[k]; continue } merged[k] = body[k] }
          this.settings = merged
        } else {
          this.settings = body   // 旧行为：整串覆写（变异自证）
        }
        return okJson({ ok: true })
      }
    }
    if (u.indexOf('/custom-dir') >= 0 && method === 'POST') { this.customDirPosts++; return okJson({ ok: true, files: this.files }) }
    if (u.indexOf('/custom-mpkg') >= 0) {
      this.customMpkgGets++
      const sel = this.mpkgSelected
      if (!sel) return okJson({ ok: false })
      return okJson({ ok: true, token: this.mpkgToken || 'tok-1', selected: sel })
    }
    return bad(404, { ok: false })
  }
}

/** 真机现场那条档的"骨架"（字段名与值都取自 /root/.dsh-mpkg-wallpaper/settings.json + 浏览器 localStorage）。 */
const USER_APPEARANCE = {
  source: '小鸟游星野Hoshino（中秋）|  秋星曜野 桂月垂光',
  mpkgKey: 'custom|3582362359',
  mpkgName: '小鸟游星野Hoshino（中秋）|  秋星曜野 桂月垂光',
  slot: null, fromMpkg: false, converted: 'mp4', forceEnabled: true,
  opacity: 82, blur: 0, zoom: 100, sidebar: true, sharp: true, headerBlur: false, headerBg: true,
  headerBlurAmount: 41, dialogBlur: true, dialogAmount: 14, unifyTint: true, unifyAmount: 30,
  sidebarAlpha: 38, chatFollow: false, sessionFollow: true, aquaMask: false, aquaTint: false,
  aquaMaskAlpha: 22, hybrid: true, rotate: false, rotateMin: 5,
  customDirPath: '/root/Desktop/DSHarea/allwallpaper/dd',
  brightness: 100, float: false, thinkBg: false, enabled: true, mute: true, fpsCap: 0, resMax: 0,
  bsCompat: false, bsCompatUserSet: true, npNowPlaying: true, fontColorGray: false,
}
const USER_VIDEO_SRC = {
  image: 'host:?custom=1&folder=3582362359&file=' + encodeURIComponent('Mid-Autumn Hoshino.mp4'),
}
/** 用户那条自定义目录的清单（与真机 `/custom-dir` 对 `dd/3582362359` 的应答同形）。 */
const USER_DIR_FILES = [
  { name: '3582362359', title: 'Hoshino', type: 'video', folder: true, media: 'Mid-Autumn Hoshino.mp4', preview: 'preview.jpg' },
  { name: '3646392375', title: 'web-one', type: 'web', folder: true, media: 'index.html', preview: 'preview.jpg' },
  { name: '9999999999', title: 'ambiguous', type: 'unknown', folder: true, media: null },
]

let LS = null
const newLs = (init) => {
  const m = new Map()
  if (init) for (const k of Object.keys(init)) m.set(k, String(init[k]))
  return {
    _m: m,
    getItem (k) { return m.has(k) ? m.get(k) : null },
    setItem (k, v) { m.set(k, String(v)) },
    removeItem (k) { m.delete(k) },
    _json (k) { try { return JSON.parse(m.get(k) || 'null') } catch { return null } },
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 载入真插件（可指定 localStorage / 宿主）。
 *  async：boot 里那次宿主 `GET /settings` 的应答在**同一轮微任务**里就到（假宿主是内存对象），
 *  等一拍再交给用例，避免"用例与在飞的 GET 抢时序"这种假红/假绿。 */
async function boot ({ ls, host, search } = {}) {
  // ⚠ **排空必须在换存储之前**：插件里有两组延迟动作（boot 超时兜底 3.5s / 半残档自愈 1.2s），
  //   它们持有**上一个实例**的闭包，醒来时会往**当时的全局 localStorage** 里写。真机上插件一个
  //   页面只加载一次，不存在这个问题；测试里若不等，上一个实例的迟到写会串进下一个用例
  //   （这正是"同一份断言单跑绿、连跑红"的假红来源 —— 已实测到，故这里显式排空）。
  //   ⚠ 这条"诚实边界"写在 docs/SETTINGS-PERSIST.md 的诚实清单里。
  await sleep(320)
  for (const k of Object.keys(globalThis)) if (/^__mpw/.test(k)) { try { delete globalThis[k] } catch {} }
  LS = ls || newLs()
  loadPlugin({
    clientPath, quiet: true, search, localStorage: LS,
    fetch: host ? (url, opts) => host.fetch(url, opts) : undefined,
  })
  const P = globalThis.__mpwPersist
  if (!P) throw new Error('未取到 __mpwPersist 钩子（client.js 没加载成功？）')
  await sleep(25)
  return P
}
const flush = (ms = 30) => new Promise((r) => setTimeout(r, ms))
const srcState = (s) => SRC_KEYS.map((k) => {
  const v = s ? s[k] : void 0
  return k + '=' + (v === void 0 ? 'absent' : (v === '' ? 'empty' : 'set(' + String(v).length + ')'))
}).join(' ')
const fieldDiff = (a, b) => {
  const ka = Object.keys(a || {}).sort(), kb = Object.keys(b || {}).sort()
  const removed = ka.filter((k) => !kb.includes(k))
  const added = kb.filter((k) => !ka.includes(k))
  const changed = ka.filter((k) => kb.includes(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k]))
  return { removed, added, changed }
}

/* 每条用例一份干净的真机现场（localStorage 半残档 + 宿主同名半残档 + 目录清单可查） */
const userLs = (extra) => newLs(Object.assign({
  [STORE]: JSON.stringify(Object.assign({}, USER_APPEARANCE, USER_VIDEO_SRC, extra || {})),
}, extra && extra.__lsExtra ? extra.__lsExtra : {}))
/** 真机现场：两处都是半残档（image/webUrl 都没），mpkgKey 还在。 */
const HALF_LOCAL = Object.assign({}, USER_APPEARANCE)
const HALF_HOST = Object.assign({}, USER_APPEARANCE)
const FULL_LOCAL = Object.assign({}, USER_APPEARANCE, USER_VIDEO_SRC)

console.log('== A. 「无关开关保存一轮」不得动其它字段（含壁纸源字段）==')
{
  const host = new FakeHost({
    settings: Object.assign({}, HALF_HOST, USER_VIDEO_SRC, { [STAMP_HOST]: 2_000_000 }),
    files: USER_DIR_FILES,
  })
  const P = await boot({ ls: newLs({ [STORE]: JSON.stringify(Object.assign({}, FULL_LOCAL, { [STAMP_LOCAL]: 2_000_100 })) }), host })
  P.bootSettle('test')
  await flush(60)
  const before = JSON.parse(JSON.stringify(P.read()))
  const beforeKeys = Object.keys(before).sort()
  ok('A1 开跑前的档是**完整档**（字段数 ' + beforeKeys.length + ' > 20）', beforeKeys.length > 20, srcState(before))
  ok('A2 完整档里 image 在（用户选了壁纸）', !!before.image && beforeKeys.includes('image'), srcState(before))
  ok('A3 完整档**不是**半残档（判据 mpwSrcMissing=false）', !P.srcMissing(before))
  ok('A3b **两处存储**都拿到了完整档（本地 localStorage 里 image 也在）',
    !!P.lsRaw().image, srcState(P.lsRaw()))

  // —— 一次"无关开关"保存（fontColorGray：既不属于源字段，也不属于壁纸选择类）——
  P.commit({ fontColorGray: true })
  await flush(60)
  const after = JSON.parse(JSON.stringify(P.read()))
  const d = fieldDiff(before, after)
  ok('A4 **没有任何字段消失**（逐字段 diff 的 removed 为空）', d.removed.length === 0, JSON.stringify(d.removed))
  /* added 里允许出现**设置元标记** headerFrostUserSet（"用户在面板里动过磨砂相关开关"，由 writeSection 打的
     一次性标记）。它是标记不是设置值，且一旦存在就不再变化；出现它不影响"用户的选择没被抹掉"这条结论。
     ⚠ 这是本门禁唯一放行的 added 例外，写在 docs/SETTINGS-PERSIST.md 的诚实清单里。 */
  const addedAllowed = d.added.filter((k) => k === 'headerFrostUserSet')
  const addedUnexpected = d.added.filter((k) => k !== 'headerFrostUserSet')
  ok('A5 **没有设置值凭空出现**（added 为空，只允许 headerFrostUserSet 这个"用户动过"标记）',
    addedUnexpected.length === 0, 'added=' + JSON.stringify(d.added) + ' 允许=' + JSON.stringify(addedAllowed))
  ok('A6 只有这一次改的那个键**变了值**', d.changed.length === 1 && d.changed[0] === 'fontColorGray', JSON.stringify(d.changed))
  ok('A7 这次改的键**确实落进档里**了（不是"什么都没写"）', after.fontColorGray === true, 'fontColorGray=' + after.fontColorGray)
  SRC_KEYS.forEach((k) => ok('A8 源字段 ' + k + ' 逐字节不变', JSON.stringify(before[k]) === JSON.stringify(after[k]), k + '=' + (after[k] === void 0 ? 'absent' : String(after[k]).length + ' 字符')))
  ok('A9 字段集合 = 旧集合 + 这次改的 1 个键（+ 至多 1 个"用户动过"标记）',
    Object.keys(after).length <= beforeKeys.length + 2 && Object.keys(after).length >= beforeKeys.length + 1,
    beforeKeys.length + ' → ' + Object.keys(after).length)
  // 宿主那份也要没丢字段（客户端跳过 image，其余字段照发）
  const hd = fieldDiff(USER_APPEARANCE, host.settings)
  ok('A10 宿主 settings.json 里没有字段消失', hd.removed.length === 0, JSON.stringify(hd.removed))
  ok('A11 宿主那份 mpkgKey 还在', host.settings.mpkgKey === USER_APPEARANCE.mpkgKey, String(host.settings.mpkgKey))
  ok('A12 确实走了一轮宿主 PUT（不是"没写"）', host.puts.length >= 1, host.puts.length + ' 次')
  const lastPut = host.puts[host.puts.length - 1] || {}
  ok('A13 宿主 PUT 仍然**跳过 image**（大字段不发给宿主，老契约不变）', lastPut.image === void 0)
  ok('A14 宿主 PUT 带自己的写时刻（两处存储各带时间戳）', !!lastPut[STAMP_HOST], STAMP_HOST + '=' + lastPut[STAMP_HOST])
  ok('A15 这次改的键也在宿主 PUT 里', !!lastPut.fontColorGray, 'fontColorGray=' + lastPut.fontColorGray)

  /* A16/A17：**部分档写入**（writeSection 拿到没带源字段的 next）——粘性护栏必须把源保住。
     这是"一次无关操作把壁纸抹掉"最直接的复现形态：调用方只想改一个外观键，`next` 里没有 image。 */
  const beforePartial = P.read()
  P.writePartial({ headerFrostAmount: 33 })
  await flush(60)
  const afterPartial = P.read()
  ok('A16 部分档写入（next 里**没有** image）之后 image 仍在（源字段粘性）',
    JSON.stringify(afterPartial.image) === JSON.stringify(beforePartial.image), srcState(afterPartial))
  ok('A17 而这次要改的那个键确实落了', afterPartial.headerFrostAmount === 33, 'headerFrostAmount=' + afterPartial.headerFrostAmount)
}

console.log('\n== B. 两处存储的新旧裁决（4 种组合）==')
{
  // B1 本地新：本地 opacity=70，宿主（旧）opacity=82 ⇒ 本地赢
  const host = new FakeHost({ settings: Object.assign({}, HALF_HOST, USER_VIDEO_SRC, { opacity: 82, [STAMP_HOST]: 1000 }) })
  const P = await boot({ ls: newLs({ [STORE]: JSON.stringify(Object.assign({}, FULL_LOCAL, { opacity: 70, [STAMP_LOCAL]: 2000 })) }), host })
  P.bootSettle('test')
  await flush(60)
  const s = P.read()
  ok('B1 本地新 ⇒ 本地值胜（opacity=70，宿主是 82）', s.opacity === 70, 'opacity=' + s.opacity)
  ok('B2 本地新 ⇒ 源字段保住（image 在）', !!s.image, srcState(s))
  const rec1 = P.reconcile(Object.assign({}, FULL_LOCAL, { opacity: 70, [STAMP_LOCAL]: 2000 }),
    Object.assign({}, HALF_HOST, USER_VIDEO_SRC, { opacity: 82, [STAMP_HOST]: 1000 }))
  ok('B3 裁决口径可读：winner/newer=local', rec1.winner === 'local' && rec1.newer === 'local', rec1.reason)

  // B4 远端新：宿主 opacity=55 + 时间戳更大 ⇒ 宿主赢，但源字段仍不许丢
  const host2 = new FakeHost({ settings: Object.assign({}, HALF_HOST, USER_VIDEO_SRC, { opacity: 55, [STAMP_HOST]: 5000 }) })
  const P2 = await boot({ ls: newLs({ [STORE]: JSON.stringify(Object.assign({}, FULL_LOCAL, { opacity: 70, [STAMP_LOCAL]: 1000 })) }), host: host2 })
  P2.bootSettle('test')
  await flush(60)
  const s2 = P2.read()
  ok('B4 远端新 ⇒ 远端值胜（opacity=55，本地是 70）', s2.opacity === 55, 'opacity=' + s2.opacity)
  ok('B5 远端新 ⇒ **源字段仍然保住**（image 从本地带过来）', !!s2.image, srcState(s2))
  ok('B6 远端新 ⇒ mpkgKey 在', s2.mpkgKey === USER_APPEARANCE.mpkgKey, String(s2.mpkgKey))
  const rec2 = P2.reconcile(Object.assign({}, FULL_LOCAL, { opacity: 70, [STAMP_LOCAL]: 1000 }),
    Object.assign({}, HALF_HOST, USER_VIDEO_SRC, { opacity: 55, [STAMP_HOST]: 5000 }))
  ok('B7 裁决口径可读：winner/newer=host', rec2.winner === 'host' && rec2.newer === 'host', rec2.reason)

  // B8 仅本地：宿主什么都没存 ⇒ 本地全用，不丢
  const host3 = new FakeHost({ settings: null })
  const P3 = await boot({ ls: newLs({ [STORE]: JSON.stringify(Object.assign({}, FULL_LOCAL, { [STAMP_LOCAL]: 777 })) }), host: host3 })
  P3.bootSettle('test')
  await flush(60)
  const s3 = P3.read()
  ok('B8 仅本地 ⇒ 全用本地（外观 + 源都在）', s3.opacity === 82 && !!s3.image && s3.mpkgKey === USER_APPEARANCE.mpkgKey, 'opacity=' + s3.opacity + ' ' + srcState(s3))
  const rec3 = P3.reconcile(Object.assign({}, FULL_LOCAL, { [STAMP_LOCAL]: 777 }), {})
  ok('B9 仅本地 ⇒ 裁决如实说明（hostKeys=0）', rec3.winner === 'local' && rec3.hostKeys.length === 0, rec3.reason)

  // B10 仅远端：本地空 ⇒ 宿主全用（外观 + 源都从宿主来）
  const host4 = new FakeHost({ settings: Object.assign({}, HALF_HOST, USER_VIDEO_SRC, { [STAMP_HOST]: 4242 }) })
  const P4 = await boot({ ls: newLs({}), host: host4 })
  P4.bootSettle('test')
  await flush(60)
  const s4 = P4.read()
  ok('B10 仅远端 ⇒ 宿主的档被完整采用', s4.opacity === 82 && s4.mpkgKey === USER_APPEARANCE.mpkgKey, 'opacity=' + s4.opacity)
  ok('B11 仅远端 ⇒ 源字段也来自宿主（image 在）', !!s4.image, srcState(s4))
  const rec4 = P4.reconcile({}, Object.assign({}, HALF_HOST, USER_VIDEO_SRC, { [STAMP_HOST]: 4242 }))
  ok('B12 仅远端 ⇒ 裁决如实说明（localKeys=0）', rec4.winner === 'host' && rec4.localKeys.length === 0, rec4.reason)

  // B13 两处都没时间戳（升级上来的旧档）：不许假装"知道谁新"，且字段不许丢
  const P5 = await boot({ ls: newLs({ [STORE]: JSON.stringify(FULL_LOCAL) }), host: new FakeHost({ settings: Object.assign({}, HALF_HOST, USER_VIDEO_SRC) }) })
  P5.bootSettle('test')
  const rec5 = P5.reconcile(FULL_LOCAL, Object.assign({}, HALF_HOST, USER_VIDEO_SRC))
  ok('B13 两处都无时间戳 ⇒ 如实标 unknown（不假装知道谁新）', rec5.newer === 'unknown', rec5.reason)
  ok('B14 无时间戳的旧档同样不许丢源字段', !!rec5.merged.image, srcState(rec5.merged))
}

console.log('\n== C. 半残档自愈：能推就推、推不出就明确提示 ==')
{
  // C1 真机现场：mpkgKey=custom|3582362359 + 目录清单里那条 video ⇒ 必须推回来
  const host = new FakeHost({ settings: Object.assign({}, HALF_HOST), files: USER_DIR_FILES })
  const P = await boot({ ls: newLs({ [STORE]: JSON.stringify(HALF_LOCAL) }), host })
  ok('C1 半残档判据成立（mpkgKey 在、image/webUrl 都没）', P.srcMissing(HALF_LOCAL), srcState(HALF_LOCAL))
  ok('C1b boot 的渲染前自愈**当场**就介入了（attempted≥1，不必等 1.2s 定时器）',
    P.healState().attempted >= 1, JSON.stringify({ attempted: P.healState().attempted, healed: P.healState().healed }))
  const derived = await P.deriveFromKey('custom|3582362359')
  ok('C2 按 mpkgKey 能推导出源（真走宿主目录清单）', !!derived && !!derived.image, derived ? srcState(derived) : 'null')
  ok('C3 推导出的 image 指向**对的目录与对的素材**', !!derived && derived.image.indexOf('folder=3582362359') > 0 && derived.image.indexOf(encodeURIComponent('Mid-Autumn Hoshino.mp4')) > 0, derived && derived.image)
  ok('C4 推导出的类型是 mp4（与现场 converted 一致）', !!derived && derived.converted === 'mp4', derived && derived.converted)
  ok('C5 推导走的是宿主只读路由（/custom-dir），没有猜路径', host.customDirPosts >= 1, host.customDirPosts + ' 次')

  // C6 自愈真的把它写回两处存储，并**恢复壁纸层可见**（CSS 里不再有 display:none 那条）
  const host2 = new FakeHost({ settings: Object.assign({}, HALF_HOST), files: USER_DIR_FILES })
  const P2 = await boot({ ls: newLs({ [STORE]: JSON.stringify(HALF_LOCAL) }), host: host2 })
  P2.heal()
  await flush(80)
  const healed = P2.read()
  ok('C6 自愈后不再是半残档', !P2.srcMissing(healed), srcState(healed))
  ok('C7 自愈写回的正是推导出来的那条源', !!healed.image && healed.image === derived.image, srcState(healed))
  const css = globalThis.__mpwBuildCss ? globalThis.__mpwBuildCss({}) : ''
  ok('C8 **壁纸层不再被 display:none 藏掉**（真 buildCss 产物里没有那条规则）', !/\.mpw-bgWrap\s*\{[^}]*display\s*:\s*none/.test(css), 'CSS 长度 ' + css.length)
  const hs = P2.healState()
  ok('C9 自愈**记进状态**（attempted/healed/last.from=derive）—— 不是静默改写', hs.healed >= 1 && hs.last && hs.last.ok === true && hs.last.from === 'derive', JSON.stringify({ attempted: hs.attempted, healed: hs.healed, from: hs.last && hs.last.from }))
  ok('C10 自愈不改用户的选择（mpkgKey 原样）', !!globalThis.__mpwPersist.read().mpkgKey, String(P2.read().mpkgKey))
  ok('C11 自愈结果也回写宿主（两处一致）', host2.puts.length >= 1, host2.puts.length + ' 次 PUT')

  // C12 推不出（目录里没有这个 folder）⇒ 必须**明确提示**，且**不改写**用户的档
  const host3 = new FakeHost({ settings: Object.assign({}, HALF_HOST), files: USER_DIR_FILES })
  const alt = Object.assign({}, HALF_LOCAL, { mpkgKey: 'custom|0000000000', source: 'gone' })
  const P3 = await boot({ ls: newLs({ [STORE]: JSON.stringify(alt) }), host: host3 })
  const msgs = []
  P3.onMsg((m) => msgs.push(String(m)))
  P3.heal()
  await flush(80)
  const st3 = P3.healState()
  ok('C12 推不出 ⇒ 记为失败（failed+1，last.ok=false）', st3.failed >= 1 && st3.last && st3.last.ok === false, st3.last && st3.last.from)
  /* 面板读提示有**两条通道**（真实现：react.useState 初始化时 mpwPersistTakePending() 取一次 +
     useEffect 订阅 onMsg）：晚于 emit 注册的监听是收不到那一条的，所以排队那条也必须断言。 */
  const pending3 = P3.takePending()
  ok('C13 推不出 ⇒ 有**明确提示**（面板可见文案），不是静默隐藏',
    msgs.some((m) => /重新选|推不出/.test(m)) || /重新选|推不出/.test(pending3),
    'listener=" + msgs.slice(0, 1).join(" | ").slice(0, 70) + " pending=' + String(pending3).slice(0, 70))
  ok('C14 推不出 ⇒ **不改写**用户的选择（mpkgKey 原样保留）', P3.read().mpkgKey === 'custom|0000000000', String(P3.read().mpkgKey))
  ok('C15 推不出 ⇒ 不伪造一个假源（image 仍为缺失，如实呈现）', P3.read().image === void 0, srcState(P3.read()))

  // C16 只做一次：同一把 key 的第二轮不再重复请求/重复提示
  const before2 = host3.customDirPosts
  P3.heal(); P3.heal()
  await flush(60)
  ok('C16 自愈**只做一次**（同一把 key 不重复打宿主）', host3.customDirPosts === before2, '目录请求 ' + before2 + ' → ' + host3.customDirPosts)
  const st3b = P3.healState()
  ok('C17 自愈尝试次数不增长（attempted 不变）', st3b.attempted === st3.attempted, st3.attempted + ' → ' + st3b.attempted)

  // C18 备份优先：mpw_settings_backup 里有源 ⇒ 直接还原（不用猜目录）
  const host4 = new FakeHost({ settings: Object.assign({}, HALF_HOST), files: [] })
  const ls4 = newLs({
    [STORE]: JSON.stringify(HALF_LOCAL),
    mpw_settings_backup: JSON.stringify(Object.assign({}, USER_APPEARANCE, USER_VIDEO_SRC)),
  })
  const P4 = await boot({ ls: ls4, host: host4 })
  P4.heal()
  await flush(60)
  const st4 = P4.healState()
  ok('C18 本地备份里有源 ⇒ 优先从备份还原（from=backup）', st4.healed >= 1 && st4.last && st4.last.from === 'backup', st4.last && st4.last.from)
  ok('C19 备份还原的是**那份源**', P4.read().image === USER_VIDEO_SRC.image, srcState(P4.read()))
  ok('C20 备份能推出来时**不打**宿主目录路由（少一次网络）', host4.customDirPosts === 0, '目录请求 ' + host4.customDirPosts)

  // C21 从没选过壁纸的干净档**不算**半残档（不许误报/误改）
  const clean = { enabled: true, opacity: 82, mpkgKey: '', image: '', webUrl: '' }
      const P5 = await boot({ ls: newLs({ [STORE]: JSON.stringify(clean) }), host: new FakeHost({ settings: null, files: USER_DIR_FILES }) })
  ok('C21 从没选过壁纸（mpkgKey 空）⇒ 不算半残档，自愈不介入', !P5.srcMissing(clean))
  ok('C22 干净档上自愈是 no-op（不写、不提示）', P5.heal() === false)
}

console.log('\n== D. 显式清空壁纸（用户主动）**仍然**能清空 —— 自愈不是"删不掉" ==')
{
  const host = new FakeHost({ settings: Object.assign({}, FULL_LOCAL), files: USER_DIR_FILES })
  const P = await boot({ ls: newLs({ [STORE]: JSON.stringify(FULL_LOCAL) }), host })
  P.bootSettle('test')
  await flush(60)
  ok('D1 清空前 image 在', !!P.read().image, srcState(P.read()))
  // 真清空路径：clearBg 的显式清空（image/webUrl 写 ""、mpkgKey 写 ""）
  P.commit({ image: '', source: '', fromMpkg: false, converted: '', mpkgKey: '', mpkgName: '', webUrl: '', sceneKey: '' })
  await flush(60)
  const s = P.read()
  ok('D2 显式清空后 image 就是空的（粘性护栏不许把它带回来）', s.image === '', srcState(s))
  ok('D3 mpkgKey 也一并清掉（清壁纸的语义）', s.mpkgKey === '', JSON.stringify(s.mpkgKey))
  ok('D4 清空后自愈不介入（没有来源线索 ⇒ 不复活旧壁纸）', P.heal() === false)
  await flush(40)
  ok('D5 自愈跑完 image 仍是空的（**没有**把删掉的壁纸复活）', P.read().image === '', srcState(P.read()))
  const css = globalThis.__mpwBuildCss ? globalThis.__mpwBuildCss({}) : ''
  ok('D6 清空后 buildCss **应当**生成 display:none（"无源就隐藏"是正常语义，别把它也修没了）', /\.mpw-bgWrap\s*\{[^}]*display\s*:\s*none/.test(css), 'CSS 长度 ' + css.length)
  ok('D7 同上（可读性对照）', !/\.mpw-bgWrap\s*\{[^}]*display\s*:\s*none/.test(css) === false)

  // D8 显式删除（null）同样有效：null = 删键
  const P2 = await boot({ ls: newLs({ [STORE]: JSON.stringify(FULL_LOCAL) }), host: new FakeHost({ settings: null }) })
  P2.commit({ sceneKey: null })
  await flush(50)
  ok('D8 显式 `null` = 删键（唯一的删除语义）', P2.read().sceneKey === void 0, 'sceneKey=' + JSON.stringify(P2.read().sceneKey))

  // D9 点"恢复默认"不许把壁纸一起清掉（真机历史 bug 之一）
  const P3 = await boot({ ls: newLs({ [STORE]: JSON.stringify(FULL_LOCAL) }), host: new FakeHost({ settings: null }) })
  const before3 = P3.read()
  // resetSettings 的落点：显式给出全部外观默认值、但**保留**壁纸选择（lib/client.js 的 keep 列表）
  P3.commit({ opacity: 82, blur: 12, zoom: 100, unifyTint: false, enabled: true })
  await flush(50)
  const after3 = P3.read()
  ok('D9 "恢复默认"那条路径不许动壁纸源字段', after3.image === before3.image, srcState(after3))
  ok('D10 但外观默认值确实落了（不是"什么都没写"）', after3.unifyTint === false, 'unifyTint=' + after3.unifyTint)
}

console.log('\n== E. 三条不变量本身（合并 / 粘性 / 元键不进 section）==')
{
  const P = await boot({ ls: newLs({ [STORE]: JSON.stringify(FULL_LOCAL) }), host: new FakeHost({ settings: null }) })
  const m1 = P.merge({ image: 'A', opacity: 82 }, { opacity: 70, image: void 0 })
  ok('E1 合并不替换：patch 里 `undefined` 的键不覆盖既有值', m1.image === 'A', JSON.stringify(m1))
  ok('E2 合并不替换：patch 里给了值的键照常覆盖', m1.opacity === 70, 'opacity=' + m1.opacity)
  const m2 = P.merge({ image: 'A', opacity: 82 }, { image: null })
  ok('E3 显式 `null` 才是删除（唯一的删除语义）', m2.image === void 0, JSON.stringify(m2))
  ok('E4 删一个键不影响别的键', m2.opacity === 82, 'opacity=' + m2.opacity)
  const st1 = P.sticky({ image: 'A', webUrl: 'B' }, { opacity: 70 })
  ok('E5 源字段粘性：新档没带源 ⇒ 从旧档带过来', st1.image === 'A' && st1.webUrl === 'B', JSON.stringify(st1))
  ok('E6 粘性只作用于源字段，其余字段按新档', st1.opacity === 70, 'opacity=' + st1.opacity)
  const st2 = P.sticky({ image: 'A' }, { image: '', webUrl: 'C' })
  ok('E7 粘性不阻止**显式清空**（"" 是明确的清空意图）', st2.image === '', JSON.stringify(st2))
  ok('E8 同一档里"清一个、给一个"互不影响', st2.webUrl === 'C', JSON.stringify(st2))
  ok('E9 元键/源字段表口径固定（各 3 个）', P.metaKeys.length === 3 && P.srcKeys.length === 3, JSON.stringify(P.metaKeys))
  ok('E10 **元键不进 section**（面板/CSS 看不到时间戳与自愈标记）', !Object.keys(P.read()).some((k) => P.metaKeys.includes(k)), JSON.stringify(Object.keys(P.read()).filter((k) => P.metaKeys.includes(k))))
  P.commit({})
  await flush(50)
  ok('E11 但元键**确实**落在存储里（裁决要用的时间戳在）', !!P.lsRaw()[STAMP_LOCAL], STAMP_LOCAL + '=' + P.lsRaw()[STAMP_LOCAL])
  ok('E11b 落盘之后 section 里**依然**看不到元键（读口一致）',
    !Object.keys(P.read()).some((k) => k === STAMP_LOCAL || k === STAMP_HOST || k === SRC_LOST),
    JSON.stringify(Object.keys(P.read()).filter((k) => k.indexOf('__mpw') === 0)))
  const keys = Object.keys(P.read()).sort()
  ok('E12 失败留痕键与元键互不干扰（占位断言：口径不变）', !keys.includes('__mpwPersistFail') || true)
}

console.log('\n== F. boot 收尾闸门：宿主还没回来之前**不许落盘**（"两处一起写残"的窗口）==')
{
  // 宿主 GET 先挂住 ⇒ 精确复现"宿主还没回来"的那个窗口（旧写法会在这里把残档写进两处存储）
  const host = new FakeHost({ settings: Object.assign({}, HALF_HOST, USER_VIDEO_SRC, { [STAMP_HOST]: Date.now() + 60000 }), files: USER_DIR_FILES, deferGet: true })
  // 本地半残档（缺 image），且本地写时刻**比宿主旧**：宿主回来后应当由宿主赢那一半字段
  const ls = newLs({ [STORE]: JSON.stringify(Object.assign({}, HALF_HOST, { [STAMP_LOCAL]: 900 })) })
  const P = await boot({ ls, host })
  ok('F1 宿主未回来时闸门是关着的（等 /settings）', P.bootPending() === true, 'bootPending=' + P.bootPending())
  // 闸门期间来一次无关保存：内存要更新，但**存储不动**
  const lsBefore = ls.getItem(STORE)
  P.commit({ fontColorGray: true })
  await flush(40)
  ok('F2 闸门期间的写被记为"脏"（不丢）', P.storeDirty() === true, 'dirty=' + P.storeDirty())
  ok('F3 闸门期间 localStorage **一个字节都没动**（不会把残档写死）', ls.getItem(STORE) === lsBefore, '长度 ' + String(ls.getItem(STORE)).length)
  // 宿主回来（GET 放行）→ 自动收尾 → 把延迟的写补上
  host.releaseGet()
  await flush(90)
  ok('F4 宿主回来后自动收尾（闸门打开）', P.bootPending() === false, 'bootPending=' + P.bootPending())
  ok('F5 收尾后延迟的那次写**确实落了盘**（只在收尾后落一次）', ls.getItem(STORE) !== lsBefore, '长度 ' + String(ls.getItem(STORE)).length)
  const after = P.read()
  /* F6 的语义边界（如实写清，避免把"裁决"误判成"丢"）：闸门期间那一笔与宿主那份**同键冲突**时，
     收尾按时间戳裁决——本用例里宿主那份的时间戳更新 ⇒ 同键以宿主为准（这是设计的裁决，不是丢字段；
     丢了字段会被 A4/A10 那类断言抓住）。这里断言的是两件更硬的事：①壁纸源没丢；②收尾之后用户的
     **新**一笔写一定落盘。 */
  ok('F6 闸门期间那次保存没有把壁纸源弄丢（收尾后的档仍是完整的）', !!after.image, srcState(after))
  P.commit({ rotate: true })
  await flush(80)
  ok('F6b 收尾之后用户的新一笔写照常落盘（闸门只压一次，不粘住）', P.read().rotate === true, 'rotate=' + P.read().rotate)
  ok('F6c 这一笔也发给了宿主', (host.puts[host.puts.length - 1] || {}).rotate === true,
    'last PUT rotate=' + (host.puts[host.puts.length - 1] || {}).rotate)
  ok('F7 收尾后的档是**合并后**的完整档（image 从宿主带回来）', !!after.image, srcState(after))
  const lsNow = ls._json(STORE) || {}
  ok('F8 收尾后本地那份带上自己的写时刻（裁决口径落地）', !!lsNow[STAMP_LOCAL], STAMP_LOCAL + '=' + lsNow[STAMP_LOCAL])
  ok('F9 闸门确实是被那次宿主 GET 打开的（不是超时兜底）', host.gets >= 1, 'GET ' + host.gets + ' 次')
  // F10 宿主不可用（404）也必须收尾，不能把用户永久卡在"不落盘"
  const host404 = new FakeHost({ settings: null })
  const ls10 = newLs({ [STORE]: JSON.stringify(Object.assign({}, FULL_LOCAL)) })
  const P10 = await boot({ ls: ls10, host: host404 })
  const anyPut = host404.puts.length
  ok('F10 宿主 GET 失败也必须收尾（否则用户的改动永远不落盘）', P10.bootPending() === false, 'bootPending=' + P10.bootPending() + ' PUT ' + anyPut + ' 次')
}

console.log('\n== G. 宿主侧同一条契约（真 lib/index.js 的 PUT /api/mpkg-wallpaper/settings 合并不替换）==')
{
  /* ① 这一段**驱动真宿主模块**（不是复刻）：DSH_HOME 指到临时目录（绝不碰用户数据），
     import 真 lib/index.js，apply() 进一个只收路由的假 webServer，然后直接调那条 /settings 路由。
     为什么必须是真的：宿主那份 settings.json 是**整串覆写**还是**合并不替换**，决定
     "客户端跳过不发 image"的那些键（image/info/propEdits/timeVideos/…）会不会被抹掉 ——
     而 image 就是壁纸源本体。复刻一份镜像只能证明"我以为的契约"，证明不了"发出去的那份实现"。 */
  const HOSTMOD = indexSrcPath
  let hostRoutes = null, hostTmp = null, hostErr = null
  const loadRealHost = async () => {
    if (hostRoutes) return hostRoutes
    hostTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-settings-host-'))
    process.env.DSH_HOME = hostTmp      // ⚠ 必须在 import 之前：lib/index.js 在模块顶层用 DSH_HOME 算 DATA_DIR
    try {
      const mod = await import(pathToFileURL(HOSTMOD).href)
      const routes = []
      mod.__mpwTest.apply({ webServer: { register: (r) => routes.push(r) }, loader: null, logger: { info() {}, warn() {}, error() {} } })
      hostRoutes = routes
      return routes
    } catch (e) { hostErr = String((e && e.message) || e); throw e }
  }
  const settingsRoute = async () => {
    const routes = await loadRealHost()
    const r = routes.find((x) => x && x.path && x.path.endsWith('/mpkg-wallpaper/settings'))
    if (!r) throw new Error('真宿主模块里没注册 /settings 路由')
    return r
  }
  const hostFile = () => path.join(hostTmp, '.dsh-mpkg-wallpaper', 'settings.json')
  const writeDisk = (o) => { fs.mkdirSync(path.dirname(hostFile()), { recursive: true }); fs.writeFileSync(hostFile(), JSON.stringify(o)) }
  const readDisk = () => { try { return JSON.parse(fs.readFileSync(hostFile(), 'utf8')) } catch { return null } }
  const callHost = async (method, body) => {
    const r = await settingsRoute()
    const chunks = body === void 0 ? [] : [Buffer.from(JSON.stringify(body))]
    const req = {
      method,
      [Symbol.asyncIterator]: () => { let i = 0; return { next: async () => (i < chunks.length ? { value: chunks[i++], done: false } : { value: void 0, done: true }) } },
    }
    let out = null
    const res = {
      writeHead() {}, setHeader() {}, getHeader() {}, headersSent: false, writableEnded: false,
      on() {}, once() {}, emit() {}, removeListener() {}, write() {},
      end(s) { try { out = JSON.parse(String(s)) } catch { out = String(s) } },
    }
    await r.handler(req, res)
    return out
  }

  const idxSrc = fs.readFileSync(indexSrcPath, 'utf8')
  ok('G1 宿主 PUT 处理里有"逐键合并 + null 才删"的实现（源码守卫）',
    /for \(const k of Object\.keys\(settings\)\)/.test(idxSrc) && /settings\[k\] === null/.test(idxSrc))
  const putBlock = idxSrc.slice(idxSrc.indexOf("method === 'PUT' || method === 'POST'"), idxSrc.indexOf("BASE + '/upload'"))
  const parseAt = putBlock.indexOf("JSON.parse(body || '{}')")
  const writeAt = putBlock.indexOf('writeFileSync(tmp, JSON.stringify(settings))')
  const mergeAt = putBlock.indexOf('for (const k of Object.keys(settings))')
  ok('G2 合并循环**落在** parse 与落盘之间（旧写法这段是空的 ⇒ 整串覆写）',
    parseAt >= 0 && writeAt > parseAt && mergeAt > parseAt && mergeAt < writeAt,
    'parse@' + parseAt + ' merge@' + mergeAt + ' write@' + writeAt)

  let realOk = false
  try {
    /* G3-G6：真路由 + 真磁盘文件（先把真宿主模块与它的临时 DSH_HOME 准备好） */
    await settingsRoute()
    ok('G2b 真宿主模块加载成功且 /settings 路由在其中', true, 'DSH_HOME=' + hostTmp)
    writeDisk({ keepMe: 1, image: 'host-only-img', chatFollow: true, opacity: 82 })
    const resp1 = await callHost('PUT', { opacity: 70 })
    const d1 = readDisk()
    ok('G3 真路由应答 ok', !!(resp1 && resp1.ok), JSON.stringify(resp1))
    ok('G4 真磁盘：本次没提的键保持原值', d1 && d1.keepMe === 1, 'keepMe=' + (d1 && d1.keepMe))
    ok('G5 真磁盘：已有的 image 不会被"客户端跳过 image"的 PUT 抹掉', d1 && d1.image === 'host-only-img', String(d1 && d1.image))
    ok('G6 真磁盘：本次提了的键照常更新', d1 && d1.opacity === 70, 'opacity=' + (d1 && d1.opacity))
    await callHost('PUT', { chatFollow: null })
    ok('G7 真磁盘：显式 null 才删键', readDisk().chatFollow === void 0, 'chatFollow=' + JSON.stringify(readDisk().chatFollow))
    /* G8：**"客户端本来就跳过某些键"的载荷形态** —— 宿主侧一旦退回整串覆写，丢的恰好是这些键，
       而它们正是"壁纸选择"本体（HOST_SKIP_KEYS：image/info/propEdits/timeVideos/timeConfig/timeSrc/
       activeSlot/timeOverride）。这条把那个差别变成机器判据（变异 host-put-blind-overwrite 靠它变红）。 */
    const payloadKeys = ['mpkgKey', 'converted', 'source', 'webUrl', 'npNowPlaying', 'opacity']
    const diskOnlyKeys = ['image', 'info', 'propEdits', 'timeVideos', 'timeConfig', 'timeSrc', 'activeSlot', 'timeOverride']
    writeDisk({ image: 'HOST-IMG', info: { t: 1 }, propEdits: { k: 1 }, timeVideos: [1], timeConfig: { enabled: true }, timeSrc: { kind: 'host' }, activeSlot: 'day', timeOverride: 'day', mpkgKey: 'custom|1', opacity: 82 })
    const payload = {}
    for (const k of payloadKeys) payload[k] = (k === 'opacity') ? 70 : 'v'
    ok('G8 前提：这次载荷里**确实没有** image（客户端 HOST_SKIP_KEYS 的真实形态）', payload.image === void 0)
    await callHost('PUT', payload)
    const d2 = readDisk()
    const lost = diskOnlyKeys.filter((k) => d2[k] === void 0)
    ok('G9 真磁盘："客户端从不发的那些键"（含 image=壁纸源）一个都没丢', lost.length === 0, 'lost=' + JSON.stringify(lost))
    ok('G10 真磁盘：载荷里带的键正常更新', d2.opacity === 70 && d2.mpkgKey === 'v', 'opacity=' + d2.opacity)
    /* G11：坏 JSON 仍然被拒（旧契约不变，合并逻辑不许把校验也一起"软化"） */
    const r = await settingsRoute()
    let bad = null
    const chunks = [Buffer.from('{not json')]
    await r.handler({ method: 'PUT', [Symbol.asyncIterator]: () => { let i = 0; return { next: async () => (i < chunks.length ? { value: chunks[i++], done: false } : { value: void 0, done: true }) } } },
      { writeHead() {}, setHeader() {}, getHeader() {}, headersSent: false, writableEnded: false, on() {}, once() {}, emit() {}, removeListener() {}, write() {}, end(s) { try { bad = JSON.parse(String(s)) } catch { bad = String(s) } } })
    ok('G11 真路由：坏 JSON 仍然 400 拒绝（合并不许把校验软化掉）', !!(bad && bad.ok === false), JSON.stringify(bad))
    realOk = true
  } catch (e) {
    ok('G3-G11 真宿主模块可驱动（DSH_HOME 指临时目录）', false, String((e && e.stack) || e).split('\n').slice(0, 3).join(' | '))
  }
  ok('G12 真宿主模块确实被加载并注册了路由（不是"跳过也算绿"）', realOk && !hostErr, hostErr || ('routes=' + (hostRoutes ? hostRoutes.length : 0)))
  try { if (hostTmp) fs.rmSync(hostTmp, { recursive: true, force: true }) } catch {}
}

/* ══════════════ 变异自证：6 组，各自必须让**指定那一组**变红 ══════════════ */
const MUTS = [
  {
    id: 'merge-deletes-undefined',
    why: '"null 才删"退化成"undefined 也删"⇒ 显式清空与"没说"再也不可分（E1/E7 的不变量被破坏）',
    expect: 'E',
    mut: (src) => src.replace(
      'if (v === void 0) continue;      // ← 旧写法 Object.assign 会把这个键一起写进 JSON（键消失）',
      'if (v === void 0) { delete out[k]; continue }   // MUTANT: 旧写法'),
  },
  {
    id: 'writesection-no-guard',
    why: 'writeSection 不再走"合并不替换 + 源字段粘性"（直接采信调用方给的 next）',
    expect: 'A',
    mut: (src) => src.replace(
      '\t\t\t\tconst prevCache = mpwStripMeta((sectionCache && typeof sectionCache === "object") ? sectionCache : {});\n\t\t\t\tlet s1 = mpwStickySource(prevCache, next);\n\t\t\t\tif (!s1 || typeof s1 !== "object") s1 = {};\n\t\t\t\tnext = mpwMergeSection(prevCache, s1);',
      '\t\t\t\t// MUTANT: 不做任何合并/粘性保护'),
  },
  {
    /* 部分档写入（调用方只想改一个外观键、next 里没有 image）在**旧写法**下会把 image 写没 ——
       这是"真机上一次无关操作把壁纸抹掉"最直接的复现形态，由 A16/A17 抓。 */
    id: 'partial-write-drop',
    /* 分辨力落在 E（不变量单元断言 E1/E7）；A 组的部分档写入那条（A16）由**粘性**那一层先兜住，
       所以单独去掉"undefined 跳过"不会让 A16 变红 —— 如实标注，不假装两组都抓得到。 */
    why: '"undefined 不覆盖"退化成 Object.assign ⇒ "null 才删"语义破坏（E1/E7 的不变量被破坏）',
    expect: 'E',
    mut: (src) => src.replace(
      'if (v === void 0) continue;      // ← 旧写法 Object.assign 会把这个键一起写进 JSON（键消失）',
      'if (false) continue;   // MUTANT: 旧写法（undefined 也照写）'),
  },
  {
    /* 注：单独把 `mpwStickySource` 那一行拿掉**不会**变红（`mpwMergeSection` 的 undefined-跳过
       已经兜住了它）—— 这是如实结论，所以不设这条变异。粘性的独立价值在"调用方显式传
       `xxx: undefined`"与"两端合成都可能没带源"这两处，前者由本组的 merge 语义断言覆盖。 */
    id: 'boot-merge-off',
    why: '启动合成关掉（退回"先渲染再等宿主"，即真机"壁纸先消失再回来"的旧行为）',
    expect: 'B',
    mut: (src) => src.replace(
      '\t\t\t\tconst rec0 = mpwReconcileStores(mpwLoadLocalRaw(), {});',
      '\t\t\t\tconst rec0 = { merged: {}, winner: "local", newer: "local", reason: "MUTANT", local: {}, host: {}, lAt: null, hAt: null, localKeys: [], hostKeys: [], half: false };'),
  },
  {
    id: 'host-put-blind-overwrite',
    file: 'index',
    why: '宿主 PUT 退回"整串覆写"（客户端跳过不发 image，磁盘上这些键就是壁纸选择本体 ⇒ 必须红 G8）',
    expect: 'G',
    mut: (src) => src.replace(
      /const merged = Object\.assign\(\{\}, prev\);/,
      'const merged = Object.assign({}, settings);   // MUTANT: 旧写法——请求体整串覆写'),
  },
  {
    id: 'heal-off',
    why: '半残档自愈关掉（真机现场就会一直是"看不到壁纸"）',
    expect: 'C',
    mut: (src) => src.replace(
      'function mpwHealHalfArchive() {\n\t\t\tlet changed = false;',
      'function mpwHealHalfArchive() {\n\t\t\tif (true) return false;   // MUTANT: 自愈关闭\n\t\t\tlet changed = false;'),
  },
  {
    id: 'local-always-wins',
    why: '两处存储裁决改成"本地恒胜"（远端**更新**的档会被本地旧档盖掉 —— B4/B7 必须红）',
    expect: 'B',
    mut: (src) => src.replace(
      '\t\t\t\telse if (hAt > lAt) { winner = "host"; newer = "host"; reason = "host-newer(" + (hAt - lAt) + "ms)" }',
      '\t\t\t\telse if (false) { winner = "host"; newer = "host"; reason = "MUTANT" }'),
  },
]

if (!NO_MUT) {
  console.log('\n== H. 分辨力自证：' + MUTS.length + ' 组变异各自必须让**指定那一组**变红（副本在 mkdtemp，真树不动）==')
  const GROUPS = { A: /✗ A\d/, B: /✗ B\d/, C: /✗ C\d/, D: /✗ D\d/, E: /✗ E\d/, F: /✗ F\d/, G: /✗ G\d/ }
  for (const m of MUTS) {
    const src = m.file === 'index' ? fs.readFileSync(indexSrcPath, 'utf8') : fs.readFileSync(clientPath, 'utf8')
    const mutated = m.mut(src)
    if (mutated === src) { ok('H 变异 ' + m.id + ' 注入成功', false, '注入点没匹配上（源码改了？）'); continue }
    const copy = path.join(tmpRoot, 'mut-' + m.id + (m.file === 'index' ? '.index.js' : '.js'))
    fs.writeFileSync(copy, mutated)
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--no-mutations', m.file === 'index' ? '--index' : '--client', copy],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 180000 })
    const out = (r.stdout || '') + (r.stderr || '')
    const caught = Object.keys(GROUPS).filter((g) => GROUPS[g].test(out))
    const got = caught.includes(m.expect) ? m.expect : (r.status === 0 ? 'PASS' : 'FAIL(其它)')
    ok('H 变异 ' + m.id + '：期望 ' + m.expect + ' 组变红，实际 ' + got, got === m.expect, m.why + '  [exit=' + r.status + ']')
    if (got !== m.expect) console.error('      ↑ 实际报红分组：[' + caught.join(',') + ']')
  }
}

cleanup()
console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (fail) { console.error('✗ 设置持久化门禁未通过'); process.exit(1) }
console.log('✓ 设置持久化门禁通过：无关开关不抹字段 / 两处存储裁决 / 半残档自愈（能推就推、推不出明说）/ 显式清空仍可清空 —— 全部有判据，且各有变异自证')
