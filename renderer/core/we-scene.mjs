// core/we-scene.mjs —— 渲染器的**库入口**（P-91）：把「画布 + 上下文 + 帧循环 + 帧末后处理链」
// 收敛成一个 `mount(container, opts)`，让分发形态从"克隆仓库 + 起服务器"降到 **一行 import**。
//
// 设计边界（**故意做窄**，避免与 demo.html 的装载层重复实现）：
//   · 本模块**只**负责：建/接管画布 → `createRenderer` → 每帧 `render` → 帧末 bloom/AA/hooks → 停/销毁。
//   · 本模块**不**负责：取包（fetch/pkgpath/pkgurl）、解包、贴图上传、字体、音频、上报、UI 面板。
//     那些是**宿主装载层**的职责，`demo.html` 的 `bootInstance()` 是它的完整参考实现
//     （帧序与本模块逐条一致，见 PATCHES P-91 的对照表）。
//   · 场景与贴图由调用方**注入**：`opts.scene`（已解析）或 `opts.sceneJson`+`opts.project`；
//     贴图走 `opts.textures`（`Map<name, {glTex}>`，与 demo.html 同一形状）。
//     这样 `mount` 在 Node 里可被桩渲染器完整测试（见 mount-test.mjs），不需要真 GL。
//
// 依赖注入（测试/宿主可换）：`opts.createRenderer` / `opts.raf` / `opts.cancelRaf` / `opts.now` / `opts.document`。
import { createRenderer as defaultCreateRenderer, parseScene, applyUserProperties, applyRenderConfig } from './we-scene-bundle.js'

/** 包版本（与 package.json 的 `version` 必须一致；packaging-test 会断言）。 */
export const VERSION = '0.5.20'

const DEFAULT_LOG = () => {}
const isFn = (v) => typeof v === 'function'

/** 解析容器：接受 HTMLElement 或 CSS 选择器；解析失败给出可读错误（而不是 null 上的 TypeError）。 */
function resolveContainer(container, doc) {
  if (!container) return null
  if (typeof container === 'string') {
    const el = doc && doc.querySelector ? doc.querySelector(container) : null
    if (!el) return null
    return el
  }
  if (container.nodeType === 1 || (container.appendChild && container.style)) return container
  return null
}

/** 画布尺寸口径：`opts.width/height` > 容器 clientWidth/Height > 默认 1280×720；再乘 dpr（默认 1）。 */
function resolveSize(container, opts) {
  const dpr = Number(opts.dpr) > 0 ? Number(opts.dpr) : 1
  const cw = Number(opts.width) > 0 ? Number(opts.width) : (container && Number(container.clientWidth) > 0 ? Number(container.clientWidth) : 1280)
  const ch = Number(opts.height) > 0 ? Number(opts.height) : (container && Number(container.clientHeight) > 0 ? Number(container.clientHeight) : 720)
  return { w: Math.max(1, Math.round(cw * dpr)), h: Math.max(1, Math.round(ch * dpr)), dpr }
}

/**
 * 把渲染器挂到一个容器上。
 * @returns 句柄 `{ canvas, renderer, scene, running, frameCount, start, stop, dispose, resize, setQuality, getQuality, setScene, setTextures }`
 */
export function mount(container, opts = {}) {
  const doc = opts.document || (typeof document !== 'undefined' ? document : null)
  const log = isFn(opts.onLog) ? opts.onLog : DEFAULT_LOG
  const el = resolveContainer(container, doc)
  if (!el) throw new Error('mount(container): 容器无效（传 HTMLElement 或能找到的 CSS 选择器）')
  const create = isFn(opts.createRenderer) ? opts.createRenderer : defaultCreateRenderer
  const raf = isFn(opts.raf) ? opts.raf : (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : null)
  const cancelRaf = isFn(opts.cancelRaf) ? opts.cancelRaf : (typeof cancelAnimationFrame !== 'undefined' ? cancelAnimationFrame : null)
  const now = isFn(opts.now) ? opts.now : (() => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()))
  if (!raf) throw new Error('mount(container): 当前环境没有 requestAnimationFrame（Node 里请用 opts.raf 注入）')

  // ── 画布：`opts.canvas` 接管既有画布（多实例/嵌入场景），否则自建一只并挂进容器 ──
  let canvas = opts.canvas || null
  let ownsCanvas = false
  if (!canvas) {
    if (!doc || !doc.createElement) throw new Error('mount(container): 无 document 时必须显式传 opts.canvas')
    canvas = doc.createElement('canvas')
    ownsCanvas = true
  }
  const { w, h, dpr } = resolveSize(el, opts)
  canvas.width = w
  canvas.height = h
  if (canvas.style) { canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.display = 'block' }
  if (ownsCanvas && el.appendChild) el.appendChild(canvas)

  const renderer = create(canvas, opts)
  if (!renderer || !isFn(renderer.render)) throw new Error('mount(container): createRenderer 未返回可用的 renderer.render')

  let scene = opts.scene || null
  if (!scene && opts.sceneJson) {
    scene = parseScene(opts.sceneJson, opts.project || null, opts.parseOpts || {})
  }
  if (scene && opts.userProps) { try { applyUserProperties(scene, opts.userProps, opts.userPropOpts || {}) } catch (e) { log('⚠ mount: applyUserProperties 失败 ' + e.message) } }
  if (scene && opts.renderConfig) { try { applyRenderConfig(scene, opts.renderConfig) } catch (e) { log('⚠ mount: applyRenderConfig 失败 ' + e.message) } }
  let textures = opts.textures || new Map()

  let running = false
  let disposed = false
  let handleId = null
  let frameCount = 0
  let errs = 0
  let paused = false
  const t0 = now()

  /** 一帧。**顺序与 demo.html `frame()` 逐条一致**（render → bloom → AA → hooks）。 */
  async function frame() {
    if (!running || disposed) return
    handleId = null
    if (paused || !scene) { schedule(); return }
    const tSec = (now() - t0) / 1000
    try {
      await renderer.render(scene, textures, canvas.width, canvas.height, tSec)
      try {
        const g = (scene && scene.general) || {}
        if ((g.bloom === true || (g.bloom && g.bloom.value === true)) && isFn(renderer.runBloom)) renderer.runBloom(g, canvas.width, canvas.height)
      } catch (e) { /* bloom 失败不影响主画面（同 demo.html） */ }
      try { if (isFn(renderer.runAA)) renderer.runAA(canvas.width, canvas.height) } catch (e) { /* AA 失败不影响主画面 */ }
      try {
        if (isFn(renderer.runPostFrameHooks)) {
          renderer.runPostFrameHooks({ frame: frameCount, w: canvas.width, h: canvas.height, layers: (scene.layers || []).length, tex: textures.size })
        }
      } catch (e) { /* 钩子失败不影响主画面 */ }
      frameCount++
      if (frameCount === 1) log('✅ we-scene mount 首帧完成')
    } catch (e) {
      if (++errs <= 5) log('render error: ' + (e && e.message))
    }
    schedule()
  }
  function schedule() { if (running && !disposed) handleId = raf(frame) }

  const api = {
    canvas,
    renderer,
    get scene() { return scene },
    get textures() { return textures },
    get running() { return running },
    get frameCount() { return frameCount },
    get dpr() { return dpr },
    start() { if (disposed || running) return api; running = true; schedule(); return api },
    stop() { running = false; if (handleId != null && cancelRaf) cancelRaf(handleId); handleId = null; return api },
    /** 暂停推进但保持挂载（与 stop 的区别：不解除 running，便于 resume）。 */
    pause() { paused = true; return api },
    resume() { paused = false; return api },
    /** 换场景：清 shader 缓存（避免复用上一个场景的 shader 程序），与 demo.html 换包同一处置。 */
    setScene(next, nextTextures) {
      scene = next || null
      if (nextTextures) textures = nextTextures
      if (isFn(renderer.resetShaderCaches)) { try { renderer.resetShaderCaches() } catch (e) { /* ignore */ } }
      return api
    },
    setTextures(next) { textures = next || new Map(); return api },
    setQuality(patch) { if (isFn(renderer.setQuality)) renderer.setQuality(patch); return api },
    getQuality() { return isFn(renderer.getQuality) ? renderer.getQuality() : null },
    /** 画布尺寸变更（窗口 resize 后由宿主调用）。 */
    resize(width, height) {
      const s = resolveSize(el, { width, height, dpr })
      canvas.width = s.w; canvas.height = s.h
      return api
    },
    dispose() {
      if (disposed) return
      disposed = true
      api.stop()
      try { if (ownsCanvas && canvas.parentNode && canvas.parentNode.removeChild) canvas.parentNode.removeChild(canvas) } catch (e) { /* ignore */ }
      try { if (isFn(opts.onDispose)) opts.onDispose(api) } catch (e) { /* ignore */ }
    },
  }
  if (opts.autostart !== false) api.start()
  return api
}

export { parseScene, applyUserProperties, applyRenderConfig }
export default { mount, VERSION }
