// build-audio-bus.mjs —— 把 `lib/audio-bus.js` **内联**进 `lib/client.js` 的 MPW-AUDIO-BUS 区
//
// 为什么需要生成器而不是让 client.js `import`：`lib/client.js` 是本插件的**单文件产物**（页面里直接跑，
// 没有模块图；同仓既有做法就是"内联 + 漂移门禁"，见 `tools/build-now-playing.mjs` 与
// `tools/now-playing-test.mjs` 的生成器自比）。手抄一份必然漂移 ⇒ 用生成器 + 双向对拍把它钉死。
//
// 用法：
//   node tools/build-audio-bus.mjs            # 生成/更新 client.js 里的块（幂等）
//   node tools/build-audio-bus.mjs --check    # 只校验：块与 lib/audio-bus.js 是否一致（不一致 exit 1）
//
// 生成内容 = ① 模块源码（去掉行首 `export `，整体裹进 IIFE ⇒ 不与 client.js 里任何既有标识符撞名）
//            ② 插件侧接线（模式判定纯函数 + 跟随设置 `mute` 的同步 + 帧内各装一遍由模块自己负责）
import fs from 'node:fs'
import path from 'node:path'

const REPO = path.resolve(import.meta.dirname, '..')
const MOD = path.join(REPO, 'lib', 'audio-bus.js')
const OUT = path.join(REPO, 'lib', 'client.js')
const CHECK = process.argv.includes('--check')
const BEGIN = '\t\t// ═══ MPW-AUDIO-BUS-BEGIN ═══'
const END = '\t\t// ═══ MPW-AUDIO-BUS-END ═══'

const modSrc = fs.readFileSync(MOD, 'utf8').replace(/^export /gm, '')
const block = [
  BEGIN + '（由 tools/build-audio-bus.mjs 从 lib/audio-bus.js 生成；**勿手改**，改 lib/audio-bus.js 后重跑生成器）',
  '\t\tconst MPW_AUDIO_BUS = (() => {',
  modSrc,
  '\t\t\treturn { installAudioBus, normalizeMode, modeMutes, modeMutesAll, modeRedirectOnly, BUS_MODES, LATE_START_SEC }',
  '\t\t})()',
  '\t\t/** 模式来源：`?mpwhardmute=off|redirect|1|all|report`。缺省 = **顶层 `redirect`**（只重定向 + 归因，',
  '\t\t *  避免顺手把宿主自己的提示音也压掉）、**帧内 `1`**（壁纸帧是真要压的那一半）。',
  '\t\t *  显式 `1`/`all` 才会连顶层一起压；帧内不接受 `redirect`（那是诊断档，帧里要的是"压住"）。 */',
  '\t\tfunction mpwAudioBusModeFrom(search, isFrame) {',
  '\t\t\tconst m = /[?&]mpwhardmute=([a-z0-9]+)/i.exec(String(search == null ? "" : search))',
  '\t\t\tconst asked = m ? String(m[1]).toLowerCase() : ""',
  '\t\t\tif (["off", "redirect", "1", "all", "report"].indexOf(asked) >= 0) return (isFrame && asked === "redirect") ? "1" : asked',
  '\t\t\treturn isFrame ? "1" : "redirect"',
  '\t\t}',
  '\t\tlet mpwAudioBusApi = null',
  '\t\tlet mpwAudioBusTimer = 0',
  '\t\tlet mpwAudioBusStorageWired = false',
  '\t\t/* ⑸(2026-09-23 静音/卡顿轮) 上一次同步过的 `mute` 值：轮询与 `storage` 事件两条通路共用，',
  '\t\t   "值没变 ⇒ 一个副作用都不做"（旧写法每 800ms 只比较、但那 750ms 的重压在总线上另有副作用）。 */',
  '\t\tlet mpwAudioBusLastMute = null',
  '\t\t/** 把"静音"同步到总线上（`npApplyMute` 之外的**第二条**通路：总线压的是别人建的 AudioContext）。 */',
  '\t\tfunction mpwAudioBusSetMuted(v) { try { if (mpwAudioBusApi) mpwAudioBusApi.setMuted(!!v) } catch (e) {} }',
  '\t\tfunction mpwAudioBusSync() {',
  '\t\t\ttry { const st = readSection() || {}; mpwAudioBusSetMuted(st.mute !== void 0 ? !!st.mute : true) } catch (e) {}',
  '\t\t}',
  '\t\t/** ⑸ 设置变更的**事件驱动**通路（另一条 800ms 轮询只是兜底）：`mute` 真变了才下发。 */',
  '\t\tfunction mpwAudioBusOnStorage() {',
  '\t\t\ttry { const st = readSection() || {}; const m = (st.mute !== void 0 ? !!st.mute : true); if (m !== mpwAudioBusLastMute) { mpwAudioBusLastMute = m; mpwAudioBusSetMuted(m) } } catch (e) {}',
  '\t\t}',
  '\t\t/** ⑸ 真卸载/换壁纸时的释放口：**旧写法 `dispose()` 全仓无人调用** ⇒ 750ms 重压定时器、原型钩子、',
  '\t\t *  MutationObserver 与帧内那份总线都跟着页面走到底（资源审计 #8/#9）。这里把它们一起收回，',
  '\t\t *  并留一条可查读数（`window.__mpwAudioBusDisposed`）。接线点见文件末尾的 `ctx.effect` 与',
  '\t\t *  `disposeWebFrame`（帧被卸载时释放**帧内**那条）。 */',
  '\t\tfunction mpwAudioBusDispose(why) {',
  '\t\t\ttry {',
  '\t\t\t\tif (mpwAudioBusTimer) { try { clearInterval(mpwAudioBusTimer) } catch (e) {} ; mpwAudioBusTimer = 0 }',
  '\t\t\t\tif (mpwAudioBusStorageWired) { try { window.removeEventListener("storage", mpwAudioBusOnStorage) } catch (e) {} ; mpwAudioBusStorageWired = false }',
  '\t\t\t\tconst api = mpwAudioBusApi',
  '\t\t\t\tmpwAudioBusApi = null',
  '\t\t\t\tmpwAudioBusLastMute = null',
  '\t\t\t\t/* 模块侧 dispose：清 750ms 重压定时器 + 还原全部原型钩子 + 断 observer + 连**帧内那份**一起释放 */',
  '\t\t\t\tif (api && typeof api.dispose === "function") api.dispose()',
  '\t\t\t\ttry { window.__mpwAudioBusDisposed = { at: Date.now(), why: String(why == null ? "" : why), ticks: (window.__mpwAudioBusRepatch && window.__mpwAudioBusRepatch.ticks) || 0 } } catch (e) {}',
  '\t\t\t\treturn true',
  '\t\t\t} catch (e) { return false }',
  '\t\t}',
  '\t\tfunction mpwInstallAudioBus() {',
  '\t\t\ttry {',
  '\t\t\t\tif (mpwAudioBusApi) return mpwAudioBusApi',
  '\t\t\t\tconst isFrame = (() => { try { return window.top !== window.self } catch (e) { return true } })()',
  '\t\t\t\tconst mode = mpwAudioBusModeFrom(String((window.location && window.location.search) || ""), isFrame)',
  '\t\t\t\tmpwAudioBusApi = MPW_AUDIO_BUS.installAudioBus(window, { mode: mode })',
  '\t\t\t\tmpwAudioBusSync()',
  '\t\t\t\t/* 跟随设置：`mute` 一变就同步。主通路 = `storage` 事件（同源帧/其它标签页写设置也会到），',
  '\t\t\t\t   800ms 轮询只是兜底（一次对象读 + 一次比较，值没变时零副作用）。',
  '\t\t\t\t   总线自己在 visibilitychange 时还会重压一次。 */',
  '\t\t\t\tif (!mpwAudioBusStorageWired) { mpwAudioBusStorageWired = true; try { window.addEventListener("storage", mpwAudioBusOnStorage) } catch (e) {} }',
  '\t\t\t\ttry { mpwAudioBusLastMute = !!(readSection() || {}).mute } catch (e) { mpwAudioBusLastMute = null }',
  '\t\t\t\tif (!mpwAudioBusTimer) mpwAudioBusTimer = setInterval(() => { try { const st = readSection() || {}; const m = (st.mute !== void 0 ? !!st.mute : true); if (m !== mpwAudioBusLastMute) { mpwAudioBusLastMute = m; mpwAudioBusSetMuted(m) } } catch (e) {} }, 800)',
  '\t\t\t\treturn mpwAudioBusApi',
  '\t\t\t} catch (e) { return null }',
  '\t\t}',
  END,
].join('\n')

let src = fs.readFileSync(OUT, 'utf8')
const hasBlock = src.indexOf(BEGIN) >= 0 && src.indexOf(END) > src.indexOf(BEGIN)
if (hasBlock) {
  const i = src.indexOf(BEGIN), j = src.indexOf(END) + END.length
  const current = src.slice(i, j)
  if (CHECK) {
    const same = current === block
    console.log((same ? '✓' : '✗') + ' client.js 的 MPW-AUDIO-BUS 块与 lib/audio-bus.js ' + (same ? '一致' : '**不一致**（重跑 node tools/build-audio-bus.mjs）'))
    process.exit(same ? 0 : 1)
  }
  src = src.slice(0, i) + block + src.slice(j)
} else {
  if (CHECK) { console.log('✗ client.js 里还没有 MPW-AUDIO-BUS 块（先跑生成器）'); process.exit(1) }
  const anchor = '\t\tfunction mpwInstallAudioAudit() {'
  const at = src.indexOf(anchor)
  if (at < 0) { console.error('✗ 找不到插入锚点 `function mpwInstallAudioAudit() {`'); process.exit(2) }
  src = src.slice(0, at) + block + '\n' + src.slice(at)
}
// 调用点：紧跟在既有审计安装之后（同一作用域，`readSection` 可用）
const callAudit = '\t\ttry { mpwInstallAudioAudit(); } catch (e) {}'
if (src.indexOf('mpwInstallAudioBus();') < 0) {
  const at = src.indexOf(callAudit)
  if (at < 0) { console.error('✗ 找不到调用锚点 ' + JSON.stringify(callAudit)); process.exit(2) }
  src = src.slice(0, at + callAudit.length) + '\n\t\ttry { mpwInstallAudioBus(); } catch (e) {}' + src.slice(at + callAudit.length)
}
fs.writeFileSync(OUT, src)
console.log('✓ 已写入 client.js：MPW-AUDIO-BUS 块 ' + block.split('\n').length + ' 行（源 lib/audio-bus.js ' + modSrc.split('\n').length + ' 行）')
