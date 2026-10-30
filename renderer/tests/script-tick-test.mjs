// script-tick-test.mjs — N7（第12项）脚本宿主补完：真实 frametime + 文本/时钟/帧率类脚本 ≥30Hz
// 复现：node script-tick-test.mjs
//
// 定案（docs/TEXT-AND-CLOCK-RESEARCH.md §3 H6/H7）：
//   · WE **没有** FPS API —— 语料里的"帧率显示"是文本脚本自己计时 `fps = 1000/(now-oldFrame)`，
//     靠"宿主多久调一次 update"成立：4Hz 节拍下恒显示 `fps: 4`（60Hz 节拍 → `fps: 60`）。
//   · `engine.frametime` 官方语义 = 上一帧真实秒数；旧实现从不传 → 恒 1/60，22 个容器积分量错。
// 本测试用**语料真实 FPS 脚本**（3326873240 等 16 个容器共用同一份）+ 真实脚本宿主，
// 按两种节拍实际跑一遍，读回文本；另测 nodeFilter（节拍分层）与 fireUpdate（回调不重复触发）。
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import path from 'node:path'
import * as lib from '../core/we-scene-bundle.js'
import { applySceneScripts, createScriptCache } from '../elysia/scene-scripts.js'

let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 语料原文（3326873240 scene.json 内 objects[*].text.script；16 个容器共用）
const FPS_SCRIPT_FALLBACK = `'use strict';

export var scriptProperties = createScriptProperties()
	.addCheckbox({ name: 'active', label: 'FPS counter (ON/OFF)', value: true })
	.addSlider({ name: 'refreshInterval', label: 'Refresh interval (in milliseconds)', value: 500, min: 0, max: 1000, integer: false })
	.addText({ name: 'label', label: 'Label', value: 'fps:' })
	.finish();

var currentFrame, oldFrame = 0, fps, totFps = 0, oldTime = 0, n = 0;

export function update(value) {
	if (scriptProperties.active){
		let time = new Date();
		if (oldFrame == 0){ oldFrame = time.getTime(); oldTime = oldFrame; }
		currentFrame = time.getTime();
		if (currentFrame > oldFrame){
			fps = 1000 / (currentFrame - oldFrame);
			oldFrame = currentFrame;
			totFps += fps;
			n++;
			if (currentFrame - oldTime >= parseInt(scriptProperties.refreshInterval)){
				totFps /= n;
				value = scriptProperties.label + ' ' + Math.round(totFps);
				oldTime = currentFrame;
				n = 0;
				totFps = 0;
			}
		}
		return value;
	}
}`
function realFpsScript() {
  const cands = [
    (process.env.MPW_SCENE_ROOT || path.join(WS, 'allwallpaper', 'dd')) + '/3326873240/scene.pkg',
    (process.env.MPW_SCENE_ROOT || path.join(WS, 'allwallpaper', 'dd')) + '/3327063360/scene.pkg',
  ]
  for (const p of cands) {
    if (!fs.existsSync(p)) continue
    try {
      const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(p)))
      const rd = (b) => new TextDecoder().decode(b).replace(/^\uFEFF/, '')
      const sj = JSON.parse(rd(lib.getEntry(pkg, 'scene.json')))
      let hit = null
      const walk = (o) => {
        if (!o || typeof o !== 'object' || hit) return
        if (typeof o.script === 'string' && /fps\s*=\s*1000\s*\/\s*\(/.test(o.script)) { hit = o.script; return }
        for (const k of Object.keys(o)) walk(o[k])
      }
      walk(sj)
      if (hit) return { src: hit, from: p }
    } catch (e) { /* 下一个候选 */ }
  }
  return { src: FPS_SCRIPT_FALLBACK, from: 'inline(语料原文verbatim)' }
}

console.log('[N7] 脚本节拍 + frametime（真实语料 FPS 脚本 + 真实宿主）')

// ── T1/T2 两种节拍下的文本 ───────────────────────────────────────────────
function mkFpsScene(src) {
  const scene = { objects: [{ id: 1, name: '帧率显示', text: { script: src, value: 'fps:', scriptproperties: { active: true, label: 'fps:', refreshInterval: 500 } } }] }
  const cache = createScriptCache()
  return { scene, cache, node: scene.objects[0].text }
}
async function tickFor(ms, hz, src) {
  const { scene, cache, node } = mkFpsScene(src)
  const dt = 1000 / hz
  const t0 = Date.now()
  let t
  while ((t = Date.now() - t0) < ms) {
    applySceneScripts(scene, (Date.now() - t0) / 1000, { scriptCache: cache, renderObjects: scene.objects, canvasSize: { x: 1280, y: 720 }, frametime: dt / 1000 })
    await sleep(dt)
  }
  return String(node.value)
}
const fpsSrc = realFpsScript()
console.log('  语料 FPS 脚本来源: ' + fpsSrc.from + '（' + fpsSrc.src.split('\n').length + ' 行）')
{
  const txt60 = await tickFor(1400, 60, fpsSrc.src)
  const n60 = Number((txt60.match(/(-?\d+(?:\.\d+)?)\s*$/) || [])[1])
  check('T1a ~60Hz 节拍 → 文本含真实帧率（不是 4）', isFinite(n60) && n60 >= 25 && n60 <= 120, 'text="' + txt60 + '"')
  const txt4 = await tickFor(1500, 4, fpsSrc.src)
  const n4 = Number((txt4.match(/(-?\d+(?:\.\d+)?)\s*$/) || [])[1])
  check('T1b ~4Hz 节拍（旧实现口径）→ 文本恒为 "fps: 4"', n4 === 4, 'text="' + txt4 + '"')
  check('T1c 高节拍读数 > 低节拍读数 ×5（节拍真的进了脚本）', n60 > n4 * 5, n60 + ' vs ' + n4)
}

// ── T3 真实 frametime（每次运行刷新，不是编译期冻结）──────────────────────
console.log('[T2] engine.frametime 每次运行刷新')
{
  const src = `export function update(value) { return 'ft:' + Number(engine.frametime).toFixed(4) }`
  const scene = { objects: [{ id: 7, name: 't', text: { script: src, value: 'ft:' } }] }
  const cache = createScriptCache()
  const node = scene.objects[0].text
  applySceneScripts(scene, 0, { scriptCache: cache, renderObjects: scene.objects, frametime: 0.0167 })
  const a = String(node.value)
  applySceneScripts(scene, 0.0167, { scriptCache: cache, renderObjects: scene.objects, frametime: 0.0333 })
  const b = String(node.value)
  check('T2a 第一次 = 0.0167', a === 'ft:0.0167', a)
  check('T2b 第二次 = 0.0333（同一条缓存脚本，值被刷新 → 不是恒 1/60）', b === 'ft:0.0333', b)
  const scene2 = { objects: [{ id: 8, name: 't2', text: { script: src, value: 'ft:' } }] }
  const cache2 = createScriptCache()
  applySceneScripts(scene2, 0, { scriptCache: cache2, renderObjects: scene2.objects })
  check('T2c 不传 frametime → 兼容旧行为 1/60', String(scene2.objects[0].text.value) === 'ft:0.0167', String(scene2.objects[0].text.value))
}

// ── T4 nodeFilter：高频趟只跑文本层节点 ─────────────────────────────────
console.log('[T3] nodeFilter（节拍分层的实现基础）')
{
  const bump = `var n = 0; export function update(value) { n++; return String(n) }`
  const bumpOrigin = bump + '\n// 独立源（脚本缓存按源共享，同源会共用计数器）'
  const scene = { objects: [
    { id: 11, name: '文本层', text: { script: bump, value: '0' } },
    { id: 12, name: '框架层', origin: { script: bumpOrigin, value: '1 2 3' } },
  ] }
  const cache = createScriptCache()
  const opts = { scriptCache: cache, renderObjects: scene.objects }
  // 只选 id=11（文本层）的节点
  applySceneScripts(scene, 0, { ...opts, nodeFilter: (obj, owner) => !!(owner && owner.id === 11) })
  const t1 = String(scene.objects[0].text.value)
  const o1 = String(scene.objects[1].origin.value)
  check('T3a 过滤器命中：文本节点跑了 update', t1 === '1', 'text=' + t1)
  check('T3b 未命中：框架层 origin 节点**未**跑（value 保持 authored 非纯数字 → 不动）', o1 === '1 2 3', 'origin=' + o1)
  applySceneScripts(scene, 0.1, { ...opts, nodeFilter: (obj, owner) => !!(owner && owner.id === 11) })
  check('T3c 第二次高频趟：文本节点继续推进（2），框架层仍是 authored', String(scene.objects[0].text.value) === '2' && String(scene.objects[1].origin.value) === '1 2 3')
  applySceneScripts(scene, 0.3, opts)
  check('T3d 不传过滤器（4Hz 全量趟）：两个节点都跑', String(scene.objects[1].origin.value).startsWith('1'), 'origin=' + scene.objects[1].origin.value)
}

// ── T5 fireUpdate：高频趟不重复触发 scene.on('update') ───────────────────
console.log('[T4] fireUpdate（高频趟不放大作者 update 回调）')
{
  const src = `export function init() { scene.on('update', () => { shared.cnt = (shared.cnt || 0) + 1 }) }`
  const mk = () => {
    const scene = { objects: [{ id: 21, name: '框架', visible: { script: src, value: true } }] }
    return { scene, cache: createScriptCache() }
  }
  const a = mk()
  applySceneScripts(a.scene, 0, { scriptCache: a.cache, renderObjects: a.scene.objects, fireUpdate: false })
  applySceneScripts(a.scene, 0.016, { scriptCache: a.cache, renderObjects: a.scene.objects, fireUpdate: false })
  check('T4a fireUpdate:false → 回调 0 次', (a.cache.shared.cnt || 0) === 0, 'cnt=' + (a.cache.shared.cnt || 0))
  const b = mk()
  applySceneScripts(b.scene, 0, { scriptCache: b.cache, renderObjects: b.scene.objects })
  applySceneScripts(b.scene, 0.016, { scriptCache: b.cache, renderObjects: b.scene.objects })
  check('T4b 默认（4Hz 趟）→ 回调仍按官方语义触发', (b.cache.shared.cnt || 0) === 2, 'cnt=' + (b.cache.shared.cnt || 0))
}

// ── T6 demo.html 接线（节拍常数 / 文本层过滤器 / frametime 传递）──────────
console.log('[T5] demo.html 接线')
{
  const html = fs.readFileSync(new URL('../demo.html', import.meta.url), 'utf8')
  check('T5a 默认 30Hz + ?scripthz 覆盖（启动时解析一次）',
    /SCRIPT_FAST_HZ = \(\(\) => \{/.test(html) && /Math\.min\(120, v\) : 30/.test(html) && /get\('scripthz'\)/.test(html)
    && /SCRIPT_FAST_HZ > 0 && \(tSec - scriptLastFast >= 1 \/ SCRIPT_FAST_HZ\)/.test(html))
  check('T5b 只对文本层脚本节点提频（__text id 集合 + owner.id 命中）',
    /function textScriptFilter\(obj, owner\)/.test(html) && /textLayerScriptIds/.test(html) && /nodeFilter: fastOnly \? textScriptFilter : null/.test(html))
  /* ①(2026-09-22 上游 9e287ea) **契约更新**：仍然要求"真实帧间隔一路传到脚本"，但两处现在都过
     `mpwCapScriptDt(frameDt)`（单帧封顶 0.05s：卡顿后部件不再甩飞）。旧写法（裸 frameDt）出现即红。 */
  check('T5c 渲染循环传真实帧间隔（frameDt → 封顶 → runSceneScripts → frametime）',
    /const frameDt = /.test(html) && /runSceneScripts\(tSec, mpwSceneDt\(mpwCapScriptDt\(frameDt\)\)\)/.test(html)
    && /frametime: mpwCapScriptDt\(frameDt\)/.test(html)
    && !/frametime: \(typeof frameDt === 'number'/.test(html))
  check('T5d 4Hz 慢档仍在（非文本脚本不被提频）', /setTimeout|tSec - scriptLastRun >= 0\.25/.test(html) && /fireUpdate: !fastOnly/.test(html))
}

console.log('\n' + (fail === 0 ? '全部通过' : '存在失败') + `：${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
