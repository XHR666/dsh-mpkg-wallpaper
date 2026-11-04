// pkg-parse.mjs —— 本仓**自带**的最小包解析器（MIT）。
//
// 命名说明：本仓 publish-check 有一条**硬规则**——仓库内不得出现名为 `pkg-extract.mjs`/`pkg-extract.js` 的文件
// （那是姊妹插件的 vendored 副本名 ✗，见 tests/publish-check.mjs 的 vendoredPlugin 判定）⇒ 本文件用中性名 `pkg-parse.mjs` ✓。
//
// 为什么有这个文件：`server/we-scene-demo-server.mjs` 需要 `parsePkg` / `readPkgEntry`
// 两个函数来解 `PKGV*`/`PKGM*`/`v1.0` 容器。此前它只能去**姊妹插件仓**（MIT 的
// `dsh-mpkg-wallpaper/lib/pkg-extract.js`）里找 ⇒ 只克隆本仓的人会撞上
// "找不到包解析器"（README §1.D 与 §8 常见问题原来都在教人绕这条路 ✗）。
// 但本仓 `packages/we-core/src/pkg.js`（**MIT** ✓）**本来就导出这两个函数**
// ⇒ 这里只做一层薄封装：克隆本仓即可直接跑，**不再需要任何外部仓库** ✓。
//
// 覆盖范围（如实）：容器**解析**与**按条目读原始字节** ✓；
// 插件的 `pkg-extract.js` 另有场景/纹理**抽取**（`extractScene*` / `extractTex*`，2,600+ 行）
// 不在这里 ✗ —— 需要那些能力时仍可用 `MPW_PKG_EXTRACT=/abs/path/pkg-extract.js` 指过去 ✓。
//
// 许可：本文件与 `packages/we-core/**` 同为 MIT；容器格式的解析实现全部来自 `we-core`，
// 不含任何 GPL 代码（本仓整体是 GPL-3.0-or-later，但 `we-core`/本文件保持 MIT，见 THIRD-PARTY.md）。
import { parsePkg as parsePkgCore, readPkgEntry as readPkgEntryCore } from './packages/we-core/src/pkg.js'

export { parsePkgCore as parsePkg }

/**
 * 把 `we-core` 的条目形状（`{name, offset, size}`）**补齐姊妹插件的字段别名**
 * （`path` / `compressedSize` / `size` 兼有），因为服务端有些路由是按插件的字段名取值的
 * —— 少一个别名就会让 `/shader/<id>/…` 这类路由拿到 `undefined` 而 500 ✗（实测）。
 * 只**增加**字段，不改原字段 ✓（幂等：重复调用无副作用）。
 * @param {Array<{name:string,offset:number,size:number}>} entries
 * @returns {Array<object>} 同一批对象（原地补齐）
 */
export function normalizeEntries(entries) {
  if (!Array.isArray(entries)) return entries
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue
    if (e.path === undefined) e.path = e.name
    if (e.compressedSize === undefined) e.compressedSize = e.size
    if (e.size === undefined && e.compressedSize !== undefined) e.size = e.compressedSize
    if (e.name === undefined && e.path !== undefined) e.name = e.path
  }
  return entries
}

/** 与插件的同名导出保持同样的“解析 + 补别名”语义（服务端若直接调它也能吃两种形状）。 */
export function parsePkgWithAliases(data) {
  const pkg = parsePkgCore(data)
  normalizeEntries(pkg.entries)
  return pkg
}


/**
 * 按条目读原始字节。
 * 兼容姊妹插件的调用形态 `(data, entry)`（entry 用 `offset`/`size`，相对 `dataStart`）；
 * 若第一个参数已经是 `parsePkg()` 的结果（带 `.data` / `.dataStart`）则直接沿用，避免二次解析。
 * @param {Uint8Array|ArrayBuffer|{data:Uint8Array,dataStart:number}} pkgOrData
 * @param {{offset:number,size:number}} entry
 * @returns {Uint8Array}
 */
export function readPkgEntry(pkgOrData, entry) {
  if (!entry || typeof entry.offset !== 'number' || typeof entry.size !== 'number') {
    throw new TypeError('readPkgEntry: entry must have numeric offset/size')
  }
  normalizeEntries((pkgOrData && pkgOrData.entries) || [])
  const pkg = (pkgOrData && pkgOrData.data && typeof pkgOrData.dataStart === 'number')
    ? pkgOrData
    : parsePkgCore(pkgOrData)
  return readPkgEntryCore(pkg, entry)
}

/** 供诊断页/日志显示"当前用的是哪个解析器"（`server/we-scene-demo-server.mjs` 会读 `MPW_PKG_EXTRACT` 落点）。 */
export const PKG_EXTRACT_SOURCE = 'we-scene-demo/pkg-parse.mjs（MIT；薄封装 packages/we-core/src/pkg.js）'
