#!/usr/bin/env node
/**
 * renderer-adapter-test.mjs —— P-350「渲染器适配器契约」判据（2026-10-16）。
 *
 * 判什么（对应用户口径：「把上游渲染器移除，留一个可扩展的接口，可以接入其他渲染器（含上游的）」）：
 *   A 契约层：版本常量 / 七件套 / 能力声明 / 注册表（重复 id 与残缺适配器必须**拒绝**）
 *   B 选择开关：`?renderer=` 归一、缺省档、外部来源（URL / env / 包名）、回落必须**写在话里**
 *   C 生命周期：init → loadScene → frame → 事件 → dispose 的**顺序**与"probe 不过 ⇒ 不 create"
 *   D **反向**：仓内 `renderer-*.js` 必须 0 份；上游档没配外部来源 ⇒ **明确 SKIP**（既不红也不静默通过）
 *   E 端到端：本仓档在**真服务**上可取（页 + 核心 bundle + 首帧握手标记）；不可达 ⇒ 如实 SKIP
 *   F 变异自证：≥3 组变异（本判据实跑 5 组）改坏模块 ⇒ 打印「期望红集 == 实际红集」
 *   G 真机（可选）：有 WebGL2 的浏览器里跑本仓档 ⇒ 断言**可观测的首帧信号**；无 GL/无浏览器 ⇒ SKIP
 *
 * 纪律：真树只读（变异只落 /tmp 副本）；不启新服务（`:8902` 由 Lead 的常驻实例提供，缺则 E/G 段 SKIP）；
 *       需要写入面的东西一律落 `os.tmpdir()`。
 * 用法：node tests/renderer-adapter-test.mjs
 *       MPW_BENCH_URL=http://127.0.0.1:8931/ node tests/renderer-adapter-test.mjs   # 换服务（含 /api/renderers）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './_root.mjs';

const SRC = path.join(ROOT, 'core', 'renderer-adapter.mjs');
const MOD = await import(pathToFileURL(SRC).href);
const BENCH_URL = process.env.MPW_BENCH_URL || 'http://127.0.0.1:8902/';

let pass = 0, fail = 0, skipN = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + label + (extra ? '  — ' + extra : '')); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  — ' + extra : '')); }
};
const eq = (got, want, label) => ok(got === want, label, got === want ? '' : '实际=' + JSON.stringify(got) + ' 期望=' + JSON.stringify(want));
const sk = (label, why) => { skipN++; console.log('  ~ SKIP ' + label + '（' + why + '）'); };
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** 抽出 HTML 里**可执行/会发请求**的引用（`<script src>` / `<link href>`），注释与散文不算。
 *  为什么要这么判："页面不再引用上游产物"是**引用面**的事实，不能靠"文件名在全文里 0 命中"来证 ——
 *  注释里写清楚"以前引的是哪个文件"是**留痕**，不该被判红（假红比不判更坏）。 */
const htmlRefs = (html) => {
  const out = [];
  const re = /<(script|link)\b[^>]*?\b(src|href)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
  let m;
  while ((m = re.exec(String(html)))) out.push(m[3].replace(/^["']|["']$/g, ''));
  return out;
};

/* ══════════════════════════ 假实例 / 桩 ══════════════════════════ */
function fakeInstance(log, opts = {}) {
  const inst = {
    log,
    init(c, o) { log.push('init'); inst.initArgs = [c, o]; if (opts.initThrows) throw new Error('init-boom'); return { ok: true }; },
    loadScene(s) { log.push('loadScene'); if (opts.loadThrows) throw new Error('load-boom'); return { ok: true }; },
    frame(t) { log.push('frame:' + t); },
    pointer(x, y) { log.push('pointer:' + x + ',' + y); },
    resize(w, h) { log.push('resize:' + w + 'x' + h); },
    visibility(v) { log.push('visibility:' + v); },
    dispose() { log.push('dispose'); inst.disposed = (inst.disposed || 0) + 1; return { ok: true }; },
  };
  return inst;
}
/** 建一个"注册表 + 两个探针计数器"的夹具（create 是否被调用 = SKIP 语义的核心读数）。 */
function fixture(M, opts = {}) {
  const repoLog = [], extLog = [];
  const calls = { createRepo: 0, createExt: 0 };
  const adapters = M.builtinRendererAdapters({
    createRepoInstance: () => { calls.createRepo++; return fakeInstance(repoLog, opts.repo || {}); },
    createExternalInstance: () => { calls.createExt++; return fakeInstance(extLog, opts.ext || {}); },
  });
  const registry = M.createRendererRegistry(adapters);
  return { registry, calls, repoLog, extLog, repoAdapter: registry.get(M.REPO_RENDERER_ID), extAdapter: registry.get(M.EXTERNAL_RENDERER_ID) };
}
const sel = (M, fx, input) => M.resolveRendererSelection(Object.assign({ registry: fx.registry, url: 'https://host/wallpaper-engine-webgl/renderer/index.html' }, input));

/* ══════════════════════════ A–C：模块逻辑（变异自证跑的就是这一套） ══════════════════════════ */
async function runLogicChecks(M) {
  const res = new Map();
  const put = (id, cond, label, extra = '') => { res.set(id, { id, ok: !!cond, label, extra: cond ? (extra || '') : (extra || '') }); };
  const putEq = (id, got, want, label) => put(id, got === want, label, got === want ? '' : '实际=' + JSON.stringify(got) + ' 期望=' + JSON.stringify(want));

  /* ── A 契约层 ── */
  putEq('A1a', M.RENDERER_ADAPTER_CONTRACT, 'mpw-renderer-adapter@1', 'A1a 契约版本逐字 = mpw-renderer-adapter@1');
  putEq('A1b', M.RENDERER_ADAPTER_METHODS.join(','), 'init,loadScene,frame,pointer,resize,visibility,dispose', 'A1b 实例七件套逐字且顺序 = 文档顺序');
  {
    const fx = fixture(M);
    const vr = M.validateRendererAdapter(fx.repoAdapter);
    const ve = M.validateRendererAdapter(fx.extAdapter);
    put('A2a', vr.ok && ve.ok, 'A2a 两档内置适配器都通过契约校验', JSON.stringify(vr.errors.concat(ve.errors)));
    const mk = () => { const fx2 = fixture(M); return fx2.repoAdapter; };
    const cases = [
      ['A2b', (a) => { delete a.id; }, 'missing-id', '缺 id'],
      ['A2c', (a) => { delete a.contract; }, 'missing-contract', '缺 contract'],
      ['A2d', (a) => { a.contract = 'other@0'; }, 'contract-mismatch', '契约版本不符'],
      ['A2e', (a) => { delete a.label; }, 'missing-label', '缺 label'],
      ['A2f', (a) => { a.kind = 'weird'; }, 'bad-kind', 'kind 非法'],
      ['A2g', (a) => { delete a.probe; }, 'missing-probe', '缺 probe'],
      ['A2h', (a) => { delete a.create; }, 'missing-create', '缺 create'],
      ['A2i', (a) => { delete a.capabilities; }, 'missing-capabilities', '缺 capabilities'],
      ['A2j', (a) => { a.capabilities = { scenePkg: true, nope: true }; }, 'unknown-capability-key', '能力键未知'],
      ['A2k', (a) => { a.capabilities = { scenePkg: 'maybe' }; }, 'bad-capability-value', '能力值非法'],
    ];
    const bad = [];
    for (const [id, mut, code, why] of cases) {
      const a = mk(); mut(a);
      const v = M.validateRendererAdapter(a);
      const codes = v.errors.map((e) => e.code);
      const hit = !v.ok && codes.indexOf(code) >= 0;
      put(id, hit, 'A2 ' + why + ' ⇒ 拒绝且错误码 = ' + code, hit ? '' : '实际=' + JSON.stringify(codes));
      if (!hit) bad.push(why);
    }
    for (const [id, val, why] of [['A2l', null, 'null'], ['A2m', undefined, 'undefined'], ['A2n', 42, '非对象']]) {
      const v = M.validateRendererAdapter(val);
      put(id, !v.ok && v.errors[0] && v.errors[0].code === 'not-an-object', 'A2 ' + why + ' ⇒ not-an-object');
    }
    const vi = M.validateRendererInstance({ init() {} });
    put('A2o', !vi.ok && vi.missing.length === 6, 'A2o 实例缺方法 ⇒ 点名 6 个缺失', vi.missing.join(','));
  }
  {
    const caps = M.normalizeCapabilities({ scenePkg: true, webWallpaper: 'degraded' });
    put('A3a', caps.scenePkg === true && caps.webWallpaper === 'degraded', 'A3a 声明的能力原样保留');
    put('A3b', caps.mpkg === 'unknown', 'A3b 未声明的键补 unknown（**不许**补 false —— 那会把"没声明"读成"做不到"）', 'mpkg=' + caps.mpkg);
    put('A3c', Object.keys(caps).length === M.RENDERER_CAPABILITY_KEYS.length, 'A3c 归一后键集 = 规范键全集', Object.keys(caps).length + ' vs ' + M.RENDERER_CAPABILITY_KEYS.length);
    const iss = M.capabilityIssues({ scenePkg: true, nope: true, mpkg: 'maybe' });
    put('A3d', iss.unknownKeys.join(',') === 'nope' && iss.badValues.join(',') === 'mpkg=maybe', 'A3d capabilityIssues 分别点出未知键与非法值', JSON.stringify(iss));
    const d = M.capabilityDiff(M.REPO_RENDERER_CAPABILITIES, M.EXTERNAL_RENDERER_CAPABILITIES);
    const dSelf = M.capabilityDiff(M.REPO_RENDERER_CAPABILITIES, M.REPO_RENDERER_CAPABILITIES);
    put('A3e', d.diff.length === M.RENDERER_CAPABILITY_KEYS.length && d.same.length === 0
      && d.diff.every((x) => x.b === 'unknown') && d.diff.some((x) => x.key === 'scenePkg' && x.a === true),
      'A3e 两档能力对账：repo 逐键声明 / external 全 unknown（12 项全在 diff 里，逐键点名）', 'diff=' + d.diff.length + ' same=' + d.same.length);
    put('A3f', dSelf.same.length === M.RENDERER_CAPABILITY_KEYS.length && dSelf.diff.length === 0,
      'A3f 对照：同一份声明跟自己比 ⇒ 全 same（capabilityDiff 不是恒报差异的空壳）', 'same=' + dSelf.same.length);
  }
  {
    const fx = fixture(M);
    const reg = fx.registry;
    put('A4a', reg.size() === 2 && reg.ids().join(',') === M.REPO_RENDERER_ID + ',' + M.EXTERNAL_RENDERER_ID, 'A4a 注册表可注册**多个**（两档都在）', reg.ids().join(','));
    put('A4b', reg.get(M.REPO_RENDERER_ID) === fx.repoAdapter && reg.has(M.EXTERNAL_RENDERER_ID) && reg.unregister('nope') === false, 'A4b get/has/unregister 逐值');
    let dup = ''; try { reg.register(fx.repoAdapter); } catch (e) { dup = e.message; }
    put('A4c', /重复 id/.test(dup), 'A4c 重复 id ⇒ 抛错（不静默覆盖）', dup.slice(0, 60));
    let badReg = ''; try { reg.register({ id: 'x' }); } catch (e) { badReg = e.message; }
    put('A4d', /renderer-adapter:register 拒绝/.test(badReg), 'A4d 残缺适配器 ⇒ 注册抛错（错误码写进消息）', badReg.slice(0, 80));
    reg.clear(); put('A4e', reg.size() === 0 && reg.list().length === 0, 'A4e clear 清空');
    const iso = M.createRendererRegistry();
    iso.register(fx.repoAdapter);
    put('A4f', iso.size() === 1 && M.defaultRendererRegistry.has(M.REPO_RENDERER_ID) && M.defaultRendererRegistry.size() >= 2,
      'A4f 注册表互相隔离 + 默认注册表已预置两档（服务端 /api/renderers 的空壳教训）', 'iso=' + iso.size() + ' default=' + M.defaultRendererRegistry.size());
  }

  /* ── B 选择开关 ── */
  {
    const fx = fixture(M);
    const ids = ['repo', 'local', 'self', 'builtin', 'webloader'].map((v) => M.normalizeRendererId(v));
    const extIds = ['upstream', 'external', 'third-party', 'custom'].map((v) => M.normalizeRendererId(v));
    put('B1a', ids.every((v) => v === M.REPO_RENDERER_ID), 'B1a 本仓档别名归一（repo/local/self/builtin/webloader）', ids.join(','));
    put('B1b', extIds.every((v) => v === M.EXTERNAL_RENDERER_ID), 'B1b 外部档别名归一（upstream/external/third-party/custom）', extIds.join(','));
    put('B1c', M.normalizeRendererId('whatever') === 'whatever' && M.normalizeRendererId('') === '', 'B1c 未知名原样返回（交给注册表判"未知"）');

    const top = sel(M, fx, {});   // 顶层（embed 缺省 false）+ 无外部来源
    put('B2a', top.action === M.RENDERER_ACTION.MOUNT && top.adapterId === M.REPO_RENDERER_ID && !top.skipped,
      'B2a 顶层直接打开 + 无外部来源 ⇒ 缺省**本仓档**（容器内装载）', top.action + '/' + top.adapterId);
    put('B2b', top.candidates.length === 2 && top.candidates[0] === '/webloader/', 'B2b 本仓档候选落点带出来了（宿主据此运行时探测）', top.candidates.join(' | '));
    put('B2c', /本仓渲染器/.test(top.notice), 'B2c 提示文案写明"本仓渲染器"', top.notice.slice(0, 60));

    const emb = sel(M, fx, { embed: true });
    put('B3a', emb.action === M.RENDERER_ACTION.SKIP && emb.skipped === true && emb.available === false,
      'B3a 被宿主嵌入（点名要"上游产物"档）+ 无外部来源 ⇒ **明确 SKIP**（绝不偷偷回落本仓档）', emb.action + '/' + emb.reason);
    putEq('B3b', emb.reason, 'embedded-needs-external-source', 'B3b SKIP 原因 = embedded-needs-external-source');
    put('B3c', emb.adapter === null && fx.calls.createRepo === 0 && fx.calls.createExt === 0,
      'B3c SKIP 选择里**没有可挂的适配器**（宿主无从 create；更不会挂半个壳）',
      'adapter=' + (emb.adapter ? emb.adapter.id : 'null') + ' calls=' + JSON.stringify(fx.calls));
    put('B3d', /SKIP/.test(emb.notice) && /rendererSrc/.test(emb.notice), 'B3d SKIP 是"明确"的：文案里有 SKIP 与下一步配置指引', emb.notice.slice(0, 80));

    const fx2 = fixture(M);
    const ext = sel(M, fx2, { url: 'https://host/r/index.html?type=scene&src=abc&rendererSrc=' + encodeURIComponent('https://cdn.example/bundle.js') + '&fit=cover' });
    put('B4a', ext.action === M.RENDERER_ACTION.NAVIGATE && ext.adapterId === M.EXTERNAL_RENDERER_ID,
      'B4a 配了外部 URL 来源 ⇒ **导航**到外部渲染器（与移除前逐字同义）', ext.action + '/' + ext.adapterId);
    put('B4b', ext.url === 'https://cdn.example/bundle.js?type=scene&src=abc&fit=cover',
      'B4b 目标 URL 保留原查询串、**摘掉本层控制参数**（renderer / rendererSrc 不转发给外部）', ext.url);
    put('B4c', /外部来源/.test(ext.notice) && /url \?rendererSrc=/.test(ext.notice), 'B4c 文案写明来源与去处', ext.notice.slice(0, 80));

    const fx3 = fixture(M);
    const env = sel(M, fx3, { env: { MPW_RENDERER_UPSTREAM: 'http://127.0.0.1:8899' } });
    put('B5a', env.action === M.RENDERER_ACTION.NAVIGATE && env.from === 'env MPW_RENDERER_UPSTREAM', 'B5a 环境变量来源（沿用既有 MPW_RENDERER_UPSTREAM 语义）', env.from);
    const env2 = sel(M, fixture(M), { env: { MPW_RENDERER_8899: 'http://127.0.0.1:8899' } });
    put('B5b', env2.action === M.RENDERER_ACTION.NAVIGATE && /旧名/.test(env2.from), 'B5b 旧名 MPW_RENDERER_8899 仍然认（兼容既有脚本）', env2.from);
    const prio = sel(M, fixture(M), { url: 'https://host/r/index.html?renderer=repo&rendererSrc=https%3A%2F%2Fcdn.example%2Fb.js' });
    put('B5c', prio.adapterId === M.REPO_RENDERER_ID && prio.action === M.RENDERER_ACTION.MOUNT, 'B5c 显式 ?renderer= 优先于"配了外部来源"（点名优先）', prio.adapterId);

    const pkg = sel(M, fixture(M), { url: 'https://host/r/index.html?rendererSrc=' + encodeURIComponent('npm:@scope/renderer') });
    put('B6a', pkg.action === M.RENDERER_ACTION.SKIP && pkg.reason === 'external-source-needs-resolver',
      'B6a 包名来源需要宿主解析器 ⇒ 明确 SKIP（本模块不解析包名，不假装成功）', pkg.reason);
    put('B6b', pkg.adapterId === M.EXTERNAL_RENDERER_ID, 'B6b 显式给了外部来源但用不了 ⇒ 仍是外部档（**不回落**本仓档）', pkg.adapterId);

    const unk = sel(M, fixture(M), { url: 'https://host/r/index.html?renderer=nope' });
    put('B7a', unk.fellBack === true && unk.fellBackReason === 'unknown-renderer-id:nope', 'B7a 未知档位 ⇒ 回落并写明原因（回落不许静默）', unk.fellBackReason);
    put('B7b', /回落/.test(unk.notice), 'B7b 回落写进提示文案', unk.notice.slice(-60));

    const r1 = M.repoTargetUrl({ page: '/webloader/', query: 'type=scene&src=3544152633&mediaBase=x' });
    put('B8a', r1 === '/webloader/?type=scene&src=3544152633&mediaBase=x&id=3544152633&shell=0',
      'B8a 窄桥①：scene 档 src→id，原查询串**只增不删**，补 shell=0（无外壳形态）', r1);
    const r2 = M.repoTargetUrl({ page: '../../demo.html', query: 'type=scene&src=' + encodeURIComponent('卡提希娅/卡提希娅_01.mpkg') });
    put('B8b', r2.indexOf('id=' + encodeURIComponent('卡提希娅/卡提希娅_01.mpkg')) > 0, 'B8b 窄桥②：嵌套 itemId（.mpkg 一等项）照样补上', r2);
    const r3 = M.repoTargetUrl({ page: '/webloader/', query: 'type=web&src=' + encodeURIComponent('/web/dev/3644069061/index.html') });
    put('B8c', /[?&]id=3644069061(&|$)/.test(r3), 'B8c 窄桥③：web 档从 /web/dev/<id>/ 段取回同一个 id', r3);
    const r4 = M.repoTargetUrl({ page: '/webloader/', query: 'type=scene&src=9&shell=1' });
    put('B8d', /[?&]shell=1(&|$)/.test(r4) && !/shell=0/.test(r4), 'B8d 窄桥④：显式 shell= 一个字符不改', r4);
    const r5 = M.repoTargetUrl({ page: '/webloader/', query: 'type=video&src=' + encodeURIComponent('/media/dev/2887099508/x.mp4') });
    put('B8e', /[?&]id=2887099508(&|$)/.test(r5), 'B8e 窄桥⑤：video 档同样从 /media/dev/<id>/ 取 id', r5);

    putEq('B9a', M.externalTargetUrl({ kind: 'none', url: '' }, 'a=1'), '', 'B9a 没有来源 ⇒ 目标 URL 为空串（调用方据此 SKIP，不导航到空白）');
    putEq('B9b', M.externalTargetUrl({ kind: 'url', url: 'https://x/b.js?k=1' }, 'a=1'), 'https://x/b.js?k=1&a=1', 'B9b 来源已带查询串 ⇒ 用 & 拼接');
  }

  /* ── C 生命周期 ── */
  {
    const fx = fixture(M);
    const life = await runLife(M, fx.repoAdapter, {
      container: { id: 'c' }, source: { url: '/webloader/?id=1' }, frames: [0, 16, 33],
      events: [{ type: 'pointer', args: [5, 6] }, { type: 'resize', args: [800, 600] }, { type: 'visibility', args: [false] }],
    });
    put('C1a', life.ok === true && life.skipped === false, 'C1a 本仓档完整生命周期 ok', JSON.stringify({ ok: life.ok, err: life.error }));
    putEq('C1b', life.phases.join('>'), 'init>loadScene>frame>frame>frame>pointer>resize>visibility>dispose', 'C1b 阶段序列逐条 = init>loadScene>frame×3>pointer>resize>visibility>dispose');
    putEq('C1c', fx.repoLog.join(','), 'init,loadScene,frame:0,frame:16,frame:33,pointer:5,6,resize:800x600,visibility:false,dispose', 'C1c 实例侧调用序列逐条对账（事件真的转到了实例方法上）');
    put('C1d', life.frames.join(',') === '0,16,33' && life.trace.filter((t) => t.phase === 'frame').length === 3, 'C1d frames 逐值 + trace 条数', life.frames.join(','));
    put('C2a', life.firstFrame && life.firstFrame.t === 0 && life.firstFrame.index === 0, 'C2a **首帧可观测信号** = 第一次 frame(t) 的 t', JSON.stringify(life.firstFrame));
    put('C2b', fx.repoLog.filter((x) => x === 'dispose').length === 1, 'C2b dispose 恰好一次');
  }
  {
    const fx = fixture(M);
    const life = await runLife(M, fx.repoAdapter, { frames: [0], events: [{ type: 'dispose' }] });
    put('C3a', life.ok === false && /lifecycle-order:bad-event:dispose/.test(life.error), 'C3a 事件里塞 dispose ⇒ 明确报 lifecycle-order（不许从事件通道偷偷释放）', life.error);
    put('C3b', fx.repoLog.filter((x) => x === 'dispose').length <= 1, 'C3b 报错后 dispose 仍只发生一次（finally 兜底）', fx.repoLog.join(','));
  }
  {
    const fx = fixture(M);
    const life = await runLife(M, fx.extAdapter, { frames: [0] });   // 外部档没配来源 ⇒ probe 不过
    put('C4a', life.skipped === true && life.ok === false && life.reason === 'external-source-not-configured',
      'C4a probe 不过 ⇒ **明确 SKIP**（skipped=true / ok=false / reason 逐字）', life.reason);
    put('C4b', fx.calls.createExt === 0 && life.trace.length === 0, 'C4b SKIP ⇒ 一次都没 create、trace 为空（连半步都没走）', JSON.stringify(fx.calls));
  }
  {
    const fx = fixture(M);
    const thin = M.createRepoRendererAdapter({ createInstance: () => ({ init() {}, loadScene() {} }) });
    const life = await runLife(M, thin, { frames: [0] });
    put('C5a', life.ok === false && /instance-contract-invalid/.test(life.reason) && /frame/.test(life.detail),
      'C5a create 返回残缺实例 ⇒ 点名缺哪些方法（frame/pointer/resize/visibility/dispose）', life.reason + ' | ' + life.detail);
  }
  {
    const boom = M.createRepoRendererAdapter({ createInstance: () => { throw new Error('create-boom'); } });
    const life = await runLife(M, boom, { frames: [0] });
    put('C6a', life.ok === false && life.reason === 'create-threw' && /create-boom/.test(life.detail), 'C6a create 抛错 ⇒ create-threw（如实带原因）', life.detail);
  }
  {
    const fx = fixture(M, { repo: { loadThrows: true } });
    const life = await runLife(M, fx.repoAdapter, { source: { url: 'x' }, frames: [0] });
    put('C7a', life.ok === false && /load-boom/.test(life.reason), 'C7a loadScene 抛错 ⇒ 生命周期失败并带原因', life.reason);
    put('C7b', fx.repoLog.indexOf('dispose') >= 0 && life.phases[life.phases.length - 1] === 'dispose', 'C7b 失败路径上 dispose **仍然被调用**且是最后一步', life.phases.join('>'));
  }
  {
    const life = await M.runRendererLifecycle({ id: 'broken' }, { frames: [0] });
    put('C8a', life.ok === false && /^adapter-contract-invalid:/.test(life.reason), 'C8a 适配器本身不合契约 ⇒ 直接拒绝（不进 create）', life.reason);
  }
  {
    /* keepAlive：真实宿主（适配器装载页）装载后必须**留着实例**（帧在页面上、事件还要转发），
       缺省仍是"用完就关"；两条路各断言一次（缺了任一条，另一种用法就会静默坏掉）。 */
    const fx1 = fixture(M);
    const keep = await runLife(M, fx1.repoAdapter, { container: { id: 'k' }, source: { url: 'x' }, frames: [0], keepAlive: true });
    put('C10a', keep.ok === true && keep.keepAlive === true && keep.disposed === false
      && fx1.repoLog.indexOf('dispose') < 0 && keep.phases[keep.phases.length - 1] === 'frame'
      && keep.instance && typeof keep.instance.dispose === 'function',
      'C10a keepAlive=true ⇒ **不自动 dispose**、帧留着（真实宿主用法：适配器装载页），实例仍可手动释放',
      'phases=' + keep.phases.join('>') + ' disposed=' + keep.disposed);
    const fx2 = fixture(M);
    const once = await runLife(M, fx2.repoAdapter, { container: { id: 'o' }, source: { url: 'x' }, frames: [0] });
    put('C10b', once.ok === true && once.disposed === true && fx2.repoLog.filter((x) => x === 'dispose').length === 1,
      'C10b 缺省（判据/一次性驱动）⇒ 仍然"用完就关"（dispose 恰一次）', 'disposed=' + once.disposed);
    const fx3 = fixture(M);
    const ka = await runLife(M, fx3.repoAdapter, { container: { id: 'k' }, source: { url: 'x' }, frames: [0, 1], keepAlive: true });
    try { await ka.instance.dispose() } catch (e) { /* 记到日志里由下一行断言 */ }
    put('C10c', fx3.repoLog.filter((x) => x === 'dispose').length === 1, 'C10c keepAlive 下宿主手动 dispose 仍然有效（不是"没人管得了"的实例）', fx3.repoLog.join(','));
  }
  {
    /* probeRepoPages：宿主注入 fetch ⇒ 首个 2xx 胜出；全失败 ⇒ 如实回报"候选全不可达" + 逐条读数 */
    const mkFetch = (map) => async (u) => { const status = map[u] || 404; return { ok: status >= 200 && status < 300, status }; };
    const fx = fixture(M);
    const hit = await M.probeRepoPages(fx.repoAdapter, { fetch: mkFetch({ 'https://host/webloader/': 404, 'https://host/demo.html': 200 }), base: 'https://host/WEwebLoader/renderer/index.html' });
    put('C9a', hit.available === true && hit.url === 'https://host/demo.html', 'C9a 候选页探测：首个 2xx 胜出（Pages 布局落到站点根 demo.html）', hit.url + ' tried=' + JSON.stringify(hit.tried));
    const miss = await M.probeRepoPages(fx.repoAdapter, { fetch: mkFetch({}), base: 'https://host/WEwebLoader/renderer/index.html' });
    put('C9b', miss.available === false && miss.reason === 'repo-page-unreachable' && miss.tried.length === 2,
      'C9b 候选全不可达 ⇒ repo-page-unreachable + 两条 tried 读数（不猜、不蒙）', JSON.stringify(miss.tried.map((t) => t.url + '→' + t.status)));
    const nofetch = await M.probeRepoPages(fx.repoAdapter, { fetch: null });
    put('C9c', nofetch.available === false && nofetch.reason === 'repo-page-probe-unavailable', 'C9c 没有 fetch ⇒ 如实说探测不可用（不是"通过"）', nofetch.reason);
  }
  return res;
}
/** 跑生命周期的简写（plan 里自动补齐 probeCtx）。 */
const runLife = (M, adapter, plan) => M.runRendererLifecycle(adapter, Object.assign({ probeCtx: { config: {}, env: {} } }, plan));

/* ══════════════════════════ D：反向（产物缺失必须明确 SKIP） ══════════════════════════ */
function walkFiles(dir, out = [], skipDirs = new Set(['.git', 'node_modules', '_site'])) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!skipDirs.has(e.name)) walkFiles(path.join(dir, e.name), out, skipDirs); continue; }
    out.push(path.join(dir, e.name));
  }
  return out;
}
async function treeChecks() {
  console.log('\n== D 反向：仓库内不再内置上游渲染器产物（缺产物 ⇒ 明确 SKIP，不是红也不是静默通过） ==');
  const assets = fs.readdirSync(path.join(ROOT, 'demo', 'assets')).filter((n) => /^renderer-.*\.js$/.test(n));
  ok(assets.length === 0, 'D1 demo/assets 里上游产物 renderer-*.js **0 份**（移除后不许再塞回来）', assets.join(',') || '(空)');
  const all = walkFiles(ROOT).filter((f) => /^renderer-.*\.js$/.test(path.basename(f)));
  ok(all.length === 0, 'D2 全仓库（除 .git/node_modules）renderer-*.js **0 份**', all.map((f) => path.relative(ROOT, f)).join(',') || '(空)');
  const fx = fixture(MOD);
  const s = sel(MOD, fx, { embed: true });
  ok(s.skipped === true && s.available === false && s.action === 'skip',
    'D3 上游档（被嵌入）+ 无外部来源 ⇒ skipped=true / available=false（"明确 SKIP"三要素）', JSON.stringify({ skipped: s.skipped, available: s.available, reason: s.reason }));
  ok(/SKIP/.test(s.notice) && s.notice.indexOf('rendererSrc') > 0, 'D4 SKIP 文案含 SKIP 与外部来源配置指引（不静默、不白屏）', s.notice.slice(0, 70));
  const page = read('demo/renderer/index.html');
  const pageRefs = htmlRefs(page);
  ok(pageRefs.length > 0 && !pageRefs.some((u) => /renderer-[A-Za-z0-9_-]+\.js/.test(u)),
    'D5 渲染器页的**可执行引用**（script src / link href）里没有任何 renderer-*.js（旧入口已拆掉；注释里的历史说明不算引用）',
    pageRefs.join(' | '));
  ok(/\.\/adapter-boot\.mjs/.test(page) && /core\/renderer-adapter\.mjs/.test(read('demo/renderer/adapter-boot.mjs')),
    'D6 渲染器页改由适配器驱动（页 → ./adapter-boot.mjs → ../../core/renderer-adapter.mjs）');
  ok(fs.existsSync(path.join(ROOT, 'demo', 'LICENSE-webwallgl')) && fs.existsSync(path.join(ROOT, 'demo', 'LICENSE-webwallgl-MIT.txt'))
    && /github\.com\/oneincase\/webwallgl/.test(read('THIRD-PARTY.md')),
    'D7 ⚠ 删产物**不撤署名**：两份 upstream LICENSE + THIRD-PARTY.md 的 oneincase/webwallgl 归属原样在位');
}

/* ══════════════════════════ E：端到端（真服务只读） ══════════════════════════ */
async function e2eChecks() {
  console.log('\n== E 端到端（真服务只读：本仓渲染器页 + 核心 bundle + 首帧握手标记） ==');
  const fx = fixture(MOD);
  const repo = fx.repoAdapter;
  const probe = await MOD.probeRepoPages(repo, { base: BENCH_URL });
  if (!probe.available) {
    sk('E1 本仓渲染器页可达性', '服务不可达（' + BENCH_URL + '）⇒ ' + probe.reason + ' tried=' + JSON.stringify((probe.tried || []).map((t) => t.url + '→' + t.status)));
  } else {
    ok(true, 'E1 本仓渲染器页在真服务上可取', probe.url + ' tried=' + JSON.stringify((probe.tried || []).map((t) => t.url + '→' + t.status)));
    const pageRes = await fetch(probe.url).then((r) => r.text());
    ok(/__mpwResTier/.test(pageRes) && /__mpwHostApiReady/.test(pageRes),
      'E2 本仓渲染器页带**首帧/活档位握手标记**（__mpwResTier + __mpwHostApiReady ⇒ 判据在浏览器里能读到同一批信号）',
      'bytes=' + pageRes.length);
    const bundle = await fetch(new URL('/bundle.js', probe.url)).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
    ok(!!bundle && bundle.byteLength > 1000000, 'E3 本仓渲染核心 /bundle.js 可取且体积 > 1 MB',
      bundle ? bundle.byteLength + ' B' : '取不到');
    const life = await runLife(MOD, repo, { container: { id: 'e2e' }, source: { url: probe.url }, frames: [0], events: [{ type: 'resize', args: [1280, 720] }] });
    ok(life.ok && life.firstFrame && life.firstFrame.t === 0 && life.phases[life.phases.length - 1] === 'dispose',
      'E4 本仓适配器端到端（假实例 + **真页面 URL**）⇒ 首帧信号 + 顺序闭合', life.phases.join('>'));
    const html = await fetch(new URL('/wallpaper-engine-webgl/renderer/index.html', BENCH_URL)).then((r) => r.text()).catch(() => '');
    const refs = htmlRefs(html);
    ok(html.length > 0 && !refs.some((u) => /renderer-[A-Za-z0-9_-]+\.js/.test(u)) && refs.some((u) => /adapter-boot\.mjs/.test(u)),
      'E5 服务端直供的渲染器页 = 适配器页（引用里只有 adapter-boot.mjs，没有上游产物）', 'bytes=' + html.length + ' refs=' + refs.join('|'));
    const dead = await fetch(new URL('/wallpaper-engine-webgl/assets/renderer-n-Rw_ZVc.js', BENCH_URL)).then((r) => r.status).catch(() => 0);
    ok(dead === 404, 'E6 上游产物旧路径在服务端 **404**（真的没了，不是"页面上没引用而已"）', 'status=' + dead);
  }
  /* 服务端枚举面（`GET /api/renderers`）：只在**加载了本批改动**的服务上成立。
     `:8902` 是常驻实例、按纪律不许重启 ⇒ 老进程回 404 时**如实 SKIP**，不谎报成红也不谎报成绿。 */
  const api = await fetch(new URL('/api/renderers', BENCH_URL)).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!api) {
    sk('E7 GET /api/renderers（服务端枚举面）', '该服务进程早于本批改动启动（:8902 不许重启）⇒ 端点面 SKIP；模块面已由 A/B/C 段逐条断言');
  } else {
    ok(api.contract === MOD.RENDERER_ADAPTER_CONTRACT && Array.isArray(api.adapters) && api.adapters.length === 2,
      'E7a GET /api/renderers 回契约版本 + 两档适配器', JSON.stringify((api.adapters || []).map((a) => a.id + ':' + a.available)));
    ok(api.adapters.some((a) => a.id === MOD.REPO_RENDERER_ID && a.available === true)
      && api.adapters.some((a) => a.id === MOD.EXTERNAL_RENDERER_ID && a.available === false),
      'E7b 枚举面如实回报可用性（本仓 true / 外部未配 false）', JSON.stringify(api.selection));
    ok(api.selection && api.selection.skipped === false && api.selection.id === MOD.REPO_RENDERER_ID,
      'E7c 缺省选择 = 本仓档 mount', JSON.stringify(api.selection));
    ok(api.upstreamInRepo === false, 'E7d 枚举面显式声明"仓内不再内置上游产物"');
  }
}

/* ══════════════════════════ F：变异自证 ══════════════════════════ */
/* 期望红集是**先写下来**的（写在注释里就是推导过程），再跑；跑出来不等 ⇒ 本段自己红。
   推导依据：每个变异只动一处，且每一处只被一至两条断言读到。
   M1 `if (embed) id = ''` ⇒ false ⇒ 被嵌入时落到本仓档 ⇒ 只有 B3a 读"嵌入 ⇒ skip"（B3b/B3c/B3d 读 reason/create/notice，都会跟着变）
      ⇒ 期望 {B3a,B3b,B3c,B3d}
   M2 外部"未配置"分支改成 available:true ⇒ 嵌入档与顶层档都走外部导航；B3a–B3d 变，另外
      A4f（默认注册表）不受影响；E 段不参与变异 ⇒ 期望 {B3a,B3b,B3c,B3d}
      另：C4a/C4b（外部档 probe 不过 ⇒ SKIP）也读这条分支 ⇒ 期望 {B3a..B3d, C4a, C4b}
   M3 去掉 finally 里的 dispose 调用 ⇒ C2b（dispose 恰一次）、C7b（失败路径仍 dispose）变红；
      C1b/C1c（含 dispose 的顺序）也变红 ⇒ 期望 {C1b, C1c, C2b, C7b}
   M4 repoTargetUrl 不再补 id ⇒ B8a/B8b/B8c/B8e 变红（B8d 只读 shell） ⇒ 期望 {B8a,B8b,B8c,B8e}
   M5 externalTargetUrl 不再摘 renderer/rendererSrc ⇒ B4b 变红（B9a/B9b 不经过摘除分支…B9b 的 query 里没有 renderer*）
      ⇒ 期望 {B4b} */
const MUTATIONS = [
  { id: 'M1', why: '被宿主嵌入时偷偷回落本仓档（点名要上游，却给自家渲染器）', expect: ['B3a', 'B3b', 'B3c', 'B3d'],
    apply: (t) => t.replace('    else if (embed) id = \'\';', '    else if (false) id = \'\';') },
  { id: 'M2', why: '外部来源没配也说"可用"（把 SKIP 洗成"已就绪"）', expect: ['B2a', 'B2b', 'B2c', 'B3a', 'B3b', 'B3c', 'B3d', 'C4a', 'C4b'],
    apply: (t) => t.replace("        return {\n          available: false,\n          reason: 'external-source-not-configured',", "        return {\n          available: true,\n          reason: '',") },
  { id: 'M3', why: '去掉 finally 里的 dispose（资源不释放，顺序纪律形同虚设）', expect: ['C1a', 'C1b', 'C1c', 'C2b', 'C7b', 'C10b'],
    apply: (t) => t.replace('if (plan.keepAlive !== true && state !== \'disposed\') { await inst.dispose(); state = \'disposed\'; note(\'dispose\'); }', 'if (false) { await inst.dispose(); state = \'disposed\'; note(\'dispose\'); }') },
  { id: 'M4', why: '窄桥不再补 id（本仓档挂不上任何语料包）', expect: ['B8a', 'B8b', 'B8c', 'B8e'],
    apply: (t) => t.replace("  if (itemId && !has('id')) upsert('id', encodeURIComponent(itemId));", '  if (false && itemId) upsert(\'id\', encodeURIComponent(itemId));') },
  { id: 'M5', why: '把本层控制参数（renderer/rendererSrc）转发给外部渲染器', expect: ['B4b'],
    apply: (t) => t.replace("    return k !== 'renderer' && k !== 'renderersrc';", '    return true;') },
];

async function mutationChecks() {
  console.log('\n== F 变异自证（同一套判据跑变异副本；期望红集 == 实际红集） ==');
  const base = await runLogicChecks(MOD);
  const RED_IDS = [...base.keys()];
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-renderer-adapter-'));
  let bad = 0;
  for (const m of MUTATIONS) {
    const dir = path.join(TMP, m.id);
    fs.mkdirSync(dir, { recursive: true });
    const raw = fs.readFileSync(SRC, 'utf8');
    const mutated = m.apply(raw);
    const applied = mutated !== raw;
    fs.writeFileSync(path.join(dir, 'renderer-adapter.mjs'), mutated);
    let actual = [], err = '';
    if (applied) {
      try {
        const MM = await import(pathToFileURL(path.join(dir, 'renderer-adapter.mjs')).href);
        const r = await runLogicChecks(MM);
        actual = RED_IDS.filter((id) => { const x = r.get(id); return x ? !x.ok : false; });
      } catch (e) { err = (e && e.message) || String(e); actual = ['<异常>']; }
    }
    const expect = [...m.expect].sort(), got = [...actual].sort();
    const same = applied && !err && expect.join(',') === got.join(',');
    if (!same) bad++;
    console.log('  ' + (same ? '✓' : '✗') + ' ' + m.id + ' ' + m.why);
    console.log('      变异已落地=' + applied + ' 期望红集=[' + expect.join(' ') + '] 实际红集=[' + got.join(' ') + ']' + (err ? ' 异常：' + err : ''));
    fs.writeFileSync(path.join(dir, 'result.txt'), 'applied=' + applied + ' expect=' + expect.join(',') + ' actual=' + got.join(',') + '\n');
  }
  ok(bad === 0, 'F 变异自证：' + MUTATIONS.length + ' 组全部「期望红集 == 实际红集」', bad ? bad + ' 组不符（见上）' : '变异副本落在 ' + TMP);
}

/** 适配器装载页自身的候选（`:8902` 四个挂载点 + GitHub Pages 的两种布局都覆盖）。
 *  ⚠ 别拿 `probeRepoPages` 的结果当本页 URL：那返回的是**本仓渲染器页**（`/webloader/` 或站点根 `demo.html`），
 *  而 G 段要逛的是**适配器装载页**（`demo/renderer/index.html`）。第一版就踩了这个坑（读数全是 null）。 */
async function probeAdapterPage(base) {
  const cands = ['/wallpaper-engine-webgl/renderer/index.html', '/demo/renderer/index.html', '/WEwebLoader/renderer/index.html', '/renderer/index.html'];
  const tried = [];
  for (const c of cands) {
    let url = c;
    try { url = new URL(c, base).href; } catch (e) { /* 原样 */ }
    try {
      const r = await fetch(url);
      tried.push({ url, status: r.status });
      if (r.ok) {
        const html = await r.text();
        if (/adapter-boot\.mjs/.test(html)) return { available: true, url, tried };
      }
    } catch (e) { tried.push({ url, status: 0, error: (e && e.message) || String(e) }); }
  }
  return { available: false, url: '', tried };
}

/* ══════════════════════════ G：真机（浏览器；首帧那一条才是 GL 前置） ══════════════════════════ */
/* 为什么**不整体** GL 前置：本批最要紧的产品行为是"产物缺失 ⇒ **明确 SKIP 面板**（不是白屏、不是崩）"
   —— 那一条**不需要 WebGL2**，是纯 DOM/决策层的事实 ⇒ 必须在真浏览器里也钉住。
   只有"渲染器真的出了首帧"（`data-mpw-adapter-state=ready`）才需要 GL：本机无头 Firefox 建不了 GL
   （`tests/_gl-browser.mjs` 文件头记录过）⇒ 那一条如实 SKIP，绝不把"环境缺能力"写成"产品坏"。 */
async function browserChecks() {
  console.log('\n== G 真机（浏览器）：SKIP 面板 / 挂载接线（不需要 GL）+ 首帧（需要 GL） ==');
  const page0 = await probeAdapterPage(BENCH_URL);
  if (!page0.available) return sk('G 段', '适配器装载页不可达/不可认（探测：' + JSON.stringify((page0.tried || []).map((t) => t.url + '→' + t.status)) + '）');
  console.log('  适配器装载页 = ' + page0.url + '（探测 ' + JSON.stringify((page0.tried || []).map((t) => t.url + '→' + t.status)) + '）');
  let pw = null, H = null;
  try {
    H = await import('./_gl-browser.mjs');
    const require_ = (await import('node:module')).createRequire(path.join(ROOT, 'package.json'));
    pw = require_(H.findPlaywright());
  } catch (e) { return sk('G 段', '拿不到 playwright：' + ((e && e.message) || e)); }
  let browser = null;
  try {
    const firefox = (pw.default && pw.default.firefox) || pw.firefox;
    const launched = await H.launchGLBrowser(firefox);
    browser = launched.browser;
    const gl = await H.glCapability(browser);
    console.log('  ' + launched.launchNote + ' webgl2=' + gl.webgl2);

    /* ── G1 决策层（无 GL 也成立）：显式 `?renderer=upstream` + 无外部来源 ⇒ **明确 SKIP 面板** ── */
    const page = await browser.newPage();
    const pageErrs = [];
    page.on('pageerror', (e) => pageErrs.push(String(e && e.message || e)));
    const upUrl = new URL(page0.url);
    for (const [k, v] of Object.entries({ renderer: 'upstream', type: 'scene', src: '1' })) upUrl.searchParams.set(k, v);
    await page.goto(upUrl.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => !!document.documentElement.getAttribute('data-mpw-adapter-state'), null, { timeout: 15000 }).catch(() => {});
    const skipRead = await page.evaluate(() => {
      const el = document.getElementById('notice');
      return {
        state: document.documentElement.getAttribute('data-mpw-adapter-state'),
        id: document.documentElement.getAttribute('data-mpw-adapter-id'),
        action: document.documentElement.getAttribute('data-mpw-adapter-action'),
        reason: document.documentElement.getAttribute('data-mpw-adapter-reason'),
        noticeVisible: !!el && !el.hidden,
        notice: (el && el.textContent) || '',
        frames: document.querySelectorAll('iframe[data-mpw-adapter-frame]').length,
      };
    });
    console.log('  G1 读数：' + JSON.stringify({ state: skipRead.state, reason: skipRead.reason, frames: skipRead.frames, visible: skipRead.noticeVisible }));
    ok(skipRead.state === 'skip' && skipRead.reason === 'external-source-not-configured' && skipRead.frames === 0,
      'G1 上游档缺产物 ⇒ 真浏览器里也是 **明确 SKIP**（state=skip / reason 逐字 / 不建任何渲染帧）', JSON.stringify({ state: skipRead.state, reason: skipRead.reason, frames: skipRead.frames }));
    ok(skipRead.noticeVisible && /SKIP/.test(skipRead.notice) && /rendererSrc/.test(skipRead.notice),
      'G2 SKIP 面板**看得见**且含 SKIP + 外部来源配置指引（不是白屏、不是静默通过）', skipRead.notice.slice(0, 90));

    /* ── G3 挂载接线（无 GL 也成立）：`?renderer=repo` ⇒ 容器内装载一个适配器帧 ── */
    const repoUrl = new URL(page0.url);
    for (const [k, v] of Object.entries({ renderer: 'repo', type: 'scene', src: '1' })) repoUrl.searchParams.set(k, v);
    await page.goto(repoUrl.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => document.documentElement.getAttribute('data-mpw-adapter-action') === 'mount', null, { timeout: 20000 }).catch(() => {});
    const mountRead = await page.evaluate(() => {
      const f = document.querySelector('iframe[data-mpw-adapter-frame]');
      return {
        state: document.documentElement.getAttribute('data-mpw-adapter-state'),
        id: document.documentElement.getAttribute('data-mpw-adapter-id'),
        action: document.documentElement.getAttribute('data-mpw-adapter-action'),
        reason: document.documentElement.getAttribute('data-mpw-adapter-reason'),
        frames: document.querySelectorAll('iframe[data-mpw-adapter-frame]').length,
        src: f ? f.getAttribute('src') : null,
      };
    });
    console.log('  G3 读数：' + JSON.stringify(mountRead));
    ok(mountRead.id === MOD.REPO_RENDERER_ID && mountRead.action === MOD.RENDERER_ACTION.MOUNT && mountRead.frames === 1 && /\/webloader\//.test(String(mountRead.src)),
      'G3 本仓档 ⇒ 容器内装载一个适配器帧，目标落在真服务上的本仓渲染器页（action=mount / src 带 /webloader/）', JSON.stringify({ id: mountRead.id, action: mountRead.action, frames: mountRead.frames, src: String(mountRead.src).slice(0, 70) }));

    /* ── G4 装载就绪（**GL 前置**）：渲染器自己发布握手面 ⇒ state=ready / handshake=1；G4b 才是真·出画 ── */
    if (!gl.webgl2) {
      console.log('  ~ SKIP G4（装载就绪 + 真·出画 G4b）—— 本机浏览器无 WebGL2（' + H.glSkipWhy() + '）；同页读数 ' + JSON.stringify({ state: mountRead.state, reason: mountRead.reason }));
      ok(mountRead.state !== 'error', 'G4 前置：无 GL 时驱动器**不崩**（state 是 degraded/loading 而不是 error）—— 环境缺能力不许写成产品坏', 'state=' + mountRead.state + ' reason=' + mountRead.reason);
    } else {
      await page.waitForFunction(() => document.documentElement.getAttribute('data-mpw-adapter-state') === 'ready', null, { timeout: 40000 }).catch(() => {});
      const ready = await page.evaluate(() => ({
        state: document.documentElement.getAttribute('data-mpw-adapter-state'),
        handshake: document.documentElement.getAttribute('data-mpw-adapter-handshake'),
      }));
      ok(ready.state === 'ready' && ready.handshake === '1',
        'G4 装载就绪信号 = data-mpw-adapter-state=ready + data-mpw-adapter-handshake=1（**握手面**，本页不代发；它不等于出画）', JSON.stringify(ready));
      /* G4b 才是"真的出画"：帧**里面**必须已经出现本仓渲染器的活档位读数或一块真尺寸画布
         （300×150 = 没建 GL 的空画布，不算）。GL 前置 ⇒ 无 GL 时上面已经 SKIP 掉了。 */
      const drew = await page.evaluate(() => {
        const f = document.querySelector('iframe[data-mpw-adapter-frame]');
        try {
          const w = f && f.contentWindow;
          const c = w && w.document && w.document.querySelector('canvas');
          return { live: !!(w && w.__mpwLiveRes), canvas: c ? (c.width + 'x' + c.height) : null };
        } catch (e) { return { err: String(e && e.message || e) }; }
      });
      ok(!!drew.live || (drew.canvas && !/^300x150$/.test(drew.canvas)),
        'G4b **真·出画**（GL 前置）：帧内已发布 __mpwLiveRes **或**画布已非 300×150 空画布', JSON.stringify(drew));
    }
    ok(pageErrs.length === 0, 'G5 整轮顶层页 0 个未捕获脚本错（SKIP 与装载两条路都不许抛）', JSON.stringify(pageErrs.slice(0, 3)));
    await page.close();
  } catch (e) {
    sk('G 段', '浏览器段异常：' + ((e && e.message) || e));
  } finally {
    if (browser) { try { await H.closeQuiet(browser); } catch (e) { /* ignore */ } }
  }
}

/* ══════════════════════════ 主流程 ══════════════════════════ */
console.log('== A/B/C 契约 · 注册表 · 选择开关 · 生命周期（模块层） ==');
const logic = await runLogicChecks(MOD);
for (const id of [...logic.keys()]) { const r = logic.get(id); ok(r.ok, r.label, r.extra); }

await treeChecks();
await e2eChecks();
await mutationChecks();
if (process.env.MPW_ADAPTER_SKIP_BROWSER !== '1') await browserChecks();

console.log('\n── 汇总：PASS=' + pass + ' FAIL=' + fail + ' SKIP=' + skipN + ' ──');
if (fail > 0) { console.log('（本判据能失败：F 段变异自证就是"改坏必红"的自证；D 段是"产物回来必红"的反向钉子）'); process.exit(1); }
