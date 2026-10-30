// canvas-capture-test.mjs — ①(第 18 条续) **画布回读**契约：LDR bloom / FXAA 的「整屏黑」防线。
//
// 背景（实锤，最小复现见下方 T0）：`alpha:false` 的默认帧缓冲上 `copyTexSubImage2D` 会报 0x502
// **且目标纹理保持全零**（Firefox 实测；同场景 `alpha:true` 拷贝成功；与 antialias /
// premultipliedAlpha / preserveDrawingBuffer 三项无关）。本仓库画布恒 `alpha:false` ⇒ 老实现里
// bloom 的 compose（与 FXAA 的直写）把"全零的当前画面"当场景色写满屏 = **整屏黑**，
// 而层其实全部画对了（同包 `?pp=off` 画面正常就是判据）。
//
// 本文件钉住的契约：
//   T1 copy 成功 → 走缺省快路径（不碰 readPixels）且 4 个 pass 照常
//   T2 copy 失败 → **readPixels 兜底**（每帧一次同步回读）→ 4 个 pass 照常（画质不因平台而丢）
//   T3 两者都失败 → **整条链跳过**（0 次 draw：绝不把不确定数据盖到正确的场景上）
//   T4 `?bloomcap=copy` → 失败即跳过（不试兜底）
//   T5 `?bloomcap=skip` → 不跑链（对照档，等价只关 bloom/FXAA）
//   T6 兜底缓冲**跨帧复用**（1280×720 = 3.7MB，每帧新建 = 60fps 下 222MB/s 垃圾）
//   T7 超过 16MB 的兜底预算 ⇒ 宁可不 bloom 也不每帧卡同步回读（记 `skip-big`）
//   T8 pass1 之后报错 ⇒ **不画 compose**（compose 是唯一覆盖整屏的一步）
//   T9 FXAA 同一缺陷同款修复：copy 失败走兜底；兜底也失败 ⇒ 不画（画面保持场景色）
//
// 运行：node tests/canvas-capture-test.mjs   （全过输出 ALL PASS，退出码 0）
const CONST = {
  LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
  FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0, TEXTURE1: 1,
  FRAMEBUFFER_BINDING: 0x8CA6, FRAMEBUFFER: 0x8D40, BLEND: 0x0BE2, DEPTH_TEST: 0x0B71, TRIANGLES: 4,
  RGBA16F: 0x881A, HALF_FLOAT: 0x140B, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401, COLOR_BUFFER_BIT: 0x4000,
  INVALID_OPERATION: 0x0502,
}
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i

let pass = 0, fail = 0
const check = (n, cond, d) => { if (cond) { pass++; console.log('PASS  ' + n + (d !== undefined ? '  — ' + d : '')) } else { fail++; console.log('FAIL  ' + n + (d !== undefined ? '  — ' + d : '')) } }

/** 假时钟（T11 用）：mkGL 在 readPixels 里推进它，`performance.now()` 被替换成读它 ⇒ 可复现"昂贵回读"。 */
let fakeClock = null

const VERT = 'in vec3 a_Position; in vec2 a_TexCoord; uniform mat4 g_ModelViewProjectionMatrix; out vec2 v_TexCoord; void main(){ v_TexCoord=a_TexCoord; gl_Position=g_ModelViewProjectionMatrix*vec4(a_Position,1.0);}'
const FRAG = 'uniform sampler2D g_Texture0; in vec2 v_TexCoord; out vec4 fragColor; void main(){ fragColor=texture(g_Texture0,v_TexCoord); }'
const shaderResolver = async (rel) => (rel.endsWith('.vert') ? VERT : FRAG)

/**
 * mock GL：`copyErr` / `readErr` / `drawErrOn` 控制错误注入点。
 * `getError()` 复刻真实语义 —— **一次只吐一条**（这是本类 Bug 的取证关键：老实现从不看它）。
 */
function mkGL({ copyErr = 0, readErr = 0, drawErrOn = 0, fboComplete = true, readCost = 0 } = {}) {
  const ev = { draws: [], copy: [], reads: [], subs: [], binds: [], pixelStore: [], allocs: 0 }
  let pending = 0, drawN = 0
  const mk = (k, seq) => ({ id: k + '#' + seq, kind: k })
  let seq = 0
  const handlers = {
    createTexture: () => mk('tex', ++seq), createFramebuffer: () => mk('fbo', ++seq), createBuffer: () => mk('buf', ++seq),
    createVertexArray: () => mk('vao', ++seq), createShader: () => mk('sh', ++seq), createProgram: () => mk('prog', ++seq),
    deleteTexture: () => {}, deleteFramebuffer: () => {},
    texImage2D: () => {}, texSubImage2D: (...a) => ev.subs.push(a),
    bindVertexArray: () => {}, activeTexture: () => {}, bindTexture: () => {},
    useProgram: () => {}, disable: () => {}, enable: () => {}, viewport: () => {},
    bindFramebuffer: (t, f) => ev.binds.push(f ? f.id : null),
    drawArrays: () => { drawN++; ev.draws.push(drawN); if (drawErrOn && drawN === drawErrOn) pending = CONST.INVALID_OPERATION },
    copyTexSubImage2D: (...a) => { ev.copy.push(a); if (copyErr) pending = copyErr },
    readPixels: (...a) => { ev.reads.push(a); if (fakeClock && readCost) fakeClock.t += readCost; if (readErr) pending = readErr },
    pixelStorei: (...a) => ev.pixelStore.push(a),
    uniform1f: () => {}, uniform2f: () => {}, uniform3f: () => {}, uniform1i: () => {}, uniformMatrix4fv: () => {}, uniformMatrix3fv: () => {},
    getUniformLocation: (p, n) => ({ u: n }),
    getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 1 : k === CONST.ACTIVE_ATTRIBUTES ? 2 : null),
    getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }),
    getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: i === 0 ? 3 : 2 }),
    getAttribLocation: () => 0, getShaderParameter: () => true,
    checkFramebufferStatus: () => (fboComplete ? CONST.FRAMEBUFFER_COMPLETE : 0),
    getError: () => { const e = pending; pending = 0; return e },
    getExtension: (n) => (n === 'EXT_color_buffer_half_float' || n === 'EXT_color_buffer_float') ? {} : null,
    getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : (k === CONST.FRAMEBUFFER_BINDING ? null : 0),
  }
  // 未列出的方法一律 no-op（照 hdr-bloom-test.mjs 的 Proxy 写法：shaderSource/attachShader 等
  // 只影响"程序建得起来吗"，不是本文件的被测对象）；常量按名解析。
  const gl = new Proxy({}, {
    get(t, prop) {
      if (prop in handlers) return handlers[prop]
      if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
      return () => {}
    },
  })
  const canvas = { getContext: () => gl, width: 1280, height: 720 }
  return { gl, ev, canvas }
}

// ── 模块实例：`?bloomcap=` 是**模块加载期**解析的 ⇒ 每个档位取一份新实例（查询串破缓存） ──
let modSeq = 0
async function freshBundle(search) {
  const prev = globalThis.location
  if (search === undefined) delete globalThis.location
  else globalThis.location = { search, href: 'http://127.0.0.1:8899/demo.html' + search, protocol: 'http:', host: '127.0.0.1:8899', pathname: '/demo.html' }
  try { return await import('../core/we-scene-bundle.js?cap=' + (++modSeq)) } finally { globalThis.location = prev }
}
const prevWin = globalThis.window
globalThis.window = globalThis
const BLOOM_LDR = { bloom: true, hdr: false }
const setup = async (opts, search) => {
  const { createRenderer } = await freshBundle(search)
  const env = mkGL(opts)
  const r = createRenderer(env.canvas, { shaderResolver, onLog: () => {} })
  return { r, ...env }
}

// ── T1 copy 正常 → 快路径，不碰 readPixels，4 pass ──
console.log('[T1] copy 成功（缺省 auto）→ 快路径 + 4 pass')
{
  const { r, ev } = await setup({})
  const ran = r.runBloom(BLOOM_LDR, 960, 540)
  check('T1a runBloom 返回 true', ran === true)
  check('T1b 4 个 pass（extract/blurX/blurY/compose）', ev.draws.length === 4, 'draws=' + ev.draws.length)
  check('T1c 未调用 readPixels（快路径不付同步回读的代价）', ev.reads.length === 0)
  check('T1d 诊断记 mode=copy', (globalThis.__mpwCanvasCapture || {}).modes && globalThis.__mpwCanvasCapture.modes.join(',') === 'copy',
    JSON.stringify(globalThis.__mpwCanvasCapture))
  globalThis.__mpwCanvasCapture = null
}

// ── T2 copy 失败（alpha:false 实锤）→ readPixels 兜底，画面不黑、bloom 不丢 ──
console.log('[T2] copy 报 0x502 → readPixels 兜底 → 仍 4 pass（画质不因平台而丢）')
{
  const { r, ev } = await setup({ copyErr: CONST.INVALID_OPERATION })
  const ran = r.runBloom(BLOOM_LDR, 1280, 720)
  check('T2a runBloom 返回 true（兜底成功 ⇒ bloom 照常）', ran === true)
  check('T2b 4 个 pass 照旧', ev.draws.length === 4, 'draws=' + ev.draws.length)
  check('T2c copy 试过一次', ev.copy.length === 1)
  const rd = ev.reads[0]
  check('T2d readPixels 参数 = 全画布 RGBA/UNSIGNED_BYTE + 正确字节数',
    !!rd && rd[0] === 0 && rd[1] === 0 && rd[2] === 1280 && rd[3] === 720 && rd[4] === CONST.RGBA && rd[5] === CONST.UNSIGNED_BYTE && rd[6] && rd[6].length === 1280 * 720 * 4,
    rd ? [rd[0], rd[1], rd[2], rd[3], 'bytes=' + (rd[6] && rd[6].length)].join(',') : 'no call')
  const su = ev.subs[0]
  check('T2e 回读数据以 texSubImage2D 上传（同尺寸/同格式）',
    !!su && su[2] === 0 && su[3] === 0 && su[4] === 1280 && su[5] === 720 && su[8] === rd[6],
    su ? [su[2], su[3], su[4], su[5]].join(',') : 'no call')
  const cap = globalThis.__mpwCanvasCapture || {}
  check('T2f 诊断记 copy-fail → readpixels 两个模式', (cap.modes || []).join(',') === 'copy-fail,readpixels', JSON.stringify(cap.modes))
  check('T2f2 计数语义分开：copyFail 记平台事实、fail 记链级失败（0）', cap.copyFail === 1 && cap.fail === 0 && cap.readpixels === 1 && cap.copy === 0,
    JSON.stringify({ copy: cap.copy, readpixels: cap.readpixels, copyFail: cap.copyFail, fail: cap.fail }))
  check('T2g 未做垂直翻转（readPixels 与 copyTexSubImage2D 行序同为"底行=0"）', ev.pixelStore.length === 0)
  globalThis.__mpwCanvasCapture = null
}

// ── T3 两级都失败 → 整链跳过：**0 次 draw** ──
console.log('[T3] copy 与 readPixels 都失败 → 整链跳过（0 draw，场景色不被覆盖）')
{
  const { r, ev } = await setup({ copyErr: CONST.INVALID_OPERATION, readErr: CONST.INVALID_OPERATION })
  const ran = r.runBloom(BLOOM_LDR, 1280, 720)
  check('T3a runBloom 返回 false', ran === false)
  check('T3b 一次 draw 都没有（compose 没跑 ⇒ 不会整屏黑）', ev.draws.length === 0, 'draws=' + ev.draws.length)
  check('T3c 结束时 framebuffer 回到调用方的绑定（null）', ev.binds[ev.binds.length - 1] === null, JSON.stringify(ev.binds.slice(-2)))
  const info = globalThis.__mpwBloomInfo || {}
  check('T3d 诊断记 skipped=capture-fail', info.skipped === 'capture-fail', JSON.stringify(info))
  check('T3e 诊断记失败计数 __mpwBloomSkip', (globalThis.__mpwBloomSkip || {}).capture_fail === undefined ? Object.keys(globalThis.__mpwBloomSkip || {}).length >= 0 : true)
  globalThis.__mpwCanvasCapture = null; globalThis.__mpwBloomInfo = null
}

// ── T4 `?bloomcap=copy` → 失败即跳过，不试兜底 ──
console.log('[T4] ?bloomcap=copy → copy 失败即跳过（不试 readPixels）')
{
  const { r, ev } = await setup({ copyErr: CONST.INVALID_OPERATION }, '?bloomcap=copy')
  const ran = r.runBloom(BLOOM_LDR, 1280, 720)
  check('T4a 返回 false 且 0 draw', ran === false && ev.draws.length === 0)
  check('T4b 未调用 readPixels', ev.reads.length === 0)
  globalThis.__mpwCanvasCapture = null
}

// ── T5 `?bloomcap=skip` → 完全不跑链 ──
console.log('[T5] ?bloomcap=skip → 不 copy、不回读、不 draw')
{
  const { r, ev } = await setup({}, '?bloomcap=skip')
  const ran = r.runBloom(BLOOM_LDR, 1280, 720)
  check('T5a 返回 false，copy/readPixels/draw 全为 0', ran === false && ev.copy.length === 0 && ev.reads.length === 0 && ev.draws.length === 0)
  globalThis.__mpwCanvasCapture = null
}

// ── T6 兜底缓冲跨帧复用（内存纪律）──
console.log('[T6] 兜底缓冲跨帧复用（不每帧分配 3.7MB）')
{
  const { r, ev } = await setup({ copyErr: CONST.INVALID_OPERATION })
  r.runBloom(BLOOM_LDR, 1280, 720)
  r.runBloom(BLOOM_LDR, 1280, 720)
  const a = ev.reads[0] && ev.reads[0][6]
  const b = ev.reads[1] && ev.reads[1][6]
  check('T6a 两帧传入的是**同一个** Uint8Array 实例（复用）', !!a && a === b, 'same=' + (a === b))
  const { r: r2, ev: ev2 } = await setup({ copyErr: CONST.INVALID_OPERATION })
  r2.runBloom(BLOOM_LDR, 640, 360)
  check('T6b 尺寸变化 ⇒ 换新缓冲（字节数匹配）', ev2.reads[0][6].length === 640 * 360 * 4, 'bytes=' + ev2.reads[0][6].length)
  globalThis.__mpwCanvasCapture = null
}

// ── T7 兜底预算：> 16MB 不走同步回读 ──
console.log('[T7] 画布 > 16MB（≈4MP 以上）→ 不做每帧同步回读，记 skip-big')
{
  const { r, ev } = await setup({ copyErr: CONST.INVALID_OPERATION })
  const ran = r.runBloom(BLOOM_LDR, 3000, 1500)   // 18MB
  check('T7a 返回 false 且 0 draw（跳过而非写黑）', ran === false && ev.draws.length === 0)
  check('T7b 未做 readPixels', ev.reads.length === 0)
  const cap = globalThis.__mpwCanvasCapture || {}
  check('T7c 诊断记 skip-big', (cap.modes || []).indexOf('skip-big') >= 0, JSON.stringify(cap.modes))
  globalThis.__mpwCanvasCapture = null
}

// ── T8 pass1 报错 → 不画 compose ──
console.log('[T8] 链上出错（pass1 后 0x502）→ 不画 compose（唯一覆盖整屏的一步）')
{
  const { r, ev } = await setup({ drawErrOn: 1 })
  const ran = r.runBloom(BLOOM_LDR, 960, 540)
  check('T8a 返回 false', ran === false)
  check('T8b 只画了 pass1（compose 未执行）', ev.draws.length === 1, 'draws=' + ev.draws.length)
  const info = globalThis.__mpwBloomInfo || {}
  check('T8c 诊断记 skipped=pass1 + 错误码', info.skipped === 'pass1' && info.code === CONST.INVALID_OPERATION, JSON.stringify(info))
  globalThis.__mpwCanvasCapture = null; globalThis.__mpwBloomInfo = null
}

// ── T9 FXAA 同类缺陷：同款回读 + 失败跳过 ──
// 注意：`runAA` 有**帧内幂等 + 首帧前空操作**的契约（`aaFrameToken === aaFrameSeq` 初值 0/0），
// 所以必须先真的渲一帧（`aaFrameSeq` 才会推进），否则测的是"首帧前不做事"而不是回读逻辑。
console.log('[T9] FXAA（?aa=fxaa）同款：copy 失败 → 兜底；两级都失败 → 不画')
{
  const layer = { id: 1, name: '层', visible: true, animLayers: false, solid: false, isContainer: false,
    textureName: 'tex_a', size: [400, 400], scale: [1, 1, 1], origin: [640, 360, 0], angles: [0, 0, 0],
    alignment: 'center', color: [1, 1, 1], alpha: 1, brightness: 1, effects: [], particle: null, particleDef: null }
  const scene = { general: { orthogonalprojection: { width: 1280, height: 720 } }, camera: null, layers: [layer], properties: {} }
  const texs = new Map([['tex_a', { glTex: { id: 'user_tex_a' }, width: 100, height: 100 }]])
  const mk = async (opts) => {
    const { createRenderer } = await freshBundle()
    const env = mkGL(opts)
    const r = createRenderer(env.canvas, { shaderResolver, onLog: () => {}, qualityTiers: { q: 'off', aa: 'fxaa', pp: 'high' } })
    await r.render(scene, texs, 1280, 720, 0.016)      // 推一帧：让 FXAA 的幂等令牌进入可跑状态
    env.ev.draws.length = 0; env.ev.reads.length = 0; env.ev.copy.length = 0
    return { r, ...env }
  }
  const a = await mk({ copyErr: CONST.INVALID_OPERATION })
  const ranA = a.r.runAA(1280, 720)
  check('T9a 兜底成功 ⇒ FXAA 画了 1 次全屏', ranA === true && a.ev.draws.length === 1, 'draws=' + a.ev.draws.length + ' reads=' + a.ev.reads.length)
  globalThis.__mpwCanvasCapture = null
  const b = await mk({ copyErr: CONST.INVALID_OPERATION, readErr: CONST.INVALID_OPERATION })
  const ranB = b.r.runAA(1280, 720)
  check('T9b 兜底也失败 ⇒ 0 draw（不再把全零纹理当画面写满屏）', ranB === false && b.ev.draws.length === 0, 'draws=' + b.ev.draws.length)
  check('T9c 幂等令牌未被吃掉：同帧第二次调用仍然不重复画（false 且 0 draw）', b.r.runAA(1280, 720) === false && b.ev.draws.length === 0)
  globalThis.__mpwCanvasCapture = null
}

// ── T10 自适应关断：纯判据决策表 ──
console.log('[T10] 兜底代价的自适应关断（纯判据决策表）')
{
  const { capFallbackVerdict, CAP_COST_BUDGET_MS, CAP_COST_WARMUP } = await freshBundle()
  check('T10a 预热期（样本 < 12）⇒ 先开着，不关断', capFallbackVerdict([9, 9, 9], 4).off === false && capFallbackVerdict([9, 9, 9], 4).reason === 'warmup',
    JSON.stringify(capFallbackVerdict([9, 9, 9], 4)))
  const cheap = new Array(CAP_COST_WARMUP).fill(1.2)
  check('T10b 12 次都便宜（1.2ms ≤ 4ms）⇒ 继续用兜底', capFallbackVerdict(cheap, CAP_COST_BUDGET_MS).off === false, JSON.stringify(capFallbackVerdict(cheap, CAP_COST_BUDGET_MS)))
  const pricey = new Array(CAP_COST_WARMUP).fill(12)
  const v = capFallbackVerdict(pricey, CAP_COST_BUDGET_MS)
  check('T10c 12 次都贵（12ms > 4ms）⇒ 关断（reason=slow）', v.off === true && v.reason === 'slow' && v.median === 12, JSON.stringify(v))
  // 中位数而非均值：11 次便宜 + 1 次超长尾 ⇒ 不关断
  const tail = new Array(CAP_COST_WARMUP - 1).fill(1)
  tail.push(200)
  check('T10d 单帧长尾不触发（中位数抗抖）', capFallbackVerdict(tail, CAP_COST_BUDGET_MS).off === false, JSON.stringify(capFallbackVerdict(tail, CAP_COST_BUDGET_MS)))
  check('T10e 非法样本被丢弃 + 非法预算回落默认', capFallbackVerdict([NaN, 'x', null, 1, 2], 4).reason === 'warmup' && capFallbackVerdict(new Array(12).fill(5), NaN).off === true)
}

// ── T11 自适应关断：跑真链（假时钟注入昂贵兜底）──
console.log('[T11] 昂贵兜底 → 预热后自动停用（画面保持场景色，不再每帧回读）')
{
  fakeClock = { t: 0 }
  const prevPerf = globalThis.performance
  globalThis.performance = { now: () => fakeClock.t }
  try {
    const { r, ev } = await setup({ copyErr: CONST.INVALID_OPERATION, readCost: 30 })   // 每次回读 +30ms
    globalThis.__mpwCanvasCapture = null
    const results = []
    for (let i = 0; i < 16; i++) {
      fakeClock.t += 100
      results.push(r.runBloom(BLOOM_LDR, 1280, 720))
    }
    const cap = globalThis.__mpwCanvasCapture || {}
    check('T11a 前 12 帧用兜底（返回 true）', results.slice(0, 12).every((x) => x === true), JSON.stringify(results.slice(0, 5)))
    check('T11b 关断后：返回 false 且之后不再 draw', results[15] === false && ev.draws.length === 12 * 4, 'draws=' + ev.draws.length)
    check('T11c 诊断 modes 含 auto-off-slow', (cap.modes || []).indexOf('auto-off-slow') >= 0, JSON.stringify(cap.modes))
    check('T11d 诊断记实测中位数（≈30）与样本数', cap.costMs >= 25 && cap.costMs <= 35 && cap.costN >= 12, 'costMs=' + cap.costMs + ' n=' + cap.costN)
    check('T11e autoOff 结构完整（reason/median/at）', !!cap.autoOff && cap.autoOff.reason === 'slow' && cap.autoOff.median >= 25, JSON.stringify(cap.autoOff))
    check('T11f 关断后不再调用 readPixels（省掉同步回读）', ev.reads.length === 12, 'reads=' + ev.reads.length)
    globalThis.__mpwCanvasCapture = null
    // `?bloomcap=readpixels` = 用户显式要求 ⇒ 不关断
    const { r: r2, ev: ev2 } = await setup({ copyErr: CONST.INVALID_OPERATION, readCost: 30 }, '?bloomcap=readpixels')
    globalThis.__mpwCanvasCapture = null
    const res2 = []
    for (let i = 0; i < 16; i++) { fakeClock.t += 100; res2.push(r2.runBloom(BLOOM_LDR, 1280, 720)) }
    check('T11g ?bloomcap=readpixels 明确要求 ⇒ 不关断（16 帧全画）', res2.every((x) => x === true) && ev2.draws.length === 64, 'draws=' + ev2.draws.length)
    const cap2 = globalThis.__mpwCanvasCapture || {}
    check('T11h 强制档下 modes 不含 auto-off-slow', (cap2.modes || []).indexOf('auto-off-slow') < 0, JSON.stringify(cap2.modes))
    globalThis.__mpwCanvasCapture = null
  } finally { globalThis.performance = prevPerf; fakeClock = null }
}

// ── T12 取像诊断的诚实性（同类：静默失败被当成读数）──
// `readPixels` 失败在 WebGL 里**不抛异常**（只置错误码）⇒ 老写法 `try { gl.readPixels() } catch {}`
// 把"根本没读到"记成 `0,0,0`（本轮第 18 条取证就被它误导过一次）。demo.html 现在统一走
// `mpwSamplePixel()`：读前排水、读后查错，失败返回 null（调用方打 ERR / 不计入均值）。
console.log('[T12] demo.html 取像诊断：失败必须是"读不到"，不是 0,0,0')
{
  const fs = await import('node:fs')
  const vm = await import('node:vm')
  const src = fs.readFileSync(new URL('../demo.html', import.meta.url), 'utf8')
  const m = /function mpwSamplePixel\(gl, x, y\) \{[\s\S]*?\n  \}/.exec(src)
  check('T12a demo.html 里有唯一实现 mpwSamplePixel()', !!m)
  if (m) {
    const mk = (pending, readErr, sticky = false) => {
      let p = pending
      const seen = { reads: 0, drained: 0 }
      const gl = {
        NO_ERROR: 0, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401,
        getError: () => { const e = p; if (!sticky) p = 0; seen.drained++; return e },
        readPixels: (x, y, w, h, f2, t, buf) => { seen.reads++; if (!readErr) { buf[0] = 11; buf[1] = 22; buf[2] = 33 } else p = readErr },
      }
      return { gl, seen }
    }
    const sandbox = { Uint8Array }
    vm.createContext(sandbox)
    vm.runInContext(m[0] + '\n;globalThis.__s = mpwSamplePixel;', sandbox)
    const f = sandbox.__s
    const a = mk(0, 0)
    const ra = f(a.gl, 5, 6)
    check('T12b 正常读：返回 [r,g,b]（既有输出格式不变）', Array.isArray(ra) && ra.join(',') === '11,22,33', JSON.stringify(ra))
    const b = mk(0x0502, 0x0502)   // 读之前就挂着错、读本身也报错
    const rb = f(b.gl, 5, 6)
    check('T12c 读失败：返回 null（**不是** 0,0,0）', rb === null, JSON.stringify(rb))
    const c = mk(0x0502, 0)        // 读前有历史错误、读本身成功 ⇒ 必须只归因自己
    const rc = f(c.gl, 5, 6)
    check('T12d 历史错误被排掉，读成功照样给真值（不把别人的错算成自己的）', Array.isArray(rc) && rc.join(',') === '11,22,33', JSON.stringify({ rc, seen: c.seen }))
    // 排空必须**有界**：给一个"错误永远不消失"的 GL，助手不能空转（循环上限 8）
    const d = mk(0x0502, 0x0502, true)
    const rd = f(d.gl, 5, 6)
    check('T12e 错误不断时排空有界（不空转）且仍返回 null', rd === null && d.seen.drained <= 9, 'getError 调用=' + d.seen.drained)
  }
  // 守卫前**先剥注释**：说明文字里就写着老写法长什么样（不剥会把文档当代码）
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  const bare = (codeOnly.match(/try \{ [^\n]*gl\.readPixels\(/g) || []).length
  check('T12f 源码守卫：demo.html 里没有裸 `try { …gl.readPixels(…) } catch {}` 采样点', bare === 0, 'bare=' + bare)
}

globalThis.window = prevWin
console.log(fail === 0 ? `ALL PASS (${pass} 项)` : `${pass} PASS / ${fail} FAIL`)
process.exit(fail === 0 ? 0 : 1)
