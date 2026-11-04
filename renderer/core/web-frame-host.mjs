/* web 壁纸的**宿主契约**（纯函数，无 DOM / 无网络）—— 2026-09-23 第 ⑥ 条按 docs/WEB-WALLPAPER-MERGE.md §3 实现。
 *
 * 为什么单独一个模块：本仓渲染器页此前**没有** web 路径（`demo.html` 里 `/web/` 命中 0 次），而 web 壁纸的
 * 每一个"档位"决定（同源还是沙箱、原始 URL 还是 blob、超时要不要降档、失败怎么如实说）都必须能被
 * **逐值对拍**，不能散在 DOM 接线里。这里只回答"该怎么起"，不碰 iframe。
 *
 * 参照来源：本仓自己的 MIT 插件 `dsh-mpkg-wallpaper/lib/web-wallpaper.js`（三档表 `:104-170`、
 * auto 降档 `lib/client.js:4800-4840`）与上游 `oneincase/webwallgl`（MIT）的 `renderer/src/web.ts`
 * （同源入口必须用原始 URL、`webCoverViewport` 的"露底才换视口"）。两侧都只借**协议形状**，
 * 实现与命名各自写；许可与出处见 `docs/COPYING-RULES.md` §2.1 / `THIRD-PARTY.md`。
 *
 * 三条硬规则（越权面就在这三条上，改任何一条都要先想清楚）：
 *   ① **同源入口绝不用 blob**：blob 文档的 `origin` 是 `null`，Spine/WebGL 类作者拿相对 `<base>` 取贴图
 *      会变成跨域 ⇒ `texImage2D` 失败（上游 `web.ts:906-921` 的注释就是这条的现场记录）。
 *   ② **被宿主嵌入时绝不自动升到 compat**：那时渲染器页与 DSH 界面同源，作者脚本拿到同源权限就越权。
 *   ③ **显式档位永不自动换档**：用户/宿主说了 `compat` 或 `sandbox`，我们不许"自己觉得不行就换"。
 */

/** 三档：`auto` 由上下文解析，另两档是显式档。未知值一律回落 `auto` 并留痕（见 `normalizeWebFrameMode`）。 */
export const WEB_FRAME_MODES = ['auto', 'compat', 'sandbox'];
/** shim 未报到时的自动降档预算（与插件客户端同值：2.5s）。 */
export const WEB_SHIM_READY_TIMEOUT_MS = 2500;
/** 入口 HTML 超过这个字节数就不注入（上游/插件的既有上限，避免把大文档再复制一份）。 */
export const WEB_INJECT_MAX_BYTES = 8 * 1024 * 1024;

const str = (v) => (typeof v === 'string' ? v : '');

/**
 * 档位归一：已知档原样；空/垃圾 ⇒ `auto`（并让调用方知道回落过）。
 * @param {unknown} raw `?webframe=` 的原值
 * @returns {{mode:'compat'|'sandbox'|'auto', explicit:boolean, fellBack:boolean, raw?:string}}
 */
export function normalizeWebFrameMode(raw) {
  const s = str(raw).trim().toLowerCase();
  if (s === 'compat' || s === 'sandbox') return { mode: s, explicit: true, fellBack: false };
  if (s === '' || s === 'auto') return { mode: 'auto', explicit: false, fellBack: false };
  return { mode: 'auto', explicit: false, fellBack: true, raw: str(raw) };
}

/**
 * `auto` 的解析（docs §3.3 的第 1/2 条；第 3 条的**降档**在 `webShimDowngradePlan` 里，不在这里）。
 * @param {string} raw `?webframe=` 的原值
 * @param {{sameOriginService?:boolean, embed?:boolean}} ctx
 *   `sameOriginService` = 入口由**本服务**提供且路径在 `/web/**`（同源、可服务端注入）
 *   `embed` = 渲染器页自己被宿主嵌着（`demo.html` 的 `embedMode()`）
 * @returns {{mode:'compat'|'sandbox', explicit:boolean, why:string, fellBack:boolean}}
 */
export function resolveWebFrameMode(raw, ctx = {}) {
  const n = normalizeWebFrameMode(raw);
  const sameOrigin = !!ctx.sameOriginService;
  const embed = !!ctx.embed;
  if (n.explicit) {
    /* ① 类型层收窄（`strict:false` 下 TS 不会从 `explicit` 反推 `mode` 的联合类型）：
       `explicit === true` 只可能来自 `normalizeWebFrameMode` 的 compat/sandbox 分支
       ⇒ 这里显式收窄，**行为逐位不变**（'auto' 在这条分支上不可达）。 */
    const explicitMode = n.mode === 'sandbox' ? 'sandbox' : 'compat'
    return {
      mode: explicitMode,
      explicit: true,
      fellBack: false,
      why: 'explicit:' + explicitMode + (explicitMode === 'compat' && !sameOrigin ? '（调用方显式要求，非同源入口也照办）' : ''),
    };
  }
  // ① 本服务提供 + 没被宿主嵌入 ⇒ compat（原生指针/焦点，Spine/WebGL 类贴图可用）
  if (sameOrigin && !embed) return { mode: 'compat', explicit: false, fellBack: false, why: 'auto:same-origin-not-embedded' };
  // ② 其余一切（被嵌入 / 非同源）⇒ sandbox
  return {
    mode: 'sandbox',
    explicit: false,
    fellBack: n.fellBack,
    why: embed ? 'auto:embedded-host（同源即越权面）' : 'auto:cross-origin',
  };
}

/**
 * iframe 的 `sandbox` 属性值。**只有这两个合法值**：多给一个 `allow-*` 都是新的越权面
 * （`allow-pointer-lock` 合成事件用不到；`allow-popups/forms/modals/downloads/top-navigation/storage-access`
 * 一律不给 —— 回归里逐项断言）。
 */
export function webFrameSandboxAttr(mode) {
  return mode === 'compat' ? 'allow-scripts allow-same-origin' : 'allow-scripts';
}

/** 帧容器该用的 CSS 盒（web 壁纸**没有内在尺寸**，默认 100%×100%；cover 得由调用方显式要求）。 */
export function webFrameBox(fit) {
  const f = str(fit).trim().toLowerCase();
  if (f === 'cover' || f === 'contain' || f === 'stretch' || f === 'legacy') return { fit: f, full: true };
  return { fit: 'auto', full: true };
}

/**
 * 入口规划：**同源原样、跨源默认也原样**（如实报"宿主未注入 shim"），只有显式 `?webshim=blob` 才走
 * "fetch → 注入 → blob"。返回 `kind` 而不是直接给 URL，是因为 blob 那条要异步 fetch（DOM 层做）。
 * @param {string} entryUrl
 * @param {{sameOrigin?:boolean, blobOptIn?:boolean, entryIsHtml?:boolean}} ctx
 */
export function webEntryPlan(entryUrl, ctx = {}) {
  const url = str(entryUrl).trim();
  if (!url) return { kind: 'none', url: '', sameOrigin: false, injectable: false, why: 'entry-missing' };
  const sameOrigin = !!ctx.sameOrigin;
  if (sameOrigin) {
    return { kind: 'raw', url, sameOrigin: true, injectable: true, why: 'same-origin:raw（blob 会让 origin=null ⇒ 相对贴图跨域）' };
  }
  if (ctx.blobOptIn) {
    return { kind: 'blob', url, sameOrigin: false, injectable: true, why: 'cross-origin+webshim=blob（上游记录过贴图风险）' };
  }
  return { kind: 'raw', url, sameOrigin: false, injectable: false, why: 'cross-origin:raw（宿主未注入 shim ⇒ 作者拿不到 WE API，如实写）' };
}

/**
 * §3.3 第 3 条：起手 sandbox 且 2.5s 没等到 `ready` ⇒ **仅非嵌入 + 非显式**时一次性降 compat。
 * 入参**全可选**：本函数就是给"状态还没凑齐"的调用方用的（缺字段走保守分支），
 * JSDoc 如实描述这一点，不要写成必填（`s = {}` 的默认值就是证据）。
 * @param {{mode?:string, explicit?:boolean, embed?:boolean, ready?:boolean, elapsedMs?:number, timeoutMs?:number, alreadyDowngraded?:boolean}} [s]
 */
export function webShimDowngradePlan(s = {}) {
  const timeout = Number.isFinite(Number(s.timeoutMs)) ? Number(s.timeoutMs) : WEB_SHIM_READY_TIMEOUT_MS;
  const elapsed = Number.isFinite(Number(s.elapsedMs)) ? Number(s.elapsedMs) : 0;
  if (s.mode !== 'sandbox') return { mode: s.mode || 'compat', changed: false, why: 'not-sandbox' };
  if (s.ready) return { mode: 'sandbox', changed: false, why: 'ready' };
  if (s.explicit) return { mode: 'sandbox', changed: false, why: 'explicit:never-auto-switch' };
  if (s.embed) return { mode: 'sandbox', changed: false, why: 'embedded:never-downgrade（同源即越权面，需要就手动 ?webframe=compat）' };
  if (s.alreadyDowngraded) return { mode: 'sandbox', changed: false, why: 'already-downgraded-once' };
  if (elapsed < timeout) return { mode: 'sandbox', changed: false, why: 'waiting' };
  return { mode: 'compat', changed: true, why: 'shim-missing:' + timeout + 'ms' };
}

/**
 * 状态面：把内部状态翻译成**一句如实的话**（界面/日志同源）。`level` = 'ok' | 'warn' | 'error'。
 * 失败态清单见 docs §3.9；这里只做翻译，不做判定（判定在各自的调用点，避免"两处各判一半"）。
 */
export function webFrameStatus(input = {}) {
  const mode = str(input.mode) || 'sandbox';
  const st = str(input.state);
  const t = (ok, warn, err) => ({ state: st, mode, level: ok ? 'ok' : (warn ? 'warn' : 'error') });
  switch (st) {
    case 'entry-missing':
      return Object.assign(t(false, false, true), { line: '缺少 web 入口 URL（`?type=web` 需要 `?src=`）—— 不假装有画面' });
    case 'entry-not-html':
      return Object.assign(t(false, false, true), { line: '入口响应不是 HTML —— 已退回裸 src（作者语义按浏览器默认走）' });
    case 'entry-fetch-failed':
      return Object.assign(t(false, true, false), { line: '入口取回失败（' + str(input.detail || '网络/跨源') + '）—— 已退回裸 src' });
    case 'csp-blocked':
      return Object.assign(t(false, true, false), { line: '入口自带阻塞性 CSP：shim 未注入（x-mpw-shim-skipped: csp）⇒ 作者拿不到 WE API；2.5s 兜底照旧' });
    case 'cross-origin-no-shim':
      return Object.assign(t(false, true, false), { line: '跨源入口且宿主未注入 shim：作者脚本拿不到 WE API（如实说，不假装成功）' });
    case 'shim-missing':
      return Object.assign(t(false, true, false), { line: '同源入口 2.5s 未收到 WE API ready：' + (input.downgraded ? '已一次性降 compat 重载' : '保持当前档（嵌入/显式档不自动换）') });
    case 'author-error':
      return Object.assign(t(false, true, false), { line: '作者脚本报错（已兜住，不改壁纸状态）：' + str(input.detail || '').slice(0, 120) });
    case 'webframe-unsupported':
      return Object.assign(t(false, true, false), { line: '未知 `webframe` 档位「' + str(input.raw || '') + '」已回落缺省档' });
    case 'no-frame-pixels':
      return Object.assign(t(false, true, false), { line: '不透明源读不到帧内像素：「露底检测/自动换视口」在 sandbox 档不可用' });
    default:
      return Object.assign(t(true, false, false), { line: 'web 帧已挂载（' + mode + '）：' + str(input.detail || 'shim 已报到') });
  }
}

/* ── `?framefit`：web 帧的"露底才换视口"（docs §3.2）───────────────────────────────────────────────
 * 为什么**不默认 cover**：web 壁纸没有内在尺寸（`contentAspectOf` 只认内在尺寸，量不到就返回 null），
 * 拿舞台比例当内容比例就是自欺。所以默认 100%×100%，只有**量到"露底"**（文档比视口小 ⇒ 边上留白）才动。
 * 为什么只在 compat 档：不透明源读不到帧内 `scrollWidth/Height` ⇒ sandbox 档**不做检测**，
 * 并在日志/状态里如实写"露底检测不可用"，而不是假装做过。 */
export const WEB_FIT_EPS = 0.02;

/**
 * @param {{mode?:string, fit?:string, docW?:number, docH?:number, boxW?:number, boxH?:number}} s
 * @returns {{apply:boolean, why:string, scale:number, docW:number, docH:number, boxW:number, boxH:number}}
 */
export function webFitPlan(s = {}) {
  const fit = str(s.fit).trim().toLowerCase();
  const mode = str(s.mode).trim().toLowerCase() || 'sandbox';
  const docW = Number(s.docW), docH = Number(s.docH);
  const boxW = Number(s.boxW), boxH = Number(s.boxH);
  const out = { apply: false, why: '', scale: 1, docW: Number.isFinite(docW) ? docW : 0, docH: Number.isFinite(docH) ? docH : 0, boxW: Number.isFinite(boxW) ? boxW : 0, boxH: Number.isFinite(boxH) ? boxH : 0 };
  if (fit === 'legacy' || fit === 'off' || fit === '0' || fit === 'no' || fit === 'false') return Object.assign(out, { why: 'off' });
  if ((fit === '' || fit === 'auto') && mode === 'sandbox') return Object.assign(out, { why: 'sandbox-no-pixels' });
  if (!(out.docW > 0) || !(out.docH > 0) || !(out.boxW > 0) || !(out.boxH > 0)) return Object.assign(out, { why: 'no-measure' });
  const docAspect = out.docW / out.docH;
  const boxAspect = out.boxW / out.boxH;
  /* 容差内视为"已贴合"：不做任何事（躲开滚动条/取整带来的假露底）。 */
  if (Math.abs(docAspect - boxAspect) <= WEB_FIT_EPS * boxAspect) return Object.assign(out, { why: 'no-bars' });
  /* 覆盖式：把帧整体放大到"内容铺满视口"，居中裁掉溢出的一边（不动内容自身排版 ⇒ 1 CSS px 仍是 1 px）。 */
  const scale = Math.max(out.boxW / out.docW, out.boxH / out.docH);
  if (!Number.isFinite(scale) || scale <= 1) return Object.assign(out, { why: 'no-bars' });
  return Object.assign(out, { apply: true, why: 'bars-detected', scale: +scale.toFixed(4) });
}
