/* renderer-adapter.mjs —— 通用「渲染器适配器」契约 + 注册表 + 选择开关 + 生命周期（P-350）。
 *
 * 为什么要有它（用户原话）：「把渲染器仓库中的上游渲染器移除，然后留一个**可扩展的接口**，
 * 可以接入其他渲染器（**包括上游的**）」⇒ 本模块就是那个接口的**唯一契约**：
 *   · **本仓渲染器**在仓内提供一个适配器实现（`createRepoRendererAdapter`）；
 *   · **上游 / 第三方**渲染器通过**外部**来源接入（URL / 路径 / 包名，`normalizeRendererSource`），
 *     **不要求**仓库内置任何一份上游产物（`demo/assets/renderer-*.js` 现在是 **0 份**，判据钉住）。
 *
 * 契约（`RENDERER_ADAPTER_CONTRACT` = `mpw-renderer-adapter@1`）分两层：
 *   ① **适配器描述子**（注册进注册表的那个对象）：
 *        id / contract / label / kind / capabilities / probe(ctx) / create(options)
 *        `probe()` 回答"这一档现在能不能用" —— **不能就说不能**（`{available:false, reason}`），
 *        调用方据此**明确 SKIP**（不是崩、也不是静默通过）。`create()` 只在 probe 通过后才被调用。
 *   ② **实例**（`create()` 的返回值，`RENDERER_ADAPTER_METHODS` 七件套）：
 *        init(容器, 选项) / loadScene(来源) / frame(t) / pointer(x,y) / resize(w,h) /
 *        visibility(visible) / dispose()
 *        这些是**渲染器侧面**的方法，宿主不必知道里面是 canvas、iframe 还是别的；
 *        生命周期顺序由 `runRendererLifecycle()` 统一驱动并**逐条留痕**（越序即明确报错）。
 *
 * 零依赖、零顶层 IO / DOM（Node 直接 import 即可测）——这是本仓 `core/*.mjs` 的既有纪律
 * （同 `web-frame-host.mjs` / `we-web-shim.mjs`）。浏览器侧的 DOM 落地在
 * `demo/renderer/adapter-boot.mjs`（iframe 装载、导航、SKIP 面板），本模块只管"该挂哪一档、能不能挂"。
 *
 * ⚠ 与测试台的关系（**不重复实现**）：`demo/bench-patch.js` 的 `rendererSourceUrl()` 仍是测试台
 *   工具条两档（上游产物 / 本仓渲染器）**自己那条**改写链的**真源**（含 res / shell / parallax /
 *   audio 等档位），本模块**不复制**它。本模块里的 `repoTargetUrl()` 只是一座**窄桥**：
 *   把"产物页形状"的查询串（`?type=scene&src=<itemId>`）映射成本仓渲染器页认的形状（补 `id=`），
 *   只增不删（保住往返改写，教训见 `docs/PATCHES.md` P-228c）。
 */

/** 契约版本。适配器必须逐字声明同一个值，否则注册被拒（`validateRendererAdapter`）。 */
export const RENDERER_ADAPTER_CONTRACT = 'mpw-renderer-adapter@1';

/** 实例七件套（缺一个都不是合格适配器）。 */
export const RENDERER_ADAPTER_METHODS = ['init', 'loadScene', 'frame', 'pointer', 'resize', 'visibility', 'dispose'];

/** 适配器描述子的必填元数据。 */
export const RENDERER_ADAPTER_META = ['id', 'contract', 'label', 'kind', 'capabilities', 'probe', 'create'];

/** 两类来源：`repo` = 仓内自带的渲染器；`external` = 仓外（上游 / 第三方），本仓不内置。 */
export const RENDERER_ADAPTER_KINDS = ['repo', 'external'];

/** 本仓渲染器适配器 id（缺省档）。 */
export const REPO_RENDERER_ID = 'repo';
/** 外部（上游 / 第三方）渲染器适配器 id。 */
export const EXTERNAL_RENDERER_ID = 'upstream-external';

/** 选择开关的缺省值：`auto` = 按"配了外部来源 / 是否被宿主嵌入 / 是否顶层打开"自动定档。 */
export const RENDERER_SELECTION_DEFAULT = 'auto';

/** 解析结果的动作三态。 */
export const RENDERER_ACTION = Object.freeze({ MOUNT: 'mount', NAVIGATE: 'navigate', SKIP: 'skip' });

/** 能力声明的**规范键集**：只声明"这个渲染器能做什么"，不写评价词、不写差异文案。 */
export const RENDERER_CAPABILITY_KEYS = [
  'scenePkg',           // 能加载 scene.pkg / scenes/scene.pkg / gifscene.pkg
  'mpkg',               // 能加载 .mpkg 容器
  'webWallpaper',       // 能渲染 web 壁纸（index.html 类）
  'videoWallpaper',     // 能渲染视频壁纸
  'liveCanvasSize',     // 画布尺寸是"活档位"（显示尺寸 × DPR，有上限）
  'layerHide',          // 逐层隐藏 / 强制显示（本仓的 __lnHidden / __lnShown 约定）
  'pointerPush',        // 宿主可推指针坐标（__wp.pushPointer）
  'audioBands',         // 回报音条数据源（__mpwAudioBandInfo）
  'packageAudio',       // 包内音轨（?audio=1 的 sound 层）
  'propertyPanel',      // 属性面板（project.json general.properties + 覆盖）
  'transparentContext', // 透明背景（alpha:true）
  'selfDrivenFrame',    // 自带帧循环（宿主调 frame(t) 是空操作，不必喂帧）
];
/** 合法取值：`true` / `false` / `'degraded'`（能，但有明确降级）/ `'unknown'`（不知道就说不知道）。 */
export const RENDERER_CAPABILITY_VALUES = [true, false, 'degraded', 'unknown'];

/** 外部来源的种类：`url`（http(s)/blob/data）、`path`（相对或绝对路径）、`package`（npm:/pkg: 包名）。 */
export const RENDERER_SOURCE_KINDS = ['none', 'url', 'path', 'package'];

/** 生命周期阶段名（`runRendererLifecycle` 的 trace 里逐条出现）。 */
export const RENDERER_LIFECYCLE_PHASES = ['init', 'loadScene', 'frame', 'pointer', 'resize', 'visibility', 'dispose'];

/* ── 本仓渲染器页的候选落点。按顺序运行时探测（首个 2xx 胜出）——
 * 为什么两个都要：`:8902` 自己直供 `/webloader/**`（`rendererRequestHandler`），
 * 而 GitHub Pages（`build-pages.mjs`）**没有**这条路由，产物根上的是 `demo.html`
 *  ⇒ 相对写法 `../../demo.html` 在 `/WEwebLoader/renderer/`、`/demo/renderer/`、
 *  `/wallpaper-engine-webgl/renderer/` 三种布局下都解析到站点根的 `demo.html`。
 * 探测失败 ⇒ **明确 SKIP**（写明探测过的候选与各自的状态码），不猜、不蒙一个。 */
export const REPO_RENDERER_PAGE_CANDIDATES = ['/webloader/', '../../demo.html'];

/* ── 本仓渲染器的能力声明。
 * 口径来源（都是本仓既有判据/代码，不复制文案）：`demo.html` 的 scene/web/video 三档与 `?res=dpr`
 * 活档位（P-171）、`__lnHidden`/`__lnShown` 逐层隐藏（P-240）、`__wp.pushPointer`（P-136）、
 * `__mpwAudioBandInfo`（音条）、`?audio=1` 包内音轨（P-228f）、`/api/props` 属性面板（P-2-2）。
 * **没证据的一律 `'unknown'`**（"不知道就说不知道"，见 docs/COPYING-RULES.md 的如实口径）。 */
export const REPO_RENDERER_CAPABILITIES = Object.freeze({
  scenePkg: true,
  mpkg: true,
  webWallpaper: true,
  videoWallpaper: true,
  liveCanvasSize: true,
  layerHide: true,
  pointerPush: true,
  audioBands: true,
  packageAudio: true,
  propertyPanel: true,
  transparentContext: true,
  selfDrivenFrame: true,
});

/* ── 外部渲染器的能力声明：**全 unknown**。
 * 外部是谁、支持什么，本模块**不可能知道** ⇒ 声明成 `true` 就是编读数。
 * 宿主拿到声明后可以自己探测（`probe`）并回填。 */
export const EXTERNAL_RENDERER_CAPABILITIES = Object.freeze(
  Object.fromEntries(RENDERER_CAPABILITY_KEYS.map((k) => [k, 'unknown'])),
);

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const isFn = (v) => typeof v === 'function';

/* ═══════════════════════════ ① 归一与校验 ═══════════════════════════ */

/**
 * 能力声明归一：**规范键全集**，缺的补 `'unknown'`（不补 `false` —— 那会把"没声明"读成"做不到"）。
 * @param {object} raw
 * @returns {Record<string, true|false|'degraded'|'unknown'>}
 */
export function normalizeCapabilities(raw) {
  const out = {};
  for (const k of RENDERER_CAPABILITY_KEYS) out[k] = 'unknown';
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(raw)) {
      if (RENDERER_CAPABILITY_KEYS.indexOf(k) < 0) continue;
      if (RENDERER_CAPABILITY_VALUES.indexOf(raw[k]) < 0) continue;
      out[k] = raw[k];
    }
  }
  return out;
}

/** 能力声明的**问题清单**（未知键 / 非法取值）——注册时据此拒绝，不静默吞。 */
export function capabilityIssues(raw) {
  const unknownKeys = [];
  const badValues = [];
  if (!raw || typeof raw !== 'object') return { unknownKeys, badValues, shape: 'not-an-object' };
  for (const k of Object.keys(raw)) {
    if (RENDERER_CAPABILITY_KEYS.indexOf(k) < 0) { unknownKeys.push(k); continue; }
    if (RENDERER_CAPABILITY_VALUES.indexOf(raw[k]) < 0) badValues.push(k + '=' + str(raw[k]));
  }
  return { unknownKeys, badValues, shape: 'ok' };
}

/** 两档能力对账（差异 = 明确的可观测面，不是文案）。 */
export function capabilityDiff(a, b) {
  const A = normalizeCapabilities(a);
  const B = normalizeCapabilities(b);
  const same = [];
  const diff = [];
  for (const k of RENDERER_CAPABILITY_KEYS) {
    if (A[k] === B[k]) same.push(k); else diff.push({ key: k, a: A[k], b: B[k] });
  }
  return { same, diff };
}

/**
 * 校验适配器描述子。
 * @returns {{ok:boolean, errors:Array<{code:string, detail?:string}>}}
 */
export function validateRendererAdapter(a) {
  const errors = [];
  if (!a || typeof a !== 'object') return { ok: false, errors: [{ code: 'not-an-object' }] };
  if (!str(a.id).trim()) errors.push({ code: 'missing-id' });
  if (!str(a.contract).trim()) errors.push({ code: 'missing-contract' });
  else if (str(a.contract) !== RENDERER_ADAPTER_CONTRACT) errors.push({ code: 'contract-mismatch', detail: str(a.contract) });
  if (!str(a.label).trim()) errors.push({ code: 'missing-label' });
  if (RENDERER_ADAPTER_KINDS.indexOf(str(a.kind)) < 0) errors.push({ code: 'bad-kind', detail: str(a.kind) });
  if (typeof a.probe !== 'function') errors.push({ code: 'missing-probe' });
  if (typeof a.create !== 'function') errors.push({ code: 'missing-create' });
  if (!a.capabilities || typeof a.capabilities !== 'object') errors.push({ code: 'missing-capabilities' });
  else {
    const iss = capabilityIssues(a.capabilities);
    if (iss.shape !== 'ok') errors.push({ code: 'bad-capabilities', detail: iss.shape });
    if (iss.unknownKeys.length) errors.push({ code: 'unknown-capability-key', detail: iss.unknownKeys.join(',') });
    if (iss.badValues.length) errors.push({ code: 'bad-capability-value', detail: iss.badValues.join(',') });
  }
  return { ok: errors.length === 0, errors };
}

/** 校验实例七件套。 */
export function validateRendererInstance(inst) {
  const missing = RENDERER_ADAPTER_METHODS.filter((m) => !inst || typeof inst[m] !== 'function');
  return { ok: missing.length === 0, missing };
}

/**
 * 归一"渲染器来源"（**外部接入**的入口）：URL / 路径 / 包名三种。
 * @param {unknown} spec
 * @param {{base?:string}} [ctx] `base` = 解析相对路径用的基准（浏览器里通常给 `location.href`）
 * @returns {{kind:'none'|'url'|'path'|'package', value:string, url:string, why:string}}
 */
export function normalizeRendererSource(spec, ctx = {}) {
  const raw = str(spec).trim();
  if (!raw) return { kind: 'none', value: '', url: '', why: 'empty' };
  if (/^(https?|blob|data):/i.test(raw)) return { kind: 'url', value: raw, url: raw, why: 'absolute-url' };
  /* 包名来源：本模块**不解析包名**（那是宿主的解析器职责：npm / 插件 / 本地包目录都行）
     ⇒ 如实标成 kind='package'，`url` 留空，由适配器的 probe 明确说"需要宿主解析器"（SKIP，不是崩）。 */
  if (/^(npm|pkg|package):/i.test(raw)) return { kind: 'package', value: raw, url: '', why: 'package-spec:needs-host-resolver' };
  const base = str(ctx.base).trim();
  if (base) {
    try {
      const baseIsFile = /^file:/i.test(base);
      if (!baseIsFile) return { kind: 'path', value: raw, url: new URL(raw, base).href, why: 'path:resolved-against-base' };
    } catch (e) { /* base 不合法 ⇒ 退回原样（下面那条） */ }
  }
  return { kind: 'path', value: raw, url: raw, why: 'path:raw' };
}

/** 档位名归一：把用户口语（`upstream` / `external` / `local` / `self`）收敛到注册表 id。 */
export function normalizeRendererId(raw) {
  const v = str(raw).trim().toLowerCase();
  if (!v) return '';
  if (v === 'repo' || v === 'local' || v === 'self' || v === 'builtin' || v === 'webloader') return REPO_RENDERER_ID;
  if (v === 'upstream' || v === 'external' || v === 'third-party' || v === 'thirdparty' || v === 'custom') return EXTERNAL_RENDERER_ID;
  return v;
}

/**
 * 从本页 URL 里读选择开关（`?renderer=` = 选哪一档；`?rendererSrc=` = 外部来源）。
 * 手写解析而不是 `URLSearchParams`：本仓既有纪律（`demo.html` 的 `diag-flag-check` 会把
 * `URLSearchParams.get` 当成诊断开关抓取）——这里也只是"读自己的 URL"，不引额外语义。
 * @param {string} url
 */
export function parseRendererSelection(url) {
  const raw = str(url);
  const qAt = raw.indexOf('?');
  const hashAt = raw.indexOf('#');
  const head = qAt < 0 ? '' : (hashAt > qAt ? raw.slice(qAt + 1, hashAt) : raw.slice(qAt + 1));
  const get = (name) => {
    for (const part of head.split('&')) {
      if (!part) continue;
      const eq = part.indexOf('=');
      const k = (eq < 0 ? part : part.slice(0, eq)).toLowerCase();
      if (k !== name.toLowerCase()) continue;
      const v = eq < 0 ? '' : part.slice(eq + 1);
      try { return decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { return v; }
    }
    return null;
  };
  const renderer = str(get('renderer')).trim();
  const rendererSrc = str(get('rendererSrc') || get('renderersrc')).trim();
  return { renderer, rendererSrc, explicitRenderer: renderer !== '', explicitSource: rendererSrc !== '', query: head };
}

/* ═══════════════════════════ ② 注册表 ═══════════════════════════ */

/**
 * 注册表：可注册**多个**适配器，按 id 取用。
 * 重复 id / 不合契约 ⇒ **抛错**（"静默覆盖"会让选择开关指到谁是不确定的）。
 * @param {Array<object>} [initial]
 */
export function createRendererRegistry(initial = []) {
  const map = new Map();
  const api = {
    register(a) {
      const v = validateRendererAdapter(a);
      if (!v.ok) throw new Error('renderer-adapter:register 拒绝（' + v.errors.map((e) => e.code + (e.detail ? ':' + e.detail : '')).join(', ') + '）');
      if (map.has(a.id)) throw new Error('renderer-adapter:register 重复 id：' + a.id);
      map.set(a.id, a);
      return api;
    },
    unregister(id) { return map.delete(str(id)); },
    get(id) { return map.get(str(id)) || null; },
    has(id) { return map.has(str(id)); },
    ids() { return [...map.keys()]; },
    list() { return [...map.values()]; },
    size() { return map.size; },
    clear() { map.clear(); return api; },
  };
  for (const a of initial) api.register(a);
  return api;
}

/** 本模块的默认注册表（`refreshDefaultRendererRegistry()` 可重建为两档内置适配器）。 */
export const defaultRendererRegistry = createRendererRegistry();

/** 便捷函数：往默认注册表里加一档。 */
export function registerRendererAdapter(a) { return defaultRendererRegistry.register(a); }
/** 便捷函数：默认注册表里的全部适配器。 */
export function listRendererAdapters() { return defaultRendererRegistry.list(); }
/** 便捷函数：按 id 取一档。 */
export function getRendererAdapter(id) { return defaultRendererRegistry.get(id); }

/**
 * 两档**内置工厂**（`createRepoRendererAdapter` / `createExternalRendererAdapter`）的依赖：
 * 由宿主（浏览器 boot / 测试）注入"真的怎么挂"。
 * 两个工厂各自要一个**独立的**实例工厂（`createRepoInstance` / `createExternalInstance`）——
 * 一个 `createInstance` 喂给两档会让"外部档"和"本仓档"挂出同一个实例（谁是谁就说不清了）；
 * 默认注入 = 空实现 ⇒ 纯 Node 里也能建注册表并测选择开关。
 * @param {{createRepoInstance?:Function, createExternalInstance?:Function}} deps
 */
export function builtinRendererAdapters(deps = {}) {
  return [
    createRepoRendererAdapter(deps.createRepoInstance ? { createInstance: deps.createRepoInstance } : {}),
    createExternalRendererAdapter(deps.createExternalInstance ? { createInstance: deps.createExternalInstance } : {}),
  ];
}

/** 用两档内置适配器重建默认注册表（幂等；宿主启动时调一次）。 */
export function refreshDefaultRendererRegistry(deps = {}) {
  defaultRendererRegistry.clear();
  for (const a of builtinRendererAdapters(deps)) defaultRendererRegistry.register(a);
  return defaultRendererRegistry;
}

/* 模块加载期就把两档内置适配器放进**默认**注册表 —— 理由：默认注册表的消费者是
   `resolveRendererSelection()` / `rendererAdapterReport()`（服务端 `GET /api/renderers` 与判据），
   它们只做"枚举 + 判可用"，**从不调 `create()`**（实例工厂由宿主在自己的注册表里注入）。
   不预置的后果实测过：`/api/renderers` 回 `adapters: []` + `selection.id: ''`
   ——一个"看起来在跑、其实一档都没有"的空壳（比报错更难查）。
   `create()` 仍然由 `noInstanceFactory()` 兜底**明确抛错**：宿主忘了注入实例工厂时不会静默失败。 */
refreshDefaultRendererRegistry();

/* ═══════════════════════════ ③ 两档适配器 ═══════════════════════════ */

/** `create()` 没被注入时的兜底：**明确抛错**，不返回半个壳（"挂上了但什么都不动"比报错更难查）。 */
function noInstanceFactory(what) {
  return () => { throw new Error('renderer-adapter:' + what + ' 没有注入实例工厂（createInstance / createRepoInstance）'); };
}

/**
 * **本仓渲染器**适配器：目标 = 本仓渲染器页（`REPO_RENDERER_PAGE_CANDIDATES`）。
 * 仓内自带 ⇒ `probe()` 在配置层**永远可用**；真正的可达性由宿主对候选 URL 逐个探测
 * （`probePages()`，浏览器里 fetch / Node 里也能 fetch），探测不过 ⇒ **明确 SKIP**。
 * @param {{createInstance?:Function, pages?:string[], capabilities?:object}} [opts]
 */
export function createRepoRendererAdapter(opts = {}) {
  const pages = (Array.isArray(opts.pages) && opts.pages.length ? opts.pages : REPO_RENDERER_PAGE_CANDIDATES).map(str);
  const create = isFn(opts.createInstance) ? opts.createInstance : noInstanceFactory('repo');
  return {
    id: REPO_RENDERER_ID,
    contract: RENDERER_ADAPTER_CONTRACT,
    label: '本仓渲染器',
    kind: 'repo',
    capabilities: normalizeCapabilities(opts.capabilities || REPO_RENDERER_CAPABILITIES),
    pages,
    /** 仓内自带 ⇒ 配置层可用；`reason` 只在显式禁用时给出。 */
    probe(ctx = {}) {
      if (ctx && ctx.disabled === true) return { available: false, reason: 'repo-adapter-disabled', detail: '宿主显式禁用本仓档' };
      return { available: true, reason: '', detail: 'repo-renderer-in-tree' };
    },
    create,
  };
}

/**
 * **外部（上游 / 第三方）**渲染器适配器：来源必须是**外部**的 ——
 * `?rendererSrc=<URL|路径|npm:包名>`，或宿主配置（如 `MPW_RENDERER_UPSTREAM`）。
 * 没配来源 ⇒ `probe()` **明确不可用**（`external-source-not-configured`）⇒ 选择结果为 SKIP。
 * @param {{createInstance?:Function, source?:unknown, sourceFrom?:string, capabilities?:object, resolver?:Function}} [opts]
 */
export function createExternalRendererAdapter(opts = {}) {
  const create = isFn(opts.createInstance) ? opts.createInstance : noInstanceFactory('upstream-external');
  const baked = opts.source == null ? '' : opts.source;
  const bakedFrom = str(opts.sourceFrom) || (baked ? 'adapter-options' : '');
  return {
    id: EXTERNAL_RENDERER_ID,
    contract: RENDERER_ADAPTER_CONTRACT,
    label: '外部渲染器（上游 / 第三方）',
    kind: 'external',
    capabilities: normalizeCapabilities(opts.capabilities || EXTERNAL_RENDERER_CAPABILITIES),
    /**
     * @param {{source?:unknown, config?:object, env?:object, base?:string}} [ctx]
     */
    probe(ctx = {}) {
      const cfg = (ctx && ctx.config) || {};
      const env = (ctx && ctx.env) || {};
      const raw = [ctx && ctx.source, cfg.rendererSrc, env.MPW_RENDERER_UPSTREAM, env.MPW_RENDERER_8899, baked]
        .map(str).map((s) => s.trim()).find((s) => s !== '') || '';
      const from = raw === '' ? '' : (
        str(ctx && ctx.source) === raw ? 'url ?rendererSrc='
          : str(cfg.rendererSrc) === raw ? 'config.rendererSrc'
            : (str(env.MPW_RENDERER_UPSTREAM) === raw ? 'env MPW_RENDERER_UPSTREAM'
              : (str(env.MPW_RENDERER_8899) === raw ? 'env MPW_RENDERER_8899（旧名）' : bakedFrom || 'adapter-options')));
      if (!raw) {
        return {
          available: false,
          reason: 'external-source-not-configured',
          detail: '仓库内已不再内置上游渲染器产物；请用 ?rendererSrc=<URL|路径> 或 MPW_RENDERER_UPSTREAM=<URL> 指定外部来源',
          source: { kind: 'none', value: '', url: '', why: 'empty' },
          from: '',
        };
      }
      const src = normalizeRendererSource(raw, { base: ctx && ctx.base });
      if (src.kind === 'package') {
        return { available: false, reason: 'external-source-needs-resolver', detail: '包名来源（npm:/pkg:）需要宿主解析器；本模块不解析包名 ⇒ 明确 SKIP', source: src, from };
      }
      if (!src.url) return { available: false, reason: 'external-source-unresolved', detail: src.why, source: src, from };
      return { available: true, reason: '', detail: src.why, source: src, from };
    },
    create,
  };
}

/* ═══════════════════════════ ④ 选择开关 ═══════════════════════════ */

/** 探测本仓渲染器页候选（宿主注入 fetch；无 fetch 或全部失败 ⇒ 如实回报，不猜）。
 *  ⚠ **显式** `fetch:null` 就是"没有 fetch"（不许回落到全局 fetch）：判据要用它证
 *  "探测能力不可用时如实说不可用"，回落全局会把这条判据变成恒真。 */
export async function probeRepoPages(adapter, ctx = {}) {
  const hasOwn = Object.prototype.hasOwnProperty.call(ctx, 'fetch');
  const fetchImpl = hasOwn ? ctx.fetch : (typeof fetch === 'function' ? fetch : null);
  const base = str(ctx.base);
  const pages = (adapter && Array.isArray(adapter.pages) ? adapter.pages : REPO_RENDERER_PAGE_CANDIDATES).map(str);
  const tried = [];
  if (!fetchImpl) return { available: false, reason: 'repo-page-probe-unavailable', tried, detail: '宿主没有 fetch ⇒ 无法探测本仓渲染器页', url: '' };
  for (const p of pages) {
    let url = p;
    if (base) { try { url = new URL(p, base).href; } catch (e) { url = p; } }
    try {
      const res = await fetchImpl(url, { method: 'GET', credentials: 'same-origin' });
      tried.push({ page: p, url, status: res && res.status });
      if (res && res.ok) return { available: true, reason: '', tried, detail: 'repo-page-ok', url };
    } catch (e) {
      tried.push({ page: p, url, status: 0, error: (e && e.message) || str(e) });
    }
  }
  return { available: false, reason: 'repo-page-unreachable', tried, detail: '候选全不可达：' + tried.map((t) => t.url + '→' + t.status).join(' '), url: '' };
}

/**
 * 选择开关：把「本页 URL + 宿主配置 + 环境」解析成**一个动作**（mount / navigate / skip）。
 *
 * 定档规则（`auto`，全部可复核）：
 *   ① 显式 `?renderer=<id>` ⇒ 就用它；未知 id ⇒ **回落**并写明 `unknown-renderer-id`
 *   ② 配了外部来源（`?rendererSrc=` / config.rendererSrc / `MPW_RENDERER_UPSTREAM`）⇒ 外部档
 *   ③ 其余：**被宿主嵌入**（`embed:true`）⇒ 明确 SKIP（上游档必须有外部来源，缺就如实说没有）
 *   ④ 顶层直接打开 ⇒ 缺省**本仓档**
 * 为什么 ③ 不回落本仓档：被嵌入时调用方（例如测试台工具条的「上游产物」档）**点名**要的就是
 * 上游那一档；偷偷给它本仓渲染器 = 界面说一套、画面是另一套（本仓明令禁止的静默降级）。
 * 顶层直接打开没有"点名"这回事 ⇒ 给用户一个能看的画面（本仓档）才是对的。
 *
 * @param {{url?:string, config?:object, env?:object, embed?:boolean, registry?:object, base?:string}} [input]
 * @returns {{id:string, adapter:object|null, action:string, url:string, available:boolean, skipped:boolean,
 *            reason:string, detail:string, source:object, from:string, embed:boolean, explicit:boolean,
 *            fellBack:boolean, candidates:string[], notice:string, lang:string}}
 */
export function resolveRendererSelection(input = {}) {
  const registry = input.registry || defaultRendererRegistry;
  const parsed = parseRendererSelection(input.url || '');
  const config = input.config || {};
  const env = input.env || {};
  const embed = input.embed === true;
  const base = str(input.base);
  const lang = str(config.lang || input.lang) === 'en' ? 'en' : 'zh';

  const extAdapter = registry.get(EXTERNAL_RENDERER_ID);
  const repoAdapter = registry.get(REPO_RENDERER_ID);

  /* 外部来源：`?rendererSrc=` > config.rendererSrc > env —— 顺序写死在一处，别处不许再判。 */
  const extCtx = { source: parsed.rendererSrc || undefined, config, env, base };
  const extProbe = extAdapter ? safeProbe(extAdapter, extCtx) : { available: false, reason: 'no-external-adapter', detail: '', source: { kind: 'none', value: '', url: '', why: 'empty' }, from: '' };

  const want = str(parsed.renderer || config.renderer || '').trim() === '' ? '' : normalizeRendererId(parsed.renderer || config.renderer);
  let id = '';
  let fellBack = false;
  let fellBackReason = '';
  const explicit = want !== '';
  if (explicit) {
    if (registry.has(want)) id = want;
    else { fellBack = true; fellBackReason = 'unknown-renderer-id:' + want; }
  }
  if (!id) {
    if (extProbe.available) id = EXTERNAL_RENDERER_ID;
    /* 显式给了外部来源（`?rendererSrc=` / config）但它用不了 ⇒ **就用外部档并 SKIP**，
       绝不回落本仓档：调用方点名的是外部渲染器，偷偷换成自家的 = 静默降级（本仓明令禁止）。 */
    else if (parsed.explicitSource || str(config.rendererSrc).trim() !== '') id = EXTERNAL_RENDERER_ID;
    else if (embed) id = '';
    else id = registry.has(REPO_RENDERER_ID) ? REPO_RENDERER_ID : '';
  }

  const adapter = id ? registry.get(id) : null;
  const probe = adapter
    ? safeProbe(adapter, { config, env, source: parsed.rendererSrc || undefined, base, embed, url: input.url })
    : {
      available: false,
      detail: embed
        ? '本页被宿主嵌入（点名要"上游产物"那一档）且没有配外部来源 ⇒ 明确 SKIP，绝不偷偷回落本仓档'
        : '注册表里没有可用的渲染器适配器',
      reason: embed ? 'embedded-needs-external-source' : 'no-adapter-selected',
    };

  let action = RENDERER_ACTION.SKIP;
  let url = '';
  let reason = probe.available ? '' : probe.reason;
  let detail = probe.detail || '';
  if (adapter && probe.available) {
    /* 本仓档 ⇒ **容器内装载**（iframe）：保住本页身份、能挂提示带，也把契约七件套真的走一遍。
       外部档 ⇒ **导航**：与移除前逐字同义（被嵌入时 iframe 的 contentWindow **就是**外部渲染器本身，
       测试台对 `__wp` 的探测口径不用改）。 */
    if (adapter.kind === 'external') {
      action = RENDERER_ACTION.NAVIGATE;
      url = externalTargetUrl(probe.source, parsed.query);
    } else {
      action = RENDERER_ACTION.MOUNT;
      url = '';   // 目标在装载时按候选探测结果给（见 probeRepoPages）
    }
  } else if (!adapter) {
    reason = reason || 'no-adapter-selected';
  }

  const candidates = adapter && adapter.kind === 'repo' ? adapter.pages.slice() : [];
  const out = {
    id,
    adapter,
    adapterId: id,
    action,
    url,
    available: !!(adapter && probe.available),
    skipped: action === RENDERER_ACTION.SKIP,
    reason: action === RENDERER_ACTION.SKIP ? (reason || 'unavailable') : '',
    detail: action === RENDERER_ACTION.SKIP ? detail : (probe.detail || ''),
    source: probe.source || extProbe.source,
    from: probe.from || extProbe.from || '',
    embed,
    explicit,
    fellBack,
    fellBackReason,
    candidates,
    lang,
    notice: '',
    probeTried: probe.tried || null,
  };
  out.notice = rendererAdapterNotice(out);
  return out;
}

function safeProbe(adapter, ctx) {
  try {
    const r = adapter.probe(ctx || {});
    if (!r || typeof r !== 'object') return { available: false, reason: 'probe-returned-nothing', detail: '' };
    return r;
  } catch (e) {
    return { available: false, reason: 'probe-threw:' + ((e && e.message) || str(e)), detail: '' };
  }
}

/** 外部档的目标 URL：外部来源 + 本页原查询串（**原样带走**，与移除前的行为同义）。
 *  ⚠ 但**自己这两个控制参数必须摘掉**（`renderer` / `rendererSrc`）：
 *  它们是"本适配器层"的选择开关，转发给外部渲染器只会变成两个它不认识的未知参数
 *  （外部若是另一份产物页，那些参数会被它原样带进自己的挂载链 ⇒ 越传越脏）。 */
export function externalTargetUrl(source, query) {
  const src = source || { kind: 'none', url: '' };
  const base = str(src.url);
  if (!base) return '';
  const kept = str(query).split('&').filter((s) => {
    if (s === '') return false;
    const eq = s.indexOf('=');
    const k = (eq < 0 ? s : s.slice(0, eq)).toLowerCase();
    return k !== 'renderer' && k !== 'renderersrc';
  });
  if (!kept.length) return base;
  return base + (base.indexOf('?') >= 0 ? '&' : '?') + kept.join('&');
}

/**
 * 「产物页形状 ⇒ 本仓渲染器页形状」的**窄桥**：只做 `src→id` 的最小补齐（**只增不删**，保住往返改写）。
 * 测试台那条完整改写链（res / shell / parallax / audio…）仍归 `demo/bench-patch.js: rendererSourceUrl`，
 * 本函数**不复制**它，也不与它争真源。
 * @param {{page:string, query:string}} p
 */
export function repoTargetUrl(p) {
  const page = str(p && p.page) || REPO_RENDERER_PAGE_CANDIDATES[0];
  const query = str(p && p.query);
  const kept = query.split('&').filter((s) => s !== '');
  const get = (k) => {
    for (const s of kept) {
      const eq = s.indexOf('=');
      const key = (eq < 0 ? s : s.slice(0, eq)).toLowerCase();
      if (key !== k) continue;
      const v = eq < 0 ? '' : s.slice(eq + 1);
      try { return decodeURIComponent(v.replace(/\+/g, ' ')); } catch (e) { return v; }
    }
    return null;
  };
  const has = (k) => kept.some((s) => { const eq = s.indexOf('='); return (eq < 0 ? s : s.slice(0, eq)).toLowerCase() === k; });
  const upsert = (k, v) => {
    const i = kept.findIndex((s) => { const eq = s.indexOf('='); return (eq < 0 ? s : s.slice(0, eq)).toLowerCase() === k; });
    if (i >= 0) kept[i] = k + '=' + v; else kept.push(k + '=' + v);
  };
  const type = str(get('type') || 'scene').toLowerCase();
  const src = str(get('src'));
  let itemId = '';
  if (type === 'scene' && src && !/^[/\\]/.test(src) && src.indexOf('..') < 0 && !/^[a-z]+:\/\//i.test(src)) itemId = src;
  else {
    const m = /(?:^|\/)(?:media|web)\/dev\/([^/?#]+)/.exec(src);
    if (m) itemId = m[1];
  }
  if (itemId && !has('id')) upsert('id', encodeURIComponent(itemId));
  /* `shell=0` = 无外壳形态（藏掉顶栏/日志，只出画）。本档是**容器内装载**（iframe）⇒ 该给；
     显式给过就一个字符不动。 */
  if (!has('shell')) upsert('shell', '0');
  return page + (kept.length ? '?' + kept.join('&') : '');
}

/* ═══════════════════════════ ⑤ 生命周期 ═══════════════════════════ */

/**
 * 驱动一个适配器的完整生命周期，并**逐条留痕**。
 * 顺序纪律（越序 = 明确报错，不静默吞）：
 *   init 只能一次；loadScene 必须在 init 之后；frame/事件必须在 init 之后、dispose 之前；
 *   dispose 一定被调用（`finally`），且只能一次；dispose 之后任何调用都报错。
 * `probe()` 说不可用 ⇒ **不调 create**，返回 `{ok:false, skipped:true, reason}`（这就是"明确 SKIP"）。
 *
 * @param {object} adapter
 * @param {{probeCtx?:object, createOptions?:object, container?:unknown, options?:object,
 *          source?:unknown, frames?:number[], events?:Array<{type:string,args?:any[]}>,
 *          onTrace?:Function}} [plan]
 * `plan.keepAlive === true` ⇒ **不自动 dispose**（真实宿主装载后要留着实例；`ok` 判到 `loaded` 为止）。
 * @returns {Promise<{ok:boolean, skipped:boolean, reason:string, detail:string, trace:Array<object>,
 *          phases:string[], frames:number[], firstFrame:object|null, result:object|null, error:string}>}
 */
export async function runRendererLifecycle(adapter, plan = {}) {
  const trace = [];
  const phases = [];
  const note = (phase, extra) => { trace.push(Object.assign({ phase, i: trace.length }, extra || {})); phases.push(phase); };
  const v = validateRendererAdapter(adapter);
  if (!v.ok) {
    return { ok: false, skipped: false, reason: 'adapter-contract-invalid:' + v.errors.map((e) => e.code).join('+'), detail: JSON.stringify(v.errors), trace, phases, frames: [], firstFrame: null, result: null, error: 'adapter-contract-invalid' };
  }
  const probe = safeProbe(adapter, plan.probeCtx || {});
  if (!probe.available) {
    return { ok: false, skipped: true, reason: probe.reason || 'unavailable', detail: probe.detail || '', trace, phases, frames: [], firstFrame: null, result: null, error: '' };
  }

  let inst = null;
  try { inst = adapter.create(plan.createOptions || {}); } catch (e) {
    return { ok: false, skipped: false, reason: 'create-threw', detail: (e && e.message) || str(e), trace, phases, frames: [], firstFrame: null, result: null, error: 'create-threw' };
  }
  const iv = validateRendererInstance(inst);
  if (!iv.ok) {
    return { ok: false, skipped: false, reason: 'instance-contract-invalid:' + iv.missing.join('+'), detail: '缺：' + iv.missing.join(', '), trace, phases, frames: [], firstFrame: null, result: null, error: 'instance-contract-invalid' };
  }

  let state = 'new';
  let frames = [];
  let firstFrame = null;
  let result = null;
  let error = '';
  const guard = (allowed, what) => {
    if (state === 'disposed') throw new Error('lifecycle-order:call-after-dispose:' + what);
    if (allowed.indexOf(state) < 0) throw new Error('lifecycle-order:' + what + '-in-state-' + state);
  };
  try {
    guard(['new'], 'init');
    const r0 = await inst.init(plan.container, plan.options || {});
    state = 'inited'; note('init');
    if (plan.source !== undefined && plan.source !== null) {
      guard(['inited', 'loaded'], 'loadScene');
      const r1 = await inst.loadScene(plan.source);
      state = 'loaded'; note('loadScene', { source: typeof plan.source === 'string' ? plan.source : '<object>' });
      if (r1 && typeof r1 === 'object' && r1.ok === false) { error = 'loadScene-failed:' + str(r1.reason || r1.error); }
      result = r1 === undefined ? null : r1;
    } else {
      state = 'loaded'; note('loadScene', { source: '<none>' });
    }
    const frameList = Array.isArray(plan.frames) ? plan.frames : [0];
    for (const t of frameList) {
      guard(['loaded'], 'frame');
      await inst.frame(t);
      frames.push(t); note('frame', { t });
      if (firstFrame === null) firstFrame = { t, index: 0 };
    }
    for (const ev of (Array.isArray(plan.events) ? plan.events : [])) {
      const type = str(ev && ev.type);
      const args = (ev && Array.isArray(ev.args)) ? ev.args : [];
      if (RENDERER_ADAPTER_METHODS.indexOf(type) < 0 || type === 'init' || type === 'loadScene' || type === 'dispose') throw new Error('lifecycle-order:bad-event:' + type);
      guard(['loaded'], type);
      await inst[type](...args);
      note(type, { args });
    }
    if (!error) error = '';
  } catch (e) {
    error = error || ((e && e.message) || str(e));
  } finally {
    try {
      /* `plan.keepAlive === true` = **真实宿主**用：装载完要把实例**留着**（帧还在页面上、事件还要转发），
         释放交给宿主自己（`pagehide` 之类）。缺省（判据/一次性驱动）仍是**用完就关** —— 这也是
         "资源一定被释放"那条纪律的缺省面；两条路都由 C 组判据钉住。 */
      if (plan.keepAlive !== true && state !== 'disposed') { await inst.dispose(); state = 'disposed'; note('dispose'); }
    } catch (e) { error = error || ('dispose-threw:' + ((e && e.message) || str(e))); }
  }
  const keepAlive = plan.keepAlive === true;
  return {
    ok: error === '' && (keepAlive ? state === 'loaded' : state === 'disposed'),
    keepAlive,
    disposed: state === 'disposed',
    skipped: false,
    reason: error === '' ? '' : error,
    detail: '',
    trace,
    phases,
    frames,
    firstFrame,
    result,
    /* 实例本体也回传：`keepAlive: true`（真实宿主）时调用方要拿它转事件、并在合适的时候自己释放。 */
    instance: inst,
    error,
    probe: { available: true, reason: probe.reason || '', detail: probe.detail || '' },
  };
}

/* ═══════════════════════════ ⑥ 提示文案 / 报告 ═══════════════════════════ */

/**
 * 把选择结果翻译成**一句如实的话**（界面 / 日志 / 报告同源）。
 * @param {object} sel `resolveRendererSelection` 的返回值
 */
export function rendererAdapterNotice(sel) {
  const s = sel || {};
  const zh = str(s.lang) !== 'en';
  const id = str(s.adapterId || s.id) || '—';
  /* 回落必须**写在话里**（`?renderer=<未知值>` ⇒ 用了哪一档、为什么）：静默回落 = 界面说一套、画面另一套。 */
  const fb = s.fellBack ? (zh ? `（⚠ 未知档位已回落：${str(s.fellBackReason) || 'unknown'}）` : ` (⚠ unknown tier fell back: ${str(s.fellBackReason) || 'unknown'})`) : '';
  if (!s.skipped && s.action === RENDERER_ACTION.NAVIGATE) {
    return (zh ? `渲染器适配器：${id}（外部来源）—— 导航到 ${s.url || '—'}（来源：${s.from || '—'}）`
      : `renderer adapter: ${id} (external) — navigate to ${s.url || '—'} (from ${s.from || '—'})`) + fb;
  }
  if (!s.skipped && s.action === RENDERER_ACTION.MOUNT) {
    return (zh ? `渲染器适配器：${id}（本仓渲染器）—— 容器内装载（候选：${(s.candidates || []).join(' | ') || '—'}）`
      : `renderer adapter: ${id} (in-repo) — mount into container (candidates: ${(s.candidates || []).join(' | ') || '—'})`) + fb;
  }
  const reason = str(s.reason) || 'unavailable';
  const detail = str(s.detail);
  const tail = zh
    ? '要接上游/第三方渲染器：`?rendererSrc=<URL|路径>` 或设 `MPW_RENDERER_UPSTREAM=<URL>`；要跑本仓渲染器：`?renderer=repo`。'
    : 'To plug in an upstream/third-party renderer use `?rendererSrc=<URL|path>` or set `MPW_RENDERER_UPSTREAM=<URL>`; for the in-repo renderer use `?renderer=repo`.';
  const head = zh ? '渲染器适配器：**明确 SKIP**（没有可用渲染器）' : 'renderer adapter: SKIP (no usable renderer)';
  const why = zh ? `原因=${reason}` : `reason=${reason}`;
  return head + ' · ' + why + (detail ? (zh ? ` · 说明=${detail}` : ` · detail=${detail}`) : '') + ' · ' + tail;
}

/**
 * 机读报告（给 `GET /api/renderers` 与判据用）：契约版本 + 各档能力/可用性 + 当前选择。
 * @param {{registry?:object, url?:string, config?:object, env?:object, embed?:boolean, base?:string}} [ctx]
 */
export function rendererAdapterReport(ctx = {}) {
  const registry = ctx.registry || defaultRendererRegistry;
  const adapters = registry.list().map((a) => {
    const p = safeProbe(a, { config: ctx.config || {}, env: ctx.env || {}, url: ctx.url, base: ctx.base, embed: ctx.embed });
    return { id: a.id, label: a.label, kind: a.kind, capabilities: normalizeCapabilities(a.capabilities), available: !!p.available, reason: p.reason || '', detail: p.detail || '', from: p.from || '' };
  });
  const sel = resolveRendererSelection(ctx);
  return {
    contract: RENDERER_ADAPTER_CONTRACT,
    methods: RENDERER_ADAPTER_METHODS.slice(),
    capabilityKeys: RENDERER_CAPABILITY_KEYS.slice(),
    builtin: [REPO_RENDERER_ID, EXTERNAL_RENDERER_ID],
    adapters,
    selection: {
      id: sel.adapterId, action: sel.action, available: sel.available, skipped: sel.skipped,
      reason: sel.reason, detail: sel.detail, from: sel.from, embed: sel.embed, explicit: sel.explicit,
      fellBack: sel.fellBack, fellBackReason: sel.fellBackReason, notice: sel.notice,
    },
    upstreamInRepo: false,
    upstreamInRepoNote: '仓库内不再内置上游渲染器产物（demo/assets/renderer-*.js 应为 0 份）；上游/第三方一律走外部来源。',
  };
}

export default {
  RENDERER_ADAPTER_CONTRACT,
  RENDERER_ADAPTER_METHODS,
  RENDERER_CAPABILITY_KEYS,
  RENDERER_ACTION,
  REPO_RENDERER_ID,
  EXTERNAL_RENDERER_ID,
  createRendererRegistry,
  defaultRendererRegistry,
  builtinRendererAdapters,
  refreshDefaultRendererRegistry,
  createRepoRendererAdapter,
  createExternalRendererAdapter,
  resolveRendererSelection,
  runRendererLifecycle,
  rendererAdapterReport,
  rendererAdapterNotice,
  normalizeRendererSource,
  normalizeCapabilities,
};
