function mkdirSyncSafe(p) { try { fs.mkdirSync(p, { recursive: true }) } catch {} }
function statSyncSafe(p) { try { return fs.statSync(p) } catch { return null } }

// we-scene 验证服务器 v2：完整 loadScene 链路（model→material→texture）
// 用法: node server/we-scene-demo-server.mjs 8899
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { packDir, collectFiles } from './pack-dir.mjs'; // ①(第22项) 目录源 → PKG 容器（混合加载）
// ①(P-85 2026-09-15) 官方 project.json 的**统一查找链**（与 demo/测试共用 core/scene-project-json.mjs）：
//   WE 工坊布局是"一个壁纸一个目录"，project.json 是 scene.pkg 的**同级文件**而不是包内条目
//   （getEntry(pkg,'project.json') 恒 null，语料 6/6 实测）。查找顺序：explicit-dir → env-MPW_PROJECT_JSON_DIR
//   → scene-root(<MPW_SCENE_ROOT>/<id>) → we-workshop(<Steam 工坊 431960 目录>/<id>) → allwallpaper-flat；
//   命中回传 source（这份属性表从哪来），全找不到返回 null → 调用方按"无属性表"既有路径优雅降级。
import { readProjectJson } from '../core/scene-project-json.mjs';
// ①(P-92 2026-09-16) PWA 外壳（manifest + Service Worker 注册）**服务器侧注入**：
//   为什么不写死在 demo.html 里 —— 那个文件同一时刻只允许一条线改（并发编辑互相覆盖），
//   而 PWA 与渲染逻辑零耦合 ⇒ 做成**可关的注入**：环境变量 `MPW_PWA=1` 或请求 `?pwa=1` 才开（默认关）。
//   缓存判据（**绝不缓存用户壁纸**）在 `sw-policy.mjs`；逐条反面断言见 `pwa-test.mjs`。
import { pwaEnabledFrom, injectPwa, readPwaAsset } from '../web/pwa-inject.mjs';
// ①(§5-⑨ 真机基线快照 2026-09-17) `/baseline` 的**校验判据复用同一个纯模块**（core/baseline-metrics.mjs）：
//   服务端与采集器/对照脚本读同一份 schema 定义 ⇒ 不接受残缺快照污染趋势目录（缺字段 = 400，不是静默落盘）。
import { mpwValidateSnapshot, BASELINE_SCHEMA } from '../core/baseline-metrics.mjs';
// ①(P-85) /project 命中来源的一次性日志去重：同一 id 只打一行"从哪来"，不刷屏
const PROJECT_SOURCE_LOGGED = new Set();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// ①(P-101 2026-09-16 目录再整理) 本文件移入 `server/` ⇒ 落点常量集中在这里，别再散写相对路径：
//   REPO_ROOT = 仓库根（= 本文件的上一级）；站点外壳资源在 web/、渲染与解析内核在 core/、
//   自研 shader 头在 shaders/。URL 路径（/bundle.js、/sw.js、/manifest.webmanifest…）**不变**。
const REPO_ROOT = path.resolve(__dirname, '..');
const WEB_DIR = path.join(REPO_ROOT, 'web');
const CORE_DIR = path.join(REPO_ROOT, 'core');
const SHADERS_DIR = path.join(REPO_ROOT, 'shaders');
// ①(B6 2026-09-14) 端口来源：PORT 环境变量（测试用）> CLI 第 1 个参数（旧用法不变）> 8899
const port = Number(process.env.PORT || process.argv[2] || 8899);
/* ⓪③(2026-09-27 P-204 安全审计 F7/F8，docs/PATCHES.md P-204) **绑定地址：默认只回环**。
   改前是显式 `server.listen(port, '0.0.0.0')` —— 渲染器连同 `/pkgpath`（读白名单根任意文件）、
   `/pkgdir`（打包任意白名单目录）、`/pkgurl`（任意 URL 取回）一起暴露给同网段所有人，且启动日志
   还把本机所有非内网 IPv4 打印出来当"访问地址"。
   回退口：`MPW_BIND=0.0.0.0`（局域网测试台/真机联调显式放开；此时启动日志会如实播报"全网卡"）。 */
const BIND_HOST = String(process.env.MPW_BIND || '').trim() || '127.0.0.1'
const BIND_IS_LOOPBACK = /^(127\.|::1$|\[::1\]$|localhost$)/i.test(BIND_HOST)
// ═══ ①(第16项 发布去个人化 2026-09-14；P-91 2026-09-16 收尾) 所有个人绝对路径改为**环境变量可覆盖** ═══
//   默认值：`MPW_ROOT` 不再写死作者机绝对路径，改为**本仓库的父目录**（= "渲染器与语料放在同一父目录"
//   这个已经写进 README-PUBLIC §4 的约定布局）。作者机上 `__dirname/..` 与旧默认值**是同一个目录**
//   ⇒ 本机行为一字不变；公开副本也不会把作者的个人目录带进分发产物（`npm pack` 后逐条 grep 个人
//   绝对前缀的自查见 packaging-test.mjs）。覆盖方式示例：
//     MPW_ROOT=/path/to/workspace MPW_REPORTS_DIR=/tmp/reports node server/we-scene-demo-server.mjs
/* ①(2026-09-21 跨平台) 临时目录一律走 `os.tmpdir()`：Windows 没有 `/tmp`，macOS 的 `/tmp` 是
   `/private/tmp` 的软链 ⇒ 写死 `/tmp/...` 等于"只在 Linux 上能跑"。由 `tests/cross-platform-gate-test.mjs`
   B 段与 E/F 段一起钉住（该门禁自己也会被这条规则约束）。 */
const TMP_ROOT = process.env.MPW_TMP_ROOT || os.tmpdir()
const MPW_ROOT = process.env.MPW_ROOT || path.resolve(REPO_ROOT, '..');
// ①(P-87 2026-09-15 版权) 场景根：显式环境变量 > <MPW_ROOT>/allwallpaper/dd（作者机 / 使用者自己的语料）
//   > **<repo>/samples**（本仓库自带样例的父目录 ⇒ `?id=sample-synthetic` 正好命中
//   `<root>/<id>/scene.pkg` = samples/sample-synthetic/scene.pkg，project.json 也在同级）。
//   历史：第二兜底原为 `<repo>/samples/wallpapers/`（198MB 真实 Steam 工坊壁纸）——因版权**已整体删除**，
//   本仓库**不分发任何真实壁纸**。三档都不存在时返回一个**明确不存在**的占位路径（绝不留"指向空目录
//   却当成成功"的假象）：此时 `?id=` 一律 404，启动日志会打印生效值 + "请用 ?pkgpath= 或自己放语料"。
/* ②(2026-09-24 可移植性审计 B2) **参数化 + 存在性探测**，把"作者语料布局"降级为**候选之一**：
   旧读数（审计报告）：`:58` 的兜底链只有 `<MPW_ROOT>/allwallpaper/dd` 与 `<repo>/samples` 两档，
   `:252` 更是把 `process.env.MPW_SD_ROOT || '/mnt/sdcard/wallpapertest1'`（**Android 专属路径**）
   写进了随 npm 包发布的服务里。现在：
     · 场景根候选全部由环境/仓库位置推导，**逐条存在性探测**，采用哪条 + 为什么写进 `SCENE_ROOT_INFO`
       （`/__health`、启动日志、`sceneRoot.info` 都读它）；
     · 允许目录（`MPW_ALLOW_DIRS`）同样参数化：`MPW_SD_ROOT` 只在**显式设置**时才进白名单（不再有
       `/mnt/sdcard/...` 这种默认值）；`MPW_PLUGIN_CACHE`、`$HOME` 两条仍按需推导。
   没有任何候选存在时仍返回**明确不存在**的占位路径（口径不变，见上面那段注释）。 */
const SCENE_ROOT_INFO = (() => {
  if (process.env.MPW_SCENE_ROOT) return { root: process.env.MPW_SCENE_ROOT, from: 'env MPW_SCENE_ROOT', candidates: [], explicit: true }
  const candidates = [
    { path: MPW_ROOT + '/allwallpaper/dd', why: '工作区语料布局 <MPW_ROOT>/allwallpaper/dd（作者机/自备语料的常见布局，**不是**产品默认）' },
    { path: MPW_ROOT + '/allwallpaper', why: '工作区语料总目录 <MPW_ROOT>/allwallpaper' },
    { path: REPO_ROOT + '/samples', why: '本仓自带**合成**样例 <repo>/samples（任何检出都存在 ⇒ 别人机器开箱就有东西可开）' },
  ]
  const probed = candidates.map((c) => {
    let exists = false
    try { exists = fs.existsSync(c.path) && fs.statSync(c.path).isDirectory() } catch { exists = false }
    return Object.assign({}, c, { exists })
  })
  const hit = probed.find((c) => c.exists)
  if (hit) return { root: hit.path, from: hit.why, candidates: probed, explicit: false }
  return { root: REPO_ROOT + '/samples/NO-BUNDLED-CORPUS', from: '**没有任何候选存在**（占位路径：?id= 一律 404，请用 MPW_SCENE_ROOT= 或 ?pkgpath=）', candidates: probed, explicit: false }
})();
const MPW_SCENE_ROOT = SCENE_ROOT_INFO.root;

const MPW_REPORTS_DIR = process.env.MPW_REPORTS_DIR || (MPW_ROOT + '/reports');
// ═══ ①(P-104 2026-09-17 发布纪律①②：自动上报默认关 + 一切"自动落盘"都要有上限) ═══
//   用户原话：①"像你这种测试用的自动上报的功能，这种你在上传仓库的时候要把它默认给关掉。"
//            ②"这种自动上报、自动把什么存储到本地的类型的东西，这种需要设置上限的，这上限别忘记了。"
//   **本块是服务端所有落盘上限的唯一来源**（要调上限只改这里；对照表见 docs/DATA-LIMITS.md）。
//   两条口径同时生效：**数量上限**（最旧先删）+ **总字节上限**（最旧先删到限内）。
//   环境变量只用于**测试/现场调参**（把上限压到很小才能在几秒内验完清理路径）；
//   非法/缺省值一律回落默认 —— 绝不出现"配错上限 = 把上限关掉"。
const numEnv = (name, def) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : def;
};
const MPW_LIMITS = {
  reportsMaxFiles: numEnv('MPW_LIMIT_REPORTS_MAX', 60),                      // reports/r<ts>.json ≤60 份
  selfcheckMaxFiles: numEnv('MPW_LIMIT_SELFCHECK_MAX', 40),                  // reports/selfcheck-<ts>.json ≤40 份
  reportsMaxBytes: numEnv('MPW_LIMIT_REPORTS_BYTES', 64 * 1024 * 1024),      // 上面两类**合计** ≤64MB
  shotPerIdMaxFiles: numEnv('MPW_LIMIT_SHOT_FILES', 400),                    // 每 id ≤400 帧
  shotPerIdMaxBytes: numEnv('MPW_LIMIT_SHOT_ID_BYTES', 200 * 1024 * 1024),   // 每 id ≤200MB
  shotTotalMaxBytes: numEnv('MPW_LIMIT_SHOT_TOTAL_BYTES', 500 * 1024 * 1024),// 所有 id 合计 ≤500MB
  // ①(§5-⑨ 真机基线快照 2026-09-17) `reports/baselines/<ts>.json`：**趋势数据**，与上面三条滚动策略
  //   各自独立（`/report` 的 60 份滚动会删旧文件，趋势基线恰恰要留得住 ⇒ 必须分开目录、分开上限）。
  //   200 份 ≈ 每天一份可留 6 个多月；32MB 是整目录硬顶（单份实测 ~3–6KB）。
  baselineMaxFiles: numEnv('MPW_LIMIT_BASELINE_MAX', 200),
  baselineMaxBytes: numEnv('MPW_LIMIT_BASELINE_BYTES', 32 * 1024 * 1024),
};
// 清理动作必须打日志（用户点名："已删除 N 个最旧文件，释放 X MB"）——0 个时不打，免得刷屏。
function logPrune(scope, removed, freedBytes, extra) {
  if (!removed) return;
  console.log('[prune] ' + scope + '：已删除 ' + removed + ' 个最旧文件，释放 ' + (freedBytes / 1048576).toFixed(2) + ' MB'
    + (extra ? '（' + extra + '）' : ''));
}
// 通用：把一个目录收进 maxFiles/maxBytes 之内，**最旧先删**。
//   filter：只统计/删除哪些文件（reports/ 只数 r*.json；shots/<id>/ 只数图片，index.jsonl 台账永不删）。
//   排序口径 = **文件名里的 epoch 优先**（r<ts>.json / <ts>-<tag>.jpg 都是"名字即时间"；同一毫秒灌
//   几十份时排序仍确定），拿不到数字时间戳才退回 mtime。
//   返回 {removed, freedBytes}。任何一步失败都吞掉：**清理绝不能让写入路径 500**。
function pruneDirToLimits(dir, opts) {
  const o = opts || {};
  const maxFiles = (o.maxFiles === undefined) ? Infinity : o.maxFiles;
  const maxBytes = (o.maxBytes === undefined) ? Infinity : o.maxBytes;
  let removed = 0, freedBytes = 0;
  try {
    let names;
    try { names = fs.readdirSync(dir) } catch { return { removed: 0, freedBytes: 0 } }
    const keep = o.filter || (() => true);
    const tsOf = (n) => { const m = /(\d{10,})/.exec(n); return m ? Number(m[1]) : null };
    const rows = [];
    for (const n of names) {
      if (!keep(n)) continue;
      const st = statSyncSafe(path.join(dir, n));
      if (!st || !st.isFile()) continue;
      rows.push({ n, size: st.size, mtime: st.mtimeMs });
    }
    rows.sort((a, b) => {
      const ta = tsOf(a.n), tb = tsOf(b.n);
      if (ta !== null && tb !== null && ta !== tb) return ta - tb;
      return (a.mtime - b.mtime) || a.n.localeCompare(b.n);
    });
    let total = rows.reduce((s, r) => s + r.size, 0);
    let count = rows.length;
    for (const r of rows) {
      if (count <= maxFiles && total <= maxBytes) break;
      try {
        fs.unlinkSync(path.join(dir, r.n));
        removed++; freedBytes += r.size; count--; total -= r.size;
      } catch { /* 单个删不掉不阻断其余 */ }
    }
  } catch { /* ignore */ }
  return { removed, freedBytes };
}
// reports/ 顶层：`r<ts>.json`（/report）与 `selfcheck-<ts>.json`（/diag）两类**各自数量封顶**，
//   再共享一份 **64MB 字节预算**。
//   ⚠ 过滤器只认这两类自造文件名：`MPW_REPORTS_DIR` 默认是**工作区根的 reports/**，那里还躺着
//   `parity-*.json` 等别条线的产物（parity-check 门禁要读）——**一个都不许删**。
function pruneReports(dir) {
  const d = dir || MPW_REPORTS_DIR;
  const a = pruneDirToLimits(d, { maxFiles: MPW_LIMITS.reportsMaxFiles, filter: (n) => /^r\d+\.json$/.test(n) });
  const b = pruneDirToLimits(d, { maxFiles: MPW_LIMITS.selfcheckMaxFiles, filter: (n) => /^selfcheck-\d+\.json$/.test(n) });
  const c = pruneDirToLimits(d, { maxBytes: MPW_LIMITS.reportsMaxBytes, filter: (n) => /^(r\d+|selfcheck-\d+)\.json$/.test(n) });
  const r = { removed: a.removed + b.removed + c.removed, freedBytes: a.freedBytes + b.freedBytes + c.freedBytes };
  logPrune('reports/', r.removed, r.freedBytes, '上限 r* ' + MPW_LIMITS.reportsMaxFiles + ' 份 / selfcheck* '
    + MPW_LIMITS.selfcheckMaxFiles + ' 份 / 合计 ' + Math.round(MPW_LIMITS.reportsMaxBytes / 1048576) + 'MB');
  return r;
}
// ①(§5-⑨ 2026-09-17) `reports/baselines/<ts>.json`：真机基线快照（趋势数据）。
//   与 `pruneReports` **各管各的**：`reports/` 顶层那份 60 份滚动绝不碰子目录，这里也只数 baselines/。
//   超限一律"最旧先删"（文件名是 epoch ms，`pruneDirToLimits` 的取数规则直接命中）。
function pruneBaselines(dir) {
  const d = path.join(dir || MPW_REPORTS_DIR, 'baselines');
  const r = pruneDirToLimits(d, {
    maxFiles: MPW_LIMITS.baselineMaxFiles,
    maxBytes: MPW_LIMITS.baselineMaxBytes,
    filter: (n) => /^\d+\.json$/.test(n),
  });
  logPrune('reports/baselines/', r.removed, r.freedBytes, '上限 ' + MPW_LIMITS.baselineMaxFiles + ' 份 / '
    + Math.round(MPW_LIMITS.baselineMaxBytes / 1048576) + 'MB');
  return r;
}
// shots/<id>/：每 id ≤400 帧 + ≤200MB（只数图片；index.jsonl 是台账，永不删）
function pruneShotsId(id) {
  const dir = path.join(MPW_REPORTS_DIR, 'shots', id);
  const r = pruneDirToLimits(dir, {
    maxFiles: MPW_LIMITS.shotPerIdMaxFiles,
    maxBytes: MPW_LIMITS.shotPerIdMaxBytes,
    filter: (n) => /\.(jpg|png)$/i.test(n),
  });
  logPrune('shots/' + id + '/', r.removed, r.freedBytes, '每 id 上限 ' + MPW_LIMITS.shotPerIdMaxFiles + ' 帧 / ' + Math.round(MPW_LIMITS.shotPerIdMaxBytes / 1048576) + 'MB');
  return r;
}
function shotsDirIds() {
  const root = path.join(MPW_REPORTS_DIR, 'shots');
  try {
    return fs.readdirSync(root).filter((n) => { const st = statSyncSafe(path.join(root, n)); return !!st && st.isDirectory() });
  } catch { return [] }
}
// shots/** 全局字节上限：跨 id 合计超限时**删"所有 id 里最旧的那一帧"**（公平，不会一次掏空某个 id）。
//   上限 500MB —— 一台设备整个上报目录的硬顶。
//   ③(2026-10-11 · 台账 §1.1 第 20 项修) **复杂度**：旧实现每删一帧就 `scan()` 一次（重读全部 id 目录 + stat
//   全部文件）⇒ 文件数千时是 **O(n²)**（实测 id 上千会明显卡启动）。现改为 **扫一次 → 全量排序一次 → 顺序删**：
//   策略与结果**完全不变**（仍按 (mtime, id, name) 升序从最旧删到限内），复杂度降到 **O(n log n)**，
//   且删除阶段**零额外 stat/readdir**（判据 `tests/shots-prune-complexity-test.mjs` 用计数包装 readdirSync 验证）。
export function pruneShotsAll() {
  const root = path.join(MPW_REPORTS_DIR, 'shots');
  let removed = 0, freedBytes = 0;
  try {
    const ids = shotsDirIds();
    /* ① 一次扫描：收集全部帧（含 id/dir/名/大小/mtime）与总量 */
    const all = [];
    let total = 0;
    for (const id of ids) {
      const dir = path.join(root, id);
      let names = []; try { names = fs.readdirSync(dir) } catch { continue }
      for (const n of names) {
        if (!/\.(jpg|png)$/i.test(n)) continue;
        const st = statSyncSafe(path.join(dir, n));
        if (!st || !st.isFile()) continue;
        all.push({ id, dir, n, size: st.size, mtime: st.mtimeMs });
        total += st.size;
      }
    }
    /* ② 一次排序（策略等价于旧实现：整体最旧优先；(mtime, id, name) 升序保证与旧口径同序） */
    if (total > MPW_LIMITS.shotTotalMaxBytes && all.length) {
      all.sort((a, b) => (a.mtime - b.mtime) || a.id.localeCompare(b.id) || a.n.localeCompare(b.n));
      /* ③ 顺序删到限内：此阶段不再 readdir/stat */
      for (const row of all) {
        if (total <= MPW_LIMITS.shotTotalMaxBytes) break;
        try { fs.unlinkSync(path.join(row.dir, row.n)); removed++; freedBytes += row.size; total -= row.size } catch { /* 单个失败不阻塞其余 */ }
      }
    }
  } catch { /* ignore */ }
  logPrune('shots/**', removed, freedBytes, '全局上限 ' + Math.round(MPW_LIMITS.shotTotalMaxBytes / 1048576) + 'MB');
  return { removed, freedBytes };
}
// 启动清理一次（用户要求"启动时清理一次"）：进程一起来就把上次遗留的超限目录收进限内。
function pruneAllOnStartup() {
  const r = pruneReports(MPW_REPORTS_DIR);
  const bl = pruneBaselines(MPW_REPORTS_DIR);   // ①(§5-⑨) 基线快照目录也纳入启动清理
  let n = 0, b = 0;
  for (const id of shotsDirIds()) { const x = pruneShotsId(id); n += x.removed; b += x.freedBytes }
  const g = pruneShotsAll();
  console.log('[limits] 启动清理完成：reports 删 ' + r.removed + ' 份/' + (r.freedBytes / 1048576).toFixed(2) + 'MB'
    + '；shots 每 id 删 ' + n + ' 帧/' + (b / 1048576).toFixed(2) + 'MB'
    + '；shots 全局删 ' + g.removed + ' 帧/' + (g.freedBytes / 1048576).toFixed(2) + 'MB'
    + '（上限：reports ' + MPW_LIMITS.reportsMaxFiles + ' 份/' + Math.round(MPW_LIMITS.reportsMaxBytes / 1048576)
    + 'MB；每 id ' + MPW_LIMITS.shotPerIdMaxFiles + ' 帧/' + Math.round(MPW_LIMITS.shotPerIdMaxBytes / 1048576)
    + 'MB；shots 合计 ' + Math.round(MPW_LIMITS.shotTotalMaxBytes / 1048576) + 'MB'
    // ①(§5-⑨) 基线目录的上限也在这里如实播报（data-limits-test B11 的既有判据是**前缀**匹配，
    //   追加在末尾不会改动它断言的那一段）。
    + '；baselines ' + MPW_LIMITS.baselineMaxFiles + ' 份/' + Math.round(MPW_LIMITS.baselineMaxBytes / 1048576)
    + 'MB（启动清理删 ' + bl.removed + ' 份））');
  return { reports: r, baselines: bl, shotsPerId: { removed: n, freedBytes: b }, shotsGlobal: g };
}
// ①(2026-09-14 公开仓库可用性) WE 资产目录：显式环境变量 > 本仓库旁 > **常见 Steam 安装路径自动探测**。
//   为什么需要：公开副本的使用者不会把 WE 装在 `$MPW_ROOT/wallpaper_engine`；而 `/weassist` 兜底
//   （粒子预设/材质/着色器）只在能读到 WE 自己的 assets 时才有内容。**我们不随仓库分发任何 WE 资产**，
//   只是在用户本机存在安装时读取它；找不到就优雅降级（相关兜底跳过，不影响已打进包的资源）。
const WE_ASSET_CANDIDATES = [
  process.env.MPW_WE_ASSETS,
  MPW_ROOT + '/wallpaper_engine/assets',
  (process.env.HOME || '') + '/.steam/steam/steamapps/common/wallpaper_engine/assets',
  (process.env.HOME || '') + '/.local/share/Steam/steamapps/common/wallpaper_engine/assets',
  (process.env.HOME || '') + '/Library/Application Support/Steam/steamapps/common/wallpaper_engine/assets',
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\wallpaper_engine\\assets',
  'D:\\Steam\\steamapps\\common\\wallpaper_engine\\assets',
].filter(Boolean);
const MPW_WE_ASSETS = WE_ASSET_CANDIDATES.find((d) => { try { return fs.existsSync(d) } catch { return false } }) || WE_ASSET_CANDIDATES[1];
const MPW_ALLOW_DIRS_INFO = (() => {
  /* ②(审计 B2) 白名单条目**逐条可追溯**：每条都记来源（env / $HOME 推导 / 工作区推导 / 仓库自带）。
     `MPW_SD_ROOT` 只有**显式设置**时才进白名单 —— 旧实现里 `|| '/mnt/sdcard/wallpapertest1'` 那个
     Android 专属默认值已经删掉（它只会在"别人机器上恰好存在同名目录"时产生误导）。 */
  const rows = []
  const push = (p, from) => { if (p) rows.push({ path: p, from }) }
  push(process.env.MPW_PLUGIN_CACHE, 'env MPW_PLUGIN_CACHE')
  if (!process.env.MPW_PLUGIN_CACHE) {
    push(process.env.HOME ? process.env.HOME + '/.dsh-mpkg-wallpaper' : os.tmpdir() + '/.dsh-mpkg-wallpaper',
      process.env.HOME ? '$HOME/.dsh-mpkg-wallpaper（推导）' : 'os.tmpdir()/.dsh-mpkg-wallpaper（无 HOME ⇒ 推导）')
  }
  push(process.env.MPW_SD_ROOT, 'env MPW_SD_ROOT（**仅显式设置时**；旧默认值 /mnt/sdcard/wallpapertest1 已删除）')
  push(MPW_ROOT + '/allwallpaper', '工作区推导 <MPW_ROOT>/allwallpaper')
  push(path.join(TMP_ROOT, 'customwall2'), '临时目录 os.tmpdir()/customwall2（推导）')
  push(REPO_ROOT + '/samples', '本仓自带合成样例 <repo>/samples')
  if (process.env.MPW_ALLOW_DIRS) { rows.length = 0; for (const d of String(process.env.MPW_ALLOW_DIRS).split(/[:;]/).filter(Boolean)) push(d, 'env MPW_ALLOW_DIRS') }
  return { dirs: rows.map((r) => r.path), rows, from: process.env.MPW_ALLOW_DIRS ? 'env MPW_ALLOW_DIRS（整体覆盖）' : '推导（逐条见 rows）' }
})();
const MPW_ALLOW_DIRS = MPW_ALLOW_DIRS_INFO.dirs;
/* 包解析器：**候选 + 存在性探测**（审计 B2 的 `:264`）：① env ② 本仓根 `pkg-extract.mjs`
   ③ 姊妹插件仓 `<MPW_ROOT>/dsh-mpkg-wallpaper/lib/pkg-extract.js`。三条都不存在时**如实记原因**
   （加载失败会走上面 ⓪ 的降级路径，不再让进程起不来）。 */
const PKG_EXTRACT_CANDIDATES = [
  { path: process.env.MPW_PKG_EXTRACT, from: 'env MPW_PKG_EXTRACT' },
  // 顺序（2026-10-11 定）：**完整解析器优先，自带兜底** ——
  //   · 姊妹插件 `lib/pkg-extract.js` 提供**完整**能力（`parsePkgIndex` 等 ⇒ 目录表只读 + `/noise`、`/shader` 的索引快路径）；
  //   · 本仓自带 `pkg-parse.mjs`（MIT 薄封装 `packages/we-core/pkg.js`）只提供 `parsePkg`/`readPkgEntry`
  //     ⇒ 保证**只克隆本仓也能跑** ✓，但它没有索引 API ⇒ 服务器按设计退回"整包读"旧路径（慢但正确 ✓）。
  //   ⚠ 若反过来把自带放前面，会让**装了插件**的机器也丢掉索引优化 ✗（实测过）。
  // ①(2026-10-30 路径固化) 渲染器并入插件工作区：插件树 = `REPO_ROOT/../plugin`（改名自 dsh-mpkg-wallpaper）；
  //   env `MPW_PLUGIN_DIR` 可显式覆盖；旧兄弟仓名保留为回退（原检出仍可跑）。
  { path: process.env.MPW_PLUGIN_DIR ? process.env.MPW_PLUGIN_DIR + '/lib/pkg-extract.js' : null, from: 'env MPW_PLUGIN_DIR（完整能力，优先）' },
  { path: path.join(REPO_ROOT, '..', 'plugin', 'lib', 'pkg-extract.js'), from: '集成布局兄弟目录 plugin/（完整能力，优先）' },
  { path: MPW_ROOT + '/dsh-mpkg-wallpaper/lib/pkg-extract.js', from: '旧兄弟插件仓 <MPW_ROOT>/dsh-mpkg-wallpaper（回退）' },
  { path: path.join(REPO_ROOT, 'pkg-parse.mjs'), from: '本仓根 pkg-parse.mjs（自带兜底，MIT 薄封装 we-core）' },
  { path: path.join(REPO_ROOT, 'pkg-extract.mjs'), from: '本仓根 pkg-extract.mjs（legacy 名，自己放的副本可用）' },
].filter((c) => !!c.path);
const PKG_EXTRACT_INFO = (() => {
  const probed = PKG_EXTRACT_CANDIDATES.map((c) => {
    let exists = false
    try { exists = fs.existsSync(c.path) } catch { exists = false }
    return Object.assign({}, c, { exists })
  })
  const hit = probed.find((c) => c.exists)
  return hit ? { path: hit.path, from: hit.from, candidates: probed } : { path: probed[0] ? probed[0].path : '', from: '**没有可用的包解析器**（候选逐条见 candidates）', candidates: probed }
})();
const MPW_PKG_EXTRACT = PKG_EXTRACT_INFO.path;
const SCENE_ROOT = MPW_SCENE_ROOT;
// ①(P-87 2026-09-15 版权) 自带**合成**样例的父目录：`<repo>/samples/<id>/scene.pkg` 形式（id=sample-synthetic）。
//   真实壁纸不再随仓库分发，所以这是唯一"仓库内自带"的 id 来源。
const SAMPLE_ROOT = REPO_ROOT + '/samples';
// ①(P-87) id 形态统一：真实语料目录名是数字，自带样例是 slug（sample-synthetic）。统一常量避免各路由手写漂移；
//   **必须**排除以点开头的名字（`?id=..` 经 path.join 会逃出场景根）。
const ID_PAT = '[A-Za-z0-9_][A-Za-z0-9_.-]*';
/* ③(2026-09-24 mpkg 一等项) 原来这里还有一个 `reIdRoute(prefix)`（`^/<prefix>/<单段 ASCII id>$`），
   `/pkg`、`/project`、`/ddlist`、`/type` 四条 id 路由都用它。现在这四条改成"**嵌套 id + 非 ASCII**"
   （`rePkgRoute()` 与逐条的 `^\/<name>\/(.+)$`）⇒ 该助手**已无调用点**，按"不留死代码"删掉。
   ⚠ `ID_PAT` 仍在用（`/shot/<id>` 的 id 过滤口径，见下面那条路由），不动。 */

/* ①(2026-09-24 复用安全) 顶层动态 import **不许**把宿主一起带崩：`:8902` 现在 import 本模块来复用
   同一份处理器，若这台机器上没有包解析器（公开副本 / 未装插件仓库 / MPW_PKG_EXTRACT 指错），
   原来那行 `await import()` 会在**加载期**抛 ⇒ `:8902` 连启动都起不来。现在：解析器可用 ⇒ 行为不变；
   不可用 ⇒ 只有"要解析 pkg 的那几条路由"如实 500（响应体逐字带原因），其余路由照常。
   注意这**不是**把错误吞掉：原因逐字记在 `PKG_EXTRACT_ERR`，并由 `pkgParserUnavailable()` 暴露给宿主。 */
const PKG_EXTRACT_ERR = { message: null }
let PKG_EXTRACT_MOD = null
try {
  PKG_EXTRACT_MOD = await import(MPW_PKG_EXTRACT)
} catch (e) {
  PKG_EXTRACT_ERR.message = 'pkg-extract 加载失败（' + MPW_PKG_EXTRACT + '）：' + String((e && e.message) || e)
  console.warn('[pkg-extract] ' + PKG_EXTRACT_ERR.message + ' —— 需要解析包的路由会如实报错，其余路由不受影响')
}
const parsePkg = (PKG_EXTRACT_MOD && typeof PKG_EXTRACT_MOD.parsePkg === 'function') ? PKG_EXTRACT_MOD.parsePkg : null
const readPkgEntry = (PKG_EXTRACT_MOD && typeof PKG_EXTRACT_MOD.readPkgEntry === 'function') ? PKG_EXTRACT_MOD.readPkgEntry : null
/** 缺解析器时的**如实失败**（不是假成功）：原因原样给调用方/宿主，绝不静默返回空结果。 */
export function pkgParserUnavailable() { return PKG_EXTRACT_ERR.message }
/** 缺解析器时的替身：调用即抛出（带原因），由各路由既有的错误分支如实回报。 */
const noPkgParser = () => { throw new Error(PKG_EXTRACT_ERR.message || 'pkg-extract 不可用') }
// ①(P-135 丙 2026-09-19) 服务端单线程热点底座：目录表只读一次 + 只读命中条目。
//   `/noise` 旧实现每请求逐个整包读（本机实测 657.9MB/次）、`/shader/<id>/…` 每请求整包 readFileSync
//   + parsePkg（336MB 包 = 每请求 336MB）—— 两者都在单线程事件循环里，页面并发请求会整体排队。
//   注意：**接口行为逐位不变**（同样的 200 字节 / 404 文本 / Content-Type / 错误分支），只改读法。
const { createPkgEntryIndex } = await import('./pkg-entry-index.mjs');
const pkgEntryIndex = createPkgEntryIndex({
  parsePkg: parsePkg || noPkgParser, readPkgEntry: readPkgEntry || noPkgParser,
  // 老版本 pkg-extract 没导出 parsePkgIndex ⇒ 底座自动全程退回旧路径（服务照常起，行为 = 改动前）
  parsePkgIndex: PKG_EXTRACT_MOD ? PKG_EXTRACT_MOD.parsePkgIndex : undefined,
})

/* ═══ ⓪(2026-09-24 · 库根**唯一真源** + 处理器可被复用) ═══════════════════════════════════════════
   两个问题一起收口，改动只在"定义/引用"层面（不吞异常、不改任何路由的响应形状）：

   ① **库根唯一真源**：原先按 id 解析的路由各写各的根 —— `/pkg`、`/shader` 走 `findScene()`（动态查
      两档），而 `/ddvideo/`（:976）、`/noise`（:1085）、`/transpiled/`（:1143）**直接**读
      `MPW_SCENE_ROOT`／`SCENE_ROOT`，`/project`·`/ddlist`·`/type` 的兜底也直接读 `MPW_SCENE_ROOT`。
      后果：宿主把"当前生效的库根"改掉之后，**一部分路由跟着变、一部分不跟着变**，同一 id
      有的 200 有的 404（真机实测：切换库根后 `/pkg/<id>` 恒 404 ⇒ 页面全是 "PKG HTTP 404"）。
      现在只留一个读取点 `currentLibraryRoot()`：所有按 id 解析的路由**都必须**经它（或经它驱动的
      `findScene()`）。宿主（`:8902`）用 `setLibraryRootProvider()` 注入"当前生效的库根"。

   ② **处理器可复用**：请求处理整段提成 `rendererRequestHandler(req, res)` 并导出，`:8902` 直接
      `import` 后在自己的 origin 上挂载（**同一份实现**，不是复制一份）；本文件作为 `node
      server/we-scene-demo-server.mjs 8899` 直接运行时行为不变（`listen` 只在"本文件是入口"时发生）。

   语义不变：仍是"<root>/<id>/scene.pkg"，两档（生效根 → 自带合成样例根）都没有就返回 null
   （调用方 404）—— **绝不**用别的包顶替（不留"看起来成功其实是另一张壁纸"的假象）。 */
let libraryRootProvider = null   // null ⇒ 用本进程自己的 MPW_SCENE_ROOT（独立运行时的既有行为）
/** 宿主注入"当前生效的库根"（`:8902` 每次请求现算 ⇒ 切换库根**不刷新**也立刻生效）。 */
export function setLibraryRootProvider(fn) {
  libraryRootProvider = (typeof fn === 'function') ? fn : null;
  return libraryRootProvider !== null;
}
/** **唯一**的库根读取点：宿主注入优先，否则本进程启动时解析出的 `MPW_SCENE_ROOT`。 */
export function currentLibraryRoot() {
  if (libraryRootProvider) {
    try {
      const v = libraryRootProvider();
      if (typeof v === 'string' && v) return v;
    } catch { /* 宿主解析失败 ⇒ 如实退回本进程的根，不吞成"空根" */ }
  }
  return MPW_SCENE_ROOT;
}
/** 按 id 解析的两档根（生效根 → 自带合成样例根）。**所有** id 路由都从这里取根。 */
function libraryRoots() {
  const primary = currentLibraryRoot();
  return primary === SAMPLE_ROOT ? [primary] : [primary, SAMPLE_ROOT];
}
/** ①(2026-10-10) **候选库根回落**：id 不在"生效根"下时，按 basename 到**同级兄弟库根**里找一次。
 *  真机依据：`:8902` 的生效根 = `allwallpaper/0923`，而目标包在 `allwallpaper/1004`
 *  ⇒ 请求 `/pkg/逆流茶会-姐妹日常+(x-ray).mpkg` 无论名字怎么编码都 404（用户 2026-10-10 16:37 日志）。
 *  有界：只扫生效根的**同级一层目录**、上限 64 个、结果按 primary 缓存；只对 `.mpkg`/`.pkg` 生效。
 *  台账：命中时 `globalThis.__pkgRootFallback` 计数 +1（诊断用），并标注 `from:'sibling-root'`。 */
const __siblingRootCache = new Map()
function siblingLibraryRoots(primary) {
  const key = String(primary || '')
  if (!key) return []
  if (__siblingRootCache.has(key)) return __siblingRootCache.get(key)
  const out = []
  try {
    const parent = path.dirname(key)
    for (const d of fs.readdirSync(parent, { withFileTypes: true })) {
      if (!d.isDirectory()) continue
      const p = path.join(parent, d.name)
      if (p !== key && !out.includes(p)) out.push(p)
      if (out.length >= 64) break
    }
  } catch { /* 读不到就当作没有兄弟根 */ }
  __siblingRootCache.set(key, out)
  return out
}
function findScene(id) {
  for (const root of libraryRoots()) {
    const dir = path.join(root, String(id));
    const pkgPath = path.join(dir, 'scene.pkg');
    if (fs.existsSync(pkgPath)) return { dir, pkgPath, root };
  }
  return null;
}
/** 根下的条目名（`/noise` 要遍历生效根；根不存在/不可读 ⇒ 空表，**不抛**给调用方 500）。 */
function listRootNames(root) {
  try { return fs.readdirSync(root) } catch { return [] }
}
/** id 的包内条目读取：**唯一**入口（`/transpiled`、`/shader` 等都要经它），
 *  根不存在 ⇒ null（调用方 404），不会被上层 catch 成 500。 */
function pkgPathOf(id) {
  const sc = findScene(id);
  return sc ? sc.pkgPath : null;
}

/* ═══ ③(2026-09-24 mpkg 一等项 · 渲染器面) 库根内的**嵌套 itemId** ════════════════════════════════
   背景（真机读数，不是推测）：项目所有者的库布局是 `wallpaperE/<角色>/<角色>_NN.mpkg`，
   测试台把它折成"一个 `.mpkg` = 一个库项、itemId = 相对库根的嵌套路径"（`:8902` 的
   `libraryItemFromFile`）。渲染器页 `demo.html` 取包用的是**根绝对路径** `/pkg/<id>`（`demo.html` 的
   `const url = '/pkg/' + id`，`id` 取自 `?id=` 且 `URLSearchParams.get()` **已解码** `%2F`）
   ⇒ 这里必须能吃两种 id：
     · **目录型**（老口径，逐字不变）：`<root>/<id>/scene.pkg`（`findScene()`），
     · **文件型**（`.mpkg`/`.pkg` 一等项）：`<root>/<id>` **本身就是一个文件** ⇒ 直接把**容器字节**回给
       页面（页面侧 `parsePkg(buf)` 本来就认 `PKGM0014/0018`，见 `demo.html` 的"容器: "那一行日志）。
   安全（与 `:8902` 的 `assertItemPath` **同一套口径**，两边都不许放宽）：
     · 每一段是单段名（无 `/` `\` 控制符、不以 `.` 开头、非空、≤120 字符）；
     · `path.resolve(root, id)` 必须在根内（`id` 里出现 `..` 直接判非法 ⇒ **400**，不落到文件系统上）；
     · 真身（`fs.realpathSync`）也必须在根内 ⇒ 符号链接逃逸 ⇒ **403**（绝不读出根外字节）。
   ⚠ 本模块**没有** `safeJoin`（那是 `:8902` 的实现）：这里的等价物是
   `libItemResolve()` 的三道校验；判据见 `tests/bench-mpkg-items-test.mjs` 的越界组
   （`..%2F..%2Fetc%2Fpasswd` ⇒ 400、绝对路径 ⇒ 400、符号链接逃逸 ⇒ **403** 且字节不泄漏）。 */
const LIB_ID_MAX_SEGS = 8
const LIB_SEG_RE = /^[^\u0000-\u001f\u007f/\\]{1,120}$/
/** 嵌套 itemId 的**段校验**：合法返回规范化后的相对路径，非法返回 null（调用方 400）。 */
function libItemRel(id) {
  if (typeof id !== 'string' || !id || id.length > 400) return null
  const segs = id.split('/')
  if (segs.length > LIB_ID_MAX_SEGS) return null
  for (const s of segs) {
    if (!s || s === '.' || s === '..' || s[0] === '.') return null
    if (!LIB_SEG_RE.test(s)) return null
  }
  return segs.join('/')
}
function realpathSafe(p) { try { return fs.realpathSync(p) } catch { return null } }
function insideDir(root, p) {
  const rel = path.relative(root, p)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}
/** `<root>/<id>` 解析（**唯一**入口）：段校验 + 根内前缀 + 真身校验，任一不过 ⇒ `{ ok:false, code }`。
 *  `code`: **400** = id 本身非法（`..`/绝对路径/伪装段）；**404** = 合法但不存在；**403** = 真身（符号链接）
 *  逃出库根（"越界拒绝"要和"没有这个包"分得开：前者是安全事件，后者是常见情况）。 */
function libItemResolve(root, id) {
  const rel = libItemRel(id)
  if (!rel) return { ok: false, code: 400, reason: `id 非法（只允许相对库根的路径段，不许 "." 开头/含分隔符控制符）：${String(id).slice(0, 120)}` }
  const rootReal = realpathSafe(root) || root
  const full = path.resolve(root, rel)
  if (!insideDir(rootReal, full)) return { ok: false, code: 403, reason: `id 越出库根：${String(id).slice(0, 120)}` }
  const st = statSyncSafe(full)
  if (!st) return { ok: false, code: 404, reason: `不存在：${String(id).slice(0, 120)}` }
  const real = realpathSafe(full)
  if (!real || !insideDir(rootReal, real)) return { ok: false, code: 403, reason: `经符号链接越出库根：${String(id).slice(0, 120)}` }
  return { ok: true, full, st, isFile: st.isFile(), isDir: st.isDirectory() }
}
/** `/pkg/<id>` 的单包大小上限（③）：本机最大的一份 `.mpkg` = **331 194 792 B（331.2MB）**
 *  （`wallpaperE/伊蕾娜/夜莺night——【time_variation时间变化】…day_night.mpkg`；第二大的 `卡提希娅_01.mpkg` = 294MB），
 *  给一倍余量。超限 ⇒ **如实 413**（绝不截断成"半个包"当成功）；发送走 `sendFileStream`（流式 + Range），
 *  不整包读进内存。环境变量只给测试/现场调参用（默认 768MB，与 `:8902` 的 `/api/fs/file` 同一把尺子）。 */
const PKG_MAX_BYTES = (() => {
  const v = Number(process.env.MPW_LIMIT_PKG_BYTES)
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 768 * 1024 * 1024
})()
/** `/pkg/<id>` 的 id 路由：**嵌套 + 非 ASCII** 都要能进来（老口径 `ID_PAT` 只认单段 ASCII，
 *  实测 `GET /pkg/卡提希娅` 直接落到"not found" ⇒ 页面日志 `pkg HTTP 404`）。
 *  放宽的只是**匹配**：解出来的 id 一律过 `libItemResolve()` 的段校验/根内/真身三道。 */
const rePkgRoute = () => /^\/pkg\/(.+)$/

// ═══ ①(B6 渲染器沙箱 2026-09-14) CORS：iframe 去掉 allow-same-origin 后是不透明源，
//   渲染器**自己**的 fetch('/report' | '/pkg/' | '/pkgurl' | '/noise' | '/weassist/…') 全变跨源。
//   唯一入口 applyCors() 给**所有**响应挂三头（setHeader 与各路由的 writeHead 自动合并且不重复，
//   含 res.writeHead(200); res.end('ok') 这类无显式 content-type 的健康路由、createReadStream 管道流、
//   206 分支、404/500 的 catch 兜底）——所以路由内一个都不用各写一遍。
//   本机渲染器只服务自己的静态资源与包数据（无凭据/无秘密），`*` 是开发场景口径；插件宿主路由不加。
/* ⓪③(2026-09-27 P-204 安全审计 F7③) **`ACAO:*` 收成白名单**（改动前：任何网页都能跨源读回
   `/pkgpath`、`/pkgdir`、`/pkgurl` 的响应 ⇒ 渲染器 = 任意网页的"内网取回器"）。
   口径（与插件宿主侧 `lib/index.js` 的 `corsForOrigin()` 同款，两边别各写一套）：
     · 请求**不带 Origin**（同源导航/curl/插件宿主服务端）⇒ 不发任何 CORS 头（同源本来就不看它）；
     · `Origin: null`（strict 沙箱 iframe = 不透明源，渲染器自身 fetch 走这条）⇒ 回显 `null`；
     · 显式白名单（本机 3080 插件页 / 8899 自身 / 8902 测试台，`localhost` 同义）⇒ 回显该源 + `Vary: Origin`；
     · 其它源 ⇒ **一个 `Access-Control-Allow-*` 都不发** ⇒ 浏览器挡住跨源读（写请求仍可到达，
       所以"写"类的闸门另有其人：渲染器本页不产生宿主状态变更）。
   回退口：`MPW_CORS=legacy`（恢复旧的无条件 `*`；`MPW_CORS_ORIGINS=a,b` 追加白名单）。 */
const CORS_ALLOW_EXPLICIT = [
  'http://127.0.0.1:3080', 'http://127.0.0.1:8899', 'http://127.0.0.1:8902',
  'http://localhost:3080', 'http://localhost:8899', 'http://localhost:8902',
];
const CORS_ORIGINS_EXTRA = String(process.env.MPW_CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
const CORS_LEGACY = String(process.env.MPW_CORS || '').trim().toLowerCase() === 'legacy';
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS',
};
/** 这个 `Origin` 请求头值可否回显 CORS 头？导出供离线判据直接调（tests/sec-route-guard-test.mjs）。 */
export function corsOriginAllowed(origin, extra) {
  const o = String(origin == null ? '' : origin).trim();
  if (!o) return false;                                   // 无 Origin：同源语义，不发头
  if (o === 'null') return true;                          // 不透明源（sandbox iframe）
  const list = [...CORS_ALLOW_EXPLICIT, ...CORS_ORIGINS_EXTRA, ...(Array.isArray(extra) ? extra : [])];
  return list.includes(o);
}
const PKGDIR_CACHE = new Map(); // ①(第22项) /pkgdir 打包缓存（键=目录+mtime，最多 4 份）
function applyCors(req, res) {
  try {
    if (CORS_LEGACY) {
      for (const k of Object.keys(CORS_HEADERS)) if (!res.hasHeader(k)) res.setHeader(k, CORS_HEADERS[k]);
      return;
    }
    const origin = req && req.headers ? req.headers.origin : '';
    if (!corsOriginAllowed(origin)) return;               // 非白名单/无 Origin ⇒ 不发任何 CORS 头
    res.setHeader('access-control-allow-origin', String(origin).trim());
    res.setHeader('access-control-allow-headers', 'content-type');
    res.setHeader('access-control-allow-methods', 'GET, HEAD, POST, OPTIONS');
    res.setHeader('vary', 'Origin');
  } catch { /* 头已发/异常：CORS 失败只影响跨源读，绝不让它把请求打崩 */ }
}
/* ⓪③(P-204 F7③) `/pkgurl?u=` 的目标闸门：**只许回环 + 显式白名单**（改动前只校验 `^https?://`）。
   为什么必须：任意网页（或本机任何进程）都能借 `/pkgurl` 当代理读内网/本机任意 HTTP 服务，
   而响应过去还挂着 `ACAO:*` ⇒ 跨源读回。回退口 `MPW_PKGURL_ANY=1`（真机联调）、
   `MPW_PKGURL_ALLOW_HOSTS=a,b`（显式放行若干主机名）。
   注意：这里按**主机名字面量**判定；白名单域名的 DNS 重绑定仍是未验证边界（见 docs/PATCHES.md P-204）。 */
export function isLoopbackHostname(host) {
  const h = String(host == null ? '' : host).trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return false;
  if (h === 'localhost' || h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}
const PKGURL_ALLOW_HOSTS = String(process.env.MPW_PKGURL_ALLOW_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const PKGURL_ANY = String(process.env.MPW_PKGURL_ANY || '').trim() === '1';
/** `/pkgurl?u=` 的目标可否取回：{ok, reason, host, via}。导出供离线判据直接调。 */
export function pkgurlTargetAllowed(raw, opts) {
  const o = opts || {};
  let u = null;
  try { u = new URL(String(raw == null ? '' : raw)) } catch { return { ok: false, reason: 'bad-url', host: '' } }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'bad-scheme', host: u.hostname };
  if (u.username || u.password) return { ok: false, reason: 'userinfo', host: u.hostname };   // URL 里塞凭据 ⇒ 拒绝（防顺手外带）
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (o.any === true) return { ok: true, reason: 'any', host, via: 'MPW_PKGURL_ANY=1' };
  if (isLoopbackHostname(host)) return { ok: true, reason: 'loopback', host, via: 'loopback' };
  const allowExtra = Array.isArray(o.allowHosts) ? o.allowHosts.map((s) => String(s).trim().toLowerCase()) : [];
  if (PKGURL_ALLOW_HOSTS.includes(host) || allowExtra.includes(host)) return { ok: true, reason: 'allowlist', host, via: 'MPW_PKGURL_ALLOW_HOSTS' };
  return { ok: false, reason: 'host-not-allowed', host };
}

// ①(B6) 单区间 Range（RFC 7233：bytes=start-end / start- / -suffix）集中实现。
//   只有请求带 Range 才走 206；不带 Range 的 200 响应与改动前逐字节一致（含各自的 content-type）。
//   非法/多区间 → 退回整文件 200（不引入 416 语义，避免影响既有客户端）。
function parseSingleRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start, end;
  if (m[1] === '') {
    const n = Number(m[2]);
    if (!Number.isFinite(n) || n <= 0) return null;
    start = Math.max(0, size - n); end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null;
  return { start, end };
}
function sendBuffer(req, res, buf, contentType) {
  const range = parseSingleRange(req.headers && req.headers.range, buf.length);
  if (range) {
    const body = buf.subarray(range.start, range.end + 1);
    res.writeHead(206, {
      'content-type': contentType,
      'content-range': 'bytes ' + range.start + '-' + range.end + '/' + buf.length,
      'content-length': body.length,
      'accept-ranges': 'bytes',
    });
    res.end(body);
    return;
  }
  res.writeHead(200, { 'content-type': contentType });
  res.end(buf);
}
function sendFileStream(req, res, full, size, contentType) {
  const range = parseSingleRange(req.headers && req.headers.range, size);
  if (range) {
    res.writeHead(206, {
      'content-type': contentType,
      'content-range': 'bytes ' + range.start + '-' + range.end + '/' + size,
      'content-length': range.end - range.start + 1,
      'accept-ranges': 'bytes',
    });
    fs.createReadStream(full, { start: range.start, end: range.end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'content-type': contentType, 'content-length': size, 'accept-ranges': 'bytes' });
  fs.createReadStream(full).pipe(res);
}

/* ═══ ⓪b(2026-09-24) 「无外壳」入口：`?shell=0` 的**纯函数**注入（`:8902` 的预览框用）═══════════════
   真机症状（用户第 6 条）：测试台右侧预览框在切壁纸时**先闪一下 8899 那种带控制台的整页**约 1 秒，
   再黑屏，然后才出壁纸 —— 因为预览 iframe 先加载了 demo.html 的**页面外壳**（顶栏 `#bar`、
   日志面板 `#log`/`#logbar`、FPS/属性面板…），外壳是首屏就画的，而画布要等取包+首帧。
   修法（**不改 demo.html 一个字节**）：本函数返回一段**追加到 `</body>` 前**的样式 + 首帧握手脚本，
   只有请求显式带 `?shell=0` 时才注入（不带 ⇒ 响应逐字节等于改动前，既有两个端口行为不变）：
     · 样式：把外壳元素藏掉、页面转黑（画布 `canvas{position:fixed;inset:0}` 本来就铺满视口，
       藏掉兄弟节点不影响它 —— 见 demo.html 顶部 style 的 `canvas{position:fixed;inset:0;…}`）；
     · 脚本：**只读**渲染器自己的"真出画"标记（见 `honestFrame`），给 `<html data-mpw-frame="1">`
       置位并把这一帧 `postMessage` 给父窗口（父窗口据此才显示预览框）。
   ⚠ 首帧判据**绝不**可以是"canvas 取得到上下文"（旧写法）：那段探针在 t≈141ms 对 `#sc`
     `getContext('webgl2')`，而**同一个 canvas 只有第一次 getContext 的参数生效** —— 真机读数：
     探针留下了浏览器默认的 `alpha:true/antialias:true/premultipliedAlpha:true/preserveDrawingBuffer:false`，
     渲染器 t≈544ms 的 `lib.glCanvasAttrs()`（`alpha:false/premultipliedAlpha:false/preserveDrawingBuffer:true`）
     被静默顶掉；同一探针还在 t≈151ms 就置了 `data-mpw-frame=1`（真首帧在 12s 之后）⇒ 黑幕提前揭开。
     现在判据只读三个**渲染器自己写的**被动信号（缺一个就继续等，永远不产生副作用）：
       · `window.__mpwFirstFrame`：单实例真首帧出画 / 视频首个解码帧（demo.html 写）；
       · `window.__mpwFrameNo > 0`：任一实例**真的画过一帧**（帧循环里自增）；
       · `window.__mpwWebFrame.ready`：web 壁纸帧的就绪回报（`mountWebFrame` 写）。
     等不到就**不置位**：父页自己有 12s 兜底揭幕（`frameGate` 的 `timeouts` 如实计数），
     宁可让父页说"我没等到首帧"，也不假装出了帧。
   `shellShimScript()` 是纯函数（同样输入同样输出）⇒ `tests/bench-*` 可直接断言，不需要浏览器。 */
export function shellShimScript() {
  return '<style id="mpw-noshell">'
    + 'html,body{background:#000!important;overflow:hidden!important}'
    // 外壳 = body 的直接子节点里除画布/脚本/样式之外的一切（顶栏、日志、手柄、FPS、属性面板…）
    + 'body>*:not(canvas):not(script):not(style):not(#mpw-noshell){display:none!important;visibility:hidden!important}'
    + '#mpw-noshell{display:none!important}'
    + '</style>'
    + '<script id="mpw-noshell-frame">(function(){'
    + 'try{var d=document;'
    + 'var honest=function(){try{if(window.__mpwFirstFrame)return true;'
    + 'if((window.__mpwFrameNo||0)>0)return true;'
    + 'var w=window.__mpwWebFrame;if(w&&(w.ready||w.readyMs>0))return true;'
    + 'return false}catch(e){return false}};'
    + 'var put=function(){try{if(d.documentElement.getAttribute("data-mpw-frame")==="1")return true;'
    + 'if(!honest())return false;'
    + 'd.documentElement.setAttribute("data-mpw-frame","1");'
    + 'try{if(window.parent&&window.parent!==window)window.parent.postMessage({type:"mpw-first-frame",ts:Date.now()},"*")}catch(e){}'
    + 'return true}catch(e){return false}};'
    + 'var raf=window.requestAnimationFrame||function(f){return setTimeout(f,16)};'
    + 'var t0=Date.now();'
    + 'var tick=function(){if(put())return;if(Date.now()-t0>60000)return;raf(tick)};raf(tick);'
    + '}catch(e){}})();</script>';
}
/** 把 `shell=0` 的外壳样式/握手脚本插到 `</body>` 前（没有 `</body>` 就追加到末尾）。
 *  `html` 不是字符串/为空 ⇒ 原样返回（绝不把坏输入变成"注入了一半"的页面）。 */
export function injectShellShim(html) {
  if (typeof html !== 'string' || !html) return html;
  const shim = shellShimScript();
  const i = html.toLowerCase().lastIndexOf('</body>');
  if (i < 0) return html + shim;
  return html.slice(0, i) + shim + html.slice(i);
}
/* ⓪③(2026-09-27 P-204 安全审计 F7⑦) **两个"恢复旧口径"的回退旗标注入**（默认都不注入 ⇒ 响应
   与改动前逐字节相同，除下面 `MPW_*` 显式打开时）：
     · `MPW_THUMBPOST_ANY=1` ⇒ `window.__MPW_THUMBPOST_ANY=true`：`?thumbpost=` 恢复"接受任意地址"；
     · `MPW_EXTBASE_ANY=1`   ⇒ `window.__MPW_EXT_ANY=true`：`?extbase=/?exthooks=` 恢复"接受任意 URL"。
   页面侧还有两个**免重启**的等价物（`?thumbpostany=1` / `?extany=1`，见 demo.html 的 MPW-SEC-GUARD 块）。
   注入落点与 PWA/shell 一致（`</head>` 前；没有 `</head>` 就追加到末尾），注入失败绝不改页面其余字节。 */
export function injectSecFlags(html) {
  if (typeof html !== 'string' || !html) return html;
  const flags = [];
  if (String(process.env.MPW_THUMBPOST_ANY || '').trim() === '1') flags.push('window.__MPW_THUMBPOST_ANY=true;');
  if (String(process.env.MPW_EXTBASE_ANY || '').trim() === '1') flags.push('window.__MPW_EXT_ANY=true;');
  if (!flags.length) return html;
  const tag = '<script>/* P-204 回退口（MPW_THUMBPOST_ANY / MPW_EXTBASE_ANY）*/' + flags.join('') + '</script>';
  const i = html.toLowerCase().lastIndexOf('</head>');
  if (i < 0) return html + tag;
  return html.slice(0, i) + tag + html.slice(i);
}

const serverHandler = async (req, res) => {
  applyCors(req, res);   // ⓪③(P-204) 现在是**按 Origin 白名单**回显（改前无条件 `*`）
  try {
    // ①(B6) 预检：不透明源下渲染器带 content-type 的 POST（/report、/diag）会触发预检请求。
    //   集中应答 204 + 上面三头（allow-headers: content-type），与具体路由无关。
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;

    if (p === '/' || p === '/index.html') {
      // ①(2026-09-14 修) **先读后写**：原顺序是 writeHead(200) 再 readFileSync → 缺 demo.html 时
      //   头已发出、异常只能变成 500/崩溃（公开副本实测复现）。现在缺文件是干净 404。
      const fp = path.join(REPO_ROOT, 'demo.html');
      let buf = null;
      try { buf = fs.readFileSync(fp) } catch { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('demo.html not found'); return }
      // ①(P-92) PWA 注入（默认关；`MPW_PWA=1` 或 `?pwa=1`）。注入是**纯增量**（`</head>` 前插
      //   manifest 链接 + 注册脚本），关闭时**逐字节等于改动前**的 demo.html 字节流。
      if (pwaEnabledFrom(url.searchParams, process.env)) {
        buf = Buffer.from(injectPwa(buf), 'utf8');
      }
      /* ⓪b(2026-09-24) 预览框的「无外壳」形态：`?shell=0` ⇒ 注入隐藏外壳的样式 + 首帧握手。
         不带这个参数 ⇒ 这一行不执行，响应与改动前**逐字节相同**（:8899 页面行为不变）。 */
      if (url.searchParams.get('shell') === '0') {
        buf = Buffer.from(injectShellShim(buf.toString('utf8')), 'utf8');
      }
      /* ⓪③(P-204) 回退旗标注入（默认关闭 ⇒ 不注入、字节流不变）。 */
      buf = Buffer.from(injectSecFlags(buf.toString('utf8')), 'utf8');
      sendBuffer(req, res, buf, 'text/html; charset=utf-8');
      return;
    }
    // ①(P-92) PWA 静态资源：manifest / Service Worker / 缓存判据 / 图标。
    //   `sw.js` 与 `sw-policy.mjs` 必须与首页同源同目录（SW 的 scope 就是它自己的路径）。
    if (readPwaAsset(WEB_DIR, p)) {
      const a = readPwaAsset(WEB_DIR, p);
      res.writeHead(200, { 'content-type': a.type, 'cache-control': 'no-cache' });
      res.end(a.buf);
      return;
    }
    if (p === '/bundle.js') {
      sendBuffer(req, res, fs.readFileSync(path.join(CORE_DIR, 'we-scene-bundle.js')), 'text/javascript');
      return;
    }
    // ①(新) ?mode=elysia: elysia CPU 渲染器源码静态服务 + we-scene-bundle 别名
    // elysia/demo-elysia.js 用相对路径 import '../we-scene-bundle.js' → /we-scene-bundle.js
    if (p === '/we-scene-bundle.js') {
      sendBuffer(req, res, fs.readFileSync(path.join(CORE_DIR, 'we-scene-bundle.js')), 'text/javascript');
      return;
    }
    // ①(§5-⑨ 2026-09-17) 基线采集器的纯计算模块（demo.html 以相对说明符 `./baseline-metrics.mjs` import）。
    //   与 `/attach-transform.mjs` 同一个形态：产物根文件名 = 仓库内 core/ 下的文件。
    if (p === '/baseline-metrics.mjs') {
      sendBuffer(req, res, fs.readFileSync(path.join(CORE_DIR, 'baseline-metrics.mjs')), 'text/javascript');
      return;
    }
    // ①(P-21-ATTACH 2026-09-13) bundle 的 import './attach-transform.mjs'（浏览器解析为 /attach-transform.mjs）
    if (p === '/attach-transform.mjs') {
      sendBuffer(req, res, fs.readFileSync(path.join(CORE_DIR, 'attach-transform.mjs')), 'text/javascript');
      return;
    }
    // ①(P-111 2026-09-17 帧几何/音频频段接线) 两个 core/ 纯模块的**同名产物根路由**：
    //   `core/we-scene-bundle.js` 以 `./web-frame-geometry.mjs` import（浏览器解析为 /web-frame-geometry.mjs）、
    //   `demo.html` 以 `./audio-band-array.mjs` import（同形，与 /baseline-metrics.mjs 一模一样）。
    //   为什么必须在这里：两个文件同时被 **Node（测试/宿主）与浏览器（相对说明符）** import ⇒
    //   产物根要有同名文件，否则 8899 下 404、Pages 下 404（两者都是"静默没有频谱/坐标偏移"，不报错）。
    //   `tests/audio-band-wiring-test.mjs` / `tests/web-frame-geometry-wiring-test.mjs` 断言这三处（服务端路由 /
    //   build-pages 映射 / 源码 import）同时在位。
    if (p === '/web-frame-geometry.mjs') {
      sendBuffer(req, res, fs.readFileSync(path.join(CORE_DIR, 'web-frame-geometry.mjs')), 'text/javascript');
      return;
    }
    // ①(2026-09-23 第 ⑥ 条) web 壁纸宿主契约 + shim：demo.html 以 `./web-frame-host.mjs` / `./we-web-shim.mjs`
    //   相对 import ⇒ 产物根必须有同名文件（与上面几条同形；漏登记就是 P0：整条 module 图断在 404）。
    //   ⚠ 两条**分开写、文件名写成字面量**：`tests/pack-closure-test.mjs` 的别名表就是从这个文件里
    //   按 `path.join(CORE_DIR, '<名字>')` 提取的 —— 写成 `p.slice(1)` 那种合并式，发布面闭包判据
    //   就看不到别名（本轮实测：B2/C1/C2 三条同时红）。
    if (p === '/web-frame-host.mjs') {
      sendBuffer(req, res, fs.readFileSync(path.join(CORE_DIR, 'web-frame-host.mjs')), 'text/javascript');
      return;
    }
    if (p === '/we-web-shim.mjs') {
      sendBuffer(req, res, fs.readFileSync(path.join(CORE_DIR, 'we-web-shim.mjs')), 'text/javascript');
      return;
    }
    if (p === '/audio-band-array.mjs') {
      sendBuffer(req, res, fs.readFileSync(path.join(CORE_DIR, 'audio-band-array.mjs')), 'text/javascript');
      return;
    }
    // ①(P-110 补漏 2026-09-17 回归自动化发现) `core/we-scene-bundle.js:6` 以 `./puppet-skin.js` import
    //   （P-110 bind 世界链的唯一实现处）。产物根映射（build-pages.mjs:60）与 PWA 预缓存（web/sw.js:24）
    //   都已登记该文件名，**唯独 8899 缺这条路由** ⇒ 浏览器把 404 当"模块 MIME 类型不合法"拒绝加载，
    //   整条 module 图断在这里（`window.__mpwModuleStarted` 永远 false、日志停在 `loading…`），
    //   而门禁里没有任何一项真的用浏览器加载过这个页面 ⇒ 一直是绿的。
    //   与上面四条同形：产物根文件名 = 仓库内 core/ 下的文件。
    if (p === '/puppet-skin.js') {
      sendBuffer(req, res, fs.readFileSync(path.join(CORE_DIR, 'puppet-skin.js')), 'text/javascript');
      return;
    }
    // ①(P-136 用户第 4 项「照抄上游鼠标尾迹」2026-09-19) **P0 事故修复**：`core/we-scene-bundle.js` 新增两个
    //   同目录 import（`./we-pointer-source.mjs` / `./we-particle-pointer.mjs`），而本服务器的路由表、
    //   `build-pages.mjs` 的产物根映射、`web/sw.js` 的预缓存**三处同时漏了这两个名字** ⇒ `/bundle.js`
    //   （= 本文件 `core/we-scene-bundle.js` 的字节流）在浏览器里解析 `./we-pointer-source.mjs` 得到
    //   `/we-pointer-source.mjs` → 404 → 浏览器按"模块 MIME 类型不合法"拒绝 → **整条 module 图断掉**：
    //   `window.__mpwModuleStarted` 永远 false、页面停在 `loading…`（看门狗只会说"脚本资源加载失败：(inline module)"）。
    //   与上面五条同形：产物根文件名 = 仓库内 `core/` 下的文件。防复发见 `tests/core-module-wiring-test.mjs`。
    // ②(P-228l 2026-10-05) 同一形态再添一名：bundle 新增同目录 import `./we-animation.mjs`（属性动画运行时）。
    if (p === '/we-pointer-source.mjs' || p === '/we-particle-pointer.mjs' || p === '/we-animation.mjs') {
      sendBuffer(req, res, fs.readFileSync(path.join(CORE_DIR, p.slice(1))), 'text/javascript');
      return;
    }
    // ①(P-139 2026-09-19) `elysia/we-renderer/puppet.js` 以 `../../core/attach-transform.mjs` import
    //   （采样器收敛到唯一实现处时改成从 core 取）⇒ 浏览器解析成 `/core/attach-transform.mjs`。
    //   这里给 `/core/<文件>` 一条**限定扩展名 + 防目录穿越**的只读路由（与 `/elysia/` 段同形），
    //   以后 elysia 侧再从 core 取新模块也不用改服务器。
    if (p.startsWith('/core/')) {
      const rel = p.slice('/core/'.length);
      const base = CORE_DIR;
      const full = path.join(base, rel);
      if (/\.(mjs|js|json)$/.test(rel) && !rel.includes('..') && full.startsWith(base)
        && fs.existsSync(full) && fs.statSync(full).isFile()) {
        const ct = rel.endsWith('.json') ? 'application/json' : 'text/javascript';
        sendBuffer(req, res, fs.readFileSync(full), ct);
        return;
      }
      res.writeHead(404); res.end('no core file');
      return;
    }
    // ①(MERGED-3 1.3 2026-09-14) 诊断开关速查 JSON（diag-flag-check.mjs 脚本生成）：
    //  插件面板在线数据源（离线用 client.js 内置副本）；文件不存在时按生成脚本提示返回
    if (p === '/diag-flags.json') {
      const fp = path.join(WEB_DIR, 'diag-flags.json');
      if (fs.existsSync(fp)) {
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
        res.end(fs.readFileSync(fp));
      } else {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'diag-flags.json 不存在，先跑 node diag-flag-check.mjs' }));
      }
      return;
    }
    // ①(用户第 6 项 2026-09-19) 自绘下拉控件的**共享模块**：`demo.html`（8899）与测试台（`:8901/:8902`
    //   直接托管 `demo/**`）都要用它 ⇒ 模块住在 `demo/`（测试台天然可取）；这里只给 8899 补一条
    //   **限定这两个文件**的只读路由（不开 `/demo/**` 整目录 —— 没必要把测试台整站也暴露到渲染器页的源下）。
    if (p === '/demo/mpw-select.js' || p === '/demo/mpw-select-math.mjs') {
      const full = path.join(REPO_ROOT, p.slice(1));
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
        res.end(fs.readFileSync(full));
        return;
      }
      res.writeHead(404); res.end('no select module');
      return;
    }
    if (p.startsWith('/elysia/')) {
      const rel = p.slice('/elysia/'.length);
      const base = path.join(REPO_ROOT, 'elysia');
      const full = path.join(base, rel);
      if (full.startsWith(base) && fs.existsSync(full) && fs.statSync(full).isFile()) {
        const ct = rel.endsWith('.js') ? 'text/javascript' : rel.endsWith('.json') ? 'application/json' : 'application/octet-stream';
        res.writeHead(200, { 'content-type': ct });
        res.end(fs.readFileSync(full));
        return;
      }
      res.writeHead(404); res.end('no elysia file');
      return;
    }
    if (p === '/diag' && req.method === 'POST') {
      // ①(MERGED-2 E 2026-09-12) ?selfcheck=1 / ?perf=1 的紧凑报告接收端（≤16KB）
      // ①(2026-09-19 同类缺陷一并修) 原来超限走 `req.destroy()`：**先掐连接再写响应**，客户端拿到的是
      //   ECONNRESET（curl exit 56 / status 100），"如实回 413"这条口径在超限路上从来没成立过。
      //   口径与 `/shot` 那条早就修好的路逐字相同：超限后**继续把 socket 读干净但不再缓存**，
      //   到 `end` 再回 413 JSON（内存只留"丢弃前"那一份，字节数不再增长）。
      //   ⚠ 千万**不能**在这里 `req.pause()`：请求体没读完 ⇒ `end` 永不触发 ⇒ 请求挂到客户端超时
      //   （2026-09-19 实测：pause 版让 curl 卡死 25s，服务端既不回 413 也不回任何东西）。
      try {
        const DIAG_CAP = 16 * 1024
        let body = ''
        let tooBig = false
        req.on('data', (c) => {
          if (tooBig) return
          body += c
          if (body.length > DIAG_CAP) { tooBig = true; body = '' }
        })
        req.on('end', () => {
          if (tooBig) {
            res.writeHead(413, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: 'selfcheck 报告超过上限 ' + DIAG_CAP + ' 字节（未落盘）' }))
            return
          }
          try {
            const dir = MPW_REPORTS_DIR
            mkdirSyncSafe(dir)
            pruneReports(dir)   // ①(P-104) 写入前检查：先把上一次遗留的超限收回去
            fs.writeFileSync(path.join(dir, 'selfcheck-' + Date.now() + '.json'), body)
            pruneReports(dir)   // ①(P-104) 写入后检查：本次这份也计入数量/字节上限（历史：这条路**完全没有滚动**）
            res.writeHead(200); res.end('ok')
          } catch { res.writeHead(500); res.end('err') }
        })
      } catch { res.writeHead(500); res.end('err') }
      return
    }
    if (p === '/diag') {
      // ①同上：先读后写，缺文件 404（原来缺 diag.html 会先发 200 再抛）
      const fp = path.join(WEB_DIR, 'diag.html');
      let buf = null;
      try { buf = fs.readFileSync(fp) } catch { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('diag.html not found'); return }
      sendBuffer(req, res, buf, 'text/html; charset=utf-8');
    } else if (p === '/probe') {
      // ①(P-41 A6) 与其它路由对齐的错误语义：文件缺失 → 404 + JSON 说明；读失败 → 500（不再把
      //   ENOENT 直接抛成未捕获异常炸掉整个请求管线）
      const fp = path.join(WEB_DIR, 'probe.html');
      if (fs.existsSync(fp)) {
        try {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(fs.readFileSync(fp));
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'probe.html 读取失败: ' + e.message }));
        }
      } else {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'probe.html 不存在' }));
      }
      return;
    }
    // WE 公共 shader 头（等价实现：common.h/common_blending.h 等）
    // waterwaves/shake 等效果 #include 依赖；场景 pkg 不含这些（WE 全局资产）
    const WE_SHADERS = MPW_WE_ASSETS + '/shaders';
    const HEADER_FILES = {};
    // ①(2026-09-14 公开副本自足性) **本仓库自研头优先**，WE 安装目录仅作兜底：
    //   本项目已把实际引用的 6 个头换成自研实现（见 docs/COMMON-HEADERS-REPLACEMENT.md），
    //   不再需要读 WE 的字节；用户机器没装 WE 时也能正常编译着色器。
    // ①(P-87 2026-09-15 公开副本自足性) 这一行原来**无条件** scandir WE 安装目录：没装 WE 的机器
    //   （= 公开副本的正常情况）**每个请求**都在这里抛 ENOENT → 全站 500（实测：连 /pkg/<自带合成样例>
    //   都 500，验证服务器形同报废）。而本仓库自研的 common*.h 就在 __dirname，下面第二个循环无条件加载
    //   ⇒ 缺 WE 只是少一层"官方同名头兜底"，不该致命。故把 scandir 包进 try/catch：
    //   装了 WE 的机器 readdirSync 成功、HEADER_FILES 与改动前逐位相同（author 机行为不变）。
    try {
      for (const f of fs.readdirSync(WE_SHADERS)) {
        if (/^common.*\.h$/.test(f)) {
          const own = path.join(SHADERS_DIR, f);
          HEADER_FILES[f] = fs.existsSync(own) ? own : path.join(WE_SHADERS, f);
        }
      }
    } catch { /* 未安装 WE / 无 assets：只用仓库自研头（下个循环），不致命 */ }
    for (const f of fs.readdirSync(SHADERS_DIR)) {
      if (/^common.*\.h$/.test(f)) HEADER_FILES[f] = path.join(SHADERS_DIR, f);
    }
    let m = null;
    const pm = (re) => (m = p.match(re));
    if (p.startsWith('/shaders/')) {
      const fname = p.slice('/shaders/'.length);
      if (HEADER_FILES[fname]) {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(fs.readFileSync(HEADER_FILES[fname]));
        return;
      }
    }
    if (HEADER_FILES[p.slice(1)]) {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(fs.readFileSync(HEADER_FILES[p.slice(1)]));
      return;
    }

    m = p.match(/^\/report$/);
    if (m) {
      try {
        const REPORT_CAP = 4 * 1024 * 1024
        let body = ''
        let tooBig = false
        req.on('data', (c) => {
          if (tooBig) return               // ①(2026-09-19) 超限后继续读干净但不再缓存；**不 pause**（pause ⇒ end 不来 ⇒ 挂死）
          body += c
          if (body.length > REPORT_CAP) { tooBig = true; body = '' }
        })
        req.on('end', () => {
          if (tooBig) {
            res.writeHead(413, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: '报告超过上限 ' + REPORT_CAP + ' 字节（未落盘）' }))
            return
          }
          try {
            const dir = MPW_REPORTS_DIR
            mkdirSyncSafe(dir)
            pruneReports(dir)   // ①(P-104) 写入前检查（上限常量集中在 MPW_LIMITS）
            fs.writeFileSync(path.join(dir, 'r' + Date.now() + '.json'), body)
            // ①(P-104 2026-09-17) 上限从"只有数量 60 份"升级成 **数量 + 合计 64MB**。
            //   写**后**再收一次：本次这份也算进账（写前那次管的是上一次遗留）。
            pruneReports(dir)
            res.writeHead(200); res.end('ok')
          } catch { res.writeHead(500); res.end('err') }
        })
      } catch { res.writeHead(500); res.end('err') }
      return
    }
    // ═══ ①(§5-⑨ 真机基线快照 2026-09-17) POST /baseline ═══
    //   为什么**另开一条**而不是复用 `/report`（二选一，这里说明理由）：
    //     ① `/report` 落 `reports/r<ts>.json`，受"60 份 + 64MB 最旧先删"滚动 —— 而基线是**趋势数据**，
    //        恰恰要留得住（今天的快照不能被明天的报告挤掉）；
    //     ② 基线要按时间序列落**独立目录** `reports/baselines/<ts>.json`，`baseline-diff` 直接读它；
    //     ③ 载荷语义不同（`kind:'baseline'`，字段是 FPS/分位/启动/代理显存），混进 r*.json 会让
    //        `report-audit`/`parity-check` 那套"逐层对账"消费端看到不认识的结构。
    //   相同的地方（**不另造一套**）：同一条 POST + JSON body 通路、同一套 `mkdirSyncSafe` +
    //   `pruneDirToLimits` 上限机制、同一个 `MPW_REPORTS_DIR` 根、同一个 CORS/预检处理。
    //   校验：body ≤1MB，必须是完整快照（schema 由 core/baseline-metrics.mjs 判）→ 否则 400，
    //        **不落盘**（趋势目录里只有干净数据；缺字段当 0 比会得出假结论）。
    //   返回：{"ok":true,"schema":N,"file":"baselines/<ts>.json","bytes":N}
    if (p === '/baseline') {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: '只接受 POST（body = 基线快照 JSON）' }));
        return;
      }
      try {
        const BASE_CAP = 1024 * 1024
        let body = ''
        let tooBig = false
        req.on('data', (c) => {
          if (tooBig) return               // ①(2026-09-19) 同 /report：读干净后回 413；不 pause、不 destroy
          body += c
          if (body.length > BASE_CAP) { tooBig = true; body = '' }
        })
        req.on('end', () => {
          if (tooBig) {
            res.writeHead(413, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ ok: false, error: '快照超过上限 ' + BASE_CAP + ' 字节（未落盘）' }))
            return
          }
          try {
            let snap = null
            /* [we-json:strict|request-body] **不是包内/包旁 JSON**：客户端上报的基线快照（HTTP 请求体）⇒ 坏 JSON 必须 400。
               （本文件里"读包内/包旁 JSON"的路径是 `readProjectJson`，走 core/scene-project-json.mjs；
                本文件自身的 `JSON.parse` 只此一处，且永远是请求体。） */
            try { snap = JSON.parse(body) } catch { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'body 不是合法 JSON' })); return }
            const v = mpwValidateSnapshot(snap)
            if (!v.ok) {
              res.writeHead(400, { 'content-type': 'application/json' })
              res.end(JSON.stringify({ ok: false, error: '快照不完整（' + v.errors.slice(0, 6).join('；') + '）', errors: v.errors.slice(0, 20) }))
              return
            }
            const dir = path.join(MPW_REPORTS_DIR, 'baselines')
            mkdirSyncSafe(dir)
            pruneBaselines(MPW_REPORTS_DIR)   // 写入前：先把上一次遗留的超限收回去
            const ts = Date.now()
            let name = ts + '.json', n = 1
            while (fs.existsSync(path.join(dir, name))) name = ts + '-' + (++n) + '.json'
            fs.writeFileSync(path.join(dir, name), body)
            pruneBaselines(MPW_REPORTS_DIR)   // 写入后：本次这份也计入数量/字节上限
            const rel = 'baselines/' + name
            console.log('[baseline] ' + path.join(dir, name) + ' ' + body.length + 'B id=' + snap.id
              + ' fps中位=' + (snap.fps && snap.fps.median) + ' 启动=' + (snap.startup && snap.startup.totalMs) + 'ms')
            res.writeHead(200, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ ok: true, schema: BASELINE_SCHEMA, file: rel, bytes: body.length }))
          } catch (e) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: '落盘失败: ' + (e && e.message) })) }
        })
      } catch { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: '请求处理失败' })) }
      return
    }
    // ═══ ①(P-88 2026-09-15 用户点名："加一个一键连拍上报截图的功能 —— 这样我就不用下载下来，
    //   点一下不需确认就能直接上传到你的后台，因为我下载下来可能卡不好他的时机") ═══
    //   POST /shot?id=<壁纸id>&tag=<burst-07|single>&t=<场景秒>&note=<备注>
    //   body = **原始图片字节**（就是 JPEG/PNG 本身，不是 base64 JSON —— base64 会把 4MB 上限
    //   白白吃掉 33%，而这条需求的画面是**原分辨率的人物面部/眉毛**，体积本来就紧）。
    //   与 /report 的关系：**完全分开**。上报目录仍是 MPW_REPORTS_DIR，但帧走 shots/ 子目录、
    //   自己按"每 id 最多 400 帧"滚动 ⇒ 一个字的 60 份滚动策略都不动（shots 目录也不参与它）。
    //   落盘：<MPW_REPORTS_DIR>/shots/<id>/<ts>-<tag>.<jpg|png> + 同目录 index.jsonl 一行一条元数据。
    //   限制：单帧 >4MB → 413；content-type 非 image/jpeg|image/png → 415；id 不合 ID_PAT 或含 `..` → 400。
    //   返回：{"ok":true,"file":"shots/<id>/<name>","bytes":N}（file 相对 MPW_REPORTS_DIR；绝对路径同时打到服务端 stdout）。
    m = p.match(/^\/shot$/);
    if (m && req.method === 'POST') {
      const q = new URL(req.url || '', 'http://localhost').searchParams;
      const sid = String(q.get('id') || '');
      // tag 只当**文件名片段**用：白名单化（防 `../`、防奇怪字符），限长 64
      const tag = String(q.get('tag') || 'single').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 64) || 'single';
      const tq = String(q.get('t') || '').slice(0, 32);
      const note = String(q.get('note') || '').slice(0, 200);
      const ct = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      // id 安全过滤：与 /pkg/<id> 同一个 ID_PAT（首字符不许是点），并**显式拒 `..`**
      //   （正则允许点号出现在中间，`a..b` 这种仍会经 path.join 语义可疑 ⇒ 直接挡在门外）
      if (!new RegExp('^' + ID_PAT + '$').test(sid) || sid.includes('..')) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'bad id：只接受 [A-Za-z0-9_][A-Za-z0-9_.-]*，拒 `..` / 斜杠 / 空' }));
        return;
      }
      if (ct !== 'image/jpeg' && ct !== 'image/png') {
        res.writeHead(415, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'unsupported content-type: ' + (ct || '(none)') + '（只接受 image/jpeg / image/png 的原始字节）' }));
        return;
      }
      const MAX_SHOT = 4 * 1024 * 1024, HARD_SHOT = 64 * 1024 * 1024;
      const chunks = []; let size = 0, tooBig = false;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_SHOT) {
          // 超限后**继续把 socket 读干净**（不再缓存），到 end 再回 413 ——
          // 这样客户端拿到的是明确的 413 JSON，而不是半路断连的 ECONNRESET。
          tooBig = true;
          if (size > HARD_SHOT) req.destroy();     // 绝对硬上限：再大就不陪它读了
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        if (tooBig) {
          res.writeHead(413, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'frame too large: ' + size + ' > ' + MAX_SHOT + ' bytes（单帧上限 4MB；请降 JPEG 质量或按 1920 宽等比缩小）' }));
          return;
        }
        try {
          const dir = path.join(MPW_REPORTS_DIR, 'shots', sid);
          mkdirSyncSafe(dir);
          const ts = Date.now();
          const ext = ct === 'image/png' ? '.png' : '.jpg';
          // 同名（同一毫秒同一 tag）不覆盖：追加 -2/-3…（连拍 100ms 一帧不会撞，但手快连按 j 会）
          let name = ts + '-' + tag + ext, n = 1;
          while (fs.existsSync(path.join(dir, name))) name = ts + '-' + tag + '-' + (++n) + ext;
          const buf = Buffer.concat(chunks, size);
          pruneShotsId(sid);   // ①(P-104) 写入前检查：本 id 目录已超限就先把最旧的收掉
          fs.writeFileSync(path.join(dir, name), buf);
          const rel = 'shots/' + sid + '/' + name;   // 统一正斜杠（file 字段是给文档/日志看的相对路径）
          // 元数据：一行一条 JSON（追加）。写失败**不影响**这一帧已落盘的事实，只记一行警告。
          // 数字字段用 numOrNull：缺参/非数字 → null，但 **0 是真的 0**（帧号 0 = 首帧，不能被吞掉）。
          const numOrNull = (v) => { const n = Number(v); return (v === null || v === '' || !isFinite(n)) ? null : n };
          try {
            fs.appendFileSync(path.join(dir, 'index.jsonl'), JSON.stringify({
              id: sid, tag, t: tq, note, file: name, rel,
              bytes: buf.length, ts, at: new Date(ts).toISOString(),
              // 画面尺寸/原始尺寸（前端 ?w/?h/?ow/?oh）：只有连拍路径带；单帧 j 也带。
              w: numOrNull(q.get('w')), h: numOrNull(q.get('h')),
              ow: numOrNull(q.get('ow')), oh: numOrNull(q.get('oh')),
              frame: numOrNull(q.get('frame')),
              ua: String(req.headers['user-agent'] || '').replace(/\s+/g, ' ').slice(0, 120),
            }) + '\n');
          } catch (e) { console.warn('[shot] index.jsonl 追加失败：' + (e && e.message)); }
          // 滚动（①P-104 2026-09-17 用户发布纪律②"自动落盘的东西要设上限"）：
          //   **每 id ≤400 帧 + ≤200MB**，再叠一层 **shots/ 全局 ≤500MB**（跨 id 合计，公平地删"所有 id 里
          //   最旧的那一帧"）。三条上限都从 MPW_LIMITS 取（唯一来源）；index.jsonl 是台账，永不删。
          //   与 /report 的"60 份 + 64MB"策略各自独立 —— 两边互不碰对方的目录。
          pruneShotsId(sid);
          pruneShotsAll();
          console.log('[shot] ' + path.join(dir, name) + ' ' + buf.length + 'B tag=' + tag + (tq ? ' t=' + tq : ''));
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, file: rel, bytes: buf.length }));
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: String((e && e.message) || e) }));
        }
      });
      return;
    }
    // ═══ ①(RE-25 场景集成 2026-09-12) 让渲染器能加载"任意来源的 PKG/PKGM 容器" ═══
    //   /pkgurl?u=<encoded url>  服务端代理抓取（绕 CORS，插件宿主只需提供 /raw 流）
    //   /pkgpath?p=<绝对路径>     直接读本地文件（限白名单根，供本机/调试用）
    m = p.match(/^\/pkgurl$/);
    if (m) {
      try {
        const u = new URL(req.url || '', 'http://localhost').searchParams.get('u') || '';
        /* ⓪③(P-204 F7③) 目标闸门：回环 / 显式白名单（改前只判 `^https?://` ⇒ 任意 URL SSRF）。
           拒绝理由逐字进响应体（便于现场定位"为什么我的渲染器链接被挡"）。 */
        const gate = pkgurlTargetAllowed(u, { any: PKGURL_ANY });
        if (!gate.ok) {
          res.writeHead(gate.reason === 'bad-url' || gate.reason === 'bad-scheme' || gate.reason === 'userinfo' ? 400 : 403,
            { 'content-type': 'text/plain; charset=utf-8' })
          res.end('pkgurl denied: ' + gate.reason + (gate.host ? ' (host=' + gate.host + ')' : '')
            + '；只允许回环地址（127.0.0.1/localhost/::1）或 MPW_PKGURL_ALLOW_HOSTS 白名单；'
            + '要放开请显式设 MPW_PKGURL_ANY=1')
          return
        }
        // ⓪③(P-204) **不跟随重定向**：302 到别处等于绕过上面的目标闸门（旧实现 redirect:'follow'）。
        fetch(u, { redirect: 'manual' }).then(async (r) => {
          if (r.status >= 300 && r.status < 400) {
            res.writeHead(502); res.end('upstream redirect blocked (' + r.status + ',' + (r.headers.get('location') || '-') + ')'); return
          }
          if (!r.ok) { res.writeHead(r.status); res.end('upstream ' + r.status); return }
          const buf = Buffer.from(await r.arrayBuffer())
          res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': buf.length, 'cache-control': 'no-cache' })
          res.end(buf)
        }).catch((e) => { res.writeHead(502); res.end('fetch fail: ' + e.message) })
      } catch (e) { res.writeHead(500); res.end(String(e && e.message)) }
      return
    }
    // ═══ ①(用户第22项「MPKG 与 workshop 源目录混合加载」2026-09-14) ═══
    //   渲染器只吃**一个包文件**；这里把 workshop 源目录即时打包成 PKG 容器再喂给它，
    //   于是前端只需把 "目录源" 也当成一个 pkgurl 即可，渲染器与既有链路一行都不用改。
    //   - GET /pkgdir?d=<绝对目录>   → 打包（同一目录按 mtime+条目数缓存）后按 octet-stream 返回
    //   - GET /pkgdir?scan=1[&root=<白名单内目录>] → 列出可直接打包的目录（供前端列表混排）
    //   白名单与 /pkgpath 同款（禁 .. 穿越）。CORS 由 applyCors 统一挂。
    m = p.match(/^\/pkgdir$/);
    if (m) {
      try {
        const q = new URL(req.url || '', 'http://localhost').searchParams
        const ALLOW = MPW_ALLOW_DIRS
        const okPath = (fp) => !!fp && ALLOW.some((a) => fp.startsWith(a)) && !fp.includes('..')
        if (q.get('scan') === '1') {
          const roots = q.get('root') ? [q.get('root')] : ALLOW
          const hits = []
          const walk = (dir, depth) => {
            if (depth > 6) return
            let ents = []
            try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
            const names = new Set(ents.map((e) => e.name))
            if (names.has('scene.pkg') || names.has('project.json')) {
              try { hits.push({ dir, entries: collectFiles(dir).length }) } catch {}
            }
            for (const e of ents) if (e.isDirectory() && !e.isSymbolicLink()) walk(path.join(dir, e.name), depth + 1)
          }
          for (const r of roots) if (okPath(r)) walk(r, 0)
          res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' })
          res.end(JSON.stringify({ ok: true, count: hits.length, dirs: hits }))
          return
        }
        const dir = q.get('d') || ''
        if (!okPath(dir)) { res.writeHead(403); res.end('forbidden'); return }
        let st = null
        try { st = fs.statSync(dir) } catch { res.writeHead(404); res.end('no dir'); return }
        if (!st.isDirectory()) { res.writeHead(400); res.end('not a directory'); return }
        // 缓存键 = 目录 mtime + 条目数（目录内容变了 mtime 会变）；最多留 4 份，防内存膨胀
        const cacheKey = dir + '|' + st.mtimeMs
        let hit = PKGDIR_CACHE.get(cacheKey)
        if (!hit) {
          const packed = packDir(dir)                       // 原样存储，不压缩
          hit = { buf: packed.buf, entries: packed.entries.length, at: Date.now() }
          PKGDIR_CACHE.set(cacheKey, hit)
          if (PKGDIR_CACHE.size > 4) PKGDIR_CACHE.delete(PKGDIR_CACHE.keys().next().value)
          console.log('[pkgdir] 打包 ' + dir + ' → ' + hit.entries + ' 条目 / ' + (hit.buf.length / 1048576).toFixed(2) + ' MiB')
        }
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': hit.buf.length, 'cache-control': 'no-cache', 'x-mpw-pkgdir': String(hit.entries) })
        res.end(hit.buf)
      } catch (e) { res.writeHead(500); res.end('pack failed: ' + (e && e.message || e)) }
      return
    }
    m = p.match(/^\/pkgpath$/);
    if (m) {
      try {
        const fp = new URL(req.url || '', 'http://localhost').searchParams.get('p') || ''
        const ALLOW = MPW_ALLOW_DIRS
        const okPath = ALLOW.some((a) => fp.startsWith(a)) && !fp.includes('..')
        if (!okPath) { res.writeHead(403); res.end('forbidden'); return }
        const st = fs.statSync(fp)
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': st.size, 'cache-control': 'no-cache' })
        res.end(fs.readFileSync(fp))
      } catch (e) { res.writeHead(404); res.end('not found') }
      return
    }
    m = p.match(/^\/project\/(.+)$/);
    if (m) {
      /* ③(2026-09-24) id 可含 `/`（mpkg 一等项的嵌套 itemId）。**属性表来自"条目所在的目录"**：
         目录型 id ⇒ 老口径（`<root>/<id>/project.json`）；文件型 id（`<角色>/<x>.mpkg`）⇒
         退一层到**它的目录**（`<root>/<角色>/project.json`，包旁 JSON 的工坊口径）。
         非法 id（`..`/绝对路径）⇒ 400；找不到 ⇒ 老口径 404 `no project.json`。 */
      let pid = m[1]
      try { pid = decodeURIComponent(pid) } catch { res.writeHead(400); res.end('bad id'); return }
      if (!libItemRel(pid)) { res.writeHead(400); res.end('bad id'); return }
      try {
        //  ①(P-85 2026-09-15) 改用统一查找链：原来只读 <MPW_SCENE_ROOT>/<id>/project.json，语料目录
        //   没有这份文件时（公开副本无 allwallpaper/、语料只留容器）恒 404 → 前端 propsSchema=null
        //   → 属性面板空白、visible:{user:{condition:…}} 全走"缺失→按可见"兜底。现在会兜到本机
        //   Steam 工坊目录里的同名文件。行为保持"返回该 json 的原始体 + application/json"；
        //   命中时额外带 x-project-source: <source>（排查"这份属性表从哪来"）。
        //   ①(P-87) sceneRoot 用 findScene 真正命中的那一档根（语料根 **或** 自带样例父目录），
        //   这样 `?id=sample-synthetic` 的属性表也能读到；两档都没命中时退回既有默认值（行为不变）。
        const sc = findScene(pid);
        let pr = readProjectJson(pid, { root: MPW_ROOT, sceneRoot: sc ? path.dirname(sc.dir) : currentLibraryRoot() });
        let lookedUpAs = pid
        if (!pr) {
          const parent = path.dirname(pid)
          if (parent && parent !== '.' && parent !== pid) {
            pr = readProjectJson(parent, { root: MPW_ROOT, sceneRoot: currentLibraryRoot() })
            if (pr) lookedUpAs = parent
          }
        }
        if (!pr) { res.writeHead(404); res.end('no project.json'); return }
        const buf = fs.readFileSync(pr.path) // 原始字节直出（命中同一文件时与改动前逐字节一致）
        res.writeHead(200, { 'content-type': 'application/json', 'x-project-source': pr.source })
        res.end(buf)
        if (!PROJECT_SOURCE_LOGGED.has(pid)) {
          PROJECT_SOURCE_LOGGED.add(pid);
          console.log('[project] ' + pid + ' ← ' + pr.source + ' (' + pr.path + ')' + (lookedUpAs === pid ? '' : '（文件型条目 ⇒ 取所在目录 ' + lookedUpAs + '）'));
        }
      } catch (e) { res.writeHead(404); res.end('no project.json') }
      return
    }
    m = p.match(/^\/ddlist\/(.+)$/);
    if (m) {
      /* ③(2026-09-24) 同上：嵌套 id 也能列（目录型 = 老口径；文件型 = 它所在的目录，且把该容器本身列进去）。 */
      let lid = m[1]
      try { lid = decodeURIComponent(lid) } catch { res.writeHead(400); res.end('bad id'); return }
      if (!libItemRel(lid)) { res.writeHead(400); res.end('bad id'); return }
      try {
        // ①(P-87) 同样用 findScene 命中的那一档根：`?id=sample-synthetic` 也能列出自带样例目录的文件。
        const sc = findScene(lid);
        const base = sc ? sc.dir : path.join(currentLibraryRoot(), lid)
        const stBase = statSyncSafe(base)
        if (stBase && stBase.isFile()) {
          /* ③文件型条目（`.mpkg` 一等项）：视频在**容器里**，而 `/ddvideo` 只服务磁盘上的松散文件 ⇒
             如实回空表（页面据此继续走"取包 → 容器内视频"那条路），**不编**一个 /ddvideo 取不到的假名字。 */
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: true, files: [], itemRole: 'file', note: '容器型条目：视频在容器内，/ddvideo 只服务磁盘上的松散文件' }))
          return
        }
        const files = fs.readdirSync(base).filter((f) => f !== 'scene.pkg')
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, files }))
      } catch { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, files: [] })) }
      return
    }
    m = p.match(/^\/elysia-video\/(\d+)$/);
    if (m) {
      // elysia CPU 渲染 90 帧 → mp4（后台生成；缓存）
      const mp4 = path.join(TMP_ROOT, 'elysia-render', m[1] + '-video.mp4')
      if (fs.existsSync(mp4)) {
        const st = statSyncSafe(mp4)
        sendFileStream(req, res, mp4, st.size, 'video/mp4')
        return
      }
      res.writeHead(404); res.end('在后台生成中（先 /elysia/<id> 触发）')
      return
    }
    m = p.match(/^\/elysia\/(\d+)$/);
    if (m) {
      const sid = m[1]
      const cached = path.join(TMP_ROOT, 'elysia-render', sid + '.png')
      try {
        if (!fs.existsSync(cached)) {
          const { execFileSync } = await import('node:child_process')
          mkdirSyncSafe(path.join(TMP_ROOT, 'elysia-render'))
          execFileSync('node', [path.join(TMP_ROOT, 'elysia-run', 'render-one.mjs')], { timeout: 600000, env: { ...process.env, ELYSIA_ID: sid } })
        }
        if (fs.existsSync(cached)) {
          const st = statSyncSafe(cached)
          res.writeHead(200, { 'content-type': 'image/png', 'content-length': st.size })
          fs.createReadStream(cached).pipe(res)
          return
        }
        res.writeHead(500); res.end('render fail')
      } catch (e) { res.writeHead(500); res.end(String(e && e.message || e)) }
      return
    }
    m = p.match(/^\/type\/(.+)$/);
    if (m) {
      // ①(P-85 2026-09-15) 同 /project 改走统一查找链（原来也是只读 <MPW_SCENE_ROOT>/<id>/project.json）；
      //   读不到时**逐字保留**既有兜底（ok:true, type:'unknown'），调用方行为不变。
      //   ①(P-87) sceneRoot 同 /project：用 findScene 命中的那一档根（自带样例也能读）。
      /* ③(2026-09-24) id 可含 `/`（mpkg 一等项）；声明在**条目所在目录**的 project.json 里（包旁 JSON）⇒
         目录型走老口径，文件型退一层到它的目录 —— 与 `/project` 同一套口径。
         ⚠ 容器**内**的 project.json 这里不读（那要解包）：本路由只回答"磁盘上声明了什么"，
         读不到就照旧 `type:'unknown'`（页面随后按 `?pkgpath/?id` 取包，容器内类型由容器目录表统一给）。 */
      let tid = m[1]
      try { tid = decodeURIComponent(tid) } catch { res.writeHead(400); res.end('bad id'); return }
      if (!libItemRel(tid)) { res.writeHead(400); res.end('bad id'); return }
      const scT = findScene(tid);
      let pr = readProjectJson(tid, { root: MPW_ROOT, sceneRoot: scT ? path.dirname(scT.dir) : currentLibraryRoot() })
      if (!pr) {
        const parent = path.dirname(tid)
        if (parent && parent !== '.' && parent !== tid) pr = readProjectJson(parent, { root: MPW_ROOT, sceneRoot: currentLibraryRoot() })
      }
      try {
        if (!pr) throw new Error('no project.json')
        const j = pr.json
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, type: j.type || '?', title: j.title || '', file: j.file || '' }))
      } catch { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, type: 'unknown' })) }
      return
    }
    m = p.match(/^\/ddvideo\/(\d+)\/(.+)$/);
    if (m) {
      const rel = decodeURIComponent(m[2])
      const scV = findScene(m[1])                     // 与 /pkg 同一档根（原先只读 MPW_SCENE_ROOT）
      const base = scV ? scV.dir : path.join(currentLibraryRoot(), m[1])
      const full = path.join(base, rel)
      const st = statSyncSafe(full)
      if (full.startsWith(base) && st && st.isFile()) {
        sendFileStream(req, res, full, st.size, 'video/mp4')
        return
      }
      res.writeHead(404); res.end('no video')
      return
    }

    pm(/^\/videolib\/(.+)$/);
    if (m) {
      const rel = decodeURIComponent(m[1])
      const base = path.join(TMP_ROOT, 'loose-cmp')
      const full = path.join(base, rel)
      const st = statSyncSafe(full)
      if (full.startsWith(base) && st && st.isFile()) {
        sendFileStream(req, res, full, st.size, 'video/mp4')
        return
      }
      res.writeHead(404); res.end('no video')
      return
    }

    // ①(预留接口 2026-09-13) 外部扩展钩子：/ext（索引 JSON）+ /ext/<name>（ES 模块）
    //   目录：we-scene-demo/extensions/（不存在时自动创建并放 README）。
    //   页面侧用法：?extbase=http://127.0.0.1:8899/ext 或 ?exthooks=<绝对 URL>
    //   钩子槽位见 EXTENSION-HOOKS.md（resolveTexture / layerRect / shaderSource / postFrame / stats）
    if (p === '/ext' || p === '/ext/') {
      const dir = path.join(REPO_ROOT, 'extensions')
      let hooks = []
      try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        hooks = fs.readdirSync(dir).filter((f) => /\.(m?js)$/.test(f) && !f.startsWith('_'))
      } catch {}
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ ok: true, note: '把扩展模块放进 we-scene-demo/extensions/，页面加 ?extbase=<base>/ext 即自动加载', slots: ['resolveTexture', 'layerRect', 'shaderSource', 'postFrame', 'stats'], hooks }, null, 2))
      return
    }
    m = p.match(/^\/ext\/([\w.-]+)$/);
    if (m) {
      const base = path.join(REPO_ROOT, 'extensions')
      const full = path.join(base, m[1])
      if (full.startsWith(base) && fs.existsSync(full)) {
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' })
        res.end(fs.readFileSync(full))
        return
      }
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: '扩展模块不存在: ' + m[1], hint: '放到 we-scene-demo/extensions/ 下' }))
      return
    }

    // ①(P-86 2026-09-15) 仓库自带字体：`/assets/fonts/<文件>` → **本仓库** `we-scene-demo/assets/fonts/**`。
    //   四级字体链的第二级（demo.html 的 `repoFontUrl()` 生成该 URL；`?repofonts=off` 时不请求它）。
    //   这里只放**我们有权分发**的字体（只从作者/上游取件，**绝不从 `<WE>/assets/fonts/` 复制**），
    //   逐文件许可/版权行/上游 URL/取件日期/sha256 见 THIRD-PARTY.md §4，目录说明见 assets/fonts/README.md。
    //   路径穿越防护与下面 `/weassist/(.+)` 同款（decodeURIComponent 后剥前导 `./`，`path.join` 归一化，
    //   再以 `full.startsWith(base)` 兜底），并**只放行**字体与随附说明这几类扩展名。
    //   content-type 按扩展名给（.ttf → font/ttf、.otf → font/otf），FontFace 与 curl 都能一眼核对。
    m = p.match(/^\/assets\/fonts\/(.+)$/);
    if (m) {
      const rel = decodeURIComponent(m[1]).replace(/^\.+\//, '')
      const base = path.join(REPO_ROOT, 'assets', 'fonts')
      const full = path.join(base, rel)
      const st = statSyncSafe(full)
      const ct = /\.ttf$/i.test(rel) ? 'font/ttf'
        : /\.otf$/i.test(rel) ? 'font/otf'
        : /\.json$/i.test(rel) ? 'application/json'
        : /\.md$/i.test(rel) ? 'text/markdown; charset=utf-8'
          : /\.txt$/i.test(rel) ? 'text/plain; charset=utf-8'
            : null
      if (ct && full.startsWith(base) && st && st.isFile()) {
        sendFileStream(req, res, full, st.size, ct)
        return
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('no repo font');
      return
    }

    m = p.match(/^\/weassist\/(.+)$/);
    if (m) {
      const rel = decodeURIComponent(m[1]).replace(/^\.+\//, '')
      const base = MPW_WE_ASSETS
      const full = path.join(base, rel)
      if (full.startsWith(base) && fs.existsSync(full)) {
        res.writeHead(200, { 'content-type': rel.endsWith('.json') ? 'application/json' : 'application/octet-stream' });
        res.end(fs.readFileSync(full));
        return;
      }
      res.writeHead(404); res.end('no we asset');
      return;
    }

    m = p.match(rePkgRoute());
    if (m) {
      /* ③(2026-09-24) `/pkg/<id>`：**先老口径**（目录型：`<root>/<id>/scene.pkg`，逐字不变），
         再**新增**文件型（`.mpkg`/`.pkg` 一等项：`<root>/<id>` 本身是文件 ⇒ 回容器字节）。
         两条都失败才 404，且 404 文本保持老口径的 `no scene`（既有客户端按它判断"这个包没有"）。 */
      let id = m[1]
      try { id = decodeURIComponent(id) } catch { res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }); res.end('bad id'); return }
      const relOk = !!libItemRel(id)
      if (!relOk) { res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }); res.end('bad id'); return }
      /* ③(2026-10-10) `+` ↔ 空格 **双形态兜底**：本路由只做 `decodeURIComponent`（不把 `+` 还原成空格），
         而调用方可能用 `URLSearchParams` 之类的编码器把空格写成 `+` ⇒ 同一个文件 `%20` 形态 200、
         `+` 形态恒 404（真机实测：`…姐妹日常+(x-ray).mpkg` 404 / `…姐妹日常%20(x-ray).mpkg` 200）。
         这里按「原样 → `+`→空格 → 空格→`+`」依次解析：原样优先 ⇒ 合法含 `+` 的文件名不会被误伤；
         三种形态都不在库里仍如实 404 `no scene`（既有客户端按这段文本判断）。 */
      const idForms = [id]
      const plusToSpace = id.replace(/\+/g, ' ')
      if (plusToSpace !== id) idForms.push(plusToSpace)
      const spaceToPlus = id.replace(/ /g, '+')
      if (spaceToPlus !== id) idForms.push(spaceToPlus)
      let hit = null
      let firstErr = null
      for (const cand of idForms) {
        if (!libItemRel(cand)) continue
        const sc = findScene(cand)
        if (sc) {
          const st = statSyncSafe(sc.pkgPath)
          if (st && st.isFile()) { hit = { file: sc.pkgPath, size: st.size, from: 'scene-dir' }; break }
        }
        for (const root of libraryRoots()) {
          const r = libItemResolve(root, cand)
          if (r.ok) { if (r.isFile && /\.(mpkg|pkg)$/i.test(cand)) { hit = { file: r.full, size: r.st.size, from: 'container-file' }; break } }
          else if (!firstErr) firstErr = r
        }
        /* ①(2026-10-10) 生效根下没有 ⇒ 到**同级兄弟库根**兜底（见 siblingLibraryRoots 的注释：
           真机 :8902 生效根 0923 / 包在 1004 ⇒ 只修名字编码不足以让包可加载）。 */
        if (!hit && /\.(mpkg|pkg)$/i.test(cand)) {
          for (const root of siblingLibraryRoots(currentLibraryRoot())) {
            const r = libItemResolve(root, cand)
            if (r.ok && r.isFile) {
              hit = { file: r.full, size: r.st.size, from: 'sibling-root' }
              try { globalThis.__pkgRootFallback = (globalThis.__pkgRootFallback || 0) + 1 } catch { /* 忽略 */ }
              break
            }
          }
        }
        if (hit) break
      }
      if (!hit) {
        /* 越界（400/403）要如实回，不能糊成 404：这是安全事件，与"这个 id 没有包"是两回事。
           合法的"不存在"仍走下面的老口径 404 `no scene`（既有客户端按这段文本判断）。 */
        if (firstErr && (firstErr.code === 400 || firstErr.code === 403)) {
          res.writeHead(firstErr.code, { 'content-type': 'text/plain; charset=utf-8' });
          res.end((firstErr.code === 403 ? 'forbidden id: ' : 'bad id: ') + firstErr.reason);
          return;
        }
      }
      if (!hit) { res.writeHead(404); res.end('no scene'); return; }
      if (hit.size > PKG_MAX_BYTES) {
        /* 如实 413（不是 500、不是截断）：这一档只有在"包比上限还大"时才发生，说明上限配小了或文件异常。 */
        res.writeHead(413, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('package too large: ' + hit.size + ' bytes > limit ' + PKG_MAX_BYTES
          + ' (MPW_LIMIT_PKG_BYTES) — 请求被拒绝；本路由**不截断**包体');
        return;
      }
      /* 大文件一律**流式**发（本机最大 294MB）：老实现是 `fs.readFileSync(整个包)` ⇒ 单线程里一份
         完整副本进内存。响应字节/Content-Type 与老口径一致（`application/octet-stream`），
         额外带上 content-length + accept-ranges（新增 Range ⇒ 206，纯增量）。 */
      sendFileStream(req, res, hit.file, hit.size, 'application/octet-stream');
      return;
    }

    if (p === '/noise') {
      // ①(P-135 丙) 旧实现：逐个 `fs.readFileSync(整个 scene.pkg)` + parsePkg，直到命中 ——
      //   本机语料顺序下实测 **657.9MB/次**（235.4+59.5+320.6+42.4MB），且发生在单线程里。
      //   现在：每个包的**目录表**只读一次（64KB 起步，缓存），命中包只读那一条条目；
      //   判定顺序/首个命中/响应字节/404 文本全部与旧实现逐字一致（见 server/pkg-entry-index.mjs）。
      for (const id of listRootNames(currentLibraryRoot())) {
        const sc = findScene(id);
        if (!sc) continue;
        const e = pkgEntryIndex.noiseEntry(sc.pkgPath);
        if (e) {
          res.writeHead(200, { 'content-type': 'application/octet-stream' });
          res.end(Buffer.from(pkgEntryIndex.entryBytes(sc.pkgPath, e)));
          return;
        }
      }
      res.writeHead(404); res.end('no noise tex');
      return;
    }

    let rm = p.match(/^\/render\/(\d+)\.png$/);
    if (rm) {
      const sid = rm[1]
      const cached = path.join(TMP_ROOT, 'elysia-render', sid + '.png')
      try {
        if (!fs.existsSync(cached)) {
          // 异步渲染（防阻塞事件循环）；轮询等待最多 120s
          mkdirSyncSafe(path.join(TMP_ROOT, 'elysia-render'))
          try { spawn('node', [path.join(TMP_ROOT, 'elysia-run', 'render-one.mjs'), sid], { env: { ...process.env, ELYSIA_ID: sid }, detached: true, stdio: 'ignore' }).unref() } catch {}
          const wait = async () => {
            for (let i = 0; i < 240; i++) {
              if (fs.existsSync(cached)) return true
              await new Promise((r2) => setTimeout(r2, 500))
            }
            return false
          }
          if (!(await wait())) { res.writeHead(503); res.end('渲染中（超时）'); return }
        }
        const st = statSyncSafe(cached)
        res.writeHead(200, { 'content-type': 'image/png', 'content-length': st.size })
        fs.createReadStream(cached).pipe(res)
        return
      } catch (e) { res.writeHead(500); res.end(String(e && e.message || e)) }
      return
    }

    let refm = p.match(/^\/refrender\/(\d+)$/);
    if (refm) {
      const fp = path.join(path.dirname(fileURLToPath(import.meta.url)), 'refrender-' + refm[1] + '.json')
      if (fs.existsSync(fp)) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(fs.readFileSync(fp)); return }
      res.writeHead(404); res.end('no refrender')
      return
    }
    refm = p.match(/^\/ref\/(\d+)$/);
    if (refm) {
      const fp = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ref-' + refm[1] + '.json')
      if (fs.existsSync(fp)) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(fs.readFileSync(fp)); return }
      res.writeHead(404); res.end('no ref'); return
    }

let trm = p.match(/^\/transpiled\/(\d+)\/(.+)$/);
    if (trm) {
      try {
        const { hlsl2glsl, parsePkg, getEntry } = await import('../core/we-scene-bundle.js')
        const pkgPath = pkgPathOf(trm[1])
        if (!pkgPath) { res.writeHead(404); res.end('no scene'); return }
        const pkg = parsePkg(new Uint8Array(fs.readFileSync(pkgPath)))
        const rel = decodeURIComponent(trm[2])
        const e = pkg.entries.find((x) => x.name === rel)
        if (!e) { res.writeHead(404); res.end('no shader'); return }
        const src = new TextDecoder().decode(getEntry(pkg, e.name))
        const stage = rel.endsWith('.vert') ? 'vert' : 'frag'
        const inc = (n) => {
          n = String(n || '').replace(/^["']|["']$/g, '')
          const ie = pkg.entries.find((x) => x.name === 'shaders/' + n)
          if (ie) return new TextDecoder().decode(getEntry(pkg, ie.name))
          const f = path.join(MPW_WE_ASSETS, 'shaders', n)
          if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8')
          return null
        }
        const out = hlsl2glsl(src, stage, {}, inc)
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end(out)
      } catch (err) { res.writeHead(500); res.end('ERR ' + String(err && err.message || err)) }
      return
    }

    m = p.match(/^\/shader\/(\d+)\/(.+)$/);
    if (m) {
      // ①(P-135 丙) 旧实现**每请求**都 `readFileSync(sc.pkgPath)` + parsePkg（336MB 包 = 每请求 336MB，
      //   每包 4–8 次请求 ⇒ 冷缓存下数 GB 读 + 事件循环长时间独占）。现在只用缓存过的目录表定位条目，
      //   再只读该条目的字节（压缩条目仍走生产解析器解压）。匹配顺序/大小写口径/响应头全部不变。
      const sc = findScene(m[1]);
      if (!sc) { res.writeHead(404); res.end('no scene'); return; }     // 根里没有这个 id ⇒ 404（原先会抛成 500）
      const rel = decodeURIComponent(m[2]);
      const entries = pkgEntryIndex.tableFor(sc.pkgPath).entries;
      for (const c of ['shaders/' + rel, rel]) {
        const e = entries.find((x) => x.path.toLowerCase() === c.toLowerCase());
        if (e) { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(new TextDecoder().decode(pkgEntryIndex.entryBytes(sc.pkgPath, e))); return; }
      }
      res.writeHead(404); res.end('no shader');
      return;
    }

    res.writeHead(404); res.end('not found: ' + p);
  } catch (e) {
    // ①(2026-09-14 公开副本实测崩溃修复) 某些路由在**已经写过响应头**之后才抛错（例如缺文件/流错误），
    //   此时再 writeHead(500) 会抛 ERR_HTTP_HEADERS_SENT —— 未捕获的话整个进程退出，表现为"一请求就崩"。
    //   修法：只在还没发头时写 500；已发头就只结束响应；并打印 URL 便于定位。
    try {
      console.warn('[server] 请求处理异常 ' + (req && req.url) + ' → ' + (e && e.message));
      if (!res.headersSent) { res.writeHead(500); res.end('server error: ' + (e && e.message)) }
      else { try { res.end() } catch {} }
    } catch { /* 兜底：绝不让异常冒泡到进程 */ }
  }
};
/* ⓪② 导出**同一份**处理器：`:8902` 直接 `import { rendererRequestHandler }` 挂到自己 origin 上
   （不复制实现）。契约：调用方负责把 `req.url` 换成"渲染器路由空间"里的路径，本处理器只认 `req.url`。 */
export const rendererRequestHandler = serverHandler;

// ①(2026-09-24) `listen` 只在**本文件是进程入口**时发生 —— 否则 `import` 本模块（:8902 的复用路径、
//   `tests/bench-*` 的纯 Node 断言）会顺手在 8899 端口起一个没人要的服务，直接踩掉用户正在用的端口。
const isMainModule = (() => {
  try {
    const entry = process.argv[1] ? fs.realpathSync(path.resolve(process.argv[1])) : '';
    return entry === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch { return false; }
})();

const osInfo = await import('node:os')

/* ⓪② `server` 只在本文件是入口时创建（`:8902` 复用处理器时不该在这里开监听）。 */
export const server = isMainModule ? http.createServer(serverHandler) : null

if (isMainModule) server.listen(port, BIND_HOST, () => {
  // ①(P-104 2026-09-17 用户发布纪律②) **启动清理一次**：把上次遗留的超限上报目录收回限内，
  //   并在 stdout 打出"删了几个 / 释放多少 MB / 当前上限"（清理动作必须留痕）。
  try { pruneAllOnStartup() } catch (e) { console.warn('[limits] 启动清理失败（不影响服务）：' + (e && e.message)) }
  console.log('[weassist] WE 资产目录: ' + (fs.existsSync(MPW_WE_ASSETS) ? MPW_WE_ASSETS : '未找到（粒子预设/材质兜底将被跳过；可用 MPW_WE_ASSETS 指定）'));
  // ①(P-87 2026-09-15 版权) 场景根必须**如实播报**：真实壁纸已从仓库移除，别让人以为"自带包但打不开"。
  console.log('[scene] 场景根 MPW_SCENE_ROOT=' + MPW_SCENE_ROOT
    + (fs.existsSync(MPW_SCENE_ROOT) ? '' : '（**不存在**：?id= 一律 404）'));
  console.log('        本仓库**不打包任何真实壁纸**（第三方版权）；真实语料请自己放：'
    + 'MPW_SCENE_ROOT=<你的语料根>（形如 <root>/<id>/scene.pkg）或 ?pkgpath=<绝对路径>/scene.pkg。'
    + '随仓库自带的只有程序化生成的合成样例：?id=sample-synthetic');
  const ips = []
  const nets = osInfo.default.networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address)
    }
  }
  /* ⓪③(P-204) 启动日志**如实播报生效的绑定**（改前恒打印 "http://0.0.0.0:port" 并把所有非内网 IPv4
     列成"访问地址" —— 等于把"全网卡可达"当卖点）。只有显式 `MPW_BIND` 放开到非回环时，
     才列局域网地址，并附带一句风险提示。 */
  console.log('we-scene 验证服务器 v2: http://' + BIND_HOST + ':' + port
    + (BIND_IS_LOOPBACK ? '（只回环；要局域网访问请显式 MPW_BIND=0.0.0.0）' : '（**非回环绑定**：同网段可直连，请确认这是你要的）'))
  if (BIND_IS_LOOPBACK) {
    console.log('  访问地址: http://127.0.0.1:' + port)
  } else {
    console.log('  访问地址:', ips.map((i) => 'http://' + i + ':' + port).join('   ') || 'http://127.0.0.1:' + port)
  }
})
