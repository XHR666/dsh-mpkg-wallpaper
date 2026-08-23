// 把 liquid-glass-bundle.js 内联进 client.js（作为模板字符串常量 LG_BUNDLE_SRC）
// 用法：node tools/inline-lg-bundle.mjs  （每次 bundle 变更后运行）
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bundle = readFileSync(join(here, '..', 'lib', 'liquid-glass-bundle.js'), 'utf8');
// 转义模板字符串：\ → \\, ` → \`, ${ → \${ （bundle 里可能有反引号？JS 源码可能含模板串）
let esc = bundle.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

const clientPath = join(here, '..', 'lib', 'client.js');
let client = readFileSync(clientPath, 'utf8');

// 找到 LG_BUNDLE_SRC 占位区（在 ensureLgModule 前）
const marker = 'const LG_BUNDLE_SRC = `';
const markerEnd = '`; // LG_BUNDLE_END';
const startIdx = client.indexOf(marker);
const endIdx = client.indexOf(markerEnd);
if (startIdx < 0 || endIdx < 0) {
  console.error('client.js 缺少 LG_BUNDLE_SRC 占位区，先插入');
  process.exit(1);
}
const newBlock = marker + esc + markerEnd;
client = client.slice(0, startIdx) + newBlock + client.slice(endIdx + markerEnd.length);
writeFileSync(clientPath, client);
console.log('LG_BUNDLE_SRC 内联完成:', esc.length, 'chars');
