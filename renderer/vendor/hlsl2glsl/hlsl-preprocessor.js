// HLSL → GLSL 转译 · C 预处理器（#include / #define / 函数宏 / #if 求值）
// [we-scene patch] 从 hlsl2glsl.js 拆出（切口 = 「预处理器 vs 方言语法转换」两类职责，
// 见 docs/ARCHITECTURE.md）。WE 的 effect shader 大量使用 #if 组合变体与函数宏，
// GLSL ES 的预处理器不支持函数宏，必须在转译前展开干净。
// 与方言段的内部协作：stripComments / expandMacrosIn / replaceWord 由 hlsl2glsl.js
// 主函数直接复用，故一并导出。

// 收集宏定义（对象宏 + 函数宏）
function collectMacros(src) {
  const defs = new Map()
  const fns = new Map()
  const re = /^[ \t]*#define[ \t]+([A-Za-z_][A-Za-z0-9_]*)(?:\(([^)]*)\))?[ \t]*(.*)$/gm
  let m
  while ((m = re.exec(src)) !== null) {
    // [we-scene patch] 宏体必须剥掉行尾注释：#define 行的 body 是「到行尾」，
    // WE 语料里大量宏带尾注（avg(f) float(...) //Gets the amplitude …）。
    // 注释留在 body 里，展开后 `//` 会把展开文本之后的同一行全部注释掉——
    // 包括 expandFunctionMacro 补的右括号，产生括号失衡（示波器 avg 宏实测）。
    const strip = (s) => s.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '').trim()
    if (m[2] !== undefined) {
      fns.set(m[1], { args: m[2].split(',').map((s) => s.trim()).filter(Boolean), body: strip(m[3]) })
    } else {
      defs.set(m[1], strip(m[3]))
    }
  }
  return { defs, fns }
}

// 函数宏展开（平衡括号取参，递归深度限制）
function expandFunctionMacro(text, name, info, depth) {
  const out = []
  let i = 0
  while (i < text.length) {
    const idx = text.indexOf(name, i)
    if (idx === -1) {
      out.push(text.slice(i))
      break
    }
    out.push(text.slice(i, idx))
    const p = idx + name.length
    // 必须是函数调用形式：下一个非空白字符是 '('
    let q = p
    while (q < text.length && /\s/.test(text[q])) q++
    if (text[q] !== '(') {
      out.push(text.slice(idx, q))
      i = q
      continue
    }
    // 平衡括号取参数
    let depthCount = 0
    let end = q
    for (; end < text.length; end++) {
      if (text[end] === '(') depthCount++
      else if (text[end] === ')') {
        depthCount--
        if (depthCount === 0) break
      }
    }
    if (end >= text.length) {
      out.push(text.slice(idx))
      break
    }
    const argsStr = text.slice(q + 1, end)
    const args = splitArgs(argsStr)
    let body = info.body
    info.args.forEach((name, k) => {
      const val = args[k] !== undefined ? args[k].trim() : ''
      body = replaceWord(body, name, val)
    })
    if (depth > 0) body = expandMacrosIn(body, depth - 1)
    out.push('(' + body + ')')
    i = end + 1
  }
  return out.join('')
}

function replaceWord(text, word, replacement) {
  return text.replace(new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g'), replacement)
}

function splitArgs(s) {
  const out = []
  let depth = 0
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '(') depth++
    else if (c === ')') depth--
    if (c === ',' && depth === 0) {
      out.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  if (cur.trim() !== '') out.push(cur)
  return out
}

// 展开宏（对象宏 + 函数宏），多轮迭代直到无宏残留（宏可互相引用）。
// 预处理行（# 开头）不展开，避免 #define 行自身被误当作调用。
function expandMacrosIn(text, depth) {
  for (let round = 0; round < 12; round++) {
    const { defs, fns } = collectMacros(text)
    if (defs.size === 0 && fns.size === 0) break
    const lines = text.split('\n')
    // [we-scene patch] **宏只对它自己的 #define 行之后生效**（C 预处理器语义）。
    // 之前是全文替换，于是 light_map.frag 里 `#else` 分支的 `#define emitters 1.0`
    // 把它**上方**第 28 行的变量声明 `vec3 lightMap = CAST3(0.0), emitters;`
    // 也换成了 `…, 1.0`，ANGLE 报 `'1.0' : syntax error`，整个 light_map pass
    // 被跳过（5 pass / 5 壁纸）。作者写法完全合法：声明在前、宏在后，
    // 宏本意只是让后面那句 `* emitters` 变成 `* 1.0`。
    const defLine = new Map()
    for (let i = 0; i < lines.length; i++) {
      const dm = /^[ \t]*#define[ \t]+([A-Za-z_][A-Za-z0-9_]*)/.exec(lines[i])
      if (dm && !defLine.has(dm[1])) defLine.set(dm[1], i)
    }
    // [we-scene patch] **作者用同名变量声明遮蔽了宏时，只保护声明那一行**。
    // 内置 common_blending.h 有 `#define LUMINANCE_FACTOR vec3(0.11, 0.59, 0.3)`，
    // 而 tone_mapping.frag 自己写 `const vec3 LUMINANCE_FACTOR = vec3(0.2126, …);`。
    // 不保护声明行 → 变成 `const vec3 vec3(0.11, …) = …`，ANGLE 报
    // `'vec3' : syntax error`，整个 tone_mapping pass 被跳过（5 pass / 5 壁纸）。
    // ⚠️ 试过「整份文件里这个宏完全失效」，更糟：公共头 greyscale/saturation 里
    // 那些引用（在作者声明**之前**）会变成 `undeclared identifier`，
    // GLSL 要求先声明后使用。所以只跳过声明行，其余引用照常展开宏值。
    // 代价是作者第 256 行 `normalize(LUMINANCE_FACTOR)` 拿到的是公共头的 601 系数
    // 而非他自己的 709 —— 数值有偏差但能编译出画面，好过整个色调映射效果消失。
    const declLine = new Map()
    {
      const TYPES = '(?:float|int|bool|vec[234]|ivec[234]|bvec[234]|mat[234])'
      for (const name of defs.keys()) {
        const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const re = new RegExp(
          '^\\s*(?:const\\s+|uniform\\s+|varying\\s+|in\\s+|out\\s+|attribute\\s+)*' +
            TYPES + '\\s+' + esc + '\\s*[=;]',
        )
        for (let i = 0; i < lines.length; i++) {
          if (re.test(lines[i])) { declLine.set(name, i); break }
        }
      }
    }
    let changed = false
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (/^[ \t]*#/.test(line)) continue
      let l = line
      for (const [name, val] of defs) {
        const dl = defLine.get(name)
        if (dl !== undefined && i < dl) continue
        if (declLine.get(name) === i) continue
        const re = new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b')
        if (re.test(l)) {
          l = replaceWord(l, name, val)
          changed = true
        }
      }
      for (const [name, info] of fns) {
        const dl = defLine.get(name)
        if (dl !== undefined && i < dl) continue
        if (l.includes(name)) {
          l = expandFunctionMacro(l, name, info, depth)
          changed = true
        }
      }
      lines[i] = l
    }
    text = lines.join('\n')
    if (!changed) break
  }
  return text
}

// 求值 #if 表达式（安全自写求值器：|| && ! ( ) == != < > <= >= 数字 标识符）
function evalIfExpr(expr, combos, defs) {
  const resolve = (name) => {
    if (combos[name] !== undefined) return String(combos[name])
    if (defs.has(name)) return '(' + defs.get(name) + ')'
    return '0'
  }
  let s = expr.replace(/\b[A-Za-z_][A-Za-z0-9_]*\b/g, (n) => resolve(n))
  // 递归下降
  let i = 0
  function skipWs() {
    while (i < s.length && /\s/.test(s[i])) i++
  }
  function parseOr() {
    let v = parseAnd()
    skipWs()
    while (s.startsWith('||', i)) {
      i += 2
      const r = parseAnd()
      v = v || r
      skipWs()
    }
    return v
  }
  function parseAnd() {
    let v = parseEq()
    skipWs()
    while (s.startsWith('&&', i)) {
      i += 2
      const r = parseEq()
      v = v && r
      skipWs()
    }
    return v
  }
  function parseEq() {
    let v = parseRel()
    skipWs()
    while (s.startsWith('==', i) || s.startsWith('!=', i)) {
      const op = s[i] === '=' ? '==' : '!='
      i += 2
      const r = parseRel()
      v = op === '==' ? v === r : v !== r
      skipWs()
    }
    return v
  }
  function parseRel() {
    let v = parseUnary()
    skipWs()
    while (/^[<>]/.test(s[i] || '')) {
      let op = s[i]
      if (s[i + 1] === '=') {
        op += '='
        i++
      }
      i++
      const r = parseUnary()
      if (op === '<') v = v < r
      else if (op === '>') v = v > r
      else if (op === '<=') v = v <= r
      else v = v >= r
      skipWs()
    }
    return v
  }
  function parseUnary() {
    skipWs()
    if (s[i] === '!') {
      i++
      return !parseUnary()
    }
    return parseAtom()
  }
  function parseAtom() {
    skipWs()
    if (s[i] === '(') {
      i++
      const v = parseOr()
      skipWs()
      i++ // )
      return v
    }
    const m = /^-?\d+(\.\d+)?/.exec(s.slice(i))
    if (m) {
      i += m[0].length
      return Number(m[0])
    }
    return false
  }
  return parseOr()
}

// 行级预处理：展开 #include、按 combo 裁剪 #if 块
// [we-scene patch] 去注释。转译器此前完全不处理注释，导致两类静默故障：
//  1. `collectMacros` 用逐行正则收 `#define`，会把**注释掉的**宏也收进来。
//     procedural_noise.frag 里有两组被 /* */ 包起来的备选哈希常量：
//       /*#define HASHSCALE1 0.1031
//         #define HASHSCALE3 vec3(...)*/
//       /*#define HASHSCALE1 (443.8975) …*/
//     于是 HASHSCALE1 被定义成一段**跨行残片**，展开后括号数量错乱
//     （实测圆括号净 +3、花括号净 -1），整个 shader 编译失败；
//  2. `rewriteCall` / `splitArgs` 是纯字符串扫描，不认注释。注释里出现的
//     `(`、`)`、`,`、以及 saturate/lerp 等被改写的名字，都会干扰取参与替换。
// 保留换行以免行号错位（诊断日志按行号定位）。字符串字面量在 GLSL 里不存在，
// 无需考虑「注释符出现在字符串内」的情形。
// 注意：`// {"material":...,"default":...}` 这类 uniform 元数据注释是被
// renderer.js 的 parseMaterialMeta **在原始源码上**单独解析的，不经过本函数，
// 所以这里去掉注释不会影响 material 常量绑定。
function stripComments(src) {
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    const d = src[i + 1]
    if (c === '/' && d === '*') {
      i += 2
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') out += '\n'
        i++
      }
      i += 2
      continue
    }
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') i++
      continue
    }
    out += c
    i++
  }
  return out
}

function preprocess(src, combos, includeResolver, depth) {
  const lines = src.split('\n')
  const out = []
  const stack = [] // { parent, hit, done }（done = 本条 #if/#elif/#else 链是否已有分支命中）
  const defs = new Map()
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const t = line.trim()
    if (t.startsWith('#include')) {
      if (allActive(stack)) {
        const m = /^#include[ \t]+"([^"]+)"|^#include[ \t]+<([^>]+)>/.exec(t)
        const file = m && (m[1] || m[2])
        const inc = file && includeResolver ? includeResolver(file) : null
        if (inc !== null && inc !== undefined) {
          // include 进来的头同样要去注释：头里也可能有被注释掉的 #define，
          // 且我们自己重建的公共头带大量中文说明注释（其中的半角括号会干扰
          // 后续 rewriteCall 的取参）。
          out.push(preprocess(stripComments(inc), combos, includeResolver, depth + 1))
        } else {
          out.push('// [include 缺失: ' + file + ']')
        }
      }
      continue
    }
    if (t.startsWith('#define')) {
      if (allActive(stack)) {
        out.push(line)
        const m = /^#define[ \t]+([A-Za-z_][A-Za-z0-9_]*)(?:\([^)]*\))?[ \t]*(.*)$/.exec(t)
        if (m) defs.set(m[1], m[2].trim())
      }
      continue
    }
    if (t.startsWith('#undef')) {
      if (allActive(stack)) out.push(line)
      continue
    }
    if (t.startsWith('#ifdef') || t.startsWith('#ifndef') || t.startsWith('#if')) {
      const parent = allActive(stack)
      let cond = false
      if (t.startsWith('#ifdef')) {
        const name = t.slice(6).trim().split(/\s+/)[0]
        cond = combos[name] !== undefined || defs.has(name)
      } else if (t.startsWith('#ifndef')) {
        const name = t.slice(7).trim().split(/\s+/)[0]
        cond = !(combos[name] !== undefined || defs.has(name))
      } else {
        try {
          cond = !!evalIfExpr(t.slice(3).trim(), combos, defs)
        } catch (e) {
          cond = false
        }
      }
      // done = 本条 #if/#elif/#else 链中是否已有分支命中（决定后续 #elif 还能否命中）
      stack.push({ parent, hit: cond, done: cond })
      continue
    }
    if (t.startsWith('#else')) {
      if (stack.length > 0) {
        const top = stack[stack.length - 1]
        // [we-scene patch] #else 必须看「整条链是否已命中」，不能简单取反 hit。
        // 旧写法 hit = !hit 在 #if/#elif/#else 链里会误开 #else 分支：
        // 若 #if 假、#elif 真，到 #else 时 hit 为 true，取反成 false 尚且正确；
        // 但若 #if 真、#elif 未命中，hit 仍为 true，取反后 #else 也不开 —— 巧合正确；
        // 真正出错的是 #if 假、#elif 假 → hit 假 → 取反开 #else（正确），
        // 以及 #if 真之后紧跟 #elif（见下）会把 done 丢掉。统一用 done 判定最稳。
        top.hit = !top.done
        top.done = true
      }
      continue
    }
    if (t.startsWith('#elif')) {
      // [we-scene patch] 实现 #elif。此前当作「终止」直接忽略，等于把 #elif 之后的
      // 内容并进上一个分支 —— lightshafts.frag 的 `#if RAYMODE == 1 ... #elif RAYMODE == 2`
      // 两个分支各自声明 `vec2 rayCenter`，两段都被保留就报 `'rayCenter' : redefinition`
      // （4 个壁纸）。同类的 #elif 链在 RAYCORNER / tone_mapping 等处也有。
      if (stack.length > 0) {
        const top = stack[stack.length - 1]
        if (top.done) {
          // 链中已有分支命中：本分支必然不取
          top.hit = false
        } else {
          let cond = false
          try {
            cond = !!evalIfExpr(t.slice(5).trim(), combos, defs)
          } catch (e) {
            cond = false
          }
          top.hit = cond
          top.done = cond
        }
      }
      continue
    }
    if (t.startsWith('#endif')) {
      if (stack.length > 0) stack.pop()
      continue
    }
    if (t.startsWith('#')) {
      continue
    }
    if (allActive(stack)) out.push(line)
  }
  return out.join('\n')
}

function allActive(stack) {
  return stack.every((s) => s.parent && s.hit)
}


export { preprocess, stripComments, expandMacrosIn, replaceWord, splitArgs }
