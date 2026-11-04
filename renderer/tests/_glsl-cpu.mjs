// _glsl-cpu.mjs —— 判据用的 **GLSL 子集 → JS 转译器**（只在 Node 里跑，秒级、无 GL 上下文）
//
// 为什么要有它：本仓的"效果 shader 行为"判据此前只能做到
//   ① 源码形态断言（正则找表达式）、② 假 GL（证明**接线**，不证明**数值**）、
//   ③ playwright 真 GL（条件项，缺环境就 SKIP —— 不能当门禁的硬判据）。
// 内置效果「磁流体」（raymarch 出来的画面）需要的是一条**离线数值**判据：
//   给定一组参数 ⇒ 输出的统计量该落在哪 —— 且"把 shader 换成空实现 / 把参数写死"必须变红。
// 所以这里转译的是**仓库里真实的那份 shader 源**（不是另写一份数学），跑出来的是它的真实输出。
//
// 口径与边界（诚实声明）：
//   · 它**不是** GLSL 编译器：只覆盖本仓判据用到的子集 ——
//     `float/int/bool/vec2/vec3/vec4`、`const` 全局、函数（含 `out` 标量参数）、
//     `if/else`、`for`（含 `break`/`continue`）、`return`、`?:`、成员 swizzle、向量构造、
//     以及一组内建函数（见 RUNTIME）。**不支持**：矩阵、数组、纹理采样、位运算、函数重载、
//     隐式 int→float 之外的隐式转换、精度限定符语义。遇到不认识的语法**抛错**（绝不猜）。
//   · 浮点 = JS double（GLSL 侧多为 float32）⇒ 末位会有差异。判据因此只用
//     **比例关系 / 区间 / 单调性**这类对末位不敏感的读数；唯一逐位敏感的 FNV digest
//     是**冻结回归锁**，只跟"本转译器 + 本份源码"的自身历史比，不当跨实现真值。
//   · `int(x)` == `Math.trunc(x)`；`float(i)` == 恒等；`++/--` 只支持出现在 for 的步进位置。
//
// 用法：
//   import { compileFrag } from './_glsl-cpu.mjs'
//   const sh = compileFrag(fragSource)              // 源 = 仓库/上游的那份 GLSL
//   const px = sh.run({ g_FxAlpha: 1, … }, { v_TexCoord: [x, y] })   // ⇒ { gl_FragColor: [r,g,b,a] }

/* ───────────────────────────── 词法 ───────────────────────────── */
const PUNCT = [
  '<<=', '>>=', '++', '--', '<=', '>=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=', '%=',
  '(', ')', '[', ']', '{', '}', ';', ',', '.', '=', '+', '-', '*', '/', '%', '<', '>', '!', '?', ':',
]
const KEYWORDS = new Set(['const', 'if', 'else', 'for', 'return', 'break', 'continue', 'while', 'do', 'discard'])
const TYPES = new Set(['void', 'float', 'int', 'bool', 'vec2', 'vec3', 'vec4', 'ivec2', 'ivec3', 'ivec4', 'bvec2', 'bvec3', 'bvec4', 'mat2', 'mat3', 'mat4', 'sampler2D'])

function lex(src) {
  const out = []
  let i = 0
  const isId0 = (c) => /[A-Za-z_]/.test(c)
  const isId = (c) => /[A-Za-z0-9_]/.test(c)
  while (i < src.length) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue }
    if (c === '#') throw new Error('预处理指令未被展开: ' + src.slice(i, i + 40))
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let j = i
      while (j < src.length && /[0-9.]/.test(src[j])) j++
      if (/[eE]/.test(src[j] || '')) { j++; if (/[+-]/.test(src[j] || '')) j++; while (j < src.length && /[0-9]/.test(src[j])) j++ }
      if (/[uUfF]/.test(src[j] || '')) j++
      out.push({ k: 'num', v: Number(src.slice(i, j)), raw: src.slice(i, j) })
      i = j
      continue
    }
    if (isId0(c)) {
      let j = i
      while (j < src.length && isId(src[j])) j++
      out.push({ k: 'id', v: src.slice(i, j) })
      i = j
      continue
    }
    let hit = null
    for (const p of PUNCT) if (src.startsWith(p, i)) { hit = p; break }
    if (!hit) throw new Error('词法：不认识的字符 ' + JSON.stringify(c) + ' @' + i)
    out.push({ k: 'punct', v: hit })
    i += hit.length
  }
  return out
}

/** 展开 `#define`（**只支持对象式宏**；函数式宏直接抛错，绝不猜）。 */
export function preprocess(src) {
  const defines = new Map()
  const lines = String(src).split('\n')
  const kept = []
  for (const ln of lines) {
    const m = /^\s*#\s*define\s+([A-Za-z_]\w*)\s*(\([^)]*\))?\s*(.*)$/.exec(ln)
    if (m) {
      if (m[2]) throw new Error('预处理：不支持函数式宏 ' + m[1])
      defines.set(m[1], m[3].trim())
      continue
    }
    if (/^\s*#/.test(ln)) throw new Error('预处理：不支持的指令 ' + ln.trim().slice(0, 40))
    kept.push(ln)
  }
  let out = kept.join('\n')
  for (let pass = 0; pass < 8; pass++) {
    let changed = false
    for (const [name, body] of defines) {
      const re = new RegExp('\\b' + name + '\\b', 'g')
      const next = out.replace(re, () => { changed = true; return '(' + body + ')' })
      out = next
    }
    if (!changed) break
  }
  return { src: out, defines }
}

/* ───────────────────────────── 语法 ───────────────────────────── */
function parse(tokens) {
  let pos = 0
  const peek = (n = 0) => tokens[pos + n]
  const at = (v) => { const t = peek(); return !!t && t.v === v }
  const eat = (v) => { if (!at(v)) throw new Error('语法：期望 ' + JSON.stringify(v) + '，实际 ' + JSON.stringify(peek() && peek().v)); return tokens[pos++] }
  /** 取下一个记号（不看值）。⚠ 不要用 `take().v` —— `eat` 的实参是**期望值**，不传就必然抛。 */
  const take = () => { const t = tokens[pos++]; if (!t) throw new Error('语法：记号意外结束'); return t }
  const isType = () => { const t = peek(); return !!t && t.k === 'id' && TYPES.has(t.v) }

  function primary() {
    const t = peek()
    if (!t) throw new Error('语法：表达式意外结束')
    if (t.k === 'num') { pos++; return { t: 'num', v: t.v } }
    if (t.k === 'id') {
      if (t.v === 'true' || t.v === 'false') { pos++; return { t: 'num', v: t.v === 'true' ? 1 : 0 } }
      pos++
      if (at('(')) {
        eat('(')
        const args = []
        if (!at(')')) { args.push(expr()); while (at(',')) { eat(','); args.push(expr()) } }
        eat(')')
        return { t: 'call', callee: { t: 'id', name: t.v }, args }
      }
      return { t: 'id', name: t.v }
    }
    if (at('(')) { eat('('); const e = expr(); eat(')'); return e }
    throw new Error('语法：不能作为表达式起点的记号 ' + JSON.stringify(t.v))
  }
  function postfix() {
    let e = primary()
    for (;;) {
      if (at('.')) { eat('.'); const p = peek(); if (!p || p.k !== 'id') throw new Error('语法：`.` 后要是成员名'); pos++; e = { t: 'member', obj: e, prop: p.v }; continue }
      if (at('[')) { eat('['); const ix = expr(); eat(']'); e = { t: 'index', obj: e, index: ix }; continue }
      if (at('++') || at('--')) { const op = tokens[pos++].v; e = { t: 'postfix', op, arg: e }; continue }
      break
    }
    return e
  }
  function unary() {
    if (at('-') || at('+') || at('!') || at('~')) { const op = tokens[pos++].v; return { t: 'un', op, arg: unary() } }
    if (at('++') || at('--')) { const op = tokens[pos++].v; return { t: 'prefix', op, arg: unary() } }
    if (at('(') && peek(1) && peek(1).k === 'id' && TYPES.has(peek(1).v) && at2(')')) {
      // C 风格强制转换 `(float)x` —— 只认 `(<基本类型>)` 形态
      const ty = peek(1).v
      pos += 3
      return { t: 'cast', ty, arg: unary() }
    }
    return postfix()
  }
  const at2 = (v) => { const t = tokens[pos + 2]; return !!t && t.v === v }
  const bin = (sub, ops) => () => {
    let l = sub()
    while (peek() && ops.indexOf(peek().v) >= 0) { const op = tokens[pos++].v; l = { t: 'bin', op, l, r: sub() } }
    return l
  }
  const mulExpr = bin(unary, ['*', '/', '%'])
  const addExpr = bin(mulExpr, ['+', '-'])
  const relExpr = bin(addExpr, ['<', '>', '<=', '>='])
  const eqExpr = bin(relExpr, ['==', '!='])
  const landExpr = bin(eqExpr, ['&&'])
  const lorExpr = bin(landExpr, ['||'])
  function ternary() {
    const c = lorExpr()
    if (at('?')) { eat('?'); const a = expr(); eat(':'); const b = ternary(); return { t: 'tern', c, a, b } }
    return c
  }
  const ASSIGN_OPS = ['=', '+=', '-=', '*=', '/=', '%=']
  function expr() {
    const save = pos
    const l = ternary()
    if (peek() && ASSIGN_OPS.indexOf(peek().v) >= 0) {
      const op = tokens[pos++].v
      const r = expr()
      return { t: 'assign', op, left: l, right: r }
    }
    pos = save
    return ternary()
  }
  function block() {
    eat('{')
    const body = []
    while (!at('}')) body.push(statement())
    eat('}')
    return { t: 'block', body }
  }
  function statement() {
    if (at(';')) { eat(';'); return { t: 'empty' } }
    if (at('{')) return block()
    const t = peek()
    if (t && t.k === 'id') {
      if (t.v === 'if') {
        eat('if'); eat('('); const c = expr(); eat(')')
        const a = statement()
        let b = null
        if (at('else')) { eat('else'); b = statement() }
        return { t: 'if', c, a, b }
      }
      if (t.v === 'for') {
        eat('for'); eat('(')
        let init = null
        if (!at(';')) {
          if (isType() || at('const')) init = decl(false)
          else init = { t: 'expr', e: expr() }
        }
        eat(';')
        const cond = at(';') ? null : expr()
        eat(';')
        const step = at(')') ? null : expr()
        eat(')')
        const body = statement()
        return { t: 'for', init, cond, step, body }
      }
      if (t.v === 'return') { eat('return'); const e = at(';') ? null : expr(); eat(';'); return { t: 'return', e } }
      if (t.v === 'break') { eat('break'); eat(';'); return { t: 'break' } }
      if (t.v === 'continue') { eat('continue'); eat(';'); return { t: 'continue' } }
      if (t.v === 'discard') { eat('discard'); eat(';'); return { t: 'discard' } }
    }
    if (isType() || at('const')) return decl(true)
    const e = expr()
    eat(';')
    return { t: 'expr', e }
  }
  /** 声明：`[const] <type> <name> [= expr] ;`。 */
  function decl(wantSemi) {
    let qual = null
    if (at('const')) { eat('const'); qual = 'const' }
    const ty = take().v
    if (!TYPES.has(ty)) throw new Error('语法：不认识的类型 ' + ty)
    const name = take().v
    let init = null
    if (at('=')) { eat('='); init = expr() }
    if (at(',')) throw new Error('语法：不支持一行多声明')
    if (wantSemi) eat(';')
    return { t: 'decl', qual, ty, name, init }
  }
  const globals = []
  const funcs = []
  const QUALIFIERS = new Set(['varying', 'uniform', 'attribute', 'in', 'out', 'inout', 'flat', 'smooth', 'lowp', 'mediump', 'highp'])
  while (pos < tokens.length) {
    // 限定符打头的声明（`varying vec2 v_TexCoord;` / `uniform float g_Time;`）：值由 U/V 注入 ⇒ 跳过声明、不建全局
    if (peek() && peek().k === 'id' && QUALIFIERS.has(peek().v)) {
      while (peek() && peek().k === 'id' && QUALIFIERS.has(peek().v)) pos++
      if (!isType()) throw new Error('语法：限定符后不是类型')
      pos++
      const nm = take().v
      if (at('[')) { throw new Error('语法：不支持数组声明 ' + nm) }
      if (at('=')) throw new Error('语法：限定符声明不接受初值')
      eat(';')
      continue
    }
    if (isType()) {
      const save = pos
      const ty = peek().v
      const name = peek(1) && peek(1).v
      if (peek(2) && peek(2).v === '(') {
        pos += 2
        eat('(')
        const params = []
        if (!at(')')) {
          for (;;) {
            let pout = false
            if (at('out') || at('inout')) { pout = true; pos++ }
            else if (at('in')) pos++
            if (!isType()) throw new Error('语法：参数类型不认识')
            const pty = take().v
            const pn = take().v
            params.push({ ty: pty, name: pn, out: pout })
            if (at(',')) { eat(','); continue }
            break
          }
        }
        eat(')')
        const body = block()
        funcs.push({ ret: ty, name, params, body })
        continue
      }
      pos = save
      const d = decl(true)
      globals.push(d)
      continue
    }
    if (at('const')) { globals.push(decl(true)); continue }
    if (peek() && peek().v === 'precision') { while (!at(';')) pos++; eat(';'); continue }
    const bad = peek()
    throw new Error('语法：顶层不能解析的记号 ' + JSON.stringify(bad && bad.v))
  }
  return { globals, funcs }
}

/* ───────────────────────────── 运行时 ───────────────────────────── */
const XYZW = 'xyzw'
const idxOf = (c) => XYZW.indexOf(c)
export const RUNTIME = {
  V: (a) => a,
  mk: (n, args) => {
    let flat = null
    if (args.length === 1 && Array.isArray(args[0])) flat = args[0].slice()
    else {
      let cnt = 0
      for (const a of args) cnt += Array.isArray(a) ? a.length : 1
      if (cnt === 1) { const o = new Array(n); o.fill(Array.isArray(args[0]) ? args[0][0] : args[0]); return o }
      flat = new Array(cnt)
      let k = 0
      for (const a of args) { if (Array.isArray(a)) { for (const x of a) flat[k++] = x } else flat[k++] = a }
    }
    if (flat.length === 1) { const o = new Array(n); o.fill(flat[0]); return o }
    if (flat.length !== n) throw new Error('向量构造参数个数不符：' + n + ' ← ' + flat.length)
    return flat
  },
  /* swizzle：单分量 ⇒ 标量；多分量 ⇒ 新建数组。常用形态走分支快路径（热循环里 90% 是 .xyz/.xy/.w）。
     ⚠ 判据用 GLSL 的 `xyzw`/`rgba` 两套写法都要认。 */
  sw: (v, p) => {
    if (!Array.isArray(v)) return v
    switch (p) {
      case 'x': case 'r': return v[0]
      case 'y': case 'g': return v[1]
      case 'z': case 'b': return v[2]
      case 'w': case 'a': return v[3]
      case 'xy': case 'rg': return [v[0], v[1]]
      case 'xyz': case 'rgb': return [v[0], v[1], v[2]]
      case 'xyzw': case 'rgba': return [v[0], v[1], v[2], v[3]]
      default: break
    }
    const out = new Array(p.length)
    for (let i = 0; i < p.length; i++) out[i] = v[idxOf(p[i])]
    return out
  },
  swSet: (v, p, val) => {
    if (p.length === 1) { v[idxOf(p[0])] = Array.isArray(val) ? val[0] : val; return val }
    for (let i = 0; i < p.length; i++) v[idxOf(p[i])] = Array.isArray(val) ? val[i] : val
    return val
  },
  map1: (a, f) => (Array.isArray(a) ? a.map(f) : f(a)),
  map2: (a, b, f) => (Array.isArray(a)
    ? a.map((x, i) => f(x, Array.isArray(b) ? b[i] : b))
    : (Array.isArray(b) ? b.map((y) => f(a, y)) : f(a, b))),
  /* 四则：**不传闭包**（热循环里每次运算一个闭包是本转译器最大的开销源）。分量广播语义同 GLSL。 */
  add: (a, b) => Array.isArray(a)
    ? (Array.isArray(b) ? a.map((x, i) => x + b[i]) : a.map((x) => x + b))
    : (Array.isArray(b) ? b.map((y) => a + y) : a + b),
  sub: (a, b) => Array.isArray(a)
    ? (Array.isArray(b) ? a.map((x, i) => x - b[i]) : a.map((x) => x - b))
    : (Array.isArray(b) ? b.map((y) => a - y) : a - b),
  mul: (a, b) => Array.isArray(a)
    ? (Array.isArray(b) ? a.map((x, i) => x * b[i]) : a.map((x) => x * b))
    : (Array.isArray(b) ? b.map((y) => a * y) : a * b),
  div: (a, b) => Array.isArray(a)
    ? (Array.isArray(b) ? a.map((x, i) => x / b[i]) : a.map((x) => x / b))
    : (Array.isArray(b) ? b.map((y) => a / y) : a / b),
  mod: (a, b) => Array.isArray(a)
    ? (Array.isArray(b) ? a.map((x, i) => x - b[i] * Math.floor(x / b[i])) : a.map((x) => x - b * Math.floor(x / b)))
    : (Array.isArray(b) ? b.map((y) => a - y * Math.floor(a / y)) : a - b * Math.floor(a / b)),
  neg: (a) => (Array.isArray(a) ? a.map((x) => -x) : -a),
  _float: (x) => x,
  _int: (x) => Math.trunc(x),
  _bool: (x) => (x ? 1 : 0),
  _fract: (x) => (Array.isArray(x) ? x.map((v) => v - Math.floor(v)) : x - Math.floor(x)),
  _sin: (x) => (Array.isArray(x) ? x.map(Math.sin) : Math.sin(x)),
  _cos: (x) => (Array.isArray(x) ? x.map(Math.cos) : Math.cos(x)),
  _tan: (x) => (Array.isArray(x) ? x.map(Math.tan) : Math.tan(x)),
  _exp: (x) => (Array.isArray(x) ? x.map(Math.exp) : Math.exp(x)),
  _log: (x) => (Array.isArray(x) ? x.map(Math.log) : Math.log(x)),
  _sqrt: (x) => (Array.isArray(x) ? x.map(Math.sqrt) : Math.sqrt(x)),
  _abs: (x) => (Array.isArray(x) ? x.map(Math.abs) : Math.abs(x)),
  _floor: (x) => (Array.isArray(x) ? x.map(Math.floor) : Math.floor(x)),
  _ceil: (x) => (Array.isArray(x) ? x.map(Math.ceil) : Math.ceil(x)),
  _sign: (x) => (Array.isArray(x) ? x.map(Math.sign) : Math.sign(x)),
  _pow: (a, b) => RUNTIME.map2(a, b, Math.pow),
  _min: (a, b) => RUNTIME.map2(a, b, Math.min),
  _max: (a, b) => RUNTIME.map2(a, b, Math.max),
  _clamp: (x, lo, hi) => {
    const y = Array.isArray(x)
      ? (Array.isArray(lo) ? x.map((v, i) => Math.max(v, lo[i])) : x.map((v) => Math.max(v, lo)))
      : (Array.isArray(lo) ? lo.map((v) => Math.max(x, v)) : Math.max(x, lo))
    return Array.isArray(y)
      ? (Array.isArray(hi) ? y.map((v, i) => Math.min(v, hi[i])) : y.map((v) => Math.min(v, hi)))
      : (Array.isArray(hi) ? hi.map((v) => Math.min(y, v)) : Math.min(y, hi))
  },
  _mix: (a, b, t) => RUNTIME.add(a, RUNTIME.mul(RUNTIME.sub(b, a), t)),
  _step: (e, x) => RUNTIME.map2(e, x, (a, b) => (b < a ? 0 : 1)),
  _smoothstep: (e0, e1, x) => {
    const t = RUNTIME._clamp(RUNTIME.div(RUNTIME.sub(x, e0), RUNTIME.sub(e1, e0)), 0, 1)
    return RUNTIME.mul(RUNTIME.mul(t, t), RUNTIME.sub(3, RUNTIME.mul(2, t)))
  },
  _dot: (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s },
  _length: (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s) },
  _distance: (a, b) => RUNTIME._length(RUNTIME.sub(a, b)),
  _cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  _normalize: (a) => { const l = RUNTIME._length(a); return l === 0 ? a.map(() => 0) : a.map((x) => x / l) },
  _reflect: (I, N) => RUNTIME.sub(I, RUNTIME.mul(RUNTIME.mul(2, RUNTIME._dot(N, I)), N)),
}
const BUILTIN = {
  float: '_float', int: '_int', bool: '_bool',
  sin: '_sin', cos: '_cos', tan: '_tan', exp: '_exp', log: '_log', sqrt: '_sqrt',
  abs: '_abs', floor: '_floor', ceil: '_ceil', sign: '_sign', fract: '_fract',
  pow: '_pow', min: '_min', max: '_max', clamp: '_clamp', mix: '_mix', step: '_step', smoothstep: '_smoothstep',
  dot: '_dot', length: '_length', distance: '_distance', cross: '_cross', normalize: '_normalize', reflect: '_reflect',
  mod: 'mod', texture2D: '__unsupported_texture', texSample2D: '__unsupported_texture',
}
const CTOR = { vec2: 2, vec3: 3, vec4: 4, ivec2: 2, ivec3: 3, ivec4: 4, bvec2: 2, bvec3: 3, bvec4: 4 }

/* ───────────────────────────── 代码生成 ───────────────────────────── */
function codegen(ast) {
  const fnOut = new Map()          // 函数名 → { params, outIdx }
  for (const f of ast.funcs) fnOut.set(f.name, f)
  let tmpSeq = 0
  const declTmp = (decls, name) => { decls.push(name); return name }

  function genArgs(e, outNames) { return gen(e, outNames) }

  function gen(e, outNames, decls) {
    switch (e.t) {
      case 'num': return Number.isInteger(e.v) ? String(e.v) : String(e.v)
      case 'id': return outNames.has(e.name) ? (e.name + '.v') : e.name
      case 'member': {
        const p = e.prop
        if (!/^[xyzwrgbastpq]{1,4}$/.test(p)) throw new Error('代码生成：不认识的点成员 .' + p)
        return 'RT.sw(' + gen(e.obj, outNames, decls) + ',' + JSON.stringify(p) + ')'
      }
      case 'index': return gen(e.obj, outNames, decls) + '[' + gen(e.index, outNames, decls) + ']'
      case 'un': {
        if (e.op === '!') return '((' + gen(e.arg, outNames, decls) + ') ? 0 : 1)'
        if (e.op === '+') return gen(e.arg, outNames, decls)
        if (e.op === '-') return 'RT.neg(' + gen(e.arg, outNames, decls) + ')'
        throw new Error('代码生成：不认识的一元运算符 ' + e.op)
      }
      case 'cast': {
        if (e.ty === 'float') return 'RT._float(' + gen(e.arg, outNames, decls) + ')'
        if (e.ty === 'int') return 'RT._int(' + gen(e.arg, outNames, decls) + ')'
        if (e.ty === 'bool') return 'RT._bool(' + gen(e.arg, outNames, decls) + ')'
        throw new Error('代码生成：不支持的强制转换 ' + e.ty)
      }
      case 'bin': {
        const a = gen(e.l, outNames, decls), b = gen(e.r, outNames, decls)
        switch (e.op) {
          case '+': return 'RT.add(' + a + ',' + b + ')'
          case '-': return 'RT.sub(' + a + ',' + b + ')'
          case '*': return 'RT.mul(' + a + ',' + b + ')'
          case '/': return 'RT.div(' + a + ',' + b + ')'
          case '%': return 'RT.mod(' + a + ',' + b + ')'
          case '<': return '(' + a + ' < ' + b + ')'
          case '>': return '(' + a + ' > ' + b + ')'
          case '<=': return '(' + a + ' <= ' + b + ')'
          case '>=': return '(' + a + ' >= ' + b + ')'
          case '==': return '((' + a + ') === (' + b + '))'
          case '!=': return '((' + a + ') !== (' + b + '))'
          case '&&': return '((' + a + ') && (' + b + '))'
          case '||': return '((' + a + ') || (' + b + '))'
          default: throw new Error('代码生成：不支持的二元运算符 ' + e.op)
        }
      }
      case 'tern': return '(' + gen(e.c, outNames, decls) + ' ? ' + gen(e.a, outNames, decls) + ' : ' + gen(e.b, outNames, decls) + ')'
      case 'assign': {
        const opFn = { '+=': 'RT.add', '-=': 'RT.sub', '*=': 'RT.mul', '/=': 'RT.div', '%=': 'RT.mod' }[e.op]
        const rhs = gen(e.right, outNames, decls)
        const L = e.left
        if (L.t === 'id') {
          const cur = outNames.has(L.name) ? (L.name + '.v') : L.name
          return (cur + ' = ' + (opFn ? opFn + '(' + cur + ',' + rhs + ')' : rhs))
        }
        if (L.t === 'member') {
          const obj = gen(L.obj, outNames, decls)
          const cur = 'RT.sw(' + obj + ',' + JSON.stringify(L.prop) + ')'
          return 'RT.swSet(' + obj + ',' + JSON.stringify(L.prop) + ',' + (opFn ? opFn + '(' + cur + ',' + rhs + ')' : rhs) + ')'
        }
        if (L.t === 'index') {
          const obj = gen(L.obj, outNames, decls), ix = gen(L.index, outNames, decls)
          const cur = obj + '[' + ix + ']'
          return '(' + cur + ' = ' + (opFn ? opFn + '(' + cur + ',' + rhs + ')' : rhs) + ')'
        }
        throw new Error('代码生成：不支持的赋值目标 ' + L.t)
      }
      case 'postfix': case 'prefix': {
        const L = e.arg
        const one = (e.op === '++' ? 'RT.add' : 'RT.sub')
        if (L.t === 'id') {
          const cur = outNames.has(L.name) ? (L.name + '.v') : L.name
          return (cur + ' = ' + one + '(' + cur + ',1)')
        }
        if (L.t === 'member') {
          const obj = gen(L.obj, outNames, decls)
          const cur = 'RT.sw(' + obj + ',' + JSON.stringify(L.prop) + ')'
          return 'RT.swSet(' + obj + ',' + JSON.stringify(L.prop) + ',' + one + '(' + cur + ',1))'
        }
        throw new Error('代码生成：++/-- 只支持变量与 swizzle')
      }
      case 'call': {
        const name = e.callee.name
        if (CTOR[name]) return 'RT.mk(' + CTOR[name] + ',[' + e.args.map((a) => gen(a, outNames, decls)).join(',') + '])'
        if (BUILTIN[name]) return 'RT.' + BUILTIN[name] + '(' + e.args.map((a) => gen(a, outNames, decls)).join(',') + ')'
        const f = fnOut.get(name)
        if (!f) throw new Error('代码生成：未定义的函数 ' + name)
        const outIdx = f.params.map((p, i) => (p.out ? i : -1)).filter((i) => i >= 0)
        if (!outIdx.length) return name + '(' + e.args.map((a) => gen(a, outNames, decls)).join(',') + ')'
        const parts = []
        const boxes = []
        for (const i of outIdx) {
          const b = declTmp(decls, '__ob' + (tmpSeq++))
          parts.push(b + ' = {v:0}')
          boxes.push(b)
        }
        const ret = declTmp(decls, '__or' + (tmpSeq++))
        const callArgs = e.args.map((a, i) => (outIdx.indexOf(i) >= 0 ? boxes[outIdx.indexOf(i)] : gen(a, outNames, decls)))
        parts.push(ret + ' = ' + name + '(' + callArgs.join(',') + ')')
        outIdx.forEach((i, k) => parts.push(gen(e.args[i], outNames, decls) + ' = ' + boxes[k] + '.v'))
        parts.push(ret)
        return '(' + parts.join(', ') + ')'
      }
      default: throw new Error('代码生成：不认识的表达式节点 ' + e.t)
    }
  }

  function genStmt(s, outNames, decls, ind) {
    const pad = '  '.repeat(ind)
    switch (s.t) {
      case 'empty': return pad + ';'
      case 'block': return s.body.map((x) => genStmt(x, outNames, decls, ind)).join('\n')
      case 'decl': {
        const kw = s.qual === 'const' ? 'const' : 'let'
        const init = s.init ? (' = ' + gen(s.init, outNames, decls)) : ' = 0'
        return pad + kw + ' ' + s.name + init + ';'
      }
      case 'expr': return pad + gen(s.e, outNames, decls) + ';'
      case 'return': return pad + 'return' + (s.e ? (' ' + gen(s.e, outNames, decls)) : '') + ';'
      case 'break': return pad + 'break;'
      case 'continue': return pad + 'continue;'
      case 'discard': return pad + 'return null;'
      case 'if': {
        let out = pad + 'if (' + gen(s.c, outNames, decls) + ') {\n' + genStmt(s.a, outNames, decls, ind + 1) + '\n' + pad + '}'
        if (s.b) out += ' else {\n' + genStmt(s.b, outNames, decls, ind + 1) + '\n' + pad + '}'
        return out
      }
      case 'for': {
        const init = s.init ? (s.init.t === 'decl'
          ? ('let ' + s.init.name + ' = ' + gen(s.init.init, outNames, decls))
          : gen(s.init.e, outNames, decls)) : ''
        const cond = s.cond ? gen(s.cond, outNames, decls) : ''
        const step = s.step ? gen(s.step, outNames, decls) : ''
        return pad + 'for (' + init + '; ' + cond + '; ' + step + ') {\n' + genStmt(s.body, outNames, decls, ind + 1) + '\n' + pad + '}'
      }
      default: throw new Error('代码生成：不认识的语句节点 ' + s.t)
    }
  }

  const chunks = []
  const uniformNames = []
  const globalNames = []
  for (const g of ast.globals) globalNames.push(g)
  for (const f of ast.funcs) {
    const outNames = new Set(f.params.filter((p) => p.out).map((p) => p.name))
    const decls = []
    const bodyJs = genStmt(f.body, outNames, decls, 1)
    const pre = decls.length ? ('  let ' + Array.from(new Set(decls)).join(', ') + ';\n') : ''
    chunks.push('function ' + f.name + '(' + f.params.map((p) => p.name).join(', ') + ') {\n' + pre + bodyJs + '\n}')
  }
  const globalsJs = globalNames.map((g) => 'const ' + g.name + ' = ' + gen(g.init, new Set(), []) + ';').join('\n')
  return { js: chunks.join('\n'), globalsJs, uniforms: uniformNames }
}

/**
 * 转译一份 fragment shader 源。
 * @returns {{ run:(uniforms:object, varying:object)=>({gl_FragColor:number[]}), js:string, uniforms:string[] }}
 */
export function compileFrag(src, opts = {}) {
  const pre = preprocess(src)
  const toks = lex(pre.src)
  const ast = parse(toks)
  // uniform 声明（顶层 `uniform <type> <name>;`）在词法阶段已被当作类型声明解析 ⇒ 这里从原文抓名字
  const uniforms = []
  const reU = /uniform\s+[A-Za-z0-9_]+\s+([A-Za-z_]\w*)\s*;/g
  let m
  while ((m = reU.exec(pre.src))) uniforms.push(m[1])
  const varyings = []
  const reV = /\b(?:varying|in)\s+[A-Za-z0-9_]+\s+([A-Za-z_]\w*)\s*;/g
  while ((m = reV.exec(pre.src))) varyings.push(m[1])
  const { js, globalsJs } = codegen({ globals: ast.globals.filter((g) => !uniforms.includes(g.name)), funcs: ast.funcs })
  const head = uniforms.map((n) => 'const ' + n + ' = U[' + JSON.stringify(n) + '];').join('\n')
    + '\n' + varyings.map((n) => 'const ' + n + ' = V[' + JSON.stringify(n) + '];').join('\n')
  const body = head + '\n' + globalsJs + '\n' + js + '\nlet gl_FragColor = [0,0,0,0];\nmain();\nreturn gl_FragColor;'
  const f = new Function('RT', 'U', 'V', body)   // eslint-disable-line no-new-func
  return {
    uniforms, varyings, js: body,
    run: (uniformsV, varyingV) => ({ gl_FragColor: f(RUNTIME, uniformsV || {}, varyingV || {}) }),
  }
}

export const GLSL_CPU_NOTE = 'GLSL 子集 CPU 转译器：只覆盖判据用到的语法；不认识的语法抛错（绝不猜）。'
