// _root.mjs —— tests/ 里所有脚本共用的"仓库根"解析（唯一的根口径）
//
// 为什么要有它：本目录的脚本原先住在仓库根，直接用 `import.meta.dirname` 当根。
// 收拢进 tests/ 之后，"脚本目录" ≠ "仓库根"，两边都写一遍必然有人写错 ⇒ 抽到这里。
//
// 用法：
//   import { ROOT } from './_root.mjs'        // 读 demo/index.html、docs/、包产物…
//   import { WS } from './_root.mjs'          // 语料 / WE 资产（工作区根 = 仓库的上一级）
//   const HERE = import.meta.dirname          // 只在真要"本脚本目录"（tests/ 内的产物/夹具）时用
//
// 口径与 `publish-check.mjs` 的 ROOT、`server/we-scene-demo-server.mjs` 的 __dirname 一致：
// 都是**仓库根**，所以文档里形如 `demo/index.html` 的相对引用无需改写。
import fs from 'node:fs'
import path from 'node:path'

/**
 * 仓库根。**以脚本自身位置为准**（tests/ 的上一级）—— 与任何环境变量无关，
 * 所以从任何 cwd 调用、被任何 runner 拉起都指向同一个目录。
 *
 * ⚠ 不要把 `MPW_ROOT` 当仓库根：本仓库既有的 `MPW_ROOT` 语义是**工作区根**（仓库的上一级），
 *   `run-all-tests.sh`、`start-demo.sh`、真包类用例都用 `$MPW_ROOT/allwallpaper`、
 *   `$MPW_ROOT/wallpaper_engine/assets` 从它解析语料与 WE 资产。
 *   2026-09-16 目录整理时曾误把 `MPW_ROOT` 当仓库根 ⇒ 真包类用例集体变红（已修，留此为戒）。
 *   若确有外部工具想显式指定仓库根，用 `MPW_REPO_ROOT`（`run-all-tests.sh` 会导出它）。
 */
export const ROOT = (process.env.MPW_REPO_ROOT && fs.existsSync(path.join(process.env.MPW_REPO_ROOT, 'package.json')))
  ? process.env.MPW_REPO_ROOT
  : path.resolve(import.meta.dirname, '..')
/**
 * 工作区根 = **仓库的上一级**（上面 ⚠ 里那个 `MPW_ROOT` 的语义）。
 *
 * 用途：语料（`allwallpaper/dd`）、WE 资产（`wallpaper_engine/assets`）、上报（`reports`）、
 * 姊妹仓（`dsh-mpkg-wallpaper/…`）都挂在它下面。
 *
 * ①(2026-09-19 敏感信息加固) 这个导出是**兜底默认值**的唯一出处：各调用点仍写
 * `process.env.MPW_ROOT || WS`（优先级一字不变：显式参数 > `MPW_ROOT` > 推导值），
 * 但推导值不再落到**作者本机绝对路径**上 —— 公开仓库不该带操作环境信息（本机目录结构/用户名），
 * 也顺带让检出的任何机器都能跑。既有的 `hlsl2glsl-wiring-test.mjs:67` 早就是这个写法，
 * 这里只是把它收成唯一的根口径。
 *
 * ⚠ 用 ROOT 推导（而不是直接 `import.meta.dirname/../..`）：`MPW_REPO_ROOT`（隔离副本夹具用）
 *   覆盖了仓库根时，工作区根要跟着走 —— 夹具子进程另有 `MPW_ROOT` 显式指定，优先级仍在最前。
 */
export const WS = path.resolve(ROOT, '..')
/** tests/ 自身（放测试产物的默认位置）。 */
export const TESTS = import.meta.dirname
