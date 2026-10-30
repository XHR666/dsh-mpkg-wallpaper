// builtin-model-semantics-test.mjs —— C3【机制·内置 models/util/* 层语义】容器判定与"效果载体"分离
//
// 官方语义（真值源）：
//   · wer-ref `ResolveImageEffectSourcePolicy`：compose 层走**效果源路由**（copybg ⇒
//     OwnerNodeAndProxyChildren；否则 ProxyChildrenOnly）——**带效果链的 composelayer 是效果载体，
//     效果链要跑**（真包 0923/2887099508 的 `sound line` = composelayer + Simple_Audio_Bars，
//     此前被"容器一律跳过"整层吞掉 ⇒ C9 的音频条永远出不来）。
//   · wer-ref `WPSceneParser.cpp:4606`：no-effect compose/project = **逻辑 framebuffer helper**
//     （RegisterLogicalImageLayer，不画）；:4614 `skip no effect fullscreen layer` —— 都不产生绘制。
//     此前我们把无 fx 的 projectlayer 画成透明 quad（package-matrix 的 transparentFallback 记账来源，
//     真包 `ldfk`）。
//   · P-231（core 渲染循环）：容器跳层加 `effects.length > 0` 门（`?composfx=legacy` 逐位回退）；
//     无 fx 的 projectlayer/fullscreenlayer 新增"逻辑 helper"跳层（skipReason=logical-helper）。
//   · solid 层不受影响（纯色卡是 G3 的正式绘制；P-230 已修 copybg fx=0 的换入）。
//
// 判据：
//   A 桩件（合成容器 + 真 parseScene/renderScene + mock GL）：composelayer+fx ⇒ 上屏（rtcopy/texture）；
//     composelayer 无 fx ⇒ container 跳；projectlayer/fullscreenlayer 无 fx ⇒ logical-helper 跳；
//     projectlayer+fx ⇒ 上屏（fx 覆盖逻辑 helper）。
//   B 语料扫描（四根）：models/util/* 层清单（kind/fx/是否被 parent 引用/visible）+ 探针包断言
//     （composelayer+fx 且无子层的"效果载体"存在）；读数落 reports/builtin-models-audit.json。
//   C 变异自证：去掉容器门的 fx 分支 ⇒ A 的 carrier 必红（变回 container 跳层）。
// 用法：node tests/builtin-model-semantics-test.mjs（纯 Node + mock GL；语料缺根 SKIP）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'
import { attributeScene } from './layer-attribution.mjs'

const dec = new TextDecoder()
const lib = await import(pathToFileURL(path.join(ROOT, 'core', 'we-scene-bundle.js')).href)
let pass = 0, fail = 0, skipN = 0
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('  ✓ ' + name) } else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + String(detail).slice(0, 260) : '')) } }
const sk = (name, why) => { skipN++; console.log('  ~ SKIP ' + name + '（' + why + '）') }

function makePkg(entries) {
  const magic = Buffer.from('PKGV0024')
  const head = [Buffer.from([magic.length, 0, 0, 0]), magic, Buffer.from([entries.length, 0, 0, 0])]
  let tableSize = 0
  const bufs = entries.map((e) => (Buffer.isBuffer(e.data) ? e.data : Buffer.from(String(e.data), 'utf8')))
  for (const e of entries) tableSize += 4 + Buffer.byteLength(String(e.name), 'utf8') + 8
  const dataStart = 4 + magic.length + 4 + tableSize
  let off = 0
  entries.forEach((e, i) => {
    const nb = Buffer.from(String(e.name), 'utf8')
    const b8 = Buffer.alloc(8); b8.writeUInt32LE(off, 0); b8.writeUInt32LE(bufs[i].length, 4)
    head.push(Buffer.from([nb.length, 0, 0, 0]), nb, b8)
    off += bufs[i].length
  })
  return Buffer.concat([...head, ...bufs])
}

const SCENE = () => ({
  general: { orthogonalprojection: { width: 1920, height: 1080 } },
  objects: [
    { id: 1, name: 'compose-carrier', image: 'models/util/composelayer.json', size: '400 300', origin: '500 400 0', copybackground: true,
      effects: [{ file: 'effects/pt/effect.json', passes: [{ material: 'materials/pt.json' }] }] },
    { id: 2, name: 'compose-logical', image: 'models/util/composelayer.json', size: '100 100', origin: '100 100 0' },
    { id: 3, name: 'project-logical', image: 'models/util/projectlayer.json', size: '1920 1080', origin: '960 540 0' },
    { id: 4, name: 'fullscreen-logical', image: 'models/util/fullscreenlayer.json', size: '1920 1080', origin: '960 540 0' },
    { id: 5, name: 'project-carrier', image: 'models/util/projectlayer.json', size: '800 600', origin: '1400 700 0',
      effects: [{ file: 'effects/pt/effect.json', passes: [{ material: 'materials/pt.json' }] }] },
  ],
})
const PKG_FILES = {
  'effects/pt/effect.json': { passes: [], fbos: [] },
  'materials/pt.json': { passes: [{ shader: 'effects/pt.frag', textures: [] }] },
}

async function runAttribute(libMod) {
  const sceneObj = SCENE()
  const entries = Object.entries(PKG_FILES).map(([name, v]) => ({ name, data: JSON.stringify(v) }))
  entries.push({ name: 'scene.json', data: JSON.stringify(sceneObj) })
  const pkg = libMod.parsePkg(new Uint8Array(makePkg(entries)))
  const entry = (n) => { const e = libMod.getEntry(pkg, n); return e ? new Uint8Array(e) : null }
  return attributeScene(JSON.parse(JSON.stringify(sceneObj)), { id: 'stub', pkg, readEntry: entry, readParticleDef: () => null }, { time: 1.0, lib: libMod })
}

console.log('== C3 内置模型层语义（合成容器 + 真 parseScene/renderScene + mock GL）==')
const res = await runAttribute(lib)
const byName = Object.fromEntries(res.layers.map((r) => [r.name, r]))
ok('A1 compose-carrier（composelayer+fx）⇒ 上屏（bind=rtcopy，效果载体参与渲染）',
  byName['compose-carrier'] && byName['compose-carrier'].bind === 'rtcopy', JSON.stringify(byName['compose-carrier']))
ok('A2 compose-logical（无 fx）⇒ skipReason=container（官方逻辑 helper，不画）',
  byName['compose-logical'] && byName['compose-logical'].skipReason === 'container', JSON.stringify(byName['compose-logical']))
ok('A3 project-logical / fullscreen-logical（无 fx）⇒ skipReason=logical-helper（不画）',
  byName['project-logical'] && byName['project-logical'].skipReason === 'logical-helper' &&
  byName['fullscreen-logical'] && byName['fullscreen-logical'].skipReason === 'logical-helper',
  JSON.stringify([byName['project-logical'], byName['fullscreen-logical']]))
ok('A4 project-carrier（projectlayer+fx）⇒ 上屏（fx 覆盖逻辑 helper）',
  byName['project-carrier'] && !!byName['project-carrier'].bind, JSON.stringify(byName['project-carrier']))

/* B 段：四根语料扫描 */
{
  const ROOTS = ['dd', '0923', '0917', 'wallpaperE'].map((r) => path.join(WS, 'allwallpaper', r)).filter((p) => fs.existsSync(p))
  if (!ROOTS.length) sk('B 语料扫描', '四个语料根都不在')
  else {
    // 目录表 + scene.json 读取（与 nonascii-name-consistency-test 同一套 core-decodeName 语义口径）
    const readIndex = (file) => {
      const fd = fs.openSync(file, 'r')
      try {
        const head = Buffer.alloc(4 << 20)
        const n = fs.readSync(fd, head, 0, head.length, 0)
        const b = head.subarray(0, n)
        const mlen = b.readInt32LE(0)
        let p2 = 4 + mlen
        const count = b.readInt32LE(p2); p2 += 4
        const entries = []
        for (let i = 0; i < count; i++) {
          const nl = b.readInt32LE(p2); p2 += 4
          const name = b.toString('utf8', p2, p2 + nl); p2 += nl
          const off = b.readInt32LE(p2); p2 += 4
          const size = b.readInt32LE(p2); p2 += 4
          entries.push({ name, off, size })
        }
        return { entries, dataStart: p2 }
      } finally { fs.closeSync(fd) }
    }
    const readSlice = (file, off, len) => {
      const fd = fs.openSync(file, 'r')
      try { const buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, off); return buf } finally { fs.closeSync(fd) }
    }
    const files = []
    const walk = (root) => { let names = []; try { names = fs.readdirSync(root) } catch (e) { return } for (const n of names) { const p = path.join(root, n); let st = null; try { st = fs.statSync(p) } catch (e) { continue } if (st.isDirectory()) walk(p); else if (/\.(mpkg|pkg)$/i.test(n)) files.push(p) } }
    ROOTS.forEach(walk)
    let containers = 0, rows = []
    for (const f of files) {
      let idx = null
      try { idx = readIndex(f) } catch (e) { continue }
      containers++
      const se = idx.entries.find((x) => /(^|\/)scene\.json$/i.test(x.name))
      if (!se) continue
      let sceneObj = null
      try { sceneObj = JSON.parse(dec.decode(readSlice(f, idx.dataStart + se.off, se.size)).replace(/^\uFEFF/, '')) } catch (e) { continue }
      const objs = sceneObj.objects || []
      for (const [i, o] of objs.entries()) {
        const img = String(o.image || '')
        if (!img.startsWith('models/util/')) continue
        rows.push({
          pkg: path.basename(path.dirname(f)), idx: i, name: String(o.name || o.id), image: img,
          kind: img.includes('composelayer') ? 'composelayer' : img.includes('projectlayer') ? 'projectlayer'
            : img.includes('fullscreenlayer') ? 'fullscreenlayer' : img.includes('solidlayer') ? 'solidlayer' : 'other',
          fx: (o.effects || []).length, parentReferenced: objs.some((x) => x.parent === o.id),
          visible: o.visible !== false, copybg: o.copybackground === true,
        })
      }
    }
    ok('B1 四根枚举与解析（容器 ' + containers + ' 个）', containers > 0)
    const kinds = rows.reduce((a, r) => { a[r.kind] = (a[r.kind] || 0) + 1; return a }, {})
    console.log('  ℹ models/util/* 层：' + rows.length + ' 个 / 分类 ' + JSON.stringify(kinds))
    ok('B2 models/util/* 层清单非空', rows.length > 0)
    const composeFxNoChild = rows.filter((r) => r.kind === 'composelayer' && r.fx > 0 && !r.parentReferenced)
    console.log('  ℹ composelayer+fx 且无子层（P-231 受益面）：' + composeFxNoChild.length + ' 个'
      + (composeFxNoChild.length ? '，样例 ' + composeFxNoChild.slice(0, 3).map((r) => r.pkg + ':' + r.name).join(' | ') : ''))
    try { fs.mkdirSync(path.join(ROOT, 'reports'), { recursive: true })
      fs.writeFileSync(path.join(ROOT, 'reports', 'builtin-models-audit.json'), JSON.stringify(
        { generatedAt: new Date().toISOString(), containers, total: rows.length, kinds, composeFxNoChild: composeFxNoChild.length, rows }, null, 1)) } catch (e) {}
    const probeRows = rows.filter((r) => r.pkg === '2887099508')
    ok('B3 探针包 models/util/* 层在清单里（17 个 = 任务书 17）', probeRows.length === 17, 'count=' + probeRows.length)
    ok('B4 探针包有"composelayer+fx 无子层"效果载体（sound line）',
      probeRows.some((r) => r.kind === 'composelayer' && r.fx > 0 && !r.parentReferenced), JSON.stringify(probeRows.filter((r) => r.kind === 'composelayer')))
    const realContainerWithFx = rows.filter((r) => r.parentReferenced && r.fx > 0)
    console.log('  ℹ 真容器（被 parent 引用）且带 fx：' + realContainerWithFx.length + ' 个（语料边界，P-231 未验证边界见 PATCHES）')
  }
}

/* C 段：变异自证 —— 容器门去掉 fx 分支 ⇒ compose-carrier 必红 */
{
  const CORE = path.join(ROOT, 'core')
  const src = fs.readFileSync(path.join(CORE, 'we-scene-bundle.js'), 'utf8')
  const anchor = "(layer.isContainer && (!(layer.effects && layer.effects.length) || CONTAINERFX_MODE === 'legacy'))"
  if (!src.includes(anchor)) ok('C0 变异锚点存在', false, 'P-231 容器门没找到')
  else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-c3-'))
    for (const f2 of fs.readdirSync(CORE)) { if (/\.(mjs|js)$/.test(f2)) fs.copyFileSync(path.join(CORE, f2), path.join(dir, f2)) }
    fs.writeFileSync(path.join(dir, 'we-scene-bundle.js'), src.replace(anchor, 'layer.isContainer'))
    const mlib = await import(pathToFileURL(path.join(dir, 'we-scene-bundle.js')).href + '?t=' + Date.now())
    const mres = await runAttribute(mlib)
    const mrow = mres.layers.find((r) => r.name === 'compose-carrier')
    ok('C 变异自证：容器门去掉 fx 分支 ⇒ compose-carrier 变回 container 跳层（A1 必红）',
      mrow && mrow.skipReason === 'container', JSON.stringify(mrow))
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch (e) {}
  }
}

console.log('\n===== builtin-model-semantics: ' + pass + ' 通过 / ' + fail + ' 失败' + (skipN ? ' / ' + skipN + ' SKIP' : '') + ' =====')
process.exit(fail ? 1 : 0)
