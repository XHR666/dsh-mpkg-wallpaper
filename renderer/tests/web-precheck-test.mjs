// web-precheck-test.mjs —— Web 壁纸**挂载前预检**（插件 `probeWebWallpaper()` 的消费侧那一半）
//
// 覆盖：
//   A 纯函数 `webPrecheckPlan()` / `isSkeletonAssetName()` / `externalRefsInHtml()` 逐值对账
//     （与 `dsh-mpkg-wallpaper/docs/WEB-WALLPAPER.md` §3.4 同语义：递归 ≤3 层、入口 HTML 只读前 256 KB、
//      外链排除 localhost / 127.0.0.1 / [::1]、证据各最多 8 条）；
//   B 接线：服务端 `/api/web-probe` 路由与补丁侧的消费点（静态钉住）+ 真语料读数（有 web 项才算，
//     没有 web 项就如实 SKIP —— 语料随库根变，不把"没有语料"当红）；
//   C 变异自证：把"排除本机地址"或"递归上限"改坏，上面的判据必须变红。
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ROOT } from './_root.mjs'

let pass = 0, fail = 0
const ok = (c, label, extra = '') => { if (c) { pass++; console.log('PASS ' + label + (extra ? '  ' + extra : '')) } else { fail++; console.log('FAIL ' + label + (extra ? '  ' + extra : '')) } }

const MOD = path.join(ROOT, 'core/web-precheck.mjs')
const src = fs.readFileSync(MOD, 'utf8')
const P = await import(pathToFileURL(MOD).href)
const patchSrc = fs.readFileSync(path.join(ROOT, 'demo/bench-patch.js'), 'utf8')
const serverSrc = fs.readFileSync(path.join(ROOT, 'server/we-scene-demo-server-8902.mjs'), 'utf8')

console.log('== A 纯函数逐值对账 ==')
{
  const files = [
    { name: 'index.html', path: 'index.html', depth: 0 },
    { name: 'char.skel', path: 'assets/char.skel', depth: 1 },
    { name: 'model.atlas', path: 'assets/model.atlas', depth: 1 },
    { name: 'Live2DModel.json', path: 'live2d/Live2DModel.json', depth: 2 },
    { name: 'deep.skel', path: 'a/b/c/d/deep.skel', depth: 4 },     // 超 3 层 ⇒ 不算
    { name: 'bg.png', path: 'bg.png', depth: 0 },
  ]
  const p = P.webPrecheckPlan({ files, entryHtml: '<html><script src="https://cdn.example.com/sdk.js"></script></html>', entryFile: 'index.html' })
  ok(p.heavy === true && p.heavyHits.join(',') === 'assets/char.skel,assets/model.atlas,live2d/Live2DModel.json',
    'A1 heavy：`.skel`/`.atlas` 后缀与名字含 live2d 的资产都算，**递归 >3 层的 deep.skel 不算**', JSON.stringify(p.heavyHits))
  ok(p.external === true && p.externalRefs.length === 1 && p.externalRefs[0] === 'https://cdn.example.com/sdk.js',
    'A2 external：入口 HTML 里的外链被抓到（证据去重、有序）', JSON.stringify(p.externalRefs))
  ok(p.reasons.length === 2 && /骨骼动画资产 3 个/.test(p.reasons[0]) && /外网资源 1 处/.test(p.reasons[1]),
    'A3 reasons 与插件侧同款文案结构（可直接当悬停说明）', JSON.stringify(p.reasons))
  ok(p.limits.depth === 3 && p.limits.bytes === 262144 && p.limits.hits === 8 && p.limits.refs === 8,
    'A4 阈值与插件侧一致（depth 3 / 256 KB / hits 8 / refs 8）', JSON.stringify(p.limits))
}
{
  const local = P.externalRefsInHtml('<img src="http://127.0.0.1:8902/a.png"><script src="http://localhost:8899/b.js"></script><a href="http://[::1]/c"></a>')
  ok(local.length === 0, 'A5 本机地址（127.0.0.1 / localhost / [::1]）**不算**外链（否则每张壁纸都会挂标记）', JSON.stringify(local))
  const mixed = P.externalRefsInHtml('http://127.0.0.1/a http://a.com/1 http://a.com/1 https://b.cn/2',
    'x')
  ok(mixed.length === 2 && mixed[0] === 'http://a.com/1' && mixed[1] === 'https://b.cn/2',
    'A6 去重 + 保序（同一条只算一次；本机地址被排除）', JSON.stringify(mixed))
  const many = P.externalRefsInHtml(Array.from({ length: 20 }, (_, i) => 'https://h' + i + '.com/x').join(' '))
  ok(many.length === 8, 'A7 证据最多 8 条（`refs` 上限）', String(many.length))
}
ok(P.isSkeletonAssetName('A.SKEL') === true && P.isSkeletonAssetName('spine-boy.png') === true &&
  P.isSkeletonAssetName('char.l2d') === true && P.isSkeletonAssetName('bg.png') === false &&
  P.isSkeletonAssetName('') === false,
  'A8 骨骼资产判定：不区分大小写、含 spine/live2d/.l2d 都算；普通图不算')
{
  const empty = P.webPrecheckPlan({ files: [], entryHtml: null })
  ok(empty.heavy === false && empty.external === false && empty.reasons.length === 0 && empty.htmlFile === null,
    'A9 空输入 ⇒ 两个标记都 false、无 reasons、htmlFile=null（不编造）')
}

console.log('== B 接线（静态钉 + 真语料） ==')
ok(/webPrecheckPlan\(/.test(serverSrc) && /'\/api\/web-probe'/.test(serverSrc),
  'B1 服务端有 `/api/web-probe` 路由且用同一份纯函数判定（判定只有一处实现）')
ok(/\/api\/web-probe\?item=/.test(patchSrc) && /__benchWebProbe/.test(patchSrc) && /data-mpw-webprobe/.test(patchSrc),
  'B2 补丁侧真的消费它：请求路由 + 机读读数 `window.__benchWebProbe` + 舞台状态片 `data-mpw-webprobe`')
ok(/probe\.heavy/.test(patchSrc) && /probe\.external/.test(patchSrc),
  'B3 两个标记都画出来（不是只取一个）')
{
  // 真语料：库根下若有 web 项，就至少问一条路由并核对形状；没有就如实 SKIP
  const base = process.env.MPW_BENCH_URL || 'http://127.0.0.1:8902'
  let reported = false
  try {
    const lib = await (await fetch(base + '/api/library')).json()
    const webs = (lib.items || []).filter((it) => String(it.type || '').toLowerCase() === 'web')
    if (!webs.length) console.log('SKIP B4 本轮库根里没有 web 项（语料随库根变，不当红）')
    else {
      const one = webs[0]
      const d = await (await fetch(base + '/api/web-probe?item=' + encodeURIComponent(one.itemId))).json()
      const pr = d && d.probe
      ok(!!pr && pr.isWeb === true && typeof pr.heavy === 'boolean' && typeof pr.external === 'boolean' && Array.isArray(pr.reasons),
        'B4 真库条目：路由回 `{probe:{isWeb,heavy,external,reasons,heavyHits,externalRefs,htmlFile}}`',
        JSON.stringify({ item: one.itemId, heavy: pr && pr.heavy, external: pr && pr.external, refs: pr && pr.externalRefs }))
      reported = true
      // 扫描全部 web 项：至少能对上"有外链 ⇒ external"的一致性（同一条读数自洽）
      const bad = []
      for (const it of webs.slice(0, 8)) {
        const r = await (await fetch(base + '/api/web-probe?item=' + encodeURIComponent(it.itemId))).json()
        const q = r && r.probe
        if (!q) { bad.push(it.itemId + ':no-probe'); continue }
        if (q.external !== (q.externalRefs.length > 0)) bad.push(it.itemId + ':external-vs-refs')
        if (q.heavy !== (q.heavyHits.length > 0)) bad.push(it.itemId + ':heavy-vs-hits')
        if (q.external && !q.reasons.length) bad.push(it.itemId + ':external-without-reason')
      }
      ok(bad.length === 0, 'B5 每个 web 项：标记与证据一致（external⇔refs>0、heavy⇔hits>0、有标记必有 reasons）', bad.join(' | ') || String(webs.length) + ' 项')
    }
  } catch (e) {
    console.log('SKIP B4/B5 测试台不可达（' + String(e.message || e).slice(0, 60) + '）')
  }
  void reported
}

console.log('== C 变异自证（只改内存里的副本） ==')
{
  const mutLocal = src.replace("if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1') continue", '')
  ok(mutLocal !== src, 'C1 变异①锚点命中（去掉"本机地址不算外链"）')
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'mpw-webpre-'))
  const f1 = path.join(dir, 'mut-local.mjs')
  fs.writeFileSync(f1, mutLocal)
  const M1 = await import(pathToFileURL(f1).href)
  ok(M1.externalRefsInHtml('http://127.0.0.1:8902/a.png').length > 0,
    'C2 ★变异①生效：A5（本机地址不算外链）在变异体里必红', JSON.stringify(M1.externalRefsInHtml('http://127.0.0.1:8902/a.png')))
  const mutDepth = src.replace('const inDepth = norm.filter((f) => f.depth <= lim.depth)', 'const inDepth = norm')
  ok(mutDepth !== src, 'C3 变异②锚点命中（递归上限失效）')
  const f2 = path.join(dir, 'mut-depth.mjs')
  fs.writeFileSync(f2, mutDepth)
  const M2 = await import(pathToFileURL(f2).href)
  const deepHit = M2.webPrecheckPlan({ files: [{ name: 'deep.skel', path: 'a/b/c/d/deep.skel', depth: 4 }], entryHtml: null })
  ok(deepHit.heavy === true, 'C4 ★变异②生效：A1（>3 层不算）在变异体里必红', JSON.stringify(deepHit.heavyHits))
  try { fs.rmSync(dir, { recursive: true, force: true }) } catch (e) { /* 清理失败不影响判定 */ }
}

console.log(`\n── 汇总：PASS=${pass} FAIL=${fail}`)
process.exitCode = fail ? 1 : 0
