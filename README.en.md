# dsh-mpkg-wallpaper — Wallpaper Engine mpkg Background Plugin

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

[中文](README.md) | [English](README.en.md)

A plugin for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) Web UI (dsh web) that turns your background into a **feature-rich wallpaper system** — from parsing Wallpaper Engine `.mpkg` files, to a full-screen frosted blur suite, to a local wallpaper library with automatic rotation. Nearly every visual detail is adjustable.

One plugin covers the whole wallpaper chain — import, parsing, playback, rotation, appearance tuning, local management and updates: animated images, videos and time-of-day variants all play; blur/frost/float/lens/brightness are each independently adjustable; it can scan local wallpaper libraries, rotate on a timer and check for updates with one click. Install it and most interface-appearance needs are covered.

## Core Features

**📦 Multi-source backgrounds (mpkg / video / image / URL)**
- **Wallpaper Engine `.mpkg`**: parsed directly in the browser (pure client, nothing uploaded to third parties); video wallpapers play their embedded mp4 / video textures; scene wallpapers use the author's `preview.gif` animated preview; **time-of-day switching** picks the asset matching the current system time; **adjustable options (read-only)** for reference in the Wallpaper Engine app
- **Direct image/GIF import**: local image files (png/jpg/webp/gif) or **image URLs** (including data:image) as backgrounds — large files auto-stored in browser storage, GIFs loop reliably
- **Video files**: pick an mp4/webm file directly as a video background

**🌊 Full-screen frosted blur suite**
- **Unified blur (own section)**: one slider controls the wallpaper blur degree of the whole screen (0 = sharp, higher = more blurred); sidebar fog thickness, chat-area follow and new-chat button follow are adjustable independently; when on it takes over the sidebar frost and the frosted-blur slider (the title bar is NOT taken over - it follows its own frost slider, transparent by default)
- **UI blur (own section)**:
  - **Blur dialogs**: generic center-screen windows + the chat input box (frosted backdrop; text scrolling under the input box turns hazy)
  - **Blur settings panel**: the DSH settings panel with its own toggle + amount
  - **Blur download/confirm popups**: this plugin's download-confirm, conflict-detection and error popups with their own toggle + amount
  - **Blur popovers / blur mask**: menus/dropdowns/tooltips and the full-screen dim each managed separately
  - **Sidebar frost (Aqua scheme)**: the sidebar itself becomes glass (backdrop-filter blurs the wallpaper behind it); automatically lifted while a dialog is open so the blur layer cannot trap fixed popups

**🎬 Lens & appearance**
- Lens zoom (10–2000%) & pan, sidebar/title-bar wallpaper visibility toggles, light sharpen, Deep diving background box

**🚀 Hybrid large-file mode**
- On: mpkg is **streamed to the DSH host** → stored on disk → HTTP Range streaming playback, **supports files >600MB** with minimal memory
- Off: pure browser mode (600MB cap)

**🖼️ Local wallpaper library (Windows + cross-platform)**
- **Steam discovery**: auto-locates the Wallpaper Engine install (including non-default drives via registry + libraryfolders.vdf) and lists video/web wallpapers
- **Custom local wallpaper folder**: any folder can become a wallpaper library, with a built-in **cross-platform folder picker** (browse directories step by step)
- **Wallpaper switching & rotation**: one-click "Next wallpaper", or timed auto-rotation (adjustable interval)

**🛡️ Security & coexistence**
- **Conflict detection**: auto-disables itself when other wallpaper/theme plugins are detected
- **Coexists with third-party UI plugins** (DSH-better-sidebar, dsh-chat-import, dsh-sidebar-qa, …): CSS only targets DSH's native area classes, never overriding injected content
- **Security boundary**: .exe/application wallpapers fully excluded (anti-malware), custom folders read images/videos only, host routes have path-traversal guards
- Pure-client parsing stays inside the browser sandbox — malicious mpkg cannot reach the host file system

**🔄 Update check & one-click hot update**
- "Check updates" compares **actual code content hashes** (README changes do not trigger) — only real functional changes count
- New version found → "Update now": auto-downloads the latest code + version from GitHub, writes it back locally → restart dsh web to take effect


## Feature Groups

- **Background source**: master toggle, hybrid large-file mode, .mpkg file, image URL, local image/GIF, local wallpaper library (Steam discovery + custom folder + folder picker), wallpaper switching & rotation
- **Appearance**: panel opacity, frosted blur, lens zoom, lens position
- **Unified blur**: full-screen blur toggle + amount, sidebar fog thickness, chat-area follow, new-chat button follow
- **UI blur**: dialog / settings panel / download-confirm popup blur (each with its own toggle + amount), popover blur, mask blur, sidebar frost (Aqua scheme), Deep diving background box, title-bar frost/show (independent frost amount)
- **Other**: sidebar shows wallpaper, light sharpen, third-party UI radius compat (off by default), update check / one-click hot update, restore defaults


## Supported Inputs

- **Wallpaper Engine .mpkg** (PKGM0014 video / PKGM0018 scene)
- **mp4/webm video files** (picked directly)
- **Image/GIF files** (png/jpg/webp/gif, local) and **image URLs** (including data:image)
- Size limits depend on the **mode**:
  - **Hybrid mode (default on)**: mpkg is streamed to the DSH host → stored on disk → HTTP Range streaming playback. **Files >600MB are supported** (only disk space limits), with minimal memory use.
  - **Pure browser mode (hybrid off)**: whole file **>600MB** is rejected; standalone video **>600MB**, video texture **>250MB**, image/GIF **>200MB** cannot be processed (warns and falls back to the preview); IndexedDB storage quota can also be a limit.
- What you get depends on the wallpaper's content:
  - **Video wallpapers** (embedded mp4 / standalone mp4): the video plays as the background.
  - **Scene wallpapers** (Live2D etc.): uses the author's `preview.gif` (browsers cannot render WE scenes).
  - **Blue/green-screen layers**: falls back to the preview (the raw chroma-keyed footage would show blue/green).


## Limitations

- **Scene-type wallpapers** (Live2D puppet + shader + particles): the full dynamic scene can only be rendered by the Wallpaper Engine app. The browser uses the author-generated `preview.gif`, which may look soft full-screen (zoom/sharpen helps).
- **Options are read-only**: the browser shows pre-rendered assets, so editing options cannot change the picture; apply them in the Wallpaper Engine app instead.
- **Very large assets** (pure browser mode): standalone videos >600MB, video textures >250MB, images >200MB cannot be handled (warns and falls back to the preview). In **hybrid mode** large files stream through the host — no such limit.


## Screenshots

![Collapsed sidebar - new chat view](screenshots/dhsw1.jpg)

*Dynamic wallpaper fills the whole UI. With the sidebar collapsed, the chat box sits centered with a frosted blur; the sidebar is fully transparent so the wallpaper shows through cleanly.*

![Expanded sidebar](screenshots/dshw2.jpg)

*The effect after adjusting the **Panel opacity** and **Unified blur** sliders (as shown): opacity of most areas is adjustable, the sidebar is translucent and the wallpaper shows through faintly behind it.*

![Settings page](screenshots/dshw3.jpg)

*The settings page. Beyond this screenshot, nearly every appearance aspect is adjustable: unified full-screen blur (one slider controls wallpaper blur degree), dialog / popover / mask blur, lens zoom & pan, sidebar / title-bar wallpaper visibility, title-bar frost amount, sharpen, and time-of-day switching for wallpapers that ship multiple time variants.*

The wallpapers in the screenshots are works by Bilibili creator -夜莺Night: [author homepage](https://b23.tv/86CyaFw).


## Usage

Settings → **Wallpaper Engine Background**:

| Control | Description |
|---|---|
| Choose .mpkg | Uses preview.gif (or time-matched asset) as the dynamic background; you can also pick an mp4/webm file directly |
| Hybrid large-file mode | On: supports >600MB (streamed to host); Off: pure browser mode (600MB cap) |
| Adjustable options | The wallpaper's own parameters and current values (read-only, for reference in the Wallpaper Engine app) |
| Image URL / local image | Plain images or GIFs |
| Panel opacity | 50–100% |
| Frosted blur | How blurred the wallpaper itself is, 0–40px (0 = sharp) |
| Unified blur (own section) | One slider controls the whole screen's wallpaper blur degree (0=sharp, higher=more blurred); sidebar fog thickness, chat-area follow and new-chat follow adjustable; takes over sidebar frost and the frosted-blur slider when on (title bar keeps its own frost slider) |
| Dialog / settings panel / confirm popup / popover / mask blur | Each with its own toggle + amount slider; sidebar frost (Aqua scheme, auto-lifted while a dialog is open) |
| Lens zoom / position | Zoom (10–2000%) and pan the background; zoom out to see components at the picture edges |
| Sidebar / title-bar wallpaper | Toggles; off = solid opaque color for that area; title-bar frost amount adjustable independently |
| Local wallpaper library | Steam discovery (Windows) + custom folder (any folder + folder picker) |
| Wallpaper switching & rotation | "Next wallpaper" one-click switch; timed auto-rotation (adjustable interval) |
| Light sharpen | Improves low-res look; turn off if GIFs stutter |


## Install

The plugin is published on npm (`dsh-mpkg-wallpaper`). Pick one:

### Option 1: dsh plugin add (recommended, market-recognized)

```bash
dsh plugin --profile web add dsh-mpkg-wallpaper
# restart dsh web, then hard-refresh the browser (Ctrl+F5)
```

Installs from the official npm registry and writes into the profile's `package.json`
dependencies — the plugin market recognizes it as installed, shows the download count,
and can manage updates.

### Option 2: pnpm manual install (pnpm-workspace profile)

```bash
# run in the profile directory (replace <profile> with your profile name, e.g. web)
pnpm --dir $DSH_HOME/profiles/<profile> add dsh-mpkg-wallpaper
# restart dsh web, then Ctrl+F5 in the browser
```

Also writes into the dependency table, so the market recognizes it. No pnpm available?
Use Option 1 (`dsh plugin add` wraps pnpm).

### Option 3: Git clone (developers / offline)

```bash
git clone https://github.com/XHR666/dsh-mpkg-wallpaper.git $DSH_HOME/profiles/node_modules/dsh-mpkg-wallpaper
# then register in the profile's cordis.patch.yml:
#   - insert:
#       - id: dsh-mpkg-wallpaper
#         name: dsh-mpkg-wallpaper
# restart to take effect
```

> Note: Option 3 is a manual placement and is **not** recorded in the dependency table —
> the market won't report it as installed (market display only; the wallpaper feature is
> unaffected). For market recognition use Option 1/2, and remove the old manual copy (the
> `cordis.patch.yml` insert line + plugin directory) to avoid double-loading the plugin.

Uninstall: `dsh plugin --profile web remove dsh-mpkg-wallpaper`.


## Official Docs

Wallpaper Engine's official help site ([help.wallpaperengine.io](https://help.wallpaperengine.io)) has a mobile section (pairing with Windows, etc.); the mpkg container format is proprietary and undocumented.


## Reporting Bugs

When reporting a bug, please attach:
- The **original .mpkg source file** (required to reproduce the issue),
- Browser console output (F12 → Console), if any,
- Your DSH version and platform (Windows / Linux / mobile).


## Security

- **No external network requests**: the plugin never contacts external networks; the only network behavior is: ① the browser loading an image URL the user typed manually; ② in hybrid mode, HTTP communication with the **local DSH host** (127.0.0.1) for uploading mpkg / streaming wallpapers — never through any third party
- **No sensitive content**: no paths, keys, tokens or personal info in the source
- **No third-party closed source**: depends only on DSH's bundled react and the official slots/locale interfaces
- Reference projects (all open source): [dsh-bg-image](https://github.com/lyh9712/dsh-bg-image) (MIT, template), [unmpkg](https://github.com/aqnya/unmpkg) (GPL-3.0, mpkg binary format only), [repkg](https://github.com/notscuffed/repkg) (GPL, .tex format research), [astc-encoder](https://github.com/ARM-software/astc-encoder) (Apache-2.0, local decode experiments)
- Data boundary: all parsing happens locally in the browser; localStorage only stores background data URLs and option edits


## File Layout

```
dsh-mpkg-wallpaper/
├── package.json      # dsh.bundle + dsh.client manifests
├── cordis.patch.yml  # plugin install declaration (for dsh plugin add)
├── lib/
│   ├── index.js      # host side: large-file upload/streaming + Steam discovery + custom folders
│   └── client.js     # browser side: mpkg parser + settings page + background DOM + blur system + wallpaper library
├── tools/            # mpkg/tex/mdl reverse-engineering tools (for developers)
├── README.md         # 中文说明
└── README.en.md      # this file (English)
```


## Notes for Distribution

### Portability

- No absolute paths, no local ports, no environment-specific config; only DSH's bundled react and the official slots/locale interfaces
- **Custom nav icon**: replace the `NAV_ICON` constant in `lib/client.js` (default: a hand-drawn "landscape" SVG, no trademark) with your own icon (20×20, SVG data URL or base64 PNG recommended)

### Reverse-Engineering Tools (tools/)

| Tool | Purpose |
|---|---|
| `unmpkg.py` | mpkg container parser/extractor (PKGM0014/0018) |
| `tex2png.py` | TEXV0005 texture decoder (DXT5/R8, etc.) |
| `mdl_explorer.py` | .mdl structure explorer (block tags/meshes/float sections) |
| `xref.py` | wallpaper64.exe string xref + disassembly (capstone) |
| `MDL-格式分析笔记.md` | .mdl format reverse-engineering notes (container/mesh solved, skeleton = JSON, animation WIP) |

### Wallpaper Format Research Summary (for other developers)

- **mpkg**: PKGM0014 (video type: mp4+gif+json) / PKGM0018 (scene type: scene.json+tex+mdl+shader)
- **tex**: TEXV0005; format 5 = DXT family, format 34 = embedded MP4 video texture (the 4K animation of customize wallpapers lives right in there)
- **mdl**: MDLV00xx block container; mesh = 8 floats/vertex; MDLS0003/0004 contain JSON skeleton poses; MDLA = animation

## Scene Rendering Feasibility

- Full scenes (Live2D puppets) can only be rendered by proprietary runtimes: the Wallpaper Engine app's native `libscenejni.so` (40 MB, embedded Chromium + proprietary puppet renderer). The open-source [we-layerd](https://github.com/Aromatic05/we-layerd) (Rust) bundles the official renderer but is **Linux Wayland only** (GNOME / niri / Hyprland / KDE Plasma) — it does not run on Windows or inside Termux proot.
- There is no mature WE scene renderer for browsers ([wallgl](https://github.com/lucaschnabel42/wallgl) is a prototype without puppet support; pixeltris/wallpaper-engine-web is gone) — **regardless of OS, no browser can render Live2D scenes directly**.
- **Cross-platform path**: render externally into a video, then use the plugin's **video background** (MP4/WebM stored in IndexedDB, played in a looping `<video>`):
  - **Windows**: the official Wallpaper Engine (Steam, native full-scene rendering) or the open-source [Lively Wallpaper](https://github.com/rocksdanister/lively) (video/web/app wallpapers; does not parse WE scene format) → screen-record to mp4
  - **Linux desktop**: render with we-layerd → screen-record
  - **Mobile**: screen-record in the Wallpaper Engine app
- The plugin behaves identically on every platform (Windows/Linux/macOS/mobile): preview.gif, embedded video textures and time-of-day switching all work.

