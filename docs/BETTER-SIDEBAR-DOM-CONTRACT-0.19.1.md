# 附录：dsh-better-sidebar 0.19.1 的 DOM 契约审计（逐行证据）

> **来源与性质**：本文件是 2026-09-17「壁纸插件 × better-sidebar 适配」核查时，由子代理对
> **第三方包** `dsh-better-sidebar@0.19.1` 做的**只读**结构审计（审计对象＝npm tarball 解包目录
> `/tmp/dsb-0191/package`，sha512 见 `docs/BETTER-SIDEBAR-COMPAT.md` §1.1）。每条结论都带
> `file:line`；写 "not found" 的地方＝该解包里查不到证据（而不是"猜"）。
> **用途**：我们 `bsCompat` 的选择器锚点依据（哪些属性/类名是稳定的、哪些在 0.19 被删）。
> **不构成**对该包任何代码的复用或再分发；本仓库不打包它的任何产物。
> 上游仓库：https://github.com/omdsh-dev/DSH-better-sidebar （MIT）。

---

# dsh-better-sidebar 0.19.1 — DOM contract: bottom workbench, native right sidebar, session header

Audit target: `/tmp/dsb-0191/package` (dsh-better-sidebar 0.19.1, extracted; read-only, nothing modified).
Priority: `src/client/**` (TSX) > `lib/client*.js` (built) > `README.md`. Every claim carries `file:line`; "not found" = no evidence in this extraction.
Base path for all citations is `/tmp/dsb-0191/package/` (abbreviated below as the relative path). No 0.16.x/0.18.x artifact exists in the extraction, so era-migration answers are stated as 0.19.1 status + README-history evidence only.

## A. Root / host elements

| Region | JSX tag | ALL `data-*` on it (name → value) | CSS-module class expression | Evidence |
|---|---|---|---|---|
| Plugin mount host (root of every region below) | `div` created imperatively, appended to `document.body` | `data-dsh-better-sidebar` → `''` (always) | none — selected only by the attribute; no `panelHost` class exists anywhere (`grep -rn panelHost src` = 0 hits) | `src/client/index.tsx:307` (createElement), `:308` (setAttribute), `:309` (appendChild), `:311` (React root renders `RenderBoundary`+`Sidebar`) |
| Panel-host layer (containing block for the panel) | `div` | `data-dsh-panel-host` → `''` (always); `data-dsh-panel-host-degraded` → `''` only in degraded mode (page-level transform self-check) | none (styling by `:global([data-dsh-panel-host])`) | `src/client/Sidebar.tsx:713` (main), `:611` (no-session early return); degraded write `src/client/index.tsx:276`, cleared `:272`, `:290`; CSS `src/client/sidebar.module.css:35`, `:66` |
| Bottom workbench panel root | `div` (ref `bottomRef`) | `data-dsh-panel` → `''`; `data-dsh-bottom-panel` → `''`; `data-dragging` → `'true'` only while the top edge is dragged | `clsx(css.bottomPanel, !state.bottomOpen && css.bottomPanelHidden)` | `src/client/Sidebar.tsx:726-746` (attrs `:729`, `:730`, `data-dragging` `:745`); built confirmation `lib/client.js:16455-16468` (`"data-dsh-panel": true, "data-dsh-bottom-panel": true, "data-dragging": draggingBottom \|\| void 0`) |
| Panel resize strip (top edge) | `div` | none | `clsx(css.bottomResize, draggingBottom && css.bottomResizeActive)` | `src/client/Sidebar.tsx:747-774` |
| Panel collapse button (inside strip's right end) | `button` | none (`aria-label` only) | `css.bottomClose` | `src/client/Sidebar.tsx:781-788` |
| Panel body (hosts the workbench) | `div` | none | `css.panelBody` | `src/client/Sidebar.tsx:790`; CSS `src/client/sidebar.module.css:104` |
| Workbench root (split tree) | `div` | none | `css.workbench` | `src/client/split-pane.tsx:317`; built `lib/client.js` (`css_default.workbench` ×1) |
| Split container / child | `div` | none | `clsx(css.split, isRow ? css.splitRow : css.splitCol)` / `css.splitChild` | `src/client/split-pane.tsx:271`, `:281` |
| Pane (leaf) root | `div` | `data-dsh-pane` → **leaf id string** (`leaf.id`, a plugin-generated pane id) | `clsx(css.pane, dropZone !== null && css.paneDrop)` | `src/client/split-pane.tsx:174-176`; built `lib/client.js:14858` (`"data-dsh-pane": leaf.id`) |
| Pane drop overlay | `div` (conditional) | none | `clsx(css.dropOverlay, css['drop'+Zone])` | `src/client/split-pane.tsx:197` |
| Pane content + per-tab wrapper | `div` | none | `css.paneContent`; `clsx(css.paneTab, inactive && css.paneTabHidden)` | `src/client/split-pane.tsx:227`, `:229-232` |
| Empty-pane cards | `div` / `button` | none | `css.paneEmptyCards` / `css.paneCard` | `src/client/split-pane.tsx:129`, `:134` |
| **Tab bar root** | `div` | **none — no `data-dsh-*` attribute at all** | `clsx(css.tabBar, dragOver && css.tabBarDrop)` | `src/client/TabBar.tsx:164-165`; built `lib/client.js:14531` (same `clsx`, no attribute keys in the `jsx("div", …)` props) → only the build-hashed class identifies it |
| Tab bar scroll list / tab / title / close / “+” | `div`,`div`,`span`,`button`,`button` | none | `css.tabList`; `clsx(css.tab, tabActive, pinnedTab)`; `css.tabTitle`; `css.tabClose`; `css.tabBarPlus` | `src/client/TabBar.tsx:185`, `:189-191`, `:234`, `:237`, `:273` |
| Right sidebar column | **not rendered by this plugin** — DSH host markup (native `dsh-client-ui-dockkit`, host class `.paneBody`); the plugin only *styles* it via `:global` and injects bodies | n/a | plugin side: `css.nativeTabHost` wrapper only | `src/client/native/index.ts:157-167` (registers into host slots `sidebar.right.pane.tab`, `sidebar.right.pane.tab.title`); `src/client/native/surface.ts:63-148` (writes via `ctx.sidebarRight*`); `src/client/sidebar.module.css:2040-2056` (host `.paneBody` contract); README:4, :53, :325 |
| Plugin's tab-body host inside the native column | `div` (via `createElement`) | `data-dsh-native-tab-host` → `''` (both the live and the orphan-fallback body) | `css.nativeTabHost` | `src/client/native/tab-adapter.tsx:297` (orphan branch), `:308-309` (live branch); CSS `src/client/sidebar.module.css:2051` |
| Session header / title bar (chat header) | plugin contributes one `button` into DSH's header *utilities* slot; the header itself is host markup | `data-dsh-bottom-toggle` → `''` (always); `data-active` → `'true'` iff panel open, otherwise absent | `css.toggleButton` | registration `src/client/sidebar/bottom-toggle.tsx:23-28` (slot `conversation.session.header.utilities`, `order: 10`); button `src/client/Sidebar.tsx:819-829` (attrs `:822`, `:823`); built `lib/client.js:16549` |
| Document-level markers written by the plugin | `body` / `html` (DSH host elements) | `body[data-dsh-title-bar-compat]` → `''` when strip > 0; `html` style `--dsh-title-bar-strip: <px>`; `body[data-dsh-sidebar-dragging]` → `''` while dragging; `body[data-dsh-tab-dragging]` → `''` while a tab drag is live | n/a | `src/client/Sidebar.tsx:241-249`, `:242` (var), `:520` (var removal), `:524-525`; `src/client/TabBar.tsx:56-57`; CSS consumers `src/client/layout.css:54`, `src/client/sidebar.module.css:166-167`, `:1860-1864` |
| Pane-content sub-regions (no data hooks) | `div` | none | `css.editorHeader` (`EditorHost.tsx:412`, `TextEditor.tsx:437`, `OrphanedTab.tsx:18`); `css.browserBar` (`BrowserView.tsx:166`); `css.terminalWrap` + `css.terminal` (`TerminalView.tsx:410`, `:434`) | same lines; xterm DOM styled through `:global(.xterm)` at `src/client/sidebar.module.css:1885` |

## B. Every `data-dsh-*` attribute emitted by 0.19.1

Own elements (plugin-rendered markup):
| Attribute | Value / condition | Site | Meaning |
|---|---|---|---|
| `data-dsh-better-sidebar` | `''`, always | `src/client/index.tsx:308` | Marks the plugin's own body-level mount host (one per page) |
| `data-dsh-panel-host` | `''`, always | `src/client/Sidebar.tsx:713`, `:611` | Fixed viewport-sized containing block for the panel |
| `data-dsh-panel-host-degraded` | `''` only in degraded (page-transform) mode | `src/client/index.tsx:276` | Switches host to `position:absolute` + per-frame viewport sync |
| `data-dsh-panel` | `''`, always | `src/client/Sidebar.tsx:729` | Marks the single docked panel inside the host |
| `data-dsh-bottom-panel` | `''`, always | `src/client/Sidebar.tsx:730` | Marks the bottom workbench panel specifically |
| `data-dsh-pane` | leaf id string | `src/client/split-pane.tsx:176` | Identifies each workbench pane (one per leaf) |
| `data-dsh-bottom-toggle` | `''`, always (+ `data-active='true'` when open) | `src/client/Sidebar.tsx:822-823` | The expand/collapse button in the session header |
| `data-dsh-native-tab-host` | `''`, always | `src/client/native/tab-adapter.tsx:297`, `:309` | Full-height flex wrapper around a tab body inside DSH's native right column |
| `data-dsh-revealed` | `'true'` only when the row is the reveal target, else absent | `src/client/FileTree.tsx:649`, `:681` | Marks explorer rows highlighted by “show in folder” |
| `data-dsh-html-segment` | `''`, always | `src/client/MarkdownHtml.tsx:204` | Marks a sanitized HTML block segment |
| `data-dsh-md-toc-panel` | `''`, always (panel open + ≥ min headings) | `src/client/md-toc.tsx:113` | Markdown outline popover root |
| `data-dsh-md-toc` | `''`, always | `src/client/md-toc.tsx:133` | Outline toggle button |
| `data-dsh-preset-css` | preset id, e.g. `dsh-desktop`; else tag not created | `src/client/Sidebar.tsx:92`+`:264`; preset ids `src/client/shell-presets.ts:57` | Identity tag on the injected preset `<style>` in `<head>` |
| `data-dsh-custom-css` | `'custom'`; else tag not created | `src/client/Sidebar.tsx:92`+`:265` | Identity tag on the injected user-CSS `<style>` in `<head>` |

DSH host elements patched by the plugin (NOT the plugin's own markup):
| Attribute | Set on | Value | Site | Meaning |
|---|---|---|---|---|
| `data-dsh-center-col` | the AppFrame center column node (host) | `''` | `src/client/sidebar/use-center-column.ts:111` (cleared `:92`, `:109`, `:165`) | Tag the measured conversation column; anchors `layout.css`'s bottom push |
| `data-dsh-title-bar-compat` | `document.body` (host) | `''` | `src/client/Sidebar.tsx:241` (removed `:244`, `:248`) | Legacy boolean companion of `--dsh-title-bar-strip` |
| `data-dsh-sidebar-dragging` | `document.body` (host) | `''` | `src/client/Sidebar.tsx:524` | Kills transitions during panel resize |
| `data-dsh-tab-dragging` | `document.body` (host) | `''` | `src/client/TabBar.tsx:56` | Disarms PDF iframe overlays during tab drag |
| `data-dsh-sidebar-submenu` | `document.body` (host) | whitespace tokens `down` and/or `left` (empty string when neither) | `src/client/menu-flip.ts:65`; token fn `:49-54`; attr name `:23` | Flips portaled submenu growth direction |
| `data-dsh-better-sidebar-settings-nav` | DSH settings-nav `button` whose label matches (host) | `''` | `src/client/settings-nav-icon.ts:30` (set), `:31/:43` (removed) | Lets plugin CSS swap the settings row glyph |
| `data-dsh-sidebar-collapsed` | **no writer — not found** | — | referenced only in CSS `src/client/layout.css:50`; 1 substring hit per built bundle (inlined CSS) | Dead legacy hook: the rule can never match in 0.19.1 |
| `data-dsh-title-bar-height` | **never set by the plugin** | — | only inside the custom-CSS placeholder text: `src/client/locales.ts:261`, `:703` (and the 19 sibling locale files) | Example selector shown to users in the custom-CSS editor, not emitted |

## C. Token migration table (0.16.x/0.18.x era → 0.19.1)

Raw substring counts per built file (the task's token strings, case-sensitive, `grep -o -F | wc -l`):

| token | client.js | client-registry.js | client-terminal.js | client-editor.js | client-mermaid.js | index.js | invariant.js | total |
|---|---|---|---|---|---|---|---|---|
| `data-dsh-better-sidebar` | 4 | 4 | 0 | 0 | 0 | 0 | 0 | 8 |
| `data-dsh-float-window` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **0** |
| `_panel` | 4 | 4 | 4 | 4 | 4 | 0 | 0 | 20 |
| `_bottomPanel` | 10 | 10 | 10 | 10 | 10 | 0 | 0 | 50 |
| `_pane` | 24 | 24 | 22 | 22 | 22 | 0 | 0 | 114 |
| `_tabBar` | 11 | 11 | 11 | 11 | 11 | 0 | 0 | 55 |
| `_editorHeader` | 2 | 2 | 2 | 2 | 2 | 0 | 0 | 10 |
| `_browserBar` | 2 | 2 | 2 | 2 | 2 | 0 | 0 | 10 |
| `_addBar` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **0** |
| `_addButton` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **0** |
| `_terminalWrap` | 2 | 2 | 2 | 2 | 2 | 0 | 0 | 10 |
| `_terminal` | 33 | 33 | 102 | 31 | 31 | 0 | 0 | 230 |
| `_xterm` | 0 | 0 | 4 | 0 | 0 | 0 | 0 | 4 |
| `_floatWindow` | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **0** |

Why the counts are inflated (classification of every hit family):
- Each bundled file inlines its **own copy of the whole CSS text**; additionally `client.js` and `client-registry.js` are near-duplicate builds, so the same class name recurs across all 5 client bundles (hence ×5 for most tokens).
- Each class name yields ≥2 hits per bundle: once as a CSS-module **map value** (`lib/client.js:3198` starts `var sidebar_module_css_default = {`, e.g. `"bottomPanel": "nArs4W_bottomPanel"` at `lib/client.js:3337`) and once as a **CSS rule/selector** inside the inlined stylesheet string. Extra hits are repeated selectors (compound rules, media queries).
- Per-token composition (client.js): `_panel` = `nArs4W_panel`×2 + `nArs4W_panelBody`×2. `_bottomPanel` = `nArs4W_bottomPanel`×7 + `nArs4W_bottomPanelHidden`×3 (the `Hidden` modifier shares the substring). `_pane` = `nArs4W_pane`×2 + `paneCard`×6 + `paneContent`×2 + `paneDrop`×2 + `paneEmptyCards`×2 + `paneTab`×2 + `paneTabHidden`×2 + `nArs4W_panel`×2 + `nArs4W_panelBody`×2 + the plugin's *other* CSS module `changes.module.css`: `bdiHEa_paneBody`×2 (source `src/client/changes/changes.module.css:385`). `_tabBar` = `tabBar`×4 + `tabBarDrop`×2 + `tabBarPlus`×5. `_terminal` in client-terminal.js additionally picks up xterm-library identifiers `_terminal`×40, `_terminalClass`×7, `_terminalSelector`×24.
- `_xterm` (client-terminal.js only) = bundler module ids `import_xterm`×2 + `require_xterm`×2 for the `@xterm/xterm` dependency — **not a class**. The real xterm DOM hook is a `:global(.xterm)` selector (`src/client/sidebar.module.css:1885`) which compiles to `.nArs4W_terminal .xterm` (no `_xterm` substring).
- Live-application counts (JS property accesses `sidebar_module_css_default.<name>` in client.js) — the only evidence a class actually reaches an element: `bottomPanel` 1 (`lib/client.js:16460` ← `Sidebar.tsx:728`), `pane` 1, `tabBar` 1, `nativeTabHost` 2, `workbench` 1, `editorHeader` 2, `browserBar` 1, `paneContent` 1, `terminalWrap` 1 + `terminal` 1 (in client-terminal.js), `editorHeader` 1 (client-editor.js), **`panel` 0**.

Per-token verdict:
| Token | In 0.19.1? | Replacement / note |
|---|---|---|
| `data-dsh-better-sidebar` | **Yes** | Exactly one live set: `src/client/index.tsx:307-309` on the plugin's own body-level host `div`; built `lib/client.js:18870` (`host.setAttribute("data-dsh-better-sidebar", "")`). It is *not* on panels/panes; the panel layer uses `data-dsh-panel-host` (`Sidebar.tsx:713`). |
| `data-dsh-float-window` | **No — 0 hits anywhere** | The whole free-window surface was deleted in 0.19.0 (README:325; also README:4 “旧的浮窗能力同步移除”). Right column is now DSH's native sidebar (README:4, :53). |
| `_panel` | Class gone as an element hook | `nArs4W_panel` survives only in the auto-generated map (`lib/client.js:3329`) and one dead selector `body[data-dsh-sidebar-dragging] .panel` (`src/client/sidebar.module.css:166`); 0 JS accesses → **no element carries it**. The old right panel is replaced by the host `[data-dsh-panel-host]` layer + the bottom panel's `[data-dsh-bottom-panel]`. |
| `_bottomPanel` | **Live class** | See explicit answer below. Replaces the era's float/panel class; stable selector is `[data-dsh-bottom-panel]`. |
| `_pane` | Live class (hashed) | `nArs4W_pane` on the leaf root (`split-pane.tsx:175`, built `lib/client.js:14858` region); stable selector is `[data-dsh-pane]` (`:176`). |
| `_tabBar` | Live class (hashed) | `css.tabBar` on the strip root (`TabBar.tsx:165`); **no stable attribute replacement — not found**. |
| `_editorHeader` | Live class (hashed) | `EditorHost.tsx:412`, `TextEditor.tsx:437`, `OrphanedTab.tsx:18`; no `data-*`; not-found for a stable hook. |
| `_browserBar` | Live class (hashed) | `BrowserView.tsx:166`; no `data-*`. |
| `_addBar`, `_addButton` | **No — 0 hits in src and in every bundle** | Not found; replaced by the tab strip's `+` control (`css.tabBarPlus`, `TabBar.tsx:273`) and empty-pane `css.paneCard` cards (`split-pane.tsx:134`). |
| `_terminalWrap` | Live class (hashed) | `TerminalView.tsx:410`; 0 accesses in client.js because `TerminalView` lives in the lazy `client-terminal.js` chunk (1 access there). No `data-*` replacement. |
| `_terminal` | Live class (hashed) | xterm mount point `TerminalView.tsx:434`; the xterm-generated DOM is styled via `:global(.xterm)` (`sidebar.module.css:1885`). |
| `_xterm` | **No class** | Only dependency module ids in client-terminal.js; see above. |
| `_floatWindow` | **No — 0 hits** | Removed with the float API in 0.19.0 (README:325). |

Explicit answers:
1. **`data-dsh-better-sidebar` is still placed on exactly one element in 0.19.1**: the plugin's own mount host `div`, created imperatively, set at `src/client/index.tsx:308` (create `:307`, `document.body.appendChild` `:309`), React root rendered into it at `:311`. Built equivalent: `lib/client.js:18870` `host.setAttribute("data-dsh-better-sidebar", "")`. Of the 8 substring hits across all bundles, only 1 is the bare attribute — the other 3 per main bundle are the *different* attribute `data-dsh-better-sidebar-settings-nav` (`lib/client.js:17327` const, `lib/client.js:18668` ×2 in inlined CSS; `settings-nav-icon.ts:13`). It is not on `[data-dsh-panel-host]`, not on the bottom panel, not on the native right column.
2. **`_bottomPanel`'s 10 raw hits in client.js = `nArs4W_bottomPanel` ×7 + `nArs4W_bottomPanelHidden` ×3** (identical in client-registry.js; 10 in each of client-terminal/editor/mermaid = 50 total). All 10 are stylesheet text or the CSS-module map, **but the class is live**: `nArs4W_bottomPanel` is applied to the bottom workbench panel root at `src/client/Sidebar.tsx:728` (`clsx(css.bottomPanel, !state.bottomOpen && css.bottomPanelHidden)`), confirmed in the build as `className: clsx(sidebar_module_css_default.bottomPanel, …)` (`lib/client.js:16460`) and resolved through the map entry `"bottomPanel": "nArs4W_bottomPanel"` (`lib/client.js:3337`). The hash `nArs4W_bottomPanel` is build-generated and must not be targeted; the same element's stable hook is `data-dsh-bottom-panel` / `data-dsh-panel` (`Sidebar.tsx:729-730`). (`nArs4W_bottomPanelHidden` is the closed-state modifier on the same element.)

## D. Styling hooks a third-party plugin may safely target in 0.19.1

Stable, plugin-owned attributes (documented in markup, not hashes):
- `[data-dsh-better-sidebar]` — whole-plugin mount host (`index.tsx:308`) — but note it is *not* the panel layer.
- `[data-dsh-panel-host]` / `[data-dsh-panel-host][data-dsh-panel-host-degraded]` — panel containing block (`Sidebar.tsx:713`, `index.tsx:276`); the only data hooks the README itself documents (README:526 / README_EN.md:531).
- `[data-dsh-panel]`, `[data-dsh-bottom-panel]` — bottom workbench panel root (`Sidebar.tsx:729-730`); `[data-dragging]` while resizing (`:745`).
- `[data-dsh-pane]` — per-pane hook, value = pane id (`split-pane.tsx:176`).
- `[data-dsh-bottom-toggle]`, `[data-dsh-bottom-toggle][data-active="true"]` — session-header toggle (`Sidebar.tsx:822-823`).
- `[data-dsh-native-tab-host]` — plugin tab-body wrapper inside DSH's native right column (`native/tab-adapter.tsx:297`, `:309`).
- Body-level state hooks: `body[data-dsh-sidebar-dragging]` (`Sidebar.tsx:524`), `body[data-dsh-tab-dragging]` (`TabBar.tsx:56`), `body[data-dsh-sidebar-submenu~="down"|"left"]` (`menu-flip.ts:65`), `body[data-dsh-title-bar-compat]` + `html{--dsh-title-bar-strip}` (`Sidebar.tsx:241-242`), `html{--dsh-sidebar-height}` (`Sidebar.tsx:371`).
- Content hooks: `[data-dsh-revealed]` (`FileTree.tsx:649`), `[data-dsh-md-toc]` / `[data-dsh-md-toc-panel]` (`md-toc.tsx:133`, `:113`), `[data-dsh-html-segment]` (`MarkdownHtml.tsx:204`), style-tag hooks `[data-dsh-preset-css]` / `[data-dsh-custom-css]` (`Sidebar.tsx:264-265`).
- Host-shared (patch, do not assume): `[data-dsh-center-col]` (`use-center-column.ts:111`) and `[data-dsh-better-sidebar-settings-nav]` (`settings-nav-icon.ts:30`) are written onto DSH's own elements and removed on dispose.
- Third-party tab components are mounted inside `[data-dsh-native-tab-host]` (`sidebar.module.css:2040-2056`) and keep the `flex:1`/fill contract; README:306 documents this as the guarantee for third-party `registerTab` descriptors.

Hooks REMOVED in 0.19.0 (release that adopted DSH's native right sidebar and deleted the old floating window):
- Self-drawn right panel and free/floating windows, plus the float API (`floats`, `floatTab`, `dockFloat`, `raiseFloat`, the “move to free window” context item), the `features` flag `'floatWindows'`, and the settings `openByDefault` / `defaultWidthPercent` / `changesDiffFloat` — README:325 (v0.19.0-alpha.0 changelog, PR #605). Summary banner: README:4 (“插件**不再自绘右侧面板**（旧的浮窗能力同步移除）”), feature list README:53, comparison table README:171. The pre-removal feature is described at README:432 (v0.18-era changelog, PR #354) for identification of the deleted surface.
- Consequently absent in 0.19.1: `data-dsh-float-window` (0 hits), `_floatWindow` (0), and any `.panel` element hook (`css.panel` accessed 0 times in the build, `lib/client.js`).
- Dead-but-present: `body[data-dsh-sidebar-collapsed]` CSS remains (`layout.css:50`) but no code writes it in 0.19.1 → can never match.
- `_addBar` / `_addButton` are not found in 0.19.1 sources or bundles at all.

## E. README-documented CSS / customization hooks

- `data-dsh-preset-css` / `data-dsh-custom-css`: **not documented in README** (not found; `grep -n "data-dsh-preset-css\|data-dsh-custom-css" README.md` = 0). Source-only: tagged `<style>` elements injected into `<head>`, `src/client/Sidebar.tsx:90-98` (`injectUserCss`), called at `:264` (preset, value = `preset.id`, e.g. `dsh-desktop` at `shell-presets.ts:57`) and `:265` (custom, value `'custom'`). The preset field is declared as “injected last, after the plugin's own styles… targets the plugin's stable data attributes” (`shell-presets.ts:33-39`).
- Custom CSS entry point (user-facing): settings “位置兼容模式 → 自定义方案（自定义 CSS + 下移距离）” — README:507; stored as `prefs.customCss` (`src/client/prefs.ts:90-92`) and edited in `src/client/SideCardSection.tsx:739`, `:1061-1062`.
- Theming: the plugin styles with DSH design tokens `--dsw-alias-*` and follows the dsh-web-ui skin center — README:562, also README:276, :508. Preset/custom CSS can override `--dsh-title-bar-strip` on `<html>`; the documented example is `html[data-dsh-title-bar-height="36"] { --dsh-title-bar-strip: 36px !important; }` (`src/client/locales.ts:261` zh / `:703` en, mirrored in the 19 locale files) — note `data-dsh-title-bar-height` is an *example* authored by the user; the plugin never sets it (see B).
- Extension API (not CSS): `ctx.betterSidebar.registerTab` / `registerFileViewer` — README:176 with a code sample at README:178-191 (fenced `ts` block), and README:60; full guide is `docs/external-plugin-guide.md`, referenced at README:604 but **not shipped in this npm package** (not found in the extraction).
- The only `data-dsh-*` hooks named in README prose are `[data-dsh-panel-host]` and `data-dsh-panel-host-degraded` (README:526; README_EN.md:531).
