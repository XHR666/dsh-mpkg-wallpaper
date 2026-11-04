#!/usr/bin/env node
// tests/now-playing-test.mjs —— ①(P-138) NowPlaying 移植件（demo/now-playing/）的仓库侧自查
//
// ⚠ 登记情况（P-161 更正）：本文件**已经**在 `tests/run-all-tests.sh` 里（`add "now-playing" …`，
//   由 P-138 那批登记）—— 上面那句"尚未登记"是过期注释，本批顺手改正。
//
// 口径：秒级、无浏览器、无 GPU、无网络。不需要 node_modules —— 唯一需要依赖的那一组
// （⑦ SSR 渲染探针，用 react-dom/server 在 Node 里把组件渲染成 HTML）在没有
// node_modules/esbuild 时**明确打印 SKIP**并跳过，不假装跑过。
//
// 为什么有一组"变异自证"：本文件里有一半判据是"某处**不应该**存在"（没有裸 import、
// 没有全局 token、没有裸标签选择器）。这类断言最容易写成"永远为真"。所以第 ⑥ 组把
// 实现**故意改坏**（/tmp 副本，不动真树），要求同一批判据**必须变红** —— 红的证据会打出来。
//
// 用法: node tests/now-playing-test.mjs                     # 人读
//       node tests/now-playing-test.mjs --json              # 机读
//       node tests/now-playing-test.mjs --mutation-verbose  # 变异组多打几行
// 退出码：0 全过 / 1 有失败
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..");
const NP = path.join(ROOT, "demo", "now-playing");
const JSON_OUT = process.argv.includes("--json");
const MUT_VERBOSE = process.argv.includes("--mutation-verbose");

let pass = 0;
let fail = 0;
const results = [];
const check = (name, cond, detail) => {
  if (cond) pass++;
  else fail++;
  results.push({ name, ok: !!cond, detail: detail ? String(detail) : "" });
  if (!JSON_OUT) {
    if (cond) console.log("  ✓ " + name);
    else console.log("  ✗ " + name + (detail ? " — " + detail : ""));
  }
};
const group = (t) => { if (!JSON_OUT) console.log("\n── " + t + " ──"); };
const line = (t) => { if (!JSON_OUT) console.log(t); };

// ─────────────────────────────────────────────────────────────────────────────
// 任务书里那两段的**实测**条数（源：`$MPW_ROOT/../OPPO Share/TASKAM.md`
// 的 48–967 行 = NowPlaying.tsx 段，969–1344 行 = css 段；这两个数是拿
// `grep -c '/\* ── ' / '/\*'` 数出来的，不是估计）。
// 交付物里的条数**不许少**（注释是"照抄而不是重写"的主要理由）。
// ─────────────────────────────────────────────────────────────────────────────
const BOOK = { tsxDash: 22, tsxAll: 70, cssDash: 9, cssKeptAll: 16, cssDeletedAll: 20 - 16 };

// 删掉的四段注释（音效板 / 音效墙）—— 交付物里这些字样**不许**出现
const DELETED_COMMENT_MARKS = ["site/sound.ts", "The library wall", "the flying orb", "twelve keys"];
// 保留的关键注释（抽几条有辨识度的，防"注释被顺手精简"）
const KEPT_COMMENT_MARKS = [
  "eased, NOT sprung",
  "the offset FADES IN, it is not a constant",
  "ON THE CLOSE ONLY",
  "The points are lucide's own",
  "The sleeve is inlined rather than linked",
  "FILLED, not drawn",
  "isTrusted, or the demonstrations close it",
  "NO BORDER of its own",
  "a SECOND opinion",
  "the interface face, with tabular figures",
  "one spring, for everything that settles",
  "Frames, not milliseconds",
];

// 14 个 Bencho token 的映射表（与 demo/now-playing/README.md 的第 4 节同表）。
// project = 本项目已有 token（null = 本项目没有等价物，只能本地给值）；
// derivedFrom = 取哪个 token 的通道拆解；reads = 保留的 CSS 里还有没有 var() 读它。
const TOKEN_MAP = [
  { token: "--card", project: "--editor", fallback: "#1f1f1f", reads: true },
  { token: "--font-num", project: "--mono", fallback: null, reads: false },
  { token: "--font-ui", project: "--ui-font", fallback: null, reads: true },
  { token: "--ink", project: "--fg", fallback: "#cccccc", reads: true },
  { token: "--ink-3", project: "--fg-dim", fallback: "#9d9d9d", reads: true },
  { token: "--ink-4", project: "--fg-mute", fallback: "#6e6e6e", reads: true },
  { token: "--ink-rgb", project: null, derivedFrom: "--fg", bare: [204, 204, 204], reads: true },
  { token: "--on-ink", project: "--list-active-fg", fallback: "#ffffff", reads: true },
  { token: "--on-slab", project: "--fg", fallback: "#cccccc", reads: false },
  { token: "--pane", project: "--panel", fallback: null, reads: true },
  { token: "--pane-edge", project: "--border", fallback: "#2b2b2b", reads: true },
  { token: "--slab", project: "--input", fallback: "#313131", reads: false },
  { token: "--surface-2", project: "--sidebar", fallback: "#181818", reads: true },
  { token: "--surface-3", project: "--input", fallback: "#313131", reads: true },
];

// ── 简易 CSS 解析：去注释后按大括号切规则，记录嵌套与字符区间 ────────────────
function parseCss(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  const stack = [];
  const rules = [];
  let buf = "";
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") {
      const node = { sel: buf.trim(), depth: stack.length, parent: stack.length ? stack[stack.length - 1].sel : null, start: i, end: -1, open: true };
      rules.push(node);
      stack.push(node);
      buf = "";
    } else if (ch === "}") {
      const n = stack.pop();
      if (n) n.end = i;
      buf = "";
    } else if (stack.length) {
      // 规则体只用于"这个 token 定义落在哪条规则里"，这里不需要内容
    } else {
      buf += ch;
    }
  }
  return { rules, text: src };
}
const selectorList = (sel) => sel.split(",").map((s) => s.trim()).filter(Boolean);

// ═══ 判据工厂：主跑与变异跑共用（变异能变红，靠的就是这里只有一份判据） ═══
function concentricFacts(m) {
  return [0, 16, 32].map((corner) => {
    const art = m.artRadius(corner);
    const box = m.boxRadius(corner);
    const off = m.cornerOffset(corner);
    const ok = Math.abs(box[0] - art[0] - off) < 1e-12 && Math.abs(box[1] - art[1] - off) < 1e-12;
    return { name: `corner=${corner} 同心：boxR − artR == off`, ok, detail: `artR=[${art}] boxR=[${box}] off=${off}` };
  });
}
function swellPeakFact(m) {
  let best = -1, at = -1;
  for (let i = 0; i <= 10000; i++) {
    const u = i / 10000;
    const v = m.swell(u);
    if (v > best) { best = v; at = u; }
  }
  return { name: "swell 峰值落在 u≈0.63", ok: Math.abs(at - 0.63) < 0.01 && best > 0.99, detail: `argmax=${at} max=${best.toFixed(6)}` };
}
/* ①(P-161) 进度条换算的边界（主跑与变异共用同一份判据 ⇒ 变异能红） */
function seekRatioFacts(m) {
  const cases = [
    { name: "左端（x == left）⇒ 0", x: 100, rect: { left: 100, width: 200 }, want: 0 },
    { name: "中点 ⇒ 0.5", x: 200, rect: { left: 100, width: 200 }, want: 0.5 },
    { name: "右端（x == left+width）⇒ 1", x: 300, rect: { left: 100, width: 200 }, want: 1 },
    { name: "条**左侧**外面 ⇒ 钳到 0（不给负进度）", x: 20, rect: { left: 100, width: 200 }, want: 0 },
    { name: "条**右侧**外面 ⇒ 钳到 1（不给 >100%）", x: 999, rect: { left: 100, width: 200 }, want: 1 },
  ];
  return cases.map((c) => {
    const got = m.seekRatio(c.x, c.rect);
    return { name: `seekRatio ${c.name}`, ok: got !== null && Math.abs(got - c.want) < 1e-12, detail: `got=${got} want=${c.want}` };
  }).concat([
    { name: "width ≤ 0 ⇒ null（不把进度算成 0/NaN）", ok: m.seekRatio(10, { left: 0, width: 0 }) === null, detail: String(m.seekRatio(10, { left: 0, width: 0 })) },
    { name: "坐标不是有限数 ⇒ null", ok: m.seekRatio("x", { left: 0, width: 10 }) === null && m.seekRatio(NaN, { left: 0, width: 10 }) === null, detail: String(m.seekRatio("x", { left: 0, width: 10 })) },
    { name: "rect 缺失 ⇒ null（不抛）", ok: m.seekRatio(10, null) === null, detail: String(m.seekRatio(10, null)) },
  ]);
}

function cssScopeFacts(cssText) {
  const { rules } = parseCss(cssText);
  const bad = [];
  for (const r of rules) {
    if (r.sel.startsWith("@")) {
      // @media / @keyframes 的**头**允许；里面的块由下面按父节点处理
      if (!/^@(media|keyframes)\b/.test(r.sel)) bad.push(`未知 at-rule: ${r.sel}`);
      continue;
    }
    if (r.parent && r.parent.startsWith("@keyframes")) continue; // 0% / 38% / 100%
    for (const s of selectorList(r.sel)) {
      if (!s.startsWith(".snd")) bad.push(`选择器不以 .snd 开头: ${s}`);
      if (/^(body|html|:root|\*)\b/.test(s)) bad.push(`裸/全局选择器: ${s}`);
      if (/(^|[\s,>+~])(body|html|:root|\*)([\s,>+~.:#[]|$)/.test(s)) bad.push(`选择器里含全局目标: ${s}`);
    }
  }
  return [{ name: "每条选择器都以 .snd 开头且在 .snd 子树内", ok: bad.length === 0, detail: bad.slice(0, 4).join(" | ") }];
}
function tokenFacts(cssText) {
  const { rules, text } = parseCss(cssText);
  const sndRule = rules.find((r) => r.sel === ".snd" && r.depth === 0);
  if (!sndRule || sndRule.end < 0) return [{ name: ".snd 规则块存在（token 的落点）", ok: false, detail: "没找到顶层 .snd{}" }];
  const defs = [...text.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => ({ token: m[1], at: m.index }));
  const facts = [];
  const defined = new Set(defs.map((d) => d.token));
  const outside = defs.filter((d) => !(d.at > sndRule.start && d.at < sndRule.end));
  facts.push({
    name: "14 条自定义属性全部只定义在 .snd 规则内部（无新全局 token）",
    ok: outside.length === 0 && defs.length === TOKEN_MAP.length,
    detail: `定义 ${defs.length} 条，.snd 之外 ${outside.length} 条${outside.length ? "：" + outside.map((o) => o.token).join(",") : ""}`,
  });
  facts.push({
    name: "自定义属性的集合恰好是那 14 个（没有多也没有少）",
    ok: defined.size === TOKEN_MAP.length && TOKEN_MAP.every((t) => defined.has(t.token)),
    detail: `定义的: ${[...defined].join(" ")}`,
  });
  for (const t of TOKEN_MAP) {
    const one = defs.filter((d) => d.token === t.token);
    const inside = one.filter((d) => d.at > sndRule.start && d.at < sndRule.end);
    let ok = inside.length === 1;
    let detail = `定义 ${one.length} 处（.snd 内 ${inside.length} 处）`;
    if (ok && t.derivedFrom) {
      const re = new RegExp(`${t.token}\\s*:\\s*(\\d{1,3})\\s*,\\s*(\\d{1,3})\\s*,\\s*(\\d{1,3})\\s*;`);
      const m = text.match(re);
      ok = !!m && [m[1], m[2], m[3]].join(",") === t.bare.join(",");
      detail = m ? `值 ${m[1]},${m[2]},${m[3]}（= ${t.derivedFrom} 的三个裸数字）` : "不是三个裸数字";
    } else if (ok) {
      const m = text.match(new RegExp(`${t.token}\\s*:\\s*([^;]+);`));
      const val = m ? m[1].trim() : "";
      ok = val.includes(`var(${t.project}`);
      detail = `${t.token} → ${t.project}｜实际值: ${val.slice(0, 70)}`;
    }
    facts.push({ name: `${t.token} → ${t.project || t.derivedFrom + " 的拆解"}`, ok, detail });
    if (t.reads) {
      const reads = text.includes(`var(${t.token})`);
      facts.push({ name: `${t.token} 在保留的规则里确实被读（var()）`, ok: reads, detail: reads ? "" : "没有任何 var() 读它，说明映射是空转的" });
    }
  }
  return facts;
}

// ─────────────────────────────────────────────────────────────────────────────
// ⓪ 文件清单
// ─────────────────────────────────────────────────────────────────────────────
group("⓪ 落点与文件清单（demo/now-playing/）");
const FILES = ["NowPlaying.tsx", "now-playing-math.mjs", "now-playing.css", "mount.tsx", "icons.tsx", "index.html", "build.mjs", "package.json", "README.md", "dist/now-playing.js"];
for (const f of FILES) check(`在: ${f}`, fs.existsSync(path.join(NP, f)));

const tsx = fs.readFileSync(path.join(NP, "NowPlaying.tsx"), "utf8");
const mathSrc = fs.readFileSync(path.join(NP, "now-playing-math.mjs"), "utf8");
const css = fs.readFileSync(path.join(NP, "now-playing.css"), "utf8");
const mount = fs.readFileSync(path.join(NP, "mount.tsx"), "utf8");   // ①(P-161) ⑧ 组要查透传面
const dist = fs.readFileSync(path.join(NP, "dist", "now-playing.js"), "utf8");
const readme = fs.readFileSync(path.join(NP, "README.md"), "utf8");

// ─────────────────────────────────────────────────────────────────────────────
// ① 源码完整性 + 注释条数对账
// ─────────────────────────────────────────────────────────────────────────────
group("① 源码完整性（注释条数对账 / 导出名 / 该删的删了）");
{
  const count = (re, s) => (s.match(re) || []).length;
  const tsxDash = count(/\/\* ── /g, tsx + mathSrc);
  const tsxAll = count(/\/\*/g, tsx + mathSrc);
  const cssDash = count(/\/\* ── /g, css);
  const cssAll = count(/\/\*/g, css);
  line(`  注释条数：TSX+math ── ${tsxDash}/任务书 ${BOOK.tsxDash}、/* 共 ${tsxAll}/任务书 ${BOOK.tsxAll}；` +
    `CSS ── ${cssDash}/任务书 ${BOOK.cssDash}、/* 共 ${cssAll}/任务书保留段 ${BOOK.cssKeptAll}（整段 ${20}，删了 ${BOOK.cssDeletedAll} 条随规则一起删）`);
  check(`TSX+math 的 /* ── 注释块 ≥ 任务书条数（${tsxDash} ≥ ${BOOK.tsxDash}）`, tsxDash >= BOOK.tsxDash, `${tsxDash} vs ${BOOK.tsxDash}`);
  check(`TSX+math 的注释块总数 ≥ 任务书条数（${tsxAll} ≥ ${BOOK.tsxAll}）`, tsxAll >= BOOK.tsxAll, `${tsxAll} vs ${BOOK.tsxAll}`);
  check(`CSS 的 /* ── 注释块 ≥ 任务书保留条数（${cssDash} ≥ ${BOOK.cssDash}）`, cssDash >= BOOK.cssDash, `${cssDash} vs ${BOOK.cssDash}`);
  check(`CSS 的注释块总数 ≥ 保留段条数（${cssAll} ≥ ${BOOK.cssKeptAll}）`, cssAll >= BOOK.cssKeptAll, `${cssAll} vs ${BOOK.cssKeptAll}`);

  for (const m of KEPT_COMMENT_MARKS) check(`保留的注释还在：「${m}」`, (tsx + mathSrc + css).includes(m));
  for (const m of DELETED_COMMENT_MARKS) check(`删掉的段落注释没抄进来：「${m}」`, !css.includes(m));

  check("导出名是 NowPlaying", /export function NowPlaying\(/.test(tsx));
  check("没有留下 export function Sound（对外名已换）", !/export function Sound\(/.test(tsx));
  check("组件里保留 Mark / useTween / useSpring（原件结构未重写）",
    /function Mark\(/.test(tsx) && /function useTween\(/.test(tsx) && /function useSpring\(/.test(tsx));
  //  ⑤(P-164) 封面换成本仓所有者提供的品牌图（原 `../icons/pwa-512.png`）：断言跟着**新**路径走，
  //  判据不变（"不是空占位 / 图真的在仓库里"），只把落点从 `demo/icons/**` 换成 `demo/assets/brand/**`。
  check("COVER 不是空占位（指向本仓库的图）", /const COVER: string = "\.\.\/assets\/brand\/brand-512\.png"/.test(tsx), (tsx.match(/const COVER[^\n]*/) || [""])[0]);
  check("COVER 指到的图真的在仓库里", fs.existsSync(path.join(ROOT, "demo", "assets", "brand", "brand-512.png")));
  check("stroke 属性取代了 Bencho 的全局 [data-stroke]（组件写 data-stroke）", /data-stroke=\{stroke \? "on" : undefined\}/.test(tsx));
  check("保留的注释里那 4 处「原件世界」的说法没被删（wall/bench/CLAUDE.md）",
    /CLAUDE\.md/.test(tsx + mathSrc) && /lab\/motion/.test(mathSrc) && /scripts\/cover\.sh/.test(tsx));
}

// ─────────────────────────────────────────────────────────────────────────────
// ② 纯函数数字（now-playing-math.mjs）
// ─────────────────────────────────────────────────────────────────────────────
group("② 纯函数与几何常量（now-playing-math.mjs）");
const math = await import(pathToFileURL(path.join(NP, "now-playing-math.mjs")).href);
{
  const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
  check("QUART(0) = 0", math.QUART(0) === 0);
  check("QUART(1) = 1", math.QUART(1) === 1);
  check("QUART 是中段领先的 ease-out（QUART(0.5) > 0.5）", math.QUART(0.5) > 0.5, String(math.QUART(0.5)));
  check("QUART 不过冲（全程 ≤ 1）", Array.from({ length: 101 }, (_, i) => math.QUART(i / 100)).every((v) => v <= 1 + 1e-12));
  check("FLAT 是恒等", math.FLAT(0.37) === 0.37);
  check("SWING 两端为 0/1、中点为 0.5", math.SWING(0) === 0 && math.SWING(1) === 1 && close(math.SWING(0.5), 0.5));
  check("clamp / mix", math.clamp(5, 0, 1) === 1 && math.clamp(-5, 0, 1) === 0 && math.mix(2, 10, 0.25) === 4);

  check("W = 260（两端同一个宽度）", math.W === 260, String(math.W));
  check("SHUT = 78（不是 70 —— 轨道要自己一条带）", math.SHUT === 78, String(math.SHUT));
  check("PAD = 10 一个边距管两端", math.PAD === 10);
  check("ART.s = [40, 64]", JSON.stringify(math.ART.s) === "[40,64]", JSON.stringify(math.ART.s));
  check("CORNER = 16 / CORNER_MAX = 32", math.CORNER === 16 && math.CORNER_MAX === 32);
  check("TOTAL = 214（轨道长度）", math.TOTAL === 214);

  // OPEN 由公式推出来：RAIL_Y = PAD + ART.s[1] + RAIL_GAP；OPS_Y = RAIL_Y + RAIL_H + CLOCK_GAP + CLOCK_H + OPS_GAP + LEAD/2
  const railY = math.PAD + math.ART.s[1] + math.RAIL_GAP;
  const opsY = railY + math.RAIL_H + math.CLOCK_GAP + math.CLOCK_H + math.OPS_GAP + math.LEAD / 2;
  const open = Math.round(opsY + math.LEAD / 2 + math.PAD);
  check("RAIL_Y = PAD + ART.s[1] + RAIL_GAP", math.RAIL_Y === railY, `${math.RAIL_Y} vs ${railY}`);
  check("OPS_Y = RAIL_Y + RAIL_H + CLOCK_GAP + CLOCK_H + OPS_GAP + LEAD/2", math.OPS_Y === opsY, `${math.OPS_Y} vs ${opsY}`);
  check("OPEN = round(OPS_Y + LEAD/2 + PAD)", math.OPEN === open, `${math.OPEN} vs ${open}`);
  check("OPEN 的值 = 189（注释里那句 78 → 189 的那个 189）", math.OPEN === 189, String(math.OPEN));

  // 同心圆角：artR = [corner*40/64, corner]；off = PAD*min(1, corner/CORNER)；boxR = artR + off
  for (const corner of [0, 16, 32]) {
    const art = math.artRadius(corner);
    check(`artR[${corner}] = [corner*40/64, corner]`, close(art[0], (corner * 40) / 64) && art[1] === corner, `[${art}]`);
  }
  check("off(0) = 0 / off(16) = 10 / off(32) = 10（到默认值满、往上封顶）",
    math.cornerOffset(0) === 0 && math.cornerOffset(16) === 10 && math.cornerOffset(32) === 10,
    `${math.cornerOffset(0)} / ${math.cornerOffset(16)} / ${math.cornerOffset(32)}`);
  check("boxR(16) = [20, 26]（注释里「26 = 16 + 10、bar 的 20 = 10 + 10」）",
    JSON.stringify(math.boxRadius(16)) === "[20,26]", JSON.stringify(math.boxRadius(16)));
  for (const f of concentricFacts(math)) check(f.name, f.ok, f.detail);
  check("corner=0 时两个角一起变方（不是「几何同心但看起来两个决定」）",
    JSON.stringify(math.boxRadius(0)) === "[0,0]" && JSON.stringify(math.artRadius(0)) === "[0,0]");
  check("corner=32 时封面成圆（artR[1] = 32 = 64/2），盒子仍等距 42",
    math.artRadius(32)[1] === 32 && math.boxRadius(32)[1] === 42, JSON.stringify(math.boxRadius(32)));

  // swell / goo
  check("swell(0) = 0", Math.abs(math.swell(0)) < 1e-12, String(math.swell(0)));
  check("swell(1) = 0（sin(π) 的浮点余项 < 1e-9）", Math.abs(math.swell(1)) < 1e-9, String(math.swell(1)));
  const peak = swellPeakFact(math);
  check(peak.name, peak.ok, peak.detail);
  check("swell 中间确实鼓起来（swell(0.63) > 0.99）", math.swell(0.63) > 0.99, String(math.swell(0.63)));
  check("goo 两端为 0、中间为 1", Math.abs(math.goo(0)) < 1e-12 && Math.abs(math.goo(1)) < 1e-9 && math.goo(0.5) === 1);

  // 四边形的点插值：t=0/1 落在两端点上，t=0.5 是中点
  const pts = (d) => [...d.matchAll(/([ML])(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[2]), Number(m[3])]);
  const pL0 = pts(math.quad(math.PAUSE_L, math.PLAY_L, 0));
  const pL1 = pts(math.quad(math.PAUSE_L, math.PLAY_L, 1));
  const pLh = pts(math.quad(math.PAUSE_L, math.PLAY_L, 0.5));
  check("quad(t=0) 的八个点 = PAUSE_L（起点是端点）", pL0.every(([x, y], i) => Math.abs(x - math.PAUSE_L[i * 2]) < 0.01 && Math.abs(y - math.PAUSE_L[i * 2 + 1]) < 0.01), JSON.stringify(pL0));
  check("quad(t=1) 的八个点 = PLAY_L（终点是端点）", pL1.every(([x, y], i) => Math.abs(x - math.PLAY_L[i * 2]) < 0.01 && Math.abs(y - math.PLAY_L[i * 2 + 1]) < 0.01), JSON.stringify(pL1));
  check("quad(t=0.5) 是两端的中点", pLh.every(([x, y], i) => Math.abs(x - (math.PAUSE_L[i * 2] + math.PLAY_L[i * 2]) / 2) < 0.01 && Math.abs(y - (math.PAUSE_L[i * 2 + 1] + math.PLAY_L[i * 2 + 1]) / 2) < 0.01));
  check("左半页是**同一个四边形**（暂停的 4 点 → 播放的 4 点，不是两个图标）", math.PAUSE_L.length === 8 && math.PLAY_L.length === 8);
  check("右半页的播放是「右上两点重合」的三角形（13.25,8 / 20,12 / 20,12 / 13.25,16）", JSON.stringify(math.PLAY_R) === "[13.25,8,20,12,20,12,13.25,16]");

  // 时钟
  check("clock(0) = 0:00 / clock(52) = 0:52 / clock(214) = 3:34 / clock(65) = 1:05",
    math.clock(0) === "0:00" && math.clock(52) === "0:52" && math.clock(math.TOTAL) === "3:34" && math.clock(65) === "1:05",
    [math.clock(0), math.clock(52), math.clock(214), math.clock(65)].join(" "));
  check("clock 补零（9 → 0:09）", math.clock(9) === "0:09", math.clock(9));

  // 弹性 knobs：50 = 不变
  check("rate(50) = 1（滑杆中间 = 原件调好的时长）", math.rate(50) === 1, String(math.rate(50)));
  check("rate(0) = 1.6 / rate(100) = 0.4（两端都还能用，浮点容差 1e-12）",
    Math.abs(math.rate(0) - 1.6) < 1e-12 && Math.abs(math.rate(100) - 0.4) < 1e-12,
    `${math.rate(0)} / ${math.rate(100)}`);
  check("BASE * rate(50) = 460ms（注释里那个 460）", math.BASE * math.rate(50) === 460);
  check("overshoot(50, tuned) = tuned（中间 = 原件画的那个值）", math.overshoot(50, 1.34) === 1.34 && math.overshoot(50, 1.2) === 1.2);
  check("overshoot 随 bounce 增大而增大", math.overshoot(100, 1.34) > math.overshoot(50, 1.34) && math.overshoot(0, 1.34) < math.overshoot(50, 1.34));
  check("curve() 产出一条 cubic-bezier", /^cubic-bezier\(0\.28, [\d.]+, 0\.36, 1\)$/.test(math.curve(50, 1.34)), math.curve(50, 1.34));
  check("springOf(50) = {k: 0.16, d: 0.72}（注释里 50 是 Humidity/Brightness 那一档）",
    math.springOf(50).k === 0.16 && math.springOf(50).d === 0.72, JSON.stringify(math.springOf(50)));
  check("springOf 单调（0 → 重、100 → 活）", math.springOf(0).k < math.springOf(50).k && math.springOf(50).k < math.springOf(100).k && math.springOf(0).d < math.springOf(100).d);

  // 纯函数模块的"纯"：没有 React/DOM/import/随机
  const codeOnly = mathSrc.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  check("now-playing-math.mjs 没有任何 import（不依赖 React/DOM）", !/^\s*import\s/m.test(codeOnly));
  check("now-playing-math.mjs 不碰 window/document/performance", !/\b(window|document|performance|localStorage)\b/.test(codeOnly));
  check("now-playing-math.mjs 没有 Math.random / Date.now（可复现）", !/Math\.random|Date\.now/.test(codeOnly));
  check("now-playing-math.mjs 里没有 TypeScript 标注（它是 .mjs，只作为纯 JS 被 import）",
    !/:\s*(number|string|boolean|readonly)\b/.test(codeOnly) && !/\bas const\b/.test(codeOnly));

  // 组件从 math 里 import 的每个名字都得真的存在（防拼错/漏导）
  // 只认 source 是 math 的那一条 import（文件里第一条是 react 的，别被 [\s\S]*? 横跨过去）
  const imp = [...tsx.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*"([^"]+)"/g)].find((m) => m[2] === "./now-playing-math.mjs");
  const names = imp ? imp[1].split(",").map((s) => s.trim()).filter(Boolean).map((s) => s.split(/\s+as\s+/)[0]) : [];
  check("NowPlaying.tsx 从 math 里 import 了东西", names.length > 15, String(names.length));
  const missing = names.filter((n) => !(n in math));
  check("import 的每个名字 math 都导出了", missing.length === 0, missing.join(", "));
  for (const need of ["QUART", "FLAT", "SWING", "clamp", "mix", "quad", "artRadius", "boxRadius", "cornerOffset", "swell", "goo", "OPEN", "SHUT", "TOTAL"]) {
    check(`math 导出 ${need}`, need in math);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ③ CSS 作用域（机器判据）
// ─────────────────────────────────────────────────────────────────────────────
group("③ CSS 作用域：每条选择器都在 .snd 子树内");
{
  for (const f of cssScopeFacts(css)) check(f.name, f.ok, f.detail);
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  for (const gone of [".snd-wake", ".snd-grid", ".snd-key", ".snd-num", ".snd-name", ".sfx-wall", "snd-pitched"]) {
    check(`删掉的规则没回来：${gone}`, !flat.includes(gone));
  }
  // 先把合法的 .snd[data-stroke="on"] 整段抠掉，剩下的文本里不该再出现任何 [data-stroke
  const withoutScoped = flat.split('.snd[data-stroke="on"]').join("");
  check("全局属性选择器 [data-stroke=\"on\"] .snd-box 已改成 .snd[data-stroke=\"on\"] .snd-box",
    !withoutScoped.includes("[data-stroke") && /\.snd\[data-stroke="on"\] \.snd-box\s*\{/.test(flat), withoutScoped.includes("[data-stroke") ? "还有没被 .snd 包住的 [data-stroke" : "");
  const { rules } = parseCss(css);
  const topSnd = rules.filter((r) => r.depth === 0 && r.sel === ".snd");
  check("顶层只有一条 .snd 规则（音效板那条 display:flex/width:460px 已删）", topSnd.length === 1, String(topSnd.length));
  check("音效板那条的指纹（width: 460px / gap: 10px 的 .snd）不在", !/width:\s*460px/.test(flat));
  check("@keyframes snd-beat 在，且过冲是 1.34", /@keyframes snd-beat/.test(flat) && /38%\s*\{\s*scale:\s*1\.34/.test(flat));
  const reduced = (flat.match(/prefers-reduced-motion:\s*reduce/g) || []).length;
  check("两条 prefers-reduced-motion 都在", reduced === 2, String(reduced));
  check("作用域里没有裸标签选择器（button/span/svg 之类）", !/(^|[\s,{}])(button|span|svg|div|body|html)\s*[,{]/m.test(flat));
}

// ─────────────────────────────────────────────────────────────────────────────
// ④ token 映射完整性
// ─────────────────────────────────────────────────────────────────────────────
group("④ 14 个 Bencho token 的映射（映射表逐条核对）");
{
  for (const f of tokenFacts(css)) check(f.name, f.ok, f.detail);
  check("映射表本身是 14 条", TOKEN_MAP.length === 14);
  check("README 里有同一张映射表（14 个 token 全列）", TOKEN_MAP.every((t) => readme.includes(t.token)));
  check("README 写清了 -rgb 要给三个裸数字", /三个裸数字/.test(readme));

  // 本条是整件事的收口：原件「读它们却从不定义它们」——这里每一处 var() 都必须有值
  const flatCss = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  const reads = [...flatCss.matchAll(/var\((--[a-z0-9-]+)(\s*,)?/g)].map((m) => ({ name: m[1], fallback: !!m[2] }));
  const localSet = new Set(TOKEN_MAP.map((t) => t.token));
  const dashed = reads.filter((r) => !localSet.has(r.name) && !r.fallback);
  check(`CSS 里 ${reads.length} 处 var() 读取全部有值（本地 14 条之一，或自带兜底）`,
    dashed.length === 0, dashed.length ? "读到空值: " + [...new Set(dashed.map((d) => d.name))].join(",") : "");
  let braceDepth = 0;
  for (const ch of flatCss) { if (ch === "{") braceDepth++; else if (ch === "}") braceDepth--; }
  check("now-playing.css 花括号平衡（去注释后）", braceDepth === 0, "depth=" + braceDepth);
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑤ 构建产物（自足性）
// ─────────────────────────────────────────────────────────────────────────────
group("⑤ dist/now-playing.js（自足产物）");
{
  const bytes = Buffer.byteLength(dist);
  check("产物存在且 > 50 KiB（React 在里面）", bytes > 50 * 1024, `${bytes} B`);
  check("产物 < 400 KiB（没有把 1800 个图标都打进来）", bytes < 400 * 1024, `${bytes} B`);
  check("文件头一行生成说明（含 esbuild 版本）", /^\/\* dist\/now-playing\.js[\s\S]{0,600}?esbuild \d+\.\d+\.\d+/.test(dist));
  check("文件头写明了图标来源", /图标：lucide-react@\d|图标：本地 icons\.tsx/.test(dist));
  check("包含导出名 NowPlaying", /\bNowPlaying\b/.test(dist));
  check("包含 mountNowPlaying", /\bmountNowPlaying\b/.test(dist));
  check("没有裸 import（不 from \"react\" / \"lucide-react\" / 任何包名）", !/\bfrom\s*["']/.test(dist) && !/\bimport\s*[({"']/.test(dist), (dist.match(/\bfrom\s*["'][^"']*["']/) || [""])[0]);
  check("React/ReactDOM 真的内联了", /react\.element/.test(dist) && /__reactContainer/.test(dist));
  check("图标只在产物里留了用到的三个（没有别的图标几何）",
    dist.includes('"heart"') && dist.includes('"skip-back"') && dist.includes('"skip-forward"') && !dist.includes("alarm-clock") && !dist.includes('"zap"'));
  check("许可头留在产物末尾（React MIT / lucide ISC）", /@license lucide-react v[\d.]+ - ISC/.test(dist) && /react-dom/.test(dist.slice(-4000)));
  check("产物里没有本机绝对路径", !dist.includes("/ro" + "ot/") && !dist.includes("com.termux"));
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑥ 变异自证（RED-IF-REVERTED）：把实现故意改坏，同一批判据必须变红
// ─────────────────────────────────────────────────────────────────────────────
group("⑥ 变异自证（在 os.tmpdir() 的副本上改坏，真树不动）");
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "np-mut-"));
  const mutations = [
    {
      id: "math:boxRadius 只给一个轴加 off（破坏同心）",
      file: "now-playing-math.mjs",
      from: "return [x + off, y + off];",
      to: "return [x + off, y];",
      facts: (text) => concentricFacts(text),
    },
    {
      id: "math:swell 的 ^1.5 改成 ^1（峰值从 0.63 挪到 0.5）",
      file: "now-playing-math.mjs",
      from: "** 1.5)",
      to: "** 1.0)",
      facts: (text) => [swellPeakFact(text)],
    },
    {
      id: "css:删掉 --pane-edge 的本地定义（token 缺一条 / 发丝线读空值）",
      file: "now-playing.css",
      from: /^.*--pane-edge:[^\n]*\n/m,
      to: "",
      facts: (text) => tokenFacts(text),
    },
    {
      id: "math:seekRatio 去掉 0..1 钳位（拖到条外给出负进度 / >100%）",
      file: "now-playing-math.mjs",
      from: "return Math.max(0, Math.min(1, (x - left) / width))",
      to: "return (x - left) / width",
      facts: (text) => seekRatioFacts(text),
    },
    {
      id: "math:seekRatio 把 width≤0 的守卫删掉（宽度 0 时算出 Infinity/NaN）",
      file: "now-playing-math.mjs",
      from: "if (!Number.isFinite(x) || !Number.isFinite(left) || !Number.isFinite(width) || width <= 0) return null",
      to: "if (false) return null",
      facts: (text) => seekRatioFacts(text),
    },
    {
      id: "css:给 .snd-box 前面加 body（选择器跑出 .snd 子树）",
      file: "now-playing.css",
      from: ".snd-box {\n  position: relative;",
      to: "body .snd-box {\n  position: relative;",
      facts: (text) => cssScopeFacts(text),
    },
  ];

  for (const mut of mutations) {
    const orig = fs.readFileSync(path.join(NP, mut.file), "utf8");
    const brokenPath = path.join(tmp, mut.file);
    fs.writeFileSync(brokenPath, orig.replace(mut.from, mut.to));
    const changed = fs.readFileSync(brokenPath, "utf8") !== orig;
    let mod = null;
    if (mut.file.endsWith(".mjs")) mod = await import(pathToFileURL(brokenPath).href + "?m=" + encodeURIComponent(mut.id));
    const facts = mut.facts(mut.file.endsWith(".mjs") ? mod : fs.readFileSync(brokenPath, "utf8"));
    const red = facts.filter((f) => !f.ok);
    check(`变异「${mut.id}」确实改到了文件`, changed);
    check(`变异「${mut.id}」⇒ 判据变红（${red.length}/${facts.length} 条红）`, red.length > 0, red.length ? "" : "改坏了却全绿 ⇒ 判据是假的");
    if (red.length) line(`    RED: ${red[0].name} — ${red[0].detail}`);
    if (red.length && MUT_VERBOSE) for (const r of red) line(`      · ${r.name} — ${r.detail}`);
  }

  // 对照组：**没改**的副本必须全绿（证明上面那些红是变异带来的，不是判据本身恒假）
  const ctrl = concentricFacts(await import(pathToFileURL(path.join(NP, "now-playing-math.mjs")).href + "?ctrl=1"));
  check("对照：未变异的 math 在同批判据上全绿", ctrl.every((f) => f.ok));
  check("对照：未变异的 CSS 在同批判据上全绿",
    cssScopeFacts(css).every((f) => f.ok) && tokenFacts(css).every((f) => f.ok));
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑦ 可选：SSR 渲染探针（需要 node_modules + esbuild；没有就 SKIP）
//    本机无浏览器 ⇒ "产物能 build" 与 "产物能跑" 是两件事，这一组钉后者
//    （实测抓到过：esbuild 默认 classic JSX ⇒ 产物能 build，一运行就
//      "React is not defined"）。
// ─────────────────────────────────────────────────────────────────────────────
group("⑧ 受控数据面 / 传输面（P-161 测试台适配）");
{
  //  ⑧a 纯函数：进度条换算的边界（6+3 条）
  for (const f of seekRatioFacts(math)) check(f.name, f.ok, f.detail);

  //  ⑧b 组件源码：受控入口与 op 词汇（与插件仓控制器同一套）
  const OPS = ["play", "pause", "prev", "next", "restart", "mute", "seek", "volume", "link"];
  check("NowPlaying.tsx 导出 NowPlayingOp / NowPlayingData 两个类型",
    /export type NowPlayingOp =/.test(tsx) && /export type NowPlayingData =/.test(tsx));
  check(`op 词汇齐全（${OPS.length} 个，与插件仓控制器一致）`, OPS.every((o) => new RegExp(`"${o}"`).test(tsx)), OPS.filter((o) => !new RegExp(`"${o}"`).test(tsx)).join(","));
  check("组件收 `data` / `onTransport` 两个可选入口（不传 = 原件装饰态）",
    /data = null,/.test(tsx) && /onTransport = null,/.test(tsx));
  check("不传 data 时**一个受控标记都不渲染**（装饰态 SR 产物逐字不变的前提）",
    /controlled \? \(data\?\.source \|\| "1"\) : undefined/.test(tsx) && /data-mpw-np-scrub=\{controlled \? "1" : undefined\}/.test(tsx));
  check("DOM 标记与插件仓同口径：\(root\)/scrub/noseek/link",
    /data-mpw-now-playing=/.test(tsx) && /data-mpw-np-scrub=/.test(tsx) && /data-mpw-np-noseek=/.test(tsx) && /data-mpw-np-link=/.test(tsx));
  check("进度条走 `seekRatio()` 而不是自己写算式（分母/钳位只有一处）",
    /seekRatio\(e\.clientX, r\)/.test(tsx) && /seekRatio\(e\.clientX, e\.currentTarget\.getBoundingClientRect\(\)\)/.test(tsx));
  check("拖动只在按住时生效（`e.buttons === 0` 直接返回 ⇒ 掠过不 seek）", /if \(e\.buttons === 0\) return;/.test(tsx));
  check("联动开关沿用**同一颗心/同一个类**（不新增 CSS 类 ⇒ CSS↔DOM 一一对应那条断言仍成立）",
    /className="snd-like"/.test(tsx) && /send\("link", shownLiked \? 0 : 1\)/.test(tsx));
  check("受控模式的所有键都按 can* 置灰（不假装可点）",
    /disabled=\{!canPlay\}/.test(tsx) && /disabled=\{!canPrev\}/.test(tsx) && /disabled=\{!canNext\}/.test(tsx));
  check("mount.tsx 把 data/onTransport 透传下去（update 只重画、不重建根）",
    /export type \{ NowPlayingData, NowPlayingOp \}/.test(mount) && /data\?: NowPlayingData \| null;/.test(mount) && /onTransport\?:/.test(mount) && /root\.render/.test(mount));
  check("受控模式的悬浮放大只动整体 scale（不碰布局数字）",
    /transform: controlled && hoverZoom \? "scale\(1\.02\)" : undefined/.test(tsx));
}

group("⑦ SSR 渲染探针（无浏览器；靠 react-dom/server）");
{
  const req = createRequire(path.join(NP, "package.json"));
  let esbuildEntry = null;
  try {
    esbuildEntry = req.resolve("esbuild");
    req.resolve("react-dom/server");
  } catch {
    esbuildEntry = null;
  }
  if (!esbuildEntry) {
    line("  SKIP 没有 demo/now-playing/node_modules（正常：依赖不入库）—— 跑 npm install 后再来");
  } else {
    const esbuild = await import(pathToFileURL(esbuildEntry).href);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "np-ssr-"));
    const probe = path.join(tmp, "probe.mjs");
    fs.writeFileSync(probe, `
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NowPlaying } from ${JSON.stringify(path.join(NP, "NowPlaying.tsx"))};
const out = {};
for (const corner of [0, 16, 32]) out["c" + corner] = renderToStaticMarkup(createElement(NowPlaying, { corner }));
out.stroke = renderToStaticMarkup(createElement(NowPlaying, { stroke: true }));
out.plain = renderToStaticMarkup(createElement(NowPlaying, {}));
out.data = renderToStaticMarkup(createElement(NowPlaying, {
  data: { kind: "web", title: "真实标题", byline: "web · ×2 · 音量 42%", progress: 7.5, total: 10, playing: true, muted: false, volume: 0.42, canPlay: true, canPrev: false, canNext: true, canSeek: true, link: true, source: "stage-video" },
  onTransport: () => {},
}));
out.unlinked = renderToStaticMarkup(createElement(NowPlaying, {
  data: { title: "T", byline: "b", progress: 0, total: 0, playing: false, link: false, canPlay: false, canSeek: false, canPrev: false, canNext: false },
  onTransport: () => {},
}));
/* ①(2026-09-23 第 8② 条) 时间轴不可证实 ⇒ 两个时间位都写 --:--（不是 0:00 / -0:00，更不是负数）。 */
out.unknown = renderToStaticMarkup(createElement(NowPlaying, {
  data: { title: "T", byline: "b", progress: 3, total: 19.98, playing: true, link: true, timelineKnown: false, canPlay: true, canSeek: false },
  onTransport: () => {},
}));
out.known = renderToStaticMarkup(createElement(NowPlaying, {
  data: { title: "T", byline: "b", progress: 3, total: 19.98, playing: true, link: true, timelineKnown: true, canPlay: true, canSeek: true },
  onTransport: () => {},
}));
process.stdout.write(JSON.stringify(out));
`);
    const bundle = path.join(tmp, "probe.cjs");
    await esbuild.build({
      entryPoints: [probe],
      outfile: bundle,
      bundle: true,
      platform: "node",
      format: "cjs",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' },
      nodePaths: [path.join(NP, "node_modules")],
      logLevel: "silent",
    });
    const html = JSON.parse(execFileSync(process.execPath, [bundle], { encoding: "utf8", timeout: 60_000 }));
    const c16 = html.c16, c0 = html.c0, c32 = html.c32;
    const cls = (s) => new Set([...s.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/).filter((c) => c.startsWith("snd"))));
    /* ①(2026-09-23 第 8② 条) 时间轴可证实性：false ⇒ `--:--` 两次、进度条 0%；true ⇒ 正常时间文本。
       这条同时钉住"默认（不传 timelineKnown）行为不变"—— G16 在 bench-shell-fixes 里钉数据面。 */
    {
      const unknownClocks = [...html.unknown.matchAll(/class="snd-clock"[^>]*>([\s\S]*?)<\/span><\/span>/g)].length;
      const hasDash = (html.unknown.match(/--:--/g) || []).length;
      const runUnknown = (html.unknown.match(/class="snd-run"[^>]*width:([0-9.]+)%/) || [])[1];
      check("第 8② 条：`timelineKnown:false` ⇒ 两个时间位都写 `--:--`（共 2 处）", hasDash === 2, "dash=" + hasDash + " groups=" + unknownClocks);
      check("第 8② 条：`timelineKnown:false` ⇒ 进度条 0%（不拿静音画面层的 19.98s 时间轴冒充播放）", runUnknown === "0", "width=" + runUnknown);
      check("第 8② 条：`timelineKnown:true` ⇒ 仍然渲染正常时间文本（判据有分辨力，不是恒真）",
        /0:03/.test(html.known) && /−0:16/.test(html.known) && !/--:--/.test(html.known));
    }
    check("渲染出的 DOM 有根 .snd（width 260 / height OPEN=189）", /class="snd"/.test(c16) && /width:260px;height:189px/.test(c16));
    check("关闭态盒子是 260×78（SHUT）", /class="snd-box"[^>]*width:260px;height:78px/.test(c16));
    check("封面 40×40 且 background-image 指向 COVER", /class="snd-art"[^>]*url\(\.\.\/assets\/brand\/brand-512\.png\)[^>]*width:40px;height:40px/.test(c16));
    check("corner=16：盒子圆角 20 / 封面 10（同心：差 = off = 10）",
      /border-radius:20px/.test(c16.match(/class="snd-box"[^>]*/)[0]) && /border-radius:10px/.test(c16.match(/class="snd-art"[^>]*/)[0]));
    // 关闭态读的是**胶囊那一端**的半径（mix(bar, card, p) 在 p=0 处 = 索引 0）：
    //   corner=0  → artR[0]=0、boxR[0]=0            （一起变方）
    //   corner=32 → artR[0]=20、boxR[0]=30          （差仍是 off=10，仍然同心）
    // React 对 0 不写单位（border-radius:0），所以两种写法都认。
    check("corner=0：两个圆角一起变方（0 / 0）",
      /border-radius:0(px)?[;"]/.test(c0.match(/class="snd-box"[^>]*/)[0]) && /border-radius:0(px)?[;"]/.test(c0.match(/class="snd-art"[^>]*/)[0]));
    check("corner=32：胶囊端 封面 20 / 盒子 30（差仍是 off=10 ⇒ 同心）",
      /border-radius:30px/.test(c32.match(/class="snd-box"[^>]*/)[0]) && /border-radius:20px/.test(c32.match(/class="snd-art"[^>]*/)[0]));
    check("轨道在关闭态的 top = SHUT − PAD − RAIL_H = 65px", /class="snd-bar"[^>]*top:65px/.test(c16));
    check("命中区 = 整条胶囊（0,0,260×78）", /class="snd-tap"[^>]*left:0;top:0;width:260px;height:78px/.test(c16));
    check("心形在卡片右上角（W − PAD − LIKE = 220）且关闭态不可点",
      /class="snd-like"[^>]*left:220px[^>]*pointer-events:none/.test(c16) && /tabindex="-1"/.test(c16));
    check("传动行按中心定位（关闭态 left:206 / top:30 / gap:5）", /class="snd-ops" style="left:206px;top:30px;gap:5px"/.test(c16));
    check("播放记号是**画出来的**两个四边形（不是 lucide 图标）",
      /class="snd-op" data-lead="true"[\s\S]{0,400}?<path d="M6\.50 4\.00L13\.25 8\.00/.test(c16));
    check("心形与两个跳曲键是 lucide 图标，且类名口径对（.lucide 在 ⇒ 心跳动画能命中）",
      /class="lucide lucide-heart"/.test(c16) && /class="lucide lucide-skip-back"/.test(c16) && /class="lucide lucide-skip-forward"/.test(c16));
    check("stroke 属性 ⇒ 根上写 data-stroke=on；不传就没有", /class="snd" data-stroke="on"/.test(html.stroke) && !/data-stroke/.test(html.plain));
    check("时钟两端的数字（0:52 / −2:42）与进度条宽度（52/214）",
      /0:52/.test(c16) && /−2:42/.test(c16) && /width:24\.299065420560748%/.test(c16));
    // 组件渲染出的 .snd-* 类名集合 与 CSS 里出现的 .snd* 类名集合 必须一致
    const inCss = new Set([...parseCss(css).rules.flatMap((r) => (r.sel.startsWith("@") ? [] : [...r.sel.matchAll(/\.snd[a-z-]*/g)].map((m) => m[0].slice(1))))]);
    const rendered = cls(c16);
    const onlyCss = [...inCss].filter((c) => !rendered.has(c));
    const onlyDom = [...rendered].filter((c) => !inCss.has(c));
    //  ①(P-161) 受控渲染：真实数据进画面 + 受控标记 + 可控/不可控两态
    const dat = html.data || "";
    const unl = html.unlinked || "";
    check("受控渲染：标题/副标题来自 data（不再是 Cabra Field / Side B）",
      /真实标题/.test(dat) && /web · ×2 · 音量 42%/.test(dat) && !/Cabra Field/.test(dat));
    check("受控渲染：时钟与进度条来自 data（7.5/10 ⇒ 0:07 / −0:02 / 75%）",
      /0:07/.test(dat) && /−0:02/.test(dat) && /width:75%/.test(dat));
    check("受控渲染：根上有 data-mpw-now-playing，rail 上有 data-mpw-np-scrub",
      /data-mpw-now-playing="stage-video"/.test(dat) && /data-mpw-np-scrub="1"/.test(dat));
    //  ⚠ 属性顺序：React 把 `disabled=""` 写在 `style` 之前、`aria-label` 在最后
    //  （第一版断言写成 `aria-label="Restart" disabled` ⇒ 假红，这里按真实顺序写）
    check("受控渲染：canPrev=false 的键 disabled、其余可点（不假装可点）",
      /<button[^>]*disabled=""[^>]*aria-label="Restart"/.test(dat) && !/<button[^>]*disabled[^>]*aria-label="Next"/.test(dat));
    check("受控渲染：联动开 ⇒ data-mpw-np-link=\"1\"；playing ⇒ aria-pressed=\"true\"",
      /data-mpw-np-link="1"/.test(dat) && /aria-pressed="true"/.test(dat));
    check("脱开（link:false）⇒ 所有键 disabled + rail 标 noseek + data-mpw-np-link=\"0\"",
      /data-mpw-np-link="0"/.test(unl) && /data-mpw-np-noseek="1"/.test(unl) &&
      (unl.match(/disabled/g) || []).length >= 3 && /<button[^>]*disabled=""[^>]*aria-label="Play"/.test(unl));
    check("装饰态（不传 data）**一个受控标记都没有**（既有基线断言的护栏）",
      !/data-mpw-now-playing|data-mpw-np-scrub|data-mpw-np-link/.test(html.plain) && !/data-mpw/.test(html.stroke));
    check("CSS 里的 .snd* 类名与渲染出来的 DOM 一一对应（没有写死的孤儿规则）",
      onlyCss.length === 0 && onlyDom.length === 0, `只在 CSS: ${onlyCss.join(",")}｜只在 DOM: ${onlyDom.join(",")}`);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
const summary = { pass, fail, results };
if (JSON_OUT) console.log(JSON.stringify(summary, null, 2));
else console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
