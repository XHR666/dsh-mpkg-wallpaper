/* adapter-boot.mjs —— `demo/renderer/index.html` 的**适配器驱动器**（P-350）。
 *
 * 这个文件存在的唯一理由：本页**不再内置上游渲染器产物**（`demo/assets/renderer-*.js` 已被移除，
 * 判据钉住"仓内 0 份"）。它改成"按契约挑一档渲染器"：
 *   · `repo`（缺省，顶层直接打开时）= 仓内自带渲染器，**容器内装载**（同源 iframe，走完整七件套契约）；
 *   · `upstream-external` = **外部**来源（`?rendererSrc=<URL|路径>` / `MPW_RENDERER_UPSTREAM`）⇒ 导航过去
 *     （与移除前逐字同义：被嵌入时 iframe 的 `contentWindow` **就是**外部渲染器本身）；
 *   · 挑不出来 ⇒ **明确 SKIP 面板**（写清原因 + 怎么配外部来源），**不是白屏、不是崩**。
 *
 * 契约本身（注册表 / 选择开关 / 生命周期 / 能力声明）在 `core/renderer-adapter.mjs`（零依赖纯模块）；
 * 这里只做 DOM 落地：建 iframe、探测候选页、把指针/尺寸/可见性事件转给渲染器帧、发布可观测信号。
 *
 * ⚠ 两条**不许做**（否则就是本仓明令禁止的"静默假装"）：
 *   ① 不许在本页发布 `__mpwHostApiReady` / `__wp` / `__mpwResTier` 之类的信号 —— 那是**渲染器**的
 *      握手面，宿主（测试台）靠它判断"iframe 里是本仓渲染器"。本页只是装载器，替渲染器发信号 = 撒谎。
 *   ② 不许把 SKIP 写成"加载中"就完事 —— 面板必须写明原因与下一步。
 */
import {
  createRendererRegistry,
  builtinRendererAdapters,
  resolveRendererSelection,
  runRendererLifecycle,
  probeRepoPages,
  repoTargetUrl,
  RENDERER_ACTION,
} from '../../core/renderer-adapter.mjs';

const URLS = { boot: new URL(import.meta.url) };
/** 宿主可选的注入面（服务端注入 / 测试注入）。没有也照跑（`?rendererSrc=` 与 env 注入仍在服务端）。 */
const HOST = (typeof window !== 'undefined' && window.__MPW_RENDERER_ADAPTERS__ && typeof window.__MPW_RENDERER_ADAPTERS__ === 'object')
  ? window.__MPW_RENDERER_ADAPTERS__ : {};
/** 等渲染器发布**宿主握手面**的上限（毫秒）。超时 ⇒ 如实写"没等到"，不写"已就绪"。
 *  ⚠ 名字故意不叫 first-frame：握手面就绪只证明"渲染器页起来了并发布了宿主 API"，**不等于出画** ——
 *  无 GL 的机器上照样能发布（本机实测 `state=ready` 而无 WebGL2）。真·出画要在有 GL 的机器上另判
 *  （判据 `tests/renderer-adapter-test.mjs` G4b：帧内 `__mpwLiveRes` 或画布 > 300×150）。 */
const HANDSHAKE_TIMEOUT_MS = Number(HOST.handshakeTimeoutMs || HOST.firstFrameTimeoutMs) > 0
  ? Number(HOST.handshakeTimeoutMs || HOST.firstFrameTimeoutMs) : 12000;

const state = {
  contract: 'mpw-renderer-adapter@1',
  state: 'booting',
  id: '',
  action: '',
  reason: '',
  detail: '',
  notice: '',
  url: '',
  embed: false,
  handshake: false,
  events: 0,
  error: '',
  probeTried: null,
};

function publish() {
  try {
    document.documentElement.setAttribute('data-mpw-adapter-state', state.state);
    document.documentElement.setAttribute('data-mpw-adapter-id', state.id || 'none');
    document.documentElement.setAttribute('data-mpw-adapter-handshake', state.handshake ? '1' : '0');
    if (state.action) document.documentElement.setAttribute('data-mpw-adapter-action', state.action);
    if (state.reason) document.documentElement.setAttribute('data-mpw-adapter-reason', state.reason);
  } catch (e) { /* 无 DOM（Node 里 import 本文件时）：照旧发布 window 面 */ }
  try { window.__mpwRendererAdapter = Object.assign({}, state, { notice: state.notice }); } catch (e) { /* ignore */ }
}

function paintNotice(lines, tone) {
  try {
    const el = document.getElementById('notice');
    if (!el) return;
    el.hidden = false;
    el.setAttribute('data-mpw-adapter-notice', tone || 'info');
    el.innerHTML = '';
    for (const item of lines) {
      const p = document.createElement('p');
      if (item && item.href) {
        const a = document.createElement('a');
        a.href = item.href;
        a.textContent = item.text;
        p.appendChild(a);
      } else {
        p.textContent = typeof item === 'string' ? item : String((item && item.text) || '');
      }
      el.appendChild(p);
    }
  } catch (e) { /* ignore */ }
}

/** 把一条 JSON 打进控制台（排障用；不参与任何判定）。 */
function log(line) { try { console.log('[renderer-adapter] ' + line); } catch (e) { /* ignore */ } }

/**
 * 契约实例：把"一个渲染器页"装进容器。
 * 帧循环由渲染器页自己驱动 ⇒ `frame(t)` 是**如实空操作**（能力声明 `selfDrivenFrame:true`），
 * 仍然被调用（契约七件套要能真的走一遍，判据在 Node 里用假实例逐条钉住）。
 */
function createFrameInstance(frameOptions = {}) {
  let frame = null;
  let containerEl = null;
  let ready = null;
  return {
    async init(container, options = {}) {
      containerEl = (typeof container === 'string') ? document.querySelector(container) : container;
      if (!containerEl || !containerEl.appendChild) throw new Error('init(container)：容器无效（要 HTMLElement 或能找到的选择器）');
      frame = document.createElement('iframe');
      frame.setAttribute('data-mpw-adapter-frame', '1');
      frame.setAttribute('allow', 'autoplay; fullscreen');
      frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;background:#000;display:block';
      frame.title = (options && options.title) || 'renderer adapter frame';
      containerEl.appendChild(frame);
      return { ok: true };
    },
    async loadScene(source) {
      const url = (source && typeof source === 'object') ? String(source.url || '') : String(source || '');
      if (!url) return { ok: false, reason: 'empty-source' };
      const done = new Promise((resolve) => {
        const onLoad = () => { try { frame.removeEventListener('load', onLoad); } catch (e) { /* ignore */ } resolve(true); };
        try { frame.addEventListener('load', onLoad); } catch (e) { resolve(true); }
      });
      frame.src = url;
      state.url = url;
      /* 握手面：同源时轮询渲染器**自己**发布的宿主 API；跨源读不到就如实说"读不到"，不编。 */
      ready = waitForRendererHandshake(frame, HANDSHAKE_TIMEOUT_MS);
      await done;
      return { ok: true, url };
    },
    frame(/* t */) { /* 自带帧循环（selfDrivenFrame）⇒ 宿主喂帧是空操作 */ },
    pointer(x, y) {
      state.events++;
      try {
        const w = frame && frame.contentWindow;
        if (w && w.__wp && typeof w.__wp.pushPointer === 'function') w.__wp.pushPointer(x, y);
        else if (w && typeof w.__mpwPushPointer === 'function') w.__mpwPushPointer(x, y);
      } catch (e) { /* 跨源 / 未就绪：静默（事件是**尽力而为**，不是契约的硬承诺） */ }
    },
    resize(w, h) {
      state.events++;
      try { if (frame && frame.style) { frame.style.width = (w > 0 ? w : '100%') + (w > 0 ? 'px' : ''); frame.style.height = (h > 0 ? h : '100%') + (h > 0 ? 'px' : ''); } } catch (e) { /* ignore */ }
    },
    visibility(visible) {
      state.events++;
      try {
        const w = frame && frame.contentWindow;
        if (w && w.__wp && typeof w.__wp.setPaused === 'function') w.__wp.setPaused(!visible);
      } catch (e) { /* 跨源 / 未就绪 */ }
    },
    dispose() {
      try { if (frame && frame.parentNode) frame.parentNode.removeChild(frame); } catch (e) { /* ignore */ }
      frame = null;
      return { ok: true };
    },
    /** 测试/宿主读取：宿主握手面 promise（同源才有；跨源 ⇒ resolve(false)）。 */
    whenReady() { return ready || Promise.resolve(false); },
  };
}

/** 轮询渲染器页**自己**发布的握手面，等到就 resolve(true)，超时 resolve(false)（不谎报）。 */
function waitForRendererHandshake(frame, timeoutMs) {
  const t0 = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      let ok = false;
      try {
        const w = frame && frame.contentWindow;
        if (w) ok = !!(w.__mpwHostApiReady || w.__mpwResTier || w.__mpwLiveRes || w.__wp);
      } catch (e) { ok = false; }
      if (ok) return resolve(true);
      if (Date.now() - t0 >= timeoutMs) return resolve(false);
      setTimeout(tick, 120);
    };
    tick();
  });
}

/** 一处 SKIP 面板：写明**为什么**与**下一步**，并给"改用本仓渲染器"的一键链接。 */
function paintSkip(sel, extraLines = []) {
  state.state = 'skip';
  state.reason = sel.reason || 'unavailable';
  state.detail = sel.detail || '';
  state.id = sel.adapterId || '';
  state.action = sel.action || RENDERER_ACTION.SKIP;
  state.notice = sel.notice || '';
  const q = (() => { try { return new URL(location.href).search; } catch (e) { return ''; } })();
  const repoHref = (() => {
    try { const u = new URL(location.href); u.searchParams.set('renderer', 'repo'); return u.pathname + u.search; } catch (e) { return '?renderer=repo'; }
  })();
  const lines = [
    '渲染器适配器：没有可用渲染器 —— 明确 SKIP（不是加载中，也不是静默通过）',
    '原因：' + (state.reason) + (state.detail ? ' · ' + state.detail : ''),
    '本仓库已不再内置上游渲染器产物（demo/assets/renderer-*.js 为 0 份）⇒ 上游/第三方一律走**外部**来源。',
    '接外部上游：在本页 URL 后加 ?rendererSrc=<URL 或路径>，或给服务端设 MPW_RENDERER_UPSTREAM=<URL>。',
    { text: '改用本仓渲染器（?renderer=repo）', href: repoHref },
    '本页 URL 查询串：' + (q || '（无）'),
  ].concat(extraLines);
  paintNotice(lines, 'skip');
  publish();
  log('SKIP ' + state.reason + ' ' + state.detail);
}

async function main() {
  publish();
  const container = document.getElementById('mount') || document.body;
  const registry = createRendererRegistry(builtinRendererAdapters({
    createRepoInstance: () => createFrameInstance({ title: '本仓渲染器' }),
    createExternalInstance: () => createFrameInstance({ title: '外部渲染器' }),
  }));
  const config = Object.assign({}, HOST.config || {});
  const probeFetch = (typeof fetch === 'function') ? fetch.bind(window) : null;
  const sel = resolveRendererSelection({
    registry,
    url: location.href,
    config,
    env: HOST.env || {},
    embed: (() => { try { return window.top !== window.self; } catch (e) { return true; } })(),
    base: location.href,
  });
  state.id = sel.adapterId || '';
  state.action = sel.action;
  state.embed = sel.embed;
  state.notice = sel.notice;

  if (sel.action === RENDERER_ACTION.NAVIGATE && sel.url) {
    state.state = 'navigating';
    publish();
    log('navigate -> ' + sel.url);
    location.replace(sel.url);
    return;
  }

  if (sel.action === RENDERER_ACTION.SKIP) return paintSkip(sel);

  /* ── 本仓档：先探测候选落点（:8902 的 /webloader/ 或产物根的 demo.html），全不可达 ⇒ SKIP ── */
  const repoAdapter = registry.get(sel.adapterId);
  const pages = await probeRepoPages(repoAdapter, { fetch: probeFetch, base: location.href });
  sel.probeTried = pages.tried;
  if (!pages.available) {
    return paintSkip(Object.assign({}, sel, {
      action: RENDERER_ACTION.SKIP,
      skipped: true,
      reason: pages.reason,
      detail: pages.detail,
      notice: '',
    }), ['探测过的候选：' + pages.tried.map((t) => t.url + '→' + t.status).join(' | ')]);
  }
  const target = repoTargetUrl({ page: pages.url, query: (() => { try { return new URL(location.href).search.replace(/^\?/, ''); } catch (e) { return ''; } })() });

  const life = await runRendererLifecycle(repoAdapter, {
    probeCtx: { config, env: HOST.env || {}, base: location.href },
    container,
    options: { title: '本仓渲染器' },
    source: { url: target },
    frames: [0],
    events: [],
    /* ⚠ `keepAlive: true`：这是**真实宿主**用法 —— 装载完帧要留在页面上、事件还要转发给它，
       释放交给本页自己（下面挂 `pagehide`）。缺省（判据里的一次性驱动）才是"用完就关"。 */
    keepAlive: true,
  });
  state.probeTried = pages.tried;
  if (!life.ok) {
    state.state = 'error';
    state.error = life.reason || life.error || 'unknown';
    state.reason = state.error;
    paintNotice([
      '渲染器适配器：本仓档装载失败 —— 如实报错（不是白屏）',
      '阶段：' + (life.phases || []).join(' > '),
      '原因：' + state.error,
      '目标：' + target,
    ], 'error');
    publish();
    return;
  }

  /* 首帧：等渲染器自己发布握手面；等到 ⇒ ready，等不到 ⇒ degraded（写明"没等到"，不写"就绪"）。 */
  const inst = life.instance;
  const gotFrame = await (inst && typeof inst.whenReady === 'function' ? inst.whenReady() : Promise.resolve(false));
  state.handshake = !!gotFrame;
  state.state = gotFrame ? 'ready' : 'degraded';
  if (!gotFrame) state.reason = 'renderer-handshake-timeout';
  paintNotice(gotFrame ? [
    '渲染器适配器：' + sel.adapterId + '（本仓渲染器）已装载并就绪（渲染器已发布宿主握手面；**这不等于出画**，出画要在有 WebGL2 的机器上看）—— ' + target,
  ] : [
    '渲染器适配器：本仓渲染器已装载，但**没等到**它的宿主握手面（同源时才有）—— 如实写明，不谎报就绪',
    '目标：' + target + '（等 ' + HANDSHAKE_TIMEOUT_MS + 'ms）',
  ], gotFrame ? 'ok' : 'warn');
  publish();
  log((gotFrame ? 'READY ' : 'DEGRADED ') + target);

  /* 宿主自己负责释放（keepAlive 的代价与义务成对）：页面要走的时候把实例关掉。 */
  try { addEventListener('pagehide', () => { try { if (inst && typeof inst.dispose === 'function') inst.dispose() } catch (e) { /* ignore */ } }) } catch (e) { /* 无 DOM 事件面 */ }

  /* 事件转接（指针 / 尺寸 / 可见性）：走契约的实例方法，不另开一条私有通道。 */
  try {
    addEventListener('resize', () => { try { inst.resize(innerWidth, innerHeight) } catch (e) { /* ignore */ } });
    addEventListener('pointermove', (ev) => { try { inst.pointer(ev.clientX, ev.clientY) } catch (e) { /* ignore */ } });
    document.addEventListener('visibilitychange', () => { try { inst.visibility(document.visibilityState === 'visible') } catch (e) { /* ignore */ } });
  } catch (e) { /* 无 DOM 事件面（Node） */ }
}

main().catch((e) => {
  state.state = 'error';
  state.error = (e && e.message) || String(e);
  state.reason = state.error;
  paintNotice(['渲染器适配器：驱动器异常 —— 如实报错', String(state.error)], 'error');
  publish();
  log('ERROR ' + state.error);
});

export { state, createFrameInstance, waitForRendererHandshake, URLS };
