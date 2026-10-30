// server/web-store.mjs —— web 帧「不透明源存储 facade」的服务端落盘（纯逻辑 + 路径助手）
// 2026-09-23 第 ⑥ 条 · docs/WEB-WALLPAPER-MERGE.md §3.5。
//
// 为什么需要它：sandbox 档（`allow-scripts`、不透明源）里作者脚本**访问 `localStorage` 本身就抛**
// `SecurityError`，帧内 shim 于是装一层内存 facade；facade 每 400ms 把内存快照 `POST /api/web-store`
// 落盘，首帧再由注入的种子回灌。服务端这一侧只做三件事：**校验 identity、合并、按上限淘汰**。
//
// 三条纪律：
//   ① wallId 必须是**受限字符集**（`sha1` 前 12 位十六进制那种），拼路径前再校验一次 —— 绝不接受
//      调用方给的任意字符串当文件名（路径穿越）。
//   ② 上限与帧内 facade **同值**（单值 4096 / 64 键 / 64KiB / 最多 64 张），超了**丢值不丢整张**
//      并如实回报 `dropped`，不假装保存成功。
//   ③ 只落 `<reports>/web-store/**`，**绝不写进壁纸包**（与 `bench-props` 同一条纪律）。
import crypto from 'node:crypto'
import path from 'node:path'

/** 帧内 facade 与这里**同值**；改一处必须改两处（`core/we-web-shim.mjs` 的 STORE_LIMITS）。 */
export const WEB_STORE_LIMITS = {
  walls: 64,          // 最多保留多少张壁纸的存储
  value: 4096,        // 单值长度
  keys: 64,           // 单张最多多少键
  bytes: 65536,       // 单张总量
  bodyBytes: 256 * 1024,  // 单次 POST body 上限
}

const WALL_ID_RE = /^[a-z0-9]{6,32}$/i

/** 受限字符集的 wallId；不合法 ⇒ `''`（调用方据此 400，而不是拿它去拼路径）。 */
export function normalizeWallId(v) {
  const s = typeof v === 'string' ? v.trim() : ''
  return WALL_ID_RE.test(s) ? s.toLowerCase() : ''
}

/** wallId 的生成口径与插件侧**同形**（sha1(目录键 + 入口相对路径) 前 12 位）：只吃相对量，不吃绝对路径。 */
export function wallIdFor(parts) {
  const h = crypto.createHash('sha1')
  for (const p of (Array.isArray(parts) ? parts : [parts])) h.update(String(p == null ? '' : p))
  return h.digest('hex').slice(0, 12)
}

/** 落盘路径：`<root>/<wallId>.json`（wallId 不合法 ⇒ `''`）。 */
export function storePath(root, wallId) {
  const id = normalizeWallId(wallId)
  if (!id) return ''
  return path.join(String(root || ''), id + '.json')
}

/**
 * 清洗一帧快照：只留字符串键值、逐项截断/丢弃，返回 `{data, dropped, truncated}`。
 * 规则与帧内 facade 一致：单值 > 4096 **丢这一项**（facade 那边是抛 QuotaExceededError，
 * 落盘时改为丢弃并回报 —— 服务端不是判官，不该替作者决定要不要报错）。
 */
export function sanitizeStoreData(input) {
  const src = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {}
  const data = {}
  let dropped = 0, truncated = 0, bytes = 0, keys = 0
  for (const [k, v] of Object.entries(src)) {
    if (typeof k !== 'string' || !k || k.length > 256) { dropped++; continue }
    const s = typeof v === 'string' ? v : (v == null ? '' : String(v))
    if (s.length > WEB_STORE_LIMITS.value) { dropped++; continue }
    if (keys + 1 > WEB_STORE_LIMITS.keys) { truncated++; continue }
    if (bytes + s.length > WEB_STORE_LIMITS.bytes) { truncated++; continue }
    data[k] = s; keys++; bytes += s.length
  }
  return { data, dropped, truncated, keys, bytes }
}

/** 合并旧快照与新快照（新值覆盖旧值，随后整体再过一遍上限）。 */
export function mergeStore(prev, next) {
  const a = sanitizeStoreData(prev).data
  const merged = Object.assign({}, a, (next && typeof next === 'object' && !Array.isArray(next)) ? next : {})
  const out = sanitizeStoreData(merged)
  return { data: out.data, dropped: out.dropped, truncated: out.truncated }
}

/**
 * 淘汰计划：`entries` = `[{id, mtimeMs}]`（现存的），`incoming` = 这次要写的。
 * 返回**要删的 id 列表**（最旧优先），保证写完之后总数 ≤ `max`；`incoming` 已在其中时不算新增。
 */
export function evictPlan(entries, incoming, max = WEB_STORE_LIMITS.walls) {
  const list = (Array.isArray(entries) ? entries : [])
    .filter((e) => e && normalizeWallId(e.id))
    .map((e) => ({ id: normalizeWallId(e.id), mtimeMs: Number.isFinite(Number(e.mtimeMs)) ? Number(e.mtimeMs) : 0 }))
  const inc = normalizeWallId(incoming)
  const exists = inc && list.some((e) => e.id === inc)
  const total = list.length + (exists ? 0 : 1)
  if (total <= max) return []
  const victims = list.filter((e) => e.id !== inc).sort((a, b) => a.mtimeMs - b.mtimeMs)
  const drop = total - max
  return victims.slice(0, Math.max(0, drop)).map((e) => e.id)
}

/**
 * 不透明源（`Origin: null`）的 CORS 头：**恰好** `null` 才给，别的 origin 一个头都不加
 * （真实站点拿不到该头 ⇒ 打不开我们的媒体面）。形状取自插件的 `webAssetCorsHeaders`，实现自写。
 */
export function opaqueCorsHeaders(originHeader) {
  return originHeader === 'null'
    ? { 'Access-Control-Allow-Origin': 'null', Vary: 'Origin' }
    : {}
}
