// scene-props-compat.js —— 插件↔渲染器「属性/层控兼容层」的**纯逻辑真源**（任务单 P4）
//
// 角色（与 lib/web-wallpaper.js 的"真源 + client.js 镜像"同款）：
//   · 本文件 = 消息封装与判定逻辑的**唯一源**（纯 ESM，零 node/browser 依赖 ⇒ Node 判据可直测）；
//   · lib/client.js 是单文件产物，运行期用**镜像**（`[scene-props-compat BEGIN/END]` 块）；
//     镜像漂移由 tools/props-compat-test.mjs 的逐项对拍看住（同夹具、同期望、两侧对跑）。
//
// 覆盖的 op（渲染器侧 demo.html 的 [props-compat] 块，任务单 P3）：
//   mpw-props-describe / mpw-props-reset / mpw-layers-list / mpw-layers-set / mpw-ui-set
//   回执 = `<op>-result`，带 `rid` 配对；describe 另带 `schemaVersion:1`。
//
// 客户端纪律（与 P-203 下发通道同一套）：
//   · rid 单调 + 每次调用唯一；同帧同 op 同载荷签名且在途 ⇒ **幂等**（复用在途 Promise，不重发）；
//   · 超时（默认 4000ms）⇒ 同 rid 重发（重试上限默认 2 ⇒ 最多 3 次发送）；耗尽 ⇒ resolve
//     `{ ok:false, why:'timeout-exhausted' }`（**不抛**，调用方按失败如实处理，不静默）；
//   · 回执按 rid 配对；不认识的回执不消费（P-203 的 ack 有自己的通道）；
//   · 台账 `window.__mpwPropsCompat`：{n, ok, fail, timeouts, retries, pending, last, log[]}（有界 24 条）。
//
// 许可：MIT（本仓库自写）。与渲染器（GPL-3.0-or-later）的关系：只走 postMessage 协议，不 import/内嵌其任何代码。

/** 五个 op 与回执类型（与渲染器侧 MPW_PROPS_COMPAT_OPS 一一对应）。 */
export const PROPS_COMPAT_OPS = [
  'mpw-props-describe', 'mpw-props-reset', 'mpw-layers-list', 'mpw-layers-set', 'mpw-ui-set',
];
export const propsCompatResultTypeOf = (op) => (PROPS_COMPAT_OPS.indexOf(op) >= 0 ? op + '-result' : null);
export const isPropsCompatOp = (t) => PROPS_COMPAT_OPS.indexOf(t) >= 0;
export const isPropsCompatResult = (t) => PROPS_COMPAT_OPS.some((op) => t === op + '-result');

/** `?propscompat=legacy`（off/0/false 同义）= 插件侧回退：面板吃本地模型、不发 describe/reset/层控 op。
 *  与 `proppush=legacy` 同一套解析口径（sceneDebugParams 里的 `k=v` 片段）。 */
export function propsCompatLegacyOf(sceneDebugParams) {
  try {
    const m = /(?:^|[;&\s])propscompat\s*=\s*([^;&\s]*)/i.exec(String(sceneDebugParams || ''));
    if (!m) return false;
    const v = String(m[1] || '').toLowerCase();
    return v === 'legacy' || v === 'off' || v === '0' || v === 'false';
  } catch (e) { return false; }
}

/** rid：单调序号 + 时间尾（同毫秒多次调用也不撞）。 */
export function propsCompatRidGen() {
  let n = 0;
  return () => 'pc' + (++n) + '-' + Date.now().toString(36);
}

/**
 * 客户端状态机。deps：
 *   post(frame, msg)        —— 真发送（跨源 postMessage；抛错 = 发送失败，按 timeout 走）
 *   now()                   —— 可注入时钟（判据用）
 *   setTimeout/clearTimeout —— 可注入定时器（判据用）
 *   ledgerTarget()          —— 台账挂载对象（真页面 = window；判据 = 桩）
 */
export function createPropsCompatClient(deps) {
  const D = deps || {};
  const post = D.post || (() => false);
  const now = D.now || (() => Date.now());
  const setT = D.setTimeout || ((fn, ms) => setTimeout(fn, ms));
  const clearT = D.clearTimeout || ((id) => clearTimeout(id));
  const ledTarget = D.ledgerTarget || null;

  const ridNext = D.ridGen || propsCompatRidGen();
  const TIMEOUT_MS = D.timeoutMs || 4000;
  const RETRY_CAP = D.retryCap !== undefined ? D.retryCap : 2;   // 重试上限（不含首次）⇒ 最多 3 次发送
  const LOG_MAX = 24;

  /** pending: rid → {rid, op, sig, resolve, timer, attempts, at, frameKey} */
  const pending = new Map();
  const ledger = { n: 0, ok: 0, fail: 0, timeouts: 0, retries: 0, pending: 0, last: null, log: [] };
  const note = (row) => {
    try {
      ledger.log.push(row); if (ledger.log.length > LOG_MAX) ledger.log.shift();
      ledger.last = row;
      if (ledTarget) ledTarget.__mpwPropsCompat = ledger;
    } catch (e) { /* 记账失败不影响主链 */ }
  };
  const sigOf = (op, payload) => {
    try { return op + '|' + JSON.stringify(payload === undefined ? null : payload); } catch (e) { return op + '|<unserializable>'; }
  };

  /** 收到一条 message data：认得 ⇒ 配对 resolve 并返回 true（消费了）；不认识 ⇒ false。 */
  function onResult(data) {
    try {
      if (!data || typeof data !== 'object' || !isPropsCompatResult(data.type)) return false;
      const rid = data.rid;
      const rec = (rid !== undefined && rid !== null) ? pending.get(rid) : null;
      if (!rec) return false;                       // 没有在途调用（迟到/陌生 rid）⇒ 不消费
      pending.delete(rid);
      if (rec.timer) { try { clearT(rec.timer); } catch (e) { /* 已清 */ } rec.timer = null; }
      ledger.pending = pending.size;
      ledger.ok += (data && data.ok) ? 1 : 0;
      ledger.fail += (data && data.ok) ? 0 : 1;
      note({ at: now(), rid: rec.rid, op: rec.op, ok: !!(data && data.ok), why: String((data && data.why) || ''), attempts: rec.attempts, kind: 'receipt' });
      try { rec.resolve(data); } catch (e) { /* resolve 不抛 */ }
      return true;
    } catch (e) { return false; }
  }

  /** 发一次（含重试）。payload 直接进消息体顶层（渲染器按 op 各自读 rid/payload 键）。 */
  function call(frame, op, payload, opts) {
    const O = opts || {};
    const sig = sigOf(op, payload);
    // 幂等：同帧同 op 同载荷且在途 ⇒ 复用在途 Promise
    for (const rec of pending.values()) {
      if (rec.frameKey === frame && rec.op === op && rec.sig === sig) return rec.promise;
    }
    const rid = ridNext();
    let rec = null;
    const p = new Promise((resolve) => {
      rec = { rid, op, sig, resolve, promise: null, timer: null, attempts: 0, at: now(), frameKey: frame };
      pending.set(rid, rec);
      const attempt = () => {
        rec.attempts++;
        let sent = false;
        try { sent = post(frame, Object.assign({ type: op, rid }, payload && typeof payload === 'object' ? payload : {})) !== false; } catch (e) { sent = false; }
        note({ at: now(), rid, op, kind: sent ? 'sent' : 'post-failed', attempts: rec.attempts });
        rec.timer = setT(() => {
          if (!pending.has(rid)) return;
          if (rec.attempts <= RETRY_CAP) {
            ledger.retries++;
            attempt();                                    // 同 rid 重发（渲染器同 rid 幂等 ⇒ 不会重复副作用）
          } else {
            pending.delete(rid);
            ledger.pending = pending.size;
            ledger.timeouts++;
            ledger.fail++;
            note({ at: now(), rid, op, kind: 'timeout-exhausted', attempts: rec.attempts });
            try { resolve({ type: propsCompatResultTypeOf(op), rid, ok: false, why: 'timeout-exhausted' }); } catch (e) { /* 不抛 */ }
          }
        }, O.timeoutMs || TIMEOUT_MS);
      };
      attempt();
    });
    rec.promise = p;
    ledger.n++;
    ledger.pending = pending.size;
    return p;
  }

  /** 测试钩子：在途表快照（rid → attempts）。 */
  const snapshot = () => {
    const out = {};
    for (const [rid, rec] of pending) out[rid] = { op: rec.op, attempts: rec.attempts, sig: rec.sig };
    return out;
  };
  return { call, onResult, ledger, snapshot, TIMEOUT_MS, RETRY_CAP };
}

/**
 * 渲染器 describe 的 model → 插件面板行模型（与本地 `mpwPropsModel` 的行形状对齐）：
 *   {kind:'group'|'control'|'note'|'readonly', key, label, type, value, defValue, edited, min/max/step,
 *    options:[{label,value}], group, childCount, kindWhy}
 * `propEdits` = 当前壁纸的用户改动（显示值优先级：propEdits > renderer 当前值；edited 标记按 propEdits）。
 * 渲染器侧已经做过四类跳过（html/editor/unimpl/dead）⇒ 这里**不再复刻跳过语义**，只做形状对齐。
 */
export function rowsFromCompatModel(model, propEdits) {
  const items = (model && Array.isArray(model.items)) ? model.items : [];
  const edits = (propEdits && typeof propEdits === 'object') ? propEdits : {};
  const rows = [];
  let lastGroup = null;
  for (const it of items) {
    if (!it || !it.key) continue;
    if (it.isGroup) {
      rows.push({ kind: 'group', key: it.key, label: it.label || it.key, childCount: 0 });
      lastGroup = it.key;
      continue;
    }
    if (it.visible === false) continue;                       // 渲染器 condition 收口 ⇒ 不可见行不渲染
    const edited = Object.prototype.hasOwnProperty.call(edits, it.key);
    const type = String(it.type || '').toLowerCase();
    const base = {
      key: it.key, label: it.label || it.key, group: lastGroup,
      defValue: it.defValue, edited,
      value: edited ? edits[it.key] : (it.value !== undefined ? it.value : it.defValue),
    };
    if (type === 'bool') { rows.push(Object.assign(base, { kind: 'control', type: 'bool' })); continue; }
    if (type === 'slider') {
      rows.push(Object.assign(base, {
        kind: 'control', type: 'slider',
        min: typeof it.min === 'number' ? it.min : 0, max: typeof it.max === 'number' ? it.max : 1,
        step: typeof it.step === 'number' && it.step > 0 ? it.step : undefined,
      }));
      continue;
    }
    if (type === 'combo') {
      rows.push(Object.assign(base, { kind: 'control', type: 'combo', options: (it.options || []).slice() }));
      continue;
    }
    if (type === 'color') { rows.push(Object.assign(base, { kind: 'control', type: 'color', hex: it.hex })); continue; }
    if (type === 'text' || type === 'txt') { rows.push(Object.assign(base, { kind: 'control', type: 'textinput' })); continue; }
    // 分组标题以外的无控件条目（官方 HTML 文案行）⇒ 静态说明行
    rows.push(Object.assign(base, { kind: 'note' }));
  }
  // childCount 补齐（分组头显示用）
  for (const r of rows) {
    if (r.kind === 'group') r.childCount = rows.filter((x) => x.group === r.key).length;
  }
  return rows;
}

/** 切换壁纸是否需要弹「保留/清除」询问：旧壁纸（key）在 propEdits 里有**非空**改动、且目标壁纸不是它自己。 */
export function needsPropsSwitchAsk(propEdits, curKey, nextKey) {
  try {
    if (!curKey || curKey === nextKey) return false;
    const cur = (propEdits && propEdits[curKey]) || null;
    if (!cur || typeof cur !== 'object') return false;
    return Object.keys(cur).length > 0;
  } catch (e) { return false; }
}

/** 清理自证三件套（任务单 P4）：三项全过才算"恢复默认完成"。返回 {pass, checks[]}。 */
export function verifyPropsResetDone({ receipt, propEditsAfter, key, values, model }) {
  const checks = [];
  const noLocalEdit = !propEditsAfter || !propEditsAfter[key] || Object.keys(propEditsAfter[key]).length === 0;
  checks.push({ id: 'propEdits-cleared', ok: noLocalEdit });
  const receiptOk = !!(receipt && receipt.ok === true);
  checks.push({ id: 'receipt-ok', ok: receiptOk });
  let valuesDefault = null;
  try {
    const defaults = {};
    for (const it of ((model && model.items) || [])) if (it && it.key && it.defValue !== undefined) defaults[it.key] = it.defValue;
    valuesDefault = true;
    const vals = values || {};
    for (const k of Object.keys(defaults)) {
      if (JSON.stringify(vals[k]) !== JSON.stringify(defaults[k])) { valuesDefault = false; break; }
    }
  } catch (e) { valuesDefault = false; }
  checks.push({ id: 'values-eq-default', ok: valuesDefault === true });
  return { pass: checks.every((c) => c.ok), checks };
}
