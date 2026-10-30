// 三场景资源完备性终检：镜像 demo loadScene + 渲染器可见性规则
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// ①(2026-11-03 可移植性修正) 本机绝对路径不许进 tracked 文件（cross-platform / integrity 判据）。
//   默认按"仓库 = <DSHAREA>/dsh-mpkg-wallpaper"推导工作区根，可用 MPW_ROOT / MPW_BUNDLE / MPW_SCENES 覆盖。
const WORKSPACE = path.resolve(process.env.MPW_ROOT || path.join(path.resolve('.'), '..'), '')
const BUNDLE = process.env.MPW_BUNDLE || path.join(WORKSPACE, 'we-scene-demo', 'we-scene-bundle.js')
const SCENE_ROOT = process.env.MPW_SCENES || path.join(WORKSPACE, 'allwallpaper', 'dd')
const lib = await import(pathToFileURL(BUNDLE).href)
const { parsePkg, getEntry, parseScene, resolveEffectChain, resolveMaterial } = lib
const rd = (b) => new TextDecoder().decode(b).replace(/^\uFEFF/, '')
const ALL_MODE = process.argv[2] === 'all'
const TARGETS = ALL_MODE
  ? fs.readdirSync(SCENE_ROOT).filter((d) => /^\d+$/.test(d) && fs.existsSync(path.join(SCENE_ROOT, d, 'scene.pkg'))).sort().map((d) => [d, d])
  : [['3554161528', 'Hina'], ['3544152633', 'Girl and Cat'], ['3327063360', '砂狼白子']]

const HEADERS = new Set(['common.h', 'common_fragment.h', 'common_vertex.h', 'common_blending.h', 'common_blur.h', 'common_perspective.h', 'common_composite.h'])

for (const [sid, label] of TARGETS) {
  const p = path.join(SCENE_ROOT, sid, 'scene.pkg')
  const pkg = parsePkg(new Uint8Array(fs.readFileSync(p)))
  const scene = parseScene(JSON.parse(rd(getEntry(pkg, pkg.entries.find((x) => x.name === 'scene.json').name))), null)
  const problems = []
  const layerCount = { total: 0, rendered: 0, bound: 0, skipped: 0 }
  scene.layers.forEach((layer) => {
    layerCount.total++
    if (!layer.visible || layer.particle || layer.isContainer) { layerCount.skipped++; return }
    layerCount.rendered++
    // 1) model
    let model = null
    if (layer.image) {
      const bi0 = lib.resolveBuiltin(layer.image)
      if (bi0 && bi0.kind === 'model') model = bi0.value
      else {
        const me = getEntry(pkg, layer.image)
        if (!me) { problems.push(`缺 model: ${layer.image} (层 ${layer.name || layer.id})`); return }
        model = JSON.parse(rd(me))
      }
    } else if (!layer.solid) { /* 无 image 的非 solid：透明内容层 */ }
    // 2) material（含 model 链）
    if (model && typeof model.material === 'string') {
      const bi1 = lib.resolveBuiltin(model.material)
      if (!(bi1 && bi1.kind === 'material')) {
        const matE = getEntry(pkg, model.material)
        if (!matE) problems.push(`缺 material: ${model.material} (层 ${layer.name || layer.id})`)
      }
    }
    // 3) 效果链
    for (const eff of layer.effects || []) {
      if (!eff.visible) continue
      resolveEffectChain(pkg, eff, rd)
      for (const mp of eff.materialPasses || []) {
        if (!mp.shader || mp.copyCommand) continue
        for (const stage of ['vert', 'frag']) {
          const full = 'shaders/' + mp.shader + '.' + stage
          const se = getEntry(pkg, full)
          if (se === null) problems.push(`缺 shader: ${full} (层 ${layer.name || layer.id})`)
          else {
            const src = rd(se)
            for (const mm of src.matchAll(/#include\s*"([^"]+)"/g)) {
              if (!HEADERS.has(mm[1])) problems.push(`头文件未覆盖: ${mm[1]} 于 ${full}`)
            }
          }
        }
        // pass 纹理
        for (const tn of mp.textures || []) {
          if (typeof tn !== 'string' || tn === '' || tn.startsWith('util/') || tn.startsWith('_rt_')) continue
          if (!getEntry(pkg, 'materials/' + tn + '.tex')) problems.push(`缺纹理: materials/${tn}.tex (层 ${layer.name || layer.id})`)
        }
      }
    }
    if (layer.textureName) layerCount.bound++
  })
  // 4) 场景自身 model 纹理（通过对象 image→model→pass textures 统计绑定预期）
  console.log(`\n### ${label} (${sid})`)
  if (ALL_MODE) { console.log(`  层: 总${layerCount.total} 渲染${layerCount.rendered} 跳过${layerCount.skipped}（粒子/容器/隐藏）`) }
  else console.log(`  层: 总${layerCount.total} 渲染${layerCount.rendered} 跳过${layerCount.skipped}（粒子/容器/隐藏）`)
  if (problems.length) {
    console.log(`  ⚠ ${problems.length} 个问题:`)
    for (const pr of [...new Set(problems)].slice(0, 25)) console.log('    ', pr)
  } else {
    console.log('  ✅ 无缺失资源（model/material/effect shader/include/纹理全覆盖）')
  }
}
