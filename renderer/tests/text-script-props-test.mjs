// text-script-props-test.mjs — 脚本属性（export var scriptProperties）回归测试
//
// 事故（用户："砂狼白子…视频能出来，文本加载不出来"；真机上报刷屏
// "update:Cannot read properties of null (reading 'use24hFormat')"）：
//   elysia/nsl.js 这个 node:vm 的浏览器替身把 context 键做成 `new Function` 的**形参**，
//   于是脚本顶层的 `export var scriptProperties = createScriptProperties()…`（转译成
//   `__scriptProps = …`）只写进局部变量、**不回写 context** → 宿主读到的属性对象是 null →
//   update() 里 `scriptProperties.use24hFormat` 抛 TypeError → 时钟/日期/FPS 等所有依赖
//   脚本属性的层永远停在 authored 占位值（Shiroko 的时钟就一直是 "12:34"）。
//
// 本测试用**真实 WE 时钟脚本**（从砂狼白子 mpkg 的 scene.json 抄来）跑真实脚本宿主。
import fs from 'node:fs'
import { applySceneScripts, createScriptCache } from '../elysia/scene-scripts.js'

let pass = 0, fail = 0
const ok = (c, n, d = '') => { if (c) { pass++; console.log('  ✓ ' + n + (d ? '  (' + d + ')' : '')) } else { fail++; console.error('  ✗ ' + n + (d ? '  (' + d + ')' : '')) } }

const CLOCK = `'use strict';

export var scriptProperties = createScriptProperties()
	.addCheckbox({ name: 'use24hFormat', label: 'x', value: true })
	.addCheckbox({ name: 'showSeconds', label: 'y', value: false })
	.addText({ name: 'delimiter', label: 'z', value: ':' })
	.finish();

export function update(value) {
	let time = new Date();
	var hours = time.getHours();
	if (!scriptProperties.use24hFormat) { hours %= 12; if (hours == 0) hours = 12; }
	hours = ("00" + hours).slice(-2);
	let minutes = ("00" + time.getMinutes()).slice(-2);
	value = hours + scriptProperties.delimiter + minutes;
	if (scriptProperties.showSeconds) { let s = ("00" + time.getSeconds()).slice(-2); value += scriptProperties.delimiter + s; }
	return value;
}`

console.log('[T1] 脚本属性对象必须可用（export var scriptProperties = createScriptProperties()…）')
{
  const scene = { objects: [{ id: 21, text: { script: CLOCK, value: '12:34' } }] }
  const errs = []
  const cache = createScriptCache()
  applySceneScripts(scene, 0, { scriptCache: cache, onError: (st, e) => errs.push(st + ':' + (e && e.message)) })
  ok(errs.length === 0, 'T1a 无 update 错误（属性对象不为 null）', JSON.stringify(errs.slice(0, 2)))
  const v = scene.objects[0].text.value
  ok(typeof v === 'string' && /^\d{2}:\d{2}$/.test(v), 'T1b 时钟文本已按当前时间生成', JSON.stringify(v))
  ok(v !== '12:34' || new Date().getHours() === 12 && new Date().getMinutes() === 34, 'T1c 不再停在 authored 占位值', JSON.stringify(v))
}

console.log('\n[T2] scene.json 里 scriptproperties 是 JSON 字符串时也要生效（作者存盘覆盖）')
{
  const sp = JSON.stringify({ delimiter: '-', showSeconds: false, use24hFormat: true })
  const scene = { objects: [{ id: 21, text: { script: CLOCK, value: 'x', scriptproperties: sp } }] }
  const cache = createScriptCache()
  applySceneScripts(scene, 0, { scriptCache: cache, onError: () => {} })
  const v = String(scene.objects[0].text.value)
  ok(/^\d{2}-\d{2}$/.test(v), 'T2 分隔符覆盖生效（":" → "-"）', JSON.stringify(v))
  const sp2 = JSON.stringify({ delimiter: ':', showSeconds: true, use24hFormat: true })
  const scene2 = { objects: [{ id: 21, text: { script: CLOCK, value: 'x', scriptproperties: sp2 } }] }
  applySceneScripts(scene2, 0, { scriptCache: createScriptCache(), onError: () => {} })
  const v2 = String(scene2.objects[0].text.value)
  ok(/^\d{2}:\d{2}:\d{2}$/.test(v2), 'T2b showSeconds 覆盖生效（带秒）', JSON.stringify(v2))
}

console.log('\n[T3] 12/24 小时制由属性驱动（脚本内 if 分支）')
{
  const sp12 = JSON.stringify({ use24hFormat: false, showSeconds: false, delimiter: ':' })
  const scene = { objects: [{ id: 21, text: { script: CLOCK, value: 'x', scriptproperties: sp12 } }] }
  applySceneScripts(scene, 0, { scriptCache: createScriptCache(), onError: () => {} })
  const h = Number(String(scene.objects[0].text.value).slice(0, 2))
  ok(h >= 1 && h <= 12, 'T3 12 小时制生效（小时 ∈ [1,12]）', 'h=' + h)
}

console.log('\n[T4] localStorage 脚本 API（WE 命名 get/set，上报里的 "localStorage.get is not a function"）')
{
  const src = `'use strict';
export function init(v) { localStorage.set('dur', 1.5); return v }
export function update(v) { const d = localStorage.get('dur', 1); return String(Number(d) * 2) }`
  const scene = { objects: [{ id: 1, text: { script: src, value: '0' } }] }
  const errs = []
  applySceneScripts(scene, 0, { scriptCache: createScriptCache(), onError: (st, e) => errs.push(st + ':' + (e && e.message)) })
  ok(errs.length === 0, 'T4a 无 init/update 错误', JSON.stringify(errs.slice(0, 2)))
  ok(String(scene.objects[0].text.value) === '3', 'T4b set/get 生效（1.5×2=3）', String(scene.objects[0].text.value))
  const src2 = `'use strict';
export function update(v) { localStorage.setItem('a', 7); return String(localStorage.getItem('a')) }`
  const scene2 = { objects: [{ id: 1, text: { script: src2, value: '0' } }] }
  applySceneScripts(scene2, 0, { scriptCache: createScriptCache(), onError: () => {} })
  ok(String(scene2.objects[0].text.value) === '7', 'T4c Storage 命名别名可用', String(scene2.objects[0].text.value))
}

console.log(`\ntext-script-props-test：${pass} pass / ${fail} fail`)
if (fail > 0) process.exit(1)
