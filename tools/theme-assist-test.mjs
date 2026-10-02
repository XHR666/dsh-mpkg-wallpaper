// theme-assist-test.mjs —— 半透明主题适配（应用外框 / 输入框磨砂 / ≥4K 默认降 1080p）的离线判据
//
// 病（issue #4 的两条 + 一条性能建议；同形规则已在宿主 bundle 里核过）：
//   宿主把 `--dsw-alias-bg-base` 调成半透明（用户自定义 CSS 想让壁纸透出来）后：
//     (A) 应用外框 `[class*="_frame"]` 仍**不透明**地盖在壁纸层（z-index:-1）之上 ⇒ 壁纸完全不可见；
//     (B) 输入框 `[class*="composerSeat"]` 的遮罩渐变终点 = `--dsw-alias-bg-base` ⇒ 底色半透明后
//         它遮不住滚到输入框下面的正文（正文糊进输入框）；
//     (C) 4K 源 + 壁纸层虚化 ⇒ 桌面端明显卡（旧实现只提示，不改默认值；2026-10-02 用户第 1 项起
//         **默认自动降到 1080p**，带 `?autocap=off` 回退口）。
//   版本事实（决定了"必须运行期探测"）：**不同宿主构建的取色变量不同**（一个用 `--dsw-alias-bg-base`、
//   另一个用 `--dsw-specific-sidebar-fill` 且算出来同色）⇒ 类名带哈希、取色变量随构建变。
//
// 本文件判据（纯 Node + 桩 DOM，不开浏览器）：
//   A 组 纯函数/静态：alpha 解析、默认值、CSS 文本与选择器特异性、设置行与 i18n 接线、
//                     两项新行为的**接线判据**（自动降档常量/判据函数/回退口/台账；用户动过标记；
//                     ffmpeg 读数口；面板显示生效值）
//   B 组 行为（桩 DOM）：外框透明化的**三条前提**（有壁纸 / 开关开 / 宿主半透明）逐条翻转；
//                       只动"不透明 + 铺满视口 + 不在壁纸层内"的节点；幂等；关掉后**逐字还原**
//   C 组 输入框磨砂：①半透明 + 用户没动过 ⇒ 自动应用 + 台账 `composer: "auto-translucent"`；
//                     ②半透明 + 用户显式关过（composerBlurUserSet）⇒ 永不自动开；
//                     ③不透明（默认）主题 ⇒ 不动作；④关掉 themeAssist ⇒ 不动作；
//                     ⑤用户显式开 ⇒ 照开；⑥自动开过之后用户显式关 ⇒ 属性与样式节点**摘除无残留**
//   D 组 ≥4K 自动降 1080p：①转码可用 + resMax 未设 ⇒ 一次 commit({resMax:1920}, true) + 新文案；
//                     ②<4K ⇒ 不动；③用户已设过 resMax ⇒ 不动；④同一壁纸第二次 ⇒ 不动（去重）；
//                     ⑤`?autocap=off` ⇒ 不动（行为同今天）；⑥转码不可用/拿不到 ⇒ 不动；
//                     ⑦面板桥拿不到 ⇒ 走同一落盘路径 writeSection（真机常态）+ 都不通 ⇒ 不动；
//                     ⑧scene 内嵌视频（不可转码）⇒ 不写档；⑨resMax=0 ⇒ 视同未设；
//                     ⑩boot 窗口内写下的被存储合并盖回 ⇒ 收尾后补写一次；
//                     ⑪读数"在飞" ⇒ 等探测落地再判一次（不写 seen）；⑫取词失败 ⇒ 文案回退中文
//   E 组 变异自证：把关键判断改坏（外框/还原/输入框/自动降档/回退口/自动档守卫）⇒ 对应判据必红
//                     （E6–E8 是**真变异**：改坏后跑同一组输入，证明判据确实有分辨力）
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
const FN_AUTOCAP_COMMIT = sliceFn('mpwAutoCapCommit')
const FN_AUTOCAP_MAIN = sliceFn('mpwAutoCap4kForSource')
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
  }
  return { doc, win, html, body, wrap, head, all, styleFor }
}
/** 把切片 + 桩环境拼成一个可执行的 apply/revert/自动降档（就是 lib 里那几段原文，只换外部依赖）。
 *  `extra.mutate(code)`：对拼好的源码做**变异**（E 组自证用；真源零改动）。 */
function loadAssist(world, section, extra = {}) {
  const raw = [
    'const window = __win; const document = __doc; const location = __win.location;',
    'const DEFAULT_THEME_ASSIST = true; const DEFAULT_COMPOSER_BLUR = false; const DEFAULT_BLUR = 12; const DEFAULT_UNIFY_AMOUNT = 30;',
    'const ALLOWED_FPS = [24, 30, 48, 60]; const HOST_URL = "http://127.0.0.1:1/api/mpkg-wallpaper";',
    'const getComputedStyle = __cs; const bgElements = () => ({ wrap: __wrap });',
    'const readSection = () => __section; const mpwPersistEmit = (m) => { __notes.push(String(m)) };',
    'const fetch = __fetch;',
    /* 落盘口桩：`__win.__noWriteSection` = 连模块级 writeSection 也拿不到（D8 的"两条口都没有"）。
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
    FN_AUTOCAP_LEDGER, FN_AUTOCAP_KEY, FN_AUTOCAP_COMMIT, FN_AUTOCAP_MAIN,
    FN_FF_NOTE, FN_FF_KNOWN, FN_FF_KICK, FN_FF_INFLIGHT, FN_FF_WAITER, FN_PERF_MSG, FN_ANNOUNCE, FN_ON_BOOT, FN_BOOT_SETTLE,
    'return { alpha: mpwColorAlpha, theme: mpwThemeState, apply: mpwApplyThemeAssist, revert: mpwRevertThemeAssist,'
    + ' perf: mpwPerfNoteForSource, composer: mpwComposerBlurEffective, autoCap: mpwAutoCap4kForSource,'
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
ok('A7 ≥4K 自动降档：常量/判据函数/回退口/两份台账都在源码里（`MPW_4K_AUTOCAP_RES = 1920`、`?autocap=off`、`__mpw4kAutoCap`、`__mpwPerfNote.autoCap`）',
  /const MPW_4K_AUTOCAP_RES = 1920;/.test(SRC) && /function mpw4kAutoCapDecision\(/.test(SRC)
  && /get\("autocap"\) === "off"/.test(SRC) && /window\.__mpw4kAutoCap/.test(SRC)
  && /n\.autoCap = out;/.test(SRC) && /b\.commit\(\{ resMax: resMax \}, true, true\)/.test(SRC))
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
ok('A14 落盘口两条路：优先面板桥 commit，桥拿不到（面板没挂载）时回退同一落盘路径 writeSection + 通知面板重读',
  /if \(b && typeof b\.commit === "function"\) \{ b\.commit\(\{ resMax: resMax \}, true, true\); return true \}/.test(SRC)
  && /writeSection\(Object\.assign\(\{\}, cur, full\), true\)/.test(SRC) && /mpwSectionNotify\(\)/.test(FN_AUTOCAP_COMMIT))
ok('A15 读数"在飞"不算"拿不到"：判据函数出 `await-transcode-probe`，落地后由 mpwOnFfmpegProbe 补判一次（不写 seen、不重试、换壁纸判废）',
  /if \(ffInFlight === true\) return \{ act: false, why: "await-transcode-probe", resMax: 0 \};/.test(FN_AUTOCAP_DECISION)
  && /mpw4kAutoCapDecision\(W, H, sec\.resMax, mpwFfmpegReadyKnown\(\), mpwAutoCapOff\(\),\s*dup, mpw4kAutoCapTranscodable\(sec\), mpwFfmpegProbeInFlight\(\)\)/.test(FN_AUTOCAP_MAIN)
  && /d\.why !== "await-transcode-probe"/.test(FN_AUTOCAP_MAIN) && /mpwOnFfmpegProbe\(\(\) => \{/.test(FN_AUTOCAP_MAIN)
  && /expectKey && expectKey !== key/.test(FN_AUTOCAP_MAIN))

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

console.log('\n== D 组：≥4K 源 ⇒ 默认降到 1080p（自动降档）+ 一次性提示 ==')
const HOST4K = 'host:?ltoken=t&file=4k.mp4'          // 可走宿主转码的宿主流视频源（host: 前缀）
const SV4K = 'sv=1&host:?ltoken=t&file=scene.mp4'    // scene 内嵌视频（宿主 /transcode 认不出 ⇒ 不可转码）
/** D 组世界：commit 桩同时**把 patch 写回档**（真 commit 也是落盘改档）⇒ 第二次的判据才有意义。 */
function dWorld({ section = {}, search = '', ffmpeg, withBridge = true, bgBase = 'rgb(249,250,251)', bootPending = false } = {}) {
  const w = mkWorld({ bgBase })
  w.win.location.search = search
  w.win.__bootPending = bootPending
  const commits = []
  const r = loadAssist(w, section)
  if (withBridge) r.api.setBridge({ commit: (patch, instant, defer) => { commits.push({ patch, instant, defer }); Object.assign(section, patch) } })
  if (ffmpeg !== void 0) r.api.noteFfmpeg(ffmpeg, ffmpeg ? 'system' : '')
  return { w, r, commits, section }
}
{
  // ①全部条件满足 ⇒ 一次 commit({resMax:1920}, instant=true) + 新文案 + 台账
  const g = dWorld({ section: { image: HOST4K, blur: 12, unifyTint: true, unifyAmount: 30 }, ffmpeg: true })
  const n1 = g.r.api.perf(3840, 2160)
  ok('D1 3840×2160 + resMax 未设 + 宿主转码可用 ⇒ 恰好一次 `commit({resMax:1920}, true)`（只带这一个键，优先走面板桥），提示"已自动降到 1080p（可在设置里改回）"',
    g.commits.length === 1 && JSON.stringify(g.commits[0].patch) === '{"resMax":1920}' && g.commits[0].instant === true
    && g.w.win.__writes === void 0
    && !!n1 && n1.autoCap.applied === true && n1.autoCap.resMax === 1920 && n1.autoCap.why === 'applied'
    && g.r.notes.length === 1 && g.r.notes[0] === I18N_ZH.perfNote4kAuto
    && g.w.win.__mpw4kAutoCap.applied === true && g.w.win.__mpw4kAutoCap.resMax === 1920
    && g.section.resMax === 1920 && g.w.win.__mpwPerfNote.autoCap === n1.autoCap,
    JSON.stringify({ commits: g.commits, notes: g.r.notes, autoCap: n1 && n1.autoCap }))
}
{
  // ②<4K ⇒ 不动（连台账都不建：与旧行为逐字一致）
  const g = dWorld({ section: { image: HOST4K, blur: 12, unifyTint: true, unifyAmount: 30 }, ffmpeg: true })
  const n = g.r.api.perf(1920, 1080)
  ok('D2 1920×1080（<4K）⇒ 不 commit、不提示、不写任何台账（1080p 及以下源的行为一字不改）',
    n === null && g.commits.length === 0 && g.r.notes.length === 0 && g.w.win.__mpwPerfNote === void 0 && g.section.resMax === void 0,
    JSON.stringify({ notes: g.r.notes, resMax: g.section.resMax }))
}
{
  // ③用户已设过 resMax（>0）⇒ 不动，且不再打扰（旧建议也压掉）
  const g = dWorld({ section: { image: HOST4K, resMax: 2560, blur: 12, unifyTint: true, unifyAmount: 30 }, ffmpeg: true })
  const n = g.r.api.perf(3840, 2160)
  ok('D3 用户已设 resMax=2560 ⇒ 不 commit（why=resmax-set）、不提示（尊重用户已设的上限）',
    g.commits.length === 0 && n === null && g.r.notes.length === 0 && g.w.win.__mpwPerfNote.autoCap.why === 'resmax-set',
    JSON.stringify({ why: g.w.win.__mpwPerfNote.autoCap.why, notes: g.r.notes }))
}
{
  // ④同一壁纸第二次（metadata 再触发一次）⇒ 去重、不再动
  const g = dWorld({ section: { image: HOST4K, blur: 0, unifyTint: false, unifyAmount: 0 }, ffmpeg: true })
  const n1 = g.r.api.perf(3840, 2160)
  const n2 = g.r.api.perf(3840, 2160)
  const seenKeys = Object.keys(g.w.win.__mpw4kAutoCap.seen)
  ok('D4 同一壁纸第二次 ⇒ 不再 commit（why=dup，提示也不重复），台账 seen 只有这一条',
    g.commits.length === 1 && n2 === null && g.w.win.__mpwPerfNote.autoCap.why === 'dup' && g.r.notes.length === 1
    && seenKeys.length === 1 && seenKeys[0] === HOST4K && !!n1,
    JSON.stringify({ commits: g.commits.length, why: g.w.win.__mpwPerfNote.autoCap.why, seen: seenKeys.length }))
}
{
  // ④b 换了另一张壁纸、而档里已有上限（上一张写进去的 1920）⇒ 也不再动
  const g = dWorld({ section: { image: HOST4K, blur: 0, unifyTint: false, unifyAmount: 0 }, ffmpeg: true })
  g.r.api.perf(3840, 2160)
  g.section.image = 'host:?ltoken=t&file=other4k.mp4'
  g.w.win.__mpwPerfNoteShown = false          // 提示已发过就把闸门重置，确保判定的是"降不降"而不是"提不提示"
  const r2 = g.r.api.autoCap(3840, 2160)
  ok('D4b 换到另一张 ≥4K 壁纸、但档里已有用户可见的上限（1920）⇒ 不再改档（why=resmax-set）',
    g.commits.length === 1 && r2.applied === false && r2.why === 'resmax-set', JSON.stringify(r2))
}
{
  // ⑤回退口 `?autocap=off` ⇒ 完全不自动降（行为同今天：有虚化时旧建议提示照旧）
  const g = dWorld({ section: { image: HOST4K, blur: 12, unifyTint: true, unifyAmount: 30 }, ffmpeg: true, search: '?autocap=off' })
  const n = g.r.api.perf(3840, 2160)
  ok('D5 `?autocap=off` + 全部条件满足 ⇒ 不 commit（why=autocap-off）、seen 为空（不记账）；有虚化 ⇒ 旧建议提示仍在（行为同今天）',
    g.commits.length === 0 && !!n && n.autoCap.why === 'autocap-off'
    && Object.keys(g.w.win.__mpw4kAutoCap.seen).length === 0
    && g.r.notes.length === 1 && g.r.notes[0] === I18N_ZH.perfNote4kAdvisory && g.section.resMax === void 0,
    JSON.stringify({ why: n && n.autoCap.why, notes: g.r.notes, seen: Object.keys(g.w.win.__mpw4kAutoCap.seen) }))
}
{
  // ⑥宿主明确回"没有 ffmpeg"⇒ 不动（拿不到可用信号就不写用户的档）
  const g = dWorld({ section: { image: HOST4K, blur: 12, unifyTint: true, unifyAmount: 30 }, ffmpeg: false })
  const n = g.r.api.perf(3840, 2160)
  ok('D6 宿主转码明确不可用（ffmpeg found=false）⇒ 不 commit（why=no-transcode）、提示退回旧建议',
    g.commits.length === 0 && !!n && n.autoCap.why === 'no-transcode' && g.r.notes.length === 1 && g.r.notes[0] === I18N_ZH.perfNote4kAdvisory
    && g.section.resMax === void 0,
    JSON.stringify({ why: n && n.autoCap.why, notes: g.r.notes }))
}
{
  // ⑥b 读数**未知**（从没探过）⇒ 同样不动（不是"当作可用"），并顺手补探一次（留读数、本次不动作）
  const g = dWorld({ section: { image: HOST4K, blur: 0, unifyTint: false, unifyAmount: 0 } })
  const n = g.r.api.perf(3840, 2160)
  ok('D7 转码读数未知（没探过）⇒ 不 commit（why=no-transcode）、不提示（也没开虚化）；补探一次且只探一次',
    g.commits.length === 0 && n === null && g.w.win.__mpwPerfNote.autoCap.why === 'no-transcode'
    && g.r.fetchCalls.length === 1 && /\/ffmpeg-check$/.test(g.r.fetchCalls[0]),
    JSON.stringify({ why: g.w.win.__mpwPerfNote.autoCap.why, fetch: g.r.fetchCalls }))
}
{
  // ⑦落盘口：桥拿不到（设置面板没开 = 真机常态）⇒ 走模块级 writeSection（同一条落盘路径）
  const g = dWorld({ section: { image: HOST4K, blur: 0, unifyTint: false, unifyAmount: 0 }, ffmpeg: true, withBridge: false })
  const n = g.r.api.perf(3840, 2160)
  const wr = (g.w.win.__writes || [])[0] || null
  ok('D8 面板桥拿不到（设置面板没挂载）⇒ 仍自动降档：走同一落盘路径的 writeSection（instant=true、档里含 resMax=1920），并通知面板重读',
    g.commits.length === 0 && !!n && n.autoCap.applied === true && n.autoCap.why === 'applied'
    && !!wr && wr.resMax === 1920 && wr.instant === true && wr.keys.indexOf('resMax') >= 0
    && g.w.win.__notified === 1 && g.section.resMax === void 0,
    JSON.stringify({ autoCap: n && n.autoCap, write: wr, notified: g.w.win.__notified }))
}
{
  // ⑦b 两条落盘口都拿不到（桥 + writeSection）⇒ 不动作、不假装已降档
  const g = dWorld({ section: { image: HOST4K, blur: 0, unifyTint: false, unifyAmount: 0 }, ffmpeg: true, withBridge: false })
  g.w.win.__noWriteSection = true
  const n = g.r.api.perf(3840, 2160)
  ok('D8b 桥与 writeSection 都拿不到 ⇒ 不动作、不提示（why=no-commit-path），applied=false',
    g.commits.length === 0 && n === null && g.w.win.__mpwPerfNote.autoCap.why === 'no-commit-path'
    && g.w.win.__mpwPerfNote.autoCap.applied === false && g.section.resMax === void 0,
    JSON.stringify(g.w.win.__mpwPerfNote.autoCap))
}
{
  // ⑧scene 内嵌视频（sv=1）即便 ≥4K + 转码可用 ⇒ 不写档（写了也降不下来，会骗用户）
  const g = dWorld({ section: { image: SV4K, blur: 0, unifyTint: false, unifyAmount: 0 }, ffmpeg: true })
  const n = g.r.api.perf(3840, 2160)
  ok('D9 scene 内嵌视频（sv=1，mpwTranscodeSpec 判 useTranscode=false）⇒ 不 commit（why=not-transcodable）',
    g.commits.length === 0 && n === null && g.w.win.__mpwPerfNote.autoCap.why === 'not-transcodable' && g.section.resMax === void 0,
    JSON.stringify(g.w.win.__mpwPerfNote.autoCap))
}
{
  // ⑨resMax 显式为 0（= DEFAULT_RES_MAX，面板"无限制"档）⇒ 按"没设过上限"处理
  const g = dWorld({ section: { image: HOST4K, resMax: 0, blur: 0, unifyTint: false, unifyAmount: 0 }, ffmpeg: true })
  const n = g.r.api.perf(3840, 2160)
  ok('D10 resMax=0（默认"不限制"）⇒ 视同没设过上限 ⇒ 一次 commit 到 1920',
    g.commits.length === 1 && JSON.stringify(g.commits[0].patch) === '{"resMax":1920}' && n && n.autoCap.applied === true
    && g.section.resMax === 1920, JSON.stringify(g.commits))
}
{
  // ⑩boot 窗口：自动降档在 boot 期间写下，但随后"两处存储合并（宿主档优先）"把它盖回
  //    ⇒ boot 收尾后必须自动补写一次（否则那一笔静默失效，而提示已经说了"已自动降到 1080p"）
  const g = dWorld({ section: { image: HOST4K, blur: 0, unifyTint: false, unifyAmount: 0 }, ffmpeg: true, bootPending: true })
  const n = g.r.api.perf(3840, 2160)
  const first = g.commits.length
  g.section.resMax = 0                     // 模拟：boot 合并按"带时间戳的宿主档"把 resMax 盖回 0
  g.r.api.settleBoot()
  ok('D11 boot 期间写下的上限被随后的存储合并盖回 ⇒ boot 收尾后自动补写（幂等：值还在就不动）',
    first === 1 && n && n.autoCap.applied === true && g.commits.length === 2 && g.commits[1].patch.resMax === 1920
    && g.section.resMax === 1920 && g.w.win.__mpwPerfNote.autoCap.reasserted === true
    && g.w.win.__mpw4kAutoCap.why === 'applied-after-boot' && g.r.notes.length === 1,
    JSON.stringify({ first: first, commits: g.commits.length, autoCap: g.w.win.__mpwPerfNote.autoCap, why: g.w.win.__mpw4kAutoCap.why }))
  // 对照组：不是 boot 窗口（收尾后）就没这条补写
  const g2 = dWorld({ section: { image: HOST4K, blur: 0, unifyTint: false, unifyAmount: 0 }, ffmpeg: true })
  g2.r.api.perf(3840, 2160)
  g2.section.resMax = 0
  const settled = g2.r.api.settleBoot()
  ok('D11b 对照组：非 boot 窗口 ⇒ boot 收尾不复跑待办（settleBoot 返回 false、不改档）',
    settled === false && g2.commits.length === 1 && g2.section.resMax === 0 && g2.w.win.__mpwPerfNote.autoCap.reasserted === void 0,
    JSON.stringify({ settled: settled, commits: g2.commits.length }))
}
{
  // ⑫探测"在飞"（已发出、答案还没回来）⇒ 不当场判"拿不到"，等落地后用最终读数判**一次**
  const g = dWorld({ section: { image: HOST4K, blur: 12, unifyTint: true, unifyAmount: 30 } })
  g.r.api.kickProbe('apply')                          // 模拟 applyInner 的预热探测：已发出、答案未回
  const n1 = g.r.api.perf(3840, 2160)
  const inFlightParts = { fetches: g.r.fetchCalls.length, commits: g.commits.length, ret: n1 === null, why: g.w.win.__mpwPerfNote.autoCap.why, seen: Object.keys(g.w.win.__mpw4kAutoCap.seen).length }
  const inFlight = inFlightParts.fetches === 1 && inFlightParts.commits === 0 && inFlightParts.ret
    && inFlightParts.why === 'await-transcode-probe' && inFlightParts.seen === 0
  g.r.pendingFetches[0].resolve({ ok: true, json: async () => ({ ok: true, found: true, source: 'system' }) })
  await new Promise((r) => setTimeout(r, 0))          // 让 then 链跑完（探测落地 → 叫醒等待者）
  ok('D13 读数在飞 ⇒ 先记 why=await-transcode-probe（不写 seen、不动作、不提示）；探测落地(found=true)后补判一次 ⇒ 恰好一次 commit + 一条提示',
    inFlight && g.commits.length === 1 && JSON.stringify(g.commits[0].patch) === '{"resMax":1920}'
    && g.section.resMax === 1920 && g.r.notes.length === 1 && g.r.notes[0] === I18N_ZH.perfNote4kAuto
    && g.w.win.__mpwPerfNote.autoCap.applied === true && Object.keys(g.w.win.__mpw4kAutoCap.seen).length === 1,
    JSON.stringify({ inFlight: inFlightParts, commits: g.commits, notes: g.r.notes, autoCap: g.w.win.__mpwPerfNote.autoCap }))
}
{
  // ⑫b 对照组：探测落地(found=false，明确不可用) ⇒ 补判结论 = no-transcode（不再动作、提示退回旧建议）
  const g = dWorld({ section: { image: HOST4K, blur: 12, unifyTint: true, unifyAmount: 30 } })
  g.r.api.kickProbe('apply')
  g.r.api.perf(3840, 2160)
  g.r.pendingFetches[0].resolve({ ok: true, json: async () => ({ ok: true, found: false, source: null }) })
  await new Promise((r) => setTimeout(r, 0))
  ok('D13b 探测落地 found=false ⇒ 补判为 no-transcode：不写档、提示退回旧建议、seen 记下这次结论（不重试）',
    g.commits.length === 0 && g.section.resMax === void 0 && g.r.notes.length === 1 && g.r.notes[0] === I18N_ZH.perfNote4kAdvisory
    && g.w.win.__mpwPerfNote.autoCap.why === 'no-transcode' && g.w.win.__mpw4kAutoCap.seen[HOST4K].why === 'no-transcode',
    JSON.stringify({ autoCap: g.w.win.__mpwPerfNote.autoCap, seen: g.w.win.__mpw4kAutoCap.seen }))
}
{
  // ⑬i18n 取不到时回退中文，绝不把键名当文案弹出去（mpwT 未接线的降级路径）
  const w = mkWorld({ bgBase: 'rgb(249,250,251)' })
  const s = { image: HOST4K, blur: 0, unifyTint: false, unifyAmount: 0 }
  const commits = []
  const r = loadAssist(w, s, { mutate: (code) => mutateAnchor(code, 'const mpwT = (k) => (__i18n[k] !== void 0 ? __i18n[k] : k);', 'const mpwT = (k) => k;') })
  r.api.setBridge({ commit: (patch) => { commits.push(patch); Object.assign(s, patch) } })
  r.api.noteFfmpeg(true, 'system')
  const n = r.api.perf(3840, 2160)
  ok('D12 `mpwT` 未接线（取词返回键名）⇒ 文案回退中文原文，不把 `perfNote4kAuto` 当消息弹给用户',
    commits.length === 1 && !!n && r.notes.length === 1 && /已自动降到 1080p（可在设置里改回）/.test(r.notes[0])
    && !/^perfNote4kAuto$/.test(r.notes[0]), JSON.stringify(r.notes))
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
  /* 下面三条是**真变异**：把判据函数改坏后跑同一组输入，证明对应判据确实有分辨力
     （只断言"源码里有这个字符串"是不够的 —— 那不能证明判据会红）。 */
  // E6：删掉"用户已设过 resMax ⇒ 不动" ⇒ D3 的输入下变异体会真的写档 1920
  const sec = { image: HOST4K, resMax: 2560, blur: 12, unifyTint: true, unifyAmount: 30 }
  const gMut = (() => {
    const w = mkWorld({ bgBase: 'rgb(249,250,251)' }); const s = Object.assign({}, sec); const commits = []
    const r = loadAssist(w, s, { mutate: (code) => mutateAnchor(code, 'if (isFinite(r) && r > 0) return { act: false, why: "resmax-set", resMax: 0 };', '') })
    r.api.setBridge({ commit: (patch) => { commits.push(patch); Object.assign(s, patch) } })
    r.api.noteFfmpeg(true, 'system')
    return { r, commits }
  })()
  const gReal = dWorld({ section: Object.assign({}, sec), ffmpeg: true })
  gReal.r.api.noteFfmpeg(true, 'system')
  const mutOut = gMut.r.api.autoCap(3840, 2160)
  const realOut = gReal.r.api.autoCap(3840, 2160)
  ok('E6 变异⑥：删掉"用户已设过 resMax ⇒ 不动" ⇒ 变异体在 D3 的输入下**真的**写了 1920（D3 必红），真源不动',
    mutOut.applied === true && gMut.commits.length === 1 && gMut.commits[0].resMax === 1920
    && realOut.applied === false && gReal.commits.length === 0,
    JSON.stringify({ mutant: mutOut, real: realOut }))
}
{
  // E7：删掉 `?autocap=off` 回退口判断 ⇒ 变异体在回退口下照样写档（D5 必红）
  const mk = (mutate) => {
    const w = mkWorld({ bgBase: 'rgb(249,250,251)' }); w.win.location.search = '?autocap=off'
    const s = { image: HOST4K, blur: 0, unifyTint: false, unifyAmount: 0 }
    const commits = []
    const r = loadAssist(w, s, mutate ? { mutate } : {})
    r.api.setBridge({ commit: (patch) => { commits.push(patch); Object.assign(s, patch) } })
    r.api.noteFfmpeg(true, 'system')
    return { out: r.api.autoCap(3840, 2160), commits }
  }
  const m = mk((code) => mutateAnchor(code, 'if (autocapOff) return { act: false, why: "autocap-off", resMax: 0 };', ''))
  const real = mk(null)
  ok('E7 变异⑦：删掉 `?autocap=off` 判断 ⇒ 变异体在回退口下也写 1920（D5 必红），真源一个字不改档',
    m.out.applied === true && m.commits.length === 1 && real.out.applied === false && real.commits.length === 0
    && real.out.why === 'autocap-off', JSON.stringify({ mutant: m.out, real: real.out }))
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
if (!fail) console.log('✓ 半透明主题适配口径成立：外框只在（有壁纸 + 开关开 + 宿主半透明）三条同时成立时动且可逐字还原；输入框磨砂半透明下自动开、用户动过就听用户的；≥4K 源在（转码可用 + 没设过上限 + 每壁纸一次 + 没被 ?autocap=off 挡）时自动降 1080p')
process.exit(fail ? 1 : 0)
