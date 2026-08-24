// 把 liquid-glass-bundle.js 转 base64 内联进 client.js 的 LG_BUNDLE_B64 常量。
// base64 纯 ASCII（无引号/反引号/${），DSH client-modules 打包器对纯字符串常量安全，
// 不会像内联原始 JS 那样触发打包异常崩溃。运行时 atob 解码 + Blob import。
// 用法：node tools/inline-lg-b64.mjs   （bundle 变更后运行）
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bundle = readFileSync(join(here, '..', 'lib', 'liquid-glass-bundle.js'), 'utf8');
const b64 = Buffer.from(bundle, 'utf8').toString('base64');

const clientPath = join(here, '..', 'lib', 'client.js');
let client = readFileSync(clientPath, 'utf8');

const marker = 'const LG_BUNDLE_B64 = "';
const markerEnd = '"; // LG_BUNDLE_B64_END';
const startIdx = client.indexOf(marker);
const endIdx = client.indexOf(markerEnd);
if (startIdx < 0 || endIdx < 0) {
  console.error('client.js 缺少 LG_BUNDLE_B64 占位区，先插入');
  process.exit(1);
}
client = client.slice(0, startIdx) + marker + b64 + markerEnd + client.slice(endIdx + markerEnd.length);
writeFileSync(clientPath, client);
console.log('LG_BUNDLE_B64 内联完成:', b64.length, 'chars');
