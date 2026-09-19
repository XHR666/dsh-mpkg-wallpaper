# dsh-mpkg-wallpaper — Wallpaper Engine mpkg Background Plugin

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

[中文](README.md) | [English](README.en.md)

Adds background wallpapers to the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI (`dsh web`): **Wallpaper Engine `.mpkg` parsing, Steam Workshop folders, video/web/image wallpapers, time-of-day switching for Time Variation wallpapers, a full-screen blur system, theme colours and glass surfaces, a local wallpaper library, scheduled rotation, a Now playing widget and one-click update**. Almost every appearance detail is adjustable.

> Version scope: this document describes the implementation shipped as **`3.8.0`** in `package.json`. The publish surface is **14 files** (`lib/` runtime files + `icon.svg`, `cordis.patch.yml`, `README.md`, `README.en.md`, `THIRD-PARTY.md`, `LICENSE`); `lib/liquid-glass/**`, `lib/liquid-glass-bundle.js`, `dist/`, `tools/` and `docs/` never enter the npm package (`package.json:8-21`).

---

## What changed in this version

Current version = **3.8.0** in `package.json`. Release prerequisites, commands and rollback live in [`docs/RELEASE.md`](docs/RELEASE.md); this round's change list is in [`docs/RELEASE-READY-3.8.0.md`](docs/RELEASE-READY-3.8.0.md); the root causes and on-device readings for Now playing / wallpaper sound are in [`docs/NOW-PLAYING-DSH.md`](docs/NOW-PLAYING-DSH.md) §7.7.

- **Now playing is on by default and yields its slot**: the `npNowPlaying` setting is **on by default** (`DEFAULT_NP_NOW_PLAYING` in `lib/client.js`), still in the *Wallpaper* tab directly under the existing `mute` toggle (`toggleRow(t("npNowPlaying"), …)` in `lib/client.js`). **Turning it off is still zero injection** — no DOM, no observers, not a single NP rule in the `buildCss` output (group B of `tools/now-playing-test.mjs`). Being on by default requires **yielding**: when another plugin has already injected an element into the same host slot we do not mount (or we retract) and leave a queryable state `data-mpw-np-yield` (`occupantOf()` in `lib/now-playing.js`; judged both before and after mounting, and it comes back once the occupant leaves). The component itself is a **line-by-line port of Bencho's "Now playing" (MIT)** with the upstream comments kept verbatim (attribution in `THIRD-PARTY.md` §6); pure math and component are split into `lib/now-playing-math.js` / `lib/now-playing.js` and **inlined byte-for-byte** into the `MPW-NP-GEN-START/END` region of `lib/client.js` by `tools/build-now-playing.mjs`, guarded by two independent drift gates. Mounting and collapse criteria: see [Now playing widget](#now-playing-widget).
- **Wallpaper sound is actually wired up**: the data source only accepts the media element that is **really playing right now** (the hidden shell `#mpw-bgVideo` exists in the DOM under **every** wallpaper type, and the old implementation treated the first selector match as "the current media") ⇒ a video wallpaper's play/pause/mute land on the real element (the **`mute` switch now really reaches the element — unmuting really produces sound**; the old code hard-coded `video.muted = true` and never assigned it from the setting again); audio files that **really exist** in the wallpaper folder play through our own `<audio>` (the scope accepts `mpkgKey="custom|<folder>"`; the old code only accepted `folderName`, so a web wallpaper in a custom folder always built a library route and got a 404) ⇒ **previous/next follow the track-list order and wrap around**, instead of "restart"; for a web wallpaper's in-frame sound only **mute** is a real channel (`canPlay=false` is reported honestly — we do not pretend we can pause in-frame WebAudio); while our player is playing, the frame is force-muted so the same track cannot play twice.
- **The card is no longer clipped in floating mode**: fit-scaling now measures **our own container** (the old code measured `[class*="sidebarCol"]`, and that class name appears more than once on a real machine — it measured 280 while our container was 256), `.mpw_np` is pinned to `math.W` with the overflow shared evenly, and the web-wallpaper branch now applies the `data-mpw-float` gate and calls `applyNowPlaying()` (the old branch returned early, so after switching to a web wallpaper the widget was not mounted at all).
- **Gate expansion**: `tools/now-playing-test.mjs` now reports **83 passed / 0 failed** (including 7 mutations); new `tools/np-media-test.mjs` (track-list scope / data-source decision / playback target / mute target / yielding / mark / the web path not skipping apply / card geometry — **82 passed / 0 failed**, including **12 mutation self-proofs**) is registered in step 2 of `tools/check.sh`; new on-device probe `tools/np-media-live-probe.mjs` (`:3080` + headless Firefox; 16 PASS / 22 FAIL before the fix → 45 PASS / 0 FAIL after, not part of the standing gate).
- **Several on-device fixes**: Now playing no longer mistakes the expanded state for collapsed on the frame right after slot rendering (so the widget no longer disappears after a refresh) — the criterion is now **physical width first** with threshold `NP_COLLAPSE_MAX_W = 96`, and when an anchor appears late it watches the document and mounts itself; the play/pause quads are now driven by a **tween of the playback state itself** (they used to be driven by expand progress, so the collapsed state always drew a triangle and the expanded state always drew the two bars); the header-frost `ReferenceError` and the transparent right-side timeline rail (see [Historical ledger](#historical-ledger)); the `lgCss` block that never executed because of a TDZ error; `sessionFollow` that had a toggle but no reader; the folder picker scrolling back to the top.
- **Capabilities from the previous round still on the same publish surface**: web-wallpaper rendering / API coverage (in-frame storage facade + host `/web-store`, master volume, source-level `file:///` rewriting, CSP injection skip, `/media-audio`) and web-wallpaper touch (`op:'touch'` with real `TouchEvent`s); the **host-side system media session adapter** `lib/media-session.js` (MPRIS / SMTC, **implemented but not wired up yet**, below).
- **Gates and guardrails**: CSS matrix, style-scope guard, surface-token namespace equivalence, switch-wiring audit and the second-scale pre-commit hook (see the [historical ledger](#historical-ledger) and [Gates](#gates)).

> Exactly one default changed, stated plainly: **`npNowPlaying` moved from off to on** (turning it off returns to zero injection; it yields automatically when another plugin already occupies the slot). Every other default is unchanged: `webInteraction` still defaults to `pointer`, and web-wallpaper sound is still muted by default (`mute` defaults to on).

## Core features

**📦 Wallpaper sources**
- **Wallpaper Engine `.mpkg`**: the container is parsed in the browser (nothing is uploaded to a third party); video wallpapers play their embedded mp4 / video textures, scene wallpapers have their assets extracted, and **Time Variation** wallpapers pick the material for the current time slot
- **Steam Workshop folders**: Wallpaper Engine installs are discovered automatically (registry + `libraryfolders.vdf`, non-default drives included) and listed as `video / web / scene`; the **workshop root** (`steamapps/workshop/content/431960`) can also be set as a custom folder — every subfolder is auto-detected as one wallpaper
- **Video**: `.mp4/.webm/.mov/.m4v` play directly; **Web**: HTML loads in a sandboxed iframe (with a risk pre-scan); **Image/animation/link**: local images or URLs (including `data:image`)
- **Custom folder**: any folder; `.mpkg` files, workshop subfolders, images, videos and `scene.pkg` can be mixed freely

**⏰ Time Variation wallpapers**
- Detects the WE time-variation properties (`morningtime / daytime / dusktime / nighttime / timevarying`, default hours 5/8/17/20, `lib/client.js:10419-10423`)
- **Lazy loading**: only the current slot is extracted (tens of MB per slot); other slots are read when you switch, so importing every slot at once cannot OOM
- **Manual slot lock**: slot buttons appear only for slots that actually exist inside the container (`lib/client.js:12797-12813`), stored in `timeOverride`; "Auto" returns to time-based switching
- **No cross-talk**: switching wallpapers clears the previous wallpaper's slot cache

**🌊 Full-screen blur (frost) system**
- **Unified blur**: one slider drives the wallpaper's blur plus the sidebar/title-bar frost thickness; whether the chat area and the new-chat button follow is controlled separately
- **UI blur (independent switch + amount each)**: dialogs (generic centre windows + chat input), settings panel, download/confirm popups, popovers (menus/dropdowns/tooltips), mask (full-screen backdrop), left sidebar frost
- **Show wallpaper**: left sidebar / title bar / right sidebar dock are independent, and the title-bar frost radius can be set separately

**🎨 Theme colours and glass surfaces (Aqua experiments default to off)**
- **Theme colour (`themeColor`)**: colour picker + presets, driving the sidebar/title bar/new-chat button/settings dialog base colour; **Accent (`accent`)** drives the brand interaction colour (buttons/sliders/selection/links/send button)
- **Panel colours match wallpaper (`aquaTint`)**: samples the wallpaper's dominant colour (video/GIF refresh every 2 s); plus **unified fog** (full-screen tinted mask), **adaptive text colour + blue cleanup**, **dark-background text readability**, **task list frost**
- **Liquid glass (CSS/SVG)**: `lgCss` + refraction amount on the composer / left sidebar / title bar; the WebGL runtime in `lib/liquid-glass/` is not part of the build (see [File structure](#file-structure))

**🧩 dsh-better-sidebar compatibility (shown once that plugin is detected)**
- When installed, the *Other* tab gains a **compatibility section**: master switch `bsCompat` (**default on**) plus `bsFloat` (floating two-layer fix: 14px rounded shell + transparent inner layer + zero margin + the resize strip moved inside the panel) / `bsFont` / `bsReveal` + `bsRevealAlpha` / `bsAqua`
- The host `/ping` returns `{ok, version, betterSidebar, betterSidebarVersion}`; the client writes `body[data-mpw-bs-version]` and version-specific rules are gated with `[data-mpw-bs-version^="…"]` (`lib/index.js:1626-1643`, `lib/client.js:255-269`)
- Details in [`docs/BETTER-SIDEBAR-COMPAT.md`](docs/BETTER-SIDEBAR-COMPAT.md) and [`docs/BETTER-SIDEBAR-DOM-CONTRACT-0.19.1.md`](docs/BETTER-SIDEBAR-DOM-CONTRACT-0.19.1.md); regression: `node tools/better-sidebar-compat-test.mjs`

**⏯️ Playback control and power saving**
- Video/web wallpapers can be **paused/played** from the *Wallpaper* tab; the button reflects the real playback state, and **changing unrelated settings does not restart playback** (the `video.src` equality test was fixed)
- **Three power-saving switches**: pause when the page is hidden/switched away, pause on window blur, pause on battery (`getBattery`; silently skipped when unavailable). Any one of them pauses, all must recover to resume, and they share one gating model with manual pause

**🚀 Large-file hybrid mode (hybrid, on by default)**
- The mpkg is **streamed** to the DSH host → stored on disk → played back over HTTP Range (`lib/index.js:1688-1728`, `:1730-1790`); **>600MB works** because the bytes never sit in memory. Turning it off falls back to browser-only mode (600MB ceiling)

**🖼️ Local library and rotation**
- Steam auto-discovery + custom folder (cross-platform folder picker); WE playlists (`general.playlists` in `config.json`) are imported as rotation lists
- Previous/next switching and scheduled rotation (`rotate` + `rotateMin`, 1–120 minutes); ticking items does not make the list jump to the top

**🛡️ Safety and coexistence**
- **Conflict detection**: other wallpaper/theme plugins disable this feature automatically (it can be forced back on, which writes `forceEnabled`)
- `.exe/application` wallpapers are excluded outright (`lib/web-wallpaper.js:101`, `:199`); custom folders only read media files; host routes validate against path traversal; web wallpapers are isolated in a sandboxed iframe

**💾 Backup, restore and settings persistence**
- **Backup & restore** in the *Other* tab exports appearance settings as shareable JSON (`BACKUP_FIELDS`, `lib/client.js:11979-11993`) and restores them on import
- Besides browser `localStorage` (key `dsh.mpkg-wallpaper.v2`, `lib/client.js:48`), settings are also stored on the host as `~/.dsh-mpkg-wallpaper/settings.json`, so they survive port changes and cleared browser data

## Supported types and boundaries

| Type | Status | What it can / cannot control |
|---|---|---|
| **mpkg (video)** | ✅ Full | Embedded mp4 / video textures play directly; mute, speed, pause, blur/zoom/brightness all adjustable |
| **mpkg (scene)** | 🟡 Compromise | Container assets are extracted: static frame / layer composite / embedded video slots; **Live2D puppets, shaders and scripts are out of reach** (below) |
| **Time Variation** | ✅ Multi-slot | Automatic switching + manual lock; only the current slot is extracted |
| **Video (mp4/webm/mov/m4v)** | ✅ Full | Plays directly; fps/resolution caps require ffmpeg transcoding |
| **Web (HTML)** | 🟡 Experimental | Sandboxed iframe + WE API shim; **Live2D-class wallpapers with read-only settings are editable**; external-SDK / heavily interactive ones are not adapted |
| **scene.pkg loose folder** | 🟡 Compromise | Same as mpkg scene wallpapers |
| **preview.gif / image / animation** | ✅ Full | Falls back to the author's preview animation when a scene has nothing better (`lib/client.js:887`, `:12272`) |
| **Application (exe)** | ❌ Excluded | Content detection yields `unknown/excluded-application`; never read, never executed (`lib/web-wallpaper.js:199`) |
| **Custom folder (mixed)** | ✅ Full | mpkg files and workshop subfolders mixed; bounded scan (depth ≤4, ≤4000 entries, `lib/web-wallpaper.js:213-232`) |

**Hard boundaries** (facts about the current implementation, not "later" items):

- **Full dynamic reconstruction of scene wallpapers is impossible** — the MDL puppet skeleton has no public format documentation and shaders/scripts have no Web runtime (see [Scene adaptation](#scene-wallpaper-adaptation))
- **The pure-Scene renderer selector is not wired up**: `sceneRender` (webgl/static/elysia) in the *Other* tab has buttons and writes a value, but nothing in the repository reads it. The real path is decided by renderer availability (online → `:8899` iframe, offline → static-frame fallback, `lib/client.js:3133-3138`)
- Web wallpapers **cannot** reproduce CSS `:hover/:active`, `isTrusted:true`, in-frame `contextmenu` or pointer lock/fullscreen/download popups (inherent limits of synthetic events, `docs/WEB-WALLPAPER.md` §11.4)
- Assets above 600MB work only in **hybrid mode**; browser-only mode additionally caps video textures at 250MB, images at 200MB and local image files at 100MB

## Settings (7 tabs)

The tab order is fixed: `TAB_ORDER = ["source","wallpaper","appearance","unify","blur","other","liquid"]` (`lib/client.js:10730`), labelled **Background source / Wallpaper / Appearance / Surface unify / UI blur / Other / Liquid Glass (test)**.

### 1. Background source (source)

| Label | Key | Default | Purpose | Off / rollback |
|---|---|---|---|---|
| Enable mpkg background | `enabled` | on | Master switch; off applies no background at all | off |
| Upload to dsh for streaming playback | `hybrid` | on | Large-file hybrid mode (host upload → disk → Range playback, no 600MB ceiling) | off = browser-only mode |
| mpkg / image / video file / image URL | — | — | File pickers and URL input (`http(s)` or `data:image`) | "Clear wallpaper" |
| Custom local wallpaper folder | `customDirPath` | empty | Any folder; can point at the workshop root, every subfolder becomes one wallpaper | clear the field |
| Local wallpaper library (Steam scan) | — | — | Scans the WE install and Workshop, importing wallpapers and `config.json` playlists | rescan replaces it |
| Rotation | `rotate` / `rotateMin` | off / 5 min | Switches to the next wallpaper on a timer (1–120 minutes) | off |
| Time slot | `timeOverride` | auto | Manually locks morning/day/dusk/night; buttons list only slots that really exist | "Auto" |
| Current wallpaper card | — | — | Preview, display name, container file name, type; pause/play, refresh, clear | — |

### 2. Wallpaper (wallpaper)

Contains the *Wallpaper picture* and *Power saving* sub-sections.

| Label | Key | Default | Purpose | Off / rollback |
|---|---|---|---|---|
| Mute (web wallpapers) | `mute` | on | Web-wallpaper audio; off lets the wallpaper make sound | off |
| **Now playing (above Settings in the sidebar)** | `npNowPlaying` | **on** | Mounts an expandable player in the left sidebar (its transport row is the wallpaper-sound control: previous / play-pause / next, plus mute inside the card); **off is still zero injection**; it yields and writes `data-mpw-np-yield` when another plugin has injected an element into the same slot | off / restore defaults |
| Horizontal flip (mirror) | `flipX` | off | Mirrors the wallpaper horizontally | off |
| Vertical flip (mirror) | `flipY` | off | Mirrors the wallpaper vertically | off |
| Decode fps cap | `fpsCap` | unlimited | Host ffmpeg frame extraction when the source exceeds the cap (24/30/48/60) | "unlimited" |
| Resolution cap | `resMax` | source resolution | ffmpeg downscaling (720p/1080p/2K, aspect kept) | "source resolution" |
| Playback speed | `playbackRate` | 1x | 0.5–2x (steps 0.5/0.75/1/1.25/1.5/2) | 1x |
| ffmpeg status | — | — | Shows system/cached/env source; download when missing, uninstall the cached copy only (never touches the system one) | — |
| Adjustable options (collapsed) | `propEdits` | empty | mpkg read-only display; web wallpapers are editable (resolution/language/volume, below) | per-wallpaper reset |
| Frosted blur | `blur` | 12px | Wallpaper-layer blur (0–40) | 0 |
| Lens zoom | `zoom` | 100% | 10–2000% | 100% |
| Brightness | `brightness` | 100% | 50–150% filter | 100% |
| Lens position (pan) | `lensX` / `lensY` | 0 / 0 | Horizontal/vertical pan, ±2000 each | 0 |
| Power save · pause when hidden | `powPauseHidden` | off | `visibilitychange` | off |
| Power save · pause on blur | `powPauseBlur` | off | `blur/focus` | off |
| Power save · pause on battery | `powPauseBattery` | off | `getBattery`; silently skipped when unavailable | off |

### 3. Appearance (appearance)

Contains the *Show wallpaper* sub-section.

| Label | Key | Default | Purpose | Off / rollback |
|---|---|---|---|---|
| Floating cards | `float` | off | Left sidebar/title bar become floating cards (radius + shadow + wallpaper showing through) | off |
| Theme colour | `themeColor` | empty | Base tint of sidebar/title bar/new-chat/settings dialog (picker + presets) | empty = disabled |
| Panel colors match wallpaper | `aquaTint` | off | Samples the wallpaper's dominant colour for panel bases (video/GIF refresh every 2 s) | off = use the picker |
| Accent | `accent` | empty | Brand interaction colour (buttons/sliders/selection/links/send) | empty = DSH default |
| Mask custom colour | `aquaColor` | empty | Custom colour for unified fog / panel tint | empty = grey |
| Custom grey text colour | `fontColorGray` | off | Grey text uses a custom colour (`fontColorGrayColor`) | off |
| Show wallpaper in left sidebar | `sidebar` | on | off = solid opaque sidebar | off |
| Left sidebar frost | `sidebarBlur` | off | `backdrop-filter` on the sidebar itself; removed automatically while popups are open | off (requires sidebar reveal) |
| Left sidebar frost amount | `sidebarBlurAmount` | 14px | 0–40; taken over while unified blur is on | — |
| Show wallpaper behind the title bar | `headerBg` | on | off = plain white title bar | off |
| Frost the title bar | `headerBlur` | on | Taken over while unified blur is on | off |
| Title bar frost amount | `headerBlurAmount` | 0% | Frost thickness 0–100% (default 0 = transparent) | 0 |
| Set title bar frost separately | `headerFrostOwn` | off | on = `headerFrostAmount` overrides the frost radius | off |
| Title bar frost strength | `headerFrostAmount` | 30px | 0–60 | 0 |
| Right sidebar / dock blur | `rightSidebarBlur` | on | The DSH right sidebar and bottom dock | off |
| Blur amount / surface opacity | `rightSidebarBlurAmount` / `rightSidebarAlpha` | 14px / 45% | 0–40 / 0–100% | — |

### 4. Surface unify (unify)

| Label | Key | Default | Purpose | Off / rollback |
|---|---|---|---|---|
| Unify blur | `unifyTint` | on | One slider drives the whole-screen blur; takes over sidebar/title-bar/right-sidebar frost | off |
| Full-screen blur degree | `unifyAmount` | 30px | 0–40 (drives the wallpaper-layer blur) | — |
| Left sidebar / title-bar opacity | `sidebarAlpha` | 35% | Frost thickness 0–100% | — |
| Chat follows full-screen blur | `chatFollow` | on | off = the chat area is driven by the *Frosted blur* slider | off |
| New-chat button follows panel opacity | `sessionFollow` | on | off = back to the host's original colour | off |
| Unified fog (full-screen mask) | `aquaMask` | off | All surfaces share one fog colour (moved here from the Aqua section) | off |
| Unified fog strength | `aquaMaskAlpha` | 82% | 0–100% | — |

### 5. UI blur (blur)

| Label | Key | Default | Amount key / default | Off |
|---|---|---|---|---|
| Blur dialogs | `dialogBlur` | on | `dialogAmount` 14px | off |
| Blur settings panel | `settingsBlur` | on | `settingsAmount` 14px | off |
| Blur download/confirm popups | `confirmBlur` | on | `confirmAmount` 12px | off |
| Blur popovers | `popoverBlur` | on | `popoverAmount` 10px; plus `popoverAlpha` 94% surface opacity | off |
| Blur mask (full-screen backdrop) | `maskBlur` | on | `maskAmount` 8px | off |

### 6. Other (other)

| Label | Key | Default | Purpose | Off / rollback |
|---|---|---|---|---|
| Light sharpening | `sharp` | on | Improves low-quality GIFs; turn it off if animations stutter | off |
| Deep diving background box | `thinkBg` | off | on = the thinking state gets a blurred background box | off |
| Task list frost | `todoBlur` | off | Blurs todo-card backgrounds | off |
| Third-party UI radius compat | `roundCompat` | off | Radius compatibility for third-party plugins | off |
| Adaptive text color + blue cleanup | `aquaInk` | off | Text colour follows mask luminance + brand colours are unified (`aquaInkColor`) | off |
| Dark-background text readability | `aquaTextEnhance` | off | Two-colour text outline (an approximation) | off |
| Pure-Scene renderer selection | `sceneRender` | — | ⚠ Has buttons and a write path, **but no reader** (not wired up) | — |
| Scene render reporting (troubleshooting) | `sceneReport` | on | The wallpaper writes renderer state into `reports/` every 10 s | off |
| Scene first-frame watchdog | `sceneWatchdog` | on | Falls back to the static frame when no frame arrives in time; `sceneWatchdogSecs` 8 s (3–30) | off |
| Retry renderer / renderer debug params / extension hook URL | `sceneDebugParams` / `sceneExtUrl` | empty | Allow-listed pass-through (`ln/eye/audit/isolate/parallax/…`); the extension hook is appended as `extbase` | clear / clear all |
| One-click diagnostics report | — | — | Collects subsystem state → `POST /diag`; downloads a JSON file when the host is unavailable | — |
| Diagnostics switch cheat sheet (renderer) | — | — | The 10 common renderer flags + "copy" for the URL fragment | — |
| better-sidebar compatibility | `bsCompat` / `bsFloat` / `bsFont` / `bsReveal` / `bsRevealAlpha` / `bsAqua` | on / off / off / off / 62% / off | See above; shown only when better-sidebar is detected | master off = none apply |
| Backup & restore | — | — | Exports/imports the `BACKUP_FIELDS` allow-list (current wallpaper and scan folders excluded) | — |
| Restore all defaults / feedback / check for updates | — | — | Resets appearance values; one-click update pulls the latest code from GitHub | — |

### 7. Liquid Glass (test) (liquid)

| Label | Key | Default | Purpose | Off / rollback |
|---|---|---|---|---|
| Test mode master switch | `lgTest` | off | Keeps only wallpaper + floating + layout, disabling every appearance feature | off |
| Liquid glass (CSS) | `lgCss` | off | Pure CSS/SVG refraction + specular edges (no WebGL context, can run alongside scene wallpapers) | off / URL `?lgcss=off` |
| Refraction | `lgCssAmount` | 14px | 0–40 (0 = plain blur) | — |
| Composer / left sidebar / title bar liquid glass | `lgComposer` / `lgSidebar` / `lgHeader` | off | Each selects its own target (JS applies a `[data-mpw-lg-css]` marker) | off |
| Standalone demo page (port 3081) | — | — | The WebGL2 demo under `tools/liquid-demo/` (a separate service; it does not affect the plugin) | — |

### Keys without a panel control

These keys **exist and participate in the logic** but have no widget on the settings page; they are reachable only through a backup import, by editing `localStorage` directly, or via URL parameters (`lib/client.js:101-232` holds every default; `tools/switch-wiring-test.mjs:41-64` is the "runtime only" allow-list with the reason for each entry).

| Key | Default | Notes |
|---|---|---|
| `clock` / `clock24h` / `clockSec` / `clockDate` / `clockPos` / `clockSize` | off / on / off / off / `tr` / 40 | The clock is a **runtime compatibility item**: old configurations still render it, but the settings page has no toggle |
| `bsAlpha` | off | better-sidebar panels follow the theme base colour; the CSS reads it, the panel has no widget |
| `bsBottomAvoid` | off | A settled **deliberate no-op** (alignment belongs to better-sidebar's own ResizeObserver) |
| `newStyle` | off | Only changes settings-page widget looks (JS picks class names); never enters `buildCss` |
| `forceEnabled` | off | Runtime priority flag for forcing the feature back on past conflict detection |
| `opacity` | 82 | The "panel opacity" slider was removed (unified blur uses `sidebarAlpha` instead); the value is still read (`lib/client.js:5887`, `:5981`) |
| `aquaTintStrength` | 45 | How much of the wallpaper's dominant colour is mixed into panel tints; read at runtime (`lib/client.js:5575`), no widget |
| `glassColor` / `glassAlpha` | empty / 12 | Leftovers from the early WebGL liquid glass: they only travel through backup export/import and "restore defaults", with **no widget and no reader** (`lib/client.js:11968`, `:11986`) |
| `webInteraction` | `pointer` | Web-wallpaper interaction mode (`off`/`pointer`/`full`): **no panel widget**; use `?mpwinteract=…` or write the stored settings |
| `sceneRendererUrl` | `http://127.0.0.1:8899/` | Scene-renderer address, overridable (`lib/client.js:3129-3132`) |
| `glassWindow` | — | **Retired and deleted** (2026-09-19): no widget and no reader; its promised feature is covered by `settingsBlur` + `dialogBlur`/`popoverBlur`; zero leftovers in code and in both dictionaries |

## Diagnostics and troubleshooting

### Plugin side (this plugin's own switches)

- **One-click diagnostics report** (*Other* tab): packs whether frost/sidebar/timeline were affected, the wallpaper type and path, whether the shim was injected, video decoding, surface tokens and scene health into one payload → `POST /api/mpkg-wallpaper/diag`, written to `~/.dsh/.dsh-mpkg-wallpaper/diag-<epochms>.json` (`lib/index.js:1605-1620`; directory capped at 50 files / 32MB, `lib/index.js:1523-1524`; client-side single-payload cap 512KB). **When the host is unavailable it automatically downloads `mpw-diag-<ISO>.json` instead**, so state can be reported offline. Every field carries `provenance`; unreadable ones are `value:null + degraded` ([`docs/DIAGNOSTICS.md`](docs/DIAGNOSTICS.md)).
- **Automatic background reporting**: the switch is **`localStorage['mpwdiag']='1'`** (not a URL parameter — DSH's auth 303 strips the query, `lib/client.js:4953-4957`); after a reload it reports once 6 seconds in (≤6 per session), and `window.onerror` uses the same collector.
- **Plugin-side URL escape hatches** (effective after a refresh, settings untouched):

| Parameter | Effect |
|---|---|
| `?hdrfrost=legacy\|off` | Title-bar frost: old gate / fully off |
| `?hdrblur=pseudo\|element` | Frost carrier: pseudo-element / element layer, for A/B |
| `?railink=off` | Disables the contrast compensation on the right-side timeline rail |
| `?sbfill=wide` | Restores the old global sidebar fill override |
| `?lgcss=off` | One-flag rollback of liquid glass |
| `?mpwtranscode=legacy\|aggressive` | Video transcoding: old behaviour / probe even past the user's caps |
| `?mpwinteract=1\|on` (auto-arm) / `off\|0\|pointer\|full` (mode only, no auto-arm) | Web-wallpaper interaction |
| `?mpwstore=0\|mem` | Disable the in-frame storage facade / keep it in memory without persisting |
| `?mpwpersist=legacy` | Settings persistence back to the old behaviour |
| `?bgwrapfix=legacy`, `?hdrfrostwatch=off` | Wallpaper-layer visibility / frost watchdog |

### Renderer-side diagnostics flags (pure Scene wallpapers)

Two different numbers — do not mix them up:

- The **main table holds 158 flags**, in the **renderer repository**, [`we-scene-demo/docs/README-DIAGNOSTICS.md`](../we-scene-demo/docs/README-DIAGNOSTICS.md) (generated by `diag-flag-check.mjs`, cross-checked against `web/diag-flags.json`).
- The plugin panel only ships the **common / escape-hatch table** (the 10 flags with `common:true`), appended to the renderer URL, e.g. `http://127.0.0.1:8899/?id=3719111841&audit=3`:

| Flag | Purpose | Default |
|---|---|---|
| `att=legacy` | Attachment anchoring through the old self-computed path (A/B) | new path |
| `mcc=1` | Force mesh bounding-box centre compensation | off |
| `piv=1` / `piv=0` | Sub-mesh pivot compensation all on / all off | eyes combo only |
| `align=0` | Reproduce the old alignment (origin always the geometric centre) | official alignment |
| `parallax=legacy` | Mouse parallax back to the old approximation | official formula |
| `audio=1` | Play the scene's sound layers (one stream each) | muted |
| `whitefallback=0` | Missing-texture layers become transparent | white block (official) |
| `hier=0` | Drop parent-chain composition, fall back to absolute positioning | parent-chain composition |
| `isolate=<layer>` | Keep only layers whose name matches (comma separated) visible | all visible |
| `audit=N` | Per-layer audit of the first N frames | 1 |

> These are **renderer** URL parameters, not plugin settings; the plugin only appends them to the scene iframe (`lib/client.js:13981-14000`, `lib/client.js:3163`). The panel copy and its offline mirror must match the `common` set of `diag-flags.json`, asserted by `tools/panel-smoke.mjs` (`tools/panel-smoke.mjs:316-372`).

## System media session (MPRIS / SMTC)

`lib/media-session.js` (1052 lines, MIT, written in this repository, no third-party code) is the **host half** of the "let Now playing show what the *system* is playing" chain. Contract: `createMediaSession({run, platform, env, now, timeoutMs, log})` → `{probe(), snapshot(), control(op,arg), stats(), lastProbe()}` (`lib/media-session.js:22-40`).

**Capability matrix**

| Platform | Channel | Adapters (by priority) | Metadata / state / position / artwork | Control |
|---|---|---|---|---|
| Linux / FreeBSD / OpenBSD | MPRIS over D-Bus (`org.mpris.MediaPlayer2.*`) | `playerctl` → `dbus-send` | One call returns 7 fields: `status / mpris:length / position / xesam:title / xesam:artist / xesam:album / mpris:artUrl` | `play` `pause` `playpause` `next` `prev` `seek` |
| Windows 10/11 | SMTC (`GlobalSystemMediaTransportControlsSessionManager`) | `smtc` (`powershell.exe -NoProfile -NonInteractive`) | Real WinRT calls for properties / timeline / playback controls / thumbnail (as a base64 data URL) | Same ops (op and position passed as separate argv elements) |
| macOS | — | — | ❌ Not implemented: `unsupported-platform`, **0 commands** | ❌ |
| Anything else / no adapter | — | `none` | ❌ `not-installed` | ❌ |

- **Shape**: the `snapshot` always has its 21 keys; unreadable values are empty/neutral (`duration`/`position` are milliseconds and `null` when unknown — it **never invents 0**); when `available:true`, `title` is non-empty (`lib/media-session.js:42-56`, `:220-244`).
- **With no desktop session bus it reports unavailable honestly**: `probe()` really probes (`dbus-send --session ListNames`, falling back to `busctl --user list`) and returns `available:false / reason:'no-session-bus'` with a `detail` line such as "总线不可达（via dbus-send）：…" (`lib/media-session.js:684-706`, `:775-783`). This is **derived, not hard-coded** — a machine with no desktop environment (container/Termux) really takes this path.
- **It never throws**: `snapshot()` / `control()` never reject; every failure is a return value whose `reason` is one of 15 values (`unsupported-platform / disabled-by-env / not-installed / no-session-bus / no-player / no-metadata / empty-output / unparsable / timeout / not-available / bad-op / bad-arg / bad-player / error`).
- **Security**: command names and arguments are passed **separately** (argv arrays, never through `sh -c`); player names must match `/^[A-Za-z0-9_.-]{1,64}$/` or the result is `bad-player` with 0 commands; `op` is allow-listed and `seek` is bounded to `0..24h`; the timeout defaults to 800 ms (50–5000 ms); reads are single-flight with a global serial queue (at most one command at a time).
- **Zero dependencies**: only `node:child_process`; `package.json` gained no dependency at all.
- **Environment variables**: `MPW_MEDIA_ADAPTER` (pin an adapter), `MPW_MEDIA_PLAYER` (pin a player name), `MPW_MEDIA_TIMEOUT_MS`.

⚠ **Wiring status (honest)**: the module is **not wired into the plugin yet** — `lib/index.js`, `lib/client.js` and `tools/build-bundle.mjs` do not import it, and there is no `/media-session` or `/media-control` host route, so **the Now playing widget still shows the wallpaper's own media, not a system player**. Host routes and UI display are planned in [`docs/MEDIA-SESSION.md`](docs/MEDIA-SESSION.md) §9/§10 but marked as not done. Gate: `node tools/media-session-test.mjs` (95 assertions = 89 main + 6 mutation self-proofs), **not part of `tools/check.sh`**.

## Now playing widget

> Location convention: this section refers to the implementation by **symbol name** (`resolveAnchor` / `shouldHide` / `occupantOf` / `PlayMark` / `markYield` in `lib/now-playing.js`, `opsX` and friends in `lib/now-playing-math.js`, `npResolveMedia` / `npActiveVideo` / `npAudioScope` / `npApplyMute` / `applyNowPlaying` in `lib/client.js`) — **line numbers drift between versions; symbols are authoritative**. The shape is "source + generated inline": `lib/now-playing-math.js` + `lib/now-playing.js` are inlined byte-for-byte into the `MPW-NP-GEN-START/END` region of `lib/client.js` by `tools/build-now-playing.mjs`.

- **Mount point**: the host slot `sidebar.footer.action` (the `createSlotAction` registration in `lib/client.js`: `id:"mpw-now-playing"`, `order:60`). When the slot is unavailable, `resolveAnchor()` falls back by mode: `slot` → `settings-slot` (before the host's settings cell) → `settings-area` (before `[class*="settingsArea"]`) → `foot` (first position in `[class*="footArea"]`); if none holds it **creates no node at all** and logs a `console.warn`. **A late anchor still gets mounted**: when no landing spot exists it watches the document and mounts itself as soon as the host's slot outlet renders (the old code only warned and returned, so after a wallpaper switch on a real machine the widget never came back).
- **Yielding (the counterpart of being on by default)**: `occupantOf(container, mode, selfNode)` walks the container's children and lets three kinds through — our own nodes, host-owned nodes (the slot outlet / settings cell) and effectively empty nodes; the first remaining element counts as an **occupant** ⇒ we do not mount (before mounting) or we retract (after mounting, via `MutationObserver` with `subtree:true`), write `data-mpw-np-yield="foreign-occupant"` and log one readable warning; when the occupant leaves we come back. The criteria are **two-way**: neither our own nodes nor the host's cells may be misread as occupants.
- **Hidden when the sidebar is collapsed**: `data-mpw-np-hidden` + CSS `display:none`. The criterion is **physical width first** (`shouldHide(width, hostCollapsed)`: a measured width ≥ `NP_COLLAPSE_MAX_W = 96` forbids hiding); host signals (slot `wide` / `data-sidebar-collapsed` / root class `collapsed`) are a fallback only when the width **cannot be measured**, and there is a **one-shot** re-check after the anchor moves. When space is tight the whole widget scales by `--mpw-np-fit = clamp(avail/260, 0.5, 1)`, where `avail` measures **our own container** (not `[class*="sidebarCol"]` — that class name appears more than once on a real machine).
- **Shape**: one pill that expands into a card — artwork (the current wallpaper's thumbnail), title/byline, progress rail + clock and a full-card hit target. **Four keys when expanded**: previous / play-pause / next / mute-unmute; **three keys when collapsed** — the mute key appears with the card, because the collapsed transport row is positioned as an 88px three-key row at `opsX(0) = 206` and forcing a fourth key in would overflow the right padding. Expanding is a self-stopping 0→1 tween (no resident rAF); play/pause is **not a swapped icon** but the pair of eight-point quads, now shaped by a **tween of the playback state itself** (`mark`: 0 = paused, 1 = playing), while the morph progress `p` only drives size and position.
- **Data sources** (`npResolveMedia`: **we only report what we actually know**):

| Current wallpaper | What NP shows | What it can control |
|---|---|---|
| Video wallpaper (the `<video>` that is **really playing** right now) | Real playback state plus duration/progress; when we positively know there is no audio track the byline says "this video has no audio track" | Play / pause / mute-unmute (when we cannot tell whether there is audio we **do not guess** and leave the mute key enabled); **there is no track list ⇒ previous/next are honestly disabled** |
| Audio files that **really exist** in the wallpaper folder (custom folder / library / scene folder) | File name plus its index in the list; progress and duration come from the media element | Our own `<audio>`: play / pause / **previous · next step through the list in order and wrap around** (with only one track both side keys are disabled) / mute |
| Web wallpaper (no separate audio file in the folder) | The byline says "web wallpaper sound" | **Mute is the only channel** (`canPlay=false`; we do not pretend we can pause in-frame WebAudio) |
| No source (static image / list not there yet / scene without separate audio) | Idle state (title = nothing playing) | No "does nothing when clicked" buttons; pressing play produces a panel note plus one console line — **no fake actions** |

- **What it cannot do** (listed explicitly, no fake actions; `docs/NOW-PLAYING-DSH.md` §7.7.7): there is no system media source (that is what `lib/media-session.js` is for, and it is not wired up yet); a web wallpaper's in-frame sound supports **mute only** — play/pause is out of reach; **volume is a mute switch, not 0..1 fine control** (the only existing channel is the `mute` boolean plus the host `/media-audio` contract); a video wallpaper has no previous/next; the **mute key only appears in the expanded state** (expand the card first to unmute — a geometry trade-off, not a broken key); the heart button is not rendered; no seeking, no waveform, no keyboard shortcuts. The double-audio combination where "the wallpaper also plays the same track" **has no on-device sample to verify against** (the mitigation in place: the frame is force-muted while our player is playing).
- **Rollback**: turn `npNowPlaying` off (or "Restore all defaults") ⇒ back to zero injection (no DOM, no observers, not a single NP rule in the output). Regression: `node tools/now-playing-test.mjs` (**83 passed / 0 failed**, including 7 mutations) + `node tools/np-media-test.mjs` (**82 passed / 0 failed**, including 12 mutation self-proofs; `--no-mutations` leaves 70 main assertions) — both registered in step 2 of `tools/check.sh`. On-device probes (need `:3080` + headless Firefox, not part of the standing gate): `node tools/np-sidebar-live-probe.mjs` (12 criteria) and `node tools/np-media-live-probe.mjs` (16 PASS / 22 FAIL before the fix → 45 PASS / 0 FAIL after).
- **Attribution**: the component is a **line-by-line port of Bencho's "Now playing" (MIT)** with the upstream comments kept verbatim; the sidebar mount controller, yield criteria, self-drawn icons, token mapping, data wiring and gates are written here. Registered in `THIRD-PARTY.md` §6.

## Installation

The plugin is published on npm (`dsh-mpkg-wallpaper`). Four ways to load it:

### Option 1: `dsh plugin add` (recommended, market-recognized)

```bash
dsh plugin --profile web add dsh-mpkg-wallpaper
# restart dsh web, then Ctrl+F5 in the browser
```

Update: `dsh plugin --profile web update dsh-mpkg-wallpaper` (+ restart `dsh web` + Ctrl+F5). This resolves the `latest` tag.

### Option 2: pnpm manual install

```bash
pnpm --dir $DSH_HOME/profiles/<profile> add dsh-mpkg-wallpaper
# restart dsh web, then Ctrl+F5
```

Same source as option 1, just without the `dsh plugin` wrapper; updates go through the dependency table too.

### Option 3: Git clone (developers / offline)

```bash
git clone https://github.com/XHR666/dsh-mpkg-wallpaper.git $DSH_HOME/profiles/<profile>/node_modules/dsh-mpkg-wallpaper
# then register in the profile's cordis.patch.yml:
#   - insert:
#       - id: dsh-mpkg-wallpaper
#         name: dsh-mpkg-wallpaper
# restart to take effect
```

> Option 3 writes no dependency entry ⇒ the market does not show "installed" (display only, functionality unaffected); update with `git pull`.

### Option 4: single-file bundle (offline / drop-in; **host half only**)

Inline the host half into a self-contained ESM and register that:

```bash
cd /path/to/dsh-mpkg-wallpaper
node tools/build-bundle.mjs          # output: dist/dsh-mpkg-wallpaper.bundle.mjs (measured 442,317 B / 432.0KB)
node tools/build-bundle.mjs --check  # cross-check against the source: export surface / route table / ping JSON shape (20 assertions)
node tools/bundle-equivalence-test.mjs  # the fuller equivalence gate (38 assertions; gate step 11)
```

Copy `dist/dsh-mpkg-wallpaper.bundle.mjs` anywhere (e.g. `~/.dsh/plugins/`), register it by **absolute path** in the profile's `cordis.patch.yml`, then restart `dsh web`:

```yaml
# $DSH_HOME/profiles/<profile>/cordis.patch.yml
- insert:
    - id: dsh-mpkg-wallpaper
      name: /absolute/path/dsh-mpkg-wallpaper.bundle.mjs   # ← points at the .mjs file itself
```

**What this path loads and what it does not** (code and gate facts):

| Item | Option 4 behaviour | Evidence |
|---|---|---|
| Host half (upload/Range streaming, scene extraction, audio lists, settings persistence, diag reporting — **41 routes**) | **Complete** (`lib/index.js` + `pkg-extract.js` + `web-wallpaper.js` + `web-interaction.js` all inlined; the only externals are node builtins) | `node tools/bundle-equivalence-test.mjs`: route table (kind + path) identical `[41 entries]` |
| `/api/mpkg-wallpaper/ping` | `{ok, version, betterSidebar, betterSidebarVersion}` key set identical to the source | Same + `build-bundle.mjs --check` |
| **Client half (settings panel / wallpaper layer / frost / Now playing)** | **Not loaded.** The single file only exposes the host export surface (`apply` / `inject` / `__mpwTest`) | The client half is discovered **per package** by the DSH client module system: it scans host Loader entries declaring `dsh.client` and resolves their `exports["./client"]`; a bare `.mjs` has no package.json ⇒ no `dsh.client` declaration |
| `GET /api/mpkg-wallpaper/lg/*` (legacy WebGL hosting route, no client caller) | **404** unless a `liquid-glass/` folder sits next to the bundle; `cp -r lib/liquid-glass <bundle dir>/` makes it byte-identical to the source | The route locates `liquid-glass/` relative to `import.meta.url` (`lib/index.js:3453`); the gate asserts both layouts |
| `ping.version` | `null` when the parent directory has no `package.json` (affects the version display only) | `new URL('../package.json', import.meta.url)` (`lib/index.js:1622`) |
| "Check for updates / one-click update" | Without a companion `package.json`, `update-check` returns 500 and `update-apply` writes next to/above the bundle ⇒ **not recommended under option 4** | `lib/index.js:1792-1860` |
| Uninstall | Delete that `.mjs` and its line in `cordis.patch.yml` | — |

> Conclusion: **option 4 is a degraded "host capability only" load** (handy offline, as an emergency path, or when reusing the routes from a non-DSH host); use options 1/2/3 for the full UI. The artifact is **not committed** (`dist/` is in `.gitignore`: it is a pure derivative of `lib/*.js`, two builds are byte-identical — section ② of `tools/bundle-equivalence-test.mjs`; generate it at release time and publish the hash).

### Uninstall

Options 1/2/3: `dsh plugin --profile web remove dsh-mpkg-wallpaper`.
Option 4: delete the `.mjs` and its line in `cordis.patch.yml`.
Leftover data (optional cleanup): browser `localStorage['dsh.mpkg-wallpaper.v2']` and the host directory `~/.dsh-mpkg-wallpaper/` (`settings.json`, `web-store.json`, `media-audio.json`, uploaded mpkg files, transcode cache, `diag-*.json`).

## Degraded behaviour without a Wallpaper Engine install (missing WE / non-Windows)

A "WE install" means the Steam edition of Wallpaper Engine (appid **431960**). The host's `locateWallpaperEngine()` (`lib/index.js:303-327`) searches in this order: Windows registry `HKCU\Software\Valve\Steam\SteamPath` → common Steam directories → non-Windows Steam directories (macOS `~/Library/Application Support/Steam`, Linux/Android `~/.local/share/Steam`, WSL `/mnt/c/...`) → every library's `steamapps/libraryfolders.vdf` containing 431960 → and only accepts the one where `<library>/steamapps/common/wallpaper_engine/wallpaper32.exe` exists. **If nothing is found it returns `null`** and everything falls back:

| Scenario | Real behaviour (with code location) |
|---|---|
| WE not installed (or `wallpaper32.exe` missing) | `GET /api/mpkg-wallpaper/steam-inventory` returns **200 `{ok:true, installDir:null, wallpapers:[]}`** (not an error, never a 500) — `lib/index.js:3120-3180` |
| Clicking "Scan local library" | Empty list plus the banner "Wallpaper Engine install not found (requires Windows + Steam Wallpaper Engine)" (checks `!d.installDir`, `lib/client.js:8781`/`:11555`); an empty list also shows "No usable wallpapers found (or not a Windows environment)". **The scan itself does not fail** |
| WE installed but none of the asset folders exist | Each root is checked for existence individually (`if (!existsSync(root)) return`) ⇒ the inventory is empty and the "install not found" banner does **not** appear (because `installDir` is non-null); the UI only shows the empty-list hint. **Not implemented**: there is no dedicated "WE installed but asset folders missing" message |
| Non-Windows / mobile | Same as "WE not installed" (the registry branch returns null directly off win32); the Steam path candidates are plain strings and `existsSync` is simply false — no side effects |
| WE playlists | Only when `installDir` exists and `config.json` parses; otherwise the client writes `rotSeeded:true` after the first scan and **stops re-seeding** (`lib/client.js:8782-8793`) so custom rotations are not overwritten |
| **Still available without WE** | ① Choosing a folder manually (`/list-dirs` + `/custom-dir`); ② importing `.mpkg` directly (hybrid mode, no 600MB ceiling); ③ web/video wallpapers from a URL or local file; ④ scene extraction, audio lists, settings persistence and diag reporting do not depend on WE at all |
| Host half entirely unavailable (option 4 missing / port closed) | The `/ping` probe fails ⇒ **browser-only mode**: the status line shows "Host unavailable — fell back to browser-only mode (600MB limit)" (`lib/client.js:10203`/`:11603`); assets above 600MB cannot be handled |
| `ffmpeg` missing | `GET /api/mpkg-wallpaper/ffmpeg-check` returns **200 `{ok:true, found:false, source:null, path:null, version:null}`** (`lib/index.js:3245-3259`); the panel shows "not installed" and only starts the download chain after a click. Videos that can be decoded directly are never transcoded |

> In one line: **no WE install = one convenience channel (automatic local-library discovery) is missing**; the plugin still works. Every degradation is "empty inventory + explicit copy + the manual folder/upload paths stay open" — nothing fails silently and nothing returns a 500.

## Scene wallpaper adaptation

**Bottom line: WE scene wallpapers cannot be fully reconstructed in a browser — that is an engine-level limit.** Scenes are rendered by a proprietary engine: Live2D-style **puppet skeletons (binary .mdl)**, **shader effects** and **scripts**. There is no official Web renderer and the formats are not public (RePKG reverse-engineered only PKG/TEX; MDL skeletons have no public documentation; the open-source [we-layerd](https://github.com/Aromatic05/we-layerd) bundles the official renderer but is Linux-Wayland only).

The plugin offers two paths:

1. **External renderer iframe (preferred)**: when the local we-scene renderer on `:8899` is online, the scene is mounted as an iframe (`lib/client.js:3133-3190`). If the renderer is offline or the first frame times out, a **watchdog** falls back to the static frame and says so in a hint bar; a manual "remount renderer" button is provided. The renderer address can be overridden with `sceneRendererUrl`.
2. **In-container asset extraction (fallback, `lib/pkg-extract.js`, MIT, adopted from [elysia395/dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine))**:
   - **Static frame**: parses the PKG (LZ4) and decodes TEX textures, picking the main texture by "area × format weight × path penalty" (`lib/pkg-extract.js:1422-1491`)
   - **Layer composite**: parses every image layer of `scene.json` and composites them on a canvas using source coordinates/sizes (at most 24 layers, `lib/pkg-extract.js:1734-1829`)
   - **Embedded video slots**: `scene.pkg` is the same PKG container as mpkg, so slots with embedded video textures are parsed the mpkg way → multi-slot switching (index-first: only the directory table plus candidate prefixes are read)

**Out of reach**: MDL puppets (their texture layers are almost empty), shader waves/particles and script interactions. Those fall back to the **official preview animation** (preview.gif).

**Formats and limits** (`lib/pkg-extract.js`): PKG magic `PKGV####`, ≤1,048,576 entries; TEX `TEXV0005` + `TEXI0001`, mipmap containers `TEXB0001`–`0004`, GIF frame tables `TEXS0001`–`0003`; decodable pixel formats are RGBA8888 / R8 / RG88 / DXT1 / DXT3 / DXT5 (embedded JPEG/PNG pass through), anything else throws `unsupported format`; dimensions ≤16384, ≤32 mipmaps, ≤4096 frames; static-frame cache 96MB / 24MB per frame / 64 entries, layer cache 256 entries / 128MB.

> The realistic route to full dynamics: **render externally to a video → use this plugin's video wallpaper feature** (record with the official WE client on Windows, with we-layerd on Linux, or with the Wallpaper Engine app on mobile).

## Web wallpapers (experimental)

- **Type detection is content-first, not declaration-first**: `detectWebWallpaperKind()` returns one of four states `web / scene / video / unknown`, and `general.type` in `project.json` is only a hint — a package that claims `web` but contains `scene.pkg` is treated as a **scene**, one that claims `scene`/`video` but only has `index.html` is treated as **web**, and `application/exe/app` always becomes `unknown/excluded-application` (`lib/web-wallpaper.js:163-207`)
- **Two load modes** (chosen in the confirm dialog, recorded in the URL so a refresh keeps it):
  - **Sandbox mode (default, recommended)**: `sandbox="allow-scripts"` (**opaque origin**). The host injects the **WE API shim** at the very start of the entry HTML's `<head>`, gated by `?mpwshim=1`. Wallpaper scripts **cannot reach the host DOM / `localStorage` / cookies**; in-frame `fetch()` is cross-origin (`Origin: null`) and the host only answers CORS headers to the literal `null` (`lib/web-wallpaper.js:84`, `:529-537`)
  - **Compatibility mode (same-origin)**: `allow-scripts allow-same-origin allow-pointer-lock`, equivalent to the old bare iframe. The Live2D-class "Web wallpaper options" (resolution/language/volume, written to same-origin `localStorage`) need it
- **WE API shim (10 globals, injected before author scripts)**: `wallpaperPropertyListener`, `wallpaperRegisterAudioListener`, `wallpaperRegisterMedia{Properties,Thumbnail,Playback,Timeline,Status}Listener`, `wallpaperRequestRandomFileForProperty`, `wallpaperMediaIntegration`, `wallpaperPluginListener` (`lib/web-wallpaper.js:540-551`, `:498-517`)
- **Storage persistence**: an in-frame facade (installed when touching real `localStorage` throws) plus the host `POST/GET /api/mpkg-wallpaper/web-store`, isolated per wallpaper (`sha1(label|wallKey|relFile)`, first 12 hex chars); caps are 64 keys / 4096 chars per value / 64KB per wallpaper / 64 wallpapers, stored in `~/.dsh-mpkg-wallpaper/web-store.json`
- **Risk pre-scan**: `⚠ heavy animation` (the folder contains `.skel/.atlas` or a name matching spine/live2d, depth ≤3) and `🌐 external` (the first 256KB of the entry HTML contains `http(s)://`), shown only when `type === "web"` (`lib/index.js:1937-1953`, `lib/client.js:12867-12868`)
- **CSP**: when a blocking CSP is detected the shim is **not injected**; the original bytes are served with `x-mpw-shim-skipped: csp` (`lib/web-wallpaper.js:424-439` — this one function is **copied verbatim** from upstream `web-rewrite.ts:26-43`, MIT, registered in `THIRD-PARTY.md` §5). If the client sees no ready within 2.5 seconds it strips the marker, switches to the compat sandbox and reloads once
- **Interaction mode**: the wallpaper layer is a background layer (it does not receive pointer events), so clicking the small "interact" button in the bottom-right corner (or URL `?mpwinteract=1`) routes pointer/wheel/touch (plus keyboard and text input in `full` mode) into the author's scripts. It **always exits** — 60 s idle / 180 s total / `Esc` / the "exit interaction" button / switching wallpaper. ⚠ **Window blur does not exit** (it only releases keys and posts `op:"blur"`, `lib/client.js:2732-2769`); `?mpwinteract=full` only sets the mode and does **not** auto-arm — auto-arm accepts only `1|on`. Interaction **does not relax the sandbox** (still `allow-scripts` only) and **does not read the frame DOM**; `F5/F11/F12/browser back/forward/refresh`, `Tab`, `Backspace` and `Ctrl/Cmd+R/W/T/N/Q/L/P` are intercepted
- **Author-script errors do not take the plugin down**: the in-frame shim catches listener exceptions / global `error` / unhandled promises and reports them to the parent page with rate limiting (`console.warn` + `/diag`)
- **Known limitations**: the audio spectrum channel stays empty (WE's spectrum semantics are the **system audio**; passing the wallpaper's own sound off as a spectrum would be dishonest, so it is not faked); the media channel is implemented but not connected to a system media session; `file:///` URLs assembled inside `innerHTML` are not covered; absolute system paths cannot be mapped; pages navigated to externally get no shim

> Details (type-detection table, per-item sandbox rationale, shim API and control protocol, interaction injection and security boundaries, file-URL rewriting, error boundary, diff against the reference implementation): [`docs/WEB-WALLPAPER.md`](docs/WEB-WALLPAPER.md).
> Regressions: `node tools/web-wallpaper-test.mjs` + `node tools/web-interaction-test.mjs` (both in step 5 of `tools/check.sh`).

## Adjustable options and web-wallpaper settings wiring

- **mpkg wallpapers**: the project's own **adjustable options** are shown **read-only** in the collapsed "adjustable options" area of the *Wallpaper* tab (the browser only has the pre-rendered assets, so changing a value does not change the picture). They are there for comparison.
- **Web wallpapers (partly wired, Live2D-class)**: web wallpapers that ship `loadJson.json` / a `SettingModel` now expose their settings in the **same collapsed area**: resolution (2k/4k/8k, takes effect after a reload), language (whatever the wallpaper offers), background-music and voice volume (live), and switches such as showing touch areas or text boxes. Changes are written into the wallpaper iframe's storage (in sandbox mode through the facade → `/web-store`) and take effect after a reload.
- **Hiding the wallpaper's own settings panel**: these wallpapers carry a "settings" button in the top-right corner of the wallpaper that cannot be interacted with; the plugin hides it once the iframe loads so it does not cover the picture.
- **Not adapted**: web wallpapers that depend on an external SDK or on special interaction logic keep their own settings unwired — the plugin's adjustable options are unavailable for them (they still display normally).

> These buttons appear only when the matching wallpaper settings structure is detected; plain images/videos and web wallpapers without settings show nothing.

## Performance and stability

- **mpkg header-only reads**: container parsing reads just the first 2MB (`lib/index.js:44`), so even an 834MB mpkg starts almost instantly
- **The audio inventory does not wait for the whole package**: a `scene.pkg` keeps its directory table at the front ⇒ only the table plus 16 magic bytes per candidate entry are read (audio payloads never enter memory). `/custom-scene-audio` and `/library-scene-audio` return `{count,tracks:[…],stats}` directly, and `/raw` supports **Range/206**. Measured: reading whole packages 1.7–379 ms ⇒ index reads 1.3–6.9 ms cold / 0.4–0.9 ms warm
- **Scene embedded-video probing is "index first"**: only the directory table plus candidate prefixes (`.tex` header and first mipmap record, the first 12 payload bytes for the `ftyp` box; when mip0 is LZ4 only the first sequence is decompressed), and anything uncertain falls back to reading the whole entry. Measured across 11 real packages: **2894 ms → 532 ms cold / 7 ms warm**; gate `node tools/scene-video-test.mjs`
- **Scene caches are bounded by size**: static-frame cache 96MB/64 entries, layer cache 128MB/256 entries, two independent ceilings
- **Restart self-healing**: custom-folder wallpapers are rebuilt after a restart by matching the file-name token (after media 404 retries are exhausted the `mpkgKey` is re-parsed)
- **Re-entrancy locks**: `applyFromStorage` and the Aqua theme listener both carry a re-entrancy flag plus debounce, so the `overrideTokens → theme/change →` loop cannot come back
- **Listeners and timers register once**: the storage listener, the 60 s slot check and the inline-style watcher are de-duplicated, so repeated applies or RTC reconnects do not accumulate
- **Lazy loading against OOM**: only the current Time Variation slot is extracted, and hybrid streaming keeps large-file memory flat
- **Transcode resource caps live in one place**: 12 artifacts / 512MB, concurrency 1, 30 s queue, 15 min per job, default downscale to 1920 wide, 1024MB memory admission (see the [historical ledger](#video-wallpaper-transcoding-verdict-and-resource-caps))
- **Weak-device degradation**: heavy composites (full-screen `backdrop-filter` plus streaming video) are throttled overall; for extreme combinations prefer Edge or a desktop browser

**🌐 Browser compatibility (measured reference)**

| Browser | Rating | Notes |
|---|---|---|
| Chrome / Chromium (desktop) | ⭐⭐⭐ strong | Most complete: best `backdrop-filter` and `color-mix`, working `iframe.muted`, muted autoplay allowed |
| Edge (desktop) | ⭐⭐⭐ strong | Video wallpapers take a **separate canvas render path** (to dodge Edge's floating toolbar, `lib/client.js:1464-1520`); some versions show only a static first frame (not blank, not a crash) |
| Firefox | ⭐⭐ medium | Everything is supported (`backdrop-filter` 103+, automatic transcode fallback for unsupported codecs); three deductions: `backdrop-filter` is slower than Chromium, `iframe.muted` is unsupported (a web wallpaper with sound may have its first frame blocked by the autoplay policy), `color-mix` needs 113+ |
| Android WebView / mobile | ⭐⭐ weak-medium | Autoplay policy depends on the host WebView configuration; `getBattery` may be missing (guarded and skipped); for extreme combinations prefer a static image/GIF or turn blur off |

> The source degrades for each browser (rAF fallback when `requestVideoFrameCallback` is missing, guards around `ResizeObserver`/`getBattery`, `.catch` on every `play()`, `backdrop-filter` detected with `CSS.supports` and degraded to opaque).

## Security notes

- **No passive outbound network traffic by default**: the plugin never reaches out to the network on its own; everyday playback only talks to the local DSH host (`127.0.0.1`). The exceptions are all **explicitly user-triggered**: check-for-updates/one-click update contact GitHub (`raw.githubusercontent.com`, `api.github.com`), and the ffmpeg download contacts GitHub Releases / an npm binary mirror. In addition, **0.8 s after the settings panel opens a silent version check runs once** (it only lights the badge — no dialog, no download, no upload). Network image URLs typed by the user and resources loaded by a web wallpaper itself are external requests too.
- **No sensitive content**: the source contains no paths, keys, tokens or personal information; `node tools/secret-scan-test.mjs` scans every tracked file (12 credential patterns, 3 local-path patterns) and must report 0 hits.
- **Web-wallpaper sandbox**: in the default mode the iframe is an opaque origin, so author scripts cannot read the host DOM / `localStorage` / cookies and cannot remove their own sandbox; frame↔parent traffic is `postMessage` only (op allow-list + parent-origin check). Cross-origin reads of wallpaper assets are allowed **only for `Origin: null`**.
- **Web-wallpaper interaction**: injected events originate only from the plugin's **interaction stage** (which is `display:none` by default; while interaction is off not a single event is injected). Turning it on sets `data-mpw-interact="on"` on the host page (the host UI yields entirely and a permanent exit button sits in the top-right corner); 60 s idle / 180 s total / `Esc` / switching wallpaper all exit. Interaction **does not relax the sandbox** and **does not read the frame DOM**.
- **Host routes**: the custom-folder and library routes validate against path traversal (`..`, absolute paths and leading dots are rejected), and `/raw` only serves registered container entries.
- **Data boundary**: all parsing happens locally; `localStorage` only holds the background and parameters; settings are also written to the host's `~/.dsh-mpkg-wallpaper/settings.json`, and web-wallpaper frame storage to `~/.dsh-mpkg-wallpaper/web-store.json`.
- **System media session module**: command names and arguments are passed separately (argv arrays, never through `sh -c`); player names, ops and seek ranges are validated, and anything invalid means 0 commands; timeouts are followed by `SIGKILL` (`lib/media-session.js:519-540`).

## Attribution and licence

- **This package is MIT** (`LICENSE`; the `license` field in `package.json` is `"MIT"`). Third-party provenance, clean-room records, per-item attribution and the "what was copied / why / what was not" ledger all live in **`THIRD-PARTY.md`** (**shipped with the package** — it carries the MIT attribution obligation).
- **The only vendored third-party code** is `lib/liquid-glass/**` (the liquid-glass renderer library): **moved out of the publish surface by P-127** (`files` negative patterns `!lib/liquid-glass/**` + `!lib/liquid-glass-bundle.js`). **Every file is still in the repository** and all 10 sha256 digests are still registered (`THIRD-PARTY.md` §1.3). The host's `/api/mpkg-wallpaper/lg/*` hosting route is still a live path (on a hit it really reads `lib/liquid-glass/<file>`); on an npm-installed copy it returns 404 by design.
- **Now playing component**: a **line-by-line port** of Bencho's "Now playing" (MIT) with upstream comments kept verbatim; the sidebar mount controller, self-drawn icons, token mapping and gates are written here (`THIRD-PARTY.md` §6).
- **Web wallpapers**: the API list and semantics of `lib/web-wallpaper.js` were **studied against** `oneincase/webwallgl` (MIT), which is **not vendored**; one function, `hasBlockingCsp`, is **copied verbatim** (line-by-line provenance in `THIRD-PARTY.md` §5). The difference list is in `docs/WEB-WALLPAPER.md` §10.
- **Scene extraction**: `lib/pkg-extract.js` is adopted from [elysia395/dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine) (MIT, credited in the file header); its audio-index section was rewritten clean-room on 2026-09-16 against `docs/AUDIO-TRACK-SPEC.md`.
- **GPL boundary (never enters the plugin)**: `MIT plugin → GPL renderer ✅`; `GPL renderer → MIT plugin ❌` (this package only lets code out, never in). This package must **not** import or inline any code from the renderer (`we-scene-demo`, GPL-3.0-or-later); interaction with the renderer happens over process/HTTP protocols only. **Any other third-party code added in the future — including GPL-3.0 renderer-side code — must not enter this MIT package** (`THIRD-PARTY.md:97`, `:128-135`). Machine check: `tools/web-wallpaper-test.mjs` F1 (after stripping comments, grep finds no GPL-2.0-only project-derived identifiers and no GPL licence text).
- Reference projects: [dsh-bg-image](https://github.com/lyh9712/dsh-bg-image) (MIT, template), [unmpkg](https://github.com/aqnya/unmpkg) (GPL-3.0, mpkg binary format reference only), [repkg](https://github.com/notscuffed/repkg) (MIT, .tex format study only).
- Thanks to: [Bil812](https://github.com/Bil812) (the colour sampling / adaptive text colour / unified mask ideas in [PR #2](https://github.com/XHR666/dsh-mpkg-wallpaper/pull/2), absorbed as the Aqua experiment mode — every part switchable and off by default), [elysia395/dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine) (the scene extractor, plus the "persist settings to a host file" and "Edge canvas compatibility" ideas), [oneincase/webwallgl](https://github.com/oneincase/webwallgl) (the API list and semantics behind the web-wallpaper sandbox + WE API shim) and the [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) community (listing and promotion).

> **Naming note (2026-09-18):** the renderer product this plugin integrates with is now called **WEwebLoader**.

## File structure

```
dsh-mpkg-wallpaper/
├── package.json      # version 3.8.0; dsh.bundle + dsh.client declarations; files allow-list = publish surface (14 files)
├── cordis.patch.yml  # install declaration used by dsh plugin add
├── LICENSE           # MIT
├── THIRD-PARTY.md    # third-party provenance / clean-room records / licence attribution (shipped)
├── icon.svg
├── README.md / README.en.md
├── lib/
│   ├── index.js            # host half: 41 routes (upload/Range streaming, scene extraction, audio lists,
│   │                       #   web wallpapers + shim, web-store, media-audio, settings persistence, diag, update, ffmpeg)
│   ├── client.js           # browser half (served as ONE file via exports["./client"]): mpkg parsing + settings page +
│   │                       #   background DOM + blur system + library + Time Variation + web options + playback/power + NP mount
│   ├── pkg-extract.js      # scene.pkg static frame / layer composite / audio index / embedded video index (MIT, from elysia395)
│   ├── web-wallpaper.js    # web wallpapers: content-first type detection + WE API shim source + entry injection + CORS + storage facade
│   ├── web-interaction.js  # web-wallpaper interaction: coordinates / event shaping (incl. touch) / state machine / stage contract (MIT, own work)
│   ├── media-session.js    # host-side system media session adapters (MPRIS / SMTC; **implemented, not wired up yet**)
│   ├── now-playing.js      # Now playing component + sidebar mount controller (Bencho MIT port + this repo's anchor / collapse / yield criteria)
│   ├── now-playing-math.js # Now playing pure math (zero DOM)
│   ├── liquid-glass/       # legacy WebGL liquid-glass library (**kept in the repo · not in the publish surface**)
│   └── liquid-glass-bundle.js  # its build artifact (**kept in the repo · not in the publish surface**)
├── tools/            # gates/tests/benchmarks/probes (**not shipped**)
│                     #   check.sh (12-step gate) / integrity-check.mjs / secret-scan-test.mjs /
│                     #   panel-smoke.mjs / switch-wiring-test.mjs / style-scope-guard.mjs /
│                     #   token-namespace-test.mjs / now-playing-test.mjs (83) + build-now-playing.mjs (inline generation + drift gates) /
│                     #   np-media-test.mjs (sound wiring, 82, incl. 12 mutations; gate step 2) / media-session-test.mjs (not in the gate) /
│                     #   web-wallpaper-test.mjs / web-interaction-test.mjs /
│                     #   np-sidebar-live-probe.mjs, np-media-live-probe.mjs (on-device probes; need :3080 + headless Firefox) /
│                     #   bundle-equivalence-test.mjs / pre-commit.sh + ../.githooks/pre-commit
├── docs/             # engineering notes (**not shipped**): WEB-WALLPAPER.md / NOW-PLAYING-DSH.md / MEDIA-SESSION.md /
│                     #   DIAGNOSTICS.md / RELEASE.md / STYLE-SCOPE-GUARD.md / TOKEN-NAMESPACE.md / PRE-COMMIT.md …
└── dist/             # build output (**not committed, not shipped**): dsh-mpkg-wallpaper.bundle.mjs (option 4; generated on demand)
```

> Exclusions: `lib/liquid-glass/**`, `lib/liquid-glass-bundle.js` and `lib/**/*.bak*` are excluded by `files` negative patterns; `tools/`, `docs/`, `dist/` and `package-lock.json` are not in the `files` allow-list. Section ⑨ of `tools/integrity-check.mjs` asserts **both directions**: "not in the publish surface" and "must still be present in the repository".
> `lib/now-playing.js` / `lib/now-playing-math.js` use a **source + generated inline** shape: `tools/build-now-playing.mjs` inlines them byte-for-byte into the generated region of `lib/client.js`. Why this is necessary: the host serves the **one file** that `exports["./client"]` points at, so any relative `import/require` inside `lib/client.js` breaks module resolution in the browser (asserted by section ⑩ of `tools/integrity-check.mjs`). The price is a drift gate, so **two independent implementations** run permanently in step 2 of the gate.

## Gates

```sh
node tools/integrity-check.mjs     # 72 passed / 0 failed: files present, metadata, allow-list, no local paths, client self-containment
node tools/secret-scan-test.mjs    # 0 credential hits, 0 local absolute paths, no rotten allow-list entries
bash tools/check.sh                # the full 12-step gate (step 9 needs headless Firefox for the on-device replica A/B)
node tools/style-scope-guard.mjs   # the criterion is the last line "… OK / … ALLOWLISTED / 0 RED / 0 REVIEW": RED/REVIEW must be 0 (the OK count follows the rules)
```

The 12 steps of `tools/check.sh`: ① syntax ② panel smoke + P-66 + folder picker + wallpaper-layer visibility + persistence + NP (both drift gates, 83 assertions, plus the 82-assertion sound-wiring gate) ③ CSS matrix (all 512 combinations + 600 random + boundaries) ④ scene watchdog/debug params ⑤ sandbox and scene tokens + web-wallpaper shim + transcode resources ⑥ publish integrity self-check ⑦ audio-scan speed-up ⑧ scene video indexing ⑨ on-device replica A/B ⑩ better-sidebar compatibility ⑪ single-file bundle equivalence ⑫ style-scope guard + surface token namespace.

## Historical ledger

The sections below are **evidence that has already been booked** (incident, root cause, criterion, rollback switch). Their factual content is preserved rather than rewritten: they explain *why the current implementation looks the way it does*.

### P-66 panel robustness fixes (2026-09-15)

> Scope: the 9 UI issues reported that round were confirmed to belong to the **webwallgl test bench (:8901)**, unrelated to the DSH plugin panel. On that basis this round **kept only two real plugin bugs that reproduce independently of that UI**; every other UI change was reverted. Regression: `node tools/panel-fixes-test.mjs` (gate step 2).

| Real bug | Root cause | Fix | Reproduction / assertion |
| --- | --- | --- | --- |
| **The render error boundary failed and swallowed the real cause** | The outer `catch (err)` of `MpkgSectionImpl` called `h(...)`, but `h` is a `const` **inside the outer `try` block** (block-scoped and invisible there) → the boundary itself threw `h is not defined`, so users saw "壁纸引擎设置区渲染异常：h is not defined" and the **real error was lost** | That catch now uses `react.createElement` | `node tools/panel-fixes-test.mjs --client <pre-fix copy>` → red (shows `h is not defined`); against the current code → green (shows the real `boom-body` error) |
| **zh/en dictionary key sets diverged** | `en` was missing 18 keys (`glass.*`, `glassWindow*`, `flipX/Y*`, `themeColor*`, `rightSidebarBlur.overridden`) → the English UI printed **raw keys**; 10 `clock.*` keys existed only in `en` → the Chinese UI printed English; two strings were hard-coded Chinese | Both dictionaries were brought to **identical key sets** (only additions, no removals; the count is whatever `node tools/panel-fixes-test.mjs` prints, so it cannot go stale); the two hard-coded strings now go through `t()` | Same test: identical key sets / every statically referenced `t("k")` present in both / English render contains no Chinese / Chinese render contains no raw keys |

### Two on-device bugs fixed at the root (2026-09-16): header frost / right-side timeline rail

| Bug | Root cause (criterion) | Fix | Rollback switch | Regression |
| --- | --- | --- | --- | --- |
| **Title-bar frost "never appeared"** | The first line of `syncHeaderFrost()` called `normalizeSection(...)`, but that function was defined **inside another function's body** ⇒ every call threw a `ReferenceError` which its own `catch {}` swallowed ⇒ the frost layer was never injected and the diagnostic `reason` stayed empty (on-device diag showed `injected:false` / `reason:""`) | The normalizer was **hoisted to module scope**; exceptions are written into `hdrFrostState.reason` instead of vanishing; "real frost element + translucent header background" now appear as a pair (the background uses our own `--mpw-hdr-frost-bg`); when `wanted=false` the layer is **removed** rather than left empty (an empty layer suppresses the pseudo-element fallback and kills frost entirely) | `?hdrfrost=legacy`, `?hdrfrost=off`, `?hdrblur=pseudo\|element` | `node tools/frost-rail-test.mjs` |
| **The right-side timeline (turn navigator rail) turned transparent in wallpaper mode** | The rail's colour tokens are `--dsw-alias-border-l4` and `--dsw-alias-label-*`. The plugin ① overrode `--dsw-alias-label-*` with `var(--mpw-aqua-ink, inherit)` and a self-referential fallback (DSH defines them on **`body`**, not on `html`) ⇒ on body they became **guaranteed-invalid** ⇒ the active/preview bar's `background` became unset = transparent; ② a bare `html body { --dsw-specific-sidebar-fill: transparent }` changed a **host token globally** and made chat surfaces translucent ⇒ a 16% bar painted on the wallpaper became invisible | Token overrides were **narrowed** to allow-listed containers; the aqua/text-colour overrides gained `data-mpw-*` gating and lost the inherit/self-reference; the rail got a theme-computed contrast colour in **our own namespace** (only on allow-listed nodes, never touching host tokens, no `!important`) | `?railink=off`, `?sbfill=wide` | `node tools/frost-rail-test.mjs` |

> Details and the diagnostic field table: [`docs/HEADER-FROST.md`](docs/HEADER-FROST.md), [`docs/TIMELINE-RAIL-TOKEN.md`](docs/TIMELINE-RAIL-TOKEN.md).

### Style-scope guard: why this class of bug cannot come back (2026-09-17)

The two bugs above share one mechanism: **nobody owned selector scope** — whoever edits a style cannot see locally that "this rule will hit the host UI". Gate step 12 turns that into a machine criterion that goes red (`node tools/style-scope-guard.mjs`):

* **Real artifacts, not a rewrite**: it does not reimplement `buildCss`; it runs `lib/client.js` in Node through `tools/_stub.mjs`, calls the plugin's own `__mpwBuildCss(patch)`, and enumerates **600+ setting combinations** automatically from the `boolFields`/`numFields` in the source (615 this round: default set / each boolean alone / all 512 combinations of the 9 core switches / the bsCompat family / values 0 and 100 / no wallpaper / lgTest), then parses every generated CSS rule (`@media`/`@supports` included).
* **Criterion**: every rule's selector must hit one of our own markers (`.mpw*` / `[data-mpw*]` / `#mpw-*`), or a **registered** host/third-party scope — including the `[data-dsh-better-sidebar] …` rule that deliberately targets third-party DOM, which **must register a reason plus a `docs/*.md:line` pointer** (validated at runtime; drift goes red). Bare element selectors, bare `*`, overriding host tokens on `:root`, host tokens set to transparent/inherit, unregistered `!important`, touching the host turn-navigator rail without gating, `[data-dsh-panel-host]` and transparentising the top-bar border ⇒ **red**.
* **It proves it has teeth**: `node tools/style-scope-guard.mjs --selftest` copies `lib/client.js` into a temp directory, injects mutations (including a negative control that says "our own markers must still pass") and asserts RED/REVIEW/PASS for each.
* Criteria, the allow-list ledger and "how to register a new entry": [`docs/STYLE-SCOPE-GUARD.md`](docs/STYLE-SCOPE-GUARD.md).

### Surface token namespace: top bar / sidebar / panels / timeline rail read one `--mpw-*` set (2026-09-18)

"Visual consistency across the four surfaces uses **one token namespace** (`--mpw-*`) and **never overrides host tokens** ⇒ structurally eliminate the 'we broke a host feature' class of bug." The second criterion of step 12 mechanises it (`node tools/token-namespace-test.mjs`):

* **One source**: host tokens are consumed into `--mpw-surface-*` only inside `emitSurfaceTokens()`, and the single `body{…}` block in the output is where every surface value is defined (41 shared tokens, one definition point each, measured); the four surfaces' rules **only** write `var(--mpw-surface-*)`.
* **Why `body` and not `:root`**: DSH defines `--dsw-static-*` / `--dsw-alias-*` on **`body`** (there are none on `html`). `var()` inside a custom property is resolved **on the element where it is declared** ⇒ declaring on `:root` yields a guaranteed-invalid value that is **inherited by every descendant** (all consumers become `unset` = transparent). This is the exact mechanism behind the historical "right-side timeline rail turned transparent", and there is a dedicated assertion plus a mutation watching it.
* **Only one host-token override remains**: `buildSidebarFillCss()` (`--dsw-specific-sidebar-fill`, only on allow-listed sidebar containers, only in the sidebar-reveal state). The registry (`HOST_OVERRIDE_REGISTRY`) requires token + selector + value shape + **activation condition** per entry: all 39 override declarations in the output must be registered and matched, and they **must not appear once** in combinations where the feature is off.
* **Equivalence evidence**: using `git HEAD`'s `lib/client.js` as "before", 606 setting combinations × light/dark × default/gated compare the four surfaces' **computed values** (a tiny cascade model plus recursive `var()` substitution) ⇒ 25,428 keys equal, key by key. This is a refactor, not a redesign.
* Inventory: [`docs/TOKEN-NAMESPACE.md`](docs/TOKEN-NAMESPACE.md).

### Switch-wiring audit: no more "the toggle clicks but nothing happens" (2026-09-18)

**The incident**: the CSS blocks for "Accent" (`accent`) and "Dark-background text readability" (`aquaTextEnhance`) were wrapped together in `if (aquaOn(section))` ⇒ **with only those two switches on, no rule was generated at all**: clickable in the UI, no effect, no console error. Fixed, plus a general criterion `node tools/switch-wiring-test.mjs` (gate step 2):

* Every boolean switch must **change the `buildCss` output** in at least one of three contexts (default / rich / everything-else-on); switches that only affect runtime behaviour must register a `reason` one by one (such as `mute`/`rotate`/the three power-saving switches/the clock copy — see the `NON_CSS` table at `tools/switch-wiring-test.mjs:41-64`).
* Non-boolean features (`accent`/`aquaTextEnhance` must change the output when set); `themeColor` is "CSS always emitted + runtime attribute gating", so its criterion is that the gating rule really exists in the output.
* Switches **proven dead** go into `KNOWN_DEAD` and are listed explicitly on every run (a two-way assertion: once fixed they must be removed). **That table is now empty.** **Retired** (deleted) switches are instead watched by section A0: "0 dangling references in the source + 0 orphan strings in both dictionaries", each with a permanent mutation.
* Three fixes landed here: **`lgCss` never executed at all** (it referenced `bdSupported`, declared after it in the same function scope ⇒ a TDZ `ReferenceError` swallowed by the outer `catch`); **`sessionFollow` had a toggle and copy but no reader anywhere** (implemented to match the user-visible copy: on = follow the panel opacity, off = back to the host's original colour); **`glassWindow` was deleted under the "no visible-but-dead copy" policy** (it had neither a toggleRow nor a read site, and its promised feature is covered by `settingsBlur` + `dialogBlur`/`popoverBlur`). Six deletion points (2 i18n lines ×2 languages + the `lgTest` preset default + restore-defaults + `BACKUP_FIELDS` + the import `boolFields`), and the **default-profile output sha256 is byte-identical before and after**.
* **The better-sidebar master switch `bsCompat` now defaults to on**: the bottom-panel floating fix is settled on-device, and default-off meant nobody ever saw it. Existing users are migrated **only when they never set it explicitly**; **a manual off is never overwritten** (the write path stamps `bsCompatUserSet`, the migration does not). Gate: `node tools/bs-compat-default-test.mjs` (step 10, 15 assertions + 3 mutations).
* **That top-bar refraction lives on a pseudo-element** (`html body[data-mpw-hdr-frost-el] .wSkVaW_header::before`, `z-index:0`): putting it on `.wSkVaW_header` itself makes the header a **backdrop root**, which isolates the backdrop sampling of popovers inside it ⇒ popover frost fails and the text behind shows through sharply. A pseudo-element is not an ancestor of those popovers, so they sample normally; and it is generated **only when the header is frosted anyway**.
* Teeth: wrapping the `accent` / `aquaTextEnhance` gates back inside `aquaOn` must go red (two mutations).

### Pre-commit gate (a few seconds, 2026-09-19 / P-129)

The audit above (plus the panel-rendering regression) was extracted into a **second-scale pre-commit hook** that stops the two classes of incident that **really happened more than once** ("a switch is not wired", "the panel is broken") **about 4 seconds before the commit**:

```sh
cd dsh-mpkg-wallpaper
git config core.hooksPath .githooks    # install (affects this clone only; uninstall with git config --unset core.hooksPath)
git commit --no-verify                 # one-off bypass
MPW_SKIP_PRECOMMIT=1 git commit -m …   # one-off bypass (script-level explicit exit 0)
```

* **What it runs**: `tools/panel-smoke.mjs` (panel rendering + language dictionaries, ~0.3 s) + `tools/switch-wiring-test.mjs` (every switch must really change the output + retired switches with 0 dangling references + mutation self-proofs, ~2.5 s), **serially**.
* **What it does not run**: the 12 steps of `tools/check.sh` (step 3 is the 615-combination CSS matrix, step 9 needs headless Firefox) are **not** part of the pre-commit.
* **It does not block development**: installing is explicit; if the staged paths contain no artifacts (`lib/`, `tools/`, `package.json` untouched) it skips; if `node` or the scripts are missing it prints one line and `exit 0`; on failure it prints the red lines verbatim and tells you how to bypass, without editing files or auto-fixing.
* **Details and measured output**: [`docs/PRE-COMMIT.md`](docs/PRE-COMMIT.md).

### Video-wallpaper transcoding: verdict and resource caps

> The fact: a `~/.dsh-mpkg-wallpaper/transcodes/src_*.bin` file was resident with RSS ≈ 690MB — the plugin was transcoding the wallpaper being **played**.

**Verdict: that transcode was a misjudgement (a bug).** Criterion: the `src_*.bin` was `h264 High L5.2 + aac / MP4` (read with `ffprobe`; any browser can decode it), while `settings.json` had `fpsCap=0 / resMax=0` (transcoding was not enabled) ⇒ the trigger was the client's **automatic fallback** `/transcode?fps=24` after a `video.error` (`code 3/4`) — and `code 3/4` only means "this frame could not be decoded", **not** "the browser does not support this codec".

**Fix**: a new **playability gate** (`/probe` reads metadata only and never starts ffmpeg; criteria = codec/container allow-list plus the deterministic gaps such as h264+opus in MP4 and HEVC Main10; when probing is inconclusive nothing changes) — playable sources are **played directly** and only genuinely undecodable ones are transcoded. Three real bugs were fixed along the way: the old `direct-spec` direct-play criterion **ignored the codec** (HEVC was played directly → black screen), byte-cap eviction **deleted from the newest** (so a freshly transcoded artifact deleted itself ⇒ permanent cache miss) and a **cancelled job still retried with another encoder**. Resource caps now live in one place: 12 artifacts / **512MB**, concurrency **1**, 30 s queue, 15 min per job, **transcodes downscale to 1920 wide by default** (a 4K 656MB source measured → 1080p 275MB) and a **1024MB memory admission** check (insufficient free memory refuses the transcode instead of dragging the machine into swap); the cache is pruned once at startup with a log line; the three states (direct / transcoding / cached) are logged and exposed on `window.__mpwWallpaperState`.

> Details, criteria table and memory measurements: [`docs/TRANSCODE-RESOURCE.md`](docs/TRANSCODE-RESOURCE.md); rollback `?mpwtranscode=legacy|aggressive`; regression `node tools/transcode-limit-test.mjs` (43 assertions, gate steps 5/12).

### Folder / file picker: behaviour contract and shortcuts (2026-09-17)

**Root cause (criterion-style; see [`docs/DIR-PICKER-SCROLL.md`](docs/DIR-PICKER-SCROLL.md))**: the old "compensate the scroll position afterwards" code was **dead code** — `dirScrollRef.current` was only ever written as `{anchorIdx, anchorOff}` and **never got a `ratio`**, so `if (ratio === void 0 || ratio === null) return;` always returned early and neither the anchor compensation nor the proportional restore **ever ran**; the container also had no `overscroll-behavior: contain` (so wheel events chained to the host settings panel at the edges), and nothing restored `scrollTop` after React rebuilt the list nodes (new nodes start at `scrollTop = 0`). Together: the observed "jumps back to the top / locks at the top".

**Fix (no new third-party dependency)**: the picker now **owns the scroll position itself** — the container remembers each path's `scrollTop` (scroll events only write a ref, never `setState`) and writes it back **synchronously before paint** in `useLayoutEffect` (idempotent, never fights the user, all timing-window hacks removed); scroll containers carry `overscroll-behavior: contain` + `overflow-anchor: none`; row keys became "full path + folder name" (incremental updates instead of full rebuilds); the dialog element has a stable key; and there is **no `focus()`/`autoFocus` anywhere**.

| Behaviour contract | Detail |
|---|---|
| **Scroll position preserved** | After a refresh / filter / shrinking list / 500-entry directory / host re-render / **container node rebuild**, the position stays where it was (no single "jump to top" frame) |
| **Never steals focus** | Opening the dialog focuses **the list container itself** with `focus({preventScroll:true})`; rows are `tabindex="-1"` and block default focusing on `mousedown` ⇒ **no row ever becomes `document.activeElement`**; re-renders do not steal focus |
| **Per-folder memory** | Folder A scrolled to 60 and folder B to 20 keep their own positions when switching back and forth |
| **No wheel chaining** | Reaching the end of the list does not scroll the settings panel behind it |
| **Row-level incremental updates** | A refresh only adds/removes the difference (row key = full path; tests assert row node uids are unchanged) |
| **Missing anchor never resets to 0** | A remembered position beyond the new list is **clamped** into range; missing/invalid memory (`null`/`""`/`NaN`) counts as "no anchor" ⇒ adopt the current position |

| Key | Behaviour |
|---|---|
| `↑` / `↓` | Move the active row (no focus stealing; the smallest `block:"nearest"` scroll while the key is held) |
| `Home` / `End` | Jump to the first / last folder |
| `Enter` | Enter the active row's folder; **with no row selected it means "Choose this folder"** |
| `Backspace` / `Alt`+`↑` | Go up one level |
| `Esc` | Close the dialog |

**Regression gate**: `node tools/dir-picker-test.mjs` (**57 assertions**; the 10 source-level assertions in group A go **red 9 times** against the old implementation from `git show HEAD:lib/client.js`, proving the cases have teeth; group B runs a slice of the production implementation on a fake DOM plus a mini React).

## Bug reports

When reporting an issue, please include:
- The **original .mpkg or workshop folder** (required to reproduce)
- The result of one "one-click diagnostics report" (*Other* tab → one-click report; a JSON file is downloaded automatically when the host is unavailable)
- Browser console output (F12 → Console), if any
- Your DSH version and platform (Windows / Linux / mobile)

## Rendering feasibility research

- A complete scene (Live2D puppets included) can only be produced by the proprietary renderer: the Wallpaper Engine app's native library (embedded Chromium + proprietary puppet rendering). The open-source [we-layerd](https://github.com/Aromatic05/we-layerd) (Rust) bundles the official renderer but is **Linux Wayland only**
- There is no mature WE scene renderer for the browser — **regardless of the operating system, no browser can render Live2D scenes directly**; the official renderer `.so` is a closed binary and cannot be compiled to WASM without source
- The feasible path for this plugin: **external renderer iframe (preferred) + static-frame extraction + layer compositing + (Time Variation) mpkg-style slot switching**; when full dynamics are needed, use "render externally to a video → video wallpaper"
