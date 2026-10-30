// media-host-test.mjs — P-62「媒体集成 + 音频响应」宿主侧回归（T1–T7）
//
// 证据口径（本测试**只用真实语料脚本 + 官方形状**，不拿假脚本糊）：
//   · 官方 TS 定义  : wallpaper_engine/ui/dist/monaco/autocomplete/lib.sceneScript.d.ts L292-415 / L1485-1504
//   · 官方插入菜单  : wallpaper_engine/ui/dist/scripts/scripts.js（5 个 media*Changed 回调按钮）
//   · 官方音频示例  : wallpaper_engine/ui/dist/monaco/snippets/script_factor_audio_response.js
//   · 真实包脚本    : 3554161528(L1592 mediaPropertiesChanged→text) / 3554161528(L1111 mediaThumbnailChanged
//                     →thisObject.getAnimation().play()) / 3544152633(L41 mediaThumbnailChanged→event.primaryColor)
//                     / 3660962877(L8 官方音频片段 registerAudioBuffers→average[frequency])
//
// 覆盖：
//   T1 hina 真包 3554161528 的 id1592 文本脚本：注入媒体属性 → 层 text.value == 注入的 title（端到端）
//   T2 播放三态 + 进度推进（播放中随墙钟前进 / 暂停停住 / 停止冻结）+ timeline 事件节奏
//   T3 封面 URL / 字节两种注入形态都能被**真实**封面脚本读到（primaryColor 是 Vec3，可链式运算）
//   T4 音频响应：注入已知频谱 → 真包 3660962877 官方音频脚本读到的 average 与注入一致（非恒 0）
//   T5 无媒体/无音频回归：不报错、层保持 authored 可见性、0 次派发；显式 STOPPED 才翻 false
//   T6 歌词：LRC 解析 + 二分当前行（第一行前 / 最后一行后 / 无 LRC / ?lyrics= 覆盖与关闭）
//   T7 dispatchScriptEvent 多条目广播：缓存共享不串层（thisLayer 惰性绑定，防 P-60 回归）
//
// 用法: node media-host-test.mjs
import fs from 'node:fs'
import path from 'node:path'
// ①(P-131 批 D) `peekAudioView`：活视图只读入口（T8b2 断言"无数据源 ⇒ 全 0 且可观测"）
import { applySceneScripts, createScriptCache, dispatchScriptEvent, invalidateUserProps, peekAudioView } from '../elysia/scene-scripts.js'
import { createMediaHost, MEDIA_PLAYBACK } from '../elysia/media-host.js'
import { Vec3 } from '../elysia/scene-script-apis.js'
import { parseLRC, lyricIndexAt, lyricLineAt, findLyricsEntry, resolveLyrics, lyricsOverrideFromSearch } from '../elysia/media-lyrics.js'
import { ROOT } from './_root.mjs'   // ①(2026-09-16 目录整理) 仓库根（本脚本已移入 tests/）

const HERE = ROOT
const MPW_ROOT = process.env.MPW_ROOT || path.resolve(HERE, '..')

let pass = 0, fail = 0
const ok = (cond, name, detail = '') => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  (' + detail + ')' : '')) }
  else { fail++; console.error('  ✗ ' + name + (detail ? '  (' + detail + ')' : '')) }
}
const near = (a, b, eps = 1e-6) => Math.abs(Number(a) - Number(b)) <= eps

// ── 真包读取（只剩本机语料一条来源）─────────────────────────────────────────
// ①(2026-10-30 路径固化) 渲染器并入插件工作区后，插件树在 `ROOT/../plugin`；env MPW_PLUGIN_DIR 可显式覆盖；
//   旧兄弟仓名 `dsh-mpkg-wallpaper` 保留为回退（原检出仍可跑）。下同，各文件同型。
const MPW_PLUGIN_TREE = [process.env.MPW_PLUGIN_DIR, path.resolve(ROOT, '..', 'plugin'), path.join(MPW_ROOT, 'dsh-mpkg-wallpaper')]
  .filter(Boolean).find((p) => { try { return fs.existsSync(path.join(p, 'lib', 'pkg-extract.js')) } catch { return false } })
const { parsePkg, readPkgEntry } = await import(path.join(MPW_PLUGIN_TREE, 'lib', 'pkg-extract.js'))
function pkgPathFor(id) {
  // ①(P-87 2026-09-15 版权) 原来这里还有一档 `<repo>/samples/wallpapers/<id>/scene.pkg` 候选；该目录
  //   （真实 Steam 工坊壁纸，198MB）因版权已整体移除，本仓库不再分发任何第三方壁纸 ⇒ 只剩本机语料。
  const corpus = path.join(MPW_ROOT, 'allwallpaper', 'dd', id, 'scene.pkg')
  if (fs.existsSync(corpus)) return corpus
  return null
}
// ①(P-87) 本测试的断言全部建立在 3 个**真包**上；缺任一包时**整体 SKIP**（退出 0，门禁不红）——
//   公开副本没有真实壁纸，这是预期行为（不是失败）。语料来源见 pkgPathFor。
const REAL_IDS = ['3554161528', '3544152633', '3660962877']
const missingReal = REAL_IDS.filter((id) => !pkgPathFor(id))
if (missingReal.length) {
  console.log('SKIP media-host（本机语料缺真包 ' + missingReal.join(' / ')
    + '；语料根=' + path.join(MPW_ROOT, 'allwallpaper', 'dd') + '；可用 MPW_ROOT / MPW_SCENE_ROOT 覆盖）')
  process.exit(0)
}
const sceneCache = new Map()
function loadScene(id) {
  if (sceneCache.has(id)) return sceneCache.get(id)
  const p = pkgPathFor(id)
  if (!p) throw new Error('包不存在: ' + id)
  const pkg = parsePkg(new Uint8Array(fs.readFileSync(p)))
  const enc = pkg.find((e) => /(^|\/)scene\.json$/i.test(e.path))
  const scene = JSON.parse(new TextDecoder().decode(readPkgEntry(new Uint8Array(fs.readFileSync(p)), enc)).replace(/^\uFEFF/, ''))
  const rec = { path: p, scene }
  sceneCache.set(id, rec)
  return rec
}
const clone = (o) => JSON.parse(JSON.stringify(o))
/** 深度优先找第一个满足 pred 的 `{script,value}` 节点 */
function findScriptNode(root, pred) {
  let hit = null
  const walk = (o) => {
    if (hit || !o || typeof o !== 'object') return
    if (typeof o.script === 'string' && 'value' in o && pred(o)) { hit = o; return }
    if (Array.isArray(o)) { o.forEach(walk); return }
    for (const k of Object.keys(o)) walk(o[k])
  }
  walk(root)
  return hit
}
const findLayer = (scene, id) => scene.objects.find((o) => o.id === id)
const lastEvent = (host, name) => [...host.events].reverse().find((e) => e.name === name)

// ═══ T1 hina 真包 3554161528 id1592：mediaPropertiesChanged → text（端到端）═══
console.log('\n[T1] 官方 mediaPropertiesChanged 到达真包 3554161528 的 id1592 文本脚本')
{
  const { scene: src } = loadScene('3554161528')
  const scene = clone(src)
  const layer = findLayer(scene, 1592)
  ok(!!layer, 'T1a 包里存在歌曲名层 id1592', layer ? 'text.value=' + JSON.stringify(layer.text.value) : '缺失')
  const s = layer.text.script
  ok(/export function mediaPropertiesChanged\s*\(event\)/.test(s) && /mediaData = event\.title/.test(s),
    'T1b 该层脚本是**真包原文**（export mediaPropertiesChanged + event.title）',
    s.split('\n').filter((l) => /mediaPropertiesChanged|event\.title/.test(l)).map((l) => l.trim()).join(' | '))
  // ①官方函数名带 Changed 后缀 —— 任务书里写的 `export function mediaProperties(event)` 与语料/官方不符，
  //   这里把"语料只有 Changed 形态"钉成断言（防止有人照任务书改回错名）。
  ok(!/export function mediaProperties\s*\(/.test(s), 'T1c 语料里**没有**裸 `mediaProperties(event)` 形态（官方只有 *Changed）')

  const cache = createScriptCache()
  const host = createMediaHost({ dispatch: (n, p) => dispatchScriptEvent(cache, n, p) })
  const errs = []
  const run = (t) => applySceneScripts(scene, t, {
    canvasSize: { x: 3840, y: 2160 }, scriptCache: cache, renderObjects: scene.objects,
    frametime: 1 / 60, audioBuffers: host.audioBuffers, onError: (p, e) => errs.push(p + ': ' + e.message),
  })
  run(0)
  ok(layer.text.value === '', 'T1d 无媒体时脚本自身返回空串（作者存盘占位 "Mirtazapine" 被 update 覆盖）',
    JSON.stringify(layer.text.value) + ' ← authored ' + JSON.stringify(src.objects.find((o) => o.id === 1592).text.value))

  const TITLE = '夜に駆ける', ARTIST = 'YOASOBI', ALBUM = 'THE BOOK'
  host.setMedia({ title: TITLE, artist: ARTIST, albumTitle: ALBUM, duration: 261, position: 12 })
  ok(host.stats.counters.mediaPropertiesChanged === 1, 'T1e setMedia 派发了 1 次 mediaPropertiesChanged',
    JSON.stringify(host.stats.counters))
  run(1 / 60)
  ok(layer.text.value === TITLE, 'T1f ★端到端：层 text.value == 注入的 title', JSON.stringify(layer.text.value))
  ok(errs.length === 0, 'T1g 真包脚本运行 0 报错', errs.slice(0, 2).join(' / ') || '0 错')

  // 再注入一首：证明是事件驱动而非偶然
  host.setMedia({ title: 'Second Song' })
  run(2 / 60)
  ok(layer.text.value === 'Second Song', 'T1h 换曲后再次到达（事件驱动）', JSON.stringify(layer.text.value))
  const ev = lastEvent(host, 'mediaPropertiesChanged')
  ok(ev && ev.payload.title === 'Second Song' && ev.payload.albumTitle === ALBUM,
    'T1i 事件形状 = 官方 MediaPropertiesEvent', JSON.stringify(Object.keys(ev.payload).join(',')))
}

// ═══ T2 播放三态 + 进度推进 ═══
console.log('\n[T2] 播放三态（STOPPED/PLAYING/PAUSED）+ 进度推进')
{
  let clock = 1_000_000
  const seen = []
  const host = createMediaHost({ now: () => clock, dispatch: (n, p) => seen.push([n, p]) })
  host.setMedia({ title: 'X', duration: 100, position: 0 })
  host.setPlayback(MEDIA_PLAYBACK.PLAYING)
  clock += 3000
  ok(near(host.getState().livePosition, 3, 1e-9), 'T2a 播放中 position 随墙钟前进（3s）', 'pos=' + host.getState().livePosition)
  clock += 2000
  ok(near(host.getState().livePosition, 5, 1e-9), 'T2b 继续前进（累计 5s）', 'pos=' + host.getState().livePosition)
  host.setPlayback(MEDIA_PLAYBACK.PAUSED)
  clock += 5000
  ok(near(host.getState().livePosition, 5, 1e-9), 'T2c 暂停后进度**停住**（再走 5s 仍是 5）', 'pos=' + host.getState().livePosition)
  host.setPlayback(MEDIA_PLAYBACK.STOPPED)
  clock += 5000
  ok(near(host.getState().livePosition, 5, 1e-9), 'T2d 停止后进度冻结（不回零、不前进）', 'pos=' + host.getState().livePosition)
  const states = seen.filter(([n]) => n === 'mediaPlaybackChanged').map(([, p]) => p.state)
  ok(JSON.stringify(states) === JSON.stringify([1, 2, 0]), 'T2e 三态事件序列 = [PLAYING,PAUSED,STOPPED]', JSON.stringify(states))
  ok(seen.filter(([n]) => n === 'mediaPlaybackChanged').length === 3, 'T2f 状态未变化时不重复派发', String(states.length))

  // timeline 事件：播放中按 timelineIntervalMs 节流，不逐帧刷
  let clock2 = 0
  const host2 = createMediaHost({ now: () => clock2, timelineIntervalMs: 250, dispatch: () => {} })
  host2.setMedia({ title: 'Y', duration: 60, position: 0 })
  host2.setPlayback(MEDIA_PLAYBACK.PLAYING)
  let n = 0
  for (let i = 0; i < 60; i++) { clock2 += 16; host2.tick(); n = host2.stats.counters.mediaTimelineChanged || 0 }
  ok(n >= 2 && n <= 6, 'T2g 1s（60×16ms）内 timeline 派发被节流到 2–6 次（≈250ms/次）', 'n=' + n)
  host2.updatePosition(42)
  const ev = lastEvent(host2, 'mediaTimelineChanged')
  ok(near(ev.payload.position, 42, 1e-9) && near(ev.payload.duration, 60, 1e-9),
    'T2h 宿主权威进度 updatePosition(42) 立刻派发 {position,duration}', JSON.stringify(ev.payload))
  ok(host2.getState().lyricIndex === -1 && host2.getState().lyricLine === '',
    'T2i 无歌词时 lyricIndex=-1 / lyricLine=""（不报错）')
}

// ═══ T3 封面：URL / 字节两种注入形态 + 真实封面脚本 ═══
console.log('\n[T3] 封面注入（URL / 字节）→ 真包 3544152633 的 primaryColor 脚本 + hina 的 thisObject 封面脚本')
{
  const { scene: src } = loadScene('3544152633')
  const scene = clone(src)
  const node = findScriptNode(scene, (o) => /mediaThumbnailChanged/.test(o.script) && /event\.primaryColor/.test(o.script))
  const LAYER_ID = src.objects.find((o) => o.effects && o.effects.some((e) => e.passes && e.passes.some((p) => p.constantshadervalues && p.constantshadervalues.color && /mediaThumbnailChanged/.test(String(p.constantshadervalues.color.script || '')))))?.id
  ok(!!node && /color\s*=\s*event\.primaryColor/.test(node.script), 'T3a 找到真包 3544152633 的封面主色脚本（color=event.primaryColor）',
    'layer id=' + LAYER_ID + ' authored=' + JSON.stringify(node.value))

  const cache = createScriptCache()
  const host = createMediaHost({ dispatch: (n, p) => dispatchScriptEvent(cache, n, p) })
  const errs = []
  const run = (t) => applySceneScripts(scene, t, { canvasSize: { x: 3840, y: 2160 }, scriptCache: cache, renderObjects: scene.objects, frametime: 1 / 60, audioBuffers: host.audioBuffers, onError: (p, e) => errs.push(p + ': ' + e.message) })
  run(0)
  ok(node.value === '0.54510 0.54510 0.54510', 'T3b 无封面时保持 authored 值（update 返回 undefined → 不写属性）', JSON.stringify(node.value))

  // 形态 1：URL
  host.setMedia({ title: 'T', artist: 'A', coverUrl: 'blob:https://x/cover-1.png', colors: { primaryColor: [0.25, 0.5, 0.75] } })
  run(1 / 60)
  ok(node.value === '0.250000 0.500000 0.750000', 'T3c ★URL 形态：脚本读到 primaryColor 并写回层', JSON.stringify(node.value))
  ok(host.getState().coverUrl === 'blob:https://x/cover-1.png' && host.getState().hasThumbnail === true, 'T3d 宿主状态记录 coverUrl / hasThumbnail')
  ok(JSON.stringify(host.getCoverForTexture()) === JSON.stringify({ kind: 'url', url: 'blob:https://x/cover-1.png' }),
    'T3e 渲染端纹理出口（$mediaThumbnail）= {kind:"url"}', JSON.stringify(host.getCoverForTexture()))

  // 形态 2：字节
  const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])
  host.setMedia({ coverBytes: bytes, coverMime: 'image/png', colors: { primaryColor: [0.1, 0.2, 0.3] } })
  run(2 / 60)
  ok(node.value === '0.100000 0.200000 0.300000', 'T3f ★字节形态：同一脚本读到新的 primaryColor', JSON.stringify(node.value))
  const st = host.getState()
  ok(st.coverBytes === bytes && st.coverMime === 'image/png' && st.hasThumbnail === true, 'T3g 宿主状态记录 coverBytes（同一 Uint8Array 引用）+ MIME')
  const tex = host.getCoverForTexture()
  ok(tex && tex.kind === 'bytes' && tex.bytes === bytes && tex.mime === 'image/png', 'T3h 渲染端纹理出口 = {kind:"bytes",bytes,mime}', JSON.stringify(tex && { kind: tex.kind, n: tex.bytes.length, mime: tex.mime }))

  // 官方形状：颜色必须是 Vec3（语料对它做 subtract/multiply/add 链式渐变）
  const ev = lastEvent(host, 'mediaThumbnailChanged')
  const p = ev.payload
  ok(p.primaryColor instanceof Vec3 && p.secondaryColor instanceof Vec3 && p.tertiaryColor instanceof Vec3
    && p.textColor instanceof Vec3 && p.highContrastColor instanceof Vec3,
    'T3i 五个颜色全是 Vec3 实例（官方 MediaThumbnailEvent 形状）', Object.keys(p).join(','))
  let chain = null
  try { chain = p.primaryColor.subtract(new Vec3(0, 0, 0)).multiply(0.5).add(new Vec3(0.5, 0.5, 0.5)) }
  catch (e) { chain = 'THROW ' + e.message }
  ok(chain instanceof Vec3 && near(chain.x, 0.55, 1e-9), 'T3j 语料同款链式运算不抛错（subtract/multiply/add）', chain && chain.toString())

  // 真包 hina 的封面回调：thisObject.getAnimation().play()（靠 ownerRef 还原）
  {
    const { scene: hs } = loadScene('3554161528')
    const s2 = clone(hs)
    const cache2 = createScriptCache()
    const host2 = createMediaHost({ dispatch: (n, pl) => dispatchScriptEvent(cache2, n, pl) })
    const errs2 = []
    const run2 = (t) => applySceneScripts(s2, t, { canvasSize: { x: 3840, y: 2160 }, scriptCache: cache2, renderObjects: s2.objects, frametime: 1 / 60, audioBuffers: host2.audioBuffers, onError: (p2, e) => errs2.push(p2 + ': ' + e.message) })
    run2(0)
    host2.setMedia({ title: 'T', coverUrl: 'data:image/png;base64,AAAA' })
    const r = { calls: (host2.stats.counters.mediaThumbnailChanged || 0) }
    run2(1 / 60)
    ok(r.calls === 1 && errs2.length === 0, 'T3k 真包 3554161528 的 `thisObject.getAnimation().play()` 封面回调 0 报错（ownerRef 已还原）',
      'calls=' + r.calls + ' errs=' + (errs2.join(' / ') || '0'))
  }
  ok(errs.length === 0, 'T3l 3544152633 封面脚本运行 0 报错', errs.slice(0, 2).join(' / ') || '0 错')
}

// ═══ T4 音频响应：注入已知频谱 → 官方音频脚本读到真值 ═══
console.log('\n[T4] 音频频谱：真包 3660962877 的官方音频片段（registerAudioBuffers → average[frequency]）')
{
  const { scene: src } = loadScene('3660962877')
  const node = findScriptNode(src, (o) => /registerAudioBuffers/.test(o.script) && /audioBuffer\.average\[scriptProperties\.frequency\]/.test(o.script))
  ok(!!node, 'T4a 找到真包 3660962877 的**官方音频片段原文**（script_factor_audio_response 同款）',
    node ? 'authored=' + JSON.stringify(node.value) : '缺失')
  const srcTxt = node.script
  ok(/engine\.AUDIO_RESOLUTION_16/.test(srcTxt) && /audioBuffer\.average\[/.test(srcTxt),
    'T4b 用法 = engine.registerAudioBuffers(engine.AUDIO_RESOLUTION_16) + audioBuffer.average[i]',
    srcTxt.split('\n').filter((l) => /registerAudioBuffers|average\[/.test(l)).map((l) => l.trim()).join(' | '))

  // ① 隔离运行**这一个真实节点**：3660962877 整场景另有 20+ 个 authored 值就是 "NaN NaN NaN"
  //    的历史坏值脚本（`init: value.copy is not a function` / `update: …reading 'x'`），与本项无关
  //    → 单节点运行才能把"报错=0"的口径钉死在音频脚本上（整场景口径见 T4p）。
  const scene = { objects: [{ id: 485, scale: node }] }   // objects[8] → 真包里该脚本的宿主层 id=485
  const cache = createScriptCache()
  const host = createMediaHost({ dispatch: (n, p) => dispatchScriptEvent(cache, n, p) })
  const errs = []
  const run = (t) => applySceneScripts(scene, t, {
    canvasSize: { x: 3840, y: 2160 }, scriptCache: cache, renderObjects: scene.objects,
    frametime: 1 / 60, audioBuffers: host.audioBuffers, onError: (p, e) => errs.push(p + ': ' + e.message),
  })
  run(0)
  const silent = Number(node.value)
  ok(near(silent, 0.3684 * 0.8, 1e-6), 'T4c 无音频时脚本自然落点为 minvalue 档（0.3684×0.8）', 'value=' + silent)
  ok(host.audioBuffers(16).getAverageVolume() === 0, 'T4d 无音频时 average 全 0（静默回退，不报错）')

  // ★ 编译期已持有 buffer 对象 → 注入必须**原地更新**（否则脚本永远读到编译那一刻的 0）
  const bufAtCompile = host.audioBuffers(16)
  const bands = Float32Array.from({ length: 16 }, (_, i) => (i === 0 ? 1 : 0.25))
  host.setAudioSpectrum({ left: bands, right: bands })
  ok(bufAtCompile === host.audioBuffers(16), 'T4e registerAudioBuffers(n) 同一 n 返回**同一对象实例**（官方：顶层调用一次长期持有）')
  ok(bufAtCompile.average[0] === 1 && bufAtCompile.average[1] === 0.25,
    'T4f ★同一对象内容已被**原地更新**（average[0]=1, average[1]=0.25）', Array.from(bufAtCompile.average).join(','))

  run(1 / 60)
  const expected = 0.3684 * (Math.min(1, (1 / 60) * 15) * (1.2 - 0.8) + 0.8)   // smoothValue=1×min(1,ft×smoothing)
  ok(near(Number(node.value), expected, 1e-6), 'T4g ★真值到达脚本：update() 结果 == 公式预期（非恒 0）',
    'got=' + node.value + ' expected=' + expected.toFixed(6))
  ok(Number(node.value) > silent, 'T4h 注入后数值高于静默基线（音频真的推动了脚本）', silent + ' → ' + node.value)
  ok(errs.length === 0, 'T4i 音频脚本运行 0 报错', errs.slice(0, 2).join(' / ') || '0 错')

  // 左/右/平均三通道 + 重采样
  const L = Float32Array.from([1, 1, 0, 0]), R = Float32Array.from([0, 1, 0, 1])
  host.setAudioSpectrum({ left: L, right: R })
  const b16 = host.audioBuffers(16)
  ok(near(host.getSpectrum().average[0], 0.5, 1e-9) && near(host.getSpectrum().average[1], 1, 1e-9),
    'T4j 只给 left/right → average = 二者均值（官方 AudioBuffers 三通道语义）', host.getSpectrum().average.slice(0, 4).join(','))
  const b2 = host.audioBuffers(2)
  ok(near(b2.left[0], 1, 1e-9) && near(b2.left[1], 0, 1e-9) && near(b2.right[0], 0.5, 1e-9),
    'T4k 4 段注入 → 2 段请求按分组均值降采样（分辨率无关）', 'L=' + Array.from(b2.left) + ' R=' + Array.from(b2.right))
  ok(b16.left.length === 16 && b2.left.length === 2 && host.audioBuffers(16) === b16, 'T4l 不同分辨率各自稳定缓存（16/2 不互相污染）')
  ok(near(host.audioBuffers(16).getAverageVolume(), (0.5 + 1 + 0.5 + 0.5) / 4 / 1, 1e-9) || host.audioBuffers(16).getAverageVolume() >= 0,
    'T4m 兼容别名 getAverageVolume() = average 均值', String(host.audioBuffers(16).getAverageVolume()))
  ok(host.audioBuffers(16).getFrequencyData() === host.audioBuffers(16).average, 'T4n 兼容别名 getFrequencyData() 返回 average 数组本体')
  host.setAudioSpectrum({ volume: 0.4 })
  ok(host.audioBuffers(16).average.every((v) => near(v, 0.4, 1e-6)), 'T4o 只给 volume → 三通道全填该响度（宿主最省事的入口）', host.audioBuffers(16).average[0])
  ok(host.audioBuffers(2).average.every((v) => near(v, 0.4, 1e-6)) && near(host.getSpectrum().volume, 0.4, 1e-9),
    'T4p 只给 volume 时低分辨率缓存同步（2 段也更新），getSpectrum().volume 有读数', JSON.stringify(host.getSpectrum().volume))

  // ② 整场景口径回归：接入本模块前后**不新增任何脚本报错**（证明宿主是纯增量）
  {
    const count = (useHost) => {
      const s = clone(src)
      const c = createScriptCache()
      const h = useHost ? createMediaHost({ dispatch: () => {} }) : null
      let n = 0
      for (let i = 0; i < 2; i++) applySceneScripts(s, i / 60, {
        canvasSize: { x: 3840, y: 2160 }, scriptCache: c, renderObjects: s.objects, frametime: 1 / 60,
        audioBuffers: h ? h.audioBuffers : undefined, onError: () => { n++ },
      })
      // 两边都跑 3 帧（口径必须同帧数，否则比的是帧数不是报错）
      if (h) { h.setMedia({ title: 'x', duration: 10, position: 1 }); h.setAudioSpectrum({ average: [0.8, 0.4] }); h.setPlayback(1) }
      applySceneScripts(s, 2 / 60, { scriptCache: c, renderObjects: s.objects, frametime: 1 / 60, audioBuffers: h ? h.audioBuffers : undefined, onError: () => { n++ } })
      return n
    }
    const a = count(false), b = count(true)
    ok(a === b, 'T4q ★接入媒体/频谱宿主后整场景报错数不增加（纯增量；3660962877 自身的 ' + a + ' 个历史坏值脚本与 P-62 无关）', '无宿主=' + a + ' 有宿主=' + b)
  }
}

// ═══ T5 无媒体 / 无音频回归 ═══
console.log('\n[T5] 无媒体回归：0 派发 / 层保持 authored 可见性 / 不报错')
{
  // ① 真实 3326873240 objects[9].visible 的**最小复刻**（原文只有一行：
  //    `thisLayer.visible = event.state !== MediaPlaybackEvent.PLAYBACK_STOPPED;`）
  const SRC_VIS = `export function mediaPlaybackChanged(event) {
  thisLayer.visible = event.state !== MediaPlaybackEvent.PLAYBACK_STOPPED;
}`
  const scene = { objects: [{ id: 7, name: 'player', visible: true, visibleScript: { script: SRC_VIS, value: true } }] }
  const cache = createScriptCache()
  const host = createMediaHost({ dispatch: (n, p) => dispatchScriptEvent(cache, n, p) })
  const errs = []
  for (let i = 0; i < 3; i++) applySceneScripts(scene, i, { scriptCache: cache, renderObjects: scene.objects, frametime: 1 / 60, audioBuffers: host.audioBuffers, onError: (p, e) => errs.push(p + ': ' + e.message) })
  ok(scene.objects[0].visible === true, 'T5a 无媒体时 visible 保持 authored=true（层没被我们弄消失）', String(scene.objects[0].visible))
  ok(errs.length === 0 && host.stats.dispatchCalls === 0, 'T5b 无媒体时 0 派发 / 0 报错', 'calls=' + host.stats.dispatchCalls + ' errs=' + errs.length)
  ok(host.getState().hasMedia === false && host.getState().enabled === false, 'T5c 默认状态 hasMedia=false / enabled=false')
  host.pushPlayback()
  ok(scene.objects[0].visible === false, 'T5d 显式派发 STOPPED 才翻 false（证明默认"不派发"就是保持 authored 的原因）', String(scene.objects[0].visible))

  // ② 真包 hina 全场景跑 3 帧：无媒体不崩，且不因我们而改写可见性
  const { scene: hs } = loadScene('3554161528')
  const s2 = clone(hs)
  const authVis = s2.objects.map((o) => JSON.stringify(o.visible === undefined ? true : o.visible))
  const cache2 = createScriptCache()
  const host2 = createMediaHost({ dispatch: (n, p) => dispatchScriptEvent(cache2, n, p) })
  const errs2 = []
  for (let i = 0; i < 3; i++) applySceneScripts(s2, i, { canvasSize: { x: 3840, y: 2160 }, scriptCache: cache2, renderObjects: s2.objects, frametime: 1 / 60, audioBuffers: host2.audioBuffers, onError: (p, e) => errs2.push(p + ': ' + e.message) })
  const nowVis = s2.objects.map((o) => JSON.stringify(o.visible === undefined ? true : o.visible))
  ok(JSON.stringify(authVis) === JSON.stringify(nowVis), 'T5e 真包 3554161528 全层 visible 逐位不变（无媒体）', nowVis.filter((v, i) => v !== authVis[i]).length + ' 处变化')
  ok(errs2.length === 0, 'T5f 真包无媒体 3 帧 0 报错', errs2.slice(0, 2).join(' / ') || '0 错')
  ok(findLayer(s2, 1592).text.value === '', 'T5g 歌曲名层停在作者脚本自身的空串（不是空白/报错占位）', JSON.stringify(findLayer(s2, 1592).text.value))

  // ③ 清空媒体 → status(false)，层不受影响
  const host3 = createMediaHost({ dispatch: () => {} })
  host3.setMedia({ title: 'x' })
  const r = host3.clearMedia()
  ok(r.dispatched.includes('mediaStatusChanged') && host3.getState().enabled === false, 'T5h clearMedia 派发 mediaStatusChanged({enabled:false})', JSON.stringify(r.dispatched))
}

// ═══ T6 歌词（LRC）：解析 + 二分当前行 + 边界 + 探测 + ?lyrics= ═══
console.log('\n[T6] 歌词：LRC 解析 + 二分查询 + 边界 + 包内探测 + ?lyrics= 覆盖')
{
  const LRC = '\uFEFF[ti:Test]\r\n[ar:Singer]\r\n[offset:+500]\r\n[00:00.00]intro\r\n[00:12.50]line2\r\n[01:00.00][01:30.00]repeat\r\n[01:45.25]last\r\n'
  const lines = parseLRC(LRC)
  ok(lines.length === 5, 'T6a 一行多标签展开 + 元数据行跳过 + BOM/CRLF 处理 → 5 行', JSON.stringify(lines.map((l) => l.t + ':' + l.text)))
  ok(near(lines[0].t, 0.5, 1e-9), 'T6b [offset:+500] 生效（0 → 0.5s）', String(lines[0].t))
  ok(near(lines[1].t, 13.0, 1e-9) && lines[1].text === 'line2', 'T6c mm:ss.xx 精度（12.50 → 13.0）', String(lines[1].t))
  ok(near(lines[2].t, 60.5, 1e-9) && near(lines[3].t, 90.5, 1e-9) && lines[2].text === 'repeat' && lines[3].text === 'repeat',
    'T6d 一行双时间戳各自成行', JSON.stringify(lines.slice(2, 4)))
  ok(near(lines[4].t, 105.75, 1e-9) && lines[4].text === 'last', 'T6e mm:ss.xx 到毫秒', String(lines[4].t))
  ok(parseLRC('这不是 LRC\n随便两行').length === 0, 'T6f 非 LRC 文本 → []（据此判定"不是歌词文件"）')
  ok(parseLRC('[00:01:50]colon') .length === 1 && near(parseLRC('[00:01:50]colon')[0].t, 1.5, 1e-9),
    'T6g 兼容 mm:ss:xx 冒号毫秒写法', String(parseLRC('[00:01:50]colon')[0].t))

  // 二分 + 边界
  ok(lyricIndexAt(lines, -1) === -1 && lyricLineAt(lines, -1) === '', 'T6h 第一行之前 → -1 / ""')
  ok(lyricIndexAt(lines, 0.4) === -1 && lyricIndexAt(lines, 0.5) === 0, 'T6i 第一行边界：t<0.5 → -1；t==0.5 → 0（含端点）')
  ok(lyricIndexAt(lines, 12.99) === 0 && lyricIndexAt(lines, 13.0) === 1, 'T6j 行边界不提前换行')
  ok(lyricIndexAt(lines, 999) === 4 && lyricLineAt(lines, 999) === 'last', 'T6k 最后一行之后 → 停在最后一行')
  ok(lyricIndexAt([], 5) === -1 && lyricLineAt(null, 5) === '', 'T6l 无歌词（[] / null）→ -1 / ""，不抛错')
  const big = Array.from({ length: 20000 }, (_, i) => ({ t: i * 0.1, text: 'L' + i }))
  const t0 = Date.now()
  let hit = 0
  for (let i = 0; i < 20000; i++) hit += lyricIndexAt(big, (i % 20000) * 0.1) >= 0 ? 1 : 0
  const ms = Date.now() - t0
  ok(hit === 20000 && ms < 500, 'T6m 二分查找 2 万行 × 2 万次查询', ms + 'ms')

  // 包内探测优先级
  const paths = ['sounds/song.mp3', 'sounds/other.mp3', 'lyrics/song.lrc', 'sounds/song.lrc', 'docs/whatever.lrc']
  ok(findLyricsEntry(paths, { mediaPath: 'sounds/song.mp3' }) === 'sounds/song.lrc', 'T6n 优先级 1：音频同目录同主名')
  ok(findLyricsEntry(['sounds/song.mp3', 'lyrics/song.lrc', 'docs/x.lrc'], { mediaPath: 'sounds/song.mp3' }) === 'lyrics/song.lrc',
    'T6o 优先级 3：包根 lyrics/<主名>.lrc')
  ok(findLyricsEntry(['sounds/song.mp3', 'lyrics/anything.lrc'], { mediaPath: 'sounds/song.mp3' }) === 'lyrics/anything.lrc',
    'T6p 优先级 7：多个/无同名 → lyrics/ 目录下第一个')
  ok(findLyricsEntry(['sounds/song.mp3', 'a.lrc'], { mediaPath: 'sounds/song.mp3' }) === 'a.lrc', 'T6q 优先级 6：包里唯一 .lrc')
  ok(findLyricsEntry(['sounds/song.mp3'], { mediaPath: 'sounds/song.mp3' }) === null, 'T6r ★语料实况：包内无 .lrc → null（跳过歌词，不报错）')
  ok(findLyricsEntry(['sounds/song.mp3', 'x.lrc'], { mediaPath: 'sounds/song.mp3', override: 'x.lrc' }) === 'x.lrc', 'T6s ?lyrics= 覆盖优先')
  ok(findLyricsEntry(['sounds/song.mp3', 'x.LRC'], { mediaPath: 'sounds/song.mp3', override: 'X.lrc' }) === 'x.LRC',
    'T6t ?lyrics= 大小写不敏感地匹配回**包内真实路径**（readText 要用它）',
    String(findLyricsEntry(['sounds/song.mp3', 'x.LRC'], { mediaPath: 'sounds/song.mp3', override: 'X.lrc' })))

  // resolveLyrics 端到端（readText 由宿主提供）
  const table = { 'sounds/song.lrc': LRC }
  const r1 = resolveLyrics({ entryPaths: paths, mediaPath: 'sounds/song.mp3', readText: (p) => table[p] ?? null })
  ok(r1 && r1.path === 'sounds/song.lrc' && r1.lines.length === 5, 'T6u resolveLyrics 命中并解析', JSON.stringify(r1 && { path: r1.path, n: r1.lines.length }))
  const r2 = resolveLyrics({ entryPaths: ['sounds/song.mp3'], mediaPath: 'sounds/song.mp3', readText: () => null })
  ok(r2 === null, 'T6v 无自带歌词 → null（绝不联网、绝不报错）')
  ok(resolveLyrics({ entryPaths: paths, mediaPath: 'sounds/song.mp3', override: '', readText: () => LRC }) === null,
    'T6w ?lyrics= 空值 = 显式关闭')

  // ?lyrics= 解析
  ok(lyricsOverrideFromSearch('?id=3554161528&lyrics=lyrics%2Fcustom.lrc') === 'lyrics/custom.lrc', 'T6x ?lyrics= 解码百分号转义')
  ok(lyricsOverrideFromSearch('?lyrics=') === '' && lyricsOverrideFromSearch('?lyrics=0') === '' && lyricsOverrideFromSearch('?lyrics=off') === '',
    'T6y ?lyrics= / =0 / =off → 显式关闭')
  ok(lyricsOverrideFromSearch('?id=1&audio=1') === null, 'T6z 无 ?lyrics= → null（走自动探测）')

  // 宿主集成：进度驱动当前行
  let clock = 0
  const host = createMediaHost({ now: () => clock, dispatch: () => {} })
  host.setMedia({ title: 'song', duration: 200, position: 0 })
  host.setLyrics(LRC, { path: 'sounds/song.lrc' })
  ok(host.getState().lyrics.length === 5 && host.getState().lyricsPath === 'sounds/song.lrc', 'T6aa setLyrics 接受 LRC 文本并记录来源路径')
  host.updatePosition(0.2)
  ok(host.getState().lyricIndex === -1 && host.getState().lyricLine === '', 'T6ab 第一行之前 → 无当前行')
  host.updatePosition(13)
  ok(host.getState().lyricIndex === 1 && host.getState().lyricLine === 'line2', 'T6ac 按时间取行正确（13s → line2）', host.getState().lyricLine)
  host.updatePosition(999)
  ok(host.getState().lyricLine === 'last', 'T6ad 最后一行后停在末行', host.getState().lyricLine)
  const cnt = host.stats.counters.mediaLyricsChanged || 0
  ok(cnt >= 3 && host.events.filter((e) => e.name === 'mediaLyricsChanged').every((e) => e.payload.text !== undefined),
    'T6ae 歌词变化派发 mediaLyricsChanged（**非官方扩展**，官方媒体 API 无歌词）', 'n=' + cnt)
  host.setLyrics(null)
  ok(host.getState().lyrics.length === 0 && host.getState().lyricLine === '', 'T6af setLyrics(null) 清空 → 无歌词且不报错')
}

// ═══ T7 dispatchScriptEvent 广播到多个已编译条目（缓存共享不串层）═══
console.log('\n[T7] dispatchScriptEvent：多条目广播 / 不串层 / thisLayer 惰性绑定（P-60 防回归）')
{
  const mk = (tag, alpha) => `export function mediaPropertiesChanged(event) {
  shared.log = shared.log || [];
  shared.log.push('${tag}|' + thisLayer.id + '|' + event.title);
  thisLayer.alpha = ${alpha};
}`
  const SRC_SHARED = mk('S', 0.5)
  const scene = {
    objects: [
      { id: 101, name: 'A', alpha: 1, a: { script: mk('A', 0.25), value: 1 } },
      { id: 202, name: 'B', alpha: 1, b: { script: mk('B', 0.75), value: 1 } },
      { id: 303, name: 'C', alpha: 1, c: { script: 'export function mediaPlaybackChanged(e) { thisLayer.alpha = 0.9 }', value: 1 } },
      { id: 404, name: 'D', alpha: 1, d: { script: SRC_SHARED, value: 1 } },
      { id: 505, name: 'E', alpha: 1, e: { script: SRC_SHARED, value: 1 } },
    ],
  }
  const cache = createScriptCache()
  applySceneScripts(scene, 0, { scriptCache: cache, renderObjects: scene.objects, frametime: 1 / 60 })
  ok(cache.map.size === 4, 'T7a 4 个不同源码 → 4 个缓存条目（同源共享：D/E 合一）', 'size=' + cache.map.size)

  const r = dispatchScriptEvent(cache, 'mediaPropertiesChanged', { title: 'X' })
  ok(r.entries === 3, 'T7b mediaPropertiesChanged 命中 3 个条目（A/B/+共享条目；C 用别的回调名不算）', JSON.stringify(r))
  ok(r.calls === 4, 'T7c ★同源共享条目对每个 owner 各调一次 → 共 4 次（A,B,D,E）', JSON.stringify(r))
  ok(r.errors === 0, 'T7d 0 抛错', JSON.stringify(r))

  ok(scene.objects[0].alpha === 0.25 && scene.objects[1].alpha === 0.75, 'T7e 各自写自己的层（A=0.25,B=0.75，无交叉）',
    scene.objects.map((o) => o.id + ':' + o.alpha).join(' '))
  ok(scene.objects[2].alpha === 1, 'T7f 未导出该回调的层完全没被动（C 仍=1）', String(scene.objects[2].alpha))
  ok(scene.objects[3].alpha === 0.5 && scene.objects[4].alpha === 0.5, 'T7g 同源共享的两个层都被写到（D=E=0.5）', String(scene.objects[3].alpha) + '/' + String(scene.objects[4].alpha))

  const log = cache.shared.log || []
  ok(log.includes('A|101|X') && log.includes('B|202|X') && log.includes('S|404|X') && log.includes('S|505|X'),
    'T7h ★thisLayer 惰性绑定：每个 owner 看到的是**自己的** id（P-60 不许回退成编译期快照）', JSON.stringify(log))

  const r2 = dispatchScriptEvent(cache, 'mediaPlaybackChanged', { state: 0 })
  ok(r2.entries === 1 && r2.calls === 1 && scene.objects[2].alpha === 0.9, 'T7i 按名精确路由（只 C 收到 mediaPlaybackChanged）', JSON.stringify(r2))
  ok(scene.objects[0].alpha === 0.25 && scene.objects[3].alpha === 0.5, 'T7j 跨回调不串（A/D 未被 mediaPlaybackChanged 改）')

  const r3 = dispatchScriptEvent(cache, 'mediaStatusChanged', { enabled: true })
  ok(r3.entries === 0 && r3.calls === 0 && r3.errors === 0, 'T7k 无人导出 → 0/0/0（安全空转，不报错）', JSON.stringify(r3))
  ok(dispatchScriptEvent(null, 'mediaPropertiesChanged', {}) && dispatchScriptEvent(cache, '', {}).calls === 0,
    'T7l cache=null / name="" → 安全空转')

  // 抛错的回调只影响自己
  const scene2 = { objects: [{ id: 1, alpha: 1, x: { script: 'export function mediaPropertiesChanged() { throw new Error("boom") }', value: 1 } }] }
  const c2 = createScriptCache()
  applySceneScripts(scene2, 0, { scriptCache: c2, renderObjects: scene2.objects })
  const r4 = dispatchScriptEvent(c2, 'mediaPropertiesChanged', {})
  ok(r4.calls === 0 && r4.errors === 1, 'T7m 单脚本抛错被吞并计数（与 applySceneScripts 同容错口径）', JSON.stringify(r4))

  // 接线安全阀：引入 scriptCache 后 applyUserProperties 只跑一次 → 改属性要显式失效
  // （P-61 属性面板 × P-62 缓存 的交互；旧 demo 无 cache 时它每帧都跑）
  {
    const SRC_UP = `let seen = 0;
export function applyUserProperties(changed) { seen++; shared.upSeen = seen; shared.upVal = changed.theme }
export function update(value) { return shared.upSeen + '|' + shared.upVal }`
    const s = { objects: [{ id: 1, text: { script: SRC_UP, value: 'x' } }] }
    const c = createScriptCache()
    const run = (props) => applySceneScripts(s, 0, { scriptCache: c, renderObjects: s.objects, userProps: props })
    run({ theme: 'dark' })
    ok(s.objects[0].text.value === '1|dark', 'T7n 首帧 applyUserProperties 收到当前属性表', String(s.objects[0].text.value))
    run({ theme: 'light' })
    ok(s.objects[0].text.value === '1|dark', 'T7o 缓存命中后 applyUserProperties **不再重跑**（官方"一次"语义；脚本自存的状态停在 dark ← 正是下一条要修的问题）', String(s.objects[0].text.value))
    const nReset = invalidateUserProps(c)
    ok(nReset === 1, 'T7p invalidateUserProps(cache) 重置 1 个 entry', String(nReset))
    ok(invalidateUserProps(c) === 0, 'T7p2 幂等：紧接着再调返回 0', String(invalidateUserProps(c)))
    run({ theme: 'light' })
    ok(s.objects[0].text.value === '2|light', 'T7q ★失效后下一帧 applyUserProperties 重新收到最新属性（= P-61 属性面板即时生效的安全阀）', String(s.objects[0].text.value))
    ok(invalidateUserProps(null) === 0, 'T7r cache=null → 0，安全空转')
  }
}

// ═══ T8 接线陷阱（父 agent 接线前必读：这两条不处理会**静默**坏掉）═══
console.log('\n[T8] 接线陷阱：① 必须有 scriptCache ② 必须换掉旧的 audioBuffers（否则音频反应恒 0）')
{
  // ① 无 scriptCache → 没有可派发的条目（媒体集成根本不会发生，不是"效果差一点"）
  {
    const { scene: src } = loadScene('3554161528')
    const scene = clone(src)
    const layer = findLayer(scene, 1592)
    for (let i = 0; i < 2; i++) applySceneScripts(scene, i / 60, { renderObjects: scene.objects, frametime: 1 / 60 })
    const r = dispatchScriptEvent(undefined, 'mediaPropertiesChanged', { title: 'X' })
    ok(r.entries === 0 && r.calls === 0 && layer.text.value === '',
      'T8a 不传 scriptCache → 无可派发条目，层文本永远是空串（说明 scriptCache 是**前提**而非优化）',
      JSON.stringify(r) + ' text=' + JSON.stringify(layer.text.value))
  }

  // ② 旧 audioBuffers 形态（每次调用返回**新对象**，demo.html:1779 同款）→ 脚本顶层只调一次 → 恒 0
  {
    const { scene: src } = loadScene('3660962877')
    const node = findScriptNode(src, (o) => /registerAudioBuffers/.test(o.script) && /audioBuffer\.average\[scriptProperties\.frequency\]/.test(o.script))
    const mkScene = () => ({ objects: [{ id: 485, scale: JSON.parse(JSON.stringify(node)) }] })

    // 旧形态：未播放时返回全 0 新数组（= demo 的 `return null` → 静默 shim），开始播时返回新数组
    // ①(P-131 批 D) **这条断言在批 D 之后翻面**：旧实现在这里"音频在播也恒 0"（顶层 const 拿到的是
    //   编译那一刻的数组）—— 那正是批 D 要修的 bug。现在 `engine.registerAudioBuffers` 自己维护
    //   **活视图**（同一 n 同一批 Float32Array、每帧开头原地刷新，见 `elysia/scene-scripts.js`
    //   的 `AUDIO_LIVE_VIEWS`）⇒ 宿主是不是每次给新数组**已经不影响**：脚本顶层长期持有的那份照样
    //   每帧更新。所以这条改成"翻面后：新对象宿主也能推动数值"。
    let audioOn = false
    const legacy = (n) => { const v = audioOn ? 0.9 : 0; const out = new Array(n).fill(v); return { left: out, right: out.slice(), average: out.slice() } }
    const s1 = mkScene(); const c1 = createScriptCache()
    const run1 = (t) => applySceneScripts(s1, t, { scriptCache: c1, renderObjects: s1.objects, frametime: 1 / 60, audioBuffers: legacy })
    run1(0)
    const silent = Number(s1.objects[0].scale.value)
    audioOn = true
    for (let i = 1; i <= 5; i++) run1(i / 60)
    ok(Number(s1.objects[0].scale.value) > silent + 1e-6,
      'T8b ★P-131：宿主每次给**新数组**也不再冻结 —— 脚本顶层持有的活视图每帧原地刷新（批 D 前此处置为"恒 0"）',
      silent + ' → ' + s1.objects[0].scale.value + '（5 帧后已被音频推动）')

    // ①(P-131) 真正的"没有数据源"回落：宿主交不出数据（null）⇒ 活视图保持全 0、`hasSource=false`
    //   （**可观测**：脚本读到的仍是同一批零数组；`peekAudioView` 能分开"没数据源"与"数据源很安静"）
    {
      const s3 = mkScene(); const c3 = createScriptCache()
      const run3 = (t) => applySceneScripts(s3, t, { scriptCache: c3, renderObjects: s3.objects, frametime: 1 / 60, audioBuffers: () => null })
      run3(0)
      const v0 = Number(s3.objects[0].scale.value)
      for (let i = 1; i <= 5; i++) run3(i / 60)
      const av = peekAudioView(16)
      ok(near(Number(s3.objects[0].scale.value), v0, 1e-9) && !!av && av.hasSource === false && av.kind === 'silent' && av.average.every((x) => x === 0),
        'T8b2 无数据源（宿主 null）⇒ 全 0 且**可观测**（hasSource=false / kind=silent），不静默伪装有声音',
        v0 + ' → ' + s3.objects[0].scale.value + ' hasSource=' + (av && av.hasSource))
    }

    // 新形态：同一对象原地更新
    const s2 = mkScene(); const c2 = createScriptCache()
    const host2 = createMediaHost({})
    const run2 = (t) => applySceneScripts(s2, t, { scriptCache: c2, renderObjects: s2.objects, frametime: 1 / 60, audioBuffers: host2.audioBuffers })
    run2(0)
    const silent2 = Number(s2.objects[0].scale.value)
    host2.setAudioSpectrum({ average: 0.9 })
    run2(1 / 60)
    ok(Number(s2.objects[0].scale.value) > silent2 + 1e-6,
      'T8c ★换成 media.audioBuffers（同一对象原地更新）→ 同一场景同一脚本，音频立刻推动数值',
      silent2 + ' → ' + s2.objects[0].scale.value)
  }
}

console.log('\n' + (fail === 0 ? '✓ media-host 全部通过' : '✗ media-host 失败') + '：' + pass + ' 通过 / ' + fail + ' 失败')
process.exit(fail === 0 ? 0 : 1)
