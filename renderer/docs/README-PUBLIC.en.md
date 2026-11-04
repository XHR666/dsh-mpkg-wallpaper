# WEwebLoader (browser-side Wallpaper Engine wallpaper renderer)

[中文](README-PUBLIC.md) | **[English](README-PUBLIC.en.md)**

**Render Wallpaper Engine scene wallpapers in the browser, live** (`scene.pkg` / this project's `.mpkg` container / a Workshop source folder) —
no Wallpaper Engine, no Windows, no GPU-specific driver required — a local Node static server plus a WebGL2-capable browser is all it takes.

> ⚠ **The main README is `README.md`** (shown on the GitHub home page), and it contains the **disclaimer** (in Chinese and English) and the complete
> **"References & Credits" section**. This file is the **entry document for downloaders** (kept as a required file anchor on the publish surface —
> `publish-check.mjs` requires it to be there); **§1–§6 share their source with the main README — change one and sync the other**.
> In-project development/diagnostic documents are in `docs/RENDERER-ARCHITECTURE.md`,
> `README-DIAGNOSTICS.md`, `TESTING.md`, `PATCHES.md`; for the legal text on third-party code and licences see `THIRD-PARTY.md`.

---

## 1. Quick start (two routes, pick one)

### A. With the bundled server (recommended, most complete)
```bash
node server/we-scene-demo-server.mjs          # listens on 0.0.0.0:8899 by default
# open http://127.0.0.1:8899/ in the browser
```
The bundled server provides: package/folder reading, `/report` report persistence, the `/weassist` WE-asset fallback, CORS (for iframe embedding) and so on.
The port can be overridden with an environment variable: `PORT=9000 node server/we-scene-demo-server.mjs`.
First paint: if this machine has a corpus, the default package is rendered; when there is **no corpus** (this repository does not distribute real wallpapers) the page says so explicitly and automatically renders the bundled synthetic sample
(you can also open `http://127.0.0.1:8899/?id=sample-synthetic` directly).

### B. Any static server (read-only mode)
```bash
python3 -m http.server 8899            # or npx serve -l 8899
# open http://127.0.0.1:8899/demo.html?id=<package id> in the browser   (use route A when you need bundled package files)
```
In static mode the renderer still opens, but the features that depend on server endpoints (package proxy, `/report`, WE-asset fallback) are unavailable.

---

## 2. Loading a wallpaper

| How | URL | Notes |
|---|---|---|
| Bundled sample | `?id=sample-synthetic` | The **only** scene bundled with the repository: a procedurally generated synthetic sample (no third-party assets), see `samples/` |
| Open the home page `http://127.0.0.1:8899/` | no `?id=` | The default package id is the author's test wallpaper (**not distributed with the repository**): when this machine has no such corpus the page **says so explicitly** and renders the synthetic sample above instead |
| Local package file | `?pkgpath=/absolute/path/scene.pkg` | A path inside the server whitelist (override the whitelist with `MPW_ALLOW_DIRS`, colon-separated; the bundled `samples/` is already in the default whitelist) |
| Remote package URL | `?pkgurl=https://…/scene.pkg` | The server **fetches it as a proxy** (bypassing CORS) |
| **Workshop source folder** | `?pkgurl=http://127.0.0.1:8899/pkgdir?d=/absolute/folder` | The server **packs the folder into a container on the fly** and feeds that to the renderer; `/pkgdir?scan=1` lists the packable folders |
| Package id | `?id=<folder name>` | Matches by folder name in the two tiers `MPW_SCENE_ROOT` (see the table below) and `<repo>/samples`; **real wallpapers require you to supply the corpus** |

For debug flags such as `?ln=<N>` (layer-by-layer debugging), `?time=`/`?hour=` (pin the time of day) and `?showui` (show hidden UI layers), see `README-DIAGNOSTICS.md`.

---

## 3. The bundled sample (`samples/`) — **this repository distributes no real wallpapers**

| Folder | Contents |
|---|---|
| `samples/sample-synthetic/` | The synthetic sample package: `scene.pkg` (≈33KB) + `project.json`. 5 layers: a gradient background, a composition container, an animated solid-colour bar, a dot that follows and scale-loops, and a text label bound to a property |
| `samples/sample-synthetic-src/` | The **loose source files** of the same scene (`scene.json`, `models/`, `materials/`). Packing them produces a result **byte-for-byte identical** to the `scene.pkg` above ⇒ it doubles as the "folder source" fixture |
| `tools/make-sample.mjs` | The generator: `node tools/make-sample.mjs` (deterministic — same arguments, same sha256); `--prod-verify` checks every item with the production parser |

The sample contains **no third-party assets or audio whatsoever** (all textures are generated procedurally by the script).
`samples/wallpapers/` once shipped 4 real Steam Workshop wallpapers with the repository (198MB) — **deleted in full for copyright reasons** (record in `PATCHES.md` P-87);
keep real wallpapers **outside** the repository and point `MPW_SCENE_ROOT` / `?pkgpath=` / `?pkgurl=` at your own copy (details in `samples/README.md`).

---

## 4. Environment variables (all have defaults; when omitted they are derived from the script's location)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8899` | listening port |
| `MPW_ROOT` | the repository's **parent directory** (derived from the script's location; no hard-coded author path) | base for the other paths |
| `MPW_SCENE_ROOT` | the first one that exists: `$MPW_ROOT/allwallpaper/dd` → `<repo>/samples`; if neither exists, a placeholder path that **definitely does not exist** (the startup log states it, and `?id=` always 404s) | package-folder root for `?id=` |
| `MPW_REPORTS_DIR` | `$MPW_ROOT/reports` | directory where `/report` reports are persisted (only the newest 60 are kept) |
| `MPW_WE_ASSETS` | auto-detects the local Steam/WE installation directory | WE official asset fallback (shaders/particle presets/materials); **not distributed with the repository**, skipped when not found |
| `MPW_ALLOW_DIRS` | several local directories + `<repo>/samples` | path whitelist for `?pkgpath=`/`/pkgdir` (colon-separated) |
| `MPW_PKG_EXTRACT` | `pkg-extract.mjs` in the same directory, otherwise the plugin repository path | the package parser (for a public copy, put `pkg-extract.mjs` in the same directory as the server) |

---

## 5. Licence and third parties

- **This project's own code: GNU GPL version 3 or later (`GPL-3.0-or-later`)**, full text in the repository's `LICENSE`
  (the upper part = the unmodified GNU GPL v3 terms; the end carries the copyright notice and the "either version 3 … or (at your option)
  any later version" wording). SPDX identifier: `GPL-3.0-or-later`.
- **This repository contains no WE (Wallpaper Engine) assets whatsoever**: it distributes no `scene.pkg`/`.mpkg`, textures, official shader headers,
  audio, video or any Workshop work; the only bundled sample is the procedurally generated `samples/sample-synthetic*`. Real wallpapers must be your own corpus (see §2/§3).
- **This renderer imports the MIT-licensed plugin `dsh-mpkg-wallpaper`** (the package parser `lib/pkg-extract.js`).
  That plugin **stays MIT**; the borrowing runs in the permitted MIT → GPL direction, **so the plugin's MIT notice is retained**,
  and it must not be overridden or deleted by this repository's GPL (rules in `docs/COPYING-RULES.md`).
- **Naming note (2026-09-18)**: this project has two names: **WEwebLoader**; the npm package name and the repository name are still `wallpaper-engine-web-loader`.
  The upstream project name is still **WebWallGL** (`oneincase/webwallgl`, MIT), and **attribution and licensing do not change because of that** (the next item is the upstream registration).
- `webwallgl` (**MIT © oneincase**): this repository **vendors none of its files** (the out-of-repository `vendor-ref/webwallgl`
  is only a study copy of upstream); but **P-90 ported its FXAA fragment shader (`FXAA_FRAG`, upstream lines 452–489) in verbatim**
  — it lands in the `FXAA_FS` constant of `core/we-scene-bundle.js`, with 38/38 GLSL lines identical after normalisation; **the MIT notice has been retained**
  (provenance comment in the source + the full text in `THIRD-PARTY.md` §6 + `docs/COPYING-RULES.md` §4 ledger #6).
  The quality tiers `?q`/`?aa`/`?pp` and `setQuality` are in-house (the upstream `quality.ts` was **not copied**; only the tier meanings were aligned).
- **Ported from [elysia395/dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine) (MIT © 2026 elysia395, renderer author YV3507)**: the parts `elysia/**` and `core/attach-transform.mjs` — full attribution and the full MIT text are in `THIRD-PARTY.md` and `elysia/LICENSE`.
- The bundled `@shaderfrog/glsl-parser` (ISC, Andrew Ray): upstream ships no licence file, so this project fills one in at `elysia/vendor/@shaderfrog/glsl-parser/LICENSE`.
- **Fonts** (OFL-1.1 / Apache-2.0 / CC-BY-4.0, in `assets/fonts/`): the per-file origin, copyright line,
  upstream URL, download date, byte count and sha256, plus the bundled list of full licence texts, are in `THIRD-PARTY.md` §4
  and `assets/fonts/licenses/`.
- **Wallpaper packages (`scene.pkg`/`.mpkg`) and the artwork and music inside them are copyright their respective authors** (most come from the Steam Workshop). The sample bundled here is procedurally generated; do not redistribute other people's work.
- The decision to switch to the GPL and its implementation record are in `PATCHES.md` P-89; this file is not legal advice.

## 6. Known limitations

- Requires WebGL2; without a GPU it falls back to the CPU path (reduced functionality, markedly slower).
- Complex skinning/particles/effect chains are still being completed; the issue list and progress are in `known-issues.json` and `PATCHES.md`.
- Audio is not distributed with the repository: when you load a package containing audio, the page **parses it locally on your machine** for playback/export (see the audio panel in the renderer's top bar).

## 7. References & credits

**A one-by-one list of every upstream project referenced** (project name + repository URL + licence + **what exactly was referenced** + whether code was copied) is in
**the main README `README.md` §7**; the full third-party licence texts and the "reference/behavioural-comparison register" are in `THIRD-PARTY.md`
(§1–§7 are copied/distributed items, **§8 is the reference-comparison register**, §9 is the HLSL→GLSL translator vendoring, §10 is the local copies used for behavioural comparison only);
the copying/borrowing ledger is in `docs/COPYING-RULES.md`.

Two exceptions that **must be read together with it** (details in `README.md` §7.4 and `THIRD-PARTY.md` §8):

- `Aromatic05/wallpaper-engine-renderer` (**GPL-2.0-only**, a fork of `catsout/wallpaper-scene-renderer`):
  this repository's own audit once found **2 point-like same-origin fragments** (alpha normalisation, alignment offset; about 2 functions / ~11 lines,
  **no verbatim copying**); GPL-2.0-only and this repository's GPL-3.0-or-later are **mutually incompatible** ⇒
  **it was clean-room rewritten from a written specification on 2026-09-16**: the specification `docs/IMAGE-ALPHA-ALIGN-SPEC.md`,
  the conformance test `clean-room-alpha-align-test.mjs` (**1008 pass / 0 fail**, including `Object.is` bit-for-bit cross-checks against the pre-change implementation),
  and the old implementation has been deleted; the 2 weaker forms (formula-level comments, naming-level comments) were cleaned up along with it.
  Recorded trail: `PATCHES.md` **P-95**; `docs/WER-REF-LICENSE-AUDIT.md` §3.4 now carries "✅ added after the fact".
  **Still open**: the legal characterisation (audit §7 **U-1 / U-5**, needs a lawyer's opinion).
  The numbering is unified as **P-95** (source comments/tests/architecture document/THIRD-PARTY all changed; P-91 in `PATCHES.md` is a different matter, "distribution shape"),
  and the last upstream-expression parenthetical in `core/we-scene-bundle.js` has been deleted too.
- `notscuffed/repkg`: the licence is **settled = MIT** (`Copyright (c) 2019 notscuffed`) — basis = the upstream `LICENSE` text
  (<https://raw.githubusercontent.com/notscuffed/repkg/master/LICENSE>, re-checked 2026-09-17 = the full MIT text) + **the project owner's confirmation**.
  The GPL side recorded in existing documents **was an early mis-recording in this repository and is void and corrected in full** (item-by-item list in `docs/LICENSE-COMPAT-REVIEW.md` §10,
  rule amendment in `docs/COPYING-RULES.md` §6 + §9.10). The statement in `core/we-scene-bundle.js` that it was "aligned line by line with RePKG's LibSquish port"
  **even if true, this statement falls in the permitted MIT → GPL-3.0-or-later direction**, requiring only registration under `docs/COPYING-RULES.md` §4 and retention of the MIT notice;
  **this repository currently vendors no RePKG code whatsoever** (no checkout in the workspace), so no new notice is needed.
- **Unlicensed / licence-incompatible upstreams** (e.g. `Aromatic05/we-layerd` — no LICENSE = all rights reserved; `Aromatic05/wallpaper-engine-renderer`,
  `catsout/…`, `waywallen/open-wallpaper-engine` — GPL-2.0-only, mutually incompatible with this repository): the handling is **not** "use your judgement", but
  the **L1–L5 ladder in `docs/COPYING-RULES.md` §9** — L1 clean-room rewrite → L2 check upstream metadata (`Cargo.toml`/`package.json`/`go.mod`
  + **the upstream's own packaging metadata**) → L3 write an equivalent implementation yourself (including **incremental rewrites**) → L4 switch to a **licence-compatible** similar project → L5 **isolation block**
  (a separate file/directory + one-click disabling from the UI or config + removable as a whole without affecting the remaining functionality + an explicit README statement that "this block exists because the upstream licence is unclear,
  and will be deleted if the author asks"). **L5 is a last resort, and "no silent deletions"**: every deletion leaves a public trail in `PATCHES.md`/`CHANGELOG`.
  **This repository currently has no L5 block at all**; the L2 verification and judgement for `we-layerd` are in `docs/COPYING-RULES.md` §9.8, and the compliant handling of GPL-2.0-only
  (the P-95 clean room) is in §9.9.
- `oneincase/webwallgl` (**MIT**): the FXAA fragment shader (`FXAA_FS`) was **copied verbatim**, and the HLSL→GLSL translator was **vendored byte-for-byte**
  (`vendor/hlsl2glsl/`, P-93); in addition, `demo/**` is a **patched redistribution of its static build artefacts**,
  with the MIT notices retained in the `core/we-scene-bundle.js` comment / `vendor/hlsl2glsl/LICENSE` / `demo/LICENSE-webwallgl-MIT.txt` respectively.

Also: `NixaXI/AnisPaper` was assessed in licence-compatibility research only and **its code was not referenced**, so it is not listed as a credit.
