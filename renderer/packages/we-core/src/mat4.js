// mat4.js — 4×4 matrices in the convention this workspace settled on:
//
//   · storage: `Float32Array(16)`, **row-major** (element [row*4+col])
//   · vectors: **row vectors**, v' = v · M, column 4 = translation for affine matrices
//     (translation lives in indices 12, 13, 14)
//
// Independent implementation from that written convention (docs/WE-CORE-PLAN.md §1.2,
// docs/UNTOUCHED-AREAS.md §"g_Bones 组装顺序", docs/VIDEO-AND-TWITCH-RESEARCH.md) and the
// standard orthographic/perspective/look-at definitions. The observable behaviour was
// additionally pinned by black-box comparison — see PROVENANCE.md §3.
//
// ⚠ `mat4Multiply(a, b)` follows the reference renderer's operand order, which is the
// *reverse* of the usual textbook reading: it returns the matrix product `b · a`, i.e. for
// a row vector `v`, `b` is applied first and `a` second (v · (b · a) = (v · b) · a). The
// name is kept because callers in this workspace already read it that way; the algebra is
// spelled out here so nobody has to guess.

const TMP = new Float32Array(16)

/** Identity matrix. */
export function mat4Identity() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
}

/**
 * Matrix product `b · a` (row-major indexing, both inputs row-major).
 * For row vectors this composes "apply `b` first, then `a`".
 */
export function mat4Multiply(a, b) {
  const out = new Float32Array(16)
  for (let i = 0; i < 4; i++) {
    const b0 = b[i * 4]
    const b1 = b[i * 4 + 1]
    const b2 = b[i * 4 + 2]
    const b3 = b[i * 4 + 3]
    for (let j = 0; j < 4; j++) {
      out[i * 4 + j] = b0 * a[j] + b1 * a[4 + j] + b2 * a[8 + j] + b3 * a[12 + j]
    }
  }
  return out
}

/** Translation by (x, y, z) composed *before* `m` (returns T · m). */
export function mat4Translate(m, x, y, z) {
  return mat4Multiply(m, new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]))
}

/** Scale by (sx, sy, sz) composed *before* `m` (returns S · m). */
export function mat4Scale(m, sx, sy, sz) {
  return mat4Multiply(m, new Float32Array([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1]))
}

/** Rotation about +Z by `rad`, composed *before* `m` (returns R · m). */
export function mat4RotateZ(m, rad) {
  const c = Math.cos(rad)
  const s = Math.sin(rad)
  return mat4Multiply(m, new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]))
}

/**
 * Orthographic projection, `near`/`far` in the same sign convention as the reference
 * (`-2/(far-near)` on z). The 3rd/4th parameters are named `top`/`bottom`, and the y axis
 * maps `bottom` to -1, consistent with the workspace's y-down design space.
 */
export function mat4Ortho(left, right, top, bottom, near, far) {
  const out = mat4Identity()
  out[0] = 2 / (right - left)
  out[5] = 2 / (bottom - top)
  out[10] = -2 / (far - near)
  out[12] = -(right + left) / (right - left)
  out[13] = -(bottom + top) / (bottom - top)
  out[14] = -(far + near) / (far - near)
  return out
}

/**
 * Perspective projection (right-handed, w_clip = -z_view so visible points have z < 0),
 * matching the reference's element placement.
 */
export function mat4Perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2)
  const out = mat4Identity()
  out[0] = f / aspect
  out[5] = f
  out[10] = (far + near) / (near - far)
  out[11] = -1
  out[14] = (2 * far * near) / (near - far)
  out[15] = 0
  return out
}

/**
 * View matrix looking from `eye` at `center` with `up`.
 *
 * Storage note (mirrored verbatim for parity): the reference renderer writes the look-at
 * basis as *columns* of the row-major array — out[0..2] = xAxis, out[4..6] = yAxis,
 * out[8..10] = zAxis — while `mat4Ortho`/`mat4Perspective` use the plain row layout. The
 * translation still lands in indices 12..14. PROVENANCE.md §4 records this asymmetry.
 */
export function mat4LookAt(eye, center, up) {
  const z = normalize([eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]])
  const x = normalize(cross(up, z))
  const y = cross(z, x)
  TMP[0] = x[0]; TMP[1] = y[0]; TMP[2] = z[0]; TMP[3] = 0
  TMP[4] = x[1]; TMP[5] = y[1]; TMP[6] = z[1]; TMP[7] = 0
  TMP[8] = x[2]; TMP[9] = y[2]; TMP[10] = z[2]; TMP[11] = 0
  TMP[12] = -dot(x, eye); TMP[13] = -dot(y, eye); TMP[14] = -dot(z, eye); TMP[15] = 1
  return new Float32Array(TMP)
}

/**
 * Transform a point/projective vector (w = 1) by `m` and divide by the resulting w —
 * the reference renderer's behaviour, verified with an explicitly projective matrix
 * (a non-1 w scales the result; see PROVENANCE.md §3). Returns `[x, y, z]`.
 */
export function mat4TransformPoint(m, x, y, z) {
  const px = x * m[0] + y * m[4] + z * m[8] + m[12]
  const py = x * m[1] + y * m[5] + z * m[9] + m[13]
  const pz = x * m[2] + y * m[6] + z * m[10] + m[14]
  const pw = x * m[3] + y * m[7] + z * m[11] + m[15]
  return [px / pw, py / pw, pz / pw]
}

/**
 * Compose the workspace's settled bone-matrix product `bindInv × m` for row vectors:
 * `bindInv` is applied to the vertex first, then the animated world matrix `m`
 * (docs/UNTOUCHED-AREAS.md §"g_Bones 组装顺序" — the order was decided by a rigid-rotation
 * criterion, not by taste; see test/mat4.test.mjs which re-runs that criterion).
 *
 * In terms of this module's `mat4Multiply(a, b) === b · a`, this is `mat4Multiply(m, bindInv)`.
 */
export function bindInvTimesM(bindInv, m) {
  return mat4Multiply(m, bindInv)
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function normalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / len, v[1] / len, v[2] / len]
}
