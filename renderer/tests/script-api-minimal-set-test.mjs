// script-api-minimal-set-test.mjs — P-208 C1（P-220 号）脚本 API「不实现必画错的最小集」补齐判据。
//
// 官方依据（REVERSE-FINDINGS-7 RE-57）：语料实扫 80 容器/3741 段脚本的频次表 + 官方
// `assets/scripts/jsclasses/baseclasses.js` 的 API 面。本轮补齐的缺失 API（规则 A：官方明文存在 ⇒
// 至少留接口，别让作者脚本因 API 不存在整段崩掉）：
//   `element.addText`(223 次) · `engine.changedUserProperties`(233) · `engine.openUserShortcut`(190) ·
//   `engine.isObjectValid` · `engine.isLandscape/isPortrait` · `getTextureAnimation().playSingleAnimation(name)`
//
// 判据（行为级：真沙箱 applySceneScripts 跑作者脚本）：
//   A1 addText：字符串/对象/{value} 三形态 ⇒ 层引用可读 text 属性 + objList 可见 + 计数。
//   A2 changedUserProperties：默认 {}（hasOwnProperty 恒 false = "本次无变更"）；opts 注入生效。
//   A3 openUserShortcut：可调用返回 false（可判定失败值）+ notImplemented 台账（不抛）。
//   A4 isObjectValid/isLandscape/isPortrait：语义正确。
//   A5 playSingleAnimation：play 语义（__texFramePlay=true）+ 调用计数 + 不抛。
//   A6 变异自证：addText 删掉 ⇒ A1 红（隔离副本真改真跑）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ROOT } from './_root.mjs'

const FILE = fileURLToPath(import.meta.url)
const MODULE = process.env.MPW_SCENE_SCRIPTS || path.join(ROOT, 'elysia', 'scene-scripts.js')
const CORE_SRC = fs.readFileSync(MODULE, 'utf8')
const mod = await import(pathToFileURL(MODULE).href)
const { applySceneScripts, createScriptCache, sceneScriptApiDiag, resetSceneScriptApiDiag } = mod

let pass = 0, fail = 0
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) }
  else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) }
}

const mkScene = (script) => ({ objects: [{ id: 1, name: '文本层', origin: '0 0 0', scale: '1 1 1', visible: true, text: { value: '', script: script + '\nexport function update(v) { return v }' } }] })
/** 跑一段作者脚本；结果从 entry.context.out 读（脚本顶层 `var out = {}` —— vm 全局属性）。
 *  cache 按**脚本源**为键 ⇒ 单脚本场景取第一个 entry。错误不吞：把 entry.error 一并返回。 */
const runScript = async (script, opts = {}) => {
  // 结果通道 = `export let out`（compileScript 把 export let/const 保留声明并登记进 __exports ——
  // vm 全局 var 不同步到宿主侧 context 对象，实测过）
  const scene = mkScene('export let out = {};\n' + script)
  const cache = createScriptCache()
  await applySceneScripts(scene, 0.5, { scriptCache: cache, canvasSize: { x: 1920, y: 1080 }, frametime: 1 / 60, onError: () => {}, ...opts })
  const entry = [...cache.map.values()][0] || {}
  return { out: (entry.exports && entry.exports.out) || {}, error: entry.error, entry }
}

console.log('== C1 脚本 API 最小集补齐（RE-57）==')

/* A1 addText 三形态 */
{
  const { out, error } = await runScript(`
    const a = thisScene.addText('hello');
    const b = thisScene.addText({ text: 'world', pointsize: 48 });
    const c = thisScene.addText({ value: 'valued', color: '1 0 0' });
    out.n = thisScene.enumerateLayers().length;
    out.t1 = a.text; out.t2 = b.text; out.t3 = c.text; out.p2 = b.pointsize;
  `)
  check('A0 脚本无错误（沙箱主干通）', error === undefined || error == null, 'err=' + (error || '无'))
  check('A1a addText 字符串形态 ⇒ 层引用 text 可读', out.t1 === 'hello', JSON.stringify({ t1: out.t1, t2: out.t2, t3: out.t3, err: error }))
  check('A1b 对象形态字段透传（pointsize=48）+ {value} 归一（t3=valued）',
    out.p2 === 48 && out.t3 === 'valued', JSON.stringify({ p2: out.p2, t3: out.t3 }))
  check('A1c 层进 enumerateLayers（3 个新层 + 1 个宿主层）', out.n >= 4, 'n=' + out.n)
}

/* A2 changedUserProperties */
{
  const r2 = await runScript(`
    out.noChange = Object.prototype.hasOwnProperty.call(engine.changedUserProperties, 'x');
    out.isObj = typeof engine.changedUserProperties === 'object';
  `)
  check('A2 默认 {}（hasOwnProperty 恒 false = 本次无变更，脚本主干不崩）',
    r2.out.noChange === false && r2.out.isObj === true, JSON.stringify(r2.out))
  const r2b = await runScript(`
    out.injected = Object.prototype.hasOwnProperty.call(engine.changedUserProperties, 'slider1');
  `, { changedUserProps: { slider1: true } })
  check('A2b opts.changedUserProps 注入生效', r2b.out.injected === true, JSON.stringify(r2b.out))
}

/* A3 openUserShortcut + isObjectValid + 方向探测 */
{
  const r3 = await runScript(`
    out.ret = engine.openUserShortcut('launcher1');
    out.valid = engine.isObjectValid({}) && !engine.isObjectValid(null);
    out.land = engine.isLandscape(); out.port = engine.isPortrait();
  `)
  check('A3a openUserShortcut 可调用、返回 false（不抛、可判定失败值）',
    r3.out.ret === false, JSON.stringify(r3.out))
  check('A3b notImplemented 台账计数（globalThis.__mpwScriptApi）',
    typeof globalThis.__mpwScriptApi === 'object' && globalThis.__mpwScriptApi.notImplemented.openUserShortcut >= 1,
    JSON.stringify(globalThis.__mpwScriptApi && globalThis.__mpwScriptApi.notImplemented))
  check('A3c isObjectValid 语义 + isLandscape/isPortrait（1920×1080 ⇒ landscape）',
    r3.out.valid === true && r3.out.land === true && r3.out.port === false, JSON.stringify(r3.out))
}

/* A5 playSingleAnimation */
{
  const r5 = await runScript(`
    const tex = thisLayer.getTextureAnimation();
    tex.playSingleAnimation('wave');
    out.playing = tex.isPlaying();
    try { tex.playSingleAnimation(null); out.noThrow = true } catch (e) { out.noThrow = false }
  `)
  // 第二次 playSingleAnimation(null) 会把段名覆写成 "" ⇒ 留档断言 = "是字符串"（'wave' 被覆写是预期语义）
  check('A5a playSingleAnimation ⇒ play 语义（__texFramePlay=true、清钉帧）',
    r5.out.playing === true, JSON.stringify({ playing: r5.out.playing, err: r5.error }))
  // 段名留档的可机读通道 = `sceneScriptApiDiag().texAnimPlaySingle` 计数（apiBump；
  //   node 树上 __texSingleAnim 的落点依赖 thisLayer 的 raw 绑定路径，不钉）。
  //   r5 的第二次 playSingleAnimation(null) 之后追加一轮干净调用以读数。
  resetSceneScriptApiDiag()
  const r5b = await runScript(`
    const tex = thisLayer.getTextureAnimation();
    tex.playSingleAnimation('wave');
    out.done = tex.isPlaying();
  `)
  check('A5b null 名不抛 + 调用留档（sceneScriptApiDiag().texAnimPlaySingle ≥ 1）',
    r5.out.noThrow === true && sceneScriptApiDiag().texAnimPlaySingle >= 1 && r5b.out.done === true,
    JSON.stringify({ noThrow: r5.out.noThrow, diag: sceneScriptApiDiag().texAnimPlaySingle, done: r5b.out.done, err: r5b.error }))
}

/* A6 变异自证（隔离副本真改真跑） */
if (!process.argv.includes('--no-mutations')) {
  console.log('== A6 变异自证（隔离副本；真树不动）==')
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-c1-'))
  // 兄弟模块一并复制（scene-scripts.js import 同目录文件 ⇒ 只拷一个会加载失败 ⇒ 0 红假阴性）
  const root = path.join(tmp, 'mut')
  const cpRec = (srcDir, dstDir) => {
    fs.mkdirSync(dstDir, { recursive: true })
    for (const f of fs.readdirSync(srcDir, { withFileTypes: true })) {
      const sp = path.join(srcDir, f.name), dp = path.join(dstDir, f.name)
      if (f.isDirectory()) cpRec(sp, dp)
      else try { fs.copyFileSync(sp, dp) } catch (e) { /* 偶发非常规文件：跳过（模块加载不需要） */ }
    }
  }
  cpRec(path.join(ROOT, 'elysia'), root)
  const mutated = CORE_SRC.replace('    addText: function (spec) {', '    addText: undefined && function (spec) {')
  if (mutated !== CORE_SRC) {
    fs.writeFileSync(path.join(root, 'scene-scripts.js'), mutated)
    const r = spawnSync(process.execPath, [FILE, '--no-mutations'], {
      encoding: 'utf8', maxBuffer: 32 << 20,
      env: { ...process.env, MPW_SCENE_SCRIPTS: path.join(root, 'scene-scripts.js'), MPW_REPO_ROOT: ROOT },
    })
    const got = (r.stdout || '').split('\n').filter((l) => l.includes('✗')).length
    check('A6 addText 删掉 ⇒ A1 组红（≥1）', got >= 1, '红项=' + got)
  } else check('A6 变异真的改到了（锚点未命中 ⇒ 判据腐烂）', false)
  check('A6 真树未触碰', fs.readFileSync(MODULE, 'utf8') === CORE_SRC)
  fs.rmSync(tmp, { recursive: true, force: true })
}

console.log('\n===== script-api-minimal-set: ' + pass + ' 通过 / ' + fail + ' 失败 =====')
process.exit(fail ? 1 : 0)
