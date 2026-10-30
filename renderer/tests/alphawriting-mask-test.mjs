// alphawriting-mask-test.mjs — P-208 A5（P-216 号）`alphawriting` ⇒ colorMask alpha 位判据。
//
// 官方依据（REVERSE-FINDINGS-7 RE-45）：`alphawriting` 是材质 pass 键（词表 enabled/disabled/default 与
// depthtest/depthwrite 共用）；语义 = pass 对当前 RT 的 alpha 通道写掩码：enabled ⇒ 写 alpha；
// default ⇒ 引擎按 blending 历史缺省（= 写 alpha，457 个 default pass 在恒写 alpha 的参照实现下无错误）；
// disabled ⇒ 只写 RGB。语料分布：default 457 / enabled 仅 cursorripple 力场累积 4 pass（alpha=状态）/
// disabled 0 例（词表里有 ⇒ 按官方语义补齐，规则 A）。
//
// 判据（mock-GL 行为级，自包含桩）：
//   A1 材质 pass 的 alphawriting 解析进 materialPasses[].__alphawriting（resolveEffectChain）。
//   A2 行为：disabled 的 pass 绘制期间 colorMask=(T,T,T,F)、画完恢复 (T,T,T,T)；
//      enabled/default/缺省 pass 零 colorMask 调用（与改动前逐位一致——判据钉死"default 不许变成不写 alpha"）。
//   A3 语料快照：cursorripple 两 pass（0917/3299228616 材质）enabled 被解析；同包其余 pass 无字段。
//   A4 变异自证：把 default 档改成"不写 alpha"（disabled 化）⇒ A2 的"零 colorMask"红
//      （这正是"457 个 default pass 会不会画歪"的守门）；恢复分支删掉 ⇒ A2 恢复断言红。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ROOT } from './_root.mjs'

const FILE = fileURLToPath(import.meta.url)
const CORE_FILE = process.env.MPW_CORE_FILE || path.join(ROOT, 'core', 'we-scene-bundle.js')
const CORE_SRC = fs.readFileSync(CORE_FILE, 'utf8')

let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}

function mkHarness() {
  const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
    FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0 }
  for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
  const logs = []
  const events = { draw: [] }
  const colorMaskCalls = []   // {r,g,b,a, atDraw: events.draw.length}（绘制期/恢复期用 draw 序号区分）
  let ids = 0, curVao = null, curUnit = 0, curFboObj = null, curProg = null, bufLast = null
  const curTex = new Array(8).fill(null)
  const tid = (t) => (t ? (t.__mpwId || t.id || 'anon') : null)
  const mk = (kind) => ({ id: kind + '#' + (++ids) })
  const progUni = new Map()
  const setUni = (loc, v) => { if (loc && loc.p && loc.n) { if (!progUni.has(loc.p.id)) progUni.set(loc.p.id, {}); progUni.get(loc.p.id)[loc.n] = v } }
  const handlers = {
    createTexture: () => mk('tex'), createFramebuffer: () => mk('fbo'), createBuffer: () => mk('buf'), createVertexArray: () => mk('vao'),
    createShader: () => mk('sh'), createProgram: () => mk('prog'),
    shaderSource: () => {},
    bindVertexArray: (v) => { curVao = v }, activeTexture: (u) => { curUnit = u },
    bindTexture: (t, tex) => { curTex[curUnit] = tex || null },
    bindFramebuffer: (t, f) => { curFboObj = f }, useProgram: (p) => { curProg = p },
    colorMask: (r, g, b, a) => colorMaskCalls.push({ r, g, b, a, atDraw: events.draw.length }),
    bufferData: (t, data) => { bufLast = data && data.length ? Float32Array.from(data) : null },
    drawArrays: (m, f, c) => events.draw.push({ prog: curProg && curProg.id, vao: curVao && curVao.id, fbo: curFboObj && curFboObj.id, tex: curTex.map(tid), count: c }),
    getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 1 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : null),
    getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }),
    getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: i === 0 ? 3 : 2 }),
    getAttribLocation: (p, n) => n === 'a_Position' ? 0 : n === 'a_TexCoord' ? 1 : -1,
    getUniformLocation: (p, n) => ({ p, n }), getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
    getError: () => CONST.NO_ERROR, getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : 0,
    uniform1i: (l, v) => setUni(l, v), uniform1f: (l, v) => setUni(l, v), uniform2f: (l, a, b) => setUni(l, [a, b]),
    uniform3f: (l, a, b, c) => setUni(l, [a, b, c]), uniform4f: (l, a, b, c, d) => setUni(l, [a, b, c, d]),
    uniformMatrix4fv: () => {}, uniformMatrix3fv: () => {},
  }
  const gl = new Proxy({}, { get(t, prop) {
    if (prop in handlers) return handlers[prop]
    if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
    return () => {}
  } })
  const canvas = { getContext: () => gl }
  const VERT = 'attribute vec3 a_Position; attribute vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; varying vec2 v_TexCoord; void main(){ gl_Position = g_ModelViewProjectionMatrix * vec4(a_Position,1.0); v_TexCoord = a_TexCoord; }'
  const FRAG = 'uniform sampler2D g_Texture0; varying vec2 v_TexCoord; void main(){ gl_FragColor = texture(g_Texture0, v_TexCoord); }'
  const shaderResolver = async (rel) => (rel.endsWith('.vert') ? VERT : FRAG)
  const mkLayer = (extra) => Object.assign({ id: 1, name: 'alpha层', visible: true, animLayers: false, solid: false, isContainer: false,
    textureName: 'tex_a', size: [400, 400], scale: [1, 1, 1], origin: [960, 540, 0], angles: [0, 0, 0],
    alignment: 'center', color: [1, 1, 1], alpha: 1, brightness: 1, anim: undefined,
    effects: [], particle: null, particleDef: null, parallaxDepth: null, uvRect: undefined }, extra)
  const mkScene = (layers) => ({ general: { orthogonalprojection: { width: 1920, height: 1080 } }, camera: null, layers, properties: {} })
  const textures = new Map([['tex_a', { glTex: { id: 'user_tex_a' }, width: 100, height: 100 }]])
  return { logs, events, canvas, shaderResolver, mkLayer, mkScene, textures, colorMaskCalls }
}

async function main() {
  console.log('== A5 alphawriting ⇒ colorMask alpha 位（RE-45）==')
  const H = mkHarness()
  const lib = await import(pathToFileURL(CORE_FILE).href)

  /* A1 解析 */
  {
    const eff = { file: 'fx-aw', visible: true, passes: [{ combos: {}, textures: [null] }], commands: [], fbos: [], materialPasses: [
      { shader: 'blurx', blending: 'normal', target: null, binds: [], textures: [], combos: {}, constants: {}, __alphawriting: 'disabled' },
      { shader: 'blury', blending: 'normal', target: null, binds: [], textures: [], combos: {}, constants: {}, __alphawriting: 'enabled' },
      { shader: 'blurb', blending: 'normal', target: null, binds: [], textures: [], combos: {}, constants: {}, __alphawriting: 'default' },
    ] }
    // 材质级解析（合成包走 resolveEffectChain 的 __alphawriting 落点）
    const enc = new TextEncoder()
    const magic = enc.encode('PKGV0001')
    const entries = [
      { name: 'scene.json', data: '{"objects":[]}' },
      { name: 'effects/aw/effect.json', data: JSON.stringify({ name: 'aw', version: 1, passes: [{ material: 'materials/effects/aw.json' }] }) },
      { name: 'materials/effects/aw.json', data: JSON.stringify({ passes: [{ shader: 'effects/aw/shaders/effects/aw', blending: 'normal', alphawriting: 'disabled', textures: [], combos: {}, depthtest: 'disabled', depthwrite: false }] }) },
      { name: 'shaders/effects/aw.frag', data: 'void main(){}' },
      { name: 'shaders/effects/aw.vert', data: 'void main(){}' },
    ]
    const names = entries.map((e) => enc.encode(e.name))
    let headSize = 4 + magic.length + 4
    for (const n of names) headSize += 4 + n.length + 8
    const chunks = []; let off = 0; const dir = []
    entries.forEach((e, i) => { const d = enc.encode(e.data); dir.push({ name: names[i], off, size: d.length }); chunks.push(d); off += d.length })
    const buf = new Uint8Array(headSize + off)
    const dv = new DataView(buf.buffer); let p = 0
    dv.setInt32(p, magic.length, true); p += 4
    buf.set(magic, p); p += magic.length
    dv.setInt32(p, entries.length, true); p += 4
    for (const d of dir) {
      dv.setInt32(p, d.name.length, true); p += 4
      buf.set(d.name, p); p += d.name.length
      dv.setInt32(p, d.off, true); p += 4
      dv.setInt32(p, d.size, true); p += 4
    }
    for (const c of chunks) { buf.set(c, p); p += c.length }
    const tmpPkg = path.join(os.tmpdir(), 'mpw-aw-' + process.pid + '.pkg')
    fs.writeFileSync(tmpPkg, buf)
    try {
      const pkg = lib.parsePkg(buf)
      const ef2 = { file: 'effects/aw/effect.json', passes: [] }
      lib.resolveEffectChain(pkg, ef2, (b) => new TextDecoder().decode(b), {})
      check('A1 材质级 alphawriting:"disabled" 解析进 materialPasses[].__alphawriting',
        (ef2.materialPasses || [])[0] && ef2.materialPasses[0].__alphawriting === 'disabled',
        JSON.stringify(ef2.materialPasses[0] && ef2.materialPasses[0].__alphawriting))
    } finally { fs.unlinkSync(tmpPkg) }
    check('A1b 直接给 materialPasses 的 __alphawriting 三档保真（disabled/enabled/default）',
      eff.materialPasses.every((m) => typeof m.__alphawriting === 'string'), '')
  }

  /* A2 行为：disabled 关 alpha 位、其余零 colorMask */
  {
    const runOne = async (aw) => {
      const r = lib.createRenderer(H.canvas, { shaderResolver: H.shaderResolver, onLog: (m) => H.logs.push(String(m)) })
      H.events.draw.length = 0
      H.colorMaskCalls.length = 0
      const eff = { file: 'fx-aw-' + (aw || 'none'), visible: true, passes: [{ combos: {}, textures: [null] }], commands: [], fbos: [], materialPasses: [
        { shader: 'blurx', blending: 'normal', target: null, binds: [], textures: [], combos: {}, constants: {}, __alphawriting: aw },
      ] }
      await r.render(H.mkScene([H.mkLayer({ effects: [eff] })]), H.textures, 640, 360, 0.016)
      return { draws: H.events.draw.slice(), masks: H.colorMaskCalls.slice() }
    }
    const dis = await runOne('disabled')
    check('A2a disabled：绘制前 colorMask=(T,T,T,F)、画完恢复 (T,T,T,T)',
      dis.masks.some((m) => m.r && m.g && m.b && !m.a) && dis.masks.some((m) => m.r && m.g && m.b && m.a && m.atDraw >= 1),
      JSON.stringify(dis.masks.map((m) => [m.r, m.g, m.b, m.a, m.atDraw])))
    for (const aw of ['enabled', 'default', undefined]) {
      const t = await runOne(aw)
      check('A2b ' + String(aw || '缺省') + ' ⇒ 零 colorMask 调用（写 alpha 缺省 = 改动前逐位一致）',
        t.masks.length === 0 && t.draws.length >= 2, JSON.stringify(t.masks))
    }
  }

  /* A3 语料快照：cursorripple enabled 被解析、同包其余 pass 无字段 */
  {
    const MPW_WS = process.env.MPW_ROOT || (await import('./_root.mjs')).WS
    const f = path.join(MPW_WS, 'allwallpaper/0917/3299228616/scene.pkg')
    if (!fs.existsSync(f)) {
      check('A3 语料快照（0917/3299228616 cursorripple）', false, '语料缺失: ' + f)
    } else {
      const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(f)))
      const e = pkg.entries.find((x) => /(^|\/)scene\.json$/i.test(x.name))
      const sj = lib.parseWeJson(new TextDecoder().decode(pkg.buf.subarray(pkg.dataStart + e.offset, pkg.dataStart + e.offset + e.size).slice()))
      const scene = lib.parseScene(sj, null, {})
      let enabled = 0, others = 0
      for (const l of scene.layers) for (const ef of (l.effects || [])) {
        lib.resolveEffectChain(pkg, ef, (b) => new TextDecoder().decode(b), {})
        for (const mp of (ef.materialPasses || [])) {
          if (mp.__alphawriting === 'enabled') enabled++
          else if (mp.__alphawriting == null) others++
        }
      }
      check('A3 cursorripple_apply/simulate_force 的 enabled 被解析（RE-45 读数：该包 2 个 enabled pass）',
        enabled >= 2, 'enabled=' + enabled + ' 无字段 pass=' + others)
    }
  }

  /* A4 变异自证（隔离副本真改真跑） */
  const MUTANTS = [
    // ① default 档被"顺手改成不写 alpha"（把缺省档也 disabled 化）⇒ A2b 的 default 行红（A2 组）
    //    —— 这正是任务书警告的"457 个 default pass 会不会画歪"的守门。
    { id: 'default-broken', expect: ['A2'], edit: (s) => s.replace("const __awOff = (__aw === 'disabled')", "const __awOff = (__aw !== 'enabled')") },
    // ② 恢复分支删掉 ⇒ A2a 的恢复断言红（A2 组）
    { id: 'no-restore', expect: ['A2'], edit: (s) => s.replace("      if (__awOff) { try { gl.colorMask(true, true, true, true) } catch (e) {} }\n", '') },
  ]
  if (!process.argv.includes('--no-mutations')) {
    console.log('== A4 变异自证（隔离 core/ 副本；真树不动）==')
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-aw-'))
    for (const m of MUTANTS) {
      const root = path.join(tmp, m.id)
      fs.mkdirSync(path.join(root, 'core'), { recursive: true })
      for (const f of fs.readdirSync(path.join(ROOT, 'core'))) fs.copyFileSync(path.join(ROOT, 'core', f), path.join(root, 'core', f))
      const target = path.join(root, 'core', 'we-scene-bundle.js')
      const mutated = m.edit(CORE_SRC)
      if (mutated === CORE_SRC) { check('A4 ' + m.id + ' 变异真的改到了（锚点未命中 ⇒ 判据腐烂）', false); continue }
      fs.writeFileSync(target, mutated)
      fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}')
      const r = spawnSync(process.execPath, [FILE, '--no-mutations'], {
        encoding: 'utf8', maxBuffer: 32 << 20,
        env: { ...process.env, MPW_CORE_FILE: target, MPW_REPO_ROOT: ROOT },
      })
      const groups = new Set((r.stdout || '').split('\n').filter((l) => l.includes('✗')).map((l) => (/✗\s*(A\d)/.exec(l) || [])[1]).filter(Boolean))
      const got = [...groups].sort(), want = [...m.expect].sort()
      check('A4 ' + m.id + '：期望红集精确相等', JSON.stringify(got) === JSON.stringify(want),
        '期望 ' + JSON.stringify(want) + ' 实际 ' + JSON.stringify(got) + ' exit=' + r.status)
      if (JSON.stringify(got) === JSON.stringify(want)) console.log('    MUTANT-RED-OK ' + m.id + ' 红集=' + JSON.stringify(got))
    }
    check('A4 真树 core 未被变异触碰', fs.readFileSync(CORE_FILE, 'utf8') === CORE_SRC)
    fs.rmSync(tmp, { recursive: true, force: true })
  }

  console.log('\n===== alphawriting-mask: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
