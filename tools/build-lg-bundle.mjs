// 构建液态玻璃单一 ESM bundle：把 lib/liquid-glass/*.js 合并成一个文件
// 供 client.js 内联（Blob URL 动态 import，不依赖 host 静态路由，跨设备稳定）
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const lgDir = join(here, '..', 'lib', 'liquid-glass');
// 只打包 V2 依赖链（v2.js + 其依赖），不含 V1（index.js/material.js）——避免同名冲突（SHAPES/COMPOSITE_MODES 等）
const order = ['shaders.js', 'v2-shaders.js', 'geometry.js', 'v2-geometry.js', 'v2-material.js', 'renderer.js', 'v2.js'];

// 收集 export 名 → 用于把 export 改成全局声明
const exportedNames = new Set();
for (const f of order) {
  const src = readFileSync(join(lgDir, f), 'utf8');
  for (const m of src.matchAll(/export\s+(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/g)) exportedNames.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().split(/\s+as\s+/).pop();
      if (n) exportedNames.add(n.trim());
    }
  }
}
console.log('exported names:', [...exportedNames].join(', '));

let bundle = '// 自动生成：液态玻璃单一 bundle（build-lg-bundle.mjs），勿手改\n';
for (const f of order) {
  let src = readFileSync(join(lgDir, f), 'utf8');
  // 去 import 块（跨行）：import { ... } from '...'; 整块删除
  src = src.replace(/import\s*[^;]*?from\s*['"][^'"]+['"]\s*;?/gs, '');
  src = src.replace(/^import\s.*$/gm, '');
  // 同名冲突处理：v2.js 内部 SHAPES(Set) 重命名为 SHAPES_V2（index.js 的 SHAPES 导出保留）
  if (f === 'v2.js') {
    src = src.replace(/const SHAPES = new Set/g, 'const SHAPES_V2 = new Set');
    src = src.replace(/SHAPES\.has/g, 'SHAPES_V2.has');
  }
  // export const/let/function/class → const/let/function/class
  src = src.replace(/export\s+(const|let|function|class)\s+/g, '$1 ');
  // export { a, b as c } → 忽略（名字已在声明处定义）
  src = src.replace(/^export\s*\{[^}]*\}\s*;?\s*$/gm, '');
  // export default → 处理
  src = src.replace(/export\s+default\s+/g, 'const __default__ = ');
  bundle += `\n// ===== ${f} =====\n${src}\n`;
}
// 尾部导出
bundle += `\nexport { ${[...exportedNames].filter(n=>n!=='__default__').join(', ')} };\n`;

const outPath = join(here, '..', 'lib', 'liquid-glass-bundle.js');
writeFileSync(outPath, bundle);
console.log('bundle written:', outPath, bundle.length, 'bytes');
