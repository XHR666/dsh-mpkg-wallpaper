# WEwebLoader (browser-side Wallpaper Engine wallpaper renderer)

[中文](README.md) | **[English](README.en.md)**

**Render Wallpaper Engine scene wallpapers in the browser, live** (`scene.pkg` / this repository's `.mpkg` container / a Workshop source folder) —
no Wallpaper Engine, no Windows, no GPU-specific driver required: a local Node static server plus a WebGL2-capable browser is all it takes.

- Published on npm: [wallpaper-engine-web-loader@0.5.19](https://www.npmjs.com/package/wallpaper-engine-web-loader)
- [Online demo](https://xhr666.github.io/wallpaper-engine-web-loader/)
- Navigation: [Quick start](#1-quick-start) | [Main features](#2-main-features-what-is-supported--what-is-not) | [Loading a wallpaper](#3-loading-a-wallpaper) | [Development and testing](#6-development-and-testing) | [Known limitations](#7-known-limitations) | [FAQ](#8-faq) | [Licence & disclaimer](#10-licence--disclaimer)

**Search aliases**: **WEwebLoader** · WE Web Loader · we-web-loader ·
wallpaper-engine-web-loader · WE 场景壁纸网页渲染器 · 壁纸引擎网页渲染器 — any of these should find this repository;
the npm package name and the repository name stay **unchanged** (`wallpaper-engine-web-loader`), and the online demo is at
<https://xhr666.github.io/wallpaper-engine-web-loader/>.

> **Naming note (2026-09-19)**: this project has two names
> - **WEwebLoader**
> - the npm package name and the repository name are still **`wallpaper-engine-web-loader`**

> **Licence notice for the reference sources**: `wer-ref/` (`Aromatic05/wallpaper-engine-renderer`, a fork of `catsout/wallpaper-scene-renderer`, **GPL-2.0-only**) and
> `we-layerd-ref/` (`Aromatic05/we-layerd`, **no licence**) are both **third-party reference implementations outside this repository**; they are not official WE code and not a "source of truth".
> They are used **for behavioural comparison only**: **no copying, rewriting or line-by-line translation of their code, comments, constant organisation or error strings**. The lineage self-audit is recorded in the **workspace-internal document**
> `<workspace>/docs/reverse/WER-REF-LICENSE-AUDIT.md` (**not distributed with this repository**, hence not in it).

**This file is the main README (shown on the GitHub home page), aimed at "getting it running for the first time" and "what is supported now".**
For downloader-facing instructions see `docs/README-PUBLIC.md`; for third-party code and licences the **legal text is governed by `THIRD-PARTY.md`**,
and the copying/borrowing ledger is `docs/COPYING-RULES.md`; the master layer-by-layer flag table is `docs/README-DIAGNOSTICS.md`; tests are in `docs/TESTING.md`;
architecture is in `docs/RENDERER-ARCHITECTURE.md`; real-machine baseline snapshots (FPS/startup/switch-timing trends, `?baseline=1` + the `tools/baseline-diff.mjs` regression gate) are in `docs/BASELINE.md`; per-round records are in `docs/PATCHES.md`.

---

## 1. Quick start

Four routes — pick by what you want to do; every command can be copied as-is:

| I want to… | Take this route | What you need |
|---|---|---|
| See a wallpaper right now | **A. The bundled server** | Node ≥ 20 |
| Static hosting only / deploy to Pages | **B. Static site (read-only)** | Node ≥ 20 (at build time) |
| Embed the renderer in my own site / app | **C. npm dependency** | your own build chain |
| Change renderer code / run the gates | **D. Run from source** | Node ≥ 20 (+ optional `npm install`) |

### A. With the bundled server (recommended, most complete)
```bash
git clone https://github.com/XHR666/wallpaper-engine-web-loader.git
cd wallpaper-engine-web-loader
bash start-demo.sh                     # preflight + start the server (default 8899); equivalent: node server/we-scene-demo-server.mjs
# open http://127.0.0.1:8899/ in the browser
```
- Change the port: `PORT=9000 bash start-demo.sh` (or `bash start-demo.sh --port 9000`); preflight only, without starting the server: `bash start-demo.sh --check`; open the browser automatically once it is up: `--open`.
- **Read this on the first run**: when this machine has no corpus (this repository **distributes** no real wallpapers), the page **says so explicitly** and renders the bundled synthetic sample automatically;
  you can also open `http://127.0.0.1:8899/?id=sample-synthetic` directly.
- The bundled server provides: package/folder reading, `/report` report persistence, the `/weassist` WE-asset fallback, CORS (for iframe embedding) and
  offline PWA (`web/manifest.webmanifest` + `web/sw.js`, whose **cache predicate explicitly excludes user wallpapers** — see `tests/pwa-test.mjs`).
- Want the "**bench page with a backend**" (wallpaper library list / property saving / deletion / renderer diagnostic stream all working)? That is **another** server —
  `node server/we-scene-demo-server-8902.mjs` ⇒ open `http://127.0.0.1:8902/` (one origin serving the `demo/` static surface +
  the **≥17** `/api/*` routes the bench needs + the renderer iframe page + the `/media/dev` media surface + the `/diag` diagnostic stream; see `docs/BENCH-8902.md`).

### B. Any static server (read-only mode)
```bash
node build-pages.mjs                   # zero dependencies, no network: builds a static site into ./_site (whitelist + privacy gate + required-file self-check)
python3 -m http.server 8899 -d _site   # or npx serve _site
# open http://127.0.0.1:8899/demo.html?id=sample-synthetic in the browser
```
- The online version is exactly this shape: <https://xhr666.github.io/wallpaper-engine-web-loader/> (build script `build-pages.mjs`, CI in `.github/workflows/pages.yml`).
- **The price of read-only mode**: no server endpoints ⇒ the package proxy, `/report` persistence, the WE-asset fallback and folder packing (`/pkgdir`) are all unavailable;
  you can only use packages the **browser can fetch directly** (the bundled sample, or a `scene.pkg` same-origin with the page).
- **The PWA is optional**: off by default; only the **bundled server** with `MPW_PWA=1` injects it (`MPW_PWA=1 bash start-demo.sh`, or `?pwa=1` on a single request).
  Static hosting does not gain offline capability automatically.
- You can also use only the `npm pack` artefacts (unpacked, they are a directory you can host statically):
```bash
npm pack wallpaper-engine-web-loader@0.5.19       # produces wallpaper-engine-web-loader-0.5.19.tgz
tar -xzf wallpaper-engine-web-loader-0.5.19.tgz   # unpacks to package/ (containing demo.html / elysia/ / samples/ etc.)
```

### C. npm install (embed the renderer as a dependency in your own site/app)
```bash
npm i wallpaper-engine-web-loader@0.5.19     # pin the published version; or npm i wallpaper-engine-web-loader to follow latest
```
Minimal usage (all three entry points — `parsePkg` / `parseScene` / `mount` — have been measured working):
```js
import fs from 'node:fs'
import { mount, parseScene } from 'wallpaper-engine-web-loader'         // library entry = core/we-scene.mjs
import { parsePkg, getEntry } from 'wallpaper-engine-web-loader/bundle' // low-level parsing = core/we-scene-bundle.js

const pkg       = parsePkg(new Uint8Array(fs.readFileSync('scene.pkg')))
const sceneJson = JSON.parse(new TextDecoder().decode(getEntry(pkg, 'scene.json')))
const project   = JSON.parse(fs.readFileSync('project.json', 'utf8'))   // pass null if there is no properties table
const scene     = parseScene(sceneJson, project, {})

// mounting in the browser (mount needs requestAnimationFrame; in Node the host injects opts.raf)
const h = mount('#stage', { scene, textures /* Map<name, {glTex}>, same shape as demo.html */ })
h.setQuality({ q: 'high', aa: 'fxaa', pp: 'high' })   // hot-updates, no remount needed
h.dispose()
```
- `mount`'s responsibility boundary is **only** "canvas + frame loop + end-of-frame post-processing chain": **package fetching / unpacking / texture upload / fonts / audio / reporting / UI panels** all belong to the host side
  (the full reference implementation is `demo.html`'s `bootInstance()`, whose frame order matches `mount` item for item).
- Returned handle fields: `{ canvas, renderer, scene, running, frameCount, start, stop, dispose, resize, setQuality, getQuality, setScene, setTextures }`.
- Other subpath exports: `wallpaper-engine-web-loader/server` (the bundled server), `/hlsl2glsl` (the vendored MIT translator).

### D. Run straight from source (recommended locally / for development)
```bash
bash start-demo.sh                    # preflight + start the server (default 8899)
npm install                           # optional: only with typescript installed does the `types-check` item really run (without it that item SKIPs — it does not pretend to pass)
bash check.sh                         # the single entry point for release/self-check
```
- **The bundled server needs no external repository**: container parsing is provided by this repository's **own** `pkg-parse.mjs` (MIT, a thin wrapper over `packages/we-core/src/pkg.js` ✓, which also exports `parsePkg`/`readPkgEntry` ✓) ⇒ \1 (if the sibling plugin is installed, its **fuller** parser is preferred — it provides `parsePkgIndex`, the directory-table fast path; otherwise the bundled one is used)
  Only when you need **scene/texture extraction** (`extractScene*` / `extractTex*`, which live in the sister plugin) do you point at it with `MPW_PKG_EXTRACT=/absolute/path/pkg-extract.js` ✓ (optional, not required).
  Historical note: the old README used to require putting the MIT plugin in the same parent directory —
  **that requirement is void** ✗: `start-demo.sh`'s preflight now hits this repository's own `pkg-parse.mjs` at the repo root ✓.
- Keep real wallpapers **outside** the repository and point at them with `MPW_SCENE_ROOT` / `?pkgpath=` / `?pkgurl=` (see §3/§4).
- Layer-by-layer debugging `/?ln=1`; diagnostic pages `/diag` and `/probe`; in-page self-check `/?selfcheck=1`.

### Environment requirements and the "is it installed?" self-check
- **Node ≥ 20** (`package.json`'s `engines.node` = `>=20`; the scripts use `??`, optional chaining, top-level await and `node:`-prefixed builtins; **ESM only**, no CJS entry).
- The browser side needs **WebGL2** (without a GPU it falls back to the CPU path, markedly slower).
- The self-check is the `bash check.sh` from §6: it is the **single entry point** and answers "can this be released right now?" in one command.

---

## 2. Main features (what is supported / what is not)

### Supported inputs
- **`scene.pkg`** (a WE scene package), this project's **`.mpkg` container**, and **Workshop source folders** (the server packs a folder into a container on the fly and feeds that to the renderer).
- Three ways to point at one: `?id=<folder name>`, `?pkgpath=<absolute path inside the whitelist>`, `?pkgurl=<URL>` (the server fetches it as a proxy, bypassing CORS). See §3.

### What the render pipeline already has (layered by responsibility)
- **Container and asset parsing**: PKG container read/write (`tools/pkg-patch.mjs` can edit `scene.json` and repack, for controlled A/B),
  TEX texture decoding (`TEXV0005` + `TEXI0001` + `TEXB0001~0004` containers), MDL meshes, the `project.json` lookup chain (`core/scene-project-json.mjs`).
- **Scene composition**: image layers and composition containers, attachment-anchor transforms (`core/attach-transform.mjs`),
  skinning (`core/puppet-skin.js`), animation (`core/we-animation.mjs`), CFF text and the open-licensed fonts distributed with the repository (`assets/fonts/`).
- **Particles**: the particle system and its operators (`sphererandom` / `vortex` / `turbulence` / `controlpointattract` / `sizechange` / `alphachange` …),
  pointer interaction (`core/we-particle-pointer.mjs` / `core/we-pointer-source.mjs`).
- **Effect chain**: blur / clouds / water ripples / god rays / depth-of-field parallax and more (`elysia/we-renderer/effects/**`);
  the HLSL→GLSL translator `vendor/hlsl2glsl/` (**vendored byte-for-byte**, MIT).
- **Scripts**: the scene-script runtime (`elysia/scene-scripts.js`) + the WE API shim (`core/we-web-shim.mjs`).
- **Audio**: sound-layer manifests and playback, the frequency-band array (`core/audio-band-array.mjs`). Audio is **not distributed with the repository**: when you load a package containing audio, the page **parses it locally on your machine**.
- **Video**: embedded mp4 / video textures.
- **Picture control**: the quality tiers `?q` / `?aa` / `?pp` and `setQuality()` hot-updating; display options (mirror / brightness / contrast / saturation / hue);
  frame geometry `legacy|cover` (`core/web-frame-geometry.mjs`); pinned time of day `?time=` / `?hour=`.
- **Diagnostics and regression**: layer-by-layer debugging `?ln=N`, the diagnostic pages `/diag` and `/probe`, the in-page self-check `?selfcheck=1`,
  the real-machine baseline `?baseline=1` + the `node tools/baseline-diff.mjs` regression gate, first-frame layer-by-layer audit `?audit=N`.
  The master flag table has **238 entries at present** (`docs/README-DIAGNOSTICS.md`, cross-checked **both ways** against the code by `diag-flag-check`; the reading is whatever a real run says).

### Deliberately out of scope / not possible
- **WebGL2 is required**; without a GPU it falls back to the CPU path ⇒ reduced functionality, markedly slower.
- **Complex skinning / particles / effect chains are still being completed** — the open list is in `tests/known-issues.json` and `docs/PATCHES.md`.
- **No real wallpapers are distributed**: the repository carries only one **procedurally generated** synthetic sample (`samples/sample-synthetic*`).
- **No official WE assets are distributed** (official shader headers / particle presets / fonts / audio / video): the 6 shader headers are this repository's **own API-compatible implementations**,
  and the WE installation directory is only read **at runtime**, via `MPW_WE_ASSETS` (skipped when it cannot be found).
- **In read-only mode (no backend)**: the wallpaper library list, property saving, `/report` and the WE-asset fallback are all unavailable (the controls are greyed out and the reason is stated).

---

## 3. Loading a wallpaper

| How | URL | Notes |
|---|---|---|
| Bundled sample | `?id=sample-synthetic` | The **only** scene bundled with the repository: a procedurally generated synthetic sample (no third-party assets), see `samples/` |
| Open the home page | no `?id=` | When this machine has no default corpus the page **says so explicitly** and renders the synthetic sample above instead |
| Local package file | `?pkgpath=/absolute/path/scene.pkg` | A path inside the server whitelist (override the whitelist with the colon-separated `MPW_ALLOW_DIRS`; the bundled `samples/` is already in the default whitelist) |
| Remote package URL | `?pkgurl=https://…/scene.pkg` | The server **fetches it as a proxy** (bypassing CORS) |
| **Workshop source folder** | `?pkgurl=http://127.0.0.1:8899/pkgdir?d=/absolute/folder` | The server **packs the folder into a container on the fly** and feeds that to the renderer; `/pkgdir?scan=1` lists the packable folders |
| Package id | `?id=<folder name>` | Matched by folder name across the `MPW_SCENE_ROOT` candidate tiers and `<repo>/samples`; **real wallpapers require you to supply the corpus** |

Debug flags (`?ln=<N>` layer by layer, `?time=` / `?hour=` to pin the time of day, `?showui` to show hidden UI layers, `?selfcheck=1` in-page self-check …)
have their **complete master table** in `docs/README-DIAGNOSTICS.md`.

---

## 4. Environment variables (all have defaults; leaving them unset is equivalent to the author's machine)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8899` | Listen port (**8899 = this repository's bundled demo service**, `server/we-scene-demo-server.mjs`; **8902 = the one-stop bench**, `server/we-scene-demo-server-8902.mjs`, which the plugin points at by default — the two do not affect each other ✓) |
| `MPW_ROOT` | this repository's parent directory | The base for other paths (`$MPW_ROOT/allwallpaper`, `$MPW_ROOT/wallpaper_engine/assets` …) |
| `MPW_SCENE_ROOT` | the first one that exists: `$MPW_ROOT/allwallpaper/dd` → `$MPW_ROOT/allwallpaper` → `<repo>/samples`; if none exists, a placeholder path that **explicitly does not exist** (the startup log says so, and every `?id=` returns 404) | The package-folder root for `?id=` |
| `MPW_REPORTS_DIR` | `$MPW_ROOT/reports` | Where `/report` reports are persisted (only the newest 60 are kept) |
| `MPW_WE_ASSETS` | auto-detected local Steam/WE install directory | The official WE-asset fallback (shaders/particle presets/materials); **not distributed with the repository** — skipped when not found |
| `MPW_ALLOW_DIRS` | several local directories + `<repo>/samples` | The path whitelist for `?pkgpath=`/`/pkgdir` (colon-separated, **wholly overriding** the default) |
| `MPW_PLUGIN_CACHE` / `MPW_SD_ROOT` | plugin download cache / alternate corpus root | Extra roots for the corpus-scanning tools (`MPW_SD_ROOT` enters the whitelist **only when explicitly set**) |
| `MPW_PKG_EXTRACT` | first the sibling plugin `<parent>/dsh-mpkg-wallpaper/lib/pkg-extract.js` (full API: `parsePkgIndex`, directory-table fast path), otherwise this repository`s own `pkg-parse.mjs` (MIT thin wrapper over `packages/we-core/pkg.js`) | The package parser (for a public copy, put `pkg-parse.mjs` at the repository root, or point this variable at an absolute path) |
| `MPW_PWA` | off | `1` = inject the PWA into the home page (manifest + SW registration); a single request can override it with `?pwa=1` |
| `MPW_BIND` | `127.0.0.1` | Listen address (loopback only by default) |

---

## 5. Directory structure (layered by "responsibility for handling wallpaper data")

| Path | Responsibility |
|---|---|
| root | **Entry points**: `README.md`, `LICENSE`, `THIRD-PARTY.md`, `package.json`, `start-demo.sh` (launch), `check.sh` (self-check), `build-pages.mjs` (build), `index.html` (landing page), `demo.html` (renderer page, which is the site root) |
| `core/` | **Parsing and rendering kernel**: `we-scene.mjs` (library entry `mount()`), `we-scene-bundle.js` (PKG/TEX/MDL parsing + the WebGL2 renderer), `scene-project-json.mjs` (the project.json lookup chain), `attach-transform.mjs` (attachment anchors), `puppet-skin.js` (skinning), `we-animation.mjs`, `we-particle-pointer.mjs`, `we-web-shim.mjs`, `web-frame-geometry.mjs`, `audio-band-array.mjs` |
| `server/` | **Local server side and packing IO**: `we-scene-demo-server.mjs` (the `:8899` renderer page: static serving + `/report` `/baseline` `/weassist` `/pkgdir` and other routes), `we-scene-demo-server-8902.mjs` (the `:8902` one-stop bench: static surface + `/api/*` + renderer iframe + media surface + `/diag` stream + `/report` `/baseline` persistence), `pack-dir.mjs` (source folder → `.mpkg` container) |
| `web/` | **Site shell and offline assets**: `sw.js` + `sw-policy.mjs` (the SW and its cache predicate), `pwa-inject.mjs` (homepage injection), `manifest.webmanifest`, `icons/` (page and install icons: `brand-*` are images supplied by the repository owner, `icon-*` are script-generated), `diag.html` / `probe.html` (diagnostic pages, matching the routes `/diag` and `/probe`), `diag-flags.json` (the panel's flag data source, script-generated) |
| `tools/` | **Generators and forensics tools**: `make-sample.mjs` (synthetic sample, deterministic), `make-icons.mjs` (PWA icons, deterministic), `pkg-patch.mjs` (PKG container read/write: edit `scene.json` and repack ⇒ controlled A/B on "the same input through two tiers"; `--self-test` proves the round trip is byte-for-byte identical), `baseline-diff.mjs` (baseline difference table), `script-deobfuscate.mjs` (de-obfuscates the author's obfuscated scripts field by field into readable source) |
| `tests/` | The full regression suite and gates (`run-all-tests.sh` runs everything; the three static gates `docs-check` / `publish-check` / `diag-flag-check`) |
| `docs/` | Explanatory and audit documents (`README-DIAGNOSTICS.md`, `PACKAGING.md`, `RELEASE.md`, `README-PUBLIC.md`, `RENDERER-ARCHITECTURE.md`, `BASELINE.md`, `TESTING.md`, `PATCHES.md`, `COPYING-RULES.md` …) |
| `elysia/` `vendor/` `shaders/` | The CPU-renderer port (MIT, see §11.1(1)), vendored third-party code (MIT/ISC), and the 6 in-house API-compatible shader headers |
| `samples/` `demo/` `assets/` `extensions/` | The synthetic sample (the only bundled scene), the WebWallGL online bench (MIT artefacts redistributed), the open-licensed fonts distributed with the repository, and extension-hook examples |
| `archive/` | Local archive (**not in the repository**; skipped by `publish-check`) |

> The site root = the repository root: Pages publishes the repository root directly, so `index.html` / `demo.html` / `samples/` / `elysia/` and other **site entry points must stay at the root**;
> all other code lives by responsibility in `core/ server/ web/ tools/`, and the online URLs (`/demo.html`, `/sw.js`, `/manifest.webmanifest` …) are **character-for-character identical** to what they were before the reorganisation.

---

## 6. Development and testing

```bash
bash start-demo.sh --check             # preflight only (Node version / package-parser location / port / corpus), without starting the server
bash check.sh                          # the single entry point for release/self-check: three static gates + the full regression suite
bash check.sh --no-gate                # only the three static gates (second-scale, for use before committing)
bash check.sh --fast                   # full regression, skipping the slowest items
bash check.sh --json                   # append a machine-readable summary at the end
npm run test                           # = bash tests/run-all-tests.sh
npm run test:fast                      # = bash tests/run-all-tests.sh --fast
bash tests/run-all-tests.sh --list     # list the regression items (240 at present; slow items are skipped by --fast, conditional items SKIP automatically with no data)
node tests/docs-check.mjs              # documentation backtick-reference integrity + P-number health + flags consistent both ways
node tests/publish-check.mjs           # privacy/size/proprietary files (the one item that must show 0 blockers before release)
node tests/diag-flag-check.mjs         # code flags ↔ the docs/README-DIAGNOSTICS.md master table, 0 differences both ways
node tests/demo-check.mjs              # the online published shape self-check
node tools/make-sample.mjs             # regenerate the synthetic sample (deterministic: same arguments, same sha256)
node tools/pkg-patch.mjs --self-test   # PKG container read/write round-trip byte-for-byte self-check
node tools/baseline-diff.mjs <old.json> <new.json>   # baseline per-metric difference table (regression → exit code 1)
```

- The last line of `bash check.sh --json` looks like `{"pass":N,"fail":N,"skip":N,"stages":[…]}`; when all four pass, `pass=4` and `fail=0`,
  and any failing stage prints `失败阶段：…`, lists the failing items and exits with **exit code 1** (the exit-code semantics are defined by `check.sh` itself).
- `npm install` is **optional**: without `typescript` installed, `types-check` prints SKIP ("typescript not installed ⇒ SKIP, no pretending to pass").
- The full pre-release prerequisites/commands/verification/rollback flow is in `docs/RELEASE.md`; packaging and distribution shapes are in `docs/PACKAGING.md`.

---

## 7. Known limitations

- WebGL2 is required; without a GPU it falls back to the CPU path (reduced functionality, markedly slower).
- Complex skinning/particles/effect chains are still being completed; the issue list and progress are in `tests/known-issues.json` and `docs/PATCHES.md`.
- Audio is not distributed with the repository: when you load a package containing audio, the page **parses it locally on your machine** for playback/export (see the audio panel in the renderer's top bar).
- In the pure static (no backend) shape, the wallpaper library list, property saving, `/report` and the WE-asset fallback are all unavailable (the controls are greyed out and the reason is stated).
- This repository **distributes** no real wallpapers, preview images, audio/video or official WE assets; it carries only one procedurally generated synthetic sample.

---

## 8. FAQ

**Q: It is running, but the page says there is no wallpaper / shows a blank screen?**
This repository **ships no real wallpapers**. Just open `http://127.0.0.1:8899/?id=sample-synthetic` to see the bundled synthetic sample;
to see your own wallpaper, use `?pkgpath=/absolute/path/scene.pkg` (the path must be inside the `MPW_ALLOW_DIRS` whitelist), or put the folder under `MPW_SCENE_ROOT` and then use `?id=<folder name>`.

**Q: `start-demo.sh` reports "cannot find the package parser (pkg-extract)"?** (**with the parser bundled in this repository, a normal clone no longer hits this** ✓)
Cause: the preflight looks for the parser in three places, and **the first is `pkg-parse.mjs` at this repository's root** (bundled ✓). If you really do see this error, it usually means the working copy is missing that file or you are using an old launch script. Fixes (any one):
put `dsh-mpkg-wallpaper` in the **same parent directory** as the renderer, point at it with `MPW_PKG_EXTRACT=/absolute/path/pkg-extract.js`, or put `pkg-parse.mjs` at this repository's root.

**Q: The default port 8899 is already in use?**
`PORT=9000 bash start-demo.sh` or `bash start-demo.sh --port 9000` (`start-demo.sh` probes first and falls back, then prints the final URL).

**Q: Why are some features greyed out under static hosting (route B)?**
Read-only mode has no server endpoints ⇒ the package proxy, `/report`, the WE-asset fallback and `/pkgdir` folder packing are all unavailable, and the UI greys those controls out and states the reason. If you need them, use route A.

**Q: Every `?id=` returns 404?**
That means **none of the `MPW_SCENE_ROOT` candidates exist** (the startup log prints the effective value and the reason). Use `?pkgpath=` / `?pkgurl=`, or set `MPW_SCENE_ROOT` to your own corpus directory.

**Q: How do I confirm "it is installed and can be released right now"?**
`bash check.sh` (the single entry point). For just the second-scale static gates: `bash check.sh --no-gate`; for a machine-readable summary: `bash check.sh --json`.

**Q: Can I use it commercially / redistribute it?**
The renderer's own code is **GPL-3.0-or-later** (see §10, §12 and `LICENSE`). When redistributing you **must** also carry this repository's GPL source,
`THIRD-PARTY.md` and the third-party licence notices registered there (including the notice for the MIT plugin `dsh-mpkg-wallpaper`). This file is not legal advice.

---

## 9. Data limits and automatic reporting (off by default)

Automatic reporting is **off by default**: unless you pass `?report=auto`, not a single timer is created; manual reporting is an explicit user action and is unaffected by the flag.
Everything that "writes to disk / writes to localStorage automatically" has **count + byte limits**; over the limit the **oldest is deleted first** and a log line is emitted (`[prune]` / `[limits]`):

| Artefact persisted | Limit | When it is pruned |
|---|---|---|
| `reports/r*.json` (`/report`; the automatic path is additionally limited to 4 times) | 60 files, 64MB combined with selfcheck | once before and once after writing |
| `reports/selfcheck-*.json` (`/diag` self-check/performance summaries) | 40 files | same as above |
| `reports/shots/<id>/*` (`/shot` burst capture) | 400 frames / 200MB per id; 500MB across all ids | same as above; when the global limit is exceeded, the "oldest frame across all ids" is deleted |
| Plugin diag snapshots (host side) | 50 / 32MB | pruned once at startup + before and after writing |
| `localStorage['mpw-props:<wallpaper id>']` | 24 keys / 64KB per value / 512KB combined | LRU eviction |

Every limit constant has a **single source**; writing it anywhere else has no effect. The item-by-item list, the pruning log format, the assertions that turn red and the open items are in `docs/DATA-LIMITS.md` (gate `data-limits`).

---

## 10. Licence & disclaimer

> **免责声明**
> 本项目与 Wallpaper Engine 官方**无任何关联**，不包含 Wallpaper Engine 本体、Steam 创意工坊内容或任何受版权保护的壁纸资源。本项目**不分发**任何壁纸包（scene 场景包、视频壁纸、网页壁纸）、预览图、音视频或美术素材；仓库内随附的字体仅为各自许可允许再分发的开源字体，逐条见 THIRD-PARTY。用户需自行提供**合法获得**的壁纸，并自行承担因读取、转换或播放相关内容而产生的合规责任。"Wallpaper Engine" 及其相关名称与标识为其各自权利人的商标，本项目仅出于说明兼容性之目的进行指称。本项目渲染器以 GPL-3.0-or-later 发布、插件以 MIT 发布；第三方组件与参考资料（**仅行为对照、未复制代码**）的许可与归属见 THIRD-PARTY.md 与 docs/COPYING-RULES.md。
>
> *（上段按项目所有者指定原文采用。须并列阅读 §11 的两条例外：`oneincase/webwallgl`（MIT）的 FXAA 片元着色器为**逐字复制**、其 HLSL→GLSL 转译器为**逐字节 vendored**（MIT 声明均已保留，§11.1(2)）；`Aromatic05/wallpaper-engine-renderer`（GPL-2.0-only）曾被审计判定有 **2 处点状同源**，**已于 2026-09-16 按书面规格洁净室重写**（`docs/PATCHES.md` **P-95**，行为逐位一致，§11.4(2)），剩余未定项只有**法律定性**（审计 U-1/U-5）。RePKG 的许可已核实为 **MIT**（§11.4(7)）。）*

> **Disclaimer**
> This project is **not affiliated with Wallpaper Engine** in any way. It does not include the Wallpaper Engine application, any Steam Workshop content, or any copyrighted wallpaper assets. It **does not redistribute** wallpaper packages (scene, video, or web), preview images, audio/video, or artwork; the fonts bundled in this repository are only those open-licensed fonts whose licences permit redistribution (see THIRD-PARTY). **Users must supply their own lawfully obtained wallpapers** and are solely responsible for compliance when reading, converting, or playing such content. "Wallpaper Engine" and related names and marks belong to their respective owners and are referenced here only to describe compatibility. The renderer is released under GPL-3.0-or-later and the plugin under MIT; see THIRD-PARTY.md and docs/COPYING-RULES.md for third-party components and reference material (used for **behavioural comparison only — no code was copied**).
>
> *The paragraph above is reproduced verbatim at the project owner's request. Read it together with the two exceptions in §11: the FXAA fragment shader in `oneincase/webwallgl` (MIT) is a **verbatim copy**, and its HLSL→GLSL translator is **vendored byte-for-byte** (MIT notices retained, §11.1(2)); and `Aromatic05/wallpaper-engine-renderer` (GPL-2.0-only), where our audit once found **two point-like same-origin fragments**, was **independent implementation to spec rewritten from a written specification on 2026-09-16** (`docs/PATCHES.md` **P-95** — behaviour bit-identical, §11.4(2)), the only remaining open items being the **legal characterisation** (audit U-1/U-5). RePKG's licence is **MIT** (verified, §11.4(7)).*

- **This project's own code: GNU GPL version 3 or later (`GPL-3.0-or-later`)**, full text in the repository's `LICENSE`
  (the upper part = the unmodified GNU GPL v3 terms; the end carries the copyright notice and the "either version 3 … or (at your option) any later version" wording). SPDX identifier: `GPL-3.0-or-later`.
- **This repository contains no WE (Wallpaper Engine) assets whatsoever**: it distributes no `scene.pkg`/`.mpkg`, textures, official shader headers, audio, video or any Workshop work;
  the only bundled sample is the procedurally generated `samples/sample-synthetic*`.
- **Container parsing depends on no external repository**: it is provided by this repository's `pkg-parse.mjs` + `packages/we-core/**` (**MIT** ✓). The sister plugin `dsh-mpkg-wallpaper` (**MIT**) is **used optionally, and only when scene/texture extraction is needed** ✓; the borrowing runs in the permitted MIT → GPL direction,
  **so the plugin's MIT notice is retained**, and it must not be overridden or removed by this repository's GPL.
- Item-by-item attribution, full licence texts and the copying ledger for third-party components are in `THIRD-PARTY.md` and `docs/COPYING-RULES.md`; the decision to move to the GPL and its implementation record are in `docs/PATCHES.md` P-89. This file is not legal advice.

---

## 11. References & credits

This section lists, one by one, the upstream projects this project has **genuinely referenced**, distinguishing three natures: ① **code/assets copied** (their licence notices must be retained); ② **imported as a dependency** (not copying);
③ **behaviour/format comparison only** (no code copied). **Anything that cannot be confirmed on this machine is written as "undetermined / to be verified" — never guessed**; the legal text and full licences are governed by `THIRD-PARTY.md`, and the copying ledger by `docs/COPYING-RULES.md`.
Documents marked `<workspace>/…` are **workspace-internal records** (not distributed with this repository), so they are written out with an absolute marker here to avoid being mistaken for repository-relative paths.

### 11.1 Code copied — the licence notices must be retained

#### (1) elysia395/dsh-wallpaper-engine — MIT
- Repository: <https://github.com/elysia395/dsh-wallpaper-engine> | Licence: **MIT** (`Copyright (c) 2026 elysia395`)
- **Copied/derived (to file level)**: `elysia/**` and `core/attach-transform.mjs` are **ports/derivative works** of the upstream `lib/we-renderer/**` and `lib/*.js`:
  - `elysia/we-renderer/**` — of its 43 files, **30 are byte-for-byte identical to upstream** (checked with `cmp`); the remaining 13 carry browser-portability patches only (the smallest changes just 2 import-path lines, the largest is a 135-line difference in `textures.js`). Coverage: the CPU scene-renderer core, `model.js`+`mdl.js` (MDL parsing), `puppet.js` (skeleton/skinned-mesh rasterisation), `effects/**` (blur/clouds/water ripples/god rays/depth-of-field parallax and other effect implementations), `glsl/**` (the GLSL interpreter and HLSL→GLSL translation), `jpeg.js`, `camera.js`, `bloom.js`, `canvas.js`, `text.js`.
  - `elysia/font-render.js` (1-line difference), `elysia/scene-scripts.js` (311-line difference, substantially extended beyond upstream), `elysia/scene-script-apis.js` (56-line difference) — the scene-script runtime and CFF text rasterisation.
  - `core/attach-transform.mjs` — a **verbatim port of 4 upstream functions** (`_mdlAnchors` / `_puppetBoneFinal` / `_attachmentOffset` / `resolveTransform`), used for attachment-anchor transforms.
  - 69 files / about 1.15 MiB in total. The renderer part was written by the upstream contributor **YV3507** (all 16 commits under `lib/we-renderer/`) and merged as PR #47 on 2026-08-25.
- **Licence notices retained in**: `elysia/LICENSE` (the full MIT text, distributed with the directory), `THIRD-PARTY.md` §1 (full MIT text), `docs/COPYING-RULES.md` §4 ledger **#1**.
- **Undetermined / to be verified**: the true origin of the JS shared between `elysia/scene-scripts.js` and the C++ strings embedded in `wer-ref` (elysia's MIT code, or a common WE-API ancestor) is **undetermined**; the suggested three-way diff has not been done yet.

#### (2) oneincase/webwallgl — MIT
- Repository: <https://github.com/oneincase/webwallgl> | Licence: **MIT** (`Copyright (c) 2026 oneincase`) | Reference commit for the comparison: `fdfc578a577d0e680a9cfe2cf2e3e825d3cd2372` (v1.3.23, 2026-09-15)
- **What was copied (to line level)**: **`FXAA_FRAG` (lines 452–489) verbatim** from the upstream `renderer/vendor/we-scene/render/renderer-glsl.js` into `core/we-scene-bundle.js`, under the constant name **`FXAA_FS`** (after normalisation 38/38 lines of GLSL are fully identical; the algorithmic constants match upstream: `SPAN_MAX=8.0`, `REDUCE_MUL=1/8`, `REDUCE_MIN=1/128`, `LUMA=(.299,.587,.114)`).
- **Whole-file vendoring (P-93)**: `vendor/hlsl2glsl/` = a **byte-for-byte copy** of the upstream HLSL→GLSL translator (`hlsl2glsl.js` 95,759 B / 1693 lines, `hlsl-preprocessor.js` 14,920 B / 418 lines, plus the upstream `LICENSE` 1,085 B; the three sha256 values are in `THIRD-PARTY.md` §9.1 — **not one character changed**). Not vendored: `render/headers.ts` (this project ships its own `common*.h`). Its only consumer today is the coverage gate `tests/hlsl2glsl-coverage-test.mjs`; the renderer's own shader path is not wired to it yet.
- **Behavioural comparison only (not copying)**: the `?q`/`?aa`/`?pp` quality tiers and the `setQuality` hot-update API (the AA/`pp` constant **value tables** are taken by value from the MIT `quality.ts`, with thanks), the pass orchestration (`runAAPass`, texture read-back, frame-token idempotence, `resolveAaMode`, the MSAA fallback strategy), and the vertex stage reusing this repository's existing full-screen triangle `BLOOM_VS`; on the plugin side `lib/web-wallpaper.js` (the WE API shim) has **0 lines copied**.
- **Static-artefact redistribution**: `demo/**` is the **static build of the WebWallGL online bench with this project's patches applied** (upstream artefacts such as `demo/assets/renderer-*.js`, `demo/assets/bench-*.js`, `demo/index.html` are **redistributed as-is**; `demo/bench-patch.js` is this project's runtime patch, under GPL-3.0-or-later, and does not modify the minified artefacts) ⇒ **the MIT notice ships with the directory**: `demo/LICENSE-webwallgl-MIT.txt` (full MIT text + attribution + a note saying which parts are upstream and which are ours). `demo/` contains **no wallpaper packages, preview images, audio/video or Workshop content**; the default scene is this repository's own synthetic sample. See `THIRD-PARTY.md` §6.4 and `docs/ONLINE-DEMO.md` for details.
- **Licence notices retained in**: the provenance comment above `FXAA_FS` in `core/we-scene-bundle.js`, `vendor/hlsl2glsl/LICENSE`, `THIRD-PARTY.md` **§6 and §9** (full MIT text), `docs/COPYING-RULES.md` §4 ledger **#6** (FXAA) and **#8** (the translator). Study records: `<workspace>/docs/reverse/WEBWALLGL-UPSTREAM-STUDY.md`, `<workspace>/docs/reverse/WEBWALLGL-DEMO-STUDY.md`.

#### (3) @shaderfrog/glsl-parser 7.0.1 — ISC (Andrew Ray)
- Repository: <https://github.com/ShaderFrog/glsl-parser> | Licence: **ISC** (per its `package.json`'s `"license": "ISC"`, `"author": "Andrew Ray"`)
- **What was copied**: the whole thing, **vendored and unmodified** — `elysia/vendor/@shaderfrog/glsl-parser/` (19 files / 665,659 B), used by `elysia/we-renderer/glsl/{executor,preprocess}.js` (the parsing front end of the GLSL interpreter).
- **Licence notices retained in**: `elysia/vendor/@shaderfrog/glsl-parser/LICENSE`, `elysia/LICENSE`, `THIRD-PARTY.md` §2.
- **Undetermined / to be verified (important)**: the upstream repository has **no** LICENSE file, and its README has no licence section either (GitHub `/license` = 404, npm package `/LICENSE` = 404) ⇒ that LICENSE file is **one we wrote from the package metadata**; the copyright year `2022` in it is **inferred** from the npm first-publish date, not upstream text.

### 11.2 Third-party assets distributed with the repository — their licences must be retained

- **Fonts (8 files + 13 licence/notice files)** — the per-file **upstream URL, retrieval date, byte count, sha256 and copyright line** are in `THIRD-PARTY.md` §4.1, and the full licence texts ship with the repository in `assets/fonts/licenses/`:

| File | Licence | Upstream |
|---|---|---|
| Blackout 2 AM.ttf | OFL-1.1 (RFN Blackout) | <https://github.com/theleagueof/blackout> |
| monof55.ttf | OFL-1.1 | Debian fonts-monofur 1.0 upstream tarball |
| NotoSans-Regular.ttf | OFL-1.1 | <https://github.com/notofonts/noto-fonts> |
| RobotoMono-Regular.ttf | OFL-1.1 (**not** Apache-2.0; the copy inside WE is the 2015 build) | <https://github.com/googlefonts/RobotoMono> |
| Segment7Standard.otf | OFL-1.1 (RFN Segment7) | fontlibrary.org /en/font/segment7 |
| Twemoji.Mozilla.ttf | artwork CC-BY-4.0 / code Apache-2.0 | <https://github.com/mozilla/twemoji-colr> (v0.7.0) |
| spincycle_3d_ot.otf | the author's freeware terms (Jess Latham / bvfonts.com) | <https://www.bvfonts.com/> (condition-by-condition comparison in `THIRD-PARTY.md` §4.6.1) |

  **Hard provenance rule**: **no file in `assets/fonts/` comes from a Wallpaper Engine installation directory**; WE's own font directory is only read **at runtime** (`/weassist/fonts/<name>`) and is never a packing source.
  **Deliberately not packaged** (no redistribution permission found — **undetermined / to be verified**): Alcubierre.otf, Atami-Regular.otf, CursedTimerUlil-Aznm.ttf, Lazer84.ttf, kust.ttf, opensticks.ttf, summer85.ttf, 8bitOperatorPlus8-Regular.ttf — see `THIRD-PARTY.md` §4.7.
- **Peggy (MIT)** — **acknowledged only, not distributed**: `elysia/vendor/@shaderfrog/glsl-parser/parser/parser.js` is the machine-generated output of Peggy 1.2.0 (<https://peggyjs.org>). See `THIRD-PARTY.md` §3.

### 11.3 Imported as a dependency (not code copying)

#### dsh-mpkg-wallpaper — MIT
- Repository: <https://github.com/XHR666/dsh-mpkg-wallpaper> | Licence: **MIT**
- **How it is referenced/used**: the renderer's `parsePkg` / `readPkgEntry` **come from this repository's MIT `we-core`** (re-exported by `pkg-parse.mjs`); the **extraction** functions the plugin offers are an optional extension. This is a **dependency**, not copied code.
- **Was any code copied directly**: **no**.
- **Obligation**: redistributing this renderer **must carry the plugin's MIT notice**; the plugin **stays MIT** and must not be overridden by this repository's GPL (MIT → GPL is a permitted one-way flow; the reverse is forbidden). Machine check: `tests/publish-check.mjs` asserts that the plugin package contains **no** GPL text.

### 11.4 Behaviour/format comparison only, no code copied (item by item)

#### (1) Almamu/linux-wallpaperengine — GPL-3.0-only
- Repository: <https://github.com/Almamu/linux-wallpaperengine> | Licence: **GPL-3.0-only** (its `packaging/archlinux/PKGBUILD` says `license=('GPL-3.0-only')`)
- **What was referenced (to file/feature level)**: as the **format-and-default-value authority** for `.tex` containers and particle/object properties, cited point by point in code comments: the texture container format (measured `TEXV0005` + `TEXI0001` + `TEXB0001~0004`) — compared against `TextureParser`; falling back to the **V3 layout** when the media is not MP4; the object property default at `ObjectParser.cpp:770` (`lengthDefault = (name=="ropetrail") ? 1.0 : 0.05`); the particle initialiser at `CParticle.cpp:767-778` (`createVelocityRandomInitializer`) and the control-point flags.
- **Was any code copied directly**: **no** (`docs/COPYING-RULES.md` §4 ledger has **no** entry for it ⇒ nothing was ever borrowed). The locally checked-out copy is outside the repository in `lwe-ref/` and is not committed.
- **Undetermined / to be verified**: the bit definitions of the particle flags have **no authoritative source** in either `lwe-ref` or `wer-ref` ⇒ marked "undetermined".

#### (2) Aromatic05/wallpaper-engine-renderer — GPL-2.0-only ✅ point-like same-origin fragments independent implementation to spec rewritten
- Repository: <https://github.com/Aromatic05/wallpaper-engine-renderer> | Licence: **GPL-2.0-only** (a fork of `catsout/wallpaper-scene-renderer`)
- **Disposition (2026-09-16 independent implementation to spec)**: the **2 point-like same-origin fragments** found by the audit (α normalisation, alignment offset) **have been rewritten** following the "five-step clean room" process in `docs/COPYING-RULES.md` §5, and **the old implementations have been deleted from `core/we-scene-bundle.js`**; the audit's original findings (including the deleted old identifiers) are kept in `<workspace>/docs/reverse/WER-REF-LICENSE-AUDIT.md` §3.4:
  ① **write the behaviour spec first** — `docs/IMAGE-ALPHA-ALIGN-SPEC.md` (α-normalisation truth table and "what must not be done", alignment token grammar and precedence, acceptance criteria);
  ② **implement from the spec alone** — `coerceImageAlphaMode` + `classifyAlphaDomain`/`saturateUnitInterval` (classification separated from conversion + named constants `ALPHA_UNIT_MAX`/`ALPHA_PERCENT_MAX`), `alignmentOffsetForToken` + `readAlignmentAxisSigns` + `ALIGNMENT_HALF_SHIFTS` (**token glyphs and offsets fully decoupled into a lookup table**, keyed by the sign pair);
  ③ **provably different on five axes**: naming, branch structure, constant organisation, data-structure shape and comment wording ("branch-by-branch isomorphism" is now 0 occurrences in `core/we-scene-bundle.js`);
  ④ **tests do not depend on upstream** — `tests/independent implementation to spec-alpha-align-test.mjs` reads only the spec and real corpora;
  ⑤ **behavioural difference: none** — that test is **1014 pass / 0 fail** (including "`Object.is` bit-for-bit cross-checks against the pre-change implementation" and a regression over 6 real packages / 408 layers of corpus).
  Weaker traces of the same kind have also been zeroed out: `__makeNoopVideoTexture` has **0 hits** repository-wide, and the upstream expression and the `WPNodeTransformResolver.cpp:154-156` line numbers in the parallax comment have been deleted.
- **Recorded trail**: `docs/PATCHES.md` **P-95** (a dedicated independent implementation to spec entry with the five-axis difference table and re-runnable evidence); `<workspace>/docs/reverse/WER-REF-LICENSE-AUDIT.md` §3.4 now carries **"✅ added after the fact (disposition result)"** (the original finding is kept unchanged, with a post-disposition comparison and a lineage re-test appended).
- **Scale and conclusion**: it was **point-like** (about 2 functions / ~11 lines), never a paragraph- or file-level port; the whole repository has **0 imports/requires/readFiles** of it; at the literal level, **0 comments copied, 0 error strings copied, 0 constant tables transcribed**.
- **Undetermined / to be verified**: the **legal characterisation** — **U-1** in the audit's §7 ("the very judgement that this once constituted a GPL-2.0-only derivative still needs a lawyer's opinion") and **U-5** ("whether the list is exhaustive") — **are still open**; the code-level disposition and trail do not replace legal advice.
- **Consistency items already closed**: the numbering is unified as **P-95** (source comments, acceptance tests, `docs/RENDERER-ARCHITECTURE.md` and `THIRD-PARTY.md` all now say P-95; P-91 in `docs/PATCHES.md` is a different matter = "distribution shape").
- The locally checked-out copy is outside the repository in `wer-ref/` (565 files / 9.2M) and is **not committed**; the borrowable table in `docs/COPYING-RULES.md` lists it as "❌ not borrowable" (and after the rewrite there is no longer any need to "borrow" from it).

#### (3) catsout/wallpaper-scene-renderer — GPL-2.0-only
- Repository: <https://github.com/catsout/wallpaper-scene-renderer> | Licence: **GPL-2.0-only** (**archived**, default branch `master`)
- **What was referenced**: only two things — ① it is the **archived upstream parent project** of the `wer-ref` fork (the two share one LICENSE blob); ② it serves as a **third-party corroboration** of "is the official behaviour right", by **quoting its behavioural conclusions only**.
- **Was any code copied directly**: **no**; this project has **no independent local checkout** of it.
- **Undetermined / to be verified**: its **file-by-file lineage** with `waywallen/open-wallpaper-engine` holds only at the level of the repositories' own statements (the README is entirely "Moved to …", the same LICENSE blob, creation/archival 9 minutes apart) and **has not** been confirmed commit by commit.

#### (4) waywallen/waywallen — MIT
- Repository: <https://github.com/waywallen/waywallen> | Licence: **MIT** (`bridge/LICENSE` is also MIT, same holder)
- **What was referenced**: **an architectural precedent only** — the layering of "permissively licensed host + copyleft renderer as a separate process" (based on the `[renderers.wescene-renderer]` section of its `plugin.toml.in`), used as evidence that a GPL component and an MIT host can coexist without contaminating each other.
- **Was any code copied directly**: **no** (that licence was never exercised; there is no entry in the ledger).

#### (5) waywallen/open-wallpaper-engine — GPL-2.0-only
- Repository: <https://github.com/waywallen/open-wallpaper-engine> | Licence: **GPL-2.0-only**
- **What was referenced**: **zero contact** (it appears only in the licence-compatibility analysis as "❌ not borrowable", and in `wer-ref`'s own migration notes — that is lineage **between upstreams**, unrelated to this repository). **Was any code copied**: **no**.

#### (6) aqnya/unmpkg — GPL-3.0 (`.mpkg` format reference only)
- Repository: <https://github.com/aqnya/unmpkg> | Licence: **GPL-3.0** | **What was referenced**: the `.mpkg` binary **format** only. **Was any code copied**: **no**; the parsing script that claimed to reference it (38 lines) was deleted on 2026-09-16 (because code-level lineage could not be ruled out). **Undetermined / to be verified**: the statement "format reference only" **cannot be confirmed on this machine** (there is no local checkout).

#### (7) notscuffed/repkg — **MIT** (verified and closed on 2026-09-16)
- Repository: <https://github.com/notscuffed/repkg> | Licence: **MIT** (`Copyright (c) 2019 notscuffed`)
- **Basis**: the upstream `LICENSE` text (full MIT text; first re-checked 2026-09-16, **re-verified 2026-09-17** at <https://raw.githubusercontent.com/notscuffed/repkg/master/LICENSE>) plus the project owner's confirmation. The GPL side recorded in existing documents (`docs/COPYING-RULES.md`, `<workspace>/docs/misc/PLUGIN-POLLUTION-AUDIT.md`, the plugin README ×2, etc.) **was an early mis-recording in this repository and is void and corrected** — **every correction landed on 2026-09-17**, with the list in `<workspace>/docs/licensing/LICENSE-COMPAT-REVIEW.md` §10.1; the rule amendment is in `docs/COPYING-RULES.md` §6 + **§9.10**.
- **What was referenced**: cited as the **format/value authority** for `.tex` decoding (the RG88 convention `(rgb=G, a=R)`, consistent with ImageSharp `Rgba32`, greyscale = second channel G / alpha = first channel R, and so on).
- **Was any code copied directly**: **no (not literally)**. Even if "BC1/BC2/BC3 **aligned line by line with RePKG's LibSquish port**" in `core/we-scene-bundle.js` has a factual basis, that is a **permitted** MIT → GPL direction, with attribution and terms in `THIRD-PARTY.md`; the 267-line script that claimed to reference it was deleted on 2026-09-16. There is **no local checkout** (not vendored in the workspace).

#### (8) Aromatic05/we-layerd — **no licence (all rights reserved)**
- Repository: <https://github.com/Aromatic05/we-layerd> | Licence: **no LICENSE file = all rights reserved** (stricter than the GPL)
- **Licence verification (2026-09-17, L2)**: GitHub API `"license": null`; there is no `LICENSE`/`COPYING`/`NOTICE` in the upstream root;
  `Cargo.toml` (root + 4 member crates) has **no `license`/`license-file`/`repository`**; the upstream's **own packaging metadata admits it is unlicensed**
  (`package/archlinux/PKGBUILD:9` = `license=('custom:unlicensed')`, `package/fedora/we-layerd.spec:8` = `License: LicenseRef-Unlicensed`).
  **Also**: its `.gitmodules` bundles **GPL-2.0-only** `Aromatic05/wallpaper-engine-renderer` (pin `89dfcd86…`, = this workspace's `wer-ref/`)
  as a render-core submodule ⇒ even "write it yourself from their implementation" must avoid that submodule.
- **What was referenced**: a single behavioural comparison ("this feature has zero implementation" as corroboration). **Was any code copied directly**: **no** (repository-wide references = 26 files / 37 lines of **text only**,
  with **0** hits for `import`/`readFile`). The local checkout is outside the repository in `we-layerd-ref/`, **not committed** and **not in any artefact**.
- **Disposition**: `docs/COPYING-RULES.md` **§9.8** (L2 complete ⇒ keep zero introduction); the general ladder for unlicensed / incompatible upstreams is in the same file's **§9 (L1–L5)**.

### 11.5 Assessed in licence-compatibility research only — **its code was not referenced**

- **NixaXI/AnisPaper** — repository <https://github.com/NixaXI/AnisPaper> | Licence: **GPL-3.0** (its `LICENSE` says GPL-3.0 only, while the project's own description says or-later in several places ⇒ **conflicting statements; conservatively treated as GPL-3.0-only**, **undetermined / to be verified**).
  **Its code was not referenced**: the record in this repository states explicitly "no code borrowed from it this round", and there is **no local checkout**; it appears only in the licence-compatibility analysis (in fact it is C++/CMake + Qt + KDE Plasma 6).

### 11.6 Researched but **not adopted** (listed to make clear that "what was not referenced does not go above")

`Paradox07127/macos-wallpaperengine` (MIT), `oneincase/WallpaperEM` (MIT), `pbadgpmeb22791-sketch/dsh-we-wallpaper` (MIT) — research only;
`lucaschnabel42/wallgl` (**no licence ⇒ not borrowable**), `NikoPit/wallpaper-engine-assets` (`license: null` ⇒ cannot serve as a precedent for "redistributable") — explicitly excluded;
`enenesser/earth-webgl` (search noise, not a project of this kind).

### 11.7 Wallpaper Engine itself (proprietary) — not distributed with the repository

- Wallpaper Engine is **proprietary software** on Valve/Steam, and its assets are bound by the Steam Subscriber Agreement. This repository **distributes no** WE assets:
  textures, official shader headers, particle presets, fonts, audio, video and Workshop works are all absent; at runtime it reads from **the user's own** WE installation via `MPW_WE_ASSETS`.
- All 6 headers actually referenced by this project's internal shaders have been replaced with **in-house API-compatible implementations**
  (`shaders/common.h` / `common_blending.h` / `common_blur.h` / `common_composite.h` / `common_fragment.h` / `common_perspective.h`),
  each file header stating `Original implementation for this project; API-compatible with the shader includes used here. No third-party code.`
- `common_vertex.h` is **deliberately not published** (zero references in the pipeline, zero calls to `BuildTangentSpace`; after the rewrite it "overlaps 100% of the effective lines" with the WE original, so it does not count as a independent implementation to spec product):
  the recorded scope is formally **6 files**, and both the originals and the replacements are kept in an evidence archive outside the repository; the three facts and the reproduction commands are in `<workspace>/docs/misc/COMMON-HEADERS-REPLACEMENT.md` **§1.1**.

---

## 12. Licence & credits

> This section is the landing point of **the single link in the deliverable panel** (the `:8902` bench's "Settings → Attribution & licences" keeps just one line linking here,
> no longer piling attribution and full licence texts into the page). Its wording is consistent across three places — here, `THIRD-PARTY.md` and `docs/COPYING-RULES.md`;
> if an inconsistency is found, **facts prevail** and all three are corrected together.

| Item | Licence | Notes |
| --- | --- | --- |
| **This repository** (renderer / bundled server / bench) | **GPL-3.0-or-later** | Full text in the repository root `LICENSE`. Distributing this repository or a derivative work requires providing the source under GPL-3.0-or-later as well |
| **Upstream rendering core**: WebWallGL ([oneincase/webwallgl](https://github.com/oneincase/webwallgl)) | **MIT** | This repository's rendering core was **independently rewritten/ported** from it; the MIT licence requires retaining its copyright and licence notices — full texts in `demo/LICENSE-webwallgl-MIT.txt` and `demo/LICENSE-webwallgl` (**the files remain in the repository**; they are simply no longer listed as separate links on the page) |
| **Other third-party components** (vendored translator, fonts, reference implementations, etc.) | registered item by item | See [`THIRD-PARTY.md`](THIRD-PARTY.md): each entry gives the version, origin, licence and "whether it is distributed with the package" |
| **Wallpaper Engine itself and its assets** | proprietary (Valve/Steam) | **Not distributed with this repository**; at runtime it reads only from **the user's own** WE installation (see §11.7) |
| **Real wallpaper packages** (Workshop works / user corpora) | owned by their respective authors | **Not distributed with this repository**: it carries only one **self-made synthetic sample** (generated by `tools/make-sample.mjs`); user corpora stay outside the repository, pointed at with `MPW_SCENE_ROOT` / `?pkgpath=` |

**Why only one link on the page**: attribution and full licence texts belong to the **repository documentation** (what the GPL requires to be "provided with the distribution" is the repository's
`LICENSE` / `THIRD-PARTY.md` / the two upstream MIT full-text files); pasting the full texts into the product UI both hurts readability and drifts with versions;
the UI's only job is to **point you at the single authoritative location**.

---

*The record of how this section's wording was reconciled with `THIRD-PARTY.md` and `docs/COPYING-RULES.md` is in `docs/PATCHES.md`;
if the three are found to be inconsistent, **facts prevail** and all three are corrected together.*
