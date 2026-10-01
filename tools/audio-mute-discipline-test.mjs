#!/usr/bin/env node
// audio-mute-discipline-test.mjs — P-225 探针侧静音纪律判据（静态扫，纯 Node，不开浏览器）。
//
// 背景（用户实测"幽灵声音"）：插件仓 20+ 个探针直接 `firefox.launch`，无头 Firefox（Nightly）
//   加载测试台/插件面时自动播放的媒体会真的建出 PulseAudio 流（最多 5 路 `Nightly: …`）。
//   Playwright 默认放开自动播放 ⇒ 只能靠 prefs 三件套把输出缩到 0：
//     `media.volume_scale='0'` + `media.autoplay.default=5` + `dom.audiochannel.mutedByDefault=true`
//   （与渲染器仓 `tests/_audio-mute.mjs` 同口径；不跨仓 import，各仓自带）。
//
// 判据：
//   A1 每个含 `firefox.launch(`/`chromium.launch(` 的 tools/*.mjs 都 import 了 `_audio-mute.mjs`
//      并在 launch 实参里用了 `withAudioMute`/`withAudioMuteIfAllowed`；
//   A2 `_audio-mute.mjs` 三件套逐键在位（值也钉死）；
//   A3 反例自证：把 `_audio-mute.mjs` 的三件套改成空 ⇒ A2 红（隔离副本真改真跑）；
//   A4 显式开关：`withAudioMuteIfAllowed` 只认 `MPW_PROBE_AUDIO=1`（音频观测类探针的逃生门，
//      默认恒静音）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const FILE = fileURLToPath(import.meta.url)
const TOOLS = process.env.AUDIO_DISC_TOOLS || path.dirname(FILE)
let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}

console.log('== P-225 探针侧静音纪律（tools/*.mjs）==')

/* A1 全部 launch 调用点带静音 */
{
  const files = fs.readdirSync(TOOLS).filter((f) => f.endsWith('.mjs') && f !== '_audio-mute.mjs' && f !== 'audio-mute-discipline-test.mjs')
  const offenders = [], users = []
  for (const f of files) {
    const src = fs.readFileSync(path.join(TOOLS, f), 'utf8')
    if (!/firefox\.launch\(|chromium\.launch\(/.test(src)) continue
    if (!/_audio-mute\.mjs/.test(src) || !/withAudioMute/.test(src)) offenders.push(f)
    else users.push(f)
  }
  check('A1a 缺静音的 launch 调用点 = 0（清单：' + offenders.join(', ') + '）', offenders.length === 0, 'users=' + users.length)
  check('A1b 静音用户 ≥ 20（探针面覆盖完整）', users.length >= 20, 'n=' + users.length)
  check('A1c 每个用户文件里 launch 实参真的引用了 withAudioMute（不是只 import 没用）',
    users.every((f) => /withAudioMute(IfAllowed)?\(/.test(fs.readFileSync(path.join(TOOLS, f), 'utf8'))), '')
  const nCalled = users.reduce((n, f) => n + (fs.readFileSync(path.join(TOOLS, f), 'utf8').match(/withAudioMute(IfAllowed)?\(/g) || []).length, 0)
  check('A1d withAudioMute 调用次数 ≥ launch 调用点数（每处 launch 都被包住）', nCalled >= users.length, 'calls=' + nCalled)
}

/* A2 三件套逐键钉值 */
{
  const src = fs.readFileSync(path.join(TOOLS, '_audio-mute.mjs'), 'utf8')
  check('A2a media.volume_scale = 0', /'media\.volume_scale':\s*'0'/.test(src), '')
  check('A2b media.autoplay.default = 5', /'media\.autoplay\.default':\s*5/.test(src), '')
  check('A2c dom.audiochannel.mutedByDefault = true', /'dom\.audiochannel\.mutedByDefault':\s*true/.test(src), '')
  check('A2d withAudioMute 后写不覆盖（Object.assign({}, prefs, AUDIO_MUTE_PREFS)）',
    /Object\.assign\(\{\}, prefs \|\| \{\}, AUDIO_MUTE_PREFS\)/.test(src), '')
  check('A2e MPW_PROBE_AUDIO 逃生门在位（观测类探针显式打开才出声）',
    /MPW_PROBE_AUDIO/.test(src) && /withAudioMuteIfAllowed/.test(src), '')
}

/* A4 行为级：withAudioMuteIfAllowed 真行为 */
{
  const r = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const m = await import(${JSON.stringify(path.join(TOOLS, '_audio-mute.mjs'))});
     const a = m.withAudioMuteIfAllowed({ 'x': 1 });
     const ok1 = a['media.volume_scale'] === '0' && a['x'] === 1;
     process.env.MPW_PROBE_AUDIO = '1';
     const b = m.withAudioMuteIfAllowed({ 'x': 1 });
     const ok2 = b['media.volume_scale'] === undefined && b['x'] === 1;
     console.log(JSON.stringify({ ok1, ok2 }));`], { encoding: 'utf8', input: '' })
  let out = {}
  try { out = JSON.parse((r.stdout || '').trim().split('\n').pop()) } catch (e) {}
  check('A4a 默认：三件套并入；MPW_PROBE_AUDIO=1：不加静音（逃生门真开）',
    out.ok1 === true && out.ok2 === true, (r.stdout || '').trim().slice(0, 80))
}

/* A3 反例自证（隔离副本真改真跑；子进程带 --no-mutations ⇒ 不再递归） */
if (!process.argv.includes('--no-mutations')) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'audio-disc-'))
  const root = path.join(tmp, 'mut')
  fs.mkdirSync(root, { recursive: true })
  // ①(平台适配) 本机 fs.cpSync 对目录报 EINVAL（PRoot 环境）——手写递归拷（判据只需要 tools/*.mjs 文本）
  for (const f of fs.readdirSync(TOOLS)) {
    const sp = path.join(TOOLS, f), dp = path.join(root, f)
    if (fs.statSync(sp).isFile()) fs.copyFileSync(sp, dp)
  }
  const target = path.join(root, '_audio-mute.mjs')
  const mutated = fs.readFileSync(target, 'utf8').replace(/'media\.volume_scale':\s*'0'/, "'media.volume_scale': '1'")
  fs.writeFileSync(target, mutated)
  const r = spawnSync(process.execPath, [FILE, '--no-mutations'], { encoding: 'utf8', maxBuffer: 16 << 20, input: '', env: { ...process.env, MPW_REPO_ROOT: path.dirname(TOOLS), AUDIO_DISC_TOOLS: root } })
  const reds = (r.stdout || '').split('\n').filter((l) => l.includes('✗')).length
  check('A3 三件套改坏（volume_scale 0→1）⇒ A2 组必红（红项 ≥1）', reds >= 1, '红项=' + reds)
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log('\n===== audio-mute-discipline: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
process.exit(fail ? 1 : 0)
