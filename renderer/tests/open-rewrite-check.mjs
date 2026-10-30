#!/usr/bin/env node
// open-rewrite-check.mjs — P-129「新窗口」按钮 `window.open` 前缀改写的判据（秒级，**不 spawn 任何东西**）
//
// 注册（本文件不是"孤儿 harness"）：
//   · `tests/demo-check.mjs` 的 **D12 ④** 段 import 本文件的 runOpenRewriteChecks 一起跑
//     （⇒ `node tests/demo-check.mjs` 整体覆盖这几条；前缀带 `D12 ④` 便于在大跑输出里定位）；
//   · 本文件也能单独跑：`node tests/open-rewrite-check.mjs`（退出码 0 = 全过）——
//     为什么要有独立入口：**整个 demo-check 不能随手跑**（它的 D6 会 spawn 重活 `build-pages.mjs`），
//     本文件只读 3 个文件（补丁真源 / minified 产物片段 / 站点路径真源表），毫秒级、零副作用。
//
// 被钉住的线上事故（P-127 改名留下的小缺口）：站点路径 `/wallpaper-engine-webgl/` → `/WEwebLoader/` 后，
// 运行期只改了 iframe 的 `src`（`HTMLIFrameElement.prototype.src` 包装）⇒ 产物里那条
// `l("#open").onclick=()=>{w&&window.open(\`/wallpaper-engine-webgl/renderer/index.html?…\`,"_blank")}`
// 没人管：线上（Pages 子路径站点）点「新窗口」指到**域名根** ⇒ 404。
//
// 判据（四条主判据 + 回退口 + 接线，每条都能被变异打红，见 PATCHES P-129.4）：
//   ① 旧前缀绝对 URL ⇒ 相对本页（子路径部署也正确）；命中面严格 = 本站两个前缀
//   ② 外链 / `blob:` / `data:` / `about:blank` / 相对路径 / 空串 ⇒ **逐字不变**且参数个数不变
//   ③ 幂等：对已改名的（相对）URL 再跑一次不变，连开两次不叠前缀
//   ④ 三参签名保持：`target`/`features` 照传、参数个数照传、`length` 与原生一致
//   ⑤ 回退口 `?openrewrite=off`：一个字都不改（回到上游原行为）
//   ⑥ 接线：补丁运行期真装了它、用的是同一个真源别名表、产物里那条调用点仍在（靶子不是假想出来的）
'use strict'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

/** 判据全集。`env` = { check, P, read, S? }；返回本文件跑的条数。
 *  · check(name, cond, detail) —— 与 demo-check.mjs 同签名（外部传进来，输出口径一致）；
 *  · P = demo/bench-patch.js 的模块命名空间（**外部传进来** ⇒ 变异副本可直接喂进来，不用改本文件）；
 *  · read(rel) = 读 ROOT 下的文本；S = tools/site-paths.mjs（可选，有就比对"单一真源两侧逐字一致"）。 */
export function runOpenRewriteChecks(env) {
  const { check, P, read } = env
  const S = env.S || null
  let n = 0
  const ck = (name, cond, detail) => { n++; check(name, cond, detail) }

  const OLD = '/wallpaper-engine-webgl/renderer/index.html?src=1&_t=1700000000000'
  const NEW = '/WEwebLoader/renderer/index.html?src=1&_t=1700000000000'

  // ---- ① 旧前缀绝对 URL ⇒ 相对本页 ----
  {
    const p = P.openUrlPlan(OLD, { online: true, prefix: './' })
    ck('D12 ④ ①旧前缀绝对 URL ⇒ 相对本页（线上子路径部署下不再指到域名根；就是 #open 那条的真实形态）',
      p.rewritten === true && p.url === './renderer/index.html?src=1&_t=1700000000000' &&
      !p.url.startsWith('/') && !p.url.includes('wallpaper-engine-webgl') && !p.url.includes('WEwebLoader'),
      JSON.stringify(p))
    // 子路径部署：相对前缀由调用点给（页面在 /demo/ ⇒ './'；再深一层 ⇒ '../'）——两种都必须是**相对**地址
    const deep = P.openUrlPlan(OLD, { online: true, prefix: '../' })
    ck('D12 ④ ①子路径部署（深一层前缀 ../）同样只出相对地址：结果里没有域名根绝对路径、也没有旧名',
      deep.rewritten === true && deep.url === '../renderer/index.html?src=1&_t=1700000000000',
      JSON.stringify(deep))
    // 命中面严格 = 本站两个前缀（新名也认，与 P-127 的 iframe 口径一致）
    const p2 = P.openUrlPlan(NEW, { online: true, prefix: './' })
    ck('D12 ④ ①命中面 = 本站旧名 + 新名两个前缀（同一个 SITE_PATH_ALIASES 真源表）',
      p2.rewritten === true && p2.url === './renderer/index.html?src=1&_t=1700000000000' &&
      P.openUrlPlan('/other/x', { online: true }).rewritten === false &&
      P.openUrlPlan('/wallpaper-engine-webgl', { online: true }).rewritten === false &&   // 无尾斜杠 = 另一条 URL，不算站点前缀
      P.openUrlPlan('/x/wallpaper-engine-webgl/renderer/index.html', { online: true }).rewritten === false, // 前缀只认**开头**
      JSON.stringify([p2, P.openUrlPlan('/other/x', { online: true })]))
    // 本机静态台（:8901，旧路径是软链）不改写 —— 与 iframe 那条同一个守卫
    const local = P.openUrlPlan(OLD, { online: false })
    ck('D12 ④ ①本机形态（online:false）不改写：:8901 的旧路径是软链、原样可用（与 iframe 同口径）',
      local.rewritten === false && local.url === OLD && local.reason === 'local-bench', JSON.stringify(local))
    // 运行期同一条（防"计划对了但没接上"的假修）：装好的 window.open 把旧绝对前缀真交给原生成相对地址
    const { win, calls } = fakeWindow()
    const inst = P.installOpenRemap(win, { online: true, prefix: './' })
    win.open(OLD, '_blank', 'noopener')
    ck('D12 ④ ①运行期：装好的 window.open 真把那条旧绝对路径交给原生成相对本页地址（包装确实在生效）',
      inst.installed === true && calls.length === 1 && calls[0][0] === './renderer/index.html?src=1&_t=1700000000000',
      JSON.stringify([inst, calls[0]]))
  }

  // ---- ② 外链 / blob: / data: / about:blank / 相对路径 ⇒ 逐字不变 ----
  {
    const same = [
      'https://example.com/x?y=1#z',                 // 外链
      'http://127.0.0.1:1430/demo/index.html',       // 本机别处的绝对 URL（不属本站前缀）
      '//cdn.example.com/x.js',                      // 协议相对外链
      'blob:https://u.github.io/0f9a-1b2c',          // blob:
      'data:text/html,<b>hi</b>',                    // data:
      'data:image/png;base64,iVBORw0KGgo=',          // data:（base64）
      'about:blank',                                 // about:blank
      'about:srcdoc',
      'mailto:a@b.c',
      '#anchor',
      'renderer/index.html?src=1',                   // 相对路径（上游若已写相对，不许动）
      './renderer/index.html?src=1',                 // 相对路径（本补丁自己改写的产物形态）
      '../renderer/index.html',
      '/WEwebLoader-sibling/x',                      // 前缀相似但**不是**那个挂载点
      '/wallpaper-engine-webglX/x',
      '',
      'wallpaper-engine-webgl/renderer/index.html',  // 不带前导斜杠 = 相对路径，不是绝对前缀
    ]
    const bad = same.filter((u) => {
      const p = P.openUrlPlan(u, { online: true, prefix: './' })
      return p.rewritten !== false || p.url !== u
    })
    ck('D12 ④ ②外链 / blob: / data: / about:blank / 相对路径 / 空串 ⇒ 计划层逐字不变（' + same.length + ' 条）',
      bad.length === 0, bad.map((u) => JSON.stringify(u) + '→' + JSON.stringify(P.openUrlPlan(u, { online: true }).url)).join(' | '))

    // 运行期同一条：包装后的 window.open 交给原生的**实参**必须逐字相同、个数相同
    const { win, calls } = fakeWindow()
    P.installOpenRemap(win, { online: true, prefix: './' })
    for (const u of same) win.open(u, '_blank', 'noopener')
    const drifted = same.filter((u, i) => calls[i][0] !== u || calls[i].length !== 3)
    ck('D12 ④ ②运行期：包装后的 window.open 对外链/blob/data/about:blank 的实参逐字不变（不是"等值"，是同一个串）',
      drifted.length === 0, drifted.map((u, i) => JSON.stringify(u) + '→' + JSON.stringify(calls[same.indexOf(u)])).join(' | '))
  }

  // ---- ③ 幂等 ----
  {
    const once = P.openUrlPlan(OLD, { online: true, prefix: './' })
    const twice = P.openUrlPlan(once.url, { online: true, prefix: './' })
    ck('D12 ④ ③幂等：改写结果是相对路径 ⇒ 对"已改名的 URL"再跑一次不变（不重复改写）',
      once.rewritten === true && twice.rewritten === false && twice.url === once.url && twice.reason === 'not-site-path',
      JSON.stringify([once, twice]))
    const { win, calls } = fakeWindow()
    P.installOpenRemap(win, { online: true, prefix: './' })
    win.open(OLD, '_blank')          // ①旧绝对路径 → 相对
    win.open(OLD, '_blank')          // 连开第二次：同一条旧 URL（产物每次都喂旧名）⇒ 同样结果，不叠前缀
    win.open('./renderer/index.html?src=1&_t=1700000000000', '_blank')   // 已改名的形态
    ck('D12 ④ ③运行期幂等：连开两次旧 URL 得到同一条相对地址；把相对地址再喂进去也一字不改',
      calls[0][0] === './renderer/index.html?src=1&_t=1700000000000' &&
      calls[1][0] === calls[0][0] && calls[2][0] === './renderer/index.html?src=1&_t=1700000000000',
      JSON.stringify(calls.map((c) => c[0])))
  }

  // ---- ④ 三参签名保持（target/features 不丢） ----
  {
    const { win, calls } = fakeWindow()
    P.installOpenRemap(win, { online: true, prefix: './' })
    const ret = win.open(OLD, '_blank', 'width=800,height=600,noopener')
    ck('D12 ④ ④三参签名：window.open(url,target,features) 的 target/features 原样落到原生（且返回值照传）',
      calls.length === 1 && calls[0].length === 3 && calls[0][1] === '_blank' &&
      calls[0][2] === 'width=800,height=600,noopener' && calls[0][0] === './renderer/index.html?src=1&_t=1700000000000' &&
      ret === 'WIN',
      JSON.stringify([calls[0], ret]))
    // 参数个数照传：window.open() / (url) / (url,target) 不许被"补成三参"
    const { win: w2, calls: c2 } = fakeWindow()
    P.installOpenRemap(w2, { online: true, prefix: './' })
    w2.open(); w2.open(OLD); w2.open(OLD, '_self')
    ck('D12 ④ ④参数个数照传（0/1/2/3 参分别 0/1/2/3 参到原生；window.open() 仍是 about:blank 语义）',
      c2.length === 3 && c2[0].length === 0 && c2[1].length === 1 && c2[2].length === 2,
      JSON.stringify(c2.map((c) => c.length)))
    // length 钉回**原生**值：真实浏览器 window.open.length = 0（三个形参全可选）⇒ 包装后必须也是 0
    const { win: w3, calls: c3 } = fakeWindow()
    const zeroLen = { location: { href: 'https://u.github.io/x/' }, open(...args) { return args.length } }
    P.installOpenRemap(w3, { online: true, prefix: './' })
    P.installOpenRemap(zeroLen, { online: true, prefix: './' })
    ck('D12 ④ ④包装函数的 length 钉回原生值（真实浏览器 window.open.length=0 ⇒ 0；3 参假宿主 ⇒ 3，形态度量不漂）',
      w3.open.length === 3 && zeroLen.open.length === 0 && zeroLen.open(OLD) === 1 &&
      c3.length === 0, JSON.stringify([w3.open.length, zeroLen.open.length, zeroLen.open(OLD)]))
  }

  // ---- ⑤ 回退口 ?openrewrite=off ----
  {
    const flags = P.readPatchFlags('?openrewrite=off')
    ck('D12 ④ ⑤回退口：?openrewrite=off ⇒ FLAGS.openrewrite=false（默认不加参数 = 开）',
      flags.openrewrite === false && P.readPatchFlags('').openrewrite === true &&
      P.readPatchFlags('?openrewrite=0').openrewrite === false && P.readPatchFlags('?openrewrite=false').openrewrite === false,
      JSON.stringify([flags.openrewrite, P.readPatchFlags('').openrewrite]))
    const { win, calls } = fakeWindow()
    const res = P.installOpenRemap(win, { enabled: false, online: true, prefix: './' })
    win.open(OLD, '_blank', 'noopener')
    ck('D12 ④ ⑤回退口：关掉时**不装**包装（reason=flag-off），旧绝对路径一字不改地交给原生（= 上游原行为）',
      res.installed === false && res.reason === 'flag-off' && calls.length === 1 &&
      calls[0][0] === OLD && calls[0][1] === '_blank' && calls[0][2] === 'noopener',
      JSON.stringify([res, calls[0]]))
    const already = P.installOpenRemap(win, { enabled: false, online: true })
    ck('D12 ④ ⑤已装过不重复包（__benchDemoRemapOpen 标记；重复 init 不会套两层）',
      P.installOpenRemap(fakeWindow().win, { online: true, prefix: './' }).installed === true &&
      already.installed === false && already.reason === 'flag-off',
      JSON.stringify(already))
  }

  // ---- ⑥ 接线（补丁真装了它 + 同一个真源表 + 产物里靶子还在） ----
  {
    const patchSrc = read('demo/bench-patch.js')
    ck('D12 ④ ⑥补丁运行期真装了它：installOpenRemap 调用点带 FLAGS.openrewrite + 与 iframe 同一个 onlineDemoEnv 守卫',
      /const openRes = installOpenRemap\(/.test(patchSrc) && /enabled: FLAGS\.openrewrite/.test(patchSrc) &&
      /online: onlineDemoEnv\(/.test(patchSrc) && /prefix: demoPrefix/.test(patchSrc),
      'installOpenRemap 调用点')
    ck('D12 ④ ⑥改写走的是**同一个**真源函数（openUrlPlan → sitePathAliasOf + demoAssetUrl），别名表在补丁里只定义一次（没有第二份前缀表）',
      /export function openUrlPlan\(url, opt\) \{[\s\S]*?sitePathAliasOf\(s\)[\s\S]*?demoAssetUrl\(s,/.test(patchSrc) &&
      /export function demoAssetUrl\(url, prefix\) \{[\s\S]*?sitePathAliasOf\(s\)/.test(patchSrc) &&
      (patchSrc.match(/export const SITE_PATH_ALIASES = /g) || []).length === 1 &&
      /for \(const p of SITE_PATH_ALIASES\) if \(s\.indexOf\(p\) === 0\)/.test(patchSrc),
      'SITE_PATH_ALIASES 定义处数 = ' + (patchSrc.match(/export const SITE_PATH_ALIASES = /g) || []).length)
    const bundle = read('demo/assets/bench-DSKWIqmS.js')
    ck('D12 ④ ⑥产物里那条调用点仍在（minified 不可重建 ⇒ 靶子属实，不是假想出来的缺口）',
      bundle.includes('l("#open").onclick=()=>{w&&window.open(`/wallpaper-engine-webgl/renderer/index.html?${wt(w)}`,"_blank")}'),
      'bench-DSKWIqmS.js 的 #open 处理器')
    ck('D12 ④ ⑥产物里 `/…/renderer/index.html` 仍是 3 处（2 处 iframe k.src= + 1 处 window.open）—— 这条就是"iframe 包装永远覆盖不到第 3 处"的证据',
      (bundle.match(/wallpaper-engine-webgl\/renderer\/index\.html/g) || []).length === 3 &&
      (bundle.match(/k\.src=`\/wallpaper-engine-webgl\/renderer\/index\.html/g) || []).length === 2 &&
      (bundle.match(/window\.open\(`\/wallpaper-engine-webgl\/renderer\/index\.html/g) || []).length === 1,
      'renderer/index.html 命中数')
    if (S) {
      ck('D12 ④ ⑥两侧真源逐字一致（构建侧 tools/site-paths.mjs ↔ 补丁侧常量；改一半即红）',
        P.SITE_MOUNT === S.SITE_MOUNT && P.SITE_MOUNT_LEGACY === S.SITE_MOUNT_LEGACY &&
        JSON.stringify(P.SITE_PATH_ALIASES) === JSON.stringify(S.SITE_PATH_ALIASES),
        JSON.stringify([P.SITE_PATH_ALIASES, S.SITE_PATH_ALIASES]))
    }
  }
  return n
}

/** 假 window：原生 open 记下**实参数组**（含个数），返回哨兵值 'WIN'。
 *  刻意用 `function open(url, target, features)` 声明 ⇒ `length === 3`，可验证包装后 length 与原生一致；
 *  真实浏览器里 `window.open.length === 0`，那是**原生**的事，本判据只要求"包装不改这个数"。 */
function fakeWindow() {
  const calls = []
  const win = {
    location: { href: 'https://u.github.io/wallpaper-engine-web-loader/demo/index.html' },
    open: function open(url, target, features) { calls.push(Array.prototype.slice.call(arguments)); return 'WIN' },
  }
  return { win, calls }
}

// ---------------- 独立入口（`node tests/open-rewrite-check.mjs`） ----------------
const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const invokedDirectly = (() => {
  try { return !process.argv[1] || path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) } catch { return false }
})()
if (invokedDirectly) {
  let pass = 0, fail = 0
  const check = (name, cond, detail) => {
    if (cond) { pass++; console.log('  ✓ ' + name) }
    else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')) }
  }
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
  const P = await import(pathToFileURL(path.join(ROOT, 'demo', 'bench-patch.js')).href)
  const S = await import(pathToFileURL(path.join(ROOT, 'tools', 'site-paths.mjs')).href)
  const n = runOpenRewriteChecks({ check, P, S, ROOT, read })
  console.log(`\n===== open-rewrite-check: ${pass} 通过 / ${fail} 失败（本文件 ${n} 条） =====`)
  process.exit(fail ? 1 : 0)
}
