// _audio-mute.mjs —— 门禁/探针启动的浏览器**一律静音**的 prefs（唯一来源）
//
// 为什么要有它（2026-09-29 用户实测"幽灵声音"）：
//   用户在 Termux:X11 的 Volume Control(Playback) 里反复看到
//     `Nightly: WEwebLoader` / `Nightly: we-scene 验证` / `Nightly: <壁纸名>`
//   这些流 —— 都是**门禁自己启动的无头 Firefox**（Playwright 的 Firefox 品牌名 = Nightly）在跑
//   测试台 `:8902`（标题 WEwebLoader）与渲染器页 `:8899`（标题"we-scene 验证服务器 v2"），
//   而**渲染器页顶层直接打开时 `mpwAudioSilent()` 恒 false**（它只读宿主 iframe 的 `muted`），
//   于是场景 `sound` 层的 BGM 真的放了出来；最多时同时 5 路（门禁里有多个用例各自起浏览器）。
//   Playwright 默认**放开**自动播放（`media.autoplay.default`），所以不是浏览器策略能挡住的。
//
// 口径：**门禁静音是硬保证**（不管页面怎么改，测试期间都不出声）；页面侧"无手势不出声 / 后台不出声 /
//   多实例只有一个出声"是产品语义，另有判据（见 P-225 任务书），两者互补。
//
// 用法（任何要 `firefox.launch` 的文件都要走这个）：
//   import { AUDIO_MUTE_PREFS } from './_audio-mute.mjs'          // tests/ 下
//   import { AUDIO_MUTE_PREFS } from '../_audio-mute.mjs'         // tests/x11-e2e/ 下
//   const browser = await firefox.launch({ headless: true, firefoxUserPrefs: { ...AUDIO_MUTE_PREFS, 'webgl.force-enabled': true } })
//
// 判据：`tests/gate-audio-mute-test.mjs`（静态扫全部 `firefox.launch(` 调用点，缺静音 prefs 即红）。

/** Firefox 静音三件套（缺一不可，逐条有理由）：
 *  · `media.volume_scale: '0'`      —— 把**所有**媒体输出按 0 缩放（比页面 muted 更硬：页面怎么设都不出声）
 *  · `media.autoplay.default: 5`    —— 禁止自动播放（5 = 连有声自动播放一起挡；Playwright 默认是放开）
 *  · `dom.audiochannel.mutedByDefault: true` —— 音频通道默认静音（覆盖 WebAudio/游离 Audio 元素那类） */
export const AUDIO_MUTE_PREFS = Object.freeze({
  'media.volume_scale': '0',
  'media.autoplay.default': 5,
  'dom.audiochannel.mutedByDefault': true,
})

/** 合并进任意 prefs 对象（后写的不覆盖静音三项）。 */
export function withAudioMute(prefs) {
  return Object.assign({}, prefs || {}, AUDIO_MUTE_PREFS)
}
