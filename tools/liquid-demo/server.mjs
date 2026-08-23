#!/usr/bin/env node
// 液态玻璃演示页服务（独立端口 3081，纯本地测试用，不参与插件主流程）
// 用法：node tools/liquid-demo/server.mjs [端口]
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.argv[2] || process.env.LG_DEMO_PORT || 3081);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.json': 'application/json', '.ico': 'image/x-icon',
};

const server = createServer((req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://localhost');
    let path = url.pathname;
    if (path === '/') path = '/index.html';
    // 防路径穿越
    const filePath = normalize(join(__dirname, path));
    if (!filePath.startsWith(normalize(__dirname))) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      res.writeHead(404); res.end('not found: ' + path); return;
    }
    res.writeHead(200, {
      'content-type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'access-control-allow-origin': '*',
    });
    createReadStream(filePath).pipe(res);
  } catch (err) {
    res.writeHead(500); res.end(String(err && err.message || err));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  🧪 液态玻璃演示页: http://127.0.0.1:${PORT}/`);
  console.log('  （独立测试页，不影响主插件；Ctrl+C 停止）\n');
});
