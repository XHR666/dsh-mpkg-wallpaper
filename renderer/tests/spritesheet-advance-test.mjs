// spritesheet-advance-test.mjs — P-208 A10（P-211 号）精灵帧**自动推进**判据。
//
// 官方依据（REVERSE-FINDINGS-7 RE-55）：`Texture::AdvanceSpriteSheet` 在 Texture 层**自动**推进；
// 脚本只通过 getTextureAnimation/playSingleAnimation **读写**状态，不是唯一驱动；层键
// `spritesheetrefreshsync` = 强制与刷新同步换帧。本仓现状与官方不符：只在脚本宿主驱动过该层时
// （setFrame→`__texFrameForced` / play→`__texFramePlay`）才接管 UV（P-36 口径，STATUS #35 的 🟡）。
//
// 本条改法（core/we-scene-bundle.js renderLayer 精灵帧块）：
//   无脚本状态时也推进：`frame = floor(time × rate / frametime)`（回绕由 `spriteFrameRectUV` 取模）。
//   优先级（防双重推进）：forced（钉帧，暂停自动）> rate<=0（脚本冻结）> rate>0（脚本倍率）> 自动（rate=1）。
//   自动分支与脚本 play 共用**同一**时间公式（无累加器 ⇒ 天然无双重推进）。
//   `layer.uvRect`（本仓眼窗校准窗，3 个点名层）优先于 sprite：校准层不自动推进。
//   回退口 `?spriteauto=legacy`。`spritesheetrefreshsync` 解析进层描述符（不丢字段）；
//   本仓推进按渲染时间取帧 = 天然与刷新对齐 ⇒ 两档当前收敛为同一公式（见 P-211 边界）。
//
// 语料读数（本轮实测）：全语料 121 个含 scene.json 容器里，**image 层材质链引用 sprite 表纹理的包 = 0**
// （sprite 表全部落在粒子系统，P-126 已按年龄推进）⇒ 本条对本地语料可见影响 = 0，按规则 A（官方语义
// 已知）实现；真 sprite 表夹具用官方资产 `wallpaper_engine/assets/materials/particle/fog/fog1.tex`
// （64 帧 8×8，与 tests/particle-sprite-verify.mjs 同源）。
//
// 判据四层（全部离线；不起浏览器）：
//   D1 纯函数：官方公式 frame(t)=floor(t·rate/ft) + 回绕（含 rate=帧高/帧宽口径的边界）。
//   D2 真 sprite 表：fog1.tex 的 64 帧 @ t=0/0.5/1.0 三点帧号前进 + 周期闭合（64×0.015625=1.0s）。
//   D3 结构（core 源码序）：自动分支在位、优先级次序、uvRect 豁免、legacy 回退口、refreshsync 解析。
//   D4 变异自证：隔离 core/ 副本真改真跑 ⇒ 期望红集精确相等（真树零改动）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ROOT, WS } from './_root.mjs'
import { readIndexHead, readSlice, walkContainers } from './_pkg-index.mjs'

const FILE = fileURLToPath(import.meta.url)
const CORE_FILE = process.env.MPW_CORE_FILE || path.join(ROOT, 'core', 'we-scene-bundle.js')
const CORE_SRC = fs.readFileSync(CORE_FILE, 'utf8')
const lib = await import(pathToFileURL(CORE_FILE).href)
const MPW_WS = process.env.MPW_ROOT || WS

let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}

console.log('== A10 精灵帧自动推进（RE-55）==')

/* ── D1 纯函数（core 渲染层同式：frame = floor(t·rate/ft)；回绕在 spriteFrameRectUV） ──
   rate<=0 = 冻结（时间公式不参与 ⇒ 镜像返回 null，与 core"停在上一帧"同语义） */
const advanceFrame = (t, ft, rate) => (!(typeof rate === 'number' && isFinite(rate) && rate > 0))
  ? null
  : Math.floor((t || 0) * rate / ((ft > 0) ? ft : 0.1))
{
  const sp = { numFrames: 10, frameWidthUV: 0.1, frameHeightUV: 0.1, frametime: 0.1, duration: 1 }
  // t=0/0.5/1.0，ft=0.1、rate=1 ⇒ 帧 0/5/10（10 回绕成 0）
  const f = [0, 0.5, 1.0].map((t) => advanceFrame(t, sp.frametime, 1) % sp.numFrames)
  check('D1a t=0/0.5/1.0 ⇒ 帧 0/5/0（1.0s 处按 10 帧回绕）', JSON.stringify(f) === '[0,5,0]', JSON.stringify(f))
  // rate=帧高/帧宽（sprite.rate 口径，方格 = 1）：1× 方速；非方格 2× 快放
  const uv = lib.spriteFrameRectUV(sp, 12)
  check('D1b 回绕取模（12 ⇒ 帧 2）且不抛', uv && Math.abs(uv.u0 - 0.2) < 1e-9, uv ? 'u0=' + uv.u0.toFixed(3) : 'null')
  check('D1c rate=0 ⇒ 冻结（时间公式不参与，帧号停在当前值）', advanceFrame(9.9, 0.1, 0) === null, '')
  check('D1d frametime=0 ⇒ 兜底 0.1（防除零）', advanceFrame(1.0, 0, 1) === 10, '')
}

/* ── D2 真 sprite 表（官方资产 fog1.tex：64 帧 8×8） ── */
{
  const FOG = path.join(MPW_WS, 'wallpaper_engine', 'assets', 'materials', 'particle', 'fog', 'fog1.tex')
  if (!fs.existsSync(FOG)) {
    check('D2 官方 fog1 精灵表', false, '资产缺失: ' + FOG)
  } else {
    const fogSprite = lib.spriteInfo(lib.parseTex(new Uint8Array(fs.readFileSync(FOG))))
    const ft = fogSprite.frametime
    const frames = [0, 0.5, 1.0].map((t) => advanceFrame(t, ft, 1) % fogSprite.numFrames)
    check('D2a fog1 = 64 帧 8×8、frametime>0', fogSprite.numFrames === 64 && fogSprite.cols === 8 && fogSprite.rows === 8 && ft > 0,
      `${fogSprite.numFrames}帧 ${fogSprite.cols}x${fogSprite.rows} ft=${ft.toFixed(6)}`)
    check('D2b 无脚本时 t=0/0.5/1.0 三点帧号按官方公式前进（0 → 32 → 回绕 0）',
      JSON.stringify(frames) === '[0,32,0]', JSON.stringify(frames) + ' 周期=' + (ft * 64).toFixed(4) + 's')
    check('D2c 周期闭合：64 × frametime = 1.0s（P-126 官方读数）', Math.abs(ft * 64 - 1.0) < 1e-6, (ft * 64).toFixed(6))
  }
}

/* ── D3 结构（core 源码序：自动分支 + 优先级 + 豁免 + 回退口 + refreshsync 解析） ── */
{
  const gate = /const spriteAuto = !SPRITE_AUTO_LEGACY && !layer\.uvRect/.test(CORE_SRC)
  check('D3a 自动分支在位（`spriteAuto = !SPRITE_AUTO_LEGACY && !layer.uvRect`）', gate, '')
  check('D3b 门条件含自动档（`__texFrameForced || __texFramePlay || spriteAuto`）',
    /layer\.__texFrameForced \|\| layer\.__texFramePlay \|\| spriteAuto/.test(CORE_SRC), '')
  check('D3c 优先级次序未动：forced 钉帧 > rate<=0 冻结 > rate>0 倍率（脚本判据 B4/B5 的锚点仍在）',
    /if \(layer\.__texFrameForced\) \{ frame = Number\(layer\.__texFrame\) \|\| 0; layer\.__spriteFrame = frame \}/.test(CORE_SRC) &&
    /else if \(!\(rate > 0\)\) \{ frame = \(typeof layer\.__spriteFrame === 'number'\)/.test(CORE_SRC) &&
    /frame = Math\.floor\(\(time \|\| 0\) \* rate \/ ft\)/.test(CORE_SRC), '')
  check('D3d 回退口 `?spriteauto=legacy`（SPRITE_AUTO_LEGACY 解析在位）',
    /get\('spriteauto'\) === 'legacy'/.test(CORE_SRC), '')
  check('D3e `spritesheetrefreshsync` 解析进层描述符（不丢字段）',
    /spritesheetrefreshsync: o\.spritesheetrefreshsync === true \? true/.test(CORE_SRC), '')
  // D3f 语料：带 scene.json 的容器里层描述符都带 spritesheetrefreshsync 字段（解析不丢；语料 0 命中也保留落点）
  try {
    const f = walkContainers(path.join(MPW_WS, 'allwallpaper/0923')).find((x) => x.includes('3589454154'))
    const idx = readIndexHead(f)
    const se = idx.entries.find((x) => /(^|\/)scene\.json$/i.test(x.name))
    const sj = lib.parseWeJson(readSlice(f, idx.dataStart + se.off, se.size).toString('utf8'))
    const scene = lib.parseScene(sj, null, {})
    check('D3f 真包层的 spritesheetrefreshsync 字段可读（null/值都保留，防将来要用时字段已被丢）',
      scene.layers.length > 0 && scene.layers.every((l) => 'spritesheetrefreshsync' in l),
      'layers=' + scene.layers.length + ' 值分布=' + JSON.stringify({
        true: scene.layers.filter((l) => l.spritesheetrefreshsync === true).length,
        null: scene.layers.filter((l) => l.spritesheetrefreshsync == null).length,
      }))
  } catch (e) {
    check('D3f 真包层的 spritesheetrefreshsync 字段可读', false, '语料缺失: ' + e.message)
  }
}

/* ── D4 变异自证（隔离 core/ 副本真改真跑） ── */
const MUTANTS = [
  // ① 自动分支摘掉（回到"只在脚本驱动时接管"）：D3a/D3b 红（D3 组）
  { id: 'no-auto', expect: ['D3'], edit: (s) => s.replace('const spriteAuto = !SPRITE_AUTO_LEGACY && !layer.uvRect', 'const spriteAuto = false') },
  // ② spritesheetrefreshsync 字段解析被丢（规则 B：不许丢字段）：D3e 红（D3 组）
  { id: 'drop-refreshsync', expect: ['D3'], edit: (s) => s.replace(/spritesheetrefreshsync: o\.spritesheetrefreshsync === true \? true[^\n]*\n/, '') },
]
if (!process.argv.includes('--no-mutations')) {
  console.log('== D4 变异自证（隔离 core/ 副本；真树不动）==')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-spriteauto-'))
  for (const m of MUTANTS) {
    const root = path.join(tmp, m.id)
    fs.mkdirSync(path.join(root, 'core'), { recursive: true })
    for (const f of fs.readdirSync(path.join(ROOT, 'core'))) fs.copyFileSync(path.join(ROOT, 'core', f), path.join(root, 'core', f))
    const target = path.join(root, 'core', 'we-scene-bundle.js')
    const mutated = m.edit(CORE_SRC)
    if (mutated === CORE_SRC) { check('D4 ' + m.id + ' 变异真的改到了（锚点未命中 ⇒ 判据腐烂）', false); continue }
    fs.writeFileSync(target, mutated)
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}')
    const r = spawnSync(process.execPath, [FILE, '--no-mutations'], {
      encoding: 'utf8', maxBuffer: 32 << 20,
      env: { ...process.env, MPW_CORE_FILE: target, MPW_REPO_ROOT: ROOT },
    })
    const groups = new Set((r.stdout || '').split('\n').filter((l) => l.includes('✗')).map((l) => (/✗\s*(D\d)/.exec(l) || [])[1]).filter(Boolean))
    const got = [...groups].sort(), want = [...m.expect].sort()
    check('D4 ' + m.id + '：期望红集精确相等', JSON.stringify(got) === JSON.stringify(want),
      '期望 ' + JSON.stringify(want) + ' 实际 ' + JSON.stringify(got) + ' exit=' + r.status)
    if (JSON.stringify(got) === JSON.stringify(want)) console.log('    MUTANT-RED-OK ' + m.id + ' 红集=' + JSON.stringify(got))
  }
  check('D4 真树 core 未被变异触碰', fs.readFileSync(CORE_FILE, 'utf8') === CORE_SRC)
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log('\n===== spritesheet-advance: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
process.exit(fail ? 1 : 0)
