// tools/host-sandbox-token-test.mjs — B6 宿主侧回归（契约：we-scene-demo/RENDERER-SANDBOX-CONTRACT.md §2.3）
// 覆盖：
//   H1 GET /scene-thumb-token 签发（形状 + 参数校验）
//   H2 /raw：`Origin: null`（不透明源）无 token → 403；篡改 token → 403；**别的场景** token → 403（作用域）
//   H3 /raw：正确 token → 越过 token 闸门（后续 404/文件缺失都算通过）
//   H4 /raw：非 "null" 来源（旧插件 iframe / 同源 UI）→ 不因 token 被拒（零回归）
//   H5 POST /custom-scene-thumb：`Origin: null` 无 token / 错场景 token → 403
// 说明：本测试**不写任何文件**（只走拒绝路径），也不依赖 custom 目录是否存在。
import { apply } from '../lib/index.js'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✓ ' + name) } else { fail++; console.error('  ✗ ' + name) } }
const eq = (a, b, name) => ok(a === b, name + (a === b ? '' : `（got=${JSON.stringify(a)} want=${JSON.stringify(b)}）`))

const BASE = '/api/mpkg-wallpaper'
const routes = new Map()
apply({ webServer: { register: (r) => routes.set(r.path, r.handler) } })
ok(routes.has(BASE + '/scene-thumb-token') && routes.has(BASE + '/raw') && routes.has(BASE + '/custom-scene-thumb'), '路由已注册（含新增 token 路由）')

const mkRes = () => ({
  code: 0, headers: {}, body: '',
  writeHead(code, h) { this.code = code; Object.assign(this.headers, h || {}) },
  end(b) { this.body = String(b == null ? '' : b) },
  write() {}, on() {}, destroy() {}, setHeader(k, v) { this.headers[k] = v },
})
/** 触发路由：fullUrl 形如 '/api/mpkg-wallpaper/raw?folder=f&file=scene.pkg' */
const call = (fullUrl, { method = 'GET', origin = undefined, body = null } = {}) => {
  const path = fullUrl.split('?')[0]
  const handler = routes.get(path)
  if (!handler) throw new Error('无该路由: ' + path)
  const res = mkRes()
  const headers = {}
  if (origin !== undefined) headers.origin = origin
  const req = {
    method, url: fullUrl, headers,
    on(ev, cb) { if (ev === 'data' && body != null) cb(Buffer.from(body)); if (ev === 'end') cb() },
  }
  handler(req, res)
  return res
}
const jbody = (r) => { try { return JSON.parse(r.body) } catch { return {} } }

/* H1 签发 */
console.log('\n== H1 /scene-thumb-token ==')
const mint = call(BASE + '/scene-thumb-token?scene=' + encodeURIComponent('custom|f1|scene.pkg'))
eq(mint.code, 200, 'H1 签发返回 200')
const mj = jbody(mint)
ok(!!mj.ok && typeof mj.token === 'string' && mj.token.length > 20, 'H1 返回 token 字符串')
ok(typeof mj.exp === 'number' && mj.exp * 1000 > Date.now(), 'H1 exp 在未来（短期有效）')
eq(mj.scene, 'custom|f1|scene.pkg', 'H1 回显绑定场景')
const mint2 = call(BASE + '/scene-thumb-token?scene=' + encodeURIComponent('custom|OTHER|scene.pkg'))
const otherToken = jbody(mint2).token
ok(!!otherToken && otherToken !== mj.token, 'H1 不同场景 → 不同 token')
eq(call(BASE + '/scene-thumb-token').code, 400, 'H1 缺 scene 参数 → 400')

/* H2/H3/H4 /raw */
console.log('\n== H2–H4 /raw 的 Origin:null 闸门 ==')
const RAW = BASE + '/raw?folder=f1&file=scene.pkg'
const rawNoTok = call(RAW + '&st=' + encodeURIComponent('bogus.token'), { origin: 'null' })
eq(rawNoTok.code, 403, 'H2 无/伪造 token + Origin:null → 403')
eq(jbody(rawNoTok).error, 'scene token required', 'H2 拒绝原因明确')
eq(call(RAW, { origin: 'null' }).code, 403, 'H2 完全不带 token → 403')
eq(call(RAW + '&st=' + encodeURIComponent(mj.token + 'x'), { origin: 'null' }).code, 403, 'H2 篡改 token → 403')
const rawWrongScene = call(RAW + '&st=' + encodeURIComponent(otherToken), { origin: 'null' })
eq(rawWrongScene.code, 403, 'H2 **别的场景**的 token → 403（场景作用域生效）')
const rawOk = call(RAW + '&st=' + encodeURIComponent(mj.token), { origin: 'null' })
ok(rawOk.code !== 403, 'H3 正确 token → 越过 token 闸门（code=' + rawOk.code + '）')
const rawLegacy = call(RAW)
ok(rawLegacy.code !== 403, 'H4 无 Origin 头（旧链路）→ 不因 token 被拒（零回归，code=' + rawLegacy.code + '）')
const rawLegacyOrigin = call(RAW, { origin: 'http://127.0.0.1:8899' })
ok(rawLegacyOrigin.code !== 403, 'H4 legacy iframe 来源（:8899）→ 不因 token 被拒（零回归）')

/* H5 POST 缩略图上报 */
console.log('\n== H5 POST /custom-scene-thumb ==')
const frame = 'data:image/jpeg;base64,' + Buffer.alloc(600, 7).toString('base64')
const postBody = JSON.stringify({ folder: 'f1', file: 'scene.pkg', frame })
const THUMB = BASE + '/custom-scene-thumb'
eq(call(THUMB, { method: 'POST', origin: 'null', body: postBody }).code, 403, 'H5 Origin:null 无 sceneToken → 403（不落盘）')
eq(call(THUMB, { method: 'POST', origin: 'null', body: JSON.stringify({ folder: 'f1', file: 'scene.pkg', frame, sceneToken: otherToken }) }).code, 403, 'H5 错场景 token → 403（不落盘）')
eq(call(THUMB, { method: 'POST', origin: 'null', body: JSON.stringify({ folder: 'f1', file: 'scene.pkg', frame, sceneToken: 'x.y' }) }).code, 403, 'H5 伪造 token → 403（不落盘）')

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
