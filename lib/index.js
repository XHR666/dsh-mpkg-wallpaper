// dsh-mpkg-wallpaper —— 宿主端（hybrid 模式：大文件流式上传 + Range 播放 + Steam 自动发现）
// 纯客户端逻辑仍在 ./client.js。本文件提供：
//   GET  /api/mpkg-wallpaper/ping                → { ok:true }（客户端探测 host 是否可用）
//   POST /api/mpkg-wallpaper/upload              → 流式接收 mpkg → 存磁盘 → 返回条目索引
//   GET  /api/mpkg-wallpaper/media?token=&index= → Range 流式返回 mpkg 内某个条目
//   GET  /api/mpkg-wallpaper/steam-inventory     → (Windows) 自动发现壁纸引擎安装与壁纸列表
import { createWriteStream, createReadStream, mkdirSync, existsSync, statSync, readFileSync, readdirSync, writeFileSync, openSync, readSync, closeSync, renameSync, unlinkSync, chmodSync, writeSync, utimesSync } from 'node:fs';
import { join, resolve, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
// tmpdir 不再使用（持久目录用 DATA_DIR）
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
// ①(新) scene.pkg 静态帧提取（MIT，来自 elysia395/dsh-wallpaper-engine，见文件头署名）
// ①(新) 图层合成清单/图层提取（route B v1：canvas 动态渲染）
import { extractSceneMainImage, extractSceneMainImageFromDir, extractSceneManifest, extractSceneLayer, extractTexVideoMp4, collectSceneVideoFiles, parsePkg, readPkgEntry, scanSceneAudio, scanSceneVideo } from './pkg-extract.js';
// ①(新 2026-09-16 I 项) 网页（web）类壁纸：内容优先的类型判定 + WE API shim 注入 + 跨源策略
// （MIT，本仓库自写；API 名单参考 oneincase/webwallgl，未复制其代码，见 ../docs/COPYING-RULES.md §4）
import { detectWallpaperDir, isShimRequest, webPolicyFromQuery, buildSeedScript, rewriteWebEntryHtml, webAssetCorsHeaders, listWallpaperFiles } from './web-wallpaper.js';

const BASE = '/api/mpkg-wallpaper';
/** ①(修正) 更新检测：版本号主导（semver），哈希仅作内容差异提示。
 *  之前纯哈希对比——本地有未推送改动就误报"新版本 3.1.2 → 3.1.2"（用户实测）。 */
function semverGt(a, b) {
  try {
    const pa = String(a || '').replace(/[^\d.]/g, '').split('.').map(Number);
    const pb = String(b || '').replace(/[^\d.]/g, '').split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] || 0, y = pb[i] || 0;
      if (x > y) return true;
      if (x < y) return false;
    }
    return false;
  } catch { return false; }
}
const HEAD_BYTES = 2 * 1024 * 1024; // 与客户端一致的容器头读取量
const WE_APPID = '431960';
const STEAM_PROBE_DIRS = [
  'C:\\Program Files (x86)\\Steam',
  'C:\\Program Files\\Steam',
  'D:\\Steam',
  'D:\\SteamLibrary',
  'E:\\SteamLibrary',
];
/** ①(修正) 持久数据目录：放 DSH_HOME/HOME 下而非 tmpdir —— Termux/proot 环境
 *  /tmp 每次重启清空 → 重启后 mpkg 与 customDir 全部丢失（用户实测）。
 *  用持久目录：上传的 mpkg、custom-dir.json、token 映射重启后都能恢复。 */
// ①(修正) 用 os.homedir() 兜底：Windows 默认**无 process.env.HOME**（原回退 '.' 相对路径
//  → cwd 不可写时 /settings、/upload、customDir、上传 mpkg 全部静默丢失）。os.homedir()
//  跨平台正确（Windows/ macOS/Linux/WSL）。DSH_HOME 优先，其次 os.homedir()。
const DATA_DIR = join(process.env.DSH_HOME || os.homedir() || '.', '.dsh-mpkg-wallpaper');
/** ①(新) 定位 DSH home 目录。
 *  ①(修正) host 进程环境里 DSH_HOME **可能未导出**（dsh 启动不注入插件进程），
 *  且 profiles 默认在 `~/.dsh/profiles` 而不是 `~/profiles`（原实现少一层 `.dsh`，
 *  导致无 DSH_HOME 时永远扫错目录 → betterSidebarVersion 恒为 null → 版本门控
 *  CSS 全部不生效）。优先显式 DSH_HOME；否则 ~/.dsh（默认）；再兜底 homedir。 */
function dshHomeDir() {
  const explicit = process.env.DSH_HOME;
  if (explicit) return explicit;
  const homeDotDsh = join(os.homedir() || '.', '.dsh');
  if (existsSync(homeDotDsh)) return homeDotDsh;
  return os.homedir() || '.';
}
/** ①(新) 读取已安装的 dsh-better-sidebar 版本（供客户端按版本做适配）。
 *  better-sidebar 装在 `<DSH_HOME>/profiles/<name>/node_modules/dsh-better-sidebar`。
 *  host 端不知道当前 profile 名，所以扫描 `profiles/*` 下所有装了 better-sidebar 的目录，
 *  读出其 package.json 的 version。扫描不到/异常返回 null（客户端按"未知版本"兼容处理，
 *  不报错）。跨平台（Windows 无 HOME 时 os.homedir() 兜底）。
 *
 *  ①(修正 2026-09-17，第 2 个致 null 的原因) **本函数不能叫 betterSidebarVersion**：
 *  /ping 里原本写的是
 *      let betterSidebarVersion = null;
 *      try { betterSidebarVersion = betterSidebarVersion(); } catch {}
 *  —— 局部变量把同名函数**遮蔽**了，右侧调用的是 null ⇒ TypeError 被空 catch 吞掉 ⇒
 *  该字段**恒为 null**（真机实测：装了 0.19.1 仍返回 null，见
 *  docs/BETTER-SIDEBAR-COMPAT.md §2）。客户端据此不设 body[data-mpw-bs-version] ⇒
 *  所有 `[data-mpw-bs-version^=…]` 版本门控规则一条都不生效（"按版本适配"形同虚设）。
 *  改名后局部变量名与函数名不再可能相同；回归门禁 tools/better-sidebar-compat-test.mjs
 *  （含"改回同名 ⇒ 必须变红"的变异用例）。 */
function detectBetterSidebarVersion() {
  try {
    const profilesDir = join(dshHomeDir(), 'profiles');
    if (!existsSync(profilesDir)) return null;
    for (const p of readdirSync(profilesDir)) {
      const pkgPath = join(profilesDir, p, 'node_modules', 'dsh-better-sidebar', 'package.json');
      try {
        if (existsSync(pkgPath)) {
          const v = JSON.parse(readFileSync(pkgPath, 'utf8')).version;
          if (v && typeof v === 'string') return v;
        }
      } catch { /* 单个 profile 损坏跳过，继续下一个 */ }
    }
  } catch { /* 扫描失败按未知版本 */ }
  return null;
}

/** token → { path, size, dataStart, entries } */
const files = new Map();
/** ④(新) 本地壁纸库：ltoken → { dir, type, title, media, preview }（Steam 自动发现） */
const library = new Map();
/** ①(新) 自定义本地壁纸目录：用户指定的文件夹路径（只读媒体文件，安全校验） */
let customDir = null;
/** ①(新) mpkg preview 缓存：key=文件名 → { mtimeMs, mime, bytes }。
 *  扫描列表缩略图会请求每个 mpkg 的 preview——不缓存则每次都重新解析头部（2MB 读）+ 打开大文件。
 *  ①(修正) **LRU + 容量上限**：几万张壁纸时缓存 bytes 会撑爆内存（用户实测担忧）——
 *  总字节上限 64MB、条目上限 128，超限淘汰最久未用；get 时 touch（重插到末尾保持 LRU 顺序）。 */
const mpkgPreviewCache = new Map();
const MPKG_PREVIEW_MAX_BYTES = 48 * 1024 * 1024;   // ①(#17) 64MB → 48MB（缩略图够用，内存更稳）
const MPKG_PREVIEW_MAX_ITEMS = 128;                // 条目上限 128
let mpkgPreviewBytes = 0;
function mpkgPreviewGet(file) {
  const c = mpkgPreviewCache.get(file);
  if (c) { mpkgPreviewCache.delete(file); mpkgPreviewCache.set(file, c); }
  return c;
}
function mpkgPreviewSet(file, c) {
  const old = mpkgPreviewCache.get(file);
  if (old) mpkgPreviewBytes -= old.bytes.length;
  mpkgPreviewCache.delete(file);
  mpkgPreviewCache.set(file, c);
  mpkgPreviewBytes += c.bytes.length;
  // 超限 → 淘汰最久未用（Map 头部即最早插入）
  while ((mpkgPreviewBytes > MPKG_PREVIEW_MAX_BYTES || mpkgPreviewCache.size > MPKG_PREVIEW_MAX_ITEMS) && mpkgPreviewCache.size > 1) {
    const firstKey = mpkgPreviewCache.keys().next().value;
    if (firstKey === undefined) break;
    const evicted = mpkgPreviewCache.get(firstKey);
    mpkgPreviewBytes -= evicted.bytes.length;
    mpkgPreviewCache.delete(firstKey);
  }
}
// ①(新) 场景静态帧缓存：key=scene.pkg 绝对路径 → { mtimeMs, mime, bytes }。
// 提取是 CPU 密集（LZ4 + TEX 解码，几十 ms ~ 几秒），必须缓存；mtime 变化即失效。
const sceneFrameCache = new Map();
const SCENE_FRAME_MAX_BYTES = 96 * 1024 * 1024;  // ①(#17 用户要求) 256MB → 96MB：手机/容器内存更稳
const SCENE_FRAME_MAX_ITEM_BYTES = 24 * 1024 * 1024; // 单帧 >24MB 不进内存缓存（直接返回，不驻留）
const SCENE_FRAME_MAX_ITEMS = 64;
let sceneFrameBytes = 0;
function sceneFrameGet(key) {
  const c = sceneFrameCache.get(key);
  if (c) { sceneFrameCache.delete(key); sceneFrameCache.set(key, c); }
  return c;
}
function sceneFrameSet(key, c) {
  // ①(#17) 超大单条直接不缓存：避免一条就把预算吃光（仍正常返回给请求方）
  if (c && c.bytes && c.bytes.length > SCENE_FRAME_MAX_ITEM_BYTES) return c;
  const old = sceneFrameCache.get(key);
  if (old) sceneFrameBytes -= old.bytes.length;
  sceneFrameCache.delete(key);
  sceneFrameCache.set(key, c);
  sceneFrameBytes += c.bytes.length;
  while ((sceneFrameBytes > SCENE_FRAME_MAX_BYTES || sceneFrameCache.size > SCENE_FRAME_MAX_ITEMS) && sceneFrameCache.size > 1) {
    const firstKey = sceneFrameCache.keys().next().value;
    if (firstKey === undefined) break;
    const evicted = sceneFrameCache.get(firstKey);
    sceneFrameBytes -= evicted.bytes.length;
    sceneFrameCache.delete(firstKey);
  }
}
/** ①(新) 提取一个场景目录的静态帧：scene.pkg（PKG 容器）> 松散 scene.json 目录；
 *  全部失败返回 null（调用方回退预览图）。结果带缓存（mtime-keyed）。 */
function extractSceneFrame(dir) {
  try {
    const pkgPath = join(dir, 'scene.pkg');
    if (existsSync(pkgPath)) {
      const st = statSync(pkgPath);
      const cached = sceneFrameGet(pkgPath);
      if (cached && cached.mtimeMs === st.mtimeMs) return { mime: cached.mime, bytes: cached.bytes };
      const r = extractSceneMainImage(new Uint8Array(readFileSync(pkgPath)));
      if (r && r.bytes && r.bytes.length > 0) {
        sceneFrameSet(pkgPath, { mtimeMs: st.mtimeMs, mime: r.mime || 'image/png', bytes: r.bytes });
        return { mime: r.mime || 'image/png', bytes: r.bytes };
      }
    }
    // 松散目录（defaultprojects 等：scene.json + 平铺 .tex）
    const r2 = extractSceneMainImageFromDir(dir);
    if (r2 && r2.bytes && r2.bytes.length > 0) return { mime: r2.mime || 'image/png', bytes: r2.bytes };
  } catch { /* 提取失败 → 回退 */ }
  return null;
}
/** 目录内预览文件（preview.gif/jpg/png/webp）优先。 */
function previewFileIn(dir) {
  try {
    const p = readdirSync(dir).find((f) => /^preview\.(gif|png|jpe?g|webp)$/i.test(f));
    return p ? join(dir, p) : null;
  } catch { return null; }
}
/** ①(修正) customDir 持久化：dsh 重启后恢复（否则 /custom-media 404 → 自定义目录壁纸消失）。
 *  存入 tmpdir 下的 JSON，随 tmpdir 清理策略（上传的 mpkg 同目录）。 */
function persistCustomDir() {
  try {
    const dir = DATA_DIR;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'custom-dir.json'), JSON.stringify({ dir: customDir }));
  } catch { /* 忽略 */ }
}
function restoreCustomDir() {
  try {
    const f = join(DATA_DIR, 'custom-dir.json');
    if (!existsSync(f)) return;
    const d = JSON.parse(readFileSync(f, 'utf8'));
    if (d && d.dir && existsSync(d.dir) && statSync(d.dir).isDirectory()) customDir = d.dir;
  } catch { /* 忽略 */ }
}

/** ①(修正) 只读 mpkg 头部定长字节（真轻量）。之前 readFileSync(path).subarray(0,HEAD_BYTES)
 *  会把**整个文件**读进内存再切片（.subarray 只是视图，不省 IO）——DATA_DIR 有 834MB
 *  大 mpkg 时启动同步全读 → 约 9 秒（用户实测刷新后壁纸慢）。用 openSync+readSync
 *  只读 HEAD_BYTES，避免全量载入。文件不足时返回实际读到的字节。 */
function readMpkgHead(filePath) {
  const buf = Buffer.alloc(HEAD_BYTES);
  let fd = null;
  try {
    fd = openSync(filePath, 'r');
    const got = readSync(fd, buf, 0, HEAD_BYTES, 0);
    return got < HEAD_BYTES ? buf.subarray(0, got) : buf;
  } catch { return Buffer.alloc(0); }
  finally { if (fd !== null) { try { closeSync(fd); } catch { /* 忽略 */ } } }
}

/** ①(修正) 只读文件**指定区域**的定长字节（真轻量，供场景/tex 分段 ftyp 扫描用）。
 *  之前 fallback 用 readFileSync(whole).subarray(...) 会把**整个文件**读进内存再切片，
 *  DATA_DIR 有 834MB 大 mpkg 时一次请求就全量载入（.subarray 只是视图，不省 IO）。
 *  用 openSync+readSync 只读 [offset, offset+len) 这一段。文件不足返回实际读到的字节。 */
function readRange(filePath, offset, len) {
  const buf = Buffer.alloc(len);
  let fd = null;
  try {
    fd = openSync(filePath, 'r');
    const got = readSync(fd, buf, 0, len, offset);
    return got <= 0 ? Buffer.alloc(0) : buf.subarray(0, got);
  } catch { return Buffer.alloc(0); }
  finally { if (fd !== null) { try { closeSync(fd); } catch { /* 忽略 */ } } }
}

/** 解析 mpkg 容器头（与 client.js 的 parseMpkg 相同逻辑，返回 dataStart + 条目表）。 */
function parseMpkgHead(buf) {
  let pos = 0;
  const versionLength = buf.readUInt32LE(pos); pos += 4;
  pos += versionLength; // 跳过 version 字符串
  const fileTotal = buf.readUInt32LE(pos); pos += 4;
  const entries = [];
  for (let i = 0; i < fileTotal; i++) {
    const nameLength = buf.readUInt32LE(pos); pos += 4;
    const name = buf.toString('utf8', pos, pos + nameLength); pos += nameLength;
    const index = buf.readUInt32LE(pos); pos += 4;
    const size = buf.readUInt32LE(pos); pos += 4;
    entries.push({ name, index, size });
  }
  return { dataStart: pos, entries };
}

/** ①(修正) 流式响应统一清理（issue-26 同类隐患：客户端中途断开时
 *  createReadStream 只 unpipe 不销毁 → fd 泄漏；Windows 上会锁文件无法删除）。
 *  close（客户端断开）/ error 都 destroy 源流；正常结束由 pipe 自行处理。 */
function serveStream(res, stream) {
  stream.on('error', () => { try { res.destroy(); } catch { /* 忽略 */ } });
  res.on('close', () => { try { stream.destroy(); } catch { /* 忽略 */ } });
  stream.pipe(res);
}

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

/** ①(新) 内容哈希：只哈希实际代码文件（client.js + index.js），README 变更不影响 */
function codeHash() {
  try {
    const client = readFileSync(new URL('./client.js', import.meta.url), 'utf8');
    const index = readFileSync(new URL('./index.js', import.meta.url), 'utf8');
    return crypto.createHash('sha1').update(client + index).digest('hex').slice(0, 12);
  } catch { return 'local'; }
}
/** ①(新) 从 GitHub 拉取某个文件的内容（自己的仓库，可信源） */
async function fetchRaw(path) {
  const r = await fetch('https://raw.githubusercontent.com/XHR666/dsh-mpkg-wallpaper/main/' + path);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return await r.text();
}

/** Steam 注册表里的安装路径（Windows）。 */
function steamPathFromRegistry() {
  if (process.platform !== 'win32') return null;
  try {
    const reg = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'reg.exe');
    const out = execFileSync(reg, ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], {
      encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
    });
    const m = /SteamPath\s+REG_SZ\s+(.+)/i.exec(out);
    return m ? m[1].trim().replace(/\\\\/g, '\\') : null;
  } catch { return null; }
}

/** ③ 自动发现：定位壁纸引擎安装目录（Steam libraryfolders.vdf + 常见路径探测）。
 *  ①(修正) 补非 Windows 平台探测：macOS/Linux/WSL 也各自有 Steam 安装路径。
 *  路径是纯字符串，平台用不到时 existsSync 自然为 false，无副作用。 */
const STEAM_PROBE_DIRS_NONWIN = [
  ...(process.platform === 'darwin' ? [join(os.homedir(), 'Library', 'Application Support', 'Steam')] : []),
  ...(process.platform === 'linux' || process.platform === 'android' ? [join(os.homedir(), '.local', 'share', 'Steam')] : []),
  '/mnt/c/Program Files (x86)/Steam',   // WSL
  '/mnt/c/Program Files/Steam',          // WSL
];
function locateWallpaperEngine() {
  const probes = [];
  const reg = steamPathFromRegistry();
  if (reg) probes.push(reg);
  probes.push(...STEAM_PROBE_DIRS, ...STEAM_PROBE_DIRS_NONWIN);
  const libraries = [];
  for (const probe of probes) {
    const vdf = join(probe, 'steamapps', 'libraryfolders.vdf');
    if (existsSync(vdf)) {
      try {
        const text = readFileSync(vdf, 'utf8');
        let current = null;
        for (const line of text.split(/\r?\n/)) {
          const m = /^\s*"path"\s+"([^"]+)"\s*$/.exec(line);
          if (m) { current = m[1].replace(/\\\\/g, '\\'); continue; }
          if (current && line.includes(WE_APPID) && !libraries.includes(current)) libraries.push(current);
        }
      } catch { /* skip */ }
    }
    if (existsSync(join(probe, 'steamapps', 'common', 'wallpaper_engine'))) libraries.push(probe);
  }
  const roots = [...new Set([...probes, ...libraries])];
  for (const root of roots) {
    const dir = join(root, 'steamapps', 'common', 'wallpaper_engine');
    if (existsSync(join(dir, 'wallpaper32.exe'))) return dir;
  }
  const alt = 'C:\\Program Files (x86)\\Wallpaper Engine';
  return existsSync(join(alt, 'wallpaper32.exe')) ? alt : null;
}

// ①(修正) 硬依赖 webServer：cordis 等待 HTTP 服务挂载后再 apply（dsh-wallpaper-engine 同款）。
// 之前用 ctx.inject(['webServer'], (ws) => …) 时回调参数是 webCtx 而非服务对象，
// ws.register 实际不存在 → 路由从未注册 → 客户端 ping 404 → hybrid 回退纯浏览器模式。
export const inject = ['webServer'];

/** ①(修正) 重启后恢复上传的 mpkg 映射：扫描临时目录下的 *.mpkg（文件名即 token），
 *  重新解析容器头 → files Map 重建 → 浏览器里的 "host:" 背景在 dsh 重启后仍能加载。
 *  之前 files Map 只在内存，dsh 重启即清空 → media 404 → 壁纸有时不显示。 */
function restoreFiles() {
  try {
    const dir = DATA_DIR;
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.mpkg')) continue;
      const token = f.slice(0, -5);
      if (files.has(token)) continue;
      try {
        const path = join(dir, f);
        const head = readMpkgHead(path);
        const { dataStart, entries } = parseMpkgHead(head);
        files.set(token, { path, size: statSync(path).size, dataStart, entries });
      } catch { /* 跳过损坏文件 */ }
    }
  } catch { /* 忽略 */ }
  // ①(修正) 也扫 customDir 的 mpkg（含子文件夹）：当前壁纸在 customDir（如
  // wallpaperE/角色夹），启动时若不在 files Map → /media 按 token 找不到 → 404 →
  // client 重试退避（800ms×5≈9 秒）→ 才 remap /custom-mpkg（用户实测刷新后约 9 秒
  // 才显示壁纸）。用文件名作 token（与 /custom-mpkg 一致），重启后 token 命中 →
  // media 一次成功，无 9 秒重试。懒扫描：只注册当前 customDir 下的 mpkg。
  try {
    if (!customDir || !existsSync(customDir)) return;
    const walk = (d) => {
      let es = [];
      try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const en of es) {
        if (en.isDirectory()) { walk(join(d, en.name)); continue; }
        if (!en.name.toLowerCase().endsWith('.mpkg')) continue;
        const token = en.name.replace(/\.mpkg$/i, '');
        if (files.has(token)) continue;
        try {
          const path = join(d, en.name);
          const head = readMpkgHead(path);
          const { dataStart, entries } = parseMpkgHead(head);
          files.set(token, { path, size: statSync(path).size, dataStart, entries });
        } catch { /* 跳过损坏文件 */ }
      }
    };
    walk(customDir);
  } catch { /* 忽略 */ }
}

// ── 视频壁纸「解码帧率上限」：ffmpeg 供给链 + 抽帧转码（宿主端）──────────────
// 跨平台设计（Windows/WSL/macOS/Linux/Termux-Android）：
//   * ffmpeg 供给链：env DSH_WE_FFMPEG → 系统 PATH → DATA_DIR/ffmpeg/ 静态二进制。
//     绝不自动下载（避免首次联网）——用户点「下载 ffmpeg」按钮才走 /ffmpeg-download。
//   * 转码：CPU 通用编码 libx264（回退 libsvtav1），不依赖 nvenc（非 NVIDIA 无此硬件）；
//     `-vf fps=<cap>` 抽帧（时间线保持原速），`-an` 去音频（壁纸默认静音更省），
//     输出 mp4 缓存到 DATA_DIR/transcodes/，浏览器播放转码产物以降低 GPU 解码占压。
//   * spawn 异步执行（不阻塞事件循环），15min 超时 kill，stderr 写日志文件。
const FFMPEG_STATIC_TAG = 'b6.0';
// process.platform → process.arch → ffmpeg-static b6.0 单文件资产名。
const FFMPEG_STATIC_ASSETS = {
  win32: { x64: 'ffmpeg-win32-x64', ia32: 'ffmpeg-win32-ia32' },
  linux: { x64: 'ffmpeg-linux-x64', ia32: 'ffmpeg-linux-ia32', arm: 'ffmpeg-linux-arm', arm64: 'ffmpeg-linux-arm64' },
  darwin: { x64: 'ffmpeg-darwin-x64', arm64: 'ffmpeg-darwin-arm64' },
};
// b6.0 各资产 sha256 固定值（下载后校验，防执行未验证二进制）。
const FFMPEG_STATIC_SHA256 = {
  'ffmpeg-win32-x64': 'e9fd5e711debab9d680955fc1e38a2c1160fd280b144476cc3f62bc43ef49db1',
  'ffmpeg-win32-ia32': 'fb3766af5cc193ca863e15cd4554a33732973209dad5e3c1433b5e291bceb16c',
  'ffmpeg-linux-x64': 'ed652b2f32e0851d1946894fb8333f5b677c1b2ce6b9d187910a67f8b99da028',
  'ffmpeg-linux-ia32': '103500b65ccb78c3c804088d6e17111d85e2bd03f5a0c61c349dc2d05e165f09',
  'ffmpeg-linux-arm': '1a9ddc19d0e071b6e1ff6f8f34dc05ec6dd4d8f3e79a649f5a9ec0e8c929c4cb',
  'ffmpeg-linux-arm64': '237800b37bb65a81ad47871c6c8b7c45c0a3ca62a5b3f9d2a7a9a2dd9a338271',
  'ffmpeg-darwin-x64': 'cfe20936c83ecf5d68e424b87e8cc45b24dd6be81787810123bb964a0df686f9',
  'ffmpeg-darwin-arm64': 'a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584',
};
// 单个转码任务的硬超时（覆盖编码全部尝试），可用 DSH_WE_TRANSCODE_TIMEOUT_MS 覆盖。
const TRANSCODE_TIMEOUT_MS = Number(process.env.DSH_WE_TRANSCODE_TIMEOUT_MS) || 15 * 60 * 1000;
const ALLOWED_FPS = [24, 30, 48, 60];
// ═══ MPW-PLAYABLE-GATE-BEGIN ═══
/** ⓪(2026-09-17 用户第 1 条「我没开转码，ffmpeg 为甚么在后台转我正在放的壁纸」)：
 *  **浏览器可播性闸门** —— 先探测源的「编解码 + 容器 + profile/level」，判得出
 *  「浏览器能自己解码」就**不转码**（直读原片）。
 *
 *  为什么需要：转码原本只有两个入口——①用户显式设 fpsCap/resMax；②客户端监听
 *  video 的 error 事件（error.code 3/4）后**自动** fallback 到 /transcode?fps=24。
 *  ②的判据有问题：`code 3/4` 只说明"这一帧解不出来"，**不能证明"浏览器不支持这编码"**
 *  （4K60 硬解被系统回收 / 内存压力 / GPU 解码器忙 / 网络 Range 抖动都会给 3/4）。
 *  用户实测现场：源是 H.264 High L5.2 + AAC 的 MP4（浏览器 100% 可直读），
 *  fpsCap=0/resMax=0（没有任何转码设置），却被降级转成 24fps 的 4K 重编码
 *  —— 常驻一个 `-threads 1` 的 ffmpeg（RSS ≈ 690MB）跑十几分钟，
 *  产物还比源小不了多少，纯属白烧 CPU/内存。见 docs/TRANSCODE-RESOURCE.md。
 *
 *  探测方法（**零依赖、只读文件头/元数据**，不解码画面）：
 *    ffprobe -v error -show_entries stream=codec_name,... / format=format_name,...
 *  ⇒ 得到 { container, video, audio, width, height, fps, duration } 后查下表。
 *  判据只认**确定性**的不支持（编解码不在白名单 / 容器不是 mp4|webm / HEVC 的
 *  Main10 10bit / MP4 里 h264+opus 这类浏览器确实不吃的组合）——
 *  任何"拿不准"（探测失败、字段缺失、未知 codec）一律回 `null`（= 不知道），
 *  **不猜**：不知道时保留旧行为，绝不因为闸门本身误伤可播放的源。 */
const BROWSER_OK_VIDEO = new Set(['h264', 'vp8', 'vp9', 'av1']);
const BROWSER_OK_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']);
const BROWSER_OK_CONTAINER = /^(mov|mp4|m4a|3gp|3g2|mj2|matroska|webm)/i;
/** 逐平台浏览器实现缺口（表小但每一条都是确定性事实，不是"大概不支持"）：
 *  · h264 + opus 装进 MP4：Chromium 系不支持（Opus 在 MP4 里只有 WebM/ogg 容器被支持）；
 *  · HEVC Main10（10bit）：多数平台无 10bit HEVC 解码（8bit Main 在 Safari/部分 Chromium 上可）。
 *  只用于"源本身就不该直读"的判断；命中即视为需要转码。 */
function browserCodecGap(video, audio, fmt) {
  const afmt = String(fmt || '');
  if (video === 'h264' && audio === 'opus' && !/webm|matroska/i.test(afmt)) return 'mp4 容器里的 h264+opus（Chromium 不支持该组合）';
  if (video === 'hevc' && /main ?10|main10/i.test(String(fmt || ''))) return 'HEVC Main10（10bit，多数平台无解码器）';
  return '';
}
/** 给定探测结果 → { playable: true|false|null, reason }。
 *  playable=true  = 确定性「浏览器可直读」（⇒ 不该转码）
 *  playable=false = 确定性「浏览器吃不下」（⇒ 转码有意义）
 *  playable=null  = 探测失败/字段缺失/未知 codec（⇒ 不知道，不改行为） */
function browserPlayable(info) {
  if (!info || !info.video) return { playable: null, reason: '未探测到视频流（不回退判据）' };
  const v = String(info.video).toLowerCase();
  const a = info.audio ? String(info.audio).toLowerCase() : '';
  const fmt = info.container || '';
  if (!BROWSER_OK_VIDEO.has(v)) return { playable: false, reason: '视频编码 ' + v + ' 不在浏览器白名单（h264/vp8/vp9/av1）' };
  if (a && !BROWSER_OK_AUDIO.has(a)) return { playable: false, reason: '音频编码 ' + a + ' 不在浏览器白名单（aac/mp3/opus/vorbis/flac）' };
  if (!BROWSER_OK_CONTAINER.test(String(fmt))) return { playable: false, reason: '容器 ' + fmt + ' 不是 mp4/webm' };
  const gap = browserCodecGap(v, a, info.videoProfile);
  if (gap) return { playable: false, reason: gap };
  return { playable: true, reason: v + (a ? '+' + a : '') + ' / ' + fmt + '（浏览器可直读）' };
}
/** ffprobe 的 key=value 解析结果 → 探测对象（**纯函数**，便于单测：
 *  喂 ffprobe 的 kv 行 + 文件魔数就能断言判据，不必真跑 ffmpeg）。 */
function buildProbeInfo(meta, magicBuf) {
  const m = meta || {};
  const parseRate = (s) => { const r = String(s || '').split('/'); const n = Number(r[0]), d = Number(r[1]); return d > 0 && Number.isFinite(n) ? n / d : 0; };
  // ①(fix) VFR 视频 r_frame_rate 可能是 0/0 → 用 avg_frame_rate 兜底
  let fps = parseRate(m.rFrameRate);
  if (!(fps > 0)) fps = parseRate(m.avgFrameRate);
  const info = {
    container: String(m.container || ''),
    video: String(m.video || '').toLowerCase(),
    videoProfile: String(m.videoProfile || '').replace(/\s+/g, ' '),
    audio: String(m.audio || '').toLowerCase(),
    audioProfile: String(m.audioProfile || ''),
    width: Number(m.width) || 0,
    height: Number(m.height) || 0,
    fps: Math.round(fps * 1000) / 1000,
    duration: Number(m.duration) || 0,
    size: Number(m.size) || 0,
    brands: String(m.brands || ''),
  };
  // 容器魔数兜底（ffprobe 把容器报成空串时用 ftyp/matroska 魔数补——闸门要的是确定性）
  const magic = magicBuf && magicBuf.length >= 12 ? magicBuf : null;
  if (!info.container && magic) info.container = matroskaMagic(magic) ? 'matroska,webm' : isoBmffMagic(magic) ? 'mov,mp4,m4a,3gp,3g2,mj2' : '';
  if (magic) {
    // ISO-BMFF 的 compatible brand：`avc1` 出现在 ftyp 里 ⇒ 该文件被显式标注为 H.264/AAC 兼容
    const head = magic.toString('latin1');
    if (!info.brands) info.brands = (head.match(/[a-z0-9]{4}/g) || []).slice(0, 8).join(' ');
    if (/(^|\W)avc1(\W|$)/.test(info.brands)) info.h264Brand = true;
  }
  info.browserPlayable = browserPlayable(info);
  return info;
}
function matroskaMagic(buf) { return buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3; }
function isoBmffMagic(buf) { return buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp'; }
// ═══ MPW-PLAYABLE-GATE-END ═══
const TRANSCODE_INFLIGHT = new Map(); // cachePath → Promise（并发去重）
const ACTIVE_FFMPEG = new Set();      // 活动 ffmpeg 子进程（超时可 kill）
const transcodeJobs = new Map();      // srcId|fps → { phase, percent, updatedAt }
const TRANSCODE_JOBS_MAX = 64;
let lastTranscodeProgress = null;     // 最近一次任务进度（无参数轮询用）
let ffmpegDownloadPromise = null;     // 下载单飞（防并发重复下载）
let ffmpegDownloadProgress = null;    // 下载进度（bytes/total）
let lastFfmpegDownloadError = null;

/** ②(fix) 源视频探测缓存：srcId|mtime → { fps, width, height } | null。
 *  避免每次 /transcode 都跑一次 ffprobe（4K 源探测也要几秒）。 */
const TRANSCODE_PROBE_CACHE = new Map();
const TRANSCODE_PROBE_CACHE_MAX = 64;

/** ②(fix) 用 ffprobe 探测视频流/容器元数据（失败返回 null，不抛错）。
 *  用于「源帧率≤上限 且 源宽≤上限 → 无需转码直接原片」的判断——
 *  用户实测：60fps 源 + fpsCap=60 仍走重编码 → 白屏几分钟（Android 单线程
 *  转 4K 100s 极慢），切回无限制时后台 ffmpeg 还在跑 → 卡。
 *
 *  ①(2026-09-17 修列序坑) 旧实现用 `-of csv=p=0` 按**位置**取字段，注释里写的
 *  "实测 width 在前" 本身是错的——本机 ffprobe 4.4.2 实测输出是
 *  `h264,High,3840,2160,yuvj420p,52,60/1,60/1`（csv 会**静默丢掉**你请求的
 *  codec_name/profile 列，只留原生顺序）⇒ 位置解析随时会被版本/流类型挪位。
 *  改为 `-of default=noprint_wrappers=1` 的 `key=value` 逐行解析（自带字段名，
 *  不依赖列序），一次拿全：视频编码/profile/宽高/帧率 + 音频编码 + 容器/时长/大小。 */
const PROBE_V_ENTRIES = 'stream=codec_name,profile,width,height,r_frame_rate,avg_frame_rate';
const PROBE_A_ENTRIES = 'stream=codec_name,profile,channels,sample_rate';
const PROBE_F_ENTRIES = 'format=format_name,duration,size,bit_rate';
/** 解析 `key=value` 行（`-of default=noprint_wrappers=1`）→ 扁平对象。
 *  ⚠ 实测该格式**连 `[STREAM]` / `[/STREAM]` 标记都不打印**（只有裸的 key=value）
 *  ⇒ 段切分不能靠标记，只能靠"format 段的 key 出现了"来判定（见 splitProbeSections）。 */
function parseProbeKv(out) {
  const kv = {};
  for (const line of String(out || '').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i <= 0) continue;
    kv[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return kv;
}
/** `-show_entries stream=… -show_entries format=…` 的裸输出 → { stream, format }：
 *  第一个 format 段专属键（format_name 等）起归 format，之前全归 stream。
 *  （**纯函数**，测试可直接喂 ffprobe 的真实输出做逐行断言。） */
const PROBE_FORMAT_KEYS = new Set(['format_name', 'format_long_name', 'nb_streams', 'nb_programs', 'start_time', 'bit_rate', 'probe_score', 'filename']);
function splitProbeSections(out) {
  const streamLines = [], formatLines = [];
  let inFormat = false;
  for (const line of String(out || '').split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i <= 0) continue;
    const key = line.slice(0, i).trim();
    if (PROBE_FORMAT_KEYS.has(key)) inFormat = true;
    (inFormat ? formatLines : streamLines).push(line);
  }
  return { stream: parseProbeKv(streamLines.join('\n')), format: parseProbeKv(formatLines.join('\n')) };
}
/** 一次 ffprobe 拿全（视频流 + 容器）。音频另起一次调用——同一进程里 v/a 两段的
 *  `codec_name`/`profile` 同名，且 noprint_wrappers 下没有段标记可依，混在一起会互相覆盖。 */
function ffprobeSourceMeta(filePath) {
  // ⚠ `-select_streams v:0,a:0` **不是合法语法**（ffprobe 4.4.2 实测直接
  //   "Invalid stream specifier: v:0,a:0" 退出 1）⇒ 探测全链路静默失败、
  //   闸门形同不存在。`v` / `a` 单字母即可（语义 = 该类型全部流，取第一段用）。
  const out = execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v',
    '-show_entries', PROBE_V_ENTRIES, '-show_entries', PROBE_F_ENTRIES,
    '-of', 'default=noprint_wrappers=1', filePath,
  ], { encoding: 'utf8', timeout: 15000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  const { stream: video, format: fmt } = splitProbeSections(out);
  let audio = {};
  try {
    const aOut = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', PROBE_A_ENTRIES, '-of', 'default=noprint_wrappers=1', filePath],
      { encoding: 'utf8', timeout: 15000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    audio = splitProbeSections(aOut).stream;
  } catch { /* 无音轨：按"无音频"处理（视频判据仍有效） */ }
  return { video, audio, fmt };
}
/** 读文件头 64 字节（魔数兜底：ffprobe 把容器报成空串时用 ftyp/matroska 补） */
function headBytes(filePath, n) {
  try {
    const fd = openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(n || 64);
      const got = readSync(fd, buf, 0, buf.length, 0);
      return buf.subarray(0, got);
    } finally { closeSync(fd); }
  } catch { return null; }
}
function probeVideoInfo(filePath) {
  try {
    const { video, audio, fmt } = ffprobeSourceMeta(filePath);
    const info = buildProbeInfo({
      width: Number(video.width) || 0,
      height: Number(video.height) || 0,
      rFrameRate: video.r_frame_rate, avgFrameRate: video.avg_frame_rate,
      video: video.codec_name, videoProfile: video.profile,
      audio: audio.codec_name, audioProfile: audio.profile,
      container: fmt.format_name, duration: Number(fmt.duration) || 0,
      size: Number(fmt.size) || 0,
    }, headBytes(filePath, 64));
    return (info.width > 0 && info.fps > 0) ? info : null;
  } catch { return null; }
}

/** ②(fix) 带缓存的探测（src 统一输入：mpkg 或 file）。 */
function probeVideoSource(src) {
  const info = getVideoProbe(src);
  return info && info.width > 0 && info.fps > 0 ? info : null;
}
/** ⓪(2026-09-17) 带缓存的**完整探测**（含浏览器可播性判据）。
 *  cache key = srcId|mtime（与转码缓存 key 同源口径：源没变就同一个答案）。
 *  mpkg 容器条目：materialize 提取临时文件探测，探完即删。 */
function getVideoProbe(src) {
  try {
    const srcPath = src.type === 'file' ? src.path : src.rec.path;
    const st = statSync(srcPath);
    const srcId = src.type === 'mpkg' ? 'mpkg:' + src.rec.path + ':' + src.entry.index : srcPath;
    const ck = srcId + '|' + Math.round(st.mtimeMs);
    if (TRANSCODE_PROBE_CACHE.has(ck)) return TRANSCODE_PROBE_CACHE.get(ck);
    let info = null;
    if (src.type === 'file') {
      info = probeVideoInfo(srcPath);
    } else {
      try {
        const mat = materializeSource(src, transcodeCacheDir());
        try { info = probeVideoInfo(mat.file); } finally { if (mat.cleanup) mat.cleanup(); }
      } catch { info = null; }
    }
    if (TRANSCODE_PROBE_CACHE.size >= TRANSCODE_PROBE_CACHE_MAX) TRANSCODE_PROBE_CACHE.clear();
    TRANSCODE_PROBE_CACHE.set(ck, info);
    return info;
  } catch { return null; }
}

function ffmpegDataDir() {
  const dir = join(DATA_DIR, 'ffmpeg');
  try { mkdirSync(dir, { recursive: true }); } catch { /* 忽略 */ }
  return dir;
}
function ffmpegExeName() {
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}
function transcodeCacheDir() {
  const dir = join(DATA_DIR, 'transcodes');
  try { mkdirSync(dir, { recursive: true }); } catch { /* 忽略 */ }
  return dir;
}
/** ①(新) scene 内嵌视频缓存目录（scene-video 快路径）。
 *  场景作者常内嵌动画 MP4（"sync" 视频纹理或独立 .mp4 条目）——浏览器
 *  <video> 硬件解码播放最顺滑（参考 elysia395：CPU 逐帧/WebGL context
 *  实时渲染在移动端会冻结页面）。提取产物落盘（视频几十 MB，不能进内存）。 */
function sceneVideoDir() {
  const dir = join(DATA_DIR, 'scene-videos');
  try { mkdirSync(dir, { recursive: true }); } catch { /* 忽略 */ }
  return dir;
}
// ①(新) scene 内嵌视频索引缓存：scene 目录 → { mtimeMs, size, hash, mime } | null（null=无内嵌视频）
const sceneVideoIndex = new Map();
/** 给定 scene 目录（含 scene.pkg 或松散 scene.json），返回首个内嵌视频的缓存信息。
 *  返回 { path, mime, size } | null（null=该场景无内嵌视频）。
 *  提取一次落盘缓存；mtime/size 变化重提；并发请求共享单飞。
 *  ①(2026-09-15 用户第 1 条反馈 ⑥c) 扫描本身改为**索引先行**（lib/pkg-extract.js
 *  `scanSceneVideo`）：只读目录表 + 仅候选条目前缀，绝不整包 readFileSync、也不再把每个
 *  .tex 的 mipmap 全解压（这是"应用壁纸"关键路径上 4s 超时的那一步）。选择规则/缓存文件
 *  名（hash 公式未动）/mime 与改前逐项一致：hina 310ms→2.4ms、凯尔希 888ms→3.0ms。 */
function ensureSceneVideo(dir) {
  try {
    const pkgPath = join(dir, 'scene.pkg');
    const hasPkg = existsSync(pkgPath);
    const srcPath = hasPkg ? pkgPath : dir;
    const st = statSync(srcPath);
    const cached = sceneVideoIndex.get(dir);
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
      if (!cached.hash) return null; // 已确认无视频
      const p = join(sceneVideoDir(), cached.hash);
      if (existsSync(p)) return { path: p, mime: cached.mime, size: statSync(p).size };
    }
    // 收集内嵌视频（scene.pkg → 只读目录表 + 候选前缀；松散目录 → 遍历文件，同样只读前缀）
    let video = null;
    try {
      video = (hasPkg ? scanSceneVideo(pkgPath) : scanSceneVideo(dir)).video;
    } catch {
      // ①(2026-09-15) 兜底：索引先行路径出任何意外（容器越界/异常布局）→ 回退**旧口径**
      // （整包 readFileSync + 全 TEX 解析）。最坏情况只是"和改前一样慢"，答案与改前一致。
      try {
        if (hasPkg) video = findSceneVideoInPkg(new Uint8Array(readFileSync(pkgPath)));
        else video = findSceneVideoInDir(dir);
      } catch { video = null; }
    }
    if (!video) {
      sceneVideoIndex.set(dir, { mtimeMs: st.mtimeMs, size: st.size, hash: null, mime: null });
      return null;
    }
    const hash = crypto.createHash('sha256').update(dir + '|' + st.mtimeMs + '|' + video.ref).digest('hex').slice(0, 24);
    const out = join(sceneVideoDir(), hash + '.mp4');
    if (!existsSync(out)) {
      const tmp = out + '.tmp' + process.pid;
      try { writeFileSync(tmp, video.bytes); renameSync(tmp, out); } catch { try { unlinkSync(tmp); } catch {} }
    }
    const mime = /\.webm$/i.test(video.ref) ? 'video/webm' : /\.mov$/i.test(video.ref) ? 'video/quicktime' : 'video/mp4';
    sceneVideoIndex.set(dir, { mtimeMs: st.mtimeMs, size: st.size, hash, mime });
    return { path: out, mime, size: video.bytes.length };
  } catch { return null; }
}
/** scene.pkg 整包 → 找内嵌视频。
 *  优先**独立媒体文件**（.mp4/.webm/.mov 条目 = 作者导出的动画，直接播放正确）；
 *  TEX 内嵌 MP4 仅在**恰好 1 个**时采用——多 TEX 视频通常是"时间变化"壁纸的
 *  时段纹理（如伊蕾娜昼夜 5 个视频），应按时间选时段，走 mpkg 方式而非 scene-video。 */
function findSceneVideoInPkg(pkgData) {
  const videos = collectSceneVideoFiles({
    list: () => parsePkg(pkgData).map((e) => ({ path: e.path, read: () => readPkgEntry(pkgData, e) })),
  });
  if (!videos.length) return null;
  const standalone = videos.filter((v) => !v.isTexEmbedded);
  if (standalone.length) {
    standalone.sort((a, b) => (b.bytes.length || 0) - (a.bytes.length || 0));
    return standalone[0];
  }
  if (videos.length === 1) return videos[0];
  return null; // 多 TEX 视频（时间变化）→ 无单一内嵌动画
}
/** 松散 scene 目录 → 找内嵌视频（同上策略：独立媒体优先；单 TEX 内嵌才用）。 */
function findSceneVideoInDir(dir) {
  const videos = collectSceneVideoFiles({
    list: () => {
      const out = [];
      const walk = (sub, depth) => {
        if (depth > 4) return;
        let names = [];
        try { names = readdirSync(sub === '' ? dir : join(dir, sub)); } catch { return; }
        for (const name of names) {
          const rel = sub === '' ? name : sub + '/' + name;
          let isDir = false, isFile = false;
          try { const s = statSync(join(dir, rel)); isDir = s.isDirectory(); isFile = s.isFile(); } catch { continue; }
          if (isDir) { if (!name.startsWith('.')) walk(rel, depth + 1); }
          else out.push({ path: rel, read: () => { try { return new Uint8Array(readFileSync(join(dir, rel))); } catch { return null; } } });
        }
      };
      walk('', 0);
      return out;
    },
  });
  if (!videos.length) return null;
  const standalone = videos.filter((v) => !v.isTexEmbedded);
  if (standalone.length) {
    standalone.sort((a, b) => (b.bytes.length || 0) - (a.bytes.length || 0));
    return standalone[0];
  }
  if (videos.length === 1) return videos[0];
  return null;
}
/** ①(修正) 转码缓存 LRU 清理：保留最近 TRANSCODE_CACHE_KEEP 个 tc_*.mp4，其余按 mtime 淘汰。
 *  否则「源×fps」每转一次就新增一段完整 mp4，磁盘只增不减（宿主盘满=数据丢失风险）。
 *  上限 + 按 mtime 淘汰，可在多次转码/换源/换 fps 后释放旧缓存。 */
const TRANSCODE_CACHE_KEEP = Number(process.env.DSH_WE_TRANSCODE_CACHE_KEEP) || 12;
/** ⓪(2026-09-17 用户第 1 条「这里是不是 bug」) transcode 目录**字节上限**：
 *  旧实现只有**数量**上限（12 个 tc_*.mp4），而单个 4K 100s 产物就有 70–130MB
 *  ⇒ 数量没超也可能堆 1.5GB+（现场实测 723MB / 38 个文件，其中还混着
 *  `src_*.bin` 残留与 `.tmp` 半成品）。这里按**数量 + 合计字节**双上限收口，
 *  与仓库另一条「数据上限」线的口径一致（上限值集中一处 + 清理打日志，
 *  见 we-scene-demo/docs/DATA-LIMITS.md）。 */
const TRANSCODE_MAX_BYTES = Number(process.env.DSH_WE_TRANSCODE_MAX_BYTES) || 512 * 1024 * 1024;
/** ①(修正) ffmpeg 错误日志保留上限：最多留 FFMPEG_ERR_KEEP 个，过多按 mtime 淘汰。
 *  （用户要求：转码失败日志最多留 50 个，过多自动清除，防止磁盘堆积。） */
const FFMPEG_ERR_KEEP = Number(process.env.DSH_WE_FFMPEG_ERR_KEEP) || 50;
/** ⓪(2026-09-17) 转码产物的**默认降采样上限**（宽，0=不限制）：转码是给
 *  "浏览器吃不下/用户显式限帧"用的**降载**路径，默认把 4K 源降到 1080p——
 *  这正是它存在的意义；旧实现只抽帧不降采样 ⇒ 4K60 转完仍是 4K24，
 *  像素量只降到 40%，内存/耗时几乎没省（现场 RSS 690MB）。
 *  用户显式设 resMax 时以用户值为准（更小者生效）。 */
const TRANSCODE_DEFAULT_MAXW = Math.max(0, Number(process.env.DSH_WE_TRANSCODE_DEFAULT_MAXW ?? 1920) || 0);
/** ⓪(2026-09-17 用户第 1 条) 转码的**内存准入闸门**：本机实测（同一 4K60 源，
 *  `-threads 1`，libx264 crf23 veryfast，取 /proc/<pid>/VmHWM 峰值）——
 *    · 4K + fps24（旧口径，无降采样）：**656 MB** / 6s 片段 23.8s
 *    · 1080p + fps24（新默认）：      **275 MB** / 11.3s
 *  ⇒ 降采样是唯一有效且**不牺牲码率**的内存旋钮（同片段产物 5.7MB → 1.6MB）。
 *  实测排除的两个"看起来能省"的做法，避免后人重走：
 *    · `-max_muxing_queue_size 128` → 245.8 vs 276.1 MB（噪声内，**无效**）；
 *    · x264 `rc-lookahead=0:ref=1:bframes=0` → 178MB 但产物 1.6→3.4MB（**码率翻倍**，不划算）；
 *    · OS 级 `ulimit -v` 包壳 → ffmpeg 的**虚拟地址空间**远大于 RSS，512MB 上限直接起不来
 *      （实测 spawn 即崩），而且 `sh -c` 包壳会让 `proc.kill()` 只杀 sh、ffmpeg 变孤儿
 *      ⇒ 与"切壁纸/退出要能 kill"冲突，**不能用**。
 *  因此内存侧改为"**准入**"：系统可用内存低于阈值时**推迟**本次转码（抛错让客户端
 *  直读原片），而不是起一个必 OOM 的进程把整机拖进 swap。 */
const TRANSCODE_MIN_AVAIL_MB = Math.max(0, Number(process.env.DSH_WE_TRANSCODE_MIN_AVAIL_MB ?? 1024) || 0);
/** ⓪(2026-09-17) ffmpeg 供给链之外的**并发**上限（同时几个 ffmpeg）：见 TRANSCODE_MAX_ACTIVE
 *  （默认 1）。内存压力值从 /proc/meminfo 读（Linux；其它平台返回 null=不判）。 */
function systemAvailMemMb() {
  try {
    const t = readFileSync('/proc/meminfo', 'utf8');
    const m = /MemAvailable:\s+(\d+)\s+kB/.exec(t);
    if (m) return Math.round(Number(m[1]) / 1024);
    const f = /MemFree:\s+(\d+)\s+kB/.exec(t);
    return f ? Math.round(Number(f[1]) / 1024) : null;
  } catch { return null; }   // 非 Linux / 读不到 ⇒ 不判（不误伤）
}
/** 准入判断：返回 '' = 放行；否则返回人类可读的拒绝原因（含实测数字，便于现场定位）。 */
function transcodeMemGuard() {
  if (!(TRANSCODE_MIN_AVAIL_MB > 0)) return '';
  const avail = systemAvailMemMb();
  if (avail === null) return '';
  if (avail >= TRANSCODE_MIN_AVAIL_MB) return '';
  return '可用内存仅 ' + avail + 'MB < 转码准入阈值 ' + TRANSCODE_MIN_AVAIL_MB + 'MB（避免转码把整机拖进 swap）';
}
/** ⓪(2026-09-17) 转码 x264 的**额外参数**（默认空 = 不动）。
 *  留这个 env 是为了让"极端省内存"的场景可现场调，但注意实测：把
 *  `rc-lookahead=0:sync-lookahead=0:ref=1:bframes=0` 打开能把峰值 275→178MB，
 *  代价是产物 1.6→3.4MB（码率翻倍）——**默认不开**，别拿磁盘换内存。 */
const TRANSCODE_X264_PARAMS = String(process.env.DSH_WE_TRANSCODE_X264_PARAMS || '').trim();
/** ①(修正) 进程内 futex 失败记忆：Android/proot 沙箱 seccomp 拦多线程 futex 时
 *  置 true，后续转码直接单线程（避免每次先白失败一次）。 */
let TRANSCODE_FUTEX_FALLBACK = false;
/** ①(修正) 同时进行的 ffmpeg 转码进程数上限：Android 内存小，多个 4K 转码并发
 *  会 OOM/futex 崩溃（实测用户环境 3 个并发同时崩）。默认 1=串行最稳。 */
const TRANSCODE_MAX_ACTIVE = Math.max(1, Number(process.env.DSH_WE_TRANSCODE_MAX_ACTIVE) || 1);
let TRANSCODE_ACTIVE = 0;
const TRANSCODE_WAITERS = [];
/** ②(Qoder 审查 M7) 转码排队等待上限：超过即抛错让客户端回退原片（防浏览器已
 *  放弃、服务端仍白跑长队列）。默认 30s。 */
const TRANSCODE_QUEUE_TIMEOUT_MS = Math.max(5000, Number(process.env.DSH_WE_TRANSCODE_QUEUE_TIMEOUT_MS) || 30000);
/** ⓪(2026-09-17) 把 transcodes/ 收进「数量 ≤ TRANSCODE_CACHE_KEEP 且 合计 ≤ TRANSCODE_MAX_BYTES」。
 *  **最旧先删**；`protectPath` = 本次刚转好、正等着被流出去的产物，绝不能被自己这轮清理删掉。
 *  ⚠ 本轮自查抓到的真 bug（v1 字节上限写法）：淘汰循环写成"从最新开始遍历"，于是**刚转好的
 *  产物第一个被删** ⇒ 该源下次请求必然缓存 miss、每次都要从头再转一遍（磁盘还白占一轮）。
 *  字节淘汰必须**从尾部（最旧）向前**走，并跳过受保护的那一个。 */
function pruneTranscodeCache(protectPath) {
  const removed = { cache: 0, errlog: 0, residue: 0 };
  let freed = 0;
  const protect = protectPath ? resolve(protectPath) : null;
  // ①(2026-09-17 用户第 1 条) tc_*.mp4：**数量 + 合计字节**双上限，最旧先删。
  //  旧实现只有数量上限，而单个 4K 产物 70–130MB ⇒ 12 个就能堆 1.5GB。
  try {
    const dir = transcodeCacheDir();
    const rows = [];
    for (const n of readdirSync(dir)) {
      if (!(n.startsWith('tc_') && n.endsWith('.mp4'))) continue;
      let size = 0, mtime = 0;
      try { const st = statSync(join(dir, n)); size = st.size; mtime = st.mtimeMs; } catch { /* 竞态：刚被删 */ }
      rows.push({ n, size, mtime });
    }
    rows.sort((a, b) => b.mtime - a.mtime); // 最新在前
    let total = rows.reduce((s, r) => s + r.size, 0);
    let count = rows.length;
    for (let i = rows.length - 1; i >= 0; i--) {   // ← 从**最旧**（尾部）开始
      const r = rows[i];
      if (count <= TRANSCODE_CACHE_KEEP && total <= TRANSCODE_MAX_BYTES) break;
      const full = join(dir, r.n);
      if (protect && resolve(full) === protect) continue;   // 本次产物：受保护，绝不删
      try {
        unlinkSync(full);
        removed.cache++; freed += r.size; count--; total -= r.size;
      } catch { /* 单个删不掉不阻断其余 */ }
    }
    if (removed.cache) {
      console.log('[dsh-mpkg-wallpaper][prune] transcodes/ 转码产物：已删除 ' + removed.cache + ' 个最旧文件，释放 '
        + (freed / 1048576).toFixed(2) + ' MB（上限 ' + TRANSCODE_CACHE_KEEP + ' 个 / ' + Math.round(TRANSCODE_MAX_BYTES / 1048576) + ' MB）');
    }
  } catch { /* 忽略 */ }
  // ①(修正) ffmpeg-err-*.log 清理：保留最近 FFMPEG_ERR_KEEP 个（默认 50），过多自动删除
  try {
    const dir = transcodeCacheDir();
    const errs = readdirSync(dir).filter((n) => n.startsWith('ffmpeg-err-') && n.endsWith('.log'));
    if (errs.length > FFMPEG_ERR_KEEP) {
      const withStat = errs.map((n) => {
        try { return { n, mtime: statSync(join(dir, n)).mtimeMs }; } catch { return { n, mtime: 0 }; }
      }).sort((a, b) => b.mtime - a.mtime);
      for (let i = FFMPEG_ERR_KEEP; i < withStat.length; i++) {
        try { unlinkSync(join(dir, withStat[i].n)); removed.errlog++; } catch { /* 忽略 */ }
      }
    }
  } catch { /* 忽略 */ }
  // ①(修正) src_*.bin 残留清理：materializeSource 提取的临时源文件，正常路径在
  // transcodeToFps 的 finally 里 cleanup；进程被杀/崩溃时残留（实测 20 个 × 130MB
  // ≈ 3GB 堆积）。转码单任务硬超时 15 分钟，mtime 超过 1 小时必是残留，直接删。
  // ②(Qoder 审查) 一并清理 tc_*.mp4.tmp* 残留（同源泄漏：renameSync 未执行时残留）。
  try {
    const dir = transcodeCacheDir();
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const n of readdirSync(dir)) {
      if (n.startsWith('src_') && n.endsWith('.bin')) {
        try {
          const st = statSync(join(dir, n));
          if (st.mtimeMs < cutoff) { unlinkSync(join(dir, n)); removed.residue++; freed += st.size; }
        } catch { /* 忽略 */ }
      }
    }
    // ②(Qoder 审查) tc_*.mp4.tmp<PID>：转码中间文件，进程被杀时 renameSync
    // 未执行 → 永久残留。mtime>1h 必是残留（单任务硬超时 15min），直接删。
    // 正在写的 tmp 由当前任务持有（<15min），不会被误删。
    for (const n of readdirSync(dir)) {
      if (n.startsWith('tc_') && /\.tmp(\d+)?$/.test(n)) {
        try {
          const st = statSync(join(dir, n));
          if (st.mtimeMs < cutoff) { unlinkSync(join(dir, n)); removed.residue++; freed += st.size; }
        } catch { /* 忽略 */ }
      }
    }
    if (removed.residue) {
      console.log('[dsh-mpkg-wallpaper][prune] transcodes/ 残留（src_*.bin / tc_*.mp4.tmp*）：已删除 '
        + removed.residue + ' 个，释放 ' + (freed / 1048576).toFixed(2) + ' MB（口径：mtime > 1h 即残留）');
    }
  } catch { /* 忽略 */ }
  return removed;
}
/** ⓪(2026-09-17) transcodes/ 当前占用（数量 + 字节），供启动日志与 /probe 现场核对。 */
function transcodeCacheStat() {
  const out = { count: 0, bytes: 0, residue: 0, errlog: 0 };
  try {
    const dir = transcodeCacheDir();
    for (const n of readdirSync(dir)) {
      let size = 0;
      try { size = statSync(join(dir, n)).size; } catch { /* 竞态 */ }
      if (n.startsWith('tc_') && n.endsWith('.mp4')) { out.count++; out.bytes += size; }
      else if (n.startsWith('src_') || /\.tmp(\d+)?$/.test(n)) { out.residue++; out.bytes += size; }
      else if (n.startsWith('ffmpeg-err-')) out.errlog++;
    }
  } catch { /* 目录不存在 */ }
  return out;
}
function ffmpegMagicOk(buf) {
  if (buf.length < 4) return false;
  const mz = buf[0] === 0x4d && buf[1] === 0x5a;                                    // PE (Windows)
  const elf = buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46; // ELF
  const mach = buf[0] === 0xcf && buf[1] === 0xfa && buf[2] === 0xed && buf[3] === 0xfe; // Mach-O
  return mz || elf || mach;
}
function ffmpegAssetName() {
  const m = FFMPEG_STATIC_ASSETS[process.platform];
  return m ? m[process.arch] || null : null;
}
function ffmpegDownloadUrls(asset) {
  const env = process.env.DSH_WE_FFMPEG_URL && process.env.DSH_WE_FFMPEG_URL.trim();
  if (env) return [env];
  return [
    'https://github.com/eugeneware/ffmpeg-static/releases/download/' + FFMPEG_STATIC_TAG + '/' + asset,
    'https://registry.npmmirror.com/-/binary/ffmpeg-static/' + FFMPEG_STATIC_TAG + '/' + asset,
  ];
}

/** 探测单个候选 ffmpeg：`-version` 成功返回 { version }，失败返回 null。 */
function ffmpegVersionOf(bin) {
  try {
    const out = execFileSync(bin, ['-version'], {
      encoding: 'utf8', timeout: 8000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'],
    });
    const line = String(out).split(/\r?\n/)[0] || '';
    const m = /version\s+([^\s,]+)/i.exec(line);
    return { version: m ? m[1] : (line.trim() || null) };
  } catch { return null; }
}

/** ffmpeg 探测链（不下载）：env DSH_WE_FFMPEG → 系统 PATH（win 上 ffmpeg.exe）→ 缓存静态二进制。
 *  返回 { path, version } | null；找不到不抛错。 */
function resolveFfmpeg() {
  const envPath = (process.env.DSH_WE_FFMPEG || '').trim();
  if (envPath && existsSync(envPath) && statSync(envPath).isFile()) {
    const v = ffmpegVersionOf(envPath);
    return { path: envPath, version: v ? v.version : null };
  }
  const names = process.platform === 'win32' ? ['ffmpeg.exe', 'ffmpeg'] : ['ffmpeg'];
  for (const name of names) {
    const v = ffmpegVersionOf(name);
    if (v) return { path: name, version: v.version };
  }
  const cached = join(ffmpegDataDir(), ffmpegExeName());
  if (existsSync(cached) && statSync(cached).isFile()) {
    const v = ffmpegVersionOf(cached);
    return { path: cached, version: v ? v.version : null };
  }
  return null;
}

/** 确保可用（探测链 + 已下载的静态二进制）。**绝不自动下载** —— 用户显式点
 *  /ffmpeg-download 才下载。返回 { path, version } | null。 */
async function ensureFfmpeg() {
  return resolveFfmpeg();
}

/** 同 resolveFfmpeg，但额外返回来源标识（env / system / cached），供 /ffmpeg-check 区分——
 *  客户端据此显示「系统已装 / 缓存已装 / 未装」，卸载只应针对 cached。 */
function resolveFfmpegSource() {
  const envPath = (process.env.DSH_WE_FFMPEG || '').trim();
  if (envPath && existsSync(envPath) && statSync(envPath).isFile()) {
    const v = ffmpegVersionOf(envPath);
    return { source: 'env', path: envPath, version: v ? v.version : null };
  }
  const names = process.platform === 'win32' ? ['ffmpeg.exe', 'ffmpeg'] : ['ffmpeg'];
  for (const name of names) {
    const v = ffmpegVersionOf(name);
    if (v) return { source: 'system', path: name, version: v.version };
  }
  const cached = join(ffmpegDataDir(), ffmpegExeName());
  if (existsSync(cached) && statSync(cached).isFile()) {
    const v = ffmpegVersionOf(cached);
    return { source: 'cached', path: cached, version: v ? v.version : null };
  }
  return null;
}

/** 流式下载单个 URL 到 .part 文件：校验 大小>20MB + 魔数(MZ/ELF/Mach-O) + sha256。
 *  返回 { total, sha256 }；任一校验失败抛错。 */
async function downloadFfmpegToFile(url, tmp, signal) {
  const res = await fetch(url, { redirect: 'follow', signal, headers: { 'User-Agent': 'dsh-mpkg-wallpaper' } });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' @ ' + url);
  if (!res.body) throw new Error('no response body @ ' + url);
  const reader = res.body.getReader();
  const totalBytes = Number(res.headers.get('content-length')) || 0;
  if (ffmpegDownloadProgress) ffmpegDownloadProgress.total = totalBytes;
  const fd = openSync(tmp, 'w');
  const hash = crypto.createHash('sha256');
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length) {
        let off = 0;
        while (off < value.length) off += writeSync(fd, value, off, value.length - off);
        hash.update(value);
        total += value.length;
        if (ffmpegDownloadProgress) ffmpegDownloadProgress.downloaded = total;
      }
    }
  } finally {
    closeSync(fd);
  }
  if (total < 20 * 1024 * 1024) throw new Error('implausible size ' + total + ' @ ' + url);
  const head = Buffer.alloc(8);
  try {
    const rfd = openSync(tmp, 'r');
    try {
      let got = 0;
      while (got < 8) { const n = readSync(rfd, head, got, 8 - got, got); if (n <= 0) break; got += n; }
    } finally { closeSync(rfd); }
  } catch { /* 读头失败 → magic 检查会拒绝 */ }
  if (!ffmpegMagicOk(head)) throw new Error('unrecognized binary magic @ ' + url);
  return { total, sha256: hash.digest('hex') };
}

/** 下载当前平台的 ffmpeg-static 单文件到 DATA_DIR/ffmpeg/ffmpeg[.exe]（用户显式触发）。
 *  单飞防并发；校验通过后原子 rename。成功返回 { path, size }；失败抛错。 */
async function downloadFfmpeg() {
  const target = join(ffmpegDataDir(), ffmpegExeName());
  if (existsSync(target)) return { path: target, size: statSync(target).size };
  const asset = ffmpegAssetName();
  if (!asset) throw new Error('unsupported platform ' + process.platform + '/' + process.arch);
  if (typeof fetch !== 'function') throw new Error('fetch unavailable (Node < 18?)');
  if (ffmpegDownloadPromise) return ffmpegDownloadPromise;
  ffmpegDownloadPromise = (async () => {
    const urls = ffmpegDownloadUrls(asset);
    ffmpegDownloadProgress = { phase: 'downloading', downloaded: 0, total: 0, updatedAt: Date.now() };
    let lastErr = null;
    for (const url of urls) {
      const tmp = target + '.part' + Date.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5 * 60 * 1000);
      try {
        const r = await downloadFfmpegToFile(url, tmp, ctrl.signal);
        const want = FFMPEG_STATIC_SHA256[asset];
        if (want && r.sha256 !== want) throw new Error('sha256 mismatch (want ' + want + ') @ ' + url);
        if (process.platform !== 'win32') { try { chmodSync(tmp, 0o755); } catch { /* 忽略 */ } }
        renameSync(tmp, target); // 原子写入：校验全过才就位
        lastFfmpegDownloadError = null;
        ffmpegDownloadProgress = null;
        return { path: target, size: r.total };
      } catch (err) {
        lastErr = err;
        try { unlinkSync(tmp); } catch { /* 忽略 */ }
      } finally {
        clearTimeout(timer);
      }
    }
    ffmpegDownloadProgress = null;
    lastFfmpegDownloadError = String(lastErr && lastErr.message || lastErr);
    throw new Error('ffmpeg download failed: ' + lastFfmpegDownloadError);
  })().finally(() => { ffmpegDownloadPromise = null; });
  return ffmpegDownloadPromise;
}

/** 在 mpkg 容器里挑视频条目：真视频文件（mp4/webm/mov）优先，其次含 ftyp 的视频纹理 tex。 */
function pickMpkgVideoEntry(entries, filePath, dataStart) {
  const vid = entries.findIndex((e) => /\.(mp4|webm|mov)$/i.test(e.name));
  if (vid >= 0) return entries[vid];
  let fd = null;
  try { fd = openSync(filePath, 'r'); } catch { return null; }
  try {
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!e.name.toLowerCase().endsWith('.tex') || e.size < 1024 * 1024) continue;
      if (/蓝幕|绿幕|bluescreen|greenscreen|chroma|keying|抠像|入场|intro|entry/i.test(e.name)) continue;
      const len = Math.min(65536, e.size);
      const buf = Buffer.alloc(len);
      let off = dataStart + e.index, got = 0;
      while (got < len) { const n = readSync(fd, buf, got, len - got, off + got); if (n <= 0) break; got += n; }
      if (buf.indexOf(Buffer.from('ftyp')) >= 4) return e;
    }
  } finally { closeSync(fd); }
  return null;
}

/** 解析转码源：mpkg token（files 映射）→ 绝对路径 → customDir 内相对路径。 */
function resolveTranscodeSource(fileOrToken) {
  if (!fileOrToken) return null;
  const rec = files.get(fileOrToken);
  if (rec) {
    const entry = pickMpkgVideoEntry(rec.entries, rec.path, rec.dataStart);
    return entry ? { type: 'mpkg', rec, entry } : null;
  }
  if (isAbsolute(fileOrToken)) {
    // ①(Qoder 审查 S1) 路径穿越：绝对路径只允许 DATA_DIR / customDir 白名单内，
    // 否则 /transcode?file=/etc/passwd 可探测/流出任意系统文件。
    // 用 resolve 归一后前缀匹配（防 .. 绕过）。
    const p = resolve(fileOrToken);
    const allowed = [DATA_DIR, customDir].filter((d) => d && typeof d === 'string');
    const ok = allowed.some((d) => {
      const base = resolve(d);
      return p === base || p.startsWith(base + sep);
    });
    if (ok && existsSync(p) && statSync(p).isFile()) return { type: 'file', path: p };
    return null;
  }
  if (customDir && !fileOrToken.includes('..') && !fileOrToken.includes('/') && !fileOrToken.includes('\\')) {
    const p = join(customDir, fileOrToken);
    if (existsSync(p) && statSync(p).isFile()) return { type: 'file', path: p };
  }
  return null;
}

/** ①(新) 从 client 的 image 串（"host:?..."）解析转码源——转码接入播放路径后，
 *  视频壁纸的 URL 就是 /transcode?src=<image>，这里还原成 host 可读的源。
 *  覆盖三种来源：ltoken（本地库 video）、custom（自定义目录/子文件夹）、
 *  token（上传的 mpkg）。路径穿越校验与 /library-media、/custom-media 同款。 */
function resolveTranscodeByImage(image) {
  if (typeof image !== 'string' || image.indexOf('host:') !== 0) return null;
  const q = image.slice(5);
  const p = new URLSearchParams(q.replace(/^\?/, ''));
  if (q.indexOf('ltoken=') >= 0) {
    const lt = p.get('ltoken') || '';
    const file = p.get('file') || '';
    const rec = library.get(lt);
    if (!rec || !rec.media || file !== rec.media.split(/[\\/]/).pop()) return null;
    if (!existsSync(rec.media) || !statSync(rec.media).isFile()) return null;
    return { type: 'file', path: rec.media };
  }
  if (q.indexOf('custom=') >= 0) {
    const folder = p.get('folder') || '';
    const file = p.get('file') || '';
    if (!file || file.includes('..') || file.includes('/') || file.includes('\\')) return null;
    let base = customDir;
    if (folder) {
      if (folder.includes('..') || folder.includes('/') || folder.includes('\\')) return null;
      base = join(base, folder);
    }
    const fp = join(base, file);
    if (!existsSync(fp) || !statSync(fp).isFile()) return null;
    return { type: 'file', path: fp };
  }
  if (q.indexOf('token=') >= 0) {
    const token = p.get('token') || '';
    const idx = Number(p.get('index'));
    let rec = files.get(token);
    if (!rec) { restoreFiles(); rec = files.get(token); }
    const entry = rec && rec.entries ? rec.entries.find((x) => x.index === idx) || rec.entries[idx] : null;
    if (!rec || !entry) return null;
    return { type: 'mpkg', rec, entry };
  }
  return null;
}

/** mpkg 容器条目 → 临时文件（ffmpeg 需要真实文件输入）。返回 { file, cleanup }。 */
function materializeSource(src, cacheDir) {
  if (src.type === 'file') return { file: src.path, cleanup: null };
  const entry = src.entry;
  const tmp = join(cacheDir, 'src_' + Date.now() + '_' + Math.floor(Math.random() * 1e6) + '.bin');
  const fd = openSync(src.rec.path, 'r');
  const outFd = openSync(tmp, 'w');
  try {
    const start = src.rec.dataStart + entry.index;
    const len = entry.size;
    const buf = Buffer.alloc(256 * 1024);
    let off = 0;
    while (off < len) {
      const want = Math.min(buf.length, len - off);
      const n = readSync(fd, buf, 0, want, start + off);
      if (n <= 0) break;
      let w = 0;
      while (w < n) w += writeSync(outFd, buf, w, n - w);
      off += n;
    }
  } finally {
    closeSync(fd);
    closeSync(outFd);
  }
  return { file: tmp, cleanup: () => { try { unlinkSync(tmp); } catch { /* 忽略 */ } } };
}

/** 异步 spawn ffmpeg：stderr 写日志文件；超时 kill（TRANSCODE_TIMEOUT_MS）；
 *  dsh web 宿主在 Windows 上对非 detached 的控制台子进程有 spawn 限制
 *  （实测 0xFFFFFFEA / EPERM），故先试 detached 再试普通 spawn。 */
function spawnFfmpeg(ff, args) {
  return new Promise((resolve, reject) => {
    const errLog = join(transcodeCacheDir(), 'ffmpeg-err-' + process.pid + '-' + Date.now() + '.log');
    const attempts = [
      { name: 'detached', opts: { detached: true, windowsHide: true } },
      { name: 'plain', opts: { windowsHide: true } },
    ];
    const cwd = process.platform === 'win32' ? (process.env.SystemRoot || 'C:\\') : transcodeCacheDir();
    let idx = 0;
    const errors = [];
    const runNext = () => {
      if (idx >= attempts.length) {
        let detail = errors.join('; ');
        try {
          const t = readFileSync(errLog, 'utf8').trim();
          if (t) detail += ' | stderr: ' + t.split('\n').slice(-4).join(' | ');
        } catch { /* 忽略 */ }
        // ①(修正) 失败日志保留（最多 FFMPEG_ERR_KEEP 个，由 pruneTranscodeCache 按 mtime 清理）
        reject(new Error('ffmpeg spawn failed' + (detail ? ': ' + detail : '') + ' | errlog: ' + errLog));
        return;
      }
      const a = attempts[idx++];
      let errFd = null;
      // ①(Qoder 审查 M3) 用 'a' 追加而非 'w' 截断：多 attempt 时保留第一个
      // attempt 的 stderr（'w' 会让第二个 attempt 清空第一个的失败原因）。
      try { errFd = openSync(errLog, 'a'); } catch { /* 忽略 */ }
      let proc = null;
      try {
        proc = spawn(ff, args, { ...a.opts, cwd, stdio: errFd ? ['ignore', 'ignore', errFd] : 'ignore' });
      } catch (err) {
        if (errFd) { try { closeSync(errFd); } catch { /* 忽略 */ } }
        // ①(Qoder 审查 M4) spawn 阶段 throw（EPERM/ENOENT）：刚创建的空 errLog
        // 无内容无价值，直接删（失败保留语义只对**真实运行过**的 ffmpeg 有意义）。
        try { unlinkSync(errLog); } catch { /* 忽略 */ }
        errors.push(a.name + ' spawn throw ' + (err && err.code ? err.code : err));
        runNext();
        return;
      }
      ACTIVE_FFMPEG.add(proc);
      let done = false;
      let timedOut = false;
      // ①(修正) 区分「spawn 阶段失败」vs「进程执行阶段失败」：
      //   - spawn throw / 'error'（EPERM 等 Windows 限制）→ 可重试下一个 attempt（runNext）
      //   - 超时 kill / exit 非 0 → **直接 reject**（绝不再 runNext，否则 POSIX 上一次真实
      //     超时杀掉进程后会把整个转码再跑一遍，最长 ~30min；被 kill 的子进程已移出
      //     ACTIVE_FFMPEG，无法再管）
      const finalReject = (msg) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        ACTIVE_FFMPEG.delete(proc);
        if (errFd) { try { closeSync(errFd); } catch { /* 忽略 */ } }
        let detail = msg || 'ffmpeg failed';
        try {
          const t = readFileSync(errLog, 'utf8').trim();
          if (t) detail += ' | stderr: ' + t.split('\n').slice(-4).join(' | ');
        } catch { /* 忽略 */ }
        // ①(修正) 失败日志保留（最多 FFMPEG_ERR_KEEP 个，由 pruneTranscodeCache 按 mtime 清理）
        reject(new Error(detail + ' | errlog: ' + errLog));
      };
      const settle = (msg) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        ACTIVE_FFMPEG.delete(proc);
        if (errFd) { try { closeSync(errFd); } catch { /* 忽略 */ } }
        if (msg) errors.push(msg);
        runNext();
      };
      const timer = setTimeout(() => {
        timedOut = true;
        try { proc.kill(); } catch { /* 忽略 */ }
        // ①(修正) 超时：直接失败，不重试（见 finalReject 注释）
        finalReject(a.name + ' timed out after ' + TRANSCODE_TIMEOUT_MS + 'ms (killed)');
      }, TRANSCODE_TIMEOUT_MS);
      proc.on('error', (err) => {
        // spawn 阶段的 'error'（如 EPERM）→ 重试下一个 attempt；执行中 error → 直接失败
        if (!done && timedOut) { finalReject(a.name + ' spawn error ' + (err && err.code ? err.code + ' ' + err.message : err)); return; }
        settle(a.name + ' spawn error ' + (err && err.code ? err.code + ' ' + err.message : err));
      });
      proc.on('exit', (code) => {
        if (done) return;
        if (code === 0) {
          done = true;
          clearTimeout(timer);
          ACTIVE_FFMPEG.delete(proc);
          if (errFd) { try { closeSync(errFd); } catch { /* 忽略 */ } }
          try { unlinkSync(errLog); } catch { /* 忽略 */ }
          resolve();
          return;
        }
        // ①(修正) 非 0 退出：直接失败不重试（超时被 kill 也是这里，避免再跑一遍）
        finalReject(a.name + ' exit ' + code + (timedOut ? ' (killed by timeout)' : ''));
      });
    };
    runNext();
  });
}

/** 跑一次转码：`-vf scale+抽帧`（maxW>0 时先降分辨率，再 fps=<cap>）+ CPU 编码（libx264 优先，
 *  libsvtav1 回退），-an 去音频。maxW=0 时只抽帧不缩放。
 *  ①(修正) Android/proot 沙箱（seccomp）拦截多线程 futex → 转码崩溃
 *  （实测 errLog: "The futex facility returned an unexpected error code."，用户环境
 *  dsh 进程 uid 10325 / Seccomp:2 复现）。策略：先多线程试；stderr 含 futex →
 *  整个编码器列表降级 -threads 1 单线程重试（PC 用户不受影响，Android 自动兼容）。 */
async function runTranscode(srcFile, out, fps, maxW, job, isCancelled) {
  // ⓪(2026-09-17 排查中发现) **取消后不许重试**：客户端断开（切壁纸/关页）时
  //  /transcode 路由 kill 的是"当前那个 ffmpeg"，而下面 for 循环还有 libsvtav1 /
  //  单线程模式两个后续 attempt ⇒ 实测日志里出现"kill 掉第 1 个之后紧接着又起第 2 个"
  //  （用户在切壁纸，后台却又拉起一个新 ffmpeg）。取消是终态，任何 attempt 前都要查。
  const cancelled = () => { try { return typeof isCancelled === 'function' && !!isCancelled(); } catch { return false; } };
  const ff = await ensureFfmpeg();
  if (!ff) {
    throw new Error('ffmpeg not found (set DSH_WE_FFMPEG, install ffmpeg to PATH, or click 下载 ffmpeg → /ffmpeg-download)');
  }
  job.ff = ff.path;
  // ①(新) 降分辨率：`scale='min(maxW,iw)':-2` 保持宽高比、宽不超过 maxW（-2=高自动偶数）。
  // 与 fps 合并到一个 -vf 链（先缩放再抽帧，编码量更小）。
  const vf = maxW > 0 ? `scale='min(${maxW},iw)':-2,fps=${fps}` : `fps=${fps}`;
  const base = ['-y', '-hide_banner', '-loglevel', 'error', '-i', srcFile, '-vf', vf];
  const encoders = [
    { name: 'libx264', tail: ['-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast'] },
    { name: 'libsvtav1', tail: ['-c:v', 'libsvtav1', '-crf', '32', '-preset', '6'] },
  ];
  // ①(修正) 线程模式：多线程 → (futex 失败时) 单线程。单线程时限制解码
  // 线程(-threads 1 输入侧)+滤镜线程(-filter_threads 1)，编码线程由输出侧
  // -threads 1 控制（见下方 full 拼接）。
  const threadModes = [
    { label: 'mt', extra: [] },
    { label: 'st', extra: ['-threads', '1', '-filter_threads', '1'] },
  ];
  let lastErr = null;
  // ①(修正) 进程内 futex 记忆：本进程一旦检测到 seccomp/proot 拦多线程 futex，
  // 后续所有转码直接单线程（避免每次都先白失败一次 + 堆积 0 字节 errlog）。
  let futexSeen = TRANSCODE_FUTEX_FALLBACK;
  for (const mode of threadModes) {
    if (cancelled()) throw new Error('cancelled');
    if (mode.label === 'mt' && futexSeen) continue; // 已知 futex 问题 → 跳过多线程
    for (const enc of encoders) {
      if (cancelled()) throw new Error('cancelled');   // ⓪ 换编码器前也要查
      job.encoder = enc.name + (mode.label === 'st' ? ' (单线程)' : '');
      // -f mp4 显式指定：临时输出路径不是 .mp4 后缀，ffmpeg 无法按扩展名选 muxer
      // ①(Qoder 审查 M5) 单线程时输出侧再加 -threads 1 控制编码线程
      // （输入侧 -threads 只管解码；mode.extra 已含输入侧与 filter_threads）。
      try {
        // ⓪(2026-09-17) x264 额外参数（默认空；见 TRANSCODE_X264_PARAMS 注释：省内存但费码率）
        const x264 = (enc.name === 'libx264' && TRANSCODE_X264_PARAMS) ? ['-x264-params', TRANSCODE_X264_PARAMS] : [];
        const full = [...mode.extra, ...base, ...enc.tail, ...x264, ...(mode.label === 'st' ? ['-threads', '1'] : []), '-movflags', '+faststart', '-an', '-f', 'mp4', out];
        await spawnFfmpeg(ff.path, full);
        return;
      } catch (err) {
        lastErr = err;
        try { unlinkSync(out); } catch { /* 忽略 */ }
        // ①(Qoder 审查) futex 判定用精确报错原文匹配，避免误伤：文件名/路径
        // 含 "futex"（如用户 mpkg 名 futex_test.mpkg）的打开错误也会被宽松
        // /futex/i 命中 → 误置 TRANSCODE_FUTEX_FALLBACK 永久单线程（性能损失）。
        if (/futex facility returned an unexpected error/i.test(String(err && err.message || ''))) {
          futexSeen = true;
          TRANSCODE_FUTEX_FALLBACK = true; // 记忆：本进程后续直接单线程
          break; // 多线程 futex 崩 → 不再试本模式其他编码器，直接单线程
        }
      }
    }
  }
  throw new Error('ffmpeg transcode failed (' + ff.path + ')'
    + (lastErr ? ': ' + lastErr.message : '')
    + (futexSeen ? ' | 沙箱限制多线程，已自动降级单线程仍失败' : '')
    + (lastFfmpegDownloadError ? ' | download: ' + lastFfmpegDownloadError : ''));
}

function setTranscodeJob(key, patch) {
  const job = Object.assign({ phase: 'working', percent: 0, updatedAt: Date.now() }, transcodeJobs.get(key) || {}, patch);
  transcodeJobs.set(key, job);
  lastTranscodeProgress = { ...job, key };
  if (transcodeJobs.size > TRANSCODE_JOBS_MAX) {
    const first = transcodeJobs.keys().next().value;
    if (first !== undefined) transcodeJobs.delete(first);
  }
  return job;
}

/** 转码到 <fps>（可选降分辨率到 maxW），磁盘缓存 keyed by 源标识|mtime|fps|maxW。
 *  返回缓存产物绝对路径。 */
async function transcodeToFps(src, fps, maxW, isCancelled) {
  const cancelled = () => { try { return typeof isCancelled === "function" && !!isCancelled(); } catch { return false; } };
  const srcPath = src.type === 'file' ? src.path : src.rec.path;
  const st = statSync(srcPath);
  const srcId = src.type === 'mpkg' ? 'mpkg:' + src.rec.path + ':' + src.entry.index : srcPath;
  const key = crypto.createHash('sha256')
    .update(srcId + '|' + Math.round(st.mtimeMs) + '|' + fps + '|' + (maxW || 0))
    .digest('hex').slice(0, 20);
  const cacheDir = transcodeCacheDir();
  const cachePath = join(cacheDir, 'tc_' + key + '.mp4');
  if (existsSync(cachePath)) return cachePath;
  const inflight = TRANSCODE_INFLIGHT.get(cachePath);
  if (inflight) return inflight;
  const progKey = srcId + '|' + fps + '|' + (maxW || 0);
  const p = (async () => {
    // ①(修正) 并发闸门：Android 内存小，多个 4K 转码并发会 OOM/futex 崩溃
    // （实测用户环境 3 个并发同时崩）。超过 TRANSCODE_MAX_ACTIVE 则排队等待。
    // ②(Qoder 审查 M7) 排队加超时：MAX=1 时排在长任务(4K 15min)后面的请求
    // 会挂到浏览器放弃，服务端仍白跑。30s 等不到就抛错 → 客户端回退原片。
    if (TRANSCODE_ACTIVE >= TRANSCODE_MAX_ACTIVE) {
      const got = await new Promise((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          const i = TRANSCODE_WAITERS.indexOf(wake);
          if (i >= 0) TRANSCODE_WAITERS.splice(i, 1);
          resolve(false);
        }, TRANSCODE_QUEUE_TIMEOUT_MS);
        const wake = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(true);
        };
        TRANSCODE_WAITERS.push(wake);
      });
      if (!got) throw new Error('转码队列繁忙（等待超过 ' + Math.round(TRANSCODE_QUEUE_TIMEOUT_MS / 1000) + 's），请稍后重试');
    }
    // ①(修复) 排队期间客户端已断开 → 直接取消，不再白跑/污染队列
    if (cancelled()) throw new Error('cancelled');
    // ⓪(2026-09-17 用户第 1 条) 内存准入：可用内存不足 → **不起** ffmpeg（抛错让客户端直读原片）。
    //  为什么是"拒绝"而不是"限制"：实测 ulimit -v 会把 ffmpeg 直接打死、x264 参数省内存要
    //  拿码率翻倍换（见 TRANSCODE_MIN_AVAIL_MB 注释）；在内存已经紧张的机器上，正确动作
    //  是**不做**这件可选的重活，而不是做一半把整机拖进 swap。
    const memBlock = transcodeMemGuard();
    if (memBlock) {
      setTranscodeJob(progKey, { phase: 'error', percent: 0, error: memBlock });
      console.warn('[dsh-mpkg-wallpaper][transcode] 跳过转码（内存准入）：' + memBlock);
      throw new Error('内存不足，已跳过转码：' + memBlock);
    }
    TRANSCODE_ACTIVE++;
    try {
      setTranscodeJob(progKey, { phase: 'working', percent: 5 });
      const tmp = cachePath + '.tmp' + process.pid;
      // 先确认 ffmpeg 可用（避免白做一次容器提取）
      const ff = await ensureFfmpeg();
      if (!ff) {
        setTranscodeJob(progKey, { phase: 'error', percent: 0, error: 'ffmpeg not found' });
        throw new Error('ffmpeg not found (set DSH_WE_FFMPEG, install ffmpeg to PATH, or click 下载 ffmpeg → /ffmpeg-download)');
      }
      const mat = materializeSource(src, cacheDir);
      try {
        setTranscodeJob(progKey, { phase: 'working', percent: 10 });
        await runTranscode(mat.file, tmp, fps, maxW, transcodeJobs.get(progKey) || {}, isCancelled);
        renameSync(tmp, cachePath);
        setTranscodeJob(progKey, { phase: 'done', percent: 100 });
        pruneTranscodeCache(cachePath); // ⓪ 成功即做 LRU 清理；cachePath = 本次产物（受保护，绝不删自己）
        return cachePath;
      } catch (err) {
        try { unlinkSync(tmp); } catch { /* 忽略 */ }
        pruneTranscodeCache(); // ①(修正) 失败也做缓存+错误日志 LRU 清理（保留最近 FFMPEG_ERR_KEEP 个 errlog）
        setTranscodeJob(progKey, { phase: 'error', percent: 0, error: String(err && err.message || err) });
        throw err;
      } finally {
        if (mat.cleanup) mat.cleanup();
      }
    } finally {
      // ①(修正) Qoder 审查发现：TRANSCODE_INFLIGHT.delete 原先在内层 finally ——
      // ensureFfmpeg 失败 / materializeSource 抛错时（内层 try 未进入）不执行 →
      // cachePath 永久残留在 inflight Map → 该源后续所有转码请求 return 已 reject
      // 的 promise → 永久转码失败（用户实测"装了 ffmpeg 也没用/黑屏"）。
      // 移到外层 finally：任何路径都必定清理。
      TRANSCODE_INFLIGHT.delete(cachePath);
      TRANSCODE_ACTIVE--;
      const next = TRANSCODE_WAITERS.shift();
      if (next) next();
    }
  })();
  TRANSCODE_INFLIGHT.set(cachePath, p);
  return p;
}

/** 转码/下载进度 JSON（/transcode-progress 与 /transcode 的 progress 子路径共用）。 */
function handleTranscodeProgress(req, res) {
  try {
    const url = new URL(req.url || '', 'http://localhost');
    const file = (url.searchParams.get('file') || '').trim();
    const srcParam = (url.searchParams.get('src') || '').trim();
    const fps = Number(url.searchParams.get('fps')) || 0;
    const maxWRaw = Number(url.searchParams.get('maxW'));
    const maxW = Number.isFinite(maxWRaw) && maxWRaw > 0 ? Math.min(3840, Math.round(maxWRaw)) : 0;
    let job = null;
    // ②(fix) src 优先（与 /transcode 同款）：客户端回退原片后轮询转码完成，
    // 用原始 image 串查询（旧式 file 兼容保留）。
    const src = srcParam ? resolveTranscodeByImage(srcParam) : resolveTranscodeSource(file);
    if (src) {
      const srcPath = src.type === 'file' ? src.path : src.rec.path;
      const srcId = src.type === 'mpkg' ? 'mpkg:' + src.rec.path + ':' + src.entry.index : srcPath;
      // ①(Qoder 审查 R7) 查询 key 与写入一致（含 maxW）——此前写入
      // srcId|fps|maxW、查询 srcId|fps，设了 maxW 的任务进度永远查不到(idle)。
      job = transcodeJobs.get(srcId + '|' + fps + '|' + maxW) || transcodeJobs.get(srcId + '|' + fps) || null;
    } else if (ffmpegDownloadProgress) {
      job = { phase: 'downloading', percent: ffmpegDownloadProgress.total > 0 ? Math.min(99, Math.round(ffmpegDownloadProgress.downloaded / ffmpegDownloadProgress.total * 100)) : 0, updatedAt: ffmpegDownloadProgress.updatedAt };
    } else {
      job = lastTranscodeProgress ? { ...lastTranscodeProgress } : null;
    }
    json(res, 200, { ok: true, phase: job ? job.phase : 'idle', percent: job ? job.percent : 0, updatedAt: job ? job.updatedAt : null });
  } catch (err) { json(res, 500, { ok: false, error: String(err && err.message || err) }); }
}

// ═══ MPW-DIAG-LIMIT-BEGIN ═══
// ①(P-104 2026-09-17 用户发布纪律②："这种自动上报、自动把什么存储到本地的类型的东西，这种需要
//   设置上限的，这上限别忘记了。")
//   触发者：客户端每 POST 一次 `/api/mpkg-wallpaper/diag` → 这里写一个**新**文件 `diag-<epochms>.json`
//   （不覆盖、不追加）。**旧实现没有任何数量/字节/TTL 上限** —— 实测把本机目录堆到
//   **3483 个文件 / 63MB**（2026-09-11 起）。本轮补上：数量 ≤50 个 + 合计 ≤32MB，**最旧先删**，
//   启动清理一次 + 每次写入前后各检查一次，清理动作打日志。
//   **本块是 diag 落盘上限的唯一来源**（要调只改这里；对照表见 we-scene-demo/docs/DATA-LIMITS.md）。
//   env 只用于测试/现场调参（`DSH_WE_DIAG_DIR` 换目录才能在不碰用户真实目录的前提下验清理路径）。
const numEnvLimit = (name, def) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : def;
};
const DIAG_DIR = process.env.DSH_WE_DIAG_DIR || join(os.homedir() || '.', '.dsh', '.dsh-mpkg-wallpaper');
const DIAG_KEEP = numEnvLimit('DSH_WE_DIAG_KEEP', 50);
const DIAG_MAX_BYTES = numEnvLimit('DSH_WE_DIAG_MAX_BYTES', 32 * 1024 * 1024);
/** 把 diag-*.json 收进「数量 ≤DIAG_KEEP 个 且 合计 ≤DIAG_MAX_BYTES」之内，**最旧先删**。
 *  只认 `diag-<数字>.json` 这一个模式 —— 同目录下 `custom-dir.json` / `ffmpeg/` 等一律不碰。
 *  任何异常都吞掉：清理绝不能让上报路径 500。返回 {removed, freed}。 */
function pruneDiagDir(reason) {
  let removed = 0, freed = 0;
  try {
    const re = /^diag-(\d+)\.json$/;
    const rows = [];
    for (const n of readdirSync(DIAG_DIR)) {
      const m = re.exec(n);
      if (!m) continue;
      let size = 0, mtime = 0;
      try { const st = statSync(join(DIAG_DIR, n)); size = st.size; mtime = st.mtimeMs; } catch { /* 竞态：刚被删 */ }
      rows.push({ n, size, mtime, ts: Number(m[1]) || 0 });
    }
    // 排序口径 = 文件名里的 epoch（名字即时间），拿不到才退回 mtime
    rows.sort((a, b) => (a.ts - b.ts) || (a.mtime - b.mtime) || a.n.localeCompare(b.n));
    let total = rows.reduce((s, r) => s + r.size, 0);
    let count = rows.length;
    for (const r of rows) {
      if (count <= DIAG_KEEP && total <= DIAG_MAX_BYTES) break;
      try { unlinkSync(join(DIAG_DIR, r.n)); removed++; freed += r.size; count--; total -= r.size; } catch { /* 单个删不掉不阻断其余 */ }
    }
  } catch { /* 目录不存在 / 权限不足 → 当作"没有可清理的" */ }
  if (removed) {
    console.log('[dsh-mpkg-wallpaper][prune] diag/（' + reason + '）：已删除 ' + removed + ' 个最旧文件，释放 '
      + (freed / 1048576).toFixed(2) + ' MB（上限 ' + DIAG_KEEP + ' 个 / ' + Math.round(DIAG_MAX_BYTES / 1048576) + ' MB）');
  }
  return { removed, freed };
}
// ═══ MPW-DIAG-LIMIT-END ═══
function apply(ctx) {
  // ①(P-104) **启动清理一次**：把上次运行遗留的超限 diag 目录收回限内（并留日志）。
  try { pruneDiagDir('启动'); } catch { /* 不影响插件启动 */ }
  // ⓪(2026-09-17 用户第 1 条「这里是不是 bug」) **启动清理一次** transcodes/：
  //  现场实测该目录 723MB / 38 个文件（含 130MB 的 src_*.bin 残留与 70MB 的 .tmp 半成品）。
  //  与 diag 目录同口径：启动就收进「数量 + 合计字节」上限内，并打一行日志说明上限值，
  //  让"上限是多少、这次清了多少"在宿主日志里看得见（不静默占盘）。
  try {
    const limits = '上限：' + TRANSCODE_CACHE_KEEP + ' 个 / ' + Math.round(TRANSCODE_MAX_BYTES / 1048576) + ' MB'
      + '；并发 ' + TRANSCODE_MAX_ACTIVE + '；默认降采样宽 ' + (TRANSCODE_DEFAULT_MAXW || '不限')
      + '；内存准入 ' + (TRANSCODE_MIN_AVAIL_MB || '关闭') + 'MB';
    const before = transcodeCacheStat();
    const removed = pruneTranscodeCache();
    const after = transcodeCacheStat();
    console.log('[dsh-mpkg-wallpaper][limits] transcodes 启动清理完成：'
      + '产物 ' + before.count + '→' + after.count + ' 个 / ' + (before.bytes / 1048576).toFixed(1) + '→' + (after.bytes / 1048576).toFixed(1) + ' MB'
      + '（本次删除 产物 ' + removed.cache + ' / 错误日志 ' + removed.errlog + ' / 残留 ' + removed.residue + ' 个）；' + limits);
  } catch { /* 不影响插件启动 */ }
  restoreFiles();
  restoreCustomDir();
  const webServer = ctx.webServer;
  if (!webServer || typeof webServer.register !== 'function') return;
  // ①(新) dsh-better-sidebar 安装检测（参考 elysia395 同款策略）：遍历 cordis
  // loader 条目树，命中 name==='dsh-better-sidebar' 或 id 含 better-sidebar 且未
  // 禁用。不依赖侧栏 DOM（懒加载会漏判）也不依赖其服务 API。loader 随 dsh-base
  // 提供，读不到按未安装。
  const betterSidebarLoaded = () => {
    try {
      const loader = ctx && ctx.loader;
      if (!loader || typeof loader.entries !== 'function') return false;
      for (const entry of loader.entries()) {
        const opts = entry && entry.options;
        if (!opts || opts.group) continue;
        const idStr = String(opts.id || '');
        const isSidebar = opts.name === 'dsh-better-sidebar'
          || idStr === 'dsh-better-sidebar'
          || idStr.startsWith('dsh-better-sidebar')
          || idStr.endsWith('better-sidebar'); // 聚合挂载（web-ui-better-sidebar）仍命中，但排除恰好含子串的其他插件
        if (isSidebar && !entry.disabled) return true;
      }
    } catch { /* loader 不可用按未安装 */ }
    return false;
  };
  {
    // 探测 host 可用性
    // ①(新 2026-09-11) 客户端 DOM 诊断上报：POST /api/mpkg-wallpaper/diag
    // 用途：无浏览器环境下定位"设置面板被困侧栏/菜单被聊天文字盖住"等 CSS 层级问题——
    // 让页面把真实 DOM 祖先链+computed 样式上报，落到 ~/.dsh/.dsh-mpkg-wallpaper/diag-<ts>.json
    webServer.register({
      kind: 'exact', path: BASE + '/diag',
      handler: async (req, res) => {
        try {
          let body = '';
          req.on('data', (c) => { body += c; if (body.length > 8 * 1024 * 1024) req.destroy(); });
          req.on('end', () => {
            try {
              const dir = DIAG_DIR;   // ①(P-104) 与 pruneDiagDir 同一个目录常量（旧实现就地重算 os.homedir()）
              mkdirSync(dir, { recursive: true });
              pruneDiagDir('写入前');   // ①(P-104) 写入前检查：先把上次遗留的超限收回去
              const fp = join(dir, 'diag-' + Date.now() + '.json');
              writeFileSync(fp, body);
              pruneDiagDir('写入后');   // ①(P-104) 写入后检查：本次这份也计入数量/字节上限
              json(res, 200, { ok: true, file: fp });
            } catch (e) { json(res, 500, { ok: false, error: String(e && e.message || e) }); }
          });
        } catch (e) { json(res, 500, { ok: false, error: String(e && e.message || e) }); }
      },
    });

    webServer.register({
      kind: 'exact', path: BASE + '/ping',
      handler: (req, res) => {
        let version = null;
        try {
          const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
          version = pkg.version || null;
        } catch { /* 忽略 */ }
        // ①(新) 附带 better-sidebar 检测（客户端「其他」tab 的适配分类据此显示）
        let betterSidebar = false;
        try { betterSidebar = betterSidebarLoaded(); } catch { /* 忽略 */ }
        // ①(新) 附带 better-sidebar 版本（客户端据此做版本自适应适配；null=未知/未装）
        // ①(修正 2026-09-17) 这里**曾经**写成 `betterSidebarVersion = betterSidebarVersion()`：
        //   局部变量与函数同名 → 调用的其实是局部变量(null) → TypeError 被空 catch 吞掉 →
        //   该字段恒为 null（装没装、什么版本都返回 null）。函数已改名 detectBetterSidebarVersion，
        //   局部变量保持与 JSON 字段同名，两者不再可能撞名。
        let betterSidebarVersion = null;
        try { betterSidebarVersion = detectBetterSidebarVersion(); } catch { /* 忽略 */ }
        json(res, 200, { ok: true, version, betterSidebar, betterSidebarVersion });
      },
    });

    // ⑤(新) 设置持久化到宿主端文件（参考 elysia395 v0.4.0）：
    // localStorage 按"地址+端口"隔离，DSH Desktop 随机端口时配置全丢；
    // 改存 DATA_DIR/settings.json（跨重启/换端口/清浏览器数据不丢）。
    // 客户端优先用 host；host 不可用时仍回退 localStorage（双写）。
    webServer.register({
      kind: 'exact', path: BASE + '/settings',
      handler: async (req, res) => {
        try {
          const method = (req.method || 'GET').toUpperCase();
          const filePath = join(DATA_DIR, 'settings.json');
          if (method === 'GET') {
            if (existsSync(filePath)) {
              try {
                const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
                json(res, 200, { ok: true, settings: parsed });
              } catch { json(res, 200, { ok: true, settings: null }); }
            } else {
              json(res, 200, { ok: true, settings: null });
            }
            return;
          }
          if (method === 'PUT' || method === 'POST') {
            let body = "";
            for await (const c of req) body += String(c);
            let settings = null;
            try { settings = JSON.parse(body || '{}'); } catch { json(res, 400, { ok: false, error: 'bad json' }); return; }
            if (!settings || typeof settings !== 'object') { json(res, 400, { ok: false, error: 'bad payload' }); return; }
            mkdirSync(DATA_DIR, { recursive: true });
            const tmp = filePath + '.tmp';
            writeFileSync(tmp, JSON.stringify(settings));
            renameSync(tmp, filePath);
            json(res, 200, { ok: true });
            return;
          }
          json(res, 405, { ok: false, error: 'method' });
        } catch (err) { json(res, 500, { ok: false, error: String(err && err.message || err) }); }
      },
    });

    // 流式接收 mpkg → 磁盘 → 返回条目索引（hybrid 大文件模式）
    webServer.register({
      kind: 'exact', path: BASE + '/upload',
      handler: async (req, res) => {
        try {
          const token = crypto.randomBytes(16).toString('hex');
          const dir = DATA_DIR;
          mkdirSync(dir, { recursive: true });
          const filePath = join(dir, token + '.mpkg');
          const out = createWriteStream(filePath);
          // ①(修正) 给写入流挂 error 监听：原无监听——写失败（磁盘满/权限 EACCES/
          // Windows 文件被占用/杀软锁文件）时 EventEmitter 直接 throw → uncaught
          // exception → 宿主进程崩溃（用户实测风险）。error 转成 reject → 被外层
          // catch 接住返回 500 而非崩宿主进程。
          let writeErr = null;
          out.on('error', (e) => { writeErr = e; });
          let head = Buffer.alloc(0);
          let size = 0;
          try {
            for await (const chunk of req) {
              size += chunk.length;
              if (head.length < HEAD_BYTES) head = Buffer.concat([head, chunk]);
              if (writeErr) throw writeErr;
              if (!out.write(chunk)) await new Promise((r) => { out.once('drain', r); if (writeErr) r(); });
            }
            await new Promise((r) => { out.on('error', r); out.on('finish', r); if (writeErr) r(); out.end(); });
            if (writeErr) throw writeErr;
          } catch (e) {
            try { out.destroy(); } catch {}
            // ①(修复) 失败/中断上传 → 删半成品文件（防孤儿累积）
            try { unlinkSync(filePath); } catch {}
            throw e;
          }
          const { dataStart, entries } = parseMpkgHead(head);
          files.set(token, { path: filePath, size, dataStart, entries });
          json(res, 200, { ok: true, token, size, entries });
        } catch (err) {
          json(res, 500, { ok: false, error: String(err && err.message || err) });
        }
      },
    });

    // Range 流式返回 mpkg 内某个条目（视频/图片直接播放）
    webServer.register({
      kind: 'exact', path: BASE + '/media',
      handler: (req, res) => {
        try {
          const url = new URL(req.url || '', 'http://localhost');
          const token = url.searchParams.get('token') || '';
          const idx = Number(url.searchParams.get('index'));
          let rec = files.get(token);
          // ①(修正) 重启竞态兜底：dsh 重启后浏览器可能先请求 /media 而 restoreFiles()
          // 尚未重建 Map（或该 token 恰好不在初始扫描结果里）→ 懒重扫一次再判 404，
          // 避免"重启后壁纸偶尔消失且不再恢复"。
          if (!rec) { restoreFiles(); rec = files.get(token); }
          // ①(修正) index 是**容器内偏移**（parseMpkgHead 的 index 字段），不是数组位置——
          // 之前 rec.entries[idx] 按位置取，偏移大的条目（如视频纹理偏移 1238524）必然 404
          // （用户实测 scene.pkg 走 mpkg 方式时 media 404）。先按 index 匹配，再按位置兜底。
          const entry = (rec && rec.entries ? rec.entries.find((x) => x.index === idx) || rec.entries[idx] : null);
          if (!rec || !entry) { json(res, 404, { ok: false, error: 'not found' }); return; }
          const st = statSync(rec.path);
          const off = Math.max(0, Number(url.searchParams.get('offset')) || 0);
          // ①(修复) offset>0（tex 内嵌 mp4 起始偏移）时，实际可读字节 = entry.size - off；
          // 之前 end/content-length 仍按整条 entry.size 计算 → 声明比发送多 → 浏览器媒体加载失败
          const seg = Math.max(0, entry.size - off);
          if (seg <= 0) { res.writeHead(416, { 'content-range': 'bytes */0' }); res.end(); return; }
          const start = rec.dataStart + entry.index + off;
          const end = start + seg - 1;
          const name = entry.name.toLowerCase();
          const mime = name.endsWith('.gif') ? 'image/gif'
            : name.endsWith('.png') ? 'image/png'
            : name.endsWith('.jpg') || name.endsWith('.jpeg') ? 'image/jpeg'
            : name.endsWith('.webp') ? 'image/webp'
            : name.endsWith('.mp4') ? 'video/mp4'
            : name.endsWith('.mp3') ? 'audio/mpeg'
            : name.endsWith('.ogg') || name.endsWith('.opus') ? 'audio/ogg'
            : name.endsWith('.wav') ? 'audio/wav'
            : name.endsWith('.flac') ? 'audio/flac'
            : name.endsWith('.webm') ? 'video/webm'
            : 'application/octet-stream';
          const range = req.headers.range;
          if (range) {
            const m = /bytes=(\d*)-(\d*)/.exec(range);
            const rs = m && m[1] ? parseInt(m[1], 10) : 0;
            const re = m && m[2] ? parseInt(m[2], 10) : seg - 1;
            const s = start + Math.max(0, rs);
            const e = start + Math.min(seg - 1, re);
            if (s > e) { res.writeHead(416, { 'content-range': `bytes */${seg}` }); res.end(); return; }
            res.writeHead(206, {
              'content-type': mime, 'accept-ranges': 'bytes',
              'content-range': `bytes ${s - start}-${e - start}/${seg}`,
              'content-length': e - s + 1,
            });
            serveStream(res, createReadStream(rec.path, { start: s, end: e }));
          } else {
            res.writeHead(200, { 'content-type': mime, 'accept-ranges': 'bytes', 'content-length': seg });
            serveStream(res, createReadStream(rec.path, { start, end }));
          }
        } catch (err) {
          json(res, 500, { ok: false, error: String(err && err.message || err) });
        }
      },
    });

    // ①(新) 检测更新：对比 GitHub 上 client.js + index.js 的内容哈希（README 变更不触发）
    webServer.register({
      kind: 'exact', path: BASE + '/update-check',
      handler: async (req, res) => {
        try {
          const local = codeHash();
          let remote = null, remoteVersion = null, releaseAt = null;
          try {
            const remoteClient = await fetchRaw('lib/client.js');
            const remoteIndex = await fetchRaw('lib/index.js');
            remote = crypto.createHash('sha1').update(remoteClient + remoteIndex).digest('hex').slice(0, 12);
            const pkg = JSON.parse(await fetchRaw('package.json'));
            remoteVersion = pkg.version;
            // ⑩(新) 最新 release 发布时间（用于"新版本刚发布可能有问题"提示）
            try {
              const rel = await fetch('https://api.github.com/repos/XHR666/dsh-mpkg-wallpaper/releases/latest');
              if (rel.ok) { const rj = await rel.json(); releaseAt = rj.published_at || null; }
            } catch { /* 忽略 */ }
          } catch { /* 网络失败 → remote 保持 null */ }
          const pkgLocal = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
          json(res, 200, { ok: true, local, localVersion: pkgLocal.version, remote, remoteVersion, releaseAt, hasUpdate: !!remoteVersion && semverGt(remoteVersion, pkgLocal.version), contentDiff: !!remote && remote !== local });
        } catch (err) { json(res, 500, { ok: false, error: String(err && err.message || err) }); }
      },
    });

    // ①(新) 热更新：从 GitHub 下载最新 lib/client.js + lib/index.js 写回本插件目录
    webServer.register({
      kind: 'exact', path: BASE + '/update-apply',
      handler: async (req, res) => {
        try {
          const dir = new URL('./', import.meta.url);
          // ①(修正) 市场安装（pnpm store/全局/容器）包目录只读 → 写回必失败（EACCES），
          // 且写回后 DSH 客户端 bundle 元数据不热更、npm 重装即还原——对市场用户无效甚至有害。
          // 写前探测可写性：失败直接返回明确提示，引导走 `dsh plugin update` / 插件市场，
          // 不再让用户看到笼统的 500「更新失败」。
          try {
            const probe = new URL('./.update-write-test', dir);
            writeFileSync(probe, 'ok', 'utf8');
            unlinkSync(probe);
          } catch (writeErr) {
            json(res, 200, { ok: false, readonly: true, error: String(writeErr && writeErr.code || 'EACCES') });
            return;
          }
          const client = await fetchRaw('lib/client.js');
          const index = await fetchRaw('lib/index.js');
          if (!client.includes('dsh-mpkg-wallpaper') || !index.includes('dsh-mpkg-wallpaper')) { json(res, 400, { ok: false, error: 'invalid payload' }); return; }
          // ①(修正) id 适配：仓库 client.js 注册 id=dsh-mpkg-wallpaper；本地 @local 安装
          // 时 cordis 以 @local/dsh-mpkg-wallpaper 引用，DSH 期望注册同名 id——直接覆盖
          // 会导致 loaded without registering → dsh 启动崩溃（用户实测：点"从本插件更新"
          // 后崩溃）。写回前按**当前 client.js 的 id** 调整（本地是 @local 就替换成 @local）。
          let clientOut = client;
          try {
            const curSrc = readFileSync(new URL('./client.js', dir), 'utf8');
            const curId = /id:\s*"([^"]+)"/.exec(curSrc);
            if (curId && curId[1] && curId[1] !== 'dsh-mpkg-wallpaper') {
              clientOut = clientOut.replace(/id:\s*"dsh-mpkg-wallpaper"/, 'id: "' + curId[1] + '"');
            }
          } catch { /* 读当前 id 失败则保持仓库 id */ }
          writeFileSync(new URL('./client.js', dir), clientOut, 'utf8');
          writeFileSync(new URL('./index.js', dir), index, 'utf8');
          // 同步更新 package.json 版本号（让"更新到 vX"名副其实）
          try {
            const pkg = await fetchRaw('package.json');
            const pj = JSON.parse(pkg);
            if (pj && pj.version) {
              const localPkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
              localPkg.version = pj.version;
              writeFileSync(new URL('../package.json', import.meta.url), JSON.stringify(localPkg, null, 2), 'utf8');
            }
          } catch { /* 版本号同步失败不阻塞更新 */ }
          json(res, 200, { ok: true });
        } catch (err) { json(res, 500, { ok: false, error: String(err && err.message || err) }); }
      },
    });

    // ①(新) 目录浏览：返回指定路径下的子目录列表（跨平台，供文件夹选择器逐级浏览）
    webServer.register({
      kind: 'exact', path: BASE + '/list-dirs',
      handler: (req, res) => {
        try {
          const url = new URL(req.url || '', 'http://localhost');
          const p = (url.searchParams.get('path') || '').trim();
          // ③(修正) 默认起始路径：Windows → C:\；其他平台 → 当前用户 HOME（proot 的 /root 等），
          // 而不是直接开根目录（用户反馈打开的是安卓根目录、看不到自己环境）。
          // ①(修正) 用 os.homedir() 兜底（Windows 无 process.env.HOME；os.homedir() 跨平台正确）。
          const home = os.homedir() || '/';
          const base = p || (process.platform === 'win32' ? 'C:\\' : home);
          if (!existsSync(base) || !statSync(base).isDirectory()) { json(res, 400, { ok: false, error: 'invalid dir' }); return; }
          const subdirs = readdirSync(base, { withFileTypes: true })
            .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
            .map((d) => d.name);
          json(res, 200, { ok: true, dir: base, subdirs, home, platform: process.platform });
        } catch (err) { json(res, 500, { ok: false, error: String(err && err.message || err) }); }
      },
    });

    // ①(新) 自定义本地壁纸目录：POST 设置并扫描目录内的媒体文件
    webServer.register({
      kind: 'exact', path: BASE + '/custom-dir',
      handler: async (req, res) => {
        try {
          let body = "";
          for await (const c of req) body += String(c);
          const dir = (JSON.parse(body || '{}').dir || '').trim();
          if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) { json(res, 400, { ok: false, error: 'invalid dir' }); return; }
          customDir = dir;
          persistCustomDir();
          const exts = ['.gif', '.png', '.jpg', '.jpeg', '.webp', '.mp4', '.webm', '.mov', '.mpkg'];
          // ①(安全) 只收图片/视频/mpkg；排除 exe/bat/sh/scr 等可执行与脚本（防病毒注入）
          const files = [];
          const pickPreview = (sub) => {
            try {
              const p = readdirSync(sub).find((f) => /^preview\.(gif|png|jpe?g|webp)$/i.test(f));
              return p || null;
            } catch { return null; }
          };
          // ①(新) workshop 原始目录识别：**按内容**判定 web/scene/video/unknown 四态。
          //   ①(2026-09-16 I 项) 判定收敛到 lib/web-wallpaper.js 的 detectWallpaperDir
          //   （project.json 的 general.type 只作线索，不作为依据）——
          //   修掉"声明 web 但目录里只有 scene.pkg"这类声明与内容不符的包被当成网页壁纸的情况。
          for (const e of readdirSync(dir, { withFileTypes: true })) {
            const f = e.name;
            if (e.isDirectory() && !f.startsWith('.')) {
              const sub = join(dir, f);
              const det = detectWallpaperDir(sub);
              const pj = det.project || {};
              const pjGeneral = (pj.general && typeof pj.general === 'object') ? pj.general : {};
              const title = pj.title || pjGeneral.title || null;
              let type = det.kind, media = det.entry;
              // ①(修正) 子文件夹里的 .mpkg（无 scene.pkg/scene.json/html/视频的纯 mpkg 收藏夹，
              // 如 wallpaperE 下的角色文件夹）→ 每个 mpkg 独立成条（folderMpkg）。
              // 判据与旧实现一致，但改成看**内容信号**：容器里有 scene.pkg/scene.json 才算场景。
              const realScene = /(^|\/)(scene\.pkg|scene\.json)$/i.test(det.signals.scene || '');
              if (det.mpkgs.length && !det.signals.html && !det.signals.video && !realScene) {
                for (const m of det.mpkgs) {
                  files.push({ name: f, title: m, type: 'mpkg', media: m, folder: true, folderMpkg: true, preview: null });
                }
                continue;
              }
              if (type && type !== 'unknown' && media) {
                // ①(新) 网页壁纸风险预检：Spine/L2D 骨骼动画（skel/atlas）→ 重动画
                // 可能卡顿；引用外网 http(s) → 依赖外网可能失败（用户实测：昔涟类
                // webm 视频壁纸正常，Spine 类卡死，米哈游 SDK 类加载失败）。
                let webHeavy = false, webExternal = false;
                if (type === 'web') {
                  try {
                    // ①(修正) 递归查找骨架动画文件（skel/atlas/spine 常在子目录）
                    const heavyNames = [];
                    const walkHeavy = (d2, depth) => {
                      if (depth > 3 || heavyNames.length) return;
                      let ents = [];
                      try { ents = readdirSync(d2, { withFileTypes: true }); } catch { return; }
                      for (const en of ents) {
                        if (en.isDirectory()) walkHeavy(join(d2, en.name), depth + 1);
                        else if (/\.(skel|atlas)$/i.test(en.name) || /spine|live2d|\.l2d/i.test(en.name)) { heavyNames.push(en.name); break; }
                      }
                    };
                    walkHeavy(sub, 0);
                    if (heavyNames.length) webHeavy = true;
                    const htmlFile = join(sub, media || 'index.html');
                    if (existsSync(htmlFile)) {
                      const htmlText = readFileSync(htmlFile, 'utf8').slice(0, 262144);
                      if (/https?:\/\//i.test(htmlText)) webExternal = true;
                    }
                  } catch { /* 预检失败不阻塞 */ }
                }
                const pv = pickPreview(sub);
                files.push({ name: f, title: title || f, type, media, preview: pv, folder: true, webHeavy, webExternal, kindReason: det.reason, declaredType: det.declared });
                continue;
              }
              continue;
            }
            if (exts.some((x) => f.toLowerCase().endsWith(x))) {
              files.push({ name: f, type: /\.(mp4|webm|mov)$/i.test(f) ? 'video' : /\.mpkg$/i.test(f) ? 'mpkg' : 'image' });
            }
          }
          json(res, 200, { ok: true, dir, files });
        } catch (err) { json(res, 500, { ok: false, error: String(err && err.message || err) }); }
      },
    });

    // ⑥(新) 自定义目录里的 .mpkg：解析容器，分配 token，选素材（preview / 独立 mp4）
    webServer.register({
      kind: 'exact', path: BASE + '/custom-mpkg',
      handler: (req, res) => {
        try {
          // ①(修正) 重启竞态兜底：懒恢复 customDir（防 404 壁纸消失）
          if (!customDir) restoreCustomDir();
          if (!customDir) { json(res, 404, { ok: false, error: 'no dir' }); return; }
          const url = new URL(req.url || '', 'http://localhost');
          const file = url.searchParams.get('file') || '';
          const folder = url.searchParams.get('folder') || '';
          if (!file || file.includes('..') || file.includes('/') || file.includes('\\') || (folder && (folder.includes('..') || folder.includes('/') || folder.includes('\\') || folder.startsWith('.')))) { json(res, 403, { ok: false, error: 'forbidden' }); return; }
          // ①(修正) folder= 支持子文件夹里的 .mpkg（wallpaperE 角色收藏夹）
          const filePath = folder ? join(customDir, folder, file) : join(customDir, file);
          // ①(修正) 允许 scene.pkg：workshop 原始目录里的 scene.pkg 与 mpkg 是同一 PKG 容器
          // 格式——时间变化壁纸可用 mpkg 方式解析（project.json 时间属性 + 视频纹理 → 自动切换）
          if (!existsSync(filePath) || !/\.(mpkg|pkg)$/i.test(file)) { json(res, 404, { ok: false, error: 'not found' }); return; }
          const head = readMpkgHead(filePath);
          const { dataStart, entries } = parseMpkgHead(head);
          // ①(修正) 用**文件名**作 token（稳定，重启后不变）：之前 crypto.randomBytes 每次
          // 生成随机 token，存进 localStorage 的 image=host:?token=<random> 在重启后会失效
          // （restoreFiles 用文件名作 token 重建 Map，random token 不存在 → media 404 →
          // 视频壁纸重启后空白/不保存——用户实测多轮）。文件名 token 与 restoreFiles 一致，
          // 重启后同名 token 自动匹配，壁纸自愈。
          const token = file.replace(/\.(mpkg|pkg)$/i, '');
          files.set(token, { path: filePath, size: statSync(filePath).size, dataStart, entries });
          // ④(修正) 选素材：preview 图片 > 独立 mp4 > 视频纹理 tex（含 ftyp）
          const vid = entries.findIndex((e) => /\.(mp4|webm|mov)$/i.test(e.name));
          const img = entries.findIndex((e) => /\.(gif|png|jpe?g|webp)$/i.test(e.name));
          let sel = vid >= 0 ? { index: vid, name: entries[vid].name, isMp4: true }
            : img >= 0 ? { index: img, name: entries[img].name, isMp4: false }
            : null;
          if (sel === null) {
            // ④(新) 场景壁纸（无 preview/mp4）→ 尝试视频纹理 tex（内嵌 mp4）
            // ①(修正) 用 readRange 只读单条 tex 的 64KB 起始段去 ftyp 扫描，
            //   不再 readFileSync 整文件（.subarray 是视图不省 IO，834MB 卡死/爆内存）。
            for (let i = 0; i < entries.length; i++) {
              const e = entries[i];
              if (!e.name.endsWith('.tex') || e.size < 1024 * 1024) continue;
              if (/蓝幕|绿幕|bluescreen|greenscreen|chroma|keying|抠像|入场|intro|entry/i.test(e.name)) continue;
              const off = dataStart + e.index;
              const seg = readRange(filePath, off, 65536);
              const p = seg.indexOf(Buffer.from('ftyp'));
              if (p >= 4) { sel = { index: i, name: e.name, isMp4: true, offset: p - 4 }; break; }
            }
          }
          if (sel === null) { json(res, 200, { ok: true, token, entries, selected: null }); return; }
          json(res, 200, { ok: true, token, entries, selected: sel });
        } catch (err) { json(res, 500, { ok: false, error: String(err && err.message || err) }); }
      },
    });

    // ①(新) 自定义目录 mpkg 的预览图（容器内 preview.jpg/gif/png）：扫描列表缩略图用
    webServer.register({
      kind: 'exact', path: BASE + '/custom-mpkg-preview',
      handler: (req, res) => {
        try {
          if (!customDir) restoreCustomDir();
          if (!customDir) { json(res, 404, { ok: false, error: 'no dir' }); return; }
          const url = new URL(req.url || '', 'http://localhost');
          const file = url.searchParams.get('file') || '';
          const folder = url.searchParams.get('folder') || '';
          if (!file || file.includes('..') || file.includes('/') || file.includes('\\') || (folder && (folder.includes('..') || folder.includes('/') || folder.includes('\\') || folder.startsWith('.')))) { json(res, 403, { ok: false, error: 'forbidden' }); return; }
          // ①(修正) folder= 支持子文件夹里的 .mpkg
          const filePath = folder ? join(customDir, folder, file) : join(customDir, file);
          if (!existsSync(filePath) || !file.toLowerCase().endsWith('.mpkg')) { json(res, 404, { ok: false, error: 'not found' }); return; }
          // ①(新) 缓存：mtime 未变 → 直接返回缓存 bytes（不再解析头部/打开大文件）
          const st = statSync(filePath);
          const cacheKey = (folder ? folder + '/' : '') + file;
          const cached = mpkgPreviewGet(cacheKey);
          if (cached && cached.mtimeMs === st.mtimeMs && cached.bytes) {
            res.writeHead(200, { 'content-type': cached.mime, 'content-length': cached.bytes.length, 'cache-control': 'no-cache' });
            res.end(cached.bytes);
            return;
          }
          const head = readMpkgHead(filePath);
          const { dataStart, entries } = parseMpkgHead(head);
          // 优先 preview.* 图片条目，其次任意图片条目（jpg/gif/png/webp）
          let img = entries.findIndex((e) => /preview.*\.(gif|png|jpe?g|webp)$/i.test(e.name));
          if (img < 0) img = entries.findIndex((e) => /\.(gif|png|jpe?g|webp)$/i.test(e.name));
          if (img < 0) { json(res, 404, { ok: false, error: 'no preview' }); return; }
          const e = entries[img];
          const mime = e.name.toLowerCase().endsWith('.gif') ? 'image/gif'
            : e.name.toLowerCase().endsWith('.png') ? 'image/png'
            : e.name.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg';
          // preview 一般较小（< 12MB），缓存 bytes 到内存，后续请求零磁盘 IO
          if (e.size <= 12 * 1024 * 1024) {
            const buf = Buffer.alloc(e.size);
            const fd = openSync(filePath, 'r');
            let off = dataStart + e.index, got = 0;
            try {
              while (got < e.size) {
                const n = readSync(fd, buf, got, e.size - got, off + got);
                if (n <= 0) break; got += n;
              }
            } finally { closeSync(fd); }
            mpkgPreviewSet(cacheKey, { mtimeMs: st.mtimeMs, mime, bytes: buf });
            res.writeHead(200, { 'content-type': mime, 'content-length': buf.length, 'cache-control': 'no-cache' });
            res.end(buf);
            return;
          }
          // 超大 preview：流式读（不缓存）
          res.writeHead(200, { 'content-type': mime, 'content-length': e.size, 'cache-control': 'no-cache' });
          serveStream(res, createReadStream(filePath, { start: dataStart + e.index, end: dataStart + e.index + e.size - 1 }));
        } catch (err) { json(res, 500, { ok: false, error: String(err && err.message || err) }); }
      },
    });

    // ①(新) 自定义目录媒体：按文件名读取（Range），校验文件在自定义目录内且无路径穿越
    webServer.register({
      kind: 'exact', path: BASE + '/custom-media',
      handler: (req, res) => {
        try {
          // ①(修正) 重启竞态兜底：懒恢复 customDir（防 404 壁纸消失）
          if (!customDir) restoreCustomDir();
          if (!customDir) { json(res, 404, { ok: false, error: 'no dir' }); return; }
          const url = new URL(req.url || '', 'http://localhost');
          const file = url.searchParams.get('file') || '';
          if (!file || file.includes('..') || file.includes('/') || file.includes('\\')) { json(res, 403, { ok: false, error: 'forbidden' }); return; }
          const filePath = join(customDir, file);
          if (!existsSync(filePath) || !statSync(filePath).isFile()) { json(res, 404, { ok: false, error: 'not found' }); return; }
          const st = statSync(filePath);
          const name = file.toLowerCase();
          const mime = name.endsWith('.mp4') ? 'video/mp4' : name.endsWith('.webm') ? 'video/webm'
            : name.endsWith('.mov') ? 'video/quicktime' : name.endsWith('.gif') ? 'image/gif'
            : name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp'
            : name.endsWith('.jpg') || name.endsWith('.jpeg') ? 'image/jpeg' : 'application/octet-stream';
          const range = req.headers.range;
          if (range) {
            const m = /bytes=(\d*)-(\d*)/.exec(range);
            const rs = m && m[1] ? parseInt(m[1], 10) : 0;
            const re = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
            const s = Math.max(0, rs); const e = Math.min(st.size - 1, re);
            if (s > e) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); res.end(); return; }
            res.writeHead(206, { 'content-type': mime, 'accept-ranges': 'bytes', 'content-range': `bytes ${s}-${e}/${st.size}`, 'content-length': e - s + 1 });
            serveStream(res, createReadStream(filePath, { start: s, end: e }));
          } else {
            res.writeHead(200, { 'content-type': mime, 'accept-ranges': 'bytes', 'content-length': st.size });
            serveStream(res, createReadStream(filePath));
          }
        } catch (err) { json(res, 500, { ok: false, error: String(err && err.message || err) }); }
      },
    });

    // ①(新) 自定义目录 workshop 子文件夹资源：按 folder（子目录名）+ file（子目录内相对路径，
    // 可含子目录）读取；resolve 后必须仍在子目录内（防 ../ 穿越）。网页壁纸 iframe 需要
    // html + 全部相对资源（js/css/图片/音频），视频/预览图也走这里。
    /** ①(2026-09-14 音频研究) 按文件**头部字节**纠正 MIME：web 分支的扩展名系统性说谎
     *  （实测 `.wav` 实为 MP3/Ogg）。只嗅探音频容器，命中即返回；否则回落扩展名判定。
     *  调用方只在“文件在本地磁盘上”的路由使用（readSync 前 16 字节，成本可忽略）。 */
    const AUDIO_MAGIC_MIME = (path, name) => {
      try {
        const fd = openSync(path, 'r');
        const buf = Buffer.alloc(16);
        const n = readSync(fd, buf, 0, 16, 0);
        closeSync(fd);
        if (n >= 12) {
          const hex = buf.toString('hex');
          if (buf.slice(0, 4).toString('latin1') === 'fLaC') return 'audio/flac';
          if (buf.slice(0, 4).toString('latin1') === 'OggS') return 'audio/ogg';
          if (buf.slice(0, 3).toString('latin1') === 'ID3') return 'audio/mpeg';
          if (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0) return 'audio/mpeg';
          if (hex.startsWith('52494646') && hex.slice(16, 24) === '57415645') return 'audio/wav';
          if (hex.startsWith('66427970')) return 'audio/mp4'; // ftyp（m4a/aac）
        }
      } catch { /* 嗅探失败一律回落扩展名 */ }
      return FOLDER_MIME(name);
    };
    const FOLDER_MIME = (name) => {
      const n = name.toLowerCase();
      if (n.endsWith('.html') || n.endsWith('.htm')) return 'text/html; charset=utf-8';
      if (n.endsWith('.js') || n.endsWith('.mjs')) return 'text/javascript; charset=utf-8';
      if (n.endsWith('.css')) return 'text/css; charset=utf-8';
      if (n.endsWith('.json')) return 'application/json';
      if (n.endsWith('.mp4')) return 'video/mp4';
      if (n.endsWith('.webm')) return 'video/webm';
      if (n.endsWith('.mov')) return 'video/quicktime';
      if (n.endsWith('.mp3')) return 'audio/mpeg';
      if (n.endsWith('.ogg') || n.endsWith('.oga') || n.endsWith('.opus')) return 'audio/ogg';
      if (n.endsWith('.wav')) return 'audio/wav';
      // ①(2026-09-14 音频研究) 语料里有公开包用 FLAC（`sounds/*.flac`），第三方参考实现 wer-ref（不可借，仅行为对照）只实现 mp3/wav/ogg，
      //   但浏览器原生支持 → 这里补上；`.m4a/.aac` 同理。
      if (n.endsWith('.flac')) return 'audio/flac';
      if (n.endsWith('.m4a') || n.endsWith('.aac')) return 'audio/mp4';
      if (n.endsWith('.gif')) return 'image/gif';
      if (n.endsWith('.png')) return 'image/png';
      if (n.endsWith('.webp')) return 'image/webp';
      if (n.endsWith('.svg')) return 'image/svg+xml';
      if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
      if (n.endsWith('.ttf')) return 'font/ttf';
      if (n.endsWith('.woff')) return 'font/woff';
      if (n.endsWith('.woff2')) return 'font/woff2';
      if (n.endsWith('.ico')) return 'image/x-icon';
      return 'application/octet-stream';
    };
    const serveRange = (req, res, filePath, mime, extraHeaders) => {
      const st = statSync(filePath);
      const extra = extraHeaders && typeof extraHeaders === 'object' ? extraHeaders : null;
      const r = req.headers.range;
      if (r) {
        const m = /bytes=(\d*)-(\d*)/.exec(r);
        const rs = m && m[1] ? parseInt(m[1], 10) : 0;
        const re = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
        const s = Math.max(0, rs); const e = Math.min(st.size - 1, re);
        if (s > e) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); res.end(); return; }
        res.writeHead(206, Object.assign({ 'content-type': mime, 'accept-ranges': 'bytes', 'content-range': `bytes ${s}-${e}/${st.size}`, 'content-length': e - s + 1 }, extra || {}));
        serveStream(res, createReadStream(filePath, { start: s, end: e }));
      } else {
        res.writeHead(200, Object.assign({ 'content-type': mime, 'accept-ranges': 'bytes', 'content-length': st.size }, extra || {}));
        serveStream(res, createReadStream(filePath));
      }
    };
    // ①(新 2026-09-16 I 项) 网页壁纸资源：**入口 HTML 注入 WE API shim**，其余文件原样流式返回。
    //   · 只在 `?mpwshim=1` 的入口请求上注入（旧 URL 无标记 → 一个字节都不变，零回归）；
    //   · 注入体是 `<head>` 最前的 classic script，**排在作者脚本之前**（见 web-wallpaper.js）；
    //   · 沙箱 iframe 是不透明源 → 帧内 `fetch()` 是跨源请求，故对 `Origin: null` 回 ACAO（见 webAssetCorsHeaders）；
    //   · 超大 HTML（>8MB）不注入，直接原样返回（避免把大文件读进内存；这类入口极罕见）。
    const WEB_INJECT_MAX_BYTES = 8 * 1024 * 1024;
    const isHtmlName = (name) => /\.(x?html?)$/i.test(String(name || ''));
    const serveWebAsset = (req, res, baseDir, relFile, label) => {
      try {
        const base = resolve(baseDir);
        const target = resolve(join(base, relFile));
        if (target !== base && !target.startsWith(base + sep)) { json(res, 403, { ok: false, error: 'forbidden' }); return; }
        // ①(新 2026-09-16 I 项) 虚拟清单：`__mpw-list.json` = 该壁纸目录内的媒体文件表。
        //   用途：网页壁纸的 slideshow 属性（wallpaperRequestRandomFileForProperty）需要一个文件池，
        //   而插件没有"用户为该属性选目录"的交互 → 退化用壁纸自有目录（见 docs/WEB-WALLPAPER.md 已知限制）。
        if (relFile === '__mpw-list.json') {
          const list = listWallpaperFiles(base).filter((f) => /\.(png|jpe?g|gif|webp|bmp|mp4|webm)$/i.test(f)).slice(0, 2000);
          const body = Buffer.from(JSON.stringify({ ok: true, dir: label || '', files: list }), 'utf8');
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache', 'content-length': body.length });
          res.end(body);
          return;
        }
        if (!existsSync(target) || !statSync(target).isFile()) { json(res, 404, { ok: false, error: 'not found' }); return; }
        const cors = webAssetCorsHeaders(req.headers.origin) || undefined;
        if (isHtmlName(relFile) && isShimRequest(req.url)) {
          const st = statSync(target);
          if (st.size > WEB_INJECT_MAX_BYTES) {
            serveRange(req, res, target, 'text/html; charset=utf-8', cors);
            return;
          }
          const policy = webPolicyFromQuery(req.url) || { muted: true, speed: 1, paused: false };
          const out = rewriteWebEntryHtml(readFileSync(target, 'utf8'), {
            seedScript: buildSeedScript(policy, relFile),
          });
          const body = Buffer.from(out, 'utf8');
          res.writeHead(200, Object.assign({ 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache', 'content-length': body.length }, cors || {}));
          res.end(body);
          return;
        }
        serveRange(req, res, target, AUDIO_MAGIC_MIME(target, relFile), cors);
      } catch (err) {
        // 注入失败不能让壁纸白屏：记日志并回退「原样返回」
        try { console.warn('[dsh-mpkg-wallpaper] 网页壁纸注入失败(' + (label || '') + '):', err && err.message); } catch { /* 忽略 */ }
        try {
          const fallback = resolve(join(resolve(baseDir), relFile));
          serveRange(req, res, fallback, AUDIO_MAGIC_MIME(fallback, relFile));
        } catch { json(res, 500, { ok: false, error: 'inject failed' }); }
      }
    };
    // ①(新) 自定义目录 workshop 子文件夹资源：**prefix 路由 + path 式 URL**
    // （/custom-folder/<folder>/<rest…>）。网页壁纸 iframe 的相对资源（./assets/x.js）
    // 必须按路径解析——query 式（?folder=&file=）会让相对路径错位。保留 query 兼容
    // （旧版本地保存的标记）。resolve 后必须仍在子目录内（防 ../ 穿越）。
    const parseFolderPath = (req, prefix) => {
      const url = new URL(req.url || '', 'http://localhost');
      const pathname = (() => { try { return decodeURIComponent(url.pathname); } catch { return url.pathname; } })();
      const rest = pathname.startsWith(prefix + '/') ? pathname.slice(prefix.length + 1) : '';
      if (rest && rest.includes('/')) {
        const segs = rest.split('/');
        const head = segs.shift() || '';
        return { head, file: segs.join('/'), url };
      }
      // query 兼容（旧标记）
      return { head: url.searchParams.get('folder') || url.searchParams.get('ltoken') || '', file: url.searchParams.get('file') || '', url };
    };
    webServer.register({
      kind: 'prefix', path: BASE + '/custom-folder',
      handler: (req, res) => {
        try {
          if (!customDir) restoreCustomDir();
          if (!customDir) { json(res, 404, { ok: false, error: 'no dir' }); return; }
          const { head: folder, file } = parseFolderPath(req, BASE + '/custom-folder');
          if (!folder || !file || folder.includes('..') || folder.includes('/') || folder.includes('\\') || folder.startsWith('.')) { json(res, 403, { ok: false, error: 'forbidden' }); return; }
          // ①(2026-09-16 I 项) 统一走 serveWebAsset：入口 HTML 注入 WE shim（?mpwshim=1），其余原样
          serveWebAsset(req, res, join(customDir, folder), file, 'custom');
        } catch (err) { json(res, 500, { ok: false, error: String(err && err.message || err) }); }
      },
    });

    // ①(新) 本地壁纸库目录内任意资源（网页壁纸 iframe 的 html + 相对资源、场景预览图）：
    // prefix 路由 /library-web/<ltoken>/<rest…>；query 兼容旧标记。
    webServer.register({
      kind: 'prefix', path: BASE + '/library-web',
      handler: (req, res) => {
        try {
          const { head: lt, file } = parseFolderPath(req, BASE + '/library-web');
          const rec = library.get(lt);
          if (!rec || !rec.dir || !file || file.includes('..') || file.startsWith('/') || file.includes('\\')) { json(res, 403, { ok: false, error: 'forbidden' }); return; }
          // ①(2026-09-16 I 项) 同上：入口 HTML 注入 WE shim（?mpwshim=1）
          serveWebAsset(req, res, rec.dir, file, 'library');
        } catch (err) { json(res, 500, { ok: false, error: String(err && err.message || err) }); }
      },
    });

    // ①(新) 场景静态帧：解析 scene.pkg / 松散 scene 目录 → 提取主纹理（高清静态图）；
    // 提取失败（纯 shader 类/无主纹理）→ 回退目录内预览图。响应图 + 缓存。
    const serveSceneFrame = (req, res, dir, fallbackPreview) => {
      try {
        const frame = extractSceneFrame(dir);
        if (frame) {
          res.writeHead(200, { 'content-type': frame.mime, 'content-length': frame.bytes.length, 'cache-control': 'no-cache' });
          res.end(frame.bytes);
          return;
        }
        // 回退预览图
        const pv = previewFileIn(dir) || fallbackPreview;
        if (pv && existsSync(pv)) {
          const name = pv.toLowerCase();
          const mime = name.endsWith('.gif') ? 'image/gif' : name.endsWith('.png') ? 'image/png'
            : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
          const st = statSync(pv);
          res.writeHead(200, { 'content-type': mime, 'content-length': st.size, 'cache-control': 'no-cache' });
          serveStream(res, createReadStream(pv));
          return;
        }
        json(res, 404, { ok: false, error: 'no frame' });
      } catch (err) { json(res, 500, { ok: false, error: String(err && err.message || err) }); }
    };
    webServer.register({
      // ═══ ①(RE-25 场景集成 2026-09-12) /raw：把"整份容器文件"按字节流出去 ═══
      //   供本机 WebGL 渲染器（:8899）通过 /pkgurl 代理拉取 → 用户本地 .mpkg / scene.pkg 也能实时渲染。
      //   参数：custom?folder=&file=  或  library?ltoken=&file=（都在白名单目录内，禁目录穿越）
      kind: 'exact', path: BASE + '/raw',
      handler: (req, res) => {
        try {
          const url = new URL(req.url || '', 'http://localhost');
          const file = url.searchParams.get('file') || '';
          const folder = url.searchParams.get('folder') || '';
          const ltoken = url.searchParams.get('ltoken') || '';
          const bad = (v) => !v || v.includes('..') || v.includes('/') || v.includes('\\') || v.startsWith('.');
          if (bad(file) || (folder && bad(folder))) { json(res, 403, { ok: false, error: 'forbidden' }); return }
          // ①(B6 沙箱) 不透明源（strict 沙箱 iframe）必须带场景 token，且只能取**它自己那一个场景**；
          //   非 "null" 来源（旧插件 iframe / 插件 UI 同源）不受影响 —— 零回归。
          if (isOpaqueOrigin(req)) {
            const ident = ltoken ? ('library|' + ltoken + '|' + file) : ('custom|' + folder + '|' + file);
            if (!sandboxTokenCheck(ident, url.searchParams.get('st'))) { sandboxDeny(res, 'raw'); return }
          }
          let filePath = null;
          if (ltoken) {
            const rec = library.get(ltoken);
            if (rec && rec.dir) filePath = join(rec.dir, file);
          } else {
            if (!customDir) restoreCustomDir();
            if (!customDir) { json(res, 404, { ok: false, error: 'no dir' }); return }
            filePath = folder ? join(customDir, folder, file) : join(customDir, file);
          }
          if (!filePath || !existsSync(filePath)) { json(res, 404, { ok: false, error: 'not found' }); return }
          const st = statSync(filePath);
          const mime = /\.mpkg$/i.test(file) || /\.pkg$/i.test(file) ? 'application/octet-stream'
            : /\.json$/i.test(file) ? 'application/json' : 'application/octet-stream';
          // ①(RE-25) 渲染器(:8899) iframe 需**带凭据**直连本路由（DSH 宿主鉴权基于 cookie，cookie 不区分端口）
          //   → CORS 回显 Origin 并允许 credentials（用 * 会被浏览器拒绝带凭据请求）。
          const origin = (req.headers && req.headers.origin) || '*';
          // ①(2026-09-15 用户第 1 条反馈：音频扫描提速) **本路由此前不支持 Range**：永远 200 + 整包。
          //   后果：渲染器想"只取容器目录表"（索引在文件开头，音频清单只要它 + 候选条目各 16 字节）
          //   也拿不到，只能整包下载（hina 22.5MB / 夜莺 235MB / 大包 320MB 同理）→ 音频列表
          //   被排在整包传输 + 纹理加载之后，用户体感"要过两三秒才扫出来"。
          //   现在与 /media、/custom-scene-video 同口径：accept-ranges + 206 + 416。
          //   CORS 还必须 expose content-range/accept-ranges，否则跨源 JS 读不到（Range 是
          //   非 safelist 请求头 → 浏览器会先发 OPTIONS，故这里也处理预检）。
          const cors = {
            'access-control-allow-origin': origin,
            'access-control-allow-credentials': 'true',
            'access-control-allow-methods': 'GET, OPTIONS',
            'access-control-allow-headers': 'Range',
            'access-control-expose-headers': 'content-range, accept-ranges, content-length',
            vary: 'Origin',
          };
          if (String(req.method || 'GET').toUpperCase() === 'OPTIONS') { res.writeHead(204, cors); res.end(); return }
          const range = req.headers && req.headers.range;
          if (range) {
            const m = /bytes=(\d*)-(\d*)/.exec(range);
            const rs = m && m[1] ? parseInt(m[1], 10) : 0;
            const re = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
            const s = Math.max(0, rs); const e = Math.min(st.size - 1, re);
            if (s > e) { res.writeHead(416, Object.assign({ 'content-range': `bytes */${st.size}` }, cors)); res.end(); return }
            res.writeHead(206, Object.assign({
              'content-type': mime, 'accept-ranges': 'bytes', 'cache-control': 'no-cache',
              'content-range': `bytes ${s}-${e}/${st.size}`, 'content-length': e - s + 1,
            }, cors));
            serveStream(res, createReadStream(filePath, { start: s, end: e }));
            return;
          }
          res.writeHead(200, Object.assign({
            'content-type': mime, 'accept-ranges': 'bytes', 'content-length': st.size, 'cache-control': 'no-cache',
          }, cors));
          serveStream(res, createReadStream(filePath));
        } catch (err) { json(res, 500, { ok: false, error: String(err && err.message || err) }) }
      },
    });
    // ①(2026-09-15 用户第 1 条反馈「扫描音频的速度能否快些」) 场景音频探测：
    //   **先问清单，再取字节**（与 /custom-scene-video-check 同一惯例）。只读 scene.pkg 的
    //   目录表 + 仅候选音频条目各 16 字节魔数 → 0.1MB 级 IO 给出完整音轨清单（path/size/mime/refs），
    //   不必等整包（22.5MB–320MB）流完，也不解压任何条目；同 mtime+size 第二次是进程内缓存命中。
    //   lib/pkg-extract.js: scanSceneAudio（松散目录走目录遍历口径）。
    const corsFor = (req) => {
      const origin = (req.headers && req.headers.origin) || '*';
      return {
        'access-control-allow-origin': origin,
        'access-control-allow-credentials': 'true',
        'access-control-allow-methods': 'GET, OPTIONS',
        'access-control-allow-headers': 'Range',
        vary: 'Origin',
      };
    };
    const serveSceneAudio = (req, res, dir) => {
      try {
        const url = new URL(req.url || '', 'http://localhost');
        const withRefs = url.searchParams.get('refs') !== '0';
        const t0 = Date.now();
        const out = scanSceneAudio(dir, { withRefs });
        const body = {
          ok: true, source: out.source, count: out.tracks.length, tracks: out.tracks,
          stats: { ms: Date.now() - t0, indexEntries: out.indexEntries, headReads: out.headReads,
            bytesRead: out.bytesRead, cacheHit: !!out.cacheHit },
        };
        const payload = Buffer.from(JSON.stringify(body));
        res.writeHead(200, Object.assign({ 'content-type': 'application/json', 'content-length': payload.length, 'cache-control': 'no-cache' }, corsFor(req)));
        res.end(payload);
      } catch (err) { json(res, 500, { ok: false, error: String(err && err.message || err) }) }
    };
    webServer.register({
      kind: 'exact', path: BASE + '/custom-scene-audio',
      handler: (req, res) => {
        try {
          if (!customDir) restoreCustomDir();
          if (!customDir) { json(res, 404, { ok: false, error: 'no dir' }); return }
          const url = new URL(req.url || '', 'http://localhost');
          const folder = url.searchParams.get('folder') || '';
          // 与 /custom-scene-video 同口径：必须给 folder（不给就等于对整个自定义目录做遍历扫描，
          // 既慢又没意义——"某个场景的音频"永远指一个具体子目录）。
          if (!folder || folder.includes('..') || folder.includes('/') || folder.includes('\\') || folder.startsWith('.')) {
            json(res, 403, { ok: false, error: 'forbidden' }); return;
          }
          serveSceneAudio(req, res, resolve(join(customDir, folder)));
        } catch (err) { json(res, 500, { ok: false, error: String(err && err.message || err) }) }
      },
    });
    webServer.register({
      kind: 'exact', path: BASE + '/library-scene-audio',
      handler: (req, res) => {
        try {
          const url = new URL(req.url || '', 'http://localhost');
          const lt = url.searchParams.get('ltoken') || '';
          const rec = library.get(lt);
          if (!rec || !rec.dir) { json(res, 404, { ok: false, error: 'not found' }); return }
          serveSceneAudio(req, res, resolve(rec.dir));
        } catch (err) { json(res, 500, { ok: false, error: String(err && err.message || err) }) }
      },
    });
    webServer.register({
      kind: 'exact', path: BASE + '/custom-scene-frame',
      handler: (req, res) => {
        try {
          if (!customDir) restoreCustomDir();
          if (!customDir) { json(res, 404, { ok: false, error: 'no dir' }); return; }
          const url = new URL(req.url || '', 'http://localhost');
          const folder = url.searchParams.get('folder') || '';
          if (!folder || folder.includes('..') || folder.includes('/') || folder.includes('\\') || folder.startsWith('.')) { json(res, 403, { ok: false, error: 'forbidden' }); return; }
          serveSceneFrame(req, res, resolve(join(customDir, folder)), null);
        } catch (err) { json(res, 500, { ok: false, error: String(err && err.message || err) }); }
      },
    });
    webServer.register({
      kind: 'exact', path: BASE + '/library-scene-frame',
      handler: (req, res) => {
        try {
          const url = new URL(req.url || '', 'http://localhost');
          const lt = url.searchParams.get('ltoken') || '';
          const rec = library.get(lt);
          if (!rec || !rec.dir) { json(res, 404, { ok: false, error: 'not found' }); return; }
          serveSceneFrame(req, res, resolve(rec.dir), rec.preview || null);
        } catch (err) { json(res, 500, { ok: false, error: String(err && err.message || err) }); }
      },
    });

    // ①(新) scene 内嵌视频（scene-video 快路径）：Range 播放 scene.pkg/松散目录里
    // 作者内嵌的动画 MP4（<video> 硬件解码最顺滑——参考 elysia395 实证：CPU 逐帧
    // 渲染慢、浏览器 WebGL context 实时渲染会冻结页面）。无内嵌视频 → 404，
    // 客户端回退静态帧。参数与 scene-frame 一致：custom?folder= / library?ltoken=
    const serveSceneVideo = (req, res, dir) => {
      try {
        const v = ensureSceneVideo(dir);
        if (!v) { json(res, 404, { ok: false, error: 'no scene video' }); return; }
        const st = statSync(v.path);
        const r = req.headers.range;
        if (r) {
          const m = /bytes=(\d*)-(\d*)/.exec(r);
          const rs = m && m[1] ? parseInt(m[1], 10) : 0;
          const re = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
          const s = Math.max(0, rs); const e = Math.min(st.size - 1, re);
          if (s > e) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); res.end(); return; }
          res.writeHead(206, { 'content-type': v.mime, 'accept-ranges': 'bytes', 'content-range': `bytes ${s}-${e}/${st.size}`, 'content-length': e - s + 1, 'cache-control': 'no-cache' });
          serveStream(res, createReadStream(v.path, { start: s, end: e }));
        } else {
          res.writeHead(200, { 'content-type': v.mime, 'accept-ranges': 'bytes', 'content-length': st.size, 'cache-control': 'no-cache' });
          serveStream(res, createReadStream(v.path));
        }
      } catch (err) { json(res, 500, { ok: false, error: String(err && err.message || err) }); }
    };
    webServer.register({
      kind: 'exact', path: BASE + '/custom-scene-video',
      handler: (req, res) => {
        try {
          if (!customDir) restoreCustomDir();
          if (!customDir) { json(res, 404, { ok: false, error: 'no dir' }); return; }
          const url = new URL(req.url || '', 'http://localhost');
          const folder = url.searchParams.get('folder') || '';
          if (!folder || folder.includes('..') || folder.includes('/') || folder.includes('\\') || folder.startsWith('.')) { json(res, 403, { ok: false, error: 'forbidden' }); return; }
          serveSceneVideo(req, res, resolve(join(customDir, folder)));
        } catch (err) { json(res, 500, { ok: false, error: String(err && err.message || err) }); }
      },
    });
    webServer.register({
      kind: 'exact', path: BASE + '/library-scene-video',
      handler: (req, res) => {
        try {
          const url = new URL(req.url || '', 'http://localhost');
          const lt = url.searchParams.get('ltoken') || '';
          const rec = library.get(lt);
          if (!rec || !rec.dir) { json(res, 404, { ok: false, error: 'not found' }); return; }
          serveSceneVideo(req, res, resolve(rec.dir));
        } catch (err) { json(res, 500, { ok: false, error: String(err && err.message || err) }); }
      },
    });
    // ①(新) scene 内嵌视频探测：{ ok, has, mime, size }（不传视频体，客户端选场景时先问一次）
    const probeSceneVideo = (req, res, dir) => {
      const t0 = Date.now();
      try {
        const v = ensureSceneVideo(dir);
        const ms = Date.now() - t0;
        if (ms > 500) {
          try { console.log('[dsh-mpkg-wallpaper][perf] scene 视频探测耗时 ' + ms + 'ms:', dir); } catch {}
        }
        if (!v) { json(res, 200, { ok: true, has: false }); return; }
        json(res, 200, { ok: true, has: true, mime: v.mime, size: v.size });
      } catch (err) { json(res, 500, { ok: false, error: String(err && err.message || err) }); }
    };
    webServer.register({
      kind: 'exact', path: BASE + '/custom-scene-video-check',
      handler: (req, res) => {
        try {
          if (!customDir) restoreCustomDir();
          if (!customDir) { json(res, 404, { ok: false, error: 'no dir' }); return; }
          const url = new URL(req.url || '', 'http://localhost');
          const folder = url.searchParams.get('folder') || '';
          if (!folder || folder.includes('..') || folder.includes('/') || folder.includes('\\') || folder.startsWith('.')) { json(res, 403, { ok: false, error: 'forbidden' }); return; }
          probeSceneVideo(req, res, resolve(join(customDir, folder)));
        } catch (err) { json(res, 500, { ok: false, error: String(err && err.message || err) }); }
      },
    });
    webServer.register({
      kind: 'exact', path: BASE + '/library-scene-video-check',
      handler: (req, res) => {
        try {
          const url = new URL(req.url || '', 'http://localhost');
          const lt = url.searchParams.get('ltoken') || '';
          const rec = library.get(lt);
          if (!rec || !rec.dir) { json(res, 404, { ok: false, error: 'not found' }); return; }
          probeSceneVideo(req, res, resolve(rec.dir));
        } catch (err) { json(res, 500, { ok: false, error: String(err && err.message || err) }); }
      },
    });

    // ═══ ①(B6 沙箱 / 场景级短期 token 2026-09-13) 契约：we-scene-demo/RENDERER-SANDBOX-CONTRACT.md ═══
    //   背景：壁纸 iframe 里的第三方场景脚本与渲染器同域 → 过去能带着 DSH 会话 cookie 调宿主路由
    //   （读**任意** custom 目录的 /raw、盲写缩略图上报）。B6 让 iframe 变不透明源（插件侧去掉
    //   allow-same-origin），于是它的跨源请求带 `Origin: null`、不带凭据，宿主需要显式授权：
    //   签发**场景级 30 分钟** token，渲染器只用它访问自己那一个场景的 /raw 与缩略图上报。
    //   统一规则：`Origin: null`（= 不透明源）时**必须**带合法 token 且 identity 匹配，否则 403；
    //   其它来源（旧插件 iframe / 同源插件 UI）行为**完全不变** —— 老版本零回归。
    //   为什么 token 走 query/body 而不是请求头：自定义头会触发 CORS 预检，而预检不带 cookie，
    //   会被 DSH 鉴权墙 401 掉（宿主路由无法自行回答预检）→ 必须保持"简单请求"。
    const SANDBOX_TOKEN_TTL_MS = 30 * 60 * 1000;
    const SANDBOX_TOKEN_SECRET = crypto.randomBytes(32); // 宿主每次启动随机 → 重启即全部作废
    const sandboxTokenSign = (scene, exp) => crypto.createHmac('sha256', SANDBOX_TOKEN_SECRET).update(String(scene) + '|' + exp).digest('base64url');
    const sandboxTokenMint = (scene) => { const exp = Date.now() + SANDBOX_TOKEN_TTL_MS; return { token: sandboxTokenSign(scene, exp) + '.' + exp, exp: Math.floor(exp / 1000) } };
    const sandboxTokenCheck = (scene, tok) => {
      try {
        const s = String(tok || ''); const i = s.lastIndexOf('.');
        if (i <= 0 || !scene) return false;
        const sig = s.slice(0, i), exp = Number(s.slice(i + 1));
        if (!exp || exp < Date.now()) return false;
        const want = sandboxTokenSign(scene, exp);
        return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
      } catch { return false }
    };
    const isOpaqueOrigin = (req) => String((req.headers && req.headers.origin) || '') === 'null';
    const sandboxDeny = (res, why) => json(res, 403, { ok: false, error: 'scene token required', why });
    webServer.register({
      kind: 'exact', path: BASE + '/scene-thumb-token',
      handler: (req, res) => {
        try {
          const scene = new URL(req.url || '', 'http://localhost').searchParams.get('scene') || '';
          if (!scene || scene.length > 300) { json(res, 400, { ok: false, error: 'bad scene' }); return }
          const t = sandboxTokenMint(scene);
          json(res, 200, { ok: true, token: t.token, exp: t.exp, ttl: SANDBOX_TOKEN_TTL_MS / 1000, scene });
        } catch (err) { json(res, 500, { ok: false, error: String(err && err.message || err) }) }
      },
    });

    // ═══ ①(MERGED-3 1.1 场景壁纸缩略图=渲染器首帧 2026-09-14) ═══
    // 链路：渲染器 demo.html 首帧成功 → POST /custom-scene-thumb（含帧 jpeg dataURL + 场景身份）
    //       → 宿主按身份哈希落盘 thumbs/<hash>.jpg（LRU：200 张 / 64MB，按"最后使用"逐出）。
    // 列表 GET：缓存命中 → 直接回缓存帧（渲染器离线也有图，x-mpw-thumb-src: cache）；
    //           未命中 → 回退现状链 extractSceneFrame（frame）/ 预览图（preview）→ 404。
    // 身份：custom|<folder>|<file>（缺省 scene.pkg） / library|<ltoken>|<file>；sha256 前 16 hex。
    //       POST 侧 pkgurl（/raw?custom=1&folder=&file= 或 ?ltoken=&file=）会解析出同一身份。
    const THUMB_DIR = join(os.homedir(), '.dsh', '.dsh-mpkg-wallpaper', 'thumbs');
    const THUMB_MAX_FILES = 200;
    const THUMB_MAX_BYTES = 64 * 1024 * 1024; // 64MB
    const THUMB_BODY_MAX = 3 * 1024 * 1024;   // 480×270 jpeg q0.8 约 20-60KB，3MB 上限防滥用
    const sceneThumbIdentity = (sp) => {
      // sp: URLSearchParams（folder/file/ltoken 或 pkgurl=整条 /raw 地址）
      let folder = sp.get('folder') || '', ltoken = sp.get('ltoken') || '', file = sp.get('file') || '';
      const pkgUrl = sp.get('pkgurl') || '';
      if ((!folder && !ltoken) && pkgUrl) {
        try {
          const pu = new URL(pkgUrl, 'http://localhost');
          folder = pu.searchParams.get('folder') || '';
          ltoken = pu.searchParams.get('ltoken') || '';
          file = pu.searchParams.get('file') || '';
        } catch { /* 忽略，按无身份处理 */ }
      }
      const bad = (v) => !v || v.includes('..') || v.includes('/') || v.includes('\\') || v.startsWith('.');
      if (file && bad(file)) return null;
      if (ltoken) { if (bad(ltoken)) return null; return 'library|' + ltoken + '|' + (file || 'scene.pkg'); }
      if (folder) { if (bad(folder)) return null; return 'custom|' + folder + '|' + (file || 'scene.pkg'); }
      return null;
    };
    const sceneThumbHash = (identity) => crypto.createHash('sha256').update(String(identity)).digest('hex').slice(0, 16) + '.jpg';
    // ①(批次15 B1) 首帧看门狗信标：渲染器 POST 缩略图成功时记下时刻（内存表；dsh 重启清零，
    //   最坏情况=看门狗把"重启前已渲染"的场景误兜底一次，随后渲染器再 POST 即自愈——可接受）。
    const __mpwSceneThumbMeta = new Map(); // identity → { lastPostAt, bytes }
    // ①(批次15 B1) lastpost=1 查询（客户端看门狗信标）：返回 JSON {identity,lastPostAt,pkgBytes}
    //   而非缩略图本体的字节（注意：POST body 是 dataURL，解析后此处才有身份）。pkgBytes=scene.pkg
    //   体积（stat，廉价）供 B5②"大场景包提示"；文件不存在（例如删除后）不阻塞信标语义。
    const sceneThumbBeaconJson = (res, identity, dirForStat, fileForStat) => {
      try {
        const meta = __mpwSceneThumbMeta.get(identity) || null;
        let pkgBytes = null;
        try { pkgBytes = statSync(resolve(join(dirForStat, fileForStat))).size; } catch {}
        // 看门狗信标是同源 fetch（DSH 页面 → 宿主路由），无需 CORS 头
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ ok: true, identity, lastPostAt: meta ? meta.lastPostAt : 0, pkgBytes }));
      } catch (err) { try { json(res, 500, { ok: false, error: String(err && err.message || err) }); } catch {} }
    };
    const sceneThumbPrune = () => {
      // 简单 LRU：mtime = 最后使用（GET 命中会 touch）；超 200 张或 64MB 从最旧逐出
      try {
        if (!existsSync(THUMB_DIR)) return;
        let entries = readdirSync(THUMB_DIR).filter((f) => /\.jpg$/i.test(f)).map((f) => {
          const fp = join(THUMB_DIR, f);
          try { return { fp, m: statSync(fp).mtimeMs, size: statSync(fp).size }; } catch { return null; }
        }).filter(Boolean);
        let total = entries.reduce((a, e) => a + e.size, 0);
        entries.sort((a, b) => a.m - b.m);
        while (entries.length > THUMB_MAX_FILES || total > THUMB_MAX_BYTES) {
          const victim = entries.shift();
          if (!victim) break;
          try { unlinkSync(victim.fp); total -= victim.size; } catch { /* 已被并发删除 */ }
        }
      } catch { /* 缩略图是尽力而为，失败不影响主链 */ }
    };
    const serveSceneThumb = (req, res, dir, identity) => {
      // 三级回退：缓存 → 静态帧提取 → 目录预览图；来源写在 x-mpw-thumb-src 头（?mpwdiag 报告用）
      const send = (src, mime, buf) => {
        res.writeHead(200, { 'content-type': mime, 'content-length': buf.length, 'cache-control': 'no-cache',
          'x-mpw-thumb-src': src, 'access-control-expose-headers': 'x-mpw-thumb-src' });
        res.end(buf);
      };
      if (identity) {
        const tp = join(THUMB_DIR, sceneThumbHash(identity));
        try {
          if (existsSync(tp)) {
            const st = statSync(tp);
            // LRU touch（60s 节流，避免每次列表渲染都写 mtime）
            if (Date.now() - st.mtimeMs > 60 * 1000) { try { utimesSync(tp, new Date(), new Date()); } catch { /* 忽略 */ } }
            send('cache', 'image/jpeg', readFileSync(tp));
            return;
          }
        } catch { /* 读缓存失败 → 走回退 */ }
      }
      try {
        const frame = extractSceneFrame(dir);
        if (frame) { send('frame', frame.mime, frame.bytes); return; }
      } catch { /* 提取失败 → 预览图 */ }
      try {
        const pv = previewFileIn(dir);
        if (pv && existsSync(pv)) {
          const name = String(pv).toLowerCase();
          const mime = name.endsWith('.gif') ? 'image/gif' : name.endsWith('.png') ? 'image/png'
            : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
          send('preview', mime, readFileSync(pv));
          return;
        }
      } catch { /* 忽略 */ }
      json(res, 404, { ok: false, error: 'no thumb/frame/preview' });
    };
    webServer.register({
      kind: 'exact', path: BASE + '/custom-scene-thumb',
      handler: (req, res) => {
        try {
          // ① 渲染器(:8899)跨源 POST（text/plain 简单请求免预检）→ 回显 Origin + credentials（同 /raw 口径）
          const origin = (req.headers && req.headers.origin) || '*';
          const cors = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'vary': 'Origin' };
          if ((req.method || 'GET').toUpperCase() === 'GET') {
            // 列表缩略图：custom=1&folder=&file=（file 缺省 scene.pkg）
            if (!customDir) restoreCustomDir();
            if (!customDir) { json(res, 404, { ok: false, error: 'no dir' }); return; }
            const url = new URL(req.url || '', 'http://localhost');
            const sp = url.searchParams;
            const folder = sp.get('folder') || '';
            if (!folder || folder.includes('..') || folder.includes('/') || folder.includes('\\') || folder.startsWith('.')) { json(res, 403, { ok: false, error: 'forbidden' }); return; }
            const file = sp.get('file') || '';
            if (file && (file.includes('..') || file.includes('/') || file.includes('\\') || file.startsWith('.'))) { json(res, 403, { ok: false, error: 'forbidden' }); return; }
            const identity = 'custom|' + folder + '|' + (file || 'scene.pkg');
            // ①(B6 沙箱) 不透明源（strict iframe）读缩略图同样要 token：这条 GET 只有同源插件 UI 用得到，
            //   渲染器只 POST 上报 —— 所以对 "null" 来源收紧不会影响任何既有链路。
            if (isOpaqueOrigin(req) && !sandboxTokenCheck(identity, sp.get('st'))) { sandboxDeny(res, 'thumb-get'); return; }
            if (sp.get('lastpost') === '1') { sceneThumbBeaconJson(res, identity, join(customDir, folder), file || 'scene.pkg'); return; } // ①(批次15 B1) 看门狗信标查询
            serveSceneThumb(req, res, resolve(join(customDir, folder)), identity);
            return;
          }
          // POST：渲染器首帧上报 → 落盘
          const jsonCors = (code, obj) => {
            // 跨源响应必须带 CORS 头渲染器才能读到结果（成功/失败都要，便于日志）
            res.writeHead(code, Object.assign({ 'content-type': 'application/json' }, cors));
            res.end(JSON.stringify(obj));
          };
          let body = '';
          req.on('data', (c) => { body += c; if (body.length > THUMB_BODY_MAX) req.destroy(); });
          req.on('end', () => {
            try {
              let d = null;
              try { d = JSON.parse(body || '{}'); } catch { jsonCors(400, { ok: false, error: 'bad json' }); return; }
              const sp = new URLSearchParams();
              if (d.pkgurl) sp.set('pkgurl', String(d.pkgurl));
              if (d.folder) sp.set('folder', String(d.folder));
              if (d.file) sp.set('file', String(d.file));
              if (d.ltoken) sp.set('ltoken', String(d.ltoken));
              const identity = sceneThumbIdentity(sp);
              const frame = String((d && d.frame) || '');
              const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(frame);
              if (!identity || !m) { jsonCors(400, { ok: false, error: 'bad identity or frame' }); return; }
              // ①(B6 沙箱) 不透明源必须带 body.sceneToken 且与 identity 一致；旧插件（cookie 简单请求）不变
              if (isOpaqueOrigin(req) && !sandboxTokenCheck(identity, d && d.sceneToken)) { jsonCors(403, { ok: false, error: 'scene token required' }); return; }
              const bytes = Buffer.from(m[2], 'base64');
              if (bytes.length < 512 || bytes.length > THUMB_BODY_MAX) { jsonCors(400, { ok: false, error: 'frame size out of range' }); return; }
              mkdirSync(THUMB_DIR, { recursive: true });
              const fp = join(THUMB_DIR, sceneThumbHash(identity));
              const tmp = fp + '.tmp';
              writeFileSync(tmp, bytes);
              renameSync(tmp, fp);
              sceneThumbPrune();
              try { console.log('[dsh-mpkg-wallpaper][thumb] 落盘 ' + identity + ' → ' + sceneThumbHash(identity) + ' (' + bytes.length + 'B)'); } catch {}
              try { __mpwSceneThumbMeta.set(identity, { lastPostAt: Date.now(), bytes: bytes.length }); } catch {} // ①(批次15 B1) 看门狗信标
              jsonCors(200, { ok: true, file: sceneThumbHash(identity), bytes: bytes.length, identity });
            } catch (err) { try { jsonCors(500, { ok: false, error: String(err && err.message || err) }); } catch { /* 忽略 */ } }
          });
        } catch (err) { json(res, 500, { ok: false, error: String(err && err.message || err) }); }
      },
    });
    webServer.register({
      kind: 'exact', path: BASE + '/library-scene-thumb',
      handler: (req, res) => {
        try {
          const url = new URL(req.url || '', 'http://localhost');
          const sp = url.searchParams;
          const lt = sp.get('ltoken') || '';
          const rec = library.get(lt);
          if (!rec || !rec.dir) { json(res, 404, { ok: false, error: 'not found' }); return; }
          const file = sp.get('file') || '';
          if (file && (file.includes('..') || file.includes('/') || file.includes('\\') || file.startsWith('.'))) { json(res, 403, { ok: false, error: 'forbidden' }); return; }
          const libIdentity = 'library|' + lt + '|' + (file || 'scene.pkg');
          if (sp.get('lastpost') === '1') { sceneThumbBeaconJson(res, libIdentity, rec.dir, file || 'scene.pkg'); return; } // ①(批次15 B1) 看门狗信标查询
          serveSceneThumb(req, res, resolve(rec.dir), libIdentity);
        } catch (err) { json(res, 500, { ok: false, error: String(err && err.message || err) }); }
      },
    });

    // ①(新) 场景图层合成（route B v1）：解析 scene.json 全部 image 图层 →
    // 输出清单（图层纹理 URL + 几何 + 视差）。浏览器 canvas 合成渲染（动态）。
    // ①(修正) 场景 pkg 读取：**stat 优先**。原 readPkgBuf 每次请求都 readFileSync 整文件
    //（scene.pkg 可含 30-122MB 视频纹理），即使 manifest/layer 缓存命中（buf 未用）也重复
    // 全量读 → 内存/IO 压力。改成 sceneStat 只 stat；真正读文件推迟到缓存未命中时。
    const sceneStat = (dir) => {
      const pkgPath = join(dir, 'scene.pkg');
      if (!existsSync(pkgPath)) return null;
      return { pkgPath, st: statSync(pkgPath) };
    };
    const readPkgWhole = (pkgPath) => new Uint8Array(readFileSync(pkgPath));
    const manifestCache = new Map(); // key=scene.pkg path → { mtimeMs, manifest }
    const layerCache = new Map();    // key=path#texPath → { mtimeMs, mime, bytes }
    const MANIFEST_CACHE_MAX = 64;
    // ①(修正) 层缓存按**体积**而非只按条数兜底：每条是解码后的 PNG（可能数 MB），
    //   256 条 × 多 MB 会无界膨胀（用户实测反复换场景后内存涨）。加字节预算，
    //   超预算时从最旧开始逐条逐出（LRU-ish），保证总字节上限。
    const LAYER_CACHE_MAX_BYTES = 128 * 1024 * 1024; // 128MB 预算
    let layerCacheBytes = 0;
    const layerCacheSet = (key, val) => {
      const prev = layerCache.get(key);
      if (prev) layerCacheBytes -= (prev.bytes ? prev.bytes.length : 0);
      layerCache.set(key, val);
      layerCacheBytes += (val.bytes ? val.bytes.length : 0);
      while (layerCache.size > 256 || layerCacheBytes > LAYER_CACHE_MAX_BYTES) {
        const k = layerCache.keys().next().value;
        if (k === undefined) break;
        const ev = layerCache.get(k);
        layerCacheBytes -= (ev && ev.bytes ? ev.bytes.length : 0);
        layerCache.delete(k);
      }
    };
    webServer.register({
      kind: 'exact', path: BASE + '/custom-scene-composite',
      handler: (req, res) => {
        try {
          if (!customDir) restoreCustomDir();
          if (!customDir) { json(res, 404, { ok: false, error: 'no dir' }); return; }
          const url = new URL(req.url || '', 'http://localhost');
          const folder = url.searchParams.get('folder') || '';
          if (!folder || folder.includes('..') || folder.includes('/') || folder.includes('\\') || folder.startsWith('.')) { json(res, 403, { ok: false, error: 'forbidden' }); return; }
          const dir = resolve(join(customDir, folder));
          const pk = sceneStat(dir);
          if (!pk) { json(res, 404, { ok: false, error: 'no scene.pkg' }); return; }
          const cached = manifestCache.get(pk.pkgPath);
          let man = cached && cached.mtimeMs === pk.st.mtimeMs ? cached.manifest : null;
          if (!man) {
            // 缓存未命中才读整文件（scene.pkg 可含大纹理，避免每次请求全量读）
            const buf = readPkgWhole(pk.pkgPath);
            let extracted = null;
            try { extracted = extractSceneManifest(buf); } catch (err) { json(res, 404, { ok: false, error: String(err && err.message || 'no layers') }); return; }
            // ①(修正) 先验证首层可提取、**之后才缓存**。若先 set 再 validate：视频纹理
            // 场景（时间变化壁纸的 .tex 是内嵌 mp4）首层解码必失败 → 本请求返回 404 回退
            // preview.gif，但无效清单已被缓存 → 下次同类请求命中缓存跳过验证 → 返回 200
            // → 客户端逐层 fetch 各 500 → 空白画布（回归审查发现）。
            try {
              extractSceneLayer(buf, extracted.layers[0].texPath);
            } catch (err) {
              json(res, 404, { ok: false, error: 'video-texture scene (no static layers)' });
              return;
            }
            man = extracted;
            manifestCache.set(pk.pkgPath, { mtimeMs: pk.st.mtimeMs, manifest: man });
            if (manifestCache.size > MANIFEST_CACHE_MAX) { const k = manifestCache.keys().next().value; manifestCache.delete(k); }
          }
          const layers = man.layers.map((l) => ({
            name: l.name, texPath: l.texPath, x: l.x, y: l.y, w: l.w, h: l.h, px: l.px, py: l.py,
            url: BASE + '/custom-scene-layer?folder=' + encodeURIComponent(folder) + '&name=' + encodeURIComponent(l.texPath),
          }));
          json(res, 200, { ok: true, w: man.w, h: man.h, frameKey: man.frameKey, layers });
        } catch (err) { json(res, 500, { ok: false, error: String(err && err.message || err) }); }
      },
    });
    webServer.register({
      kind: 'exact', path: BASE + '/custom-scene-layer',
      handler: (req, res) => {
        try {
          if (!customDir) restoreCustomDir();
          if (!customDir) { json(res, 404, { ok: false, error: 'no dir' }); return; }
          const url = new URL(req.url || '', 'http://localhost');
          const folder = url.searchParams.get('folder') || '';
          const name = url.searchParams.get('name') || '';
          if (!folder || !name || folder.includes('..') || folder.includes('/') || folder.includes('\\') || folder.startsWith('.') || name.includes('..')) { json(res, 403, { ok: false, error: 'forbidden' }); return; }
          const dir = resolve(join(customDir, folder));
          const pk = sceneStat(dir);
          if (!pk) { json(res, 404, { ok: false, error: 'no scene.pkg' }); return; }
          const key = pk.pkgPath + '#' + name;
          const cached = layerCache.get(key);
          if (cached && cached.mtimeMs === pk.st.mtimeMs) {
            res.writeHead(200, { 'content-type': cached.mime, 'content-length': cached.bytes.length, 'cache-control': 'no-cache' });
            res.end(cached.bytes);
            return;
          }
          // 缓存未命中才读整文件并解码图层
          const r = extractSceneLayer(readPkgWhole(pk.pkgPath), name);
          layerCacheSet(key, { mtimeMs: pk.st.mtimeMs, mime: r.mime, bytes: r.bytes });
          res.writeHead(200, { 'content-type': r.mime, 'content-length': r.bytes.length, 'cache-control': 'no-cache' });
          res.end(r.bytes);
        } catch (err) { json(res, 500, { ok: false, error: String(err && err.message || err) }); }
      },
    });
    webServer.register({
      kind: 'exact', path: BASE + '/library-scene-composite',
      handler: (req, res) => {
        try {
          const url = new URL(req.url || '', 'http://localhost');
          const lt = url.searchParams.get('ltoken') || '';
          const rec = library.get(lt);
          if (!rec || !rec.dir) { json(res, 404, { ok: false, error: 'not found' }); return; }
          const dir = resolve(rec.dir);
          const pk = sceneStat(dir);
          if (!pk) { json(res, 404, { ok: false, error: 'no scene.pkg' }); return; }
          const cached = manifestCache.get(pk.pkgPath);
          let man = cached && cached.mtimeMs === pk.st.mtimeMs ? cached.manifest : null;
          if (!man) {
            const buf = readPkgWhole(pk.pkgPath);
            let extracted = null;
            try { extracted = extractSceneManifest(buf); } catch (err) { json(res, 404, { ok: false, error: String(err && err.message || 'no layers') }); return; }
            // ①(修正) 先验证首层可提取、**之后才缓存**（同 custom-scene-composite，防无效清单被缓存）
            try {
              extractSceneLayer(buf, extracted.layers[0].texPath);
            } catch (err) {
              json(res, 404, { ok: false, error: 'video-texture scene (no static layers)' });
              return;
            }
            man = extracted;
            manifestCache.set(pk.pkgPath, { mtimeMs: pk.st.mtimeMs, manifest: man });
            if (manifestCache.size > MANIFEST_CACHE_MAX) { const k = manifestCache.keys().next().value; manifestCache.delete(k); }
          }
          const layers = man.layers.map((l) => ({
            name: l.name, texPath: l.texPath, x: l.x, y: l.y, w: l.w, h: l.h, px: l.px, py: l.py,
            url: BASE + '/library-scene-layer?ltoken=' + encodeURIComponent(lt) + '&name=' + encodeURIComponent(l.texPath),
          }));
          json(res, 200, { ok: true, w: man.w, h: man.h, frameKey: man.frameKey, layers });
        } catch (err) { json(res, 500, { ok: false, error: String(err && err.message || err) }); }
      },
    });
    webServer.register({
      kind: 'exact', path: BASE + '/library-scene-layer',
      handler: (req, res) => {
        try {
          const url = new URL(req.url || '', 'http://localhost');
          const lt = url.searchParams.get('ltoken') || '';
          const name = url.searchParams.get('name') || '';
          const rec = library.get(lt);
          if (!rec || !rec.dir || !name || name.includes('..')) { json(res, 403, { ok: false, error: 'forbidden' }); return; }
          const dir = resolve(rec.dir);
          const pk = sceneStat(dir);
          if (!pk) { json(res, 404, { ok: false, error: 'no scene.pkg' }); return; }
          const key = pk.pkgPath + '#' + name;
          const cached = layerCache.get(key);
          if (cached && cached.mtimeMs === pk.st.mtimeMs) {
            res.writeHead(200, { 'content-type': cached.mime, 'content-length': cached.bytes.length, 'cache-control': 'no-cache' });
            res.end(cached.bytes);
            return;
          }
          const r = extractSceneLayer(readPkgWhole(pk.pkgPath), name);
          layerCacheSet(key, { mtimeMs: pk.st.mtimeMs, mime: r.mime, bytes: r.bytes });
          res.writeHead(200, { 'content-type': r.mime, 'content-length': r.bytes.length, 'cache-control': 'no-cache' });
          res.end(r.bytes);
        } catch (err) { json(res, 500, { ok: false, error: String(err && err.message || err) }); }
      },
    });

    // ④(新) 本地壁纸库媒体：按 ltoken + 文件名读取（Range），校验防路径穿越
    webServer.register({
      kind: 'exact', path: BASE + '/library-media',
      handler: (req, res) => {
        try {
          const url = new URL(req.url || '', 'http://localhost');
          const lt = url.searchParams.get('ltoken') || '';
          const file = url.searchParams.get('file') || '';
          const rec = library.get(lt);
          if (!rec || !rec.media) { json(res, 404, { ok: false, error: 'not found' }); return; }
          // 安全：file 必须是 media 基础名（禁止 ../ 路径穿越）
          if (file !== rec.media.split(/[\\/]/).pop()) { json(res, 403, { ok: false, error: 'forbidden' }); return; }
          const filePath = rec.media;
          if (!existsSync(filePath)) { json(res, 404, { ok: false, error: 'not found' }); return; }
          const st = statSync(filePath);
          const mime = filePath.toLowerCase().endsWith('.mp4') ? 'video/mp4'
            : filePath.toLowerCase().endsWith('.webm') ? 'video/webm'
            : filePath.toLowerCase().endsWith('.mov') ? 'video/quicktime'
            : filePath.toLowerCase().endsWith('.html') || filePath.toLowerCase().endsWith('.htm') ? 'text/html'
            : 'application/octet-stream';
          const range = req.headers.range;
          if (range) {
            const m = /bytes=(\d*)-(\d*)/.exec(range);
            const rs = m && m[1] ? parseInt(m[1], 10) : 0;
            const re = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
            const s = Math.max(0, rs); const e = Math.min(st.size - 1, re);
            if (s > e) { res.writeHead(416, { 'content-range': `bytes */${st.size}` }); res.end(); return; }
            res.writeHead(206, {
              'content-type': mime, 'accept-ranges': 'bytes',
              'content-range': `bytes ${s}-${e}/${st.size}`, 'content-length': e - s + 1,
            });
            serveStream(res, createReadStream(filePath, { start: s, end: e }));
          } else {
            res.writeHead(200, { 'content-type': mime, 'accept-ranges': 'bytes', 'content-length': st.size });
            serveStream(res, createReadStream(filePath));
          }
        } catch (err) {
          json(res, 500, { ok: false, error: String(err && err.message || err) });
        }
      },
    });

    // ③(新) Steam 自动发现：返回壁纸引擎安装目录 + 可移植壁纸列表（video/web）
    webServer.register({
      kind: 'exact', path: BASE + '/steam-inventory',
      handler: (req, res) => {
        try {
          const installDir = locateWallpaperEngine();
          if (!installDir) { json(res, 200, { ok: true, installDir: null, wallpapers: [] }); return; }
          const projectsRoots = [
            join(installDir, 'projects', 'myprojects'),
            join(installDir, 'projects', 'defaultprojects'),
            join(installDir, 'steamapps', 'workshop', 'content', WE_APPID),
          ];
          const wallpapers = [];
          const scan = (root) => {
            if (!existsSync(root)) return;
            let dirs = [];
            try { dirs = readdirSync(root); } catch { return; }   // ①(修正) 目录不可读则整体跳过，不崩
            for (const dir of dirs) {
              const p = join(root, dir);
              const proj = join(p, 'project.json');
              if (!existsSync(proj)) continue;
              try {
                const meta = JSON.parse(readFileSync(proj, 'utf8'));
                const type = (meta.type || 'scene').toLowerCase();
                // ④(安全) 排除 application / exe 壁纸：这类已弃用的 .exe 格式可能被注入病毒，
                // 本插件绝不读取/执行任何 .exe。scene 只给预览图（无法渲染）。
                if (type === 'application' || type === 'exe' || type === 'app') continue;
                // 可移植类型（video/web）附带 media 路径（mp4/html）；scene 只给 preview
                let media = null;
                let webHeavy = false, webExternal = false;
                if (type === 'video') {
                  const v = readdirSync(p).find((f) => /\.(mp4|webm|mov)$/i.test(f));
                  if (v) media = join(p, v);
                } else if (type === 'web') {
                  const h = readdirSync(p).find((f) => /\.(html?|htm)$/i.test(f));
                  if (h) media = join(p, h);
                  try {
                    const heavyNames = [];
                    const walkHeavy2 = (d2, depth) => {
                      if (depth > 3 || heavyNames.length) return;
                      let ents = [];
                      try { ents = readdirSync(d2, { withFileTypes: true }); } catch { return; }
                      for (const en of ents) {
                        if (en.isDirectory()) walkHeavy2(join(d2, en.name), depth + 1);
                        else if (/\.(skel|atlas)$/i.test(en.name) || /spine|live2d|\.l2d/i.test(en.name)) { heavyNames.push(en.name); break; }
                      }
                    };
                    walkHeavy2(p, 0);
                    if (heavyNames.length) webHeavy = true;
                    if (h) {
                      const htmlText = readFileSync(join(p, h), 'utf8').slice(0, 262144);
                      if (/https?:\/\//i.test(htmlText)) webExternal = true;
                    }
                  } catch { /* 预检失败不阻塞 */ }
                }
                // ①(修复 2026-09-14) 原写 `resolve(fullPath)`，而 `fullPath` 在整个文件里**从未定义**
                //   （全文仅此一处引用）→ 每次抛 ReferenceError，被外层 `catch { /* skip */ }` 静默吞掉
                //   ⇒ `wallpapers` 数组与 `library` Map **恒为空**：Windows 上插件 Steam 库列表永远空
                //   （本机 Linux 因 locateWallpaperEngine() 返回 null 不触发，属潜伏 bug）。
                //   目录变量就是 `p`（下一行 library.set 用的也是 p）。
                const ltoken = crypto.createHash('sha256').update(resolve(p)).digest('hex').slice(0, 16);
                library.set(ltoken, { dir: p, type, title: meta.title || dir, media, preview: join(p, 'preview.jpg') });
                wallpapers.push({ title: meta.title || dir, type, ltoken, preview: join(p, 'preview.jpg'), media, webHeavy, webExternal });
              } catch (e) {
                // ①(2026-09-14) 不再静默：上面那个 ReferenceError 就是被这里的空 catch 藏了整整一段时间。
                try { console.warn('[dsh-mpkg-wallpaper][steam] 跳过 ' + dir + '：' + (e && e.message || e)) } catch {}
              }
            }
          };
          for (const root of projectsRoots) scan(root);
          // ①(新) WE 原生播放列表（config.json → general.playlists）：解析为
          // 轮播列表（项 = 壁纸路径 → 映射到本插件的 key：steam|ltoken / custom|目录名）
          const playlists = [];
          try {
            const cfgPath = join(installDir, 'config.json');
            if (existsSync(cfgPath)) {
              const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
              const byFolder = new Map(); // 文件夹名 → ltoken
              for (const [lt, rec] of library) {
                const base = String(rec.dir || '').split(/[\\/]/).filter(Boolean).pop() || '';
                if (base && !byFolder.has(base)) byFolder.set(base.toLowerCase(), lt);
              }
              const seen = new Set();
              for (const profile of Object.values(cfg || {})) {
                if (!profile || typeof profile !== 'object') continue;
                const general = profile.general || {};
                const rows = Array.isArray(general.playlists) ? general.playlists : [];
                for (const row of rows) {
                  const items = Array.isArray(row.items) ? row.items.filter((x) => typeof x === 'string' && x.trim()) : [];
                  if (!items.length) continue;
                  const keys = [];
                  for (const item of items) {
                    // "…/workshop/content/431960/<folder>/…" → 文件夹名 → ltoken
                    const m = /[\\/]431960[\\/]([^\\/]+)(?:[\\/]|$)/i.exec(item);
                    const folder = m ? m[1] : /[\\/]([^\\/]+)[\\/][^\\/]+$/i.exec(item) ? /[\\/]([^\\/]+)[\\/][^\\/]+$/i.exec(item)[1] : null;
                    if (!folder) continue;
                    const lt = byFolder.get(folder.toLowerCase());
                    if (lt) keys.push('steam|' + lt);
                    else if (customDir && existsSync(join(customDir, folder))) keys.push('custom|' + folder);
                  }
                  if (!keys.length) continue;
                  const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : 'WE Playlist';
                  const sig = name + '\u0000' + keys.join('\u0000');
                  if (seen.has(sig)) continue;
                  seen.add(sig);
                  const settings = row.settings && typeof row.settings === 'object' ? row.settings : {};
                  playlists.push({
                    name,
                    keys,
                    order: settings.order === 'random' ? 'random' : 'sequence',
                    interval: typeof settings.delay === 'number' && settings.delay > 0 ? Math.min(1440, Math.round(settings.delay)) : 5,
                  });
                }
              }
            }
          } catch { /* 播放列表读取失败不阻塞 */ }
          json(res, 200, { ok: true, installDir, wallpapers, playlists });
        } catch (err) {
          json(res, 500, { ok: false, error: String(err && err.message || err) });
        }
      },
    });

    // ── 视频壁纸「解码帧率上限」路由 ────────────────────────────────────────────
    // ①(新) ffmpeg 可用性探测：env DSH_WE_FFMPEG → 系统 PATH → DATA_DIR/ffmpeg/。
    // 找不到也返回 200 { ok:true, found:false }（客户端据此提示用户，不抛错）。
    webServer.register({
      kind: 'exact', path: BASE + '/ffmpeg-check',
      handler: (req, res) => {
        try {
          // ①(修正) 区分来源：env 显式 / 系统 PATH / 缓存静态。客户端据此显示「系统已装/缓存已装/未装」。
          const src = resolveFfmpegSource();
          json(res, 200, { ok: true, found: !!src, source: src ? src.source : null, path: src ? src.path : null, version: src ? src.version : null });
        } catch (err) {
          json(res, 200, { ok: false, found: false, source: null, path: null, version: null, error: String(err && err.message || err) });
        }
      },
    });

    // ①(新) 卸载缓存里的 ffmpeg（只删 DATA_DIR/ffmpeg/ 下的静态二进制；**不碰系统 PATH /
    // env 指定的**——用户明确要求别把系统自带的卸掉）。
    webServer.register({
      kind: 'exact', path: BASE + '/ffmpeg-uninstall',
      handler: (req, res) => {
        try {
          if ((req.method || 'GET').toUpperCase() !== 'POST') { json(res, 405, { ok: false, error: 'method' }); return; }
          const cached = join(ffmpegDataDir(), ffmpegExeName());
          if (existsSync(cached)) {
            try { unlinkSync(cached); } catch (e) { json(res, 500, { ok: false, error: String(e && e.message || e) }); return; }
          }
          // 顺便清掉同目录残留（.part 下载碎片不在这里；仅清主二进制）
          json(res, 200, { ok: true, removed: cached });
        } catch (err) {
          json(res, 500, { ok: false, error: String(err && err.message || err) });
        }
      },
    });

    // ①(新) 下载当前平台的 ffmpeg-static 单文件到 DATA_DIR/ffmpeg/（用户显式按钮触发）。
    // 校验 sha256 + 魔数 + 大小>20MB，原子写入；单飞防并发。
    webServer.register({
      kind: 'exact', path: BASE + '/ffmpeg-download',
      handler: async (req, res) => {
        try {
          if ((req.method || 'GET').toUpperCase() !== 'POST') { json(res, 405, { ok: false, error: 'method' }); return; }
          const r = await downloadFfmpeg();
          json(res, 200, { ok: true, path: r.path, size: r.size });
        } catch (err) {
          json(res, 500, { ok: false, error: String(err && err.message || err) });
        }
      },
    });

    // ⓪(2026-09-17 用户第 1 条) **浏览器可播性探测路由**（只读元数据，不起 ffmpeg）：
    //   GET /probe?src=<client 的 image 串>  → { ok, info:{…}, verdict:{playable,reason}, limits:{…} }
    //   客户端在"要不要转码"之前先问这一句：
    //     playable === true  → **不转码**，直接播原片（这就是本次 bug 的闸门）；
    //     playable === false → 浏览器确实吃不下，转码有意义；
    //     playable === null  → 探不出来（无 ffprobe / 未知编码）⇒ 不改行为。
    //   limits 一并回给客户端/测试，便于现场核对当前生效的资源上限（数量/字节/并发/内存准入）。
    webServer.register({
      kind: 'exact', path: BASE + '/probe',
      handler: (req, res) => {
        try {
          if ((req.method || 'GET').toUpperCase() !== 'GET') { json(res, 405, { ok: false, error: 'method' }); return; }
          const url = new URL(req.url || '', 'http://localhost');
          const srcParam = (url.searchParams.get('src') || '').trim();
          const limits = {
            cacheKeep: TRANSCODE_CACHE_KEEP, cacheMaxBytes: TRANSCODE_MAX_BYTES,
            maxActive: TRANSCODE_MAX_ACTIVE, defaultMaxW: TRANSCODE_DEFAULT_MAXW,
            minAvailMb: TRANSCODE_MIN_AVAIL_MB, timeoutMs: TRANSCODE_TIMEOUT_MS,
          };
          const cache = transcodeCacheStat();
          if (!srcParam) { json(res, 200, { ok: true, info: null, verdict: { playable: null, reason: '缺少 src' }, limits, cache }); return; }
          const src = resolveTranscodeByImage(srcParam);
          if (!src) { json(res, 404, { ok: false, error: 'unknown source', limits, cache }); return; }
          const info = getVideoProbe(src);
          json(res, 200, { ok: true, info, verdict: (info && info.browserPlayable) || { playable: null, reason: '探测失败（无 ffprobe / 读不到元数据）' }, limits, cache });
        } catch (err) {
          json(res, 500, { ok: false, error: String(err && err.message || err) });
        }
      },
    });

    // ①(新) 转码进度（简单版）：带 file+fps 查指定任务；否则返回最近任务/下载进度。
    webServer.register({
      kind: 'exact', path: BASE + '/transcode-progress',
      handler: (req, res) => { handleTranscodeProgress(req, res); },
    });

    // ①(新) 抽帧+降分辨率转码：把媒体转码到 fps 上限（可选缩放到 maxW 宽），Range 流式返回转码产物。
    // 用法：/transcode?src=<client的image串:host:?ltoken=..&file=..|custom=1&folder=..&file=..|token=..&index=..>&fps=60&maxW=1920
    //       （兼容旧式：/transcode/<mpkgToken>?fps=60 或 /transcode?file=<绝对路径|customDir内文件名>&fps=60）
    // 缓存 DATA_DIR/transcodes/tc_<sha256(src|mtime|fps|maxW)>.mp4；转码失败返回 { ok:false }，
    // 客户端回退原片。任务用 spawn 异步执行（不阻塞事件循环），15min 超时 kill。
    // ⓪(2026-09-17 用户第 1 条) **直读原片**（不转码）的统一出口：
    //   file 源直接 serveRange；mpkg 条目先 materialize 成临时文件、流结束后清理。
    //   带 `x-mpw-transcode: direct|direct-playable` 响应头 ⇒ 客户端/测试能明确区分
    //   「这次是直读」而不是"转码失败悄悄回退"（旧实现两者都是原片，无法分辨）。
    const serveDirect = (req, res, src, why) => {
      try { res.setHeader('x-mpw-transcode', why || 'direct'); } catch { /* 忽略 */ }
      if (src.type === 'file') { serveRange(req, res, src.path, 'video/mp4'); return true; }
      try {
        const mat = materializeSource(src, transcodeCacheDir());
        res.on('close', () => { try { if (mat.cleanup) mat.cleanup(); } catch {} });
        serveRange(req, res, mat.file, 'video/mp4');
        return true;
      } catch { return false; }
    };
    webServer.register({
      kind: 'prefix', path: BASE + '/transcode',
      handler: async (req, res) => {
        try {
          if ((req.method || 'GET').toUpperCase() !== 'GET') { json(res, 405, { ok: false, error: 'method' }); return; }
          const url = new URL(req.url || '', 'http://localhost');
          // /transcode/progress 与 /transcode-progress 语义相同：这里兜底（防路由前缀遮蔽）
          const rest = url.pathname.startsWith(BASE + '/transcode/') ? url.pathname.slice((BASE + '/transcode/').length) : '';
          if (rest.startsWith('progress')) { handleTranscodeProgress(req, res); return; }
          const token = rest ? (() => { try { return decodeURIComponent(rest); } catch { return rest; } })() : '';
          const file = (url.searchParams.get('file') || '').trim();
          const srcParam = (url.searchParams.get('src') || '').trim();
          const fpsRaw = Number(url.searchParams.get('fps'));
          const fps = Number.isFinite(fpsRaw) && ALLOWED_FPS.includes(fpsRaw) ? fpsRaw : 0;
          if (!fps) { json(res, 400, { ok: false, error: 'invalid fps (allowed: 24/30/48/60)' }); return; }
          const maxWRaw = Number(url.searchParams.get('maxW'));
          const maxW = Number.isFinite(maxWRaw) && maxWRaw > 0 ? Math.min(3840, Math.round(maxWRaw)) : 0;
          // ①(新) src 优先（client 播放路径直接传原 image 串）；旧式 file/token 兼容保留。
          const src = srcParam ? resolveTranscodeByImage(srcParam) : resolveTranscodeSource(file || token);
          if (!src) { json(res, 404, { ok: false, error: 'unknown source' }); return; }
          // ⓪(2026-09-17) 旧口径只在「`fps >= 源fps` 且 `maxW >= 源宽`」时才直读
          //  ⇒ 客户端自动降级用的 `/transcode?fps=24`（源 60fps）**必然**落进转码，
          //  于是"浏览器明明能直读的 H.264 MP4"也被重编码一遍（用户本次报的问题）。
          //  现在改为**编码优先**：先探测可播性——
          //    · player=direct（客户端在 error 路径上的请求）且判得出可直读 → 直读；
          //    · 未显式限制规格（maxW=0，即"没要求降分辨率"）且可直读 → 直读；
          //    · 用户显式设了 fpsCap/resMax（真要降载）→ 即使可直读也照旧转码（尊重用户设置）。
          const player = (url.searchParams.get('player') || '').trim();
          const probe = probeVideoSource(src);
          const verdict = (getVideoProbe(src) || {}).browserPlayable || null;
          const playable = !!(verdict && verdict.playable === true);
          // ①(2026-09-17) 转码的默认降采样：没显式给 maxW 时套 TRANSCODE_DEFAULT_MAXW
          //  （转码本就是"降载"路径，4K 源重编码成 4K 等于白烧 656MB 内存与 3 倍时间）。
          //  用户显式给了更小的 maxW 就按用户的来；给得更大也被这个上限收口（env 可放开）。
          const reqMaxW = maxW > 0 ? maxW : TRANSCODE_DEFAULT_MAXW;
          const effMaxW = (TRANSCODE_DEFAULT_MAXW > 0 && reqMaxW > TRANSCODE_DEFAULT_MAXW) ? TRANSCODE_DEFAULT_MAXW : reqMaxW;
          //  "用户是不是真的要求降规格"：**只有客户端显式传了 maxW**（= 设了 resMax）才算。
          //  ⚠ 不能把"fps < 源帧率"当成"用户要求降帧"：客户端在解码失败自动降级时用的
          //    正是 `/transcode?…&fps=24`（源 60fps）——那**不是**用户设置，是**待验证的
          //    降级请求**。若按 fps 判，闸门在"自动降级"这条路上恒不成立 = 等于没修。
          //    真要降帧的场景必然带用户设置（fpsCap），客户端那次请求的目标 URL 也带
          //    maxW（resMax>0 时）或由下面的 spec 分支处理。
          const userAskedDownscale = maxW > 0;
          if (player === 'direct') {
            // ⓪ 客户端在 error 路径上的请求（这次 bug 的现场）：判得出可直读就直读原片。
            if (serveDirect(req, res, src, playable ? 'direct-playable' : 'direct-forced')) return;
          } else if (probe && playable && !userAskedDownscale) {
            // ②(fix) 用户实测：60fps 源 + fpsCap=60 仍走重编码 → 白屏（Android 单线程
            // 转 4K 100s 极慢），切回无限制时后台 ffmpeg 还在跑 → 卡。
            // ⓪(2026-09-17) 判据 =「**编码浏览器能吃** 且 **用户没要求降分辨率**」：
            //  用户什么都没设（fpsCap=0/resMax=0，本次现场）⇒ 直读原片最省；
            //  转码只会更差：抽帧降质 + 实测 656MB 内存 + 数分钟 CPU（而直读零成本）。
            if (serveDirect(req, res, src, 'direct-playable')) return;
          } else if (probe && playable !== false && fps >= probe.fps && (maxW === 0 || maxW >= probe.width)) {
            // ②(fix) 旧口径（"上限没低于源规格 ⇒ 直读"）**不看编码**：HEVC/MKV 只要
            //  fps/宽度没超限也会被直读 ⇒ 浏览器解不了 = 黑屏（实测：hevc 320x240@30
            //  + maxW=1920 ⇒ `x-mpw-transcode: direct-spec`）。已判定吃不下时**必须转码**，
            //  故这里加 `playable !== false`（null=探测不出来 ⇒ 保持旧行为，不误伤）。
            if (serveDirect(req, res, src, 'direct-spec')) return;
          }
          let out = null;
          let transcodeErr = null;
          // ②(fix) 客户端断开（切回无限制/换壁纸/关页）→ 取消进行中的转码：
          // 否则后台 ffmpeg 继续跑满 CPU（用户实测"60 帧停留后切无限制特别卡"）。
          // 默认 MAX_ACTIVE=1 时同时只有一个 ffmpeg，kill 全部活动进程安全；
          // MAX_ACTIVE>1 时仅 kill 本请求启动的（通过任务级 proc 标记，见下）。
          let reqAborted = false;
          // ①(修复) 只 kill 本请求启动的 ffmpeg：客户端断开时若正在排队/他源转码，
          // 全量 kill 会误杀正在显示的别壁纸的转码（排队请求 aborted 尤其常见）
          const before = new Set(ACTIVE_FFMPEG);
          const onAbort = () => {
            reqAborted = true;
            try {
              const cur = Array.from(ACTIVE_FFMPEG).filter((p) => !before.has(p));
              for (const proc of cur) { try { proc.kill(); } catch {} }
            } catch {}
          };
          // ⓪(2026-09-17) 只在"**还没开始回响应**就 close"时才算取消。
          //  旧写法 `if (!out)` 在同 tick 竞态下会误判：转码已成功、产物已在手上但
          //  serveRange 还没被调用时 close ⇒ 白 kill 一次刚跑完的任务并置 reqAborted
          //  （客户端拿不到产物、服务端也没省下任何 CPU）。用 serving 显式标记窗口。
          let serving = false;
          res.on('close', () => { if (!serving) onAbort(); });
          req.on('aborted', onAbort);
          try { out = await transcodeToFps(src, fps, effMaxW, () => reqAborted); } catch (err) { transcodeErr = err; } /* 转码失败/取消 → 回退原片 */
          if (reqAborted) return; // 客户端已断开，不再写响应
          if (!out) {
            // ⓪(2026-09-17) 失败响应带上探测判据：客户端/测试能一眼看出"为什么没给转码产物"
            //  （内存准入拒绝 / 队列忙 / ffmpeg 缺失 / 直读更合适 …），不再是黑盒 502。
            json(res, 502, {
              ok: false,
              error: String(transcodeErr && transcodeErr.message || transcodeErr || 'transcode failed'),
              verdict, probe: probe ? { video: probe.video, audio: probe.audio, width: probe.width, height: probe.height, fps: probe.fps, container: probe.container } : null,
            });
            return;
          }
          serving = true;
          serveRange(req, res, out, 'video/mp4');
        } catch (err) {
          json(res, 500, { ok: false, error: String(err && err.message || err) });
        }
      },
    });
    // ①(新) 液态玻璃(测试)：静态托管 liquid-glass 渲染器源码（浏览器动态 import）。
    // 路径 /api/mpkg-wallpaper/lg/<file>.js → lib/liquid-glass/<file>（防穿越，只允许 .js）。
    webServer.register({
      kind: 'prefix', path: BASE + '/lg',
      handler: (req, res) => {
        try {
          const url = new URL(req.url || '', 'http://localhost');
          const rest = url.pathname.startsWith(BASE + '/lg/') ? url.pathname.slice((BASE + '/lg/').length) : '';
          const file = (() => { try { return decodeURIComponent(rest); } catch { return rest; } })();
          if (!file || !file.endsWith('.js') || file.includes('..') || file.includes('/') || file.includes('\\')) { json(res, 403, { ok: false, error: 'forbidden' }); return; }
          const lgDir = join(fileURLToPath(new URL('.', import.meta.url)), 'liquid-glass');
          const target = join(lgDir, file);
          if (!existsSync(target) || !statSync(target).isFile()) { json(res, 404, { ok: false, error: 'not found' }); return; }
          const body = readFileSync(target);
          res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache', 'access-control-allow-origin': '*' });
          res.end(body);
        } catch (err) { json(res, 500, { ok: false, error: String(err && err.message || err) }); }
      },
    });
  }
}

export { apply };
/** ⓪(2026-09-17 用户第 1 条) 测试出口：把"可播性判据 + 资源上限 + 清理"这三件事
 *  暴露给回归测试（`tools/transcode-limit-test.mjs`）。**只读/纯函数为主**，
 *  不改变插件在宿主里的注册面（宿主只用 `apply`）。 */
export const __mpwTest = {
  apply,
  buildProbeInfo, browserPlayable, browserCodecGap,
  parseProbeKv, splitProbeSections, matroskaMagic, isoBmffMagic,
  resolveTranscodeByImage, getVideoProbe, probeVideoSource, probeVideoInfo,
  pruneTranscodeCache, transcodeCacheStat, transcodeMemGuard, systemAvailMemMb,
  // ①(2026-09-18 §5 第3项) diag 目录的清理纯函数 + 上限（tools/diag-subsystem-test.mjs 断言
  //   "数量 + 合计字节双上限、最旧先删"用的就是这两个 + DIAG_DIR 常量，不重写一份逻辑）。
  pruneDiagDir, diagDir: () => DIAG_DIR,
  limits: {
    TRANSCODE_CACHE_KEEP, TRANSCODE_MAX_BYTES, TRANSCODE_MAX_ACTIVE,
    TRANSCODE_DEFAULT_MAXW, TRANSCODE_MIN_AVAIL_MB, TRANSCODE_TIMEOUT_MS,
    TRANSCODE_QUEUE_TIMEOUT_MS, FFMPEG_ERR_KEEP, ALLOWED_FPS,
    DIAG_KEEP, DIAG_MAX_BYTES,
  },
};
