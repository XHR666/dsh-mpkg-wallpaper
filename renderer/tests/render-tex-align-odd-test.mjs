// render-tex-align-odd-test.mjs —— ①(2026-09-24 任务 ⑭) **RG8 紧密行距 vs UNPACK_ALIGNMENT** 门禁
//
// 现象（真机 WebGL2/Adreno 830）：
//   `⚠ [we-scene] 纹理上传报错 0x502 materials/masks/waterflow_mask_ddad9b3a.tex 1245x433`
//   `⚠ 纹理上传降档 masks/shake_mask_557be9a9 1169x726 → 1024x636（1169x726(0x502) → 1024x636）`
//   （同样的还有 263x124 / 365x251 / 767x786）
//
// 根因（**不是"太大了"**）：格式 8（RG88）纹理走 `makeTextureMip` 的 RG8/RG 上传分支，缓冲是
//   `w*h*2` 的**紧密**行距（每行 2w 字节），而 WebGL 的缺省 `UNPACK_ALIGNMENT = 4` ⇒ 每行被要求补齐到
//   4 的倍数。**宽为奇数**时 `2w ≡ 2 (mod 4)`：驱动按对齐算出的需求比提供的缓冲每行多 2 字节
//   ⇒ `texImage2D` 抛 `INVALID_OPERATION (0x502)`（规范行为；与 MAX_TEXTURE_SIZE / 显存无关）。
//   因此"降档到 1024x636 就好了"只是**副作用**：1024 是偶数、行距自然 4 对齐 —— 尺寸根本没超限。
//
// 真机读数的**逐张对账**（本档 [D] 段在真实语料上重算）：`0923/2887099508` 里格式 8 且宽为奇数的
//   mask 恰好 15 张，报错名单是它的子集；同尺寸的格式 9（走 RGBA 路径，`4w` 恒 4 对齐）与偶数宽的
//   格式 8 全部上传正常。
//
// [A] mock-GL **按 WebGL2 的 pixel-store 规则**判定（对齐行距 × 高度 > 提供的字节数 ⇒ 置 0x502）：
//     修后奇数宽 RG8 上传零错、**不上降档阶梯**、上传尺寸保持原尺寸；偶数宽一次 pixelStorei 都不发
//     （零错路径的 GL 调用序列与改动前逐位一致 —— `tests/tex-upload-guard-test.mjs` 的冻结基线同口径）。
// [B] 反例（**改回去必红**）：同一 mock 上"按改动前的方式"直接上传（或不发 pixelStorei 的等价夹具）
//     ⇒ 必须判 0x502 且 `__mpwUploadErr`/`__mpwTexUploadErrs` 如实记账。若有人把修法撤掉，
//     [A] 组的断言会走到这条路径 ⇒ 变红。
// [C] RGBA 路径（格式 9/5 与所有位图）不受影响：奇数宽也零错、且不碰 UNPACK_ALIGNMENT。
// [D] 真实语料对账（缺包 SKIP）：报错的尺寸集合 == "格式 8 ∧ 宽为奇数"。

import fs from 'node:fs'
import path from 'node:path'
import { WS } from './_root.mjs'
import { parseTex, decodeMips, makeTextureMip, makeTextureMipGuarded } from '../core/we-scene-bundle.js'

let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; console.log('  ✗ ' + name + (detail !== undefined ? ' — ' + detail : '')) }
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want))

/* ══════════════ mock-GL：按 WebGL2 pixel-store 规则判定 ══════════════ */
let pendingErr = 0
function mkGL(opts = {}) {
  const calls = []
  let align = 4
  const trackStore = opts.trackStore !== false   // false = 夹具模拟"pixelStorei 无效/不存在"的旧世界
  const gl = {
    TEXTURE_2D: 3553, TEXTURE_WRAP_S: 10242, TEXTURE_WRAP_T: 10243, CLAMP_TO_EDGE: 33071,
    LINEAR: 9729, TEXTURE_MIN_FILTER: 10241, TEXTURE_MAG_FILTER: 10240,
    RGBA: 6408, UNSIGNED_BYTE: 5121, RG8: 0x822B, RG: 0x8227, NO_ERROR: 0, UNPACK_ALIGNMENT: 0x0CF5,
    createTexture: () => ({ __tok: 'tex' }),
    bindTexture: () => {}, texParameteri: () => {}, generateMipmap: () => {}, deleteTexture: () => {},
    pixelStorei: (p, v) => { calls.push(['pixelStorei', p, v]); if (trackStore && p === gl.UNPACK_ALIGNMENT) align = v },
    texImage2D: (...a) => {
      // 两种调用形态：9 参（w/h/format/type/px）与 6 参（bitmap）
      const nine = a.length === 9
      const w = nine ? a[3] : 0, h = nine ? a[4] : 0, fmt = nine ? a[6] : null, px = a[a.length - 1]
      calls.push(['texImage2D', a.length, a[2], w, h, fmt, px && px.length])
      if (!nine || !px || typeof px.length !== 'number') return
      const rowBytes = fmt === gl.RG ? w * 2 : w * 4
      const stride = Math.ceil(rowBytes / align) * align
      if (stride * h > px.length) pendingErr = 0x502      // ← 真驱动的规则：越界/不足 ⇒ INVALID_OPERATION
    },
    getError: () => { const e = pendingErr; pendingErr = 0; return e },
  }
  return { gl, calls, alignOf: () => align }
}
const mkLevel = (w, h) => ({ width: w, height: h, rgba: new Uint8Array(w * h * 4), fmt: 8 })

/* ══════════════ [A] 修后：奇数宽 RG8 零错 / 不上阶梯 / 保持原尺寸 ══════════════ */
console.log('== [A] 奇数宽 RG8（真机报错尺寸）上传 ==')
{
  for (const [w, h, why] of [[1169, 726, 'shake_mask_557be9a9'], [1245, 433, 'waterflow_mask_ddad9b3a'], [263, 124, 'shake_mask'], [365, 251, 'shake_mask'], [767, 786, 'shake_mask']]) {
    const { gl, calls, alignOf } = mkGL()
    const up = makeTextureMipGuarded(gl, [mkLevel(w, h)], true, { where: 'materials/masks/' + why + '.tex' })
    const stores = calls.filter((c) => c[0] === 'pixelStorei')
    check('[A1] ' + why + ' ' + w + 'x' + h + '（格式 8，宽为奇数）⇒ 上传零错、原尺寸、未降档',
      up.ok === true && up.gerr === 0 && up.w === w && up.h === h && up.attempts.length === 1,
      JSON.stringify({ ok: up.ok, gerr: up.gerr, up: up.w + 'x' + up.h, attempts: up.attempts }))
    eq('[A2] ' + w + 'x' + h + '：上传前置 UNPACK_ALIGNMENT=1、上传后恢复 4',
      stores.map((c) => c[2]), [1, 4])
    eq('[A3] ' + w + 'x' + h + '：上传后 GL 状态回到缺省对齐', alignOf(), 4)
  }
}

/* ══════════════ [B] 反例：撤掉修法 ⇒ 同一个 mock 必判 0x502（改回去必红） ══════════════ */
console.log('== [B] 反例（改动前行为）==')
{
  // B1：夹具把 pixelStorei 变成"无效"（= 改动前代码根本不发它）⇒ 必须复现 0x502 + 如实记账
  const { gl } = mkGL({ trackStore: false })
  globalThis.__mpwTexUploadErrs = 0
  const tex = makeTextureMip(gl, [mkLevel(1169, 726)], true, 'materials/masks/shake_mask_557be9a9.tex')
  eq('[B1] 改动前路径（行距 2 字节不对齐 + 缺省对齐 4）⇒ 0x502', tex.__mpwUploadErr, 0x502)
  check('[B2] 错因/尺寸进诊断面（__mpwTexUploadErrLast）',
    globalThis.__mpwTexUploadErrLast && globalThis.__mpwTexUploadErrLast.err === 0x502 && globalThis.__mpwTexUploadErrLast.w === 1169,
    JSON.stringify(globalThis.__mpwTexUploadErrLast))
  check('[B3] 累计计数 __mpwTexUploadErrs ≥ 1', globalThis.__mpwTexUploadErrs >= 1, String(globalThis.__mpwTexUploadErrs))
  // B4：同一尺寸偶数宽 ⇒ 旧路径也不报错（证明判据跟"奇偶"走，不是跟"大小"走）
  const g2 = mkGL({ trackStore: false })
  const tex2 = makeTextureMip(g2.gl, [mkLevel(1168, 726)], true, 'even')
  eq('[B4] 对照：1168x726（宽为偶数）在改动前路径上零错 ⇒ 根因是行距对齐而非尺寸', tex2.__mpwUploadErr, 0)
}

/* ══════════════ [C] 偶数宽 RG8 / RGBA 路径：一次 pixelStorei 都不发（零错路径逐位不变） ══════════════ */
console.log('== [C] 不触碰 GL 状态的路径 ==')
{
  const a = mkGL()
  const upA = makeTextureMipGuarded(a.gl, [mkLevel(64, 32)], true, { where: 'even-rg8' })
  check('[C1] 64x32 RG8（宽为偶数）⇒ 零错且**不发** pixelStorei（tex-upload-guard 冻结基线的同口径）',
    upA.ok === true && a.calls.every((c) => c[0] !== 'pixelStorei'), JSON.stringify(a.calls.map((c) => c[0])))
  const b = mkGL()
  const upB = makeTextureMipGuarded(b.gl, [mkLevel(1245, 433)], false, { where: 'rgba-odd' })
  check('[C2] 1245x433 RGBA 路径（格式 9/5）⇒ 零错、不发 pixelStorei（4w 恒 4 对齐）',
    upB.ok === true && b.calls.every((c) => c[0] !== 'pixelStorei'), JSON.stringify({ ok: upB.ok, calls: b.calls.map((c) => c[0]) }))
}

/* ══════════════ [D] 真实语料对账：报错集合 == 格式 8 ∧ 宽为奇数 ══════════════ */
console.log('== [D] 真包 0923/2887099508：格式 8 ∧ 宽为奇数 ==')
{
  const pkgPath = path.join(process.env.MPW_ROOT || WS, 'allwallpaper', '0923', '2887099508', 'scene.pkg')
  if (!fs.existsSync(pkgPath)) { console.log('  SKIP 缺包 ' + pkgPath) }
  else {
    const { readIndexHead, readEntryBytes } = await import('./_pkg-index.mjs')
    const idx = readIndexHead(pkgPath, 64 << 20)
    const names = idx.entries.map((e) => e.name).filter((n) => /^materials\/masks\/.*\.tex$/i.test(n))
    const odd8 = [], bad = []
    for (const n of names) {
      const e = idx.entries.find((x) => x.name === n)
      let t = null
      try { t = parseTex(new Uint8Array(readEntryBytes(pkgPath, idx, e))) } catch (err) { continue }
      if (t.format === 8 && (t.width % 2) === 1) odd8.push({ n, w: t.width, h: t.height })
    }
    check('[D1] 语料里"格式 8 ∧ 宽为奇数"的 mask 共 15 张（真机报错名单的母集）', odd8.length === 15, String(odd8.length))
    for (const [nm, w, h] of [['waterflow_mask_ddad9b3a', 1245, 433], ['shake_mask_557be9a9', 1169, 726]]) {
      check('[D2] 真机报错的那张在集合里且尺寸逐位相同：' + nm + ' ' + w + 'x' + h,
        odd8.some((x) => x.n.indexOf(nm) >= 0 && x.w === w && x.h === h), JSON.stringify(odd8.filter((x) => x.n.indexOf(nm.split('_').pop()) >= 0)))
    }
    // 解码这两张真纹理 → 走修后的上传路径（mock 规则）⇒ 必须零错且保持原尺寸
    for (const nm of ['waterflow_mask_ddad9b3a', 'shake_mask_557be9a9']) {
      const e = idx.entries.find((x) => x.name.indexOf(nm) >= 0)
      if (!e) { check('[D3] 真纹理 ' + nm + ' 存在', false, 'entries 里找不到'); continue }
      const tex = parseTex(new Uint8Array(readEntryBytes(pkgPath, idx, e)))
      const mips = decodeMips(tex)
      const { gl } = mkGL()
      const up = makeTextureMipGuarded(gl, mips, tex.format === 8, { where: 'materials/masks/' + nm + '.tex' })
      check('[D3] 真纹理 ' + nm + ' ' + tex.width + 'x' + tex.height + '（解码 mip0 可解）⇒ 修后零错、原尺寸',
        mips && mips.length > 0 && up.ok === true && up.gerr === 0 && up.w === tex.width && up.h === tex.height,
        JSON.stringify({ mips: mips && mips.length, fmt: tex.format, up: up.w + 'x' + up.h, gerr: up.gerr, attempts: up.attempts }))
    }
    void bad
  }
}

console.log('\n══ render-tex-align-odd-test：PASS=' + pass + ' FAIL=' + fail)
process.exit(fail ? 1 : 0)
