// tools/persist-test.mjs —— 壁纸**刷新不丢**（持久化）回归
//
// 背景（真机 bug，2026-09-17 独立成线）：
//   壁纸 `image` 常以 dataURL 内联进 `STORE_KEY = dsh.mpkg-wallpaper.v2` 的整串 JSON，
//   而 localStorage 单值硬顶 `MPW_LS_MAX_BYTES = 256KB`（超限 `mpwLsSafeSet` **拒写** + 一行
//   console.warn）；宿主 `/settings` 又**明确跳过 image**（HOST_SKIP_KEYS）⇒ 一旦被拒写就
//   没有任何一路保存过这个选择，**刷新后壁纸回默认**。
//   更隐蔽的一半：写侧 `storeImage/storeImageBlob` 把"小图"线写成 **2MB**，于是 dataURL 落在
//   (256KB, 2MB] 的壁纸**两边都不落**——而本机语料实测这一带是**全部**（34/34 个候选，
//   1.30–1.36MB，见 tools/persist-size-scan.mjs）。读侧 `idb:img` 分支只认 Blob，
//   落进去的 dataURL 字符串会被**静默丢弃**（连提示都没有）。
//
// 本测试五组（对应任务书 ③①②④⑤）：
//   PART 1 阈值口径一致：常量只有一处定义 + 值与文档表逐字一致（断言可变红）
//   PART 2 大 dataURL 能持久化，并在"重启/重读"（重新 loadPlugin 同一份 localStorage+IDB）后恢复
//   PART 3 IndexedDB 不可用 ⇒ 行为明确（console.warn + 留痕 + 面板告警），**不静默丢**
//   PART 4 小 dataURL 走原路径（内联 localStorage，完全不碰 IDB）
//   PART 5 变异自证：`?mpwpersist=legacy`（或删掉落 IDB 分支）必须让 PART 2 变红
//
// 用法: node tools/persist-test.mjs [--client <path>]
//   `--client` 指向**修复前**的副本（`git show HEAD:lib/client.js > /tmp/before.js`）：
//   PART 2/3/5 必须变红（修复前没有 __mpwPersist 钩子 ⇒ 钩子缺失即判红，见 part0 守卫）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPlugin } from './_stub.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(here, '..')
const ai = process.argv.indexOf('--client')
const clientPath = ai > 0 ? process.argv[ai + 1] : path.join(ROOT, 'lib', 'client.js')
const src = fs.readFileSync(clientPath, 'utf8')
const DOC = path.join(ROOT, 'docs', 'PERSISTENCE.md')

let pass = 0, fail = 0
const ok = (c, n, d) => { if (c) { pass++; console.log('  ✓ ' + n) } else { fail++; console.error('  ✗ ' + n + (d ? ' → ' + d : '')) } }
const eq = (a, b, n) => ok(a === b, n + (a === b ? '' : `（got=${JSON.stringify(a)} want=${JSON.stringify(b)}）`))
const flush = (ms = 40) => new Promise((r) => setTimeout(r, ms))

/* ═══════════ 极简 IndexedDB 桩（够 idbOpen/idbPut/idbGet/idbDel 用；跨"重载"复用同一份数据） ═══════════ */
function structuredCopy (v) {
  if (v === null || typeof v !== 'object') return v
  try { if (typeof Blob !== 'undefined' && v instanceof Blob) return v } catch {}
  if (Array.isArray(v)) return v.map(structuredCopy)
  const o = {}
  for (const k of Object.keys(v)) o[k] = structuredCopy(v[k])
  return o
}
function newFakeIdb () {
  const stores = new Map([['images', new Map()], ['bgsec', new Map()]])
  const api = {
    open () {
      const db = {
        objectStoreNames: { contains: () => true },
        createObjectStore: () => {},
        transaction (name) {
          const m = stores.get(name) || (stores.set(name, new Map()), stores.get(name))
          const tx = {
            error: null,
            objectStore: () => ({
              put: (value, key) => { m.set(key, structuredCopy(value)); queueMicrotask(() => tx.oncomplete && tx.oncomplete()); return {} },
              get: (key) => { const req = { result: m.has(key) ? structuredCopy(m.get(key)) : undefined, error: null }; queueMicrotask(() => req.onsuccess && req.onsuccess()); return req },
              delete: (key) => { m.delete(key); queueMicrotask(() => tx.oncomplete && tx.oncomplete()); return {} },
            }),
          }
          return tx
        },
      }
      const req = { result: db, error: null, onsuccess: null, onerror: null, onupgradeneeded: null }
      queueMicrotask(() => { try { req.onupgradeneeded && req.onupgradeneeded() } catch {} ; req.onsuccess && req.onsuccess() })
      return req
    },
    _dump: () => stores,
  }
  return api
}

/* ═══════════ 载入真插件（桩 DOM；可指定 settings / search / IDB） ═══════════ */
// ⚠️ **不要**全局替换 console.warn/error：①会吞掉本文件自己的失败输出（✗ 走 console.error）；
//   ②_stub 的 loadPlugin 会临时替换 console.error 再"恢复"到它捕获的那一份 ⇒ 全局替换会被它锁死。
//   需要在某次调用附近抓警告时，用 withWarns() 就地包一层（try/finally 立刻还原）。
const warns = []
async function withWarns (fn) {
  warns.length = 0
  const orig = console.warn
  console.warn = (...a) => { warns.push(a.map((x) => (x && x.message) || String(x)).join(' ')) }
  try { return await fn() } finally { console.warn = orig }
}

/** 一份**跨"重启"复用**的 localStorage 桩（真机刷新时 localStorage 是不清的，IndexedDB 同理）。 */
function newFakeLs () {
  const m = new Map()
  return {
    _m: m,
    getItem (k) { return m.has(k) ? m.get(k) : null },
    setItem (k, v) { m.set(k, String(v)) },
    removeItem (k) { m.delete(k) },
  }
}
let LS = newFakeLs()
/** 钩子缺失（= 跑在**修复前**的源码上）时给一份"空壳"，让本文件跑到最后统一报红，
 *  而不是在第一个 `P.limits` 处抛 TypeError 中断（那样后面对**已被修掉**的代码路径的断言就丢了）。 */
const NO_HOOK = {
  write: async () => '', read: () => ({}), raw: () => null, spill: async (u) => u, idbGet: async () => undefined,
  idbKind: async () => 'none', available: async () => false, legacy: () => false,
  state: () => ({ ok: null, usedIdb: false, reason: '', at: 0, __missing: true }),
  apply: () => 'no-hook', onMsg: () => () => {}, failKey: '__mpwPersistFail', limits: null, key: '',
}
function boot ({ settings, search, idb, freshLs } = {}) {
  for (const k of Object.keys(globalThis)) if (/^__mpw/.test(k)) { try { delete globalThis[k] } catch {} }
  if (freshLs !== false) LS = newFakeLs()   // 默认全新（隔离用例）；重载用例传 freshLs:false
  loadPlugin({ clientPath, settings, quiet: true, search, indexedDB: idb, localStorage: LS })
  return globalThis.__mpwPersist || NO_HOOK
}
const dataUrlOf = (n) => 'data:image/gif;base64,' + 'A'.repeat(Math.max(0, n - 'data:image/gif;base64,'.length))
const LARGE = dataUrlOf(1400 * 1024)   // 与语料实测同量级（1.30–1.36MB dataURL）
const SMALL = dataUrlOf(40 * 1024)

console.log('== PART 0 钩子守卫（修复前无 __mpwPersist ⇒ 本文件整体红）==')
{
  const P = boot({ idb: newFakeIdb() })
  ok(!!P && typeof P.write === 'function', 'window.__mpwPersist 钩子存在（持久化链路可测）')
  ok(!!P && !!P.limits, '钩子暴露阈值常量 limits')
}

console.log('\n== PART 1 阈值口径一致：一处定义 + 与文档表逐字一致 ==')
{
  // ① 常量在 client.js 里只有一处定义（旧代码把 2MB 写死在 storeImage/storeImageBlob/文案三处）
  const defs = src.match(/const\s+MPW_LS_MAX_BYTES\s*=/g) || []
  const defs2 = src.match(/const\s+MPW_LS_SPILL_BYTES\s*=/g) || []
  eq(defs.length, 1, 'MPW_LS_MAX_BYTES 只有一处定义')
  eq(defs2.length, 1, 'MPW_LS_SPILL_BYTES 只有一处定义')
  // 图片阈值不许再有写死的字节数：只允许 `const MPW_LS_SPILL_BYTES = 2 * 1024 * 1024;` 这一处
  // （`mpkg` 容器头的 `HEAD_BYTES = 2 * 1024 * 1024` 是**另一个语义**，不算违规）。
  const spillLines = src.split('\n').filter((l) => /2\s*\*\s*1024\s*\*\s*1024/.test(l))
  const spillBad = spillLines.filter((l) => !/const\s+MPW_LS_SPILL_BYTES\s*=/.test(l) && !/HEAD_BYTES\s*=/.test(l))
  eq(spillBad.length, 0, '图片阈值不再有散落的 "2 * 1024 * 1024"（只允许常量定义那一处）',
    '违规行：' + JSON.stringify(spillBad))
  eq((src.match(/storeImage\s*\(/g) || []).length >= 1 && !/if\s*\(dataUrl\.length\s*<=\s*2\s*\*\s*1024/.test(src), true,
    'storeImage 不再用写死的 2MB 判定')

  // ② 值与文档表逐字一致（docs/PERSISTENCE.md 阈值表 + 五处提到同一对数字）
  const doc = fs.existsSync(DOC) ? fs.readFileSync(DOC, 'utf8') : ''
  ok(!!doc, 'docs/PERSISTENCE.md 存在（阈值表 + 失败降级行为）')
  const P = boot({ idb: newFakeIdb() })
  const L = P.limits || {}
  eq(L.lsMax, 256 * 1024, '运行时 localStorage 单值上限 = 262144 字节')
  eq(L.spill, 2 * 1024 * 1024, '运行时"大图落 IDB"线 = 2097152 字节')
  ok(doc.includes('| `MPW_LS_MAX_BYTES` | 262144 | 256 KB |'), '文档表行：MPW_LS_MAX_BYTES = 262144（256 KB）')
  ok(doc.includes('| `MPW_LS_SPILL_BYTES` | 2097152 | 2048 KB |'), '文档表行：MPW_LS_SPILL_BYTES = 2097152（2048 KB）')
  ok(!/2MB（小图内联）/.test(doc) && !doc.includes('小图（<2MB）直接内联进 localStorage'), '文档不含"2MB 以内可直接内联"的旧口径')
  ok(/256\s*KB/.test(doc) && /2048\s*KB|2\s*MB/.test(doc), '文档同时给出两个口径的**真实值**')
  // 面板文案里的两个数由常量算出（源码级：不得再出现字面量 2048/256 拼在文案里）
  ok(/Math\.round\(MPW_LS_SPILL_BYTES \/ 1048576\)/.test(src) && /Math\.round\(MPW_LS_MAX_BYTES \/ 1024\)/.test(src),
    '面板文案的两个数字由常量算出（不是写死的字符串）')
}

console.log('\n== PART 2 大 dataURL（>256KB）能持久化，重载后恢复 ==')
{
  const idb = newFakeIdb()
  const P = boot({ idb })
  await P.available()
  const json = await withWarns(() => P.write({ enabled: true, image: LARGE, converted: 'gif', source: 'preview.gif', opacity: 82 }))
  const raw = P.raw()
  ok(typeof json === 'string' && json.length > 0, '大图 section 写入返回了实际落盘的 JSON')
  ok(!!raw && raw.length + 160 <= 256 * 1024, 'localStorage 里那一串**在 256KB 上限之内**（旧写法：整串 1.4MB 直接被拒写）',
    'raw.length=' + (raw ? raw.length : 'null'))
  ok(!!raw && raw.includes('"idb:img"'), 'localStorage 里留的是 idb:img 哨兵（而不是 1.4MB 内联 dataURL）')
  eq(await P.idbKind(), 'dataurl', 'IndexedDB 的 bg 格里确实是一份 dataURL（写侧回读校验过）')
  eq((P.state() || {}).usedIdb, true, '持久化状态标记 usedIdb=true（面板据此显示"已存入 IndexedDB"）')

  // —— "重启/重读"：同一份 localStorage + 同一份 IDB，重新走一遍插件 apply ——
  const P2 = boot({ idb, freshLs: false })
  await flush()
  const img = globalThis.document.getElementById('mpw-bgImg')
  if (!(img && img.src === LARGE)) {
    let dbg = ''
    try {
      const v = await P2.idbGet('bg')
      dbg = 'idbGet typeof=' + (typeof v) + ' isBlob=' + (typeof Blob !== 'undefined' && v instanceof Blob)
        + ' srcType=' + (img ? typeof img.src : 'no-img') + ' srcHead=' + (img && img.src ? String(img.src).slice(0, 24) : '(空)')
        + ' state=' + JSON.stringify(P2.state())
    } catch (e) { dbg = 'idbGet 抛错:' + String(e && e.message) }
    console.error('    [诊断] ' + dbg)
  }
  eq(P2.read().image, 'idb:img', '重载后 section 仍是 idb:img 哨兵')
  eq(img && img.src, LARGE, '重载后背景图 img.src 就是原来那张壁纸的 dataURL（刷新不丢）')
  eq((P2.raw() || '').includes(LARGE.slice(0, 40)), false, '重载后 dataURL 仍未回灌 localStorage（不越写上限）')
}

console.log('\n== PART 3 IndexedDB 不可用 ⇒ 明确告警，不静默丢 ==')
{
  const P = boot({})                     // 不给 indexedDB ⇒ 走不可用分支
  eq(await P.available(), false, 'idbAvailable() === false（环境探测正确）')
  const m = await withWarns(() => P.spill(LARGE))
  eq(m, LARGE, '落 IDB 失败时原样返回 dataURL（不返回指向旧内容的假哨兵）')
  eq(P.state().ok, false, '持久化状态 ok=false（调用方可判别）')
  ok((P.state().reason || '').includes('IndexedDB'), '失败原因写明 IndexedDB 不可用：' + P.state().reason)
  ok(warns.some((w) => w.includes('无法持久化') && w.includes('刷新')), 'console.warn 明确说了"刷新后会丢"（不静默）')
  // 真写一次整串：拒写 + 留痕
  const json = await withWarns(() => P.write({ enabled: true, image: LARGE, converted: 'gif' }))
  ok(json.length > 0 && json.length < 4096, '整串写入只留下了**非图片配置**（' + json.length + ' B）：图片存不下，配置不跟着丢')
  ok(!json.includes(LARGE), '返回/落盘的 JSON 里**没有**那条存不下的 dataURL（不假装成功）')
  const raw = P.raw() || ''
  ok(raw.includes(P.failKey), '失败留痕写进了 localStorage（' + P.failKey + '）⇒ 下一次加载能据此告警')
  ok(raw.length < 4096, '留痕本身很小（' + raw.length + ' B），不会把 256KB 预算撑爆')
  // 下一次加载：面板告警通道必须收到一条消息
  const msgs = []
  const P2 = boot({ freshLs: false })   // 同一次"重载"：localStorage 不清（真机刷新语义）
  P2.onMsg((s) => msgs.push(String(s)))
  const raw2 = P2.raw() || ''
  P2.apply()
  await flush()
  if (!msgs.length) console.error('    [诊断] raw2.len=' + raw2.length + ' hasFailKey=' + raw2.includes('__mpwPersistFail') + ' raw2=' + raw2.slice(0, 120))
  ok(msgs.some((s) => s.includes('没有存下来')), '重载时 emit 了"上一次没存下来"的面板告警：' + (msgs[0] || '(无)').slice(0, 60))
  ok(msgs.length > 0 && /mpwPersistEmit/.test(src), '告警通道 = mpwPersistEmit（同时 console.error + 面板，可被 mpwdiag 上报）')
}

console.log('\n== PART 4 小 dataURL 走原路径（内联，不碰 IDB）==')
{
  const idb = newFakeIdb()
  const P = boot({ idb })
  await P.available()
  const json = await withWarns(() => P.write({ enabled: true, image: SMALL, converted: 'gif' }))
  ok(json.includes(SMALL), '小图整串照旧内联进 localStorage（原路径不受影响）')
  eq((P.raw() || '').includes(SMALL), true, 'localStorage 原文里就是内联 dataURL')
  eq(idb._dump().get('images').size, 0, 'IDB 一个字节都没写（没有多余往返）')
  eq(P.state().usedIdb, false, '状态 usedIdb=false（面板不显示降级提示）')
  eq(warns.filter((w) => w.includes('拒绝写入')).length, 0, '没有"拒写"警告')
  // 边界：整串刚好在 256KB 内 → 仍内联
  const nearLimit = dataUrlOf(200 * 1024)
  const P2 = boot({ idb })
  await P2.available()
  const j2 = await P2.write({ enabled: true, image: nearLimit })
  ok(j2.includes(nearLimit) && P2.state().usedIdb === false, '整串 200KB（<256KB）仍走内联路径')
}

console.log('\n== PART 5 变异自证：旧写法必须变红 ==')
{
  // ⑴ 回退开关 ?mpwpersist=legacy = 旧行为（超上限即拒写、不落 IDB）⇒ PART 2 的同一条断言变红
  const P = boot({ idb: newFakeIdb(), search: '?mpwpersist=legacy' })
  eq(P.legacy(), true, '?mpwpersist=legacy 被识别（回退开关接线）')
  const json = await withWarns(() => P.write({ enabled: true, image: LARGE, converted: 'gif' }))
  eq(json, '', 'legacy：整串超上限 → 写入失败（返回空串）')
  eq(P.raw(), null, 'legacy：localStorage 里什么都没写（就是刷新丢壁纸的旧行为）')
  ok(warns.some((w) => w.includes('拒绝写入')), 'legacy：仍有一行"拒绝写入"警告（旧口径本身不静默，只是丢数据）')
  const idb2 = newFakeIdb()
  const P2 = boot({ idb: idb2 })
  await P2.available()
  await P2.write({ enabled: true, image: LARGE })
  ok(P2.raw() !== null && (P2.raw() || '').includes('idb:img'), '对照：默认（修复后）同一份输入能存下 ⇒ 上面两条断言有分辨力')

  // ⑵ 源码守卫：读侧必须能处理"IDB 里是 dataURL 字符串"（旧读侧只认 Blob ⇒ 静默什么都不做）
  const i = src.lastIndexOf('image === "idb:img"')   // 读侧那处（写侧另有一处字符串比较）
  const seg = i >= 0 ? src.slice(i, i + 2600) : ''
  ok(/typeof v === "string" && \/\^data:\/i\.test\(v\)/.test(seg), '源码守卫：idb:img 读侧处理 dataURL 字符串形态')
  ok(/mpwPersistEmit\(/.test(seg), '源码守卫：idb:img 读侧失败时 mpwPersistEmit（不静默）')
  ok(/function mpwSpillImage/.test(src) && /mpwIdbBgKind/.test(src), '源码守卫：写侧有落 IDB + 回读校验实现')

  // ⑶ 显式变异：**只把读侧的 dataURL 分支删掉**（其余全不变）⇒ 同一条源码守卫必须变红
  const mut = src.replace('if (typeof v === "string" && /^data:/i.test(v)) {', 'if (false) {')
  eq(mut !== src, true, '变异脚本命中读侧那一行（源码结构没漂）')
  const tmp = path.join(os.tmpdir(), 'mpw-persist-mutant-' + process.pid + '.js')
  try {
    fs.writeFileSync(tmp, mut)
    const mutSrc = fs.readFileSync(tmp, 'utf8')
    const j = mutSrc.lastIndexOf('image === "idb:img"')
    const segM = j >= 0 ? mutSrc.slice(j, j + 2600) : ''
    eq(/if \(false\) \{/.test(segM) && !/typeof v === "string" && \/\^data:\/i\.test\(v\)/.test(segM), true,
      '变异后同一条源码守卫变红 ⇒ 该断言有分辨力（删掉 dataURL 读侧就抓得到）')
  } finally { try { fs.unlinkSync(tmp) } catch {} }
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
