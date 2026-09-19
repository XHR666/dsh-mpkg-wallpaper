# 声音归属排查（AUDIO-SOURCES.md）—— 「静音状态下还是突然冒出来的声音」是怎么定案的

> 用户原话（判据来源）：
> ①「莫名其妙播放音频又出现了，我刚才什么都没动，他又开始播放了……有时候可能响几声，有时候就没有了」
> ②「我现在静音状态下，他还是突然冒出来的声音，你必须把这个问题必须彻查出来」
>
> 结论先说：**这一段声音不是本插件放的**。它是**第三方插件 `dsh-whale-widget`（鲸鱼余额挂件）自己的 UI 音效**，
> 由它在 `document` **捕获阶段**监听的 `pointerdown` 触发，音量恒为 1，且**不读**我们的静音设置（它没有理由读）。
> 本节把证据链、复现命令、以及"怎么让那两下不响"写全 —— 下一次再有人报"莫名出声"，照着这份文档 30 秒能定案。

---

## 1. 为什么之前的排查一直"抓不到"

三件事叠在一起，让"响几声"这类现象变得极难抓：

| 现象 | 原因 |
| --- | --- |
| 只看 DOM 里的媒体元素 ⇒ 永远看不到它 | 鲸鱼的音效是 `new Audio('/dsh-whale/sound/press.mp3')` —— **不在 DOM 里**（`document.querySelectorAll('audio,video')` 只有我们自己的 `#mpw-bgVideo`） |
| 只审计主窗口 ⇒ 看不到别的窗口 | 同源 iframe 有**自己独立的 `HTMLMediaElement.prototype`**，在主窗口打补丁对它完全无效（本版已修，见 §3） |
| 只审计 `<audio>/<video>` ⇒ 看不到 WebAudio | Live2D 角色语音那类声源走 `AudioBufferSourceNode.start()`，**不碰任何标签**（本版已加钩子） |

## 2. 证据链（2026-09-20 实测，可逐条复跑）

设置前提（用户真机当时的档）：`mute = true`（面板写着静音）、`npLinkWallpaper = true`、壁纸 = `custommpkg|小鸟游星野01_04.mpkg`（video 档）。

**① 我们自己的元素在 300 秒里一次都没可听**（`--sec 300 --poke`，945 拍 × 250ms）：
```
H1 没有"静音设置开着却可听"的事件（mute-on-but-audible）   0 条
H2 也没有任何可听播放事件（audible-playback）             0 条
H3 我们自己的元素整段没有一拍可听                          945 拍全静音或暂停
```

**② 在鲸鱼控件上按下鼠标 ⇒ 立刻出现两条音频记录，归属写得清清楚楚**：
```
H5 命中点 (1359,819) ⇒ 新增 2 条：
   {"kind":"play","owner":"whale-widget","src":"…/dsh-whale/sound/press.mp3?set=fx1","muted":false,"vol":1,"npMute":true}
   {"kind":"play","owner":"whale-widget","src":"…/dsh-whale/sound/release.mp3?set=fx1","muted":false,"vol":1,"npMute":true}
H6 同一批记录：np.mute=true（我们的静音开着）而它们 muted=false / vol=1 ⇒ 不归本插件管
```
一次"按下—松开"正好是**两声**（press + release）—— 与用户描述的"有时候可能响几声"逐字吻合。

**③ 第三方那边的配置也是开着的**（不是我们猜的）：
```
$ cat /root/.dsh/.dshw-size.json
{"scale":1.1,"sound":true,"vol":1,"soundSet":"fx1", …}
```
`dsh-whale-widget/lib/index.js` 的触发链（只读行为结论，未取代码）：
`document.addEventListener('pointerdown', onDocPointerDown, true)` ⇒ `isWhaleHit(e)`（按 610×610 命中画布的像素 alpha 判定）
⇒ `pressDown()` ⇒ `playPress()` ⇒ `pressAudio.play()`；松开 ⇒ `playRelease()` ⇒ `releaseAudio.play()`。
它的 root 盒子 275×275、图片 163×163，位置在**右下角**（1440×900 下 `img` 约 `(1277,737)`）——
正好压在"聊天输入区/侧栏底部"这片用户天天点击的区域上 ⇒ 用户感觉是"我没动它就响了"（其实是点在它身上了）。

## 3. 这一版为"彻查"补的审计能力（`lib/client.js` 的 `mpwInstallAudioAudit`）

| 能力 | 为什么必须有 |
| --- | --- |
| `mpwAuditPatchWin(win)`：钩子可装进**任意窗口**，并对同源子帧递归安装（每秒重扫一次，上限 60 次） | 壁纸帧/别的插件帧里的 `<audio>/<video>` 用主窗口的原型补丁**完全看不到** |
| `webaudio-start` / `audioctx-resume` 钩子（`AudioBufferSourceNode` / `OscillatorNode` / `ConstantSourceNode` 的 `start()`） | Live2D 角色语音走 WebAudio，**不碰标签**；这是"静音却响一声"的另一类常见声源 |
| 每条记录带 `win{top,url,foreign}` | 跨源帧装不进钩子时**如实标 `foreign:true`**，不把"看不到"说成"没有" |
| 每条记录带 `el.owner`（`ours` / `whale-widget` / `frame` / `other`） | 用户问"这声音是谁放的"时一眼能分类；`whale-widget` 就是按 `src` 里的 `/dsh-whale/` 认出来的 |
| 新 trigger **`mute-on-but-audible`**（`np.mute===true` 且元素可听 ⇒ 立刻 POST `/diag`） | 把用户这次投诉的组合**变成判据**：旧判据只有泛化的"可听播放"，设置本来就"不静音"时也会报，指认不了现场 |

**判据**（都进了门禁，不是"跑一次就算"）：
`tools/wallpaper-lifecycle-test.mjs` 的 **P6/P6b–P6f** 静态钉住上面五条（含"注释剥离状态机"与"别把设计行为判红"的反例），
`tools/audio-source-hunt-live-probe.mjs` 的 **H1–H6** 真机复跑（`--selftest` 7 条判据分辨力自证，无浏览器）。

## 4. 怎么复现 / 怎么自查

```bash
# ① 真机守候（不动任何设置、只读）：默认 180s，250ms/拍
node tools/audio-source-hunt-live-probe.mjs --sec 300 --poke

# ② 因果判定：在鲸鱼控件上网格点击，抓"静音开着却出声"的记录（H5/H6）
node tools/audio-source-hunt-live-probe.mjs --sec 20 --whale

# ③ 判定逻辑自证（无浏览器、秒级）
node tools/audio-source-hunt-live-probe.mjs --selftest

# ④ 插件自身的审计环（用户浏览器里随时可查）：
#    window.__mpwAudioAudit.list   —— 每条含 kind/who(栈)/el.owner/win.url/muted/volume/paused/np.mute
#    window.__mpwLifecycleTest.audit()  —— 最近 20 条
#    ?npaudit=0 可完全关掉审计（零开销逃生门）
```
可疑记录会被自动 POST 到宿主 `/diag`，落在 `~/.dsh/.dsh-mpkg-wallpaper/diag-<ts>.json`
（`kind:"web-wallpaper"`、`why:"audio-audit"`、`trigger:"mute-on-but-audible"|"audible-playback"|…`）——
也就是说：**下一次"响"在磁盘上就有证据**，不用再靠"当场守着"。

## 5. 让那两下不响（三选一；都不是本插件能替你决定的）

| 做法 | 怎么做 | 影响 |
| --- | --- | --- |
| **A. 关掉鲸鱼音效（推荐）** | 鲸鱼自己的菜单里那一项声音开关（`.dshwv-menu-btn` → `.dshwv-sound`），或把 `/root/.dsh/.dshw-size.json` 的 `sound` 改成 `false` 后刷新页面 | 只影响第三方挂件的音效；壁纸/播放器声音不受影响 |
| **B. 把鲸鱼挪走** | 拖动鲸鱼到不常点的位置（它的位置会持久化） | 命中区不再和输入区重叠 ⇒ 误触概率大降 |
| **C. 保持现状** | —— | 点/拖鲸鱼时仍会响两声（这是它设计的功能） |

> 本插件**不能**替别的插件静音：那是别人的 `new Audio()`，我们既没有它的引用，也不该去改别人的状态。
> 我们能做且已经做的：**把归属查清楚并留证**（上面 §3/§4），以及保证**我们自己的**声音在任何情况下都不漏
> —— 用户这次报的场景里，"我们自己的元素 945 拍全静音"这条判据就是那个保证。

## 6. 诚实边界

1. **跨源 iframe 内的声音装不进钩子**（浏览器安全模型）：记录会标 `foreign:true`，我们能说"这段声音来自一个跨源帧"，
   但**读不到**它具体是谁放的（用户当前档是 video 档、无跨源帧；若将来用沙箱 web 壁纸，这一条会重新变得重要）。
2. **`owner` 指纹是按 `src` 关键字分类的**（`/dsh-whale/`、`/api/mpkg-wallpaper/`）：第三方换了素材路径就会落进 `other`
   —— 那时靠 `who`（调用栈）与 `win.url` 仍能定案，但分类那一栏不再自动正确。
3. **探针结论只覆盖它跑的这段时间与这些交互**：300s 内 0 漏音 ≠ "永远 0"，所以真正的保证是**审计常驻 + 自动上报**，
   而不是某一次探针的绿灯。
4. **鲸鱼音效开关属于用户的偏好**：默认只如实报告与给出做法，不替用户改（用户明确要求时再改，见 §5 A）。
