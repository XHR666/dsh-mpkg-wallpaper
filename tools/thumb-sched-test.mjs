// tools/thumb-sched-test.mjs —— 扫描页缩略图 OOM 防护调度器判据（2026-10-25 任务 1.2）
//
// 契约（lib/client.js 的 MPW-THUMB-SCHED 块；只约束 sched 档元素，当前 = 扫描页网格）：
//   C1 并发上限：带 src 在途的受管元素 ≤ N（默认 4）；槽位释放即按 FIFO 续泵
//   C2 离屏释放：release 必真摘 src（视频另 load() 复位），槽位立即归还队列
//   C3 在途超时：15s 超时按失败推进候选链（换 src 重武装；耗尽 ⇒ 判死 + 槽位让出）
//   C4 重入口 LRU：条目 ≤300 且估算字节 ≤64MB 双上限，超限淘汰最旧
//   C5 重试上限：整条候选链失败过 ⇒ 回屏/重试只允许一次（再失败就是终局占位）
//   C6 自动降档：performance.memory 超阈值 ⇒ 并发降到 2（只降一次）
//   C7 非受管不变：没有 data-mpw-thumb-queued 的元素（设置页网格）不被调度器收编
//   C8 scan 装配：只 kick 非 standby 元素；standby 视频留待 Fail 提升（既有优先级不变）
// 变异自证（隔离副本；期望红集 == 实际红集，逐条相等）：
//   M-conc    并发上限 4→100 ⇒ C1 红
//   M-release 释放不摘 src ⇒ C2 红
//   M-lru     LRU 条目上限 300→100000 ⇒ C4 红
//   M-retry   重试一次上限打掉（恒可重试）⇒ C5 红
//   M-timeout 超时推进断链 ⇒ C3 红
// 复现: node tools/thumb-sched-test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
let pass = 0, fail = 0;
const ok = (n, cond, d) => {
  if (cond) { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')); }
  else { fail++; console.log('  ✗ ' + n + (d ? '  → ' + d : '')); }
};
const { loadPlugin, cancelWorldTimers } = await import('./_stub.mjs');
const CLEAR = ['__mpwThumbSched', '__mpwClientLoaded', '__mpwRegistered', '__mpwGlobalWired',
  '__mpwInlineWatcher', '__mpwStyleWatch', '__mpwBuildCss', '__mpwAppliedOnce', '__mpwBsTabState', '__mpwBsScanKick', '__mpwBsScanMore'];
const reset = () => { for (const k of CLEAR) { try { delete globalThis[k]; } catch {} } };

/** 迷你元素：属性表 + tagName + isConnected；box 有 querySelector("img,video")/querySelectorAll。 */
function mkEl(tag, attrs = {}) {
  const el = {
    tagName: String(tag).toUpperCase(),
    __attrs: new Map(Object.entries(attrs)),
    isConnected: true, parentElement: null,
    style: { setProperty() {}, removeProperty() {} },
    setAttribute(k, v) { this.__attrs.set(String(k), String(v)); },
    getAttribute(k) { const v = this.__attrs.get(String(k)); return v === undefined ? null : String(v); },
    removeAttribute(k) { this.__attrs.delete(String(k)); },
    hasAttribute(k) { return this.__attrs.has(String(k)); },
  };
  return el;
}
function mkBox(mediaEls) {
  const box = mkEl('div');
  box.mediaEls = mediaEls;
  box.querySelectorAll = (sel) => {
    const s = String(sel).replace(/[\[\]"']/g, '');
    if (s === 'img,video' || s === 'video,img') return box.mediaEls.slice();
    if (s.indexOf('data-mpw-thumb-queued') >= 0 && s.indexOf('standby') >= 0) {
      return box.mediaEls.filter((m) => m.getAttribute('data-mpw-thumb-queued') !== null && m.getAttribute('data-mpw-thumb-standby') === '1');
    }
    return [];
  };
  box.querySelector = () => null; // 占位元素判据不涉及
  for (const m of mediaEls) m.parentElement = box;
  return box;
}
/** 带候选载荷的 img 元素（sched 档形态：queued 标记 + 载荷 + 无 src）。 */
const mkThumb = (urls, extra = {}) => mkEl('img', Object.assign({
  'data-mpw-thumb-list': JSON.stringify({ urls, i: 0 }),
  'data-mpw-thumb-queued': '',
}, extra));
const SRC = () => globalThis.__mpwThumbSched;

/** 一个块一个世界：loadPlugin 后调度器出口挂在 globalThis（模块级状态随世界全新）。 */
function freshSched() {
  reset();
  loadPlugin({ quiet: true });
  return SRC();
}

console.log('== C. 调度器契约 ==');
{
  const S = freshSched();
  ok('W1 调度器出口在 globalThis（kick/release/pump/scan/timeout/done/note/stats 函数 + lru 表）',
    !!S && ['kick', 'release', 'pump', 'scan', 'timeout', 'done', 'note', 'stats'].every((k) => typeof S[k] === 'function')
      && !!S.lru && typeof S.lru.has === 'function',
    S ? Object.keys(S).join(',') : 'missing');

  // C1 并发上限 + FIFO 续泵
  {
    const S1 = freshSched();
    const els = Array.from({ length: 30 }, (_, i) => mkThumb(['u' + i + '-a', 'u' + i + '-b']));
    els.forEach((el) => S1.kick(el));
    let st = S1.stats();
    ok('C1a kick 30 ⇒ 在途 == 上限(4)，队列余 26', st.running === 4 && st.q === 26, JSON.stringify(st));
    ok('C1b 起载序 = FIFO 前 4（src 已派）', els.slice(0, 4).every((el) => el.getAttribute('src')) && els.slice(4).every((el) => !el.getAttribute('src')), '');
    S1.done(els[1]);
    st = S1.stats();
    ok('C1c 释放一槽 ⇒ 恰好续起一个（els[4] 拿到 src）', st.running === 4 && !!els[4].getAttribute('src') && !els[5].getAttribute('src'), JSON.stringify(st));
  }

  // C2 离屏释放：真摘 src + 槽位归还
  {
    const S2 = freshSched();
    const els = Array.from({ length: 8 }, (_, i) => mkThumb(['v' + i]));
    const vid = mkThumb(['w0']); vid.tagName = 'VIDEO';
    vid.load = function () { this.__loaded = true; };
    els.slice(0, 3).forEach((el) => S2.kick(el));
    S2.kick(vid);                       // 第 4 槽给视频（在途才能真正释放）
    els.slice(3).forEach((el) => S2.kick(el));   // 其余排队
    ok('C2-前置 视频 in 途（已派 src）', !!vid.getAttribute('src') && !els[3].getAttribute('src'), '');
    S2.release(vid);
    ok('C2c 视频释放不抛错（load 复位被调用 + src 摘除）', vid.__loaded === true && vid.getAttribute('src') === null, '');
    ok('C2b 槽位归还 ⇒ 队首 els[3] 被起载', S2.stats().running === 4 && !!els[3].getAttribute('src'), JSON.stringify(S2.stats()));
    const before = els[0].getAttribute('src');
    S2.release(els[0]);
    ok('C2a release ⇒ src 被真摘（旧 src=' + before + '）', before && els[0].getAttribute('src') === null, '');
    ok('C2b2 再让一槽 ⇒ 队列里的 els[4] 被起载', S2.stats().running === 4 && !!els[4].getAttribute('src'), JSON.stringify(S2.stats()));
  }

  // C3 在途超时：推进候选链；耗尽 ⇒ 判死并腾槽
  {
    const S3 = freshSched();
    const el = mkThumb(['t0', 't1']);
    mkBox([el]);
    S3.kick(el);
    ok('C3a 起载第一候选', el.getAttribute('src') === 't0', '');
    S3.timeout(el);
    ok('C3b 超时 ⇒ 推进到下一候选（src 换、槽位保持）', el.getAttribute('src') === 't1' && S3.stats().running === 1, '');
    S3.timeout(el);
    ok('C3c 候选耗尽 ⇒ 判死（failed 标记）+ 槽位让出', el.getAttribute('data-mpw-thumb-failed') === '1' && S3.stats().running === 0, JSON.stringify(S3.stats()));
  }

  // C4 重入口 LRU：条目/字节双上限
  {
    const S4 = freshSched();
    for (let i = 0; i < 305; i++) {
      const el = mkThumb(['k' + i]);
      el.__attrs.set('data-mpw-thumb-list', JSON.stringify({ urls: ['k' + i], i: i % 3 }));
      S4.note(el);
    }
    let st = S4.stats();
    ok('C4a 条目上限：305 条记满 ⇒ LRU 收口在 300', st.lru === 300, 'lru=' + st.lru);
    ok('C4b 淘汰的是最旧（k0 不在、k304 在）', !S4.lru.has('k0') && S4.lru.has('k304'), '');
    const big = mkThumb(['x'.repeat(40 * 1024 * 1024)]);
    S4.note(big);
    st = S4.stats();
    ok('C4c 字节上限：单条超大（估算 >64MB）⇒ 自身被淘汰', st.lru === 0 && st.lruBytes === 0, JSON.stringify({ lru: st.lru, bytes: st.lruBytes }));
    const small = mkThumb(['small']);
    S4.note(small);
    ok('C4d 之后小条目照常可记', S4.stats().lru === 1, '');
  }

  // C5 重试一次上限
  {
    const S5 = freshSched();
    const el = mkThumb(['r0']);
    mkBox([el]);
    S5.kick(el);                       // 起 r0
    S5.timeout(el);                    // 耗尽 ⇒ 判死
    ok('C5a 首轮失败：failed 标记在', el.getAttribute('data-mpw-thumb-failed') === '1', '');
    S5.kick(el);                       // 回屏/重试第一次
    ok('C5b 重试一次：标记被清、从头起载', el.getAttribute('data-mpw-thumb-failed') === null && el.getAttribute('src') === 'r0' && S5.stats().retries === 1, JSON.stringify(S5.stats()));
    S5.timeout(el);                    // 再耗尽
    S5.kick(el);                       // 第二次重试请求
    ok('C5c 重试上限：第二次不再起载（终局摘 src + 占位）',
      el.getAttribute('data-mpw-thumb-failed') === '1' && el.getAttribute('src') === null && S5.stats().retries === 1, JSON.stringify(S5.stats()));
  }

  // C6 自动降档（performance.memory 桩）
  {
    const perf0 = globalThis.performance;
    try {
      globalThis.performance = { memory: { usedJSHeapSize: 500 * 1024 * 1024 } };
      const S6 = freshSched();
      const els = Array.from({ length: 30 }, (_, i) => mkThumb(['h' + i]));
      els.forEach((el) => S6.kick(el));
      // done 会同步续泵：按序放掉每个在途元素 ⇒ 起载计数越过 20（observe 采样点）
      for (const el of els) { if (el.getAttribute('src')) S6.done(el); }
      ok('C6a 堆超阈值 ⇒ 自动降档（downgraded=true）', S6.stats().downgraded === true, JSON.stringify(S6.stats()));
      const els2 = Array.from({ length: 10 }, (_, i) => mkThumb(['d' + i]));
      els2.forEach((el) => S6.kick(el));
      ok('C6b 降档后并发上限 = 2', S6.stats().running <= 2, 'running=' + S6.stats().running);
    } finally { globalThis.performance = perf0; }
  }

  // C7 非受管元素不受调度
  {
    const S7 = freshSched();
    const plain = mkEl('img', { 'data-mpw-thumb-list': JSON.stringify({ urls: ['p0'], i: 0 }) });
    S7.kick(plain);
    ok('C7 无 queued 标记 ⇒ 不收编、不派 src', plain.getAttribute('src') === null && S7.stats().q === 0, '');
  }

  // C8 scan 装配：非 standby 才 kick；standby 视频留给 Fail 提升
  {
    const S8 = freshSched();
    const img = mkThumb(['s0']);
    const vid = mkThumb(['sv0']); vid.tagName = 'VIDEO'; vid.__attrs.set('data-mpw-thumb-standby', '1');
    mkBox([img, vid]);   // 同框（parentElement 挂上 ⇒ Fail 的提升扫描找得到 standby）
    const root = {
      querySelectorAll: (sel) => (String(sel) === '[data-mpw-thumb-queued]') ? [img, vid]
        : (String(sel) === '[data-mpw-thumb-box]') ? [] : [],
    };
    S8.scan(root);
    ok('C8a scan ⇒ 图候选入队起载、standby 视频不被起载', !!img.getAttribute('src') && vid.getAttribute('src') === null, '');
    S8.timeout(img); S8.timeout(img);
    ok('C8b 图链耗尽 ⇒ Fail 提升 standby 视频（兜底优先级不变）', vid.getAttribute('src') === 'sv0', 'vid=' + vid.getAttribute('src'));
  }
}

/* ---------- 变异自证（隔离副本；锚点必须恰好替换一次 —— R2） ---------- */
const CLIENT = path.join(ROOT, 'lib', 'client.js');
const src0 = fs.readFileSync(CLIENT, 'utf8');
const TMP_DIRS = [];
const mkTmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); TMP_DIRS.push(d); return d; };
process.on('exit', () => { for (const d of TMP_DIRS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} } });

async function withMutant(id, what, pairs, expectRed, runGroup) {
  const dir = mkTmp('mpw-thumb-sched-mut-');
  const f = path.join(dir, 'client.js');
  let mutated = src0;
  const applied = [];
  for (const [anchor, replacement] of pairs) {
    const n = mutated.split(anchor).length - 1;
    const next = mutated.replace(anchor, replacement);
    const okApply = n === 1 && next !== mutated && !next.includes(anchor);
    applied.push(okApply);
    mutated = next;
  }
  fs.writeFileSync(f, mutated);
  reset();
  let red = [];
  try { red = await runGroup(f); } catch (e) { red = ['THROW:' + String(e && e.message || e).slice(0, 60)]; }
  const eq = applied.every(Boolean) && JSON.stringify(red.slice().sort()) === JSON.stringify(expectRed.slice().sort());
  console.log('  ' + (eq ? 'MUTANT-RED-OK' : 'MUTANT-MISMATCH') + ' ' + id + ' ' + what);
  console.log('    期望红集=' + JSON.stringify(expectRed.slice().sort()) + ' 实际红集=' + JSON.stringify(red.slice().sort())
    + ' 变异生效=' + JSON.stringify(applied));
  if (!eq) fail++; else pass++;
}

/** 在变异副本上加载一个世界并返回调度器出口（判据直接驱动同一函数）。 */
async function schedOn(f) {
  reset();
  loadPlugin({ quiet: true, clientPath: f });
  return SRC();
}

console.log('\n== M. 变异自证（期望红集 == 实际红集，逐条相等）==');

// M-conc：并发上限打掉 ⇒ C1a（在途超限）红
await withMutant('M-conc', '并发上限 4→100（限流失效）',
  [['const MPW_THUMB_CONC_DEFAULT = 4;', 'const MPW_THUMB_CONC_DEFAULT = 100; /* M-conc */']], ['C1a'],
  async (f) => {
    const red = [];
    const S = await schedOn(f);
    const els = Array.from({ length: 30 }, (_, i) => mkThumb(['m' + i]));
    els.forEach((el) => S.kick(el));
    if (!(S.stats().running === 4 && S.stats().q === 26)) red.push('C1a');
    return red;
  });

// M-release：释放不摘 src ⇒ C2a 红（src 还在 = 位图不释放）
await withMutant('M-release', '离屏释放不摘 src（release 空转）',
  [['try { el.removeAttribute("src") } catch (e) {}\n\t\t\t\ttry { if (String(el.tagName || "").toUpperCase() === "VIDEO" && typeof el.load === "function") el.load(); } catch (e) {}',
    '/* M-release */']], ['C2a'],
  async (f) => {
    const red = [];
    const S = await schedOn(f);
    const els = Array.from({ length: 8 }, (_, i) => mkThumb(['n' + i]));
    els.forEach((el) => S.kick(el));
    const before = els[0].getAttribute('src');
    S.release(els[0]);
    if (!(before && els[0].getAttribute('src') === null)) red.push('C2a');
    return red;
  });

// M-lru：LRU 条目上限打掉 ⇒ C4a 红（缓存无界）
await withMutant('M-lru', 'LRU 条目上限 300→100000（缓存无界）',
  [['const MPW_THUMB_LRU_MAX_ENTRIES = 300;', 'const MPW_THUMB_LRU_MAX_ENTRIES = 100000; /* M-lru */']], ['C4a'],
  async (f) => {
    const red = [];
    const S = await schedOn(f);
    for (let i = 0; i < 305; i++) {
      const el = mkThumb(['k' + i]);
      el.__attrs.set('data-mpw-thumb-list', JSON.stringify({ urls: ['k' + i], i: 0 }));
      S.note(el);
    }
    if (!(S.stats().lru === 300)) red.push('C4a');
    return red;
  });

// M-retry：重试一次上限打掉（恒可重试）⇒ C5c 红
await withMutant('M-retry', '重试上限打掉（每次重kick都重走整条链）',
  [['if (box && box.getAttribute("data-mpw-thumb-retried") === "1") {', 'if (false) { /* M-retry */']], ['C5c'],
  async (f) => {
    const red = [];
    const S = await schedOn(f);
    const el = mkThumb(['r0']);
    mkBox([el]);
    S.kick(el);
    S.timeout(el);
    S.kick(el);
    const firstRetry = S.stats().retries;
    S.timeout(el);
    S.kick(el);
    if (!(firstRetry === 1 && S.stats().retries === 1 && el.getAttribute('data-mpw-thumb-failed') === '1' && el.getAttribute('src') === null)) red.push('C5c');
    return red;
  });

// M-timeout：超时推进断链 ⇒ C3b 红（超时候候选不动）
await withMutant('M-timeout', '在途超时不推进（挂死候选占用槽位）',
  [['mpwThumbSched.timeouts++;\n\t\t\t\tmpwThumbNext(el);', 'mpwThumbSched.timeouts++; /* M-timeout */']], ['C3b'],
  async (f) => {
    const red = [];
    const S = await schedOn(f);
    const el = mkThumb(['t0', 't1']);
    mkBox([el]);
    S.kick(el);
    S.timeout(el);
    if (!(el.getAttribute('src') === 't1')) red.push('C3b');
    return red;
  });

console.log('\n===== ' + pass + ' 通过 / ' + fail + ' 失败 =====');
cancelWorldTimers();
process.exit(fail ? 1 : 0);
