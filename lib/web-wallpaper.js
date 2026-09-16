// web-wallpaper.js —— 「网页（web）类壁纸」支持（宿主侧）
//
// 为什么需要本模块：WE 的 web 类壁纸不走 WebGL。它是**一张网页**：作者脚本在页面加载时
// 调 `window.wallpaperPropertyListener = {…}` / `wallpaperRegisterAudioListener(…)` 之类的
// **WE API**，由 CEF 宿主在作者脚本之前把原生函数装好。本插件此前只是把入口 HTML 塞进
// 裸 iframe（`lib/client.js` 的 `showWebEl`）——没有任何 WE API，于是所有依赖属性/音频/
// 媒体回调的网页壁纸只能显示静态外壳（本模块就是补这一课）。
//
// 本文件做五件事（都在**宿主侧或帧内 shim 里**，渲染器零改动）：
//   ① `detectWebWallpaperKind`：按**内容**判定 web/scene/video/unknown（声明只是线索，不是依据）
//   ② `WEB_SHIM_SOURCE`：WE API shim（注入到 iframe 内，**在作者脚本之前**执行）
//   ③ `rewriteWebEntryHtml`：把 shim（可选种子脚本）插到入口 HTML 的 `<head>` 最前
//   ④ `webAssetCorsHeaders`：跨源策略——只给「沙箱帧的不透明源（Origin: null）」放行读取
//   ⑤ 交互注入（第 11 条）：shim 侧把父页推来的指针/滚轮/键盘按 WE 语义还原成帧内合成 DOM 事件
//      （父页侧的舞台、事件整形与开关状态机在 `lib/web-interaction.js`）
//
// 许可：MIT（本仓库自写）。API 名单与语义**参考**了 `oneincase/webwallgl`（MIT）的实现，
// **未复制其代码**；台账见仓库根 `../docs/COPYING-RULES.md` §4 与 `THIRD-PARTY.md`。
// 与渲染器（GPL-3.0-or-later）的关系：只走 HTTP 协议，不 import/内嵌其任何代码。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

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
  if (signals.scene) return out(WEB_KIND.SCENE, SCENE_PKG_RE.test(signals.scene) ? 'scene-container' : 'scene-json', signals.scene);
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

/** 读并解析目录里的 project.json（缺失/损坏 → null；损坏不抛，交给启发式兜底） */
export function readProjectJson(dir) {
  try {
    const p = join(dir, 'project.json');
    if (!statSync(p).isFile()) return null;
    const obj = JSON.parse(readFileSync(p, 'utf8'));
    return obj && typeof obj === 'object' ? obj : null;
  } catch {
    return null;
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
 *  只有三项：静音（插件「静音」开关）、倍速（插件「视频倍速」）、暂停（插件「暂停壁纸」）。
 *  **不含音量**：网页壁纸自身的音量由作者/其内置设置控制，插件不越权改写（L2D 类的音量滑条
 *  走它自己的 localStorage 设置，不经本策略）。 */
export function webPolicyFromQuery(url) {
  let sp = null;
  try { sp = new URL(String(url), 'http://localhost').searchParams; } catch { return null; }
  if (sp.get(SHIM_QUERY_KEY) !== '1') return null;
  const v = Number(sp.get('mpwspeed'));
  return {
    muted: sp.get('mpwmute') !== '0',
    speed: Number.isFinite(v) && v >= 0.1 && v <= 4 ? v : 1,
    paused: sp.get('mpwpause') === '1',
  };
}

/** 把 JSON 塞进 `<script>` 时防 `</script>` 提前闭合 */
function escapeScriptClose(js) {
  return String(js).replace(/<\/script/gi, '<\\/script');
}

/** 种子脚本：把策略与入口信息放到 `window.__mpwWebSeed`（shim 读它做首帧策略；父页读它做校验） */
export function buildSeedScript(policy, entry) {
  const seed = {
    v: SHIM_VERSION,
    entry: typeof entry === 'string' ? entry : '',
    policy: policy || { muted: true, speed: 1, paused: false },
  };
  return 'window.__mpwWebSeed=' + JSON.stringify(seed) + ';';
}

/**
 * 把 WE API shim（+ 可选种子脚本）插到入口 HTML 里，保证作者脚本执行前 shim 已在位。
 *
 * 插入点：`<head>` 开始标签之后 > `<html>` 之后（自造 head）> 整段前缀（残缺 HTML）。
 * 幂等：已含 `data-mpw-we-shim` / `data-mpw-we-shim-src` 则原样返回（父页重复注入不会叠加）。
 * 不做 `<base>` 注入：入口 URL 是**路径式**（`/custom-folder/<名>/index.html`），
 * 相对资源天然按同目录解析（见 `lib/index.js` 的 `/custom-folder`、`/library-web` 路由）。
 */
export function rewriteWebEntryHtml(html, opts = {}) {
  const src = typeof html === 'string' ? html : '';
  if (/data-mpw-we-shim(=|[\s>"'])/i.test(src)) return src;
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
  // 交互注入（第 11 条）：指针 / 滚轮 / 键盘 / 失焦 / 交互模式开关
  'pointer', 'wheel', 'key', 'blur', 'interact',
];

/**
 * 与参考实现（`oneincase/webwallgl`，MIT，本机研读副本，**未 vendored**）的差异台账。
 * 用途：文档表格 + 测试断言「覆盖了核心批次、且差异是有意为之」。
 */
export const WEB_SHIM_REFERENCE = {
  project: 'oneincase/webwallgl',
  spdx: 'MIT',
  commit: 'b61e8910ae0a176288aed99ce9a93a13ea07df57',
  vendored: false,
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
  /** 参考实现有、本实现**已对齐语义**的非 API 能力（第 11 条起；逐条证据见 docs/WEB-WALLPAPER.md §11） */
  portedFeatures: [
    '合成指针/滚轮/键盘事件注入（按命中元素派发 + click 边缘合成 + button:-1 哨兵）',
    '指针离开补 out/leave 链 + 补一次 up（作者 hover/按下态复位）',
    '滚轮同时发现代 wheel 与 legacy mousewheel（wheelDelta 与 deltaY 反号）',
  ],
  /** 参考实现有、本实现**有意不做**的（附理由，测试按此表断言） */
  notCovered: [
    'setTimeout/setInterval 冻结（暂停语义）',
    'rAF 挂起与恢复（自递归主循环补跑）',
    '媒体音量覆写（volume/muted 原型钩子）',
    'wallpaperPropertyListener 的 whenPageReady 时序',
    '合成事件点亮 CSS :hover / :active（合成事件固有边界，非实现缺陷）',
  ],
  /** 本实现独有（为「插件侧宿主 + 沙箱帧」这套架构而加） */
  extras: ['__mpwWebSeed 种子脚本', 'postMessage 控制通道（op 白名单）', '作者脚本错误上报（error/unhandledrejection）'],
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
  function baseHref() {
    try { return String((D && D.baseURI) || (W.location && W.location.href) || ""); } catch (e) { return ""; }
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

  // ===== 帧内媒体策略（静音/倍速/暂停）=====
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
    if (op === "ping") { post({ op: "pong", v: W.__mpwWebShimVersion, href: baseHref() }); return true; }
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
      sweepMedia();
      return true;
    }
    // ===== 交互注入（父页把宿主舞台上的指针/滚轮/键盘按 WE 语义还原成帧内 DOM 事件）=====
    if (op === "pointer") { ptrPushPointer(msg.x, msg.y, msg.buttons, msg.mods); return true; }
    if (op === "wheel") { ptrPushWheel(msg.x, msg.y, msg.dx, msg.dy, msg.mode, msg.mods); return true; }
    if (op === "key") { ptrPushKey(msg); return true; }
    if (op === "blur") { ptrLeave(); return true; }
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
      if (sp.paused) pausedKnown = true;
    }
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
  post({ op: "ready", v: W.__mpwWebShimVersion, href: baseHref() });
})();`;
