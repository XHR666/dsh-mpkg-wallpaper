#!/usr/bin/env node
// gate-audio-silence-test.mjs — P-225 行为级判据：门禁/无头浏览器跑真包时 **PulseAudio 里不许有可听的流**。
//
// 为什么这么判（父代理 2026-09-29 的 pactl 实测读数，逐条复述）：
//   无静音 prefs：  `Corked: no | Mute: no | Volume: mono: 65536 / 100% / 0.00 dB | application.name = "Nightly"` ⇒ 可听
//   带静音三件套：  `Corked: no | Mute: no | Volume: mono: 0 / 0% / -inf dB` ⇒ 静音（流仍在，但 0%）
//   根因：①渲染器页顶层打开时 mpwAudioSilent() 恒 false ⇒ BGM 真放；②Playwright 放开自动播放。
// 判据有分辨力的证明 = 反例自证（去掉静音 prefs ⇒ 同一读数变成 100%/0.00dB ⇒ 红）。
//
// **可 SKIP**：无 pactl / 无 PulseAudio(4713 不通) / 语料缺失 ⇒ 打印原因、以 0 退出（不假装通过）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'
import { AUDIO_MUTE_PREFS, withAudioMute } from './_audio-mute.mjs'

const FILE = fileURLToPath(import.meta.url)
let pass = 0, fail = 0, skipped = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}
const skipAll = (why) => { skipped++; console.log('  ⚠ SKIP：' + why); console.log('\n===== gate-audio-silence: SKIP（' + why + '） ====='); process.exit(0) }

console.log('== P-225 行为级：无头浏览器跑真包 ⇒ PulseAudio 无可听流 ==')

/* S0 前置探测（缺啥 SKIP 啥，不假装通过） */
if (!/^(1|true|yes)$/i.test(process.env.MPW_AUDIO_SILENCE || '1') && process.env.MPW_AUDIO_SILENCE === '0') skipAll('MPW_AUDIO_SILENCE=0 显式跳过')
const pactl = spawnSync('pactl', ['info'], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } })
if (pactl.status !== 0) skipAll('pactl 不可用或无 PulseAudio 服务器（exit=' + pactl.status + '）')
const serverStr = (pactl.stdout || '')
const hasPulse = /Server String:.*4713|PulseAudio/i.test(serverStr)
if (!hasPulse) skipAll('PulseAudio 服务器不含预期的本地桥（info 输出：' + serverStr.slice(0, 60) + '…）')
// 包装载走测试台的库通道：`/api/library` 找一个有 scene 的 itemId ⇒ `/pkg/<id>`（与 bench 同款）。
// 顶层渲染器页 URL = `/?shell=0&id=<itemId>&sceneFps=10&muted=0`（muted=0 模拟"用户显式开声"；
//   prefs 三件套是硬保证——页面怎么设都不出声，这正是本判据要证的）。
let itemId = null, looked = []
try {
  const lib = JSON.parse(spawnSync('curl', ['-s', 'http://127.0.0.1:8902/api/library'], { encoding: 'utf8' }).stdout || '{}')
  for (const it of (lib.items || [])) { looked.push(it.itemId); if (it.hasScene) { itemId = it.itemId; break } }
} catch (e) { looked.push('curl-fail') }
if (!itemId) skipAll('测试台 /api/library 没有 hasScene 的项（8902 在跑但库里没场景包；找过 ' + looked.length + ' 项）')
// Firefox 可用性
const FF = [process.env.MPW_FIREFOX || '/opt/firefox/firefox', 'firefox'].find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return true } catch { return false } })
if (!FF) skipAll('Firefox 不在（找过 /opt/firefox/firefox 与 PATH）')

/* playwright 引入走 _gl-browser 的既有候选顺序（环境变量 → 本仓 → 插件仓 → 全局） */
import { findPlaywright } from './_gl-browser.mjs'
const PW = findPlaywright()
if (!PW) skipAll('playwright 不可用（候选：MPW_PLAYWRIGHT / 本仓 / 插件仓 / /opt/node 全局）')
const pwMod = await import(pathToFileURL(PW).href)
const pwDefault = pwMod.default || pwMod
const firefox = pwDefault.firefox || pwMod.firefox
const projSize = 1920
/* 顶层渲染器页（真包臂用；`muted=0` 模拟"用户显式开声"，页面语义见 P-225） */
const url = 'http://127.0.0.1:8902/webloader/?id=' + itemId + '&sceneFps=10&muted=0&audio=1'

/* ── ①(2026-10-01 父代理重做为"确定性两臂") ─────────────────────────────────────────
   口径（判据一条没松）：**同一个必然出声的页面**，两臂只差"有没有静音三件套"：
     · 静音臂  ⇒ 流不存在，或存在时全 0%/-inf dB（=> S2）
     · 反例臂  ⇒ 出现 ≥1 条 100%/0.00 dB 的流（=> S3，判据有分辨力的证明）
   为什么不用真包页当读数面：实测真包臂常常**压根没有音频流**（`graph:null`），拿它当断言面会让判据永远 SKIP；
   而"桥是否建流"这件事必须确定 ⇒ 用内联 WAV data URI + autoplay（父代理实测：无静音 100%、带三件套 0%）。
   两臂**各自单独起浏览器**：实测上一臂关闭后仍可能残留 0% 流，会把反例臂误判成"静音"。
   真包页（`/webloader/?id=…` + 手势轮询）保留为**信息读数**（页面策略面：`__mpwAudioSilentReason` 等），不参与 pactl 断言。 */

/** 内联一段会**必然出声**的页面（8s 440Hz WAV data URI + autoplay loop）。 */
function loudPageHtml () {
  const sr = 8000, n = sr * 8
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8); buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24)
  buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / 20) * 12000), 44 + i * 2)
  return '<!doctype html><title>MPW-AUDIO-SILENCE-PROBE</title>' +
    '<audio id=a autoplay loop src="data:audio/wav;base64,' + buf.toString('base64') + '"></audio>'
}

/** 读一次 PulseAudio，按 "Sink Input #" 分块；只算 application.name 含 Nightly 的（= 门禁自己的浏览器）。 */
function readNightlyStreams () {
  const si = spawnSync('pactl', ['list', 'sink-inputs'], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } })
  const out = si.stdout || ''
  const res = { ok: si.status === 0, bytes: out.length, total: 0, muted: 0, audible: [] }
  for (const b of out.split(/Sink Input #\d+/).slice(1)) {
    if (!/Nightly/i.test(b)) continue
    res.total++
    /* ⚠(2026-10-01 父代理修)：旧写法 `/Volume: [^\n]*0%/` 会把 **100%** 判成 0%（"100%" 以 "0%" 结尾）⇒
       反例臂的 100% 流被误判成"静音"，判据永远红。改成**取百分数再比数值**。 */
    const vm = b.match(/Volume:[^\n]*?(\d+)%/)
    const vol0 = (vm ? Number(vm[1]) === 0 : false) || /-inf dB/.test(b)
    const mute = /Mute: yes/.test(b)
    if (vol0 || mute) res.muted++
    else res.audible.push(b.split('\n').filter((l) => /Volume:|Mute:|application.name/.test(l)).join(' | ').slice(0, 160))
  }
  return res
}

/** 等上一臂的流彻底消失（拿干净基线；超时也如实返回 left>0）。 */
async function waitNoNightlyStreams (maxMs = 20000) {
  const t0 = Date.now()
  for (;;) {
    const r = readNightlyStreams()
    if (r.total === 0) return { waited: Date.now() - t0, left: 0 }
    if (Date.now() - t0 > maxMs) return { waited: Date.now() - t0, left: r.total }
    await new Promise((res) => setTimeout(res, 500))
  }
}

/** 一臂：可选先开真包页做手势（信息读数），再换"必出声"页读 pactl。 */
async function probeArm ({ mute, realPack = false, tag = '' }) {
  const prefs = mute
    ? withAudioMute({ 'media.cubeb.backend': 'pulse', 'media.cubeb.sandbox': false })
    : { 'media.cubeb.backend': 'pulse', 'media.cubeb.sandbox': false, 'media.autoplay.default': 0 }
  const browser = await firefox.launch({ headless: true, env: { ...process.env, PULSE_SERVER: 'tcp:127.0.0.1:4713' }, firefoxUserPrefs: prefs })
  const out = { tag, mute, realPolicy: null, policy: null, streams: null }
  try {
    const page = await browser.newPage({ viewport: { width: projSize, height: 1080 } })
    if (realPack) {
      await page.goto(url, { timeout: 60000, waitUntil: 'domcontentloaded' }).catch(() => {})
      for (let i = 0; i < 20; i++) {                       // 手势轮询（页面语义：顶层要手势才解锁）
        await page.mouse.click(320, 240).catch(() => {})
        const st = await page.evaluate(() => JSON.stringify({ g: window.__mpwAudioPolicy ? window.__mpwAudioPolicy.gesture : null })).catch(() => '{}')
        let j = {}; try { j = JSON.parse(st) } catch (e2) {}
        if (j.g === true) break
        await page.waitForTimeout(1500)
      }
      out.realPolicy = await page.evaluate(() => JSON.stringify({ policy: window.__mpwAudioPolicy || null, reason: window.__mpwAudioSilentReason || null })).catch(() => 'eval-fail')
    }
    await page.setContent(loudPageHtml())                  // ← 确定性读数面
    await page.waitForTimeout(4500)
    out.policy = await page.evaluate(() => JSON.stringify({ paused: document.getElementById('a') ? document.getElementById('a').paused : null })).catch(() => '{}')
    out.streams = readNightlyStreams()
  } catch (e) {
    out.err = String((e && e.message) || e).slice(0, 140)
    out.streams = out.streams || readNightlyStreams()
  } finally {
    try { await browser.close() } catch (e) {}
    await waitNoNightlyStreams()                           // 给下一臂干净基线
  }
  return out
}

/* S1（信息）：真包页 + 手势 ⇒ 页面策略面读数（不参与 pactl 断言） */
const armMute = await probeArm({ mute: true, realPack: true, tag: '静音臂' })
console.log('  S1 真包页策略读数: ' + (armMute.realPolicy || '(未取到)'))
console.log('  S1b 静音臂 · 必出声页: streams total=' + armMute.streams.total + ' muted=' + armMute.streams.muted + ' audible=' + armMute.streams.audible.length + ' bytes=' + armMute.streams.bytes + (armMute.err ? ' err=' + armMute.err : ''))
check('S1 pactl 读成功 + 静音臂跑完（bytes=' + armMute.streams.bytes + '）', armMute.streams.ok === true && !armMute.err, '')

/* S2 判据：静音臂 ⇒ 无流，或流全 0%/-inf */
check('S2 静音三件套下：Nightly 的流不存在或全部 0%/mute（total=' + armMute.streams.total + ' muted=' + armMute.streams.muted + '）',
  armMute.streams.total === 0 || armMute.streams.muted === armMute.streams.total,
  armMute.streams.audible.length ? '可听读数：' + armMute.streams.audible.join(' ;; ') : '无可听流')

/* S3 反例自证：去掉三件套 ⇒ 必须出现可听流（否则判据没有分辨力，如实红） */
let armLoud = null
if (!process.argv.includes('--no-mutations')) {
  console.log('== S3 反例自证（去掉三件套 ⇒ 出现 100%/0.00dB 的流；判据有分辨力的证明）==')
  armLoud = await probeArm({ mute: false, realPack: false, tag: '反例臂' })
  console.log('  S3b 反例臂 · 必出声页: streams total=' + armLoud.streams.total + ' muted=' + armLoud.streams.muted + ' audible=' + armLoud.streams.audible.length + ' bytes=' + armLoud.streams.bytes + (armLoud.err ? ' err=' + armLoud.err : ''))
  if (armLoud.streams.audible.length) console.log('  S3b 可听流读数: ' + armLoud.streams.audible[0])
  check('S3 无静音 prefs ⇒ 出现 100%/0.00dB 的可听流', armLoud.streams.audible.length >= 1, 'audible=' + armLoud.streams.audible.length)
  if (armMute.streams.total === 0 && armLoud.streams.total === 0) {
    skipAll('连「必出声」页也没建出 sink-input（cubeb→Pulse 桥在本会话不可用；页面策略面读数已打印）⇒ 按纪律 SKIP，待可产出流的会话自动启用')
  }
}

console.log('\n===== gate-audio-silence: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
process.exit(fail ? 1 : 0)
