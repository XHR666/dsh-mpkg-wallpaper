// bench-local-mpkg-scan-test.mjs — P-261（2026-10-07）**测试台两条 MPKG 链路**的判据：
//   ① 扫描：库根顶层散落的 `.mpkg`（服务端 `/api/library`）与「选择文件夹」的纯前端扫描
//      （`demo/bench-patch.js::planLocalScan`）都要**逐个容器成条** —— 修前两个都看不见：
//        · 服务端：顶层散文件只进 `scan.looseMpkg` 计数、`items` 里没有（真机复现：库根
//          `allwallpaper/1004` 顶层 6 个 `.mpkg` ⇒ `GET /api/library` **items=0**）；
//        · 前端：`planLocalScan` 的 `!pkg && !proj ⇒ continue` 把"只含容器的目录"整目录丢掉
//          ⇒ `<角色>/<角色>_NN.mpkg` 这种布局与"workshop 目录 + 容器"混合形态都扫不出来。
//      （服务端那一半的端到端判据在 `tests/bench-mpkg-items-test.mjs` 的 A1m + 变异 M4；这里只判前端纯函数。）
//   ② 装载：`__wp.loadSceneFile(blob)` 在**本仓渲染器**档此前是"明确降级"的 no-op ⇒ 测试台
//      「选文件 / 服务端文件浏览器选 `.mpkg`」导入后**永远加载不出来**。本判据盯住它是真实现：
//      接 File/Blob → 字节存 IndexedDB → `?scenefile=1` 同页重载 → 装载期取回（一次性、取完即删）。
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './_root.mjs'

const DEMO = path.join(ROOT, 'demo')
const PATCH_SRC = fs.readFileSync(path.join(DEMO, 'bench-patch.js'), 'utf8')
const DEMO_HTML = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8')
const { planLocalScan, detectWallpaperKind } = await import(path.join(DEMO, 'bench-patch.js'))

let pass = 0, fail = 0
const ok = (cond, name, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}

console.log('== A 纯前端扫描（`planLocalScan` / `detectWallpaperKind`，纯函数）==')
{
  const entries = [
    { path: '工坊包/scene.pkg' }, { path: '工坊包/project.json' }, { path: '工坊包/preview.gif' },
    { path: '角色甲/角色甲_01.mpkg' }, { path: '角色甲/角色甲_02.mpkg' }, { path: '角色甲/角色甲_03.pkg' },
    { path: 'materials/x.tex' }, { path: 'shaders/y.frag' },
  ]
  const plan = planLocalScan(entries)
  const byDir = (d) => plan.items.find((it) => it.dir === d) || null
  ok(plan.selection === 'dir' && plan.items.length === 4,
    'A1 混合形态：1 个工坊目录 + 3 个容器 = 4 条（修前只出工坊那 1 条）',
    'items=' + plan.items.length + ' → ' + plan.items.map((i) => i.dir).join(' | '))
  ok(!!byDir('工坊包') && byDir('工坊包').pkg && byDir('工坊包').pkg.name === 'scene.pkg' && !byDir('工坊包').container,
    'A2 有 `scene.pkg` 的目录维持旧口径（目录一条、`pkg` = scene.pkg、不带 container 标记）',
    JSON.stringify(byDir('工坊包') && { dir: byDir('工坊包').dir, pkg: byDir('工坊包').pkg.name, container: !!byDir('工坊包').container }))
  const c1 = byDir('角色甲/角色甲_01.mpkg')
  ok(!!c1 && c1.container === true && c1.pkg && c1.pkg.name === '角色甲_01.mpkg' && c1.dirName === '角色甲_01',
    'A3 只含容器的目录**逐容器成条**（每条 `pkg` = 该容器 File，`previewLocal()` 会走 `loadSceneFile(blob)`）',
    JSON.stringify(c1 && { dir: c1.dir, dirName: c1.dirName, pkg: c1.pkg.name, container: c1.container }))
  ok(!!byDir('角色甲/角色甲_03.pkg') && byDir('角色甲/角色甲_03.pkg').pkg.name === '角色甲_03.pkg',
    'A4 `.pkg` 单场景容器同样成条（不只是 `.mpkg`）', JSON.stringify(byDir('角色甲/角色甲_03.pkg') && { pkg: byDir('角色甲/角色甲_03.pkg').pkg.name }))
  ok(!byDir('materials') && !byDir('shaders'),
    'A5 非壁纸目录（materials/、shaders/）仍被跳过（不把资源目录当壁纸）',
    JSON.stringify(plan.items.map((i) => i.dir)))
  // 单文件选择（浏览器只回传散文件）语义不变
  const single = planLocalScan([{ path: 'x.mpkg' }])
  ok(single.selection === 'notdir' && single.items.length === 0,
    'A6 目录选择器只回传散文件 ⇒ 仍是 `notdir`（提示"请选目录"），不假装扫到了壁纸', JSON.stringify(single))

  ok(detectWallpaperKind({}, ['角色甲_01.mpkg']) === 'scene' && detectWallpaperKind({}, ['a.pkg']) === 'scene',
    'A7 `detectWallpaperKind`：`.mpkg`/`.pkg` 容器 ⇒ `scene`（内容由渲染器按容器目录表判：scene.json → 场景 / PKGM0014 → 纯视频）',
    detectWallpaperKind({}, ['a.mpkg']))
  ok(detectWallpaperKind({ type: 'web' }, ['a.mpkg']) === 'web' && detectWallpaperKind({}, ['index.html']) === 'web' && detectWallpaperKind({}, ['v.mp4']) === 'video',
    'A8 显式 `type` 与既有证据优先（容器判定只补空缺，不改 web/video 的既有判定）')
}

console.log('== B 源码接线（前端「选择文件」与宿主契约）==')
{
  ok(/const pkgEntry = \(\/\^scene\\\.pkg\$\/i\.test\(res\.name\) \|\| \/\\\.\(mpkg\|pkg\)\$\/i\.test\(res\.name\)\) \? res : find\(\/\^scene\\\.pkg\$\/i\)/.test(PATCH_SRC),
    'B1 浏览器「选择文件」也接受 `.mpkg`/`.pkg`（修前只认 `scene.pkg` ⇒ 直接落到"仅支持 scene 包预览"的报错文案）')
  ok(/api\.loadSceneFile\(it\.pkg\)/.test(PATCH_SRC),
    'B2 前端本地预览走渲染器公开契约 `__wp.loadSceneFile(it.pkg)`（宿主侧不得再改成私有通道）')
}

console.log('== C 渲染器 `loadSceneFile` 真实现（`demo.html`，MPW-SCENEFILE 段）==')
{
  const seg = DEMO_HTML.split('// ═══ MPW-SCENEFILE-BEGIN ═══')[1].split('// ═══ MPW-SCENEFILE-END ═══')[0] || ''
  ok(seg.length > 400 && /function mpwSceneFilePut\(/.test(seg) && /function mpwSceneFileTake\(/.test(seg) && /indexedDB\.open/.test(seg),
    'C1 交接口在位：IndexedDB `put/take`（blob: URL 与 sessionStorage 都被实测/容量否掉，见该段注释）', 'seg=' + seg.length + 'B')
  ok(/const MPW_SCENEFILE_PARAM = 'scenefile'/.test(seg) && /q\.set\(MPW_SCENEFILE_PARAM, '1'\)/.test(seg) && /q\.delete\('pkgurl'\)/.test(seg) && /q\.delete\('id'\)/.test(seg),
    'C2 重载 URL：去掉旧包来源（`id`/`pkgurl`/`pkgpath`/`video`）+ 置 `?scenefile=1`（同一档位参数保留）')
  ok(/put\('loadSceneFile', async \(fileOrBlob, project\) => \{/.test(DEMO_HTML) &&
    /await mpwSceneFilePut\(\{ name: nm, bytes, project: project \|\| null, at: Date\.now\(\) \}\)/.test(DEMO_HTML) &&
    /location\.replace\(to\)/.test(DEMO_HTML),
    'C3 `__wp.loadSceneFile` 是真实现：接 Blob → 读字节 → 存 IndexedDB → 同页重载（返回 Promise<boolean>）')
  ok(!/put\('loadSceneFile', \(\) => \{ note\('loadSceneFile', '⚠ 本仓渲染器不从 Blob 挂载/.test(DEMO_HTML),
    'C4 旧的"明确降级"桩**已删除**（否则 CAPS.loadSceneFile 恒 false，前端仍会认为不支持）')
  ok(/qs\.get\(MPW_SCENEFILE_PARAM\) === '1'/.test(DEMO_HTML) && /mpwSceneFileTake\(\)/.test(DEMO_HTML) && /buf = \(__sceneFileRec\.bytes instanceof Uint8Array\)/.test(DEMO_HTML),
    'C5 装载期取回并**当成包来源**（取一次即删；取不到 ⇒ 记一行日志 + 回落常规来源，不静默黑屏）')
  ok(/没有待装载的本地文件（记录已被取走 \/ 存储被清）⇒ 按常规来源继续/.test(DEMO_HTML),
    'C6 交接缺失时的**如实日志**在位（诊断可对号）')
  // C7 纯函数复算：把 MPW-SCENEFILE 段切片 + 假 location 跑 `mpwSceneFileRemountUrl()`
  try {
    const fn = new Function('location', seg + '\n; return mpwSceneFileRemountUrl()')
    const url = fn({ search: '?type=scene&id=other%2Fx.mpkg&res=dpr&shell=0&pkgurl=blob%3Ahttp%3A%2F%2Fx&mediaBase=%2Fmedia%2Fdev', pathname: '/webloader/' })
    const q = new URLSearchParams(url.split('?')[1] || '')
    ok(url.startsWith('/webloader/?') && q.get('scenefile') === '1' && q.get('type') === 'scene' &&
      !q.has('id') && !q.has('pkgurl') && q.get('res') === 'dpr' && q.get('shell') === '0' && q.get('mediaBase') === '/media/dev',
      'C7 切片段实跑 `mpwSceneFileRemountUrl()`：旧包来源被清、档位参数保留、`?scenefile=1` 置位',
      url.slice(0, 140))
  } catch (e) {
    ok(false, 'C7 切片段实跑 `mpwSceneFileRemountUrl()`', '切片执行失败：' + String((e && e.message) || e))
  }
}

console.log('== D IndexedDB 交接往返（假 IDB 实跑 MPW-SCENEFILE 段）==')
{
  /* 为什么这条判据必须存在：首版 `mpwSceneFileTx()` 把回调返回的 **Promise** 当成 IDBRequest 处理
     （`resolve(out.result)` 恒 undefined）⇒ 交接记录读不回来、装载静默回落到常规来源
     （真机读数 `__mpwSceneFileTaken=null`、挂的还是旧样例）。这里用最小假 IndexedDB 实跑 put→take。 */
  const seg = DEMO_HTML.split('// ═══ MPW-SCENEFILE-BEGIN ═══')[1].split('// ═══ MPW-SCENEFILE-END ═══')[0] || ''
  function fakeIdb() {
    const stores = new Map()
    const req = (run) => { const r = { result: undefined }; setTimeout(() => { try { run(r); r.onsuccess && r.onsuccess() } catch (e) { r.error = e; r.onerror && r.onerror() } }, 0); return r }
    const mkStore = () => ({
      put(v) { return req((r) => { stores.set(v.id, v); r.result = v.id }) },
      get(k) { return req((r) => { r.result = stores.get(k) }) },
      delete(k) { return req((r) => { stores.delete(k); r.result = undefined }) },
    })
    return {
      _stores: stores,
      open() {
        const r = { result: { objectStoreNames: { contains: () => true }, transaction: () => ({}), close: () => {} } }
        setTimeout(() => { r.onupgradeneeded && r.onupgradeneeded(); r.onsuccess && r.onsuccess() }, 0)
        return r
      },
      _tx(mode, store) {
        const tx = { objectStore: () => store }
        Promise.resolve().then(() => setTimeout(() => { tx.oncomplete && tx.oncomplete() }, 5))
        return tx
      },
    }
  }
  const idb = fakeIdb()
  const dbStub = { objectStoreNames: { contains: () => true }, close: () => {}, transaction: (name, mode) => idb._tx(mode, mkStoreProxy()) }
  function mkStoreProxy() {
    // 每次事务共用同一份内存表（假 IDB 的"持久化"）
    return idb._store || (idb._store = (() => {
      const m = new Map()
      const req = (run) => { const r = { result: undefined }; setTimeout(() => { try { run(r); r.onsuccess && r.onsuccess() } catch (e) { r.error = e; r.onerror && r.onerror() } }, 0); return r }
      return {
        _m: m,
        put(v) { return req((r) => { m.set(v.id, v); r.result = v.id }) },
        get(k) { return req((r) => { r.result = m.get(k) }) },
        delete(k) { return req((r) => { m.delete(k); r.result = undefined }) },
      }
    })())
  }
  const fake = {
    open() {
      const r = { result: dbStub }
      setTimeout(() => { r.onupgradeneeded && r.onupgradeneeded(); r.onsuccess && r.onsuccess() }, 0)
      return r
    },
  }
  const runSeg = new Function('indexedDB', seg + '\n; return { put: mpwSceneFilePut, take: mpwSceneFileTake }')
  const api = runSeg(fake)
  const bytes = new Uint8Array([1, 2, 3, 4, 5])
  await api.put({ name: 'x.mpkg', bytes, project: null, at: 1 })
  const got = await api.take()
  ok(!!got && got.name === 'x.mpkg' && got.bytes instanceof Uint8Array && got.bytes.length === 5 && got.bytes[2] === 3,
    'D1 `mpwSceneFilePut` → `mpwSceneFileTake` 往返拿到**同一份字节**（事务 complete 后才透出 Promise 的值）',
    JSON.stringify(got && { name: got.name, n: got.bytes && got.bytes.length }))
  const again = await api.take()
  ok(again === null || again === undefined,
    'D2 交接是**一次性**的：取过一次后记录已删除（再取 = 空 ⇒ 调用方记日志回落常规来源）', String(again))
}

console.log('\n' + pass + ' 通过 / ' + fail + ' 失败（P-261 测试台 MPKG 扫描 + loadSceneFile 装载）')
process.exit(fail === 0 ? 0 : 1)
