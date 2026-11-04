// ═══════════════════════════════════════════════════════════════════════════════
// media-lyrics.js — 包内自带歌词（LRC）的探测 + 解析 + 当前行查询（P-62）
//
// 用户口径（原话）：**歌名、歌手、封面、进度、时长都做；歌词只有壁纸文件里自带才用，
// 没自带就不做**（不联网抓取任何歌词）。
//
// ── 语料结论（如实记录，见 PATCHES.md P-62）──────────────────────────────────
//   扫描范围：allwallpaper/**（88 容器 + 7 个松散 web 目录）+ Steam/steamapps/workshop/
//             content/431960/**（22 目录），条目名与 project.json/scene.json 全文：
//     · 松散 `.lrc/.srt/.ass/.vtt` 文件：**0 个**
//     · 容器内 `.lrc/.srt/.ass/.vtt` 条目：**0 个**
//     · project.json 含 `lyric` 字段：**0 个**
//     · scene.json 唯一 `lyric` 命中 = 3544152633/3660962877 的**用户属性名**
//       `brmusiccoverlyricsdragbrbr`（拖拽属性名，不是歌词内容）
//     · 官方 d.ts（lib.sceneScript.d.ts）里 `lyric` 出现 **0 次**；官方媒体文案
//       （ui_settings_enable_media_integration_support_hint）只承诺
//       "title, artist and album cover" —— **官方媒体 API 没有歌词这一类**。
//   → **语料未发现自带歌词的包**。本模块按"通用探测 + 没有就跳过"实现，并留
//     `?lyrics=<包内路径>` 手工覆盖入口（有了它就一定能用）。
//
// 本模块纯逻辑、无 DOM、无网络，可在 Node 里单测。
// ═══════════════════════════════════════════════════════════════════════════════

const str = (v) => (v == null ? '' : String(v));

/** LRC 时间标签：[mm:ss.xx] / [mm:ss:xx] / [mm:ss] / [m:ss.xx]（大小写不敏感） */
const TIME_TAG = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
/** 元数据标签：[ti:…] [ar:…] [al:…] [by:…] [offset:+500] */
const META_TAG = /^\[(ti|ar|al|by|offset|re|ve|length)\s*:\s*(.*?)\]\s*$/i;

/**
 * LRC 文本 → `[{t, text}]`（t = 秒，升序）。
 * 支持：一行多个时间标签（`[00:01.00][00:05.00]同一句`）、`mm:ss:xx`（毫秒用冒号）、
 * `[offset:±ms]`（整体平移，官方 LRC 约定）、UTF-8 BOM、CRLF、空文本行（保留为
 * `text:''` —— 间奏就是空行，查询时返回空串，不往下"借"上一句）。
 * 解析不出任何时间标签 → 返回 `[]`（调用方据此判定"这个文件不是 LRC"）。
 */
export function parseLRC(text) {
  const raw = str(text).replace(/^\uFEFF/, '');
  const out = [];
  let offsetMs = 0;
  for (const rawLine of raw.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const meta = META_TAG.exec(line);
    if (meta) {
      if (meta[1].toLowerCase() === 'offset') { const n = Number(meta[2]); if (Number.isFinite(n)) offsetMs = n; }
      continue;
    }
    TIME_TAG.lastIndex = 0;
    const stamps = [];
    let m;
    let lastEnd = 0;
    while ((m = TIME_TAG.exec(line))) {
      // 只接受**行首连续**的时间标签（`[..]` 之间不能夹正文，否则是歌词正文里的方括号）
      if (m.index !== lastEnd) break;
      lastEnd = m.index + m[0].length;
      const mm = Number(m[1]);
      const ss = Number(m[2]);
      let frac = 0;
      if (m[3] != null) {
        const d = m[3];
        frac = d.length === 1 ? Number(d) / 10 : (d.length === 2 ? Number(d) / 100 : Number(d) / 1000);
      }
      if (!Number.isFinite(mm) || !Number.isFinite(ss)) continue;
      stamps.push(mm * 60 + ss + frac);
    }
    if (!stamps.length) continue;
    const body = line.slice(lastEnd).trim();
    for (const t of stamps) out.push({ t, text: body });
  }
  // offset 是"标签出现位置之后生效"还是全局，各播放器不一致；按最通用的全局位移处理
  const off = offsetMs / 1000;
  for (const l of out) l.t += off;
  for (const l of out) if (l.t < 0) l.t = 0;
  out.sort((a, b) => a.t - b.t);
  return out;
}

/**
 * 当前行下标（**二分查找**）。返回 `-1` = 还没到第一行（或没有歌词）。
 * 同一时间戳多行时返回其中最后一条（与主流播放器一致）。
 */
export function lyricIndexAt(lines, t) {
  if (!Array.isArray(lines) || !lines.length) return -1;
  const x = Number(t);
  if (!Number.isFinite(x)) return -1;
  if (x < lines[0].t) return -1;
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= x) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** 当前行文本；无歌词 / 未到第一行 → `''`（绝不抛错、绝不返回 undefined） */
export function lyricLineAt(lines, t) {
  const i = lyricIndexAt(lines, t);
  return i >= 0 ? str(lines[i].text) : '';
}

// ── 包内探测 ──────────────────────────────────────────────────────────────────

const norm = (p) => str(p).replace(/\\/g, '/').replace(/^\.?\//, '');
const lower = (p) => norm(p).toLowerCase();
const dirOf = (p) => { const n = norm(p); const i = n.lastIndexOf('/'); return i < 0 ? '' : n.slice(0, i); };
const baseOf = (p) => { const n = norm(p); const i = n.lastIndexOf('/'); return i < 0 ? n : n.slice(i + 1); };
const stemOf = (p) => baseOf(p).replace(/\.[^.]+$/, '');
const isLrc = (p) => /\.lrc$/i.test(norm(p));

/**
 * `?lyrics=<包内路径>` 手工覆盖入口（唯一 URL 开关；已登记 README-DIAGNOSTICS.md）。
 * 返回：`null` = 无覆盖（走自动探测）；`''` = **显式关闭**（`?lyrics=`/`?lyrics=0`/
 *       `?lyrics=off`/`?lyrics=none`）；其它 = 包内路径（已 decodeURIComponent）。
 * 只吃 query 字符串，不碰 location → 可在 Node 里直接测。
 */
export function lyricsOverrideFromSearch(search) {
  const m = /[?&]lyrics=([^&#]*)/.exec(str(search));
  if (!m) return null;
  let v = m[1];
  try { v = decodeURIComponent(v.replace(/\+/g, '%20')); } catch { /* 保持原样 */ }
  v = str(v).trim();
  if (!v) return '';
  if (/^(0|off|none|no|false)$/i.test(v)) return '';
  return v;
}

/**
 * 在包条目表里挑出自带歌词条目。优先级（**先精确后宽松**，全部大小写不敏感、`\`/`/` 等价）：
 *   0. `override`（非空且命中条目表 → 直接用；即使不在条目表里也返回它，让调用方去报"取不到"）
 *   1. 音频同目录同主名：`sounds/<song>.lrc`
 *   2. 音频目录下的 lyrics 子目录：`sounds/lyrics/<song>.lrc`
 *   3. 包根 lyrics 目录：`lyrics/<song>.lrc`
 *   4. 任意位置的 `<song>.lrc`（同主名，按路径排序取第一个）
 *   5. 以曲名/歌手命名：`<mediaName>.lrc`、`lyrics/<mediaName>.lrc`、任意 `<mediaName>.lrc`
 *   6. 包内**唯一**一个 `.lrc` → 用它
 *   7. 多个 `.lrc` → 取 `lyrics/` 目录下按路径排序第一个；再不行取整包里最浅（层级最少）的第一个
 * 找不到 → `null`（**跳过歌词，不报错**）。
 */
export function findLyricsEntry(entryPaths, opts = {}) {
  const list = (Array.isArray(entryPaths) ? entryPaths : []).map(norm).filter(isLrc);
  const override = opts.override;
  if (override != null && String(override).trim()) {
    const want = lower(override);
    const hit = list.find((p) => lower(p) === want) || (Array.isArray(entryPaths) ? entryPaths.map(norm).find((p) => lower(p) === want) : null);
    return hit || norm(override);
  }
  if (!list.length) return null;
  const audio = norm(opts.mediaPath || '');
  const song = audio ? stemOf(audio) : '';
  const sLower = song.toLowerCase();
  const byPath = [...list].sort();
  const pick = (pred) => byPath.find(pred);

  if (sLower) {
    const dir = dirOf(audio).toLowerCase();
    const exact = `${dir ? dir + '/' : ''}${sLower}.lrc`;
    let hit = pick((p) => lower(p) === exact);
    if (hit) return hit;
    hit = pick((p) => lower(p) === `${dir ? dir + '/' : ''}lyrics/${sLower}.lrc`);
    if (hit) return hit;
    hit = pick((p) => lower(p) === `lyrics/${sLower}.lrc`);
    if (hit) return hit;
    hit = pick((p) => lower(baseOf(p)) === `${sLower}.lrc`);
    if (hit) return hit;
  }
  const name = str(opts.mediaName || '').trim().toLowerCase();
  if (name) {
    let hit = pick((p) => lower(p) === `${name}.lrc` || lower(p) === `lyrics/${name}.lrc`);
    if (hit) return hit;
    hit = pick((p) => lower(baseOf(p)) === `${name}.lrc`);
    if (hit) return hit;
  }
  if (byPath.length === 1) return byPath[0];
  const inLyrics = byPath.filter((p) => /(^|\/)lyrics\//i.test(p));
  if (inLyrics.length) return inLyrics[0];
  return byPath.reduce((best, p) => (norm(p).split('/').length < norm(best).split('/').length ? p : best), byPath[0]);
}

/**
 * 一步到位：挑路径 → 读字节 → 解析。**没有自带歌词就返回 null**（不联网、不报错）。
 *   opts.override    `?lyrics=` 的值（见 lyricsOverrideFromSearch）
 *   opts.entryPaths  包条目名数组（demo 的 pkg.entries.map(e => e.path)）
 *   opts.mediaPath   当前音轨的包内路径（scene.json 的 sound 层值，如 `sounds/xxx.mp3`）
 *   opts.mediaName   曲名（可选用 mediaProperties 的 title 兜底命名匹配）
 *   opts.readText    (path) => string | Uint8Array | null   ← 宿主提供的"按条目名读字节"
 * 返回 `{ path, lines }`（lines 非空）或 `null`。
 */
export function resolveLyrics(opts = {}) {
  const override = opts.override;
  if (override === '') return null;                       // 显式关闭
  const entryPaths = Array.isArray(opts.entryPaths) ? opts.entryPaths : [];
  const path = findLyricsEntry(entryPaths, { override, mediaPath: opts.mediaPath, mediaName: opts.mediaName });
  if (!path) return null;
  if (typeof opts.readText !== 'function') return { path, lines: null };
  let bytes = null;
  try { bytes = opts.readText(path); } catch { return { path, lines: null, error: 'read-failed' }; }
  if (bytes == null) return { path, lines: null, error: 'not-found' };
  const text = typeof bytes === 'string' ? bytes : utf8(bytes);
  const lines = parseLRC(text);
  return { path, lines, error: lines.length ? null : 'parse-failed' };
}

/** 字节 → UTF-8 文本（去 BOM）；Uint8Array / Buffer / number[] 都收 */
export function utf8(bytes) {
  try {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder('utf-8').decode(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes));
  } catch { /* 回退 */ }
  try { return Buffer.from(bytes).toString('utf8'); } catch { return ''; }
}
