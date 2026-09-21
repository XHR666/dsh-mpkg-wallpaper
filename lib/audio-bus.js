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
//   ⑧ **跨 realm 各装一遍**（同源 iframe 的 `AudioNode.prototype` 与父页不是同一个）。
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

/**
 * 在一个 window 上装总线。**幂等**（同一 win 多次调用只装一遍）。
 * @param {object} win 目标 window（可传 iframe 的 contentWindow ⇒ 跨 realm 各装一遍）
 * @param {object} opts { mode, onEvent(name, detail), mediaRoots: ()=>Element[] }
 * @returns {object|null} api
 */
export function installAudioBus(win, opts = {}) {
  if (!win || typeof win !== 'object') return null;
  if (win.__mpwAudioBus && win.__mpwAudioBus.__installed) {           // 幂等：同一 realm 只装一遍
    if (opts.mode !== undefined) win.__mpwAudioBus.setMode(opts.mode);
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
    tappedMedia: new WeakSet(),   // 被 createMediaElementSource 接管的元素（不能 pause：analyser 要数据）
    redirects: 0,
    bypassSuspected: [],          // 能观测到出声但不在 bus 上的 ctx
    uncontrollable: [],           // 跨域帧（拿不到 contentDocument）
    frames: [],
  };
  let ctxSeq = 0;
  let timer = 0;
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
    try {
      if (master.gain) { master.gain.value = state.muted ? 0 : 1 }
      const origConnect = realmOrigConnect;
      if (origConnect) origConnect.call(master, ctx.destination);       // 原始引用，绕开 hook
      else if (master.connect) master.connect(ctx.destination);
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

  const registerMedia = (el) => {
    if (!el || typeof el !== 'object') return false;
    if (state.media.has(el)) return false;
    state.media.add(el);
    return true;
  };
  /** 收集媒体元素：document + **Shadow DOM**（querySelectorAll 抓不到 shadow root 里的）+ 同源 iframe。 */
  const collectMedia = (doc, out) => {
    try {
      for (const el of doc.querySelectorAll('audio,video')) out.push(el);
      for (const host of doc.querySelectorAll('*')) { if (host.shadowRoot) collectMedia(host.shadowRoot, out) }
    } catch (e) {}
    return out;
  };
  const allMedia = () => {
    const out = [];
    try { collectMedia(win.document, out) } catch (e) {}
    for (const el of state.media) out.push(el);
    if (typeof opts.mediaRoots === 'function') { try { for (const el of opts.mediaRoots() || []) out.push(el) } catch (e) {} }
    return out;
  };
  /** 压一个媒体元素：**被 createMediaElementSource 接管的不要 pause**（analyser 要数据，暂停 = 频谱恒 0）。 */
  const suppress = (el) => {
    try { el.muted = true } catch (e) {}
    try {
      if (state.tappedMedia.has(el)) { /* 只总线归零，保留元素输出给 analyser */ }
      else { el.volume = 0; if (typeof el.pause === 'function' && !el.paused) el.pause() }
    } catch (e) {}
  };

  /* ── ④ 总线静音：只动我们自己的 masterGain（不 suspend：冻结 currentTime 会破坏调度/可视化） ── */
  const applyMute = () => {
    const mute = state.muted && modeMutes(state.mode);
    /* 非静音档（off/report/redirect）**不碰 gain**：我们的 master 初值就是 1，没人会去改它；
       反过来"每次都写 1"会盖掉第三方自己对 master 的调整，也会让 redirect 诊断档失去意义
       （它要能回答"bus 到底收没收全"，而不是顺手改了音量）。只有**从静音恢复**那一次必须写回 1。 */
    if (!mute && !state.wasMuted) return;
    state.wasMuted = mute;
    for (const ctx of state.adopted) {
      const master = state.masters.get(ctx);
      if (!master || !master.gain) continue;
      try {
        const t = ctx.currentTime;
        if (master.gain.cancelScheduledValues) master.gain.cancelScheduledValues(t);
        if (master.gain.setValueAtTime) master.gain.setValueAtTime(mute ? 0 : 1, t);
        else master.gain.value = mute ? 0 : 1;
      } catch (e) { try { master.gain.value = mute ? 0 : 1 } catch (e2) {} }
    }
    for (const el of allMedia()) { try { if (mute) suppress(el); else { el.muted = false } } catch (e) {} }
    if (mute) { try { win.speechSynthesis && win.speechSynthesis.cancel && win.speechSynthesis.cancel() } catch (e) {} }
    emit('apply-mute', { muted: state.muted, mode: state.mode, contexts: state.contexts.length, media: state.media.size });
  };

  /* ── ⑤ 跨域帧：压不动就**如实报不可控**；同源帧各装一遍（跨 realm） ── */
  const syncFrames = () => {
    state.uncontrollable = [];
    let frames = [];
    try { frames = Array.prototype.slice.call(win.document.querySelectorAll('iframe')) } catch (e) {}
    state.frames = frames.map((f, i) => {
      let sameOrigin = false, cw = null;
      try { cw = f.contentWindow; sameOrigin = !!(cw && cw.document) } catch (e) { sameOrigin = false }
      if (sameOrigin && cw) { try { installAudioBus(cw, { mode: state.mode, onEvent: opts.onEvent, mediaRoots: opts.mediaRoots }) } catch (e) {} }
      else state.uncontrollable.push({ i, src: shortSrc(f.src || f.getAttribute && f.getAttribute('src')) });
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
    setMode(m) { state.mode = normalizeMode(m); applyMute(); emit('mode', { mode: state.mode }); return state.mode },
    setMuted(v) {
      state.muted = !!v;
      syncFrames();
      applyMute();
      if (state.muted && modeMutes(state.mode)) {                 // "偶发" ⇒ 周期性重压（新节点/自动化都要压住）
        if (!timer) timer = win.setInterval(() => { try { applyMute(); syncFrames() } catch (e) {} }, 750);
      } else if (timer) { try { win.clearInterval(timer) } catch (e) {} ; timer = 0 }
      return state.muted;
    },
    installFrame(cw, o) { return installAudioBus(cw, Object.assign({ mode: state.mode, onEvent: opts.onEvent }, o || {})) },
    syncFrames,
    /** 自上报快照（探针/diag 直接读它，**不需要用户操作**）。 */
    report() {
      return {
        mode: state.mode, muted: state.muted, redirects: state.redirects,
        contexts: state.contexts.map((c) => Object.assign({}, c, { ctx: undefined, adopted: state.masters.has(c.ctx), state: safeState(c.ctx) })),
        masters: state.contexts.filter((c) => state.masters.has(c.ctx)).length,
        media: allMedia().length, registered: state.media.size, tapped: countTapped(),
        bypassSuspected: state.bypassSuspected.slice(0, 12),
        uncontrollableFrames: state.uncontrollable.slice(0, 12),
        frames: state.frames.slice(0, 12),
        log: log.slice(-40),
      };
    },
    log: () => log.slice(-100),
    dispose() {
      if (timer) { try { win.clearInterval(timer) } catch (e) {} ; timer = 0 }
      for (const p of patched) { try { p.proto.connect = p.origConnect; p.proto.__mpwBusPatched = false } catch (e) {} }
      try { delete win.__mpwAudioBus } catch (e) { win.__mpwAudioBus = null }
    },
  };
  const safeState = (ctx) => { try { return ctx.state } catch (e) { return null } };
  const countTapped = () => { let n = 0; for (const el of state.media) if (state.tappedMedia.has(el)) n++; return n };

  patchCtor(win, 'AudioContext'); patchCtor(win, 'webkitAudioContext');
  /* ④ `AudioNode.prototype` 每 realm 各装一遍（同源 iframe 的 prototype 与父页不是同一个）；
     用 `AudioNode` 而不是 `AudioContext` —— 后者身上没有 connect。 */
  if (!patchConnect(protoOf(win.AudioNode))) patchConnect(protoOf(win.AudioContext));
  patchAttribution();
  try { win.__mpwAudioBus = api } catch (e) {}
  try {
    const doc = win.document;
    if (doc && doc.addEventListener) {
      const onVis = () => { emit('visibility', { state: doc.visibilityState }); if (state.muted && modeMutes(state.mode)) applyMute() };
      doc.addEventListener('visibilitychange', onVis, true);
      win.addEventListener && win.addEventListener('pageshow', (e) => { emit('pageshow', { persisted: !!(e && e.persisted) }); if (state.muted && modeMutes(state.mode)) applyMute() }, true);
      win.addEventListener && win.addEventListener('message', (e) => {          // 跨域帧配合时的入口
        try { if (e && e.data && e.data.type === BUS_MSG) api.setMuted(!!e.data.muted) } catch (err) {}
      }, false);
    }
  } catch (e) {}
  emit('installed', { mode: state.mode });
  return api;
}
