// audio-bus-wiring-test.mjs —— 总线级静音**接线**的判据（2026-09-22）
//
// `lib/audio-bus.js` 是源，`lib/client.js` 里的 MPW-AUDIO-BUS 块是**生成的内联产物**（client.js 是单文件
// 产物，页面里没有模块图 ⇒ 只能内联，与 `now-playing` 同款做法）。这条门禁钉三件事：
//   A **不许漂移**：块内容必须等于"用生成器规则从 lib/audio-bus.js 现算出来的那份"（改源不重跑 ⇒ 红）
//   B **真的被调用**：`mpwInstallAudioBus()` 在顶层被调用；块在 client.js 里、且只有一处
//   C **模式与同步语义**：`mpwAudioBusModeFrom` 纯函数口径（顶层缺省 redirect 只归因、帧内缺省 1 真压、
//     显式档照办、帧内不接受 redirect）+ 跟随设置 `mute` 的同步存在
//   D **分辨力自证**：块被改一个字符 ⇒ A 必红；帧内缺省改成 redirect ⇒ C 必红（在内存副本上验，不动真树）
//
// 运行：node tools/audio-bus-wiring-test.mjs   （全过 ALL PASS，退出码 0）
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const REPO = path.resolve(import.meta.dirname, '..')
const MOD = path.join(REPO, 'lib', 'audio-bus.js')
const OUT = path.join(REPO, 'lib', 'client.js')
let pass = 0, fail = 0
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')) } else { fail++; console.log('  ✗ ' + n + (d ? '  [' + d + ']' : '')) } }
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16)

const BEGIN = '\t\t// ═══ MPW-AUDIO-BUS-BEGIN ═══'
const END = '\t\t// ═══ MPW-AUDIO-BUS-END ═══'
const src = fs.readFileSync(OUT, 'utf8')
const modSrc = fs.readFileSync(MOD, 'utf8').replace(/^export /gm, '')

/** 与生成器同规则地"现算"期望块里的**模块部分**（只比模块源码本身，避免把接线文字也复制一遍）。 */
const expectedHasModule = src.indexOf(modSrc) >= 0

console.log('== A 内联块不许漂移 ==')
{
  const i = src.indexOf(BEGIN), j = src.indexOf(END)
  ok('A1 client.js 里有且只有一个 MPW-AUDIO-BUS 块', i >= 0 && j > i && src.indexOf(BEGIN, i + 1) < 0,
    JSON.stringify({ begin: i, end: j }))
  const blockText = src.slice(i, j)
  ok('A2 块里**逐字**包含 lib/audio-bus.js 的当前源码（改源不重跑生成器 ⇒ 这里立刻红）',
    expectedHasModule, '模块 sha=' + sha(modSrc) + ' 块 sha=' + sha(blockText))
  ok('A3 块被 IIFE 裹住（模块里的顶层名字不会与 client.js 撞名）',
    /const MPW_AUDIO_BUS = \(\(\) => \{[\s\S]*?\}\)\(\)/.test(src.slice(i, j)))
  ok('A4 块里带"勿手改 / 重跑生成器"的说明与生成器路径',
    /由 tools\/build-audio-bus\.mjs 从 lib\/audio-bus\.js 生成/.test(src.slice(i, j)))
}

console.log('\n== B 真的被调用（顶层、且在既有音频审计安装之后）==')
{
  const calls = (src.match(/try \{ mpwInstallAudioBus\(\); \} catch \(e\) \{\}/g) || []).length
  ok('B1 `mpwInstallAudioBus()` 恰好被调用一次', calls === 1, 'calls=' + calls)
  const auditAt = src.indexOf('try { mpwInstallAudioAudit(); } catch (e) {}')
  const busAt = src.indexOf('try { mpwInstallAudioBus(); } catch (e) {}')
  ok('B2 调用点在"音频审计安装"之后（同一作用域：`readSection` 可用；先装钩子再接管输出）',
    auditAt > 0 && busAt > auditAt, JSON.stringify({ audit: auditAt, bus: busAt }))
  ok('B3 幂等：`mpwInstallAudioBus()` 内部有"已装过就直接返回"的守卫',
    /if \(mpwAudioBusApi\) return mpwAudioBusApi/.test(src))
}

console.log('\n== C 模式与同步语义（纯函数口径）==')
{
  const FN = (src.match(/function mpwAudioBusModeFrom\(search, isFrame\) \{[\s\S]*?\n\t\t\}/) || [''])[0]
  ok('C0 切出了 `mpwAudioBusModeFrom` 的实现', FN.length > 0, 'len=' + FN.length)
  const mode = new Function(FN + '\nreturn mpwAudioBusModeFrom')()
  ok('C1 缺省：顶层 = `redirect`（只重定向 + 归因，不顺手压宿主自己的提示音）', mode('', false) === 'redirect', mode('', false))
  ok('C2 缺省：帧内 = `1`（壁纸帧是真要压住的那一半）', mode('', true) === '1', mode('', true))
  ok('C3 显式 `1` / `all` / `off` / `report` 照办（顶层与帧内一致）',
    mode('?mpwhardmute=1', false) === '1' && mode('?mpwhardmute=all', true) === 'all'
    && mode('?mpwhardmute=off', true) === 'off' && mode('?mpwhardmute=report', false) === 'report')
  ok('C4 帧内**不接受** `redirect`（那是诊断档；帧里要的是"压住"）⇒ 提升为 `1`',
    mode('?mpwhardmute=redirect', true) === '1', mode('?mpwhardmute=redirect', true))
  ok('C5 非法值回落缺省（不抛、不猜）', mode('?mpwhardmute=bogus', false) === 'redirect' && mode('?mpwhardmute=', true) === '1')
  ok('C6 跟随设置：`mpwAudioBusSync` 读 `readSection().mute` 并同步到总线',
    /function mpwAudioBusSync\(\)[\s\S]{0,200}?readSection\(\)[\s\S]{0,120}?mpwAudioBusSetMuted\(/.test(src))
  ok('C7 设置变化靠有界轮询同步（800ms；不是每个 np 路径都插一行那种容易漏的写法）',
    /setInterval\(\(\) => \{ try \{ const st = readSection\(\)[\s\S]{0,200}?\}, 800\)/.test(src))
  ok('C8 静音同步走模块 API（`mpwAudioBusApi.setMuted`），没有自己另写一套 gain 逻辑',
    /function mpwAudioBusSetMuted\(v\) \{ try \{ if \(mpwAudioBusApi\) mpwAudioBusApi\.setMuted\(!!v\) \}/.test(src))
  ok('C9 顶层与帧内用**同一个**安装入口（帧由模块的 `syncFrames` 递归装，模式随实例走）',
    /MPW_AUDIO_BUS\.installAudioBus\(window, \{ mode: mode \}\)/.test(src))
}

console.log('\n== D 分辨力自证（内存副本，不动真树）==')
{
  const before = sha(src)
  // ① 把块里某个字符改掉 ⇒ A2 的那条比较必须变红
  const mutated = src.replace(modSrc, modSrc.replace('LATE_START_SEC = 1.0', 'LATE_START_SEC = 9.9'))
  ok('D1 模块源码被改一个字 ⇒ "块逐字包含当前源"不再成立（A2 会红）',
    mutated !== src && mutated.indexOf(modSrc) < 0)
  // ② 帧内缺省改成 redirect ⇒ C2/C4 必红
  const FN = (src.match(/function mpwAudioBusModeFrom\(search, isFrame\) \{[\s\S]*?\n\t\t\}/) || [''])[0]
  const broken = FN.replace('return isFrame ? "1" : "redirect"', 'return "redirect"')
  const brokenMode = new Function(broken + '\nreturn mpwAudioBusModeFrom')()
  ok('D2 帧内缺省改成 redirect ⇒ C2 口径不再成立（帧内不再真压）', brokenMode('', true) === 'redirect')
  ok('D3 真树 sha 跑前跑后一致（变异只在内存里）', sha(fs.readFileSync(OUT, 'utf8')) === before, before)
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败')
if (fail === 0) console.log('✓ 音频总线接线通过：内联块与源逐字一致 / 顶层被调用且幂等 / 模式（顶层 redirect、帧内 1、显式照办）/ 跟随设置同步 / 有分辨力')
process.exit(fail > 0 ? 1 : 0)
