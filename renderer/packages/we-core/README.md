# @xferoni66/we-core

Wallpaper Engine **binary-format core**: PKG container reading, TEX container reading
(header + image/mip descriptors + LZ4 mip payloads + `TEXS` sprite trailer), format
constants, raw pixel-format decoding, and the workspace's row-major `mat4` math.

**No rendering.** This package contains no GL/WebGL calls, no shaders, no DOM/`window`/
`canvas`, no image upload, and no wallpaper semantics (layers, cameras, properties,
effects, audio/video routing). It reads bytes and does arithmetic; everything visual stays
in the consuming project.

一句话中文：本包只做「读容器 + 算矩阵」，不含任何渲染/GL/DOM 代码。

* License: **MIT** (see `LICENSE`) — the package may be used by MIT *and* GPL projects;
  it must never import GPL code itself (see `PROVENANCE.md` §1).
* Dependencies: **none** — not even Node built-ins are imported, so `src/` also runs in a
  browser when served as plain ES modules.
* Node: `>= 20` (ESM, `"type": "module"`).

## Scope

| Area | Provided |
|---|---|
| PKG container | `parsePkg`, `readPkgEntry`, `getEntry`, `findEntry`, `hasEntry`, `entryNames` |
| TEX container | `parseTex`, `parseTexHeader`, `parseSprite`, `firstMipmap`, `freeImageFormatOf`, `isVideoFlags` |
| Payload codec | `lz4Decompress` (LZ4 block), mip payload decompression for `compression === 1` |
| Pixel formats | `decodePixels` (→ RGBA) for `0 ARGB8888`, `1 RGB888`, `2 RGB565`, `4 DXT5`, `5 DXT5-half`, `6 DXT3`, `7 DXT1`, `8 RG88`, `9 R8`; `expectedPayloadSize`, `payloadSizeMatches` |
| Constants | `TEXTURE_FORMATS`, `texFormatName`, `FIF`, `TEX_FLAG_IS_VIDEO`, `isVideoTex`, container magics, `BYTES_PER_PIXEL`, `BLOCK_BYTES` |
| Math | `mat4Identity/Multiply/Translate/Scale/RotateZ/Ortho/Perspective/LookAt/TransformPoint`, `bindInvTimesM` |

Deliberately **out of scope**: GL/WebGL, shaders, DOM, canvas, mip selection/upload,
PNG/JPEG/GIF/WEBP/MP4 *decoding* (embedded payloads are returned as bytes), `.mdl`/puppet
model parsing, scene/layer/camera semantics, project.json discovery, filesystem layout
defaults, audio/video track indexing.

## Usage

```js
import { parsePkg, getEntry, parseTex, decodePixels, lz4Decompress, mat4Ortho } from '@xferoni66/we-core'
import { readFileSync } from 'node:fs'

const pkg = parsePkg(readFileSync('scene.pkg'))          // { magic, version, count, entries, dataStart, fileSize, data }
const entry = getEntry(pkg, 'materials/凯尔希.tex')        // Uint8Array view, no copy
const tex = parseTex(entry)
// tex = { format, formatName, flags, textureWidth, textureHeight, width, height,
//         freeImageFormat, containerMagic, containerVersion, isVideo, images, sprite }
const mip0 = tex.images[0][0]                            // { width, height, compression, uncompressedSize, dataSize, data }
const rgba = decodePixels(tex.format, mip0.width, mip0.height, mip0.data)

const projection = mat4Ortho(0, 1920, 0, 1080, -10000, 10000) // row-major Float32Array(16)
```

Sub-path imports are available for tree-shaking and for callers that only need one area:
`@xferoni66/we-core/pkg`, `/tex`, `/pixels`, `/mat4`, `/format`, `/lz4`.

### Conventions you must know before using `mat4`

* Storage is **row-major** (`m[row * 4 + col]`) and vectors are **row vectors**
  (`v' = v · M`), so affine translation lives in indices 12, 13, 14.
* `mat4Multiply(a, b)` follows the reference renderer's operand order and returns the
  matrix product **`b · a`** — for a row vector, `b` is applied first, then `a`. This is
  spelled out in `src/mat4.js` because the name reads the other way round.
* `mat4TransformPoint` divides by `w` (projective), matching the reference renderer.
* `bindInvTimesM(bindInv, m)` is the settled bone-matrix order `bindInv × m` (bind-space
  inverse applied to the vertex first, then the animated world matrix) — decided in
  `we-scene-demo/docs/UNTOUCHED-AREAS.md` by a rigid-rotation criterion, and re-tested in
  `test/mat4.test.mjs`.

## Tests

```bash
node --test test/*.test.mjs                     # seconds; synthetic fixtures only
MPW_ROOT=<workspace root> node --test test/*.test.mjs   # also checks the real corpus (read-only)
```

The byte-for-byte black-box comparison against this workspace's reference renderer lives in
the host repository (`we-scene-demo/tests/we-core-parity-test.mjs`), because a MIT package
must not depend on GPL code — see `PROVENANCE.md` §1 and §3.

## Status

`0.1.0` — **package only, not wired**: no consumer imports it yet, and the GPL host
repository is unchanged. See `PROVENANCE.md` §6 for the open/unverified items and §7 for
the deviation from `docs/WE-CORE-PLAN.md`'s planned location.
