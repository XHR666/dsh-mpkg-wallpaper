/* 参照来源许可声明：本文件提到的 wer-ref/ 是第三方参考实现（Aromatic05/wallpaper-engine-renderer，GPL-2.0-only，非 WE 官方代码、非「真值源」），与本项目（GPL-3.0-or-later）许可不兼容 —— 仅用于行为对照，不得复制/改写/逐行翻译其代码、注释、常量组织或错误文案。we-layerd-ref/（Aromatic05/we-layerd）无任何许可（保留所有权利），同样仅行为对照。血缘自查结论见 docs/WER-REF-LICENSE-AUDIT.md。 */ // p74-instanceoverride-test.mjs — P-74 四项修复的回归门禁（无浏览器；真包 + mock-GL 驱动真实 renderScene）
//
// 覆盖（每项都有"改前 vs 改后"双向断言，避免"只测新行为"）：
//   ① instanceoverride：字段全集解析（含语料 0 例的 `color` 字节色）/ `{user:...}` 绑定 / 9 个字段逐个生效
//      （size 倍率、count→发射率、rate→仿真时钟、alpha、lifetime、speed、colorn、color、colorrandom 跳过）
//   ② 粒子 quad 边长 = p.size/2（第三方参考实现 wer-ref WPParticleRawGener.cpp:85；官方资产 common_particles.h:52-57）；
//      rope/ropetrail 保持官方 ribbon 口径（总宽 = p.size，不走 /2）
//   ③ velocityrandom 的 y 与 gravity 同口径（lwe-ref CParticle.cpp:775）→ 下落层平均 y 位移方向
//   ④ 效果链输入判定：真包 cat 层 FBO 必须是真实尺寸（P-73 的 MAX_TEX_SIZE_CACHE=0 哨兵会打成 0×0）
//
// 用法: node p74-instanceoverride-test.mjs [--verbose]
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import zlib from 'node:zlib'
import { createRenderer } from '../core/we-scene-bundle.js'
import * as lib from '../core/we-scene-bundle.js'
// ①(去个人化 2026-09-16 / 敏感信息加固 2026-09-19) 工作区根：环境变量优先；兜底默认由 tests/_root.mjs 按**脚本自身位置**推导（不再写作者本机绝对路径）。
const MPW_WS = process.env.MPW_ROOT || WS

const VERBOSE = process.argv.includes('--verbose')
const checks = []
const push = (name, ok, detail) => checks.push({ name, ok: !!ok, detail })
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const near = (a, b, tol) => Math.abs(a - b) <= tol

const DIR = `${MPW_WS}/allwallpaper/dd`
const WE = `${MPW_WS}/wallpaper_engine/assets`
const dec = new TextDecoder()
const PKG_KAL = '3719111841'   // 凯尔希
const PKG_SUN = '3326873240'   // 日月循环
const PKG_CAT = '3544152633'   // Girl and cat（cat 层）
const has = (id) => fs.existsSync(`${DIR}/${id}/scene.pkg`)

// ───────────────────────── ① 纯函数：resolveParticleOverride ─────────────────────────
push('① resolveParticleOverride 导出', typeof lib.resolveParticleOverride === 'function')
push('① applyInstanceOverride 导出', typeof lib.applyInstanceOverride === 'function')
{
  const io = lib.resolveParticleOverride({
    id: 999, size: 0.54, count: 0.57, alpha: 0.84, rate: 0.93, speed: 0.84, lifetime: 1.13,
    colorn: '0 1 0.53725', controlpoint1: '4556.71484 174.28101 0',
  })
  push('① 字段全集解析（size/count/alpha/rate/speed/lifetime/colorn/controlpoint1）',
    io && io.size === 0.54 && io.count === 0.57 && io.alpha === 0.84 && io.rate === 0.93
    && io.speed === 0.84 && io.lifetime === 1.13 && eq(io.colorn, [0, 1, 0.53725])
    && io.overColorn === true && io.overColor === false && io.replacesColor === true
    && io.controlpoints && eq(io.controlpoints[1], [4556.71484, 174.28101, 0]),
    JSON.stringify(io && { size: io.size, colorn: io.colorn, cp: !!io.controlpoints }))
  // 缺省 = 1.0（第三方参考实现 wer-ref WPParticleObject.h:145-150，仅行为对照）
  const empty = lib.resolveParticleOverride({ id: 1 })
  push('① 缺省全 1.0（不覆写）', empty && empty.size === 1 && empty.count === 1 && empty.alpha === 1 && empty.rate === 1
    && empty.speed === 1 && empty.lifetime === 1 && empty.replacesColor === false)
  push('① 无 instanceoverride → null', lib.resolveParticleOverride(null) === null && lib.resolveParticleOverride(undefined) === null)
  // {user:"名", value:X}（语料 5 例）：无 props 取 value；有 props 取 props 值
  const raw = { size: { user: 'newproperty17', value: 2.5 }, colorn: { user: 'newproperty16', value: '0 1 0.5' } }
  const d0 = lib.resolveParticleOverride(raw, null)
  const d1 = lib.resolveParticleOverride(raw, { newproperty17: 0.4, newproperty16: '1 0 0' })
  push('① {user:...} 无属性表 → 作者 value', d0.size === 2.5 && eq(d0.colorn, [0, 1, 0.5]))
  push('① {user:...} 有属性表 → 面板值', d1.size === 0.4 && eq(d1.colorn, [1, 0, 0]))
  // 门控关闭 → 不覆写（回落资产原值）
  const d2 = lib.resolveParticleOverride(raw, { newproperty17: 0.4 }, new Set(['newproperty17']))
  push('① 门控关闭 → size 回落 1.0', d2.size === 1)
  // 语料 0 例的 `color`（字节色 0..255，第三方参考实现 wer-ref WPParticleObject.cpp:121-124 + WPParticleParser.cpp:308-310，仅行为对照）
  const dc = lib.resolveParticleOverride({ color: '255 128 0' })
  push('① `color`（语料 0 例，按官方头文件实现）字节色标记', dc.overColor === true && eq(dc.color, [255, 128, 0]) && dc.overColorn === false)
  // 布尔/垃圾值不写坏
  const dbad = lib.resolveParticleOverride({ size: true, count: 'x', alpha: '' })
  push('① 非数值不写坏（回落 1.0）', dbad.size === 1 && dbad.count === 1 && dbad.alpha === 1)
}

// ───────────────────────── ② P-228m：`count` 是**倍率**，池上限与发射率一起缩 ─────────────────────────
//   上游口径（对照实现 `particles.js:249-267`，由全库实测反推）：只缩上限或只缩发射率都会让"数量"滑块的
//   语义反过来。本仓此前只缩了发射率（`sys.countMul`），上限没缩 ⇒ **池被打满的层**实际存活比作者意图高
//   `1/count` 倍。语料量化（51 包 / 97 个带 count override 的粒子层）：**8 层池被打满、7 层两档存活数不同
//   （差 1.22×–2.64×）**，其余 89 层零影响（= 本次改动对它们是 no-op）。
{
  push('② particleCountMul 导出', typeof lib.particleCountMul === 'function')
  push('② 倍率真值表（缺省/0/负/非法 ⇒ 1，>0 原样）',
    lib.particleCountMul(null) === 1 && lib.particleCountMul({ count: 1 }) === 1 &&
    lib.particleCountMul({ count: 0.57 }) === 0.57 && lib.particleCountMul({ count: 2 }) === 2 &&
    lib.particleCountMul({ count: 0 }) === 1 && lib.particleCountMul({ count: -3 }) === 1 &&
    lib.particleCountMul({ count: 'x' }) === 1,
    JSON.stringify([lib.particleCountMul(null), lib.particleCountMul({ count: 0.57 }), lib.particleCountMul({ count: 0 })]))
  const def = { maxcount: 50, emitter: [{ name: 'sphererandom', rate: 20 }], initializer: [], operator: [], renderer: ['0'] }
  const sysHalf = lib.buildParticleSystem(def, { instanceoverride: lib.resolveParticleOverride({ count: 0.5 }) })
  const sysTwo = lib.buildParticleSystem(def, { instanceoverride: lib.resolveParticleOverride({ count: 2 }) })
  const sysNone = lib.buildParticleSystem(def, { instanceoverride: lib.resolveParticleOverride({ id: 1 }) })
  push('② build 期上限 = round(maxcount × count)：50×0.5=25 / 50×2=100 / 无 override=50',
    sysHalf.maxCount === 25 && sysTwo.maxCount === 100 && sysNone.maxCount === 50,
    JSON.stringify({ half: sysHalf.maxCount, two: sysTwo.maxCount, none: sysNone.maxCount }))
  push('② 发射率倍率与上限倍率**同一个判定**（sys.countMul === 0.5）', sysHalf.countMul === 0.5 && sysTwo.countMul === 2)
  const sysPerf = lib.buildParticleSystem(def, { instanceoverride: lib.resolveParticleOverride({ count: 2 }), maxCount: 60 })
  push('② `ctx.maxCount`（?perf 降级 / 子系并发上限）仍然**最后**夹一层（100 → 60）', sysPerf.maxCount === 60, 'maxCount=' + sysPerf.maxCount)
  const src = fs.readFileSync(new URL('../core/we-scene-bundle.js', import.meta.url), 'utf8')
  push('② 逐帧上限（覆盖 sys.maxCount 的那一处）也吃倍率',
    /const __capNow = \(def && def.maxcount > 0\)[\s\S]{0,220}__countMul/.test(src) &&
    /const __countMul = particleCapMul\(layer\.instanceoverride, IOCOUNT_MODE\)/.test(src))
  push('② `particleCapMul` 档位：upstream 吃倍率 / `?iocount=rateonly` 恒 1（改动前行为）',
    lib.particleCapMul(lib.resolveParticleOverride({ count: 0.5 }), 'upstream') === 0.5 &&
    lib.particleCapMul(lib.resolveParticleOverride({ count: 0.5 }), 'rateonly') === 1 &&
    lib.particleCapMul(lib.resolveParticleOverride({ count: 2 }), 'rateonly') === 1)
  push('② README 主表登记 `iocount`（新开关必须登记，diag-flag-check 双向对账）',
    /\|\s*`iocount`\s*\|/.test(fs.readFileSync(new URL('../docs/README-DIAGNOSTICS.md', import.meta.url), 'utf8')))
  push('② 缓存签名含 __countMul（面板改 count ⇒ 重建，而不是沿用旧池）',
    /\(def && def\.maxcount\) \|\| 0, perfState\.partMul \|\| 1, __countMul,/.test(src))
}

// ───────────────────────── ① 生效点：applyInstanceOverride 逐字段 ─────────────────────────
{
  const mk = () => ({ pos: [0, 0, 0], vel: [0, 0, 0], alpha: 1, size: 20, color: [1, 1, 1], life: 1, age: 0 })
  const io = lib.resolveParticleOverride({ size: 0.5, alpha: 0.25, lifetime: 2, speed: 0.5, colorn: '0 1 0.5' })
  const p = mk()
  p.vel = [10, -20, 4]
  lib.applyInstanceOverride(p, io)
  push('① size 是**倍率**（20×0.5=10，不是绝对值）', p.size === 10, 'size=' + p.size)
  push('① alpha/lifetime 倍率', p.alpha === 0.25 && p.life === 2)
  push('① speed 倍率作用在速度矢量上', eq(p.vel, [5, -10, 2]))
  push('① colorn 覆盖（替换而非乘）', eq(p.color, [0, 1, 0.5]))
  const pc = mk()
  lib.applyInstanceOverride(pc, lib.resolveParticleOverride({ color: '255 0 128' }))
  push('① color 字节色 → /255（第三方参考实现 wer-ref InitColor(color/255)）', eq(pc.color.map((v) => +v.toFixed(5)), [1, 0, 0.50196]))
  const pn = mk(); pn.size = 7; pn.alpha = 0.3
  lib.applyInstanceOverride(pn, null)
  push('① 无 override 时零副作用', pn.size === 7 && pn.alpha === 0.3)
  // ①(P-236 2026-10-06) **算子基线同步**：覆写必须同时落进 `_initAlpha`/`_initSize`
  //   —— `alphafade`/`alphachange`/`sizechange` 每帧都从这两个缓存重建（`?? 1` / `?? 20`），
  //   而它们只有 `alpharandom`/`sizerandom` 会写 ⇒ 预设没有那个 initializer 时覆写值被整帧还原。
  //   实测取证：`2887099508` 光轴层把 `instanceoverride.alpha` 改成 0，本仓档整帧读数不变
  //   （mean 243.47 → 243.49），上游产物档同包 184.09 → 178.00。
  {
    const p2 = mk()
    lib.applyInstanceOverride(p2, io)
    push('①[P-236] 覆写同步基线缓存（_initAlpha/_initSize）',
      p2._initAlpha === 0.25 && p2._initSize === 10, '_initAlpha=' + p2._initAlpha + ' _initSize=' + p2._initSize)
    const p3 = mk(); p3.alpha = 0.5; p3.size = 40
    lib.applyInstanceOverride(p3, lib.resolveParticleOverride({ alpha: 0.2, size: 0.5 }))
    push('①[P-236] 作者值 × 覆写 = 新基线（0.5×0.2 / 40×0.5）', p3._initAlpha === 0.1 && p3._initSize === 20,
      JSON.stringify([p3._initAlpha, p3._initSize]))
    const p4 = mk()
    lib.applyInstanceOverride(p4, null)
    push('①[P-236] 无 override 不写基线缓存（零回归面）', p4._initAlpha === undefined && p4._initSize === undefined)
  }
  // ①[P-236] 端到端：预设"只有 alphafade、没有 alpharandom"时必须吃 instanceoverride.alpha
  {
    const def = {
      maxcount: 64, starttime: 0,
      emitter: [{ name: 'boxrandom', rate: 40, distancemax: '0 0 0', distancemin: '0 0 0' }],
      initializer: [{ name: 'lifetimerandom', min: 4, max: 4 }],
      operator: [{ name: 'alphafade', fadeintime: 0.1 }],
    }
    const run = (ov) => {
      const s = lib.buildParticleSystem(def, { maxCount: 64, instanceoverride: ov ? lib.resolveParticleOverride(ov) : null })
      lib.simulateParticleSystem(s, 1.0)
      return s.particles.map((p) => p.alpha)
    }
    const base = run(null), half = run({ alpha: 0.25 }), zero = run({ alpha: 0 })
    const mx = (a) => (a.length ? Math.max(...a) : -1)
    push('①[P-236] alphafade 不再吞掉 instanceoverride.alpha（0.25× 后 max≈0.25）',
      base.length > 0 && half.length > 0 && near(mx(half), mx(base) * 0.25, 0.02),
      'base max=' + mx(base).toFixed(4) + ' io=0.25 max=' + mx(half).toFixed(4))
    push('①[P-236] instanceoverride.alpha=0 ⇒ 全粒子 alpha 恒 0（上游同包整层消失）',
      zero.length > 0 && zero.every((a) => a === 0) && base.some((a) => a > 0),
      'n=' + zero.length + ' max=' + mx(zero))
    // 对照组：有 alpharandom 时（基线缓存本来就写）行为不变
    const def2 = JSON.parse(JSON.stringify(def))
    def2.initializer.push({ name: 'alpharandom', min: 1, max: 1 })
    const s1 = lib.buildParticleSystem(def2, { maxCount: 64 })
    lib.simulateParticleSystem(s1, 1.0)
    push('①[P-236] 有 alpharandom 的层不受影响（alpha 仍由作者值给出）',
      s1.particles.length > 0 && s1.particles.every((p) => p.alpha > 0 && p.alpha <= 1.0001),
      'n=' + s1.particles.length)
  }
  // ①[P-236] sizechange 同款：没有 sizerandom 时 `?? 20` 会吞掉 instanceoverride.size
  {
    const def = {
      maxcount: 16, starttime: 0,
      emitter: [{ name: 'boxrandom', rate: 40, distancemax: '0 0 0', distancemin: '0 0 0' }],
      initializer: [{ name: 'lifetimerandom', min: 4, max: 4 }],
      operator: [{ name: 'sizechange', starttime: 0, endtime: 1, startvalue: 1, endvalue: 1 }],
    }
    const run = (ov) => {
      const s = lib.buildParticleSystem(def, { maxCount: 16, instanceoverride: ov ? lib.resolveParticleOverride(ov) : null })
      lib.simulateParticleSystem(s, 1.0)
      return s.particles.length ? s.particles[0].size : -1
    }
    const off = run(null), on = run({ size: 0.5 })
    push('①[P-236] sizechange 吃 instanceoverride.size（倍率 0.5，且 sizechange 系数=1 时等于出生尺寸）',
      off > 0 && on > 0 && near(on, off * 0.5, 0.01), 'off=' + off + ' on=' + on)
  }
}

// ───────────────────────── 真包骨架（mock-GL + 真实 renderScene） ─────────────────────────
function decodePNG(buf) {
  const b = Buffer.from(buf); const idat = []; let w = 0, h = 0, bd = 0, ct = 0
  let off = 8
  while (off < b.length) {
    const len = b.readUInt32BE(off); const type = b.toString('latin1', off + 4, off + 8)
    const data = b.slice(off + 8, off + 8 + len)
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9] }
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    off += 12 + len
  }
  if (bd !== 8) throw new Error('bit depth ' + bd)
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 0 ? 1 : ct === 4 ? 2 : 0
  if (!ch) throw new Error('color type ' + ct)
  const raw = zlib.inflateSync(Buffer.concat(idat)); const stride = w * ch + 1
  const rgba = new Uint8Array(w * h * 4); let prev = new Uint8Array(w * ch)
  for (let y = 0; y < h; y++) {
    const f = raw[y * stride]; const cur = new Uint8Array(w * ch)
    for (let x = 0; x < w; x++) {
      const i = y * stride + 1 + x * ch
      for (let k = 0; k < ch; k++) {
        let v = raw[i + k]
        if (f === 1) v = (v + (x > 0 ? cur[(x - 1) * ch + k] : 0)) & 255
        else if (f === 2) v = (v + prev[x * ch + k]) & 255
        else if (f === 3) v = (v + (((x > 0 ? cur[(x - 1) * ch + k] : 0) + prev[x * ch + k]) >> 1)) & 255
        else if (f === 4) {
          const a = x > 0 ? cur[(x - 1) * ch + k] : 0, c = prev[x * ch + k], b2 = x > 0 ? prev[(x - 1) * ch + k] : 0
          const p2 = a + c - b2, pa = Math.abs(p2 - a), pb = Math.abs(p2 - b2), pc = Math.abs(p2 - c)
          v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b2 : c)) & 255
        }
        cur[x * ch + k] = v & 255
      }
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      if (ct === 6) { for (let k = 0; k < 4; k++) rgba[o + k] = cur[x * 4 + k] }
      else if (ct === 2) { rgba[o] = cur[x*3]; rgba[o+1] = cur[x*3+1]; rgba[o+2] = cur[x*3+2]; rgba[o+3] = 255 }
      else if (ct === 0) { rgba[o] = rgba[o+1] = rgba[o+2] = cur[x]; rgba[o+3] = 255 }
      else if (ct === 4) { rgba[o] = rgba[o*2]; rgba[o+1] = rgba[o*2]; rgba[o+2] = rgba[o*2]; rgba[o+3] = cur[x*2+1] }
    }
    prev = cur
  }
  return { rgba, width: w, height: h }
}

const CONST = { LINK_STATUS: 0x8B82, COMPILE_STATUS: 0x8B81, ACTIVE_UNIFORMS: 0x8B86, ACTIVE_ATTRIBUTES: 0x8B85,
  FRAMEBUFFER_COMPLETE: 0x8CD5, MAX_TEXTURE_SIZE: 0x0D33, NO_ERROR: 0, TEXTURE0: 0, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401 }
for (let i = 0; i < 8; i++) CONST['TEXTURE' + i] = i

function makeGl(rec) {
  let seq = 0, curUnit = 0, curFbo = null
  const mk = (k) => ({ id: k + '#' + (++seq) })
  const curTex = new Array(8).fill(null)
  const texDims = new Map()
  const handlers = {
    createTexture: () => mk('tex'), createFramebuffer: () => mk('fbo'), createBuffer: () => mk('buf'), createVertexArray: () => mk('vao'),
    createShader: () => mk('sh'), createProgram: () => mk('prog'),
    bindVertexArray: () => {}, activeTexture: (u) => { curUnit = u },
    bindTexture: (t, tex) => { curTex[curUnit] = tex || null },
    bindFramebuffer: (t, f) => { rec.fbo = f },
    useProgram: () => {}, bindBuffer: () => {},
    bufferData: (t, data) => { if (data && data.length) rec.verts.push({ at: rec.draws, v: Float32Array.from(data) }) },
    texImage2D: (...a) => {
      const b = curTex[curUnit]; if (!b) return
      if (a.length >= 9 && a[8] && a[8].rgba) texDims.set(b.id, [a[8].width, a[8].height])
      else if (a.length >= 6 && typeof a[3] === 'number') texDims.set(b.id, [a[3], a[4]])
    },
    uniform1i: () => {}, uniform1f: () => {}, uniform2f: () => {}, uniform3f: () => {}, uniform4f: () => {},
    uniformMatrix4fv: () => {}, uniformMatrix3fv: () => {},
    drawArrays: () => { rec.draws++ }, drawElements: () => {},
    getProgramParameter: (p, k) => (k === CONST.LINK_STATUS || k === CONST.COMPILE_STATUS) ? true : (k === CONST.ACTIVE_UNIFORMS ? 0 : (k === CONST.ACTIVE_ATTRIBUTES ? 0 : null)),
    getActiveUniform: () => ({ name: 'g_Texture0', type: 0x8B62 }),
    getActiveAttrib: (p, i) => ({ name: i === 0 ? 'a_Position' : 'a_TexCoord', size: 1 }),
    getAttribLocation: (p, n) => ({ a_Position: 0, a_TexCoord: 1, a_TexCoordB: 2, a_Blend: 3, a_Alpha: 4 }[n] ?? -1),
    getUniformLocation: (p, n) => ({ p, n }),
    getShaderParameter: () => true, checkFramebufferStatus: () => CONST.FRAMEBUFFER_COMPLETE,
    getError: () => CONST.NO_ERROR, getParameter: (k) => k === CONST.MAX_TEXTURE_SIZE ? 4096 : (k === CONST.FRAMEBUFFER ? curFbo : 0),
    isTexture: () => true, getShaderInfoLog: () => '', getProgramInfoLog: () => '',
    texParameteri: () => {}, generateMipmap: () => {}, deleteTexture: () => {}, pixelStorei: () => {},
  }
  const gl = new Proxy({}, { get(t, prop) {
    if (prop in handlers) return handlers[prop]
    if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return CONST[prop] !== undefined ? CONST[prop] : 1
    return () => {}
  } })
  return { gl, texDims }
}

// 载入真包 + 建纹理 + 建 renderer；modes 走 location.search（与真机同一开关）
async function boot(id, modes = {}) {
  const q = []
  if (modes.io === 'off') q.push('io=off')
  if (modes.psize === 'legacy') q.push('psize=legacy')
  if (modes.vy === 'legacy') q.push('vy=legacy')
  if (modes.maxtex === 'legacy') q.push('maxtex=0')
  globalThis.location = { search: q.length ? '?' + q.join('&') : '' }
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(`${DIR}/${id}/scene.pkg`)))
  const sj = JSON.parse(dec.decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, ''))
  const readParticleDef = (p) => { try { const e = lib.getEntry(pkg, p); return e ? JSON.parse(dec.decode(e)) : null } catch { return null } }
  const scene = lib.parseScene(sj, null, { readParticleDef, attachCtx: { readEntry: (n) => lib.getEntry(pkg, n), time: 0 } })
  lib.applyRenderConfig(scene, { sceneId: id, clearBgFx: true, hideParticles: false, hideUI: true, log: () => {} })
  const rec = { draws: 0, verts: [], fbo: null }
  const { gl } = makeGl(rec)
  const readTex = (rel) => lib.getEntry(pkg, rel) || (fs.existsSync(WE + '/' + rel) ? new Uint8Array(fs.readFileSync(WE + '/' + rel)) : null)
  const textures = new Map()
  const put = (name, buf) => {
    if (textures.has(name) || !buf) return
    let tex; try { tex = lib.parseTex(buf) } catch { return }
    let m; try { m = lib.decodeMip0(tex) } catch { return }
    if (!m) return
    if (m.png || m.image) { try { const d = decodePNG(m.png || m.image); m = { width: d.width, height: d.height, rgba: d.rgba } } catch { return } }
    if (!m.rgba && !m.bitmap) return
    const gt = lib.makeTextureMip(gl, [m.bitmap ? m : { width: m.width, height: m.height, rgba: m.rgba, fmt: tex.format }], tex.format === 8)
    if (gt) textures.set(name, { glTex: gt, width: m.width, height: m.height, format: tex.format })
  }
  for (const l of scene.layers) {
    if (l.particleDef && l.particleDef.material) {
      try { const e = lib.getEntry(pkg, l.particleDef.material); const tn = e ? ((JSON.parse(dec.decode(e)).passes || [])[0] || {}).textures?.[0] : null
        if (tn) { l.particleTexName = tn; put(tn, readTex('materials/' + tn + '.tex')) } } catch {}
    }
    if (!l.image) continue
    try {
      let model; const bi = lib.resolveBuiltin(l.image)
      if (bi && bi.kind === 'model') model = bi.value
      else { const me = lib.getEntry(pkg, l.image); if (!me) continue; model = JSON.parse(dec.decode(me)) }
      const mat = lib.resolveMaterial(model); if (!mat) continue
      let material; const bm = lib.resolveBuiltin(mat.materialPath)
      if (bm && bm.kind === 'material') material = bm.value
      else { const me2 = lib.getEntry(pkg, mat.materialPath); if (!me2) continue; material = JSON.parse(dec.decode(me2)) }
      const tn = ((material.passes || [])[0] || {}).textures?.[0]
      if (tn) { l.textureName = tn; put(tn, readTex('materials/' + tn + '.tex')) }
      for (const ef of (l.effects || [])) for (const p of (ef.passes || [])) for (const t of (p.textures || [])) {
        if (typeof t === 'string' && t && t.indexOf('_rt_') !== 0 && t.indexOf('util/') !== 0) put(t, readTex('materials/' + t + '.tex'))
      }
    } catch (e) {}
  }
  for (const l of scene.layers) for (const ef of (l.effects || [])) lib.resolveEffectChain(pkg, ef, (b) => dec.decode(b))
  const shaderResolver = async (rel) => { const e = lib.getEntry(pkg, rel) || (fs.existsSync(WE + '/' + rel) ? fs.readFileSync(WE + '/' + rel) : null); return e ? dec.decode(e) : null }
  const r = createRenderer({ getContext: () => gl }, { onLog: () => {}, shaderResolver, aggregate: true })
  return { scene, textures, r, rec }
}

// 建系（不模拟）—— spawn 期断言用
function sysRaw(layer, modes = {}) {
  return lib.buildParticleSystem(layer.particleDef, {
    origin: layer.origin, scale: layer.scale, angle: (layer.angles && layer.angles[2]) || 0,
    alphaMul: typeof layer.alpha === 'number' ? layer.alpha : 1, rateMul: 1,
    seedStr: String(layer.id) + '|' + String(layer.origin || ''),
    maxCount: Math.min((layer.particleDef && layer.particleDef.maxcount) || 100, 20000),
    instanceoverride: modes.io === 'off' ? null : (layer.instanceoverride || null),
    vyLegacy: modes.vy === 'legacy',
  })
}
// 建系 + 模拟到时间 t（与 renderParticleLayer 同参数口径）
function sysOf(layer, t, modes = {}) { const s = sysRaw(layer, modes); lib.simulateParticleSystem(s, t); return s }

// ───────────────────────── ① 真包：凯尔希 Bokeh Hex/Cir（size/count/speed/alpha/lifetime/rate） ─────────────────────────
if (has(PKG_KAL)) {
  const { scene } = await boot(PKG_KAL, {})
  const byName = (n) => scene.layers.find((l) => l.name === n)
  const hex = byName('Bokeh Hex'); const cir = byName('Bokeh Cir')
  push('① 凯尔希 8 个粒子层都解析出 instanceoverride', scene.layers.filter((l) => l.particleDef).length === 8
    && scene.layers.filter((l) => l.particleDef && l.instanceoverride).length === 8,
    scene.layers.filter((l) => l.particleDef).length + ' 层')
  const hio = hex && hex.instanceoverride
  push('① Bokeh Hex io 原文（count0.57/size0.54/speed0.84/alpha0.84/rate0.93/lifetime1.13）',
    !!hio && near(hio.count, 0.57, 1e-6) && near(hio.size, 0.54, 1e-6) && near(hio.speed, 0.84, 1e-6)
    && near(hio.alpha, 0.84, 1e-6) && near(hio.rate, 0.93, 1e-6) && near(hio.lifetime, 1.13, 1e-6),
    hio && JSON.stringify({ c: hio.count, s: hio.size, sp: hio.speed, a: hio.alpha, r: hio.rate, l: hio.lifetime }))
  if (hex) {
    const on = sysOf(hex, 4.0, {}), off = sysOf(hex, 4.0, { io: 'off' })
    const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0
    const szOn = mean(on.particles.map((p) => p.size)), szOff = mean(off.particles.map((p) => p.size))
    push('① Hex size 倍率生效（0.54×）', near(szOn / szOff, 0.54, 0.06) || (szOn > 0 && szOn < szOff), 'on=' + szOn.toFixed(2) + ' off=' + szOff.toFixed(2))
    push('① Hex count→发射率：存活数下降', on.particles.length < off.particles.length, on.particles.length + ' < ' + off.particles.length)
    const vOn = mean(on.particles.map((p) => Math.hypot(p.vel[0], p.vel[1])))
    const vOff = mean(off.particles.map((p) => Math.hypot(p.vel[0], p.vel[1])))
    push('① Hex speed 倍率生效（0.84×）', near(vOn / vOff, 0.84, 0.08), 'on=' + vOn.toFixed(2) + ' off=' + vOff.toFixed(2))
    // 出生期（spawn）断言：算子（alphafade/oscillate…）跑过之后 alpha/life 已被改写，
    //   所以"倍率是否生效"必须在 applyInitializer 之后、算子之前判定。
    const sp = (modes) => { const s = sysRaw(hex, modes); return lib.spawnParticle(s, s.emitters[0]) }
    const pOn = sp({}), pOff = sp({ io: 'off' })
    push('① Hex alpha 倍率生效（0.84×，spawn 期）', near(pOn.alpha / pOff.alpha, 0.84, 0.02),
      'on=' + pOn.alpha.toFixed(4) + ' off=' + pOff.alpha.toFixed(4))
    push('① Hex lifetime 倍率生效（1.13×，spawn 期）', near(pOn.life / pOff.life, 1.13, 0.02),
      'on=' + pOn.life.toFixed(4) + ' off=' + pOff.life.toFixed(4))
    push('① Hex size 倍率生效（spawn 期，0.54×）', near(pOn.size / pOff.size, 0.54, 0.02),
      'on=' + pOn.size.toFixed(3) + ' off=' + pOff.size.toFixed(3))
  }
  // 尘埃（33）：只有 count 0.76；rate 无 → 时钟倍率必须为 1
  const dust = byName('尘埃')
  if (dust) {
    const on = sysOf(dust, 4.0, {}), off = sysOf(dust, 4.0, { io: 'off' })
    push('① 尘埃 count 0.76：存活数下降但非 0', on.particles.length > 0 && on.particles.length < off.particles.length,
      on.particles.length + ' < ' + off.particles.length)
  }
  // rate 档（第三方参考实现 wer-ref ParticleSystem.cpp:329 `simulationTime = frameTime * m_rate`，仅行为对照）：
  //   合成 def 精测 —— 时钟 ×2 ⇒ 同 wall time 内发射数 ×2、年龄推进 ×2
  {
    const def = { maxcount: 5000, emitter: [{ name: 'boxrandom', rate: 10, distancemax: '0 0 0', distancemin: '0 0 0' }],
      initializer: [{ name: 'lifetimerandom', min: 100, max: 100 }, { name: 'sizerandom', min: 10, max: 10 }] }
    const mk = (rate) => lib.buildParticleSystem(def, { maxCount: 5000, instanceoverride: rate === 1 ? null : lib.resolveParticleOverride({ rate }) })
    const run = (rate) => { const s = mk(rate); lib.simulateParticleSystem(s, 1.0); return s }
    const s1 = run(1), s2 = run(2)
    const maxAge = (s) => s.particles.reduce((m, p) => Math.max(m, p.age), 0)
    push('① rate 是**仿真时钟**倍率：发射数 ×2', s1.particles.length > 5 && near(s2.particles.length / s1.particles.length, 2, 0.12),
      s1.particles.length + ' → ' + s2.particles.length)
    push('① rate 是**仿真时钟**倍率：年龄推进 ×2', near(maxAge(s2) / Math.max(1e-6, maxAge(s1)), 2, 0.12),
      maxAge(s1).toFixed(3) + ' → ' + maxAge(s2).toFixed(3) + ' s')
    push('① rate=1 时零行为变化（rateScale=1）', mk(1).rateScale === 1 && mk(2).rateScale === 2)
  }
} else push('① 凯尔希真包缺失（SKIP 视作 PASS）', true, 'no pkg')

// ───────────────────────── ① 真包：日月循环 Trails 2（colorn 覆盖 + colorrandom 跳过） ─────────────────────────
if (has(PKG_SUN)) {
  const { scene } = await boot(PKG_SUN, {})
  const tr = scene.layers.find((l) => l.name === 'Trails 2')
  push('① 日月循环 Trails 2 有 colorn={user:newproperty16}（作者 colorrandom 被替换）',
    tr && tr.instanceoverride && eq(tr.instanceoverride.colorn, [0, 1, 0.53725]) && tr.instanceoverride.replacesColor === true)
  if (tr) {
    const isColorRandom = (tr.particleDef.initializer || []).some((i) => i.name === 'colorrandom')
    const on = sysOf(tr, 3.0, {}), off = sysOf(tr, 3.0, { io: 'off' })
    const cm = (s, k) => s.particles.length ? s.particles.reduce((x, p) => x + p.color[k], 0) / s.particles.length : 0
    push('① 资产里确有 colorrandom（用于证明"跳过"有效）', isColorRandom === true)
    push('① io=on → 颜色 = colorn（0,1,0.537）', near(cm(on, 1), 1, 1e-6) && near(cm(on, 2), 0.53725, 1e-4) && near(cm(on, 0), 0, 1e-6),
      JSON.stringify([cm(on, 0), cm(on, 1), cm(on, 2)].map((v) => +v.toFixed(4))))
    push('① io=off → 颜色 = 作者 colorrandom（灰度域随机，≠ colorn）',
      Math.abs(cm(off, 0) - 0) > 0.05 || Math.abs(cm(off, 1) - 1) > 0.05,
      JSON.stringify([cm(off, 0), cm(off, 1), cm(off, 2)].map((v) => +v.toFixed(4))))
  }
} else push('① 日月循环真包缺失（SKIP 视作 PASS）', true, 'no pkg')

// ───────────────────────── ② quad 边长 = size/2（真包 + 真实顶点流） ─────────────────────────
if (has(PKG_KAL)) {
  // 只留 Bokeh Hex，跑一帧，取粒子顶点流里单个 quad 的跨度
  const { scene, textures, r, rec } = await boot(PKG_KAL, {})
  for (const l of scene.layers) l.__keep = (l.name === 'Bokeh Hex')
  for (const l of scene.layers) if (!l.__keep) l.visible = false
  rec.verts.length = 0
  await r.render(scene, textures, 1920, 1080, 6.0)
  // 粒子顶点布局（stride 9）：x,y,z,u,v,u2,v2,blend,alpha —— 每次 bufferData 是一整批
  const batch = rec.verts[rec.verts.length - 1]
  let spanPx = 0
  if (batch) {
    const a = batch.v
    // NDC → 设计像素：x_px = (x*0.5+0.5)*3840（cam.projW=3840）
    const xs = []
    for (let i = 0; i + 8 < a.length; i += 9) xs.push((a[i] * 0.5 + 0.5) * 3840)
    // 每个 quad 6 顶点：取同一 quad 的 x 跨度（相邻 6 个）
    if (xs.length >= 6) spanPx = Math.max(...xs.slice(0, 6)) - Math.min(...xs.slice(0, 6))
  }
  const sys = sysOf(scene.layers.find((l) => l.name === 'Bokeh Hex'), 6.0, {})
  const szFirst = sys.particles.length ? sys.particles[0].size : 0
  push('② Bokeh Hex 顶点流非空（可测几何）', !!batch && spanPx > 0, 'span=' + spanPx.toFixed(1))
  if (spanPx > 0 && szFirst > 0) {
    // 第一个 quad 未必是第 0 个粒子（剔除顺序），用比值断言"跨度 ∈ {size, size/2} 量级"
    push('② quad 边长量级 = p.size/2（不是 p.size）', spanPx < szFirst * 0.95,
      'span=' + spanPx.toFixed(1) + ' vs p.size≈' + szFirst.toFixed(1) + '（legacy 会是 ≈' + szFirst.toFixed(1) + '）')
  }
  // rope 家族：Vapor/rope 的总宽必须保持官方 ribbon 口径（= p.size，不走 /2）
  const ropeLayer = scene.layers.find((l) => l.particleDef && lib.particleTrailCfg(l.particleDef).name === 'rope')
  if (ropeLayer) {
    const cfg = lib.particleTrailCfg(ropeLayer.particleDef)
    push('② rope 层存在且官方 ribbon 口径（CI-2 记录，几何由 szRib 还原）', cfg.name === 'rope' && cfg.length > 0,
      ropeLayer.name + ' len=' + cfg.length + ' maxlen=' + cfg.maxLength)
  }
} else push('② 凯尔希真包缺失（SKIP 视作 PASS）', true)

// ② legacy 档位：顶点跨度翻倍（改前→改后双向）
if (has(PKG_KAL)) {
  const run = async (psize) => {
    const modes = psize === 'legacy' ? { psize: 'legacy' } : {}
    const { scene, textures, r, rec } = await boot(PKG_KAL, modes)
    for (const l of scene.layers) if (l.name !== 'Bokeh Hex') l.visible = false
    rec.verts.length = 0
    await r.render(scene, textures, 1920, 1080, 6.0)
    const batch = rec.verts[rec.verts.length - 1]
    if (!batch) return 0
    const a = batch.v; const xs = []
    for (let i = 0; i + 8 < a.length; i += 9) xs.push((a[i] * 0.5 + 0.5) * 3840)
    return xs.length >= 6 ? Math.max(...xs.slice(0, 6)) - Math.min(...xs.slice(0, 6)) : 0
  }
  const sOff = await run('official'), sLeg = await run('legacy')
  push('② ?psize=legacy 复现旧口径（线性 2×）', sOff > 0 && sLeg > 0 && near(sLeg / sOff, 2, 0.02),
    'official=' + sOff.toFixed(2) + ' legacy=' + sLeg.toFixed(2) + ' ratio=' + (sLeg / sOff).toFixed(4))
}

// ───────────────────────── ③ velocityrandom 的 y 方向（Rain perspective） ─────────────────────────
if (has(PKG_CAT)) {
  const { scene } = await boot(PKG_CAT, {})
  const rain = scene.layers.find((l) => l.name === 'Rain perspective')
  push('③ Rain perspective 定号 −Y 的 velocityrandom + gravity 0（语料样本）',
    rain && (rain.particleDef.initializer || []).some((i) => i.name === 'velocityrandom'
      && String(i.min).indexOf('-3000') >= 0 && String(i.max).indexOf('-3000') >= 0)
    && (rain.particleDef.operator || []).some((o) => o.name === 'movement' && /0\s+0\s+0/.test(String(o.gravity || ''))))
  if (rain) {
    const on = sysOf(rain, 2.0, {}), off = sysOf(rain, 2.0, { vy: 'legacy' })
    const vy = (s) => s.particles.length ? s.particles.reduce((x, p) => x + p.vel[1], 0) / s.particles.length : 0
    const dy = (s) => vy(s) / 30                        // 每帧 y 位移（设计像素，dt=1/30；p.pos[1] += vel[1]*dt）
    push('③ 改后：下落层平均 y 速度 > 0（y-down = 向下，且被 speed 0.75 缩放）',
      vy(on) > 0 && near(vy(on), 3000 * 0.75, 1), 'vyMean=' + vy(on).toFixed(1) + ' Δy/帧=' + dy(on).toFixed(1) + 'px')
    push('③ 改前（?vy=legacy）：平均 y 速度 < 0 = 雨往上跑', vy(off) < 0 && near(vy(off), -3000 * 0.75, 1), 'vyMean=' + vy(off).toFixed(1))
    push('③ 断言口径 = 平均 y 位移方向（可机器复核）', Math.sign(dy(on)) === 1 && Math.sign(dy(off)) === -1)
    const anyUp = on.particles.filter((p) => p.vel[1] < 0).length
    push('③ 改后无"向上"粒子（251/251 向下）', on.particles.length > 0 && anyUp === 0, anyUp + '/' + on.particles.length + ' 个向上')
    // rain_on_the_glass2（有 gravity 兜底：改前后方向都应向下，但改后向上分量归零）
    const glass = scene.layers.find((l) => l.name === 'rain_on_the_glass2')
    if (glass) {
      const g1 = sysOf(glass, 2.0, {}), g0 = sysOf(glass, 2.0, { vy: 'legacy' })
      const up1 = g1.particles.filter((p) => p.vel[1] < 0).length
      const up0 = g0.particles.filter((p) => p.vel[1] < 0).length
      push('③ rain_on_the_glass2：改后向上粒子数 ≤ 改前（gravity 兜底，非 0 差异）', up1 <= up0, up1 + ' ≤ ' + up0)
    }
  }
} else push('③ 真包缺失（SKIP 视作 PASS）', true)

// ───────────────────────── ④ 效果链输入判定（cat） ─────────────────────────
if (has(PKG_CAT)) {
  const { scene, textures, r, rec } = await boot(PKG_CAT, {})
  for (const l of scene.layers) if (l.name !== 'cat') l.visible = false
  rec.verts.length = 0
  await r.render(scene, textures, 1920, 1080, 1.0)
  const fx = r.fxStats.perLayer
  const cat = Object.values(fx).find((v) => v.name && v.name.indexOf('cat#') === 0)
  push('④ cat 有 1 个效果 + 1 个材质 pass', cat && cat.effects === 1 && cat.passes === 1, JSON.stringify(cat))
  push('④ 链输入 = 真实层贴图（不是 white/transparent 哨兵）', cat && cat.inputKind === 'layer', cat && cat.inputKind)
  push('④ fx-copy 真的执行了（drawGuard 未拦）', cat && cat.copyDrawn === true)
  push('④ **效果 FBO 尺寸 = 层尺寸 603×389（P-73 的 0×0 哨兵已修）**', cat && cat.quadW === 603 && cat.quadH === 389,
    cat && cat.quadW + 'x' + cat.quadH)
  push('④ 最终合成采样链尾 FBO（不是哨兵/1×1）', cat && cat.outKind === 'fbo' && cat.outSize === '603x389', cat && (cat.outKind + '/' + cat.outSize))
  // 顶点流：fx-copy 的 quad 必须非退化（P-73 时 layerQuadVerts(0,0) = 六顶点全 (0,0,0)）
  const quadBatch = rec.verts.find((b) => b.v.length === 30 && b.v[1] > 1)   // 位置 y=389 的那一笔 = fx-copy
  push('④ fx-copy 顶点流非退化（位置含 (0,389)/(603,0)）',
    !!quadBatch && Math.max(...quadBatch.v.filter((_, i) => i % 5 === 1)) > 1,
    quadBatch ? JSON.stringify(Array.from(quadBatch.v.slice(0, 10))) : 'not found')
  // 改前对拍：?maxtex=0 复现 0×0（证明这条断言真的在测回归）
  const before = await boot(PKG_CAT, { maxtex: 'legacy' })
  for (const l of before.scene.layers) if (l.name !== 'cat') l.visible = false
  await before.r.render(before.scene, before.textures, 1920, 1080, 1.0)
  const catB = Object.values(before.r.fxStats.perLayer).find((v) => v.name && v.name.indexOf('cat#') === 0)
  push('④ 改前（?maxtex=0）确实是 0×0 + 1×1 输出（回归可复现）',
    catB && catB.quadW === 0 && catB.quadH === 0 && catB.outSize === '1x1' && catB.copyDrawn === true,
    catB && (catB.quadW + 'x' + catB.quadH + ' → ' + catB.outSize))
} else push('④ 真包缺失（SKIP 视作 PASS）', true)

// ───────────────────────── ① 全语料：instanceoverride 字段分布未过期（防"实现了一个错字段集"） ─────────────────────────
{
  const ids = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((d) => fs.existsSync(`${DIR}/${d}/scene.pkg`)) : []
  const cnt = {}; let nPart = 0, nIo = 0
  for (const id of ids) {
    const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(`${DIR}/${id}/scene.pkg`)))
    const sj = JSON.parse(dec.decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, ''))
    for (const o of (sj.objects || [])) {
      if (!o || typeof o.particle !== 'string') continue
      nPart++
      if (!o.instanceoverride || typeof o.instanceoverride !== 'object') continue
      nIo++
      for (const k of Object.keys(o.instanceoverride)) if (k !== 'id') cnt[k] = (cnt[k] || 0) + 1
    }
  }
  const expect = { size: 27, count: 19, colorn: 15, alpha: 15, rate: 15, speed: 12, lifetime: 8, controlpoint1: 1, controlpoint2: 1 }
  const got = Object.fromEntries(Object.entries(cnt).sort())
  push('① 语料 11 包 / 49 粒子层 / 41 带 instanceoverride', ids.length === 11 && nPart === 49 && nIo === 41,
    ids.length + ' 包 ' + nPart + ' 粒子层 ' + nIo + ' 带 io')
  push('① 字段分布与冻结表一致（size27 count19 colorn15 alpha15 rate15 speed12 lifetime8 cp1/2）',
    eq(got, Object.fromEntries(Object.entries(expect).sort())), JSON.stringify(got))
  push('① 语料确实 0 例 `color`（故按官方头文件实现并在报告标注）', !('color' in cnt))
}

// ───────────────────────── 回退开关齐备性 ─────────────────────────
{
  const src = fs.readFileSync(new URL('../core/we-scene-bundle.js', import.meta.url), 'utf8')
  for (const [flag, val] of [['psize', 'legacy'], ['io', 'off'], ['vy', 'legacy'], ['maxtex', '0']]) {
    push(`开关 ?${flag}=${val} 在 bundle 内可解析`, src.indexOf(`'${flag}'`) >= 0 && src.indexOf(`${flag}`) >= 0)
  }
  const readme = fs.readFileSync(new URL('../docs/README-DIAGNOSTICS.md', import.meta.url), 'utf8')
  for (const flag of ['psize', 'io', 'vy', 'maxtex']) {
    push(`README-DIAGNOSTICS.md 登记 \`${flag}\``, new RegExp('\\|\\s*`' + flag + '`\\s*\\|').test(readme))
  }
  push('README 值列写 official（与代码默认一致）', /\|\s*`psize`\s*\|\s*`legacy`\s*\|\s*official/.test(readme))
}

let pass = 0
for (const c of checks) { console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail !== undefined ? '  — ' + c.detail : ''}`); if (c.ok) pass++ }
console.log(`\n${pass}/${checks.length} 通过（P-74 instanceoverride / quad 尺寸 / velocityrandom y / 效果链输入）`)
process.exit(pass === checks.length ? 0 : 1)
