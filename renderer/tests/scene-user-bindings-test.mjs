// scene-user-bindings-test.mjs —— C7【机制·后处理门控】场景级 `{user:…}` 绑定落点（general.bloom）
//
// 真值依据：真包 0923/2887099508 的 `general.bloom = {user:"highlightneedpostprocessinginset", value:true}`
// （属性表里同名 bool）——官方语义 = 用户属性直接控制后处理开关。此前 applyUserProperties 只走层绑定
// （l.__bindRaw）⇒ 场景级绑定没有落点，面板/插件改属性 bloom 纹丝不动。
// 实现（P-234）：applyUserProperties 尾部场景级 pass——value 跟随属性值（布尔直取 / {value} 包装），
//   保留 user 引用；gated（?props= 钉死）不写；非对象形态照旧。
// 判据：
//   A1 属性 false ⇒ bloom.value=false；A2 属性 true ⇒ true；A3 属性表缺该名 ⇒ 原值保留；
//   A4 gated ⇒ 不写；A5 bloom 非对象（bloom:true）⇒ 原样；
//   B 语料扫描：四根 scene.json 的 general 层级 {user:…} 绑定清单（bloom/其余字段），落
//     reports/scene-user-bindings.json；
//   C 变异自证：/tmp 副本摘掉场景级 pass ⇒ A1 必红。
// 用法：node tests/scene-user-bindings-test.mjs（纯 Node，无浏览器；~10s）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'

const dec = new TextDecoder()
let pass = 0, fail = 0, skipN = 0
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('  ✓ ' + name) } else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + String(detail).slice(0, 240) : '')) } }
const sk = (name, why) => { skipN++; console.log('  ~ SKIP ' + name + '（' + why + '）') }
const lib = await import(pathToFileURL(path.join(ROOT, 'core', 'we-scene-bundle.js')).href)

function makeScene(bloom) {
  const scene = lib.parseScene({ general: { orthogonalprojection: { width: 1920, height: 1080 }, bloom }, objects: [] }, null, {})
  const schema = { pp: { type: 'bool', value: true } }
  lib.applyRenderConfig(scene, { sceneId: 't', properties: null, refrender: null, hideUI: false, hideParticles: false, clearBgFx: true, log: () => {} })
  return { scene, schema }
}
const apply = (scene, schema, props, gated) => lib.applyUserProperties(scene, props, { schema, gated: gated || new Set(lib.gatedOffNames ? lib.gatedOffNames(schema, props) : []) })

console.log('== C7 场景级 {user:…} 绑定（general.bloom）==')
{
  const { scene, schema } = makeScene({ user: 'pp', value: true })
  apply(scene, schema, { pp: false })
  ok('A1 属性 false ⇒ bloom.value=false（user 引用保留）',
    scene.general.bloom.value === false && scene.general.bloom.user === 'pp', JSON.stringify(scene.general.bloom))
}
{
  const { scene, schema } = makeScene({ user: 'pp', value: true })
  apply(scene, schema, { pp: true })
  ok('A2 属性 true ⇒ bloom.value=true（缺省同值，幂等）', scene.general.bloom.value === true, JSON.stringify(scene.general.bloom))
}
{
  const { scene, schema } = makeScene({ user: 'pp', value: true })
  apply(scene, schema, {})  // 属性表缺该名 ⇒ 原值
  ok('A3 属性表缺该名 ⇒ 原值保留（value=true）', scene.general.bloom.value === true, JSON.stringify(scene.general.bloom))
}
{
  const { scene, schema } = makeScene({ user: 'pp', value: true })
  apply(scene, schema, { pp: false }, new Set(['pp']))  // gated（URL 钉死）
  ok('A4 gated（?props= 钉死）⇒ 不写', scene.general.bloom.value === true, JSON.stringify(scene.general.bloom))
}
{
  const scene = lib.parseScene({ general: { orthogonalprojection: { width: 1920, height: 1080 }, bloom: true }, objects: [] }, null, {})
  lib.applyRenderConfig(scene, { sceneId: 't', properties: null, refrender: null, hideUI: false, hideParticles: false, clearBgFx: true, log: () => {} })
  apply(scene, { pp: { type: 'bool', value: false } }, { pp: false })
  ok('A5 bloom 非对象（true）⇒ 原样（数字/布尔形态由 buildCamera 照旧消费）', scene.general.bloom === true, JSON.stringify(scene.general.bloom))
}

/* B 段：四根语料扫描（general 层级 {user:…} 绑定清单） */
{
  const ROOTS = ['dd', '0923', '0917', 'wallpaperE', '1004'].map((r) => path.join(WS, 'allwallpaper', r)).filter((p) => fs.existsSync(p))
  if (!ROOTS.length) sk('B 语料扫描', '语料根都不在')
  else {
    const found = []
    const walk = (root, acc = []) => { let names = []; try { names = fs.readdirSync(root) } catch (e) { return acc } for (const n of names) { const p = path.join(root, n); let st = null; try { st = fs.statSync(p) } catch (e) { continue } if (st.isDirectory()) walk(p, acc); else if (/\.(mpkg|pkg)$/i.test(n)) acc.push(p) } return acc }
    const files = ROOTS.flatMap((r) => walk(r))
    for (const f of files) {
      try {
        if (fs.statSync(f).size > 250 * 1048576) continue
        const raw = fs.readFileSync(f)
        const s = dec.decode(raw)
        // general 块的粗定位：取 scene.json，正则提取 general 对象内的 "key" : { … "user" … } 形态
        const m = /"general"\s*:\s*\{/.exec(s)
        if (!m) continue
        let depth = 0, i = m.index + m[0].length - 1, genEnd = -1
        for (; i < s.length; i++) { if (s[i] === '{') depth++; else if (s[i] === '}') { depth--; if (depth === 0) { genEnd = i; break } } }
        if (genEnd < 0) continue
        const gen = s.slice(m.index + m[0].length - 1, genEnd + 1)
        if (!gen.includes('"user"')) continue
        const re = /"(\w+)"\s*:\s*\{[^{}]*?"user"\s*:\s*("(?:[^"\\]|\\.)*"|\{[^{}]*\})/g
        let mm
        while ((mm = re.exec(gen))) {
          found.push({ pkg: path.basename(path.dirname(f)), field: mm[1], user: mm[2].slice(0, 60) })
        }
      } catch (e) { continue }
    }
    const bloomPkgs = found.filter((x) => x.field === 'bloom')
    console.log('  ℹ general 层级 {user:…} 绑定：' + found.length + ' 处（bloom ' + bloomPkgs.length + ' 处）'
      + (found.length ? '，样例 ' + JSON.stringify(found.slice(0, 3)) : ''))
    try { fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true })
      fs.writeFileSync(path.join(ROOT, 'reports', 'scene-user-bindings.json'), JSON.stringify(
        { generatedAt: new Date().toISOString(), total: found.length, bloom: bloomPkgs.length, rows: found }, null, 1)) } catch (e) {}
    ok('B1 清单落 reports/scene-user-bindings.json（语料根在）', fs.existsSync(path.join(ROOT, 'reports', 'scene-user-bindings.json')))
  }
}

/* C 段：变异自证 */
{
  const src = fs.readFileSync(path.join(ROOT, 'core', 'we-scene-bundle.js'), 'utf8')
  const anchor = "  {\n    const g = scene && scene.general\n    if (g && g.bloom && typeof g.bloom === 'object' && !Array.isArray(g.bloom)) {"
  if (!src.includes(anchor)) ok('C0 变异锚点存在', false, '场景级 pass 没找到')
  else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-c7-'))
    for (const f2 of fs.readdirSync(path.join(ROOT, 'core'))) { if (/\.(mjs|js)$/.test(f2)) fs.copyFileSync(path.join(ROOT, 'core', f2), path.join(dir, f2)) }
    fs.writeFileSync(path.join(dir, 'we-scene-bundle.js'), src.replace(anchor, '  {\n    const g = null && scene && scene.general\n    if (g && g.bloom && typeof g.bloom === \'object\' && !Array.isArray(g.bloom)) {'))
    const mlib = await import(pathToFileURL(path.join(dir, 'we-scene-bundle.js')).href + '?t=' + Date.now())
    const scene = mlib.parseScene({ general: { orthogonalprojection: { width: 1920, height: 1080 }, bloom: { user: 'pp', value: true } }, objects: [] }, null, {})
    mlib.applyRenderConfig(scene, { sceneId: 't', properties: null, refrender: null, hideUI: false, hideParticles: false, clearBgFx: true, log: () => {} })
    mlib.applyUserProperties(scene, { pp: false }, { schema: { pp: { type: 'bool', value: true } }, gated: new Set() })
    ok('C 变异自证：摘掉场景级 pass ⇒ bloom.value 保持 true（A1 必红）', scene.general.bloom.value === true, JSON.stringify(scene.general.bloom))
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch (e) {}
  }
}

/* 真机腿（GL 前置；无 GL SKIP）：探针包属性翻转 ⇒ __mpwBloomInfo 开关态跟随（P-234 端到端） */
{
  const { launchGLBrowser, glCapability, closeQuiet, findPlaywright } = await import(path.join(ROOT, 'tests', '_gl-browser.mjs'))
  const require_ = (await import('node:module')).createRequire(path.join(ROOT, 'package.json'))
  const pw = require_(findPlaywright()); const firefox = (pw.default && pw.default.firefox) || pw.firefox
  const { browser } = await launchGLBrowser(firefox)
  const gl = await glCapability(browser)
  if (!gl.webgl2) { await closeQuiet(browser); sk('真机腿', '无 GL（原样读数 webgl2=false）') } else {
    try {
      const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
      const pkgPath = path.join(WS, 'allwallpaper', '0923', '2887099508', 'scene.pkg')
      const url = `http://127.0.0.1:8902/webloader/?type=scene&id=2887099508&pkgpath=${encodeURIComponent(pkgPath)}&res=dpr&shell=0&campose=legacy`
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.waitForFunction('!!window.__mpwFirstFrame', null, { timeout: 60000 })
      await page.waitForTimeout(3000)
      // 用 §9.6 的正确做法改用户属性：__mpwUserProps + __mpwPropsApplyHost（探针唯一正确做法）
      const after = await page.evaluate(async () => {
        const before = window.__mpwBloomInfo || null
        window.__mpwUserProps['highlightneedpostprocessinginset'] = false
        window.__mpwPropsApplyHost('probe', 'highlightneedpostprocessinginset')
        await new Promise((res) => setTimeout(res, 1500))
        return { before, after: window.__mpwBloomInfo || null, prop: window.__mpwUserProps['highlightneedpostprocessinginset'] }
      })
      ok('B2 真机：用户属性翻 false ⇒ bloom 台账变关闭态（offBecause=value-false）',
        after.prop === false && after.after && after.after.enabled === 0 && after.after.offBecause === 'value-false',
        JSON.stringify({ prop: after.prop, before: after.before, after: after.after }))
    } catch (e) { sk('真机腿', String(e.message).slice(0, 80)) }
    await closeQuiet(browser)
  }
}

console.log('\n===== scene-user-bindings: ' + pass + ' 通过 / ' + fail + ' 失败' + (skipN ? ' / ' + skipN + ' SKIP' : '') + ' =====')
process.exit(fail ? 1 : 0)
