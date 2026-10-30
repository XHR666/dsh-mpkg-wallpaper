// tools/renderer-host-test.mjs — 内置渲染器同源静态托管 /webloader/** 的门禁（任务单 P2 新增判据）
//
// 被测对象 = lib/index.js 里哨兵注释 `[webloader-factory BEGIN/END]` 之间的**真源码**
// （mpwWebloaderFactory：/webloader/** 只读静态托管的全部解析与应答逻辑）。
// 判据用 `new Function` 切片驱动真源码（插件侧判据的既有模式：不 import 真模块、不碰宿主）：
//   A. 夹具根驱动：200/404/403、路径穿越（`..`/反斜杠/NUL）、扩展名白名单、MIME 与安全头、HEAD 无体、
//      虚拟映射（'' / index.html → demo.html；bundle.js；diag-flags.json；core 同名兜底）；
//      越界符号链接 ⇒ 403（realpath 越界防护）。
//   B. 集成读数：真 `renderer/` 树上，`/webloader/` → demo.html 200、`/webloader/bundle.js` →
//      core/we-scene-bundle.js 200（这根管线就是"只装插件就能渲染"的首帧依赖）。
//   C. 合同面：client.js 默认渲染器地址 = 同源 `/webloader/`；目标闸门放行同源（kind=same-origin）；
//      `mpwSceneIdentityFromWebUrl` 对相对 URL 不再抛（strict 沙箱计划不因同源默认档静默降级）。
//   D. 许可边界联动：本路由只发静态文件；lib/index.js 的 webloader 块内不得出现对渲染器业务端点
//      （/pkgdir /report /weassist /diag 业务处理）的搬运 —— 块内只许有"发文件"（断言块内无这些端点字样）。
// 自证（R1/R2）：
//   M1 去掉扩展名白名单 ⇒ 夹具上"白名单外扩展名"用例必须红；
//   M2 去掉 realpath 越界防护 ⇒ "越界 symlink"用例必须红；
//   期望红集 == 实际红集（逐条）。
//
// 演进留痕（任务书 B 2026-10-30：真仓库内嵌布局）：
//   · B 组"真 renderer 树"的定位改为候选序：`env MPW_RENDERER_DEV` → `../renderer` → `../we-scene-demo`
//     → `./renderer`（内嵌副本），首个存在的目录胜出。旧代码钉死 `<仓库父目录>/renderer/`（集成交付的
//     并列目录布局），真仓库/worktree 里该路径不存在 ⇒ B1–B4 红于路径解析而非语义。
//   · 内嵌副本就是插件 /webloader 实际托管的根（lib/index.js 的 WEBLOADER_ROOT 同款定位：从插件目录
//     import.meta.url 派生）⇒ 真仓库/worktree 里 B 组打的是"只装插件就能渲染"首帧依赖的**那棵树本身**，
//     比旧布局（对拍另一棵树）更贴被测对象。
//   · 四个候选全缺 ⇒ B1–B4 明确 SKIP 并打印原因（不计通过、不静默放行；副本缺失的完整性由
//     license-boundary 的哨兵判据判红）。

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.resolve(HERE, '..');

/* ── 真 renderer 树解析（任务书 B 2026-10-30 候选序）：env → ../renderer → ../we-scene-demo → ./renderer（内嵌） ── */
function resolveRendererTree() {
  const cands = [];
  if (process.env.MPW_RENDERER_DEV) cands.push({ label: 'env MPW_RENDERER_DEV=' + process.env.MPW_RENDERER_DEV, p: path.resolve(PLUGIN, process.env.MPW_RENDERER_DEV) });
  cands.push({ label: '../renderer', p: path.resolve(PLUGIN, '..', 'renderer') });
  cands.push({ label: '../we-scene-demo', p: path.resolve(PLUGIN, '..', 'we-scene-demo') });
  cands.push({ label: './renderer（内嵌副本）', p: path.join(PLUGIN, 'renderer') });
  for (const c of cands) { try { if (fs.statSync(c.p).isDirectory()) return c; } catch { /* 候选不存在 ⇒ 试下一个 */ } }
  return null;
}
const RENDERER_TREE = resolveRendererTree();

let pass = 0, fail = 0; const results = [];
const check = (id, ok, detail) => { (ok ? pass++ : fail++); results.push({ id, ok, detail }); };

/* ── 切片：从 lib/index.js 提取 mpwWebloaderFactory 真源码 ── */
const indexSrc = fs.readFileSync(path.join(PLUGIN, 'lib', 'index.js'), 'utf8');
const BEGIN = '// ── [webloader-factory BEGIN]';
const END = '// ── [webloader-factory END]';
const i0 = indexSrc.indexOf(BEGIN);
const i1 = indexSrc.indexOf(END);
check('S1 哨兵注释恰出现一次（切片可行）', i0 >= 0 && i1 > i0 && indexSrc.indexOf(BEGIN, i0 + 1) < 0 && indexSrc.indexOf(END, i1 + 1) < 0, `begin=${i0} end=${i1}`);
const factorySrc = i0 >= 0 && i1 > i0 ? indexSrc.slice(i0, i1) : '';

/* res 桩：捕获状态行/头/体 */
const makeRes = () => {
  const res = { statusCode: 0, headers: null, bodyChunks: [], ended: false };
  res.writeHead = (code, headers) => { res.statusCode = code; res.headers = headers || {}; return res; };
  res.end = (body) => { res.ended = true; if (body) res.bodyChunks.push(Buffer.isBuffer(body) ? body : Buffer.from(String(body))); return res; };
  res.body = () => Buffer.concat(res.bodyChunks).toString('utf8');
  res.bodyBytes = () => Buffer.concat(res.bodyChunks);
  return res;
};
const makeReq = (method, url) => ({ method, url, headers: {} });
const deps = {
  fs: { existsSync: fs.existsSync, statSync: fs.statSync, realpathSync: fs.realpathSync, readFileSync: fs.readFileSync },
  path: { resolve: path.resolve, basename: path.basename, dirname: path.dirname, extname: path.extname, sep: path.sep },
};
const runFactory = (src, rootDir) => {
  const fn = new Function('deps', '"use strict";' + src + '\n;return mpwWebloaderFactory(deps);');
  return fn(Object.assign({}, deps, { rootDir }));
};
const serveOnce = (serve, method, url) => { const res = makeRes(); let threw = null; try { serve(makeReq(method, url), res); } catch (e) { threw = e; } return { res, threw }; };

/* ── 夹具根 ── */
let fx = null, outsideDir = null;
try {
  fx = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-webloader-'));
  const w = (r, s) => { fs.mkdirSync(path.dirname(path.join(fx, r)), { recursive: true }); fs.writeFileSync(path.join(fx, r), s); };
  w('demo.html', '<!doctype html><title>renderer-page</title>');
  w('index.html', '<!doctype html><title>LANDING-should-not-be-served</title>');
  w('core/we-scene-bundle.js', 'export const bundle = "core-bundle";\n');
  w('web/diag-flags.json', '{"common":[]}');
  w('elysia/demo-elysia.js', 'export const elysia = 1;\n');
  w('style.css', 'body{}');
  w('data.json', '{"ok":1}');
  w('tex.png', 'PNGDATA');
  w('shader.wasm', 'WASM');
  w('font.woff2', 'WOFF2');
  w('secret.txt', 'should-not-serve');
  w('noext', 'no-extension');
  w('core/attach-transform.mjs', 'export const attach = 1;\n');
  fs.mkdirSync(path.join(fx, 'outside'), { recursive: true });
  w('outside/leak.html', 'leaked-in-root');   // 根内目录（realpath 仍在根内 ⇒ 应放行）
  outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-webloader-out-'));
  fs.writeFileSync(path.join(outsideDir, 'leak.html'), 'leaked');
  fs.symlinkSync(path.join(outsideDir, 'leak.html'), path.join(fx, 'leak-link.html'));   // 越界链：realpath 出根 ⇒ 403
  fs.symlinkSync(path.join(fx, 'core'), path.join(fx, 'coredir-link'));   // 目录链（在根内 ⇒ 允许）
} catch (e) { check('S2 夹具就绪', false, String(e && e.message)); }

if (fx) {
  let serve = null;
  try { serve = runFactory(factorySrc, fx); check('S3 工厂切片可执行', typeof serve === 'function', typeof serve); }
  catch (e) { check('S3 工厂切片可执行', false, String(e && e.message)); }

  if (serve) {
    /* A1 入口映射：'' 与 /index.html 都 → demo.html（渲染器服务器同款），落地页不许漏出来 */
    const r1 = serveOnce(serve, 'GET', '/webloader/');
    check('A1 /webloader/ → demo.html 200（不是落地页）', r1.res.statusCode === 200 && /renderer-page/.test(r1.res.body()) && !/LANDING/.test(r1.res.body()),
      `code=${r1.res.statusCode} body=${r1.res.body().slice(0, 40)}`);
    const r1b = serveOnce(serve, 'GET', '/webloader/index.html');
    check('A2 /webloader/index.html → demo.html', r1b.res.statusCode === 200 && /renderer-page/.test(r1b.res.body()), `code=${r1b.res.statusCode}`);
    const r1c = serveOnce(serve, 'GET', '/webloader');
    check('A3 裸前缀 /webloader 也应答', r1c.res.statusCode === 200 && /renderer-page/.test(r1c.res.body()), `code=${r1c.res.statusCode}`);

    /* A4 虚拟映射 */
    const r2 = serveOnce(serve, 'GET', '/webloader/bundle.js');
    check('A4 /webloader/bundle.js → core/we-scene-bundle.js', r2.res.statusCode === 200 && /core-bundle/.test(r2.res.body()), `code=${r2.res.statusCode}`);
    const r2b = serveOnce(serve, 'GET', '/webloader/diag-flags.json');
    check('A5 /webloader/diag-flags.json → web/diag-flags.json', r2b.res.statusCode === 200 && /"common"/.test(r2b.res.body()), `code=${r2b.res.statusCode}`);
    const r2c = serveOnce(serve, 'GET', '/webloader/attach-transform.mjs');
    check('A6 core 同名兜底（attach-transform.mjs）', r2c.res.statusCode === 200 && /attach/.test(r2c.res.body()), `code=${r2c.res.statusCode}`);
    const r2d = serveOnce(serve, 'GET', '/webloader/core/attach-transform.mjs');
    check('A7 core/ 直取静态', r2d.res.statusCode === 200 && /attach/.test(r2d.res.body()), `code=${r2d.res.statusCode}`);
    const r2e = serveOnce(serve, 'GET', '/webloader/elysia/demo-elysia.js');
    check('A8 子目录静态（elysia/**）', r2e.res.statusCode === 200 && /elysia/.test(r2e.res.body()), `code=${r2e.res.statusCode}`);

    /* A9 MIME + 安全头 */
    const hdr = r1.res.headers || {};
    check('A9 HTML MIME = text/html; charset=utf-8', /text\/html;\s*charset=utf-8/.test(String(hdr['content-type'])), String(hdr['content-type']));
    const h2 = r2.res.headers || {};
    check('A10 JS MIME = text/javascript（module 可载）', /text\/javascript/.test(String(h2['content-type'])), String(h2['content-type']));
    check('A11 Cache-Control: no-cache + nosniff', hdr['cache-control'] === 'no-cache' && hdr['x-content-type-options'] === 'nosniff', `cc=${hdr['cache-control']} nosniff=${hdr['x-content-type-options']}`);

    /* A12 HEAD：同头无体 */
    const rh = serveOnce(serve, 'HEAD', '/webloader/');
    check('A12 HEAD 200 且无体（content-length 保留）', rh.res.statusCode === 200 && rh.res.bodyBytes().length === 0 && Number(hdr['content-length']) > 0, `code=${rh.res.statusCode} bodyLen=${rh.res.bodyBytes().length}`);

    /* A13 方法闸门 */
    const rpost = serveOnce(serve, 'POST', '/webloader/');
    check('A13 POST → 405（只许 GET/HEAD）', rpost.res.statusCode === 405, `code=${rpost.res.statusCode}`);

    /* A14 扩展名白名单：白名单外/无扩展名 → 404；白名单内全 200 */
    const blocked = ['secret.txt', 'noext'].map((r) => serveOnce(serve, 'GET', '/webloader/' + r));
    check('A14 白名单外（.txt / 无扩展名）→ 404', blocked.every((r) => r.res.statusCode === 404), blocked.map((r) => r.res.statusCode).join(','));
    const allowed = ['style.css', 'data.json', 'tex.png', 'shader.wasm', 'font.woff2'].map((r) => serveOnce(serve, 'GET', '/webloader/' + r));
    check('A15 白名单内全 200', allowed.every((r) => r.res.statusCode === 200), allowed.map((r) => r.res.statusCode).join(','));

    /* A16 路径穿越 */
    const trav = ['/webloader/../secret.txt', '/webloader/..%2Fsecret.txt', '/webloader/%2e%2e/secret.txt',
      '/webloader/..\\secret.txt', '/webloader/a/../../secret.txt', '/webloader/%2e%2e%2fsecret.txt'];
    const travRes = trav.map((u) => serveOnce(serve, 'GET', u));
    check('A16 路径穿越用例全 403（或 404，绝不 200）', travRes.every((r) => r.res.statusCode === 403 || r.res.statusCode === 404), travRes.map((r) => r.res.statusCode).join(','));

    /* A17 symlink 越界 → 403；根内目录链 → 正常 */
    const rsy = serveOnce(serve, 'GET', '/webloader/leak-link.html');
    check('A17 越界 symlink（realpath 出根）→ 403', rsy.res.statusCode === 403, `code=${rsy.res.statusCode}`);
    const rin = serveOnce(serve, 'GET', '/webloader/outside/leak.html');
    check('A17b 根内普通子目录文件正常放行', rin.res.statusCode === 200 && /leaked-in-root/.test(rin.res.body()), `code=${rin.res.statusCode}`);
    const rdir = serveOnce(serve, 'GET', '/webloader/coredir-link/we-scene-bundle.js');
    check('A18 根内目录链正常（realpath 仍在根内）', rdir.res.statusCode === 200 && /core-bundle/.test(rdir.res.body()), `code=${rdir.res.statusCode}`);

    /* A19 非本前缀不认 */
    const rOther = serveOnce(serve, 'GET', '/other/x.js');
    check('A19 非 /webloader 前缀不认（404，不越权应答）', rOther.res.statusCode === 404, `code=${rOther.res.statusCode}`);
  }
}

/* ── B. 集成读数：真 renderer 树（任务书 B 候选序解析；演进留痕见文件头） ── */
let bSkips = 0;
if (!RENDERER_TREE) {
  bSkips = 4;
  console.log('⏭ SKIP B1–B4 真 renderer 树集成读数 —— 四个候选全缺（env MPW_RENDERER_DEV / ../renderer / ../we-scene-demo / ./renderer 内嵌副本都不存在）；'
    + '副本缺失的完整性由 license-boundary 判据判红，此处明确跳过、不静默放行');
} else {
  console.log('# 真 renderer 树解析：' + RENDERER_TREE.label);
  try {
    const serveReal = runFactory(factorySrc, RENDERER_TREE.p);
    const a = serveOnce(serveReal, 'GET', '/webloader/');
    const b = serveOnce(serveReal, 'GET', '/webloader/bundle.js');
    check('B1 真 renderer 树：/ → demo.html 200', a.res.statusCode === 200 && /we-scene|属性面板|demo/.test(a.res.body().slice(0, 4000)), `code=${a.res.statusCode} len=${a.res.bodyBytes().length}`);
    check('B2 真 renderer 树：/bundle.js → core/we-scene-bundle.js 200', b.res.statusCode === 200 && b.res.bodyBytes().length > 100000, `code=${b.res.statusCode} len=${b.res.bodyBytes().length}`);
    const c = serveOnce(serveReal, 'GET', '/webloader/diag-flags.json');
    check('B3 真 renderer 树：/diag-flags.json → web/ 产物 200', c.res.statusCode === 200 && /"common"/.test(c.res.body()), `code=${c.res.statusCode}`);
    const d = serveOnce(serveReal, 'GET', '/webloader/elysia/scene-scripts.js');
    check('B4 真 renderer 树：elysia 模块静态 200', d.res.statusCode === 200, `code=${d.res.statusCode}`);
  } catch (e) { check('B1 真 renderer 树集成断言', false, String(e && e.message)); }
}

/* ── C. 合同面：client.js 默认地址 + 守卫同源分支 + 身份函数相对 URL ── */
try {
  const clientSrc = fs.readFileSync(path.join(PLUGIN, 'lib', 'client.js'), 'utf8');
  check('C1 默认渲染器地址 = 同源 /webloader/',
    /const MPW_SCENE_DEFAULT_BASE = "\/webloader\/";/.test(clientSrc), 'MPW_SCENE_DEFAULT_BASE');
  check('C2 目标闸门放行同源（kind=same-origin）', /kind: "same-origin"/.test(clientSrc), 'same-origin 分支在源');
  check('C3 mpwSceneIdentityFromWebUrl 用 location.href 作 base（相对 URL 不抛）',
    /new URL\(String\(url \|\| ""\), \(typeof location/.test(clientSrc), 'identity 相对 base');
  check('C4 沙箱 strict 属性不变（无 allow-same-origin）', /const MPW_SANDBOX_STRICT_ATTR = "allow-scripts allow-pointer-lock";/.test(clientSrc), 'B6 strict 一字不动');
} catch (e) { check('C1 client.js 合同断言', false, String(e && e.message)); }

/* ── D. 只发文件：webloader 块内不得搬渲染器业务端点 ── */
try {
  const block = factorySrc;
  const banned = [/\/pkgdir/, /\/weassist/, /['"]\/report['"]/, /['"]\/diag['"]/, /\/api\//];
  const hits = banned.filter((re) => re.test(block));
  check('D1 webloader 块内无渲染器业务端点字样', hits.length === 0, hits.length ? '命中 ' + hits.length + ' 条' : '0 命中');
} catch (e) { check('D1 端点禁搬断言', false, String(e && e.message)); }

/* ══ 自证 M1/M2：变异在切片副本上做（不动真树） ══ */
try {
  // M1 去掉扩展名白名单（MIME 表清空）⇒ A14/A15 应变红：全 404（白内也 404）= "能失败"的方向证明
  const m1Src = factorySrc.replace(/const MIME = \{[\s\S]*?\};/, 'const MIME = {};');
  const m1Changed = m1Src !== factorySrc && !/\.html.*text\/html/.test(m1Src);
  const s1 = runFactory(m1Src, fx);
  const a15 = ['style.css', 'data.json'].map((r) => serveOnce(s1, 'GET', '/webloader/' + r));
  const m1Red = a15.every((r) => r.res.statusCode === 404);   // 白名单没了 ⇒ 白内文件也拒 ⇒ 断言红
  check('M1 变异自证：去白名单 ⇒ 白内文件被拒（断言必红）', m1Changed && m1Red, `changed=${m1Changed} whiteListed404=${a15.map((r) => r.res.statusCode).join(',')}`);

  // M2 去掉 realpath 越界防护 ⇒ 越界 symlink 用例必须变红（从 403 变 200，文件漏出）
  const m2Src = factorySrc.replace(/if \(rf !== rr && !rf\.startsWith\(rr \+ P\.sep\)\) return deny\(res, 403, \{ reason: 'realpath-escape' \}\);/, '');
  const m2Changed = m2Src !== factorySrc && !/realpath-escape/.test(m2Src);
  const s2 = runFactory(m2Src, fx);
  const rsy2 = serveOnce(s2, 'GET', '/webloader/leak-link.html');
  const m2Red = rsy2.res.statusCode === 200 && /leaked/.test(rsy2.res.body());
  check('M2 变异自证：去 realpath 防护 ⇒ 越界 symlink 漏出（断言必红）', m2Changed && m2Red, `changed=${m2Changed} code=${rsy2.res.statusCode}`);
} catch (e) { check('M1/M2 变异自证', false, String(e && e.message)); }

/* ── 清理 + 汇总 ── */
if (fx) { try { fs.rmSync(fx, { recursive: true, force: true }); } catch { /* 清理失败不影响判定 */ } }
if (outsideDir) { try { fs.rmSync(outsideDir, { recursive: true, force: true }); } catch { /* 同上 */ } }
for (const r of results) console.log((r.ok ? '✓' : '✗') + ' ' + r.id + (r.detail ? '  —— ' + r.detail : ''));
console.log(`===== renderer-host: ${pass} 通过 / ${fail} 失败${bSkips ? ' / ' + bSkips + ' SKIP（原因见上）' : ''} =====`);
process.exit(fail ? 1 : 0);
