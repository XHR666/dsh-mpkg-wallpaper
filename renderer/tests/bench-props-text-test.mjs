// bench-props-text-test.mjs —— 属性面板富文本三条（用户第 5/6/7 条，2026-09-22）
//
//   5  图片显示两遍（作者文案里同 URL 多次出现 / 产物自己已画一张）⇒ 同一张图只渲染一遍
//   6  文案里残留字面量 `&nbsp;` ⇒ 解码收口（双重编码 `&amp;nbsp;` + 无分号 `&nbsp`）
//   7  `BV1xzpee9EAF(点击跳转)` ⇒ 变成 B 站链接 `https://b23.tv/BV1xzpee9EAF`（**走既有 link 通道**）
//
// ②(2026-09-25 issue0924a2 用户第 2 条复测)**契约更新**：
//   · 归并规则从"候选要尺寸证据（两张都 load 成功且宽高完全相同）"改成**强制归并**（身份键相等 = 同一张画面）；
//     尺寸证据降级为**只进台账**（`report().variants.evidence`：相同/不同/未知各几张）；
//   · 面板里的图有**两个来源**（产物自己渲染的 `div.prop-media img` + 属性文案 tokenize 出来的
//     `img.bench-prop-img`）⇒ 现在共用同一本账（`dedupeRowMediaImages`），真机读数从 44 张压到 7 张；
//   · "图没显示出来就把它的链接显示出来"这条兜底删除：锚内没有可见内容的链接整条不画。
//
// 判据优先用**纯函数**（`decodePropEntities` / `parsePropRichText` 都是导出的），DOM 那一半（图片去重）
// 用源码级接线 + 既有 `bench-ui-headless` 的 P 组端到端兜住。含分辨力自证。
//
// 运行：node tests/bench-props-text-test.mjs   （全过 ALL PASS，退出码 0）
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from './_root.mjs'
import { decodePropEntities, parsePropRichText, normalizeRichImageUrl, richImageKey, richImageRelation, planRichImageMode, makeRichImagePass, dedupeRichImages } from '../demo/bench-patch.js'

let pass = 0, fail = 0
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ✓ ' + n + (d ? '  [' + d + ']' : '')) } else { fail++; console.log('  ✗ ' + n + (d ? '  [' + d + ']' : '')) } }
const SRC = fs.readFileSync(path.join(ROOT, 'demo', 'bench-patch.js'), 'utf8')
const NBSP = '\u00a0'
const flat = (t) => (t || []).map((x) => x.k + (x.v !== undefined ? ':' + x.v : '') + (x.href ? ':' + x.href : '') + (x.src ? ':' + x.src : '')).join('|')

console.log('== 6 `&nbsp;` 残留收口（含双重编码与无分号形态）==')
ok('6a 普通 `&nbsp;` 解成不换行空格（不再是字面量）',
  decodePropEntities('a&nbsp;b') === 'a' + NBSP + 'b', JSON.stringify(decodePropEntities('a&nbsp;b')))
ok('6b **双重编码** `&amp;nbsp;` 也解掉（旧实现只解一遍 ⇒ 面板上就显示 `&nbsp;`）',
  decodePropEntities('&amp;nbsp;') === NBSP, JSON.stringify(decodePropEntities('&amp;nbsp;')))
ok('6c **无分号**形态 `&nbsp` 也解掉（作者手写文案里很常见：行尾/空格/标点前）',
  decodePropEntities('x&nbsp') === 'x' + NBSP && decodePropEntities('x&nbsp y') === 'x' + NBSP + ' y'
  && decodePropEntities('x&nbsp;') === 'x' + NBSP, JSON.stringify([decodePropEntities('x&nbsp'), decodePropEntities('x&nbsp y')]))
ok('6c2 **不猜**：`&nbspy` 这种后面紧跟字母数字的形态保持字面量（可能是别的实体名，猜错更糟）',
  decodePropEntities('x&nbspy') === 'x&nbspy', JSON.stringify(decodePropEntities('x&nbspy')))
ok('6d 其它空白类实体一并覆盖（`&ensp;` / `&emsp;` / `&thinsp;` 及无分号）',
  decodePropEntities('&ensp;&emsp;&thinsp;') === '\u2002\u2003\u2009' && decodePropEntities('&ensp') === '\u2002')
ok('6e **不过度解码**：`&amp;lt;` 仍只解一层（作者本意要显示 `&lt;` 时不能被改成 `<`）',
  decodePropEntities('&amp;lt;') === '&lt;', JSON.stringify(decodePropEntities('&amp;lt;')))
ok('6f 数字实体照旧（`&#160;` = NBSP）与未知实体保持原样（不猜）',
  decodePropEntities('&#160;') === NBSP && decodePropEntities('&foo;') === '&foo;')

console.log('\n== 7 `BV…` 变 B 站链接（走既有 link 通道）==')
{
  const t = parsePropRichText('看这个 BV1xzpee9EAF(点击跳转) 很好')
  const links = t.filter((x) => x.k === 'link')
  const texts = t.filter((x) => x.k === 'text').map((x) => x.v).join('')
  ok('7a 生成了一个 link token，href = `https://b23.tv/<BV>`，host = `b23.tv`',
    links.length === 1 && links[0].href === 'https://b23.tv/BV1xzpee9EAF' && links[0].host === 'b23.tv',
    JSON.stringify(links.map((l) => ({ href: l.href, host: l.host }))))
  ok('7b 链接文字就是 BV 号本身，前后普通文字不丢',
    flat(links[0].kids) === 'text:BV1xzpee9EAF' && texts.indexOf('看这个') === 0 && texts.indexOf('很好') > 0,
    JSON.stringify({ kids: flat(links[0].kids), texts: texts }))
  ok('7c 不是 BV 形态的一律不动（不模糊猜测：长度/字符集不符就不转）',
    parsePropRichText('BV123 与 BV1xzpee9EA 都不是').filter((x) => x.k === 'link').length === 0)
  ok('7d 安全性回归：`javascript:` 链接仍被拒（新通道没有破坏既有白名单）',
    parsePropRichText('<a href="javascript:alert(1)">x</a>').filter((x) => x.k === 'link').length === 0)
  ok('7e `https://` 链接照旧放行（白名单没被顺手收紧）',
    parsePropRichText('<a href="https://example.com/a">x</a>').filter((x) => x.k === 'link').length === 1)
}

console.log('\n== 5 图片去重（用户第 3 档「任何一张图在整个面板里只画一次」+ 三层回退；规则可判定）==')
{
  /* 规则（实现在 `demo/bench-patch.js` 模块顶部，函数名与判据一一对应；报告
     `reports/bench-propimg-dedup-20260924.md` 有改前/改后读数与"没验证的"）：
       ⓐ `normalizeRichImageUrl` 相同（逐字节同一资源）⇒ **无条件**只画一遍；
       ⓑ `richImageKey` 相同（只差**白名单**里的尺寸/格式/水印类参数或后缀，图片 id 不动）⇒ 候选；
       ⓒ 候选要**尺寸证据**：两张都 load 成功且 naturalWidth/naturalHeight 相同才归并；
          尺寸不同 ⇒ **一定不归并**；证据拿不到（加载失败 / 本趟超时）⇒ **不归并**。
     反例护栏（上一轮实测）：按 `host+path` 归并会把 `m.qpic.cn/psc` 同一个 path 下的 **4 张真图**
     （身份在 query 的第一个无名段里）压成 1 张 ⇒ 本节逐条断言"一张都不许少"。 */
  const U = 'http://photg.example/psc?/USER/IMGAAA'
  const V = 'http://photg.example/psc?/USER/IMGBBB'
  /** 真语料 `allwallpaper/dd/3660962877` 里 `m.qpic.cn/psc` 同一个 path 下的 **4 张不同图**（原样抄录）。 */
  const QPIC4 = [
    'http://m.qpic.cn/psc?/V54UQdlK3naUxA4J47wN15WVMc4bjxtJ/TmEUgtj9EK6.7V8ajmQrEBsexJSlhMg7OiSbTz*Vq3QACEYkZ8E7D9iP.Od05WVwf*Zty7Ju024B0os.zP7PIbqo.3*UAdtYXXx9jjaGF1A!/b&bo=4gHXAQAAAAABBxU!&rf=viewer_4',
    'http://m.qpic.cn/psc?/V54UQdlK3naUxA4J47wN15WVMc4bjxtJ/TmEUgtj9EK6.7V8ajmQrEOlNbbR8QyH.V3DOKIQNRif85YCGLfi9pSXuaZqxdq9vSR5s5uHZgJLf1DqrxMxRMTafCMS1IHiigGZSLlOCyvE!/mnull&bo=SAFIAUgBSAEDByI!&rf=photolist&t=5',
    'http://m.qpic.cn/psc?/V54UQdlK3naUxA4J47wN15WVMc4bjxtJ/TmEUgtj9EK6.7V8ajmQrEMQXeDhXW2lYWF93UJF.nZ.2WxR10Rb.mdx71GJTB0aXalAzL1BM3tkUxAZw2oSRRgvDWflCZlln3Eou6lAIMO8!/mnull&bo=6APXAegD1wEDByI!&rf=photolist&t=5',
    'http://m.qpic.cn/psc?/V54UQdlK3naUxA4J47wN15WVMc4bjxtJ/TmEUgtj9EK6.7V8ajmQrEK.dTR0S5PnqaxucocfhhjUEzkloqXuqp0JsbUmHwzB1hnBAwn4iULfdmGz9S2FcNNdUWClXxYZKe6DMP4VWV5M!/mnull&bo=AQF3AAEBdwADByI!&rf=photolist&t=5',
  ]
  /** 同一形态再补到 **6 张**（父任务书里的"6 张不同图"口径；id 段/`bo`/`rf` 都不同）。 */
  const QPIC6 = QPIC4.concat([
    'http://m.qpic.cn/psc?/V54UQdlK3naUxA4J47wN15WVMc4bjxtJ/TmEUgtj9EK6.7V8ajmQrEZZZ000000000000000000000000000000000000000000000!/mnull&bo=ZAAAAAABdwADByI!&rf=photolist&t=5',
    'http://m.qpic.cn/psc?/V54UQdlK3naUxA4J47wN15WVMc4bjxtJ/TmEUgtj9EK6.7V8ajmQrEYYY111111111111111111111111111111111111111111111!/mnull&bo=ZAAAAAABdwADByI!&rf=photolist&t=6',
  ])
  /** 规则 ⓑ 的真阳性夹具：同 id、只差**尺寸后缀**（`@200w_1e_1c` vs `@200w_1e_1c_90q`，等效 ⇒ 尺寸相同）。 */
  const S1 = 'https://i.example/a/pic.jpg@200w_1e_1c'
  const S2 = 'https://i.example/a/pic.jpg@200w_1e_1c_90q'
  /** 规则 ⓒ 的真阴性夹具：同 id、**不同渲染尺寸**（`@100w` vs `@600w`）⇒ 一定不归并。 */
  const B1 = 'https://i.example/b/pic.jpg@100w'
  const B2 = 'https://i.example/b/pic.jpg@600w'
  /** 格式/水印类：微信 `wx_fmt`/`wxfrom`/`wx_lazy`/`wx_co` 与 `_!web-…` 水印后缀（同一张画面）。 */
  const F1 = 'https://mmbiz.qpic.cn/mmbiz_jpg/ABC/640?wx_fmt=jpeg&wxfrom=5&wx_lazy=1'
  const F2 = 'https://mmbiz.qpic.cn/mmbiz_jpg/ABC/640?wx_fmt=png&wx_co=1'
  const W1 = 'https://i.example/c/pic.png'
  const W2 = 'https://i.example/c/pic.png_!web-article-pic'
  /** 有意重复的**分隔图**（作者就是要它们各画一遍：URL 与 path 都不同）。 */
  const SEP = ['http://i.example/9HK/fengefu000.gif', 'http://i.example/Cs0/fengefu001.gif', 'http://i.example/Tqx/fengefu002.gif']
  const SZ = (w, h) => ({ w: w, h: h, ok: true })

  ok('5a 归一化只做无争议的事：host/scheme 小写、去 fragment、去默认端口（**不动 query** —— 身份在那里）',
    normalizeRichImageUrl('HTTP://Photg.Example:80/psc?/U/A#frag') === 'http://photg.example/psc?/U/A' &&
    normalizeRichImageUrl('https://photg.example:443/psc?/U/A') === 'https://photg.example/psc?/U/A' &&
    normalizeRichImageUrl('http://photg.example/psc?/U/A?x=1') === 'http://photg.example/psc?/U/A?x=1',
    JSON.stringify(normalizeRichImageUrl('HTTP://Photg.Example:80/psc?/U/A#frag')))
  ok('5b 规则 ⓑ 删**处理类参数/后缀**（白名单，② 起含尺寸/质量类：`wx_fmt`/`wxfrom`/`wx_lazy`/`wx_co`/`bo`/`rf`/`x-oss-process=`/`@100w…`/`_!web-…`）',
    richImageKey(F1) === richImageKey(F2) && richImageKey(W1) === richImageKey(W2) &&
    richImageKey('https://i.example/d/p.jpg?x-oss-process=image/resize,w_200') === richImageKey('https://i.example/d/p.jpg') &&
    richImageKey(B1) === richImageKey('https://i.example/b/pic.jpg'),
    JSON.stringify([richImageKey(F1), richImageKey(W1)]))
  ok('5c ★**身份段一律保留**（无名段 / 图片 id 段 / 不在处理类名单里的具名参数）：删了它们会把不同图压成一张',
    richImageKey(QPIC4[0]) !== richImageKey(QPIC4[1]) &&
    richImageKey(QPIC4[1]) !== richImageKey(QPIC4[2]) &&
    richImageRelation(QPIC4[0], QPIC4[1]) === 'different' &&
    richImageKey(QPIC4[1]).indexOf('/V54UQdlK3naUxA4J47wN15WVMc4bjxtJ/') > 0)
  ok('5d `richImageRelation`：同一资源 = `same-resource`（规则 ⓐ）；变体 = `variant-candidate`（规则 ⓑ，② 起**也归并**）',
    richImageRelation(U, U) === 'same-resource' && richImageRelation(S1, S2) === 'variant-candidate' &&
    richImageRelation(F1, F2) === 'variant-candidate' && richImageRelation(U, V) === 'different',
    JSON.stringify([richImageRelation(U, U), richImageRelation(S1, S2), richImageRelation(U, V)]))

  /* 纯 Node 里复刻 DOM 生命周期：`take()` → 挂起（探针藏起来）→ **超时兜底** `releasePending()`。
     `sc.sizes` = 预置尺寸证据（等价于"两张都 load 成功"）；`sc.scope(i)` = 该 img 属于第几条属性行。 */
  const runPass = (sc) => {
    const p = makeRichImagePass({ mode: sc.mode || 'once', sizes: sc.sizes })
    const verdicts = sc.urls.map((u, i) => p.take(u, sc.scope ? sc.scope(i) : 0))
    const rel = p.releasePending('no-size-evidence').release
    const drawn = sc.urls.filter((u, i) => verdicts[i].draw || rel.indexOf(normalizeRichImageUrl(u)) >= 0)
    return { drawn, verdicts, released: rel, report: p.report(), pass: p }
  }
  const runOne = (urls, opts) => runPass(Object.assign({ urls: urls }, opts || {}))

  ok('5e 规则 ⓐ 行内：逐字节同一 URL 画一遍（3 遍 ⇒ 1 张），不同 URL 各画一遍',
    runOne([U, U, U]).drawn.length === 1 && runOne([U, V]).drawn.length === 2,
    JSON.stringify([runOne([U, U, U]).drawn.length, runOne([U, V]).drawn.length]))
  ok('5f ★规则 ⓐ **跨行**：同一趟渲染的多条属性里同一 URL 也只剩一遍（本次 bug 的判据）',
    (() => {
      const r = runOne([U, U, U, V], { scope: (i) => i })
      return r.drawn.length === 2 && r.report.images === 4 && r.report.duplicatesSkipped === 2 &&
        r.report.duplicateGroups.length === 1 && r.report.duplicateGroups[0].count === 3 &&
        r.report.rendered === r.report.groups.length          // 老判据（B7）依赖的不变量
    })(),
    JSON.stringify(runOne([U, U, U, V], { scope: (i) => i }).report))
  ok('5g `?propimg=all` 是**对照档**：完全不去重（3 遍还是 3 遍）—— 证明 5f 的"只剩一遍"不是恒真',
    runOne([U, U, U], { mode: 'all' }).drawn.length === 3 &&
    runOne([U, U, U], { mode: 'all' }).report.duplicatesSkipped === 0)
  ok('5h `?propimg=row` = 旧的"只在行内去重"语义（跨行重复会重现：3 行 ⇒ 3 张）',
    runOne([U, U, U], { mode: 'row', scope: (i) => i }).drawn.length === 3 &&
    runOne([U, U, U], { mode: 'row' }).drawn.length === 1)
  ok('5i ★"已经画成图的那张图又作为**链接**出现" ⇒ 链接被压掉（用户原话里的"图片链接再展示一遍"）',
    (() => {
      const tk = parsePropRichText('<img src="' + U + '"><a href="' + U + '">看这张</a>')
      const r = dedupeRichImages(tk, { mode: 'once' })
      return r.report.rendered === 1 && r.report.linksSuppressed === 1 && r.tokens.filter((x) => x.k === 'link').length === 0
    })(),
    JSON.stringify(dedupeRichImages(parsePropRichText('<img src="' + U + '"><a href="' + U + '">看这张</a>'), { mode: 'once' }).report))
  ok('5j 锚文本不是图片 URL 的链接**照旧保留**（只压"同一张图的重复展示"，不误伤真链接）',
    dedupeRichImages(parsePropRichText('<img src="' + U + '"><a href="https://b23.tv/BV1xzpee9EAF">视频</a>'), { mode: 'once' }).tokens.filter((x) => x.k === 'link').length === 1)
  ok('5k **有意重复的分隔图（不同 URL）一律保留**：3 张分隔图就是 3 个 img（去重只认"同一张画面"）',
    runOne(SEP).drawn.length === 3 && dedupeRichImages(SEP.map((u) => ({ k: 'img', src: u })), { mode: 'once' }).report.rendered === 3)
  ok('5l tokenizer 不背锅：同一 URL 在 tokenizer 层仍是两个 token（去重是渲染期的事，tokenizer 不改语义）',
    parsePropRichText('<img src="https://a/1.png"><img src="https://a/1.png">').filter((x) => x.k === 'img').length === 2)
  ok('5m ★真阳性①（规则 ⓑ+ⓒ）：同 id 两种**尺寸后缀**、载入尺寸相同 ⇒ 压成 1 张',
    runOne([S1, S2], { sizes: { [S1]: SZ(200, 112), [S2]: SZ(200, 112) } }).drawn.length === 1,
    JSON.stringify(runOne([S1, S2], { sizes: { [S1]: SZ(200, 112), [S2]: SZ(200, 112) } }).report.duplicateGroups))
  ok('5n ★真阳性②（规则 ⓑ+ⓒ）：格式/水印类后缀（`wx_fmt` 族 / `_!web-…`）尺寸相同 ⇒ 各压成 1 张',
    runOne([F1, F2, W1, W2], { sizes: { [F1]: SZ(640, 360), [F2]: SZ(640, 360), [W1]: SZ(800, 450), [W2]: SZ(800, 450) } }).drawn.length === 2)
  /*  ②(2026-09-25 用户第 2 条) **契约翻转**：旧版"尺寸不同 ⇒ 一定不归并"（5o）/ "证据缺失 ⇒ 不归并"（5p）
      正是用户复测看到的"还是有重复的图片"（作者重传的图尺寸就是不一样；远程图在无网/被墙时也永远拿不到尺寸）。
      现在：身份键相等 ⇒ **无条件归并**，证据只进台账。这两条断言因此从"真阴性"翻成"强制阳性"，
      并且**同时**断言台账里如实写着"当时尺寸不同/未知"（不是静默）。 */
  ok('5o ★★强制归并（用户第 2 条）：同 id 两种尺寸后缀、载入尺寸**不同**（100×56 vs 600×338）⇒ **仍然只画一遍**，台账写明 `different`',
    (() => {
      const r = runOne([B1, B2], { sizes: { [B1]: SZ(100, 56), [B2]: SZ(600, 338) } })
      return r.drawn.length === 1 && r.report.variants.merged === 1 && r.report.variants.mergedWithDifferentSize === 1 && r.report.variants.unmerged === 0
    })(),
    JSON.stringify(runOne([B1, B2], { sizes: { [B1]: SZ(100, 56), [B2]: SZ(600, 338) } }).report.variants))
  ok('5p ★★强制归并（用户第 2 条）：证据缺失（只加载成功一张 / 两张都失败）⇒ **仍然只画一遍**，台账写明 `unknown`',
    (() => {
      const a = runOne([W1, W2], { sizes: { [W1]: SZ(800, 450), [W2]: { w: 0, h: 0, ok: false } } })
      const b = runOne([W1, W2])                                   // 两张都没有证据（还没 load）
      return a.drawn.length === 1 && a.report.variants.mergedWithUnknownSize === 1 &&
        b.drawn.length === 1 && b.report.variants.merged === 1 && b.released.length === 0
    })(),
    JSON.stringify(runOne([W1, W2], { sizes: { [W1]: SZ(800, 450), [W2]: { w: 0, h: 0, ok: false } } }).report.variants))
  ok('5q ★同一变体出现两次也只剩一遍（归并确认后按"参考身份"继续记账）',
    runOne([S1, S2, S2], { sizes: { [S1]: SZ(200, 112), [S2]: SZ(200, 112) } }).drawn.length === 1 &&
    runOne([F1, F2, F1, F2], { sizes: { [F1]: SZ(640, 360), [F2]: SZ(640, 360) } }).drawn.length === 1)
  ok('5r ★★反例护栏：`m.qpic.cn/psc` **同一个 path** 下的 4 张**真图**（3660962877 原样）⇒ 4 张，一张都不许少',
    runOne(QPIC4).drawn.length === 4 && new Set(QPIC4.map(richImageKey)).size === 4,
    JSON.stringify({ drawn: runOne(QPIC4).drawn.length, keys: new Set(QPIC4.map(richImageKey)).size }))
  ok('5s ★★反例护栏②：同形态 **6 张**（不同 id 段/`bo`/`rf`）⇒ 6 张（父任务书的"6 张"口径）',
    runOne(QPIC6).drawn.length === 6 && new Set(QPIC6.map(richImageKey)).size === 6)

  /* ── 真语料读数（有语料才判；没有就**明确 SKIP**，不静默变绿）──────────────────────────────
     语料位置：`<工作区>/allwallpaper/<分组>/<itemId>/project.json`（本机实测路径不写死；试 dd/0923/0917/wallpapertest1/ 与直接子目录）。 */
  {
    const roots = [path.join(ROOT, '..', 'allwallpaper'), path.join(ROOT, 'allwallpaper')]
    const findPkg = (id) => {
      for (const r of roots) for (const sub of ['dd', '0923', '0917', 'wallpapertest1', '']) {
        const p = path.join(r, sub, id, 'project.json')
        if (fs.existsSync(p)) return p
      }
      return ''
    }
    const readPkg = (p) => {
      const o = JSON.parse(fs.readFileSync(p, 'utf8'))
      const props = (o.general && o.general.properties) || {}
      const urls = [], panelUrls = []
      let hiddenRows = 0
      const walk = (toks, out) => { for (const t of toks || []) { if (!t) continue; if (t.k === 'img') out.push(t.src); if (t.kids) walk(t.kids, out) } }
      for (const v of Object.values(props)) {
        if (!v || typeof v.text !== 'string') continue
        const deep = []; walk(parsePropRichText(v.text), deep)
        if (!deep.length) continue
        urls.push(...deep)                                   // 任意深度：`<a href><img></a>` 里嵌套的也算（面板会画它们）
        if (v.condition) { hiddenRows++; continue }           // 有 condition 的行由产物自己决定显隐（真机默认隐藏）
        panelUrls.push(...deep)
      }
      return { urls, panelUrls, hiddenRows }
    }
    /* 真机对照（2026-09-24，:8902 真面板 `__benchPatch.propsImages()`）：
         `3660962877`：`once` 画 **6** 张 / `row` 与 `all` 各 **38** 张（38 = 39 个 token − 1 行被 `condition` 隐藏）
         `3326873240`：`once` 画 **6** 张 / `row` 与 `all` 各 **13** 张（14 − 1）。
       离线按"任意深度 + 不减 condition 行"读 ⇒ 39/14 个 token、7 个身份；两者差的就是那一行。 */
    const pkgs = [['3660962877', 39, 7, 38], ['3326873240', 14, 7, 13]]
    let seen = 0
    for (const [id, wantTokens, wantOnce, wantPanel] of pkgs) {
      const p = findPkg(id)
      if (!p) { console.log('  – SKIP 真语料读数 ' + id + '：找不到 project.json（试过 ' + roots.join(' / ') + '）'); continue }
      seen++
      const { urls, panelUrls, hiddenRows } = readPkg(p)
      const once = new Set(urls.map(normalizeRichImageUrl)).size
      const tier2 = new Set(urls.map(richImageKey)).size
      const qpic = urls.filter((u) => u.indexOf('m.qpic.cn/psc') > 0)
      const drawn = runPass({ urls: urls })
      ok('5t 真语料 ' + id + '：' + urls.length + ' 个 img token（任意深度）/ 身份 ' + once + ' / 新规则候选键 ' + tier2 +
        ' / 面板可见行画 ' + panelUrls.length + ' 张（真机 `all` 档读数 ' + wantPanel + '）—— 新规则在真语料上**多压 0 张**',
        urls.length === wantTokens && once === wantOnce && tier2 === once && drawn.drawn.length === once &&
        panelUrls.length === wantPanel && hiddenRows === 1 && qpic.length === 6,
        JSON.stringify({ tokens: urls.length, once: once, tier2: tier2, drawn: drawn.drawn.length, panelVisible: panelUrls.length, hiddenRows: hiddenRows, qpic: qpic.length }))
    }
    if (!seen) console.log('  – SKIP 真语料读数：两份语料都不在（本条**不是通过**，是缺数据）')
  }

  /* ── 三层回退的**存在性/接线**（源码级；DOM 夹具另见 §D 的源码变异自证）──────────────────── */
  ok('5u 第一层（URL 档）仍在：`?propimg=once|row|all` + 权威读点 `new URLSearchParams(location.search).get(\'propimg\')`',
    /new URLSearchParams\(location\.search\)\.get\('propimg'\)/.test(SRC) && /RICH_IMAGE_MODES = \['once', 'row', 'all'\]/.test(SRC))
  /* ⚠③(2026-09-24 用户第 3 条 · **契约变更**，本条判据随之更新，并写明理由)：
     用户原话「图片去重默认**全部都去重**，并把壁纸配置页面上方那个**图片去重下拉栏连同描述文字一起删掉**
     （描述文字本身也超出去了）」⇒ 旧判据 5v/5v2/5w/5x 盯的那个"第二层可见开关"**整层被删**，
     再断言它存在就是让门禁守住一个用户明令删掉的东西。新判据（**更严**，不是放宽）：
       · 控件与它的描述、以及 localStorage 偏好层**必须不存在**（源码 0 处）；
       · 缺省仍是 `once`（= 整面板去重 = 用户说的"全部都去重"），URL 对照档仍在。
     §D 的源码变异自证（S2/S5）同步换成"控件不许回来"这两条。 */
  ok('5v 【契约已更新】第二层"面板可见开关"已按用户第 3 条删除：源码 0 处 `#bench-imgmode` / 偏好键；缺省仍是 `once`',
    /* 扫的是**去掉注释后**的源码：本文件与实现里的注释会引用被删掉的控件当"改前读数"。 */
    !/bench-imgmode/.test(SRC.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')) &&
    !/IMG_MODE_PREF_LS/.test(SRC) && /RICH_IMAGE_MODE_DEFAULT = 'once'/.test(SRC) &&
    /"props\.imgDedup":"图片去重"/.test(SRC) && /"props\.imgDedup":"Image dedup"/.test(SRC))
  /* 真机实测的假绿坑：控件是外壳起来后才建的，`applyStaticI18n` 那趟早跑完了 ⇒ 只挂 `data-i18n`
     会得到**空标签**的下拉框（`options` 实测 `once=`/`row=`/`all=`）。判据：文案必须显式写。 */
  ok('5v2 【契约已更新】控件没了 ⇒ 不再有"空标签下拉框"这一整类事故；`paintImgModeControl()` 保留为**只读档位**入口（无 DOM 写入）',
    /function paintImgModeControl\(\) \{ return richImageModePlan\(\) \}/.test(SRC) &&
    !/buildImgModeControl/.test(SRC))
  ok('5w 【契约已更新】"换档立即生效"的能力仍在，但触发者只剩 URL 档/换壁纸：`redrawPropsRich()` 与作者原文表 `RICH_TEXT_SRC` 原样保留',
    /function redrawPropsRich\(\)/.test(SRC) && /RICH_TEXT_SRC\.set\(el, raw\)/.test(SRC) &&
    /function redrawPropsRich\(\)[\s\S]{0,400}?newRichImagePassFor\(plan\.mode/.test(SRC))
  ok('5x 【契约已更新】档位解析只剩两层（URL 档 > 缺省 `once`）：`planRichImageMode({ url })`，且**不读** localStorage',
    /return planRichImageMode\(\{ url \}\)/.test(SRC) && !/planRichImageMode\(\{ url, stored \}\)/.test(SRC) &&
    planRichImageMode({ url: 'all' }).mode === 'all' && planRichImageMode({ url: 'all' }).forced === true &&
    planRichImageMode({}).mode === 'once' && planRichImageMode({}).source === 'default' &&
    planRichImageMode({ url: 'bogus' }).mode === 'once' &&
    /* 纯函数本身仍保留 `stored` 形参（外部/历史调用面不破），但**运行期不再传它** —— 上面那条正是这个意思 */
    planRichImageMode({ stored: 'row' }).mode === 'row',
    JSON.stringify([planRichImageMode({ url: 'all' }), planRichImageMode({}), planRichImageMode({ stored: 'row' })]))
  ok('5y【契约已更新】DOM 接线：① 产物 `.prop-media` 图与文案图由**同一次 DOM 顺序扫**裁定（`sweepPanelImages()`，幂等 + 账本从 DOM 重建）；② 重复的当场藏掉（`data-bench-img-dup`）；③ 尺寸证据只进台账（`recordImageSize`，load/error 都记）',
    /function sweepPanelImages\(\)/.test(SRC) && /propsBody\.querySelectorAll\('img'\)/.test(SRC) &&
    /im\.dataset\.benchImgDup = '1'/.test(SRC) && /function recordImageSize\(url, im\)/.test(SRC) &&
    /addEventListener\('load', \(\) => recordImageSize/.test(SRC) && /addEventListener\('error', \(\) => recordImageSize/.test(SRC) &&
    /a\.dataset\.benchLinkDup = '1'/.test(SRC) && /a\.dataset\.benchLinkEmpty = '1'/.test(SRC) &&
    !/RICH_IMAGE_PROBE_MS/.test(SRC) && !/settleRichImageEvidence/.test(SRC))
  /** `SITE_LAYOUT_CSS` 数组块的**切片**（不含后面运行期注入的 `BENCH_PICK_CSS`）：样式通道的判据要用它。 */
  const siteLayoutBlock = (s) => {
    const i = s.indexOf('const SITE_LAYOUT_CSS = [')
    if (i < 0) return ''
    const j = s.indexOf("].join('')", i)
    return j < 0 ? s.slice(i) : s.slice(i, j)
  }
  ok('5z 【契约已更新】控件那 5 条样式已从 `BENCH_PICK_CSS` 一起删除；`SITE_LAYOUT_CSS` 里当然也没有（D8 逐条等价不受影响）',
    !/bench-imgmode/.test(siteLayoutBlock(SRC)) && !/'#bench-imgmode/.test(SRC) &&
    /'\.bench-prop-img\[data-bench-img-unmerged="1"\]\{outline:1px dashed var\(--border\)\}'/.test(SRC))
  ok('5za【契约已更新】探针入口扩了读数：`propsImages()` 现在**两个来源都算**（rendered/ours/media/hiddenDup/links/linksHiddenDup/modeSource/natural/report）',
    /function propsImages\(\)/.test(SRC) && /media: media\.filter\(\(im\) => !im\.hidden\)\.length/.test(SRC) &&
    /hiddenDup: all\.filter/.test(SRC) && /linksHiddenDup:/.test(SRC) &&
    /modeSource: richImageModePlan\(\)\.source/.test(SRC) && /propsImages: \(\) => propsImages\(\)/.test(SRC))
  /* 改名**只改一半**是这类改动的经典事故（真发生过：声明与 get 改了、`setItem` 里还是旧名 ⇒
     `ReferenceError` 被 try/catch 吞掉 ⇒ "折叠状态记不住"这种静默失效）。判据：三处同一新名 + 全文 0 处旧名。 */
  ok('5zb 「渲染器设置」分组折叠状态的 localStorage 常量：声明/get/set 三处同名（`WE_GROUP_COLLAPSED_LS`），全文 0 处旧名',
    (SRC.match(/WE_GROUP_COLLAPSED_LS/g) || []).length === 3 && SRC.indexOf('WE_GROUP_KEY') < 0 &&
    /const WE_GROUP_COLLAPSED_LS = 'bench-props-we-collapsed'/.test(SRC) &&
    /localStorage\.getItem\(WE_GROUP_COLLAPSED_LS/.test(SRC) && /localStorage\.setItem\(WE_GROUP_COLLAPSED_LS/.test(SRC))
}

console.log('\n== D 分辨力自证 / 变异自证（改回去/改错必红；期望红集 == 实际红集）==')
{
  const onePass = (s) => String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m) => m)   // 模拟"只解一遍且不认无分号"
  ok('D1 旧解码（只解一遍、不认无分号）下 `&amp;nbsp;` 与 `&nbsp` 都留字面量 ⇒ 6b/6c 必红',
    onePass('&amp;nbsp;') === '&amp;nbsp;' && decodePropEntities('&amp;nbsp;') === NBSP
    && decodePropEntities('x&nbsp') === 'x' + NBSP)
  ok('D2 没有 BV 分支时 `BV1xzpee9EAF` 只会是纯文本 ⇒ 7a 必红（裸 BV 现在也是链接：它就是 B 站 id）',
    parsePropRichText('BV1xzpee9EAF').filter((x) => x.k === 'link').length === 1
    && parsePropRichText('随便一句话，没有视频号').filter((x) => x.k === 'link').length === 0)
  ok('D3 源码级：去重收口在**渲染之后的一次 DOM 顺序扫**（tokenizer 语义不动），判定走账本 `richImagePass.take(...)` 而不是"键相等就跳过"',
    /function sweepPanelImages\(\)/.test(SRC) && /const v = richImagePass\.take\(src, 0\)/.test(SRC) &&
    /if \(v\.draw\) continue/.test(SRC) && !/const seenSrc = new Set\(\)/.test(SRC) &&
    /propsBody\.querySelectorAll\('img'\)/.test(SRC))

  /* ── 变异自证（**纯函数层**）：同一批 claim 跑"真实现"与"被变异实现"，期望红集 == 实际红集 ──────
     为什么这样做：claim 是**真断言**（改坏了哪条会红，是算出来的，不是我声明的）。 */
  {
    const U2 = 'http://photg.example/psc?/USER/IMGAAA'
    const V2 = 'http://photg.example/psc?/USER/IMGBBB'
    const SZ = (w, h) => ({ w: w, h: h, ok: true })
    const S1 = 'https://i.example/a/pic.jpg@200w_1e_1c'
    const S2 = 'https://i.example/a/pic.jpg@200w_1e_1c_90q'
    const B1 = 'https://i.example/b/pic.jpg@100w'
    const B2 = 'https://i.example/b/pic.jpg@600w'
    const F1 = 'https://mmbiz.qpic.cn/mmbiz_jpg/ABC/640?wx_fmt=jpeg&wxfrom=5&wx_lazy=1'
    const F2 = 'https://mmbiz.qpic.cn/mmbiz_jpg/ABC/640?wx_fmt=png&wx_co=1'
    const W1 = 'https://i.example/c/pic.png'
    const W2 = 'https://i.example/c/pic.png_!web-article-pic'
    const QPIC4 = [
      'http://m.qpic.cn/psc?/V54UQdlK3naUxA4J47wN15WVMc4bjxtJ/TmEUgtj9EK6.7V8ajmQrEBsexJSlhMg7OiSbTz*Vq3QACEYkZ8E7D9iP.Od05WVwf*Zty7Ju024B0os.zP7PIbqo.3*UAdtYXXx9jjaGF1A!/b&bo=4gHXAQAAAAABBxU!&rf=viewer_4',
      'http://m.qpic.cn/psc?/V54UQdlK3naUxA4J47wN15WVMc4bjxtJ/TmEUgtj9EK6.7V8ajmQrEOlNbbR8QyH.V3DOKIQNRif85YCGLfi9pSXuaZqxdq9vSR5s5uHZgJLf1DqrxMxRMTafCMS1IHiigGZSLlOCyvE!/mnull&bo=SAFIAUgBSAEDByI!&rf=photolist&t=5',
      'http://m.qpic.cn/psc?/V54UQdlK3naUxA4J47wN15WVMc4bjxtJ/TmEUgtj9EK6.7V8ajmQrEMQXeDhXW2lYWF93UJF.nZ.2WxR10Rb.mdx71GJTB0aXalAzL1BM3tkUxAZw2oSRRgvDWflCZlln3Eou6lAIMO8!/mnull&bo=6APXAegD1wEDByI!&rf=photolist&t=5',
      'http://m.qpic.cn/psc?/V54UQdlK3naUxA4J47wN15WVMc4bjxtJ/TmEUgtj9EK6.7V8ajmQrEK.dTR0S5PnqaxucocfhhjUEzkloqXuqp0JsbUmHwzB1hnBAwn4iULfdmGz9S2FcNNdUWClXxYZKe6DMP4VWV5M!/mnull&bo=AQF3AAEBdwADByI!&rf=photolist&t=5',
    ]
    const SEP = ['http://i.example/9HK/fengefu000.gif', 'http://i.example/Cs0/fengefu001.gif', 'http://i.example/Tqx/fengefu002.gif']
    const runPass2 = (sc) => {
      const p = makeRichImagePass({ mode: sc.mode || 'once', sizes: sc.sizes })
      const verdicts = sc.urls.map((u, i) => p.take(u, sc.scope ? sc.scope(i) : 0))
      const rel = p.releasePending('no-size-evidence').release
      const drawn = sc.urls.filter((u, i) => verdicts[i].draw || rel.indexOf(normalizeRichImageUrl(u)) >= 0)
      return { drawn: drawn, verdicts: verdicts, report: p.report() }
    }
    const hostPath = (u) => { const x = new URL(u); return x.host + x.pathname }
    /** 变异体：按给定键归并（**不看尺寸**，也不等证据）—— 用于"去掉尺寸护栏"与"丢图片 id"两种变异。
     *  只变异"归并规则"，**不动**档位语义（`all` 照旧全画、`row` 照旧按行）⇒ 红集只反映归并规则。 */
    const mergeByKey = (sc, keyOf) => {
      if (sc.mode === 'all') return { drawn: sc.urls.slice() }
      const seen = new Set(); const drawn = []
      for (let i = 0; i < sc.urls.length; i++) {
        const u = sc.urls[i]
        const k = (sc.mode === 'row' ? String(sc.scope ? sc.scope(i) : 0) + '|' : '') + keyOf(u)
        if (seen.has(k)) continue
        seen.add(k); drawn.push(u)
      }
      return { drawn: drawn }
    }
    /** 旧 bug 的忠实复刻：**每条属性行各自一份账本**（第一版 `seenSrc` 的语义）。 */
    const perRowLedger = (sc) => {
      const byScope = new Map()
      sc.urls.forEach((u, i) => { const k = sc.scope ? sc.scope(i) : 0; if (!byScope.has(k)) byScope.set(k, []); byScope.get(k).push(u) })
      const drawn = []
      for (const list of byScope.values()) {
        const p = makeRichImagePass({ mode: sc.mode || 'once', sizes: sc.sizes })
        const vs = list.map((u) => p.take(u, 0))
        const rel = p.releasePending('no-size-evidence').release
        list.forEach((u, j) => { if (vs[j].draw || rel.indexOf(normalizeRichImageUrl(u)) >= 0) drawn.push(u) })
      }
      return { drawn: drawn }
    }
    const CLAIMS = [
      { id: 'C1-行内逐字节同一 URL 只画一遍', sc: { urls: [U2, U2, U2] }, want: (r) => r.drawn.length === 1 },
      { id: 'C2-跨行同一 URL 只画一遍', sc: { urls: [U2, U2, U2, V2], scope: (i) => i }, want: (r) => r.drawn.length === 2 },
      { id: 'C3-all 档完全不去重', sc: { urls: [U2, U2, U2], mode: 'all' }, want: (r) => r.drawn.length === 3 },
      { id: 'C4-row 档跨行重复重现', sc: { urls: [U2, U2, U2], mode: 'row', scope: (i) => i }, want: (r) => r.drawn.length === 3 },
      { id: 'C5-尺寸后缀等价 ⇒ 归并', sc: { urls: [S1, S2], sizes: { [S1]: SZ(200, 112), [S2]: SZ(200, 112) } }, want: (r) => r.drawn.length === 1 },
      { id: 'C6-格式/水印类 ⇒ 归并', sc: { urls: [F1, F2, W1, W2], sizes: { [F1]: SZ(640, 360), [F2]: SZ(640, 360), [W1]: SZ(800, 450), [W2]: SZ(800, 450) } }, want: (r) => r.drawn.length === 2 },
      /* ②(2026-09-25 用户第 2 条) 这两条 claim 从"真阴性"翻成"强制归并"：键相等就是同一张画面。 */
      { id: 'C7-尺寸不同 ⇒ 仍然归并（强制档）', sc: { urls: [B1, B2], sizes: { [B1]: SZ(100, 56), [B2]: SZ(600, 338) } }, want: (r) => r.drawn.length === 1 },
      { id: 'C8-证据缺失 ⇒ 仍然归并（强制档）', sc: { urls: [W1, W2] }, want: (r) => r.drawn.length === 1 },
      { id: 'C9-反例护栏 qpic 4 张真图', sc: { urls: QPIC4 }, want: (r) => r.drawn.length === 4 },
      { id: 'C10-分隔图保留', sc: { urls: SEP }, want: (r) => r.drawn.length === 3 },
      { id: 'C11-同一变体两次 ⇒ 一遍', sc: { urls: [S1, S2, S2], sizes: { [S1]: SZ(200, 112), [S2]: SZ(200, 112) } }, want: (r) => r.drawn.length === 1 },
    ]
    const MUTANTS = [
      /*  ② 新契约下的变异体：旧 M1（"去掉尺寸护栏"）现在**就是实现**，不再是变异；
          换成的两组变异体各自打掉"身份键"的一半能力（整条归并 / 只按 host）。 */
      { id: 'M1-只按逐字节 URL 归并（身份归并整条失效）', why: '把规则 ⓑ 拿掉（回到"同一 URL 才去重"）', impl: (sc) => mergeByKey(sc, (u) => normalizeRichImageUrl(u)), expect: ['C5-尺寸后缀等价 ⇒ 归并', 'C6-格式/水印类 ⇒ 归并', 'C7-尺寸不同 ⇒ 仍然归并（强制档）', 'C8-证据缺失 ⇒ 仍然归并（强制档）', 'C11-同一变体两次 ⇒ 一遍'] },
      { id: 'M2-丢掉图片 id', why: '归并键 = host+path（query 整个丢掉）—— 它压不掉 path 上的尺寸后缀，也放过不了 qpic 那 4 张同 path 真图', impl: (sc) => mergeByKey(sc, hostPath), expect: ['C2-跨行同一 URL 只画一遍', 'C5-尺寸后缀等价 ⇒ 归并', 'C6-格式/水印类 ⇒ 归并', 'C7-尺寸不同 ⇒ 仍然归并（强制档）', 'C8-证据缺失 ⇒ 仍然归并（强制档）', 'C9-反例护栏 qpic 4 张真图', 'C11-同一变体两次 ⇒ 一遍'] },
      { id: 'M3-all 档失效', why: '`?propimg=all` 按 once 跑（其余档不动）', impl: (sc) => runPass2(sc.mode === 'all' ? Object.assign({}, sc, { mode: 'once' }) : sc), expect: ['C3-all 档完全不去重'] },
      { id: 'M4-账本退回每行一个', why: '第一版 `seenSrc` 的忠实复刻（每条属性行一份账本）', impl: perRowLedger, expect: ['C2-跨行同一 URL 只画一遍'] },
      { id: 'M5-只按 host 归并（丢 path）', why: '归并键过宽 ⇒ 不同图被压成一张（反例护栏必须红）', impl: (sc) => mergeByKey(sc, (u) => { const x = new URL(u); return x.host }), expect: ['C2-跨行同一 URL 只画一遍', 'C9-反例护栏 qpic 4 张真图', 'C10-分隔图保留'] },
    ]
    const realOf = {}
    for (const c of CLAIMS) realOf[c.id] = !!c.want(runPass2(c.sc))
    let mutOk = 0
    for (const m of MUTANTS) {
      const actual = []
      for (const c of CLAIMS) {
        let got = false
        try { got = !!c.want(m.impl(c.sc)) } catch { got = false }
        if (got !== realOf[c.id]) actual.push(c.id)
      }
      const exp = m.expect.slice().sort()
      const act = actual.slice().sort()
      const same = exp.length === act.length && exp.every((x, i) => x === act[i])
      if (same) mutOk++
      console.log((same ? '  MUTANT-RED-OK ' : '  MUTANT-RED-MISMATCH ') + m.id + '（' + m.why + '） 期望红集=' + JSON.stringify(exp) + ' 实际红集=' + JSON.stringify(act))
    }
    ok('D4 ★变异自证 ≥3 组：期望红集 == 实际红集（' + mutOk + '/' + MUTANTS.length + ' 组；含"身份归并整条失效""丢掉图片 id""all 档失效""账本退回每行一个""只按 host 归并"）',
      mutOk === MUTANTS.length && MUTANTS.length >= 3 && Object.values(realOf).every(Boolean),
      JSON.stringify({ mutants: MUTANTS.length, redOk: mutOk, realClaims: Object.values(realOf).filter(Boolean).length + '/' + CLAIMS.length }))
  }

  /* ── 变异自证（**源码级**：UI 开关与优先级接线）────────────────────────────────────────────
     同一条 claim 在"真源码"上为真、在"被改坏的源码"上为假 ⇒ 红的是被变异掉的那条。 */
  {
    const siteBlock = (s) => {
      const i = s.indexOf('const SITE_LAYOUT_CSS = [')
      if (i < 0) return ''
      const j = s.indexOf("].join('')", i)
      return j < 0 ? s.slice(i) : s.slice(i, j)
    }
    const IMG_RULE = "    '#bench-imgmode-wrap{display:flex;align-items:center;gap:6px;flex:1 1 100%;min-width:0;margin-top:4px}',\n"
    const SRC_CLAIMS = [
      { id: 'S1-URL 档优先的接线', re: /planRichImageMode\(\{ url \}\)/, mutate: (s) => s.replace('planRichImageMode({ url })', 'planRichImageMode({ url: "" })') },
      /* S2/S5 同步契约变更：旧 claim 盯"开关 id + 三档"，现改为**"控件不许回来"** —— 变异 = 把开关构造塞回去。 */
      { id: 'S2-面板开关不许回来（第 3 条）', claim: (s) => !/buildImgModeControl/.test(s), mutate: (s) => s.replace('  function paintImgModeControl() { return richImageModePlan() }', '  function buildImgModeControl() { return null }\n  function paintImgModeControl() { return richImageModePlan() }') },
      /*  ②(2026-09-25 用户第 2 条) S3【契约已更新】：旧 claim 盯"变体探针藏起来"（那套探针已随强制档删除）；
          新 claim 盯**真机那条重复的来源**：产物自己渲染的 `.prop-media` 图必须进同一本账
          （变异 = 把 `dedupeRowMediaImages` 的调用拆掉 ⇒ 真机上同一张画面又会画 44 遍）。 */
      /*  claim 盯的是**调用点**（`try { sweepPanelImages() } catch`），不是函数定义 —— 盯定义会恒真。 */
      { id: 'S3-产物 .prop-media 图进同一本账（DOM 顺序扫，调用点）', re: /try \{ sweepPanelImages\(\) \} catch/, mutate: (s) => s.replace('try { sweepPanelImages() } catch', 'try { void 0 } catch') },
      /* S4【契约已更新】：旧的触发者（面板开关的 change）已删，但"原地重画"这条**能力**必须还在 ——
         claim = `redrawPropsRich()` 真的重建账本并重画（变异 = 把账本重建那行拆掉）。 */
      { id: 'S4-原地重画（账本重建 + 重画）仍接线', claim: (s) => /function redrawPropsRich\(\)[\s\S]{0,400}?newRichImagePassFor\(plan\.mode, richImagePassItem\)/.test(s), mutate: (s) => s.replace('newRichImagePassFor(plan.mode, richImagePassItem)', 'void 0') },
      /* 样式通道：claim = "规则在文件里，且 `SITE_LAYOUT_CSS` 数组块里**没有**它"；变异 = 把它搬进 SITE_LAYOUT_CSS。 */
      { id: 'S5-删掉的面板样式不许回来（也不许搬进 SITE_LAYOUT_CSS）', claim: (s) => !/bench-imgmode/.test(siteBlock(s)) && !/'#bench-imgmode/.test(s), mutate: (s) => s.replace('  const SITE_LAYOUT_CSS = [\n', "  const SITE_LAYOUT_CSS = [\n    '#bench-imgmode-wrap{display:flex}',\n") },
    ]
    let srcOk = 0
    for (const c of SRC_CLAIMS) {
      const claim = c.claim || ((s) => c.re.test(s))
      const before = claim(SRC)
      const after = claim(c.mutate(SRC))
      const good = before && !after
      if (good) srcOk++
      console.log((good ? '  MUTANT-RED-OK ' : '  MUTANT-RED-MISMATCH ') + c.id + '（真源码=' + before + ' 变异后=' + after + '）')
    }
    ok('D5 ★源码级变异自证：开关/优先级/探针/立即生效/样式通道 5 条 claim —— 改坏哪条就红哪条',
      srcOk === SRC_CLAIMS.length, JSON.stringify({ claims: SRC_CLAIMS.length, redOk: srcOk }))
  }

  ok('D6 反例护栏的分辨力：若按 `host+path` 归并，真语料那 4 张图会被压成 1 张（所以判据选"整条 URL + 白名单后缀"）',
    new Set(['http://m.qpic.cn/psc?/U/AAA.1', 'http://m.qpic.cn/psc?/U/BBB.2'].map((u) => { const x = new URL(u); return x.host + x.pathname })).size === 1 &&
    richImageKey('http://m.qpic.cn/psc?/U/AAA.1') !== richImageKey('http://m.qpic.cn/psc?/U/BBB.2') &&
    richImageKey('http://m.qpic.cn/psc?/U/AAA.1') === richImageKey('HTTP://M.QPIC.CN:80/psc?/U/AAA.1#x'))
}

console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败')
if (fail === 0) console.log('✓ 属性面板富文本通过：nbsp 收口（含双重/无分号、不过度解码）/ BV 转链接走既有白名单通道 / 图片去重**强制档**（①逐字节同一资源一遍 ②身份键相等 —— 只差处理类参数/后缀/尺寸标记/http-https/www. —— **无条件归并**，尺寸证据只进台账 ③两个来源共用一本账 ④空壳链接不画）+ 反例护栏 + 两层回退（URL 档 > 缺省 once）+ 10 组变异自证')
process.exit(fail > 0 ? 1 : 0)
