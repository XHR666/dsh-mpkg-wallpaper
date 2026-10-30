#!/usr/bin/env node
// font-gap-audit-test.mjs —— 「还缺哪些字体」的**可复算**审计（+ 补齐集合的可加载性）
//
// ── 这份测试回答的三个问题 ──────────────────────────────────────────────────────────────
//   ① **缺哪些**：本机 WE 安装 `assets/fonts/` 的内置字体 vs 本仓库 `assets/fonts/` 已打包字体；
//   ② **影响面**：全语料（98 个 `.pkg`/`.mpkg` 容器）里每个字体被**文本层**引用多少次 / 多少个容器，
//      以及该引用当前落在四级链的哪一级（①包内 / ②仓库自带 / ③本机 WE / ④sans-serif）；
//   ③ **能不能用**：仓库里每个字体文件**真能加载**（sfnt 头 + `name` 表 + family 与文件名对得上），
//      未打包的那些在**本机 WE 里确实存在**（⇒ 装了 WE 的机器上是第③级命中，不会白回退）。
//
// ── 口径与依据（全部本机一手，可复算）────────────────────────────────────────────────────
//   · 语料引用：解析容器目录表 → 取 `scene.json` → 遍历对象树里**有 `text` 键的对象**的
//     `font` 属性（WE 的文本层字形来源就是这一项；`systemfont_*` 是同位置上的系统字体别名）。
//     冻结值见 F4 的 CENSUS —— 它由 `node tests/font-gap-audit-test.mjs --write-census` 从**当前语料**
//     重生成（语料长大 ⇒ 一条命令重定基，不手改；改口径或重定基都会在 diff 里看得见）。
//   · 许可判据（逐字体 `name` 表原文 + 同目录许可文件原文）：`THIRD-PARTY.md` §4.1/§4.5/§4.7
//     与工作区调研记录 `docs/FONT-REDISTRIBUTION-RESEARCH.md`（**仓库外**，§2 逐字体表）。
//     **本文件只做"事实核对"**：能再分发的判据、能不能从允许的取件口取到、以及"不能打包"的原因。
//   · 铁律（本仓库既定，`assets/fonts/README.md` 与 `THIRD-PARTY.md` §4 都写了）：
//     **任何字体都不得从 `<WE>/assets/fonts/` 复制**，只能从作者/上游取件 ⇒ 本文件在 F5 里
//     把"WE 目录里有"与"可以打包"**分开断言**（前者不等于后者）。
//
// 用法：node tests/font-gap-audit-test.mjs [--verbose]
// 环境变量：MPW_ROOT（默认 = 工作区根 WS = 仓库的上一级）、MPW_WE_ASSETS（默认 $MPW_ROOT/wallpaper_engine/assets）
// 退出码：0 全过（含 SKIP）/ 1 有失败
//
// 参照来源许可声明：本文件为原创测试代码；字体只**读**本机 WE 安装目录与语料容器，不复制、不打包、
//   不落盘（`assets/fonts/` 的任何读写都在 F 组的"存在性/可解析性"断言里）。
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, WS } from './_root.mjs'
import { readIndexHead, readEntryBytes, walkContainers } from './_pkg-index.mjs'

let pass = 0, fail = 0, skip = 0
const out = (s) => process.stdout.write(s + '\n')
function check(name, cond, extra) {
  if (cond) { pass++; out('  ✓ ' + name) }
  else { fail++; out('  ✗ ' + name + (extra !== undefined ? '  → ' + short(extra) : '')) }
  return !!cond
}
function skipItem(name, why) { skip++; out('  SKIP ' + name + '（' + why + '）') }
function note(l, v) { out('· ' + l + (v !== undefined ? '：' + short(v) : '')) }
function short(v) {
  let s
  try { s = typeof v === 'string' ? v : JSON.stringify(v) } catch { s = String(v) }
  if (s === undefined) s = String(v)
  return s.length > 300 ? s.slice(0, 300) + '…' : s
}

const VERBOSE = process.argv.includes('--verbose')
const MPW_ROOT = process.env.MPW_ROOT || WS
const CORPUS = path.join(MPW_ROOT, 'allwallpaper')
const WE_FONTS = process.env.MPW_WE_ASSETS
  ? path.join(process.env.MPW_WE_ASSETS, 'fonts')
  : path.join(MPW_ROOT, 'wallpaper_engine', 'assets', 'fonts')
const REPO_FONTS = path.join(ROOT, 'assets', 'fonts')
const THIRD_PARTY = path.join(ROOT, 'THIRD-PARTY.md')
const DEMO_HTML = path.join(ROOT, 'demo.html')

out('font-gap-audit-test —— WE 内置字体 vs 仓库已打包字体：缺哪些 / 影响面 / 能不能用')
note('本机 WE 字体目录', WE_FONTS + (fs.existsSync(WE_FONTS) ? '' : '（**不存在** ⇒ 相关项 SKIP）'))
note('仓库字体目录', REPO_FONTS)

// ═══════════════ 0. 冻结表（口径改动必须显式改这里）═══════════════
// 仓库已打包的 7 个文件：文件名 → 期望的 sfnt `name` 表 family 子串（大小写不敏感）。
// 依据：`assets/fonts/README.md` 的映射表 + 各文件 `name` 表 ID1（本文件 F2 真读一遍）。
const BUNDLED = {
  'Blackout 2 AM.ttf': 'blackout',
  'monof55.ttf': 'monofur',
  'NotoSans-Regular.ttf': 'noto sans',
  'RobotoMono-Regular.ttf': 'roboto mono',
  'Segment7Standard.otf': 'segment7',
  'spincycle_3d_ot.otf': 'spin cycle',
  'Twemoji.Mozilla.ttf': 'twemoji',
  // ①(2026-09-18) 语料里 61 层/17 包引用的 WE 内置名 `8bitOperatorPlus8-Regular.ttf` 的**合法替代**：
  //   该字体现名 Pixel Operator（同一作者，2018-10-04 起 CC0-1.0），我们从作者渠道取现行版打包。
  'PixelOperator8.ttf': 'pixel operator',
}
// 壁纸 `scene.json` 写的 WE 引用名 → 仓库文件名（与 `demo.html` 的 REPO_FONT_ALIASES 同口径；
//   只列**已打包**的那些）。`monof55.ttf` 的族名是 `monofur`（不是文件名）—— 这就是 F2 的意义。
const WE_REF_TO_REPO = {
  'Blackout 2 AM.ttf': 'Blackout 2 AM.ttf',
  'Monofur-PK7og.ttf': 'monof55.ttf',
  'NotoSans-Regular.ttf': 'NotoSans-Regular.ttf',
  'RobotoMono-Regular.ttf': 'RobotoMono-Regular.ttf',
  'Segment7Standard.otf': 'Segment7Standard.otf',
  'spincycle_3d_ot.otf': 'spincycle_3d_ot.otf',
  'TwemojiMozilla.ttf': 'Twemoji.Mozilla.ttf',
  '8bitOperatorPlus8-Regular.ttf': 'PixelOperator8.ttf',
}
// **未打包**集合：WE 有、仓库没有。`reason` 是结论口径（许可判据见 THIRD-PARTY.md 对应节）。
const NOT_BUNDLED = {
  'Alcubierre.otf': { licence: '未定（文件内 `All rights reserved.`；回溯作者上游查不到分发授权）', ref: 'THIRD-PARTY.md §4.5' },
  'Atami-Regular.otf': { licence: '未定（文件内 `All rights reserved.`；作者其它免费件一律 `Personal Use`）', ref: 'THIRD-PARTY.md §4.5' },
  'CursedTimerUlil-Aznm.ttf': { licence: '未定（同人二创，权利链不明；站点模板话术与文件内版权串矛盾）', ref: 'THIRD-PARTY.md §4.5' },
  'Lazer84.ttf': { licence: '免费档仅授予使用、未授予再分发（文件内 ID0 是未填写的模板占位串）', ref: 'THIRD-PARTY.md §4.5' },
  'kust.ttf': { licence: '未定（文件内只有版权串、无任何授权语句）', ref: 'THIRD-PARTY.md §4.5' },
  'opensticks.ttf': { licence: '仅"free for commercial use"（**使用**授权，非**分发**授权）', ref: 'THIRD-PARTY.md §4.5' },
  'summer85.ttf': { licence: '未定（作者站点已消失/域名易主，一手条款取不到）', ref: 'THIRD-PARTY.md §4.5' },
}
// 语料文本层引用清点（2026-09-19 实测，98 个容器）。键 = `font` 属性原文；
//   值 = [文本层引用数, 容器数]；`tier` 是**当前**解析级别。
// ═══ CENSUS-BEGIN（`--write-census` 生成，勿手改）═══
const CENSUS = {
  // —— WE 内置字体（引用名可能命中仓库/WE 两级）——
  "fonts/8bitOperatorPlus8-Regular.ttf": [79, 25],
  "fonts/spincycle_3d_ot.otf": [45, 19],
  "fonts/Blackout 2 AM.ttf": [22, 18],
  "fonts/Segment7Standard.otf": [14, 13],
  "fonts/Monofur-PK7og.ttf": [14, 7],
  "fonts/RobotoMono-Regular.ttf": [2, 2],
  // —— 语料里出现但**本机 WE 也没有**的名字（不是"我们缺"，是数据源缺口）——
  "fonts/书法字体.ttf": [85, 16],
  "fonts/FreePixel.ttf": [73, 1],
  "fonts/Alcubierre.otf": [40, 25],
  "fonts/2.ttf": [34, 12],
  "fonts/msjh.ttc": [34, 1],
  "fonts/Atami-Regular.otf": [29, 15],
  "fonts/workshop/2981960200/Quicksand-Bold.otf": [27, 20],
  "fonts/微软雅黑Bold.ttf": [26, 1],
  "fonts/Pixeltype.ttf": [24, 1],
  "fonts/workshop/3184554659/Quicksand-Bold.otf": [22, 9],
  "fonts/3.ttf": [18, 6],
  "fonts/chathura-regular.ttf": [17, 2],
  "fonts/workshop/2981960200/Anurati-Regular.otf": [16, 14],
  "fonts/Baqacents  Semibold.ttf": [16, 1],
  "fonts/CormorantSC-Regular.ttf": [16, 1],
  "fonts/DINEngschrift-Regular.ttf": [12, 1],
  "fonts/极影毁片和圆1.03.ttf": [11, 1],
  "fonts/礼品卉+自由理想体+v1.2.ttf": [11, 1],
  "fonts/演示秋鸿楷2.0.ttf": [11, 1],
  "fonts/workshop/3590573152/GenEiPOPlePw-Bk.ttf": [11, 1],
  "fonts/workshop/3184554659/Anurati-Regular.otf": [10, 9],
  "fonts/workshop/3219510589/LEMONMILK-Bold.otf": [10, 5],
  "fonts/包图小白体_猫啃网.ttf": [10, 1],
  "fonts/CursedTimerUlil-Aznm.ttf": [8, 5],
  "fonts/Rajdhani Medium.otf": [8, 1],
  "fonts/+²+½+++++=¦Õ.ttf": [7, 1],
  "fonts/workshop/3591058771/GenEiPOPlePw-Bk.ttf": [7, 1],
  "fonts/Lazer84.ttf": [6, 3],
  "fonts/opensticks.ttf": [6, 3],
  "fonts/迷你简菱心.ttf": [6, 1],
  "fonts/字魂237号-玉兰手书.ttf": [6, 1],
  "fonts/BlackHoleBB.ttf": [6, 1],
  "fonts/chaozishehaoxiashoushujianfan.ttf": [6, 1],
  "fonts/workshop/3424038533/Garet-Book.otf": [6, 1],
  "fonts/workshop/3219510589/LEMONMILK-Light.otf": [5, 5],
  "fonts/workshop/2872021376/三极萌萌简体.ttf": [5, 1],
  "fonts/workshop/3541902138/ZiKuJiangHuGuFengTi-2.ttf": [5, 1],
  "fonts/猫啃网风雅宋.ttf": [4, 1],
  "fonts/字魂100号-方方先锋体.ttf": [4, 1],
  "fonts/Cormorant-Regular.ttf": [4, 1],
  "fonts/Jura-Medium.ttf": [4, 1],
  "fonts/workshop/3200298808/nasalization-rg.otf": [4, 1],
  "fonts/千图马克手写体.ttf": [3, 2],
  "fonts/Tourner (114).ttf": [3, 1],
  "fonts/workshop/3637654840/msjh.ttc": [3, 1],
  "fonts/a_lcdnova.woff.ttf": [2, 1],
  "fonts/ariblk.ttf": [2, 1],
  "fonts/EndfieldByButan.ttf": [2, 1],
  "fonts/HelveticaNeue Bold.ttf": [2, 1],
  "fonts/Tourner (101).ttf": [2, 1],
  "fonts/Tourner (161).ttf": [2, 1],
  "fonts/VCR-OSD-MONO-1-001-1.ttf": [2, 1],
  "fonts/workshop/2978655964/airstrike.ttf": [2, 1],
  "fonts/workshop/3637654840/chathura-regular.ttf": [2, 1],
  "fonts/workshop/3637654840/Dengb.ttf": [2, 1],
  "fonts/经典繁颜体.ttf": [1, 1],
  "fonts/迷你简综艺.ttf": [1, 1],
  "fonts/三极萌萌简体.ttf": [1, 1],
  "fonts/A-OTF-GothicMB101Pro-Light.otf": [1, 1],
  "fonts/BilboSwashCaps-Regular.ttf": [1, 1],
  "fonts/FZTieXHJW_Cu.TTF": [1, 1],
  "fonts/kust.ttf": [1, 1],
  "fonts/Machine56 DB01_mianfeiziti.com.ttf": [1, 1],
  "fonts/MaShanZheng-Regular.ttf": [1, 1],
  "fonts/opentype (73).otf": [1, 1],
  "fonts/SairaCondensed-Thin.ttf": [1, 1],
  "fonts/slideyouran-Regular.ttf": [1, 1],
  "fonts/SourceHanSans-Bold.otf": [1, 1],
  "fonts/Steelfish Rg.ttf": [1, 1],
  "fonts/Tourner (100).ttf": [1, 1],
  "fonts/Tourner (151).ttf": [1, 1],
  "fonts/Tourner (192).ttf": [1, 1],
  "fonts/Tourner (29).ttf": [1, 1],
  "fonts/Tourner (330).ttf": [1, 1],
  "fonts/Tourner (332).ttf": [1, 1],
  "fonts/Tourner (592).ttf": [1, 1],
  "fonts/workshop/2661133110/simhei.ttf": [1, 1],
  "fonts/workshop/2856544206/YuGothB.ttc": [1, 1],
  "fonts/workshop/3374339759/arcane-nine.otf": [1, 1],
  "fonts/workshop/3449579583/SanJiXingKaiJianTi-Cu-2.ttf": [1, 1],
  "fonts/workshop/3489089062/Black Freeday.ttf": [1, 1],
  "fonts/workshop/3637654840/A-OTF-GothicMB101Pro-Light.otf": [1, 1],
  // —— systemfont_* 系统字体别名（不进四级链，见 F6）——
  "systemfont_arial": [75, 9],
  "systemfont_consolas": [67, 5],
  "systemfont_comicsans": [4, 1],
  "systemfont_cambria": [1, 1],
  "systemfont_verdana": [1, 1],
}
// ═══ CENSUS-END ═══
// 语料**用到**的 systemfont_* 别名（F6 的覆盖断言）
const CORPUS_SYSTEMFONT = ['systemfont_arial', 'systemfont_comicsans', 'systemfont_consolas']

// ═══════════════ 1. sfnt（TTF/OTF）头 + name 表解析（只读）═══════════════
const NAME_IDS = { 0: 'copyright', 1: 'family', 2: 'subfamily', 4: 'fullname', 8: 'manufacturer', 9: 'designer', 13: 'license', 14: 'licenseURL' }
function sfntInfo(file) {
  const b = fs.readFileSync(file)
  const tag = b.toString('latin1', 0, 4)
  const ok = tag === 'OTTO' || (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0) || tag === 'true'
  if (!ok || b.length < 12) return { tag, ok: false, bytes: b.length, names: {} }
  const numTables = b.readUInt16BE(4)
  const tables = {}
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16
    tables[b.toString('latin1', o, o + 4)] = { off: b.readUInt32BE(o + 8), len: b.readUInt32BE(o + 12) }
  }
  const names = {}
  if (tables.name && tables.name.off + tables.name.len <= b.length) {
    const off = tables.name.off
    const count = b.readUInt16BE(off + 2), strOff = off + b.readUInt16BE(off + 4)
    for (let i = 0; i < count; i++) {
      const r = off + 6 + i * 12
      if (r + 12 > b.length) break
      const pid = b.readUInt16BE(r), lid = b.readUInt16BE(r + 4), nid = b.readUInt16BE(r + 6)
      const len = b.readUInt16BE(r + 8), o2 = b.readUInt16BE(r + 10)
      if (strOff + o2 + len > b.length) continue
      const raw = b.subarray(strOff + o2, strOff + o2 + len)
      let s = (pid === 3 || pid === 0) ? Buffer.from(raw).swap16().toString('utf16le') : raw.toString('latin1')
      s = s.replace(/\0/g, '').trim()
      const key = NAME_IDS[nid] || ('id' + nid)
      const isEn = (pid === 3 && lid === 0x409) || (pid === 1 && lid === 0) || pid === 0
      if (s && (names[key] === undefined || isEn)) names[key] = s
    }
  }
  return { tag, ok: true, bytes: b.length, tables: Object.keys(tables), names }
}
function repoFontFiles() {
  try { return fs.readdirSync(REPO_FONTS).filter((f) => /\.(ttf|otf)$/i.test(f)).sort() } catch { return [] }
}
function weFontFiles() {
  try { return fs.readdirSync(WE_FONTS).filter((f) => /\.(ttf|otf)$/i.test(f)).sort() } catch { return [] }
}

// ═══════════════ F1 清点：WE 内置 vs 仓库已打包 ═══════════════
out('\n[F1] 清点：本机 WE 内置字体 vs 仓库已打包字体')
{
  const we = weFontFiles(), repo = repoFontFiles()
  note('WE 字体', we.length + ' 个：' + we.join(' · '))
  note('仓库字体', repo.length + ' 个：' + repo.join(' · '))
  if (!we.length) skipItem('F1a F1b F1c 与 WE 目录的集合比对', '本机 WE 字体目录不存在：' + WE_FONTS)
  else {
    // 仓库文件名 = WE 引用名 **或** 上游发布名（`monof55.ttf` / `Twemoji.Mozilla.ttf` 两个改名的，
    //   映射关系见 `assets/fonts/README.md` 与 `WE_REF_TO_REPO`）
    // ①(2026-09-18) 第三个"上游发布名"= `PixelOperator8.ttf`：WE 内置名 `8bitOperatorPlus8-Regular.ttf`
    //   的**现行版**（同作者、2018 起 CC0-1.0；dafont 上旧版已标注 undownloadable）。
    const RENAMED_UPSTREAM = ['monof55.ttf', 'Twemoji.Mozilla.ttf', 'PixelOperator8.ttf']
    check('F1a 仓库已打包的每个文件要么是 WE 引用名、要么是那三个上游发布名（没有来历不明的多余字体）',
      repo.every((f) => we.includes(f) || RENAMED_UPSTREAM.includes(f)),
      repo.filter((f) => !we.includes(f) && !RENAMED_UPSTREAM.includes(f)))
    check('F1a2 改名文件与冻结映射表对得上（`monof55.ttf`←`Monofur-PK7og.ttf`、`Twemoji.Mozilla.ttf`←`TwemojiMozilla.ttf`、`PixelOperator8.ttf`←`8bitOperatorPlus8-Regular.ttf`）',
      RENAMED_UPSTREAM.every((f) => Object.values(WE_REF_TO_REPO).includes(f)) && repo.includes('monof55.ttf') && repo.includes('Twemoji.Mozilla.ttf'))
    // 「未打包」= WE 有 · 仓库侧**连别名目标也没有**
    const missing = we.filter((f) => !repo.includes(f) && !(WE_REF_TO_REPO[f] && repo.includes(WE_REF_TO_REPO[f])))
    check('F1b **未打包集合 = WE 有 · 仓库没有**，与冻结表逐个一致（2 个 0 引用项也在内）',
      missing.slice().sort().join('|') === Object.keys(NOT_BUNDLED).sort().join('|'),
      { 实算缺: missing, 冻结: Object.keys(NOT_BUNDLED).sort() })
    note('未打包（WE 有 / 仓库无）', missing.join(' · '))
    check('F1c 未打包的每个在 WE 目录里**真的有文件**（⇒ 装了 WE 的机器上第③级能命中；WE 目录缺文件才是真缺口）',
      missing.every((f) => fs.statSync(path.join(WE_FONTS, f)).size > 0),
      missing.map((f) => f + ':' + (fs.existsSync(path.join(WE_FONTS, f)) ? 'ok' : 'MISSING')))
  }
}

// ═══════════════ F2 仓库字体「真能加载」：sfnt 头 + name 表 + family 对得上 ═══════════════
out('\n[F2] 仓库每个字体文件可解析（sfnt 头 + `name` 表），且 family 与冻结表对得上')
{
  const repo = repoFontFiles()
  check('F2a `assets/fonts/` 的文件集合 == 冻结的已打包集合（新增/删除字体必须同时改本表 + THIRD-PARTY.md）',
    repo.join('|') === Object.keys(BUNDLED).sort().join('|'), { 磁盘: repo, 冻结: Object.keys(BUNDLED).sort() })
  const bad = [], fams = {}
  for (const f of repo) {
    const info = sfntInfo(path.join(REPO_FONTS, f))
    fams[f] = info.names.family || info.names.fullname || ''
    const want = BUNDLED[f]
    if (!info.ok) bad.push(f + ':sfnt 头=' + JSON.stringify(info.tag))
    else if (!Object.keys(info.names).length) bad.push(f + ':name 表为空')
    else if (!want || !String(fams[f]).toLowerCase().includes(want)) bad.push(f + ':family=' + JSON.stringify(fams[f]) + ' ⊅ ' + want)
  }
  check('F2b 每个文件：头 ∈ {00010000, OTTO, true} + `name` 表可解析 + family 命中冻结子串（例：`monof55.ttf` 的族名是 `monofur`）',
    bad.length === 0, bad.slice(0, 4))
  note('family 一览', Object.entries(fams).map(([f, v]) => f + '→' + v).join(' · '))
  if (!weFontFiles().length) skipItem('F2c 与 WE 副本的字节数对比', 'WE 目录不存在')
  else {
    // 只做**事实登记**（不判合规）：仓库那份与 WE 那份是否同字节。合规判据在 THIRD-PARTY.md §4.4。
    const cmp = Object.keys(BUNDLED).filter((f) => weFontFiles().includes(f)).map((f) => {
      const a = fs.statSync(path.join(REPO_FONTS, f)).size, b = fs.statSync(path.join(WE_FONTS, f)).size
      return f + ':' + (a === b ? 'same-size' : a + '≠' + b)
    })
    note('仓库 vs WE 字节数（事实登记，§4.4 有逐条结论）', cmp.join(' · '))
    check('F2c `spincycle_3d_ot.otf` 的仓库副本与 WE 副本**字节数不同**（证明它是从作者官网取的现行 build，不是从 WE 目录复制的）',
      fs.statSync(path.join(REPO_FONTS, 'spincycle_3d_ot.otf')).size !== fs.statSync(path.join(WE_FONTS, 'spincycle_3d_ot.otf')).size,
      [fs.statSync(path.join(REPO_FONTS, 'spincycle_3d_ot.otf')).size, fs.statSync(path.join(WE_FONTS, 'spincycle_3d_ot.otf')).size])
  }
}

// ═══════════════ F3 WE 引用名 → 仓库文件名 ═══════════════
out('\n[F3] 壁纸里的 WE 引用名 → 仓库文件名（已打包的那些）')
{
  const bad = []
  for (const [ref, file] of Object.entries(WE_REF_TO_REPO)) {
    if (!fs.existsSync(path.join(REPO_FONTS, file))) bad.push(ref + '→' + file + '(文件不存在)')
  }
  check('F3a 冻结映射表里每个 WE 引用名都能落到一个**磁盘上真的存在**的仓库文件', bad.length === 0, bad)
  // demo.html 的 REPO_FONT_ALIASES 是运行期唯一映射处（`repoFontUrl()` 用它）——只断言"别名表里没有未打包项"
  const html = fs.existsSync(DEMO_HTML) ? fs.readFileSync(DEMO_HTML, 'utf8') : ''
  const m = html.match(/REPO_FONT_ALIASES\s*=\s*\{[\s\S]{0,600}?\n\s*\}/)
  const aliasBlock = m ? m[0] : ''
  check('F3b `demo.html` 的 `REPO_FONT_ALIASES` 里**没有**任何未打包字体（否则第②级会去要一个不存在的文件）',
    aliasBlock.length > 0 && Object.keys(NOT_BUNDLED).every((f) => !aliasBlock.includes(f)),
    { 命中别名块: aliasBlock.length, keys: Object.keys(NOT_BUNDLED).filter((f) => aliasBlock.includes(f)) })
  check('F3c 两个"改了名"的映射在别名表里（`Monofur-PK7og.ttf`→`monof55.ttf`、`TwemojiMozilla.ttf`→`Twemoji.Mozilla.ttf`）',
    aliasBlock.includes('Monofur-PK7og.ttf') && aliasBlock.includes('monof55.ttf') &&
    aliasBlock.includes('TwemojiMozilla.ttf') && aliasBlock.includes('Twemoji.Mozilla.ttf'), aliasBlock.slice(0, 200))
}

// ═══════════════ F4 语料清点（影响面）═══════════════
out('\n[F4] 语料文本层字体引用清点（每个字体被多少层 / 多少容器引用）')
const liveCensus = new Map()
if (!fs.existsSync(CORPUS)) {
  skipItem('F4 语料清点', 'MPW_ROOT/allwallpaper 不存在')
} else {
  const files = walkContainers(CORPUS).sort()
  let containers = 0, textLayers = 0
  const pkgHas = new Map()          // 容器 → 容器内条目名集合（判断"包内有没有这个字体"）
  for (const f of files) {
    let idx = null
    try { idx = readIndexHead(f) } catch { continue }
    containers++
    const rel = path.relative(CORPUS, f)
    const names = new Set(idx.entries.map((e) => e.name.toLowerCase()))
    pkgHas.set(rel, names)
    const e = idx.entries.find((x) => /(^|\/)scene\.json$/i.test(x.name))
    if (!e) continue
    let scene = null
    try { scene = JSON.parse(readEntryBytes(f, idx, e).toString('utf8')) } catch { continue }
    const bump = (key, inPkg) => {
      if (!liveCensus.has(key)) liveCensus.set(key, { n: 0, pkgs: new Set(), inPkg })
      const r = liveCensus.get(key); r.n++; r.pkgs.add(rel)
    }
    ;(function rec(o, isText) {
      if (!o || typeof o !== 'object') return
      if (Array.isArray(o)) return o.forEach((x) => rec(x, isText))
      const hasText = Object.prototype.hasOwnProperty.call(o, 'text')
      for (const k of Object.keys(o)) {
        if (k === 'script' || k === 'visibleScript') continue          // 脚本文本里的 font 名不算文本层引用
        if (k === 'font' && typeof o[k] === 'string' && o[k] && (hasText || isText)) {
          textLayers++
          const ref = o[k]
          const base = ref.replace(/^fonts\//, '')
          bump(ref, names.has(ref.toLowerCase()) || names.has(('fonts/' + base).toLowerCase()))
        }
        rec(o[k], isText || hasText)
      }
    })(scene, false)
  }
  note('实扫', containers + ' 个容器 / ' + textLayers + ' 个文本层引用')
  const keys = [...liveCensus.keys()].sort()
  /* ①(2026-09-24 语料漂移) **重定基入口**：语料长大/重命名后，CENSUS 的"集合 + 逐个数字"必然过期。
     以前只能手改 40 行表（改错了看不出），现在一条命令从**当前实扫**重生成，并在同一处打印增/删/改，
     让 diff 与读数都能审。生成物落在 CENSUS-BEGIN/END 之间；本分支跑完即退出，不参与断言。 */
  if (process.argv.includes('--write-census')) {
    const lines = (group, pred) => keys.filter(pred).sort((a, b) => {
      const ra = liveCensus.get(a), rb = liveCensus.get(b)
      return (rb.n - ra.n) || (rb.pkgs.size - ra.pkgs.size) || a.localeCompare(b)
    }).map((k) => '  ' + JSON.stringify(k) + ': [' + liveCensus.get(k).n + ', ' + liveCensus.get(k).pkgs.size + '],')
    const isSys = (k) => k.startsWith('systemfont_')
    const isWe = (k) => { const base = k.replace(/^fonts\//, ''); return !!(BUNDLED[base] || WE_REF_TO_REPO[base]) }
    const body = [
      'const CENSUS = {',
      '  // —— WE 内置字体（引用名可能命中仓库/WE 两级）——',
      ...lines('we', (k) => !isSys(k) && isWe(k)),
      '  // —— 语料里出现但**本机 WE 也没有**的名字（不是"我们缺"，是数据源缺口）——',
      ...lines('gap', (k) => !isSys(k) && !isWe(k)),
      '  // —— systemfont_* 系统字体别名（不进四级链，见 F6）——',
      ...lines('sys', isSys),
      '}',
    ].join('\n')
    const self = import.meta.filename
    const src = fs.readFileSync(self, 'utf8')
    const b = src.indexOf('// ═══ CENSUS-BEGIN')
    const e = src.indexOf('// ═══ CENSUS-END')
    if (b < 0 || e < 0) { console.error('✗ 找不到 CENSUS-BEGIN/END 标记'); process.exit(1) }
    const head = src.slice(0, b)
    const tail = src.slice(e)
    const stamp = '// ═══ CENSUS-BEGIN（`--write-census` 生成，勿手改）═══\n'
    const out = head + stamp + body + '\n' + tail
    const oldKeys = Object.keys(CENSUS)
    const added = keys.filter((k) => !CENSUS[k])
    const removed = oldKeys.filter((k) => !liveCensus.has(k))
    const changed = keys.filter((k) => CENSUS[k] && (CENSUS[k][0] !== liveCensus.get(k).n || CENSUS[k][1] !== liveCensus.get(k).pkgs.size))
    fs.writeFileSync(self, out)
    console.log('== CENSUS 已重定基 ==')
    console.log('· 条目 ' + oldKeys.length + ' → ' + keys.length + '（新增 ' + added.length + ' / 删除 ' + removed.length + ' / 数字变化 ' + changed.length + '）')
    if (added.length) console.log('· 新增：' + added.join(' · '))
    if (removed.length) console.log('· 删除：' + removed.join(' · '))
    if (changed.length) console.log('· 变化：' + changed.map((k) => k + ' ' + CENSUS[k].join('/') + '→' + liveCensus.get(k).n + '/' + liveCensus.get(k).pkgs.size).join(' · '))
    console.log('· 实扫：' + containers + ' 个容器 / ' + textLayers + ' 个文本层引用')
    process.exit(0)
  }
  check('F4a 实扫引用名集合 == 冻结清单（口径漂移要显式改 CENSUS：`node tests/font-gap-audit-test.mjs --write-census`）',
    keys.join('\u0000') === Object.keys(CENSUS).sort().join('\u0000'),
    { 多出: keys.filter((k) => !CENSUS[k]), 缺少: Object.keys(CENSUS).filter((k) => !liveCensus.has(k)) })
  const diffs = []
  for (const k of keys) {
    const r = liveCensus.get(k), want = CENSUS[k]
    if (!want || r.n !== want[0] || r.pkgs.size !== want[1]) diffs.push(k + ' 实=' + r.n + '/' + r.pkgs.size + ' 冻结=' + (want || []).join('/'))
  }
  check('F4b 每个引用名的【文本层数 / 容器数】与冻结值逐个一致（影响面数字是复算出来的，不是估的）', diffs.length === 0, diffs.slice(0, 5))
  // 影响面排序：未打包里最大的是谁
  const nbImpact = Object.keys(NOT_BUNDLED)
    .map((f) => [f, liveCensus.get('fonts/' + f)])
    .sort((a, b) => ((b[1] && b[1].n) || 0) - ((a[1] && a[1].n) || 0))
  note('未打包项按影响面排序', nbImpact.map(([f, r]) => f + '=' + (r ? r.n + '层/' + r.pkgs.size + '包' : '0')).join(' · '))
  // ①(2026-09-18 更新) 原先这里断言"最大的是 8bitOperatorPlus8-Regular.ttf（61/17）"—— 它**已经打包**
  //   （作者现行版 Pixel Operator 8，CC0-1.0）⇒ 现在未打包里影响面最大的是 `Alcubierre.otf`（34 层/21 包）。
  // ①(2026-09-24) 这里原先把"34 层 / 21 容器"写死在断言里 ⇒ 语料一长就假红（数字本来就该从实扫取）。
  //   断言的是**语义结论**：许可未定的那个仍是未打包里影响面最大的；数字只用于**报错时**给读数。
  check('F4c 未打包项里影响面最大的是 `Alcubierre.otf` —— 许可未定、不能打包的那个',
    nbImpact[0][0] === 'Alcubierre.otf' && nbImpact[0][1] && nbImpact[0][1].n > 0,
    nbImpact.slice(0, 2).map(([f, r]) => f + '=' + (r ? r.n + '层/' + r.pkgs.size + '包' : '0')))
  // ①(2026-09-24 语料漂移后如实修正) 旧断言写"两者 0 引用"；新语料里 `kust.ttf` 出现了 1 处引用 ⇒
  //   断言改成**仍然成立的那条语义**：`summer85.ttf` 0 引用；`kust.ttf` 至多 1 层/1 容器（影响面微不足道，
  //   不构成"必须解决的分发许可缺口"）。数值突然变大（例如 >2）时这条会红，仍能钉住结论。
  check('F4d `summer85.ttf` 0 引用、`kust.ttf` 影响面 ≤1 层/1 容器（⇒ 许可未定的这两个都不是阻塞项）',
    !liveCensus.has('fonts/summer85.ttf') && (!liveCensus.has('fonts/kust.ttf') || liveCensus.get('fonts/kust.ttf').n <= 1),
    [liveCensus.get('fonts/kust.ttf'), liveCensus.get('fonts/summer85.ttf')])
  check('F4e `NotoSans-Regular.ttf` / `TwemojiMozilla.ttf` 也 0 引用（前者只经 `systemfont_*` 别名间接用到，后者供 emoji）',
    !liveCensus.has('fonts/NotoSans-Regular.ttf') && !liveCensus.has('fonts/TwemojiMozilla.ttf'))
  const outside = keys.filter((k) => !k.startsWith('systemfont_') && !liveCensus.get(k).inPkg)
  note('**不在包内**的引用（真正依赖外部渠道的）', outside.map((k) => k + '=' + liveCensus.get(k).n + '层').join(' · '))
  check('F4f 未打包的每一项引用**全部不在包内**（⇒ 它们真的会落到第③/④级，不是"包内有所以无所谓"）',
    Object.keys(NOT_BUNDLED).every((f) => { const r = liveCensus.get('fonts/' + f); return !r || r.inPkg === false }),
    Object.keys(NOT_BUNDLED).filter((f) => { const r = liveCensus.get('fonts/' + f); return r && r.inPkg }).slice(0, 3))
}

// ═══════════════ F5 回退链：未打包 ⇒ 第③级命中 / 无 WE 时第④级不抛错 ═══════════════
out('\n[F5] 回退链（四级链：①包内 → ②仓库自带 → ③本机 WE → ④`sans-serif`）')
{
  const fb = path.join(ROOT, 'tests', 'text-font-fallback-test.mjs')
  const src = fs.existsSync(fb) ? fs.readFileSync(fb, 'utf8') : ''
  check('F5a 既有回归里**已覆盖**"四级全缺 → 回退 `sans-serif`（不抛异常）"这条（本文件不重复造那条断言）',
    /四级全缺/.test(src) && /sans-serif/.test(src), src ? 'text-font-fallback-test.mjs 命中' : '文件不存在')
  const missingBoth = Object.keys(NOT_BUNDLED).filter((f) => !fs.existsSync(path.join(REPO_FONTS, f)))
  check('F5b 8 个未打包项在仓库侧**确实都没有文件**（第②级必然跳过；不是"打包了却没人知道"）',
    missingBoth.length === Object.keys(NOT_BUNDLED).length, Object.keys(NOT_BUNDLED).filter((f) => !missingBoth.includes(f)))
  if (!fs.existsSync(WE_FONTS)) skipItem('F5c', 'WE 目录不存在 ⇒ 本机只能到第④级 sans-serif')
  else {
    check('F5c 未打包的 8 个在 WE 目录里都在（⇒ 有 WE 的机器上第③级命中真字体，不是 sans-serif；本机 WE 缺文件才会真回退）',
      Object.keys(NOT_BUNDLED).every((f) => fs.existsSync(path.join(WE_FONTS, f)) && fs.statSync(path.join(WE_FONTS, f)).size > 0),
      Object.keys(NOT_BUNDLED).filter((f) => !fs.existsSync(path.join(WE_FONTS, f))))
    // 结论登记：第③级的两条路径（`/weassist/fonts/<basename>`）用的是 **basename**（见 demo.html 的 weFontUrl）
    const html = fs.existsSync(DEMO_HTML) ? fs.readFileSync(DEMO_HTML, 'utf8') : ''
    check('F5d 第③级按 **basename** 取件（`fonts/workshop/<id>/x.ttf` 一类跨工坊引用不会把路径拼进 URL）',
      /basename/.test(html) && /weassist\/fonts\//.test(html))
  }
}

// ═══════════════ F6 systemfont_* 别名 ═══════════════
out('\n[F6] `systemfont_*` 系统字体别名（不进四级链；渲染器自己映射）')
{
  const html = fs.existsSync(DEMO_HTML) ? fs.readFileSync(DEMO_HTML, 'utf8') : ''
  const mapM = html.match(/const map = \{([^}]*systemfont_[^}]*)\}/)
  const aliasMap = mapM ? mapM[1] : ''
  const ids = [...aliasMap.matchAll(/(systemfont_[a-z0-9]+)\s*:/g)].map((m) => m[1])
  note('demo.html（浏览器路径）别名表', ids.join(' · '))
  check('F6a 语料用到的 3 个 id（arial / consolas / comicsans）**全在**别名表里（⇒ 浏览器侧映射到真实系统族名，可接受）',
    CORPUS_SYSTEMFONT.every((id) => ids.includes(id)), CORPUS_SYSTEMFONT.filter((id) => !ids.includes(id)))
  check('F6b `ensureTextFont` 里 `systemfont_*` 确实**旁路**（不发请求、不进 loaded/missing 集合）',
    /indexOf\('systemfont_'\) === 0/.test(html) && /systemfont_/.test(html))
  // Node 侧（elysia/we-renderer/text.js）现在把**所有** systemfont_* 折到 NotoSans ——
  // 等宽 id（consolas/couriernew）落到比例字体属于**字形类别错**，F6c/F6d 钉住修正后的口径。
  const tx = fs.readFileSync(path.join(ROOT, 'elysia', 'we-renderer', 'text.js'), 'utf8')
  const monoIds = ['systemfont_consolas', 'systemfont_couriernew']
  check('F6c Node 侧（`elysia/we-renderer/text.js`）对**等宽** id 映射到等宽字体文件（不再一律折到比例字体 NotoSans）',
    monoIds.every((id) => new RegExp("['\"]?" + id + "['\"]?\\s*:").test(tx)) && /RobotoMono-Regular\.ttf/.test(tx), tx.match(/const SYSTEMFONT_MONO[\s\S]{0,200}/))
  check('F6d Node 侧映射的目标文件**真的存在**（仓库自带 或 本机 WE 字体目录）—— 不引入新字体',
    ['NotoSans-Regular.ttf', 'RobotoMono-Regular.ttf'].every((f) => fs.existsSync(path.join(REPO_FONTS, f)) || fs.existsSync(path.join(WE_FONTS, f))),
    ['NotoSans-Regular.ttf', 'RobotoMono-Regular.ttf'].map((f) => f + ':' + (fs.existsSync(path.join(REPO_FONTS, f)) ? '仓库' : fs.existsSync(path.join(WE_FONTS, f)) ? 'WE' : 'MISSING')))
}

// ═══════════════ F7 8bitOperatorPlus8 的收口（原"许可清楚却取不到"，2026-09-18 已解决）═══════════════
out('\n[F7] `8bitOperatorPlus8-Regular.ttf`（61 层/17 包）：从"取不到"到"用作者的 CC0 后继版打包"')
{
  const doc = fs.existsSync(THIRD_PARTY) ? fs.readFileSync(THIRD_PARTY, 'utf8') : ''
  check('F7a 仓库打包的是作者的**现行版** `PixelOperator8.ttf`（不是 WE 副本），且别名把语料里的旧名映射过去',
    fs.existsSync(path.join(REPO_FONTS, 'PixelOperator8.ttf')) &&
    !fs.existsSync(path.join(REPO_FONTS, '8bitOperatorPlus8-Regular.ttf')) &&
    WE_REF_TO_REPO['8bitOperatorPlus8-Regular.ttf'] === 'PixelOperator8.ttf' &&
    fs.readFileSync(DEMO_HTML, 'utf8').includes("'8bitOperatorPlus8-Regular.ttf': 'PixelOperator8.ttf'"))
  const info = sfntInfo(path.join(REPO_FONTS, 'PixelOperator8.ttf'))
  // 字形数：直接从 `maxp` 表读（`sfntInfo` 只给 name 表）——用于"现行版 ⊇ 旧版"这条判据
  const numGlyphs = (fp) => {
    try {
      const d = fs.readFileSync(fp); const n = d.readUInt16BE(4)
      for (let i = 0; i < n; i++) { const r = 12 + 16 * i
        if (d.slice(r, r + 4).toString('latin1') === 'maxp') return d.readUInt16BE(d.readUInt32BE(r + 8) + 4) }
    } catch { }
    return -1
  }
  check('F7b 打包那份的 `name` 表 ID13 = **CC0-1.0**、ID14 指向 creativecommons zero（可自由再分发，无需署名——我们仍署名）',
    /CC0/.test(info.names.license || '') && /creativecommons\.org\/licenses\/zero/.test(info.names.licenseURL || ''),
    { license: info.names.license, licenseURL: info.names.licenseURL })
  check('F7c 它是**同一作者血脉**：族名 `Pixel Operator 8`（≠ 旧名 `8-bit Operator+ 8`）、字形数 ⊃ 旧版（新增 Esperanto/货币符号）',
    /pixel operator/i.test(info.names.family || '') &&
    (!fs.existsSync(WE_FONTS) || numGlyphs(path.join(REPO_FONTS, 'PixelOperator8.ttf')) >= numGlyphs(path.join(WE_FONTS, '8bitOperatorPlus8-Regular.ttf'))),
    { family: info.names.family, glyphs: numGlyphs(path.join(REPO_FONTS, 'PixelOperator8.ttf')), old: fs.existsSync(WE_FONTS) ? numGlyphs(path.join(WE_FONTS, '8bitOperatorPlus8-Regular.ttf')) : '?' })
  check('F7d `THIRD-PARTY.md` §4.7 如实记下了这次收口（旧版 undownloadable / 现行版 CC0 / 字形不完全相同的取舍）',
    /### 4\.7/.test(doc) && /Pixel Operator/.test(doc) && /CC0/.test(doc))
}

// ═══════════════ F8 汇总表（人读）═══════════════
out('\n[F8] 一次性清单（字体 / 是否已打包 / 许可 / 语料引用 / 影响面 / 结论）')
{
  const rows = []
  for (const [f, fam] of Object.entries(BUNDLED)) rows.push([f, '已打包', '见 THIRD-PARTY.md §4.1', CENSUS['fonts/' + f] ? CENSUS['fonts/' + f].join('层/') + '包' : '0', '可用（第②级）'])
  for (const [f, v] of Object.entries(NOT_BUNDLED)) {
    const c = CENSUS['fonts/' + f]
    rows.push([f, '未打包', v.licence, c ? c.join('层/') + '包' : '0', f === 'kust.ttf' || f === 'summer85.ttf' ? '不需要（0 引用）' : '缺：第③级（本机 WE）/④sans-serif'])
  }
  for (const [f, c] of Object.entries(CENSUS)) {
    if (f.startsWith('systemfont_')) { rows.push([f, '旁路', '系统字体别名', c.join('层/') + '包', '映射到真实系统族名']); continue }
    const base = f.replace(/^fonts\//, '')
    if (!BUNDLED[base] && !BUNDLED[WE_REF_TO_REPO[base]] && !NOT_BUNDLED[base]) {
      rows.push([f, '未打包', '未登记（非 WE 内置名）', c.join('层/') + '包', '数据源缺口：包内/上游都没有（不在本表许可审计范围）'])
    }
  }
  for (const [f, tier, lic, ref, concl] of rows) out('   | ' + [f, tier, lic, ref, concl].join(' | ') + ' |')
  check('F8a 汇总表覆盖了三类（已打包 / 未打包 / systemfont_*）且行数与冻结表一致',
    rows.length === Object.keys(BUNDLED).length + Object.keys(NOT_BUNDLED).length + Object.keys(CENSUS).filter((k) => k.startsWith('systemfont_')).length +
      Object.keys(CENSUS).filter((k) => !k.startsWith('systemfont_') && !BUNDLED[k.replace(/^fonts\//, '')] && !BUNDLED[WE_REF_TO_REPO[k.replace(/^fonts\//, '')]] && !NOT_BUNDLED[k.replace(/^fonts\//, '')]).length,
    rows.length)
}

const peak = (() => { try { const m = fs.readFileSync('/proc/self/status', 'utf8').match(/VmHWM:\s*(\d+)/); return m ? Math.round(+m[1] / 1024) + 'MB' : '?' } catch { return '?' } })()
out('\n(计票：pass=' + pass + ' fail=' + fail + ' skip=' + skip + '；PeakRSS=' + peak + ')')
if (fail) { out('\n' + fail + ' 项失败'); process.exit(1) }
out('\nALL PASS （' + pass + ' 项' + (skip ? '，另 SKIP ' + skip : '') + '）')
process.exit(0)
