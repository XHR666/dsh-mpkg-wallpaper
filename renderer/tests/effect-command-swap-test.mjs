// effect-command-swap-test.mjs — P-208 A3（P-215 号）`command:"swap"` 进命令枚举 + 未知命令告警判据。
//
// 官方依据（REVERSE-FINDINGS-7 RE-56）：`command` 在 effect 解析键表（VA 0x372958）；枚举证据 =
// `"copy"`（motionblur，RE-61 C9）+ `"swap"`（fluidsimulation 尾部 ×2，C10；两份官方二进制无独立
// "swap" 字面量 ⇒ SSO 内联推断，中置信）；语料无第三种取值。改法：swap ⇒ 交换本效果的乒乓方向
// （effectInput ⇄ effectOutput，curInput/curDraw 同步）；未知命令 ⇒ 如实记一条日志再跳过（不许静默）。
//
// 判据（mock-GL **行为级**，复用 tests/mock-gl-test.mjs 的桩模式）：
//   W1 解析：resolveEffectChain 把 swap 命令 parse 进 effect.commands（afterpos 保序）。
//   W2 行为（mid-effect）：2-pass 效果 + swap(afterpos=1) ⇒ 第 2 个 pass 读到的链输入 =
//      第 1 个 pass 刚写出的那个 FBO（无 swap 时读的是效果链输入）。
//   W3 行为（尾部）：swap(afterpos=pass 数) 在最后一个 pass 之后生效（旧实现永不触发）。
//   W4 未知命令：`command:"frobnicate"` ⇒ 有一条"不在枚举（copy/swap）"日志且链不断。
//   W5 变异自证：swap 分支删掉 ⇒ W2 红；未知命令告警删掉 ⇒ W4 红（隔离副本真改真跑）。
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

/* ── mock-GL 桩（与 tests/mock-gl-test.mjs 同模式，自包含） ── */
function mkHarness() {
  const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
    FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0 }
  for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i
  const logs = []
  const events = { pointer: [], draw: [] }
  let ids = 0, curVao = null, curUnit = 0, curFboObj = null, curProg = null, bufLast = null
  const fboTex = new Map()   // fbo.id → 最近 attach 的纹理 id（framebufferTexture2D 追踪）
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
    vertexAttribPointer: (...a) => events.pointer.push({ vao: curVao && curVao.id, args: a }),
    bindFramebuffer: (t, f) => { curFboObj = f }, useProgram: (p) => { curProg = p },
    framebufferTexture2D: (t, att, tt, tex) => { if (curFboObj && curFboObj.id) fboTex.set(curFboObj.id, tid(tex)) },
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
  const mkLayer = (extra) => Object.assign({ id: 1, name: 'swap层', visible: true, animLayers: false, solid: false, isContainer: false,
    textureName: 'tex_a', size: [400, 400], scale: [1, 1, 1], origin: [960, 540, 0], angles: [0, 0, 0],
    alignment: 'center', color: [1, 1, 1], alpha: 1, brightness: 1, anim: undefined,
    effects: [], particle: null, particleDef: null, parallaxDepth: null, uvRect: undefined }, extra)
  const mkScene = (layers) => ({ general: { orthogonalprojection: { width: 1920, height: 1080 } }, camera: null, layers, properties: {} })
  const textures = new Map([['tex_a', { glTex: { id: 'user_tex_a' }, width: 100, height: 100 }]])
  return { lib: null, logs, events, canvas, shaderResolver, mkLayer, mkScene, textures, fboTex }
}

async function main() {
  console.log('== A3 command:"swap"（RE-56）==')
  const H = mkHarness()
  const lib = await import(pathToFileURL(CORE_FILE).href)
  H.lib = lib

  /* W1 解析：swap 进 commands（合成包） */
  function buildSyntheticPkg(entries) {
    const enc = new TextEncoder()
    const magic = enc.encode('PKGV0001')
    const names = entries.map((e) => enc.encode(e.name))
    let headSize = 4 + magic.length + 4
    for (const n of names) headSize += 4 + n.length + 8
    const chunks = []; let off = 0; const dir = []
    entries.forEach((e, i) => {
      const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data
      dir.push({ name: names[i], off, size: data.length }); chunks.push(data); off += data.length
    })
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
    return buf
  }
  {
    const DEC = new TextDecoder()
    const effectJson = JSON.stringify({ name: 'sim', version: 1, passes: [
      { material: 'materials/effects/sim.json' },
      { material: 'materials/effects/sim2.json' },
      { command: 'swap' },
      { command: 'swap' },
    ] })
    const matJson = JSON.stringify({ passes: [{ shader: 'effects/sim/shaders/effects/sim', blending: 'normal', textures: [], combos: {}, depthtest: 'disabled', depthwrite: false }] })
    const pkgBuf = buildSyntheticPkg([
      { name: 'scene.json', data: '{"objects":[]}' },
      { name: 'effects/sim/effect.json', data: effectJson },
      { name: 'materials/effects/sim.json', data: matJson },
      { name: 'materials/effects/sim2.json', data: matJson },
      { name: 'shaders/effects/sim.frag', data: 'void main(){}' },
      { name: 'shaders/effects/sim.vert', data: 'void main(){}' },
    ])
    const tmpPkg = path.join(os.tmpdir(), 'mpw-fxswap-' + process.pid + '.pkg')
    fs.writeFileSync(tmpPkg, pkgBuf)
    try {
      const pkg = lib.parsePkg(pkgBuf)
      const ef = { file: 'effects/sim/effect.json', passes: [] }
      const r = lib.resolveEffectChain(pkg, ef, (b) => DEC.decode(b), {})
      check('W1 swap×2 parse 进 commands（afterpos=2/2，material pass 数=2）',
        r.ok === true && (ef.commands || []).length === 2 &&
        ef.commands.every((c) => c.command === 'swap' && c.afterpos === 2) && ef.materialPasses.length === 2,
        JSON.stringify(ef.commands))
    } finally { fs.unlinkSync(tmpPkg) }
  }

  /* W2/W3/W4 行为（mock-GL） */
  const runChain = async (commands) => {
    const r = lib.createRenderer(H.canvas, { shaderResolver: H.shaderResolver, onLog: (m) => H.logs.push(String(m)) })
    H.events.draw.length = 0
    H.logs.length = 0
    H.fboTex.clear()
    const eff = { file: 'fx-swap-test', visible: true, passes: [{ combos: {}, textures: [null] }], commands,
      fbos: [], materialPasses: [
        { shader: 'blurx', blending: 'normal', target: null, binds: [], textures: [], combos: {}, constants: {} },
        { shader: 'blury', blending: 'normal', target: null, binds: [], textures: [], combos: {}, constants: {} },
      ] }
    await r.render(H.mkScene([H.mkLayer({ effects: [eff] })]), H.textures, 640, 360, 0.016)
    return { draws: H.events.draw.slice(), fboTex: H.fboTex }
  }
  {
    const dNone = await runChain([])
    const dSwap = await runChain([{ command: 'swap', source: null, target: null, afterpos: 1 }])
    check('W2a 基线（无 swap）：4 次 draw（copy+2 pass+合成），pass1 与 pass0 读同一链输入纹理',
      dNone.draws.length === 4 && String(dNone.draws[2].tex[0]) === String(dNone.draws[1].tex[0]),
      JSON.stringify(dNone.draws.map((x) => [x.fbo && String(x.fbo), x.tex[0] && String(x.tex[0])])))
    // W2b（轮内断言）：swap 后 pass1 的 T0 = pass0 刚写出的那张纹理（fbo→attach 追踪），且 ≠ pass0 读的
    check('W2b mid-swap（afterpos=1）⇒ pass1 的 T0 = pass0 刚写出的 FBO 附着纹理（乒乓换向）',
      dSwap.draws.length === 4 && dSwap.fboTex.get(String(dSwap.draws[1].fbo)) === String(dSwap.draws[2].tex[0]) &&
      String(dSwap.draws[2].tex[0]) !== String(dSwap.draws[1].tex[0]),
      JSON.stringify({ pass1T0: String(dSwap.draws[2].tex[0]), pass0Attached: dSwap.fboTex.get(String(dSwap.draws[1].fbo)), pass0Read: String(dSwap.draws[1].tex[0]) }))
    const dEnd = await runChain([{ command: 'swap', source: null, target: null, afterpos: 2 }])
    // W3（轮内断言）：尾部 swap ⇒ advance 读的是翻转后的 effectOutput = 效果链输入（copy 写入的那块）。
    //   无尾部 swap 时 advance 给的是 effectOutput（pass1 的输出，另一块纹理）⇒ 两条路可区分。
    check('W3 尾部 swap（afterpos=pass 数）生效：合成读 copy 写入的缓冲（旧实现尾部命令永不触发 ⇒ 读 effectOutput）',
      dEnd.draws.length === 4 && dEnd.fboTex.get(String(dEnd.draws[0].fbo)) === String(dEnd.draws[3].tex[0]),
      JSON.stringify({ compT0: String(dEnd.draws[3].tex[0]), copyAttached: dEnd.fboTex.get(String(dEnd.draws[0].fbo)), pass1T0: String(dEnd.draws[2].tex[0]) }))
    const dUnknown = await runChain([{ command: 'frobnicate', source: null, target: null, afterpos: 0 }])
    check('W4 未知命令：如实记一条"不在枚举（copy/swap）"日志且链不断（4 次 draw 照常）',
      H.logs.some((m) => m.includes('frobnicate') && m.includes('copy/swap')) && dUnknown.draws.length === 4,
      JSON.stringify(H.logs.filter((m) => m.includes('frobnicate'))))
  }

  /* W5 变异自证（隔离副本真改真跑） */
  const MUTANTS = [
    // ① swap 两个分支都删掉（mid + tail；回到"无 swap 枚举"）：W2 与 W3 都红（实测）
    { id: 'no-swap', expect: ['W2', 'W3'], edit: (s) => s.replace("        if (cmd.command === 'swap') {\n          const tSwap = effectInput\n          effectInput = effectOutput\n          effectOutput = tSwap\n          curInput = effectInput\n          curDraw = effectOutput\n          continue\n        }", '').replace("          if (cmd.command === 'swap') {\n            const tSwap = effectInput\n            effectInput = effectOutput\n            effectOutput = tSwap\n          } else if", "          if (false) {\n            void 0\n          } else if") },
    // ② 未知命令告警删掉（回到静默）：W4 红（W4 组）
    { id: 'silent-unknown', expect: ['W4'], edit: (s) => s.replace("          const uKey = 'fxcmd:' + String(cmd.command)\n          if (!passErrorLogged.has(uKey)) {\n            passErrorLogged.add(uKey)\n            try { onLog('[we-scene] 效果命令 \"' + String(cmd.command) + '\" 不在枚举（copy/swap）⇒ 该条跳过（' + String(eff.file || eff.__fxRel || '?') + '）') } catch {}\n          }\n          continue", '          continue') },
  ]
  if (!process.argv.includes('--no-mutations')) {
    console.log('== W5 变异自证（隔离 core/ 副本；真树不动）==')
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-fxswap-'))
    for (const m of MUTANTS) {
      const root = path.join(tmp, m.id)
      fs.mkdirSync(path.join(root, 'core'), { recursive: true })
      for (const f of fs.readdirSync(path.join(ROOT, 'core'))) fs.copyFileSync(path.join(ROOT, 'core', f), path.join(root, 'core', f))
      const target = path.join(root, 'core', 'we-scene-bundle.js')
      const mutated = m.edit(CORE_SRC)
      if (mutated === CORE_SRC) { check('W5 ' + m.id + ' 变异真的改到了（锚点未命中 ⇒ 判据腐烂）', false); continue }
      fs.writeFileSync(target, mutated)
      fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}')
      const r = spawnSync(process.execPath, [FILE, '--no-mutations'], {
        encoding: 'utf8', maxBuffer: 32 << 20,
        env: { ...process.env, MPW_CORE_FILE: target, MPW_REPO_ROOT: ROOT },
      })
      const groups = new Set((r.stdout || '').split('\n').filter((l) => l.includes('✗')).map((l) => (/✗\s*(W\d)/.exec(l) || [])[1]).filter(Boolean))
      const got = [...groups].sort(), want = [...m.expect].sort()
      check('W5 ' + m.id + '：期望红集精确相等', JSON.stringify(got) === JSON.stringify(want),
        '期望 ' + JSON.stringify(want) + ' 实际 ' + JSON.stringify(got) + ' exit=' + r.status)
      if (JSON.stringify(got) === JSON.stringify(want)) console.log('    MUTANT-RED-OK ' + m.id + ' 红集=' + JSON.stringify(got))
    }
    check('W5 真树 core 未被变异触碰', fs.readFileSync(CORE_FILE, 'utf8') === CORE_SRC)
    fs.rmSync(tmp, { recursive: true, force: true })
  }

  console.log('\n===== effect-command-swap: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
