// RE-35 验证：init 失败永久禁用、update 失败仅跳帧、undefined 保持 authored、API shim 可调用
import { applySceneScripts, createScriptCache } from '../elysia/scene-scripts.js'
const checks = []
const push = (n, ok, d) => { checks.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`) }

// ① init 抛错 → 永久禁用（update 不再被调用）
let updateCalls = 0
const src1 = `export function init(v) { throw new Error('init boom') }\nexport function update(v) { return 'x' + v }`
const scene1 = { objects: [{ id: 1, text: { script: src1, value: 'a' } }] }
let initErrs = 0
const cache1 = createScriptCache()
for (let i = 0; i < 3; i++) applySceneScripts(scene1, i, { scriptCache: cache1, onError: (st) => { if (st === 'init') initErrs++ } })
push('init 失败 → 永久禁用（只报一次）', initErrs === 1, 'initErrs=' + initErrs)
push('init 失败 → authored 值保持', scene1.objects[0].text.value === 'a', JSON.stringify(scene1.objects[0].text.value))

// ② update 抛错 → 本帧跳过、下帧继续（错误计数递增，值保持）
const src2 = `export function update(v) { if (globalThis.__c === undefined) globalThis.__c = 0; globalThis.__c++; if (globalThis.__c === 2) throw new Error('update boom'); return 'v' + globalThis.__c }`
const scene2 = { objects: [{ id: 1, text: { script: src2, value: 'a' } }] }
const cache2 = createScriptCache()
let updErrs = 0
applySceneScripts(scene2, 0, { scriptCache: cache2, onError: (st) => { if (st === 'update') updErrs++ } })
const afterFirst = scene2.objects[0].text.value
applySceneScripts(scene2, 1, { scriptCache: cache2, onError: (st) => { if (st === 'update') updErrs++ } })
const afterFail = scene2.objects[0].text.value
applySceneScripts(scene2, 2, { scriptCache: cache2, onError: (st) => { if (st === 'update') updErrs++ } })
const afterThird = scene2.objects[0].text.value
push('update 失败 → 只跳本帧（错误计1）', updErrs === 1, 'updErrs=' + updErrs)
push('update 失败 → 值保持上一帧', afterFail === afterFirst, `${afterFirst} → ${afterFail}`)
push('update 失败 → 下帧继续更新', afterThird === 'v3', String(afterThird))

// ③ 未实现 API shim：localIZE/systemInfo/registerAudioBuffers 可安全调用
const src3 = `export function update(v) {
  const s = engine.localIZE('你好'); const s2 = engine.localize('hi');
  const p = engine.systemInfo.platform;
  const b = engine.registerAudioBuffers(engine.AUDIO_RESOLUTION_16);
  return s + '|' + s2 + '|' + p + '|' + b.average.length
}`
const scene3 = { objects: [{ id: 1, text: { script: src3, value: 'a' } }] }
applySceneScripts(scene3, 0, { scriptCache: createScriptCache() })
push('API shim：localIZE/localize/systemInfo/registerAudioBuffers 可用', scene3.objects[0].text.value === '你好|hi|windows|16', String(scene3.objects[0].text.value))

// ④ update 返回 undefined → authored 值保持
const src4 = `export function update(v) { return undefined }`
const scene4 = { objects: [{ id: 1, text: { script: src4, value: 'keep-me' } }] }
applySceneScripts(scene4, 0, { scriptCache: createScriptCache() })
push('update 返回 undefined → authored 值保持', scene4.objects[0].text.value === 'keep-me', String(scene4.objects[0].text.value))

// ⑤ 编译失败 → 无可用导出 → 静态值保持，宿主不崩
const scene5 = { objects: [{ id: 1, text: { script: 'export function update(v) { this is not js (', value: 'static' } }] }
applySceneScripts(scene5, 0, { scriptCache: createScriptCache() })
push('编译失败 → 静态值保持、不抛异常', scene5.objects[0].text.value === 'static', String(scene5.objects[0].text.value))

// ⑥ RE-34：宿主提供真实音频数据时 registerAudioBuffers 用真值；无宿主时静默全 0
const src6 = `export function update(v) { const b = engine.registerAudioBuffers(4); return b.average.join(',') }`
const scene6 = { objects: [{ id: 1, text: { script: src6, value: 'x' } }] }
applySceneScripts(scene6, 0, { scriptCache: createScriptCache(), audioBuffers: (n) => ({ left: new Array(n).fill(0.25), right: new Array(n).fill(0.5), average: new Array(n).fill(0.75) }) })
push('RE-34：宿主音频数据透传到 registerAudioBuffers', scene6.objects[0].text.value === '0.75,0.75,0.75,0.75', String(scene6.objects[0].text.value))
const scene7 = { objects: [{ id: 1, text: { script: src6, value: 'x' } }] }
applySceneScripts(scene7, 0, { scriptCache: createScriptCache(), audioBuffers: () => null })
push('RE-34：无音频时静默全 0（脚本不崩）', scene7.objects[0].text.value === '0,0,0,0', String(scene7.objects[0].text.value))

const pass = checks.filter(Boolean).length
console.log(`\n${pass}/${checks.length} 通过（RE-35 脚本容错）`)
process.exit(pass === checks.length ? 0 : 1)
