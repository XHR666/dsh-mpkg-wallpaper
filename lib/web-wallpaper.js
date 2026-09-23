// web-wallpaper.js —— 「网页（web）类壁纸」支持（宿主侧）
//
// 为什么需要本模块：WE 的 web 类壁纸不走 WebGL。它是**一张网页**：作者脚本在页面加载时
// 调 `window.wallpaperPropertyListener = {…}` / `wallpaperRegisterAudioListener(…)` 之类的
// **WE API**，由 CEF 宿主在作者脚本之前把原生函数装好。本插件此前只是把入口 HTML 塞进
// 裸 iframe（`lib/client.js` 的 `showWebEl`）——没有任何 WE API，于是所有依赖属性/音频/
// 媒体回调的网页壁纸只能显示静态外壳（本模块就是补这一课）。
//
// 本文件做七件事（都在**宿主侧或帧内 shim 里**，渲染器零改动）：
//   ① `detectWebWallpaperKind`：按**内容**判定 web/scene/video/unknown（声明只是线索，不是依据）
//   ② `WEB_SHIM_SOURCE`：WE API shim（注入到 iframe 内，**在作者脚本之前**执行）
//   ③ `rewriteWebEntryHtml`：把 shim（可选种子脚本）插到入口 HTML 的 `<head>` 最前
//   ④ `webAssetCorsHeaders`：跨源策略——只给「沙箱帧的不透明源（Origin: null）」放行读取
//   ⑤ 交互注入（第 11 条）：shim 侧把父页推来的指针/滚轮/键盘按 WE 语义还原成帧内合成 DOM 事件
//      （父页侧的舞台、事件整形与开关状态机在 `lib/web-interaction.js`）
//   ⑥ ①(WP-1 2026-09-19) 帧内**存储 facade**：不透明源下真 `localStorage` 访问会抛 SecurityError
//      （本机语料 8 张 web 壁纸里 5 张读它 ⇒ 一读就抛，作者设置/存档全废）；facade 提供同步读写 +
//      经宿主 `/web-store` 路由持久化（按壁纸隔离、有界）。默认开；`?mpwstore=0` 关 = 逐字节旧行为。
//   ⑦ ①(WP-1 2026-09-19) **主音量**（宿主音量 × 作者页面内音量）与 HTML **源级 file:/// 改写**
//      + CSP 阻塞检测：补上「作者在 HTML 里直接写 file:///」与「页面 CSP 挡 inline shim」这两类
//      运行时钩子覆盖不到的情况（CSP 判定照抄上游，见 `THIRD-PARTY.md` §5）。
//
// 许可：MIT（本仓库自写）。API 名单与语义**参考**了 `oneincase/webwallgl`（MIT）的实现；
// 其中 `hasBlockingCsp` 一处**照抄**（MIT 允许；逐行出处与免责声明见 `THIRD-PARTY.md` §5），
// 其余为自写。台账见仓库根 `../docs/COPYING-RULES.md` §4 与 `THIRD-PARTY.md`。
// 与渲染器（GPL-3.0-or-later）的关系：只走 HTTP 协议，不 import/内嵌其任何代码。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
// ①(WP-2 2026-09-19) 帧内**触摸代理**源码：由本模块在注入 shim 时一并求值（见文末 `${WEB_TOUCH_FRAME_SOURCE}`）。
//  为什么要 import 而不是复制一份：触摸的协议形状（`op:'touch'` 的字段表）与父页整形体同在
//  lib/web-interaction.js，**唯一源**不能有两份（tools/web-interaction-test.mjs 会断言两侧一致）。
import { WEB_TOUCH_FRAME_SOURCE } from './web-interaction.js';
// ①(2026-09-24 包内/包旁 JSON 收口线) 官方随包 JSON 的**宽容解析**：**复用宿主侧那一份**
//   （`lib/pkg-extract.js` 的 MPW-WEJSON 块，P-177 同口径：先 JSON.parse → 字符串外尾逗号 → 再不行剥注释；
//   BOM 吃掉；真坏 JSON 仍然抛）。为什么必须共享而不是在本文件再写一遍：本仓已有两份同语义实现
//   （`lib/client.js` 浏览器内联副本 + `lib/pkg-extract.js` 宿主侧），tools/we-json-tolerance-test.mjs
//   把两处切片逐夹具对拍防漂移 —— 再加第三份就是三处漂移面。
//   ⚠ 本模块是**宿主侧** ESM（Node），与 `lib/index.js` 同一个模块图（bundle 的模块表因此不变）。
import { mpwParseWeJson, mpwWeJsonSwallowed } from './pkg-extract.js';

/** 类型判定结果（四态 + 排除态） */
export const WEB_KIND = { WEB: 'web', SCENE: 'scene', VIDEO: 'video', UNKNOWN: 'unknown' };

/** shim `<script>` 的标记属性：`rewriteWebEntryHtml` 用它做幂等与顺序断言 */
export const SHIM_ATTR = 'data-mpw-we-shim';

/** 请求入口 HTML 时携带的查询标记：宿主据此注入 shim（缺省=不注入，旧 URL 行为不变） */
export const SHIM_QUERY_KEY = 'mpwshim';

/** shim 与父页（插件）之间的 postMessage 协议标记 */
export const SHIM_MSG = 'mpw:web';

/** shim 版本（父页握手校验用） */
export const SHIM_VERSION = 1;

/** 帧内存储 facade 的查询开关：缺省开（`mpwstore=0` 关 = 完全不装 facade，退回旧行为）。
 *  为什么需要开关：① 逐字节负面对照（关掉时注入的种子与帧内行为与改动前一致）；
 *  ② 极端页面上作者的存储语义与我们的内存 facade 冲突时的逃生门（不影响渲染主路径）。 */
export const WEB_STORE_QUERY_KEY = 'mpwstore';

/** 帧内存储 facade 的**写回落点**（宿主路由，见 lib/index.js）。用绝对路径：
 *  帧的文档 URL 是 `/custom-folder/<目录>/index.html`，绝对路径不受目录影响。
 *  写请求用 `text/plain` 正文（CORS 简单请求 ⇒ 不触发 preflight，不透明源下才可靠）。 */
export const WEB_STORE_ROUTE = '/api/mpkg-wallpaper/web-store';

/** 存储上限（帧内 facade 与宿主路由**同一套**，两边都判：帧内抛 QuotaExceededError，
 *  宿主再兜一次，跨版本客户端/恶意页面都撑不爆磁盘）。 */
export const WEB_STORE_MAX_KEYS = 64;
export const WEB_STORE_MAX_VALUE = 4096;
export const WEB_STORE_MAX_BYTES = 65536;
/** 单张壁纸的存储配额（宿主侧每张壁纸一份快照；超出按最旧淘汰） */
export const WEB_STORE_MAX_WALLS = 64;

/** ①(WP-1) 宿主侧「媒体音频控制」的默认档：**默认仍静音**（与改动前一致，见 docs §13）。
 *  这条不是给网页壁纸专用的：video 类壁纸的 <video> 默认 muted（lib/client.js），
 *  本状态是宿主对外的**权威口径**：宿主（或 UI 线）显式打开前，`audible` 恒 false。 */
export const MEDIA_AUDIO_DEFAULTS = Object.freeze({
  muted: true, volume: 1, playing: true, explicit: false, hasAudio: null, source: null, updatedAt: 0,
});

/** 宿主「媒体音频控制」路由（可被宿主/UI 调用；契约见 docs/WEB-WALLPAPER.md §13） */
export const MEDIA_AUDIO_ROUTE = '/api/mpkg-wallpaper/media-audio';

/** 沙箱 iframe 的 `sandbox` 属性：**只要 allow-scripts**。
 *  不给 `allow-same-origin`：给了就是「同源 + 可执行脚本」= 作者脚本能摘掉自己的 sandbox、
 *  直接读宿主 DOM 与 localStorage（DSH 界面/设置全在同一源上）。没有它，iframe 是不透明源，
 *  `parent.document`、`contentDocument`、`localStorage` 一律不可达。
 *  代价：作者页内的 `fetch()` 变成跨源（需 ACAO，见 `webAssetCorsHeaders`）、父页读不到帧内 DOM
 *  （静音/倍速/暂停改由 shim 在帧内执行，经 postMessage 下达）。 */
export const WEB_SANDBOX_ATTR = 'allow-scripts';

/** 兼容模式（同源）属性集：与既有 `showWebEl` 裸 iframe 路径完全一致（零回归 fallback）。
 *  保留原因是 Live2D 类网页壁纸的设置面板依赖「同源 localStorage + contentDocument」，
 *  沙箱模式下这两样都不可达（见 docs/WEB-WALLPAPER.md「已知限制」）。 */
export const WEB_SANDBOX_COMPAT_ATTR = 'allow-scripts allow-same-origin allow-pointer-lock';

/* ═══ ①(2026-09-21 第 9 条) 网页帧模式：**用户可切的三档** ═══
 * 真机读数：**同一张** web 壁纸在「兼容档」能加载、在「沙箱档」加载不了（作者脚本依赖沙箱里
 * 不可用的浏览器能力，典型是帧内 Worker / 同源 localStorage）。既有实现只有"自动"一档
 * （策略挡住就一次性降级），用户无法主动选。
 * 这一层是**唯一判定表**：属性、shim 标记、能不能自动降级、状态文案都由它派生。
 * 客户端 `lib/client.js` 是单文件产物、不能 require 本模块 ⇒ 它**镜像**这张表，
 * 镜像一致性由 tools/web-wallpaper-test.mjs 的三档逐项对拍看住（不靠人肉同步）。
 *
 *   mode         iframe sandbox 属性                  shim 标记  自动降级
 *   auto（默认）  allow-scripts（不透明源）              带         **可以**（策略挡住/shim 没报到 ⇒ 一次性降级兼容档，= 既有行为）
 *   sandbox      allow-scripts（不透明源）              带         **不可以**（用户明确要隔离；失败原因进状态，面板提示"切兼容"）
 *   compat       allow-scripts allow-same-origin …    不带        n/a（已是最宽档）
 */
export const WEB_FRAME_QUERY_KEY = 'webframe';
/** 三档的**规范顺序**（下拉/按钮顺序、文档与门禁都按它）。 */
export const WEB_FRAME_MODES = Object.freeze(['auto', 'sandbox', 'compat']);
export const WEB_FRAME_DEFAULT = 'auto';

/** 任意输入 → 三档之一（未知/空/大小写/空白 → 默认 auto；不抛）。 */
export function normalizeWebFrameMode(raw) {
  const v = String(raw == null ? '' : raw).trim().toLowerCase();
  return WEB_FRAME_MODES.indexOf(v) >= 0 ? v : WEB_FRAME_DEFAULT;
}

/** 从 URL 读 `?webframe=auto|sandbox|compat`（缺省返回 '' = 没写，不是 auto）。 */
export function webFrameFromQuery(url) {
  try {
    const sp = new URL(String(url), 'http://localhost').searchParams;
    const v = sp.get(WEB_FRAME_QUERY_KEY);
    if (v == null) return '';
    const n = String(v).trim().toLowerCase();
    return WEB_FRAME_MODES.indexOf(n) >= 0 ? n : '';
  } catch { return ''; }
}

/** 有效模式：URL 显式指定 > 设置项 > 默认 auto。`source` 说明是谁定的（可查状态要写清"为什么是这档"）。 */
export function resolveWebFrameMode(input = {}) {
  const queryMode = input && input.query != null && input.query !== '' ? normalizeWebFrameMode(input.query) : '';
  if (queryMode) return { mode: queryMode, source: 'query', queryMode };
  const sectionRaw = input && input.section != null ? String(input.section) : '';
  if (sectionRaw.trim() !== '') return { mode: normalizeWebFrameMode(sectionRaw), source: 'setting', queryMode: '' };
  return { mode: WEB_FRAME_DEFAULT, source: 'default', queryMode: '' };
}

/** 该档对应的 iframe `sandbox` 属性（**唯一映射**）。 */
export function webFrameSandboxAttr(mode) {
  return normalizeWebFrameMode(mode) === 'compat' ? WEB_SANDBOX_COMPAT_ATTR : WEB_SANDBOX_ATTR;
}

/** 该档的完整计划：属性 + 是否带 shim 标记 + 能不能自动降级。 */
export function webFramePlan(mode) {
  const m = normalizeWebFrameMode(mode);
  return {
    mode: m,
    attr: webFrameSandboxAttr(m),
    shim: m !== 'compat',
    /** auto 才允许"策略挡住 ⇒ 一次性降级兼容档"；sandbox 是用户明确要求隔离，不自动降。 */
    degradable: m === 'auto',
  };
}

/** 可查状态（面板/探针/文档共用一份形状）：当前用的是哪档 + 为什么 + 有没有降级过。
 *  `degraded/why` 由调用方在真的降级时补（本函数给"未降级"的稳定基线）。 */
export function webFrameStatus(input = {}) {
  const r = resolveWebFrameMode(input);
  const p = webFramePlan(r.mode);
  return {
    mode: p.mode,
    requested: input && input.requested != null && input.requested !== '' ? normalizeWebFrameMode(input.requested) : p.mode,
    source: r.source,
    queryMode: r.queryMode,
    attr: p.attr,
    shim: p.shim,
    degradable: p.degradable,
    degraded: !!(input && input.degraded),
    why: String((input && input.why) || ''),
    reason: String((input && input.reason) || ''),
    at: Number(input && input.at) || 0,
  };
}

/** 视频类扩展名（判定用；`application`/`exe` 一律排除） */
const VIDEO_RE = /\.(mp4|webm|mov|m4v|mkv)$/i;
/** HTML 入口扩展名 */
const HTML_RE = /\.(x?html?)$/i;
/** 场景容器：scene.pkg（官方导出）或 .pkg/.mpkg（同一 PKG 容器） */
const SCENE_PKG_RE = /(^|\/)scene\.pkg$/i;
const ANY_PKG_RE = /\.(pkg|mpkg)$/i;
/** 松散场景目录（scene.json + 纹理） */
const SCENE_JSON_RE = /(^|\/)scene\.json$/i;
/** 绝不放行：可执行/应用类 */
const APP_TYPES = new Set(['application', 'exe', 'app', 'application.exe']);

/** 相对路径规范化：反斜杠→正斜杠、去掉 ./ 前缀与前导 /（判定只看相对名） */
function normalizeRel(name) {
  if (typeof name !== 'string') return '';
  let s = name.trim().replace(/\\/g, '/');
  while (s.startsWith('./')) s = s.slice(2);
  s = s.replace(/^\/+/, '');
  return s;
}

/** 取声明里的类型（`project.json` 的 `general.type`，兼容顶层 `type`；大小写/空白无关） */
export function declaredTypeOf(project) {
  const raw = project && typeof project === 'object'
    ? (project.general && typeof project.general === 'object' ? project.general.type : project.type)
    : null;
  if (typeof raw !== 'string') return null;
  const t = raw.trim().toLowerCase();
  return t ? t : null;
}

/** 取声明里的入口文件（`general.file` / 顶层 `file`） */
export function declaredFileOf(project) {
  const raw = project && typeof project === 'object'
    ? (project.general && typeof project.general === 'object' ? project.general.file : project.file)
    : null;
  if (typeof raw !== 'string') return null;
  const f = normalizeRel(raw);
  return f ? f : null;
}

/** 目录深度（越浅越可能是入口）：`a/b/c.html` → 2 */
function depthOf(rel) {
  let n = 0;
  for (let i = 0; i < rel.length; i++) if (rel[i] === '/') n++;
  return n;
}

/** 在候选里挑入口：浅的优先，同深按字典序（确定性，便于测试与日志复现） */
function pickEntry(list) {
  const sorted = list.slice().sort((a, b) => (depthOf(a) - depthOf(b)) || (a < b ? -1 : a > b ? 1 : 0));
  return sorted[0] || null;
}

/**
 * 按**内容**判定壁纸类型（插件既有教训：只信 `project.json` 的声明会被"声明与内容不符"的包骗到）。
 *
 * 判定顺序（首个命中即返回，顺序本身就是规格）：
 *   1. 声明 `application/exe/app` → unknown（`excluded-application`，绝不放行）
 *   2. 容器/目录里有 `scene.pkg` / `scene.json` / `*.pkg|mpkg` → scene（内容优先，声明 web 也算不符）
 *   3. 声明 video 且目录里真有视频文件 → video
 *   4. 有 HTML 入口（`general.file` 指向的 html > 根 `index.html|htm|xhtml` > 最浅的 html）→ web
 *   5. 有视频文件 → video
 *   6. 只剩声明、内容一条都对不上 → unknown（`declared-unmatched`）
 *   7. 什么都没有 → unknown（`no-files`）
 *
 * @param {{files?: string[], project?: object|null, sizes?: Record<string, number>}} input
 *   files   壁纸目录内的相对文件名（可含子目录，`/` 或 `\` 都行）
 *   project 解析好的 project.json（没有就传 null）
 *   sizes   可选：文件名→字节数；仅用于「多个视频候选时选最大的」（内容优先于名字）
 * @returns {{kind:string, declared:string|null, entry:string|null, reason:string, mismatch:boolean, signals:object}}
 */
export function detectWebWallpaperKind(input = {}) {
  const files = (Array.isArray(input.files) ? input.files : []).map(normalizeRel).filter(Boolean);
  const project = input.project && typeof input.project === 'object' ? input.project : null;
  const sizes = input.sizes && typeof input.sizes === 'object' ? input.sizes : null;
  const declared = declaredTypeOf(project);
  const declaredFile = declaredFileOf(project);

  const hasFile = (rel) => !!rel && files.indexOf(rel) >= 0;
  const signals = {
    scene: files.find((f) => SCENE_PKG_RE.test(f)) || files.find((f) => SCENE_JSON_RE.test(f)) || files.find((f) => ANY_PKG_RE.test(f)) || null,
    html: null,
    video: null,
    declaredFile: hasFile(declaredFile) ? declaredFile : null,
  };

  // HTML 候选（声明入口 > 根 index.* > 最浅）
  const htmls = files.filter((f) => HTML_RE.test(f));
  if (declaredFile && HTML_RE.test(declaredFile) && hasFile(declaredFile)) signals.html = declaredFile;
  else if (htmls.indexOf('index.html') >= 0) signals.html = 'index.html';
  else if (htmls.indexOf('index.htm') >= 0) signals.html = 'index.htm';
  else if (htmls.indexOf('index.xhtml') >= 0) signals.html = 'index.xhtml';
  else signals.html = pickEntry(htmls);

  // 视频候选（声明入口 > 最大的 > 最浅）
  const videos = files.filter((f) => VIDEO_RE.test(f));
  if (declaredFile && VIDEO_RE.test(declaredFile) && hasFile(declaredFile)) signals.video = declaredFile;
  else if (videos.length > 1 && sizes) {
    signals.video = videos.slice().sort((a, b) => (Number(sizes[b]) || 0) - (Number(sizes[a]) || 0))[0];
  } else signals.video = pickEntry(videos);

  const base = { declared, signals, entry: null, mismatch: false, files: files.length };
  const out = (kind, reason, entry) => Object.assign({}, base, {
    kind, reason, entry: entry || null,
    mismatch: !!declared && declared !== kind && !APP_TYPES.has(declared),
  });

  if (declared && APP_TYPES.has(declared)) return out(WEB_KIND.UNKNOWN, 'excluded-application');
  // scene 的 entry = 容器路径（scene.pkg / scene.json / *.pkg），调用方（/custom-dir 扫描）要把它当 media 用
  // ①(2026-09-23 用户第 4 项 / 核验报告 G4) `reason` 原来只分 `scene.pkg` vs 其它 ⇒ 任意名的容器
  //   （`my-wallpaper.pkg` / `xxx.mpkg`，即上面 signals.scene 的**第三个**来源 ANY_PKG_RE）被标成
  //   `scene-json`（"松散场景"），而 kindReason 会原样下发给界面 ⇒ 用户看到错误的判定依据。
  //   判据与挑选 signals.scene 的三个正则**同源**：容器（scene.pkg / *.pkg / *.mpkg）⇒
  //   `scene-container`；只有 `scene.json`（真·松散场景）⇒ `scene-json`。
  if (signals.scene) return out(WEB_KIND.SCENE, ANY_PKG_RE.test(signals.scene) ? 'scene-container' : 'scene-json', signals.scene);
  if (declared === WEB_KIND.VIDEO && signals.video) return out(WEB_KIND.VIDEO, 'declared-video', signals.video);
  if (signals.html) return out(WEB_KIND.WEB, declared === WEB_KIND.WEB ? 'declared-html' : 'html-entry', signals.html);
  if (signals.video) return out(WEB_KIND.VIDEO, 'video-file', signals.video);
  if (declared) return out(WEB_KIND.UNKNOWN, 'declared-unmatched');
  return out(WEB_KIND.UNKNOWN, files.length ? 'no-content' : 'no-files');
}

/**
 * 递归列出壁纸目录内的相对文件名（有界：默认深度 4、条数 4000）。
 * 有界的原因：本地库里的壁纸目录可能是几十 GB 的素材树，扫描列表在"选目录"的交互路径上。
 */
export function listWallpaperFiles(root, opts = {}) {
  const maxDepth = Number.isFinite(opts.maxDepth) ? opts.maxDepth : 4;
  const maxFiles = Number.isFinite(opts.maxFiles) ? opts.maxFiles : 4000;
  const out = [];
  const walk = (dir, rel, depth) => {
    if (depth > maxDepth || out.length >= maxFiles) return;
    let ents = [];
    try { ents = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const en of ents) {
      if (out.length >= maxFiles) return;
      if (en.name.startsWith('.')) continue;
      const relPath = rel ? rel + '/' + en.name : en.name;
      if (en.isDirectory()) walk(join(dir, en.name), relPath, depth + 1);
      else if (en.isFile()) out.push(relPath);
    }
  };
  walk(root, '', 0);
  return out;
}

/** 读并解析目录里的 project.json（缺失 → null；损坏 → 记账后 null，交给启发式兜底）。
 *  ①(2026-09-24 包内/包旁 JSON 收口线) 读的是 **WE 目录的 `project.json`**（**包旁**：官方工坊布局里与
 *  `scene.pkg` 同级；本模块的 `detectWallpaperDir` → `detectWebWallpaperKind` 用它做**内容优先**判定，
 *  `general.file` 是网页壁纸入口的第一顺位证据）⇒ 必须容忍官方允许的尾逗号/注释：官方随包发布的
 *  `assets/effects/fluidsimulation/effect.json` 第 402 行自己就带尾逗号（WE 用 jsoncpp 照用），
 *  严格 `JSON.parse` 会把这份**包旁属性表/入口声明**整份丢掉 ⇒ 类型判定只剩文件名启发式、属性推不下去，
 *  而且**日志一行都没有**（改前的 `catch { return null }` 就是这类静默）。
 *  语义保持"读不到就是 null"（缺失 ⇒ null / 真坏 JSON ⇒ 记账后 null，照旧不抛 —— 调用方按启发式兜底）；
 *  `mpwWeJsonSwallowed` 给计数 + 一行诊断（同 where+原因只吵一次）。 */
export function readProjectJson(dir) {
  const p = join(dir, 'project.json');
  let text = null;
  try {
    if (!statSync(p).isFile()) return null;
    text = readFileSync(p, 'utf8');
  } catch { return null; }        // 缺失/损坏的路径/IO 读不到 ⇒ null（原语义；**不是** JSON 问题，不记账成 JSON 坏）
  try {
    const obj = mpwParseWeJson(text);
    return obj && typeof obj === 'object' ? obj : null;
  } catch (e) {
    return mpwWeJsonSwallowed('web-wallpaper:readProjectJson(' + p + ')', e);
  }
}

/**
 * 对一个壁纸目录做**内容优先**判定（`/custom-dir` 扫描与调试用）。
 * 在 `detectWebWallpaperKind` 的基础上补目录相关的产物：完整文件表、project.json、
 * `.mpkg` 集合（"角色收藏夹"里每个 mpkg 是独立壁纸，见 index.js 的 folderMpkg 分支）。
 */
export function detectWallpaperDir(dir, opts = {}) {
  const files = listWallpaperFiles(dir, opts);
  const project = readProjectJson(dir);
  let sizes = null;
  if (opts.sizes !== false) {
    sizes = {};
    for (const f of files) {
      if (!VIDEO_RE.test(f)) continue;
      try { sizes[f] = statSync(join(dir, f)).size; } catch { /* 读不到就按名字挑 */ }
    }
  }
  const det = detectWebWallpaperKind({ files, project, sizes });
  const mpkgs = files.filter((f) => /\.mpkg$/i.test(f));
  return Object.assign({}, det, { files, project, mpkgs });
}

/** 是否为「入口 HTML 请求 shim 注入」的请求（宿主路由用） */export function isShimRequest(url) {
  try {
    return new URL(String(url), 'http://localhost').searchParams.get(SHIM_QUERY_KEY) === '1';
  } catch {
    return false;
  }
}

/** 从入口 URL 的查询串取帧内媒体策略（父页写在 URL 上，shim 首帧就能生效，不必等 postMessage）。
 *  三项：静音（插件「静音」开关）、倍速（插件「视频倍速」）、暂停（插件「暂停壁纸」）。
 *  ①(WP-1) 第四项 `volume` **只在 URL 上真有 `mpwvol` 时才出现在返回对象里**
 *  （缺省不写这个键 ⇒ 默认路径的对象形状与改动前逐字节一致；音量由宿主
 *  `/media-audio` 状态在**种子脚本**里下发，见 docs §13，不往客户端 URL 上加参数）。 */
export function webPolicyFromQuery(url) {
  let sp = null;
  try { sp = new URL(String(url), 'http://localhost').searchParams; } catch { return null; }
  if (sp.get(SHIM_QUERY_KEY) !== '1') return null;
  const v = Number(sp.get('mpwspeed'));
  const out = {
    muted: sp.get('mpwmute') !== '0',
    speed: Number.isFinite(v) && v >= 0.1 && v <= 4 ? v : 1,
    paused: sp.get('mpwpause') === '1',
  };
  if (sp.get('mpwvol') !== null) out.volume = clampVolume(sp.get('mpwvol'));
  return out;
}

/** ①(WP-1) 帧内存储开关：从入口 URL 读 `mpwstore`。
 *  `0` → 完全不装 facade（旧行为）；`mem` → 只装内存 facade（不落宿主盘）；
 *  缺省 → 内存 + 宿主持久化。 */
export function webStoreFromQuery(url) {
  try {
    const sp = new URL(String(url), 'http://localhost').searchParams;
    if (sp.get(SHIM_QUERY_KEY) !== '1') return { on: false, persist: false };
    const raw = sp.get(WEB_STORE_QUERY_KEY);
    if (raw === '0') return { on: false, persist: false };
    if (raw === 'mem') return { on: true, persist: false };
    return { on: true, persist: true };
  } catch {
    return { on: false, persist: false };
  }
}

/** 音量夹取：[0,1]；非有限值 → 1（"没给"比"给成 0"安全，0 会静音整页） */
export function clampVolume(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 1;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * ①(WP-1) 存储快照消毒（宿主与帧内**同一套规则**）：
 * 只留「字符串键 → 字符串值」、条数与字节双重上限、超出即整条丢弃（不截断值——
 * 截断会造出半截 JSON，作者解析时抛错比读不到更糟）。返回**新对象**，不改入参。
 */
export function sanitizeWebStore(raw) {
  const out = Object.create(null);
  if (!raw || typeof raw !== 'object') return Object.assign({}, out);
  let keys = 0, bytes = 0;
  for (const k of Object.keys(raw)) {
    if (keys >= WEB_STORE_MAX_KEYS) break;
    const val = raw[k];
    if (typeof val !== 'string') continue;
    if (!k || k.length > 256 || val.length > WEB_STORE_MAX_VALUE) continue;
    bytes += k.length + val.length;
    if (bytes > WEB_STORE_MAX_BYTES) break;
    out[k] = val;
    keys++;
  }
  return Object.assign({}, out);
}

/** ①(WP-1) 壁纸身份（存储隔离键）：`label + 目录键 + 入口相对路径` 的 sha1 前 12 位。
 *  为什么不直接用绝对路径：① 绝对路径是宿主隐私，不能出现在给帧的种子里；
 *  ② 同名的两个壁纸目录（不同库里的 `web-wall`）必须各存各的。 */
export function webWallId(label, wallKey, relFile) {
  const h = createHash('sha1')
    .update(String(label || '') + '|' + String(wallKey || '') + '|' + String(relFile || ''))
    .digest('hex');
  return h.slice(0, 12);
}

/** ①(WP-1) 宿主「媒体音频控制」状态归一化（纯函数，路由与测试共用一份规则）。
 *  语义（docs §13 的契约）：
 *   · `muted` / `playing` 取布尔；`play:true` ≡ `playing:true`，`pause:true` ≡ `playing:false`；
 *   · `volume` 夹到 [0,1]；`reset:true` 整条回默认（含 explicit=false）；
 *   · **任何显式写入都把 `explicit` 置 true** —— 这是"宿主/UI 已经接管音频"的唯一标记，
 *     插件据此才把宿主音量下发进网页壁纸帧；没显式写过 ⇒ 一个字段都不下发（默认仍静音）。
 *   · `hasAudio` 只接受布尔或 null（客户端可选上报"我这个源到底有没有音轨"）。 */
export function normalizeMediaAudio(patch, prev) {
  const base = Object.assign({}, MEDIA_AUDIO_DEFAULTS, prev && typeof prev === 'object' ? prev : null);
  if (!patch || typeof patch !== 'object') return base;
  if (patch.reset === true) return Object.assign({}, MEDIA_AUDIO_DEFAULTS);
  const next = Object.assign({}, base);
  let touched = false;
  if (patch.muted !== undefined) { next.muted = !!patch.muted; touched = true; }
  if (patch.volume !== undefined) { next.volume = clampVolume(patch.volume); touched = true; }
  if (patch.playing !== undefined) { next.playing = !!patch.playing; touched = true; }
  if (patch.play === true) { next.playing = true; touched = true; }
  if (patch.pause === true) { next.playing = false; touched = true; }
  if (patch.hasAudio === null || typeof patch.hasAudio === 'boolean') { next.hasAudio = patch.hasAudio; touched = true; }
  if (typeof patch.source === 'string' && patch.source) { next.source = patch.source.slice(0, 120); touched = true; }
  if (touched) { next.explicit = true; next.updatedAt = Date.now(); }
  return next;
}

/** ①(WP-1) 对外上报（GET 的响应体形状）：`audible` = 当前**是否真的有声**。
 *  这就是用户第 6 项要的「当前是否有声」上报：默认档 muted=true ⇒ 恒 false。 */
export function mediaAudioReport(state) {
  const s = Object.assign({}, MEDIA_AUDIO_DEFAULTS, state && typeof state === 'object' ? state : null);
  return {
    muted: !!s.muted,
    volume: clampVolume(s.volume),
    playing: !!s.playing,
    audible: !s.muted && clampVolume(s.volume) > 0 && !!s.playing,
    explicit: !!s.explicit,
    hasAudio: s.hasAudio === null || typeof s.hasAudio === 'boolean' ? s.hasAudio : null,
    source: typeof s.source === 'string' ? s.source : null,
    updatedAt: Number(s.updatedAt) || 0,
  };
}

/** ①(WP-1) 网页壁纸帧要用的音频策略：**只有 explicit 时才返回**（否则返回 null ⇒
 *  种子脚本里连 `volume` 键都不出现 = 默认路径逐字节不变）。 */
export function mediaAudioPatchForEntry(state) {
  const s = Object.assign({}, MEDIA_AUDIO_DEFAULTS, state && typeof state === 'object' ? state : null);
  if (!s.explicit) return null;
  return { muted: !!s.muted, volume: clampVolume(s.volume) };
}

/** 把 JSON 塞进 `<script>` 时防 `</script>` 提前闭合 */
function escapeScriptClose(js) {
  return String(js).replace(/<\/script/gi, '<\\/script');
}

/** 种子脚本：把策略与入口信息放到 `window.__mpwWebSeed`（shim 读它做首帧策略；父页读它做校验）。
 *  ①(WP-1) 第三参 `extras` 可选：`{ wall, store }`。**不传时输出与改动前逐字节一致**
 *  （键序 v → entry → policy，且不含任何新键）——这是"关掉新能力时零回归"的机器判据。 */
export function buildSeedScript(policy, entry, extras) {
  const seed = {
    v: SHIM_VERSION,
    entry: typeof entry === 'string' ? entry : '',
    policy: policy || { muted: true, speed: 1, paused: false },
  };
  if (extras && typeof extras === 'object') {
    if (typeof extras.wall === 'string' && extras.wall) seed.wall = extras.wall;
    if (extras.store !== undefined) seed.store = extras.store;
  }
  return 'window.__mpwWebSeed=' + JSON.stringify(seed) + ';';
}

/**
 * ①(WP-1，**照抄**上游 `oneincase/webwallgl`(MIT) `renderer/src/web-rewrite.ts:26-43`)：
 * 页面自带的 CSP 是否会挡掉我们注入的 inline shim（`script-src` 里既无 `'unsafe-inline'`
 * 也无 `*`）。命中 ⇒ 调用方**不要注入**（注了也是被浏览器拒绝的控制台报错），改为原样返回
 * 并留痕，由客户端既有的 2.5s "shim 未报到 → 去标记重载" 兜底（docs §7）。
 * 逐行出处与免责声明：`THIRD-PARTY.md` §5。
 */
export function hasBlockingCsp(html) {
  const re = /<meta[^>]+http-equiv\s*=\s*["']?Content-Security-Policy["']?[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const content =
      (/content\s*=\s*"([^"]*)"/i.exec(tag) || [])[1] ??
      (/content\s*=\s*'([^']*)'/i.exec(tag) || [])[1] ??
      "";
    if (!/script-src/i.test(content)) continue;
    if (/script-src[^;]*'unsafe-inline'/i.test(content)) continue;
    if (/script-src[^;]*\*/i.test(content)) continue;
    return true;
  }
  return false;
}

/** ①(WP-1) `file:///…` → 同源相对/绝对路径（**宿主侧**版本，与 shim 内 `rewriteUrl` 同一口径）。
 *  返回 `''` 表示"映射不了"（绝对系统路径 / 空 / Windows 盘符）——调用方据此决定丢弃还是保留原值。
 *  为什么不复用 shim 那份：那份在帧内、要 `location`；这份在宿主、要知道路由前缀（basePath）。 */
export function fileUrlToPath(value, opts = {}) {
  if (typeof value !== 'string') return '';
  const s = value.trim();
  if (!/^file:/i.test(s)) return '';
  const rest = s.replace(/^file:\/\//i, '').replace(/^\/+/, '');
  if (!rest) return '';
  if (/^[a-zA-Z][:|]/.test(rest)) return '';                     // C:/ 或 C|/ 盘符
  if (/^(Users|home|tmp|var|etc|private|Volumes|storage|sdcard)\//.test(rest)) return '';
  const base = typeof opts.basePath === 'string' ? opts.basePath : '';
  const prefix = base && base.endsWith('/') ? base : (base ? base + '/' : '');
  // 只编码会破坏 URL/属性解析的字符；已存在的 %XX 不动（不重复编码）
  const encoded = rest.replace(/[#?"'<>\\\s]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return prefix + encoded;
}

/**
 * ①(WP-1) HTML **源级** `file:///` 改写：补 `setAttribute`/属性 setter 钩子覆盖不到的形态——
 * 由 HTML 解析器直接产出的属性（作者在 `.html` 里写死 `src="file:///files/a.png"`）与
 * `<style>`/`style=` 里的 `url(file:///…)`。本机语料里 `file:///` 出现在 3 张壁纸的作者脚本中
 * （`0917/884307090` 17+5+2 处等），运行时钩子能覆盖 `style.background`/`el.src` 路径，
 * 但**静态属性**只有源级改写能覆盖（docs §12.5 旧口径已更新）。
 *
 * 只改这两类形态，绝不碰 `<script>` 文本（作者写 `'file:///'+value` 的那种由 shim 运行时钩子在
 * 赋值处合成完整串，源级乱改字符串会破坏作者逻辑）。
 * @returns {{html:string, count:number}} count = 实际改写处数（0 ⇒ html 与入参逐字节相同）
 */
export function rewriteWebFileUrlsInHtml(html, opts = {}) {
  const src = typeof html === 'string' ? html : '';
  if (!src || src.indexOf('file:') < 0) return { html: src, count: 0 };
  let count = 0;
  const sub = (raw) => {
    const next = fileUrlToPath(raw, opts);
    if (!next) return raw;
    count++;
    return next;
  };
  let out = src.replace(/(\s(?:src|href|poster)\s*=\s*)(["'])([^"']*)\2/gi, (m, lead, q, val) =>
    /^file:/i.test(val.trim()) ? lead + q + sub(val) + q : m);
  out = out.replace(/(url\(\s*)(['"]?)([^)'"]*file:[^)'"]*)\2(\s*\))/gi, (m, lead, q, val, tail) =>
    lead + q + sub(val) + q + tail);
  return { html: out, count };
}

/**
 * 把 WE API shim（+ 可选种子脚本）插到入口 HTML 里，保证作者脚本执行前 shim 已在位。
 *
 * 插入点：`<head>` 开始标签之后 > `<html>` 之后（自造 head）> 整段前缀（残缺 HTML）。
 * 幂等：已含 `data-mpw-we-shim` / `data-mpw-we-shim-src` 则原样返回（父页重复注入不会叠加）。
 * 不做 `<base>` 注入：入口 URL 是**路径式**（`/custom-folder/<名>/index.html`），
 * 相对资源天然按同目录解析（见 `lib/index.js` 的 `/custom-folder`、`/library-web` 路由）。
 * ①(WP-1) `opts.fileUrlBase`（路由前缀，形如 `/api/mpkg-wallpaper/custom-folder/<名>/`）：
 * 先做一次**源级** `file:///` 改写（`rewriteWebFileUrlsInHtml`），把作者在 HTML 里写死的
 * `src="file:///…"` 解析成同源资源；不传则完全不动原文（旧调用点零回归）。
 */
export function rewriteWebEntryHtml(html, opts = {}) {
  let src = typeof html === 'string' ? html : '';
  if (/data-mpw-we-shim(=|[\s>"'])/i.test(src)) return src;
  if (opts.fileUrlBase) src = rewriteWebFileUrlsInHtml(src, { basePath: opts.fileUrlBase }).html;
  const shim = typeof opts.shimSource === 'string' && opts.shimSource ? opts.shimSource : WEB_SHIM_SOURCE;
  const inject =
    '<script ' + SHIM_ATTR + '="' + SHIM_VERSION + '">\n' + escapeScriptClose(shim) + '\n</script>' +
    (opts.seedScript ? '\n<script ' + SHIM_ATTR + '-seed="' + SHIM_VERSION + '">\n' + escapeScriptClose(opts.seedScript) + '\n</script>' : '');
  const head = /<head(\s[^>]*)?>/i.exec(src);
  if (head) {
    const at = head.index + head[0].length;
    return src.slice(0, at) + inject + src.slice(at);
  }
  const htmlOpen = /<html(\s[^>]*)?>/i.exec(src);
  if (htmlOpen) {
    const at = htmlOpen.index + htmlOpen[0].length;
    return src.slice(0, at) + '<head>' + inject + '</head>' + src.slice(at);
  }
  return '<!DOCTYPE html><html><head>' + inject + '</head><body>' + src + '</body></html>';
}

/**
 * 壁纸资源路由的跨源头。
 *
 * 沙箱 iframe 是不透明源 ⇒ 帧内 `fetch()`/XHR 属于**跨源请求**，且请求头里的 `Origin`
 * 是字面量 `"null"`。所以只对 `Origin: null` 回 `access-control-allow-origin: null`：
 * 帧内 fetch 能用，而**普通网页**（任何真实站点都带自己的 Origin）拿不到 ACAO，
 * 读不到本机壁纸文件。不带 Origin 的同源 `<script>/<img>` 子资源本来就不需要 CORS。
 *
 * @returns {Record<string,string>|null} 要追加的响应头；null = 不加
 */
export function webAssetCorsHeaders(origin) {
  if (typeof origin !== 'string' || origin.trim() !== 'null') return null;
  return {
    'access-control-allow-origin': 'null',
    'access-control-allow-methods': 'GET, HEAD, OPTIONS',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

/** shim 暴露的 WE API 名单（父页握手、文档表格与测试共用一份） */
export const SHIM_API_NAMES = [
  'wallpaperPropertyListener',
  'wallpaperRegisterAudioListener',
  'wallpaperRegisterMediaPropertiesListener',
  'wallpaperRegisterMediaThumbnailListener',
  'wallpaperRegisterMediaPlaybackListener',
  'wallpaperRegisterMediaTimelineListener',
  'wallpaperRegisterMediaStatusListener',
  'wallpaperRequestRandomFileForProperty',
  'wallpaperMediaIntegration',
  'wallpaperPluginListener',
];

/** 父页 → 帧内的控制指令名单（postMessage `{mpw:'mpw:web', op}`） */
export const SHIM_CONTROL_OPS = [
  'props', 'general', 'pause', 'audio', 'media', 'policy', 'directory', 'directory-remove', 'ping',
  // 交互注入（第 11 条）：指针 / 滚轮 / 键盘 / 触摸 / 失焦 / 交互模式开关
  'pointer', 'wheel', 'key', 'touch', 'blur', 'interact',
];

/**
 * 与参考实现（`oneincase/webwallgl`，MIT，本机研读副本，**未 vendored**）的差异台账。
 * 用途：文档表格 + 测试断言「覆盖了核心批次、且差异是有意为之」。
 * ①(WP-1) 变更：新增 `copied`（**照抄**的逐行出处，MIT 允许，登记在 `THIRD-PARTY.md` §5）；
 * 「媒体音量覆写」从 notCovered 移入 portedFeatures（用户第 6 项要求宿主音量控制 ⇒ 现在做了）。
 */
export const WEB_SHIM_REFERENCE = {
  project: 'oneincase/webwallgl',
  spdx: 'MIT',
  commit: 'b61e8910ae0a176288aed99ce9a93a13ea07df57',
  vendored: false,
  /** ①(WP-1) 照抄的代码（逐行出处；免责声明与许可正文见 THIRD-PARTY.md §5） */
  copied: [
    {
      from: 'renderer/src/web-rewrite.ts:26-43',
      what: 'hasBlockingCsp（页面 CSP 是否挡 inline script 的判定）',
    },
  ],
  /** 参考实现覆盖、本实现也覆盖的 API */
  covered: [
    'wallpaperPropertyListener',
    'wallpaperRegisterAudioListener',
    'wallpaperRegisterMediaPropertiesListener',
    'wallpaperRegisterMediaThumbnailListener',
    'wallpaperRegisterMediaPlaybackListener',
    'wallpaperRegisterMediaTimelineListener',
    'wallpaperRegisterMediaStatusListener',
    'wallpaperRequestRandomFileForProperty',
    'wallpaperMediaIntegration',
    'wallpaperPluginListener',
  ],
  /** 参考实现有、本实现**已对齐语义**的非 API 能力（逐条证据见 docs/WEB-WALLPAPER.md §10/§11） */
  portedFeatures: [
    '合成指针/滚轮/键盘事件注入（按命中元素派发 + click 边缘合成 + button:-1 哨兵）',
    '指针离开补 out/leave 链 + 补一次 up（作者 hover/按下态复位）',
    '滚轮同时发现代 wheel 与 legacy mousewheel（wheelDelta 与 deltaY 反号）',
    '媒体音量覆写（volume/muted 原型钩子 + 主音量；实机口径 = 作者值 × 宿主音量）',
    'CSP 阻塞检测与"不注入 + 留痕"退回策略（hasBlockingCsp，照抄，见 copied）',
  ],
  /** 参考实现有、本实现**有意不做**的（附理由，测试按此表断言） */
  notCovered: [
    'setTimeout/setInterval 冻结（暂停语义）',
    'rAF 挂起与恢复（自递归主循环补跑）',
    'wallpaperPropertyListener 的 whenPageReady 时序',
    '合成事件点亮 CSS :hover / :active（合成事件固有边界，非实现缺陷）',
    '`<base href>` 注入（上游走 blob URL 才需要；我们入口是路径式 URL，作者自带 file: base 由源级改写纠正）',
  ],
  /** 本实现独有（为「插件侧宿主 + 沙箱帧」这套架构而加） */
  extras: [
    '__mpwWebSeed 种子脚本',
    'postMessage 控制通道（op 白名单）',
    '作者脚本错误上报（error/unhandledrejection）',
    '帧内 localStorage/sessionStorage facade（不透明源下真 storage 抛 SecurityError；宿主 /web-store 持久化）',
    '宿主 /media-audio 音量·静音·播放控制 + audible 上报（网页壁纸帧与 video 壁纸共用一套口径）',
    'HTML 源级 file:/// 改写（解析器直接产出的属性，运行时钩子覆盖不到的形态）',
  ],
};

/**
 * WE API shim（注入到 iframe 内、作者脚本之前执行）。
 *
 * 设计要点（每条都对应一个真实失败模式，改错会静默失效）：
 *   · 属性表**缓存后重放**：作者常在 `wallpaperPropertyListener = {…}` 赋值之后才收到回调，
 *     而官方 CEF 是在壁纸挂载时**必发一次全量** applyUserProperties。这里把收到的属性存成表，
 *     赋值当下只登记、**不**同步回调（微任务里再发）——同步回调会重入作者正在执行的
 *     渲染函数（React 类壁纸会因此熔断成白屏）。
 *   · 目录文件（slideshow）：`wallpaperRequestRandomFileForProperty` 从父页推来的池子里随机取，
 *     无文件时回调空串（语料里作者普遍 `if (p) …` 守卫）。
 *   · 媒体监听器**晚注册回放最近一帧**：作者常在 DOMContentLoaded 后才 Register。
 *   · 文件 URL 改写：官方 CEF 以文件系统为源，作者写 `file:///files/x.png`；在 HTTP 路由下
 *     这些 URL 必然 404。这里把 `file:///` 相对段按文档 base 解析成同目录 HTTP URL，
 *     而绝对系统路径（形如 Users/ 或 tmp/ 开头的系统根）无法映射 ⇒ 返回空串（作者侧通常有守卫）。
 *   · 作者脚本抛错一律**兜住并上报**父页（限流 50 条），绝不让一个坏 listener 拖垮插件。
 */
export const WEB_SHIM_SOURCE = `(function () {
  "use strict";
  var W = typeof window !== "undefined" ? window : (typeof self !== "undefined" ? self : this);
  if (!W || W.__mpwWebShimInstalled) return;
  W.__mpwWebShimInstalled = true;
  W.__mpwWebShimVersion = ${SHIM_VERSION};
  var D = W.document || null;
  var MSG = "${SHIM_MSG}";
  var parentWin = null;
  try { parentWin = W.parent && W.parent !== W ? W.parent : null; } catch (e) { parentWin = null; }

  var errBudget = 50;
  function post(msg) {
    if (!parentWin) return;
    try { msg.mpw = MSG; parentWin.postMessage(msg, "*"); } catch (e) { /* 父页不可达：忽略 */ }
  }
  function report(kind, err) {
    if (errBudget <= 0) return;
    errBudget--;
    var msg = "unknown", stack = "";
    try { msg = err && err.message ? String(err.message) : String(err); } catch (e) {}
    try { stack = err && err.stack ? String(err.stack).slice(0, 2000) : ""; } catch (e) {}
    post({ op: "error", kind: kind, message: msg.slice(0, 500), stack: stack });
  }
  function safeCall(fn, a, b) {
    if (typeof fn !== "function") return;
    try { fn(a, b); } catch (e) { report("listener", e); }
  }
  /* ③(2026-09-20 真机修复) 帧内**能力自证**：沙箱（不透明源，无 allow-same-origin）下有些
     浏览器能力会被策略挡掉，而父页读不到帧内 DOM、也就无法自己判断。作者脚本常常**依赖**
     这些能力（PixiJS/Live2D 类 web 壁纸会用 blob URL 建 Worker、用 OffscreenCanvas）
     —— 被挡时作者脚本抛 SecurityError/直接白屏，父页只能看到"什么都没发生"。
     这里在帧内如实探一次并上报，父页据此（配合 error 上报）给出**可判定的降级**：
     自动切到兼容模式（同源）重载一次，并留下可查状态。探测本身全部 try/catch，绝不影响页面。 */
  function probeCaps() {
    var out = { version: 1, opaque: false, storage: null, storageReal: null, worker: null, blobUrl: null, offscreen: null, module: null };
    try { out.opaque = (W.location && W.location.origin === "null") || W.origin === "null"; } catch (e) { out.opaque = null; }
    try { out.storage = (function () { try { W.localStorage.setItem("__mpwProbe", "1"); var v = W.localStorage.getItem("__mpwProbe"); W.localStorage.removeItem("__mpwProbe"); return v === "1" ? "ok" : "mismatch" } catch (e) { return "blocked:" + String(e && e.name || e) } })(); } catch (e) { out.storage = "error"; }
    try { out.storageReal = !!(W.__mpwWebStore && W.__mpwWebStore.real === true); } catch (e) { out.storageReal = null; }
    try {
      var u = W.URL.createObjectURL(new W.Blob(["self.close()"], { type: "application/javascript" }));
      out.blobUrl = "ok";
      try {
        var w = new W.Worker(u);
        out.worker = "ok";
        try { w.terminate(); } catch (e) {}
      } catch (e2) { out.worker = "blocked:" + String(e2 && e2.name || e2) }
      try { W.URL.revokeObjectURL(u); } catch (e3) {}
    } catch (e) { out.blobUrl = "blocked:" + String(e && e.name || e); out.worker = "untested"; }
    try { out.offscreen = (typeof W.OffscreenCanvas === "function") ? "ok" : "absent"; } catch (e) { out.offscreen = "error"; }
    try { out.module = !!(D && D.querySelector && D.querySelector('script[type="module"]')) ? "present" : "absent"; } catch (e) { out.module = "error"; }
    return out;
  }
  // 作者脚本/未捕获 Promise 的错误：只上报，不改变浏览器自己的控制台输出。
  try {
    W.addEventListener("error", function (ev) {
      try {
        var isResource = ev && ev.target && ev.target !== W && ev.target.tagName;
        if (isResource) return;              // 资源 404 之类不算脚本异常，不刷父页日志
        report("error", (ev && (ev.error || ev.message)) || "script error");
      } catch (e) { /* 兜底自身也不能抛 */ }
    }, true);
  } catch (e) {}
  try {
    W.addEventListener("unhandledrejection", function (ev) {
      try { report("rejection", ev && ev.reason); } catch (e) {}
    }, true);
  } catch (e) {}

  // ===== 交互注入：父页把指针/滚轮/键盘事件按 WE 语义还原成合成 DOM 事件 =====
  // 为什么在帧内做：宿主壁纸层是 z-index:-1 + pointer-events:none 的背景层，且帧是**不透明源**
  // 沙箱（父页读不到帧内 DOM）⇒ 作者脚本的 addEventListener 只能由帧内自己派发。
  // 为什么由父页换算坐标：iframe 的盒子未必与窗口原点对齐（宿主页面滚动、祖先 CSS transform 缩放），
  // 那些几何只有父页知道（见 lib/web-interaction.js 的 clientPointInFrame）。
  // 三条硬约束（都有真实失败模式，改错会静默失效）：
  //   ① 按 elementFromPoint 命中元素派发（作者既有挂 canvas 读 offsetX 的，也有挂 document 靠冒泡的）；
  //   ② 移动/悬停类事件的 button 字段必须是 -1（W3C「无按键变化」哨兵）：填 0 会让
  //      GameMaker 一类运行时把"鼠标移过去"记成"左键一直按着"，且永不恢复、无任何报错；
  //   ③ click 只能由 down/up **边缘**合成，且按下与抬起命中同一元素才发（拖拽不发 click）。
  var ptrHas = false, ptrX = 0, ptrY = 0, ptrButtons = 0, ptrMods = 0, ptrTarget = null, ptrDownTarget = null;
  var ptrLastClickAt = 0, ptrLastClickTarget = null, PTR_DBLCLICK_MS = 500, MOD_KEYS = ["ctrlKey", "shiftKey", "altKey", "metaKey"];
  /** 交互模式是否开启（父页 op="interact" 下发）。仅用于自检/诊断；注入本身不依赖它
   *  —— 父页只在交互模式才推事件，帧内多一道门只会制造"父页以为开着、帧内以为关着"的漂移。 */
  var ptrInteractOn = false;

  function ptrRoot() {
    try { return (D && (D.body || D.documentElement)) || null; } catch (e) { return null; }
  }
  function ptrHitTest(x, y) {
    try {
      if (D && typeof D.elementFromPoint === "function") {
        var el = D.elementFromPoint(x, y);
        if (el) return el;
      }
    } catch (e) {}
    return ptrRoot();
  }
  // node → [node, parent, …]：用 parentNode（不是 parentElement），这样 document 也在链上，
  // 作者挂在 document 上的 leave 才收得到。
  function ptrChain(node) {
    var out = [], n = node;
    while (n) { out.push(n); try { n = n.parentNode || null; } catch (e) { n = null; } }
    return out;
  }
  function ptrCommonAncestor(a, b) {
    if (!a || !b) return null;
    var ca = ptrChain(a), cb = ptrChain(b);
    for (var j = 0; j < cb.length; j++) for (var k = 0; k < ca.length; k++) if (ca[k] === cb[j]) return cb[j];
    return null;
  }
  function modFlags(m) {
    return {
      ctrlKey: (m & 1) !== 0, shiftKey: (m & 2) !== 0, altKey: (m & 4) !== 0, metaKey: (m & 8) !== 0
    };
  }
  /** 注意：动态键名用方括号 + 字符串写，**不能**用模板式动态键名 —— 那段写法里的
   *  美元花括号序列会被外层模板字符串吃掉，静默变成坏语法（本仓库已踩过一次）。 */
  function setInitKey(init, key, value) { init[key] = value; }
  function defineRO(ev, key, value) {
    try {
      Object.defineProperty(ev, key, { configurable: true, get: function () { return value; } });
    } catch (e) { try { ev[key] = value; } catch (e2) {} }
  }
  function ptrMakeEvent(type, x, y, o) {
    o = o || {};
    var isPointer = type.indexOf("pointer") === 0;
    var init = {
      bubbles: o.bubbles !== false, cancelable: o.cancelable !== false, composed: true,
      detail: o.detail || 0, clientX: x, clientY: y,
      screenX: x + (Number(W.screenX) || 0), screenY: y + (Number(W.screenY) || 0),
      // 哨兵值：移动/悬停类事件没有按键变化 ⇒ -1（不是 0）
      button: o.button != null ? o.button : -1,
      buttons: o.buttons != null ? o.buttons : ptrButtons,
      movementX: o.movementX || 0, movementY: o.movementY || 0
    };
    var mf = modFlags(ptrMods);
    for (var mi = 0; mi < MOD_KEYS.length; mi++) init[MOD_KEYS[mi]] = mf[MOD_KEYS[mi]];
    if (o.relatedTarget !== undefined) init.relatedTarget = o.relatedTarget || null;
    var patchButton = init.button < 0;
    var ev = null;
    if (isPointer) {
      setInitKey(init, "pointerId", 1);
      setInitKey(init, "pointerType", "mouse");
      setInitKey(init, "isPrimary", true);
      setInitKey(init, "width", 1);
      setInitKey(init, "height", 1);
      setInitKey(init, "pressure", init.buttons ? 0.5 : 0);
      try { if (typeof W.PointerEvent === "function") ev = new W.PointerEvent(type, init); } catch (e) {}
    }
    if (!ev) { try { if (typeof W.MouseEvent === "function") ev = new W.MouseEvent(type, init); } catch (e) {} }
    // Chromium 把 MouseEvent 构造器里的 button:-1 规范成 0（不是钳位，是对 -1 的特殊处理）
    // ⇒ 必须在构造后盖回去，否则"移动 = 左键按下"的坑只在 pointer 路径修好。
    if (ev && patchButton && ev.button !== init.button) defineRO(ev, "button", init.button);
    return ev;
  }
  function ptrDispatch(node, type, x, y, o) {
    if (!node || typeof node.dispatchEvent !== "function") return;
    var ev = ptrMakeEvent(type, x, y, o);
    if (!ev) return;
    try { node.dispatchEvent(ev); } catch (e) { /* 作者某个 handler 抛错不该让整条链断掉 */ }
  }
  /** 命中元素变化时补 out/over/enter/leave 四段（顺序与浏览器一致；leave/enter 不冒泡，逐个发）。 */
  function ptrCrossBoundary(prev, next, x, y) {
    if (prev === next) return;
    var anc = ptrCommonAncestor(prev, next), i;
    if (prev) {
      ptrDispatch(prev, "pointerout", x, y, { relatedTarget: next });
      ptrDispatch(prev, "mouseout", x, y, { relatedTarget: next });
      var leaving = ptrChain(prev);
      for (i = 0; i < leaving.length; i++) {
        if (leaving[i] === anc) break;
        ptrDispatch(leaving[i], "pointerleave", x, y, { bubbles: false, cancelable: false, relatedTarget: next });
        ptrDispatch(leaving[i], "mouseleave", x, y, { bubbles: false, cancelable: false, relatedTarget: next });
      }
    }
    if (next) {
      ptrDispatch(next, "pointerover", x, y, { relatedTarget: prev });
      ptrDispatch(next, "mouseover", x, y, { relatedTarget: prev });
      var entering = [], chain = ptrChain(next);
      for (i = 0; i < chain.length; i++) { if (chain[i] === anc) break; entering.push(chain[i]); }
      for (i = entering.length - 1; i >= 0; i--) {   // enter 由外向内（祖先先收到）
        ptrDispatch(entering[i], "pointerenter", x, y, { bubbles: false, cancelable: false, relatedTarget: prev });
        ptrDispatch(entering[i], "mouseenter", x, y, { bubbles: false, cancelable: false, relatedTarget: prev });
      }
    }
  }
  function ptrPushPointer(x, y, buttons, mods) {
    if (pausedKnown === true) return;   // 暂停 = 冻结渲染进程，注入的事件不该推进作者状态
    var nx = Number(x), ny = Number(y);
    // 非有限值直接丢弃：NaN 进 clientX 会让 elementFromPoint 返回 null，作者的位移积分一次性污染成 NaN
    if (!isFinite(nx) || !isFinite(ny)) return;
    var mask = Number(buttons) || 0;
    if (mods !== undefined && mods !== null) ptrMods = Number(mods) || 0;
    var moved = !ptrHas || nx !== ptrX || ny !== ptrY;
    var maskChanged = mask !== ptrButtons;
    if (!moved && !maskChanged) return;  // 位置与按键都没变 ⇒ 什么都不发（否则"静止也算在动"）
    var dx = ptrHas ? nx - ptrX : 0, dy = ptrHas ? ny - ptrY : 0;
    ptrX = nx; ptrY = ny; ptrHas = true;
    var target = ptrHitTest(nx, ny);
    if (moved) {
      ptrCrossBoundary(ptrTarget, target, nx, ny);
      ptrTarget = target;
      ptrDispatch(target, "pointermove", nx, ny, { movementX: dx, movementY: dy });
      ptrDispatch(target, "mousemove", nx, ny, { movementX: dx, movementY: dy });
    } else ptrTarget = target;
    if (!maskChanged) return;
    var wasDown = (ptrButtons & 1) !== 0, isDown = (mask & 1) !== 0;
    ptrButtons = mask;
    if (isDown === wasDown) return;      // 只变了不消费的位（右键/中键）
    if (isDown) {
      ptrDownTarget = target;
      ptrDispatch(target, "pointerdown", nx, ny, { button: 0, detail: 1 });
      ptrDispatch(target, "mousedown", nx, ny, { button: 0, detail: 1 });
      return;
    }
    ptrDispatch(target, "pointerup", nx, ny, { button: 0, detail: 1 });
    ptrDispatch(target, "mouseup", nx, ny, { button: 0, detail: 1 });
    if (ptrDownTarget && ptrDownTarget === target) {   // down/up 不同元素 = 拖拽 ⇒ 不发 click
      var now = Date.now();
      var isDouble = ptrLastClickTarget === target && now - ptrLastClickAt <= PTR_DBLCLICK_MS;
      ptrDispatch(target, "click", nx, ny, { button: 0, detail: isDouble ? 2 : 1 });
      if (isDouble) { ptrDispatch(target, "dblclick", nx, ny, { button: 0, detail: 2 }); ptrLastClickTarget = null; ptrLastClickAt = 0; }
      else { ptrLastClickTarget = target; ptrLastClickAt = now; }
    }
    ptrDownTarget = null;
  }
  function ptrViewportW() { try { return Number(W.innerWidth) || (D && D.documentElement && D.documentElement.clientWidth) || 0; } catch (e) { return 0; } }
  function ptrViewportH() { try { return Number(W.innerHeight) || (D && D.documentElement && D.documentElement.clientHeight) || 0; } catch (e) { return 0; } }
  /** 现代 wheel 事件（优先真 WheelEvent，环境没有时退回 MouseEvent + 补 delta 字段）。 */
  function ptrDispatchWheel(target, x, y, dx, dy, mode) {
    if (!target || typeof target.dispatchEvent !== "function") return;
    var mf = modFlags(ptrMods);
    var init = {
      bubbles: true, cancelable: true, composed: true, detail: 0, clientX: x, clientY: y,
      screenX: x + (Number(W.screenX) || 0), screenY: y + (Number(W.screenY) || 0),
      button: -1, buttons: ptrButtons,
      ctrlKey: mf.ctrlKey, shiftKey: mf.shiftKey, altKey: mf.altKey, metaKey: mf.metaKey,
      deltaX: dx, deltaY: dy, deltaZ: 0, deltaMode: mode
    };
    var ev = null;
    try { if (typeof W.WheelEvent === "function") ev = new W.WheelEvent("wheel", init); } catch (e) {}
    if (!ev) { try { if (typeof W.MouseEvent === "function") ev = new W.MouseEvent("wheel", init); } catch (e) {} }
    if (!ev) return;
    if (ev.deltaX !== dx) defineRO(ev, "deltaX", dx);
    if (ev.deltaY !== dy) defineRO(ev, "deltaY", dy);
    if (ev.deltaMode !== mode) defineRO(ev, "deltaMode", mode);
    if (ev.button !== -1) defineRO(ev, "button", -1);
    try { target.dispatchEvent(ev); } catch (e) {}
  }
  function ptrPushWheel(x, y, dx, dy, mode, mods) {
    if (pausedKnown === true) return;
    var ndx = Number(dx), ndy = Number(dy);
    // 先转数再判有限（**不要**写 Number(dx)||0：那会把 NaN 静默变成 0，让"非有限值丢弃"形同虚设）
    if (!isFinite(ndx) || !isFinite(ndy)) return;
    if (ndx === 0 && ndy === 0) return;   // 惯性滚动尾声的空事件不发
    if (mods !== undefined && mods !== null) ptrMods = Number(mods) || 0;
    var px = ptrX, py = ptrY;
    if (!ptrHas) { px = ptrViewportW() / 2; py = ptrViewportH() / 2; }  // 锚点取中心，不取 (0,0)
    var nx = Number(x), ny = Number(y);
    if (isFinite(nx) && isFinite(ny)) { px = nx; py = ny; ptrX = nx; ptrY = ny; ptrHas = true; }
    var target = ptrHitTest(px, py);
    if (target !== ptrTarget) { ptrCrossBoundary(ptrTarget, target, px, py); ptrTarget = target; }
    ptrDispatchWheel(target, px, py, ndx, ndy, Number(mode) || 0);
    // 旧式 mousewheel（Chromium 的 legacy alias）：现代 wheel 与它是**同一组合**，两路都发；
    // 语料里消费滚轮的作者多数只听 mousewheel/DOMMouseScroll。wheelDelta 与 deltaY **反号**。
    var linePx = 40, perUnit = (Number(mode) || 0) === 1 ? linePx : ((Number(mode) || 0) === 2 ? (ptrViewportH() || 800) : 1);
    var legacyY = -ndy * perUnit * 1.2, legacyX = -ndx * perUnit * 1.2;
    var ev = ptrMakeEvent("mousewheel", px, py, { button: -1 });
    if (ev) {
      defineRO(ev, "wheelDelta", legacyY);
      defineRO(ev, "wheelDeltaY", legacyY);
      defineRO(ev, "wheelDeltaX", legacyX);
      defineRO(ev, "detail", 0);   // detail 非 0 会抢在 wheelDelta 之前被旧式三元判断采用
      try { if (target && target.dispatchEvent) target.dispatchEvent(ev); } catch (e) {}
    }
  }
  /** 指针离开（去了别的显示器 / 切走窗口）：**必须**补 out/leave 链 + 一次 up。
   *  不发的话作者的 hover 态永久卡住（网格动画一直跑、按下态永不复位）。 */
  function ptrLeave() {
    if ((ptrButtons & 1) !== 0 && ptrTarget) {
      ptrDispatch(ptrTarget, "pointerup", ptrX, ptrY, { button: 0, buttons: 0, detail: 1 });
      ptrDispatch(ptrTarget, "mouseup", ptrX, ptrY, { button: 0, buttons: 0, detail: 1 });
    }
    ptrButtons = 0; ptrDownTarget = null;
    if (ptrTarget) { ptrCrossBoundary(ptrTarget, null, ptrX, ptrY); ptrTarget = null; }
    // 位置与 ptrHas 保留：下次进来时 movement 才是真实位移，而不是从 (0,0) 跳过来的巨大假 delta
  }
  function keyHitTarget() {
    try {
      var ae = D && D.activeElement;
      if (ae && ae !== D.body && ae !== D.documentElement) return ae;
    } catch (e) {}
    return ptrRoot();
  }
  function ptrMakeKeyEvent(type, m) {
    var mf = modFlags(Number(m && m.mods) || 0);
    var init = {
      bubbles: true, cancelable: true, composed: true, view: W,
      key: String((m && m.key) || ""), code: String((m && m.code) || ""),
      repeat: !!(m && m.repeat), isComposing: !!(m && m.composing),
      ctrlKey: mf.ctrlKey, shiftKey: mf.shiftKey, altKey: mf.altKey, metaKey: mf.metaKey
    };
    var ev = null;
    try { if (typeof W.KeyboardEvent === "function") ev = new W.KeyboardEvent(type, init); } catch (e) {}
    if (!ev) {
      try { if (typeof W.Event === "function") ev = new W.Event(type, { bubbles: true, cancelable: true, composed: true }); } catch (e2) {}
    }
    if (!ev) return null;
    var kc = Number(m && m.keyCode) || 0;
    defineRO(ev, "key", init.key);
    defineRO(ev, "code", init.code);
    if (kc) { defineRO(ev, "keyCode", kc); defineRO(ev, "which", kc); defineRO(ev, "charCode", init.key.length === 1 ? init.key.charCodeAt(0) : 0); }
    return ev;
  }
  /** 作者脚本经常用 value + input 事件维护自己的输入状态：合成事件之后必须同步值，
   *  否则"敲了键但输入框不动"（不报错）。用原型上的**原生 setter** 写值 —— 绕过 React 一类
   *  框架在实例上装的值追踪器，再派发 input，让框架自己的 onChange 正常收到。 */
  function applyKeyText(m) {
    var text = String((m && m.text) || "");
    if (!text) return;
    var el = keyHitTarget();
    if (!el) return;
    try {
      var proto = null, tag = String(el.tagName || "").toUpperCase();
      if (tag === "TEXTAREA") proto = W.HTMLTextAreaElement && W.HTMLTextAreaElement.prototype;
      else if (tag === "INPUT") proto = W.HTMLInputElement && W.HTMLInputElement.prototype;
      else if (el.isContentEditable) {
        try { if (D.execCommand) D.execCommand("insertText", false, text); } catch (e) {}
        var evc = new W.Event("input", { bubbles: true, composed: true });
        try { el.dispatchEvent(evc); } catch (e2) {}
        return;
      }
      if (!proto) return;   // 焦点不在可输入元素上：不发 beforeinput/input（不伪造输入语义）
      var desc = Object.getOwnPropertyDescriptor(proto, "value");
      if (!desc || typeof desc.set !== "function") return;
      var cur = String(desc.get.call(el) || "");
      var maxLen = Number(el.maxLength);
      if (isFinite(maxLen) && maxLen > 0 && cur.length + text.length > maxLen) return;
      desc.set.call(el, cur + text);
      try { el.dispatchEvent(new W.Event("input", { bubbles: true, composed: true })); } catch (e3) {}
    } catch (e) { /* 输入注入失败不该影响按键本身的语义 */ }
  }
  function ptrPushKey(m) {
    if (!m || typeof m !== "object") return;
    if (pausedKnown === true) return;
    // 空 key 直接丢弃：作者按 e.key 分派，空串进任何 handler 都是垃圾事件（且会污染
    // "最近一次按键"这类作者状态）；repeat 与修饰键掩码都不构成"有键"。
    if (typeof m.key !== "string" || !m.key) return;
    var down = !!m.down;
    var type = down ? "keydown" : "keyup";
    if (down && m.composing) { try { if (D) D.dispatchEvent(ptrMakeKeyEvent("compositionstart", m)); } catch (e) {} }
    var target = keyHitTarget();
    var ev = ptrMakeKeyEvent(type, m);
    if (ev && target && target.dispatchEvent) { try { target.dispatchEvent(ev); } catch (e) {} }
    if (down && m.text) applyKeyText(m);
  }

  // ===== 属性表：缓存 + 重放 =====
  var userProps = Object.create(null);
  var generalProps = Object.create(null);
  var propertyListener = null;
  var pausedKnown = null;
  var directoryFiles = Object.create(null);

  function snapshotProps() {
    var out = {};
    for (var k in userProps) if (Object.prototype.hasOwnProperty.call(userProps, k)) out[k] = userProps[k];
    return out;
  }
  function deliverProps() {
    if (!propertyListener || typeof propertyListener.applyUserProperties !== "function") return false;
    safeCall(propertyListener.applyUserProperties, snapshotProps());
    return true;
  }
  function deliverGeneral() {
    if (!propertyListener || typeof propertyListener.applyGeneralProperties !== "function") return false;
    safeCall(propertyListener.applyGeneralProperties, generalProps);
    return true;
  }
  function deliverPaused() {
    if (pausedKnown === null || !propertyListener || typeof propertyListener.setPaused !== "function") return false;
    safeCall(propertyListener.setPaused, !!pausedKnown);
    return true;
  }
  function deliverDirectory(prop, files) {
    if (!propertyListener || typeof propertyListener.userDirectoryFilesAddedOrChanged !== "function") return false;
    safeCall(propertyListener.userDirectoryFilesAddedOrChanged, prop, files);
    return true;
  }
  function defer(fn) {
    try { if (typeof W.queueMicrotask === "function") { W.queueMicrotask(fn); return; } } catch (e) {}
    try { W.setTimeout(fn, 0); } catch (e) { try { fn(); } catch (e2) { /* 最后兜底也不抛 */ } }
  }
  function flushAll() {
    deliverProps();
    deliverGeneral();
    deliverPaused();
    for (var p in directoryFiles) {
      if (Object.prototype.hasOwnProperty.call(directoryFiles, p) && directoryFiles[p].length) {
        deliverDirectory(p, directoryFiles[p].slice());
      }
    }
  }
  try {
    Object.defineProperty(W, "wallpaperPropertyListener", {
      configurable: true,
      enumerable: true,
      get: function () { return propertyListener; },
      set: function (v) {
        var next = v && typeof v === "object" ? v : null;
        var had = !!propertyListener;
        propertyListener = next;
        if (!next || had) return;   // 重复赋值不重放：会被「赋值→回调→再赋值」的壁纸自激
        defer(flushAll);
      }
    });
  } catch (e) { W.wallpaperPropertyListener = propertyListener; }

  // ===== 音频 =====
  var audioListener = null;
  W.wallpaperRegisterAudioListener = function (cb) {
    audioListener = typeof cb === "function" ? cb : null;
  };

  // ===== 媒体（5 类；晚注册回放最近一帧）=====
  var mediaListeners = { properties: null, thumbnail: null, playback: null, timeline: null, status: null };
  var lastMedia = { properties: null, thumbnail: null, playback: null, timeline: null, status: null };
  function registerMedia(kind) {
    return function (cb) {
      mediaListeners[kind] = typeof cb === "function" ? cb : null;
      if (mediaListeners[kind] && lastMedia[kind]) safeCall(mediaListeners[kind], lastMedia[kind]);
    };
  }
  W.wallpaperRegisterMediaPropertiesListener = registerMedia("properties");
  W.wallpaperRegisterMediaThumbnailListener = registerMedia("thumbnail");
  W.wallpaperRegisterMediaPlaybackListener = registerMedia("playback");
  W.wallpaperRegisterMediaTimelineListener = registerMedia("timeline");
  W.wallpaperRegisterMediaStatusListener = registerMedia("status");
  // 播放状态枚举：缺省时作者常写成 PLAYBACK_PLAYING || 0，把"播放"误当 0
  W.wallpaperMediaIntegration = { PLAYBACK_STOPPED: 0, PLAYBACK_PLAYING: 1, PLAYBACK_PAUSED: 2 };

  // ===== 插件（iCUE 等硬件灯效；无硬件时空实现，避免作者 if 判断崩）=====
  if (!W.wallpaperPluginListener) W.wallpaperPluginListener = { onPluginLoaded: function () {} };

  // ===== 随机文件（slideshow）=====
  W.wallpaperRequestRandomFileForProperty = function (propertyName, callback) {
    if (typeof callback !== "function") return;
    var prop = String(propertyName || "");
    var list = directoryFiles[prop];
    var path = "";
    if (list && list.length) path = String(list[(Math.random() * list.length) | 0] || "");
    try { callback(prop, path); } catch (e) { report("listener", e); }
  };

  // ===== 文件 URL 改写 =====
  // ①(WP-1) 解析基准优先用 location.href（文档自己的 HTTP URL），baseURI 只作兜底：
  //   作者若写了 <base href="file:///C:/…">，baseURI 就是 file: 协议，用它解析出来的
  //   还是 file: URL（必然加载失败）。location.href 在两条壁纸路由下都是 http(s)，稳。
  function baseHref() {
    try {
      var href = String((W.location && W.location.href) || "");
      if (/^https?:/i.test(href)) return href;
      var bu = String((D && D.baseURI) || "");
      if (/^https?:/i.test(bu)) return bu;
      return href || bu;
    } catch (e) { return ""; }
  }
  function rewriteUrl(value) {
    if (typeof value !== "string") return value;
    if (value.indexOf("url(") >= 0) {
      return value.replace(/url\\(\\s*(['"]?)([^)'"]*?)\\1\\s*\\)/gi, function (m, q, inner) {
        var next = rewriteUrl(inner);
        if (!next) return "none";
        var quote = q || '"';
        return "url(" + quote + next + quote + ")";
      });
    }
    var s = value.replace(/^\\s+|\\s+$/g, "");
    if (!/^file:/i.test(s)) return value;
    var rest = s.replace(/^file:\\/\\//i, "").replace(/^\\/+/, "");
    if (!rest) return "";
    if (/^[a-zA-Z]:/.test(rest)) return "";
    if (/^(Users|home|tmp|var|etc|private|Volumes|storage|sdcard)\\//.test(rest)) return "";
    var base = baseHref();
    if (!base) return "";
    try { return new W.URL(rest, base).href; } catch (e) { return ""; }
  }
  W.__mpwRewriteFileUrl = rewriteUrl;
  function installUrlHooks() {
    try {
      if (W.Element && W.Element.prototype && typeof W.Element.prototype.setAttribute === "function") {
        var origSetAttribute = W.Element.prototype.setAttribute;
        W.Element.prototype.setAttribute = function (name, value) {
          var n = String(name || "").toLowerCase();
          if (n === "src" || n === "href" || n === "poster") value = rewriteUrl(value);
          return origSetAttribute.call(this, name, value);
        };
      }
    } catch (e) {}
    var ctors = ["HTMLImageElement", "HTMLMediaElement", "HTMLSourceElement", "HTMLScriptElement"];
    for (var i = 0; i < ctors.length; i++) {
      try {
        var Ctor = W[ctors[i]];
        if (!Ctor || !Ctor.prototype) continue;
        var desc = Object.getOwnPropertyDescriptor(Ctor.prototype, "src");
        if (!desc || typeof desc.set !== "function") continue;
        Object.defineProperty(Ctor.prototype, "src", {
          configurable: true,
          enumerable: desc.enumerable,
          get: desc.get,
          set: function (v) { desc.set.call(this, rewriteUrl(v)); }
        });
      } catch (e) {}
    }
    try {
      var styleProto = W.CSSStyleDeclaration && W.CSSStyleDeclaration.prototype;
      if (styleProto && typeof styleProto.setProperty === "function") {
        var origSetProperty = styleProto.setProperty;
        styleProto.setProperty = function (name, value, priority) {
          if (typeof value === "string" && /background/i.test(String(name || ""))) value = rewriteUrl(value);
          return origSetProperty.call(this, name, value, priority);
        };
      }
      var styleDesc = W.HTMLElement && Object.getOwnPropertyDescriptor(W.HTMLElement.prototype, "style");
      if (styleDesc && typeof styleDesc.get === "function" && W.Proxy && W.WeakMap) {
        var cache = new W.WeakMap();
        Object.defineProperty(W.HTMLElement.prototype, "style", {
          configurable: true,
          enumerable: styleDesc.enumerable,
          get: function () {
            var raw = styleDesc.get.call(this);
            if (!raw) return raw;
            var hit = cache.get(raw);
            if (hit) return hit;
            var proxy = new W.Proxy(raw, {
              set: function (target, prop, value) {
                if (typeof value === "string" && typeof prop === "string" && /background/i.test(prop)) value = rewriteUrl(value);
                target[prop] = value;
                return true;
              },
              get: function (target, prop) {
                var v = target[prop];
                return typeof v === "function" ? v.bind(target) : v;
              }
            });
            cache.set(raw, proxy);
            return proxy;
          },
          set: styleDesc.set
        });
      }
    } catch (e) {}
  }
  installUrlHooks();

  // ===== ①(WP-1) 帧内存储 facade =====
  // 为什么必须补：沙箱帧是**不透明源**，浏览器对它的 window.localStorage **访问即抛**
  // SecurityError（不是返回 null）。作者脚本里一句 localStorage.getItem('x') 就会把整个
  // 初始化函数打断 —— 本机语料 8 张 web 壁纸里 **5 张**读 localStorage（含 Live2D 类设置面板），
  // 这是"渲染出来但设置/存档全废、甚至白屏"的真因之一（docs §13 语料计数表）。
  // 语义边界（不越权）：
  //   · 真的 localStorage **能用就不动它**（同源测试台/兼容模式），只在访问抛错时装 facade；
  //   · facade 只读写**这张壁纸自己的**键值（宿主按 wallId 隔离，键不含宿主任何信息）；
  //   · 条数/单值/总字节三重上限与宿主同规则，超限抛 QuotaExceededError（与真 storage 同形）；
  //   · 持久化是"异步尽力"：写回 /web-store（text/plain，CORS 简单请求，不透明源下不触发 preflight）；
  //     落盘失败不回灌作者（localStorage 语义本来就是同步内存 + 异步落盘）。
  var storeSeed = null, storeFacade = null, storeInstalled = false, storeSaveTimer = null, storeSavePending = null;
  function storeKeys(obj) { var n = 0; for (var k in obj) if (Object.prototype.hasOwnProperty.call(obj, k)) n++; return n; }
  function storeBytes(obj) { try { return JSON.stringify(obj).length; } catch (e) { return 0; } }
  function storeQuotaError() {
    var msg = "Failed to execute 'setItem' on 'Storage': quota exceeded (mpw web-store limit)";
    try { if (typeof W.DOMException === "function") return new W.DOMException(msg, "QuotaExceededError"); } catch (e) {}
    var err = new Error(msg);
    try { err.name = "QuotaExceededError"; } catch (e2) {}
    return err;
  }
  function storeDrain() {
    if (storeSaveTimer) { try { W.clearTimeout(storeSaveTimer); } catch (e) {} storeSaveTimer = null; }
    var batch = storeSavePending || [];
    storeSavePending = null;
    if (!batch.length) return;
    if (!storeSeed || storeSeed.persist === false || !storeSeed.url || typeof W.fetch !== "function") return;
    for (var i = 0; i < batch.length; i++) {
      try {
        var p = W.fetch(storeSeed.url, {
          method: "POST",
          credentials: "omit",
          headers: { "content-type": "text/plain;charset=utf-8" },
          body: JSON.stringify(batch[i])
        });
        if (p && typeof p.catch === "function") p.catch(function () {});
      } catch (e) { /* 落盘失败不影响作者：内存仍是权威 */ }
    }
  }
  function storeSave(payload) {
    // 持久化：只在种子明确给了持久化通道时排队（mpwstore=mem 或功能关闭时不排队）
    if (!storeSeed || storeSeed.persist === false || !storeSeed.url) return;
    storeSavePending = storeSavePending || [];
    storeSavePending.push(payload);
    if (storeSaveTimer) return;
    storeSaveTimer = W.setTimeout(storeDrain, 400);
  }
  function makeStoreFacade(seed) {
    var mem = Object.create(null);
    var snap = seed && seed.snap && typeof seed.snap === "object" ? seed.snap : null;
    if (snap) for (var sk in snap) if (Object.prototype.hasOwnProperty.call(snap, sk) && typeof snap[sk] === "string") mem[sk] = snap[sk];
    function read(k) { var s = String(k); return Object.prototype.hasOwnProperty.call(mem, s) ? mem[s] : null; }
    function write(k, v) {
      var s = String(k), val = String(v);
      var next = Object.create(null);
      for (var kk in mem) if (Object.prototype.hasOwnProperty.call(mem, kk)) next[kk] = mem[kk];
      next[s] = val;
      if (storeKeys(next) > ${WEB_STORE_MAX_KEYS} || storeBytes(next) > ${WEB_STORE_MAX_BYTES} ||
          val.length > ${WEB_STORE_MAX_VALUE} || s.length > 256) throw storeQuotaError();
      mem = next;
      storeSave({ w: seed && seed.id, k: s, v: val });
      return val;
    }
    function drop(k) {
      var s = String(k);
      if (!Object.prototype.hasOwnProperty.call(mem, s)) return;
      var next = Object.create(null);
      for (var kk in mem) if (Object.prototype.hasOwnProperty.call(mem, kk) && kk !== s) next[kk] = mem[kk];
      mem = next;
      storeSave({ w: seed && seed.id, del: s });
    }
    var api = {
      getItem: function (k) { return read(k); },
      setItem: function (k, v) { write(k, v); },
      removeItem: function (k) { drop(k); },
      clear: function () {
        var was = Object.keys(mem);
        mem = Object.create(null);
        for (var i = 0; i < was.length; i++) storeSave({ w: seed && seed.id, del: was[i] });
      },
      key: function (i) { var ks = Object.keys(mem); var n = Number(i) || 0; return n >= 0 && n < ks.length ? ks[n] : null; },
      length: 0
    };
    try {
      Object.defineProperty(api, "length", { configurable: true, enumerable: true, get: function () { return Object.keys(mem).length; } });
    } catch (e) {}
    W.__mpwWebStore = {
      installed: true,
      persist: !!(seed && seed.id && seed.url && seed.persist !== false),
      snapshot: function () { var o = {}; for (var k in mem) if (Object.prototype.hasOwnProperty.call(mem, k)) o[k] = mem[k]; return o; },
      flush: function () { try { storeDrain(); } catch (e) {} }
    };
    // 真 Storage 还支持 store.foo = '1' 属性写法（语料里有作者这么用）：能上 Proxy 就对齐
    if (W.Proxy) {
      try {
        return new W.Proxy(api, {
          get: function (t, p) {
            // 真 Storage 的 store.foo 读法：mem 里的键优先（length/方法仍在 api 上）
            if (typeof p === "string" && !(p in t) && Object.prototype.hasOwnProperty.call(mem, p)) return mem[p];
            var v = t[p];
            return typeof v === "function" ? v.bind(t) : v;
          },
          set: function (t, p, v) { if (typeof p === "string") write(p, v); return true; },
          has: function (t, p) { return typeof p === "string" ? Object.prototype.hasOwnProperty.call(mem, p) || (p in t) : (p in t); },
          deleteProperty: function (t, p) { if (typeof p === "string") drop(p); return true; },
          ownKeys: function () { return Object.keys(mem); },
          getOwnPropertyDescriptor: function (t, p) {
            if (typeof p === "string" && Object.prototype.hasOwnProperty.call(mem, p)) {
              return { configurable: true, enumerable: true, value: mem[p], writable: true };
            }
            return Object.getOwnPropertyDescriptor(t, p);
          }
        });
      } catch (e) {}
    }
    return api;
  }
  function installStorage(seed) {
    var real = null, broken = false;
    try { real = W.localStorage; } catch (e) { broken = true; }
    if (!broken && real) {                  // 真 storage 可用 ⇒ 一个字节都不动（但留痕，便于诊断/测试判别）
      W.__mpwWebStore = { installed: false, reason: "real-storage" };
      return false;
    }
    var facade = makeStoreFacade(seed);
    var okL = false, okS = false;
    try { Object.defineProperty(W, "localStorage", { configurable: true, enumerable: true, get: function () { return facade; } }); okL = true; } catch (e) {}
    if (!okL) { try { W.localStorage = facade; okL = true; } catch (e) {} }
    // sessionStorage 同源同样抛错；它**不落盘**（会话语义），共用同一份内存实现即可
    try { Object.defineProperty(W, "sessionStorage", { configurable: true, enumerable: true, get: function () { return facade; } }); okS = true; } catch (e) {}
    if (!okS) { try { W.sessionStorage = facade; okS = true; } catch (e) {} }
    storeFacade = facade;
    storeInstalled = okL;
    if (W.__mpwWebStore) W.__mpwWebStore.session = !!okS;
    return okL;
  }

  // ===== ①(WP-1) 主音量（宿主音量 × 作者页面内音量）=====
  // 官方 CEF 的浏览器级主音量与页面内 el.volume **独立相乘**；作者常在 play 前重设
  // volume（语料 new Audio() 2 张、AudioContext 3 张），直接覆盖会被作者回写，所以：
  //   · hook HTMLMediaElement.prototype.volume 的 setter：记作者值 __mpwBaseVol，实际值 = 作者值 × 主音量；
  //   · new Audio() 不进 DOM ⇒ 找不到，包一层构造器登记活实例（WeakRef 优先，退化有界数组）；
  //   · **policy.volume 缺省（undefined）时这套钩子根本不装** ⇒ 默认路径与改动前逐字节同行为。
  var masterVolume = 1, mediaVolDesc = null, volHookOn = false;
  var liveMedia = [];
  function clamp01(v) { var n = Number(v); if (!isFinite(n)) return 0; return n < 0 ? 0 : (n > 1 ? 1 : n); }
  function trackMedia(el) {
    if (!el) return;
    for (var i = 0; i < liveMedia.length; i++) if (liveMedia[i] && liveMedia[i].deref && liveMedia[i].deref() === el) return;
    try {
      if (W.WeakRef) liveMedia.push(new W.WeakRef(el));
      else { if (liveMedia.length > 16) liveMedia.shift(); liveMedia.push({ deref: function () { return el; } }); }
    } catch (e) {}
  }
  function applyVolume(el) {
    if (!volHookOn || !mediaVolDesc || !el) return;
    try {
      var base = el.__mpwBaseVol != null ? el.__mpwBaseVol : 1;
      mediaVolDesc.set.call(el, clamp01(base * masterVolume));
    } catch (e) {}
  }
  function installVolumeHook() {
    if (volHookOn) return true;
    try {
      var proto = W.HTMLMediaElement && W.HTMLMediaElement.prototype;
      if (!proto) return false;
      var d = Object.getOwnPropertyDescriptor(proto, "volume");
      if (!d || typeof d.set !== "function") return false;
      mediaVolDesc = d;
      Object.defineProperty(proto, "volume", {
        configurable: true,
        enumerable: d.enumerable,
        get: function () { return this.__mpwBaseVol != null ? this.__mpwBaseVol : d.get.call(this); },
        set: function (v) { this.__mpwBaseVol = clamp01(v); d.set.call(this, clamp01(this.__mpwBaseVol * masterVolume)); }
      });
      // 已经存在的活实例：把"当前实际音量"当作作者值（迟装钩子时不把作者音量当成 1）
      try {
        var nodes = D ? D.querySelectorAll("audio,video") : [];
        for (var i = 0; i < nodes.length; i++) {
          if (nodes[i].__mpwBaseVol == null) { try { nodes[i].__mpwBaseVol = clamp01(d.get.call(nodes[i])); } catch (e) {} }
          trackMedia(nodes[i]);
        }
      } catch (e) {}
      if (typeof W.Audio === "function" && !W.__mpwAudioTracked) {
        var OrigAudio = W.Audio;
        var Wrapped = function (src) {
          var el = new OrigAudio(src);
          try { trackMedia(el); applyVolume(el); } catch (e) {}
          return el;
        };
        Wrapped.prototype = OrigAudio.prototype;
        try { W.Audio = Wrapped; W.__mpwAudioTracked = 1; } catch (e) {}
      }
      volHookOn = true;
      return true;
    } catch (e) { return false; }
  }
  function setMasterVolume(v) {
    masterVolume = clamp01(v);
    installVolumeHook();
    try {
      var nodes = D ? D.querySelectorAll("audio,video") : [];
      for (var i = 0; i < nodes.length; i++) applyVolume(nodes[i]);
    } catch (e) {}
    for (var j = liveMedia.length - 1; j >= 0; j--) {
      var el = null;
      try { el = liveMedia[j].deref(); } catch (e) { el = null; }
      if (!el) { liveMedia.splice(j, 1); continue; }
      applyVolume(el);
    }
    return masterVolume;
  }
  W.__mpwWebAudio = {
    master: function () { return masterVolume; },
    set: function (v) { return setMasterVolume(v); },
    hooked: function () { return volHookOn; }
  };

  // ===== 帧内媒体策略（静音/倍速/暂停/主音量）=====
  // 沙箱模式下父页读不到帧内 DOM，静音与倍速必须在**帧内**执行：父页只下达策略。
  var policy = { muted: true, speed: 1, paused: false };
  var frozen = [];
  function applyPolicy(el) {
    if (!el) return;
    try {
      if (policy.muted) {
        if (!el.muted) { el.muted = true; el.__mpwPolicyMuted = 1; }
      } else if (el.__mpwPolicyMuted) {
        // 只解开「我们自己静的音」：作者主动 muted 的元素不动
        el.muted = false;
        el.__mpwPolicyMuted = 0;
      }
      if (policy.speed && policy.speed !== 1) el.playbackRate = policy.speed;
      // ①(WP-1) 只有宿主显式接管音量（policy.volume 存在）时才碰 volume
      if (policy.volume !== undefined) { installVolumeHook(); applyVolume(el); trackMedia(el); }
    } catch (e) {}
  }
  function sweepMedia() {
    try {
      var nodes = D ? D.querySelectorAll("audio,video") : [];
      for (var i = 0; i < nodes.length; i++) applyPolicy(nodes[i]);
    } catch (e) {}
  }
  try {
    if (D && typeof D.addEventListener === "function") {
      D.addEventListener("play", function (ev) {
        try {
          var t = ev && ev.target;
          if (t && (t.tagName === "VIDEO" || t.tagName === "AUDIO")) applyPolicy(t);
        } catch (e) {}
      }, true);
    }
  } catch (e) {}
  function watchDom() {
    try {
      if (!D || typeof W.MutationObserver !== "function" || !D.documentElement) return;
      var obs = new W.MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var added = muts[i].addedNodes || [];
          for (var j = 0; j < added.length; j++) {
            var n = added[j];
            if (!n || n.nodeType !== 1) continue;
            if (n.tagName === "VIDEO" || n.tagName === "AUDIO") applyPolicy(n);
            else if (n.querySelectorAll) {
              var inner = n.querySelectorAll("video,audio");
              for (var k = 0; k < inner.length; k++) applyPolicy(inner[k]);
            }
          }
        }
      });
      obs.observe(D.documentElement, { childList: true, subtree: true });
    } catch (e) {}
  }
  function freezeMedia() {
    frozen = [];
    try {
      var nodes = D ? D.querySelectorAll("audio,video") : [];
      for (var i = 0; i < nodes.length; i++) {
        if (!nodes[i].paused) {
          frozen.push(nodes[i]);
          try { nodes[i].pause(); } catch (e) {}
        }
      }
    } catch (e) {}
  }
  function thawMedia() {
    for (var i = 0; i < frozen.length; i++) {
      try { var p = frozen[i].play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
    }
    frozen = [];
  }

  // ===== 父页控制面（postMessage，op 白名单）=====
  function handle(msg) {
    if (!msg || typeof msg !== "object") return false;
    var op = String(msg.op || "");
    if (op === "ping") { post({ op: "pong", v: W.__mpwWebShimVersion, href: baseHref(), caps: probeCaps() }); return true; }
    if (op === "props") {
      var props = msg.props && typeof msg.props === "object" ? msg.props : {};
      for (var k in props) if (Object.prototype.hasOwnProperty.call(props, k)) userProps[k] = props[k];
      return deliverProps();
    }
    if (op === "general") {
      var g = msg.general && typeof msg.general === "object" ? msg.general : {};
      for (var gk in g) if (Object.prototype.hasOwnProperty.call(g, gk)) generalProps[gk] = g[gk];
      return deliverGeneral();
    }
    if (op === "pause") {
      pausedKnown = !!msg.value;
      var ok = deliverPaused();
      if (pausedKnown) { freezeMedia(); if (policy.paused !== true) { policy.paused = true; sweepMedia(); } }
      else { thawMedia(); policy.paused = false; }
      return ok;
    }
    if (op === "policy") {
      if (msg.muted !== undefined) policy.muted = !!msg.muted;
      if (Number.isFinite(Number(msg.speed)) && Number(msg.speed) > 0) policy.speed = Number(msg.speed);
      // ①(WP-1) 宿主主音量：只有显式给了 volume 才装钩子（缺省路径不碰 volume，逐字节旧行为）
      if (msg.volume !== undefined) { policy.volume = setMasterVolume(msg.volume); }
      sweepMedia();
      return true;
    }
    // ===== 交互注入（父页把宿主舞台上的指针/滚轮/键盘按 WE 语义还原成帧内 DOM 事件）=====
    if (op === "pointer") { ptrPushPointer(msg.x, msg.y, msg.buttons, msg.mods); return true; }
    if (op === "wheel") { ptrPushWheel(msg.x, msg.y, msg.dx, msg.dy, msg.mode, msg.mods); return true; }
    if (op === "key") { ptrPushKey(msg); return true; }
    if (op === "blur") { ptrLeave(); return true; }
    // ①(WP-2 2026-09-19) 触摸：交给帧内代理（同一 <script> 里安装的 W.__mpwTouchPush）派发**真 TouchEvent**。
    // 为什么不在这个 handle 里自己发：触摸的目标解析是**隐式捕获**（touchstart 命中谁，后续 move/end 就发给谁）
    // 与三级构造阶梯（Chromium 里 new TouchEvent 非法）两件事，逻辑独立且要能被单测 —— 见 web-interaction.js。
    // 注意：本段在模板字符串里，注释中**不许**出现反引号/美元花括号（会被外层模板吃掉）。
    if (op === "touch") { try { return typeof W.__mpwTouchPush === "function" ? !!W.__mpwTouchPush(msg) : false; } catch (e) { return false; } }
    if (op === "interact") { ptrInteractOn = !!msg.on; if (!ptrInteractOn) ptrLeave(); return true; }
    if (op === "audio") {
      var bands = msg.bands;
      if (audioListener && Array.isArray(bands) && !policy.paused) safeCall(audioListener, bands);
      return true;
    }
    if (op === "media") {
      var payload = msg.payload;
      if (!payload || typeof payload !== "object") return false;
      var kind = String(payload.op || "");
      if (!Object.prototype.hasOwnProperty.call(mediaListeners, kind)) return false;
      lastMedia[kind] = payload;
      safeCall(mediaListeners[kind], payload);
      return true;
    }
    if (op === "directory" || op === "directory-remove") {
      var prop = String(msg.prop || "");
      var list = Array.isArray(msg.files) ? msg.files : [];
      if (!prop) return false;
      if (op === "directory") {
        if (!directoryFiles[prop]) directoryFiles[prop] = [];
        var added = [];
        for (var i = 0; i < list.length; i++) {
          var f = list[i] == null ? "" : String(list[i]);
          if (f && directoryFiles[prop].indexOf(f) < 0) { directoryFiles[prop].push(f); added.push(f); }
        }
        if (added.length) deliverDirectory(prop, added);
        return true;
      }
      var removed = [];
      var kept = [];
      var cur = directoryFiles[prop] || [];
      for (var j = 0; j < cur.length; j++) {
        if (list.indexOf(cur[j]) >= 0) removed.push(cur[j]); else kept.push(cur[j]);
      }
      directoryFiles[prop] = kept;
      if (removed.length && propertyListener && typeof propertyListener.userDirectoryFilesRemoved === "function") {
        safeCall(propertyListener.userDirectoryFilesRemoved, prop, removed);
      }
      return true;
    }
    return false;
  }
  W.__mpwWebControl = handle;
  try {
    if (D && typeof D.addEventListener === "function") {
      D.addEventListener("message", function (ev) {
        try { if (parentWin && ev && ev.source && ev.source !== parentWin) return; } catch (e) {}
        var d = ev && ev.data;
        if (!d || typeof d !== "object" || d.mpw !== MSG) return;
        handle(d);
      }, false);
    }
  } catch (e) {}

  // ===== 首帧策略（种子脚本 / 查询串；父页 postMessage 之前就生效）=====
  try {
    var seed = W.__mpwWebSeed;
    if (seed && seed.policy && typeof seed.policy === "object") {
      var sp = seed.policy;
      if (sp.muted !== undefined) policy.muted = !!sp.muted;
      if (Number.isFinite(Number(sp.speed)) && Number(sp.speed) > 0) policy.speed = Number(sp.speed);
      // ①(WP-1) 宿主音量：种子里有 volume 才启用主音量（缺省 → 一个字节都不动）
      if (sp.volume !== undefined) { policy.volume = setMasterVolume(sp.volume); }
      if (sp.paused) pausedKnown = true;
    }
    // ①(WP-1) 存储 facade：seed.store === false = 显式关闭（mpwstore=0）⇒ 不装，旧行为
    if (seed && seed.store !== undefined && seed.store !== false) {
      storeSeed = seed.store && typeof seed.store === "object" ? seed.store : null;
      installStorage(storeSeed);
    } else if (!seed || seed.store === undefined) {
      // 没有种子信息（旧宿主 / 直接打开页面）：兜底也要给 facade —— 不透明源下真 storage 会抛，
      // 而"抛"是作者脚本静默失效的根源。持久化仅在种子里有 store 时才发生（此处无 ⇒ 纯内存）。
      storeSeed = null;
      installStorage(null);
    }
    if (seed && seed.store === false) W.__mpwWebStore = { installed: false, disabled: true };
  } catch (e) {}
  watchDom();
  if (D) {
    if (D.readyState === "loading") {
      try { D.addEventListener("DOMContentLoaded", function () { sweepMedia(); }, { once: true }); } catch (e) {}
    } else sweepMedia();
  }
  try {
    W.addEventListener("load", function () { sweepMedia(); post({ op: "load" }); }, { once: true });
  } catch (e) {}
  post({ op: "ready", v: W.__mpwWebShimVersion, href: baseHref(), caps: probeCaps() });

  // ===== ①(WP-2 2026-09-19) 帧内触摸代理（唯一源 = lib/web-interaction.js 的 WEB_TOUCH_FRAME_SOURCE）=====
  // 装在同一次求值里（同一个 <script>）：保证"有 shim 就一定有触摸代理"，不需要第二条注入路径，
  // 也就不会有"宿主注入了 shim 但漏了代理 ⇒ op:'touch' 静默失效"这种半吊子状态。
  // 代理自身幂等（W.__mpwTouchAgentVersion 守卫）且在无 DOM 环境直接返回，不会影响任何现有测试桩。
${WEB_TOUCH_FRAME_SOURCE}
})();`;
