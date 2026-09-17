// tools/style-scope-guard.mjs —— 「我们注入的每条 CSS 规则都必须命中我们自己的标记」自动护栏
//
// 为什么需要它（两次真实事故的机制化防复发）：
//   ① 右侧「轮次导航条」被弄透明：我们在**裸 html/body** 上重定义了宿主 token
//      （`--dsw-alias-label-primary` / `--dsw-alias-border-l4` 之类），值一旦是
//      inherit/transparent/循环引用 ⇒ guaranteed-invalid ⇒ 宿主 rail 的条 computed 变透明
//      （见 docs/TIMELINE-RAIL-TOKEN.md §2/§5）。
//   ② 顶栏下描边被抹掉：`.wSkVaW_header` 上的 `border-bottom: … transparent !important`
//      （见 docs/HEADER-FROST.md §0b）。
//   两次都不是"某一行写错"，而是**选择器作用域没人管**：改样式的人无法在本地发现
//   "这条规则会命中宿主界面"。本文件把这件事变成会变红的机器判据。
//
// 分类口径（逐条对应 docs/STYLE-SCOPE-GUARD.md 的账本）：
//   OK          选择器命中我们自己的标记（`.mpw*` / `[data-mpw*]` / `#mpw-*` / `[data-plugin=…]`）
//   ALLOWLISTED 命中**已登记**的宿主/第三方作用域（每条登记项都带 reason + `docs/*.md:行号` 指针，
//               指针运行时被校验：文件要在、行要在且非空；指向本护栏账本的行还必须含该条目 id）
//   REVIEW      未登记、判不了 ⇒ **判红**（新宿主类名/新作用域必须先登记再放行）
//   RED         明确违规：裸元素 / 裸 `*` / 无锚点、`:root` 覆盖非 `--mpw-*`、未门控的宿主 token 覆盖、
//               宿主 token 被设成 transparent/inherit/空、禁止锚点（rail 家族 / `[data-dsh-panel-host]`）、
//               顶栏描边透明化……（见 SELECTOR_PROHIBITIONS / TOKEN_POLICY / ROOT_POLICY）
//
// 获取"真实产物"：**不重写 buildCss**。用 tools/_stub.mjs 把 lib/client.js 在 Node 里跑起来，
// 调用插件自己暴露的 `globalThis.__mpwBuildCss(patch)`（lib/client.js:5359），遍历组合
// （默认段 / 每个布尔开关单独开 / 核心 9 开关全组合 / bsCompat 家族 / 数值极值 / 无壁纸 / lgTest），
// 对**生成出来的 CSS 文本**做选择器解析（含 @media / @supports 嵌套）。加载口径与 tools/css-matrix.mjs 相同。
//
// 用法:
//   node tools/style-scope-guard.mjs                  # 全量 → 一屏表格 + tools/probe-out/style-scope.json
//   node tools/style-scope-guard.mjs --selftest       # 额外做「变异必须变红」自证（带阴性对照）
//   node tools/style-scope-guard.mjs --audit          # 只打印未登记原子/未放行选择器（排查用）
//   node tools/style-scope-guard.mjs --client <path>  # 对指定副本判（自证用；绝不改 lib/）
//   node tools/style-scope-guard.mjs --quick          # 只跑少量组合（调试护栏本身用；门禁跑全量）
//
// 卫生：临时目录用 mkdtemp（client.js 副本 806KB < 1MB），process.on('exit') 兜底删除；
//       不写仓库内夹具；产物 JSON 落 tools/probe-out/（.gitignore 已忽略）。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { loadPlugin } from './_stub.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..')
const argOf = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : dflt }
const clientPath = path.resolve(argOf('--client', path.join(repoRoot, 'lib', 'client.js')))
const jsonPath = path.resolve(argOf('--json', path.join(repoRoot, 'tools', 'probe-out', 'style-scope.json')))
const SELFTEST = process.argv.includes('--selftest')
const AUDIT = process.argv.includes('--audit')
const QUICK = process.argv.includes('--quick')
const relFile = path.relative(repoRoot, clientPath)

/* ══════════════════════ 一、允许清单（每条必须带 reason + docs 指针） ══════════════════════
 * tier:
 *   'anchor' —— 可以**单独充当**作用域锚点（选择器里有它 ⇒ "只打这块 DOM"）
 *   'refine' —— 只能作为**已锚定**选择器里的细化/兜底原子（裸出现 = 无锚点 ⇒ 判红）
 * kind: 'class' | 'attr' | 'type' | 'universal' | 'selector'（整条选择器）
 * doc:  'docs/<file>.md:<行号>'；指向本护栏账本时该行必须含本条 id（运行时校验，防指针漂移）。
 * docKind: 'existing' = 仓内既有文档本来就写了这件事；'ledger' = 既有文档没写，本条首次登记在账本。
 */
const ALLOWLIST = [
  /* ── 我们自己的标记：永远放行 ── */
  { id: 'ours:class', kind: 'class', tier: 'anchor', match: /^\.mpw[-_]/, reason: '插件自有 UI 类名（.mpw_* 面板控件 / .mpw-* 壁纸层与磨砂层）', doc: 'docs/STYLE-SCOPE-GUARD.md:48', docKind: 'ledger' },
  { id: 'ours:data-mpw', kind: 'attr', tier: 'anchor', match: /^\[data-mpw[-=\]]/, reason: '插件自有状态标记属性（门控用；宿主永不带 data-mpw-*）', doc: 'docs/STYLE-SCOPE-GUARD.md:49', docKind: 'ledger' },
  { id: 'ours:id', kind: 'class', tier: 'anchor', match: /^#mpw-/, reason: '插件自有 id（#mpw-bgWrap 等）', doc: 'docs/STYLE-SCOPE-GUARD.md:50', docKind: 'ledger' },
  { id: 'ours:data-plugin', kind: 'attr', tier: 'anchor', match: /^\[data-plugin(=|"|\])/, reason: '插件注入的 <style>/节点上的 data-plugin 标记', doc: 'docs/STYLE-SCOPE-GUARD.md:51', docKind: 'ledger' },

  /* ── 宿主：根元素（声明另有 ROOT_POLICY 约束） ── */
  { id: 'root:html-body', kind: 'type', tier: 'anchor', match: /^(html|body)$/, reason: '把宿主根背景改透明才能看到壁纸层（无源时恢复不透明）——只允许 background* 与已登记的宿主 token，见 ROOT_POLICY', doc: 'docs/BGWRAP-VISIBILITY.md:20', docKind: 'existing' },

  /* ── 宿主：类名家族（CSS Modules hash 随版本变，但这几个前缀有既有文档锚定） ── */
  { id: 'host:wSkVaW', kind: 'class', tier: 'anchor', match: /^\.wSkVaW_/, reason: '宿主顶栏/输入区（header/composer/scrollBody）类家族：顶栏磨砂层与描边回归都锚在它上面', doc: 'docs/HEADER-FROST.md:34', docKind: 'existing' },
  { id: 'host:pI_x6G', kind: 'class', tier: 'anchor', match: /^\.pI_x6G_/, reason: '宿主框架/左栏/右栏面板容器：无源恢复不透明 + sidebar-fill 白名单容器', doc: 'docs/BGWRAP-VISIBILITY.md:20', docKind: 'existing' },
  { id: 'host:hHd-Xa', kind: 'class', tier: 'anchor', match: /^\.hHd-Xa_/, reason: '宿主左栏根/新建会话/区域（.hHd-Xa_root 是 sidebar-fill 白名单容器之一）', doc: 'docs/TIMELINE-RAIL-TOKEN.md:63', docKind: 'existing' },
  { id: 'host:ydkMvW', kind: 'class', tier: 'anchor', match: /^\.ydkMvW_/, reason: '宿主内容根/正文容器：无源时不透明恢复的锚点之一', doc: 'docs/BGWRAP-VISIBILITY.md:25', docKind: 'existing' },
  { id: 'host:VOzbGW', kind: 'class', tier: 'refine', match: /^\.VOzbGW_/, reason: '宿主左栏导航列表：只用于给我们自己的 .mpw_navIconImg 让位（同一条选择器里必带我们的标记）', doc: 'docs/STYLE-SCOPE-GUARD.md:57', docKind: 'ledger' },

  /* ── 宿主：稳定属性锚点 ── */
  { id: 'host:dark-theme', kind: 'attr', tier: 'anchor', match: /^\[data-ds-dark-theme/, reason: '宿主暗色主题标记：暗色档的底色/文字补偿必须由此门控（亮暗两套值）', doc: 'docs/STYLE-SCOPE-GUARD.md:58', docKind: 'ledger' },
  { id: 'host:better-sidebar', kind: 'attr', tier: 'anchor', match: /^\[data-dsh-(better-sidebar|panel|bottom-panel|pane|float-window|popover|surface|sidebar-dragging)/, reason: 'dsh-better-sidebar 的稳定属性锚点：0.16→0.19 类名前缀换过一次，属性锚点是"下次换名不失效"的保险', doc: 'docs/BETTER-SIDEBAR-COMPAT.md:204', docKind: 'existing' },
  { id: 'host:bs-panel-host', kind: 'attr', tier: 'anchor', match: /^\[data-dsh-panel-host/, reason: '登记仅为让违规信息指得到文档；真实判定走 PROHIBITIONS（[data-dsh-panel-host] 禁止加背景/模糊）', doc: 'docs/BETTER-SIDEBAR-COMPAT.md:196', docKind: 'existing' },
  { id: 'host:dockkit', kind: 'attr', tier: 'anchor', match: /^\[data-(dockkit|sidebar-right-panel|sidebar-right-float-host|rightbar-fullscreen)/, reason: '宿主右栏/dockkit 浮层（0.19 原生右栏 + 浮窗）：透出/磨砂/悬浮只打这些容器', doc: 'docs/BETTER-SIDEBAR-DOM-CONTRACT-0.19.1.md:37', docKind: 'existing' },
  { id: 'host:slot', kind: 'attr', tier: 'anchor', match: /^\[data-slot(\*?=)/, reason: '宿主 slot 标记（sidebar/workspaces/composer）：sidebar-fill 白名单与"隐藏列表 fade"白名单都用它', doc: 'docs/TIMELINE-RAIL-TOKEN.md:63', docKind: 'existing' },
  { id: 'host:composer-card', kind: 'attr', tier: 'anchor', match: /^\[data-composer-card/, reason: '宿主输入卡片容器：发送键配色/输入区磨砂的作用域', doc: 'docs/STYLE-SCOPE-GUARD.md:63', docKind: 'ledger' },
  { id: 'host:cordis-panel', kind: 'attr', tier: 'anchor', match: /^\[data-cordis-panel/, reason: '宿主插件面板容器（我们的设置面板就挂在这里）：面板底色不能跟着壁纸一起透', doc: 'docs/STYLE-SCOPE-GUARD.md:64', docKind: 'ledger' },
  { id: 'host:data-plugin-any', kind: 'attr', tier: 'refine', match: /^\[data-plugin/, reason: '宿主插件槽位标记（任意插件）：只作为 [data-slot="sidebar"] 下的细化，不单独用', doc: 'docs/STYLE-SCOPE-GUARD.md:65', docKind: 'ledger' },
  { id: 'host:think-variant', kind: 'attr', tier: 'anchor', match: /^\[data-variant="think"/, reason: '宿主 Deep-diving 方框变体标记：thinkBg 开关只改它的底色/文字', doc: 'docs/STYLE-SCOPE-GUARD.md:66', docKind: 'ledger' },
  { id: 'host:radix-popper', kind: 'attr', tier: 'anchor', match: /^\[data-radix-popper-content-wrapper/, reason: '宿主浮层定位壳（radix popper）：宿主所有下拉/菜单都挂在它下面，是弹层半透明的稳定锚点', doc: 'docs/STYLE-SCOPE-GUARD.md:67', docKind: 'ledger' },
  { id: 'host:state-attrs', kind: 'attr', tier: 'refine', match: /^\[data-(dragging|sidebar-collapsed|phase=|dsh-sidebar)/, reason: '宿主瞬时状态标记（拖拽/折叠/激活阶段）：只用于**抑制我们自己的规则**（"拖拽时别磨砂"），不单独改宿主样式', doc: 'docs/STYLE-SCOPE-GUARD.md:68', docKind: 'ledger' },
  { id: 'host:aria-roles', kind: 'attr', tier: 'anchor', match: /^\[role="(dialog|alertdialog|menu|listbox|combobox|tooltip|alert|status)"/, reason: '宿主弹层/菜单/提示的 ARIA 语义角色：弹窗虚化/菜单半透明的唯一稳定锚点（只改背景与模糊，不改布局）', doc: 'docs/STYLE-SCOPE-GUARD.md:69', docKind: 'ledger' },
  { id: 'host:aria-refine', kind: 'attr', tier: 'refine', match: /^\[role="(menuitem|option)"/, reason: '只在 :not(...) 里排除"菜单项/选项"，避免给交互项误加背景', doc: 'docs/STYLE-SCOPE-GUARD.md:70', docKind: 'ledger' },

  /* ── 宿主/第三方：类名子串（hash 会变，只能子串匹配 —— 既有文档明确说这是当前唯一可行解） ── */
  { id: 'host:substr-anchor', kind: 'attr', tier: 'anchor', match: /^\[class[*$^]?="(sidebarCol|wSkVaW_header|_header_|_overlay|_overlayLayer|_modal|_portal|_mask|_panel|_bottomPanel|_pane|_tabBar|_tabStrip|_editorHeader|_browserBar|_terminal|_terminalWrap|_xterm|_addBar|_addButton|settingsArea)/, reason: '宿主/better-sidebar 的类名子串锚点（面板、pane、tab 栏、编辑头、浏览器栏、终端壳、遮罩、设置区）：0.16→0.19 换过前缀，子串匹配是当前唯一可行解', doc: 'docs/BETTER-SIDEBAR-COMPAT.md:207', docKind: 'existing' },
  { id: 'host:substr-component', kind: 'attr', tier: 'anchor', match: /^\[class[*$^]?="(P3OORG_panel|QsffPG|composerSeat|composerStack|newSession|thinkBody)/, reason: '宿主具体组件的 hash 子串（右栏 panel / 顶栏按钮组 / 输入区 seat·stack / 新建会话 / Deep-diving 正文）：只在这些组件内部细化', doc: 'docs/STYLE-SCOPE-GUARD.md:72', docKind: 'ledger' },
  { id: 'host:substr-menu', kind: 'attr', tier: 'anchor', match: /^\[class[*$^]?="(_menu|_menu_|_dropdown|_popover|_popover_|_floatHeader_|_selectMenu|_denseList|_expand)/, reason: '宿主弹层/菜单/下拉/顶栏展开面板的类名子串：菜单半透明、"半透明又无模糊"抑制、展开面板避让的作用域', doc: 'docs/STYLE-SCOPE-GUARD.md:73', docKind: 'ledger' },
  { id: 'host:substr-refine', kind: 'attr', tier: 'refine', match: /^\[class[*$^]?="(wrap|panel|box|section|container|card|_card|row|_row|button|badge|logo|logoRow|mode|segmented|fade|footArea|footerActions|root|icon|Icon|anchor|Anchor|item|Item|trigger|Trigger|groupTitle|status|Status|open|Open|Seat|Stack|seat|stack|overlay|primary|message|_scrollBody|_divider|_resizeHandle|_resizer|_expand|_tab|_hint|_label|_meta|_title|_pane_)/, reason: '宿主结构的通用类名子串：只允许作为**已锚定**选择器里的后代细化（裸出现 = 无锚点 ⇒ 判红）', doc: 'docs/STYLE-SCOPE-GUARD.md:74', docKind: 'ledger' },
  { id: 'host:bs-bottom-resize', kind: 'attr', tier: 'anchor', match: /^\[class[*$^]?="bottomResize/, reason: 'better-sidebar 底部面板的宿主 resize strip（8px 拖拽带）：bsFloat 圆角外壳 overflow:hidden 会把 strip 上沿切掉，故把它挪进面板内（top:-4px → 0）；只改位置不改宿主尺寸/交互', doc: 'docs/BETTER-SIDEBAR-COMPAT.md:332', docKind: 'existing' },
  { id: 'host:substr-radius-compat', kind: 'selector', tier: 'anchor', match: /^:where\(\[class\*="wrap"\], \[class\*="panel"\], \[class\*="box"\], \[class\*="section"\], \[class\*="container"\]\)$/, reason: '第三方插件 UI 圆角兼容（roundCompat 开关，默认关）：**故意**匹配任意插件的容器类名子串，但零优先级 :where + 只写 border-radius ⇒ 不覆盖任何既有样式', doc: 'docs/STYLE-SCOPE-GUARD.md:76', docKind: 'ledger' },

  /* ── 门控限定锚点：选择器里同时带 [data-mpw*] 门控时才成立（未门控时 PROHIBITIONS 先判红） ── */
  { id: 'rail:marks', kind: 'class', tier: 'anchor', requiresGate: true, match: /^\.(eGxaPq_|Y0dWHa_)|^\.qBU-ya/, reason: '宿主右侧轮次导航条/轨迹总览的类名：**只允许**出现在 body[data-mpw-rail-ink]（对比补偿）或 data-mpw-traject-clip（仅几何裁剪）门控下', doc: 'docs/TIMELINE-RAIL-TOKEN.md:181', docKind: 'existing' },
  { id: 'rail:mark-attrs', kind: 'attr', tier: 'anchor', requiresGate: true, match: /^\[class[*$^]?="(qBU-ya|_overview)/, reason: '宿主轨迹总览的类名子串（qBU-ya / _overview）：同上，只允许在 data-mpw-traject-clip 门控下做几何裁剪', doc: 'docs/TIMELINE-RAIL-TOKEN.md:181', docKind: 'existing' },
  { id: 'host:todo-card', kind: 'attr', tier: 'anchor', requiresGate: true, match: /^\[class[*$^]?="lXshSW_root|^\[data-tool="todo_write"\]/, reason: '宿主任务列表（todo 卡片）容器与工具标记：todoBlur 只打它（宿主类名 hash 会变，故同时留 [data-tool="todo_write"] 兼容），门控在 body[data-mpw-todo-blur]', doc: 'docs/STYLE-SCOPE-GUARD.md:79', docKind: 'ledger' },
  { id: 'host:substr-root-refine', kind: 'attr', tier: 'refine', match: /^\[class\$="_root"/, reason: '宿主通用 root 后缀（如 [class$="_root"][class*="qBU-ya"] 的复合写法）：只作为已锚定选择器里的复合细化', doc: 'docs/STYLE-SCOPE-GUARD.md:80', docKind: 'ledger' },

  /* ── 元素/通配：只允许作为已锚定选择器的细化 ── */
  { id: 'type:any', kind: 'type', tier: 'refine', match: /^[a-zA-Z][a-zA-Z0-9-]*$/, reason: '元素选择器（button/header/svg/img/video/iframe/canvas/b/input…）：只允许作为**已锚定**选择器里的元素细化，裸元素选择器判红', doc: 'docs/STYLE-SCOPE-GUARD.md:81', docKind: 'ledger' },
  { id: 'universal:any', kind: 'universal', tier: 'refine', match: /^\*$/, reason: '通配 *：只允许作为已锚定宿主作用域下的后代细化（如 [class*="sidebarCol"] *），裸 * 判红', doc: 'docs/STYLE-SCOPE-GUARD.md:82', docKind: 'ledger' },
]

/* ══════════════════════ 二、永远判红（不允许清单兜底） ══════════════════════ */
const SELECTOR_PROHIBITIONS = [
  {
    id: 'forbid:rail-scope',
    test: (s) => /\.eGxaPq_|\.Y0dWHa_|qBU-ya|turn-rail|_1p9O6q_/.test(s),
    gates: [
      { re: /\[data-mpw-rail-ink\]/, policy: 'rail-ink' },
      { re: /\[data-mpw-traject-clip/, policy: 'traject-clip' },
    ],
    reason: '碰宿主右侧「轮次导航条」家族（.eGxaPq_* / Y0dWHa_* / qBU-ya / _1p9O6q_ / turn-rail）：白名单只有两处——body[data-mpw-rail-ink] 下的对比补偿（不得含 !important、不得引用/重定义 --dsw-*）与 data-mpw-traject-clip 门控下的**仅几何属性**裁剪',
    doc: 'docs/TIMELINE-RAIL-TOKEN.md:181',
  },
  {
    id: 'forbid:session-subtree',
    test: (s) => /\[data-slot\*?[$^]?="[^"]*session/.test(s),
    gates: [{ re: /\[data-mpw/, policy: 'session-compensation' }],
    reason: '碰会话区容器（[data-slot*="session"] / [data-slot="conversation.session"]）：历史事故——"隐藏列表 fade"的白名单里混进会话区，把对话流整条 display:none；会话区的样式归宿主，只有带我们自有门控（data-mpw-*）的文字可读性补偿才允许',
    doc: 'docs/TIMELINE-RAIL-TOKEN.md:194',
  },
  {
    id: 'forbid:bs-panel-host',
    test: (s) => /\[data-dsh-panel-host/.test(s),
    reason: '[data-dsh-panel-host] 是 fixed + 全屏的宿主层：给它加背景/模糊会整屏染色（文档明确"不要碰"）',
    doc: 'docs/BETTER-SIDEBAR-COMPAT.md:196',
  },
]
// rail 门控下的声明策略（docs/TIMELINE-RAIL-TOKEN.md:187）
const RAIL_GEOMETRY_PROPS = /^(max-width|min-width|width|max-height|min-height|height|box-sizing|overflow|overflow-x|overflow-y|overscroll-behavior|overscroll-behavior-x|aspect-ratio)$/

const TOKEN_POLICY = {
  // 我们的功能正在用、绝不能被弄成 degenerate 值的宿主 token（rail 的 4 个 token 里的 2 个宿主 token）
  railTokens: ['--dsw-alias-border-l4', '--dsw-alias-label-primary'],
  degenerateValues: /^(transparent|inherit|unset|initial|revert|revert-layer|none|)$/i,
  // 允许"值 = transparent !important"的唯一白名单（文档点名的侧栏底色白名单容器）
  sidebarFillTokens: ['--dsw-specific-sidebar-fill'],
  sidebarFillSelector: /\.pI_x6G_sidebarCol|\[class\*="sidebarCol"\]|\.hHd-Xa_root|\[data-slot="sidebar"\]/,
  // 已登记在案的全局宿主 token 覆盖：fontColorGray「自定义灰字颜色」功能（17 个 token 打在 body 上）
  registeredGlobalTokens: [
    '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary', '--dsw-alias-label-caption', '--dsw-alias-label-dimmed',
    '--dsw-alias-label-quaternary', '--dsw-alias-label-primary-bluish', '--dsw-alias-label-primary-dimmed',
    '--dsw-alias-label-primary-foreground', '--dsw-alias-label-inverse', '--dsw-alias-label-primary-inverted',
    '--dsw-alias-label-error', '--dsw-alias-line-secondary', '--dsw-alias-separator-primary',
    '--dsw-alias-border-secondary', '--dsw-alias-border-l2', '--dsw-alias-border-l3', '--dsw-alias-state-warn-label',
  ],
  registeredGlobalDoc: 'docs/STYLE-SCOPE-GUARD.md:89',
}

const ROOT_POLICY = {
  rootProps: /^--mpw-/,                       // :root 上只准定义我们自己的自定义属性
  htmlBodyProps: /^(background|background-color|background-image)$/,
  doc: 'docs/BGWRAP-VISIBILITY.md:20',
}

/* ══════════════════════ 三、CSS 解析（含 @media/@supports 嵌套） ══════════════════════ */
const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/[^\n]*/gm, ' ')

/** 把 CSS 拆成规则：[{ selector, body, at:[…] }]；@keyframes 里的帧选择器不算选择器 */
function parseRules(css) {
  const t = stripComments(css)
  const out = []
  const walk = (start, end, at) => {
    let i = start, prelude = ''
    while (i < end) {
      const c = t[i]
      if (c === '{') {
        let depth = 1, j = i + 1
        while (j < end && depth > 0) { if (t[j] === '{') depth++; else if (t[j] === '}') depth--; j++ }
        const head = prelude.trim()
        if (head.startsWith('@')) {
          const name = (head.match(/^@([a-zA-Z-]+)/) || [, ''])[1].toLowerCase()
          if (name === 'keyframes' || name === '-webkit-keyframes' || name === '-moz-keyframes') { /* 帧选择器不算选择器 */ }
          else if (['media', 'supports', 'layer', 'container', 'scope', 'document'].includes(name)) walk(i + 1, j - 1, at.concat(head))
        } else if (head) out.push({ selector: head, body: t.slice(i + 1, j - 1), at: at.slice() })
        i = j; prelude = ''
        continue
      }
      if (c === ';' && prelude.trim().startsWith('@')) { prelude = ''; i++; continue }
      prelude += c; i++
    }
  }
  walk(0, t.length, [])
  return out
}

/** 顶层切分（尊重 () [] 与引号） */
function splitTopLevel(s, seps = ',') {
  const out = []; let depth = 0, quote = null, cur = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quote) { cur += c; if (c === quote) quote = null; continue }
    if (c === '"' || c === "'") { quote = c; cur += c; continue }
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    if (depth === 0 && seps.includes(c)) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue }
    cur += c
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

const stepsOf = (part) => splitTopLevel(part.replace(/([>+~])/g, ' $1 '), ' ')

const FUNC_PSEUDO = /^:(has|is|where|not|matches|any)\(/i
/** 从一个复合选择器里抽原子；:has/:is/:where/:not 递归进参数 */
function atomsOf(step, negated = false, acc = []) {
  const re = /::?[a-zA-Z-]+(\([^()]*(?:\([^()]*\))?[^()]*\))?|\.[A-Za-z0-9_\\-]+|\[[^\]]*\]|#[A-Za-z0-9_-]+|\*|[a-zA-Z][a-zA-Z0-9-]*/g
  let m
  while ((m = re.exec(step))) {
    const tok = m[0]
    if (FUNC_PSEUDO.test(tok)) {
      const fn = tok.slice(1, tok.indexOf('(')).toLowerCase()
      const inner = tok.slice(tok.indexOf('(') + 1, -1)
      acc.push({ kind: 'pseudo', text: ':' + fn + '()', negated })
      for (const p of splitTopLevel(inner, ',')) for (const st of stepsOf(p)) atomsOf(st, negated || fn === 'not', acc)
      continue
    }
    if (tok.startsWith(':')) { acc.push({ kind: 'pseudo', text: tok, negated }); continue }
    if (tok.startsWith('.')) { acc.push({ kind: 'class', text: tok, negated }); continue }
    if (tok.startsWith('[')) { acc.push({ kind: 'attr', text: tok, negated }); continue }
    if (tok.startsWith('#')) { acc.push({ kind: 'class', text: tok, negated }); continue }
    if (tok === '*') { acc.push({ kind: 'universal', text: '*', negated }); continue }
    acc.push({ kind: 'type', text: tok, negated })
  }
  return acc
}

function parseDeclarations(body) {
  const out = []
  for (const chunk of splitTopLevel(body, ';')) {
    const i = chunk.indexOf(':')
    if (i <= 0) continue
    const prop = chunk.slice(0, i).trim()
    if (!/^(--[A-Za-z0-9-]+|[a-zA-Z-]+)$/.test(prop)) continue
    let value = chunk.slice(i + 1).trim()
    const important = /!important\s*$/i.test(value)
    if (important) value = value.replace(/!important\s*$/i, '').trim()
    out.push({ prop, value, important })
  }
  return out
}

/* ══════════════════════ 四、分类 ══════════════════════ */
const allowById = new Map(ALLOWLIST.map((e) => [e.id, e]))
const matchAllow = (atom) => ALLOWLIST.filter((e) => e.kind === atom.kind && e.match.test(atom.text))

/** 规则是否"只作用在根元素本身"（html / body / :root，且没有后代步骤） */
function rootSubjectOf(part) {
  const steps = stepsOf(part)
  if (steps.length !== 1) return null
  const atoms = atomsOf(steps[0], false, [])
  const nonPseudo = atoms.filter((a) => a.kind !== 'pseudo')
  if (nonPseudo.length === 1 && nonPseudo[0].kind === 'type' && /^(html|body)$/.test(nonPseudo[0].text)) return nonPseudo[0].text
  if (nonPseudo.length === 0 && atoms.some((a) => a.kind === 'pseudo' && a.text === ':root')) return ':root'
  return null
}

/** 判定单条逗号分片选择器 */
function classifyPart(part) {
  const reasons = []
  const gated = /\[data-mpw/.test(part)
  for (const p of SELECTOR_PROHIBITIONS) {
    if (!p.test(part)) continue
    // 没有 gates 的禁令是**无条件**的；有 gates 的必须命中其中一个门控才放行（并记下门控种类，声明级策略要用）
    if (!p.gates) { reasons.push({ level: 'RED', id: p.id, reason: p.reason, doc: p.doc, policy: null }); continue }
    const gate = p.gates.find((g) => g.re.test(part))
    if (!gate) { reasons.push({ level: 'RED', id: p.id, reason: p.reason, doc: p.doc, policy: null }); continue }
    reasons.push({ level: 'OK-GATED', id: p.id, reason: p.reason, doc: p.doc, policy: gate.policy })
  }
  const rootSubject = rootSubjectOf(part)
  const atoms = []
  for (const st of stepsOf(part)) atomsOf(st, false, atoms)
  const positive = atoms.filter((a) => a.kind !== 'pseudo' && !a.negated)
  const matched = new Set()
  const unsanctioned = []
  let anchored = false
  // 整条选择器级登记项（如第三方圆角兼容的 :where(...) 整条）
  const wholeHits = ALLOWLIST.filter((e) => e.kind === 'selector' && e.match.test(part))
  if (wholeHits.length) {
    for (const h of wholeHits) { matched.add(h.id); anchored = true }
  } else {
    for (const a of positive) {
      const hits = matchAllow(a).filter((h) => !h.requiresGate || gated)
      if (!hits.length) { unsanctioned.push(a.text); continue }
      for (const h of hits) { matched.add(h.id); if (h.tier === 'anchor') anchored = true }
    }
  }
  const ours = [...matched].some((id) => id.startsWith('ours:'))
  const policies = reasons.filter((r) => r.level === 'OK-GATED').map((r) => r.policy).filter(Boolean)
  if (rootSubject) return { verdict: 'ROOT', rootSubject, reasons, matched: [...matched], anchored: true, unsanctioned, ours, policies }
  if (reasons.some((r) => r.level === 'RED')) return { verdict: 'RED', reasons, matched: [...matched], anchored, unsanctioned, ours, policies }
  if (!anchored && !ours) {
    return {
      verdict: 'RED', matched: [...matched], anchored: false, unsanctioned, ours, policies,
      reasons: reasons.concat([{
        level: 'RED', id: 'bare:no-anchor',
        reason: `没有作用域锚点（既不是我们的标记，也不是已登记的宿主作用域）：裸元素/裸 * /裸类名会命中宿主 UI${unsanctioned.length ? '（未登记原子：' + unsanctioned.slice(0, 4).join(' ') + '）' : ''}`,
        doc: 'docs/STYLE-SCOPE-GUARD.md:21',
      }]),
    }
  }
  if (unsanctioned.length) {
    return {
      verdict: 'REVIEW', matched: [...matched], anchored, unsanctioned, ours, policies,
      reasons: reasons.concat([{
        level: 'REVIEW', id: 'review:unregistered-atom',
        reason: `选择器里有未登记的原子：${unsanctioned.slice(0, 6).join(' ')}（新宿主类名/新作用域必须先登记到允许清单，并写 reason + docs 指针）`,
        doc: 'docs/STYLE-SCOPE-GUARD.md:16',
      }]),
    }
  }
  if (!gated && matched.size === 0) return { verdict: 'REVIEW', matched: [], anchored, unsanctioned, ours, policies, reasons }
  return { verdict: ours ? 'OK' : 'ALLOWLISTED', reasons, matched: [...matched], anchored, unsanctioned, ours, policies }
}

/** 整条规则（选择器 + 声明）判定 */
function classifyRule(rule) {
  const parts = splitTopLevel(rule.selector, ',')
  const perPart = parts.map((p) => ({ part: p, res: classifyPart(p) }))
  const reasons = []
  const rank = { OK: 0, ALLOWLISTED: 1, ROOT: 2, REVIEW: 3, RED: 4 }
  let verdict = 'OK'
  for (const { res } of perPart) {
    if (rank[res.verdict] > rank[verdict]) verdict = res.verdict
    reasons.push(...res.reasons)
  }
  const decls = parseDeclarations(rule.body)
  const gated = /\[data-mpw/.test(rule.selector)
  const policies = [...new Set(perPart.flatMap((p) => p.res.policies || []))]
  const rootSubjects = perPart.map((p) => p.res.rootSubject).filter(Boolean)
  const push = (level, id, reason, doc) => {
    if (!reasons.some((r) => r.id === id)) reasons.push({ level, id, reason, doc })
    if (rank[level] > rank[verdict]) verdict = level
  }
  // 根作用域声明策略
  if (rootSubjects.length && rootSubjects.length === perPart.length && perPart.every((p) => p.res.verdict === 'ROOT')) {
    const isRootPseudo = rootSubjects.every((s) => s === ':root')
    for (const d of decls) {
      if (isRootPseudo) {
        if (!ROOT_POLICY.rootProps.test(d.prop)) {
          push('RED', 'root:non-mpw-prop', `:root 上出现非 --mpw-* 声明（${d.prop}）：宿主 token 定义在 body 上，从 :root 覆盖属于越界改宿主主题`, 'docs/TIMELINE-RAIL-TOKEN.md:185')
        }
        continue
      }
      if (ROOT_POLICY.htmlBodyProps.test(d.prop)) continue
      if (d.prop.startsWith('--dsw-') && TOKEN_POLICY.registeredGlobalTokens.includes(d.prop)) continue
      if (d.prop.startsWith('--dsw-')) {
        push('RED', 'root:unregistered-host-token', `在裸 html/body 上覆盖未登记的宿主 token（${d.prop}）：全局 token 覆盖会连带改宿主组件（rail 变透明事故的机制）`, 'docs/TIMELINE-RAIL-TOKEN.md:185')
      } else {
        push('RED', 'root:non-transparency-prop', `在裸 html/body 上声明了非"透明化"属性（${d.prop}）：根元素只允许 background* 与已登记的宿主 token`, ROOT_POLICY.doc)
      }
    }
    verdict = reasons.some((r) => r.level === 'RED') ? 'RED' : (rank[verdict] > rank.OK ? verdict : 'OK')
  }
  // rail 门控下的声明策略
  if (policies.includes('rail-ink')) {
    for (const d of decls) {
      if (d.important) push('RED', 'rail:important', `rail 补偿规则里出现 !important（${d.prop}）——文档要求 rail 补偿不得含 !important`, 'docs/TIMELINE-RAIL-TOKEN.md:187')
      if (d.prop.startsWith('--dsw-')) push('RED', 'rail:touch-dsw', `rail 补偿规则里引用/重定义宿主 token（${d.prop}）——文档要求不得引用/重定义任何 --dsw-*`, 'docs/TIMELINE-RAIL-TOKEN.md:187')
    }
  }
  if (policies.includes('traject-clip')) {
    for (const d of decls) {
      if (!RAIL_GEOMETRY_PROPS.test(d.prop)) push('RED', 'rail:non-geometry', `data-mpw-traject-clip 门控下只允许几何属性，出现了（${d.prop}）`, 'docs/TIMELINE-RAIL-TOKEN.md:181')
    }
  }
  // 宿主 token 声明策略（任意作用域）
  for (const d of decls) {
    if (!d.prop.startsWith('--dsw-')) continue
    const value = d.value.trim()
    if (TOKEN_POLICY.railTokens.includes(d.prop)) {
      if (!gated || TOKEN_POLICY.degenerateValues.test(value)) {
        push('RED', 'token:rail-token', `覆盖/弄坏 rail 依赖的宿主 token（${d.prop} → ${value || '空'}）：值不得是 transparent/inherit/空，且必须门控在 data-mpw-* 上、值来自 --mpw-*`, 'docs/TIMELINE-RAIL-TOKEN.md:183')
      }
      continue
    }
    if (TOKEN_POLICY.degenerateValues.test(value)) {
      const okWhitelist = TOKEN_POLICY.sidebarFillTokens.includes(d.prop) && TOKEN_POLICY.sidebarFillSelector.test(rule.selector)
      if (!okWhitelist) {
        push('RED', 'token:degenerate-value', `把宿主 token 设成 ${value || '空'}（${d.prop}）：这是"整块界面变透明/失色"的机制；只有 --dsw-specific-sidebar-fill 在文档点名的侧栏白名单容器上才允许`, 'docs/TIMELINE-RAIL-TOKEN.md:185')
      }
      continue
    }
    if (d.important && !gated && !TOKEN_POLICY.registeredGlobalTokens.includes(d.prop) && !TOKEN_POLICY.sidebarFillTokens.includes(d.prop)) {
      push('RED', 'token:unregistered-important', `对未登记的宿主 token 加 !important（${d.prop}）：未登记的全局 token 覆盖一律判红（已登记项见账本"宿主 token 覆盖登记表"）`, TOKEN_POLICY.registeredGlobalDoc)
    }
    if (!gated && !TOKEN_POLICY.registeredGlobalTokens.includes(d.prop) && !TOKEN_POLICY.sidebarFillTokens.includes(d.prop)) {
      push('REVIEW', 'token:unregistered-host-token', `在非自有门控的选择器上覆盖未登记的宿主 token（${d.prop}）：需要登记（reason + docs 指针）后才放行`, TOKEN_POLICY.registeredGlobalDoc)
    }
  }
  // 顶栏描边禁令（docs/HEADER-FROST.md §0b）
  if (/\.wSkVaW_header|\[class\*="wSkVaW_header"\]|\[class\*="_header_"\]/.test(rule.selector)) {
    for (const d of decls) {
      if (!/^border/.test(d.prop) || !d.important) continue
      if (!/transparent|rgba\(\s*[^)]*,\s*0\s*\)|alpha\([^)]*,\s*0\s*\)/i.test(d.value)) continue
      push('RED', 'header:transparent-border', `把宿主顶栏描边改成透明（${d.prop}: ${d.value}）：历史事故（用户实测"顶栏下描边被去掉"）；描边一律交还宿主`, 'docs/HEADER-FROST.md:61')
    }
  }
  return { verdict, reasons, perPart, decls }
}

/* ══════════════════════ 五、组合枚举（真实产物） ══════════════════════ */
function fieldsFromSource(src) {
  const grab = (name) => {
    const m = new RegExp(name + '\\s*=\\s*\\[([^\\]]*)\\]').exec(src)
    if (!m) return []
    return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1])
  }
  return { bools: grab('const boolFields'), nums: grab('const numFields') }
}
const FALLBACK_BOOLS = ['sidebar', 'sharp', 'headerBlur', 'headerBg', 'rightSidebarBlur', 'dialogBlur', 'popoverBlur', 'maskBlur',
  'unifyTint', 'chatFollow', 'sessionFollow', 'aquaMask', 'aquaTint', 'aquaInk', 'todoBlur', 'float', 'newStyle', 'thinkBg', 'clock',
  'bsCompat', 'bsFloat', 'bsFont', 'bsReveal', 'bsAlpha', 'bsAqua', 'lgCss', 'headerFrostOwn', 'sidebarBlur']
const CORE = ['sidebar', 'unifyTint', 'headerBg', 'headerBlur', 'float', 'lgCss', 'aquaMask', 'aquaTint', 'rightSidebarBlur'] // 与 css-matrix 同口径

function buildCases(src) {
  const { bools: srcBools, nums } = fieldsFromSource(src)
  const bools = (srcBools.length ? srcBools : FALLBACK_BOOLS).filter((b) => !['lgTest', 'enabled', 'forceEnabled'].includes(b))
  const cases = []
  const P = (patch) => Object.assign({ image: true, enabled: true }, patch)
  cases.push({ name: '默认（全关）', patch: P({}) })
  cases.push({ name: '全部布尔开', patch: P(Object.fromEntries(bools.map((b) => [b, true]))) })
  cases.push({ name: '无壁纸源', patch: { image: false, webUrl: '', enabled: true } })
  cases.push({ name: '液态玻璃测试模式', patch: P({ lgTest: true }) })
  cases.push({ name: '灰字自定义色', patch: P({ fontColorGray: true, fontColorGrayColor: '#123456' }) })
  for (const b of bools) cases.push({ name: '单开:' + b, patch: P({ [b]: true }) })
  const BS = ['bsFloat', 'bsReveal', 'bsAlpha', 'bsAqua', 'bsFont', 'bsBottomAvoid']
  for (const b of BS) cases.push({ name: 'bsCompat+' + b, patch: P({ bsCompat: true, [b]: true }) })
  cases.push({ name: 'bsCompat 全子开关', patch: P(Object.fromEntries(['bsCompat', ...BS].map((b) => [b, true]))) })
  for (const n of (nums.length ? nums : ['opacity', 'blur', 'sidebarAlpha', 'bsRevealAlpha'])) {
    cases.push({ name: `数值:${n}=0`, patch: P({ [n]: 0 }) })
    cases.push({ name: `数值:${n}=100`, patch: P({ [n]: 100 }) })
  }
  if (!QUICK) {
    for (let m = 0; m < (1 << CORE.length); m++) {
      const patch = {}
      CORE.forEach((k, i) => { patch[k] = !!(m & (1 << i)) })
      cases.push({ name: 'core#' + m, patch: P(patch) })
    }
  }
  return cases
}

/* ══════════════════════ 六、源码行号解析（讲清"是哪一行"） ══════════════════════ */
function makeResolver(file) {
  let src = ''
  try { src = fs.readFileSync(file, 'utf8') } catch { return () => null }
  // 空白折叠 + 每字符回指行号；用数组 join（逐字符 `flat += c` 在 806KB 上是 O(n²)，实测 27s → 0.1s）
  const chars = []
  const lineOf = []
  let line = 1, prevSpace = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (c === '\n') { line++; if (!prevSpace) { chars.push(' '); lineOf.push(line - 1) } prevSpace = true; continue }
    if (c === '\t' || c === ' ' || c === '\r') { if (!prevSpace) { chars.push(' '); lineOf.push(line) } prevSpace = true; continue }
    chars.push(c); lineOf.push(line); prevSpace = false
  }
  const flat = chars.join('')
  const norm = (s) => String(s).replace(/\s+/g, ' ').trim()
  return (needles) => {
    for (const raw of needles) {
      if (!raw) continue
      let n = norm(raw)
      if (n.length < 4) continue
      while (n.length >= 4) {
        const i = flat.indexOf(n)
        if (i >= 0) return lineOf[i]
        if (n.length <= 12) break
        const cut = Math.floor(n.length * 0.6)
        n = n.slice(0, Math.max(10, cut)).trim()
        const sp = n.lastIndexOf(' ')
        if (sp > 8) n = n.slice(0, sp).trim()
      }
    }
    return null
  }
}

/* ══════════════════════ 七、账本指针校验 ══════════════════════ */
function docPointerCheck() {
  const problems = []
  const check = (id, doc, needIdInLine = true) => {
    const m = /^(docs\/[^:]+):(\d+)$/.exec(doc || '')
    if (!m) { problems.push(`${id}: 指针格式必须是 docs/*.md:行号，实际 ${doc}`); return }
    const f = path.join(repoRoot, m[1])
    if (!fs.existsSync(f)) { problems.push(`${id}: 指针文件不存在 ${m[1]}`); return }
    const lines = fs.readFileSync(f, 'utf8').split('\n')
    const ln = Number(m[2])
    if (!(ln >= 1 && ln <= lines.length)) { problems.push(`${id}: 指针行越界 ${doc}`); return }
    if (!lines[ln - 1].trim()) { problems.push(`${id}: 指针行是空行 ${doc}`); return }
    if (needIdInLine && m[1] === 'docs/STYLE-SCOPE-GUARD.md' && !lines[ln - 1].includes(id)) problems.push(`${id}: 账本行不含本条 id（指针漂了？）${doc}`)
  }
  for (const e of ALLOWLIST) check(e.id, e.doc)
  check('TOKEN_POLICY.registeredGlobalDoc', TOKEN_POLICY.registeredGlobalDoc, false)
  return problems
}

/* ══════════════════════ 八、主流程 ══════════════════════ */
function runGuard() {
  const t0 = Date.now()
  const srcText = fs.readFileSync(clientPath, 'utf8')
  const loaded = loadPlugin({ clientPath, settings: {}, quiet: true })
  if (loaded.applyErrors.length) {
    console.error('✗ apply() 期间报错：' + loaded.applyErrors.slice(0, 2).join(' | '))
    process.exit(1)
  }
  if (typeof globalThis.__mpwBuildCss !== 'function') {
    console.error('✗ 插件未暴露 __mpwBuildCss（lib/client.js:5359 的测试入口没了？）')
    process.exit(1)
  }
  const build = (patch) => { try { return String(globalThis.__mpwBuildCss(patch) || '') } catch (e) { return '/*BUILD_ERROR*/ ' + (e && e.message) } }
  const cases = buildCases(srcText)
  const resolveLine = makeResolver(clientPath)

  // 去重键 = 选择器 + 声明体：**必须含声明体**，否则 `:root{--mpw-*}` 先出现会把后来的
  // `:root{--dsw-…}` 一起判成 OK（变异自证抓到过这个洞）。跨组合的数值差异只增加少量去重键。
  const ruleStats = new Map()  // key → { selector, body, cases:Set, count }
  const buildErrors = []
  let ruleCount = 0
  for (const c of cases) {
    const css = build(c.patch)
    if (css.startsWith('/*BUILD_ERROR*/')) { buildErrors.push(c.name + ': ' + css.slice(0, 120)); continue }
    for (const rule of parseRules(css)) {
      ruleCount++
      const sel = rule.selector.replace(/\s+/g, ' ').trim()
      const body = rule.body.replace(/\s+/g, ' ').trim()
      const key = sel + '\u0000' + body
      let st = ruleStats.get(key)
      if (!st) { st = { selector: sel, body, cases: new Set(), count: 0 }; ruleStats.set(key, st) }
      st.cases.add(c.name); st.count++
    }
  }

  const counts = { OK: 0, ALLOWLISTED: 0, REVIEW: 0, RED: 0 }
  const entryHits = new Map()      // allowlist id → 命中的**唯一选择器**数
  const selectorEntries = new Map() // selector → Set(id)
  const rows = []
  const selSeen = new Set()
  for (const st of ruleStats.values()) {
    const res = classifyRule({ selector: st.selector, body: st.body })
    const verdict = res.verdict === 'ROOT' ? 'OK' : res.verdict
    counts[verdict === 'OK' ? 'OK' : verdict]++
    const matched = [...new Set(res.perPart.flatMap((p) => p.res.matched))]
    if (!selectorEntries.has(st.selector)) selectorEntries.set(st.selector, new Set())
    for (const id of matched) selectorEntries.get(st.selector).add(id)
    selSeen.add(st.selector)
    rows.push({
      selector: st.selector, verdict, cases: [...st.cases].slice(0, 3), caseCount: st.cases.size, count: st.count,
      line: resolveLine([st.selector, st.selector.split(/[>+~]/)[0], ...parseDeclarations(st.body).slice(0, 3).map((d) => `${d.prop}: ${d.value}`)]),
      reasons: res.reasons, unsanctioned: [...new Set(res.perPart.flatMap((p) => p.res.unsanctioned))],
    })
  }
  for (const ids of selectorEntries.values()) for (const id of ids) entryHits.set(id, (entryHits.get(id) || 0) + 1)
  // 违规按「选择器 + 原因集合」合并，避免同一个选择器因数值变体刷屏
  const badMap = new Map()
  for (const r of rows) {
    if (r.verdict !== 'RED' && r.verdict !== 'REVIEW') continue
    const k = r.verdict + '\u0000' + r.selector + '\u0000' + r.reasons.map((x) => x.id).join(',')
    const prev = badMap.get(k)
    if (!prev) { badMap.set(k, { ...r, cases: [...r.cases], caseCount: r.caseCount, count: r.count }) ; continue }
    prev.count += r.count
    prev.caseCount += r.caseCount
    for (const c of r.cases) if (prev.cases.length < 5 && !prev.cases.includes(c)) prev.cases.push(c)
  }
  const bad = [...badMap.values()].sort((a, b) => (a.verdict === b.verdict ? 0 : a.verdict === 'RED' ? -1 : 1))
  const ptrProblems = docPointerCheck()
  const durMs = Date.now() - t0

  const report = {
    tool: 'style-scope-guard', version: 1,
    generatedAt: new Date().toISOString(),
    client: relFile, clientBytes: fs.statSync(clientPath).size,
    caseCount: cases.length, cases: cases.map((c) => c.name),
    stats: { rules: ruleCount, uniqueSelectors: selSeen.size, uniqueRuleBodies: ruleStats.size, durationMs: durMs },
    counts, buildErrors, pointerProblems: ptrProblems,
    allowlist: ALLOWLIST.map((e) => ({ id: e.id, tier: e.tier, kind: e.kind, reason: e.reason, doc: e.doc, docKind: e.docKind, hits: entryHits.get(e.id) || 0 })),
    violations: bad.map((r) => ({
      verdict: r.verdict, selector: r.selector, line: r.line ? `${relFile}:${r.line}` : `${relFile}:?`,
      cases: r.cases, caseCount: r.caseCount, occurrences: r.count, unsanctioned: r.unsanctioned,
      reasons: r.reasons.map((x) => ({ id: x.id, level: x.level, reason: x.reason, doc: x.doc })),
    })),
  }

  if (AUDIT) {
    const P = (s) => console.log(s)
    P('── 未登记原子（按出现次数） ──')
    const tally = new Map()
    for (const r of rows) for (const a of r.unsanctioned) tally.set(a, (tally.get(a) || 0) + 1)
    for (const [a, n] of [...tally.entries()].sort((x, y) => y[1] - x[1])) P(`  ${String(n).padStart(4)}  ${a}`)
    P('── 非 OK/ALLOWLISTED 选择器 ──')
    for (const r of rows) if (r.verdict !== 'OK' && r.verdict !== 'ALLOWLISTED') P(`  [${r.verdict}] ${r.selector.length > 130 ? r.selector.slice(0, 127) + '…' : r.selector}   ${r.line ? relFile + ':' + r.line : ''}`)
  }

  const P = (s) => process.stdout.write(s + '\n')
  P('')
  P('══ 样式作用域护栏（style-scope-guard） ══')
  P(`产物来源：${relFile} · __mpwBuildCss() · ${cases.length} 组设置 · ${ruleCount} 条规则 · 唯一选择器 ${selSeen.size} 个 / 唯一「选择器+声明体」${ruleStats.size} 组 · ${durMs} ms`)
  P('')
  P('  分类          数量   含义（按唯一「选择器+声明体」组计）')
  P(`  OK          ${String(counts.OK).padStart(5)}   命中我们自己的标记（.mpw* / [data-mpw*] / #mpw-*）`)
  P(`  ALLOWLISTED ${String(counts.ALLOWLISTED).padStart(5)}   命中已登记宿主/第三方作用域（每条带 reason + docs 指针）`)
  P(`  REVIEW      ${String(counts.REVIEW).padStart(5)}   未登记、判不了 ⇒ 判红（必须先登记）`)
  P(`  RED         ${String(counts.RED).padStart(5)}   明确违规（裸元素/裸 *、:root 覆盖、宿主 token、禁止锚点…）`)
  P('')
  const top = [...entryHits.entries()].sort((a, b) => b[1] - a[1])
  P(`  允许清单命中（${ALLOWLIST.length} 条登记项，全部命中项）：`)
  for (const [id, n] of top) {
    const e = allowById.get(id)
    P(`    ${String(n).padStart(4)}  ${id.padEnd(26)} ${e.doc.padEnd(38)} [${e.docKind}]`)
  }
  if (buildErrors.length) { P(''); P('  ✗ buildCss 抛错：'); for (const b of buildErrors.slice(0, 5)) P('    ' + b) }
  if (ptrProblems.length) { P(''); P('  ✗ 账本指针校验失败：'); for (const p of ptrProblems.slice(0, 10)) P('    ' + p) }
  if (bad.length) {
    P('')
    P(`  ✗ 违规 ${bad.length} 条（判红）：`)
    for (const r of bad.slice(0, 25)) {
      P(`    [${r.verdict}] ${r.selector.length > 100 ? r.selector.slice(0, 97) + '…' : r.selector}`)
      P(`        ${r.line ? relFile + ':' + r.line : relFile + ':?'} · ${r.caseCount} 组设置命中（如 ${r.cases.join(', ')}）`)
      for (const x of r.reasons.slice(0, 2)) P(`        ↳ ${x.id}：${x.reason}`)
    }
    if (bad.length > 25) P(`    …还有 ${bad.length - 25} 条，见 JSON`)
  } else if (!buildErrors.length && !ptrProblems.length) {
    P('')
    P('  ✓ 没有 RED / REVIEW：注入的每条规则都锚在自有标记或已登记的宿主作用域上')
  }
  P('')
  fs.mkdirSync(path.dirname(jsonPath), { recursive: true })
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2))
  P(`  JSON：${path.relative(repoRoot, jsonPath)}（${(fs.statSync(jsonPath).size / 1024).toFixed(0)} KB）`)
  P('')
  return { report, bad, counts, ptrProblems, buildErrors }
}

/* ══════════════════════ 九、自证：往产物里注入"该判红"的写法 ══════════════════════ */
const MUTATIONS = [
  { id: 'bare-element', payload: 'button{color:red}', expect: 'RED', why: '裸元素选择器（brief 头号目标）' },
  { id: 'root-host-token', payload: ':root{--dsw-alias-bg-base:red}', expect: 'RED', why: ':root 上覆盖宿主 token' },
  { id: 'rail-ungated', payload: '.eGxaPq_mark{border-color:transparent !important}', expect: 'RED', why: '未门控碰宿主轮次导航条' },
  { id: 'rail-token-transparent', payload: 'body{--dsw-alias-label-primary:transparent !important}', expect: 'RED', why: 'rail 依赖 token 被设成 transparent（rail 变透明事故机制）' },
  { id: 'universal', payload: '*{letter-spacing:.01em}', expect: 'RED', why: '裸通配选择器' },
  { id: 'bs-panel-host', payload: '[data-dsh-panel-host]{backdrop-filter:blur(4px)}', expect: 'RED', why: '文档点名"不要碰"的宿主层' },
  { id: 'unregistered-token', payload: 'body{--dsw-alias-bg-base:#fff !important}', expect: 'RED', why: '未登记宿主 token + !important' },
  { id: 'bare-unknown-scope', payload: '.someOtherPlugin_root{opacity:.5}', expect: 'RED', why: '裸的、未登记的第三方作用域（连锚点都没有）' },
  { id: 'unknown-atom-gated', payload: '[data-dsh-better-sidebar] .someOtherPlugin_root{opacity:.5}', expect: 'REVIEW', why: '有锚点但含未登记原子 ⇒ 必须先登记（reason + docs 指针）' },
  { id: 'control-ours', payload: '.mpw-guardProbe{color:red}', expect: 'PASS', why: '阴性对照：我们自己的标记必须仍然放行（防"假红"）' },
]

function runSelftest() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-scope-guard-'))
  let cleaned = false
  const cleanup = () => { if (cleaned) return; cleaned = true; try { fs.rmSync(tmpRoot, { recursive: true, force: true }) } catch { /* 删不掉也不抛 */ } }
  process.on('exit', cleanup)
  const src = fs.readFileSync(clientPath, 'utf8')
  const HEAD = 'function buildCss(section) {'
  if (!src.includes(HEAD)) { console.error('✗ 自证失败：源码里找不到变异注入点 `' + HEAD + '`'); process.exit(1) }
  const P = (s) => process.stdout.write(s + '\n')
  P('')
  P('── 自证：把"该判红"的写法注入产物副本，护栏必须变红（含阴性对照） ──')
  const results = []
  for (const m of MUTATIONS) {
    const payload = '\n/* guard-selftest:' + m.id + ' */\n' + m.payload + '\n'
    // 把原 buildCss 改挂到 __mpwGuardOrigBuildCss（函数声明提升，调用得到），wrapper 在产物尾部追加变异 CSS
    const mutated = src.replace(
      HEAD,
      HEAD + ' const __c = __mpwGuardOrigBuildCss(section); return String(__c == null ? "" : __c) + ' + JSON.stringify(payload) + '; }\nfunction __mpwGuardOrigBuildCss(section) {',
    )
    const copy = path.join(tmpRoot, 'client-' + m.id + '.js')
    fs.writeFileSync(copy, mutated)
    const outJson = path.join(tmpRoot, m.id + '.json')
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--client', copy, '--json', outJson, '--quick'], { encoding: 'utf8' })
    let violations = []
    try { violations = JSON.parse(fs.readFileSync(outJson, 'utf8')).violations } catch { /* 读不到 = 失败 */ }
    const nRed = violations.filter((v) => v.verdict === 'RED').length
    const nRev = violations.filter((v) => v.verdict === 'REVIEW').length
    const got = r.status === 0 ? 'PASS' : (nRed ? 'RED' : (nRev ? 'REVIEW' : 'FAIL(其它)'))
    const ok = got === m.expect
    const witness = violations.length
      ? `护栏报出 ${nRed} RED / ${nRev} REVIEW；样例：${violations[0].selector.slice(0, 46)} @ ${violations[0].line}`
      : (r.status === 0 ? '护栏放行（0 违规）' : '非零退出但 JSON 不可读')
    results.push({ id: m.id, expect: m.expect, got, ok, exitCode: r.status, witness, why: m.why })
    P(`  ${ok ? '✓' : '✗'} ${m.id.padEnd(22)} 期望 ${m.expect.padEnd(6)} 实际 ${got.padEnd(6)} exit=${r.status}`)
    P(`      ${m.why}`)
    P(`      ${witness}`)
  }
  cleanup()
  const allPassed = results.every((x) => x.ok)
  P(`  自证结论：${allPassed ? '全部符合预期 ✓（护栏有分辨力，且阴性对照没被误杀）' : '存在不符合预期项 ✗'}`)
  return { allPassed, cases: results }
}

/* ══════════════════════ 十、入口 ══════════════════════ */
const { report, bad, ptrProblems, buildErrors } = runGuard()
if (SELFTEST) report.selftest = runSelftest()
fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2))
const hardFail = bad.length > 0 || ptrProblems.length > 0 || buildErrors.length > 0 || (report.selftest && !report.selftest.allPassed)
if (hardFail) {
  console.error('✗ 样式作用域护栏未通过（RED/REVIEW 见上表与 ' + path.relative(repoRoot, jsonPath) + '）')
  process.exit(1)
}
console.log('✓ 样式作用域护栏通过：' + report.counts.OK + ' OK / ' + report.counts.ALLOWLISTED + ' ALLOWLISTED / 0 RED / 0 REVIEW（唯一「选择器+声明体」组）')
