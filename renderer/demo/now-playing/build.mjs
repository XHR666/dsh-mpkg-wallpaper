// ①(P-138 2026-09-19 移植) build.mjs —— 把 mount.tsx（连带 NowPlaying 与 React）
// 打成一个**自足**的 ESM：dist/now-playing.js。页面直接 <script type="module"> 引它，
// 不需要 node_modules 就能看。
//
// 两条路都要能 build：
//   · 首选 lucide-react（用户明确要求装的依赖，图标几何与上游逐字节相同）；
//   · 装不下来时（本机网络失败/离线）回落到本目录的 icons.tsx（同 props、同 24×24
//     stroke 口径，文件头有许可说明）—— 用 esbuild 的 alias 换掉裸包名。
// 产物里**没有**裸 import：React、ReactDOM 与图标都在里面。
//
// 用法: node build.mjs [--icons=auto|lucide|fallback] [--out=相对或绝对路径]
import * as esbuild from "esbuild";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const arg = (name, dflt) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const HERE = import.meta.dirname;
const require = createRequire(import.meta.url);
const pkg = JSON.parse(fs.readFileSync(path.join(HERE, "package.json"), "utf8"));
const dep = (n) => pkg.dependencies?.[n] || pkg.devDependencies?.[n] || "未装";

// lucide-react 在不在？在就优先用它，不在就用本地兜底（同一套 export 名）。
// --icons=fallback 强制走兜底那条路（测试用它证明"两条路都能 build"）。
const want = arg("icons", "auto");
let lucide = want !== "fallback";
if (lucide) {
  try {
    require.resolve("lucide-react");
  } catch {
    lucide = false;
  }
}
const iconsFrom = lucide
  ? `lucide-react@${dep("lucide-react")}`
  : "本地 icons.tsx 兜底（lucide-react 不可解析或 --icons=fallback）";
const outfile = path.resolve(HERE, arg("out", "dist/now-playing.js"));

const banner = `/* dist/now-playing.js —— ①(P-138 2026-09-19) 生成产物，请勿手改。
   由 demo/now-playing/build.mjs 用 esbuild ${esbuild.version} 打包 mount.tsx
   （ESM / 自足：React ${dep("react")} + react-dom 已内联，产物里没有裸 import）。
   导出：NowPlaying（组件）与 mountNowPlaying（薄壳）。
   图标：${iconsFrom}。
   重建：cd demo/now-playing && npm install && node build.mjs
   页面：/WEwebLoader/now-playing/index.html 或 /demo/now-playing/index.html */`;

const result = await esbuild.build({
  entryPoints: [path.join(HERE, "mount.tsx")],
  outfile,
  bundle: true,
  format: "esm",
  platform: "browser",
  // 必须显式写 automatic：esbuild 默认是 classic（`React.createElement`），而
  // NowPlaying.tsx 照抄时只 import 了具名 hook（没有 `import React`）—— classic
  // 下产物能 build 出来，但一运行就 "React is not defined"。测试里的 SSR 渲染
  // 探针就是钉这个的（本机无浏览器，这类错只能靠它抓）。
  jsx: "automatic",
  target: "es2020",
  minify: true,
  legalComments: "eof", // React/ReactDOM 的 MIT 头留在文件尾（许可要求）
  sourcemap: false,
  metafile: true,
  banner: { js: banner },
  define: { "process.env.NODE_ENV": '"production"' },
  alias: lucide ? {} : { "lucide-react": path.join(HERE, "icons.tsx") },
  logLevel: "info",
});

const bytes = fs.statSync(outfile).size;
console.log(`[build] ${path.relative(process.cwd(), outfile)}  ${bytes} B (${(bytes / 1024).toFixed(1)} KiB)`);
console.log(`[build] 图标来源: ${iconsFrom}`);
if (lucide) {
  // metafile.inputs 列的是**解析过**的模块（lucide 的桶文件会把 1800+ 个图标都拉进来解析），
  // 真正进产物的是 outputs[].inputs 里 bytesInOutput > 0 的那些 —— 只报后者，别自欺。
  const outMeta = Object.values(result.metafile.outputs)[0];
  const inBundle = Object.entries(outMeta.inputs)
    .filter(([i, v]) => i.includes("lucide") && v.bytesInOutput > 0)
    .map(([i]) => path.basename(i).replace(/\.mjs$/, ""));
  console.log(`[build] lucide 真正进产物的模块: ${inBundle.length} 个（${inBundle.join(", ")}）`);
} else {
  console.log("[build] ⚠ lucide-react 未使用 ⇒ 已回落到 icons.tsx（README 有说明，不是静默）");
}
