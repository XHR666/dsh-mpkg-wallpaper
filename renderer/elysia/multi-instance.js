// ═══════════════════════════════════════════════════════════════════════════════
// multi-instance.js — 一页多实例（用户第 4 项）的**调度 / 布局 / 预算 / 释放 / 诊断**层
//
// 口径来源：`docs/MULTI-INSTANCE-DESIGN.md`（用户 2026-09-15 已拍板，实施时不再问）：
//   ① 交互 = **点选激活，其余完全暂停**（不是悬停激活、不是网格自动降帧）⇒ 默认 `?inactive=pause`；
//   ② 实例上限默认 **4**（`?maxinst=` 可调）；超出上限**不创建 WebGL 上下文**，占位块里写明原因。
//
// 本模块**不碰 WebGL、不碰 bundle、不碰 demo.html 的装载逻辑**：宿主（demo.html）把
// `boot(rec)` 注入进来，本模块只负责"什么时候让谁跑一帧 / 谁不许跑 / 谁该被释放"。
// 这样它可以整体在 Node 里用桩（假 DOM / 假 rAF / 假 boot）单测 —— 见 `multi-instance-test.mjs`。
//
// ── 状态机（设计文档 §2.2）────────────────────────────────────────────────────
//     creating → active ⇄ idle → paused → disposed
//                  ↑______________________|
//   同一时刻**只有一个 active**（`selected` 唯一）；`idle` 仅在 `?inactive=idle` 时出现。
//
// ── 调度（设计文档 §2.3）─────────────────────────────────────────────────────
//   **一个** rAF 循环（不是每实例一个）；一帧最多推进 **1 个 active + 1 个到期 idle**，
//   其余记账为 skipped。paused / creating / disposed 一律 **0 帧**（rAF 回调里直接不调用）。
//
// ── 预算（设计文档 §3）───────────────────────────────────────────────────────
//   上下文 ≤ maxinst（默认 4；硬上限 HARD_MAXINST，超出按上限计并在状态条写明）；
//   `maxinst ≥ 3` 时自动降档：画布 720p（`?res=` 可覆盖）+ 粒子 `multi-idle` 档，状态条标"已降档"。
// ═══════════════════════════════════════════════════════════════════════════════

/** 默认值与硬上限（全部集中在这里，README-DIAGNOSTICS.md 的表要与之一致） */
export const MPW_MULTI_DEFAULTS = {
  MAXINST: 4,            // 设计文档 §2.1：默认 4（用户拍板）
  HARD_MAXINST: 8,       // 设计文档 §3：浏览器上下文上限 ~8–16 ⇒ 我们硬顶到 8
  LAYOUT: 'grid',
  INSTFPS_ACTIVE: 0,     // 0 = 不限（跟随 rAF）
  INSTFPS_IDLE: 4,
  INACTIVE: 'pause',     // 用户拍板：非当前实例**完全暂停**
  INSTLOG: 'active',     // 日志默认只显示 active 实例的
  DOWNGRADE_AT: 3,       // maxinst ≥ 3 → 自动降档（720p + multi-idle 粒子档）
  DOWNGRADE_RES: '720p',
  LOG_LINES: 300,        // 每实例日志环形上限（避免 N 份日志吃内存）
  SNAPSHOT_MS: 500,      // __mpwInstances 最短刷新间隔（每帧刷会白烧 CPU）
};

/** 粒子预算档（设计文档 §3：idle 档 × 0.25，新增 tier 'multi-idle'；数值 = bundle 的 normal × 0.25） */
export const MPW_MULTI_PARTICLE_BUDGET = {
  tier: 'multi-idle', perLayer: 60, total: 300, layers: 4, steps: 100, rate: 60,
};

const ID_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;

/** 统一取 query：接受 URLSearchParams / '?a=b' / 'a=b' / 空（空 = 当前 location） */
function mpwQuery(search) {
  try {
    if (search && typeof search.get === 'function' && typeof search.has === 'function') return search;   // URLSearchParams 实例
    if (typeof search === 'string' && search) return new URLSearchParams(search.replace(/^\?/, ''));
    if (typeof location !== 'undefined' && location && location.search) return new URLSearchParams(location.search);
  } catch (e) { /* 无 location（node 测试） */ }
  return new URLSearchParams('');
}

/** `?ids=` 解析：null = **没有** `?ids=`（单实例路径，必须逐位不变）；否则 {ids, invalid, dupes} */
export function mpwMultiParseIds(search) {
  const q = mpwQuery(search);
  if (!q.has('ids')) return null;                       // 关键：不传 ?ids= ⇒ 单实例（红线）
  const raw = String(q.get('ids') || '');
  const ids = [], invalid = [], dupes = [];
  for (const part of raw.split(',')) {
    const s = part.trim();
    if (!s) continue;                                   // 空项（`a,,b` / 尾逗号）静默跳过
    if (!ID_RE.test(s)) { invalid.push({ raw: s, reason: '非法 id（不是包 id 形状）' }); continue; }
    if (ids.indexOf(s) >= 0) { dupes.push(s); continue; } // 去重：保留首次出现的位置（顺序=布局顺序）
    ids.push(s);
  }
  if (!ids.length) return null;                          // `?ids=` 空/全非法 ⇒ 退回单实例（不假装多实例）
  return { ids, invalid, dupes, raw };
}

/** `?layout= / ?maxinst= / ?instfps= / ?inactive= / ?instlog=` 解析（非法值一律回默认 + 记 reason） */
export function mpwMultiParseOpts(search) {
  const D = MPW_MULTI_DEFAULTS;
  const q = mpwQuery(search);
  const notes = [];
  const g = (k) => (q.has(k) ? String(q.get(k) || '') : null);

  let layout = g('layout');
  if (layout === null || layout === '') layout = D.LAYOUT;
  else if (['grid', 'row', 'col'].indexOf(layout) < 0) { notes.push('?layout=' + layout + ' 非法（grid|row|col）→ grid'); layout = D.LAYOUT; }

  let maxinst = D.MAXINST, maxinstInvalid = null;
  const mi = g('maxinst');
  if (mi !== null && mi !== '') {
    const n = Number(mi);
    if (!isFinite(n) || Math.floor(n) !== n || n < 1) { maxinstInvalid = mi; notes.push('?maxinst=' + mi + ' 非法（正整数）→ ' + D.MAXINST); }
    else if (n > D.HARD_MAXINST) { maxinstInvalid = mi; maxinst = D.HARD_MAXINST; notes.push('?maxinst=' + mi + ' 超过硬上限 ' + D.HARD_MAXINST + ' → 按 ' + D.HARD_MAXINST + ' 计（浏览器 WebGL 上下文上限约 8–16）'); }
    else maxinst = n;
  }

  let instfps = { active: D.INSTFPS_ACTIVE, idle: D.INSTFPS_IDLE };
  const ifp = g('instfps');
  if (ifp) {
    const p = ifp.split(',');
    const pa = p[0] === undefined || p[0] === '' ? D.INSTFPS_ACTIVE : Number(p[0]);
    const pi = p[1] === undefined || p[1] === '' ? D.INSTFPS_IDLE : Number(p[1]);
    if (!isFinite(pa) || pa < 0) notes.push('?instfps active 段非法 → ' + D.INSTFPS_ACTIVE);
    else instfps.active = pa;
    if (!isFinite(pi) || pi < 0) notes.push('?instfps idle 段非法 → ' + D.INSTFPS_IDLE);
    else instfps.idle = pi;
  }

  let inactive = g('inactive');
  if (inactive === null || inactive === '') inactive = D.INACTIVE;
  else if (['pause', 'idle'].indexOf(inactive) < 0) { notes.push('?inactive=' + inactive + ' 非法（pause|idle）→ pause'); inactive = D.INACTIVE; }

  let instlog = g('instlog');
  if (instlog === null || instlog === '') instlog = D.INSTLOG;
  else if (['active', 'all'].indexOf(instlog) < 0) { notes.push('?instlog=' + instlog + ' 非法（active|all）→ active'); instlog = D.INSTLOG; }

  return { layout, maxinst, maxinstInvalid, instfps, inactive, instlog, res: g('res'), notes };
}

/** 预算裁决（设计文档 §3）：maxinst ≥ 3 → 720p + `multi-idle` 粒子档；`?res=` 可覆盖画布档 */
export function mpwMultiBudget(opts, count) {
  const D = MPW_MULTI_DEFAULTS;
  const n = Math.max(1, Number(count) || 1);
  const over = Math.max(0, n - opts.maxinst);            // 超出上限的格子数（不创建上下文）
  const downgrade = opts.maxinst >= D.DOWNGRADE_AT;
  const res = opts.res || (downgrade ? D.DOWNGRADE_RES : null);
  const reasons = [];
  if (downgrade) reasons.push('已降档：maxinst=' + opts.maxinst + ' ≥ ' + D.DOWNGRADE_AT + ' → 画布 ' + res + ' + 粒子 ' + MPW_MULTI_PARTICLE_BUDGET.tier + ' 档');
  if (opts.res && downgrade) reasons.push('（?res=' + opts.res + ' 覆盖自动降档）');
  return {
    count: n, maxinst: opts.maxinst, over, downgrade, res, lowmem: downgrade,
    // 多实例（≥2 格）就上 multi-idle 粒子档；单格且未降档时不覆盖 ⇒ 与单实例路径同预算
    particleBudget: (n >= 2 || downgrade) ? Object.assign({}, MPW_MULTI_PARTICLE_BUDGET) : null,
    reasons,
  };
}

/** 显式释放：`WEBGL_lose_context.loseContext()`（设计文档 §2.2 disposed 路径；拿不到扩展返回 false） */
export function mpwLoseContext(gl) {
  if (!gl) return false;
  try {
    const ext = gl.getExtension('WEBGL_lose_context');
    if (ext && typeof ext.loseContext === 'function') { ext.loseContext(); return true; }
  } catch (e) { /* 上下文已丢失/扩展不可用 */ }
  return false;
}

/** 真正的"还活着"的实例（disposed 的不算） */
const isLive = (r) => r && r.state !== 'disposed';

/**
 * 多实例宿主。全部外部依赖走 cfg 注入 ⇒ Node 单测可完全桩化。
 * cfg = {
 *   ids: string[],                       // 必填：布局顺序
 *   opts: mpwMultiParseOpts 的结果,
 *   budget: mpwMultiBudget 的结果,
 *   boot(rec) -> Promise<handle>,        // 必填：handle = { frame(now), dispose() }
 *   doc, win,                            // 文档/窗口（默认取全局）
 *   raf(cb) -> id, caf(id),              // 默认 requestAnimationFrame/cancelAnimationFrame
 *   now() -> ms,                         // 默认 performance.now
 *   logEl,                              // 日志元素（#log）；instlog 决定显示谁
 *   onSnapshot(rows),                    // __mpwInstances 发布点（默认写 window.__mpwInstances）
 *   onState(),                           // 状态变化（demo.html 用来刷新页级镜像）
 *   createObserver(cb) -> {observe(el)}, // IntersectionObserver 工厂（默认取 win 上的）
 * }
 */
export function createMultiInstanceHost(cfg) {
  const D = MPW_MULTI_DEFAULTS;
  const doc = cfg.doc || (typeof document !== 'undefined' ? document : null);
  const win = cfg.win || (typeof window !== 'undefined' ? window : null);
  const nowFn = cfg.now || (() => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()));
  const raf = cfg.raf || ((cb) => (win && win.requestAnimationFrame ? win.requestAnimationFrame(cb) : setTimeout(() => cb(nowFn()), 16)));
  const caf = cfg.caf || ((id) => { try { if (win && win.cancelAnimationFrame) win.cancelAnimationFrame(id); else clearTimeout(id); } catch (e) {} });
  const opts = cfg.opts || mpwMultiParseOpts('');
  const budget = cfg.budget || mpwMultiBudget(opts, (cfg.ids || []).length);

  const instances = [];
  for (let i = 0; i < (cfg.ids || []).length; i++) {
    const over = i >= budget.maxinst;
    instances.push({
      i, id: cfg.ids[i], state: over ? 'disposed' : 'creating', reason: over ? '超出实例上限' : '',
      selected: false, visible: true, pageHidden: false, ctxLost: 0, ctxRestored: 0,
      drawn: 0, pending: true, fps: 0, skipped: 0, errors: 0,
      lastRunAt: -1e9, lastTickAt: 0, handle: null, el: null, canvas: null, maskEl: null, barEls: null,
      logLines: [], ctx: { lost: 0, restored: 0, at: null },
      overLimit: over, createdAt: nowFn(), readyAt: 0, firstFrameAt: 0,
      _fpsWins: [], _lastFrameAt: -1e9,
    });
  }

  const host = {
    instances, opts, budget, ids: instances.map((r) => r.id),
    frameStats: { ticks: 0, advanced: 0, activeAdvanced: 0, idleAdvanced: 0, skipped: 0 },
    advanceLog: [],            // 最近 64 次"这一帧推进了谁"（测试断言用）
    rafId: null, running: false, started: false,
    lastSnapshotAt: -1e9, lastSnapshotJson: '',
    _logf: null,
  };

  // ── 状态推导：selected / visible / ctxLost / hidden 唯一的真值来源 ────────────
  function deriveState(r) {
    if (r.state === 'disposed') return 'disposed';
    if (!r.handle) return 'creating';
    if (!r.visible || r.pageHidden) return 'paused';
    if (r.selected) return 'active';
    return opts.inactive === 'idle' ? 'idle' : 'paused';
  }
  function reasonOf(r) {
    if (r.state === 'disposed') return r.disposedReason || r.reason || '已释放';
    if (!r.handle) return r.reason || '装载中';
    if (!r.visible) return '滚出视口（IntersectionObserver）';
    if (r.pageHidden) return '标签页隐藏';
    if (r.selected) return '当前实例（点选激活）';
    return opts.inactive === 'idle' ? 'idle 降帧档' : '未选中（点选激活后运行）';
  }
  function refresh(r) { r.state = deriveState(r); r.reason = reasonOf(r); }

  // ── 布局与容器 UI（设计文档 §2.4）────────────────────────────────────────────
  function el(tag, cls, text) {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function build() {
    if (!doc || !doc.body) return host;
    let root = doc.getElementById('mpw-inst-host');
    if (!root) { root = el('div'); root.id = 'mpw-inst-host'; doc.body.appendChild(root); }
    root.className = 'mpw-multi mpw-layout-' + opts.layout;
    root.style.cssText = 'position:fixed;inset:0;z-index:5;overflow:auto;background:#0b0b0d;padding:8px;box-sizing:border-box;'
      + (opts.layout === 'grid' ? 'display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:8px;align-content:start'
        : opts.layout === 'row' ? 'display:flex;flex-direction:row;gap:8px;align-items:stretch'
          : 'display:flex;flex-direction:column;gap:8px;align-items:stretch');
    host.root = root;

    for (const r of instances) {
      const tile = el('div', 'mpw-inst' + (r.overLimit ? ' mpw-inst-skip' : ''));
      tile.setAttribute('data-i', String(r.i));
      tile.setAttribute('data-id', r.id);
      tile.tabIndex = 0;                                  // 可访问性：Tab 聚焦 + Enter 选中
      tile.style.cssText = 'position:relative;aspect-ratio:16/9;background:#000;border:2px solid #333;border-radius:4px;overflow:hidden;outline:none';
      r.el = tile;
      if (r.overLimit) {
        // 超出上限：**不创建 canvas、不创建 WebGL 上下文**，占位块写明原因（用户拍板第 2 条）
        const ph = el('div', 'mpw-inst-skipmsg');
        ph.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;color:#f88;font:12px/1.5 system-ui;text-align:center;padding:8px';
        ph.appendChild(el('div', null, '⛔ 已跳过：超出实例上限 maxinst=' + budget.maxinst));
        ph.appendChild(el('div', null, '未创建 WebGL 上下文（?maxinst= 可调；本页共 ' + instances.length + ' 个 id）'));
        ph.appendChild(el('div', null, '包 id ' + r.id));
        tile.appendChild(ph);
        r.disposedReason = '超出实例上限 maxinst=' + budget.maxinst + '（未创建 WebGL 上下文）';
      } else {
        const cv = el('canvas', 'mpw-inst-cv');
        cv.style.cssText = 'width:100%;height:100%;display:block';
        tile.appendChild(cv);
        r.canvas = cv;
        const mask = el('div', 'mpw-inst-mask', '▶ 点击激活');
        mask.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);color:#fff;font:14px system-ui;cursor:pointer;letter-spacing:1px';
        tile.appendChild(mask);
        r.maskEl = mask;
        const bar = el('div', 'mpw-inst-bar');
        bar.style.cssText = 'position:absolute;left:0;right:0;bottom:0;display:flex;gap:10px;align-items:center;background:rgba(0,0,0,.62);color:#ddd;font:11px/1.6 monospace;padding:2px 6px';
        r.barEls = {
          name: el('span', 'mpw-inst-name', r.id),
          state: el('span', 'mpw-inst-state', '装载中…'),
          fps: el('span', 'mpw-inst-fps', '0 fps'),
          tag: el('span', 'mpw-inst-tag', budget.downgrade ? '已降档' : ''),
        };
        r.barEls.tag.style.color = '#fc6';
        for (const k of ['name', 'state', 'fps', 'tag']) bar.appendChild(r.barEls[k]);
        tile.appendChild(bar);
      }
      // 点画布/遮罩 = 选中（用户拍板第 1 条）
      const onClick = (ev) => { try { if (ev && ev.preventDefault) ev.preventDefault(); } catch (e) {} host.activate(r.i); };
      tile.addEventListener('click', onClick);
      tile.addEventListener('keydown', (ev) => {
        const k = ev && (ev.key || ev.keyCode);
        if (k === 'Enter' || k === ' ' || k === 'Spacebar' || k === 13 || k === 32) { try { ev.preventDefault(); } catch (e) {} host.activate(r.i); }
      });
      root.appendChild(tile);
    }
    // 无效 id / 去重：占位说明（不静默吞掉用户输入）
    if ((cfg.invalid && cfg.invalid.length) || (cfg.dupes && cfg.dupes.length)) {
      const note = el('div', 'mpw-inst-note');
      note.style.cssText = 'grid-column:1/-1;color:#fc6;font:12px/1.6 system-ui';
      const parts = [];
      if (cfg.invalid && cfg.invalid.length) parts.push('已忽略 ' + cfg.invalid.length + ' 个非法 id：' + cfg.invalid.map((x) => x.raw + '（' + x.reason + '）').join('、'));
      if (cfg.dupes && cfg.dupes.length) parts.push('已去重 ' + cfg.dupes.length + ' 个重复 id：' + cfg.dupes.join('、') + '（保留首次出现的位置）');
      note.textContent = parts.join('；');
      root.appendChild(note);
    }
    return host;
  }
  host.build = build;

  function updateTile(r) {
    if (!r.barEls) return;
    r.barEls.state.textContent = ({
      creating: '装载中…', active: '▶ 当前（运行中）', idle: 'idle ' + opts.instfps.idle + 'fps',
      paused: '⏸ 已暂停', disposed: '已释放',
    })[r.state] || r.state;
    r.barEls.fps.textContent = (r.fps ? r.fps.toFixed(0) : '0') + ' fps';
    if (r.maskEl) r.maskEl.style.display = r.selected ? 'none' : 'flex';
    if (r.el) r.el.style.borderColor = r.selected ? '#4af' : '#333';
    if (r.el) r.el.setAttribute('data-state', r.state);
    if (r.el) r.el.setAttribute('data-selected', r.selected ? '1' : '0');
  }

  // ── 诊断（设计文档 §2.5：字段名与顺序固定）──────────────────────────────────
  function row(r) {
    return {
      id: r.id, state: r.state, ctxLost: r.ctx.lost, fps: Math.round(r.fps * 10) / 10,
      pending: !!r.pending, drawn: r.drawn, paused: r.state === 'paused', reason: r.reason,
    };
  }
  function snapshot() { return instances.map(row); }
  function publish(force) {
    const t = nowFn();
    if (!force && t - host.lastSnapshotAt < D.SNAPSHOT_MS) return;
    host.lastSnapshotAt = t;
    const rows = snapshot();
    const j = JSON.stringify(rows);
    if (j === host.lastSnapshotJson && !force) return;
    host.lastSnapshotJson = j;
    try { if (cfg.onSnapshot) cfg.onSnapshot(rows, instances); else if (win) win.__mpwInstances = rows; } catch (e) {}
  }
  host.snapshot = snapshot;
  host.row = row;
  host.publish = publish;
  /** `/report` 的 `instances` 字段（多实例才有；单实例调用点不会走到这里） */
  host.reportInstances = () => instances.map((r) => Object.assign(row(r), {
    selected: !!r.selected, overLimit: !!r.overLimit, errors: r.errors,
    budget: { res: r.overLimit ? null : (budget.res || 'default'), downgrade: !!budget.downgrade, particleTier: budget.particleBudget ? budget.particleBudget.tier : 'default' },
  }));

  // ── 日志：每实例各自收敛（设计文档 §2.4）────────────────────────────────────
  function pushLog(i, line) {
    const r = instances[i];
    if (!r) return;
    const s = String(line);
    for (const one of s.split('\n')) {
      if (!one) continue;
      r.logLines.push(one);
      if (r.logLines.length > D.LOG_LINES) r.logLines.shift();
    }
    if (opts.instlog === 'all' || r.selected) refreshLogView();
  }
  /** 每个实例一个 logf（demo.html 的 inst.logf） */
  host.logfFor = (i) => (m) => { pushLog(i, m); try { console.log('[inst ' + instances[i].id + '] ' + m); } catch (e) {} };
  function logText() {
    if (opts.instlog === 'all') {
      const out = [];
      for (const r of instances) for (const l of r.logLines) out.push('[' + r.id + '] ' + l);
      return out.join('\n');
    }
    const a = instances.find((r) => r.selected) || instances[0];
    return a ? a.logLines.join('\n') : '';
  }
  function refreshLogView() {
    const el2 = cfg.logEl || (doc && doc.getElementById ? doc.getElementById('log') : null);
    if (!el2) return;
    try { el2.textContent = logText(); } catch (e) {}
  }
  host.logText = logText;
  host.refreshLogView = refreshLogView;

  // ── 调度器：**一个** rAF 循环（设计文档 §2.3）───────────────────────────────
  function due(r, t, fps) {
    if (!(fps > 0)) return true;                     // 0 = 不限（每帧）
    return (t - r.lastRunAt) >= (1000 / fps) - 0.5;
  }
  function runOne(r, t, kind) {
    if (!r.handle || typeof r.handle.frame !== 'function') return false;
    const dt = (r._lastFrameAt > 0) ? (t - r._lastFrameAt) : 0;
    r._lastFrameAt = t;
    r.pending = false;
    try {
      r.handle.frame(t);
      r.drawn++;
      if (!r.firstFrameAt) r.firstFrameAt = t;
      if (dt > 0) {
        r._fpsWins.push(1000 / dt);
        if (r._fpsWins.length > 30) r._fpsWins.shift();
        let s = 0; for (const w of r._fpsWins) s += w;
        r.fps = s / r._fpsWins.length;
      }
    } catch (e) {
      r.errors++;
      r.reason = '帧异常（已暂停该实例）：' + ((e && e.message) || e);
      r.selected = false;                            // 出错不再自动跑（避免每帧刷错误）
      refresh(r);
    }
    r.lastRunAt = t;
    r.lastTickAt = t;
    host.advanceLog.push({ t, i: r.i, kind });
    if (host.advanceLog.length > 64) host.advanceLog.shift();
    return true;
  }
  /** 调度器的一帧（测试直接调用；真实路径由 _loop 驱动） */
  function tick(t) {
    const tt = (typeof t === 'number' && isFinite(t)) ? t : nowFn();
    host.frameStats.ticks++;
    let advanced = 0, activeAdvanced = 0, idleAdvanced = 0;
    // ① 每帧最多 1 个 active
    const act = instances.find((r) => r.state === 'active');
    if (act && due(act, tt, opts.instfps.active)) { if (runOne(act, tt, 'active')) { advanced++; activeAdvanced++; } }
    // ② 每帧最多 1 个到期的 idle（仅 ?inactive=idle）
    if (opts.inactive === 'idle') {
      for (const r of instances) {
        if (r.state !== 'idle') continue;
        if (!due(r, tt, opts.instfps.idle)) { r.skipped++; continue; }
        if (runOne(r, tt, 'idle')) { advanced++; idleAdvanced++; }
        break;                                       // 一帧最多 1 个 idle
      }
    }
    for (const r of instances) if (r.state === 'paused' || r.state === 'creating' || r.state === 'disposed') r.skipped++;
    host.frameStats.advanced += advanced;
    host.frameStats.activeAdvanced += activeAdvanced;
    host.frameStats.idleAdvanced += idleAdvanced;
    publish(false);
    for (const r of instances) updateTile(r);
    return advanced;
  }
  host.tick = tick;

  function loop() {
    host.rafId = raf(() => {
      try { tick(nowFn()); } catch (e) { try { console.error('mpw multi tick 异常', e); } catch (e2) {} }
      if (host.running) loop();
    });
  }
  host.startLoop = () => { if (!host.running) { host.running = true; loop(); } };
  host.stopLoop = () => { host.running = false; try { if (host.rafId != null) caf(host.rafId); } catch (e) {} host.rafId = null; };

  // ── 激活 / 释放 ─────────────────────────────────────────────────────────────
  host.activate = (i) => {
    const r = instances[i];
    if (!r || r.state === 'disposed' || r.overLimit) return false;
    for (const x of instances) x.selected = false;
    r.selected = true;
    refresh(r);
    for (const x of instances) { if (!x.selected && x.handle) refresh(x); }
    if (cfg.onState) { try { cfg.onState(r, instances); } catch (e) {} }
    updateTile(r);
    if (r.handle) runOne(r, nowFn(), 'activate');    // 点选后立刻出一帧（不等下一次 rAF 排期）
    refreshLogView();
    publish(true);
    return true;
  };
  host.active = () => instances.find((r) => r.selected) || null;

  host.disposeAt = (i, reason) => {
    const r = instances[i];
    if (!r || r.state === 'disposed') return false;
    r.disposedReason = reason || '已释放（dispose）';
    try { if (r.handle && typeof r.handle.dispose === 'function') r.handle.dispose(); } catch (e) {}
    r.handle = null;
    r.selected = false;
    r.state = 'disposed';
    r.reason = r.disposedReason;
    // 从调度器摘除：状态机里 disposed 永不被 tick 选中；同时清掉画面引用
    r.canvas = null;
    if (r.maskEl) r.maskEl.style.display = 'none';
    if (r.barEls) r.barEls.state.textContent = '已释放';
    if (r.el) { r.el.setAttribute('data-state', 'disposed'); r.el.style.opacity = '.35'; }
    const nxt = instances.find((x) => isLive(x) && !x.overLimit);
    if (nxt) host.activate(nxt.i);
    publish(true);
    return true;
  };

  // ── 启动：顺序装载（并发装载会把 N 份包/纹理同时压进内存）────────────────────
  host.start = async () => {
    if (host.started) return host;
    host.started = true;
    build();
    for (const r of instances) updateTile(r);
    publish(true);
    for (const r of instances) {
      if (r.overLimit) continue;
      refresh(r);
      try {
        const h = await cfg.boot(r);                       // 宿主装载（demo.html 的 bootInstance）
        r.handle = h || null;
        r.readyAt = nowFn();
        if (r.handle && r.handle.ctx) r.ctx = r.handle.ctx;
        refresh(r);
      } catch (e) {
        r.state = 'paused';
        r.reason = '装载失败：' + ((e && e.message) || e);
        r.handle = null;
      }
      updateTile(r);
      publish(true);
    }
    const first = instances.find((r) => isLive(r) && !r.overLimit);
    if (first) host.activate(first.i);                    // 首个可跑实例默认选中（其余显示"▶ 点击激活"）
    host.startLoop();
    return host;
  };

  // ── 可见性（设计文档 §2.2：滚出视口/标签页隐藏 → paused）────────────────────
  host.observeVisibility = () => {
    const mk = cfg.createObserver || (win && win.IntersectionObserver ? (cb) => new win.IntersectionObserver(cb) : null);
    if (mk) {
      for (const r of instances) {
        if (!r.el || r.overLimit) continue;
        try {
          const ob = mk((entries) => {
            for (const en of entries) { if (en.target !== r.el) continue; r.visible = en.isIntersecting !== false; refresh(r); }
            publish(true);
          });
          ob.observe(r.el);
          r.observer = ob;
        } catch (e) { /* 无 IntersectionObserver：视为可见 */ }
      }
    }
    if (win && win.addEventListener) {
      win.addEventListener('visibilitychange', () => {
        const hidden = !!(doc && doc.hidden);
        for (const r of instances) { r.pageHidden = hidden; refresh(r); }
        publish(true);
      });
    }
    return host;
  };

  host.disposeAll = (reason) => { for (const r of instances) if (isLive(r) && !r.overLimit) host.disposeAt(r.i, reason); };
  return host;
}

export default { MPW_MULTI_DEFAULTS, MPW_MULTI_PARTICLE_BUDGET, mpwMultiParseIds, mpwMultiParseOpts, mpwMultiBudget, mpwLoseContext, createMultiInstanceHost };
