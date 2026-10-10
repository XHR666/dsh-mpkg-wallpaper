// audio-bus-set-prune-test.mjs —— `adopted`/`media` 两个**强引用集合**的清理谓词判据（2026-10-11 审计 #6/#7/#9 残留）
//
// 背景：`lib/audio-bus.js` 的状态容器里 `masters`/`hostVerdict`(WeakMap) 与
// `mediaMutedByUs`/`tappedMedia`/`masterParams`/`gainParams`(WeakSet) 都已是弱引用 ✓，
// 但 `adopted`(`Set<AudioContext>`) 与 `media`(`Set<MediaElement>`) **必须强引用**（弱引用无法遍历，
// 而静音/解除必须能枚举 ✗）⇒ 原先**只增不减**，长会话反复挂载/卸载会单调增长 ✗。
// 修法：借既有的每拍遍历**零成本**剔除"确定已死"的对象（`ctx.state==='closed'`；
// 元素则要求"已脱离文档 **且** 已暂停 **且** 无源"⇒ 不可能出声才删 ✓）。
//
// 本判据做**结构断言**（在源文件里定位两处遍历，确认剔除谓词存在且位置正确）；
// 行为面由仓库既有的音频判据族覆盖（`audio-mute-discipline-test` / `audio-bus-test` 等）。
// 性质说明：这是**结构判据**，不是行为仿真（结构判据足够钉住"谓词被误删"这类回归 ✗）。
import fs from 'node:fs'
import path from 'node:path'
const ROOT = path.resolve(import.meta.dirname, '..')
const src = fs.readFileSync(path.join(ROOT, 'lib', 'audio-bus.js'), 'utf8')
const rows = []
const ok = (why, cond, detail = '') => rows.push({ why, pass: !!cond, detail: String(detail) })

// ① adopted：遍历里必须有"closed ⇒ delete + continue"
const adoptedLoop = /for \(const ctx of state\.adopted\) \{[\s\S]{0,600}?state\.adopted\.delete\(ctx\);\s*continue/.test(src)
ok('adopted 遍历内存在"已关闭 ⇒ 剔除 + continue"（零成本清理）', adoptedLoop)
ok('adopted 剔除判据用的是**终态** `ctx.state === \'closed\'`（无假阳性）', /ctx\.state === 'closed'[\s\S]{0,80}state\.adopted\.delete\(ctx\)/.test(src))

// ② media：枚举里必须有"孤儿 ⇒ delete + continue"，且三条件同时成立（保守）
const mediaLoop = /for \(const el of state\.media\) \{[\s\S]{0,900}?state\.media\.delete\(el\);\s*continue/.test(src)
ok('media 遍历内存在"孤儿 ⇒ 剔除 + continue"', mediaLoop)
const guard = /el\.isConnected === false && el\.paused === true && !el\.currentSrc && !el\.src/.test(src)
ok('media 剔除的**三条件**齐备（脱离文档 且 已暂停 且 无源 ⇒ 不可能出声）', guard)
ok('媒体枚举仍会 push 存活元素（清理是"跳过"而非"丢弃整表"）', /out\.push\(el\)/.test(src))

// ③ 反回归：两个集合的定义不得被改成 WeakSet（弱引用无法遍历 ⇒ 静音会失效 ✗）
ok('`adopted` 仍是强引用 Set（不得改 WeakSet）', /adopted:\s*new Set\(\)/.test(src))
ok('`media` 仍是强引用 Set（不得改 WeakSet）', /media:\s*new Set\(\)/.test(src))

// ④ 生成区纪律：源文件里不应出现生成标记（标记属于 lib/client.js ✗）
ok('源文件 `lib/audio-bus.js` 不被生成标记污染（MPW-AUDIO-BUS-* 只应出现在 client.js）',
  !/MPW-AUDIO-BUS-(BEGIN|END)/.test(src))

const fail = rows.filter((r) => !r.pass)
for (const r of rows) console.log((r.pass ? '  ✓ ' : '  ✗ ') + r.why)
console.log(`===== audio-bus-set-prune: ${rows.length - fail.length} 通过 / ${fail.length} 失败 =====`)
process.exit(fail.length ? 1 : 0)
