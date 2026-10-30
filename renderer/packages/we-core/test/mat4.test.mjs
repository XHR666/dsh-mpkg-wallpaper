// mat4.test.mjs — row-major / row-vector matrix math: algebra laws, element placement of
// every constructor, the reference's reverse operand order for mat4Multiply, the
// perspective divide in mat4TransformPoint, and the workspace's settled `bindInv × m`
// bone order together with the criterion that decided it.
//
// 说明（中文）：`bindInv × m`（先 bindInv 后 m）不是口味问题，而是 `docs/UNTOUCHED-AREAS.md`
// 用"绕骨骼枢轴的刚性旋转"判过的：正确顺序下顶点与期望位置差 ~1e-5px，反序会把顶点甩到
// 离枢轴几百 px。本文件把那条判据重新跑一遍（见最后一个 test）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bindInvTimesM, mat4Identity, mat4LookAt, mat4Multiply, mat4Ortho, mat4Perspective, mat4RotateZ, mat4Scale, mat4TransformPoint, mat4Translate } from '../src/mat4.js'

/** Textbook row-major product X·Y, computed independently of src/mat4.js. */
function product(X, Y) {
  const out = new Float32Array(16)
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += X[i * 4 + k] * Y[k * 4 + j]
      out[i * 4 + j] = s
    }
  }
  return out
}
const asArray = (m) => Array.from(m, (v) => (Object.is(v, -0) ? 0 : v))

test('mat4Identity / mat4Multiply：存储顺序与"反向操作数"语义', () => {
  assert.deepEqual(asArray(mat4Identity()), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  const a = Float32Array.from({ length: 16 }, (_, i) => i + 1)
  const b = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 20, 30, 40, 1])
  assert.deepEqual(asArray(mat4Multiply(a, b)), asArray(product(b, a)), 'mat4Multiply(a,b) 必须等于 b·a')
  assert.deepEqual(asArray(mat4Multiply(b, a)), asArray(product(a, b)))
  assert.deepEqual(asArray(mat4Multiply(a, mat4Identity())), asArray(a))
  assert.deepEqual(asArray(mat4Multiply(mat4Identity(), a)), asArray(a))
})

test('平移/缩放/旋转的元素位置（行向量：平移在第 4 行）', () => {
  const T = mat4Translate(mat4Identity(), 1, 2, 3)
  assert.deepEqual(asArray(T), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1])
  const S = mat4Scale(mat4Identity(), 2, 3, 4)
  assert.deepEqual(asArray(S), [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1])
  const R = mat4RotateZ(mat4Identity(), Math.PI / 2)
  const c = Math.fround(Math.cos(Math.PI / 2))
  const s = Math.fround(Math.sin(Math.PI / 2))
  assert.deepEqual(asArray(R), [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  // 组合顺序：mat4Translate(m, …) 把平移**放在 m 之前**（结果 = T·m）
  const m = mat4Scale(mat4Identity(), 2, 2, 1)
  assert.deepEqual(asArray(mat4Translate(m, 5, 7, 0)), asArray(product(mat4Translate(mat4Identity(), 5, 7, 0), m)))
})

test('mat4Ortho：x/y/z 的缩放与平移项', () => {
  const o = asArray(mat4Ortho(0, 64, 0, 32, -10000, 10000))
  assert.deepEqual(o, [0.03125, 0, 0, 0, 0, 0.0625, 0, 0, 0, 0, -0.00009999999747378752, 0, -1, -1, 0, 1].map((v) => (Object.is(v, -0) ? 0 : v)))
  const o2 = asArray(mat4Ortho(0, 64, 32, 0, -1, 1))
  assert.equal(o2[0], 0.03125)
  assert.equal(o2[5], -0.0625)
  assert.equal(o2[10], -1)
  assert.equal(o2[12], -1)
  assert.equal(o2[13], 1)
  assert.equal(o2[15], 1)
})

test('mat4Perspective：f/aspect、f、z 项与 -1', () => {
  const p = asArray(mat4Perspective(Math.PI / 2, 1.5, 0.1, 100))
  assert.equal(p[0], Math.fround(1 / 1.5))
  assert.equal(p[5], 1)
  assert.equal(p[11], -1)
  assert.equal(p[15], 0)
  assert.equal(p[10], Math.fround((100 + 0.1) / (0.1 - 100)))
  assert.equal(p[14], Math.fround((2 * 100 * 0.1) / (0.1 - 100)))
})

test('mat4LookAt：基向量按列写入（参考实现的可观测摆放）', () => {
  const v = asArray(mat4LookAt([0, 0, 5], [0, 0, 0], [0, 1, 0]))
  assert.deepEqual(v, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -5, 1])
  const w = asArray(mat4LookAt([1, 2, 5], [0, 0, 0], [0, 1, 0]))
  // eye 方向单位化后 z=[0.1826,0.3651,0.9129]、x=[0.9806,0,-0.1961]、y=[-0.0716,0.9309,-0.3581]
  assert.ok(Math.abs(w[0] - 0.9805806875228882) < 1e-9)
  assert.ok(Math.abs(w[1] - -0.07161148637533188) < 1e-9)
  assert.ok(Math.abs(w[2] - 0.18257418274879456) < 1e-9)
  assert.ok(Math.abs(w[4] - 0) < 1e-9)
  assert.ok(Math.abs(w[5] - 0.930949330329895) < 1e-9)
  // 平移行 = -dot(axis, eye)
  assert.ok(Math.abs(w[12] - 0) < 1e-9)
  assert.ok(Math.abs(w[14] - -5.4772257804870605) < 1e-9)
})

test('mat4TransformPoint：投影式（除以 w）', () => {
  assert.deepEqual(mat4TransformPoint(mat4Identity(), 1, 2, 3), [1, 2, 3])
  const m = mat4Translate(mat4Scale(mat4Identity(), 2, 3, 1), 5, 7, 9)
  assert.deepEqual(mat4TransformPoint(m, 1, 1, 1), [12, 24, 10])
  // 非 1 的 w 会把结果整体缩放（参考实现行为）：w = -3.25 的历史录入
  const p = new Float32Array([10.25, 0.25, -9.75, 3.25, -6.75, 6.25, -3.75, 9.25, -0.75, -10.75, 2.25, -7.75, 5.25, -4.75, 8.25, -1.75])
  const out = mat4TransformPoint(p, 1, 2, 3)
  assert.ok(Math.abs(out[0] - -0.25 / -3.25) < 1e-12)
  assert.ok(Math.abs(out[1] - -24.25 / -3.25) < 1e-12)
  assert.ok(Math.abs(out[2] - -2.25 / -3.25) < 1e-12)
})

test('bindInv × m：本仓定案的骨骼矩阵顺序（先 bindInv，后动画世界矩阵）', () => {
  const P = [10, 20]          // 骨骼枢轴（设计像素）
  const theta = 0.7           // 绕枢轴的刚性旋转
  // bindInv：骨骼局部 → 设计空间 = 平移 +P
  const bindInv = mat4Translate(mat4Identity(), P[0], P[1], 0)
  // 动画世界矩阵（设计空间 → 绕枢轴旋转后的设计空间）= T(-P) · R(θ) · T(+P)
  const anim = product(mat4Translate(mat4Identity(), -P[0], -P[1], 0), product(mat4RotateZ(mat4Identity(), theta), mat4Translate(mat4Identity(), P[0], P[1], 0)))
  const settled = bindInvTimesM(bindInv, anim)
  const reversed = mat4Multiply(bindInv, anim) // = anim · bindInv（反序）
  const c = Math.cos(theta)
  const s = Math.sin(theta)
  let maxSettled = 0
  let maxReversed = 0
  for (const [lx, ly] of [[0, 0], [3, -4], [-12.5, 7.25], [100, 100], [-1, 1]]) {
    const expected = [lx * c - ly * s + P[0], lx * s + ly * c + P[1]]
    const a = mat4TransformPoint(settled, lx, ly, 0)
    const b = mat4TransformPoint(reversed, lx, ly, 0)
    maxSettled = Math.max(maxSettled, Math.hypot(a[0] - expected[0], a[1] - expected[1]))
    maxReversed = Math.max(maxReversed, Math.hypot(b[0] - expected[0], b[1] - expected[1]))
  }
  assert.ok(maxSettled < 1e-4, `bindInv×m 应保距（实测 ${maxSettled}）`)
  assert.ok(maxReversed > 1, `反序必须被同一条判据判否（实测 ${maxReversed}）`)
  // 与"矩阵乘积"的定义对齐：bindInvTimesM(a,b) === a·b（行向量先 a 后 b）
  assert.deepEqual(asArray(settled), asArray(product(bindInv, anim)))
})
