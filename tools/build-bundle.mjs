#!/usr/bin/env node
// tools/build-bundle.mjs —— 把宿主端 `lib/index.js` + 它**相对 import** 的整张依赖图，
// 内联成一个**单文件 ESM**（默认 `dist/dsh-mpkg-wallpaper.bundle.mjs`），供"手动拷文件"式安装：
//
//   node tools/build-bundle.mjs            # 构建（离线，无第三方依赖；只用 node 内建）
//   node tools/build-bundle.mjs --check    # 构建后加载 bundle，与源码逐项对拍（见下）
//
// 为什么不用打包器：本机离线（不能 npm install 任何打包器），且依赖图只有 3 个文件、
// 全是 ESM 静态 import，写一个**小而严**的内联器比引入 webpack/esbuild 更可控：
// 它只做三件事 —— 依赖序拼接、把跨模块 import/export 接成同一作用域的绑定、**遇到不会处理的
// 形态就报错退出**（绝不"静默产出坏文件"）。
//
// 内联策略（为什么这样是等价的）：
//   · 依赖图按**深度优先后序**拼接 ⇒ 与 ESM "依赖模块先求值完再求值导入方" 的顺序一致；
//   · 相对 import 删掉，不重命名引用：依赖方顶层声明的名字和被导入的绑定**本来就同名**，
//     同作用域下直接可用（`import { parsePkg }` + `function parsePkg` ⇒ 无需任何改写）；
//   · 只有**改名导入/默认导入/命名空间导入**需要补一行 `const 本地名 = 目标;`（放在该模块最前），
//     这同时天然保留了"内层作用域同名参数遮蔽导入名"的语义；
//   · `export { a as b }`/`export * from` 在入口侧展开成最终 `export { … };`（ESM 导出会提升，放文件尾等价）。
//
// 明确拒绝（非零退出，消息里带 文件:行）：
//   · 动态 `import()`（无论字面量还是变量）—— 拼接期无法求值；
//   · 顶层 await（会改变求值顺序语义）；
//   · 循环 import（拼接序没有"部分初始化"语义，会踩 TDZ）；
//   · 非 node 内建的裸包 import（无法内联；显式 `--allow-external <spec>` 可放行）；
//   · 未实现/看不懂的形态（`export * as ns from`、`export default function/class`…）；
//   · 跨模块**顶层同名声明/绑定**（拼接后会静默互相覆盖 —— 这类必须人来看，不能自动改名）。
//
// `--check` 用仓库既有套路（`tools/scene-audio-route-test.mjs` 的路由桩：apply() 真模块 +
// 桩 req/res 直接调路由）对拍源码与 bundle：
//   ① 导出面（名字集合逐个相等；`apply`/`name`/`Config`/`inject` 单独点名）；
//   ② 路由表（kind + path，逐项相等 + handler 可调用）；
//   ③ `/api/mpkg-wallpaper/ping` 的 JSON 键集合与 `ok`；
//   ④ 模块相对资源（`import.meta.url`）的**已知差异**：`/lg/*` 与 `ping.version` 取决于
//      bundle 旁边有没有 `liquid-glass/`、`../package.json`（README「方式四」有说明）。
//
// 产物 / 证据：
//   · `dist/dsh-mpkg-wallpaper.bundle.mjs`（不提交：.gitignore 忽略 dist/，理由见 README「文件结构」）
//   · `tools/probe-out/bundle-manifest.json`（机器可读摘要：sha256/字节数/模块表/导出面/外部依赖/模块相对引用）
// 夹具：`--check` 用 mkdtemp 建临时目录，process.on('exit') 兜底删除；单份 < 1MB。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Writable } from 'node:stream';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DEFAULT_ENTRY = 'lib/index.js';
const DEFAULT_OUT = 'dist/dsh-mpkg-wallpaper.bundle.mjs';
const MANIFEST = 'tools/probe-out/bundle-manifest.json';
const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto',
  'dgram', 'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https',
  'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode', 'querystring',
  'readline', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls', 'trace_events', 'tty',
  'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
]);

const fail = (msg) => { console.error('\n✗ ' + msg); process.exit(1); };
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const quoteSpec = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";

/* ─────────────────────────── 源码遮罩（字符串/注释/模板/正则 内容 → 空格） ───────────────────────────
 * 要求：**长度与源码逐字符对齐**（同一 index 既能查"结构"（遮罩串）又能取"原文"（真源码））。
 * 保留：引号/反引号定界符、换行（行号不能乱）、模板 `${}` 里的表达式代码（内部递归按代码处理）。
 * 目的：import/export 语句定位、`await` 顶层判定、动态 import() 检测都不被字符串/注释里的假象骗到
 * （例：`/"path"\s+"([^"]+)"/` 这种正则里的引号、注释里写的 `import(...)`、模板串里的 `<style>`）。 */
const REGEX_PREFIX_CHARS = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', '<', '>', '\n']);
const REGEX_PREFIX_WORDS = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'case', 'do', 'else', 'yield', 'await', 'throw']);
function maskNonCode(src) {
  const out = src.split('');
  const blank = (from, to) => { for (let k = from; k < to && k < src.length; k++) { const c = src[k]; if (c !== '\n' && c !== '\r') out[k] = ' '; } };
  const stack = [{ type: 'code', depth: 0, interp: false }];
  let i = 0, prevWord = '', prevChar = '\n';
  while (i < src.length) {
    const ctx = stack[stack.length - 1];
    const c = src[i];
    if (ctx.type === 'template') {
      if (c === '\\') { blank(i, i + 2); i += 2; continue; }
      if (c === '`') { stack.pop(); prevChar = '`'; prevWord = ''; i++; continue; }
      if (c === '$' && src[i + 1] === '{') {           // 插值表达式：交回代码态（保留 ${ 与配对 }）
        stack.push({ type: 'code', depth: 0, interp: true });
        i += 2; prevChar = '{'; prevWord = ''; continue;
      }
      blank(i, i + 1); i++; continue;                   // 模板正文
    }
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); blank(i, e < 0 ? src.length : e); i = e < 0 ? src.length : e; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); const stop = e < 0 ? src.length : e + 2; blank(i, stop); i = stop; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < src.length) { if (src[j] === '\\') { j += 2; continue; } if (src[j] === c) break; j++; }
      blank(i + 1, j); i = j + 1; prevChar = c; prevWord = ''; continue;
    }
    if (c === '`') { stack.push({ type: 'template' }); i++; prevChar = '`'; prevWord = ''; continue; }
    if (c === '/' && (prevWord ? REGEX_PREFIX_WORDS.has(prevWord) : REGEX_PREFIX_CHARS.has(prevChar))) {
      // 正则字面量：内容与 flags 都遮罩（`/["'{]/` 这类含引号/花括号的正则必须吃掉）
      let j = i + 1, inClass = false;
      while (j < src.length) {
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '[') inClass = true; else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) break;
        else if (d === '\n') break;                     // 没闭合 → 按除号处理，别吞代码
        j++;
      }
      if (j < src.length && src[j] === '/') {
        let k = j + 1; while (k < src.length && /[a-z]/i.test(src[k])) k++;
        blank(i, k); i = k; prevChar = '/'; prevWord = ''; continue;
      }
    }
    if (c === '{') { ctx.depth++; prevChar = c; prevWord = ''; i++; continue; }
    if (c === '}') {
      if (ctx.depth > 0) ctx.depth--;
      else if (ctx.interp) stack.pop();
      prevChar = c; prevWord = ''; i++; continue;
    }
    if (/[A-Za-z_$]/.test(c)) { let j = i; while (j < src.length && /[\w$]/.test(src[j])) j++; prevWord = src.slice(i, j); prevChar = 'x'; i = j; continue; }
    if (!/\s/.test(c)) { prevChar = c; prevWord = ''; }
    i++;
  }
  return out.join('');
}

/** 每个位置的括号嵌套深度：只认顶层声明（深度 0）用。 */
function depthMap(masked) {
  const depth = new Uint32Array(masked.length + 1);
  let d = 0;
  for (let i = 0; i < masked.length; i++) {
    const c = masked[i];
    if (c === '}' || c === ')' || c === ']') d = Math.max(0, d - 1);
    depth[i] = d;
    if (c === '{' || c === '(' || c === '[') d++;
  }
  depth[masked.length] = d;
  return depth;
}

/** 顶层 `await` 判定 —— 用于拒绝顶层 await。
 *  做法：扫掩码串维护花括号帧栈，遇到 `{` 看前面的 token 判断这是**函数体**还是普通块；
 *  `await` 若不在任何函数体帧内 ⇒ 顶层 await。`=>` 后不接 `{` 的箭头表达式（`async x => await f()`）
 *  用 pendingArrow 计到语句结束。允许行内注释 mpw-bundle:allow-tla 显式放行（构建时会打警告）。 */
const BLOCK_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'do', 'else', 'new', 'delete', 'void', 'in', 'of', 'with', 'await', 'yield', 'case', 'try', 'finally', 'class']);
function findTopLevelAwait(masked) {
  const hits = [];
  const frames = [{ fn: false }];
  let pendingArrow = 0;
  const lineOf = (idx) => masked.slice(0, idx).split('\n').length;
  const before = (idx) => masked.slice(Math.max(0, idx - 120), idx).replace(/\s+$/, '');
  for (let i = 0; i < masked.length;) {
    const c = masked[i];
    if (/[A-Za-z_$]/.test(c)) {
      let j = i; while (j < masked.length && /[\w$]/.test(masked[j])) j++;
      const word = masked.slice(i, j);
      if (word === 'await' && !frames.some((f) => f.fn) && pendingArrow === 0) hits.push({ line: lineOf(i), text: 'await' });
      if (word === 'function') frames.push({ fn: true });
      i = j; continue;
    }
    if (c === '=' && masked[i + 1] === '>') {
      const nxt = masked.slice(i + 2).match(/\S/);
      if (!nxt || nxt[0] !== '{') pendingArrow++;       // 表达式体箭头函数
      i += 2; continue;
    }
    if (c === '{') {
      const b = before(i);
      const method = /\b([A-Za-z_$][\w$]*)\s*\([^()]*\)$/.exec(b);
      const isFnBody = /=>$/.test(b)
        || /\bfunction\b[^()]*\([^()]*\)$/.test(b)
        || (!!method && !BLOCK_KEYWORDS.has(method[1]));
      frames.push({ fn: isFnBody });
      i++; continue;
    }
    if (c === '}') { if (frames.length > 1) frames.pop(); i++; continue; }
    if (c === ';' || c === ',' || c === ')') { if (pendingArrow > 0) pendingArrow = 0; i++; continue; }
    i++;
  }
  return hits;
}

const sanitize = (id) => id.replace(/[^\w$]/g, '_');
const splitTopLevel = (s, sep) => {
  const out = []; let cur = ''; let d = 0;
  for (const c of s) {
    if (c === '{' || c === '(' || c === '[') d++;
    else if (c === '}' || c === ')' || c === ']') d--;
    if (c === sep && d === 0) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
};
const findMatching = (s, start, open, close) => {
  let d = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === open) d++;
    else if (s[i] === close) { d--; if (d === 0) return i; }
  }
  return -1;
};

/** 拆一个模块：相对/外部依赖、顶层声明、导出面、待删除区间。 */
function analyzeModule(abs) {
  const src = fs.readFileSync(abs, 'utf8');
  const masked = maskNonCode(src);
  const depth = depthMap(masked);
  const id = rel(abs);
  const lineOf = (idx) => masked.slice(0, idx).split('\n').length;
  const mod = { id, abs, src, masked, depth, deps: [], bindings: [], exports: new Map(), reexports: [], defaultLocal: null, edits: [], allowTla: new Set() };

  // ① 顶层 import 语句（含多行）——`import.meta` / 动态 `import(` 不在此列
  for (const m of masked.matchAll(/^[ \t]*import\b/gm)) {
    if (depth[m.index] !== 0) continue;
    const after = masked.slice(m.index + 'import'.length).match(/^[ \t]*([\s\S])/);
    if (!after || !/[A-Za-z_$*{'"`]/.test(after[1])) continue;       // import.meta / import( → 交给后面的检测
    if (after[1] === '(') continue;
    let end = -1;
    for (let i = m.index; i < masked.length; i++) if (masked[i] === ';' && depth[i] === 0) { end = i + 1; break; }
    if (end < 0 || end - m.index > 4000) fail(`${id}:${lineOf(m.index)} 顶层 import 语句没有以 \`;\` 结束（bundle 内联要求单条完整语句）`);
    const text = src.slice(m.index, end);
    const maskedText = masked.slice(m.index, end);
    mod.edits.push({ start: m.index, end, text: '' });
    const line = lineOf(m.index);
    const side = /^\s*import\s*(['"])([\s\S]*?)\1\s*;?\s*$/d.exec(maskedText);
    if (side) {
      const spec = src.slice(m.index + side.indices[2][0], m.index + side.indices[2][1]);
      mod.deps.push({ spec, line, side: true });
      continue;
    }
    const fm = /^\s*import\s+([\s\S]+?)\s+from\s+(['"])([\s\S]*?)\2\s*;?\s*$/d.exec(maskedText);
    if (!fm) fail(`${id}:${line} 无法解析的 import 语句：\n  ${text.trim()}`);
    const clause = src.slice(m.index + fm.indices[1][0], m.index + fm.indices[1][1]);
    const spec = src.slice(m.index + fm.indices[3][0], m.index + fm.indices[3][1]);
    mod.deps.push({ spec, line });
    for (const part of splitTopLevel(clause, ',')) {
      const p = part.trim();
      if (!p) continue;
      let mm = /^\*\s*as\s+([\w$]+)$/.exec(p);
      if (mm) { mod.bindings.push({ kind: 'namespace', local: mm[1], imported: '*', spec, line }); continue; }
      mm = /^\{([\s\S]*)\}$/.exec(p);
      if (mm) {
        for (const n of splitTopLevel(mm[1], ',')) {
          const t = n.trim(); if (!t) continue;
          const nm = /^([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(t);
          if (!nm) fail(`${id}:${line} 无法解析的具名导入项：${t}`);
          mod.bindings.push({ kind: 'named', imported: nm[1], local: nm[2] || nm[1], spec, line });
        }
        continue;
      }
      if (/^[\w$]+$/.test(p)) { mod.bindings.push({ kind: 'default', imported: 'default', local: p, spec, line }); continue; }
      fail(`${id}:${line} 无法解析的 import 子句：${p}`);
    }
  }

  // ② 顶层声明（深度 0）——跨模块同名检测 + 导出面
  mod.declared = new Set();
  for (const m of masked.matchAll(/^[ \t]*(?:export\s+)?(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
    if (depth[m.index] !== 0) continue;
    mod.declared.add(m[1]);
    if (/^[ \t]*(?:export\s+)?(?:const|let|var)\b/.test(m[0])) {      // `const a = 1, b = 2;` 的后续声明符
      let e = masked.indexOf(';', m.index); if (e < 0) e = src.length;
      const stmt = src.slice(m.index, e);
      const stmtMasked = masked.slice(m.index, e);
      const first = stmtMasked.indexOf(m[1]);
      for (const d of splitTopLevel(stmt.slice(first + m[1].length), ',')) {
        const dm = /^\s*([A-Za-z_$][\w$]*)\s*=/.exec(d);
        if (dm && stmt.slice(first + m[1].length).indexOf(d) > -1) mod.declared.add(dm[1]);
      }
    }
  }

  // ③ export 形态
  //   3a. `export const/let/var/function/class/async function NAME` → 仅去掉 `export ` 前缀
  for (const m of masked.matchAll(/^[ \t]*export\s+(?=(?:const|let|var|function|class|async\s+function)\b)/gm)) {
    if (depth[m.index] !== 0) continue;
    const start = m.index + m[0].length - 'export '.length;
    mod.edits.push({ start, end: start + 'export '.length, text: '' });
    const nm = /^[ \t]*(?:const|let|var|function|class|async\s+function)\s+([A-Za-z_$][\w$]*)/.exec(src.slice(start + 7));
    if (nm) mod.exports.set(nm[1], nm[1]);
  }
  //   3b. `export default` → 具名常量（复杂形态直接拒绝，不猜）
  const defM = /^[ \t]*export\s+default\b/m.exec(masked);
  if (defM) {
    if (depth[defM.index] !== 0) fail(`${id}:${lineOf(defM.index)} export default 不在顶层`);
    const rest = src.slice(defM.index + defM[0].length);
    if (/^\s*(function|class|async)\b/.test(rest)) fail(`${id}:${lineOf(defM.index)} 只支持 \`export default <表达式>;\`（function/class 默认导出请改具名 + \`export { name as default }\`）`);
    const e = masked.indexOf(';', defM.index);
    if (e < 0 || depth[e] !== 0) fail(`${id}:${lineOf(defM.index)} export default 语句未以 \`;\` 结束`);
    mod.defaultLocal = '__mpw_default__' + sanitize(id);
    mod.edits.push({ start: defM.index, end: defM.index + defM[0].length, text: 'const ' + mod.defaultLocal + ' =' });
    mod.exports.set('default', mod.defaultLocal);
  }
  //   3c. `export { a, b as c };` / `export { a } from './x.js';` / `export * from './x.js';`
  for (const m of masked.matchAll(/^[ \t]*export\s*(?=\{|\*)/gm)) {
    if (depth[m.index] !== 0) continue;
    const tail = masked.slice(m.index + m[0].length);
    const star = /^\*\s*from\s*(['"])([\s\S]*?)\1\s*;/d.exec(tail);
    if (star) {
      const spec = src.slice(m.index + m[0].length + star.indices[2][0], m.index + m[0].length + star.indices[2][1]);
      mod.edits.push({ start: m.index, end: m.index + m[0].length + star[0].length, text: '' });
      mod.reexports.push({ kind: 'all', spec, line: lineOf(m.index) });
      mod.deps.push({ spec, line: lineOf(m.index) });
      continue;
    }
    if (/^\*\s*as\b/.test(tail)) fail(`${id}:${lineOf(m.index)} 不支持 \`export * as ns from\`（请改为先 import 再 export）`);
    const close = findMatching(masked, m.index + m[0].length, '{', '}');
    if (close < 0) fail(`${id}:${lineOf(m.index)} export 列表未闭合`);
    let p = close + 1;
    while (/\s/.test(masked[p] || '')) p++;
    let spec = null;
    const fromM = /^from\s*(['"])([\s\S]*?)\1/d.exec(masked.slice(p));
    if (fromM) {
      spec = src.slice(p + fromM.indices[2][0], p + fromM.indices[2][1]);
      p += fromM[0].length;
    }
    while (/\s/.test(masked[p] || '')) p++;
    if (masked[p] !== ';') fail(`${id}:${lineOf(m.index)} export 列表后缺少 \`;\``);
    const names = src.slice(m.index + m[0].length + 1, close);
    mod.edits.push({ start: m.index, end: p + 1, text: '' });
    const parsed = [];
    for (const part of splitTopLevel(names, ',')) {
      const t = part.trim(); if (!t) continue;
      const nm = /^([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(t);
      if (!nm) fail(`${id}:${lineOf(m.index)} 无法解析的导出项：${t}`);
      parsed.push([nm[1], nm[2] || nm[1]]);
    }
    if (spec) {
      mod.deps.push({ spec, line: lineOf(m.index) });
      mod.reexports.push({ kind: 'names', spec, line: lineOf(m.index), names: parsed });
    } else {
      for (const [local, exported] of parsed) mod.exports.set(exported, local);
    }
  }

  // ④ 危险形态
  for (const m of masked.matchAll(/\bimport\s*\(/g)) {
    fail(`${id}:${lineOf(m.index)} 动态 import() 无法内联（请改静态 import，或把该模块排除在 bundle 之外）`);
  }
  for (const h of findTopLevelAwait(masked)) {
    const lineText = src.split('\n')[h.line - 1] || '';
    if (/mpw-bundle:allow-tla/.test(lineText)) { mod.allowTla.add(h.line); continue; }
    fail(`${id}:${h.line} 顶层 await 无法内联（拼接序没有 TLA 的求值顺序保证）；确需保留请在该行加注释 /* mpw-bundle:allow-tla */`);
  }
  // 模块相对引用（`import.meta.url`）——单文件装载时的"已知差异"来源，写进 manifest
  const srcLines = src.split('\n');
  const maskedLines = masked.split('\n');
  mod.importMeta = srcLines
    .map((l, i) => ({ line: i + 1, text: l.trim() }))
    .filter((l) => /import\.meta/.test(maskedLines[l.line - 1] || ''));
  return mod;
}

/** 依赖图（深度优先后序 = ESM 求值顺序）；循环 import 直接报错。 */
function buildGraph(entryAbs) {
  const mods = new Map();
  const state = new Map();
  const order = [];
  const visit = (abs, chain) => {
    const st = state.get(abs);
    if (st === 'done') return;
    if (st === 'visiting') fail(`循环 import：${chain.concat(rel(abs)).join(' → ')}（拼接序会踩 TDZ，请先解环）`);
    state.set(abs, 'visiting');
    const mod = mods.get(abs) || analyzeModule(abs);
    mods.set(abs, mod);
    const dir = path.dirname(abs);
    const seen = new Set();
    for (const d of mod.deps) {
      if (!d.spec.startsWith('.')) continue;
      const depAbs = path.resolve(dir, d.spec);
      if (seen.has(depAbs)) continue;
      seen.add(depAbs);
      if (!fs.existsSync(depAbs)) fail(`${mod.id}:${d.line} 相对依赖不存在：${d.spec}`);
      d.abs = depAbs;
      visit(depAbs, chain.concat(mod.id));
    }
    state.set(abs, 'done');
    order.push(mod);
  };
  visit(entryAbs, []);
  return { order, entry: mods.get(entryAbs) };
}

/** 外部依赖归并 + 全局绑定冲突检测（宁可报错，也不产出"静默互相覆盖"的文件）。 */
function linkModules(order, allowExternal) {
  const named = new Map();      // spec → Map(imported → local)
  const defaults = new Map();   // spec → local
  const namespaces = new Map(); // spec → local
  const liveWarn = [];
  for (const mod of order) {
    mod.added = [];              // 本模块往共享作用域里**新增**的绑定（import 名/别名/命名空间对象）
    const depOf = (spec) => order.find((m) => m.abs === path.resolve(path.dirname(mod.abs), spec));
    // 纯副作用 import（`import './x.js'`）：相对 ⇒ 已内联；裸包 ⇒ 同外部依赖规则
    for (const d of mod.deps) {
      if (!d.side || d.spec.startsWith('.')) continue;
      if (!(d.spec.startsWith('node:') || NODE_BUILTINS.has(d.spec) || allowExternal.has(d.spec))) {
        fail(`${mod.id}:${d.line} 无法内联的裸包副作用 import \`${d.spec}\`（可用 --allow-external ${d.spec} 放行）`);
      }
    }
    for (const b of mod.bindings) {
      const internal = b.spec.startsWith('.');
      if (internal) {
        const dep = depOf(b.spec);
        if (!dep) fail(`${mod.id}:${b.line} 内部依赖未解析：${b.spec}`);
        b.internal = dep;
        if (b.kind === 'named' && !dep.exports.has(b.imported)) fail(`${mod.id}:${b.line} ${dep.id} 没有导出 \`${b.imported}\``);
        if (b.kind === 'default' && !dep.defaultLocal) fail(`${mod.id}:${b.line} ${dep.id} 没有 default 导出`);
        if (b.kind === 'named' && b.local === b.imported) continue;      // 同名 ⇒ 共享作用域里直接可用，零改写
        b.alias = b.local;                                              // 别名常量沿用本地名（引用处零改写）
        b.target = b.kind === 'namespace' ? null : (b.kind === 'default' ? dep.defaultLocal : dep.exports.get(b.imported));
        // 内部别名会在本模块顶部新增一条 `const 本地名 = …` ⇒ 同名一律当冲突（同 ESM 一句一绑定）
        mod.added.push({ name: b.local, line: b.line, what: b.kind + ' import from ' + b.spec, identity: 'int|' + mod.id + '|' + b.local });
        const letVar = new RegExp('^[ \\t]*(?:export\\s+)?(?:let|var)\\s+' + b.imported + '\\b', 'm');
        if (letVar.test(dep.masked)) {
          const reassigned = new RegExp('\\b' + b.imported + '\\s*=(?!=)', 'g');
          if ([...dep.masked.matchAll(reassigned)].length > 1) liveWarn.push(`${mod.id}:${b.line} 改名导入的 \`${b.imported}\` 在 ${dep.id} 里是 let/var 且被重新赋值 —— ESM 活绑定语义退化为快照`);
        }
      } else {
        const isBuiltin = b.spec.startsWith('node:') || NODE_BUILTINS.has(b.spec);
        if (!isBuiltin && !allowExternal.has(b.spec)) {
          fail(`${mod.id}:${b.line} 无法内联的裸包 import \`${b.spec}\`（离线单文件装不了 node_modules）。\n  确需保留请加 --allow-external ${b.spec}（bundle 将依赖使用方环境里能解析到它）`);
        }
        mod.added.push({ name: b.local, line: b.line, what: b.kind + ' import from ' + b.spec, identity: 'ext|' + b.spec + '|' + b.kind + '|' + b.imported });
        if (b.kind === 'named') {
          if (!named.has(b.spec)) named.set(b.spec, new Map());
          const mm = named.get(b.spec);
          const prev = mm.get(b.imported);
          if (prev && prev !== b.local) fail(`${b.imported} 从 ${b.spec} 被两个模块以不同本地名导入（${prev} / ${b.local}）—— 请统一命名`);
          mm.set(b.imported, b.local);
        } else if (b.kind === 'default') {
          if (defaults.has(b.spec) && defaults.get(b.spec) !== b.local) fail(`默认导入 ${b.spec} 在两个模块里用了不同本地名`);
          defaults.set(b.spec, b.local);
        } else {
          if (namespaces.has(b.spec) && namespaces.get(b.spec) !== b.local) fail(`命名空间导入 ${b.spec} 在两个模块里用了不同本地名`);
          namespaces.set(b.spec, b.local);
        }
      }
    }
  }
  // 共享作用域唯一性：所有模块的顶层声明 + 所有新增绑定，两两不得重名
  const owner = new Map();
  for (const mod of order) {
    for (const n of mod.declared) {
      const prev = owner.get(n);
      if (prev) fail(`跨模块顶层同名声明：${prev.mod} 与 ${mod.id} 都声明了 \`${n}\`（拼接后会静默覆盖，请改名）`);
      owner.set(n, { mod: mod.id, what: '顶层声明' });
    }
  }
  for (const mod of order) {
    for (const a of mod.added) {
      const prev = owner.get(a.name);
      if (prev && prev.identity !== a.identity) fail(`共享作用域重名：\`${a.name}\`（${mod.id}:${a.line} 的 ${a.what}）与 ${prev.mod} 的${prev.what} 冲突`);
      if (prev) continue;                       // 同一个外部绑定被多个模块导入 ⇒ 提升后只声明一次，合法
      owner.set(a.name, { mod: mod.id, what: a.what, identity: a.identity });
    }
  }
  // re-export 展开（依赖方导出面已知）
  for (const mod of order) {
    for (const r of mod.reexports) {
      const dep = order.find((m) => m.abs === path.resolve(path.dirname(mod.abs), r.spec));
      if (!dep) fail(`${mod.id}:${r.line} re-export 目标未解析：${r.spec}`);
      if (r.kind === 'all') { for (const [k, v] of dep.exports) if (!mod.exports.has(k)) mod.exports.set(k, v); continue; }
      for (const [local, exported] of r.names) {
        if (!dep.exports.has(local)) fail(`${mod.id}:${r.line} ${dep.id} 没有导出 \`${local}\``);
        mod.exports.set(exported, dep.exports.get(local));
      }
    }
  }
  return { named, defaults, namespaces, liveWarn };
}

/** 生成外部 import（按 spec 排序 ⇒ 字节级可复现）。 */
function emitExternalImports(externals) {
  const lines = [];
  const specs = new Set([...externals.named.keys(), ...externals.defaults.keys(), ...externals.namespaces.keys()]);
  for (const spec of [...specs].sort()) {
    const d = externals.defaults.get(spec) || null;
    const ns = externals.namespaces.get(spec) || null;
    const nm = externals.named.get(spec) || new Map();
    const namedList = [...nm.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([imported, local]) => (imported === local ? imported : `${imported} as ${local}`));
    if (d && ns) lines.push(`import ${d}, * as ${ns} from ${quoteSpec(spec)};`);
    else if (nm.size) lines.push(`import ${d ? d + ', ' : ''}{ ${namedList.join(', ')} } from ${quoteSpec(spec)};`);
    else if (d) lines.push(`import ${d} from ${quoteSpec(spec)};`);
    if (ns && !d) lines.push(`import * as ${ns} from ${quoteSpec(spec)};`);
  }
  return lines;
}

/** 改写单个模块：删 import/export 语句 + 给"改名/默认/命名空间"导入补别名常量。 */
function rewriteModule(mod, order) {
  const aliases = [];
  for (const b of mod.bindings) {
    if (!b.internal || (!b.alias)) continue;
    const target = b.kind === 'namespace'
      ? '{ ' + [...b.internal.exports.entries()]
        .map(([k, v]) => (k === 'default' ? `default: ${v}` : (v === k ? k : `${k}: ${v}`))).join(', ') + ' }'
      : b.target;
    aliases.push(`const ${b.alias} = ${target}; // ← import ${b.kind === 'namespace' ? '* as ' : ''}${b.local} from ${quoteSpec(b.spec)}`);
  }
  let body = mod.src;
  for (const e of [...mod.edits].sort((a, b) => b.start - a.start)) body = body.slice(0, e.start) + e.text + body.slice(e.end);
  const head = aliases.length ? aliases.join('\n') + '\n' : '';
  return (head + body).replace(/^\s*\n/, '');
}

function build(entryRel, outRel, opts = {}) {
  const entryAbs = path.resolve(ROOT, entryRel);
  if (!fs.existsSync(entryAbs)) fail(`入口不存在：${entryRel}`);
  const { order, entry } = buildGraph(entryAbs);
  const externals = linkModules(order, opts.allowExternal || new Set());
  const entryExportNames = [...entry.exports.keys()].filter((k) => k !== 'default').sort();
  const header = [
    '// ⚠ 自动生成，请勿手改 —— 由 tools/build-bundle.mjs 从宿主端源码内联而成。',
    `// 入口：${entryRel}`,
    `// 内联模块（求值序）：${order.map((m) => m.id).join(' → ')}`,
    '// 重新生成：node tools/build-bundle.mjs     与源码对拍：node tools/build-bundle.mjs --check',
    '// 手动装载：在 profile 的 cordis.patch.yml 里按**绝对路径**登记（见 README「方式四」）：',
    '//   - insert:',
    '//       - id: dsh-mpkg-wallpaper',
    '//         name: /绝对路径/dsh-mpkg-wallpaper.bundle.mjs',
    '// 注意：`import.meta.url` 指向本文件 ⇒ 模块相对资源（/lg/* 路由、ping.version）看"本文件旁边有什么"。',
  ].join('\n');
  const parts = [header, ''];
  const ext = emitExternalImports(externals);
  if (ext.length) parts.push('// ── 外部依赖（node 内建；ESM import 会提升，集中放文件头与各模块原位置等价）──', ...ext, '');
  for (const mod of order) {
    parts.push(`// ============================== ${mod.id}${mod === entry ? '（入口）' : ''} ==============================`);
    parts.push(rewriteModule(mod, order).replace(/\s*$/, '') + '\n');
  }
  if (entry.exports.size) {
    const exp = entryExportNames.slice();
    if (entry.exports.has('default')) exp.push('default');
    parts.push('// ── 入口导出面（与源码模块 namespace 逐名一致）──');
    parts.push(`export { ${exp.join(', ')} };`);
  }
  const bundle = parts.join('\n').replace(/\n{3,}/g, '\n\n');
  const outAbs = path.resolve(ROOT, outRel);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, bundle, 'utf8');
  try {
    execFileSync(process.execPath, ['--check', outAbs], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    try { fs.unlinkSync(outAbs); } catch { /* 忽略 */ }
    fail(`产出的 bundle 语法检查失败（已删除产物）：${String(e.stderr || e.message || e).slice(0, 400)}`);
  }
  const buf = fs.readFileSync(outAbs);
  const manifest = {
    tool: 'tools/build-bundle.mjs',
    entry: entryRel,
    out: outRel,
    sha256: sha256(buf),
    bytes: buf.length,
    generatedAt: new Date().toISOString(),
    modules: order.map((m) => ({ id: m.id, bytes: Buffer.byteLength(m.src, 'utf8'), sha256: sha256(m.src), exports: [...m.exports.keys()].sort() })),
    externalImports: [...new Set([...externals.named.keys(), ...externals.defaults.keys(), ...externals.namespaces.keys()])].sort(),
    exportNames: entryExportNames,
    moduleRelativeRefs: order.flatMap((m) => m.importMeta.map((r) => ({ module: m.id, line: r.line, code: r.text }))),
    allowedTlaLines: order.flatMap((m) => [...m.allowTla].map((l) => m.id + ':' + l)),
    liveBindingCaveats: externals.liveWarn,
    note: 'bundle 内 `import.meta.url` 指向 bundle 自己 ⇒ 模块相对资源需伴生文件（README 方式四）',
  };
  if (opts.manifest !== false) {
    const mp = path.resolve(ROOT, opts.manifestPath || MANIFEST);
    fs.mkdirSync(path.dirname(mp), { recursive: true });
    fs.writeFileSync(mp, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  }
  return { outAbs, bundle, manifest };
}

/* ─────────────────────────────── --check：与源码对拍 ─────────────────────────────── */
// 路由桩与 `tools/scene-audio-route-test.mjs` 同款（Writable 桩 res + routes 收集器）
class StubRes extends Writable {
  constructor() { super(); this.chunks = []; this.status = 0; this.headers = {}; }
  _write(c, e, cb) { this.chunks.push(Buffer.from(c)); cb(); }
  writeHead(code, headers) { this.status = code; Object.assign(this.headers, headers || {}); return this; }
  setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; }
  get body() { return Buffer.concat(this.chunks); }
}
async function applyAndCollect(mod) {
  const routes = [];
  mod.apply({ webServer: { register: (r) => routes.push(r) }, loader: null, logger: { info() {}, warn() {}, error() {} } });
  return routes;
}
async function callRoute(routes, routePath, { method = 'GET', url = routePath } = {}) {
  const bare = String(url).split('?')[0];
  // 与宿主同款匹配：exact 优先，其次 prefix（`/lg` 就是 prefix 路由）
  const r = routes.find((x) => x.kind === 'exact' && x.path === bare)
    || routes.find((x) => x.kind === 'prefix' && (bare === x.path || bare.startsWith(x.path + '/')));
  if (!r) return { status: 0, headers: {}, body: Buffer.alloc(0), missing: true };
  const res = new StubRes();
  const done = new Promise((resolve) => res.on('finish', resolve));
  await r.handler({ method, url, headers: {} }, res);
  await Promise.race([done, new Promise((r2) => setTimeout(r2, 3000))]);
  return { status: res.status, headers: res.headers, body: res.body };
}
const routeKey = (r) => r.kind + ' ' + r.path;
function mkFixture(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'mpw-bundle-'));
  process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ } });
  return dir;
}

async function runCheck({ entryRel, bundleRel }) {
  const entryAbs = path.resolve(ROOT, entryRel);
  const bundleAbs = path.resolve(ROOT, bundleRel);
  if (!fs.existsSync(bundleAbs)) fail(`--check 找不到产物：${bundleRel}（先跑一次构建）`);
  let pass = 0, bad = 0;
  const ok = (cond, name, extra = '') => { if (cond) { pass++; console.log('  ✓ ' + name + (extra ? '  [' + extra + ']' : '')); } else { bad++; console.error('  ✗ ' + name + (extra ? ' → ' + extra : '')); } };
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  const home = mkFixture('mpw-bundle-home-');            // DSH_HOME 必须在 import 之前（DATA_DIR 在加载期定）
  process.env.DSH_HOME = home;

  const srcMod = await import(pathToFileURL(entryAbs).href);
  const bndMod = await import(pathToFileURL(bundleAbs).href);

  console.log('\n== ① 导出面（源码 namespace vs bundle namespace）==');
  const srcKeys = Object.keys(srcMod).sort();
  const bndKeys = Object.keys(bndMod).sort();
  ok(eq(srcKeys, bndKeys), '导出名集合逐项相等', `n=${srcKeys.length}: ${srcKeys.join(',')}`);
  for (const k of ['apply', 'name', 'Config', 'inject']) {
    const s = k in srcMod, b = k in bndMod;
    ok(s === b, `${k}：源码${s ? '有' : '无'} ⇒ bundle ${b ? '有' : '无'}`);
    if (s && b) ok(typeof srcMod[k] === typeof bndMod[k], `${k} 类型一致（${typeof srcMod[k]}）`);
  }
  if (!('name' in srcMod) && !('Config' in srcMod)) {
    console.log('    · 说明：宿主端源码本就**没有** `name`/`Config` 导出（未引入 cordis/schemastery 配置面），');
    console.log('      所以这里只能断言"两边一致"；插件名与配置面由 package.json 的 dsh 字段 + cordis.patch.yml 声明。');
  }
  ok(typeof bndMod.apply === 'function', 'bundle 暴露可调用的 apply()');
  if ('inject' in srcMod && 'inject' in bndMod) ok(eq(srcMod.inject, bndMod.inject), 'inject 声明一致', JSON.stringify(bndMod.inject));
  ok(!!bndMod.__mpwTest && !!srcMod.__mpwTest, '__mpwTest 测试出口两边都在（transcode-limit-test 依赖它）');

  console.log('\n== ② 路由表（kind + path，逐项相等）==');
  const srcRoutes = await applyAndCollect(srcMod);
  const bndRoutes = await applyAndCollect(bndMod);
  const srcKeysR = srcRoutes.map(routeKey).sort();
  const bndKeysR = bndRoutes.map(routeKey).sort();
  ok(eq(srcKeysR, bndKeysR), `路由 ${srcKeysR.length} 条（源码）== ${bndKeysR.length} 条（bundle）`);
  if (!eq(srcKeysR, bndKeysR)) {
    console.error('    仅源码有: ' + srcKeysR.filter((k) => !bndKeysR.includes(k)).join(', '));
    console.error('    仅 bundle 有: ' + bndKeysR.filter((k) => !srcKeysR.includes(k)).join(', '));
  }
  ok(bndRoutes.every((r) => typeof r.handler === 'function'), 'bundle 每条路由的 handler 均可调用');

  console.log('\n== ③ /api/mpkg-wallpaper/ping JSON 形状 ==');
  const sp = await callRoute(srcRoutes, '/api/mpkg-wallpaper/ping');
  const bp = await callRoute(bndRoutes, '/api/mpkg-wallpaper/ping');
  const sj = sp.status === 200 ? JSON.parse(sp.body.toString('utf8')) : null;
  const bj = bp.status === 200 ? JSON.parse(bp.body.toString('utf8')) : null;
  ok(sp.status === 200 && bp.status === 200, `HTTP 200（源码 ${sp.status} / bundle ${bp.status}）`);
  ok(!!sj && !!bj && eq(Object.keys(sj).sort(), Object.keys(bj).sort()), 'JSON 键集合逐项相等', bj ? Object.keys(bj).sort().join(',') : '(无)');
  ok(!!bj && bj.ok === true, 'bundle ok===true');
  ok(!!sj && !!bj && sj.ok === bj.ok, 'ok 取值一致');

  console.log('\n== ④ 模块相对资源（import.meta.url）：已知差异按装载目录判定 ==');
  const bundleDir = path.dirname(bundleAbs);
  const companionPkg = path.resolve(bundleDir, '..', 'package.json');
  const companionLg = path.join(bundleDir, 'liquid-glass', 'v2-geometry.js');
  const hasPkg = fs.existsSync(companionPkg);
  const hasLg = fs.existsSync(companionLg);
  ok(!!bj && (bj.version === (sj && sj.version) || bj.version === null),
    `ping.version：源码 ${sj && sj.version} / bundle ${bj && bj.version}`,
    hasPkg ? '伴生 package.json 在 ⇒ 期望相等' : '无伴生 package.json ⇒ 期望 null（已文档化）');
  if (hasPkg) ok(!!bj && bj.version === (sj && sj.version), '伴生 package.json ⇒ bundle 版本号与源码一致');
  const lg = await callRoute(bndRoutes, '/api/mpkg-wallpaper/lg/v2-geometry.js');
  if (hasLg) {
    const srcLg = await callRoute(srcRoutes, '/api/mpkg-wallpaper/lg/v2-geometry.js');
    ok(lg.status === 200 && srcLg.status === 200 && lg.body.equals(srcLg.body),
      '/lg/v2-geometry.js：伴生 liquid-glass/ 在 ⇒ 200 且与源码逐字节相同', `len=${lg.body.length}`);
  } else {
    ok(lg.status === 404, '/lg/* 无伴生 liquid-glass/ ⇒ 404（README 方式四写明这是已知差异）', 'status=' + lg.status);
  }

  console.log(`\n对拍结果: ${pass} 通过, ${bad} 失败`);
  const st = fs.statSync(bundleAbs);
  console.log(`产物: ${bundleRel}  ${(st.size / 1024).toFixed(1)}KB  sha256=${sha256(fs.readFileSync(bundleAbs)).slice(0, 16)}…`);
  if (bad) { console.error('✗ bundle 与源码不一致——不要分发这个产物'); process.exit(1); }
  console.log('✓ bundle 与源码在导出面/路由表/ping 形状上一致（模块相对资源的差异见上）');
}

/* ─────────────────────────────── CLI ─────────────────────────────── */
function parseArgs(argv) {
  const o = { entry: DEFAULT_ENTRY, out: DEFAULT_OUT, check: false, bundle: null, allowExternal: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') o.check = true;
    else if (a === '--entry') o.entry = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--bundle') o.bundle = argv[++i];
    else if (a === '--allow-external') o.allowExternal.add(argv[++i]);
    else if (a === '--help' || a === '-h') { console.log('用法: node tools/build-bundle.mjs [--entry lib/index.js] [--out dist/…mjs] [--check [--bundle <产物>]] [--allow-external <spec>]'); process.exit(0); }
    else fail(`未知参数：${a}`);
  }
  return o;
}

const args = parseArgs(process.argv.slice(2));
if (args.check) {
  const bundleRel = args.bundle || args.out;
  if (!fs.existsSync(path.resolve(ROOT, bundleRel))) {
    const r = build(args.entry, args.out, { allowExternal: args.allowExternal });
    console.log(`（--check 未找到产物，已先构建：${r.manifest.out} ${(r.manifest.bytes / 1024).toFixed(1)}KB sha256=${r.manifest.sha256}）`);
  }
  await runCheck({ entryRel: args.entry, bundleRel });
} else {
  const r = build(args.entry, args.out, { allowExternal: args.allowExternal });
  const m = r.manifest;
  console.log('== 单文件 bundle 构建 ==');
  console.log('  产物     : ' + m.out);
  console.log('  字节数   : ' + m.bytes + ' (' + (m.bytes / 1024).toFixed(1) + 'KB)');
  console.log('  sha256   : ' + m.sha256);
  console.log('  内联模块 : ' + m.modules.map((x) => x.id + '(' + x.bytes + 'B)').join(' + '));
  console.log('  外部依赖 : ' + (m.externalImports.join(', ') || '(无)'));
  console.log('  导出面   : ' + (m.exportNames.join(', ') || '(无)'));
  console.log('  清单     : ' + MANIFEST);
  if (m.liveBindingCaveats.length) for (const w of m.liveBindingCaveats) console.log('  ⚠ ' + w);
  if (m.moduleRelativeRefs.length) {
    console.log('  ⚠ 模块相对引用（决定"单文件是否够用"，见 README 方式四）：');
    for (const r2 of m.moduleRelativeRefs) console.log('      ' + r2.module + ':' + r2.line + '  ' + r2.code.slice(0, 100));
  }
  if (m.allowedTlaLines.length) console.log('  ⚠ 被注释放行的顶层 await：' + m.allowedTlaLines.join(', '));
}
