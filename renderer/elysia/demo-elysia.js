// ?mode=elysia browser entry — 在浏览器里跑 elysia 的 WE CPU 渲染器，
// 用 putImageData 把 r.canvas.data (RGBA) 显示到 demo 页面 canvas。
// 与 WebGL 路径分离: 复用了 core/we-scene-bundle.js 的 parsePkg/getEntry (pkg 读取)
// 与 parseTex/decodeMip0 (纹理解码), elysia 渲染器只做 CPU 光栅化。
import * as lib from '../we-scene-bundle.js';
import { SceneRenderer } from './we-renderer/core.js';

const rd = (b) => new TextDecoder().decode(b).replace(/^\uFEFF/, '');

// 把 we-scene-bundle 解析出的 pkg entries 包装成 elysia 期望的 pkg 访问器。
//   read(name)        → Uint8Array / null
//   readJson(name)    → object / null
//   readText(name)    → string / null
//   has(name)         → bool
function makePkg(pkg) {
  const map = new Map(pkg.entries.map((e) => [e.name, e]));
  const read = (name) => {
    const e = map.get(name);
    if (!e) return null;
    // 返回副本 (getEntry), 避免后续 Buffer 视图与外层共享被意外改写
    return lib.getEntry(pkg, name);
  };
  /* ①(P-177 同口径 2026-09-24) 读的是**包内条目**（project.json / effect.json / material.json…）⇒ 必须容忍
     官方允许的尾逗号与注释（官方 `effects/fluidsimulation/effect.json` 第 402 行自带尾逗号，WE 照用）。
     走 `lib.parseWeJson`（页面/bundle 用的**同一份**实现，不另写一份）。语义与改动前逐条一致：
     **条目不存在 ⇒ null**；条目在而 JSON 真坏 ⇒ 照样抛（调用方 try/catch 语义不变）。 */
  const readJson = (name) => { const b = read(name); return b ? lib.parseWeJson(rd(b)) : null; };
  const readText = (name) => { const b = read(name); return b ? rd(b) : null; };
  const has = (name) => map.has(name);
  return { has, read, readJson, readText, entries: () => pkg.entries };
}

// weAssetsRead: 同步返回全局资产字节 (name 形如 "assets/materials/util/noise.tex")。
// 浏览器预抓取已知全局 util 纹理到缓存, 之后不再 fetch (renderer 同步调用)。
const weCache = new Map();
async function prefetchWeAssets(log) {
  // 全局 util 纹理 (效果链依赖); 缺失则渲染器跳过 (null 纹理)
  const utilNames = ['materials/util/noise.tex', 'materials/util/white.tex', 'materials/util/noflow.tex', 'materials/util/black.tex', 'materials/util/unity_white.tex'];
  await Promise.all(utilNames.map(async (rel) => {
    try {
      const r = await fetch('/weassist/' + rel);
      if (r.ok) { const b = new Uint8Array(await r.arrayBuffer()); weCache.set('assets/' + rel, b); }
    } catch { /* ignore */ }
  }));
}
function weAssetsRead(name) {
  const rel = String(name).replace(/^assets\//, '');
  const cached = weCache.get(name);
  if (cached !== undefined) return cached;
  // 未预抓取 → 同步读不到, 返回 null (renderer 跳过)
  return null;
}

// 默认频谱: 16 带随时间的轻度变化 (驱动 pulse 等音频响应层)。0 时静默。
function makeSpectrum(t) {
  const left = [], right = [];
  for (let i = 0; i < 16; i++) {
    const base = 0.25 + 0.55 * Math.abs(Math.sin(t * 0.7 + i * 0.9));
    const v = Math.min(1, base);
    left.push(v);
    right.push(Math.min(1, v * (0.8 + 0.2 * Math.sin(t * 0.5 + i * 1.3))));
  }
  return { left, right };
}

// ?mode=elysia 主入口
export async function bootElysia({ id, canvas, log, fpsEl }) {
  const logf = log || ((m) => console.log(m));
  const params = new URLSearchParams(location.search);
  const W = Number(params.get('w')) || 640;   // 默认 640×360 (CPU 光栅化, 全效果慢); ?w=960&h=540 可升级
  const H = Number(params.get('h')) || 360;
  const fps = Math.max(1, Number(params.get('fps')) || 2); // 目标帧率 (仅作最小间隔)
  const startNow = Number(params.get('t') || 0); // 可选初始时间

  logf('▶ ?mode=elysia 启动: id=' + id + ' ' + W + 'x' + H + ' @' + fps + 'fps');

  // 1. 抓 pkg 并解析为 pkg 访问器
  logf('… 下载 scene.pkg …');
  const pkgRes = await fetch('/pkg/' + id);
  if (!pkgRes.ok) { logf('❌ 无法下载 /pkg/' + id + ' (' + pkgRes.status + ')'); return; }
  const pkgBytes = new Uint8Array(await pkgRes.arrayBuffer());
  let parsedPkg;
  try { parsedPkg = lib.parsePkg(pkgBytes); } catch (e) { logf('❌ parsePkg: ' + e.message); return; }
  logf('… pkg ' + parsedPkg.magic + ' ' + parsedPkg.count + ' entries …');
  const pkg = makePkg(parsedPkg);

  // 2. 预抓取全局 util 纹理
  await prefetchWeAssets(logf);
  logf('… 全局资产缓存 ' + weCache.size + ' 项 …');

  // 3. 构造 SceneRenderer (内存 pkg + 注入 read)
  let renderer;
  try {
    renderer = new SceneRenderer(pkg, {
      width: W,
      height: H,
      time: startNow,
      staticFrame: false,
      weAssetsRead,
      audioSpectrum: makeSpectrum(startNow || 0),
      log: (m) => logf('  · ' + m),
    });
  } catch (e) { logf('❌ SceneRenderer 构造失败: ' + (e && e.message || e)); return; }

  logf('✅ SceneRenderer 就绪: ' + ((renderer.scene.objects && renderer.scene.objects.length) || 0) + ' scene objects (renderOrder ' + renderer.objects.length + ')');
  // ①(实绘修正) 眼睛组合(115)：渲染前用实绘矩形中心校正其 origin（画布→设计 y-up：
  // 实绘中心=(2348.59,586.29) 画布y-down → 设计 y-up = (2348.59, 2160-586.29)）
  try {
    const eye = renderer.objects.find((x) => x.id === 115)
    if (eye) {
      eye.origin = '2348.59 1573.71 0.00000'
      logf('  · 眼睛组合 origin 实绘校正 → (2348.59, 1573.71)')
    }
  } catch (e) { logf('  · 眼睛校正跳过: ' + e.message) }

  // 4. 显示 canvas 准备
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) { logf('❌ 无法获取 2d 上下文'); return; }
  const imgData = ctx.createImageData(W, H);
  const dst = imgData.data;
  const buf = renderer.canvas.data;

  // 5. 渲染循环 — CPU 渲染慢 (每帧数秒), 用自调度: 当前帧完成后才排下一帧,
  //    避免 setInterval 在阻塞渲染期间堆积回调。targetInterval=1000/fps (仅作为最小间隔)。
  let t = startNow;
  const start = performance.now();
  const targetInterval = Math.round(1000 / fps);
  let frames = 0, ft = 0, last = performance.now();
  /* ③(2026-10-11 · 台账 §1.1 第 22 项修) CPU 路**首帧上报**：与 demo.html 的 `mpwMarkVideoFirstFrame()`
     同口径（demo.html:2753）——供 7s 看门狗、`mpw-cap{firstFrame}`、`data-mpw-frame` 握手使用。
     此前 `elysia/*.js` 0 命中 ⇒ CPU 路永远不报首帧，宿主只能等父页 12s 兜底。 */
  let __elysiaFirstFrameMarked = false;
  function renderOnce(now) {
    t = startNow + (now - start) / 1000; // 复用 r.time 递增 (动画/呼吸)
    if (renderer.audioSpectrum) renderer.audioSpectrum = makeSpectrum(t);
    renderer.setTime(t);
    let cv;
    try {
      cv = renderer.render();
    } catch (e) {
      logf('❌ 渲染错误: ' + (e && e.message || e));
      return;
    }
    const src = cv.data;
    for (let i = 0; i < src.length; i++) dst[i] = src[i];
    ctx.putImageData(imgData, 0, 0);
    if (!__elysiaFirstFrameMarked) {
      __elysiaFirstFrameMarked = true
      try { window.__mpwFirstFrame = 1; window.__mpwCapMarkFrame && window.__mpwCapMarkFrame() } catch (e) { /* 忽略 */ }
    }
    frames++; ft += (now - last); last = now;
    if (ft > 500) { if (fpsEl) fpsEl.textContent = Math.round(frames * 1000 / ft) + ' fps'; frames = 0; ft = 0; }
    schedule();
  }
  function schedule() {
    // 自调度: 等 targetInterval 后再渲染下一帧 (若渲染比 interval 慢则自然降帧)
    window.__elysiaTimer = setTimeout(() => renderOnce(performance.now()), targetInterval);
  }
  await renderOnce(performance.now()); // 先渲一帧
  if (fpsEl) fpsEl.textContent = '…';
  // 保存句柄便于截图等 (可选)
  window.__elysiaRenderer = renderer;
  window.__elysiaStop = () => { if (window.__elysiaTimer) clearTimeout(window.__elysiaTimer); };
}
