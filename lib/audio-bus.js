// audio-bus.js —— 「跨出口的总线级静音」内核（宿主侧，纯逻辑，可在桩环境单测）
//
// 为什么要它（事故链）：用户反复报「设置里静音了，但还是会偶发卡顿地响一声」。根因不是"静音按钮没生效"，
// 而是**声音出口不止一个**：我们自己的音乐控件走 `<audio>`（muted 够用），但壁纸/角色语音/可视化可能走
// Web Audio——`new AudioContext()` 是**别人**建的、`source.connect(ctx.destination)` 也是**别人**连的，
// 我们连"谁在响"都看不见。上几轮我们只做到了**记录**（`mpwInstallAudioAudit` 的钩子），
// 记录不等于接管：只要有一个节点直连 `destination`，它就绕过了我们的静音。
//
// 本模块做**接管**，而且是**总线级**的（逐条对应审阅意见里点出的坑）：
//   ① `AudioNode.prototype.connect` 原型级拦截：任何节点连 `ctx.destination` ⇒ 改接到该 ctx 的
//      **懒创建 masterGain**。原型级 ⇒ "比我们更早创建的 AudioContext"也能被收进来（只要它**还没**连）；
//   ② masterGain 的创建与它到 destination 的连接**走原始引用**（否则懒创建那一下会自己拦自己 ⇒ 递归）；
//   ③ `connect` 的**返回值原样透传**（`a.connect(b).connect(c)` 链式依赖它）；
//   ④ 判定用 `dest === ctx.destination`（**引用比较**；`instanceof` 跨 realm 会失败）；
//   ⑤ `OfflineAudioContext` **放行**（它也有 destination；误挂 master 会改掉离线渲染结果）；
//   ⑥ 静音 = `master.gain.cancelScheduledValues(now) + setValueAtTime(0, now)`（**不用 `ctx.suspend()`**：
//      冻结 `currentTime` 会破坏第三方的调度与可视化）；analyser 若接在 master **之前**，频谱仍有数据
//      ⇒ 这同时修掉我们"元素被 muted ⇒ 音条恒 0"的老限制；
//   ⑦ 归因补齐：`new Audio()`、`createMediaElementSource`（元素 muted 只影响输入源，输出在 Web Audio）、
//      `createMediaStreamSource`（不吃 `track.enabled`）、`src`/`srcObject` setter（autoplay 绕过 `play()`）、
//      `start(when)` 的迟到分布（**负很多** = bfcache/节流恢复；**负一点点** = 正常抖动，不误杀）、
//      Shadow DOM 里的媒体元素、`speechSynthesis`、`RTCPeerConnection` 的 `track.enabled`；
//   ⑧ **跨 realm 各装一遍**（同源 iframe 的 `AudioNode.prototype` 与父页不是同一个）；
//   ⑨ **gain 自动化归因**（2026-09-23 补）：第三方对 `AudioParam` 排的包络（`linearRampToValueAtTime` /
//      `exponentialRampToValueAtTime` / `setValueAtTime` / `setTargetAtTime` / `setValueCurveAtTime`）与取消
//      （`cancelScheduledValues` / `cancelAndHoldAtTime`）全部归因（**存在才拦**：不存在的方法不造）。
//      裁决口径（**近似，不假装逐位等价**）：
//        ① 打到 **bus 自己 master 参数**上的写值自动化 ⇒ **拒绝执行** + 立刻按宿主值收口。这是唯一一条真能
//           "把静音抬回来"的通路：master 是**串联乘法**，上游作者节点自己的包络再大也乘不过 0；而公开 API
//           拿不到 master 引用 ⇒ 这条属**纵深防御**，不是日常可达路径（真机靠 `gainAutomation` 读数判读）。
//        ② 作者**自己**节点的包络 **不改写、不重放**（改了会破坏第三方的淡入淡出/音乐自动化）；但宿主正在
//           裁决时（静音档 + 静音中/刚从静音恢复）每次归因到自动化调用就**再收口一次** ⇒ 把"静音之后有人
//           重新调度包络"的窗口从 750ms 轮询收敛到同一拍。
//        ③ 取消类调用**放行**（它们只删事件、不写值），放行后立刻收口：第三方 `cancelScheduledValues(0)`
//           能删掉宿主刚写的事件，同拍补回宿主值（否则 master 会退回内在值 ⇒ 静音自己"恢复"）。
//        ④ **近似边界（如实）**：真实 `AudioParam` 没有"参数 → 属主节点"的反向引用 ⇒ 只有我们自己登记过的
//           参数能判身份（master 的 gain，以及 `createGain()` / `new GainNode()` 返回的 `.gain`）；其余参数
//           只进总计数、不打 gain 标签。`param.value = v` 直接赋值**未单独拦**（同一"要先拿到引用"的前提），
//           只靠既有的 750ms 周期重压兜着。
//        ⑤ 我们自己的收口**走原始方法引用**（与 ② 号注释同款）：否则会被自己的钩子二次归因，更糟的是
//           "打在自己参数上的写值自动化"会被自己拒绝 ⇒ 静音永远写不进去。
//        ⑥ `node.connect(master.gain)`（AudioParam 当 connect 目标 ⇒ 与我们的收口**加法**叠加）：静音档
//           拒绝该连接（加法能抬起静音），非静音档只归因、不改第三方的图结构。
//
//   ⑩ **周期重压的副作用台账 + 幂等化**（2026-09-23；用户现场：「静音是开着的，声音毫无规律地
//      响一段 / 响一下，而且播放出来的音频是卡卡的」）：
//      诊断：问题不在"静音没生效"，而在**周期重压本身有副作用**。旧实现每 750ms 真的做了四件事：
//        ① `closeBus()` **无条件** `cancelScheduledValues(now) + setValueAtTime(v, now)`
//           —— 值一个 bit 都没变也照写（这就是"卡"的正面形状：周期性去戳音频图）；
//        ② `applyMute()` 无条件遍历**全部**媒体元素并写 `muted`/`volume`、对正在播的调 `pause()`
//           —— 与作者脚本每帧的 `play()/volume=` 互相踩 ⇒ "响一下/响一段"；
//        ③ `syncFrames()` 每拍 `querySelectorAll('iframe')` 并对**每个同源帧**重入
//           `installAudioBus` ⇒ 帧内 `setMode` ⇒ 帧内再跑一遍 `syncFrames + applyMute`（放大效应，
//           与资源审计 #9 同一条）；
//        ④ `collectMedia()` 为找 shadow root 每拍做一次全文档 `querySelectorAll('*')`（审计 #9）。
//      本版把周期路径改成**幂等且非破坏**：
//        · 值**真的不同**才写（`paramWritesSkipped` 是跳过读数）；
//        · 周期路径里**绝不**创建/连接/断开节点、**绝不** suspend/resume 上下文；
//        · 帧枚举与 shadow root 改**定向监听**（`MutationObserver` + 帧注册表 + `attachShadow`
//          包装；全文档 `*` 扫描只在安装期跑**一次**，读数 `repatch.shadowScans`）；
//        · `setMode`/`setMuted` 值没变 ⇒ 一个副作用都不做（帧内重入因此消失）；
//        · 每次周期动作实际做了什么按 `where` 记账到 `window.__mpwAudioBusRepatch`：
//          `n` = 有副作用的拍数（稳态必须 0 增长）、`ticks`/`idleTicks`、`byWhere`、
//          `nodesCreated`/`connects`/`disconnects`/`ctxSuspends`/`ctxResumes`/`paramWrites`/…
//      ⑩ 附加的一条真机缺口（静音"收不全"）：安装到**同源帧**里的那份总线此前只继承 `mode`、
//      不继承 `muted` ⇒ 帧里 `state.muted` 恒 false（帧内 WebAudio 压不住）。现在 `syncFrames`
//      把 `muted` 一起下发（`installAudioBus(cw, { mode, muted })`）。
//      ⚠ 诚实边界：`param.value = v` 的**直接赋值**依然**拦不到**（包 `AudioParam.prototype.value`
//      的 accessor 会伤热路径性能 ⇒ 只**检测**不拦截）：下一拍采样发现"我们写下去的值 ≠ 现在读到的值"
//      就记一条 `report().gainAutomation.reclaims` 台账，但那条来源**拿不到写者的栈**（`traceable:false`，
//      如实标注）。自动化/连接注入那两条来源有真栈（钩子当场抓到）。
//
// 档位（`?mpwhardmute=` 或 `bus.setMode()`）—— 二分定位用，不是"总开关"：
//   off       只归因，不动声音（缺省）
//   redirect  **只重定向不静音**：还能听见 ⇒ 有出口绕过 connect（历史遗留直连 / 跨 realm）；
//             声音变闷变小 ⇒ 有节点被**重复挂** master（多次 connect destination）
//   1         重定向 + master 归零 + 媒体压制 + speechSynthesis.cancel + WebRTC track.enabled=false
//   all       1 + 对跨域帧 postMessage 请求静音 + 连未归因的 ctx 也压
//   report    只汇报不压（产出"不可控清单"）
//
// 诚实边界：hook 之前**已经**连上 destination 的节点无法追溯（没有任何 API 能枚举已有连接）⇒
//   report() 会把"能观测到出声但不在我们 bus 上"的 ctx 单列为 `bypassSuspected`，不假装收全了。

export const BUS_MODES = ['off', 'redirect', '1', 'all', 'report'];
export const BUS_DEFAULT_MODE = 'off';
export const BUS_ATTR = 'data-mpw-audio-bus';
export const BUS_MSG = 'mpw:audio-bus';
/** 迟到补播的判定阈值：负得比这个多 ⇒ 当"恢复后补播"（bfcache/节流），否则算正常抖动，不误杀。 */
export const LATE_START_SEC = 1.0;
export const JITTER_START_SEC = 0.05;
/** ⑨ 被归因的 `AudioParam` 自动化方法（**存在才拦**：不存在的方法不造）。写值类 ⇒ 打在我们自己的
 *  master 参数上时必须拒绝（宿主裁决优先）。 */
export const PARAM_WRITE_METHODS = ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime', 'setValueCurveAtTime'];
/** ⑨ 取消类：只删事件、不写值 ⇒ 放行，但放行后立刻按宿主值收口（把被删掉的宿主事件补回来）。 */
export const PARAM_CANCEL_METHODS = ['cancelScheduledValues', 'cancelAndHoldAtTime'];

const now = (win) => { try { return win.performance && win.performance.now ? win.performance.now() : Date.now() } catch (e) { return Date.now() } };

/** 规范化档位（未知值 ⇒ 缺省；不抛）。 */
export function normalizeMode(m) {
  const s = String(m === undefined || m === null ? '' : m).trim().toLowerCase();
  return BUS_MODES.indexOf(s) >= 0 ? s : BUS_DEFAULT_MODE;
}

/** 该档是否真的**压**声音（report/off/redirect 都不压）。 */
export function modeMutes(m) {
  const s = normalizeMode(m);
  return s === '1' || s === 'all';
}
/** 该档是否要连"未归因的 ctx"一起压。 */
export function modeMutesAll(m) { return normalizeMode(m) === 'all'; }
/** 该档是否只重定向（诊断档：验证 bus 收没收全）。 */
export function modeRedirectOnly(m) { return normalizeMode(m) === 'redirect'; }
/** ①(2026-09-22 真机探针抓到的 bug) **帧内模式**：`redirect` 只对**顶层**有意义（顶层只归因、不压宿主提示音），
 *  壁纸帧要的是"压住" ⇒ 帧内把它提升为 `1`；其余档原样下传。真机证据：修前同源帧里 `__mpwAudioBus.mode`
 *  是 `redirect`（继承顶层）⇒ 帧内**根本没静音**。 */
export function frameModeFor(m) { const s = normalizeMode(m); return s === 'redirect' ? '1' : s; }

/**
 * 在一个 window 上装总线。**幂等**（同一 win 多次调用只装一遍）。
 * @param {object} win 目标 window（可传 iframe 的 contentWindow ⇒ 跨 realm 各装一遍）
 * @param {object} opts { mode, onEvent(name, detail), mediaRoots: ()=>Element[] }
 * @returns {object|null} api
 */
export function installAudioBus(win, opts = {}) {
  if (!win || typeof win !== 'object') return null;
  /* ── ⑩ 周期重压的副作用台账（探针直接读 `window.__mpwAudioBusRepatch`，不需要用户操作） ──────────
     要回答的不是"静音设置生效没有"，而是"**周期重压到底做了什么**"：
       · `ticks` 周期定时器总拍数；`idleTicks` 其中"一个副作用都没有"的拍数；
       · `n` 有副作用的拍数（**修好后稳态必须 0 增长**；旧实现每拍 +1）；
       · `byWhere` 按动作点分；`entries`（≤64）只记有副作用那几拍的 delta；
       · 四类"周期路径里绝不该出现"的副作用单独计数：`nodesCreated`/`connects`/`disconnects`/
         `ctxSuspends`+`ctxResumes`（任一非 0 ⇒ 就是卡顿/漏音的成因，见文件头 ⑩）。
     每个 realm 一份（帧内那份在自己的 window 上）；`report().framesRepatch` 汇总同源帧读数。 */
  const REPATCH_WATCH = ['nodesCreated', 'connects', 'disconnects', 'ctxSuspends', 'ctxResumes', 'modeWrites', 'paramWrites', 'mediaWrites', 'mediaPauses', 'mediaUnmutes', 'speechCancels', 'frameReentries', 'frameDisposals'];
  const repatch = (() => {
    const prev = win.__mpwAudioBusRepatch;
    if (prev && typeof prev === 'object') return prev;
    const rec = {
      n: 0, ticks: 0, idleTicks: 0, lastAt: 0, lastWhere: '', lastDid: null, lastStack: '', lastStackAt: 0,
      byWhere: {}, entries: [],
      nodesCreated: 0, connects: 0, disconnects: 0, ctxSuspends: 0, ctxResumes: 0,
      modeWrites: 0, modeNoops: 0, paramWrites: 0, paramWritesSkipped: 0,
      mediaWrites: 0, mediaPauses: 0, mediaUnmutes: 0, speechCancels: 0,
      frameReentries: 0, frameNoops: 0, frameDisposals: 0,
      shadowScans: 0, observers: 0,
    };
    try { win.__mpwAudioBusRepatch = rec } catch (e) {}
    return rec;
  })();
  /** 记一次"真的做了事"（有副作用）。`field` = REPATCH_WATCH 里的计数器名（无副作用则传 null）。 */
  const did = (where, field) => {
    try {
      const A = repatch;
      A.byWhere[where] = (A.byWhere[where] || 0) + 1;
      if (field) A[field] = (A[field] || 0) + 1;
      A.lastAt = now(win); A.lastWhere = where;
    } catch (e) {}
  };
  /** 周期动作包装：只把这一拍**实际产生的副作用**记账（稳态 ⇒ 一个 delta 都没有 ⇒ `idleTicks++`）。 */
  const periodic = (where, work) => {
    const A = repatch;
    if (disposed) return {};
    const t = now(win);
    const before = {};
    for (const k of REPATCH_WATCH) before[k] = A[k] || 0;
    A.ticks++; A.byWhere['tick:' + where] = (A.byWhere['tick:' + where] || 0) + 1;
    try { work() } catch (e) {}
    const diff = {}; let any = 0;
    for (const k of REPATCH_WATCH) { const d = (A[k] || 0) - before[k]; if (d) { diff[k] = d; any += d } }
    if (!any) { A.idleTicks++; return diff }
    A.n++; A.lastAt = t; A.lastWhere = where; A.lastDid = diff;
    /* 栈只在"这一拍真的做了事"时抓一次（节流 1s）：周期路径不为归因付抓栈开销。 */
    if (!A.lastStack || (t - A.lastStackAt) > 1000) { A.lastStack = stackOf(); A.lastStackAt = t }
    if (A.entries.length > 63) A.entries.shift();
    A.entries.push({ at: t, where, did: diff });
    return diff;
  };
  /** 把台账拷成**普通对象**（跨 realm 读帧内那份时用；`report()` 直接返回它）。 */
  const snapshotOf = (A) => (A && typeof A === 'object') ? {
    n: A.n, ticks: A.ticks, idleTicks: A.idleTicks, lastAt: A.lastAt, lastWhere: A.lastWhere,
    lastDid: A.lastDid, lastStack: A.lastStack, byWhere: Object.assign({}, A.byWhere),
    nodesCreated: A.nodesCreated, connects: A.connects, disconnects: A.disconnects,
    ctxSuspends: A.ctxSuspends, ctxResumes: A.ctxResumes,
    modeWrites: A.modeWrites, modeNoops: A.modeNoops,
    paramWrites: A.paramWrites, paramWritesSkipped: A.paramWritesSkipped,
    mediaWrites: A.mediaWrites, mediaPauses: A.mediaPauses, mediaUnmutes: A.mediaUnmutes,
    speechCancels: A.speechCancels, frameReentries: A.frameReentries, frameNoops: A.frameNoops,
    frameDisposals: A.frameDisposals, shadowScans: A.shadowScans, observers: A.observers,
    entries: (A.entries || []).slice(-8),
  } : null;
  const repatchSnapshot = () => snapshotOf(repatch);

  if (win.__mpwAudioBus && win.__mpwAudioBus.__installed) {           // 幂等：同一 realm 只装一遍
    /* ⑩ 读数：这行 = "有人从外面重入这个 realm 的总线"（旧写法每 750ms 对每个同源帧来一次）。
       修好之后周期路径不该走到这里（帧集合没变 ⇒ `syncFrames` 直接返回）⇒ 稳态帧重入 = 0。 */
    did('frame-reentry', 'frameReentries');
    /* ⑩ 值没变时 `setMode`/`setMuted` 都是**零副作用**的（见 api 里那两条幂等守卫）⇒ 周期重入
       （旧写法每 750ms 对每个同源帧重入一次）变成空操作，而不是"每拍重压一遍帧内音频图"。 */
    if (opts.mode !== undefined) win.__mpwAudioBus.setMode(opts.mode);
    if (opts.muted !== undefined) win.__mpwAudioBus.setMuted(opts.muted);
    return win.__mpwAudioBus;
  }
  const log = [];
  const emit = (name, detail) => {
    const rec = { t: now(win), name, detail: detail || null };
    log.push(rec);
    if (log.length > 300) log.shift();
    try { if (typeof opts.onEvent === 'function') opts.onEvent(name, rec.detail) } catch (e) { /* 上报失败不许影响音频 */ }
  };

  const state = {
    mode: normalizeMode(opts.mode),
    muted: false,
    wasMuted: false,          // 上一次是否处于"真的压着"的状态（决定恢复时要不要写回 1）
    contexts: [],                 // { id, ctx, adopted, offline, createAt, createStack, frames }
    masters: new WeakMap(),       // ctx -> masterGain
    adopted: new Set(),           // 被我们接管过的 ctx（**含**安装前就存在的老 ctx）——静音要遍历这一份
    media: new Set(),             // 媒体元素（含 new Audio() 与 shadow DOM 里的）
    mediaMutedByUs: new WeakSet(),// ⑩ 被**我们**按下的静音（解除时只撤销我们自己按的，见 release()）
    tappedMedia: new WeakSet(),   // 被 createMediaElementSource 接管的元素（不能 pause：analyser 要数据）
    masterParams: new WeakSet(),  // ⑨ 我们 bus 自己的 gain 参数（AudioParam）—— 身份只能靠自己登记
    gainParams: new WeakSet(),    // ⑨ 已知是 `GainNode.gain` 的参数（作者自己的包络）
    hostVolume: 1,                // ⑨ 宿主管的音量（0..1，缺省 1 = 与改动前逐位一致）
    hostVerdict: new WeakMap(),   // ⑩ ctx → 我们最后写下去的裁决值（判"被外部改动/覆盖"的基线）
    gainAutomation: {             // ⑨ 自动化归因面（探针/diag 直接读；见文件头 ⑨ 的近似边界）
      calls: 0,                   //    归因到的自动化调用总数
      authorGain: 0,              //    其中打在"作者自己的 GainNode.gain"上的
      masterWrites: 0,            //    其中打在 bus 自己 master 参数上的
      suppressed: 0,              //    被拒绝执行的（master 参数 + 写值类）
      reclosed: 0,                //    因自动化调用触发的"按宿主值再收口一次"次数
      paramInputs: 0,             //    往 master 参数 connect 信号（加法叠加）的次数
      paramInputsRefused: 0,      //    其中静音档被拒绝的
      byMethod: {}, lastMethod: '', lastAt: 0, lastStack: '', lastStackAt: 0,
      /* ⑩ "谁把静音抬回来"台账（沿用本对象的命名风格 ⇒ **不新建平行结构**；探针读
         `report().gainAutomation.reclaims`）。bySource 的取值：
           automation-suppressed     —— 第三方对 bus 自己的 gain 排包络（钩子当场拒绝；栈可得）
           param-connect-injection   —— 往 bus 自己的 gain connect 信号（加法叠加；栈可得）
           media-element             —— 静音期间元素 `muted`/`volume` 被抬回（volumechange 当场抓；栈可得）
           media-element-resample    —— 周期重压时**发现**元素又被抬回了（采样点栈）
           value-assign-or-unknown   —— `param.value = v` 直接赋值：**拦不到**，下一拍采样才发现（无写者栈） */
      reclaims: {
        n: 0, lastAt: 0, lastWhere: '', lastSource: '', lastExpected: null, lastActual: null,
        lastStack: '', lastStackAt: 0, bySource: {}, byWhere: {}, entries: [],
      },
    },
    redirects: 0,
    bypassSuspected: [],          // 能观测到出声但不在 bus 上的 ctx
    uncontrollable: [],           // 跨域帧（拿不到 contentDocument）
    frames: [],
  };
  let ctxSeq = 0;
  let timer = 0;
  let lastCloseWrites = 0;        // 最近一次 closeBus 实际**写下去**的参数个数（如实进 emit/report）
  let disposed = false;           // ⑩ dispose 之后不再接受任何周期动作
  /* 本 realm 的**原始 connect**。必须是 `AudioNode.prototype.connect` —— 真实浏览器里
     `AudioContext.prototype` 上**没有** connect（我第一版写错过，那样一条都拦不到）。 */
  let realmOrigConnect = null;
  let realmNodeProto = null;

  const protoOf = (Ctor) => { try { return Ctor && Ctor.prototype ? Ctor.prototype : null } catch (e) { return null } };
  const stackOf = () => { try { return String(new win.Error().stack || '').split('\n').slice(2, 5).join(' | ').slice(0, 400) } catch (e) { return '' } };

  /* ── ① 原型级 connect 拦截（含"懒创建 masterGain"） ───────────────────────────── */
  const patched = [];               // [{ proto, origConnect }]，卸载时还原
  const patchConnect = (proto) => {
    if (!proto || typeof proto.connect !== 'function' || proto.__mpwBusPatched) return false;
    const origConnect = proto.connect;
    proto.connect = function mpwBusConnect(dest) {
      const rest = Array.prototype.slice.call(arguments, 1);
      let ctx = null;
      try { ctx = this && this.context } catch (e) { /* 某些桩没有 context */ }
      did('connect-observed', 'connects');        // ⑩ 读数：被观察到的 connect 调用（周期路径里必须 0 增长）
      /* ⑨ 往 **bus 自己的 gain 参数**连信号（AudioParam 作 connect 目标 ⇒ 与我们的收口**加法**叠加）：
         静音档拒绝该连接（加法能抬起静音），非静音档只归因、**不动第三方的图结构**。 */
      if (dest && state.masterParams.has(dest)) {
        const holding = busHolds();
        try { state.gainAutomation.paramInputs++; if (holding) state.gainAutomation.paramInputsRefused++ } catch (e) {}
        /* ⑩ "谁把静音抬回来"：这是一条**有栈可得**的抬回通路（加法叠加能抬起静音）⇒ 入台账。 */
        if (holding) noteDrift('param-input', 'param-connect-injection', 0, null, { stack: stackOf(), method: 'connect' });
        emit('param-input', { kind: nodeKind(this), refused: holding, stack: stackOf() });
        if (holding) { try { closeBus() } catch (e) {} ; return dest }      // 真 API：connect 返回传入的目标
      }
      // 只拦"直连 destination"；用**引用比较**（instanceof 跨 realm 会失败）
      if (ctx && dest && dest === ctx.destination && !isOfflineCtx(ctx)) {
        let master = state.masters.get(ctx);
        if (!master) {
          master = createMaster(ctx);        // 内部全走原始引用
          state.masters.set(ctx, master);
          if (master) {
            state.adopted.add(ctx);
            /* 比我们更早创建、我们没登记过的 ctx（历史遗留）：**采用时补登记**，
               否则 applyMute 遍历的名单里没有它 ⇒ 它照样出声（这正是"假绿"的来源）。 */
            if (ctxId(ctx) < 0) state.contexts.push({ id: 'ctx' + (++ctxSeq), ctx, adopted: true, legacy: true, createAt: now(win), createStack: stackOf(), frames: 0 });
          }
        }
        if (this !== master) state.redirects++;
        emit('reroute', { ctxId: ctxId(ctx), kind: nodeKind(this), stack: stackOf() });
        origConnect.call(this, master, ...rest);
        /* ③ 真 API 语义：`connect(dest)` 返回**调用方传进来的那个目标节点**（链式 `a.connect(b).connect(c)` 依赖它）。
           若把 master 返回出去，第三方的 `a.connect(ctx.destination).connect(y)` 会变成 `master→y`（语义被改）。 */
        return dest;
      }
      return origConnect.call(this, dest, ...rest);
    };
    proto.__mpwBusPatched = true;
    patched.push({ proto, origConnect });
    if (!realmOrigConnect) { realmOrigConnect = origConnect; realmNodeProto = proto }
    return true;
  };
  /** ② masterGain 的创建与连接**必须走原始引用**（否则懒创建那一下会自己拦自己 ⇒ 递归）。 */
  const createMaster = (ctx) => {
    const origCreate = ctx.__origCreateGain || (ctx.createGain && ctx.createGain.bind(ctx));
    const master = origCreate ? origCreate() : null;
    if (!master) return null;
    did('create-master', 'nodesCreated');       // ⑩ 读数：节点创建（只应在"首次接管一个 ctx"时发生）
    try {
      if (master.gain) {
        try { state.masterParams.add(master.gain) } catch (e) {}      // ⑨ 身份登记（见 ③′ 段）
        master.gain.value = initialMasterValue();
        /* ⑩ 裁决基线：初值就是"我们写下去的值" ⇒ 之后读到的任何差异都是外部改动（见 closeBus 的检测）。 */
        try { state.hostVerdict.set(ctx, initialMasterValue()) } catch (e) {}
      }
      const origConnect = realmOrigConnect;
      if (origConnect) origConnect.call(master, ctx.destination);       // 原始引用，绕开 hook
      else if (master.connect) master.connect(ctx.destination);
      did('master-connect', 'connects');        // ⑩ 读数：我们自己那一次 master→destination（只此一次）
    } catch (e) { emit('master-connect-fail', { err: String(e && e.message || e) }) }
    return master;
  };
  const isOfflineCtx = (ctx) => {
    try {
      const OAC = win.OfflineAudioContext || win.webkitOfflineAudioContext;
      return !!(OAC && ctx instanceof OAC);        // ⑤ 离线渲染放行
    } catch (e) { return false }
  };
  const ctxId = (ctx) => { const f = state.contexts.find((c) => c.ctx === ctx); return f ? f.id : -1 };
  const nodeKind = (n) => { try { return String((n && n.constructor && n.constructor.name) || 'AudioNode') } catch (e) { return 'AudioNode' } };

  /* ── ③′ 宿主裁决值 + gain 自动化归因钩子（文件头 ⑨；语义/近似边界都在那里） ────────────────────
     真实 `AudioParam` **没有"参数 → 属主节点"的反向引用** ⇒ 身份只能靠自己登记：① master 的 gain
     （`state.masterParams`）；② `createGain()` / `new GainNode()` 返回的 `.gain`（`state.gainParams`）。 */
  const realmParamOrig = {};        // 原始 AudioParam 方法：我们自己的收口必须走它（否则被自己拦/自己归因）
  let patchedParams = [];           // [{ proto, fns }]，卸载时还原
  /** 宿主此刻是否真的在裁决总线值（静音档 + 静音中，或刚从静音恢复的那一次）。 */
  const busHolds = () => modeMutes(state.mode) && (state.muted || state.wasMuted);
  /** 宿主裁决的目标值：静音 ⇒ 0；否则宿主管的音量（缺省 1 ⇒ 与改动前逐位一致）。 */
  const hostTarget = () => ((modeMutes(state.mode) && state.muted) ? 0 : state.hostVolume);
  /** 新建 master 的初值：裁决档（`1`/`all`）按宿主值起手；其余档维持 1（**不碰**，与档位语义一致）。 */
  const initialMasterValue = () => (modeMutes(state.mode) ? hostTarget() : 1);
  /**
   * 把宿主的裁决值写到所有已接管的 master 上。**走原始方法引用**（见 ⑤ 号注释）。
   * ⑩ **值真的不同才写**（`force` 除外）：稳态下这一句一个音频事件都不排、一次 `.value` 都不写
   * （跳过次数记 `repatch.paramWritesSkipped`）。旧写法每 750ms 无条件
   * `cancelScheduledValues(now) + setValueAtTime(v, now)` —— 用户听到的"卡/响一下"正是这种
   * "周期性去戳音频图"的形状（读数见文件头 ⑩ 与 `window.__mpwAudioBusRepatch`）。
   * 顺带做 ⑩ 的**检测**：读到的值与"我们上次写下去的值"不一致 ⇒ 记一条 reclaims（谁把静音抬回来）。
   * @returns {number} 被**核对/收口**的 master 参数个数（`force=false` 且值相等时只核对不写）
   */
  const closeBus = (force) => {
    let written = 0, covered = 0;
    const v = hostTarget();
    for (const ctx of state.adopted) {
      const master = state.masters.get(ctx);
      const p = master && master.gain;
      if (!p) continue;
      covered++;
      let cur = NaN;
      try { cur = Number(p.value) } catch (e) { cur = NaN }
      const wr = state.hostVerdict.has(ctx) ? state.hostVerdict.get(ctx) : null;
      /* ⑩ 检测"宿主裁决值被外部改动/覆盖"：直接赋值（`param.value = v`）**拦不到**（不包 accessor）
         ⇒ 只能在这里采样发现；台账如实标 `traceable:false`（拿不到写者的栈）。 */
      if (wr !== null && cur === cur && cur !== wr) {
        noteDrift('close-bus-resample', 'value-assign-or-unknown', wr, cur, { ctxId: ctxId(ctx) });
      }
      if (!force && cur === cur && cur === v) { did('close-bus', 'paramWritesSkipped'); continue }
      try {
        const t = ctx.currentTime;
        if (realmParamOrig.cancelScheduledValues) realmParamOrig.cancelScheduledValues.call(p, t);
        if (realmParamOrig.setValueAtTime) realmParamOrig.setValueAtTime.call(p, v, t);
        else p.value = v;
        written++;
      } catch (e) { try { p.value = v; written++ } catch (e2) {} }
      try { state.hostVerdict.set(ctx, v) } catch (e) {}
      did('close-bus', 'paramWrites');
    }
    lastCloseWrites = written;
    return covered;
  };
  /** 归因一次自动化调用（计数 + 末次栈；探针读 `report().gainAutomation`）。**不许抛**：归因失败绝不影响音频。 */
  const noteAutomation = (fn, mine, author) => {
    try {
      const A = state.gainAutomation;
      A.calls++; A.byMethod[fn] = (A.byMethod[fn] || 0) + 1;
      A.lastMethod = fn; A.lastAt = now(win);
      /* 栈**不每次抓**：自动化可能是热路径（每个音符几十次调用）⇒ 只在"打到我们自己的参数上"或
         距上次抓栈 >1s 时抓一次（诊断面够用；热路径不为归因付出抓栈开销）。 */
      if (mine || !A.lastStack || (A.lastAt - A.lastStackAt) > 1000) { A.lastStack = stackOf(); A.lastStackAt = A.lastAt }
      if (mine) A.masterWrites++; else if (author) A.authorGain++;
    } catch (e) {}
  };
  /** ⑩ 记一条"宿主裁决值被外部改动/覆盖"的台账（时间戳 + 来源 + 节流栈）。**不许抛**。
   *  `extra.stack` 给了就是**当场抓到的真写者栈**（钩子路径）；没给 = 采样点栈（拦不到直接赋值那条）。 */
  const noteDrift = (where, source, expected, actual, extra) => {
    try {
      const R = state.gainAutomation.reclaims;
      const t = now(win);
      const stack = (extra && extra.stack) ? String(extra.stack) : '';
      R.n++; R.lastAt = t; R.lastWhere = where; R.lastSource = source;
      R.lastExpected = expected; R.lastActual = actual;
      R.bySource[source] = (R.bySource[source] || 0) + 1;
      R.byWhere[where] = (R.byWhere[where] || 0) + 1;
      /* 栈**节流**（>1s 才抓一次，与 noteAutomation 同款）：采样可能是热路径。
         直接赋值那条**没有写者栈**（不包 accessor）⇒ `traceable:false`，只留采样点读数。 */
      const traceable = !!stack;
      if (traceable) R.lastStack = stack;
      else if (!R.lastStack || (t - R.lastStackAt) > 1000) R.lastStack = stackOf();
      R.lastStackAt = t;
      if (R.entries.length > 31) R.entries.shift();
      R.entries.push({
        at: t, where, source, expected, actual, traceable,
        method: (extra && extra.method) || '', ctxId: (extra && extra.ctxId !== undefined) ? extra.ctxId : '',
        stack: traceable ? stack : '',
      });
    } catch (e) {}
  };
  /** 登记"这是 GainNode 的 gain 参数"：`createGain()` 与 `new GainNode()` 两条造节点的路都覆盖。 */
  const patchGainRegistration = () => {
    const ACproto = protoOf(win.AudioContext || win.webkitAudioContext);
    if (ACproto && typeof ACproto.createGain === 'function' && !ACproto.__mpwBusGain) {
      try {
        const orig = ACproto.createGain;
        ACproto.__mpwBusGain = true;
        ACproto.createGain = function (...a) {
          const node = orig.apply(this, a);
          try { if (node && node.gain) state.gainParams.add(node.gain) } catch (e) {}
          return node;
        };
      } catch (e) {}
    }
    try {
      const Orig = win.GainNode;
      if (typeof Orig === 'function' && !Orig.__mpwBusGainCtor) {
        const Wrapped = function (...a) {
          const node = new Orig(...a);
          try { if (node && node.gain) state.gainParams.add(node.gain) } catch (e) {}
          return node;
        };
        try { Wrapped.prototype = Orig.prototype } catch (e) {}
        Wrapped.__mpwBusGainCtor = true;
        win.GainNode = Wrapped;
      }
    } catch (e) {}
  };
  /** ⑨ `AudioParam.prototype` 的自动化方法：归因 + "宿主值是最终裁决"。 */
  const patchParamAutomation = () => {
    const proto = protoOf(win.AudioParam);
    if (!proto || proto.__mpwBusParam) return 0;
    const done = [];
    for (const fn of PARAM_WRITE_METHODS.concat(PARAM_CANCEL_METHODS)) {
      let orig = null;
      try { orig = proto[fn] } catch (e) { orig = null }
      if (typeof orig !== 'function') continue;           // **存在才拦**：不存在的方法不造
      realmParamOrig[fn] = orig;
      const isWrite = PARAM_WRITE_METHODS.indexOf(fn) >= 0;
      try {
        proto[fn] = function mpwBusParamAutomation() {
          let mine = false, author = false;
          try { mine = state.masterParams.has(this); author = !mine && state.gainParams.has(this) } catch (e) {}
          noteAutomation(fn, mine, author);
          if (mine && isWrite) {
            /* ① 宿主裁决优先：**拒绝**打到 bus 自己 gain 上的写值自动化，并立刻按宿主值收口 —— 否则
               "旧包络 / 新排的 ramp"会在 750ms 轮询的空隙里把静音抬起来（正是报障的形状）。 */
            try { state.gainAutomation.suppressed++; emit('gain-automation-suppressed', { method: fn, stack: stackOf() }) } catch (e) {}
            /* ⑩ 台账：这是一条**有真栈**的"想改宿主裁决值"通路（谁在抬静音，一眼可见）。 */
            try { noteDrift('param-automation', 'automation-suppressed', state.hostVerdict.has(hostCtxOf(this)) ? state.hostVerdict.get(hostCtxOf(this)) : null, null, { stack: stackOf(), method: fn }) } catch (e) {}
            try { closeBus() } catch (e) {}
            return undefined;                              // 真 API：这几个方法返回 undefined
          }
          const out = orig.apply(this, arguments);          // 作者自己的包络：**原样放行**（不改第三方语义）
          /* ② 收口：打到 bus 参数上的**取消类**调用（可能删掉宿主刚写的事件）、或宿主正在裁决时的任何
             自动化调用 ⇒ 立刻把宿主值补成"最后生效"的那个（不等 750ms 轮询）。
             ⑩ 取消类**强制**收口（第三方刚删掉宿主事件，master 会退回内在值）；其余按"值不同才写"核对
             ⇒ 稳态零写入（`paramWritesSkipped` 涨、`paramWrites` 不涨）。 */
          if (mine || busHolds()) { try { if (closeBus(mine && !isWrite)) state.gainAutomation.reclosed++ } catch (e) {} }
          return out;
        };
        done.push(fn);
      } catch (e) {}
    }
    try { proto.__mpwBusParam = true } catch (e) {}
    if (done.length) patchedParams.push({ proto, fns: done });
    return done.length;
  };
  /** ⑩ 从 master 的 gain 参数找回它的 ctx（只为我们登记过的参数服务；找不到返回 null）。 */
  const hostCtxOf = (param) => {
    try { for (const ctx of state.adopted) { const m = state.masters.get(ctx); if (m && m.gain === param) return ctx } } catch (e) {}
    return null;
  };

  /* ── ② AudioContext 构造拦截：登记 + 归因（接管本身靠 connect，构造只登记） ───── */
  const patchCtor = (winObj, key) => {
    try {
      const Orig = winObj[key];
      if (typeof Orig !== 'function' || Orig.__mpwBusWrapped) return;
      const Wrapped = function (...args) {
        const ctx = new Orig(...args);
        try {
          state.contexts.push({ id: 'ctx' + (++ctxSeq), ctx, adopted: false, offline: false, createAt: now(win), createStack: stackOf(), frames: 0 });
          emit('ctx-created', { ctor: key, state: ctx && ctx.state });
        } catch (e) {}
        return ctx;
      };
      try { Wrapped.prototype = Orig.prototype } catch (e) {}
      Wrapped.__mpwBusWrapped = true;
      winObj[key] = Wrapped;                        // 构造只负责**登记/归因**；接管靠下面的 AudioNode.prototype
    } catch (e) {}
  };

  /* ── ③ 归因钩子：MediaElement / MediaStream / src / srcObject / start(when) / speech / WebRTC ── */
  const patchAttribution = () => {
    const ACproto = protoOf(win.AudioContext || win.webkitAudioContext);
    if (ACproto && !ACproto.__mpwBusAttr) {
      ACproto.__mpwBusAttr = true;
      for (const [fn, kind] of [['createMediaElementSource', 'media-element'], ['createMediaStreamSource', 'media-stream'], ['createMediaStreamDestination', 'media-stream-dest']]) {
        try {
          const orig = ACproto[fn];
          if (typeof orig !== 'function') continue;
          ACproto[fn] = function (...a) {
            const node = orig.apply(this, a);
            try {
              if (kind === 'media-element' && a[0]) { state.tappedMedia.add(a[0]); registerMedia(a[0]); }
              emit('source-node', { kind, ctxId: -1, stack: stackOf() });
            } catch (e) {}
            return node;
          };
        } catch (e) {}
      }
    }
    // start(when)：迟到分布（负很多 = bfcache/节流恢复；负一点点 = 抖动）
    for (const [key, kind] of [['AudioBufferSourceNode', 'buffer'], ['OscillatorNode', 'oscillator'], ['ConstantSourceNode', 'constant'], ['AudioWorkletNode', 'worklet']]) {
      try {
        const Ctor = win[key]; const np = protoOf(Ctor);
        if (!np || typeof np.start !== 'function' || np.__mpwBusStart) continue;
        const origStart = np.start;
        np.start = function (when) {
          const rest = Array.prototype.slice.call(arguments, 1);
          try {
            const ctx = this.context;
            const cur = ctx && ctx.currentTime;
            const delta = (typeof when === 'number' && typeof cur === 'number') ? (when - cur) : null;
            /* 只**记录**、绝不阻止/丢弃 start（"误杀会掉音符"）：负得多 ⇒ burst（bfcache/节流恢复后的补播）；
               负一点点 ⇒ jitter（正常调度抖动，进分布供人判读）。未来时刻不记。 */
            if (delta !== null && delta < 0) {
              emit(delta < -LATE_START_SEC ? 'start-late-burst' : 'start-late-jitter', { kind, delta: Number(delta.toFixed(3)), mode: state.mode, muted: state.muted, stack: stackOf() });
            }
          } catch (e) {}
          return origStart.apply(this, arguments);
        };
        np.__mpwBusStart = true;
      } catch (e) {}
    }
    // new Audio() / src / srcObject（autoplay + src 赋值绕过 play()）
    try {
      const OrigAudio = win.Audio;
      if (typeof OrigAudio === 'function' && !OrigAudio.__mpwBusAudio) {
        const Wrapped = function (...a) { const el = new OrigAudio(...a); try { registerMedia(el); emit('new-audio', { src: shortSrc(el && el.src) }) } catch (e) {} return el };
        try { Wrapped.prototype = OrigAudio.prototype } catch (e) {}
        Wrapped.__mpwBusAudio = true;
        win.Audio = Wrapped;
      }
    } catch (e) {}
    const HME = win.HTMLMediaElement && win.HTMLMediaElement.prototype;
    if (HME && !HME.__mpwBusMedia) {
      HME.__mpwBusMedia = true;
      for (const prop of ['src', 'srcObject']) {
        try {
          const d = Object.getOwnPropertyDescriptor(HME, prop);
          if (!d || !d.set) continue;
          const origSet = d.set, origGet = d.get;
          Object.defineProperty(HME, prop, {
            configurable: true, enumerable: d.enumerable,
            get: origGet,
            set(v) {
              try { if (state.muted && modeMutes(state.mode)) suppress(this) } catch (e) {}
              emit(prop === 'src' ? 'src-set' : 'srcobject-set', { src: prop === 'src' ? shortSrc(v) : '[stream]', muted: !!(this && this.muted) });
              return origSet.call(this, v);
            },
          });
        } catch (e) {}
      }
      // play()：静音期间**压制**且返回 resolved Promise（不排队——排队会在取消静音瞬间多声齐发）
      try {
        const origPlay = HME.play;
        if (typeof origPlay === 'function' && !HME.__mpwBusPlay) {
          HME.__mpwBusPlay = true;
          HME.play = function () {
            try {
              if (state.muted && modeMutes(state.mode)) {
                suppress(this);
                emit('play-suppressed', { src: shortSrc(this && this.src), stack: stackOf() });
                return win.Promise ? win.Promise.resolve() : undefined;   // 必须 resolved，否则调用方 await 卡住
              }
            } catch (e) {}
            return origPlay.apply(this, arguments);
          };
        }
      } catch (e) {}
      // volumechange：静音下有人抬 volume/muted ⇒ 立刻归零 + 记栈
      try {
        if (!HME.__mpwBusVol) {
          HME.__mpwBusVol = true;
          const origAdd = HME.addEventListener;
          if (typeof origAdd === 'function') {
            const self = win;
            origAdd.call(self.document || self, 'volumechange', (e) => {
              const el = e && e.target;
              if (!el || !state.muted || !modeMutes(state.mode)) return;
              if (!el.muted || Number(el.volume) > 0) {
                /* ⑩ 台账：元素级"把静音抬回来"——**当场抓到写者栈**（谁在静音期间把 muted/volume 抬回去）。 */
                try { noteDrift('media-element-volume', 'media-element', 0, Number(el.volume), { stack: stackOf(), method: el.muted ? 'volume' : 'muted' }) } catch (e) {}
                emit('volume-raised-while-muted', { muted: !!el.muted, volume: Number(el.volume), stack: stackOf() });
                suppress(el);
              }
            }, true);
          }
        }
      } catch (e) {}
    }
    // speechSynthesis（角色语音可能走它，完全不受 <audio>/Web Audio 控制）
    try {
      const ss = win.speechSynthesis;
      if (ss && typeof ss.speak === 'function' && !ss.__mpwBusSpeech) {
        const origSpeak = ss.speak.bind(ss);
        ss.__mpwBusSpeech = true;
        ss.speak = function (u) {
          if (state.muted && modeMutes(state.mode)) { try { ss.cancel() } catch (e) {} ; emit('speech-suppressed', { text: String(u && u.text || '').slice(0, 60) }); return }
          emit('speech', { text: String(u && u.text || '').slice(0, 60) });
          return origSpeak(u);
        };
      }
    } catch (e) {}
    // WebRTC：outbound 的 track.enabled 是唯一能压它的开关
    try {
      const RTC = win.RTCPeerConnection;
      if (typeof RTC === 'function' && !RTC.__mpwBusRtc) {
        const Wrapped = function (...a) {
          const pc = new RTC(...a);
          try {
            pc.addEventListener('track', (ev) => {
              const tracks = (ev && ev.streams && ev.streams[0] && ev.streams[0].getTracks) ? ev.streams[0].getTracks() : [];
              for (const t of tracks) { try { if (t.kind === 'audio' && state.muted && modeMutes(state.mode)) t.enabled = false } catch (e) {} }
              emit('rtc-track', { n: tracks.length });
            });
          } catch (e) {}
          return pc;
        };
        try { Wrapped.prototype = RTC.prototype } catch (e) {}
        Wrapped.__mpwBusRtc = true;
        win.RTCPeerConnection = Wrapped;
      }
    } catch (e) {}
  };

  const shortSrc = (s) => String(s || '').replace(/token=[^&]*/, 'token=…').slice(0, 120);

  /* ── ⑩ 定向监听：媒体元素 / 帧 / shadow root 的**增量**登记（替代每拍的 `querySelectorAll('*')`） ────
     旧写法（资源审计 #9）：`collectMedia()` 每次为找 shadow root 做一次全文档 `querySelectorAll('*')`；
     `syncFrames()` 每 750ms 重新枚举 iframe 并对**每个同源帧**重入 `installAudioBus`。这里改成：
       · `roots`：已知可查询根（document + 各 shadow root），**只在新增时**登记一次；
       · `MutationObserver`（childList + subtree）只看新增/移除节点 ⇒ 登记媒体元素 / 置帧脏位；
       · `Element.prototype.attachShadow` 包装（返回值原样透传）⇒ 新 shadow root 立刻登记；
       · 安装期**一次**全文档扫描，把"装之前就已经存在"的 shadow root 收进来（读数 `repatch.shadowScans`）。
     周期路径里**没有**全文档扫描（门禁：同一状态连跑 N 拍 `shadowScans` 不增长）。 */
  const roots = [];
  const rootSeen = new WeakSet();
  const observers = [];
  const frameEls = [];              // 帧注册表（替代每拍 `querySelectorAll('iframe')`）
  const frameBus = [];              // [{ el, win }]：帧内那条总线的登记（换壁纸/帧卸载时 dispose 它）
  let framesDirty = true;           // MutationObserver 命中帧增删时置位；周期路径只在置位时才重枚举
  let shadowScanned = false;
  const patchedDisconnect = [], patchedCtxLife = [], patchedShadow = [];

  const safeQuery = (root, sel) => { try { return (root && typeof root.querySelectorAll === 'function') ? root.querySelectorAll(sel) : [] } catch (e) { return [] } };
  const isMediaEl = (n) => { try { return !!(n && n.nodeType === 1 && /^(audio|video)$/i.test(String(n.tagName || ''))) } catch (e) { return false } };
  const isFrameEl = (n) => { try { return !!(n && n.nodeType === 1 && /^iframe$/i.test(String(n.tagName || ''))) } catch (e) { return false } };

  const registerMedia = (el) => {
    if (!el || typeof el !== 'object') return false;
    if (state.media.has(el)) return false;
    state.media.add(el);
    return true;
  };
  /** 只看**新增节点**（含其子树里定向查出来的媒体/帧）——这就是"只盯新增"的那一半。 */
  const scanNode = (n) => {
    try {
      if (!n || n.nodeType !== 1) return;
      if (isMediaEl(n)) registerMedia(n);
      if (isFrameEl(n)) framesDirty = true;
      try { if (n.shadowRoot) addRoot(n.shadowRoot) } catch (e) {}
      for (const el of safeQuery(n, 'audio,video')) registerMedia(el);
      if (safeQuery(n, 'iframe').length) framesDirty = true;
    } catch (e) {}
  };
  const observeRoot = (root) => {
    try {
      const MO = win.MutationObserver;
      if (typeof MO !== 'function' || !root || typeof root.querySelectorAll !== 'function') return false;
      const node = (root === win.document && (root.documentElement || root)) || root;
      const mo = new MO((muts) => {
        try {
          for (const m of muts) {
            const added = m && m.addedNodes;
            if (added) for (let i = 0; i < added.length; i++) scanNode(added[i]);
            const removed = m && m.removedNodes;
            if (removed) for (let i = 0; i < removed.length; i++) if (isFrameEl(removed[i])) framesDirty = true;
          }
        } catch (e) {}
      });
      mo.observe(node, { childList: true, subtree: true });
      observers.push(mo); repatch.observers = observers.length;
      return true;
    } catch (e) { return false }
  };
  /** 登记一个可查询根（document / shadow root）：装一次 `audio,video` 定向查询 + 挂 observer。 */
  const addRoot = (root) => {
    if (!root || rootSeen.has(root) || typeof root.querySelectorAll !== 'function') return false;
    try { rootSeen.add(root) } catch (e) { return false }
    roots.push(root);
    for (const el of safeQuery(root, 'audio,video')) registerMedia(el);
    observeRoot(root);
    return true;
  };
  /** 安装期**一次**：把装之前就存在的 shadow root 收进来（`querySelectorAll('*')` **只在这里**出现）。 */
  const shadowScanOnce = () => {
    if (shadowScanned) return 0;
    shadowScanned = true;
    did('shadow-scan-once', 'shadowScans');
    let n = 0;
    try { for (const host of safeQuery(win.document, '*')) { try { if (host && host.shadowRoot && addRoot(host.shadowRoot)) n++ } catch (e) {} } } catch (e) {}
    return n;
  };
  /** 新 shadow root：包 `attachShadow`（返回值**原样透传**，作者/框架依赖 `=== this.shadowRoot`）。 */
  const patchAttachShadow = () => {
    try {
      const E = win.Element && win.Element.prototype;
      if (!E || typeof E.attachShadow !== 'function' || E.__mpwBusShadow) return 0;
      const orig = E.attachShadow;
      E.attachShadow = function mpwBusAttachShadow() { const sr = orig.apply(this, arguments); try { addRoot(sr) } catch (e) {} ; return sr };
      E.__mpwBusShadow = true;
      patchedShadow.push({ proto: E, orig });
      return 1;
    } catch (e) { return 0 }
  };
  /** 只**计数**的旁路钩子（不改语义、返回值原样透传）：为"周期重压有没有副作用"提供可读读数。
   *  `disconnect` / `suspend` / `resume` 在本模块里**从不主动调用**（⑥ 明确不 suspend）——但"没调用"
   *  这件事此前无法自证 ⇒ 装上计数器后 `repatch.disconnects/ctxSuspends/ctxResumes` 稳态必须恒为 0
   *  （有读数 ⇒ 是**别人**在戳音频图，那正是卡顿/漏音的成因）。 */
  const patchNodeCounters = (proto) => {
    if (!proto || typeof proto.disconnect !== 'function' || proto.__mpwBusDisc) return false;
    const orig = proto.disconnect;
    proto.disconnect = function mpwBusDisconnect() { did('disconnect-observed', 'disconnects'); return orig.apply(this, arguments) };
    proto.__mpwBusDisc = true;
    patchedDisconnect.push({ proto, orig });
    return true;
  };
  const patchCtxLifecycle = () => {
    for (const proto of [protoOf(win.AudioContext), protoOf(win.webkitAudioContext)]) {
      if (!proto || proto.__mpwBusCtxLife) continue;
      proto.__mpwBusCtxLife = true;
      for (const fn of ['suspend', 'resume']) {
        let orig = null; try { orig = proto[fn] } catch (e) { orig = null }
        if (typeof orig !== 'function') continue;              // **存在才拦**：不存在的方法不造（与 ⑨ 同款纪律）
        proto[fn] = function mpwBusCtxLife() { did(fn + '-observed', fn === 'suspend' ? 'ctxSuspends' : 'ctxResumes'); return orig.apply(this, arguments) };
        patchedCtxLife.push({ proto, fn, orig });
      }
    }
  };
  /** 收集媒体元素：已知根（document + shadow root）里定向查 `audio,video` + 登记表 + 调用方给的根。
   *  **不再**做全文档 `querySelectorAll('*')`（那是每拍一次的全文档遍历，见文件头 ⑩④）。 */
  const collectMedia = (out) => {
    for (const root of roots) { for (const el of safeQuery(root, 'audio,video')) out.push(el) }
    return out;
  };
  const allMedia = () => {
    const out = [];
    try { collectMedia(out) } catch (e) {}
    for (const el of state.media) out.push(el);
    if (typeof opts.mediaRoots === 'function') { try { for (const el of opts.mediaRoots() || []) out.push(el) } catch (e) {} }
    return out;
  };
  /** 压一个媒体元素：**被 createMediaElementSource 接管的不要 pause**（analyser 要数据，暂停 = 频谱恒 0）。
   *  ⑩ **幂等**：已经是目标状态就一个字节都不写（旧写法每拍无条件 `muted/volume/pause` ⇒ 与作者脚本
   *  每帧的 `play()/volume=` 互相踩，听感就是"响一下/响一段、卡卡的"）。 */
  const suppress = (el) => {
    let changed = false;
    try { if (el.muted !== true) { el.muted = true; try { state.mediaMutedByUs.add(el) } catch (e) {} ; did('suppress', 'mediaWrites'); changed = true } } catch (e) {}
    try {
      if (state.tappedMedia.has(el)) { /* 只总线归零，保留元素输出给 analyser */ }
      else {
        if (Number(el.volume) !== 0) { el.volume = 0; did('suppress', 'mediaWrites'); changed = true }
        if (typeof el.pause === 'function' && !el.paused) { el.pause(); did('suppress', 'mediaPauses'); changed = true }
      }
    } catch (e) {}
    return changed;
  };
  /** 解除静音：**只撤销我们自己按下去的**（`mediaMutedByUs`）——作者/NP/别的插件自己 muted 的元素不动。
   *  为什么必须收窄：旧写法无条件 `el.muted = false`，会把"别人自己静的"一起抬起来（用户现场：
   *  NP 播放器明明是静音状态却仍然出声）。 */
  const release = (el) => {
    let changed = false;
    try {
      if (state.mediaMutedByUs.has(el)) {
        if (el.muted !== false) { el.muted = false; did('release', 'mediaUnmutes'); changed = true }
        state.mediaMutedByUs.delete(el);
      }
    } catch (e) {}
    return changed;
  };
  /** ⑩ 静音时按需 `speechSynthesis.cancel()`：环境**能**报状态（`speaking` 是布尔）且确实没在说话 ⇒
   *  跳过（周期路径零副作用）；报不了状态的实现保留旧行为（无条件 cancel）——不在观测能力不足的地方省这一下。 */
  const speechWorthCancelling = () => {
    try {
      const ss = win.speechSynthesis;
      if (!ss || typeof ss.cancel !== 'function') return false;
      if (typeof ss.speaking !== 'boolean') return true;
      return !!(ss.speaking || ss.pending || ss.paused);
    } catch (e) { return false }
  };

  /* ── ④ 总线静音：只动我们自己的 masterGain（不 suspend：冻结 currentTime 会破坏调度/可视化） ── */
  /** @param {string} where 调用点（周期路径传 `'tick'`：`tick` 拍**不写日志环**，读数只看 repatch 台账）。 */
  const applyMute = (where) => {
    const mute = state.muted && modeMutes(state.mode);
    /* 非静音档（off/report/redirect）**不碰 gain**：我们的 master 初值就是 1，没人会去改它；
       反过来"每次都写 1"会盖掉第三方自己对 master 的调整，也会让 redirect 诊断档失去意义
       （它要能回答"bus 到底收没收全"，而不是顺手改了音量）。只有**从静音恢复**那一次必须写回 1
       （⑨ 起改成"写回**宿主值**"：`hostVolume` 缺省 1 ⇒ 缺省行为与改动前逐位一致）。 */
    if (!mute && !state.wasMuted) return 0;
    state.wasMuted = mute;
    const covered = closeBus();
    const wrote = lastCloseWrites;
    let mediaN = 0;
    for (const el of allMedia()) { try { if (mute) { if (suppress(el)) mediaN++ } else if (release(el)) mediaN++ } catch (e) {} }
    if (mute && speechWorthCancelling()) { try { win.speechSynthesis.cancel(); did('speech-cancel', 'speechCancels') } catch (e) {} }
    /* ⑩ 周期拍**安静**：没有实际改动就不往日志环里塞记录（读数在 `repatch` 台账里，见文件头 ⑩）。 */
    if (where !== 'tick' || mediaN || wrote || covered) {
      emit('apply-mute', { muted: state.muted, mode: state.mode, where: where || 'apply-mute', contexts: state.contexts.length, media: state.media.size, closed: covered, closeWrites: wrote, mediaWrites: mediaN, hostVolume: state.hostVolume });
    }
    return mediaN;
  };

  /* ── ⑤ 跨域帧：压不动就**如实报不可控**；同源帧各装一遍（跨 realm） ── */
  /** 帧注册表：只在 MutationObserver 置脏（或调用方明确要求）时重新枚举 —— 周期路径不再每拍枚举。 */
  const frameList = (force) => {
    if (force) framesDirty = true;
    if (framesDirty) {
      framesDirty = false;
      frameEls.length = 0;
      for (const f of safeQuery(win.document, 'iframe')) frameEls.push(f);
    }
    return frameEls;
  };
  /** 记住"这个帧里装着一条总线"（同一个 iframe 换了 window ⇒ 旧 window 那条先释放）。 */
  const rememberFrameBus = (el, cw) => {
    try {
      for (let i = frameBus.length - 1; i >= 0; i--) {
        const rec = frameBus[i];
        if (!rec || rec.el !== el) continue;
        if (rec.win === cw) return;
        disposeFrameBus(rec, 'frame-rewindow');
        frameBus.splice(i, 1);
      }
      frameBus.push({ el, win: cw });
    } catch (e) {}
  };
  const disposeFrameBus = (rec, why) => {
    try {
      const b = rec && rec.win && rec.win.__mpwAudioBus;
      if (b && typeof b.dispose === 'function') { b.dispose(); did('frame-dispose:' + String(why || ''), 'frameDisposals') }
    } catch (e) {}
  };
  /** 帧卸载/换壁纸：把**已经不在文档里**的帧内总线和它的 750ms 重压定时器一起释放。 */
  const pruneFrameBus = (alive) => {
    const set = new WeakSet();
    for (const f of alive) { try { if (f) set.add(f) } catch (e) {} }
    for (let i = frameBus.length - 1; i >= 0; i--) {
      const rec = frameBus[i];
      let gone = true;
      try { gone = !rec || !rec.el || rec.el.isConnected === false || !set.has(rec.el) } catch (e) { gone = true }
      if (!gone) continue;
      disposeFrameBus(rec, 'frame-gone');
      frameBus.splice(i, 1);
    }
  };
  const syncFrames = (o) => {
    const periodicCall = !!(o && o.periodic);
    /* ⑩ 幂等：帧集合没变（MutationObserver 没置脏位）⇒ 周期路径**不枚举、不重入任何帧**。
       旧写法每 750ms 重新 `querySelectorAll('iframe')` 并对**每个同源帧** `installAudioBus` ⇒
       帧内 `setMode` ⇒ 帧内再跑一遍 `syncFrames + applyMute`（放大效应 = 资源审计 #9）。 */
    if (periodicCall && !framesDirty) { did('sync-frames', 'frameNoops'); return state.frames }
    state.uncontrollable = [];
    const frames = Array.prototype.slice.call(frameList(!periodicCall));
    /* ⑩ 换壁纸/帧卸载：**先**释放已经消失的那些帧里的总线（它有自己的 750ms 重压定时器与 observer）。 */
    pruneFrameBus(frames);
    state.frames = frames.map((f, i) => {
      let sameOrigin = false, cw = null;
      try { cw = f.contentWindow; sameOrigin = !!(cw && cw.document) } catch (e) { sameOrigin = false }
      if (sameOrigin && cw) {
        try {
          /* ⑩ `muted` 必须**一起下发**：旧写法只传 `mode` ⇒ 帧内那份总线 `state.muted` 恒 false
             （帧内 WebAudio 根本压不住 —— 真机上就是"设置里静音了、帧里照样出声"）。 */
          installAudioBus(cw, { mode: frameModeFor(state.mode), muted: state.muted, onEvent: opts.onEvent, mediaRoots: opts.mediaRoots });
          rememberFrameBus(f, cw);
        } catch (e) {}
      } else state.uncontrollable.push({ i, src: shortSrc(f.src || f.getAttribute && f.getAttribute('src')) });
      return { i, sameOrigin, src: shortSrc(f.src || '') };
    });
    if (modeMutesAll(state.mode)) {
      for (const f of frames) { try { f.contentWindow && f.contentWindow.postMessage({ type: BUS_MSG, muted: state.muted, mode: state.mode }, '*') } catch (e) {} }
    }
    return state.frames;
  };

  const api = {
    __installed: true,
    get mode() { return state.mode },
    get muted() { return state.muted },
    setMode(m) {
      const next = normalizeMode(m);
      /* ⑩ 幂等：值没变 ⇒ 不回帧、不重压、不记账（旧写法每次被重入都会跑一遍 `syncFrames + applyMute`，
         那正是"每 750ms 重挂一遍"的放大源）。 */
      if (next === state.mode) { did('set-mode', 'modeNoops'); return state.mode }
      state.mode = next;
      did('set-mode', 'modeWrites');
      syncFrames();
      applyMute('set-mode');
      emit('mode', { mode: state.mode });
      return state.mode;
    },
    setMuted(v) {
      const next = !!v;
      /* ⑩ 幂等：值没变 ⇒ 一个副作用都不做（定时器不重装、帧不重入、gain 不重写）。 */
      if (next === state.muted) { did('set-muted', 'mutedNoops'); return state.muted }
      state.muted = next;
      syncFrames();
      applyMute('set-muted');
      if (state.muted && modeMutes(state.mode)) {                 // "偶发" ⇒ 周期性重压（新节点/自动化都要压住）
        /* ⑩ 每一拍**按台账记账**：稳态（同一状态连跑 N 拍）必须 0 副作用（见 `periodic`）。
           周期路径里没有节点创建/连接/断开、没有 suspend/resume、没有全文档扫描。 */
        if (!timer) timer = win.setInterval(() => { periodic('750ms', () => { applyMute('tick'); syncFrames({ periodic: true }) }) }, 750);
      } else if (timer) { try { win.clearInterval(timer) } catch (e) {} ; timer = 0 }
      return state.muted;
    },
    installFrame(cw, o) { return installAudioBus(cw, Object.assign({ mode: state.mode, muted: state.muted, onEvent: opts.onEvent }, o || {})) },
    syncFrames,
    /** ⑨ 宿主管的音量（0..1，缺省 1）。**只在裁决档（`1`/`all`）写下去**；`off`/`report`/`redirect`
     *  不碰 gain（诊断档口径不被破坏）。写下去之后，任何打到 bus 参数上的自动化都扳不动它。 */
    setHostVolume(v) {
      const n = Number(v);
      state.hostVolume = isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
      if (modeMutes(state.mode)) { try { closeBus() } catch (e) {} }
      emit('host-volume', { hostVolume: state.hostVolume, mode: state.mode });
      return state.hostVolume;
    },
    get hostVolume() { return state.hostVolume },
    /** `dispose()` 是否已经跑过（探针据此判"定时器/监听是不是真的清了"）。 */
    get disposed() { return disposed },
    /** 自上报快照（探针/diag 直接读它，**不需要用户操作**）。 */
    report() {
      const R = state.gainAutomation.reclaims;
      return {
        mode: state.mode, muted: state.muted, redirects: state.redirects, disposed,
        /* ⑩ 资源/监听侧的可观测计数：`dispose()` 之后必须全部归零。 */
        timers: timer ? 1 : 0, observers: observers.length, roots: roots.length, frameBus: frameBus.length,
        /* ⑩ 周期重压台账（与 `window.__mpwAudioBusRepatch` 同一份数据的快照）。 */
        repatch: repatchSnapshot(),
        framesRepatch: frameBus.slice(0, 8).map((r) => ({ src: shortSrc(r.el && r.el.getAttribute && r.el.getAttribute('src')), repatch: snapshotOf(r.win && r.win.__mpwAudioBusRepatch) })),
        contexts: state.contexts.map((c) => Object.assign({}, c, { ctx: undefined, adopted: state.masters.has(c.ctx), state: safeState(c.ctx) })),
        masters: state.contexts.filter((c) => state.masters.has(c.ctx)).length,
        media: allMedia().length, registered: state.media.size, tapped: countTapped(),
        hostVolume: state.hostVolume,
        /* ⑨ gain 自动化归因面（探针读这几个数判"第三方有没有在动包络、有没有被拒绝"）。 */
        gainAutomation: {
          calls: state.gainAutomation.calls, authorGain: state.gainAutomation.authorGain,
          masterWrites: state.gainAutomation.masterWrites, suppressed: state.gainAutomation.suppressed,
          reclosed: state.gainAutomation.reclosed, paramInputs: state.gainAutomation.paramInputs,
          paramInputsRefused: state.gainAutomation.paramInputsRefused,
          byMethod: Object.assign({}, state.gainAutomation.byMethod),
          lastMethod: state.gainAutomation.lastMethod, lastAt: state.gainAutomation.lastAt,
          lastStack: state.gainAutomation.lastStack,
          /* ⑩ "谁把静音抬回来"台账（时间戳 + 来源 + 节流栈；有界 ≤32 条）。 */
          reclaims: {
            n: R.n, lastAt: R.lastAt, lastWhere: R.lastWhere, lastSource: R.lastSource,
            lastExpected: R.lastExpected, lastActual: R.lastActual, lastStack: R.lastStack,
            bySource: Object.assign({}, R.bySource), byWhere: Object.assign({}, R.byWhere),
            entriesKept: R.entries.length, entries: R.entries.slice(-8),
          },
        },
        bypassSuspected: state.bypassSuspected.slice(0, 12),
        uncontrollableFrames: state.uncontrollable.slice(0, 12),
        frames: state.frames.slice(0, 12),
        log: log.slice(-40),
      };
    },
    log: () => log.slice(-100),
    /** 释放：定时器 + 全部钩子/observer 还原（**旧实现全仓无人调用** ⇒ 750ms 重压定时器与原型钩子
     *  跟着页面走到底；现在由接线侧在"插件卸载 / 换壁纸卸载帧"时调用，见 `tools/build-audio-bus.mjs`）。 */
    dispose() {
      disposed = true;
      if (timer) { try { win.clearInterval(timer) } catch (e) {} ; timer = 0 }
      for (const p of patched) { try { p.proto.connect = p.origConnect; p.proto.__mpwBusPatched = false } catch (e) {} }
      for (const rec of patchedParams) {
        for (const fn of rec.fns) { try { if (realmParamOrig[fn]) rec.proto[fn] = realmParamOrig[fn] } catch (e) {} }
        try { rec.proto.__mpwBusParam = false } catch (e) {}
      }
      for (const rec of patchedDisconnect) { try { rec.proto.disconnect = rec.orig; rec.proto.__mpwBusDisc = false } catch (e) {} }
      for (const rec of patchedCtxLife) { try { rec.proto[rec.fn] = rec.orig; rec.proto.__mpwBusCtxLife = false } catch (e) {} }
      for (const rec of patchedShadow) { try { rec.proto.attachShadow = rec.orig; rec.proto.__mpwBusShadow = false } catch (e) {} }
      for (const mo of observers) { try { mo.disconnect() } catch (e) {} }
      /* ⑩ 帧内那些总线也是本次安装长出来的：一起释放（否则父实例 dispose 后，帧内的 750ms 重压
         定时器 + observer + 原型钩子继续活着 —— 旧实现里 `dispose()` 全仓无人调用，连这一层都没有）。 */
      for (const rec of frameBus.slice()) { try { disposeFrameBus(rec, 'parent-dispose') } catch (e) {} }
      observers.length = 0; roots.length = 0; frameEls.length = 0; frameBus.length = 0;
      try { repatch.observers = 0 } catch (e) {}
      emit('disposed', { ticks: repatch.ticks, idleTicks: repatch.idleTicks, sideEffectTicks: repatch.n });
      try { delete win.__mpwAudioBus } catch (e) { win.__mpwAudioBus = null }
    },
  };
  const safeState = (ctx) => { try { return ctx.state } catch (e) { return null } };
  const countTapped = () => { let n = 0; for (const el of state.media) if (state.tappedMedia.has(el)) n++; return n };

  patchCtor(win, 'AudioContext'); patchCtor(win, 'webkitAudioContext');
  /* ④ `AudioNode.prototype` 每 realm 各装一遍（同源 iframe 的 prototype 与父页不是同一个）；
     用 `AudioNode` 而不是 `AudioContext` —— 后者身上没有 connect。 */
  if (!patchConnect(protoOf(win.AudioNode))) patchConnect(protoOf(win.AudioContext));
  patchNodeCounters(protoOf(win.AudioNode));   // ⑩ 只计数：disconnect（周期路径里必须恒为 0）
  patchCtxLifecycle();                         // ⑩ 只计数：suspend/resume（本模块永不调用；别人调了要看得见）
  patchGainRegistration();       // ⑨ 先登记"哪些参数是 GainNode.gain"，自动化钩子才分得清身份
  patchParamAutomation();        // ⑨ 再装自动化归因/裁决钩子
  patchAttribution();
  patchAttachShadow();           // ⑩ 新 shadow root ⇒ 立刻登记（替代每拍全文档扫 `*`）
  addRoot(win.document);         // ⑩ 定向登记 document 根 + 挂 MutationObserver
  shadowScanOnce();              // ⑩ 只此一次：把"装之前就存在"的 shadow root 收进来
  try { win.__mpwAudioBus = api } catch (e) {}
  try {
    const doc = win.document;
    if (doc && doc.addEventListener) {
      const onVis = () => { emit('visibility', { state: doc.visibilityState }); if (state.muted && modeMutes(state.mode)) applyMute('visibility') };
      doc.addEventListener('visibilitychange', onVis, true);
      win.addEventListener && win.addEventListener('pageshow', (e) => { emit('pageshow', { persisted: !!(e && e.persisted) }); if (state.muted && modeMutes(state.mode)) applyMute('pageshow') }, true);
      win.addEventListener && win.addEventListener('message', (e) => {          // 跨域帧配合时的入口
        try { if (e && e.data && e.data.type === BUS_MSG) api.setMuted(!!e.data.muted) } catch (err) {}
      }, false);
    }
  } catch (e) {}
  /* ⑩ 帧内那份总线：**继承父实例的 muted**（旧写法只继承 mode ⇒ 帧内静音压不住，见文件头 ⑩）。 */
  if (opts.muted !== undefined) { try { api.setMuted(!!opts.muted) } catch (e) {} }
  emit('installed', { mode: state.mode, muted: state.muted });
  return api;
}
