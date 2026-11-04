// manifest.test.mjs — package-level invariants of we-core (MIT, zero dependencies, no
// rendering/DOM/GL, and — the licence red line — nothing imported from the GPL project
// that hosts this staging directory).
//
// 说明（中文）：本包是 MIT，宿主仓库是 GPL-3.0-or-later。许可只能单向流动 MIT → GPL，
// 所以这里机器化地守住两条：① 包内源文件不得 import 包外任何东西（连 node: 内置都不用，
// 于是浏览器也能直接跑）；② 源码里不得出现 DOM/GL 调用。改了红线这里必红。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const PKG_DIR = path.resolve(import.meta.dirname, '..')
const SRC_DIR = path.join(PKG_DIR, 'src')
const pkg = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'package.json'), 'utf8'))

test('package.json：MIT / ESM / 零依赖 / files 白名单', () => {
  assert.equal(pkg.license, 'MIT')
  assert.equal(pkg.type, 'module')
  assert.deepEqual(pkg.dependencies ?? {}, {})
  assert.deepEqual(pkg.peerDependencies ?? {}, {})
  assert.deepEqual(pkg.optionalDependencies ?? {}, {})
  assert.ok(Array.isArray(pkg.files) && pkg.files.includes('src/'), 'files 白名单必须含 src/')
  for (const f of ['LICENSE', 'README.md', 'PROVENANCE.md']) assert.ok(pkg.files.includes(f), `files 白名单缺 ${f}`)
  for (const [sub, target] of Object.entries(pkg.exports)) {
    if (sub === './package.json') continue
    assert.ok(fs.existsSync(path.join(PKG_DIR, target)), `exports["${sub}"] → ${target} 不存在`)
  }
  assert.match(pkg.engines.node, />=\s*20/)
})

test('src/ 的每个 import 都是包内相对路径（不得 import 包外/GPL 代码）', () => {
  const files = fs.readdirSync(SRC_DIR).filter((f) => f.endsWith('.js'))
  assert.ok(files.length >= 5, 'src/ 文件数异常')
  for (const f of files) {
    const text = fs.readFileSync(path.join(SRC_DIR, f), 'utf8')
    const specs = [...text.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
    for (const s of specs) {
      assert.ok(s.startsWith('./') || s.startsWith('../'), `${f}: 非相对 import "${s}"（MIT 包不得依赖外部代码）`)
      assert.ok(fs.existsSync(path.resolve(SRC_DIR, s)), `${f}: import "${s}" 指向不存在的文件`)
    }
    assert.ok(!/\brequire\s*\(/.test(text), `${f}: 出现 require()（本包是 ESM）`)
    assert.ok(!/\bimport\s*\(/.test(text), `${f}: 出现动态 import()（本包必须静态可分析）`)
  }
})

test('src/ 不含 DOM / GL / 渲染调用（本包只读文件 + 做数学）', () => {
  const banned = [/\bdocument\s*\./, /\bwindow\s*\./, /\bnavigator\s*\./, /WebGLRenderingContext/, /createShader\s*\(/, /uniformMatrix/, /gl\s*\.\s*draw/, /\bHTMLCanvasElement\b/]
  for (const f of fs.readdirSync(SRC_DIR).filter((x) => x.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(SRC_DIR, f), 'utf8')
    for (const re of banned) assert.ok(!re.test(text), `${f}: 命中禁止模式 ${re}`)
  }
})

test('许可与来源文件齐备，且用词遵守本仓裁定（写"独立实现"，不写"洁净室"）', () => {
  const license = fs.readFileSync(path.join(PKG_DIR, 'LICENSE'), 'utf8')
  assert.match(license, /^MIT License/)
  assert.match(license, /Permission is hereby granted/)
  const provenance = fs.readFileSync(path.join(PKG_DIR, 'PROVENANCE.md'), 'utf8')
  assert.match(provenance, /independent implementation/i)
  assert.match(provenance, /独立实现/)
  assert.ok(!/洁净室|clean\s*room/i.test(provenance), '用词裁定：不写"洁净室/clean room"')
  const readme = fs.readFileSync(path.join(PKG_DIR, 'README.md'), 'utf8')
  assert.match(readme, /MIT/)
  assert.match(readme, /no rendering|No rendering|不渲染/i)
})

test('导出面稳定（0.x 期间只加不删）', async () => {
  const mod = await import(path.join(SRC_DIR, 'index.js'))
  const expected = [
    'BLOCK_BYTES', 'BYTES_PER_PIXEL', 'DECODABLE_FORMATS', 'FIF', 'PKG_MAGIC_RE', 'SCENE_PKG_MAGIC_RE',
    'TEXTURE_FORMATS', 'TEX_CONTAINER_MAGIC_RE', 'TEX_CONTAINER_VERSIONS', 'TEX_FLAG_IS_VIDEO', 'TEX_IMAGE_MAGIC',
    'TEX_MAGIC', 'TEX_SPRITE_MAGIC_RE', 'bindInvTimesM', 'decodePixels', 'entryNames', 'expectedPayloadSize',
    'findEntry', 'firstMipmap', 'freeImageFormatOf', 'getEntry', 'hasEntry', 'isVideoFlags', 'isVideoTex',
    'lz4Decompress', 'mat4Identity', 'mat4LookAt', 'mat4Multiply', 'mat4Ortho', 'mat4Perspective', 'mat4RotateZ',
    'mat4Scale', 'mat4TransformPoint', 'mat4Translate', 'parsePkg', 'parseSprite', 'parseTex', 'parseTexHeader',
    'payloadSizeMatches', 'readPkgEntry', 'toBytes', 'texFormatName',
  ]
  assert.deepEqual(Object.keys(mod).sort(), [...expected].sort())
})
