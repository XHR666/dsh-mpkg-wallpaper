# dsh-mpkg-wallpaper — Wallpaper Engine mpkg Background Plugin

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

[中文](README.md) | [English](README.en.md)

A plugin for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI (dsh web) that adds background wallpapers: **Wallpaper Engine `.mpkg` parsing, Steam Workshop raw folders, video/web/image wallpapers, time-of-day switching, a full-screen frosted blur suite, theme-color & glass appearance, a local wallpaper library, timed rotation and one-click updates**. Nearly every visual detail is adjustable.

> **One-liner**: video/image/web wallpapers play directly; **time-variation wallpapers support multi-slot auto-switching + manual slot lock**; **some web wallpapers with built-in options (e.g. Live2D portraits — resolution/language/volume) are wired into the plugin settings page and can be edited in the collapsible "Adjustable options" area**; **video/web wallpapers support one-click pause/play (no replay when unrelated settings change) + 3-tier power saving (hidden/blurred/battery)**; Scene wallpapers get static-frame extraction + layer compositing as partial solutions.

## Core Features

**📦 Wallpaper sources (all supported)**
- **Wallpaper Engine `.mpkg`**: parsed directly in the browser (nothing uploaded to third parties); video wallpapers play their embedded mp4 / video textures; scene wallpapers extract content from the container; **time-of-day switching** picks the slot matching the current system time
- **Steam Workshop raw folders**: auto-discovers the WE install (registry + libraryfolders.vdf, non-default drives too) and lists `video / web / scene` types; you can also point the custom folder directly at the **workshop root** (`steamapps/workshop/content/431960`) — every subfolder is auto-detected as a wallpaper
- **Video wallpapers**: `.mp4` plays directly (custom folder / Steam library / local file)
- **Web wallpapers**: HTML wallpapers load in a sandboxed iframe (experimental, with **risk preflight**: auto-tagged "⚠heavy animation" / "🌐external", see [Web wallpapers](#web-wallpapers-experimental))
- **Images / GIF / URLs**: local images (png/jpg/webp/gif) or image URLs (incl. data:image) as backgrounds

**⏰ Time-variation wallpapers**
- Supports WE **time-variation** wallpapers (projects with `morningtime / daytime / dusktime / nighttime / timevarying` properties and multiple timestamped video textures):
  - **Auto-switch**: checks every 60s and swaps to the slot matching the current system time
  - **Manual lock / slot override**: the settings page offers "Auto + morning / day / dusk / night" buttons — click a slot to pin that asset, click "Auto" to resume time-based switching
  - **Lazy loading**: only the current slot's video texture is extracted (tens of MB peak); other slots are read on demand at switch time — **avoids importing all slots at once and crashing mobile browsers (OOM)**
  - **No cross-wallpaper bleed**: switching between two time-variation wallpapers clears the previous wallpaper's slot cache, so clicking morning/day/dusk never shows the *other* wallpaper's footage
- Adapted via: video mpkg; scene.pkg parsed the "mpkg way" (scene.pkg is the same PKG container as mpkg — slots with embedded video textures auto-switch)

**🌊 Full-screen frosted blur suite**
- **Unified blur**: one slider controls the whole screen's wallpaper blur; sidebar fog thickness, chat-area follow and new-chat follow are independently adjustable
- **UI blur (each with own toggle + amount)**: dialogs (generic center windows + chat input), settings panel, download/confirm popups, popovers (menus/dropdowns/tooltips), mask (full-screen dim), sidebar frost (auto-lifted while a dialog is open)
- **Title-bar frost / sidebar wallpaper visibility**: independently controlled

**🎨 Theme color & glass appearance (Aqua experiment, off by default)**
- **Theme color (accent)**: color picker + 6 presets driving brand buttons/sliders/selected items/links/send button (`--dsw-alias-brand-*` tokens)
- **Unified fog** (full-screen mask with one fog color, strength slider), **panel wallpaper-matching color** (auto sample + strength slider + custom picker), **adaptive text + blue cleanup** (brand unified, custom picker), **dark-background text readability**, **todo-list frost**
- Appearance tab also has: floating cards, etc. (the clock is a runtime-compat item — old configs still show it, but there is no settings toggle)

**🧩 dsh-better-sidebar adaptation (shown when that plugin is detected)**
- When dsh-better-sidebar is installed, an **adaptation section** appears in the **"Other" tab** (not "Appearance") with a master toggle + sub-toggles:
  - **Floating double-layer fix** (bsFloat): 14px rounded shell with `overflow:hidden` (clips inner right angles / active-tab pill), transparent inner `pane/tabBar/terminalWrap`, **zero outer margin** (the panel's left/right are aligned by better-sidebar's own ResizeObserver — margins shift it 8px and leave a 3.6px sliver when collapsed), and the host resize strip is moved inside the panel (host default `top:-4px` gets half-clipped once the shell has rounded corners)
  - **Reveal level** (bsReveal + bsRevealAlpha slider): how much wallpaper shows through the better-sidebar surface (higher = more transparent)
  - **Follow theme / Aqua** (bsAlpha / bsAqua): better-sidebar panel follows the theme base / the unified-fog color
  - **Bottom panel avoidance** (bsBottomAvoid): the bottom panel stays aligned with the DSH center column (handled by better-sidebar's own ResizeObserver — no manual offset)
  - Font follow (bsFont) and other sub-toggles
- The host `/ping` endpoint auto-detects whether better-sidebar is installed; the section is hidden when it is not
- **Version-aware adaptation**: the host also reports the installed better-sidebar version (e.g. `0.19.1`) and the
  client writes `body[data-mpw-bs-version]`, so version-specific rules can be gated with
  `[data-mpw-bs-version^="…"]` (e.g. the 0.16+ floating-window reveal; 0.19 removed floating windows upstream, so
  that rule simply stops matching). Panel-level rules additionally carry the 0.19 stable attribute hooks
  `[data-dsh-bottom-panel]` / `[data-dsh-pane]`, so a CSS-module hash change cannot silently break them.
  **2026-09-17: two "looks adapted but never actually ran" root causes were fixed** (`/ping` always returned a
  `null` version; version probing only ran when the settings panel was opened). Criteria, real-machine evidence and
  reproduction commands: [`docs/BETTER-SIDEBAR-COMPAT.md`](docs/BETTER-SIDEBAR-COMPAT.md); the 0.19.1 DOM contract:
  [`docs/BETTER-SIDEBAR-DOM-CONTRACT-0.19.1.md`](docs/BETTER-SIDEBAR-DOM-CONTRACT-0.19.1.md).
  Regression: `node tools/better-sidebar-compat-test.mjs` (41 assertions, including a mutation case that must turn
  red when the old code shape comes back, plus an anchor canary against the installed version; wired into
  `tools/check.sh` step 10).

**⏯️ Playback control & power saving**
- **Pause / Play button**: when the current wallpaper is a video/web type, the settings page shows a **Pause/Play** button (click to freeze the image, click again to resume). The paused state is **synced in real-time** (the button follows the actual video state); **adjusting unrelated settings (mute/brightness/blur etc.) does NOT trigger a replay** — the root cause ("video.src" compared as an absolute URL to a relative one → every settings apply reloaded the media source) has been fixed.
- **Power saving (3-tier pause)**: the "Other" tab has three independent toggles:
  - **Pause when the page is hidden** (`visibilitychange`)
  - **Pause when the window loses focus** (`blur/focus`)
  - **Pause on battery power** (`getBattery`; silently skipped if the API is absent)
  - Any tier triggers a pause; only when all are released does it resume; power-saving pause and manual pause don't interfere (both respect the same gate)

**🧊 Liquid glass (⚠️ experimental, off by default, not recommended for regular use)**
> ⚠️ **Note**: liquid glass is currently **experimental** — the effect is not final and may have layout/performance side effects. **Not recommended for daily use**; it is off by default. If you try it, back up your settings first; if anything breaks, restore all defaults from the "Other" tab.
- Based on CSS `backdrop-filter`: semi-transparent + blur + edge highlight (**no longer the WebGL refraction version** — WebGL was removed in v3.6.0, see below). Four toggles:
  - **lgTest (test mode)**: keeps only wallpaper + floating + layout, and overrides no DSH token (otherwise a translucent base makes the chat box transparent without blur)
  - **lgComposer / lgSidebar / lgHeader**: add a liquid-glass overlay to the message-bubble area / sidebar / title bar respectively (the sidebar can only be semi-transparent + edge highlight because of the settings dialog's render hierarchy — it **cannot** use backdrop-filter, or it would squash the settings dialog into the sidebar — historical pitfall)
- **History**: early versions used real WebGL refraction (`lib/liquid-glass/` library + `liquid-glass-bundle.js` 107KB); v3.6.0 removed the WebGL runtime (unstable + large) in favor of pure CSS. `lib/liquid-glass/*.js` and `liquid-glass-bundle.js` still ship (`files: ["lib"]`) but are **no longer referenced by the client**; the host still serves the `/api/mpkg-wallpaper/lg` route (no callers). the host-side static route is a **live path** (`/api/mpkg-wallpaper/lg/<file>.js` really `readFileSync`s `lib/liquid-glass/<file>`), and the `tools/liquid-demo/` demo page now uses that same mount (P-122). `tools/liquid-demo/` stays in the repo only and is **not shipped** (`files` excludes `tools/`). So they are **not dead files**; removing them is a release-surface decision (review: `docs/LIQUID-GLASS-DEDUP.md`).

**🎬 Lens & picture**
- Lens zoom (10–2000%) & pan, brightness (50–150%), light sharpen, Deep diving background box

**🎛️ Wallpaper settings (tab)**
- Everything directly tied to the **current wallpaper** lives here: mute (web wallpapers), mirror flip (horizontal/vertical), video playback speed (0.5–2x), adjustable options (mpkg read-only / web wallpapers editable), **decode fps cap** (24/30/48/60, ffmpeg frame-sampling), **resolution cap** (720p/1080p/2K, ffmpeg downscale to cut load), ffmpeg status with download/uninstall

**🚀 Hybrid large-file mode (default on)**
- mpkg streams to the DSH host → disk storage → HTTP Range streaming, **>600MB files supported**, low memory usage

**🖼️ Local wallpaper library**
- **Steam auto-discovery** + **custom folder** (any directory + cross-platform folder picker; .mpkg files and workshop folders can be mixed freely; images/videos/`scene.pkg`/`.mov` accepted)
- **Native WE playlist import**: the Steam scan also parses Wallpaper Engine's `config.json` (`general.playlists`) into **rotation lists**, mapping items to this plugin's `steam|`/`custom|` keys
- **Switching & rotation**: prev/next one-click, timed auto-rotation (interval adjustable); rotation-list checkboxes keep scroll position (no jump-to-top), and unnamed lists get auto-numbered (`Unnamed list N`) so they never collide

**🛡️ Safety & coexistence**
- **Conflict detection**: auto-disables when another wallpaper/theme plugin is detected
- **Security boundaries**: .exe/application wallpapers are completely excluded (virus-injection defense); custom folders only read media files; host routes validate against path traversal; web-wallpaper iframes are sandboxed

**🔄 Updates**
- "Check update" compares **versions** (semver) — un-pushed local changes don't false-positive; **the plugin marketplace is the recommended path** (its semver check matches); "Apply update" pulls the latest code from GitHub, restart to take effect

**💾 Backup & restore / settings persistence**
- The "Other" tab provides **backup & restore**: export appearance settings (Appearance / Unified blur / UI blur / Aqua / Other) to a **shareable JSON file**, import to restore — not the current wallpaper or scanned dirs
- **Settings persist to a host file**: besides localStorage, settings are written to `~/.dsh-mpkg-wallpaper/settings.json` — **survives port changes / browser-data clears** (following elysia395 v0.4.0)

## ⚡ Performance & stability

- **mpkg head-only reads** (no whole-file load): container parsing reads only the first 2MB head (`openSync+readSync`), so even an 834MB mpkg cold-starts near-instantly — fixes the old "read whole file then slice" 9-second load
- **Restart self-healing**: custom-folder wallpapers are rebuilt by **filename token** after restart (media 404 retries exhausted → re-parse by mpkgKey); the wallpaper no longer comes back blank after restart
- **Re-entry guards**: both `applyFromStorage` and the Aqua theme watcher carry a re-entry flag + debounce, preventing "overrideTokens → theme/change → re-entry" infinite loops (the dark-mode + unified-fog scenario once froze the main thread)
- **Scene cache is byte-bounded**: layer cache has a 128MB byte budget + count cap double-guard; scene.pkg is only read in full on a cache miss (stat-first)
- **Listeners/timers register once**: storage listener, 60s slot check, inline-style watcher, etc. are de-duplicated — repeated apply/RTC reconnects never accumulate
- **Lazy loading prevents OOM**: time-variation wallpapers extract only the current slot; hybrid streams large files with minimal memory
- **The audio list no longer waits for the whole package (2026-09-15, user report #1)**: a `scene.pkg` keeps its **directory table at the start of the file**, so "which audio tracks does this package have" needs only that table plus a 16-byte magic sniff per candidate entry (track bytes never enter memory). Two new entry points: `/custom-scene-audio?folder=` and `/library-scene-audio?ltoken=`, returning `{count,tracks:[{path,size,mime,refs}],stats}` (measured on the 22.5MB hina package: **2.3ms / 107KB read**; 0.5ms on a cache hit), and `/raw` now supports **Range/206** (it always returned 200 + the whole body before, so a renderer could not even fetch just the index). Measured with `tools/audio-scan-bench.mjs` (11 real packages, median of 3): whole-package read 1.7–379ms ⇒ index read 1.3–6.9ms cold / 0.4–0.9ms warm, with the track list **item-for-item identical** to this repository's own spec `docs/AUDIO-TRACK-SPEC.md` (11/11 packages, including FLAC/OggS/ID3/ftyp and scene.json layer refs). The track-detection/collection section was clean-room rewritten against that spec on 2026-09-16 (provenance: `THIRD-PARTY.md`).
- **Scene video probing is now "index-first" (2026-09-15, user report #1 ⑥c)**: `ensureSceneVideo` used to sit on the **critical path of applying a wallpaper** — `readFileSync` of the whole package plus full mipmap decompression of every `.tex` (the client even sets a 4s timeout for this step). It now reads only the **directory table** plus a **prefix** of each candidate entry (`.tex`: walk the header + first mipmap record and read the first 12 payload bytes to test `ftyp`; when mip0 is LZ4 only the first sequence is decompressed; standalone video entries win and are the only ones read; it stops after confirming 2 embedded videos), falling back to a full read whenever anything is uncertain. **The selection result, the on-disk cache file name (same hash formula) and its content sha256 are item-for-item identical to before.** Measured across 11 real packages: **2894ms → 532ms cold / 7ms warm**; the 7 no-video packages **1772ms → 18ms**; the 69.5MB Kel'thuzad-class package 771ms → 4ms; all 213 corpus `.tex` prefix decisions are correct. Bench `tools/scene-video-bench.mjs`, gate `tools/scene-video-test.mjs` (26 assertions).
  ⚠ **Which path**: this changes the **DSH plugin host** path (`/custom-scene-video-check`). The `:8899` renderer's 🔊 audio panel does **not** go through the plugin — its perceived improvement comes from renderer-side scheduling (see `docs/AUDIO-SCAN-FAST.md` §0).
- **Weak-device throttling**: heavy compositing (full-screen backdrop-filter over streaming video) is globally throttled; for extreme WebView combos, Edge / desktop browsers still give the best experience

**🌐 Browser compatibility (tested reference)**
| Browser | Rating | Behavior & notes |
|---|---|---|
| Chrome / Chromium (desktop) | ⭐⭐⭐ Strong | Most complete: best `backdrop-filter` & `color-mix`, `iframe.muted` works, muted autoplay allowed |
| Edge (desktop) | ⭐⭐⭐ Strong | Video wallpapers use a **dedicated canvas render path** (avoids the Edge hover toolbar); pause/resume/replay all fixed (CSS first-frame + src equality). Some versions show only a static first frame (not blank/crash) |
| Firefox | ⭐⭐ Medium | Full feature support (backdrop-filter 103+, auto-transcode fallback for unsupported codecs); three deductions: backdrop-filter is slower than Chromium (low-end drops frames when many blurs are on), `iframe.muted` unsupported (**audio web wallpapers may be blocked from autoplay on first load — the error is iframe-isolated so the main UI is unaffected**), `color-mix` needs 113+ (older versions only lose appearance) |
| Android WebView / mobile | ⭐⭐ Medium-weak | autoplay policy depends on the host app's WebView config (muted is usually allowed but Firefox-based / some WebViews block, leaving the video on its first frame); `getBattery` may be missing (guarded); for extreme combos prefer static image/GIF or blur off |

> Note: the source degrades gracefully for each browser (rAF fallback without `requestVideoFrameCallback`, guards around `ResizeObserver`/`getBattery`, all `play()` calls have `.catch`, `backdrop-filter` detected with `CSS.supports` and falls back to opaque). **No browser-specific high-risk point that would cause a blank page / freeze / crash was found.** The only medium item still to be tested is Firefox's "audio web wallpaper autoplay blocked"; Chrome/Edge are recommended for the fullest experience.

## Supported Types & Status

| Type | Web behavior | Notes |
|---|---|---|
| **mpkg (video)** | ✅ Full | embedded mp4 / video textures play directly |
| **mpkg (scene)** | 🟡 Partial | static-frame / layer composite / preview animation (below); slots with video textures auto-switch |
| **Time-variation wallpaper** | ✅ Full | multi-slot auto-switch + manual lock, lazy loading to avoid OOM |
| **Video (mp4/webm)** | ✅ Full | plays directly |
| **Web (HTML)** | 🟡 Experimental | **sandboxed iframe + a WE API shim injected before author scripts** (property / audio / media / slideshow callbacks work); **web wallpapers with settings are wired into the plugin (below)**; **interactive-feature wallpapers not adapted yet** |
| **Scene raw folder (scene.pkg)** | 🟡 Partial | same as mpkg scene |
| **Application (.exe)** | ❌ Excluded | safety: never read/executed |

## Adjustable options & web-wallpaper settings wiring

- **mpkg wallpapers**: the project's own **adjustable options** are shown **read-only** in the collapsible "Adjustable options" area (the browser shows pre-rendered assets; apply changes in the WE app).
- **Web wallpapers (some wired in — Live2D portraits)**: some web wallpapers (Live2D portraits, usually with a `loadJson.json` `SettingModel`) have built-in options — now **wired into the plugin settings page**, editable in the **same collapsible "Adjustable options" area**:
  - **Resolution 2k / 4k / 8k** (reloads the wallpaper)
  - **Language** (per wallpaper: 中文 / 日本語 / English / Tiếng Việt / Русский …)
  - **BGM & voice volume** (live, no reload)
  - **Show touch-area boxes / show text box** toggles
  - Changes are written to the wallpaper iframe's same-origin localStorage (key = skeleton name), then the wallpaper reloads
- **Hide the wallpaper's own settings panel**: these web wallpapers show a "Settings" button + panel in the top-right of the wallpaper surface, which can't be interacted with — the plugin **auto-hides it** on iframe load, and you operate the options via the plugin page.
- **Wallpapers with interactive features are not adapted yet**: web wallpapers relying on external SDKs / special interaction logic (e.g. some miHoYo event pages, or wallpapers that need login or click interaction) haven't had their built-in options wired in yet — they display fine, but **the in-plugin adjustable options are unavailable for them**.

> These editable web-wallpaper controls only appear after the plugin detects the wallpaper's `loadJson.json`; plain image/video web wallpapers or those without settings show nothing extra.

## Scene Wallpaper Adaptation

**Bottom line: WE scene wallpapers cannot be fully reproduced on the web — this is an engine-level limit, not plugin laziness.** Scene wallpapers are rendered by a proprietary engine: Live2D-style **puppet rigs (binary .mdl)**, **shader effects** (water waves / particles) and **scripts** (music-player UIs, etc.). There is no official renderer for browsers, and the formats are undocumented (RePKG only reverse-engineered PKG/TEX; MDL rigs have no public spec; the open-source [we-layerd](https://github.com/Aromatic05/we-layerd) bundles the official renderer but is **Linux Wayland only**).

The plugin offers these partial solutions (chosen automatically by scene content):

1. **Static-frame extraction**: parses `scene.pkg` (PKG container + LZ4 + TEX decode) and picks the main texture → **high-resolution static image** (photography/illustration scenes near-original quality; tested up to 7680×4320)
2. **Layer compositing**: parses all `image` layers in `scene.json` (background + subject + layered character parts) and draws them **accurately composited** on a canvas using the source coordinates/sizes; time-variation scenes pick the frame for the current hour
3. **Time-variation "mpkg way"**: `scene.pkg` is the same PKG container as mpkg — slots with embedded video textures can be parsed the mpkg way → multi-slot auto-switching (as above)

**Not covered**: MDL puppet characters (the body is assembled from rig parts; the flat textures are nearly empty), shader wave/particle effects, scripted interactions. These fall back to the **official preview animation** (preview.gif).

> For full dynamic scenes, the practical path: render externally to video → use the plugin's **video wallpaper** (Windows: official WE app screen-record; Linux: we-layerd; mobile: WE app screen-record).

## Web Wallpapers (Experimental)

- HTML wallpapers load full-screen in a **sandboxed iframe**; **webUrl is persisted** — auto-recovers after refresh / route changes / RTC reconnects without losing config (refresh the page manually if it ever freezes)
- **Two loading modes** (pick one in the confirm dialog; the mode is stored inside webUrl and survives reloads):
  - **Sandbox mode (default, recommended)**: the host injects a **WE API shim** as the first `<script>` in the entry HTML's `<head>`
    (`window.wallpaperPropertyListener`, `wallpaperRegisterAudioListener`, `wallpaperRegisterMedia*Listener`,
    `wallpaperRequestRandomFileForProperty`, …), so wallpapers that rely on the WE API actually run. The iframe's `sandbox`
    is **`allow-scripts` only** (opaque origin) ⇒ wallpaper scripts **cannot reach the DSH UI or local storage**.
    Trade-off: the parent cannot read the frame's DOM either, so mute / speed / pause are executed in-frame by the shim.
  - **Compatibility mode (same-origin)**: equivalent to the previous bare iframe
    (`allow-scripts allow-same-origin allow-pointer-lock`). Required by the "Web wallpaper options" of Live2D-style
    wallpapers (resolution / language / volume, written to the frame's same-origin `localStorage`).
- **Property / media wiring**: on mount the wallpaper's `project.json` `general.properties` defaults (overlaid with your
  saved `propEdits`) are pushed to the shim; media files in the wallpaper folder become the slideshow pool
  (`__mpw-list.json`). Mute / speed / pause are delivered in-frame via postMessage.
- **Type detection is content-first, not declaration-first**: `general.type` is only a hint —
  a package that claims `web` but ships `scene.pkg` is treated as a **scene**, and one that claims `scene`/`video`
  but only has `index.html` is treated as a **web** wallpaper (four states: web / scene / video / unknown;
  `application/exe` is always excluded).
- **Risk preflight**: auto-classified during scan; badges shown in the list and confirm dialog:
  - **⚠heavy animation**: Spine/L2D skeletal wallpapers — may freeze on low-end devices (use compatibility mode for these)
  - **🌐external**: depends on external SDK/CDN (e.g. miHoYo event pages) — may fail to load
- **Author script errors never break the plugin**: the in-frame shim catches listener exceptions, global `error` events and
  unhandled promise rejections, and rate-limits reports to the parent (`console.warn` + `/diag`).
- Tested: webm-video-based web wallpapers (light) work; Spine skeletal ones depend on device performance; **Live2D portraits with a `loadJson.json` are wired into the plugin options** (above)

> Details (detection table, per-attribute sandbox rationale, shim API / control protocol, file-URL rewriting,
> error boundary, known limitations, diff against the reference implementation):
> [`docs/WEB-WALLPAPER.md`](docs/WEB-WALLPAPER.md) (Chinese).
> Regression: `node tools/web-wallpaper-test.mjs` (wired into step 5 of `bash tools/check.sh`, all assertions green).

## Settings Tabs (8 total)

- **Source**: master switch, hybrid, mpkg file, image/video files, custom folder (can point at the workshop root), local library (Steam scan), switching/rotation, **time-variation slot lock**
- **Wallpaper**: mute, mirror flip (horizontal/vertical), video playback speed, adjustable options (mpkg read-only / web wallpapers editable), decode fps cap, resolution cap, ffmpeg status
- **Appearance**: theme color, floating, frosted blur, lens zoom/position, brightness, **wallpaper reveal** (sidebar/title-bar visibility, title-bar frost amount, sharpen)
- **Unified blur**: full-screen blur + sidebar/title-bar fog, chat follow, new-chat follow
- **UI blur**: dialog/settings/popup/popover/mask/sidebar frost each independent
- **Aqua**: unified fog / panel tint / adaptive text experiment toggles
- **Liquid glass**: lgTest / lgComposer / lgSidebar / lgHeader (CSS version, **experimental, not recommended**; with a separate demo page, see the "Liquid glass" section above)
- **Other**: power-saving 3-tier (hidden/blur/battery), new style/sharpen/round-compat, update check/apply, **backup & restore**, restore all defaults, submit feedback; the better-sidebar **adaptation section** appears here when that plugin is installed (clock is a runtime-compat item, no settings toggle)

## P-66 panel robustness fixes (2026-09-15)

> Context: the 9 UI issues reported in that round were confirmed to belong to the **webwallgl test bench (:8901)**,
> not to the DSH plugin panel. Under that scope this round keeps **only two genuine plugin bugs that are independent
> of that UI and independently reproducible**; every other interface change was reverted (after the revert
> `lib/client.js` is byte-identical to the synced copy). Regression: `node tools/panel-fixes-test.mjs`
> (wired into step 2 of `tools/check.sh`).

| Real bug | Root cause | Fix | Repro / assertion |
| --- | --- | --- | --- |
| **The render error boundary itself is broken, swallowing the real cause** | The outer `catch (err)` of `MpkgSectionImpl` called `h(...)`, but `h` is a `const` declared **inside the outer `try` block** (block scope is not visible in `catch`) → the boundary throws `h is not defined`, so the user sees "壁纸引擎设置区渲染异常：h is not defined" and the **real error is lost** | That catch now uses `react.createElement` | `node tools/panel-fixes-test.mjs --client <pre-fix copy>` → red (shows `h is not defined`); against the current code → green (shows the real error `boom-body`) |
| **zh/en dictionaries had different key sets** | `en` was missing 18 keys (`glass.title/desc`, `glassWindow*`, `glass.accent*`, `glass.color*`, `glass.alpha`, `glass.reset`, `flipX/Y*`, `themeColor*`, `rightSidebarBlur.overridden`) → the English UI printed raw keys; the 10 `clock.*` keys existed only in `en` → the Chinese UI showed English; plus two hardcoded Chinese strings (`"当前状态: "`, `"（已重挂）"`) | Both dictionaries now carry **identical key sets** (additions only; the exact count is printed by `node tools/panel-fixes-test.mjs`); the two hardcoded strings go through `t()` (visible Chinese text unchanged) | Same test: identical key sets / all static `t("k")` keys present in both / zero Chinese in the English render / zero raw keys in the Chinese render |

## Two on-device bugs fixed at the root (2026-09-16): header frost / right-side timeline

| Bug | Root cause (evidence) | Fix | Rollback switch | Regression |
| --- | --- | --- | --- | --- |
| **Header frost "never shows up"** | The first statement of `syncHeaderFrost()` calls `normalizeSection(...)`, but that helper was declared **inside another function's body** ⇒ every call threw `ReferenceError`, which the function's own `catch {}` swallowed ⇒ the frost layer was never injected and the diagnostic `reason` stayed empty (on-device diag: `injected:false`, `reason:""`) | Hoisted the normalisation helpers to **module scope**; the catch now writes the exception into `hdrFrostState.reason` (no more silence); the injected frost element and the header's translucent background are now applied **as a pair**, with the background colour coming from our own `--mpw-hdr-frost-bg`; when `wanted=false` we **clean up** instead of leaving a `blur:none` stub layer (a stub suppresses the pseudo-element fallback and kills frost entirely) | `?hdrfrost=legacy` (old gating), `?hdrfrost=off` (fully off), `?hdrblur=pseudo\|element` (A/B) | `node tools/frost-rail-test.mjs` |
| **Right-side timeline (turn-navigation rail) turns transparent with a wallpaper** | The rail marks are `.eGxaPq_mark::before`; their colours come from `--dsw-alias-border-l4` (`#00000029` / `#fff3`, i.e. 16%/20% alpha) and `--dsw-alias-label-*`. The plugin ① overrode `--dsw-alias-label-*` with `var(--mpw-aqua-ink, inherit)` and self-referencing fallbacks — DSH defines those tokens on `body`, not on `html`, so on `body` they became **guaranteed-invalid** ⇒ the active/preview marks' `background` resolved to unset = transparent; ② a bare `html body { --dsw-specific-sidebar-fill: transparent }` rewrote a host token **globally** and made the chat surfaces transparent ⇒ a 16%-alpha mark painted over the wallpaper is invisible | Token overrides are now **scoped** to an explicit whitelist of containers; the aqua/text-colour overrides are gated by `data-mpw-*` and no longer use `inherit` or self-references; the marks get a theme-derived contrast colour from **our own namespace**, applied only to whitelisted `.eGxaPq_*` nodes (host tokens untouched, no `!important`) | `?railink=off` (disable the contrast compensation), `?sbfill=wide` (restore the old global sidebar-fill override) | `node tools/frost-rail-test.mjs` |

> Details and the diagnostic field table: [`docs/HEADER-FROST.md`](docs/HEADER-FROST.md), [`docs/TIMELINE-RAIL-TOKEN.md`](docs/TIMELINE-RAIL-TOKEN.md).

## Style-scope guard: why this class of bug cannot come back (2026-09-17, MASTER-TODO §5 item 2)

Both bugs above share one mechanism: **nothing owned selector scope**, so a style edit could hit host UI
without anyone noticing locally. Gate step 12 turns that into a machine-checkable, red-on-regression rule
(`node tools/style-scope-guard.mjs`):

* **It uses the real artifact**: `buildCss` is never re-implemented. `tools/_stub.mjs` loads `lib/client.js`
  in Node and calls the plugin's own `__mpwBuildCss(patch)` over **600+ setting combinations** (613 today:
  defaults / each boolean alone / all 512 combinations of the 9 core switches / the `bsCompat` family /
  numeric 0 and 100 / no wallpaper / lgTest), then parses every generated rule, including `@media` / `@supports` nesting.
* **Verdict**: every selector must hit our own markers (`.mpw*` / `[data-mpw*]` / `#mpw-*`) or a **registered**
  host/third-party scope. The `bsCompat` block that deliberately targets third-party DOM
  (`[data-dsh-better-sidebar] …`) is allowed **only because it is declared** in the allow-list with a reason and a
  `docs/*.md:line` pointer (pointers are verified at runtime; a rotted pointer fails the gate). Bare element
  selectors (`button{…}`), a bare `*`, `:root` overriding host tokens, host tokens set to transparent/inherit,
  unregistered `!important` token overrides, touching the host turn-navigation rail without our own gate,
  `[data-dsh-panel-host]`, or making the header border transparent ⇒ **red**.
* **It proves it can discriminate**: `node tools/style-scope-guard.mjs --selftest` copies `lib/client.js` into a
  temp dir and injects 15 mutations (plus a negative control that must still pass), asserting RED/REVIEW/PASS for each.
* Criteria, the allow-list ledger and "how to register a new entry":
  [`docs/STYLE-SCOPE-GUARD.md`](docs/STYLE-SCOPE-GUARD.md).

## Surface token namespace: top bar / sidebar / panels / timeline rail read one `--mpw-*` set (2026-09-18, MASTER-TODO §5 item 1 / P0-3)

The requirement reads: "the four surfaces must use **one token namespace** (`--mpw-*`) and
**never override host tokens** ⇒ structurally eliminate the class of bugs where we break a new host
feature." Gate step 12's second check makes that mechanical (`node tools/token-namespace-test.mjs`):

* **One source**: host tokens are consumed into `--mpw-surface-*` only inside `emitSurfaceTokens()`; the single
  `body{…}` block in the output is the definition point for every surface value, and the four surfaces'
  rules **only** write `var(--mpw-surface-*)`.
* **Why `body` and not `:root`**: DSH defines `--dsw-static-*` / `--dsw-alias-*` on **`body`** (not on `html`).
  A `var()` inside a custom property is resolved **on the element where it is declared**, so declaring the
  SSOT on `:root` makes it guaranteed-invalid and **inherit that invalidity to every descendant** (consumers
  all fall back to `unset` = transparent). That is the very mechanism behind the historical "timeline rail went
  transparent" bug; a dedicated assertion plus a mutation guard it.
* **Only one host-token override left**: `buildSidebarFillCss()` (`--dsw-specific-sidebar-fill`, scoped to the
  sidebar allow-list, only in the "sidebar translucent" feature's respective state). The registry
  (`HOST_OVERRIDE_REGISTRY`) demands token + selector + value shape + **activation condition** per entry:
  all 39 override declarations in the output must be registered, and **none may appear in combinations where
  the feature is off**.
* **Equivalence evidence**: using `git HEAD`'s `lib/client.js` as *before*, 606 setting combinations ×
  light/dark × default/gated states are compared on the four surfaces' **effective values** (tiny cascade
  model + recursive `var()` substitution) ⇒ 25,428 keys match exactly. This is a refactor, not a redesign.
* Inventory (which token belongs to which surface / which host token is consumed / the registry with reasons /
  known deviations / how to add a token): [`docs/TOKEN-NAMESPACE.md`](docs/TOKEN-NAMESPACE.md).

## Switch-wiring audit: no more "the toggle clicks but nothing happens" (2026-09-18)

**Real incident**: the CSS for "Accent colour" and "Dark-background text readability" (aquaTextEnhance) was
wrapped together inside `if (aquaOn(section))`, so **turning on only those two switches generated no rules at
all** — the toggle was clickable, had no effect, and logged nothing (both blocks' own comments claimed they did
not depend on Aqua, contradicting the implementation — very hard to spot by reading). Fixed, plus a general
check: `node tools/switch-wiring-test.mjs` (gate step 2):

* every boolean switch must **change the `buildCss` output** in at least one of three contexts
  (default / rich / all-others-on); runtime-only switches must be registered with a `reason`;
* non-boolean features (`accent` / `aquaTextEnhance` must change the output); `themeColor` is
  "always-emitted CSS + runtime attribute gate", so the check asserts the gate rules exist instead;
* switches **proven dead** go into `KNOWN_DEAD` and are listed on every run (two-way assertion: fixing one
  requires deleting its entry). That list drove the first fix: **`lgCss` (pure CSS/SVG liquid glass) never ran at
  all** — the block referenced `bdSupported` while the `const` was declared after it, i.e. a same-scope TDZ
  `ReferenceError` swallowed by the outer `catch { /* liquid glass failure must not affect other styles */ }`
  (the catch is kept; it now only fires on real failures). The criteria are two-way: `lgCss:true` must emit the
  glass block (`mix-blend-mode: screen` + `url(#mpw-lg-warp)`), `lgCss:false` must not, and the two must not be
  byte-identical; a mutation restoring the TDZ order must turn all three red. The second entry is fixed too: **`sessionFollow` (new-chat button follows panel opacity)** — the setting page had a
  toggle and copy but nothing read `section.sessionFollow`; implemented per the **user-visible copy** (on = follow
  that opacity, off = **back to the host's original colour**), default unchanged, asserted in
  `tools/switch-wiring-test.mjs` section A4 (three two-way assertions in both default and unified-blur contexts;
  the "remove the read" mutation must go red). The third, `glassWindow`, stays registered and unchanged (copy
  without implementation) — see [`docs/TOKEN-NAMESPACE.md`](docs/TOKEN-NAMESPACE.md) §3b. **`bsCompat` (the better-sidebar adaptation master switch) now defaults to on** (ruled 2026-09-18): the
  bottom-panel float adaptation is settled on real devices, so a default of off meant nobody ever saw it.
  Existing users are migrated **only if they never set it explicitly**; anyone who turned it off by hand is
  **never overridden** (the write path stamps a `bsCompatUserSet` marker; the migration itself does not).
  Asserted by `node tools/bs-compat-default-test.mjs` (gate step 10, 15 assertions + 3 mutations).
  Liquid glass also gained a **`?lgcss=off` kill switch** now that it actually runs (registered in the renderer repo's diagnostics table;
  `node tests/diag-flag-check.mjs` reports 149==149).
  **The header's share of the refraction lives on a pseudo-element**
  (`html body[data-mpw-hdr-frost-el] .wSkVaW_header::before`, `z-index:0`): putting it on `.wSkVaW_header` itself
  turns the header into a **backdrop root** ⇒ floating panels inside the header lose their backdrop sampling
  (frosting fails, text behind shows through sharply) — a real-device regression that `tools/css-matrix.mjs`
  assertion 3 caught with 40 problems. A pseudo-element is not an ancestor of those panels, so sampling still
  works; it is gated on the JS-injected frost layer existing (that layer already raises the header's direct
  children to `z-index:1`, so `z-index:0` lands between background and content), and it is only emitted when the
  header is frosted anyway (`(headerBlur || unifyTint) && headerBg`, matching css-matrix assertion 7).
  Neither assertion was relaxed.
* discrimination proof: reverting either gate back under `aquaOn` must turn the audit red.

## Video-wallpaper transcoding: a **misjudgement** + resource caps (2026-09-17, item 1)

> User report: "I'm not using transcoding, my wallpaper is a **video-class mpkg**, the
> **decode FPS cap is unlimited** and **resolution is the original** — I changed nothing.
> Is this a bug?" Measured: an `ffmpeg -threads 1 -filter_threads 1 … -i
> ~/.dsh-mpkg-wallpaper/transcodes/src_1789….bin` process **resident, RSS ≈ 690MB** —
> the plugin was transcoding the wallpaper the user was **currently playing**.

**Verdict: the transcode was a misjudgement (bug).** Evidence: that `src_*.bin` is
`h264 High L5.2 + aac / MP4` (read with `ffprobe` — any modern browser plays it directly),
while `settings.json` has `fpsCap=0 / resMax=0` (the user enabled nothing) ⇒ the trigger was
the client's automatic fallback on `video.error` (`code 3/4`) to `/transcode?fps=24`.
`code 3/4` only means "this frame failed to decode", **not** "the browser cannot decode this codec".

**Fix**: a new **playability gate** (`/probe`, metadata-only, never spawns ffmpeg; verdict =
codec/container allow-list plus deterministic gaps such as h264+opus-in-MP4 and HEVC Main10;
"cannot tell" leaves behaviour unchanged) — directly-playable sources are served as-is and only
genuinely unsupported ones get transcoded. Three real bugs fixed along the way: the old
`direct-spec` read-through **ignored the codec** (HEVC was served directly → black screen), the
byte-cap eviction **started from the newest entry** (deleting the artifact it had just produced →
permanent cache miss), and **cancellation kept retrying other encoders** (a new ffmpeg spawned
while the user was switching wallpapers). Caps now live in one place: 12 artifacts / **512MB**,
concurrency **1**, 30s queue, 15min per job, **transcodes default to 1920 wide** (measured 4K
656MB → 1080p 275MB), **1GB available-memory admission** (refuse rather than swap the machine to
death), plus a startup prune with a log line. The three states (direct / transcoding / cached)
are logged and exposed as `window.__mpwWallpaperState` — no more silent 690MB.

> Details, verdict table, memory measurements and "measured-and-rejected options":
> [`docs/TRANSCODE-RESOURCE.md`](docs/TRANSCODE-RESOURCE.md); fallback switch
> `?mpwtranscode=legacy` (old behaviour) / `aggressive` (probe even user-set caps);
> regression: `node tools/transcode-limit-test.mjs` (43 assertions, wired into `tools/check.sh`).
> Debug switches (URL parameters, effective after a refresh, nothing written to settings):
> `?hdrfrost=legacy|off`, `?hdrblur=pseudo|element`, `?railink=off`, `?sbfill=wide`.
> After updating, refresh once and hit the diagnostic/report button — the `headerFrost` section of `diag-*.json`
> shows exactly which link of the chain is broken (`hostHasHeader` / `injected` / `px` / `computed.headerBg` /
> `computed.frostElBackdrop` / `reason`).

## Folder / file picker: behaviour contract & shortcuts (2026-09-17, item 13)

> User report: "inside the choose-folder feature, when I scroll the mouse up and down the view sometimes
> jumps back to the very top, and sometimes it locks at the top — you have never fixed this bug."

**Root cause (evidence-based; full write-up in [`docs/DIR-PICKER-SCROLL.md`](docs/DIR-PICKER-SCROLL.md))**:
the old "restore the scroll position afterwards" code was **dead code** — `dirScrollRef.current` was only ever
assigned `{anchorIdx, anchorOff}` and **never `ratio`**, so `if (ratio === void 0 || ratio === null) return;`
always returned early and neither the anchor compensation nor the ratio restore ever ran. On top of that the
scroller had no `overscroll-behavior: contain` (wheel chaining scrolled the host settings panel), and nothing
restored the user's `scrollTop` after React recreated the list node (a fresh node starts at `scrollTop = 0`).
Together these produce the reported "jump to / lock at the top".

**Fix (no new third-party dependency)**: the selector now **owns its scroll position** — the container remembers
the user's `scrollTop` per path (the scroll handler only writes a ref, never state) and writes it back
**synchronously before paint** in a `useLayoutEffect` (idempotent, so it can never fight the user's own
scrolling; all timing-window hacks removed). Scroll containers carry `overscroll-behavior: contain` +
`overflow-anchor: none`, row keys are `full path + directory name` (incremental updates instead of a full
rebuild), the dialog element has a stable key, and **there is no `focus()`/`autoFocus` anywhere**.

| Contract | Meaning |
|---|---|
| **Scroll position preserved** | Across refresh / filtering / shorter lists / 500-item directories / host re-renders / **the container node being recreated**, the position stays put (no single frame at the top) |
| **Never steals focus** | Opening the dialog focuses **the list container itself** with `focus({preventScroll:true})` (so it can never be scrolled into view); every row is `tabindex="-1"` with `mousedown` default prevented, so **no row ever becomes `document.activeElement`** (the active row only changes highlight + `aria-activedescendant`); re-renders never move focus |
| **Per-directory memory** | Directory A at 60 and directory B at 20 keep their own positions |
| **No wheel chaining** | Reaching the list boundary never scrolls the settings panel behind it |
| **Row-level incremental updates** | A refresh only adds/removes the diff (row key = full path; the test asserts row node uids stay the same) — never a full rebuild |
| **A missing anchor never means 0** | A remembered offset outside the new range is **clamped** (never reset to 0); a missing/invalid value (`null`/`""`/`NaN`) counts as "no anchor" and claims the current position |

**Shortcuts** (a visible hint is shown inside the dialog). Click the list (or `Tab` into it) first:

| Key | Action |
|---|---|
| `↑` / `↓` | Move the active row (no focus stealing; minimal `block:"nearest"` scroll only on key press) |
| `Home` / `End` | First / last directory |
| `Enter` | Open the active directory; **with no row selected it means "Choose this folder"** |
| `Backspace` / `Alt`+`↑` | Parent directory |
| `Esc` | Close the dialog |

**Regression gate**: `node tools/dir-picker-test.mjs` (**57 assertions**; group A is source-level and turns
**9/10 red** against the old `git show HEAD:lib/client.js`, proving the assertions have discriminating power;
group B runs a slice of the production implementation against a fake DOM + mini React).
The behaviour contract is aligned item-by-item with the test bench (8901/8902):
`docs/DIR-PICKER-SCROLL.md` §5 ↔ `vendor-ref/ww-pages/PATCH-NOTES.md` §10.5.

## Installation

Published on npm (`dsh-mpkg-wallpaper`). Pick one:

### Option 1: dsh plugin add (recommended, market-recognized)

```bash
dsh plugin --profile web add dsh-mpkg-wallpaper
# restart dsh web, then Ctrl+F5 in the browser
```

### Option 2: pnpm manual install

```bash
pnpm --dir $DSH_HOME/profiles/<profile> add dsh-mpkg-wallpaper
# restart dsh web, then Ctrl+F5
```

### Option 3: Git clone (developers / offline)

```bash
git clone https://github.com/XHR666/dsh-mpkg-wallpaper.git $DSH_HOME/profiles/<profile>/node_modules/dsh-mpkg-wallpaper
# then register in the profile's cordis.patch.yml:
#   - insert:
#       - id: dsh-mpkg-wallpaper
#         name: dsh-mpkg-wallpaper
# restart to take effect
```

> Note: Option 3 is not recorded in the dependency table — the market won't report it as installed (display only; functionality unaffected).

Uninstall: `dsh plugin --profile web remove dsh-mpkg-wallpaper`.

### Option 4: single-file bundle (offline / drop-in; **host half only**)

If you would rather not have DSH resolve a package (no npm/pnpm network), inline the host half into one
self-contained ESM file and register that file:

```bash
cd /path/to/dsh-mpkg-wallpaper
node tools/build-bundle.mjs          # output: dist/dsh-mpkg-wallpaper.bundle.mjs (~342KB, sha256 printed)
node tools/build-bundle.mjs --check  # parity vs. source: exports / 39 routes / ping JSON shape (20 assertions)
node tools/bundle-equivalence-test.mjs   # full equivalence gate: same route assertions on source and bundle (38)
```

Copy `dist/dsh-mpkg-wallpaper.bundle.mjs` anywhere (e.g. `~/.dsh/plugins/`), register it by **absolute path**
in the profile's `cordis.patch.yml`, then restart `dsh web`:

```yaml
# $DSH_HOME/profiles/<profile>/cordis.patch.yml
- insert:
    - id: dsh-mpkg-wallpaper
      name: /absolute/path/dsh-mpkg-wallpaper.bundle.mjs   # ← the .mjs file itself
```

**What this mode does and does not load** (code facts, not guesses):

| Item | Option 4 behaviour | Evidence |
| --- | --- | --- |
| Host half (upload/streaming + Range, scene extraction, audio listing, settings persistence, diagnostics — 39 routes) | **Complete** (`lib/index.js` + `pkg-extract.js` + `web-wallpaper.js` all inlined; external deps are node builtins only) | `node tools/build-bundle.mjs --check`: route table equal, 39/39 |
| `GET /api/mpkg-wallpaper/ping` | Same key set as source (`ok`, `version`, `betterSidebar`, `betterSidebarVersion`) | same `--check` run, section ③ |
| **Client half (settings panel / wallpaper layer / frost)** | **Not loaded.** The single file only exports the host surface (`apply`/`inject`/`__mpwTest`) | DSH discovers client halves **per package**: it scans host Loader entries for packages declaring `dsh.client` and resolves `exports["./client"]` (`@deepseek-ai/dsh-client-modules/lib/index.js:66-70,153-165,650-658`). A bare `.mjs` has no package.json ⇒ no `dsh.client` declaration |
| `GET /api/mpkg-wallpaper/lg/*` (legacy WebGL hosting route, no client caller) | **404** unless a `liquid-glass/` directory sits next to the bundle; `cp -r lib/liquid-glass <bundle dir>/` makes it byte-identical to source | that route locates `liquid-glass/` via `import.meta.url` (`lib/index.js:3304`); asserted in both layouts by `--check` |
| `ping.version` | `null` when the bundle's **parent** directory has no `package.json` (version display only) | same `new URL('../package.json', import.meta.url)` (`lib/index.js:1622`); equals source when a companion `package.json` is present |
| "Check for updates / one-click update" | `update-check` returns 500 without a companion `package.json`; `update-apply` writes files **next to/above the bundle** ⇒ **do not use one-click update in Option 4** | `lib/index.js:1801/1812/1847-1849` |
| Uninstall | delete the `.mjs` and its line in `cordis.patch.yml` | — |

> Bottom line: **Option 4 is a host-side-only, degraded install** (great for offline/emergency use or for reusing
> the routes from another host). Use Options 1–3 for the full UI. The artifact is **not committed**
> (`dist/` is gitignored: it is a pure derivative of `lib/*.js` and two builds are byte-identical, asserted in
> `tools/bundle-equivalence-test.mjs` §②; generate it at release time).

## Degraded behaviour without a Wallpaper Engine install (missing WE / non-Windows)

"WE installed" means the Steam build of Wallpaper Engine (appid **431960**). The host locates it with
`locateWallpaperEngine()` (`lib/index.js:303-327`): Windows registry `HKCU\Software\Valve\Steam\SteamPath` →
common Steam dirs (`C:\Program Files (x86)\Steam`, `D:\Steam`, …) → non-Windows Steam dirs
(macOS `~/Library/Application Support/Steam`, Linux/Android `~/.local/share/Steam`, WSL `/mnt/c/...`) →
any library listed in `steamapps/libraryfolders.vdf` containing 431960 → and it only accepts a library where
`<lib>/steamapps/common/wallpaper_engine/wallpaper32.exe` exists. **If nothing matches it returns `null`**, and
everything downstream follows the degraded paths below (this Linux box takes exactly that path):

| Situation | Actual behaviour (with code location) |
| --- | --- |
| WE not installed (or `wallpaper32.exe` not found) | `GET /api/mpkg-wallpaper/steam-inventory` returns **200 `{ok:true, installDir:null, wallpapers:[]}`** — not an error, no 500 (`lib/index.js:2967-2968`) |
| User clicks "scan local wallpaper library" | List stays empty plus an error line **"Wallpaper Engine install not found (requires Windows + Steam Wallpaper Engine)"** (`lib/client.js:8781` tests `!d.installDir`, string at `lib/client.js:11555`); an empty list also shows "No usable wallpapers found (or not a Windows environment)" (`lib/client.js:10419/11553`). **The scan itself does not fail** — it just returns nothing |
| WE installed but `projects/myprojects`, `projects/defaultprojects` and `steamapps/workshop/content/431960` are all absent | each root is checked separately (`scan()` starts with `if (!existsSync(root)) return`, `lib/index.js:2976-2977`) ⇒ empty list, and the "install not found" message is **not** shown (because `installDir` is non-null); the UI only shows "No usable wallpapers found (or not a Windows environment)" / an empty rotation group. **Not implemented**: there is no *dedicated* message for "WE installed but its asset dirs are missing" (the existing copy lumps it together with "not Windows"); to diagnose, inspect `installDir`/`wallpapers` from `steam-inventory` |
| Non-Windows / mobile | same as "WE not installed": `installDir=null` (the registry branch returns null when `process.platform !== 'win32'`, `lib/index.js:282-284`); all Steam probe paths are plain strings, so `existsSync` is simply false — no side effects |
| WE native playlists (`config.json` → `general.playlists`) | only when `installDir` exists and `config.json` parses; otherwise `playlists` is absent ⇒ after its first scan the client writes `rotSeeded:true` and **stops re-seeding** the rotation list (`lib/client.js:8782-8793`), so user-defined rotations are not overwritten on every scan |
| **Still works without WE** (the degradation is not "everything breaks") | (1) manual folder picking: `/list-dirs` + `/custom-dir` browse any drive/folder and use it as the wallpaper source; (2) importing `.mpkg` directly (hybrid mode streams from the host, no 600MB cap); (3) URL / local-file web and video wallpapers; (4) scene extraction, audio listing, settings persistence and diagnostics do not depend on WE at all |
| Host half entirely unavailable (Option 4 missing / port closed) | the client's `/ping` probe fails ⇒ falls back to **browser-only mode**: status line "Host unavailable (fell back to browser-only mode, 600MB cap)" (`lib/client.js:10203/11603`) and the library button reports "Host unavailable — cannot scan the local library" (`lib/client.js:8774/11554`); assets above 600MB cannot be handled in browser-only mode (see Limitations) |
| `ffmpeg` missing (video transcoding; unrelated to WE) | `GET /api/mpkg-wallpaper/ffmpeg-check` returns **200 `{ok:true, found:false, source:null, path:null, version:null}`** (`lib/index.js:3089-3090`); the client shows "not installed" and only starts the download chain when the user clicks; directly playable videos are never transcoded |

> In one line: **no WE install = you lose the "auto-discover the local library" convenience channel**; the plugin
> still works. Every degraded path returns an empty list with explicit copy and keeps the manual folder/upload
> channels — nothing fails silently and nothing returns 500.

## Limitations

- **Scene wallpapers cannot be fully dynamic on the web** (see [Scene wallpaper adaptation](#scene-wallpaper-adaptation)); mpkg adjustable options are read-only (apply changes in the WE app)
- **Web wallpapers are experimental**: heavy animation / external dependencies may freeze or fail (preflight tags + refresh recovery).
  In sandbox mode (default) wallpaper scripts **cannot reach the DSH UI or local storage**, but the Live2D-style
  "web wallpaper options" need compatibility mode; the audio-spectrum channel is wired but the plugin has no spectrum
  source yet; **wallpapers with interactive features are not adapted yet** (the wallpaper layer receives no pointer events)
- **Huge assets** (pure-browser mode): standalone video >600MB, video textures >250MB, images >200MB unsupported; **hybrid mode** has no such limit
- Scene static-frame / layer-composite **first extraction takes a few seconds** (longer for 8K textures); afterwards served from cache

<!-- ## Screenshots

<!-- screenshot reference removed -->

<!-- *The dynamic wallpaper fills the whole UI. Sidebar collapsed, chat box centered with frosted blur; the sidebar is fully transparent so the wallpaper shows through cleanly.* -->

<!-- screenshot reference removed -->

<!-- *After adjusting panel opacity and unified blur: most UI areas are opacity-adjustable, the sidebar is semi-transparent with the wallpaper faintly visible behind.* -->

<!-- screenshot reference removed -->

<!-- *The wallpaper settings page. Beyond the screenshot, nearly everything is adjustable: unified blur, UI blur (dialogs/panels/popups/popovers/mask/sidebar frost), lens zoom & pan, wallpaper flip, theme color, sidebar/title-bar visibility, sharpen, and scene layer compositing with time-frame switching.* -->

<!-- Wallpapers in the screenshots are by Bilibili UP【-夜莺Night】: [author page](https://b23.tv/86CyaFw) -->

-->
## Bug Reports

Please include:
- The **original .mpkg or workshop folder** (required to reproduce)
- Browser console output (F12 → Console), if any
- Your DSH version and platform (Windows / Linux / mobile)

## Security

- **No passive outbound network requests by default**: the plugin never **actively** contacts external networks; everyday wallpaper playback only talks to the **local DSH host** (127.0.0.1). The only exceptions are **user-initiated** actions: Check update / Apply update accesses GitHub (`raw.githubusercontent.com`, `api.github.com`); downloading ffmpeg accesses GitHub Releases / the npm binary mirror (`registry.npmmirror.com`) — "Apply update"/"download ffmpeg" fire only after the user clicks; **opening the settings panel silently checks the version once after 0.8s** (it only lights up the "update available" badge — no popup, no download, no local data uploaded). User-entered network image URLs and resources loaded by web wallpapers themselves are also external access.
- **No secrets**: no paths, keys, tokens or personal info in the source
- **Open-source deps only**: DSH's own react + official slots/locale APIs; the scene.pkg extractor is adopted from [elysia395/dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine) (MIT, credited in the file header)
- **Web wallpaper sandbox**: in the default mode the wallpaper iframe is an **opaque origin** (`sandbox="allow-scripts"`, no `allow-same-origin`), so author scripts **cannot read the host DOM / `localStorage` / cookies** and cannot strip their own sandbox. Frame and parent only talk via `postMessage` (op whitelist + parent-window source check). Cross-origin reads of wallpaper assets are allowed **only for `Origin: null`** (the sandboxed frame); ordinary websites get no CORS header. Author script errors are caught in-frame and rate-limited (`console.warn` + `/diag`) without affecting the plugin.
- References: [dsh-bg-image](https://github.com/lyh9712/dsh-bg-image) (MIT, template), [unmpkg](https://github.com/aqnya/unmpkg) (GPL-3.0, mpkg format reference), [repkg](https://github.com/notscuffed/repkg) (**MIT**, .tex format research — this line previously said GPL by mistake; corrected 2026-09-17 from the upstream `LICENSE` text plus the project owner's confirmation, see `../docs/COPYING-RULES.md` §6/§9.10)
- Data boundary: all parsing happens locally; localStorage only stores the background and settings; settings are additionally stored at `~/.dsh-mpkg-wallpaper/settings.json`

## File Structure

```
dsh-mpkg-wallpaper/
├── package.json      # dsh.bundle + dsh.client declarations
├── cordis.patch.yml  # plugin install declaration
├── LICENSE           # MIT license
├── lib/
│   ├── index.js      # host: upload/streaming + Steam discovery + custom folders + scene routes + settings persistence
│   ├── web-wallpaper.js # web wallpapers: content-first type detection + WE API shim source + entry-HTML injection + CORS policy (MIT, self-written)
│   ├── client.js     # browser: mpkg parsing + settings page + bg DOM + blur suite + library + time-variation/web options + playback control/power saving
│   ├── pkg-extract.js# scene.pkg static-frame/layer extraction (PKG+LZ4+TEX, MIT, from elysia395)
│   ├── liquid-glass/ # WebGL liquid-glass library (**leftover, no runtime ref**; CSS version since v3.6.0)
│   └── liquid-glass-bundle.js # liquid-glass bundle (107KB, **not referenced by the client**; byte-rebuildable from the kept sources, sha256 db50361c…)
├── tools/            # gates/tests/benches + lg build/inline scripts + liquid-demo page (for developers)
│                     # audio scan: audio-scan-bench.mjs (timing table) / audio-scan-test.mjs (spec assertions · no full inflate · cache)
│                     #             scene-audio-route-test.mjs (/raw Range + probe route + security)
│                     # web wallpapers: web-wallpaper-test.mjs (detection / sandbox / injection order / shim API diff / error boundary / no GPL)
│                     # single-file install: build-bundle.mjs (inlines lib/index.js + relative deps into one ESM; `--check` for source parity)
│                     #                      bundle-equivalence-test.mjs (gate step 11: same route assertions on source and bundle + mutation controls)
│                     # style scope: style-scope-guard.mjs (gate step 12: every injected CSS rule must hit .mpw*/[data-mpw*];
│                     #              host/third-party scopes must be registered in the allow-list with a reason + docs pointer)
│                     # note: the research-era Python tools (unmpkg/tex2png/mdl_explorer/xref) were
│                     #       **deleted (GPL lineage unresolved, 2026-09-16)** — see `../docs/COPYING-RULES.md` §6
├── dist/             # build output (**not committed**, gitignored): dsh-mpkg-wallpaper.bundle.mjs (Option 4, generated on demand)
├── docs/             # developer notes (not shipped): WEB-WALLPAPER.md (web-wallpaper spec / sandbox / API table / limits), RELEASE.md (release preconditions + commands) etc.
├── screenshots/      # (moved out of the repo)
├── README.md         # Chinese
├── README.en.md      # English
└── THIRD-PARTY.md    # third-party provenance / clean-room record (shipped, MIT-side attribution)
```
> Note: `lib/liquid-glass/` and `lib/liquid-glass-bundle.js` still ship in the npm package because of `files: ["lib"]`, but the **client no longer references them** (WebGL was removed in v3.6.0 in favor of the CSS version); the host still serves the `/api/mpkg-wallpaper/lg` route (no callers). Local backups such as `lib/client.js.bak-*` are excluded by the negative `files` patterns (`!lib/**/*.bak*`) and are **not shipped** — enforced by section ⑨ of `tools/integrity-check.mjs`.
> Why `dist/` is **not committed**: it is a pure derivative of `lib/*.js` (an inlined artifact) that duplicates tracked sources byte for byte, and two builds are byte-identical (machine-asserted in `tools/bundle-equivalence-test.mjs` §②); committing it would only create drift ("edited lib, forgot to rebuild") . By contrast `lib/liquid-glass-bundle.js` **is** committed because it *used to be* a **runtime input** (base64 written into `lib/client.js` by `tools/inline-lg-bundle.mjs`) — ⚠ **measured 2026-09-18: that link is dead**: neither `LG_BUNDLE_B64` nor `LG_BUNDLE_SRC` exists in `lib/client.js` (the only `B64` hit is a comment), and both inline tools now fail with "missing placeholder". It is therefore currently **neither referenced by the client nor a runtime input**; it merely ships via `files: ["lib"]` and can be rebuilt **byte-identically** from the kept sources. `dist/` is also outside the `files` whitelist, so the npm package never carries it.

## Acknowledgements

> **Naming note (2026-09-18):** the renderer product this plugin integrates with is now called **WEwebLoader**; the upstream project is still **WebWallGL** (`oneincase/webwallgl`, MIT) — its attribution and licence are unchanged.

- [Bil812](https://github.com/Bil812) — proposed wallpaper tint, adaptive text and unified full-screen mask in [PR #2](https://github.com/XHR666/dsh-mpkg-wallpaper/pull/2) and maintains a fork; those ideas were absorbed as the "Aqua" experiment mode (toggles, off by default)
- [elysia395/dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine) — the scene.pkg static-frame extractor (MIT); `lib/pkg-extract.js` is adopted from this project; its "settings persist to host file" and "Edge canvas-compat rendering" ideas are also borrowed
- [oneincase/webwallgl](https://github.com/oneincase/webwallgl) — sandboxed-iframe + WE API shim approach for web wallpapers (MIT): the **API list and semantics** of `lib/web-wallpaper.js` were studied against that project (**no code copied**; diff list in `docs/WEB-WALLPAPER.md` §10, ledger in `../docs/COPYING-RULES.md` §4)
- [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) community — listing & promotion

## Rendering Feasibility Research

- Full scenes (incl. Live2D puppets) can only be rendered by the proprietary engine: the WE app's native library (embedded Chromium + proprietary puppet renderer); the open-source [we-layerd](https://github.com/Aromatic05/we-layerd) (Rust) bundles the official renderer but is **Linux Wayland only**
- There is no mature WE scene renderer for browsers (pixeltris/wallpaper-engine-web is gone) — **independent of OS, no browser can render Live2D scenes directly**; the official renderer .so is closed-source, so it cannot be compiled to WASM
- This plugin's path: **static-frame extraction + layer compositing + (time-variation) mpkg-way slot switching** (see [Scene wallpaper adaptation](#scene-wallpaper-adaptation)); for full dynamics use "render externally to video → video wallpaper"

> Screenshots were moved out of the repository (they contain personal UI content): `../Delete/plugin-screenshots/`. Re-add sanitized copies under `docs/media/` if you want them shown.
