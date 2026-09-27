// tools/host-sandbox-token-test.mjs — B6 宿主侧回归（契约：we-scene-demo/RENDERER-SANDBOX-CONTRACT.md §2.3）
// 覆盖：
//   H1 GET /scene-thumb-token 签发（形状 + 参数校验）
//   H2 /raw：`Origin: null`（不透明源）无 token → 403；篡改 token → 403；**别的场景** token → 403（作用域）
//   H3 /raw：正确 token → 越过 token 闸门（后续 404/文件缺失都算通过）
//   H4 /raw：非 "null" 来源（旧插件 iframe / 同源 UI）→ 不因 token 被拒（零回归）
//   H5 POST /custom-scene-thumb：`Origin: null` 无 token / 错场景 token → 403
//   H6 ⓪①(P-204 安全审计 F1/F4)：签发**只对本机真实存在的场景**（`docs/SECURITY-ROUTES.md`）——
//      不透明源（Origin:null）自签 → 403、身份指不到真文件 → 403、非媒体扩展名 → 403；
//      `/raw` 对非白名单 Origin **不回显 ACAO**（F1：任意网页跨源读回）。
// 说明：本测试只在 `os.tmpdir()` 下造夹具（真 `custom-dir.json` + 真 `f1/scene.pkg`），
//      **不碰用户真实数据**；P-204 起"身份必须真实存在"是签发前提，所以夹具是必需的。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-token-home-'))
const customRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-token-dir-'))
fs.mkdirSync(path.join(customRoot, 'f1'), { recursive: true })
fs.mkdirSync(path.join(customRoot, 'f2'), { recursive: true })
fs.writeFileSync(path.join(customRoot, 'f1', 'scene.pkg'), 'PKGV0022-fixture-f1')
fs.writeFileSync(path.join(customRoot, 'f2', 'scene.pkg'), 'PKGV0022-fixture-f2')
fs.writeFileSync(path.join(customRoot, 'f1', 'notes.txt'), 'FIXTURE-DO-NOT-USE')
fs.mkdirSync(path.join(tmpHome, '.dsh-mpkg-wallpaper'), { recursive: true })
fs.writeFileSync(path.join(tmpHome, '.dsh-mpkg-wallpaper', 'custom-dir.json'), JSON.stringify({ dir: customRoot }))
process.env.DSH_HOME = tmpHome
const { apply } = await import('../lib/index.js')

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
const mint2 = call(BASE + '/scene-thumb-token?scene=' + encodeURIComponent('custom|f2|scene.pkg'))
const otherToken = jbody(mint2).token
ok(!!otherToken && otherToken !== mj.token, 'H1 不同场景 → 不同 token（f2 也是真场景）')
eq(call(BASE + '/scene-thumb-token').code, 400, 'H1 缺 scene 参数 → 400')

/* H6 ⓪①(P-204 F4) 签发收口：身份必须是真的；不透明源不许自签 */
console.log('\n== H6 P-204 签发收口（身份真实 + 同源）==')
eq(call(BASE + '/scene-thumb-token?scene=' + encodeURIComponent('custom|f1|nope.pkg')).code, 403, 'H6 身份指向不存在的文件 → 403')
eq(call(BASE + '/scene-thumb-token?scene=' + encodeURIComponent('custom||notes.txt')).code, 403, 'H6 身份是 .txt（非容器/媒体）→ 403')
eq(call(BASE + '/scene-thumb-token?scene=' + encodeURIComponent('custom|f1|scene.pkg'), { origin: 'null' }).code, 403, 'H6 Origin:null（沙箱帧）自签 → 403（改前 200，令牌门形同虚设）')
eq(call(BASE + '/scene-thumb-token?scene=' + encodeURIComponent('custom|f1|scene.pkg'), { origin: 'http://127.0.0.1:8899' }).code, 200, 'H6 白名单源（渲染器 :8899）签发 → 200（跨源严格档链路仍通）')
eq(call(BASE + '/scene-thumb-token?scene=' + encodeURIComponent('custom|..|scene.pkg'), { origin: 'http://127.0.0.1:8899' }).code, 403, 'H6 folder 带 `..` → 403')

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
ok(String(rawLegacyOrigin.headers['access-control-allow-origin'] || '') === 'http://127.0.0.1:8899', 'H4b 白名单源回显 ACAO（跨源读得回）')
const rawEvil = call(RAW, { origin: 'https://evil.example' })
ok(rawEvil.code !== 403 && !rawEvil.headers['access-control-allow-origin'], 'H4c 非白名单源 → **没有 ACAO**（P-204 F1：任意网页不再能跨源读回本机文件）')

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
