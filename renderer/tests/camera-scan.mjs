// camera-scan.mjs — 相机节点/3D 相机语料取证（ZCODE-MERGED-1 第 2 项 D，WER-ALIGN B4/B9）
// 统计：①带 scene.camera 的包数（eye/center/up 非默认、含 paths 关键帧）
//       ②objects[] 里 camera 类型对象数（origin/zoom 的动画形态：{animation:{c0}} / {script} / 静态）
//       ③general.fov/nearz/farz 非默认包数
// 用法: node camera-scan.mjs
import { WS } from './_root.mjs'   // ①(2026-09-19 敏感信息加固) 工作区根/仓库根：由**脚本自身位置**推导，不再写作者本机绝对路径
import fs from 'node:fs'
import path from 'node:path'
import * as lib from '../core/we-scene-bundle.js'
// ①(去个人化 2026-09-16 / 敏感信息加固 2026-09-19) 工作区根：环境变量优先；兜底默认由 tests/_root.mjs 按**脚本自身位置**推导（不再写作者本机绝对路径）。
const MPW_WS = process.env.MPW_ROOT || WS
// ①(去个人化 2026-09-16) 插件下载缓存 / 备用语料根：环境变量优先；默认值只是作者本机路径。
const MPW_PLUGIN_CACHE = process.env.MPW_PLUGIN_CACHE || '/root/.dsh-mpkg-wallpaper'
const MPW_SD_ROOT = process.env.MPW_SD_ROOT || '/mnt/sdcard/wallpapertest1'

const DIRS = [`${MPW_WS}/allwallpaper`, MPW_PLUGIN_CACHE, MPW_SD_ROOT]
const DEC = new TextDecoder()
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v)
const valKind = (v) => {
  if (v == null) return '缺省'
  if (isObj(v) && v.animation) return 'animation关键帧'
  if (isObj(v) && v.script) return 'script'
  if (isObj(v) && v.value !== undefined) return 'user属性'
  return '静态'
}
const num = (v, def) => {
  if (v == null) return def
  if (typeof v === 'number') return v
  if (typeof v === 'string') { const n = parseFloat(v); return isFinite(n) ? n : def }
  if (isObj(v) && v.value !== undefined) return num(v.value, def)
  if (isObj(v) && Array.isArray(v.animation && v.animation.c0) && v.animation.c0[0]) return num(v.animation.c0[0].value, def)
  return def
}

const tally = {
  pkgTotal: 0, parsed: 0,
  sceneCamera: 0, sceneCameraEyeNonDefault: 0, sceneCameraPaths: 0,
  camObjPkgs: 0, camObjCount: 0,
  camObjOriginKind: {}, camObjZoomKind: {}, camObjZoomPresent: 0,
  camObjFovPresent: 0, camObjDisablepropagation: 0,
  fovNonDefault: 0, nearzNonDefault: 0, farzNonDefault: 0,
  animatedOriginPkgs: [], animatedZoomPkgs: [],
  fovVals: {}, nearzVals: {}, farzVals: {},
}
const pkgWalk = (dir) => {
  let ents = []
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) pkgWalk(p)
    else if (e.name === 'scene.pkg' || e.name.endsWith('.mpkg')) {
      tally.pkgTotal++
      try {
        const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(p)))
        const se = pkg.entries.find((x) => x.name === 'scene.json')
        if (!se) continue
        const s = JSON.parse(DEC.decode(lib.getEntry(pkg, 'scene.json')).replace(/^\uFEFF/, ''))
        tally.parsed++
        const g = s.general || {}
        // ① scene.camera（3D 模型相机）
        if (s.camera) {
          tally.sceneCamera++
          const eye = String(s.camera.eye || '0 0 0').trim().split(/\s+/).map(Number)
          if (eye.some((n, i) => Math.abs(n - [0, 0, 1][i]) > 1e-6)) tally.sceneCameraEyeNonDefault++
          if (Array.isArray(s.camera.paths) && s.camera.paths.length) tally.sceneCameraPaths++
        }
        // ③ general.fov/nearz/farz（官方默认：nearz=1 farz=10000？语料默认值以众数为准记录）
        const fov = num(g.fov, 50), nearz = num(g.nearz, 1), farz = num(g.farz, 10000)
        tally.fovVals[fov] = (tally.fovVals[fov] || 0) + 1
        tally.nearzVals[nearz] = (tally.nearzVals[nearz] || 0) + 1
        tally.farzVals[farz] = (tally.farzVals[farz] || 0) + 1
        if (fov !== 50) tally.fovNonDefault++
        // nearz/farz 非默认以众数为准（扫描完再判）
        // ② camera 类型对象
        const camObjs = (s.objects || []).filter((o) => o.camera !== undefined)
        if (camObjs.length) {
          tally.camObjPkgs++
          tally.camObjCount += camObjs.length
          let anyAnimOrigin = false, anyAnimZoom = false
          for (const o of camObjs) {
            const ko = valKind(o.origin)
            const kz = valKind(o.zoom)
            tally.camObjOriginKind[ko] = (tally.camObjOriginKind[ko] || 0) + 1
            tally.camObjZoomKind[kz] = (tally.camObjZoomKind[kz] || 0) + 1
            if (o.zoom !== undefined) tally.camObjZoomPresent++
            if (o.fov !== undefined) tally.camObjFovPresent++
            if (o.disablepropagation === true) tally.camObjDisablepropagation++
            if (ko === 'animation关键帧') anyAnimOrigin = true
            if (kz === 'animation关键帧') anyAnimZoom = true
          }
          if (anyAnimOrigin) tally.animatedOriginPkgs.push(path.basename(path.dirname(p)) || p)
          if (anyAnimZoom) tally.animatedZoomPkgs.push(path.basename(path.dirname(p)) || p)
        }
        // nearz/farz 非默认延后
        ;(tally._nearz || (tally._nearz = [])).push([p, nearz, farz])
      } catch { /* 坏包跳过 */ }
    }
  }
}
for (const d of DIRS) pkgWalk(d)
// nearz/farz 众数
const mode = (m) => Object.entries(m).sort((a, b) => b[1] - a[1])[0]
const mNear = mode(tally.nearzVals), mFar = mode(tally.farzVals)
let nearzND = 0, farzND = 0
for (const [, nz, fz] of (tally._nearz || [])) {
  if (Math.abs(nz - Number(mNear[0])) > 1e-9) nearzND++
  if (Math.abs(fz - Number(mFar[0])) > 1e-9) farzND++
}
console.log(`包总数 ${tally.pkgTotal}（解析成功 ${tally.parsed}）`)
console.log(`① scene.camera（3D 模型相机）：${tally.sceneCamera} 包 | eye 非默认 [0,0,1]：${tally.sceneCameraEyeNonDefault} 包 | 带 paths 关键帧：${tally.sceneCameraPaths} 包`)
console.log(`② camera 类型对象：${tally.camObjCount} 个 / ${tally.camObjPkgs} 包`)
console.log(`   origin 形态：${JSON.stringify(tally.camObjOriginKind)}`)
console.log(`   zoom   形态：${JSON.stringify(tally.camObjZoomKind)}（声明 zoom 的对象 ${tally.camObjZoomPresent} 个）`)
console.log(`   带 fov 的对象 ${tally.camObjFovPresent} | disablepropagation=true ${tally.camObjDisablepropagation}`)
console.log(`   origin 为 animation关键帧 的包：${tally.animatedOriginPkgs.length} ${tally.animatedOriginPkgs.slice(0, 12).join(',')}`)
console.log(`   zoom   为 animation关键帧 的包：${tally.animatedZoomPkgs.length} ${tally.animatedZoomPkgs.slice(0, 12).join(',')}`)
console.log(`③ general：fov 非默认(≠50) ${tally.fovNonDefault} 包（分布 ${JSON.stringify(tally.fovVals)}）`)
console.log(`   nearz 众数 ${mNear[0]}×${mNear[1]} → 非默认 ${nearzND} 包（分布前5 ${JSON.stringify(Object.fromEntries(Object.entries(tally.nearzVals).sort((a,b)=>b[1]-a[1]).slice(0,5)))}）`)
console.log(`   farz  众数 ${mFar[0]}×${mFar[1]} → 非默认 ${farzND} 包（分布前5 ${JSON.stringify(Object.fromEntries(Object.entries(tally.farzVals).sort((a,b)=>b[1]-a[1]).slice(0,5)))}）`)
