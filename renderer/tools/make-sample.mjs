// tools/make-sample.mjs — generate a hand-authored, copyright-clean sample Wallpaper Engine scene package.
//
// WHY: the public repo must ship at least one sample that is provably not third-party Workshop
// content. Every real package on this machine is somebody else's artwork, so the sample is built
// here, from arithmetic only: every pixel comes from the procedural generators below, every JSON
// byte is written by this file. No fonts, no photos, no ripped assets.
//
// WHAT IT WRITES (default `--out samples`):
//   samples/sample-synthetic/scene.pkg      PKG container the renderer eats directly (?pkgpath=/pkgurl=)
//   samples/sample-synthetic/project.json   workshop-style sibling file (WE layout: scene.pkg + project.json)
//   samples/sample-synthetic-src/**         the same 8 files loose (scene.json, models/, materials/)
//                                           → `node server/pack-dir.mjs samples/sample-synthetic-src` repacks them
//                                             byte-identically (directory-source / mixed-loading path)
//
// CONTAINER FORMAT (must match dsh-mpkg-wallpaper/lib/pkg-extract.js `parsePkg` and the renderer's
// core/we-scene-bundle.js `parsePkg`, both verified below):
//   sizedString(magic = 'PKGV0022')       // i32 length + UTF-8, matches server/pack-dir.mjs
//   i32 entryCount
//   entryCount × { sizedString(path), u32 offset, u32 length }   // offset relative to the data area
//   <data area>                            // stored raw (flags=0), so probeCompressedEntry never bites
//
// TEXTURE FORMAT (`WE TEX`, the simplest legal case the renderer's decoder accepts):
//   'TEXV0005\0' 'TEXI0001\0'  i32 format=0 (RGBA8888)  i32 flags=0
//   u32 textureWidth  u32 textureHeight  u32 imageWidth  u32 imageHeight  u32 0xFF000000
//   'TEXB0001\0'  u32 imageCount=1  u32 mipCount=1  u32 w  u32 h  i32 byteLen  <raw RGBA>
//   (bundle parseTex reads the 9-byte NUL-terminated magics + TEXB0001; pkg-extract nstring(16)
//    stops at the same NUL, and both decode format 0 as straight RGBA bytes.)
//
// USAGE
//   node tools/make-sample.mjs                      # write/refresh samples/**
//   node tools/make-sample.mjs --out <dir>          # write somewhere else
//   node tools/make-sample.mjs --prod-verify        # also re-read scene.pkg with the PRODUCTION parser
//                                             # (dsh-mpkg-wallpaper/lib/pkg-extract.js, sha256 per entry)
//   node tools/make-sample.mjs --pkg-extract <path> # override that parser path
//
// DETERMINISM: no timestamps, no randomness, entries sorted by path, fixed JSON formatting →
// byte-identical output for the same arguments (see --prod-verify + `sha256sum` in samples/README.md).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
// ①(P-101 2026-09-16 目录再整理) 本脚本移入 `tools/`：`HERE` 只是脚本目录，
//   产物落点与语料根一律按**仓库根**（= HERE/..）解析，别拿 HERE 当根用。
const REPO_ROOT = path.resolve(HERE, '..')
const PKG_MAGIC = 'PKGV0022'                 // same magic server/pack-dir.mjs writes; parsePkg only checks /^PKGV\d{4}$/
const DESIGN_W = 1920, DESIGN_H = 1080       // general.orthogonalprojection — the design canvas
const FPS = 30                               // extractAnimKf() samples keyframes at frame/30 seconds

// ─────────────────────────────────────────────────────────────────────────────
// binary writers
// ─────────────────────────────────────────────────────────────────────────────
const i32 = (n) => { const b = Buffer.allocUnsafe(4); b.writeInt32LE(n | 0); return b }
const u32 = (n) => { const b = Buffer.allocUnsafe(4); b.writeUInt32LE(n >>> 0); return b }
/** i32-length-prefixed UTF-8 string (PKG magic + entry paths). */
const sizedString = (s) => { const p = Buffer.from(s, 'utf8'); return Buffer.concat([i32(p.length), p]) }
/** NUL-terminated ASCII string (TEX magics). */
const nstring = (s) => Buffer.concat([Buffer.from(s, 'ascii'), Buffer.from([0])])

/**
 * Build a PKG container from [{ path, bytes }]. Entries are sorted by path so two runs (and
 * server/pack-dir.mjs, which sorts the same way) produce identical bytes.
 */
function buildPkg(files) {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const head = [sizedString(PKG_MAGIC), i32(sorted.length)]
  let offset = 0
  for (const f of sorted) { f.offset = offset; offset += f.bytes.length }
  for (const f of sorted) head.push(sizedString(f.path), u32(f.offset), u32(f.bytes.length))
  const header = Buffer.concat(head)
  return { buf: Buffer.concat([header, ...sorted.map((f) => f.bytes)]), entries: sorted }
}

/**
 * Encode raw RGBA8888 pixels as a TEX container (TEXV0005 / TEXI0001 / format 0 / TEXB0001, 1 mip).
 * The declared texture and image dimensions are equal, so the renderer's decodeMip0 performs no crop.
 */
function buildTexRGBA(w, h, rgba) {
  if (rgba.length !== w * h * 4) throw new Error(`tex: expected ${w * h * 4} bytes, got ${rgba.length}`)
  return Buffer.concat([
    nstring('TEXV0005'), nstring('TEXI0001'),
    i32(0),            // format 0 = RGBA8888 (TEXTURE_FORMATS[0] 'ARGB8888' in the bundle, RGBA byte order)
    i32(0),            // flags 0 = static texture (no sprite-sheet block, no video)
    u32(w), u32(h),    // textureWidth / textureHeight
    u32(w), u32(h),    // imageWidth / imageHeight (identical → no crop in decodeImageMip0)
    u32(0xFF000000),   // editor field, ignored by both parsers
    nstring('TEXB0001'),
    u32(1),            // imageCount
    u32(1),            // mipCount (renderer only ever samples mip0; GL generates its own chain)
    u32(w), u32(h), i32(rgba.length), Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength),
  ])
}

// ─────────────────────────────────────────────────────────────────────────────
// procedural art (pure arithmetic — this is the "no third-party content" guarantee)
// ─────────────────────────────────────────────────────────────────────────────
const lerp = (a, b, t) => a + (b - a) * t
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x)
const smooth = (t) => t * t * (3 - 2 * t)
const to8 = (x) => Math.max(0, Math.min(255, Math.round(clamp01(x) * 255)))
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]

/** Background: vertical navy→indigo gradient + diagonal band + cyan glow + vignette. */
function texBackground(w = 80, h = 45) {
  const px = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    const v = h > 1 ? y / (h - 1) : 0
    for (let x = 0; x < w; x++) {
      const u = w > 1 ? x / (w - 1) : 0
      let r = lerp(0.015, 0.055, smooth(v))
      let g = lerp(0.025, 0.095, smooth(v))
      let b = lerp(0.080, 0.215, smooth(v))
      const band = Math.exp(-Math.pow((u - 0.18 + v * 0.42) * 3.0, 2))     // diagonal light band
      r += 0.040 * band; g += 0.070 * band; b += 0.140 * band
      const dx = (u - 0.74) * 1.05, dy = v - 0.36                          // soft teal glow
      const glow = Math.exp(-(dx * dx + dy * dy) * 10)
      r += 0.100 * glow; g += 0.240 * glow; b += 0.320 * glow
      const vig = 1 - 0.34 * Math.pow(Math.max(Math.abs(u - 0.5), Math.abs(v - 0.5)) * 2, 2.4)
      const o = (y * w + x) * 4
      px[o] = to8(r * vig); px[o + 1] = to8(g * vig); px[o + 2] = to8(b * vig); px[o + 3] = 255
    }
  }
  return px
}

/** Orb: white-hot core, cyan falloff, thin rim ring; alpha reaches 0 before the quad's corner. */
function texOrb(w = 56, h = 56) {
  const px = new Uint8Array(w * h * 4)
  const RIM = [0.24, 0.72, 1.00], CORE = [0.92, 0.98, 1.00]
  for (let y = 0; y < h; y++) {
    const v = h > 1 ? y / (h - 1) : 0
    for (let x = 0; x < w; x++) {
      const u = w > 1 ? x / (w - 1) : 0
      const d = Math.hypot(u - 0.5, v - 0.5) * 2                 // 1.0 = inscribed-circle edge
      const core = Math.exp(-Math.pow(d / 0.42, 2))
      const ring = Math.exp(-Math.pow((d - 0.74) / 0.16, 2)) * 0.55
      const edge = clamp01((1.0 - d) / 0.10)                      // hard-ish cutoff at the circle
      const a = clamp01(core * 1.05 + ring) * edge
      const c = mix3(RIM, CORE, clamp01(core))
      const o = (y * w + x) * 4
      px[o] = to8(c[0]); px[o + 1] = to8(c[1]); px[o + 2] = to8(c[2]); px[o + 3] = to8(a)
    }
  }
  return px
}

// ─────────────────────────────────────────────────────────────────────────────
// scene / project description
// ─────────────────────────────────────────────────────────────────────────────
const rgb = (s) => s.split(' ').map(Number)

/** Keyframed property, WE shape: { value, animation: { c0/c1: [{frame, value}], options } }. */
function anim(base, c0, c1, length) {
  const ch = (kf) => kf.map(([frame, value]) => ({ frame, value }))
  const out = { value: base, animation: { options: { fps: FPS, length, mode: 'loop' } } }
  if (c0) out.animation.c0 = ch(c0)
  if (c1) out.animation.c1 = ch(c1)
  return out
}

/**
 * scene.json — 5 objects: a textured background, a compose group, and (inside it) a moving orb,
 * a sweeping solid-colour accent bar, and a text label. Only documented WE scene fields are used.
 *
 * Coordinate note: authored `origin` is editor y-up, and parseScene flips it once
 * (render y = DESIGN_H − authored y). Origin *animation* keyframes are consumed by the renderer in
 * the flipped (y-down) space (bundle compositeLayer: `oy = animValueAt(c1, time)`), so the c1
 * keyframes below start at DESIGN_H − authoredY and every frame-0 value equals the static value.
 * That keeps the CPU preview (static, t=0) and the WebGL renderer (t=0) pixel-aligned.
 */
function sceneJson() {
  return {
    camera: null,
    general: {
      ambientcolor: '0.20000 0.20000 0.25000',
      bloom: false,
      clearcolor: '0.02000 0.03000 0.07000',
      clearenabled: true,
      farz: 10000,
      fov: 50,
      hdr: false,
      nearz: 0.01,
      orthogonalprojection: { height: DESIGN_H, width: DESIGN_W },
      zoom: 1,
    },
    objects: [
      { // 1. background — procedural gradient texture, fills the design canvas
        id: 1,
        name: 'background',
        image: 'models/background.json',
        origin: '960.00000 540.00000 0.00000',
        size: `${DESIGN_W}.00000 ${DESIGN_H}.00000`,
        scale: '1.00000 1.00000 1.00000',
        angles: '0.00000 0.00000 0.00000',
        alpha: 1,
        visible: true,
      },
      { // 2. group container — never drawn, children inherit its transform
        id: 2,
        name: 'motion',
        image: 'models/util/composelayer.json',
        origin: '0.00000 0.00000 0.00000',
        scale: '1.00000 1.00000 1.00000',
        visible: true,
      },
      { // 3. accent — built-in solid-colour model, no texture; sweeps vertically (animated origin.c1)
        id: 3,
        name: 'accent',
        image: 'models/util/solidlayer.json',
        solid: true,
        color: { user: 'accentColor', value: '0.12000 0.62000 0.86000' },
        origin: anim('960.00000 300.00000 0.00000', null, [[0, 780], [75, 300], [150, 780]], 150),
        size: '1920.00000 10.00000',
        scale: '1.00000 1.00000 1.00000',
        alpha: 0.28,
        visible: true,
      },
      { // 4. orb — procedural sprite, child of the group; sweeps horizontally + breathes (origin.c0/scale)
        id: 4,
        name: 'orb',
        parent: 2,
        image: 'models/orb.json',
        origin: anim('560.00000 440.00000 0.00000', [[0, 560], [60, 1360], [120, 560]], null, 120),
        size: '280.00000 280.00000',
        scale: anim('1.00000 1.00000 1.00000', [[0, 1], [30, 1.14], [60, 1], [90, 1.14], [120, 1]],
          [[0, 1], [30, 1.14], [60, 1], [90, 1.14], [120, 1]], 120),
        angles: '0.00000 0.00000 0.00000',
        alpha: 1,
        visible: true,
      },
      { // 5. label — real WE text layer (rasterised by the renderer, drawn as its colour box by preview.mjs)
        id: 5,
        name: 'label',
        text: { user: 'labelText', value: 'SYNTHETIC SAMPLE' },
        font: '',
        pointsize: { user: 'labelSize', value: 44 },
        color: '0.78000 0.90000 1.00000',
        origin: '960.00000 130.00000 0.00000',
        size: '760.00000 84.00000',
        scale: '1.00000 1.00000 1.00000',
        horizontalalign: 'center',
        verticalalign: 'center',
        alpha: 0.92,
        visible: { user: 'labelVisible', value: true },
      },
    ],
    version: 1,
  }
}

/** project.json — WE workshop metadata; every property referenced by scene.json is declared here. */
function projectJson() {
  return {
    contentrating: 'Everyone',
    description: 'Hand-authored sample scene generated by tools/make-sample.mjs. Contains no third-party content.',
    file: 'scene.pkg',
    general: {
      properties: {
        accentColor: { index: 0, order: 100, text: 'Accent colour', type: 'color', value: '0.12000 0.62000 0.86000' },
        labelSize: { index: 1, order: 101, text: 'Label size', type: 'slider', value: 44, min: 12, max: 96, step: 1 },
        labelText: { index: 2, order: 102, text: 'Label text', type: 'textinput', value: 'SYNTHETIC SAMPLE' },
        labelVisible: { index: 3, order: 103, text: 'Show label', type: 'bool', value: true },
      },
      supportsaudioprocessing: false,
      supportsvideo: false,
    },
    // no "preview" key on purpose: this sample ships no rasterised artwork, and pointing at a
    // preview file that does not exist would be worse than omitting it (see samples/README.md).
    tags: ['sample', 'synthetic'],
    title: 'Sample — Synthetic',
    type: 'Scene',
    version: 1,
    visibility: 'public',
  }
}

const MODEL = (material) => ({ autosize: true, material })
const MATERIAL = (texture) => ({
  passes: [{
    alphawriting: 'default',
    blending: 'translucent',
    combos: {},
    cullmode: 'normal',
    depthtest: 'disabled',
    depthwrite: 'disabled',
    shader: 'genericimage4',
    textures: [texture],
  }],
})

/** The 8 files that go into scene.pkg (also written loose when --src-dir is used). */
function buildFiles() {
  const json = (o) => Buffer.from(JSON.stringify(o, null, 2) + '\n', 'utf8')
  return [
    { path: 'materials/background.json', bytes: json(MATERIAL('background')) },
    { path: 'materials/background.tex', bytes: buildTexRGBA(80, 45, texBackground(80, 45)) },
    { path: 'materials/orb.json', bytes: json(MATERIAL('orb')) },
    { path: 'materials/orb.tex', bytes: buildTexRGBA(56, 56, texOrb(56, 56)) },
    { path: 'models/background.json', bytes: json(MODEL('materials/background.json')) },
    { path: 'models/orb.json', bytes: json(MODEL('materials/orb.json')) },
    { path: 'project.json', bytes: json(projectJson()) },
    { path: 'scene.json', bytes: json(sceneJson()) },
  ]
}

// ─────────────────────────────────────────────────────────────────────────────
// write + verify
// ─────────────────────────────────────────────────────────────────────────────
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex')
const kb = (n) => (n / 1024).toFixed(1) + ' KB'

function writeDir(dir, files) {
  fs.mkdirSync(dir, { recursive: true })
  for (const f of files) {
    const abs = path.join(dir, f.path)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, f.bytes)
  }
}

/** Re-read scene.pkg with the PRODUCTION parser and compare every entry's sha256 with what we wrote. */
async function prodVerify(pkgPath, files, extractPath) {
  const mod = await import(pathToFileURL(extractPath).href)
  if (typeof mod.parsePkg !== 'function' || typeof mod.readPkgEntry !== 'function') {
    throw new Error(extractPath + ' does not export parsePkg/readPkgEntry')
  }
  const buf = fs.readFileSync(pkgPath)
  const index = mod.parsePkg(new Uint8Array(buf))
  const byPath = new Map(index.map((e) => [e.path, e]))
  let bad = 0, bytes = 0
  console.log(`  parsePkg(${path.basename(pkgPath)}) → ${index.length} entries, compressed=${index.filter((e) => e.flags).length}`)
  for (const f of files) {
    const e = byPath.get(f.path)
    if (!e) { console.log(`  ✗ missing entry ${f.path}`); bad++; continue }
    const got = Buffer.from(mod.readPkgEntry(new Uint8Array(buf), e))
    const a = sha256(got), b = sha256(f.bytes)
    bytes += got.length
    console.log(`  ${a === b && got.length === f.bytes.length ? '✓' : '✗'} ${f.path} ${got.length}B sha256=${a.slice(0, 16)}…`)
    if (a !== b || got.length !== f.bytes.length) bad++
  }
  if (bad) throw new Error(`production parsePkg verification failed for ${bad} entr${bad === 1 ? 'y' : 'ies'}`)
  console.log(`  production parser: ${files.length} entries / ${kb(bytes)} of payload round-trip byte-identical`)
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('usage: node tools/make-sample.mjs [--out <samples dir>] [--prod-verify] [--pkg-extract <path>] [--quiet]')
    return
  }
  const argOf = (name, dflt) => {
    const i = argv.indexOf(name)
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt
  }
  const quiet = argv.includes('--quiet')
  const outRoot = path.resolve(argOf('--out', path.join(REPO_ROOT, 'samples')))
  const pkgDir = path.join(outRoot, 'sample-synthetic')
  const srcDir = path.join(outRoot, 'sample-synthetic-src')

  const files = buildFiles()
  const { buf: pkg, entries } = buildPkg(files)
  writeDir(srcDir, files)                                  // loose source dir (directory-loading fixture)
  fs.mkdirSync(pkgDir, { recursive: true })
  fs.writeFileSync(path.join(pkgDir, 'scene.pkg'), pkg)
  const project = files.find((f) => f.path === 'project.json')
  fs.writeFileSync(path.join(pkgDir, 'project.json'), project.bytes)

  if (!quiet) {
    console.log(`sample written: ${pkgDir}`)
    console.log(`  scene.pkg      ${pkg.length} B (${kb(pkg.length)})  sha256=${sha256(pkg)}`)
    console.log(`  entries        ${entries.length}`)
    for (const f of entries) console.log(`    ${f.path.padEnd(28)} ${String(f.bytes.length).padStart(7)} B  sha256=${sha256(f.bytes).slice(0, 16)}…`)
    console.log(`  source dir     ${srcDir}`)
    console.log(`  textures       RGBA8888 / TEXB0001, procedurally generated (background 80x45, orb 56x56)`)
  }
  if (argv.includes('--prod-verify')) {
    // ①(2026-10-30 路径固化) 插件树解析：env MPW_PLUGIN_DIR → 集成布局 `REPO_ROOT/../plugin` → 旧兄弟仓名回退。
    const pluginTree = [process.env.MPW_PLUGIN_DIR,
      path.join(REPO_ROOT, '..', 'plugin'),
      path.join(REPO_ROOT, '..', 'dsh-mpkg-wallpaper')].filter(Boolean)
      .find((p) => { try { return fs.existsSync(path.join(p, 'lib', 'pkg-extract.js')) } catch { return false } })
      || path.join(REPO_ROOT, '..', 'plugin')
    const extractPath = path.resolve(argOf('--pkg-extract', path.join(pluginTree, 'lib', 'pkg-extract.js')))
    await prodVerify(path.join(pkgDir, 'scene.pkg'), files, extractPath)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => { console.error('✗ ' + (e && e.message || e)); process.exit(1) })
}
