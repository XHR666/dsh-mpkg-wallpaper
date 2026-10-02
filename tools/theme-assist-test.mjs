// theme-assist-test.mjs —— 半透明主题适配（应用外框 / 输入框磨砂 / ≥4K 默认降 1080p）的离线判据
//
// 病（issue #4 的两条 + 一条性能建议；同形规则已在宿主 bundle 里核过）：
//   宿主把 `--dsw-alias-bg-base` 调成半透明（用户自定义 CSS 想让壁纸透出来）后：
//     (A) 应用外框 `[class*="_frame"]` 仍**不透明**地盖在壁纸层（z-index:-1）之上 ⇒ 壁纸完全不可见；
//     (B) 输入框 `[class*="composerSeat"]` 的遮罩渐变终点 = `--dsw-alias-bg-base` ⇒ 底色半透明后
//         它遮不住滚到输入框下面的正文（正文糊进输入框）；
//     (C) 4K 源 + 壁纸层虚化 ⇒ 桌面端明显卡（旧实现只提示，不改默认值；2026-10-02 用户第 1 项起
//         **默认自动降到 1080p**，带 `?autocap=off` 回退口。**同日的第 2 次拍板**：降档只对当前壁纸
//         **临时生效、不写设置、不弹「转码中」条** —— 上一版把 resMax 写进设置，之后每次改外观设置都
//         重走转码判断并弹条 = 用户第 1 条 bug。**同日的第 3 次拍板**（原话"不弹条"）：连软重挂引起的
//         **真实**转码进度也不许派发 ⇒ `mpwAutoCapSilence(true/false)` 静音窗口 + `mpwBusyEmit` 双守卫
//         （判据见 D 组 ⑬/D14 与 E10）。
//   版本事实（决定了"必须运行期探测"）：**不同宿主构建的取色变量不同**（一个用 `--dsw-alias-bg-base`、
//   另一个用 `--dsw-specific-sidebar-fill` 且算出来同色）⇒ 类名带哈希、取色变量随构建变。
//
// 本文件判据（纯 Node + 桩 DOM，不开浏览器）：
//   A 组 纯函数/静态：alpha 解析、默认值、CSS 文本与选择器特异性、设置行与 i18n 接线、
//                     两项新行为的**接线判据**（自动降档：判据函数/回退口/台账/**临时覆盖 + 唯一读取口** +
//                     不落盘 + 软重挂 + busy **完全静音**＝占位守卫 + 静音窗口；用户动过标记；
//                     ffmpeg 读数口；面板显示生效值）
//   B 组 行为（桩 DOM）：外框透明化的**三条前提**（有壁纸 / 开关开 / 宿主半透明）逐条翻转；
//                       只动"不透明 + 铺满视口 + 不在壁纸层内"的节点；幂等；关掉后**逐字还原**
//   C 组 输入框磨砂：①半透明 + 用户没动过 ⇒ 自动应用 + 台账 `composer: "auto-translucent"`；
//                     ②半透明 + 用户显式关过（composerBlurUserSet）⇒ 永不自动开；
//                     ③不透明（默认）主题 ⇒ 不动作；④关掉 themeAssist ⇒ 不动作；
//                     ⑤用户显式开 ⇒ 照开；⑥自动开过之后用户显式关 ⇒ 属性与样式节点**摘除无残留**
//   D 组 ≥4K 自动降 1080p（2026-10-02 用户拍板：**只对当前壁纸临时生效、不写设置、不弹条**）：
//                     ①全条件满足 ⇒ 盘上**一个字都不写**（无 commit / 无 writeSection / 档里 resMax 不变）
//                       + 临时覆盖 maxW=1920 + 软重挂 1080p 档（URL 带 maxW=1920）+ 新文案 + 台账 mode=transient；
//                     ①b 临时覆盖是上限的**唯一读取口**：没设过 ⇒ 1920；用户自己设了 3000 ⇒ 3000（让位）；换壁纸 ⇒ 0；
//                     ②<4K ⇒ 不动；③用户已设过 resMax ⇒ 不动（连软重挂都不做）；
//                     ④同一壁纸第二次 ⇒ 不动（去重）；④b 换壁纸 ⇒ 旧覆盖失效、新壁纸按"每壁纸一次"重判（仍不写盘）；
//                     ⑤`?autocap=off` ⇒ 不动（行为同今天）；⑥转码不可用/读数未知/读数在飞 ⇒ 不动；
//                     ⑦落盘口拿不到（面板桥没挂载 / writeSection 会抛）⇒ **照样降档**（不落盘 ⇒ 不依赖落盘口）；
//                     ⑧scene 内嵌视频（不可转码）⇒ 不动；⑨resMax=0 ⇒ 视同未设；⑩boot 窗口 ⇒ 不写盘、也不排补写待办；
//                     ⑪读数"在飞" ⇒ 等探测落地再判一次（不写 seen）；⑫取词失败 ⇒ 文案回退中文；
//                     ⑬busy **完全静默**：占位事件带 `auto:true` 被拦，软重挂引起的**真实**转码进度落在
//                       `mpwAutoCapSilence(true)` 的静音窗口里也被拦（两处都看真窗口派发出去的事件）
//   E 组 变异自证：把关键判断改坏（外框/还原/输入框/自动降档/回退口/自动档守卫/**静音窗口**）⇒ 对应判据必红
//                     （E6–E10 是**真变异**：改坏后跑同一组输入，证明判据确实有分辨力）
//
// 用法: node tools/theme-assist-test.mjs
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(here, '..')
const SRC = fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8')

let pass = 0, fail = 0
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log('  ✓ ' + name + (detail ? '  [' + detail + ']' : '')) } else { fail++; console.log('  ✗ ' + name + (detail ? '  — ' + detail : '')) } }

/* ── 源码切片（与 lib 同源，改哪断言哪）──────────────────────────────────── */
function sliceFn(name) {
  const i = SRC.indexOf('function ' + name + '(')
  if (i < 0) throw new Error('缺少函数 ' + name)
  let d = 0, started = false
  for (let j = i; j < SRC.length; j++) {
    if (SRC[j] === '{') { d++; started = true } else if (SRC[j] === '}') { d--; if (started && d === 0) return SRC.slice(i, j + 1) }
  }
  throw new Error('函数体不配平 ' + name)
}
/** ①(2026-10-02 拍板"不写设置") 真源里**这个函数已不存在**：连声明都找不到（改名/搬走也算红）。
    为什么不直接 `SRC.includes(name)`：删除说明**注释**里还写着函数名（"`mpwAutoCapCommit()` 已删除"），
    整份字符串 grep 会被自己的注释骗成假红 ⇒ 声明层面用本函数断言，代码行引用用下面的 `noCodeRef`。 */
function fnGone(name) {
  try { sliceFn(name); return false } catch (e) { return true }
}
/** 真源里是否还有**代码行**引用这个名字（纯注释行、以及名字出现在 `//` 之后的都不算）。 */
function noCodeRef(name) {
  return SRC.split('\n').every((l) => {
    if (l.indexOf(name) < 0) return true
    const t = l.trim()
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return true
    const c = l.indexOf('//')
    return c >= 0 && c < l.indexOf(name)
  })
}
/** 常量/let 声明**原样**搬进沙箱（避免夹具与真值漂移；找不到 ⇒ 直接报错，不静默用兜底值）。 */
function sliceDecl(prefix, name) {
  const m = SRC.match(new RegExp(prefix + ' ' + name + ' = [^;\\n]+;'))
  if (!m) throw new Error('缺少声明 ' + name)
  return m[0]
}
/** 多行声明（对象/数组字面量）的配平切片：跳过字符串里的括号与分号（与 fog-model 同款）。 */
function sliceDeclObj(name) {
  const head = 'const ' + name + ' = '
  const i = SRC.indexOf(head)
  if (i < 0) throw new Error('缺少声明 ' + name)
  const start = i + head.length
  let d = 0, q = ''
  for (let j = start; j < SRC.length; j++) {
    const c = SRC[j]
    if (q) { if (c === '\\') { j++; continue } if (c === q) q = ''; continue }
    if (c === '"' || c === "'" || c === '`') { q = c; continue }
    if (c === '{' || c === '[' || c === '(') d++
    else if (c === '}' || c === ']' || c === ')') d--
    else if (c === ';' && d === 0) return head + SRC.slice(start, j + 1)
  }
  throw new Error('声明不配平 ' + name)
}
const FN_ALPHA = sliceFn('mpwColorAlpha')
const FN_THEME = sliceFn('mpwThemeState')
const FN_FRAMES = sliceFn('mpwFrameCandidates')
const FN_STYLE = sliceFn('mpwThemeStyleEl')
const FN_REVERT = sliceFn('mpwRevertThemeAssist')
const FN_APPLY = sliceFn('mpwApplyThemeAssist')
const FN_PERF = sliceFn('mpwPerfNoteForSource')
const FN_COMPOSER = sliceFn('mpwComposerBlurEffective')
const FN_SCENEUI = sliceFn('mpwSceneUi')
const FN_TSPEC = sliceFn('mpwTranscodeSpec')
const FN_AUTOCAP_OFF = sliceFn('mpwAutoCapOff')
const FN_AUTOCAP_TRANSCODABLE = sliceFn('mpw4kAutoCapTranscodable')
const FN_AUTOCAP_DECISION = sliceFn('mpw4kAutoCapDecision')
const FN_AUTOCAP_LEDGER = sliceFn('mpw4kAutoCapLedger')
const FN_AUTOCAP_KEY = sliceFn('mpw4kAutoCapKey')
/* ①(2026-10-02 用户拍板"不写设置" ⇒ 临时覆盖) `mpwAutoCapCommit()` 与死代码 `mpwAutoCapTransientActive()`
   已从真源**彻底删除**（不是"主路径不再调用"，是整份真源里连函数声明都不存在）⇒ 这里不再切片；
   A14 改为 `fnGone` + `noCodeRef` 断言"声明没了、代码行也没引用"（比整份字符串 grep 更强/更准）。 */
const FN_AUTOCAP_MAIN = sliceFn('mpwAutoCap4kForSource')
/* ①(2026-10-02 拍板：不写设置 ⇒ 临时覆盖；拍板"不弹条" ⇒ **完全静默**) 新增/改动的真实现：
   · `mpwAutoCapTransient` 的读取口（用户设过优先，否则命中当前壁纸的临时覆盖）；
   · 壁纸身份解析（覆盖按 key 失效）；
   · `mpwAutoCapSilence`（静音窗口：自动降档引起的**真实**转码进度也不派发）+ 它的模块级开关；
   · `mpwBusyEmit`（`auto:true` 占位守卫 + 静音窗口里的 `tc:` 进度守卫）与
     `pollTranscodeProgress`（软重挂后喂真实转码进度；两个出口负责关掉静音窗口）。 */
const FN_RESMAX_EFF = sliceFn('mpwResMaxEffective')
const FN_AUTOCAP_KEYOF = sliceFn('mpwAutoCapKeyOf')
const FN_AUTOCAP_SILENCE = sliceFn('mpwAutoCapSilence')
const FN_BUSY = sliceFn('mpwBusyEmit')
const FN_POLL = sliceFn('pollTranscodeProgress')
const FN_FF_NOTE = sliceFn('mpwNoteFfmpegReady')
const FN_FF_KNOWN = sliceFn('mpwFfmpegReadyKnown')
const FN_FF_KICK = sliceFn('mpwFfmpegProbeKick')
const FN_PERF_MSG = sliceFn('mpwPerfMsg')
const FN_ANNOUNCE = sliceFn('mpwAutoCapAnnounce')
const FN_FF_INFLIGHT = sliceFn('mpwFfmpegProbeInFlight')
const FN_FF_WAITER = sliceFn('mpwOnFfmpegProbe')
const FN_ON_BOOT = sliceFn('mpwOnBootSettled')
const FN_BOOT_SETTLE = sliceFn('mpwBootSettle')
const CONSTS = SRC.slice(SRC.indexOf('const DEFAULT_THEME_ASSIST'), SRC.indexOf('const DEFAULT_COMPOSER_BLUR') + 200)
const DECLS = [
  sliceDecl('let', 'mpwFfmpegProbe'),
  sliceDecl('const', 'MPW_FFMPEG_TTL_MS'),
  sliceDecl('let', 'mpwFfmpegInFlight'),
  sliceDecl('let', 'mpwFfmpegWaiters'),
  sliceDecl('const', 'MPW_4K_MIN_PX'),
  sliceDecl('const', 'MPW_4K_AUTOCAP_RES'),
  /* 临时覆盖（= 自动降档的唯一落点；不再是设置里的 resMax）：真声明从源码原样搬进来。 */
  sliceDecl('let', 'mpwAutoCapTransient'),
  /* 静音窗口开关（D14/E10 的"窗口确实开着"读的就是它）：真声明从源码原样搬进来。
     ⚠ 少了这一段，`mpwAutoCapSilence(true)` 会抛 ReferenceError 并被主路径 catch 吞掉
     ⇒ 轮询整个不发起（D1/D13/D14 三红，且表象完全看不出真因）。 */
  sliceDecl('let', 'mpwAutoCapSilent'),
  /* boot 收尾闸门（自动降档补写要用）：真声明 + 由世界预设值（`__win.__bootPending`）初始化。 */
  sliceDecl('let', 'mpwBootPending'),
  sliceDecl('let', 'mpwStoreDirty'),
  sliceDecl('let', 'mpwAfterBoot'),
  'mpwBootPending = __win.__bootPending === true;',
  /* 真实的"用户动过"标记表 + 标记函数（自动降档的模块级落盘口要用它；真值不另编一份） */
  sliceDeclObj('MPW_USERSET_OF'),
  sliceDeclObj('MPW_USERSET_KEYS'),
  sliceFn('mpwMarkUserSet'),
].join('\n')
const CSS_TXT = (() => {
  const i = SRC.indexOf('const MPW_COMPOSER_BLUR_CSS =')
  const j = SRC.indexOf('\n\n', i)
  return SRC.slice(i, j > i ? j : i + 800)
})()
/** 词典取值：**从源码里取真值**（取不到就报错，不许夹具自己编一份文案去对答案）。 */
const I18N_ZH = (() => {
  const pick = (key) => {
    const m = SRC.match(new RegExp('"' + key.replace(/\./g, '\\.') + '": "((?:[^"\\\\]|\\\\.)*)"'))
    if (!m) throw new Error('词典缺键 ' + key)
    return JSON.parse('"' + m[1] + '"')
  }
  return { perfNote4kAuto: pick('perfNote4kAuto'), perfNote4kAdvisory: pick('perfNote4kAdvisory') }
})()

/* ── 桩 DOM ─────────────────────────────────────────────────────────────── */
function mkEl(cls, bg, rect, opts = {}) {
  const attrs = new Map()
  const styleMap = new Map()
  const el = {
    tagName: 'DIV', nodeType: 1, __cls: cls, __bg: bg, __rect: rect, children: [], parentNode: null,
    style: {
      setProperty: (k, v) => styleMap.set(k, v),
      getPropertyValue: (k) => (styleMap.has(k) ? styleMap.get(k) : ''),
      removeProperty: (k) => styleMap.delete(k),
    },
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    setAttribute: (k, v) => attrs.set(k, String(v)),
    removeAttribute: (k) => attrs.delete(k),
    hasAttribute: (k) => attrs.has(k),
    getBoundingClientRect: () => rect,
    contains: (o) => o === el || el.children.some((c) => c.contains ? c.contains(o) : c === o),
    appendChild: (c) => { el.children.push(c); c.parentNode = el; return c },
    removeChild: (c) => { el.children = el.children.filter((x) => x !== c); c.parentNode = null },
    querySelectorAll: () => [],
    __attrs: attrs, __style: styleMap, __opts: opts,
  }
  return el
}
function mkWorld({ bgBase = 'rgba(255,255,255,0.2)', sidebarFill = '#f9fafb', frames = [], composerCard = null } = {}) {
  const head = mkEl('HEAD', 'rgba(0,0,0,0)', { width: 0, height: 0 })
  const html = mkEl('HTML', 'rgba(0,0,0,0)', { width: 1920, height: 1080 })
  const body = mkEl('BODY', 'rgba(0,0,0,0)', { width: 1920, height: 1080 })
  html.appendChild(head); html.appendChild(body)
  const wrap = mkEl('DIV', 'rgba(0,0,0,0)', { width: 1920, height: 1080 })
  wrap.id = 'mpw-bgWrap'; body.appendChild(wrap)
  const all = [...frames, ...(composerCard ? [composerCard] : [])]
  const doc = {
    body, documentElement: html, head,
    /* getElementById 按**在册 DOM 树**查（与真浏览器同语义）：若按"创建过的节点"记表，
       摘除后再挂的用例会读到已摘下的孤儿节点（stub 与真机行为不符 ⇒ 判据假红）。 */
    getElementById: (id) => {
      const find = (n) => {
        for (const c of n.children || []) { if (c.id === id) return c; const r = find(c); if (r) return r }
        return null
      }
      return find(html)
    },
    createElement: (tag) => {
      const el = mkEl(tag, 'rgba(0,0,0,0)', { width: 0, height: 0 })
      el.tagName = String(tag).toUpperCase()
      el.id = ''
      return el
    },
    querySelectorAll: (sel) => {
      if (sel === '[class*="_frame"]') return all.filter((e) => /_frame/.test(e.__cls))
      if (sel === '[data-mpw-frame-transparent="1"]') return all.filter((e) => e.getAttribute('data-mpw-frame-transparent') === '1')
      return []
    },
  }
  /* getComputedStyle 桩：主题变量只挂在 html/body 上（与真宿主同形），其余节点给自身背景。 */
  const styleFor = (el) => ({
    backgroundColor: el.__bg, display: '', visibility: 'visible',
    getPropertyValue: (name) => ((el === html || el === body) ? ({ '--dsw-alias-bg-base': bgBase, '--dsw-specific-sidebar-fill': sidebarFill }[name] || '') : ''),
  })
  const win = {
    innerWidth: 1920, innerHeight: 1080, __perf: null,
    location: { search: '' },
    /* `mpwBusyEmit` 真正派发时会走这里 ⇒ 判据能看见"进度条收到的是哪些事件"（D⑬）。 */
    dispatchEvent: (ev) => { (win.__events = win.__events || []).push(ev); return true },
  }
  return { doc, win, html, body, wrap, head, all, styleFor }
}
/** 把切片 + 桩环境拼成一个可执行的 apply/revert/自动降档（就是 lib 里那几段原文，只换外部依赖）。
 *  `extra.mutate(code)`：对拼好的源码做**变异**（E 组自证用；真源零改动）。
 *  `extra.realPoll`：软重挂后的进度轮询用**真实现**（FN_POLL）+ 记录派发的 busy 事件（D⑬ 的 busy 判据）。 */
function loadAssist(world, section, extra = {}) {
  /* 轮询：默认记录参数（软重挂到底走的哪一档）；`realPoll` 时换成真实现（含它自己发的 tc: 进度事件）。 */
  const pollImpl = extra.realPoll
    ? FN_POLL
    : 'const pollTranscodeProgress = (src, fps, maxW, scale) => { __win.__polls = (__win.__polls || []).concat([{ src: String(src), fps: fps, maxW: maxW, scale: scale }]); return 0 };';
  const raw = [
    'const window = __win; const document = __doc; const location = __win.location;',
    'const DEFAULT_THEME_ASSIST = true; const DEFAULT_COMPOSER_BLUR = false; const DEFAULT_BLUR = 12; const DEFAULT_UNIFY_AMOUNT = 30;',
    'const ALLOWED_FPS = [24, 30, 48, 60]; const HOST_URL = "http://127.0.0.1:1/api/mpkg-wallpaper";',
    'const getComputedStyle = __cs; const bgElements = () => ({ wrap: __wrap, video: null });',
    /* 软重挂的媒体层桩：只记录 URL（真实现里是 showVideoEl/showVideoEdge；Edge 走 canvas）。
       `IS_EDGE=false` ⇒ 判据盯的是 `showVideoEl` 那一条（非 Edge 主路径）。 */
    'const IS_EDGE = false;',
    'const showVideoEl = (u) => { __win.__remounts = (__win.__remounts || []).concat([String(u)]) };',
    'const showVideoEdge = (u) => { __win.__edgeRemounts = (__win.__edgeRemounts || []).concat([String(u)]) };',
    'const CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init && init.detail } };',
    /* 定时器桩：`setInterval` 只同步跑一次回调（进度轮询的第一发）⇒ 真实现能跑、又不会留下跑不完的定时器。 */
    'const setInterval = (fn) => { try { fn(); } catch (e) {} return 1; }; const clearInterval = () => {};',
    pollImpl,
    'const readSection = () => __section; const mpwPersistEmit = (m) => { __notes.push(String(m)) };',
    'const fetch = __fetch;',
    /* 落盘口桩：`__win.__noWriteSection` = 连模块级 writeSection 也拿不到（D8b 的"两条口都没有"）。
       mpwSwitchPatchFull 在沙箱里按恒等桩 —— 本组只走 `{resMax:…}` 这一条（不碰源字段），
       它的真实现（源字段归一化）由 switch-wiring/panel 那条线覆盖。 */
    'const writeSection = (next, instant) => { if (__win.__noWriteSection) throw new Error("no writeSection");'
    + ' (__win.__writes = __win.__writes || []).push({ resMax: next && next.resMax, keys: Object.keys(next || {}), instant: instant }) };',
    'const mpwSwitchPatchFull = (p) => p;',
    'let mpwSectionNotify = () => { __win.__notified = (__win.__notified || 0) + 1 };',
    /* boot 收尾的真实实现要用到的两个副作用（桩：本组只验"待办在收尾后被执行"） */
    'const mpwFlushStore = () => { __win.__flushed = (__win.__flushed || 0) + 1 };',
    'const mpwTrace = () => {}; const mpwHealSchedule = () => {};',
    '/* i18n：与宿主词典同款取值（这里给 zh 真值，取自源码） */',
    'const mpwT = (k) => (__i18n[k] !== void 0 ? __i18n[k] : k);',
    'const MPW_THEME_STYLE_ID = "mpw-theme-assist-style";',
    DECLS,
    'let __mpwSceneUiBridge = null;',
    CSS_TXT,
    'const mpwErr = (w, e) => { __errs.push(String(w) + String((e && e.message) || e)) };',
    FN_ALPHA, FN_THEME, FN_FRAMES, FN_STYLE, FN_REVERT, FN_APPLY, FN_COMPOSER, FN_PERF,
    FN_SCENEUI, FN_TSPEC, FN_AUTOCAP_OFF, FN_AUTOCAP_TRANSCODABLE, FN_AUTOCAP_DECISION,
    FN_AUTOCAP_LEDGER, FN_AUTOCAP_KEY,  FN_AUTOCAP_MAIN,
    FN_AUTOCAP_KEYOF, FN_RESMAX_EFF, FN_AUTOCAP_SILENCE, FN_BUSY,
    FN_FF_NOTE, FN_FF_KNOWN, FN_FF_KICK, FN_FF_INFLIGHT, FN_FF_WAITER, FN_PERF_MSG, FN_ANNOUNCE, FN_ON_BOOT, FN_BOOT_SETTLE,
    'return { alpha: mpwColorAlpha, theme: mpwThemeState, apply: mpwApplyThemeAssist, revert: mpwRevertThemeAssist,'
    + ' perf: mpwPerfNoteForSource, composer: mpwComposerBlurEffective, autoCap: mpwAutoCap4kForSource,'
    + ' resMaxEff: (s) => mpwResMaxEffective(s), busy: (p) => mpwBusyEmit(p),'
    + ' silence: (on) => mpwAutoCapSilence(on), silent: () => mpwAutoCapSilent,'
    + ' noteFfmpeg: mpwNoteFfmpegReady, ffmpeg: mpwFfmpegReadyKnown, settleBoot: () => mpwBootSettle("test"),'
    + ' kickProbe: (why) => mpwFfmpegProbeKick(why), bootPending: () => mpwBootPending,'
    + ' setBridge: (b) => { __mpwSceneUiBridge = b } };',
  ].join('\n')
  const code = typeof extra.mutate === 'function' ? extra.mutate(raw) : raw
  const notes = [], errs = []
  const fetchCalls = [], pendingFetches = []
  /* 桩 fetch：**挂起**的 promise（由用例决定何时落地）—— 只有这样才能测"读数在飞"那条路径。 */
  const stubFetch = (u) => {
    fetchCalls.push(String(u))
    return new Promise((resolve) => { pendingFetches.push({ url: String(u), resolve: resolve }) })
  }
  // eslint-disable-next-line no-new-func
  const fn = new Function('__win', '__doc', '__cs', '__wrap', '__section', '__notes', '__errs', '__i18n', '__fetch', code)
  fn.body = code
  const api = fn(world.win, world.doc, world.styleFor, world.wrap, section, notes, errs, I18N_ZH, stubFetch)
  return { api, notes, errs, fetchCalls, pendingFetches, code }
}
/** E 组变异：锚点必须存在（否则"变异"没发生 ⇒ 自证无效）。 */
function mutateAnchor(code, from, to) {
  if (!code.includes(from)) throw new Error('变异锚点不存在：' + from)
  return code.split(from).join(to)
}

console.log('== A 组：纯函数 / 静态接线 ==')
{
  const w = mkWorld()
  const { api } = loadAssist(w, { image: 'x', themeAssist: true })
  ok('A1 alpha 解析：rgba/rgb/#rrggbb/#rrggbbaa 都对（认不出的算 1 = 不透明，宁可不动作）',
    api.alpha('rgba(255,255,255,0.2)') === 0.2 && api.alpha('rgb(249,250,251)') === 1
    && Math.abs(api.alpha('#00000029') - 0x29 / 255) < 1e-9 && api.alpha('#00000029'.replace('29', '29')) !== 1
    && api.alpha('transparent') === 1 && api.alpha('') === 1,
    JSON.stringify([api.alpha('rgba(255,255,255,0.2)'), api.alpha('rgb(1,2,3)'), api.alpha('#00000029')]))
}
ok('A2 默认值：外框适配 = auto（true）、输入框磨砂 = false；两个常量都在源码里',
  /const DEFAULT_THEME_ASSIST = true;/.test(CONSTS) && /const DEFAULT_COMPOSER_BLUR = false;/.test(CONSTS))
ok('A3 输入框 CSS：选择器双写 `[class*=composerSeat][class*=composerSeat]`（压过宿主 (0,3,0) 基规则）+ 作用域挂 html[data-mpw-composer]',
  /html\[data-mpw-composer="blur"\] \[class\*="composerSeat"\]\[class\*="composerSeat"\]\{background:none\}/.test(CSS_TXT)
  && /\[class\*="_card"\]\{backdrop-filter:blur\(16px\)/.test(CSS_TXT))
ok('A4 设置行 + i18n 都接了（zh/en 各两条；字段名 themeAssist / composerBlur；磨砂那行显示**生效值**）',
  /toggleRow\(t\("themeAssist"\), t\("themeAssist\.desc"\), "themeAssist", DEFAULT_THEME_ASSIST\)/.test(SRC)
  && /toggleRow\(t\("composerBlur"\), t\("composerBlur\.desc"\), "composerBlur", DEFAULT_COMPOSER_BLUR, false, false, composerBlurShown\)/.test(SRC)
  && (SRC.match(/"themeAssist\.desc":/g) || []).length === 2 && (SRC.match(/"composerBlur\.desc":/g) || []).length === 2)
ok('A5 台账 + 还原入口在源码里（`__mpwThemeAssist` / `data-mpw-frame-transparent` / `data-mpw-frame-bg-prev`）',
  /window\.__mpwThemeAssist = led/.test(SRC) && /data-mpw-frame-transparent/.test(SRC) && /data-mpw-frame-bg-prev/.test(SRC))
ok('A6 闸门/应用接线：apply 路径调用 `mpwApplyThemeAssist(section)`',
  /try \{ mpwApplyThemeAssist\(section\); \}/.test(SRC))

/* ── ①(2026-10-02 用户第 1/2 项) 新增行为的接线判据 ───────────────────────── */
ok('A7 ≥4K 自动降档：临时覆盖 + 判据函数 + 回退口 + 两份台账都在源码里（`mpwAutoCapTransient`、`mpwResMaxEffective`、`MPW_4K_AUTOCAP_RES = 1920`、`?autocap=off`、`__mpw4kAutoCap`、`__mpwPerfNote.autoCap`）',
  /let mpwAutoCapTransient = null;/.test(SRC) && /function mpwResMaxEffective\(/.test(SRC)
  && /function mpw4kAutoCapDecision\(/.test(SRC)
  && /get\("autocap"\) === "off"/.test(SRC) && /window\.__mpw4kAutoCap/.test(SRC)
  && /n\.autoCap = out;/.test(SRC) && /led\.mode = "transient";/.test(FN_AUTOCAP_MAIN))
ok('A8 ≥4K 两条提示文案走 t() 且 zh/en 成对（`perfNote4kAuto` / `perfNote4kAdvisory` 各 2 处；取词失败回退中文，不弹键名）',
  (SRC.match(/"perfNote4kAuto":/g) || []).length === 2 && (SRC.match(/"perfNote4kAdvisory":/g) || []).length === 2
  && /mpwPersistEmit\(mpwPerfMsg\("perfNote4kAuto", "[^"]*已自动降到 1080p（可在设置里改回）"\)\)/.test(SRC)
  && /mpwPersistEmit\(mpwPerfMsg\("perfNote4kAdvisory",/.test(SRC) && /分辨率上限/.test(SRC.slice(SRC.indexOf('mpwPerfMsg("perfNote4kAdvisory"'), SRC.indexOf('mpwPerfMsg("perfNote4kAdvisory"') + 200))
  && /const v = mpwT\(key\)/.test(FN_PERF_MSG) && /return zh;/.test(FN_PERF_MSG)
  && /已自动降到 1080p（可在设置里改回）/.test(I18N_ZH.perfNote4kAuto) && /分辨率上限/.test(I18N_ZH.perfNote4kAdvisory),
  JSON.stringify(I18N_ZH.perfNote4kAuto))
ok('A9 降档目标复用 `mpwTranscodeSpec` 判据链（scene 内嵌视频/非 host: 源在链上就判不转码 ⇒ 不写档）',
  FN_AUTOCAP_TRANSCODABLE.includes('mpwTranscodeSpec(0, MPW_4K_AUTOCAP_RES, 0, image, isSceneVideo, HOST_URL)')
  && /spec\.useTranscode/.test(FN_AUTOCAP_TRANSCODABLE))
ok('A10 输入框磨砂的"用户动过"标记落在 commit 的唯一落点（`MPW_USERSET_OF.composerBlur` ⇒ writeSection 的标记机制）',
  /composerBlur: 'composerBlurUserSet',/.test(SRC) && /mpwSwitchPatchFull\(mpwMarkUserSet\(patch, readSection\(\)\)\)/.test(SRC))
ok('A11 转码可用性读数口：面板 checkFfmpeg 镜像进模块级快照 + applyInner 预热（不新起一套判定）',
  /mpwNoteFfmpegReady\(true, d\.source\)/.test(SRC) && /mpwNoteFfmpegReady\(false\)/.test(SRC)
  && /mpwFfmpegProbeKick\("apply"\)/.test(SRC) && /HOST_URL \+ "\/ffmpeg-check"/.test(FN_FF_KICK))
ok('A12 面板显示生效值：`composerBlurShown` 由 mpwComposerBlurEffective + mpwThemeState().translucent 算出并传给 toggleRow',
  /const composerBlurShown = \(\(\) => \{/.test(SRC) && /mpwComposerBlurEffective\(section,/.test(SRC)
  && /mpwThemeState\(\)\.translucent\)\.on;/.test(SRC) && /,\s*composerBlurShown\),/.test(SRC))
ok('A13 ≥4K 的触发点仍是 <video> 的 loadedmetadata（自动降档与一次性提示同一入口）',
  /video\.addEventListener\("loadedmetadata", \(\) => \{\s*try \{ mpwPerfNoteForSource\(video\.videoWidth, video\.videoHeight\); \}/.test(SRC))
ok('A14 自动降档**不再写设置**（2026-10-02 拍板）：`mpwAutoCapCommit` / `mpwAutoCapTransientActive` 在**整份真源**里连声明都不存在、也没有代码行引用；主路径没有 `writeSection(` / `mpwMarkUserSet(` 调用；落点是临时覆盖 + 软重挂（`showVideoEl(spec2.playUrl)`）+ 1080p 档的进度轮询',
  fnGone('mpwAutoCapCommit') && noCodeRef('mpwAutoCapCommit')
  && fnGone('mpwAutoCapTransientActive') && noCodeRef('mpwAutoCapTransientActive')
  && !/writeSection\(/.test(FN_AUTOCAP_MAIN) && !/mpwMarkUserSet\(/.test(FN_AUTOCAP_MAIN)
  && /mpwAutoCapTransient = \{ key: key, maxW: d\.resMax \};/.test(FN_AUTOCAP_MAIN)
  && /showVideoEl\(spec2\.playUrl\)/.test(FN_AUTOCAP_MAIN)
  && /pollTranscodeProgress\(img, spec2\.fps \|\| 30, spec2\.maxW \|\| 0, spec2\.scale \|\| ""\)/.test(FN_AUTOCAP_MAIN),
  JSON.stringify({ gone: [fnGone('mpwAutoCapCommit'), fnGone('mpwAutoCapTransientActive')], refs: [noCodeRef('mpwAutoCapCommit'), noCodeRef('mpwAutoCapTransientActive')] }))
ok('A15 读数"在飞"不算"拿不到"：判据函数出 `await-transcode-probe`，落地后由 mpwOnFfmpegProbe 补判一次（不写 seen、不重试、换壁纸判废）',
  /if \(ffInFlight === true\) return \{ act: false, why: "await-transcode-probe", resMax: 0 \};/.test(FN_AUTOCAP_DECISION)
  && /mpw4kAutoCapDecision\(W, H, sec\.resMax, mpwFfmpegReadyKnown\(\), mpwAutoCapOff\(\),\s*dup, mpw4kAutoCapTranscodable\(sec\), mpwFfmpegProbeInFlight\(\)\)/.test(FN_AUTOCAP_MAIN)
  && /d\.why !== "await-transcode-probe"/.test(FN_AUTOCAP_MAIN) && /mpwOnFfmpegProbe\(\(\) => \{/.test(FN_AUTOCAP_MAIN)
  && /expectKey && expectKey !== key/.test(FN_AUTOCAP_MAIN))
ok('A16 唯一上限读取口：外观应用路径的转码规格从 `mpwResMaxEffective(section)` 取上限（不再直接读 `section.resMax`）；读取口内部"用户设过优先、否则命中当前壁纸的临时覆盖"',
  /const resMaxN = mpwResMaxEffective\(section\);/.test(SRC) && !/const resMaxN = section\.resMax/.test(SRC)
  && /if \(own > 0\) return own;/.test(FN_RESMAX_EFF) && /t\.key === mpwAutoCapKeyOf\(s2\)/.test(FN_RESMAX_EFF))
/* ①(2026-10-02 用户拍板原话"不弹条" ⇒ **完全静默**) 两层守卫 + 窗口生命周期都在真源里：
   ① 占位事件（`auto:true`）拦在 `mpwBusyEmit`；② 静音窗口里的**真实**转码进度（label 以 `tc:` 开头）也拦在 `mpwBusyEmit`；
   窗口在软重挂后、发起轮询**之前**打开（下面的顺序断言：开窗必须在 `pollTranscodeProgress(` 之前，
   否则轮询自己第一发 `tc:0` 会漏出去 = 用户那条"不弹条"没落实）；
   `pollTranscodeProgress` 的两个出口（终态 done/error/cancelled + 20min 兜底）都 `mpwAutoCapSilence(false)` 复位；
   `mpwAutoCapSilence` 自己再登记 120s 兜底（轮询没起来也不会永久静音）。 */
const SILENCE_GUARD = 'if (mpwAutoCapSilent && payload && typeof payload.label === "string" && payload.label.indexOf("tc:") === 0) return'
ok('A17 busy **完全静音**接线：`mpwBusyEmit` 拦 `payload.auto === true` 占位 + 静音窗口里拦 `tc:` 真实进度；自动降档在轮询前开窗、轮询两个出口复位、另有 120s 兜底',
  /if \(payload && payload\.auto === true\) return/.test(FN_BUSY)
  && FN_BUSY.includes(SILENCE_GUARD)
  && /mpwBusyEmit\(\{ auto: true \}\)/.test(FN_AUTOCAP_MAIN)
  && FN_AUTOCAP_MAIN.indexOf('mpwAutoCapSilence(true)') >= 0
  && FN_AUTOCAP_MAIN.indexOf('mpwAutoCapSilence(true)') < FN_AUTOCAP_MAIN.indexOf('pollTranscodeProgress(')
  && (FN_POLL.match(/mpwAutoCapSilence\(false\)/g) || []).length === 2
  && /let mpwAutoCapSilent = false;/.test(SRC)
  && /setTimeout\(\(\) => \{ mpwAutoCapSilent = false \}, 120000\)/.test(FN_AUTOCAP_SILENCE),
  JSON.stringify({ guards: [/if \(payload && payload\.auto === true\) return/.test(FN_BUSY), FN_BUSY.includes(SILENCE_GUARD)], reset: (FN_POLL.match(/mpwAutoCapSilence\(false\)/g) || []).length }))
{
  /* 静音窗口的**真实现**自证（D14/E10 里的 `silent()` 读的就是它）。
     为什么单列：上一版夹具漏切这段真实现 ⇒ 主路径那行 `mpwAutoCapSilence(true)` 抛 ReferenceError，
     被 `mpwAutoCap4kForSource` 的 `catch (e) {}` 吞掉 ⇒ **整个轮询没发起**（D1/D13/D14 三红的真因，
     表象是 polls=0 / 没有 /transcode-progress 请求，完全看不出根因）。这里让这段切片自己可信：
     源码里找不到/被改名 ⇒ `sliceFn` 直接抛，整个文件红在明处，不再退化成"静默少测一段"。 */
  const w = mkWorld()
  const { api } = loadAssist(w, { image: 'x', themeAssist: true })
  const before = api.silent()
  api.silence(true)
  const opened = api.silent()
  api.silence(false)
  ok('A18 静音窗口（真实现 + 真声明）：初始关着 ⇒ `mpwAutoCapSilence(true)` 打开 ⇒ `(false)` 关掉（D14/E10 的"窗口开着"读的就是这个开关）',
    before === false && opened === true && api.silent() === false,
    JSON.stringify({ before: before, opened: opened, after: api.silent() }))
}

console.log('\n== B 组：外框透明化的三条前提（桩 DOM 行为）==')
{
  const full = mkEl('DIV pI_x6G_frame', 'rgb(249,250,251)', { width: 1920, height: 1080 })
  const small = mkEl('DIV pI_x6G_frame', 'rgb(249,250,251)', { width: 300, height: 200 })
  const translucentFrame = mkEl('DIV pI_x6G_frame', 'rgba(255,255,255,0.35)', { width: 1920, height: 1080 })
  const insideWrap = mkEl('DIV pI_x6G_frame', 'rgb(249,250,251)', { width: 1920, height: 1080 })
  // 场景 1：半透明宿主 + 有壁纸 + 开关开 ⇒ 只动"不透明+铺满"的那一个
  const w1 = mkWorld({ bgBase: 'rgba(255,255,255,0.2)', frames: [full, small, translucentFrame] })
  w1.wrap.appendChild(insideWrap); w1.wrap.children.push(insideWrap)
  const r1 = loadAssist(w1, { image: 'x', themeAssist: true }).api.apply({ image: 'x', themeAssist: true })
  ok('B1 宿主半透明 + 有壁纸 ⇒ 外框被透掉（台账 frames=1，只命中"不透明+铺满"的那个）',
    full.getAttribute('data-mpw-frame-transparent') === '1' && full.style.getPropertyValue('background') === 'transparent'
    && small.getAttribute('data-mpw-frame-transparent') === null && translucentFrame.getAttribute('data-mpw-frame-transparent') === null
    && r1.frames === 1 && r1.mode === 'frame-transparent', JSON.stringify(r1))
  ok('B2 幂等 + 原始内联背景已留档（`data-mpw-frame-bg-prev`），二次 apply 不覆盖它',
    (() => { const a = full.getAttribute('data-mpw-frame-bg-prev'); w1.api2 = loadAssist(w1, { image: 'x', themeAssist: true }).api; const r = w1.api2.apply({ image: 'x', themeAssist: true }); return a === '' && r.frames === 1 && full.getAttribute('data-mpw-frame-bg-prev') === a })(),
    String(full.getAttribute('data-mpw-frame-bg-prev')))
  ok('B3 关掉开关 ⇒ **逐字还原**（标记与内联背景都清掉，节点回到原样）',
    (() => { const r = w1.api2.apply({ image: 'x', themeAssist: false }); return r.frames === 0 && r.mode === 'assist-off' && full.getAttribute('data-mpw-frame-transparent') === null && full.style.getPropertyValue('background') === '' })(),
    JSON.stringify([full.getAttribute('data-mpw-frame-transparent'), full.style.getPropertyValue('background')]))
}
{
  // 场景 2：宿主底色**不透明**（默认主题）⇒ 一行都不许动
  const f = mkEl('DIV pI_x6G_frame', 'rgb(249,250,251)', { width: 1920, height: 1080 })
  const w = mkWorld({ bgBase: 'rgb(249,250,251)', sidebarFill: '#f9fafb', frames: [f] })
  const r = loadAssist(w, {}).api.apply({ image: 'x', themeAssist: true })
  ok('B4 宿主不透明（默认主题）⇒ 零行为（`host-opaque`，节点原样）',
    r.frames === 0 && r.mode === 'host-opaque' && f.getAttribute('data-mpw-frame-transparent') === null, JSON.stringify(r))
}
{
  // 场景 3：没有壁纸 ⇒ 不动（别把默认主题的外框透掉）
  const f = mkEl('DIV pI_x6G_frame', 'rgb(249,250,251)', { width: 1920, height: 1080 })
  const w = mkWorld({ bgBase: 'rgba(255,255,255,0.2)', frames: [f] })
  const r = loadAssist(w, {}).api.apply({ enabled: true, image: '', webUrl: '', themeAssist: true })
  ok('B5 半透明宿主但**没有壁纸** ⇒ 不动外框（`no-source`）', r.frames === 0 && r.mode === 'no-source' && f.getAttribute('data-mpw-frame-transparent') === null, JSON.stringify(r))
}
{
  // 场景 4：插件总开关关 ⇒ 不动 + 还原
  const f = mkEl('DIV pI_x6G_frame', 'rgb(249,250,251)', { width: 1920, height: 1080 })
  const w = mkWorld({ bgBase: 'rgba(255,255,255,0.2)', frames: [f] })
  const helped = loadAssist(w, {}).api.apply({ enabled: true, image: 'x', themeAssist: true })
  const r = loadAssist(w, {}).api.apply({ enabled: false, image: 'x', themeAssist: true })
  ok('B6 `enabled:false` ⇒ 还原（`off`）+ 外框回到原样',
    helped.frames === 1 && r.frames === 0 && r.mode === 'off' && f.getAttribute('data-mpw-frame-transparent') === null, JSON.stringify([helped.mode, r.mode]))
}

console.log('\n== C 组：输入框磨砂档（用户手动 + 半透明宿主自动）==')
{
  const f = mkEl('DIV pI_x6G_frame', 'rgb(249,250,251)', { width: 1920, height: 1080 })
  const w = mkWorld({ bgBase: 'rgba(255,255,255,0.2)', frames: [f] })
  const hasStyle = () => w.head.children.some((c) => c.id === 'mpw-theme-assist-style')
  const styleTxt = () => ((w.head.children.find((c) => c.id === 'mpw-theme-assist-style') || {}).textContent) || ''
  /* ⚠ 每步都要**立刻**取快照：DOM 是共享的，晚取的读数代表的是后一步的状态（本测试第一版就踩了这个坑）。 */
  // ①半透明 + 用户**没动过** ⇒ 自动开
  const auto = loadAssist(w, {}).api.apply({ image: 'x' })
  const autoAttr = w.html.getAttribute('data-mpw-composer'); const autoSt = hasStyle(); const autoTxt = styleTxt()
  ok('C1 半透明宿主 + 用户没动过 ⇒ 自动应用（属性 + 样式），台账 `composer: "auto-translucent"`',
    auto.composerOn === true && autoAttr === 'blur' && autoSt && /composerSeat/.test(autoTxt)
    && auto.composer === 'auto-translucent' && auto.composerMode === 'auto-translucent' && auto.translucent === true,
    JSON.stringify({ composerOn: auto.composerOn, attr: autoAttr, style: autoSt, composer: auto.composer, err: auto.err || null }))
  // ②半透明 + 用户**显式关过**（composerBlurUserSet 标记）⇒ 永不自动开
  const userOff = loadAssist(w, {}).api.apply({ image: 'x', composerBlur: false, composerBlurUserSet: true })
  const userOffAttr = w.html.getAttribute('data-mpw-composer'); const userOffSt = hasStyle()
  ok('C2 半透明 + 用户显式关过（composerBlurUserSet）⇒ 不应用、属性与样式节点**摘除无残留**、台账 user-off',
    userOff.composerOn === false && userOffAttr === null && !userOffSt && userOff.composerMode === 'user-off',
    JSON.stringify({ composerOn: userOff.composerOn, attr: userOffAttr, style: userOffSt, mode: userOff.composerMode }))
  // ③用户显式开（标记在）⇒ 照开（手动档不看宿主是否半透明）
  const userOn = loadAssist(w, {}).api.apply({ image: 'x', composerBlur: true, composerBlurUserSet: true })
  const userOnAttr = w.html.getAttribute('data-mpw-composer'); const userOnSt = hasStyle()
  ok('C3 用户显式开（标记载明是他开的）⇒ 应用；台账 composerMode=user-on（不是 auto）',
    userOn.composerOn === true && userOnAttr === 'blur' && userOnSt && userOn.composerMode === 'user-on' && userOn.composer === true,
    JSON.stringify({ composerOn: userOn.composerOn, mode: userOn.composerMode }))
  // ④自动开过之后用户显式关 ⇒ 摘干净（同一世界连续三步）
  const backOff = loadAssist(w, {}).api.apply({ image: 'x', composerBlur: false, composerBlurUserSet: true })
  const backOffAttr = w.html.getAttribute('data-mpw-composer'); const backOffSt = hasStyle()
  ok('C4 自动开 → 用户显式关 ⇒ 属性摘除 + 样式节点删除（不留残留，下次也不再自动开）',
    backOff.composerOn === false && backOffAttr === null && !backOffSt && backOff.composerMode === 'user-off',
    JSON.stringify({ attr: backOffAttr, style: backOffSt }))
}
{
  // ⑤宿主**不透明**（默认主题）+ 没动过 ⇒ 一行都不许动（与今天一致）
  const f = mkEl('DIV pI_x6G_frame', 'rgb(249,250,251)', { width: 1920, height: 1080 })
  const w = mkWorld({ bgBase: 'rgb(249,250,251)', sidebarFill: '#f9fafb', frames: [f] })
  const r = loadAssist(w, {}).api.apply({ image: 'x' })
  ok('C5 不透明（默认）主题 + 没动过 ⇒ 不应用（`off`，与今天逐字一致）',
    r.composerOn === false && r.composerMode === 'off' && w.html.getAttribute('data-mpw-composer') === null
    && !w.head.children.some((c) => c.id === 'mpw-theme-assist-style'), JSON.stringify({ mode: r.composerMode, attr: w.html.getAttribute('data-mpw-composer') }))
}
{
  // ⑥关掉 themeAssist（适配总开关）⇒ 自动档随之关（但用户显式开仍生效）
  const f = mkEl('DIV pI_x6G_frame', 'rgb(249,250,251)', { width: 1920, height: 1080 })
  const w = mkWorld({ bgBase: 'rgba(255,255,255,0.2)', frames: [f] })
  const r = loadAssist(w, {}).api.apply({ image: 'x', themeAssist: false })
  const rAttr = w.html.getAttribute('data-mpw-composer')
  const man = loadAssist(w, {}).api.apply({ image: 'x', themeAssist: false, composerBlur: true })
  ok('C6 `themeAssist:false` ⇒ 半透明也不自动开；但用户显式开（composerBlur:true）仍生效',
    r.composerOn === false && rAttr === null && r.composerMode === 'off'
    && man.composerOn === true && man.composerMode === 'user-on' && w.html.getAttribute('data-mpw-composer') === 'blur',
    JSON.stringify([r.composerMode, man.composerMode]))
}

console.log('\n== D 组：≥4K 源 ⇒ 只对当前壁纸**临时**降到 1080p（不写设置、不弹条＝完全静默）+ 一次性提示 ==')
const HOST4K = 'host:?ltoken=t&file=4k.mp4'           // 可走宿主转码的宿主流视频源（host: 前缀）
const HOST4K_B = 'host:?ltoken=t&file=other4k.mp4'    // 另一张 ≥4K 壁纸（验"换壁纸 ⇒ 临时覆盖失效"）
const SV4K = 'sv=1&host:?ltoken=t&file=scene.mp4'     // scene 内嵌视频（宿主 /transcode 认不出 ⇒ 不可转码）
const T4K_A = 'http://127.0.0.1:1/api/mpkg-wallpaper/transcode?src=' + encodeURIComponent(HOST4K) + '&fps=30&maxW=1920'
const T4K_B = 'http://127.0.0.1:1/api/mpkg-wallpaper/transcode?src=' + encodeURIComponent(HOST4K_B) + '&fps=30&maxW=1920'
/* D 组判据的真值来源（2026-10-02 用户第 1/2 条 + 拍板，第 2 次修正）：
   自动降档**不再落盘** —— 上一版 `commit({resMax:1920}, true)` 会让之后每次改外观设置都重走转码判断、
   弹出「转码中」进度条（用户第 1 条 bug）。现在只设模块级**临时覆盖** + 软重挂当前壁纸。
   ⇒ 每条判据都同时盯三件事：①盘上一个字没写（面板桥 commit 与模块级 writeSection 两条口都没被调）；
   ②临时覆盖（唯一读取口 `mpwResMaxEffective`）读得到 1920；③软重挂确实走 1080p 档（重挂 URL 与进度查询都带 maxW=1920）。
   缺任何一条都说明"降档没真发生"或"又写盘了"。 */
/** D 组世界：commit 桩**真的落档**（真 commit 也是落盘改档）—— 用来证明自动降档**不碰**它。 */
function dWorld({ section = {}, search = '', ffmpeg, withBridge = true, bgBase = 'rgb(249,250,251)', bootPending = false, realPoll = false } = {}) {
  const w = mkWorld({ bgBase })
  w.win.location.search = search
  w.win.__bootPending = bootPending
  const commits = []
  const r = loadAssist(w, section, realPoll ? { realPoll: true } : {})
  if (withBridge) r.api.setBridge({ commit: (patch, instant, defer) => { commits.push({ patch, instant, defer }); Object.assign(section, patch) } })
  if (ffmpeg !== void 0) r.api.noteFfmpeg(ffmpeg, ffmpeg ? 'system' : '')
  return { w, r, commits, section }
}
/* 观察口（都落在真源真实副作用上）：软重挂 URL / 进度查询参数 / 派发出去的 mpw:busy 事件。
   ⚠ `polls`/`fetchCalls` 是**间接**观察口：真源 `mpwAutoCap4kForSource` 里软重挂之后那几行
   （`mpwAutoCapSilence(true)` ⇒ `pollTranscodeProgress(...)`）若在夹具里解析不到（漏切/改名），
   抛出的 ReferenceError 会被主路径的 `catch (e) {}` 吞掉 ⇒ 轮询**根本没发起**，判据只看到
   "空数组"。真源新增/改名这类行时，夹具要同步切片（见 A18 的静音窗口自证）。 */
const remounts = (g) => (g.w.win.__remounts || [])
const polls = (g) => (g.w.win.__polls || [])
const busyEvents = (g) => (g.w.win.__events || []).filter((e) => e && e.type === 'mpw:busy').map((e) => e.detail)
/** "一个字都不写盘"：面板桥没被调 + 模块级 writeSection 没被调（两条落盘口都盯）。 */
const noWrite = (g) => g.commits.length === 0 && g.w.win.__writes === void 0
{
  // ①全部条件满足 ⇒ 不写设置（拍板核心）+ 临时覆盖 + 软重挂 1080p 档 + 一次性提示 + 台账
  const g = dWorld({ section: { image: HOST4K, blur: 12, unifyTint: true, unifyAmount: 30 }, ffmpeg: true })
  const n1 = g.r.api.perf(3840, 2160)
  ok('D1 3840×2160 + resMax 未设 + 宿主转码可用 ⇒ **盘上一个字不写**（无 commit、无 writeSection、档里 resMax 仍为空），改为临时覆盖 1920 + 软重挂 1080p 档（重挂 URL 带 maxW=1920）+ 提示"已自动降到 1080p（可在设置里改回）"',
    noWrite(g) && g.section.resMax === void 0
    && !!n1 && n1.autoCap.applied === true && n1.autoCap.resMax === 1920 && n1.autoCap.why === 'applied'
    && g.r.api.resMaxEff(g.section) === 1920
    && remounts(g).length === 1 && remounts(g)[0] === T4K_A
    && polls(g).length === 1 && polls(g)[0].maxW === 1920 && polls(g)[0].src === HOST4K
    && g.r.notes.length === 1 && g.r.notes[0] === I18N_ZH.perfNote4kAuto
    && g.w.win.__mpw4kAutoCap.applied === true && g.w.win.__mpw4kAutoCap.resMax === 1920 && g.w.win.__mpw4kAutoCap.mode === 'transient'
    && g.w.win.__mpwPerfNote.autoCap === n1.autoCap,
    JSON.stringify({ writes: g.w.win.__writes || null, commits: g.commits, remount: remounts(g), notes: g.r.notes, autoCap: n1 && n1.autoCap }))
  // ①b 临时覆盖的读取语义（用户拍板：用户设过 resMax ⇒ 临时覆盖让位；换壁纸 ⇒ 覆盖失效）
  const other = Object.assign({}, g.section, { image: HOST4K_B })
  ok('D1b 临时覆盖是上限的**唯一读取口**（`mpwResMaxEffective`）：没设过 ⇒ 1920；用户自己设了 3000 ⇒ **3000（让位）**；别张壁纸 ⇒ 0（按 key 失效）；空档 ⇒ 0',
    g.r.api.resMaxEff(g.section) === 1920
    && g.r.api.resMaxEff(Object.assign({}, g.section, { resMax: 3000 })) === 3000
    && g.r.api.resMaxEff(other) === 0 && g.r.api.resMaxEff({}) === 0,
    JSON.stringify({ cur: g.r.api.resMaxEff(g.section), user3000: g.r.api.resMaxEff(Object.assign({}, g.section, { resMax: 3000 })), other: g.r.api.resMaxEff(other) }))
}
{
  // ②<4K ⇒ 不动（连台账都不建：与旧行为逐字一致）
  const g = dWorld({ section: { image: HOST4K, blur: 12, unifyTint: true, unifyAmount: 30 }, ffmpeg: true })
  const n = g.r.api.perf(1920, 1080)
  ok('D2 1920×1080（<4K）⇒ 不写盘、不软重挂、不提示、不写任何台账（1080p 及以下源的行为一字不改）',
    n === null && noWrite(g) && remounts(g).length === 0 && g.r.notes.length === 0
    && g.w.win.__mpwPerfNote === void 0 && g.section.resMax === void 0,
    JSON.stringify({ notes: g.r.notes, remounts: remounts(g) }))
}
{
  // ③用户已设过 resMax（>0）⇒ 不动（连软重挂都不做），且不再打扰（旧建议也压掉）
  const g = dWorld({ section: { image: HOST4K, resMax: 2560, blur: 12, unifyTint: true, unifyAmount: 30 }, ffmpeg: true })
  const n = g.r.api.perf(3840, 2160)
  ok('D3 用户已设 resMax=2560 ⇒ 不写盘、**不软重挂**（why=resmax-set）、不提示；读取口仍返回用户的 2560（临时覆盖不压用户）',
    noWrite(g) && remounts(g).length === 0 && n === null && g.r.notes.length === 0
    && g.w.win.__mpwPerfNote.autoCap.why === 'resmax-set' && g.r.api.resMaxEff(g.section) === 2560
    && g.w.win.__mpw4kAutoCap.seen[HOST4K].why === 'resmax-set',
    JSON.stringify({ why: g.w.win.__mpwPerfNote.autoCap.why, remounts: remounts(g), notes: g.r.notes }))
}
{
  // ④同一壁纸第二次（metadata 再触发一次）⇒ 去重、不再动
  const g = dWorld({ section: { image: HOST4K, blur: 0, unifyTint: false, unifyAmount: 0 }, ffmpeg: true })
  const n1 = g.r.api.perf(3840, 2160)
  const n2 = g.r.api.perf(3840, 2160)
  const seenKeys = Object.keys(g.w.win.__mpw4kAutoCap.seen)
  ok('D4 同一壁纸第二次 ⇒ 不再软重挂（why=dup，提示也不重复；全程只重挂过一次），台账 seen 只有这一条',
    noWrite(g) && remounts(g).length === 1 && n2 === null && g.w.win.__mpwPerfNote.autoCap.why === 'dup'
    && g.r.notes.length === 1 && seenKeys.length === 1 && seenKeys[0] === HOST4K && !!n1,
    JSON.stringify({ remounts: remounts(g).length, why: g.w.win.__mpwPerfNote.autoCap.why, seen: seenKeys.length }))
}
{
  // ④b 换壁纸 ⇒ 上一张的临时覆盖**失效**（按 key），新壁纸按"每壁纸一次"重新判定 —— 仍然不写盘。
  //    （上一版：写进设置的 1920 对**所有**壁纸生效、用户可见、要手动改回；现在换壁纸即作废。）
  const g = dWorld({ section: { image: HOST4K, blur: 0, unifyTint: false, unifyAmount: 0 }, ffmpeg: true })
  g.r.api.perf(3840, 2160)
  g.section.image = HOST4K_B
  g.w.win.__mpwPerfNoteShown = false          // 提示已发过就把闸门重置，确保判定的是"降不降"而不是"提不提示"
  const effB = g.r.api.resMaxEff(g.section)
  const r2 = g.r.api.autoCap(3840, 2160)
  ok('D4b 换到另一张 ≥4K 壁纸 ⇒ 上一张的临时覆盖**失效**（读取口回 0）、新壁纸重新软重挂一次 1080p（每壁纸一次），全程**不写盘**',
    effB === 0 && r2.applied === true && r2.why === 'applied'
    && noWrite(g) && g.section.resMax === void 0
    && remounts(g).length === 2 && remounts(g)[1] === T4K_B
    && g.r.api.resMaxEff(g.section) === 1920
    && Object.keys(g.w.win.__mpw4kAutoCap.seen).length === 2,
    JSON.stringify({ effB: effB, out: r2, remounts: remounts(g), seen: Object.keys(g.w.win.__mpw4kAutoCap.seen) }))
}
{
  // ⑤回退口 `?autocap=off` ⇒ 完全不自动降（行为同今天：有虚化时旧建议提示照旧）
  const g = dWorld({ section: { image: HOST4K, blur: 12, unifyTint: true, unifyAmount: 30 }, ffmpeg: true, search: '?autocap=off' })
  const n = g.r.api.perf(3840, 2160)
  ok('D5 `?autocap=off` + 全部条件满足 ⇒ 不写盘、不软重挂（why=autocap-off）、seen 为空（不记账）、读取口 0；有虚化 ⇒ 旧建议提示仍在（行为同今天）',
    noWrite(g) && remounts(g).length === 0 && !!n && n.autoCap.why === 'autocap-off'
    && Object.keys(g.w.win.__mpw4kAutoCap.seen).length === 0 && g.r.api.resMaxEff(g.section) === 0
    && g.r.notes.length === 1 && g.r.notes[0] === I18N_ZH.perfNote4kAdvisory && g.section.resMax === void 0,
    JSON.stringify({ why: n && n.autoCap.why, notes: g.r.notes, seen: Object.keys(g.w.win.__mpw4kAutoCap.seen) }))
}
{
  // ⑥宿主明确回"没有 ffmpeg"⇒ 不动（拿不到可用信号就不降档）
  const g = dWorld({ section: { image: HOST4K, blur: 12, unifyTint: true, unifyAmount: 30 }, ffmpeg: false })
  const n = g.r.api.perf(3840, 2160)
  ok('D6 宿主转码明确不可用（ffmpeg found=false）⇒ 不写盘、不软重挂（why=no-transcode）、提示退回旧建议',
    noWrite(g) && remounts(g).length === 0 && !!n && n.autoCap.why === 'no-transcode'
    && g.r.notes.length === 1 && g.r.notes[0] === I18N_ZH.perfNote4kAdvisory && g.section.resMax === void 0,
    JSON.stringify({ why: n && n.autoCap.why, notes: g.r.notes }))
}
{
  // ⑥b 读数**未知**（从没探过）⇒ 同样不动（不是"当作可用"）
  const g = dWorld({ section: { image: HOST4K, blur: 0, unifyTint: false, unifyAmount: 0 } })
  const n = g.r.api.perf(3840, 2160)
  ok('D7 转码读数未知（没探过）⇒ 不写盘、不软重挂（why=no-transcode）、不提示（也没开虚化）；把这条结论记进 seen（失败不重试）',
    noWrite(g) && remounts(g).length === 0 && n === null
    && g.w.win.__mpwPerfNote.autoCap.why === 'no-transcode' && g.w.win.__mpw4kAutoCap.seen[HOST4K].why === 'no-transcode',
    JSON.stringify({ why: g.w.win.__mpwPerfNote.autoCap.why, seen: g.w.win.__mpw4kAutoCap.seen }))
}
{
  // ⑥c 补探口本身（真实现 mpwFfmpegProbeKick）：一次一飞、探过不重试；落地即把最终读数交给"等读数"的补判。
  //    为什么单列：这是自动降档"等读数落地再判"那条路的进料口，必须自己可信（不能把 ReferenceError 当"没探"）。
  const g = dWorld({ section: { image: HOST4K, blur: 0, unifyTint: false, unifyAmount: 0 } })
  g.r.api.kickProbe('4k')
  g.r.api.kickProbe('4k')
  const oneFlight = g.r.fetchCalls.length === 1
  g.r.pendingFetches[0].resolve({ ok: true, json: async () => ({ ok: true, found: true, source: 'system' }) })
  await new Promise((r) => setTimeout(r, 0))
  ok('D7b 补探口（真实现）：连踢两次只发一次 `/ffmpeg-check`（一次一飞、探过不重试）；落地后读数变"可用"',
    oneFlight && g.r.api.ffmpeg() === true,
    JSON.stringify({ fetches: g.r.fetchCalls.length, ready: g.r.api.ffmpeg() }))
}
{
  /* 回归闸门（lib 已修，2026-10-02）：真源 `mpwAutoCap4kForSource` 里曾有一行**重复的空**
     `else if (d.why === "no-transcode") { }`（后一个同名分支里才是 `mpwFfmpegProbeKick("4k")`），
     把"顺手补探"变成了死代码 ⇒ 真机上读数未知那一次不补探（A11 的 applyInner 预热探测仍在，所以不是"完全没探"）。
     现在真源已去掉重复分支；本条**反向**自证判据仍有分辨力：把重复空分支改回去再跑同一输入，
     补探**真的**变 0 次（死代码复现）⇒ 真源那 1 次不是"恒真"，而是这条分支真的在跑。 */
  const mk = (mutate) => {
    const w = mkWorld({ bgBase: 'rgb(249,250,251)' })
    const r = loadAssist(w, { image: HOST4K, blur: 0, unifyTint: false, unifyAmount: 0 }, mutate ? { mutate } : {})
    r.api.perf(3840, 2160)
    return r
  }
  const DUP_BRANCH = '} else if (d.why === "no-transcode") {'
  const mut = mk((code) => mutateAnchor(code, DUP_BRANCH, DUP_BRANCH + ' } else if (d.why === "no-transcode") {'))
  const real = mk(null)
  ok('D7c 真源已去掉重复的空 `else if` ⇒ 同一输入下真源补探 1 次（一次一飞）；把重复空分支改回去 ⇒ 补探变 0 次（旧 bug 复现）⇒ 判据非恒真',
    real.fetchCalls.length === 1 && mut.fetchCalls.length === 0
    && (SRC.match(/\} else if \(d\.why === "no-transcode"\) \{\s*\} else if \(d\.why === "no-transcode"\) \{/) || []).length === 0,
    JSON.stringify({ mutant: mut.fetchCalls.length, real: real.fetchCalls.length }))
}
{
  // ⑦落盘口：桥拿不到（设置面板没开 = 真机常态）⇒ 照样降档 —— 因为新实现压根不落盘（不依赖落盘口）
  const g = dWorld({ section: { image: HOST4K, blur: 0, unifyTint: false, unifyAmount: 0 }, ffmpeg: true, withBridge: false })
  const n = g.r.api.perf(3840, 2160)
  ok('D8 面板桥拿不到（设置面板没挂载）⇒ 仍自动降档：临时覆盖 + 软重挂 1080p；**一次落盘都没有**（无 commit、无 writeSection、不通知面板重读）',
    noWrite(g) && g.w.win.__notified === void 0 && !!n && n.autoCap.applied === true && n.autoCap.why === 'applied'
    && remounts(g).length === 1 && remounts(g)[0] === T4K_A
    && g.r.api.resMaxEff(g.section) === 1920 && g.section.resMax === void 0,
    JSON.stringify({ autoCap: n && n.autoCap, remount: remounts(g), notified: g.w.win.__notified }))
}
{
  // ⑦b 两条落盘口都拿不到（桥没有 + writeSection 会抛）⇒ 依旧生效：不是"降档降级了"，而是**降档不需要落盘口**。
  //     （旧实现这里必然是 no-commit-path / applied=false —— 这条判据就是那次改动的分界线。）
  const g = dWorld({ section: { image: HOST4K, blur: 0, unifyTint: false, unifyAmount: 0 }, ffmpeg: true, withBridge: false })
  g.w.win.__noWriteSection = true
  const n = g.r.api.perf(3840, 2160)
  ok('D8b 桥与 writeSection 都拿不到（writeSection 还会抛）⇒ 自动降档不受影响（applied=true、why 不再是 no-commit-path）：临时覆盖 + 一次软重挂，且没有触发任何写入',
    noWrite(g) && !!n && n.autoCap.applied === true && n.autoCap.why === 'applied'
    && g.w.win.__mpwPerfNote.autoCap.applied === true && remounts(g).length === 1 && g.section.resMax === void 0,
    JSON.stringify({ autoCap: g.w.win.__mpwPerfNote.autoCap, remount: remounts(g) }))
}
{
  // ⑧scene 内嵌视频（sv=1）即便 ≥4K + 转码可用 ⇒ 不动（降不下来，动作了会骗用户）
  const g = dWorld({ section: { image: SV4K, blur: 0, unifyTint: false, unifyAmount: 0 }, ffmpeg: true })
  const n = g.r.api.perf(3840, 2160)
  ok('D9 scene 内嵌视频（sv=1，mpwTranscodeSpec 判 useTranscode=false）⇒ 不写盘、不软重挂（why=not-transcodable）',
    noWrite(g) && remounts(g).length === 0 && n === null && g.w.win.__mpwPerfNote.autoCap.why === 'not-transcodable' && g.section.resMax === void 0,
    JSON.stringify(g.w.win.__mpwPerfNote.autoCap))
}
{
  // ⑨resMax 显式为 0（= DEFAULT_RES_MAX，面板"无限制"档）⇒ 按"没设过上限"处理
  const g = dWorld({ section: { image: HOST4K, resMax: 0, blur: 0, unifyTint: false, unifyAmount: 0 }, ffmpeg: true })
  const n = g.r.api.perf(3840, 2160)
  ok('D10 resMax=0（默认"不限制"）⇒ 视同没设过上限 ⇒ 临时覆盖 1920 + 软重挂 1080p；档里仍是 0（**不写盘**）',
    noWrite(g) && !!n && n.autoCap.applied === true && remounts(g).length === 1 && remounts(g)[0] === T4K_A
    && g.r.api.resMaxEff(g.section) === 1920 && g.section.resMax === 0,
    JSON.stringify({ remounts: remounts(g), resMax: g.section.resMax }))
}
{
  // ⑩boot 窗口：上一版在这里写下 resMax、再被"两处存储合并"盖回 ⇒ 需要收尾补写。
  //    现在不落盘 ⇒ 既没有"被盖回"的问题，也不该排任何补写待办；临时覆盖在本次会话里照常生效。
  const g = dWorld({ section: { image: HOST4K, blur: 0, unifyTint: false, unifyAmount: 0 }, ffmpeg: true, bootPending: true })
  const n = g.r.api.perf(3840, 2160)
  const before = remounts(g).length
  const settled = g.r.api.settleBoot()
  ok('D11 boot 期间自动降档 ⇒ 不写盘、也不排"boot 收尾补写"待办；收尾（settleBoot=true）后盘上仍无 resMax、不补写、不再软重挂；临时覆盖仍生效（1920）',
    noWrite(g) && !!n && n.autoCap.applied === true && n.autoCap.reasserted === void 0
    && settled === true && g.r.api.bootPending() === false
    && g.section.resMax === void 0 && remounts(g).length === before && g.r.api.resMaxEff(g.section) === 1920
    && g.w.win.__mpw4kAutoCap.mode === 'transient' && g.r.notes.length === 1,
    JSON.stringify({ autoCap: n && n.autoCap, remounts: remounts(g), settled: settled, mode: g.w.win.__mpw4kAutoCap.mode }))
  // 对照组：不是 boot 窗口（收尾后）就没这条待办
  const g2 = dWorld({ section: { image: HOST4K, blur: 0, unifyTint: false, unifyAmount: 0 }, ffmpeg: true })
  g2.r.api.perf(3840, 2160)
  const settled2 = g2.r.api.settleBoot()
  ok('D11b 对照组：非 boot 窗口 ⇒ boot 收尾不复跑待办（settleBoot 返回 false）、不写盘、临时覆盖不变',
    settled2 === false && noWrite(g2) && g2.section.resMax === void 0 && g2.r.api.resMaxEff(g2.section) === 1920,
    JSON.stringify({ settled: settled2, writes: g2.w.win.__writes || null }))
}
{
  // ⑫探测"在飞"（已发出、答案还没回来）⇒ 不当场判"拿不到"，等落地后用最终读数判**一次**
  const g = dWorld({ section: { image: HOST4K, blur: 12, unifyTint: true, unifyAmount: 30 } })
  g.r.api.kickProbe('apply')                          // 模拟 applyInner 的预热探测：已发出、答案未回
  const n1 = g.r.api.perf(3840, 2160)
  const inFlightParts = { fetches: g.r.fetchCalls.length, remounts: remounts(g).length, ret: n1 === null, why: g.w.win.__mpwPerfNote.autoCap.why, seen: Object.keys(g.w.win.__mpw4kAutoCap.seen).length }
  const inFlight = inFlightParts.fetches === 1 && inFlightParts.remounts === 0 && inFlightParts.ret
    && inFlightParts.why === 'await-transcode-probe' && inFlightParts.seen === 0
  g.r.pendingFetches[0].resolve({ ok: true, json: async () => ({ ok: true, found: true, source: 'system' }) })
  await new Promise((r) => setTimeout(r, 0))          // 让 then 链跑完（探测落地 → 叫醒等待者）
  ok('D13 读数在飞 ⇒ 先记 why=await-transcode-probe（不写 seen、不动作、不提示）；探测落地(found=true)后补判一次 ⇒ 恰好一次软重挂 maxW=1920 + 一条提示，**仍不写盘**',
    inFlight && noWrite(g) && remounts(g).length === 1 && remounts(g)[0] === T4K_A
    && polls(g).length === 1 && polls(g)[0].maxW === 1920
    && g.section.resMax === void 0 && g.r.notes.length === 1 && g.r.notes[0] === I18N_ZH.perfNote4kAuto
    && g.w.win.__mpwPerfNote.autoCap.applied === true && Object.keys(g.w.win.__mpw4kAutoCap.seen).length === 1,
    JSON.stringify({ inFlight: inFlightParts, remounts: remounts(g), notes: g.r.notes, autoCap: g.w.win.__mpwPerfNote.autoCap }))
}
{
  // ⑫b 对照组：探测落地(found=false，明确不可用) ⇒ 补判结论 = no-transcode（不再动作、提示退回旧建议）
  const g = dWorld({ section: { image: HOST4K, blur: 12, unifyTint: true, unifyAmount: 30 } })
  g.r.api.kickProbe('apply')
  g.r.api.perf(3840, 2160)
  g.r.pendingFetches[0].resolve({ ok: true, json: async () => ({ ok: true, found: false, source: null }) })
  await new Promise((r) => setTimeout(r, 0))
  ok('D13b 探测落地 found=false ⇒ 补判为 no-transcode：不写盘、不软重挂、提示退回旧建议、seen 记下这次结论（不重试）',
    noWrite(g) && remounts(g).length === 0 && g.section.resMax === void 0
    && g.r.notes.length === 1 && g.r.notes[0] === I18N_ZH.perfNote4kAdvisory
    && g.w.win.__mpwPerfNote.autoCap.why === 'no-transcode' && g.w.win.__mpw4kAutoCap.seen[HOST4K].why === 'no-transcode',
    JSON.stringify({ autoCap: g.w.win.__mpwPerfNote.autoCap, seen: g.w.win.__mpw4kAutoCap.seen }))
}
{
  // ⑬busy **完全静默**（2026-10-02 用户拍板，原话"不弹条"）：自动降档是**后台行为** ⇒ 它引起的进度事件一律不进进度条：
  //    ① 占位事件 `{auto:true}` 被 `mpwBusyEmit` 拦下；② 软重挂起来的**真实**转码进度（label 以 `tc:` 开头）
  //    被 `mpwAutoCapSilence(true)` 打开的静音窗口拦下（`mpwBusyEmit` 里第二道守卫）。
  //    为什么这样判：`mpw:busy` 是组件进度条的唯一进料口（组件 onBusy 收到 detail 就 setBusyState({visible:true})）
  //    ⇒ 判据直接看**真窗口派发出去的事件**（真实现 mpwBusyEmit + 真 pollTranscodeProgress），不是查字符串；
  //    "事件确实会被发出"由 E10 变异自证（去掉静音窗口守卫 ⇒ 它出现在派发里 ⇒ 本判据必红）。
  //    ⚠ 上一版口径（已作废）：只拦占位事件、真实 `tc:` 进度照弹（"真的在转码时显示"）；用户拍板"不弹条"后
  //    连真实进度也静默。轮询本身照跑（真机上宿主照样转码）⇒ 判据同时要求 `/transcode-progress?...maxW=1920`
  //    真的发出去了、且窗口确实开着，否则"零派发"可能只是"轮询没跑"（上一版夹具漏切 mpwAutoCapSilence 时就是这形态）。
  const g = dWorld({ section: { image: HOST4K, blur: 0, unifyTint: false, unifyAmount: 0 }, ffmpeg: true, realPoll: true })
  g.r.api.busy({ auto: true })                        // 单元：占位事件本身必须零派发
  const afterUnit = busyEvents(g).length
  const n = g.r.api.perf(3840, 2160)
  const evs = busyEvents(g)
  const silentDuring = g.r.api.silent()               // 静音窗口（真声明 + 真实现）：零派发必须是它拦下的，不是"没事件"
  ok('D14 自动降档期间**完全静默**：占位事件零派发、真实转码进度也零派发（进度条不被这一步点亮），但 1080p 档的进度轮询确实发出去了',
    afterUnit === 0 && !!n && n.autoCap.applied === true
    && silentDuring === true
    && evs.length === 0
    && g.r.fetchCalls.some((u) => /\/transcode-progress\?src=.*maxW=1920/.test(u)),
    JSON.stringify({ unit: afterUnit, events: evs, silent: silentDuring, fetches: g.r.fetchCalls }))
}
{
  // ⑭i18n 取不到时回退中文，绝不把键名当文案弹出去（mpwT 未接线的降级路径）
  const w = mkWorld({ bgBase: 'rgb(249,250,251)' })
  const s = { image: HOST4K, blur: 0, unifyTint: false, unifyAmount: 0 }
  const commits = []
  const r = loadAssist(w, s, { mutate: (code) => mutateAnchor(code, 'const mpwT = (k) => (__i18n[k] !== void 0 ? __i18n[k] : k);', 'const mpwT = (k) => k;') })
  r.api.setBridge({ commit: (patch) => { commits.push(patch); Object.assign(s, patch) } })
  r.api.noteFfmpeg(true, 'system')
  const n = r.api.perf(3840, 2160)
  ok('D12 `mpwT` 未接线（取词返回键名）⇒ 文案回退中文原文（不把 `perfNote4kAuto` 当消息弹给用户）；降档照做（软重挂一次）且不写盘',
    commits.length === 0 && w.win.__writes === void 0 && !!n && r.notes.length === 1
    && /已自动降到 1080p（可在设置里改回）/.test(r.notes[0]) && !/^perfNote4kAuto$/.test(r.notes[0])
    && (w.win.__remounts || []).length === 1 && s.resMax === void 0,
    JSON.stringify(r.notes))
}
console.log('\n== E 组：变异自证（真源零改动；改坏关键判断必红）==')
{
  const mut = (from, to) => FN_APPLY.includes(from) && FN_APPLY.replace(from, to) !== FN_APPLY
  ok('E1 变异①：去掉"宿主必须半透明"前提 ⇒ B4 必红（默认主题下也会动外框）',
    mut("theme.translucent)", "true)"))
  ok('E2 变异②：去掉"必须有不透明背景"过滤 ⇒ B1 的"只命中一个"必红（半透明外框也被改写）',
    FN_FRAMES.includes('mpwColorAlpha(cs.backgroundColor) < 0.999'))
  ok('E3 变异③：去掉"铺满视口"过滤 ⇒ B1 的小节点也会被改写（判据里 small 断言必红）',
    FN_FRAMES.includes('r.width < W * 0.9'))
  ok('E4 变异④：还原时不清 `data-mpw-frame-transparent` ⇒ B3 必红',
    FN_REVERT.includes('removeAttribute("data-mpw-frame-transparent")'))
  ok('E5 变异⑤：输入框属性改成无条件设置 ⇒ C 组"不应用"的几组必红',
    FN_APPLY.includes('if (enabled && composer)'))
}
{
  /* 下面五条是**真变异**：把关键判断改坏后跑同一组输入，证明对应判据确实有分辨力
     （只断言"源码里有这个字符串"是不够的 —— 那不能证明判据会红）。 */
  // E6：删掉"用户已设过 resMax ⇒ 不动" ⇒ D3 的输入下变异体会**真的软重挂 maxW=1920**（压过用户设的 2560）
  const mk = (mutate) => {
    const w = mkWorld({ bgBase: 'rgb(249,250,251)' })
    const s = { image: HOST4K, resMax: 2560, blur: 12, unifyTint: true, unifyAmount: 30 }
    const r = loadAssist(w, s, mutate ? { mutate } : {})
    r.api.noteFfmpeg(true, 'system')
    return { out: r.api.autoCap(3840, 2160), remounts: (w.win.__remounts || []), writes: (w.win.__writes || []), eff: r.api.resMaxEff(s) }
  }
  const m = mk((code) => mutateAnchor(code, 'if (isFinite(r) && r > 0) return { act: false, why: "resmax-set", resMax: 0 };', ''))
  const real = mk(null)
  ok('E6 变异⑥：删掉"用户已设过 resMax ⇒ 不动" ⇒ 变异体在 D3 的输入下**真的**软重挂 maxW=1920（读取口仍是用户的 2560，但重挂 URL 压过它 ⇒ D3 必红），真源不动作',
    m.out.applied === true && m.remounts.length === 1 && /maxW=1920/.test(m.remounts[0])
    && real.out.applied === false && real.remounts.length === 0 && real.out.why === 'resmax-set' && real.eff === 2560,
    JSON.stringify({ mutant: m.out, real: real.out }))
}
{
  // E7：删掉 `?autocap=off` 回退口判断 ⇒ 变异体在回退口下照样软重挂 1080p（D5 必红）
  const mk = (mutate) => {
    const w = mkWorld({ bgBase: 'rgb(249,250,251)' }); w.win.location.search = '?autocap=off'
    const s = { image: HOST4K, blur: 0, unifyTint: false, unifyAmount: 0 }
    const r = loadAssist(w, s, mutate ? { mutate } : {})
    r.api.noteFfmpeg(true, 'system')
    return { out: r.api.autoCap(3840, 2160), remounts: (w.win.__remounts || []) }
  }
  const m = mk((code) => mutateAnchor(code, 'if (autocapOff) return { act: false, why: "autocap-off", resMax: 0 };', ''))
  const real = mk(null)
  ok('E7 变异⑦：删掉 `?autocap=off` 判断 ⇒ 变异体在回退口下也软重挂 1080p（D5 必红），真源一个字不动',
    m.out.applied === true && m.remounts.length === 1 && real.out.applied === false && real.remounts.length === 0
    && real.out.why === 'autocap-off', JSON.stringify({ mutant: m.out, real: real.out }))
}
{
  // E9：删掉读取口的"用户设过 ⇒ 用户优先" ⇒ 临时覆盖会压过用户自己设的 3000（D1b 必红）
  const mk = (mutate) => {
    const w = mkWorld({ bgBase: 'rgb(249,250,251)' })
    const s = { image: HOST4K, blur: 0, unifyTint: false, unifyAmount: 0 }
    const r = loadAssist(w, s, mutate ? { mutate } : {})
    r.api.noteFfmpeg(true, 'system')
    r.api.autoCap(3840, 2160)                        // 先落下临时覆盖 1920（此刻用户还没设上限）
    return { effUser: r.api.resMaxEff(Object.assign({}, s, { resMax: 3000 })), effNoUser: r.api.resMaxEff(s) }
  }
  const m = mk((code) => mutateAnchor(code, 'if (own > 0) return own;', ''))
  const real = mk(null)
  ok('E9 变异⑨：删掉读取口的"用户设过 ⇒ 用户优先" ⇒ 变异体在用户设了 3000 时返回临时覆盖的 1920（D1b 必红），真源返回用户的 3000',
    m.effUser === 1920 && m.effNoUser === 1920 && real.effUser === 3000 && real.effNoUser === 1920,
    JSON.stringify({ mutant: m.effUser, real: real.effUser }))
}
{
  /* E10：删掉 `mpwBusyEmit` 的**静音窗口**守卫（`mpwAutoCapSilent && label 以 "tc:" 开头 ⇒ return`）
     ⇒ 自动降档期间的真实转码进度**真的**进派发（进度条被点亮）⇒ D14 必红；真源零派发。
     这条同时证明 D14 不是恒真：两次跑的静音窗口都开着（`silent() === true`，同一个真实现），
     差别只在那一行守卫 —— 而锚点 `SILENCE_GUARD` 必须真在切出来的 `FN_BUSY` 里（否则变异没发生 ⇒ 自证无效）。
     注：占位事件的 `payload.auto === true` 守卫留着不动 ⇒ 变异体多出来的事件只能来自真实 `tc:` 进度，
     即这次变异精确地打在"完全静默"新增的那一层上（2026-10-02 用户拍板原话"不弹条"）。 */
  const SILENCE_GUARD_IN_BUSY = 'if (mpwAutoCapSilent && payload && typeof payload.label === "string" && payload.label.indexOf("tc:") === 0) return'
  const mk = (mutate) => {
    const w = mkWorld({ bgBase: 'rgb(249,250,251)' })
    const r = loadAssist(w, { image: HOST4K, blur: 0, unifyTint: false, unifyAmount: 0 },
      Object.assign({ realPoll: true }, mutate ? { mutate } : {}))
    r.api.noteFfmpeg(true, 'system')
    r.api.autoCap(3840, 2160)
    return {
      events: (w.win.__events || []).filter((e) => e && e.type === 'mpw:busy').map((e) => e.detail),
      silent: r.api.silent(),
    }
  }
  /* 变异锚点 = 静音窗口那一行（占位守卫已不是唯一防线：现在连真实进度都不许派发） */
  const m = mk((code) => mutateAnchor(code, SILENCE_GUARD_IN_BUSY, ''))
  const real = mk(null)
  ok('E10 变异⑩：删掉"自动降档静音窗口"守卫 ⇒ 变异体把真实转码进度放出去（D14 必红）；真源零派发（两次静音窗口都开着 ⇒ 差别只在那行守卫）',
    FN_BUSY.includes(SILENCE_GUARD_IN_BUSY)
    && m.silent === true && real.silent === true
    && m.events.some((d) => d && String(d.label || '').indexOf('tc:') === 0) && real.events.length === 0,
    JSON.stringify({ guardInSlicedFn: FN_BUSY.includes(SILENCE_GUARD_IN_BUSY), mutant: m.events, real: real.events, silent: [m.silent, real.silent] }))
}
{
  // E8：删掉"用户显式关过 ⇒ 永不自动开"守卫 ⇒ 变异体在半透明宿主 + 用户显式关时也自动开（C2 必红）
  const mk = (mutate) => {
    const w = mkWorld({ bgBase: 'rgba(255,255,255,0.2)' })
    const r = loadAssist(w, { image: 'x', composerBlur: false, composerBlurUserSet: true }, mutate ? { mutate } : {})
    return r.api.apply({ image: 'x', composerBlur: false, composerBlurUserSet: true })
  }
  const m = mk((code) => mutateAnchor(code, 'if (userSet) return { on: raw, mode: raw ? "user-on" : "user-off" };', ''))
  const real = mk(null)
  ok('E8 变异⑧：删掉 composerBlurUserSet 守卫 ⇒ 变异体在"用户显式关过"时也自动开（C2 必红），真源尊重手动关',
    m.composerOn === true && m.composerMode === 'auto-translucent' && real.composerOn === false && real.composerMode === 'user-off',
    JSON.stringify({ mutant: [m.composerOn, m.composerMode], real: [real.composerOn, real.composerMode] }))
}

console.log(`\n===== theme-assist: ${pass} 通过 / ${fail} 失败 =====`)
if (!fail) console.log('✓ 半透明主题适配口径成立：外框只在（有壁纸 + 开关开 + 宿主半透明）三条同时成立时动且可逐字还原；输入框磨砂半透明下自动开、用户动过就听用户的；≥4K 源在（转码可用 + 没设过上限 + 每壁纸一次 + 没被 ?autocap=off 挡）时只对当前壁纸**临时**降 1080p（不写设置、不弹条＝占位与真实转码进度都静默、换壁纸即失效，用户设了上限就让位）')
process.exit(fail ? 1 : 0)
