// tools/scene-watchdog-test.mjs — 批次15 场景看门狗/调试参数/作用域修复 回归测试
// 覆盖（全部对应 PLUGIN-BUGS-TRACKER 批次 15）：
//   T1  B3 白名单净化：非白名单键（含 skin0）丢弃、注入字符丢弃、存在即生效补 =1、同名去重、上限截断
//   T2  B3 URL 重拼/清空、buster 加/剥幂等
//   T3  B1 身份解析与信标 URL（与宿主 sceneThumbIdentity 同构）
//   T4  B1 看门狗：武装 → 信标确认；超时 → 兜底（diag 落证）；迟到首帧 → 自动恢复；旧信标不误判
//   T5  作用域修复：applySceneViaRenderer 在桥缺席时不再 ReferenceError（此前 P0：所有场景壁纸静默回退）
//   T6  B3 调试参数拼进壁纸 URL 且 skin0 永远进不去；B5 lowmem 透传
import { loadPlugin } from './_stub.mjs'

let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✓ ' + name) } else { fail++; console.error('  ✗ ' + name) } }
const eq = (a, b, name) => ok(a === b, name + (a === b ? '' : `（got=${JSON.stringify(a)} want=${JSON.stringify(b)}）`))
const flush = () => new Promise((r) => setTimeout(r, 8)) // 等看门狗 tick 的 fetch promise 链跑完

const { plugin, sectionComp, diagEvents, fetchCalls } = loadPlugin({
  settings: { sceneWatchdogSecs: 3, sceneDebugParams: 'ln=12; skin0=0&foo=1' },
})
const T = globalThis.__mpwSceneTest
ok(!!T, '测试钩子 __mpwSceneTest 已暴露')

/* ---------- T1 白名单净化 ---------- */
console.log('\n== T1 调试参数净化（B3 白名单）==')
eq(T.sanitize('ln=12&foo=1&skin0=0'), 'ln=12', '非白名单键（foo/skin0）全部丢弃')
eq(T.sanitize('isolate=<script>alert(1)</script>'), '', '值含注入字符 → 整对丢弃')
eq(T.sanitize('nofx'), 'nofx=1', '存在即生效类开关补 =1')
eq(T.sanitize('ln=1;ln=2'), 'ln=2', '同名键后者覆盖')
eq(T.sanitize(''), '', '空输入 → 空串')
eq(T.sanitize('eyehack=0'), 'eyehack=0', '合法值 0 保留（显式关闭）')
ok(T.sanitize('ln=1&novideo&audit=3&ownsize=1&att=legacy&hier=0&nofx&np&trace').split('&').length === 8, '上限 8 对截断')
ok(T.debugKeys.indexOf('skin0') < 0 && T.debugKeys.indexOf('vflip') < 0, '白名单不含 skin0/vflip 等危险/未列开关')

/* ---------- T2 URL 重拼 / buster ---------- */
console.log('\n== T2 URL 重拼与 buster ==')
const U = 'http://127.0.0.1:8899/?pkgurl=http%3A%2F%2Fhost%2Fraw%3Fcustom%3D1%26folder%3Df1%26file%3Dscene.pkg&embed=1&noreport=1&ln=5'
const U2 = T.urlWithDebug(U, 'ln=12&novideo')
ok(U2.indexOf('ln=12') >= 0 && U2.indexOf('novideo=1') >= 0, '旧参数被替换 + 新参数追加')
ok(U2.indexOf('ln=5') < 0, '旧 ln=5 不残留')
const U3 = T.urlWithDebug(U, '')
ok(U3.indexOf('ln=') < 0 && U3.indexOf('pkgurl=') >= 0, '清空：调试参数全剥、业务参数保留')
const UB = T.bust(U)
ok(UB.indexOf('_mpwr=') >= 0, 'buster 已加')
eq(T.stripBust(UB), U, 'buster 剥除后逐位还原（幂等比较安全）')
eq(T.stripBust(U), U, '无 buster 的 URL 原样返回')

/* ---------- T3 身份解析 / 信标 URL ---------- */
console.log('\n== T3 场景身份与信标 URL ==')
const iC = T.identity('http://127.0.0.1:8899/?pkgurl=' + encodeURIComponent('http://127.0.0.1:3080/api/mpkg-wallpaper/raw?custom=1&folder=f1&file=scene.pkg') + '&embed=1')
ok(iC && iC.ident === 'custom|f1|scene.pkg' && iC.kind === 'custom', 'custom 身份（与宿主 sceneThumbIdentity 同构）')
const iL = T.identity('http://127.0.0.1:8899/?pkgurl=' + encodeURIComponent('http://127.0.0.1:3080/api/mpkg-wallpaper/raw?ltoken=abc123&file=scene.pkg') + '&embed=1')
ok(iL && iL.ident === 'library|abc123|scene.pkg' && iL.kind === 'library', 'library 身份')
eq(T.identity('http://127.0.0.1:8899/?id=3719111841'), null, '非 pkgurl 渲染器 URL → 无身份（不武装）')
ok(T.beaconUrl(iC).indexOf('/custom-scene-thumb?folder=f1&file=scene.pkg&lastpost=1') >= 0, 'custom 信标 URL')
ok(T.beaconUrl(iL).indexOf('/library-scene-thumb?ltoken=abc123&file=scene.pkg&lastpost=1') >= 0, 'library 信标 URL')

/* ---------- T4 看门狗状态机 ---------- */
console.log('\n== T4 看门狗：武装/确认/超时兜底/恢复 ==')
const realFetch = globalThis.fetch
const urlCustom = 'http://127.0.0.1:8899/?pkgurl=' + encodeURIComponent('http://127.0.0.1:3080/api/mpkg-wallpaper/raw?custom=1&folder=f1&file=scene.pkg') + '&embed=1&noreport=1'
// 可控信标：lastpost=1 查询按 beaconMode 应答（其余请求透传给桩 fetch，保 diag 采集）
let beaconLastPostAt = 0
let beaconMode = 'ok' // 'ok' = 正常 JSON | 'unauth' = 模拟宿主未重载（401）
globalThis.fetch = async (u, o) => {
  if (String(u).indexOf('lastpost=1') >= 0) {
    if (beaconMode === 'unauth') return { ok: false, status: 401, json: async () => { throw new Error('not json') } }
    return { ok: true, json: async () => ({ ok: true, lastPostAt: beaconLastPostAt }) }
  }
  return realFetch(u, o)
}
T.arm(urlCustom)
let st = T.state()
ok(st.armed && st.ident === 'custom|f1|scene.pkg' && st.secs === 3 && !st.confirmed, '武装成功（secs 取自设置=3）')
// 4a 信标确认：宿主返回 lastPostAt >= armedAt → confirmed
beaconLastPostAt = Date.now()
T.tick(); await flush()
ok(T.state().confirmed === true, '首帧信标（lastPostAt 新鲜）→ 确认出画')
// 4b force 重新计时 → 超时 → 兜底 + diag（先把信标时间戳归零：arm 的同步首查不能确认）
beaconLastPostAt = 0
T.arm(urlCustom, true)
st = T.state()
ok(st.armed && !st.confirmed, 'force（重试路径）重新计时，不沿用旧确认')
T.wd().armedAt -= 30000
T.tick(); await flush()
st = T.state()
ok(st.fallback === true, '超时 → 兜底激活')
ok(diagEvents.some((d) => d.kind === 'scene-render-health' && d.why === 'first-frame-timeout-fallback'), '兜底落插件 diag（kind=scene-render-health）')
// 4c 迟到首帧 → 自动恢复
beaconLastPostAt = Date.now()
T.tick(); await flush()
st = T.state()
ok(st.confirmed === true && st.fallback === false, '迟到首帧 → 自动恢复实时渲染')
ok(diagEvents.some((d) => d.kind === 'scene-render-health' && d.why === 'late-first-frame-recovered'), '恢复也落 diag')
// 4d 旧信标不误确认（lastPostAt 早于武装时刻）
T.arm(urlCustom, true)
beaconLastPostAt = Date.now() - 60 * 1000
T.tick(); await flush()
ok(T.state().confirmed === false, '旧信标（上一次渲染的）不会误判为新首帧')
// 4e 宿主信标路由不可用（dsh 未重启，401）→ 降级：不按超时误兜底，diag 记录
beaconMode = 'unauth'
T.arm(urlCustom, true)
T.wd().armedAt -= 30000
await flush()
st = T.state()
ok(st.confirmed === true && st.fallback === false, '信标不可用 → 降级（不超时兜底，正常渲染不被误伤）')
ok(diagEvents.some((d) => d.kind === 'scene-render-health' && d.why === 'watchdog-beacon-unavailable'), '降级事件落 diag（watchdog-beacon-unavailable）')
beaconMode = 'ok'
// 4f 降级后恢复探测（dsh 重启场景）：再次 arm → 探测成功 → 正常看门狗
T.arm(urlCustom, true)
beaconLastPostAt = 0
await flush()
st = T.state()
ok(st.armed && !st.confirmed, '信标恢复后重新进入正常看门狗（不降级）')
globalThis.fetch = realFetch
T.disarm(false)

/* ---------- T5 作用域修复（P0）+ T6 调试参数/lowmem 透传 ---------- */
console.log('\n== T5/T6 applySceneViaRenderer：作用域修复 + 参数拼接 ==')
ok(typeof T.applyScene === 'function', 'applyScene 暴露给测试（函数定义后挂接）')
// 桥缺席（面板从未渲染）：修复前这里抛 ReferenceError → 被吞 → 静默 return false（场景壁纸全部回退静态帧）
const r1 = T.applyScene({ rawFile: 'scene.pkg', folder: 'f1', title: 'T1', key: 'custom|f1' })
eq(r1, true, '桥缺席时返回 true（不再 ReferenceError 静默失败）')
const iframeEv1 = diagEvents.filter((d) => d.why === 'renderer-iframe').pop()
ok(!!iframeEv1 && String(iframeEv1.url).indexOf('ln=12') >= 0, '设置里的调试参数拼进壁纸 URL')
ok(!iframeEv1 || String(iframeEv1.url).indexOf('skin0') < 0, 'skin0 永远进不了壁纸 URL')
// 渲染一次组件 → 桥注入 → 再调用（setHint/commit 走组件闭包，验证桥真的接通）
let bridgeOk = true
try { sectionComp && sectionComp({ t: (k) => k, close: () => {} }) } catch (e) { bridgeOk = false; console.error('组件渲染（桥注入）失败:', e.message) }
ok(bridgeOk, '组件渲染不抛错（桥注入路径）')
// lowmem：deviceMemory=2 → &lowmem=1
try { Object.defineProperty(globalThis, 'navigator', { value: { deviceMemory: 2, hardwareConcurrency: 8, userAgent: 't', language: 'zh' }, configurable: true }) } catch {}
const r2 = T.applyScene({ rawFile: 'scene.pkg', folder: 'f1', title: 'T1', key: 'custom|f1' })
const iframeEv2 = diagEvents.filter((d) => d.why === 'renderer-iframe').pop()
eq(r2, true, '桥存在时返回 true')
ok(!!iframeEv2 && String(iframeEv2.url).indexOf('lowmem=1') >= 0, '低内存设备 → &lowmem=1 透传（B5）')
ok(!!iframeEv2 && iframeEv2.lowmem === true, 'diag 记录 lowmem 标记')

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
process.exit(fail ? 1 : 0)
