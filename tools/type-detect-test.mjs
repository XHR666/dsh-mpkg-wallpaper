#!/usr/bin/env node
// tools/type-detect-test.mjs —— 「壁纸类型判定」离线判据（信号 × 现状 × 应然）
//
// 来历（用户点名场景）：**包含 mp4 的 scene 壁纸的 MPKG 形式，会不会被只识别成 MP4、丢掉 scene 效果？**
//   本机语料实测（`<工作区>/allwallpaper/**`，206 个容器）：
//     · 容器级（根级单文件 .mpkg/.pkg 或已成条的 folderMpkg）：客户端 `applyCustomMpkg` 有
//       「容器内有 scene.json ⇒ 交渲染器 `?pkgurl=`」这道闸门 ⇒ **不丢**（真包 `佩丽卡1_02.mpkg`：
//       scene.json 23 层 + 效果链 + `wallpaper.mp4`，实测判成 scene）。
//     · **目录级**（`/custom-dir` 的子目录判定）曾经错判两类，且都真机可复现：
//       ① `signals.scene` 的第三顺位是**任意 `*.pkg|*.mpkg`** ⇒ "是容器就是场景"；
//       ② 逐容器拆条（folderMpkg）被 `!det.signals.video` 关掉 ⇒ 目录里只要有一个**松散视频**，
//          整个角色收藏夹塌成 **1 条 `scene`**，media 还是 `files.find(ANY_PKG_RE)` 随手挑中的
//          那个容器（真包 `wallpaperE/伊蕾娜`：挑中的 `伊蕾娜1_8.mpkg` 里**没有** scene.json、
//          只有 `File0001.mp4`）⇒ 其余 4 个容器（含真场景）全部不可达；点"使用"走 scene-video
//          快路径时探测到的是那条**与该容器无关的松散视频** ⇒ 用户看到的就是"只剩视频"。
//   修法：`lib/index.js` 的 `/custom-dir` —— 容器逐条拆（只看**直接子项**）+ 「唯一的 scene 信号
//   是容器」时按**容器内容**定档；回退口 `typedetect=legacy` / `DSH_WE_TYPEDETECT=legacy`。
//   判定表 / 实测对照 / 回退口：`docs/TYPE-DETECT.md`。
//
// 判据分组：
//   A 合成夹具（恒跑，< 1s）：判定表逐行 —— 有 scene.json / 有 scene.pkg 条目 / 有 mp4 条目 /
//     `project.json.type` 的值 / 有 web 入口 / 只有图片 / 声明与内容不符 / 坏容器 / 符号链接容器。
//   B 真机语料（`<工作区>/allwallpaper` 存在才跑，缺失 ⊘ SKIP）：**7 个"同时有 scene 与 mp4"
//     的真包**逐项打印"实际档 vs 应然档"；含"容器里有 scene.json + 独立 mp4"的 MPKG 形式
//     （用户点名）与 `scene.pkg` + 内嵌视频纹理的场景包。
//   C 客户端半边（真 `lib/client.js` + `tools/_stub.mjs`）：`__mpwLifecycleTest.sourceFieldsFor` /
//     `pickMount` 的档位映射 + **点击链的分流顺序**（源码级：容器内有 scene.json 的判定必须在
//     视频纹理之前；scene 目录必须先试渲染器、再走 scene-video 快路径）。
//   D 回退口：`typedetect=legacy` 请求体 与 `DSH_WE_TYPEDETECT=legacy` 环境变量都必须回到旧判据。
//   E 变异必红（子进程，`--lib <变异副本>`）：把新判据去掉 ⇒ 本文件的对应断言**必须变红**。
//
// 纪律：不跑浏览器 / 不跑 ffmpeg / 不读大视频（容器只读目录表 + 每个大 .tex 只读 64KB 前缀）；
//   夹具全部 mkdtemp 合成（< 4MB），exit 兜底清理；真 HTTP 打**真 lib/index.js 注册的**路由。
// 用法: node tools/type-detect-test.mjs
//       node tools/type-detect-test.mjs --lib <lib 目录>     # 变异自证用（默认 ../lib）
//       MPW_CORPUS=<目录> node tools/type-detect-test.mjs    # 指定语料根（默认 <仓>/../allwallpaper）
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const argOf = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const LIB_DIR = path.resolve(argOf('--lib', path.join(repoRoot, 'lib')));
const MUTATION = String(argOf('--mutation', ''));
const NO_MUTATIONS = process.argv.includes('--no-mutations');
const WS = path.resolve(repoRoot, '..');
const CORPUS = process.env.MPW_CORPUS ? path.resolve(process.env.MPW_CORPUS) : path.join(WS, 'allwallpaper');
const BASE = '/api/mpkg-wallpaper';

let pass = 0, fail = 0, skip = 0;
/* ①(本仓教训) 条件放**第一位**：`ok(name, detail)` 恒真 = 假绿（scene-video-test 的历史 bug）。 */
const ok = (cond, name, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')); }
  else { fail++; console.error('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
};
const sk = (name) => { skip++; console.log('  ⊘ SKIP ' + name); };

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-typedetect-'));
const cleanup = () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 忽略 */ } };
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanup(); process.exit(130); });
fs.mkdirSync(path.join(TMP, 'home'), { recursive: true });
process.env.DSH_HOME = path.join(TMP, 'home');

/* ═══════════ 夹具：PKG 容器族（`PKG[VM]####`）的目录表布局 ═══════════
   header: [u32 magicLen][magic][u32 count]
   entry : [u32 nameLen][name][u32 offset][u32 size]   （offset 相对目录表末尾）
   数据紧随目录表之后。布局与 lib/pkg-extract.js parsePkg / lib/index.js parseMpkgHead 同源。 */
function buildPkg(magic, files) {
  const mb = Buffer.from(magic, 'latin1');
  const heads = [];
  let off = 0;
  for (const [name, data] of files) {
    const nb = Buffer.from(name, 'utf8');
    const h = Buffer.alloc(4 + nb.length + 8);
    h.writeUInt32LE(nb.length, 0);
    nb.copy(h, 4);
    h.writeUInt32LE(off, 4 + nb.length);
    h.writeUInt32LE(data.length, 4 + nb.length + 4);
    heads.push(h);
    off += data.length;
  }
  const table = Buffer.concat(heads);
  const head = Buffer.alloc(4 + mb.length + 4);
  head.writeUInt32LE(mb.length, 0);
  mb.copy(head, 4);
  head.writeUInt32LE(files.length, 4 + mb.length);
  return Buffer.concat([head, table, ...files.map(([, d]) => d)]);
}
const J = (o) => Buffer.from(JSON.stringify(o), 'utf8');
const GIF = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(40, 7)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 9)]);
/** 真·场景清单（层 + 效果链；字段名取自真包 scene.json，值自造） */
const SCENE_JSON = J({
  camera: { center: '0 0 -1', eye: '0 0 0', up: '0 1 0' },
  general: { bloom: false, clearcolor: '0.7 0.7 0.7' },
  objects: [
    { name: 'bg', image: 'models/bg.json', origin: '1920 1080 0', size: '3840 2160 0', effects: [{ name: 'waterwaves', file: 'effects/waterwaves/effect.json' }] },
    { name: 'girl', image: 'models/girl.json', origin: '1920 1080 0', size: '3840 2160 0', effects: [{ file: 'effects/blurprecise/effect.json' }] },
  ],
  version: 1,
});
const MODEL_JSON = J({ material: 'materials/bg.json', puppets: [] });
const EFFECT_JSON = J({ name: 'waterwaves', passes: [] });
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom', 'latin1'), Buffer.alloc(4000, 0x21)]);
/** ≥1MiB 的 .tex，前缀里有 `ftyp`（与宿主 /custom-mpkg 的 64KB 扫描口径同源） */
function videoTex(name) {
  const b = Buffer.alloc(1200 * 1024, 0x33);
  b.write('TEXV0005', 0, 'latin1');
  b.write('ftypisom', 64, 'latin1');
  return [name, b];
}
/** 只有 scene 的容器（层 + 效果链，无 mp4） */
const pkgSceneOnly = (magic) => buildPkg(magic, [
  ['preview.gif', GIF], ['project.json', J({ title: 'scene-only', type: 'scene', file: 'scene.json' })],
  ['scene.json', SCENE_JSON], ['models/bg.json', MODEL_JSON], ['effects/waterwaves/effect.json', EFFECT_JSON],
]);
/** ①(用户点名) 容器里**同时有 scene 数据与内嵌 mp4**：project.json.file 指向 mp4，scene.json 是层/效果链，
    且**没有任何层引用那个 mp4**（真包 佩丽卡1_02 / 伊蕾娜_08 正是这个形状）。 */
const pkgScenePlusMp4 = (magic) => buildPkg(magic, [
  ['preview.jpg', JPG], ['project.json', J({ title: 'scene+mp4', type: 'Scene', file: 'wallpaper.mp4' })],
  ['scene.json', SCENE_JSON], ['models/girl.json', MODEL_JSON], ['effects/blurprecise/effect.json', EFFECT_JSON],
  ['wallpaper.mp4', MP4],
]);
/** 纯视频容器：project.json.type=video + 独立 mp4，**没有** scene.json（真包 伊蕾娜1_8 / 芙宁娜…） */
const pkgVideoOnly = (magic) => buildPkg(magic, [
  ['preview.gif', GIF], ['project.json', J({ title: 'video-only', type: 'video', file: 'v.mp4' })], ['v.mp4', MP4],
]);
/** 视频纹理容器：没有独立 mp4，只有一个内嵌 mp4 的 .tex（真机 video 类壁纸的另一种形状） */
const pkgVideoTexOnly = (magic) => buildPkg(magic, [
  ['preview.gif', GIF], ['project.json', J({ title: 'video-tex', type: 'video' })], videoTex('materials/anim.tex'),
]);
/** 声明与内容不符：声明 video，实际有 scene.json（内容优先 ⇒ 应判 scene） */
const pkgDeclaredVideoButScene = (magic) => buildPkg(magic, [
  ['preview.gif', GIF], ['project.json', J({ title: 'lying', type: 'video', file: 'x.mp4' })], ['scene.json', SCENE_JSON],
]);
/** 声明与内容不符：声明 scene，实际只有 mp4（内容优先 ⇒ 应判 video，**不许**挂在渲染器上变慢/黑屏） */
const pkgDeclaredSceneButVideo = (magic) => buildPkg(magic, [
  ['preview.gif', GIF], ['project.json', J({ title: 'lying2', type: 'scene', file: 'x.mp4' })], ['x.mp4', MP4],
]);
const BAD_PKG = Buffer.concat([Buffer.from('not-a-pkg-at-all-', 'latin1'), Buffer.alloc(256, 0x5a)]);

/* ═══════════ 夹具目录树 ═══════════ */
const FX = path.join(TMP, 'lib');
const mk = (rel, buf) => { const p = path.join(FX, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, buf); return p; };
// 根级单文件（客户端按容器的 mpkg 档处理；这里只钉"进清单且 type=mpkg"）
mk('loose-scene+mp4.mpkg', pkgScenePlusMp4('PKGM0014'));
mk('loose-scene.pkg', pkgSceneOnly('PKGV0022'));
mk('loose-video.mpkg', pkgVideoOnly('PKGM0014'));
// d1 官方场景目录（真·scene.pkg 文件）
mk('d1-official-scene/scene.pkg', pkgSceneOnly('PKGV0022'));
mk('d1-official-scene/project.json', J({ title: 'official', type: 'scene', file: 'scene.json' }));
mk('d1-official-scene/preview.gif', GIF);
// d2 ①(用户点名) 容器收藏夹：scene+mp4 容器 + 纯视频容器 + **松散视频**（松散视频不得否决拆条）
mk('d2-collection-scene+mp4/a-scene+mp4.mpkg', pkgScenePlusMp4('PKGM0014'));
mk('d2-collection-scene+mp4/b-video.mpkg', pkgVideoOnly('PKGM0014'));
mk('d2-collection-scene+mp4/c-scene.pkg', pkgSceneOnly('PKGV0022'));
mk('d2-collection-scene+mp4/VID_loose.mp4', MP4);
// d3 纯视频收藏夹 + 松散视频（最容易被误判成 scene 的一类）
mk('d3-collection-video/x-video.mpkg', pkgVideoOnly('PKGM0014'));
mk('d3-collection-video/y-video-tex.mpkg', pkgVideoTexOnly('PKGM0014'));
mk('d3-collection-video/loose.mp4', MP4);
// d4 网页壁纸 + 视频容器当素材（容器里没有 scene 数据 ⇒ 这目录是 web，不是 scene）
mk('d4-web+asset/index.html', Buffer.from('<html><body>hello</body></html>', 'utf8'));
mk('d4-web+asset/project.json', J({ title: 'web', type: 'web', file: 'index.html' }));
mk('d4-web+asset/model.mpkg', pkgVideoOnly('PKGM0014'));
// d5 网页壁纸 + **真场景**容器（内容优先：scene 赢，旧口径如此，保持）
mk('d5-web+scene/index.html', Buffer.from('<html><body>hello</body></html>', 'utf8'));
mk('d5-web+scene/real-scene.mpkg', pkgSceneOnly('PKGM0014'));
// d6/d7 纯 web / 纯 video
mk('d6-web/index.html', Buffer.from('<html><body>only web</body></html>', 'utf8'));
mk('d7-video/movie.mp4', MP4);
// d8 只有图片的**子目录**（既有口径：子目录只认 web/video/scene ⇒ unknown 不进清单；图片走根级文件）
mk('d8-image-only/pic.png', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(64, 3)]));
// d9/d10 声明与内容不符（两个方向；容器收藏夹里的条目）
mk('d9-lying/declared-video-but-scene.mpkg', pkgDeclaredVideoButScene('PKGM0014'));
mk('d10-lying/declared-scene-but-video.mpkg', pkgDeclaredSceneButVideo('PKGM0014'));
// d11 坏容器（乱字节）拆条不依赖内容；d11b 网页目录 + 坏容器 ⇒ 探测失败必须**保持旧口径**（不猜）
mk('d11-broken/broken.pkg', BAD_PKG);
mk('d11b-web+broken/index.html', Buffer.from('<html><body>x</body></html>', 'utf8'));
mk('d11b-web+broken/broken.pkg', BAD_PKG);
// d12 符号链接容器（真机语料 wallpaperE/佩丽卡/佩丽卡1_01.mpkg 就是符号链接：
//     Dirent.isFile() 对它恒 false ⇒ 旧 listWallpaperFiles 会**静默漏掉**这一条）
let symlinkOk = true;
try {
  fs.mkdirSync(path.join(FX, 'd12-symlink'), { recursive: true });
  fs.writeFileSync(path.join(FX, 'd12-symlink', '.target-scene+mp4.mpkg'), pkgScenePlusMp4('PKGM0014'));
  fs.symlinkSync(path.join(FX, 'd12-symlink', '.target-scene+mp4.mpkg'), path.join(FX, 'd12-symlink', 'linked.mpkg'));
  // d13 整目录全靠软链（= 本机 f2fs 上 d_type 误报的等价形状）：三件套都要能被递归表看见
  fs.mkdirSync(path.join(FX, 'd13-symlink-scene'), { recursive: true });
  for (const n of ['scene.pkg', 'project.json', 'preview.gif']) {
    fs.symlinkSync(path.join(FX, 'd1-official-scene', n), path.join(FX, 'd13-symlink-scene', n));
  }
} catch { symlinkOk = false; }

/* ═══════════ 假宿主：挂真 lib/index.js 注册的路由 ═══════════ */
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
async function bootHost(libDir, env) {
  for (const [k, v] of Object.entries(env || {})) process.env[k] = String(v);
  const mod = await import(pathToFileURL(path.join(libDir, 'index.js')).href + '?t=' + Date.now() + '-' + Math.random());
  const routes = new Map();
  mod.apply({ webServer: { register: (r) => { routes.set(r.path, r); return { dispose() {} }; } }, loader: null, logger: { info() {}, warn() {}, error() {} } });
  const port = await freePort();
  const server = http.createServer((req, res) => {
    let url = null;
    try { url = new URL(req.url, 'http://127.0.0.1'); } catch { res.writeHead(400); return res.end('bad'); }
    const r = routes.get(url.pathname);
    if (!r) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"ok":false,"error":"no route"}'); }
    try { Promise.resolve(r.handler(req, res, url)).catch((e) => { try { res.writeHead(500); res.end(String(e && e.message || e)); } catch { /* 已响应 */ } }); } catch (e) { try { res.writeHead(500); res.end(String(e && e.message || e)); } catch { /* 已响应 */ } }
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { mod, base: 'http://127.0.0.1:' + port, stop: () => new Promise((r) => server.close(r)) };
}
function reqJson(base, method, p, body) {
  return new Promise((resolve) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const port = Number(new URL(base).port);
    const rq = http.request({ host: '127.0.0.1', port, method, path: p, headers: payload ? { 'content-length': payload.length, 'content-type': 'application/json' } : {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const raw = Buffer.concat(chunks); let json = null; try { json = JSON.parse(raw.toString('utf8')); } catch { /* 二进制 */ } resolve({ status: res.statusCode, json, raw, headers: res.headers }); });
    });
    rq.on('error', (e) => resolve({ status: 0, json: null, raw: Buffer.alloc(0), err: String(e && e.code || e.message) }));
    rq.setTimeout(60000, () => { try { rq.destroy(new Error('timeout')); } catch { /* 已断 */ } });
    if (payload) rq.write(payload);
    rq.end();
  });
}
const scan = (base, dir, typedetect) => reqJson(base, 'POST', BASE + '/custom-dir', typedetect ? { dir, typedetect } : { dir });
const folderEntries = (files, folder) => (files || []).filter((f) => f.name === folder);
const entryOf = (files, folder, media) => (files || []).find((f) => f.name === folder && (media === undefined || f.media === media));

/* ── 容器内容真值（**真实现**：lib/index.js 的 readMpkgHeadGrow + 与 /custom-mpkg 同口径的 64KB ftyp 扫描） ── */
let readMpkgHeadGrowImpl = null;
function containerTruth(file) {
  const out = { ok: false, error: null, entries: 0, hasSceneJson: false, nestedScenePkg: false, hasScene: false, mp4: [], videoTex: [], html: [], image: [], declaredType: null };
  let head = null;
  try { head = readMpkgHeadGrowImpl(file); } catch (e) { out.error = String(e && e.message || e).slice(0, 80); return out; }
  out.ok = true;
  out.entries = head.entries.length;
  for (const e of head.entries) {
    const n = String(e.name || '');
    if (/(^|\/)scene\.json$/i.test(n)) { out.hasSceneJson = true; out.hasScene = true; }
    if (/(^|\/)scene\.pkg$/i.test(n)) { out.nestedScenePkg = true; out.hasScene = true; }
    if (/\.(mp4|webm|mov|m4v|mkv)$/i.test(n)) out.mp4.push(n);
    if (/\.(x?html?)$/i.test(n)) out.html.push(n);
    if (/\.(gif|png|jpe?g|webp)$/i.test(n)) out.image.push(n);
  }
  // 视频纹理：≥1MiB 的 .tex + 排除抠像/入场（与宿主 /custom-mpkg 的选素材排除项逐项一致）
  for (const e of head.entries) {
    const n = String(e.name || '');
    if (!n.endsWith('.tex') || e.size < 1024 * 1024) continue;
    if (/蓝幕|绿幕|bluescreen|greenscreen|chroma|keying|抠像|入场|intro|entry/i.test(n)) continue;
    let fd = null;
    try {
      fd = fs.openSync(file, 'r');
      const seg = Buffer.alloc(Math.min(65536, e.size));
      const got = fs.readSync(fd, seg, 0, seg.length, head.dataStart + e.index);
      if (seg.subarray(0, got).indexOf(Buffer.from('ftyp')) >= 4) out.videoTex.push(n);
    } catch { /* 读不到就当不是 */ } finally { if (fd !== null) { try { fs.closeSync(fd); } catch { /* 忽略 */ } } }
  }
  try {
    const pj = head.entries.find((e) => e.name === 'project.json');
    if (pj && pj.size > 0 && pj.size < 1 << 20) {
      const fd = fs.openSync(file, 'r');
      const b = Buffer.alloc(pj.size);
      fs.readSync(fd, b, 0, pj.size, head.dataStart + pj.index);
      fs.closeSync(fd);
      const j = JSON.parse(b.toString('utf8'));
      out.declaredType = String((j.general && j.general.type) || j.type || '');
    }
  } catch { /* 声明只是线索 */ }
  return out;
}
/** 应然档（"不丢效果"准则；顺序即规格，与 docs/TYPE-DETECT.md §1 判定表逐行对应）：
 *  scene 数据（scene.json / 嵌套 scene.pkg / 目录里的真 scene.pkg）⇒ scene；否则 mp4/视频纹理 ⇒ video；
 *  再否则 web 入口 ⇒ web；再否则图片 ⇒ image。 */
function expectedTier(sig) {
  if (sig.hasScene) return 'scene';
  if ((sig.mp4 && sig.mp4.length) || (sig.videoTex && sig.videoTex.length)) return 'video';
  if (sig.html && sig.html.length) return 'web';
  if (sig.image && sig.image.length) return 'image';
  return 'none';
}
/** 「实际档」：目录条目的 type +（容器条目时）容器内容 ⇒ 客户端点击后真正挂什么。
 *  · type='scene' ⇒ scene（真 scene.pkg/scene.json 或"有场景数据的容器"交给渲染器）
 *  · type='mpkg'  ⇒ 客户端 applyCustomMpkg 按容器内容分流（scene.json → 渲染器，否则 mp4/预览）
 *  · type='video'/'web'/'image' ⇒ 对应档 */
function actualTier(entry, sig) {
  const t = String((entry && entry.type) || '');
  if (t === 'scene') return 'scene';
  if (t === 'mpkg') return sig ? (sig.hasScene ? 'scene' : 'video') : '?';
  if (t === 'video') return 'video';
  if (t === 'web') return 'web';
  if (t === 'image') return 'image';
  return t || '?';
}

/* ═══════════ A 段：判定表（合成夹具） ═══════════ */
console.log('══ A 判定表（合成夹具；信号 × 现状 × 应然）══');
const H = await bootHost(LIB_DIR);
readMpkgHeadGrowImpl = H.mod.__mpwTest.readMpkgHeadGrow;
try {
  /* ⚠ 子目录条目只有在**扫它的父目录**时才带 folder/folderMpkg/media；直接扫子目录 = 把它的文件
     当 custom dir 的根级文件（没有 media 字段）。所以下面一律从 `all` 里按 name 过滤。 */
  const all = (await scan(H.base, FX)).json.files || [];
  const colFiles = folderEntries(all, 'd2-collection-scene+mp4');
  const colVidFiles = folderEntries(all, 'd3-collection-video');

  // A1/A2 根级容器文件：进清单且按容器档（内容由 /custom-mpkg 分流）
  ok(entryOf(all, 'loose-scene+mp4.mpkg') && entryOf(all, 'loose-scene+mp4.mpkg').type === 'mpkg',
    'A1 根级 `*.mpkg`（内有 scene.json+mp4）进清单且 type=mpkg（走内容感知的容器档）',
    JSON.stringify(entryOf(all, 'loose-scene+mp4.mpkg')));
  ok(entryOf(all, 'loose-scene.pkg') && entryOf(all, 'loose-scene.pkg').type === 'mpkg',
    'A2 根级任意名 `.pkg` 也是 mpkg 档（`.pkg`/`.mpkg` 同族，G5 回归）', JSON.stringify(entryOf(all, 'loose-scene.pkg')));

  // A3 官方 scene.pkg 目录：目录本身就是场景（真·场景文件信号优先）
  const d1 = entryOf(all, 'd1-official-scene');
  ok(d1 && d1.type === 'scene' && d1.media === 'scene.pkg' && d1.kindReason === 'scene-container' && d1.folderMpkg !== true,
    'A3 目录里有 `scene.pkg` ⇒ 目录条目 type=scene / media=scene.pkg / reason=scene-container',
    JSON.stringify(d1 && { t: d1.type, m: d1.media, r: d1.kindReason }));

  // A4 ①(用户点名) 容器收藏夹：**松散视频不得否决逐容器拆条**（修复前整目录塌成 1 条 scene）
  const a4 = colFiles.filter((f) => f.folderMpkg === true);
  ok(a4.length === 3 && a4.every((f) => f.type === 'mpkg'),
    'A4 目录里有「scene+mp4 容器 + 视频容器 + 松散 mp4」⇒ **逐容器 3 条**（松散视频不再否决拆条）',
    'folderMpkg=' + a4.length + ' / 全部条目=' + colFiles.map((f) => f.type + ':' + f.media).join(','));
  ok(colFiles.length > 0 && colFiles.every((f) => f.type !== 'scene'),
    'A4b 该目录**不得**再出现"整目录 1 条 scene"（旧口径的错判形状）',
    JSON.stringify(colFiles.map((f) => ({ t: f.type, m: f.media }))));
  const a4s = entryOf(all, 'd2-collection-scene+mp4', 'a-scene+mp4.mpkg');
  const tA4s = containerTruth(path.join(FX, 'd2-collection-scene+mp4', 'a-scene+mp4.mpkg'));
  ok(tA4s.hasSceneJson === true && tA4s.mp4.length === 1,
    'A4c 该条目的容器内容真值：scene.json ✓ 且 独立 mp4 ✓（= 用户点名的"包含 mp4 的 scene 壁纸"形状）',
    JSON.stringify({ sceneJson: tA4s.hasSceneJson, mp4: tA4s.mp4, entries: tA4s.entries, declared: tA4s.declaredType }));
  ok(expectedTier(tA4s) === 'scene' && actualTier(a4s, tA4s) === 'scene',
    'A4d 应然档=scene，实际档=scene（容器里有场景数据 ⇒ 交渲染器，**不丢层与效果**）',
    '应然=' + expectedTier(tA4s) + ' 实际=' + actualTier(a4s, tA4s));
  const a4v = entryOf(all, 'd2-collection-scene+mp4', 'b-video.mpkg');
  const tA4v = containerTruth(path.join(FX, 'd2-collection-scene+mp4', 'b-video.mpkg'));
  ok(expectedTier(tA4v) === 'video' && actualTier(a4v, tA4v) === 'video',
    'A4e 同目录的**纯视频容器**：应然=video、实际=video（不许因为"是容器"判成 scene ⇒ 也就不会变慢/黑屏）',
    '应然=' + expectedTier(tA4v) + ' 实际=' + actualTier(a4v, tA4v) + ' mp4=' + tA4v.mp4.join(','));
  const a4p = entryOf(all, 'd2-collection-scene+mp4', 'c-scene.pkg');
  ok(a4p && a4p.type === 'mpkg' && containerTruth(path.join(FX, 'd2-collection-scene+mp4', 'c-scene.pkg')).hasSceneJson,
    'A4f 收藏夹里的**任意名 `.pkg` 场景容器**也被拆成独立条目（旧判据只看 `.mpkg`）',
    JSON.stringify({ t: a4p && a4p.type, m: a4p && a4p.media }));

  // A5 纯视频收藏夹 + 松散视频：全部按容器内容定档，一条 scene 都不许出现
  const a5ent = colVidFiles.filter((f) => f.folderMpkg === true);
  ok(a5ent.length === 2 && colVidFiles.length > 0 && colVidFiles.every((f) => f.type === 'mpkg'),
    'A5 目录里有「视频容器 + 内嵌视频纹理容器 + 松散 mp4」⇒ 逐容器 2 条、type 全 mpkg',
    colVidFiles.map((f) => f.type + ':' + f.media).join(','));
  {
    const t1 = containerTruth(path.join(FX, 'd3-collection-video', 'x-video.mpkg'));
    const t2 = containerTruth(path.join(FX, 'd3-collection-video', 'y-video-tex.mpkg'));
    ok(expectedTier(t1) === 'video' && expectedTier(t2) === 'video' && t2.videoTex.length === 1,
      'A5b 「有独立 mp4 条目」与「有内嵌 mp4 的视频纹理」两种纯视频形状的应然档都是 video',
      'mp4=' + t1.mp4.join(',') + ' / videoTex=' + t2.videoTex.join(','));
    ok(actualTier(entryOf(all, 'd3-collection-video', 'y-video-tex.mpkg'), t2) === 'video',
      'A5c 视频纹理容器（无 scene.json）实际档=video（**不许**判成 scene 去挂渲染器）',
      '实际=' + actualTier(entryOf(all, 'd3-collection-video', 'y-video-tex.mpkg'), t2));
  }

  // A6/A7 web 目录：容器有没有 scene 数据决定它是"素材"还是"场景"
  const d4 = entryOf(all, 'd4-web+asset');
  ok(d4 && d4.type === 'web' && /html/.test(String(d4.kindReason)) && d4.containerKind && d4.containerKind.hasScene === false,
    'A6 目录有 index.html + **无场景数据的容器** ⇒ type=web（旧口径会因"有容器"判成 scene）',
    JSON.stringify(d4 && { t: d4.type, m: d4.media, r: d4.kindReason, ck: d4.containerKind }));
  const d5 = entryOf(all, 'd5-web+scene');
  ok(d5 && d5.type === 'scene' && d5.kindReason === 'scene-container',
    'A7 目录有 index.html + **真场景容器** ⇒ type=scene（内容优先，scene 赢；旧口径保持）',
    JSON.stringify(d5 && { t: d5.type, m: d5.media, r: d5.kindReason }));

  // A8 纯 web / 纯 video / 纯图片（**子目录**只认 web/video/scene；图片走根级文件 —— 既有口径）
  const d6 = entryOf(all, 'd6-web'), d7 = entryOf(all, 'd7-video'), d8 = folderEntries(all, 'd8-image-only');
  ok(d6 && d6.type === 'web' && d7 && d7.type === 'video',
    'A8 纯 web / 纯 video 目录判定不变（web / video）', [d6, d7].map((x) => x && x.type).join(','));
  ok(d8.length === 0,
    'A8b 只有图片的**子目录**不进清单（既有口径：子目录只认 web/video/scene；图片走根级文件条目）',
    'd8-image-only 条目数=' + d8.length);

  // A9/A10 声明与内容不符：内容优先（两个方向都必须听话）
  const d9 = entryOf(all, 'd9-lying', 'declared-video-but-scene.mpkg');
  const d10 = entryOf(all, 'd10-lying', 'declared-scene-but-video.mpkg');
  const t9 = containerTruth(path.join(FX, 'd9-lying', 'declared-video-but-scene.mpkg'));
  const t10 = containerTruth(path.join(FX, 'd10-lying', 'declared-scene-but-video.mpkg'));
  ok(expectedTier(t9) === 'scene' && actualTier(d9, t9) === 'scene',
    'A9 声明 `type=video` 但容器里有 scene.json ⇒ 应然=scene、实际=scene（声明只作线索）',
    'declared=' + t9.declaredType + ' 应然=' + expectedTier(t9) + ' 实际=' + actualTier(d9, t9));
  ok(expectedTier(t10) === 'video' && actualTier(d10, t10) === 'video',
    'A10 声明 `type=scene` 但容器里只有 mp4 ⇒ 应然=video、实际=video（**纯 mp4 不许判成 scene**）',
    'declared=' + t10.declaredType + ' 应然=' + expectedTier(t10) + ' 实际=' + actualTier(d10, t10));

  // A11 坏容器：拆条不依赖内容（照样成条，不 500）；探测失败时**不猜**（保持旧口径）
  const d11 = folderEntries(all, 'd11-broken');
  ok(d11.length === 1 && d11[0].type === 'mpkg',
    'A11 坏容器（乱字节）照样成条（拆条不看内容）、扫描不 500',
    JSON.stringify(d11.map((f) => ({ t: f.type, m: f.media }))));
  const tBad = containerTruth(path.join(FX, 'd11-broken', 'broken.pkg'));
  const d11b = entryOf(all, 'd11b-web+broken');
  ok(tBad.ok === false && d11b && d11b.type === 'scene' && d11b.kindReason === 'scene-container'
    && d11b.containerKind && d11b.containerKind.ok === false && d11b.containerKind.hasScene === false,
    'A11b 探测失败（ok=false）⇒ **不猜**：保持旧口径（type=scene / reason=scene-container / containerKind.ok=false）',
    JSON.stringify({ probeOk: tBad.ok, t: d11b && d11b.type, r: d11b && d11b.kindReason, ck: d11b && d11b.containerKind }));

  // A12 符号链接容器（真机语料里的真形状）：不得静默漏掉
  if (symlinkOk) {
    const d12 = entryOf(all, 'd12-symlink', 'linked.mpkg');
    ok(!!d12 && d12.folderMpkg === true,
      'A12 符号链接容器进清单（`Dirent.isFile()` 对它恒 false ⇒ 旧递归表会静默漏掉这一条）',
      JSON.stringify(d12 && { t: d12.type, m: d12.media, fm: d12.folderMpkg }));
    /* A12b 递归文件表也吃同一口锅：整目录**全部**文件都是软链时，旧 `listWallpaperFiles` 得到空表
       ⇒ `detectWebWallpaperKind` 判 unknown(no-files) ⇒ 整张壁纸从清单里消失（本机 f2fs 上
       d_type 误报的等价形状：真机 dd/3715743282 等 4 张壁纸实测"两种口径下都不见了"）。 */
    const d13 = entryOf(all, 'd13-symlink-scene');
    ok(d13 && d13.type === 'scene' && d13.media === 'scene.pkg' && d13.kindReason === 'scene-container',
      'A12b 文件全靠软链的 scene 目录仍判 scene（递归表对"类型拿不准"的条目必须 stat 兜底）',
      JSON.stringify(d13 && { t: d13.type, m: d13.media, r: d13.kindReason }));
  } else { sk('A12/A12b 符号链接夹具（本文件系统不支持 symlink）'); }

  // A13 常见路径零额外读盘：拆条分支在容器内容探测**之前**（源码级，E 段变异守着）
  {
    const src = fs.readFileSync(path.join(LIB_DIR, 'index.js'), 'utf8');
    const iSplit = src.indexOf('if (!TD.legacy && containerFolder)');
    const iProbe = src.indexOf('ck = probeContainerKind(join(sub, String(media)))');
    ok(iSplit > 0 && iProbe > iSplit,
      'A13 拆条分支（containerFolder）在 probeContainerKind **之前** ⇒ 收藏夹扫描不额外读容器头',
      'split@' + iSplit + ' probe@' + iProbe);
  }

  // A14 /probe 里能看到当前判定口径（回退口可见）
  {
    const pr = await reqJson(H.base, 'GET', BASE + '/probe');
    ok(pr.json && pr.json.typeDetect && pr.json.typeDetect.mode === 'content' && !pr.json.typeDetect.legacy,
      'A14 `/probe` 如实报出判定口径（默认 content；回退时 mode=legacy）',
      JSON.stringify(pr.json && pr.json.typeDetect));
  }
} finally { await H.stop(); }

/* ═══════════ B 段：真机语料（同时有 scene 与 mp4 的真包 ≥5） ═══════════ */
console.log('\n══ B 真机语料：实际档 vs 应然档 ══');
const B = [
  { id: 'B1', root: 'wallpaperE', folder: '佩丽卡', file: '佩丽卡1_02.mpkg', want: 'scene', why: 'scene.json(23 层 + 效果链) + 独立 wallpaper.mp4；无层引用该 mp4' },
  { id: 'B2', root: 'wallpaperE', folder: '伊蕾娜', file: '伊蕾娜_08.mpkg', want: 'scene', why: '同形状；**同目录另有松散 VID_*.mp4**（旧口径整目录塌成 1 条 scene）' },
  { id: 'B3', root: 'wallpaperE', folder: '伊蕾娜', file: '伊蕾娜1_8.mpkg', want: 'video', why: '纯视频容器（无 scene.json）——对照：不许判成 scene' },
  { id: 'B4', root: 'wallpaperE', folder: '遐蝶', file: '夜莺Night——Honkai Star Rail Castorice 遐蝶 冥河永渡 崩坏星穹铁道The Etern.mpkg', want: 'scene', why: 'scene.json + 内嵌视频纹理(.tex)，无独立 mp4' },
  { id: 'B5', root: 'dd', folder: '3326873240', file: 'scene.pkg', want: 'scene', why: '官方 scene.pkg 目录 + 5 条内嵌视频纹理（目录级 scene 档）' },
  { id: 'B6', root: '0923', folder: '2887099508', file: 'scene.pkg', want: 'scene', why: '官方 scene.pkg 目录 + 1 条内嵌视频纹理' },
  { id: 'B7', root: 'wallpaperE', folder: '佩丽卡', file: '佩丽卡1_01.mpkg', want: null, why: '**符号链接**容器（旧递归表静默漏掉；档位按其容器内容）' },
];
if (!fs.existsSync(CORPUS)) {
  sk('B 真机语料（' + CORPUS + ' 不存在；用 MPW_CORPUS=<目录> 指定）');
} else {
  const HB = await bootHost(LIB_DIR);
  try {
    for (const t of B) {
      const p = path.join(CORPUS, t.root, t.folder, t.file);
      if (!fs.existsSync(p)) { sk(t.id + ' ' + t.root + '/' + t.folder + '/' + t.file); continue; }
      const sc = await scan(HB.base, path.join(CORPUS, t.root));
      const files = (sc.json && sc.json.files) || [];
      const entry = entryOf(files, t.folder, t.file) || entryOf(files, t.folder);
      if (!entry) {
        ok(false, t.id + ' ' + t.file + ' 出现在扫描清单里',
          'root=' + t.root + ' 该目录条目=' + JSON.stringify(folderEntries(files, t.folder).map((f) => f.type + ':' + f.media)));
        continue;
      }
      const sig = containerTruth(p);
      const want = t.want || expectedTier(sig);
      const got = entry.folderMpkg ? actualTier(entry, sig) : actualTier(entry, { hasScene: true });
      const selected = entry.folderMpkg
        ? (((await reqJson(HB.base, 'GET', BASE + '/custom-mpkg?folder=' + encodeURIComponent(entry.name) + '&file=' + encodeURIComponent(entry.media))).json) || {}).selected
        : null;
      ok(got === want && expectedTier(sig) === want,
        t.id + ' ' + t.file + '：实际档=' + got + ' / 应然档=' + want,
        '条目=' + entry.type + (entry.folderMpkg ? '(folderMpkg)' : '') + ' reason=' + (entry.kindReason || '-')
        + ' | 容器: scene.json=' + sig.hasSceneJson + ' 嵌套scene.pkg=' + sig.nestedScenePkg + ' mp4=' + sig.mp4.length + ' 视频纹理=' + sig.videoTex.length
        + ' 声明=' + JSON.stringify(sig.declaredType) + ' | /custom-mpkg.selected=' + (selected ? selected.name : '-'));
      console.log('      └ ' + t.why);
    }
    // B8 关键回归：受影响目录必须逐容器成条（不再整目录塌成 1 条 scene）
    {
      const s = await scan(HB.base, path.join(CORPUS, 'wallpaperE'));
      const fs2 = (s.json && s.json.files) || [];
      const yl = folderEntries(fs2, '伊蕾娜');
      const lh = folderEntries(fs2, '流萤');
      ok(yl.length >= 5 && yl.every((f) => f.type === 'mpkg' && f.folderMpkg === true),
        'B8 `伊蕾娜`（5 容器 + 松散 VID_*.mp4）⇒ 逐容器 5 条（修复前：1 条 scene，其余不可达）',
        '条目=' + yl.length + ' types=' + [...new Set(yl.map((f) => f.type))].join(','));
      ok(lh.length >= 4 && lh.every((f) => f.type === 'mpkg' && f.folderMpkg === true),
        'B8b `流萤`（4 容器 + 松散 mp4）⇒ 逐容器 4 条（修复前：1 条 scene）',
        '条目=' + lh.length + ' types=' + [...new Set(lh.map((f) => f.type))].join(','));
      const ylScene = yl.filter((f) => containerTruth(path.join(CORPUS, 'wallpaperE', '伊蕾娜', String(f.media))).hasScene);
      ok(ylScene.length >= 2,
        'B8c 收藏夹里带 scene 数据的**容器全部可达**（伊蕾娜：≥2 个真场景容器 + 3 个纯视频容器）',
        'scene 容器=' + ylScene.map((f) => f.media).join('|').slice(0, 120));
      // B8d 回归：官方 scene.pkg 目录判定不变（dd/* 里凡有 scene.pkg 的目录都必须是 scene 目录条目）
      const ddRoot = path.join(CORPUS, 'dd');
      const ddDirs = fs.readdirSync(ddRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory() && fs.existsSync(path.join(ddRoot, e.name, 'scene.pkg'))).map((e) => e.name);
      const ddf = (await scan(HB.base, ddRoot)).json.files || [];
      const wrong = ddDirs.filter((n) => { const e = entryOf(ddf, n); return !e || e.type !== 'scene' || e.media !== 'scene.pkg'; });
      ok(ddDirs.length >= 5 && wrong.length === 0,
        'B8d 回归：`dd/*` 里凡有 `scene.pkg` 的目录（' + ddDirs.length + ' 个）判定**不变**（scene / media=scene.pkg）',
        wrong.length ? '错的=' + wrong.join(',') : '全部正确');
    }
  } finally { await HB.stop(); }
}

/* ═══════════ C 段：客户端半边（真 client.js + 档位映射 + 分流顺序） ═══════════ */
console.log('\n══ C 客户端半边（真 lib/client.js）══');
try {
  const { loadPlugin } = await import(pathToFileURL(path.join(repoRoot, 'tools', '_stub.mjs')).href);
  loadPlugin({ clientPath: path.join(repoRoot, 'lib', 'client.js'), settings: { enabled: true }, quiet: true });
  const LT = globalThis.__mpwLifecycleTest;
  ok(!!LT && typeof LT.sourceFieldsFor === 'function' && typeof LT.pickMount === 'function',
    'C1 测试钩子 `__mpwLifecycleTest.sourceFieldsFor` / `pickMount` 可用（跑的是生产实现本身）');
  const sfScene = LT.sourceFieldsFor({ name: 'd1-official-scene', kind: 'scene', media: 'scene.pkg' }, {});
  ok(/scene=1/.test(String(sfScene.image)) && sfScene.converted === 'gif',
    'C2 scene 目录条目 → `image` 带 `scene=1`、converted=gif（静态帧/合成档的既有形状）',
    JSON.stringify({ image: String(sfScene.image).slice(0, 80), converted: sfScene.converted }));
  const sfCon = LT.sourceFieldsFor({ token: 'T', index: 3, file: 'a.mpkg', isMp4: true }, {});
  ok(sfCon.converted === 'mp4' && /token=T/.test(String(sfCon.image)),
    'C3 容器条目（token/index）→ converted=mp4 + `host:?token=…`（列表档；点击交给 applyCustomMpkg）',
    JSON.stringify({ image: String(sfCon.image).slice(0, 60), converted: sfCon.converted }));
  const pm = LT.pickMount({ image: 'host:?custom=1&folder=x&scene=1', converted: 'gif', webUrl: null });
  ok(pm && pm.mount === 'media', 'C4 挂载裁决：scene=1 的媒体档 ⇒ mount=media（不会被残留 webUrl 抢走）', JSON.stringify(pm));
  {
    const src = fs.readFileSync(path.join(repoRoot, 'lib', 'client.js'), 'utf8');
    const iGuard = src.indexOf('const hasSceneJson = (d.entries || []).some');
    const iVtex = src.indexOf('const vtex = (d.entries || []).filter');
    ok(iGuard > 0 && iVtex > iGuard,
      'C5 `applyCustomMpkg`：**容器内有 scene.json** 的判定在视频纹理之前 ⇒ 有 scene 就先给渲染器',
      'hasSceneJson@' + iGuard + ' vtex@' + iVtex);
    const iRender = src.indexOf('const okR = applySceneViaRenderer');
    const iSceneApply = src.indexOf('applySceneWallpaper({');
    ok(iRender > 0 && iSceneApply > iRender,
      'C6 `applyCustomScenePreview`：**先试渲染器**（applySceneViaRenderer）再走 scene-video 快路径',
      'renderer@' + iRender + ' sceneWallpaper@' + iSceneApply);
  }
} catch (e) {
  ok(false, 'C 段真 client.js 装载/断言未抛异常', String(e && e.message));
}

/* ═══════════ D 段：回退口（legacy） ═══════════ */
console.log('\n══ D 回退口（typedetect=legacy / DSH_WE_TYPEDETECT=legacy）══');
{
  const H2 = await bootHost(LIB_DIR);
  try {
    const s2 = await scan(H2.base, FX, 'legacy');
    const f2 = folderEntries(s2.json && s2.json.files, 'd2-collection-scene+mp4');
    ok(f2.length === 1 && f2[0].type === 'scene' && f2[0].folderMpkg !== true && f2[0].kindReason === 'scene-container',
      'D1 `{"typedetect":"legacy"}` ⇒ 回到旧判据（整目录 1 条 scene；证明回退口真的接管）',
      f2.map((f) => f.type + ':' + f.media).join(','));
    const f3 = folderEntries((await scan(H2.base, FX)).json.files, 'd2-collection-scene+mp4');
    ok(f3.length === 3, 'D1b 不带 typedetect ⇒ 恢复 content 口径（3 条）', f3.map((f) => f.type).join(','));
  } finally { await H2.stop(); }
  const H3 = await bootHost(LIB_DIR, { DSH_WE_TYPEDETECT: 'legacy' });
  try {
    const f4 = folderEntries((await scan(H3.base, FX)).json.files, 'd2-collection-scene+mp4');
    ok(f4.length === 1 && f4[0].type === 'scene',
      'D2 `DSH_WE_TYPEDETECT=legacy`（环境变量）⇒ 同样回到旧判据', f4.map((f) => f.type + ':' + f.media).join(','));
    const pr = await reqJson(H3.base, 'GET', BASE + '/probe');
    ok(pr.json && pr.json.typeDetect && pr.json.typeDetect.legacy === true && pr.json.typeDetect.mode === 'legacy',
      'D2b `/probe` 报出 mode=legacy（回退口可观测）', JSON.stringify(pr.json && pr.json.typeDetect));
  } finally { await H3.stop(); }
  delete process.env.DSH_WE_TYPEDETECT;
}

/* ═══════════ E 段：变异必红（子进程跑变异副本） ═══════════ */
console.log('\n══ E 变异自证（去掉新判据必须变红）══');
if (MUTATION) {
  console.log('  ⊘ 本进程是变异子进程（--mutation=' + MUTATION + '），不再递归跑变异段');
} else if (NO_MUTATIONS) {
  sk('E 变异段（--no-mutations）');
} else {
  const MUTS = [
    { id: 'split', mustRed: 'A4 目录里有「scene+mp4 容器 + 视频容器 + 松散 mp4」',
      from: 'const containerFolder = !det.signals.html && !realSceneFile',
      to: 'const containerFolder = !det.signals.video && !det.signals.html && !realSceneFile',
      why: '把 `!det.signals.video` 加回拆条判据（= 修复前：目录里有松散视频就不拆条）' },
    { id: 'verdict', mustRed: 'A6 目录有 index.html + **无场景数据的容器**',
      from: 'if (ck.ok && !ck.hasScene) {',
      to: 'if (false && ck.ok && !ck.hasScene) {',
      why: '关掉"容器内容裁决"（= 是容器就是场景的旧口径）' },
    { id: 'dirent', file: 'web-wallpaper.js', mustRed: 'A12b 文件全靠软链的 scene 目录仍判 scene',
      from: 'const st = statSync(join(dir, en.name));',
      to: 'const st = (() => { throw new Error("mutated: d_type 不可信时不兜底"); })();',
      why: '去掉"d_type 不可信就 stat 兜底"（= 软链/d_type 误报的条目当不存在）' },
  ];
  const mutLib = path.join(TMP, 'mutlib');
  fs.mkdirSync(mutLib, { recursive: true });
  for (const f of fs.readdirSync(LIB_DIR)) {
    if (!/\.(js|mjs|json)$/.test(f)) continue;
    fs.copyFileSync(path.join(LIB_DIR, f), path.join(mutLib, f));
  }
  for (const m of MUTS) {
    const target = path.join(mutLib, m.file || 'index.js');
    const src = fs.readFileSync(target, 'utf8');
    if (src.indexOf(m.from) < 0) { ok(false, 'E/' + m.id + ' 变异点存在（锚点字符串还在源码里）', 'anchor@' + (m.file || 'index.js') + ': ' + m.from.slice(0, 60)); continue; }
    fs.writeFileSync(target, src.replace(m.from, m.to));
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--lib', mutLib, '--mutation=' + m.id, '--no-mutations'], { encoding: 'utf8', timeout: 300000, env: Object.assign({}, process.env, { MPW_CORPUS: path.join(TMP, 'no-corpus') }) });
    const out = String(r.stdout || '') + String(r.stderr || '');
    const red = new RegExp('✗ ' + m.mustRed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(out);
    ok(r.status !== 0 && red,
      'E/' + m.id + ' 变异必红：' + m.why + ' ⇒ 「' + m.mustRed.slice(0, 30) + '…」必须转为 ✗',
      'exit=' + r.status + ' 命中红=' + red);
    fs.writeFileSync(target, src);   // 复原，供下一个变异用
  }
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败' + (skip ? ', ' + skip + ' 跳过' : ''));
if (fail) { console.error('✗ 壁纸类型判定判据未通过 —— 容器/目录的类型判定错了就会"只剩视频"或"纯 mp4 走场景"'); process.exit(1); }
console.log('✓ 壁纸类型判定判据通过（判定表 / 真包实测 / 回退口 / 变异自证）');
