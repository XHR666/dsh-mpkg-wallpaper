// mpkg-oldschool-scene-test.mjs — P-208 A11「老式布局」判据：场景定义不在 scene.json 时按 project.json.file 取。
//
// 被验对象：`demo.html` 里 `// ═══ MPW-OLDSCENE-BEGIN/END ═══` 之间的小块（紧贴 MPW-NOSCENE 块之前）。
// 官方依据（REVERSE-FINDINGS-7 RE-61「老式布局」行 + RE-46 Android 端整体小写化）：
//   APK 官方样例 `techno.mpkg`（PKGM0012，27 条目，无 scene.json，project.file="techno.json"）、
//   `fantastic_car.mpkg`（PKGM0014，36 条目，无 scene.json，project.file="fantasticcar.json"）、
//   对照 `earth_parallax.mpkg`（PKGM0012，**有** scene.json，project.file="scene.json"）。
// 旧实现只认 scene.json ⇒ techno/fantastic_car 落进 MPW-NOSCENE 被判"纯视频壁纸"
// （且 project.file 指向的 JSON 条目会被按 video/mp4 建 blob）。本判据钉住：
//   T 组 真包：三件套解析出的条目名（techno.json / fantasticcar.json / scene.json）；
//   P 组 解析：techno/fantastic_car 的场景 JSON 经生产 parseScene 出层（层数 > 0 ⇒ 不是"纯视频"）；
//   U 组 单元：大小写不敏感命中、project.file 指向不存在条目 ⇒ null + 如实日志列 JSON 条目名、
//        纯视频包（project.file 指 .mp4）⇒ null（照旧落 NOSCENE 视频路径）、?oldschool=legacy 回退；
//   M 组 变异自证：把解析改回"只认 scene.json"⇒ T 组必红（隔离副本上真改真跑，真树零改动）。
// 夹具定位（官方资产不进仓库）：$MPW_APK_WALLPAPERS > <工作区>/wallpaper_engine/apk/assets/wallpapers
//   > /tmp/re5/assets/wallpapers（第 5 轮逆向的解包产物）。三者都缺 ⇒ 跳过 T/P 组（M 组单元口径照跑）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROOT, WS } from './_root.mjs'

const FILE = fileURLToPath(import.meta.url)
const DEMO = path.join(ROOT, 'demo.html')
const html = fs.readFileSync(DEMO, 'utf8')

let pass = 0, fail = 0, skipped = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}

const BEGIN = '// ═══ MPW-OLDSCENE-BEGIN ═══'
const END = '// ═══ MPW-OLDSCENE-END ═══'
const iBegin = html.indexOf(BEGIN), iEnd = html.indexOf(END)
const SRC = (iBegin >= 0 && iEnd > iBegin) ? html.slice(iBegin, iEnd) : ''
const lineOf = (idx) => (idx < 0 ? -1 : html.slice(0, idx).split('\n').length)

console.log('== A11 老式布局：场景定义条目名不一定是 scene.json ==')
console.log('   demo.html: 块 ' + lineOf(iBegin) + '…' + lineOf(iEnd) + ' 行')

/* 执行块源码：lib/rd/logf/pkg/window/location 由参数注入（与 demo.html 真实环境同形）。
   返回 { entry, logs } —— entry = 块解析出的 sceneEntryName。 */
function runBlock(src, pkg, lib, { location = undefined, projectJson } = {}) {
  const logs = []
  const win = {}
  const dec = new TextDecoder()
  const enc = new TextEncoder()
  const lib2 = projectJson !== undefined
    ? { ...lib, getEntry: (_p, name) => (name === 'project.json' ? enc.encode(projectJson) : lib.getEntry(_p, name)) }
    : lib
  const rd = (u8) => dec.decode(u8)
  const fn = new Function('lib', 'rd', 'logf', 'pkg', 'window', 'location', src + '\n;return { entry: sceneEntryName, win: window };')
  const r = fn(lib2, rd, (m) => logs.push(String(m)), pkg, win, location)
  return { entry: r.entry, win: r.win, logs }
}

/* U 组单元口径（mock 容器；不依赖官方夹具，恒跑） */
{
  const enc = new TextEncoder()
  const mkPkg = (names, project) => {
    const pkg = { magic: 'PKGM0012', entries: names.map((n) => ({ name: n, size: 1 })), buf: {}, fileSize: 99 }
    const lib = {
      getEntry: (_p, name) => (names.includes(name) ? enc.encode('BYTES') : null),
      parseWeJson: (t) => JSON.parse(t),
    }
    return { pkg, lib }
  }
  // U1 大小写不敏感命中（官方 Android 端 OpenFile 整体小写化，RE-46）
  {
    const { pkg, lib } = mkPkg(['Project.JSON', 'Techno.JSON'])
    const r = runBlock(SRC, pkg, lib, { projectJson: '{"file":"techno.json"}' })
    check('U1 project.file 与条目名大小写不同 ⇒ 大小写不敏感命中（保留条目原名）',
      r.entry === 'Techno.JSON', JSON.stringify(r.entry))
  }
  // U2 project.file 指向不存在的条目 ⇒ null + 如实日志（列容器内 JSON 条目名）
  {
    const { pkg, lib } = mkPkg(['scene2.json', 'preview.jpg'], )
    const r = runBlock(SRC, pkg, lib, { projectJson: '{"file":"missing.json"}' })
    check('U2 project.file 指向的条目不存在 ⇒ entry=null 且不抛', r.entry === null, JSON.stringify(r.entry))
    check('U2b 日志点名 project.json.file 并列出容器内 JSON 条目名',
      r.logs.some((l) => l.includes('project.json.file') && l.includes('missing.json') && l.includes('scene2.json')),
      JSON.stringify(r.logs.slice(0, 2)))
  }
  // U3 纯视频包：project.file 指 .mp4 ⇒ null（落 NOSCENE 视频路径，行为不变），无 warning
  {
    const { pkg, lib } = mkPkg(['wallpaper.mp4', 'preview.gif'])
    const r = runBlock(SRC, pkg, lib, { projectJson: '{"file":"wallpaper.mp4"}' })
    check('U3 project.file 是视频 ⇒ entry=null（NOSCENE 纯视频路径接管）且无日志噪音',
      r.entry === null && r.logs.length === 0, JSON.stringify({ entry: r.entry, logs: r.logs }))
  }
  // U4 没有 project.json ⇒ null 不抛
  {
    const { pkg, lib } = mkPkg(['a.txt'])
    const r = runBlock(SRC, pkg, lib)
    check('U4 连 project.json 都没有 ⇒ entry=null 不抛', r.entry === null && r.logs.length === 0, JSON.stringify(r.entry))
  }
  // U5 project.json 坏 JSON ⇒ null 不抛（NOSCENE 后缀兜底）
  {
    const { pkg, lib } = mkPkg(['v.mp4'])
    const r = runBlock(SRC, pkg, lib, { projectJson: '{坏 JSON' })
    check('U5 project.json 坏 ⇒ entry=null 不抛', r.entry === null && r.logs.length === 0, JSON.stringify(r.entry))
  }
  // U6 ?oldschool=legacy：只认 scene.json 的旧口径
  {
    const { pkg, lib } = mkPkg(['techno.json', 'project.json'])
    const r = runBlock(SRC, pkg, lib, { projectJson: '{"file":"techno.json"}', location: { search: '?oldschool=legacy' } })
    check('U6 ?oldschool=legacy ⇒ 老式解析关闭（entry=null，落旧 NOSCENE 行为）', r.entry === null, JSON.stringify(r.entry))
  }
  // U7 scene.json 存在恒胜（legacy 与否都一样）
  {
    const { pkg, lib } = mkPkg(['scene.json', 'techno.json', 'project.json'])
    const rLegacy = runBlock(SRC, pkg, lib, { projectJson: '{"file":"techno.json"}', location: { search: '?oldschool=legacy' } })
    const rNormal = runBlock(SRC, pkg, lib, { projectJson: '{"file":"techno.json"}' })
    check('U7 scene.json 存在 ⇒ 恒用 scene.json（legacy/新口径一致）',
      rLegacy.entry === 'scene.json' && rNormal.entry === 'scene.json',
      JSON.stringify({ legacy: rLegacy.entry, normal: rNormal.entry }))
  }
  // S 组结构：块存在、在 NOSCENE 之前、NOSCENE 入口条件已换成解析结果
  {
    const iNs = html.indexOf('// ═══ MPW-NOSCENE-BEGIN ═══')
    const iDecode = html.indexOf("rd(lib.getEntry(pkg, sceneEntryName || 'scene.json'))")
    check('S1 MPW-OLDSCENE 块恰好一次且在 MPW-NOSCENE 之前', iBegin > 0 && iEnd > iBegin && html.split(BEGIN).length - 1 === 1 && iEnd < iNs)
    check('S2 NOSCENE 入口条件 = 解析结果（`if (!sceneEntryName)`），scene.json 判定收进块内',
      /if \(!sceneEntryName\) \{/.test(html.slice(iEnd)) && /lib\.getEntry\(pkg, 'scene\.json'\)\) sceneEntryName = 'scene\.json'/.test(SRC))
    check('S3 无条件 decode 用解析出的条目名（`sceneEntryName || \'scene.json\'`）', iDecode > iEnd)
    check('S4 命中老式条目时记账 window.__mpwOldScene（可机读台账）', SRC.includes('window.__mpwOldScene = { entry'))
  }
}

/* T/P 组真包口径（官方 APK 样例；不进仓库，见文件头定位表） */
const FIX_DIRS = [
  process.env.MPW_APK_WALLPAPERS,
  path.join(WS, 'wallpaper_engine', 'apk', 'assets', 'wallpapers'),
  path.join(os.tmpdir(), 're5', 'assets', 'wallpapers'),   // ②(2026-09-29) 不用 /tmp 字面量：cross-platform 门禁 A/B 段会抓（os.tmpdir() 写法合规，见该门禁 G3b）
].filter(Boolean)
const fixOf = (name) => {
  for (const d of FIX_DIRS) { const p = path.join(d, name); if (fs.existsSync(p)) return p }
  return null
}
const techno = fixOf('techno.mpkg')
const fantcar = fixOf('fantastic_car.mpkg')
const earth = fixOf('earth_parallax.mpkg')
if (techno && fantcar && earth) {
  const lib = await import(path.join(ROOT, 'core', 'we-scene-bundle.js'))
  const dec = new TextDecoder()
  const loadPkg = (p) => lib.parsePkg(new Uint8Array(fs.readFileSync(p)))
  const rd = (u8) => dec.decode(u8)
  const CASES = [
    ['techno', techno, 'techno.json'],
    ['fantastic_car', fantcar, 'fantasticcar.json'],
    ['earth_parallax', earth, 'scene.json'],
  ]
  for (const [tag, file, want] of CASES) {
    const pkg = loadPkg(file)
    const r = runBlock(SRC, pkg, lib, {})
    check('T1 ' + tag + ' ⇒ 场景条目解析为 ' + want + '（不落 NOSCENE 纯视频路径）', r.entry === want, JSON.stringify(r.entry))
    if (r.entry) {
      const e = pkg.entries.find((x) => x.name === r.entry)
      const sj = lib.parseWeJson(rd(lib.getEntry(pkg, e.name)))
      const scene = lib.parseScene(sj, null, {})
      check('T2 ' + tag + ' ⇒ parseScene 出层（objects=' + (sj.objects || []).length + ' layers=' + scene.layers.length + '）',
        scene.layers.length > 0)
    }
  }
  // ①(P-222 A12 · RE-61) PKGM0012 官方魔数显式用例（防以后有人收窄 parsePkg 的 /PKGM/i 魔数正则）：
  //   techno/earth_parallax 都是 PKGM0012，parsePkg 原样解析（条目数 >0）。
  for (const [tag, file] of [['techno', techno], ['earth_parallax', earth]]) {
    const pkg = lib.parsePkg(new Uint8Array(fs.readFileSync(file)))
    check('A12 ' + tag + ' ⇒ 官方四魔数 PKGM0012 可解析（magic=' + pkg.magic + '，条目 ' + pkg.entries.length + '）',
      pkg.magic === 'PKGM0012' && pkg.entries.length > 0, pkg.magic + '/' + pkg.entries.length)
  }
  // T3 earth_parallax 的 project.file 本身就是 scene.json ⇒ 台账不写（不是"老式"命中）
  {
    const pkg = loadPkg(earth)
    const r = runBlock(SRC, pkg, lib, {})
    check('T3 earth_parallax 走 scene.json ⇒ 不写 __mpwOldScene 台账（老式台账只记 project.file 命中）',
      r.entry === 'scene.json' && !r.win.__mpwOldScene)
  }
  // T4 techno 命中时记账 __mpwOldScene
  {
    const pkg = loadPkg(techno)
    const r = runBlock(SRC, pkg, lib, {})
    check('T4 techno 命中 project.file ⇒ __mpwOldScene={entry:techno.json}', r.win.__mpwOldScene && r.win.__mpwOldScene.entry === 'techno.json')
  }
} else {
  skipped += 2
  console.log('  ⚠ SKIP T/P 组：官方 APK 样例不在本地（找过 ' + FIX_DIRS.join(' / ') + '）—— 单元口径 U/S 组已覆盖解析与回归')
}

/* M 组变异自证：隔离副本上真改真跑（真树零改动）。两个方向：
   M1「只认 scene.json 的旧写法」⇒ techno/fantastic_car 的 T1 必红；
   M2「把 project.file 命中改成不管后缀」⇒ U3（纯视频包误判成场景）必红。 */
if (!process.argv.includes('--no-mutations')) {
  console.log('== M 组变异自证（隔离副本；真树不动）==')
  const MUTANTS = [
    { id: 'only-scenejson', edit: (s) => s.replace("else if (!OLDSCENE_LEGACY) {", "else if (false) {") },
    { id: 'no-suffix-guard', edit: (s) => s.replace("if (__pf && /\\.json$/i.test(__pf)) {", "if (__pf) {") },
  ]
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-oldschool-'))
  for (const m of MUTANTS) {
    const mutated = m.edit(html)
    if (mutated === html) { check('M ' + m.id + ' 变异真的改到了（锚点未命中 ⇒ 判据腐烂）', false); continue }
    const mBegin = mutated.indexOf(BEGIN), mEnd = mutated.indexOf(END)
    const mSrc = (mBegin >= 0 && mEnd > mBegin) ? mutated.slice(mBegin, mEnd) : ''
    // 只认 scene.json：techno（无 scene.json、project.file=techno.json）必须解析不出条目 ⇒ 红
    const enc = new TextEncoder()
    const pkgT = { magic: 'PKGM0012', entries: ['techno.json', 'project.json'].map((n) => ({ name: n, size: 1 })), fileSize: 99 }
    const libT = { getEntry: (_p, name) => (['techno.json', 'project.json'].includes(name) ? enc.encode('BYTES') : null), parseWeJson: (t) => JSON.parse(t) }
    const rT = runBlock(mSrc, pkgT, libT, { projectJson: '{"file":"techno.json"}' })
    // 不管后缀：纯视频包（project.file=wallpaper.mp4）会被误判成场景条目 ⇒ 红
    const pkgV = { magic: 'PKGM0014', entries: ['wallpaper.mp4', 'project.json'].map((n) => ({ name: n, size: 1 })), fileSize: 99 }
    const rV = runBlock(mSrc, pkgV, libT, { projectJson: '{"file":"wallpaper.mp4"}' })
    if (m.id === 'only-scenejson') {
      check('M1 只认 scene.json 的旧写法 ⇒ techno 解析不出条目（T1 必红）', rT.entry === null, JSON.stringify(rT.entry))
    } else {
      check('M2 去掉 .json 后缀守卫 ⇒ 纯视频包被误判（U3 必红）', rV.entry === 'wallpaper.mp4', JSON.stringify(rV.entry))
    }
  }
  check('M 真树 demo.html 未被变异触碰', html === fs.readFileSync(DEMO, 'utf8'))
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log('\n===== mpkg-oldschool-scene: ' + pass + ' 通过 / ' + fail + ' 失败' + (skipped ? ' / 跳过组 ' + skipped : '') + ' =====')
process.exit(fail ? 1 : 0)
