#!/usr/bin/env node
// tools/particle-default-scan.mjs —— **只读取证**：语料里 `sizechange/alphachange/colorchange` 的 `endvalue`
//   缺省分布 + `spritetrail/ropetrail` 的 `maxlength/length/segments` 分布。
//
// 为什么先扫不改（`docs/BACKLOG-LIVE.md` Q8 的前置）：
//   ① `sizechange`/`alphachange` 的 `endvalue` 缺省值在我们这里是 **0**、上游是 **1**（`docs/UPSTREAM-1.3.17-1.3.23.md` §1）；
//      一改就是**全语料**的行为变化，必须先用数字说话：到底多少系统、哪些包、影响哪一段（起止插值的终点）。
//   ② `spritetrail` 的几何拉伸被 `maxlength:1` 夹住（P-136.6 记录）——要改也得先知道语料里
//      `maxlength/length/segments` 是怎么填的（缺省 8 / 0.2s 是上游口径）。
//
// 口径：**只读**容器目录表 + 只解 `scene.json`（不解纹理、不跑渲染、不写任何文件）；
//   语料根按 `MPW_SCENE_ROOT` 或 `<工作区根>/allwallpaper/dd`；额外扫 `wallpaperE/**/*.mpkg` 容器。
//
// 用法:
//   node tools/particle-default-scan.mjs                # 人读表格
//   node tools/particle-default-scan.mjs --json         # 末尾附一行 PARTICLE-DEFAULT-SCAN-JSON
//   node tools/particle-default-scan.mjs --dir <语料根> # 指定语料根（默认按上面的口径推导）
// 退出码：0 扫完（**没有断言**，这是取证工具；语料不存在时打印 SKIP 并退出 0）
import fs from 'node:fs'
import path from 'node:path'
import { WS, ROOT } from '../tests/_root.mjs'
import { readIndexHead, readEntryBytes } from '../tests/_pkg-index.mjs'

const argv = process.argv.slice(2)
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const JSON_OUT = argv.includes('--json')

const SCENE_ROOT = path.resolve(arg('dir', process.env.MPW_SCENE_ROOT || path.join(WS, 'allwallpaper', 'dd')))
if (!fs.existsSync(SCENE_ROOT)) {
  console.log('SKIP particle-default-scan — 语料根不存在：' + SCENE_ROOT + '（用 --dir 指定，或设 MPW_SCENE_ROOT）')
  process.exit(0)
}

/** 递归收集容器（scene.pkg / .mpkg）。只读目录，不解包。 */
function listContainers() {
  const out = []
  const walk = (dir, depth) => {
    if (depth > 6) return
    let ents = []
    try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { walk(p, depth + 1); continue }
      if (/\.(pkg|mpkg)$/i.test(e.name)) out.push({ file: p, id: path.basename(path.dirname(p)) })
    }
  }
  walk(SCENE_ROOT, 0)
  const extra = path.join(WS, 'allwallpaper', 'wallpaperE')
  if (fs.existsSync(extra)) walk(extra, 0)
  return out
}

function sceneJsonOf(file) {
  try {
    const idx = readIndexHead(file)
    const hit = idx.entries.find((x) => /(^|\/)scene\.json$/i.test(x.name))
    if (!hit) return null
    const buf = readEntryBytes(file, idx, hit)
    return JSON.parse(Buffer.from(buf).toString('utf8'))
  } catch { return null }
}

const counters = {
  objects: 0, systems: 0, emitterFiles: 0,
  initNames: new Map(), opNames: new Map(), renderNames: new Map(),
  startEnd: 0, startNoEnd: 0, endNoStart: 0,
  trail: 0, trailMaxLen: new Map(), trailLen: new Map(), trailSegments: new Map(),
  trailKeys: new Map(),
  changeOps: new Map(), changeNoEnd: 0, changeWithEnd: 0, changeNoEndByName: new Map(), changeNoEndExamples: [],
}
const examples = { startNoEnd: [], trail: [] }
const pkgsSeen = new Set()
let parseFails = 0

const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1)
/** 递归看一个粒子系统 json（`children` 里还有嵌套系统）。 */
function visitSystem(j, sysPath, pkgId, layer) {
  if (!j || typeof j !== 'object') return
  counters.systems++
  for (const it of (Array.isArray(j.initializer) ? j.initializer : [])) {
    if (!it || typeof it.name !== 'string') continue
    bump(counters.initNames, it.name)
    // 上游口径的 startvalue/endvalue：出现在"变化类"初始器上（size/alpha/colorchange…）
    const key = (n) => /change|random|overlife/i.test(n)
    if (key(it.name)) {
      const hasStart = it.startvalue !== undefined || it.min !== undefined
      const hasEnd = it.endvalue !== undefined || it.max !== undefined
      if (hasStart && !hasEnd) { counters.startNoEnd++; if (examples.startNoEnd.length < 10) examples.startNoEnd.push({ pkg: pkgId, layer, sys: sysPath, name: it.name, keys: Object.keys(it).join(',') }) }
      if (hasStart && hasEnd) counters.startEnd++
      if (!hasStart && hasEnd) counters.endNoStart++
    }
  }
  for (const it of (Array.isArray(j.operator) ? j.operator : [])) {
    if (!it || typeof it.name !== 'string') continue
    bump(counters.opNames, it.name)
    /* ①(Q8 的核心数字) `sizechange`/`alphachange`/`colorchange` 这类**变化算子**的 `endvalue` 缺省：
       我们取 **0**（跟 GPL 参考的 `ValueChange`），MIT 参考取 **1**。两个独立实现冲突 ⇒ 只能"给档位 + 用数字说话"。
       这里统计"**没写 endvalue** 的算子数"——那就是"改缺省会改变行为"的精确影响面。 */
    if (/^(sizechange|alphachange|colorchange|oscillatesize|oscillatealpha)$/i.test(it.name)) {
      bump(counters.changeOps, it.name)
      if (it.endvalue === undefined || it.endvalue === null) {
        counters.changeNoEnd++
        bump(counters.changeNoEndByName, it.name)
        if (counters.changeNoEndExamples.length < 12) {
          counters.changeNoEndExamples.push({ pkg: pkgId, layer, sys: sysPath, name: it.name, startvalue: it.startvalue, endvalue: it.endvalue, starttime: it.starttime, endtime: it.endtime })
        }
      } else counters.changeWithEnd++
    }
  }
  for (const it of (Array.isArray(j.renderer) ? j.renderer : [])) {
    if (!it || typeof it.name !== 'string') continue
    bump(counters.renderNames, it.name)
    const isTrail = /trail/i.test(it.name)
    if (isTrail) {
      counters.trail++
      for (const k of Object.keys(it)) bump(counters.trailKeys, k)
      bump(counters.trailMaxLen, it.maxlength === undefined ? '(缺省)' : String(it.maxlength))
      bump(counters.trailLen, it.length === undefined ? '(缺省)' : String(it.length))
      bump(counters.trailSegments, it.segments === undefined ? '(缺省)' : String(it.segments))
      if (examples.trail.length < 10) examples.trail.push({ pkg: pkgId, layer, sys: sysPath, name: it.name, maxlength: it.maxlength, length: it.length, segments: it.segments, keys: Object.keys(it).join(',') })
    }
  }
  for (const c of (Array.isArray(j.children) ? j.children : [])) visitSystem(c, sysPath + '>', pkgId, layer)
}
/** scene.json 里 `objects[].particle` 是**容器内一个 json 的路径**（不是内联对象）——这是本轮踩到的第一件事。 */
function visitObj(obj, pkgId, layerPath, readParticle) {
  if (!obj || typeof obj !== 'object') return
  counters.objects++
  if (typeof obj.particle === 'string' && obj.particle) {
    counters.emitterFiles++
    const j = readParticle(obj.particle)
    if (j) visitSystem(j, obj.particle, pkgId, layerPath)
    else parseFails++
  }
  if (Array.isArray(obj.children)) for (const c of obj.children) visitObj(c, pkgId, layerPath + '/' + String((c && c.name) || '?'), readParticle)
}

const containers = listContainers()
for (const c of containers) {
  let idx = null
  try { idx = readIndexHead(c.file) } catch { continue }
  const entryOf = (re) => idx.entries.find((x) => re.test(x.name))
  const sjHit = entryOf(/(^|\/)scene\.json$/i)
  if (!sjHit) continue
  let sj = null
  try { sj = JSON.parse(Buffer.from(readEntryBytes(c.file, idx, sjHit)).toString('utf8')) } catch { continue }
  pkgsSeen.add(c.id)
  const cache = new Map()
  const readParticle = (rel) => {
    try {
      if (cache.has(rel)) return cache.get(rel)
      const hit = idx.entries.find((x) => x.name === rel || x.name === rel.replace(/^\.\//, '') || x.name.endsWith('/' + rel))
      if (!hit) { cache.set(rel, null); return null }
      const j = JSON.parse(Buffer.from(readEntryBytes(c.file, idx, hit)).toString('utf8'))
      cache.set(rel, j)
      return j
    } catch { return null }
  }
  const objs = Array.isArray(sj.objects) ? sj.objects : []
  for (const o of objs) visitObj(o, c.id, String((o && o.name) || '?'), readParticle)
}

const fmtMap = (m, top = 10) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, v]) => k + '×' + v).join('  ') || '(无)'
console.log('语料根：' + SCENE_ROOT)
console.log('容器：' + containers.length + ' 个（能解出 scene.json 的 ' + pkgsSeen.size + ' 个）；对象 ' + counters.objects
  + ' / 引用粒子文件的槽位 ' + counters.emitterFiles + ' / 粒子系统（含 children 递归）' + counters.systems + '；粒子文件解析失败 ' + parseFails)
console.log('')
console.log('【initializer 词表】(上游 startvalue/endvalue 那条契约落在这类条目上)')
console.log('  ' + fmtMap(counters.initNames, 24))
console.log('【operator 词表】'); console.log('  ' + fmtMap(counters.opNames, 24))
console.log('【renderer 词表】'); console.log('  ' + fmtMap(counters.renderNames, 24))
console.log('')
console.log('【startvalue/endvalue 配对】同时有 start+end：' + counters.startEnd + ' 个；只有 start（**缺 end**）：' + counters.startNoEnd
  + ' 个；只有 end：' + counters.endNoStart + ' 个')
console.log('【变化算子的 endvalue 缺省】我们=0（GPL 参考）/ 上游 MIT=1 —— 冲突项，只能给档位')
console.log('  变化算子总数 : ' + fmtMap(counters.changeOps, 8))
console.log('  写明 endvalue: ' + counters.changeWithEnd + ' 个；**没写**（= 缺省值起作用）: ' + counters.changeNoEnd + ' 个'
  + '（按名字：' + fmtMap(counters.changeNoEndByName, 8) + '）')
if (counters.changeNoEndExamples.length) {
  console.log('  没写 endvalue 的例子：')
  for (const e of counters.changeNoEndExamples) console.log('    ' + e.pkg + ' · ' + e.layer + ' · ' + e.name
    + ' · startvalue=' + JSON.stringify(e.startvalue) + ' starttime=' + JSON.stringify(e.starttime) + ' endtime=' + JSON.stringify(e.endtime))
}
console.log('')
console.log('【trail 参数分布】共 ' + counters.trail + ' 个 trail 渲染器')
console.log('  出现过的键 : ' + fmtMap(counters.trailKeys, 14))
console.log('  maxlength : ' + fmtMap(counters.trailMaxLen))
console.log('  length    : ' + fmtMap(counters.trailLen))
console.log('  segments  : ' + fmtMap(counters.trailSegments))
if (examples.startNoEnd.length) {
  console.log('\n【只有 start 没有 end 的例子】（这些就是"改缺省 0→1 会改变行为"的对象）')
  for (const e of examples.startNoEnd) console.log('  ' + e.pkg + ' · ' + e.layer + ' · ' + e.sys + ' · ' + e.name + ' · 字段=' + e.keys)
}
if (examples.trail.length) {
  console.log('\n【trail 例子】')
  for (const e of examples.trail) console.log('  ' + e.pkg + ' · ' + e.layer + ' · ' + e.name + ' · maxlength=' + JSON.stringify(e.maxlength) + ' length=' + JSON.stringify(e.length) + ' segments=' + JSON.stringify(e.segments) + ' · 字段=' + e.keys)
}
if (JSON_OUT) {
  console.log('PARTICLE-DEFAULT-SCAN-JSON ' + JSON.stringify({
    sceneRoot: SCENE_ROOT, containers: containers.length, packages: [...pkgsSeen],
    counters: { objects: counters.objects, emitterFiles: counters.emitterFiles, systems: counters.systems, startEnd: counters.startEnd, startNoEnd: counters.startNoEnd, endNoStart: counters.endNoStart, trail: counters.trail, parseFails,
      changeNoEnd: counters.changeNoEnd, changeWithEnd: counters.changeWithEnd },
    changeNoEndByName: Object.fromEntries(counters.changeNoEndByName), changeNoEndExamples: counters.changeNoEndExamples,
    initNames: Object.fromEntries(counters.initNames), opNames: Object.fromEntries(counters.opNames), renderNames: Object.fromEntries(counters.renderNames),
    trailKeys: Object.fromEntries(counters.trailKeys),
    trailMaxLen: Object.fromEntries(counters.trailMaxLen), trailLen: Object.fromEntries(counters.trailLen), trailSegments: Object.fromEntries(counters.trailSegments),
    examples,
  }))
}
