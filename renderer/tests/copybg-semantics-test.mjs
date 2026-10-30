// copybg-semantics-test.mjs —— C2【机制·copybackground 材质语义】fx=0 的 copybg 层不换入（画自己的内容）
//
// 官方语义（真值源，逐条可指认）：
//   · wer-ref `WPSceneParser.cpp::ShouldUseCopyBackgroundSourceHelper` = `has_effect && !is_compose &&
//     is_solid && copybackground` ⇒ copybackground 的 **helper 语义（composelayer_clearalpha 采主帧缓冲、
//     CLEARALPHA=1 ⇒ alpha=0）只对"有效果链的层"存在** —— 它是"效果源替换"，不是"内容替换"。
//   · 官方资产 `materials/util/composelayer_clearalpha.json`：shader=composelayer、textures[0]=
//     `_rt_FullFrameBuffer`、combos.CLEARALPHA=1；`shaders/composelayer.frag`：**按屏幕坐标采样** +
//     `gl_FragColor.a = 0`。
//   · 无效果链的 copybg 层：走普通 LoadMaterial ⇒ solid 层 = solidlayer 纯色卡（g_Color4 调色，
//     WER-ALIGN G3）；图像/文本层画自己的内容。**没有任何 helper**。
//   · WER-ALIGN G2（docs/reverse/WER-ALIGN.md:122）：solid 层用 composelayer_clearalpha 采样主帧缓冲；
//     效果层材质注入 COPYBG combo（背景走独立槽 `_rt_FullFrameBuffer`，与槽 0 无关）。
// 本仓 P-199 的"换链输入"把这条语义推广错了：对 **fx=0** 的 copybg 层也换 —— 换入的是"该层的合成
//   内容"（不是链输入，因为没有链）⇒ 真包 0923/2887099508 的 25 个 fx=0 copybg 层全部画成"背景拷贝
//   叠加"（首层时 blit 源是未渲染的空帧 ⇒ 恰好近似纯色卡 —— 巧合，不是语义；后层则是"把自己下方
//   的画面再叠一遍" = 无效 overlay）。P-230：换入条件加 `effects.length > 0`；
//   `?copybginput=legacy` 逐位回到 P-199（fx=0 也换）。
//
// 判据（任务书 C2②）：
//   A1 solid+copybg+**fx=0** ⇒ bind=solidcolor（whiteTex×color4 纯色卡）、chainInput=none（不换入）；
//   A2 solid+copybg+**fx>0**（真效果链 passthrough）⇒ chainInput=rt（换入，喂链）；
//   B 探针包 2887099508 交叉验证：#3 Solid（fx=0）由 rtcopy → solidcolor；#40 黑底（fx=1）保持 rt；
//   C 变异自证：去掉 `effects.length > 0` 门 ⇒ A1 必红（变回 rtcopy）。
// 用法：node tests/copybg-semantics-test.mjs（纯 Node + mock GL；探针包在语料时才跑 B 段）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'
import { attributeScene } from './layer-attribution.mjs'

const dec = new TextDecoder()
const lib = await import(pathToFileURL(path.join(ROOT, 'core', 'we-scene-bundle.js')).href)
let pass = 0, fail = 0, skipN = 0
const ok = (name, cond, detail) => { if (cond) { pass++; console.log('  ✓ ' + name) } else { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + String(detail).slice(0, 240) : '')) } }
const sk = (name, why) => { skipN++; console.log('  ~ SKIP ' + name + '（' + why + '）') }

/* makePkg：parsePkg 的镜像布局（名字可带原始字节；这里全 ASCII）。与 nonascii-name-consistency-test 同式。 */
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
    { id: 1, name: 'solid-nofx-copybg', solid: true, color: '0.2 0.4 0.8', size: '400 300', origin: '500 400 0', copybackground: true },
    { id: 2, name: 'solid-fx-copybg', solid: true, color: '0.9 0.9 0.9', size: '400 300', origin: '1200 400 0', copybackground: true,
      effects: [{ file: 'effects/pt/effect.json', passes: [{ material: 'materials/effects/pt.json' }] }] },
  ],
})
const PKG_FILES = {
  'scene.json': null, // 运行时填（要能分别注入变异？不变异 scene，只变异 bundle ⇒ 常量即可）
  'effects/pt/effect.json': { passes: [], fbos: [] },
  'materials/effects/pt.json': { passes: [{ shader: 'effects/pt.frag', textures: [] }] },
}

async function runAttribute(libMod) {
  const sceneObj = SCENE()
  PKG_FILES['scene.json'] = sceneObj
  const entries = Object.entries(PKG_FILES).map(([name, v]) => ({ name, data: JSON.stringify(v) }))
  const pkg = libMod.parsePkg(new Uint8Array(makePkg(entries)))
  const entry = (n) => { const e = libMod.getEntry(pkg, n); return e ? new Uint8Array(e) : null }
  return attributeScene(JSON.parse(JSON.stringify(sceneObj)), { id: 'stub', pkg, readEntry: entry, readParticleDef: () => null }, { time: 1.0, lib: libMod })
}

console.log('== C2 copybackground 语义（合成容器 + 真 parseScene/renderScene + mock GL）==')
const res = await runAttribute(lib)
const byName = Object.fromEntries(res.layers.map((r) => [r.name, r]))
ok('A1 solid+copybg+fx=0 ⇒ bind=solidcolor（纯色卡）且 chainInput=none（P-230 不换入）',
  byName['solid-nofx-copybg'] && byName['solid-nofx-copybg'].bind === 'solidcolor' && byName['solid-nofx-copybg'].chainInput === 'none',
  JSON.stringify(byName['solid-nofx-copybg']))
ok('A2 solid+copybg+fx>0 ⇒ chainInput=rt（换入喂链），bind = 链输出/背景拷贝',
  byName['solid-fx-copybg'] && byName['solid-fx-copybg'].chainInput === 'rt' && ['texture', 'rtcopy'].includes(byName['solid-fx-copybg'].bind),
  JSON.stringify(byName['solid-fx-copybg']))

/* B 段：探针包交叉验证（语料在才跑） */
const PROBE = path.join(WS, 'allwallpaper', '0923', '2887099508', 'scene.pkg')
if (!fs.existsSync(PROBE)) { sk('B 探针包交叉验证', '语料缺 ' + PROBE) } else {
  const { attributePkg } = await import('./layer-attribution.mjs').then(() => ({})).catch(() => ({}))
  // attributePkg 未导出 ⇒ 这里用 attributeScene + 手工装载（与 CLI 同一套 deps）
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(PROBE)))
  const entry = (n) => { const e = lib.getEntry(pkg, n); return e ? new Uint8Array(e) : null }
  const sceneObj = JSON.parse(dec.decode(entry('scene.json')).replace(/^\uFEFF/, ''))
  let propsMap = null, schema = null
  try {
    const pj = entry('project.json') || (fs.existsSync(path.join(path.dirname(PROBE), 'project.json')) ? fs.readFileSync(path.join(path.dirname(PROBE), 'project.json')) : null)
    const pr = pj ? JSON.parse(dec.decode(pj)) : null
    if (pr && pr.general && pr.general.properties) { schema = pr.general.properties; propsMap = lib.propsDefaults(schema) }
  } catch (e) {}
  const res2 = await attributeScene(sceneObj, { id: '2887099508', propsMap, propertiesSchema: schema, pkg,
    readEntry: entry, readParticleDef: (p) => { try { const e = entry(p); return e ? JSON.parse(dec.decode(e)) : null } catch (e2) { return null } } }, { time: 20, campose: 'legacy' })
  const rows = res2.layers
  const solid = rows.find((r) => r.name === 'Solid')
  const heidi = rows.find((r) => r.name === '黑底')
  const rtcopyN = rows.filter((r) => r.bind === 'rtcopy').length
  ok('B1 探针包 #3 Solid（fx=0 copybg）⇒ bind=solidcolor（修前 rtcopy）',
    solid && solid.bind === 'solidcolor', JSON.stringify(solid))
  ok('B2 探针包 #40 黑底（fx=1 copybg）⇒ chainInput=rt（换入语义保留）',
    heidi && heidi.chainInput === 'rt', JSON.stringify(heidi))
  ok('B3 rtcopy 计数 = fx>0 且无自有内容的 copybg 层数（>0，比修前 25 少）',
    rtcopyN > 0 && rtcopyN < 25, 'rtcopy=' + rtcopyN)
}

/* C 段：变异自证 —— 去掉 `effects.length > 0 || copyBgInputLegacy()` 门 ⇒ A1 必红 */
{
  const CORE = path.join(ROOT, 'core')
  const src = fs.readFileSync(path.join(CORE, 'we-scene-bundle.js'), 'utf8')
  const anchor = '(layer.copybackground || opts.copyBackground) && (effects.length > 0 || copyBgInputLegacy())'
  if (!src.includes(anchor)) ok('C0 变异锚点存在', false, 'P-230 门控行没找到')
  else {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-copybg-'))
    for (const f2 of fs.readdirSync(CORE)) { if (/\.(mjs|js)$/.test(f2)) fs.copyFileSync(path.join(CORE, f2), path.join(dir, f2)) }
    fs.writeFileSync(path.join(dir, 'we-scene-bundle.js'), src.replace(anchor, '(layer.copybackground || opts.copyBackground)'))
    const mlib = await import(pathToFileURL(path.join(dir, 'we-scene-bundle.js')).href + '?t=' + Date.now())
    const mres = await runAttribute(mlib)
    const mrow = mres.layers.find((r) => r.name === 'solid-nofx-copybg')
    ok('C 变异自证：去掉 fx 门 ⇒ solid-nofx-copybg 变回 rtcopy（A1 必红）',
      mrow && mrow.bind === 'rtcopy', JSON.stringify(mrow))
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch (e) {}
  }
}

console.log('\n===== copybg-semantics: ' + pass + ' 通过 / ' + fail + ' 失败' + (skipN ? ' / ' + skipN + ' SKIP' : '') + ' =====')
process.exit(fail ? 1 : 0)
