# dsh-mpkg-wallpaper — Wallpaper Engine mpkg Background Plugin

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

[中文](README.md) | [English](README.en.md)

A plugin for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI (dsh web) that adds background wallpapers: **Wallpaper Engine `.mpkg` parsing, Steam Workshop raw folders, video/web/image wallpapers, time-of-day switching, a full-screen frosted blur suite, theme-color & glass appearance, a local wallpaper library, timed rotation and one-click updates**. Nearly every visual detail is adjustable.

> **One-liner**: video/image/web wallpapers play directly; **time-variation wallpapers support multi-slot auto-switching + manual slot lock**; **some web wallpapers with built-in options (e.g. Live2D portraits — resolution/language/volume) are wired into the plugin settings page and can be edited in the collapsible "Adjustable options" area**; Scene wallpapers get static-frame extraction + layer compositing as partial solutions.

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
- Appearance tab also has: **wallpaper flip** (flipX/flipY), floating cards, clock, etc.

**🎬 Lens & picture**
- Lens zoom (10–2000%) & pan, brightness (50–150%), light sharpen, wallpaper flip, Deep diving background box

**🚀 Hybrid large-file mode (default on)**
- mpkg streams to the DSH host → disk storage → HTTP Range streaming, **>600MB files supported**, low memory usage

**🖼️ Local wallpaper library**
- **Steam auto-discovery** + **custom folder** (any directory + cross-platform folder picker; .mpkg files and workshop folders can be mixed freely)
- **Switching & rotation**: prev/next one-click, timed auto-rotation (interval adjustable)

**🛡️ Safety & coexistence**
- **Conflict detection**: auto-disables when another wallpaper/theme plugin is detected
- **Security boundaries**: .exe/application wallpapers are completely excluded (virus-injection defense); custom folders only read media files; host routes validate against path traversal; web-wallpaper iframes are sandboxed

**🔄 Updates**
- "Check update" compares **versions** (semver) — un-pushed local changes don't false-positive; "Apply update" pulls the latest code from GitHub, restart to take effect

**💾 Backup & restore / settings persistence**
- The "Other" tab provides **backup & restore**: export appearance settings (Appearance / Unified blur / UI blur / Aqua / Other) to a **shareable JSON file**, import to restore — not the current wallpaper or scanned dirs
- **Settings persist to a host file**: besides localStorage, settings are written to `~/.dsh-mpkg-wallpaper/settings.json` — **survives port changes / browser-data clears** (following elysia395 v0.4.0)

## Supported Types & Status

| Type | Web behavior | Notes |
|---|---|---|
| **mpkg (video)** | ✅ Full | embedded mp4 / video textures play directly |
| **mpkg (scene)** | 🟡 Partial | static-frame / layer composite / preview animation (below); slots with video textures auto-switch |
| **Time-variation wallpaper** | ✅ Full | multi-slot auto-switch + manual lock, lazy loading to avoid OOM |
| **Video (mp4/webm)** | ✅ Full | plays directly |
| **Web (HTML)** | 🟡 Experimental | sandboxed iframe; **web wallpapers with settings are wired into the plugin (below)** |
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
- **A few web wallpapers are still in progress**: web wallpapers relying on external SDKs / special interaction logic (e.g. some miHoYo event pages) haven't had their built-in options wired in yet; they load as-is.

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

- HTML wallpapers load full-screen in a **sandboxed iframe** (`allow-scripts` isolation; **mute toggle, default on**; does not auto-reload after refresh — refresh the page to recover if frozen)
- **Risk preflight**: auto-classified during scan; badges shown in the list and confirm dialog:
  - **⚠heavy animation**: Spine/L2D skeletal wallpapers — may freeze on low-end devices
  - **🌐external**: depends on external SDK/CDN (e.g. miHoYo event pages) — may fail to load
- Tested: webm-video-based web wallpapers (light) work; Spine skeletal ones depend on device performance; **Live2D portraits with a `loadJson.json` are wired into the plugin options** (above)

## Settings Tabs

- **Source**: master switch, hybrid, mpkg file, image/video files, custom folder (can point at the workshop root), local library (Steam scan), switching/rotation, **time-variation slot lock**
- **Appearance**: theme color, flip, floating, frosted blur, lens zoom/position, brightness
- **Unified blur**: full-screen blur + sidebar/title-bar fog, chat follow, new-chat follow
- **UI blur**: dialog/settings/popup/popover/mask/sidebar frost each independent
- **Wallpaper reveal**: sidebar/title-bar visibility, title-bar frost amount, sharpen
- **Aqua**: unified fog / panel tint / adaptive text experiment toggles
- **Other**: clock, update check/apply, **backup & restore**, restore all defaults

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
git clone https://github.com/XHR666/dsh-mpkg-wallpaper.git $DSH_HOME/profiles/node_modules/dsh-mpkg-wallpaper
# then register in the profile's cordis.patch.yml:
#   - insert:
#       - id: dsh-mpkg-wallpaper
#         name: dsh-mpkg-wallpaper
# restart to take effect
```

> Note: Option 3 is not recorded in the dependency table — the market won't report it as installed (display only; functionality unaffected).

Uninstall: `dsh plugin --profile web remove dsh-mpkg-wallpaper`.

## Limitations

- **Scene wallpapers cannot be fully dynamic on the web** (see [Scene wallpaper adaptation](#scene-wallpaper-adaptation)); mpkg adjustable options are read-only (apply changes in the WE app)
- **Web wallpapers are experimental**: heavy animation / external dependencies may freeze or fail (preflight tags + refresh recovery); **web wallpapers with built-in options are partly wired in — a few are still in progress**
- **Huge assets** (pure-browser mode): standalone video >600MB, video textures >250MB, images >200MB unsupported; **hybrid mode** has no such limit
- Scene static-frame / layer-composite **first extraction takes a few seconds** (longer for 8K textures); afterwards served from cache

<!-- ## Screenshots

<!-- ![Sidebar collapsed · new session](screenshots/dhsw1.jpg) -->

<!-- *The dynamic wallpaper fills the whole UI. Sidebar collapsed, chat box centered with frosted blur; the sidebar is fully transparent so the wallpaper shows through cleanly.* -->

<!-- ![Sidebar expanded](screenshots/dshw2.jpg) -->

<!-- *After adjusting panel opacity and unified blur: most UI areas are opacity-adjustable, the sidebar is semi-transparent with the wallpaper faintly visible behind.* -->

<!-- ![Settings page](screenshots/dshw3.jpg) -->

<!-- *The wallpaper settings page. Beyond the screenshot, nearly everything is adjustable: unified blur, UI blur (dialogs/panels/popups/popovers/mask/sidebar frost), lens zoom & pan, wallpaper flip, theme color, sidebar/title-bar visibility, sharpen, and scene layer compositing with time-frame switching.* -->

<!-- Wallpapers in the screenshots are by Bilibili UP【-夜莺Night】: [author page](https://b23.tv/86CyaFw) -->

-->
## Bug Reports

Please include:
- The **original .mpkg or workshop folder** (required to reproduce)
- Browser console output (F12 → Console), if any
- Your DSH version and platform (Windows / Linux / mobile)

## Security

- **No outbound network requests**: the plugin never contacts external networks; the only network activity is user-entered image URLs, resources loaded by web wallpapers themselves, and HTTP to the **local DSH host** (127.0.0.1)
- **No secrets**: no paths, keys, tokens or personal info in the source
- **Open-source deps only**: DSH's own react + official slots/locale APIs; the scene.pkg extractor is adopted from [elysia395/dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine) (MIT, credited in the file header)
- References: [dsh-bg-image](https://github.com/lyh9712/dsh-bg-image) (MIT, template), [unmpkg](https://github.com/aqnya/unmpkg) (GPL-3.0, mpkg format reference), [repkg](https://github.com/notscuffed/repkg) (GPL, .tex format research)
- Data boundary: all parsing happens locally; localStorage only stores the background and settings; settings are additionally stored at `~/.dsh-mpkg-wallpaper/settings.json`

## File Structure

```
dsh-mpkg-wallpaper/
├── package.json      # dsh.bundle + dsh.client declarations
├── cordis.patch.yml  # plugin install declaration
├── lib/
│   ├── index.js      # host: upload/streaming + Steam discovery + custom folders + scene routes + settings persistence
│   ├── client.js     # browser: mpkg parsing + settings page + bg DOM + blur suite + library + time-variation/web options
│   └── pkg-extract.js# scene.pkg static-frame/layer extraction (PKG+LZ4+TEX, MIT, from elysia395)
├── tools/            # mpkg/tex/mdl reverse-engineering tools (for developers)
├── README.md         # Chinese
└── README.en.md      # English
```

## Acknowledgements

- [Bil812](https://github.com/Bil812) — proposed wallpaper tint, adaptive text and unified full-screen mask in [PR #2](https://github.com/XHR666/dsh-mpkg-wallpaper/pull/2) and maintains a fork; those ideas were absorbed as the "Aqua" experiment mode (toggles, off by default)
- [elysia395/dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine) — the scene.pkg static-frame extractor (MIT); `lib/pkg-extract.js` is adopted from this project; its "settings persist to host file" and "Edge canvas-compat rendering" ideas are also borrowed
- [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) community — listing & promotion

## Rendering Feasibility Research

- Full scenes (incl. Live2D puppets) can only be rendered by the proprietary engine: the WE app's native library (embedded Chromium + proprietary puppet renderer); the open-source [we-layerd](https://github.com/Aromatic05/we-layerd) (Rust) bundles the official renderer but is **Linux Wayland only**
- There is no mature WE scene renderer for browsers (pixeltris/wallpaper-engine-web is gone) — **independent of OS, no browser can render Live2D scenes directly**; the official renderer .so is closed-source, so it cannot be compiled to WASM
- This plugin's path: **static-frame extraction + layer compositing + (time-variation) mpkg-way slot switching** (see [Scene wallpaper adaptation](#scene-wallpaper-adaptation)); for full dynamics use "render externally to video → video wallpaper"
