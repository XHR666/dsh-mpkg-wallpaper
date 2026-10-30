# PROVENANCE — where `@xferoni66/we-core` comes from

**Statement: this package is an independent implementation.** Every line under `src/` was
written from the written specifications and public format facts listed in §2, with the
observable contract pinned by black-box comparison (§4) — never by copying, translating, or
renaming another implementation's source. 中文口径：本包为**独立实现**，规格来源与自证方式见下文。

This file is the implementation-source statement required for a **MIT** package that lives
in the same workspace as a **GPL-3.0-or-later** project. It is written so that a reviewer can
check three things without trusting anyone's memory:

1. which written specifications the code was implemented from,
2. which GPL-licensed files/segments were **not** opened or copied,
3. how the result is proven to behave identically (byte-for-byte) to the reference
   implementation in the host repository.

阅读顺序建议：§1 许可约束 → §2 规格来源 → §3 未打开/未复制的 GPL 段落 → §4 自证方法 →
§5 已证实清单 → §6 未证实清单 → §7 与 `docs/WE-CORE-PLAN.md` 的偏差。

---

## 1. Licence direction (the red line)

* This package is **MIT** (`LICENSE`, `package.json` → `"license": "MIT"`).
* The host repository (`we-scene-demo`) is **GPL-3.0-or-later**.
* The workspace rule is one-way: **MIT may flow into GPL; GPL must never flow into MIT**
  (`docs/COPYING-RULES.md` §2.1/§2.2). Copying, line-by-line translating, or
  variable-renaming GPL code into this package is forbidden.
* Machine-enforced consequences, both asserted by `test/manifest.test.mjs`:
  1. every `import` inside `src/` is a **relative path inside this package** — no `core/**`,
     no `node_modules`, not even `node:` built-ins;
  2. `src/` contains no DOM/GL/rendering calls.
* The GPL-side comparison lives in the host repository
  (`we-scene-demo/tests/we-core-parity-test.mjs`) precisely because *that* file may import
  both sides; this package never does.

## 2. Specification sources (what the implementation was written from)

Everything below is text this workspace owns, text in this repository, or public format
knowledge. No implementation source was used as a template.

| # | Source | Used for |
|---|---|---|
| S1 | `docs/WE-CORE-PLAN.md` (§0, §1.2, §1.3, §2.2) | module boundary (which areas belong to `we-core`), the public API name list, the three-parser situation, the "don't change behaviour while moving" rule |
| S2 | `docs/FIELD-ANALYSIS.md` §E "`.tex` 容器格式" | container skeleton `TEXV0005\0` + `TEXI0001\0` + header + `TEXB00xx` + imageCount + images; mip descriptor field list (`width,height,compression,uncompressedSize,compressedSize,data`); `compression===1` ⇒ LZ4; the `TEXTURE_FORMATS` id→name table; `FIF` values; `isVideo = (flags & 32) || fif === MP4` |
| S3 | `we-scene-demo/docs/UNTOUCHED-AREAS.md` (the `g_Bones` paragraph) | the settled `bindInv × m` multiplication order **and** the criterion that decided it (rigid rotation about a bone pivot keeps distances; the reverse order flings vertices hundreds of px away) — re-run as a test in `test/mat4.test.mjs` |
| S4 | `we-scene-demo/docs/VIDEO-AND-TWITCH-RESEARCH.md`, `we-scene-demo/docs/PATCHES.md` | the row-vector / row-major convention (`v' = v · Σ w · g_Bones`, `g_Bones[b] = bindInv[b] × RT`, "demo.html fills `bindInv × RT` (row-major)") |
| S5 | `we-scene-demo/tests/tex-fmt5-test.mjs:50` (`const bc3 = (w, h) => Math.ceil(w/4)*Math.ceil(h/4)*16`) | the block-size formula and the meaning of format 5 ("DXT5, half resolution" = the *descriptor* carries the half size; declared size is twice it) |
| S6 | `docs/DRAFT-LICENSE-MIT.md` (this workspace's own MIT draft) | the `LICENSE` text and copyright line (same author, same workspace) |
| S7 | Public format knowledge, no source code involved: LZ4 **block** format (token nibbles, 15-extensions, 2-byte little-endian offset, overlapping match copy); BC1/BC2/BC3 block-compression definitions (RGB565 endpoints, 2-bit indices, 4-bit/8-bit alpha blocks); orthographic/perspective/look-at definitions | `src/lz4.js`, the BC decoders in `src/pixels.js`, `mat4Ortho/mat4Perspective/mat4LookAt` |
| S8 | The container **bytes themselves** (real `.pkg`/`.tex` files in the corpus, inspected as data) | field offsets and layout versions. The PKG table is self-describing, so it was confirmed structurally: `dataStart + Σ entry.size === fileSize` holds for **all 26 packages** in the corpus (21 `PKGV*` + 5 `PKGM*`), and every TEX walk ends exactly at the entry size (see §4) |

Black-box observations of the reference renderer (calling its exported functions and reading
only their **return values and thrown messages**) were used to pin the observable contract:
`parsePkg` result shape and `version` being a string, `getEntry(pkg, name)` operand order,
`parseTex` key names and the `TEXB0004`→3 downgrade, `mat4Multiply` returning `b · a`,
`mat4TransformPoint` dividing by `w`, `mat4LookAt` writing its basis into *columns*,
`lz4Decompress(src, dstSize)`, and multi-image containers reporting the **first** image's
`freeImageFormat`. Those are facts about behaviour, not copied expression.

## 3. GPL segments **not** opened / **not** copied

Not opened at all:

* `core/attach-transform.mjs`, `core/puppet-skin.js`, `core/we-scene.mjs`,
  `core/scene-project-json.mjs`, `core/baseline-metrics.mjs` — never read.
* `core/we-scene-bundle.js`: the **bodies** of `parsePkg`, `parseTex`, `getEntry`, the
  texture/png sections and the scene sections were never read. No line of the parsers was
  copied, translated, or renamed.
* The sibling MIT plugin `dsh-mpkg-wallpaper/lib/pkg-extract.js`: its **source was never
  read**; only its exported *names* were enumerated at runtime (`Object.keys`), and that
  list was not used as a template either (this package mirrors the renderer-core contract,
  see §7).

Incidentally visible while locating API names (disclosed for completeness, nothing copied):

* A symbol-name `grep` over `core/we-scene-bundle.js` for `mat4*` printed function
  *signature* lines (and, for `mat4Translate`/`mat4Scale`/`mat4RotateZ`, their single-line
  matrix literals) plus two doc-comment lines above `mat4Ortho`/`mat4Perspective`.
  `src/mat4.js` is written from the algebra in §S3/S4/S7 and then **pinned by black-box
  output**; the matrix literals in `src/mat4.js` follow the algebra (translation in row 3,
  `Rz = [c,s,0,0, -s,c,0,0, …]`), which the parity test checks element-by-element anyway.
* The first ~30 lines of `core/we-scene-bundle.js` (licence banner, `import`/`export`
  wiring and an unrelated `frameGeomMode` helper) were read while checking whether the
  module can be imported from Node.
* `tests/tex-fmt5-test.mjs` (lines 1–70) and `tests/publish-check.mjs` / `check.sh` /
  `tests/run-all-tests.sh` (gate mechanics only) were read as repository documentation —
  none of them feeds format logic beyond the `bc3` formula already listed as S5.

## 4. Self-proof (how "independent but identical" is demonstrated)

Three independent lines of evidence, all reproducible in seconds:

1. **Corpus survey (layout derivation).** An independent header walker (this package's own
   `parsePkg` + `parseTex`) was run over the whole local corpus — 26 containers, **646 TEX
   entries** (formats 0/4/5/6/8/9, container versions 1–4, mip counts 1–11, `compression` 0
   and 1, `TEXS` sprites, video-flagged entries). The table identity
   `dataStart + Σ size === fileSize` holds for every container, and each TEX walk consumes
   exactly the entry length; that is what pins the field offsets without reading anyone's
   parser.
2. **Black-box byte parity** — `we-scene-demo/tests/we-core-parity-test.mjs` (host repo,
   GPL side, allowed to import both):
   * per real `.pkg`: entry table fields, entry-name order, and the **sha256 of every entry
     payload**;
   * per `.tex`: header fields, every `image × mip` `{width, height, compression}` and the
     **payload bytes after LZ4 decompression** (for `freeImageFormat === -1` and
     `compression === 0` those payload bytes *are* the pixel bytes), plus the `TEXS` sprite
     structure;
   * matrices: 576 `mat4Multiply` pairs, 16 parameter rounds for
     `Ortho/Perspective/LookAt/Translate/Scale/RotateZ`, `mat4Identity`, and 96
     `mat4TransformPoint` inputs — compared element-wise with `Object.is` (Float32 bits).
   * Corpus used: `allwallpaper/dd/3715743282/scene.pkg` (3.9 MB) and
     `allwallpaper/0917/3250755486/scene.pkg` (7.1 MB). The corpus contains exactly one
     `.pkg` below 5 MB, so the second file is slightly larger; both fit the resource budget
     (<1 s, <100 MB).
3. **Mutation self-proof.** The parity test copies `src/` to a temp dir, changes **one byte**
   in exactly one file (asserting the edit is a single-character difference), re-imports,
   and requires the *same* comparators to go **red**:
   `format.js` (`'ARGB8888'`→`'ARGB8889'`, hits `formatName`), `lz4.js`
   (`matchLength += 4`→`+= 5`, hits decompressed mip bytes), `mat4.js`
   (`out[5] = 2 / …`→`3 / …`, hits `mat4Ortho`). A control run on the unmutated module
   asserts the same three comparators are green.

Unit tests inside the package (`test/*.test.mjs`) never import the GPL side: they use
synthetic containers written byte-by-byte by the tests themselves, hand-computed pixel
vectors, and — when `MPW_ROOT` is set — read-only structural checks on the real corpus.

## 5. Verified here (with the evidence)

* PKG entry-table layout and payload bytes: parity on 42 entries across two real packages
  (`sha256` equality), plus table-identity checks over all 26 corpus containers.
* TEX header, mip descriptors, and mip payload bytes (including **LZ4** blocks, mip chains
  up to 11 levels, `TEXB0001/0003/0004` layouts, and a 42-frame `TEXS` sprite sheet):
  parity on 32 mips across the two packages.
* `mat4` element placement and arithmetic: parity on the inputs listed in §4.2.
* `bindInv × m` order: the workspace's own criterion is re-run in `test/mat4.test.mjs`
  (settled order reproduces the pivot rotation to <1e-4 px; the reverse order is off by
  more than 1 px for the same vertices).
* Package hygiene: MIT manifest, zero dependencies, no external imports, no DOM/GL.

## 6. **Not** verified (写清楚，别当真)

* **Official Wallpaper Engine behaviour.** Every comparison target here is this workspace's
  own renderer core, not the official engine. Whether the official engine accepts exactly
  the same bytes (and how it treats malformed input) is **未证实** — this machine has no
  browser, no GPU and no official runtime.
* **`freeImageFormat === MP4 (35)` containers.** They never appear in the corpus (646 TEX
  entries show only `-1`, `2`, `13`). Such entries are parsed with the standard descriptor
  layout here; the reference renderer's offset for that legacy case was observed to differ
  and is **not** reproduced. Video textures that occur in practice (corpus: `flags & 0x20`
  with `freeImageFormat === -1`, e.g. `透明4.tex`, 960×1008, MP4 payload starting at the
  first mip) *are* handled and their mip payload starts where the corpus says it does.
* **Multi-image "video frame batch" TEX entries.** A small number of entries inside one
  331 MB `.mpkg` (e.g. `背景 合成 1_00000.tex`, `合成 1_00000.tex`) do not follow the
  1-image layout; their layout is **未证实** and the parser deliberately fails with a bounds
  error instead of guessing. The corpus survey also shows container magics up to
  `PKGV0024`/`PKGM0018`; nothing in the layouts changed at those versions, but a future
  version could.
* **Pixel channel order for format 0 (ARGB8888).** The payload bytes are verified
  byte-for-byte; whether they are RGBA or BGRA in memory is **未证实**, so
  `decodePixels(0, …)` copies bytes verbatim and does not swizzle.
* **BC1/BC2/BC3 decoder output** is verified against hand-computed format vectors in
  `test/tex.test.mjs`, not against a renderer: the reference renderer does not export its
  pixel decoder. The same applies to `decodePixels` for formats 1/2/8/9.
* **Compressed PKG entries.** Every corpus package stores payloads raw
  (`dataStart + Σ size === fileSize` exactly), so there was no sample to derive an
  entry-level compression convention from. `lz4Decompress` is exported for callers and is
  used for TEX mips, but "PKG entry decompression" as such is **未证实/not implemented**.
* **Upstream attribution of the format knowledge.** `docs/WE-CORE-PLAN.md` (§1.4 U1, risk
  R1) records that the upstream attribution of the format-parsing lineage is unproven.
  This package therefore carries **no** upstream copyright header and claims none: it cites
  this workspace's own documents plus public format facts only. If a later audit proves an
  upstream MIT lineage, an attribution line can be added without touching the code.
* **Container versions not present in the corpus** (e.g. `TEXB0002` appears in no real
  file): the layout implemented here (20-byte descriptor, no `freeImageFormat` field) comes
  from synthetic black-box probes, not from a real sample. The same holds for multi-image
  containers (every real TEX in the corpus has one image): their field order is probed
  synthetically and the `freeImageFormat` rule for them is the first image's value.

## 7. Deviations from `docs/WE-CORE-PLAN.md` (recorded, not hidden)

1. **Location.** The plan (§2.1) wanted a third sibling repository (`<workspace root>/we-core/`)
   and explicitly said not to nest the package inside either project. This delivery is
   staged at `we-scene-demo/packages/we-core/` because the task specified that path. The
   package imports nothing outside itself and no host file references it, so it can be
   moved to its own repository (and given its own `LICENSE`/git history) without edits.
2. **`mat4` is included.** The plan (§0 last row, §6 item 5) says *not* to build a matrix
   module because the plugin has zero `mat4` consumers ("建了就是凭空抽象"). The task's
   coverage list requires matrix math, so `src/mat4.js` exists — implemented from the
   written conventions, parity-verified, and **isolated**: nothing else in the package
   imports it, so deleting `src/mat4.js` + `test/mat4.test.mjs` restores the plan's scope
   exactly.
3. **API shape.** The plan (§2.2) lists the *MIT plugin's* signatures
   (`parsePkg(data) → {path,offset,length,flags,size}[]`, `readPkgEntry(data, entry)`,
   `parseTex`, `decodeTex`, …). This package mirrors the **renderer core's** contract
   instead (`parsePkg → {magic, version, count, entries:[{name,offset,size}], dataStart,
   fileSize, data}`, `getEntry(pkg, name)`, `parseTex → {format, formatName, flags, …, images,
   sprite}`) because that is the side the byte-for-byte parity target lives on. A future
   adapter for the plugin can be added as a thin wrapper; nothing here is wired yet.
4. **PKG magic strictness.** The plan (risk R4) wants the strict `/^PKGV\d{4}$/` policy
   preserved. This package accepts the whole `PKG[VM]\d{4}` family (identical table layout —
   verified on five real `PKGM0018` bundles) and additionally exports
   `SCENE_PKG_MAGIC_RE` so a consumer can enforce the narrow policy. Since the package is
   unwired, no existing behaviour changes either way; the decision is recorded for the
   wiring task.
