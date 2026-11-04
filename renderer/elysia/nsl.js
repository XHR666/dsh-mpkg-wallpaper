// Browser stand-in for node:vm — runs transpiled NSL script code in a sandbox
// context object.
//
// ①(修复 2026-09-12) 旧实现把 context 的键做成 `new Function` 的**形参**，于是脚本里对顶层
//   标识符的赋值只改到局部变量、**不会写回 context**：
//     · `export var scriptProperties = createScriptProperties()...`（WE 脚本声明属性的标准写法）
//       被转译成 `__scriptProps = ...` → 宿主读 `context.__scriptProps` 永远是 null →
//       属性对象为 null → `update()` 里 `scriptProperties.use24hFormat` 抛 TypeError →
//       时钟/日期/FPS 等所有依赖脚本属性的层全部失效（真机上报里
//       "update:Cannot read properties of null (reading 'use24hFormat')" 刷屏即此）。
//   现在改用 `with (ctx) { ... }` 执行：裸赋值会写到 ctx 自己的属性上，
//   与 node:vm 的"顶层赋值即写 context"语义一致（脚本中途抛错时已完成的写入同样保留）。
//   为使用 with，剥掉转译后代码顶部的 'use strict'（with 在严格模式下是语法错误）；
//   WE 自己的脚本运行时也是非严格语义。
export function createContext(context) {
  return context;
}

export function runInContext(code, context, opts) {
  const src = String(code || '');
  // 顶层 'use strict' 会禁用 with → 仅剥掉开头这一个（脚本内部的 'use strict' 保留）
  const body = src.replace(/^\s*(['"])use strict\1\s*;?/, '');
  let fn;
  try {
    fn = new Function('__nslCtx', 'with (__nslCtx) {\n' + body + '\n}');
  } catch (e) {
    // with 包装失败（例如含顶层 import/export 等非法语句）→ 退回旧行为，至少不改变可用性
    try {
      const names = Object.keys(context);
      fn = new Function(...names, src);
      return fn.apply(context, names.map((n) => context[n]));
    } catch (e2) {
      throw new Error('vm shim parse error: ' + (e && e.message));
    }
  }
  try {
    return fn(context);
  } catch (e) {
    const err = new Error(e && e.message ? e.message : String(e));
    err.stack = e && e.stack ? e.stack : '';
    throw err;
  }
}

export default { createContext, runInContext };
