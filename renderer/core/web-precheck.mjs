// core/web-precheck.mjs —— Web 壁纸**挂载前预检**的纯函数（唯一实现处）
//
// 为什么要有它：DSH 插件侧有 `probeWebWallpaper()`（`dsh-mpkg-wallpaper/lib/index.js`，路由 `GET /web-probe`），
//   它的文档 `docs/WEB-WALLPAPER.md` §3.4 明确写了"**消费侧（测试台 / 渲染器侧那一半）**：直接读这两个布尔
//   画标记即可，reasons 可原样当悬停说明" —— 而本仓这一半一直没接（真机：测试台上看不到任何预检结论）。
//   本文件就是那一半的**判定核心**：给"目录里的文件清单 + 入口 HTML 正文"，产出两个标记与证据，
//   与插件侧**逐条同语义**（同一批阈值与排除项），落地差异只允许在"谁来读文件"（插件读它自己的目录，
//   本仓服务端读库根里的 item 目录）。
//
// 两个标记（来历都是真机语料）：
//   · `heavy`    重动画：目录里有 Spine / Live2D 骨骼资产（`.skel` / `.atlas` 后缀，或名字含
//                `spine` / `live2d` / `.l2d`），**递归 ≤3 层** ⇒ 低配设备上会卡住界面；
//   · `external` 需外网：入口 HTML（**只读前 256 KB**）里出现 `http(s)://` 外链，
//                **排除** `localhost` / `127.0.0.1` / `[::1]`（插件与本仓自己的路由就是本机地址，
//                不排除会让每张壁纸都挂标记）⇒ 断网 / 被墙时可能加载失败。
//
// 纯函数 ⇒ 无 IO、无 Date、无随机；判据（`tests/web-precheck-test.mjs`）直接对它逐值对账。

export const WEB_PRECHECK_LIMITS = Object.freeze({ depth: 3, bytes: 262144, hits: 8, refs: 8 })

/** 名字是否骨骼动画资产（后缀或名字特征；大小写不敏感）。 */
export function isSkeletonAssetName(name) {
  const s = String(name == null ? '' : name).toLowerCase()
  if (!s) return false
  if (/\.(skel|atlas)$/.test(s)) return true
  return s.includes('spine') || s.includes('live2d') || s.includes('.l2d')
}

/** 从入口 HTML 正文里挑外链（去重、有序、最多 `refs` 条；本机地址不算外链）。 */
export function externalRefsInHtml(html, maxRefs = WEB_PRECHECK_LIMITS.refs) {
  const txt = String(html == null ? '' : html)
  const out = []
  const seen = new Set()
  const re = /https?:\/\/[^\s"'`<>()\\]+/gi
  let m
  while ((m = re.exec(txt)) !== null) {
    const url = m[0]
    let host = ''
    try { host = new URL(url).hostname.toLowerCase() } catch (e) { continue }
    if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1') continue
    if (seen.has(url)) continue
    seen.add(url)
    out.push(url)
    if (out.length >= maxRefs) break
  }
  return out
}

/**
 * 预检判定（纯函数）。
 * @param {{files?:Array<{name?:string,path?:string,depth?:number}|string>, entryHtml?:string|null, entryFile?:string|null, limits?:object}} input
 *   `files` = 目录清单（相对路径或对象皆可；`depth` 给了就按它判层级，否则按路径里的 `/` 数）；
 *   `entryHtml` = 入口 HTML 正文（调用方只读前 `limits.bytes` 字节）；`entryFile` = 入口文件名（取证用）。
 * @returns {{isWeb:boolean, heavy:boolean, external:boolean, heavyHits:string[], externalRefs:string[],
 *            htmlFile:string|null, reasons:string[], limits:{depth:number,bytes:number,hits:number,refs:number}}}
 */
export function webPrecheckPlan(input) {
  const inp = input || {}
  const lim = Object.assign({}, WEB_PRECHECK_LIMITS, inp.limits || {})
  const rawFiles = Array.isArray(inp.files) ? inp.files : []
  const norm = []
  for (const f of rawFiles) {
    if (f == null) continue
    const path = typeof f === 'string' ? f : String(f.path || f.name || '')
    if (!path) continue
    const name = typeof f === 'string' ? (path.split('/').pop() || path) : String(f.name || path.split('/').pop() || path)
    const depth = (typeof f === 'object' && Number.isFinite(f.depth)) ? Number(f.depth) : (path.split('/').filter(Boolean).length - 1)
    norm.push({ path, name, depth })
  }
  const inDepth = norm.filter((f) => f.depth <= lim.depth)
  const heavyHits = []
  for (const f of inDepth) {
    if (!isSkeletonAssetName(f.name)) continue
    heavyHits.push(f.path)
    if (heavyHits.length >= lim.hits) break
  }
  const externalRefs = externalRefsInHtml(inp.entryHtml, lim.refs)
  const heavy = heavyHits.length > 0
  const external = externalRefs.length > 0
  const reasons = []
  if (heavy) reasons.push('骨骼动画资产 ' + heavyHits.length + ' 个（Spine/Live2D）⇒ 低配设备可能卡顿')
  if (external) reasons.push('入口 HTML 引用外网资源 ' + externalRefs.length + ' 处 ⇒ 断网/被墙时可能加载失败')
  return {
    isWeb: true,
    heavy,
    external,
    heavyHits,
    externalRefs,
    htmlFile: inp.entryFile == null ? null : String(inp.entryFile),
    reasons,
    limits: { depth: lim.depth, bytes: lim.bytes, hits: lim.hits, refs: lim.refs },
  }
}
