// types-check.mjs — TypeScript 作为**纯类型检查器**（`--noEmit`）的常驻门禁。
//
// 为什么是"检查器"而不是"重写成 TS"（决策见工作区 `docs/DECISION-LANGUAGES-20260923.md`）：
//   · 插件半边必须**单文件下发**（宿主按一个文件加载 `exports["./client"]`，相对 import 线上必挂，
//     `tools/integrity-check.mjs` ⑩ 有断言）；渲染器半边必须**直出源码**（`/bundle.js` 就是
//     `core/we-scene-bundle.js` 本体，多处门禁按**源码行**做守卫、`server` 里还有按字面量
//     `path.join(CORE_DIR, '<name>')` 抽路由的解析器）。两者都**不能引入构建步骤**。
//   ⇒ 让 TS 只做静态检查（`allowJs` + `checkJs` + `noEmit`），零运行期产物、零发布面变化。
//
// 覆盖范围（起步只收**纯逻辑小模块**：无 DOM 副作用、无 GL、可在 Node 侧直测）：
//   core/web-frame-host.mjs / core/web-frame-geometry.mjs / server/web-store.mjs
//   逐步扩大：每往 `tsconfig.check.json` 的 include 里加一个文件，都必须**零错误**才算完成。
//   实测已当场抓到 3 处真实不一致（`normalizeWebFrameMode` 的返回联合、`frameRect/frameViewport`
//   被防御式取值却标成必填、`webShimDowngradePlan` 的默认 `{}` 与必填参数冲突），并已修实。
//
// 判别力自证（`--selftest`）：临时造一个**故意含类型错误**的文件 + 一份临时 tsconfig，断言 tsc
// 真的报错 ⇒ 证明"绿灯"不是"tsc 没在干活"。缺 `node_modules/typescript` ⇒ SKIP（不假装通过）。
//
// 用法：
//   node tests/types-check.mjs             # 检查（缺 TS ⇒ SKIP，退出码 0）
//   node tests/types-check.mjs --selftest  # 只跑判别力自证
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { ROOT } from './_root.mjs'

const SELFTEST = process.argv.includes('--selftest')
let pass = 0, fail = 0
const ok = (c, label, extra = '') => { if (c) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }
const skip = (label, why) => console.log('SKIP ' + label + ' —— ' + why)

const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc')
const CONFIG = path.join(ROOT, 'tsconfig.check.json')
const haveTs = fs.existsSync(TSC)
if (!haveTs) { skip('types-check', '未安装 typescript（`npm i -D typescript` 后本项自动生效）'); process.exit(0) }

/** 跑一次 tsc，返回 `{ code, out }`（不抛：非零退出也是结果）。 */
const runTsc = (args, cwd) => {
  try {
    const out = execFileSync(process.execPath, [TSC, ...args], { cwd: cwd || ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, out: String(out) }
  } catch (e) {
    return { code: e.status === undefined ? -1 : e.status, out: String((e.stdout || '') + (e.stderr || '')) }
  }
}

if (SELFTEST) {
  console.log('[S] 判别力自证（故意写错必须变红）')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-ts-selftest-'))
  try {
    // ⚠ 夹具必须是**真错误**：`any ⇒ string` 是合法的（noImplicitAny=false 时裸参数就是 any），
    //   第一版就踩了这个 ⇒ 断言假红。用 `number` 赋给 `@type {string}`（TS2322）。
    fs.writeFileSync(path.join(dir, 'bad.mjs'), 'export function f() {\n  /** @type {string} */\n  const s = 42\n  return s\n}\n')
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', allowJs: true, checkJs: true, noEmit: true, strict: false, skipLibCheck: true, types: [] },
      include: ['bad.mjs'],
    }))
    const bad = runTsc(['-p', path.join(dir, 'tsconfig.json')], dir)
    ok(bad.code !== 0 && /TS2322|not assignable|不能将类型/.test(bad.out), 'S1 故意写错 ⇒ tsc 非零退出并指出类型不匹配', 'code=' + bad.code)
    fs.writeFileSync(path.join(dir, 'bad.mjs'), 'export function f() {\n  /** @type {string} */\n  const s = \'ok\'\n  return s\n}\n')
    const good = runTsc(['-p', path.join(dir, 'tsconfig.json')], dir)
    ok(good.code === 0, 'S2 把错误改掉 ⇒ tsc 归零（证明上面那条不是"总是红"）', 'code=' + good.code)
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }) } catch (e) {} }
  console.log('\n── selftest 汇总：PASS=' + pass + ' FAIL=' + fail)
  process.exit(fail > 0 ? 1 : 0)
}

const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'))
console.log(`typescript ${JSON.parse(fs.readFileSync(path.join(ROOT, 'node_modules/typescript/package.json'), 'utf8')).version} · 覆盖 ${cfg.include.length} 个文件：`)
for (const f of cfg.include) console.log('  · ' + f)
const r = runTsc(['-p', CONFIG])
if (r.code === 0) {
  console.log('✓ 类型检查 0 错误（`--noEmit`，零运行期产物）')
} else {
  console.log(r.out.trim().split('\n').slice(0, 30).join('\n'))
}
ok(r.code === 0, 'TypeScript 静态检查（--noEmit）零错误', 'tsc 退出码=' + r.code)
ok(cfg.compilerOptions && cfg.compilerOptions.noEmit === true, '配置是"只检查不产出"（noEmit=true）', 'noEmit=' + String(cfg.compilerOptions && cfg.compilerOptions.noEmit))
ok(Array.isArray(cfg.include) && cfg.include.length >= 3, '覆盖范围有下限（≥3 个纯逻辑模块）', 'include=' + cfg.include.length)

console.log(fail === 0 ? `ALL PASS (${pass} 项)` : `${pass} PASS / ${fail} FAIL`)
process.exit(fail === 0 ? 0 : 1)
