#!/usr/bin/env node
/**
 * hdr-probe-mint-cookie.mjs —— 给 tools/hdr-probe.mjs 生成 DSH web 鉴权 Cookie
 *
 * 背景：`dsh web` 的首页要求一个 HMAC 签名 Cookie（dsh-client-connection 的 BrowserAuth），
 *   签名的密钥存在 `~/.dsh/.credentials.yaml` 的 `client-connection/browser-session` 记录里；
 *   进程级 launch token 是随机数、不落盘，所以"直接拿 token 拼 URL"不可行，
 *   但我们可以用同一份密钥**自签**一枚同格式 Cookie（服务端只验签名 + 有效期 + audience）。
 *
 * 用法：
 *   node tools/hdr-probe-mint-cookie.mjs                 # authority 默认 127.0.0.1:3080
 *   node tools/hdr-probe-mint-cookie.mjs --authority 127.0.0.1:3080 --out /tmp/ffprobe/cookie.json
 *
 * 安全：脚本只**读**密钥、只把**生成的 Cookie**写到目标文件（默认 /tmp/ffprobe/cookie.json），
 *   密钥本身不打印、不落盘、不进仓库。仓库里没有也不应有任何密钥。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash, createHmac } from 'node:crypto'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const AUTHORITY = arg('authority', '127.0.0.1:3080')
const OUT = arg('out', '/tmp/ffprobe/cookie.json')
const CREDS = arg('creds', path.join(os.homedir(), '.dsh', '.credentials.yaml'))

if (!fs.existsSync(CREDS)) { console.error('✗ 找不到凭据文件 ' + CREDS); process.exit(1) }
const yaml = fs.readFileSync(CREDS, 'utf8')
const m = yaml.match(/client-connection\/browser-session:[\s\S]*?secret:\s*([A-Za-z0-9_-]+)/)
if (!m) { console.error('✗ 凭据文件里没有 client-connection/browser-session 的 secret'); process.exit(1) }
const s = m[1]
const secret = Buffer.from(s.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - s.length % 4) % 4), 'base64')
if (secret.byteLength !== 32) { console.error('✗ secret 长度异常（' + secret.byteLength + ' 字节，期望 32）'); process.exit(1) }

const b64u = (b) => Buffer.from(b).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
const name = 'dsh-auth-' + b64u(createHash('sha256').update(AUTHORITY).digest())
const now = Date.now()
const body = b64u(Buffer.from(JSON.stringify({ version: 1, authority: AUTHORITY, issuedAt: now, expiresAt: now + 30 * 86400000 }), 'utf8'))
const value = 'v1.' + body + '.' + b64u(createHmac('sha256', secret).update(body).digest())

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify({ name, value }, null, 2) + '\n')
fs.chmodSync(OUT, 0o600)
console.log('✓ Cookie 已生成: ' + OUT)
console.log('  authority = ' + AUTHORITY + ' (cookie 名 ' + name.slice(0, 24) + '…, 30 天有效)')
console.log('  下一步: node tools/hdr-probe.mjs --label before')
