// core/scene-project-json.mjs — 官方 `project.json` 的**查找顺序**（服务端与 Node 工具共用同一份）
//
// ── 为什么需要这个文件（P-85 的真因）────────────────────────────────────────────
// WE 工坊布局 = **一个壁纸一个目录**，目录里有三样东西：
//     <workshop>/431960/<id>/{ scene.pkg , project.json , preview.gif }
// `project.json` **不是** scene.pkg 里的条目（`getEntry(pkg,'project.json')` 恒 null，语料 6/6 验证），
// 它是**同级文件**——这一点是 P-61「拿不到 project.json.general.properties → 无属性面板、无 {user:…}
// 绑定」的根因：我们手上的语料目录 `allwallpaper/dd/<id>/` 只留了 scene.pkg，于是：
//   · 属性面板空白（`propsSchema === null`）；
//   · `visible:{user:{condition:…}}` 这类**条件门控**全部走"属性表缺失 → 按可见"的灾难规避分支
//     ⇒ 白子 3327063360 的 4 个 Clock 变体**同时可见**（用户第 3 项"只有秒针"的另一半真相：
//     官方 project.json 里 `b1` 有真值，只有 1 个变体该显示）；
//   · 用户属性绑定（`{user:"clock"}` 等）全部回落到作者默认值。
// 而**用户本机装了 WE** ⇒ Steam 工坊目录里那份 project.json 一直在，只是我们从没去读。
//
// ── 顺序（先显式、后推导；**没有任何"作者语料布局当默认值"**）────────────────────────
//   · 显式语料根（opts.sceneRoot / MPW_SCENE_ROOT / MPW_LIBRARY_DIR）优先于一切推导；
//   · 官方工坊目录（本文件要解决的那一档，P-85）优先于**未配置时的历史布局猜测**；
//   · 历史布局与通用推导（库根自身/父目录/home）都只是**存在性探测的候选**，不是默认值。
//   1. `opts.dir` / `MPW_PROJECT_JSON_DIR`           显式指定（测试与部署用，最高优先级）
//   2. `opts.sceneRoot` / `MPW_SCENE_ROOT`          调用方**明确给出**的语料根（未给就没有这一档）
//   3. `opts.workshopDir` / `MPW_WE_WORKSHOP` / 推导  **Steam 工坊目录**（本文件要解决的那一档）
//   4. `MPW_LIBRARY_DIR`                            库根环境变量（本仓服务端同一口径）
//   5. `<root>/allwallpaper/<id>`、`<root>/allwallpaper/dd/<id>`  两种**历史语料布局**
//      ⚠ 它们只是候选（存在性探测决定用不用），**不是**默认值：`<root>` 是调用方给的库根，
//      别人 `import` 这个包时不会"静默去找作者机器上的老布局"（2026-09-24 可移植性审计 PA-52）。
//   6. `<root>/<id>`（库根自身）、`<dirname(root)>/<id>`（库根的父目录）、`<os.homedir()>/<id>`
//      —— 通用推导候选：任何机器上都成立，不依赖任何作者目录名。
// 命中即返回，并回传：
//   · `source` —— **档位名**（消费方按档位分流：scene-root / we-workshop / …）；
//   · `from`   —— 这一档**具体是谁给的**（opts / 哪个环境变量 / 哪条推导），排查时最想知道的那件事；
//   · `why`    —— 人读的"为什么采用它"。
// 一个都不存在 ⇒ `readProjectJson()` 返回 `null`（不抛），调用方按"无属性表"优雅降级；
// `projectJsonProbe()` 会给出**逐条候选的探测台账**（谁不存在、谁读坏了），供日志如实上报。
//
// ── 我们**不分发**任何 WE 资产 ────────────────────────────────────────────────
// 这里只读用户本机已存在的文件（与 `/weassist/**` 同一条原则）；找不到就返回 null，
// 调用方按"无属性表"的既有路径优雅降级。**不复制、不缓存、不打包**。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
/* ①(2026-09-24 P-177 收口) 官方随包 JSON 允许**尾逗号**（官方 fluidsimulation 的 effect.json 自带一个，
   标准 JSON.parse 抛错、WE 照用）⇒ 这里读的是**包旁**的 project.json（`<壁纸目录>/project.json`，工坊布局
   里与 scene.pkg 同级）⇒ 必须与页面/bundle 走**同一个**宽容实现，否则 8899 的 `/project/<id>`、`/props/<id>`
   会在这种文件上 404，而客户端与插件侧都已经能读（同族不同口径 = 又一处"同一概念两套面"）。 */
import { parseWeJson } from './we-scene-bundle.js'

const HOME = process.env.HOME || ''
// ①(P-101 2026-09-16 目录再整理) 这里原来把作者机的**绝对路径**写成 MPW_ROOT 的兜底默认值。
//   该模块 P-101 起随包分发（`files` 加了 `core/scene-project-json.mjs`）⇒ 兜底值改成
//   **本模块的仓库父目录**（与本仓库其它脚本的 MPW_ROOT 口径逐字一致）：作者机上解析结果
//   与旧字面量**是同一个目录**（行为不变），公开副本也不再带个人路径（packaging-test D 组闸门）。
const MPW_ROOT_DEFAULT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Steam 工坊 431960（Wallpaper Engine）的候选目录，按"最可能是本机真实安装"排序 */
export function workshopDirCandidates(opts = {}) {
  const root = opts.root || process.env.MPW_ROOT || MPW_ROOT_DEFAULT
  return [
    opts.workshopDir,
    process.env.MPW_WE_WORKSHOP,
    root + '/Steam/steamapps/workshop/content/431960',
    HOME + '/.steam/steam/steamapps/workshop/content/431960',
    HOME + '/.local/share/Steam/steamapps/workshop/content/431960',
    HOME + '/Library/Application Support/Steam/steamapps/workshop/content/431960',
    'C:\\Program Files (x86)\\Steam\\steamapps\\workshop\\content\\431960',
    'D:\\Steam\\steamapps\\workshop\\content\\431960',
  ].filter(Boolean)
}

/** 找到本机存在的那一个工坊目录（没有则 null） */
export function findWorkshopDir(opts = {}) {
  for (const d of workshopDirCandidates(opts)) {
    try { if (d && fs.existsSync(d)) return d } catch { /* 权限/路径异常 → 试下一个 */ }
  }
  return null
}

/**
 * 按优先级列出 `<id>/project.json` 的候选（**不判存在性**，便于测试逐条断言顺序）。
 *
 * 每一条都带 `source`（档位名）/ `from`（谁给的）/ `why`（为什么）—— 三个字段一起才够排查。
 * 候选表**全部由入参/环境变量/库根推导**：没有任何"作者机上那条路径"当默认值。
 * @returns {{path:string, source:string, from:string, why:string}[]}
 */
export function projectJsonCandidates(id, opts = {}) {
  const root = path.resolve(opts.root || process.env.MPW_ROOT || MPW_ROOT_DEFAULT)
  const home = (() => { try { return os.homedir() } catch { return HOME } })() || HOME
  const out = []
  const push = (p, source, from, why) => { if (p) out.push({ path: p, source, from, why }) }
  const inRoot = (dir, label) => path.join(dir, String(id), 'project.json')

  // 1) 显式：调用方说了算（测试与部署用）
  if (opts.dir) push(inRoot(opts.dir), 'explicit-dir', 'opts.dir=' + opts.dir, '调用方显式指定的目录（最高优先级）')
  if (process.env.MPW_PROJECT_JSON_DIR) push(inRoot(process.env.MPW_PROJECT_JSON_DIR), 'env-MPW_PROJECT_JSON_DIR', 'env MPW_PROJECT_JSON_DIR=' + process.env.MPW_PROJECT_JSON_DIR, '环境变量显式指定的目录')

  // 2) 语料根：只有**调用方/环境**明确给出时才有这一档（旧实现的"默认 = <root>/allwallpaper/dd"已删）
  if (opts.sceneRoot) push(inRoot(opts.sceneRoot), 'scene-root', 'opts.sceneRoot=' + opts.sceneRoot, '调用方给出的语料根')
  else if (process.env.MPW_SCENE_ROOT) push(inRoot(process.env.MPW_SCENE_ROOT), 'scene-root', 'env MPW_SCENE_ROOT=' + process.env.MPW_SCENE_ROOT, '环境变量给出的语料根')

  // 3) Steam 工坊目录（官方安装里 project.json 与 scene.pkg 同级，P-85 的根因）
  const wsFrom = opts.workshopDir ? 'opts.workshopDir=' + opts.workshopDir
    : (process.env.MPW_WE_WORKSHOP ? 'env MPW_WE_WORKSHOP=' + process.env.MPW_WE_WORKSHOP : null)
  const ws = opts.workshopDir || process.env.MPW_WE_WORKSHOP || findWorkshopDir(opts)
  if (ws) push(inRoot(ws), 'we-workshop', wsFrom || '推导出的 Steam 工坊目录=' + ws, 'Steam 工坊 431960：作者把 project.json 放在 scene.pkg 同级')

  // 4) 库根环境变量（本仓服务端 MPW_LIBRARY_DIR 的同一口径）
  if (process.env.MPW_LIBRARY_DIR) push(inRoot(process.env.MPW_LIBRARY_DIR), 'env-MPW_LIBRARY_DIR', 'env MPW_LIBRARY_DIR=' + process.env.MPW_LIBRARY_DIR, '库根环境变量（与服务端 /api/library 同一取值）')

  // 5) 历史语料布局（**只是候选**：存在性探测决定用不用 ⇒ 不是"默认值"）
  push(inRoot(path.join(root, 'allwallpaper')), 'allwallpaper-flat', '库根 <root>/allwallpaper（root=' + root + '）', '历史语料布局之一：<root>/allwallpaper/<id>')
  push(inRoot(path.join(root, 'allwallpaper', 'dd')), 'scene-root-workspace', '工作区语料布局 <root>/allwallpaper/dd（root=' + root + '）', '本仓工作区约定的语料布局；仅候选之一，不存在就继续往下探')

  // 6) 通用推导候选：库根自身 / 库根的父目录 / 宿主 home —— 任何机器上都成立
  push(inRoot(root), 'library-root', '库根自身 <root>（root=' + root + '）', '调用方给的库根下直接放 <id>/project.json')
  const parent = path.dirname(root)
  if (parent && parent !== root) push(inRoot(parent), 'library-parent', '库根的父目录 <dirname(root)>（root=' + root + '）', '库根与语料平级时的布局')
  if (home) push(inRoot(home), 'home', 'os.homedir()=' + home, '宿主 home 下的同名目录（最宽的兜底候选）')
  return out
}

/**
 * 逐条探测候选（**只读**；不抛）—— 供调用方如实上报"找了哪些地方、各自什么结果"。
 * @returns {{found:{path:string,source:string,from:string,why:string,json:object}|null,
 *            attempts:{path:string,source:string,from:string,exists:boolean,error:string|null}[]}}
 */
export function projectJsonProbe(id, opts = {}) {
  const attempts = []
  for (const c of projectJsonCandidates(id, opts)) {
    let exists = false
    try { exists = fs.existsSync(c.path) } catch (e) { attempts.push({ path: c.path, source: c.source, from: c.from, exists: false, error: 'existsSync: ' + ((e && e.message) || e) }); continue }
    if (!exists) { attempts.push({ path: c.path, source: c.source, from: c.from, exists: false, error: null }); continue }
    try {
      const json = parseWeJson(fs.readFileSync(c.path, 'utf8').replace(/^\uFEFF/, ''))
      return { found: { path: c.path, source: c.source, from: c.from, why: c.why, json }, attempts: [...attempts, { path: c.path, source: c.source, from: c.from, exists: true, error: null }] }
    } catch (e) {
      // 坏文件不致命：继续找下一档，但**记账**（不静默吞掉）
      attempts.push({ path: c.path, source: c.source, from: c.from, exists: true, error: 'JSON: ' + ((e && e.message) || e) })
    }
  }
  return { found: null, attempts }
}

/**
 * 读官方 project.json。
 * @returns {{path:string, source:string, from:string, why:string, json:object}|null} 读不到（或 JSON 坏）→ null
 */
export function readProjectJson(id, opts = {}) {
  return projectJsonProbe(id, opts).found
}

/**
 * 便捷：只要 `general.properties`（属性表），没有就 null。
 * 与 demo.html 的 `propsSchema = pr?.general?.properties || null` 同一口径。
 */
export function readProjectProperties(id, opts = {}) {
  const r = readProjectJson(id, opts)
  const props = r && r.json && r.json.general && r.json.general.properties
  return props ? { path: r.path, source: r.source, from: r.from, why: r.why, properties: props } : null
}
