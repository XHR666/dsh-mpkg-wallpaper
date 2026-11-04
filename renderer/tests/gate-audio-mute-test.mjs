// gate-audio-mute-test.mjs —— **门禁/探针启动的浏览器必须静音**（用户 2026-09-29 报的"幽灵声音"防复发）
//
// 病（已实测）：门禁自己起无头 Firefox（Playwright 的 Firefox 品牌名 = Nightly）跑测试台 `:8902` /
//   渲染器页 `:8899` 时，页面**真的有声音** —— 用户在 Termux:X11 的 Volume Control 里看到
//   `Nightly: WEwebLoader` / `Nightly: we-scene 验证` / `Nightly: <壁纸名>` 这些流（最多同时 5 路）。
//   根因两条：① 渲染器页顶层直接打开时 `mpwAudioSilent()` 恒 false（它只读宿主 iframe 的 `muted`）；
//   ② Playwright **放开**自动播放（`media.autoplay.default`），所以浏览器策略挡不住。
//   ⇒ 硬保证只能落在启动参数上：**所有** `firefox.launch` 都要带 `tests/_audio-mute.mjs` 的三件套。
//
// 本判据（静态，纯 Node，不启浏览器）：
//   A 组：扫 `git ls-files 'tests/**'`，每个含 `firefox.launch(` 的**代码行**都必须
//         ① 引用 `AUDIO_MUTE_PREFS`（来自 `_audio-mute.mjs`）或
//         ② 行内/同文件明确出现三件套里的 `media.volume_scale`
//         （注释行不算 —— 与 cross-platform 门禁同一口径：扫代码不扫注释）
//   B 组：`_audio-mute.mjs` 三件套齐全且**不可被覆盖**（`withAudioMute` 后写静音键；防止有人"合并时被覆盖"）
//   C 组：反例自证（假样本必红）——证明这条门禁不是"永远绿"
//
// 退出码：0 = 通过；1 = 有调用点没静音。SKIP（无 git）⇒ 打印 SKIP 并以 0 退出。
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { ROOT } from './_root.mjs'
import { AUDIO_MUTE_PREFS, withAudioMute } from './_audio-mute.mjs'

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  — ' + detail : '')) } else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) } }

let files = []
try {
  files = execFileSync('git', ['ls-files', 'tests/**'], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean)
} catch (e) {
  console.log('SKIP gate-audio-mute —— 取不到 `git ls-files`（没有 git 或不在仓库里）：' + String((e && e.message) || e).slice(0, 120))
  process.exit(0)
}

/** 去注释后的代码文本（只扫代码：本文件/别处的注释里会大段引用 `firefox.launch(` 做说明）。 */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const offenders = []
let sites = 0
for (const rel of files) {
  let src = ''
  try { src = fs.readFileSync(path.join(ROOT, rel), 'utf8') } catch { continue }
  const code = stripComments(src)
  if (!/firefox\.launch\s*\(/.test(code)) continue
  const usesHelper = /AUDIO_MUTE_PREFS/.test(code) && /_audio-mute\.mjs/.test(code)
  const inlineMute = /media\.volume_scale/.test(code)
  // 逐个 `firefox.launch(` 调用点：同一行有静音来源即算合规（本仓的写法都是单行/紧邻多行）
  for (const m of code.matchAll(/firefox\.launch\s*\(/g)) {
    sites++
    const around = code.slice(m.index, m.index + 600)
    const covered = usesHelper || inlineMute || /AUDIO_MUTE_PREFS/.test(around)
    if (!covered) offenders.push({ rel, at: code.slice(0, m.index).split('\n').length })
  }
}

console.log('== A 组：所有 firefox.launch 调用点必须静音 ==')
ok('A1 扫到调用点（≥8 个；扫不到说明选择器或仓库结构变了，要改判据而不是当通过）', sites >= 8, `sites=${sites} files=${files.length}`)
ok('A2 每个调用点都有静音来源（`AUDIO_MUTE_PREFS` 或行内 `media.volume_scale`）', offenders.length === 0,
  offenders.length ? JSON.stringify(offenders) : `${sites} 个调用点全部合规`)

console.log('\n== B 组：静音三件套本身 ==')
{
  const keys = Object.keys(AUDIO_MUTE_PREFS)
  ok('B1 三件套齐全（volume_scale / autoplay.default / mutedByDefault）',
    keys.includes('media.volume_scale') && keys.includes('media.autoplay.default') && keys.includes('dom.audiochannel.mutedByDefault'), JSON.stringify(AUDIO_MUTE_PREFS))
  ok('B2 `media.volume_scale` = 0（把**所有**媒体输出缩到 0，比页面 muted 更硬）', String(AUDIO_MUTE_PREFS['media.volume_scale']) === '0')
  ok('B3 `withAudioMute` 后写静音键（传入的同名键不许覆盖它）',
    withAudioMute({ 'media.volume_scale': '1', 'webgl.force-enabled': true })['media.volume_scale'] === '0'
    && withAudioMute({ 'webgl.force-enabled': true })['webgl.force-enabled'] === true)
}

console.log('\n== C 组：反例自证（这条例外写法必须被判红）==')
{
  const bad = "const b = await firefox.launch({ headless: true, firefoxUserPrefs: { 'webgl.force-enabled': true } })"
  const good = "import { AUDIO_MUTE_PREFS } from './_audio-mute.mjs'\nconst b = await firefox.launch({ headless: true, firefoxUserPrefs: { ...AUDIO_MUTE_PREFS } })"
  const covered = (src) => { const c = stripComments(src); return /AUDIO_MUTE_PREFS/.test(c) || /media\.volume_scale/.test(c) }
  ok('C1 旧写法（只带 WebGL prefs）判红、新写法判绿', covered(bad) === false && covered(good) === true)
  ok('C2 注释里提到 `firefox.launch(` 不算调用点（本文件与任务书的说明不会被误判）',
    stripComments('// firefox.launch({ headless: true }) 只是注释\n').indexOf('firefox.launch') < 0)
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
if (!fail) console.log('✓ 门禁静音纪律成立：所有浏览器调用点都带静音 prefs（防"后台门禁出声"复发）')
process.exit(fail ? 1 : 0)
