# dsh-mpkg-wallpaper

**Bring Wallpaper Engine wallpaper into the DeepSeek Harness Web UI.**

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)
[![npm](https://img.shields.io/npm/v/dsh-mpkg-wallpaper)](https://www.npmjs.com/package/dsh-mpkg-wallpaper)
[![license](https://img.shields.io/badge/license-MIT%20%2B%20GPL--3.0--or--later-blue)](#license)

[中文](README.md) | [English](README.en.md)

dsh-mpkg-wallpaper is a wallpaper and UI-appearance plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh web`). It parses Wallpaper Engine `.mpkg` files, Steam Workshop folders and video / web / scene wallpapers, and adds a full-screen blur system, transparent surfaces, theme colours, a **Floating Island layout (floating cards)**, Now Playing, a wallpaper library and scheduled rotation.

> **What makes it different**: it is not just a background image switch. It turns background, blur, transparency, floating cards and theme colours into one adjustable, restorable and diagnosable appearance system.

---

## Contents

- [Highlight: Floating Island](#highlight-floating-island)
- [Features](#features)
- [Install](#install)
- [Quick start](#quick-start)
- [Wallpaper sources and types](#wallpaper-sources-and-types)
- [Appearance system](#appearance-system)
- [Playback, library and Now Playing](#playback-library-and-now-playing)
- [Where the settings are](#where-the-settings-are)
- [Security and privacy](#security-and-privacy)
- [Compatibility and limits](#compatibility-and-limits)
- [Troubleshooting](#troubleshooting)
- [Development and gates](#development-and-gates)
- [File structure](#file-structure)
- [License](#license)
- [Feedback](#feedback)

---

## Highlight: Floating Island

**Floating Island (also called Floating Cards)** is the most recognisable UI feature of this plugin. It is enabled with **Appearance → Floating effect** (`float`).

When enabled:

- the left sidebar and title bar become **rounded floating cards with shadows, revealing the wallpaper behind them**;
- the wallpaper stays visible between and around the cards, creating an "island floating on the desktop" layering effect;
- it composes with full-screen blur, sidebar/title-bar opacity, theme colours and the mouse glow;
- turning it off restores the edge-to-edge layout without affecting the other transparency/blur settings;
- the floating geometry, the Now Playing card and the right-sidebar yield/expand logic are all covered by their own checks and recalibrated on window resize.

> The most "island-like" look: enable Floating effect, lower the full-screen blur enough to let the wallpaper texture show through, and give the sidebar/title bar a suitable opacity.

---

## Features

| Feature | Description |
|---|---|
| **Wallpaper Engine `.mpkg`** | Parse containers in the browser: video wallpapers play embedded video, scene wallpapers use a static frame/layer composition, and WE Time Variation is supported |
| **Steam Workshop** | Auto-discover Wallpaper Engine and `steamapps/workshop/content/431960`; each subfolder is a wallpaper |
| **Video / image / web** | Local video, images, animated images, URLs, and HTML wallpapers in a sandboxed iframe |
| **Floating Island** | Sidebar and title bar become rounded floating cards; combines with blur, shadow, transparency and theme colours |
| **Blur system** | One full-screen slider plus independent blur/transparency for the title bar, sidebars, dialogs, menus and masks |
| **Theme and glass** | Colour picker, accent colour, Aqua experiments, CSS liquid glass; all off by default, so stock DSH stays untouched |
| **Playback & power saving** | Play/pause; auto-pause on tab switch, window blur and battery power (configurable) |
| **Library & rotation** | Local folders, WE playlists, previous/next, 1–120 minute scheduled rotation |
| **Now Playing** | Sidebar player: wallpaper track list, play/pause, volume/seek, system media session (MPRIS/SMTC) |
| **Scan wallpapers** | First item of the right-sidebar **Wallpaper** tab: thumbnail grid of the current folder, then apply |
| **Diagnostics & error log** | One-click environment/render/settings snapshot; per-block error log with sanitized/full export; never uploaded automatically |
| **Hybrid mode** | `.mpkg` files are streamed to the DSH host and played over HTTP Range, so >600 MB files do not have to fit in memory |

---

## Install

Requirements: a working `dsh web`; Node.js ≥ 20.

### Option 1: `dsh plugin add` (recommended)

```bash
dsh plugin --profile web add dsh-mpkg-wallpaper
# restart dsh web, then press Ctrl+F5 in the browser
```

### Option 2: pnpm

```bash
pnpm --dir "$DSH_HOME/profiles/web" add dsh-mpkg-wallpaper
# restart dsh web, then Ctrl+F5
```

### Option 3: clone from GitHub (developers / offline)

```bash
git clone https://github.com/XHR666/dsh-mpkg-wallpaper.git \
  "$DSH_HOME/profiles/web/node_modules/dsh-mpkg-wallpaper"
```

Then register it in `$DSH_HOME/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-mpkg-wallpaper
      name: dsh-mpkg-wallpaper
```

Restart `dsh web`. This method does not write the dependency table, so the market may not show "installed"; functionality is unaffected.

### Option 4: single-file bundle (offline / emergency; host side only)

```bash
node tools/build-bundle.mjs
node tools/build-bundle.mjs --check
node tools/bundle-equivalence-test.mjs
```

Copy `dist/dsh-mpkg-wallpaper.bundle.mjs` anywhere and register its **absolute path** in `cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-mpkg-wallpaper
      name: /absolute/path/dsh-mpkg-wallpaper.bundle.mjs
```

The single-file bundle contains the **host side only** (upload/Range/settings/diagnostics routes). The full client UI (settings panel, wallpaper layer, Floating Island, Now Playing) requires the full npm package. One-click update is not recommended in this mode.

### Update

```bash
# Option 1 / 2
dsh plugin --profile web update dsh-mpkg-wallpaper

# Option 3
git -C "$DSH_HOME/profiles/web/node_modules/dsh-mpkg-wallpaper" pull

# Option 4
node tools/build-bundle.mjs   # rebuild and replace the .mjs
```

After updating: restart `dsh web` → `Ctrl+F5`.

### Uninstall and residual data

```bash
dsh plugin --profile web remove dsh-mpkg-wallpaper
```

Optional cleanup:

- browser `localStorage['dsh.mpkg-wallpaper.v2']`;
- main data directory `$DSH_HOME/.dsh-mpkg-wallpaper/` (`settings.json`, uploaded `.mpkg` files, transcode cache, `web-store.json`, etc.);
- diagnostics/thumbnails `~/.dsh/.dsh-mpkg-wallpaper/` (`diag-*.json`, `thumbs/`).

> The `desktop` profile of DSH Desktop is owned by the Electron shell and rejects `dsh plugin --profile desktop add`. Use the desktop app's plugin UI, or put the package into that profile's dependency tree and keep the `cordis.patch.yml` mount line.

---

## Quick start

1. Install, restart `dsh web`, hard-refresh the browser. A saved wallpaper is applied as soon as the page opens; opening settings is not required.
2. Two entries read and write the same settings:
   - right sidebar **Wallpaper** (includes **Scan wallpapers**);
   - left sidebar **Settings → DSH Wallpaper Engine** (no scan page).
3. In **Background source**, choose any source:
   - drop an `.mpkg`;
   - pick a local image/video;
   - enter an image or web URL;
   - choose a custom folder (you can select Steam's `steamapps/workshop/content/431960`).
4. To change the look, start with:
   - **Wallpaper settings → blur**;
   - **Unified appearance → full-screen blur**;
   - **Appearance → Floating effect**.

If something breaks, open **Other → View error log** or click **One-click diagnostics**, then attach the result to your report.

---

## Wallpaper sources and types

| Source | What is supported |
|---|---|
| `.mpkg` container | Video, scene (static frame/layer composition), Time Variation assets, embedded audio |
| Steam Workshop | Video / web / scene wallpapers under `steamapps/workshop/content/431960`; non-default Steam libraries supported |
| Local folder | `.mpkg`, Workshop subfolders, images, videos and `scene.pkg` can be mixed |
| Image / animation | Local file or URL (including `data:image`) |
| Video | `.mp4 / .webm / .mov / .m4v` |
| Web wallpaper | HTML runs in a sandboxed iframe; configurable web options and interaction |
| Scene wallpaper | Rendered by the bundled WEwebLoader renderer in an iframe; static fallback and no-WebGL degradation |

### Time Variation wallpapers

Recognises WE's `morningtime / daytime / dusktime / nighttime / timevarying` attributes:

- automatically picks the slot for the current local time;
- lazily loads only the current slot, not all slots at once;
- lets you lock a slot manually, and return to automatic mode;
- clears the previous wallpaper's slot cache when switching, avoiding cross-wallpaper leakage.

### Hybrid mode

Enabled by default: `.mpkg` files are streamed to the DSH host via Range upload and stored on disk, then read on demand during playback — the whole container is **not** loaded into memory. Disabling it returns to browser-only parsing (limited by browser memory).

---

## Appearance system

### 1. Floating Island

- Location: **Appearance → Floating effect** (off by default).
- Turns the left sidebar and title bar into rounded floating cards with shadows, revealing the wallpaper.
- Composes with sidebar/title-bar opacity, full-screen blur, theme colours and the mouse glow.
- Turning it off restores the edge-to-edge layout; existing transparency/blur settings are untouched.

### 2. Full-screen blur and transparency

- **Unified blur**: one slider controls wallpaper blur and the sidebar/title-bar white haze together; whether the chat area and new-session button follow is configurable.
- **Independent blur**: dialogs, settings, confirmation dialogs, menus/popovers, masks and the left sidebar each have their own switch and amount.
- **Surface transparency**: left sidebar, title bar and right sidebar/dock can reveal the wallpaper independently.

### 3. Theme colours, Aqua and glass

- Theme colour and brand accent colour are configurable separately.
- Aqua experiments (auto colour sampling from the wallpaper, text readability enhancement, task-list frost, etc.) are all off by default.
- CSS liquid glass can be applied to the composer, left sidebar and title bar; it does not need the WebGL runtime.

### 4. Mouse glow

A soft glow follows the pointer inside the panel under it. Turning it off stops the listener and writes no state. It is linked to the Floating effect and does nothing when floating is off.

---

## Playback, library and Now Playing

### Playback and power saving

- Video/web wallpapers can be paused/resumed; the state follows the real media element;
- power-saving policies: pause on tab switch, window blur and battery power (separately configurable); resume according to the previous state;
- changing appearance settings does not restart the playing wallpaper.

### Library and rotation

- Scan wallpapers from Steam Workshop or a custom folder;
- import a WE playlist as the rotation list;
- previous/next switching; scheduled rotation every 1–120 minutes;
- checking list items does not scroll the list back to the top.

### Now Playing

- Mounts a player card above the left sidebar's Settings entry (on by default);
- plays the wallpaper's audio track list, with play/pause, volume and seek;
- integrates with the system media session (MPRIS / SMTC) when the host supports it;
- automatically yields when another plugin already occupies the same sidebar slot.

### Scan wallpapers

This is the first item of the right-sidebar **Wallpaper** tab. The grid mounts one screen at a time, thumbnail loads are capped, and off-screen cells drop their decoded frames. Previews are loaded separately from the wallpaper itself. The list, the error log and the tab body each keep their own scroll position, so scrolling to the end does not jump back to the top.

---

## Where the settings are

Two entries, one settings file:

- Right sidebar **Wallpaper**: all 8 rows below, with **Scan wallpapers** first.
- Left sidebar **Settings → DSH Wallpaper Engine**: the same rows except **Scan wallpapers**.

| Tab | What is there |
|---|---|
| Scan wallpapers | Wallpaper tab only. Grid of the current folder, select, apply |
| Background source | Master switch, hybrid, current wallpaper, file/folder/URL pickers, preset export/import |
| Wallpaper | Blur, zoom/offset, flip, brightness, playback speed, pause/refresh |
| Appearance | **Floating effect**, mouse glow, theme colour, corner radius, grey text, liquid glass |
| Surface unify | Full-screen blur, whether chat/new-session follow |
| UI blur | Independent blur for dialogs/settings/popovers/masks/sidebar |
| Other | Power saving, Now Playing, library/rotation, error log, diagnostics, reset to defaults |
| Liquid Glass (test) | Renderer source, diagnostics parameters, compatibility switches, developer options |

Advanced URL switches, renderer diagnostics and environment variables are documented under [`docs/`](docs/).

---

## Security and privacy

- Wallpaper parsing, transcoding and storage happen locally; **nothing is uploaded automatically**.
- Web wallpapers run in a sandboxed iframe by default; parent and frame communicate only through `postMessage`, with allow-listed operations and origin validation.
- Image/web URLs are restricted to allowed protocols/targets; scene renderer URLs accept only loopback/same-host/explicit allow-listed origins, and refused targets fall back with a ledger entry.
- Custom folders reject path traversal, absolute paths and sensitive directories; `/raw` serves only registered container entries.
- System media commands are passed as argv arrays, never through a shell.
- Diagnostics and error logs stay local. Exports support **sanitized** and **full** modes.

---

## Compatibility and limits

- **Browsers**: Chrome / Edge (recommended), Firefox. Environments without WebGL 2 fall back to a static frame with an explicit message.
- **DSH Mobile**: the mobile shell's sidebar drawer, blur strength and slow first-frame path are adapted; desktop behaviour stays unchanged.
- **DSH Desktop**: can be installed through the desktop profile; if the host page is `file://`, the client resolves `http://dsh.internal` following DSH's convention.
- **Windows**: auto-discovers Wallpaper Engine and Steam libraries. Other OSes can point at the Workshop folder manually.
- **Not supported**: `.exe` / non-media files as wallpapers; exact parity for every WE scene effect; unlimited web-wallpaper interaction (browser sandbox limits apply); downloading paid Wallpaper Engine assets.

---

## Troubleshooting

1. **No wallpaper**: check the master switch and the selected source. A fresh browser reads the short wallpaper address back from the local host settings file. An empty address leaves a blank background and is not written to the error log. Restart `dsh web`, then `Ctrl+F5`.
2. **Scene wallpaper is black/static**: on **Liquid Glass (test) → Renderer source**, confirm the bundled renderer is selected. Environments without WebGL 2 show a static-frame notice.
3. **Floating Island does nothing**: make sure **Appearance → Floating effect** is on; narrow windows/mobile layouts may switch automatically and recalibrate when the width is restored.
4. **A narrow viewport sidebar looks too transparent**: quit and reopen the client so the plugin bundle reloads. If it persists, attach the DSH version and the Chromium version.
5. **Exporting logs**: each error block has **Export sanitized log** and **Export full log** on its right; the footer has Clear log and Close.

More: DIAGNOSTICS, WALLPAPER-LIFECYCLE, WEB-WALLPAPER and NOW-PLAYING-DSH under `docs/`.

---

## Development and gates

```bash
# quick checks
node tools/integrity-check.mjs
node tools/secret-scan-test.mjs
node tools/style-scope-guard.mjs

# full 12-step gate (some steps need headless Firefox / local :3080)
bash tools/check.sh
```

Build notes:

- `lib/client.js` is the single client file served by the host; `lib/now-playing.js`, `lib/now-playing-math.js` and `lib/audio-bus.js` are inlined by build scripts into generated regions — do not hand-edit those regions;
- `renderer/**` is the bundled scene renderer (GPL-3.0-or-later); the plugin talks to it only over iframe + postMessage and never imports its source;
- `dist/`, `tools/` and `docs/` do not enter the npm package.

---

## File structure

```text
dsh-mpkg-wallpaper/
├── package.json          # npm metadata + dsh plugin declaration + files allow-list
├── cordis.patch.yml      # dsh install declaration
├── LICENSE               # MIT (plugin body)
├── LICENSE-render        # GPLv3 (renderer/**)
├── NOTICE                # dual-license scope / attribution / modification notices
├── LICENSES/             # MIT.txt, GPL-3.0-or-later.txt
├── lib/                  # host + client (client.js is served as one file)
├── renderer/             # bundled WEwebLoader scene renderer (GPL-3.0-or-later)
├── tools/                # gates/tests/build scripts (not published)
├── docs/                 # engineering and operations docs (not published)
└── dist/                 # single-file bundle output (not committed)
```

---

## License

This repository contains two independently licensed parts:

| Part | License | Full text |
|---|---|---|
| Plugin body `lib/**`, icon, README, NOTICE, THIRD-PARTY, etc. | **MIT** | [`LICENSE`](LICENSE), [`LICENSES/MIT.txt`](LICENSES/MIT.txt) |
| Bundled renderer `renderer/**` | **GPL-3.0-or-later** | [`LICENSE-render`](LICENSE-render), [`renderer/LICENSE`](renderer/LICENSE), [`LICENSES/GPL-3.0-or-later.txt`](LICENSES/GPL-3.0-or-later.txt) |

Directory boundaries, redistribution notes and the GPLv3 §5a modification notice are in [`NOTICE`](NOTICE). Third-party attribution is in [`THIRD-PARTY.md`](THIRD-PARTY.md) and [`renderer/THIRD-PARTY.md`](renderer/THIRD-PARTY.md).

The `license` field in `package.json` is `SEE LICENSE IN NOTICE`.

---

## Feedback

Please include:

1. the original `.mpkg` or Workshop folder (enough to reproduce);
2. one **Other → One-click diagnostics** result;
3. browser console errors;
4. DSH version, OS and browser/client environment.

Repository: <https://github.com/XHR666/dsh-mpkg-wallpaper>
npm: <https://www.npmjs.com/package/dsh-mpkg-wallpaper>
