// bench-issue0924a-line-A-test.mjs —— issue #0924a **A 线（:8902 测试台 UI）** 12 条 + 收尾第 20 条的判据集
//   + issue #0924a2（用户复测后重做的 4 条：①输出面板滚动 / ②图片强制去重 / ③音量控件进卡片 / ⑦切档不凭空挂壁纸）
//
// ②③⑦ 的**契约更新**（每处都写清了理由，见对应断言上方注释）：
//   · ③ A2a–A2e：音量控件从"卡片下面那条独立 `#np-volbar`"改成**组件在卡片内部**画（`.snd-clock` 里的
//     音量轨 + 传输行第四键 `data-mpw-np-mute`）⇒ 页面里**不再有** `#np-volbar`/`#np-volnum`/`--mpw-np-vol`；
//     几何判据从 `volumeInNpBar`（volbar.top ≥ card.bottom）改成 `volumeInCard`/`volumeOverflow`。
//   · ① A16a–A16e：跟随口径从"追加前贴底才跟随（24px 容差）"改成"**用户滚到哪就停在哪**"（2px 容差 +
//     `#logbody` 上的影子 `scrollTop` 守卫：产物那条无条件 `scrollTop=scrollHeight` 被丢弃并计数）。
//   · ② A3g–A3k：去重从"候选要尺寸证据"改成**强制归并**（键相等即同一张画面），并且把**产物自己渲染的
//     `.prop-media` 图**也拉进同一本账（真机读数：同一张画面 10 遍）；"图没显示出来就显示它的链接"这条兜底删除。
//   · ⑦ A21a–A21e：换档前先判"是不是真的没选壁纸"，并且把**产物那侧的当前项**（`w`）用产物自己的 `ht()` 清掉。
//
// 为什么要独立一份：这 12 条改的都是**呈现层**（快捷根行 / NP 音量条 / 图片去重控件 / 溢出自检 /
// 换库后侧栏重画 / 调试页签 / 输出配色 / 中英单显 / 跟随式滚动 / 原生 select / 释放停干净），
// 逐条都要有"改前读数 → 改后读数 → 判据名"。本文件负责**纯 Node 层**（源码级钉子 + 纯函数 + 真 HTTP
// 取一次 `/api/fs/roots`），浏览器层的几何/状态机读数在 `tests/bench-ui-headless-test.mjs` 的 **IA 组**
// （用同一批探针：`dirboxGeometry()` / `panelOverflowProbe()` / `dbgTabState()` / `logScrollState()` /
// `docBilingualProbe()` / `propsSelectProbe()` / `releaseQuietProbe()` / `npGeometry()`）。
//
// 用法：node tests/bench-issue0924a-line-A-test.mjs [--json]
// 退出码：0 全绿 / 1 有失败 / 2 用法错误
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { ROOT } from './_root.mjs'

const JSON_OUT = process.argv.includes('--json')
const DEMO = path.join(ROOT, 'demo')
const PATCH_SRC = fs.readFileSync(path.join(DEMO, 'bench-patch.js'), 'utf8')
const HTML_SRC = fs.readFileSync(path.join(DEMO, 'index.html'), 'utf8')
const SERVER_SRC = fs.readFileSync(path.join(ROOT, 'server', 'we-scene-demo-server-8902.mjs'), 'utf8')
const P = await import(pathToFileURL(path.join(DEMO, 'bench-patch.js')).href)

let pass = 0
const failed = []
const ok = (cond, name, reading) => {
  if (cond) { pass++; if (!JSON_OUT) console.log(`PASS ${name}${reading ? '  ' + reading : ''}`); return true }
  failed.push({ name, reading: reading === undefined ? '' : String(reading) })
  console.log(`FAIL ${name}${reading ? '  ' + reading : ''}`)
  return false
}
const section = (s) => { if (!JSON_OUT) console.log('\n═══ ' + s + ' ═══') }
/** 去掉整行注释后再扫（本文件与实现里的注释会引用被删掉的东西当"改前读数"，不该被当成实现）。 */
const stripComments = (t) => t.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
const NO_COMMENT = stripComments(PATCH_SRC)
const staticCss = (() => {
  const m = HTML_SRC.match(/<style id="bench-shell-static">([\s\S]*?)<\/style>/)
  return m ? m[1] : ''
})()

/* ══════════════════ ① 快捷根：少而通用 + 那一行不再溢出 ══════════════════ */
section('① 选择文件夹对话框的快捷根')
{
  ok(/const MAX_FS_ROOTS = \d+/.test(SERVER_SRC) && /out\.length >= MAX_FS_ROOTS\) break/.test(SERVER_SRC),
    'A1a 服务端有**上限**（`MAX_FS_ROOTS` 且去重后真的 break）—— 用户第 1 条「你就留几个」',
    (SERVER_SRC.match(/const MAX_FS_ROOTS = \d+/) || [''])[0])
  ok(!/label: '配置库根'/.test(SERVER_SRC) && !/label: '配置库根的上一级/.test(SERVER_SRC),
    'A1b 冗余候选已删：不再把「配置库根」「配置库根的上一级」当快捷根（与当前库目录/它的上一级同义）')
  ok(/\.bench-dirbox-roots\{display:flex;flex-wrap:wrap/.test(PATCH_SRC) &&
    /\.bench-dirbox-roots button\{[^}]*white-space:nowrap/.test(PATCH_SRC) &&
    /\.bench-dirbox-roots\{[^}]*max-height:[^;}]*;overflow:auto/.test(PATCH_SRC),
    'A1c 快捷根那一行**可折行 + 标签不逐字折断 + 整行自身可滚**（改前：flex 不换行 ⇒「当前库目录」竖排成一字一行，后几条被 `overflow:hidden` 顶出窗外）')
  ok(/'bench-dirbox-tools bench-dirbox-roots'/.test(PATCH_SRC),
    'A1d chips 容器真的带上了 `bench-dirbox-roots` 类（CSS 不是写给一个不存在的节点）')
  const probes = ['dirboxGeometry', 'panelOverflowProbe']
  ok(probes.every((k) => new RegExp(k + ':').test(PATCH_SRC)) && /function dirboxGeometry\(\)/.test(PATCH_SRC),
    'A1e 探针 `dirboxGeometry()`（溢出 / 一字一行）与 `panelOverflowProbe()`（第 4 条通用自检）都在')
  //  真 HTTP：起一份被测服务，读 `/api/fs/roots`（与 bench-dsh-libroot 的 A1 同一口径，这里只判"少而够用"）
  const fx = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-0924a-'))
  const libA = path.join(fx, 'libA')
  fs.mkdirSync(libA, { recursive: true })
  fs.mkdirSync(path.join(fx, 'reports'), { recursive: true })
  const port = await new Promise((resolve) => { const s2 = http.createServer(); s2.listen(0, '127.0.0.1', () => { const p2 = s2.address().port; s2.close(() => resolve(p2)) }) })
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'we-scene-demo-server-8902.mjs'), String(port)], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      MPW_ROOT: fx, MPW_LIBRARY_DIR: libA, MPW_PICK_ROOT: fx,
      MPW_BENCH_STATIC_DIR: DEMO, MPW_REPORTS_DIR: path.join(fx, 'reports'),
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const get = (p2) => new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: p2 }, (res) => {
      const c = []; res.on('data', (b) => c.push(b)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(c).toString('utf8') }))
    })
    req.on('error', (e) => resolve({ status: 0, body: String(e.code || e) }))
    req.end()
  })
  try {
    const t0 = Date.now()
    for (;;) {
      if (Date.now() - t0 > 25000) throw new Error('服务 25s 没起来')
      const r = await get('/__health')
      if (r.status === 200) break
      await new Promise((r2) => setTimeout(r2, 120))
    }
    const rootsR = await get('/api/fs/roots')
    const J = (() => { try { return JSON.parse(rootsR.body) } catch { return {} } })()
    const roots = Array.isArray(J.roots) ? J.roots : []
    const kinds = roots.map((r) => r.kind)
    console.log('  读数 /api/fs/roots = ' + JSON.stringify(roots.map((r) => ({ kind: r.kind, path: r.path, listable: r.listable }))).slice(0, 700))
    ok(rootsR.status === 200 && roots.length >= 4 && roots.length <= 6,
      'A1f ★改后：快捷根 **4–6 条**（改前真机 8–9 条）—— 少到一行放得下，且仍含"任何电脑都可能有"的那几类',
      `status=${rootsR.status} n=${roots.length} kinds=${JSON.stringify(kinds)}`)
    ok(roots[0] && roots[0].path === libA && roots[0].kind === 'library',
      'A1g 第一条仍是**当前库目录**（顺序即去重优先级，用户真正要选的那条永远在最前）', JSON.stringify(roots[0] && roots[0].path))
    ok(kinds.includes('library-parent') && kinds.includes('home') && kinds.includes('cwd'),
      'A1h 库根的上一级 / 宿主 home / 当前工作目录 仍在（"所有电脑都可能有的几个"）', JSON.stringify(kinds))
    ok(roots.every((r) => r.labels && r.labels.length >= 1 && r.path && typeof r.exists === 'boolean' && typeof r.listable === 'boolean'),
      'A1i 每条仍带推导出来的标签 + 存在/可列标记（不假装、不写死）')
  } catch (e) {
    ok(false, 'A1f 真 HTTP 读 `/api/fs/roots`（起服务失败）', String((e && e.message) || e).slice(0, 160))
  } finally {
    try { child.kill('SIGKILL') } catch { /* 已退 */ }
    try { fs.rmSync(fx, { recursive: true, force: true }) } catch { /* 清理失败不致命 */ }
  }
}

/* ══════════════════ ②③ 音量控件：进 **NP 卡片内部** ══════════════════ */
section('②③ 音量控件在 NP 卡片内部（不再是卡片下面那条独立条）')
{
  /*  ③(2026-09-25 issue0924a2 用户第 3 条原话)「我说的把音量的按钮集成到 NP 的卡片里面，你还是没有做好」。
      上一轮把 `#np-volume` 搬进了**卡片下面**的 `#np-volbar` —— 那仍然不是"卡片里面"。
      本轮的落点：**组件自己在卡片内部**画（`demo/now-playing/NowPlaying.tsx`）：
        · 音量轨 = `.snd-clock` 行中间那个 `<input id="np-volume" data-mpw-np-vol-range>`；
        · 音量的按钮 = 传输行第四键 `<button class="snd-op" data-mpw-np-mute>`（点它静音/取消静音）；
        · 两样都只在**受控档 + 卡片展开**（`late > 0`）时渲染 ⇒ 收起成胶囊时一个像素都不多。 */
  const NP_TSX = fs.readFileSync(path.join(DEMO, 'now-playing', 'NowPlaying.tsx'), 'utf8')
  const NP_CSS = fs.readFileSync(path.join(DEMO, 'now-playing', 'now-playing.css'), 'utf8')
  const DIST = fs.readFileSync(path.join(DEMO, 'now-playing', 'dist', 'now-playing.js'), 'utf8')
  const npHost = HTML_SRC.slice(HTML_SRC.indexOf('id="np-host"'), HTML_SRC.indexOf('</aside>', HTML_SRC.indexOf('id="np-host"')))
  const audioIdx = npHost.indexOf('id="np-audio"')
  ok(!/id="np-volbar"/.test(HTML_SRC) && !/id="np-volnum"/.test(HTML_SRC) && !/--mpw-np-vol:/.test(HTML_SRC) && !/--mpw-np-vol:/.test(PATCH_SRC),
    'A2a ★★用户第 3 条：卡片下面那条独立条（`#np-volbar` + `#np-volnum` + `--mpw-np-vol`）**整块撤掉**（页面与本补丁两张 CSS 表里都不再有它）',
    JSON.stringify({ html: /np-volbar/.test(HTML_SRC), patch: /np-volbar/.test(PATCH_SRC), varHtml: /--mpw-np-vol:/.test(HTML_SRC) }))
  ok(!/id="np-volume"/.test(HTML_SRC) && /id="np-volume"/.test(NP_TSX) && /data-mpw-np-vol-range="1"/.test(NP_TSX) && /data-mpw-np-mute=/.test(NP_TSX),
    'A2b ★★音量控件的**唯一渲染者**是组件本身（`NowPlaying.tsx` 里 `id="np-volume"` + `data-mpw-np-vol-range` 音量轨 + `data-mpw-np-mute` 第四键）；演示页 `index.html` 里不再有它（改前：`#np-volume` 是页面上的 `<input>`）')
  ok(/\.snd-clock/.test(NP_TSX) && /snd-clock/.test(NP_TSX) && /showVolume/.test(NP_TSX) && /const showVolume = controlled && late > 0/.test(NP_TSX),
    'A2c 音量轨画在**时钟行内部**（`.snd-clock` 的中间那一段，与 DSH 插件的 `.mpw_np_vol` 同位置），且存在条件是 `controlled && late > 0`（照插件 `showVolume = late > 0`）')
  ok(/\.snd-clock input\[type="range"\]\[data-mpw-np-vol-range\]/.test(NP_CSS) && /data-mpw-np-volnum/.test(NP_CSS) && /flex: 1 1 auto/.test(NP_CSS),
    'A2d 组件 CSS 只给**既有类 + 属性选择器**（`.snd-clock input[type="range"][data-mpw-np-vol-range]` / `.snd-clock [data-mpw-np-volnum]`）：不新增 `.snd-*` 类 ⇒ 组件那条"CSS 类名与 DOM 一一对应"的判据在**装饰档** SSR 上仍成立（音量行只在受控档展开时存在）')
  ok(/mpw-np-vol-range/.test(DIST) && /mpw-np-mute/.test(DIST),
    'A2e `demo/now-playing/dist/now-playing.js` 是**重新构建过**的产物（新音量标记在里面；dist 没重建 ⇒ 页面还是旧组件）')
  ok(audioIdx > 0 && !/id="np-volume"/.test(npHost.slice(audioIdx)),
    'A2f 传输条 `#np-audio`（= 壁纸配置**最下面**那一行）里**没有**音量控件（用户第 2 条的要求继续成立）',
    JSON.stringify({ audioIdx, tail: npHost.slice(audioIdx, audioIdx + 60) }))
  ok(/--mpw-np-cover:calc\(var\(--mpw-np-card\) \+ var\(--mpw-np-strip\)\)/.test(HTML_SRC) &&
    /--mpw-np-cover:calc\(var\(--mpw-np-card\) \+ var\(--mpw-np-strip\)\)/.test(PATCH_SRC),
    'A2g 浮层高度与属性表预留都按**新契约**算：`cover = card + strip`（撤掉的那 26px 不再计入 —— 音量行现在在卡片**内部**，不额外占高；两张表逐字同款）')
  /*  ⚠负向断言扫的是**去注释**源码：实现里那段注释专门写了"`volumeInNpBar`：已撤"（改前读数），
      扫带注释的源码会把"注释里提到它"误判成"实现里还有它"（本轮实测踩到）。 */
  ok(/volumeInCard:/.test(PATCH_SRC) && /volumeInCardX:/.test(PATCH_SRC) && /volumeOverflow\b/.test(PATCH_SRC) &&
    /volumeInStrip:/.test(PATCH_SRC) && /stripHasVolume:/.test(PATCH_SRC) && !/volumeInNpBar\s*[:,]/.test(NO_COMMENT),
    'A2h 探针 `npGeometry()` 按新契约读数：`volumeInCard / volumeInCardX / volumeOverflow / volumeInStrip / stripHasVolume`（`volumeInNpBar` 已随那条独立条一起删除）')
  ok(/npVolumeSlider:/.test(PATCH_SRC) && /npMuteKey:/.test(PATCH_SRC),
    'A2i 探针 `npVolumeSlider()` / `npMuteKey()`（组件那个滑条的值/禁用/在不在卡片里 + 第四键的静音态）')
  ok(/try \{ pumpNp\(\) \} catch/.test(PATCH_SRC) && !/volEl\.value = String\(vol\)/.test(PATCH_SRC) && !/volNumEl/.test(PATCH_SRC) &&
    /'#np-mount \.snd \[data-mpw-np-vol-range\], #np-mount \.snd \[data-mpw-np-volnum\]\{pointer-events:auto\}'/.test(PATCH_SRC),
    'A2j 接线按新契约：`applyAudio()` 不再直接写滑条（React 受控 ⇒ 会被下一次 render 覆盖），改成 `pumpNp()` 把 `data.volume` 推给组件；滑条**不越界**的既有口径（可压 + 不溢出）继续成立（`#np-mount` 透明区照旧不吃点击，只放行音量轨）')
}

/* ══════════════════ ③ 图片去重：缺省"全部都去重" + 控件删除 ══════════════════ */
section('③ 图片去重控件删除 / 缺省整面板去重')
{
  ok(!/sel\.id = 'bench-imgmode'/.test(NO_COMMENT) && !/buildImgModeControl/.test(NO_COMMENT) &&
    !/IMG_MODE_PREF_LS/.test(NO_COMMENT) && !/D\.createElement\('select'\)\s*\n?\s*sel\.className = 'bench-imgmode-sel'/.test(NO_COMMENT),
    'A3a 控件构造整块删除：没有 `#bench-imgmode`、没有 `buildImgModeControl`、没有 localStorage 偏好键')
  const cssBlock = PATCH_SRC.slice(PATCH_SRC.indexOf('const BENCH_PICK_CSS'), PATCH_SRC.indexOf('function injectBenchPickerStyle'))
  ok(!/'#bench-imgmode/.test(cssBlock),
    'A3b 那 5 条 `#bench-imgmode*` 样式（含描述文字 `-note`）已从 `BENCH_PICK_CSS` 删除')
  ok(!/localStorage\.getItem\('bench-props-imgmode'\)/.test(NO_COMMENT) && !/localStorage\.setItem\('bench-props-imgmode'/.test(NO_COMMENT),
    'A3c 档位解析**不再读** `bench-props-imgmode`（控件没了 ⇒ 陈旧偏好不许压过缺省）')
  const d0 = P.planRichImageMode({})
  const dUrl = P.planRichImageMode({ url: 'all' })
  const dBad = P.planRichImageMode({ url: 'nonsense' })
  ok(d0.mode === 'once' && d0.source === 'default',
    'A3d ★缺省 = `once`（= **整面板去重 / 全部都去重**，用户第 3 条原话），不再是别的档', JSON.stringify(d0))
  ok(dUrl.mode === 'all' && dUrl.source === 'url' && dBad.mode === 'once',
    'A3e URL 对照档仍在（`?propimg=all` 走 URL 档；非法值回落缺省）—— 既有门禁 B7 的对照档不受影响', JSON.stringify([dUrl, dBad]))
  ok(/"props\.imgDedup":"图片去重"/.test(PATCH_SRC) && /"props\.imgDedup":"Image dedup"/.test(PATCH_SRC),
    'A3f 词典两侧都还在（键数对称，见 A20a）')

  /*  ②(2026-09-25 issue0924a2 用户第 2 条复测)「我说的壁纸配置里面重复的图片只显示一次，你把它**强制**成为
      只显示一次的，你现在还是没有弄好，现在还是有重复的图片。」+「把链接也去掉」。
      ── 两条真因（都有真机读数）──────────────────────────────────────────────────────────
      ⓐ 面板里的图有**两个来源**，旧账本只去了一个：产物自己渲染的 `div.prop-media > img`（`St()`）
         与我们从属性文案 tokenize 出来的 `img.bench-prop-img`。真机读数（dd/3660962877）：同一张画面
         `ours 6 + media 38 = 44 张`，且旧账本 `report.images` 只数我们的 token ⇒ 一直"显示去重成功"。
      ⓑ 变体（同一张画面的不同参数/尺寸/重传）旧规则要"两张都 load 成功且宽高完全相同"才归并
         ⇒ 尺寸不同或拿不到证据就画两张。 */
  const v1 = 'https://i.example/v/pic.jpg?w=800&q=90'
  const v2 = 'https://i.example/v/pic_1600x1200.jpg'
  const forced = P.makeRichImagePass({ mode: 'once' })
  const t1 = forced.take(v1, 0), t2 = forced.take(v2, 0)
  ok(t1.draw === true && t2.draw === false && t2.merged === true && t2.reason === 'variant-key-equal',
    'A3g ★★**强制只显示一次**（用户第 2 条）：身份键相同（只差尺寸/质量参数、或文件名里的尺寸标记）⇒ **无条件归并**，不再要尺寸证据',
    JSON.stringify({ v1: t1, v2: t2, evidence: t2.evidence }))
  const noEvidence = P.makeRichImagePass({ mode: 'once' })
  noEvidence.take('https://i.example/n/a.png', 0)
  const second = noEvidence.take('https://i.example/n/a.png_!web-article-pic', 0)
  ok(second.draw === false && second.merged === true && second.evidence === 'unknown',
    'A3h ★"尺寸未知"也照样归并（改前：证据拿不到 ⇒ 不归并 ⇒ 真机就是"还是有重复的图片"）；台账把"当时尺寸未知"如实记下来',
    JSON.stringify(noEvidence.report().variants))
  const rep = (() => { const q = P.makeRichImagePass({ mode: 'once', sizes: { 'https://i.example/z/a.jpg': { w: 100, h: 50, ok: true }, 'https://i.example/z/a.jpg?w=900': { w: 400, h: 200, ok: true } } }); q.take('https://i.example/z/a.jpg', 0); q.take('https://i.example/z/a.jpg?w=900', 0); return q.report() })()
  ok(rep.variants.merged === 1 && rep.variants.mergedWithDifferentSize === 1 && rep.variants.evidence.different === 1 && rep.variants.unmerged === 0,
    'A3i 台账**如实计数**：合并了几张、其中"尺寸不同/未知"各几张（用户：把放弃归并的原因如实计数进台账/提示，不许静默）',
    JSON.stringify(rep.variants))
  ok(/function sweepPanelImages\(\)/.test(PATCH_SRC) && /propsBody\.querySelectorAll\('img'\)/.test(PATCH_SRC) &&
    /im\.dataset\.benchImgDup = '1'/.test(PATCH_SRC) && /try \{ sweepPanelImages\(\) \} catch/.test(PATCH_SRC),
    'A3j ★★**产物的 `.prop-media` 图也进同一本账**（`sweepPanelImages()`：按 **DOM 顺序**扫全面板的所有 `<img>`、两个来源一起算，重复的当场藏掉并标 `data-bench-img-dup`）—— 真机那条"同一张画面 44 张"就压在这一档')
  ok(/function sweepPanelImages\(\)/.test(PATCH_SRC) && /newRichImagePassFor\(richImageMode\(\)/.test(PATCH_SRC) &&
    /for \(const im of propsBody\.querySelectorAll\('img\[data-bench-img-dup\]'\)\)/.test(PATCH_SRC) && /rowVisible\(row\)/.test(PATCH_SRC),
    'A3k ★★账本**幂等且从 DOM 重建**（先把上一趟藏掉的恢复可见、再按 DOM 顺序重算；只吃可见行）—— 真机踩过"产物局部重画 ⇒ 留第一份的节点没了、其余副本全被藏掉 ⇒ 面板一张图都没有"（`imgs: [] / dupSuppressed: 13`）')
  ok(/a\.dataset\.benchLinkDup = '1'/.test(PATCH_SRC) && /a\.dataset\.benchLinkEmpty = '1'/.test(PATCH_SRC) && /richImagePass\.shouldSuppressLink\(href\)/.test(PATCH_SRC),
    'A3k2 ★"把链接也去掉"：目标就是已画成图的那条链接被藏掉（`data-bench-link-dup`）、图片被压掉后**空壳链接**也不画（`data-bench-link-empty`）—— 改前那条"图没显示出来就把它的链接显示出来"的兜底删除')
  ok(/function paintImgDedupNote\(\)/.test(PATCH_SRC) && /props\.imgDedupForcedNote/.test(PATCH_SRC) && /#props-imgdedup-note/.test(PATCH_SRC),
    'A3l 面板末尾有一行**人看得见的台账**（`#props-imgdedup-note`：已压掉 N 张 + 其中 M 张靠身份键强制归并、尺寸不同/未知各几张）')
  ok(!/候选要两张都载入成功且原始宽高完全相同才归并/.test(PATCH_SRC) && !/a candidate merges only when both images load with identical natural width/.test(PATCH_SRC),
    'A3m 面向用户的文案与实现**同源**：`props.imgDedupTip` 里"候选要两张都载入成功且宽高完全相同才归并"这条旧说法已删（否则文案在骗人）')
  ok(/groups\.length/.test(PATCH_SRC) && /rendered: visible\.length/.test(PATCH_SRC) && /media: media\.filter/.test(PATCH_SRC),
    'A3n 探针 `propsImages()` 现在**两个来源都数**（`rendered/ours/media/hiddenDup/links/linksHiddenDup`），`once` 档不变式 `rendered === groups.length` 继续成立')
}

/* ══════════════════ ⑦ 换渲染器档：未选择壁纸 ⇒ 不许凭空挂壁纸 ══════════════════ */
section('⑦ 换渲染器档不再把叉掉的那张挂回来')
{
  /*  ⑦(2026-09-25 issue0924a2 用户第 7 条原话)「渲染器使用我的渲染器的时候（这时候我已经把上面选过的所有壁纸
      都叉掉了，是未选择壁纸的状态）我把渲染器切成上游产物，它就加载了一个我最后加载的一个壁纸……为什么切渲染器
      会突然加载出来壁纸。」
      ── 真因（minified 产物 + 真机读数）──────────────────────────────────────────────────
      产物的"当前壁纸"是它模块作用域里的 `w`：`Ue(e)` 写、`Ae(){if(!w)return;…k.src=…}` 读它重挂载、
      **只有** `ht(){w=null;…}` 会清；而产物自己那个「释放」(`E()?.release()`) **只释放舞台、不动 `w`**。
      ⇒ 用户叉掉壁纸之后 `w` 还挂着最后那张，切档会点产物的「重挂载」⇒ `Ae()` 判真 ⇒ 又挂回来。
      改前真机读数：`#frame.src` 从 `about:blank` → `…&src=2887099508…`、`#current` 从"未选择壁纸"变回标题。 */
  const ARTIFACT = fs.readFileSync(path.join(DEMO, 'assets', 'bench-DSKWIqmS.js'), 'utf8')
  ok(/function ht\(\)\{w=null/.test(ARTIFACT) && /function Ae\(\)\{if\(!w\)return/.test(ARTIFACT) && /l\("#release"\)\.onclick=\(\)=>E\(\)\?\.release\(\)/.test(ARTIFACT),
    'A21a **根因证据**（产物源码三处）：`ht(){w=null…}` 是唯一清空入口、`Ae(){if(!w)return…}` 读它重挂载、`#release` 只调 `release()` 不动 `w`')
  ok(/function clearArtifactSelection\(reason\)/.test(PATCH_SRC) && /window\.__benchClearArtifactSelection = clearArtifactSelection/.test(PATCH_SRC) &&
    /typeof window\.__benchClearArtifactSelection === 'function'/.test(PATCH_SRC),
    'A21b ★★真因修法：借产物**自己的**清理入口（`#pick-lib` 链里的 `ht()`，我们接管时存下的 `artifactPickChain`）把 `w` 清成 null；跨作用域走显式 window 桥（`initSiteShell` 够不着 `init()` 内部函数 —— 裸引用会被 try/catch 吞成"改了没生效"）')
  ok(/function nothingSelectedNow\(\)/.test(PATCH_SRC) && /const st = nothingSelectedNow\(\)\s*\n\s*if \(st\.empty\) return false/.test(PATCH_SRC),
    'A21c ★换档前先判"是不是真的没选壁纸"（`nothingSelectedNow()`：列表无 `.active` + `curId` 空 + `#frame` 空/about:blank）；没选就**一次都不点**产物的「重挂载」',
    JSON.stringify({ has: /nothingSelectedNow/.test(PATCH_SRC) }))
  ok(/empty\.empty \? 'log\.rendererSrcEmpty'/.test(PATCH_SRC) && /"log\.rendererSrcEmpty":/.test(PATCH_SRC) &&
    Boolean(P.DICT.zh['log.rendererSrcEmpty']) && Boolean(P.DICT.en['log.rendererSrcEmpty']),
    'A21d 空选择换档时写一行**如实**的日志（`log.rendererSrcEmpty`：只切档位、预览保持空态、不挂载任何壁纸），中英各一份 —— 不再谎报"已把预览 URL 按新档位重写一次"')
  ok(/artifactClearProbe: \(\) => artifactClearProbe\(\)/.test(PATCH_SRC) && /nothingSelected: \(\) => nothingSelectedNow\(\)/.test(PATCH_SRC),
    'A21e 探针 `artifactClearProbe()`（ran/cleared/srcBefore/srcAfter/curAfter）+ `nothingSelected()`（门禁可断言"那一刻真的是未选择态"）')
}

/* ══════════════════ ④ 通用溢出自检 ══════════════════ */
section('④ 有范围的显示：通用溢出自检')
{
  ok(typeof P.overflowVerdict === 'function' && Array.isArray(P.OVERFLOW_PROBE_SELECTORS) && P.OVERFLOW_PROBE_SELECTORS.length >= 12,
    'A4a 纯函数 `overflowVerdict()` + 探针选择器清单（面板/下拉/工具条/对话框）都在',
    'selectors=' + (P.OVERFLOW_PROBE_SELECTORS || []).length)
  const clipped = P.overflowVerdict([{ sel: '#x', present: true, clientW: 100, scrollW: 160, clientH: 40, scrollH: 40, overflowXStyle: 'hidden', overflowYStyle: 'hidden' }])
  const scrollable = P.overflowVerdict([{ sel: '#y', present: true, clientW: 100, scrollW: 900, clientH: 40, scrollH: 9000, overflowXStyle: 'auto', overflowYStyle: 'auto' }])
  const visibleSpill = P.overflowVerdict([{ sel: '#v', present: true, clientW: 100, scrollW: 260, clientH: 40, scrollH: 60, overflowXStyle: 'visible', overflowYStyle: 'visible' }])
  const childOut = P.overflowVerdict([{ sel: '#z', present: true, clientW: 100, scrollW: 100, clientH: 40, scrollH: 40, overflowXStyle: 'hidden', overflowYStyle: 'hidden', offenders: [{ sel: '#z > .chip', axis: 'x', right: 300, boxRight: 100 }] }])
  ok(clipped.ok === false && clipped.bad[0].kind === 'clipped',
    'A4b 判定①：**不可滚 + hidden/clip** 的容器内容超出 ⇒ 红（`kind:"clipped"` = 真的看不见了）', JSON.stringify(clipped.bad))
  ok(scrollable.ok === true,
    'A4c 判定②：**可滚**的容器（`#list`/`#props-body`/列表那种设计如此）超出 ⇒ **不报红**（不制造假阳性）',
    JSON.stringify(scrollable))
  ok(childOut.ok === false && childOut.bad[0].kind === 'child-out',
    'A4d 判定③：**会被裁掉的**容器里子元素越界 ⇒ 红（"后面几个选项被顶出屏幕"就是这一类）', JSON.stringify(childOut.bad))
  ok(visibleSpill.ok === true && visibleSpill.spillCount === 2 && visibleSpill.bad.length === 0,
    'A4f 判定④（实测收口）：`overflow:visible` 的溢出 = **画在外面但看得见** ⇒ 如实记 `spill`、**不报红**' +
    '（第一版把它和"被裁掉"混为一谈 ⇒ 会对 `#toolbar` 换行、`#np-host` 浮层这类设计如此的结构假红）',
    JSON.stringify({ bad: visibleSpill.bad, spill: visibleSpill.spill }))
  ok(/position === '\(\)'\s*\|\|\s*cpos === 'fixed'/.test(PATCH_SRC) || /cpos === 'absolute' \|\| cpos === 'fixed'/.test(PATCH_SRC),
    'A4g 浮层（`position:absolute|fixed` 的子节点）不计入越界（`#np-host` 就是绝对定位贴在面板底部的，设计如此）')
  ok(/panelOverflowProbe: \(o\) => panelOverflowProbe\(o\)/.test(PATCH_SRC) && /function overflowRows\(\)/.test(PATCH_SRC),
    'A4e 运行期取数层 `overflowRows()/panelOverflowProbe()` 挂上 `__benchPatch`（门禁与真机同一入口）')
}

/* ══════════════════ ⑤ 选完文件夹 ⇒ 侧栏立刻重画 ══════════════════ */
section('⑤ 换库后预览/列表立刻刷新')
{
  ok(/async function refreshSidebarList\(opts\)/.test(PATCH_SRC) && /try \{ sidebar = await refreshSidebarList\(\{ reason: 'lib-dir' \}\) \}/.test(PATCH_SRC),
    'A5a ★成功切根之后**真的重画侧栏**（`refreshLibrarySoft()` 末尾 await `refreshSidebarList()`）')
  ok(/artifactPickChain/.test(PATCH_SRC) && /window\.fetch = stub/.test(PATCH_SRC) && /bench-pick-shim/.test(PATCH_SRC),
    'A5b 走**产物自己那条重载链**（`artifactPickChain`）重拉 + 重画；链上 `POST /api/library-dir {pick:true}` 用一次性 fetch 垫片就地答掉（不弹原生对话框）')
  ok(/stillThere/.test(PATCH_SRC) && /switchToWallpaper: \(id\) => switchToWallpaper\(id\)/.test(PATCH_SRC) && /currentId: \(\) => curId/.test(PATCH_SRC),
    'A5c 刷新后**按 id 复原**当前壁纸（`initSiteShell` 导出 `switchToWallpaper`/`currentId`，不经裸标识符 ⇒ 不重演 A7 的 ReferenceError）')
  ok(/"log\.listRefreshDone":/.test(PATCH_SRC) && /"log\.listRefreshDone":/.test(PATCH_SRC) && /"log\.listRefreshDropped":/.test(PATCH_SRC),
    'A5d 两条新文案中英都在（成功/新库里没有这张 ⇒ 如实说明，不假装还在渲染）')
  ok(/libRefreshProbe: \(\) => libRefreshLast/.test(PATCH_SRC),
    'A5e 探针 `libRefreshProbe()` 给出 `{ran, rows, rowsBefore, restored, released, lines}`（门禁可断言）')
}

/* ══════════════════ ⑦⑧ 调试页签：灰框 + ON/OFF ══════════════════ */
section('⑦⑧ 调试模式页签')
{
  ok(/\[\[tabLogsBtn, plan\.isLogs\], \[tabDiagBtn, plan\.isDiag\], \[tabDebugBtn, plan\.isDebug\]\]/.test(PATCH_SRC),
    'A7a ★`paintLogsTabs()` 现在把**调试页签**也纳入选中态循环（改前只有 logs/diag ⇒ 调试页签没有灰底/灰框）')
  ok(/'#logs \.logs-tab\.active\[aria-selected="true"\]\{box-shadow:inset 0 0 0 1px var\(--border\)\}'/.test(PATCH_SRC) &&
    /#logs \.logs-tab\.active\[aria-selected="true"\]\{box-shadow:inset 0 0 0 1px var\(--border\)\}/.test(staticCss),
    'A7b 选中态多一条**灰框**（`inset 0 0 0 1px var(--border)`）：静态表与补丁表逐字同款（D8 之外再点一次名）')
  ok(/function paintDbgTab\(\)/.test(PATCH_SRC) && /logs\.debugOn/.test(PATCH_SRC) && /logs\.debugOff/.test(PATCH_SRC),
    'A8a `paintDbgTab()`：文案 = `logs.debugOn / logs.debugOff`（唯一依据是复选框状态）')
  ok(/paintDbgTab\(\)\s*\/\/ ⑧ 页签文案 ON\/OFF/.test(PATCH_SRC) && /paintDbgTab\(\)\s*\/\/ ⑧ 首屏就把页签写成/.test(PATCH_SRC) &&
    /paintDbgTab\(\)\s*\/\/ ⑧ 语言切了也要/.test(PATCH_SRC),
    'A8b 三条触发链都在：模式变化（`dbgPaint()`）/ 首屏 / 语言切换（`applyLang` 里排在 `applyStaticI18n` 之后）')
  ok(/'#logs #tab-debug\[data-dbg="on"\]\{color:var\(--bench-dbg-on,#3fb950\)\}'/.test(PATCH_SRC) &&
    /'#logs #tab-debug\[data-dbg="off"\]\{color:var\(--bench-dbg-off,#e5534b\)\}'/.test(PATCH_SRC) &&
    /#tab-debug\[data-dbg="on"\]\{color:var\(--bench-dbg-on,#3fb950\)\}/.test(staticCss) &&
    /#tab-debug\[data-dbg="off"\]\{color:var\(--bench-dbg-off,#e5534b\)\}/.test(staticCss),
    'A8c ON = 正常绿 `#3fb950`、OFF = 正常红 `#e5534b`（不刺眼的中性色），两表同款')
  ok(/dbgTabState: \(\) => dbgTabState\(\),/.test(PATCH_SRC) && /function dbgTabState\(\)/.test(PATCH_SRC) &&
    /boxShadow: cs \? String\(cs\.boxShadow/.test(PATCH_SRC) && /MutationObserver[\s\S]{0,200}?paintDbgTab\(\)/.test(PATCH_SRC),
    'A8d 探针 `dbgTabState()`（checked/mode/text/ariaSelected/cls/boxGray/bg/color）')
}

/* ══════════════════ ⑨ 输出面板配色 ══════════════════ */
section('⑨ 输出面板可读配色')
{
  ok(/'#logbody\{color:var\(--fg\)\}'/.test(PATCH_SRC) && /#logbody\{color:var\(--fg\)\}/.test(staticCss),
    'A9a ★`#logbody{color:var(--fg)}`（与诊断栏 `#diag-body` 同源的可读色）静态表 + 补丁表都在（改前是产物写死的 `#ccc`，浅色主题下几乎看不见）')
  ok(!/'#logbody\{color:#ccc/.test(PATCH_SRC) && !/#logbody\{color:#ccc/.test(staticCss),
    'A9b 没有再把输出区钉回写死的 `#ccc`')
}

/* ══════════════════ ⑪ 中英单显 + wpset API 列表同源 ══════════════════ */
section('⑪ 说明 / 壁纸设置：只显示一种语言 + API 列表同源')
{
  ok(/html\[lang\]:not\(\[lang="en"\]\) \.lang-en\{display:none\}/.test(PATCH_SRC) &&
    /html\[lang\]:not\(\[lang="en"\]\) \.lang-en\{display:none\}/.test(staticCss),
    'A11a ★语言过滤选择器已修：`html[lang]:not([lang="en"]) .lang-en`（改前是 `html.bench-shell html:not(...)` = 自己是自己的后代 ⇒ 死规则 ⇒ 中英同时显示）')
  ok(!/html\.bench-shell html:not\(\[lang/.test(staticCss) && !/'html:not\(\[lang="en"\]\) \.lang-en\{display:none\}'/.test(PATCH_SRC),
    'A11b 那条死选择器在两张表里都不在了（没有"改一半留一半"）',
    /html\.bench-shell html:not\(\[lang/.test(staticCss) ? '静态表仍有死选择器' : 'ok')
  ok(/querySelectorAll\('#page-wpset \.doc-wrap\.lang-zh'\)/.test(PATCH_SRC) || /#page-wpset \.doc-wrap\.lang-zh/.test(PATCH_SRC),
    'A11c 探针 `docBilingualProbe()` 逐块读两语容器（displayOf / langFilterOk / sameRows）')
  //  静态解析：`#page-wpset` 两语表格**逐表逐行同键**（与浏览器探针同一条判据，纯 Node 也能红）
  const sec = HTML_SRC.slice(HTML_SRC.indexOf('id="page-wpset"'), HTML_SRC.indexOf('</section>', HTML_SRC.indexOf('id="page-wpset"')))
  const iz = sec.indexOf('doc-wrap lang-zh'), ie = sec.indexOf('doc-wrap lang-en')
  const rowsOf = (block) => [...block.matchAll(/<table>([\s\S]*?)<\/table>/g)].map((m) => m[1])
    .map((tb) => [...tb.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => m[1])
      .map((r) => [...r.matchAll(/<t[dh]>([\s\S]*?)<\/t[dh]>/g)].map((c) => c[1].replace(/<[^>]+>/g, '')).join('|')))
  const keyOf = (s) => ((s.match(/ui_[a-z_]+|#[a-z-]+|__wp\.[a-zA-Z]+/g) || []).join(','))
  const zh = rowsOf(sec.slice(iz, ie)).map((t) => t.map(keyOf))
  const en = rowsOf(sec.slice(ie)).map((t) => t.map(keyOf))
  const diff = []
  for (let i = 0; i < Math.max(zh.length, en.length); i++) {
    const a = zh[i] || [], b = en[i] || []
    for (let r = 0; r < Math.max(a.length, b.length); r++) if ((a[r] || '') !== (b[r] || '')) diff.push(`t${i}r${r}: zh[${a[r] || ''}] en[${b[r] || ''}]`)
  }
  ok(zh.length > 0 && zh.length === en.length && diff.length === 0,
    'A11d ★两语表格**逐表逐行同键**（改前英文表少了亮度/对比度那行的 WE 内部键）',
    diff.slice(0, 3).join(' | ') || `tables=${zh.length}/${en.length}`)
  ok(zh[2] && zh[2].length >= 12 && en[2] && en[2].length >= 12,
    'A11e ★「运行参数」那张表**补齐**到 ≥12 行（改前 5 行：漏了音量条/麦克风闸门/音条源/渲染器来源/暂停·释放/图片去重/三个日志页签）',
    JSON.stringify({ zh: zh[2] && zh[2].length, en: en[2] && en[2].length }))
}

/* ══════════════════ ⑯b 输出面板："我滚到哪就停在哪" ══════════════════ */
section('⑯b 输出面板：用户滚到哪就停在哪（产物那条无条件跳底也要挡住）')
{
  /*  ①(2026-09-25 issue0924a2 用户复测原话)「我需要的是**我鼠标滚轮滑到哪里，它就停到哪里**，无论下面刷不刷新
      都是一样的，都是我滑到哪里，他停到哪里，而不是出现一条新消息就往最下面跳。」
      ── 上一版为什么不管用（源码级根因，一行）────────────────────────────────────────────
      `#logbody` 有**两个写入者**：本补丁的 `logLine()`，与**上游产物自己**的日志函数
      `demo/assets/bench-DSKWIqmS.js` 里的 `X.appendChild(a),X.scrollTop=X.scrollHeight`（挂 `/api/diag-stream`）。
      上一版只改了前者 ⇒ 渲染器诊断/挂载日志一来（走产物那条），`scrollTop` 照样被写到底。
      ── 本版契约 ────────────────────────────────────────────────────────────────────────
      ① 位置归用户：非贴底的定位之后，**任何**追加都不许改 `scrollTop`（产物那条被影子 setter 丢弃并计数）；
      ② 贴底才跟随，且容差从 24px 收紧到 2px（24px 内仍会把用户往下拽）；
      ③ 只有用户自己滚回底部才恢复跟随。 */
  const ARTIFACT = fs.readFileSync(path.join(DEMO, 'assets', 'bench-DSKWIqmS.js'), 'utf8')
  ok(/const LOG_STICK_PX = 2/.test(PATCH_SRC),
    'A16a ★贴底容差收紧到 **2px**（改前 24px："离底 24px 以内"仍会被拽到底；用户的判据是"我停在哪就停在哪"）',
    (PATCH_SRC.match(/const LOG_STICK_PX = \d+/) || [''])[0])
  ok(/function makeScrollKeeper\(el, key\)/.test(PATCH_SRC) && /k\.installGuard = \(\) => \{/.test(PATCH_SRC) &&
    /Object\.defineProperty\(el, 'scrollTop', \{/.test(PATCH_SRC) && /dropped-auto-bottom/.test(PATCH_SRC) && /k\.installAppendHook/.test(PATCH_SRC),
    'A16b ★★根因修法：`#logbody` 上装**影子 `scrollTop` 访问器** + 追加钩子 ⇒ "刚追加完就往底部写"的那一写被判成**自动跟随**、在用户掌着位置时**丢弃并计数**（`dropped-auto-bottom`）')
  ok(/X\.appendChild\(a\),X\.scrollTop=X\.scrollHeight/.test(ARTIFACT),
    'A16c **根因证据**（产物 minified 不可改，所以修在补丁层）：产物日志函数里确实是无条件 `X.appendChild(a),X.scrollTop=X.scrollHeight` —— 上一版只改本补丁那一条，所以"还是会往下跳"',
    'artifact: ' + (ARTIFACT.match(/X\.appendChild\(a\),X\.scrollTop=X\.scrollHeight/) || [''])[0])
  const logLineSrc = PATCH_SRC.slice(PATCH_SRC.indexOf('function logLine(msg, isErr)'), PATCH_SRC.indexOf('function logLine(msg, isErr)') + 700)
  /*  允许的兜底只有一条：**拿不到守卫/容器口径**时（桩 DOM、`#logbody` 还没建）退回写到底 ——
      它必须写成 `else { … }`，不许再回到"无条件写"。 */
  ok(/const k = logKeeper\(\)/.test(logLineSrc) && /if \(k\) k\.followNow\(\)/.test(logLineSrc) &&
    /else \{ try \{ body\.scrollTop = body\.scrollHeight \} catch/.test(logLineSrc),
    'A16d `logLine()` 自己也不再写无条件跳底：追加后走 `k.followNow()`（贴底才跟随，否则一个字都不写）；直接写到底只剩"守卫不可用"那一条 `else` 兜底')
  ok(/function logScrollState\(\)/.test(PATCH_SRC) && /function logScrollProbe\(\)/.test(PATCH_SRC) && /function logScrollGuardSet\(on\)/.test(PATCH_SRC) &&
    /logScrollProbe: \(\) => logScrollProbe\(\)/.test(PATCH_SRC) && /logScrollGuardSet: \(on\) => logScrollGuardSet\(on\)/.test(PATCH_SRC),
    'A16e 探针三件套：`logScrollState()`（兼容旧读数）+ `logScrollProbe()`（guard/follow/anchor/droppedWrites/appendSeq）+ `logScrollGuardSet(on)`（**A/B**：关掉守卫就能当场复现改前那一跳 ⇒ 判据不恒真）')
  ok(/scrollKeeper\('#diag-body', 'diag'\)/.test(PATCH_SRC) && /scrollKeeper\('#dbg-log', 'dbg'\)/.test(PATCH_SRC),
    'A16f 同一条口径也套在**渲染器诊断**与**调试日志**两条流上（用户第 7 条里"诊断只有 24 条"要看得清，同样不许被新消息拽走）')
}

/* ══════════════════ ⑰ 壁纸配置里的下拉栏 ══════════════════ */
section('⑰ 壁纸配置：原生 select 一律自绘')
{
  ok(/export function watchBenchPropsSelects/.test(PATCH_SRC) &&
    /doc\.querySelectorAll\('#props select:not\(\[data-mpw-select-native\]\)/.test(PATCH_SRC) &&
    /doc\.getElementById\('props'\)\s*\|\|\s*doc\.getElementById\('props-body'\)/.test(PATCH_SRC),
    'A17a ★观察面从 `#props-body` 扩到 **`#props` 整棵子树**（面板头部那一行 `.props-row` 也在内）—— 改前往那儿插的原生 select 漏增强')
  ok(/export function panelSelectProbe/.test(PATCH_SRC) && /propsSelectProbe: \(\) => panelSelectProbe\(D\)/.test(PATCH_SRC) &&
    /propsSelectProbe: \(\) => \(window\.__benchShell/.test(PATCH_SRC),
    'A17b 探针 `panelSelectProbe()`（`native` 必须 0 / `enhanced` / `leaked`）+ shell 与 `__benchPatch` 两个出口')
  ok(!/createElement\('select'\)/.test(NO_COMMENT.replace(/D\.createElement\('select'\)\s*\n\s*sel\.id = 'bench-imgmode'/g, '')),
    'A17c 本补丁自己不再往面板里造原生 select（唯一那条 `#bench-imgmode` 已按第 3 条删除）')
}

/* ══════════════════ ⑲ 释放要真的停干净 ══════════════════ */
section('⑲ 「释放」真停干净')
{
  ok(/function releaseQuietNow\(why\)/.test(PATCH_SRC) && /frameEl\.setAttribute\('src', 'about:blank'\)/.test(PATCH_SRC) &&
    /clearInterval\(batch5Timer\); batch5Timer = null/.test(PATCH_SRC),
    'A19a ★释放三件套：停渲染器（`__wp.release()`/`setPaused(true)`）+ 清 iframe（导航到 `about:blank`）+ 停轮询（`clearInterval(batch5Timer)`）')
  ok(/if \(releasedQuiet\) return\s*\n\s*pollTick\+\+/.test(PATCH_SRC) && /let batch5Timer = setInterval\(batch5Tick, 1200\)/.test(PATCH_SRC),
    'A19b 轮询体第一行就带门闩（`releasedQuiet` ⇒ 一个字都不跑）；定时器改成可重启的具名句柄')
  ok(/reason: 'released-quiet'/.test(PATCH_SRC) && /function releaseResume\(\)/.test(PATCH_SRC) && /window\.__benchRelease = \{/.test(PATCH_SRC),
    'A19c ★不再自愈重挂：合成样例自动挂载看到门闩直接返回 `released-quiet`；用户显式再选壁纸时 `releaseResume()` 复位并重启轮询')
  ok(/releaseQuietProbe: \(\) => releaseQuietProbe\(\)/.test(PATCH_SRC) && /grewAfterRelease:/.test(PATCH_SRC) &&
    /"log\.releaseQuiet":/.test(PATCH_SRC),
    'A19d 探针 `releaseQuietProbe()`（quiet/pollRunning/frameBlank/lines/grewAfterRelease）+ 中英文案 `log.releaseQuiet`')
  ok(/releaseBtn\.addEventListener\('click', \(\) => \{/.test(PATCH_SRC) &&
    /if \(typeof artifactReleaseChain === 'function'\) artifactReleaseChain\.call\(releaseBtn\)/.test(PATCH_SRC) &&
    /try \{ releaseQuietNow\('button'\) \}/.test(PATCH_SRC),
    'A19e `#release` 上补了本补丁自己的处理器（产物那条 `E()?.release()` 在"没选中壁纸"时是空操作 —— 用户报的就是这一下）')
  ok(/function detachArtifactReleaseChain\(\)/.test(PATCH_SRC) && /releaseBtn\.onclick = null/.test(PATCH_SRC),
    'A19f ★产物那条 `#release.onclick` 被**摘下来存着**（`artifactReleaseChain`）：它在缺 `__wp.release` 的默认档\n' +
    '    每次都抛 `TypeError: E().release is not a function` —— 点击等于没做，还会弹全局错误条盖住页签条',
    /artifactReleaseChain = releaseBtn\.onclick/.test(PATCH_SRC) ? 'ok' : '未摘链')
  ok(/function installRendererApiFallbacks\(api, w\)/.test(PATCH_SRC) && /const MISSING = \['release', 'pointerLeave'\]/.test(PATCH_SRC) &&
    /apiFallbacks: \(\) =>/.test(PATCH_SRC) && /w\.__benchApiFallbacks = installed/.test(PATCH_SRC),
    'A19h ★产物**无条件**调用、而本仓渲染器档缺失的两个方法（`release` / `pointerLeave`）装上**如实登记**的降级实现：\n' +
    '     只在真缺时装 + 写进 `__benchApiFallbacks`（探针 `apiFallbacks()` 读得到）—— 改前它们每次都抛未捕获 TypeError，\n' +
    '     既让"释放"变成空操作，又把全局错误条弹出来盖住页签条（实测把整条浏览器门禁挡在半路）')
  ok(/artifactChainDetached:/.test(PATCH_SRC) && /artifactChainSaved:/.test(PATCH_SRC),
    'A19g 探针给出"产物处理器是否已摘 / 是否已存"两个读数（门禁与真机同一入口）')
}

/* ══════════════════ ⑳ 收尾：文案里不再把 :8899 当"渲染器页" ══════════════════ */
section('⑳ 收尾：测试台不依赖 :8899')
{
  /* 判据口径（与用户第 20 点收尾的原文一致）：**"必须开 8899 / 渲染器页在 8899"这类说法清零**；
     "不依赖 8899 / 不需要 8899 / no :8899 needed"这种**否定式**是这次专门写进去的事实，不算残留。
     所以：每个含 8899 的文案值都必须命中否定式，且**不许**命中旧说法（"渲染器页在 :8899" / "本机 :8899 没在跑" /
     "runs on :8899" / "is :8899 running"）。改前读数：三条文案中英各一份、全部命中旧说法。 */
  const NEG = /不需要 ?:?8899|不依赖 ?:?8899|no ?:8899|needs no ?:?8899|without ?:8899/
  const OLD = /渲染器页在 ?:?8899|本机 ?:?8899 没在跑|runs on ?:?8899|is ?:?8899 running/
  const with8899 = [], stillOld = [], notNeg = []
  for (const L of ['zh', 'en']) {
    for (const [k, v] of Object.entries(P.DICT[L])) {
      const sv = String(v)
      if (!sv.includes('8899')) continue
      with8899.push(L + '.' + k)
      if (OLD.test(sv)) stillOld.push(L + '.' + k)
      if (!NEG.test(sv)) notNeg.push(L + '.' + k)
    }
  }
  ok(stillOld.length === 0 && with8899.length === 3 * 2,
    'A20a ★面向用户的词典里**不再有"必须开 8899 / 渲染器页在 8899"**的说法（改前：bandfeed.noReport / ' +
    'toolbar.rendererSrcTip / rendererSrc.unreachable 中英共 6 处全部是旧说法）',
    `含 8899 的键=${with8899.length}（都是否定式）旧说法=${stillOld.join(',') || '0'}`)
  ok(notNeg.length === 0,
    'A20a2 每处 8899 都在**否定语境**里（"不依赖 / 不需要 / no :8899"）—— 不是把端口当依赖写回文案',
    notNeg.join(',') || '全部是否定式')
  ok(/不需要 :8899|不依赖 :8899|no :8899/.test(PATCH_SRC),
    'A20b 新文案明确写出"8902 自己直供 /webloader/，不需要 8899"')
  const zhK = Object.keys(P.DICT.zh), enK = Object.keys(P.DICT.en)
  const onlyZh = zhK.filter((k) => !enK.includes(k)), onlyEn = enK.filter((k) => !zhK.includes(k))
  ok(zhK.length === enK.length && onlyZh.length === 0 && onlyEn.length === 0,
    'A20c 词典中英**键数对称**（每个新文案两侧都有）', `zh=${zhK.length} en=${enK.length} 单侧=${onlyZh.concat(onlyEn).join(',') || '无'}`)
  ok(!!P.DICT.zh['logs.debugOn'] && !!P.DICT.en['logs.debugOn'] && !!P.DICT.zh['logs.debugOff'] && !!P.DICT.en['logs.debugOff'] &&
    P.DICT.zh['logs.debugOn'] !== P.DICT.zh['logs.debugOff'],
    'A20d 第 8 条的两条新键中英都在且互不相同', JSON.stringify([P.DICT.zh['logs.debugOn'], P.DICT.zh['logs.debugOff'], P.DICT.en['logs.debugOn'], P.DICT.en['logs.debugOff']]))
}

/* ══════════════════ 汇总 ══════════════════ */
console.log(`\n═══ 汇总：PASS=${pass} FAIL=${failed.length} ═══`)
for (const f of failed) console.log('  FAIL ' + f.name + (f.reading ? ' — ' + f.reading : ''))
try { fs.writeSync(1, 'BENCH-0924A-A-JSON ' + JSON.stringify({ pass, failed: failed.map((f) => ({ name: f.name, reading: f.reading })) }) + '\n') } catch { /* 已关 */ }
if (JSON_OUT) console.log(JSON.stringify({ pass, failed }, null, 1))
process.exit(failed.length === 0 ? 0 : 1)
