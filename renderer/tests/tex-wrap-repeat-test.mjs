// tex-wrap-repeat-test.mjs —— ①(P-168 2026-09-20) 上游 1.3.18 `4b7b07e` 的 **REPEAT 采样契约**
//
// 上游原文（`<UP>/renderer/vendor/we-scene/render/gl-util.js:41-45`）：
//   `const wrap = opts && opts.wrap === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE`
// 为什么要有判据：云/神光那类效果的 uv 随 `g_Time` **无界增长**（`uv = uv0 + t*speed`）；
//   CLAMP 下超出 1 的部分被"拉边" ⇒ 云密度恒等、天空退化成**静止伪影**（上游 1.3.18 修的就是它）。
//   反面同样重要：**不能**给所有贴图改 REPEAT —— 角色/UI 图集在边缘会出现一圈复制。
//
// 判据：
//   A 名单语义：`util/clouds_256` ⇒ repeat；普通贴图（粒子/图层）⇒ clamp；`materials/` 前缀与 `.tex`
//     后缀不参与判定（宿主两处调用口径不同）
//   B 回退开关：`?texwrap=clamp` 全部 clamp（A/B 对照）、`?texwrap=repeat` 全部 repeat（排障）
//   C 落点：`applyTexWrap(fakeGl, tex, name)` 真的调 `texParameteri(WRAP_S/WRAP_T, REPEAT|CLAMP)`；
//     假 GL 缺常量时**不抛**且返回模式（夹具不该把渲染器带崩）
//   D 接线：`demo.html` 的 `loadTex` 对**每个**创建点都过 `wrapTex(...)`（≥3 处），
//     且 helper 在 `lib.applyTexWrap` 缺席时原样返回（旧桩/受限切片夹具零行为变化）
//   E 默认不变：`makeTexture`/`makeTextureMip` 自身的缺省仍是 CLAMP（没有全局偷偷改行为）
//   F 分辨力自证：把 REPEAT 分支删掉（副本里）⇒ A 组必红
//
// 用法: node tests/tex-wrap-repeat-test.mjs [--no-mutant]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..')
const CORE = path.join(ROOT, 'core', 'we-scene-bundle.js')
const DEMO = path.join(ROOT, 'demo.html')
const NO_MUT = process.argv.includes('--no-mutant')

let pass = 0, fail = 0
const ok = (c, name, extra = '') => {
  if (c) { pass++; console.log('  ✓ ' + name + (extra ? '  [' + String(extra).slice(0, 200) + ']' : '')) }
  else { fail++; console.error('  ✗ ' + name + (extra ? '  [' + String(extra).slice(0, 300) + ']' : '')) }
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-texwrap-'))
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* tmp */ } })

const CORE_UNDER_TEST = process.env.MPW_TEXWRAP_CORE || CORE
const lib = await import(pathToFileURL(CORE_UNDER_TEST).href)

/* ── A 名单语义 ── */
console.log('== A 名单语义（哪张贴图该平铺）==')
{
  ok(lib.texWrapMode('util/clouds_256') === 'repeat', 'A1 `util/clouds_256` ⇒ repeat（上游 1.3.18 的原始场景）', lib.texWrapMode('util/clouds_256'))
  ok(lib.texWrapMode('materials/util/clouds_256.tex') === 'repeat', 'A2 `materials/` 前缀 + `.tex` 后缀不参与判定', lib.texWrapMode('materials/util/clouds_256.tex'))
  ok(lib.texWrapMode('particles/fog3') === 'clamp' && lib.texWrapMode('particle/rosepetals') === 'clamp',
    'A3 普通贴图（粒子/图集）⇒ clamp（改错会在边缘出现一圈复制）',
    [lib.texWrapMode('particles/fog3'), lib.texWrapMode('particle/rosepetals')].join('/'))
  ok(Array.isArray(lib.REPEAT_TEX_NAMES) && lib.REPEAT_TEX_NAMES.length >= 1 && lib.REPEAT_TEX_NAMES.length <= 4,
    'A4 REPEAT 名单是**数据**且刻意很小（≤4 条：它决定"可平铺"这件事，不该越长越宽）', JSON.stringify(lib.REPEAT_TEX_NAMES))
}

/* ── B 回退开关 ── */
console.log('\n== B 回退开关（A/B 对照与排障）==')
{
  ok(lib.texWrapMode('util/clouds_256', '?texwrap=clamp') === 'clamp', 'B1 `?texwrap=clamp` ⇒ 全部按旧行为（CLAMP）')
  ok(lib.texWrapMode('particles/fog3', '?texwrap=repeat') === 'repeat', 'B2 `?texwrap=repeat` ⇒ 全部 REPEAT（排障/对照）')
  ok(lib.texWrapMode('particles/fog3', '?foo=1') === 'clamp', 'B3 无关参数不影响判定（只看 `texwrap`）')
}

/* ── C 落点（假 GL 记录调用）── */
console.log('\n== C 落点（applyTexWrap 真的写进 GL）==')
{
  const rec = []
  const gl = { TEXTURE_2D: 3553, TEXTURE_WRAP_S: 10242, TEXTURE_WRAP_T: 10243, CLAMP_TO_EDGE: 33071, REPEAT: 10497, bindTexture() {}, texParameteri(a, b, c) { rec.push([a, b, c]) } }
  const tex = {}
  const m1 = lib.applyTexWrap(gl, tex, 'util/clouds_256')
  ok(m1 === 'repeat' && rec.length === 2 && rec.every((r) => r[0] === 3553 && r[2] === 10497),
    'C1 clouds：`WRAP_S` 与 `WRAP_T` 都被写成 `REPEAT`（两个轴都要，少一个就会在一个方向上拉边）', JSON.stringify(rec))
  rec.length = 0
  const m2 = lib.applyTexWrap(gl, tex, 'particles/fog3')
  ok(m2 === 'clamp' && rec.length === 2 && rec.every((r) => r[2] === 33071), 'C2 普通贴图：两轴都写 `CLAMP_TO_EDGE`', JSON.stringify(rec))
  const bad = lib.applyTexWrap({ bindTexture() {}, texParameteri() { throw new Error('boom') } }, tex, 'util/clouds_256')
  ok(bad === 'repeat', 'C3 假 GL/上下文丢失 ⇒ **不抛**，仍返回模式（夹具不该把渲染器带崩）', bad)
  ok(lib.applyTexWrap(null, null, 'util/clouds_256') === 'repeat', 'C4 gl/tex 为空 ⇒ 只返回模式、不抛')
}

/* ── D 接线 ── */
console.log('\n== D 接线（demo.html 的 loadTex 每个创建点都要过）==')
{
  const src = fs.readFileSync(DEMO, 'utf8')
  const wraps = (src.match(/wrapTex\(/g) || []).length
  ok(wraps >= 4, 'D1 `loadTex` 三个创建点 + helper 自身定义 ⇒ `wrapTex(` 至少 4 处', 'wrapTex 调用/定义 ' + wraps + ' 处')
  ok(/function wrapTex\(entry, name\) \{/.test(src) && /typeof lib\.applyTexWrap === 'function'/.test(src),
    'D2 helper 有**能力守卫**：`lib.applyTexWrap` 不在（旧桩/受限切片夹具）时原样返回，零行为变化')
  // ①(2026-09-23 静默失败审计 A-7)：两处 `makeTexture*` 调用各多了一个"上传诊断标签"实参
  //   （`where` = `'materials/<名>.tex'`，只用于日志/台账）⇒ 正则放宽到"前缀仍在 wrapTex({ … } 里"，
  //   判据本身不变：三个创建点都必须过 wrapTex。
  // ①(S3 2026-10-01) 锚点随 __attachTexJson 包裹漂移（P-225 批新增的 .tex-json 侧车登记层，
  //   包在 wrapTex 外面）——判据意图不变：三个创建点都必须过 wrapTex。
  ok(/const entry = __attachTexJson\(wrapTex\(\{ glTex: lib\.makeTexture\(gl, dst, nw, nh[,)]/.test(src)
    && /const ve = __attachTexJson\(wrapTex\(\{ video: videoEl/.test(src)
    && /const mkEntry = \(src, w, h\) => __attachTexJson\(wrapTex\(/.test(src),
    'D3 三个创建点（普通/视频占位/位图路径）都接上了（S3 起经 __attachTexJson 包裹）')
}

/* ── E 默认不变 ── */
console.log('\n== E 默认不变（没有全局偷偷改 wrap）==')
{
  const src = fs.readFileSync(CORE, 'utf8')
  const clampCount = (src.match(/TEXTURE_WRAP_[ST], gl\.CLAMP_TO_EDGE/g) || []).length
  ok(clampCount >= 6, 'E1 `makeTexture`/`makeTextureMip` 等处的缺省仍是 `CLAMP_TO_EDGE`（≥6 处未动）', 'CLAMP 缺省 ' + clampCount + ' 处')
  ok(!/TEXTURE_WRAP_[ST], gl\.REPEAT/.test(src), 'E2 **创建路径**没有把 REPEAT 写死（只经 `applyTexWrap` 按名字决定）；槽位规则见 G 组、有独立导出与独立回退口')
}

/* ── G 效果链输入槽 ti>=1 强制 REPEAT（P-194 · 借用上游 oneincase/webwallgl PR #6，MIT）── */
console.log('\n== G 效果链输入槽 ti>=1 强制 REPEAT（槽 0 / 渲染目标保持 CLAMP）==')
{
  const mkGL = () => {
    const rec = []
    return {
      rec, TEXTURE_2D: 3553, TEXTURE0: 33984, TEXTURE_WRAP_S: 10242, TEXTURE_WRAP_T: 10243,
      CLAMP_TO_EDGE: 33071, REPEAT: 10497,
      activeTexture() {}, bindTexture() {}, texParameteri(a, b, c) { rec.push([a, b, c]) },
    }
  }
  ok(typeof lib.fxSlotWrap === 'function' && typeof lib.texWrapForced === 'function',
    'G0 新契约有**具名导出**（判据直接驱动函数，而不是靠正则猜源码）')
  const gl = mkGL(); const tex = {}; const entry = { glTex: tex, width: 8, height: 8 }
  const m1 = lib.fxSlotWrap(gl, entry, 1, tex)
  ok(m1 === 'repeat' && gl.rec.length === 2 && gl.rec.every((r) => r[0] === 3553 && r[2] === 10497) && entry.samplerWrapRepeat === true,
    'G1 槽 1 具名贴图 ⇒ `WRAP_S`/`WRAP_T` 都写 `REPEAT`，并打 `samplerWrapRepeat` 标记（与上游同名字段，便于对拍）', JSON.stringify(gl.rec))
  gl.rec.length = 0
  const m2 = lib.fxSlotWrap(gl, entry, 1, tex)
  ok(m2 === 'repeat' && gl.rec.length === 0,
    'G2 同一 entry 第二次 ⇒ **零副作用**（贴图对象跨 pass/跨帧共享，不做每帧冗余调用）', 'writes=' + gl.rec.length)
  const gl0 = mkGL()
  ok(lib.fxSlotWrap(gl0, { glTex: {} }, 0, {}) === null && gl0.rec.length === 0,
    'G3 槽 0（层内容）⇒ 不动（`waterwaves` 注释要的语义：位移采样出 quad 要贴边、不回绕）')
  const glF = mkGL()
  ok(lib.fxSlotWrap(glF, { fbo: {}, glTex: {} }, 3, {}) === null && glF.rec.length === 0,
    'G4 渲染目标（`entry.fbo`，含 `passInput`/`effectFBOs`）⇒ 不动')
  const glC = mkGL()
  ok(lib.fxSlotWrap(glC, { glTex: {} }, 2, {}, '?texwrap=clamp') === null && glC.rec.length === 0,
    'G5 **显式** `?texwrap=clamp` ⇒ 槽位规则不生效（一键回到 P-168 之前的行为）')
  const glR = mkGL()
  ok(lib.fxSlotWrap(glR, { glTex: {} }, 2, {}, '?texwrap=repeat') === 'repeat' && glR.rec.length === 2,
    'G6 `?texwrap=repeat` 与槽位规则不冲突（都指向 REPEAT）')
  ok(lib.texWrapForced('?x=1') === null && lib.texWrapForced('') === null && lib.texWrapForced('?texwrap=clamp') === 'clamp',
    'G7 `texWrapForced` 只认**显式**参数：没写时返回 null（不能把"名字不在名单里 ⇒ clamp"误当成"用户要求 CLAMP"）')
  ok(lib.texWrapMode('waterripplenormal') === 'clamp' && lib.texWrapMode('waterripple_mask_96ccef38') === 'clamp',
    'G8 本仓语料实测（`allwallpaper/dd/3721991999`，属性 `waterripple=true`）：`waterripplenormal` / `waterripple_mask_*` 都**不在** P-168 名单里 ⇒ 创建时是 CLAMP（= 上游那个洞在本仓同样存在）')
  const glW = mkGL()
  ok(lib.fxSlotWrap(glW, { glTex: {} }, 1, {}, '') === 'repeat',
    'G9 同一个名字进**槽 1** 就被规则改成 REPEAT（修法落点就是这里；不是改创建期名单）')
  const coreSrc = fs.readFileSync(CORE, 'utf8')
  const iBind = coreSrc.indexOf('gl.bindTexture(gl.TEXTURE_2D, t.tex)')
  const iCall = coreSrc.indexOf('fxSlotWrap(gl, entry, ti, t.tex)')
  ok(iBind > 0 && iCall > iBind && iCall - iBind < 600,
    'G10 接线：调用点紧跟在效果 pass 的 `bindTexture(… t.tex)` 之后（同一槽位、同一 entry）', `bind@${iBind} call@${iCall}`)
  const callN = (coreSrc.match(/fxSlotWrap\(gl, entry, ti, t\.tex\)/g) || []).length
  ok(callN === 1, 'G11 只在这一处调用（不扩散到层/合成/粒子路径）', callN + ' 处')
}

/* ── F 分辨力自证 ── */
if (!NO_MUT) {
  console.log('\n== F 分辨力自证（副本在 mkdtemp；真树不许变）==')
  const { createHash } = await import('node:crypto')
  const sha = (p) => createHash('sha256').update(fs.readFileSync(p)).digest('hex')
  const before = sha(CORE)
  const src = fs.readFileSync(CORE, 'utf8')
  const from = "  return REPEAT_TEX_NAMES.indexOf(texNameKey(name)) >= 0 ? 'repeat' : 'clamp';"
  const to = "  return 'clamp';"
  const mutated = src.split(from).length === 2 ? src.replace(from, to) : null
  if (!mutated) ok(false, 'F0 变异注入成功（锚点唯一）', '锚点没匹配上：' + from.slice(0, 60))
  else {
    /* ⚠ 变异副本必须与**它的相对依赖**放在一起：`core/we-scene-bundle.js` 自己 `import './attach-transform.mjs'`
       （以及粒子/指针/音频那几个同目录模块）⇒ 单文件丢进 /tmp 会 ERR_MODULE_NOT_FOUND、子进程直接崩、
       "A 组变红"就成了假红（实测踩到）。口径与其余夹具一致：**先整目录复制（只跳子目录），再覆盖被变异的那一个**。 */
    const mutCore = path.join(tmp, 'core-mut')
    fs.mkdirSync(mutCore, { recursive: true })
    for (const f of fs.readdirSync(path.join(ROOT, 'core'))) {
      const srcF = path.join(ROOT, 'core', f)
      if (!fs.statSync(srcF).isFile()) continue
      fs.copyFileSync(srcF, path.join(mutCore, f))
    }
    const copy = path.join(mutCore, 'we-scene-bundle.js')
    fs.writeFileSync(copy, mutated)
    const r = spawnSync(process.execPath, [process.argv[1], '--no-mutant'], {
      encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, MPW_TEXWRAP_CORE: copy },
    })
    const out = (r.stdout || '') + (r.stderr || '')
    const redA = /✗ A[0-9]/.test(out)
    ok(redA, 'F1 把 REPEAT 分支删掉（退回全 CLAMP）⇒ A 组必须变红（= 判据有分辨力）', `exit=${r.status} 命中A=${redA}`)
  }
  /* F3（P-194 第二个变异）：把**槽位规则**的 REPEAT 写入删掉 ⇒ G 组必红。
     为什么要单独一条：G 组钉的是"效果链输入槽"这条**新**契约，F1 只证明名单那条老契约有分辨力。 */
  const from2 = "    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, rep);\n    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, rep);"
  const mutated2 = src.split(from2).length === 2 ? src.replace(from2, '    void rep;   // 变异：不写 wrap') : null
  if (!mutated2) ok(false, 'F3 变异②注入成功（锚点唯一，槽位规则的两轴写入）', '锚点没匹配上：' + from2.slice(0, 60))
  else {
    const mutCore2 = path.join(tmp, 'core-mut2')
    fs.mkdirSync(mutCore2, { recursive: true })
    for (const f of fs.readdirSync(path.join(ROOT, 'core'))) {
      const srcF = path.join(ROOT, 'core', f)
      if (!fs.statSync(srcF).isFile()) continue
      fs.copyFileSync(srcF, path.join(mutCore2, f))
    }
    const copy2 = path.join(mutCore2, 'we-scene-bundle.js')
    fs.writeFileSync(copy2, mutated2)
    const r2 = spawnSync(process.execPath, [process.argv[1], '--no-mutant'], {
      encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, MPW_TEXWRAP_CORE: copy2 },
    })
    const out2 = (r2.stdout || '') + (r2.stderr || '')
    const redG = /✗ G[0-9]/.test(out2)
    ok(redG, 'F3 删掉槽位规则的 REPEAT 写入 ⇒ G 组必须变红（新契约有分辨力）', `exit=${r2.status} 命中G=${redG}`)
  }
  ok(sha(CORE) === before, 'F2 真树 sha256 跑前跑后逐字相同（变异没碰真文件）', sha(CORE).slice(0, 16) + '…')
}

console.log(`\n────\ntex-wrap-repeat-test：${pass} 通过 / ${fail} 失败`)
if (fail) { console.error('✗ REPEAT 采样契约未通过'); process.exit(1) }
console.log('✓ REPEAT 采样契约通过：按名单平铺 + 回退开关 + 真写进 GL + 接线齐 + 默认不变 + 槽位契约 + 变异自证')
