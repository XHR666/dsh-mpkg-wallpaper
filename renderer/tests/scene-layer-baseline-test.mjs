// scene-layer-baseline-test.mjs —— 逐层基线夹具 + 音频美术层可见性契约（2026-09-21）
//
// 为什么要有它（两件事，同一批离线取证逼出来的）：
//   ① **观感退化可判**：`3544152633` 这类包出过"只剩几层 / 背景全错 / 音频条不见了"，而此前只有
//      `render-audit.mjs` 的人读输出 —— 没人能一眼看出"今天和上周比少了哪一层"。本测试把
//      **逐层事实**（总层/可见层/带纹理的可见层/蒙皮命中/首帧真的画了几笔）钉进夹具
//      `tests/fixtures/scene-layer-baseline.json`：变了就红，并且告诉你是哪一项变了。
//   ② **音频美术层不许被自家启发式吞掉**：用户点名"我的音频条没有做出来"。离线逐层审计显示
//      `#3 Audio bar vis=0` —— 不是没有音频源，而是被 `applyRenderConfig` 的两条隐藏启发式
//      （hideUI 的名字正则含 `Audio|Spectrum|音量…`；hideBars 把"父组纯色遮罩条"整类关掉，
//      而可视化条自己就是 `models/util/solidlayer.json` 的实体遮罩层）无条件隐藏。修法见
//      `core/we-scene-bundle.js` 的 `audioArtIds()`；本测试用**真包**钉住"美术层可见、外壳仍隐藏"。
//
// 判据：
//   A 夹具逐项相等（in-repo 样例必跑；语料包在**本机没有语料**时明确 SKIP，不假装通过）
//   B 同一包连跑两次读数逐字段相同（夹具本身是确定性的，不是"每次都不一样所以永远绿"）
//   C 音频美术层契约：纯函数分类正例/反例 + 真包上"美术层 vis=1 / 外壳 vis=0"
//   D 分辨力自证：`hideAudioArt:true` ⇒ 美术层重新被隐藏（证明可见性**确实**来自这条豁免）；
//     夹具改一个数字 ⇒ 比较器必须报红（证明夹具不是摆设）
//
// 数据来源：`tests/render-audit.mjs`（**唯一**的 mock-GL harness，机读契约 `MPW-AUDIT-JSON {...}`），
// 本测试只解析那一行 —— 不复制第二份 GL 桩（复制出来的第二份迟早和真渲染器漂移）。
//
// 用法: node tests/scene-layer-baseline-test.mjs [--update]   （`--update` 只在**确认读数变化是有意的**时用）
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { WS } from './_root.mjs'
import { parsePkg, getEntry, parseScene, applyRenderConfig, audioArtIds } from '../core/we-scene-bundle.js'

const UPDATE = process.argv.includes('--update')
const REPO = path.dirname(import.meta.dirname)
const FIXTURE = path.join(REPO, 'tests', 'fixtures', 'scene-layer-baseline.json')
const SCENE_ROOT = process.env.MPW_SCENE_ROOT || path.join(WS, 'allwallpaper', 'dd')

let pass = 0, fail = 0, skipped = 0
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  [' + detail + ']' : '')) }
}
const skip = (name, why) => { skipped++; console.log('  – SKIP ' + name + ' —— ' + why) }

/* ── 夹具定义：每条 = 一个包的"逐层事实"。inRepo 的必跑；语料包没语料就 SKIP ── */
const RECORDS = [
  { id: 'sample-synthetic', inRepo: true, pkg: 'samples/sample-synthetic/scene.pkg' },
  { id: '3544152633', inRepo: false, note: '用户点名的音频条包（`Audio bar` + `audiobars/audioopacity` 属性）' },
  { id: '3326873240', inRepo: false, note: '`Audio Bars`（fx=2、实体遮罩层，曾被 hideBars 吞掉）' },
  { id: '3719111841', inRepo: false, note: '`音频线Audio Spectrum Visualizer`（绑 audiobar，fx=1）' },
]
const AUDIO_RE = /audio|音频|频谱|spectrum|visualizer/i
const CHROME_RE = /\.mp3$|Song Title|Artist Name|Album Title|Play Icon|Pause Icon|MUSIC PLAYER|Launcher/i
/* ②(2026-09-23) `framesDrawn` 的**上一次夹具读数**（`clearBgFx` 收窄之前的实测值）：
 *   只用于 D4 的**分辨力自证** —— 把这些值改回夹具里，比较器必须报红。
 *   现夹具值见 `tests/fixtures/scene-layer-baseline.json`（3544152633=[102,51,51]、3719111841=[126,63,63]）。
 *   若两者相等 ⇒ 自证是空的，D4 会连带失败（不会静默变成"永远绿"）。 */
const PRE_CLEARFX_FRAMES_DRAWN = { 3544152633: [68, 34, 34], 3719111841: [114, 57, 57] }

/** 跑一次 `render-audit.mjs`，取机读报告。 */
function audit(rec) {
  const args = ['tests/render-audit.mjs', rec.id]
  if (rec.pkg) args.push('--pkg', rec.pkg)
  const outText = execFileSync(process.execPath, args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const line = outText.split('\n').find((l) => l.startsWith('MPW-AUDIT-JSON '))
  if (!line) throw new Error('render-audit 没有给出机读行（MPW-AUDIT-JSON）—— 契约变了？')
  return JSON.parse(line.slice('MPW-AUDIT-JSON '.length))
}
/** 报告 → 夹具记录（只钉**有意义且稳定**的事实；不钉 drawCalls 这类"改一处就变"的计数）。 */
function facts(rep) {
  const textured = rep.firstFrame.filter((f) => f.vis === 1 && f.tex && f.tex !== '-').map((f) => f.name).sort()
  const audio = rep.firstFrame.filter((f) => AUDIO_RE.test(f.name)).map((f) => ({ name: f.name, vis: f.vis }))
    .sort((a, b) => (a.name < b.name ? -1 : 1))
  const chrome = rep.firstFrame.filter((f) => CHROME_RE.test(f.name)).map((f) => ({ name: f.name, vis: f.vis }))
  return {
    total: rep.layers.total,
    visible: rep.layers.visible,
    renderError: rep.renderError,
    skinHidden: rep.skin.hidden,
    skinDrawn: rep.skin.drawn,
    skinTotal: rep.skin.total,
    texturedVisible: textured.slice(0, 8),
    texturedVisibleCount: textured.length,
    // ②(2026-09-23) **渲染敏感（不是语料敏感）**：`framesDrawn` = 每帧 mock-GL 的真实 draw 调用数。
    //   夹具在 `clearBgFx` 收窄（WEBWALLGL #4：超大背景层不再无条件丢效果链）落地后重取 ⇒
    //   `3544152633` [68,34,34]→[102,51,51]、`3719111841` [114,57,57]→[126,63,63]（同包同字节、
    //   `scene.pkg` mtime 未变 ⇒ 变化**只能**来自渲染器；实测 narrow 档比 legacy 档多保留 5 层效果链：
    //   `__clearFx={dropped:0,kept:32,saved:5}` vs legacy `{dropped:5,kept:27}`）。
    //   逐包逐层事实（total/visible/蒙皮/纹理/音频美术）都没变 —— 变的只有这一条"真的画了几笔"。
    framesDrawn: rep.frames.map((f) => f.totalDraws),
    audioArt: audio,
    chromeVisible: chrome.filter((c) => c.vis === 1).map((c) => c.name),
  }
}

/* ── C 段的一部分：纯函数分类（先证判据本身对，再看真包） ── */
console.log('== C 音频美术层分类（纯函数；名字 + 特效/粒子/作者绑定）==')
{
  const layers = [
    { id: 1, name: 'Audio Bars', effects: [{}] },                                  // 美术层（有特效）
    { id: 2, name: 'Audio bar', __bindRaw: { audioopacity: {} } },                  // 美术层（作者绑定）
    { id: 3, name: '音频线Audio Spectrum Visualizer', particles: [{}] },            // 美术层（有粒子）
    { id: 4, name: 'Audio bar' },                                                   // 裸名字：不豁免（无任何"这是美术"的证据）
    { id: 5, name: 'Song Title', effects: [{}] },                                   // 外壳：不豁免
    { id: 6, name: '塞壬唱片-MSR - Дом.mp3' },                                        // 音源对象：不豁免
    { id: 7, name: '----MUSIC PLAYER---- (DO NOT TOUCH ME)' },                      // 分组占位：不豁免
  ]
  const ids = audioArtIds({ layers })
  check('C1 美术层（Audio Bars / Audio bar+绑定 / 音频线…Spectrum+粒子）都在豁免集里',
    ids.has(1) && ids.has(2) && ids.has(3), 'ids=' + JSON.stringify([...ids]))
  check('C2 外壳/音源/裸名字层**不**豁免（`Song Title`、`.mp3`、`MUSIC PLAYER`、无证据的 `Audio bar`）',
    !ids.has(4) && !ids.has(5) && !ids.has(6) && !ids.has(7))
}

console.log('\n== A/B 逐层基线夹具（真包 + 机读读数）==')
const fixture = fs.existsSync(FIXTURE) ? JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) : { records: {} }
const current = {}
for (const rec of RECORDS) {
  const exists = rec.inRepo ? fs.existsSync(path.join(REPO, rec.pkg)) : fs.existsSync(path.join(SCENE_ROOT, rec.id, 'scene.pkg'))
  if (!exists) { skip('baseline ' + rec.id, rec.inRepo ? ('自带样例缺失 ' + rec.pkg) : ('本机没有语料 ' + path.join(SCENE_ROOT, rec.id))) ; continue }
  let rep1, rep2
  try { rep1 = audit(rec); rep2 = audit(rec) } catch (e) { check('baseline ' + rec.id + ' 取到机读读数', false, String(e.message || e)); continue }
  const f1 = facts(rep1), f2 = facts(rep2)
  /* B 段：确定性 —— 两次读数逐字段相同 */
  check('B ' + rec.id + ' 两次独立运行读数逐字段相同（夹具是确定性的）', JSON.stringify(f1) === JSON.stringify(f2),
    JSON.stringify(f1) === JSON.stringify(f2) ? '' : ('run1=' + JSON.stringify(f1) + ' run2=' + JSON.stringify(f2)))
  current[rec.id] = f1
  const want = fixture.records ? fixture.records[rec.id] : null
  if (!want) { check('A ' + rec.id + ' 夹具里有这条记录', false, '夹具缺记录（--update 生成）'); continue }
  const diff = Object.keys(f1).filter((k) => JSON.stringify(f1[k]) !== JSON.stringify(want[k]))
  check('A ' + rec.id + ' 逐层事实与夹具一致（' + (rec.note || '自带样例') + '）', diff.length === 0,
    diff.length === 0 ? ('可见层=' + f1.visible + '/' + f1.total + ' 带纹理可见=' + f1.texturedVisibleCount + ' 音频美术=' + f1.audioArt.length)
      : ('变化的字段=' + diff.map((k) => k + ':' + JSON.stringify(want[k]) + '→' + JSON.stringify(f1[k])).join(' | ')))
  /* C 段（真包那一半）：音频美术层可见、外壳不可见 */
  const artHidden = f1.audioArt.filter((a) => a.vis !== 1)
  if (f1.audioArt.length === 0) skip('C ' + rec.id + ' 音频美术层可见性', '该包没有音频美术层（没有可判的对象）')
  else check('C ' + rec.id + ' 音频美术层真的可见（vis=1）', artHidden.length === 0, JSON.stringify(f1.audioArt))
  check('C ' + rec.id + ' 播放器外壳/音源层仍然隐藏（0 个可见）', f1.chromeVisible.length === 0,
    JSON.stringify(f1.chromeVisible))
}
if (UPDATE) {
  const next = { note: '逐层基线夹具：由 tests/scene-layer-baseline-test.mjs --update 生成；改数前先确认变化是有意的', records: current }
  fs.mkdirSync(path.dirname(FIXTURE), { recursive: true })
  fs.writeFileSync(FIXTURE, JSON.stringify(next, null, 1) + '\n')
  console.log('\n（已写入夹具 ' + path.relative(REPO, FIXTURE) + '：' + Object.keys(current).length + ' 条）')
}

console.log('\n== D 分辨力自证（豁免真的在起作用 / 夹具不是摆设）==')
{
  const now = new Date().getTime()
  const id = '3544152633'
  const p = path.join(SCENE_ROOT, id, 'scene.pkg')
  if (!fs.existsSync(p)) skip('D 真包对照', '本机没有语料 ' + p)
  else {
    const pkg = parsePkg(new Uint8Array(fs.readFileSync(p)))
    const sceneOf = () => parseScene(JSON.parse(new TextDecoder().decode(new Uint8Array(getEntry(pkg, 'scene.json'))).replace(/^\uFEFF/, '')))
    const base = { sceneId: id, refrender: null, anchor: 'refcenter', clearBgFx: true, hideParticles: true, hideUI: true, log: () => {} }
    const s1 = sceneOf()
    applyRenderConfig(s1, base)
    const art1 = s1.layers.filter((l) => AUDIO_RE.test(String(l.name || '')) && /Audio\s?Bars?|音频|Spectrum|Visualizer/i.test(String(l.name || '')))
    check('D1 默认档：音频美术层可见（豁免生效）', art1.length > 0 && art1.every((l) => l.visible),
      JSON.stringify(art1.map((l) => [String(l.name).slice(0, 24), l.visible])))
    const s2 = sceneOf()
    applyRenderConfig(s2, Object.assign({}, base, { hideAudioArt: true }))
    const art2 = s2.layers.filter((l) => AUDIO_RE.test(String(l.name || '')) && /Audio\s?Bars?|音频|Spectrum|Visualizer/i.test(String(l.name || '')))
    check('D2 关掉豁免（hideAudioArt:true）⇒ 同一层重新被隐藏（可见性确实来自这条豁免，不是别处顺手改的）',
      art2.length > 0 && art2.every((l) => !l.visible), JSON.stringify(art2.map((l) => [String(l.name).slice(0, 24), l.visible])))
    /* 夹具比较器的分辨力：把一个数字改掉必须报红 */
    const sample = current['sample-synthetic'] || current[id]
    if (sample) {
      const mutated = Object.assign({}, sample, { visible: sample.visible + 1 })
      const diffKeys = Object.keys(sample).filter((k) => JSON.stringify(sample[k]) !== JSON.stringify(mutated[k]))
      check('D3 夹具改一个数字（visible+1）⇒ 比较器报红（夹具不是摆设）', diffKeys.length === 1 && diffKeys[0] === 'visible', JSON.stringify(diffKeys))
    } else skip('D3 夹具分辨力', '本轮没有取到任何夹具读数')
  }
  void now
}

console.log('\n== D4 分辨力自证（framesDrawn 逐字段变异）==')
/* ②(2026-09-23) D3 只证明"visible 变了会报红"。本项补一条**升级过的**自证：把 `framesDrawn` 改回
 *   `clearBgFx` 收窄之前的**旧夹具值** ⇒ 比较器必须报红且**只**报 framesDrawn。这样"逐层事实变了就红"
 *   这句话对**真的会变的那一格**也成立（否则夹具升级成新值之后，没人能证明它还在比）。 */
for (const [id, oldVals] of Object.entries(PRE_CLEARFX_FRAMES_DRAWN)) {
  const cur = current[id]
  if (!cur) { skip('D4 ' + id, '本轮没有取到该包读数（语料缺失）'); continue }
  const mutated = Object.assign({}, cur, { framesDrawn: oldVals })
  const diffKeys = Object.keys(cur).filter((k) => JSON.stringify(cur[k]) !== JSON.stringify(mutated[k]))
  check('D4 ' + id + ' framesDrawn 改回旧值 ' + JSON.stringify(oldVals) + ' ⇒ 比较器报红（该字段真的在比）',
    JSON.stringify(oldVals) !== JSON.stringify(cur.framesDrawn) && diffKeys.length === 1 && diffKeys[0] === 'framesDrawn',
    '报红字段=' + JSON.stringify(diffKeys) + ' 夹具现值=' + JSON.stringify(cur.framesDrawn))
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败' + (skipped ? ', ' + skipped + ' SKIP' : ''))
if (fail === 0) console.log('✓ 逐层基线 + 音频美术层可见性通过：夹具逐项相等 / 读数确定性 / 美术层可见而外壳仍隐藏 / 豁免与夹具都有分辨力')
process.exit(fail > 0 ? 1 : 0)
