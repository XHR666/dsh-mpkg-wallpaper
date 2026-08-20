// dsh-mpkg-wallpaper —— 宿主端（hybrid 模式：大文件流式上传 + Range 播放 + Steam 自动发现）
// 纯客户端逻辑仍在 ./client.js。本文件提供：
//   GET  /api/mpkg-wallpaper/ping                → { ok:true }（客户端探测 host 是否可用）
//   POST /api/mpkg-wallpaper/upload              → 流式接收 mpkg → 存磁盘 → 返回条目索引
//   GET  /api/mpkg-wallpaper/media?token=&index= → Range 流式返回 mpkg 内某个条目
//   GET  /api/mpkg-wallpaper/steam-inventory     → (Windows) 自动发现壁纸引擎安装与壁纸列表
import { createWriteStream, createReadStream, mkdirSync, existsSync, statSync, readFileSync, readdirSync, writeFileSync, openSync, readSync, closeSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
// tmpdir 不再使用（持久目录用 DATA_DIR）
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
// ①(新) scene.pkg 静态帧提取（MIT，来自 elysia395/dsh-wallpaper-engine，见文件头署名）
// ①(新) 图层合成清单/图层提取（route B v1：canvas 动态渲染）
import { extractSceneMainImage, extractSceneMainImageFromDir, extractSceneManifest, extractSceneLayer } from './pkg-extract.js';

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
const DATA_DIR = join(process.env.DSH_HOME || process.env.HOME || '.', '.dsh-mpkg-wallpaper');

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

/** ③ 自动发现：定位壁纸引擎安装目录（Steam libraryfolders.vdf + 常见路径探测）。 */
function locateWallpaperEngine() {
  const probes = [];
  const reg = steamPathFromRegistry();
  if (reg) probes.push(reg);
  probes.push(...STEAM_PROBE_DIRS);
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
        const head = readFileSync(path).subarray(0, HEAD_BYTES);
        const { dataStart, entries } = parseMpkgHead(head);
        files.set(token, { path, size: statSync(path).size, dataStart, entries });
      } catch { /* 跳过损坏文件 */ }
    }
  } catch { /* 忽略 */ }
}

function apply(ctx) {
  restoreFiles();
  restoreCustomDir();
  const webServer = ctx.webServer;
  if (!webServer || typeof webServer.register !== 'function') return;
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
        json(res, 200, { ok: true, version });
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
          let head = Buffer.alloc(0);
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (head.length < HEAD_BYTES) head = Buffer.concat([head, chunk]);
            if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
          }
          await new Promise((r) => { out.end(r); });
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
          if (!rec || !rec.entries[idx]) { json(res, 404, { ok: false, error: 'not found' }); return; }
          const entry = rec.entries[idx];
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
            createReadStream(rec.path, { start: s, end: e }).pipe(res);
          } else {
            res.writeHead(200, { 'content-type': mime, 'accept-ranges': 'bytes', 'content-length': entry.size });
            createReadStream(rec.path, { start, end }).pipe(res);
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
          const client = await fetchRaw('lib/client.js');
          const index = await fetchRaw('lib/index.js');
          if (!client.includes('dsh-mpkg-wallpaper') || !index.includes('dsh-mpkg-wallpaper')) { json(res, 400, { ok: false, error: 'invalid payload' }); return; }
          writeFileSync(new URL('./client.js', dir), client, 'utf8');
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
          // 而不是直接开根目录（用户反馈打开的是安卓根目录、看不到自己环境）
          const base = p || (process.platform === 'win32' ? 'C:\\' : (process.env.HOME || '/'));
          if (!existsSync(base) || !statSync(base).isDirectory()) { json(res, 400, { ok: false, error: 'invalid dir' }); return; }
          const subdirs = readdirSync(base, { withFileTypes: true })
            .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
            .map((d) => d.name);
          json(res, 200, { ok: true, dir: base, subdirs, home: process.env.HOME || '/', platform: process.platform });
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
              if (type && media) {
                const pv = pickPreview(sub);
                files.push({ name: f, title: title || f, type, media, preview: pv, folder: true });
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
          if (!file || file.includes('..') || file.includes('/') || file.includes('\\')) { json(res, 403, { ok: false, error: 'forbidden' }); return; }
          const filePath = join(customDir, file);
          if (!existsSync(filePath) || !file.toLowerCase().endsWith('.mpkg')) { json(res, 404, { ok: false, error: 'not found' }); return; }
          const head = readFileSync(filePath).subarray(0, HEAD_BYTES);
          const { dataStart, entries } = parseMpkgHead(head);
          const token = crypto.randomBytes(16).toString('hex');
          files.set(token, { path: filePath, size: statSync(filePath).size, dataStart, entries });
          // ④(修正) 选素材：preview 图片 > 独立 mp4 > 视频纹理 tex（含 ftyp）
          const vid = entries.findIndex((e) => /\.(mp4|webm|mov)$/i.test(e.name));
          const img = entries.findIndex((e) => /\.(gif|png|jpe?g|webp)$/i.test(e.name));
          let sel = vid >= 0 ? { index: vid, name: entries[vid].name, isMp4: true }
            : img >= 0 ? { index: img, name: entries[img].name, isMp4: false }
            : null;
          if (sel === null) {
            // ④(新) 场景壁纸（无 preview/mp4）→ 尝试视频纹理 tex（内嵌 mp4）
            const whole = readFileSync(filePath);
            for (let i = 0; i < entries.length; i++) {
              const e = entries[i];
              if (!e.name.endsWith('.tex') || e.size < 1024 * 1024) continue;
              if (/蓝幕|绿幕|bluescreen|greenscreen|chroma|keying|抠像|入场|intro|entry/i.test(e.name)) continue;
              const seg = whole.subarray(dataStart + e.index, dataStart + e.index + 65536);
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
          if (!file || file.includes('..') || file.includes('/') || file.includes('\\')) { json(res, 403, { ok: false, error: 'forbidden' }); return; }
          const filePath = join(customDir, file);
          if (!existsSync(filePath) || !file.toLowerCase().endsWith('.mpkg')) { json(res, 404, { ok: false, error: 'not found' }); return; }
          // ①(新) 缓存：mtime 未变 → 直接返回缓存 bytes（不再解析头部/打开大文件）
          const st = statSync(filePath);
          const cached = mpkgPreviewGet(file);
          if (cached && cached.mtimeMs === st.mtimeMs && cached.bytes) {
            res.writeHead(200, { 'content-type': cached.mime, 'content-length': cached.bytes.length, 'cache-control': 'no-cache' });
            res.end(cached.bytes);
            return;
          }
          const head = readFileSync(filePath).subarray(0, HEAD_BYTES);
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
            mpkgPreviewSet(file, { mtimeMs: st.mtimeMs, mime, bytes: buf });
            res.writeHead(200, { 'content-type': mime, 'content-length': buf.length, 'cache-control': 'no-cache' });
            res.end(buf);
            return;
          }
          // 超大 preview：流式读（不缓存）
          res.writeHead(200, { 'content-type': mime, 'content-length': e.size, 'cache-control': 'no-cache' });
          createReadStream(filePath, { start: dataStart + e.index, end: dataStart + e.index + e.size - 1 }).pipe(res);
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
            createReadStream(filePath, { start: s, end: e }).pipe(res);
          } else {
            res.writeHead(200, { 'content-type': mime, 'accept-ranges': 'bytes', 'content-length': st.size });
            createReadStream(filePath).pipe(res);
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
        createReadStream(filePath, { start: s, end: e }).pipe(res);
      } else {
        res.writeHead(200, { 'content-type': mime, 'accept-ranges': 'bytes', 'content-length': st.size });
        createReadStream(filePath).pipe(res);
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
          createReadStream(pv).pipe(res);
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

    // ①(新) 场景图层合成（route B v1）：解析 scene.json 全部 image 图层 →
    // 输出清单（图层纹理 URL + 几何 + 视差）。浏览器 canvas 合成渲染（动态）。
    const readPkgBuf = (dir) => {
      const pkgPath = join(dir, 'scene.pkg');
      if (!existsSync(pkgPath)) return null;
      return { pkgPath, st: statSync(pkgPath), buf: new Uint8Array(readFileSync(pkgPath)) };
    };
    const manifestCache = new Map(); // key=scene.pkg path → { mtimeMs, manifest }
    const layerCache = new Map();    // key=path#texPath → { mtimeMs, mime, bytes }
    const MANIFEST_CACHE_MAX = 64;
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
          const pk = readPkgBuf(dir);
          if (!pk) { json(res, 404, { ok: false, error: 'no scene.pkg' }); return; }
          const cached = manifestCache.get(pk.pkgPath);
          let man = cached && cached.mtimeMs === pk.st.mtimeMs ? cached.manifest : null;
          if (!man) {
            try { man = extractSceneManifest(pk.buf); } catch (err) { json(res, 404, { ok: false, error: String(err && err.message || 'no layers') }); return; }
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
          const pk = readPkgBuf(dir);
          if (!pk) { json(res, 404, { ok: false, error: 'no scene.pkg' }); return; }
          const key = pk.pkgPath + '#' + name;
          const cached = layerCache.get(key);
          if (cached && cached.mtimeMs === pk.st.mtimeMs) {
            res.writeHead(200, { 'content-type': cached.mime, 'content-length': cached.bytes.length, 'cache-control': 'no-cache' });
            res.end(cached.bytes);
            return;
          }
          const r = extractSceneLayer(pk.buf, name);
          layerCache.set(key, { mtimeMs: pk.st.mtimeMs, mime: r.mime, bytes: r.bytes });
          if (layerCache.size > 256) { const k = layerCache.keys().next().value; layerCache.delete(k); }
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
          const pk = readPkgBuf(dir);
          if (!pk) { json(res, 404, { ok: false, error: 'no scene.pkg' }); return; }
          const cached = manifestCache.get(pk.pkgPath);
          let man = cached && cached.mtimeMs === pk.st.mtimeMs ? cached.manifest : null;
          if (!man) {
            try { man = extractSceneManifest(pk.buf); } catch (err) { json(res, 404, { ok: false, error: String(err && err.message || 'no layers') }); return; }
            manifestCache.set(pk.pkgPath, { mtimeMs: pk.st.mtimeMs, manifest: man });
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
          const pk = readPkgBuf(dir);
          if (!pk) { json(res, 404, { ok: false, error: 'no scene.pkg' }); return; }
          const key = pk.pkgPath + '#' + name;
          const cached = layerCache.get(key);
          if (cached && cached.mtimeMs === pk.st.mtimeMs) {
            res.writeHead(200, { 'content-type': cached.mime, 'content-length': cached.bytes.length, 'cache-control': 'no-cache' });
            res.end(cached.bytes);
            return;
          }
          const r = extractSceneLayer(pk.buf, name);
          layerCache.set(key, { mtimeMs: pk.st.mtimeMs, mime: r.mime, bytes: r.bytes });
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
            createReadStream(filePath, { start: s, end: e }).pipe(res);
          } else {
            res.writeHead(200, { 'content-type': mime, 'accept-ranges': 'bytes', 'content-length': st.size });
            createReadStream(filePath).pipe(res);
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
            for (const dir of readdirSync(root)) {
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
                if (type === 'video') {
                  const v = readdirSync(p).find((f) => /\.(mp4|webm|mov)$/i.test(f));
                  if (v) media = join(p, v);
                } else if (type === 'web') {
                  const h = readdirSync(p).find((f) => /\.(html?|htm)$/i.test(f));
                  if (h) media = join(p, h);
                }
                const ltoken = crypto.randomBytes(8).toString('hex');
                library.set(ltoken, { dir: p, type, title: meta.title || dir, media, preview: join(p, 'preview.jpg') });
                wallpapers.push({ title: meta.title || dir, type, ltoken, preview: join(p, 'preview.jpg'), media });
              } catch { /* skip */ }
            }
          };
          for (const root of projectsRoots) scan(root);
          json(res, 200, { ok: true, installDir, wallpapers });
        } catch (err) {
          json(res, 500, { ok: false, error: String(err && err.message || err) });
        }
      },
    });
  }
}

export { apply };
