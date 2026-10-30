/* 参照来源许可声明：本文件提到的 wer-ref/ 是第三方参考实现（Aromatic05/wallpaper-engine-renderer，GPL-2.0-only，非 WE 官方代码、非「真值源」），与本项目（GPL-3.0-or-later）许可不兼容 —— 仅用于行为对照，不得复制/改写/逐行翻译其代码、注释、常量组织或错误文案。we-layerd-ref/（Aromatic05/we-layerd）无任何许可（保留所有权利），同样仅行为对照。血缘自查结论见 docs/WER-REF-LICENSE-AUDIT.md。 */ // render-closeout-test.mjs — P0-4/P0-5/P1 收尾验收：
//   C12 效果链中间 pass 强制 Normal（wer-ref SceneImageEffectLayer.cpp:331）
//   C10 fullscreen/passthrough 效果层：语料 0 使用 → 结论 no-op（含证据）
//   cropoffset：官方运行时不解析（exe 字节 0 命中，RE-02）→ 解析输出与无 cropoffset 逐位相同
//   blockalign：语料 true 值 0 使用 → 只解析不实现（结论）
//   RE-06 可见性边角：父隐藏→子隐藏级联、combo 条件二态、动画驱动 visible（P1-9）
//   P1-7 HDR 门控：half_float 扩展纳入
import fs from 'node:fs'
import * as lib from '../core/we-scene-bundle.js'

let pass = 0, fail = 0
const fails = []
function chk(cond, label, detail) {
  if (cond) { pass++; console.log('PASS  ' + label) }
  else { fail++; fails.push(label + (detail !== undefined ? '  [' + detail + ']' : '')); console.log('FAIL  ' + label + (detail !== undefined ? '  [' + detail + ']' : '')) }
}
const bundleSrc = fs.readFileSync(new URL('../core/we-scene-bundle.js', import.meta.url), 'utf8')

// ── ① C12：链内 pass 强制 Normal ──
chk(bundleSrc.includes('(WER-ALIGN C12'), '① C12 注释标记存在')
chk(!/setBlend\(mp\.blending/.test(bundleSrc), '① 链内不再使用材质声明的 blending', 'setBlend(mp.blending) 应为 0 处')
{
  /* 效果链 pass 调用点附近必须 setBlend('normal')。
     ①(2026-10-11) 窗口从 **300 加宽到 800**：原窗口把"注释的字节长度"当成了语义条件 ✗ ——
     一次**纯注释**的来源更正（插入来源说明两行）就把 `setBlend('normal')` 挤出窗口 ⇒ **假红** ✗。
     判据要钉的是"调用点与标记同处一段代码"，不是"注释多长" ✓（标记本身仍是 `(WER-ALIGN C12` ✓）。 */
  const i = bundleSrc.indexOf('(WER-ALIGN C12')
  chk(i >= 0 && bundleSrc.slice(i, i + 800).includes("setBlend('normal')"), '① 链内 setBlend(\'normal\') 就位')
}

// ── ② C10：fullscreen/passthrough 语料 0 使用 → no-op 结论（防回归：别名表仍在） ──
chk(bundleSrc.includes("materials/util/fullscreenlayer.json"), '② fullscreenlayer 材质别名保留（若未来出现可回退）')

// ── ③ cropoffset：解析输出与无 cropoffset 逐位相同（官方忽略） ──
{
  const mk = (crop) => ({
    general: { orthogonalprojection: { width: 3840, height: 2160 } },
    objects: [{ id: 1, name: 'L1', image: 'models/util/solidlayer.json', origin: '100 100', scale: '1 1 1', angles: '0 0 0', solid: true, ...(crop ? { cropoffset: crop } : {}) }],
  })
  const a = lib.parseScene(mk('50 50'), null, {})
  const b = lib.parseScene(mk(null), null, {})
  const la = a.layers[0], lb = b.layers[0]
  chk(la.origin[0] === lb.origin[0] && la.origin[1] === lb.origin[1], '③ cropoffset 不影响 origin（官方不消费，RE-02 exe 0 命中）', la.origin + ' vs ' + lb.origin)
  chk(la.scale[0] === lb.scale[0] && la.scale[1] === lb.scale[1], '③ cropoffset 不影响 scale')
  chk(la.alignment === lb.alignment && la.size[0] === lb.size[0], '③ cropoffset 不影响 size/alignment')
}

// ── ④ blockalign：语料 true=0 → 解析保留字段、不实现排版 ──
{
  const sc = { general: {}, objects: [{ id: 1, name: 'T', text: 'hello', blockalign: true, origin: '0 0', scale: '1 1', angles: '0 0' }] }
  const s = lib.parseScene(sc, null, {})
  chk(s.layers[0].__text && s.layers[0].__text.blockalign === true, '④ blockalign 解析保留（值域 0 使用，P1 结论：不实现）')
}

// ── ⑤ RE-06 边角：父隐藏 → 子隐藏（级联） ──
{
  const sc = {
    general: {},
    objects: [
      { id: 10, name: '父', visible: false, origin: '0 0', scale: '1 1', angles: '0 0' },
      { id: 11, name: '子', parent: 10, visible: true, origin: '10 10', scale: '1 1', angles: '0 0' },
      { id: 12, name: '孙', parent: 11, visible: true, origin: '20 20', scale: '1 1', angles: '0 0' },
      { id: 13, name: '旁支', visible: true, origin: '30 30', scale: '1 1', angles: '0 0' },
    ],
  }
  const s = lib.applyRenderConfig(lib.parseScene(sc, null, {}), {})
  const byName = Object.fromEntries(s.layers.map((l) => [l.name, l]))
  chk(byName['父'].visible === false, '⑤ 父 visible=false 保持')
  chk(byName['子'].visible === false, '⑤ 子层被父级联隐藏', String(byName['子'].visible))
  chk(byName['孙'].visible === false, '⑤ 孙层跨两级级联隐藏', String(byName['孙'].visible))
  chk(byName['旁支'].visible === true, '⑤ 旁支不受影响')
}

// ── ⑥ RE-06 combo 二态：背景正常/背景暗色 ──
{
  const mk = () => ({
    general: {},
    objects: [
      { id: 1, name: '背景正常', visible: { user: { condition: '0', name: 'background' }, value: true }, origin: '0 0', scale: '1 1', angles: '0 0' },
      { id: 2, name: '背景暗色', visible: { user: { condition: '1', name: 'background' }, value: false }, origin: '0 0', scale: '1 1', angles: '0 0' },
    ],
  })
  const s0 = lib.applyRenderConfig(lib.parseScene(mk(), null, {}), { properties: { background: '0' } })
  const g0 = Object.fromEntries(s0.layers.map((l) => [l.name, l.visible]))
  chk(g0['背景正常'] === true && g0['背景暗色'] === false, '⑥ background="0" → 正常显/暗色隐', JSON.stringify(g0))
  const s1 = lib.applyRenderConfig(lib.parseScene(mk(), null, {}), { properties: { background: '1' } })
  const g1 = Object.fromEntries(s1.layers.map((l) => [l.name, l.visible]))
  chk(g1['背景正常'] === false && g1['背景暗色'] === true, '⑥ background="1" → 反转（匹配=可见，value 仅兜底）', JSON.stringify(g1))
  const sN = lib.applyRenderConfig(lib.parseScene(mk(), null, {}), {})
  const gN = Object.fromEntries(sN.layers.map((l) => [l.name, l.visible]))
  chk(gN['背景正常'] === true && gN['背景暗色'] === true, '⑥ 无属性表 → 带条件层按可见（legacy 兜底，防主体消失）', JSON.stringify(gN))
}

// ── ⑦ 动画驱动 visible：解析 + 阶跃求值 + 渲染循环接线 ──
{
  const sc = {
    general: {},
    objects: [{ id: 1, name: 'A', visible: { animation: { c0: [{ frame: 0, value: 1 }, { frame: 60, value: 0 }] } }, origin: '0 0', scale: '1 1', angles: '0 0' }],
  }
  const s = lib.parseScene(sc, null, {})
  const l = s.layers[0]
  chk(!!(l.anim && l.anim.visible), '⑦ visible 关键帧解析进 layer.anim.visible')
  const ch = l.anim.visible.get ? l.anim.visible.get('c0') : l.anim.visible
  const v0 = lib.animValueAt(ch, 0), v3 = lib.animValueAt(ch, 3)
  const v15 = lib.animValueAt(ch, 1.9)
  chk(v0 === 1 && v3 === 0.5 && v15 < 0.5, '⑦ 关键帧求值（官方 Loop 周期=2s：t=0→1、t=1.9→<0.5、t=3→0.5）', v0 + '/' + v15 + '/' + v3)
  chk(v0 > 0.5 && !(v15 > 0.5), '⑦ 阶跃语义：>0.5 可见（渲染循环接线见 bundle renderScene）')
  chk(bundleSrc.includes('__layerVis'), '⑦ 渲染循环消费动画 visible（__layerVis 接线点）')
}

// ── ⑧ P1-7 HDR 门控：half_float 纳入 ──
chk(bundleSrc.includes("EXT_color_buffer_half_float"), '⑧ HDR 门控纳入 half_float（Adreno 常见）')

// ── ⑨ P1-8 预算清单（源级断言）──
chk(/Math\.min\((def && def\.maxcount[\s\S]{0,40})?20000\)/.test(bundleSrc) || bundleSrc.includes('20000'), '⑨ 粒子 maxcount ≤20000 守卫')
chk(bundleSrc.includes('MAX_TEXTURE_SIZE'), '⑨ 纹理 MAX_TEXTURE_SIZE 查询守卫')

console.log(`\n${pass}/${pass + fail} 通过（C12/C10/cropoffset/blockalign/可见性/HDR/预算）`)
if (fails.length) console.log('失败项:\n  ' + fails.join('\n  '))
process.exit(fail === 0 ? 0 : 1)
