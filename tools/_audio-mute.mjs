// _audio-mute.mjs —— 探针启动的浏览器**一律静音**的 prefs（本仓唯一来源）
//
// 为什么要有它（2026-09-29 用户实测"幽灵声音"）：插件仓 20+ 个探针直接 `firefox.launch`，
//   无头 Firefox（Playwright 品牌名 = Nightly）加载测试台/插件面时自动播放的媒体会真的建出
//   PulseAudio 流（用户在 Volume Control(Playback) 里看到最多 5 路 `Nightly: …`）。
//   Playwright 默认**放开**自动播放，浏览器策略挡不住 ⇒ 只能靠 prefs 把输出缩到 0。
//   与渲染器仓 `tests/_audio-mute.mjs` **同口径**（同三件套；不跨仓 import——各仓自带一份）。
//
// 用法：
//   import { AUDIO_MUTE_PREFS } from './_audio-mute.mjs'   // tools/ 下
//   const browser = await firefox.launch({ headless: true, firefoxUserPrefs: withAudioMute() })
//   // 已有 firefoxUserPrefs 的：firefoxUserPrefs: withAudioMute({ 'gfx.webrender.all': true })
//
// ⚠ 默认静音；**只有显式打开才出声**：需要真听声音的观测类探针用
//   `MPW_PROBE_AUDIO=1` 环境变量走 `withAudioMuteIfAllowed()`（注释写明，判据有登记）。
// 判据：`tools/audio-mute-discipline-test.mjs`（静态扫全部 launch 调用点，缺静音即红）。

/** Firefox 静音三件套（缺一不可，逐条有理由）：
 *  · `media.volume_scale: '0'`      —— 所有媒体输出按 0 缩放（比页面 muted 更硬）
 *  · `media.autoplay.default: 5`    —— 禁止自动播放（Playwright 默认放开）
 *  · `dom.audiochannel.mutedByDefault: true` —— 音频通道默认静音（覆盖 WebAudio/游离 Audio 元素） */
export const AUDIO_MUTE_PREFS = Object.freeze({
  'media.volume_scale': '0',
  'media.autoplay.default': 5,
  'dom.audiochannel.mutedByDefault': true,
})

/** 合并进任意 prefs 对象（后写不覆盖静音三项）。 */
export function withAudioMute(prefs) {
  return Object.assign({}, prefs || {}, AUDIO_MUTE_PREFS)
}

/** 需要真听声音的观测类探针用：`MPW_PROBE_AUDIO=1` 时**不加**静音（默认恒加）。
 *  用例必须在注释里写明"默认静音、只有显式打开才出声"。 */
export function withAudioMuteIfAllowed(prefs) {
  if (process.env.MPW_PROBE_AUDIO === '1') return Object.assign({}, prefs || {})
  return withAudioMute(prefs)
}
