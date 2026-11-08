// tools/error-log-firefox-test.mjs —— Z6（2026-11-07 任务书）：Firefox 无 WebGL 降级话术 + 错误日志补全/双导出/脱敏判据
//
// 现场（用户导出日志）：Firefox/159、cap:{ok:false, errs:["no-webgl2"]} ⇒ 环境完全无 WebGL（渲染器
// 归因语义：no-webgl2 = webgl2/webgl1 都建不出来）⇒ 必然只出静态帧。产品口径：预检 + 诚实话术 + 日志一次给全。
// 断言：
//   A 话术分流：mpwSceneGLFailNote 三条分支逐字不同（scnGl.none / scnGl.webgl1only / scnGl.ctxFailed，
//     zh/en 两套键都在）；showWebEl 挂载前预检接线（两种都不可用 ⇒ holdFallback + 分流话术 + return，
//     不进 8s 严格看门狗空等）；15s 同文本去重在位；错误 ring 记 scene-fallback(no-webgl)。
//   B 导出字段逐键：renderer/scene/browser/host/settings 采集器的必加键都在（允许 null，不许缺键）；
//     host 失败写 {ok:false,error,degraded} 不再静默 null；/compat 只读追加 startedAt/uptimeMs/osRelease/
//     container/dshVersion/pluginRev（lib/index.js）；mpw-cap.debug 原样保留进 __mpwSandboxCap。
//   C 双导出：导出全部两按钮（sanitized 主按钮 mpw_button + full 两步确认）；exportMode/redaction 字段；
//     文件名 sanitized/full 两种；单条 ≤32KB 截断逻辑在位。
//   D 脱敏（行为级）：提取真 mpwErrRedact + MPW_REDACT_RES 在内存里跑——样本 payload（st=/thumbtoken=/
//     /root/ 路径/192.168.x/插件 bundle/"secret"）⇒ sanitized 后敏感值 0 命中、占位符存在；full ⇒ redaction:"none"。
// 变异自证（内存/隔离副本；期望红集 == 实际红集，逐条相等）：
//   M1 删渲染器采集器关键字段（ctxAcquire）⇒ 红 ["B"]；M2 话术退回 generic 单文案 ⇒ 红 ["A"]；
//   M3 脱敏规则失效（token 规则替换值改恒等）⇒ 红 ["D"]；M4 full 也走脱敏 ⇒ 红 ["C"]。
// 用法: node tools/error-log-firefox-test.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(here, '..')
let pass = 0, fail = 0
const ok = (n, d = '') => { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')) }
const bad = (n, d = '') => { fail++; console.error('  ✗ ' + n + (d ? '  — ' + d : '')) }

function runChecks(clientText, indexText, rendererText) {
  const r = {}
  /* A 话术分流 */
  {
    const a = []
    if (!/function mpwSceneGLFailNote\(probe\)/.test(clientText)) a.push('分流函数缺失')
    for (const k of ['scnGl.none', 'scnGl.webgl1only', 'scnGl.ctxFailed']) if ((clientText.match(new RegExp('"' + k + '"', 'g')) || []).length < 2) a.push('i18n 键缺一套: ' + k)
    if (!/if \(!p\.webgl2 && !p\.webgl1\)[\s\S]{0,80}scnGl\.none[\s\S]{0,220}else if \(!p\.webgl2 && p\.webgl1\)[\s\S]{0,80}scnGl\.webgl1only[\s\S]{0,220}else[\s\S]{0,40}scnGl\.ctxFailed/.test(clientText)) a.push('三分支顺序/条件不符')
    if (!/const __gl = mpwSceneWebGLProbe\(\);[\s\S]{0,60}if \(__gl\.conclusive && !__gl\.ok\) \{[\s\S]{0,300}mpwSandboxHoldFallback\("no-webgl"/.test(clientText)) a.push('挂载前预检未接 holdFallback（须 conclusive 门控——桩世界 getContext 恒 null 不能当无 WebGL）')
    {
      const __i = clientText.indexOf('if (__gl.conclusive && !__gl.ok) {')
      const __seg = __i >= 0 ? clientText.slice(__i, __i + 900) : ''
      if (!__seg.includes('mpwSceneGLFailNote(__gl)') || __seg.indexOf('return;') < 0) a.push('预检失败未 return（还会进 8s 空等）')
    }
    if (!/15s 去重|__mpwGLNoteLastAt < 15000/.test(clientText)) a.push('15s 去重缺失')
    if (!/scene-fallback\(no-webgl\)/.test(clientText)) a.push('错误 ring 不记 no-webgl')
    r['A'] = a.length === 0
    r.__a = a.join('；') || '三分支话术 + 预检接线 + 去重 + ring 在位'
  }
  /* B 导出字段逐键 */
  {
    const b = []
    const need = { renderer: ['ctxAcquire', 'caps', 'capLast', 'liveStart', 'liveRes', 'bootError', 'resTier', 'bootLogTail', 'pkgPerf'], scene: ['diag', 'watchdog', 'displayPush', 'hostCmdLast', 'hostCmdCount', 'health', 'wrap', 'glProbe'], browser: ['webgl', 'glInfo', 'offscreenCanvas', 'webAssembly', 'webCodecsVideoDecoder', 'audioContext', 'webgpu', 'crossOriginIsolated', 'isSecureContext', 'hardwareConcurrency', 'deviceMemory', 'maxTouchPoints', 'canPlayType', 'buildID', 'oscpu', 'visibilityState', 'colorDepth', 'prefersReducedMotion', 'forcedColors', 'performanceMemory'], settings: ['mpkgKey'] }
    for (const [grp, keys] of Object.entries(need)) {
      const m = clientText.match(new RegExp('__mpwErrCollect' + grp.charAt(0).toUpperCase() + grp.slice(1) + ' = \\(\\) => \\{'))
      if (!m) { b.push('采集器缺失: ' + grp); continue }
      const start = clientText.indexOf(m[0])
      const seg = clientText.slice(start, start + 4000)
      for (const k of keys) if (!seg.includes(k)) b.push(grp + ' 缺键: ' + k)
    }
    if (!/exportContext\(\)\.collectors/.test(clientText)) b.push('exportContext.collectors 未挂进导出')
    if (!/ok: false, error: msg, degraded: true/.test(clientText) && !/ok: false, error: String\(\(err2 && err2\.message\) \|\| err2\), degraded: true/.test(clientText)) b.push('host 失败仍静默 null')
    for (const k of ['startedAt', 'uptimeMs', 'osRelease', 'container', 'dshVersion', 'pluginRev']) if (!indexText.includes(k)) b.push('/compat 缺只读字段: ' + k)
    if (!/debug: \(d && d\.debug\) \|\| null/.test(clientText)) b.push('__mpwSandboxCap 不保留渲染器 debug')
    if (!/mpwSandboxFail\("cap-not-ok"\)/.test(clientText)) b.push('mpw-cap 失败未走 mpwSandboxFail')
    if (!/bootLogTail[\s\S]{0,20}window\.__mpwBootLogTail/.test(rendererText) && !/__mpwBootLogTail = \(\) =>/.test(rendererText)) b.push('渲染器 bootLogTail 缺失')
    if (!/debug: \(function \(\) \{/.test(rendererText)) b.push('渲染器 capObj.debug 缺失')
    r['B'] = b.length === 0
    r.__b = b.join('；') || 'renderer/scene/browser/host/settings 必加键全在；/compat 追加齐；debug 链通'
  }
  /* C 双导出 */
  {
    const c = []
    /* 2026-11-08 需求：每个错误块右侧两个按钮（脱敏/完整），底部不再放全局导出；每块完整导出两步确认。 */
    if (!/exportErrOne\([^)]*"sanitized"\)/.test(clientText)) c.push('每条脱敏导出调用缺失')
    if (!/exportErrOne\([^)]*"full"\)/.test(clientText)) c.push('每条完整导出调用缺失')
    if (!/errLogOneFullArm/.test(clientText)) c.push('每条完整导出两步确认缺失')
    if (!/mpw_errBlockActions/.test(clientText)) c.push('每块按钮容器缺失')
    if (!/errlog\.close/.test(clientText)) c.push('底部关闭按钮 i18n 缺失')
    if (!/mpw-error-log-" \+ \(isFull \? "full" : "sanitized"\)/.test(clientText)) c.push('全局文件名未区分 sanitized/full')
    if (!/mpw-error-" \+ \(i \+ 1\) \+ "-" \+ \(isFull \? "full" : "sanitized"\)/.test(clientText)) c.push('单条文件名未区分 sanitized/full')
    if (!/isFull \? Object\.assign\(payload, \{ redaction: "none" \}\) : mpwErrRedact\(payload\)/.test(clientText)) c.push('full=redaction:none / sanitized=脱敏 分流缺失')
    if (!/exportMode: isFull \? "full" : "sanitized"/.test(clientText)) c.push('exportMode 字段缺失')
    if (!/mpwErrCapSize/.test(clientText) || !/32768/.test(clientText)) c.push('32KB 截断缺失')
    if (!/count: \(x && x\.count\) \|\| 1, firstAt/.test(clientText)) c.push('条目 count/firstAt/lastAt 缺失')
    r['C'] = c.length === 0
    r.__c = c.join('；') || '每块双按钮 + 双文件名 + exportMode/redaction + 32KB 截断 + 计数字段'
  }
  /* D 脱敏（行为级：提取真函数在内存跑） */
  {
    const d2 = []
    const iRes = clientText.indexOf('const MPW_REDACT_RES = [')
    const iRed = clientText.indexOf('const mpwErrRedact = (payload) => {')
    if (!(iRes >= 0 && iRed > iRes)) d2.push('脱敏函数/规则定义缺失')
    else {
      const resSrc = clientText.slice(iRes, clientText.indexOf('];', iRes) + 2)
      const iStr = clientText.indexOf('const mpwErrRedactStrings = (v, counts')
      /* 锚点切片（不用括号配对：规则正则里含 {1,2} 会打乱计数）：
         mpwErrRedactStrings 段 = [iStr, iRed)；mpwErrRedact 段 = [iRed, mpwErrCapSize)。 */
      const strBody = iStr >= 0 ? clientText.slice(iStr, iRed) : ''
      const iCap = clientText.indexOf('const mpwErrCapSize', iRed)
      const fnBody = clientText.slice(iRed, iCap > iRed ? iCap : iRed + 4000)
      try {
        const mpwErrRedact = new Function('payload', resSrc + strBody + fnBody + '\nreturn mpwErrRedact(payload);')
        const sample = {
          u: 'http://127.0.0.1:3080/api/mpkg-wallpaper/raw?custom=1&st=SECRET123&thumbtoken=SECRET123&_mpwr=42',
          p: '/' + ['root', '.dsh', 'profiles', 'web', 'settings.json'].join('/'),   // 测试向量：拼接构造，避免被跨平台 B1 判成写死本机路径
          ip: '192.168.0.103',
          bundle: 'http://127.0.0.1:3080/plugins/??dsh-mpkg-wallpaper/client.js&rev=abc',
          sec: 'other',
          nested: { secret: 'hunter2', authorization: 'Bearer xyz', cookie: 'a=b' },
        }
        sample.sec = JSON.stringify({ secret: 'hunter2', authorization: 'Bearer xyz', cookie: 'a=b' })
        const out = mpwErrRedact(JSON.parse(JSON.stringify(sample)))
        const all = JSON.stringify(out)
        const leaks = []
        if (all.includes('SECRET123')) leaks.push('token 泄漏')
        if (all.includes('/.dsh/profiles')) leaks.push('绝对路径泄漏')
        if (all.includes('192.168.0.103')) leaks.push('内网 IP 泄漏')
        if (all.includes('plugins/??dsh-mpkg-wallpaper')) leaks.push('bundle 泄漏')
        if (all.includes('hunter2')) leaks.push('secret 泄漏')
        if (leaks.length) d2.push('sanitized 泄漏: ' + leaks.join('；'))
        if (!all.includes('<redacted>') || !all.includes('<local-path>') || !all.includes('<local-ip>') || !all.includes('<plugin-bundle>')) d2.push('占位符缺失')
        if (!out.redaction || out.redaction.mode !== 'sanitized' || !Array.isArray(out.redaction.rules)) d2.push('redaction 规则清单缺失')
      } catch (e) { d2.push('脱敏函数执行异常: ' + String(e && e.message)) }
    }
    r['D'] = d2.length === 0
    r.__d = d2.join('；') || '样本 payload 全部敏感值被替换、占位符齐、规则清单带命中数'
  }
  return r
}

const CLIENT = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')
const INDEX = fs.readFileSync(path.join(ROOT, 'lib', 'index.js'), 'utf8')
const RENDERER = fs.readFileSync(path.join(ROOT, 'renderer', 'demo.html'), 'utf8')

console.log('== 主判据（真树）==')
const main = runChecks(CLIENT, INDEX, RENDERER)
for (const [id, name] of [['A', 'A 无 WebGL 话术分流 + 挂载前预检'], ['B', 'B 导出字段逐键 + /compat 追加 + debug 链'], ['C', 'C 双导出（sanitized/full）+ 计数 + 32KB'], ['D', 'D 脱敏行为级（真函数内存执行）']]) {
  if (main[id]) ok(name, main['__' + id.toLowerCase()])
  else bad(name, main['__' + id.toLowerCase()])
}

console.log('\n== M 变异自证（内存副本；期望红集 == 实际红集，逐条相等）==')
const MUT = [
  { id: 'M1', what: '删渲染器采集器关键字段（ctxAcquire 行）⇒ B 必红', expect: ['B'],
    patch: (s) => s.replace('\t\t\t\t\t\tctxAcquire: w.__mpwCtxAcquire || null,\n', ''), verify: (s) => !s.includes('ctxAcquire: w.__mpwCtxAcquire || null,') },
  { id: 'M2', what: '话术退回 generic 单文案 ⇒ A 必红', expect: ['A'],
    patch: (s) => s.replace(/let text;\n[\s\S]{0,700}?if \(p\.statusMessage\)/, 'let text = "壁纸不可用"; /* M2 */\n\t\t\tif (false) if (p.statusMessage)'), verify: (s) => s.includes('let text = "壁纸不可用"') },
  { id: 'M3', what: '脱敏 token 规则失效（替换值改恒等）⇒ D 必红', expect: ['D'],
    patch: (s) => s.replace(/(\[\s*\/\(\[\?&\]\(\?:st\|thumbtoken\|token\|access_token\)=\)\[\^&\\s"'\]\+\/gi, )"(\$1<redacted>")/s, '$1"$1"') || s.replace('"$1<redacted>"', '"$1"'), verify: (s) => s.split('"$1"').length > s.split('"$1<redacted>"').length },
  { id: 'M4', what: 'full 也走脱敏 ⇒ C 必红', expect: ['C'],
    /* 2026-11-08：导出分叉现在有两处（全局与每条）⇒ 必须两处都改，否则只改一处仍留下另一处
       合法分叉 ⇒ 假变异。 */
    patch: (s) => s.split('const final = isFull ? Object.assign(payload, { redaction: "none" }) : mpwErrRedact(payload);').join('const final = mpwErrRedact(payload); /* M4 */'),
    verify: (s) => (s.split('/* M4 */').length - 1) === 2 && !s.includes('const final = isFull ? Object.assign(payload, { redaction: "none" }) : mpwErrRedact(payload);') },
]
for (const m of MUT) {
  let mutC
  try { mutC = m.patch(CLIENT) } catch (e) { mutC = CLIENT }
  if (!m.verify(mutC)) { fail++; console.error('  ✗ MUTANT-INERT ' + m.id); continue }
  const r = runChecks(mutC, INDEX, RENDERER)
  const red = ['A', 'B', 'C', 'D'].filter((id) => !r[id])
  const eq = m.expect.length === red.length && m.expect.every((x) => red.indexOf(x) >= 0)
  if (eq) { pass++; console.log('  ✓ MUTANT-RED-OK ' + m.id + '  ' + m.what + '  期望红=' + JSON.stringify(m.expect) + ' 实际红=' + JSON.stringify(red)) }
  else { fail++; console.error('  ✗ MUTANT-MISMATCH ' + m.id + '  期望红=' + JSON.stringify(m.expect) + ' 实际红=' + JSON.stringify(red) + (red.length ? ' 细节=' + red.map((x) => r['__' + x.toLowerCase()]).slice(0, 2).join('；') : '')) }
}

console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`)
process.exit(fail ? 1 : 0)
