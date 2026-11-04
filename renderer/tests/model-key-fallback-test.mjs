// model-key-fallback-test.mjs —— P-205 缺口 2：层级 `model` 键（老式模型层）
//
// 病（离线实测，报告 `docs/reverse/RENDERER-UNSUPPORTED-EFFECTS.md` §4#2/§5#7）：`parseScene` 只读
// `o.image` ⇒ 3 包 / 105 层（`0917/3509243654`… ）用 `model` 声明的模型层**整层消失**，而且其中
// **92 层带 `solid:true`** 被 `solid` 判定吞成"纯色层" —— 诊断口径把"丢模型"说成了"纯色"。
// 引用的 84 个 `.mdl` **全在包内**（8/8、69/69、7/7），缺的只是路径。
//
// 本文件四层判据（离线：真包 + 生产解析器原文；**不起浏览器、不解纹理**）：
//   S1 结构：`parseScene` 同时读 `image`/`model`（`o.image` 优先）；`solid`/`isContainer` 改看**有效
//      模型来源**；`.mdl` 的 material 路径由 `readMdlMaterialPath`（偏移 21 口径）读、经
//      `registerModelSource` 登记，`resolveBuiltin` 命中即用（**宿主不会把二进制 MDL 喂给 parseWeJson**）；
//      来源不可用时如实标 `__modelDropped` 并进 `scene.__srcStats`。
//   S2 行为（3 个真包 + 真磁盘包内入口）：
//     ① 有读取器：8/73/24 个模型层全部解析出模型来源（`image` = `model` 路径、`solid` = false、
//        `resolveBuiltin` 命中、material **真的在包内**）——旧读数是 0/0/0。
//     ② 无读取器：`image` **不写**（宿主链照旧跳过、不抛）、`__modelDropped='no-entry-reader'`、
//        `scene.__srcStats.modelDropped` = 层数；**这一档就是改动前的行为**，用来做口径对照。
//     ③ 口径分离（本缺口的核心读数）：`solidNonModel`（真·纯色/占位层）**两档完全相同**（25/473/39；P-213 B1 起 light 层单列），
//        而模型层单独记在 `model` 档；`modelKeyedSolidDropped` = 92 层（= 8+66+18，即"旧口径下被
//        当纯色层"的那些），`solidNonModel + modelKeyedSolidDropped === solid`。
//     ④ 崩溃守卫：所有 model 层写进 `image` 的路径**必须**能被 `resolveBuiltin` 命中（或本身是 `.json`）
//        —— 否则宿主 demo.html 的 `parseWeJson(rd(mdlBytes))` 会 throw，`Promise.all(jobs)` 会让整页
//        `❌ 启动失败`（这条判据就是为它立的）。
//   S3 变异自证：隔离 `core/` 副本真改真跑，断言"期望红集"**精确相等**（真树不动）。
//
// 真机读数（`node tests/package-matrix.mjs --pkg <包> --json`，mock-GL 审计；本轮 A/B 实测）：
//   包              image(前→后)  drawnLayers(前→后)  transparentFallback  whiteFallback  layerErrors
//   0917/3509243656   59 → 67        36 → 35（见下）        12 → 12            0 → 0          0 → 0
//   0923/3662790108  345 → 418      449 → 451              12 → 12            0 → 0          0 → 0
//   0923/3589454154   56 → 80        43 → 46               12 → 12            0 → 0          0 → 0
//   3509243656 的 -1 是唯一解释项（`tests/package-matrix.mjs` 的 EXPLAINED_BASE_DROPS 有逐层依据）：
//   唯一下降的 `导航盘 赤道`(id436) 旧口径下按"size=0 → 整屏回退"画的是**全透明** quad（0 像素差）。
//   用 `--audit` 可重新测这张表（读 3 个大包 ≈ 1–3 分钟；默认跑不测）。
//
// 用法:
//   node tests/model-key-fallback-test.mjs                 # 全跑（快）
//   node tests/model-key-fallback-test.mjs --no-mutations   # 只跑 S1/S2（变异子进程用）
//   node tests/model-key-fallback-test.mjs --audit          # 追加真机审计读数复核
//   MPW_CORE_FILE=<另一个 we-scene-bundle.js> node ...       # 指向隔离副本（变异子进程用）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'
import { openPkgLazy, readSceneJsonText } from './_pkg-index.mjs'

const FILE = fileURLToPath(import.meta.url)
const CORE_FILE = process.env.MPW_CORE_FILE || path.join(ROOT, 'core', 'we-scene-bundle.js')
const CORE_SRC = fs.readFileSync(CORE_FILE, 'utf8')
const lib = await import(pathToFileURL(CORE_FILE).href)

const MPW_WS = process.env.MPW_ROOT || WS
const CORPUS = path.join(MPW_WS, 'allwallpaper')
const DEC = new TextDecoder()

let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}
const exists = (p) => { try { return fs.existsSync(p) } catch { return false } }
const srcLine = (needle) => { const i = CORE_SRC.indexOf(needle); return i < 0 ? -1 : CORE_SRC.slice(0, i).split('\n').length }

console.log('== P-205 缺口 2：层级 `model` 键（老式模型层）==')
console.log('   core=' + path.relative(ROOT, CORE_FILE))

/* ───────────────── S1：结构（源码序） ───────────────── */
check('S1-1 `parseScene` 同时读 image/model（`o.image` 优先；唯一实现处 = `__imageKey`）',
  srcLine("const __imageKey = (typeof o.image === 'string') ? 'image' : ((typeof o.model === 'string') ? 'model' : null)") > 0,
  'core:' + srcLine("const __imageKey = (typeof o.image === 'string')"))
check('S1-2 `solid` / `isContainer` 改看**有效模型来源** `__solidImg`（不再只看 `typeof o.image`）',
  CORE_SRC.includes('(__solidImg !== null && __solidImg.indexOf(\'models/util/solidlayer\') === 0') &&
  CORE_SRC.includes('isContainer: __solidImg !== null && __solidImg.indexOf(\'models/util/composelayer\') === 0'))
check('S1-3 `.mdl` material 路径读取器在（偏移 21 口径，且只认 `materials/*.json`）',
  srcLine('export function readMdlMaterialPath(buf)') > 0 &&
  CORE_SRC.includes('const MDL_MATERIAL_PATH_OFFSET = 21') && CORE_SRC.includes('/^materials\\/.+\\.json$/i.test(s)'))
check('S1-4 `resolveBuiltin` 查"解析期登记的二进制模型"（宿主因此**不会**把 MDL 喂给 parseWeJson）',
  CORE_SRC.includes('const __pm = __parsedModels.get(path)') && CORE_SRC.includes("return { kind: 'model', value: __pm }"))
check('S1-5 登记入口带成本台账（`modelSourceLedger` 的 `readBytes`）—— 整条读的代价必须看得见',
  CORE_SRC.includes('export function modelSourceLedger()') && CORE_SRC.includes('__modelLedger.readBytes += (bytes.length || 0)'))
check('S1-6 来源不可用时**如实标注**（`__modelDropped` + `__srcStats.modelDropReasons`），不是静默丢',
  CORE_SRC.includes("__modelDropped = (opts && opts.attachCtx && typeof opts.attachCtx.readEntry === 'function')") &&
  CORE_SRC.includes('__srcStats.modelDropReasons[__modelDropped]'))
check('S1-7 `scene.__srcStats` 落进解析结果（模型层单列，solid 再分真纯色/模型回落两档）',
  CORE_SRC.includes('__srcStats,') && CORE_SRC.includes('__srcStats.solidNonModel++') && CORE_SRC.includes('__srcStats.modelKeyedSolidDropped++'))
check('S1-8 变异锚点唯一（`o.model` 判定 / `__pm` 查表 / `__solidImg` 定义 三处各恰好一次）',
  (CORE_SRC.match(/const __imageKey = \(typeof o\.image === 'string'\)/g) || []).length === 1 &&
  (CORE_SRC.match(/const __pm = __parsedModels\.get\(path\)/g) || []).length === 1 &&
  (CORE_SRC.match(/const __solidImg = __imgUsable \? __img :/g) || []).length === 1)

/* ───────────────── S2：行为（3 个真包） ───────────────── */
const PKGS = [
  { rel: '0917/3509243656/scene.pkg', model: 8, distinctMdl: 8, matInPkg: 8, texReal: 6, solidNonModel: 25, keyedSolid: 8, audit: { imageBefore: 59, imageAfter: 67, drawnBefore: 36, drawnAfter: 35 } },
  { rel: '0923/3662790108/scene.pkg', model: 73, distinctMdl: 69, matInPkg: 72, texReal: 50, solidNonModel: 473, keyedSolid: 66,  /* ①(P-213 B1) 474→473：1 个 light 层（id 3692）移出 solid 口径 */ audit: { imageBefore: 345, imageAfter: 418, drawnBefore: 449, drawnAfter: 451 } },
  { rel: '0923/3589454154/scene.pkg', model: 24, distinctMdl: 7, matInPkg: 24, texReal: 22, solidNonModel: 39, keyedSolid: 18,  /* ①(P-213 B1) 41→39：2 个 light 层移出 solid 口径（见下 S2-B 注释） */ audit: { imageBefore: 56, imageAfter: 80, drawnBefore: 43, drawnAfter: 46 } },
]
/** 读一个真包：`{ pkg, scene, models, resolved }`；`reader=null` ⇒ 不传 attachCtx.readEntry。 */
function readPkg(rel, { reader = true } = {}) {
  const f = path.join(CORPUS, rel)
  const pkg = openPkgLazy(f)
  const sj = lib.parseWeJson(readSceneJsonText(f))
  const opts = reader ? { attachCtx: { readEntry: (n) => lib.getEntry(pkg, n), time: 0 } } : {}
  const scene = lib.parseScene(sj, null, opts)
  const models = scene.layers.filter((l) => l.__imageKey === 'model')
  const resolved = models.map((l) => {
    const b = typeof l.image === 'string' ? lib.resolveBuiltin(l.image) : null
    let matInPkg = false, texName = null, texInPkg = false
    if (b && b.kind === 'model' && b.value && b.value.material) {
      matInPkg = !!lib.getEntry(pkg, b.value.material)
      if (matInPkg) {
        let mj = null
        try { mj = lib.parseWeJson(DEC.decode(lib.getEntry(pkg, b.value.material))) } catch (e) { mj = null }
        texName = (mj && mj.passes && mj.passes[0] && mj.passes[0].textures && mj.passes[0].textures[0]) || null
        texInPkg = typeof texName === 'string' && !texName.startsWith('_rt_') && !!lib.getEntry(pkg, 'materials/' + texName + '.tex')
      }
    }
    return { layer: l, builtin: b, matInPkg, texName, texInPkg }
  })
  return { f, pkg, scene, models, resolved }
}

{
  let ok = true
  const rows = []
  for (const spec of PKGS) {
    const f = path.join(CORPUS, spec.rel)
    if (!exists(f)) { ok = false; rows.push(spec.rel + ': 语料缺失'); continue }
    lib.resetModelSources()
    const { scene, models, resolved } = readPkg(spec.rel)
    const st = scene.__srcStats
    const imageSet = models.filter((l) => typeof l.image === 'string' && l.image === l.__imageSrc).length
    const stillSolid = models.filter((l) => l.solid).length
    const builtinHit = resolved.filter((r) => r.builtin && r.builtin.kind === 'model').length
    const matInPkg = resolved.filter((r) => r.matInPkg).length
    const texReal = resolved.filter((r) => r.texInPkg).length
    const led = lib.modelSourceLedger()
    rows.push(path.basename(path.dirname(f)) + ' model=' + models.length + ' image=' + imageSet + ' solid=' + stillSolid
      + ' builtin=' + builtinHit + ' matInPkg=' + matInPkg + ' texReal=' + texReal + ' 登记=' + led.registered + '/' + led.read + '(' + Math.round(led.readBytes / 1048576) + 'MB)')
    if (models.length !== spec.model || imageSet !== spec.model || stillSolid !== 0) ok = false
    if (builtinHit !== spec.model || matInPkg !== spec.matInPkg || texReal !== spec.texReal) ok = false
    if (led.registered !== spec.distinctMdl || led.miss !== 0) ok = false            // 每个**不同**路径只读一次
    if (st.model !== spec.model || st.modelDrawn !== spec.model || st.modelDropped !== 0) ok = false
  }
  check('S2-A 有读取器：8/73/24 个模型层全部拿到模型来源（image 写出·solid=false·resolveBuiltin 命中·material 在包内）',
    ok, rows.join('  |  '))
}
{
  // 口径分离：`solidNonModel`（真·纯色/占位层）在"无读取器"档与"有读取器"档必须**逐位相同**，
  // 模型层只出现在 model* 档；`modelKeyedSolidDropped` = 旧口径下被当纯色层的那些（92 层）。
  let ok = true, keyed = 0
  const rows = []
  for (const spec of PKGS) {
    const f = path.join(CORPUS, spec.rel)
    if (!exists(f)) { ok = false; continue }
    lib.resetModelSources()
    const withReader = readPkg(spec.rel).scene.__srcStats
    lib.resetModelSources()
    const noReader = readPkg(spec.rel, { reader: false }).scene.__srcStats
    rows.push(path.basename(path.dirname(f)) + ' solidNonModel=' + withReader.solidNonModel + '/' + noReader.solidNonModel
      + ' model=' + withReader.model + ' 旧口径回落=' + noReader.modelKeyedSolidDropped)
    if (withReader.solidNonModel !== spec.solidNonModel || noReader.solidNonModel !== spec.solidNonModel) ok = false
    if (noReader.modelKeyedSolidDropped !== spec.keyedSolid) ok = false
    if (noReader.solid !== noReader.solidNonModel + noReader.modelKeyedSolidDropped) ok = false
    if (withReader.modelKeyedSolidDropped !== 0 || withReader.solid !== spec.solidNonModel) ok = false
    keyed += spec.keyedSolid
  }
  /* ①(P-213 B1 2026-09-29) 判据更新（绝对值随口径走，意图不变）：3589454154 的 solidNonModel 41→39 ——
   B1 把 2 个 light 层（id 433/259，"light":"lpoint"/"ldirectional"）从 solid 口径显式排除（光源层不是
   纯色层，srcStats 新开 light 档）。**意图哪里没变**：本条钉的是"口径分离"——① solidNonModel 在
   有读取器/无读取器两档下逐位相同、② 模型层单列 model* 档、③ solid = solidNonModel + modelKeyedSolidDropped。
   这三条结构约束全部保留且仍然卡死；改的只是 light 层所在的那个绝对数。 */
check('S2-B 口径分离：真·纯色层数（solidNonModel）两档完全相同（25/473/39；P-213 B1 起 light 层单列 light 档（3589454154 ×2 + 3662790108 ×1）），模型层单列；旧口径下被当纯色层的 92 层记在 modelKeyedSolidDropped',
    ok && keyed === 92, rows.join('  |  '))
}
{
  // 崩溃守卫 + 无读取器档：`image` 不写、如实标原因；写了 image 的必须能被 resolveBuiltin 命中
  let ok = true
  const rows = []
  for (const spec of PKGS) {
    const f = path.join(CORPUS, spec.rel)
    if (!exists(f)) { ok = false; continue }
    lib.resetModelSources()
    const { models, resolved } = readPkg(spec.rel, { reader: false })
    const imgSet = models.filter((l) => typeof l.image === 'string').length
    const dropped = models.filter((l) => l.__modelDropped === 'no-entry-reader').length
    rows.push(path.basename(path.dirname(f)) + ' image=' + imgSet + ' dropped=' + dropped)
    if (imgSet !== 0 || dropped !== spec.model) ok = false
    // 有读取器档：所有写出的 image 都必须是"宿主能安全消费"的（resolveBuiltin 命中；否则宿主 parseWeJson 会 throw）
    lib.resetModelSources()
    const r2 = readPkg(spec.rel)
    const unsafe = r2.models.filter((l) => typeof l.image === 'string' && !(l.image && /\.json$/i.test(l.image)) &&
      !(lib.resolveBuiltin(l.image) && lib.resolveBuiltin(l.image).kind === 'model'))
    const hits = r2.resolved.filter((x) => x.builtin && x.builtin.kind === 'model' && x.builtin.value && x.builtin.value.__mdl).length
    rows[rows.length - 1] += ' 安全命中=' + hits
    if (unsafe.length !== 0 || hits !== spec.model) ok = false
  }
  check('S2-C 崩溃守卫 + 无读取器档：不写 image（旧行为）· 写了 image 的 105 层全部被 resolveBuiltin 命中（宿主不会 parseWeJson 二进制 MDL）',
    ok, rows.join('  |  '))
}
{
  // 纯函数：MDL material 路径读取器（真包字节 + 负样本）
  const f = path.join(CORPUS, '0923/3589454154/scene.pkg')
  if (!exists(f)) check('S2-D readMdlMaterialPath 真包读数', false, '语料缺失')
  else {
    const pkg = openPkgLazy(f)
    lib.resetModelSources()
    const { models } = readPkg('0923/3589454154/scene.pkg')
    const paths = [...new Set(models.map((l) => l.__imageSrc))]
    const got = paths.map((p) => lib.readMdlMaterialPath(lib.getEntry(pkg, p)))
    const neg = [lib.readMdlMaterialPath(null), lib.readMdlMaterialPath(new Uint8Array(8)),
      lib.readMdlMaterialPath(Buffer.from('NOTMDL00000000000000000000')), lib.readMdlMaterialPath(Buffer.from('MDLV0023' + '\0'.repeat(200)))]
    check('S2-D `readMdlMaterialPath` 在 7/7 个真包 MDL 上都读出 `materials/…json`，且对 4 个负样本一律 null',
      got.every((x) => typeof x === 'string' && /^materials\/.+\.json$/i.test(x)) && neg.every((x) => x === null),
      got.length + ' 个 MDL：' + got.slice(0, 2).join(', ') + ' …')
  }
}

{
  // `__srcStats` 的 particle/text/sound 口径必须与**既有的独立读数**（package-baseline.json 的
  // `scene.*`，由 tests/package-matrix.mjs 另一条代码路径从原始 objects 数出来）逐位相同 ——
  // 否则"新台账"就是自说自话。（`sound` 在语料里是数组，本轮实测踩到过一次，正好由这条钉住。）
  let ok = true
  const rows = []
  let base = null
  try { base = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-baseline.json'), 'utf8')) } catch (e) { base = null }
  if (!base) check('S2-E `__srcStats` 与 package-baseline.json 逐位相同', false, 'package-baseline.json 不可读')
  else {
    const byPath = new Map((base.rows || []).map((r) => [r.path, r]))
    for (const spec of PKGS) {
      const f = path.join(CORPUS, spec.rel)
      const b = byPath.get(f)
      if (!b || !exists(f)) { ok = false; rows.push(spec.rel + ': 基线无此行'); continue }
      lib.resetModelSources()
      const st = readPkg(spec.rel).scene.__srcStats
      rows.push(path.basename(path.dirname(f)) + ' particle=' + st.particle + '/' + b.scene.particle + ' text=' + st.text + '/' + b.scene.text + ' sound=' + st.sound + '/' + b.scene.sound)
      if (st.particle !== b.scene.particle || st.text !== b.scene.text || st.sound !== b.scene.sound) ok = false
    }
    check('S2-E `__srcStats` 的 particle/text/sound 与 package-baseline.json 的独立读数逐位相同（新台账不是自说自话）',
      ok, rows.join('  |  '))
  }
}

/* ── 可选：真机审计读数复核（--audit；默认不跑，读 3 个大包 ≈ 1–3 分钟） ── */
if (process.argv.includes('--audit')) {
  console.log('== 真机审计复核（tests/package-matrix.mjs --pkg；mock-GL）==')
  for (const spec of PKGS) {
    const f = path.join(CORPUS, spec.rel)
    if (!exists(f)) { check('AUDIT ' + spec.rel, false, '语料缺失'); continue }
    const r = spawnSync(process.execPath, [path.join(ROOT, 'tests', 'package-matrix.mjs'), '--pkg', f, '--json'], { encoding: 'utf8', maxBuffer: 64 << 20 })
    let row = null
    try { const j = JSON.parse(r.stdout); row = Array.isArray(j) ? j[0] : j } catch (e) { row = null }
    check('AUDIT ' + path.basename(path.dirname(f)) + ' image/drawn 达到冻结读数',
      !!row && row.scene.image === spec.audit.imageAfter && row.audit.drawnLayers === spec.audit.drawnAfter &&
      (row.audit.whiteFallback || []).length === 0 && (row.audit.transparentFallback || []).length === 12 && (row.audit.layerErrors || []).length === 0,
      row ? ('image=' + row.scene.image + '/' + spec.audit.imageAfter + ' drawn=' + row.audit.drawnLayers + '/' + spec.audit.drawnAfter
        + ' white=' + (row.audit.whiteFallback || []).length + ' transparent=' + (row.audit.transparentFallback || []).length) : 'package-matrix 未产出 JSON')
  }
}

/* ───────────────── S3：变异自证（隔离副本真改真跑） ───────────────── */
const MUTANTS = [
  // ① `model` 键整块不认（= 改动前）：模型层回到 `image=null` + 被当纯色层
  {
    id: 'no-model-key', expect: ['S1', 'S2'],
    edit: (s) => s.replace("const __imageKey = (typeof o.image === 'string') ? 'image' : ((typeof o.model === 'string') ? 'model' : null)",
      "const __imageKey = (typeof o.image === 'string') ? 'image' : null"),
  },
  // ② 登记表不查（宿主拿到 `.mdl` 的 image 但 resolveBuiltin 不命中 ⇒ 崩溃守卫与"画出来"都红）
  {
    id: 'no-registry-lookup', expect: ['S1', 'S2'],
    edit: (s) => s.replace('const __pm = __parsedModels.get(path)', 'const __pm = null'),
  },
  // ③ solid 口径回退到旧写法（只看 `o.image`）：模型层又被当纯色层 ⇒ 口径分离那一档必红。
  //    S1 **也**红：S1-8 的"锚点唯一"就钉在 `const __solidImg = __imgUsable ? __img : …` 这行原文上
  //    （变异把它改掉 ⇒ 锚点断言先红；实测确认）。
  {
    id: 'solid-old-rule', expect: ['S1', 'S2'],
    edit: (s) => s.replace("const __solidImg = __imgUsable ? __img : ((typeof o.image === 'string') ? o.image : null)",
      "const __solidImg = (typeof o.image === 'string') ? o.image : null"),
  },
]
if (!process.argv.includes('--no-mutations')) {
  console.log('== S3 变异自证（隔离 core/ 副本；真树不动）==')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-modelkey-'))
  for (const m of MUTANTS) {
    const root = path.join(tmp, m.id)
    fs.mkdirSync(path.join(root, 'core'), { recursive: true })
    for (const f of fs.readdirSync(path.join(ROOT, 'core'))) fs.copyFileSync(path.join(ROOT, 'core', f), path.join(root, 'core', f))
    const target = path.join(root, 'core', 'we-scene-bundle.js')
    const mutated = m.edit(CORE_SRC)
    if (mutated === CORE_SRC) { check('S3 ' + m.id + ' 变异真的改到了（锚点未命中 ⇒ 判据腐烂）', false); continue }
    fs.writeFileSync(target, mutated)
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}')
    const r = spawnSync(process.execPath, [FILE, '--no-mutations'], {
      encoding: 'utf8', maxBuffer: 32 << 20,
      env: { ...process.env, MPW_CORE_FILE: target, MPW_REPO_ROOT: ROOT },
    })
    const groups = new Set((r.stdout || '').split('\n').filter((l) => l.includes('✗')).map((l) => (/✗\s*(S\d)/.exec(l) || [])[1]).filter(Boolean))
    const got = [...groups].sort(), want = [...m.expect].sort()
    check('S3 ' + m.id + '：期望红集精确相等', JSON.stringify(got) === JSON.stringify(want),
      '期望 ' + JSON.stringify(want) + ' 实际 ' + JSON.stringify(got) + ' exit=' + r.status)
    if (JSON.stringify(got) === JSON.stringify(want)) console.log('    MUTANT-RED-OK ' + m.id + ' 红集=' + JSON.stringify(got))
  }
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log('\n' + (fail ? '✗ FAIL' : '✓ PASS') + ' model-key-fallback-test: ' + pass + ' 通过 / ' + fail + ' 失败')
process.exit(fail ? 1 : 0)
