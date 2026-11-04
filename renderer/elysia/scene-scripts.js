/* 参照来源许可声明：本文件提到的 wer-ref/ 是第三方参考实现（Aromatic05/wallpaper-engine-renderer，GPL-2.0-only，非 WE 官方代码、非「真值源」），与本项目（GPL-3.0-or-later）许可不兼容 —— 仅用于行为对照，不得复制/改写/逐行翻译其代码、注释、常量组织或错误文案。we-layerd-ref/（Aromatic05/we-layerd）无任何许可（保留所有权利），同样仅行为对照。血缘自查结论见 docs/WER-REF-LICENSE-AUDIT.md。 */ // WE scene scripts 运行时: 执行 {script, value} 对象的 JS 脚本 (NSL)
// 支持: export function update(value) — 每帧更新 (返回新值)
//       export function applyUserProperties(changed) — 用户属性变化更新
//       export function init(value) — 初始化一次 (返回新值; NSL init(value))
// 提供 WEColor / createScriptProperties / engine.canvasSize / Vec3 等引擎 API (vm 沙箱)
// 用户属性 (project.json general.properties) 注入 scriptProperties (user 映射)
//
// 关键设计 (sf35 重构): 脚本**编译一次、状态跨帧保留** — 旧实现每帧重编译导致
// NSL 脚本内部状态 (计数器/动画调度器) 每帧重置、大型脚本每帧编译 CPU 爆表,
// 且 init() 每帧重复调用。现在:
//   - createScriptCache() 持有 {map: Map<源码, 编译条目>, shared}
//   - 每个 SceneRenderer 实例一个 cache (scene-anim 多帧复用实例 → 状态跨帧保留)
//   - 同一源码只编译一次; init() 只在首次执行; 每帧只调 update(value)
//   - thisObject/thisLayer 通过 ownerRef 代理指向"当前脚本所属对象" (缓存共享
//     时对象不串); 读写真实渲染对象 (origin/scale/visible/alpha/animationlayers)
//   - engine API 补全 (isRunningInEditor 等) — NSL 库 (如 Mutsumi 788) 缺失
//     方法时中途抛错 → 后续 shared 赋值全部丢失 → 整个动画框架失效
import vm from './nsl.js';
/* ①(P-232) `evalSceneZoom` 用**动态导入**取（变异夹具会把本文件拷到 /tmp，`../core` 相对导入
   在副本里断链——静态 import 会让整个模块加载失败）；失败 ⇒ null ⇒ getCameraTransforms 的 zoom
   退回静态值（= P-232 前行为，对那些夹具等价）。真实树（demo/tests 从仓库内加载）恒走动画求值。 */
let _evalSceneZoom = null;
try { _evalSceneZoom = (await import('../core/we-scene-bundle.js')).evalSceneZoom } catch (e) { _evalSceneZoom = null }
import { WEColor, Vec2, Vec3, ScriptPropertiesBuilder, WEVector, DEG2RAD, RAD2DEG } from './scene-script-apis.js';

// NSL thisScene: getLayer(name) → 图层包装, 读写真实场景对象属性
// origin/scale/size 字符串 "x y z" ↔ Vec3; visible/alignment 直接读写
// 脚本对象 {script, value} 取 value (715 读 Launcher scale 时其脚本可能尚未
// 执行/已执行 — 读最终 value 而非原始 {script,value} 对象)
// ①(2026-09-12) 供 thisLayer / thisScene 两套引用共享的工具（矩阵 / 纹理动画句柄）
const parseVShared = (v, def) => {
  const raw = (v && typeof v === 'object' && 'value' in v) ? v.value : v;
  const p = String(raw == null ? '' : raw).trim().split(/\s+/).map(Number);
  return new Vec3(p[0] ?? def[0], p[1] ?? def[1], p[2] ?? def[2]);
};
export function transformMatrixShared(obj) {
  const o = obj ? parseVShared(obj.origin, [0, 0, 0]) : new Vec3(0, 0, 0);
  const sc = obj ? parseVShared(obj.scale, [1, 1, 1]) : new Vec3(1, 1, 1);
  const a = obj ? parseVShared(obj.angles, [0, 0, 0]) : new Vec3(0, 0, 0);
  const c = Math.cos(a.z || 0), si = Math.sin(a.z || 0);
  return { m: [c * sc.x, si * sc.x, 0, 0, -si * sc.y, c * sc.y, 0, 0, 0, 0, 1, 0, o.x, o.y, o.z || 0, 1], x: o.x, y: o.y, z: o.z || 0 };
}
export function texAnimRefShared(obj) {
  // ①(2026-09-21 官方 ITextureAnimation 面) 为什么补这几个成员：
  //   官方 `ITextureAnimation`（本机 d.ts `lib.sceneScript.d.ts:551-606`）是
  //   `{ frameCount(只读), duration(只读), rate(可写), isPlaying():bool, getFrame():num,
  //      setFrame(n), join() }`。旧实现只有 `play/stop/setFrame/getFrame` + 四个**自造**的空
  //   `setXxx()` —— 后果是**静默错分支**（不是抛错）：`if (tex.getFrame() == tex.frameCount-1)`
  //   里 `frameCount` 是 `undefined` ⇒ `NaN` 比较恒 false，作者脚本"播完这一遍就做某事"永远不触发。
  //   真机语料实例（包 3544152633）：`playeroutlineanim.origin` 写 `rate = 9`、
  //   `playerplay.alpha/origin` 读 `getFrame()/frameCount` 并写 `rate`（见 tests/scene-texanim-api-test.mjs）。
  //   语义（官方文档）：`rate` = **速度倍率（默认 1）**；`frameCount/duration` = 帧数/时长；
  //   `join()` = 回到"所有实例共享的动画状态"（本仓库没有共享时钟实例的概念 ⇒ 清掉本对象的
  //   强制帧，回到跟随 `__texFramePlay` 的自动推进，这是**行为上最近**的一个映射）。
  //   `frameCount/duration` 的**真值**由宿主在解析出 sprite 元数据后盖章（`__texFrameCount`/
  //   `__texFrameDuration`，见 demo.html 与 core/we-scene-bundle.js 的两处 sprite 登记点）；
  //   没盖到 ⇒ 返 0（**不编造**：0 与"未知"在数值上无法区分，但比 `undefined` 好 ——
  //   `getFrame() == frameCount-1` 会变成 `0 == -1` = false，与"没有帧信息"一致且可观测）。
  const num = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
  return {
    play: () => { if (obj) obj.__texFramePlay = true },
    stop: () => { if (obj) obj.__texFramePlay = false },
    setFrame: (f) => { if (obj) { obj.__texFrame = Number(f) || 0; obj.__texFrameForced = true } },
    getFrame: () => num(obj && obj.__texFrame),
    setFrameCount: () => {}, setTime: () => {}, setFps: () => {}, setRate: () => {},   // 自造名的空实现（**保留**：语料里已有调用方，删掉会变成新版 TypeError）
    get frameCount() { return num(obj && obj.__texFrameCount) },
    get duration() { return num(obj && obj.__texFrameDuration) },
    get rate() { return (obj && typeof obj.__texRate === 'number' && isFinite(obj.__texRate)) ? obj.__texRate : 1 },
    set rate(v) {
      if (!obj) return
      const n = Number(v)
      if (!isFinite(n)) return                                   // 非有限值不写（不把速度写成 NaN）
      obj.__texRate = n
      apiBump('texAnimRateWrite')
    },
    isPlaying: () => !!(obj && obj.__texFramePlay),
    join: () => { if (obj) { obj.__texFrameForced = false; apiBump('texAnimJoin') } },
    // ①(P-220 C1 2026-09-29 · RE-57) 官方 `playSingleAnimation(name)`（baseclasses.js 明文；语料 70 次
    //   getTextureAnimation 的姊妹方法）：播放**具名**动画段。本仓 TEXS 帧表无具名段概念 ⇒
    //   语义折叠为 play()（从头自动推进）+ `__texSingleAnim=name` 留档（可观测、不丢调用），
    //   脚本主干不因方法缺失而崩。
    playSingleAnimation: (name) => {
      if (obj) { obj.__texFramePlay = true; obj.__texFrameForced = false; obj.__texSingleAnim = String(name == null ? '' : name) }
      try { apiBump('texAnimPlaySingle') } catch (e) { /* 计数失败不影响 */ }
    },
  };
}

// ①(TIME-VARIATION) 官方 layer.getVideoTexture()：没有视频纹理也返回稳定命令对象，
//   让 play()/pause() 退化成 no-op 而不是每帧抛错（WPSceneScriptHost.cpp:1293-1300）。
export function videoTexRefShared(obj) {
  return {
    play: () => { if (obj) obj.__videoPlay = true },
    pause: () => { if (obj) obj.__videoPlay = false },
    stop: () => { if (obj) obj.__videoPlay = false },
    setCurrentTime: () => {}, getCurrentTime: () => 0,
    isPlaying: () => !!(obj && obj.__videoPlay),
    rate: 1,
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * ①(P-141 2026-09-19 用户第 ⑧ 项续) **SceneScript API 缺口收口（8 类 / 8 个包）**
 *
 * 背景：P-137 把 `thisLayer.size` 一类缺口清零后，全语料同族扫描（`tests/script-runtime-errors-test.mjs`
 *   的 S5）还剩 **8 个包**，全部在作者脚本的**第 1 帧**就抛，形态是"某个官方成员还没实现"：
 *     init:thisLayer.getAnimation(3 包) / getParticleSystem(3) / thisScene.getLayerIndex(2) /
 *     thisLayer.isPlaying(1) / thisScene.createLayer(1) / audioLayer.stop(1) / engine.setInterval(1)
 *     / update:Cannot read properties of undefined (reading 'toFixed')(1，是 createLayer 抛错后
 *       `shared.xx*` 从未被赋值引发的**级联**，不是独立缺口 —— 见 PATCHES P-141.2)。
 *
 * 官方语义（一手出处 = 随引擎发布的类型声明 `$MPW_ROOT/wallpaper_engine/ui/dist/monaco/autocomplete/
 *   lib.sceneScript.d.ts`，行号为该文件实测；官方文档 docs.wallpaperengine.io 作为补充）：
 *   · L494-499 `interface IObject { getAnimation(name?: String): IAnimation; }`
 *     （文档注释逐字 "Get an animation object by name. Leave empty to get the animation object
 *       bound to the current property."）⇒ **有返回值**，不是 void。
 *   · L1139 `interface ILayer extends IObject, IImageLayer, ISoundLayer, IEffectLayer, ITextLayer,
 *     IParticleSystem, IModel, ICamera` ⇒ ILayer **同时**是 ISoundLayer 与 IParticleSystem。
 *   · L744-771 `interface ISoundLayer`: `isPlaying(): Boolean` / `play(): void` / `stop(): void` /
 *     `pause(): void` / `volume: Number` ⇒ `thisLayer.isPlaying()` 是**方法**（不是属性），
 *     与本文件既有口径一致（语料 3351163962 写的就是 `thisLayer.isPlaying()`）。
 *   · L955-985 `interface IParticleSystem`: `play()/pause()/stop()/isPlaying()/emitParticles(count?)`
 *     + `instance: IParticleSystemInstance`；L874-952 `IParticleSystemInstance` 的字段是
 *     `alpha/size/count/speed/lifetime/rate/colorn/controlpoint0..7`（**rate 在 instance 上**）。
 *   · L1278 `IScene.createLayer(configuration: String|Object|IAssetHandle): ILayer`；
 *     L1282 `sortLayer(layer: String|Number|ILayer, index: Number): Boolean`；
 *     L1288 `getLayerIndex(layer: String|ILayer): Number`；
 *     L1292 `getInitialLayerConfig(layer: String|Number|ILayer): Object`。
 *   · L1519 `IEngine.setInterval(callback: Function, delay?: Number): Function`
 *     （"Starts a repeating interval callback in milliseconds. Returns a new callback that can be
 *       used to stop the interval."）；同段 L1523-1526 把 `clearTimeout` **注释掉**并注明
 *     "Not implemented. Use returned function to clear." ⇒ 官方唯一声明的清除路径是"调用返回的函数"。
 *   · L1568-1623 `interface IAnimation`：`readonly fps / readonly frameCount / readonly duration /
 *     readonly name`、`rate: Number`、`play()/pause()/stop()/isPlaying()/getFrame()/setFrame(frame)`。
 *   · `thisLayer.getParticleSystem` **不在** d.ts（也不在官方 ILayer 文档页）——它是语料里作者写的
 *     "取本层粒子系统"的写法；官方模型里这件事**已经是 `thisLayer` 自己**（ILayer extends
 *     IParticleSystem）。因此我们按官方模型实现：`getParticleSystem()` 返回**本层的 IParticleSystem
 *     视图**（同一个粒子系统句柄，不是第二份状态），并把语料直接写的 `.rate` 转发到官方落点
 *     `instance.rate`。行为对照（只读结论，不抄代码）：第三方参考实现 wer-ref
 *     `references/wer-ref/src/backend/scene/internal/scenescript/WPSceneScriptHost.cpp:1510`
 *     （layer proxy 的 `isPlaying` 仅在 `hasLayerMember(nodeId,'isPlaying')` 时存在）、
 *     `:1427-1434`（`getAnimation(name)` 解析不到就返回 undefined）、`:911-919`
 *     （`engine.setInterval` 返回一个带 `__timerId` 的 stop 函数、`clearInterval = clearTimeout`）。
 *     wer-ref 是 GPL-2.0-only（与本仓库 GPL-3.0-or-later 不兼容）⇒ **只取行为结论，未复制代码/注释**。
 *
 * 本块的四条通用口径（每一处实现都遵守）：
 *   ① **官方标 `readonly` 的成员只提供 getter**（fps/frameCount/duration/name）；同时挂一个
 *      **静默丢弃**的 setter —— 理由与 P-137 的 `size` 完全一致：只写 getter 会让 `'use strict'`
 *      作者脚本里的赋值由"静默成功"变成 **TypeError**（比"写入无效"更重的行为改变）。
 *      净效果 = 读得到、改不了、**不抛错**（新门禁断言这三条）。
 *   ② **不支持的调用不抛错**：按官方语义给 no-op 或 falsy（返回 `undefined` 是官方行为：
 *      wer-ref 对"该层没有这个动画"就是返回 undefined）。
 *   ③ **不得静默**：所有"我们只能记帐、无法真正作用到引擎"的调用都折进下面这份**可观测**计数表
 *      （`sceneScriptApiDiag()`），门禁与新测试直接读它。
 *   ④ **不做包补丁**：全部是通用成员/函数实现，语料里出现的包只是判据，不是分支条件。
 * ═══════════════════════════════════════════════════════════════════════════════ */

/** ①(P-141) 脚本 API 缺口收口的**可观测**计数表（只增不减；`sceneScriptApiDiag()` 读快照）。 */
export const SCENE_SCRIPT_API_DIAG = {
  getAnimation: 0,        // thisLayer/thisObject/层引用 .getAnimation() 命中次数
  getParticleSystem: 0,   // .getParticleSystem() 命中次数（官方无此成员，见上）
  getLayerIndex: 0,       // thisScene.getLayerIndex() 命中且解析成功
  getLayerIndexUnresolved: 0, // 同上但**解析不到**层（返回 -1；不抛错）
  createLayer: 0,         // thisScene.createLayer() 真正新建的层数
  createLayerReused: 0,   // createLayer 超过上限后返回的"脱离图层引用"数（见 MAX_DYNAMIC_LAYERS）
  sortLayer: 0,           // thisScene.sortLayer() 真正改了顺序的次数
  play: 0, pause: 0, stop: 0, isPlaying: 0,   // ILayer 的 ISoundLayer 面（脚本可见状态机）
  emitParticles: 0,       // IParticleSystem.emitParticles（本机无粒子发射注入点 ⇒ no-op + 计数）
  particleInstanceWrite: 0,   // IParticleSystemInstance 字段**写穿** obj.instanceoverride 的次数
  animationWrite: 0,      // IAnimation 的 rate/setFrame 等可写字段被写次数
  // ②(P-228l 2026-10-05) `getAnimation()` 的两条落点分开计数：真控制器（宿主注册了属性动画）/
  //   中性桩（层无属性动画、owner 未解析、或场景级·效果常量作用域尚未接线）。
  //   `animationEnded` = 真控制器 `mode:"single"` 播到末尾时作者 `addEndedCallback` 回调的触发次数。
  animationReal: 0,       // getAnimation() 命中**真控制器**（play/rate/setFrame 真的驱动渲染）
  animationStub: 0,       // getAnimation() 命中中性桩（脚本可见状态机 + 计数，不改渲染）
  animationEnded: 0,      // 真控制器 ended 回调触发次数
  texAnimRateWrite: 0,    // ①(2026-09-21) ITextureAnimation.rate 写次数（官方可写字段，来自真机语料）
  texAnimJoin: 0,         // ①(2026-09-21) ITextureAnimation.join() 命中次数（回到共享动画状态）
  timerScheduled: 0, timerFired: 0, timerCleared: 0,  // engine.setInterval 家族
  // ①(P-143 2026-09-23) **静默缺口批次**（"不抛错但值错"）的可观测计数：读/写各自留痕，
  //   门禁与新测试直接读它（口径 ③「不得静默」）。
  textPointsizeWrite: 0,  // ITextLayer.pointsize 写穿次数（非有限值**不写**，见 textLayerWrite 注释）
  textFontWrite: 0,       // ITextLayer.font 写穿次数
  textAlignWrite: 0,      // ITextLayer.horizontalalign / verticalalign 写穿次数
  originalOriginRead: 0,  // thisLayer.originalOrigin 命中 authored 快照（真值）
  originalOriginMiss: 0,  // 无 authored 快照 ⇒ 惰性补抓/空引用（可观测的降级）
  getEffect: 0,           // IEffectLayer.getEffect(name|index) **解析成功**
  getEffectUnresolved: 0, // 同上但解析不到（返回安全句柄，不抛错）
  getEffectCount: 0,      // IEffectLayer.getEffectCount()
  effectWrite: 0,         // IEffect 的 visible/name/setMaterialProperty 写穿次数
  effectWriteUnresolved: 0, // 对"未解析句柄"的写（记帐而非静默丢弃）
  debugRead: 0, debugWrite: 0,  // thisLayer.debug（官方无此成员，见 debugFlagOf 注释）
  // ①(P-174 2026-09-24) `ISoundLayer.volume`（d.ts L744-771/L768）—— 本批新成员的可观测计数。
  //   读/写各自留痕；`volumeWriteRejected` = 非有限值被拒（**不落盘**）；`volumeClamp` = 超出 [0,1]
  //   被 clamp（写进去的是 clamp 后的数，读回来才等于屏幕上的数）。
  volumeRead: 0, volumeWrite: 0, volumeWriteRejected: 0, volumeClamp: 0,
};
/** 计数表快照（浅拷贝；测试/诊断用，**不**暴露可变引用）。 */
export function sceneScriptApiDiag() { return Object.assign({}, SCENE_SCRIPT_API_DIAG); }
/** 计数表清零（测试用；返回被清的键数）。 */
export function resetSceneScriptApiDiag() {
  const keys = Object.keys(SCENE_SCRIPT_API_DIAG);
  for (const k of keys) SCENE_SCRIPT_API_DIAG[k] = 0;
  return keys.length;
}
const apiBump = (k, n) => { SCENE_SCRIPT_API_DIAG[k] = (SCENE_SCRIPT_API_DIAG[k] | 0) + (n === undefined ? 1 : n); };

/** ①(P-141) `{script,value}` 脚本节点的**写穿**取值：scene.json 里很多属性是节点而不是裸值。 */
const nodeRaw = (v) => ((v && typeof v === 'object' && 'value' in v) ? v.value : v);
/** ①(P-141) 写回：属性是脚本节点就写它的 `value`（不能整只替换 —— 那会把 author 的脚本删掉，
 *   而渲染器 `syncScriptOrigins` 明确读 `raw.origin.value`，说明节点形态是契约）。 */
const nodeWrite = (obj, key, v) => {
  const cur = obj ? obj[key] : undefined;
  if (cur && typeof cur === 'object' && 'value' in cur) cur.value = v;
  else if (obj) obj[key] = v;
};
/* ①(P-142 2026-09-23) 官方 `ITextLayer.text: String`（d.ts L812-816 “The text that will be displayed.”，
 *   且 `interface ILayer extends IObject, IImageLayer, ISoundLayer, IEffectLayer, ITextLayer, …` L1139
 *   ⇒ **每个** ILayer 上都有 `text`）。
 *   · 读：属性是 `{script,value}` 节点时取 `value`（与 origin/scale/alpha 同一个 nodeRaw 口径）；
 *     `null/undefined` ⇒ 返回 `''`（官方类型是 String ⇒ 保证作者脚本的 `.toString()/.split()/…`
 *     不会掉进 TypeError；'' 与"这个层没有文本"在数值上无法区分，但不编造内容）。
 *   · 写：写穿到节点的 `value`（nodeWrite），**不整只替换节点**（那会把作者的脚本删掉）。
 *   · 依据强度：高（官方 d.ts 字段类型 + 真包 `0923/3122339805` 的
 *     `thisLayer.text.toString().split("|").join("\n")` 三处调用点，读不到就是 `reading 'toString'`）。 */
const textOf = (obj) => { const t = nodeRaw(obj ? obj.text : null); return t == null ? '' : String(t) };
const writeText = (obj, v) => { if (obj) nodeWrite(obj, 'text', v == null ? '' : String(v)) };

/* ═══════════════════════════════════════════════════════════════════════════════
 * ①(P-143 2026-09-23) **静默缺口批次**：`ITextLayer` 的四个值成员 + `originalOrigin` +
 *   `IEffectLayer.getEffect` + `thisLayer.debug`
 *
 * 为什么单独一批（比抛错更危险）：这四类都**不抛错**，只是让作者脚本拿到 `undefined`，
 *   再在算术后变成 `NaN`（或让 `if (x)` 恒假）—— 门禁看不见、日志看不见，画面/布局错。
 *   现场（本文件实测，改前读数写进 tests/script-member-gaps-test.mjs 的 S2 注释）：
 *     · `wallpaperE/佩丽卡/佩丽卡1_03.mpkg` `objects[5].origin`（update 第 3 帧）：
 *       `value.y = shared.jpc_clockPosition.y + thisLayer.pointsize * 0.36 + 5`
 *       —— `pointsize` 是 `undefined` ⇒ `undefined * 0.36` = **NaN** ⇒ 整条 origin 变成
 *       `"2925.104490 NaN 0.000000"`（实测；同包 objects[3]/[4] 写 horizontalalign/verticalalign）。
 *     · `wallpaperE/芙宁娜/芙宁娜1_04.mpkg` / `芙宁娜_08.mpkg` 的 init：
 *       `thisScene.createLayer({ …, pointsize: thisLayer.pointsize, font: thisLayer.font, … })`
 *       —— 阴影文本层被建成 `pointsize: undefined, font: undefined`（静默用渲染器缺省 32/默认字体，
 *       与源层的 38/`fonts/8bitOperatorPlus8-Regular.ttf` 不一致）。
 *     · `0923/3521337568` / `0923/3653641024` / `dd/3554161528` 的 NSL 拖动库：
 *       `thisLayer.origin = thisLayer.originalOrigin; // 恢复初始位置` —— 读不到 ⇒ 传给 `set origin`
 *       的是 undefined ⇒ `toXYZShared` 返 null ⇒ **静默不写**（"重置位置"这个功能整条死掉）。
 *     · `0923/3122339805`（`thisLayer.getEffect(0).visible=false`，effect 开关）与
 *       `0923/2887099508`（`thisScene.getLayer('中-菜单-浮动')['getEffect']('阴影-设置3').visible=true`，
 *       鼠标进出切换 UI 阴影）—— 缺成员 ⇒ `getEffect is not a function`（update / cursorEnter 抛）。
 *     · `0923/3662790108`：`if (thisLayer.debug) { console.log(…) }` —— 读不到 ⇒ 作者调试分支
 *       恒假，且 `typeof thisLayer.debug` 是 `'undefined'` 而不是布尔。
 *
 * 官方语义出处（一手 = 随引擎发布的类型声明 `$MPW_ROOT/wallpaper_engine/ui/dist/monaco/autocomplete/
 *   lib.sceneScript.d.ts`，行号为实测；官方文档 docs.wallpaperengine.io 作补充）：
 *   · L812-868 `interface ITextLayer`：`text: String`；`color: Vec3`；`alpha: Number`；
 *     `pointsize: Number`（注："Size of the font in points for 300 DPI."）；
 *     `font: String`（"Font path."）；`horizontalalign: String`
 *     （"Horizontal text alignment: left, center, right."）；`verticalalign: String`
 *     （"Vertical text alignment: center, top, bottom."）。L1139 `interface ILayer extends IObject,
 *     IImageLayer, ISoundLayer, IEffectLayer, ITextLayer, …` ⇒ **每个** ILayer 上都有这四个。
 *   · L775-806 `interface IEffectLayer`：`getEffect(name: String|Number): IEffect`（L779，
 *     "Find a material effect by its name or index."）、`getEffectCount(): Number`（L784）。
 *     L520-545 `interface IEffect extends IObject`：`getMaterial(index)`、`getMaterialCount()`、
 *     `setMaterialProperty(propertyName, value)`、`visible: Boolean`、`name: String`；
 *     L512-514 `interface IMaterial extends IObject {}`（**没有**自己的字段）。
 *   · `originalOrigin` 与 `debug` **不在**官方 d.ts、也**不在**官方 ILayer 文档页
 *     （docs.wallpaperengine.io/en/scene/scenescript/reference/class/ILayer.html 只列
 *     origin/angles/scale/name/visible/parallaxDepth + getAnimation/getParent/…）⇒ 这两条的
 *     依据强度只有"真机语料 + 行为对照"，见各自实现处的强度标注。
 *
 * 缺省值策略（**绝不返回 undefined/NaN 给参与算术的值**）：
 *   四个文本成员的缺省**逐位对齐本仓库渲染器实际使用的那份**（一台机器只有一个真值）：
 *     `core/we-scene-bundle.js:1583` `pointsize: textNum(o.pointsize, 32)`（同一函数要求 `> 0`）、
 *     `:1578` `font: typeof o.font === 'string' ? o.font : ''`、
 *     `:1586-1587` `horizontalalign → 'left'` / `verticalalign → 'top'`；
 *     `demo.html:4403` `Math.max(6, (t.pointsize || 32) * ptScale)` 同款 32。
 *   所以 `thisLayer.pointsize` 读到的就是**屏幕上那个字号**（缺字段 ⇒ 32，不是 NaN）。
 *
 * 写回口径（"写回不破坏节点"）：一律走 `nodeWrite` —— 属性是作者的 `{script,value}` 节点
 *   （或 `{user,value}` 用户属性绑定）时写它的 `value`，**不整只替换**（替换会删掉作者的脚本，
 *   下一帧 `collect()` 就再也找不到这个节点 ⇒ 作者的属性脚本永久停摆）。数值字段（pointsize）
 *   只在 **Number.isFinite** 时写 ⇒ 作者写 NaN/undefined 不会把节点写坏。
 *
 * ⚠ 已知限制（未证实项，记在这里以免被当成"看起来没生效"的新 bug）：`demo.html` 每帧的
 *   "脚本 → 渲染层"同步白名单只有 text/alpha/visible/color/origin（demo.html:3992-4034），
 *   且 `__text` 的字号/对齐是 core 在**载入时**烘焙的 ⇒ 本批的 pointsize/font/horizontalalign/
 *   verticalalign 写穿对**当前渲染画面**不生效（改 demo/core 不在本批权限内）。本批保证的是
 *   "读到真值 + 写进 scene.json 契约（节点保留）"，这也是作者脚本自己 `createLayer({pointsize:
 *   thisLayer.pointsize})` 这类**读取**路径的真值来源。
 * ═══════════════════════════════════════════════════════════════════════════════ */

/** ①(P-143) `ITextLayer.pointsize`（d.ts L838-841，Number，"Size of the font in points for 300 DPI."）。
 *  读：`{script,value}`/`{user,value}` 节点取 value（nodeRaw 一处口径），再按**渲染器**的
 *  `textNum` 语义归一：非有限或 ≤ 0 ⇒ **32**（`core/we-scene-bundle.js:1583/1395-1400`）。
 *  为什么 ≤0 也回 32：读到的数必须等于屏幕上用的数（P-137 的"同一个 ILayer 概念不能有两套数"），
 *  而渲染器对 0/负值就是画 32。依据强度：**高**（官方字段类型 + 仓库渲染器自己的缺省 + 3 个真包）。 */
const pointsizeOf = (obj) => {
  const n = Number(nodeRaw(obj ? obj.pointsize : null));
  return Number.isFinite(n) && n > 0 ? n : 32;
};
/** ①(P-143) `ITextLayer.font`（d.ts L843-846，String，"Font path."）。
 *  读：缺字段 ⇒ `''`（**不是 undefined**：作者脚本常做 `font.split('/').pop()` / `+ ''`）。
 *  依据强度：高（官方 String 类型 + `core:1578` 同款缺省 `''` + 2 个真包读 `thisLayer.font`）。 */
const fontOf = (obj) => {
  const raw = nodeRaw(obj ? obj.font : null);
  return raw == null ? '' : String(raw);
};
/** ①(P-143) `ITextLayer.horizontalalign` / `verticalalign`（d.ts L853-861，String）。
 *  读：非空字符串 ⇒ 原样返回（**真值**，含作者写的未知取值）；否则给渲染器缺省
 *  （`core:1586-1587`：horizontalalign → 'left'、verticalalign → 'top'）。
 *  依据强度：高（官方字段类型 + 官方取值表 left/center/right、center/top/bottom + 仓库渲染器缺省）。 */
const HAlignDefault = 'left';
const VAlignDefault = 'top';
const alignOf = (obj, key) => {
  const raw = nodeRaw(obj ? obj[key] : null);
  if (typeof raw === 'string' && raw) return raw;
  return key === 'verticalalign' ? VAlignDefault : HAlignDefault;
};
/** ①(P-143) 四个文本成员的**统一写入口**（"写回不破坏节点" + "绝不写坏成 NaN"）。
 *  · pointsize：只在 `Number.isFinite` 时写（作者写 NaN/undefined ⇒ 原地不动 + 不计数）；
 *  · font：null/undefined ⇒ `''`（官方 String，与 readText 的缺省一致）；
 *  · 两个对齐：null/undefined ⇒ 不写（保持 authored）；其余 `String(v)` 原样写（不编造取值表）。
 *  返回是否真的写了（测试可直接断言）。 */
const textLayerWrite = (obj, key, v) => {
  if (!obj) return false;
  if (key === 'pointsize') {
    const n = Number(v);
    if (!Number.isFinite(n)) return false;      // ⚠ 这一行就是"静默变 NaN"的对策：非有限值不落盘
    nodeWrite(obj, 'pointsize', n);
    apiBump('textPointsizeWrite');
    return true;
  }
  if (key === 'font') {
    nodeWrite(obj, 'font', v == null ? '' : String(v));
    apiBump('textFontWrite');
    return true;
  }
  if (v == null) return false;
  nodeWrite(obj, key, String(v));
  apiBump('textAlignWrite');
  return true;
};

/* ①(P-143) `originalOrigin`（**官方 d.ts/文档都没有**；真机语料 3 个包 + 行为对照 wer-ref
 *   `WPSceneScriptHost.cpp:2268-2295`：它把 originalOrigin 实现成"**作者 authored 的**层 origin"
 *   —— 逐字结论 "Wallpaper Engine exposes originalOrigin as the authored base layer origin,
 *   not the script-updated runtime origin"，且从**载入时抓的初始层配置**里取、并解 `{value}` 节点；
 *   同文件 `:6747-6752` 只在"该层仍有初始配置记录"时才把 originalOrigin 报成存在的成员。
 *   ⇒ 依据强度：**中**（两条独立行为证据 + 真包调用点；非官方类型声明）。
 *
 *   为什么必须有"快照"而不是直接读 `obj.origin`：本文件的脚本宿主会把作者脚本的返回值写回
 *   **同一个节点的 `value`**（`runScriptValueCached`：`scriptVal.value = formatResult(result)`）⇒
 *   `obj.origin.value` 是**运行值**，不是 authored 值。用运行值当 originalOrigin，"恢复初始位置"
 *   就退化成 no-op（静默错值）。所以快照必须在**任何脚本跑之前**抓：入口 `applySceneScripts`
 *   在 prepare 趟之前调 `snapshotAuthoredOrigins(sceneObjects)`；`createLayer` 造的新层在返回给
 *   作者之前抓（否则下一帧抓到的已经是作者脚本动过的位置）。
 *   没有任何记录可抓时（例如测试直接 `makeSceneRef(objects)` 后再读）⇒ **惰性补抓当前值**
 *   （尽力而为）并计 `originalOriginMiss`（可观测的降级，不静默）。空引用 ⇒ Vec3(0,0,0)（有限值）。 */
const AUTHORED_ORIGIN = new WeakMap();
/** 抓一份 authored origin 快照（幂等：已有记录不覆盖）。返回记录或 null。 */
function noteAuthoredOrigin(obj) {
  if (!obj || typeof obj !== 'object') return null;
  let rec = null;
  try { rec = AUTHORED_ORIGIN.get(obj) || null } catch { rec = null }
  if (rec) return rec;
  const p = toXYZShared(nodeRaw(obj.origin));
  rec = p || [0, 0, 0];
  try { AUTHORED_ORIGIN.set(obj, rec) } catch { /* ignore */ }
  return rec;
}
/** 在**任何脚本跑之前**给整层表抓快照（applySceneScripts 的 prepare 趟之前调用）。
 *  返回本次新抓的层数（第二次起恒 0 = 幂等，不覆盖第一帧的真值）。 */
export function snapshotAuthoredOrigins(objects) {
  let n = 0;
  for (const o of Array.isArray(objects) ? objects : []) {
    if (!o || typeof o !== 'object') continue;
    let has = false;
    try { has = AUTHORED_ORIGIN.has(o) } catch { has = false }
    if (!has) { noteAuthoredOrigin(o); n++ }
  }
  return n;
}
/** 读 authored origin（**永远返回有限值的 Vec3**：作者脚本会直接 `.add()/.subtract()`）。 */
const authoredOriginOf = (obj) => {
  if (!obj || typeof obj !== 'object') { apiBump('originalOriginMiss'); return new Vec3(0, 0, 0) }
  let rec = null;
  try { rec = AUTHORED_ORIGIN.get(obj) || null } catch { rec = null }
  if (!rec) { apiBump('originalOriginMiss'); rec = noteAuthoredOrigin(obj) || [0, 0, 0] }
  else apiBump('originalOriginRead');
  return new Vec3(rec[0], rec[1], rec[2]);
};

/* ①(P-143) `IEffectLayer.getEffect(name|Number): IEffect` + `getEffectCount(): Number`
 *   （官方 d.ts L775-784；`ILayer extends … IEffectLayer …` L1139 ⇒ `thisLayer` 上就有）。
 *   真值落点（两份真包的 scene.json 实测）：层的 `effects: [ { file, id, name, visible,
 *   passes:[{ constantshadervalues:{…}, id }] } ]` —— `getEffect(0)` = 下标、
 *   `getEffect('阴影-设置3')` = 按 `name` 找（0923/2887099508 的 '中-菜单-浮动' 有
 *   ""/阴影-设置1..4 五个 effect）；`visible` 可能是作者的 `{script,value}` 节点
 *   （0923/3122339805 的 effects[0].visible 就是脚本节点）。
 *   解析不到（层没有 effects / 名字对不上 / 下标越界）⇒ 返回**安全句柄**（不是 undefined，
 *   作者紧跟的 `.visible = …` 不抛错）+ 计 `getEffectUnresolved`（不静默）。
 *   依据强度：高（官方签名 + 两份真包调用点与真值结构）。 */
const EFFECT_REF_OF = new WeakMap();
const effectListOf = (obj) => (obj && Array.isArray(obj.effects)) ? obj.effects : null;
const effectIndexOf = (obj, nameOrIndex) => {
  const list = effectListOf(obj);
  if (!list || !list.length) return -1;
  if (typeof nameOrIndex === 'number') {
    const i = Math.trunc(nameOrIndex);
    return (i >= 0 && i < list.length) ? i : -1;
  }
  if (typeof nameOrIndex === 'string') {
    for (let i = 0; i < list.length; i++) { const e = list[i]; if (e && typeof e.name === 'string' && e.name === nameOrIndex) return i }
    return -1;
  }
  return -1;
};
/** 官方 `IMaterial extends IObject {}`（d.ts L512-514 没有自己的字段）⇒ 只给 IObject 面
 *  （`getAnimation(name?)`，d.ts L494-499），与其它 IObject 句柄同一份实现。 */
const makeMaterialRef = () => ({
  getAnimation: (name) => { apiBump('getAnimation'); return makeAnimationRef(null, name) },
});
/** 一个 IEffect 句柄（同一个 effect 每次访问返回**同一个对象** ⇒ 作者缓存它、改一处不分叉）。 */
function makeEffectRef(obj, index, requestedName) {
  const eff = (obj && index >= 0) ? ((effectListOf(obj) || [])[index] || null) : null;
  const ref = {
    get visible() { return eff ? (nodeRaw(eff.visible) !== false) : true },   // 未解析 ⇒ true（没有可关的效果，不编造 false）
    set visible(v) { if (eff) { nodeWrite(eff, 'visible', !!v); apiBump('effectWrite') } else apiBump('effectWriteUnresolved') },
    get name() {
      if (eff && typeof eff.name === 'string') return eff.name;
      return typeof requestedName === 'string' ? requestedName : '';
    },
    set name(v) { if (eff) { nodeWrite(eff, 'name', v == null ? '' : String(v)); apiBump('effectWrite') } else apiBump('effectWriteUnresolved') },
    getMaterialCount: () => (eff && Array.isArray(eff.passes)) ? eff.passes.length : 0,
    /** 官方 `IMaterial extends IObject {}`（d.ts L512-514 **没有**自己的字段）⇒ 只给 IObject 面；
     *  pass 的常量表通过上面的 `setMaterialProperty` 写（那才是官方提供的写入口）。
     *  未解析的 effect 也给同一个句柄形状（作者 `getMaterial(0).getAnimation(name)` 不抛错）。 */
    getMaterial: () => makeMaterialRef(),
    /** 官方："Set a property value on all materials used by this effect that have a matching property."
     *  真值落点 = 各 pass 的 `constantshadervalues`（语料里那些 `.effects[i].passes[0].constantshadervalues`
     *  脚本节点就是同一处）；只写**已经存在**的键（"that have a matching property" 逐字语义）。 */
    setMaterialProperty: (propertyName, value) => {
      if (!eff || !Array.isArray(eff.passes)) { apiBump('effectWriteUnresolved'); return }
      const key = String(propertyName);
      const w = (value && typeof value === 'object')
        ? (Array.isArray(value) ? value.join(' ') : `${Number(value.x) || 0} ${Number(value.y) || 0} ${Number(value.z) || 0}`)
        : value;
      let n = 0;
      for (const pass of eff.passes) {
        const csv = pass && pass.constantshadervalues;
        if (csv && typeof csv === 'object' && key in csv) { nodeWrite(csv, key, w); n++ }
      }
      if (n) apiBump('effectWrite', n); else apiBump('effectWriteUnresolved');
    },
  };
  return ref;
}
/** `getEffect` 的唯一入口：解析 + 稳定句柄缓存 + 计数。 */
function effectRefFor(obj, nameOrIndex) {
  const index = effectIndexOf(obj, nameOrIndex);
  if (index < 0) { apiBump('getEffectUnresolved'); return makeEffectRef(obj, -1, nameOrIndex) }
  apiBump('getEffect');
  let box = null;
  try { box = obj ? EFFECT_REF_OF.get(obj) : null } catch { box = null }
  if (!box) { box = new Map(); if (obj) { try { EFFECT_REF_OF.set(obj, box) } catch { /* ignore */ } } }
  let r = box.get(index);
  if (!r) { r = makeEffectRef(obj, index, nameOrIndex); box.set(index, r) }
  return r;
}
const effectCountOf = (obj) => { apiBump('getEffectCount'); const l = effectListOf(obj); return l ? l.length : 0 };

/* ①(P-143) `thisLayer.debug`（真包 0923/3662790108 两处 `if (thisLayer.debug) { console.log(…) }`）。
 *  ⚠ 依据强度：**低** —— 官方 d.ts 与官方 ILayer 文档页都**没有**这个成员（实测 grep 两份都 0 命中），
 *  所以不存在"官方语义优先"可依。取"**布尔调试开关，缺省 false**"是唯一不改变作者行为的安全缺省：
 *    · 读：`false`（调试输出保持关闭 = WE 里该分支不成立的同一观感），且 `typeof` 是 `'boolean'`
 *      而不是 `'undefined'` ⇒ `if (x === false)` / `!x` / `String(x)` 这类写法不再因类型不同走岔；
 *    · 写：记进 WeakMap（`thisLayer.debug = true` 之后读得到 true，作者自建的调试开关自洽）+ 计数；
 *    · 绝不在 `obj` 上凭空造 `debug` 键（scene.json 形状不被污染）。
 *  没有把 `thisLayer.debug` 映射到作者的 `scriptProperties.debug`（虽然那个包的作者显然想要那个效果）：
 *   官方没有这条映射，编造映射会让"读的是层属性"这一语义在别的包里悄悄变味。 */
const LAYER_DEBUG_STATE = new WeakMap();
const debugFlagOf = (obj) => {
  apiBump('debugRead');
  if (!obj) return false;
  try { return LAYER_DEBUG_STATE.get(obj) === true } catch { return false }
};
const writeDebugFlag = (obj, v) => {
  if (!obj) return false;
  try { LAYER_DEBUG_STATE.set(obj, !!v); apiBump('debugWrite'); return true } catch { return false }
};

/* ①(P-143) **"作者显式属性写优先于返回值"**（键 = 脚本节点对象本身）。
 *   背景：`runScriptValueCached` 在 update/init 返回后会把返回值写回节点（`scriptVal.value = formatResult(r)`），
 *   而作者的返回值常常是**进入函数时的快照**（`export function update(value) { thisLayer.origin = …; return value; }`
 *   —— `value` 是赋值前的旧值）⇒ 会把刚写的显式赋值**回滚**。
 *   旧实现为什么"看起来没事"：`thisLayer.origin = …` 直接把整个 `{script,value}` 节点替换成字符串 ⇒
 *   返回值落进那个**已经脱离场景树**的节点，场景里留下的是显式赋值 —— 但代价是作者的脚本节点被删掉、
 *   下一帧 `collect()` 再也找不到它（作者的属性脚本**永久停摆**，静默）。
 *   本批把 origin/scale 的写改成 nodeWrite（保节点）之后，必须同时把"显式写优先"这条语义显式补上，
 *   否则 P-60 的既有契约（tests/script-owner-live-test.mjs T3b：脚本里写 origin 必须落在场景对象上）会破。
 *   机制：setter 里 nodeWrite 之后把**那个节点对象**记进 WeakSet；runScriptValueCached 在调用前后
 *   各清一次，只在"本次调用期间发生过显式写"时跳过返回值写回（不会跨帧残留）。 */
const EXPLICIT_PROP_WRITE = new WeakSet();
const markExplicitPropWrite = (obj, key) => {
  const node = obj ? obj[key] : null;
  if (node && typeof node === 'object') { try { EXPLICIT_PROP_WRITE.add(node) } catch { /* ignore */ } }
};
/** ①(P-141) 定义**访问器**（不是数据属性）。为什么不用 `Object.assign(target, { get x() {} })`：
 *   `Object.assign` 对源对象的访问器是**取值后拷贝**（规范 [[Get]] + CreateDataProperty）⇒ 目标上
 *   变成普通数据属性 —— `a.fps = 1` 会真的覆盖它、`ps.rate = 2` 不会落到 instance。必须 defineProperty。 */
/** ①(P-141) `origin/scale/angles/color` 的写入归一化（与 `makeOwnerRef().toXYZ` 同一口径：
 *   接受 Vec3/Vec2/数组/`"x y z"` 字符串；无法解析 ⇒ null = 静默不写，绝不写坏坐标 —— P-60 的教训）。 */
const toXYZShared = (v) => {
  if (v == null) return null;
  if (typeof v === 'string') {
    const p = v.trim().split(/\s+/).map(Number);
    if (!p.length || !isFinite(p[0])) return null;
    return [p[0], isFinite(p[1]) ? p[1] : 0, isFinite(p[2]) ? p[2] : 0];
  }
  const x = v.x != null ? v.x : v[0];
  const y = v.y != null ? v.y : v[1];
  const z = v.z != null ? v.z : (v[2] != null ? v[2] : 0);
  if (x == null || !isFinite(Number(x))) return null;
  return [Number(x), isFinite(Number(y)) ? Number(y) : 0, isFinite(Number(z)) ? Number(z) : 0];
};
const defineAccessors = (target, spec) => {
  for (const k of Object.keys(spec)) {
    Object.defineProperty(target, k, Object.assign({ enumerable: true, configurable: true }, spec[k]));
  }
  return target;
};

/* ═══════════════════════════════════════════════════════════════════════════════
 * ①(P-174 2026-09-24) **层引用成员 × 五个面**：`ISoundLayer.volume` + "同一个 ILayer 概念一套面"
 *
 * 五个面（本文件里同一个 ILayer 概念的五个挂载点，P-137 的教训就是它们必须逐位同源）：
 *   F1 `makeSceneRef().layer()`（`thisScene.getLayer/enumerateLayers/getSceneObject/createLayer` 返回的引用）
 *   F2 `makeOwnerRef().emptyLayerRef()`（空引用：`getParent()` 找不到父层、根层再往上）
 *   F3 `makeOwnerRef().layerRefFor(obj)`（`getParent()` **找到**父层时的引用）
 *   F4 `thisLayer`（`makeOwnerRef().layerRef()`）
 *   F5 `thisObject`（`makeOwnerRef().objectRef()`）
 * 本批把 6 个"值成员"做成**同一对 get/set 函数对象挂在五个面上**（同源可自证：
 *   `Object.getOwnPropertyDescriptor(face,'volume').get === LAYER_REF_MEMBER_ACCESSORS.volume.get`），
 *   不是五份复制代码 —— 这正是 tests/script-layer-ref-audit-test.mjs 的 S5 要钉的东西。
 *
 * 成员与一手出处（官方类型声明 `$MPW_ROOT/wallpaper_engine/ui/dist/monaco/autocomplete/
 *   lib.sceneScript.d.ts`，行号为实测；`L1139 interface ILayer extends IObject, IImageLayer,
 *   ISoundLayer, IEffectLayer, ITextLayer, IParticleSystem, IModel, ICamera` ⇒ 下列成员在**每个** ILayer 上）：
 *   · `volume`        —— L744-771 `ISoundLayer` 的 `volume: Number`（L768，注释 "Adjust volume."）。
 *     **本批之前五个面一个都没有** ⇒ 真包 `0923/2887099508` 的
 *     `thisScene['getLayer']('桥')['volume']=0x1`（objects[76] 的可见性脚本，实测 6 处写 volume）
 *     既不报错也不生效：返回的层引用是临时对象，赋值只是在它上面新建一个立刻丢弃的自有属性。
 *   · `alpha`         —— L995-998 `IImageLayer.alpha`（"Opacity of the layer."），L826-829 `ITextLayer.alpha`
 *   · `color`         —— L1000-1003 `IImageLayer.color`（"Image color."），L821-824 `ITextLayer.color`
 *   · `alignment`     —— L1005-1008 `IImageLayer.alignment`（"center, top, right, bottom, left, topright etc"）
 *   · `angles`        —— L1148-1151 `ILayer.angles`（"Orientation of the layer in euler angles and degrees."）
 *   · `parallaxDepth` —— L1158-1161 `ILayer.parallaxDepth`（"Controls parallax strength along x and y axes individually."）
 *   为什么这 6 个一起做：前 5 个在 F1 早就有、F2-F5 缺失 —— 而语料里
 *     `thisObject.color = shared.accentColor`、`bar.parallaxDepth = new Vec2(0,0)`（9 包 11 处）、
 *     `bar.angles = {x,y,z}`（12 包 33 处）、`if (bar.alignment !== x) bar.alignment = x`（10 包 29 处）
 *   都是真写法（语料普查：206 容器 / 121 可解析 / 80 带脚本包，只在脚本源码串上按 `.M` 与 `['M']` 计数）
 *   ⇒ 缺一面就是静默错值/静默 no-op，正是 P-137 "同一个 ILayer 概念两套属性面"的病灶。
 *   `volume` 是本批的新成员，必须与它们共用同一套挂载机制（同源）。
 *
 * ── `volume` 的语义依据（本仓渲染器实际行为，不是猜）──────────────────────────────────
 *   · **落点 = `layer.soundprops.volume`**：本仓内置的渲染器产物 `demo/assets/renderer-BOSoB05I.js`
 *     的源码树在工作区 `references/vendor-ref/webwallgl/renderer/`（MIT 许可；**只取行为结论，
 *     未复制代码/注释**）：场景解析就是 `soundprops: { volume: parseNum(o.volume, 1), … }`
 *     （`vendor/we-scene/scene/parse.js:273-275`），播放端读
 *     `au.volume = Math.max(0, Math.min(1, layer.soundprops?.volume ?? 1))`（`src/scene-mount.ts:1602-1603`），
 *     两条既有写路径都是 **双写 + 实时控制器**：
 *       `run.layer.soundprops.volume = out; run.layer.soundCtl?.setVolume?.(out)`（`src/scene-mount.ts:3112-3118`）
 *       `layer.soundprops.volume = vol; layer.soundCtl?.setVolume?.(vol)`（同文件 `:3391-3396`）。
 *     它自己的层引用实现（`vendor/we-scene/render/text.js:1591-1603`）就是这个成员的标准形：
 *       get = `soundCtl.getVolume()` → `soundprops.volume` → **1**；
 *       set = 非有限值**直接 return**、`Math.max(0, Math.min(1, n))` 后写 `soundprops.volume` + `soundCtl.setVolume(c)`。
 *   · **本仓另一条既有链**：`demo.html` 的声音层 `<audio>`（`makeSoundElement` L3721、每帧
 *     `updateSceneAudioVolume()` L3796-3807）读 scene.json 的 `volume` 字段（`soundLayerVolumeBinding`
 *     L3693-3697 + `currentAudioVolume` L3698-3711）。所以写穿**同时**落到 `obj.volume`（并且
 *     **保作者节点**：真包 0923/2887099508 的 '桥' 是 `{user:"bgm", value:1}`、'HF' 是
 *     `{script:…, user:"bgm", value:1}` —— 整只替换会把作者的 script/user 绑定删掉）与
 *     `obj.soundprops.volume`（渲染器模型落点）+ `obj.soundCtl.setVolume()`（活控制器）。
 *   · **缺省 1、clamp[0,1]**：`parseNum(o.volume, 1)`（parse.js:274）+ 播放端与 setter 的 clamp。
 *   · **用户属性绑定优先**：`demo.html` 的 `currentAudioVolume`（L3698-3711）在 `volume` 是
 *     `{user:…}` 节点且用户属性有值时**用户值即屏幕值**；webwallgl 的属性热更同款
 *     （`boundUserName(src.volume)` 命中 ⇒ 用该值覆盖 `soundprops.volume`）。所以读的顺位是
 *     soundCtl → soundprops → 用户属性活值 → 节点 `value` → 1。
 *   ⚠ 已知限制（如实标注，不装成"全链生效"）：`demo.html` 的 `<audio>` 音量绑定对象是
 *     `makeSoundElement()` 创建时的**快照**，每帧只按该快照重算 ⇒ 本批写穿**不会**改变当前页面里
 *     已经建好的 `<audio>.volume`。这不是新增缺口：落点是"渲染器模型 + 作者节点 + 活控制器"三处
 *     **既有**落点（改 `demo.html` 不在本批权限内），而只要 `soundCtl` 存在（内置渲染器路径）
 *     `setVolume` 就是真生效。
 * ═══════════════════════════════════════════════════════════════════════════════ */

/** 面对象 → 取底层 scene.json 对象的函数。**必须惰性**：F4/F5 的 `ref.current` 每次属性访问时
 *  才确定（P-60 的根因），所以绑的是"取对象的函数"而不是对象本身。用 WeakMap 而不是往面对象上
 *  挂字段：面对象是作者 `Object.keys()`/展开可见的，多一个键就是多一份作者可见的形状。 */
const LAYER_FACE_TARGET = new WeakMap();
const bindLayerFace = (face, getObj) => { try { LAYER_FACE_TARGET.set(face, getObj) } catch { /* ignore */ } return face };
const layerFaceObject = (face) => {
  try { const g = face ? LAYER_FACE_TARGET.get(face) : null; return typeof g === 'function' ? g() : null } catch { return null }
};

/** 当前用户属性活表（`applySceneScripts`/`dispatchScriptEvent` 每次执行前刷新）。
 *  只用于"用户属性绑定优先"的读取（见上方 volume 读顺位 ③）；没有它时退回节点 value。 */
let CURRENT_USER_PROPS = null;
const noteUserProps = (up) => { CURRENT_USER_PROPS = (up && typeof up === 'object') ? up : null };
const userPropOf = (name) => {
  const up = CURRENT_USER_PROPS;
  if (!up || typeof name !== 'string' || !name) return undefined;
  try { return up[name] } catch { return undefined }
};
const clamp01 = (n) => (n < 0 ? 0 : (n > 1 ? 1 : n));

/** ①(P-174) `layer.soundprops`：**已存在就复用**（保住里面可能有的 `{script,value}` 节点与
 *  其它键），不存在才按渲染器解析的形状新建一个只含 `volume` 的对象。非对象（含数组）⇒ 换掉。 */
function soundPropsFor(obj) {
  if (!obj || typeof obj !== 'object') return null;
  let sp = obj.soundprops;
  if (!sp || typeof sp !== 'object' || Array.isArray(sp)) {
    sp = {};
    try { obj.soundprops = sp } catch { return null }
  }
  return sp;
}

/** ①(P-174) `ISoundLayer.volume`（d.ts L768）**读**：读到"屏幕上真正用的那个数"。
 *  顺位 = 活控制器 → 渲染器模型落点 → 用户属性活值 → authored 节点 value → 1（见上方长注释）。
 *  全程 clamp[0,1]：播放端与解析端都是 clamp 后的值 ⇒ 读到的数就是 `<audio>.volume` 的那个数。 */
const volumeOf = (obj) => {
  apiBump('volumeRead');
  if (!obj || typeof obj !== 'object') return 1;
  try {
    const ctl = obj.soundCtl;
    if (ctl && typeof ctl.getVolume === 'function') {
      const n = Number(ctl.getVolume());
      if (Number.isFinite(n)) return clamp01(n);
    }
  } catch { /* 控制器抛错不影响读：继续往下走真实落点 */ }
  const sp = obj.soundprops;
  if (sp && typeof sp === 'object') {
    const n = Number(nodeRaw(sp.volume));
    if (Number.isFinite(n)) return clamp01(n);
  }
  const raw = obj.volume;
  if (raw && typeof raw === 'object' && typeof raw.user === 'string' && raw.user) {
    const n = Number(userPropOf(raw.user));
    if (Number.isFinite(n)) return clamp01(n);
  }
  const n = Number(nodeRaw(raw));
  return Number.isFinite(n) ? clamp01(n) : 1;
};

/** ①(P-174) `ISoundLayer.volume` **写**：`nodeWrite` 保作者节点 + 非有限值**不落盘** +
 *  clamp[0,1] + 三处既有落点（`obj.volume` 节点、`obj.soundprops.volume`、`soundCtl.setVolume`）。
 *  `markExplicitPropWrite` ⇒ 与 P-143 的 `EXPLICIT_PROP_WRITE`（显式属性写优先于返回值）同一机制：
 *  该属性自身也是脚本节点时，同一次调用里的显式赋值不被作者的返回值回滚。
 *  返回是否真的写了（测试可直接断言）。 */
const writeVolume = (obj, v) => {
  if (!obj || typeof obj !== 'object') { apiBump('volumeWriteRejected'); return false }
  const n = Number(v);
  if (!Number.isFinite(n)) { apiBump('volumeWriteRejected'); return false }   // ⚠ 非有限值不落盘
  const c = clamp01(n);
  if (c !== n) apiBump('volumeClamp');
  const sp = soundPropsFor(obj);
  if (sp) nodeWrite(sp, 'volume', c);
  nodeWrite(obj, 'volume', c);
  markExplicitPropWrite(obj, 'volume');
  try {
    const ctl = obj.soundCtl;
    if (ctl && typeof ctl.setVolume === 'function') ctl.setVolume(c);
  } catch { /* 控制器抛错不拖垮脚本 */ }
  apiBump('volumeWrite');
  return true;
};

/* ①(P-174) 另外 5 个值成员的**同一套**读写实现（F1 原来那一份的语义逐位保留，只有两处按
 *  "读到的数 = 屏幕上用的数"补齐缺省、并统一走 nodeWrite 保节点）：
 *   · `angles`       默认 (0,0,0)（`core/we-scene-bundle.js:1614 angles: world.angles`）
 *   · `color`        默认 (1,1,1)：`core:1616 color: parseColor(o.color)` + `:1378-1383 parseColor`
 *                    对 undefined/null/非字符串对象**就是** [1,1,1]。
 *                    ⚠ F1 旧读法是 `parseV(obj.color,[1,1,1])`，缺字段时 `Number('')===0` 让 x 变成 0
 *                    ⇒ 读到 (0,1,1)（屏幕上其实是白的）—— 本批顺手修掉（"default 只在 nullish 生效"
 *                    这个坑 `createLayer` 里已经踩过一次）。
 *   · `alignment`    默认 `'center'`：`core:1615 alignment: o.alignment || 'center'`；F1 旧读法直接
 *                    返回 `obj.alignment`（缺字段 = undefined）⇒ 作者的
 *                    `if (bar.alignment !== x) bar.alignment = x`（语料 10 包 29 处）会永远为真。
 *   · `parallaxDepth` 默认 (1,1,0)：与 F1 既有 default 一致（官方只写 Vec2、没写缺省 ⇒ **不编造**）；
 *                    写入口接受 Vec2/Vec3/数组/`"x y"` 串（`toXYZShared` 已覆盖三者）。
 *   · `alpha`        默认 1（`core:1619 alpha: … typeof o.alpha === 'number' ? o.alpha : 1`）；
 *                    写口径**逐位保留 F1 既有契约** `Number(v)||0`（本批不改既有语义）。
 *  写一律 `nodeWrite`（`{script,value}` 节点只改 value、不整只替换）+ `toXYZShared` 归一化
 *  （P-60 的教训：字符串按字符下标取值会把坐标写坏）。 */
const ANGLES_DEFAULT = [0, 0, 0];
const COLOR_DEFAULT = [1, 1, 1];
const PARALLAX_DEFAULT = [1, 1, 0];
const ALIGNMENT_DEFAULT = 'center';
const vec3OfField = (obj, key, def) => {
  const p = toXYZShared(nodeRaw(obj ? obj[key] : null));
  return p ? new Vec3(p[0], p[1], p[2]) : new Vec3(def[0], def[1], def[2]);
};
const writeVec3Field = (obj, key, v) => {
  if (!obj) return false;
  const p = toXYZShared(v);
  if (!p) return false;                                  // 解析不了 ⇒ 静默不写（绝不写坏坐标）
  nodeWrite(obj, key, `${p[0].toFixed(6)} ${p[1].toFixed(6)} ${p[2].toFixed(6)}`);
  return true;
};
const anglesOf = (obj) => vec3OfField(obj, 'angles', ANGLES_DEFAULT);
const writeAngles = (obj, v) => writeVec3Field(obj, 'angles', v);
const colorOf = (obj) => vec3OfField(obj, 'color', COLOR_DEFAULT);
const writeColor = (obj, v) => writeVec3Field(obj, 'color', v);
const parallaxDepthOf = (obj) => vec3OfField(obj, 'parallaxDepth', PARALLAX_DEFAULT);
const writeParallaxDepth = (obj, v) => {
  if (!obj) return false;
  const p = toXYZShared(v);
  if (!p) return false;
  nodeWrite(obj, 'parallaxDepth', `${p[0]} ${p[1]}`);     // 官方是 Vec2（d.ts L1158）⇒ 只写两段
  return true;
};
const alignmentOf = (obj) => {
  const raw = nodeRaw(obj ? obj.alignment : null);
  return (typeof raw === 'string' && raw) ? raw : ALIGNMENT_DEFAULT;
};
const writeAlignment = (obj, v) => {
  if (!obj || v == null) return false;
  nodeWrite(obj, 'alignment', String(v));
  return true;
};
const alphaOf = (obj) => {
  const a = nodeRaw(obj ? obj.alpha : null);
  return a === undefined || a === null ? 1 : Number(a);
};
const writeAlpha = (obj, v) => { if (!obj) return false; nodeWrite(obj, 'alpha', Number(v) || 0); return true };

/** ①(P-174) **五面共用的访问器对象**（同一对 get/set 函数对象；测试用身份相等自证"一套实现挂在五处"）。
 *  `this` = 面对象 ⇒ 通过 LAYER_FACE_TARGET 取底层 scene.json 对象（惰性，F4/F5 必需）。
 *  ⚠ 必须写成 `{ get() {}, set() {} }` 这种**方法简写**（数据属性），不能写成 `{ get x() {} }`
 *  （那会在 spec 对象自身上建访问器，`defineAccessors` 的 `Object.assign` 会把它**取值摊平**）。 */
export const LAYER_REF_MEMBER_ACCESSORS = {
  volume: {
    get() { return volumeOf(layerFaceObject(this)) },
    set(v) { writeVolume(layerFaceObject(this), v) },
  },
  alpha: {
    get() { return alphaOf(layerFaceObject(this)) },
    set(v) { writeAlpha(layerFaceObject(this), v) },
  },
  angles: {
    get() { return anglesOf(layerFaceObject(this)) },
    set(v) { writeAngles(layerFaceObject(this), v) },
  },
  color: {
    get() { return colorOf(layerFaceObject(this)) },
    set(v) { writeColor(layerFaceObject(this), v) },
  },
  parallaxDepth: {
    get() { return parallaxDepthOf(layerFaceObject(this)) },
    set(v) { writeParallaxDepth(layerFaceObject(this), v) },
  },
  alignment: {
    get() { return alignmentOf(layerFaceObject(this)) },
    set(v) { writeAlignment(layerFaceObject(this), v) },
  },
};
/** ①(P-174) 五个面的名字（审计表/测试的列口径；顺序 = F1…F5）。 */
export const LAYER_REF_FACE_NAMES = ['F1_getLayer', 'F2_emptyLayerRef', 'F3_layerRefFor', 'F4_thisLayer', 'F5_thisObject'];

/** ①(P-142 2026-09-23) `IImageLayer.getAnimationLayerCount(): Number`（d.ts L1017-1020；`IModelLayer`
 *   同款 L1096）—— `getAnimationLayer` 的**官方伴生成员**，`in` 检查与循环都成对出现：
 *   语料实例 `0923/3521337568`、`0923/3653641024`（NSL 库）与 `0917/3462491575`：
 *     `let aniCount = overrideAniCount === null ? thisLayer.getAnimationLayerCount() : overrideAniCount`
 *     `for (i = 0; i < aniCount; i++) initSwayAni(thisLayer.getAnimationLayer(i), …)`
 *   （同段的 `if (!'getAnimationLayer' in thisLayer) throw 'You can only use …in image layers'` 也说明
 *   NSL 把这一族当成图片层的判据。）缺了它就是 `is not a function`、整段动画初始化死掉。
 *   口径与 `getAnimationLayer()` 返回的句柄上的同名成员**完全一致**（同一份 `animRefShared`，含
 *   "没有 `animationlayers` 字段 ⇒ 1"的既有口径）⇒ 一个 ILayer 概念不会出现两套数。 */
/** ③(P-228k 2026-10-05) **Vec3 写入归一化的唯一实现处**：Vec3（`.x/.y/.z` 或 `[0]/[1]/[2]`）、
 *  `"x y z"` 字符串、**标量**（广播到三分量；`0` ⇒ 原点）⇒ 返回 `"x y z"`（6 位小数）；写不了返回 null。
 *  为什么要有它：`thisScene.getLayer(...)`/`getParent()` 那条**层引用**的 `origin` setter 此前自己写了一遍
 *  `Number(v.x != null ? v.x : v[0])` —— 对**字符串**与**标量**都得 `NaN` ⇒ 往 raw 对象里写
 *  `"NaN NaN NaN"`（静默把坐标写坏）。语料实证：`0923/2887099508` 的 `安全模式` 脚本写
 *  `getLayer('中-菜单-浮动').origin = (-0x3e8,-0x3e8,0x0)`（逗号表达式 **= 0**）⇒ 菜单本该挪到原点，
 *  实际写进 NaN。"`?scriptvec=legacy`" 时标量仍按旧行为丢弃（字符串/Vec3 行为不变）。 */
/** ③(P-228k) 层引用 `origin` 写入的**只读**环形账（≤20 条）：`globalThis.__mpwVecWrites`。
 *  记录 `{name, value, kind}` —— `value=null` 表示**这次写入被丢弃**（旧行为下标量会走这里；
 *  `?scriptvec=legacy` 下仍然如此）⇒ "分支没走到"与"写被丢了"从此可区分。 */
/** ③(P-228l 2026-10-05) **属性写入轨迹**（只读环形 40 条）：`globalThis.__mpwPropWrites`。
 *  记 `{who, target, field, value, at}` —— `who` = 当前脚本所属层名（宿主 `ownerObj()` 能拿到就记，
 *  拿不到记 `'?'`）。为什么需要：同一个字段被多个脚本每帧写（本包 `健康壁纸.visible` 就是），
 *  只有"最后一次是谁写的"这一格读数**判不出竞争**；有了轨迹就能看出"谁在把它按回去"。 */
const PROP_WRITES = [];
let PROP_WRITE_OWNER = '?'          // 由 `setOwner()` 更新（**不依赖 hk**：层引用的 setter 在 hk 作用域之外）
function propWriteNote(obj, field, value) {
  try {
    const who = PROP_WRITE_OWNER
    PROP_WRITES.push({ who, target: String((obj && obj.name) || ''), field: String(field), value, at: Date.now() })
    if (PROP_WRITES.length > 40) PROP_WRITES.shift()
    globalThis.__mpwPropWrites = PROP_WRITES
  } catch (e) { /* 诊断面失败不影响写入 */ }
}
const VEC_WRITES = [];
function vecWriteNote(obj, value, raw) {
  try {
    VEC_WRITES.push({
      name: String((obj && obj.name) || ''),
      value: value == null ? null : String(value),
      kind: raw === undefined ? 'dropped' : (typeof raw === 'number' ? 'number' : typeof raw === 'string' ? 'string' : 'vec'),
      at: Date.now(),
    })
    if (VEC_WRITES.length > 20) VEC_WRITES.shift()
    globalThis.__mpwVecWrites = VEC_WRITES
  } catch (e) { /* 诊断面失败不影响写入 */ }
}
function vec3WriteString(v) {
  if (v == null) return null;
  if (typeof v === 'number') return (SCALAR_VEC_BROADCAST && isFinite(v)) ? [v, v, v].map((n) => n.toFixed(6)).join(' ') : null;
  if (typeof v === 'string') {
    const p = v.trim().split(/\s+/).map(Number);
    if (!p.length || !isFinite(p[0])) return null;
    return [p[0], isFinite(p[1]) ? p[1] : 0, isFinite(p[2]) ? p[2] : 0].map((n) => n.toFixed(6)).join(' ');
  }
  const x = v.x != null ? v.x : v[0];
  const y = v.y != null ? v.y : v[1];
  const z = v.z != null ? v.z : (v[2] != null ? v[2] : 0);
  if (x == null || !isFinite(Number(x))) return null;
  return [Number(x), isFinite(Number(y)) ? Number(y) : 0, isFinite(Number(z)) ? Number(z) : 0].map((n) => n.toFixed(6)).join(' ');
}
/* `?scriptvec=legacy` 的开关读一次（模块级，两个 setter 共用同一取值）。 */
const SCALAR_VEC_BROADCAST = (() => {
  try { return String(new URLSearchParams(location.search).get('scriptvec') || '').toLowerCase() !== 'legacy' } catch (e) { return true }
})();
const animLayerCountOf = (obj) => animRefShared(obj).getAnimationLayerCount();

/* ①(P-141) 层引用 → 场景对象的**身份表**。
 *   `thisScene.getLayerIndex(thisLayer)` 必须能把"层引用"映射回 `scene.objects` 里的那个对象；
 *   引用是每次访问新建的对象字面量（`layer()`/`layerRefFor()`/`createLayer()`），所以用 WeakMap
 *   记账（不往 scene.json 对象上写任何记号 —— 那些对象会被渲染器烘焙/序列化）。 */
const LAYER_OBJ_OF = new WeakMap();
function bindLayerObject(ref, obj) { if (ref && obj) { try { LAYER_OBJ_OF.set(ref, obj) } catch { /* ignore */ } } return ref; }
function layerObjectOf(ref) { try { return (ref && typeof ref === 'object') ? (LAYER_OBJ_OF.get(ref) || null) : null } catch { return null } }

/** ①(P-141) 官方 `IAnimationLayer` 的既有句柄（原 `makeOwnerRef()` 内的 `animRef`，本批提到模块级：
 *    `getAnimationLayer()` 与新的 `getAnimation()` 都要用它；**语义逐位不变**（全 no-op + 层数计数），
 *    `makeAnimationRef()` 在它之上**覆盖/追加**官方 `IAnimation` 面 ⇒ 是超集，不会打破任何既有调用。 */
export function animRefShared(obj) {
  return {
    play: () => {}, setFrame: () => {}, setTime: () => {}, setFps: () => {},
    setVisible: () => {}, setBlend: () => {}, setRate: () => {}, setScale: () => {},
    setOrigin: () => {}, setAngles: () => {}, setAlpha: () => {}, setColor: () => {},
    setSize: () => {}, setParallaxDepth: () => {}, setPosition: () => {}, setBrightness: () => {},
    setColorBlendMode: () => {}, getAnimationLayerCount: () => (obj && obj.animationlayers ? obj.animationlayers.length : 1),
    setFrameCount: () => {},
    addEndedCallback: () => {},
  };
}

/* ①(P-141) `ISoundLayer` + `IParticleSystem` 的**共用**播放面（官方：ILayer 同时继承这两个接口 ⇒
 *   同一个 `thisLayer` 上就有这批方法，不需要两套）。
 *   状态放在 WeakMap（不写进 scene.json）：宿主**没有**把脚本侧的 play/stop 接到 demo.html 的
 *   <audio> 池（那需要改 demo.html，本批不动）⇒ 这是"脚本可见的状态机"，不是解码器真实状态：
 *     isPlaying() 默认 false（= 没有已知在播的声音），play()→true，pause()/stop()→false。
 *   这样作者脚本的"播放/停止"逻辑内部自洽（先 play 再查得到 true），且**每一次调用都计数**。 */
const PLAYBACK_STATE = new WeakMap();
function makePlaybackRef(obj) {
  const st = (v) => { if (obj) { try { PLAYBACK_STATE.set(obj, v) } catch { /* ignore */ } } };
  return {
    play() { apiBump('play'); st(true); },
    pause() { apiBump('pause'); st(false); },
    stop() { apiBump('stop'); st(false); },
    isPlaying() { apiBump('isPlaying'); try { return obj ? !!PLAYBACK_STATE.get(obj) : false } catch { return false } },
    // ①(P-141) `IParticleSystem.emitParticles(count?)`：官方"立即发射 count 个粒子，无视播放状态"。
    //   本机沙箱没有粒子发射注入点（渲染器的粒子子系统在 core/，本批不动）⇒ **no-op + 计数**，
    //   把请求量记在对象上（`__psEmitRequest`）以便日后接线与日志核对，不抛错、不静默。
    emitParticles(count) {
      apiBump('emitParticles');
      const n = Math.max(0, Math.trunc(Number(count)) || 1);
      if (obj) { try { obj.__psEmitRequest = (obj.__psEmitRequest | 0) + n } catch { /* ignore */ } }
    },
  };
}

/* ①(P-141) `IParticleSystemInstance`（d.ts L874-952）：字段是**层上 `instanceoverride` 的同名量**。
 *   语料（0917/3448877775 与两份夜莺包）用 `getParticleSystem().rate = …` 调速 ⇒ 这里把字段
 *   **写穿到 `obj.instanceoverride`**：渲染器（core/we-scene-bundle.js:1530/2270/3410）正是从同一个
 *   对象解析 `rate/count/size/…`（`resolveParticleOverride` 认裸数字）⇒ 这不是记账，是**真生效**。 */
const PARTICLE_INSTANCE_KEYS = ['alpha', 'size', 'count', 'speed', 'lifetime', 'rate', 'colorn',
  'controlpoint0', 'controlpoint1', 'controlpoint2', 'controlpoint3',
  'controlpoint4', 'controlpoint5', 'controlpoint6', 'controlpoint7'];
const PARTICLE_REF_OF = new WeakMap();
function particleInstanceOf(obj) {
  const box = obj || {};                       // 空层引用 ⇒ 挂在临时对象上（读写都不抛错）
  const fill = (o) => { for (const k of PARTICLE_INSTANCE_KEYS) if (!(k in o)) o[k] = undefined; return o };
  /* ①(P-174) `obj == null` 必须先短路：下面两处都直接读 `obj.instanceoverride`/`obj.particle`。
   *   旧代码靠"空引用这条路没人读过 `instance`"侥幸不炸 —— 本批把 F3（`layerRefFor`）打通后，
   *   `Object.assign(Object.create(null), emptyLayerRef(), {…})` 会**遍历读取** emptyLayerRef 的所有
   *   访问器（含 `get instance`）⇒ 立刻 `Cannot read properties of null (reading 'instanceoverride')`
   *   （实测：真包 getParent 链上第一次进入 F3 就抛，update 直接失败）。 */
  if (!obj || !obj.instanceoverride || typeof obj.instanceoverride !== 'object') {
    // 只有**真的是粒子层**（有 particle 字段）才新建 instanceoverride：往非粒子层上凭空造一个
    // 会让渲染器的 resolveParticleOverride 多出一组"全 1 覆写"，是不必要的副作用。
    if (obj && obj.particle) { const io = fill({}); obj.instanceoverride = io }
    else { let side = PARTICLE_REF_OF.get(box); if (!side) { side = fill({}); PARTICLE_REF_OF.set(box, side) } return side }
  }
  // 官方 `IParticleSystemInstance` 的 15 个字段在实例上**都存在**（缺的置 undefined）。
  //   ⚠ 对渲染器零影响：`resolveParticleOverride` 的 num/vec 对 undefined 与"键不存在"同结果
  //   （num 走默认值、vec 返回 null），而 `JSON.stringify` 会丢掉 undefined ⇒ 序列化形状不变。
  return fill(obj.instanceoverride);
}
function makeParticleSystemRef(obj) {
  const inst = particleInstanceOf(obj);
  const ref = Object.assign(makePlaybackRef(obj), {});
  const spec = {
    // 官方 `IParticleSystem.instance`：**同一个**字段表（每次访问同一对象 ⇒ 改一处不会分叉）
    instance: { get: () => inst, set: () => { /* 官方只读引用：静默丢弃 */ } },
    // ①(P-141) 语料把官方 `instance.rate` 写成 `getParticleSystem().rate`（官方 IParticleSystem 上
    //   **没有** rate）⇒ 手柄上做**转发**（读/写都落到 inst.rate），不是第二份状态。
    rate: {
      get: () => (Number(nodeRaw(inst.rate)) || 0),
      set: (v) => { inst.rate = Number(v) || 0; apiBump('particleInstanceWrite') },
    },
  };
  for (const k of PARTICLE_INSTANCE_KEYS) {
    if (k === 'rate') continue;
    spec[k] = {
      get: () => nodeRaw(inst[k]),
      set: (v) => { inst[k] = v; apiBump('particleInstanceWrite') },
    };
  }
  return defineAccessors(ref, spec);
}
/** 稳定句柄：同一层的 `getParticleSystem()` 永远返回同一对象（作者在 init 里缓存它）。 */
function particleRefFor(obj) {
  const key = obj || {};
  let r = PARTICLE_REF_OF.get(key);
  if (!r || !obj) r = makeParticleSystemRef(obj);
  if (obj) PARTICLE_REF_OF.set(key, r);
  return r;
}

/* ①(P-141) `IAnimation`（d.ts L1568-1623）。
 *   官方四个 `readonly` 字段（fps/frameCount/duration/name）给 getter + 静默 setter（口径 ①）。
 *   状态同样**不写进 scene.json**：本机渲染器没有时间轴动画播放器（精灵表帧由 core 按 `time`
 *   推进），所以 `play/pause/stop/setFrame/getFrame` 是脚本可见的状态机 + 计数，**不改渲染**。
 *   `rate` 可写（官方非 readonly），记进状态并计数。
 *   返回值**永远是真值句柄**（官方在"该层没有该动画"时返回 undefined；我们无从判断作者的绑定，
 *   给句柄能让作者脚本的 `animation.rate = …` 有着落，并且是可观测的记账而不是静默丢弃）。
 *
 * ②(P-228l 2026-10-05) **上面那段"不改渲染"的边界被本条收窄**：宿主现在把解析期建好的属性动画
 *   控制器注册进来（`setAnimationResolver`），`getAnimation()` 命中**真控制器**时返回的是真句柄 ——
 *   `play()/pause()/stop()/setFrame()/rate` 直接驱动 `core/we-animation.mjs` 的播放头，渲染逐帧
 *   按它求值（语料 21 包 / 172 处调用，其中 162 处无参；`mediaThumbnailChanged(){ thisObject.
 *   getAnimation().play() }` 是主要用法 ⇒ 媒体事件 → play() → 动画真的走起来）。
 *   没有真控制器（层无属性动画 / owner 未解析 / 场景级与效果常量作用域尚未接线）⇒ 仍然给中性桩，
 *   行为与改动前逐位相同（只多两个可观测计数 animationReal/animationStub）。 */
const ANIM_STATE = new WeakMap();
const ANIM_NULL_KEY = {};
function animStateOf(obj) {
  const key = obj || ANIM_NULL_KEY;
  let s = ANIM_STATE.get(key);
  if (!s) { s = { frame: 0, rate: 1, playing: false, name: '' }; ANIM_STATE.set(key, s); }
  return s;
}
/** ②(P-228l) 宿主注入的"真控制器"解析器：`(rawObj) => {field: ctrl} | null`。缺省 null（= 旧行为）。 */
let ANIM_RESOLVER = null;
export function setAnimationResolver(fn) { ANIM_RESOLVER = typeof fn === 'function' ? fn : null; return !!ANIM_RESOLVER; }
/** ②(P-228l) 真句柄的稳定身份：同一个控制器每次 `getAnimation()` 返回**同一对象**（作者会缓存它）。 */
const ANIM_REF_OF = new WeakMap();
/** 无参 `getAnimation()` 取哪一条：**载体优先级**（语料最常见的媒体/图标动画都是 alpha；
 *  origin/scale 次之）。命名查找优先精确匹配 `options.name`（语料 10 处命名调用）。 */
const ANIM_FIELD_PRIORITY = ['alpha', 'origin', 'scale', 'angles', 'visible'];
function pickAnimationCtrl(ctrls, name) {
  if (!ctrls) return null;
  const fields = ANIM_FIELD_PRIORITY.filter((f) => ctrls[f]);
  if (typeof name === 'string' && name) {
    for (const f of fields) if (ctrls[f] && ctrls[f].name === name) return ctrls[f];
    for (const f of fields) if (ctrls[f] && ctrls[f].name && ctrls[f].name.indexOf(name) >= 0) return ctrls[f];
    return null;
  }
  return fields.length ? ctrls[fields[0]] : null;
}
/** ②(P-228l) 真 `IAnimation` 句柄（包住 `core/we-animation.mjs` 的控制器）。 */
function makeRealAnimationRef(ctrl) {
  const cached = ANIM_REF_OF.get(ctrl);
  if (cached) return cached;
  const ref = animRefShared(null);
  defineAccessors(ref, {
    fps: { get: () => ctrl.fps, set: () => { /* readonly ⇒ 静默丢弃 */ } },
    frameCount: { get: () => ctrl.frameCount, set: () => { /* readonly */ } },
    duration: { get: () => ctrl.duration, set: () => { /* readonly */ } },
    name: { get: () => ctrl.name, set: () => { /* readonly */ } },
    // ②(P-228l) `rate` 与 `playing` 在官方也是可写访问器（`playing` 来自 d.ts 的 `isPlaying()` 家族；
    //   语料直接写 `ani.rate = 2`）⇒ 走真控制器，不落第二份状态。
    rate: { get: () => ctrl.rate, set: (v) => { ctrl.setRate(v); apiBump('animationWrite') } },
    playing: { get: () => ctrl.isPlaying(), set: (v) => { if (v) ctrl.play(); else ctrl.pause(); apiBump('animationWrite') } },
  });
  Object.assign(ref, {
    play() { ctrl.play(); apiBump('animationWrite') },
    pause() { ctrl.pause(); apiBump('animationWrite') },
    stop() { ctrl.stop(); apiBump('animationWrite') },
    isPlaying() { return ctrl.isPlaying() },
    getFrame() { return ctrl.getFrame() },
    setFrame(f) { ctrl.setFrame(f); apiBump('animationWrite') },
    setRate(r) { ctrl.setRate(r); apiBump('animationWrite') },
    addEndedCallback(fn) { ctrl.addEndedCallback(() => { apiBump('animationEnded'); try { fn() } catch (e) { /* 作者回调抛错不拖垮渲染 */ } }); },
  });
  ANIM_REF_OF.set(ctrl, ref);
  return ref;
}
function makeAnimationRef(obj, name) {
  // ②(P-228l) 先试真控制器（宿主注册的解析器 + 该层的属性动画表）
  try {
    const ctrls = ANIM_RESOLVER && obj ? ANIM_RESOLVER(obj) : null;
    const ctrl = pickAnimationCtrl(ctrls, name);
    if (ctrl) { apiBump('animationReal'); return makeRealAnimationRef(ctrl); }
  } catch (e) { /* 解析器异常 → 回落到中性桩 */ }
  apiBump('animationStub');
  const s = animStateOf(obj);
  if (typeof name === 'string' && name) s.name = name;
  const ref = animRefShared(obj);
  // ── 官方 readonly 四个：**只写 getter + 静默丢弃的 setter**（口径 ①，理由见上方长注释）──
  defineAccessors(ref, {
    fps: { get: () => 0, set: () => { /* readonly ⇒ 静默丢弃 */ } },
    frameCount: { get: () => 0, set: () => { /* readonly */ } },
    duration: { get: () => 0, set: () => { /* readonly */ } },
    name: { get: () => s.name, set: () => { /* readonly */ } },
    rate: { get: () => s.rate, set: (v) => { s.rate = Number(v) || 0; apiBump('animationWrite') } },
  });
  Object.assign(ref, {
    play() { s.playing = true; apiBump('animationWrite') },
    pause() { s.playing = false; apiBump('animationWrite') },
    stop() { s.playing = false; s.frame = 0; apiBump('animationWrite') },
    isPlaying() { return !!s.playing },
    getFrame() { return s.frame },
    setFrame(f) { s.frame = Math.max(0, Math.trunc(Number(f)) || 0); apiBump('animationWrite') },
  });
  return ref;
}

/* ①(P-141) `engine.setInterval/clearInterval`（d.ts L1519；官方文档 "Starts a repeating interval
 *   callback in milliseconds"）。
 *   驱动点 = `applySceneScripts` 的**每一帧**，时间基准 = 传进来的场景时钟 `time`（秒，
 *   = `engine.runtime` 的同一条时间轴）—— 这样定时器精度与"脚本节拍分层"无关（demo 的
 *   慢档是 4Hz、快档 30Hz；若按调用次数累加 frametime 会少算 ~15 倍）。
 *   回调在**注册它的那次编译上下文**里跑，并且先 `ownerRef.setOwner(注册时的对象)` 再调用 ⇒
 *   回调里的 `thisLayer/thisObject` 仍指向作者那一层（官方"每个脚本实例一个定时器"的等价物）。
 *   返回值 = "stop 函数"（官方：返回一个新的回调，可用于停止；wer-ref 同款带 `__timerId`）。 */
const ENGINE_TIMERS = new WeakMap();
function engineTimerTable(engine) {
  let t = ENGINE_TIMERS.get(engine);
  if (!t) { t = { seq: 0, timers: new Map(), lastClock: null }; ENGINE_TIMERS.set(engine, t); }
  return t;
}
/** 每帧推进某个脚本上下文的定时器。`clockSec` = 场景时钟（秒，可 undefined）；`fallbackDt` = 帧秒数。 */
function pumpEngineTimers(engine, clockSec, fallbackDt) {
  const t = engine && ENGINE_TIMERS.get(engine);
  if (!t || !t.timers.size) return 0;
  let dtMs;
  if (Number.isFinite(clockSec)) {
    if (t.lastClock === null) { t.lastClock = clockSec; return 0 }   // 首次只对表，不给"补发"
    dtMs = (clockSec - t.lastClock) * 1000;
    t.lastClock = clockSec;
  } else {
    dtMs = (Number(fallbackDt) || 0) * 1000;
  }
  if (!Number.isFinite(dtMs) || dtMs <= 0) return 0;
  dtMs = Math.min(dtMs, 5000);            // 单帧最多补 5s（标签页挂起回来不雪崩）
  let fired = 0;
  for (const rec of [...t.timers.values()]) {
    rec.accum += dtMs;
    const delay = rec.delayMs > 0 ? rec.delayMs : 0;
    // delay ≤ 0：官方默认值 ⇒ 每帧一次（不 while 循环，避免 0 延迟把一帧撑爆）
    const times = delay > 0 ? Math.min(64, Math.floor(rec.accum / delay)) : 1;
    if (delay > 0) rec.accum -= times * delay; else rec.accum = 0;
    for (let i = 0; i < times; i++) {
      if (!t.timers.has(rec.id)) break;      // 回调里把自己清了
      try {
        if (rec.ownerRef && rec.ownerRef.setOwner) rec.ownerRef.setOwner(rec.owner || null);
        rec.cb();
        fired++; apiBump('timerFired');
      } catch { /* 官方容错：定时器回调失败不拖垮宿主（与 scene.on('update') 同一条口径） */ }
    }
  }
  return fired;
}
function clearEngineTimer(engine, handle) {
  const t = engine && ENGINE_TIMERS.get(engine);
  if (!t) return false;
  if (handle === undefined || handle === null) return false;
  if (typeof handle === 'function') {
    // 官方"用返回的函数清除"；兼容 `clearInterval(stopFn)` 与 wer-ref 的 id 归一化
    const id = handle.__timerId;
    if (handle.__mpwInterval && id !== undefined) { const had = t.timers.delete(id); if (had) apiBump('timerCleared'); return had }
    try { handle(); apiBump('timerCleared'); return true } catch { return false }
  }
  const had = t.timers.delete(Number(handle));
  if (had) apiBump('timerCleared');
  return had;
}

export function makeSceneRef(objects, hooks) {
  const hk = hooks || {};
  /* ①(P-232 2026-10-04) 当前帧时间（`applySceneScripts(scene, time)` 每帧刷新）：`getCameraTransforms`
   *   的 zoom 要返回**当前生效值**（官方语义 "current"——含 `general.zoom` 动画的本帧求值），
   *   没有时间就退回静态值。 */
  const frameTimeRef = hk.frameTimeRef || { current: null };
  const rawVal = (v) => (v && typeof v === 'object' && 'value' in v ? v.value : v);
  const parseV = (s, def) => {
    const v = rawVal(s);
    const p = String(v == null ? '' : v).trim().split(/\s+/).map(Number);
    return new Vec3(p[0] ?? def[0], p[1] ?? def[1], p[2] ?? def[2]);
  };
  /* ①(P-174) F1 = `thisScene.getLayer/…` 的层引用：字面量 + 末尾一次 `defineAccessors` 挂上六个
   *   五面共用的值成员（angles/color/parallaxDepth/alignment/alpha/volume —— 原来这一份是五份字面量
   *   里最全的，本批起改成**同一对 get/set 函数对象**，见 LAYER_REF_MEMBER_ACCESSORS 上方长注释）。 */
  const layer = (obj) => defineAccessors(bindLayerFace({
    // ①(2026-09-12) thisScene.getLayer(name) / enumerateLayers() 返回的层引用必须与 thisLayer 同一套 API
    //   （上报：`thisScene.getLayer(...).getTextureAnimation is not a function`）。
    getTextureAnimation: () => texAnimRefShared(obj),
    getVideoTexture: () => videoTexRefShared(obj),
    getTransformMatrix: () => transformMatrixShared(obj),
    getParent: () => {
      const p = obj && obj.parent !== undefined && obj.parent !== null ? objList.find((x) => x && x.id === obj.parent) : null
      return p ? layer(p) : layer({ name: '', origin: '0 0 0', scale: '1 1 1', size: '0 0 0', visible: true, id: -1 })
    },
    get visible() { return obj.visible !== false; },
    // ③(P-228l) 与 `layerRefFor()` 那条同口径记账（`getLayer()` 走的是本构造 ⇒ 只接一条会漏）
    // ①②(P-237 2026-10-06) 写回**不破坏节点**（与 origin/scale 的 nodeWrite 同口径）：作者的
    //   `visible` 常是 `{script,value}` 节点，整只替换会让该脚本永久停摆（P-143 的同类缺陷，
    //   本包 ldfl/设置族的 visible 都是脚本节点）。
    set visible(v) { nodeWrite(obj, 'visible', !!v); propWriteNote(obj, 'visible', !!v) },
    get size() { return parseV(obj.size, [0, 0, 0]); },
    set size(v) { /* 官方 IEffectLayer.size readonly：与 thisLayer 同一口径（P-137），静默丢弃不抛错 */ },
    get scale() { return parseV(obj.scale, [1, 1, 1]); },
    // ①(P-141) 官方 `ILayer.scale: Vec3`（d.ts L1146-1150）。**原来这里只有 getter** ⇒ 在
    //   `thisScene.createLayer()` 返回的层上写 `bar.scale = new Vec3(...)`（洛茜_07/11 的音频条、
    //   0917/3509243656 的轨迹点）既不报错也不生效（本机沙箱剥掉顶层 'use strict' ⇒ 访问器无 setter
    //   时赋值在非严格模式下静默失败；若是严格模式则会抛，两种都不可接受）⇒ 补**写穿** setter。
    set scale(v) { const p = toXYZShared(v); if (p) nodeWrite(obj, 'scale', `${p[0].toFixed(6)} ${p[1].toFixed(6)} ${p[2].toFixed(6)}`) },
    get origin() { return parseV(obj.origin, [0, 0, 0]); },
    set origin(v) {
      if (v == null) return;
      const x = v.x != null ? v.x : v[0];
      const y = v.y != null ? v.y : v[1];
      const z = v.z != null ? v.z : v[2];
      obj.origin = `${Number(x).toFixed(6)} ${Number(y).toFixed(6)} ${Number(z).toFixed(6)}`;
    },
    // ①(P-141) 官方 `ILayer.angles: Vec3`（d.ts L1148）/ `ILayer.parallaxDepth: Vec2`（L1158）/
    //   `IImageLayer.alpha: Number`（L995）/ `IImageLayer.color: Vec3`（L1000）/
    //   `IImageLayer.alignment: String`（L1005）/ `ISoundLayer.volume: Number`（L768）。
    //   这六项是语料在新**建层**上真正会写的（洛茜_11 写 origin/angles/alpha/color/parallaxDepth；
    //   3509243656 写 color/alpha/scale/visible；2887099508 写 `getLayer('桥')['volume']`）
    //   ⇒ 缺了就是"新建层只能看不能动"。
    //   ⚠ ①(P-174) 这六项**不再在这里写第六份字面量**：统一由模块级的
    //   `LAYER_REF_MEMBER_ACCESSORS` 提供（同一对 get/set 函数对象挂到五个面 ⇒ "五面同源"可自证），
    //   在下面的 `defineAccessors(...)` 里一次性挂上。读写语义与缺省见该常量上方的长注释。
    get name() { return obj.name || ''; },
    get id() { return obj.id; },
    // ①(P-141) 官方 `ILayer extends … ISoundLayer, … IParticleSystem`（d.ts L1139）⇒ 同一个层引用上
    //   就有这批方法。语料 0917/3600630828 的 `thisScene.getLayer('bloom').stop()/play()` 就落在这里
    //   （长注释见文件上方 P-141 块）。`stop` 之前不存在 ⇒ init 抛 "audioLayer.stop is not a function"。
    ...makePlaybackRef(obj),
    // ①(P-141) 官方 `IObject.getAnimation(name?: String): IAnimation`（d.ts L494-499）
    getAnimation: (name) => { apiBump('getAnimation'); return makeAnimationRef(obj, name) },
    /* ①(P-142) 官方 `IImageLayer.getAnimationLayer(name: String|Number): IAnimationLayer`
     *   （d.ts L1022-1025；`IModelLayer` 同款 L1096-1101）—— `thisLayer` 那一半（makeOwnerRef 的
     *   layerRef）早就有，缺的是**本工厂**这一半 ⇒ 真包 `0923/2887099508` 的混淆脚本
     *   `thisScene.getLayer('front leg').getAnimationLayer('神腿').setFrame(29)` 抛
     *   `thisScene[..](...).getAnimationLayer is not a function`（init 失败、实例被永久禁用）。
     *   返回与 `thisLayer.getAnimationLayer()` **同一份** `animRefShared`（no-op 面 + 计数）：
     *   本机渲染器没有可寻址的骨骼动画播放器，句柄让作者的 setFrame/play 有落点且不抛错。
     *   依据强度：高（官方签名 + 真包调用点 + 同文件 thisLayer 那一半的既有实现）。 */
    getAnimationLayer: (name) => { apiBump('getAnimationLayer'); return animRefShared(obj) },
    // ①(P-142) 伴生计数（见模块级 animLayerCountOf 注释）：与上面返回的句柄同一个数
    getAnimationLayerCount: () => animLayerCountOf(obj),
    // ①(P-142) 官方 `ITextLayer.text`（见上方 textOf/writeText 注释）：与 thisLayer 同一套读写面。
    get text() { return textOf(obj) },
    set text(v) { writeText(obj, v) },
    /* ①(P-143) `ITextLayer` 的四个值成员 + `IEffectLayer.getEffect/getEffectCount`（IEffectLayer 同属
     *   ILayer，d.ts L1139）+ `originalOrigin` + `debug` —— 见文件上方 P-143 长注释。
     *   ⚠ `thisScene.getLayer(name)` 返回的层引用与 `thisLayer` 是**同一个 ILayer 概念**（P-137 的教训：
     *   不能两套属性面），所以这一份必须与 makeOwnerRef 的 layerRef/objectRef 逐位同源。 */
    get pointsize() { return pointsizeOf(obj) },
    set pointsize(v) { textLayerWrite(obj, 'pointsize', v) },
    get font() { return fontOf(obj) },
    set font(v) { textLayerWrite(obj, 'font', v) },
    get horizontalalign() { return alignOf(obj, 'horizontalalign') },
    set horizontalalign(v) { textLayerWrite(obj, 'horizontalalign', v) },
    get verticalalign() { return alignOf(obj, 'verticalalign') },
    set verticalalign(v) { textLayerWrite(obj, 'verticalalign', v) },
    get originalOrigin() { return authoredOriginOf(obj) },
    set originalOrigin(v) { /* 官方无此写入口（wer-ref 同款只读虚拟成员）⇒ 静默丢弃不抛错 */ },
    getEffect: (name) => effectRefFor(obj, name),
    getEffectCount: () => effectCountOf(obj),
    get debug() { return debugFlagOf(obj) },
    set debug(v) { writeDebugFlag(obj, v) },
    // ①(P-141) 语料写法（官方无此成员；官方模型里"本层的粒子系统"就是本层自己）⇒ 返回 IParticleSystem 视图
    getParticleSystem: () => { apiBump('getParticleSystem'); return particleRefFor(obj) },
    get instance() { return particleInstanceOf(obj) },
    clicked: false,
    cursorDetected: false,
  }, () => obj), LAYER_REF_MEMBER_ACCESSORS);
  const objList = Array.isArray(objects) ? objects : [];
  /* ①(P-143) `originalOrigin` 的 authored 快照：本工厂在 `applySceneScripts` 里是在三趟之前建的，
   *   所以在这里抓一次就等价于"任何脚本跑之前"（幂等：先到先得，后续调用不覆盖）。 */
  snapshotAuthoredOrigins(objList);
  // ①(P-141) 层引用 → 场景对象身份表（`getLayerIndex(thisLayer)` 靠它解析；见文件上方 P-141 块）
  const asLayer = (obj) => bindLayerObject(layer(obj), obj);
  const emptyLayer = (name) => asLayer({ name: name || '', origin: '0 0 0', scale: '1 1 1', size: '0 0 0', visible: true, id: -1 });
  // ①(P-141) `IScene.createLayer` 的上限：作者在 0917/3509243656 的脚本注释里自己写明
  //   "WE有最大2048图层限制"；我们照同一个数封顶，超过后**仍然返回可用层引用**（属性齐全、
  //   写入不抛错），只是不再进入 objList/`enumerateLayers()`，并计入 `createLayerReused`（可观测）。
  const MAX_DYNAMIC_LAYERS = 2048;
  let dynSeq = 0;
  /* ①(P-142 2026-09-23) `destroyLayer` 的两个零件（成员本体见下方 api.destroyLayer）：
   *   · `resolveLayerArg`：解析口径与既有的 sortLayer / getLayerIndex / getInitialLayerConfig **逐字
   *     相同**（字符串 = 层名、数字 = 层表下标、对象 = 层引用；`thisLayer` 那个 owner 层引用靠
   *     hooks 还原成场景对象）。这里抽成一处只给 destroyLayer 用，既有三个成员维持原状不动。
   *   · `destroyQueue`：官方是**延迟删除**（"removed after all scripts on that frame updated"）⇒
   *     先入队，`applySceneScripts` 在本帧两趟跑完后调 `__flushDestroyedLayers()` 真摘。
   *     注：本工厂**每次 applySceneScripts 新建一个**（`opts.thisScene` 没给时）⇒ 队列只在
   *     "一次调用"内有意义，而官方要的"这一帧内"正好就是这个窗口。 */
  const resolveLayerArg = (layerOrName) => {
    if (typeof layerOrName === 'string') return objList.find((x) => x && x.name === layerOrName) || null;
    if (typeof layerOrName === 'number') return objList[Math.trunc(layerOrName)] || null;
    if (layerOrName && typeof layerOrName === 'object') {
      const o = layerObjectOf(layerOrName);
      if (o) return o;
      if (typeof hk.ownerLayerRef === 'function' && layerOrName === hk.ownerLayerRef()) {
        return (typeof hk.ownerObj === 'function' ? hk.ownerObj() : null) || null;
      }
    }
    return null;
  };
  const destroyQueue = [];
  const api = {
    // ①(2026-09-12) 上报错误 "thisScene.enumerateLayers is not a function"（3544152633 的 Clock/
    //   $mediaThumbnail/playerplay 都用它遍历层找 player/媒体层）→ 返回全部层引用。
    enumerateLayers: () => objList.map((o) => asLayer(o)),
    /* ①(P-220 C1 2026-09-29 · RE-57) `element.addText(spec)`（语料 223 次，高频）：官方语义 = 向场景
     *   **动态添加文本元素**（返回层引用）。本仓动态层不上屏（P-141 的既有限制：渲染器对象表载入期
     *   烘焙）⇒ 走 createLayer 同一条管线：把 spec 归一成文本层对象（`text`/`pointsize`/`font`/…）
     *   写进 objList（getLayer/enumerateLayers 可见、属性可读写），渲染端行为与 createLayer 一致。
     *   spec 三形态：字符串（=text 内容）、{text,…}、{value,…}。返回层引用（同一套 layer() 面）。 */
    addText: function (spec) {
      apiBump('addText');
      const cfg = (spec && typeof spec === 'object') ? { ...spec } : { text: String(spec == null ? '' : spec) };
      if (cfg.value !== undefined && cfg.text === undefined) cfg.text = String(cfg.value);
      if (cfg.text === undefined) cfg.text = '';
      cfg.text = String(cfg.text);
      // this = api（本对象）：createLayer 是同字面量方法（解构/转交场景下 this 可能丢 ⇒ 兜底走 api）
      const impl = (this && typeof this.createLayer === 'function') ? this.createLayer : (typeof api !== 'undefined' && api && api.createLayer)
      return impl.call(this, cfg);
    },
    getLayer: (name) => {
      const obj = objList.find((o) => o && o.name === name);
      return obj ? asLayer(obj) : emptyLayer(name);
    },
    getSceneObject: (id) => {
      const obj = objList.find((o) => o && o.id === id);
      return obj ? asLayer(obj) : null;
    },
    /* ①(P-141) `IScene.getLayerIndex(layer: String|ILayer): Number`（d.ts L1288）。
     *   语料（洛茜_07 objects[13] / 洛茜_11 objects[21]）传的是 **`thisLayer`**，也就是
     *   `makeOwnerRef().makeLayer()` 造的那个层引用 —— 它不在 `layer()` 的身份表里，所以还要认
     *   `hooks.ownerLayerRef()/ownerObj()` 这条缝（`applySceneScripts` 把当前 ownerRef 交进来）。
     *   解析不到 ⇒ 返回 **-1**（官方返回 Number；不抛错，并计入 `getLayerIndexUnresolved`）。 */
    getLayerIndex: (layerOrName) => {
      const idxOf = (o) => {
        const i = o ? objList.indexOf(o) : -1;
        if (i >= 0) apiBump('getLayerIndex'); else apiBump('getLayerIndexUnresolved');
        return i;
      };
      if (typeof layerOrName === 'string') return idxOf(objList.find((o) => o && o.name === layerOrName) || null);
      if (typeof layerOrName === 'number') return idxOf(objList[Math.trunc(layerOrName)] || null);
      if (layerOrName && typeof layerOrName === 'object') {
        let o = layerObjectOf(layerOrName);
        if (!o && typeof hk.ownerLayerRef === 'function' && layerOrName === hk.ownerLayerRef()) {
          o = (typeof hk.ownerObj === 'function' ? hk.ownerObj() : null) || null;
        }
        return idxOf(o);
      }
      return idxOf(null);
    },
    /* ①(P-141) `IScene.createLayer(configuration: String|Object|IAssetHandle): ILayer`（d.ts L1278）。
     *   官方文档（docs.wallpaperengine.io/en/scene/scenescript/reference/class/IScene.html）：
     *   "Creates a new layer … Make sure to register the required asset in IEngine or it won't be pushed
     *    to Workshop when publishing"，并明确 configuration 可以是 `engine.registerAsset(file)` 的返回值。
     *   语料两种形态都出现：对象字面量（0917/3509243656 的轨迹点，字段 castshadow/image/origin/color/
     *     alpha/scale/visible）与字符串（洛茜_07/11 的 `'models/bar.json'`）。
     *   字符串形态的归属按 WE 工程目录约定推断（行为对照 wer-ref 的 `normalizeCreateLayerConfig`：
     *     particles/ → 粒子层、models/ → 模型/图片层）：`particles/*.json` → `{particle}`，
     *     其余 `models/*.json` → `{image}`（语料里两个字符串都是内置图片模型）。
     *   返回的层引用是**同一套** `layer()` 面（P-137 的教训：同一个 ILayer 概念不能有两套属性面），
     *   并且写进 `objList` ⇒ `enumerateLayers()/getLayer()/getLayerIndex()` 都能看到它。
     *   ⚠ 已知限制（写在 PATCHES P-141 未证实项）：渲染器的对象表是**场景载入时烘焙**的
     *     （`core/we-scene-bundle.js` 的 `scene.layers`），本批不动 core/ ⇒ 动态层不会上屏。 */
    createLayer: (configuration) => {
      let cfg = configuration;
      if (typeof cfg === 'string') {
        const f = cfg;
        cfg = /^particles\//i.test(f) ? { particle: f } : { image: f };
      } else if (cfg && typeof cfg === 'object' && !Array.isArray(cfg) && typeof cfg.file === 'string') {
        cfg = /^particles\//i.test(cfg.file) ? { particle: cfg.file } : { image: cfg.file };   // IAssetHandle
      }
      if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) cfg = {};
      const src = Object.assign({}, cfg);
      if (src.origin && typeof src.origin === 'object') src.origin = String(nodeRaw(src.origin));
      if (src.scale && typeof src.scale === 'object') src.scale = String(nodeRaw(src.scale));
      if (src.color && typeof src.color === 'object') src.color = String(nodeRaw(src.color));
      const top = objList.length ? Math.max(...objList.map((o) => (o && Number(o.id)) || 0)) : 0;
      // ①(P-141) 先铺 WE 的**层默认值**再套作者配置：WE 新建层的 origin/scale/angles 是 0/1/0，
      //   缺字段时本文件的 parseV 会给出 0（`Number('')===0` 不是 nullish ⇒ 默认值不生效）——
      //   作者脚本紧跟的 `bar.scale.x` 就会读到 0 而不是 1（乘出来全 0）。铺默认值比改共享 parseV
      //   的默认语义安全（后者会影响 15 个包既有的 thisScene.getLayer 读数）。
      const obj = Object.assign({
        origin: '0.000000 0.000000 0.000000',
        scale: '1.000000 1.000000 1.000000',
        angles: '0.000000 0.000000 0.000000',
        alpha: 1,
        visible: true,
      }, src, { id: top + (++dynSeq), name: src.name || ('__mpw_dyn_' + dynSeq) });
      obj.__dynamic = true;                       // 记号：宿主/诊断可区分"脚本新建的层"
      // ①(P-143) 新层的 `originalOrigin` **就是它被创建时的 origin**（wer-ref 的等价物是"载入时
      //   的初始层配置"）。必须在这里抓：作者拿到句柄后往往立刻写 origin（洛茜_07/11 的音频条、
      //   0917/3509243656 的轨迹点），下一帧由 applySceneScripts 统一抓时已经不是 authored 值了。
      noteAuthoredOrigin(obj);
      if (objList.length < MAX_DYNAMIC_LAYERS) { objList.push(obj); apiBump('createLayer'); return asLayer(obj) }
      apiBump('createLayerReused');
      return layer(obj);                          // 超上限：仍给属性齐全的层引用，只是不进场景表
    },
    /* ①(P-141) `IScene.sortLayer(layer: String|Number|ILayer, index: Number): Boolean`（d.ts L1282）。
     *   洛茜_07/11 在 createLayer 之后紧接着 `thisScene.sortLayer(bar, thisIndex)`（官方文档注释：
     *   "Sort layer differently by inserting it at a new index"）—— `getLayerIndex` 修好后这条会**立刻**
     *   变成下一个 "is not a function"（链式暴露），所以同批实现：真在 objList 里搬位置并计数，
     *   解析不到层返回 false（官方 Boolean，不抛错）。 */
    sortLayer: (layerOrName, index) => {
      const want = Math.trunc(Number(index));
      if (!isFinite(want)) return false;
      let o = null;
      if (typeof layerOrName === 'string') o = objList.find((x) => x && x.name === layerOrName) || null;
      else if (typeof layerOrName === 'number') o = objList[Math.trunc(layerOrName)] || null;
      else if (layerOrName && typeof layerOrName === 'object') {
        o = layerObjectOf(layerOrName);
        if (!o && typeof hk.ownerLayerRef === 'function' && layerOrName === hk.ownerLayerRef()) o = (typeof hk.ownerObj === 'function' ? hk.ownerObj() : null) || null;
      }
      const from = o ? objList.indexOf(o) : -1;
      if (from < 0) return false;
      const to = Math.max(0, Math.min(objList.length - 1, want));
      if (to !== from) { objList.splice(from, 1); objList.splice(to, 0, o); }
      apiBump('sortLayer');
      return true;
    },
    /* ①(P-141) `IScene.getInitialLayerConfig(layer: String|Number|ILayer): Object`（d.ts L1292）。
     *   语料 dd/3544152633 的 `thisScene.createLayer(thisScene.getInitialLayerConfig(origbar))` 是
     *   "复制一个已有层"的官方写法；返回该层的**参数快照**（脚本节点只取当前 value），
     *   找不到 ⇒ 返回 null（官方 Object；不抛错）。 */
    getInitialLayerConfig: (layerOrName) => {
      let o = null;
      if (typeof layerOrName === 'string') o = objList.find((x) => x && x.name === layerOrName) || null;
      else if (typeof layerOrName === 'number') o = objList[Math.trunc(layerOrName)] || null;
      else if (layerOrName && typeof layerOrName === 'object') {
        o = layerObjectOf(layerOrName);
        if (!o && typeof hk.ownerLayerRef === 'function' && layerOrName === hk.ownerLayerRef()) o = (typeof hk.ownerObj === 'function' ? hk.ownerObj() : null) || null;
      }
      if (!o) return null;
      const out = {};
      for (const k of Object.keys(o)) {
        if (k === 'script' || k === 'value' || k.startsWith('__')) continue;
        const v = o[k];
        out[k] = (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v, (kk, vv) => (kk === 'script' ? undefined : vv))) : v;
      }
      return out;
    },
  };
  /* ①(P-142) `IScene.destroyLayer(layer: String|Number|ILayer): Boolean`（d.ts L1270-1272）。
   *   官方注释逐字："Remove a layer by name, index or object. **The layer is removed after all
   *   scripts on that frame updated.**" ⇒ 两段语义都实现：
   *     · 解析：名字 / 下标 / 层引用（含 `thisLayer`），解析不到 ⇒ 返回 **false**（官方 Boolean，
   *       不抛错）；重复请求同一层只入队一次。
   *     · 时机：**不在调用点摘层**，而是入队；由 `applySceneScripts` 在本帧 init+update 两趟都跑完
   *       之后调 `__flushDestroyedLayers()` 真从层表（= 宿主传进来的 `renderObjects` = `scene.objects`）
   *       里 splice 掉。提前摘会让同帧后续脚本的 `getLayerIndex`/`enumerateLayers` 看到位移后的下标。
   *   数字参数按**下标**解：d.ts 对 destroyLayer 列的是 "name, index or object"（而 getLayer 那一处
   *   写的是 "editor name, index or ID"）⇒ 不把数字另外当 ID 解，避免摘错层。
   *   语料：`0923/2887099508` 的混淆脚本 4+14 处（`thisScene.destroyLayer(0x0/0x1/0x2/0x5)` 拆 UI 层）。
   *   依据强度：高（官方 d.ts 逐字 + 语料调用点）。 */
  api.destroyLayer = (layerOrName) => {
    const o = resolveLayerArg(layerOrName);
    if (!o) { apiBump('destroyLayerUnresolved'); return false; }
    if (destroyQueue.indexOf(o) < 0) destroyQueue.push(o);
    apiBump('destroyLayer');
    return true;
  };
  /* ①(P-142) 官方 `IScene.getAnimation(name?: String): IAnimation`（d.ts L1305-1308 “Get an animation
   *   object by name from any layer”）—— 与 `getAnimationLayer` 同一条暴露链上的下一个缺口
   *   （真包 0923/2887099508 的 init：`thisScene.getAnimation(name).setFrame(29)`）。
   *   本机没有"按名字跨层查找动画实例"的表（动画层由 core 按对象解析），⇒ 返回 **IAnimation 句柄**
   *   （与 `thisLayer.getAnimation` 同一份实现；状态挂在"无对象"槽上）：作者脚本的 setFrame/rate
   *   有落点、不抛错，但**不改渲染**。
   *   依据强度：中 —— 官方签名与真包调用点是一手证据；返回值语义按"能读能写、不确定就不编造状态"补。 */
  api.getAnimation = (name) => { apiBump('getAnimation'); return makeAnimationRef(null, name) };
  /* ①(P-142 链式暴露) 官方 `IScene.getCameraTransforms(): CameraTransforms` / `setCameraTransforms(t): void`
   *   （d.ts L1290-1303；`class CameraTransforms { eye: Vec3; center: Vec3; up: Vec3; zoom: Number }`
   *   L243-250）。
   *   为什么本轮要补：`destroyLayer` 修好后，`0923/2887099508` 里**同一条链**上的下一个成员立刻暴露
   *   （`objects[52].visible` 的 update：`let ct = thisScene.getCameraTransforms(); ct.eye.subtract(...)`）
   *   —— 这正是前几轮"链式暴露"的同款形态。
   *   取值来源（**真值而非编造**）：scene.json 根上的 `camera`（`{center, eye, up}` 三个 "x y z" 串）
   *   与 `general.zoom` —— 就是这个真包的
   *   `"camera":{"center":"49.04232 -716.01788 -1.00000","eye":"…","up":"0 1 0"}`。
   *   走 `hooks.camera()`（applySceneScripts 把 `scene` 根交给它）；没有 root 时退回默认值
   *   （eye/center = 原点、up = +Y、zoom = 1，与官方 CameraTransforms 的中性值一致）。
   *   `setCameraTransforms` 按同一份字段**写回**（格式与 authored 相同 = "x y z" 六位小数串，
   *   `zoom` 写进 general）—— 官方那句注释就是 "Set current static scene camera transforms"，
   *   所以这是写穿而不是 no-op。
   *   依据强度：高（官方 d.ts 签名 + CameraTransforms 类型 + 真包 scene.json 的字段 `camera`/`general.zoom`）。 */
  const cameraRoot = () => (typeof hk.camera === 'function' ? hk.camera() : null);
  // 没有 scene.camera / scene.general 时的落点：**不往 scene.json 上凭空造键**（那会改变场景形状，
  // 而 `core/we-scene-bundle.js` 在烘焙时已经把 `sceneJson.camera || null` 抓走了）——读写都落在这里，
  // 于是"设了再读"自洽；场景本来就有 camera 时全部走真值对象（写穿 = 真改渲染器读的那份）。
  const camStore = {};
  const camNode = () => { const r = cameraRoot(); return (r && r.camera && typeof r.camera === 'object') ? r.camera : camStore; };
  const genNode = () => { const r = cameraRoot(); return (r && r.general && typeof r.general === 'object') ? r.general : camStore; };
  const v3of = (raw, def) => {
    const v = rawVal(raw);
    const p = String(v == null ? '' : v).trim().split(/\s+/).map(Number);
    return new Vec3(isFinite(p[0]) ? p[0] : def[0], isFinite(p[1]) ? p[1] : def[1], isFinite(p[2]) ? p[2] : def[2]);
  };
  const fmt3 = (v) => `${Number(v.x != null ? v.x : v[0] || 0).toFixed(6)} ${Number(v.y != null ? v.y : v[1] || 0).toFixed(6)} ${Number(v.z != null ? v.z : v[2] || 0).toFixed(6)}`;
  api.getCameraTransforms = () => {
    apiBump('getCameraTransforms');
    const cam = camNode();
    // ①(P-232 官方语义) zoom 返回**当前生效值**：`general.zoom` 是 {value,animation} 对象时取
    //   动画在本帧的求值（evalSceneZoom，mode:'single' 末帧后保持）；否则静态值。
    //   为什么要动画值：作者脚本的典型形态是 `ct = getCameraTransforms(); ct.eye…; setCameraTransforms(ct)`
    //   —— blind round-trip。官方管线里动画每帧重估、脚本写入是**帧内瞬态**，round-trip 等价 no-op；
    //   若这里返回静态 `.value`（rawVal 拍平），round-trip 会把动画对象写死成常数（真包
    //   0923/2887099508 实测：开场运镜 3→1 被定格成恒 3 倍镜 = "背景插画/云全不见了"的真根因）。
    const zRaw = genNode().zoom;
    let zoom = null;
    if (zRaw && typeof zRaw === 'object' && zRaw.animation) {
      try { zoom = _evalSceneZoom ? _evalSceneZoom(genNode(), frameTimeRef.current) : null } catch (e) { zoom = null }
    }
    if (zoom === null || !isFinite(zoom) || zoom <= 0) zoom = Number(rawVal(zRaw));
    return {
      eye: v3of(cam.eye, [0, 0, 0]),
      center: v3of(cam.center, [0, 0, 0]),
      up: v3of(cam.up, [0, 1, 0]),
      zoom: isFinite(zoom) && zoom > 0 ? zoom : 1,
    };
  };
  api.setCameraTransforms = (t) => {
    apiBump('setCameraTransforms');
    if (!t || typeof t !== 'object') return;
    const cam = camNode();
    if (t.eye !== undefined) cam.eye = fmt3(t.eye);
    if (t.center !== undefined) cam.center = fmt3(t.center);
    if (t.up !== undefined) cam.up = fmt3(t.up);
    const z = Number(t.zoom);
    // ①(P-232) zoom **不覆盖带动画的 `general.zoom`**：写穿会把作者的运镜动画对象替换成常数
    //   （脚本 round-trip 每帧都写 ⇒ 动画永久死亡）。动画每帧重估（官方管线语义），帧内瞬态写入
    //   让位于它；静态数字形态照旧写穿（S3e 契约不变）。
    if (isFinite(z) && z > 0) {
      const g = genNode();
      if (!(g.zoom && typeof g.zoom === 'object' && g.zoom.animation)) g.zoom = z;
    }
  };
  // ①(P-142) 帧末落地（`applySceneScripts` 调用）：把本帧排队删掉的层真从 `objList` 摘掉。
  //   非枚举（脚本 `Object.keys(thisScene)`/for-in 看不到它，不污染作者可见的对象面）。
  Object.defineProperty(api, '__flushDestroyedLayers', {
    value: () => {
      let n = 0;
      for (const o of destroyQueue) {
        const i = objList.indexOf(o);
        if (i >= 0) { objList.splice(i, 1); n++; }
      }
      destroyQueue.length = 0;
      if (n) apiBump('destroyLayerFlushed', n);
      return n;
    },
    enumerable: false, configurable: true, writable: true,
  });
  return api;
}

// 当前脚本所属对象代理: thisObject/thisLayer 通过它指向"当前对象",
// 使缓存共享的编译条目在多个对象间不串 (每次 update 前 ownerRef.current 更新)。
function makeOwnerRef() {
  const ref = { current: null };
  const rawVal = (v) => (v && typeof v === 'object' && 'value' in v ? v.value : v);
  const parseV = (s, def) => {
    const v = rawVal(s);
    const p = String(v == null ? '' : v).trim().split(/\s+/).map(Number);
    return new Vec3(p[0] ?? def[0], p[1] ?? def[1], p[2] ?? def[2]);
  };
  // ①(P-60) 写入归一化：脚本可以给 origin/scale 赋 Vec3，也可以赋 "x y z" 字符串。
  //   旧 setter 用 `v.x != null ? v.x : v[0]` 取分量 → 字符串会按**字符下标**取值
  //   （'4242 2424 0' → x='4', y='2', z='4' → 静默写成 "4 2 4"，坐标被写坏且无报错）。
  /* ③(P-228k 2026-10-05) **标量写广播到三分量**：语料里存在 `thisScene.getLayer('中-菜单-浮动').origin = 0`
     这种写法（`0923/2887099508` 的 `安全模式` 脚本；混淆源码里是 `= (-0x3e8,-0x3e8,0x0)`，逗号表达式
     **求值为 0**）。旧实现只认 Vec3/字符串 ⇒ 标量被 `toXYZ` 判成 null、**写入被静默丢弃** ⇒
     菜单永远停在作者声明的屏外坐标（`origin.x = -3189`），"打开菜单"整条路径表现不出来。
     WE 的绑定把标量当 `(v, v, v)`（0 ⇒ 左上角原点，正好是"菜单挪到 0,0 显示"的作者意图）。
     回退口 `?scriptvec=legacy`（= 旧行为：标量写入丢弃），缺省新语义。 */
  const toXYZ = (v) => {
    if (v == null) return null;
    if (typeof v === 'number') {
      if (!SCALAR_VEC_BROADCAST || !isFinite(v)) return null;
      return [v, v, v];
    }
    if (typeof v === 'string') {
      const p = v.trim().split(/\s+/).map(Number);
      if (!p.length || !isFinite(p[0])) return null;
      return [p[0], isFinite(p[1]) ? p[1] : 0, isFinite(p[2]) ? p[2] : 0];
    }
    const x = v.x != null ? v.x : v[0];
    const y = v.y != null ? v.y : v[1];
    const z = v.z != null ? v.z : (v[2] != null ? v[2] : 0);
    if (x == null || !isFinite(Number(x))) return null;
    return [Number(x), isFinite(Number(y)) ? Number(y) : 0, isFinite(Number(z)) ? Number(z) : 0];
  };
  // ①(P-141) 原局部 `animRef` 提到模块级 `animRefShared`（`getAnimation()` 与 `getAnimationLayer()`
  //   共用同一份，避免两处漂移）；语义逐位不变。
  const animRef = (obj) => animRefShared(obj);
  // ①(2026-09-12) 行向量 4x4（平移在 [12],[13],[14]）：脚本用 `.m[13]` 判断"层在屏幕上半/下半"
  //   （3326873240 Clock Container: `parent.getTransformMatrix().m[13] > engine.canvasSize.y / 2`）
  // 复用模块级共享实现（thisScene 的层引用用同一份，避免两处漂移）
  const transformMatrixOf = (obj) => transformMatrixShared(obj)
  // ①(2026-09-12) getParent() 必须返回**可继续链式调用**的图层引用（脚本里 parent.getParent()/
  //   parent.getTransformMatrix() 都有用到）；找不到父级时返回安全空引用而不是抛错。
  const emptyLayerRef = () => {
    const self = {
      getTransformMatrix: () => transformMatrixOf(null),
      getParent: () => self,
      getTextureAnimation: () => texAnimRef(null),
      getVideoTexture: () => videoTexRefShared(null),
      getAnimationLayer: () => animRef(null),
      getAnimationLayerCount: () => animLayerCountOf(null),
      // ①(P-141) 空层引用也要有完整 ILayer 面（官方 IObject.getAnimation / ISoundLayer / IParticleSystem）
      ...makePlaybackRef(null),
      getAnimation: (name) => { apiBump('getAnimation'); return makeAnimationRef(null, name) },
      getParticleSystem: () => { apiBump('getParticleSystem'); return particleRefFor(null) },
      get instance() { return particleInstanceOf(null) },
      get visible() { return true }, set visible(v) {},
      // ①(P-142) 官方 ITextLayer.text（见模块级 textOf/writeText）：空引用给 `''`（可 toString）而不是 undefined
      get text() { return '' }, set text(v) {},
      /* ①(P-143) 空层引用也要有**完整的** ILayer 面（与 layerRef/layerRefFor 同一套；P-137 的教训：
       *   同一个 ILayer 概念不能两套属性面）。缺成员会让 `parent.getEffect(...)`/`parent.pointsize`
       *   掉回 undefined ⇒ 又是静默 NaN/错分支。缺省与真层一致（pointsize 32 等），写全部静默丢弃。 */
      get pointsize() { return 32 }, set pointsize(v) {},
      get font() { return '' }, set font(v) {},
      get horizontalalign() { return HAlignDefault }, set horizontalalign(v) {},
      get verticalalign() { return VAlignDefault }, set verticalalign(v) {},
      get originalOrigin() { return new Vec3(0, 0, 0) }, set originalOrigin(v) {},
      getEffect: (name) => { apiBump('getEffectUnresolved'); return makeEffectRef(null, -1, name) },
      getEffectCount: () => { apiBump('getEffectCount'); return 0 },
      get debug() { return false }, set debug(v) {},
      get origin() { return new Vec3(0, 0, 0) }, set origin(v) {},
      get scale() { return new Vec3(1, 1, 1) }, set scale(v) {},
      get size() { return new Vec3(0, 0, 0) }, set size(v) {},
      get name() { return '' }, get id() { return -1 },
      clicked: false, cursorDetected: false,
    }
    /* ①(P-174) 六个值成员（angles/color/parallaxDepth/alignment/alpha/volume）也挂**同一对**共享访问器：
     *   空引用的底层对象是 null ⇒ 读回缺省（角度 0 0 0 / 颜色 1 1 1 / 视差 1 1 / 居中 / alpha 1 / 音量 1），
     *   写被 `write*` 的 `!obj` 分支拒掉（不抛错、不落盘）。 */
    return defineAccessors(bindLayerFace(self, () => null), LAYER_REF_MEMBER_ACCESSORS);
  }
  // ①(2026-09-12) 纹理动画句柄（`thisLayer.getTextureAnimation()`）：脚本用 stop()/setFrame()/play()
  //   驱动精灵表帧（3326873240 的 dragAndDropToggle/clockHideToggle）。帧号写进 obj.__texFrame，
  //   渲染器侧若看到该字段就优先用它（否则按时间自动推进）。
  const texAnimRef = (obj) => texAnimRefShared(obj)
  const layerRefFor = (obj) => {
    if (!obj) return emptyLayerRef()
    const parentObj = (obj.parent !== undefined && obj.parent !== null && ref.byId) ? ref.byId.get(obj.parent) : null
    const built = Object.assign(Object.create(null), emptyLayerRef(), {
      getTransformMatrix: () => transformMatrixOf(obj),
      getParent: () => layerRefFor(parentObj),
      getTextureAnimation: () => texAnimRef(obj),
      getVideoTexture: () => videoTexRefShared(obj),
      // ①(P-142) getAnimationLayer 的伴生计数（本引用是 Object.assign 摊平的，见下方 text 的同类说明）
      getAnimationLayerCount: () => animLayerCountOf(obj),
      // ①(P-141) 同一套 ILayer 面（见文件上方 P-141 块）：IObject.getAnimation / ISoundLayer / IParticleSystem
      ...makePlaybackRef(obj),
      getAnimation: (name) => { apiBump('getAnimation'); return makeAnimationRef(obj, name) },
      getParticleSystem: () => { apiBump('getParticleSystem'); return particleRefFor(obj) },
      get instance() { return particleInstanceOf(obj) },
      // ①(P-174) `visible/origin/scale/size/name/id` **从字面量里挪到下面的 defineAccessors**：
      //   这一段字面量是 `Object.assign` 的**源**，访问器在赋值时被取值摊平成**快照数据属性**
      //   ⇒ 写在 `getParent()` 引用上的 `parent.origin = …` 会静默丢掉（读也只读创建那一刻的值）。
      //   本批把 F3 打通（byId 修复）后这条路径第一次真的会被走到，所以顺手修掉；读写语义逐位照抄
      //   原来那几行（origin/scale 六位小数格式、size 直写、visible 布尔化）。
      // ①(P-143) 方法形态的成员（不是访问器 ⇒ 不会被 Object.assign 摊平，可以直接留在字面量里）
      getEffect: (name) => effectRefFor(obj, name),
      getEffectCount: () => effectCountOf(obj),
      clicked: false, cursorDetected: false,
    })
    /* ①(P-142) `text` 必须**单独重挂成访问器**：上面那份字面量是 `Object.assign` 的源 ⇒ 访问器在
     *   赋值时被**取值摊平成快照数据属性**（本文件 defineAccessors 上方注释记的正是这个坑），写在
     *   `getParent()` 引用上的 `text` 会静默丢失。读=层的文本、写=写穿节点 value，与 thisLayer 同一面。 */
    /* ①(P-143) 同一坑对新成员同样成立（它们全是访问器）⇒ 一并在这里重挂；`originalOrigin` 尤其必须
     *   是**每次访问重新读**（快照可能在这一帧稍后才被 createLayer/applySceneScripts 抓上）。 */
    /* ①(P-174) 六个五面共用的值成员（angles/color/parallaxDepth/alignment/alpha/volume）同样必须在这里
     *   重挂：`emptyLayerRef()` 那一份经 `Object.assign` 已被摊平成**快照数据属性**（读一次就冻住），
     *   不重挂的话 `parent.color`/`parent.volume` 会永远是空引用的缺省值（长度像素级静默错值）。 */
    return defineAccessors(bindLayerObject(bindLayerFace(built, () => obj), obj), Object.assign({
      text: { get: () => textOf(obj), set: (v) => writeText(obj, v) },
      pointsize: { get: () => pointsizeOf(obj), set: (v) => textLayerWrite(obj, 'pointsize', v) },
      font: { get: () => fontOf(obj), set: (v) => textLayerWrite(obj, 'font', v) },
      horizontalalign: { get: () => alignOf(obj, 'horizontalalign'), set: (v) => textLayerWrite(obj, 'horizontalalign', v) },
      verticalalign: { get: () => alignOf(obj, 'verticalalign'), set: (v) => textLayerWrite(obj, 'verticalalign', v) },
      originalOrigin: { get: () => authoredOriginOf(obj), set: () => { /* 只读虚拟成员：静默丢弃不抛错 */ } },
      debug: { get: () => debugFlagOf(obj), set: (v) => writeDebugFlag(obj, v) },
      // ①(P-174) 见上面"从字面量里挪过来"的说明（这六项原来会被摊平成快照数据属性）
      visible: { get: () => obj.visible !== false, set: (v) => { nodeWrite(obj, 'visible', !!v); propWriteNote(obj, 'visible', !!v) } },   // ②(P-237) nodeWrite：保住作者的 {script,value} 节点
      origin: {
        get: () => parseV(obj.origin, [0, 0, 0]),
        // ③(P-228k) 走共享归一化：字符串/标量不再写 NaN（旧实现在这两类输入下都写 "NaN NaN NaN"）
        set: (v) => {
          const s2 = vec3WriteString(v)
          propWriteNote(obj, 'origin', s2 == null ? '(dropped)' : s2)
          if (s2 == null) { vecWriteNote(obj, null); return }
          obj.origin = s2
          /* ③(P-228k 取证面) 只读环形账：最近 20 次层引用 `origin` 写入（层名 + 归一化后的串 + 原始值类型）。
             为什么留常驻：这类"脚本写坐标没生效"的定位此前只能靠猜（写丢/写偏/分支没走到三种原因读数一样）。 */
          vecWriteNote(obj, s2, v)
        },
      },
      scale: {
        get: () => parseV(obj.scale, [1, 1, 1]),
        set: (v) => { if (v == null) return; nodeWrite(obj, 'scale', `${Number(v.x != null ? v.x : v[0]).toFixed(6)} ${Number(v.y != null ? v.y : v[1]).toFixed(6)} ${Number(v.z != null ? v.z : v[2] || 0).toFixed(6)}`) },   // ②(P-237) 同上
      },
      size: {
        get: () => parseV(obj.size, [0, 0, 0]),
        set: (v) => { if (v == null) return; obj.size = `${Number(v.x != null ? v.x : v[0]).toFixed(6)} ${Number(v.y != null ? v.y : v[1]).toFixed(6)} ${Number(v.z != null ? v.z : v[2] || 0).toFixed(6)}` },
      },
      name: { get: () => obj.name || '' },
      id: { get: () => obj.id },
    }, LAYER_REF_MEMBER_ACCESSORS))
  }
  // ①(P-60 2026-09-14 第1项时钟错位根因) **必须每次属性访问时重新读 ref.current**：
  //   旧实现把 `const obj = ref.current` 写在工厂函数体开头，而 makeLayer()/makeObject() 在
  //   compileScript 里**只调用一次**（编译期），编译结果又按脚本源缓存 → 捕获到的是"编译那一刻"
  //   ref.current，即**上一个脚本节点 setOwner 留下的对象**。后果：每个"首次编译的脚本属性"
  //   都拿错 thisLayer/thisObject（真机 3554161528 时钟层 id398 的 origin 脚本把 id1592 的
  //   origin 2833.34644,1378.56702 写进了自己 → 时钟跑到歌曲名位置；Δ1638 疑案）。
  //   同一层的第 2/3 个脚本属性因为编译时 ref.current 恰好已是本层而"看起来正常"，所以极难发现。
  //   修法：cur() 惰性取值，所有 getter/setter 内联调用。
  const layerRef = () => {
    const cur = () => ref.current;
    /* ①(P-174) F4 = `thisLayer`：字面量 + 末尾挂上六个五面共用的值成员（angles/color/parallaxDepth/
     *   alignment/alpha/volume）。底层对象必须**惰性**取（`cur()`，P-60），所以绑的是取对象的函数；
     *   注意 `alpha` 原来在这里有一份自己的 getter/setter（读法是 `obj.alpha != null ? obj.alpha : 1`）
     *   —— 节点形态（`{script,value}`）会被原样返回给作者参与算术（NaN），本批起统一走 `alphaOf`
     *   （nodeRaw + 缺省 1，与 F1/F3 逐位一致）。 */
    return defineAccessors(bindLayerFace({
      getAnimationLayer: (i) => animRef(cur()),
      getAnimationLayerCount: () => animLayerCountOf(cur()),
      getParent: () => { const obj = cur(); return layerRefFor(obj && ref.byId ? ref.byId.get(obj.parent) : null) },
      getTransformMatrix: () => transformMatrixOf(cur()),
      getTextureAnimation: () => texAnimRef(cur()),
      getVideoTexture: () => videoTexRefShared(cur()),
      // ①(P-141) 官方 `IObject.getAnimation(name?: String): IAnimation`（d.ts L494-499）——
      //   语料 3 个包（0917/3448877775 与两份夜莺 alone_孤独の少女）在 init 里
      //   `animation = thisLayer.getAnimation()`，缺了它就是 "init:thisLayer.getAnimation is not a function"。
      //   `objectRef().getAnimation` 早就有（同源）；这里补的是 thisLayer 那一半。
      getAnimation: (name) => { apiBump('getAnimation'); return makeAnimationRef(cur(), name) },
      // ①(P-141) 语料 `thisLayer.getParticleSystem()`（官方无此成员）：按官方模型
      //   "ILayer 自己就是 IParticleSystem"（d.ts L1139）返回**本层的粒子系统视图**。
      getParticleSystem: () => { apiBump('getParticleSystem'); return particleRefFor(cur()) },
      // ①(P-141) 官方 `IParticleSystem.instance`（d.ts L984）—— 与 getParticleSystem().instance 同一对象
      get instance() { return particleInstanceOf(cur()) },
      // ①(P-141) 官方 `ISoundLayer`（d.ts L744-771）的 play/pause/stop/isPlaying 四项。
      //   ⚠ 必须**惰性取 cur()**：编译期 ref.current 还是上一个脚本节点的对象（P-60 的根因），
      //   所以这四个不能像普通字段那样在工厂函数体里一次性绑定对象。
      play() { apiBump('play'); const o = cur(); if (o) { try { PLAYBACK_STATE.set(o, true) } catch { /* ignore */ } } },
      pause() { apiBump('pause'); const o = cur(); if (o) { try { PLAYBACK_STATE.set(o, false) } catch { /* ignore */ } } },
      stop() { apiBump('stop'); const o = cur(); if (o) { try { PLAYBACK_STATE.set(o, false) } catch { /* ignore */ } } },
      isPlaying() { apiBump('isPlaying'); const o = cur(); try { return o ? !!PLAYBACK_STATE.get(o) : false } catch { return false } },
      emitParticles(count) {
        apiBump('emitParticles');
        const o = cur(); const n = Math.max(0, Math.trunc(Number(count)) || 1);
        if (o) { try { o.__psEmitRequest = (o.__psEmitRequest | 0) + n } catch { /* ignore */ } }
      },
      get visible() { const obj = cur(); return obj ? obj.visible !== false : true; },
      set visible(v) { const obj = cur(); if (obj) obj.visible = !!v; },
      get origin() { const obj = cur(); return obj ? parseV(obj.origin, [0, 0, 0]) : new Vec3(0, 0, 0); },
      set origin(v) {
        const obj = cur(); const p = toXYZ(v);
        if (!obj || !p) return;
        /* ①(P-143) **写回不破坏节点**：原实现直接 `obj.origin = 字符串`，当 origin 是作者的
         *   `{script,value}` 节点时会把节点整只换掉 ⇒ 下一帧 `applySceneScripts.collect()` 再也找不到
         *   这个脚本、作者的 origin 脚本**永久停摆**（静默）。必须走 nodeWrite（与 thisScene 的层引用、
         *   P-141 的 alpha/parallaxDepth 同一口径）。本批的直接触发场景：真包 0923/3521337568 /
         *   3653641024 / dd/3554161528 的 NSL 拖动库 `thisLayer.origin = thisLayer.originalOrigin`
         *   （"恢复初始位置"）—— 节点若被换掉，这条重置只在第一帧生效。 */
        nodeWrite(obj, 'origin', `${p[0].toFixed(6)} ${p[1].toFixed(6)} ${p[2].toFixed(6)}`);
        markExplicitPropWrite(obj, 'origin');   // ①(P-143) 显式赋值优先于返回值（见 EXPLICIT_PROP_WRITE 注释）
      },
      get scale() { const obj = cur(); return obj ? parseV(obj.scale, [1, 1, 1]) : new Vec3(1, 1, 1); },
      set scale(v) {
        const obj = cur(); const p = toXYZ(v);
        if (!obj || !p) return;
        nodeWrite(obj, 'scale', `${p[0].toFixed(6)} ${p[1].toFixed(6)} ${p[2].toFixed(6)}`);   // ①(P-143) 同上：保节点
        markExplicitPropWrite(obj, 'scale');
      },
      // ①(P-137) `thisLayer.size`（IEffectLayer.size，官方 Vec2 / readonly）：长注释见 sizeOf 定义处
      get size() { return sizeOf(cur()); },
      set size(v) { /* 官方 readonly：静默丢弃而不抛错，理由见 sizeOf 上方注释 */ },
      // ①(P-142) 官方 `ITextLayer.text: String`（d.ts L812-816，`ILayer extends … ITextLayer` L1139）：
      //   文本层脚本 `thisLayer.text.toString().split("|").join("\n")` 此前读到 undefined ⇒
      //   `update:Cannot read properties of undefined (reading 'toString')`（真包 0923/3122339805 三处）。
      get text() { return textOf(cur()) },
      set text(v) { const obj = cur(); if (obj) writeText(obj, v); },
      /* ①(P-143) `ITextLayer` 四个值成员 + `IEffectLayer.getEffect/getEffectCount` + `originalOrigin`
       *   + `debug`（长注释见文件上方 P-143 块）。四条口径在这里的落点：
       *     · **惰性 cur()**（P-60 的根因：编译期 ref.current 还是上一个节点的对象）；
       *     · 读缺省**不为 NaN/undefined**（pointsize 32 / font '' / align left,top / originalOrigin Vec3(0,0,0)
       *       / debug false）—— 真包 `佩丽卡1_03` 的 `value.y = … + thisLayer.pointsize * 0.36 + 5` 就是靠这条；
       *     · 写走 `textLayerWrite`（nodeWrite 保节点 + pointsize 非有限值不落盘）；
       *     · 每次命中计数（`sceneScriptApiDiag()` 可观测）。 */
      get pointsize() { return pointsizeOf(cur()) },
      set pointsize(v) { const obj = cur(); if (obj) textLayerWrite(obj, 'pointsize', v); },
      get font() { return fontOf(cur()) },
      set font(v) { const obj = cur(); if (obj) textLayerWrite(obj, 'font', v); },
      get horizontalalign() { return alignOf(cur(), 'horizontalalign') },
      set horizontalalign(v) { const obj = cur(); if (obj) textLayerWrite(obj, 'horizontalalign', v); },
      get verticalalign() { return alignOf(cur(), 'verticalalign') },
      set verticalalign(v) { const obj = cur(); if (obj) textLayerWrite(obj, 'verticalalign', v); },
      get originalOrigin() { return authoredOriginOf(cur()) },
      set originalOrigin(v) { /* 只读虚拟成员（wer-ref 同款）：静默丢弃不抛错 */ },
      getEffect: (name) => effectRefFor(cur(), name),
      getEffectCount: () => effectCountOf(cur()),
      get debug() { return debugFlagOf(cur()) },
      set debug(v) { const obj = cur(); if (obj) writeDebugFlag(obj, v); },
      get name() { const obj = cur(); return obj ? obj.name || '' : ''; },
      get id() { const obj = cur(); return obj ? obj.id : 0; },
      cursorDetected: false,
      clicked: false,
    }, cur), LAYER_REF_MEMBER_ACCESSORS);
  };
  /* ①(P-137 2026-09-19 用户第 8 项) `thisLayer.size` / `thisObject.size`：**上一次缺失的读取器**
   *
   * ── 现场（真机手动上报，`$MPW_ROOT/reports/r<ts>.json`）────────────────────────────────
   *   · `r1789751541247.json` 包 3327063360：`subsystems.scriptErrs = ["update:Cannot read
   *     properties of undefined (reading 'x')×511"]`（511 帧 = 每帧一次）；
   *   · `r1789751395466.json` 包 3660962877：同一条错 ×72；第三个包（3719111841）无此错。
   *   出错的**就是** `.size`：两包的脚本分别是
   *     `3327063360` objects[50].scale : `value.x = width / (thisLayer.size.x * initScale.x) * initScale.x;`
   *     `3660962877` objects[122].origin: `let imageSize = thisLayer.size; imageSize.x *= scale.x * 0.5;`
   *   全语料静态扫描（98 容器 / 37 个带脚本的包）里 `thisLayer.size` 共 **73 次**读取、分布在 11 个包，
   *   修复前**每一个**都在第 1 帧抛这条 TypeError —— 也就是用户看到的"一堆错"。
   *
   * ── 官方语义出处（一手）────────────────────────────────────────────────────────────────
   *   `$MPW_ROOT/wallpaper_engine/ui/dist/monaco/autocomplete/lib.sceneScript.d.ts`
   *     · L775-795 `interface IEffectLayer` 的 `readonly size: Vec2`，其上方文档注释逐字为
   *       "Resolution of the image layer in pixels. Only read this, do not write."
   *     · L1139 `interface ILayer extends IObject, IImageLayer, ISoundLayer, IEffectLayer, …`
   *       ⇒ `size` 是 `ILayer`（L1242 `declare let thisLayer: ILayer`）的**合法成员**。
   *   官方文档：https://docs.wallpaperengine.io/scene/scenescript/reference/class/ILayer
   *   行为对照（只读结论、不抄代码）：第三方参考实现 wer-ref
   *   `src/backend/scene/internal/scenescript/WPSceneScriptHost.cpp:437`
   *   `if (property_name == "size") return { WPDynamicValue::Type::Float2, true };`（size 是二维量）。
   *
   * ── 我们为什么给成 undefined（根因）────────────────────────────────────────────────────
   *   `makeOwnerRef()` 的 `layerRef()`（= 沙箱里的 `thisLayer`）与 `objectRef()`（= `thisObject`）
   *   是**对象字面量**，此前只声明了 origin/scale/alpha/name/id/visible…，**从来没有 `size` 这个键**；
   *   同文件的 `emptyLayerRef()`（空引用）与 `layerRefFor()`（thisScene.getLayer 返回的层）都**有** size
   *   —— 于是"同一个 ILayer 概念"在本文件里有两套属性面：缺的那套读出来是 `undefined`，
   *   作者脚本紧跟的 `.x` 就抛 `Cannot read properties of undefined (reading 'x')`，每帧一次。
   *
   * ── 为什么返回 Vec3（官方写的是 Vec2）与 setter 的口径 ────────────────────────────────
   *   · 读取统一走本文件既有的 `parseV` 口径（origin/scale/size 同一个函数、同一个 Vec3 返回类型，
   *     `emptyLayerRef()`/`layerRefFor()` 的 size 本来就是 Vec3）⇒ 不引入第二套"二维/三维"分叉；
   *     Vec3 是 Vec2 的**超集**（.x/.y 同值，.z = 0 而**不是** undefined），作者脚本哪怕读 size.z
   *     也不会新造一个 TypeError。场景里 size 字符串本身就只有两段（`"1206.00000 512.00000"`），
   *     `parseV` 的 `p[2] ?? def[2]` 自然补 0。
   *   · setter 是**存在但不落盘**的 no-op：官方 d.ts 标注 `readonly` + "Only read this, do not write"；
   *     而**只写 getter** 会让访问器没有 setter ⇒ 作者脚本（绝大多数 `'use strict'`）里
   *     `thisLayer.size = …` 由"静默成功（在普通对象上新建自有属性）"变成 **TypeError**，
   *     那是比"写入无效"更重的行为改变，所以宁可静默丢弃（size 由纹理/文本布局决定，渲染侧不读它）。
   *   · ⚠ 已知口径差异（记在 PATCHES P-137 未证实项）：`layerRefFor()` 的 `set size` 目前是**写穿**
   *     `obj.size`。同一 ILayer 概念两处 setter 语义不同，本批**不改它**（与本条 bug 无关、改动有回归面），
   *     留给后续单独定夺。 */
  const sizeOf = (obj) => parseV(obj ? obj.size : null, [0, 0, 0])
  // ①(P-60) 同 layerRef：惰性取 ref.current（编译期快照 = 上一个脚本节点的对象）
  /* ①(P-174) F5 = `thisObject`。⚠ 官方 d.ts 里**没有** `thisObject` 这个声明（两份官方 d.ts 全文 0 命中；
   *   最近的类型是 L504-510 `interface IThisPropertyObjectBase extends IObject {}` —— 空接口）。
   *   本仓的既有口径（P-137/P-142/P-143 一路下来）是"`thisObject` 就是该层 ⇒ 不能两套面"，
   *   所以**值成员**（origin/scale/size/visible/text/pointsize/font/对齐/alpha/angles/color/parallaxDepth/
   *   alignment/volume）与 thisLayer 同源；而**方法面**（getParent/getTextureAnimation/getAnimationLayer/
   *   play-pause-stop-isPlaying/getTransformMatrix/…）只在 thisLayer 上给 —— 官方没有 thisObject 面、
   *   语料里也 0 处 `thisObject.<方法>()`（普查：thisObject 只被用来读写值），本批不扩这条回归面。
   *   审计表里 F5 的这些格子标 `na`（依据就是本条），不是"漏了"。 */
  const objectRef = () => {
    const cur = () => ref.current;
    return defineAccessors(bindLayerFace({
      getMaterial: () => ({}),
      // ①(P-141) `objectRef().getAnimation` 此前返回 `animRef`（IAnimationLayer 的 no-op 面）。
      //   官方 `IObject.getAnimation` 的返回类型是 **IAnimation**（d.ts L494-499）⇒ 换成
      //   `makeAnimationRef`：它是 `animRefShared` 的**超集**（原有 setVisible/setRate/… 全在），
      //   所以既有调用（语料 11 个包用 thisObject.getAnimation()）一个都不少，只是多出官方 IAnimation 面。
      getAnimation: (name) => { apiBump('getAnimation'); return makeAnimationRef(cur(), name) },
      get origin() { const obj = cur(); return obj ? parseV(obj.origin, [0, 0, 0]) : new Vec3(0, 0, 0); },
      set origin(v) { const obj = cur(); const p = toXYZ(v); if (obj && p) { nodeWrite(obj, 'origin', `${p[0]} ${p[1]} ${p[2]}`); markExplicitPropWrite(obj, 'origin') } },   // ①(P-143) nodeWrite：保节点 + 显式写优先
      get scale() { const obj = cur(); return obj ? parseV(obj.scale, [1, 1, 1]) : new Vec3(1, 1, 1); },
      set scale(v) { const obj = cur(); const p = toXYZ(v); if (obj && p) { nodeWrite(obj, 'scale', `${p[0]} ${p[1]} ${p[2]}`); markExplicitPropWrite(obj, 'scale') } },     // ①(P-143) 同上
      // ①(P-137) `thisObject.size`：与 thisLayer 同一个 ILayer 概念（属性绑定的对象就是该层），
      //   同一份 sizeOf 读取器 —— 缺了它，把 size 写在 thisObject 上的作者脚本会掉进同一条 TypeError。
      get size() { return sizeOf(cur()); },
      set size(v) { /* 官方 readonly：静默丢弃而不抛错，理由见 sizeOf 上方注释 */ },
      get visible() { const obj = cur(); return obj ? obj.visible !== false : true; },
      set visible(v) { const obj = cur(); if (obj) obj.visible = !!v; },
      // ①(P-142) 官方 `ITextLayer.text`（thisObject 与 thisLayer 是同一个 ILayer 概念 ⇒ 不能两套面，
      //   P-137 的 size 就是这么栽的）：读写都走模块级 textOf/writeText。
      get text() { return textOf(cur()) },
      set text(v) { const obj = cur(); if (obj) writeText(obj, v); },
      /* ①(P-143) 与 thisLayer 逐位同源的四个文本成员 + getEffect/getEffectCount + originalOrigin + debug
       *   （同一个 ILayer 概念 ⇒ 不能两套面；`thisObject` 就是该层）。 */
      get pointsize() { return pointsizeOf(cur()) },
      set pointsize(v) { const obj = cur(); if (obj) textLayerWrite(obj, 'pointsize', v); },
      get font() { return fontOf(cur()) },
      set font(v) { const obj = cur(); if (obj) textLayerWrite(obj, 'font', v); },
      get horizontalalign() { return alignOf(cur(), 'horizontalalign') },
      set horizontalalign(v) { const obj = cur(); if (obj) textLayerWrite(obj, 'horizontalalign', v); },
      get verticalalign() { return alignOf(cur(), 'verticalalign') },
      set verticalalign(v) { const obj = cur(); if (obj) textLayerWrite(obj, 'verticalalign', v); },
      get originalOrigin() { return authoredOriginOf(cur()) },
      set originalOrigin(v) { /* 只读虚拟成员：静默丢弃不抛错 */ },
      getEffect: (name) => effectRefFor(cur(), name),
      getEffectCount: () => effectCountOf(cur()),
      get debug() { return debugFlagOf(cur()) },
      set debug(v) { const obj = cur(); if (obj) writeDebugFlag(obj, v); },
      get name() { const obj = cur(); return obj ? obj.name || '' : ''; },
      get id() { const obj = cur(); return obj ? obj.id : 0; },
    }, cur), LAYER_REF_MEMBER_ACCESSORS);
  };
  // ①(P-141) `thisLayer` 那个**层引用实例**（`compileScript` 只调用一次 `makeLayer()`）：
  //   `thisScene.getLayerIndex(thisLayer)` 需要把"层引用对象"还原成 `scene.objects` 里的对象，
  //   而 ownerRef 的引用是惰性绑定 `ref.current` 的，所以这里把**实例**暴露出去，
  //   由 `applySceneScripts` 通过 `makeSceneRef(objects, { ownerLayerRef, ownerObj })` 传进来。
  let layerRefInstance = null;
  return {
    ref,
    makeLayer: () => (layerRefInstance || (layerRefInstance = layerRef())),
    makeObject: objectRef,
    layerRefObj: () => layerRefInstance,
    setOwner(o) { ref.current = o; try { PROP_WRITE_OWNER = o ? String(o.name || o.id || '?') : '?' } catch (e) { PROP_WRITE_OWNER = '?' } },
  };
}

// ①(P-121 A) 沙箱 `console` 门面：**每个沙箱一个独立对象**，脚本里 `console.log = () => {}`
//   只改这个门面，宿主进程/宿主页面的真 `console` 一个属性都不动。
//
// 现场（P-120 交付里记录的原始观察 + 本次逐字节复核）：
//   `allwallpaper/0917/3462491575/scene.pkg` 的作者脚本正文含
//     `if (!isRunningInEditor) {\n\tconsole.log = () => { }`（脚本节点 1 个，实测命中）
//   而沙箱（`elysia/nsl.js` 的 `new Function` + `with (ctx)`，浏览器/Node 同一份实现）此前把
//   `context.console` 直接指向**宿主真 console 对象** ⇒ 跑过这个包之后宿主进程的 `console.log`
//   被全局改写成空函数（复现：本文件改动前 `applySceneScripts()` 一趟后 `console.log === before`
//   为 false、且宿主再 log 什么都不输出），旁证是 `tests/camera-script-origin-probe.mjs` 里
//   专门为它写的 `muteConsole` 规避。
//
// 语义（三条都钉在 `tests/script-sandbox-globals-test.mjs`）：
//   · 写：只落到门面自己（作者"把 console 静音"的意图在**它自己的沙箱内**照常生效）；
//   · 读：转发到**当前**宿主 `console` 的同名方法 —— 调用时按名字重取，所以
//     `demo.html:929-931` 把 `console.warn/error` 桥到页面 `#log` 面板之后，沙箱日志照样进 #log；
//     Node 侧则照常进 stdout（**日志不被沙箱吞掉**）。
//   · 门面绝不能被冻结：作者脚本 `'use strict'` 下 `console.log = …` 若抛 TypeError，
//     整个脚本会加载失败（那是比"静音"更重的行为改变）。
function makeSandboxConsole() {
  const own = Object.create(null);   // 脚本自己写过的键（含"作者把 console.log 静音"）
  const fwd = new Map();             // 复用转发函数：`console.log === console.log` 保持稳定
  const hostConsole = () => { try { return (typeof console !== 'undefined' && console) ? console : null; } catch (e) { return null; } };
  return new Proxy(own, {
    get(t, p) {
      if (p in t) return t[p];                       // 脚本写过的（例如静音函数）优先
      const h = hostConsole();
      if (!h) return undefined;
      const v = h[p];
      if (typeof v !== 'function') return v;
      let f = fwd.get(p);
      if (!f) {
        f = (...args) => {                            // 调用时再取一次 ⇒ 宿主替换 console.* 也跟得上
          try {
            const hh = hostConsole();
            const fn = hh ? hh[p] : null;
            if (typeof fn === 'function') return fn.apply(hh, args);
          } catch (e) { /* 日志失败不影响脚本/宿主 */ }
          return undefined;
        };
        fwd.set(p, f);
      }
      return f;
    },
    set(t, p, v) { try { t[p] = v } catch (e) { /* 冻结/只读 ⇒ 静默（宿主 console 不受影响） */ } return true; },
    has(t, p) { const h = hostConsole(); return (p in t) || !!(h && (p in h)); },
  });
}

// ①(P-121 A③) 宿主**进程句柄**这一类全局：WE 运行时不提供、浏览器里本来就不存在 ——
//   而 `elysia/nsl.js` 的 `with (ctx)` 只遮蔽 ctx 上**有**的键，`new Function` 的兜底作用域是
//   Node 的**进程全局** ⇒ 不显式 shadow 的话脚本能直接摸到 `process`/`Buffer`/`global`
//   （脚本写 `process.exitCode = 1` 之类就是宿主级副作用）。显式 shadow 成 `undefined` =
//   「浏览器里本来就没有这些标识符」这一事实，Node 侧从此与浏览器/WE 运行时同形。
//   语料实测：11 个 dd 包正文里 `typeof process` = 0 命中（`Buffer` 命中都是 `MpwBuffer`/
//   `vertexBuffer` 一类名字，不是 Node 全局），所以这条 shadow 不改变任何语料行为。
const SANDBOX_HOST_ONLY_GLOBALS = {
  process: undefined, require: undefined, module: undefined, exports: undefined, Buffer: undefined, global: undefined,
};

// 编译脚本: 返回 { update, applyUserProperties, init, ... } 函数 (vm 沙箱)
// opts: { canvasSize, userProps, shared, thisScene, ownerRef, runtime }
//
// ①(P-127 A①) **逐名映射**官方 scene-script 模块 —— 旧实现是
//   `mod === 'WEMath' ? '__WEMath' : '__WEColor'`：**除 WEMath 外的一切模块名**（含官方 `WEVector`）
//   都被静默别名成 `__WEColor` ⇒ `WEVector.angleVector2` 是 undefined ⇒ 脚本抛
//   "WEVector.angleVector2 is not a function"。现在：**每个模块名一条自己的映射**，
//   官方三模块（`WEMath`/`WEVector`/`WEColor`）各自的命名空间与官方导出面同形；
//   表外的未知模块名 → `__WEEmptyModule`（空命名空间：属性读取得到 undefined、**不再兜底到 WEColor**）。
//   模块清单来自**全语料实测**（98 个 .pkg/.mpkg 容器内全部 scene.json，共 3 个名字：
//   `WEMath` 60 次 / `WEVector` 57 次 / `WEColor` 3 次）——见 tests/script-wevector-module-test.mjs 的 V1。
//   命名空间落点：`WEMath` → `__WEMath`（官方 4 名 + 既有超集别名）；`WEVector` → `__WEVector`；
//   `WEColor` → `__WEColor`（既有对象 + 官方 normalizeColor/expandColor）。
export const NSL_MODULE_GLOBALS = {
  WEMath: '__WEMath',
  WEVector: '__WEVector',
  WEColor: '__WEColor',
};
// 表外模块名落点：空命名空间。**故意不是 `__WEColor`** —— 别名到 WEColor 会把
// "模块不存在"变成"函数不存在"，且会让 `X.mix` 之类**看似可用**（静默错值比报错更难查）。
export const NSL_UNKNOWN_MODULE_GLOBAL = '__WEEmptyModule';
export function moduleGlobalFor(mod) {
  return Object.prototype.hasOwnProperty.call(NSL_MODULE_GLOBALS, mod)
    ? NSL_MODULE_GLOBALS[mod]
    : NSL_UNKNOWN_MODULE_GLOBAL;
}
/* ═══════════════════════════════════════════════════════════════════════════════
 * ①(P-153 2026-09-19) 脚本 `localStorage` 的**共享持久**档（`?scriptstore=persist`）
 *
 * 官方语义（一手出处：官方文档 docs.wallpaperengine.io 的 scene script `localStorage` 一节；
 * 上游 `oneincase/webwallgl`（MIT）`renderer/vendor/we-scene/render/storage.js:1-19` 的**行为契约**）：
 *   · **按壁纸共享**：同一张壁纸的全部脚本看到同一份存储 —— 不是每个脚本一份 Map；
 *   · **跨会话持久**：重开壁纸/刷新之后读到的还是上次写的值；
 *   · 位置两级：`LOCATION_SCREEN`（按壁纸，缺省）/ `LOCATION_GLOBAL`（跨壁纸）；
 *   · API：`getItem/setItem/removeItem/delete/clear/key/keys/length` + 语料用的别名 `get/set/remove`。
 *
 * 本仓今天的实现（`compileScript` 的 env 构造处）= **逐沙箱一个 `new Map()`**：脚本之间互相看不见、
 * 刷新即复位（既有注释自述"**不碰**宿主页面的存储"—— 那是本仓的纪律）。⇒ 本项**不改默认档**：
 * 缺省仍逐位保持 legacy（逐沙箱内存 Map、不共享、不持久），只有显式 `?scriptstore=persist` 走本档。
 * "默认要不要改成持久化"是**产品决策**，留给用户拍板（见 docs/PATCHES.md P-153 的诚实清单）。
 *
 * 与上游实现的**差异**（按规格独立实现，非照抄；实现者**接触过**上游 `storage.js:34-102`，
 * 不主张洁净室）：① 后端形态不同 —— 上游要宿主注入 `{get,set,remove,keys,clear}` provider
 * （裸键、前缀由宿主加），本实现直接吃 `window.localStorage`（Storage 形态
 * `getItem/setItem/removeItem/key/length`），命名空间与前缀在**本文件内**唯一决定 ⇒ 宿主一行都不用改；
 * ② 命名空间来自 `?id=`（= 包 id，与 `demo.html` 的 `mpw-props:<id>` 同一口径），
 * `LOCATION_GLOBAL` 落 `mpw.__global.`；③ 追加**兜底**：后端访问/写入抛错（配额、Safari 隐私模式、
 * 不透明源）⇒ 记一行 warn、整个会话退回内存，脚本不报错；④ 追加**值信封** —— 语料
 * `dd/3326873240` 存的是 `Vec3` 对象（`localStorage.set(storageName, thisLayer.origin)`），
 * DOM Storage 只能存字符串 ⇒ 非字符串用带标记的 JSON 信封落盘（读回是 `{x,y,z}` 普通对象，
 * `formatResult` 认得）；上游一律 `String(value)`（会把 Vec3 变成 `"[object Object]"`）。
 * ═══════════════════════════════════════════════════════════════════════════════ */

/** 键前缀（补丁方案 §5.4② 的建议名 `mpw.<包id>.<键>`；**只**写这个前缀下的键）。 */
export const SCRIPT_STORE_KEY_PREFIX = 'mpw.';
/** `LOCATION_GLOBAL`（跨壁纸）的命名空间段。 */
export const SCRIPT_STORE_GLOBAL_NS = '__global';
/** 位置常量（与上游 `storage.js:18-19` 同值；语料 0 使用，只为契约完备）。 */
export const LOCATION_SCREEN = 0;
export const LOCATION_GLOBAL = 1;
/** 非字符串值的落盘信封标记（NUL 开头 ⇒ 不可能与作者手写的字符串相撞）。 */
const SCRIPT_STORE_VALUE_TAG = '\u0000mpw-sv1:';

/**
 * `?scriptstore=persist` 的**唯一判定式**（正则字面量 ⇒ `tests/diag-flag-check.mjs` 规则 c 抓得到；
 * 与既有 `?bindorder=legacy`（`core/puppet-skin.js::bindOrderLegacy`）同形）。
 * 缺省 / 任何其它值（含 `?scriptstore=legacy`）= legacy 档。
 */
export function scriptStorePersist(search) {
  const s = (search === undefined || search === null) ? '' : String(search);
  return /[?&]scriptstore=persist/.test(s);
}

/** 查询串来源：显式入参 > `location.search`（浏览器，或测试注入的假 DOM）> `''`（Node）。 */
function scriptStoreSearch(opts) {
  if (opts && typeof opts.scriptStoreSearch === 'string') return opts.scriptStoreSearch;
  try {
    const loc = (typeof location !== 'undefined' && location) ? location
      : ((typeof globalThis !== 'undefined' && globalThis) ? globalThis.location : null);
    if (loc && typeof loc.search === 'string') return loc.search;
  } catch { /* 没有 location（Node）/ 访问即抛的宿主 */ }
  return '';
}

/**
 * 命名空间：显式入参（`opts.scriptStoreNamespace` / `opts.sceneId`）> `?id=` > `'default'`。
 * 只留 `[A-Za-z0-9_-]`（**去掉 `.`** ⇒ `mpw.<ns>.<key>` 的切分永远无歧义），上限 64 字符。
 */
export function scriptStoreNamespace(opts, search) {
  const explicit = opts ? (opts.scriptStoreNamespace || opts.sceneId) : null;
  let raw = explicit == null ? '' : String(explicit);
  if (!raw) {
    const s = search === undefined ? scriptStoreSearch(opts) : search;
    try { raw = new URLSearchParams(String(s == null ? '' : s).replace(/^\?/, '')).get('id') || ''; } catch { raw = ''; }
  }
  return String(raw || 'default').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'default';
}

/** `window.localStorage`（Storage 形态）。**访问属性本身**抛错（不透明源 / Safari 隐私模式）⇒ `null`。 */
function scriptStoreBackend(opts) {
  if (opts && opts.scriptStoreBackend) return opts.scriptStoreBackend;
  try {
    const ls = (typeof localStorage !== 'undefined' && localStorage) ? localStorage
      : ((typeof globalThis !== 'undefined' && globalThis) ? globalThis.localStorage : null);
    if (ls && typeof ls.getItem === 'function' && typeof ls.setItem === 'function' && typeof ls.removeItem === 'function') return ls;
  } catch { /* 访问即抛 ⇒ 视为没有后端（下面 makeScriptStore 记一行 warn） */ }
  return null;
}

function scriptStoreWarnSink(opts) {
  if (opts && typeof opts.onScriptStoreWarn === 'function') return opts.onScriptStoreWarn;
  return (msg) => { try { console.warn(msg) } catch { /* 宿主 console 不可用 */ } };
}

/** 后端不可用/写入失败：**只记一行 warn**、整会话退化内存（后续不再重试后端、不再重复告警）。 */
function scriptStoreFail(store, err) {
  store.degraded = true;
  if (store.warned) return;
  store.warned = true;
  const why = (err && (err.name ? err.name + ': ' : '') + (err.message || String(err))) || '后端不可用';
  try {
    store.warn('⚠ [P-153] 脚本 localStorage 持久化不可用（' + why + '）⇒ 退回内存：本会话内脚本照常读写，'
      + '刷新/重开壁纸后不保留（命名空间 ' + store.namespace + '）');
  } catch { /* ignore */ }
}

/**
 * 造一个**持久存储实例**（同一壁纸的全部脚本共用一份）。
 * 缺省（无 `?scriptstore=persist`）⇒ `null` ⇒ `compileScript` 走 legacy 的逐沙箱 Map（逐位不变）。
 * opts: { scriptStoreSearch, scriptStoreNamespace, sceneId, scriptStoreBackend, onScriptStoreWarn }
 */
export function makeScriptStore(opts = {}) {
  const search = scriptStoreSearch(opts);
  if (!scriptStorePersist(search)) return null;
  const namespace = scriptStoreNamespace(opts, search);
  const store = {
    namespace,
    prefix: SCRIPT_STORE_KEY_PREFIX + namespace + '.',
    globalPrefix: SCRIPT_STORE_KEY_PREFIX + SCRIPT_STORE_GLOBAL_NS + '.',
    search,
    backend: scriptStoreBackend(opts),
    mem: new Map(),          // 本会话的活值缓存（get 拿回**脚本写进去的那个对象**，与 legacy 同形）
    degraded: false,
    warned: false,
    warn: scriptStoreWarnSink(opts),
  };
  if (!store.backend) scriptStoreFail(store, new Error('没有可用的 localStorage 后端'));
  return store;
}

function storeFullKey(store, key, location) {
  return ((location === LOCATION_GLOBAL) ? store.globalPrefix : store.prefix) + String(key);
}
function storeBackendRead(store, full) {
  if (!store.backend || store.degraded) return null;
  try { const v = store.backend.getItem(full); return v == null ? null : String(v); }
  catch (e) { scriptStoreFail(store, e); return null; }
}
function storeBackendWrite(store, full, raw) {
  if (!store.backend || store.degraded) return false;
  try { store.backend.setItem(full, raw); return true; }
  catch (e) { scriptStoreFail(store, e); return false; }
}
function storeBackendRemove(store, full) {
  if (!store.backend || store.degraded) return;
  try { store.backend.removeItem(full); } catch (e) { scriptStoreFail(store, e); }
}
/** 后端里属于本命名空间的键（**去掉前缀**）；顺序 = DOM 枚举顺序。 */
function storeBackendKeys(store, location) {
  const out = [];
  const b = store.backend;
  if (!b || store.degraded || typeof b.key !== 'function') return out;
  const p = (location === LOCATION_GLOBAL) ? store.globalPrefix : store.prefix;
  try {
    const n = Number(b.length) || 0;
    for (let i = 0; i < n; i++) {
      const k = b.key(i);
      if (typeof k === 'string' && k.slice(0, p.length) === p) out.push(k.slice(p.length));
    }
  } catch (e) { scriptStoreFail(store, e); }
  return out;
}
/** 落盘编码：字符串原样；非字符串走带标记的 JSON 信封（`undefined`/循环引用退化成字符串）。 */
function storeEncode(v) {
  if (typeof v === 'string') return v;
  let j;
  try { j = JSON.stringify(v); } catch { j = undefined; }
  if (j === undefined) j = JSON.stringify(String(v));
  return SCRIPT_STORE_VALUE_TAG + j;
}
function storeDecode(raw) {
  if (typeof raw !== 'string' || raw.slice(0, SCRIPT_STORE_VALUE_TAG.length) !== SCRIPT_STORE_VALUE_TAG) return raw;
  try { return JSON.parse(raw.slice(SCRIPT_STORE_VALUE_TAG.length)); } catch { return raw; }
}
function storeGet(store, key, dflt, location) {
  const full = storeFullKey(store, key, location);
  if (store.mem.has(full)) return store.mem.get(full);
  const raw = storeBackendRead(store, full);
  if (raw === null) return dflt !== undefined ? dflt : null;   // 与 legacy 的 get(k, dflt) 同口径
  const v = storeDecode(raw);
  store.mem.set(full, v);
  return v;
}
function storeSet(store, key, value, location) {
  const full = storeFullKey(store, key, location);
  store.mem.set(full, value);
  storeBackendWrite(store, full, storeEncode(value));
}
function storeRemove(store, key, location) {
  const full = storeFullKey(store, key, location);
  store.mem.delete(full);
  storeBackendRemove(store, full);
}
function storeHas(store, key, location) {
  const full = storeFullKey(store, key, location);
  return store.mem.has(full) || storeBackendRead(store, full) !== null;
}
function storeKeys(store, location) {
  const out = storeBackendKeys(store, location);
  const seen = new Set(out);
  const p = (location === LOCATION_GLOBAL) ? store.globalPrefix : store.prefix;
  for (const full of store.mem.keys()) {
    if (full.slice(0, p.length) !== p) continue;
    const k = full.slice(p.length);
    if (!seen.has(k)) { seen.add(k); out.push(k); }
  }
  return out;
}
/** 只清**本命名空间**的键（绝不 `localStorage.clear()` —— 那会连宿主的键一起清掉）。 */
function storeClear(store, location) {
  for (const k of storeKeys(store, location)) storeRemove(store, k, location);
}

/** 把 store 包成脚本看得见的 `localStorage`（persist 档）。legacy 档不走这里（见 compileScript）。 */
export function makeScriptStoreApi(store) {
  return {
    LOCATION_SCREEN,
    LOCATION_GLOBAL,
    // WE 文档名是 `delete`（成员调用合法）；DOM 名 `removeItem` 与语料别名 `remove` 都给。
    get: (k, dflt, location) => storeGet(store, k, dflt, location),
    set: (k, v, location) => { storeSet(store, k, v, location); },
    remove: (k, location) => { storeRemove(store, k, location); },
    has: (k, location) => storeHas(store, k, location),
    clear: (location) => { storeClear(store, location); },
    getItem: (k, dflt, location) => storeGet(store, k, dflt, location),
    setItem: (k, v, location) => { storeSet(store, k, v, location); },
    removeItem: (k, location) => { storeRemove(store, k, location); },
    delete: (k, location) => { storeRemove(store, k, location); },
    key: (i, location) => {
      const ks = storeKeys(store, location);
      const n = Math.trunc(Number(i));
      return (Number.isFinite(n) && n >= 0 && n < ks.length) ? ks[n] : null;
    },
    keys: (location) => storeKeys(store, location),
    get length() { return storeKeys(store, LOCATION_SCREEN).length; },   // length 只反映缺省位置
  };
}

// 容器（`createScriptCache()` 的返回对象 / 宿主 shared 对象）→ store。**同一壁纸一份**：
// 语料 `dd/3326873240` 的写法就是"脚本 A 写 `storageName`、脚本 B/C 读"（生产者-消费者）。
// 用 WeakMap 而不是往容器上加属性：`demo.html:2852` 会把 `cache.shared` **整个替换**成宿主的
// `scriptShared`（`sceneScriptCache.shared = scriptShared`）⇒ 挂在 shared 上的字段会被丢掉，
// 而挂在容器上的字段会进 `shared` 的键空间被脚本枚举到。
const SCRIPT_STORES = new WeakMap();
const SCRIPT_STORE_FALLBACK_CONTAINER = {};

/**
 * 解析本壁纸的存储实例。缺省（无 `?scriptstore=persist`）⇒ `null`（legacy 档）。
 * `opts.scriptStore` 显式给定（宿主/测试注入）时原样返回；否则按容器记忆化（同一壁纸一份）。
 */
export function scriptStoreFor(container, opts = {}) {
  if (opts && opts.scriptStore) return opts.scriptStore;
  const key = (container && typeof container === 'object') ? container : SCRIPT_STORE_FALLBACK_CONTAINER;
  if (SCRIPT_STORES.has(key)) return SCRIPT_STORES.get(key) || null;
  const store = makeScriptStore(opts);
  SCRIPT_STORES.set(key, store || null);
  return store;
}

function compileScript(source, opts = {}) {
  // 转译 ESM 导入/导出为 CommonJS
  let code = source;
  /* ①(P-239 2026-10-06) **两个 `\s*` 是必需的**：作者脚本是压缩过的，导入写法可能一个空格都没有
   *   （实测 `0923/2887099508` 的 11 个 `alpha` 载体全是 `import*as _0x1b8735 from'WEMath';`）。
   *   旧正则要求 `import\s+\*\s+as\s+` / `\s+from\s+` ⇒ 压缩形态**替换失败** ⇒ 原始 `import`
   *   留在代码里 ⇒ `new Function` 抛 "import declarations may only appear at top level of a module"
   *   ⇒ 整条脚本的 `exports` 为空、`initialized:false` ⇒ **该脚本永不运行**（真机读数：这 11 个条目的
   *   `error` 就是这个 parse error、`owners:[]`、`exported:[]`）⇒ 设置菜单的淡入淡出/心跳这类
   *   "只在 update 里改 alpha"的层全部哑火（报告 §2n 的菜单链就是这条）。 */
  code = code.replace(/import\s*\*\s*as\s*([\w$]+)\s*from\s*['"]([^'"]+)['"]/g, (m, name, mod) => {
    return `const ${name} = ${moduleGlobalFor(mod)};`;
  });
  code = code.replace(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g, (m, names, mod) => {
    const src = moduleGlobalFor(mod);
    return `const { ${names} } = ${src};`;
  });
  // ①(修复 2026-09-12 "翻译错误") 旧实现把 `export function X(...)` 改成 `__exports.X = function (...)` ——
  //   这是**函数表达式**，作用域里**没有** X 这个绑定：脚本内部自调 `X()`（例：3544152633
  //   的 init 里调 logTracks()）会抛 "X is not defined"。同理 `export let/const X = ...` 也被改成
  //   纯属性赋值 → 脚本内部引用 X 报未定义。现在**保留声明**，只追加导出登记。
  const exported = [];
  code = code.replace(/export\s+function\s+([\w$]+)\s*\(/g, (m, n) => { exported.push(n); return `function ${n}(`; });
  code = code.replace(/export\s+var\s+scriptProperties\s*=\s*([^;]+);/g, '__scriptProps = $1;');
  code = code.replace(/export\s+let\s+([\w$]+)\s*=\s*([^;]+);/g, (m, n, v) => { exported.push(n); return `let ${n} = ${v};`; });
  code = code.replace(/export\s+const\s+([\w$]+)\s*=\s*([^;]+);/g, (m, n, v) => { exported.push(n); return `const ${n} = ${v};`; });
  if (exported.length) code += '\n' + exported.map((n) => `__exports.${n} = ${n};`).join('\n') + '\n';
  code = code.replace(/export\s*\{([^}]+)\}/g, (m, names) => {
    return names.split(',').map((n) => {
      const nn = n.trim();
      const [orig, alias] = nn.includes(' as ') ? nn.split(' as ').map((s) => s.trim()) : [nn, nn];
      return `__exports.${alias} = ${orig};`;
    }).join('\n');
  });
  // scriptProperties 使用: 脚本内 `scriptProperties.x` 需指向构建的属性对象
  code = code.replace(/\bscriptProperties\b/g, '__scriptProperties');
  const shared = opts.shared || {};
  const ownerRef = opts.ownerRef || makeOwnerRef();
  // ①(P-127 A①) `scriptProperties` 的**活引用槽**：脚本顶层写法
  //   `const props = scriptProperties;`（语料实测**只有洛茜_11 这一处**）在 `vm.runInContext`
  //   期间求值，而属性值要等脚本自己声明完 `createScriptProperties()...finish()` 才拿得到 ——
  //   旧实现先给 `__scriptProperties = null`、run 完才赋值 ⇒ 顶层捕获恒为 **null** ⇒
  //   脚本首个 `props.xxx` 就抛 "Cannot read properties of null"，`init` 直接失败、实例被永久禁用
  //   （**这一条正好把洛茜_11 的 WEVector 缺陷挡在后面**：见 PATCHES P-127 的"先抛/后抛"实测）。
  //   官方运行时里 `scriptProperties` 是引擎提供的**活对象**，顶层捕获拿到的是同一个引用；
  //   这里把槽预先建好，属性值算出来后**写进同一个对象**，顶层捕获因此不再是 null。
  const scriptPropsSlot = {};
  const context = {
    __WEColor: WEColor,
    // ①(P-127 A①) 官方 WEVector 模块命名空间（独立实现见 scene-script-apis.js）
    __WEVector: WEVector,
    // ①(P-127 A①) 表外模块名的落点：空命名空间（读取得到 undefined，不别名到任何真模块）
    __WEEmptyModule: Object.freeze(Object.create(null)),
    // NSL WEMath 模块 (脚本 import * as WEMath from 'WEMath')
    __WEMath: {
      mix: (a, b, t) => a + (b - a) * t,
      lerp: (a, b, t) => a + (b - a) * t,
      clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
      smoothstep: (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1))); return t * t * (3 - 2 * t); },
      smoothStep: (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1))); return t * t * (3 - 2 * t); },
      // 角度换算 (733 Lens Flare 等用 WEMath.rad2deg; 缺失 → angles NaN → 组件渲染异常)
      // ①(P-127 A①) 与 `WEVector` 共用同一对常数（scene-script-apis.js 的 DEG2RAD/RAD2DEG）
      rad2deg: RAD2DEG,
      deg2rad: DEG2RAD,
      min: Math.min,
      max: Math.max,
      abs: Math.abs,
      floor: Math.floor,
      ceil: Math.ceil,
      pow: Math.pow,
      sqrt: Math.sqrt,
      sin: Math.sin,
      cos: Math.cos,
      PI: Math.PI,
    },
    __exports: {},
    __scriptProps: null, // export var scriptProperties = ... 写入
    __scriptProperties: scriptPropsSlot, // 脚本内 scriptProperties 引用（①P-127 A① 活槽，见上）
    // ①(P-127 A①) `scriptProperties` 一旦被 `const props = scriptProperties` 在**顶层**捕获，
    //   捕获到的是上面那个活槽对象 —— 槽必须在 run 之前就存在（否则捕获 null）。
    __scriptPropsSlot: scriptPropsSlot,
    Date, Math, JSON, Number, String, Boolean, Object, Array, Set, Map, Promise,
    // ①(P-121 A) `console` 换成**每沙箱一个**的门面（见 makeSandboxConsole）：脚本对 console 的
    //   写（含 `console.log = () => {}`）不再落到宿主的真 console 对象上；正常日志照旧转发到宿主。
    console: makeSandboxConsole(),
    // ①(P-121 A③) 宿主进程句柄显式 shadow（同一处真相：SANDBOX_HOST_ONLY_GLOBALS 的注释）
    ...SANDBOX_HOST_ONLY_GLOBALS,
    parseFloat, parseInt, isNaN, isFinite, Infinity, NaN, undefined,
    Vec3,
    Vec2,   // ①(2026-09-12) 上报错误 "Vec2 is not defined" → 补进沙箱
    // NSL 数学工具 (726 Launcher 等用 WEMath.mix/clamp/smoothStep)
    WEMath: {
      mix: (a, b, t) => a + (b - a) * t,
      clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
      smoothstep: (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1))); return t * t * (3 - 2 * t); },
      smoothStep: (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1))); return t * t * (3 - 2 * t); },
      rad2deg: RAD2DEG,
      deg2rad: DEG2RAD,
      min: Math.min,
      max: Math.max,
      abs: Math.abs,
    },
    // 鼠标/输入 (本地无鼠标 → 画布中心, 静止): NSL Dock 逻辑 (715 L126
    // input.cursorWorldPosition) 缺失 → update 抛错 → shared 值不计算
    input: {
      cursorWorldPosition: new Vec3((opts.canvasSize || { x: 3840 }).x / 2, (opts.canvasSize || { y: 2160 }).y / 2, 0),
      // ①(P-141) 官方 `IInput.cursorScreenPosition: Vec2`（d.ts L1385-1388
      //   "Position of the cursor on the screen in pixels."）。**上一个缺口修完后立刻暴露的下一个**：
      //   0917/3509243656 的 objects[8] 在 `getTrailPoint()`（曾抛 createLayer）之后走到
      //   `input.cursorScreenPosition.x` ⇒ 新 TypeError。本机无鼠标 ⇒ 屏幕坐标也取**画布中心**
      //   （与 cursorWorldPosition 同一口径：静止的鼠标在正中），是数值而不是 undefined。
      cursorScreenPosition: new Vec2((opts.screenResolution || opts.canvasSize || { x: 3840 }).x / 2, (opts.screenResolution || opts.canvasSize || { y: 2160 }).y / 2),
      // ①(P-141) 官方 `IInput.cursorLeftDown: Boolean`（d.ts L1390-1393）：同一接口的第三个成员，
      //   语料暂无使用者，但"接口成员缺失 ⇒ 读到 undefined"正是本批要收的错类 ⇒ 一并给 false。
      cursorLeftDown: false,
      cursorDelta: new Vec3(0, 0, 0),
      cursorVelocity: 0,
      mousePressed: false,
      mouseDelta: new Vec3(0, 0, 0),
    },
    // ①(P-127 A①) 把活槽交给构建器：属性值在链式声明执行时就逐个写进槽，
    //   于是声明之后的**顶层**读取拿到真值（不再是要等 run 结束才赋值的 null）。
    createScriptProperties: () => new ScriptPropertiesBuilder(opts.userProps, scriptPropsSlot),
    // ①(2026-09-12) 上报错误 "MediaPlaybackEvent is not defined"（3326873240 的
    //   mediaPlaybackChanged(event) 用 event.state !== MediaPlaybackEvent.PLAYBACK_STOPPED）
    //   → 提供枚举常量（无媒体集成时宿主不会回调，层保持 authored 可见性）。
    MediaPlaybackEvent: { PLAYBACK_STOPPED: 0, PLAYBACK_PLAYING: 1, PLAYBACK_PAUSED: 2, PLAYBACK_UNKNOWN: -1 },
    // ①(修复 2026-09-12) WE 的 localStorage 是**脚本 API**（get/set/remove/has/clear），
    //   与浏览器 Storage（getItem/setItem）不同名。此前沙箱里根本没有它：
    //     · 浏览器里标识符落到页面真实 localStorage → `localStorage.get is not a function`
    //       （真机上报：3554161528 / 3326873240 "init:localStorage.get is not a function"×N）
    //     · Node 里 undefined → 脚本 init 直接抛错
    //   这里提供沙箱内存实现（两种命名都支持）：脚本可正常读写，且**不碰**宿主页面的存储。
    // ①(P-153 2026-09-19) **缺省档逐位不变**（上面这条纪律不变）：只有显式 `?scriptstore=persist`
    //   时 `opts.scriptStore` 才非空 ⇒ 换成"同一壁纸共享 + 跨会话持久"的门面（见本文件上段
    //   `makeScriptStore` 的长注释；键前缀 `mpw.<包id>.`，后端 = 宿主 `window.localStorage`）。
    localStorage: opts.scriptStore ? makeScriptStoreApi(opts.scriptStore) : (() => {
      const m = new Map();
      const get = (k, dflt) => (m.has(String(k)) ? m.get(String(k)) : (dflt !== undefined ? dflt : null));
      return {
        get, set: (k, v) => { m.set(String(k), v); }, remove: (k) => { m.delete(String(k)); },
        has: (k) => m.has(String(k)), clear: () => m.clear(),
        getItem: (k) => get(k), setItem: (k, v) => { m.set(String(k), v); }, removeItem: (k) => { m.delete(String(k)); },
      };
    })(),
    // thisScene: NSL 场景引用 — getLayer(name) 返回图层包装 (读写真实场景对象)
    thisScene: opts.thisScene || makeSceneRef([]),
    // ①(P-41 A4 2026-09-13) `scene` 全局（日月循环 3326873240 实锤）：作者脚本（非 NSL 标准）
    //   用 `scene.getLayer(...)` + `scene.on("update", cb)` + `scene.timeVarying` 控制
    //   "实心占位层的显隐"（timeVarying=运行时在跑时间驱动内容 → 隐藏占位白层）。
    //   旧宿主三缺一 → 脚本 init 抛 ReferenceError 永久禁用 → 占位层保持 authored 可见
    //   → 整屏白块盖住主题。这里提供 scene = thisScene + on() + timeVarying（默认 true =
    //   官方运行时语义；`opts.timeVarying` 可显式覆盖）。update 回调在每次 update 趟末尾触发。
    scene: (() => {
      const base = opts.thisScene || makeSceneRef([]);
      const cbs = [];
      const ref = {
        enumerateLayers: base.enumerateLayers,
        getLayer: base.getLayer,
        getSceneObject: base.getSceneObject,
        on: (ev, cb) => { if (typeof cb === 'function') cbs.push(cb); return base },
        get timeVarying() { return opts.timeVarying !== undefined ? !!opts.timeVarying : true },
        set timeVarying(v) { if (opts) opts.timeVarying = !!v },
        __fireUpdate: () => { for (const cb of cbs) { try { cb() } catch { /* 官方容错：回调失败不拖垮宿主 */ } } },
      }
      return ref
    })(),
    engine: {
      // ①(P-141) `engine.registerAsset(file): IAssetHandle`（d.ts L1523 + 官方文档 IEngine 一节：
      //   "Reference the image model config file from `models` directory in the registerAsset call"
      //    并给出 `thisScene.createLayer(engine.registerAsset('models/x.json'))` 的官方用法）
      //   ⇒ 返回值必须带上 `file`，否则 createLayer(handle) 只能拿到一个空壳。
      //   旧实现返回 `{getAsset:()=>null}`（无 file）—— `createLayer(handle)` 会退化成空配置层。
      registerAsset: (file) => ({ file: String(file == null ? '' : file), getAsset: () => null }),
      canvasSize: opts.canvasSize || { x: 3840, y: 2160 },
      // ①(P-141) 官方 `IEngine.screenResolution: Vec2`（d.ts L1548-1551 "Screen resolution in pixels."）
      //   —— 语料 0917/3509243656 的鼠标视角脚本用 `engine.screenResolution.x/2` 归一化光标；
      //   缺了它 ⇒ `undefined.x` ⇒ 正是本批要收的 "reading 'x'"。宿主没给就与 canvasSize 同值
      //   （本地无真实窗口，这是唯一可用的"屏幕像素"口径），保证读到的是数字。
      screenResolution: opts.screenResolution || opts.canvasSize || { x: 3840, y: 2160 },
      runtime: opts.runtime || 0,
      frametime: opts.frametime || 1 / 60,
      userProperties: opts.userProps || {},
      // ①(P-220 C1 2026-09-29 · RE-57) `engine.changedUserProperties`（语料 233 次
      //   `changedUserProperties.hasOwnProperty(...)`）：官方语义 = **本次变更的用户属性名集合**。
      //   本仓属性变更走 applyUserProperties 重解析（无逐帧 diff）⇒ 缺省给**空对象**（hasOwnProperty
      //   恒 false = "本次无变更"，脚本主干照常跑）；宿主可通过 `opts.changedUserProps` 注入。
      changedUserProperties: opts.changedUserProps || {},
      // ①(P-220 C1 · RE-57) `engine.openUserShortcut(name)`（语料 190 次；官方 baseclasses.js 明文）：
      //   打开用户快捷方式指向的目标（文件/目录/网址/命令）⇒ 本仓无宿主文件系统 ⇒
      //   可调用、返回 false（可判定失败值），并记 `__mpwScriptApi.notImplemented` 台账（不抛——
      //   让调用它的脚本主干继续跑）。
      openUserShortcut: (name) => {
        try {
          const g = (typeof globalThis !== 'undefined') ? globalThis : {}
          g.__mpwScriptApi = g.__mpwScriptApi || { notImplemented: {} }
          g.__mpwScriptApi.notImplemented.openUserShortcut = (g.__mpwScriptApi.notImplemented.openUserShortcut || 0) + 1
        } catch (e) { /* 台账失败不影响脚本 */ }
        return false
      },
      // ①(P-220 C1 · RE-57) `engine.isObjectValid(obj)`（官方 baseclasses.js）：对象是否仍有效
      //   （官方跨帧句柄失效探测）⇒ 本仓句柄都是当帧活对象 ⇒ 非 null/undefined 即有效。
      isObjectValid: (o) => o != null,
      // ①(P-220 C1 · RE-57) 方向探测（官方 IEngine；2D 正交场景画布宽高比对半分界）
      isLandscape: () => {
        try { const cs = (typeof canvasSize !== 'undefined') ? canvasSize : (opts.canvasSize || { x: 3840, y: 2160 }); return (cs.x >= cs.y) } catch (e) { return true }
      },
      isPortrait: () => {
        try { const cs = (typeof canvasSize !== 'undefined') ? canvasSize : (opts.canvasSize || { x: 3840, y: 2160 }); return (cs.x < cs.y) } catch (e) { return false }
      },
      // NSL 库 (Mutsumi 788 等) 依赖编辑器环境探测; 缺失此方法 → 脚本中途抛错,
      // 后续 shared 赋值全部丢失 → 整个动画框架失效
      isRunningInEditor: () => false,
      // ①(RE-35) 未实现 API 的安全 shim（wer-ref 对 systemInfo/localIZE 零命中；
      //   缺失会让脚本在主干上抛 TypeError → 整个动画/时钟逻辑失效）。shim 后脚本可继续跑。
      localize: (s) => s,
      localIZE: (s) => s,
      systemInfo: { platform: 'windows', os: 'windows', isDesktop: true, isMobile: false, gpuVendor: '', gpuModel: '' },
      // ①(RE-35/RE-34) 音频反应：宿主提供真实 FFT 数据（opts.audioBuffers）时用之，
      //   否则退回全 0 数组（官方 registerAudioBuffers 的静默版；脚本主干仍可运行）
      // ①(P-131 批 D) **返回值是活视图**（同一 n 永远同一批 Float32Array，每帧原地更新，见上方
      //   `AUDIO_LIVE_VIEWS` 注释）：官方示例在脚本顶层调一次并长期持有 ⇒ 旧实现"每次新建数组"
      //   让顶层 `const` 拿到编译那一刻的全 0 快照（25 个包 / 386 次调用的音频响应因此是平线）。
      //   `average` 由本函数按官方口径逐段算（(left+right)/2），不采信宿主可能给的"总均值填满"。
      registerAudioBuffers: (n) => fillAudioView(liveAudioView(n), opts.audioBuffers),
      AUDIO_RESOLUTION_8: 8, AUDIO_RESOLUTION_16: 16, AUDIO_RESOLUTION_32: 32, AUDIO_RESOLUTION_64: 64,
      // ①(RE-34) WE 脚本 API `getVideoTexture` 的包装：宿主可提供真实控制句柄
      //   （play/pause/stop/setCurrentTime/isPlaying）；无视频纹理时返回 **noop 回退**
      //   （就是下面那 5 个方法的空实现 —— 方法集由 API 契约决定，属接口唯一表达），
      //   脚本主干照常运行。
      getVideoTexture: (name) => {
        if (typeof opts.getVideoTexture === 'function') {
          try { const v = opts.getVideoTexture(String(name || '')); if (v) return v } catch { /* 回退 noop */ }
        }
        return { play() {}, pause() {}, stop() {}, setCurrentTime() {}, isPlaying() { return false } }
      },
      // ①(RE-35) 平台探测常量 shim（第三方参考实现 wer-ref WPSceneScriptHost.cpp:895-905 同款语义）
      isDesktopDevice: () => true, isMobileDevice: () => false,
      isWallpaper: () => true, isScreensaver: () => false,
      // setTimeout 必须异步延迟 — 旧实现立即同步执行回调, NSL 库的调度递归
      // (动画推进/节流) 会同步无限递归卡死主线程
      setTimeout: (fn, ms) => {
        const t = setTimeout(() => { try { fn(); } catch { /* ignore */ } }, Math.max(0, Number(ms) || 0));
        return () => clearTimeout(t);
      },
      clearTimeout: (t) => { try { clearTimeout(t); } catch { /* ignore */ } },
      /* ①(P-141) `engine.setInterval(callback, delay?): Function`（d.ts L1519 + 官方文档 IEngine
       *   "Starts a repeating interval callback in milliseconds. Returns a new callback that can be
       *    used to stop the interval."）。语料 1 个包（洛茜_07 objects[8].alpha）用它做 500ms 闪烁。
       *   为什么不用宿主 `setTimeout/setInterval`（与上面的 setTimeout 不同）：
       *     · 真实 ms 定时器会在**脚本执行上下文之外**触发 ⇒ `thisLayer/thisObject` 指向别的层
       *       （ownerRef.current 是全局"当前脚本"槽），并且与 rAF 帧解耦 → 同一帧里写入竞争；
       *     · 本沙箱的官方对应物是"引擎每帧推进的脚本定时器"，所以按**场景时钟**推进（见
       *       `pumpEngineTimers`：时间基准 = 传进 `applySceneScripts` 的 `time` 秒数 = `engine.runtime`
       *       的同一条时间轴，与 demo 的"脚本节拍分层"无关），回调前恢复注册时的 owner。
       *   `delay` 缺省 0 ⇒ 官方默认值；我们按"每帧一次"处理（不做 while(0) 死循环）。
       *   `clearInterval` 官方 d.ts 未声明（同段的 `clearTimeout` 被注释掉并写 "Not implemented.
       *   Use returned function to clear."）⇒ **官方路径是调用返回的函数**；我们两个都给：
       *   返回的 stop 函数（带 `__timerId`，wer-ref 同款行为对照）与 `engine.clearInterval(handle)`。 */
      setInterval: (callback, delay) => {
        if (typeof callback !== 'function') return () => {};
        const table = engineTimerTable(context.engine);
        const id = ++table.seq;
        const rec = {
          id,
          cb: callback,
          delayMs: Math.max(0, Number(delay) || 0),
          accum: 0,
          owner: (ownerRef && ownerRef.ref) ? ownerRef.ref.current : null,
          ownerRef: ownerRef || null,
        };
        table.timers.set(id, rec);
        apiBump('timerScheduled');
        const stop = () => { clearEngineTimer(context.engine, id); };
        stop.__timerId = id;
        stop.__mpwInterval = true;
        return stop;
      },
      clearInterval: (handle) => clearEngineTimer(context.engine, handle),
    },
    shared,
    thisObject: ownerRef.makeObject(),
    thisLayer: ownerRef.makeLayer(),
  };
  context.globalThis = context;
  vm.createContext(context);
  try {
    vm.runInContext(code, context, { timeout: 2000 });
  } catch (e) {
    return { error: e.message, exports: context.__exports, scriptProps: context.__scriptProps, ownerRef };
  }
  // scriptProperties 构建: __scriptProps 是 builder 或对象
  let props = null;
  if (context.__scriptProps instanceof ScriptPropertiesBuilder) {
    props = context.__scriptProps.finish();
  } else if (context.__scriptProps && typeof context.__scriptProps === 'object') {
    props = context.__scriptProps;
  }
  // ①(P-127 A①) 官方语义：`scriptProperties` 是**引擎提供的活对象**。把算出来的属性值
  //   **写进脚本顶层已经捕获的那个槽**（`const props = scriptProperties`），再把 context 上的
  //   标识符也指向同一个槽 ⇒ 顶层捕获与函数内读取看到**同一份**默认值。
  //   槽里此前没有任何键（空对象），所以这是一次纯粹的"从 null 变成默认值表"，不会覆盖既有键。
  if (props && typeof props === 'object') {
    Object.assign(scriptPropsSlot, props);
    context.__scriptProperties = scriptPropsSlot;
  }
  return { exports: context.__exports, scriptProps: props, context, ownerRef, scriptPropsSlot };
}

// value → 脚本可操作对象 (Vec3 / number / 原样)
// 注意: 只有"纯数字"字符串才转 Vec3 (如 "0.5 0.5 0") — 文本类脚本的 value
// 是多词字符串 (如 "Text Layer"、"Good day!"), 误转 Vec3 会让 update 返回
// 的文本被 formatResult 格式化破坏 (FPS 计数器实测 "Text Layer" → "0.000000 ...")
function toValueObj(value) {
  if (typeof value === 'string') {
    const parts = value.trim().split(/\s+/);
    if (parts.length >= 2 && parts.every((p) => p !== '' && isFinite(Number(p)))) {
      const nums = parts.map(Number);
      return new Vec3(nums[0], nums[1], nums[2] || 0);
    }
    return value; // 非纯数字字符串 → 保持原样 (文本)
  }
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') return value;
  return value;
}
// 脚本返回值 → 存储值 (Vec3/{x,y,z} → "x y z")
function formatResult(result) {
  if (result instanceof Vec3 || (typeof result === 'object' && !Array.isArray(result) && 'x' in result && 'y' in result && 'z' in result)) {
    return `${Number(result.x).toFixed(6)} ${Number(result.y).toFixed(6)} ${Number(result.z).toFixed(6)}`;
  }
  return result;
}

// 创建脚本运行时: 缓存 Map + shared 对象 (每个 SceneRenderer 实例一个)
export function createScriptCache() {
  return { map: new Map(), shared: {} };
}

/* ═══════════════════════════════════════════════════════════════════════════════
 * ①(P-131 批 D 2026-09-19) **AudioBuffers 活视图** —— `engine.registerAudioBuffers(n)`
 *
 * 官方语义（一手出处：官方设计文档 `docs.wallpaperengine.io/en/scene/scenescript/reference/
 * class/AudioBuffers.html`，逐字要点）：
 *   · `left` / `right` / `average` 是 **Float32Array**，长度 = `registerAudioBuffers(resolution)`；
 *   · "Their contents will be **updated for every frame automatically**, so you can continuously
 *     read the audio levels from this object."；
 *   · 官方教程示例把返回值存进**顶层 `const`**、只在加载时调一次函数。
 * ⇒ 返回值必须是**每帧被原地写入的同一批数组对象**，不能是"调用那一刻的快照"。
 *
 * 旧实现的两个坑（本批修掉；P-131 有复现命令）：
 *   ① 每次调用 `new Array(len).fill(0)`（无宿主）/ 直接转发宿主返回的新数组 ⇒ 顶层 `const` 拿到的是
 *      **编译那一刻的全 0 快照**，此后永不更新 ⇒ 25 个包（386 次调用）的音频响应是一条平线；
 *   ② `average` 应当是**逐段的左右均值**（官方 "arithmetic mean of both channels"），而宿主侧
 *      （demo.html 的 `audioBuffers(n)`）曾把整条 128 元数组的**总均值**填满 n 段 ⇒ 即使有数据，
 *      `average[i]` 对任何 i 都是同一个数（语料 344 处读的就是 `average[frequency]`）⇒ 频谱条依然平。
 *   本函数按官方口径**自己**从 `left/right` 算 `average[i] = (left[i]+right[i])/2`，不信任宿主的 average。
 *
 * 为什么视图键只按 `n`（页内一份）而不是按宿主函数：官方 `engine` 是引擎级单例，页内只有一个音频源；
 *   宿主（demo.html）每帧传给 `applySceneScripts` 的是**新的箭头函数** ⇒ 用函数做键会每帧新建视图，
 *   活视图又会退化成快照。`n` 作键与"同一 resolution ⇒ 同一 AudioBuffers 实例"的官方口径也一致。
 * 为什么在本文件内自实现而不是 import `core/audio-band-array.mjs`：`core/` 与 `elysia/` 在产物里是
 *   **两个顶层目录**（`build-pages.mjs` 把 `core/*.mjs` 拷到站点根、`elysia/` 整目录保留）⇒ 跨目录
 *   相对说明符在线上会 404（同 `core/we-scene-bundle.js:4705` 的既定约束）。本文件的活视图逻辑是
 *   30 行的拷贝/重采样，不含算法口径（包络算法在 `core/audio-band-array.mjs`，渲染器侧调用）。
 * ═══════════════════════════════════════════════════════════════════════════════ */
const AUDIO_LIVE_VIEWS = new Map()   // resolution → 活视图（同一 n 永远同一对象）
const numOr0 = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0 };

/** 把 `src` 重采样进 `dst`（逐段均值；低频在前；越界当 0）。`dst` 是**已存在**的数组，原地写。 */
function writeResampled(dst, src) {
  const n = dst.length
  const m = (src && typeof src.length === 'number') ? Math.max(0, Math.trunc(src.length)) : 0
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * m / n), z = Math.max(a + 1, Math.floor((i + 1) * m / n))
    let s = 0
    for (let k = a; k < z; k++) s += numOr0(src[k])
    dst[i] = m ? s / (z - a) : 0
  }
}

/** 取（必要时新建）某一分辨率的活视图。长度非法按官方常用值 64 兜底，上限防脚本传 1e9。 */
function liveAudioView(n) {
  const len = Math.max(1, Math.min(4096, Math.trunc(Number(n)) || 64))
  let v = AUDIO_LIVE_VIEWS.get(len)
  if (!v) {
    v = {
      resolution: len,
      left: new Float32Array(len), right: new Float32Array(len), average: new Float32Array(len),
      kind: 'silent', hasSource: false, revision: 0,
    }
    AUDIO_LIVE_VIEWS.set(len, v)
  }
  return v
}

/** 用宿主这一次的返回值**原地**刷新视图（宿主返回新数组/同一数组都可）。 */
function fillAudioView(view, hostFn) {
  let b = null
  if (typeof hostFn === 'function') { try { b = hostFn(view.resolution) } catch { b = null } }
  const src = (b && typeof b === 'object') ? b : null
  let haveAvg = false
  if (src) {
    writeResampled(view.left, src.left || src.average)
    writeResampled(view.right, src.right || src.left || src.average)
    // 宿主**给了** average 就原样用（内缝契约：宿主给什么用什么；`elysia/media-host.js` 给的就是
    // 逐段 (left+right)/2）；没给才按官方文档的 "arithmetic mean of both channels" 补齐。
    if (src.average && typeof src.average.length === 'number' && src.average.length) {
      writeResampled(view.average, src.average)
      haveAvg = true
    }
  } else {
    view.left.fill(0); view.right.fill(0)
  }
  if (!haveAvg) for (let i = 0; i < view.resolution; i++) view.average[i] = (view.left[i] + view.right[i]) / 2
  // 数据源标注：宿主给了就用宿主的（demo.html 会标 analyser/mic/simulated/silent），
  // 没给则"宿主确实交了对象"视为有源（media-host 等）。
  view.kind = src && typeof src.kind === 'string' ? src.kind : (src ? 'host' : 'silent')
  view.hasSource = src ? (src.hasSource !== undefined ? !!src.hasSource : true) : false
  view.revision = (view.revision | 0) + 1
  return view
}

/**
 * 每帧刷新**所有**已注册分辨率的活视图（`applySceneScripts` 每帧开头调一次）。
 * 这是"脚本顶层只调一次 `registerAudioBuffers` 也照样每帧更新"的关键：脚本不再调用也没关系。
 * 返回被刷新的视图数（0 = 本帧没有脚本用过音频 ⇒ 零成本）。
 */
export function refreshAudioViews(hostFn) {
  for (const view of AUDIO_LIVE_VIEWS.values()) fillAudioView(view, hostFn)
  return AUDIO_LIVE_VIEWS.size
}

/** 诊断/测试用只读入口：某分辨率的活视图（不存在则 null，**不**创建）。 */
export function peekAudioView(n) {
  const len = Math.trunc(Number(n)) || 64
  return AUDIO_LIVE_VIEWS.get(len) || null
}

// 执行脚本值 (缓存模式): 编译一次, init 一次, 每帧 update(value) → 写回 obj.value
// opts: { canvasSize, userProps, shared, sceneObjects, thisScene, cache, runtime, frametime, ownerRef, phase }
//   phase 语义（②P-142 2026-09-23 起**严格分趟**，见 applySceneScripts 的调用点）：
//     'prepare' 只做"编译 + 模块顶层求值"，不跑任何生命周期（"先建全图"那一趟）
//     'init'    只跑 init 生命周期（init → applyUserProperties），**不跑 update**
//     'update'  只跑 update
//     'both'    兼容档：一次调用里跑完 init + update（旧默认值；本文件内已无调用方，留给外部直用）
function runScriptValueCached(scriptVal, time, opts = {}) {
  const phase = opts.phase || 'both';
  if (!scriptVal || typeof scriptVal !== 'object' || !('script' in scriptVal)) return;
  const src = scriptVal.script;
  const cache = opts.cache;
  /* ①(P-142 2026-09-23) **ownerRef 必须在编译之前指向本节点**：`compileScript` 里的
   *   `vm.runInContext(code, …)` 会把整段脚本执行一遍 ⇒ **模块顶层代码就在这一刻求值**
   *   （作者把 `shared.xxx = …` 挂在顶层的那种"生产者"全都发生在这里）。顶层代码里读到的
   *   `thisLayer/thisObject` 由 `ownerRef.current` 决定，而旧实现把 `setOwner` 放在编译**之后** ⇒
   *   首次编译时顶层看到的是**上一个脚本节点留下的对象**（与 P-60 同一根因，只是发生位置在
   *   模块顶层而不是某个 getter 里）。
   *   为什么现在必须修：`applySceneScripts` 新增了 prepare 趟（一次性求值所有节点的模块顶层），
   *   于是"编译时机"从"第一次被选中执行时"变成"第一帧的头一趟" ⇒ 这个错位会命中更多脚本。 */
  const buildById = (r) => {
    try {
      /* ①(P-174 2026-09-24) **byId 必须挂在 `ref` 上，不是挂在 makeOwnerRef() 的返回壳上**。
       *   现场（本批普查实测）：`makeOwnerRef()` 返回 `{ ref, makeLayer, makeObject, layerRefObj, setOwner }`，
       *   而读它的是 `layerRef()`/`layerRefFor()` 里的 `ref.byId`（**内层** `ref`）—— 旧实现只给**外层壳**
       *   挂了 `byId` ⇒ `ref.byId` 恒 undefined ⇒
       *     · `thisLayer.getParent()` **永远**返回 `emptyLayerRef()`（`name: ''`、`id: -1`）；
       *     · `layerRefFor(obj)`（F3）**整条路径不可达**（唯一调用点传进去的永远是 null）。
       *   语料面：`getParent` 在 6 个包/117 处被调用，含 `thisLayer.getParent().getParent()` 链式与
       *   `parent.getTransformMatrix().m[13] > engine.canvasSize.y/2`（3326873240），全部读到空引用。
       *   修法：目标对象 = 内层 `ref`（有则用），并保留外层壳上的同一份（既有读法不破）；"先到先得"
       *   语义不变（同一份场景对象表只建一次）。 */
      if (!r) return;
      const inner = (r.ref && typeof r.ref === 'object') ? r.ref : r;
      if (!inner.byId) {
        const m = new Map();
        for (const o of (opts.sceneObjects || [])) if (o && o.id !== undefined) m.set(o.id, o);
        inner.byId = m;
        if (r !== inner) r.byId = m;
      }
    } catch { /* ignore */ }
  };
  buildById(opts.ownerRef);
  if (opts.ownerRef && opts.ownerRef.setOwner) opts.ownerRef.setOwner(opts.currentObject || null);
  let entry = cache ? cache.get(src) : null;
  if (!entry) {
    const compiled = compileScript(src, {
      canvasSize: opts.canvasSize,
      userProps: opts.userProps,
      // ①(P-220 C1) `engine.changedUserProperties` 的宿主注入通道（缺省 {} = 本次无变更）
      changedUserProps: opts.changedUserProps,
      shared: opts.shared,
      thisScene: opts.thisScene,
      ownerRef: opts.ownerRef,
      runtime: opts.runtime != null ? opts.runtime : time,
      frametime: opts.frametime,
      audioBuffers: opts.audioBuffers,
      getVideoTexture: opts.getVideoTexture,
      // ①(P-153) 本壁纸的脚本存储（缺省 `null` = legacy 逐沙箱 Map；`?scriptstore=persist` 时才非空）
      scriptStore: opts.scriptStore,
    });
    entry = {
      exports: compiled.exports || {},
      error: compiled.error,
      scriptProps: compiled.scriptProps,
      // ①(P-127 A①) 脚本顶层捕获的 `scriptProperties` 活槽（对象级覆盖要写回这里，见下方）
      scriptPropsSlot: compiled.scriptPropsSlot || null,
      context: compiled.context || null,
      initialized: false,
      ownerRef: compiled.ownerRef,
      // ①(P-62) 事件派发 (dispatchScriptEvent) 要用：该脚本源被哪些对象用过（插入序 = 首次
      //   运行顺序），以及最后一次运行的 owner。缓存按**脚本源**共享 → 同一源码被 N 个层
      //   复用时只有一个 entry：官方语义是"每层一个脚本实例、每个实例都收到回调"，
      //   所以派发时对 owners 里每个对象各调一次（幂等赋值类回调无副作用，而
      //   `thisLayer.visible = …` 这类必须逐层生效）。
      owners: new Set(),
      lastOwner: null,
    };
    if (cache) cache.set(src, entry);
  }
  const exports = entry.exports;
  if (entry.error && !exports.update && !exports.applyUserProperties && !exports.init) {
    return; // 脚本编译失败且无可用导出 → 保持静态 value
  }
  // 对象级 scriptproperties 覆盖 (WE 编辑器保存的用户调整 + user 属性绑定):
  // scene.json 对象上的 scriptproperties 是设计器存盘值, 格式 {name: value} 或
  // {name: {user: 用户属性名, value: 默认}} — 运行时读 userProps 当前值 (用户
  // 在 project.json 改过则生效), 无该键回退 value。脚本编译期 createScriptProperties
  // 只含脚本内声明的默认, 不含对象存盘覆盖 → 不应用则时钟 12/24h、分隔符等
  // 全用脚本默认 (用户调整丢失)。缓存按 src 共享, context.__scriptProperties
  // 每次按当前对象重新覆盖 (同脚本多对象不同覆盖不串)。
  if (scriptVal.scriptproperties && entry.context) {
    const props = Object.assign({}, entry.scriptProps || {});
    // ①(修复 2026-09-12) scene.json 里对象的 `scriptproperties` 常是**JSON 字符串**
    //   （例：Shiroko 时钟层 '{"delimiter":":","showSeconds":false,"use24hFormat":true}'）。
    //   旧实现对字符串做 Object.entries → 得到 '0','1','2'… 索引键，作者存盘的覆盖全部丢失。
    //   这里先尝试解析成对象再套用（解析失败保持旧行为）。
    let sp = scriptVal.scriptproperties;
    if (typeof sp === 'string') { try { const j = JSON.parse(sp); if (j && typeof j === 'object') sp = j } catch { /* 非 JSON → 原样 */ } }
    for (const [k, v] of Object.entries(sp)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (typeof v.user === 'string' && v.user) {
          const uv = (opts.userProps || {})[v.user];
          props[k] = uv !== undefined && uv !== null ? uv : v.value;
        } else if ('value' in v) {
          props[k] = v.value;
        } else {
          props[k] = v;
        }
      } else {
        props[k] = v;
      }
    }
    // ①(P-127 A①) 覆盖结果要落进**同一个活槽**（`scriptPropsSlot`），否则脚本顶层
    //   `const props = scriptProperties` 捕获到的那份引用永远只有脚本默认值、看不到对象级覆盖。
    //   槽是"全等镜像"语义：先删掉不在本次 props 里的键，再整份写入 ——
    //   这样缓存按脚本源共享时，上一个对象的覆盖键不会漏给下一个对象。
    const slot = entry.scriptPropsSlot || entry.context.__scriptProperties;
    if (slot && typeof slot === 'object') {
      for (const k of Object.keys(slot)) if (!Object.prototype.hasOwnProperty.call(props, k)) delete slot[k];
      Object.assign(slot, props);
      entry.context.__scriptProperties = slot;
    } else {
      entry.context.__scriptProperties = props;
    }
  }
  // ownerRef 是首次编译时创建的共享代理 (entry 持有); setOwner 指向当前脚本
  // 所属对象 — 缓存共享条目在多个对象间不串
  const ownerRef = entry.ownerRef;
  // ①(2026-09-12) 给 ownerRef 挂 id→对象 表：thisLayer.getParent() 要靠它拿父层（否则父链断）
  buildById(ownerRef);
  // ①(P-142) 编译前已对 `opts.ownerRef` 绑过一次；若 entry 自己的代理不是同一个（调用方没传
  //   ownerRef ⇒ compileScript 现造一个），这里补绑一次，保证沙箱里的 thisLayer 与 entry 一致。
  if (ownerRef && ownerRef !== opts.ownerRef && ownerRef.setOwner) ownerRef.setOwner(opts.currentObject || null);
  // ①(P-62) 记下本次运行的 owner，供 dispatchScriptEvent 还原（见 entry 创建处注释）
  entry.lastOwner = opts.currentObject || null;
  if (entry.owners && opts.currentObject) { try { entry.owners.add(opts.currentObject) } catch { /* ignore */ } }
  // ①(N7 2026-09-14) **真实 frametime**：`engine` 对象在**编译期**构造（缓存按脚本源共享），
  //   旧实现只在那一刻写入 opts.frametime（demo 从不传 → 恒 1/60，语料里 22 个容器用
  //   `engine.frametime` 做平滑/积分）。节拍提到 ≥30Hz 后必须给它真值：每次运行前把缓存
  //   context 上的 engine.frametime 刷新为调用方给的"上一帧真实秒数"。
  if (entry.context && entry.context.engine && opts.frametime !== undefined && opts.frametime !== null) {
    const ft = Number(opts.frametime);
    if (isFinite(ft) && ft >= 0) entry.context.engine.frametime = ft;
  }
  // ①(RE-35 官方错误矩阵 WPSceneScriptHost:8802-8812 / :9503-9508)：
  //   · init 失败 → **永久禁用该实例**（避免每帧把同一根因变成噪音），authored 值保持
  //   · update 失败 → 只跳过本帧、保留 last-known 值、下一帧继续
  //   · 返回 undefined → 不写属性（authored 值保持）
  if (entry.disabled) return;
  // ①(P-142) **prepare 趟到此为止**：上面 `cache.get(src)` / `compileScript(src)` 已经把脚本编译并
  //   执行了模块顶层（= 生产者挂 `shared.xxx` 的地方），生命周期（init/applyUserProperties/update）
  //   一概不跑。它就是"先建全图、再跑生命周期"里的第一趟。
  if (phase === 'prepare') return;
  /* ①(P-142) **无缓存档**（`?scriptcache=0` 旧路径）逐位保留旧跑序：没有缓存 ⇒ 每趟都现编译出一个
   *   新 entry、`initialized` 恒 false、跨趟状态不存在。旧实现在这里（update 趟）直接 return
   *   （"init 趟还没跑过"），于是无缓存档的全部生命周期都发生在 **init 趟**里（init → aup → update）。
   *   若不给这条缝：update 趟会"就地补 init 再 update"，init 就变成每帧两次。 */
  if (phase === 'update' && !cache && !entry.initialized) return;
  const valueObj = toValueObj(scriptVal.value);
  /* ①(P-142 2026-09-23) **init 生命周期**：每个实例一次，且**只在 init 趟**跑。
   *   与旧实现的差异（都是为了"跑序"这个根因）：
   *     · 旧实现只在"脚本导出 init 且它没抛错"时置 `entry.initialized = true` ⇒ **只有 update 的
   *       脚本**永远 initialized=false ⇒ 它唯一的执行点变成 init 趟里那次"越界的 update"
   *       （旧实现的 update 段不受 phase 约束）。现在**无论有没有导出 init**，跑完这一趟都置位
   *       ⇒ update 一律发生在 update 趟，消费脚本不再抢在生产者 init 之前。
   *     · `phase === 'update'` 且实例尚未 init 时（调用方**只**跑 update 趟，不走本文件的两趟协议），
   *       旧实现直接 `return`（该实例永不更新）；现在**就地补一次 init 生命周期**，保证"先 init
   *       后 update"在任何调用路径上都成立（官方：所有实例先初始化，再逐帧 update）。 */
  if (!entry.initialized) {
    if (typeof exports.init === 'function') {
      try {
        // NSL init(value): 一次性初始化 (如启动骨骼动画), 返回新值
        EXPLICIT_PROP_WRITE.delete(scriptVal);          // ①(P-143) 防上一帧遗留（一次调用一次判定）
        const r = exports.init(valueObj);
        const wroteInit = EXPLICIT_PROP_WRITE.has(scriptVal);
        EXPLICIT_PROP_WRITE.delete(scriptVal);
        // ①(P-143) 作者在 init 里显式写过 thisLayer.origin/scale ⇒ 返回值（常是写前快照）**不回滚**它
        if (r != null && !wroteInit) scriptVal.value = formatResult(r);
      } catch (e) {
        entry.disabled = true;
        entry.initError = (e && (e.stack || e.message)) || String(e);
        if (typeof opts.onError === 'function') { try { opts.onError('init', e) } catch { /* ignore */ } }
        return;
      }
    }
    entry.initialized = true;   // ← 没有 init 导出也算"init 生命周期已完成"（见上方长注释）
  }
  /* applyUserProperties: NSL 语义在用户属性变化时调用 (715 Dock 逻辑的
   * shared.minScale/maxScale/radius 都在这里计算)。本地无变化检测 → 首次执行一次 (属性固定, 幂等);
   * 不执行则依赖它的脚本读到 undefined。
   * ⚠ ①(P-142) **这个门必须独立于 `entry.initialized`**：`invalidateUserProps(cache)`（P-61 属性面板
   *   改值后调的那个安全阀，见本文件末尾）只清 `userPropsApplied`、**不清** `initialized` ⇒ 若把它
   *   塞进上面那个 `if (!entry.initialized)` 块里，面板改值后再也不会生效（demo.html:1051 的接线
   *   依赖这条缝）。位置与旧实现一致：init 之后、update 之前，同一节点内只调一次。 */
  if (!entry.userPropsApplied && typeof exports.applyUserProperties === 'function') {
    try {
      // ①(TIME-VARIATION 2026-09-14 第5项) 官方语义：changed = 当前用户属性表
      //   （project.json general.properties 展开 value）。旧实现恒传 {} → 依赖它的脚本
      //   （3326873240 后处理层：timevarying/display/morningtime…）永远读不到 →
      //   update() 两个分支都不成立 → 5 个时段层停在 authored 状态（只剩 morning）。
      //   ?nouserprops=1 可回退旧行为对照。
      exports.applyUserProperties((typeof opts.noUserProps === 'function' && opts.noUserProps()) ? {} : (opts.userProps || {}));
      entry.userPropsApplied = true;
    } catch (e) {
      entry.userPropsApplied = true;   // 失败不重试（与官方"调用点独立容错"一致）
      if (typeof opts.onError === 'function') { try { opts.onError('applyUserProperties', e) } catch { /* ignore */ } }
    }
  }
  // ①(P-142) **update 只在 update 趟跑**（'both' 兼容档也跑）。走到这里（phase==='update'）时，
  //   本帧的 init 趟已经把**所有**节点的 init 跑完 ⇒ "生产者晚于消费者"在结构上不可能再发生。
  //   例外：**无缓存档的 init 趟**照旧要顺带跑 update（见上方"无缓存档"注释：那一档的生命周期
  //   全在 init 趟里发生，少了这一句就永远不更新）。
  if (phase === 'init' && cache) return;
  if (typeof exports.update === 'function') {
    try {
      EXPLICIT_PROP_WRITE.delete(scriptVal);          // ①(P-143) 防上一帧遗留（一次调用一次判定）
      const result = exports.update(valueObj);
      const wroteUpdate = EXPLICIT_PROP_WRITE.has(scriptVal);
      EXPLICIT_PROP_WRITE.delete(scriptVal);
      /* ①(P-143) **显式属性写优先于返回值**：作者在同一次 update 里 `thisLayer.origin = …` 时，
       *   返回值往往正是**赋值前的快照**（`return value`）⇒ 直接写回会把显式赋值回滚。
       *   旧实现靠"赋值把节点整只换掉"侥幸得到同一结果（代价是作者脚本永久停摆，见
       *   EXPLICIT_PROP_WRITE 定义处注释）；改 nodeWrite 之后必须在这里显式补上这条契约
       *   （tests/script-owner-live-test.mjs T3b 钉的就是它）。 */
      if (result != null && !wroteUpdate) scriptVal.value = formatResult(result);
    } catch (e) {
      entry.updateErrors = (entry.updateErrors || 0) + 1;
      if (typeof opts.onError === 'function') { try { opts.onError('update', e) } catch { /* ignore */ } }
    }
  }
}

// 扫描并执行场景所有 {script, value} 对象 (更新到原对象树)
// opts: { canvasSize, userProps, scriptCache, renderObjects, runtime }
export function applySceneScripts(scene, time, opts = {}) {
  const cache = opts.scriptCache && opts.scriptCache.map ? opts.scriptCache : null;
  const shared = (cache ? cache.shared : null) || opts.shared || {};
  /* ①(P-174) 发布"本帧的用户属性活表"给模块级读路径（`ISoundLayer.volume` 的用户绑定优先需要它：
   *   `volume` 是 `{user:"bgm", value:1}` 时屏幕上的数是用户属性值，不是节点 value；依据见
   *   LAYER_REF_MEMBER_ACCESSORS 上方长注释）。**帧内有效、帧末清空**：帧外（测试直接
   *   `makeSceneRef()` 读、宿主在两次 apply 之间读）没有"当前用户属性"这个概念 ⇒ 退回节点 value，
   *   行为确定、不会把上一帧的表泄漏出去。 */
  noteUserProps(opts.userProps);
  // ①(P-131 批 D) **每帧先刷新音频活视图**（脚本顶层只调一次 `registerAudioBuffers` 时，
  //   这是"内容随帧变化"的唯一驱动点）。没有脚本用过音频 ⇒ Map 为空、零成本。
  refreshAudioViews(opts.audioBuffers);
  // 渲染对象列表 (this.objects, 已烘焙) — 脚本写这些对象 → 渲染直接生效
  // ①(P-141) 旧实现 `(scene.objects||[]).map(o=>o)` 是**浅拷贝** ⇒ `thisScene.createLayer()/sortLayer()`
  //   在"调用方没给 renderObjects"时只改到副本：层表（enumerateLayers/getLayerIndex）看得见，
  //   宿主 `scene.objects` 看不见。demo.html 传了 renderObjects（与 scene.objects **同一个数组**）
  //   所以浏览器里本来就一致；这里直接取原数组，让两边的语义相同（数组本身不被替换，
  //   `opts.renderObjects` 优先级一字不变）。
  const sceneObjects = opts.renderObjects || (Array.isArray(scene.objects) ? scene.objects : []);
  // ①(P-127 A①) 调用方可以**自带** thisScene 引用（此前这里无条件 `makeSceneRef(sceneObjects)`，
  //   `opts.thisScene` 在本函数里被静默忽略 —— 而 compileScript 那一层是认它的）。
  //   加这条缝是为了让"某个 `thisScene` 方法尚未实现"的缺口**可以被测试精确隔离**，而不是被
  //   更早的错误掩盖（P-127 的 WEVector 复现就靠它：桩只补 makeSceneRef 里缺的那几个方法）。
  //   不给 opts.thisScene 时行为**逐位不变**（走原来的 makeSceneRef）。
  const ownerRef = makeOwnerRef();
  // ①(P-153 2026-09-19) 本壁纸的脚本存储实例（容器 = 脚本缓存对象，缺省退回宿主 shared 对象；
  //   两者都没有时用一个模块级容器 ⇒ "同一壁纸的全部脚本共享一份"这条语义在任何宿主下都成立）。
  //   缺省（无 `?scriptstore=persist`）恒为 `null` ⇒ 下面整条链路与改动前逐位相同。
  const scriptStore = scriptStoreFor(cache || shared, opts);
  // ①(P-141) `IScene.getLayerIndex(thisLayer)` 必须能把 ownerRef 的那个层引用实例还原成场景对象
  //   （ownerRef 的引用是惰性读 ref.current 的，所以两条缝都要给：实例身份 + 当前对象）。
  // ①(P-232) 当前帧时间（getCameraTransforms().zoom 的动画求值用）；帧外/测试直读 = null ⇒ 静态值。
  const frameTimeRef = { current: (typeof time === 'number' && isFinite(time)) ? time : null };
  const thisScene = opts.thisScene || makeSceneRef(sceneObjects, {
    ownerLayerRef: () => ownerRef.layerRefObj(),
    ownerObj: () => ownerRef.ref.current,
    // ①(P-142) `thisScene.getCameraTransforms()` 的真值来源：scene.json 根的 `camera`/`general`
    //   （不是 objects 的一部分 ⇒ 必须单独给钩子；理由与字段出处见 makeSceneRef 里的实现注释）。
    camera: () => scene,
    // ①(P-232) 当前帧时间：getCameraTransforms().zoom 的动画求值要用（applySceneScripts 的 time）。
    frameTimeRef,
  });
  /* ①(P-143) `originalOrigin` 的 authored 快照**必须在任何脚本跑之前**抓（含 prepare 趟的模块顶层代码
   *   —— 作者完全可以在顶层写 `thisLayer.origin = …`）。`makeSceneRef()` 那条路径已经在工厂里抓过
   *   （幂等）；这里再显式抓一次是为了 `opts.thisScene` 由调用方自带（测试隔离档）时也成立。 */
  snapshotAuthoredOrigins(sceneObjects);
  const nodes = [];
  /* ①(P-143 2026-09-23) `owner` = 该脚本节点所属的**层**（沙箱里 `thisLayer`/`thisObject` 的绑定）。
   *   旧实现 `if (Array.isArray(obj)) obj.forEach((x) => collect(x, x))` 对**每个**数组都把元素升级成
   *   owner —— 对 `scene.objects` 那一层恰好正确（元素就是层），但嵌套数组（`effects[]`、`passes[]`、
   *   `animationlayers[]`）也一样 ⇒ 绑在 `objects[85].effects[0].visible` 上的脚本，`thisLayer` 变成
   *   了**那个 effect 条目**。真包实测（0923/3122339805 `thisLayer.getEffect(0).visible=false`）：
   *   effect 条目上没有 `effects` 字段 ⇒ `getEffect` 解析不到 ⇒ 作者的开关静默失效（计
   *   `getEffectUnresolved`）。官方语义是无论脚本绑在层的哪个属性上，`thisLayer` 都是**那一层**
   *   （docs: "You can access this interface through the global object thisLayer … to interact with
   *   the current layer"），所以只有 `objects` 这个数组的元素才是层 owner。 */
  const collect = (obj, owner, isLayerArray) => {
    if (!obj || typeof obj !== 'object') return;
    if ('script' in obj && 'value' in obj && typeof obj.script === 'string') { nodes.push([obj, owner || null]); return; }
    if (Array.isArray(obj)) { obj.forEach((x) => collect(x, isLayerArray ? x : owner, false)); return; }
    for (const k of Object.keys(obj)) collect(obj[k], owner, k === 'objects' && Array.isArray(obj[k]));
  };
  collect(scene, null, false);
  const run = (obj, owner, phase) => runScriptValueCached(obj, time, {
    canvasSize: opts.canvasSize,
    userProps: opts.userProps,
    // ②(偏差记录 TIME-VARIATION S1) 补丁原文只在 runScriptValueCached 里读 opts.noUserProps，
    //   但那个 opts 是这里新构造的对象 → 不转发的话 ?nouserprops=1 回退开关静默失效。
    noUserProps: opts.noUserProps,
    shared,
    sceneObjects,
    thisScene,
    cache: cache ? cache.map : null,
    ownerRef,
    currentObject: owner,
    runtime: opts.runtime,
    frametime: opts.frametime,
    onError: opts.onError,
    audioBuffers: opts.audioBuffers,
    getVideoTexture: opts.getVideoTexture,
    // ①(P-153) 透传到 compileScript 的沙箱 env（`localStorage` 门面的后端；null = legacy 档）
    scriptStore,
    // ①(P-220 C1) `engine.changedUserProperties` 的宿主注入通道（runScriptValueCached ⇒ compileScript）
    changedUserProps: opts.changedUserProps,
    phase,
  });
  // ①(2026-09-12 官方语义) **先跑完所有 init，再跑 update**：旧实现是"每个对象 init+update 交替"，
  //   于是"生产者脚本 init 里写 shared.miPrimaryColor、消费者脚本 update 里读它"的壁纸
  //   在首帧会读到 undefined（上报：`update:Cannot read properties of undefined (reading 'x')`）。
  //   第三方参考实现 wer-ref 的 WPSceneScriptHost 是先初始化全部脚本实例，再逐帧 update。
  // ①(N7 2026-09-14) 脚本节拍分层：`opts.nodeFilter(obj, owner)` 选中要跑的脚本节点子集
  //   （demo 用它把"文本/时钟/帧率类"脚本提到 ≥30Hz，其余保持 4Hz 控 CPU）。
  //   未提供 = 全跑（旧行为）。`opts.fireUpdate === false` 时不触发 scene.on('update') 回调
  //   （高频子集趟不重复触发作者 update 回调，避免回调里的重活被放大 8 倍）。
  const nodeFilter = (typeof opts.nodeFilter === 'function') ? opts.nodeFilter : null
  const pick = (obj, owner) => (!nodeFilter || !!nodeFilter(obj, owner))
  /* ⓪(P-142 2026-09-23) **prepare 趟：先建全图** —— 把所有节点的脚本**编译/求值**一遍，
   *   **不跑任何生命周期**、也**不看 nodeFilter**（节拍过滤管的是"这一趟跑不跑脚本"，
   *   不管"脚本的模块顶层要不要求值"）。
   *   为什么必须补这一趟（真包复现，见 tests/script-phase-order-test.mjs）：
   *     作者常把 `shared.xxx = fn` / `shared.xxx = value` 挂在**脚本模块顶层**（模块顶层在
   *     `compileScript` 的 `vm.runInContext` 里求值）。而编译是**按首次使用惰性发生**的：
   *     节点顺序里靠后的脚本，模块顶层就晚于靠前节点的生命周期才被求值 ⇒
   *     `wallpaperE` 的 NSL 库包（`0923/3521337568`、`0923/3653641024`）里，
   *     `objects[20].animationlayers[*].visible` 的 **init** 调 `shared.offsetedStartAni(...)`，
   *     而定义它的 `objects[29].visible`（NSL 主脚本，第 1459 行顶层赋值）还没编译 ⇒
   *     `shared.offsetedStartAni is not a function`、init 失败、实例被永久禁用。
   *   官方等价语义：脚本实例在场景载入时全部建立（模块顶层求值），随后才跑生命周期。
   *   代价：一次 `cache.get(src)`（按源码记忆化，第二帧起全部命中缓存、不重复求值）。 */
  for (const [obj, owner] of nodes) {
    try { run(obj, owner, 'prepare') } catch (e) { if (typeof opts.onError === 'function') try { opts.onError('prepare', e) } catch { /* ignore */ } }
  }
  /* ①(P-142) init 趟：**只跑 init**（+ 每实例一次的 applyUserProperties）+ ①(2026-09-12 官方语义)
   *   先跑完所有 init，再跑 update。旧实现虽然写了两趟，但 `runScriptValueCached` 里的 update 调用
   *   **不受 phase 约束** ⇒ init 趟会按节点顺序顺带跑一遍 update，"消费者（只有 update 的脚本）先于
   *   生产者（更靠后节点的 init）"因此真实发生（真包 `wallpaperE/佩丽卡/佩丽卡1_03.mpkg`：生产者
   *   `objects[6].origin` 的 init 写 `shared.jpc_clockPosition`，消费者 `objects[3..5].origin` 只有
   *   update、且排在前面 ⇒ 首帧 `reading 'x'`）。现在两趟严格分开，跑序由结构保证。
   *   第三方参考实现 wer-ref 的 WPSceneScriptHost 同样是"先初始化全部脚本实例，再逐帧 update"。 */
  for (const [obj, owner] of nodes) { if (!pick(obj, owner)) continue; try { run(obj, owner, 'init') } catch (e) { if (typeof opts.onError === 'function') try { opts.onError('init', e) } catch {} } }
  /* ②(P-142) update 趟：**只跑 update**。走到这里时全图已建、所有节点的 init 已跑完。 */
  for (const [obj, owner] of nodes) { if (!pick(obj, owner)) continue; try { run(obj, owner, 'update') } catch (e) { if (typeof opts.onError === 'function') try { opts.onError('update', e) } catch {} } }
  /* ③(P-142) `thisScene.destroyLayer()` 的落地点。官方 d.ts L1270-1272 逐字：“Remove a layer by
   *   name, index or object. **The layer is removed after all scripts on that frame updated.**”
   *   ⇒ 本帧两趟都跑完之后才真从层表里摘掉（提前摘会让同帧后续脚本的 `getLayerIndex` 看到位移后的
   *   下标；层表就是宿主传进来的 `renderObjects` = `scene.objects` 那个数组）。 */
  if (typeof thisScene.__flushDestroyedLayers === 'function') {
    try { thisScene.__flushDestroyedLayers() } catch { /* ignore */ }
  }
  // ①(P-141) **每帧推进脚本定时器**（`engine.setInterval` 的驱动点）。放在 init/update 两趟**之后**：
  //   本帧新注册的定时器能在同一帧拿到时钟原点（`lastClock = time`），下一帧起按真实 Δt 累积 ——
  //   放在趟前会让"首帧注册"白丢一帧的时间（μs 级代码，语义差别却是一整帧）。
  //   时间基准 = 场景时钟 `time`（秒，= `engine.runtime` 的同一条时间轴），与 demo 的"脚本节拍分层"
  //   无关（慢档 4Hz / 快档 30Hz 下 Δt 都正确）；`time` 不可用时退化用 `opts.frametime`。
  //   没有脚本排过定时器 ⇒ ENGINE_TIMERS 里没有表、零成本。
  if (cache && cache.map) {
    for (const entry of cache.map.values()) {
      try { pumpEngineTimers(entry && entry.context && entry.context.engine, time, opts.frametime) } catch { /* ignore */ }
    }
  }
  // ①(P-41 A4) `scene.on("update", cb)` 注册的回调在每帧 update 趟末尾触发（官方 update 事件语义）
  if (opts.fireUpdate !== false && cache && cache.map) {
    for (const entry of cache.map.values()) {
      try { if (entry && entry.context && entry.context.scene && typeof entry.context.scene.__fireUpdate === 'function') entry.context.scene.__fireUpdate() } catch { /* ignore */ }
    }
  }
  noteUserProps(null);   // ①(P-174) 帧末清空（见函数开头：帧外没有"当前用户属性"这个概念）
  return shared;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ①(P-62) 事件广播：把宿主侧事件投递给**所有已编译脚本**里同名导出函数
//
// 官方语义（语料 + 官方 d.ts 双证）：
//   WE 引擎把"当前正在播放的媒体"以**回调**推给壁纸脚本，不是轮询：
//     export function mediaPropertiesChanged(event)   // {title,artist,subTitle,albumTitle,albumArtist,genres,contentType}
//     export function mediaThumbnailChanged(event)    // {hasThumbnail,primaryColor,secondaryColor,tertiaryColor,textColor,highContrastColor}
//     export function mediaPlaybackChanged(event)     // {state}（MediaPlaybackEvent.PLAYBACK_*）
//     export function mediaTimelineChanged(event)     // {position,duration}
//     export function mediaStatusChanged(event)       // {enabled}
//   官方插入菜单（wallpaper_engine/ui/dist/scripts/scripts.js 的 "mediaPropertiesChanged/
//   mediaThumbnailChanged/mediaPlaybackChanged/mediaTimelineChanged/mediaStatusChanged" 按钮）
//   与官方 TS 定义（ui/dist/monaco/autocomplete/lib.sceneScript.d.ts L292-415）逐字对应。
//
// 语料实证的 5 个回调分布（包 id → 调用）：见 PATCHES.md P-62。
//
// 本函数是**该机制唯一的宿主入口**：遍历 cache.map 的所有 entry，凡 entry.exports[name]
// 存在即调用。缓存按脚本源共享 → 同一源码被 N 层复用时对 owners 里每个对象各调一次
// （官方"每层一个实例都收事件"的等价物）。
//
// 参数：
//   cache    createScriptCache() 的返回值（或直接一个 Map<src, entry>）
//   name     回调名（'mediaPropertiesChanged' 等；未知名字 = 无脚本导出 → 0 调用，不报错）
//   payload  官方 event 对象（media-host.js 组装；**颜色字段必须是 Vec3 实例**，语料脚本会
//            对它调 .subtract()/.multiply()/.add() 做渐变，给普通字面量会 TypeError）
//   opts.onError(name, err) 可选错误回调（与 applySceneScripts 的 onError 同风格）
// 返回 { entries, calls, errors }：命中的 entry 数 / 实际调用次数 / 抛错次数。
//
// 【P-60 约束】必须保留 ownerRef 的**惰性**语义：`layerRef()/objectRef()` 在每次属性访问时
//   读 ref.current，而 ref.current 由每次运行前的 setOwner 设定。派发发生在两次
//   applySceneScripts 之间 → 这里对每个 owner 显式 setOwner 还原，回调里的
//   thisLayer/thisObject 才指向"该脚本所属的层"（真机 3554161528 的
//   `mediaThumbnailChanged(event){ thisObject.getAnimation().play() }` 就靠这条）。
//   不得退回"工厂函数体开头 const obj = ref.current"的写法。
export function dispatchScriptEvent(cache, name, payload, opts = {}) {
  const map = cache && cache.map instanceof Map ? cache.map : (cache instanceof Map ? cache : null);
  const out = { entries: 0, calls: 0, errors: 0 };
  if (!map || typeof name !== 'string' || !name) return out;
  const onError = typeof opts.onError === 'function' ? opts.onError : null;
  // ①(P-233 批次3 C6) `ownerFilter(obj)`：指针类事件（cursorClick/Down/Up）只投给**命中层**的脚本
  //   实例（官方 cursorHitTest 语义 = 命中判定先行）。不传 = 全体投递（媒体事件旧语义不变）。
  const ownerFilter = typeof opts.ownerFilter === 'function' ? opts.ownerFilter : null;
  for (const entry of map.values()) {
    if (!entry || !entry.exports) continue;
    const fn = entry.exports[name];
    if (typeof fn !== 'function') continue;
    out.entries++;
    let owners;
    try { owners = (entry.owners && entry.owners.size) ? Array.from(entry.owners) : [entry.lastOwner || null]; }
    catch { owners = [entry.lastOwner || null]; }
    for (const obj of owners) {
      if (ownerFilter && !ownerFilter(obj)) continue
      if (entry.ownerRef && entry.ownerRef.setOwner) { try { entry.ownerRef.setOwner(obj) } catch { /* ignore */ } }
      try { fn(payload); out.calls++; }
      catch (e) {
        out.errors++;
        // 与 applySceneScripts 一致：单个回调失败不拖垮其它脚本/宿主
        if (onError) { try { onError(name, e) } catch { /* ignore */ } }
      }
    }
  }
  return out;
}

// ①(P-62) 让所有脚本实例**重跑一次** `applyUserProperties(changed)`。
//
// 为什么需要它（接 P-62 的 `scriptCache` 时必须一并接线）：
//   `demo.html` 目前**没有**传 `scriptCache`（只有 `shared`）→ 每帧重编译、`applyUserProperties`
//   每帧都被调用。一旦为了 `dispatchScriptEvent` 引入 `createScriptCache()`，按官方语义
//   `entry.userPropsApplied` 只置一次 → "只靠 applyUserProperties 生效"的脚本（如 3326873240 的
//   后处理层 timevarying/display/morningtime…）在用户改属性后**不再收到回调** → P-61 属性面板
//   的即时生效看起来坏了。
//   本函数把该标志清掉 → 下一帧 `applyUserProperties(opts.userProps)` 重新收到**当前**属性表，
//   语义与旧行为（每帧都跑）等价，是接入缓存时的安全阀。
// 用法：P-61 属性面板 / `?props=` 变更后调一次（幂等，返回被重置的 entry 数）。
/* ①(P-243 2026-10-06) **`input.cursorWorldPosition` 此前恒为画布中心、没有任何更新入口**
 *   ⇒ 作者脚本里所有"跟随鼠标"的互动（眼睛跟指针、嘴巴随指针距离缩放、NSL Dock…）在本仓**永远不动**。
 *   这里提供唯一更新处：宿主每帧把**设计坐标**指针喂进来（就地改 Vec3，脚本持有的引用有效）。
 *   读数口径：`input.cursorWorldPosition`（设计坐标，y 向下）、`cursorScreenPosition`（屏幕像素，可选）、
 *   `cursorDelta`（本帧位移，可选）、`cursorLeftDown`（可选）。缺项一律保持原值（零回归）。 */
export function syncScriptInput(input, p, meta = {}) {
  if (!input || !p) return 0
  const x = Number(p.x), y = Number(p.y)
  if (!isFinite(x) || !isFinite(y)) return 0
  let wrote = 0
  const cw = input.cursorWorldPosition
  if (cw && typeof cw === 'object') {
    if (cw.x !== x || cw.y !== y || cw.z !== 0) { cw.x = x; cw.y = y; cw.z = 0; wrote++ }
  }
  const cd = input.cursorDelta
  if (cd && typeof cd === 'object') {
    const dx = Number.isFinite(meta.dx) ? meta.dx : 0
    const dy = Number.isFinite(meta.dy) ? meta.dy : 0
    if (cd.x !== dx || cd.y !== dy || cd.z !== 0) { cd.x = dx; cd.y = dy; cd.z = 0; wrote++ }
  }
  const cs = input.cursorScreenPosition
  if (cs && typeof cs === 'object' && Array.isArray(meta.screen) && isFinite(meta.screen[0]) && isFinite(meta.screen[1])) {
    if (cs.x !== meta.screen[0] || cs.y !== meta.screen[1]) { cs.x = meta.screen[0]; cs.y = meta.screen[1]; wrote++ }
  }
  if (typeof meta.leftDown === 'boolean' && input.cursorLeftDown !== meta.leftDown) { input.cursorLeftDown = meta.leftDown; wrote++ }
  return wrote
}

export function invalidateUserProps(cache) {
  const map = cache && cache.map instanceof Map ? cache.map : (cache instanceof Map ? cache : null);
  if (!map) return 0;
  let n = 0;
  for (const entry of map.values()) {
    if (entry && entry.userPropsApplied) { entry.userPropsApplied = false; n++; }
  }
  return n;
}
