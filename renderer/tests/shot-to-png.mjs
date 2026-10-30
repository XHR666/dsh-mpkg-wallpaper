// shot-to-png.mjs — 把设备上报里的截图抽出来存成 PNG（自动出图，供人眼/工具比对）
// 用法: node shot-to-png.mjs <包id> [输出路径] [--n N]
//   取该包**最新**一份带 shot 的上报；用 ffmpeg 解码（我们自带的 jpeg.js 有 bug，见 P-67）
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const REPORTS = process.env.MPW_REPORTS_DIR || path.join(WS, 'reports');
const id = process.argv[2];
const out = process.argv[3] || `/tmp/auto-${id}.png`;
if (!id) { console.error('用法: node shot-to-png.mjs <包id> [输出.png] [--n N]'); process.exit(2); }
const files = fs.readdirSync(REPORTS).filter((f) => /^r\d+\.json$/.test(f));
let hits = [];
for (const f of files) {
  try {
    const d = JSON.parse(fs.readFileSync(path.join(REPORTS, f), 'utf8'));
    if (String(d.id) !== String(id) || !d.shot) continue;
    hits.push({ f, at: d.at || '', shot: d.shot });
  } catch { /* 跳过坏 JSON */ }
}
if (!hits.length) { console.error(`✗ ${id} 没有任何带截图的设备上报`); process.exit(1); }
hits.sort((a, b) => String(a.at).localeCompare(String(b.at)));
const want = process.argv.includes('--n') ? Number(process.argv[process.argv.indexOf('--n') + 1]) : 1;
const pick = hits.slice(-Math.max(1, want));
let i = 0;
for (const h of pick) {
  const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(h.shot);
  if (!m) continue;
  const raw = `/tmp/_shot-${id}-${i}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.writeFileSync(raw, Buffer.from(m[2], 'base64'));
  const dst = pick.length === 1 ? out : out.replace(/\.png$/, `-${i}.png`);
  try { execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', raw, dst], { timeout: 30000 }); }
  catch (e) { console.error('ffmpeg 解码失败:', String(e.message).slice(0, 120)); process.exit(1); }
  console.log(`✓ ${dst}   （来自 ${h.f} @ ${h.at}，${Math.round(fs.statSync(raw).size / 1024)}KB JPEG → ${fs.statSync(dst).size} B PNG）`);
  i++;
}
