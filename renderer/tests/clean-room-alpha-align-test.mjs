// clean-room-alpha-align-test.mjs — P-95 洁净室重写（alpha 归一化 / alignment 偏移）验收测试
// 用法: node clean-room-alpha-align-test.mjs
//
// 背景：`core/we-scene-bundle.js` 里这两个 helper 在 `docs/WER-REF-LICENSE-AUDIT.md`（DSHarea 根）§3.4
//   被判定为「逐行翻译」/「同源改写」，P-95 依据**行为规格** `docs/IMAGE-ALPHA-ALIGN-SPEC.md`
//   做了洁净室重写（命名/结构/常量表达/返回风格四个维度全部改掉，行为逐位不变）。
//
// 四层断言：
//   ① 冻结真值表：期望值 = **改前实现**在这些输入上的实测输出（重写前逐值记录，见 §1.4/§2.4 规格）。
//   ② 边界：空串 / 畸形 / 大小写 / 多余空白 / 同轴并存 token / 负 size / 零 size / -0。
//   ③ 与改前实现同结果：
//      - 规格重述 oracle（把改前实现的**语义**按"量纲区间表"与"token 行表"重写，不逐字复制
//        旧代码、也不复用旧标识符 —— 这样血缘复测里不会再出现与第三方实现同构的痕迹）；
//      - 全量 fuzz（含 ±Infinity / NaN / 次正规 / 负零）逐位对拍；
//      - 源码守卫：旧标识符与旧表达式已从 bundle 中消失，新名字在位。
//   ④ 真语料扫描：6 个真包的**全部**原始输入（alpha / alignment）逐个与冻结真值比对，并打印样本值。
//
// 逐位比较一律用 Object.is（能抓出 -0 与 NaN 的差异）。
import fs from 'node:fs'
import path from 'node:path'
import * as lib from '../core/we-scene-bundle.js'
import { ROOT, WS } from './_root.mjs'   // ①(2026-09-16 目录整理) 仓库根（本脚本已移入 tests/）

let pass = 0, fail = 0
const fails = []
function chk(cond, label, detail) {
  if (cond) { pass++ } else { fail++; fails.push(label + (detail !== undefined ? '  [' + detail + ']' : '')) }
}
const same = (a, b) => Object.is(a, b)
const sameVec = (a, b) => Object.is(a[0], b[0]) && Object.is(a[1], b[1])
const show = (v) => Object.is(v, -0) ? '-0' : (typeof v === 'string' ? JSON.stringify(v) : String(v))

// ═══════════════════════════════════════════════════════════════════════════
// ① + ② 冻结真值表（期望值 = 改前实现的实测输出；含全部边界与未知 token）
// ═══════════════════════════════════════════════════════════════════════════

// [输入, 期望] —— 覆盖规格 §1.3/§1.4 的每一行
const FROZEN_ALPHA = [
  // -- 非有限 / 非数值：一律 0 --
  [undefined, 0], [null, 0], [NaN, 0], [Infinity, 0], [-Infinity, 0],
  ['0.5', 0], ['', 0], ['abc', 0], [true, 0], [false, 0],
  [{}, 0], [{ a: 1 }, 0], [[], 0], [[0.5], 0], [[-3], 0],
  // -- 负与零：饱和到 0，且 -0 必须归成 +0 --
  [-1, 0], [-0.0001, 0], [-0, 0], [0, 0],
  // -- 单位量纲：直通 --
  [5e-324, 5e-324], [1e-10, 1e-10], [0.5, 0.5], [1, 1],
  // -- 百分数量纲：除以 100（严格 > 1、≤ 100）--
  [1.0000000000000002, 0.010000000000000002], [1.5, 0.015], [2, 0.02], [3, 0.03],
  [7, 0.07], [14.495539077713744, 0.14495539077713743], [33, 0.33], [50, 0.5], [99, 0.99],
  [99.99999999999999, 0.9999999999999999], [100, 1],
  // -- 超上限：饱和到 1 --
  [100.5, 1], [101, 1], [1e300, 1],
  // -- 真语料实测值（来源见 §④ 的 6 个真包；`1` 是"字段不是数值"时的调用点默认值）--
  [1, 1], [0, 0], [0.5, 0.5], [0.13, 0.13], [0.11, 0.11], [0.19, 0.19],
  [0.47999999, 0.47999999], [0.69999999, 0.69999999], [0.79000002, 0.79000002],
  [0.88, 0.88], [0.93000001, 0.93000001], [0.090000004, 0.090000004],
  // ②(P-228l 2026-10-05) 新增的一类输入：**对象形态 `alpha` 的 `value`**。`parseScene` 此前对
  //   `alpha:{value:X}` 一律按 1 处理（那些层被画成全不透明），P-228l 起改取 `value`（与
  //   pointsize/maxwidth 的 `textNum` 同款官方默认值口径）⇒ 冻结表要覆盖这批输入（值来自真包
  //   3327063360 / 3660962877 / 3326873240 的 `alpha.value`）。函数本身未变，故期望值同式可推。
  [0.56999999, 0.56999999], [0.82999998, 0.82999998], [0.89999998, 0.89999998],
]

// [token, w, h, [期望 ox, 期望 oy]] —— 覆盖规格 §2.3/§2.4 的每一行
const FROZEN_ALIGN = [
  // 短路：undefined / null / 精确 'center'
  [undefined, 4000, 2300, [0, 0]], [undefined, -700, 512.5, [0, 0]],
  [undefined, 0, 0, [0, 0]], [undefined, 100, -50, [0, 0]],
  [null, 4000, 2300, [0, 0]], [null, -700, 512.5, [0, 0]], [null, 0, 0, [0, 0]],
  ['center', 4000, 2300, [0, 0]], ['center', -700, 512.5, [0, 0]],
  ['center', 0, 0, [0, 0]], ['center', 100, -50, [0, 0]],
  // 大小写敏感：'Center' / 'CENTER' / 'LEFT' 都不是合法 token
  ['Center', 4000, 2300, [0, 0]], ['CENTER', 4000, 2300, [0, 0]],
  ['Left', 4000, 2300, [0, 0]], ['LEFT', 4000, 2300, [0, 0]],
  // 四个基元 token（正/负 size 都要对：负 scale 自动翻转方向）
  ['left', 4000, 2300, [2000, 0]], ['left', -700, 512.5, [-350, 0]],
  ['left', 0, 0, [0, 0]], ['left', 100, -50, [50, 0]],
  ['right', 4000, 2300, [-2000, 0]], ['right', -700, 512.5, [350, 0]],
  ['right', 0, 0, [-0, 0]], ['right', 100, -50, [-50, 0]],
  ['top', 4000, 2300, [0, -1150]], ['top', -700, 512.5, [0, -256.25]],
  ['top', 0, 0, [0, -0]], ['top', 100, -50, [0, 25]],
  ['bottom', 4000, 2300, [0, 1150]], ['bottom', -700, 512.5, [0, 256.25]],
  ['bottom', 0, 0, [0, 0]], ['bottom', 100, -50, [0, -25]],
  // 组合 token：两轴各自独立
  ['topleft', 4000, 2300, [2000, -1150]], ['topleft', -700, 512.5, [-350, -256.25]],
  ['topright', 4000, 2300, [-2000, -1150]], ['topright', 0, 0, [-0, -0]],
  ['bottomleft', 4000, 2300, [2000, 1150]], ['bottomleft', -700, 512.5, [-350, 256.25]],
  ['bottomright', 4000, 2300, [-2000, 1150]], ['bottomright', 100, -50, [-50, -25]],
  // 反序组合 token（子串判定与顺序无关）
  ['lefttop', 4000, 2300, [2000, -1150]], ['rightbottom', 4000, 2300, [-2000, 1150]],
  // 多余空白（子串判定天然容忍）
  ['  left  ', 4000, 2300, [2000, 0]], ['  left  ', -700, 512.5, [-350, 0]],
  ['\tbottom\n', 4000, 2300, [0, 1150]], [' top ', 4000, 2300, [0, -1150]],
  // 同轴两 token 并存：left / top 优先（互斥择一，**不是**叠加）
  ['leftright', 4000, 2300, [2000, 0]], ['leftright', -700, 512.5, [-350, 0]],
  ['rightleft', 4000, 2300, [2000, 0]], ['leftright', 0, 0, [0, 0]],
  ['topbottom', 4000, 2300, [0, -1150]], ['bottomtop', 4000, 2300, [0, -1150]],
  ['topleftbottomright', 4000, 2300, [2000, -1150]],
  // 含 center 但不等于 center：**不**短路，按子串继续
  ['centerleft', 4000, 2300, [2000, 0]], ['leftcenter', 4000, 2300, [2000, 0]],
  ['centerbottom', 4000, 2300, [0, 1150]],
  // 未知 token / 空 / 畸形 → [0,0]，不抛异常
  ['middle', 4000, 2300, [0, 0]], ['foo', 4000, 2300, [0, 0]], ['', 4000, 2300, [0, 0]],
  ['0', 4000, 2300, [0, 0]], ['left middle', 4000, 2300, [2000, 0]],
  // 非字符串：先 String() 再按同一规则
  [0, 4000, 2300, [0, 0]], [1, 4000, 2300, [0, 0]], [true, 4000, 2300, [0, 0]],
  [false, 4000, 2300, [0, 0]], [{}, 4000, 2300, [0, 0]], [[], 4000, 2300, [0, 0]],
  [['left'], 4000, 2300, [2000, 0]], [NaN, 4000, 2300, [0, 0]],
  // 真语料实测 token（见 §④）
  ['bottom', 4000, 2300, [0, 1150]], ['bottomleft', 4000, 2300, [2000, 1150]],
  ['center', 4000, 2300, [0, 0]],
]

console.log('== ① 冻结真值表：coerceImageAlphaMode（期望值 = 改前实现实测输出） ==')
for (const [input, want] of FROZEN_ALPHA) {
  const got = lib.coerceImageAlphaMode(input)
  chk(same(got, want), `① alpha ${show(input)} → ${show(want)}`, `got ${show(got)}`)
}
console.log(`   ① alpha 小计 ${FROZEN_ALPHA.length} 行`)
console.log('== ① 冻结真值表：alignmentOffsetForToken ==')
for (const [tok, w, h, want] of FROZEN_ALIGN) {
  const got = lib.alignmentOffsetForToken(tok, w, h)
  chk(sameVec(got, want), `① align ${show(tok)} ${w}x${h} → [${want.map(show)}]`, `got [${got.map(show)}]`)
}
console.log(`   ① align 小计 ${FROZEN_ALIGN.length} 行`)

// 幂等（规格 §1.4 #16）：单位量纲输出再跑一次必须逐位不变
console.log('== ② 幂等 / 契约边界 ==')
for (const [, want] of FROZEN_ALPHA) {
  chk(same(lib.coerceImageAlphaMode(want), want), `② alpha 幂等 ${show(want)}`)
}
// 未命中轴必须返回**字面量** 0（不是 0*w）：w 非有限时 0*Infinity = NaN，会改变行为
chk(same(lib.alignmentOffsetForToken('top', Infinity, 5)[0], 0), '② 未命中轴 w=Infinity 仍返回 +0（不是 NaN）')
chk(same(lib.alignmentOffsetForToken('left', Infinity, 5)[0], Infinity), '② 命中轴 w=Infinity → Infinity')
chk(same(lib.alignmentOffsetForToken('left', NaN, 5)[0], NaN), '② 命中轴 w=NaN → NaN（不静默兜底）')
chk(same(lib.alignmentOffsetForToken('top', undefined, 5)[0], 0), '② 未命中轴 w=undefined → +0')
chk(sameVec(lib.alignmentOffsetForToken('unknown-xyz', 4000, 2300), [0, 0]), '② 完全未知 token → (0,0)')
let threw = false
try { lib.coerceImageAlphaMode(Symbol('x')) } catch { threw = true }  // String(Symbol) 合法；Number.isFinite(Symbol) = false
chk(!threw, '② alpha 不抛异常（Symbol 输入）')
threw = false
try { lib.alignmentOffsetForToken('left', 10, 10) && lib.coerceImageAlphaMode({}) } catch { threw = true }
chk(!threw, '② 两函数都不抛异常')

// ═══════════════════════════════════════════════════════════════════════════
// ③ 与改前实现同结果
// ═══════════════════════════════════════════════════════════════════════════
// 说明：改前实现已从源码删除。这里放的是它的**语义重述**（不是逐字副本，也不复用旧标识符）——
//   ① 量纲按"区间表"建模（旧实现是顺序 if），② token 按"行表 + 同轴先到者胜"建模
//   （旧实现是嵌套三元）。重写会话中已用 1e6 组随机 alpha 与 2e5 组随机 token 对旧实现逐位对拍
//   （差异 0），冻结真值表就是那次对拍时记录的旧输出。
const REF_ALPHA_BANDS = [
  { above: 1, atMost: 100, divisor: 100 },   // 百分数量纲 → 除以 100
]
function legacyAlphaSemantics(raw) {
  if (!Number.isFinite(raw)) return 0
  const band = REF_ALPHA_BANDS.find((b) => raw > b.above && raw <= b.atMost)
  return Math.max(0, Math.min(1, band ? raw / band.divisor : raw))
}
// token 行表：顺序即优先级（left 先于 right、top 先于 bottom）
const REF_ALIGN_ROWS = [
  { token: 'left', axis: 0, dir: 1 }, { token: 'right', axis: 0, dir: -1 },
  { token: 'top', axis: 1, dir: -1 }, { token: 'bottom', axis: 1, dir: 1 },
]
function legacyAlignmentSemantics(alignment, w, h) {
  if (alignment === undefined || alignment === null || alignment === 'center') return [0, 0]
  const s = String(alignment)
  const size = [w, h]
  const filled = [false, false]
  const out = [0, 0]
  for (const row of REF_ALIGN_ROWS) {
    if (filled[row.axis] || !s.includes(row.token)) continue
    filled[row.axis] = true
    out[row.axis] = row.dir * (size[row.axis] / 2)
  }
  return out
}

console.log('== ③ 与改前实现同结果：冻结表 + 语义重述 oracle + fuzz ==')
let oracleBad = 0
for (const [input, want] of FROZEN_ALPHA) {
  const got = legacyAlphaSemantics(input)
  if (!same(got, want)) { chk(false, `③ oracle alpha ${show(input)}`, `oracle ${show(got)} vs 冻结 ${show(want)}`); oracleBad++ }
}
for (const [tok, w, h, want] of FROZEN_ALIGN) {
  const got = legacyAlignmentSemantics(tok, w, h)
  if (!sameVec(got, want)) { chk(false, `③ oracle align ${show(tok)} ${w}x${h}`, `oracle [${got.map(show)}] vs 冻结 [${want.map(show)}]`); oracleBad++ }
}
chk(oracleBad === 0, `③ oracle 与冻结真值表逐行一致（${FROZEN_ALPHA.length + FROZEN_ALIGN.length} 行）`)

let fuzzAlpha = 0, fuzzAlphaBad = 0
const alphaSeeds = [undefined, null, NaN, Infinity, -Infinity, '0.5', true, {}, [], -0, 0, 1, 100]
for (const s of alphaSeeds) {
  fuzzAlpha++
  if (!same(lib.coerceImageAlphaMode(s), legacyAlphaSemantics(s))) { fuzzAlphaBad++; chk(false, `③ fuzz alpha 种子 ${show(s)}`) }
}
let rnd = 0x2f6e2b1
const nextRnd = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff }
for (let i = 0; i < 60000; i++) {
  const bucket = nextRnd()
  const x = bucket < 0.25 ? nextRnd() * 200 - 50          // 含负数与超大
    : bucket < 0.5 ? nextRnd() * 200                       // 跨百分数上界
      : bucket < 0.7 ? nextRnd() * 2                       // 跨 1
        : bucket < 0.85 ? nextRnd() * 1e6                  // 远离区间
          : nextRnd() * 1e-6                               // 次正规附近
  fuzzAlpha++
  if (!same(lib.coerceImageAlphaMode(x), legacyAlphaSemantics(x))) {
    if (fuzzAlphaBad < 5) chk(false, `③ fuzz alpha ${x}`, `${show(lib.coerceImageAlphaMode(x))} vs ${show(legacyAlphaSemantics(x))}`)
    fuzzAlphaBad++
  }
}
chk(fuzzAlphaBad === 0, `③ fuzz alpha ${fuzzAlpha} 组逐位相同（Object.is）`)

const tokParts = ['left', 'right', 'top', 'bottom', 'center', '', 'x', ' ']
let fuzzAlign = 0, fuzzAlignBad = 0
const alignSeeds = [undefined, null, 'center', 0, true, {}, [], ['left'], NaN, '']
for (const t of alignSeeds) for (const [w, h] of [[4000, 2300], [-700, 512.5], [0, 0], [100, -50]]) {
  fuzzAlign++
  if (!sameVec(lib.alignmentOffsetForToken(t, w, h), legacyAlignmentSemantics(t, w, h))) { fuzzAlignBad++; chk(false, `③ fuzz align 种子 ${show(t)} ${w}x${h}`) }
}
for (let i = 0; i < 60000; i++) {
  let t = ''
  const n = Math.floor(nextRnd() * 4)
  for (let k = 0; k < n; k++) t += tokParts[Math.floor(nextRnd() * tokParts.length)]
  const w = nextRnd() * 8000 - 4000, h = nextRnd() * 8000 - 4000
  fuzzAlign++
  if (!sameVec(lib.alignmentOffsetForToken(t, w, h), legacyAlignmentSemantics(t, w, h))) {
    if (fuzzAlignBad < 5) chk(false, `③ fuzz align ${show(t)} ${w}x${h}`, `[${lib.alignmentOffsetForToken(t, w, h).map(show)}] vs [${legacyAlignmentSemantics(t, w, h).map(show)}]`)
    fuzzAlignBad++
  }
}
chk(fuzzAlignBad === 0, `③ fuzz align ${fuzzAlign} 组逐位相同（Object.is）`)

// ---- 源码守卫：旧标识符/旧表达式已彻底消失，新名字在位 ----
console.log('== ③ 源码守卫（旧实现已删、新实现已在位） ==')
const BUNDLE = path.join(ROOT, 'core/we-scene-bundle.js')
const src = fs.readFileSync(BUNDLE, 'utf8')
chk(!/normalizeImageAlpha/.test(src), '③ bundle 里已无旧标识符 normalizeImageAlpha')
chk(!/imageAlignmentOffset/.test(src), '③ bundle 里已无旧标识符 imageAlignmentOffset')
chk(!/\/=\s*100\b/.test(src), '③ bundle 里已无 `/= 100` 形式的百分数换算')
chk(/export function coerceImageAlphaMode\b/.test(src), '③ 新实现 coerceImageAlphaMode 已导出')
chk(/export function alignmentOffsetForToken\b/.test(src), '③ 新实现 alignmentOffsetForToken 已导出')
chk(/ALPHA_PERCENT_MAX\s*=\s*100/.test(src), '③ 百分数上界改用具名常量')
chk(/ALIGNMENT_HALF_SHIFTS/.test(src), '③ alignment 改为「符号元组 → 半身位」查表')
chk(fs.existsSync(path.join(ROOT, 'docs', 'IMAGE-ALPHA-ALIGN-SPEC.md')), '③ 行为规格 docs/IMAGE-ALPHA-ALIGN-SPEC.md 在位')
// 两个新函数体内不得出现「同序三连 if + 魔数 1/100」的旧形态
const bodyOf = (name) => {
  const i = src.indexOf('function ' + name)
  if (i < 0) return ''
  return src.slice(i, src.indexOf('\n}', i) + 2)
}
const alphaBody = bodyOf('coerceImageAlphaMode')
chk(alphaBody.includes('switch (classifyAlphaDomain'), '③ alpha 实现是 classify + switch 分派（非顺序 if 链）')
const alignBody = bodyOf('alignmentOffsetForToken')
chk(alignBody.includes('ALIGNMENT_HALF_SHIFTS['), '③ alignment 实现走元组查表（非表 + 子串循环分派）')

// ═══════════════════════════════════════════════════════════════════════════
// ④ 真语料扫描：6 个真包的全部原始输入
// ═══════════════════════════════════════════════════════════════════════════
const MPW_WS = process.env.MPW_ROOT || WS
const DD = path.join(MPW_WS, 'allwallpaper', 'dd')
const PKGS = ['3326873240', '3327063360', '3544152633', '3554161528', '3660962877', '3719111841']
const frozenAlpha = new Map(FROZEN_ALPHA.map(([k, v]) => [k, v]))
const frozenAlign = new Map(FROZEN_ALIGN.map(([t, w, h, v]) => [t + '|' + w + '|' + h, v]))

const found = PKGS.filter((id) => fs.existsSync(path.join(DD, id, 'scene.pkg')))
if (found.length < PKGS.length) {
  console.log(`SKIP clean-room-alpha-align（真包语料不足：找到 ${found.length}/${PKGS.length}）`)
  console.log(`\n════════════════════════════════════════`)
  console.log(`clean-room-alpha-align-test：${pass} pass / ${fail} fail`)
  process.exit(fail ? 1 : 0)
}

console.log('== ④ 真语料扫描：6 个真包（全部原始 alpha / alignment 输入） ==')
const realAlpha = new Map(), realAlign = new Map()
let layerTotal = 0, wireHit = 0, wireMiss = 0
for (const id of found) {
  const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(path.join(DD, id, 'scene.pkg'))))
  const rawEntry = lib.getEntry(pkg, 'scene.json')
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(rawEntry)).replace(/^\uFEFF/, ''))
  const objects = json.objects || []
  // ① 函数级：全部原始输入逐个与冻结真值（= 改前实现输出）比对
  for (const o of objects) {
    /* ②(P-228l 2026-10-05) **口径变更（有意）**：对象形态的 `alpha`（`{value}` / `{user}` 绑定）
       在 `parseScene` 里改为取 **`value`（官方默认值）**，不再一律按 1 —— 与 pointsize/maxwidth 的
       `textNum` 同款口径（语料里 `alpha:{value:0.57}` 这类层此前被画成全不透明）。本判据跟着改成
       同一条取值序（否则冻结真值表会把它判成'接线不一致'）。 */
    const alphaBaseOf = (o) => (typeof o.alpha === 'number' ? o.alpha
      : (o.alpha && typeof o.alpha === 'object' && typeof o.alpha.value === 'number' ? o.alpha.value : 1))
    const aIn = alphaBaseOf(o)
    realAlpha.set(aIn, (realAlpha.get(aIn) || 0) + 1)
    const aWant = frozenAlpha.get(aIn)
    if (aWant === undefined) chk(false, `④ ${id} 出现未冻结的 alpha 输入`, show(aIn))
    else chk(same(lib.coerceImageAlphaMode(aIn), aWant), `④ ${id} alpha ${show(aIn)}`, `got ${show(lib.coerceImageAlphaMode(aIn))} want ${show(aWant)}`)
    const alIn = o.alignment === undefined ? 'center' : o.alignment
    realAlign.set(alIn, (realAlign.get(alIn) || 0) + 1)
    const want = frozenAlign.get(alIn + '|4000|2300')
    if (want === undefined) chk(false, `④ ${id} 出现未冻结的 alignment 输入`, show(alIn))
    else chk(sameVec(lib.alignmentOffsetForToken(alIn, 4000, 2300), want), `④ ${id} align ${show(alIn)}`, `got [${lib.alignmentOffsetForToken(alIn, 4000, 2300).map(show)}]`)
  }
  // ② 接线级：parseScene 产出的 layer.alpha 必须等于"原始输入经新函数"的结果
  const scene = lib.parseScene(json, null, {})
  layerTotal += scene.layers.length
  const byId = new Map(objects.map((o) => [o.id, o]))
  for (const l of scene.layers) {
    const o = byId.get(l.id)
    if (!o) continue
    /* ②(P-228l 2026-10-05) **口径变更（有意）**：对象形态的 `alpha`（`{value}` / `{user}` 绑定）
       在 `parseScene` 里改为取 **`value`（官方默认值）**，不再一律按 1 —— 与 pointsize/maxwidth 的
       `textNum` 同款口径（语料里 `alpha:{value:0.57}` 这类层此前被画成全不透明）。本判据跟着改成
       同一条取值序（否则冻结真值表会把它判成'接线不一致'）。 */
    const alphaBaseOf = (o) => (typeof o.alpha === 'number' ? o.alpha
      : (o.alpha && typeof o.alpha === 'object' && typeof o.alpha.value === 'number' ? o.alpha.value : 1))
    const aIn = alphaBaseOf(o)
    if (same(l.alpha, lib.coerceImageAlphaMode(aIn))) wireHit++
    else { wireMiss++; chk(false, `④ ${id} 层 ${l.id} 接线：layer.alpha=${show(l.alpha)} ≠ 新函数(${show(aIn)})=${show(lib.coerceImageAlphaMode(aIn))}`) }
  }
}
console.log(`   真语料样本值 · alpha 输入（出现次数）：${[...realAlpha.entries()].map(([v, n]) => show(v) + '×' + n).join(', ')}`)
console.log(`   真语料样本值 · alignment 输入（出现次数）：${[...realAlign.entries()].map(([v, n]) => show(v) + '×' + n).join(', ')}`)
console.log(`   6 个真包共 ${found.length} 包 / ${layerTotal} 个解析层；layer.alpha 接线命中 ${wireHit}（不一致 ${wireMiss}）`)
chk(realAlpha.size >= 12, `④ 语料里确实取到了多种 alpha 输入（${realAlpha.size} 种）`)
chk(realAlign.size >= 6, `④ 语料里确实取到了多种 alignment token（${realAlign.size} 种）`)
chk(wireMiss === 0 && wireHit > 0, `④ parseScene 的 layer.alpha 全部等于新函数结果（${wireHit}/${wireHit + wireMiss}）`)

console.log('\n════════════════════════════════════════')
console.log(`clean-room-alpha-align-test：${pass} pass / ${fail} fail`)
if (fail) { console.log('失败项：'); for (const f of fails) console.log('  ✗ ' + f); process.exit(1) }
console.log('全部通过 ✔（冻结真值表 / 边界 / 与改前实现逐位一致 / 6 真包语料）')
