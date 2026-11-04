// ═══════════════════════════════════════════════════════════════════════════════
// media-host.js — WE「媒体集成 + 音频响应」的**宿主侧**（P-62）
//
// 纯逻辑、无 DOM、无网络：可在 Node 里整体单测（见 media-host-test.mjs）。宿主（demo.html /
// 插件 / 测试）负责把真实数据喂进来；本模块负责
//   ① 维护当前媒体状态（曲名/歌手/专辑/封面/时长/进度/播放态/歌词）
//   ② 把它翻译成官方 event 形状，并经 `opts.dispatch` 投递给脚本沙箱的导出回调
//   ③ 注入音频频谱，并为 `engine.registerAudioBuffers(n)` 提供**长期稳定、原地更新**的缓冲
//
// ── 官方 API 证据（不猜；三条独立来源）───────────────────────────────────────
// [E1] 官方 TS 定义（随 WE 安装分发）：wallpaper_engine/ui/dist/monaco/autocomplete/
//      lib.sceneScript.d.ts
//        L292-330 class MediaPropertiesEvent { title, artist, subTitle, albumTitle,
//                  albumArtist, genres, contentType }
//        L333-365 class MediaThumbnailEvent { hasThumbnail, primaryColor, secondaryColor,
//                  tertiaryColor, textColor, highContrastColor }   ← 三个颜色都是 Vec3
//        L368-390 class MediaPlaybackEvent { state; static PLAYBACK_STOPPED=0 /
//                  PLAYBACK_PLAYING=1 / PLAYBACK_PAUSED=2 }
//        L393-405 class MediaTimelineEvent { position, duration }
//        L408-415 class MediaStatusEvent { enabled }
//        L481-489 class AudioBuffers { left: Float32Array; right: Float32Array; average: Float32Array }
//        L1485-1504 engine.AUDIO_RESOLUTION_16=16 / _32 / _64;
//                  engine.registerAudioBuffers(resolution): AudioBuffers
// [E2] 官方编辑器「插入函数」菜单：wallpaper_engine/ui/dist/scripts/scripts.js
//        button("mediaStatusChanged",  "@param {MediaStatusEvent} event")
//        button("mediaPlaybackChanged","@param {MediaPlaybackEvent} event")
//        button("mediaPropertiesChanged","@param {MediaPropertiesEvent} event")
//        button("mediaThumbnailChanged","@param {MediaThumbnailEvent} event")
//        button("mediaTimelineChanged","@param {MediaTimelineEvent} event")
//      → 回调名就是这 5 个（**没有** `mediaProperties()`；官方函数名带 `Changed` 后缀）
// [E3] 官方英文文案（wallpaper_engine/locale/ui_en-us.json）：
//        ui_settings_enable_media_integration_support_hint =
//        "Allows wallpapers to read the title, artist and album cover of the currently
//         playing music. This feature will work with all music players that support the
//         Windows media overlay."                    → 语义 = 歌名/歌手/**封面**
// [E4] 官方音频示例（随 WE 分发）：wallpaper_engine/ui/dist/monaco/snippets/
//        script_factor_audio_response.js
//        `const audioBuffer = engine.registerAudioBuffers(engine.AUDIO_RESOLUTION_16);`
//        `const audioDelta = audioBuffer.average[scriptProperties.frequency] - smoothValue;`
//        → **顶层调用一次、长期持有**该对象，每帧读 `.average[i]`（这就是"必须原地更新"的根据）
// [E5] 官方工程 shaders：wallpaper_engine/projects/defaultprojects/audiophile/shaders/
//        audiophile.vert 用 uniform g_AudioSpectrum16Left / g_AudioSpectrum16Right
//        （渲染端侧；证明 16 段、左右声道、0..1 量纲）
//
// ── 语料实证（真实壁纸包里的作者脚本；包 id → 调用）─────────────────────────
//   mediaPropertiesChanged  : 3554161528(L1592) `mediaData = event.title`
//                             3660962877(L124) `mediaData = event.title`
//                             3326873240(L18)  `mediaData = event.artist` / (L19) title
//                             3327063360(L55)  artist / (L56) title
//                             3544152633(L5684) `mediaData = event.albumArtist`
//                                        (L5685) `mediaData = event.albumTitle`
//   mediaThumbnailChanged   : 3326873240(L9/L13/L15/L31) `newColor = event.primaryColor /
//                             tertiaryColor / textColor` → `newColor.subtract(old).multiply(t).add(old)`
//                             3544152633(L41) `color = event.primaryColor`
//                             3327063360(L17/L50/L52)、3470764447(L12) 同款
//                             3554161528(L1111) `thisObject.getAnimation().play()`
//   mediaPlaybackChanged    : 3326873240(L9)  `thisLayer.visible = event.state !== MediaPlaybackEvent.PLAYBACK_STOPPED`
//                             3544152633(L48) `if (event.state == MediaPlaybackEvent.PLAYBACK_PLAYING) cooldownTimer = 0`
//                             3327063360(L46/L47/L50)、3326873240(L26/L27) `playbackState = event.state`
//   mediaTimelineChanged    : 3326873240(L15) & 3327063360(L52)
//                             `defRatio = 1/event.duration; curRatio = event.position/event.duration`
//   mediaStatusChanged      : **全语料零命中**（官方 d.ts/插入菜单有 → 仍实现，安全空转）
//   registerAudioBuffers    : 3660962877(L8/L9/…) `engine.registerAudioBuffers(engine.AUDIO_RESOLUTION_16)`
//                             3326873240 / 3327063360 / 3470764447 同款；3544152633 用 `(16)` 字面量
//                             → 读法一律 `audioBuffer.average[i]`（还有 `audioBuffer.average.reduce(...)`）
//   getAverageVolume() / getFrequencyData() : **全语料零命中、官方 d.ts 零命中**
//                             → 本模块只作为**非官方兼容别名**提供（见 §音频），文档如实标注。
//   `$mediaThumbnail` / `$mediaPreviousThumbnail` : 官方**系统纹理名**
//                             （scripts.js EditorSystemResourcesModalCtrl 的 systemTextures
//                               [{value:"$mediaThumbnail"},{value:"$mediaPreviousThumbnail"}]）
//                             → 封面进画面走材质纹理槽，**不是**脚本回调；本模块把 coverUrl/
//                               coverBytes 交给渲染端去建纹理（见 getCoverForTexture）。
//
// ── 与 scene-scripts.js 的边界 ────────────────────────────────────────────────
// 本模块**不导入** scene-scripts.js：只把事件交给 `opts.dispatch(name, payload)`，由宿主绑到
// `dispatchScriptEvent(scriptCache, name, payload)`。这样本模块保持纯逻辑可单测，也避免循环依赖。
// ═══════════════════════════════════════════════════════════════════════════════

import { Vec3 } from './scene-script-apis.js';
import { lyricIndexAt, lyricLineAt, parseLRC, resolveLyrics } from './media-lyrics.js';

export { parseLRC, lyricIndexAt, lyricLineAt, resolveLyrics };

// ── 播放态（官方 MediaPlaybackEvent；数值与 d.ts L379-389 逐位一致）──────────
export const MEDIA_PLAYBACK = Object.freeze({
  STOPPED: 0,
  PLAYING: 1,
  PAUSED: 2,
  UNKNOWN: -1,   // ①非官方扩展：scene-scripts.js 沙箱里已有的 PLAYBACK_UNKNOWN（语料零命中）
});

// 语料实证的 5 个官方回调名（顺序即官方插入菜单顺序）
export const MEDIA_CALLBACKS = Object.freeze([
  'mediaStatusChanged',
  'mediaPlaybackChanged',
  'mediaPropertiesChanged',
  'mediaThumbnailChanged',
  'mediaTimelineChanged',
]);

// 非官方扩展回调名（本仓库定义；WE 官方 d.ts / 插入菜单 / 语料**零命中**）
export const MEDIA_EXTENSION_CALLBACKS = Object.freeze(['mediaLyricsChanged']);

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const str = (v) => (v == null ? '' : String(v));

/** 0..1 钳位（频谱量纲：官方 audiophile 的 g_AudioSpectrum* 与脚本 audioBuffer 都是 0..1） */
const clamp01 = (v) => { const n = num(v, 0); return n < 0 ? 0 : (n > 1 ? 1 : n); };

/** 颜色 → Vec3 实例（**必须**是 Vec3：语料脚本对它调 .subtract()/.multiply()/.add()） */
function toColor(v) {
  if (v instanceof Vec3) return v;
  if (Array.isArray(v)) return new Vec3(clamp01(v[0]), clamp01(v[1]), clamp01(v[2]));
  if (v && typeof v === 'object') return new Vec3(clamp01(v.x), clamp01(v.y), clamp01(v.z));
  return new Vec3(0, 0, 0);
}

/** Float32Array ↔ 数组归一化（注入侧宽容：Float32Array / number[] / undefined 都收） */
function toBand(v) {
  if (v instanceof Float32Array) return v;
  if (Array.isArray(v)) return Float32Array.from(v, clamp01);
  if (v && typeof v.length === 'number') return Float32Array.from(v, clamp01);
  return null;
}

/** 重采样到 n 段：n < 源长 → 分组求均值（与官方"分辨率降采样"观感一致）；n > 源长 → 线性插值 */
function resample(src, n, dst) {
  const out = dst || new Float32Array(n);
  const len = src ? src.length : 0;
  if (!len) { out.fill(0); return out; }
  if (len === n) { out.set(src); return out; }
  if (n < len) {
    const g = len / n;
    for (let i = 0; i < n; i++) {
      const i0 = Math.floor(i * g);
      const i1 = Math.max(i0 + 1, Math.floor((i + 1) * g));
      let s = 0;
      for (let j = i0; j < i1 && j < len; j++) s += src[j];
      out[i] = s / (i1 - i0);
    }
    return out;
  }
  for (let i = 0; i < n; i++) {
    const x = (i * (len - 1)) / Math.max(1, n - 1);
    const i0 = Math.floor(x), i1 = Math.min(len - 1, i0 + 1);
    const f = x - i0;
    out[i] = src[i0] * (1 - f) + src[i1] * f;
  }
  return out;
}

/**
 * 创建宿主媒体源。
 *
 * opts:
 *   dispatch(name, payload)  事件出口。**唯一必需接线点**：宿主绑到
 *                            `dispatchScriptEvent(scriptCache, name, payload)`。
 *                            省略 → 事件只进 host.events（供测试/诊断断言），不派发。
 *   now()                    当前毫秒时间戳（默认 Date.now；测试注入假时钟）
 *   timelineIntervalMs       播放中 timeline 事件的最小间隔（默认 250ms；官方"sent frequently"）
 *   onError(name, err)       脚本回调抛错回调（默认吞掉，与 applySceneScripts 同容错口径）
 *   spectrum                 初始频谱（见 setAudioSpectrum）
 *   lyrics                   LRC 文本 / [{t,text}] / null
 */
export function createMediaHost(opts = {}) {
  const nowMs = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const dispatchFn = typeof opts.dispatch === 'function' ? opts.dispatch : null;
  const onError = typeof opts.onError === 'function' ? opts.onError : null;
  const timelineIntervalMs = Math.max(0, num(opts.timelineIntervalMs, 250));

  // ── 媒体状态（唯一真值）────────────────────────────────────────────────────
  const state = {
    hasMedia: false,
    enabled: false,                 // 官方 mediaStatusChanged({enabled})
    playback: MEDIA_PLAYBACK.STOPPED,
    contentType: '',                // 'audio' / 'video'（官方字段）
    title: '', artist: '', subTitle: '', albumTitle: '', albumArtist: '', genres: '',
    // 封面两种注入形态（二选一即可；**官方脚本读不到图片字节**，图片走 $mediaThumbnail 材质纹理）
    coverUrl: '',                   // 宿主已有可直接用的 URL（file:// / blob: / http(s):）
    coverBytes: null,               // Uint8Array（包内切片出来的原始字节；渲染端建 Blob URL）
    // 注：两者**互斥**—— setMedia 里显式给了一个就清掉另一个（"封面就是这份数据"的语义），
    //     避免上一首的 URL 把这一首的字节悄悄遮住。
    coverMime: '',                  // 可选 MIME 提示（渲染端建 Blob 用）
    colors: {                       // 官方 MediaThumbnailEvent 的 5 个颜色（Vec3）
      primaryColor: new Vec3(0, 0, 0),
      secondaryColor: new Vec3(0, 0, 0),
      tertiaryColor: new Vec3(0, 0, 0),
      textColor: new Vec3(1, 1, 1),
      highContrastColor: new Vec3(1, 1, 1),
    },
    duration: 0,                    // 秒
    position: 0,                    // 秒（基准值）
    positionUpdatedAt: nowMs(),     // 基准值的时间戳
    lyrics: [],                     // [{t, text}]（只有包内自带才非空）
    lyricsPath: '',                 // 命中的包内条目路径（'' = 无自带歌词）
    lyricIndex: -1,
    lyricLine: '',
  };

  // ── 事件出口 ───────────────────────────────────────────────────────────────
  const events = [];                // 未接线 / 诊断用的事件流水（最近 200 条）
  const counters = Object.create(null);
  let dispatchCalls = 0, dispatchErrors = 0;

  function emit(name, payload) {
    counters[name] = (counters[name] || 0) + 1;
    const rec = { name, payload, at: nowMs() };
    events.push(rec);
    if (events.length > 200) events.shift();
    if (!dispatchFn) return null;
    dispatchCalls++;
    try { return dispatchFn(name, payload); }
    catch (e) { dispatchErrors++; if (onError) { try { onError(name, e) } catch { /* ignore */ } } return null; }
  }

  // ── 官方 event 形状构造（字段名逐字对齐官方 d.ts）─────────────────────────
  const propsEvent = () => ({
    title: state.title, artist: state.artist, subTitle: state.subTitle,
    albumTitle: state.albumTitle, albumArtist: state.albumArtist,
    genres: state.genres, contentType: state.contentType,
    // ①非官方别名：`album` = albumTitle。语料**零命中**（语料只用 albumTitle），
    //   仅为兼容 webwallgl 参照实现与本仓库早期任务书的 {title,artist,album} 措辞。
    album: state.albumTitle,
  });
  const thumbEvent = () => ({
    hasThumbnail: !!(state.coverUrl || state.coverBytes || opts.forceThumbnail),
    primaryColor: state.colors.primaryColor,
    secondaryColor: state.colors.secondaryColor,
    tertiaryColor: state.colors.tertiaryColor,
    textColor: state.colors.textColor,
    highContrastColor: state.colors.highContrastColor,
    // ①非官方扩展字段（官方脚本拿不到图片本身；宿主/网页壁纸可直接用这个 URL）
    thumbnail: state.coverUrl || '',
  });
  const playbackEvent = () => ({ state: state.playback });
  const timelineEvent = () => ({ position: timelinePosition(), duration: state.duration });
  const statusEvent = () => ({ enabled: !!state.enabled });
  const lyricsEvent = () => ({
    index: state.lyricIndex, text: state.lyricLine, lines: state.lyrics, position: state.position,
  });

  // ── 进度 ───────────────────────────────────────────────────────────────────
  /** 实时进度（秒）：播放中 = 基准 + 墙钟增量；暂停/停止 = 基准（冻结，不回零） */
  function livePosition(now) {
    if (state.playback !== MEDIA_PLAYBACK.PLAYING) return state.position;
    const dt = (num(now, nowMs()) - state.positionUpdatedAt) / 1000;
    return state.position + (dt > 0 ? dt : 0);
  }
  /** 派发用进度：duration > 0 时钳到 duration（防进度条比值 > 1；不改 state.position） */
  function timelinePosition(now) {
    const p = livePosition(now);
    if (state.duration > 0 && p > state.duration) return state.duration;
    return p < 0 ? 0 : p;
  }

  let lastTimelineAt = -Infinity;
  let lastTimelinePos = 0;

  /** 按当前状态重算歌词当前行（无歌词 → -1/''，不报错） */
  function refreshLyric(now) {
    if (!state.lyrics || !state.lyrics.length) { state.lyricIndex = -1; state.lyricLine = ''; return; }
    const i = lyricIndexAt(state.lyrics, livePosition(now));
    state.lyricIndex = i;
    state.lyricLine = i >= 0 ? state.lyrics[i].text : '';
  }

  // ── 音频频谱：**长期稳定、原地更新**的缓冲 ────────────────────────────────
  // 官方示例（snippets/script_factor_audio_response.js）在脚本**顶层**调一次
  // registerAudioBuffers 并长期持有返回值 → 宿主必须每次就地改写同一组数组，
  // 否则脚本读到的是编译那一刻的快照（恒 0）。
  const spectrum = { left: null, right: null, average: null, volume: 0 };
  const bufs = new Map();           // len → {left,right,average}（同一 len 永远同一个对象）

  function makeBuf(n) {
    const buf = { left: new Float32Array(n), right: new Float32Array(n), average: new Float32Array(n) };
    // ①非官方兼容别名（官方 d.ts / 语料零命中；仅为本仓库任务书提到的名字提供实现）
    buf.getFrequencyData = (channel) => {
      const c = String(channel || 'average').toLowerCase();
      if (c === 'left' || c === 'l') return buf.left;
      if (c === 'right' || c === 'r') return buf.right;
      return buf.average;
    };
    buf.getAverageVolume = () => {
      let s = 0;
      for (let i = 0; i < buf.average.length; i++) s += buf.average[i];
      return buf.average.length ? s / buf.average.length : 0;
    };
    return buf;
  }

  function refill() {
    for (const [n, buf] of bufs) {
      resample(spectrum.left, n, buf.left);
      resample(spectrum.right, n, buf.right);
      resample(spectrum.average, n, buf.average);
    }
  }

  /**
   * 注入频谱。三种宽容入口（宿主给什么算什么；缺的通一律按能量语义补齐）：
   *   { left: Float32Array|number[], right: ..., average: ... }   ← 首选（与官方 AudioBuffers 同形）
   *   { average: [...] } / { average: number }                   ← 单声道 / 直接给平均值数组
   *   { volume: 0..1 }                                           ← 只有响度（三个通道全填该值）
   * 语料读取口径：`audioBuffer.average[i]`（16/32/64 段）——所以 average 是**唯一必填语义**。
   * 同时给了 bands 与 volume 时：bands 按 0..1 钳位**原样使用**（不做重标定，避免静默改数据），
   * volume 只作为 getSpectrum() 的响度读数。
   */
  function setAudioSpectrum(spec) {
    const s = spec || {};
    const vol = s.volume != null ? clamp01(s.volume) : null;
    let left = toBand(s.left), right = toBand(s.right);
    let average = (typeof s.average === 'number') ? Float32Array.from([clamp01(s.average)]) : toBand(s.average);
    if (!average) {
      if (left && right && left.length === right.length) {
        average = new Float32Array(left.length);
        for (let i = 0; i < left.length; i++) average[i] = (left[i] + right[i]) / 2;
      } else average = left || right || (vol != null ? Float32Array.from([vol]) : Float32Array.from([0]));
    }
    if (!left) left = right || average;
    if (!right) right = left || average;
    spectrum.left = left; spectrum.right = right; spectrum.average = average;
    spectrum.volume = vol != null ? vol : (() => { let s2 = 0; for (let i = 0; i < average.length; i++) s2 += average[i]; return average.length ? s2 / average.length : 0; })();
    refill();
    return getSpectrum();
  }

  function getSpectrum() {
    return {
      left: spectrum.left ? Array.from(spectrum.left) : [],
      right: spectrum.right ? Array.from(spectrum.right) : [],
      average: spectrum.average ? Array.from(spectrum.average) : [],
      volume: spectrum.volume,
      bands: spectrum.average ? spectrum.average.length : 0,
    };
  }

  /**
   * 交给 `engine.registerAudioBuffers(n)` 的函数（宿主把它塞进 applySceneScripts 的
   * `opts.audioBuffers`）。**同一 n 永远返回同一个对象实例、内容原地更新** —— 这是
   * "脚本读到的不是恒 0"的关键（官方示例在脚本顶层调用一次并长期持有）。
   */
  function audioBuffers(len) {
    const n = Math.max(1, Math.min(1024, Math.floor(num(len, 64)) || 64));
    let buf = bufs.get(n);
    if (!buf) { buf = makeBuf(n); bufs.set(n, buf); }
    refill();
    return buf;
  }

  // ── 封面 → 渲染端纹理（$mediaThumbnail）────────────────────────────────────
  /**
   * 渲染端拿它建 `$mediaThumbnail` 材质纹理。两种注入形态的**唯一出口**：
   *   URL 形态  → { kind:'url',   url }
   *   字节形态  → { kind:'bytes', bytes, mime }（宿主自行 createObjectURL）
   * 没有封面 → null（渲染端保持 authored 纹理/首帧，不做任何替换）。
   */
  function getCoverForTexture() {
    if (state.coverUrl) return { kind: 'url', url: state.coverUrl };
    if (state.coverBytes) return { kind: 'bytes', bytes: state.coverBytes, mime: state.coverMime || '' };
    return null;
  }

  // ── 派发（每个 set* 都自带官方语义的触发条件）──────────────────────────────
  function pushStatus() { return emit('mediaStatusChanged', statusEvent()); }
  function pushProperties() { return emit('mediaPropertiesChanged', propsEvent()); }
  function pushThumbnail() { return emit('mediaThumbnailChanged', thumbEvent()); }
  function pushPlayback() { return emit('mediaPlaybackChanged', playbackEvent()); }
  function pushTimeline(now) {
    lastTimelineAt = num(now, nowMs());
    lastTimelinePos = timelinePosition(now);
    return emit('mediaTimelineChanged', timelineEvent());
  }
  function pushLyrics() { return emit('mediaLyricsChanged', lyricsEvent()); }

  /**
   * 合并式注入媒体状态（宿主在"曲目变了"时调；也可只传变化字段）。
   * 触发顺序 = 官方语义顺序：status(首次启用) → properties → thumbnail → timeline。
   * 传 null / {} 且当前无媒体 → **什么都不派发**（无媒体时脚本保持 authored 值）。
   */
  function setMedia(patch) {
    if (patch == null) return { dispatched: [] };
    const p = patch;
    const first = !state.hasMedia;
    const prevTitle = state.title, prevArtist = state.artist, prevAlbum = state.albumTitle;
    if ('title' in p) state.title = str(p.title);
    if ('artist' in p) state.artist = str(p.artist);
    if ('subTitle' in p) state.subTitle = str(p.subTitle);
    if ('albumTitle' in p) state.albumTitle = str(p.albumTitle);
    else if ('album' in p) state.albumTitle = str(p.album);         // 非官方别名
    if ('albumArtist' in p) state.albumArtist = str(p.albumArtist);
    if ('genres' in p) state.genres = Array.isArray(p.genres) ? p.genres.join(',') : str(p.genres);
    if ('contentType' in p) state.contentType = str(p.contentType);
    if ('coverUrl' in p) { state.coverUrl = str(p.coverUrl); if (state.coverUrl) state.coverBytes = null; }
    if ('coverBytes' in p) { state.coverBytes = p.coverBytes || null; if (state.coverBytes) state.coverUrl = ''; }
    if ('coverMime' in p) state.coverMime = str(p.coverMime);
    if (p.colors && typeof p.colors === 'object') {
      for (const k of ['primaryColor', 'secondaryColor', 'tertiaryColor', 'textColor', 'highContrastColor']) {
        if (k in p.colors) state.colors[k] = toColor(p.colors[k]);
      }
    }
    for (const k of ['primaryColor', 'secondaryColor', 'tertiaryColor', 'textColor', 'highContrastColor']) {
      if (k in p) state.colors[k] = toColor(p[k]);
    }
    if ('duration' in p) state.duration = Math.max(0, num(p.duration, 0));
    if ('position' in p) { state.position = Math.max(0, num(p.position, 0)); state.positionUpdatedAt = nowMs(); }
    if ('playback' in p) state.playback = normalizePlayback(p.playback);
    if ('lyrics' in p) setLyrics(p.lyrics, { silent: true });

    state.hasMedia = true;
    const dispatched = [];
    if (first || !state.enabled) { state.enabled = true; pushStatus(); dispatched.push('mediaStatusChanged'); }
    const propsChanged = first || prevTitle !== state.title || prevArtist !== state.artist || prevAlbum !== state.albumTitle
      || 'subTitle' in p || 'albumArtist' in p || 'genres' in p || 'contentType' in p;
    if (propsChanged) { pushProperties(); dispatched.push('mediaPropertiesChanged'); }
    if ('coverUrl' in p || 'coverBytes' in p || p.colors || 'primaryColor' in p) { pushThumbnail(); dispatched.push('mediaThumbnailChanged'); }
    if ('duration' in p || 'position' in p) { refreshLyric(); pushTimeline(); dispatched.push('mediaTimelineChanged'); }
    return { dispatched };
  }

  /** 媒体源消失（播放器关了/切到"无媒体"）：派发 status(false)，之后脚本保持 authored 值 */
  function clearMedia() {
    state.hasMedia = false;
    state.enabled = false;
    state.playback = MEDIA_PLAYBACK.STOPPED;
    pushStatus();
    return { dispatched: ['mediaStatusChanged'] };
  }

  function normalizePlayback(v) {
    const n = Number(v);
    if (n === MEDIA_PLAYBACK.PLAYING || n === MEDIA_PLAYBACK.PAUSED || n === MEDIA_PLAYBACK.STOPPED) return n;
    if (typeof v === 'string') {
      const s = v.toLowerCase();
      if (s === 'playing' || s === 'play') return MEDIA_PLAYBACK.PLAYING;
      if (s === 'paused' || s === 'pause') return MEDIA_PLAYBACK.PAUSED;
      if (s === 'stopped' || s === 'stop' || s === 'ended') return MEDIA_PLAYBACK.STOPPED;
    }
    return MEDIA_PLAYBACK.UNKNOWN;
  }

  /** 播放态三态切换：变则派发 mediaPlaybackChanged（官方语义） */
  function setPlayback(v) {
    const next = normalizePlayback(v);
    const changed = next !== state.playback;
    if (changed) {
      // 切态瞬间把基准进度冻结到当前实时值，避免暂停后进度继续"回算"增长
      state.position = Math.max(0, livePosition());
      state.positionUpdatedAt = nowMs();
      state.playback = next;
      refreshLyric();
      pushPlayback();
    }
    return { changed, state: state.playback };
  }

  /** 宿主权威进度（`<audio>` 的 currentTime / 插件 postMessage 的进度）：更新并派发 timeline */
  function updatePosition(sec) {
    state.position = Math.max(0, num(sec, 0));
    state.positionUpdatedAt = nowMs();
    const beforeLyric = state.lyricIndex;
    refreshLyric();
    pushTimeline();
    // 歌词只在**换行**时派发（不是每次 timeupdate 都刷，避免 60Hz 噪音）
    if (state.lyrics.length && state.lyricIndex !== beforeLyric) pushLyrics();
    return { position: state.position };
  }

  /**
   * 每帧/定时调一次：① 播放中按墙钟推进进度；② 过了 timelineIntervalMs 才派发
   * mediaTimelineChanged（官方"frequently while playing"），不逐帧刷脚本。
   * 无媒体/暂停 → 只更新歌词行，不派发。
   */
  function tick(now) {
    const t = num(now, nowMs());
    const out = { dispatched: [] };
    if (state.hasMedia && state.lyrics.length) {
      const before = state.lyricIndex;
      refreshLyric(t);
      if (state.lyricIndex !== before) { pushLyrics(); out.dispatched.push('mediaLyricsChanged'); }
    }
    if (state.playback === MEDIA_PLAYBACK.PLAYING && t - lastTimelineAt >= timelineIntervalMs) {
      const pos = timelinePosition(t);
      if (Math.abs(pos - lastTimelinePos) > 1e-9 || !Number.isFinite(lastTimelineAt)) {
        pushTimeline(t);
        out.dispatched.push('mediaTimelineChanged');
      } else lastTimelineAt = t;
    }
    return out;
  }

  /**
   * 歌词：**只在包内自带时使用**（用户明确要求；不联网抓取）。
   * 入参：LRC 文本字符串 / [{t,text}] / null。null 或空 → 清空并保持无歌词（不报错）。
   */
  function setLyrics(input, o = {}) {
    let parsed = null;
    if (Array.isArray(input)) parsed = input.filter((l) => l && Number.isFinite(Number(l.t))).map((l) => ({ t: num(l.t), text: str(l.text) })).sort((a, b) => a.t - b.t);
    else if (typeof input === 'string' && input.trim()) parsed = parseLRC(input);
    state.lyrics = parsed || [];
    if (typeof o.path === 'string') state.lyricsPath = o.path;
    refreshLyric();
    if (!o.silent && state.lyrics.length) pushLyrics();
    return { lines: state.lyrics.length, path: state.lyricsPath };
  }

  /** 只读状态快照（宿主/测试/诊断用；颜色是 Vec3 实例，与脚本看到的一致） */
  function getState(now) {
    return {
      hasMedia: state.hasMedia, enabled: state.enabled, playback: state.playback,
      contentType: state.contentType,
      title: state.title, artist: state.artist, subTitle: state.subTitle,
      albumTitle: state.albumTitle, albumArtist: state.albumArtist, genres: state.genres,
      coverUrl: state.coverUrl, coverBytes: state.coverBytes, coverMime: state.coverMime,
      hasThumbnail: !!(state.coverUrl || state.coverBytes),
      colors: { ...state.colors },
      duration: state.duration,
      position: state.position, positionUpdatedAt: state.positionUpdatedAt,
      livePosition: livePosition(now),
      lyrics: state.lyrics, lyricsPath: state.lyricsPath,
      lyricIndex: state.lyricIndex, lyricLine: state.lyricLine,
    };
  }

  const host = {
    // 状态与注入
    setMedia, clearMedia, setPlayback, updatePosition,
    setAudioSpectrum, getSpectrum, audioBuffers,
    setLyrics, getCoverForTexture,
    tick,
    // 手动派发（宿主接线/调试用；正常路径由上面的 set* 自动触发）
    pushStatus, pushProperties, pushThumbnail, pushPlayback, pushTimeline, pushLyrics,
    emit,
    getState,
    get position() { return livePosition(); },
    get playback() { return state.playback; },
    events,
    get stats() { return { dispatchCalls, dispatchErrors, counters: { ...counters }, buffers: bufs.size, bands: spectrum.average ? spectrum.average.length : 0 }; },
  };
  if (opts.spectrum) setAudioSpectrum(opts.spectrum);
  if (opts.lyrics) setLyrics(opts.lyrics, { silent: true });
  return host;
}

export default createMediaHost;
