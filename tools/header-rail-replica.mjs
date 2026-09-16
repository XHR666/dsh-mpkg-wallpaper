#!/usr/bin/env node
/**
 * header-rail-replica.mjs —— 「顶栏磨砂 / 顶栏描边 / 右侧时间线条」的真机复刻 A/B 探针
 *
 * 为什么需要它（而不是只靠 hdr-probe.mjs 的截图像素差）：
 *   本机是**无 GPU 容器**，无头 Firefox 的 `CSS.supports('backdrop-filter')` 返回 true，
 *   但**不合成** backdrop-filter —— tools/probe-out 的对照实验里 `blur(0/10/30px)` 三种情况
 *   截图**逐像素完全相同**（见 docs/HEADER-FROST.md「像素判据的边界」）。
 *   因此"模糊有没有画出来"在本机**无法**用像素判定；本脚本改判**结构性事实**：
 *     · 层是否存在、backdrop-filter 计算值是否含 blur(Npx)；
 *     · 层在层叠中的位置（z-index 正负 + 宿主子节点被抬到 z-index:1）；
 *     · 层的可见性/几何（rect 覆盖父框、opacity/visibility/display）；
 *     · 顶栏下描边的最终计算值（rgb + alpha ⇒ 可见/透明）；
 *     · rail 条 ::before 的 background alpha + 反色晕 box-shadow + 几何。
 *
 * 关键点：宿主 DOM 与 CSS 用**真实产物**复刻（不是手写样式）：
 *   · 宿主顶栏 CSS 取自 DSH 真机产物（wSkVaW_header 的 border-bottom/底色，见下方 HOST_HEADER_CSS）；
 *   · 我们的 CSS 由**真插件的 buildCss()** 产出（经 tools/_stub.mjs 调用 __mpwBuildCss）；
 *     `--variant before` 会把本轮修复逐条还原（border-bottom transparent / z-index:-1 / 无晕），
 *     `--variant after` 用当前工作区代码 ⇒ 同一 DOM 下两次测量即为「改前/改后」对照表。
 *
 * 用法：
 *   node tools/header-rail-replica.mjs --variant before|after [--out tools/probe-out]
 *   node tools/header-rail-replica.mjs --both          # 两个变体一起跑并打印对照表
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { loadPlugin } from './_stub.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(here, '..')
const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
const OUT = path.resolve(ROOT, arg('out', 'tools/probe-out'))
const BOTH = argv.includes('--both')
fs.mkdirSync(OUT, { recursive: true })

/* ── 夹具纪律（2026-09-17 事故：本步曾硬编码拷 `/tmp/mpw-exp/lines.png`，那个历史目录被磁盘清理
   删掉后 check.sh 第 9 步必红。**测试夹具绝不能依赖 /tmp 里的历史残留**）：
   · 需要的素材（条纹壁纸 PNG、before 变体源码）一律**现场生成**；
   · 临时文件必须落在 `fs.mkdtempSync(path.join(os.tmpdir(), 前缀))` 里，并**在 try/finally（或
     process.on('exit')）里删除**；parent 与 `--child` 各自建、各自删，任何提前 return/抛错都要删；
   · 只有**人读证据**（KB 级 measure.json / replica.html / lines.png / shot.png）留在 tools/probe-out/。 */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-replica-'))
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })

/** 纯 Node 生成"高频条纹"小 PNG（确定性、KB 级；IHDR+IDAT+IEND，无第三方依赖）。 */
function stripedPng (w = 64, h = 32) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    const off = y * (w * 3 + 1)
    for (let x = 0; x < w; x++) {
      const i = off + 1 + x * 3
      const light = (((x >> 2) + (y >> 2)) & 1) === 0
      raw[i] = light ? 0xe8 : 0x28
      raw[i + 1] = light ? 0xe8 : 0x30
      raw[i + 2] = light ? 0xf0 : 0x40
    }
  }
  const table = stripedPng._t || (stripedPng._t = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c } return t })())
  const crc32 = (buf) => { let c = -1; for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0 }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const t = Buffer.from(type, 'ascii')
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])))
    return Buffer.concat([len, t, data, crc])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// ── 1. 生成"我们的 CSS 产物"（改前 / 改后）──
function buildCssFor(variant) {
  let clientPath = path.join(ROOT, 'lib', 'client.js')
  if (variant === 'before') {
    // 逐条把本轮修复还原（与 git diff 对应，保证"改前"是可复算的确定态）
    const src0 = fs.readFileSync(clientPath, 'utf8')
    let src = src0
    const reps = [
      ['\tbackground-color: var(--mpw-hdr-frost-bg, rgba(255, 255, 255, 0.38)) !important;\n}',
        '\tbackground-color: var(--mpw-hdr-frost-bg, rgba(255, 255, 255, 0.38)) !important;\n\tborder-bottom: 1px solid transparent !important;\n}'],
      ['\tbackground-color: var(--mpw-hdr-frost-bg, rgba(18, 22, 30, 0.45)) !important;\n}',
        '\tbackground-color: var(--mpw-hdr-frost-bg, rgba(18, 22, 30, 0.45)) !important;\n\tborder-bottom: 1px solid transparent !important;\n}'],
      ['el.style.cssText = "position:absolute;inset:0;z-index:0;pointer-events:none;border-radius:inherit;";',
        'el.style.cssText = "position:absolute;inset:0;z-index:-1;pointer-events:none;border-radius:inherit;";'],
      // 改前：磨砂层没有任何 CSS 层叠兜底（z-index 只来自内联的 -1），宿主内容也不抬升
      ['.mpw-hdrFrost { z-index: 0 !important; background: transparent !important; }',
        '.mpw-hdrFrost { }'],
      ['.wSkVaW_header:has(> .mpw-hdrFrost) > :not(.mpw-hdrFrost) { position: relative; z-index: 1; }\n.mpw-hdrFrost:first-child ~ * { position: relative; z-index: 1; }\n.wSkVaW_header > .mpw-hdrFrost { z-index: 0 !important; }', ''],
    ]
    for (const [a, b] of reps) { if (!src.includes(a)) throw new Error('before 变体：源码锚点缺失 → ' + a.slice(0, 50)); src = src.replace(a, b) }
    src = src.replace(/\tbox-shadow: 0 0 0 1px var\(--mpw-rail-halo, rgba\(255, 255, 255, 0\.55\)\);\n/g, '')
    clientPath = path.join(TMP, 'client-before.js')   // 临时物落 mkdtemp，退出即删（不留在 probe-out 里当残留）
    fs.writeFileSync(clientPath, src)
  }
  loadPlugin({ clientPath, settings: {
    enabled: true, image: 'data:image/png;base64,iVBORw0KGgo=', unifyTint: true, unifyAmount: 30,
    headerBg: true, headerBlur: false, headerFrostUserSet: true, float: true,
  }, search: '', quiet: true })
  const css = String(globalThis.__mpwBuildCss({}) || '')
  if (!css.length) throw new Error('buildCss 产物为空（变体 ' + variant + '）')
  return css
}

// ── 2. 复刻页面：宿主顶栏（真产物 CSS）+ 我们的产物 + 注入层 + 壁纸 + rail ──
const HOST_HEADER_CSS = `
/* 宿主（DSH 0.1.5 产物）顶栏：亮色态。下描边 = 1px solid rgba(19,45,83,.26)（真机 probe-out/before.collect.json 实测） */
.simRoot { position: relative; }
.wSkVaW_header { position: relative; display: flex; align-items: center; gap: 8px; box-sizing: border-box;
  height: 76px; padding: 8px 16px; margin: 0; background: transparent;
  border: 1px solid rgba(19, 45, 83, 0.26); border-bottom: 1px solid rgba(19, 45, 83, 0.26);
  border-radius: 0; color: #0f1115; font: 13px system-ui; }
/* 宿主 rail（TurnNavigator）：条本体 = .eGxaPq_mark::before，颜色 = --dsw-alias-border-l4 */
body { --dsw-alias-border-l4: #00000029; --dsw-alias-label-primary: #0f1115; }
.eGxaPq_frame { position: fixed; right: 12px; top: 150px; width: 28px; height: 420px; z-index: 60; }
.eGxaPq_rail { position: relative; width: 100%; height: 100%; }
.eGxaPq_mark { position: relative; height: 24px; }
.eGxaPq_mark::before { content: ""; position: absolute; right: 8px; top: 50%; width: 12px; height: 2px;
  transform: translateY(-50%); border-radius: 1px; background: var(--dsw-alias-border-l4); }
.eGxaPq_markActive::before { background: var(--dsw-alias-label-primary); width: 20px; }
`

function pageHtml(css) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
 html,body{margin:0;padding:0}
 #wall{position:fixed;inset:0;background:url('lines.png');background-size:600px 200px}
 body{padding-top:8px}
${HOST_HEADER_CSS}
/* ── 以下为插件产物（原文注入，不做任何改写） ── */
${css}
</style></head><body>
 <div id="wall"></div>
 <div class="simRoot">
   <header class="wSkVaW_header" data-mpw-hdr-translucent data-mpw-hdr-frost="el">
     <span>标题栏（宿主内容）</span>
   </header>
 </div>
 <div class="eGxaPq_frame"><div class="eGxaPq_rail"><div class="eGxaPq_mark"></div></div></div>
</body></html>`
}

// 注入层由 JS 按真插件同样的内联样式创建（与 ensureHeaderFrost 的 cssText 逐字对应）
function injectLayerScript(variant) {
  const zi = variant === 'before' ? '-1' : '0'
  return `(() => {
    const hdr = document.querySelector('.wSkVaW_header')
    const el = document.createElement('div')
    el.className = 'mpw-hdrFrost'
    el.setAttribute('data-mpw-hdr-frost', '1')
    el.setAttribute('aria-hidden', 'true')
    el.style.cssText = "position:absolute;inset:0;z-index:${zi};pointer-events:none;border-radius:inherit;"
    el.style.backdropFilter = "blur(30px) saturate(140%)"
    el.style.webkitBackdropFilter = "blur(30px) saturate(140%)"
    hdr.insertBefore(el, hdr.firstChild)
    document.documentElement.style.setProperty('--mpw-hdr-frost-bg', 'rgba(255,255,255,0.38)')
    document.body.setAttribute('data-mpw-hdr-frost-el', '1')
    document.body.setAttribute('data-mpw-rail-ink', '1')
    document.documentElement.style.setProperty('--mpw-rail-ink', 'rgba(0,0,0,0.42)')
    document.documentElement.style.setProperty('--mpw-rail-ink-strong', 'rgba(0,0,0,0.86)')
    document.documentElement.style.setProperty('--mpw-rail-halo', 'rgba(255,255,255,0.55)')
  })()`
}

// ── 3. 量测（真浏览器：无头 Firefox）──
const COLLECT = () => {
  const cs = (el, p) => getComputedStyle(el, p || null)
  const alpha = (c) => { const m = /rgba?\(([^)]+)\)/.exec(String(c || '')); if (!m) return String(c || '') === 'transparent' ? 0 : 1; const p = m[1].split(',').map(Number); return p.length > 3 ? p[3] : 1 }
  const hdr = document.querySelector('.wSkVaW_header')
  const fe = hdr.querySelector(':scope > .mpw-hdrFrost')
  const ch = cs(hdr), cf = cs(fe)
  const mark = document.querySelector('.eGxaPq_mark')
  const cb = cs(mark, '::before')
  const kb = Array.from(hdr.children).find((x) => !x.classList.contains('mpw-hdrFrost'))
  return {
    header: { rect: (() => { const r = hdr.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] })(),
      backdropFilter: ch.backdropFilter, backgroundColor: ch.backgroundColor, bgAlpha: alpha(ch.backgroundColor),
      borderBottom: ch.borderBottom, borderBottomColor: ch.borderBottomColor, borderBottomAlpha: alpha(ch.borderBottomColor),
      borderTop: ch.borderTop, position: ch.position, zIndex: ch.zIndex },
    frostEl: { exists: !!fe, zIndex: cf.zIndex, backdropFilter: cf.backdropFilter, webkitBackdropFilter: cf.webkitBackdropFilter,
      backgroundColor: cf.backgroundColor, opacity: cf.opacity, visibility: cf.visibility, display: cf.display,
      position: cf.position, rect: (() => { const r = fe.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] })(),
      parentIsHeader: fe.parentElement === hdr, inline: fe.getAttribute('style'),
      coversHeader: (() => { const a = fe.getBoundingClientRect(), b = hdr.getBoundingClientRect(); return a.left <= b.left + 1 && a.top <= b.top + 1 && a.right >= b.right - 1 && a.bottom >= b.bottom - 1 })() },
    hostKid: kb ? { cls: String(kb.className || '').slice(0, 40), position: cs(kb).position, zIndex: cs(kb).zIndex } : null,
    rail: { markFound: !!mark, beforeBg: cb.backgroundColor, beforeBgAlpha: alpha(cb.backgroundColor), beforeBgRaw: cb.getPropertyValue('background'),
      boxShadow: cb.boxShadow, w: cb.width, h: cb.height, opacity: cb.opacity, display: cb.display,
      tokens: { borderL4_body: cs(document.body).getPropertyValue('--dsw-alias-border-l4').trim(),
        mpwRailInk: cs(document.documentElement).getPropertyValue('--mpw-rail-ink').trim(),
        mpwRailHalo: cs(document.documentElement).getPropertyValue('--mpw-rail-halo').trim() } },
  }
}

async function runOne(variant) {
  const css = buildCssFor(variant)
  const dir = path.join(OUT, 'replica-' + variant)
  fs.mkdirSync(dir, { recursive: true })
  // lines.png（高频条纹壁纸，供人肉截图判读）——**现场生成**，不再拷任何固定 /tmp 历史路径
  let fixture = 'generated'
  try { fs.writeFileSync(path.join(dir, 'lines.png'), stripedPng(64, 32)) } catch (e) { fixture = 'missing(已降级：截图无条纹背景，测量不受影响) ' + String(e && e.message).slice(0, 60) }
  const html = pageHtml(css)
  fs.writeFileSync(path.join(dir, 'replica.html'), html)
  const { firefox } = await import(new URL('../node_modules/playwright/index.mjs', import.meta.url).href)
  const b = await firefox.launch({ headless: true })
  const p = await (await b.newContext({ viewport: { width: 900, height: 620 }, deviceScaleFactor: 1 })).newPage()
  await p.goto('file://' + path.join(dir, 'replica.html'), { waitUntil: 'load' })
  await p.addScriptTag({ content: injectLayerScript(variant) })
  await p.waitForTimeout(400)
  const data = await p.evaluate(COLLECT)
  await p.screenshot({ path: path.join(dir, 'shot.png'), animations: 'disabled' })
  await b.close()
  data.variant = variant
  data.fixture = fixture
  data.cssLen = css.length
  data.cssHasTransparentBorderRule = /border-bottom:\s*1px solid transparent[^;]*;/.test(css.replace(/\/\*[\s\S]*?\*\//g, ''))
  fs.writeFileSync(path.join(dir, 'measure.json'), JSON.stringify(data, null, 1))
  return data
}

// 每个变体跑在**独立子进程**里：_stub 的 __ModuleLoader__ 会在同进程内复用，
// 同一进程二次 loadPlugin 会拿到旧注册表（"插件未向 __ModuleLoader__ 注册"）。
const CHILD = arg('child', '')
const variants = BOTH ? ['before', 'after'] : [arg('variant', 'after')]
const results = {}
for (const v of variants) {
  if (CHILD === '1') { results[v] = await runOne(v); continue }
  const outDir = path.join(OUT, 'replica-' + v)
  fs.mkdirSync(outDir, { recursive: true })
  const stdout = execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--child', '1', '--variant', v, '--out', OUT], { encoding: 'utf8', timeout: 180000 })
  results[v] = JSON.parse(fs.readFileSync(path.join(outDir, 'measure.json'), 'utf8'))
  if (/✗/.test(stdout)) process.stderr.write(stdout.split('\n').filter((l) => /✗/.test(l)).join('\n') + '\n')
}

// ── 4. 报告 ──
const show = (k, a, b) => `${(k + '                                  ').slice(0, 34)} | ${(String(a) + ' '.repeat(46)).slice(0, 46)} | ${String(b)}`
const L = []
if (BOTH) {
  const A = results.before, B = results.after
  L.push('# 「顶栏磨砂 / 顶栏描边 / 时间线条」改前 / 改后 computed 对照（真机复刻：真宿主 CSS + 真插件产物 + 无头 Firefox）')
  L.push('')
  L.push(show('指标', '改前(before)', '改后(after)'))
  L.push('-'.repeat(120))
  L.push(show('顶栏 background-color', A.header.backgroundColor, B.header.backgroundColor))
  L.push(show('顶栏 backdrop-filter', A.header.backdropFilter, B.header.backdropFilter))
  L.push(show('顶栏 border-bottom', A.header.borderBottom, B.header.borderBottom))
  L.push(show('顶栏 border-bottom 的 alpha', A.header.borderBottomAlpha, B.header.borderBottomAlpha))
  L.push(show('磨砂层 z-index', A.frostEl.zIndex, B.frostEl.zIndex))
  L.push(show('磨砂层 backdrop-filter', A.frostEl.backdropFilter, B.frostEl.backdropFilter))
  L.push(show('磨砂层 background-color', A.frostEl.backgroundColor, B.frostEl.backgroundColor))
  L.push(show('磨砂层 covers header', A.frostEl.coversHeader, B.frostEl.coversHeader))
  L.push(show('磨砂层 opacity/visibility', A.frostEl.opacity + '/' + A.frostEl.visibility, B.frostEl.opacity + '/' + B.frostEl.visibility))
  L.push(show('宿主子节点 z-index（内容层）', A.hostKid && A.hostKid.zIndex, B.hostKid && B.hostKid.zIndex))
  L.push(show('rail ::before background', A.rail.beforeBg, B.rail.beforeBg))
  L.push(show('rail ::before alpha', A.rail.beforeBgAlpha, B.rail.beforeBgAlpha))
  L.push(show('rail ::before box-shadow(晕)', A.rail.boxShadow, B.rail.boxShadow))
  L.push(show('rail ::before 尺寸', A.rail.w + '×' + A.rail.h, B.rail.w + '×' + B.rail.h))
  L.push(show('body --dsw-alias-border-l4', A.rail.tokens.borderL4_body, B.rail.tokens.borderL4_body))
  L.push(show('--mpw-rail-halo', A.rail.tokens.mpwRailHalo, B.rail.tokens.mpwRailHalo))
  L.push('')
  L.push('结论：')
  L.push('  ① 磨砂：改前 z-index=-1 且顶栏底色 alpha=' + A.header.bgAlpha + '（>0）⇒ 层被父背景整片盖住；改后 z-index=0 + 宿主内容层 z-index=1。')
  L.push('  ② 描边：改前顶栏 border-bottom alpha=' + A.header.borderBottomAlpha + '（透明=消失）；改后 alpha=' + B.header.borderBottomAlpha + '（宿主原样）。')
  L.push('  ③ 条：改前 ' + A.rail.beforeBg + ' / 无晕；改后 ' + B.rail.beforeBg + ' + 晕 ' + B.rail.boxShadow + '。')
} else {
  const v = variants[0], D = results[v]
  L.push('variant=' + v + '  cssLen=' + D.cssLen + '  产物里还有 transparent 描边声明=' + D.cssHasTransparentBorderRule)
  L.push(JSON.stringify(D, null, 1))
}
const txt = L.join('\n')
fs.writeFileSync(path.join(OUT, 'replica-' + (BOTH ? 'ab' : variants[0]) + '.txt'), txt + '\n')
console.log(txt)

// ── 5. 硬断言（改后必须成立；改前必须不成立 → 证明本探针有分辨力）──
if (BOTH) {
  const A = results.before, B = results.after
  let fail = 0
  const ck = (m, c) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fail++ }
  console.log('\n== 断言（after 必须全真；before 对应项必须为假 → 探针有分辨力）==')
  ck('描边：before 被抹成透明', A.header.borderBottomAlpha === 0)
  ck('描边：after 恢复为宿主原样（alpha>0 且非 0px）', B.header.borderBottomAlpha > 0 && !/^0px/.test(B.header.borderBottom))
  ck('磨砂：before z-index=-1（会被父底盖住）', A.frostEl.zIndex === '-1')
  ck('磨砂：after z-index=0 且在父背景之上', B.frostEl.zIndex === '0')
  ck('磨砂：after 层覆盖整个顶栏框', B.frostEl.coversHeader === true)
  ck('磨砂：after backdrop-filter 含 blur(30px)', /blur\(30px\)/.test(B.frostEl.backdropFilter))
  ck('磨砂：after 宿主内容被抬到 z-index=1（层不盖内容）', B.hostKid && B.hostKid.zIndex === '1')
  ck('条：after background alpha 高于宿主 16% 默认', B.rail.beforeBgAlpha > 0.16)
  ck('条：after 有反色晕（box-shadow 非 none）', B.rail.boxShadow && B.rail.boxShadow !== 'none')
  ck('条：after 几何仍由宿主决定（2px 高）', B.rail.h === '2px')
  console.log(fail ? '\n✗ 复刻对照：' + fail + ' 项失败' : '\n✓ 复刻对照：全部通过')
  process.exit(fail ? 1 : 0)
}
