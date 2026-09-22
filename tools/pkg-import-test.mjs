#!/usr/bin/env node
// tools/pkg-import-test.mjs —— 「单文件 .pkg / .mpkg 导入」真可用性回归
//
// 来历：用户第 4 项「支持导入 pkg 单文件和 mpkg 文件」的核验报告
//   `../docs/PKG-IMPORT-VERIFICATION-20260923.md`（本机可复现）：
//   · G1 单文件 `.pkg`（真机 magic `PKGV0022`）**没有任何入口**：`accept` 不含 `.pkg`、
//        文件头嗅探只认 `PKGM` ⇒ 实测 0 次宿主调用 + `file.unsafe`；
//   · G2 渲染器自带打包器 `pack-dir.mjs` 产出的 `.mpkg` 恰好也是 `PKGV0022` ⇒ 自家产物进不来；
//   · G3 全仓 `grep onDrop|dataTransfer` 0 命中（没有拖拽）；
//   · G5 库目录**根**下的单文件 `.pkg` 不进清单（`.mpkg` 进）；
//   · G6 无素材容器**先整包上传**再报 `mpkg.noAsset`（白占磁盘）；
//   · G7 `.pkg` 拿不到容器内预览图（`/custom-mpkg-preview` 只收 `.mpkg`：200 → 404）；
//   · G8 目录表 >2MiB ⇒ `/upload` 500（Node 原生 RangeError 文案）+ 未登记残骸；
//   · G9 上传的容器文件**永不回收**（一次导入留一份整包副本，重启还被重新登记）；
//   · G11 mpkg 路径**不解压**（压缩条目 = 构造性缺口，本机语料 508 条 0 压缩）；
//   · G12 用户可见文案只承诺 `.mpkg`；
//   · G10 `lib/pkg-extract.js` 的 magic 判据只认 `PKGV` ⇒ `.mpkg`（真机 `PKGM0014`）在
//         `parsePkg` / `parsePkgIndex` 与渲染器底座 `tableFor()` 三处全抛 `pkg: bad magic`
//         （不在用户导入链上，但库目录同时有 `.mpkg`+`index.html` 或走 scene 系路由时会踩到）。
//         修法＝判据放宽到容器族 `PKG[VM]`（G 段：同一条目表两种 magic 的合成夹具钉"同源、不是两套逻辑"）。
//
// 关键语义（用户原话）：上游 oneincase 的项目**只导入 PKG 文件**，因为 `preview`/`project.json`
//   **一般是缺失的** ⇒ 导入路径**不得**依赖 preview 或 project.json 存在（本文件 D 段专门钉这条）。
//
// 纪律（本机可用内存 ~4GB）：不跑 ffmpeg、不开浏览器、**不读真机语料**；夹具全部由本文件合成
//   （≤3MB/个，总计 <10MB，退出即删）；真 HTTP 打**真 lib/index.js 注册的**路由（假 webServer 挂载）。
//
// 断言分组：[A] 客户端切片（真源码真跑） [B] 宿主路由（真 HTTP） [C] 上传物回收（G9）
//           [D] 不依赖 preview/project.json 的判据 [G] 容器族 PKG[VM]（G10）
//           [E] 变异自证（改回去必须变红）
// 用法: node tools/pkg-import-test.mjs
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const BASE = '/api/mpkg-wallpaper';

let pass = 0, fail = 0;
const ok = (n, cond, d) => {
  if (cond) { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')); }
  else { fail++; console.error('  ✗ ' + n + (d ? '  → ' + d : '')); }
};

/* ── 临时目录（退出兜底清理；只写 mkdtemp） ───────────────────────────── */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-pkgimport-'));
const cleanup = () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 忽略 */ } };
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { cleanup(); process.exit(130); });

/* ── 合成夹具：容器构造器（与 parseMpkgHead 的布局逐字段同源） ──────────
   header: version_length(u32) + version + count(u32)
   entry : name_length(u32) + name + index(u32) + size(u32)
   data  : dataStart + index                                                */
function buildContainer(version, files) {
  const vb = Buffer.from(version, 'latin1');
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
  const head = Buffer.alloc(4 + vb.length + 4);
  head.writeUInt32LE(vb.length, 0);
  vb.copy(head, 4);
  head.writeUInt32LE(files.length, 4 + vb.length);
  return Buffer.concat([head, table, ...files.map(([, d]) => d)]);
}
const GIF = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(36, 7)]);   // 42B
const SMALL_TEX = Buffer.alloc(1024, 3);
const SCENE_JSON = Buffer.from('{"general":{"type":"scene"}}', 'utf8');
const PROJECT_JSON = Buffer.from('{"title":"fixture","general":{"properties":{}}}', 'utf8');
/** LZ4 块链条目（与 pkg-extract.probeCompressedEntry 同形状：u64 原始长 + [i32 unc][i32 comp]） */
function lz4EntryBytes(total, originalSize) {
  const b = Buffer.alloc(total, 0x5a);
  b.writeUInt32LE(originalSize >>> 0, 0);
  b.writeUInt32LE(Math.floor(originalSize / 4294967296), 4);
  b.writeInt32LE(originalSize, 8);
  b.writeInt32LE(20, 12);
  return b;
}
/** 目录表 > HEAD_BYTES(2MiB)：25000 条 × (4+100+8) ≈ 2.8MiB（数据全 0 长） */
function buildBigTableFile(version, count, nameLen) {
  const vb = Buffer.from(version, 'latin1');
  const head = Buffer.alloc(4 + vb.length + 4);
  head.writeUInt32LE(vb.length, 0);
  vb.copy(head, 4);
  head.writeUInt32LE(count, 4 + vb.length);
  const entryLen = 4 + nameLen + 8;
  const out = Buffer.concat([head, Buffer.alloc(count * entryLen)]);
  for (let i = 0; i < count; i++) {
    const nm = Buffer.from(('d' + String(i).padStart(6, '0')).padEnd(nameLen, 'x'), 'utf8');
    const base = head.length + i * entryLen;
    out.writeUInt32LE(nm.length, base);
    nm.copy(out, base + 4);
    out.writeUInt32LE(0, base + 4 + nameLen);      // index
    out.writeUInt32LE(0, base + 4 + nameLen + 4);  // size
  }
  return { buf: out, tableBytes: count * entryLen };
}

const FX = path.join(TMP, 'fixtures');
fs.mkdirSync(FX, { recursive: true });
const F = {};
// 真机口径：scene.pkg = PKGV0022 / .mpkg = PKGM0014 / pack-dir.mjs 产物 = "名字叫 mpkg、magic 是 PKGV"
F.pkgSingle = path.join(FX, 'scene.pkg');
fs.writeFileSync(F.pkgSingle, buildContainer('PKGV0022', [
  ['scene.json', SCENE_JSON], ['project.json', PROJECT_JSON], ['preview.gif', GIF], ['textures/noise.tex', SMALL_TEX],
]));
F.mpkgReal = path.join(FX, 'we_mobile.mpkg');
fs.writeFileSync(F.mpkgReal, buildContainer('PKGM0014', [['scene.json', SCENE_JSON], ['preview.gif', GIF]]));
F.mpkgPackdir = path.join(FX, 'packdir_style.mpkg');
fs.writeFileSync(F.mpkgPackdir, buildContainer('PKGV0022', [['preview.gif', GIF]]));
F.compressedPkg = path.join(FX, 'compressed.pkg');
fs.writeFileSync(F.compressedPkg, buildContainer('PKGV0022', [
  ['scene.json', SCENE_JSON], ['preview.gif', lz4EntryBytes(64, 4096)],
]));
F.bigTable = path.join(FX, 'big_table.mpkg');
{
  const { buf, tableBytes } = buildBigTableFile('PKGM0014', 25000, 100);
  fs.writeFileSync(F.bigTable, buf);
  F.bigTableBytes = buf.length;
  F.bigTableTableBytes = tableBytes;
}
// 库目录夹具
const LIB = path.join(TMP, 'customdir');
const mk = (p, buf) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, buf); };
mk(path.join(LIB, 'loose.pkg'), buildContainer('PKGV0022', [['preview.gif', GIF], ['scene.json', SCENE_JSON]]));
mk(path.join(LIB, 'loose.mpkg'), buildContainer('PKGM0014', [['preview.gif', GIF]]));
mk(path.join(LIB, 'workshop-scene', 'scene.pkg'), buildContainer('PKGV0022', [['preview.gif', GIF], ['scene.json', SCENE_JSON]]));
mk(path.join(LIB, 'bare-pkg-scene', 'my-wallpaper.pkg'), buildContainer('PKGV0022', [['preview.gif', GIF], ['scene.json', SCENE_JSON]]));
mk(path.join(LIB, 'loose-scene', 'scene.json'), SCENE_JSON);
mk(path.join(LIB, 'web-wallpaper', 'index.html'), Buffer.from('<html><body>web</body></html>', 'utf8'));
mk(path.join(LIB, 'web-wallpaper', 'project.json'), Buffer.from('{"general":{"type":"web"}}', 'utf8'));
mk(path.join(LIB, 'compressed-scene', 'scene.pkg'), buildContainer('PKGV0022', [['preview.gif', lz4EntryBytes(64, 4096)]]));
// 库目录里的"大目录表"容器（2.8MiB 表）：/custom-mpkg 与 preview 都不许 500（G8 库路径）
mk(path.join(LIB, 'big-scene', 'scene.pkg'), fs.readFileSync(F.bigTable));

/* ── 假宿主：把真 lib/index.js 注册的路由挂到真 http 上（exact 路径） ── */
const freePort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.on('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
});
async function bootHost(libDir, { home, env } = {}) {
  const dshHome = home || fs.mkdtempSync(path.join(TMP, 'home-'));
  process.env.DSH_HOME = dshHome;
  delete process.env.DSH_WE_MPKG_TABLE_MAX_BYTES;
  delete process.env.DSH_WE_UPLOAD_KEEP;
  delete process.env.DSH_WE_UPLOAD_MAX_BYTES;
  delete process.env.DSH_WE_UPLOAD_PROTECT_MS;
  for (const [k, v] of Object.entries(env || {})) process.env[k] = String(v);
  const indexPath = path.join(libDir, 'index.js');
  const mod = await import(pathToFileURL(indexPath).href + '?t=' + Date.now() + '-' + Math.random());
  const routes = new Map();
  mod.apply({ webServer: { register: (r) => { routes.set(r.path, r); return { dispose() {} }; } }, loader: null, logger: { info() {}, warn() {}, error() {} } });
  const port = await freePort();
  const server = http.createServer((req, res) => {
    let url = null;
    try { url = new URL(req.url, 'http://127.0.0.1'); } catch { res.writeHead(400); return res.end('bad url'); }
    const r = routes.get(url.pathname);
    if (!r) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"ok":false,"error":"no route"}'); }
    try { Promise.resolve(r.handler(req, res, url)).catch((e) => { try { res.writeHead(500); res.end(String(e && e.message || e)); } catch { /* 已响应 */ } }); } catch (e) { try { res.writeHead(500); res.end(String(e && e.message || e)); } catch { /* 已响应 */ } }
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return {
    mod, dshHome, dataDir: path.join(dshHome, '.dsh-mpkg-wallpaper'),
    base: 'http://127.0.0.1:' + port,
    has: (p) => routes.has(BASE + p),
    stop: () => new Promise((r) => server.close(r)),
  };
}
function reqJson(base, method, p, body, headers) {
  return new Promise((resolve) => {
    const payload = body === undefined || body === null ? null : (Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body)));
    const req = http.request({ host: '127.0.0.1', port: Number(new URL(base).port), method, path: p, headers: Object.assign(payload ? { 'content-length': payload.length, 'content-type': 'application/json' } : {}, headers || {}) }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        let json = null; try { json = JSON.parse(raw.toString('utf8')); } catch { /* 二进制 */ }
        resolve({ status: res.statusCode, headers: res.headers, raw, json });
      });
    });
    req.on('error', (e) => resolve({ status: 0, headers: {}, raw: Buffer.alloc(0), json: null, err: String(e && e.code || e.message || e) }));
    req.setTimeout(20000, () => { try { req.destroy(new Error('client-timeout')); } catch { /* 已断 */ } });
    if (payload) req.write(payload);
    req.end();
  });
}
const uploadFile = (base, filePath) => reqJson(base, 'POST', BASE + '/upload', fs.readFileSync(filePath));
const listing = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
const uploadNames = (d) => listing(d).filter((n) => /^[0-9a-f]{32}\.mpkg$/.test(n));

/* ── 源码切片工具（跑**生产文件本身**，不是复刻） ───────────────────── */
const readSrc = (p) => fs.readFileSync(p, 'utf8');
const readU8 = (p) => new Uint8Array(fs.readFileSync(p));
function sliceFn(src, name) {
  const lines = src.split('\n');
  // 两种形态：`function name(` 与 `const name = async (` / `const name = (`
  const startAt = lines.findIndex((l) => new RegExp('(function ' + name + '\\s*\\()|(const ' + name + '\\s*=\\s*(async\\s*)?\\()').test(l));
  if (startAt < 0) throw new Error('没找到 function/const ' + name);
  let depth = 0, seen = false;
  for (let i = startAt; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; seen = true; } else if (ch === '}') { depth--; if (seen && depth === 0) return { src: lines.slice(startAt, i + 1).join('\n'), line: startAt + 1 }; }
    }
  }
  throw new Error('{} 不配平: ' + name);
}
function sliceConst(src, name) {
  const m = new RegExp('^\\s*const ' + name + ' = (.*?);\\s*$', 'm').exec(src);
  if (!m) throw new Error('没找到 const ' + name);
  return 'const ' + name + ' = ' + m[1] + ';';
}
/** sniffFileType：Node 无 DOM ⇒ 注入最小 FileReader 桩（与核验报告 §4.2a 同款）。 */
function loadSniff(clientSrc) {
  const fr = sliceFn(clientSrc, 'sniffFileType');
  const Fake = class {
    readAsArrayBuffer(blob) { blob.arrayBuffer().then((ab) => { this.result = ab; if (this.onload) this.onload({ target: this }); }).catch(() => { if (this.onerror) this.onerror({}); }); }
  };
  return { fn: new Function('FileReader', 'return ' + fr.src)(Fake), line: fr.line };
}
/** 容器预检两件套（纯函数）。 */
function loadPrecheck(clientSrc) {
  const tex = sliceFn(clientSrc, 'isVideoTexCandidate');
  const pre = sliceFn(clientSrc, 'mpkgAssetPrecheck');
  return { api: new Function(tex.src + '\n' + pre.src + '\nreturn { isVideoTexCandidate, mpkgAssetPrecheck };')(), line: pre.line };
}
/** 客户端容器头读取（倍增 + 可读错误）：parseMpkg + looksCompressedEntry + MPKG_HEAD_STEPS + readMpkgHeadFromFile。 */
function loadHeadReader(clientSrc) {
  const parse = sliceFn(clientSrc, 'parseMpkg');
  const lz = sliceFn(clientSrc, 'looksCompressedEntry');
  const steps = sliceConst(clientSrc, 'MPKG_HEAD_STEPS');
  const grow = sliceFn(clientSrc, 'readMpkgHeadFromFile');
  return { api: new Function([steps, parse.src, lz.src, grow.src, 'return { readMpkgHeadFromFile, looksCompressedEntry };'].join('\n'))(), line: grow.line };
}
const fileLike = (buf, size) => ({ size: size === undefined ? buf.length : size, slice: (a, b) => ({ arrayBuffer: async () => buf.subarray(a, Math.min(b, buf.length)).buffer.slice(buf.subarray(a, Math.min(b, buf.length)).byteOffset, buf.subarray(a, Math.min(b, buf.length)).byteOffset + (Math.min(b, buf.length) - a)) }) });

const CLIENT = path.join(repoRoot, 'lib', 'client.js');
const INDEX = path.join(repoRoot, 'lib', 'index.js');
const PKG_EXTRACT = path.join(repoRoot, 'lib', 'pkg-extract.js');
const clientSrc = readSrc(CLIENT);
// 变异自证的卫生判据：真树的生产文件跑前跑后必须**逐字节**相同（变异只发生在 mkdtemp 副本）
const sha256 = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const SHA_BEFORE = { client: sha256(CLIENT), index: sha256(INDEX), web: sha256(path.join(repoRoot, 'lib', 'web-wallpaper.js')), pkgExtract: sha256(PKG_EXTRACT) };

/* ═══════════ A 段：客户端切片（真源码真跑 + 源码级接线） ═══════════ */
console.log('══ A 客户端导入链（真源码切片）══');
{
  const sniff = loadSniff(clientSrc);
  const cases = [
    ['scene.pkg（真机口径 PKGV0022）', fs.readFileSync(F.pkgSingle), 'mpkg'],
    ['we_mobile.mpkg（真机口径 PKGM0014）', fs.readFileSync(F.mpkgReal), 'mpkg'],
    ['packdir_style.mpkg（pack-dir.mjs 产物：名字 .mpkg / magic PKGV）', fs.readFileSync(F.mpkgPackdir), 'mpkg'],
    ['PNG（分辨力对照）', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.alloc(24)]), 'png'],
    ['MP4（分辨力对照）', Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom', 'latin1'), Buffer.alloc(16)]), 'mp4'],
    ['HTML（必须仍被拒）', Buffer.from('<!doctype html><html>', 'utf8'), null],
    ['随机字节（必须仍被拒）', Buffer.from('this-is-not-a-container-at-all', 'utf8'), null],
  ];
  for (const [label, buf, want] of cases) {
    const got = await sniff.fn(new File([buf], 'x'));
    ok('A1 sniffFileType(' + label + ') === ' + JSON.stringify(want), got === want, 'got=' + JSON.stringify(got));
  }
  // vl >= 64（version 串超长）不算容器 —— 与旧口径一致，防"宽到什么都认"
  const longVer = Buffer.concat([Buffer.from([0x40, 0, 0, 0]), Buffer.from('PKGV0022', 'latin1'), Buffer.alloc(60)]);
  ok('A1b version_length ≥ 64 的畸形头仍被拒（没有宽到"什么都认"）', (await sniff.fn(new File([longVer], 'x'))) === null);

  // 拖拽（G3）与选择器**同一条落点**
  const importCore = /const importPickedFile = async \(file\) => \{/.test(clientSrc);
  const onDrop = /const onDropFiles = \(e\) => \{[\s\S]{0,900}?dataTransfer[\s\S]{0,900}?importPickedFile\(f\)/.test(clientSrc);
  const onDragOver = /onDragOver: onDragOverFiles, onDrop: onDropFiles/.test(clientSrc);
  const onMpkgUsesCore = /const onMpkg = async \(e\) => \{[\s\S]{0,400}?await importPickedFile\(file\)/.test(clientSrc);
  ok('A2 G3 拖拽：importPickedFile 抽取 + onDropFiles 走 dataTransfer + 挂在面板根 onDrop/onDragOver',
    importCore && onDrop && onDragOver, 'core=' + importCore + ' drop=' + onDrop + ' root=' + onDragOver);
  ok('A2b G3 选择器与拖拽**同一条落点**（onMpkg → importPickedFile，不许重写一份判定）', onMpkgUsesCore);

  // G1 accept
  const accept = /accept: "([^"]*\.pkg[^"]*)"/.exec(clientSrc);
  ok('A3 G1 文件选择器 accept 含 `.pkg`（否则单文件 .pkg 在选择器里就是灰的）',
    !!accept && /\.mpkg/.test(accept[1]), accept ? 'accept=' + accept[1] : '没找到 accept');

  // G6 预检在 /upload **之前**
  const viaHost = sliceFn(clientSrc, 'importViaHost');
  const iPre = viaHost.src.indexOf('mpkgAssetPrecheck(');
  const iUp = viaHost.src.indexOf('fetch(HOST_BASE + "/upload"');
  ok('A4 G6 上传前预检：importPickedFile→importViaHost 里 mpkgAssetPrecheck 出现在 fetch /upload 之前',
    iPre >= 0 && iUp > 0 && iPre < iUp, 'precheck@' + iPre + ' upload@' + iUp);
  ok('A4b G6 无素材 ⇒ 直接 showError 返回（不是先上传再报错）',
    /if \(pre && !pre\.hasAsset && !pre\.hasVideoTex\) \{[\s\S]{0,200}?return;/.test(viaHost.src));

  // G8 客户端倍增
  const hr = loadHeadReader(clientSrc);
  ok('A5 G8 客户端头部读取是 2→8→32MiB 倍增（原实现固定 2MiB）',
    /* 判据是**语义**（2→8→32 MiB 三档倍增），不是源码怎么写：
       允许字面量写法与位移写法两种（后者是为了不撞 persist-test 的"散落字节阈值"守卫，
       见 lib/client.js 的 MPKG_HEAD_STEPS 注释）——两种都必须真的等值。 */
    (/2 \* 1024 \* 1024, 8 \* 1024 \* 1024, 32 \* 1024 \* 1024/.test(clientSrc)
      || /MPKG_HEAD_STEPS = \[1 << 21, 1 << 23, 1 << 25\]/.test(clientSrc))
    && (1 << 21) === 2 * 1024 * 1024 && (1 << 23) === 8 * 1024 * 1024 && (1 << 25) === 32 * 1024 * 1024);
  const big = fs.readFileSync(F.bigTable);
  const r1 = await hr.api.readMpkgHeadFromFile(fileLike(big));
  ok('A5b 目录表 2.8MiB 的容器：客户端能读到（倍增生效，headBytes=8MiB）',
    r1 && r1.mpkg && r1.mpkg.entries.length === 25000 && r1.headBytes === 8 * 1024 * 1024,
    'entries=' + (r1 && r1.mpkg && r1.mpkg.entries.length) + ' headBytes=' + (r1 && r1.headBytes));
  // 永远解析不出（条目数声明 1000 万，数据不存在）⇒ 必须给可读 code，而不是 DataView 原生 RangeError
  const brokenTable = Buffer.concat([
    Buffer.from([8, 0, 0, 0]), Buffer.from('PKGV0022', 'latin1'), (() => { const b = Buffer.alloc(4); b.writeUInt32LE(10000000, 0); return b; })(),
    Buffer.alloc(64),
  ]);
  let thrown = null;
  try { await hr.api.readMpkgHeadFromFile(fileLike(brokenTable, 64 * 1024 * 1024)); } catch (e) { thrown = e; }
  ok('A5c 读不出的目录表 ⇒ code="table-too-large" 的可读错误（不是 DataView 原生 RangeError）',
    !!thrown && thrown.code === 'table-too-large' && /目录表/.test(String(thrown.message)), thrown ? thrown.code : '没有抛错');

  // G11 压缩条目识别（客户端与宿主**同源判据**）
  ok('A6 G11 客户端也认得压缩条目（纯浏览器路径不能把压缩字节画出去）',
    hr.api.looksCompressedEntry(lz4EntryBytes(64, 4096), 64) === true
    && hr.api.looksCompressedEntry(GIF, GIF.length) === false);

  // G12 文案
  const zhPick = /"mpkg\.pick": "([^"]*)"/.exec(clientSrc);
  const enPick = clientSrc.slice(clientSrc.indexOf('"mpkg.pick"', clientSrc.indexOf('"mpkg.pick"') + 3));
  const zhHint = /"mpkg\.hint": "([^"]*)"/.exec(clientSrc);
  const enHint = /"mpkg\.hint": "([^"]*)"/.exec(clientSrc.slice(clientSrc.indexOf('"mpkg.pick"') >= 0 ? clientSrc.lastIndexOf('"mpkg.hint"') : 0));
  ok('A7 G12 中英文案都同时承诺 `.pkg` 与 `.mpkg`',
    !!zhPick && /\.pkg/.test(zhPick[1]) && /\.mpkg/.test(zhPick[1]) && !!zhHint && /\.pkg/.test(zhHint[1]) && /\.mpkg/.test(zhHint[1]) && !!enHint && /\.pkg/.test(enHint[1]) && /\.mpkg/.test(enHint[1]),
    'zh.pick=' + (zhPick && zhPick[1]) + ' | en.hint=' + (enHint && enHint[1].slice(0, 60)));

  // D 段判据（用户原话）：导入链不得依赖 preview / project.json
  const precheckSrc = sliceFn(clientSrc, 'mpkgAssetPrecheck').src;
  ok('A8 关键语义：预检只吃条目名/大小——不出现 preview、不出现 project.json',
    !/preview/i.test(precheckSrc) && !/project\.json/i.test(precheckSrc));
  ok('A8b 关键语义：预检要求的是"有素材"，不是"有 scene.json/preview"（后缀候选与 pickBackgroundEntry 同源）',
    /gif\|png\|jpe\?g\|webp\|mp4\|webm\|mov/.test(precheckSrc));
}

/* ═══════════ B 段：宿主路由（真 HTTP + 真 lib/index.js） ═══════════ */
console.log('\n══ B 宿主路由（真 HTTP）══');
let B = null;
{
  B = await bootHost(path.join(repoRoot, 'lib'), { env: {} });
  ok('B0 路由已注册：/upload /media /custom-dir /custom-mpkg /custom-mpkg-preview',
    B.has('/upload') && B.has('/media') && B.has('/custom-dir') && B.has('/custom-mpkg') && B.has('/custom-mpkg-preview'));

  // B1/B2 单文件 .pkg 与 .mpkg 都能上传（G1/G2 宿主侧）
  const up1 = await uploadFile(B.base, F.pkgSingle);
  ok('B1 G1 单文件 .pkg（PKGV0022）→ /upload 200（原实现客户端根本没走到这里）',
    up1.status === 200 && up1.json && up1.json.ok === true && Array.isArray(up1.json.entries),
    'status=' + up1.status + ' entries=' + (up1.json && up1.json.entries ? up1.json.entries.length : '-'));
  const up2 = await uploadFile(B.base, F.mpkgPackdir);
  ok('B2 G2 pack-dir.mjs 产物（名字 .mpkg / magic PKGV）→ /upload 200',
    up2.status === 200 && up2.json && up2.json.ok === true, 'status=' + up2.status);
  // 条目字节能真读出来（不是"只回索引"）
  const gifEntry = up1.json.entries.find((e) => e.name === 'preview.gif');
  const m1 = await reqJson(B.base, 'GET', BASE + '/media?token=' + up1.json.token + '&index=' + gifEntry.index);
  ok('B1b /media 真能返回该条目字节（magic 不挑 ≠ 不能用）',
    m1.status === 200 && m1.raw.equals(GIF), 'status=' + m1.status + ' bytes=' + m1.raw.length);

  // B3 G8：目录表 2.8MiB > HEAD_BYTES ⇒ 现在**能解析**（倍增），不再是 500
  const up3 = await uploadFile(B.base, F.bigTable);
  ok('B3 G8 目录表 ' + (F.bigTableTableBytes / 1048576).toFixed(1) + 'MiB（>2MiB 头）→ 200 + 25000 条（倍增生效）',
    up3.status === 200 && up3.json && up3.json.entries && up3.json.entries.length === 25000,
    'status=' + up3.status + ' entries=' + (up3.json && up3.json.entries ? up3.json.entries.length : '-'));

  // B4 G11：压缩条目如实报 + /media 415（而不是把压缩字节发出去）
  const up4 = await uploadFile(B.base, F.compressedPkg);
  ok('B4 G11 压缩条目在 /upload 的响应里如实列出（compressed 名单）',
    up4.status === 200 && up4.json && Array.isArray(up4.json.compressed) && up4.json.compressed.indexOf('preview.gif') >= 0,
    'compressed=' + JSON.stringify(up4.json && up4.json.compressed));
  const cEntry = up4.json.entries.find((e) => e.name === 'preview.gif');
  const m4 = await reqJson(B.base, 'GET', BASE + '/media?token=' + up4.json.token + '&index=' + cEntry.index);
  ok('B4b G11 压缩条目 /media → 415 + code=entry-compressed（可读，不是压缩字节）',
    m4.status === 415 && m4.json && m4.json.code === 'entry-compressed' && /压缩条目/.test(String(m4.json.error)),
    'status=' + m4.status + ' code=' + (m4.json && m4.json.code));
  // 正常条目不受影响（同容器里 scene.json）
  const sEntry = up4.json.entries.find((e) => e.name === 'scene.json');
  const m4c = await reqJson(B.base, 'GET', BASE + '/media?token=' + up4.json.token + '&index=' + sEntry.index);
  ok('B4c 同容器的正常条目照常 200（守卫没有误伤）', m4c.status === 200 && m4c.raw.equals(SCENE_JSON));

  // B5 G5/G7/G4：库目录清单 + 容器内缩略图 + 判定依据
  // B9 G8（超限一侧）：把目录表上限 env 压到 64KB ⇒ 同一个夹具必须 413 + 可读 code + **无残骸**
  {
    const H2 = await bootHost(path.join(repoRoot, 'lib'), { env: { DSH_WE_MPKG_TABLE_MAX_BYTES: 65536 } });
    try {
      const before = listing(H2.dataDir).length;
      const r = await uploadFile(H2.base, F.bigTable);
      const after = listing(H2.dataDir).length;
      ok('B9 G8 目录表超上限 ⇒ 413 + code=table-too-large + 可读中文说明（原为 500 + Node 原生 RangeError）',
        r.status === 413 && r.json && r.json.code === 'table-too-large' && /目录表过大/.test(String(r.json.error)),
        'status=' + r.status + ' code=' + (r.json && r.json.code));
      ok('B9b G8 失败**不留残骸**（上传目录文件数不变；原实现留一个未登记文件）',
        after === before, 'files ' + before + '→' + after);
    } finally { await H2.stop(); }
  }

  const cd = await reqJson(B.base, 'POST', BASE + '/custom-dir', { dir: LIB });
  const files = (cd.json && cd.json.files) || [];
  const byName = (n) => files.find((f) => f.name === n || (f.folder && f.name === n));
  ok('B5 G5 库目录**根**下的单文件 `loose.pkg` 进清单且 type=mpkg（原实现根本不出现）',
    !!byName('loose.pkg') && byName('loose.pkg').type === 'mpkg',
    'loose.pkg=' + JSON.stringify(byName('loose.pkg')));
  ok('B5b 根下的 `loose.mpkg` 仍在（回归）', !!byName('loose.mpkg') && byName('loose.mpkg').type === 'mpkg');
  ok('B5c G4 任意名容器 `bare-pkg-scene/my-wallpaper.pkg` 的 kindReason=scene-container（原为 scene-json）',
    !!byName('bare-pkg-scene') && byName('bare-pkg-scene').kindReason === 'scene-container',
    'reason=' + (byName('bare-pkg-scene') && byName('bare-pkg-scene').kindReason));
  ok('B5d G4 真·松散场景 `loose-scene`（只有 scene.json）仍是 scene-json（没有一刀切）',
    !!byName('loose-scene') && byName('loose-scene').kindReason === 'scene-json',
    'reason=' + (byName('loose-scene') && byName('loose-scene').kindReason));
  ok('B5e `workshop-scene/scene.pkg` 仍是 scene-container（回归）',
    !!byName('workshop-scene') && byName('workshop-scene').kindReason === 'scene-container');

  const pv1 = await reqJson(B.base, 'GET', BASE + '/custom-mpkg-preview?file=' + encodeURIComponent('loose.pkg'));
  const pv2 = await reqJson(B.base, 'GET', BASE + '/custom-mpkg-preview?file=' + encodeURIComponent('loose.mpkg'));
  ok('B6 G7 `.pkg` 也能拿到容器内缩略图（200 + image/gif；原实现 404）',
    pv1.status === 200 && pv1.headers['content-type'] === 'image/gif' && pv1.raw.equals(GIF),
    'status=' + pv1.status + ' type=' + pv1.headers['content-type']);
  ok('B6b `.mpkg` 缩略图仍是 200（回归）', pv2.status === 200 && pv2.raw.equals(GIF));

  const cm1 = await reqJson(B.base, 'GET', BASE + '/custom-mpkg?file=' + encodeURIComponent('loose.pkg'));
  ok('B7 G5 配套：根下的 `loose.pkg` 走 /custom-mpkg 能选出素材（scene.pkg 与 mpkg 同一容器格式）',
    cm1.status === 200 && cm1.json && cm1.json.ok === true && cm1.json.selected && cm1.json.selected.name === 'preview.gif',
    'selected=' + JSON.stringify(cm1.json && cm1.json.selected));
  // B8 G8（库路径）：大目录表容器走 /custom-mpkg 与 /custom-mpkg-preview 都不许 500
  const cmBig = await reqJson(B.base, 'GET', BASE + '/custom-mpkg?folder=' + encodeURIComponent('big-scene') + '&file=scene.pkg');
  ok('B8 G8 库目录里 2.8MiB 目录表的容器：/custom-mpkg 200 + 25000 条（倍增读取，不再 500）',
    cmBig.status === 200 && cmBig.json && cmBig.json.entries && cmBig.json.entries.length === 25000,
    'status=' + cmBig.status + ' entries=' + (cmBig.json && cmBig.json.entries ? cmBig.json.entries.length : '-'));
  const pvBig = await reqJson(B.base, 'GET', BASE + '/custom-mpkg-preview?folder=' + encodeURIComponent('big-scene') + '&file=scene.pkg');
  ok('B8b 同容器 /custom-mpkg-preview 是"没预览图"的 404（不是解析失败的 500）',
    pvBig.status === 404 && /no preview/.test(String(pvBig.json && pvBig.json.error)),
    'status=' + pvBig.status + ' error=' + (pvBig.json && pvBig.json.error));

  const cm2 = await reqJson(B.base, 'GET', BASE + '/custom-mpkg?folder=' + encodeURIComponent('compressed-scene') + '&file=' + encodeURIComponent('scene.pkg'));
  ok('B7b G11 库目录路径也如实标出压缩条目（selected.compressed）',
    cm2.status === 200 && cm2.json && cm2.json.selected && cm2.json.selected.compressed === true,
    'status=' + cm2.status + ' selected=' + JSON.stringify(cm2.json && cm2.json.selected));
}

/* ═══════════ C 段：上传物回收（G9） ═══════════ */
console.log('\n══ C 上传容器副本回收（G9，上限 + 在用保护）══');
{
  const H = await bootHost(path.join(repoRoot, 'lib'), { env: { DSH_WE_UPLOAD_KEEP: 2, DSH_WE_UPLOAD_MAX_BYTES: 64 * 1024 * 1024, DSH_WE_UPLOAD_PROTECT_MS: 60000 } });
  try {
    ok('C0 上限已登记（__mpwTest.limits.UPLOAD_KEEP=2）', H.mod.__mpwTest.limits.UPLOAD_KEEP === 2);
    const tokens = [];
    for (let i = 0; i < 5; i++) {
      const r = await uploadFile(H.base, F.pkgSingle);
      if (r.json && r.json.ok) tokens.push({ token: r.json.token, entries: r.json.entries });
    }
    ok('C1 连续 5 次导入后：DATA_DIR 里的上传副本 ≤ UPLOAD_KEEP（原实现 5 个全留着，永不回收）',
      uploadNames(H.dataDir).length === 2, 'count=' + uploadNames(H.dataDir).length);
    const st1 = H.mod.__mpwTest.uploadStat();
    ok('C1b 最新那份仍在（本次刚上传的受 protect 保护）',
      uploadNames(H.dataDir).indexOf(tokens[4].token + '.mpkg') >= 0, 'stat=' + JSON.stringify(st1));
    ok('C1c 最旧那份已删（最旧先删）',
      uploadNames(H.dataDir).indexOf(tokens[0].token + '.mpkg') < 0);

    // 在用保护：/media 读过的那个 token 不许被后续导入挤掉
    const survivor = uploadNames(H.dataDir).map((n) => n.slice(0, -5)).find((t) => t !== tokens[4].token) || tokens[3].token;
    const sRec = tokens.find((t) => t.token === survivor) || tokens[3];
    const mIdx = (sRec.entries.find((e) => e.name === 'preview.gif') || sRec.entries[0]).index;
    const m = await reqJson(H.base, 'GET', BASE + '/media?token=' + survivor + '&index=' + mIdx);
    await uploadFile(H.base, F.pkgSingle);
    await uploadFile(H.base, F.pkgSingle);
    ok('C2 正在播放（/media 读过）的副本不被后续导入挤掉（lastUsed 保护）',
      m.status === 200 && uploadNames(H.dataDir).indexOf(survivor + '.mpkg') >= 0,
      'survivor=' + survivor.slice(0, 8) + ' files=' + uploadNames(H.dataDir).length);

    // 当前壁纸引用保护（settings.json 里的 token=…）
    const nowFiles = uploadNames(H.dataDir).map((n) => n.slice(0, -5));
    const refToken = nowFiles[nowFiles.length - 1];
    fs.mkdirSync(H.dataDir, { recursive: true });
    fs.writeFileSync(path.join(H.dataDir, 'settings.json'), JSON.stringify({ image: 'host:?token=' + refToken + '&index=0', mpkgKey: 'host|' + refToken }));
    // 用户自己的文件（非上传物形状）绝不碰
    fs.writeFileSync(path.join(H.dataDir, 'my-own-scene.mpkg'), Buffer.from('user file'));
    fs.writeFileSync(path.join(H.dataDir, 'scene.pkg'), Buffer.from('user pkg'));
    fs.writeFileSync(path.join(H.dataDir, 'notes.txt'), Buffer.from('user notes'));
    const before = uploadNames(H.dataDir).length;
    H.mod.__mpwTest.pruneUploads();
    ok('C3 settings.json 里仍被当前壁纸引用的副本不被回收（引用计数口径）',
      uploadNames(H.dataDir).indexOf(refToken + '.mpkg') >= 0, 'ref=' + refToken.slice(0, 8) + ' before=' + before);
    ok('C4 用户自己放进 DATA_DIR 的文件一个都没动（只回收 /^[0-9a-f]{32}\\.mpkg$/ 形状）',
      listing(H.dataDir).indexOf('my-own-scene.mpkg') >= 0 && listing(H.dataDir).indexOf('scene.pkg') >= 0 && listing(H.dataDir).indexOf('notes.txt') >= 0,
      'files=' + listing(H.dataDir).length);
    ok('C5 restoreFiles 的自愈面没被破坏：删掉的副本不再登记、留下的仍能 /media',
      (await reqJson(H.base, 'GET', BASE + '/media?token=' + tokens[0].token + '&index=0')).status === 404,
      'deleted token → 404');
  } finally { await H.stop(); }
}

/* ═══════════ D 段：不依赖 preview / project.json（用户原话的硬语义） ═══════════ */
console.log('\n══ D 关键语义：导入链不依赖 preview / project.json ══');
{
  const pre = loadPrecheck(clientSrc);
  ok('D1 只有 scene.json + tex、既无 preview 也无图片/视频 ⇒ kind=none（预检据此拒绝上传）',
    pre.api.mpkgAssetPrecheck([{ name: 'scene.json', size: 100 }, { name: 'textures/a.tex', size: 1024 }]).kind === 'none');
  ok('D2 只有 preview.gif（**没有** scene.json / project.json）⇒ 有素材（上游 oneincase 包常见形态）',
    pre.api.mpkgAssetPrecheck([{ name: 'preview.gif', size: 42 }]).hasAsset === true);
  ok('D3 只有 index.html（网页壁纸）⇒ kind=web（提示走目录方式，不先上传再报"没素材"）',
    pre.api.mpkgAssetPrecheck([{ name: 'index.html', size: 10 }, { name: 'js/app.js', size: 10 }]).kind === 'web');
  ok('D4 大 tex（>5MiB）⇒ 不提前否掉（可能内嵌 mp4 的视频纹理）',
    pre.api.mpkgAssetPrecheck([{ name: 'textures/main.tex', size: 6 * 1024 * 1024 }]).maybeVideoTex === true);
  ok('D4b 抠像层/入场动画的 tex 不算候选（与既有排除规则同源）',
    pre.api.isVideoTexCandidate('抠像_人物.tex', 9 * 1024 * 1024) === false
    && pre.api.isVideoTexCandidate('入场动画_batch.tex', 9 * 1024 * 1024) === false
    && pre.api.isVideoTexCandidate('main.tex', 9 * 1024 * 1024) === true);
  ok('D5 无素材容器**不发** /upload：预检分支在 fetch 之前且直接 return（源码顺序判据）',
    (() => { const v = sliceFn(clientSrc, 'importViaHost').src; const a = v.indexOf('mpkgAssetPrecheck('); const b = v.indexOf('fetch(HOST_BASE + "/upload"'); return a >= 0 && b > a; })());
}

/* ═══════════ G 段：容器族 PKG[VM]（G10；**合成夹具**，不读真机语料） ═══════════ */
// 来历：../docs/PKG-IMPORT-VERIFICATION-20260923.md §3 G10 —— `.mpkg`（真机 magic PKGM0014）在
//   `lib/pkg-extract.js` 的 parsePkg（:275）与 readPkgTable（:457）两处都抛 `pkg: bad magic`，
//   连带渲染器底座 `we-scene-demo/server/pkg-entry-index.mjs` 的 `tableFor()` 一起失败。
// 判据（第一性原理）：**容器就是容器** —— PKGM 与 PKGV 的**目录表同源**
//   （`[i32 串长][magic][i32 条目数]{[i32 名字长][name][u32 offset][u32 size]}*`，offset 相对 dataStart），
//   差异只在条目数据里，而条目压缩由**逐条** probeCompressedEntry 判定（与 magic 无关）。
//   所以这里用"同一条目表、只换 magic"的一对合成分具钉三件事：解析结果一致（不是两套逻辑）、
//   条目字节一致（含 LZ4 块链）、越界/未知 magic 仍如实抛错（没有宽到什么都认）。
console.log('\n══ G G10 容器族 PKG[VM]（PKGM 与 PKGV 同源，合成夹具）══');
{
  const ext = await import(pathToFileURL(PKG_EXTRACT).href + '?t=' + Date.now());
  const G_FILES = [
    ['scene.json', SCENE_JSON],
    ['preview.gif', GIF],
    ['textures/main.tex', SMALL_TEX],
    ['shaders/noise.h', Buffer.from('// noise', 'utf8')],
  ];
  /** 合法的 LZ4 块链条目：u64 原始长 + [i32 unc][i32 comp][block]；块 = 4 字节字面量 + 一次 offset=4 的匹配铺满。 */
  const lz4Chain = (size) => {
    const block = Buffer.alloc(11);
    block[0] = 0x4f;                                   // token：字面量 4 / 匹配 15（+扩展）
    block.set(Buffer.from('abcd', 'latin1'), 1);
    block.writeUInt16LE(4, 5);                         // match offset = 4（回退到 'abcd' 自身）
    block[7] = 255; block[8] = 255; block[9] = 255; block[10] = 236;   // 1016 = 255*3+236
    const head = Buffer.alloc(16);
    head.writeUInt32LE(size >>> 0, 0);
    head.writeUInt32LE(Math.floor(size / 4294967296), 4);
    head.writeInt32LE(size, 8);
    head.writeInt32LE(block.length, 12);
    return Buffer.concat([head, block]);
  };
  const LZ4_SIZE = 1024;
  const LZ4_ENTRY = lz4Chain(LZ4_SIZE);
  const G_LZ4 = G_FILES.concat([['textures/compressed.tex', LZ4_ENTRY]]);
  F.pkgvMagic = path.join(FX, 'g10_pkgv0022.pkg');
  F.pkgmMagic = path.join(FX, 'g10_pkgm0014.mpkg');
  F.pkgxMagic = path.join(FX, 'g10_pkgx0001.pkg');
  fs.writeFileSync(F.pkgvMagic, buildContainer('PKGV0022', G_LZ4));
  fs.writeFileSync(F.pkgmMagic, buildContainer('PKGM0014', G_LZ4));
  fs.writeFileSync(F.pkgxMagic, buildContainer('PKGX0001', G_LZ4));
  const shape = (list) => JSON.stringify(list.map((e) => [e.path, e.offset, e.compressedSize, e.size, e.flags]));

  // G0：独立算出的 PKGV 期望目录表（不依赖任何解析器）——"既有 PKGV 行为逐位不变"的黄金值
  const golden = (() => {
    let dataStart = 4 + 8 + 4;
    for (const [n] of G_LZ4) dataStart += 4 + Buffer.byteLength(n, 'utf8') + 8;
    let rel = 0;
    return G_LZ4.map(([n, d]) => {
      const isLz4 = n === 'textures/compressed.tex';   // 唯一一条 LZ4 块链（探测到 flags=1、size=原始长）
      const row = { path: n, offset: dataStart + rel, compressedSize: d.length, size: isLz4 ? LZ4_SIZE : d.length, flags: isLz4 ? 1 : 0 };
      rel += d.length;
      return row;
    });
  })();

  // G1 PKGM 能被 parsePkg 正常解析（原实现：pkg: bad magic 'PKGM0014'）
  let pkgmPkg = null, pkgmErr = null;
  try { pkgmPkg = ext.parsePkg(readU8(F.pkgmMagic)); } catch (e) { pkgmErr = e; }
  ok('G1 G10 PKGM0014 容器能被 parsePkg 解析（原实现抛 pkg: bad magic）',
    !!pkgmPkg && pkgmPkg.length === G_LZ4.length, pkgmErr ? String(pkgmErr.message) : 'entries=' + (pkgmPkg && pkgmPkg.length));

  // G2 目录表与"同结构 PKGV 夹具"**逐条一致**（证明不是两套解析逻辑）
  const pkgvPkg = ext.parsePkg(readU8(F.pkgvMagic));
  const pkgmIdx = ext.parsePkgIndex(readU8(F.pkgmMagic));
  const pkgvIdx = ext.parsePkgIndex(readU8(F.pkgvMagic));
  const pkgmFileIdx = ext.readPkgIndexFromFile(F.pkgmMagic);
  const pkgvFileIdx = ext.readPkgIndexFromFile(F.pkgvMagic);
  ok('G2 目录表与同结构 PKGV 夹具逐条一致（path/offset/compressedSize/size/flags 全等）',
    shape(pkgmIdx.entries) === shape(pkgvIdx.entries) && shape(pkgmPkg) === shape(pkgvPkg),
    'pkgi=' + pkgmIdx.entries.length + ' 条 · magic ' + pkgmIdx.magic + ' vs ' + pkgvIdx.magic);
  ok('G2b 三个入口都认 PKGM：parsePkg / parsePkgIndex / readPkgIndexFromFile（后者 = 只读文件头的音频索引路径）',
    pkgmIdx.magic === 'PKGM0014' && pkgmFileIdx.magic === 'PKGM0014'
    && shape(pkgmFileIdx.entries) === shape(pkgvFileIdx.entries) && pkgmFileIdx.tableBytes === pkgvFileIdx.tableBytes,
    'parsePkgIndex.magic=' + pkgmIdx.magic + ' readPkgIndexFromFile.magic=' + pkgmFileIdx.magic
    + ' tableBytes=' + pkgmFileIdx.tableBytes + '/' + pkgvFileIdx.tableBytes);

  // G3 条目字节**逐位一致**（含 LZ4 块链：压缩探测与解压不是按 magic 分支的）
  const payloadOf = (idx) => idx.entries.map((e) => Buffer.from(ext.readPkgEntry(readU8(idx === pkgmIdx ? F.pkgmMagic : F.pkgvMagic), e)));
  const pmBytes = payloadOf(pkgmIdx), pvBytes = payloadOf(pkgvIdx);
  const lz4Pos = G_LZ4.findIndex(([n]) => n === 'textures/compressed.tex');
  const lz4Entry = pkgmIdx.entries[lz4Pos];
  const lz4Want = Buffer.alloc(LZ4_SIZE);
  for (let i = 0; i < LZ4_SIZE; i++) lz4Want[i] = 'abcd'.charCodeAt(i % 4);
  ok('G3 同结构 PKGM/PKGV 的**每条**条目字节逐位相同（' + G_LZ4.length + ' 条）',
    pmBytes.length === pvBytes.length && pmBytes.every((b, i) => Buffer.compare(b, pvBytes[i]) === 0),
    'sizes=' + pmBytes.map((b) => b.length).join(','));
  ok('G3b PKGM 里的 LZ4 块链条目：探测到 flags=1 且解压结果逐位正确（' + LZ4_SIZE + ' B）——压缩逻辑与 magic 无关',
    (lz4Entry.flags & 1) === 1 && lz4Entry.size === LZ4_SIZE && Buffer.compare(pmBytes[lz4Pos], lz4Want) === 0,
    'flags=' + lz4Entry.flags + ' size=' + lz4Entry.size + ' stored=' + lz4Entry.compressedSize);

  // G4 未知 / 非 PKG[VM] 的 magic 仍**如实抛错**（没有宽到"什么都认"）
  const errOf = (fn) => { try { fn(); return null; } catch (e) { return String(e && e.message); } };
  const eX1 = errOf(() => ext.parsePkg(readU8(F.pkgxMagic)));
  const eX2 = errOf(() => ext.parsePkgIndex(readU8(F.pkgxMagic)));
  const eX3 = errOf(() => ext.readPkgIndexFromFile(F.pkgxMagic));
  const vShell = Buffer.concat([Buffer.from([4, 0, 0, 0]), Buffer.from('v1.0', 'latin1'), Buffer.alloc(8)]);
  const eX4 = errOf(() => ext.parsePkg(vShell));
  ok('G4 未知 magic（PKGX0001）在三个入口都仍抛 `pkg: bad magic \'PKGX0001\'`（如实报，不伪造成功）',
    eX1 === "pkg: bad magic 'PKGX0001'" && eX2 === "pkg: bad magic 'PKGX0001'" && eX3 === "pkg: bad magic 'PKGX0001'",
    'parsePkg=' + eX1 + ' | parsePkgIndex=' + eX2 + ' | readPkgIndexFromFile=' + eX3);
  ok('G4b 渲染器 core 认的 `v1.0` 缩略图壳**不**在本次放宽范围内：pkg-extract 仍如实抛错（放宽只到 PKG[VM]）',
    eX4 === "pkg: bad magic 'v1.0'", 'err=' + eX4);
  ok('G4c 判据自证：PKG[VM] 只认这两种 magic（PKGV0022/PKGM0014 真，PKGX0001/PKG0022/PKGVM0014/小写 pkGv0022 假）',
    ext.PKG_MAGIC_RE.test('PKGV0022') && ext.PKG_MAGIC_RE.test('PKGM0014')
    && !ext.PKG_MAGIC_RE.test('PKGX0001') && !ext.PKG_MAGIC_RE.test('PKG0022')
    && !ext.PKG_MAGIC_RE.test('PKGVM0014') && !ext.PKG_MAGIC_RE.test('pkGv0022'),
    'PKG_MAGIC_RE=' + ext.PKG_MAGIC_RE);

  // G5 既有 PKGV 行为**逐位不变**（对照上面独立算出的黄金目录表 + 原样载荷）
  const pvShape = JSON.parse(shape(pkgvPkg));
  const goldenShape = JSON.parse(shape(golden));
  ok('G5 PKGV0022 夹具解析结果 == 独立算出的黄金目录表（path/offset/size 逐位，回归）',
    JSON.stringify(pvShape) === JSON.stringify(goldenShape),
    'got=' + shape(pkgvPkg).slice(0, 90) + '…');
  ok('G5b PKGV 既有载荷逐位不变（原样条目 = 源夹具字节；LZ4 条目 = 解压结果）',
    pvBytes.every((b, i) => i === lz4Pos ? Buffer.compare(b, lz4Want) === 0 : Buffer.compare(b, G_LZ4[i][1]) === 0),
    'len=' + pvBytes.map((b) => b.length).join(','));
}

/* ═══════════ E 段：变异自证（改回去必须变红；变异只发生在 mkdtemp 副本） ═══════════ */
console.log('\n══ E 变异自证（8 组，各自必红）══');
{
  const mutRoot = path.join(TMP, 'mut');
  // ⚠ 不用 fs.cpSync：本机文件系统上它拷 lib/liquid-glass 这个目录会 EINVAL（`cp -r` 正常）
  //   —— 变异夹具必须真的把 lib/ 整份拷出来（index.js 要 import ./pkg-extract.js / ./web-wallpaper.js）。
  const copyDir = (src, dst) => {
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      const a = path.join(src, e.name), b = path.join(dst, e.name);
      if (e.isDirectory()) copyDir(a, b);
      else if (e.isFile()) fs.copyFileSync(a, b);
    }
  };
  const copyLib = (tag) => {
    const dir = path.join(mutRoot, tag, 'lib');
    copyDir(path.join(repoRoot, 'lib'), dir);
    return dir;
  };
  const mutate = (p, from, to) => {
    const s = readSrc(p);
    if (!s.includes(from)) return false;
    fs.writeFileSync(p, s.replace(from, to));
    return true;
  };
  const expect = (label, cond, detail) => ok('E ' + label, cond, detail);

  // E1（G1 accept）
  {
    const lib = copyLib('accept');
    const c = path.join(lib, 'client.js');
    const injected = mutate(c, 'accept: ".pkg,.mpkg,', 'accept: ".mpkg,');
    const src = readSrc(c);
    const accept = /accept: "([^"]*)"/.exec(src);
    expect('E1 改回 accept 不含 `.pkg` ⇒ A3 变红', injected && !/\.pkg,/.test(accept ? accept[1] : ''), 'accept=' + (accept && accept[1]));
  }
  // E2（G1/G2 sniff）
  {
    const lib = copyLib('sniff');
    const c = path.join(lib, 'client.js');
    const injected = mutate(c, 'ascii.indexOf("PKGM") === 4 || ascii.indexOf("PKGV") === 4', 'ascii.indexOf("PKGM") === 4');
    const got = await loadSniff(readSrc(c)).fn(new File([fs.readFileSync(F.pkgSingle)], 'scene.pkg'));
    expect('E2 嗅探改回只认 PKGM ⇒ 单文件 .pkg 又变 null（A1 变红）', injected && got === null, 'sniff=' + JSON.stringify(got));
  }
  // E3（G7 preview 路由）
  {
    const lib = copyLib('preview');
    mutate(path.join(lib, 'index.js'), "!/\\.(mpkg|pkg)$/i.test(file)", "!file.toLowerCase().endsWith('.mpkg')");
    const H = await bootHost(lib, { env: {} });
    try {
      const r = await reqJson(H.base, 'GET', BASE + '/custom-mpkg-preview?file=' + encodeURIComponent('loose.pkg'));
      expect('E3 preview 路由改回只收 .mpkg ⇒ `.pkg` 缩略图又 404（B6 变红）', r.status === 404, 'status=' + r.status);
    } finally { await H.stop(); }
  }
  // E4（G8 失败清理）
  {
    const lib = copyLib('cleanup');
    mutate(path.join(lib, 'index.js'), "          } catch (e) {\n            try { unlinkSync(filePath); } catch { /* 忽略 */ }", "          } catch (e) {\n            try { /* 变异：不清理残骸 */ } catch {}");
    const H = await bootHost(lib, { env: { DSH_WE_MPKG_TABLE_MAX_BYTES: 65536 } });
    try {
      const before = listing(H.dataDir).length;
      const r = await uploadFile(H.base, F.bigTable);
      const after = listing(H.dataDir).length;
      expect('E4 目录表超限分支改回"不删残骸" ⇒ 上传目录多出一个未登记文件（B9b 变红）',
        r.status === 413 && after > before, 'status=' + r.status + ' files ' + before + '→' + after);
    } finally { await H.stop(); }
  }
  // E5（G9 回收）
  {
    const lib = copyLib('gc');
    mutate(path.join(lib, 'index.js'), 'try { pruneUploads(filePath); } catch { /* 回收失败不影响导入 */ }', '/* 变异：不回收 */');
    const H = await bootHost(lib, { env: { DSH_WE_UPLOAD_KEEP: 2, DSH_WE_UPLOAD_MAX_BYTES: 64 * 1024 * 1024 } });
    try {
      for (let i = 0; i < 4; i++) await uploadFile(H.base, F.pkgSingle);
      expect('E5 去掉"上传成功即回收"⇒ 4 份副本全留着（C1 变红）', uploadNames(H.dataDir).length === 4, 'count=' + uploadNames(H.dataDir).length);
    } finally { await H.stop(); }
  }
  // E6（G4 reason：**根修 + 消费点兜底**两处各自承重 —— 三档变异）
  const reasonOf = async (lib) => {
    const H = await bootHost(lib, { env: {} });
    try {
      const r = await reqJson(H.base, 'POST', BASE + '/custom-dir', { dir: LIB });
      const row = ((r.json && r.json.files) || []).find((f) => f.name === 'bare-pkg-scene');
      return row && row.kindReason;
    } finally { await H.stop(); }
  };
  {
    const lib = copyLib('reason-root');
    const inj1 = mutate(path.join(lib, 'web-wallpaper.js'), "ANY_PKG_RE.test(signals.scene) ? 'scene-container' : 'scene-json'", "SCENE_PKG_RE.test(signals.scene) ? 'scene-container' : 'scene-json'");
    const got = await reasonOf(lib);
    expect('E6a 只把根修（web-wallpaper）改回去 ⇒ 仍 scene-container（lib/index.js 的消费点兜底承重，不是单点）',
      inj1 && got === 'scene-container', 'reason=' + got);
  }
  {
    const lib = copyLib('reason-consumer');
    const inj2 = mutate(path.join(lib, 'index.js'), "const kindReason = (det.reason === 'scene-json' && /\\.(pkg|mpkg)$/i.test(String(media || '')))\n                  ? 'scene-container' : det.reason;", 'const kindReason = det.reason;');
    const got = await reasonOf(lib);
    expect('E6b 只把消费点兜底改回去 ⇒ 仍 scene-container（web-wallpaper 的根修承重）',
      inj2 && got === 'scene-container', 'reason=' + got);
  }
  {
    const lib = copyLib('reason-both');
    mutate(path.join(lib, 'web-wallpaper.js'), "ANY_PKG_RE.test(signals.scene) ? 'scene-container' : 'scene-json'", "SCENE_PKG_RE.test(signals.scene) ? 'scene-container' : 'scene-json'");
    mutate(path.join(lib, 'index.js'), "const kindReason = (det.reason === 'scene-json' && /\\.(pkg|mpkg)$/i.test(String(media || '')))\n                  ? 'scene-container' : det.reason;", 'const kindReason = det.reason;');
    const got = await reasonOf(lib);
    expect('E6c 两处都改回去 ⇒ 任意名容器又被标成 scene-json（B5c 变红：这一对就是修复的全部）',
      got === 'scene-json', 'reason=' + got);
  }
  // E7/E8（G10 容器族：**两处判据各自承重** —— parsePkg（条目读取）与 readPkgTable（目录表））
  //   变异只改 mkdtemp 里的 pkg-extract.js 副本（它只 import node: 内建，单文件即可改名导入）。
  const mutatedExtract = async (tag, from, to) => {
    const dir = path.join(mutRoot, tag);
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, 'pkg-extract.js');
    const src = readSrc(PKG_EXTRACT);
    if (!src.includes(from)) return { inj: false, mod: null };
    fs.writeFileSync(p, src.replace(from, to));
    return { inj: true, mod: await import(pathToFileURL(p).href + '?t=' + Date.now()) };
  };
  {
    // 把共享判据整体改回 PKGV-only（= G10 的原始状态）
    const { inj, mod } = await mutatedExtract('g10-both', 'const PKG_MAGIC_RE = /^PKG[VM]\\d{4}$/;', 'const PKG_MAGIC_RE = /^PKGV\\d{4}$/;');
    let err = null, pkgvOk = false;
    try { mod.parsePkg(readU8(F.pkgmMagic)); } catch (e) { err = String(e && e.message); }
    try { pkgvOk = mod.parsePkg(readU8(F.pkgvMagic)).length > 0; } catch { pkgvOk = false; }
    expect('E7 判据整体改回 PKGV-only ⇒ PKGM 夹具 parsePkg 又抛 bad magic（G1 变红），PKGV 侧不受影响',
      inj && err === "pkg: bad magic 'PKGM0014'" && pkgvOk, 'err=' + err + ' pkgvOk=' + pkgvOk);
  }
  {
    // 只把 parsePkg 的判据改回去（目录表侧留着放宽）：目录表读得出、条目读不出 ⇒ 证明两处各自承重
    const { inj, mod } = await mutatedExtract('g10-parsepkg',
      'if (!PKG_MAGIC_RE.test(magic)) throw new Error("pkg: bad magic \'" + magic + "\'");',
      'if (!/^PKGV\\d{4}$/.test(magic)) throw new Error("pkg: bad magic \'" + magic + "\'");');
    let idxErr = null, entryErr = null;
    try { mod.parsePkgIndex(readU8(F.pkgmMagic)); } catch (e) { idxErr = String(e && e.message); }
    try { mod.parsePkg(readU8(F.pkgmMagic)); } catch (e) { entryErr = String(e && e.message); }
    expect('E8 只把 parsePkg 一处改回去 ⇒ 目录表仍可读（G2 绿）但条目读取抛错（G1/G3 变红）——两处都在承重',
      inj && idxErr === null && entryErr === "pkg: bad magic 'PKGM0014'",
      'parsePkgIndex=' + idxErr + ' parsePkg=' + entryErr);
  }
}

/* ═══════════ 收尾：夹具卫生 ═══════════ */
console.log('\n══ 夹具卫生 ══');
{
  const duBytes = (p, skip) => {
    let bytes = 0;
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      const fp = path.join(p, e.name);
      if (skip && skip(fp)) continue;
      try { if (e.isDirectory()) bytes += duBytes(fp, skip); else bytes += fs.statSync(fp).size; } catch { /* 竞态 */ }
    }
    return bytes;
  };
  const fxBytes = duBytes(FX, null) + duBytes(LIB, null);
  const mutBytes = (() => { try { return duBytes(path.join(TMP, 'mut'), null); } catch { return 0; } })();
  ok('F1 合成夹具 ≤ 8MB（不读真机语料；变异副本另计，只在 mkdtemp 且退出即删）',
    fxBytes <= 8 * 1024 * 1024, (fxBytes / 1048576).toFixed(2) + ' MB 夹具 / ' + (mutBytes / 1048576).toFixed(2) + ' MB 变异副本');
  ok('F2 被测的四个生产文件（client/index/web-wallpaper/pkg-extract）跑前跑后 sha256 逐字节未变（变异只在 mkdtemp 副本里）',
    sha256(CLIENT) === SHA_BEFORE.client && sha256(INDEX) === SHA_BEFORE.index
    && sha256(path.join(repoRoot, 'lib', 'web-wallpaper.js')) === SHA_BEFORE.web
    && sha256(PKG_EXTRACT) === SHA_BEFORE.pkgExtract);
}

if (B) await B.stop();
console.log('\n===== pkg-import-test: ' + pass + ' 通过 / ' + fail + ' 失败 =====');
cleanup();
process.exit(fail === 0 ? 0 : 1);
