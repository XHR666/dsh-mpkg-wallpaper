// dsh-mpkg-wallpaper —— 宿主端（hybrid 模式：大文件流式上传 + Range 播放 + Steam 自动发现）
// 纯客户端逻辑仍在 ./client.js。本文件提供：
//   GET  /api/mpkg-wallpaper/ping                → { ok:true }（客户端探测 host 是否可用）
//   POST /api/mpkg-wallpaper/upload              → 流式接收 mpkg → 存磁盘 → 返回条目索引
//   GET  /api/mpkg-wallpaper/media?token=&index= → Range 流式返回 mpkg 内某个条目
//   GET  /api/mpkg-wallpaper/steam-inventory     → (Windows) 自动发现壁纸引擎安装与壁纸列表
import { createWriteStream, createReadStream, mkdirSync, existsSync, statSync, readFileSync, readdirSync, writeFileSync, openSync, readSync, closeSync, renameSync, unlinkSync, chmodSync, writeSync } from 'node:fs';
import { join, resolve, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
// tmpdir 不再使用（持久目录用 DATA_DIR）
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
// ①(新) scene.pkg 静态帧提取（MIT，来自 elysia395/dsh-wallpaper-engine，见文件头署名）
// ①(新) 图层合成清单/图层提取（route B v1：canvas 动态渲染）
import { extractSceneMainImage, extractSceneMainImageFromDir, extractSceneManifest, extractSceneLayer, extractTexVideoMp4, collectSceneVideoFiles, parsePkg, readPkgEntry } from './pkg-extract.js';

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
 *  不报错）。跨平台（Windows 无 HOME 时 os.homedir() 兜底）。 */
function betterSidebarVersion() {
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
const MPKG_PREVIEW_MAX_BYTES = 64 * 1024 * 1024;   // 总缓存上限 64MB
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
const SCENE_FRAME_MAX_BYTES = 256 * 1024 * 1024; // 大图（8K PNG 可到几十 MB）→ 256MB 上限
const SCENE_FRAME_MAX_ITEMS = 64;
let sceneFrameBytes = 0;
function sceneFrameGet(key) {
  const c = sceneFrameCache.get(key);
  if (c) { sceneFrameCache.delete(key); sceneFrameCache.set(key, c); }
  return c;
}
function sceneFrameSet(key, c) {
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

/** ②(fix) 用 ffprobe 探测视频流的帧率/分辨率（失败返回 null，不抛错）。
 *  用于"源帧率≤上限 且 源宽≤上限 → 无需转码直接原片"的判断——
 *  用户实测：60fps 源 + fpsCap=60 仍走重编码 → 白屏几分钟（Android 单线程
 *  转 4K 100s 极慢），切回无限制时后台 ffmpeg 还在跑 → 卡。 */
function probeVideoInfo(filePath) {
  try {
    const out = execFileSync('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=r_frame_rate,avg_frame_rate,width,height',
      '-of', 'csv=p=0', filePath,
    ], { encoding: 'utf8', timeout: 15000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const line = String(out).trim().split(/\r?\n/)[0] || '';
    const parts = line.split(',').map((s) => s.trim());
    // 实测 ffprobe 4.4.2 csv 输出顺序: <width>,<height>,<r_frame_rate>[,<avg_frame_rate>]
    // （如 "3840,2160,60/1" 或 "1920,1080,30000/1001"）——不是文档常见的
    // r_frame_rate,width,height 顺序，按 show_entries 声明顺序也实测为 width 在前。
    const width = Number(parts[0]);
    const height = Number(parts[1]);
    const parseRate = (s) => { const r = String(s || '').split('/'); const n = Number(r[0]), d = Number(r[1]); return d > 0 && Number.isFinite(n) ? n / d : 0; };
    // ①(fix) VFR 视频 r_frame_rate 可能是 0/0 → 用 avg_frame_rate 兜底
    let fps = parseRate(parts[2]);
    if (!(fps > 0)) fps = parseRate(parts[3]);
    if (!(fps > 0) || !(width > 0)) return null;
    return { fps, width, height };
  } catch { return null; }
}

/** ②(fix) 带缓存的探测（src 统一输入：mpkg 或 file）。 */
function probeVideoSource(src) {
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
      // mpkg 容器内条目：materialize 提取临时文件后探测，探完即删
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
// ①(新) scene 内嵌视频索引缓存：scene 目录 → { mtimeMs, hash, mime } | null（null=无内嵌视频）
const sceneVideoIndex = new Map();
/** 给定 scene 目录（含 scene.pkg 或松散 scene.json），返回首个内嵌视频的缓存信息。
 *  返回 { path, mime, size } | null（null=该场景无内嵌视频）。
 *  提取一次落盘缓存；mtime 变化重提；并发请求共享单飞。 */
function ensureSceneVideo(dir) {
  try {
    const pkgPath = join(dir, 'scene.pkg');
    const hasPkg = existsSync(pkgPath);
    const srcPath = hasPkg ? pkgPath : dir;
    const st = statSync(srcPath);
    const cached = sceneVideoIndex.get(dir);
    if (cached && cached.mtimeMs === st.mtimeMs) {
      if (!cached.hash) return null; // 已确认无视频
      const p = join(sceneVideoDir(), cached.hash);
      if (existsSync(p)) return { path: p, mime: cached.mime, size: statSync(p).size };
    }
    // 收集内嵌视频（scene.pkg → 整包解析；松散目录 → 遍历文件）
    let video = null;
    try {
      if (hasPkg) {
        const data = new Uint8Array(readFileSync(pkgPath));
        video = findSceneVideoInPkg(data);
      } else {
        video = findSceneVideoInDir(dir);
      }
    } catch { video = null; }
    if (!video) {
      sceneVideoIndex.set(dir, { mtimeMs: st.mtimeMs, hash: null, mime: null });
      return null;
    }
    const hash = crypto.createHash('sha256').update(dir + '|' + st.mtimeMs + '|' + video.ref).digest('hex').slice(0, 24);
    const out = join(sceneVideoDir(), hash + '.mp4');
    if (!existsSync(out)) {
      const tmp = out + '.tmp' + process.pid;
      try { writeFileSync(tmp, video.bytes); renameSync(tmp, out); } catch { try { unlinkSync(tmp); } catch {} }
    }
    const mime = /\.webm$/i.test(video.ref) ? 'video/webm' : /\.mov$/i.test(video.ref) ? 'video/quicktime' : 'video/mp4';
    sceneVideoIndex.set(dir, { mtimeMs: st.mtimeMs, hash, mime });
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
/** ①(修正) ffmpeg 错误日志保留上限：最多留 FFMPEG_ERR_KEEP 个，过多按 mtime 淘汰。
 *  （用户要求：转码失败日志最多留 50 个，过多自动清除，防止磁盘堆积。） */
const FFMPEG_ERR_KEEP = Number(process.env.DSH_WE_FFMPEG_ERR_KEEP) || 50;
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
function pruneTranscodeCache() {
  try {
    const dir = transcodeCacheDir();
    const entries = readdirSync(dir).filter((n) => n.startsWith('tc_') && n.endsWith('.mp4'));
    // ①(修正) 不用 return 提前退出：tc_ 数量足够时仍要继续下面的 errlog 清理
    if (entries.length > TRANSCODE_CACHE_KEEP) {
      const withStat = entries.map((n) => {
        try { return { n, mtime: statSync(join(dir, n)).mtimeMs }; } catch { return { n, mtime: 0 }; }
      }).sort((a, b) => b.mtime - a.mtime); // 最新在前
      for (let i = TRANSCODE_CACHE_KEEP; i < withStat.length; i++) {
        try { unlinkSync(join(dir, withStat[i].n)); } catch { /* 忽略 */ }
      }
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
        try { unlinkSync(join(dir, withStat[i].n)); } catch { /* 忽略 */ }
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
          if (statSync(join(dir, n)).mtimeMs < cutoff) unlinkSync(join(dir, n));
        } catch { /* 忽略 */ }
      }
    }
    // ②(Qoder 审查) tc_*.mp4.tmp<PID>：转码中间文件，进程被杀时 renameSync
    // 未执行 → 永久残留。mtime>1h 必是残留（单任务硬超时 15min），直接删。
    // 正在写的 tmp 由当前任务持有（<15min），不会被误删。
    for (const n of readdirSync(dir)) {
      if (n.startsWith('tc_') && /\.tmp(\d+)?$/.test(n)) {
        try {
          if (statSync(join(dir, n)).mtimeMs < cutoff) unlinkSync(join(dir, n));
        } catch { /* 忽略 */ }
      }
    }
  } catch { /* 忽略 */ }
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
async function runTranscode(srcFile, out, fps, maxW, job) {
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
    if (mode.label === 'mt' && futexSeen) continue; // 已知 futex 问题 → 跳过多线程
    for (const enc of encoders) {
      job.encoder = enc.name + (mode.label === 'st' ? ' (单线程)' : '');
      // -f mp4 显式指定：临时输出路径不是 .mp4 后缀，ffmpeg 无法按扩展名选 muxer
      // ①(Qoder 审查 M5) 单线程时输出侧再加 -threads 1 控制编码线程
      // （输入侧 -threads 只管解码；mode.extra 已含输入侧与 filter_threads）。
      try {
        const full = [...mode.extra, ...base, ...enc.tail, ...(mode.label === 'st' ? ['-threads', '1'] : []), '-movflags', '+faststart', '-an', '-f', 'mp4', out];
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
async function transcodeToFps(src, fps, maxW) {
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
        await runTranscode(mat.file, tmp, fps, maxW, transcodeJobs.get(progKey) || {});
        renameSync(tmp, cachePath);
        setTranscodeJob(progKey, { phase: 'done', percent: 100 });
        pruneTranscodeCache(); // ①(修正) 转码成功即做缓存 LRU 清理（防磁盘塞满）
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

function apply(ctx) {
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
        let betterSidebarVersion = null;
        try { betterSidebarVersion = betterSidebarVersion(); } catch { /* 忽略 */ }
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
          const start = rec.dataStart + entry.index + off;
          const end = start + entry.size - 1 - off;
          const name = entry.name.toLowerCase();
          const mime = name.endsWith('.gif') ? 'image/gif'
            : name.endsWith('.png') ? 'image/png'
            : name.endsWith('.jpg') || name.endsWith('.jpeg') ? 'image/jpeg'
            : name.endsWith('.webp') ? 'image/webp'
            : name.endsWith('.mp4') ? 'video/mp4'
            : name.endsWith('.webm') ? 'video/webm'
            : 'application/octet-stream';
          const range = req.headers.range;
          if (range) {
            const m = /bytes=(\d*)-(\d*)/.exec(range);
            const rs = m && m[1] ? parseInt(m[1], 10) : 0;
            const re = m && m[2] ? parseInt(m[2], 10) : entry.size - 1;
            const s = start + Math.max(0, rs);
            const e = start + Math.min(entry.size - 1, re);
            if (s > e) { res.writeHead(416, { 'content-range': `bytes */${entry.size}` }); res.end(); return; }
            res.writeHead(206, {
              'content-type': mime, 'accept-ranges': 'bytes',
              'content-range': `bytes ${s - start}-${e - start}/${entry.size}`,
              'content-length': e - s + 1,
            });
            serveStream(res, createReadStream(rec.path, { start: s, end: e }));
          } else {
            res.writeHead(200, { 'content-type': mime, 'accept-ranges': 'bytes', 'content-length': entry.size });
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
          // ①(新) workshop 原始目录识别：子文件夹含 project.json → 按 type 分流；
          // 无 project.json 时按 scene.pkg / index.html / 视频文件启发式兜底。
          for (const e of readdirSync(dir, { withFileTypes: true })) {
            const f = e.name;
            if (e.isDirectory() && !f.startsWith('.')) {
              const sub = join(dir, f);
              let type = null, media = null, title = null;
              const proj = join(sub, 'project.json');
              if (existsSync(proj)) {
                try {
                  const meta = JSON.parse(readFileSync(proj, 'utf8'));
                  type = String(meta.type || '').toLowerCase();
                  title = meta.title || null;
                  const fileField = String(meta.file || '');
                  if ((type === 'video' || type === 'web') && fileField && existsSync(join(sub, fileField))) media = fileField;
                  if (type === 'scene' && existsSync(join(sub, 'scene.pkg'))) media = 'scene.pkg';
                } catch { type = null; }
              }
              if (!type || !media) {
                // 启发式兜底
                const hasScene = existsSync(join(sub, 'scene.pkg'));
                const hasHtml = existsSync(join(sub, 'index.html')) || existsSync(join(sub, 'index.htm'));
                const vid = hasScene ? null : (() => { try { return readdirSync(sub).find((x) => /\.(mp4|webm|mov)$/i.test(x)) || null; } catch { return null; } })();
                if (hasScene) { type = 'scene'; media = 'scene.pkg'; }
                else if (hasHtml) { type = 'web'; media = 'index.html'; }
                else if (vid) { type = 'video'; media = vid; }
              }
              // ①(修正) 子文件夹里的 .mpkg（无 project.json/scene.pkg/html 的纯 mpkg 收藏夹，
              // 如 wallpaperE 下的角色文件夹）→ 每个 mpkg 独立成条（folderMpkg）
              if ((!type || !media) && e.isDirectory()) {
                let mpkgs = [];
                try { mpkgs = readdirSync(sub).filter((x) => x.toLowerCase().endsWith('.mpkg')); } catch {}
                if (mpkgs.length) {
                  for (const m of mpkgs) {
                    files.push({ name: f, title: m, type: 'mpkg', media: m, folder: true, folderMpkg: true, preview: null });
                  }
                  continue;
                }
              }
              if (type && media) {
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
                files.push({ name: f, title: title || f, type, media, preview: pv, folder: true, webHeavy, webExternal });
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
      if (n.endsWith('.ogg')) return 'audio/ogg';
      if (n.endsWith('.wav')) return 'audio/wav';
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
    const serveRange = (req, res, filePath, mime) => {
      const st = statSync(filePath);
      const r = req.headers.range;
      if (r) {
        const m = /bytes=(\d*)-(\d*)/.exec(r);
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
          const base = resolve(join(customDir, folder));
          const target = resolve(join(base, file));
          // 防穿越：目标必须在子目录内
          if (target !== base && !target.startsWith(base + sep)) { json(res, 403, { ok: false, error: 'forbidden' }); return; }
          if (!existsSync(target) || !statSync(target).isFile()) { json(res, 404, { ok: false, error: 'not found' }); return; }
          serveRange(req, res, target, FOLDER_MIME(file));
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
          const base = resolve(rec.dir);
          const target = resolve(join(base, file));
          if (target !== base && !target.startsWith(base + sep)) { json(res, 403, { ok: false, error: 'forbidden' }); return; }
          if (!existsSync(target) || !statSync(target).isFile()) { json(res, 404, { ok: false, error: 'not found' }); return; }
          serveRange(req, res, target, FOLDER_MIME(file));
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
      try {
        const v = ensureSceneVideo(dir);
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
                const ltoken = crypto.randomBytes(8).toString('hex');
                library.set(ltoken, { dir: p, type, title: meta.title || dir, media, preview: join(p, 'preview.jpg') });
                wallpapers.push({ title: meta.title || dir, type, ltoken, preview: join(p, 'preview.jpg'), media, webHeavy, webExternal });
              } catch { /* skip */ }
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
          // ②(fix) 用户实测：60fps 源 + fpsCap=60 仍走重编码 → 白屏（Android 单线程
          // 转 4K 100s 极慢），切回无限制时后台 ffmpeg 还在跑 → 卡。
          // 先探测源 fps/分辨率：`fps >= 源fps 且 maxW(或 0=不限制) >= 源宽` →
          // 上限没低于源规格 → **无需转码，直接 serveRange 原片**（零延迟）。
          const probe = probeVideoSource(src);
          if (probe && fps >= probe.fps && (maxW === 0 || maxW >= probe.width)) {
            if (src.type === 'file') {
              serveRange(req, res, src.path, 'video/mp4');
              return;
            }
            // mpkg 容器内条目：materialize 提取临时文件 serveRange，流结束后清理
            try {
              const mat = materializeSource(src, transcodeCacheDir());
              const orig = mat.file;
              const origCleanup = mat.cleanup;
              const origRes = res;
              origRes.on('close', () => { try { if (origCleanup) origCleanup(); } catch {} });
              serveRange(req, res, orig, 'video/mp4');
              return;
            } catch (err) {
              // materialize 失败 → 落回转码路径（或 404）
            }
          }
          let out = null;
          let transcodeErr = null;
          // ②(fix) 客户端断开（切回无限制/换壁纸/关页）→ 取消进行中的转码：
          // 否则后台 ffmpeg 继续跑满 CPU（用户实测"60 帧停留后切无限制特别卡"）。
          // 默认 MAX_ACTIVE=1 时同时只有一个 ffmpeg，kill 全部活动进程安全；
          // MAX_ACTIVE>1 时仅 kill 本请求启动的（通过任务级 proc 标记，见下）。
          let reqAborted = false;
          const onAbort = () => { reqAborted = true; try { for (const proc of ACTIVE_FFMPEG) { try { proc.kill(); } catch {} } } catch {} };
          res.on('close', () => { if (!out) onAbort(); });
          req.on('aborted', onAbort);
          try { out = await transcodeToFps(src, fps, maxW); } catch (err) { transcodeErr = err; } /* 转码失败 → 回退原片 */
          if (reqAborted) return; // 客户端已断开，不再写响应
          if (!out) {
            json(res, 502, { ok: false, error: String(transcodeErr && transcodeErr.message || transcodeErr || 'transcode failed') });
            return;
          }
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
