/* WE API shim 的**源文本**与**注入**（纯函数；shim 体在调用方页面里执行，本模块自身不碰 DOM）。
 * 2026-09-23 第 ⑥ 条 · docs/WEB-WALLPAPER-MERGE.md §3.4/§3.6/§3.5。
 *
 * 两条纪律：
 *  ① **只借协议形状，不复制实现**：需要覆盖哪些官方 API、注入点在哪、CSP/大小怎么判，这些是协议/事实；
 *     具体写法、命名、错误文案都是本仓自写（许可与出处：`docs/COPYING-RULES.md` §2.1 / `THIRD-PARTY.md` §7，
 *     A = 我们自己的 MIT 插件，B = 上游 MIT）。
 *  ② **不许语义造假**：音频频段必须带 `source`；没有数据源就如实空着；`simulated` 档要在日志里说明
 *     "模拟源，不是真实频谱"（§3.8）。
 */

/** 幂等标记：HTML 里见到它就**原样返回**（父页/服务端重复注入不叠加）。 */
export const WEB_SHIM_ATTR = 'data-mpw-we-shim';
/** 版本串进标记：能从产物 HTML 直接看出注入的是哪一版。 */
export const WEB_SHIM_VERSION = '1';
export const WEB_INJECT_MAX_BYTES = 8 * 1024 * 1024;

/** 把 `</script` 打断，避免 shim 文本里的字符串常量提前闭合宿主 `<script>`。 */
export function escapeScriptClose(s) {
  return String(s == null ? '' : s).replace(/<\/(script)/gi, '<\\/$1');
}

/**
 * 入口 HTML 自带的 CSP 会不会挡掉我们注入的 inline shim：`script-src` 里既没有 `'unsafe-inline'`
 * 也没有 `*` ⇒ 注了也是被浏览器拒绝的控制台报错，干脆不注入、原样返回并留痕
 * （由宿主写 `x-mpw-shim-skipped: csp`，页面的 2.5s 兜底照旧）。
 */
export function hasBlockingCsp(html) {
  const src = String(html == null ? '' : html);
  const re = /<meta[^>]+http-equiv\s*=\s*["']?Content-Security-Policy["']?[^>]*>/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    const tag = m[0];
    const content = (/content\s*=\s*"([^"]*)"/i.exec(tag) || [])[1]
      ?? (/content\s*=\s*'([^']*)'/i.exec(tag) || [])[1]
      ?? '';
    if (!/script-src/i.test(content)) continue;
    if (/script-src[^;]*'unsafe-inline'/i.test(content)) continue;
    if (/script-src[^;]*\*/i.test(content)) continue;
    return true;
  }
  return false;
}

/**
 * WE API shim 的源文本（一个自足 IIFE；只依赖 `window`，不依赖任何模块系统）。
 * 覆盖面与"为什么这么小"的取舍见 docs §3.4；明确**不提供** `$media*` / indexedDB / SW /
 * `wallpaperRegisterMediaListener`（不存在的名字）/ 定时器冻结（默认档）。
 * @param {{version?:string}} [opts]
 */
export function buildWebShimSource(opts = {}) {
  const version = String(opts.version || WEB_SHIM_VERSION);
  return `(function () {
  'use strict';
  var W = window, D = document;
  if (W.__mpwWebShim && W.__mpwWebShim.version) return;   /* 幂等：重复注入不叠加 */
  var VERSION = ${JSON.stringify(version)};
  var STATE = {
    user: null, general: null, paused: false,
    audio: null, mediaProps: null, mediaThumb: null, mediaPlayback: null, mediaTimeline: null, mediaStatus: null,
    randomFiles: null,
  };
  var LOG_BUDGET = 50, logged = 0;
  function note(kind, detail) {
    try { if (logged++ < LOG_BUDGET && W.console && W.console.warn) W.console.warn('[mpw-web-shim] ' + kind + (detail ? ': ' + detail : '')); } catch (e) {}
    try { if (W.parent && W.parent !== W) W.parent.postMessage({ mpw: 'mpw:web', op: 'author-error', kind: kind, detail: String(detail || '').slice(0, 300) }, '*'); } catch (e) {}
  }
  function post(op, payload) {
    try { if (W.parent && W.parent !== W) W.parent.postMessage(Object.assign({ mpw: 'mpw:web', op: op }, payload || {}), '*'); } catch (e) {}
  }
  /* 回调一律**延后到微任务**：同步回调会重入 React 类作者的渲染函数（白屏），这是 A/B 两侧共同的现场结论。 */
  function later(fn, arg) {
    if (typeof fn !== 'function') return;
    try { Promise.resolve().then(function () { try { fn(arg); } catch (e) { note('listener-threw', e && e.message); } }); } catch (e) { note('defer-failed', e && e.message); }
  }
  /* ── 属性面：赋值只登记；晚挂的 listener 拿**全量快照**；**同一个对象重复赋值不重放** ── */
  var listener = null, assignedProp = null;
  var snapProps = null, snapGeneral = null;
  function replayTo(l) {
    if (!l || typeof l !== 'object') return;
    if (snapProps) later(l.applyUserProperties, snapProps);
    if (snapGeneral) later(l.applyGeneralProperties, snapGeneral);
  }
  try {
    Object.defineProperty(W, 'wallpaperPropertyListener', {
      configurable: true, enumerable: true,
      get: function () { return assignedProp; },
      set: function (v) { if (v === assignedProp) return; assignedProp = v; listener = (v && typeof v === 'object') ? v : null; replayTo(listener); },
    });
  } catch (e) { note('listener-define-failed', e && e.message); W.wallpaperPropertyListener = null; }
  /* ── 官方 API ── */
  W.wallpaperRegisterAudioListener = function (cb) { W.__mpwWebAudioCb = (typeof cb === 'function') ? cb : null; if (STATE.audio && W.__mpwWebAudioCb && !STATE.paused) later(W.__mpwWebAudioCb, STATE.audio); };
  function regMedia(name, key) {
    W[name] = function (cb) { if (typeof cb !== 'function') return; W['__mpw' + key + 'Cb'] = cb; if (STATE[key]) later(cb, STATE[key]); };
  }
  regMedia('wallpaperRegisterMediaPropertiesListener', 'mediaProps');
  regMedia('wallpaperRegisterMediaThumbnailListener', 'mediaThumb');
  regMedia('wallpaperRegisterMediaPlaybackListener', 'mediaPlayback');
  regMedia('wallpaperRegisterMediaTimelineListener', 'mediaTimeline');
  regMedia('wallpaperRegisterMediaStatusListener', 'mediaStatus');
  /* ⚠ 取值必须是官方那三个数：缺省会让作者的 PLAYING || 0 把「播放」误判成 0（§3.4）。 */
  W.wallpaperMediaIntegration = { PLAYBACK_STOPPED: 0, PLAYING: 1, PAUSED: 2 };
  /* 池空 ⇒ 回调空串（作者普遍 if (p) 守卫）。 */
  W.wallpaperRequestRandomFileForProperty = function (prop, cb) {
    if (typeof cb !== 'function') return;
    var pool = (STATE.randomFiles && STATE.randomFiles[prop]) || null;
    later(cb, (pool && pool.length) ? pool[Math.floor(Math.random() * pool.length)] : '');
  };
  W.wallpaperPluginListener = W.wallpaperPluginListener || { onPluginLoaded: function () {} };
  /* ── ?webpause=hard：冻结作者的计时器（rAF / setTimeout / setInterval） ──────────────────────
     为什么默认**不做**：它会改作者的计时语义（档位文档里写明）。开启后暂停期间回调排队不发，
     恢复时按"只补一次"的策略放行 —— 不重放累积的每一帧（那会让页面在恢复瞬间卡住）。 */
  function installHardPause() {
    if (W.__mpwHardPause) return;
    var raf = W.requestAnimationFrame, caf = W.cancelAnimationFrame;
    var st = W.setTimeout, si = W.setInterval, ct = W.clearTimeout, ci = W.clearInterval;
    var heldRaf = [], heldTimer = [];
    W.__mpwHardPause = { on: true, heldRaf: heldRaf, heldTimer: heldTimer };
    if (typeof raf === 'function') W.requestAnimationFrame = function (cb) {
      if (!STATE.paused) return raf.call(W, cb);
      return heldRaf.push(cb) - 1 + 1000000;   /* 假 id：恢复前取消不了（与冻结语义一致） */
    };
    if (typeof caf === 'function') W.cancelAnimationFrame = function (id) { if (id < 1000000) return caf.call(W, id); heldRaf[id - 1000000] = null; };
    if (typeof st === 'function') W.setTimeout = function (fn, ms) {
      var args = [].slice.call(arguments, 2);
      if (!STATE.paused) return st.apply(W, arguments);
      return heldTimer.push(function () { try { fn.apply(W, args); } catch (e) { note('hardpause-threw', e && e.message); } }) - 1 + 1000000;
    };
    if (typeof ct === 'function') W.clearTimeout = function (id) { if (id < 1000000) return ct.call(W, id); heldTimer[id - 1000000] = null; };
    if (typeof si === 'function') W.setInterval = function (fn, ms) {
      var args = [].slice.call(arguments, 2);
      if (!STATE.paused) return si.apply(W, arguments);
      var slot = heldTimer.push(null) - 1 + 1000000;
      var self = W.setInterval;   /* 递归时用被包装后的自己 ⇒ 恢复后自然变成真 interval */
      var tick = function () { try { fn.apply(W, args); } catch (e) { note('hardpause-threw', e && e.message); } };
      heldTimer[slot - 1000000] = function () { tick(); heldTimer[slot - 1000000] = null; si.call(W, tick, Math.max(16, Number(ms) || 16)); };
      return slot;
    };
    if (typeof ci === 'function') W.clearInterval = function (id) { if (id < 1000000) return ci.call(W, id); heldTimer[id - 1000000] = null; };
  }
  function releaseHardPause() {
    var hp = W.__mpwHardPause;
    if (!hp) return 0;
    var released = 0;
    var raf = hp.heldRaf;
    for (var i = 0; i < raf.length; i++) { var cb = raf[i]; if (typeof cb === 'function') { released++; try { W.requestAnimationFrame(cb); } catch (e) {} } }
    raf.length = 0;
    var tm = hp.heldTimer;
    for (var j = 0; j < tm.length; j++) { var fn = tm[j]; if (typeof fn === 'function') { released++; try { fn(); } catch (e) {} } }
    tm.length = 0;
    return released;
  }
  /* ── 交互桥（sandbox 档：合成事件；compat 档用原生，不走这里） ─────────────────────────
     协议：宿主发 {mpw:'mpw:web', op:'pointer'|'wheel'|'touch', type, x, y, …}（坐标 = **帧内 client 像素**）。
     固有边界（照实说，不假装）：合成事件 isTrusted 恒为 false、CSS :hover/:active **不生效**
     —— 这正是 compat 档存在的理由（原生透传才有真语义）。 */
  function hit(x, y) {
    try { return D.elementFromPoint(x, y) || D.body || D.documentElement } catch (e) { return D.body || null }
  }
  function fire(target, type, init, Ctor) {
    if (!target) return false;
    var ev = null;
    try { ev = new Ctor(type, init); } catch (e) { ev = null; }
    if (!ev) { note('synthetic-unsupported', type); return false; }
    try { target.dispatchEvent(ev); return true; } catch (e) { note('dispatch-failed', type); return false; }
  }
  var lastHit = null, downHit = null;
  function pointerInit(msg) {
    return { bubbles: true, cancelable: true, composed: true, clientX: Number(msg.x) || 0, clientY: Number(msg.y) || 0,
      button: Number(msg.button) || 0, buttons: Number(msg.buttons) || 0, pointerId: Number(msg.pointerId) || 1,
      pointerType: msg.pointerType || 'mouse', isPrimary: true, view: W };
  }
  function dispatchPointer(msg) {
    var t = String(msg.type || '');
    var target = hit(Number(msg.x) || 0, Number(msg.y) || 0);
    var init = pointerInit(msg);
    var n = 0;
    if (t === 'move' && target !== lastHit) {
      if (lastHit) { n += fire(lastHit, 'pointerout', init, W.PointerEvent || W.MouseEvent) ? 1 : 0; n += fire(lastHit, 'pointerleave', init, W.PointerEvent || W.MouseEvent) ? 1 : 0; }
      n += fire(target, 'pointerover', init, W.PointerEvent || W.MouseEvent) ? 1 : 0;
      n += fire(target, 'pointerenter', init, W.PointerEvent || W.MouseEvent) ? 1 : 0;
      lastHit = target;
    }
    if (t === 'down') { downHit = target; n += fire(target, 'pointerdown', init, W.PointerEvent || W.MouseEvent) ? 1 : 0; }
    else if (t === 'up') n += fire(target, 'pointerup', init, W.PointerEvent || W.MouseEvent) ? 1 : 0;
    else n += fire(target, 'pointermove', init, W.PointerEvent || W.MouseEvent) ? 1 : 0;
    /* 作者脚本里大量用的是 mouse 系列（addEventListener('mousemove')）⇒ 同一位置补一份。 */
    var mtype = t === 'down' ? 'mousedown' : (t === 'up' ? 'mouseup' : 'mousemove');
    n += fire(target, mtype, init, W.MouseEvent) ? 1 : 0;
    /* click 的真实语义是「**按下与抬起在同一元素**」，与中间有没有 move 无关（第一版只在 move 过之后补，
       真机探针恰好先 move 才没暴露；vm 单测 X3 直接 down→up 就红了）。 */
    if (t === 'up') { if (target && target === downHit) n += fire(target, 'click', init, W.MouseEvent) ? 1 : 0; downHit = null; }
    var r = { ok: true, hit: !!(target && target !== D.body), fired: n };
post('interaction', { kind: 'pointer', type: t, x: Number(msg.x) || 0, y: Number(msg.y) || 0, hit: !!r.hit, fired: r.fired, isTrusted: false });
    return r;
  }
  function dispatchWheel(msg) {
    var target = hit(Number(msg.x) || 0, Number(msg.y) || 0);
    var init = { bubbles: true, cancelable: true, composed: true, clientX: Number(msg.x) || 0, clientY: Number(msg.y) || 0,
      deltaX: Number(msg.deltaX) || 0, deltaY: Number(msg.deltaY) || 0, deltaMode: Number(msg.deltaMode) || 0, view: W };
    var n = fire(target, 'wheel', init, W.WheelEvent || W.MouseEvent) ? 1 : 0;
    /* 现代 wheel + legacy mousewheel（部分老作者只听后者）。 */
    n += fire(target, 'mousewheel', Object.assign({}, init, { wheelDelta: -(Number(msg.deltaY) || 0) }), W.MouseEvent) ? 1 : 0;
    post('interaction', { kind: 'wheel', type: 'wheel', x: Number(msg.x) || 0, y: Number(msg.y) || 0, hit: !!(target && target !== D.body), fired: n, isTrusted: false });
    return { ok: true, fired: n };
  }
  function dispatchTouch(msg) {
    var t = String(msg.type || '');
    var target = hit(Number(msg.x) || 0, Number(msg.y) || 0);
    var id = Number(msg.identifier) || 1;
    if (typeof W.Touch === 'function' && typeof W.TouchEvent === 'function') {
      try {
        var touch = new W.Touch({ identifier: id, target: target, clientX: Number(msg.x) || 0, clientY: Number(msg.y) || 0, pageX: Number(msg.x) || 0, pageY: Number(msg.y) || 0 });
        var ev = new W.TouchEvent('touch' + t, { bubbles: true, cancelable: true, composed: true,
          touches: t === 'end' ? [] : [touch], targetTouches: t === 'end' ? [] : [touch], changedTouches: [touch], view: W });
        target.dispatchEvent(ev);
        post('interaction', { kind: 'touch', type: t, x: Number(msg.x) || 0, y: Number(msg.y) || 0, hit: !!(target && target !== D.body), fired: 1, isTrusted: false });
        return { ok: true, kind: 'toucht' , fired: 1 };
      } catch (e) { note('touch-ctor-failed', e && e.message); }
    }
    /* 三级构造阶梯的最后一级：真 TouchEvent 不可用 ⇒ 退回 pointer/mouse 合成，并**如实标 kind**（不假装是触摸）。 */
    var r = t === 'start' ? dispatchPointer({ type: 'down', x: msg.x, y: msg.y, pointerType: 'touch' })
      : (t === 'end' ? dispatchPointer({ type: 'up', x: msg.x, y: msg.y, pointerType: 'touch' })
        : dispatchPointer({ type: 'move', x: msg.x, y: msg.y, pointerType: 'touch' }));
    post('interaction', { kind: 'touch-pointer-fallback', type: t, x: Number(msg.x) || 0, y: Number(msg.y) || 0, hit: false, fired: r.fired, isTrusted: false });
    return { ok: true, kind: 'pointer-fallback', fired: r.fired };
  }
  /* ── 控制面（宿主 → 帧）：同一套语义既走 postMessage 也走 __mpwWebControl ── */
  function control(msg) {
    if (!msg || typeof msg !== 'object') return null;
    switch (msg.op) {
      case 'props':
        snapProps = (msg.props && typeof msg.props === 'object') ? msg.props : null;
        STATE.user = snapProps;
        replayTo(listener);
        /* ①(2026-09-25) 帧内回执：宿主 updateWebProps 要能证明"真的到了帧里并被应用"，
           所以这里回报一条，形状与其它上报一致（宿主侧记进 __mpwWebFrame.propsApplied）。
           只在真应用之后发；snapProps 为空也照发（宿主能区分"到了但空表"与"根本没到"）。
           ⚠ 本文件整体是**模板字符串**（注入到帧里的脚本正文）⇒ 注释里**不许出现反引号**，
           否则字符串就地截断、整份 shim 语法错误（2026-09-25 实测踩到：页面直接"渲染器 module 未启动"）。 */
        post('props-applied', { keys: snapProps ? Object.keys(snapProps) : [], count: snapProps ? Object.keys(snapProps).length : 0, via: 'shim' });
        return { ok: true };
      case 'general':
        snapGeneral = (msg.general && typeof msg.general === 'object') ? msg.general : null;
        STATE.general = snapGeneral;
        replayTo(listener);
        return { ok: true };
      case 'pause': {
        var p = !!msg.paused;
        STATE.paused = p;
        if (listener && typeof listener.setPaused === 'function') later(listener.setPaused, p);
        freezeMedia(p);
        /* ?webpause=hard：只在该档装计时器冻结；默认档一个字都不碰作者的计时语义。 */
        if (p && W.__mpwHardPauseEnabled) installHardPause();
        if (!p && W.__mpwHardPause) { var n = releaseHardPause(); post('hardpause', { released: n }); }
        post('paused', { paused: p });
        return { ok: true, paused: p };
      }
      case 'audio':
        STATE.audio = Array.isArray(msg.bands) ? msg.bands : null;
        if (STATE.audio && !STATE.paused && W.__mpwWebAudioCb) { later(W.__mpwWebAudioCb, STATE.audio); post('audio-received', { len: STATE.audio.length, source: msg.source || '' }); }
        else post('audio-dropped', { len: STATE.audio ? STATE.audio.length : 0, paused: !!STATE.paused, hasListener: !!W.__mpwWebAudioCb });
        return { ok: true };
      case 'media':
        for (var k of ['mediaProps', 'mediaThumb', 'mediaPlayback', 'mediaTimeline', 'mediaStatus']) {
          if (msg[k] === undefined) continue;
          STATE[k] = msg[k];
          if (W['__mpw' + k + 'Cb']) later(W['__mpw' + k + 'Cb'], STATE[k]);
        }
        return { ok: true };
      case 'random':
        STATE.randomFiles = (msg.files && typeof msg.files === 'object') ? msg.files : null;
        return { ok: true };
      case 'key': {
        var t2 = String(msg.type || 'down');
        var tgt = null;
        try { tgt = D.activeElement || D.body; } catch (e) { tgt = D.body; }
        var kinit = { key: String(msg.key || ''), code: String(msg.code || ''), keyCode: Number(msg.keyCode) || 0,
          which: Number(msg.keyCode) || 0, altKey: !!msg.altKey, ctrlKey: !!msg.ctrlKey, metaKey: !!msg.metaKey,
          shiftKey: !!msg.shiftKey, repeat: !!msg.repeat, bubbles: true, cancelable: true, composed: true, view: W };
        var okKey = fire(tgt, t2 === 'up' ? 'keyup' : 'keydown', kinit, W.KeyboardEvent || W.Event);
        post('interaction', { kind: 'key', type: t2, x: 0, y: 0, hit: !!tgt, fired: okKey ? 1 : 0, isTrusted: false, key: kinit.key });
        return { ok: true, fired: okKey ? 1 : 0 };
      }
      case 'hardpause':
        W.__mpwHardPauseEnabled = !!msg.enabled;
        post('hardpause-ack', { enabled: W.__mpwHardPauseEnabled, active: !!W.__mpwHardPause, paused: !!STATE.paused });
        return { ok: true, enabled: W.__mpwHardPauseEnabled };
      case 'pointer': return dispatchPointer(msg);
      case 'wheel': return dispatchWheel(msg);
      case 'touch': return dispatchTouch(msg);
      default:
        return null;
    }
  }
  W.__mpwWebControl = control;
  try { W.addEventListener('message', function (ev) { if (ev && ev.data && ev.data.mpw === 'mpw:web') control(ev.data); }); } catch (e) {}
  /* ── 暂停：帧内 media 一并冻结/解冻（温和档；不改作者计时器语义） ── */
  var frozen = [];
  function mediaEls() {
    var out = [];
    try { out = [].slice.call(D.querySelectorAll('audio,video')); } catch (e) {}
    try { if (W.__mpwWebMedia && W.__mpwWebMedia.length) out = out.concat(W.__mpwWebMedia); } catch (e) {}
    return out;
  }
  function freezeMedia(on) {
    var els = mediaEls();
    if (on) {
      frozen = [];
      for (var i = 0; i < els.length; i++) { var el = els[i]; try { if (!el.paused) { frozen.push(el); el.pause(); } } catch (e) {} }
    } else {
      for (var j = 0; j < frozen.length; j++) { try { var f = frozen[j]; if (f && f.play) f.play().catch(function () {}); } catch (e) {} }
      frozen = [];
    }
  }
  /* ── 存储 facade：**只在真 storage 访问就抛**时安装（不透明源），真能用时一个字节都不动 ── */
  function realStorageOk(name) {
    try { var s = W[name]; s.setItem('__mpw_probe', '1'); s.removeItem('__mpw_probe'); return true; } catch (e) { return false; }
  }
  var STORE_LIMITS = { value: 4096, keys: 64, bytes: 65536 };
  function quotaError() { try { return new DOMException('quota exceeded', 'QuotaExceededError'); } catch (e) { var err = new Error('quota exceeded'); err.name = 'QuotaExceededError'; return err; } }
  function installFacade(name) {
    var mem = Object.create(null), size = 0, hydrated = false;
    /* 种子回灌（懒加载）：种子脚本插在 shim **之后**（与插件的顺序一致），所以这里不能在安装时读；
       第一次访问时再取 __mpwWebSeed.store.data，语义上仍然"首帧就有值"（同步读得到）。 */
    function hydrate() {
      if (hydrated) return;
      hydrated = true;
      try {
        var seed = W.__mpwWebSeed;
        var data = seed && seed.store && seed.store.data;
        if (data && typeof data === 'object') {
          for (var k in data) { if (!Object.prototype.hasOwnProperty.call(data, k)) continue; var v = String(data[k]); if (v.length > STORE_LIMITS.value) continue; if (Object.keys(mem).length >= STORE_LIMITS.keys) break; mem[k] = v; size += v.length; }
        }
      } catch (e) { note('store-hydrate-failed', e && e.message); }
    }
    var q = (function () { try { return new URLSearchParams(W.location.search).get('webstore'); } catch (e) { return null; } })();
    if (q === '0') return;                                  /* webstore=0 = 保留旧行为（访问即抛） */
    var memOnly = (q === 'mem');
    var timer = null;
    function flush() {
      timer = null;
      if (memOnly) return;
      var body = { wallId: (function () { try { return new URLSearchParams(W.location.search).get('id') || ''; } catch (e) { return ''; } })(), data: mem };
      try { W.fetch('/api/web-store', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(body) }).catch(function () {}); } catch (e) {}
    }
    function schedule() { if (timer != null) return; timer = setTimeout(flush, 400); }
    var api = {
      getItem: function (k) { hydrate(); k = String(k); return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      setItem: function (k, v) { k = String(k); v = String(v); if (v.length > STORE_LIMITS.value) throw quotaError(); var had = Object.prototype.hasOwnProperty.call(mem, k); var delta = (had ? mem[k].length : 0); size += v.length - delta; if (Object.keys(mem).length + (had ? 0 : 1) > STORE_LIMITS.keys || size > STORE_LIMITS.bytes) { size -= v.length - delta; throw quotaError(); } mem[k] = v; schedule(); },
      removeItem: function (k) { k = String(k); if (Object.prototype.hasOwnProperty.call(mem, k)) { size -= mem[k].length; delete mem[k]; schedule(); } },
      clear: function () { mem = Object.create(null); size = 0; schedule(); },
      key: function (i) { hydrate(); var ks = Object.keys(mem); return i >= 0 && i < ks.length ? ks[i] : null; },
    };
    try { Object.defineProperty(api, 'length', { get: function () { hydrate(); return Object.keys(mem).length; } }); } catch (e) {}
    try { Object.defineProperty(W, name, { configurable: true, get: function () { return api; } }); } catch (e) {}
  }
  try { if (!realStorageOk('localStorage')) installFacade('localStorage'); } catch (e) {}
  try { if (!realStorageOk('sessionStorage')) installFacade('sessionStorage'); } catch (e) {}
  /* ── 作者异常兜住（不弹框、不改壁纸状态） ── */
  try { W.addEventListener('error', function (ev) { note('error', ev && ev.message); }); } catch (e) {}
  try { W.addEventListener('unhandledrejection', function (ev) { note('rejection', ev && ev.reason && (ev.reason.message || ev.reason)); }); } catch (e) {}
  /* ── 种子（首帧策略：免等宿主 postMessage）+ ready ── */
  try { if (W.__mpwWebSeed && typeof W.__mpwWebSeed === 'object') { control(W.__mpwWebSeed); } } catch (e) { note('seed-failed', e && e.message); }
  W.__mpwWebShim = { version: VERSION, state: STATE, control: control };
  post('ready', { version: VERSION });
})();`;
}

/**
 * 把 shim（+ 可选种子脚本）插到入口 HTML 里，保证**作者脚本执行前** shim 已在位。
 * 插入点：`<head>` 之后 > `<html>` 之后（自造 head）> 整段前缀（残缺 HTML）。
 * 只做这些：幂等、转义 `</script`、无 head 自造、超限跳过、CSP 命中跳过；**抛错只 warn 不 500**。
 * @param {string} html
 * @param {{shimSource?:string, seed?:object|null, maxBytes?:number, skipCsp?:boolean}} [opts]
 * @returns {{html:string, injected:boolean, skipped:boolean, reason:string, bytes:number}}
 */
export function injectWebShim(html, opts = {}) {
  const src = typeof html === 'string' ? html : '';
  const bytes = src.length;
  const maxBytes = Number.isFinite(Number(opts.maxBytes)) ? Number(opts.maxBytes) : WEB_INJECT_MAX_BYTES;
  if (!src) return { html: src, injected: false, skipped: true, reason: 'empty', bytes, replacements: [], replaced: 0 };
  if (bytes > maxBytes) return { html: src, injected: false, skipped: true, reason: 'too-large', bytes, replacements: [], replaced: 0 };
  if (new RegExp(WEB_SHIM_ATTR + '(=|\\s|>)', 'i').test(src)) return { html: src, injected: false, skipped: true, reason: 'already', bytes, replacements: [], replaced: 0 };
  if (opts.skipCsp !== false && hasBlockingCsp(src)) return { html: src, injected: false, skipped: true, reason: 'csp', bytes };
  /* 注入前的**内容替换**（默认空表 ⇒ 逐字节不变；报表随返回值一起给出，供宿主记账/打响应头）。 */
  const rep = applyWebReplacements(src, opts.replacements);
  const body = rep.html;
  const withRep = (r) => Object.assign(r, { replacements: rep.report, replaced: rep.total });
  const shim = typeof opts.shimSource === 'string' && opts.shimSource ? opts.shimSource : buildWebShimSource();
  const seed = opts.seed && typeof opts.seed === 'object'
    ? '\n<script ' + WEB_SHIM_ATTR + '-seed="' + WEB_SHIM_VERSION + '">\nwindow.__mpwWebSeed=' + escapeScriptClose(JSON.stringify(opts.seed)) + ';\n</script>'
    : '';
  const inject = '<script ' + WEB_SHIM_ATTR + '="' + WEB_SHIM_VERSION + '">\n' + escapeScriptClose(shim) + '\n</script>' + seed;
  const head = /<head(\s[^>]*)?>/i.exec(body);
  if (head) {
    const at = head.index + head[0].length;
    return withRep({ html: body.slice(0, at) + inject + body.slice(at), injected: true, skipped: false, reason: 'head', bytes });
  }
  const htmlOpen = /<html(\s[^>]*)?>/i.exec(body);
  if (htmlOpen) {
    const at = htmlOpen.index + htmlOpen[0].length;
    return withRep({ html: body.slice(0, at) + '<head>' + inject + '</head>' + body.slice(at), injected: true, skipped: false, reason: 'made-head', bytes });
  }
  return withRep({
    html: '<!DOCTYPE html><html><head>' + inject + '</head><body>' + body + '</body></html>',
    injected: true, skipped: false, reason: 'made-document', bytes,
  });
}

/* ── 注入面的**内容替换**（可配置、默认关闭）─────────────────────────────────────────────────────────
 * 用途（第 17 条「内嵌文字与图标没被改成我们的」）：网页档的作者 HTML 里常带写死的署名文字/图标路径，
 * 宿主可能想把它换成自己的。这里只提供**机制**：一张 `[{from, to, count?}]` 表，在注入 shim **之前**
 * 对 HTML 源做字面替换 —— 内容由调用方给（默认空表 ⇒ 一个字节都不动，避免我们替用户编品牌名）。
 * 纪律：
 *   ① 只做**字面**替换（不做正则、不碰 `<script>` 之外的语义），`from` 为空/非串一律忽略；
 *   ② `count` 缺省 = 全部替换；给了就最多替换那么多次（便于"只换第一处"这类需求）；
 *   ③ 如实回报每条的替换数（`replaced`），**0 命中不报错**（作者改版了很正常）。
 *   ⚠ 图标替换天然是 URL 级的：作者写 `src="author.png"`，把 `author.png` 换成宿主的路径即可（同一张表）。
 */
export function applyWebReplacements(html, list) {
  let out = typeof html === 'string' ? html : '';
  const rows = Array.isArray(list) ? list : [];
  const report = [];
  for (const r of rows) {
    const from = (r && typeof r.from === 'string') ? r.from : '';
    const to = (r && typeof r.to === 'string') ? r.to : '';
    if (!from) continue;
    const limit = Number.isFinite(Number(r.count)) && Number(r.count) > 0 ? Math.floor(Number(r.count)) : Infinity;
    let n = 0;
    if (limit === Infinity) {
      const parts = out.split(from);
      n = parts.length - 1;
      if (n > 0) out = parts.join(to);
    } else {
      let idx = 0;
      while (n < limit) {
        const at = out.indexOf(from, idx);
        if (at < 0) break;
        out = out.slice(0, at) + to + out.slice(at + from.length);
        idx = at + to.length;
        n++;
      }
    }
    report.push({ from: from.slice(0, 40), to: to.slice(0, 40), n });
  }
  return { html: out, report, total: report.reduce((a, b) => a + b.n, 0) };
}
