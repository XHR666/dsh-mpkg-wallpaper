// tex-container-variant-test.mjs —— `.tex` 容器魔数**两种版式**的判据（2026-09-22）
//
// 事故：语料实测 231 张 `.tex` 里有 **30 张**（全部 `materials/lut/`，`flags=0x42`）在 TEXI 头之后
// **多一个 u32** ⇒ `TEXB000x` 魔数落在偏移 **50** 而不是 46。旧解析器按固定偏移读 ⇒ 这 30 张**必然抛错**
// （LUT 拿不到贴图 ⇒ 整条效果链静默降级）。修法：在固定字段之后**有界搜索**魔数（`findTexbMagic`），
// format/flags 位置两种版式一致，因此只需把"剩下几个字段"与魔数之间的距离变成可搜索的。
//
// 判据：
//   A 合成夹具：把一张**正常版式**的真实文件在 TEXB 前**插入 4 字节**造成变体 ⇒ 两者必须解析出**同一份摘要**
//     （证明"两种版式等价"，而不是"能跑就行"）
//   B 语料全量：`$MPW_ROOT/wallpaper_engine/assets/materials/**/*.tex` **0 失败**（语料不在本机 ⇒ 明确 SKIP）
//   C 不回归：偏移 46 的那些文件仍定位在 46（搜索**不会**挪动正常文件），且解析结果可重复
//   D 分辨力自证：变体文件在偏移 46 处**不是** `TEXB` ⇒ 旧固定偏移写法必然抛错；并断言源码里固定偏移
//     读法已不存在（改回去必红）
//
// 运行：node tests/tex-container-variant-test.mjs   （全过输出 ALL PASS；SKIP 不算失败）
import fs from 'node:fs'
import path from 'node:path'
import { WS } from './_root.mjs'
import { parseTex } from '../core/we-scene-bundle.js'

let pass = 0, fail = 0, skip = 0
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')) } else { fail++; console.log('  ✗ ' + n + (d ? '  [' + d + ']' : '')) } }
const sk = (n, why) => { skip++; console.log('  – SKIP ' + n + ' —— ' + why) }

const MAT = process.env.MPW_TEX_ROOT || path.join(WS, 'wallpaper_engine', 'assets', 'materials')
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)])
const texbAt = (buf) => { const i = buf.subarray(0, 80).indexOf('TEXB'); return i }
/** 解析结果的**规范摘要**（只取跨版式应有相同语义的字段）。 */
const sum = (t) => JSON.stringify({ c: t.containerMagic, cv: t.containerVersion, fmt: t.format, flags: t.flags, w: t.width, h: t.height, n: (t.images || []).length, files: (t.images || []).map((i) => i.format) })

console.log('== A 合成夹具：正常版式 vs 变体（插入 4 字节）必须同摘要 ==')
let corpus = []
try { corpus = walk(MAT).filter((f) => f.endsWith('.tex')) } catch (e) { corpus = [] }
const normalFile = corpus.find((f) => texbAt(fs.readFileSync(f)) === 46)
if (!normalFile) {
  sk('A 合成夹具', '本机没有偏移 46 的语料样本（' + MAT + '）')
} else {
  const base = fs.readFileSync(normalFile)
  const at = texbAt(base)
  // 变体 = 在 TEXB 之前插入 4 字节（模拟 lut 版式多出来的那个 u32）
  const variant = Buffer.concat([base.subarray(0, at), Buffer.from([0x4a, 0x3c, 0x00, 0x00]), base.subarray(at)])
  ok('A1 夹具构造正确（正常在 46，变体被推到 50）', texbAt(base) === 46 && texbAt(variant) === 50,
    JSON.stringify({ base: texbAt(base), variant: texbAt(variant) }))
  let a = null, b = null, err = null
  try { a = parseTex(new Uint8Array(base)) } catch (e) { err = 'base: ' + e.message }
  try { b = parseTex(new Uint8Array(variant)) } catch (e) { err = (err ? err + ' | ' : '') + 'variant: ' + e.message }
  ok('A2 两种版式都能解析（不再抛"未知 TEXB 容器"）', !!a && !!b, err || '')
  ok('A3 两种版式的**摘要逐字段相同**（容器/版本/格式/尺寸/图数/每图格式）',
    !!a && !!b && sum(a) === sum(b), a && b ? sum(a) : '')
  ok('A4 变体文件的偏移 46 处**不是** TEXB ⇒ 旧的固定偏移写法必然抛错（这正是修的那条）',
    String.fromCharCode(variant[46], variant[47], variant[48], variant[49]) !== 'TEXB',
    JSON.stringify(variant.subarray(46, 50).toString('latin1')))
  // 坏魔数：保持原有报错口径（不是崩溃/静默）
  const broken = Buffer.from(variant); broken[50] = 0x00
  let thrown = ''
  try { parseTex(new Uint8Array(broken)) } catch (e) { thrown = String(e.message) }
  ok('A5 魔数被破坏 ⇒ 仍按原口径抛"未知 TEXB 容器"（不静默、不崩）', /未知 TEXB 容器/.test(thrown), thrown.slice(0, 60))
}

console.log('\n== B 语料全量：0 失败 ==')
if (corpus.length === 0) sk('B 语料全量', '本机没有 ' + MAT)
else {
  const failNames = []
  let variantN = 0, normalN = 0, repeatMismatch = 0
  for (const f of corpus) {
    const buf = new Uint8Array(fs.readFileSync(f))
    const at = texbAt(Buffer.from(buf))
    if (at === 50) variantN++; else if (at === 46) normalN++
    try {
      const t1 = parseTex(buf)
      const t2 = parseTex(buf)                       // C 段：可重复
      if (sum(t1) !== sum(t2)) repeatMismatch++
    } catch (e) { failNames.push(path.basename(f) + ': ' + String(e.message).slice(0, 40)) }
  }
  ok('B1 全部 .tex 解析成功（0 失败）', failNames.length === 0,
    '总 ' + corpus.length + ' / 偏移46 ' + normalN + ' / 偏移50 ' + variantN + ' / 失败 ' + failNames.length
    + (failNames.length ? '  ' + JSON.stringify(failNames.slice(0, 3)) : ''))
  ok('B2 语料里确实存在偏移 50 的变体（否则这条门禁没有对象）', variantN > 0, '偏移50 = ' + variantN)
  ok('C1 同一份输入解析两次摘要一致（确定性）', repeatMismatch === 0, '不一致 ' + repeatMismatch)
}

console.log('\n== D 分辨力自证：改回固定偏移必红 ==')
{
  const SRC = fs.readFileSync(new URL('../core/we-scene-bundle.js', import.meta.url), 'utf8')
  ok('D1 源码里有有界搜索辅助 `findTexbMagic`（带 9 字节魔数校验）',
    /function findTexbMagic\(buf, from, limit = 40\)/.test(SRC) && /buf\[i \+ 8\] !== 0x00/.test(SRC))
  ok('D2 源码里**不再**按固定偏移直接读容器魔数（旧写法 = `const containerMagic = asciiTex(buf, p, 9)` 紧跟 ignored 字段）',
    !/p \+= 4 \/\/ ignored[^\n]*\n\n  const containerMagic = asciiTex\(buf, p, 9\)/.test(SRC))
  ok('D3 搜索是**有界**的（limit 默认 40；不扫整段像素数据）',
    /findTexbMagic\(buf, p\)/.test(SRC) && /from \+ limit/.test(SRC) && /buf\.length - 9/.test(SRC))
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败' + (skip ? ', ' + skip + ' SKIP' : ''))
if (fail === 0) console.log('✓ .tex 容器变体通过：两种版式同摘要 / 语料全量 0 失败 / 决定性 / 有界搜索 / 有分辨力')
process.exit(fail > 0 ? 1 : 0)
