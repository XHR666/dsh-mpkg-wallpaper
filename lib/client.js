// ①(双版本兼容 2026-09-11) dsh 0.1.1-rc.x 期望客户端模块 id = "@local/dsh-mpkg-wallpaper"
// （插件装于 profiles/node_modules/@local/ 时）；dsh 0.1.5-rc.x 期望 = 包名 "dsh-mpkg-wallpaper"
// （官方 `dsh plugin add` 装入 profile 依赖）。两版各自只校验"自己期望的那个 id"是否已注册，
// 多余注册不被检查 —— 故同时注册两个 id 即可双向兼容；factory 内用全局幂等守卫避免重复初始化。
var __mpwFactory = (require) => {
		if (globalThis.__mpwClientLoaded) return globalThis.__mpwClientLoaded;
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		let react = require("react");
		// ①(修正) react-dom portal：弹窗遮罩提到 document.body。
		// 设置面板/backdrop-filter 容器会创建包含块/backdrop root，把 fixed 遮罩
		// 困在面板内 → 遮罩只盖住右侧设置区（用户实测）；portal 后盖全屏且模糊全屏。
		let ReactDOM = null;
		try { ReactDOM = require("react-dom"); } catch {}
		// ①(2026-09-12) 降级自挂载需要 createRoot：部分宿主只暴露 react-dom/client
		let ReactDOMClient = null;
		try { ReactDOMClient = require("react-dom/client"); } catch {}



		// ═══════════════════════════════════════════════════════════════════
		//  常量
		// ═══════════════════════════════════════════════════════════════════
		const ROW_ID = "mpkg-wallpaper";

// ═══ ①(2026-09-12) 全链路 trace：把"插件加载 → 注册 → 宿主是否调用组件 → 是否挂载 → 自挂载结果"
//   每一步都打点并 POST 到宿主 /diag（落盘 diag-*.json），刷新一次即可看到完整加载逻辑，
//   不再靠猜。事件：apply:start / apply:skip / inject:cb / register:ok / section:enter /
//   section:built / section:throw / selfmount:* / verify:* / dom:snapshot
const MPW_TRACE = [];
function mpwTrace(ev, data) {
	try {
		MPW_TRACE.push({ ev, at: Date.now() % 1000000, data: data || null });
		if (MPW_TRACE.length > 300) MPW_TRACE.shift();
		// ①(P-104 2026-09-17 用户发布纪律①) **默认不上报**（旧实现**无条件**发）：
		//   用户原话"像你这种测试用的自动上报的功能，这种你在上传仓库的时候要把它默认给关掉"。
		//   实测代价：每次页面加载至少 POST 3 份（apply:start / inject:cb / register:ok）⇒
		//   宿主端 diag-<epochms>.json 堆到 3483 个 / 63MB。
		//   现在只有**显式**开 `localStorage['mpwdiag'] = '1'` 才发网络请求；内存环形缓冲（≤300 条）
		//   照旧保留，面板里仍能看到 trace。不透明源（strict 沙箱）下读 localStorage 抛错 → 也按"不开"。
		try { if (localStorage.getItem('mpwdiag') !== '1') return; } catch (e) { return; }
		fetch(HOST_BASE + '/diag', { method: 'POST', body: JSON.stringify({ kind: 'trace', why: ev, data: data || null, seq: MPW_TRACE.length, at: new Date().toISOString() }) }).catch(() => {});
	} catch {}
}
		const NS = "ui-mpkg-wallpaper";
		const STORE_KEY = "dsh.mpkg-wallpaper.v2";
		/** ①(2026-09-17 对抗性审查) 统一"致命路径不许静默"出口。
		 *  背景：本文件历史上有 500+ 个空 catch；正是因为 catch 把 ReferenceError/TypeError 吞掉，
		 *  才出现"磨砂三轮没修好"（真因在传播到 window.onerror 之前就没了 ⇒ 连全局兜底都收不到）。
		 *  纪律：关键路径（CSS 注入 / token 覆盖 / 壁纸挂载 / 磨砂同步 / 样式自愈 / 定时子系统）
		 *  一律走这里：① console.error 必有一行；② 同一错误只出口一次（3s 定时器不会刷屏）；
		 *  ③ 环形缓冲 ≤40 条，`window.__mpwErrRing()` 可读；④ 只有显式开
		 *  `localStorage['mpwdiag']='1'` 才 POST /diag —— **默认不上报**（用户发布纪律①）。 */
		const MPW_ERR_RING = [];
		const MPW_ERR_SEEN = new Map();
		function mpwErr(where, e) {
			const msg = String((e && e.message) || e || 'unknown');
			try {
				const key = where + '|' + msg;
				const n = (MPW_ERR_SEEN.get(key) || 0) + 1;
				MPW_ERR_SEEN.set(key, n);
				if (n > 1) return n;
				MPW_ERR_RING.push({ at: Date.now(), where, msg });
				if (MPW_ERR_RING.length > 40) MPW_ERR_RING.shift();
			} catch {}
			try { console.error("[dsh-mpkg-wallpaper] " + where + " 失败:", e); } catch {}
			try {
				if (localStorage.getItem('mpwdiag') !== '1') return 1;
				fetch(HOST_BASE + '/diag', { method: 'POST', body: JSON.stringify({ kind: 'js-error', why: where, at: new Date().toISOString(), url: location.href, message: msg.slice(0, 600), stack: String((e && e.stack) || '').slice(0, 1500) }) }).catch(() => {});
			} catch {}
			return 1;
		}
		try { window.__mpwErrRing = () => MPW_ERR_RING.slice(); } catch {}
		try { window.__mpwErrProbe = (where, msg) => mpwErr(String(where || 'probe'), new Error(String(msg || 'probe'))); } catch {}
		/** ①(2026-09-17) 轮换周期钳制（测试入口；真实调用点在 startRotation）。 */
		function mpwClampRotMin(v) {
			const n = Number(v);
			return Math.max(1, Math.min(120, Number.isFinite(n) && n > 0 ? n : 5));
		}
		try { window.__mpwClampRotMin = mpwClampRotMin; } catch {}
		// ①(P-104 2026-09-17 用户发布纪律②) **插件侧 localStorage 也要有上限**：
		//   本插件只用固定几个键（STORE_KEY / mpw_settings_backup / mpwdiag / mpwwatch），键数量天然有界；
		//   真正的风险在**单值**——STORE_KEY 里含背景 data URL（本文件注释自述 1MB+）。这里给单值硬顶
		//   256KB：超了**不写 localStorage**（大图本来就走 IndexedDB 分支）+ **打一行警告**（不静默）。
		//   上限数值只在这里定义一次。
		const MPW_LS_MAX_BYTES = 256 * 1024;
		// ①(2026-09-17 持久化轮) **大图落 IndexedDB 的线**（与上一条上限是两个不同口径的**真值**）：
		//   旧代码把这条线写死成 2MB（storeImage / storeImageBlob / 面板文案三处各写一份），
		//   而 localStorage 的真实硬顶是 256KB ⇒ 落在 (256KB, 2MB] 这一带的壁纸（本机语料实测
		//   preview.gif 的 dataURL 全在 1.30–1.36MB，见 tools/persist-size-scan.mjs）被判成"小图内联"，
		//   于是 STORE_KEY 整串 JSON 超顶被**拒写**、又不落 IDB ⇒ 刷新即回默认壁纸（真机 bug）。
		//   现在集中在这里一处定义：≥ 这条线 → 只进 IndexedDB（localStorage 里留 `idb:img` 哨兵）；
		//   < 这条线且整串 JSON 放得下 → 内联；放不下 → 也落 IDB（见 mpwPersistSection）。
		const MPW_LS_SPILL_BYTES = 2 * 1024 * 1024;
		/** ①(2026-09-17) 回退开关：`?mpwpersist=legacy` → 回到"只有 >2MB 才落 IDB、localStorage 拒写就丢"的旧行为。 */
		function mpwPersistLegacy() {
			try { return /[?&]mpwpersist=legacy(?:&|$)/.test(String(location.search || "")); } catch { return false }
		}
		const mpwLsSafeSet = (k, s) => {
			try {
				if (typeof s !== "string") return false;
				if (s.length > MPW_LS_MAX_BYTES) {
					console.warn("[dsh-mpkg-wallpaper] localStorage 拒绝写入 " + k + "：单值 " + (s.length / 1024).toFixed(1)
						+ " KB > 上限 " + Math.round(MPW_LS_MAX_BYTES / 1024) + " KB（大图请走 IndexedDB；本键保留旧值）");
					return false;
				}
				localStorage.setItem(k, s);
				return true;
			} catch (e) { return false; }   // 存储满 / 不透明源 → 保持既有"静默降级"语义
		};
		const DEFAULT_OPACITY = 82;
		const DEFAULT_BLUR = 12;
		const DEFAULT_ZOOM = 100;
		const DEFAULT_SIDEBAR = true;
		const DEFAULT_SHARP = true;
		const DEFAULT_HEADER = true;
		const DEFAULT_HEADER_BG = true;
		const DEFAULT_HEADER_BLUR_AMOUNT = 0; // 标题栏磨砂程度 0-100%（白雾厚度；默认 0=透明，避免 session log 等按钮被白色矩形框包住）
		const DEFAULT_DIALOG_BLUR = true;
		const DEFAULT_DIALOG_AMOUNT = 14;
		// ①(新) 虚化对话框拆三类：通用居中窗口 / 设置面板 / 下载·确认弹窗，各自独立开关+程度
		const DEFAULT_SETTINGS_BLUR = true;    // 虚化设置面板
		const DEFAULT_SETTINGS_AMOUNT = 14;    // 设置面板虚化程度
		const DEFAULT_CONFIRM_BLUR = true;     // 虚化下载/确认弹窗
		const DEFAULT_CONFIRM_AMOUNT = 12;     // 下载/确认弹窗虚化程度
		// ①(新) 侧边栏磨砂（Aqua 方案：sidebarCol 自身 backdrop-filter；弹窗打开时 :has() 摘除）
		const DEFAULT_SIDEBAR_BLUR = false;    // 侧边栏磨砂开关（默认关=壁纸层方案；开=Aqua 玻璃）
		// ①(新 2026-09-11) DSH 0.1.5 自带右侧边栏/dock 浮层虚化（兼容桥纳入旧规则作用域）
		const DEFAULT_RIGHT_SIDEBAR_BLUR = true;      // 右侧边栏/dock 虚化开关
		const DEFAULT_RIGHT_SIDEBAR_AMOUNT = 14;      // 虚化程度 px
		const DEFAULT_RIGHT_SIDEBAR_ALPHA = 45;       // 表面白雾透明度 %（0=全透明 100=不透明）
		const DEFAULT_SIDEBAR_BLUR_AMOUNT = 14; // 侧边栏磨砂程度
		const DEFAULT_POPOVER_BLUR = true;   // 弹层虚化（菜单/提示/遮罩）开关
		const DEFAULT_POPOVER_AMOUNT = 10;   // 弹层虚化程度
		// ①(新 2026-09-13 用户"浮层被压住"定案) 弹层**表面不透明度**（0-100，默认 94）。
		//   为什么需要一个独立数字：弹层背景过去完全依赖宿主 token（--dsw-specific-menu 等），
		//   一旦 token 被改成半透明、而 backdrop 模糊又因祖先/环境失效，弹层就会"看得穿"
		//   （用户截图实锤：背后对话文字锐利可见）。这里给弹层补一条**显式底色**兜底，
		//   并把不透明度交给用户调节：模糊生效时可以调低到 ~80 走玻璃感，
		//   环境不支持模糊时保持 94+ 保证可读。
		const DEFAULT_POPOVER_ALPHA = 94;
		const DEFAULT_MASK_BLUR = true;   // 遮罩虚化（设置/弹层打开时全屏背景遮罩）
		const DEFAULT_MASK_AMOUNT = 8;    // 遮罩虚化程度
		// ①(新 2026-09-13 第15项) 纯 CSS/SVG 液态玻璃（不占 WebGL 上下文，可与 scene 壁纸共存）
		// ①(新 2026-09-12) 场景渲染上报：壁纸 iframe 默认带 `noreport=1`（不向渲染器 /report 刷诊断），
		//   但这导致"我在壁纸里看到的画面"没有任何现场数据（上报只来自手动打开的 demo 页）。
		//   打开本开关 → 壁纸 URL 去掉 noreport → 渲染器每 10s 把截图/逐层台账/纹理统计落到 reports/。
		//   ①(2026-09-14 用户第 14 项) 改为**默认开**：用户要的是"我看每个壁纸时，日志和截图自动上传后台，
		//   AI 去看后台"。真机链路已通（服务器把 /report 落到渲染器仓库的 reports/ 目录，
		//   含 shot(jpeg)/log/37 层 layerHealth/texStats/layerLedger），此前只在面板里手动开。
		//   仍然可在面板关（sceneReport=false）；写入量很小（每 10s 一份 ≤8KB 紧凑 JSON + 一张小图）。
		const DEFAULT_SCENE_REPORT = true;
		const DEFAULT_LG_CSS = false;      // 默认关（opt-in；开启后侧边栏/标题栏/输入框走 SVG 折射玻璃）
		const DEFAULT_LG_CSS_AMOUNT = 14;  // 折射强度（feDisplacementMap scale，0=纯模糊）
		// ①(新 2026-09-13 用户要求"给我一个单独的标题栏磨砂强度滑条")
		//   背景：统一虚化(unifyTint)开启时，标题栏磨砂半径被 unifyAmount 接管（这是用户此前
		//   要求的"不能被自由关掉露出壁纸"）；但用户仍希望**只调标题栏**的磨砂强度。
		//   方案：默认（false）保持联动，开这个开关后才用 headerFrostAmount 覆盖半径。
		const DEFAULT_HEADER_FROST_OWN = false;   // 单独指定标题栏磨砂半径
		const DEFAULT_HEADER_FROST_AMOUNT = 30;   // 标题栏磨砂半径 px（0=不磨砂）
		const DEFAULT_UNIFY_TINT = true; // 统一虚化：整屏模糊感由一个独立条控制
		const DEFAULT_UNIFY_AMOUNT = 30; // 统一虚化程度 0-40：0=清晰，40=强模糊（控制壁纸层 blur）
		const DEFAULT_CHAT_FOLLOW = true; // ①(新) 统一虚化是否接管聊天区壁纸（开=整屏统一；关=磨砂条独立控制聊天区，统一虚化只管侧边栏/标题栏）
		const DEFAULT_SIDEBAR_ALPHA = 35; // ①(新) 统一虚化下侧边栏/标题栏白雾厚度 0-100（默认 35：顶栏/侧边栏一致且白底淡，session log/模式标签后不会太突兀；用户实测 55 太厚）
		const DEFAULT_SESSION_FOLLOW = true; // 统一虚化下，「新会话」按钮是否随整屏虚化（关=随面板不透明度）
		const DEFAULT_HYBRID = true; // ①(新) 大文件混合模式：上传到 DSH 宿主流式播放（>600MB 无限制）；关=纯浏览器模式
		// ⑲(新) Aqua 实验模式（借鉴 Bil812 fork，默认全关，不影响原功能）：
		// - aquaMask：统一雾（#mpw-mask 全屏遮罩，所有表面共享一种雾色）
		// - aquaTint：面板颜色匹配壁纸主色（48×48 采样）
		// - aquaInk：自适应文字色 + 蓝色清理（brand 覆写为墨色衍生）
		const DEFAULT_AQUA_MASK = false;
		const DEFAULT_AQUA_TINT = false;
		const DEFAULT_AQUA_INK = false;
		// ⑲(新) 深底文字可读增强（默认关；近似方案=全局双色描边，无法精确"只变经过深色处"）
		const DEFAULT_AQUA_TEXT_ENHANCE = false;
		// ⑲(新) 任务列表（todo 卡片）磨砂背景（默认关）
		const DEFAULT_TODO_BLUR = false;
		// ①(新) 主题颜色（accent）：空 = DSH 默认品牌蓝；设置后驱动按钮/滑条/选中/链接/发送键
		//（参照 elysia395/dsh-wallpaper-engine 的 accent 主题色）
		const DEFAULT_THEME_COLOR = "";
		// ⑲(新) 统一雾强度（独立滑条，默认 82%）
		const DEFAULT_AQUA_MASK_ALPHA = 82;
		// ⑲(新) 面板取色强度（壁纸色混合比例 0-100%，默认 45——用户实测默认太淡看不出变化）
		const DEFAULT_AQUA_TINT_STRENGTH = 45;
		const DEFAULT_ROTATE = false; // ③(新) 壁纸轮换：定时自动切换下一个壁纸
		const DEFAULT_PLAYBACK_RATE = 1; // ⑳(新) 视频倍速（0.5-2x，原生 playbackRate）
		const SPEED_LEVELS = [0.5, 0.75, 1, 1.25, 1.5, 2]; // ⑳(新) 倍速档位
		const ALLOWED_FPS = [24, 30, 48, 60]; // ⑳(新) 解码帧率上限档位（与 host 转码一致）
		const RES_LEVELS = [0, 1280, 1920, 2560]; // ①(新) 分辨率上限档位（0=不限制；宽像素，保持宽高比）
		const DEFAULT_RES_MAX = 0; // ①(新) 分辨率上限默认：不限制
		const DEFAULT_BRIGHTNESS = 100; // ⑧(新) 画面亮度（50-150%，滤镜）
		const DEFAULT_FLOAT = false; // ①(新) 悬浮效果：侧边栏/标题栏悬浮卡片（默认关）
		const DEFAULT_ROUND_COMPAT = false; // ②(新) 第三方插件 UI 圆角兼容开关（默认关，未完全兼容暂不打扰）
		const HOST_BASE = "/api/mpkg-wallpaper";
		// ①(MERGED-3 1.3) 诊断开关速查区离线副本（渲染器离线时用）。
		//   在线数据源 = <渲染器>/diag-flags.json（由 we-scene-demo/diag-flag-check.mjs 脚本生成，勿手改）；
		//   tools/panel-smoke.mjs 断言本副本 == diag-flags.json 的 common 集合 → 两边同步，勿单独改这里。
		const MPW_DIAG_FLAGS_FALLBACK = '[{"name":"att","usage":"att=legacy"},{"name":"mcc","usage":"mcc=1"},{"name":"piv","usage":"piv=1"},{"name":"align","usage":"align=0"},{"name":"parallax","usage":"parallax=legacy"},{"name":"audio","usage":"audio=1"},{"name":"whitefallback","usage":"whitefallback=0"},{"name":"hier","usage":"hier=0"},{"name":"isolate","usage":"isolate=<层名>"},{"name":"audit","usage":"audit=3"}]';
		const DEFAULT_THINK_BG = false; // Deep diving 背景方框：默认取消（透明）
		const DEFAULT_ENABLED = true;
		const DEFAULT_CLOCK = false;
		const DEFAULT_CLOCK_24H = true;
		const DEFAULT_CLOCK_SEC = false;
		const DEFAULT_CLOCK_DATE = false;
		const DEFAULT_CLOCK_POS = "tr";
		const DEFAULT_CLOCK_SIZE = 40;
		const BG_WRAP_ID = "mpw-bgWrap";
		const BG_IMG_ID = "mpw-bgImg";
		const BG_VIDEO_ID = "mpw-bgVideo";
		const BG_CANVAS_ID = "mpw-bgCanvas";
		/** ⑥ 设置导航图标（中性"风景画"图标，非壁纸引擎商标，无侵权风险）。 */
		// ①(2026-09-13 用户要求) 设置导航图标改为**用户提供的内联 SVG**（图片图标）：
		//   ① 不再用 base64 <img>（固定配色，不跟随主题）；
		//   ② 内联 <svg> + `stroke="currentColor"` → 浅色/深色主题自动适配；
		//   ③ 保留 class `mpw_navIconImg`（既让 `:has(.mpw_navIconImg)` 那条"隐藏宿主默认图标"的 CSS 继续生效，
		//      也沿用既有尺寸规则）。`?navicon=old` 可切回旧的图片图标做对照。
		const NAV_ICON_SVG = (size) => react.createElement("svg", {
			className: "mpw_navIconImg", width: size || 16, height: size || 16, viewBox: "0 0 24 24",
			fill: "none", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true", focusable: "false",
		},
			react.createElement("path", { d: "M16.2402 3.5H7.74023C4.97881 3.5 2.74023 5.73858 2.74023 8.5V15.5C2.74023 18.2614 4.97881 20.5 7.74023 20.5H16.2402C19.0017 20.5 21.2402 18.2614 21.2402 15.5V8.5C21.2402 5.73858 19.0017 3.5 16.2402 3.5Z", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" }),
			react.createElement("path", { d: "M2.99023 17L5.74023 13.8C6.10008 13.4427 6.57234 13.2206 7.07711 13.1714C7.58188 13.1222 8.08815 13.2489 8.51023 13.53C8.93232 13.8112 9.43859 13.9379 9.94335 13.8887C10.4481 13.8395 10.9204 13.6174 11.2802 13.26L13.6102 10.93C14.2797 10.2583 15.1661 9.84625 16.1113 9.76749C17.0564 9.68872 17.9988 9.94835 18.7702 10.5L21.2602 12.43", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" }),
			react.createElement("path", { d: "M7.99008 10.1701C8.90687 10.1701 9.65008 9.42689 9.65008 8.5101C9.65008 7.59331 8.90687 6.8501 7.99008 6.8501C7.07329 6.8501 6.33008 7.59331 6.33008 8.5101C6.33008 9.42689 7.07329 10.1701 7.99008 10.1701Z", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" }));

		// ═══════════════════════════════════════════════════════════════════
		//  localStorage 持久化（⑤：读写带缓存 + 防抖，滑杆不卡顿）
		// ═══════════════════════════════════════════════════════════════════
		let sectionCache = null;
		let persistTimer = null;
		let hostSettingsOk = false; // ⑤(新) host /settings 是否可用（持久化到宿主端文件）
		let sectionDirty = false;   // ⑤(修正) 本次启动后用户是否已改过设置（防 host GET 竞态覆盖）
		// ①(修正) 用户手动暂停/播放壁纸（停住画面）。wallUserPaused 是**唯一**权威事实来源，
		// 只由 toggleWallPause（source='user'）修改并执行暂停/恢复。
		// ①(修正) 声明**上移**到模块级顶部（原在下方函数区）：确保任何 video play/pause 事件
		// 回调（ensureBgDom 阶段挂载）引用它时已初始化，避免 TDZ 报错。
		let wallUserPaused = false;
		// ①(新) dsh-better-sidebar 版本（host /ping 附带），用于按版本做适配分支。
		// 设到 body 的 data-mpw-bs-version 属性 → buildCss 可按版本生成仅新/旧版生效的规则；
		// 版本未知(null/读不到)时保持属性缺失，所有适配按"通用"路径执行（向后兼容旧版）。
		let betterSidebarVersionKnown = null;
		function applyBetterSidebarVersion(v) {
			try {
				betterSidebarVersionKnown = (typeof v === "string" && v) ? v : null;
				if (betterSidebarVersionKnown) document.body.setAttribute("data-mpw-bs-version", betterSidebarVersionKnown);
				else document.body.removeAttribute("data-mpw-bs-version");
			} catch {}
		}
		// ①(修正 2026-09-17) 版本探测必须**页面加载时**就跑一次。
		//   原实现只在「设置页组件」(settings.section) 的 effect 里发 /ping ⇒ 用户不打开插件
		//   设置页时 body 上永远没有 data-mpw-bs-version ⇒ 所有 `[data-mpw-bs-version^=…]`
		//   版本门控规则一条都不生效（"按版本自适应适配"形同虚设；真机探针实测，见
		//   docs/BETTER-SIDEBAR-COMPAT.md §3）。这里挪到 apply 启动路径（与 initHostSettings
		//   同批）；设置页里那次保留（打开设置页时把版本号/适配分类刷新一遍）。
		//   5s 去抖：apply 可能在 RTC 重连/热重注入时重跑，避免同一秒内重复请求。
		function refreshBetterSidebarVersion() {
			try {
				const now = Date.now();
				if (now - (window.__mpwBsVerAt || 0) < 5000) return;
				window.__mpwBsVerAt = now;
				fetch(HOST_BASE + "/ping", { method: "GET" })
					.then((r) => (r && r.ok ? r.json() : null))
					.then((d) => { if (d && d.betterSidebar) applyBetterSidebarVersion(d.betterSidebarVersion); })
					.catch(() => {});
			} catch {}
		}
		// ⑤(修正) 宿主端只存"设置"（外观类），不含大体积 image dataURL/临时 info——
		// 既避免每次滑块拖动 PUT 1MB+，也让恢复时壁纸选择（image 等）回落到 localStorage。
		// ①(修正) webUrl 只是短 URL（几十字节），不该在 SKIP 里——它不持久化到 host 会导致
		// initHostSettings 读回时依赖 local 补，local 若缺则 webUrl 永久丢失 → 星野壁纸
		// 导入后 section 无 webUrl → 走 img 路径 → iframe 空白（用户实测）。排除 webUrl。
		const HOST_SKIP_KEYS = ["image", "info", "propEdits", "timeVideos", "timeConfig", "timeSrc", "activeSlot", "timeOverride"];
		function loadSection() {
			try {
				const raw = localStorage.getItem(STORE_KEY);
				if (!raw) return {};
				const parsed = JSON.parse(raw);
				return parsed && typeof parsed === "object" ? parsed : {};
			} catch {
				return {};
			}
		}
		/** ⑤(新) 启动时尝试从 host 读设置（优先宿主端文件；localStorage 作迁移源）。
		 *  ①(修正) 竞态：host GET 是异步的，若期间用户已改过设置（sectionDirty），
		 *  不再用 host 旧数据覆盖；host 只合并外观类字段，壁纸选择回落到本地。 */
		function initHostSettings() {
			try {
				fetch(HOST_BASE + "/settings", { method: "GET" }).then(async (r) => {
					if (!r.ok) return;
					const d = await r.json();
					if (!(d && d.ok)) return;
					hostSettingsOk = true;
					if (!d.settings || typeof d.settings !== "object") return;
					if (sectionDirty) return; // 用户已改 → host 旧数据作废，不覆盖
					const local = loadSection();
					const merged = Object.assign({}, d.settings, local);
					// 壁纸选择类字段始终以本地为准（host 未存）
					for (const k of ["image", "info", "propEdits", "webUrl"]) {
						if (local[k] !== void 0) merged[k] = local[k];
					}
					sectionCache = merged;
					// ①(2026-09-17 持久化轮) 合并结果也走**唯一落盘入口**：host 只存它自己的字段
					// （HOST_SKIP_KEYS 明确跳过 image），合并串一旦超 256KB 旧写法就是"拒写 + 不落 IDB"，
					// 等于每次刷新都白丢一次壁纸选择。现在超顶自动把 image 落 IDB 并留 idb:img 哨兵。
					try { Promise.resolve(mpwPersistSection(merged)).catch(() => {}); } catch {}
					applyFromStorage();
				}).catch(() => { hostSettingsOk = false; });
			} catch { hostSettingsOk = false; }
		}
		/** 带缓存的读取：避免每次滑杆事件都解析大 JSON（背景图 data URL 有 1MB+）。 */
		let __mpwSceneSeq = 0;
function sectionSigNow() {
  try {
    const s = readSection();
    return (s.image || "") + "|" + (s.mpkgKey || "") + "|" + (s.webUrl || "") + "|" + (s.converted || "");
  } catch { return ""; }
}
// ①(2026-09-12 根因修复) 字符串字段归一化：持久化状态里 image 可能是布尔 true，
		//   旧代码 `const image = section.image || ""` 后直接 image.indexOf/startsWith → TypeError
		//   被外层 try/catch 吞掉 → 插件 apply 中断 → 设置面板整块空白（只有"用过壁纸"的浏览器命中）。
		//   放在 readSection 里，所有调用点（面板/应用/视频链/时间变化）统一受益。
		const MPW_STR_KEYS = ["image", "webUrl", "source", "mpkgKey", "mpkgName", "entryName", "converted", "slot", "title", "folderName", "mpkgFile"];
		function mpwAsStr(v) {
			if (typeof v === "string") return v;
			if (v === null || v === void 0 || typeof v === "boolean") return "";
			if (typeof v === "number") return String(v);
			try {
				if (typeof v === "object") {
					if (typeof v.url === "string") return v.url;
					if (typeof v.src === "string") return v.src;
					if (typeof v.value === "string") return v.value;
				}
			} catch {}
			return "";
		}
		function mpwNormalizeSection(s0) {
			if (!s0 || typeof s0 !== "object") return {};
			let need = false;
			for (const k of MPW_STR_KEYS) if (s0[k] !== void 0 && typeof s0[k] !== "string") { need = true; break }
			if (!need) return s0;
			const o = Object.assign({}, s0);
			const bad = [];
			for (const k of MPW_STR_KEYS) if (o[k] !== void 0 && typeof o[k] !== "string") { bad.push(k + ":" + typeof o[k]); o[k] = mpwAsStr(o[k]) }
			try { console.warn("[dsh-mpkg-wallpaper] 已归一化异常字符串字段:", bad.join(", ")); } catch {}
			return o;
		}
		function readSection() {
			if (sectionCache) return sectionCache;
			sectionCache = mpwNormalizeSection(loadSection());
			return sectionCache;
		}
		/** 写入内存缓存 + 防抖落盘。instant=true 立即写（文件选择/复位）。
		 *  ⑤(新) host 可用时同时 PUT 到宿主端文件（跨端口/清浏览器数据不丢）。
		 *  ①(修正) PUT 失败不再永久禁用：hostSettingsOk 只做乐观标记，
		 *  下次写仍会重试（GET 失败一次 ≠ 整个会话失去持久化）。 */
		function writeSection(next, instant) {
			// ①(2026-09-14) 用户在面板里**显式动过**磨砂相关开关 → 打标记，此后完全按他的选择；
			//   没有标记 = 从没配过 → 壁纸在显示时默认给磨砂玻璃顶栏（见 syncHeaderFrost）。
			try {
				if (next && (next.headerBlur !== void 0 || next.headerBg !== void 0 || next.unifyTint !== void 0
					|| next.headerFrostOwn !== void 0 || next.headerFrostAmount !== void 0)) next.headerFrostUserSet = true;
			} catch {}
			sectionCache = next;
			sectionDirty = true;
			if (persistTimer) clearTimeout(persistTimer);
			persistTimer = setTimeout(() => {
				// ①(2026-09-17 持久化轮) 统一走 mpwPersistSection：整串进 localStorage；超顶则把 image
				// 落 IDB 并留 `idb:img` 哨兵（读侧在 applyFromStorage 里恢复）；IDB 也不可用时留失败
				// 标记 + 面板警告（旧写法是"catch{/* 存储满时静默失败 */}"——真机表现就是刷新回默认壁纸）。
				// ①(2026-09-17 竞态修复) 落 IDB 是异步的（毫秒级）。期间的第二次 commit 会再走一遍本函数，
				//   而它看到的 sectionCache 里 image 还是那条 1.4MB dataURL ⇒ 再算一次、状态被覆盖
				//   （真机表现：面板状态闪回"未用 IDB"，哨兵与内存状态不一致）。用写序号消歧：
				//   只有"还属于最新一次写"的回调才允许把缓存里的 image 换成落盘用的哨兵。
				const __seq = ++mpwPersistSeq;
				try {
					const r = mpwPersistSection(sectionCache);
					Promise.resolve(r).then((json) => {
						if (!json) {
							mpwPersistEmit("壁纸设置**未能持久化**（存储已满且 IndexedDB 不可用）：刷新后本次改动会丢。请清理浏览器数据/换用较小的图片。");
							return;
						}
						if (__seq !== mpwPersistSeq) return;   // 已有更新的写 → 别回灌旧快照
						try {
							const persisted = JSON.parse(json);
							// ⚠️ `Object.assign({}, null, …)` 不报错但会**把 sectionCache 变成空壳**（自定义 object spread 同理）
							//   ⇒ 必须先确保缓存已加载，且只在"本次落盘用的形态 ≠ 缓存里的形态"时才回写。
							if (persisted && typeof persisted === "object" && (persisted.image === "idb:img" || persisted.image === "")) {
								const cur = readSection();
								if (mpwIsDataUrl(cur && cur.image) && cur.image !== persisted.image) {
									// 落盘用的是哨兵/空串 ⇒ 内存缓存也换成同一形态（否则下一次 commit 会把 1.4MB
									// dataURL 原样写回 sectionCache，读侧再次落入"超顶被拒写"的老问题）
									sectionCache = Object.assign({}, cur, { image: persisted.image });
								}
							}
						} catch {}
					}).catch(() => {});
				} catch (e) { mpwErr("mpwPersistSection(writeSection)", e); }
				// ①(修正) 去重后写 host：跳过 image/info 等大字段
				try {
					const payload = {};
					for (const k of Object.keys(sectionCache || {})) {
						if (!HOST_SKIP_KEYS.includes(k)) payload[k] = sectionCache[k];
					}
					fetch(HOST_BASE + "/settings", {
						method: "PUT",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(payload)
					}).then((r) => { if (r.ok) hostSettingsOk = true; }).catch(() => { hostSettingsOk = false; });
				} catch { hostSettingsOk = false; }
			}, instant ? 0 : 250);
		}
		// ①(2026-09-12 用户实测"切换壁纸有时要手点刷新壁纸") 应用后自动刷新一次：
		//   新壁纸的选择写回后，媒体元素/视频源可能仍是旧的（src 相同或未 reload）→ 自动强制重载。
		function mpwAutoRefreshAfterApply() {
			try {
				setTimeout(() => {
					try {
						const { img, video } = bgElements();
						const s2 = readSection();
						const desired = s2.image || "";
						if (img && desired && img.src !== desired) {
							img.src = desired;
							try { img.load && img.load() } catch {}
						}
						if (video) { try { video.load(); const p = video.play(); if (p && p.catch) p.catch(() => {}) } catch {} }
						try { applyFromStorage(); } catch (e) { mpwErr("applyFromStorage(autoRefresh 延迟重放)", e); }
					} catch (e) {}
				}, 120);
			} catch {}
		}
		function saveSection(patch) {
			const next = Object.assign({}, readSection(), patch);
			writeSection(next, true);
			return next;
		}
		function clearSection() {
			sectionCache = null;
			if (persistTimer) clearTimeout(persistTimer);
			try {
				localStorage.removeItem(STORE_KEY);
			} catch {}
		}

		// ═══════════════════════════════════════════════════════════════════
		//  IndexedDB 大图存储（③：高清 GIF/大图超过 localStorage 上限时用）
		// ═══════════════════════════════════════════════════════════════════
		let idbDb = null;
		function idbOpen() {
			if (idbDb) return Promise.resolve(idbDb);
			return new Promise((resolve, reject) => {
				try {
					if (typeof indexedDB === "undefined") { reject(new Error("no idb")); return; }
					const req = indexedDB.open("dsh-mpkg-wallpaper", 1);
					req.onupgradeneeded = () => { req.result.createObjectStore("images"); };
					req.onsuccess = () => { idbDb = req.result; resolve(idbDb); };
					req.onerror = () => reject(req.error);
				} catch (e) { reject(e); }
			});
		}
		function idbPut(key, value) {
			return idbOpen().then((db) => new Promise((resolve, reject) => {
				try {
					const tx = db.transaction("images", "readwrite");
					tx.objectStore("images").put(value, key);
					tx.oncomplete = () => resolve();
					tx.onerror = () => reject(tx.error);
				} catch (e) { reject(e); }
			}));
		}
		function idbGet(key) {
			return idbOpen().then((db) => new Promise((resolve, reject) => {
				try {
					const tx = db.transaction("images", "readonly");
					const req = tx.objectStore("images").get(key);
					req.onsuccess = () => resolve(req.result);
					req.onerror = () => reject(req.error);
				} catch (e) { reject(e); }
			}));
		}
		function idbDel(key) {
			return idbOpen().then((db) => new Promise((resolve, reject) => {
				try {
					const tx = db.transaction("images", "readwrite");
					tx.objectStore("images").delete(key);					tx.oncomplete = () => resolve();
					tx.onerror = () => reject(tx.error);
				} catch (e) { reject(e); }
			})).catch(() => {});
		}

		// ═══════════════════════════════════════════════════════════════════
		//  ①(2026-09-17 持久化轮) 壁纸 **不丢** 的唯一入口
		//  背景：壁纸 image 常以 dataURL 内联进 STORE_KEY 的 JSON，而 localStorage 单值硬顶
		//  MPW_LS_MAX_BYTES(256KB)；宿主侧 /settings **明确跳过 image**（HOST_SKIP_KEYS），
		//  所以"localStorage 拒写 + 不落 IDB" = 刷新即回默认壁纸（真机 bug，语料实测
		//  preview.gif 的 dataURL 全在 1.30–1.36MB ⇒ 100% 命中该区间）。
		//  这里把「大 dataURL 走 IndexedDB」这条路径**读写两侧**真正接通：
		//    · 写：mpwPersistSection（整串放不下就抽 image 落 IDB，留哨兵 {"image":"idb:img"}）
		//    · 读：applyFromStorage 的 idb:img 分支（Blob → ObjectURL；dataURL 字符串 → 直接当 src）
		//    · 失败：MPW_PERSIST_FAIL_KEY 留痕 + 面板警告（applyFromStorage 里 emit）**不静默丢**
		// ═══════════════════════════════════════════════════════════════════
		const MPW_PERSIST_FAIL_KEY = "__mpwPersistFail";   // 上一次"真的没存下"的原因（占位几十字节，不影响 256KB 预算）
		/** IndexedDB 可用性（带 500ms 超时；不缓存失败，允许下次重试）。 */
		let idbProbe = null;
		function idbAvailable() {
			if (idbProbe) return idbProbe;
			idbProbe = new Promise((resolve) => {
				let done = false;
				const fin = (v) => { if (!done) { done = true; resolve(v) } };
				try {
					if (typeof indexedDB === "undefined") { fin(false); return }
					const tid = setTimeout(() => { idbProbe = null; fin(false) }, 500);
					idbOpen().then(() => { clearTimeout(tid); fin(true) })
						.catch(() => { clearTimeout(tid); idbProbe = null; fin(false) });
				} catch { idbProbe = null; fin(false) }
			});
			return idbProbe;
		}
		/** IndexedDB 里 "bg" 这一格**当前到底是什么**（写路径用它校验：哨兵绝不能指向旧内容/空内容）。 */
		function mpwIdbBgKind() {
			return idbGet("bg").then((v) => {
				if (v === null || v === void 0) return "none";
				if (typeof v === "string") return /^data:/i.test(v) ? "dataurl" : "text";
				try { if (typeof Blob !== "undefined" && v instanceof Blob) return "blob" } catch {}
				if (v && typeof v === "object" && typeof v.size === "number") return "blob";
				return "other";
			}).catch(() => "error");
		}
		function mpwIsDataUrl(v) { return typeof v === "string" && /^data:/i.test(v); }
		/** 上一次持久化的实况（诊断/测试入口可读，见 window.__mpwPersist）。 */
		let mpwPersistState = { ok: null, usedIdb: false, reason: "", at: 0 };
		/** 写序号：落 IDB 是异步的，用它判断"回调是否还属于最新一次写"（防旧快照回灌 sectionCache）。 */
		let mpwPersistSeq = 0;

		/** ①(2026-09-17) 把"放不进 localStorage"的 image 落 IDB：**写完必须回读校验**，
		 *  只有确认 IDB 里是一份 dataURL 才返回 `idb:img` 哨兵（否则宁可原样返回并让上层显式告警，
		 *  也不能留一个指向旧壁纸/空内容的哨兵 —— 那正是"刷新后壁纸变了"的另一条静默路径）。 */
		function mpwSpillImage(dataUrl) {
			const fail = (reason) => {
				mpwPersistState = { ok: false, usedIdb: false, reason: reason, at: Date.now() };
				const kb = Math.round(String(dataUrl).length / 1024);
				try {
					console.warn("[dsh-mpkg-wallpaper] 壁纸 dataURL " + kb + " KB 无法持久化（" + reason
						+ "）：本次显示不受影响，但 **刷新/重启后这个选择会丢**（已显式告警，不静默）");
				} catch {}
				return dataUrl;
			};
			return idbAvailable().then((can) => {
				if (!can) return fail("IndexedDB 不可用");
				return idbPut("bg", dataUrl)
					.then(() => mpwIdbBgKind())
					.then((kind) => {
						if (kind !== "dataurl") return fail("IndexedDB 回读校验失败(" + kind + ")");
						mpwPersistState = { ok: true, usedIdb: true, reason: "", at: Date.now() };
						return "idb:img";
					});
			}).catch((e) => fail(String((e && e.message) || e)));
		}

		/** ①(2026-09-17) **唯一的 section 落盘入口**（localStorage + 大图落 IDB），同步返回写进去的 JSON 串。
		 *  返回 "" = 完全没写成功（调用方按需告警；这里不抛）。 */
		function mpwPersistSection(sec) {
			let json = "";
			try { json = JSON.stringify(sec); } catch (e) { mpwErr("mpwPersistSection(序列化)", e); return "" }
			if (mpwPersistLegacy()) {   // 回退开关：旧行为（超上限即拒写，且不落 IDB）
				return mpwLsSafeSet(STORE_KEY, json) ? json : "";
			}
			const refOnly = /^idb:/.test(String((sec && sec.image) || (sectionCache && sectionCache.image) || ""));
			if (json.length + 160 <= MPW_LS_MAX_BYTES) {   // 160 = 失败标记的余量
				if (mpwLsSafeSet(STORE_KEY, json)) {
					// image 已是 idb:* 引用（上一轮落过 IDB）⇒ usedIdb 必须保持 true，
					// 否则面板状态会在第二次写（本身很小）时闪回"未用 IDB"。
					mpwPersistState = { ok: true, usedIdb: refOnly, reason: "", at: Date.now() };
					mpwClearPersistFail();
					return json;
				}
			}
			// —— 整串放不下：先试**抽掉 image** 只留配置（同步，保底路径） ——
			const img = sec && sec.image;
			if (typeof img === "string" && img && !/^idb:/.test(img)) {
				const slim = Object.assign({}, sec, { image: "" });
				let slimJson = "";
				try { slimJson = JSON.stringify(slim) } catch {}
				if (slimJson && slimJson.length + 160 <= MPW_LS_MAX_BYTES) {
					/** image: 落盘用的 image 值；failReason: 非空则把失败留痕**一起**写进这份 JSON
					 *  （不能先 mpwMarkPersistFail 再 finish —— 后者的整串覆盖会把留痕冲掉）。 */
					const finish = (image, failReason) => {
						const o = Object.assign({}, slim, image ? { image: image } : {});
						if (failReason) o[MPW_PERSIST_FAIL_KEY] = { reason: failReason, at: Date.now() };
						const json2 = JSON.stringify(o);
						mpwLsSafeSet(STORE_KEY, json2);   // 抽出 image 后必然放得下
						// ①`idb:img` 哨兵 = 这次确实用上了 IndexedDB。**不能**只按"是不是 dataURL"判：
						//   落 IDB 失败时返回的也是那条原 dataURL（仅本次会话有效），判成 true 会与实际相反。
						mpwPersistState = { ok: true, usedIdb: image === "idb:img", reason: "", at: Date.now() };
						if (image === "idb:img") mpwClearPersistFail();
						return json2;
					};
					if (mpwIsDataUrl(img)) {
						// 落 IDB 成功 → 写哨兵；失败 → 写""（image 就是存不下，写回原串只会让整串再超顶，
						// 连"非图片配置 + 失败留痕"都保不住）。两种情况的 dataURL 都还在内存里 ⇒ 本次显示不受影响。
						return mpwSpillImage(img).then((marker) => (marker === "idb:img"
							? finish(marker)
							: finish("", "large-image-not-persisted")));
					}
					return finish(img);   // 非 dataURL（host:/blob:/http）—— 抽出后就能存下
				}
			}
			// —— 连"抽掉 image"都放不下（propEdits 等配置过大）：整串落 IDB 兜底 ——
			return idbAvailable().then((can) => {
				if (!can) { mpwMarkPersistFail("too-large-and-no-idb"); return "" }
				return idbPut("bgsec", sec)
					.then(() => idbGet("bgsec"))
					.then((v) => (v && typeof v === "object" && v.image === (sec && sec.image) ? sec : null))
					.then((ok) => {
						if (!ok) { mpwMarkPersistFail("section-idb-verify-failed"); return "" }
						const marker = JSON.stringify({ secIdb: 1, at: Date.now() });
						mpwLsSafeSet(STORE_KEY, marker);
						mpwPersistState = { ok: true, usedIdb: true, reason: "", at: Date.now() };
						mpwClearPersistFail();
						return marker;
					});
			}).catch((e) => { mpwMarkPersistFail("idb-put-error:" + String((e && e.message) || e)); return "" });
		}
		/** 落盘失败留痕：**下一次加载**（applyFromStorage）据此弹可见警告 —— 不静默丢选择。 */
		function mpwMarkPersistFail(reason) {
			try {
				const cur = loadSection();
				cur[MPW_PERSIST_FAIL_KEY] = { reason: reason, at: Date.now() };
				// ①(2026-09-17 持久化轮收口) 写 STORE_KEY 一律走 `mpwLsSafeSet`（**唯一受控入口**）：
				//   旧写法直接 `localStorage.setItem` 会绕过 MPW_LS_MAX_BYTES 单值上限。
				//   这里只加几十字节（写路径本来就为它留了 160 字节余量），但"上限在每一处写入都生效"
				//   这条不变量不能有例外 —— 有例外就等于没有上限（`tests/data-limits-test.mjs` D9 机器断言）。
				mpwLsSafeSet(STORE_KEY, JSON.stringify(cur));
			} catch {}
			try { console.warn("[dsh-mpkg-wallpaper] 持久化失败留痕：" + reason); } catch {}
		}
		function mpwClearPersistFail() {
			try {
				if (localStorage.getItem(STORE_KEY) && loadSection()[MPW_PERSIST_FAIL_KEY] !== void 0) {
					const cur = loadSection();
					delete cur[MPW_PERSIST_FAIL_KEY];
					mpwLsSafeSet(STORE_KEY, JSON.stringify(cur));   // 同上：删标记只会更小，但仍走受控入口
				}
			} catch {}
		}
		/** 面板可见告警通道（工厂层 → 组件层；面板没打开时排队，打开时立刻显示）。 */
		const MPW_PERSIST_LISTENERS = [];
		let mpwPersistPending = "";   // 面板还没挂载时先存一条（inject 阶段就可能 emit）
		function mpwPersistOnMsg(fn) {
			try { if (typeof fn === "function") MPW_PERSIST_LISTENERS.push(fn) } catch {}
			return () => { const i = MPW_PERSIST_LISTENERS.indexOf(fn); if (i >= 0) MPW_PERSIST_LISTENERS.splice(i, 1) };
		}
		/** 取走"面板挂载前"排队的告警（取一次即清，避免每次重渲染重复弹窗）。 */
		function mpwPersistTakePending() {
			const m = mpwPersistPending;
			mpwPersistPending = "";
			return m;
		}
		function mpwPersistEmit(msg) {
			try { console.error("[dsh-mpkg-wallpaper] " + msg); } catch {}
			if (!MPW_PERSIST_LISTENERS.length) mpwPersistPending = String(msg);
			for (const f of MPW_PERSIST_LISTENERS.slice()) { try { f(String(msg)) } catch {} }
		}

		/** dataUrl 太大时写入 IndexedDB，返回 "idb:bg" 标记；否则原样返回。
		 *  ①(2026-09-17) 阈值改口径为 MPW_LS_SPILL_BYTES，并**回读校验**（见 mpwSpillImage）。 */
		function storeImage(dataUrl) {
			if (!mpwIsDataUrl(dataUrl)) return Promise.resolve(dataUrl);
			if (dataUrl.length <= MPW_LS_SPILL_BYTES) return Promise.resolve(dataUrl);
			return mpwSpillImage(dataUrl).then((m) => (m === "idb:img" ? "idb:bg" : m));
		}
		/** 视频 Blob 存入 IndexedDB（①：外部渲染成视频后作为动态背景）。 */
		function storeVideoBlob(blob) {
			return idbPut("bg", blob).then(() => "idb:blob");
		}
		/** ③(新) 大图片 Blob 直接存 IndexedDB（不走 dataURL，避免 base64 膨胀 1.37 倍爆内存），
		 *  返回 "idb:img" 标记；小图走 dataURL 直接内联。
		 *  ①(2026-09-17) 小图 → dataURL 后若超 MPW_LS_SPILL_BYTES 同样落 IDB（旧写法在
		 *  `2MB` 与 `256KB` 之间留了一条"两边都不落"的缝，正是刷新丢壁纸的主因）。 */
		function storeImageBlob(blob) {
			if (blob.size <= MPW_LS_SPILL_BYTES) {
				return blobToDataUrl(blob).then((d) => (d.length > MPW_LS_SPILL_BYTES
					? mpwSpillImage(d).then((m) => (m === "idb:img" ? "idb:img" : d))
					: d));
			}
			return idbPut("bg", blob).then(() => "idb:img");
		}

		// ═══════════════════════════════════════════════════════════════════
		//  mpkg 解析（Wallpaper Engine 手机版 .mpkg 容器）
		//  布局：头部 + 全部条目头（在前），随后是全部文件数据（连续）
		//    header : version_length(u32 LE) + version + file_total(u32 LE)
		//    entry  : name_length(u32) + name + index(u32) + size(u32)
		//    data   : 第 i 个文件位于 dataStart + entries[i].index，长度 size
		// ═══════════════════════════════════════════════════════════════════
		function parseMpkg(buffer) {
			const dv = new DataView(buffer);
			const decoder = new TextDecoder();
			let pos = 0;
			const versionLength = dv.getUint32(pos, true); pos += 4;
			const version = decoder.decode(new Uint8Array(buffer, pos, versionLength)); pos += versionLength;
			const fileTotal = dv.getUint32(pos, true); pos += 4;
			const entries = [];
			for (let i = 0; i < fileTotal; i++) {
				const nameLength = dv.getUint32(pos, true); pos += 4;
				const name = decoder.decode(new Uint8Array(buffer, pos, nameLength)); pos += nameLength;
				const index = dv.getUint32(pos, true); pos += 4;
				const size = dv.getUint32(pos, true); pos += 4;
				entries.push({ name, index, size });
			}
			return { version, entries, dataStart: pos };
		}

		function guessMime(name) {
			const n = name.toLowerCase();
			if (n.endsWith(".gif")) return "image/gif";
			if (n.endsWith(".png")) return "image/png";
			if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
			if (n.endsWith(".webp")) return "image/webp";
			if (n.endsWith(".mp4")) return "video/mp4";
			if (n.endsWith(".webm")) return "video/webm";
			if (n.endsWith(".mov")) return "video/quicktime";
			if (n.endsWith(".json")) return "application/json";
			return "application/octet-stream";
		}

		function entryBytes(buffer, entry, dataStart) {
			return new Uint8Array(buffer, dataStart + entry.index, entry.size);
		}

		/** 当前时段（用于按时间选择素材，⑨）。 */
		function timeSlotKey(date) {
			const h = date.getHours();
			if (h >= 5 && h < 8) return "morning";
			if (h >= 8 && h < 17) return "day";
			if (h >= 17 && h < 19) return "dusk";
			return "night";
		}

		/** 按当前时间挑背景素材：优先 preview_{时段}.gif / {时段}.gif 等；否则回退任意图片。 */
		function pickBackgroundEntry(entries, date) {
			const slot = timeSlotKey(date);
			const suffixes = [slot, "day", "night", "dusk", "morning"];
			for (const suf of suffixes) {
				for (const ext of ["gif", "png", "jpg", "jpeg", "webp"]) {
					const hit = entries.find((e) => {
						const n = e.name.toLowerCase();
						return n === `preview_${suf}.${ext}` || n === `preview-${suf}.${ext}` || n === `${suf}.${ext}`;
					});
					if (hit) return { entry: hit, slot: suf === slot ? slot : null };
				}
			}
			// ① 内嵌 mp4（视频类壁纸）优先：比 preview.gif 清晰得多
			const vid = entries.find((e) => /\.(mp4|webm|mov)$/i.test(e.name));
			if (vid) return { entry: vid, slot: null };
			const any = entries.find((e) => /\.(gif|png|jpe?g|webp)$/i.test(e.name)) || null;
			return { entry: any, slot: null };
		}

		function blobToDataUrl(blob) {
			return new Promise((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => resolve(reader.result);
				reader.onerror = () => reject(reader.error);
				reader.readAsDataURL(blob);
			});
		}

		/** 确保 GIF 无限循环（有的预览图可能只循环 N 次；⑪）。返回新的 Uint8Array。 */
		function ensureInfiniteGif(bytes) {
			if (bytes.length < 13) return bytes;
			const packed = bytes[10];
			let pos = 13;
			if (packed & 0x80) pos += 3 * (1 << ((packed & 0x07) + 1));
			const needle = [0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30]; // NETSCAPE2.0
			for (let p = pos; p <= bytes.length - 20; p++) {
				if (bytes[p] === 0x21 && bytes[p + 1] === 0xff && bytes[p + 2] === 0x0b) {
					let match = true;
					for (let k = 0; k < needle.length; k++) {
						if (bytes[p + 3 + k] !== needle[k]) { match = false; break; }
					}
					if (match) {
						// 结构: 21 FF 0B NETSCAPE2.0 03 01 [lo] [hi] 00
						if (bytes[p + 14] === 0x03 && bytes[p + 15] === 0x01) {
							bytes[p + 16] = 0;
							bytes[p + 17] = 0;
						}
						return bytes;
					}
				}
			}
			// 没有 NETSCAPE 扩展 → 插入一个（无限循环）
			const ext = [0x21, 0xff, 0x0b, 0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, 0x03, 0x01, 0x00, 0x00, 0x00];
			const out = new Uint8Array(bytes.length + ext.length);
			out.set(bytes.subarray(0, pos), 0);
			out.set(ext, pos);
			out.set(bytes.subarray(pos), pos + ext.length);
			return out;
		}

		/** 处理视频纹理壁纸：识别时间槽、按需提取 MP4、存入 IndexedDB。
		 *  ③(重做) readEntry(entry, limit?) 按需读取，424MB 大包不整体进内存。
		 *  ⑧(重做) 懒加载：导入时只提取「当前时段」一个 MP4（移动端同时提取
		 *  5 个 ~50MB 视频纹理会 OOM 崩溃，用户实测暗色场景导入即崩）；
		 *  其余槽只存元数据 {index, mp4Off, size}，换时段时经 timeSrc
		 *  按需重新读取（host token / 会话内 File 引用），单槽峰值 ~50MB。 */
		async function handleVideoTexes(mpkg, vtex, file, t, showError, readEntry, projJson, hintFn, timeSrc) {
			// ①(修复) 导入期间用户可能已切换/清除壁纸——完成时若签名变了则丢弃，防迟到提交覆盖
			const __sig0 = sectionSigNow();
			try {
				// 提取每个视频纹理的 MP4 并识别时间槽
				const list = [];
				let cfg = { enabled: true, morning: 4, day: 9, dusk: 17, night: 20 };
				let propsMap = null;
				// ①(修正) 场景文件夹：project.json 在容器外（workshop 目录），由调用方传入 projJson
				if (projJson && projJson.general && projJson.general.properties) {
					propsMap = projJson.general.properties;
				}
				const proj = projJson ? null : mpkg.entries.find((e) => e.name === "project.json");
				if (proj) {
					try {
						const pj = JSON.parse(new TextDecoder().decode(await readEntry(proj)));
						propsMap = (pj.general && pj.general.properties) || null;
					} catch {}
				}
				const key2 = file.name + "|" + file.size;
				const prevS = readSection();
				const propEdits = (prevS.propEdits && prevS.propEdits[key2]) || {};
				if (propsMap) cfg = timeConfigFromProps(propsMap, propEdits);
				// ②(修正) 槽缓存键全局共用（bg-morning/day/dusk/night）：换壁纸后旧壁纸的
				// 非当前槽缓存残留 → 点清晨/白天/黄昏显示上一张壁纸的画面。导入新时间壁纸
				// 前清空上一张的槽缓存（含旧的 4 个标准槽名 + 上张壁纸的全部槽 key）。
				const staleKeys = new Set(Array.isArray(prevS.timeVideos) ? prevS.timeVideos.map((l) => l.key) : []);
				for (const k of ["morning", "day", "dusk", "night"]) staleKeys.add(k);
				for (const k of staleKeys) { try { idbDel("bg-" + k); } catch {} }
				// ⑧(重做) 第一遍：只读 tex 头找 ftyp 偏移，不读 MP4 主体。
				// ①(修正) 头窗 1MB（原 64KB）：部分 tex 的 ftyp 在头部较深处，64KB 找不到
				// 会整条被跳过（回归：host 路径的 vtex 过滤不查 ftyp，旧代码有全量读取兜底）。
				// 1MB 峰值可控（对比单槽 MP4 ~50MB），且仍远小于整包读取。
				for (let i = 0; i < vtex.length; i++) {
					const e = vtex[i];
					// ③(新) 内存防护：超大视频纹理在移动端直接 OOM（页面崩溃），前置跳过
					if (e.size > 250 * 1024 * 1024) continue;
					const texHead = await readEntry(e, Math.min(e.size, 1024 * 1024));
					const mp4Off = extractTexVideoOffset(texHead);
					if (mp4Off === null) continue; // 头 1MB 无 ftyp → 不是内嵌 MP4 纹理
					const slot = slotFromName(e.name);
					const skey = slot || "v" + i;
					const size = e.size - mp4Off;
					if (size <= 0 || size > 250 * 1024 * 1024) continue;
					list.push({ slot: slot || skey, name: e.name, key: skey, size, mp4Off, index: e.index !== void 0 ? e.index : i });
				}
				if (!list.length) {
					// ⑨(重做) 视频纹理都无法提取时返回 false，让 onMpkg 回退到 preview.gif
					//（用户至少能看到预览，而不是静默无反应）
					const anyBig = vtex.some((e) => e.size > 250 * 1024 * 1024);
					showError(anyBig ? t("mpkg.vtexBig") : t("mpkg.noAsset"));
					return false;
				}
				// 选当前时段（只提取这一个）
				let active = null;
				if (cfg.enabled && list.some((l) => l.slot === "morning" || l.slot === "day" || l.slot === "dusk" || l.slot === "night")) {
					const slot = slotForTime(cfg, new Date());
					active = list.find((l) => l.slot === slot) || list[0];
				} else {
					active = list[0];
				}
				// ⑧(重做) 仅提取当前时段 MP4 → bg；其余槽靠 ensureSlotBlob 按需补。
				// ①(修正) 纯浏览器路径（timeSrc.kind==="file"，File 不可跨重载）：
				// 其余槽在本次会话内顺序提取缓存（峰值仍为单槽 ~50MB，逐槽 await 释放），
				// 保证重载后各时段仍可用（旧行为）；host 路径保持懒加载（修暗色场景 OOM）。
				const activeBlob = await ensureSlotBlob({ timeSrc, readEntry, item: active, fresh: true });
				if (!activeBlob) { showError(t("mpkg.noAsset")); return false; }
				await idbPut("bg", activeBlob);
				if (timeSrc && timeSrc.kind === "file") {
					for (const l of list) {
						if (l.key === active.key) continue;
						try { await ensureSlotBlob({ timeSrc, readEntry, item: l, fresh: true }); } catch {}
					}
				}
				const info = await extractProjectInfoAsync(mpkg.entries, readEntry);
				const lensDef = lensDefaultsFromProps(propsMap);
				// ③ 标题用真实文件名；⑤⑥ 镜头默认值（用户未改过才生效）
				const cur = readSection();
				const lensPatch = {};
				if (lensDef) {
					if (cur.zoom === void 0) lensPatch.zoom = lensDef.zoom;
					if (cur.lensX === void 0) lensPatch.lensX = lensDef.x;
					if (cur.lensY === void 0) lensPatch.lensY = lensDef.y;
				}
				if (sectionSigNow() !== __sig0) {
					try { console.warn("[dsh-mpkg-wallpaper] 时段导入完成时壁纸已切换，丢弃迟到提交"); } catch {}
					return "stale"; // ①(修复) 三态：调用方识别后跳过回退/preview 链，防止把旧壁纸内容迟到提交
				}
				writeSection(Object.assign({}, cur, {
					image: "idb:blob", source: "视频纹理:" + active.name,
					fromMpkg: true, converted: "mp4",
					timeVideos: list, timeConfig: cfg, activeSlot: active.slot || active.key,
					timeOverride: null, // ②(修正) 导入新壁纸回到「自动」（旧壁纸的手动锁定不残留）
					timeSrc: timeSrc || null,
					mpkgKey: key2, mpkgName: file.name,
					info: { title: info ? info.title : "", properties: info ? info.properties : [] },
					slot: null
				}, lensPatch), true);
				applyFromStorage();
				try { mpwAutoRefreshAfterApply(); } catch {}
				notifySectionChanged(); // ②(修正) 导入后立即刷新设置页（否则要重开设置才显示时段 UI）
				if (typeof hintFn === "function") { try { hintFn(t("time.picked") + "：" + t("time." + (active.slot || "day"))); } catch {} }
				return true;
			} catch (err) {
				console.error("[dsh-mpkg-wallpaper] handleVideoTexes 失败:", err);
				showError(t("mpkg.fail") + String(err && err.message || err));
				return false;
			}
		}
		/** ⑧(新) 按需获取某个时间槽的 MP4 Blob：
		 *  1) 已缓存（bg-{key}，且非 fresh）→ 直接返回；
		 *  2) 本次会话内有 readEntry（导入刚完成）→ 用它读；
		 *  3) 有持久 timeSrc（host token / 会话 File）→ 按需重建读取；
		 *  4) 都没有 → null（调用方跳过该槽，不崩溃）。
		 *  任一时刻最多一个 ~50MB MP4 在内存（修复暗色场景导入 OOM）。
		 *  ①(修正) fresh=true（导入当前槽时）：跳过缓存，强制从源重读并覆写
		 *  bg-{key} —— 防止同名槽（如 "day"）残留上一个壁纸的旧 blob 被误用。
		 *  ②(修正) 槽缓存键是全局共用的（bg-morning 等），换壁纸时旧壁纸的
		 *  非当前槽缓存会残留 → 点清晨/白天/黄昏显示上一张壁纸的视频
		 *  （用户实测：A 手动切白天后再导 B，B 的清晨/白天/黄昏全是 A 的画面）。
		 *  导入新时间壁纸前先清空旧槽缓存（见 handleVideoTexes 开头）。 */
		async function ensureSlotBlob(opts) {
			try {
				const item = opts && opts.item;
				if (!item) return null;
				if (!opts.fresh) {
					const cached = await idbGet("bg-" + item.key);
					if (cached instanceof Blob) return cached;
				}
				// 本次会话内的 readEntry（导入流程中调用）
				if (typeof opts.readEntry === "function") {
					const mp4 = await opts.readEntry({ index: item.index, size: item.size }, item.size, item.mp4Off || 0);
					if (mp4 && mp4.length) {
						const b = new Blob([mp4], { type: "video/mp4" });
						if (b.size > 250 * 1024 * 1024) return null;
						try { await idbPut("bg-" + item.key, b); } catch {}
						return b;
					}
				}
				const src = opts.timeSrc;
				if (src) {
					if (src.kind === "host" && src.token) {
						// 持久 host token：/media?token=&index= 按 Range 读 mp4 段
						const rr = await fetch(HOST_BASE + "/media?token=" + encodeURIComponent(src.token) + "&index=" + item.index, {
							headers: { Range: "bytes=" + (item.mp4Off || 0) + "-" + ((item.mp4Off || 0) + item.size - 1) }
						});
						if (rr.ok) {
							const mp4 = new Uint8Array(await rr.arrayBuffer());
							if (mp4 && mp4.length) {
								const b = new Blob([mp4], { type: "video/mp4" });
								if (b.size > 250 * 1024 * 1024) return null;
								try { await idbPut("bg-" + item.key, b); } catch {}
								return b;
							}
						}
					} else if (src.kind === "file" && src.key) {
						// 会话内 File 引用（纯浏览器导入路径；File 不可序列化进 section，
						// 存会话级映射 sessionFiles[name|size]，重载后该映射为空 → 只保当前时段）
						const ref = sessionFiles[src.key];
						if (ref && ref.file) {
							const start = ref.dataStart + item.index + (item.mp4Off || 0);
							const bytes = new Uint8Array(await ref.file.slice(start, start + item.size).arrayBuffer());
							if (bytes && bytes.length) {
								const b = new Blob([bytes], { type: "video/mp4" });
								if (b.size > 250 * 1024 * 1024) return null;
								try { await idbPut("bg-" + item.key, b); } catch {}
								return b;
							}
						}
					}
				}
				return null;
			} catch (err) {
				console.warn("[dsh-mpkg-wallpaper] ensureSlotBlob 失败:", err);
				return null;
			}
		}
		/** ④(新) 手动切换到指定时段（自动切换 / 时段覆盖按钮共用）：
		 *  timeOverride=slot 记录手动选择；null 恢复自动（按时间）。
		 *  懒加载：槽位 blob 未缓存时按 timeSrc 按需提取。
		 *  ①(修正) 完成后通知设置页刷新（timeOverride/activeSlot 高亮即时生效，
		 *  不用重开设置页——用户实测导入后要关掉再打开才显示时间切换功能）。
		 *  ①(修正) 竞态：60s 定时器与手动点击可能并发，ensureSlotBlob/idbPut 异步
		 *  完成顺序 ≠ 调用顺序 → 旧请求可能覆盖新请求的结果；用 swapGen 序号，
		 *  只让最新一次生效（过期结果直接丢弃）。 */
		let swapGen = 0;
		function swapTimeSlot(slot, manual) {
			const gen = ++swapGen;
			const s = readSection();
			if (!s.timeVideos || !s.timeConfig || !s.timeConfig.enabled) return;
			const item = s.timeVideos.find((l) => l.slot === slot);
			if (!item) return;
			const sig0 = sectionSigNow(); // ①(修复) 防"切换时段期间用户换了壁纸/清除"→ 迟到写回污染新状态
			ensureSlotBlob({ item, timeSrc: s.timeSrc }).then((v) => {
				if (gen !== swapGen || sectionSigNow() !== sig0) return; // 过期请求：已有更新的切换或壁纸已换
				if (!v) return;
				idbPut("bg", v).then(() => {
					if (gen !== swapGen || sectionSigNow() !== sig0) return;
					writeSection(Object.assign({}, readSection(), {
						activeSlot: item.slot || item.key,
						timeOverride: manual === void 0 ? s.timeOverride : (manual ? slot : null)
					}), true);
					applyFromStorage();
					try { mpwAutoRefreshAfterApply(); } catch {}
					notifySectionChanged();
				});
			}).catch(() => {});
		}
		/** ⑩(新) 设置页状态刷新回调（MpkgSection 挂载时注册；切换时段/导入后
		 *  通知 React state 重读，避免按钮高亮/时段列表停留在旧值）。 */
		let mpwSectionNotify = null;
		function notifySectionChanged() {
			try { if (typeof mpwSectionNotify === "function") mpwSectionNotify(); } catch {}
		}
		/** ⑥ 从壁纸属性读镜头默认值（镜头大小/位置X/Y，按文本匹配 镜头/lens）。 */
		function lensDefaultsFromProps(propsMap) {
			if (!propsMap) return null;
			let zoom = 100, x = 0, y = 0;
			for (const k of Object.keys(propsMap)) {
				const p = propsMap[k];
				const txt = ((p.text || "") + " " + k).toLowerCase();
				const v = Number(p && p.value);
				if (isNaN(v)) continue;
				if (/镜头大小|lens\s*size/.test(txt)) zoom = Math.max(10, Math.min(2000, v <= 1 ? v * 100 : v));
				else if (/镜头位置\s*x|lens\s*position\s*x/.test(txt)) x = Math.max(-2000, Math.min(2000, v));
				else if (/镜头位置\s*y|lens\s*position\s*y/.test(txt)) y = Math.max(-2000, Math.min(2000, v));
			}
			if (zoom === 100 && x === 0 && y === 0) return null;
			return { zoom, x, y };
		}

		/** 清理属性标签：去 HTML 标签 / 实体 / 多余空白（⑤）。 */
		function cleanLabel(text) {
			return (text || "")
				.replace(/<[^>]*>/g, "")
				.replace(/&nbsp;/gi, " ")
				.replace(/&amp;/g, "&")
				.replace(/&lt;/g, "<")
				.replace(/&gt;/g, ">")
				.replace(/&quot;/g, '"')
				.replace(/&#39;|&apos;/g, "'")
				.replace(/\s+/g, " ")
				.trim();
		}

		/** 解析 project.json 文本，提取标题 + 可调参数信息。 */
		function extractProjectInfo(jsonText) {
			try {
				const json = JSON.parse(jsonText);
				const props = json.general && json.general.properties;
				const list = [];
				if (props) {
					for (const key of Object.keys(props)) {
						if (!safePropKey(key)) continue;
						const p = props[key];
						if (!p || typeof p !== "object") continue;
						const label = cleanLabel(p.text);
						if (!label) continue;
						let value = p.value;
						if (Array.isArray(p.options) && p.options.length) {
							const opt = p.options.find((o) => String(o.value) === String(value));
							if (opt) value = opt.label;
						}
						// type "text" 是纯展示性条目（作者信息/说明），不给输入框（⑥）
						const displayOnly = p.type === "text";
						// ① 关键开关识别（entry animation 开场动画 / prompt box 提示框）
						const keyText = (label + " " + (p.text || "")).toLowerCase();
						const important = /entry\s*animation|开场动画|入场动画|prompt\s*box|提示框|水印|盗版|防盗|开始时间|随现实时间|timevarying|morningtime|daytime|dusktime|nighttime|时间变化|时间段/.test(keyText);
						list.push({ key, label, value: value === void 0 ? "" : value, type: p.type, options: p.options || null, displayOnly, important });
					}
				}
				return { title: json.title || "", properties: list };
			} catch (e) {
				return null;
			}
		}
		/** ③(重做) 异步版：project.json 按需读取（424MB 大包不整体进内存）。 */
		async function extractProjectInfoAsync(entries, readEntry) {
			const proj = entries.find((e) => e.name === "project.json");
			if (!proj) return null;
			try {
				const buf = await readEntry(proj);
				return extractProjectInfo(new TextDecoder().decode(buf));
			} catch (e) {
				return null;
			}
		}


		// ═══════════════════════════════════════════════════════════════════
		//  背景 DOM（一个固定 img 层；用 <img> 保证 GIF 动画可靠播放，⑪）
		// ═══════════════════════════════════════════════════════════════════
		function ensureBgDom() {
			let wrap = document.getElementById(BG_WRAP_ID);
			if (!wrap) {
				wrap = document.createElement("div");
				wrap.id = BG_WRAP_ID;
				wrap.className = "mpw-bgWrap";
				const img = document.createElement("img");
				img.id = BG_IMG_ID;
				img.className = "mpw-bgImg";
				img.alt = "";
				img.draggable = false;
				img.referrerPolicy = "no-referrer";
				img.crossOrigin = "anonymous";
				img.style.display = "none";
				const video = document.createElement("video");
				video.id = BG_VIDEO_ID;
				video.className = "mpw-bgVideo";
				// ①(修正) 不用 autoplay 属性——只要 autoplay 在，src 一重载浏览器就自动播放，
				// 会**绕过** showVideoEl 里基于 (wallUserPaused||powPaused) 的 play() 暂停门控。
				// 改为靠那个门控的 play() 统一播放：暂停时任何 src 重载都不重播。
				// video.autoplay = true;
				video.loop = true;
				video.muted = true;
				video.playsInline = true;
				// ①(修正) 禁用浏览器画中画（PiP）：Firefox 鼠标悬停视频时屏幕侧边出现
				// 「画中画」按钮，点击后把壁纸视频切到右下角小窗、背景被拿掉
				// （用户实测：切小窗后壁纸消失，提示 "this video is playing in picture-in-picture mode"）。
				video.disablePictureInPicture = true;
				video.referrerPolicy = "no-referrer";
				video.style.display = "none";
				// ②(新) 视频播放失败检测：编码不支持/加载失败时不再静默（写 console + 全局标记）
				video.addEventListener("error", () => {
					console.warn("[dsh-mpkg-wallpaper] 视频背景加载失败（编码可能不被浏览器支持）:", video.src);
					try { window.__mpwVideoFailed = true; } catch {}
				});
				// ①(修正) 暂停按钮**实时**同步：监听 video 实际 play/pause 事件，刷新模块级
				// wallPausedByUser 标志并派发自定义事件给设置页按钮（否则用户暂停后，任何
				// 非本按钮路径（如切换壁纸、省电恢复、重载重播）导致的实际播放变化，按钮文案
				// 不会跟着变 — 用户实测「暂停键不是实时检测」）。
				video.addEventListener("play", () => { try { setWallPausedByUserState(false); } catch {} });
				video.addEventListener("pause", () => { try { setWallPausedByUserState(true); } catch {} });
				wrap.appendChild(img);
				wrap.appendChild(video);
				// ①(新) 网页壁纸 iframe（web wallpaper）：独立沙箱层，覆盖整屏。
				// ①(2026-09-13 注释更正 —— 之前写着"去掉 allow-same-origin"但属性里**并没有去掉**，
				//   属于注释与代码不符，会误导安全判断。现状与事实如下：
				//   · iframe 带 `allow-same-origin`，因此它与宿主**同源**（渲染器在 127.0.0.1:8899，
				//     cookie 按主机不按端口隔离 → 同 site）→ 它对插件宿主 `/api/mpkg-wallpaper/...`
				//     的 fetch **会自动带上 DSH 的会话 cookie**（这是"自定义场景/缩略图上报"能工作的前提）。
				//   · DSH 的会话 cookie 是 `HttpOnly; SameSite=Strict; Path=/`（见 dsh-client-connection
				//     的 sessionCookie）→ **场景脚本读不到它**（document.cookie 拿不到），token 不会被偷。
				//   · 但"携带"依然成立：恶意场景脚本可以凭这个 cookie 调用**插件宿主**的接口
				//     （列目录/读 /raw/上报缩略图）——属于"混淆代理"面，不是 token 泄露。
				//   彻底修法（已记入 PLUGIN-BUGS-TRACKER 批次 17）：渲染器改用**场景级短期 token**
				//   （插件签发、只授权该场景的 /raw 与缩略图上报），并去掉 `allow-same-origin` 让 iframe
				//   变成不透明源（那时它既带不了 cookie、也读不到宿主数据）。在此之前保留 allow-same-origin，
				//   否则自定义场景与缩略图缓存会整体失效。
				// 同时隔离源让浏览器可以单独节流它（防重动画卡死主界面）。
				const frame = document.createElement("iframe");
				frame.className = "mpw-webFrame";
				frame.setAttribute("allow", "autoplay");
				frame.setAttribute("allowfullscreen", "");
				frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-pointer-lock");
				frame.setAttribute("tabindex", "-1");
				frame.muted = true; // ①(新) 默认静音（web 壁纸常带声音）
				frame.style.display = "none";
				wrap.appendChild(frame);
				// ①(新 2026-09-16 第 11 条) 网页壁纸**交互舞台**：壁纸层本身 pointer-events:none
				//   （它是背景层），作者脚本的 pointermove/click/wheel/keydown 永远收不到事件。
				//   交互模式开启时才显示舞台（默认隐藏 ⇒ 宿主界面零影响），事件由这里换算成
				//   iframe 内 client 像素、经 postMessage 送进 shim 合成 DOM 事件。
				//   实现与常量契约见 lib/web-interaction.js（同一份源码在 Node 里可跑断言）。
				const ixStage = document.createElement("div");
				ixStage.className = "mpw-webInteract";
				ixStage.setAttribute("data-mpw-interact-stage", "1");
				wrap.appendChild(ixStage);
				const ixBtn = document.createElement("div");
				ixBtn.className = "mpw-webInteractBtn";
				ixBtn.setAttribute("role", "button");
				ixBtn.setAttribute("tabindex", "-1");
				ixBtn.textContent = "交互";
				ixBtn.title = "开启网页壁纸交互（鼠标/滚轮/键盘送进壁纸；60 秒无操作或 Esc 自动退出）";
				wrap.appendChild(ixBtn);
				const ixExit = document.createElement("div");
				ixExit.className = "mpw-webInteractExit";
				ixExit.setAttribute("role", "button");
				ixExit.setAttribute("tabindex", "-1");
				ixExit.textContent = "退出交互 (Esc)";
				wrap.appendChild(ixExit);
				// ①(新) 场景图层合成 canvas（route B v1：动态渲染全部图层）
				const canvas = document.createElement("canvas");
				canvas.id = BG_CANVAS_ID;
				canvas.className = "mpw-bgCanvas";
				canvas.style.display = "none";
				wrap.appendChild(canvas);
				(document.body || document.documentElement).appendChild(wrap);
			}
			return wrap;
		}
		function bgElements() {
			const wrap = document.getElementById(BG_WRAP_ID);
			return {
				img: document.getElementById(BG_IMG_ID),
				video: document.getElementById(BG_VIDEO_ID),
				frame: wrap && typeof wrap.querySelector === "function" ? wrap.querySelector("iframe.mpw-webFrame") : null,
				canvas: wrap && typeof wrap.querySelector === "function" ? wrap.querySelector("canvas.mpw-bgCanvas") : null,
				wrap
			};
		}
		/** ①(新) host: 标记 → 真实媒体 URL（缩略图/预览/播放统一走这里）。
		 *  ①(修正) folder= 用 **path 式** URL（/custom-folder/<folder>/<file>）：
		 *  网页壁纸 iframe 的相对资源（./assets/x.js）需要按路径解析；
		 *  query 式（?folder=&file=）会让相对路径错位到 /api/mpkg-wallpaper/assets/…。
		 *  web=1 → /library-web（本地库目录内任意资源）；
		 *  scene=1 → 场景静态帧提取（/custom-scene-frame 或 /library-scene-frame）；
		 *  scene=1&sv=1 → 场景内嵌视频（scene-video 快路径，<video> 硬件解码播放）。 */
		/** 网页壁纸身份比较：剥掉「策略参数」（mpwmute/mpwspeed/mpwpause）。
		 *  为什么必须剥：插件把静音/倍速/暂停写在入口 URL 上（shim 首帧即生效），而这些参数会随
		 *  用户拨动开关变化 → 若按整串 URL 判等，每次静音都会重载壁纸（重动画壁纸重载一次很贵，
		 *  还会闪一下）。策略变化走 `policy`/`pause` 的 postMessage 增量下发，**不需要**重载。 */
		function mpwWebStripPolicy(url) {
			try {
				return String(url == null ? "" : url)
					.replace(/([?&])(mpwmute|mpwspeed|mpwpause)=[^&#]*/g, "$1")
					.replace(/[?&](?=&|$)/g, "")
					.replace(/\?&/, "?")
					.replace(/&&+/g, "&")
					.replace(/[?&]$/, "");
			} catch { return String(url == null ? "" : url); }
		}
		/** 相对路径 → URL 路径（逐段编码，保留 `/` 层级；剔除 `.`/`..` 防穿越） */
		function mpwEncRelPath(p) {
			return String(p || "").split(/[\\/]+/).filter((s) => s && s !== "." && s !== "..").map(encodeURIComponent).join("/");
		}
		function resolveHostUrl(image) {
			try {
				if (typeof image === "string" && image.indexOf("host:") === 0) {
					const q = image.slice(5);
					if (q.indexOf("ltoken=") >= 0) {
						if (q.indexOf("web=1") >= 0) {
							const p = new URLSearchParams(q.slice(1));
							// ①(新 2026-09-16 I 项) &shim=1 → 走「宿主注入 WE shim」的网页壁纸通道
							//（入口 HTML 由宿主注入 shim + 该帧用不透明源沙箱，见 showWebEl）
							const base = HOST_BASE + "/library-web/" + encodeURIComponent(p.get("ltoken") || "") + "/" + mpwEncRelPath(p.get("file"));
							return p.get("shim") === "1" ? base + "?" + mpwWebPolicyQuery() : base;
						}
						if (q.indexOf("sv=1") >= 0) return HOST_BASE + "/library-scene-video" + q.replace("scene=1&", "").replace("sv=1&", "");
						if (q.indexOf("scene=1") >= 0) return HOST_BASE + "/library-scene-frame" + q.replace("scene=1&", "");
						return HOST_BASE + "/library-media" + q;
					}
					if (q.indexOf("custom=") >= 0) {
						if (q.indexOf("sv=1") >= 0) return HOST_BASE + "/custom-scene-video" + q.replace("custom=1&", "").replace("scene=1&", "").replace("sv=1&", "");
						if (q.indexOf("scene=1") >= 0) return HOST_BASE + "/custom-scene-frame" + q.replace("custom=1&", "").replace("scene=1&", "");
						if (q.indexOf("folder=") >= 0) {
							const p = new URLSearchParams(q.slice(1));
							// ①(新 2026-09-16 I 项) 同 web=1 分支：&shim=1 → 宿主注入 shim 的网页壁纸通道
							const base = HOST_BASE + "/custom-folder/" + encodeURIComponent(p.get("folder") || "") + "/" + mpwEncRelPath(p.get("file"));
							return p.get("shim") === "1" ? base + "?" + mpwWebPolicyQuery() : base;
						}
						return HOST_BASE + "/custom-media" + q.replace("custom=1&", "");
					}
					return HOST_BASE + "/media" + q;
				}
			} catch {}
			return image;
		}
		/** ①(MERGED-3 1.1 场景缩略图 2026-09-14) 列表缩略图优先走渲染器首帧缓存路由：
		 *  /custom-scene-thumb|/library-scene-thumb = 缓存命中（渲染器曾渲染过）→ 静态帧提取 → 目录预览图。
		 *  渲染器离线时已渲染过的场景仍有缩略图；来源（cache/frame/preview）经响应头
		 *  x-mpw-thumb-src 返回，注册表供 ?mpwdiag 报告逐项探测。 */
		const __mpwSceneThumbReg = new Map(); // thumbUrl → 场景 key（mpwdiag 报告用，防重复键=url 幂等）
		const sceneThumbUrlCustom = (folder, file) => HOST_BASE + "/custom-scene-thumb?folder=" + encodeURIComponent(folder) + (file ? "&file=" + encodeURIComponent(file) : "");
		const sceneThumbUrlLibrary = (ltoken) => HOST_BASE + "/library-scene-thumb?ltoken=" + encodeURIComponent(ltoken);
		const sceneThumbSrc = (url, key) => { try { __mpwSceneThumbReg.set(url, key); } catch {} return url; };
		/** ①(MERGED-3 1.3) 剪贴板复制（clipboard API 优先，execCommand 兜底；全 try/catch 不抛） */
		const mpwCopyText = (s, onDone) => {
			const fallback = () => {
				try {
					const ta = document.createElement("textarea");
					ta.value = String(s); document.body.appendChild(ta); ta.select();
					document.execCommand("copy"); ta.remove();
				} catch (e) { /* 无剪贴板环境静默 */ }
				try { onDone(); } catch (e) {}
			};
			try {
				if (navigator.clipboard && navigator.clipboard.writeText) {
					navigator.clipboard.writeText(String(s)).then(() => { try { onDone(); } catch (e) {} }, fallback);
					return;
				}
			} catch (e) { /* 走兜底 */ }
			fallback();
		};
		let clockEl = null;
		let clockTimer = null;
		function ensureClockEl() {
			if (clockEl) return clockEl;
			clockEl = document.createElement("div");
			clockEl.id = "mpw-clock";
			clockEl.style.cssText = "position:fixed;z-index:2000;pointer-events:none;font-family:ui-monospace,SFMono-Regular,monospace;font-variant-numeric:tabular-nums;text-shadow:0 1px 6px rgba(0,0,0,.55);color:var(--dsw-alias-label-primary,#e8eaf0);";
			(document.body || document.documentElement).appendChild(clockEl);
			return clockEl;
		}
		function clockText() {
			const s = readSection();
			const now = new Date();
			let h = now.getHours();
			const use24 = s.clock24h !== void 0 ? !!s.clock24h : DEFAULT_CLOCK_24H;
			const hs = use24 ? String(h).padStart(2, "0") : String(((h % 12) || 12)).padStart(2, "0");
			const sec = s.clockSec !== void 0 ? !!s.clockSec : DEFAULT_CLOCK_SEC;
			const date = s.clockDate !== void 0 ? !!s.clockDate : DEFAULT_CLOCK_DATE;
			const t = `${hs}:${String(now.getMinutes()).padStart(2, "0")}${sec ? ":" + String(now.getSeconds()).padStart(2, "0") : ""}`;
			return date ? `${now.getMonth() + 1}月${now.getDate()}日 ${t}` : t;
		}
		function tickClock() {
			const s = readSection();
			const on = s.clock !== void 0 ? !!s.clock : DEFAULT_CLOCK;
			if (!on) {
				if (clockEl) clockEl.style.display = "none";
				if (clockTimer) { clearInterval(clockTimer); clockTimer = null; }
				return;
			}
			const el = ensureClockEl();
			el.style.display = "";
			el.textContent = clockText();
		}
		function updateClock() {
			const s = readSection();
			const on = s.clock !== void 0 ? !!s.clock : DEFAULT_CLOCK;
			if (!on) { tickClock(); return; }
			const el = ensureClockEl();
			const pos = s.clockPos !== void 0 ? s.clockPos : DEFAULT_CLOCK_POS;
			const size = s.clockSize !== void 0 ? s.clockSize : DEFAULT_CLOCK_SIZE;
			el.style.fontSize = size + "px";
			el.style.top = /t/.test(pos) ? "18px" : "auto";
			el.style.bottom = /b/.test(pos) ? "18px" : "auto";
			el.style.left = /l/.test(pos) ? "18px" : "auto";
			el.style.right = /r/.test(pos) ? "18px" : "auto";
			tickClock();
			if (!clockTimer) clockTimer = setInterval(tickClock, 1000);
		}

		let lastObjectUrl = null;
		// ⑩(新) 刷新壁纸用的 host URL 缓存击穿标记：非 0 时 applyFromStorage 给
		// host 背景 URL 追加 &_t=<tick>（同一 tick 值稳定，不会反复触发重载）。
		let hostBustTick = 0;
		// P0②(优化) 背景内容签名：仅当壁纸源真正变化时才重建 img/video 层。
		// 拖动模糊/透明度等滑块时 applyFromStorage 会反复进入，若无此缓存
		// idb:blob 每次都会新建 ObjectURL → 视频反复重缓冲、GIF 重播。
		// IndexedDB 每次 get 返回新 Blob 实例（结构化克隆），故用 size+type 做内容签名。
		let lastBgSig = null;
		// ①(修正) 背景应用代数：applyFromStorage 每次调用递增；异步 IndexedDB 回调
		// 若在更新的应用之后才返回（竞态），会被忽略——修复"视频壁纸→GIF 壁纸
		// 切换后背景仍显示旧视频"的问题（旧视频的 idbGet 回调晚到覆盖新背景）。
		let bgGen = 0;
		/** ①(新) 模块级活动进度事件：模块函数（applyFromStorage 等）无法直接访问组件
		 *  state，统一经 window 事件 mpw:busy 通知组件渲染进度条。
		 *  payload: null=隐藏 | { label, percent(null=不确定) } */
		function mpwBusyEmit(payload) {
			try { window.dispatchEvent(new CustomEvent("mpw:busy", { detail: payload })); } catch {}
		}
		/** ⓪(2026-09-17 用户第 1 条「我没用转码，为什么有个 ffmpeg 常驻转我正在放的壁纸」)
		 *  **可播性闸门**三件套：模式（含回退开关）/ 探测 URL / 三态可见性。
		 *  · `?mpwtranscode=legacy` → 完全回到旧行为（不看探测、一律自动转码）；
		 *  · `?mpwtranscode=aggressive` → 反过来：**任何** fpsCap/resMax 设置也先探测，
		 *    可直读就不转码（用户只想要"别乱转"时用）；
		 *  · 不写 → probe（默认）：可直读就不转码，探测不出来才退回转码。 */
		function mpwTranscodeGateMode() {
			try {
				const v = new URLSearchParams(location.search).get("mpwtranscode");
				if (v === "legacy" || v === "aggressive") return v;
			} catch {}
			return "probe";
		}
		/** host 探测 URL（只读元数据、不起 ffmpeg）：GET /probe?src=<image 串> */
		function mpwProbeUrl(image) {
			return HOST_BASE + "/probe?src=" + encodeURIComponent(image);
		}
		/** ⓪ 壁纸状态三态可见（**不静默占 690MB**）：direct(直读) / transcode(转码中) /
		 *  cached(命中已转码产物) / ffmpeg?（探测判定需要转码）。
		 *  落点有两个：①`window.__mpwWallpaperState`（控制台/上报可读）；
		 *  ②给 <video> 打 `data-mpw-wp-state`（真机可一眼看出当前在直读还是转码）。 */
		function mpwWallpaperStateSet(state, detail) {
			try {
				window.__mpwWallpaperState = { state: state, detail: detail || "", at: Date.now() };
				const v = bgElements().video;
				if (v) { try { v.setAttribute("data-mpw-wp-state", state); } catch {} }
				console.log("[dsh-mpkg-wallpaper] 壁纸状态 = " + state + (detail ? "（" + detail + "）" : ""));
			} catch {}
		}
		/** ⓪ 探测宿主是否已缓存该规格的转码产物（命中=复用，不重转）。
		 *  /transcode-progress 的 done + 磁盘产物存在 ⇒ cached；working ⇒ transcode。 */
		function mpwProbeTranscodeCache(src, fps, maxW) {
			try {
				return fetch(HOST_BASE + "/transcode-progress?src=" + encodeURIComponent(src) + "&fps=" + fps + (maxW > 0 ? "&maxW=" + maxW : ""))
					.then((r) => (r.ok ? r.json() : null)).then((d) => {
						const s = d && d.phase === "done" ? "cached" : (d && d.phase === "working" ? "transcode" : "");
						if (s) mpwWallpaperStateSet(s, "fps=" + fps + (maxW > 0 ? " maxW=" + maxW : ""));
						return s;
					}).catch(() => "");
			} catch { return Promise.resolve(""); }
		}
		/** ①(新) 模块级转码进度轮询（fpsCap/resMax 生效且走 /transcode 时启动）：
		 *  host /transcode-progress 返回 { phase, percent }；done/error → 隐藏。
		 *  跨 apply 去重：window.__mpwTcPollKey 记录当前轮询源。
		 *  label 用 tkey 前缀（"tc:"/"ffdl:"），组件收到后按 locale 翻译。 */
		function pollTranscodeProgress(src, fps, maxW) {
			let tries = 0;
			mpwBusyEmit({ label: "tc:0", percent: 0 });
			const iv = setInterval(() => {
				try {
					fetch(HOST_BASE + "/transcode-progress?src=" + encodeURIComponent(src) + "&fps=" + fps + (maxW > 0 ? "&maxW=" + maxW : ""))
						.then((r) => (r.ok ? r.json() : null))
						.then((d) => {
							if (!d || d.phase === "idle") return;
							if (d.phase === "done" || d.phase === "error") { clearInterval(iv); window.__mpwTcPollKey = null; mpwBusyEmit(null); return; }
							mpwBusyEmit({ label: d.phase === "downloading" ? "ffdl:" + (d.percent || 0) : "tc:" + (d.percent || 0), percent: d.percent || 0 });
						}).catch(() => {});
				} catch { clearInterval(iv); window.__mpwTcPollKey = null; mpwBusyEmit(null); }
				if (++tries > 120) { clearInterval(iv); window.__mpwTcPollKey = null; mpwBusyEmit(null); } // 20min 上限
			}, 1000);
			return iv;
		}
		/** ①(修正) 缓存击穿：URL 追加 &_t=<tick>（幂等：同 tick 不重复追加）。 */
		function bustUrl(url, tick) {
			if (!url) return url;
			const t = tick || Date.now();
			if (url.indexOf("_t=") >= 0) return url.replace(/_t=\d+/, "_t=" + t);
			return url + (url.indexOf("?") >= 0 ? "&" : "?") + "_t=" + t;
		}
		// ⑤(新) Edge 兼容渲染（参考 elysia395 v0.4.1）：Edge（且仅 Edge）会在任何
		// "可见的 <video>" 上绘制自带的「下载/投屏」悬浮工具栏且无法关闭；唯一的
		// 规避方式是不让可见的 <video> 存在 → 在 Edge 上把视频壁纸画到 <canvas>。
		//   * UA 门控（Edg/）：Chrome/Firefox 等完全走原生 <video>，零影响；
		//   * requestVideoFrameCallback 只在出现新帧时重绘（暂停/后台 tab 零开销），
		//     无该 API 时回退 rAF；
		//   * 画布位图上限=视频原始分辨率（不放大），由 CSS 缩放到视口。
		// <video> 仍留在 DOM（不可见）仅当解码源；play/pause/playbackRate 照常。
		const IS_EDGE = typeof navigator !== "undefined" && /Edg\//.test(navigator.userAgent);
		let edgeDraw = null; // { ctx, video, wrap }
		let edgeVf = 0, edgeRaf = 0, edgeResizeObs = null;
		function stopEdgeDraw() {
			const d = edgeDraw;
			if (edgeVf && d && d.video && d.video.cancelVideoFrameCallback) { try { d.video.cancelVideoFrameCallback(edgeVf); } catch {} }
			edgeVf = 0;
			if (edgeRaf) { try { cancelAnimationFrame(edgeRaf); } catch {} edgeRaf = 0; }
			if (edgeResizeObs) { try { edgeResizeObs.disconnect(); } catch {} edgeResizeObs = null; }
			edgeDraw = null;
		}
		function edgeDrawFrame() {
			const d = edgeDraw;
			if (!d || !d.ctx || !d.ctx.canvas.isConnected) return;
			const video = d.video;
			const vw = video.videoWidth, vh = video.videoHeight;
			if (!vw || !vh) { edgeVf = 0; if (edgeRaf) { cancelAnimationFrame(edgeRaf); edgeRaf = 0; } return; }
			const canvas = d.ctx.canvas;
			const dpr = Math.min(window.devicePixelRatio || 1, 2);
			const cw = Math.max(1, Math.min(vw, Math.round(canvas.clientWidth * dpr)));
			const ch = Math.max(1, Math.min(vh, Math.round(canvas.clientHeight * dpr)));
			if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
			const g = d.ctx;
			g.clearRect(0, 0, cw, ch);
			// ①(修正) fit 每次绘制时现读（原来绘制启动时捕获一次 → 改 zoom 后比例不更新）
			const fit = (readSection().zoom !== void 0 ? readSection().zoom : 100) >= 100 ? "cover" : "contain";
			const scale = fit === "contain" ? Math.min(cw / vw, ch / vh) : Math.max(cw / vw, ch / vh);
			const dw = vw * scale, dh = vh * scale;
			g.drawImage(video, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
			if (video.requestVideoFrameCallback) {
				edgeVf = video.requestVideoFrameCallback(() => { edgeVf = 0; edgeDrawFrame(); });
			} else if (!edgeRaf) {
				edgeRaf = requestAnimationFrame(() => { edgeRaf = 0; edgeDrawFrame(); });
			}
		}
		/** ⑤(新) Edge 上把 <video> 背景切到 canvas 渲染（仅 Edge，UA 门控）。 */
		function showVideoEdge(url, video) {
			const { img, frame, canvas, wrap } = bgElements();
			if (!canvas || !wrap) return;
			stopEdgeDraw();
			stopSceneAnim(); // ①(修正) 场景合成与 Edge 视频共用 canvas：先停场景 rAF，防止旧帧覆盖
			wrap.classList.remove("mpw-img", "mpw-web", "mpw-scene");
			wrap.classList.add("mpw-video");
			if (img) img.style.display = "none";
			if (frame) { try { frame.removeAttribute("src"); } catch {} frame.style.display = "none"; }
			video.style.display = "none"; // 不可见：仅当解码源（Edge 悬浮工具栏只跟"可见"元素）
			canvas.style.display = "";
			const g = canvas.getContext("2d");
			if (!g) { canvas.style.display = "none"; video.style.display = ""; return; }
			edgeDraw = { ctx: g, video, wrap };
			if (edgeResizeObs) { try { edgeResizeObs.disconnect(); } catch {} }
			try { edgeResizeObs = new ResizeObserver(() => edgeDrawFrame()); edgeResizeObs.observe(canvas); } catch {}
			// ①(修正) 同 showVideoEl：用 getAttribute('src') 判等，避免 video.src(绝对)与 url(相对)恒不等
			// 导致每次 applyFromStorage 都重设 src → Edge 端也重载重播。
			try { if (video.getAttribute('src') !== url) video.src = url; } catch {}
			video.playbackRate = (typeof readSection().playbackRate === "number" && readSection().playbackRate >= 0.5 && readSection().playbackRate <= 2) ? readSection().playbackRate : 1;
			edgeDrawFrame();
			// ①(修正) 暂停门控：Edge canvas 渲染路径也尊重暂停，避免其余路径重播
			try { if (!(wallUserPaused || powPaused)) { const p = video.play(); if (p && p.catch) p.catch(() => {}); } } catch {}
			// ①(修正) 首帧前先画一帧（避免白屏）——用命名函数 + removeEventListener 防泄漏
			//（原来 {once:true} 在视频永不加载时会残留监听，评审指出）
			const drawOnce = () => { try { video.removeEventListener("loadeddata", drawOnce); } catch {} edgeDrawFrame(); };
			try { video.addEventListener("loadeddata", drawOnce); } catch {}
		}
		/** ①(修正) 切离 web 壁纸时释放该 iframe 上的 observer（webMediaObserve /
		 *  hideWebPanel 的 MutationObserver），防泄漏。 */
		function disposeWebFrame(frame) {
			try {
				if (frame.__mpwWebObs) { frame.__mpwWebObs.disconnect(); frame.__mpwWebObs = null; }
			} catch {}
			try {
				if (frame.__mpwPanelObs) { frame.__mpwPanelObs.disconnect(); frame.__mpwPanelObs = null; }
			} catch {}
		}
		/** ①(修正) 彻底卸载 web iframe：断 observers + 移除 src + 隐藏 + 去 mpw-web 类。
		 *  在 clearBg / 从 web 切到非 web 时**无条件**调用——否则 iframe 文档（WebGL/
		 *  音频/定时器）永不释放 → 内存只增不减 → 反复导入后 OOM（用户实测）。 */
		function teardownWebFrame() {
			try {
				const frame = bgElements().frame;
				disarmSceneWatchdog(true); // ①(批次15 B1) 卸载 web iframe：解除场景看门狗并清兜底视觉
				try { mpwWebIxDisarm("teardown"); } catch {} // ①(第 11 条) 卸载网页壁纸必须退出交互模式（否则残留输入面）
			try { if (window.__mpwLnReset) window.__mpwLnReset(); } catch {} // ①(批次15 B3) 方向键守卫复位
				if (!frame) return;
				disposeWebFrame(frame);
				try { frame.removeAttribute("src"); } catch {}
				frame.style.display = "none";
				try { const wrap = bgElements().wrap; if (wrap) wrap.classList.remove("mpw-web"); } catch {}
			} catch {}
		}
		function showImageEl() {
			const { img, video, frame, canvas, wrap } = bgElements();
			if (!img || !video || !wrap) return;
			try { video.pause(); } catch {}
			stopSceneAnim();
			stopEdgeDraw(); // ⑤(新) 切离视频时停掉 Edge canvas 绘制
			// ①(2026-09-17 壁纸层可见性轮) `keepSrc=true`：调用方（applyFromStorageInner 图片分支）
			//   刚刚才设好 img.src，这里**只能撤兜底视觉、不能清 src** —— 旧写法无条件清空，
			//   实测把图片/GIF 壁纸的画面整片抹掉（见 mpwSceneClearFallback 的说明）。
			disarmSceneWatchdog(true, true); // ①(批次15 B1) 切到图片壁纸：解除场景看门狗并清兜底视觉
			try { if (window.__mpwLnReset) window.__mpwLnReset(); } catch {} // ①(批次15 B3) 方向键守卫复位
			if (frame) {
				try { disposeWebFrame(frame); } catch {}
				try { frame.removeAttribute("src"); } catch {} frame.style.display = "none";
			}
			if (canvas) canvas.style.display = "none";
			if (lastObjectUrl) { try { URL.revokeObjectURL(lastObjectUrl); } catch {} lastObjectUrl = null; }
			try { video.removeAttribute("src"); } catch {}
			// ①(加固) 用 CSS 类切换 img/video 显示（比 inline style 更可靠）
			wrap.classList.remove("mpw-video");
			wrap.classList.add("mpw-img");
			wrap.classList.remove("mpw-scene");
			wrap.classList.remove("mpw-web");
			video.style.display = "none";
			img.style.display = "";
		}
		function showVideoEl(url) {
			const { img, video, frame, canvas, wrap } = bgElements();
			if (!img || !video || !wrap) return;
			// ①(加固) CSS 类切换：视频壁纸显示 video、隐藏 img
			stopSceneAnim();
			disarmSceneWatchdog(true); // ①(批次15 B1) 切到视频壁纸：解除场景看门狗并清兜底视觉
			try { if (window.__mpwLnReset) window.__mpwLnReset(); } catch {} // ①(批次15 B3) 方向键守卫复位
			wrap.classList.remove("mpw-img");
			wrap.classList.add("mpw-video");
			wrap.classList.remove("mpw-scene");
			wrap.classList.remove("mpw-web");
			img.style.display = "none";
			if (frame) {
				try { disposeWebFrame(frame); } catch {}
				try { frame.removeAttribute("src"); } catch {} frame.style.display = "none";
			}
			if (canvas) canvas.style.display = "none";
			if (lastObjectUrl && lastObjectUrl !== url) { try { URL.revokeObjectURL(lastObjectUrl); } catch {} }
			lastObjectUrl = url;
			// ①(修正) 用 getAttribute('src')（原始相对串）比较，**别用 video.src**——
			// video.src 读取返回**绝对** URL（http://host/api/...），而 url 是相对路径，
			// 两者恒不相等 → 每次 applyFromStorage（调静音/亮度等**无关**设置）都重赋值
			// video.src → 浏览器重载媒体源 → autoplay 自动播放，绕过下方 play() 暂停门控
			// （用户实测：暂停后调静音壁纸又重播、暂停按钮与实际状态脱节）。
			// getAttribute('src') 返回原始的相对字符串，同 url 相等 → 不重载，彻底避免。
			try { if (video.getAttribute('src') !== url) video.src = url; } catch {}
			// ⑳(新) 视频倍速：原生 playbackRate（0.5-2x，即时生效，不重载）
			try {
				const rate = readSection().playbackRate;
				if (typeof rate === "number" && rate >= 0.5 && rate <= 2 && video.playbackRate !== rate) video.playbackRate = rate;
			} catch {}
			video.style.display = "";
			// ①(修正) 暂停状态门控：用户手动暂停（wallUserPaused）或省电暂停（powPaused）
			// 时不 play——否则任何设置开关 apply（commit→applyFromStorage→showVideoEl）都
			// 无条件 play()，把用户手动暂停解开（用户实测"暂停后开启效果又解开暂停"）。
			if (!(wallUserPaused || powPaused)) {
				try { const p = video.play(); if (p && p.catch) p.catch(() => {}); } catch {}
			}
		}
		/**
		 * ①(修复 2026-09-12) 清理场景 iframe 上历史遗留的诊断开关。
		 * 背景：壁纸 URL 曾被写成 `&skin0=0`，而渲染器把 `skin0` 当**"存在即关蒙皮"**的二分诊断开关
		 * （demo.html: `skinEnabled = !params.has('skin0')`，见 README-DIAGNOSTICS「蒙皮问题二分」）——
		 * 壁纸里 5 个 mesh 层（主体/眼睛/耳朵/右眼上眼睑/长发 mesh）因此退化成未蒙皮的整块 quad，
		 * 画面永远对不上标定表与全部测试所验证的路径。
		 * 生成 URL 处已移除该参数；这里再对**设置里已存的 webUrl** 就地清理一次，
		 * 否则用户必须重新选一次场景才生效。只动渲染器 URL（含 pkgurl/pkgpath），不碰普通网页壁纸。
		 */
		function mpwSanitizeSceneUrl(u) {
			try {
				const s = String(u || "");
				if (s.indexOf("pkgurl=") < 0 && s.indexOf("pkgpath=") < 0) return s;
				if (s.indexOf("skin0") < 0) return s;
				// 去掉参数后要归一化分隔符：`a&skin0=0&b` → `a&b`（不能留 `&&`）、`?skin0=0` → `?`
				return s.replace(/([?&])skin0(?:=[^&]*)?/g, "$1")
					.replace(/\?&/g, "?").replace(/&&+/g, "&").replace(/[?&]$/, "");
			} catch { return u; }
		}
		// ═══ ①(批次15 2026-09-13 B1/B2/B3/B5) 场景渲染器：首帧看门狗 / 故障信号 / 调试参数透传 ═══
		//   背景：渲染器 iframe 一旦失败（GL 上下文丢失/纹理 OOM/首帧卡住/进程掉线），用户看到的
		//   就是纯白/纯灰，插件侧既不知道也不回退（用户原话："hina 点开加载了一下整个屏幕直接
		//   变成空白"）。本块补齐"看门狗 + 兜底 + 上报"：
		//   B1 首帧看门狗：应用场景时记下时刻与身份 → N 秒内没收到该身份的首帧缩略图
		//      （渲染器首帧会 POST /custom-scene-thumb，宿主记为信标）→ 判定"没出画" →
		//      自动回退静态帧（iframe 保留，可手动重试）。
		//   B2 故障信号：渲染器 postMessage({type:'mpw-health'})（§5 已请 A 接入）→ 落插件 diag
		//      （kind:'scene-render-health'）；连续上下文丢失 / 0x501/0x502 → 自动重建一次 iframe；
		//      探测 false→true → 自动重挂（此前只探测不重挂）。
		//   B3 调试参数：设置项 sceneDebugParams（白名单逐个校验）拼进壁纸 URL。
		//   B5 低内存：deviceMemory/hardwareConcurrency 判定 → &lowmem=1 透传 + 大纹理提示。
		let __mpwSceneUiBridge = null;      // 组件渲染时注入 {commit,setHint,setMpkgMeta,hideBusy,t}
		let __mpwSceneWdForce = false;      // 下次 arm 强制重新计时（重试/换调试参数后用）
		let __mpwSceneWdBustNext = false;   // 下次 showWebEl 给渲染器 URL 加一次性 _mpwr 强制重载
		// ①(2026-09-14 用户 A 口径) 末尾四个是"文本可见性开关"的**契约名**（渲染器 N5 实现，取值 0/1）：
		//   showclock=时钟 / showdate=日期 / showweekday=星期 / showfps=帧率 —— 是否显示由开关决定。
		//   meshsize=1|crop：凯尔希网格实验口径（P-58 H1，**默认关**；证据见 docs/MODEL-INDIRECTION-RESEARCH 的官方标定反证）——
		//   放行只是为了让你能从面板做 A/B，不代表推荐开启。
		//   白名单只是"允许透传"，渲染器未实现前传了也会被忽略（无害）。
		const MPW_SCENE_DEBUG_KEYS = ["ln", "eyehack", "novideo", "audit", "ownsize", "att", "hier", "nofx", "np", "whitefallback", "skiny", "trace", "isolate", "parallax", "qflip", "showclock", "showdate", "showweekday", "showfps", "meshsize"];
		const MPW_SCENE_WD_DEFAULT_SEC = 8;
		let __mpwSceneWd = null;            // 看门狗状态 {ident,info,url,armedAt,secs,confirmed,fallback,lastPostAt,checkTimer}
		let __mpwSceneLastOk = { ident: null, at: 0 }; // 最近一次确认出画的身份+时刻（同场景重入快速确认）
		let __mpwSceneHealth = null;        // 最近一次 mpw-health 消息（mpwdiag 报告带出）
		let __mpwSceneAutoRebuilt = "";     // ident|reason 已自动重建标记（每场景应用限一次）
		let __mpwSceneBeaconOk = null;      // null=未探测 / true=宿主信标路由可用 / false=不可用（宿主未重载新版 index.js）
		let __mpwSceneBigTexHinted = "";    // 大纹理提示过的身份（B5②，每场景一次）
		let __mpwSceneBigPkgHinted = "";    // 大场景包提示过的身份（B5②，每场景一次）
		/** ①(批次15 B1) 信标可用性探测：/custom-scene-thumb?lastpost=1 是**宿主侧**路由，
		 *  dsh 不重启就不生效（实测 patch 触碰/内容变更都不重载插件宿主代码）→ 老宿主 401/非 JSON。
		 *  此时**绝不能**让看门狗按超时兜底（会误伤正常渲染的场景）→ 降级为仅 B2 健康信号 + 手动重试。
		 *  true 后缓存；false 不缓存死——每次 arm 重探，dsh 重启后自动恢复完整看门狗。 */
		function mpwSceneBeaconProbe(info) {
			return fetch(mpwSceneBeaconUrl(info), { cache: "no-store" })
				.then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
				.then((d) => !!(d && d.ok && typeof d.lastPostAt === "number"))
				.catch(() => false);
		}
		function mpwSceneUi() { return __mpwSceneUiBridge; }
		function mpwSceneT(key, zhFallback) {
			try { const b = mpwSceneUi(); if (b && typeof b.t === "function") { const v = b.t(key); if (v && v !== key) return v; } } catch {}
			return zhFallback;
		}
		function mpwSceneSetHint(msg) {
			try { const b = mpwSceneUi(); if (b && b.setHint) { b.setHint(msg); return; } } catch {}
			try { console.info("[dsh-mpkg-wallpaper]", msg); } catch {}
		}
		/** 工厂层的"提交设置"：优先组件桥（面板开着，状态同步），桥缺席降级 writeSection+applyFromStorage。 */
		function mpwSceneCommit(patch) {
			try {
				const b = mpwSceneUi();
				if (b && b.commit) return b.commit(patch, true);
			} catch {}
			try {
				const next = Object.assign({}, readSection(), patch);
				writeSection(next, true);
				try { applyFromStorage(); } catch (e) { mpwErr("applyFromStorage(commit(patch))", e); }
				return next;
			} catch (e) { console.error("[dsh-mpkg-wallpaper] scene commit 失败:", e); return null; }
		}
		/** ①(B3) 调试参数净化：只放行白名单键，值做字符校验（拒绝注入），同名后者覆盖，上限 8 对 / 240 字符。 */
		function mpwSanitizeSceneDebugParams(raw) {
			try {
				const s = String(raw || "").trim();
				if (!s) return "";
				const seen = Object.create(null);
				for (const part of s.split("&").join(";").split(";")) {
					const seg = String(part || "").trim();
					if (!seg) continue;
					const eq = seg.indexOf("=");
					const k = eq >= 0 ? seg.slice(0, eq).trim() : seg;
					let v = eq >= 0 ? seg.slice(eq + 1).trim() : "1";
					if (MPW_SCENE_DEBUG_KEYS.indexOf(k) < 0) continue;      // 白名单外的键（含 skin0 等）一律丢弃
					if (!v) v = "1";                                         // 空值按"存在即生效"类开关处理
					if (/[<>"'`\\\x00-\x1f]/.test(v)) continue;              // 值里不允许出现可注入字符
					if (k.length + v.length > 80) continue;
					seen[k] = v;
				}
				const keys = Object.keys(seen).slice(0, 8);
				const out = [];
				let total = 0;
				for (const k of keys) { const pair = k + "=" + seen[k]; if (total + pair.length > 240) break; out.push(pair); total += pair.length + 1; }
				return out.join("&");
			} catch { return ""; }
		}
		/** ①(B3) 净化后的参数 → URL 片段（&k=v&k2=v2，值 encodeURIComponent）。 */
		function mpwSceneDebugQuery(paramsStr) {
			const clean = mpwSanitizeSceneDebugParams(paramsStr);
			if (!clean) return "";
			return "&" + clean.split("&").map((p) => {
				const eq = p.indexOf("=");
				return encodeURIComponent(p.slice(0, eq)) + "=" + encodeURIComponent(p.slice(eq + 1));
			}).join("&");
		}
		/** ①(B3) 重拼渲染器 URL：剥掉旧的白名单调试参数与 _mpwr buster，再追加新参数（保存/清空即时生效用）。 */
		function mpwSceneUrlWithDebug(url, paramsStr) {
			try {
				const u = new URL(String(url || ""));
				for (const k of MPW_SCENE_DEBUG_KEYS) u.searchParams.delete(k);
				u.searchParams.delete("_mpwr");
				const clean = mpwSanitizeSceneDebugParams(paramsStr);
				if (clean) for (const pair of clean.split("&")) { const eq = pair.indexOf("="); u.searchParams.set(pair.slice(0, eq), pair.slice(eq + 1)); }
				return u.toString();
			} catch { return url; }
		}
		/** ①(B1) 一次性 buster：强制 iframe 重载；幂等比较前先剥掉（避免无关 applyFromStorage 重载渲染器）。 */
		function mpwSceneBustUrl(url) {
			try { const u = new URL(String(url || "")); u.searchParams.set("_mpwr", String(Date.now() % 100000000)); return u.toString(); } catch { return String(url || "") + (String(url || "").indexOf("?") >= 0 ? "&" : "?") + "_mpwr=" + Date.now(); }
		}
		function mpwStripBust(url) {
			try { const u = new URL(String(url || "")); u.searchParams.delete("_mpwr"); return u.toString(); } catch { return String(url || "").replace(/([?&])_mpwr=\d+/g, "$1").replace(/[?&]$/, "").replace(/\?$/, ""); }
		}
		/** ①(B5) 低内存设备判定：deviceMemory ≤4GB 或 逻辑核 ≤4（都拿不到则不标记）。 */
		function mpwSceneLowMem() {
			try {
				const dm = navigator.deviceMemory, hc = navigator.hardwareConcurrency;
				return (typeof dm === "number" && dm > 0 && dm <= 4) || (typeof hc === "number" && hc > 0 && hc <= 4);
			} catch { return false; }
		}
		/** ①(B1) 从壁纸 URL 解析场景身份（与宿主 sceneThumbIdentity 同构：custom|folder|file / library|ltoken|file）。 */
		function mpwSceneIdentityFromWebUrl(url) {
			try {
				const u = new URL(String(url || ""));
				const puRaw = u.searchParams.get("pkgurl");
				if (!puRaw) return null;
				const inner = new URL(puRaw);
				const folder = inner.searchParams.get("folder") || "";
				const ltoken = inner.searchParams.get("ltoken") || "";
				const file = inner.searchParams.get("file") || "scene.pkg";
				if (ltoken) return { ident: "library|" + ltoken + "|" + file, kind: "library", ltoken, file };
				if (folder) return { ident: "custom|" + folder + "|" + file, kind: "custom", folder, file };
				return null;
			} catch { return null; }
		}
		// ═══ ①(B6 沙箱 + 场景级短期 token 2026-09-13) 契约：we-scene-demo/RENDERER-SANDBOX-CONTRACT.md ═══
		//   问题（PLUGIN-BUGS-TRACKER 批次 17）：壁纸 iframe 带 allow-same-origin → 渲染器文档里的
		//   第三方场景脚本与渲染器同源，可以 fetch 插件宿主路由并自动带 DSH 会话 cookie（混淆代理面；
		//   cookie 是 HttpOnly 偷不走，但"带着它发请求"成立 → 能读任意 custom 目录的 /raw、能盲写上报）。
		//   修法：① strict 模式去掉 allow-same-origin（iframe 变**不透明源**：读不到宿主数据、
		//   跨源请求带 Origin: null 且不带凭据）；② 宿主签发**场景级 30 分钟** token，渲染器只拿它
		//   调自己那一个场景的 /raw 与缩略图上报 → 宿主对"Origin: null 且无合法 token"的请求直接 403。
		//   兼容：拿不到 token（宿主未重启 → 404/401）、用户显式 legacy、或 strict 启动失败自动回退
		//   → 一律退回旧 sandbox，功能与今天完全一致（旧插件/旧宿主也照旧工作）。
		let __mpwSandboxTokens = Object.create(null);    // ident → { token, exp }
		let __mpwSandboxPending = Object.create(null);   // ident → true（取 token 中）
		let __mpwSandboxFailed = Object.create(null);    // ident → reason（strict 失败过 → 该场景用 legacy）
		let __mpwSandboxUpgraded = Object.create(null);  // ident → true（已做过一次 legacy→strict 升级）
		let __mpwSandboxCap = null;                      // 渲染器 mpw-cap 最新上报
		let __mpwSandboxLast = { ident: null, mode: "legacy", reason: "init" };
		let __mpwSandboxLastMeta = null;                 // 最近一次场景挂载的 meta（升级/回退时重挂用）
		let __mpwSandboxStrictTimer = 0;
		const MPW_SANDBOX_LEGACY_ATTR = "allow-scripts allow-same-origin allow-pointer-lock";
		const MPW_SANDBOX_STRICT_ATTR = "allow-scripts allow-pointer-lock";
		// ═══ ①(新 2026-09-16 I 项) 网页（web）类壁纸：WE API shim 通道 ═══
		//   背景：WE 的 web 壁纸是**一张网页**，作者脚本在加载时调 `wallpaperPropertyListener` /
		//   `wallpaperRegisterAudioListener` 等 WE API（官方 CEF 在作者脚本之前装好原生函数）。
		//   本插件此前只有裸 iframe（没有任何 WE API）→ 这类壁纸只剩静态外壳。
		//   本通道：入口 URL 带 `mpwshim=1` → 宿主在 HTML 的 <head> 最前注入 shim
		//   （见 lib/web-wallpaper.js），帧用**不透明源**沙箱（no allow-same-origin）：
		//   作者脚本摸不到宿主 DOM / localStorage（DSH 界面与设置都在同一源上）。
		//   代价：父页读不到帧内 DOM → 静音/倍速/暂停改由 shim 在帧内执行（postMessage 下达）。
		//   兜底：兼容模式（同源，等价于改动前的裸 iframe 行为）在确认弹窗里可选，
		//   Live2D 类壁纸的设置面板（写 iframe 同源 localStorage）依赖它。
		const MPW_WEB_SANDBOX_ATTR = "allow-scripts";
		const MPW_WEB_COMPAT_ATTR = "allow-scripts allow-same-origin allow-pointer-lock";
		const MPW_WEB_SHIM_MARK = "mpwshim=1";
		const MPW_WEB_SHIM_MSG = "mpw:web";
		const MPW_WEB_SHIM_TIMEOUT_MS = 2500;
		/** 当前帧 URL 是否走「宿主注入 shim」的网页壁纸通道 */
		function mpwWebShimUrl(url) {
			try { return /[?&]mpwshim=1(?:&|$)/.test(String(url || "")); } catch { return false; }
		}
		/** 网页壁纸的沙箱属性：shim 通道 = 不透明源；其余（渲染器/兼容模式）沿用既有两档。 */
		function mpwWebSandboxAttr(url) {
			const s = String(url || "");
			if (mpwWebShimUrl(s)) return MPW_WEB_SANDBOX_ATTR;
			return /[?&]sandbox=strict(?:&|$)/.test(s) ? MPW_SANDBOX_STRICT_ATTR : MPW_SANDBOX_LEGACY_ATTR;
		}
		/** 网页壁纸 diag 上报（kind:'web-wallpaper'；失败一律吞掉，不影响壁纸） */
		function mpwWebDiag(why, data) {
			try {
				fetch(HOST_BASE + "/diag", { method: "POST", body: JSON.stringify(Object.assign({ kind: "web-wallpaper", why: String(why || ""), at: new Date().toISOString() }, data || {})) }).catch(() => {});
			} catch {}
		}
		/** 帧内媒体策略（静音/倍速/暂停）→ 查询串：shim 首帧即生效，不必等 postMessage */
		function mpwWebPolicyQuery() {
			let mute = true, speed = 1;
			try {
				const s = readSection();
				mute = s.mute !== void 0 ? !!s.mute : true;
				if (typeof s.playbackRate === "number") speed = s.playbackRate;
			} catch {}
			return MPW_WEB_SHIM_MARK + "&mpwmute=" + (mute ? "1" : "0") + "&mpwspeed=" + speed + "&mpwpause=" + (wallUserPaused ? "1" : "0");
		}
		/** 父页 → 帧内 shim（不透明源下 targetOrigin 只能 '*'；op 白名单见 web-wallpaper.js） */
		function webShimCall(frame, msg) {
			try {
				if (!frame || !frame.contentWindow) return false;
				frame.contentWindow.postMessage(Object.assign({ mpw: MPW_WEB_SHIM_MSG }, msg || {}), "*");
				return true;
			} catch { return false; }
		}
		/** 只认当前壁纸 iframe 的消息（cross-origin 下按 contentWindow 身份比对，与 mpwIsSceneFrameMsg 同一纪律） */
		function mpwIsWebFrameMsg(ev) {
			try {
				const f = bgElements().frame;
				return !!(f && f.contentWindow && ev && ev.source === f.contentWindow);
			} catch { return false; }
		}
		/** 从帧 URL 反推壁纸身份（props/目录文件要用它取 project.json） */
		function mpwWebSrcFromUrl(url) {
			const s = String(url || "");
			let m = /\/custom-folder\/([^/?#]+)\//.exec(s);
			if (m) { const id = decodeURIComponent(m[1]); return { src: "custom", id, key: "custom|" + id }; }
			m = /\/library-web\/([^/?#]+)\//.exec(s);
			if (m) { const id = decodeURIComponent(m[1]); return { src: "library", id, key: "library|" + id }; }
			return null;
		}
		/** project.json 的 general.properties → WE 属性线格式（`{name:{value}}`）。
		 *  file/directory 类型一律下发（无 value 时给空串）：作者常判 `typeof p[name]` 后才走默认资源，
		 *  缺对象会让它们直接 TypeError。 */
		function mpwWebPropsToWire(project) {
			const out = {};
			try {
				const props = project && project.general && project.general.properties;
				if (!props || typeof props !== "object") return out;
				for (const name in props) {
					if (!Object.prototype.hasOwnProperty.call(props, name)) continue;
					const def = props[name];
					if (!def || typeof def !== "object" || typeof def.type !== "string") continue;
					const type = def.type.toLowerCase();
					const hasValue = Object.prototype.hasOwnProperty.call(def, "value");
					if (!hasValue && type !== "file" && type !== "directory") continue;
					out[name] = { value: def.value === void 0 || def.value === null ? (type === "file" || type === "directory" ? "" : def.value) : def.value };
				}
			} catch {}
			return out;
		}
		/** 显式指定模式：?mpwsandbox=legacy|strict 优先，其次设置项 sandboxMode。 */
		function mpwSandboxForced() {
			try {
				const v = new URLSearchParams(location.search).get("mpwsandbox");
				if (v === "legacy" || v === "strict") return v;
			} catch {}
			try { const s = readSection(); if (s && s.sandboxMode === "legacy") return "legacy" } catch {}
			return null;
		}
		/** 该场景可用的 token（未过期；留 60s 余量）。 */
		function mpwSandboxToken(ident) {
			try {
				const t = __mpwSandboxTokens[ident];
				if (t && t.token && (!t.exp || t.exp * 1000 > Date.now() + 60000)) return t.token;
			} catch {}
			return null;
		}
		/** 挂载计划：strict 需要 token；拿不到就 legacy（并在后台取 token，取到后一次性升级）。 */
		function mpwSandboxPlan(ident) {
			if (!ident) return { ident: null, mode: "legacy", reason: "no-ident", token: null };
			if (mpwSandboxForced() === "legacy") return { ident, mode: "legacy", reason: "forced", token: null };
			if (__mpwSandboxFailed[ident]) return { ident, mode: "legacy", reason: "strict-failed:" + __mpwSandboxFailed[ident], token: null };
			const tk = mpwSandboxToken(ident);
			if (tk) return { ident, mode: "strict", reason: "token", token: tk };
			return { ident, mode: "legacy", reason: "no-token", token: null };
		}
		/** 后台取 token（宿主路由；宿主未重启时会 404/401 → 静默失败，保持 legacy）。 */
		function mpwSandboxPrefetch(ident) {
			try {
				if (!ident || __mpwSandboxPending[ident] || mpwSandboxToken(ident) || __mpwSandboxFailed[ident] || mpwSandboxForced() === "legacy") return;
				__mpwSandboxPending[ident] = true;
				fetch(HOST_BASE + "/scene-thumb-token?scene=" + encodeURIComponent(ident), { cache: "no-store" })
					.then((r) => (r.ok ? r.json() : null))
					.then((d) => {
						__mpwSandboxPending[ident] = false;
						if (!d || !d.ok || !d.token) return;
						__mpwSandboxTokens[ident] = { token: String(d.token), exp: Number(d.exp) || 0 };
						mpwSandboxMaybeUpgrade(ident);
					})
					.catch(() => { __mpwSandboxPending[ident] = false; });
			} catch {}
		}
		/** token 到手：若当前挂载的正是这个场景且因"没 token"走了 legacy → 一次性重挂为 strict。 */
		function mpwSandboxMaybeUpgrade(ident) {
			try {
				if (!ident || __mpwSandboxUpgraded[ident]) return;
				if (!__mpwSandboxLastMeta || __mpwSandboxLast.ident !== ident) return;
				if (__mpwSandboxLast.mode !== "legacy" || __mpwSandboxLast.reason !== "no-token") return;
				__mpwSandboxUpgraded[ident] = true;
				__mpwSceneWdBustNext = true;
				__mpwSceneWdForce = true;
				applySceneViaRenderer(__mpwSandboxLastMeta);
			} catch {}
		}
		/** strict 失败（渲染器自报 ok:false，或 8s 内没出首帧）→ 该场景一次性退回 legacy，避免黑屏。 */
		function mpwSandboxFail(reason) {
			try {
				const last = __mpwSandboxLast || {};
				const ident = last.ident;
				if (!ident || last.mode !== "strict" || __mpwSandboxFailed[ident]) return;
				__mpwSandboxFailed[ident] = String(reason || "unknown").slice(0, 60);
				try {
					fetch(HOST_BASE + "/diag", { method: "POST", body: JSON.stringify({ kind: "scene-sandbox", why: "strict-fallback", ident, reason: String(reason || ""), cap: __mpwSandboxCap, at: new Date().toISOString() }) }).catch(() => {});
				} catch {}
				if (__mpwSandboxLastMeta) { __mpwSceneWdBustNext = true; __mpwSceneWdForce = true; applySceneViaRenderer(__mpwSandboxLastMeta); }
			} catch {}
		}
		/** strict 首帧看门狗：8s 内没收到 mpw-cap{firstFrame:true} → 回退（阈值比 B1 的秒级看门狗宽松，避免误杀慢包）。 */
		function mpwSandboxArmStrictWatch() {
			try {
				if (__mpwSandboxStrictTimer) { clearTimeout(__mpwSandboxStrictTimer); __mpwSandboxStrictTimer = 0 }
				const last = __mpwSandboxLast || {};
				if (last.mode !== "strict") return;
				__mpwSandboxStrictTimer = setTimeout(() => {
					__mpwSandboxStrictTimer = 0;
					if (__mpwSandboxCap && __mpwSandboxCap.firstFrame) return;
					mpwSandboxFail(__mpwSandboxCap ? "cap-no-first-frame" : "cap-silent");
				}, 8000);
			} catch {}
		}
		/** 渲染器消息来源校验：strict 下 ev.origin 是 "null"（不透明源），所以必须同时认 contentWindow。 */
		function mpwIsSceneFrameMsg(ev) {
			try {
				const f = bgElements().frame;
				if (f && ev && ev.source && ev.source === f.contentWindow) return true;
			} catch {}
			try {
				const b = mpwSceneRendererBase();
				if (b && ev && ev.origin && ev.origin !== "null" && b.indexOf(ev.origin) === 0) return true;
			} catch {}
			return false;
		}
		function mpwSandboxDiag() {
			try {
				return {
					last: { ident: __mpwSandboxLast.ident, mode: __mpwSandboxLast.mode, reason: __mpwSandboxLast.reason },
					attr: (function () { try { const f = bgElements().frame; return f ? f.getAttribute("sandbox") : null } catch { return null } })(),
					tokens: Object.keys(__mpwSandboxTokens), failed: __mpwSandboxFailed,
					upgraded: Object.keys(__mpwSandboxUpgraded), pending: Object.keys(__mpwSandboxPending), cap: __mpwSandboxCap
				};
			} catch (e) { return { err: String(e && e.message || e) } }
		}
		try { window.__mpwSandbox = { plan: mpwSandboxPlan, prefetch: mpwSandboxPrefetch, diag: mpwSandboxDiag, cap: () => __mpwSandboxCap, isSceneMsg: mpwIsSceneFrameMsg, fail: mpwSandboxFail }; } catch {} // ①测试入口
		function mpwSceneBeaconUrl(info) {
			const t = Date.now();
			if (info.kind === "library") return HOST_BASE + "/library-scene-thumb?ltoken=" + encodeURIComponent(info.ltoken) + "&file=" + encodeURIComponent(info.file) + "&lastpost=1&t=" + t;
			return HOST_BASE + "/custom-scene-thumb?folder=" + encodeURIComponent(info.folder) + "&file=" + encodeURIComponent(info.file) + "&lastpost=1&t=" + t;
		}
		/** ①(B1) 兜底静态帧地址：走宿主已有的 /custom-scene-frame /library-scene-frame 提取链。 */
		function mpwSceneStaticFrameUrl(info) {
			if (info.kind === "library") return resolveHostUrl("host:?ltoken=" + encodeURIComponent(info.ltoken) + "&scene=1&file=" + encodeURIComponent(info.file));
			return resolveHostUrl("host:?custom=1&folder=" + encodeURIComponent(info.folder) + "&scene=1&file=" + encodeURIComponent(info.file));
		}
		function mpwSceneWatchEnabled() {
			try { if (localStorage.getItem("mpwwatch") === "0") return false; } catch {}
			try { const s = readSection(); if (s && s.sceneWatchdog === false) return false; } catch {}
			return true;
		}
		function mpwSceneWatchSecs() {
			try { const s = readSection(); const v = s && s.sceneWatchdogSecs; if (typeof v === "number" && isFinite(v)) return Math.max(3, Math.min(30, Math.round(v))); } catch {}
			return MPW_SCENE_WD_DEFAULT_SEC;
		}
		function mpwSceneWdState() {
			const wd = __mpwSceneWd;
			if (!wd) return { armed: false };
			return { armed: true, ident: wd.ident, confirmed: wd.confirmed, fallback: wd.fallback, secs: wd.secs, armedAt: wd.armedAt, lastPostAt: wd.lastPostAt };
		}
		/** ①(2026-09-17 壁纸层可见性轮) 回退开关：`?bgwrapfix=legacy` → 回到改动前行为
		 *  （showImageEl 仍会无条件清掉 img.src、也不做"有源却没挂上"的补挂校验）。
		 *  默认（无参数 / 其他值 / 读取抛错）= 修复后行为。 */
		function mpwBgWrapFixOn() {
			try { return new URLSearchParams(location.search).get("bgwrapfix") !== "legacy"; } catch { return true; }
		}
		/** ①(2026-09-17 壁纸层可见性轮) `keepSrc=true` 时**只撤兜底视觉，不清 img.src**。
		 *  为什么必须加这个参数（bgwrap-display-probe 实测，见 docs/BGWRAP-VISIBILITY.md）：
		 *  本函数被 `disarmSceneWatchdog(true)` 从 `showImageEl()` 里调用，而 `showImageEl()` 的调用点
		 *  （applyFromStorageInner 的图片分支）**刚刚**才把 `img.src` 设成壁纸源 ⇒ 无条件清空等于
		 *  "设完立刻抹掉"：探针记录到 t=3310 设 src(156630 字符)、t=3313 被本函数清掉，
		 *  `naturalWidth` 恒 0 ⇒ **图片/GIF 壁纸整层可见但没有画面**（刷新后壁纸"不显示"的真因）。
		 *  清 src 只对"确实在显示场景兜底帧"的路径有意义（看门狗超时兜底/迟到首帧恢复/重建 iframe），
		 *  那些路径继续照旧清（不传 keepSrc）。 */
		function mpwSceneClearFallback(keepSrc) {
			try {
				const { img, wrap } = bgElements();
				if (wrap) wrap.classList.remove("mpw-scene-fallback");
				if (img) {
					// 修复后：只有"非图片壁纸路径"（keepSrc 缺省）才清 src；?bgwrapfix=legacy 恢复旧行为。
					if (!(keepSrc && mpwBgWrapFixOn())) { try { img.removeAttribute("src"); } catch {} }
					try { img.onerror = null; } catch {}
				}
			} catch {}
		}
		function disarmSceneWatchdog(clearVisual, keepSrc) {
			const wd = __mpwSceneWd;
			if (wd) { try { if (wd.checkTimer) clearInterval(wd.checkTimer); } catch {} }
			__mpwSceneWd = null;
			if (clearVisual) mpwSceneClearFallback(keepSrc);
		}
		/** 武装看门狗。同场景重入（applyFromStorage 因无关设置重跑）保持既有判定，不重新计时；
		 *  force=true（重试/换调试参数/换场景）时强制重新计时并清掉旧兜底视觉。 */
		function armSceneWatchdog(url, force) {
			const info = mpwSceneIdentityFromWebUrl(url);
			if (!info) { disarmSceneWatchdog(true); return; }
			const prev = __mpwSceneWd;
			if (!force && prev && prev.ident === info.ident) return;
			disarmSceneWatchdog(false);
			mpwSceneClearFallback();
			if (!mpwSceneWatchEnabled()) {
				try { fetch(HOST_BASE + "/diag", { method: "POST", body: JSON.stringify({ kind: "scene-render-health", why: "watchdog-disabled", ident: info.ident, at: new Date().toISOString() }) }).catch(() => {}) } catch {}
				return;
			}
			const secs = mpwSceneWatchSecs();
			__mpwSceneWd = { ident: info.ident, info: info, url: url, armedAt: Date.now(), secs: secs, confirmed: false, fallback: false, lastPostAt: 0, checkTimer: 0, fallbackAt: 0 };
			// 同一场景此前已确认出画（iframe 没重载、不会再有新缩略图）→ 直接沿用，避免误兜底。
			//  force=true（重试/换参数/重应用）时**必须**重新计时：重试后旧缩略图信标已是过去时。
			if (!force && __mpwSceneLastOk.ident === info.ident && Date.now() - __mpwSceneLastOk.at < 10 * 60 * 1000) {
				__mpwSceneWd.confirmed = true;
				return;
			}
			// ①(批次15 B1) 信标可用性门：**每次武装都重探**（不缓存 true——dsh 若回滚到旧版宿主，
			//  缓存会让看门狗按超时误兜底正常渲染的场景）。探测本身是宿主侧廉价 stat+JSON。
			mpwSceneBeaconProbe(info).then((okB) => {
				const wd = __mpwSceneWd;
				if (!wd || wd.ident !== info.ident) return;   // 武装后已换场景/解除：丢弃过期探测
				if (!okB) {
					__mpwSceneBeaconOk = false;
					wd.confirmed = true;   // 降级：放弃超时判定（避免误伤正常渲染），保留 B2 健康信号 + 手动重试
					try { fetch(HOST_BASE + "/diag", { method: "POST", body: JSON.stringify({ kind: "scene-render-health", why: "watchdog-beacon-unavailable", ident: info.ident, at: new Date().toISOString() }) }).catch(() => {}) } catch {}
					return;
				}
				__mpwSceneBeaconOk = true;
				wd.checkTimer = setInterval(() => { try { mpwSceneWdTick(); } catch {} }, 2000);
				mpwSceneWdTick();
			}).catch(() => {});
		}
		function mpwSceneWdTick() {
			const wd = __mpwSceneWd;
			if (!wd || wd.confirmed) { if (wd && wd.checkTimer) { try { clearInterval(wd.checkTimer); } catch {} wd.checkTimer = 0; } return; }
			if (!wd.fallback && Date.now() - wd.armedAt > wd.secs * 1000) { sceneFallbackActivate("timeout"); return; }
			if (wd.fallback && Date.now() - wd.fallbackAt > 120 * 1000) { // 兜底后 2 分钟内仍等不到恢复就停止轮询（手动重试仍可用）
				try { if (wd.checkTimer) clearInterval(wd.checkTimer); } catch {}
				wd.checkTimer = 0;
				return;
			}
			fetch(mpwSceneBeaconUrl(wd.info), { cache: "no-store" })
				.then((r) => (r.ok ? r.json() : null))
				.then((d) => {
					if (!__mpwSceneWd || __mpwSceneWd !== wd || wd.confirmed) return;
					if (d && d.ok && typeof d.lastPostAt === "number") {
						wd.lastPostAt = d.lastPostAt;
						if (d.lastPostAt >= wd.armedAt - 2500) mpwSceneWdConfirm();
					}
				})
				.catch(() => {});
		}
		function mpwSceneWdConfirm() {
			const wd = __mpwSceneWd;
			if (!wd || wd.confirmed) return;
			wd.confirmed = true;
			if (wd.checkTimer) { try { clearInterval(wd.checkTimer); } catch {} wd.checkTimer = 0; }
			__mpwSceneLastOk = { ident: wd.ident, at: Date.now() };
			if (wd.fallback) {
				// 兜底后渲染器终于出画（迟到首帧）→ 自动恢复实时渲染
				wd.fallback = false;
				mpwSceneClearFallback();
				mpwSceneSetHint(mpwSceneT("scnRender.wd.recovered", "场景渲染器已出画，自动恢复实时渲染"));
				try { fetch(HOST_BASE + "/diag", { method: "POST", body: JSON.stringify({ kind: "scene-render-health", why: "late-first-frame-recovered", ident: wd.ident, armedAt: wd.armedAt, at: new Date().toISOString() }) }).catch(() => {}) } catch {}
			}
		}
		/** ①(B1) 兜底激活：隐藏 iframe（保留元素与 src）、显示静态帧、提示 + 落证据。 */
		function sceneFallbackActivate(why) {
			const wd = __mpwSceneWd;
			if (!wd || wd.fallback) return;
			wd.fallback = true;
			wd.fallbackAt = Date.now();
			try {
				const { img, wrap } = bgElements();
				if (wrap) wrap.classList.add("mpw-scene-fallback");
				if (img) {
					img.onerror = () => { try { img.style.background = "#222"; } catch {} };  // 静态帧也拿不到时至少有底色
					img.src = mpwSceneStaticFrameUrl(wd.info);
				}
			} catch {}
			mpwSceneSetHint(mpwSceneT("scnRender.wd.fallback", "场景渲染器 " + wd.secs + " 秒内未出画，已回退静态帧；渲染器已保留，可稍后在 设置→场景渲染 里点“重新挂载渲染器”"));
			try { fetch(HOST_BASE + "/diag", { method: "POST", body: JSON.stringify({ kind: "scene-render-health", why: "first-frame-timeout-fallback", ident: wd.ident, secs: wd.secs, armedAt: wd.armedAt, lastPostAt: wd.lastPostAt, probe: globalThis.__mpwRendererOk === undefined ? null : !!globalThis.__mpwRendererOk, at: new Date().toISOString() }) }).catch(() => {}) } catch {}
		}
		/** ①(B1/B2) 重载渲染器 iframe（手动重试 / 自动重建 / 离线恢复共用）。诊断先落盘再动 iframe（B2 要求"重建前记住时间/场景"）。 */
		function mpwSceneReloadIframe(reason, detail) {
			try {
				const s = readSection();
				const url = s && s.webUrl;
				if (!url || String(url).indexOf("pkgurl=") < 0) {
					mpwSceneSetHint(mpwSceneT("scnRender.retry.noScene", "当前壁纸不是场景渲染器壁纸"));
					return false;
				}
				const info = mpwSceneIdentityFromWebUrl(url);
				try { fetch(HOST_BASE + "/diag", { method: "POST", body: JSON.stringify({ kind: "scene-render-health", why: "iframe-rebuild", reason: reason || "manual", detail: detail || null, ident: info && info.ident, at: new Date().toISOString() }) }).catch(() => {}) } catch {}
				mpwSceneClearFallback();
				__mpwSceneWdForce = true;
				__mpwSceneWdBustNext = true;
				showWebEl(url);
				return true;
			} catch (e) { console.error("[dsh-mpkg-wallpaper] 重建渲染器 iframe 失败:", e); return false; }
		}
		/** ①(B3) 调试参数保存/清空后：当前壁纸是渲染器场景 → 立即按新参数重挂（清空即恢复）。 */
		function mpwSceneDebugReapply(clean) {
			try {
				const s = readSection();
				const url = s && s.webUrl;
				if (!url || String(url).indexOf("pkgurl=") < 0) return false;
				const next = mpwSceneUrlWithDebug(url, clean);
				if (mpwStripBust(next) === mpwStripBust(url)) return false;
				__mpwSceneWdForce = true;
				mpwSceneCommit({ webUrl: next });
				return true;
			} catch (e) { return false; }
		}
		/** ①(B2③) 渲染器探测 false→true：场景壁纸在兜底/未确认/iframe 缺失状态下自动重挂（此前只探测不重挂）。 */
		function mpwSceneOnRendererBack() {
			try {
				const s = readSection();
				const url = s && s.webUrl;
				if (!url || String(url).indexOf("pkgurl=") < 0) return;
				const wd = __mpwSceneWd;
				const needsRemount = (wd && (wd.fallback || !wd.confirmed)) || false;
				const { frame } = bgElements();
				const frameEmpty = !frame || !frame.getAttribute("src");
				if (!needsRemount && !frameEmpty) return;
				const info = mpwSceneIdentityFromWebUrl(url);
				const marker = (info && info.ident || "") + "|renderer-back";
				if (__mpwSceneAutoRebuilt === marker) return;   // 每场景应用限自动重挂一次，防探测抖动反复重载
				__mpwSceneAutoRebuilt = marker;
				mpwSceneReloadIframe("renderer-back", null);
				mpwSceneSetHint(mpwSceneT("scnRender.back", "渲染器已恢复在线，正在重新挂载场景…"));
			} catch {}
		}
		// ①(B2) 渲染器健康信号（§5 已请 A 在渲染器里 postMessage；插件侧先备好接收/判定/自动重建）。
		//   消息契约：{type:'mpw-health', ctxLost:{lost,restored,at}, glErrs:{n,codes}, texBytes, texCount, maxTextureSize, frame, sceneId}
		try {
			if (!window.__mpwHealthHook) {
				window.__mpwHealthHook = 1;
				let __mpwHealthSig = "";
				let __mpwHealthSigAt = 0;
				window.addEventListener("message", (ev) => {
					try {
						const d = ev && ev.data;
						if (!d || d.type !== "mpw-health") return;
						// ①(B6) 来源校验改走 mpwIsSceneFrameMsg：strict 沙箱下 ev.origin === "null"
						//   （不透明源），旧的"基址前缀"规则会把渲染器自己的消息全部拒掉。
						if (!mpwIsSceneFrameMsg(ev)) return;
						__mpwSceneHealth = { at: new Date().toISOString(), ctxLost: d.ctxLost || null, glErrs: d.glErrs || null, texBytes: typeof d.texBytes === "number" ? d.texBytes : null, texCount: typeof d.texCount === "number" ? d.texCount : null, maxTextureSize: d.maxTextureSize || null, frame: d.frame || null, sceneId: d.sceneId || d.id || null };
						// ① 信号变化落插件 diag（kind:'scene-render-health'，5s 节流）
						const sig = JSON.stringify([d.ctxLost, d.glErrs, d.texBytes, d.texCount]);
						if (sig !== __mpwHealthSig && Date.now() - __mpwHealthSigAt > 5000) {
							__mpwHealthSig = sig; __mpwHealthSigAt = Date.now();
							try { fetch(HOST_BASE + "/diag", { method: "POST", body: JSON.stringify(Object.assign({ kind: "scene-render-health", why: "health-update" }, __mpwSceneHealth)) }).catch(() => {}) } catch {}
						}
						// ② 连续上下文丢失 / GPU 0x501(1281)/0x502(1282) → 自动重建一次 iframe（每场景应用限一次）
						const lost = d.ctxLost && typeof d.ctxLost.lost === "number" ? d.ctxLost.lost : 0;
						const glN = d.glErrs && typeof d.glErrs.n === "number" ? d.glErrs.n : 0;
						const glBad = !!(d.glErrs && Array.isArray(d.glErrs.codes) && d.glErrs.codes.some((c) => c === 1281 || c === 1282 || String(c).toLowerCase() === "0x501" || String(c).toLowerCase() === "0x502"));
						let identNow = "";
						try { const s = readSection(); const info = mpwSceneIdentityFromWebUrl(s && s.webUrl); identNow = (info && info.ident) || ""; } catch {}
						if (identNow && lost >= 2 && __mpwSceneAutoRebuilt !== identNow + "|ctx") {
							__mpwSceneAutoRebuilt = identNow + "|ctx";
							mpwSceneReloadIframe("ctx-lost-" + lost, { ctxLost: d.ctxLost });
						} else if (identNow && glBad && glN >= 2 && __mpwSceneAutoRebuilt !== identNow + "|gl") {
							__mpwSceneAutoRebuilt = identNow + "|gl";
							mpwSceneReloadIframe("gl-error", { glErrs: d.glErrs });
						}
						// ③(B5②/③) 纹理总量超预算 → 提示一次；总量已随 health-update 落 diag
						if (typeof d.texBytes === "number" && d.texBytes > 200 * 1024 * 1024 && __mpwSceneBigTexHinted !== identNow) {
							__mpwSceneBigTexHinted = identNow;
							mpwSceneSetHint(mpwSceneT("scnRender.bigTex", "该场景纹理总量较大（约 " + Math.round(d.texBytes / 1048576) + "MB），低配设备可能自动降采样"));
						}
					} catch {}
				});
			}
		} catch {}
		// 手动"再试一次渲染器"（面板按钮调用；兜底状态下也可用）
		window.__mpwSceneRetryRenderer = () => {
			const ok = mpwSceneReloadIframe("manual-retry", null);
			if (ok) mpwSceneSetHint(mpwSceneT("scnRender.retry.ok", "已重新挂载渲染器，等待首帧…"));
			return ok;
		};
		// 测试钩子（tools/scene-watchdog-test.mjs 用；生产不引用）
		try {
			globalThis.__mpwSceneTest = {
				sanitize: mpwSanitizeSceneDebugParams, debugQuery: mpwSceneDebugQuery, urlWithDebug: mpwSceneUrlWithDebug,
				bust: mpwSceneBustUrl, stripBust: mpwStripBust, identity: mpwSceneIdentityFromWebUrl,
				arm: armSceneWatchdog, disarm: disarmSceneWatchdog, state: mpwSceneWdState, tick: mpwSceneWdTick,
				wd: () => __mpwSceneWd, beaconUrl: mpwSceneBeaconUrl, debugKeys: MPW_SCENE_DEBUG_KEYS,
			};
		} catch {}
		// 测试钩子（tools/web-wallpaper-test.mjs 用；生产不引用）
		try {
			globalThis.__mpwWebTest = {
				sandboxAttr: mpwWebSandboxAttr, isShimUrl: mpwWebShimUrl, policyQuery: mpwWebPolicyQuery,
				stripPolicy: mpwWebStripPolicy,
				resolveHostUrl, srcFromUrl: mpwWebSrcFromUrl, propsToWire: mpwWebPropsToWire,
				encRelPath: mpwEncRelPath, call: webShimCall, afterLoad: webShimAfterLoad,
				sandboxStrict: MPW_WEB_SANDBOX_ATTR, sandboxCompat: MPW_WEB_COMPAT_ATTR, shimMsg: MPW_WEB_SHIM_MSG,
				// ①(第 11 条) 交互模式钩子：状态机/开关/源码（tools/web-interaction-test.mjs 对拍用）
				ix: { state: mpwWebIxState, arm: mpwWebIxArm, disarm: mpwWebIxDisarm, mode: mpwWebIxMode,
					// source 用**懒取值**：它在本函数之后的块里才初始化（直接取会撞 TDZ 抛错）
					afterMount: mpwWebIxAfterMount, geom: mpwWebIxGeom, source: () => MPW_WEB_INTERACT_SOURCE },
				alive: () => ({ frame: !!bgElements().frame, sandbox: (() => { try { const f = bgElements().frame; return f ? f.getAttribute("sandbox") : null; } catch { return null } })() }),
			};
		} catch {}
		/** ①(新) 网页壁纸：iframe 全屏显示（隐藏 img/video）。 */
		function showWebEl(url) {
			url = mpwSanitizeSceneUrl(url);
			const { img, video, frame, wrap } = bgElements();
			if (!img || !video || !frame || !wrap) return;
			try { video.pause(); } catch {}
			stopSceneAnim();
			stopEdgeDraw(); // ⑤(新) 切到 web 时停掉 Edge canvas 绘制
			// ①(修正) web→web 切换：先断旧 iframe 的 observer 并清标志，否则
			// webMediaObserve/hideWebPanel 的 `if(__mpwXxxObs) return` 守卫会让新文档
			// 挂不上 observer（功能回归 + 旧监听引用滞留）。
			try { disposeWebFrame(frame); } catch {}
			// ①(修正) **onload 必须赋值在 frame.src=url 之前**——onload 只在该次导航时触发；
			// 先赋值保证新文档加载完成时能收到（否则 iframe 已开始加载，onload 可能错过）。
			// onload 开头清陈旧观察器标志（上次导航 on about:blank 可能已置位），再对新文档挂载。
			frame.onload = () => {
				try { frame.__mpwWebObs = null; frame.__mpwPanelObs = null; } catch {}
				try { applyWebMute(frame); } catch {}
				try { applyWebSpeed(frame); } catch {}
				// ①(修正) 同步隐藏面板 + 挂观察器——不再依赖等 canvas（那会误藏壁纸）。
				// hideWebPanel 现在只藏 #basetting/#setting-button 本身，无论 canvas
				// 何时创建在哪都不会误伤壁纸本体，onload 直接执行即安全。
				try { hideWebPanel(frame); } catch {}
				try { webMediaObserve(frame); } catch {}
				// ①(新 2026-09-16 I 项) 网页壁纸 shim 通道：握手 + 下发属性/策略/目录池。
				//   不透明源下 contentDocument 不可达，上面两个函数会静默跳过（各自有 doc 守卫），
				//   静音/倍速由 shim 在帧内执行（这里是 postMessage 下达）。
				try { webShimAfterLoad(frame); } catch {}
				// ①(第 11 条) 交互舞台：按设置/URL 决定是否自动进入交互模式（默认不自动）
				try { mpwWebIxAfterMount(frame); } catch {}
			};
			wrap.classList.remove("mpw-img");
			wrap.classList.remove("mpw-video");
			wrap.classList.remove("mpw-scene");
			wrap.classList.add("mpw-web");
			img.style.display = "none";
			video.style.display = "none";
			// ①(批次15 B1) 重试/自动重建路径给渲染器 URL 加一次性 buster（_mpwr）强制重载；
			//   幂等比较先剥 buster —— 无关设置触发的 applyFromStorage 重入不会重载正在跑的渲染器。
			let mpwEffUrl = url;
			try {
				if (__mpwSceneWdBustNext && url && url.indexOf("pkgurl=") >= 0) mpwEffUrl = mpwSceneBustUrl(url);
			} catch {}
			__mpwSceneWdBustNext = false;
			// ①(B6) 导航前按 URL 决定 sandbox：带 sandbox=strict → 不透明源（**无** allow-same-origin）。
			//   浏览器在**导航时**读取 sandbox 属性 → 必须在 frame.src 赋值之前设置。
			// ①(2026-09-16 I 项) 网页壁纸 shim 通道（URL 带 mpwshim=1）→ 同样是不透明源，
			//   但属性集更小（只要 allow-scripts：该帧不需要 pointer-lock，也不该拿 same-origin）。
			try {
				const __sbStrict = /[?&]sandbox=strict(?:&|$)/.test(String(mpwEffUrl || ""));
				const __webShim = mpwWebShimUrl(mpwEffUrl);
				frame.setAttribute("sandbox", mpwWebSandboxAttr(mpwEffUrl));
				frame.setAttribute("data-mpw-sandbox", __webShim ? "web-strict" : __sbStrict ? "strict" : "legacy");
				if (__sbStrict) mpwSandboxArmStrictWatch();
				if (__webShim) webShimArm(frame);
			} catch {}
			// ①(2026-09-14 第 9 项) 场景壁纸挂载 = 武装全局方向键守卫（只调层数，不切壁纸列表）；
			//   图片/视频壁纸不武装（切离路径 __mpwLnReset() 会解除）。
			try { if (/[?&]pkgurl=/.test(String(mpwEffUrl || "")) && window.__mpwLnSet) window.__mpwLnSet(true); } catch {}
			// ①(2026-09-16 I 项) 幂等比较再剥一层「网页壁纸策略参数」：URL 身份 = 壁纸身份，
			//   不含静音/倍速/暂停（否则每次拨开关都重载壁纸；策略由 postMessage 增量下发）。
			const __urlId = (u) => mpwWebStripPolicy(mpwStripBust(u));
			try { if (__urlId(frame.getAttribute("src")) !== __urlId(mpwEffUrl)) frame.src = mpwEffUrl; } catch (e) { mpwErr("设置 iframe.src(壁纸加载点)", e); }
			// ①(修正) 同 URL 重入（如调 opacity/静音滑块 → applyFromStorage → showWebEl 同 URL）：
			// src 未变 → onload 不触发 → observer 不会重挂（评审发现的回归：旧 observer 已
			// 被上面 disposeWebFrame 断开）。此时手动补挂，面板/媒体保障不丢。
			// ①(修正) 用 getAttribute('src') 判等（与上行一致）——frame.src 读回绝对 URL，
			// 与相对 url 恒不等会让每次 applyFromStorage 都重设 src → web 壁纸无关设置也重载。
			try {
				if (__urlId(frame.getAttribute("src")) === __urlId(url)) {
					webMediaObserve(frame);
					hideWebPanel(frame);
					try { webShimAfterLoad(frame); } catch {}   // ①(2026-09-16 I 项) 重入也补一次握手/属性下发（含最新策略）
					try { mpwWebIxAfterMount(frame); } catch {}   // ①(第 11 条) 重入也补一次交互舞台状态
				}
			} catch {}
			// ①(修正) 静音开关（默认开）：web 壁纸有声音时用。
			// ①(修正) frame.muted 逻辑曾写反（!(mute) → 默认反而出声）；现在正向。
			applyWebMute(frame);
			frame.style.display = "";
			// ⑳(新) web 壁纸倍速：iframe 内 <video> 的 playbackRate（同源可访问；
			// 部分 web 壁纸用 canvas/WebGL 渲染无 <video>，静默跳过）
			try { applyWebSpeed(frame); } catch {}
			// ①(批次15 B1) 场景渲染器壁纸：武装首帧看门狗（应用/恢复/重试统一入口）；
			//   普通网页壁纸解除看门狗。force 旗标由重试/调试参数路径置位，用完即清。
			try {
				if (url && url.indexOf("pkgurl=") >= 0) armSceneWatchdog(url, __mpwSceneWdForce);
				else disarmSceneWatchdog(false);
			} catch (e) {}
			__mpwSceneWdForce = false;
		}
		/** ①(修正) 观察 web iframe 内新增的 audio/video：自动补静音 + 倍速。
		 *  挂到 frame 元素上（frame 被 showImageEl/showVideoEl 移除 src 或卸载时
		 *  一起被清理，避免观察器泄漏）。 */
		function webMediaObserve(frame) {
			try {
				if (frame.__mpwWebObs) return;
				const doc = frame && frame.contentDocument;
				if (!doc) return;
				// ①(修正) 节流+过滤：Live2D/Spine 等动画壁纸每帧都在改 DOM，若每次变动都
				// 跑 applyWebMute/applyWebSpeed（内部 querySelectorAll 全文档扫描）会把主线程
				// 占满——用户实测：web 壁纸下再扫描目录加载缩略图时壁纸和缩略图都卡。
				// 现在只对**新增了 video/audio** 的变更反应，且合并到最多 ~120ms 一次。
				let pend = null;
				const run = () => {
					pend = null;
					try { applyWebMute(frame); applyWebSpeed(frame); } catch {}
				};
				const obs = new MutationObserver((muts) => {
					let need = false;
					for (let i = 0; i < muts.length && !need; i++) {
						const nodes = muts[i].addedNodes || [];
						for (let j = 0; j < nodes.length && !need; j++) {
							const n = nodes[j];
							if (!n || n.nodeType !== 1) continue;
							if (n.tagName === "VIDEO" || n.tagName === "AUDIO" || (n.querySelector && n.querySelector("video,audio"))) need = true;
						}
					}
					if (!need) return;
					if (!pend) pend = setTimeout(run, 120);
				});
				obs.observe(doc.documentElement, { childList: true, subtree: true });
				frame.__mpwWebObs = obs;
				// 切离 web 壁纸时由 showImageEl/showVideoEl 里 removeAttribute("src")
				// 触发页面卸载；这里再补一个保险：frame 被移除时 disconnect。
				try {
					const wrap = bgElements().wrap;
					if (wrap && wrap.__mpwWebObsCleanup) { try { wrap.__mpwWebObsCleanup(); } catch {} }
					wrap.__mpwWebObsCleanup = () => { try { disposeWebFrame(frame); } catch {} };
				} catch {}
			} catch {}
		}
		/** ①(新) web 壁纸静音：iframe.muted + 内部所有 audio/video 元素 muted。
		 *  （仅 iframe.muted 对部分用 WebAudio/动态创建的壁纸无效，双保险。） */
		function applyWebMute(frame) {
			try {
				const s = readSection();
				const mute = s.mute !== void 0 ? !!s.mute : true;
				if (frame) frame.muted = mute;
				// ①(2026-09-16 I 项) shim 通道：帧内静音由 shim 执行（不透明源读不到帧内元素）
				if (frame && mpwWebShimUrl(frame.getAttribute("src"))) {
					webShimCall(frame, { op: "policy", muted: mute, speed: typeof s.playbackRate === "number" ? s.playbackRate : 1 });
				}
				const doc = frame && frame.contentDocument;
				if (doc) {
					const els = doc.querySelectorAll("video,audio");
					for (let i = 0; i < els.length; i++) {
						try { els[i].muted = mute; } catch {}
					}
				}
			} catch {}
		}
		/** ⑳(新) 给 web 壁纸 iframe 内的 <video> 应用倍速（含加载完成后补一次）。 */
		function applyWebSpeed(frame) {
			try {
				const s = readSection();
				const rate = s.playbackRate;
				if (typeof rate !== "number" || rate < 0.5 || rate > 2) return;
				if (frame && mpwWebShimUrl(frame.getAttribute("src"))) {
					webShimCall(frame, { op: "policy", muted: s.mute !== void 0 ? !!s.mute : true, speed: rate });
				}
				const doc = frame && frame.contentDocument;
				if (!doc) return;
				const vids = doc.querySelectorAll("video");
				for (let i = 0; i < vids.length; i++) {
					try { vids[i].playbackRate = rate; } catch {}
				}
			} catch {}
		}
		// ═══ ①(新 2026-09-16 第 11 条) 交互模式：把宿主舞台上的指针/滚轮/键盘按 WE 语义送进帧内 ═══
		//   为什么需要：壁纸层是 z-index:-1 + pointer-events:none 的背景层，且帧是**不透明源**沙箱
		//   （父页读不到帧内 DOM）⇒ 作者脚本的监听器只能靠父页"推事件 + 帧内合成"。
		//   安全边界（三条，全部有回归断言）：
		//     ① 默认关闭：舞台 CSS 恒 display:none，宿主界面/输入框完全不受影响（零回归）；
		//     ② 只在**交互模式**接管：开启时才给 html 打 data-mpw-interact="on"，此时宿主界面
		//        pointer-events:none（防"舞台之下的按钮被顺手点掉"），并显示右上角退出按钮；
		//     ③ 一定会退出：60s 无注入（idle）或 180s 总时长（maxAge）、Esc、退出按钮、切壁纸、
		//        window blur 都会关掉 —— 不允许出现"宿主被永久劫持"。
		//   沙箱属性**不变**：仍然只有 allow-scripts（不透明源）；合成事件是父页 postMessage 送进来的，
		//   不需要放 allow-same-origin / allow-pointer-lock（见 docs/WEB-WALLPAPER.md §11.3）。
		//
		//   舞台逻辑的**唯一源**是 lib/web-interaction.js 的 WEB_INTERACT_CLIENT_SOURCE（字符串常量，
		//   本仓库无构建步骤，client.js 是宿主直接 require 的手写模块 ⇒ 只能求值同一份源码）。
		//   会话字段/协议形状与该模块由 tools/web-interaction-test.mjs 逐字段对拍（防漂移），
		//   所以**不要**在这里手改逻辑：改 lib/web-interaction.js，同步把下面这段注释里的
		//   源码常量复制更新（测试会在漂移时报红）。
		const MPW_WEB_INTERACT_SOURCE = `
(function (win) {
    "use strict";
    var MSG = "mpw:web";
    var IDLE_MS = 60000, MAX_MS = 180000;
    var BLOCK = ["F5","F11","F12","BrowserBack","BrowserForward","BrowserRefresh"];
    var BTN = 1;
    function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }
    function mods(ev) {
      var m = 0;
      if (ev && ev.ctrlKey) m |= 1;
      if (ev && ev.shiftKey) m |= 2;
      if (ev && ev.altKey) m |= 4;
      if (ev && ev.metaKey) m |= 8;
      return m;
    }
    function point(ev, rect, iw, ih) {
      var cx = num(ev && ev.clientX, NaN), cy = num(ev && ev.clientY, NaN);
      if (!isFinite(cx) || !isFinite(cy)) return null;
      var fw = num(rect && rect.width, 0), fh = num(rect && rect.height, 0);
      if (!(fw > 0) || !(fh > 0) || !(iw > 0) || !(ih > 0)) return null;
      var sx = fw / iw, sy = fh / ih;
      var x = (cx - num(rect.left, 0)) / (sx || 1);
      var y = (cy - num(rect.top, 0)) / (sy || 1);
      return { x: x, y: y, inside: x >= 0 && y >= 0 && x <= iw && y <= ih };
    }
    function make() {
      var on = false, mode = "pointer", started = 0, last = 0, timer = 0;
      var buttons = 0;
      function nowMs() { try { return Date.now() } catch (e) { return 0 } }
      var api = {
        isOn: function () { return on },
        mode: function () { return on ? mode : "off" },
        buttons: function () { return buttons },
        arm: function (m) {
          var t = nowMs();
          if (on) { last = t; return false; }
          on = true; started = t; last = t; buttons = 0;
          if (m === "full" || m === "pointer") mode = m;
          return true;
        },
        disarm: function () {
          if (!on) return false;
          on = false; started = 0; last = 0; buttons = 0;
          return true;
        },
        touch: function () { if (on) last = nowMs() },
        remainMs: function () {
          if (!on) return 0;
          var t = nowMs();
          return Math.max(0, Math.min(last + IDLE_MS, started + MAX_MS) - t);
        },
        tick: function () {
          if (!on) return false;
          var t = nowMs();
          if (t - last >= IDLE_MS || t - started >= MAX_MS) { api.disarm(); return true; }
          return false;
        },
        snapshot: function () { return { on: on, mode: api.mode(), remainMs: Math.round(api.remainMs()), idleMs: IDLE_MS, maxMs: MAX_MS } },
        pointer: function (ev, rect, iw, ih, down) {
          if (!on) return null;
          var p = point(ev, rect, iw, ih);
          if (!p) return null;
          var next = down ? BTN : 0;
          if (next === buttons && down !== true) { }
          buttons = next;
          last = nowMs();
          return { mpw: MSG, op: "pointer", x: p.x, y: p.y, inside: p.inside, buttons: next, mods: mods(ev) };
        },
        wheel: function (ev, rect, iw, ih) {
          if (!on) return null;
          var dx = num(ev && ev.deltaX, 0), dy = num(ev && ev.deltaY, 0);
          if (dx === 0 && dy === 0) return null;
          var p = point(ev, rect, iw, ih);
          last = nowMs();
          return { mpw: MSG, op: "wheel", x: p ? p.x : null, y: p ? p.y : null, dx: dx, dy: dy, mode: num(ev && ev.deltaMode, 0), mods: mods(ev) };
        },
        key: function (ev, down) {
          if (!on || mode !== "full" || !ev) return null;
          var key = typeof ev.key === "string" ? ev.key : "";
          if (!key) return null;
          var text = "";
          if (down && !ev.ctrlKey && !ev.metaKey && !ev.altKey && key.length === 1) text = key;
          last = nowMs();
          return { mpw: MSG, op: "key", down: !!down, key: key.slice(0, 32), code: String(ev.code || "").slice(0, 32), keyCode: num(ev.keyCode, 0) | 0, mods: mods(ev), text: text, repeat: !!ev.repeat, composing: !!ev.isComposing };
        },
        blur: function (f) { if (!f) return false; try { f.contentWindow.postMessage({ mpw: MSG, op: "blur" }, "*"); return true } catch (e) { return false } },
        state: function (f) { if (!f) return false; try { f.contentWindow.postMessage({ mpw: MSG, op: "interact", on: on }, "*"); return true } catch (e) { return false } },
        preventDefault: function (ev) {
          if (!ev || !on || mode !== "full") return false;
          var k = typeof ev.key === "string" ? ev.key : "";
          if (BLOCK.indexOf(k) >= 0 || k === "Tab" || k === "Backspace") return true;
          if ((ev.ctrlKey || ev.metaKey) && /^[a-z]$/i.test(k) && /^[rwtnqlp]$/i.test(k)) return true;
          return false;
        },
        watch: function (onExpire) {
          try { if (timer) win.clearInterval(timer) } catch (e) {}
          timer = win.setInterval(function () { try { if (api.tick()) onExpire() } catch (e) {} }, 1000);
          return timer;
        },
        unwatch: function () { try { if (timer) win.clearInterval(timer) } catch (e) {} timer = 0; }
      };
      return api;
    }
    var existing = null;
    try { existing = win.__mpwInteraction || null } catch (e) {}
    win.__mpwInteraction = existing || make();
    return win.__mpwInteraction;
  })
`;
		let mpwWebIx = null;
		let mpwWebIxWired = false;
		/** 舞台逻辑实例（首次调用时求值源码；求值失败 ⇒ null，交互能力整体降级为"不可用"，插件不受影响）。 */
		function mpwWebIxApi() {
			if (mpwWebIx) return mpwWebIx;
			try {
				// 源码形态是 IIFE 表达式（`(function(win){…})`）⇒ 必须求值**再调用**，
				// 只 `return` 出来会拿到函数本身而不执行（挂在 window 上的实例也就不会出现）。
				const factory = new Function("return " + MPW_WEB_INTERACT_SOURCE)();
				const api = typeof factory === "function" ? factory(window) : null;
				if (api && typeof api.arm === "function") mpwWebIx = api;
			} catch (e) { try { mpwWebDiag("interact-init-failed", { message: String((e && e.message) || e).slice(0, 200) }); } catch {} }
			return mpwWebIx;
		}
		/** `webInteraction` 设置项 + URL 强制开关。缺省 = pointer 档（可点/可滚，不注入键盘）。 */
		function mpwWebIxMode() {
			try {
				const q = new URLSearchParams(location.search).get("mpwinteract");
				if (q === "full") return "full";
				if (q === "pointer") return "pointer";
				if (q === "off" || q === "0") return "off";
			} catch {}
			try {
				const v = readSection().webInteraction;
				if (typeof v === "string" && (v === "off" || v === "full")) return v;
			} catch {}
			return "pointer";
		}
		/** 帧内 client 像素空间的几何（舞台=视口，帧=iframe 自身盒子）。 */
		function mpwWebIxGeom(frame) {
			const r = frame.getBoundingClientRect();
			return { rect: r, w: r.width, h: r.height, iw: frame.clientWidth, ih: frame.clientHeight };
		}
		/** 是否还有"活着的"交互帧（帧在 DOM 里 + 还是 shim 通道 + 当前壁纸是 web）。 */
		function mpwWebIxFrame() {
			try {
				const { frame, wrap } = bgElements();
				if (!frame || !wrap || !wrap.classList.contains("mpw-web")) return null;
				if (!frame.isConnected || !mpwWebShimUrl(frame.getAttribute("src"))) return null;
				return frame;
			} catch { return null; }
		}
		function mpwWebIxArm(mode) {
			try {
				const api = mpwWebIxApi();
				const frame = mpwWebIxFrame();
				if (!api || !frame) return false;
				api.arm(mode === "full" ? "full" : "pointer");
				mpwWebIxWire();
				api.watch(() => mpwWebIxDisarm("expired"));
				mpwWebIxPaint();
				api.state(frame);
				mpwWebDiag("interact-arm", api.snapshot());
				return true;
			} catch { return false }
		}
		function mpwWebIxDisarm(why) {
			try {
				const api = mpwWebIxApi();
				if (!api) return false;
				const was = api.disarm();
				try { api.unwatch() } catch {}
				const frame = mpwWebIxFrame();
				if (frame) { try { api.blur(frame); api.state(frame) } catch {} }
				mpwWebIxPaint();
				if (was) mpwWebDiag("interact-disarm", { why: String(why || "") });
				return was;
			} catch { return false }
		}
		function mpwWebIxPaint() {
			try {
				const api = mpwWebIxApi();
				const { wrap } = bgElements();
				const on = !!(api && api.isOn());
				if (wrap) wrap.classList.toggle("mpw-webInteract-on", on);
				try {
					if (on) document.documentElement.setAttribute("data-mpw-interact", "on");
					else document.documentElement.removeAttribute("data-mpw-interact");
				} catch {}
				try {
					const ex = wrap && wrap.querySelector(".mpw-webInteractExit");
					if (ex) ex.textContent = on ? ("退出交互 (Esc) · " + Math.ceil(api.remainMs() / 1000) + "s") : "退出交互 (Esc)";
				} catch {}
			} catch {}
		}
		/** 事件接线（全局只接一次；每次挂载只重设目标帧）。全部 capture+passive 组合都显式标注。 */
		function mpwWebIxWire() {
			if (mpwWebIxWired) return;
			mpwWebIxWired = true;
			const api = mpwWebIxApi();
			if (!api) return;
			/** 事件 → 帧内消息（返回 true = 消费掉了）。几何每次都现算：布局可能变（分屏/缩放）。 */
			const send = (ev, kind, arg) => {
				const frame = mpwWebIxFrame();
				if (!frame || !api.isOn()) return false;
				const g = mpwWebIxGeom(frame);
				let msg = null;
				try {
					if (kind === "move") msg = api.pointer(ev, g.rect, g.iw, g.ih, false);
					else if (kind === "down") msg = api.pointer(ev, g.rect, g.iw, g.ih, true);
					else if (kind === "up") msg = api.pointer(ev, g.rect, g.iw, g.ih, false);
					else if (kind === "wheel") msg = api.wheel(ev, g.rect, g.iw, g.ih);
					else if (kind === "key") msg = api.key(ev, !!arg);
				} catch {}
				if (!msg) return false;
				try { frame.contentWindow.postMessage(msg, "*"); } catch {}
				return true;
			};
			// 指针：move/down/up 都接；up 也挂在 window（拖拽出舞台再松开不能丢，否则作者卡在按下态）
			const onMove = (ev) => { try { send(ev, "move") } catch {} };
			const onDown = (ev) => { try { if (ev.button !== 0) return; send(ev, "down") } catch {} };
			const onUp = (ev) => { try { if (ev.button !== 0) return; send(ev, "up") } catch {} };
			const onLeave = () => { try { const f = mpwWebIxFrame(); if (f && api.isOn()) api.blur(f) } catch {} };
			window.addEventListener("pointermove", onMove, { capture: true, passive: true });
			window.addEventListener("pointerdown", onDown, { capture: true, passive: true });
			window.addEventListener("pointerup", onUp, { capture: true, passive: true });
			window.addEventListener("pointerleave", onLeave, { capture: true, passive: true });
			window.addEventListener("blur", onLeave, { capture: true, passive: true });
			// 滚轮必须非 passive（要 preventDefault 掉宿主页面滚动；只有交互模式才拦）
			window.addEventListener("wheel", (ev) => {
				try {
					if (!api.isOn()) return;
					const used = send(ev, "wheel");
					if (used) { ev.preventDefault(); ev.stopPropagation() }
				} catch {}
			}, { capture: true, passive: false });
			// 右键菜单：交互模式下由壁纸决定（作者常用 contextmenu 做自定义菜单）
			window.addEventListener("contextmenu", (ev) => {
				try {
					if (!api.isOn()) return;
					const frame = mpwWebIxFrame();
					if (!frame) return;
					ev.preventDefault(); ev.stopPropagation();
				} catch {}
			}, { capture: true, passive: false });
			// 键盘：pointer 档**不接**（作者没有 onkeydown 时不该吞用户的键）；full 档注入 + 白名单拦默认行为
			const onKey = (down) => (ev) => {
				try {
					if (!api.isOn()) return;
					if (ev.key === "Escape") { mpwWebIxDisarm("esc"); try { ev.preventDefault(); ev.stopPropagation() } catch {} return }
					if (!send(ev, "key", down)) return;
					if (api.preventDefault(ev)) { try { ev.preventDefault(); ev.stopPropagation() } catch {} }
				} catch {}
			};
			window.addEventListener("keydown", onKey(true), { capture: true });
			window.addEventListener("keyup", onKey(false), { capture: true });
			// 入口/退出按钮（pointerdown 也吃：避免舞台抢走按下事件）
			const bindBtn = (sel, fn) => {
				try {
					document.addEventListener("pointerdown", (ev) => {
						try {
							const t = ev.target;
							if (t && t.classList && t.classList.contains(sel)) { ev.preventDefault(); ev.stopPropagation(); fn() }
						} catch {}
					}, { capture: true });
				} catch {}
			};
			bindBtn("mpw-webInteractBtn", () => {
				const m = mpwWebIxMode();
				if (m === "off") { mpwWebDiag("interact-disabled", { mode: m }); return }
				mpwWebIxArm(m);
			});
			bindBtn("mpw-webInteractExit", () => mpwWebIxDisarm("button"));
			// 计时徽标（1s 一次；不开交互时什么都不做）
			try { setInterval(() => { try { const a = mpwWebIxApi(); if (a && a.isOn()) mpwWebIxPaint() } catch {} }, 1000); } catch {}
		}
		/** 网页壁纸挂载时调用（showWebEl 里）：按设置决定是否自动进入交互模式。
		 *  默认**不自动**（避免"打开壁纸就接管输入"的惊吓）；`?mpwinteract=1|full` 才自动开。 */
		function mpwWebIxAfterMount(frame) {
			try {
				let auto = null;
				try { auto = new URLSearchParams(location.search).get("mpwinteract") } catch {}
				if (auto === "1" || auto === "on") mpwWebIxArm(mpwWebIxMode() === "full" ? "full" : "pointer");
				else mpwWebIxPaint();
			} catch {}
		}
		/** 交互模式是否处于开启（测试钩子/诊断用）。 */
		function mpwWebIxState() {
			try { const a = mpwWebIxApi(); return a ? a.snapshot() : null } catch { return null }
		}

		// ═══ ①(新 2026-09-16 I 项) 网页壁纸 shim 通道：握手 / 属性 / 策略 / 兜底 ═══
		/** 帧内 shim 未按时报到（旧宿主没注入 / 页面 CSP 挡了 inline script）→ 记诊断；
		 *  只兜底重载一次（去掉 mpwshim 标记 → 退回裸 iframe 兼容集），**绝不让壁纸白屏**，
		 *  也绝不影响插件主流程（整段 try/catch，失败即放弃）。 */
		function webShimArm(frame) {
			try {
				if (!frame) return;
				frame.__mpwShimOk = false;
				frame.__mpwShimFellBack = false;
				if (frame.__mpwShimTimer) clearTimeout(frame.__mpwShimTimer);
				frame.__mpwShimTimer = setTimeout(() => {
					try {
						if (frame.__mpwShimOk || frame.__mpwShimFellBack) return;
						frame.__mpwShimFellBack = true;
						const u = String(frame.getAttribute("src") || "");
						mpwWebDiag("shim-missing", { url: u.slice(0, 200) });
						const bare = u.replace(/([?&])mpwshim=1(?:&|$)/, "$1").replace(/[?&]$/, "");
						if (!bare || bare === u) return;
						try { frame.setAttribute("sandbox", MPW_WEB_COMPAT_ATTR); } catch {}
						frame.src = bare;
					} catch {}
				}, MPW_WEB_SHIM_TIMEOUT_MS);
			} catch {}
		}
		/** 帧内 shim 就绪后的接线：属性表（project.json 默认值 + 用户已存的编辑）、
		 *  媒体策略（静音/倍速/暂停）、目录文件（当前壁纸目录内的图片/视频 → slideshow 池）。 */
		function webShimAfterLoad(frame) {
			try {
				if (!frame || !mpwWebShimUrl(frame.getAttribute("src"))) return;
				webShimCall(frame, { op: "ping" });
				webShimPushPolicy(frame);
				webShimPushProps(frame);
			} catch {}
		}
		/** 静音/倍速/暂停 → 帧内（沙箱下父页读不到帧内 DOM，只能这样下达） */
		function webShimPushPolicy(frame) {
			try {
				const s = readSection();
				webShimCall(frame, { op: "policy", muted: s.mute !== void 0 ? !!s.mute : true, speed: typeof s.playbackRate === "number" ? s.playbackRate : 1 });
				webShimCall(frame, { op: "pause", value: !!wallUserPaused });
			} catch {}
		}
		/** 用户属性 + 目录文件池：project.json 的 general.properties（全量默认值）
		 *  + 该壁纸已保存的 propEdits + 目录里的媒体清单（slideshow 的
		 *  `wallpaperRequestRandomFileForProperty` 池）。**一次 fetch 全部下发。** */
		function webShimPushProps(frame) {
			try {
				const info = mpwWebSrcFromUrl(frame && frame.getAttribute("src"));
				if (!info) return;
				const dirBase = HOST_BASE + (info.src === "library"
					? "/library-web/" + encodeURIComponent(info.id) + "/"
					: "/custom-folder/" + encodeURIComponent(info.id) + "/");
				fetch(dirBase + "project.json").then((r) => (r.ok ? r.json() : null)).then((pj) => {
					const wire = mpwWebPropsToWire(pj);
					try {
						const edits = (readSection().propEdits || {})[info.key] || null;
						if (edits) for (const k in edits) if (Object.prototype.hasOwnProperty.call(edits, k)) wire[k] = { value: edits[k] };
					} catch {}
					if (wire && Object.keys(wire).length) {
						webShimCall(frame, { op: "props", props: wire });
						// 官方在挂载时也会下发一次 general 属性；插件不节流网页壁纸帧（浏览器自己驱动 rAF），
						// 这里只给作者一个基准帧率，供其做 delta-time 估算。
						webShimCall(frame, { op: "general", general: { fps: 60 } });
						mpwWebDiag("props", { key: info.key, count: Object.keys(wire).length });
					}
					// 目录文件池：只对 file/directory 类型的属性推（作者按属性名取随机文件）
					const propsDef = pj && pj.general && pj.general.properties;
					if (!propsDef || typeof propsDef !== "object") return;
					const fileProps = Object.keys(propsDef).filter((k) => {
						const t = propsDef[k] && typeof propsDef[k].type === "string" ? propsDef[k].type.toLowerCase() : "";
						return t === "file" || t === "directory";
					});
					if (!fileProps.length) return;
					fetch(dirBase + "__mpw-list.json").then((r) => (r.ok ? r.json() : null)).then((d) => {
						const files = d && Array.isArray(d.files) ? d.files.filter((f) => /\.(png|jpe?g|gif|webp|bmp|mp4|webm)$/i.test(String(f))) : null;
						if (!files || !files.length) return;
						for (const p of fileProps) webShimCall(frame, { op: "directory", prop: p, files });
					}).catch(() => {});
				}).catch(() => {});
			} catch {}
		}
		/** 帧内消息：握手 + 作者脚本错误上报（作者脚本抛错只记日志/诊断，不拖垮插件） */
		try {
			if (!window.__mpwWebShimHook) {
				window.__mpwWebShimHook = 1;
				window.addEventListener("message", (ev) => {
					try {
						const d = ev && ev.data;
						if (!d || typeof d !== "object" || d.mpw !== MPW_WEB_SHIM_MSG) return;
						if (!mpwIsWebFrameMsg(ev)) return;
						const frame = bgElements().frame;
						if (d.op === "ready" || d.op === "pong") {
							if (frame) {
								frame.__mpwShimOk = true;
								if (frame.__mpwShimTimer) { clearTimeout(frame.__mpwShimTimer); frame.__mpwShimTimer = 0; }
							}
							if (d.op === "ready") mpwWebDiag("shim-ready", { v: Number(d.v) || 0, href: String(d.href || "").slice(0, 200) });
							return;
						}
						if (d.op === "error") {
							const info = mpwWebSrcFromUrl(frame && frame.getAttribute("src"));
							try { console.warn("[dsh-mpkg-wallpaper] 网页壁纸脚本错误（已兜住）:", String(d.kind || "error"), String(d.message || ""), String(d.stack || "").split("\n")[1] || ""); } catch {}
							mpwWebDiag("script-error", { kind: String(d.kind || "").slice(0, 40), message: String(d.message || "").slice(0, 300), key: info && info.key });
							return;
						}
					} catch {}
				});
			}
		} catch {}

		/** ③(新) 隐藏 web 壁纸自带的设置面板（L2D 类：右上角「设置」按钮 + 设置面板）。
		 *  壁纸在 iframe 内无法交互（用户实测），自带面板只能看不能点 → 直接隐藏。
		 *  ①(修正4) **只藏 #basetting 和 #setting-button 本身**（内容 + 按钮），
		 *  **绝不沿 DOM 向上藏外层容器**——那是误藏壁纸本体的根源（星野这类 WebGL
		 *  canvas 壁纸：canvas 在 onload 后才创建，containsCanvas 检测不到 → 护栏失效，
		 *  沿祖先向上藏会把壁纸可见容器整个藏掉 → 只剩底色。用户实测修复后仍不显示）。
		 *  藏 #basetting 内容 + 按钮即可，外层就算留个空容器也只是一块透明背景，不挡壁纸。 */
		function hideWebPanel(frame) {
			try {
				const doc = frame && frame.contentDocument;
				if (!doc) return;
				// ①(修正) style 注入幂等：已注入则跳过注入，但**不提前 return**——
				// 同 URL 重入（showWebEl 里 src 未变 → onload 不触发 → observer 不会
				// 经 onload 重挂）时仍需靠这里的 observer 挂载兜底（评审发现的回归）。
				if (!doc.getElementById("mpw-webPanelHide")) {
					const st = doc.createElement("style");
					st.id = "mpw-webPanelHide";
					st.textContent = "#setting-button, #basetting { display: none !important; }";
					doc.head.appendChild(st);
				}
				// ①(修正) 白底容器：只藏 #basetting 时，它的**祖父容器（半透明白底）**还露着
				// （用户实测 scene 后星野显示时屏幕中间一个白底）。沿 DOM 向上藏 2 层，
				// 但用 containsCanvas 护栏——此时 canvas 已创建，护栏能识别含画布的祖先，
				// 绝不误藏壁纸本体（这是之前"误藏整个壁纸"的教训，护栏在 canvas 就绪后可靠）。
				const containsCanvas = (el) => {
					try {
						if (!el) return true;
						if (el.id === "main" || el.id === "app" || el.id === "root" || el.tagName === "BODY" || el.tagName === "HTML") return true;
						return !!(el.querySelector && el.querySelector("canvas, #main"));
					} catch { return true; }
				};
				// 浅藏：只藏 #basetting 与 #setting-button 本身，绝不向上爬。
				// canvas 未就绪时 containsCanvas 护栏不可靠，立即深爬会误藏壁纸本体
				// （修正4 的教训：星野这类 WebGL 壁纸 canvas 在 onload 后才创建）。
				const hidePanel = () => {
					const b = doc.getElementById("basetting");
					if (b) { try { b.style.setProperty("display", "none", "important"); } catch {} }
					const btn = doc.getElementById("setting-button");
					if (btn) { try { btn.style.setProperty("display", "none", "important"); } catch {} }
				};
				// 深藏：仅当 canvas 就绪（护栏可靠）时，沿 DOM 向上藏面板容器链（最多 2 层），
				// 目标是星野这类壁纸的半透明白底容器；含 canvas 的祖先一律不碰。
				const hidePanelDeep = () => {
					const b = doc.getElementById("basetting");
					if (!b) return;
					let el = b.parentElement;
					let d = 0;
					while (el && d < 2) {
						if (containsCanvas(el)) break;
						try { el.style.setProperty("display", "none", "important"); } catch {}
						el = el.parentElement;
						d++;
					}
				};
				hidePanel(); // 立即浅藏（绝对安全）
				// ①(修正) 白底容器延迟深藏：onload 时星野的 canvas 可能还没创建，护栏不可靠。
				// 延迟轮询等 canvas 挂上（护栏可靠）后才藏外层白底容器，最多重试 ~5s。
				try {
					let tries = 0;
					const retryHide = () => {
						tries++;
						const b = doc.getElementById("basetting");
						const canvasReady = !!doc.querySelector("canvas, #main");
						if (b && canvasReady) { hidePanelDeep(); return; }
						if (tries < 20) setTimeout(retryHide, 250);
					};
					setTimeout(retryHide, 300);
				} catch {}
				// 持续保障：壁纸 JS 可能周期性把面板 display 改回，observer 再藏回去。
				// ①(修正) 节流：Live2D 每帧改 class/style 会触发 attributes 观察，若每次
				// 都跑 hidePanel（getElementById + setProperty 强制样式重算）同样占满主线程
				// （web 壁纸下扫描缩略图卡顿的另一个来源）。合并到最多 ~120ms 一次。
				try {
					if (frame.__mpwPanelObs) return;
					let pend = null;
					const obs = new MutationObserver(() => {
						if (pend) return;
						pend = setTimeout(() => { pend = null; try { hidePanel(); } catch {} }, 120);
					});
					obs.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "display", "visibility", "class"] });
					frame.__mpwPanelObs = obs;
				} catch {}
			} catch {}
		}

		// ═══════════════════════════════════════════════════════════════════
		//  场景图层合成渲染（route B v1）：canvas 逐层绘制 + 视差摆动 + 呼吸缩放。
		//  清单来自 host /custom-scene-composite（scene.json 全部 image 图层）。
		// ═══════════════════════════════════════════════════════════════════
		let sceneAnim = null;          // rAF 句柄
		let sceneComposite = null;     // { key, w, h, frameKey, layers:[{url,x,y,w,h,px,py}] }
		let sceneImgs = [];            // 图层 Image 缓存
		let sceneFetching = null;      // 正在进行的清单请求（防重复）
		let sceneResizeHandler = null; // 窗口变化重绘
		let sessionFiles = {};         // ⑧(新) 会话级 File 引用（纯浏览器导入；File 不可序列化进 section）
		function stopSceneAnim() {
			if (sceneAnim) { try { cancelAnimationFrame(sceneAnim); } catch {} sceneAnim = null; }
			if (sceneResizeHandler) { try { window.removeEventListener("resize", sceneResizeHandler); } catch {} sceneResizeHandler = null; }
			sceneImgs = [];
			stopEdgeDraw();
		}
		/** 场景清单 URL（按 key 路由到 custom / library）。 */
		function sceneCompositeUrl(key) {
			if (key && key.indexOf("library|") === 0) return HOST_BASE + "/library-scene-composite?ltoken=" + encodeURIComponent(key.slice(8));
			const name = key && key.indexOf("custom|") === 0 ? key.slice(7) : "";
			return HOST_BASE + "/custom-scene-composite?folder=" + encodeURIComponent(name);
		}
		/** 拉取场景清单并缓存（防并发重复请求）。 */
		function fetchSceneComposite(key) {
			if (sceneComposite && sceneComposite.key === key) return Promise.resolve(sceneComposite);
			if (sceneFetching && sceneFetching.key === key) return sceneFetching.promise;
			const p = fetch(sceneCompositeUrl(key))
				.then((r) => r.json())
				.then((d) => {
					if (d && d.ok && d.layers && d.layers.length) {
						sceneComposite = { key, w: d.w, h: d.h, frameKey: d.frameKey, layers: d.layers };
						return sceneComposite;
					}
					throw new Error("no layers");
				})
				.catch((err) => { sceneFetching = null; throw err; });
			sceneFetching = { key, promise: p };
			p.finally(() => { if (sceneFetching && sceneFetching.key === key) sceneFetching = null; });
			return p;
		}
		/** ①(新) scene 内嵌视频探测（scene-video 快路径）：探测 URL 按 key 路由。
		 *  返回 { has, mime }；网络错误/未找到视为无视频（回退静态帧）。 */
		function sceneVideoCheckUrl(key) {
			if (key && key.indexOf("library|") === 0) return HOST_BASE + "/library-scene-video-check?ltoken=" + encodeURIComponent(key.slice(8));
			const name = key && key.indexOf("custom|") === 0 ? key.slice(7) : "";
			return HOST_BASE + "/custom-scene-video-check?folder=" + encodeURIComponent(name);
		}
		function checkSceneVideo(key) {
			// ①(修正) 探测加 4s 超时：host 端首查需同步读包/落盘（可达 1-3s），
			// 无超时会让"使用"按钮永久挂起（用户实测点击全无反应、后续壁纸也失效）。
			const ac = new AbortController();
			const timer = setTimeout(() => ac.abort(), 4000);
			return fetch(sceneVideoCheckUrl(key), { method: "GET", signal: ac.signal })
				.then((r) => (r.ok ? r.json() : null))
				.then((d) => ({ has: !!(d && d.ok && d.has), mime: (d && d.mime) || "video/mp4" }))
				.catch((e) => {
					try {
						if (e && e.name === "AbortError") console.warn("[dsh-mpkg-wallpaper] scene 视频探测超时(4s)，按无视频回退:", key);
					} catch {}
					return { has: false, mime: "video/mp4" };
				})
				.finally(() => clearTimeout(timer));
		}
		/** ①(新) 应用 scene 壁纸统一入口：优先 scene-video（内嵌 MP4 → video 硬件解码，
		 *  最顺滑）；否则走 mpkg/图层合成/静态帧回退链。key: "library|<ltoken>" 或
		 *  "custom|<folder>"；image 传静态帧标记（sv 替换由 resolveHostUrl 处理）。
		 *  ①(修正) 本函数是**模块级**（applyFromStorage 等模块函数会调用），不能直接引用
		 *  组件内的 commit/setHint/setMpkgMeta——成功路径也交给调用者提供的 applyVideo 回调
		 *  （由组件内调用者注入，持有 commit 闭包）。 */
		// ═══ ①(RE-25 场景集成 2026-09-12) 用我们的 WebGL 渲染器实时渲染 scene 壁纸 ═══
		//   链路：插件宿主 /raw 暴露容器字节（PKGM0018 场景束 / PKGV scene.pkg）
		//        → 渲染器页面 ?pkgurl=<该 url>（浏览器直连带 cookie，过 DSH 鉴权）
		//        → 渲染器 parsePkg 直接吃同族容器（RE-25 证实布局相同）→ 实时渲染。
		//   sceneRendererUrl 可在设置里覆盖（默认本机 8899）。
		// ① 渲染器可达性探测（结果缓存；未知时按可用处理，避免首次使用被误拦）
		const probeSceneRenderer = () => {
			try {
				const base = mpwSceneRendererBase();
				const ctl = new AbortController();
				const tid = setTimeout(() => { try { ctl.abort() } catch {} }, 1500);
				// ①(批次15 B2③) 记住探测前状态：false→true（渲染器进程恢复）时自动重挂场景 iframe
				const prevOk = globalThis.__mpwRendererOk;
				fetch(base, { method: 'GET', signal: ctl.signal, mode: 'no-cors', cache: 'no-store' })
					.then(() => { clearTimeout(tid); globalThis.__mpwRendererOk = true; if (prevOk === false) { try { mpwSceneOnRendererBack(); } catch {} } })
					.catch(() => { clearTimeout(tid); globalThis.__mpwRendererOk = false });
			} catch (e) {}
		};
		// ①(修复 2026-09-13 内存泄漏) 原来每次 apply/重注入都 setInterval 一次 → 30s 定时器越积越多
		//   （多次重连/RTC 重注入后会有 N 个并发探测 + N 份闭包）。用 window 级标记只装一次。
		try {
			probeSceneRenderer();
			if (!window.__mpwSceneProbeTimer) {
				window.__mpwSceneProbeTimer = setInterval(() => {
					try { if (window.__mpwSceneProbeTick) window.__mpwSceneProbeTick(); } catch {}
				}, 30000);
				window.__mpwSceneProbeTick = probeSceneRenderer;
			} else {
				window.__mpwSceneProbeTick = probeSceneRenderer;   // 刷新闭包（配置可能变了）
			}
		} catch {}

		const mpwSceneRendererBase = () => {
			try { const s = readSection(); if (s && s.sceneRendererUrl) return String(s.sceneRendererUrl) } catch {}
			return "http://127.0.0.1:8899/";
		};
		const applySceneViaRenderer = (meta) => {
			// meta: { rawFile, folder, title, key }
			try {
				// ①(2026-09-12 健壮性) 渲染器离线时不要塞空白 iframe：用**缓存的探测结果**决定，
				//   离线则返回 false（调用方回退静态帧 / 内嵌 mp4）。探测在启动与每 30s 各一次。
				if (globalThis.__mpwRendererOk === false) {
					try { fetch(HOST_BASE + '/diag', { method: 'POST', body: JSON.stringify({ kind: 'scene-render', why: 'renderer-offline-skip', at: new Date().toISOString() }) }).catch(() => {}) } catch {}
					return false;
				}
				const q = "custom=1" + (meta.folder ? "&folder=" + encodeURIComponent(meta.folder) : "")
					+ "&file=" + encodeURIComponent(meta.rawFile);
				const rawUrl = location.origin + HOST_BASE + "/raw?" + q;
				const base = mpwSceneRendererBase();
				// ①(预留接口 2026-09-13) 外部扩展钩子入口：设置项 sceneExtUrl（可选）→ iframe 的 extbase
				//   （渲染器侧 /ext 索引 + /ext/<name> 已保留，见 we-scene-demo/EXTENSION-HOOKS.md）
				let extBase = "";
				try { const s = readSection(); if (s && s.sceneExtUrl) extBase = "&extbase=" + encodeURIComponent(String(s.sceneExtUrl)); } catch {}
				// ①(修复 2026-09-12) **不要**在壁纸 URL 里带 `skin0`：它是渲染器的**存在即生效**诊断开关
				//   （demo.html: `skinEnabled = !params.has('skin0')`，见 README-DIAGNOSTICS「蒙皮问题二分」），
				//   一旦带上，GPU 蒙皮被关掉 → mesh 层（主体/眼睛/耳朵/长发 mesh）退化成未蒙皮的整块 quad，
				//   壁纸永远无法与标定/测试所验证的路径一致（用户："渲染还是有问题"）。
				//   蒙皮默认开（PATCHES：默认开启，`?skin0=1` 关闭仅用于二分），壁纸走**与 demo 相同的默认**。
				//   其余两个参数保留：embed=1（隐藏 demo 的调试 UI/日志）、noreport=1（壁纸不刷 /report）。
				// ①(新 2026-09-12) 「场景渲染上报」开启时**不带** noreport → 渲染器自动上报落 reports/，
				//   这样"壁纸里真实看到的画面"才有现场数据（默认关，避免常态磁盘写入）。
				let sceneReport = DEFAULT_SCENE_REPORT;
				try { const s2 = readSection(); sceneReport = s2 && s2.sceneReport !== void 0 ? !!s2.sceneReport : DEFAULT_SCENE_REPORT } catch {}
				// ①(批次15 B3) 「渲染器调试参数」透传：白名单逐个校验（mpwSanitizeSceneDebugParams），
				//   非法键/值一律丢弃，杜绝任意注入（skin0 等二分开关永远不会被带回）。
				let debugQ = "";
				try { const s3 = readSection(); debugQ = mpwSceneDebugQuery(s3 && s3.sceneDebugParams); } catch {}
				// ①(批次15 B5) 低内存设备标记：deviceMemory/hardwareConcurrency 判定 → &lowmem=1
				//   （渲染器侧预算档支持见 TASK-B §5 接口请求；不支持时渲染器忽略未知参数，无害）。
				const lowmem = mpwSceneLowMem();
				// ①(B6) 沙箱计划：strict 需要宿主签发的场景 token —— 拿到才注入
				//   `pkgurl` 追加 &st=（宿主对 Origin:null 的 /raw 强制校验）、iframe URL 追加
				//   &sandbox=strict&thumbtoken=（渲染器据此加 crossOrigin 并把它塞进上报 body）。
				//   拿不到（宿主未重启 404/401、旧宿主）→ 保持 legacy，并在后台取 token 后一次性升级。
				let __sbPlan = { ident: null, mode: "legacy", reason: "skip", token: null };
				let __sbToken = null;
				try {
					const __sbIdent = mpwSceneIdentityFromWebUrl(base + "?pkgurl=" + encodeURIComponent(rawUrl));
					__sbPlan = mpwSandboxPlan(__sbIdent && __sbIdent.ident);
					if (__sbPlan.mode === "strict" && __sbPlan.token) __sbToken = __sbPlan.token;
					__mpwSandboxLast = { ident: __sbPlan.ident, mode: __sbPlan.mode, reason: __sbPlan.reason };
					__mpwSandboxLastMeta = meta;
				} catch (e) { __sbPlan = { ident: null, mode: "legacy", reason: "err", token: null } }
				const rawUrlEff = __sbToken ? rawUrl + "&st=" + encodeURIComponent(__sbToken) : rawUrl;
				const url = base + (base.indexOf("?") >= 0 ? "&" : "?")
					+ "pkgurl=" + encodeURIComponent(rawUrlEff) + "&embed=1" + (sceneReport ? "" : "&noreport=1") + extBase
					+ (lowmem ? "&lowmem=1" : "") + debugQ
					// ①(MERGED-3 1.1) 渲染器首帧 → 宿主缩略图缓存（渲染器离线后列表仍有图）。
					//   demo.html 首帧/第 90 帧各 POST 一次（text/plain 简单请求免预检），失败仅日志。
					//   ①(批次15 B1) 首帧 POST 同时是**首帧看门狗的信标**（宿主 lastpost=1 查询）。
					//   ①(B6) strict 下 token 随 body 走（简单请求，绝不加自定义头：那会触发预检被鉴权墙 401）。
					+ "&thumbpost=" + encodeURIComponent(location.origin + HOST_BASE + "/custom-scene-thumb")
					+ (__sbToken ? "&sandbox=strict&thumbtoken=" + encodeURIComponent(__sbToken) : "");
				if (!__sbToken) { try { mpwSandboxPrefetch(__sbPlan.ident); } catch {} }
				try { const sbd = mpwSandboxDiag(); if (window.__mpwDiagSandboxHook) window.__mpwDiagSandboxHook(sbd) } catch {}
				const display = meta.title || meta.rawFile;
				// ①(批次15 前置修复·P0) 本函数在**工厂层**，而 commit/setHint/setMpkgMeta/hideBusy 是
				//   组件（MpkgSectionImpl）内的标识符 —— 词法不可见，直接引用 = ReferenceError
				//   被下方 catch 吞掉 → return false → **所有场景壁纸静默回退静态帧链**（真机已复现，
				//   见 PLUGIN-BUGS-TRACKER 批次 15）。改走 __mpwSceneUiBridge（组件渲染时注入）；
				//   桥缺席（面板从未打开过）时降级 writeSection + applyFromStorage。
				const newIdentInfo = mpwSceneIdentityFromWebUrl(url);
				const prevWd = __mpwSceneWd;
				// ①(批次15 B1) 同场景"未确认/已兜底"下重应用 → 强制重载渲染器 + 重新计时。
				//  旗标必须在 commit **之前**置位：commit→applyFromStorage→showWebEl 会同步消费它们。
				const needsRetry = !!(prevWd && newIdentInfo && prevWd.ident === newIdentInfo.ident && (!prevWd.confirmed || prevWd.fallback));
				if (needsRetry) { __mpwSceneWdForce = true; __mpwSceneWdBustNext = true; }
				mpwSceneCommit({
					image: "", source: meta.rawFile, mpkgKey: meta.key, mpkgName: display,
					fromMpkg: true, converted: "scene", slot: null,
					sceneKey: "scene|" + rawUrl,
					webUrl: url, info: undefined, timeVideos: undefined, timeConfig: undefined,
					activeSlot: null, propEdits: undefined
				});
				try {
					const b = mpwSceneUi();
					if (b && b.setMpkgMeta) b.setMpkgMeta({ name: display, key: meta.key, info: null, entryName: meta.rawFile, slot: null });
					if (b && b.hideBusy) b.hideBusy();
				} catch {}
				mpwSceneSetHint("场景壁纸已交给渲染器实时渲染：" + display);
				try { fetch(HOST_BASE + "/diag", { method: "POST", body: JSON.stringify({ kind: "scene-render", why: "renderer-iframe", url, rawUrl, lowmem, debug: debugQ || null, sb: { mode: __sbPlan.mode, reason: __sbPlan.reason, token: !!__sbToken }, at: new Date().toISOString() }) }).catch(() => {}) } catch {}
				// ①(批次15 B5②) 场景包体积提示：宿主信标路由返回 pkgBytes（scene.pkg 体积，纹理总量的
				//   插件侧代理指标；渲染器侧 texBytes 精确值经 mpw-health 上报，见 B2）。
				try {
					if (newIdentInfo && __mpwSceneBigPkgHinted !== newIdentInfo.ident) {
						fetch(mpwSceneBeaconUrl(newIdentInfo), { cache: "no-store" })
							.then((r) => (r.ok ? r.json() : null))
							.then((d) => {
								try {
									if (d && d.ok && typeof d.pkgBytes === "number" && d.pkgBytes > 150 * 1024 * 1024) {
										__mpwSceneBigPkgHinted = newIdentInfo.ident;
										mpwSceneSetHint(mpwSceneT("scnRender.bigPkg", "该场景包体积较大（约 " + Math.round(d.pkgBytes / 1048576) + "MB），首帧可能较慢"));
									}
								} catch {}
							})
							.catch(() => {});
					}
				} catch {}
				return true;
			} catch (e) {
				console.error("[dsh-mpkg-wallpaper] scene 渲染器接入失败:", e);
				return false;
			}
		};
		try { if (globalThis.__mpwSceneTest) globalThis.__mpwSceneTest.applyScene = applySceneViaRenderer; } catch {} // ①(批次15) 回归测试入口（函数定义后挂接，避免先有鸡问题）

		const applySceneWallpaper = (opts) => {
			// opts: { key, image, source, mpkgKey, fallback, applyVideo }
			//   fallback(key, image) —— 无内嵌视频 → 原有链（组件内实现）
			//   applyVideo(key, svImage, source) —— 有内嵌视频 → video 播放（组件内实现）
			try {
				const { key, image } = opts;
				// ①(修复) 应用代际=点击序号：最后点击恒胜（内容签名在两次点击都落在
				// 同一壁纸时会误丢弃较新点击——用序号保证先后顺序）
				const __seq = ++__mpwSceneSeq;
				// ①(修正) 用户主动点击触发，无 bgGen 竞态；checkSceneVideo 的 then 回调
				// 里曾误用不存在的 gen 变量 → ReferenceError → fallback 永不执行 →
				// 点击"使用"没反应（用户实测 Girl and Cat 4k MX）。去掉竞态检查，
				// 并给 then 挂 catch 兜底（探测失败按无视频回退原链）。
				checkSceneVideo(key).then((v) => {
					if (__seq !== __mpwSceneSeq) {
						try { console.warn("[dsh-mpkg-wallpaper] scene 探测完成时有更新点击，丢弃迟到应用"); } catch {}
						return;
					}
					if (v.has) {
						// 内嵌视频 → 走 applyVideo（组件内转成 converted:"mp4" + sv=1 标记）
						if (opts.applyVideo) opts.applyVideo(key, image, opts.source);
						else opts.fallback(key, image); // 无 applyVideo（旧调用）→ 保守回退
					} else {
						// 无内嵌视频 → 原有链（mpkg 方式 → 图层合成 → 静态帧）
						opts.fallback(key, image);
					}
				}).catch(() => {
					// 探测网络失败/异常 → 按无视频走原链，避免点击无反应
					if (__seq === __mpwSceneSeq) { try { opts.fallback(key, image); } catch {} }
				});
			} catch (err) { console.error("[dsh-mpkg-wallpaper] 应用场景壁纸失败:", err); try { opts.fallback(opts.key, opts.image); } catch {} }
		};
		/** canvas 精确静态合成：按清单 cover 适配一次性绘制全部图层。
		 *  ①(修正) 移除自造的呼吸/视差摆动动画——那不是源文件里的动画
		 *  （用户实测反感假动画；真实动画需要 WE 运行时重实现，见路线说明）。
		 *  时间帧切换（伊蕾娜白天/夜晚）是真实来源，保留。 */
		function showSceneEl(manifest) {
			const { img, video, frame, canvas, wrap } = bgElements();
			if (!canvas || !wrap) return;
			stopSceneAnim();
			disarmSceneWatchdog(true); // ①(批次15 B1) 切到 canvas 合成壁纸：解除场景看门狗并清兜底视觉
			try { if (window.__mpwLnReset) window.__mpwLnReset(); } catch {} // ①(批次15 B3) 方向键守卫复位
			try { if (video) video.pause(); } catch {}
			wrap.classList.remove("mpw-img", "mpw-video", "mpw-web");
			wrap.classList.add("mpw-scene");
			if (img) img.style.display = "none";
			if (video) video.style.display = "none";
			if (frame) {
				try { disposeWebFrame(frame); } catch {}
				try { frame.removeAttribute("src"); } catch {} frame.style.display = "none";
			}
			canvas.style.display = "";
			const c2 = canvas.getContext("2d");
			if (!c2) return;
			const layers = manifest.layers || [];
			if (!layers.length) return;
			sceneImgs = layers.map(() => null);
			let pending = layers.length;
			const draw = () => {
				const vw = canvas.clientWidth || window.innerWidth || 800;
				const vh = canvas.clientHeight || window.innerHeight || 600;
				if (canvas.width !== vw || canvas.height !== vh) { canvas.width = vw; canvas.height = vh; }
				const scale = Math.max(vw / manifest.w, vh / manifest.h);
				const cx = vw / 2, cy = vh / 2;
				c2.clearRect(0, 0, vw, vh);
				// 图层定位：清单坐标是场景包围盒内偏移（[0,W]×[0,H]），
				// 场景中心 = (W/2, H/2) 对齐屏幕中心。
				const offX = manifest.w / 2, offY = manifest.h / 2;
				for (let i = 0; i < layers.length; i++) {
					const im = sceneImgs[i];
					const l = layers[i];
					if (!im || !im.width || !im.height) continue;
					const w = l.w * scale, h = l.h * scale;
					c2.drawImage(im, cx + (l.x - offX) * scale - w / 2, cy + (l.y - offY) * scale - h / 2, w, h);
				}
			};
			layers.forEach((l, i) => {
				const im = new Image();
				im.crossOrigin = "anonymous";
				im.onload = () => { sceneImgs[i] = im; pending--; if (pending === 0) draw(); };
				im.onerror = () => { pending--; if (pending === 0) draw(); };
				im.src = l.url;
			});
			if (pending === 0) draw();
			// 窗口/屏幕变化重绘（静态合成无 rAF，必须监听 resize）
			if (!sceneResizeHandler) {
				sceneResizeHandler = () => { try { draw(); } catch {} };
				try { window.addEventListener("resize", sceneResizeHandler); } catch {}
			}
		}

		/** ①(修正) 视频壁纸 token 失效自愈：host /custom-mpkg 的 token 旧版本是随机生成的，
		 *  重启后 restoreFiles 用文件名重建 Map → 旧 token 404 → 视频壁纸空白（用户实测多轮：
		 *  重启用加载出来，切回/重试后空白）。此函数按 section.mpkgKey（custommpkg|...）重新
		 *  调 /custom-mpkg 拿新 token，更新 image 后重应用。返回 true 表示已重映射。 */
		async function remapHostVideoToken(section) {
			try {
				const key = section && section.mpkgKey;
				if (typeof key !== "string" || key.indexOf("custommpkg|") !== 0) return false;
				const rest = key.slice("custommpkg|".length);
				// rest 可能是 "<file>"（非 folderMpkg）或 "<folder>/<file>"（folderMpkg）
				let folder = "", file = rest;
				const slash = rest.indexOf("/");
				if (slash >= 0) { folder = rest.slice(0, slash); file = rest.slice(slash + 1); }
				if (!file) return false;
				const q = (folder ? "folder=" + encodeURIComponent(folder) + "&" : "") + "file=" + encodeURIComponent(file);
				const r = await fetch(HOST_BASE + "/custom-mpkg?" + q);
				const d = await r.json();
				if (!(d && d.ok) || !d.selected) return false;
				const sel = d.selected;
				const img = "host:?token=" + encodeURIComponent(d.token) + "&index=" + sel.index + (sel.offset ? "&offset=" + sel.offset : "");
				writeSection(Object.assign({}, readSection(), { image: img, source: sel.name, entryName: sel.entryName || "", converted: sel.isMp4 ? "mp4" : "gif" }), true);
				applyFromStorage();
				try { mpwAutoRefreshAfterApply(); } catch {}
				return true;
			} catch { return false; }
		}

		/** 从 localStorage 状态渲染背景 DOM + 样式。 */
		function applyFromStorage() {
			// ①(2026-09-17 持久化轮) **不静默丢**：上一次选择若没真正落盘，加载时就把原因摆到用户面前
			//   （面板警告 + console.error）。旧写法是 catch 里一句注释"存储满时静默失败"，
			//   用户只看到"刷新后壁纸变回默认"，拿不到任何原因。
			try {
				const s0 = loadSection();
				const pf = s0 && s0[MPW_PERSIST_FAIL_KEY];
				if (pf) {
					mpwPersistEmit("上一次的壁纸设置**没有存下来**（" + String((pf && pf.reason) || "未知")
						+ "）：现在显示的是最后一次成功保存的状态。请清一下浏览器站点数据，或换一张更小的图片。");
				}
			} catch {}
			// ①(修正) 防重入环：applyFromStorage → applyTokenOverrides → overrideTokens →
			// DSH theme/change 重渲染 → 可能重入 applyFromStorage（深色 + 统一雾时尤其
			// 明显，用户实测 web 端卡死/主线程冻结）。加 __mpwApplying 标志，重入直接
			// 跳过，杜绝同步重入环。
			if (window.__mpwApplying) {
				// ①(修复) 重入不丢弃：置 dirty，外层结束后补跑一次（断同步重入环但不丢更新）
				window.__mpwApplyDirty = true;
				return;
			}
			window.__mpwApplying = true;
			window.__mpwApplyDirty = false;
			try {
				applyFromStorageInner();
				// 补跑循环（上限 3 次防极端连环）
				for (let ri = 0; ri < 3 && window.__mpwApplyDirty; ri++) {
					window.__mpwApplyDirty = false;
					applyFromStorageInner();
				}
			} finally {
				window.__mpwApplying = false;
			}
			// ①(2026-09-17 壁纸层可见性轮) 应用后**有界**校验"有源是否真的挂上了"（见下）。
			try { mpwBgSrcHealSchedule(); } catch {}
		}
		/* ═══ ①(2026-09-17 壁纸层可见性轮) "有壁纸源就必须挂上"的兜底校验 ═══
		   为什么需要：`.mpw-bgWrap` 的 `display:none` 只有两种**正常语义**来源——①没有可用壁纸源
		   （buildCss 的 `if (!hasImage)`）；②面板不透明度 100%（`hideBg = hasImage && panel >= 100`）。
		   但还有第三种、最容易被误判成"壁纸层被隐藏"的状态：**层可见、里面却没有画面**（媒体元素没有
		   src / iframe 没有 src）——探针实测的真因是 `showImageEl()` 里那次无条件清 src（已修）。
		   这里再加一道有界兜底：apply 后 1.2s 复核一次，若"有源但没挂上"→ 补挂一次 + 一行 console.warn
		   + 计数 `window.__mpwBgSrcHeal`（同一内容签名只补一次，绝不循环）。
		   `?bgwrapfix=legacy` 时整段跳过（回退到改动前：不校验、只靠调用方）。 */
		let __mpwBgHeal = { sig: "", tries: 0 };
		let __mpwBgHealTimer = 0;
		/** 当前壁纸源对应的媒体是否真的挂上了（按 converted/webUrl 分派，与 show*El 的落点一致）。 */
		function mpwBgArmedNow(section) {
			try {
				const { img, video, frame, canvas, wrap } = bgElements();
				// 壁纸层容器都还没建起来（插件尚未 apply / DOM 被宿主清掉）→ 无从判断，**不补挂**
				// （否则空页面/桩环境里会白补一次；补挂本身有界，但没必要制造无谓动作）。
				if (!wrap) return true;
				if (section.webUrl) return !!(frame && (frame.getAttribute("src") || frame.src));
				if (section.converted === "scene" && section.sceneKey) return !!(canvas && sceneComposite && sceneComposite.key === section.sceneKey);
				if (section.converted === "mp4") return !!(video && (video.getAttribute("src") || video.currentSrc));
				return !!(img && (img.getAttribute("src") || img.currentSrc));
			} catch { return true } // 判定本身出错时**不补挂**（宁可不动，也不制造抖动）
		}
		function mpwBgSrcHealSchedule() {
			if (!mpwBgWrapFixOn()) return;
			if (__mpwBgHealTimer) return; // 已有待复核（apply 很频繁，只留一个）
			try {
				__mpwBgHealTimer = setTimeout(() => {
					__mpwBgHealTimer = 0;
					try { mpwBgSrcHealCheck(); } catch (e) { mpwErr("壁纸源补挂校验", e) }
				}, 1200);
			} catch {}
		}
		function mpwBgSrcHealCheck() {
			const s = normalizeSection(readSection());
			if (!(s.enabled !== void 0 ? !!s.enabled : DEFAULT_ENABLED)) return; // 总开关关：不挂是对的
			if (!(s.image || s.webUrl)) return;                                   // 无源：不挂是对的（正常语义）
			const sig = sectionSigNow();
			if (__mpwBgHeal.sig !== sig) __mpwBgHeal = { sig, tries: 0 };
			if (mpwBgArmedNow(s)) return;
			if (__mpwBgHeal.tries >= 1) {
				// 补挂过一次仍没挂上 → 只报一次，不再重试（避免抖动/循环）
				if (__mpwBgHeal.warned !== true) {
					__mpwBgHeal.warned = true;
					console.warn("[dsh-mpkg-wallpaper] 有壁纸源但补挂仍未生效（媒体元素没有 src）:", sig.slice(0, 80));
				}
				return;
			}
			__mpwBgHeal.tries++;
			try { window.__mpwBgSrcHeal = ((window.__mpwBgSrcHeal || 0) + 1) } catch {}
			console.warn("[dsh-mpkg-wallpaper] 检测到有壁纸源但媒体未挂上 → 补挂一次:", sig.slice(0, 80));
			try { applyFromStorageInner() } catch (e) { mpwErr("壁纸源补挂", e) }
		}
		try { window.__mpwBgWrapState = () => ({ fixOn: mpwBgWrapFixOn(), heal: (() => { try { return window.__mpwBgSrcHeal || 0 } catch { return -1 } })(), last: __mpwBgHeal }) } catch {}
		/* ═══ ①(2026-09-16 根治) 设置归一化：**必须是模块级函数** ═══
		   历史 bug（"标题栏磨砂一直没有效果"的真根因，真机 diag 实锤）：
		     `__asStr` / `normalizeSection` 原本定义在 `applyFromStorageInner()` **函数体内**
		     （旧行号 ~2683/~2696），而 `syncHeaderFrost()` 是**同级模块作用域函数**（~2588），
		     它在第一行就调用 `normalizeSection(readSection())` → 该标识符在模块作用域里
		     根本不存在 → **每次调用都抛 ReferenceError: normalizeSection is not defined**。
		     所有调用点都写成 `try { syncHeaderFrost(); } catch {}`（刻意吞异常，避免样式影响主流程）
		     ⇒ 异常被完全吞掉，表现是"所有磨砂开关 + ?hdrfrost/?hdrblur 参数全部无效"：
		       · 磨砂层从未注入（diag: headerFrost.injected=false）
		       · 诊断理由从未写入（diag: headerFrost.reason=""，因为赋值在抛错点之后）
		     教训：诊断链路上任何"静默 catch"都必须有可观测出口，否则真因只能靠猜。
		   这里把两个纯函数提升到模块作用域（无闭包依赖，仅用 Object/Array），
		   使 `applyFromStorageInner` 与 `syncHeaderFrost` 都能解析到同一个实现。 */
		const __asStr = (v) => {
			if (typeof v === "string") return v;
			if (v === null || v === void 0 || v === true || v === false) return "";
			if (typeof v === "number") return String(v);
			try {
				if (typeof v === "object") {
					if (typeof v.url === "string") return v.url;
					if (typeof v.src === "string") return v.src;
					if (typeof v.value === "string") return v.value;
				}
			} catch {}
			return "";
		};
		const normalizeSection = (s0) => {
			const o = Object.assign({}, s0 || {});
			for (const k of ["image", "webUrl", "source", "mpkgKey", "mpkgName", "entryName", "converted", "slot", "timeConfig"]) {
				if (o[k] !== void 0 && typeof o[k] !== "string") o[k] = __asStr(o[k]);
			}
			if (Array.isArray(o.timeVideos)) o.timeVideos = o.timeVideos.filter((x) => x && typeof x === "object");
			return o;
		};
		/**
		 * ①(2026-09-13 用户："标题栏模糊效果还是没有") 标题栏磨砂**改为真实元素 + 内联样式**。
		 * 为什么不再用 `.wSkVaW_header::before`：
		 *   · 伪元素靠 `position:absolute; z-index:-1` + 祖先是否形成层叠上下文来决定可见性——
		 *     宿主版本/主题一变（header 是否 `position:relative`、祖先是否有不透明背景）就整层被盖住，
		 *     而且它**不可被 devtools 选中、也没有可上报的 computed 值**，只能靠猜；
		 *   · 真实子元素用**内联样式**注入，优先级稳定（不受任何 `!important` 级联与类名漂移影响），
		 *     仍是"不是浮层祖先"的旁系节点 → 不会给浮层制造 backdrop root（历史 bug 不会回归）。
		 * 结构：header 的第一个子节点 <div class="mpw-hdrFrost">，absolutely inset:0、z-index:-1、
		 *       pointer-events:none、backdrop-filter 由设置驱动；header 自身只保留半透明底。
		 * `?hdrblur=pseudo` 回退旧伪元素方案做对照；`?hdrblur=element` 走"本体 backdrop-filter"旧对照。
		 */
		let lastFrostReason = '';   // 诊断用：磨砂为何开/为何关（旧名保留，diag 字段兼容）
		/** ①(2026-09-16 根治) 磨砂状态快照 —— diag 上报用（真机排查的唯一可靠出口）。
		 *  历史问题：`lastFrostReason` 早就存在，但 `syncHeaderFrost()` 第一行就抛
		 *  ReferenceError（normalizeSection 不在模块作用域），异常被 `catch {}` 吞掉 ⇒
		 *  这个变量**从未被写入**，真机 diag 里 `headerFrost.reason` 恒为 ""，导致"为什么没磨砂"
		 *  只能靠猜。现在：无论走哪条分支（含异常分支）都写这一组字段。 */
		const hdrFrostState = {
			injected: false, px: 0, reason: '', translucent: false, mode: 'element',
			hostHasHeader: false, headerBg: '', headerBackdrop: '', frostElBackdrop: '',
			// ①(2026-09-17) 顶栏重挂载自愈观察器的状态（诊断用：hits 增长即证明"是观察器补的，不是 3s 定时"）
			watch: false, watchTargets: 0, watchHits: 0,
		};
		/** 宿主标题栏查找：**优先** DSH 0.1.5 的稳定 hash 类，其次结构类，最后裸 header。
		 *  顺序重要：裸 `header` 会命中页面上任意 header（真机 diag 曾抓到错误节点）。 */
		function findHostHeader() {
			try {
				return document.querySelector(".wSkVaW_header")
					|| document.querySelector('header[class*="_header_"]')
					|| document.querySelector('[class*="wSkVaW_header"]')
					|| document.querySelector("header")
					|| null;
			} catch { return null }
		}
		/* ═══ ①(2026-09-17 真机 bug：在标题栏切换"主会话 ↔ 子代理会话"时磨砂先消失、约 3 秒才回来) ═══
		   真机取证（无头 Firefox + 真页面 http://127.0.0.1:3080/，探针在 /tmp 侧、不进本仓库）：
		     · 相位对齐最坏情况实测恢复 **2996 / 3000 / 3000 ms**；点侧栏切会话实测 **347 / 1696 / 1741 ms**
		       —— 数值分布完全由 3s 低频保险的相位决定（不是"固定 3 秒"，而是"最多 3 秒"）。
		     · 拦截 Node.insertBefore 抓调用栈：补挂磨砂层的唯一路径是
		       `setInterval handler → applyFromStorageInner → syncHeaderFrost → ensureHeaderFrost`
		       ⇒ 层被宿主重建顶栏丢掉之后，**没有任何"结构变化"路径**参与补救，只能等下一次 3s 滴答。
		     · 结构取证：一次会话切换会让 `header.wSkVaW_header`、
		       `[data-slot="conversation.session.header"]`、`.wSkVaW_root` **三个节点同时换成新节点**，
		       而 `[data-slot="main.conversation"]`（及其上溯 [data-slot="main"]）保持同一节点
		       ⇒ 观察点必须是"稳定的会话容器 + 当前顶栏的父节点/自身"，盯住顶栏自己是不够的。
		   修法（最小改动，**不新增任何轮询/网络/依赖**）：在稳定的会话容器与当前顶栏的父节点/自身挂
		   **childList-only** 的 MutationObserver（不开 subtree ⇒ 不跟消息流、不跟滚动、不做每帧工作；
		   真机空闲 3s 实测 0 次回调），命中后去抖 50ms 再 `syncHeaderFrost()`；
		   观察目标节点变了就重挂（顶栏被换 ⇒ 目标也换了）。
		   保留 3s 低频保险作兜底；`?hdrfrostwatch=off` 一键回退到"只有状态变化 + 3s 保险"的旧行为。
		   纪律：关掉磨砂（总开关 / ?hdrfrost=off / headerBg=false / px<=0 / 对照模式）时必须 disconnect，
		   不留任何观察器（回归断言见 tools/frost-rail-test.mjs 的 remount/off 场景）。 */
		/** 观察器状态的 **window 级单例**（与 __mpwHdrFrostGuard / __mpwStyleWatch 同风格）：
		 *  插件可能被宿主按两个 id 各加载一次、apply 也可能重入 ⇒ 绝不允许挂出第二份观察器。 */
		function hdrFrostWatchState() {
			try {
				if (!window.__mpwHdrFrostWatch) {
					window.__mpwHdrFrostWatch = { mo: null, ctor: null, targets: null, queued: false, hits: 0 };
				}
				return window.__mpwHdrFrostWatch;
			} catch { return null }
		}
		/** 回退开关：`?hdrfrostwatch=off` → 退回"只在设置/主题变化 + 3s 保险时同步"的旧行为。 */
		function hdrFrostWatchOff() {
			try { return new URLSearchParams(location.search).get("hdrfrostwatch") === "off" } catch { return false }
		}
		/** 观察目标（顺序固定，供幂等比较）：稳定容器在前，当前顶栏的父节点/自身在后。
		 *  · `[data-slot="main.conversation"]` / `[data-slot="main"]`：真机实测跨会话**不换节点**，
		 *    且 `.wSkVaW_root` 是它的直接子节点 ⇒ 顶栏整块重建会在它身上产生 childList 变更；
		 *  · 顶栏父节点：顶栏自身被换成新节点时命中；
		 *  · 顶栏自身：宿主原地重渲染、把我们的层从子节点列表里挤掉时命中。 */
		function headerFrostWatchTargets() {
			const out = [];
			const add = (n) => { try { if (n && out.indexOf(n) < 0) out.push(n) } catch {} };
			try { add(document.querySelector('[data-slot="main.conversation"]')) } catch {}
			try { add(document.querySelector('[data-slot="main"]')) } catch {}
			const hdr = findHostHeader();
			try { add(hdr && hdr.parentElement) } catch {}
			add(hdr);
			return out;
		}
		function disarmHeaderFrostWatch() {
			const W = hdrFrostWatchState();
			hdrFrostState.watch = false; hdrFrostState.watchTargets = 0;
			if (!W) return;
			if (W.mo) { try { W.mo.disconnect() } catch {} }
			W.mo = null; W.ctor = null; W.targets = null; W.queued = false;
		}
		/** 去抖：连发的结构变更只同步一次。刻意用 50ms 定时而不是 rAF —— 后台标签页的 rAF 会被
		 *  暂停（切回来才补），而"切会话"完全可能发生在后台标签页里；50ms ≪ 一帧感知阈值。 */
		function scheduleHeaderFrostResync() {
			const W = hdrFrostWatchState();
			if (!W || W.queued) return;
			W.queued = true;
			const run = () => {
				W.queued = false;
				W.hits++;
				hdrFrostState.watchHits = W.hits;
				try { syncHeaderFrost(); } catch (e) { mpwErr("syncHeaderFrost(顶栏重挂载观察器)", e); }
			};
			try { setTimeout(run, 50); return } catch {}
			try { if (typeof requestAnimationFrame === "function") requestAnimationFrame(run); else W.queued = false } catch { W.queued = false }
		}
		/** 幂等挂载：目标节点表没变就直接复用（多次 sync 不会堆出第二个观察器）；
		 *  目标变了（顶栏被换）或构造器被换（宿主 HMR / 测试替换 MutationObserver）就重建。 */
		function armHeaderFrostWatch() {
			if (hdrFrostWatchOff()) { disarmHeaderFrostWatch(); return }
			const W = hdrFrostWatchState();
			if (!W) return;
			const MO = (() => { try { return window.MutationObserver || MutationObserver } catch { return null } })();
			if (typeof MO !== "function") return;
			const targets = headerFrostWatchTargets();
			const same = !!W.mo && W.ctor === MO && Array.isArray(W.targets)
				&& W.targets.length === targets.length && W.targets.every((n, i) => n === targets[i]);
			if (same) { hdrFrostState.watch = true; hdrFrostState.watchTargets = targets.length; return }
			try { if (W.mo) W.mo.disconnect() } catch {}
			W.targets = targets;
			if (!targets.length) { W.mo = null; W.ctor = null; hdrFrostState.watch = false; hdrFrostState.watchTargets = 0; return }
			if (!W.mo || W.ctor !== MO) {
				W.mo = new MO((muts) => {
					// 只忽略"仅仅新增了我们自己的磨砂层"这种自触发（否则每次注入都会多同步一次）；
					// 我们的层被移除（宿主重建顶栏时发生）必须算数 —— 那正是本 bug。
					let interesting = false;
					try {
						for (const m of muts) {
							let self = !(m.removedNodes && m.removedNodes.length) && !!(m.addedNodes && m.addedNodes.length);
							if (self) {
								for (const n of Array.from(m.addedNodes)) {
									if (!(n && n.nodeType === 1 && n.classList && n.classList.contains("mpw-hdrFrost"))) { self = false; break }
								}
							}
							if (!self) { interesting = true; break }
						}
					} catch { interesting = true }
					if (interesting) scheduleHeaderFrostResync();
				});
				W.ctor = MO;
			}
			for (const t of targets) { try { W.mo.observe(t, { childList: true }) } catch {} }
			hdrFrostState.watch = true; hdrFrostState.watchTargets = targets.length;
			hdrFrostState.watchHits = W.hits;
		}
		function ensureHeaderFrost(blurPx) {
			try {
				const hdr = findHostHeader();
				if (!hdr) return null;
				let el = null;
				try { el = hdr.querySelector(":scope > .mpw-hdrFrost") } catch { el = null }
				if (!el) {
					el = document.createElement("div");
					el.className = "mpw-hdrFrost";
					// ①(2026-09-16) 自有标记：注入元素必须可被断言/自检识别（回归测试依赖它）
					el.setAttribute("data-mpw-hdr-frost", "1");
					el.setAttribute("aria-hidden", "true");
					// 内联样式：定位/层叠/模糊全在这里，避免任何 CSS 级联问题。
					// ②(2026-09-16 **磨砂看不见的真根因之一**) z-index 只能是 **0**，不能是 -1：
					//   顶栏是 `position:relative` 但**不是层叠上下文**（没有 z-index/isolation/opacity
					//   /transform/filter/backdrop-filter），于是负 z-index 的层**画在父背景之下**，
					//   被 `background-color`（半透明底色/主题色 wash）整片盖住 ⇒ 模糊一点都透不出来。
					//   桌面上用"父底不透明 + 负 z 子层"的浏览器实测（tools/probe-out 对照实验：
					//   父底 #1122ff + 子层 #ff0000，z=-1 采到父底蓝、z=0/auto 采到子层红）定案。
					//   z-index:0 的层叠位置 = 父背景之上、宿主内容之下（宿主子节点由 CSS 抬到 z-index:1，
					//   见 buildUiCss 的 `.mpw-hdrFrost` 规则）⇒ 模糊可见且不挡标题/按钮。
					//   代价：header 因此成为层叠上下文（不是 containing block）—— 与"禁止在 header 上加
					//   backdrop-filter"的纪律不冲突，浮层定位不受影响（见 docs/HEADER-FROST.md 风险节）。
					el.style.cssText = "position:absolute;inset:0;z-index:0;pointer-events:none;border-radius:inherit;";
					hdr.insertBefore(el, hdr.firstChild);
				}
				const bf = blurPx > 0 ? ("blur(" + blurPx + "px) saturate(140%)") : "none";
				el.style.backdropFilter = bf;
				el.style.webkitBackdropFilter = bf;
				// header 需要定位上下文；已有就不覆盖（不改变宿主布局）
				try {
					const cs = getComputedStyle(hdr);
					if (cs.position === "static") hdr.style.position = "relative";
					if (cs.overflow === "hidden") hdr.style.overflow = "visible";   // 否则浮层被裁
				} catch {}
				el.__mpwBlurPx = blurPx;
				// ①(2026-09-16) 标记宿主 header + body：
				//   · header[data-mpw-hdr-frost] → "元素方案已接管"可被 devtools/断言直接看到；
				//   · body[data-mpw-hdr-frost-el] → CSS 用它抑制 ::before 伪元素方案，
				//     避免"元素层 + 伪元素层"两层模糊叠加（30px+30px 会糊成一片）。
				try { hdr.setAttribute("data-mpw-hdr-frost", "el") } catch {}
				try { document.body.setAttribute("data-mpw-hdr-frost-el", "1") } catch {}
				return el;
			} catch (e) {
				// ①(2026-09-16 根治) 注入异常必须可见（写进 reason，下次 diag 就能看到）
				try { lastFrostReason = "注入异常: " + ((e && e.message) || String(e)) } catch {}
				return null;
			}
		}
		/**
		 * 设置变更时同步：模糊半径来自「标题栏磨砂强度」或「整屏虚化程度」。
		 * ①(2026-09-16 第五次反馈"标题栏磨砂还是没有" → 根治) 本轮修的三件事：
		 *   1) 真根因：本函数第一行就调用 `normalizeSection(...)`，而它当时定义在
		 *      `applyFromStorageInner()` 函数体内（不在本函数作用域）→ 每次调用抛
		 *      `ReferenceError: normalizeSection is not defined` → 被 catch 吞掉 ⇒
		 *      磨砂层从未注入、`lastFrostReason` 从未写入（真机 diag: injected=false, reason=""）。
		 *      已把 `__asStr`/`normalizeSection` 提升到模块作用域（见 applyFromStorage 之前的说明）。
		 *   2) 门控语义重排（可预期 + 可回退）：
		 *      · 默认（无参数）→ 有壁纸就给磨砂 + 半透明底；用户显式动过开关 → 尊重显式配置；
		 *      · `?hdrfrost=legacy` → 旧门控 `(headerBlur || unifyTint) && headerBg`（一键回退）；
		 *      · `?hdrfrost=off` → 彻底关闭磨砂链（清层 + 清半透明属性）。
		 *   3) "半透明底 + 磨砂层"必须成对：只注入层 = 模糊被不透明底挡住（历史来回修的真正原因）。
		 *   4) 任何异常都不再静默：写进 `hdrFrostState.reason`，下次诊断上报即可看到。
		 */
		function syncHeaderFrost() {
			const q = (() => { try { return new URLSearchParams(location.search).get("hdrfrost") || "" } catch { return "" } })();
			const hardOff = q === "off";
			const legacyGate = q === "legacy";
			try {
				const s = normalizeSection(readSection());
				const hdrNow = findHostHeader();
				hdrFrostState.hostHasHeader = !!hdrNow;
				// 清理（总开关关闭 / ?hdrfrost=off）：注入层与标记一并撤掉，不留残留
				const cleanup = (why) => {
					try { const cur = document.querySelector(".mpw-hdrFrost"); if (cur) cur.remove() } catch {}
					try { if (hdrNow) { hdrNow.removeAttribute("data-mpw-hdr-translucent"); hdrNow.removeAttribute("data-mpw-hdr-frost"); } } catch {}
					try { document.body.removeAttribute("data-mpw-hdr-frost-el") } catch {}
					// ①(2026-09-17) 磨砂链关闭 ⇒ 自愈观察器必须一起撤掉（不留观察器/不留回调）
					disarmHeaderFrostWatch();
					hdrFrostState.injected = false; hdrFrostState.px = 0; hdrFrostState.translucent = false;
					hdrFrostState.frostElBackdrop = ""; hdrFrostState.reason = why;
					lastFrostReason = why;
				};
				const enabled = s.enabled !== void 0 ? !!s.enabled : DEFAULT_ENABLED;
				if (!enabled) { cleanup("插件总开关关闭"); return; }
				if (hardOff) { cleanup("?hdrfrost=off（磨砂链完全关闭）"); return; }
				const hb = s.headerBlur !== void 0 ? !!s.headerBlur : DEFAULT_HEADER;
				const bg = s.headerBg !== void 0 ? !!s.headerBg : DEFAULT_HEADER_BG;
				const un = s.unifyTint !== void 0 ? !!s.unifyTint : DEFAULT_UNIFY_TINT;
				const own = s.headerFrostOwn !== void 0 ? !!s.headerFrostOwn : DEFAULT_HEADER_FROST_OWN;
				const ownAmt = s.headerFrostAmount !== void 0 ? Number(s.headerFrostAmount) : DEFAULT_HEADER_FROST_AMOUNT;
				const unAmt = s.unifyAmount !== void 0 ? Number(s.unifyAmount) : DEFAULT_UNIFY_AMOUNT;
				const hbAmt = s.headerBlurAmount !== void 0 ? Number(s.headerBlurAmount) : DEFAULT_HEADER_BLUR_AMOUNT;
				// ①(2026-09-14) 用户的预期是**壁纸开着时顶栏就该是磨砂玻璃**，不该要求他先猜对开关。
				// ①(2026-09-16 第五次反馈"标题栏磨砂还是没有" → 语义重排 + 根治)
				//   · 默认（无参数）：有壁纸 → 磨砂（autoFrost）；用户显式动过磨砂/顶栏开关 → 尊重他的选择；
				//   · `?hdrfrost=legacy` → 回到旧门控 `(headerBlur || unifyTint) && headerBg`（回退开关）；
				//   · `?hdrfrost=off`  → 已在上面 return，**彻底关闭**（旧语义只关自动半透明、层照注入 →
				//     层被不透明底挡住 = 用户实测"没效果"，这是必须修掉的语义坑）。
				const explicitFrost = s.headerFrostUserSet === true;
				const wallpaperOn = (() => {
					try {
						if (s.video || s.webUrl || s.image) return true;
						const w = document.getElementById(BG_WRAP_ID);
						if (w && w.style && w.style.display !== "none") return true;
						const im = document.getElementById(BG_IMG_ID);
						return !!(im && im.getAttribute("src"));
					} catch { return false }
				})();
				const autoFrost = !explicitFrost && wallpaperOn;
				const explicitGate = (hb || un) && bg;      // 旧门控（legacy / 用户显式配置时使用）
				const wanted = legacyGate
					? explicitGate
					: (explicitFrost ? explicitGate : (wallpaperOn || hb || un));
				// 半径下限：过去在"没填强度"时会算成 0（=看不到模糊）。现在给可见下限（磨砂 24px、统一虚化取下限 12px）。
				const px = !wanted ? 0 : (own ? Math.max(8, ownAmt) : (un ? Math.max(12, unAmt || 0) : Math.max(12, hbAmt > 0 ? Math.round(hbAmt / 4) : 24)));
				// 自动半透明底：让模糊真的看得见（否则顶栏是不透明的，磨砂被挡在后面）。
				// ①(2026-09-16) 半透底色改用**我们自己的命名空间 token**（--mpw-hdr-frost-bg），
				//   不再依赖宿主静态色 token；亮/暗两档由 JS 写入（见下）。
				try {
					if (hdrNow) {
						if (wanted) {
							hdrNow.setAttribute("data-mpw-hdr-translucent", "");
							try {
								const dark = !!(document.body && document.body.hasAttribute && document.body.hasAttribute("data-ds-dark-theme"));
								document.documentElement.style.setProperty("--mpw-hdr-frost-bg", dark ? "rgba(18,22,30,0.45)" : "rgba(255,255,255,0.38)");
							} catch {}
						} else {
							hdrNow.removeAttribute("data-mpw-hdr-translucent");
						}
					}
				} catch {}
				const pxWhy = own ? ("独立强度 " + px + "px") : (un ? ("跟随整屏虚化 " + px + "px") : ("标题栏磨砂强度 " + px + "px"));
				// ②(2026-09-16) 与描边删除配套的一致性修正：headerBg=false 是用户明确要的
				//   "顶栏不透明（不透出壁纸）"，此时**不该**留一层无意义的模糊层 —— 它要么什么也
				//   透不出来（底色不透明），要么反而把壁纸透出来（与用户选择相反）。
				if (!bg) {
					cleanup("headerBg=false（顶栏不透明）⇒ 不注入磨砂层（描边与底色均交还宿主）"
						+ (legacyGate ? "｜legacy 门控" : ""));
					return;
				}
				lastFrostReason = wanted
					? ((explicitFrost ? "用户显式配置" : (autoFrost ? "壁纸在显示且未显式配过磨砂→默认磨砂" : "相关开关开启"))
						+ "｜半透明底已设｜" + pxWhy + (legacyGate ? "｜legacy 门控" : ""))
					: (legacyGate ? "legacy 门控未满足（headerBlur/unifyTint 与 headerBg 需同时开）"
						: "用户显式关闭（headerBg/headerBlur 组合不满足）");
				const mode = new URLSearchParams(location.search).get("hdrblur") || "";
				hdrFrostState.mode = mode || "child";
				if (mode === "pseudo" || mode === "element") {
					// 对照模式：保留旧路径（伪元素 / 本体），并撤掉注入元素
					const cur = document.querySelector(".mpw-hdrFrost");
					if (cur) { try { cur.remove() } catch {} }
					try { document.body.removeAttribute("data-mpw-hdr-frost-el") } catch {}
					try { hdrNow.removeAttribute("data-mpw-hdr-frost") } catch {}
					// ①(2026-09-17) 对照模式下我们不再注入元素层 ⇒ 自愈观察器一并撤掉
					disarmHeaderFrostWatch();
					hdrFrostState.injected = false; hdrFrostState.px = 0;
					hdrFrostState.reason = "?hdrblur=" + mode + "（对照模式：走宿主伪元素/本体）";
					lastFrostReason = hdrFrostState.reason;
					return;
				}
				// ①(2026-09-16) **wanted=false / px<=0 时必须清理，不能只注入一个 blur:none 的空层**：
				//   空层会顺带给 body 打上 data-mpw-hdr-frost-el → 抑制伪元素兜底 ⇒ 反而彻底没磨砂。
				//   （回归断言 tools/frost-rail-test.mjs 的 legacy-off / no-wallpaper 场景就是这一条。）
				if (!wanted || px <= 0) {
					cleanup(lastFrostReason || "本次配置不需要磨砂（已清理注入层）");
					return;
				}
				const el = ensureHeaderFrost(px);
				hdrFrostState.injected = !!el;
				hdrFrostState.px = el ? px : 0;
				hdrFrostState.translucent = !!(hdrNow && hdrNow.hasAttribute && hdrNow.hasAttribute("data-mpw-hdr-translucent"));
				// computed 实测值：真机诊断用它判定"到底卡在哪一环"（底色不透明 / backdrop 未生效 / 层不存在）
				try {
					if (hdrNow) {
						const cs = getComputedStyle(hdrNow);
						const cbg = (cs && (cs.backgroundColor || (cs.getPropertyValue && cs.getPropertyValue("background-color")))) || "";
						hdrFrostState.headerBg = String(cbg).slice(0, 60);
						const hbdf = cs && cs.backdropFilter;
						hdrFrostState.headerBackdrop = hbdf && hbdf !== "none" ? String(hbdf).slice(0, 40) : "none";
					}
					if (el) {
						const ecs = getComputedStyle(el);
						const ebdf = ecs && ecs.backdropFilter;
						hdrFrostState.frostElBackdrop = ebdf && ebdf !== "none" ? String(ebdf).slice(0, 40) : "none";
					} else hdrFrostState.frostElBackdrop = "";
				} catch {}
				hdrFrostState.reason = el ? lastFrostReason : (lastFrostReason || "注入失败（未找到宿主标题栏？）");
				// ①(2026-09-17 切会话磨砂消失 bug) 注入成功后挂"顶栏重挂载自愈"观察器：
				//   即使此刻还没找到宿主顶栏（页面刚起、会话还没渲染）也照样挂 —— 目标里含稳定的
				//   会话容器，顶栏一出现就会触发一次补同步（顺带修掉"启动后磨砂要等 3s 才出现"）。
				try { armHeaderFrostWatch(); } catch (e) { mpwErr("armHeaderFrostWatch", e); }
			} catch (e) {
				// ①(2026-09-16 根治) **再也不静默**：本次修复前这里吞掉了
				// `ReferenceError: normalizeSection is not defined`，导致"磨砂一直没效果"查不出来。
				// 现在任何异常都会写进 reason + 下次 diag 上报。
				hdrFrostState.reason = "sync 异常: " + ((e && e.message) || String(e));
				hdrFrostState.injected = false;
				lastFrostReason = hdrFrostState.reason;
			}
		}
		function applyFromStorageInner() {
			bgGen++;
			// ①(2026-09-13) 标题栏磨砂：注入/刷新真实磨砂层（设置一变立即生效）
			try { syncHeaderFrost(); } catch (e) { mpwErr("syncHeaderFrost(apply)", e); }
			try {
				if (!window.__mpwHdrFrostGuard) {
					window.__mpwHdrFrostGuard = setInterval(() => { try { syncHeaderFrost(); } catch (e) { mpwErr("syncHeaderFrost(3s 定时)", e); } }, 3000);
				}
			} catch {}
			const gen = bgGen;
			// ①(修复) 镜像=内容签名（不是 gen 号）：bgGen 与镜像在同一同步块内赋值，
			// 用 gen 号比较恒等失效。签名变了=壁纸已切换 → 各异步回调正确自弃
			try { window.__mpwCtxSig = sectionSigNow(); } catch {}
			// ⑭ backdrop-filter 支持：用 CSS.supports 判断即可（用户实测 Via/Firefox 都支持）。
			// 之前用"屏幕外测试元素 + getComputedStyle"检测会误判 false（屏幕外/透明
			// 元素 computed backdropFilter 可能为空），导致 blur 被跳过只剩半透明=白纱。
			try {
				window.__mpwBackdropRendered = !!(typeof CSS !== "undefined" && !!CSS.supports && CSS.supports("backdrop-filter", "blur(1px)"));
			} catch { window.__mpwBackdropRendered = true; }
			// ①(2026-09-12 根因修复) **字符串字段归一化**：持久化状态里 image 可能是布尔/对象
			//   （实测 section.image === true）。旧代码 `const image = section.image || ""` 之后
			//   直接做 image.indexOf/startsWith 等字符串操作 → TypeError 被本函数 try/catch 吞掉
			//   → 插件 apply 中断、设置面板整块空白（Firefox 无壁纸状态因为 image="" 才正常）。
			//   这里把所有约定为字符串的字段强制转成字符串（非字符串 → ""，同时保留可用 URL 形式）。
			// ①(2026-09-16 根治) `__asStr`/`normalizeSection` 已**提升到模块作用域**
			//   （见 applyFromStorage 之前的定义 + 那里的 ReferenceError 说明）——
			//   原先定义在这里（函数体内），导致 syncHeaderFrost 无法解析 → 磨砂链全灭。
			//   本函数内继续直接使用这两个模块级函数，行为不变。
			// ①(2026-09-12) 误重置自愈：上一版曾把设置改成 {enabled:true}（用户实测被清空）。
			//   若发现"只有 enabled"这种被重置特征且本地存在备份 mpw_settings_backup → 静默还原。
			try {
				const cur = readSection();
				const looksReset = cur && cur.enabled !== void 0 && cur.float === void 0 && cur.unifyTint === void 0 && cur.sidebarAlpha === void 0;
				const bak = localStorage.getItem('mpw_settings_backup');
				if (looksReset && bak) {
					const parsed = JSON.parse(bak);
					if (parsed && typeof parsed === 'object' && (parsed.sidebarAlpha !== void 0 || parsed.unifyTint !== void 0 || parsed.float !== void 0)) {
						writeSection(Object.assign({}, parsed, { enabled: cur.enabled !== false }), true);
						console.warn('[dsh-mpkg-wallpaper] 检测到设置被误重置 → 已从 mpw_settings_backup 还原');
					}
				}
			} catch {}
			const sectionRaw = normalizeSection(readSection());
			const enabled = sectionRaw.enabled !== void 0 ? !!sectionRaw.enabled : DEFAULT_ENABLED;
			// ④ 总开关关闭 → 视为无背景（恢复默认外观）
			const section = enabled ? sectionRaw : Object.assign({}, sectionRaw, { image: "" });
			const { img, video, wrap } = bgElements();
			if (!img || !video || !wrap) return;
			const image = section.image || "";
			// ①(新) 网页壁纸：webUrl 优先（iframe 全屏），与 image 互斥。
			// ①(修正) 放宽门控：只要 webUrl 存在就优先显示 web。并在 return 前刷新 buildCss——
			// web 壁纸 image 为 ""，buildCss 需按 webUrl 生成可见规则（否则 .mpw-bgWrap{display:none}
			// 把 iframe 整个藏掉 → 清后导入星野完全空白）。
			if (section.webUrl) {
				if (enabled) {
					try { showWebEl(resolveHostUrl(section.webUrl)); } catch (e) { mpwErr("showWebEl(挂载 web 壁纸)", e); }
				} else {
					try { const f = bgElements().frame; if (f) f.style.display = "none"; } catch {}
				}
				// ①(修正) 刷新 buildCss（hasImage 已含 webUrl）→ .mpw-bgWrap.mpw-web iframe 可见
				try { const se = getStyleEl(); if (se) se.textContent = buildCss(section); } catch (err) { mpwErr("buildCss(web 路径)", err); }
				// ①(修复) webUrl 早退不再跳过共享刷新（否则开关时钟/Aqua/玻璃/省电在
				// web 壁纸期间不生效；总开关关闭时 token 残留半透明）
				try { refreshAqua(); } catch {}
				try { refreshRailInk(); } catch {}   // ①(2026-09-16 bug①) web 壁纸路径也要算 rail 对比色
				try { if (aquaOn(section)) scheduleAquaTint(); } catch {}
				// ①(修复) theme/accent 门控与常规路径一致（总开关关闭时清除着色残留）
				try {
					const tc2 = enabled && section.themeColor || "";
					if (tc2 && /^#[0-9a-fA-F]{6}$/.test(tc2)) {
						document.body.setAttribute("data-mpw-theme", "");
						document.documentElement.style.setProperty("--mpw-theme-color", tc2);
					} else {
						document.body.removeAttribute("data-mpw-theme");
						document.documentElement.style.removeProperty("--mpw-theme-color");
					}
					const ac2 = enabled && section.accent || "";
					if (ac2 && /^#[0-9a-fA-F]{6}$/.test(ac2)) {
						document.body.setAttribute("data-mpw-accent", "");
						document.documentElement.style.setProperty("--mpw-accent-color", ac2);
					} else {
						document.body.removeAttribute("data-mpw-accent");
						document.documentElement.style.removeProperty("--mpw-accent-color");
					}
				} catch {}
			try { applyCompatBridges(section); startCompatObserver(); } catch {}
			try { applyFrostInline(section); startFrostObserver(); } catch {}
				try { applyTokenOverrides(pluginCtx, section); } catch (e) { mpwErr("applyTokenOverrides", e); }
				try { applyDialogInline(section); } catch (e) { mpwErr("applyDialogInline(web)", e); }
				try { updateClock(); } catch (e) { mpwErr("updateClock(web)", e); }
				try { applyLiquidGlass(section); } catch (e) { mpwErr("applyLiquidGlass(web)", e); }
				try { updatePowerPause(); } catch (e) { mpwErr("updatePowerPause(web)", e); }
				return;
			}
			// ①(新) 场景图层合成（route B v1）：converted==="scene" 且有 sceneKey →
			// 拉清单 → canvas 动态渲染；清单未就绪时先用静态帧兜底（image 标记）。
			if (section.converted === "scene" && section.sceneKey) {
				if (enabled && sceneComposite && sceneComposite.key === section.sceneKey) {
					try { showSceneEl(sceneComposite); return; } catch {}
				}
				// 清单未缓存 → 异步拉取（成功后重新 apply）；期间走 image 静态帧
				if (enabled) {
					try {
						fetchSceneComposite(section.sceneKey).then(() => {
							const s2 = readSection();
							// s2.sceneKey 比对已防"换壁纸后旧合成回来覆盖"；去掉 gen 陈旧守卫
							if (s2.converted === "scene" && s2.sceneKey === section.sceneKey) applyFromStorage();
						}).catch(() => {});
					} catch {}
				}
			}
			if (typeof image === "string" && image.indexOf("host:") === 0) {
				// ①(新) hybrid 模式：media URL（HTTP Range 流式），不经 IndexedDB。
				// ①(修正) 统一走 resolveHostUrl（folder= 子文件夹、ltoken= 本地库、
				// custom= 自定义目录、mpkg token 都在这里分流）——之前内联旧逻辑
				// 不认识 folder= → 自定义目录的视频/场景点击"使用"后 404 空白。
				const hostUrl0 = resolveHostUrl(image);
				// ⑩(新) 刷新壁纸：追加 &_t=<tick> 击穿浏览器缓存（img/video 重新拉取）
				const hostUrl = hostBustTick ? bustUrl(hostUrl0, hostBustTick) : hostUrl0;
				console.log("[dsh-mpkg-wallpaper] hybrid 背景:", section.converted, hostUrl);
				if (section.converted === "mp4") {
					// ⑳(新) 解码帧率上限 + 分辨率上限 → 走宿主端转码（ffmpeg 抽帧/缩放），
					// 降低浏览器解码/GPU 占用。URL 传原始 image 串，host 还原源后转码；
					// 转码失败（502/404）由下方 error 兜底回退原片。
					// ①(新) scene-video（sv=1 内嵌视频）：作者已优化的 MP4，直接硬件解码，
					// **不走转码**（host resolveTranscodeByImage 不识别 sv=1，会 404 黑屏）。
					const isSceneVideo = typeof image === "string" && image.indexOf("sv=1") >= 0;
					const fpsCapN = section.fpsCap !== void 0 && section.fpsCap !== null ? Number(section.fpsCap) : 0;
					const resMaxN = section.resMax !== void 0 && section.resMax !== null ? Number(section.resMax) : 0;
					const useTranscode = !isSceneVideo && (fpsCapN > 0 || resMaxN > 0) && typeof image === "string" && image.indexOf("host:") === 0;
					// ①(修正) 只设分辨率上限(resMaxN>0)但没设帧率上限(fpsCapN=0)时, fps 不能用 0——
					// host /transcode 校验 !fps 直接 400, 导致 resMax 设置后视频无法播放(用户实测:
					// resMax 被设成 2K 后视频不加载)。resMax 单独转码时给默认 fps=30(抽帧), 
					// 避免 400 拒绝; 真 fpsCap 设置仍用其值。
					const transcodeFps = ALLOWED_FPS.includes(fpsCapN) ? fpsCapN : (resMaxN > 0 ? 30 : 0);
					// ⓪(2026-09-17 用户第 1 条) `?mpwtranscode=aggressive`：**连用户设置的上限**
					//  也先探测——判得出浏览器可直读就直接播原片，不转码（用户只想要"别乱转"时用）。
					//  只在"要转码"时才多发一次 /probe（它只读元数据、不起 ffmpeg，几十毫秒）。
					const transcodeWhy = "用户设置：解码帧率上限 " + (fpsCapN > 0 ? fpsCapN : "无限制")
						+ " / 分辨率上限 " + (resMaxN > 0 ? resMaxN + "px" : "无限制")
						+ " → 转码到 " + transcodeFps + "fps" + (resMaxN > 0 ? " / 宽 " + resMaxN + "px" : "");
					const playUrl = useTranscode
						? HOST_BASE + "/transcode?src=" + encodeURIComponent(image)
							+ "&fps=" + transcodeFps
							+ (resMaxN > 0 ? "&maxW=" + resMaxN : "")
						: hostUrl;
					if (useTranscode) {
						// ⓪(2026-09-17) 不再静默：把"为什么转码 / 转成什么规格"写进日志与状态，
						//  并标明这次是**复用缓存**还是**要现转**（复用不重转，命中判据 =
						//  host 的 tc_<sha256(srcId|mtime|fps|maxW)>.mp4 同名产物已存在）。
						console.log("[dsh-mpkg-wallpaper] 转码播放（" + transcodeWhy + "）:", playUrl);
						mpwWallpaperStateSet("transcode", transcodeWhy);
						try { mpwProbeTranscodeCache(image, transcodeFps, resMaxN); } catch {}
					} else {
						// 直读（没设任何上限 / scene 内嵌视频）：也留一行，便于和"转码"对照排查
						mpwWallpaperStateSet("direct", isSceneVideo ? "scene 内嵌视频（作者已优化，不走转码）" : "未设帧率/分辨率上限 → 直读原片");
					}
					// ⓪(2026-09-17) aggressive 档：要转码时先探测，可直读 ⇒ 就地改成直读原片
					//  （异步：探测回来后若期间已换了壁纸，用 sectionSig 丢弃过期结果）。
					if (useTranscode && !isSceneVideo && mpwTranscodeGateMode() === "aggressive") {
						const probeSig = sectionSigNow();
						fetch(mpwProbeUrl(image)).then((r) => (r.ok ? r.json() : null)).then((j) => {
							try {
								if (window.__mpwCtxSig !== probeSig || sectionSigNow() !== probeSig) return; // 已换壁纸 → 丢弃
								const verdict = j && j.verdict;
								if (!verdict || verdict.playable !== true) return;
								const vid2 = bgElements().video;
								if (!vid2) return;
								console.warn("[dsh-mpkg-wallpaper] aggressive：探测判定可直读 → 放弃转码，直读原片（" + verdict.reason + "）");
								mpwWallpaperStateSet("direct", "aggressive 探测命中：" + verdict.reason);
								try { setHint(t("transcode.directRetry")); } catch {}
								vid2.removeAttribute("src");
								vid2.src = hostUrl;
								vid2.load();
								try { if (!(wallUserPaused || powPaused)) { const pp = vid2.play(); if (pp && pp.catch) pp.catch(() => {}); } } catch {}
							} catch {}
						}).catch(() => {});
					}
					// ①(新) 转码进度条：设了 fpsCap/resMax 且走 /transcode 时轮询 host 进度
					//（防重复启动：同一播放 URL 只起一个轮询；canplay 后收起由轮询 done 处理）
					if (useTranscode && typeof pollTranscodeProgress === "function") {
						const pollKey = "tc:" + String(image).slice(0, 60) + ":" + transcodeFps + ":" + resMaxN;
						if (window.__mpwTcPollKey !== pollKey) {
							window.__mpwTcPollKey = pollKey;
							try { pollTranscodeProgress(image, transcodeFps, resMaxN); } catch {}
						}
					}
					// ①(修正) 重启竞态兜底：video 也要 404 重试（否则 host 晚就绪 → 视频壁纸永久空白）
					const vid = bgElements().video;
					// ①(修正) 监听守卫：原 `!vid.__mpwHostRetryVideo` 在 error 发生前恒为 falsy
					// → 每次 applyFromStorage 都 addEventListener("error") 累积监听器（拖滑块
					// 100 次 = 100 个闭包空转）。改用独立布尔 __mpwErrWired，只加一次。
					if (vid && !vid.__mpwErrWired) {
						vid.__mpwErrWired = true;
						vid.__mpwHostTries = 0;
						vid.__mpwAutoTranscoded = false; // ①(新) 编码不支持 → 自动转码降级（只做一次）
						// ①(修复) 每次 apply 刷新 ctx：监听器只读共享元素上的当前上下文，
						// 避免用首次挂载时捕获的 URL 常量处理后续壁纸
						try { vid.__mpwCtx = { image: image, hostUrl: hostUrl, useTranscode: useTranscode, isSceneVideo: !!isSceneVideo }; } catch {}
						vid.addEventListener("error", () => {
							// ①(修复) 共享 video 元素：错误只属于当前 src；动作参数一律取
							// vid.__mpwCtx（当前 apply 的 image/hostUrl/useTranscode），
							// 不再引用首次挂载闭包的常量；过期概念由 __mpwCtxSig 签名承担
							const __ctx = vid.__mpwCtx || {};
							const image = __ctx.image;
							const hostUrl = __ctx.hostUrl;
							const useTranscode = !!__ctx.useTranscode;
							const isSceneVideo = !!__ctx.isSceneVideo;
							// ①(修正) 诊断：区分 404(网络) vs 解码失败 vs 编码不支持——
							// Firefox/Edge 空白但 Via 正常时，用于判断是 host 请求问题还是
							// HEVC 等编码不支持（error.code: 2=网络/404, 3=解码失败, 4=编码不支持）
							try {
								console.warn("[dsh-mpkg-wallpaper] video error: code=" + (vid.error && vid.error.code) + " src=" + String(vid.currentSrc || vid.src).slice(0, 160));
							} catch {}
							// ①(新) 编码不支持自动转码：error.code 3(解码失败)/4(编码不支持) 且
							// 当前**没走转码** → 自动切 /transcode?fps=24 重试（host ffmpeg 转 H.264，
							// Firefox 实测转码后能播）。只自动降级一次，避免转码也失败时死循环。
							const errCode = vid.error && vid.error.code;
							// ①(修正) 转码失败回退原片：已走 /transcode(useTranscode, resMax/fpsCap 设了)
							// 但转码 502/失败(如 ffmpeg 缺失/源不超限被转坏) → 切回原片 hostUrl 播放,
							// 避免「设了分辨率/帧率上限就黑屏」(用户实测: resMax=2K/1080p 源必黑)。
							// 只回退一次, 防止回退后仍失败死循环。
							if (useTranscode && !vid.__mpwTransFallback && hostUrl) {
								vid.__mpwTransFallback = true;
								try {
									console.warn("[dsh-mpkg-wallpaper] 转码失败 → 回退原片播放", String(hostUrl).slice(0, 100));
									try { setHint(t("transcode.fallback")); } catch {}
									vid.removeAttribute("src");
									vid.src = hostUrl;
									vid.load();
									try { if (!(wallUserPaused || powPaused)) { const pp = vid.play(); if (pp && pp.catch) pp.catch(() => {}); } } catch {}
								} catch {}
								return;
							}
							// ①(新) scene-video 编码不支持（errCode 3/4）→ 回退静态帧（去掉 sv=1）
							if (isSceneVideo && !vid.__mpwSvFallback && (errCode === 3 || errCode === 4)) {
								vid.__mpwSvFallback = true;
								try {
									console.warn("[dsh-mpkg-wallpaper] scene 内嵌视频无法解码 → 回退静态帧");
									const frameImg = String(image).replace(/&sv=1/, "").replace(/sv=1&/, "");
									vid.removeAttribute("src");
									vid.src = resolveHostUrl(frameImg);
									vid.load();
									try { if (!(wallUserPaused || powPaused)) { const pp = vid.play(); if (pp && pp.catch) pp.catch(() => {}); } } catch {}
								} catch {}
								return;
							}
							// ⓪(2026-09-17 用户第 1 条「我没用转码，ffmpeg 为什么在后台转我正在放的壁纸」)
							//  **可播性闸门**：`code 3/4` 只说明"这一帧解不出来"，**不等于"浏览器不支持这编码"**
							//  （4K60 硬解被回收 / 内存压力 / GPU 解码器忙 / Range 抖动都会给 3/4）。
							//  旧实现一律自动降级 `/transcode?fps=24` ⇒ 用户实测：H.264 High + AAC 的 MP4
							//  （浏览器 100% 能直读、fpsCap=0/resMax=0 什么都没设）被重编码成 4K24，
							//  常驻一个 `-threads 1` 的 ffmpeg（RSS ≈ 690MB）跑十几分钟。
							//  现在先问 host `/probe`（只读元数据、不起 ffmpeg）：
							//    playable=true  → **不转码**，原片重试一次 + 明确告知（不再静默烧 690MB）；
							//    playable=false → 编码确实吃不下，才走转码（此时转码有意义）；
							//    null/请求失败 → 探测不出来，保留旧的自动降级（不因闸门本身误伤）。
							//  回退开关：`?mpwtranscode=legacy` = 完全回到旧行为（不看探测、一律转码）。
							if ((errCode === 3 || errCode === 4) && !useTranscode && !vid.__mpwAutoTranscoded) {
								vid.__mpwAutoTranscoded = true;
								const tcMode = mpwTranscodeGateMode();
								const tcUrl = HOST_BASE + "/transcode?src=" + encodeURIComponent(image) + "&fps=24";
								const goTranscode = (why) => {
									try {
										console.log("[dsh-mpkg-wallpaper] 编码不支持 → 自动转码播放（" + why + "）:", tcUrl);
										mpwWallpaperStateSet("transcode", why);
										vid.removeAttribute("src");
										vid.src = tcUrl;
										vid.load();
										// ①(修正) 暂停门控：自动转码重试也尊重暂停，否则用户暂停后
										// 编码报错自动切转码会重播（绕过 showVideoEl 的门控）。
										try { if (!(wallUserPaused || powPaused)) { const pp = vid.play(); if (pp && pp.catch) pp.catch(() => {}); } } catch {}
									} catch {}
								};
								// 旧行为（回退开关）
								if (tcMode === "legacy") { goTranscode("?mpwtranscode=legacy 回退：不看探测"); return; }
								// 可直读 → 原片重试一次（只重试一次，防死循环）
								const retryDirect = (why) => {
									try {
										vid.__mpwDirectRetry = (vid.__mpwDirectRetry || 0) + 1;
										if (vid.__mpwDirectRetry > 1) {
											console.warn("[dsh-mpkg-wallpaper] 可直读源二次解码失败 → 停止重试（不再自动转码）: " + why);
											return;
										}
										console.warn("[dsh-mpkg-wallpaper] 探测判定浏览器可直读 → **不转码**，原片重试: " + why);
										mpwWallpaperStateSet("direct", why);
										try { setHint(t("transcode.directRetry")); } catch {}
										const cur = vid.src;
										vid.removeAttribute("src");
										vid.src = cur;
										vid.load();
										try { if (!(wallUserPaused || powPaused)) { const pp = vid.play(); if (pp && pp.catch) pp.catch(() => {}); } } catch {}
									} catch {}
								};
								try {
									fetch(mpwProbeUrl(image)).then((r) => (r.ok ? r.json() : null)).then((j) => {
										try {
											const verdict = j && j.verdict;
											const info = j && j.info;
											const tag = info ? (info.video + (info.audio ? "+" + info.audio : "") + " " + (info.width || "?") + "x" + (info.height || "?") + "@" + (info.fps || "?")) : "?";
											if (verdict && verdict.playable === true) retryDirect(verdict.reason + " [" + tag + "]");
											else goTranscode((verdict && verdict.reason) ? verdict.reason : "探测失败（无 ffprobe / 读不到元数据）");
										} catch { goTranscode("探测结果解析失败"); }
									}).catch(() => { goTranscode("探测请求失败"); });
								} catch { goTranscode("探测请求构造失败"); }
								return;
							}
							if ((vid.__mpwHostTries || 0) >= 5) {
								vid.__mpwHostTries = 0;
								// ①(修正) 重试 5 次仍 404 → token 可能失效（旧随机 token 重启后不匹配
								// restoreFiles 文件名 token）→ 按 mpkgKey 重新解析拿新 token 自愈
								try { remapHostVideoToken(readSection()); } catch {}
								return;
							}
							vid.__mpwHostTries = (vid.__mpwHostTries || 0) + 1;
							vid.__mpwHostRetryVideo = setTimeout(() => {
								if (window.__mpwCtxSig !== sectionSigNow()) return;
								console.log("[dsh-mpkg-wallpaper] host video 404 → 重试", vid.__mpwHostTries);
								const cur = vid.src;
								vid.removeAttribute("src");
								vid.src = cur;
								vid.load();
								// ①(修正) 暂停门控：404 重试不重播（同上，尊重暂停状态）
								try { if (!(wallUserPaused || powPaused)) { const pp = vid.play(); if (pp && pp.catch) pp.catch(() => {}); } } catch {}
							}, 800 * vid.__mpwHostTries);
						});
					}
					// ⑤(新) Edge 兼容：Edge 上画到 canvas（视频元素不可见，避开悬浮工具栏）
					if (IS_EDGE) { try { showVideoEdge(playUrl, bgElements().video); } catch { showVideoEl(playUrl); } }
					else showVideoEl(playUrl);
					// ②(fix) 转码加载超时兜底（用户实测：60fps 源 + fpsCap=60 → host 白转码
					// 几分钟 → video 一直 loading 白屏；切回无限制才加载）。现在 host 端
					// 已做"无需转码直返原片"，但真需要转码(如 4K→1080p)时仍可能慢——
					// 10s 内未进入可播放状态 → 切回原片播放（host 转码继续，完成缓存后
					// 自动切回转码产物）。只对 useTranscode 生效且只回退一次。
					if (useTranscode && vid && !vid.__mpwTransLoadingTimeout) {
						const clearTransTimeout = () => { try { clearTimeout(vid.__mpwTransLoadingTimeout); vid.__mpwTransLoadingTimeout = null; } catch {} };
						vid.addEventListener("canplay", clearTransTimeout, { once: true });
						vid.addEventListener("playing", clearTransTimeout, { once: true });
						vid.__mpwTransLoadingTimeout = setTimeout(() => {
							if (window.__mpwCtxSig !== sectionSigNow()) return;
							if (vid.__mpwTransFallback) return;
							if (vid.readyState >= 2) return; // 已能播放，不切
							try {
								console.warn("[dsh-mpkg-wallpaper] 转码 10s 未就绪 → 回退原片", String(hostUrl).slice(0, 100));
								vid.__mpwTransFallback = true;
								try { setHint(t("transcode.fallback")); } catch {}
								vid.removeAttribute("src");
								vid.src = hostUrl;
								vid.load();
								try { if (!(wallUserPaused || powPaused)) { const pp = vid.play(); if (pp && pp.catch) pp.catch(() => {}); } } catch {}
								// ②(fix) 转码完成自动切换：回退后轮询 host 转码进度，
								// done → 重新 apply（此时 /transcode 命中缓存，秒开转码产物）。
								// 只轮询到转码完成或超时（上限 3 分钟，避免无限轮询）。
								let pollTries = 0;
								const poll = setInterval(() => {
									if (window.__mpwCtxSig !== sectionSigNow()) { clearInterval(poll); return; }
									if (++pollTries > 18) { clearInterval(poll); return; } // 3min
									try {
										fetch(HOST_BASE + "/transcode-progress?src=" + encodeURIComponent(image) + "&fps=" + transcodeFps + (resMaxN > 0 ? "&maxW=" + resMaxN : ""))
											.then((r) => r.ok ? r.json() : null)
											.then((j) => {
												if (window.__mpwCtxSig !== sectionSigNow()) return;
												if (j && j.phase === "done") {
													clearInterval(poll);
													console.log("[dsh-mpkg-wallpaper] 转码完成 → 重新应用(命中缓存)");
													try { applyFromStorage(); } catch (e) { mpwErr("applyFromStorage(转码完成后重放)", e); }
												}
											}).catch(() => {});
									} catch {}
								}, 10000);
							} catch {}
						}, 10000);
					}
				} else {
					// ①(修正) 重启竞态兜底：dsh 重启后浏览器可能先于 host 就绪请求 media → 404；
					// 挂 onerror 自动重试（最多 5 次、间隔递增），host 恢复后壁纸自动回来。
					if (img.__mpwHostRetry) { try { clearTimeout(img.__mpwHostRetry); } catch {} }
					img.__mpwHostTries = 0;
					img.onerror = () => {
						if (window.__mpwCtxSig !== sectionSigNow()) return;
						if ((img.__mpwHostTries || 0) >= 5) { img.__mpwHostTries = 0; return; }
						img.__mpwHostTries = (img.__mpwHostTries || 0) + 1;
						img.__mpwHostRetry = setTimeout(() => {
							if (window.__mpwCtxSig !== sectionSigNow()) return;
							console.log("[dsh-mpkg-wallpaper] host media 404 → 重试", img.__mpwHostTries);
							const cur = img.src;
							img.src = "";
							img.src = cur;
						}, 800 * img.__mpwHostTries);
					};
					if (img.src !== hostUrl) img.src = hostUrl;
					showImageEl();
				}
			} else if (image === "idb:blob") {
				idbGet("bg").then((v) => {
					if (window.__mpwCtxSig !== sectionSigNow()) return; // 过期回调（已有更新的应用）
					if (!(v instanceof Blob)) return;
					const sig = v.size + ":" + v.type;
					if (lastBgSig && lastBgSig.sig === sig && lastBgSig.url) {
						// 内容未变：复用已有 ObjectURL，不重建 video（避免重缓冲）
						// ⑤(新) Edge 兼容：画到 canvas（视频元素不可见）
						if (IS_EDGE) { try { showVideoEdge(lastBgSig.url, bgElements().video); } catch { showVideoEl(lastBgSig.url); } }
						else showVideoEl(lastBgSig.url);
						return;
					}
					if (lastBgSig && lastBgSig.url) { try { URL.revokeObjectURL(lastBgSig.url); } catch {} }
					const url = URL.createObjectURL(v);
					lastBgSig = { sig, url };
					// ⑤(新) Edge 兼容：画到 canvas
					if (IS_EDGE) { try { showVideoEdge(url, bgElements().video); } catch { showVideoEl(url); } }
					else showVideoEl(url);
				}).catch(() => {});
			} else if (image === "idb:img") {
				// ③(新) 大图片 Blob 路径：ObjectURL 显示，不走 dataURL（防内存膨胀）
				// ①(2026-09-17 持久化轮) **补上 dataURL 形态**：写侧为了不丢选择，会把超顶的
				//   dataURL 原样落 IDB（`mpwSpillImage` 回读校验的就是 dataURL），旧读侧只认
				//   `v instanceof Blob` ⇒ 那种情况**静默什么都不做**（壁纸区空着，且没有任何提示）。
				//   现在两种形态都恢复；IDB 里没有/形态不对/读失败一律显式告警（不静默）。
				idbGet("bg").then((v) => {
					if (window.__mpwCtxSig !== sectionSigNow()) return; // 过期回调
					const isBlob = (() => { try { return typeof Blob !== "undefined" && v instanceof Blob } catch { return false } })()
						|| (v && typeof v === "object" && typeof v.size === "number");
					if (isBlob) {
						const sig = v.size + ":" + v.type;
						if (lastBgSig && lastBgSig.sig === sig && lastBgSig.url) {
							if (img.src !== lastBgSig.url) img.src = lastBgSig.url;
							showImageEl();
							return;
						}
						if (lastBgSig && lastBgSig.url) { try { URL.revokeObjectURL(lastBgSig.url); } catch {} }
						const url = URL.createObjectURL(v);
						lastBgSig = { sig, url };
						if (img.src !== url) img.src = url;
						showImageEl();
						return;
					}
					if (typeof v === "string" && /^data:/i.test(v)) {
						if (lastBgSig && lastBgSig.url) { try { URL.revokeObjectURL(lastBgSig.url); } catch {} }
						lastBgSig = { sig: "dataurl:" + v.length, url: "" };
						if (img.src !== v) img.src = v;
						showImageEl();
						return;
					}
					mpwPersistEmit("壁纸数据在 IndexedDB 里缺失或形态不对（读到 " + (v === void 0 || v === null ? "空" : typeof v)
						+ "）：请重新选择壁纸。设置里的存储标识是 idb:img，说明上一次写入没有真正落盘。");
				}).catch((e) => {
					mpwPersistEmit("读取 IndexedDB 中的壁纸失败（" + String((e && e.message) || e) + "）：本次显示不了这张壁纸，请重新选择。");
				});
			} else if (typeof image === "string" && image.indexOf("idb:") === 0) {
				idbGet("bg").then((v) => { if (window.__mpwCtxSig !== sectionSigNow()) return; if (v && img.src !== v) { img.src = v; showImageEl(); } }).catch(() => {});
			} else if (section && section.secIdb) {
				// ①(2026-09-17 持久化轮) 整段 section 都在 IDB（连抽掉 image 都放不下 localStorage 的
				//   极端配置）：localStorage 里只有 {"secIdb":1} 这个小哨兵，这里读回来重放。
				idbGet("bgsec").then((sec2) => {
					if (!sec2 || typeof sec2 !== "object") {
						mpwPersistEmit("壁纸设置整段存在 IndexedDB 里，但**读不回来**（哨兵 secIdb=1 已写入）：请重新配置一次。");
						return;
					}
					if (window.__mpwCtxSig !== sectionSigNow()) return;
					sectionCache = mpwNormalizeSection(sec2);
					applyFromStorage();
				}).catch((e) => mpwPersistEmit("读取 IndexedDB 中的壁纸设置失败（" + String((e && e.message) || e) + "）：请重新配置一次。"));
			} else {
				// ①(修正) 内存：置 null 前 revoke 旧 Blob URL——否则清壁纸/切换到图片时
				// 上次的 blob（最大 600MB 视频）URL 仍存活在 registry，不可回收，只增不减。
				if (lastBgSig && lastBgSig.url) { try { URL.revokeObjectURL(lastBgSig.url); } catch {} }
				lastBgSig = null;
				// ①(修正) 非 web 壁纸：无条件卸载残留的 web iframe（否则帧泄漏，
				// 星野/瞬这类 web 壁纸清除后 iframe 仍存活，内存只增不减）。
				// ①(修正2) **只有确实没有 webUrl 时才卸载**——否则若 section.webUrl 存在但
				// 因时序走到这个 else（web 分支在前面 return，但状态可能不同步），
				// teardownWebFrame 会把**正在显示的 web iframe 卸载掉** → 星野壁纸导入后
				// 空白（用户实测：Via 浏览器原本能显示，某次修复后导入即空白）。
				if (!section.webUrl) { try { teardownWebFrame(); } catch {} }
				if (img.src !== image) {
					console.log("[dsh-mpkg-wallpaper] 背景切换: img.src →", String(image).slice(0, 40) + "…");
					if (image) { img.src = image; }
					else { try { img.removeAttribute("src"); } catch {} }
					showImageEl();
				} else {
					console.log("[dsh-mpkg-wallpaper] 背景切换: img.src 未变（可能是重复应用）", String(image).slice(0, 40) + "…");
				}
			}
			if (image) {
				const zoom = section.zoom !== void 0 ? section.zoom : DEFAULT_ZOOM;
				wrap.style.setProperty("--mpw-zoom", String(zoom / 100));
				// ①(新) 壁纸镜像翻转（flip，Wallpaper Engine 原生基础选项）：scaleX/scaleY(-1)
				wrap.style.setProperty("--mpw-flip-x", (section.flipX !== void 0 ? !!section.flipX : false) ? "-1" : "1");
				wrap.style.setProperty("--mpw-flip-y", (section.flipY !== void 0 ? !!section.flipY : false) ? "-1" : "1");
				wrap.style.setProperty("--mpw-lensX", String(section.lensX !== void 0 ? section.lensX : 0) + "px");
				wrap.style.setProperty("--mpw-lensY", String(section.lensY !== void 0 ? section.lensY : 0) + "px");
				wrap.classList.toggle("mpw-sharp", section.sharp !== void 0 ? !!section.sharp : DEFAULT_SHARP);
				// ⑯ 磨砂模糊条 → 壁纸层 blur（0 = 完全清晰）。
				// ①(修正) 壁纸 blur 归谁管（用户澄清：chatFollow=聊天区跟随整屏虚化）：
				//  - 统一虚化开 + chatFollow 开 → unifyAmount 接管**壁纸层 blur**
				//    （聊天区也跟随整屏虚化）
				//  - 统一虚化开 + chatFollow 关 → **壁纸层 blur 由磨砂条控制（聊天区
				//    不跟随）**；侧边栏/标题栏的虚化由 buildCss 的 backdrop blur
				//    (unifyAmount) 单独提供（见 G 块）
				//  - 统一虚化关 → 磨砂条控制
				const unifyTintApply = section.unifyTint !== void 0 ? !!section.unifyTint : DEFAULT_UNIFY_TINT;
				const chatFollowApply = section.chatFollow !== void 0 ? !!section.chatFollow : DEFAULT_CHAT_FOLLOW;
				const unifyAmt = section.unifyAmount !== void 0 ? section.unifyAmount : DEFAULT_UNIFY_AMOUNT;
				const frostBlur = section.blur !== void 0 ? section.blur : DEFAULT_BLUR;
				const bgBlur = (unifyTintApply && chatFollowApply) ? unifyAmt : frostBlur;
				wrap.style.setProperty("--mpw-bg-blur", bgBlur > 0 ? `blur(${bgBlur}px)` : "none");
				// ⑧(新) 画面亮度
				const brightness = section.brightness !== void 0 ? section.brightness : DEFAULT_BRIGHTNESS;
				wrap.style.setProperty("--mpw-brightness", String(brightness / 100));
			}
			// ①(新) 悬浮效果：控制 body 属性门控（需在 buildCss 前读 section.float）
			const floatOn = section.float !== void 0 ? !!section.float : DEFAULT_FLOAT;
			// ①(新) 悬浮效果：控制 body 属性门控
			try {
				if (floatOn) document.body.setAttribute("data-mpw-float", "");
				else document.body.removeAttribute("data-mpw-float");
			} catch {}
			// bsBottomAvoid：better-sidebar 底部面板 left 已由它自己的 ResizeObserver
			// 实时对齐到 DSH 中心列（输入框对齐），无需我们手动偏移（之前 margin 方案
			// 反而在展开时把面板推出对齐——用户实测）。去掉手动 rail 宽度测量。
			// ①(新) 侧边栏磨砂（Aqua 方案）：body 属性门控；弹窗打开时 JS 打 data-mpw-sblur-off 摘除
			try {
				const sidebarBlurOn = section.sidebarBlur !== void 0 ? !!section.sidebarBlur : DEFAULT_SIDEBAR_BLUR;
				if (sidebarBlurOn) document.body.setAttribute("data-mpw-sblur", "");
				const rsBlurOn = section.rightSidebarBlur !== void 0 ? !!section.rightSidebarBlur : DEFAULT_RIGHT_SIDEBAR_BLUR;
				// 关闭时写 "off"（而不是移除属性）——兜底选择器据此精确匹配，避免"无属性=恒关"
				if (rsBlurOn) document.body.setAttribute("data-mpw-rsblur", "on"); else document.body.setAttribute("data-mpw-rsblur", "off");
				// ①(2026-09-13) 标题栏磨砂实现方式开关：默认"本体"（观感稳定）；
				//   ?hdrblur=pseudo → 改用 .wSkVaW_header::before 伪元素（不产生 containing block/层叠上下文，
				//   用于排障：若某些浮层/面板在"本体"方案下异常，可切到该模式对照）。
				try {
					const hbMode = new URLSearchParams(location.search).get("hdrblur");
					if (hbMode === "element") document.body.setAttribute("data-mpw-hdr-blur-element", "");
					else document.body.removeAttribute("data-mpw-hdr-blur-element");
				} catch {}
				if (!sidebarBlurOn) document.body.removeAttribute("data-mpw-sblur");
			} catch {}
			try { setupSblurObserver(); } catch {}
			try { setupHeaderBlurWatch(); } catch {}
			try { setupAquaThemeWatch(); } catch {}
			// ①(新) 主题颜色：body 门控 + CSS 变量（控制侧边栏/标题栏/新会话/设置弹窗底色）
			// ①(Qoder 审查 R3) 总开关关闭时还原默认外观：themeColor/accent 的
			// body 属性与 CSS 变量也受 enabled 门控（关 = 移除 tint，DSH 原色）。
			try {
				const tc = enabled && section.themeColor || "";
				if (tc && /^#[0-9a-fA-F]{6}$/.test(tc)) {
					document.body.setAttribute("data-mpw-theme", "");
					document.documentElement.style.setProperty("--mpw-theme-color", tc);
				} else {
					document.body.removeAttribute("data-mpw-theme");
					document.documentElement.style.removeProperty("--mpw-theme-color");
				}
				// ①(新) 配色（accent）：品牌交互元素（按钮/滑条/选中/链接/发送键）
				const ac = enabled && section.accent || "";
				if (ac && /^#[0-9a-fA-F]{6}$/.test(ac)) {
					document.body.setAttribute("data-mpw-accent", "");
					document.documentElement.style.setProperty("--mpw-accent-color", ac);
				} else {
					document.body.removeAttribute("data-mpw-accent");
					document.documentElement.style.removeProperty("--mpw-accent-color");
				}
			} catch {}
			// ⑲(新) Aqua 实验模式：body 门控 + 遮罩/取色刷新（默认关，不影响原功能）
			try {
				if (aquaOn(section)) document.body.setAttribute("data-mpw-aqua", "");
				else document.body.removeAttribute("data-mpw-aqua");
				// ①(修正) 标题栏跟随 mask 色只在统一雾/面板取色时开；纯自适应文字色
				// 不刷标题栏底色（否则亮色主题下标题栏变 62% 白 → session log 白框）
				const headerTint = (section.aquaMask !== void 0 ? !!section.aquaMask : DEFAULT_AQUA_MASK)
					|| (section.aquaTint !== void 0 ? !!section.aquaTint : DEFAULT_AQUA_TINT);
				if (headerTint) document.body.setAttribute("data-mpw-aqua-header", "");
				else document.body.removeAttribute("data-mpw-aqua-header");
				if (section.aquaTextEnhance !== void 0 ? !!section.aquaTextEnhance : DEFAULT_AQUA_TEXT_ENHANCE)
					document.body.setAttribute("data-mpw-aqua-text", "");
				else document.body.removeAttribute("data-mpw-aqua-text");
				if (section.todoBlur !== void 0 ? !!section.todoBlur : DEFAULT_TODO_BLUR)
					document.body.setAttribute("data-mpw-todo-blur", "");
				else document.body.removeAttribute("data-mpw-todo-blur");
				refreshAqua();
				// ①(2026-09-16 bug①) 右侧轮次导航条对比色（收窄到白名单 rail 节点，?railink=off 可关）
				refreshRailInk();
				if (aquaOn(section)) scheduleAquaTint();
			} catch {}
			// 2(修正) seam 标记 sidebar root（解除宽度用，参考 seam-stamper）
			try {
				const sr = document.querySelector('[class*="sidebarCol"] [class*="root"]');
				if (sr && !sr.hasAttribute("data-mpw-sidebar-root")) sr.setAttribute("data-mpw-sidebar-root", "");
			} catch {}
			const styleEl = getStyleEl();
			if (styleEl) {
				try { styleEl.textContent = buildCss(section); }
				catch (err) { console.error("[dsh-mpkg-wallpaper] buildCss failed:", err); }
			try { applyCompatBridges(section); startCompatObserver(); } catch {}
			}
			// ⑭ token override：弹层/主画布/侧边栏半透明（对话框虚化核心）
			try { applyTokenOverrides(pluginCtx, section); } catch (e) { mpwErr("applyTokenOverrides", e); }
			try { applyDialogInline(section); } catch (e) { mpwErr("applyDialogInline", e); }
			try { updateClock(); } catch (e) { mpwErr("updateClock", e); }
			// ①(新) 液态玻璃叠加层（lgComposer/lgSidebar/lgHeader 任一开启时启动）
			try { applyLiquidGlass(section); } catch (e) { mpwErr("applyLiquidGlass", e); }
			// ①(修正) 省电：每次 apply 后同步暂停状态——否则勾选"省电"开关后不立即生效
			//（原只有事件触发才 updatePowerPause，开关开了要等下次事件才暂停）
			try { updatePowerPause(); } catch {}
		}

		// ═══════════════════════════════════════════════════════════════════
		//  🧪(新) 液态玻璃叠加层（测试模式）：把 WebGL2 液态玻璃渲染到 DSH 界面。
		//  渲染器源码由 host 静态托管（/api/mpkg-wallpaper/lg/*.js），浏览器动态 import。
		//  稳定安全优先：任何异常都 catch，不影响主功能；开关关闭即销毁。
		//  ═══════════════════════════════════════════════════════════════════
		let lgModule = null;          // { LiquidGlassWebGLV2 }
		let lgStatus = "";           // 调试状态（显示在 tab 里）
		function setLgStatus(s) { lgStatus = s; try { notifySectionChanged(); } catch {} }
		// ①(新·双版本兼容桥 2026-09-11) dsh 0.1.5 前端改用 CSS Modules 类名（._header_w1urq_45 等），
		// 旧编译 hash（wSkVaW_header / sidebarCol）全部失配 → 侧栏/标题栏/右栏/dockkit 虚化规则静默失效
		// （用户实测：展开下拉/三点后磨砂消失）。方案：不改 83 处旧规则，而是给"新版稳定锚点"补打旧类名，
		// 让两代选择器同时命中；旧版元素本就有旧类名 → 零影响。
		// ②(2026-09-11 收窄) 只保留"确定性布局锚点"——宽泛选择器（_root_/_scrollBody_/composer）
		// 会误标聊天滚动区/输入框容器，导致输入框背景被 token 规则覆盖成半透明（用户实测"输入框全透明"回归）。
		// 需要重新纳入的项必须带严格尺寸/结构过滤，逐项回归后再加。
		// ①(2026-09-13 用户实测) 渲染器"逐层调试"期间的按键隔离：
		//   壁纸是 DSH 页面里的 iframe，用户在壁纸里按 ←/→/↑/↓/Alt 时，**宿主页**的壁纸列表也会
		//   响应方向键去切换选择（用户："这4个按键都会触发屏幕最上面那个壁纸的选择"）。
		//   渲染器进入/退出逐层调试时会 postMessage({type:'mpw-ln-mode'})；这里在宿主侧用
		//   **捕获阶段**监听并吞掉这些键（只在调试期间，且只吞这几个键，不影响正常输入）。
		// ①(B6) 渲染器能力上报（mpw-cap，契约 §2.2）：strict 沙箱下渲染器用它自证"已出画/未被污染"，
		//   插件据此写 diag，并在 ok:false 时一次性回退 legacy（黑屏兜底，见 mpwSandboxFail）。
		try {
			if (!window.__mpwSandboxCapHook) {
				window.__mpwSandboxCapHook = 1;
				window.addEventListener("message", (ev) => {
					try {
						const d = ev && ev.data;
						if (!d || d.type !== "mpw-cap") return;
						if (!mpwIsSceneFrameMsg(ev)) return;
						__mpwSandboxCap = {
							at: Date.now(), v: Number(d.v) || 1, ok: !!d.ok, opaque: !!d.opaque,
							sceneId: d.sceneId ? String(d.sceneId).slice(0, 120) : "",
							firstFrame: !!d.firstFrame, tainted: !!d.tainted, thumbToken: !!d.thumbToken,
							errs: Array.isArray(d.errs) ? d.errs.slice(0, 3).map((x) => String(x).slice(0, 120)) : []
						};
						if (!__mpwSandboxCap.ok) mpwSandboxFail("cap-not-ok");
						else if (__mpwSandboxCap.firstFrame && __mpwSandboxStrictTimer) { clearTimeout(__mpwSandboxStrictTimer); __mpwSandboxStrictTimer = 0 }
					} catch {}
				});
			}
		} catch {}
		try {
			if (!window.__mpwLnGuard) {
				window.__mpwLnGuard = 1;
				let lnMode = false;
				// ①(2026-09-14 用户第 9 项) "任何时候全局左右键都只调层数"：
				//   以前 lnMode 只由渲染器的 mpw-ln-mode 消息驱动 → 壁纸列表仍会抢到方向键。
				//   现在改为**场景壁纸挂载即武装**（showWebEl 调 __mpwLnSet(true)），
				//   并把吞掉的键**转发给渲染器**（postMessage 'mpw-ln-key'）→ 全局方向键只调层、
				//   不再切最上面的壁纸列表；切离场景壁纸时 __mpwLnReset() 解除（各显示路径已调用）。
				window.__mpwLnSet = (on) => { try { lnMode = !!on; } catch {} };
				// ①(批次15 B3 复核) 复位钩子：场景壁纸卸载/切换后渲染器不会再发 mpw-ln-mode，
				//   若滞留 on=true，宿主方向键会被永远吞掉 → 切离场景壁纸时由各显示路径调用。
				window.__mpwLnReset = () => { try { lnMode = false; } catch {} };
				const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "Alt", "Control"];
				const guard = (ev) => {
					if (!lnMode) return;
					if (keys.indexOf(ev.key) < 0) return;
					try { ev.preventDefault(); ev.stopImmediatePropagation(); ev.stopPropagation() } catch {}
					// ①(第 9 项) 转发给渲染器（它自己聚焦不到键盘：壁纸是 pointer-events:none）
					//   渲染器侧对应处理见 demo.html 的 'mpw-ln-key' 消息（没进逐层调试时会先进入）。
					try {
						const f = bgElements().frame;
						if (f && f.contentWindow) f.contentWindow.postMessage({ type: "mpw-ln-key", key: ev.key }, "*");
					} catch {}
				};
				window.addEventListener("keydown", guard, true);
				window.addEventListener("message", (ev) => {
					try {
						const d = ev && ev.data;
						if (!d || d.type !== "mpw-ln-mode") return;
						// 只接受渲染器来源（:8899 或 strict 下的不透明源 "null"）——contentWindow 精确匹配优先，
						// 避免任意页面控制按键；①(B6) 改走统一校验（旧规则会拒掉 Origin:"null"）。
						if (!mpwIsSceneFrameMsg(ev)) return;
						lnMode = !!d.on;
					} catch {}
				});
			}
		} catch {}
		// ═══ ①(新 2026-09-11) DOM 诊断上报（?mpwdiag=1）：把设置面板/菜单/注入元素的祖先链与
		// computed 样式上报 host（无浏览器环境下定位 CSS 层级/包含块问题的唯一可靠手段）。
		/**
		 * ①(2026-09-16 根治) 标题栏磨砂的**统一诊断快照**（两条上报路径共用同一份字段）。
		 * 为什么必须共用：手动/自动的界面诊断走 `mpwDiagCollect()`，顶栏菜单弹出走 layer-diag；
		 * 如果只有一条路径带磨砂字段，用户上报的那份可能刚好缺字段（历史上正是如此：
		 * diag 里只有 section / reveal.headerBg / groups.*，"为什么没磨砂"无从判断）。
		 * 字段表见 docs/HEADER-FROST.md；任何一步失败都退化为 null，绝不影响整份诊断。
		 */
		function mpwHeaderFrostDiag() {
			try {
				const h = findHostHeader();
				const el = h ? h.querySelector(':scope > .mpw-hdrFrost') : null;
				const cs = el ? getComputedStyle(el) : null;
				const hcs = h ? getComputedStyle(h) : null;
				const pcs = h ? getComputedStyle(h, '::before') : null;
				const r = el ? el.getBoundingClientRect() : null;
				const nz = (v) => (v && v !== 'none' ? String(v).slice(0, 40) : 'none');
				const translucent = (() => { try { return h ? h.hasAttribute('data-mpw-hdr-translucent') : null } catch { return null } })();
				return {
					hostHasHeader: !!h,
					injected: !!el,
					px: el ? (el.__mpwBlurPx | 0) : null,
					bdf: cs ? nz(cs.backdropFilter) : null,
					wk: cs ? (cs.webkitBackdropFilter === 'none' ? 'none' : 'set') : null,
					rect: r ? [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] : null,
					z: cs ? cs.zIndex : null,
					pos: cs ? cs.position : null,
					headerRect: h ? (() => { const hr = h.getBoundingClientRect(); return [Math.round(hr.x), Math.round(hr.y), Math.round(hr.width), Math.round(hr.height)] })() : null,
					pseudoBdf: nz(pcs && pcs.backdropFilter),
					mode: (() => { try { return new URLSearchParams(location.search).get('hdrblur') || 'child' } catch { return 'child' } })(),
					reason: (typeof lastFrostReason === 'string' ? lastFrostReason : ''),
					translucent: translucent,
					headerTranslucent: translucent,
					computed: {
						headerBg: String((hcs && (hcs.backgroundColor || (hcs.getPropertyValue && hcs.getPropertyValue('background-color')))) || '').slice(0, 60),
						headerBackdrop: nz(hcs && hcs.backdropFilter),
						frostElBackdrop: nz(cs && cs.backdropFilter),
						frostElZ: cs ? cs.zIndex : null,
					},
					state: (() => { try { return JSON.parse(JSON.stringify(hdrFrostState)) } catch { return null } })(),
					// ①(2026-09-17 切会话磨砂消失 bug) 自愈观察器现场：armed=false + reason 有文案 ⇒
					//   "被宿主重建顶栏丢掉后为什么没补上"一眼可判；hits 增长即证明是观察器补的。
					watch: (() => { try { const W = hdrFrostWatchState(); return { off: hdrFrostWatchOff(), armed: !!(W && W.mo), targets: (W && W.targets ? W.targets.length : 0), hits: (W && W.hits) || 0, queued: !!(W && W.queued) } } catch { return null } })(),
				};
			} catch { return null }
		}
		function mpwDiagCollect() {
			const pick = (el) => {
				try {
					const cs = getComputedStyle(el);
					const r = el.getBoundingClientRect();
					return { tag: el.tagName, cls: String(el.className || '').slice(0, 160), id: el.id || '',
						attrs: Array.from(el.attributes || []).map(a => a.name + '=' + String(a.value).slice(0, 40)).slice(0, 10),
						rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
						position: cs.position, zIndex: cs.zIndex, overflow: cs.overflow, display: cs.display,
						transform: cs.transform === 'none' ? 'none' : 'set', filter: cs.filter === 'none' ? 'none' : 'set',
						backdropFilter: cs.backdropFilter === 'none' ? 'none' : 'set',
						contain: cs.contain, isolation: cs.isolation, willChange: cs.willChange, opacity: cs.opacity,
						visibility: cs.visibility, color: cs.color, fontSize: cs.fontSize, height: cs.height, overflowY: cs.overflowY,
						background: cs.backgroundColor + (cs.backgroundImage && cs.backgroundImage !== 'none' ? ' +img' : ''),
						inlineBg: (el.style && el.style.backgroundColor) || '', inlineBdf: (el.style && el.style.backdropFilter) || '',
						scrollH: el.scrollHeight || 0 };
				} catch (e) { return { err: String(e && e.message || e) }; }
			};
			const chain = (el, depth = 10) => {
				const out = []; let cur = el, i = 0;
				while (cur && cur !== document.documentElement && i < depth) { out.push(pick(cur)); cur = cur.parentElement; i++; }
				return out;
			};
			const sels = {
				dialogs: '[role="dialog"], [role="alertdialog"], [class*="_overlay"], [class*="_modal"], [class*="_dialog_"], [class*="_settings_"]',
				menus: '[role="menu"], [class*="_menu_"], [class*="_popover_"], [class*="_floatHeader_"], [data-dockkit-pane]',
				ourMarks: '[data-mpw-rs], [data-mpw-sidebar-root], [class*="mpw-"]',
				// ①(2026-09-12 诊断) 面板专用组：此前被前 6 个 mpw- 元素挤掉 → 无法判断面板 DOM 是否存在
				panel: '[class*="mpw_"]',
				panelTab: '.mpw_tabRow, .mpw_tabs, [class*="mpw_tab"]',
				rightSide: '[data-sidebar-right-panel], [data-sidebar-right-float-host], [data-dockkit-strip], [data-dockkit-float]',
				leftSide: 'aside, [class*="sidebarCol"], [class*="_sidebar"]',
				header: '[class*="_header"], .wSkVaW_header, header'
			};
			// ①(2026-09-13 稳定性) 采集器里任何一步抛错都会丢掉整份诊断（layer-diag 尤其重要），
			// 所以这里所有取值都走"取不到就给默认值"的写法（裸 innerWidth 在某些宿主/测试桩里不存在）。
			const mpwVp = (() => { try { return [window.innerWidth | 0, window.innerHeight | 0]; } catch { return [0, 0]; } })();
			const out = { at: new Date().toISOString(), url: (() => { try { return location.href; } catch { return ''; } })(), viewport: mpwVp,
				body: pick(document.body), html: pick(document.documentElement), groups: {} };
			try {
				const sec = readSection() || {};
				out.section = { rightSidebarBlur: sec.rightSidebarBlur, rightSidebarBlurAmount: sec.rightSidebarBlurAmount,
					rightSidebarAlpha: sec.rightSidebarAlpha, sidebarBlur: sec.sidebarBlur, unifyTint: sec.unifyTint,
					unifyAmount: sec.unifyAmount, chatFollow: sec.chatFollow, enabled: sec.enabled, image: !!(sec.image || sec.webUrl) };
			} catch {}
			// ①(2026-09-13 第4项诊断) 透出壁纸专项：壁纸层是否可见 + 各表面 computed 背景 + 关键 token
			try {
				const csBody = getComputedStyle(document.body);
				const bgImg = document.querySelector('.mpw-bgWrap img, .mpw-bgWrap video');
				const bgWrap = document.querySelector('.mpw-bgWrap');
				const alphaOf = (bg) => {
					try {
						const m = /rgba?\(([^)]+)\)/.exec(bg || '');
						if (!m) return bg === 'transparent' ? 0 : 1;
						const parts = m[1].split(',').map((x) => parseFloat(x));
						return parts.length >= 4 ? parts[3] : 1;
					} catch { return null; }
				};
				const sEl = document.querySelector('[class*="sidebarCol"]');
				const sRoot = sEl ? sEl.querySelector('[class*="root"]') : null;
				const hEl = document.querySelector('.wSkVaW_header, [class*="wSkVaW_header"]');
				const rEl = document.querySelector('[data-sidebar-right-panel]');
				out.reveal = {
					wallpaperLayer: bgWrap ? { display: getComputedStyle(bgWrap).display, opacity: getComputedStyle(bgWrap).opacity, z: getComputedStyle(bgWrap).zIndex } : null,
					wallpaperMedia: bgImg ? { tag: bgImg.tagName, src: String(bgImg.currentSrc || bgImg.src || '').slice(0, 80), complete: bgImg.complete, natural: bgImg.naturalWidth || 0 } : null,
					sidebarBg: sEl ? getComputedStyle(sEl).backgroundColor : null,
					sidebarBgAlpha: sEl ? alphaOf(getComputedStyle(sEl).backgroundColor) : null,
					sidebarRootBg: sRoot ? getComputedStyle(sRoot).backgroundColor : null,
					sidebarRootBgAlpha: sRoot ? alphaOf(getComputedStyle(sRoot).backgroundColor) : null,
					headerBg: hEl ? getComputedStyle(hEl).backgroundColor : null,
					headerBgAlpha: hEl ? alphaOf(getComputedStyle(hEl).backgroundColor) : null,
					rightPanelBg: rEl ? getComputedStyle(rEl).backgroundColor : null,
					tokens: { sidebarFill: csBody.getPropertyValue('--dsw-specific-sidebar-fill').trim(),
						bgBase: csBody.getPropertyValue('--dsw-alias-bg-base').trim(),
						panelTint: csBody.getPropertyValue('--mpw-panel-tint').trim() },
					styleTags: Array.from(document.querySelectorAll('style')).length,
				};
			} catch (e) { out.reveal = { err: String(e && e.message || e) }; }
			// ①(2026-09-16 根治) 标题栏磨砂链路（**用户按「诊断/上报」时走的就是这里**）：
			//   字段含 injected/px/reason/hostHasHeader/headerTranslucent/computed{headerBg,headerBackdrop,frostElBackdrop}。
			try { out.headerFrost = mpwHeaderFrostDiag(); } catch (e) { out.headerFrost = { err: String(e && e.message || e) }; }
			// ①(2026-09-16 bug①) 右侧时间线（TurnNavigator rail）当前样式：条的颜色 token 解析值 +
			//   我们是否在补偿（data-mpw-rail-ink）→ 真机一次上报即可判定"条看不见"是哪一侧的问题。
			try {
				const rail = document.querySelector('.eGxaPq_mark, [class*="eGxaPq_mark"]');
				const railBox = document.querySelector('.eGxaPq_frame, [class*="eGxaPq_frame"]');
				const csRail = rail ? getComputedStyle(rail, '::before') : null;
				const csRailBox = railBox ? getComputedStyle(railBox) : null;
				out.rail = rail ? {
					found: true,
					ours: !!(document.body && document.body.hasAttribute && document.body.hasAttribute('data-mpw-rail-ink')),
					markBeforeBg: csRail ? String(csRail.backgroundColor || '').slice(0, 40) : null,
					// ③(2026-09-16) 把"看得见/看不见"所需的判据一次采全（真机一轮定案，避免再来回猜）：
					//   bgRaw = background 简写最终值（能区分"被删"与"被算成透明"）；
					//   shadow = 反色晕是否生效；rect/h/w/opacity/display = 条的几何与可见性；
					//   clip = 祖先裁切；active = 是否命中的是 markActive。
					markBeforeBgRaw: csRail ? String((csRail.getPropertyValue && csRail.getPropertyValue('background')) || '').slice(0, 60) : null,
					markBoxShadow: csRail ? String(csRail.boxShadow || 'none').slice(0, 60) : null,
					markW: csRail ? csRail.width : null,
					markH: csRail ? csRail.height : null,
					markOpacity: csRail ? csRail.opacity : null,
					markDisplay: csRail ? csRail.display : null,
					markVisibility: csRail ? csRail.visibility : null,
					markCls: rail ? String(rail.className || '').slice(0, 60) : null,
					markRect: (() => { try { const b = rail.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] } catch { return null } })(),
					inViewport: (() => { try { const b = rail.getBoundingClientRect(); return b.height > 0 && b.bottom > 0 && b.top < innerHeight && b.right > 0 && b.left < innerWidth } catch { return null } })(),
					clip: (() => { const res = []; try { for (let n = rail.parentElement, i = 0; n && i < 4; n = n.parentElement, i++) { if (getComputedStyle(n).overflow !== 'visible') res.push(String(n.className || n.tagName).slice(0, 30)) } } catch {} return res })(),
					boxRect: railBox ? (() => { try { const b = railBox.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] } catch { return null } })() : null,
					tokens: {
						borderL4: (() => { try { return getComputedStyle(document.body).getPropertyValue('--dsw-alias-border-l4').trim() } catch { return '' } })(),
						labelPrimary: (() => { try { return getComputedStyle(document.body).getPropertyValue('--dsw-alias-label-primary').trim() } catch { return '' } })(),
						mpwRailInk: (() => { try { return getComputedStyle(document.documentElement).getPropertyValue('--mpw-rail-ink').trim() } catch { return '' } })(),
						mpwRailHalo: (() => { try { return getComputedStyle(document.documentElement).getPropertyValue('--mpw-rail-halo').trim() } catch { return '' } })(),
					},
					boxOverflowX: csRailBox ? csRailBox.overflowX : null,
				} : { found: false };
			} catch (e) { out.rail = { err: String(e && e.message || e) }; }
			// ①(批次15 B1/B2/B5) 场景渲染健康快照：看门狗状态 + 渲染器 mpw-health 最近消息 + 信标可用性
			try {
				out.sceneHealth = { wd: mpwSceneWdState(), health: __mpwSceneHealth, beaconOk: __mpwSceneBeaconOk, lowmem: mpwSceneLowMem() };
			} catch (e) { out.sceneHealth = { err: String(e && e.message || e) }; }
			for (const [k, sel] of Object.entries(sels)) {
				try { out.groups[k] = Array.from(document.querySelectorAll(sel)).slice(0, (k === 'panel' || k === 'panelTab') ? 12 : 6).map(el => ({ self: pick(el), chain: chain(el) })); }
				catch (e) { out.groups[k] = [{ err: String(e && e.message || e) }]; }
			}
			return out;
		}
		// ②(2026-09-11 改自动) dsh 认证会 303 清掉 query（?mpwdiag=1 丢失）——改为 localStorage 开关。
		// ①(P-104 2026-09-17 用户发布纪律①) **默认关**（旧实现默认开：`!== '0'`）：
		//   这是"测试用的自动上报"——页面加载后 6s 自动把设置面板 DOM 快照 POST 到宿主（落 diag-*.json）。
		//   用户名点："这种你在上传仓库的时候要把它默认给关掉" ⇒ 现在只有显式 `localStorage['mpwdiag']='1'` 才开。
		//   开法：控制台 `localStorage.setItem('mpwdiag','1')` 后刷新；关法：删掉该键或设 '0'（默认就是关）。
		//   开启后每会话仍≤6 次（避免刷屏），且宿主端另有"≤50 个 / ≤32MB 最旧先删"的硬上限。
		// ①(2026-09-12 用户实测：重启后壁纸引擎面板整个空白) 错误自上报：
		//   面板空白通常是渲染/加载期抛异常，而我们看不到控制台 → 直接把异常 POST 到 diag，
		//   落到 ~/.dsh/.dsh-mpkg-wallpaper/diag-*.json，工程侧无需用户复述即可定位。
		try {
			if (!window.__mpwErrHook) {
				window.__mpwErrHook = 1;
				let errCount = 0;
				const pushErr = (kind, msg, stack) => {
					if (errCount >= 8) return;
					errCount++;
					try {
						fetch(HOST_BASE + '/diag', { method: 'POST', body: JSON.stringify({ kind: 'js-error', why: kind, at: new Date().toISOString(), url: location.href, message: String(msg).slice(0, 600), stack: String(stack || '').slice(0, 1500) }) }).catch(() => {});
					} catch {}
				};
				window.addEventListener('error', (ev) => pushErr('error', (ev && ev.message) || 'unknown', ev && ev.error && ev.error.stack));
				window.addEventListener('unhandledrejection', (ev) => pushErr('rejection', (ev && ev.reason && (ev.reason.message || ev.reason)) || 'unknown', ev && ev.reason && ev.reason.stack));
			}
		} catch {}
		try {
			if (localStorage.getItem('mpwdiag') === '1') {
				let mpwDiagCount = 0;
				const mpwDiagPush = async (why) => {
					if (mpwDiagCount >= 6) return;
					mpwDiagCount++;
					try {
						// ①(2026-09-13 稳定性) 采集失败也要把事件发出去：否则一次采集异常 =
						// 现场证据彻底丢失（历史上排查浮层问题时最怕这个）。
						let data;
						try { data = mpwDiagCollect(); } catch (ce) { data = { at: new Date().toISOString(), collectError: String(ce && ce.message || ce) }; }
						if (!data || typeof data !== 'object') data = { at: new Date().toISOString(), collectError: 'empty' };
						data.why = why;
						// ①(MERGED-3 1.1) thumb 命中来源：对列表注册过的场景缩略图逐项探测
						//（同源 fetch 可读 x-mpw-thumb-src 响应头：cache=渲染器首帧缓存 / frame=静态帧 / preview=预览图）
						try {
							const entries = Array.from(__mpwSceneThumbReg.entries()).slice(0, 12);
							if (entries.length) {
								data.thumbSources = await Promise.all(entries.map(async ([turl, tkey]) => {
									try {
										const r = await fetch(turl, { cache: 'no-store' });
										const src = (r.headers && typeof r.headers.get === 'function') ? (r.headers.get('x-mpw-thumb-src') || ('http' + r.status)) : ('http' + r.status);
										try { if (r.body && r.body.cancel) await r.body.cancel(); } catch {}
										return { key: tkey, src };
									} catch (e) { return { key: tkey, src: 'error' }; }
								}));
							}
						} catch (e) { data.thumbSources = [{ err: String(e && e.message || e) }]; }
						await fetch(HOST_BASE + '/diag', { method: 'POST', body: JSON.stringify(data) });
						console.log('[mpw-diag] 上报#' + mpwDiagCount + ' (' + why + ')');
					} catch (e) { console.warn('[mpw-diag] 上报失败', e); }
				};
				setTimeout(() => mpwDiagPush('load'), 6000);
				try {
					let mpwDiagTimer = null;
					const mo = new MutationObserver(() => {
						if (mpwDiagCount >= 6) { try { mo.disconnect(); } catch {} return; }
						const hasUI = document.querySelector('[role="dialog"], [class*="_overlay"], [class*="_modal"], [class*="_menu_"], [role="menu"], [class*="_settings_"]');
						if (!hasUI) return;
						if (mpwDiagTimer) return;
						mpwDiagTimer = setTimeout(() => { mpwDiagTimer = null; mpwDiagPush('ui-open'); }, 2500);
					});
					mo.observe(document.body, { childList: true, subtree: true });
				} catch {}
			}
		} catch {}

		// ═══ ①(新 2026-09-11 最终方案) 内联磨砂：直接给目标容器设置内联 backdropFilter。
		// 内联样式优先级最高，绕过所有 CSS 选择器/条件/特异性/类名 hash 问题（这是本问题反复的根源）。
		// 弹窗打开时同一函数移除内联（避免成为 fixed 弹窗的 containing block）。
		let frostObserver = null;
		let frostState = null;
		// ①(2026-09-12 CSS-first 收口) 不再用内联 backdropFilter 控制"标题栏/左栏/右栏"——
		//   内联样式会被 React 重渲染覆盖，MutationObserver 每次写 style 又自激触发自己，
		//   在 Android WebView 上表现为"模糊间歇性消失"（GLM 评审：React 协调冲突权重最高）。
		//   现在这三类区域完全由 buildCss 的 H 块（纯 CSS，带 !important）接管；
		//   这里只负责把历史遗留的内联值清一次，之后永不再写。?inlinefrost=1 可恢复旧行为做对照。
		const MPW_FROST_CSS_ONLY = !(typeof location !== 'undefined' && /[?&]inlinefrost=1/.test(location.search));
		function applyFrostInline(section) {
			try {
				if (MPW_FROST_CSS_ONLY) {
					document.querySelectorAll('[class*="sidebarCol"], [class*="_header"], header, [data-dockkit-strip], [data-dockkit-pane], [data-sidebar-right-panel]').forEach((el) => {
						try { if (el.style.backdropFilter) el.style.backdropFilter = ''; if (el.style.webkitBackdropFilter) el.style.webkitBackdropFilter = '' } catch {}
					});
					return;
				}
				const sec = section || (typeof readSection === 'function' ? readSection() : null) || {};
				const rsOn = sec.rightSidebarBlur !== void 0 ? !!sec.rightSidebarBlur : DEFAULT_RIGHT_SIDEBAR_BLUR;
				const rsAmt = sec.rightSidebarBlurAmount !== void 0 ? sec.rightSidebarBlurAmount : DEFAULT_RIGHT_SIDEBAR_AMOUNT;
				const sideAmt = sec.unifyAmount !== void 0 ? sec.unifyAmount : DEFAULT_UNIFY_AMOUNT;
				// 弹窗检测：fixed + 可见 + 高度≥70%视口（宽度可能被压缩，不作判据）
				const overlayOpen = Array.from(document.querySelectorAll('[class*="_overlay"], [class*="_modal"], [role="dialog"], [role="alertdialog"]')).some((el) => {
					try {
						const cs = getComputedStyle(el);
						if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
						const r = el.getBoundingClientRect();
						return r.height >= (window.innerHeight || 1) * 0.7 && r.width > 0;
					} catch { return false }
				});
				const targets = [
					{ sel: '[class*="sidebarCol"]', amt: sideAmt },
					{ sel: '.wSkVaW_header, [class*="_header"], header', amt: sideAmt },
					{ sel: '[data-sidebar-right-panel], [data-sidebar-right-float-host], [data-mpw-rs], [data-dockkit-strip], [data-dockkit-float]', amt: rsOn ? rsAmt : 0 }
				];
				for (const t of targets) {
					document.querySelectorAll(t.sel).forEach((el) => {
						try {
							if (overlayOpen || !(t.amt > 0)) {
								if (el.style.backdropFilter) el.style.backdropFilter = '';
								if (el.style.webkitBackdropFilter) el.style.webkitBackdropFilter = '';
							} else {
								const v = `blur(${t.amt}px) saturate(140%)`;
								if (el.style.backdropFilter !== v) el.style.backdropFilter = v;
								if (el.style.webkitBackdropFilter !== v) el.style.webkitBackdropFilter = v;
							}
						} catch {}
					});
				}
			} catch (e) {}
		}
		function startFrostObserver() {
			try {
				if (frostObserver) return;
				frostObserver = new MutationObserver(() => { applyFrostInline(); });
				frostObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
			} catch {}
		}

		const COMPAT_BRIDGES = [
			// ②(2026-09-11 关键修复) 右栏/dock 改打专用标记 data-mpw-rs —— 只接受 F 块"虚化+透明"规则，
			// 绝不继承 sidebarCol 的布局规则（宽度/overflow/悬浮外壳），否则从右栏打开的设置面板会被困在侧栏内。
			['[data-sidebar-right-panel], [data-sidebar-right-float-host], [data-dockkit-strip], [data-dockkit-float]', 'mpw-rs-mark', 'mark'],
			['aside, [data-sidebar-left], [class*="_sidebar_"]:not([class*="_sidebar-right_"])', 'sidebarCol', 'sideonly'],
			['header, [class*="_header_"]', 'wSkVaW_header', 'wide'],
			['[class*="_floatHeader_"]', 'wSkVaW_header', 'wide']
		];
		let compatObserver = null;
		function applyCompatBridges(section) {
			try {
				if (section) applyCompatBridges._sec = section;
				const vw = window.innerWidth || 1200;
				const rightOn = !section || (section.rightSidebarBlur !== void 0 ? !!section.rightSidebarBlur : DEFAULT_RIGHT_SIDEBAR_BLUR);
				for (const [sel, cls, mode] of COMPAT_BRIDGES) {
					const isRight = /sidebar-right|dockkit/.test(sel);
					const vh0 = window.innerHeight || 800;
					document.querySelectorAll(sel).forEach((el) => {
						if (el.classList.contains(cls)) return;
						if (mode === 'wide') {
							const r = el.getBoundingClientRect();
							if (!(r.width >= vw * 0.6 && r.height > 0 && r.height <= 200)) return;
						}
						if (mode === 'mark') {
							try { el.setAttribute('data-mpw-rs', ''); } catch {}
							return;
						}
						if (mode === 'sideonly') {
							const r = el.getBoundingClientRect();
							if (!(r.height >= vh0 * 0.7 && r.width > 0 && r.width <= vw * 0.4)) return;
						}
						if (isRight && !rightOn) el.classList.remove(cls); else el.classList.add(cls);
					});
				}
			} catch (e) {}
		}
		function startCompatObserver() {
			try {
				if (compatObserver) return;
				compatObserver = new MutationObserver(() => { applyCompatBridges(applyCompatBridges._sec); });
				compatObserver.observe(document.documentElement, { childList: true, subtree: true });
			} catch (e) {}
		}

		const LG_EL_KEYS = [['lgComposer', '[data-composer-card], [data-slot*="composer"] [class*="card"], .wSkVaW_scrollBody'], ['lgSidebar', '[class*="sidebarCol"], [data-dsh-better-sidebar] [class*="_panel"], [data-dsh-better-sidebar] [class*="_bottomPanel"]'], ['lgHeader', '.wSkVaW_header, [class*="wSkVaW_header"]']];
		// ①(重做) 液态玻璃 bundle 用 **base64 内联**（LG_BUNDLE_B64 由 tools/inline-lg-b64.mjs
		function lgEnabled(section) {
			return !!(section && ((section.lgComposer !== void 0 ? !!section.lgComposer : false)
				|| (section.lgSidebar !== void 0 ? !!section.lgSidebar : false)
				|| (section.lgHeader !== void 0 ? !!section.lgHeader : false)));
		}
		function destroyLiquidGlass() {
			// ①(修正) CSS 版：只用 lgClearClasses 清除标记即可（WebGL 残留已删）
			lgClearClasses();
		}
		/** 收集当前启用的玻璃目标元素（按开关），返回 { el, shape } 列表。 */
		function lgTargets(section) {
			const out = [];
			for (const [key, sel] of LG_EL_KEYS) {
				if (!(section[key] !== void 0 ? !!section[key] : false)) continue;
				try {
					const el = document.querySelector(sel);
					if (el && el.getBoundingClientRect) { const r = el.getBoundingClientRect(); if (r.width > 20 && r.height > 20) out.push({ el, key }); }
				} catch {}
			}
			return out;
		}
		// ①(重做) 液态玻璃改为 **CSS 版**（方案1：稳定可靠，不崩）。
		//  之前用 WebGL 库（setBackdrop + 喂 DSH 元素坐标）bug：setBackdrop 用残留壁纸帧
		//  透出"已清除的壁纸"、overlay 模式取代目标区域内容（用户 4 张截图确认）。
		//  CSS 版：给目标元素加 backdrop-filter（磨砂）+ 半透明背景，模拟液态玻璃——
		//  不覆盖、不透壁纸（backdrop-filter 只模糊元素背后，不画壁纸帧）、不取代内容。
		const LG_CSS_ON = 'data-mpw-lg-css';
		function lgClearClasses() {
			try { document.querySelectorAll('[' + LG_CSS_ON + ']').forEach((el) => { try { el.removeAttribute(LG_CSS_ON); } catch {} }); } catch {}
		}
		async function applyLiquidGlass(section) {
			try {
				if (!lgEnabled(section)) { lgClearClasses(); destroyLiquidGlass(); return; }
				lgClearClasses();
				const targets = lgTargets(section);
				if (!targets.length) { setLgStatus("✗ 未匹配到玻璃目标元素"); destroyLiquidGlass(); return; }
				setLgStatus("✓ CSS 玻璃作用于 " + targets.length + " 个元素");
				// 给每个目标元素标记，buildCss 的 lg 规则会让它变玻璃（backdrop-filter 磨砂）
				targets.forEach((t) => { try { t.el.setAttribute(LG_CSS_ON, ""); } catch {} });
			} catch (err) { console.warn("[dsh-mpkg-wallpaper] 液态玻璃 CSS 应用失败:", err); setLgStatus("✗ " + (err && err.message || err)); }
		}
		/** 静态渐变兜底背景（视频不可用时）。 */

		// ═══════════════════════════════════════════════════════════════════
		//  🔋(新) 省电（遮挡暂停三档，借鉴 elysia395）：页面最小化/切页、窗口失焦、
		//  电池供电时自动暂停壁纸视频（解码归零），回到界面/接通电源自动继续。
		//  三档独立开关（powPauseHidden/powPauseBlur/powPauseBattery），持久保存。
		// ═══════════════════════════════════════════════════════════════════
		let powBattery = null;          // BatteryManager（getBattery 探测）
		let powBatteryAsked = false;
		let powPaused = false;          // 当前是否被省电暂停
		let powHiddenNow = false;       // 页面当前隐藏
		let powFocusedNow = true;       // 窗口当前聚焦
		/** 当前壁纸视频暂停（停住画面）。 */
		/** web 壁纸 iframe 内所有 video/audio 暂停（省电/暂停按钮对 web 生效）。 */
		function pauseWebFrame() {
			try {
				const { frame } = bgElements();
				if (!frame) return;
				// ①(2026-09-16 I 项) shim 通道：不透明源读不到帧内 DOM → 由 shim 在帧内暂停
				webShimCall(frame, { op: "pause", value: true });
				const doc = frame.contentDocument;
				if (doc) {
					const els = doc.querySelectorAll("video,audio");
					for (let i = 0; i < els.length; i++) { try { els[i].pause(); } catch {} }
				}
			} catch {}
		}
		/** web 壁纸 iframe 内所有 video/audio 恢复播放。 */
		function resumeWebFrame() {
			try {
				const { frame } = bgElements();
				if (!frame) return;
				webShimCall(frame, { op: "pause", value: false });
				const doc = frame.contentDocument;
				if (doc) {
					const els = doc.querySelectorAll("video,audio");
					for (let i = 0; i < els.length; i++) { try { const p = els[i].play(); if (p && p.catch) p.catch(() => {}); } catch {} }
				}
			} catch {}
		}
		function pauseWallpaperVideo() {
			try {
				const { video, frame } = bgElements();
				if (video && !video.paused) video.pause();
				if (frame && frame.style.display !== "none") pauseWebFrame();
			} catch {}
		}
		/** 当前壁纸视频恢复播放（用户手动暂停时恢复——由调用方判断, 见 toggleWallPause）。 */
		function resumeWallpaperVideo() {
			try {
				const s = readSection();
				if (!(s.enabled !== void 0 ? !!s.enabled : true)) return;
				const { video, frame } = bgElements();
				if (video && video.paused && video.src) {
					try { const p = video.play(); if (p && p.catch) p.catch(() => {}); } catch {}
				}
				if (frame && frame.style.display !== "none") resumeWebFrame();
			} catch {}
		}
		/** 按三档状态决定暂停/恢复（任一档触发即暂停，全恢复才继续）。 */
		function updatePowerPause() {
			try {
				const s = readSection();
				const hiddenOn = s.powPauseHidden !== void 0 ? !!s.powPauseHidden : false;
				const blurOn = s.powPauseBlur !== void 0 ? !!s.powPauseBlur : false;
				const battOn = s.powPauseBattery !== void 0 ? !!s.powPauseBattery : false;
				const shouldPause = (hiddenOn && powHiddenNow) || (blurOn && !powFocusedNow) || (battOn && powBattery && powBattery.charging === false);
				if (shouldPause && !powPaused) { powPaused = true; pauseWallpaperVideo(); }
				else if (!shouldPause && powPaused) { powPaused = false; resumeWallpaperVideo(); }
			} catch {}
		}
		/** 注册省电监听（一次性）。 */
		function setupPowerSave() {
			if (window.__mpwPowerWired) return;
			window.__mpwPowerWired = true;
			try {
				document.addEventListener("visibilitychange", () => {
					powHiddenNow = document.hidden === true;
					updatePowerPause();
				});
			} catch {}
			try {
				window.addEventListener("blur", () => { powFocusedNow = false; updatePowerPause(); });
				window.addEventListener("focus", () => { powFocusedNow = true; updatePowerPause(); });
			} catch {}
			// 电池状态（非标准 API，存在则用，不存在静默跳过）
			try {
				if (typeof navigator !== "undefined" && navigator.getBattery && !powBatteryAsked) {
					powBatteryAsked = true;
					navigator.getBattery().then((b) => {
						powBattery = b;
						b.addEventListener("chargingchange", () => updatePowerPause());
						b.addEventListener("levelchange", () => updatePowerPause());
						updatePowerPause();
					}).catch(() => {});
				}
			} catch {}
			// 初始化一次
			try { powHiddenNow = !!(document && document.hidden); updatePowerPause(); } catch {}
		}
		/** ①(修正) 设置页暂停标志更新 + 派发 mpw:wallpaused 事件，供按钮实时刷新。
		 *  - source='user'：用户点按钮 → 改权威 wallUserPaused + 执行暂停/恢复。
		 *  - source='video'：视频实际 play/pause 事件 → **只派发展示事件**，不改权威值。
		 *    （否则 video 加载新 src 时的瞬态 pause 会把「未暂停」误置「已暂停」，跳过门控。）
		 *  - source='state'：设置页内部同步显示（不改权威）。 */
		function setWallPausedByUserState(paused, source) {
			try {
				if (source === "user") {
					wallUserPaused = paused;
					if (paused) pauseWallpaperVideo();
					else resumeWallpaperVideo();
					// ①(修正) notifySectionChanged 只在用户操作时触发（改权威值后刷新设置页）；
					// video 实际 play/pause 事件（source 非 user）不触发，避免每帧瞬态多余通知。
					try { notifySectionChanged(); } catch {}
				}
				window.dispatchEvent(new CustomEvent("mpw:wallpaused", { detail: { paused: wallUserPaused } }));
			} catch {}
		}
		function toggleWallPause() {
			setWallPausedByUserState(!wallUserPaused, "user");
		}

		// ═══════════════════════════════════════════════════════════════════
		//  ⑲(新) Aqua 实验模式（借鉴 Bil812 fork；默认全关，不影响原功能）
		//  - 统一雾：#mpw-aqua-mask 全屏覆盖层（z-index:-1，壁纸之上内容之下）
		//  - 壁纸取色：48×48 平均色 → --mpw-panel-tint → --mpw-mask-rgb
		//  - 自适应文字色 + 蓝色清理：mask 亮度 → 亮字/深字，brand 覆写为墨色
		// ═══════════════════════════════════════════════════════════════════
		let aquaMaskEl = null;
		let aquaTintHooked = new WeakSet();
		let aquaTintSig = "";
		function aquaOn(section) {
			return (section.aquaMask !== void 0 ? !!section.aquaMask : DEFAULT_AQUA_MASK)
				|| (section.aquaTint !== void 0 ? !!section.aquaTint : DEFAULT_AQUA_TINT)
				|| (section.aquaInk !== void 0 ? !!section.aquaInk : DEFAULT_AQUA_INK);
		}
		// ═══ ①(新 2026-09-13 第15项) 纯 CSS/SVG 液态玻璃 ═══
		//   原理（Chromium 支持，Android WebView 同为 Chromium）：
		//     backdrop-filter: blur(Npx) saturate(1.25) url(#mpw-lg-warp)
		//   其中 #mpw-lg-warp 用 feImage(位移贴图) + feDisplacementMap 让"背后内容"在玻璃边缘产生折射；
		//   位移贴图用 data-URI SVG 现画（中间灰=不位移，边缘渐变=向内折射），比 WebGL 逐面 FBO 便宜得多，
		//   也不会占用 WebGL 上下文（scene 壁纸同时播放时不会互相抢 GPU）。
		//   不支持 url() 形式 backdrop-filter 的环境自动回退为纯模糊（见 buildCss）。
		const LG_FILTER_ID = "mpw-lg-warp";
		function lgCssSupported() {
			try { return !!(window.CSS && CSS.supports && CSS.supports("backdrop-filter", "url(#mpw-lg-warp)")); } catch { return false; }
		}
		function ensureLgSvgFilter(scale) {
			try {
				let svg = document.getElementById("mpw-lg-svg");
				if (!svg) {
					svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
					svg.setAttribute("id", "mpw-lg-svg");
					svg.setAttribute("aria-hidden", "true");
					svg.setAttribute("width", "0"); svg.setAttribute("height", "0");
					svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
					document.body.appendChild(svg);
				}
				// 位移贴图：1024×1024，四周 6% 边缘做"向内折射"渐变，中间 #808080 = 零位移
				const inner = "#808080", edge = "#666666";
				const map = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">` +
					`<defs><linearGradient id="gx" x1="0" x2="1"><stop offset="0" stop-color="${edge}"/><stop offset="0.06" stop-color="${inner}"/><stop offset="0.94" stop-color="${inner}"/><stop offset="1" stop-color="${edge}"/></linearGradient>` +
					`<linearGradient id="gy" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${edge}"/><stop offset="0.06" stop-color="${inner}"/><stop offset="0.94" stop-color="${inner}"/><stop offset="1" stop-color="${edge}"/></linearGradient>` +
					`<filter id="mix"><feBlend in="SourceGraphic" in2="SourceGraphic" mode="normal"/></filter></defs>` +
					`<rect width="1024" height="1024" fill="${inner}"/>` +
					`<rect width="1024" height="1024" fill="url(#gx)" style="mix-blend-mode:multiply"/>` +
					`<rect width="1024" height="1024" fill="url(#gy)" style="mix-blend-mode:multiply"/></svg>`;
				const href = "data:image/svg+xml;utf8," + encodeURIComponent(map);
				svg.innerHTML =
					`<filter id="${LG_FILTER_ID}" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">` +
					`<feImage href="${href}" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="map"/>` +
					`<feDisplacementMap in="SourceGraphic" in2="map" scale="${Math.max(0, scale)}" xChannelSelector="R" yChannelSelector="G"/>` +
					`</filter>`;
				window.__mpwLgSvgReady = true;
				return true;
			} catch { return false; }
		}

		function ensureAquaMask() {
			if (aquaMaskEl && aquaMaskEl.isConnected) return aquaMaskEl;
			aquaMaskEl = document.createElement("div");
			aquaMaskEl.id = "mpw-aqua-mask";
			aquaMaskEl.style.cssText = "position:fixed;inset:0;z-index:-1;pointer-events:none;display:none;";
			(document.body || document.documentElement).appendChild(aquaMaskEl);
			return aquaMaskEl;
		}
		function aquaParseHex(hex) {
			const h = String(hex || "").replace("#", "").trim();
			if (!/^[0-9a-fA-F]{3,8}$/.test(h)) return null;
			const full = h.length <= 4 ? h.split("").map((c) => c + c).join("").slice(0, 6) : h;
			return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
		}
		function aquaMixRgb(a, b, t) {
			return [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
		}
		function aquaHexOf(rgb) {
			return "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
		}
		/** 自适应文字色：暗遮罩 → 亮字 / 亮遮罩 → 深字（固定高可读中性色）。 */
		function aquaInkForRgb(rgb) {
			const er = rgb[0], eg = rgb[1], eb = rgb[2];
			const luma = (0.299 * er + 0.587 * eg + 0.114 * eb) / 255;
			return luma <= 0.6
				? { luma, ink: "#eef1f7", inkSecondary: "#c3cbd8", inkTertiary: "#aab4c4" }
				: { luma, ink: "#10141f", inkSecondary: "#3d4657", inkTertiary: "#5f6a7c" };
		}
		/** 遮罩有效色：自定义色 > 壁纸主色（亮主题掺 35%、暗主题掺 55%）> 主题中性色。
		 *  ①(修正) 第5项：aquaTint（面板颜色匹配壁纸）开时**忽略自定义色**——
		 *  二选一语义（开=自动匹配壁纸，取色盘禁用），避免已设的 aquaColor 仍
		 *  优先于自动采样（用户选择方案A）。 */
		function aquaEffectiveColor(section) {
			const darkTheme = !!(document.body && document.body.hasAttribute("data-ds-dark-theme"));
			const tintOn = section.aquaTint !== void 0 ? !!section.aquaTint : DEFAULT_AQUA_TINT;
			const custom = !tintOn && section.aquaColor && /^#[0-9a-fA-F]{3,8}$/.test(section.aquaColor) ? aquaParseHex(section.aquaColor) : null;
			if (custom) return custom;
			if (tintOn) {
				let raw = "";
				try { raw = getComputedStyle(document.documentElement).getPropertyValue("--mpw-panel-tint").trim(); } catch {}
				const parts = String(raw || "").trim().split(/\s+/).map(Number);
				if (parts.length >= 3 && !parts.some((v) => isNaN(v))) {
					const neutral = darkTheme ? [14, 20, 32] : [255, 255, 255];
					// ⑲(修正) 取色强度可调：aquaTintStrength 0-100（默认 45）
					const strength = Math.max(0, Math.min(100, section.aquaTintStrength !== void 0 ? section.aquaTintStrength : DEFAULT_AQUA_TINT_STRENGTH));
					const ratio = strength / 100;
					return [
						Math.round(ratio * parts[0] + (1 - ratio) * neutral[0]),
						Math.round(ratio * parts[1] + (1 - ratio) * neutral[1]),
						Math.round(ratio * parts[2] + (1 - ratio) * neutral[2])
					];
				}
			}
			return darkTheme ? [14, 20, 32] : [255, 255, 255];
		}
		/** ink 的反色：深 ink → 白；浅 ink → 深（用于按钮背景/图标保证对比）。 */
		function aquaInkContrast(inkHex) {
			const rgb = aquaParseHex(inkHex);
			if (!rgb) return "#ffffff";
			const luma = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
			return luma <= 0.5 ? "#ffffff" : "#10141f";
		}
		/** 自定义品牌色：aquaInkColor 有效时用它做品牌/主按钮色，否则用 ink。 */
		function aquaBrandColor(section) {
			if (section.aquaInkColor && /^#[0-9a-fA-F]{3,8}$/.test(section.aquaInkColor)) return section.aquaInkColor;
			let inkRaw = "";
			try { inkRaw = getComputedStyle(document.documentElement).getPropertyValue("--mpw-aqua-ink").trim(); } catch {}
			return inkRaw || "#10141f";
		}
		/** 刷新 Aqua：设 CSS 变量 + 全屏遮罩背景；关闭时清理。 */
		function refreshAqua() {
			try {
				const s = readSection();
				const enabled = s.enabled !== void 0 ? !!s.enabled : DEFAULT_ENABLED;
				const on = aquaOn(s);
				const root = document.documentElement;
				const el = ensureAquaMask();
				if (!on || !enabled || !s.image) {
					el.style.display = "none";
					for (const p of ["--mpw-aqua-rgb", "--mpw-aqua-ink", "--mpw-aqua-ink-secondary", "--mpw-aqua-ink-tertiary"]) root.style.removeProperty(p);
					// ①(2026-09-16 bug①) 同步撤掉 token 覆盖门控：ink 变量已清 → CSS 里的
					// `body[data-mpw-aqua][data-mpw-aqua-ink]` 覆盖随之失效，不会出现
					// "token 指向不存在的变量 → guaranteed-invalid → 背景变透明"。
					try { document.body.removeAttribute("data-mpw-aqua-ink") } catch {}
					aquaTintSig = "";
					return;
				}
				const rgb = aquaEffectiveColor(s);
				const info = aquaInkForRgb(rgb);
				root.style.setProperty("--mpw-aqua-rgb", `${rgb[0]} ${rgb[1]} ${rgb[2]}`);
				root.style.setProperty("--mpw-aqua-ink", info.ink);
				root.style.setProperty("--mpw-aqua-ink-secondary", info.inkSecondary);
				root.style.setProperty("--mpw-aqua-ink-tertiary", info.inkTertiary);
				root.style.setProperty("--mpw-aqua-ink-contrast", aquaInkContrast(info.ink));
				root.style.setProperty("--mpw-aqua-brand-contrast", aquaInkContrast(aquaBrandColor(s)));
				// ①(2026-09-16 bug①) 打门控属性（此时 ink 一定可用）
				try { document.body.setAttribute("data-mpw-aqua-ink", "1") } catch {}
				const maskOn = s.aquaMask !== void 0 ? !!s.aquaMask : DEFAULT_AQUA_MASK;
				if (maskOn) {
					let panel = Math.max(0, Math.min(100, s.aquaMaskAlpha !== void 0 ? s.aquaMaskAlpha : DEFAULT_AQUA_MASK_ALPHA)) / 100;
					// ①(修正) 亮色遮罩防过曝：自定义色偏亮（luma>0.6）时自动把强度
					// 压到 ≤55%，避免全屏亮色雾把画面洗白（用户实测：预置色 1/5 变白）
					const luma = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
					if (luma > 0.6) panel = Math.min(panel, 0.55);
					el.style.background = `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${panel})`;
					el.style.display = "";
				} else {
					el.style.display = "none";
				}
			} catch {}
		}
		/**
		 * ①(2026-09-16 bug①) 右侧「轮次导航条」对比色兜底。
		 * 宿主组件：dsh-client-ui-chat 的 TurnNavigator.module.css → .eGxaPq_mark::before，
		 * 条的颜色 token（判据）：
		 *   · 默认态 --dsw-alias-border-l4          （宿主值 #00000029 / #fff3 = 16%/20% alpha）
		 *   · hover  --dsw-alias-label-tertiary
		 *   · 激活态 --dsw-alias-label-primary
		 *   · focus  --dsw-alias-state-business-primary
		 * 这些 token 定义在宿主 body/body[data-ds-dark-theme] 上，且默认态本身是**极低对比**的
		 * 半透明色 —— 它假定条背后是**不透明表面**。壁纸模式把聊天区表面透明化后，条与壁纸
		 * 混色 ⇒ 用户观感"条变透明"。
		 * 修法（收窄作用域 + 只用我们自己的命名空间）：
		 *   · 不再全局重定义任何宿主 token（旧写法见 buildCss 里已收窄的 sidebar-fill 覆盖）；
		 *   · 按主题写我们自己的 --mpw-rail-ink / --mpw-rail-ink-strong；
		 *   · CSS 侧只在 body[data-mpw-rail-ink] 门控下、且只对明确白名单的 .eGxaPq_* 节点生效。
		 * 回退：URL 加 ?railink=off（或 body 去掉 data-mpw-rail-ink）→ 宿主样式原样不动。
		 */
		function refreshRailInk() {
			try {
				const s = readSection();
				const enabled = s.enabled !== void 0 ? !!s.enabled : DEFAULT_ENABLED;
				// ③(2026-09-16) 壁纸判据与 syncHeaderFrost **对齐**：原来只看持久化字段，而 image 经
				//   normalizeSection 可能是空串/布尔 ⇒ 同一页面上"顶栏有磨砂、rail 却被判成无壁纸"的
				//   自相矛盾（这条不一致本身就是"条又看不见了"的一个来源）。
				//   顺序：持久化字段优先，其次查**实际在显示的**壁纸层（与磨砂链同款兜底）。
				const hasWall = !!(s.image || s.webUrl || s.video) || (() => {
					try {
						const w = document.getElementById(BG_WRAP_ID);
						if (w && w.style && w.style.display !== "none") return true;
						const im = document.getElementById(BG_IMG_ID);
						return !!(im && (im.getAttribute("src") || im.currentSrc));
					} catch { return false }
				})();
				const off = (() => { try { return new URLSearchParams(location.search).get("railink") === "off" } catch { return false } })();
				const on = enabled && hasWall && !off;
				if (!on) {
					try { document.body.removeAttribute("data-mpw-rail-ink") } catch {}
					try {
						document.documentElement.style.removeProperty("--mpw-rail-ink");
						document.documentElement.style.removeProperty("--mpw-rail-ink-strong");
						document.documentElement.style.removeProperty("--mpw-rail-halo");   // ③(2026-09-16) 晕色同步清理，不留残留
					} catch {}
					return;
				}
				const dark = !!(document.body && document.body.hasAttribute && document.body.hasAttribute("data-ds-dark-theme"));
				const ink = dark ? "rgba(255, 255, 255, 0.46)" : "rgba(0, 0, 0, 0.42)";
				const strong = dark ? "rgba(255, 255, 255, 0.92)" : "rgba(0, 0, 0, 0.86)";
				// ③(2026-09-16) 反色晕：条本身是"深色条(亮主题)/浅色条(暗主题)"，晕就取反，
				//   保证条压在**任意深浅壁纸**上都有一圈对比边（可见性的最后一道保险）。
				const halo = dark ? "rgba(0, 0, 0, 0.55)" : "rgba(255, 255, 255, 0.55)";
				try {
					document.documentElement.style.setProperty("--mpw-rail-ink", ink);
					document.documentElement.style.setProperty("--mpw-rail-ink-strong", strong);
					document.documentElement.style.setProperty("--mpw-rail-halo", halo);
				} catch {}
				try { document.body.setAttribute("data-mpw-rail-ink", "1") } catch {}
			} catch {}
		}
		/** 从当前壁纸抽主色（48×48 平均色）→ --mpw-panel-tint。 */
		function applyAquaTint() {
			try {
				const s = readSection();
				// ①(2026-09-16 bug①) 关闭时撤掉 token 覆盖门控（变量不再写 → 覆盖必须同步失效）
				if (!(s.aquaTint !== void 0 ? !!s.aquaTint : DEFAULT_AQUA_TINT)) {
					try { document.body.removeAttribute("data-mpw-text-ink") } catch {}
					return;
				}
				const { img, video } = bgElements();
				const src = (video && video.readyState >= 2 && video.videoWidth > 0)
					? video
					: (img && img.complete && img.naturalWidth > 0 ? img : null);
				if (!src) return;
				const S = 48;
				const canvas = document.createElement("canvas");
				canvas.width = S; canvas.height = S;
				const ctx = canvas.getContext("2d", { willReadFrequently: true });
				if (!ctx) return;
				ctx.drawImage(src, 0, 0, S, S);
				const data = ctx.getImageData(0, 0, S, S).data;
				let r = 0, g = 0, b = 0, n = 0;
				for (let i = 0; i < data.length; i += 4) {
					if (data[i + 3] < 128) continue;
					r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
				}
				if (!n) return;
				const R = Math.round(r / n), G = Math.round(g / n), B = Math.round(b / n);
				const sig = `${R},${G},${B}`;
				if (sig === aquaTintSig) return;
				aquaTintSig = sig;
				document.documentElement.style.setProperty("--mpw-panel-tint", `${R} ${G} ${B}`);
				// ①(#16 用户要求) 自适应文字色：按壁纸区域**感知亮度**决定文字取白还是取黑。
				//   这不是"只把经过深色处的字变白"（CSS 无法逐像素判定），而是按整片壁纸的
				//   亮度自动切换文字 token —— 用户已确认采用该方案。感知亮度用 Rec.709 权重。
				try {
					const luma = (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255;
					const lightText = luma < 0.5;
					const root = document.documentElement.style;
					root.setProperty("--mpw-text-ink", lightText ? "#ffffff" : "#0e1116");
					root.setProperty("--mpw-text-ink-dim", lightText ? "rgba(255,255,255,0.82)" : "rgba(14,17,22,0.82)");
					root.setProperty("--mpw-text-luma", String(luma.toFixed(3)));
					// ①(2026-09-16 bug①) 打门控属性（此时 --mpw-text-ink 一定可用）
					try { document.body.setAttribute("data-mpw-text-ink", "1") } catch {}
				} catch {}
				refreshAqua();
			} catch {}
		}
		/** 监听壁纸加载/播放，周期刷新取色（视频/GIF 节流 2s）。 */
		// ①(修正 2026-09-13 第2/3项) 取色是**同步的重活**（canvas 绘制 + getImageData + 全量 CSS 重建），
		//   开关一打开就同步跑 → 用户实测"卡一下子"，开关圆点动画也被吞掉。这里：
		//   ① 合并同一帧内的多次请求（pending 标记）② 延迟到下一帧之后执行（rAF + setTimeout 0）
		//   ③ 定时器句柄集中管理，避免每次 apply 累积未清理的 setTimeout。
		let aquaTintPending = false;
		function scheduleAquaTintSoon(immediate) {
			if (aquaTintPending) return;
			aquaTintPending = true;
			const run = () => { aquaTintPending = false; try { applyAquaTint(); } catch {} };
			try {
				if (!immediate && typeof requestAnimationFrame === "function") requestAnimationFrame(() => setTimeout(run, 0));
				else setTimeout(run, 0);
			} catch { run(); }
		}
		function scheduleAquaTint() {
			try {
				const { img, video } = bgElements();
				if (!img && !video) return;
				const doTint = () => scheduleAquaTintSoon(false);
				if (img && !aquaTintHooked.has(img)) {
					aquaTintHooked.add(img);
					img.addEventListener("load", doTint, { passive: true });
				}
				// ①(#18 冷启动) 元素可能**已经加载完成**（插件晚于壁纸挂载）→ 事件永不再触发，
				//   取色/自适应文字色在冷启动下就一直不生效。这里立刻补一次 + 延时兜底。
				if (img && img.complete && img.naturalWidth) doTint();
				if (video && video.readyState >= 2) doTint();
				setTimeout(doTint, 400);
				setTimeout(doTint, 1500);   // 冷启动兜底（两次都经 pending 合并，不会重复跑）
				if (video && !aquaTintHooked.has(video)) {
					aquaTintHooked.add(video);
					video.addEventListener("loadeddata", doTint, { passive: true });
					let last = 0;
					video.addEventListener("timeupdate", () => {
						const now = Date.now();
						if (now - last < 2000) return;
						last = now;
						doTint();
					}, { passive: true });
				}
			} catch {}
		}
		/** Aqua 开启时的 token 覆盖（mask 色背景 + ink 文字 + 蓝色清理），合并进 applyTokenOverrides。 */
		function aquaTokenOverrides(section) {
			const darkTheme = !!(document.body && document.body.hasAttribute("data-ds-dark-theme"));
			let maskRaw = "";
			try { maskRaw = getComputedStyle(document.documentElement).getPropertyValue("--mpw-aqua-rgb").trim(); } catch {}
			const parts = String(maskRaw || "").trim().split(/\s+/).map(Number);
			if (parts.length < 3 || parts.some((v) => isNaN(v))) return null;
			const rgb = parts;
			const info = aquaInkForRgb(rgb);
			const tinted = (alpha) => `color-mix(in srgb, rgb(var(--mpw-aqua-rgb)) ${Math.round(alpha * 100)}%, transparent)`;
			// ①(修正) 职责分离：aquaTint（面板取色）只影响**面板/表面**颜色；
			// **弹层**（菜单/选择器/下拉/提示等）透明只归 aquaMask（统一雾）管——
			// 用户实测 aquaTint 开时 full access/加号/模型/推理/上下文选择器被变透明（不该）
			const tintOn = section.aquaTint !== void 0 ? !!section.aquaTint : DEFAULT_AQUA_TINT;
			const maskOn = section.aquaMask !== void 0 ? !!section.aquaMask : DEFAULT_AQUA_MASK;
			const out = {};
			// 主画布 + 面板/表面类（取色或统一雾开启时生效）
			if (tintOn || maskOn) {
				Object.assign(out, {
					"--dsw-alias-bg-base": { light: tinted(0.62), dark: tinted(0.62) },
					"--dsw-specific-sidebar-fill": { light: tinted(0.85), dark: tinted(0.85) },
					"--dsw-specific-sidebar-nav-item-active": { light: tinted(0.72), dark: tinted(0.72) },
					"--dsw-specific-sidebar-nav-item-hover": { light: tinted(0.6), dark: tinted(0.6) },
					"--dsw-specific-sidebar-nav-item-active-accent": { light: tinted(0.6), dark: tinted(0.6) },
					"--dsw-specific-bubble": { light: tinted(0.84), dark: tinted(0.84) },
					"--dsw-specific-bubble-highlight": { light: tinted(0.92), dark: tinted(0.92) },
					"--dsw-alias-button-elevated-fill": { light: tinted(0.78), dark: tinted(0.78) },
					"--dsw-alias-button-floating-fill": { light: tinted(0.85), dark: tinted(0.85) },
					"--dsw-alias-button-ghost-active-fill": { light: tinted(0.7), dark: tinted(0.7) },
					"--dsw-alias-button-ghost-active-border": { light: tinted(0.6), dark: tinted(0.6) },
					"--dsw-alias-button-contrast-fill": { light: tinted(0.9), dark: tinted(0.9) },
					"--dsw-alias-interactive-bg-selected": { light: tinted(0.68), dark: tinted(0.68) },
					// ①(修正 2026-09-13 第16项) 0.1.5 现役名（旧名已不存在 → 之前选中态没被着色）
					"--dsw-alias-interactive-bg-active": { light: tinted(0.68), dark: tinted(0.68) },
					"--dsw-alias-interactive-bg-hover": { light: tinted(0.55), dark: tinted(0.55) },
					"--dsw-alias-interactive-bg-hover-solid": { light: tinted(0.72), dark: tinted(0.72) },
					"--dsw-alias-markdown-inline-code": { light: tinted(0.24), dark: tinted(0.24) },
					"--dsw-alias-markdown-code-block": { light: tinted(0.32), dark: tinted(0.32) }
				});
			}
			// 弹层类（仅统一雾开启时透明——取色不该管弹层）
			if (maskOn) {
				Object.assign(out, {
					"--dsw-alias-bg-overlay": { light: tinted(0.72), dark: tinted(0.72) },
					"--dsw-alias-bg-layer-2": { light: tinted(0.72), dark: tinted(0.72) },
					"--dsw-alias-bg-layer-3": { light: tinted(0.72), dark: tinted(0.72) },
					// ①(修正 2026-09-13) 菜单/下拉/提示类弹层：alpha 抬到 0.92/0.9 —— 即使浮层的
					//   backdrop-filter 在某些祖先组合下失效（backdrop root 边界），也不会"看得穿"。
					"--dsw-specific-menu": { light: tinted(0.92), dark: tinted(0.92) },
					"--dsw-specific-selector": { light: tinted(0.9), dark: tinted(0.9) },
					"--dsw-specific-tip": { light: tinted(0.92), dark: tinted(0.92) },
					"--dsw-specific-input-major": { light: tinted(0.9), dark: tinted(0.9) },
					"--dsw-alias-bg-module-platform": { light: tinted(0.86), dark: tinted(0.86) },
					"--dsw-alias-bg-multi-select": { light: tinted(0.82), dark: tinted(0.82) },
					"--dsw-alias-tooltip-bg": { light: `color-mix(in srgb, rgb(var(--mpw-aqua-rgb)) 96%, var(--dsw-static-neutral-bluish-850))`, dark: `color-mix(in srgb, rgb(var(--mpw-aqua-rgb)) 96%, var(--dsw-static-neutral-bluish-850))` },
					"--dsw-alias-toast-bg": { light: tinted(0.9), dark: tinted(0.9) }
				});
			}
			const inkOn = section.aquaInk !== void 0 ? !!section.aquaInk : DEFAULT_AQUA_INK;
			if (inkOn) {
				// ⑲(修正) 品牌色支持自定义（aquaInkColor 取色器）：默认用 ink，
				// 自定义色时按钮/发送键/插件文字用自定义色，保证对比（用户实测默认 ink 让发送键看不清）
				const brand = aquaBrandColor(section);
				out["--dsw-alias-label-primary"] = { light: info.ink, dark: info.ink };
				out["--dsw-alias-label-secondary"] = { light: info.inkSecondary, dark: info.inkSecondary };
				out["--dsw-alias-label-tertiary"] = { light: info.inkTertiary, dark: info.inkTertiary };
				out["--dsw-alias-brand-primary"] = { light: brand, dark: brand };
				out["--dsw-alias-brand-text"] = { light: brand, dark: brand };
				out["--dsw-alias-button-info-fill"] = { light: brand, dark: brand };
				out["--dsw-alias-button-info-hover"] = { light: brand, dark: brand };
			}
			return out;
		}

		/**
		 * ⑭ 用 token override 实现对话框/弹层半透明（参考 ui-theme-background-custom 方案）。
		 * DSH 的弹层/菜单/对话框背景由 --dsw-alias-bg-overlay 驱动；主画布由
		 * --dsw-alias-bg-base 驱动、侧边栏由 --dsw-specific-sidebar-fill 驱动。
		 * overrideTokens 从 token 层面让这些表面半透明，弹层自动跟随（不猜类名），
		 * 背景壁纸在 z-index:-1 层透过半透明表面显示 → 对话框虚化跟随背景位置颜色。
		 */
		function applyTokenOverrides(ctx, section) {
			if (!ctx || !ctx.theme || typeof ctx.theme.overrideTokens !== "function") return;
			// ①(修正) 液态玻璃测试模式（lgTest）：不覆盖任何 token——否则 --dsw-alias-bg-base
			// 被设成半透明（float 时 0.35），buildCss 的 2610 兜底 `var(--dsw-alias-bg-base)`
			// 读到的也是半透明 → 输入框变透明无模糊（用户实测：lgTest 开启后聊天框透明）。
			// lgTest 下直接 return，让 DSH 原生不透明背景生效。
			if (section && (section.lgTest !== void 0 ? !!section.lgTest : false)) {
				try { if (tokenDisposer) { tokenDisposer(); tokenDisposer = null; } } catch {}
				return;
			}
			const enabled = section.enabled !== void 0 ? !!section.enabled : DEFAULT_ENABLED;
			// ①(修正) web 壁纸（image 为 "" 但 webUrl 存在）也算"有背景"——否则对话框/表面
			// 透明度按"无背景"处理，web 壁纸下不透明（用户实测）。
			const hasImage = !!(section.image || section.webUrl);
			const dialogBlur = section.dialogBlur !== void 0 ? !!section.dialogBlur : DEFAULT_DIALOG_BLUR;
			const opacity = section.opacity !== void 0 ? section.opacity : DEFAULT_OPACITY;
			// ③(新) 统一虚化：主画布底透明度跟随 opacity（白雾厚度与侧边栏一致）
			const unifyTint = section.unifyTint !== void 0 ? !!section.unifyTint : DEFAULT_UNIFY_TINT;
			// 弹层/菜单/设置面板背景保持 DSH 原色，通过 token 变半透明
			//（颜色跟随主题，不覆盖背景；配合 buildCss 的 backdrop-filter blur）。
			// 透明度：虚化开 → 60-75% 半透明；关/无背景 → 还原。
			let a = 1;
			const bdOk = window.__mpwBackdropRendered !== false;
			if (enabled && hasImage && dialogBlur && bdOk) {
				const panel = Math.max(50, Math.min(100, opacity)) / 100;
				a = Math.min(0.78, 0.60 + 0.15 * (1 - panel));
			}
			const toAlpha = (staticVar, alpha) => `color-mix(in srgb, var(${staticVar}) ${Math.round(alpha * 100)}%, transparent)`;
			// 主画布背景（聊天区）白雾：
			//  - 统一虚化开 → 跟随「不透明度」条（panel/100，与侧边栏/标题栏一致）；
			//    聊天区壁纸模糊由壁纸层 blur 提供（chatFollow 决定归谁管，见 applyFromStorage）
			//  - 统一虚化关 → 0.62（原默认，跟随 dialogBlur）
			const baseAlphaRaw = enabled && hasImage && dialogBlur
				? (unifyTint
					? Math.max(0, Math.min(1, (Math.max(50, Math.min(100, opacity)) / 100)))
					: 0.62)
				: 1;
			// A(新) 悬浮效果开启时：聊天区自动更通透（整体透出壁纸）
			const floatOn2 = section.float !== void 0 ? !!section.float : DEFAULT_FLOAT;
			const baseAlpha = floatOn2 && enabled && hasImage ? Math.min(baseAlphaRaw, 0.35) : baseAlphaRaw;
			const overrides = {
				// 主画布背景半透明 → 壁纸透到所有区域（含输入框背后），
				// 这样输入框/弹层的 backdrop-filter 才能模糊到壁纸（Aqua 生效的关键）。
				// 透明度 0.62：壁纸可见且文字可读。
				"--dsw-alias-bg-base": {
					light: toAlpha("--dsw-static-neutral-bluish-00", baseAlpha),
					dark: toAlpha("--dsw-static-neutral-bluish-950", baseAlpha)
				},
				"--dsw-alias-bg-overlay": {
					light: toAlpha("--dsw-static-neutral-bluish-150", a),
					dark: toAlpha("--dsw-static-neutral-bluish-700", a)
				},
				"--dsw-alias-bg-layer-2": {
					light: toAlpha("--dsw-static-neutral-bluish-50", a),
					dark: toAlpha("--dsw-static-neutral-bluish-850", a)
				},
				// 注意：input-major（composer 输入框）和 bubble（聊天气泡）不再由
				// token 控制——buildCss 的 CSS 已直接给 [data-composer-card] 设背景，
				// 双重半透明会导致颜色过深/发白。
				// ⑥(修正) layer-1 不再全局透明：该 token 被第三方插件 UI（如 dshmarket
				// 的分类卡片）使用，全透明会让他们显示异常（矩形区域透出壁纸）。
				// Deep diving 思考框背景由 buildCss 的 thinkBg 分支用 CSS 精确处理。
				"--dsw-alias-bg-layer-1": {
					light: toAlpha("--dsw-static-neutral-bluish-50", a),
					dark: toAlpha("--dsw-static-neutral-bluish-850", a)
				}
			};
			if (!(enabled && hasImage)) {
				try { if (tokenDisposer) { tokenDisposer(); tokenDisposer = null; } } catch {}
				return;
			}
			// ⑲(新) Aqua 实验模式：开时用 mask 色覆盖主要背景/文字 token（在现有 override 之后生效）
			try {
				if (aquaOn(section)) {
					const aquaOv = aquaTokenOverrides(section);
					if (aquaOv) Object.assign(overrides, aquaOv);
				}
			} catch {}
			try {
				if (tokenDisposer) { tokenDisposer(); tokenDisposer = null; }
				tokenDisposer = ctx.theme.overrideTokens("dsh-mpkg-wallpaper-tokens", overrides);
			} catch (err) { console.error("[dsh-mpkg-wallpaper] overrideTokens failed:", err); }
		}		/**
		 * ④(2026-09-17 对抗性审查) "隐藏列表 fade"清扫的**唯一命中判据**：只认**侧栏白名单子树**里的 fade。
		 *  为什么必须收窄：旧兜底是"任意 `position:absolute` + `bottom≈0` 的 fade 元素 → 内联
		 *  `display:none`"，粒度太粗 —— 第三方插件面板/宿主别处的底部渐隐同样命中（与 bug①
		 *  "rail 被藏掉"同一类误伤，只是命中点不同）。宿主那条"工作区列表底部白色虚化带"
		 *  必然在侧栏白名单内（CSS 孪生规则同域，见 buildCss 的 `[class*="fade"]` 规则），
		 *  所以收窄**不丢功能**；顺带去掉每次扫描的 `getComputedStyle` 强制布局
		 *  （弱 WebView 上每 120ms 一次的整文档扫描 + 强制布局 = 持续卡顿源）。
		 *  ⚠ tools/frost-rail-test.mjs 会把本函数的**返回值表达式**字符串替换成旧写法做
		 *  **反向对照**（证明断言有分辨力）——改这里的写法必须同步改测试，否则对照会失配。
		 */
		function mpwIsListFadeTarget(el) {
			const p = el.closest('[data-slot*="workspaces"], [data-slot="sidebar"], [class*="regionArea"], [class*="sidebarCol"]');
			return !!p;
		}
		/**
		 * ⑭ 内联应用对话框虚化 + fade 修复（绕过 CSS 选择器匹配问题）。
		 * CSS 选择器可能因 hash 类名/结构变化失配，这里直接用 JS 找到元素
		 * 并内联 backdrop-filter / 渐变，确保生效。
		 */
		function applyDialogInline(section) {
			const enabled = section.enabled !== void 0 ? !!section.enabled : DEFAULT_ENABLED;
			if (!enabled) return;
			const dialogBlur = section.dialogBlur !== void 0 ? !!section.dialogBlur : DEFAULT_DIALOG_BLUR;
			const dialogAmount = section.dialogAmount !== void 0 ? section.dialogAmount : DEFAULT_DIALOG_AMOUNT;
			const thinkBg = section.thinkBg !== void 0 ? !!section.thinkBg : DEFAULT_THINK_BG;
			const floatOn = section.float !== void 0 ? !!section.float : DEFAULT_FLOAT;
			const panel = Math.max(50, Math.min(100, section.opacity !== void 0 ? section.opacity : DEFAULT_OPACITY));
			// 对话框虚化：完全由 buildCss 的 CSS 控制。
			// 这里只处理 Deep diving 背景方框（见下方）
			// Deep diving 背景方框：开关控制（默认关 = 透明 + 文字可见色）
			const turnStatuses = document.querySelectorAll('[role="status"]');
			const thinkRows = document.querySelectorAll('[data-variant="think"]');
			if (thinkBg) {
				thinkRows.forEach((el) => { el.style.background = ""; });
				turnStatuses.forEach((el) => {
					el.style.background = "";
					el.style.color = "";
					el.style.webkitTextFillColor = "";
					el.style.webkitBackgroundClip = "";
					el.style.backgroundClip = "";
					el.style.backdropFilter = "";
					el.style.webkitBackdropFilter = "";
				});
			} else {
				thinkRows.forEach((el) => { el.style.background = "transparent"; });
				turnStatuses.forEach((el) => {
					el.style.background = "transparent";
					el.style.color = "var(--dsw-alias-label-secondary, #9aa4b2)";
					el.style.webkitTextFillColor = "var(--dsw-alias-label-secondary, #9aa4b2)";
					el.style.webkitBackgroundClip = "border-box";
					el.style.backgroundClip = "border-box";
					el.style.backdropFilter = "none";
					el.style.webkitBackdropFilter = "none";
				});
			}
			// fade 修复：用户要求直接取消列表底部的白色渐变（不要半透明，直接隐藏）
			// ①(2026-09-17 bug①**第四轮真机定案**，见 tools/rail-cover-probe.mjs) 旧白名单
			//   `[data-slot*="session"]` 会命中 `[data-slot="conversation.session"]`（会话区），
			//   而 DSH 的右侧轮次导航条 `.eGxaPq_scroller` 在**可滚动**时会挂上宿主的
			//   `.eGxaPq_fadeTop/.eGxaPq_fadeBottom`（类名同样含 "fade"）⇒ 命中本清扫
			//   ⇒ 整个条容器被写内联 `display:none`（MO 实测：fadeBottom 出现的那一帧被写）
			//   ⇒ 用户实测"右侧时间线条看不见、但点它还能跳轮次"（frame 仍 pointer-events:auto）。
			//   现在：**先整片排除会话区/rail**（两条选择器：宿主 rail 命名空间 + conversation* 子树），
			//   白名单也只保留**侧栏**（sidebar / workspaces / regionArea / sidebarCol）。
			document.querySelectorAll('[class*="fade"]').forEach((el) => {
				if (!el.className || el.className.indexOf("fade") < 0) return;
				// 会话区（含 rail 的 mask 类）一律不碰：那里的 fade 是宿主自己的视觉，
				// 不是我们要清理的"列表底部白色虚化带"。
				if (el.closest('[class*="eGxaPq_"], [data-slot^="conversation"]')) return;
				if (mpwIsListFadeTarget(el)) el.style.display = "none";
			});
		}
		/** MutationObserver 持续应用内联样式（React 重挂载时补打）。 */
		function startInlineWatcher(sectionRef) {
			let timer = null;
			const obs = new MutationObserver(() => {
				if (timer) return;
				timer = setTimeout(() => {
					timer = null;
					try {
						const sec = readSection();
						applyDialogInline(sec);
						// ①(修正) 悬浮开启时持续标记 sidebar root：刷新/路由切换后 React
						// 重渲染会重建 sidebar root 节点，属性丢失 → width:100% 失效 →
						// 内容被 overflow:hidden 切掉。observer 每次变更都补打。
						try {
							if (sec && sec.float !== void 0 ? !!sec.float : DEFAULT_FLOAT) {
								const sr = document.querySelector('[class*="sidebarCol"] [class*="root"]');
								if (sr && !sr.hasAttribute("data-mpw-sidebar-root")) sr.setAttribute("data-mpw-sidebar-root", "");
							}
						} catch {}
					} catch {}
				}, 120);
			});
			obs.observe(document.documentElement, { childList: true, subtree: true });
			// 1(修正) 持续标记 sidebar root（刷新/路由切换后 DSH 重渲染也能找到）
			try {
				const sr = document.querySelector('[class*="sidebarCol"] [class*="root"]');
				if (sr && !sr.hasAttribute("data-mpw-sidebar-root")) sr.setAttribute("data-mpw-sidebar-root", "");
			} catch {}
			return () => obs.disconnect();
		}

		// ①(新 2026-09-13 诊断) 暴露 buildCss 供离线校验/排障：__mpwBuildCss(patch) → CSS 文本。
		//   面板冒烟测试用它校验"生成 CSS 的花括号是否配平 / 关键锚点是否齐全"，
		//   避免再次出现"buildCss 抛错 → 样式表为空 → 整个画面错乱"这类只能靠刷新才发现的 bug。
		try {
			globalThis.__mpwBuildCss = (patch) => {
				try { return buildCss(Object.assign({}, readSection(), patch || {})); }
				catch (e) { return "/*BUILD_ERROR*/ " + (e && e.message); }
			};
		} catch {}
		// ①(2026-09-17 持久化轮) 壁纸持久化链路的测试/排障钩子（tools/persist-test.mjs 用；生产不引用）。
		//   暴露的是**真实现**：写入口 mpwPersistSection / 落 IDB mpwSpillImage / 阈值常量 / 回退开关，
		//   以及"上一次是否真的用到了 IndexedDB"（真机排障时 `__mpwPersist.state()` 一句话看清）。
		try {
			globalThis.__mpwPersist = {
				write: (sec) => mpwPersistSection(sec),
				read: () => readSection(),
				raw: () => { try { return localStorage.getItem(STORE_KEY) } catch { return null } },
				spill: (dataUrl) => mpwSpillImage(dataUrl),
				idbGet: (k) => idbGet(k || "bg"),
				idbKind: () => mpwIdbBgKind(),
				available: () => idbAvailable(),
				legacy: () => mpwPersistLegacy(),
				state: () => Object.assign({}, mpwPersistState),
				apply: () => { try { applyFromStorage() } catch (e) { return String((e && e.message) || e) } return "ok" },
				onMsg: (fn) => mpwPersistOnMsg(fn),
				failKey: MPW_PERSIST_FAIL_KEY,
				limits: { lsMax: MPW_LS_MAX_BYTES, spill: MPW_LS_SPILL_BYTES },
				key: STORE_KEY,
			};
		} catch {}
		// ①(新 2026-09-16 根治) 标题栏磨砂链路的测试钩子（tools/header-frost-test.mjs 用；生产不引用）。
		//   `sync` 直接跑同步函数；`state` 读回快照；`headerEl` 便于断言"宿主节点被标记"。
		//   暴露它同时解决"诊断只能靠真机"的问题：无浏览器也能断言注入链每一环。
		try {
			globalThis.__mpwHdrFrostTest = {
				sync: () => { try { syncHeaderFrost(); } catch (e) { return { ok: false, error: String((e && e.message) || e) } } return { ok: true } },
				state: () => { try { return JSON.parse(JSON.stringify(hdrFrostState)) } catch { return null } },
				headerEl: () => findHostHeader(),
				frostEl: () => { try { const h = findHostHeader(); return h ? h.querySelector(":scope > .mpw-hdrFrost") : null } catch { return null } },
				ensure: (px) => { try { return !!ensureHeaderFrost(px) } catch { return false } },
				// ①(2026-09-16) 诊断链路自证：直接跑"用户按诊断/上报"用的采集器，断言磨砂字段在里面
				diag: () => { try { return mpwHeaderFrostDiag() } catch { return null } },
				// ①(2026-09-17 切会话磨砂消失 bug) 自愈观察器的测试钩子：
				//   armed/targets/hits/queued 是"重挂载后到底靠谁补回来"的唯一判据（真机 diag 同字段）。
				watch: () => { try { const W = hdrFrostWatchState(); return { off: hdrFrostWatchOff(), armed: !!(W && W.mo), targets: (W && W.targets ? W.targets.length : 0), hits: (W && W.hits) || 0, queued: !!(W && W.queued) } } catch { return null } },
				collect: () => { try { return mpwDiagCollect() } catch (e) { return { err: String((e && e.message) || e) } } },
			};
			// ③(2026-09-16) rail 对比补偿的**自证钩子**：回归测试用它断言"值和门控真的落地了"
			//   （光有 CSS 规则不够 —— 本条 bug 的历史教训正是"规则在、值/门控没生效"）。
			globalThis.__mpwRailInkProbe = () => {
				try {
					const rs = () => getComputedStyle(document.documentElement);
					return {
						attr: !!(document.body && document.body.hasAttribute && document.body.hasAttribute('data-mpw-rail-ink')),
						on: (() => { try { return rs().getPropertyValue('--mpw-rail-ink').trim() } catch { return '' } })(),
						strong: (() => { try { return rs().getPropertyValue('--mpw-rail-ink-strong').trim() } catch { return '' } })(),
						halo: (() => { try { return rs().getPropertyValue('--mpw-rail-halo').trim() } catch { return '' } })(),
					};
				} catch { return null }
			};
			// ③(2026-09-16) 显式同步钩子：假 DOM 测试里 boot 路径可能因缺元素早退（真实 DOM 不会），
			//   这里让测试能**确定性**地跑一次 rail 计算，避免"断言永远量不到"的假绿/假红。
			globalThis.__mpwRailSync = () => { try { refreshRailInk(); return true } catch { return false } };
			// ①(2026-09-17 bug①第四轮) **回归探针**：让 tools/frost-rail-test.mjs 能在假 DOM 上
			//   真跑一次"隐藏列表 fade"清扫（applyDialogInline），断言
			//   **会话区/rail 永不被它内联 display:none**（真机根因，见 tools/rail-cover-probe.mjs）。
			//   与 __mpwRailInkProbe 同款：仅暴露"跑一次"的入口，不改行为。
			globalThis.__mpwFadeSweepProbe = () => { try { applyDialogInline(readSection()); return true } catch (e) { return String(e && e.message || e) } };
		} catch {}

		/** 仅更新 CSS 的预览（滑杆拖动时调用，避免 React 重渲染卡顿，③）。 */
		function previewCss(patch) {
			const merged = Object.assign({}, readSection(), patch);
			const el = getStyleEl();
			if (el) { try { el.textContent = buildCss(merged); } catch (err) { console.error("[dsh-mpkg-wallpaper] previewCss failed:", err); } }
			// 内联 backdrop-filter 同步（否则内联旧值覆盖 CSS 新值，虚化程度拉条失效）
			try { applyDialogInline(merged); } catch {}
		}
		/** buildCss 里 _noBlur=true 时临时关闭 backdrop-filter（拖动时降低重绘开销，①）。 */
		function effBlur(section, def) {
			return section._noBlur ? 0 : def;
		}

		// ═══════════════════════════════════════════════════════════════════
		//  CSS 生成
		//  注意：backdrop-filter 会为 fixed 定位子元素创建包含块，绝不能加在
		//  侧边栏/聊天区的根元素上（否则设置弹窗会被"关"在侧边栏里，①），
		//  只加在内部滚动容器上（regionArea / scrollBody / details body）。
		// ═══════════════════════════════════════════════════════════════════
		// ①(Qoder 审查 R1) themeColor 独立块提取为单函数，两分支共用：
		// 不依赖「标题栏透出/侧边栏透出」开关，只要设置了主题颜色就 tint
		// 侧边栏/标题栏/新会话按钮/设置弹窗。此前两处逐字重复，第4项再改
		// 时漏改一处（fa2e0e6 就是补漏 commit）——集中到一处避免再犯。
		function buildThemeColorCss() {
			return `
body[data-mpw-theme] .pI_x6G_sidebarCol {
	background-color: color-mix(in srgb, var(--mpw-theme-color) 30%, transparent) !important;
}
body[data-mpw-theme] .wSkVaW_header {
	background-color: color-mix(in srgb, var(--mpw-theme-color) 30%, transparent) !important;
}
body[data-mpw-theme] button[class*="newSession"] {
	background-color: color-mix(in srgb, var(--mpw-theme-color) 30%, transparent) !important;
}
body[data-mpw-theme] [class*="settingsArea"] [role="dialog"],
body[data-mpw-theme] [class*="settingsArea"] [role="alertdialog"] {
	background-color: color-mix(in srgb, var(--mpw-theme-color) 30%, transparent) !important;
}
`;
		}
		/* ═══════════════════════════════════════════════════════════════════════════
		   ①(2026-09-18 MASTER-TODO §5 第1项 / P0-3) 全插件**唯一一处**宿主 token 覆盖
		   ───────────────────────────────────────────────────────────────────────────
		   为什么必须保留（不是懒，是无替代）：
		     DSH 侧栏内层（工作区列表 / 会话列表 / 侧栏根）**自己**用
		     `--dsw-specific-sidebar-fill` 上底色。我们在外部只改显式规则时，内层会再叠一层
		     半透明块（用户实测"出现一个深灰色半透明块"）；反过来关掉"侧栏透出壁纸"时，
		     内层仍会透出一点 ⇒ 用户观感"开关没用"（2026-09-13 两次真机实测）。
		     即：要让这个开关真的生效，只能改这一个 token。
		   代价与三条约束（机器校验见 tools/style-scope-guard.mjs 的 HOST_OVERRIDE_REGISTRY）：
		     ① 只覆盖 `--dsw-specific-sidebar-fill` 一个 token；
		     ② 只打在我们管理的**侧栏白名单容器**上（?sbfill=wide 才回退旧的全局写法）；
		     ③ 只有两种值：功能开=`transparent`、功能关=主题静态不透明色；永不写 inherit/unset
		        或任何会「让宿主组件失色」的退化值，也永不碰 rail 家族（--dsw-alias-border-l4 /
		        --dsw-alias-label-primary）。
		   历史事故：旧的裸 `html body { --dsw-specific-sidebar-fill: transparent }` 是**全局**
		   覆盖 —— 连轨迹（trajectory）面板表头 `th{background:var(--dsw-specific-sidebar-fill)}`
		   这类与我们无关的宿主表面一起变透明。收窄选择器就是那次事故的修复。
		   账本：docs/TOKEN-NAMESPACE.md「宿主 token 覆盖登记表」。
		   mode: 'translucent'（侧栏透出壁纸开）| 'opaque'（关 → 恢复不透明）
		   wide: true = `?sbfill=wide` 回退开关（全局覆盖，仅排障用） */
		function buildSidebarFillCss(mode, wide) {
			const FILL = '--dsw-specific-sidebar-fill';
			const NARROW = `html body .pI_x6G_sidebarCol,
html body [class*="sidebarCol"]:not([class*="_tab"]),
html body .hHd-Xa_root,
html body [data-slot="sidebar"]`;
			const NARROW_DARK = `html body[data-ds-dark-theme] .pI_x6G_sidebarCol,
html body[data-ds-dark-theme] [class*="sidebarCol"]:not([class*="_tab"]),
html body[data-ds-dark-theme] .hHd-Xa_root,
html body[data-ds-dark-theme] [data-slot="sidebar"]`;
			const sel = wide ? 'html body' : NARROW;
			const selDark = wide ? 'html body[data-ds-dark-theme]' : NARROW_DARK;
			if (mode === 'translucent') {
				// 侧栏透出壁纸开：token 置透明 ⇒ 整栏只由容器那一层承担半透明（不叠双层）
				return `${sel} {
	${FILL}: transparent !important;
}
`;
			}
			// 侧栏透出壁纸关：token 回到主题静态不透明色（亮=白 / 暗=深色）
			return `${sel} {
	${FILL}: var(--mpw-surface-opaque-side) !important;
}
${selDark} {
	${FILL}: var(--mpw-surface-opaque-side-dark) !important;
}
`;
		}
		function buildCss(section) {
			// ③(修正) 总开关关闭时统一视为无背景：所有路径（applyFromStorage/previewCss）
			// 都走同一逻辑，避免拖动滑块时 previewCss 绕过 enabled 检查把壁纸又显示出来
			if (section && section.enabled === false) {
				section = Object.assign({}, section, { image: "" });
			}
			// ①(新) 液态玻璃测试模式（lgTest）：只保留壁纸 + 悬浮 + 布局，
			// 外观类（虚化/模糊/雾/主题色/时钟等）全部禁用——纯环境测玻璃效果。
			if (section && (section.lgTest !== void 0 ? !!section.lgTest : false)) {
				section = Object.assign({}, section, {
					// ①(修正) opacity 压到面板下限 50（panel clamp 50-100）→ 配合 sidebar:true
					// 侧边栏走 Math.min(40, panel)=40% 半透明，透出壁纸（玻璃折射需要）。
					// 之前没覆盖 opacity → panel 仍 82% → 侧边栏不透明（用户实测"测试模式
					// 不作用于侧边栏"）。blur 也压 0（磨砂条不影响侧边栏透壁纸）。
					opacity: 50, blur: 0, dialogBlur: false, dialogAmount: 0, settingsBlur: false, settingsAmount: 0,
					confirmBlur: false, confirmAmount: 0, popoverBlur: false, popoverAmount: 0,
					maskBlur: false, maskAmount: 0, unifyTint: false, unifyAmount: 0, sidebarAlpha: 0,
					chatFollow: false, sessionFollow: false, sidebarBlur: false, sidebarBlurAmount: 0,
					headerBlur: false, headerBlurAmount: 0, headerBg: false, aquaMask: false, aquaTint: false,
					aquaInk: false, aquaTextEnhance: false, todoBlur: false, clock: false, clock24h: false,
					clockSec: false, clockDate: false, themeColor: "", accent: "", glassWindow: false,
					// ①(修正) lgTest 测试模式下侧边栏**不透明**（sidebar:false）：用户实测
					// 测试模式侧边栏透壁纸，界面花、看不清内容。测试模式要的是干净对比界面
					// （壁纸在右侧聊天区可测玻璃），侧边栏不透明便于看清。
					sidebar: false, sharp: false,
				});
			}
			// ①(新) 悬浮效果开关（buildCss 内声明，之前误加在 applyFromStorage 里导致 ReferenceError）
			const floatOn = section.float !== void 0 ? !!section.float : DEFAULT_FLOAT;
			// ①(修正) buildCss 对 web 壁纸（image 为 ""/undefined）也必须视为"有背景"——
			// 否则 hasImage=false → 生成 .mpw-bgWrap{display:none} → 整个壁纸层(含 iframe)被隐藏
			// → 星野 web 壁纸 clear 后导入完全空白（用户实测）。webUrl 存在即视为有背景。
			const hasImage = !!(section && (section.image || section.webUrl));
			const opacity = section.opacity !== void 0 ? section.opacity : DEFAULT_OPACITY;
			// 磨砂条 blur：不走 effBlur（_noBlur 拖动时临时关掉会闪），壁纸层 blur 实时
			const blur = section.blur !== void 0 ? section.blur : DEFAULT_BLUR;
			const sidebar = section.sidebar !== void 0 ? !!section.sidebar : DEFAULT_SIDEBAR;
			// ①(2026-09-16 bug①) 侧栏底色 token 覆盖的作用域开关：
			//   默认（false）=**收窄**到明确白名单容器（不再全局改宿主 token）；
			//   `?sbfill=wide`（true）= 恢复旧的全局面板覆盖（一键回退）。
			const sbfillWide = (() => { try { return new URLSearchParams(location.search).get("sbfill") === "wide" } catch { return false } })();
			const headerBlur = section.headerBlur !== void 0 ? !!section.headerBlur : DEFAULT_HEADER;
			const headerBg = section.headerBg !== void 0 ? !!section.headerBg : DEFAULT_HEADER_BG;
			const dialogBlur = section.dialogBlur !== void 0 ? !!section.dialogBlur : DEFAULT_DIALOG_BLUR;
			const dialogAmount = section.dialogAmount !== void 0 ? section.dialogAmount : DEFAULT_DIALOG_AMOUNT;
			// ①(新) 虚化对话框拆三类：设置面板 / 下载确认弹窗 各自独立开关+程度
			const settingsBlur = section.settingsBlur !== void 0 ? !!section.settingsBlur : DEFAULT_SETTINGS_BLUR;
			const settingsAmount = section.settingsAmount !== void 0 ? section.settingsAmount : DEFAULT_SETTINGS_AMOUNT;
			const confirmBlur = section.confirmBlur !== void 0 ? !!section.confirmBlur : DEFAULT_CONFIRM_BLUR;
			const confirmAmount = section.confirmAmount !== void 0 ? section.confirmAmount : DEFAULT_CONFIRM_AMOUNT;
			// ①(新) 侧边栏磨砂（Aqua 方案：sidebarCol 自身 backdrop-filter）
			const sidebarBlur = section.sidebarBlur !== void 0 ? !!section.sidebarBlur : DEFAULT_SIDEBAR_BLUR;
			const sidebarBlurAmount = section.sidebarBlurAmount !== void 0 ? section.sidebarBlurAmount : DEFAULT_SIDEBAR_BLUR_AMOUNT;
			// ①(新) 右侧边栏/dock 独立参数（0.1.5 自带右栏 + dockkit 浮层）
			const rsBlur = section.rightSidebarBlur !== void 0 ? !!section.rightSidebarBlur : DEFAULT_RIGHT_SIDEBAR_BLUR;
			const rsAmount = section.rightSidebarBlurAmount !== void 0 ? section.rightSidebarBlurAmount : DEFAULT_RIGHT_SIDEBAR_AMOUNT;
			const rsAlpha = section.rightSidebarAlpha !== void 0 ? section.rightSidebarAlpha : DEFAULT_RIGHT_SIDEBAR_ALPHA;
			// ②(修正) chatFollow（统一虚化开时聊天区是否跟随整屏虚化）：关 → 聊天区
			// 壁纸由磨砂条控制，侧边栏/标题栏虚化由 G 块 backdrop blur(unifyAmount) 提供
			const chatFollowInCss = section.chatFollow !== void 0 ? !!section.chatFollow : DEFAULT_CHAT_FOLLOW;
			// ②(新) 弹层虚化（菜单/提示/遮罩）独立于对话框虚化
			const popoverBlur = section.popoverBlur !== void 0 ? !!section.popoverBlur : DEFAULT_POPOVER_BLUR;
			const popoverAmount = section.popoverAmount !== void 0 ? section.popoverAmount : DEFAULT_POPOVER_AMOUNT;
			// ②(重做) 遮罩虚化（设置/弹层打开时的全屏背景）独立于弹层虚化
			const maskBlur = section.maskBlur !== void 0 ? !!section.maskBlur : DEFAULT_MASK_BLUR;
			const maskAmount = section.maskAmount !== void 0 ? section.maskAmount : DEFAULT_MASK_AMOUNT;
			const thinkBg = section.thinkBg !== void 0 ? !!section.thinkBg : DEFAULT_THINK_BG;
			const panel = Math.max(50, Math.min(100, opacity));
			const details = Math.min(100, panel + 3);
			const hideBg = hasImage && panel >= 100;
			// ③(新) 统一虚化：所有表面白雾厚度一致 = panel%（跟随外观-不透明度条）。
			// unifyTint=true 时各区域不再用各自写死的百分比，全部用 U(原值)=panel，
			// 视觉上侧边栏/聊天区/标题栏/输入框不再"一块白一块透"地分裂背景。
			const unifyTint = section.unifyTint !== void 0 ? !!section.unifyTint : DEFAULT_UNIFY_TINT;
			// ①(重做) 统一虚化：unifyTint 开时 unifyAmount 控制**壁纸层真实 blur**（虚化程度）：
			// 0px = 壁纸清晰，40px = 强模糊。表面白雾统一由「不透明度」条（panel）控制
			//（不再把 unifyAmount 映射成透明度——那只是"改白雾厚度"，不是"改虚化程度"）。
			const unifyAmount = section.unifyAmount !== void 0 ? section.unifyAmount : DEFAULT_UNIFY_AMOUNT;
			// 侧边栏/标题栏白雾厚度：统一虚化开 → sidebarAlpha 独立条；关 → 各区域原值
			const uAlpha = Math.max(0, Math.min(100, (section.sidebarAlpha !== void 0 ? section.sidebarAlpha : DEFAULT_SIDEBAR_ALPHA)));
			const U = (v) => unifyTint ? uAlpha : v;
			// 区域 backdrop-filter：unify 开 → none（壁纸层 blur 接管）；关 → 磨砂条
			const blurFilter = unifyTint ? "none" : (blur > 0 ? `blur(${blur}px)` : "none");
			// ①(修正) 设置界面污染 bug 根治：**彻底移除**所有对侧边栏/标题栏的
			// backdrop-filter 与 z-index 干预（历史多次实测均引发弹窗被盖/图标被盖/
			// 分离模糊块问题）。毛玻璃统一走**壁纸层 filter blur**（--mpw-bg-blur）+
			// 表面 sidebarAlpha 半透明透出 —— 零 z-index、零 backdrop-filter、
			// 不困弹窗、不盖内容、设置界面 100% 干净。
			const frostedLayers = "";
			/* ═══════════════════════════════════════════════════════════════════════
			   表面 token SSOT（单一来源）——MASTER-TODO §5 第 1 项 / P0-3「磨砂·主题一致性」
			   ───────────────────────────────────────────────────────────────────────
			   问题（两次真机事故的机制）：顶栏 / 侧栏 / 面板 / 时间线条四处**各自**去
			   `color-mix(..., var(--dsw-static-neutral-bluish-XX), ...)`，同一个"半透明表面"
			   在四个地方有四份写法。改一处忘一处 → 四处厚度/取色漂移；更要命的是为了修
			   某一处而去**重定义宿主 token**，把宿主自己的组件一起改了（P0-2 事故）。
			   结构上的解法（本块）：
			     · **只有这里**（`tok()` 记录 + `emitSurfaceTokens()` 输出）会写出
			       `--mpw-surface-*` 定义；宿主 token 只在**这里**被消费成我们命名空间的值；
			     · 四个表面（顶栏 .wSkVaW_header / 侧栏 sidebarCol / 面板 dialog·弹层 /
			       时间线条 rail）的底色·磨砂半径·透明度**只写 `var(--mpw-surface-*)`**，
			       规则里不再出现 `var(--dsw-*)`；
			     · 值仍然是在各自的推导点算出来的（不复制公式 ⇒ 默认档行为逐字节不变），
			       只是**汇总到唯一一处输出**。
			   判据/清单/为什么不直接写 :root 常量：docs/TOKEN-NAMESPACE.md
			   ═══════════════════════════════════════════════════════════════════════ */
			const surfaceTokens = Object.create(null);
			const surfaceTokenKeys = [];
			/** 登记一枚表面 token（值仍由推导点给出，避免公式二次实现导致漂移）。 */
			const tok = (name, value) => {
				if (value === void 0 || value === null || value === "") return;
				if (!(name in surfaceTokens)) surfaceTokenKeys.push(name);
				surfaceTokens[name] = String(value);
			};
			/** 把登记的 surface token 输出成**唯一**的定义块（两条 return 路径都过它）。
			 *  ①(2026-09-18 §5 第1项) **必须打在 body 上，不能打 :root**：
			 *    DSH 把 --dsw-static-* / --dsw-alias-* 定义在 **body**
			 *    （@deepseek-ai/dsh-client-ui-theme/lib/client.js 的 `body{--dsw-static-neutral-bluish-00:#fff;…}`；
			 *     实测 `html` 上没有这些定义）。自定义属性里的 var() 在**声明所在的元素**上求值：
			 *    若把 `var(--dsw-static-neutral-bluish-00)` 写在 :root，html 上解析不出来 ⇒ 该自定义属性
			 *    变成 guaranteed-invalid，并**作为继承值传给所有后代** ⇒ 消费者的 background/backdrop
			 *    全部 invalid-at-computed-value-time（= unset/transparent）。这正是本仓历史上
			 *    「右侧时间线条变透明」的同一机制（docs/TIMELINE-RAIL-TOKEN.md §2/§5），所以这里
			 *    宁可打 body（已登记进 tools/style-scope-guard.mjs 的 ROOT_POLICY.registeredRootTokenRules）。 */
			const emitSurfaceTokens = (cssText) => {
				if (!surfaceTokenKeys.length) return cssText;
				const decls = surfaceTokenKeys.map((k) => `\t${k}: ${surfaceTokens[k]};`).join("\n");
				return cssText + `
/* ── 表面 token SSOT（唯一来源）：顶栏 / 侧栏 / 面板 / 时间线条 四处共用 ──
   宿主 token 只在本块里被消费；四个表面的规则只写 var(--mpw-surface-*)。
   为什么是 body 而不是 :root：宿主的 --dsw-* 定义在 body，写在 :root 会 guaranteed-invalid
   并继承下去（历史事故机制）。账本：docs/TOKEN-NAMESPACE.md */
body {
${decls}
}
`;
			};
			/* ②「面板」表面的常量档（与 hasImage 无关 ⇒ 两条 return 路径都要有）：
			   居中窗口不透明兜底 / overlay 内对话框 80% 磨砂 / 本插件弹窗 / 输入框卡片。
			   值 = 原来散在 4 处的写法，逐字保留。 */
			tok("--mpw-surface-panel", "var(--dsw-static-neutral-bluish-00)");
			tok("--mpw-surface-panel-dark", "var(--dsw-static-neutral-bluish-950)");
			tok("--mpw-surface-panel-frost", "color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 80%, transparent)");
			tok("--mpw-surface-panel-frost-dark", "color-mix(in srgb, var(--dsw-static-neutral-bluish-950) 80%, transparent)");
			tok("--mpw-surface-dialog-dark", "var(--dsw-static-neutral-bluish-950)");
			tok("--mpw-surface-dialog-light", "var(--dsw-static-neutral-bluish-00)");
			tok("--mpw-surface-dialog-frost-dark", "color-mix(in srgb, var(--dsw-static-neutral-bluish-950) 80%, transparent)");
			tok("--mpw-surface-dialog-frost-light", "color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 80%, transparent)");
			tok("--mpw-surface-composer", "color-mix(in srgb, #1b2233 42%, transparent)");
			tok("--mpw-surface-composer-light", "color-mix(in srgb, #dde3ee 55%, transparent)");
			/* 设置页右区（我们的 .mpw_glassHost）表面 */
			tok("--mpw-surface-glass", "color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 62%, transparent)");
			tok("--mpw-surface-glass-dark", "color-mix(in srgb, var(--dsw-static-neutral-bluish-950) 62%, transparent)");
			/* 内容区 / 宿主插件面板（面板家族）：unify 开 → static 色系，关 → bg-base 混色，逐字保留 */
			tok("--mpw-surface-content", unifyTint
				? `color-mix(in srgb, var(--dsw-static-neutral-bluish-950) ${U(details)}%, transparent)`
				: `color-mix(in srgb, var(--dsw-alias-bg-base) ${U(details)}%, transparent)`);
			tok("--mpw-surface-content-unify-light", `color-mix(in srgb, var(--dsw-static-neutral-bluish-00) ${U(details)}%, transparent)`);
			tok("--mpw-surface-plugin-panel", unifyTint
				? `color-mix(in srgb, var(--dsw-static-neutral-bluish-950) ${U(62)}%, transparent)`
				: `color-mix(in srgb, var(--dsw-alias-bg-base) ${U(62)}%, transparent)`);
			tok("--mpw-surface-plugin-panel-unify-light", `color-mix(in srgb, var(--dsw-static-neutral-bluish-00) ${U(62)}%, transparent)`);
			tok("--mpw-surface-plugin-row", unifyTint
				? `color-mix(in srgb, var(--dsw-static-neutral-bluish-950) ${U(55)}%, transparent)`
				: `color-mix(in srgb, var(--dsw-alias-bg-base) ${U(55)}%, transparent)`);
			tok("--mpw-surface-plugin-row-unify-light", `color-mix(in srgb, var(--dsw-static-neutral-bluish-00) ${U(55)}%, transparent)`);
			/* 右栏全屏（[data-rightbar-fullscreen]）面板表面：带 fallback 的旧写法逐字保留在值里 */
			tok("--mpw-surface-rs-full", "rgba(var(--mpw-chrome-bg, 255,255,255), calc(var(--mpw-rs-alpha, 0.45) * 0.55))");
			/* 「把侧栏底色交还宿主」用的 token：无壁纸档不覆盖宿主 token，只是原样读回来。
			   SSOT 在 body 上，而宿主正是在 body 定义 --dsw-specific-sidebar-fill ⇒ var() 在这里能解析
			   （写在 :root 会 guaranteed-invalid，见 emitSurfaceTokens 注释）。 */
			tok("--mpw-surface-host-side", "var(--dsw-specific-sidebar-fill)");
			/* 侧栏内第三方插件槽位（[data-slot="sidebar"] [data-plugin]）的兜底雾底 */
			tok("--mpw-surface-side-plugin", "color-mix(in srgb, var(--dsw-alias-bg-base) 45%, transparent)");
			let css = `/* ── 背景插件 dsh-mpkg-wallpaper v3 生成的样式 ── */\n`;
			// ①(修正) 灰字颜色必须在 buildCss 最开头生成——否则无壁纸分支（if(!hasImage)）
			// 会提前 return，这段样式根本不会注入（用户实测开灰字开关没效果：正因没设壁纸）。
			// ①(修正) 开启但未选自定义色 → 保持主题灰（= 关闭态，一致）；只有显式选了
			// fontColorGrayColor 才注入覆盖规则。避免"自引用 var(--dsw-alias-label-secondary)"
			// 造成循环/无效，也满足用户「关闭与开启默认颜色一致」。
			const gcGray = section.fontColorGrayColor && /^#[0-9a-fA-F]{6}$/.test(section.fontColorGrayColor) ? section.fontColorGrayColor : null;
			if ((section.fontColorGray !== void 0 ? !!section.fontColorGray : false) && gcGray) {
				css += `
/* ── PR3: 自定义灰色字颜色（fontColorGray，独立开关） ── */
body {
	--dsw-alias-label-secondary: ${gcGray} !important;
	--dsw-alias-label-tertiary: ${gcGray} !important;
	--dsw-alias-label-caption: ${gcGray} !important;
	--dsw-alias-label-dimmed: ${gcGray} !important;
	--dsw-alias-label-quaternary: ${gcGray} !important;
	--dsw-alias-label-primary-bluish: ${gcGray} !important;
	--dsw-alias-label-primary-dimmed: ${gcGray} !important;
	--dsw-alias-label-primary-foreground: ${gcGray} !important;
	--dsw-alias-label-inverse: ${gcGray} !important;
	--dsw-alias-label-primary-inverted: ${gcGray} !important;
	--dsw-alias-label-error: ${gcGray} !important;
	--dsw-alias-line-secondary: ${gcGray} !important;          /* 旧名（0.1.4-），保留兼容 */
	--dsw-alias-separator-primary: ${gcGray} !important;
	--dsw-alias-border-secondary: ${gcGray} !important;        /* 旧名（0.1.4-），保留兼容 */
	/* ①(修正 2026-09-13 第16项 token 漂移) 0.1.5 里 line-secondary/border-secondary 已不存在 →
	   换成现役等价 token，否则"灰色字全量覆盖"这几条静默失效（用户实测部分灰字没跟着变）。 */
	--dsw-alias-border-l2: ${gcGray} !important;
	--dsw-alias-border-l3: ${gcGray} !important;
	--dsw-alias-state-warn-label: ${gcGray} !important;
}
`;
			}
			if (!hasImage) {
				// ② 未设置背景时：不显示壁纸层，面板恢复不透明（默认外观）
				css += `
html, body { background: transparent !important; }
.mpw-bgWrap { display: none !important; }
.pI_x6G_frame { background-color: var(--dsw-alias-bg-base) !important; }
.pI_x6G_sidebarCol,
.hHd-Xa_root { background-color: var(--mpw-surface-host-side) !important; }
.wSkVaW_root { background-color: var(--dsw-alias-bg-base) !important; }
.ydkMvW_root { background-color: var(--dsw-alias-bg-base) !important; }
`;
				// ①(修正) 无壁纸也必须生成弹窗规则——否则弹窗实心底 / mask 虚化在
				// 无背景时全部缺失 → 弹窗透明字叠字、遮罩无模糊（用户多次实测，
				// 之前这些规则在 early return 之后从未生成）。
				const bdNoWall = !!(window && window.__mpwBackdropRendered !== false);
				const blurNoWall = (maskBlur && maskAmount > 0 && bdNoWall) ? `blur(${maskAmount}px)` : "none";
				css += `
/* 弹窗兜底：不透明（防透出/防字叠字） */
.mpw_dialog {
	background: var(--mpw-surface-dialog-dark) !important;
}
body:not([data-ds-dark-theme]) .mpw_dialog {
	background: var(--mpw-surface-dialog-light) !important;
}
/* 遮罩虚化：无条件（无壁纸也要模糊，否则字叠字）。
   ①(修正) 只作用于插件自己的弹窗遮罩 .mpw_mask——原 [class*="mask"] 宽匹配会
   命中 DSH 原生设置面板的 full-viewport overlay（渲染在 sidebarCol 内，类名含 mask），
   backdrop-filter 使它成为 fixed 弹窗的包含块 → 设置被"困"在侧边栏宽度里无法居中
   （用户实测：Termux X11 + Firefox 下设置被挤进侧边栏成窄长条）。 */
/* ①(修正) 遮罩虚化作用于 DSH 弹窗遮罩（[class$="_mask"]，如 BInVoG_mask/fNh4Da_mask/
   VOzbGW_mask——session 导出弹窗的遮罩） + 插件自己的 .mpw_mask。原收窄成 .mpw_mask
   后 DSH 遮罩失去模糊 → session 导出弹窗遮罩效果变差（用户实测）。用 $= 结尾匹配
   只命中真正的遮罩类，不会误伤设置 overlay（其类名中间含 mask 但不以 _mask 结尾）。 */
[class$="_mask"], .mpw_mask {
	backdrop-filter: ${blurNoWall} !important;
	-webkit-backdrop-filter: ${blurNoWall} !important;
}
/* 遮罩背景加深（防字叠字） */
[class$="_mask"], .mpw_mask { background: rgba(0,0,0,0.55) !important; }
`;
				// ①(修正) 主题颜色(themeColor) 独立块（第4项）：无壁纸分支也输出——
				// 不依赖透出开关，只要设置了主题颜色就 tint 侧边栏/标题栏/新会话/设置弹窗。
				css += buildThemeColorCss();
				return emitSurfaceTokens(css + buildUiCss(section, false));
			}
			// ①(新 2026-09-16 第 11 条) 网页壁纸交互舞台的样式（唯一源 = lib/web-interaction.js 的
	//   WEB_INTERACT_STAGE_CSS；改那边要同步这里，tools/web-interaction-test.mjs 会断言两边一致）。
	css += `
.mpw-bgWrap .mpw-webInteract{position:fixed;inset:0;z-index:1;display:none;background:transparent;cursor:crosshair;pointer-events:auto;}
.mpw-bgWrap.mpw-webInteract-on .mpw-webInteract{display:block;}
html[data-mpw-interact="on"] body{pointer-events:none !important;}
html[data-mpw-interact="on"] .mpw-bgWrap .mpw-webInteract{pointer-events:auto !important;}
.mpw-bgWrap .mpw-webInteractExit{position:fixed;right:12px;top:12px;z-index:2;pointer-events:auto;cursor:pointer;font:12px/1.6 ui-sans-serif,system-ui,sans-serif;color:#fff;background:rgba(24,26,34,.82);border:1px solid rgba(255,255,255,.28);border-radius:8px;padding:6px 10px;display:none;}
html[data-mpw-interact="on"] .mpw-bgWrap .mpw-webInteractExit{display:block;}
.mpw-bgWrap .mpw-webInteractBtn{position:fixed;right:12px;bottom:12px;z-index:2;pointer-events:auto;cursor:pointer;font:12px/1.6 ui-sans-serif,system-ui,sans-serif;color:#fff;background:rgba(24,26,34,.72);border:1px solid rgba(255,255,255,.22);border-radius:8px;padding:6px 10px;display:none;}
.mpw-bgWrap.mpw-web .mpw-webInteractBtn{display:block;}
`;
			/* ①(2026-09-18 §5 第1项) 侧栏表面 token：宿主 token 只在这里被消费。
			   亮/暗两套值的差异（unify 开时暗色也用 950；关时亮色用 00、暗色用 950）原样保留。 */
			tok("--mpw-surface-side", unifyTint
				? `color-mix(in srgb, var(--dsw-static-neutral-bluish-950) ${U(panel)}%, transparent)`
				: `color-mix(in srgb, var(--dsw-static-neutral-bluish-00) ${Math.min(30, panel)}%, transparent)`);
			tok("--mpw-surface-side-dark", unifyTint
				? `color-mix(in srgb, var(--dsw-static-neutral-bluish-950) ${U(panel)}%, transparent)`
				: `color-mix(in srgb, var(--dsw-static-neutral-bluish-950) ${Math.min(30, panel)}%, transparent)`);
			/* 统一虚化档的亮色覆盖（原 `body:not([data-ds-dark-theme]) .pI_x6G_sidebarCol` 那条） */
			tok("--mpw-surface-side-unify-light", `color-mix(in srgb, var(--dsw-static-neutral-bluish-00) ${U(panel)}%, transparent)`);
			css += `
html, body {
	background: transparent !important;
}
.mpw-bgWrap {
	position: fixed; inset: 0; z-index: -1; overflow: hidden; pointer-events: none;
	/* 缩放 <100% 时边缘露出底色（③），避免透明露白 */
	background-color: var(--dsw-alias-bg-base, #0e1420);
}
/* ①(加固) img/video 显示由 CSS 类控制（避免切换残留） */
.mpw-bgWrap.mpw-img video { display: none !important; }
.mpw-bgWrap.mpw-video img { display: none !important; }
/* ①(新) 网页壁纸 iframe：全屏覆盖，与 img/video 互斥（类控制显示） */
.mpw-bgWrap.mpw-web img,
.mpw-bgWrap.mpw-web video { display: none !important; }
.mpw-bgWrap iframe.mpw-webFrame {
	position: absolute; inset: 0; width: 100%; height: 100%; border: 0;
	background: transparent; display: none;
}
.mpw-bgWrap.mpw-web iframe.mpw-webFrame { display: block; }
/* ①(新) 场景图层合成 canvas：全屏覆盖，与 img/video/iframe 互斥 */
.mpw-bgWrap.mpw-scene img,
.mpw-bgWrap.mpw-scene video,
.mpw-bgWrap.mpw-scene iframe.mpw-webFrame { display: none !important; }
.mpw-bgWrap canvas.mpw-bgCanvas {
	position: absolute; inset: 0; width: 100%; height: 100%; display: none;
}
.mpw-bgWrap.mpw-scene canvas.mpw-bgCanvas { display: block; }
/* ①(批次15 B1) 场景首帧看门狗兜底：mpw-scene-fallback 出现在场景壁纸（mpw-web）上时
   隐藏 iframe、显示静态帧 img（img 需 !important 压过 ensureBgDom/showWebEl 的内联 display:none；
   iframe 需 !important 压过 .mpw-web iframe 的 display:block）。看门狗确认/重试时移除该类即恢复。 */
.mpw-bgWrap.mpw-scene-fallback iframe.mpw-webFrame { display: none !important; }
.mpw-bgWrap.mpw-scene-fallback img.mpw-bgImg { display: block !important; }
/* ①(修正) Edge 视频 canvas 渲染路径：showVideoEdge 给 wrap 加 mpw-video 类 + 清空
   canvas 内联 display（=回退到 CSS）——但原 CSS 只有 .mpw-scene 才 display:block，
   Edge 走视频路径时 canvas 被 CSS display:none 藏住 → 壁纸空白（用户实测：Edge
   转码/原生都空白，Firefox/Via 走原生 video 正常）。补 .mpw-video 时 canvas 显示。 */
.mpw-bgWrap.mpw-video canvas.mpw-bgCanvas { display: block; }
.mpw-bgWrap img,
.mpw-bgWrap video {
	width: 100%; height: 100%; object-fit: cover;
	/* ④(修正) 镜头：translate 在前、scale 在后 → 平移量不被缩放影响
	   （原 scale 在前导致 zoom>100 时平移被放大、zoom<100 时平移不够，
	   用户反馈"只能渲染整个屏幕的位置"）。transform 列表从左到右复合，
	   translate() scale() = 先缩放后平移（平移是原始像素）。 */
	transform: translate(var(--mpw-lensX, 0), var(--mpw-lensY, 0)) scale(var(--mpw-zoom, 1)) scaleX(var(--mpw-flip-x, 1)) scaleY(var(--mpw-flip-y, 1));
	transform-origin: center center;
	/* ⑯ 磨砂模糊条：壁纸层自身 blur，拖到 0 = 完全清晰 */
	filter: var(--mpw-bg-blur, none) brightness(var(--mpw-brightness, 1)) ${section.sharp !== void 0 && !section.sharp ? "" : "contrast(1.06) saturate(1.12)"};
}
.mpw-bgWrap.mpw-sharp {
	/* ②(修正) sharp 类不能覆盖掉 brightness（原来只写 contrast/saturate → 亮度失效） */
	filter: brightness(var(--mpw-brightness, 1)) contrast(1.06) saturate(1.12);
}
.pI_x6G_frame {
	background-color: transparent !important;
}
/* 侧边栏根（半透明，不设 backdrop-filter）。
   ③(新) 取色统一：unify 开时用主题静态色 panel%（与聊天区 bg-base 同色系同厚度，
   不再用 sidebar-fill 导致侧边栏与聊天区颜色不同、背景被"分裂"）。
   ①(修正) sidebar（侧边栏透出壁纸开关）开时**独立于面板不透明度**：用低 alpha
   真正透出壁纸（用户实测：opacity=82 时 sidebar-fill 82% 混合几乎不透，开关
   看似失效）。关 = 走下方 if(!sidebar) 不透明分支。 */
${sidebar ? `/* ①(修正 2026-09-13 用户第3项：侧边栏透出没效果) 三层一起上，避免"某层不透明把效果挡住"：
   ①token 层：--dsw-specific-sidebar-fill 改成 **transparent**（关键：DSH 的"工作区/会话列表"等
     内层也用这个 token 上底色，若 token 仍是半透明，就会在侧边栏之上再叠一层 → 用户实测
     "出现一个深灰色半透明块"。置为透明后整栏只有容器那一层半透明，观感干净）；
   ②显式层：sidebarCol / hHd-Xa_root / better-sidebar 面板 / 任何 [class*="sidebarCol"] 全覆盖；
   ③特异性：加 html body 前缀（此前 (0,1,0) 会被 DSH 或统一虚化的 (0,2,1) 规则压掉）。
   ①(2026-09-16 bug①收窄，**关键**) 旧写法是裸的 html body { --dsw-specific-sidebar-fill: transparent }，
   即**全局**改宿主 token：DSH 里所有用该 token 的组件都会跟着变透明 —— 包括轨迹（trajectory）
   面板的表头 th{background:var(--dsw-specific-sidebar-fill)} 等与我们无关的宿主表面。
   现在收窄到**明确白名单容器**（只覆盖我们确实要透明化的侧栏子树；token 会被后代继承，
   所以侧栏内层依旧透明，效果不变）。回退：?sbfill=wide 恢复旧的全局覆盖。 */
${buildSidebarFillCss('translucent', sbfillWide)}
/* 只让**容器**承担半透明层（内层 .hHd-Xa_root 由 DSH 用 --dsw-specific-sidebar-fill 上色，
   而上面已把该 token 置为 transparent → 自动变透明）。这样整栏只有一层半透明，
   不会出现"工作区/会话列表上又叠一个深色块"的双层观感。 */
html body .pI_x6G_sidebarCol,
html body [class*="sidebarCol"]:not([class*="_tab"]) {
	background-color: var(--mpw-surface-side) !important;
}
html body[data-ds-dark-theme] .pI_x6G_sidebarCol,
html body[data-ds-dark-theme] [class*="sidebarCol"]:not([class*="_tab"]) {
	background-color: var(--mpw-surface-side-dark) !important;
}` : `.pI_x6G_sidebarCol,
.hHd-Xa_root {
	background-color: var(--mpw-surface-opaque-side) !important;
}
body[data-ds-dark-theme] .pI_x6G_sidebarCol,
body[data-ds-dark-theme] .hHd-Xa_root {
	background-color: var(--mpw-surface-opaque-side-dark) !important;
}`}
${unifyTint ? `body:not([data-ds-dark-theme]) .pI_x6G_sidebarCol,
body:not([data-ds-dark-theme]) .hHd-Xa_root {
	background-color: var(--mpw-surface-side-unify-light) !important;
}` : ""}
.hHd-Xa_newSession {
	/* ①(修正) 新会话按钮随 侧边栏/标题栏透明度（sidebarAlpha）：统一虚化开 → U(panel)=sidebarAlpha；
	   关 → 随面板不透明度。之前直接 panel 导致不随 sidebarAlpha 变化（用户反馈） */
	background-color: color-mix(in srgb, var(--dsw-alias-button-elevated-fill) ${U(panel)}%, transparent) !important;
	border-color: color-mix(in srgb, var(--dsw-alias-border-l2) 65%, transparent) !important;
}
/* ⑬(新) 取消工作区列表底部的自带渐变 fade（用户要求直接去掉白色虚化带） */
.hHd-Xa_regionArea [class*="fade"],
[data-slot*="workspaces"] [class*="fade"],
[data-slot="sidebar"] [class*="fade"] {
	display: none !important;
}
/* 聊天区 / 详情面板根：背景透明，由 token override 的 --dsw-alias-bg-base
   控制半透明（避免双重透明叠加） */
.wSkVaW_root {
	background-color: transparent !important;
}
/* ⑤(修正) 输入框座（composerSeat）：去掉白色渐变特效（用户反馈拉高不透明度时
   输入框附近出现白渐变、有边界、收起也延伸）。保持透明透出壁纸。 */
.wSkVaW_root[data-phase="active"] .wSkVaW_composerSeat {
	background: transparent !important;
}
.ydkMvW_root {
	/* ③(新) unify 开 → 与聊天区同色系（static 色）；关 → 原 bg-base 混色 */
	background-color: var(--mpw-surface-content) !important;
}
${unifyTint ? `body:not([data-ds-dark-theme]) .ydkMvW_root {
	background-color: var(--mpw-surface-content-unify-light) !important;
}` : ""}
/* 磨砂 blur：壁纸层自身 filter blur（磨砂条控制，见 .mpw-bgWrap img/video）。
   聊天区 scrollBody：不加 backdrop-filter（避免与输入框虚化嵌套冲突，
   Firefox 嵌套会隔离输入框 blur），半透明背景透出（模糊的）壁纸。
   输入框虚化由输入框自己的 backdrop-filter 处理（虚化开关控制）。 */
.hHd-Xa_regionArea {
	/* ①(修正) 不给侧边栏任何容器加 backdrop-filter（会困设置弹窗 / 形成分离模糊块）；
	   毛玻璃 = 壁纸层 blur + 表面半透明（见 frostedLayers 注释）。unify 开 → none。 */
	backdrop-filter: ${blurFilter} !important;
}
${frostedLayers}
/* ①(修正) 左上角(logoRow/品牌/新会话) + 左下角(设置/底部)：
   不加 backdrop-filter（settingsArea/footArea 是设置弹层 fixed 遮罩的祖先，
   backdrop-filter 会创建包含块把弹层"关"进侧边栏！），只清背景透明，
   磨砂跟随由 root 半透明 + 壁纸层 filter blur 提供（透出模糊壁纸，效果等价）。 */
[data-slot="sidebar"] [class*="logoRow"],
[data-slot="sidebar"] [class*="footArea"],
[data-slot="sidebar"] [class*="footerActions"],
[data-slot="sidebar"] [class*="settingsArea"] {
	background-color: transparent !important;
}
/* ⑩(新) 第三方插件注入侧边栏的内容（DSH-better-sidebar/account-balance 等）：
   兜底 45% 雾底保证在壁纸上可读；不加 !important → 插件自己的背景样式优先。
   ①(2026-09-18 §5 第1项) 宿主 token 消费收进 SSOT（--mpw-surface-side-plugin）。 */
[data-slot="sidebar"] [data-plugin] {
	background-color: var(--mpw-surface-side-plugin);
	border-radius: 8px;
}
.wSkVaW_scrollBody {
	backdrop-filter: none !important;
	/* 统一虚化开 → 透明：底色完全由 bg-base（panel%）提供，与侧边栏白雾厚度一致，
	   避免 scrollBody 与 bg-base 双层叠加导致聊天区比侧边栏更白（背景分裂）。
	   悬浮开 → 也透明：悬浮卡片风格下聊天区整体透出壁纸（不再切出直角白雾矩形）。
	   关 → 保持 68% 半透明底。 */
	background-color: ${(unifyTint || floatOn) ? "transparent" : `color-mix(in srgb, var(--dsw-alias-bg-base) ${U(68)}%, transparent)`} !important;
}
.ydkMvW_body {
	backdrop-filter: ${blurFilter} !important;
}
`;
			// ①(新 2026-09-13 第15项) 纯 CSS/SVG 液态玻璃：作用于侧边栏/标题栏/输入框/设置面板
			//   开启条件：设置项 lgCss=true + 环境支持 backdrop-filter:url() + 有壁纸（无壁纸时无内容可折射）
			//   不支持时**自动回退纯模糊**（不会白开）；默认关，可随时关掉。
			try {
				const lgCssOn = section.lgCss !== void 0 ? !!section.lgCss : DEFAULT_LG_CSS;
				if (lgCssOn && hasImage && bdSupported) {
					const lgAmt = Math.max(0, Math.min(40, section.lgCssAmount !== void 0 ? section.lgCssAmount : DEFAULT_LG_CSS_AMOUNT));
					const svgOk = lgCssSupported() && ensureLgSvgFilter(lgAmt);
					const lgBlurPx = Math.max(2, Math.round(lgAmt / 2));
					const lgFilter = "blur(" + lgBlurPx + "px) saturate(1.25)" + (svgOk ? " url(#" + LG_FILTER_ID + ")" : "");
					// 玻璃质感三件套：折射(backdrop-filter) + 半透明底 + 内高光描边（specular）
					css += `
/* ── 液态玻璃（CSS/SVG 版）：折射 + 高光边缘 ── */
.pI_x6G_sidebarCol,
.wSkVaW_header,
[class*="composer"] [class*="card"],
.wSkVaW_scrollBody {
	-webkit-backdrop-filter: ${lgFilter} !important;
	backdrop-filter: ${lgFilter} !important;
}
.pI_x6G_sidebarCol::after,
.wSkVaW_header::after {
	content: ""; position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
	background: linear-gradient(180deg, rgba(255,255,255,0.16), rgba(255,255,255,0.02) 38%, rgba(255,255,255,0) 62%);
	box-shadow: inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(0,0,0,0.06);
	mix-blend-mode: screen;
}
`;
					// 侧边栏需要 position:relative 才能承载 ::after 高光层（不改变布局）
					css += `
.pI_x6G_sidebarCol, .wSkVaW_header { position: relative; }
`;
					if (!svgOk) css += `/* 液态玻璃：本环境不支持 backdrop-filter:url(#...) → 已回退纯模糊 */
`;
				}
			} catch (e) { /* 液态玻璃失败不得影响其它样式 */ }
			// ①(修正) 统一虚化开启时标题栏磨砂被接管：即使 headerBlur 开关被关，也强制
			// 走磨砂分支（白雾由 U(panel) 控制）——用户要求标题栏磨砂像侧边栏磨砂一样
			// 被统一虚化接管，不能自由关掉露出壁纸（用户实测：统一虚化开时关标题栏磨砂
			// 仍透出壁纸 → 接管失效）。
			const headerFrosted = (headerBlur || unifyTint) && headerBg;
			if (headerFrosted) {
				// ①(修正) 标题栏磨砂。**绝不能给 header 本体加 backdrop-filter**——
				// header 有 fixed 子元素（子代理展开面板/后台任务条），backdrop-filter 会成为
				// 它们的 containing block，导致面板定位错乱（用户实测 bug）。
				// ①(修正) 标题栏雾底与**统一虚化联动**：unify 开 → 标题栏与侧边栏同款
				// 白雾厚度（U(panel)=sidebarAlpha「侧边栏/标题栏透明度」），两个条
				// （unifyAmount 壁纸模糊 + sidebarAlpha 白雾）同时作用于标题栏与侧边栏
				// （用户实测：统一虚化只能控侧边栏，标题栏不变——此前 headerBlurAmount
				// 与 unify 脱节）。unify 关 → 按「标题栏磨砂程度」条（headerBlurAmount，
				// 0=透明透出壁纸，拉高=白雾）。
				// 标题栏内部按钮/logo 白框在 unify 下保持透明（用户此前要求去白框，
				// 靠 hover 交互态保留可读性）。
				const hblurAmt = section.headerBlurAmount !== void 0 ? section.headerBlurAmount : DEFAULT_HEADER_BLUR_AMOUNT;
				const hdrAlpha = unifyTint ? U(panel) : Math.max(0, Math.min(100, hblurAmt));
				/* ①(2026-09-18 §5 第1项) 宿主 token → 我们命名空间的**表面 token**（唯一来源）。
				   值就是原来的表达式，公式不搬家 ⇒ 默认档逐字节等价。 */
				tok("--mpw-surface-frost-top", `color-mix(in srgb, var(--dsw-static-neutral-bluish-950) ${hdrAlpha}%, transparent)`);
				tok("--mpw-surface-frost-top-light", `color-mix(in srgb, var(--dsw-static-neutral-bluish-00) ${hdrAlpha}%, transparent)`);
				// ①(新 2026-09-13) 「标题栏磨砂强度」独立滑条：开了才覆盖半径，默认仍与整屏虚化联动。
				const frostOwn = section.headerFrostOwn !== void 0 ? !!section.headerFrostOwn : DEFAULT_HEADER_FROST_OWN;
				const frostAmtRaw = section.headerFrostAmount !== void 0 ? Number(section.headerFrostAmount) : DEFAULT_HEADER_FROST_AMOUNT;
				const frostAmt = Number.isFinite(frostAmtRaw) ? Math.max(0, Math.min(60, Math.round(frostAmtRaw))) : DEFAULT_HEADER_FROST_AMOUNT;
				// 标题栏磨砂半径：① 独立滑条开 → 用它；② unify 开 → 「整屏虚化程度」；
				// ③ 都关 → 标题栏磨砂程度（0 时给个下限 8px）
				const hdrBlurPx = frostOwn
					? frostAmt
					: (unifyTint
						? Math.max(0, Math.round(unifyAmount))
						: Math.max(hblurAmt > 0 ? 8 : 0, Math.round(hblurAmt / 4)));
				/* ①(2026-09-18 §5 第1项) 顶栏磨砂半径进 SSOT（原来定义在 .wSkVaW_header 上，
				   只有头部子树读它 ⇒ 提到 :root 不改变任何消费者看到的计算值）。 */
				tok("--mpw-hdr-blur", hdrBlurPx + "px");
				css += `
.wSkVaW_header {
	background-color: var(--mpw-surface-frost-top) !important;
	/* ②(2026-09-16 回归修复) 这里原本是 border-bottom: 1px solid transparent !important;
	   —— 「顶栏下描边消失」的元凶之一（另一处在下面 headerBg && !headerBlur 分支）。
	   带 !important 的特异性压过宿主自己的 border-bottom ⇒ 下描边整条变透明。
	   已删除：底色（background-color）我们管，描边一律交还宿主。*/
	position: relative;   /* 作为 ::before 磨砂层的定位上下文 */
	overflow: visible;    /* 展开面板/菜单不被裁切 */
}
body:not([data-ds-dark-theme]) .wSkVaW_header {
	background-color: var(--mpw-surface-frost-top-light) !important;
}
/* 修正(2026-09-13 用户第1项 + "展开框被压住" 双约束) 标题栏磨砂放在 **::before 伪元素**上：
   磨砂若加在 header 本体（backdrop-filter），会让 header 成为 ①层叠上下文 → 展开浮层被关在
   标题栏内部、压不过标题文字 ②fixed/absolute 后代的 containing block → 面板定位/裁剪异常。
   伪元素不是那些浮层的祖先，因此：磨砂保留、浮层不受困、层叠比较照常。 */
/* 标题栏磨砂层（默认方案）：
   为什么用伪元素 + isolation 而不是给 header 本体加 backdrop-filter：
     * header 本体加 backdrop-filter 会同时产生 **层叠上下文** 与 **fixed 后代的 containing block**
       → 展开浮层被"关"在标题栏内 / 定位被改（用户实测"浮层被压住"）。
     * 伪元素不是浮层的祖先，不会困住任何浮层；
     * isolation: isolate 让 header 自己成为层叠上下文（**不会**产生 containing block），
       于是 z-index:-1 的伪元素被限制在 header 内部绘制：在 header 背景之上、内容之下，
       可靠可见（这正是上一版伪元素方案缺失的一环）。
   ?hdrblur=element 可切回"本体"方案做对照。 */
/* ①(关键修正 2026-09-13 用户截图定案) **绝不能在 header 上加 isolation / backdrop-filter**：
   它们都会让 header 成为 **backdrop root**，而 header 里的浮层（后台任务菜单等）也带
   backdrop-filter —— 成为 backdrop root 的祖先会让后代的 backdrop 采样范围被"隔离"在内部，
   于是浮层模糊失效 → 背后文字**清晰**透出来（截图实锤：文字是锐利的、不是糊的）。
   所以 header 只保留：position:relative（给 ::before 做定位上下文）+ 半透明底；
   磨砂完全交给 ::before（伪元素不是浮层的祖先 → 不影响浮层的 backdrop）。
   ①(2026-09-16) 追加 :not([data-mpw-hdr-frost-el])：JS 注入的真实元素层（.mpw-hdrFrost）
   一旦生效就给 body 打这个标记 → **伪元素兜底自动让位**，避免两层模糊叠加（30+30px 糊成一片）；
   若 JS 注入失败（极端环境/CSP/找不到 header），标记不存在 → 伪元素仍在 ⇒ 双保险不互相打架。 */
html body:not([data-mpw-hdr-blur-element]):not([data-mpw-hdr-frost-el]) .wSkVaW_header::before {
	content: "" !important;
	position: absolute !important;
	inset: 0 !important;
	z-index: -1 !important;
	pointer-events: none !important;
	border-radius: inherit !important;
	-webkit-backdrop-filter: blur(var(--mpw-hdr-blur, 24px)) saturate(140%) !important;
	backdrop-filter: blur(var(--mpw-hdr-blur, 24px)) saturate(140%) !important;
}
`;
				// ①(修正) 标题栏内部白框：unify（透明标题栏）时 session logo 按钮 /
				// 「标准模式」标签等自带实心底的盒子仍显示为白色块（用户两次反馈），
				// 全部改透明，保留 hover 交互态。
				css += `
.wSkVaW_header button,
.wSkVaW_header [class*="button"],
.wSkVaW_header [class*="logo"],
.wSkVaW_header [class*="mode"],
.wSkVaW_header [class*="badge"],
.wSkVaW_header [class*="segmented"] {
	background: transparent !important;
	box-shadow: none !important;
}
.wSkVaW_header button:hover,
.wSkVaW_header [class*="button"]:hover,
.wSkVaW_header [class*="segmented"] button:hover {
	background: color-mix(in srgb, var(--dsw-alias-interactive-bg-hover) 70%, transparent) !important;
}
`;
			}
			if (headerBg && !headerBlur) {
				// ①(修正 2026-09-13 第4项) 标题栏**透出壁纸**且不磨砂 → 必须**透明**（壁纸可见）。
				//   旧实现给的是"实心主题静态色"，等于把壁纸完全挡住 —— 这就是用户实测
				//   "标题栏透出壁纸开关开了没效果"的根因。可读性交给「标题栏磨砂 / 磨砂程度」条。
				css += `
.wSkVaW_header {
	background-color: transparent !important;
	backdrop-filter: none !important;
	/* ②(2026-09-16 回归修复) 同上：原来的 border-bottom: 1px solid transparent !important;
	   在「透出壁纸且不磨砂」这一档（用户实测命中的就是它）把宿主下描边整条抹掉。
	   已删除 —— 透明底只改底色，下描边仍由宿主绘制（亮色 rgba(19,45,83,.26) /
	   暗色 rgba(148,180,220,.32)），悬浮态圆角外框的下边也随之恢复。*/
}
.wSkVaW_header button,
.wSkVaW_header [class*="button"],
.wSkVaW_header [class*="logo"],
.wSkVaW_header [class*="mode"],
.wSkVaW_header [class*="badge"],
.wSkVaW_header [class*="segmented"] {
	background: transparent !important;
	box-shadow: none !important;
}
`;
			}
			if (!headerBg) {
				// ①④(修正) 标题栏不透出壁纸：白色不透明（用户要求"关=一片白色的不透明状态"）。
				// 不能用 var(--dsw-alias-bg-base)——它已被 token override 成半透明会透出壁纸。
				// 用主题静态色：亮色=白、暗色=深色（跟随 data-ds-dark-theme）。
				// ①(2026-09-18 §5 第1项) 宿主 token 消费收进 SSOT：顶栏「不透明」档两枚 token。
				tok("--mpw-surface-opaque-top", "var(--dsw-static-neutral-bluish-00)");
				tok("--mpw-surface-opaque-top-dark", "var(--dsw-static-neutral-bluish-950)");
				css += `
.wSkVaW_header {
	background-color: var(--mpw-surface-opaque-top) !important;
	backdrop-filter: none !important;
}
body[data-ds-dark-theme] .wSkVaW_header {
	background-color: var(--mpw-surface-opaque-top-dark) !important;
}
`;
			}
			if (!sidebar) {
				// ⑥(修正 2026-09-13 用户第3项) 不透出时 token 层同样回到不透明（只改显式规则时，
				//   凡是用 --dsw-specific-sidebar-fill 的 DSH 内层仍会透 → 用户观感"开关没用"）。
				// ①(2026-09-16 bug①收窄) 与上方 sidebar 分支同理：不再全局改宿主 token，
				//   只在我们管理的侧栏白名单容器上恢复不透明底色；`?sbfill=wide` 可回退全局写法。
				// ①(2026-09-18 §5 第1项) 宿主 token 覆盖统一收到 buildSidebarFillCss()
				//   （全插件唯一一处）——原来透明档/不透明档分散在两个 if 分支里，改一处忘一处。
				tok("--mpw-surface-opaque-side", "var(--dsw-static-neutral-bluish-00)");
				tok("--mpw-surface-opaque-side-dark", "var(--dsw-static-neutral-bluish-950)");
				css += buildSidebarFillCss('opaque', sbfillWide);
				// ⑥ 侧边栏不透出壁纸：恢复为**完全不透明**（亮=纯白/暗=深色，与标题栏同款）
				// ①(修正 2026-09-13 第4项，真机 diag 定案) 旧实现有两个问题：
				//   ① 用的是 --dsw-specific-sidebar-fill，而该 token 被本插件 override 成 85% 半透明
				//      → "关掉透出"仍能透出一点壁纸，用户观感=开关没用；
				//   ② 选择器只有 (0,1,0)，而统一虚化下还输出了一条
				//      `body:not([data-ds-dark-theme]) .pI_x6G_sidebarCol`（(0,2,1)，后者胜）
				//      → 统一虚化开着时，"关掉侧边栏透出"完全无效（diag 实测仍 rgba(...,0.38)）。
				//   现在：静态主题色（不透）+ `html body` 提升特异性，亮/暗各一条。
				css += `
html body .pI_x6G_sidebarCol,
html body [class*="sidebarCol"]:not([class*="_tab"]) {
	background-color: var(--mpw-surface-opaque-side) !important;
}
html body[data-ds-dark-theme] .pI_x6G_sidebarCol,
html body[data-ds-dark-theme] [class*="sidebarCol"]:not([class*="_tab"]) {
	background-color: var(--mpw-surface-opaque-side-dark) !important;
}
.hHd-Xa_newSession {
	background-color: var(--dsw-alias-button-elevated-fill) !important;
}
.hHd-Xa_regionArea { backdrop-filter: none !important; }
.hHd-Xa_regionArea [class*="fade"],
[data-slot*="workspaces"] [class*="fade"],
[data-slot="sidebar"] [class*="fade"] {
	display: none !important;
}
`;
			}
			if (hideBg) {
				// ④ 面板 100% 不透明时：隐藏壁纸层，帧底色用主题色，避免中缝透出背景
				css += `
.mpw-bgWrap { display: none !important; }
.pI_x6G_frame { background-color: var(--dsw-alias-bg-base) !important; }
`;
			}			// ⑫(重做) ② 虚化分块：
			// - 对话框虚化（dialogBlur）→ 通用居中窗口 [role=dialog]/[role=alertdialog] + 聊天输入框
			// - 设置面板虚化（settingsBlur）→ DSH 设置面板（[class*="settingsArea"] 内的居中窗口）
			// - 确认弹窗虚化（confirmBlur）→ 本插件的下载/确认弹窗（.mpw_dialog）
			// - 侧边栏磨砂（sidebarBlur）→ Aqua 方案：sidebarCol 自身 backdrop-filter，弹窗打开时 :has() 摘除
			// scrollBody 已无 backdrop-filter（避免嵌套冲突），所以输入框的独立 blur 能生效。
			const bdSupported = window.__mpwBackdropRendered !== false;
			// 磨砂玻璃 = 半透明背景 + backdrop blur，两者缺一不可（原理见下方 CSS 注释）。
			const dlgFrosted = dialogBlur && dialogAmount > 0 && bdSupported;
			const settingsFrosted = settingsBlur && settingsAmount > 0 && bdSupported;
			const confirmFrosted = confirmBlur && confirmAmount > 0 && bdSupported;
			const sidebarFrosted = sidebarBlur && sidebarBlurAmount > 0 && bdSupported;
			// ── A. 不透明兜底（防 token 半透明透出聊天内容）──
			// ①(修正) **始终输出**：所有 [role=dialog] 实体背景——特别是**非 overlay 的
			// 小弹窗**（上下文占用 264px 面板等）必须实体（用户实测 aqua 全关时它也被
			// dialogBlur 磨砂成透明）；磨砂只在 B 块给 overlay 内的真正对话框覆盖。
			css += `
/* 通用居中窗口不透明兜底（防透出；overlay 内的对话框由 B 块磨砂覆盖） */
[role="dialog"],
[role="alertdialog"] {
	background-color: var(--mpw-surface-panel) !important;
}
body[data-ds-dark-theme] [role="dialog"],
body[data-ds-dark-theme] [role="alertdialog"] {
	background-color: var(--mpw-surface-panel-dark) !important;
}
`;
			if (!settingsFrosted) css += `
/* 设置面板虚化关 → 设置面板不透明兜底（防透出） */
[class*="settingsArea"] [role="dialog"] {
	background-color: var(--mpw-surface-panel) !important;
}
body[data-ds-dark-theme] [class*="settingsArea"] [role="dialog"] {
	background-color: var(--mpw-surface-panel-dark) !important;
}
`;
			// ①(修正) 弹窗实心底：虚化关 **或无壁纸** 时都必须实心（无壁纸时 dialogBlur 不生效
			// → 弹窗完全透明 → 字和背景字叠一起（用户多次实测：选择文件夹/新建列表/管理列表）。
			// 有壁纸 + 虚化开 → 走 frosted 半透明。
			if (!confirmFrosted || !hasImage) css += `
/* 下载/确认弹窗兜底：弹窗不透明（防透出/防字叠字） */
.mpw_dialog {
	background: var(--mpw-surface-dialog-dark) !important;
}
body:not([data-ds-dark-theme]) .mpw_dialog {
	background: var(--mpw-surface-dialog-light) !important;
}
`;
			// ── B. 通用对话框磨砂（dialogBlur）──
			if (dlgFrosted) {
				const dlgFilter = `blur(${dialogAmount}px)`;
				css += `
/* ── 对话框虚化（overlay 内的居中窗口 + 聊天输入框；设置面板由 settingsBlur 单独覆盖） ──
   ①(修正) 只作用于 overlay（遮罩层）内的对话框——真正的居中弹窗；
   非 overlay 的小弹窗（上下文占用面板等）保持 A 块实体背景（用户实测小弹窗被磨砂成透明） */
[class*="overlay"] [role="dialog"],
[class*="overlay"] [role="alertdialog"],
[data-composer-card] {
	backdrop-filter: ${dlgFilter} !important;
	-webkit-backdrop-filter: ${dlgFilter} !important;
}
/* 磨砂玻璃原理：半透明背景 + backdrop blur 缺一不可。
   全不透明背景会把 blur 完全遮住 → 纯白无模糊（用户实测）；
   半透明但无 blur 会透出清晰聊天文字 → 设置界面污染（旧 bug）。
   80% 半透明 + blur：背后文字变糊影不可读，模糊的壁纸色调明显透出
   （90% 时磨砂感几乎不可见，用户实测仍像纯白）。 */
[class*="overlay"] [role="dialog"],
[class*="overlay"] [role="alertdialog"] {
	background-color: var(--mpw-surface-panel-frost) !important;
}
body[data-ds-dark-theme] [class*="overlay"] [role="dialog"],
body[data-ds-dark-theme] [class*="overlay"] [role="alertdialog"] {
	background-color: var(--mpw-surface-panel-frost-dark) !important;
}
[role="dialog"] [class*="card"] {
	backdrop-filter: none !important;
}
/* 提问输入框（composer）：跟随「虚化对话框」开关（聊天框不随统一虚化）。
   虚化开 = 半透明背景，透出模糊壁纸/经过的字。 */
[data-composer-card] {
	background-color: var(--mpw-surface-composer) !important;
}
body:not([data-ds-dark-theme]) [data-composer-card] {
	background-color: var(--mpw-surface-composer-light) !important;
}
/* 输入框背后区域（composerStack/seat）背景透明，让壁纸透到输入框背后 */
[data-slot*="composer"] [class*="stack"],
[data-slot*="composer"] [class*="Stack"],
[data-slot*="composer"] [class*="seat"],
[data-slot*="composer"] [class*="Seat"],
[class*="composerStack"],
[class*="composerSeat"] {
	background: transparent !important;
}
/* ⑤(修正) 输入框外围 seat：去掉白色渐变特效。保持透明透出壁纸。 */
[data-slot*="composer"] [class*="seat"],
[data-slot*="composer"] [class*="Seat"] {
	backdrop-filter: none !important;
	background: transparent !important;
}
`;
			}
			// ── C. 设置面板磨砂（settingsBlur，覆盖通用 blur 值）──
			if (settingsFrosted) {
				const setFilter = `blur(${settingsAmount}px)`;
				css += `
/* ── 设置面板虚化（覆盖通用对话框值，独立可调） ── */
[class*="settingsArea"] [role="dialog"] {
	backdrop-filter: ${setFilter} !important;
	-webkit-backdrop-filter: ${setFilter} !important;
	background-color: var(--mpw-surface-panel-frost) !important;
}
body[data-ds-dark-theme] [class*="settingsArea"] [role="dialog"] {
	background-color: var(--mpw-surface-panel-frost-dark) !important;
}
`;
			}
			// ── D. 下载/确认弹窗磨砂（confirmBlur）──
			if (confirmFrosted) {
				const cnfFilter = `blur(${confirmAmount}px)`;
				css += `
/* ── 下载/确认弹窗虚化（本插件 .mpw_dialog） ── */
.mpw_dialog {
	backdrop-filter: ${cnfFilter} !important;
	-webkit-backdrop-filter: ${cnfFilter} !important;
	background: var(--mpw-surface-dialog-frost-dark) !important;
}
body:not([data-ds-dark-theme]) .mpw_dialog {
	background: var(--mpw-surface-dialog-frost-light) !important;
}
`;
			}
			// ── E. 侧边栏磨砂（sidebarBlur，Aqua 方案）──
			// unify 开时由整屏虚化（壁纸层 blur）接管，不输出自身 backdrop-filter（避免双重模糊）
			if (sidebarFrosted && !unifyTint) {
				const sblFilter = `blur(${sidebarBlurAmount}px)`;
				css += `
/* ── 侧边栏磨砂（Aqua 方案：sidebarCol 自身 backdrop-filter） ──
   backdrop-filter 会把 sidebarCol 变成 fixed 弹窗的 containing block（困住弹窗）。
   弹窗打开时 JS 在 body 打 data-mpw-sblur-off 摘除模糊（见 setupSblurObserver）。
   不用 :has() —— Firefox 对 :has()+backdrop-filter 的层叠计算有 bug：
   两条规则共存时 :has() 规则不覆盖基础规则（实测）；body 属性方案全浏览器可靠。
   html body 前缀提高特异性，确保摘除规则无条件赢过基础规则。 */
body[data-mpw-sblur] .pI_x6G_sidebarCol,
body[data-mpw-sblur] [class*="sidebarCol"] {
	backdrop-filter: ${sblFilter} !important;
	-webkit-backdrop-filter: ${sblFilter} !important;
}
html body[data-mpw-sblur][data-mpw-sblur-off] .pI_x6G_sidebarCol,
html body[data-mpw-sblur][data-mpw-sblur-off] [class*="sidebarCol"] {
	backdrop-filter: none !important;
	-webkit-backdrop-filter: none !important;
}
`;
			}

			// ── G. 标题栏下拉/三点菜单：自身磨砂（修复#4：不再摘除栏虚化 → 菜单自己变玻璃）──
			{
				css += `
/* ── G. 小面板（下拉/菜单/浮层）自身磨砂，避免"不摘除栏虚化"后菜单看不清 ── */
/* ②(2026-09-11 收窄) 只对"真下拉菜单"提层+磨砂；不再匹配 _panel_/dockkit-pane（会把右栏面板
   P3OORG_panel 也提层→布局异常）。z-index 用 100（压过聊天内容、但不压设置/弹窗）。 */
[role="menu"], [class*="_menu_"]:not([class*="_pane_"]), [class*="_popover_"], [class*="_floatHeader_"] {
  -webkit-backdrop-filter: blur(${Math.max(8, popoverAmount)}px) saturate(150%);
  backdrop-filter: blur(${Math.max(8, popoverAmount)}px) saturate(150%);
  z-index: 900 !important;
}
`;
			}

			// ── F. 右侧边栏/dock 虚化（0.1.5 自带右栏与 dockkit 浮层，独立参数）──
			if (rsBlur) {
				const rsBg = `rgba(255,255,255,${Math.max(0, Math.min(1, rsAlpha / 100)) * 0.55})`;
				css += `
/* ── F. 右侧边栏 / dock 虚化（独立开关+程度+透明度）── */
html body[data-sidebar-right-panel],
html body[data-sidebar-right-float-host],
html body[data-mpw-rs],
html body[data-dockkit-strip],
html body[data-dockkit-float] {
  -webkit-backdrop-filter: blur(${rsAmount}px) saturate(140%);
  backdrop-filter: blur(${rsAmount}px) saturate(140%);
  background-color: ${rsBg} !important;
}
/* ④(2026-09-11 一行修复) 原为 body:not([data-mpw-rsblur]) 兜底——body 从未设置该属性 → 恒真
   → 右栏磨砂被永久关闭（用户实测"右栏虚化没有"）。改为显式关闭标记 body[data-mpw-rsblur="off"]。 */
body[data-mpw-rsblur="off"] [data-sidebar-right-panel], body[data-mpw-rsblur="off"] [data-sidebar-right-float-host],
body[data-mpw-rsblur="off"] [data-dockkit-strip], body[data-mpw-rsblur="off"] [data-dockkit-float] {
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
}
`;
			}
			// ── G. 统一虚化 + 聊天区不跟随：侧边栏/标题栏叠加整屏虚化度 ──
			// chatFollow 关 → 壁纸层 blur = 磨砂条（聊天区不跟随，用户澄清）；
			// 侧边栏/标题栏的"虚化程度"由这里的 backdrop blur(unifyAmount) 提供——
			// 调「整屏虚化程度」即可改变它们背后的模糊（用户实测：chatFollow 关时
			// unifyAmount 只控侧边栏、标题栏不变 → 之前 F 块排除了 header）。
			// ①(修正) **标题栏 backdrop blur 只在无展开面板时生效**：header 内有
			// absolute 的子代理/后台任务展开面板（JObwrW_panel），backdrop-filter 会成为
			// 它们的 containing block → 面板定位错乱、z-index 失效。展开面板出现时
			// JS 打 data-mpw-header-blur-off 摘除（见 setupHeaderBlurWatch）。
			// 弹窗打开时 body[data-mpw-sblur-off] 同样摘除（复用侧边栏磨砂机制）。
			if (unifyAmount > 0 && bdSupported) { // ③(2026-09-11 一行修复) 去掉 unifyTint/chatFollow 前置条件——默认 chatFollow=true 会让该块永不输出，导致栏/标题栏磨砂在有壁纸时也缺失（用户实测）
				css += `
/* ── 统一虚化 + 聊天区不跟随：侧边栏/标题栏背后叠加整屏虚化度（标题栏展开面板
   出现时由 data-mpw-header-blur-off 摘除，防困住面板） ── */
/* ②(2026-09-11 根治) 原实现在此给 sidebarCol/header 加 backdrop-filter —— 它会让栏成为
   fixed 弹窗（如设置 VOzbGW_overlay）的 containing block → 设置面板 100%% 尺寸被算成栏宽、
   被 flex 压缩进侧栏（诊断数据实锤：panel 宽 254 而非 800）。统一虚化的视觉效果本就由
   "壁纸层 filter blur（--mpw-bg-blur）+ 表面半透明"提供，此处只保留半透明、去掉 backdrop。
   :has() 兜底：任何 fixed overlay 出现时也强制清掉（防其它来源的 backdrop）。 */
/* ①(2026-09-13 定案：磨砂回到标题栏本体) 用户实测"标题栏模糊直接没了" →
   磨砂必须在 header 本体上才有稳定观感（伪元素方案在部分层级/背景组合下不可见）。
   同时用两条护栏避免历史上那两个 side effect：
     ① **大浮层/弹窗打开时自动摘除**（下方已有的 :has([class*="_overlay"]/_modal) 规则把
        header 的 backdrop-filter 置 none）→ 不会困住 fixed 面板；
     ② 浮层的层叠问题**不再依赖 header 不是层叠上下文**：改为抬高"浮层宿主"的 z-index
        （见上方 QsffPG_root 规则，z-index:500）→ 浮层在 header 的层叠上下文内部也能压过标题文字。
   ?hdrblur=pseudo 可切到"仅伪元素"方案（对照排障用）。 */
html body[data-mpw-hdr-blur-element]:not([data-mpw-sblur-off]) .wSkVaW_header {
	-webkit-backdrop-filter: blur(${unifyAmount}px) saturate(140%) !important;
	backdrop-filter: blur(${unifyAmount}px) saturate(140%) !important;
}
html body:not([data-mpw-sblur-off]).pI_x6G_sidebarCol,
html body:not([data-mpw-sblur-off])[class*="sidebarCol"]:not([data-sidebar-right-panel]) {
	backdrop-filter: blur(${unifyAmount}px) !important;
	-webkit-backdrop-filter: blur(${unifyAmount}px) !important;
}
html body:has([class*="_overlay"]), html body:has([class*="_modal"]), html body:has([class*="_portal"]) {
	--mpw-overlay-open: 1;
}
/* 全局兜底：任何 fixed overlay/modal 打开时，栏与标题栏的 backdrop-filter 一律关闭
   （backdrop-filter 会把栏变成 fixed 弹窗的 containing block → 弹窗尺寸被压缩进侧栏）。 */
html body:has([class*="_overlay"]) .pI_x6G_sidebarCol,
html body:has([class*="_overlay"]) [class*="sidebarCol"],
html body:has([class*="_overlay"]) .wSkVaW_header,
html body:has([class*="_modal"]) .pI_x6G_sidebarCol,
html body:has([class*="_modal"]) [class*="sidebarCol"],
html body:has([class*="_modal"]) .wSkVaW_header,
html body:has([class*="_overlay"]) [data-mpw-rs],
html body:has([class*="_modal"]) [data-mpw-rs] {
	backdrop-filter: none !important;
	-webkit-backdrop-filter: none !important;
}
`;
			}
			// ═══ H(2026-09-12 CSS-first 定案) 标题栏/左栏/右栏(dockkit) 统一玻璃块 ═══
			//   设计要点（与 GLM 评审结论合并）：
			//   1) 纯 CSS 单一样本：不再打类名、不写内联、不靠 MutationObserver → React 重渲染不会丢；
			//   2) 选择器全部基于 DSH 自身稳定锚点：header[class*="_header_"] / [class*="sidebarCol"] /
			//      [data-sidebar-right-panel] / [data-dockkit-pane|strip|surface]（实测 diag 报告）；
			//   3) 关键补强：同时用 !important 覆盖 background-color —— 只加 backdrop-filter 而背景仍不透明
			//      时"看起来还是没模糊"（这就是用户看到的"虚化消失=白纱"）；
			//   4) 抑制条件集中在选择器里（弹窗/展开面板/拖拽/用户关开关），不再靠 JS 摘除内联；
			//   5) 变量由 JS 写入 :root，改设置只改变量、不动 DOM。
			if (bdSupported) {
				// sidebarBlur 是布尔（是否启用侧栏磨砂），数值在 sidebarBlurAmount；未启用时退回统一虚化程度
				const chromeBlur = Math.max(0, Math.round((sidebarBlur ? sidebarBlurAmount : unifyAmount) || 0));
				const chromeAlphaRaw = (section && section.sidebarAlpha !== void 0) ? section.sidebarAlpha : DEFAULT_SIDEBAR_ALPHA;
				const chromeAlpha = Math.max(0, Math.min(1, Number(chromeAlphaRaw) / 100));
				const chromeBg = (typeof unifyTint === 'string' && unifyTint) ? unifyTint : '255,255,255';
				const rsAmt2 = Math.max(0, Math.round(typeof rsAmount === 'number' ? rsAmount : 18));
				const rsAlpha2 = Math.max(0, Math.min(1, (typeof rsAlpha === 'number' ? rsAlpha : 60) / 100));
				/* ①(2026-09-18 §5 第1项) 这几枚原来是这里自建的一个 :root 块 —— 现在统一登记进
				   SSOT（emitSurfaceTokens 输出的那个 :root），值逐字不变；原来是"本块自己的
				   :root"，与顶栏/面板各自为政 → 正是"四处各写一套"的来源。 */
				tok("--mpw-chrome-blur", chromeBlur + "px");
				tok("--mpw-chrome-alpha", chromeAlpha);
				tok("--mpw-chrome-bg", chromeBg);
				tok("--mpw-rs-blur", rsAmt2 + "px");
				tok("--mpw-rs-alpha", rsAlpha2);
				/* 侧栏（左）磨砂表面：底座色 + 透明度 → 一枚 token（原来散在规则里拼 rgba） */
				tok("--mpw-surface-side-frost", "rgba(var(--mpw-chrome-bg), var(--mpw-chrome-alpha))");
				/* 右侧栏 / dockkit 面板表面（亮色底 + 22% 档） */
				tok("--mpw-surface-rs-dock", `rgba(${chromeBg === '255,255,255' ? '255,255,255' : chromeBg}, calc(var(--mpw-rs-alpha) * 0.55))`);
				/* 右侧栏 / dockkit 面板表面（暗色底 + 30% 档） */
				tok("--mpw-surface-rs-dock-dark", "rgba(18, 22, 30, calc(var(--mpw-rs-alpha) * 0.75))");
				css += `
/* ── H. 玻璃统一块（CSS-first）：标题栏 / 左侧栏 / 右侧栏(dockkit) ──
   ①(2026-09-18 §5 第1项) 本块不再自建 :root —— 表面 token 全部由 emitSurfaceTokens()
   在唯一一处输出（值不变），四表面只读 var(--mpw-surface-*)。 */
/* 标题栏与左侧栏（含 better-sidebar 与 DSH 原生 sidebarCol） */
@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
/* ①(修正 2026-09-13 用户"展开框还是被压住" —— 真机 layer-diag 定案)
   diag 实测：HEADER.wSkVaW_header 的 computed backdrop-filter = set（仍在本体上），
   于是 header 成为 **层叠上下文 + fixed/absolute 后代的 containing block**：
     * 作为 containing block：展开面板的定位/裁剪会受 header 影响；
     * 作为层叠上下文：浮层被"关"在 header 内部，无法压过 header 内的文字。
   修法：**header 本体彻底不加 backdrop-filter**（磨砂改由 .wSkVaW_header::before 承担，
   见上方标题栏规则），这里只保留左侧栏的规则。 */
html body:not([data-mpw-sblur-off]) [class*="sidebarCol"]:not([data-sidebar-right-panel]):not([data-dockkit-strip]) {
	-webkit-backdrop-filter: blur(var(--mpw-chrome-blur)) saturate(140%) !important;
	backdrop-filter: blur(var(--mpw-chrome-blur)) saturate(140%) !important;
	background-color: var(--mpw-surface-side-frost) !important;
}
/* 右侧栏 / dockkit（V 形：面板 + 标签条 + 表面） */
html body[data-mpw-rsblur="on"] [data-sidebar-right-panel],
html body[data-mpw-rsblur="on"] [data-dockkit-pane],
html body[data-mpw-rsblur="on"] [data-dockkit-strip],
html body[data-mpw-rsblur="on"] [data-dockkit-surface] {
	-webkit-backdrop-filter: blur(var(--mpw-rs-blur)) saturate(140%) !important;
	backdrop-filter: blur(var(--mpw-rs-blur)) saturate(140%) !important;
	background-color: var(--mpw-surface-rs-dock) !important;
}
/* 抑制：弹窗/设置面板打开时（backdrop-filter 会成为 fixed 弹窗的 containing block → 必须摘除） */
html body:has([class*="_overlay"]) [class*="sidebarCol"],
html body:has([class*="_overlay"]) header[class*="_header_"],
html body:has([class*="_overlay"]) [data-dockkit-pane],
html body:has([class*="_overlay"]) [data-dockkit-strip],
html body:has([class*="_modal"]) [class*="sidebarCol"],
html body:has([class*="_modal"]) header[class*="_header_"],
html body:has([class*="_modal"]) [data-dockkit-pane],
html body:has([class*="_modal"]) [data-dockkit-strip] {
	-webkit-backdrop-filter: none !important;
	backdrop-filter: none !important;
}
/* 抑制：拖拽中（降低重绘开销 + 保证跟手） */
html body[data-dsh-sidebar-dragging] [class*="sidebarCol"],
html body[data-dsh-sidebar-dragging] [data-dockkit-pane],
html body[data-dsh-sidebar-dragging] [data-dockkit-strip],
html body[data-dragging] [class*="sidebarCol"],
html body[data-dragging] [data-dockkit-pane] {
	-webkit-backdrop-filter: none !important;
	backdrop-filter: none !important;
	transition: none !important;
}
}
/* ①(修正 2026-09-13 花括号配平 —— 承接上一行的 @supports 收尾)：
   历史上这里被当成"多余的一个右花括号"删掉过一次，实际上它是上面
   @supports ((backdrop-filter:…) or (-webkit-backdrop-filter:…)) 的**闭合括号**。
   删掉之后：① 这个 @supports 一直到文件结尾才被浏览器隐式闭合 → 从"玻璃统一块"
   往后的**所有**规则（弹层虚化/悬浮几何/右侧导航条/轨迹裁剪/层级…）统统变成
   "仅在支持 backdrop-filter 的浏览器里生效"；② 文件末尾那个
   @supports not (backdrop-filter …)  兜底块被套进外层条件 → 变成永远不成立
   （(支持) AND (不支持) = 假）的死代码。
   现在把 @supports 收在它真正该结束的地方（玻璃/抑制规则之后），后面与
   backdrop-filter 无关的规则恢复无条件生效；Chromium 下渲染结果不变，
   但在不支持 backdrop-filter 的环境里不再整片规则丢失。
   守护：panel-smoke 与 css-matrix 都把"花括号不配平"判为失败。 */
/* ①(2026-09-12 用户实测) 深色模式：白雾底色会把文字/栏位照得"过曝" → 深色主题改用深色底 */
html body[data-ds-dark-theme]:not([data-mpw-sblur-off]) header[class*="_header_"],
html body[data-ds-dark-theme]:not([data-mpw-sblur-off]) header.wSkVaW_header,
html body[data-ds-dark-theme]:not([data-mpw-sblur-off]) [class*="sidebarCol"]:not([data-sidebar-right-panel]):not([data-dockkit-strip]),
html body[data-ds-dark-theme][data-mpw-rsblur="on"] [data-sidebar-right-panel],
html body[data-ds-dark-theme][data-mpw-rsblur="on"] [data-dockkit-pane],
html body[data-ds-dark-theme][data-mpw-rsblur="on"] [data-dockkit-strip],
html body[data-ds-dark-theme][data-mpw-rsblur="on"] [data-dockkit-surface] {
	background-color: var(--mpw-surface-rs-dock-dark) !important;
	color: var(--dsw-alias-label-primary, var(--dsw-alias-text-primary, inherit));
}
html body[data-ds-dark-theme]:not([data-mpw-sblur-off]) header[class*="_header_"] *,
html body[data-ds-dark-theme]:not([data-mpw-sblur-off]) [class*="sidebarCol"]:not([data-sidebar-right-panel]) * {
	filter: none !important;
	text-shadow: none !important;
}
/* ②(2026-09-12) 下拉/菜单必须压在设置面板之上，且**不得被我们的玻璃规则困在弹层堆叠上下文里**：
   官方设置弹层 z=20（pI_x6G_overlayLayer）；这里把 portal 类弹层提到 3000，并让玻璃只作用于
   ::before（伪元素不产生 containing block，弹层里的下拉不会再被"困"在设置面板后面）。 */
/* ③(#3 用户实测) 右栏全屏时收纳态左栏会盖到右栏上 → 右栏/浮层层级高于左栏 */
/* ③(#3) 右栏层级只比左栏高，但**必须低于设置弹层**（官方设置层 z=20；此前写 40 会压住设置） */
html body [data-sidebar-right-panel], html body [data-dockkit-pane], html body [data-dockkit-strip], html body [data-dockkit-surface] {
	z-index: 12 !important;
}
html body [class*="sidebarCol"]:not([data-sidebar-right-panel]) { z-index: 1 !important; }
[role="menu"], [role="listbox"], [role="dialog"], [role="tooltip"],
[class*="_popover"], [class*="_dropdown"], [class*="_selectMenu"], [class*="_menu_"],
[data-radix-popper-content-wrapper], [data-dsh-popover] {
	z-index: 3000 !important;
}
/* ═══ ①(2026-09-12 用户实测#2) 设置/弹层打开时"本插件抬高过的层级一律让位" ═══
   现象：打开设置后 标题栏 / 聊天消息框 / 右栏 / 左栏 / 拖宽条 会叠到设置上面。
   根因：我们为修"右栏被左栏盖住""展开框被压"把若干元素 z-index 抬到 12/40/60/3000，
        而官方设置弹层只有 z=20（diag 实测 pI_x6G_overlayLayer）。
   修法：只要页面上存在弹层/遮罩，本插件对所有**非弹层**元素的自定义层级全部撤回
        （回到 auto，让 DSH 自己的层序管理），弹层与菜单保持最高。 */
html body:has([class*="_overlay"]),
html body:has([class*="_overlayLayer"]),
html body:has([class*="_modal"]),
html body:has([role="dialog"]) {
	/* 本插件抬高过的容器：全部让位 */
}
html body:has([class*="_overlayLayer"]) [data-sidebar-right-panel],
html body:has([class*="_overlayLayer"]) [data-dockkit-pane],
html body:has([class*="_overlayLayer"]) [data-dockkit-strip],
html body:has([class*="_overlayLayer"]) [data-dockkit-surface],
html body:has([class*="_overlay"]) [data-sidebar-right-panel],
html body:has([class*="_overlay"]) [data-dockkit-pane],
html body:has([class*="_overlay"]) [data-dockkit-strip],
html body:has([class*="_overlay"]) [data-dockkit-surface],
html body:has([class*="_modal"]) [data-sidebar-right-panel],
html body:has([class*="_modal"]) [data-dockkit-pane],
html body:has([class*="_modal"]) [data-dockkit-strip] {
	z-index: auto !important;
}
html body:has([class*="_overlayLayer"]) header[class*="_header_"],
html body:has([class*="_overlayLayer"]) header.wSkVaW_header,
html body:has([class*="_overlay"]) header[class*="_header_"],
html body:has([class*="_modal"]) header[class*="_header_"],
html body:has([class*="_overlayLayer"]) [class*="sidebarCol"],
html body:has([class*="_overlay"]) [class*="sidebarCol"],
html body:has([class*="_modal"]) [class*="sidebarCol"],
html body:has([class*="_overlayLayer"]) [class*="_resizer"],
html body:has([class*="_overlay"]) [class*="_resizer"],
html body:has([class*="_overlayLayer"]) [class*="_resizeHandle"],
html body:has([class*="_overlay"]) [class*="_resizeHandle"],
html body:has([class*="_overlayLayer"]) [class*="_divider"],
html body:has([class*="_overlay"]) [class*="_divider"],
html body:has([class*="_overlayLayer"]) [class*="_scrollBody"],
html body:has([class*="_overlay"]) [class*="_scrollBody"],
html body:has([class*="_overlayLayer"]) [data-composer-card],
html body:has([class*="_overlay"]) [data-composer-card],
html body:has([class*="_overlayLayer"]) [class*="_floatHeader_"],
html body:has([class*="_overlay"]) [class*="_floatHeader_"] {
	z-index: auto !important;
}
/* 设置/弹层本身必须最高（含其内部下拉），保证可点可选 */
html body [class*="_overlayLayer"], html body [class*="_overlay"], html body [class*="_modal"], html body [role="dialog"] {
	z-index: 2000 !important;
}
/* 设置/对话弹层本身不做玻璃（避免 backdrop-filter 变成下拉的 containing block） */
[class*="_overlay"], [class*="_modal"], [role="dialog"], [class*="_overlayLayer"],
[class*="_overlay"] *, [class*="_overlayLayer"] * {
	-webkit-backdrop-filter: none !important;
	backdrop-filter: none !important;
}
/* ③(2026-09-12) 标题栏右侧展开面板（VS Code 等）不得被标题栏玻璃压到文字下面 */
/* ②(#2 回归修复) 只提层级，**不改 position**：上一版给它 position:relative 导致标题栏被展开面板撑大 */
header [class*="_panel"], header [class*="_popover"], header [class*="_menu"],
header [class*="_expand"], header [class*="_dropdown"] {
	z-index: 60 !important;
}
/* ②(#2) 标题栏不再抬高到设置之上（原 30 > 设置的 20 → 标题栏盖住设置） */
header[class*="_header_"], header.wSkVaW_header { z-index: 5; }
/* 悬浮（卡片化）：左栏（沿用既有 body[data-mpw-float] 语义）+ 右侧 dockkit 新增适配 */
/* ④(2026-09-12 用户实测"右栏还是贴到屏幕上下")：DSH 原生右栏是绝对定位面板（内联 width:581px），
   margin 对它无效 → 必须用 top/bottom/right 内缩 + height:auto 才能变成悬浮卡片。 */
/* ①(#1 用户实测) 右栏里还会内嵌一层同属性的面板（文件界面）→ 内层必须还原成普通矩形，
   只让最外层浮起：用 :has() 排除"自身内部还含同属性面板"的祖先，改为只匹配 push 变体 + 重置嵌套层。 */
/* ①(2026-09-12 用户再次反馈) 右栏内层的"文件界面"面板同样带 data-sidebar-right-panel →
   外层浮起后内层也浮起 = 悬浮窗里又套一个悬浮窗。这里把**任何内层面板**一律还原为普通矩形
   （不限属性取值，覆盖 push/true/其他；同时覆盖 dockkit 内层）。 */
html body[data-mpw-float] [data-sidebar-right-panel] [data-sidebar-right-panel],
html body[data-mpw-float] [data-sidebar-right-panel] [data-dockkit-pane],
html body[data-mpw-float] [data-sidebar-right-panel] [data-dockkit-surface],
html body[data-mpw-float] [data-dockkit-pane] [data-sidebar-right-panel],
html body[data-mpw-float] [data-dockkit-pane] [data-dockkit-pane] {
	top: 0 !important; bottom: 0 !important; right: 0 !important; left: auto !important;
	margin: 0 !important; border-radius: 0 !important; border: none !important; box-shadow: none !important;
	height: 100% !important; max-height: none !important; overflow: visible !important;
}
html body[data-mpw-float] [data-sidebar-right-panel="push"] [data-sidebar-right-panel] {
	top: 0 !important; bottom: 0 !important; right: 0 !important;
	margin: 0 !important; border-radius: 0 !important; border: none !important; box-shadow: none !important;
}
html body[data-mpw-float] [data-sidebar-right-panel="push"] {
	top: 10px !important;
	bottom: 10px !important;
	right: 10px !important;
	height: auto !important;
	max-height: calc(100vh - 20px) !important;
	border-radius: 18px !important;
	border: 1px solid rgba(148,180,220,0.28) !important;
	overflow: hidden !important;
	box-shadow: 0 6px 24px rgba(0,0,0,0.12);
}
html body[data-ds-dark-theme][data-mpw-float] [data-sidebar-right-panel] {
	border-color: rgba(148,180,220,0.34) !important;
}
html body[data-mpw-float] [data-dockkit-pane],
html body[data-mpw-float] [data-dockkit-strip] {
	margin: 10px 10px 10px 0 !important;
	border: 1px solid rgba(148,180,220,0.28) !important;
	border-radius: 18px !important;
	overflow: hidden !important;
	box-shadow: 0 6px 24px rgba(0,0,0,0.10);
	transition: margin .18s ease, border-radius .18s ease, border-color .18s ease;
}
html body[data-ds-dark-theme][data-mpw-float] [data-dockkit-pane],
html body[data-ds-dark-theme][data-mpw-float] [data-dockkit-strip] {
	border-color: rgba(148,180,220,0.32) !important;
}
html body[data-dsh-sidebar-dragging][data-mpw-float] [data-dockkit-pane],
html body[data-dsh-sidebar-dragging][data-mpw-float] [data-dockkit-strip] {
	margin: 0 !important;
	border-radius: 0 !important;
	transition: none !important;
}
/* 修正(2026-09-13 用户第2项) 标题栏内展开的菜单/面板必须盖住标题栏文字：
   VS Code 按钮旁的展开（open-in-app chevron 菜单）此前叠到文字下面——它是 header 的后代，
   而 header 的文字节点在其后/层叠更高。这里把所有 header 内浮层抬到 z-index:90
   （header 本体已 position:relative + overflow:visible，见上方标题栏规则）。 */
html body .wSkVaW_header [role="menu"],
html body .wSkVaW_header [class*="_menu"],
html body .wSkVaW_header [class*="_popover"],
html body .wSkVaW_header [class*="_panel"],
html body .wSkVaW_header [class*="_dropdown"],
html body [class*="wSkVaW_header"] [role="menu"],
html body [class*="wSkVaW_header"] [class*="_menu"],
html body [class*="wSkVaW_header"] [class*="_popover"],
html body [class*="wSkVaW_header"] [class*="_panel"],
html body [class*="wSkVaW_header"] [class*="_dropdown"] {
	/* 修正(2026-09-13 用户反馈"展开框被收进标题栏、标题栏跟着变大")：
	   绝对不要改浮层自己的 position（会把 absolute 变成流内元素 → 撑大标题栏）。
	   这里只给 z-index；真正解决问题的是下面"抬高定位宿主"的规则。 */
	z-index: 90 !important;
}
/* ═══ ①(修正 2026-09-13 用户"展开框又跑到文字底下") 正解：抬高**浮层宿主**的层叠 ═══
   DSH 的后台任务(jobs)浮层结构（dsh-client-ui-jobs 实测源码）：
     .QsffPG_root  { position: relative }                      ← 宿主（trigger 的包裹层，位于 header 内）
     .QsffPG_menu  { position: absolute; top: calc(100% + 5px); left: 0; z-index: 100 }
   浮层自身已经是 absolute + z-index:100，它压在文字下面**不是因为自己层级低**，而是因为它的
   宿主在 header 的层叠里排在标题文字之后（z-index:auto → 按 DOM 顺序绘制）。
   给浮层再加 z-index 是没用的（z-index 只在同一个层叠上下文里比较），给它加 position 会把
   absolute 变流内（就是刚才"撑大标题栏"的 bug）。
   正解：**只给宿主加 z-index**（宿主本来就是 position:relative → 加 z-index 不产生任何布局变化），
   宿主整体就被抬到标题文字之上，里面的 absolute 浮层自然跟着上来。
   同时兼容 hash 变化：凡是 header 内含 _menu/_popover 的 _root 宿主，一并抬高。 */
html body header [class*="QsffPG_root"],
html body header [class*="QsffPG"],
html body .wSkVaW_header [class*="QsffPG_root"],
html body .wSkVaW_header [class*="QsffPG"],
html body [class*="wSkVaW_header"] [class*="QsffPG_root"],
html body [class*="wSkVaW_header"] [class*="QsffPG"] {
	z-index: 500 !important;
}
/* 说明：曾用 [class*="_root"]:has([class*="_menu"]) 广撒网抬层级，但它会把**标题文字所在容器**
   也一起抬到同层级（DOM 更靠后 → 反而压住浮层）。已删除，只保留精确的浮层宿主规则。 */

/* ═══ ①(修正 2026-09-13 用户第1+3项) 右侧栏**全屏**：要磨砂玻璃，不要死白 ═══
   用户要求：全屏时也要"背景模糊"，而不是被强制不透明；同时又不能让聊天输入框/消息框清晰地
   透在右栏上。做法 = 真正的磨砂玻璃（半透明底 + backdrop blur）+ 抬高 z-index：
     * 半透明底用右侧栏自己的设置（--mpw-rs-alpha，默认 45 → 乘 0.55 后 ≈25%）；
     * backdrop blur 用 --mpw-rs-blur（匹配「右侧边栏/dock 虚化」条），把背后内容糊掉；
     * z-index:40 高于聊天输入框 seat 的 z-index:7（conversation 的 wSkVaW_composerSeat），
       避免输入框画在右栏之上。
   DSH 全屏时给 frame 打 data-rightbar-fullscreen（ui-layout AppFrame.module.css），只在该状态生效。 */
html body .pI_x6G_frame[data-rightbar-fullscreen] [data-sidebar-right-panel],
html body [data-rightbar-fullscreen] [data-sidebar-right-panel],
html body .pI_x6G_frame[data-rightbar-fullscreen] [class*="P3OORG_panel"],
html body [data-rightbar-fullscreen] [class*="P3OORG_panel"] {
	z-index: 40 !important;
	-webkit-backdrop-filter: blur(var(--mpw-rs-blur, 14px)) saturate(140%) !important;
	backdrop-filter: blur(var(--mpw-rs-blur, 14px)) saturate(140%) !important;
	background-color: var(--mpw-surface-rs-full) !important;
}
/* 全屏时把聊天输入框区域压到右栏之下（即便它有自己的 stacking context 也不会盖住卡片圆角） */
html body [data-rightbar-fullscreen] .wSkVaW_composerSeat,
html body [data-rightbar-fullscreen] [class*="composerSeat"] {
	z-index: 5 !important;
}

/* ═══ ①(修正 2026-09-13 第9/10 项 → 再修正为 用户第1/2项反馈) 悬浮右栏内 tab 条几何 ═══
   背景：DSH 原生 tab 条规则是
     ._tabStrip_17p4l_156 { display:flex; height:28px; padding:10px 6px 0 10px; align-items:center }
   即 **content-box** 下总高 = 28 + 10(top) = 38px。
   上一版我给它加了 box-sizing:border-box + padding-left/right:10px 想造左右对称间隙，
   结果把 28px 的内容高吃掉了 10px → 用户实测"导航栏被切变小了"。
   现在：**不改任何尺寸相关属性**（box-sizing / padding / height 全部交回 DSH），
   只用 margin-left 造左侧间隙：flex 子项 width:auto 会随 margin 自动收窄，
   所以右侧原有的间隙不会被挤掉，也不会溢出到面板外。
   垂直居中交给 DSH 自己的 align-items:center（这里只做保险，不改尺寸）。
   ⚠ 注意：本段位于 JS 模板字符串内，注释里**禁止出现反引号**（会提前终止模板 → buildCss 抛错
   → 整张样式表为空 → 画面错乱；panel-smoke 的 CSS 结构校验会拦住）。 */
html body[data-mpw-float] [data-sidebar-right-panel] [data-dockkit-strip],
html body[data-mpw-float] [data-sidebar-right-panel] [class*="_tabStrip"] {
	margin-left: 10px !important;
	align-items: center !important;
}
html body[data-mpw-float] [data-sidebar-right-panel] [data-dockkit-strip] > *,
html body[data-mpw-float] [data-sidebar-right-panel] [class*="_tabStrip"] > * {
	align-self: center !important;
}
/* ①(修正 2026-09-13 第12项，按用户要求收窄选择器) 悬浮模式下，**只针对轨迹页**：其"总览"区块
   会横向溢出到悬浮右栏上。这里把裁剪切在轨迹页自身根节点（不是整个中间列），因此不会夹到
   其它面板/弹层。选择器同时写 hash 类与结构类名，兼容 DSH 重编译后的 hash 变化。
   （qBU-ya_root 轨迹根 / fV0t5q_root 顶部工具条 / Y0dWHa_overview 总览 / _1p9O6q_root 轨道区）
   回退：给 body 加 data-mpw-traject-clip="off"。 */
html body[data-mpw-float]:not([data-mpw-traject-clip="off"]) .qBU-ya_root,
html body[data-mpw-float]:not([data-mpw-traject-clip="off"]) [class$="_root"][class*="qBU-ya"],
html body[data-mpw-float]:not([data-mpw-traject-clip="off"]) .Y0dWHa_overview,
html body[data-mpw-float]:not([data-mpw-traject-clip="off"]) [class*="_overview"] {
	max-width: 100% !important;
	box-sizing: border-box !important;
}
html body[data-mpw-float]:not([data-mpw-traject-clip="off"]) .qBU-ya_root,
html body[data-mpw-float]:not([data-mpw-traject-clip="off"]) [class*="qBU-ya"] {
	overflow-x: clip !important;
}
html body[data-mpw-float]:not([data-mpw-traject-clip="off"]) [class*="_overview"] {
	overflow-x: auto !important;            /* 需要时总览自己内部横滚，而不是画到面板外 */
	overscroll-behavior-x: contain !important;
}
`;
			}
			// ②(新) 弹层虚化（菜单/提示/data-surface，独立于对话框）
			// ①(修正 2026-09-13 用户截图定案"浮层被压住") 真机截图显示：后台任务浮层是**半透明**的，
			//   后面的对话文字直接透过来（不是 z-order 被压，而是"透"）。
			//   根因：统一雾（aquaMask）会把 --dsw-specific-menu 等弹层 token 调成 ~86% 半透明，
			//   而"弹层虚化"（popoverBlur）若关闭 → 既半透明又**没有 backdrop blur** → 背后文字清晰可见。
			//   规则：**只要弹层是半透明的，就必须带 backdrop 模糊**（模糊半径：弹层虚化开着用它，否则 14px）。
			const maskOnHere = section.aquaMask !== void 0 ? !!section.aquaMask : DEFAULT_AQUA_MASK;
			const tintOnHere = section.aquaTint !== void 0 ? !!section.aquaTint : DEFAULT_AQUA_TINT;
			const menuTranslucent = maskOnHere || tintOnHere;
			// ④(新) 弹层表面不透明度：默认 94；用户可用「弹层不透明度」滑条调低（模糊生效时 ~80 仍有玻璃感）。
			const popSurfaceAlpha = (() => {
				const v = section.popoverAlpha !== void 0 ? section.popoverAlpha : DEFAULT_POPOVER_ALPHA;
				const n = Number(v);
				return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : DEFAULT_POPOVER_ALPHA;
			})();
			// 深色主题用深底（浅底 + 浅色文字 = 看不见字），浅色主题用白底；
			// 若用户开了主题色（--mpw-theme-color）则跟随主题色，保持与整屏一致。
			const popSurfaceRgb = `var(--mpw-chrome-bg, 255,255,255)`;
			/* ①(2026-09-18 §5 第1项) 弹层（面板家族）表面 → 两枚表面 token（不透明度走 --mpw-pop-alpha，
			   调用方可临时覆盖；默认值仍是「弹层不透明度」滑条）。 */
			tok("--mpw-surface-pop", `rgba(${popSurfaceRgb}, var(--mpw-pop-alpha, ${(popSurfaceAlpha / 100).toFixed(2)}))`);
			tok("--mpw-surface-pop-dark", `rgba(18, 22, 30, var(--mpw-pop-alpha, ${(popSurfaceAlpha / 100).toFixed(2)}))`);
			// 弹层**表面**选择器（背景 + 模糊共用一份，避免两处写法漂移）。
			// ③(关键收窄 2026-09-13) 只用 [class*="_menu"] 会连**非表面**一起命中：
			//   实测宿主的 `.nyYjTG_menuAnchor` / `.cubgiG_menuAnchor`（按钮外壳）、
			//   `.YDXeBa_menuOpen`（触发键的展开态）、`.nyYjTG_menuActionIcon`（图标）、
			//   `._G5b-a_menuStatus`（说明文字）都含 "_menu" ——
			//   给它们加 backdrop-filter 会在界面上糊出一块方块，加底色会糊出白块。
			//   这里显式排除 anchor/icon/status/open/item/row/trigger/card 等非表面后缀。
			const POP_NOT = `:not([role="menuitem"]):not([role="option"]):not([class*="Anchor"]):not([class*="anchor"]):not([class*="Icon"]):not([class*="icon"]):not([class*="Status"]):not([class*="status"]):not([class*="Open"]):not([class*="open"]):not([class*="_item"]):not([class*="Item"]):not([class*="_row"]):not([class*="Row"]):not([class*="_trigger"]):not([class*="Trigger"]):not([class*="_card"]):not([class*="Card"]):not([class*="_groupTitle"])`;
			const popSurfaceSel = `[role="menu"]${POP_NOT}, [role="listbox"]${POP_NOT}, [role="combobox"]${POP_NOT}, [data-dsh-surface]${POP_NOT}, [class*="_menu"]${POP_NOT}, [class*="_popover"]${POP_NOT}, [class*="_dropdown"]${POP_NOT}, [class*="_denseList"]${POP_NOT}`;
			const popTipSel = `[role="tooltip"], [role="alert"]`;
			const popSurfaceCss = (popSurfaceAlpha < 100 || popoverBlur || menuTranslucent)
				? `/* 弹层表面底色兜底（浅色/深色两套；不透明度由「弹层不透明度」控制） */
html body :is(${popSurfaceSel}) {
	background-color: var(--mpw-surface-pop) !important;
}
html body[data-ds-dark-theme] :is(${popSurfaceSel}) {
	background-color: var(--mpw-surface-pop-dark) !important;
}
`
				: ''
			if ((popoverBlur && popoverAmount > 0) || menuTranslucent) {
				const popAmount = (popoverBlur && popoverAmount > 0) ? popoverAmount : 14;
				const popFilter = `blur(${popAmount}px)`;
				css += `
/* ── 弹层虚化（菜单/下拉/提示/列表/悬浮面板，非居中窗口） ──
   覆盖范围除 role=*，还包含 DSH 实际用到的类名（jobs 面板 .QsffPG_menu 是 <ul> 无 role，
   open-in-app 的下拉是 div._denseList_），否则它们会"半透明又无模糊"。
   表面选择器与上面的底色规则共用（POP_NOT 已排除 anchor/icon/status 等非表面类）。 */
${popTipSel},
${popSurfaceSel} {
	backdrop-filter: ${popFilter} !important;
	-webkit-backdrop-filter: ${popFilter} !important;
}
[role="menu"] [class*="card"],
[role="tooltip"] [class*="card"] {
	backdrop-filter: none !important;
}
/* ── 弹层**表面底色**兜底（用户"浮层被压住"的根治项之一）──
   背景过去只来自宿主 token（--dsw-specific-menu / -tip / -selector …），
   不同组件用的 token 不一样，一旦某个链路把 token 改透明、或 backdrop 模糊在
   某些环境失效，弹层就会把背后的对话文字**锐利地**透出来（截图实锤）。
   这里给"确实是浮层表面"的元素补一条**显式底色**，不透明度由「弹层不透明度」控制：
     · 模糊生效 → 可以调低到 ~80，玻璃感保留且文字不可辨；
     · 模糊失效/环境不支持 → 保持 94+ 仍然可读。
   排除项（重要，避免误伤）：
     · [role="tooltip"]/[role="alert"]：宿主用**深色**底 + 浅色字（--dsw-alias-tooltip-bg），
       强行刷白会让文字消失 → 只保留模糊，不动底色；
     · 菜单里的 item/row/trigger/card：它们要保留 hover 高亮，刷 !important 底色会把
       hover 状态一并盖掉（历史教训：一条过宽规则能毁掉一批交互态）。 */
${popSurfaceCss}`;
			} else if (popSurfaceCss) {
				// 弹层虚化关、但用户明确调低了表面不透明度 → 仍然要发底色兜底
				css += popSurfaceCss;
			}
			// ⑯ 虚化关 → 输入框纯白不透明（用户要求：关闭虚化则输入框不透明）
			if (hasImage && !(dialogBlur && dialogAmount > 0)) {
				css += `
[data-composer-card] {
	background-color: var(--dsw-alias-bg-base) !important;
	backdrop-filter: none !important;
	-webkit-backdrop-filter: none !important;
}
[data-slot*="composer"] [class*="seat"],
[data-slot*="composer"] [class*="Seat"] {
	background: transparent !important;
	backdrop-filter: none !important;
}
`;
			}
			// ⑯(新) 5 处未虚化区域补透明（DOM 研究确认的选择器）
			if (hasImage) {
				css += `
/* ── 5 处未虚化区域：背景透明透出（模糊的）壁纸 ── */
/* 区域1: 左上角品牌+新会话按钮（半透明，与侧边栏一致）。
   ③(修正) unify 开时随 sessionFollow（开=跟随不透明度条；关=面板不透明度） */
button[class*="newSession"] {
	/* ①(修正) 收起态新会话按钮同样随 sidebarAlpha（U(panel)） */
	background-color: color-mix(in srgb, var(--dsw-alias-button-elevated-fill) ${U(panel)}%, transparent) !important;
	border-color: color-mix(in srgb, var(--dsw-alias-border-l2) 65%, transparent) !important;
}
/* 区域4: 标题栏下方 1px 横线（header::after）去掉 */
.wSkVaW_header:after { display: none !important; }

/* 区域3: Cordis 面板（设置上方状态条，无 role=dialog）补虚化 + 半透明。
   ③(新) unify 开 → 与聊天区同色系（static 色），backdrop-filter 取消（整屏磨砂接管） */
[data-cordis-panel] {
	backdrop-filter: ${unifyTint ? "none" : blurFilter} !important;
	-webkit-backdrop-filter: ${unifyTint ? "none" : blurFilter} !important;
	background-color: var(--mpw-surface-plugin-panel) !important;
}
${unifyTint ? `body:not([data-ds-dark-theme]) [data-cordis-panel] {
	background-color: var(--mpw-surface-plugin-panel-unify-light) !important;
}` : ""}
[data-cordis-panel] [class*="row"] {
	background-color: var(--mpw-surface-plugin-row) !important;
}
${unifyTint ? `body:not([data-ds-dark-theme]) [data-cordis-panel] [class*="row"] {
	background-color: var(--mpw-surface-plugin-row-unify-light) !important;
}` : ""}
/* 区域5b: 收起后 rail 内部面（logoRow/newSession/footArea）透出模糊壁纸：
   同样不加 backdrop-filter（root 是弹层祖先，会困住 fixed 弹层）。
   ①(修正) 必须限定在 sidebarCol 内——data-sidebar-collapsed 挂在 frame 上，
   原写法 [class*="root"] 会命中**全应用**所有 class 含 root 的元素
   （聊天区 todo 卡片等），侧边栏收起时把它们背景强制透明
   （用户实测：收起时 todo list 变透明，展开恢复）。 */
[data-sidebar-collapsed] [class*="sidebarCol"] [class*="root"],
[data-sidebar-collapsed] .pI_x6G_sidebarCol [class*="root"] {
	background-color: transparent !important;
}
/* ②(修正) 收起态悬浮外壳**绝不设 position/z-index**：设置面板（sidebar.settings
   的 full-viewport fixed overlay，z-index:1000）渲染在 sidebarCol 内，一旦给
   sidebarCol 设 position:relative + z-index，就创建包含块/层叠上下文 → overlay
   的 fixed 定位被侧边栏困住，对话框叠在设置上、位置错乱（用户实测：悬浮开 +
   侧边栏收起时点设置，对话框盖在设置面板上方）。悬浮只做 margin/圆角/边框，
   层叠交给 DSH 自己（overlay z-index:1000 恒在 rail 内容之上）。 */
`;
			}
			// ①(修正) 遮罩虚化无条件生效（不依赖是否有壁纸——无壁纸时弹窗遮罩也要模糊，
			// 否则遮罩只有灰底无模糊、弹窗边框透明（用户实测））
			css += `
/* ②(重做) 遮罩虚化独立（maskBlur/maskAmount）：设置/弹层打开时全屏背景遮罩的虚化
   ①(修正) 同无壁纸分支：作用于 DSH 弹窗遮罩 [class$="_mask"] + 插件 .mpw_mask。
   $= 结尾匹配只命中真正的遮罩类（session 导出弹窗遮罩等），不误伤设置 overlay */
[class$="_mask"], .mpw_mask {
	backdrop-filter: ${(maskBlur && maskAmount > 0 && bdSupported) ? `blur(${maskAmount}px)` : "none"} !important;
	-webkit-backdrop-filter: ${(maskBlur && maskAmount > 0 && bdSupported) ? `blur(${maskAmount}px)` : "none"} !important;
}
/* ①(修正) 遮罩背景加深一点（防字叠字；:has 兼容性差不用） */
[class$="_mask"], .mpw_mask { background: rgba(0,0,0,0.55) !important; }
`;
			if (thinkBg) {
				// 开关开：恢复 Deep diving 背景方框 + 虚化 + 蓝色文字
				// （方框=渐变背景，浏览器未生效 background-clip:text 时显示为方框；
				//   生效时渐变只在文字上=蓝色文字；backdrop-filter 虚化方框背后的壁纸）
				const dlgFilter2 = dialogBlur && dialogAmount > 0 ? `blur(${dialogAmount}px)` : "blur(12px)";
				css += `
/* Deep diving 背景方框（开关：开）→ 方框 + 虚化 + 蓝字 */
[data-variant="think"] { background: var(--dsw-alias-bg-base) !important; }
[role="status"] {
	background: linear-gradient(90deg, var(--dsw-static-deepseek-500) 0%, var(--dsw-static-deepseek-500) 40%, var(--dsw-static-deepseek-200) 50%, var(--dsw-static-deepseek-500) 60%, var(--dsw-static-deepseek-500) 100%) !important;
	-webkit-background-clip: text !important; background-clip: text !important;
	color: transparent !important; -webkit-text-fill-color: transparent !important;
	backdrop-filter: ${dlgFilter2} !important;
	-webkit-backdrop-filter: ${dlgFilter2} !important;
}
`;
			} else {
				// 开关关（默认）：取消 Deep diving 背景方框，文字显示在壁纸上
				css += `
/* Deep diving 背景方框（开关：关）→ 透明 + 文字可见色 */
[data-variant="think"] { background: transparent !important; }
[data-variant="think"] [class*="thinkBody"] { background: transparent !important; }
[role="status"] {
	background: transparent !important;
	backdrop-filter: none !important;
	-webkit-backdrop-filter: none !important;
	color: var(--dsw-alias-label-secondary, #9aa4b2) !important;
	-webkit-text-fill-color: var(--dsw-alias-label-secondary, #9aa4b2) !important;
	-webkit-background-clip: border-box !important;
	background-clip: border-box !important;
}
`;
			}
			css += `
@supports not (backdrop-filter: blur(1px)) {
	.hHd-Xa_regionArea, .wSkVaW_scrollBody, .ydkMvW_body { backdrop-filter: none !important; }
}
`;
			// ⑲(新) Aqua 实验模式：文字色/品牌蓝兜底 + 弹层模糊（token override 之外）
			if (aquaOn(section)) {
				css += `
/* ── Aqua 实验模式：自适应文字色 + 蓝色清理（可开关，默认关） ──
   ①(2026-09-16 bug①根治) 覆盖必须**门控在"ink 真被 JS 写入"时**，并且**去掉 inherit 兜底**：
   旧写法 var(--mpw-aqua-ink, inherit) 在 ink 缺失时把宿主 token 设成 inherit 关键字，
   而 DSH 的 --dsw-alias-label-* 定义在 **body**（html 上没有）⇒ body 上该自定义属性成为
   guaranteed-invalid ⇒ 任何 var(--dsw-alias-label-primary) 的声明（例如右侧轮次导航条
   激活态 .eGxaPq_markActive::before{background:...}）在 computed-value time 变 unset =
   **transparent** —— 这正是"壁纸模式下右边时间线的条变透明"的硬机制之一。
   门控属性 data-mpw-aqua-ink 由 refreshAqua() 维护（写入 ink 时打上，清理时移除）。 */
body[data-mpw-aqua][data-mpw-aqua-ink] {
	--dsw-alias-label-primary: var(--mpw-aqua-ink);
	--dsw-alias-label-secondary: var(--mpw-aqua-ink-secondary);
	--dsw-alias-label-tertiary: var(--mpw-aqua-ink-tertiary);
	--dsw-alias-label-caption: var(--mpw-aqua-ink-tertiary);
	--dsw-alias-label-dimmed: var(--mpw-aqua-ink-tertiary);
	/* ①(修正) 品牌交互色优先用「配色」(accent)：默认(空)=aqua-ink；选了 accent 才用所选色。
	   fallback 链里不再出现 inherit/自引用（两者都会产生 guaranteed-invalid）。 */
	--dsw-alias-brand-primary: var(--mpw-accent-color, var(--mpw-aqua-ink));
	--dsw-alias-brand-text: var(--mpw-accent-color, var(--mpw-aqua-ink));
	--dsw-alias-state-business-primary: var(--mpw-accent-color, var(--mpw-aqua-ink-secondary));
}
/* ①(修正) 配色(accent) 不依赖 Aqua 也改品牌交互色/发送键(第4/5项):
   body 有 data-mpw-accent(选了配色) 时, brand-primary/button-info-fill/state-business
   全部用所选 accent 色——否则 accent 只在 Aqua 模式生效, 用户没开 Aqua 时配色无效。 */
body[data-mpw-accent] {
	--dsw-alias-brand-primary: var(--mpw-accent-color);
	--dsw-alias-brand-text: var(--mpw-accent-color);
	--dsw-alias-state-business-primary: var(--mpw-accent-color);
	--dsw-alias-button-info-fill: var(--mpw-accent-color);
	--dsw-alias-button-info-hover: var(--mpw-accent-color);
}
/* ①(修正) 发送键颜色用 accent(配色)：非 Aqua 也覆盖(原 3027 规则在 body[data-mpw-aqua]
   门控下, 没开 Aqua 时发送键不变——用户实测"改了配色发送键没变") */
body[data-mpw-accent] [data-composer-card] [class*="primary"],
body[data-mpw-accent] [data-slot*="composer"] [class*="primary"] {
	background-color: var(--mpw-accent-color) !important;
	color: var(--mpw-aqua-brand-contrast, #fff) !important;
}
/* ①(修正) 面板取色/统一雾时标题栏背景跟随 mask 色（用户实测只改侧边栏不改标题栏）。
   ①(修正2) 标题栏是否刷 mask 色由 JS 打 data-mpw-aqua-header 门控：
   纯 aquaInk（自适应文字色）时不刷——此时遮罩色=主题中性色（亮色主题=白），
   会把标题栏刷成 62% 白 → session log/标准模式背后的「白框」（用户实测：
   统一虚化 + 自适应文字色同时开出现）。 */
body[data-mpw-aqua][data-mpw-aqua-header] .wSkVaW_header {
	background-color: color-mix(in srgb, rgb(var(--mpw-aqua-rgb)) 62%, transparent) !important;
	backdrop-filter: none !important;
}
body[data-mpw-aqua] .wSkVaW_header {
	backdrop-filter: none !important;
}
/* ⑲(修正) Aqua 模式下弹层背景被 mask 色半透明化，必须配 backdrop blur 防文字叠压
   （用户实测：加号/命令/权限/模型/上下文选择器透明但无模糊 → 文字叠在一起） */
body[data-mpw-aqua] [role="menu"],
body[data-mpw-aqua] [role="listbox"],
body[data-mpw-aqua] [role="combobox"],
body[data-mpw-aqua] [data-dsh-surface] {
	backdrop-filter: blur(14px) !important;
	-webkit-backdrop-filter: blur(14px) !important;
}
/* ⑲(修正) 发送键对比：背景用品牌色（ink 或自定义），图标反色 → 不再"只剩圆圈"
   （用户实测默认 ink 下发送键背景变浅、箭头看不清） */
body[data-mpw-aqua] [data-composer-card] [class*="primary"],
body[data-mpw-aqua] [data-slot*="composer"] [class*="primary"] {
	background-color: var(--dsw-alias-brand-primary, var(--mpw-aqua-ink)) !important;
	color: var(--mpw-aqua-brand-contrast, var(--mpw-aqua-ink-contrast)) !important;
}
/* ⑲(修正) 本插件弹窗（冲突/下载/确认）文字保持主题对比色，不跟 ink
   （用户实测：aquaInk 开时冲突弹窗文字与背景叠色看不清） */
body[data-mpw-aqua] .mpw_dialog { color: var(--dsw-static-neutral-bluish-850) !important; }
body[data-mpw-aqua] body[data-ds-dark-theme] .mpw_dialog { color: var(--dsw-static-neutral-bluish-100) !important; }
body[data-mpw-aqua] .mpw_dialog .mpw_title,
body[data-mpw-aqua] .mpw_dialog .mpw_label,
body[data-mpw-aqua] .mpw_dialog .mpw_hint,
body[data-mpw-aqua] .mpw_dialog .mpw_value { color: inherit !important; }
/* ⑲(修正) 深底文字可读增强（aquaTextEnhance，独立开关）：之前只打 data-mpw-aqua-text
   属性但 buildCss 没生成规则 → 功能无效（用户实测）。给聊天/内容文字加双色描边
   （深色阴影 + 浅色高光），黑底/深色背景上也能看清。近似：无法精确只变经过
   深色处的字，故全量加描边；默认关。 */
/* ①(#16) 亮度自适应文字色：token 覆盖（仅在"深底文字可读增强"开启时生效）
   ①(2026-09-16 bug①根治) 两处修正：
     · 门控 [data-mpw-text-ink]：只有 JS 真把 --mpw-text-ink 写进 html 时才覆盖；
     · **去掉自引用 fallback**（旧写法 var(--mpw-text-ink, var(--dsw-alias-label-primary))
       在同一个元素上定义 --dsw-alias-label-primary 时构成循环引用 ⇒ guaranteed-invalid
       ⇒ 所有引用该 token 的声明变 unset（背景透明/文字失色），右侧时间线的激活条正是其一）。 */
body[data-mpw-aqua-text][data-mpw-text-ink] {
	/* ①(修正 2026-09-13 第16项 token 漂移) DSH 0.1.5 用 label-* 家族；text-* 仅 0.1.4- 存在。
	   两套都写：旧版走 text-*，新版走 label-*（否则自适应文字色在 0.1.5 上完全不生效）。 */
	--dsw-alias-text-primary: var(--mpw-text-ink) !important;
	--dsw-alias-text-secondary: var(--mpw-text-ink-dim) !important;
	--dsw-alias-text-tertiary: var(--mpw-text-ink-dim) !important;
	--dsw-alias-label-primary: var(--mpw-text-ink) !important;
	--dsw-alias-label-secondary: var(--mpw-text-ink-dim) !important;
	--dsw-alias-label-tertiary: var(--mpw-text-ink-dim) !important;
}
body[data-mpw-aqua-text] .wSkVaW_scrollBody,
body[data-mpw-aqua-text] [data-slot*="message"],
body[data-mpw-aqua-text] [data-slot*="conversation"] [class*="message"] {
	// ①(修正) 深底文字可读增强换实现：原方案「黑阴影+白高光」，白高光(rgba(255,255,255,.18))
	// 在亮色背景上让文字发白重影→变糊(用户实测"像打印机")。改为**纯深色投影**(双层)：
	// 深色/黑底上提供对比(字不被淹没)，亮色背景只加轻微立体感、不发白不糊。
	text-shadow: 0 1px 2px rgba(0,0,0,0.78), 0 0 6px rgba(0,0,0,0.22);
}
body[data-mpw-aqua-text] [role="dialog"],
body[data-mpw-aqua-text] .mpw_dialog {
	text-shadow: none !important;
}
`;
			}
			// ⑲(新) 任务列表（todo 卡片）磨砂背景：收纳/展开状态都模糊（类似标题栏/侧边栏磨砂）。
			// 独立开关（todoBlur，默认关）。
			// ②(修正) 去掉 70% 白色底条（用户实测像"灰色滤镜"+ 白色底条难看），
			// 改为纯 backdrop blur：背景透明，背后内容（壁纸/聊天区）真模糊 = 磨砂玻璃。
			if (section.todoBlur !== void 0 ? !!section.todoBlur : false) {
				css += `
/* ── 任务列表磨砂（实验，默认关）：todo 卡片纯模糊，无白色底条 ──
   ①(修正) 选择器改为 DSH 任务列表卡片真实容器(用户实测给的真实 CSS 路径:
   section[class*="lXshSW_root"], 类名 lXshSW_root 是 CSS Modules hash).
   并保留旧的 [data-tool="todo_write"] 作兼容(不同 DSH 版本 hash 可能变). */
body[data-mpw-todo-blur] section[class*="lXshSW_root"],
body[data-mpw-todo-blur] [data-tool="todo_write"] {
	backdrop-filter: blur(16px) !important;
	-webkit-backdrop-filter: blur(16px) !important;
	background-color: transparent !important;
}
body[data-mpw-todo-blur] section[class*="lXshSW_root"] *,
body[data-mpw-todo-blur] [data-tool="todo_write"] * {
	background-color: transparent !important;
}
`;
			}
			// ①(新) 液态玻璃（CSS 版）：给标记 [data-mpw-lg-css] 的目标元素加磨砂玻璃
			// 材质（半透明 + backdrop-filter 模糊背后内容）。不清壁纸、不覆盖内容、不崩。
			// 不同元素不同 blur 半径：输入框/侧边栏/标题栏各自可调（复用 lg 开关）。
			css += `
/* ── 液态玻璃（CSS 版）──
   ①(修正) **侧边栏玻璃不能用 backdrop-filter**：sidebarCol 是 DSH 设置弹窗的祖先
   （弹窗渲染在 sidebarCol > settingsArea 内），backdrop-filter 会创建 containing block
   → 设置弹窗被"困"进侧边栏压缩成窄条（用户实测；与之前 Via 设置被压缩同根因）。
   故 sidebarCol 的玻璃**只半透明 + 边缘高光**（无 blur），磨砂由壁纸层 blur 提供
   （见 G/E 块）。输入框/标题栏不是设置弹窗祖先，可用 backdrop-filter。 */
/* 通用玻璃材质（输入框/标题栏等）：半透明 + backdrop blur */
body:not([data-ds-dark-theme]) [data-mpw-lg-css] {
	background-color: color-mix(in srgb, #eef1f7 45%, transparent) !important;
}
body[data-ds-dark-theme] [data-mpw-lg-css] {
	background-color: color-mix(in srgb, #10141f 45%, transparent) !important;
}
/* backdrop blur 仅用于**非侧边栏**目标（输入框/标题栏）；sidebarCol 排除 */
body:not([data-ds-dark-theme]) [data-mpw-lg-css]:not([class*="sidebarCol"]):not([class*="wSkVaW_header"]) {
	backdrop-filter: blur(${(() => { const v = Number(section.lgBlur); return Number.isFinite(v) ? Math.max(4, Math.min(40, v)) : 18; })()}px) saturate(1.4) !important;
	-webkit-backdrop-filter: blur(${(() => { const v = Number(section.lgBlur); return Number.isFinite(v) ? Math.max(4, Math.min(40, v)) : 18; })()}px) saturate(1.4) !important;
}
body[data-ds-dark-theme] [data-mpw-lg-css]:not([class*="sidebarCol"]):not([class*="wSkVaW_header"]) {
	backdrop-filter: blur(${(() => { const v = Number(section.lgBlur); return Number.isFinite(v) ? Math.max(4, Math.min(40, v)) : 18; })()}px) saturate(1.4) !important;
	-webkit-backdrop-filter: blur(${(() => { const v = Number(section.lgBlur); return Number.isFinite(v) ? Math.max(4, Math.min(40, v)) : 18; })()}px) saturate(1.4) !important;
}
/* 玻璃边缘高光（液态玻璃感）：顶部一条细亮边 */
[data-mpw-lg-css] { position: relative; }
[data-mpw-lg-css]:before {
	content: ""; position: absolute; top: 0; left: 0; right: 0; height: 1px;
	background: linear-gradient(90deg, transparent, rgba(255,255,255,0.35) 25%, rgba(255,255,255,0.35) 75%, transparent);
	pointer-events: none; z-index: 1;
}
`;
			// ①(修正) 主题颜色(themeColor) 独立块 —— 第4项：不依赖「标题栏透出」/
			// 「侧边栏透出」开关，只要设置了主题颜色就 tint 侧边栏/标题栏/新会话按钮/
			// 设置弹窗。放在 buildCss 最末尾（最后追加 → 覆盖前面所有同特异性规则，
			// 包括透出开关的纯色/透明分支），由 body[data-mpw-theme] 门控。
			// ①(Qoder 审查 R1) CSS 内容统一走 buildThemeColorCss()（两分支共用）。
			css += buildThemeColorCss();
			return emitSurfaceTokens(css + buildUiCss(section, dlgFrosted));
		}

		/** 设置页 UI 样式（与背景模式无关，公共部分）。 */
		function buildUiCss(section, dlgFrosted) {
			const roundCompat = section && section.roundCompat !== void 0 ? !!section.roundCompat : DEFAULT_ROUND_COMPAT;
			const floatOn = section && section.float !== void 0 ? !!section.float : DEFAULT_FLOAT;
			return `
/* ── 设置页 UI ── */
.mpw_row { display: flex; flex-direction: column; gap: 10px; padding: 4px 0; max-width: 720px; }
/* ①(修正) 壁纸引擎设置区（右侧）背景：半透明灰（像左侧设置栏），而不是白色区块 */
.mpw_glassHost {
	/* ①(修正) 不用 --dsw-specific-sidebar-fill：aquaTint（面板匹配壁纸色）会 override
	   该 token（tinted 0.85）→ 本设置容器随 aquaTint 变色（用户实测「壁纸引擎背景
	   右边设置区跟着面板颜色变」）。改用不受 aqua 影响的 static 色 + 半透明，既透出
	   壁纸又不随 aquaTint 变。 */
	background: var(--mpw-surface-glass) !important;
	border-radius: 14px; padding: 10px 12px;
}
body[data-ds-dark-theme] .mpw_glassHost {
	background: var(--mpw-surface-glass-dark) !important;
}
.mpw_title { font-size: 16px; line-height: 24px; font-weight: 600; color: var(--dsw-alias-label-primary); }
/* ①(新) 活动进度条（转码/scene 提取）：设置面板顶部细条 */
.mpw_busy {
	display: flex; flex-direction: column; gap: 5px;
	margin: 8px 0 2px; padding: 8px 12px;
	border: 1px solid color-mix(in srgb, var(--dsw-alias-border-l2) 60%, transparent);
	border-radius: 10px;
	background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 45%, transparent);
}
.mpw_busyText { font-size: 12px; line-height: 16px; color: var(--dsw-alias-label-secondary); }
.mpw_busyBar {
	position: relative; height: 6px; border-radius: 3px; overflow: hidden;
	background: color-mix(in srgb, var(--dsw-alias-interactive-bg-hover) 55%, transparent);
}
.mpw_busyFill {
	height: 100%; border-radius: 3px;
	background: var(--dsw-alias-brand-primary, #4f8cff);
	transition: width .3s ease;
}
.mpw_busyIndet .mpw_busyFill { width: 30% !important; animation: mpwBusySlide 1.2s ease-in-out infinite; }
@keyframes mpwBusySlide {
	0% { transform: translateX(-100%); }
	100% { transform: translateX(350%); }
}
.mpw_busyPct { align-self: flex-end; font-size: 11px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.mpw_desc { font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-tertiary); margin: 0; }
/* ⑤(重做) 分组排版：大分组标题用背景块区分（不再只是一条线，一眼分清分组） */
.mpw_section {
	margin: 16px 0 6px; padding: 7px 12px;
	border-radius: 10px;
	background: color-mix(in srgb, var(--dsw-alias-label-primary) 7%, transparent);
	font-size: 13px; line-height: 20px; font-weight: 600;
	color: var(--dsw-alias-label-primary); letter-spacing: 0.02em;
}
.mpw_section:first-of-type { margin-top: 10px; }
/* ⑳(修正) 取色盘色块（点开取色器的按钮） */
.mpw_colorSwatch {
	flex: none; width: 84px; height: 38px; box-sizing: border-box;
	border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px;
	cursor: pointer; position: relative;
}
.mpw_colorSwatch::after {
	content: ""; position: absolute; inset: 0; border-radius: 8px;
	border: 1px solid rgba(0,0,0,.15); pointer-events: none;
}
/* ⑳(修正) 顶部 Tab 条：圆角导航栏 + 下划线平滑移动（indicator 平移）+ 内容真滑动 */
 .mpw_tabBar {
	display: flex; gap: 2px; align-items: center;
	position: relative;
	border-radius: 12px; padding: 4px 6px;
	margin-bottom: 8px; position: sticky; top: 0; z-index: 5;
	background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 65%, transparent);
	border: 1px solid color-mix(in srgb, var(--dsw-alias-border-l2) 60%, transparent);
	/* ①(修正) tab 增多后超出屏宽 → 最后一个被切。改横向滚动（隐藏滚动条但可滚），
	   保证所有 tab 都能滑到；配合下一条的紧凑字号/间距尽量一屏放下。 */
	overflow-x: auto; overflow-y: hidden;
	scrollbar-width: none; /* 隐藏滚动条（Firefox） */
}
.mpw_tabBar::-webkit-scrollbar { display: none; } /* 隐藏滚动条（WebKit） */
body[data-ds-dark-theme] .mpw_tabBar {
	background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 45%, transparent);
}
.mpw_tab {
	flex: none; font: inherit; color: var(--dsw-alias-label-secondary);
	cursor: pointer; white-space: nowrap; background: 0 0; border: none;
	/* ①(修正) 紧凑：字号 13→12、左右 padding 12→9，让更多 tab 一屏放下 */
	padding: 6px 9px; font-size: 12px; border-radius: 8px;
}
.mpw_tab:hover { color: var(--dsw-alias-label-primary); background: color-mix(in srgb, var(--dsw-alias-interactive-bg-hover) 60%, transparent); }
.mpw_tabActive {
	color: var(--dsw-alias-brand-primary, #4f6ef7);
	font-weight: 600;
}
/* ①(修正) tab 键盘聚焦（按字母/数字触发）：浏览器默认黄框太突兀，统一成品牌色细描边。
   只对键盘触发（:focus-visible）生效，鼠标点击不显示。 */
.mpw_tab:focus-visible {
	outline: 2px solid var(--dsw-alias-brand-primary, #7aa2ff);
	outline-offset: 1px;
}
/* ①(修正) 下划线改由激活 tab 自身 ::after 绘制（不再依赖绝对定位的 .mpw_tabIndicator）——
   tab 栏横向滚动时指示条会错位；随 tab 的下划线始终对准，无需 JS 定位。 */
.mpw_tab { position: relative; }
.mpw_tabActive::after {
	content: ""; position: absolute; left: 8px; right: 8px; bottom: 1px;
	height: 2px; border-radius: 2px;
	background: var(--dsw-alias-brand-primary, #4f6ef7);
	pointer-events: none;
}
/* 内容区：外层固定裁剪（overflow hidden），内层 tabRow translateX 滑动（翻页效果）。
   ⑳(修正) transform 必须加在内层——加在外层会连裁剪区一起左移，内容全空（用户实测）。 */
.mpw_tabBody {
	overflow: hidden; min-height: 60px;
}
.mpw_tabRow {
	display: flex;
	align-items: flex-start; /* ①(修正) 列高度=内容高度（flex stretch 会让 offsetHeight 返回最高列高度 → 高度自适应失效） */
	transition: transform .24s cubic-bezier(.4,0,.2,1);
	will-change: transform;
}
.mpw_field { display: flex; flex-direction: column; gap: 6px; padding: 8px 4px; border-top: 1px solid color-mix(in srgb, var(--dsw-alias-border-l2) 45%, transparent); }
.mpw_label { font-size: 13px; line-height: 20px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.mpw_inline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mpw_input {
	flex: 1; min-width: 0; height: 40px; padding: 0 12px; box-sizing: border-box;
	border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px;
	background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-primary);
	font: inherit; font-size: 13px;
}
/* ⑳(新) 自定义下拉（替代原生 select） */
.mpw_selectBtn { display: flex; align-items: center; gap: 6px; cursor: pointer; }
.mpw_selectMenu {
	background: var(--dsw-alias-bg-module-platform, #1c2230);
	border: 1px solid var(--dsw-alias-border-l2, #444b5c);
	border-radius: 10px; padding: 4px; box-shadow: var(--dsw-shadow-lv3, 0 12px 40px rgba(0,0,0,.35));
}
.mpw_selectOpt {
	display: block; width: 100%; box-sizing: border-box; text-align: left;
	padding: 8px 10px; border: 0; border-radius: 8px; background: transparent;
	color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; cursor: pointer;
}
.mpw_selectOpt:hover { background: color-mix(in srgb, var(--dsw-alias-interactive-bg-hover, #333a4a) 60%, transparent); }
.mpw_selectOpt.mpw_on { background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4f8cff) 20%, transparent); }
.mpw_button {
	flex: none; height: 34px; padding: 0 14px; border: 1px solid rgba(255,255,255,0.25); border-radius: 10px;
	background: #3964fe !important; color: #ffffff !important;
	font: inherit; font-size: 13px; cursor: pointer; outline: none;
}
.mpw_button:hover { filter: brightness(1.08); }
.mpw_button:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #7aa2ff); outline-offset: 2px; }
.mpw_fileBtn, .mpw_reset {
	align-self: flex-start; height: 32px; padding: 0 14px; border-radius: 10px;
	border: 1px solid var(--dsw-alias-border-l2); background: transparent;
	color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; cursor: pointer;
}
/* ④(新) 时段按钮：当前生效项高亮（自动/手动锁定） */
.mpw_timeActive {
	border-color: var(--dsw-alias-brand-primary, var(--dsw-alias-brand-600, var(--dsw-alias-interactive-active, #4f8cff))) !important;
	color: var(--dsw-alias-brand-primary, var(--dsw-alias-brand-600, var(--dsw-alias-interactive-active, #4f8cff))) !important;
	background: var(--dsw-alias-interactive-bg-hover);
}
.mpw_fileBtn:hover, .mpw_reset:hover { background: var(--dsw-alias-interactive-bg-hover); }
.mpw_slider { flex: 1; min-width: 0; }
.mpw_numInput {
	flex: none; width: 76px; height: 30px; padding: 0 8px; box-sizing: border-box;
	border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px;
	background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-primary);
	font: inherit; font-size: 12px; text-align: right;
}
/* ④(修正) 输入框聚焦：去掉浏览器默认黄/蓝 outline，灰框→主题深色框（与设置页其他输入框一致） */
.mpw_input:focus, .mpw_numInput:focus {
	outline: none !important;
	border-color: var(--dsw-alias-label-primary) !important;
	box-shadow: 0 0 0 1px var(--dsw-alias-label-primary);
}
.mpw_value {
	flex: none; text-align: right; font-size: 13px; padding-left: 2px;
	color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums;
}
/* ③(新) 滑条旁「默认」小按钮 */
.mpw_miniBtn {
	flex: none; height: 28px; padding: 0 10px; border-radius: 8px;
	border: 1px solid var(--dsw-alias-border-l2); background: transparent;
	color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer;
}
.mpw_miniBtn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
/* ①(修正) 选中态：品牌色描边 + 淡品牌底（顺序/随机等按钮选中要有明确显示） */
.mpw_miniBtn.mpw_on {
	background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4f8cff) 22%, transparent);
	color: var(--dsw-alias-brand-primary, #4f8cff);
	border-color: var(--dsw-alias-brand-primary, #4f8cff);
}
.mpw_hint { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); margin: 0; }
/* ①(新) 标题行：仓库链接（灰色、无下划线、hover 变深）+ 版本号 */
.mpw_titleRow { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.mpw_repoLink {
	font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-secondary);
	text-decoration: none; cursor: pointer; border: none; background: none;
}
.mpw_repoLink:hover { color: var(--dsw-alias-brand-primary, #4f6ef7); }
.mpw_repoLink:visited { color: var(--dsw-alias-label-secondary); }
.mpw_version { font-size: 12px; color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
/* ①(新) 更新徽标：版本号旁红点提示有新版本（自动检测，点击弹更新确认） */
.mpw_updBadge {
	flex: none; font: inherit; font-size: 11px; line-height: 16px; cursor: pointer;
	color: #ffd9a0; background: rgba(224,120,40,0.18); border: 1px solid rgba(224,120,40,0.5);
	border-radius: 10px; padding: 0 8px;
}
.mpw_updBadge:hover { background: rgba(224,120,40,0.3); }
/* ①(新) 取色盘预置色：elysia395 风格圆（加大、白边、阴影、hover 放大） */
.mpw_presetSwatch {
	flex: none; width: 30px; height: 30px; box-sizing: border-box;
	border-radius: 50%; padding: 0;
	border: 2px solid rgba(255, 255, 255, 0.75);
	box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
	cursor: pointer; transition: transform 0.12s ease, box-shadow 0.12s ease;
}
.mpw_presetSwatch:hover { transform: scale(1.12); }
/* ①(新) 壁纸扫描结果预览缩略图 */
.mpw_thumb { flex: none; width: 72px; height: 40px; border-radius: 6px; overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); }
/* ①(2026-09-12 用户要求) 当前壁纸预览图：尺寸对齐"自定义本地壁纸目录"里的预览窗(72×40)等比放大 1.3 倍 → 94×52 */
.mpw_wallThumb { flex: none; width: 94px; height: 52px; border-radius: 8px; overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); display: flex; align-items: center; justify-content: center; }
.mpw_wallThumb .mpw_thumbImg { width: 100%; height: 100%; object-fit: cover; display: block; }
.mpw_thumbImg { width: 100%; height: 100%; object-fit: cover; display: block; }
/* ①(修正) 问题3：扫描列表图片悬停不应被鼠标拖选（用户想选标题文本复制，
   鼠标划过图片却选中了图片本身）→ 图片/缩略图禁选，标题文字保持可选。 */
.mpw_thumbImg, .mpw_thumb video, .mpw_thumb {
	-webkit-user-select: none; user-select: none;
	-webkit-user-drag: none;
	pointer-events: none; /* 图片不拦截鼠标，让事件落到行/标题上 */
}
.mpw_wallProp .mpw_propLabel,
.mpw_wallProp b {
	-webkit-user-select: text; user-select: text;
}
/* 扫描网格整体不禁选文本（标题可复制）；仅缩略图区域禁选 */
.mpw_thumbWrap { -webkit-user-select: none; user-select: none; }
.mpw_thumbWrap b, .mpw_thumbWrap .mpw_propLabel { -webkit-user-select: text; user-select: text; }
/* ①(新) 壁纸列表两列网格（一排两个） */
.mpw_props.mpw_wallGrid { display: grid !important; grid-template-columns: 1fr 1fr; gap: 8px; align-items: start; }
.mpw_wallGrid .mpw_wallProp { min-width: 0; }
/* ④(新) 导入失败/错误提示：红色醒目，不再一闪而过看不清 */
.mpw_hint.mpw_err { color: #ff6b6b; font-weight: 500; }
.mpw_info { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); margin: 0; }
.mpw_props { display: flex; flex-direction: column; gap: 6px; padding: 8px; border-radius: 8px; background: var(--dsw-alias-bg-module-platform); overflow-anchor: none; overscroll-behavior: contain; /* 第13条：① overflow-anchor:none 防 Firefox 滚动锚定把 scrollTop 锚走（用户实测"滑到底再滑自动跳顶"）② overscroll-behavior:contain 让列表到边界后**不再把滚轮串联给宿主设置面板**（否则"画面"跟着面板一起跳） */ }
/* ①(第13条) 选择器：活动行高亮（键盘导航用；只改颜色，不改焦点、不影响布局高度） */
.mpw_prop.mpw_rowActive > button,
.mpw_prop.mpw_rowActive { border-color: var(--dsw-alias-brand-primary, #4f8cff) !important; }
.mpw_prop.mpw_rowActive { background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4f8cff) 12%, transparent); border-radius: 8px; }
/* ①(第13条) 列表容器可聚焦（Tab 进入后用 ↑↓ 导航）：焦点环只在键盘聚焦时出现 */
.mpw_dirList:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #7aa2ff); outline-offset: 2px; }
.mpw_prop { display: flex; flex-direction: column; gap: 4px; padding: 6px 0; }
.mpw_propLabel { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.mpw_propLabel b { color: var(--dsw-alias-label-secondary); font-weight: 500; }
.mpw_check { display: flex; align-items: center; gap: 8px; }
.mpw_check input { accent-color: var(--dsw-alias-brand-primary, #3964fe); }
/* ② 左右滑动式开关 */
.mpw_switch {
	flex: none; width: 40px; height: 22px; padding: 0; border-radius: 11px;
	border: 1px solid color-mix(in srgb, var(--dsw-alias-label-primary) 14%, transparent);
	background: color-mix(in srgb, var(--dsw-alias-label-primary) 16%, transparent);
	position: relative; cursor: pointer; transition: background .15s ease; outline: none;
}
/* ①(修复 2026-09-13 开关动画) 圆点位移改用 transform：left 动画走主线程，重建 CSS 的重活
   一占主线程就会"跳"过去（用户实测：开关没有中间动画）。transform 走合成器，主线程再忙也平滑；
   transition 覆盖 transform+background-color，另加 will-change 提示图层提升。 */
.mpw_switch::after {
	content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
	border-radius: 50%; background: var(--dsw-alias-label-primary);
	box-shadow: 0 1px 2px rgba(0,0,0,0.35);
	transition: transform .18s cubic-bezier(.4,0,.2,1), background-color .18s ease;
	transform: translateX(0); will-change: transform;
}
.mpw_switch { transition: background-color .18s ease, border-color .18s ease; }
.mpw_switch.mpw_on { background: var(--dsw-alias-brand-primary, #3964fe); border-color: transparent; }
.mpw_switch.mpw_on::after { transform: translateX(18px); background: #fff; }
.mpw_switch:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #7aa2ff); outline-offset: 2px; }
/* ①(新) 新式开关（uiverse anand_4957 移植：红关/绿开 + 滑块动画） */
.mpw_switch.mpw_new {
	width: 56px; height: 32px; border-radius: 16px; border: 0; padding: 0;
	background: #a72828; position: relative; cursor: pointer; outline: none;
	box-shadow: inset 0 1px 1px 1px rgba(0,0,0,.5), 0 1px 0 0 rgba(255,255,255,.1);
	transition: background-color .4s cubic-bezier(.65,0,.35,1);
}
.mpw_switch.mpw_new::after {
	content: ""; position: absolute; top: 3px; left: 3px; width: 26px; height: 26px;
	border-radius: 50%; background: #e8e3e3;
	transition: transform .4s cubic-bezier(.68,-.6,.32,1.6);
}
.mpw_switch.mpw_new.mpw_on { background: #1fad3e; }
.mpw_switch.mpw_new.mpw_on::after { transform: translateX(24px); }
/* ①(新) 开关外置 ON/OFF：uiverse 原版 SVG 笔划字母（非文字），随状态变色+描边动画 */
.mpw_switchWrap { display: inline-flex; align-items: center; gap: 8px; }
.mpw_switchLetters,
.mpw_switchLetter { transition: transform .4s cubic-bezier(.68,-.6,.32,1.6); }
.mpw_switchLetters {
	margin-left: 8px; overflow: visible; pointer-events: none;
	width: 24px; height: 24px; flex: none;
}
.mpw_switchLetter:last-child { transform: translateX(14px); }
.mpw_switchLetter-stroke {
	stroke: #a72828;
	transition: stroke .4s cubic-bezier(.65,0,.35,1), stroke-dashoffset .4s cubic-bezier(.68,-.6,.32,1.6), transform .4s cubic-bezier(.68,-.6,.32,1.6);
}
.mpw_switchLetter-stroke:nth-child(2) { transform-origin: 2px 2px; }
.mpw_switchWrap.mpw_on .mpw_switchLetter-stroke { stroke: #1fad3e; }
.mpw_switchWrap.mpw_on .mpw_switchLetter-stroke:nth-child(2) { stroke-dashoffset: 6; }
.mpw_switchWrap.mpw_on .mpw_switchLetter-stroke:last-child { stroke-dashoffset: 4; }
.mpw_switchWrap.mpw_on .mpw_switchLetter:first-child .mpw_switchLetter-stroke:nth-child(2) {
	stroke-dashoffset: 0; transform: rotate(56.5deg);
}
.mpw_switchWrap.mpw_on .mpw_switchLetter:last-child { stroke-dashoffset: 0; transform: translateX(8px); }
/* ①(新) 倍速 radio（uiverse gleydson_9898 液态滑块移植，6 档） */
.mpw_liquidGroup {
	position: relative; display: grid; grid-auto-flow: column; overflow: hidden;
	background: color-mix(in srgb, var(--dsw-alias-bg-module-platform, #1c2230) 88%, #000);
	padding: 6px; border-radius: 16px; border: 1px solid color-mix(in srgb, var(--dsw-alias-border-l2, #444b5c) 70%, #000);
	margin-top: 4px;
}
.mpw_liquidGroup .mpw_liquidOpt {
	position: relative; z-index: 2; padding: 10px 0; font-size: 13px; border: 0;
	color: var(--dsw-alias-label-tertiary); background: transparent; cursor: pointer;
	transition: color .35s ease;
	/* ①(修正) 文字严格居中（选中滑块正中间） */
	display: flex; align-items: center; justify-content: center; text-align: center;
	line-height: 1;
}
.mpw_liquidGroup .mpw_liquidOpt:active { transform: scale(.97); }
.mpw_liquidGroup .mpw_liquidOpt.mpw_on { color: #fff; font-weight: 700; }
.mpw_liquidSlider {
	position: absolute; inset: 6px; width: calc((100% - 12px) / 6); border-radius: 12px;
	background: #333b4d; z-index: 1;
	transition: transform .55s cubic-bezier(.22,.9,.25,1);
}
.mpw_liquidSlider::after {
	content: ""; position: absolute; inset: 0; border-radius: inherit;
	box-shadow: inset 0 1px 1px rgba(255,255,255,.08), inset 0 -1px 2px rgba(0,0,0,.6);
}
/* ⑥ 纯展示性条目 */
.mpw_static { padding: 2px 0; }
.mpw_important { border-left: 2px solid var(--dsw-alias-brand-primary, #3964fe); padding-left: 8px; }
.mpw_static .mpw_propLabel { color: var(--dsw-alias-label-secondary); }
/* ④ 展开/收起 */
.mpw_moreBtn { align-self: flex-start; }
.mpw_propInput {
	height: 30px; padding: 0 8px; box-sizing: border-box; max-width: 260px;
	border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px;
	background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-primary);
	font: inherit; font-size: 12px;
}
.mpw_propSlider { flex: 1; min-width: 120px; max-width: 260px; }
.mpw_tag { font-size: 11px; line-height: 16px; padding: 1px 6px; border-radius: 6px; background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.15)); color: var(--dsw-alias-label-tertiary); }
/* ⑥ 设置导航图标：隐藏默认齿轮，显示自定义图标 */
.VOzbGW_navList button:has(.mpw_navIconImg) .VOzbGW_navIcon { display: none !important; }
.mpw_navIconImg {
	width: 16px; height: 16px; flex: none; vertical-align: -3px; margin-right: 8px;
	border-radius: 4px; object-fit: cover;
	background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15);
}
/* ①(2026-09-13) 用户指定的图标是**线性 SVG**（stroke=currentColor）：旧的"浅底+描边"是为
   位图图标准备的，套在线性图上会变成一个框 → 只在 svg 形态下去掉底/边（?navicon=old 的 img 保留原样式）。 */
svg.mpw_navIconImg { background: none; border: 0; border-radius: 0; color: inherit; }

/* ①(2026-09-13) 「标题栏磨砂」自动半透明底：只有半透明顶栏才看得见磨砂（属性由 JS 按设置挂上）。
   ①(2026-09-16) 底色改用**我们自己的命名空间 token** --mpw-hdr-frost-bg（JS 按亮/暗写入），
   不再直接引用宿主静态色 token —— 满足"只覆盖 --mpw-* 命名空间"的纪律（见 docs/HEADER-FROST.md）。
   关闭插件或 ?hdrfrost=off 时属性会被移除 → 规则自动失效。
   ②(2026-09-16 回归修复) 这里原本还有一条 border-bottom: 1px solid transparent !important;
   —— 它就是用户反馈「顶栏下面一部分的描边被你去掉了」的**唯一元凶**：带 !important 的
   border-bottom 简写把宿主自己的下描边（浅色 1px solid rgba(19,45,83,.26) / 深色
   rgba(148,180,220,.32)，以及悬浮态圆角外框的下边）整个改成透明，且特异性/权重
   压过宿主与我方其它规则。**已删除**：本规则从此只碰 background-color，
   描边一律交还宿主（下方 hover/悬浮块里的 border-bottom-color 兜底保持不变）。 */
html body .wSkVaW_header[data-mpw-hdr-translucent],
html body header[class*="_header_"][data-mpw-hdr-translucent] {
	background-color: var(--mpw-hdr-frost-bg, rgba(255, 255, 255, 0.38)) !important;
}
html body[data-ds-dark-theme] .wSkVaW_header[data-mpw-hdr-translucent],
html body[data-ds-dark-theme] header[class*="_header_"][data-mpw-hdr-translucent] {
	background-color: var(--mpw-hdr-frost-bg, rgba(18, 22, 30, 0.45)) !important;
}
/* ②(2026-09-16 视觉回归修复) 标题栏磨砂"元素层"（.mpw-hdrFrost，由 JS 注入）的**层叠与托底**规则。
   为什么必须有这三条（真根因链）：
     · 顶栏 position:relative 但**不是层叠上下文** ⇒ 之前 z-index:-1 的注入层被顶栏自己的
       background-color 整片盖住，backdrop-filter 一点都透不出来（用户反复反馈"没有磨砂"）。
     · JS 现在写 z-index:0（见 ensureHeaderFrost）：画在顶栏背景之上、内容之下。
     · 第二条把宿主 header 的**直接子节点**抬到 z-index:1（它们原本都是 static/auto，
       抬升只改绘制序、不改布局），保证磨砂层绝不盖住标题文字/logo/按钮；:not(.mpw-hdrFrost)
       保证不会把磨砂层自己抬上去。
     · 层背景一律 transparent：半透明底色仍由宿主 header 承担（上面的 --mpw-hdr-frost-bg 规则），
       避免"底色叠两次"变成两层白纱。
   注意：这三条**无条件输出**（不受 headerBg/磨砂开关分支影响）—— 否则"另一档配置下规则消失"
   会让层叠修复静默失效（本仓库历史上正是"规则落在分支里"吃过亏）。 */
.mpw-hdrFrost { z-index: 0 !important; background: transparent !important; }
/* 两条并列：:has(> .mpw-hdrFrost) 覆盖"磨砂层不在首位"的情况（宿主结构变化时也成立），
   :first-child ~ * 是无 :has 环境的兜底（两者都只影响 header 内部绘制序）。 */
.wSkVaW_header:has(> .mpw-hdrFrost) > :not(.mpw-hdrFrost) { position: relative; z-index: 1; }
.mpw-hdrFrost:first-child ~ * { position: relative; z-index: 1; }
.wSkVaW_header > .mpw-hdrFrost { z-index: 0 !important; }
/* ①(2026-09-16 bug①) 右侧「轮次导航条」（DSH 0.1.5 的 TurnNavigator rail / .eGxaPq_*）对比兜底。
   判据：宿主 .eGxaPq_mark::before 用 --dsw-alias-border-l4（#00000029 / #fff3 = 16%/20% alpha），
   假定条背后是**不透明表面**；壁纸模式把表面透明化后，条与壁纸混色 ⇒ 用户观感"条变透明"。
   这里**只作用于明确白名单的宿主 rail 节点**，值全部走我们自己的 --mpw-rail-* 命名空间，
   **不重定义任何宿主 token、不用 !important**（html body[attr] 前缀提供稳定特异性）。
   开关：body[data-mpw-rail-ink]（由 refreshRailInk() 维护；?railink=off 可一键回退）。

   ③(2026-09-16 第四次反馈"条还是看不见" → 定案与加强) **真机取证结论：不是我们的覆盖把条删掉了**：
     · tools/header-rail-collect.mjs 在真机页面上实测 .eGxaPq_mark::before 的
       background = rgba(0,0,0,0.42)（我们的 --mpw-rail-ink 生效）、alpha=0.42、w=12px h=2px、
       opacity=1、display=block、无裁切祖先；body[data-mpw-rail-ink] 存在。
     · 宿主 token 在 body 上解析正常：--dsw-alias-border-l4 = #00000029（16% alpha）。
     · 即：条的**几何与颜色都在**，看不见的是**对比度**——2px 高、16%~42% alpha 的细条压在
       壁纸上时，与壁纸同色系就彻底糊掉（宿主原本假定背后是不透明表面）。
   加强（只加"可见性"，不抢宿主的形制）：给条加一圈**反色描边晕** box-shadow 0 0 0 1px，
   并用自己命名空间的 --mpw-rail-halo 按亮/暗取反色 ⇒ 无论壁纸深浅，条都有一圈对比边。
   几何（宽/高/圆角/transform）一律不动，仍由宿主决定。 */
html body[data-mpw-rail-ink] .eGxaPq_mark::before {
	background: var(--mpw-rail-ink, rgba(0, 0, 0, 0.42));
	box-shadow: 0 0 0 1px var(--mpw-rail-halo, rgba(255, 255, 255, 0.55));
}
html body[data-mpw-rail-ink] .eGxaPq_markUnloaded::before { opacity: 0.55; }
html body[data-mpw-rail-ink] .eGxaPq_markPreview::before {
	background: var(--mpw-rail-ink, rgba(0, 0, 0, 0.42));
	box-shadow: 0 0 0 1px var(--mpw-rail-halo, rgba(255, 255, 255, 0.55));
	width: 18px;
}
html body[data-mpw-rail-ink] .eGxaPq_markActive::before {
	background: var(--mpw-rail-ink-strong, rgba(0, 0, 0, 0.86));
	box-shadow: 0 0 0 1px var(--mpw-rail-halo, rgba(255, 255, 255, 0.55));
	width: 20px;
}
${roundCompat ? `/* ②(新) 第三方插件 UI 圆角兼容：给有背景的"矩形容器"统一补圆角。
   用 :where 零优先级 → 插件/DSH 自己的圆角样式永远优先，只补"完全没有圆角"的元素。
   命中常见容器类名子串（wrap/panel/box/section/container），不限某个插件。 */
:where([class*="wrap"], [class*="panel"], [class*="box"], [class*="section"], [class*="container"]) {
	border-radius: 10px;
}` : ""}
			/* 4(修正) 悬浮效果移到 buildUiCss：背景清除（无图）时也能用（原来只在 hasImage 分支 → 清背景后悬浮失效） */
			${floatOn ? `/* ①(修正) 悬浮效果（默认关）：侧边栏/标题栏悬浮卡片。
   注意：绝不给 sidebarCol/header 加 backdrop-filter（会困住 fixed 设置弹窗/子代理面板）。
   参考 DSH-Transparent-UI-Plugin：四周 margin + 全圆角 = 悬浮卡片；sidebar root 解除宽度。
   ②(修正) 标题栏下边保留描边（跟随圆角）：headerBg 规则的 border-bottom transparent
   用 !important 会取消下边线 → 这里用 !important 覆盖回来，圆角描边完整。 */
body[data-mpw-float] .wSkVaW_header {
	margin: 10px 16px 0;
	padding: 8px 16px 8px;
	border: 1px solid rgba(19,45,83,0.26);
	border-bottom-color: rgba(19,45,83,0.26) !important;
	border-radius: 20px;
}
body[data-mpw-float] body[data-ds-dark-theme] .wSkVaW_header,
body[data-ds-dark-theme] body[data-mpw-float] .wSkVaW_header {
	border-color: rgba(148,180,220,0.32);
	border-bottom-color: rgba(148,180,220,0.32) !important;
}
/* ②(修正) 悬浮时隐藏 header 底部的 1px 分隔线（::after 直线会横穿圆角下方，与圆角有空隙） */
body[data-mpw-float] .wSkVaW_header:after { display: none !important; }
body[data-mpw-float] .pI_x6G_sidebarCol {
	margin: 12px;
	padding: 10px 12px 14px;
	border: 1px solid rgba(19,45,83,0.26);
	border-radius: 20px;
	overflow: hidden;
	/* ④(修正) 收起/展开动画平滑：margin/padding/圆角过渡（与收起态规则配合） */
	transition: margin 0.18s ease, padding 0.18s ease, border-radius 0.18s ease, border-color 0.18s ease;
}
body[data-mpw-float] body[data-ds-dark-theme] .pI_x6G_sidebarCol,
body[data-ds-dark-theme] body[data-mpw-float] .pI_x6G_sidebarCol {
	border-color: rgba(148,180,220,0.32);
}
body[data-mpw-float] [data-mpw-sidebar-root] {
	width: 100% !important;
	background: transparent !important;
	border-radius: 20px;
}
/* ①(修正) 侧边栏收起态也有悬浮效果：保留圆角卡片 + 边框 + 半透明。
   ②(修正) 收起 rail 内容（logo/切换/会话图标 36px）按 DSH 原 rail 宽布局：
   绝不能加左右 padding 或 overflow:hidden 把它压进更窄的卡片 —— 内容会被裁掉
   （用户实测：收起态上方 UI 被切，只剩底部设置）。悬浮只做外壳：
   margin + 圆角 + 边框，padding 归零、overflow 可见。
   ③(修正) 收起/展开动画流畅度（用户实测：收起态贴屏幕边缘、动画卡顿）：
   左/上/下 margin 与展开态一致（12px）→ 收起时左缘不跳变、不贴边；
   右 margin 用 -12px 补回宽度（宽 = 父宽，内容完整），右缘与 rail 区对齐；
   transition 平滑 padding/border-radius/margin 过渡。 */
body[data-mpw-float] [data-sidebar-collapsed] .pI_x6G_sidebarCol,
body[data-mpw-float] [data-sidebar-collapsed] [class*="sidebarCol"] {
	/* ①(修正) 恢复 rail 卡片内容完整（margin: 12px -12px 12px 12px = 右 -12px 让
	   rail 卡片宽 = rail 轨道，图标行完整）。之前反复改 margin/padding 都裁了内容
	   （用户实测：改 0 或 padding 都更不全）。rail 右缘 -12px 会轻微侵入中心列，但与
	   better-sidebar 底部面板的重叠用 z-index 让 rail 浮在面板上方（悬浮卡片视觉，
	   rail 在上、面板在下，功能不受影响）。 */
	margin: 12px -12px 12px 12px;
	padding: 0;
	border-radius: 12px;
	border: 1px solid rgba(19,45,83,0.26);
	overflow: visible;
	position: relative;
	z-index: 50; /* 高于 better-sidebar 底部面板(z-index:40)：rail 悬浮卡片浮在上 */
	/* ②(修正) 不设 position/z-index 会困住弹窗——这里设 z-index 用于 rail 浮上，
	   但设置面板 overlay(z-index:1000) 在 body 级，不受 rail z-index 影响 */
	transition: margin 0.18s ease, padding 0.18s ease, border-radius 0.18s ease, border-color 0.18s ease;
}
body[data-mpw-float] body[data-ds-dark-theme] [data-sidebar-collapsed] .pI_x6G_sidebarCol,
body[data-mpw-float] body[data-ds-dark-theme] [data-sidebar-collapsed] [class*="sidebarCol"] {
	border-color: rgba(148,180,220,0.32);
}
/* ①(修正 2026-09-13) 这里原本多出一个右花括号（不配平）——CSS 解析器遇到多余 } 会丢弃后续规则，
   叠加 buildCss 抛错时会导致整张样式表失效（用户实测"整个画面错乱"）。已删除。
   回归：tools/panel-smoke.mjs 的 CSS 结构校验会拦住此类问题。 */
/* ②(修正) 设置面板打开时（data-mpw-float-off，见 setupSblurObserver）：悬浮外壳
   完全让位——sidebarCol 回到 DSH 默认布局（无 margin/padding/圆角/overflow），
   设置面板 full-viewport fixed overlay 正常全屏，输入框/todo 不再浮到设置面上。
   悬浮只影响外观，设置面板打开期间不叠加任何布局干扰。 */
body[data-mpw-float-off] body[data-mpw-float] .pI_x6G_sidebarCol,
body[data-mpw-float-off] body[data-mpw-float] [class*="sidebarCol"] {
	margin: 0; padding: 0; border: none; border-radius: 0; overflow: visible;
}
body[data-mpw-float-off] body[data-mpw-float] .wSkVaW_header {
	margin: 0; padding: 0; border: none; border-radius: 0;
}
body[data-mpw-float-off] body[data-mpw-float] [data-mpw-sidebar-root] {
	width: auto !important; background: transparent !important; border-radius: 0;
}` : ""}
${(section && (section.bsCompat !== void 0 ? !!section.bsCompat : false)) ? `
/* ── dsh-better-sidebar 适配（总开关 bsCompat 开启后按子开关生效） ──
   作用域恒为 [data-dsh-better-sidebar] 子树（better-sidebar 的 host 挂在 body，
   类名是 CSS Modules 哈希，故用 [class*="_xxx"] 子串匹配，稳定锚点只有
   data-dsh-better-sidebar）。
   ①(2026-09-17 0.19.1 适配核查，证据见 docs/BETTER-SIDEBAR-COMPAT.md)：
   · 作用域锚点仍在：0.19.1 把 data-dsh-better-sidebar 设在 body 下那个挂载 host div 上
     （其 src/client/index.tsx:308 / 产物 lib/client.js 里 setAttribute("data-dsh-better-sidebar","")），
     底部工作台、面板宿主层都在它子树内 ⇒ 本文件所有后代选择器继续命中（真机探针 bsRoot=1）。
   · 面板根另有**稳定属性** data-dsh-panel + data-dsh-bottom-panel（0.19 新增），
     而类名哈希 0.16→0.19 已经换过（前缀从旧哈希变成 nArs4W_）⇒ 面板级规则同时挂属性选择器，
     类名再换也不会失配。tabBar/editorHeader/browserBar/terminalWrap **没有**稳定属性
     （只有哈希类名），只能继续用子串匹配——这是该版本下唯一可行的锚点。 */
${(section.bsFloat !== void 0 ? !!section.bsFloat : false) ? `
/* 1) 悬浮适配：底部工作台面板 = 圆角 + 内层透明 + **零外边距**。
   历史根因：bsFloat 只给面板加圆角，而内部 .pane（bg-base）/.tabBar（bg-layer-1）/
   .terminalWrap（bg-base）都是**不透明直角背景**且铺满面板 → "圆角外壳里套直角矩形、
   两层透明度不同"（用户实测"四条边有的被切掉、有的重复出现"）。
   ①(2026-09-17 用户第 2 项「不要再犯之前的 bug」) 本轮按 0.19.1 真机实测（无头 Firefox +
   真页面，证据 tools/probe-out/bs-bottom-{before,after}.json，判据与数字见
   docs/BETTER-SIDEBAR-COMPAT.md §6）重写三条几何纪律：
   · **绝不加外边距**：0.19.1 底部面板是绝对定位 + inline left=<中心列 left>; right:0，
     并由它自己的 ResizeObserver 实时对齐 DSH 中心列。实测 margin: 0 8px 8px 会把
     left 推开 8px（panel.x=288 vs 中心列 280）、并让**折叠态**上移 8px ⇒ 视口底部露出
     3.6px 残影（改前 hidden y=806.42 < 视口高 810；改后 814.42 完全移出）。故 margin:0。
   · **裁切只在外壳这一层**（overflow:hidden）：内层直角（终端 / xterm 自带不透明底、
     真机实测 xterm-viewport 占 71% 面积；tabBar 的激活胶囊 10% 黑直角）全部由外壳的
     14px 圆角裁掉 —— 这是"圆角外壳里不出现直角矩形"的唯一可靠做法。
   · **把 resize strip 挪进面板内**（宿主原本 top:-4px = 一半在面板外）：外壳一旦裁切，
     那一半就被切掉（"边被切掉"），而且拖动时 strip 的 .bottomResizeActive 会画一条
     通栏强调色条 —— 未裁切时它会在圆角之外露出两个**直角凸块**。改成 top:0 后 8px 全高
     都在面板内（完全可拖、可点），圆角由外壳裁切，两侧都不再有直角/残边。
   · **一条 border 都不画**：面板上沿那 1px 是宿主的（rgba(0,0,0,.1)），tabBar 下沿那 1px
     也是宿主的（--dsw-alias-border-l1）——我们再画一条就是"重复边框/双层边"。本块只改
     半径 / 裁切 / 位置 / 背景。 */
[data-dsh-better-sidebar] [class*="_bottomPanel"],
[data-dsh-better-sidebar] [data-dsh-bottom-panel] {
	border-radius: 14px;
	overflow: hidden;
	margin: 0;
}
/* resize strip：从"骑在上沿（top:-4px）"改为完全落在面板内（top:0）。
   宿主 .nArs4W_bottomResize{position:absolute;top:-4px;height:8px;left:0;right:0}；
   本规则特异性更高（两个属性选择器 > 一个类），无需 !important。 */
[data-dsh-better-sidebar] [data-dsh-bottom-panel] > [class*="bottomResize"] {
	top: 0;
}
/* 旧版右栏（0.16/0.18 的 _panel）才需要"圆角+裁切+外边距"；
   注意 [class*="_panel"] 的**子串会命中 0.19 的 nArs4W_panelBody** —— 实测它因此被塞进
   6px/8px/8px/0 的不对称内边距（就是"有的边被切掉、有的边重复"的来源之一），必须排除。 */
[data-dsh-better-sidebar] [class*="_panel"]:not([class*="_panelBody"]):not([data-dsh-bottom-panel]) {
	border-radius: 14px;
	overflow: hidden;
	margin: 6px 8px 8px 0;
}
/* 内层直角背景改透明，让面板外壳圆角+背景统一透出（消除双层冲突）；
   bsReveal/bsAlpha/bsAqua 单独控制时此规则让位（下面各块后写优先）。 */
[data-dsh-better-sidebar] [class*="_panel"]:not([class*="_panelBody"]):not([data-dsh-bottom-panel]),
[data-dsh-better-sidebar] [class*="_pane"]:not([class*="_panel"]),
[data-dsh-better-sidebar] [data-dsh-pane],
[data-dsh-better-sidebar] [class*="_tabBar"] {
	background-color: transparent !important;
}
/* ①(修正) 终端壳也透明：.terminalWrap / .terminal / .xterm 自带 --dsw-alias-bg-base
   （不透明），在已被透明的 .pane 内又铺一层与圆角壳(bg-layer-1)不同的 token → 双层、
   两层透明度（用户实测"圆角里套直角、两层透明度不同"的根源，子代理定位）。置透明后
   让圆角壳单层显示。xterm 内部文字/光标类用 foreground 色，不受背景影响。 */
[data-dsh-better-sidebar] [class*="_terminalWrap"],
[data-dsh-better-sidebar] [class*="_terminal"] {
	background-color: transparent !important;
}
[data-dsh-better-sidebar] [class*="_xterm"] {
	background-color: transparent !important;
}
` : ""}
${(section.bsReveal !== void 0 ? !!section.bsReveal : false) ? `
/* 2) 透出壁纸：面板背景半透明（跟随壁纸；不用 backdrop-filter 防困内容）。
   ①(修正) 透出程度可调：bsRevealAlpha（%越高越透明透壁纸，越低越实） */
[data-dsh-better-sidebar] [class*="_panel"]:not([class*="_panelBody"]):not([data-dsh-bottom-panel]),
[data-dsh-better-sidebar] [class*="_bottomPanel"],
[data-dsh-better-sidebar] [data-dsh-bottom-panel] {
	background-color: color-mix(in srgb, var(--dsw-alias-bg-base) ${section.bsRevealAlpha !== void 0 ? Math.max(10, Math.min(95, Number(section.bsRevealAlpha))) : 62}%, transparent) !important;
}
` : ""}
${(section.bsAlpha !== void 0 ? !!section.bsAlpha : false) ? `
/* 3) 透明度细粒度：面板根较实、内层 chrome（tab/编辑区/终端）较透、
   添加栏（+ 按钮区）单独处理——better-sidebar 的这些区域透明度本就不一致 */
[data-dsh-better-sidebar] [class*="_panel"]:not([class*="_panelBody"]):not([data-dsh-bottom-panel]),
[data-dsh-better-sidebar] [class*="_bottomPanel"],
[data-dsh-better-sidebar] [data-dsh-bottom-panel] {
	background-color: color-mix(in srgb, var(--dsw-alias-bg-base) 68%, transparent) !important;
}
[data-dsh-better-sidebar] [class*="_pane"]:not([class*="_panel"]),
[data-dsh-better-sidebar] [data-dsh-pane],
[data-dsh-better-sidebar] [class*="_tabBar"],
[data-dsh-better-sidebar] [class*="_editorHeader"],
[data-dsh-better-sidebar] [class*="_terminalWrap"],
[data-dsh-better-sidebar] [class*="_browserBar"] {
	background-color: color-mix(in srgb, var(--dsw-alias-bg-base) 52%, transparent) !important;
}
[data-dsh-better-sidebar] [class*="_addBar"],
[data-dsh-better-sidebar] [class*="_addButton"] {
	background-color: color-mix(in srgb, var(--dsw-alias-bg-base) 40%, transparent) !important;
}
/* ①(新) 版本自适应：dsh-better-sidebar 0.16+ 新增「浮窗」(data-dsh-float-window, 类 _floatWindow)。
   host /ping 检测到版本后 body 上有 data-mpw-bs-version 属性，这里按版本前缀门控——
   仅 0.16+ 生效；旧版本(0.13/无版本属性)匹配不到，规则自动不生效（向后兼容）。
   浮窗透出壁纸：跟随 bsAlpha/bsReveal 的透出风格（半透明背景），与面板一致。 */
[data-mpw-bs-version^="0.16"] [data-dsh-better-sidebar] [data-dsh-float-window],
[data-mpw-bs-version^="0.16"] [data-dsh-better-sidebar] [data-dsh-float-window] [class*="_panel"] {
	background-color: color-mix(in srgb, var(--dsw-alias-bg-base) 52%, transparent) !important;
	backdrop-filter: none !important; /* 浮窗若自带 blur 会遮挡壁纸透出，去掉 */
}
body[data-ds-dark-theme] [data-mpw-bs-version^="0.16"] [data-dsh-better-sidebar] [data-dsh-float-window] {
	background-color: color-mix(in srgb, var(--dsw-static-neutral-bluish-950) 40%, transparent) !important;
}
body[data-ds-dark-theme] [data-dsh-better-sidebar] [class*="_panel"]:not([class*="_panelBody"]):not([data-dsh-bottom-panel]),
body[data-ds-dark-theme] [data-dsh-better-sidebar] [class*="_bottomPanel"],
body[data-ds-dark-theme] [data-dsh-better-sidebar] [data-dsh-bottom-panel] {
	background-color: color-mix(in srgb, var(--dsw-static-neutral-bluish-950) 40%, transparent) !important;
}
body[data-ds-dark-theme] [data-dsh-better-sidebar] [class*="_pane"]:not([class*="_panel"]),
body[data-ds-dark-theme] [data-dsh-better-sidebar] [data-dsh-pane],
body[data-ds-dark-theme] [data-dsh-better-sidebar] [class*="_tabBar"],
body[data-ds-dark-theme] [data-dsh-better-sidebar] [class*="_editorHeader"],
body[data-ds-dark-theme] [data-dsh-better-sidebar] [class*="_browserBar"],
body[data-ds-dark-theme] [data-dsh-better-sidebar] [class*="_terminalWrap"] {
	background-color: color-mix(in srgb, var(--dsw-static-neutral-bluish-950) 28%, transparent) !important;
}
body[data-ds-dark-theme] [data-dsh-better-sidebar] [class*="_addBar"],
body[data-ds-dark-theme] [data-dsh-better-sidebar] [class*="_addButton"] {
	background-color: color-mix(in srgb, var(--dsw-static-neutral-bluish-950) 22%, transparent) !important;
}
` : ""}
${(section.bsFont !== void 0 ? !!section.bsFont : false) ? `
/* 4) 字体颜色增强：跟随灰字自定义色（若有）与深底可读 */
[data-dsh-better-sidebar] { color: var(--dsw-alias-label-primary); }
[data-dsh-better-sidebar] [class*="_label"],
[data-dsh-better-sidebar] [class*="_title"] {
	color: var(--dsw-alias-label-primary);
}
[data-dsh-better-sidebar] [class*="_hint"],
[data-dsh-better-sidebar] [class*="_meta"] {
	color: var(--dsw-alias-label-secondary);
}
` : ""}
/* 5) 底部面板避让已删除：调研确认 better-sidebar 底部面板用 left=centerRect.left 只
   覆盖 DSH 中心列（不盖左侧边栏），无需左侧边栏避让。原规则给 [class*="sidebarCol"]
   加 margin-bottom: var(--dsh-sidebar-height) 反而把左侧边栏底部挤压、下方留白（用户
   实测第 2 项：无壁纸时下侧边栏展开，等高的左侧边栏设置按钮向上压缩）。移除后左侧
   边栏高度恢复正常。悬浮的 margin 保留原有外观，不做底部避让叠加。 */
` : ""}
${(section.bsAqua !== void 0 ? !!section.bsAqua : false) ? `
/* 6) 跟随 Aqua 实验（与「其他」总开关形成双开关：本开关 + aqua 对应开关都开才生效）：
   aqua 的取色/统一雾/自适应文字通过全局 token override 生效，better-sidebar 面板
   默认用 --dsw-alias-bg-layer-1（不受 aqua 影响）——这里改用被 aqua override 的
   token（bg-base/sidebar-fill），让 aqua 效果透进面板。此时 bsReveal/bsAlpha 的
   color-mix 覆盖规则同样输出，但都在 !important 同优先级下按出现顺序——本块在后，
   保证 bsAqua 优先。 */
[data-dsh-better-sidebar] [class*="_panel"]:not([class*="_panelBody"]):not([data-dsh-bottom-panel]),
[data-dsh-better-sidebar] [class*="_bottomPanel"],
[data-dsh-better-sidebar] [data-dsh-bottom-panel] {
	background-color: var(--dsw-alias-bg-base) !important;
}
[data-dsh-better-sidebar] [class*="_pane"]:not([class*="_panel"]),
[data-dsh-better-sidebar] [data-dsh-pane],
[data-dsh-better-sidebar] [class*="_tabBar"],
[data-dsh-better-sidebar] [class*="_editorHeader"],
[data-dsh-better-sidebar] [class*="_terminalWrap"],
[data-dsh-better-sidebar] [class*="_browserBar"] {
	background-color: var(--dsw-alias-bg-base) !important;
}
` : ""}
${(section.bsBottomAvoid !== void 0 ? !!section.bsBottomAvoid : false) ? `
/* 7) 底部面板避让 DSH 左 rail（bsBottomAvoid 独立开关）：better-sidebar 底部面板
   left 已由它自己的 ResizeObserver **实时**对齐到 DSH 中心列（输入框正确对齐）——
   **不要再用 margin-left 二次偏移**（用户实测：加了 margin 后侧边栏展开时面板被
   推到输入框右边、无法对齐）。本块仅作门控说明，不输出偏移。 */
` : ""}
/* ③(修正) 弹窗打开时：背后的设置面板只去掉 backdrop-filter（不再让字晕染），
   背景保持原来的半透明（透出壁纸）——绝不整体改成深色（会导致设置界面变黑）。
   不透明兜底与磨砂覆盖已全部移到 buildCss（A 块：dialogBlur/settingsBlur/confirmBlur
   各自开关关时兜底不透明；B/C/D 块：开关开时磨砂覆盖），这里不再重复以免覆盖磨砂。 */
body[data-mpw-modal] [role="dialog"] {
	backdrop-filter: none !important;
	-webkit-backdrop-filter: none !important;
}
/* ④ 冲突确认弹窗（背景不透明兜底在 buildCss A 块；此处为结构样式） */
.mpw_mask {
	position: fixed; inset: 0; z-index: 3000;
	background: rgba(0,0,0,0.45); display: flex; align-items: center; justify-content: center;
}
.mpw_dialog {
	width: min(420px, calc(100vw - 48px)); box-sizing: border-box;
	border: 1px solid var(--dsw-alias-border-l2);
	border-radius: 16px; padding: 20px; box-shadow: var(--dsw-shadow-lv3, 0 12px 40px rgba(0,0,0,.35));
	display: flex; flex-direction: column; gap: 12px;
}
`;
		}

		// ═══════════════════════════════════════════════════════════════════
		//  冲突检测（④：同时装了其他壁纸/主题插件时自动关闭本功能）
		// ═══════════════════════════════════════════════════════════════════
		const CONFLICT_IDS = [
			"@local/dsh-bg-image", "dsh-bg-image", "dsh-skin", "dsh-dream-skin",
			"dsh-wallpaper-rotator", "dsh_web_client_theme_switcher",
			"@local/dsh-ui-preset-enhance", "ui-theme-switcher", "theme-switcher",
			"@deepseek-ai/dsh-client-ui-aqua", "dsh-client-ui-aqua", "ui-aqua"
		];
		// P1④(新) 皮肤类插件的 body 属性签名（各 skin.json 的 bodyAttr）：
		// 皮肤启用后在 <body> 打 data-* 属性，比扫 [data-plugin] 更直接
		const CONFLICT_BODY_ATTRS = [
			"data-dsh-aurora", "data-dsh-whale-song", "data-dsh-skin",
			"data-dsh-ui-skin", "data-dsh-theme", "data-skin"
		];
		function detectConflicts() {
			const found = [];
			try {
				const els = document.querySelectorAll ? document.querySelectorAll("[data-plugin]") : [];
				els.forEach((el) => {
					const id = (el.getAttribute && el.getAttribute("data-plugin")) || "";
					if (id && CONFLICT_IDS.some((c) => id.indexOf(c) >= 0 || c.indexOf(id) >= 0)) {
						if (found.indexOf(id) < 0) found.push(id);
					}
				});
			} catch {}
			// ⑪(新) 运行时检测：其他插件往 body/html 设了背景图，或存在其他全屏背景层
			try {
				const bodyBg = document.body ? getComputedStyle(document.body).backgroundImage : "none";
				if (bodyBg && bodyBg !== "none") found.push("body-background");
				const htmlBg = getComputedStyle(document.documentElement).backgroundImage;
				if (htmlBg && htmlBg !== "none") found.push("html-background");
			} catch {}
			// P1④(新) 皮肤类插件的 body 属性签名检测（data-dsh-aurora 等）
			try {
				if (document.body) {
					CONFLICT_BODY_ATTRS.forEach((attr) => {
						if (document.body.hasAttribute(attr)) found.push(attr);
					});
				}
			} catch {}
			try {
				document.querySelectorAll("body > *").forEach((el) => {
					// ①(修正) 排除自己的元素：壁纸层（bgWrap）、Aqua 全屏遮罩（aqua-mask）、时钟。
					// 曾把自己的 mask 误报为冲突（fullscreen-bg:DIV → 自动关闭壁纸功能，用户实测）。
					const ownId = el && el.id;
					if (ownId === BG_WRAP_ID || ownId === "mpw-aqua-mask" || ownId === "mpw-clock") return;
					if (el.classList && el.classList.contains("mpw-bgWrap")) return; // 自己的壁纸层（class 兜底）
					const cs = getComputedStyle(el);
					const z = Number(cs.zIndex);
					if (cs.position === "fixed" && isFinite(z) && z < 0) {
						found.push("fullscreen-bg:" + ((el.className && String(el.className)) || el.tagName));
					}
				});
			} catch {}
			return Array.from(new Set(found));
		}

		// ═══════════════════════════════════════════════════════════════════
		//  视频纹理（tex 内嵌 MP4）：提取 + 时间槽识别
		// ═══════════════════════════════════════════════════════════════════
		/** 检查 tex 前 4KB 是否有 MP4 魔数（ftyp）。 */
		function texHasVideo(bytes) {
			const n = Math.min(65536, bytes.length - 4);
			for (let i = 0; i < n; i++) {
				if (bytes[i] === 0x66 && bytes[i+1] === 0x74 && bytes[i+2] === 0x79 && bytes[i+3] === 0x70) return true;
			}
			return false;
		}
		/** 从 tex 前部找内嵌 MP4 的偏移（ftyp-4）；找不到返回 null。
		 *  ①(修正) 扫描整个传入缓冲（上限 1MB，与 handleVideoTexes 的头窗一致）——
		 *  原来固定扫 64KB，换 1MB 头窗后仍只扫前 64KB 会漏掉深处的 ftyp。 */
		function extractTexVideoOffset(bytes) {
			const n = Math.min(1024 * 1024, bytes.length - 4);
			for (let i = 0; i < n; i++) {
				if (bytes[i] === 0x66 && bytes[i+1] === 0x74 && bytes[i+2] === 0x79 && bytes[i+3] === 0x70) {
					const start = i - 4;
					return start >= 0 ? start : null;
				}
			}
			return null;
		}
		/** 从 tex 提取内嵌 MP4（从 ftyp-4 到结尾）。 */
		function extractTexVideo(bytes) {
			const off = extractTexVideoOffset(bytes);
			return off === null ? null : bytes.slice(off);
		}
		/** 由纹理名识别时间槽：清晨/白天/黄昏/夜晚 或 morning/day/dusk/night。 */
		function slotFromName(name) {
			const n = name.toLowerCase();
			if (/清晨|morning/.test(n)) return "morning";
			if (/白天|^day|day[^n]/.test(n)) return "day";
			if (/黄昏|dusk/.test(n)) return "dusk";
			if (/夜晚|night/.test(n)) return "night";
			return null;
		}
		/** 从 project.json 属性读时间配置（含已编辑值）。 */
		function timeConfigFromProps(props, propEdits) {
			const get = (k, def) => {
				if (propEdits && propEdits[k] !== void 0) return Number(propEdits[k]);
				if (props && props[k] && props[k].value !== void 0) return Number(props[k].value);
				return def;
			};
			return {
				enabled: get("timevarying", 1) !== 0,
				morning: get("morningtime", 4),
				day: get("daytime", 9),
				dusk: get("dusktime", 17),
				night: get("nighttime", 20)
			};
		}
		/** 按时间配置 + 当前时间算时间槽。 */
		function slotForTime(cfg, date) {
			const h = date.getHours();
			if (h >= cfg.morning && h < cfg.day) return "morning";
			if (h >= cfg.day && h < cfg.dusk) return "day";
			if (h >= cfg.dusk && h < cfg.night) return "dusk";
			return "night";
		}

		// ═══════════════════════════════════════════════════════════════════
		//  安全加固（③）：文件类型嗅探 + URL 协议白名单 + 属性键过滤
		// ═══════════════════════════════════════════════════════════════════
		/** 读文件头判断真实类型；未知/可疑（SVG/HTML/脚本等）返回 null。 */
		function sniffFileType(file) {
			return new Promise((resolve) => {
				try {
					const reader = new FileReader();
					reader.onload = () => {
						try {
							const bytes = new Uint8Array(reader.result, 0, 16);
							const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join(" ");
							const ascii = String.fromCharCode(...bytes.slice(0, 8));
							if (hex.indexOf("89 50 4e 47") === 0) return resolve("png");
							if (ascii.indexOf("GIF8") === 0) return resolve("gif");
							if (hex.indexOf("ff d8 ff") === 0) return resolve("jpeg");
							if (ascii.indexOf("RIFF") === 0 && ascii.indexOf("WEBP") > 0) return resolve("webp");
							if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return resolve("mp4"); // ....ftyp
							if (hex.indexOf("1a 45 df a3") === 0) return resolve("webm"); // Matroska/WebM
							// mpkg：头部 version_length(u32 LE) + "PKGM"
							const vl = bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24);
							if (vl > 0 && vl < 64 && ascii.indexOf("PKGM") === 4) return resolve("mpkg");
							resolve(null);
						} catch { resolve(null); }
					};
					reader.onerror = () => resolve(null);
					reader.readAsArrayBuffer(file.slice(0, 16));
				} catch { resolve(null); }
			});
		}
		/** URL 协议白名单：仅 http(s) 与 data:image。 */
		function sanitizeImageUrl(value) {
			const v = String(value || "").trim();
			if (/^https?:\/\//i.test(v)) return v;
			if (/^data:image\//i.test(v)) return v;
			return null;
		}
		/** 属性键安全：禁止原型污染相关键。 */
		function safePropKey(key) {
			return key !== "__proto__" && key !== "constructor" && key !== "prototype";
		}

		// ═══ MPW-DIRPICK-BEGIN ═══
		//  第13条（用户点名"长期没修好"的 bug）：选择文件夹 / 选择文件的**选择器**。
		//
		//  用户原话：「在选择文件夹的这个功能里面，鼠标上下滑动的时候，画面有时候会自动弹跳到
		//  最顶上，包括有时候会自动锁定到最顶上」。
		//
		//  根因（判据 + 证据见 docs/DIR-PICKER-SCROLL.md）：
		//   ① **滚动位置没有任何人负责**：`scrollTop` 只由浏览器隐式维护；列表一重渲染/重挂
		//      （React 重排数组、dirSubs 重新 fetch、宿主重渲染触发节点重建）就是**新节点**，
		//      新节点的 scrollTop 天然 = 0 ⇒「弹跳到最顶上」。
		//   ② 旧代码试图"事后补偿"：用 rAF×2 + 锚定条目做 `el.scrollTop += …`，而且补偿被两个
		//      时间窗 hack（600ms 让位、同路径只恢复一次）包围 ⇒ 与用户滚动互相打架（「锁在最顶」），
		//      且那段补偿**一行都没执行过**（`dirScrollRef.current.ratio` 从未被赋值，
		//      `if (ratio === void 0 || ratio === null) return;` 恒真 ⇒ 整段是死代码）。
		//   ③ 容器没有 `overscroll-behavior: contain` ⇒ 列表到边界后滚轮**串联给宿主设置面板**，
		//      面板跟着滚（"画面"跟着跳）。
		//
		//  修法（本块 = 选择器的唯一实现；**没有引入任何第三方依赖**，思路参考见 THIRD-PARTY.md §4）：
		//   **滚动主权归容器自己**：容器按 key 记住用户的 scrollTop（滚动事件只写 ref，不 setState），
		//   在 useLayoutEffect（绘制前、同步）里把记忆值写回 —— 因此**无论 React 如何重建节点、
		//   无论列表内容如何变化，用户看到的下一帧都还在原位**，且写回的是用户最后一次的位置 ⇒
		//   幂等、永远不与用户滚动打架，也不再需要任何时间窗 hack。
		//   **绝不抢焦点**：本块没有任何 focus()/autoFocus/scrollIntoView（除用户按键时的
		//   `block:"nearest"` 最小位移）；活动行只改 class/aria，不改焦点。
		//
		//  测试：tools/dir-picker-test.mjs 按下面两个标记切片，在假 DOM + 迷你 React 下逐条断言
		//  并做"旧写法必须变红"的对照；行为契约（给测试台 8901/8902 对齐用）见 README「选择器行为契约」。
		const MPW_DIRPICK_BLOCK = "MPW-DIRPICK";
		// ①(第13条 真机实测补修) 列表滚动记忆放在**模块级**（不是组件实例内）：
		//   真机探针（tools/dir-picker-probe.mjs，2026-09-17）实测到宿主重渲染会把选择器弹窗
		//   整棵子树**重新挂载**（探针里同一容器上出现 8 次 focusin = 多次 mount；
		//   而容器自身的 scrollTop 在没有任何 JS 写入、也没有"列表节点被替换"的情况下
		//   从 800 变 0）⇒ **实例内的 ref 记忆随卸载丢失**，恢复逻辑拿到空记忆就只能认领 0。
		//   记忆必须活得比 React 树长：键 = "dir:<路径>" / "lib" / "steam" / "rot:<过滤>"。
		//   上限 64 个键（FIFO 淘汰）：浏览过的目录再多也不会无限增长。
		const MPW_LIST_SCROLL_MEM = Object.create(null);
		const mpwScrollMemKeys = [];
		const mpwScrollMemGet = (k) => (k in MPW_LIST_SCROLL_MEM ? MPW_LIST_SCROLL_MEM[k] : void 0);
		const mpwScrollMemSet = (k, v) => {
			if (!(k in MPW_LIST_SCROLL_MEM)) {
				mpwScrollMemKeys.push(k);
				if (mpwScrollMemKeys.length > 64) { const drop = mpwScrollMemKeys.shift(); try { delete MPW_LIST_SCROLL_MEM[drop]; } catch (e) {} }
			}
			MPW_LIST_SCROLL_MEM[k] = v;
		};
				/** 列表滚动目标值（纯函数，tools/dir-picker-test.mjs 直接断言）。
		 *  规则（与测试台 §10.5 对齐）：**只有有限 number 才算有效锚点**；
		 *  null / undefined / "" / NaN / Infinity 一律当"无锚点"⇒ 认领容器当前值（绝不回 0）；
		 *  结果一律 clamp 到 [0, max]（内容变短 ⇒ 夹住原位置，也不回 0）。 */
		const mpwScrollTarget = (raw, cur, max) => {
			const curV = (typeof cur === "number" && isFinite(cur)) ? cur : 0;
			const want = (typeof raw === "number" && isFinite(raw)) ? raw : curV;
			const m = (typeof max === "number" && isFinite(max) && max > 0) ? max : 0;
			return Math.max(0, Math.min(want, m));
		};
		/** 列表滚动主权钩子：**必须在组件顶层无条件调用**（调用顺序稳定）。
		 *  @param ref  滚动容器 ref
		 *  @param key  记忆分桶键（不同目录/不同列表各自记住位置）
		 *  @param active 容器当前是否真的挂着（false 时不恢复，避免对未挂载节点写值）
		 *  返回要展开到容器上的 props（onScroll + 样式）。 */
		const useMpwListScroll = (ref, key, active) => {
			// ①(兼容) 测试桩 React 可能没有 useLayoutEffect（panel-smoke/_stub 的 mock）→ 逐级回退
			const useIso = react.useLayoutEffect || react.useEffect || ((f) => f());
			// 滚动路径**只写 ref**：绝不 setState（滚动里触发重渲染 = 自己制造跳顶）
			const onScroll = () => {
				try {
					const el = ref.current;
					if (el) mpwScrollMemSet(String(key), el.scrollTop || 0);
				} catch (e) {}
			};
			// 无依赖数组 ⇒ 每次渲染（layout 阶段、绘制之前）都同步校准一次；幂等。
			useIso(() => {
				if (!active) return;
				try {
					const el = ref.current;
					if (!el) return;
					const k = String(key);
					if (!(k in MPW_LIST_SCROLL_MEM)) { mpwScrollMemSet(k, el.scrollTop || 0); return; } // 首次：认领当前位置
					const max = Math.max(0, (el.scrollHeight || 0) - (el.clientHeight || 0));
					// ①(第13条 · 与测试台 §10.5 对齐) **锚点缺失 = 认领当前位置，绝不回 0**：
					//   测试台线实锤过 `Number(null) === 0 && isFinite(0)` ⇒ 被当有效锚点 ⇒ scrollTop→0。
					//   我们这里**不做任何数字强转**：只有"有限 number"才算有效锚点；null/undefined/NaN/"" 一律
					//   当作"无锚点"→ 用容器当前值（clamp 到新范围），于是"锚点没了"只会夹住位置，不会跳顶。
					const v = mpwScrollTarget(mpwScrollMemGet(k), el.scrollTop, max);
					if (el.scrollTop !== v) el.scrollTop = v;
				} catch (e) {}
			});
			return { onScroll: onScroll, overscrollBehavior: "contain", overflowAnchor: "none" };
		};
		/** 子目录路径拼接（与宿主 /list-dirs 的规范化路径同构：有反斜杠就按 Windows 拼）。 */
		const mpwDirChildPath = (path, name, platform) => {
			const p = String(path || "");
			const sep = (p.indexOf("\\") >= 0 || platform === "win32") ? "\\" : "/";
			return (p ? p + sep : "") + String(name || "");
		};
		/** 上级目录（保留根斜杠：`C:\a` → `C:\`；`/a/b` → `/a`；`/a` → `/`）。 */
		const mpwDirParentPath = (path, platform) => {
			const p = String(path || "");
			if (platform === "win32" || /^[A-Za-z]:\\/.test(p)) {
				const rest = p.slice(3);
				const up = rest ? p.slice(0, 3) + rest.split("\\").slice(0, -1).join("\\") : "C:\\";
				return up || "C:\\";
			}
			const parts = p.split("/").filter(Boolean);
			return parts.length > 1 ? "/" + parts.slice(0, -1).join("/") : "/";
		};
		/** 行 DOM id（aria-activedescendant 用；只用 ASCII，路径压成短后缀）。 */
		const mpwDirRowId = (path, idx) => "mpwdir-" + String(idx) + "-" + String(path || "").replace(/[^A-Za-z0-9]+/g, "_").slice(-32);
		/** 目录列表（自包含组件：只依赖 props 与 react；无副作用、无焦点操作）。 */
		const MpwDirList = (props) => {
			const p = props || {};
			const path = String(p.path || "");
			const subs = Array.isArray(p.subs) ? p.subs : [];
			const platform = String(p.platform || "");
			const listRef = react.useRef(null);
			const [active, setActive] = react.useState(-1);
			const sc = useMpwListScroll(listRef, "dir:" + path, p.active !== false);
			// ①(第13条 · 与测试台 §10.5 对齐) 弹窗**挂载时把焦点给列表容器自己**（不是第 0 行），
			//   并且一律 `preventScroll:true` ⇒ 键盘立刻可用，同时**不会**触发浏览器"把焦点元素滚进视野"
			//   （那正是用户报的"跳到最顶/锁在最顶"的经典成因）。每次挂载只做一次；重渲染不再抢焦点。
			const focusedOnceRef = react.useRef(false);
			(react.useLayoutEffect || react.useEffect || ((f) => f()))(() => {
				if (focusedOnceRef.current) return;
				focusedOnceRef.current = true;
				try {
					const el = listRef.current;
					if (el && typeof el.focus === "function") el.focus({ preventScroll: true });
				} catch (e) {}
			}, []);
			// 行 key = **路径 + 目录名**（不是目录名本身）：内容变化时 React 不会把 A 行复用成 B 行
			const rows = subs.map((name) => ({ name: String(name), key: path + "\u0000" + String(name), child: mpwDirChildPath(path, name, platform) }));
			const clampIdx = (i) => (rows.length ? Math.max(0, Math.min(rows.length - 1, i)) : -1);
			const reveal = (i) => {
				// 只在**用户按键**导致的移动里调用，且只做最小位移（不把容器拉到顶/底）
				try {
					const el = listRef.current;
					if (!el || i < 0) return;
					const node = el.querySelector ? el.querySelector('[data-mpw-diridx="' + i + '"]') : null;
					if (node && node.scrollIntoView) node.scrollIntoView({ block: "nearest", inline: "nearest" });
				} catch (e) {}
			};
			const moveTo = (i) => { setActive(i); reveal(i); };
			const onKeyDown = (ev) => {
				if (!ev || !ev.key) return;
				const k = ev.key;
				if (k === "Escape") { if (ev.preventDefault) ev.preventDefault(); if (p.onClose) p.onClose(); return; }
				if (k === "Enter") {
					if (ev.preventDefault) ev.preventDefault();
					if (active >= 0 && rows[active] && p.onOpen) p.onOpen(rows[active].child);
					else if (p.onChoose) p.onChoose();
					return;
				}
				if (k === "Backspace" || (k === "ArrowUp" && ev.altKey)) {
					if (ev.preventDefault) ev.preventDefault();
					if (p.onUp) p.onUp();
					return;
				}
				if (!rows.length) return;
				if (k === "ArrowDown") { if (ev.preventDefault) ev.preventDefault(); moveTo(active < 0 ? 0 : clampIdx(active + 1)); return; }
				if (k === "ArrowUp") { if (ev.preventDefault) ev.preventDefault(); moveTo(active < 0 ? rows.length - 1 : clampIdx(active - 1)); return; }
				if (k === "Home") { if (ev.preventDefault) ev.preventDefault(); moveTo(0); return; }
				if (k === "End") { if (ev.preventDefault) ev.preventDefault(); moveTo(rows.length - 1); return; }
			};
			const children = [];
			// ①(第13条 · 与测试台 §10.5 对齐) **行不参与焦点**：行容器 mousedown 阻止默认聚焦 +
			//   行内按钮 tabIndex=-1 ⇒ 点行/按方向键都不会让任何一行成为 activeElement（焦点始终在容器/弹窗）。
			const noFocus = (ev) => { try { if (ev && ev.preventDefault) ev.preventDefault(); } catch (e) {} };
			if (p.canUp !== false) {
				children.push(react.createElement("div", { className: "mpw_prop", key: "__up", onMouseDown: noFocus }, [
					react.createElement("button", {
						className: "mpw_reset mpw_moreBtn", type: "button", tabIndex: -1,
						onClick: () => { if (p.onUp) p.onUp(); }
					}, "⬆ " + String(p.labelUp || ""))
				]));
			}
			if (rows.length) {
				rows.forEach((r, i) => {
					children.push(react.createElement("div", {
						className: "mpw_prop" + (i === active ? " mpw_rowActive" : ""),
						key: r.key, id: mpwDirRowId(path, i), "data-mpw-diridx": i, "data-mpw-dir": r.name,
						"aria-selected": i === active, role: "option",
						onMouseDown: noFocus,
						onPointerDown: () => { if (p.onPress) p.onPress(r.name, i); }
					}, [
						react.createElement("button", {
							className: "mpw_reset mpw_moreBtn", type: "button", tabIndex: -1,
							onClick: () => { if (p.onOpen) p.onOpen(r.child); }
						}, "📁 " + r.name)
					]));
				});
			} else {
				children.push(react.createElement("p", { className: "mpw_hint", key: "__empty" }, String(p.labelEmpty || "")));
			}
			return react.createElement("div", {
				className: "mpw_props mpw_dirList",
				ref: listRef,
				role: "listbox",
				tabIndex: 0,
				"aria-activedescendant": (active >= 0 && rows[active]) ? mpwDirRowId(path, active) : void 0,
				onScroll: sc.onScroll,
				onKeyDown: onKeyDown,
				style: { maxHeight: 240, overflowY: "auto", overscrollBehavior: sc.overscrollBehavior, overflowAnchor: sc.overflowAnchor }
			}, children);
		};
		// 测试取用（tools/dir-picker-test.mjs：切片后不依赖宿主也能调到这几个实现）
		try { globalThis.__mpwDirPickImpl = { mpwScrollTarget: mpwScrollTarget, MPW_LIST_SCROLL_MEM: MPW_LIST_SCROLL_MEM, useMpwListScroll: useMpwListScroll, MpwDirList: MpwDirList, mpwDirChildPath: mpwDirChildPath, mpwDirParentPath: mpwDirParentPath, mpwDirRowId: mpwDirRowId, block: MPW_DIRPICK_BLOCK }; } catch (e) {}
		// ═══ MPW-DIRPICK-END ═══

		// ═══════════════════════════════════════════════════════════════════
		//  设置页组件（settings.section：出现在设置左侧导航，⑤）
		// ═══════════════════════════════════════════════════════════════════
		/** 左右滑动式开关（②：不用打勾的 checkbox）。 */
		function Toggle({ checked, onChange, disabled }) {
			const h = react.createElement;
			// ①(新) 新样式开关（其他 tab 控制）：新式轨道开关 / 旧式胶囊开关
			let newStyle = false;
			try { newStyle = !!readSection().newStyle; } catch {}
			const btn = h("button", {
				type: "button",
				role: "switch",
				"aria-checked": !!checked,
				disabled: !!disabled,
				className: "mpw_switch" + (checked ? " mpw_on" : "") + (newStyle ? " mpw_new" : ""),
				onClick: () => onChange(!checked)
			});
			// ①(新) 新样式：开关 + 外置 ON/OFF（uiverse 原版 SVG 笔划字母，非文字）
			if (newStyle) {
				return h("span", { className: "mpw_switchWrap" + (checked ? " mpw_on" : "") }, [
					btn,
					h("svg", { className: "mpw_switchLetters", viewBox: "0 0 24 24", width: "24", height: "24", "aria-hidden": "true" },
						h("g", { stroke: "currentColor", "stroke-linecap": "round", "stroke-width": "4", transform: "translate(0,4)" },
							h("g", { className: "mpw_switchLetter" },
								h("polyline", { className: "mpw_switchLetter-stroke", points: "2 2,2 14" }),
								h("polyline", { className: "mpw_switchLetter-stroke", points: "2 2,16 2", "stroke-dasharray": "14 16", "stroke-dashoffset": "8", transform: "rotate(0,2,2)" }),
								h("polyline", { className: "mpw_switchLetter-stroke", points: "2 8,6 8", "stroke-dasharray": "4 6" })
							),
							h("g", { className: "mpw_switchLetter", transform: "translate(14,0)" },
								h("polyline", { className: "mpw_switchLetter-stroke", points: "2 2,2 14" }),
								h("polyline", { className: "mpw_switchLetter-stroke", points: "2 2,8 2", "stroke-dasharray": "6 8" }),
								h("polyline", { className: "mpw_switchLetter-stroke", points: "2 8,6 8", "stroke-dasharray": "4 6" })
							)
						)
					)
				]);
			}
			return btn;
		}

		// ⑳(新) Tab 顺序（内容区 translateX 滑动用）
		// ①(2026-09-12 根因修复) **必须与真实存在的 tab div 完全一致**：
		//   上一轮删掉了 "aqua 实验" tab 的 DOM，但常量里还留着 "aqua" → 若当前选中的正是 aqua，
		//   translateX(-indexOf("aqua")*100%) = -500% → 正好停在"已被删除的空槽位" → 面板整块空白
		//   （用过插件才有该状态、Firefox 干净状态正常、重启不自愈、且不报错 —— 与实测现象完全吻合）。
		const TAB_ORDER = ["source", "wallpaper", "appearance", "unify", "blur", "other", "liquid"];
		// ①(新) 取色盘预置色（借鉴 elysia395/dsh-wallpaper-engine）：点击即用
		const AQUA_PRESETS = ["#4f8cff", "#67DCE7", "#DD8FAC", "#F3B75F", "#F1717F", "#CBE77D"];

		// ①(2026-09-12 绝对保险) 整块 section 外壳：实现体任何位置抛错都在这里被捕获，
		//   面板永远显示"可用内容 + 错误详情"，不会再出现整页空白（用户实测多次空白）。
		function MpkgSection(props) {
			try {
				return MpkgSectionImpl(props);
			} catch (e) {
				mpwTrace('section:throw', { message: String(e && e.message), stack: String(e && e.stack || '').slice(0, 400) });
				try { console.warn('[dsh-mpkg-wallpaper] 设置区渲染异常:', e); } catch {}
				try {
					fetch(HOST_BASE + '/diag', { method: 'POST', body: JSON.stringify({ kind: 'js-error', why: 'section-outer', message: String(e && e.message || e), stack: String(e && e.stack || '').slice(0, 1500), at: new Date().toISOString() }) }).catch(() => {});
				} catch {}
				const t2 = (props && typeof props.t === 'function') ? props.t : ((k) => k);
				return react.createElement('div', { className: 'mpw_row mpw_glassHost', style: { padding: '14px' } }, [
					react.createElement('p', { className: 'mpw_hint', key: 'e1' }, '壁纸引擎设置区渲染异常：' + String(e && e.message || e)),
					react.createElement('p', { className: 'mpw_hint', key: 'e2' }, '已自动上报，可在插件目录查看 diag 记录；面板其余功能不受影响。'),
					react.createElement('button', {
						key: 'e3', className: 'mpw_reset', type: 'button',
						onClick: () => { try { window.__mpwSectionRetry = (window.__mpwSectionRetry || 0) + 1; location.reload() } catch {} }
					}, '重新加载')
				]);
			}
		}
		function MpkgSectionImpl(props) {
			try {
			try { mpwTrace('section:enter', { propKeys: props ? Object.keys(props) : null, tType: typeof (props && props.t), }) } catch {}
			// ①(2026-09-12 关键根因) 组件体内一直引用自由变量 `h`（本文件只有 Toggle 等组件各自定义过
			//   `const h = react.createElement`），实测报错 `h is not defined` → 宿主错误边界吞掉 →
			//   面板整块空白；而它此前"能用"只是碰巧拿到了宿主/打包器泄漏的全局 h（时机相关，
			//   这正是"有时正常、有时空白、重启几次又好了"的来源）。这里显式定义，彻底自洽。
			const h = react.createElement;
			const { t } = props;
			const initMeta = (() => {
				const s = readSection();
				if (s.fromMpkg && s.mpkgKey && s.info) return { name: s.mpkgName, key: s.mpkgKey, info: s.info, entryName: s.source || "preview.gif", slot: s.slot };
				// ①(修正) web 壁纸同样要恢复来源显示——之前只认 s.info（web 的 info 是 undefined），
				// 重开设置后来源消失（用户实测：导入星野后来源显示，关设置重开就没了）。
				if (s.webUrl && s.converted === "web" && s.mpkgName) return { name: s.mpkgName, key: s.mpkgKey || s.webUrl, info: null, entryName: s.source || "index.html", slot: null };
				return null;
			})();
			const [section, setSection] = react.useState(readSection());
			// ①(2026-09-12 自愈+取证) 面板"渲染成功但看不到"时：
			//   1) 上报实测 DOM（是否存在/高度/父链可见性）→ 工程侧可定位；
			//   2) 自动把本地设置**备份**后重置为默认（面板立刻可用，备份键 mpw_settings_backup）。
			const __panelRootRef = react.useRef(null);
			react.useEffect(() => {
				const t = setTimeout(() => {
					try {
						const el = __panelRootRef.current;
						const rect = el ? el.getBoundingClientRect() : null;
						const h0 = el ? el.offsetHeight : -1;
						const parentH = el && el.parentElement ? el.parentElement.offsetHeight : -1;
						const problem = !el || h0 === 0 || (rect && rect.width === 0);
						fetch(HOST_BASE + '/diag', { method: 'POST', body: JSON.stringify({ kind: 'panel-invisible-probe', why: 'self-check', mounted: !!el, offsetHeight: h0, parentHeight: parentH, rect: rect ? [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)] : null, cls: el ? String(el.className) : '', at: new Date().toISOString() }) }).catch(() => {});
						// ①(2026-09-12 重要修正) **绝不自动重置用户设置**！
						//   上一版"面板不可见即备份并重置为默认"把用户 85 项配置清空了（用户实测）。
						//   现在只上报实测结果；面板可见性由"插件自挂载"兜底解决。
						if (problem) {
							try {
								const raw = localStorage.getItem(STORE_KEY) || '';
								if (raw && !localStorage.getItem('mpw_settings_backup')) localStorage.setItem('mpw_settings_backup', raw);
								console.warn('[dsh-mpkg-wallpaper] 宿主未挂载面板（已上报；设置未改动）');
							} catch {}
						}
					} catch (e) {}
				}, 900);
				return () => clearTimeout(t);
			}, []);
			// ⑳(新) 设置页顶部 Tab（来源/外观/统一虚化/界面虚化/透出/Aqua/其他），减少滚动。
			// Tab 切换只改 display，控件始终挂载（hooks 稳定，不能条件卸载 sliderRow/toggleRow）。
			const [settingsTab, setSettingsTab] = react.useState("source");
			// ①(修复) 安全 tab 索引：陈旧/非法值（如历史 "aqua"）一律归位到第一个 tab，
			//   避免 indexOf 返回 -1 造成位移错位、面板空白。
			const tabSafe = TAB_ORDER.indexOf(settingsTab) >= 0 ? settingsTab : TAB_ORDER[0];
			react.useEffect(() => {
				if (settingsTab !== tabSafe) { try { setSettingsTab(tabSafe); } catch {} }
			}, [settingsTab, tabSafe]);
			// ②(修正) Tab 切换：内容区 translateX 滑动（TAB_ORDER 顺序）
			const switchTab = (id) => {
				if (id === settingsTab) return;
				setSettingsTab(id);
			};
			const [mpkgMeta, setMpkgMeta] = react.useState(initMeta); // { name, key, info, entryName, slot }
			const [wallPausedByUser, setWallPausedByUser] = react.useState(wallUserPaused); // ①(新) 用户手动暂停壁纸（初值取权威 wallUserPaused，避免重开设置页显示错）
			const [busy, setBusy] = react.useState(false);
			// ①(修正) hint 自动超时清空（5 秒）：用户反馈「恢复所有默认设置」下方一直挂着
			// 「已应用壁纸：xxx」——hint 是操作结果提示，常驻会让用户误以为是与恢复默认相关
			// 的残留。用 ref 存原始 setter，包装成带超时的 setHint。
			const [hint, _setHintRaw] = react.useState("");
			const hintTimerRef = react.useRef(null);
			// ①(修正) 卸载时清理 hint 计时器（防对已卸载组件 setState）
			react.useEffect(() => () => { try { if (hintTimerRef.current) clearTimeout(hintTimerRef.current); } catch {} }, []);
			// ①(修正) 暂停按钮**实时**同步：监听 mpw:wallpaused 事件（视频实际 play/pause 变化
			// 或用户点按钮都会派发），把 wallPausedByUser 同步为权威 wallUserPaused 的值。
			react.useEffect(() => {
				const onWallPaused = (e) => { try { setWallPausedByUser(!!(e && e.detail && e.detail.paused)); } catch {} };
				try { window.addEventListener("mpw:wallpaused", onWallPaused); } catch {}
				return () => { try { window.removeEventListener("mpw:wallpaused", onWallPaused); } catch {} };
			}, []);
			const setHint = (msg) => {
				_setHintRaw(msg);
				if (hintTimerRef.current) { try { clearTimeout(hintTimerRef.current); } catch {} }
				if (msg) {
					hintTimerRef.current = setTimeout(() => { _setHintRaw(""); }, 5000);
				}
			};
			const [url, setUrl] = react.useState("");
			const [propsExpanded, setPropsExpanded] = react.useState(false);
			const [conflictModal, setConflictModal] = react.useState(false);
			const [previewModal, setPreviewModal] = react.useState(false);
			const [errorModal, setErrorModal] = react.useState(false);
			const [errorMsg, setErrorMsg] = react.useState("");
			const [conflicts, setConflicts] = react.useState([]);
			const [hostOk, setHostOk] = react.useState(null); // null=未检测 true=可用 false=不可用
			const [hostVersion, setHostVersion] = react.useState(""); // host 返回的插件版本（标题显示）
			const [betterSidebar, setBetterSidebar] = react.useState(false); // ①(新) host 检测：dsh-better-sidebar 是否已安装（「其他」tab 适配分类显示门）
			const [libWalls, setLibWalls] = react.useState(null); // null=未扫描 [] = 空列表
			const [libBusy, setLibBusy] = react.useState(false);
			const [customDir, setCustomDirState] = react.useState(readSection().customDirPath || "");
			const [customFiles, setCustomFiles] = react.useState(null); // null=未扫描
			const [dirPick, setDirPick] = react.useState(false); // 目录选择弹窗
			const [dirPath, setDirPath] = react.useState("");
			const [dirSubs, setDirSubs] = react.useState([]);
			const [dirHome, setDirHome] = react.useState("");
			const [dirPlatform, setDirPlatform] = react.useState("");
			const [updState, setUpdState] = react.useState(null); // null=未检测 / {checking}/{hasUpdate...}
			const [updChoose, setUpdChoose] = react.useState(null); // ①(新) 更新方式确认弹窗（内置 vs 市场）
			const [webConfirm, setWebConfirm] = react.useState(null); // ①(新) 网页壁纸确认弹窗（实验性警告）
			const [rotModal, setRotModal] = react.useState(false);   // ⑳(新) 轮播列表管理弹窗
			const [rotEditor, setRotEditor] = react.useState(false); // ⑳(新) 轮播列表编辑弹窗
			const [rotEdit, setRotEdit] = react.useState(null);      // ⑳(新) 正在编辑的列表草稿
			const [rotFilter, setRotFilter] = react.useState("all"); // ⑳(新) 勾选界面来源过滤：all/custom/steam
			const rotGridRef = react.useRef(null);  // ①(新) 轮播勾选壁纸网格滚动容器（防勾选后跳顶）
			const tabBodyRef = react.useRef(null); // ①(新) tab 高度自适应（跟随当前页最后按钮）
			const [wallList, setWallList] = react.useState([]); // ② 合并后的可选壁纸列表
			const [wallIdx, setWallIdx] = react.useState(-1);   // 当前在列表中的索引
			const [libShow, setLibShow] = react.useState(10);   // 1(新) 列表单次展示数量（可展开）
			const [libOpen, setLibOpen] = react.useState(true);  // 2(新) 壁纸列表展开/收起
			// ①(MERGED-3 1.2) sceneExtUrl 设置项 UI 草稿与测试结果（渲染器外部扩展钩子入口，
			//   应用时 applySceneViaRenderer 会拼成 iframe 的 extbase，见 EXTENSION-HOOKS.md）
			const [extUrlDraft, setExtUrlDraft] = react.useState(() => { try { return String(readSection().sceneExtUrl || "") } catch (e) { return "" } });
			// ①(批次15 B3) 渲染器调试参数草稿：保存时净化（白名单逐个校验）并对当前场景立即重挂
			const [dbgDraft, setDbgDraft] = react.useState(() => { try { return String(readSection().sceneDebugParams || "") } catch (e) { return "" } });
			const [extTest, setExtTest] = react.useState(""); // ""=未测；"…"=测试中；否则结果文本
			// ①(MERGED-3 1.3/2.3) 诊断开关速查区：默认用内置副本，渲染器在线时换 /diag-flags.json（脚本生成）
			const [diagOpen, setDiagOpen] = react.useState(false);
			const [diagFlagList, setDiagFlagList] = react.useState(() => { try { return JSON.parse(MPW_DIAG_FLAGS_FALLBACK) || [] } catch (e) { return [] } });
			react.useEffect(() => {
				try {
					const ctl = new AbortController();
					const tid = setTimeout(() => { try { ctl.abort(); } catch {} }, 1500);
					fetch(mpwSceneRendererBase() + "diag-flags.json", { signal: ctl.signal, cache: "no-store" })
						.then((r) => (r && r.ok ? r.json() : null))
						.then((d) => {
							clearTimeout(tid);
							if (d && Array.isArray(d.common) && d.common.length) {
								const list = d.common
									.map((x) => (typeof x === "string" ? { name: x, usage: x + "=1" } : x))
									.filter((x) => x && x.name);
								if (list.length) setDiagFlagList(list);
							}
						})
						.catch(() => { clearTimeout(tid); });
				} catch (e) { /* 离线副本兜底，读不到就维持内置副本 */ }
			}, []);
			// ①(新) 统一错误弹窗：导入失败/文件过大/无法使用等提示全部弹窗体现
			const showError = (msg) => { setErrorMsg(String(msg)); setErrorModal(true); setHint(String(msg)); };
			// ①(2026-09-17 持久化轮) 壁纸持久化失败/降级**必须可见**：
			//   · 失败（localStorage 拒写且 IDB 不可用 / 哨兵读不回来）→ 弹窗 + hint（不静默）；
			//   · 降级（大图落 IndexedDB，刷新后仍能恢复）→ 面板里挂一行状态说明。
			//   注意：applyFromStorage 在 inject() 阶段（面板还没挂载）就可能 emit，所以工厂层带"待取"队列。
			const [persistWarn, setPersistWarn] = react.useState(() => { try { return mpwPersistTakePending() } catch (e) { return "" } });
			let persistFailSeen = !!persistWarn;   // 组件内普通变量：commit 里据此"用户又动了一次→清旧告警"
			react.useEffect(() => {
				const off = mpwPersistOnMsg((m) => { try { persistFailSeen = true; setPersistWarn(String(m)); setErrorMsg(String(m)); setErrorModal(true); setHint(String(m)); } catch {} });
				return () => { try { off() } catch {} };
			}, []);
			const mpkgRef = react.useRef(null);
			const imgRef = react.useRef(null);
			const backupRef = react.useRef(null); // ④(新) 备份导入文件输入（其他 tab）
			// ⑤(新) 最近一次导出的实际文件名（界面显示，防重复导出分不清）
			const [backupFileName, setBackupFileName] = react.useState("");
			// ③(新) web 壁纸选项：当前 L2D 类壁纸的 loadJson.json SettingModel（可改项）
			const [webCfg, setWebCfg] = react.useState(null); // { skel, model, languages, customUrl } | null
			// ①(第13条 根因修复) 目录选择器滚动位置：旧的「打开时记锚点 + rAF×2 事后补偿 +
			//   600ms 让位 + 同路径只恢复一次」四件套**全部删除**（其中补偿段因 ratio 恒为 undefined
			//   而从未执行过 = 死代码）。现在由 MpwDirList 内部的 useMpwListScroll 接管：
			//   容器自己记忆用户的 scrollTop，绘制前同步写回 ⇒ 不需要任何时间窗/锚点 hack。
			//   仍在组件顶层无条件调用（调用顺序稳定；不是条件 hook）。见 MPW-DIRPICK 块。
			const dirClickLockRef = react.useRef(null); // pointerdown 锁定行（触摸滑动时不误选；1.5s 过期）
			const wallGridRef = react.useRef(null);     // ①(第13条) 本地壁纸库网格（同款滚动主权）
			const wallGridSteamRef = react.useRef(null); // ①(第13条) Steam 库网格（同款滚动主权）
			// ①(第13条) 滚动主权：每个滚动容器各自记住用户的 scrollTop（**顶层无条件调用**，顺序固定）。
			//   选择文件夹的列表由 MpwDirList 内部自持（它自己的 ref/记忆），这里只管面板里的三个列表。
			const wallGridScroll = useMpwListScroll(wallGridRef, "lib", !!libOpen && !!(wallList && wallList.length));
			const steamGridScroll = useMpwListScroll(wallGridSteamRef, "steam", !!libOpen && !!(libWalls && libWalls.length));
			const rotGridScroll = useMpwListScroll(rotGridRef, "rot:" + String(rotFilter || ""), !!rotEditor);
			// ⑳(新) 壁纸设置 tab：ffmpeg 跨平台转码的安装状态
			//（null=未查 / {checking} / {ready,path,version} / {missing} / {downloading} / {error}）
			const [ffmpegState, setFfmpegState] = react.useState(null);
			// ①(新) 活动进度条（转码/scene 提取共用）：{ visible, label, percent, mode }
			// mode: "transcode"（轮询 /transcode-progress 显示%）| "scene"（不确定进度动画）
			const [mpwBusy, setMpwBusy] = react.useState(null);
			const mpwBusyRef = react.useRef(null);
			const setBusyState = (b) => { mpwBusyRef.current = b; setMpwBusy(b); };
			// ①(修正) 订阅模块级 mpw:busy 事件（模块函数 pollTranscodeProgress 等经此通知组件）
			react.useEffect(() => {
				const onBusy = (ev) => {
					const d = ev && ev.detail;
					if (!d) { setBusyState(null); return; }
					// label 可能是 tkey 前缀（tc:/ffdl:）→ 按 locale 翻译
					let label = d.label || "";
					if (label.indexOf("tc:") === 0) label = t("busy.transcoding");
					else if (label.indexOf("ffdl:") === 0) label = t("ffmpeg.downloading");
					setBusyState({ visible: true, label, percent: d.percent != null ? d.percent : null, mode: d.mode || "transcode" });
				};
				try { window.addEventListener("mpw:busy", onBusy); } catch {}
				return () => { try { window.removeEventListener("mpw:busy", onBusy); } catch {} };
			}, []);
			// ①(新) scene 提取/合成中：不确定进度（label 可选）
			const showSceneBusy = (label) => setBusyState({ visible: true, label: label || t("scene.extracting"), percent: null, mode: "scene" });
			const hideBusy = () => setBusyState(null);
			// ①(修正) pollTranscodeProgress 是模块级（applyFromStorage 播放分支调用）——
			// 组件内不再重复定义，直接引用模块级实现（同作用域可见）。
			// ⑳(新) 探测 ffmpeg（壁纸设置 tab 打开 / 改 fpsCap / 下载成功后都刷新）；host 端跨平台实现。
			// ①(修正) 保存 source（env/system/cached）以便区分「系统已装」和「缓存已装」。
			const checkFfmpeg = () => {
				setFfmpegState({ checking: true });
				fetch(HOST_BASE + "/ffmpeg-check", { method: "GET" }).then(async (r) => {
					let d = null; try { d = await r.json(); } catch {}
					if (r.ok && d && d.ok && d.found) setFfmpegState({ ready: true, source: d.source, path: d.path, version: d.version });
					else setFfmpegState({ missing: true });
				}).catch((e) => setFfmpegState({ error: String(e && e.message || e) }));
			};
			// ⑳(新) 下载 ffmpeg（仅 found=false 时显示；用户点击才首次联网，不自动下载）
			const downloadFfmpeg = () => {
				setFfmpegState({ downloading: true });
				fetch(HOST_BASE + "/ffmpeg-download", { method: "POST" }).then(async (r) => {
					let d = null; try { d = await r.json(); } catch {}
					if (r.ok && d && d.ok) { setHint(t("ffmpeg.downloadOk")); checkFfmpeg(); }
					else setFfmpegState({ error: (d && (d.error || d.message)) || ("HTTP " + r.status) });
				}).catch((e) => setFfmpegState({ error: String(e && e.message || e) }));
			};
			// ①(新) 卸载缓存里的 ffmpeg（只删 DATA_DIR/ffmpeg/ 下的；**不碰系统 PATH/env**）。
			// 仅当当前用的是 cached 来源时才显示卸载按钮（防止误卸系统自带）。
			const uninstallFfmpeg = () => {
				setFfmpegState({ busy: true });
				fetch(HOST_BASE + "/ffmpeg-uninstall", { method: "POST" }).then(async (r) => {
					let d = null; try { d = await r.json(); } catch {}
					if (r.ok && d && d.ok) { setHint(t("ffmpeg.uninstallOk")); checkFfmpeg(); }
					else setFfmpegState({ error: (d && (d.error || d.message)) || ("HTTP " + r.status) });
				}).catch((e) => setFfmpegState({ error: String(e && e.message || e) }));
			};

			// ④ 初始冲突检测（设置页打开时其他插件都已加载）
			react.useEffect(() => {
				setConflicts(detectConflicts());
				// ②(修正) 注册设置页状态刷新回调：导入时间壁纸/切换时段后
				// notifySectionChanged() → 重读 section，时段 UI 立即出现/高亮更新
				//（否则要关掉设置页重开才显示，用户实测）。
				mpwSectionNotify = () => { try { setSection(readSection()); } catch {} };
				// ①(修正) 版本号实时刷新：每次打开设置页/切 tab 都重新读本地安装版本
				//（host 从 package.json 读，文件更新了版本自然跟着变；插件市场式体验）
				// ①(新) 同时取 betterSidebar 检测标志 + 版本（host /ping 附带；版本用于按版本适配）
				try {
					fetch(HOST_BASE + "/ping", { method: "GET" }).then(async (p) => {
						if (p.ok) { const pd = await p.json(); if (pd && pd.version) setHostVersion(pd.version); if (pd && typeof pd.betterSidebar === "boolean") setBetterSidebar(pd.betterSidebar); try { applyBetterSidebarVersion(pd && pd.betterSidebarVersion); } catch {} }
					}).catch(() => {});
				} catch {}
				// ③(新) 检测宿主端可用性（大文件混合模式是否生效）
				fetch(HOST_BASE + "/ping", { method: "GET" }).then(async (r) => {
					setHostOk(!!r.ok);
					if (r.ok) { try { const d = await r.json(); if (d && d.version) setHostVersion(d.version); if (d && typeof d.betterSidebar === "boolean") setBetterSidebar(d.betterSidebar); try { applyBetterSidebarVersion(d && d.betterSidebarVersion); } catch {} } catch {} }
				}).catch(() => setHostOk(false));
				// ①(新) 自动检测更新（版本号旁徽标）：延迟到本 effect 收尾后再查，避免与
				// 上面的 ping/版本刷新竞争；不阻塞 UI（checkUpdate 内部 async）。仅在有
				// 新版本时点亮徽标，不自动弹窗。
				try {
					const t = setTimeout(() => { try { checkUpdate(); } catch {} }, 800);
					if (window.__mpwAutoUpdTimer) clearTimeout(window.__mpwAutoUpdTimer);
					window.__mpwAutoUpdTimer = t;
				} catch {}
				return () => {
					if (mpwSectionNotify) mpwSectionNotify = null;
					// ①(修正) 清理自动检测定时器（防卸载后仍发请求/setState）
					try { if (window.__mpwAutoUpdTimer) { clearTimeout(window.__mpwAutoUpdTimer); window.__mpwAutoUpdTimer = null; } } catch {}
				};
			}, []);

			// ③(新) web 壁纸选项加载：当前是自定义目录的 web 壁纸（mpkgKey=custom|NAME）
			// → 读该文件夹的 loadJson.json（L2D 类壁纸的 SettingModel），把可改项
			// （分辨率/语言/音量）暴露到设置页（同 mpkg 可调参数位置）。非 L2D 结构静默跳过。
			react.useEffect(() => {
				let dead = false;
				setWebCfg(null);
				if (section.converted !== "web" || !section.mpkgKey || section.mpkgKey.indexOf("custom|") !== 0) return;
				const name = section.mpkgKey.slice("custom|".length);
				const url = HOST_BASE + "/custom-folder/" + encodeURIComponent(name) + "/loadJson.json";
				fetch(url).then((r) => (r.ok ? r.json() : null)).then((d) => {
					if (dead || !d || !d.SettingModel) { setWebCfg(null); return; }
					const langs = d.AnimationsTexts ? Object.keys(d.AnimationsTexts) : [];
					// ①(修正) 缓存完整 loadJson（含 EventInfos/AnimationsTexts），
					// applyWebCfg 写 localStorage 时补全——星野这类壁纸读 localStorage 后
					// 会整体使用 H（含这些字段），缺字段可能导致内部逻辑异常/设置不生效。
					// ①(修正2) 第8项：从 iframe localStorage **读回已保存的 SettingModel**。
					// 原逻辑只从 loadJson 默认值初始化——用户改过 showTouch/showTalkDialog
					// 等选项后关闭设置再打开，UI 又显示默认值，与 iframe 实际生效值不同步
					// （用户实测：改文本框开关 → 关设置 → 重开，开关状态回弹）。
					try {
						const frame = bgElements().frame;
						const ls = frame && frame.contentWindow && frame.contentWindow.localStorage;
						if (ls) {
							const skelKey = (d.SettingModel && d.SettingModel.skel) || "setting";
							const raw = ls.getItem(skelKey);
							if (raw) {
								// ①(Qoder 审查) JSON.parse 单独保护：损坏的 localStorage
								// 只丢弃读回（回退 loadJson 默认值），不影响后续 setWebCfg。
								let stored = null;
								try { stored = JSON.parse(raw); } catch { stored = null; }
								if (stored && stored.SettingModel) {
									d.SettingModel = Object.assign({}, d.SettingModel, stored.SettingModel);
								}
							}
						}
					} catch {}
					setWebCfg({ skel: d.SettingModel.skel || "", model: d.SettingModel, languages: langs, customUrl: url, name, raw: d });
				}).catch(() => { if (!dead) setWebCfg(null); });
				return () => { dead = true; };
			}, [section.converted, section.mpkgKey]);

			// ⑳(修正) Tab 下划线平滑移动：测量激活 tab 位置/宽度 → indicator 平移过去
			react.useEffect(() => {
				try {
					const bar = document.querySelector('[data-mpw-tabbar]');
					const active = bar && bar.querySelector(".mpw_tabActive");
					// ①(修正) 下划线改由激活 tab 自身 ::after 绘制（绝对定位指示条横向滚动会错位）。
					// 这里只把激活 tab 滚动进可见区（横向滚动 tab 栏时自动对准）。
					if (bar && active) {
						try { active.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" }); } catch {}
					}
				} catch {}
			}, [settingsTab]);

			// ⑳(新) 壁纸设置 tab 激活时探测 ffmpeg 状态（null=未查 → 进 tab 自动刷一次）
			react.useEffect(() => {
				if (settingsTab === "wallpaper") checkFfmpeg();
			}, [settingsTab]);

			// ④ 总开关：开启时若有冲突 → 弹窗确认
			const onMaster = (v) => {
				if (v && conflicts.length && !section.forceEnabled) {
					setConflictModal(true);
					return;
				}
				commit({ enabled: v }, true);
			};
			const confirmEnable = () => {
				setConflictModal(false);
				commit({ enabled: true, forceEnabled: true }, true);
				setConflicts(detectConflicts());
			};

			// ①(修复 2026-09-13 卡顿/开关跳变) 开关类改动**先出动画、再做重活**：
			//   applyFromStorage() 会重建整张 CSS + 重新取色/挂壁纸（几十 ms 主线程占用），
			//   同步执行会把 React 提交和开关圆点的动画一起卡掉（用户实测"开关一下跳过去"）。
			//   这里用 rAF + setTimeout(0) 把重活挪到下一帧之后；同一帧内多次 commit 合并成一次。
			let pendingApplyRaf = 0, pendingApplyTimer = 0;
			const scheduleApply = () => {
				try {
					if (pendingApplyRaf || pendingApplyTimer) return;
					const run = () => {
						pendingApplyTimer = setTimeout(() => {
							pendingApplyTimer = 0;
							try { applyFromStorage(); } catch (e) { mpwErr("applyFromStorage(面板 scheduleApply)", e); }
						}, 0);
					};
					if (typeof requestAnimationFrame === "function") pendingApplyRaf = requestAnimationFrame(() => { pendingApplyRaf = 0; run(); });
					else run();
				} catch { try { applyFromStorage(); } catch {} }
			};
			const commit = (patch, instant, deferApply) => {
				const next = Object.assign({}, readSection(), patch);
				writeSection(next, instant);
				setSection(next);
				// ①(2026-09-17 持久化轮) 用户又动了一次壁纸 ⇒ 上一次的持久化失败告警已过期，清掉面板那一行。
				//    ⚠️ 这里**不**直接 mpwClearPersistFail()：那会把含 1.4MB dataURL 的内存快照 setItem 回去，
				//    真机上正好撞 localStorage 配额（QuotaExceededError）。留痕交给本次落盘的结果：
				//    成功时 mpwPersistSection 内部会清，失败时会更新留痕。
				try { if (persistFailSeen) { persistFailSeen = false; setPersistWarn(""); } } catch {}
				if (deferApply) scheduleApply();
				else applyFromStorage();
				return next;
			};
			// ①(批次15 前置修复·P0) 组件→工厂桥：applySceneViaRenderer 等工厂层函数需要组件内的
			//   commit/setHint/setMpkgMeta/hideBusy/t（词法不可见，此前直接引用 = ReferenceError，
			//   场景壁纸全部静默回退静态帧——批次 15 定案）。每次渲染刷新闭包，面板关闭后桥
			//   残留指向旧 setter（调用被 catch 吞掉，React 18 对已卸载 setState 为 no-op）。
			try { __mpwSceneUiBridge = { commit: commit, setHint: setHint, setMpkgMeta: setMpkgMeta, hideBusy: hideBusy, t: t }; } catch (e) {}
			// ⑳(新) 保存解码帧率上限到 section.fpsCap（持久化走 /settings）；改的同时刷新 ffmpeg 状态
			const setFpsCap = (v) => { commit({ fpsCap: v }, true); checkFfmpeg(); };
			// ①(新) 保存分辨率上限到 section.resMax（持久化走 /settings）；改完重放当前视频
			const setResMax = (v) => { commit({ resMax: v }, true); try { applyFromStorage(); } catch {} };
			// ⑲(新) 内置取色盘（自绘 HSV，无外部依赖/无加载副作用）：
			// 曾内联 vanilla-picker，但其 UMD 在模块加载时立即操作 DOM 且覆盖 module.exports，
			// 导致 dsh 加载插件崩溃（cannot get property "onChange" without inject）——已改为
			// 点击时创建 DOM 的自绘取色器（色相条 + 饱和/亮度面板 + hex 输入）。
			let pickerInst = null;
			let pickerInstCleanup = null;
			const openPicker = (key, currentColor) => {
				try {
					if (pickerInst) {
				// ①(修复) 先清理旧实例的全局监听（mousemove/mouseup/outside）再移除 DOM，
				// 否则旧闭包监听持续累积、误关新取色器
				try { if (typeof pickerInstCleanup === "function") pickerInstCleanup(); } catch {}
				try { pickerInst.remove(); } catch {}
				pickerInst = null; pickerInstCleanup = null;
			}
					const parent = document.querySelector('[data-mpw-picker-anchor="' + key + '"]');
					if (!parent) return;
					const start = currentColor && /^#[0-9a-fA-F]{6}$/.test(currentColor) ? currentColor : "#808080";
					let h = 0, s = 0.5, v = 0.5, drag = null;
					const hexToHsv = (hex) => {
						const n = parseInt(hex.slice(1), 16);
						const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, bl = (n & 255) / 255;
						const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl), dlt = mx - mn;
						let hh = 0;
						if (dlt !== 0) {
							if (mx === r) hh = ((g - bl) / dlt) % 6;
							else if (mx === g) hh = (bl - r) / dlt + 2;
							else hh = (r - g) / dlt + 4;
							hh *= 60; if (hh < 0) hh += 360;
						}
						return { h: hh, s: mx === 0 ? 0 : dlt / mx, v: mx };
					};
					const hsvToHex = (hh, ss, vv) => {
						const c = vv * ss, x = c * (1 - Math.abs(((hh / 60) % 2) - 1)), m = vv - c;
						let r = 0, g = 0, bl = 0;
						if (hh < 60) { r = c; g = x; } else if (hh < 120) { r = x; g = c; } else if (hh < 180) { g = c; bl = x; }
						else if (hh < 240) { g = x; bl = c; } else if (hh < 300) { r = x; bl = c; } else { r = c; bl = x; }
						const to = (q) => Math.round((q + m) * 255).toString(16).padStart(2, "0");
						return "#" + to(r) + to(g) + to(bl);
					};
					const { h: ih, s: is, v: iv } = hexToHsv(start);
					h = ih; s = is; v = iv;
					const wrap = document.createElement("div");
					wrap.className = "mpw_pickerWrap";
					wrap.style.cssText = "position:fixed;z-index:4000;background:var(--dsw-static-neutral-bluish-00,#fff);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:10px;box-shadow:0 12px 40px rgba(0,0,0,.35);width:224px;font-family:var(--dsw-font-family);";
					// 色相条
					const hueBar = document.createElement("div");
					hueBar.style.cssText = "height:14px;border-radius:7px;background:linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00);cursor:pointer;position:relative;";
					const hueKnob = document.createElement("div");
					hueKnob.style.cssText = "position:absolute;top:-3px;width:8px;height:20px;border-radius:4px;border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,.5);pointer-events:none;";
					hueBar.appendChild(hueKnob);
					// SV 面板
					const svPanel = document.createElement("div");
					svPanel.style.cssText = "height:120px;border-radius:8px;cursor:pointer;position:relative;margin-top:8px;";
					const svKnob = document.createElement("div");
					svKnob.style.cssText = "position:absolute;width:12px;height:12px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 4px rgba(0,0,0,.5);pointer-events:none;transform:translate(-50%,-50%);";
					svPanel.appendChild(svKnob);
					// hex 输入 + 预览 + 确定
					const bottom = document.createElement("div");
					bottom.style.cssText = "display:flex;gap:6px;align-items:center;margin-top:8px;";
					const preview = document.createElement("div");
					preview.style.cssText = "width:26px;height:26px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2);";
					const hexInput = document.createElement("input");
					hexInput.style.cssText = "flex:1;min-width:0;height:28px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:0 8px;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;outline:none;";
					hexInput.addEventListener("focus", () => { hexInput.style.borderColor = "var(--dsw-alias-label-primary)"; hexInput.style.boxShadow = "0 0 0 1px var(--dsw-alias-label-primary)"; });
					hexInput.addEventListener("blur", () => { hexInput.style.borderColor = "var(--dsw-alias-border-l2)"; hexInput.style.boxShadow = "none"; });
					hexInput.value = start;
					const okBtn = document.createElement("button");
					okBtn.textContent = t("default") === "默认" ? "确定" : "OK";
					okBtn.style.cssText = "height:28px;padding:0 12px;border:none;border-radius:6px;background:#3964fe;color:#fff;font:inherit;font-size:12px;cursor:pointer;";
					bottom.appendChild(preview); bottom.appendChild(hexInput); bottom.appendChild(okBtn);
					wrap.appendChild(hueBar); wrap.appendChild(svPanel); wrap.appendChild(bottom);
					document.body.appendChild(wrap);
					const refresh = () => {
						svPanel.style.background = "linear-gradient(180deg, #fff 0%, hsl(" + h + ",100%,50%) 50%, #000 100%)";
						const cur = hsvToHex(h, s, v);
						preview.style.background = cur;
						hexInput.value = cur;
						hueKnob.style.left = (h / 360 * 100) + "%";
						svKnob.style.left = (s * 100) + "%";
						svKnob.style.top = ((1 - v) * 100) + "%";
					};
					const setFromInput = () => {
						const val = hexInput.value.trim();
						if (/^#[0-9a-fA-F]{6}$/.test(val)) { const c = hexToHsv(val); h = c.h; s = c.s; v = c.v; refresh(); }
					};
					hexInput.addEventListener("change", setFromInput);
					const pickPos = (e, el, vertical) => {
						const r = el.getBoundingClientRect();
						let p = (vertical ? e.clientY - r.top : e.clientX - r.left) / (vertical ? r.height : r.width);
						p = Math.max(0, Math.min(1, p));
						return p;
					};
					hueBar.addEventListener("mousedown", (e) => { drag = "hue"; h = pickPos(e, hueBar, false) * 360; refresh(); });
					svPanel.addEventListener("mousedown", (e) => { drag = "sv"; s = pickPos(e, svPanel, false); v = 1 - pickPos(e, svPanel, true); refresh(); });
					// ①(修正) 这些 window 监听若只在 close 时 wrap.remove() 从不移除，反复开取色器
					// 会泄漏 2 个 window 监听（每处 close 一次多挂 2 个 → 占内存+响应堆积）。
					// 用命名函数 + 统一 closePicker，close/OK/外部点击都彻底移除并解引用。
					const onMove = (e) => {
						if (drag === "hue") { h = pickPos(e, hueBar, false) * 360; refresh(); }
						else if (drag === "sv") { s = pickPos(e, svPanel, false); v = 1 - pickPos(e, svPanel, true); refresh(); }
					};
					const onUp = () => { drag = null; };
					window.addEventListener("mousemove", onMove);
					window.addEventListener("mouseup", onUp);
					const closePicker = () => {
						try {
							window.removeEventListener("mousemove", onMove);
							window.removeEventListener("mouseup", onUp);
							document.removeEventListener("mousedown", outside);
						} catch {}
						try { wrap.remove(); } catch {}
						pickerInst = null;
					};
					okBtn.addEventListener("click", () => { commit({ [key]: hexInput.value.trim() }, true); closePicker(); });
					// 定位在色块附近（①(修正) 上下都要防溢出：色块在屏幕底部时向上显示，
					// 否则取色器（含底部色号输入框）会被屏幕下边缘切掉——用户实测）。
					const pr = parent.getBoundingClientRect();
					// 估算取色器高度（hue 条 26 + SV 面板 120 + margin + 底部 28 ≈ 190）
					const wrapH = 26 + 8 + 120 + 8 + 28 + 8;
					wrap.style.left = Math.max(8, Math.min(window.innerWidth - 240, pr.right + 8)) + "px";
					let top = pr.top - 10;
					if (pr.top + wrapH > (window.innerHeight || 600) - 8) {
						// 下方放不下 → 向上显示（色块上方）
						top = Math.max(8, pr.top - wrapH - 6);
					}
					wrap.style.top = top + "px";
					refresh();
					pickerInst = wrap;
					// ①(修复) 记录可执行清理：closePicker 同款（移除 DOM + 解绑全局监听）
					pickerInstCleanup = closePicker; // ①(修复) 复用统一清理（含全局监听解绑）
					// 点击外部关闭（用统一 closePicker 彻底移除 window 监听）
					const outside = (e) => { if (!wrap.contains(e.target) && e.target !== parent) closePicker(); };
					setTimeout(() => document.addEventListener("mousedown", outside), 0);
				} catch {}
			};
			// ④(新) 扫描本地壁纸库（Steam 自动发现，host 提供）
			const scanLibrary = async () => {
				if (!hostOk) { showError(t("lib.noHost")); return; }
				setLibBusy(true);
				try {
					const r = await fetch(HOST_BASE + "/steam-inventory");
					const d = await r.json();
					const walls = d.ok && d.wallpapers ? d.wallpapers : [];
					setLibWalls(walls);
					if (d.ok && !d.installDir) showError(t("lib.noInstall"));
					// ⑳(新) WE 原生播放列表 → 首次自动导入为轮播列表（rotSeeded 防止删除后再播种）
					try {
						const pls = (d.playlists || []).filter((p) => p && Array.isArray(p.keys) && p.keys.length);
						const cur = readSection();
						if (pls.length && !(cur.rotGroups || []).length && !cur.rotSeeded) {
							const seed = pls[0];
							const gid = "we" + Date.now();
							commit({ rotGroups: [{ id: gid, name: seed.name || t("rot.wePlaylist"), interval: seed.interval || 5, order: seed.order === "random" ? "random" : "sequence", keys: seed.keys }], rotGroupId: gid, rotSeeded: true }, true);
							setHint(t("rot.seeded") + "：" + (seed.name || ""));
						} else if (!pls.length && !cur.rotSeeded) {
							commit({ rotSeeded: true }, true);
						}
					} catch {}
					// ②(新) Steam 库合并进统一列表（轮播/上下切换可用）：
					// 并入 video（mp4 播放）+ web（iframe）+ scene（预览图/后续静态帧），
					// 用 src:"steam" 标记，next/prev 走 applyLibraryWallpaper。
					const steamPlayable = walls.filter((wp) => (wp.type === "video" && wp.media) || wp.type === "web" || wp.type === "scene");
					if (steamPlayable.length) {
						setWallList((prev) => {
							const merged = steamPlayable.map((wp) => ({
								key: "steam|" + wp.ltoken, title: wp.title || wp.ltoken,
								name: wp.title || wp.ltoken, type: wp.type, src: "steam",
								ltoken: wp.ltoken, media: wp.media, preview: wp.preview || null
							}));
							const existing = prev || [];
							const keys = new Set(existing.map((w) => w.key));
							return existing.concat(merged.filter((w) => !keys.has(w.key)));
						});
						setHint(t("lib.rotMerged") + steamPlayable.length);
					}
				} catch (err) { showError(t("lib.fail") + String(err && err.message || err)); }
				setLibBusy(false);
			};
			// ①(新) 检测更新（对比实际代码内容哈希，README 变更不触发）
			const checkUpdate = async () => {
				// ①(修正) 并发守卫：正在检测/应用时忽略重复调用（自动检测 800ms 与手动点击可能重叠）
				try { if (updState && (updState.checking || updState.applying)) return; } catch {}
				setUpdState({ checking: true });
				// ①(修正) 实时刷新当前版本（像插件市场那样打开即读最新安装版本）
				try {
					const p = await fetch(HOST_BASE + "/ping", { method: "GET" });
					if (p.ok) { const pd = await p.json(); if (pd && pd.version) setHostVersion(pd.version); }
				} catch {}
				try {
					const r = await fetch(HOST_BASE + "/update-check");
					const d = await r.json();
					setUpdState(d.ok ? d : { error: String(d.error || "fail") });
				} catch (err) { setUpdState({ error: String(err && err.message || err) }); }
			};
			// ①(新) 一键热更新（host 从 GitHub 下载最新代码写回；仅限本地开发/可写安装）
			const applyUpdate = async () => {
				setUpdState({ applying: true });
				try {
					const r = await fetch(HOST_BASE + "/update-apply", { method: "POST" });
					const d = await r.json();
					// ①(修正) 市场安装（pnpm store 只读）→ host 返回 readonly → 提示走市场更新
					if (d && d.readonly) {
						setUpdState({ error: t("update.readonly") });
						return;
					}
					setUpdState(d.ok ? { applied: true } : { error: String(d.error || "fail") });
				} catch (err) { setUpdState({ error: String(err && err.message || err) }); }
			};
			// ①(新) 目录选择器：打开并列出指定路径的子目录（跨平台，host 浏览）
			// ①(第13条 根因修复) **不再**在这里读列表 DOM 记锚点/比例：滚动位置由列表容器自己
			//   按路径记忆（MpwDirList → useMpwListScroll）。这里只负责"切换路径 + 取数据"。
			const openDirPicker = async (path) => {
				setDirPick(true); // ⑦(修正) 打开弹窗（之前漏了这行导致"浏览"无反应）
				setDirPath(path || "/");
				try {
					// 空路径 → host 返回主目录（home）；显示用 "/" 兜底，实际路径由 host 规范化
					const r = await fetch(HOST_BASE + "/list-dirs?path=" + encodeURIComponent(path || ""));
					const d = await r.json();
					setDirSubs(d.ok && d.subdirs ? d.subdirs : []);
					// ①(修正) 用 host 规范化的实际路径更新 dirPath（空/相对路径 → 绝对），
					// 否则进子目录会拼出相对路径 → 列表空/上级错乱（用户实测浏览功能坏）
					if (d.ok && d.dir) setDirPath(d.dir);
					if (d.ok && d.home) setDirHome(d.home);
					if (d.ok && d.platform) setDirPlatform(d.platform);
				} catch { setDirSubs([]); }
			};
			// ①(第13条 删除) 旧实现（已整段移除，勿回退）：
			//   ① openDirPicker 里遍历 .mpw_prop 记录 { anchorIdx, anchorOff }；
			//   ② 依赖 [dirPick, dirSubs, dirPath] 的 effect 里 rAF×2 后 `el.scrollTop += …`（锚点补偿）
			//      或按 ratio 恢复 —— 其中 `dirScrollRef.current.ratio` **从未被赋值**，所以
			//      `if (ratio === void 0 || ratio === null) return;` 恒真 ⇒ 补偿/恢复**一次都没跑过**；
			//   ③ 用户滚动时间戳（wheel/touchmove/scroll → 600ms 让位）与"同路径只恢复一次"两个时间窗。
			//   这套组合既没修好跳顶（因为主路是死代码），又会在偶发执行时与用户滚动打架。
			//   回归断言：tools/dir-picker-test.mjs A 组（源码级）+ B 组（假 DOM 行为）。
			// ①(新) 扫描自定义本地壁纸目录（任意文件夹，host 只读媒体文件）
			// ①(修正) 接受可选 dir 参数：目录选择器「选择此文件夹」时 state 尚未刷新，
			// 直接用传入值（否则 setCustomDirState 异步 → scanCustomDir 读到旧空值 → 误报"先输入路径"）
			const scanCustomDir = async (dirArg) => {
				const dir = (dirArg !== void 0 ? dirArg : customDir).trim();
				if (!dir) { showError(t("lib.dirEmpty")); return; }
				setLibBusy(true);
				try {
					const r = await fetch(HOST_BASE + "/custom-dir", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dir }) });
					const d = await r.json();
					if (!d.ok) {
						showError(t("lib.dirFail") + String(d.error || ""));
						// ①(修正) 失败也清空列表，避免显示上一个目录的旧壁纸（用户实测）
						setCustomFiles([]); setWallList([]);
					}
					else {
						setCustomFiles(d.files || []);
						// ①(新) 合并进统一列表：自定义目录文件（图片+视频）+ workshop 原始子文件夹
						// （video → mp4 播放；web → iframe；scene → 预览图/后续静态帧）
						setWallList((prev) => {
							// ①(修正) 自定义目录改为**合并**进列表（不再替换——用户误扫自定义目录后
							// 切不回 Steam 库的问题；现在两个来源共存，去重）
							const fresh = (d.files || []).map((f) => {
							if (f.folder) {
								// ①(修正) 子文件夹里的 .mpkg（wallpaperE 角色收藏夹）：独立成条
								if (f.folderMpkg && f.type === "mpkg") {
									return {
										key: "custom|" + f.name + "/" + f.media, title: f.title || f.media, name: f.name,
										type: "mpkg", folder: true, folderMpkg: true, folderName: f.name, mpkgFile: f.media,
										image: "host:?custom=1&folder=" + encodeURIComponent(f.name) + "&file=" + encodeURIComponent(f.media),
										converted: "mp4"
									};
								}
								if (f.type === "web") {
									const pv = f.preview || "preview.jpg";
									return {
										key: "custom|" + f.name, title: f.title || f.name, name: f.name,
										type: "web", folder: true, media: f.media || "index.html",
										webHeavy: !!f.webHeavy, webExternal: !!f.webExternal,
										image: "host:?custom=1&folder=" + encodeURIComponent(f.name) + "&file=" + encodeURIComponent(pv),
										webUrl: "host:?custom=1&folder=" + encodeURIComponent(f.name) + "&file=" + encodeURIComponent(f.media || "index.html"),
										converted: "web"
									};
								}
								if (f.type === "video") {
									return {
										key: "custom|" + f.name, title: f.title || f.name, name: f.name,
										type: "video", folder: true, media: f.media,
										image: "host:?custom=1&folder=" + encodeURIComponent(f.name) + "&file=" + encodeURIComponent(f.media),
										converted: "mp4"
									};
								}
								// scene → 静态帧提取（scene.pkg 主纹理高清图；失败 host 回退预览）
								const pv = f.preview || "preview.jpg";
								return {
									key: "custom|" + f.name, title: f.title || f.name, name: f.name,
									type: "scene", folder: true, media: f.media || "scene.pkg", preview: pv,
									image: "host:?custom=1&folder=" + encodeURIComponent(f.name) + "&scene=1",
									converted: "gif"
								};
							}
							return {
								key: "custom|" + f.name, title: f.name, name: f.name, type: f.type,
								image: "host:?custom=1&file=" + encodeURIComponent(f.name),
								converted: f.type === "video" ? "mp4" : (f.type === "mpkg" ? "mp4" : "gif")
							};
						});
							// ②(修正) 重新扫描**替换**旧的自定义目录项（custom|*），只保留
							// 其他来源（steam|* 等）——原来新项拼在旧项后面，切目录后
							// 新旧列表叠在一起（用户实测：显示"发现 3 个媒体文件"但下面
							// 全是上次扫描的旧内容，且旧项点使用无效）。
							const prev2 = prev || [];
							const freshKeys = new Set(fresh.map((w) => w.key));
							const kept = prev2.filter((w) => !/^custom\|/.test(w.key || "") || freshKeys.has(w.key));
							return fresh.concat(kept.filter((w) => !freshKeys.has(w.key)));
						});
					}
				} catch (err) {
					showError(t("lib.fail") + String(err && err.message || err));
					// ①(修正) 请求异常也清空列表（防旧数据误导）
					setCustomFiles([]); setWallList([]);
				}
				setLibBusy(false);
			};
			// ⑥(新) 应用自定义目录里的 .mpkg（host 解析选素材后流式播放）
			const applyCustomMpkg = async (w) => {
				setLibBusy(true);
				try {
					// ①(修正) folderMpkg：子文件夹里的 .mpkg 走 folder 参数
					const fq = w.folderMpkg
						? "folder=" + encodeURIComponent(w.folderName || w.name) + "&file=" + encodeURIComponent(w.mpkgFile || w.name)
						: "file=" + encodeURIComponent(w.name);
					const r = await fetch(HOST_BASE + "/custom-mpkg?" + fq);
					const d = await r.json();
					const display = w.title || w.name;
					if (!d.ok || !d.selected) { showError(t("mpkg.noAsset") + "（" + display + "）"); setLibBusy(false); return; }
					// ①(RE-25) 场景束（PKGM0018，容器内 scene.json 平铺）→ 直接交渲染器实时渲染
					try {
						const hasSceneJson = (d.entries || []).some((e) => /(^|\/)scene\.json$/i.test(e.name));
						if (hasSceneJson) {
							const okScene = applySceneViaRenderer({
								rawFile: w.folderMpkg ? (w.mpkgFile || w.name) : w.name,
								folder: w.folderMpkg ? (w.folderName || w.name) : "",
								title: display, key: w.key,
							});
							setLibBusy(false);
							if (okScene) return;
						}
					} catch (e) {}
					// ①(新) 时间变化壁纸（多时段视频纹理）：接入自动切换——
					// host 返回全部条目，客户端构建 fetch 版 readEntry 走 handleVideoTexes
					// （解析 project.json 时间属性 → timeVideos/timeConfig → 60s 定时自动换时段）
					const vtex = (d.entries || []).filter((e) => /\.tex$/i.test(e.name) && e.size >= 1024 * 1024
						// ①(修正) 与纯浏览器路径同语义：排除抠像层（蓝幕/绿幕/透明人物）与
						// 入场动画（入场/开场/intro/entry animation）——否则入场动画 tex
						// 会被当成当前素材反复播放（用户实测：夜莺Night-Castorice 壁纸
						// 一直在播「入场动画2_batch.tex」）
						&& !/蓝幕|绿幕|bluescreen|greenscreen|chroma|keying|抠像/i.test(e.name)
						&& !/入场|开场|intro|entry\s*animation|entryanimation/i.test(e.name));
					if (vtex.length) {
						try {
							const readEntry = async (entry, len, off) => {
								const url = HOST_BASE + "/media?token=" + encodeURIComponent(d.token) + "&index=" + entry.index;
								const headers = {};
								if (len !== void 0) {
									const s = off || 0;
									headers["Range"] = "bytes=" + s + "-" + (s + len - 1);
								}
								const rr = await fetch(url, { headers });
								if (!rr.ok) throw new Error("media " + rr.status);
								return new Uint8Array(await rr.arrayBuffer());
							};
							const ok = await handleVideoTexes({ entries: d.entries }, vtex, { name: display, size: 0 }, t, showError, readEntry, null, setHint, { kind: "host", token: d.token });
							if (ok === "stale") { try { console.warn("[dsh-mpkg-wallpaper] 时段导入已过期(壁纸已切换)，跳过"); } catch {}; if (typeof setLibBusy === "function") { try { setLibBusy(false); } catch {} } return; }
							if (ok) { setLibBusy(false); return; }
						} catch (err) {
							console.warn("[dsh-mpkg-wallpaper] 时间变化提取失败，回退单素材:", err);
						}
					}
					const sel = d.selected;
					commit({
						image: "host:?token=" + encodeURIComponent(d.token) + "&index=" + sel.index + (sel.offset ? "&offset=" + sel.offset : ""),
						source: sel.name, mpkgKey: "custommpkg|" + (w.folderMpkg ? w.folderName + "/" + w.mpkgFile : w.name), mpkgName: display,
						fromMpkg: true, converted: sel.isMp4 ? "mp4" : "gif", slot: null,
						info: undefined, timeVideos: undefined, timeConfig: undefined, activeSlot: null,
						webUrl: undefined, sceneKey: undefined
					}, true);
					setMpkgMeta({ name: display, key: "custommpkg|" + (w.folderMpkg ? w.folderName + "/" + w.mpkgFile : w.name), info: null, entryName: sel.name, slot: null });
					setHint(t("lib.applied") + "：" + display);
					if (!sel.isMp4) { setPreviewModal(true); }
				} catch (err) { showError(t("lib.fail") + String(err && err.message || err)); }
				setLibBusy(false);
			};
			// ②(新) 应用列表中的某个壁纸（统一入口）
			const applyWallFromList = (w) => {
				// ①(修正) 全路径 try/catch：点击处理抛错会导致按钮卡在按下态（用户实测）。
				try {
					if (w.type === "mpkg") { applyCustomMpkg(w); return; }
					// ②(新) Steam 库项 → 走 applyLibraryWallpaper（video/web/scene 全类型）
					if (w.src === "steam") {
						applyLibraryWallpaper(w);
						return;
					}
					// ①(新) 自定义目录 workshop 子文件夹：网页壁纸 → iframe；场景 → 静态帧
					if (w.type === "web" && w.folder) { applyCustomWeb(w); return; }
					if (w.type === "scene" && w.folder) { applyCustomScenePreview(w); return; }
					commit({
						image: w.image, source: w.title, mpkgKey: w.key, mpkgName: w.title,
						fromMpkg: false, converted: w.converted, slot: null,
						info: undefined, timeVideos: undefined, timeConfig: undefined, activeSlot: null,
						webUrl: undefined, sceneKey: undefined
					}, true);
					setMpkgMeta({ name: w.title, key: w.key, info: null, entryName: w.title, slot: null });
					setHint(t("lib.applied") + "：" + w.title);
					return w;
				} catch (err) { console.error("[dsh-mpkg-wallpaper] 应用壁纸失败:", err); showError(t("lib.fail") + String(err && err.message || err)); }
			};
			// ①(新) 应用自定义目录里的网页壁纸（iframe 全屏）
			// ①(2026-09-16 I 项) mode: "shim"（默认，宿主注入 WE shim + 不透明源沙箱）/
			//   "compat"（同源兼容模式，等价于改动前的裸 iframe：Live2D 设置面板需要它）
			const applyCustomWeb = (w) => {
				// ①(修正) 网页壁纸实验性：先确认（部分壁纸卡顿/加载失败，用户实测）
				setWebConfirm({ title: w.title, name: w.name, media: w.media || "index.html", src: "custom", webHeavy: !!w.webHeavy, webExternal: !!w.webExternal });
			};
			// ③(新) 修改 web 壁纸选项（分辨率/语言/音量）：L2D 类壁纸把设置存 iframe
			// 同源 localStorage（key = skel 名），改完 reload iframe 生效。
			// ①(修正) opts.live=true（音量滑块）：只写 localStorage + 实时改音量，
			// 不重载 iframe —— 原来每拖一格就整页重载（重壁纸卡顿，评审指出）。
			const applyWebCfg = (patch, live) => {
				try {
					if (!webCfg) return;
					const frame = bgElements().frame;
					// ①(2026-09-16 I 项) 沙箱模式（不透明源）：帧内 localStorage 不可达（浏览器 SecurityError）。
					//   给出可操作提示，而不是抛一个看不懂的异常。
					if (frame && mpwWebShimUrl(frame.getAttribute("src"))) {
						showError(t("webcfg.sandboxHint"));
						return;
					}
					if (!frame || !frame.contentWindow || !frame.contentWindow.localStorage) {
						showError(t("webcfg.noFrame"));
						return;
					}
					const ls = frame.contentWindow.localStorage;
					const skelKey = webCfg.skel || "setting";
					// 已有存储 → 合并；无 → 从 loadJson.json 初始化
					let stored = null;
					try { const raw = ls.getItem(skelKey); if (raw) stored = JSON.parse(raw); } catch {}
					const base = stored && stored.SettingModel ? stored.SettingModel : webCfg.model;
					const merged = Object.assign({}, base, patch);
					// ①(修正) 写回时补全 EventInfos/AnimationsTexts（星野这类壁纸读 localStorage
					// 后整体使用 H；缺字段会让内部对象不完整）。stored 已含则保留，否则用 loadJson.
					const filler = webCfg.raw || {};
					const next = Object.assign({}, stored || {}, {
						SettingModel: merged,
						EventInfos: (stored && stored.EventInfos) || filler.EventInfos,
						AnimationsTexts: (stored && stored.AnimationsTexts) || filler.AnimationsTexts
					});
					try { ls.setItem(skelKey, JSON.stringify(next)); } catch (e) {
						showError(t("webcfg.saveFail") + String(e && e.message || e));
						return;
					}
					setWebCfg(Object.assign({}, webCfg, { model: merged }));
					if (live) {
						// 实时音量：直接改 iframe 内 audio 元素（不重载）
						try {
							const doc = frame.contentDocument;
							if (doc) {
								const auds = doc.querySelectorAll("audio, video");
								for (let i = 0; i < auds.length; i++) {
									if (patch.bgmVolume !== void 0 && /bgm/i.test(auds[i].id || "")) auds[i].volume = patch.bgmVolume;
									else if (patch.talkVolume !== void 0 && /talk|voice/i.test(auds[i].id || "")) auds[i].volume = patch.talkVolume;
								}
							}
						} catch {}
						setHint(t("webcfg.applied"));
						return;
					}
					// reload iframe（换 URL 触发重载，走 showWebEl 应用静音/倍速/隐藏面板）
					try {
						const u = resolveHostUrl(section.webUrl);
						showWebEl(bustUrl(u));
					} catch {}
					setHint(t("webcfg.applied"));
				} catch (err) { console.warn("[dsh-mpkg-wallpaper] 应用 web 壁纸选项失败:", err); showError(t("webcfg.fail") + String(err && err.message || err)); }
			};
			const applyCustomWebReal = (name, media, mode) => {
				try {
					// ①(修正) 切换新 web 壁纸前，先彻底断开旧 iframe 上的 observer
					//（webMediaObserve / hideWebPanel 的 MutationObserver）——否则旧壁纸的
					// observer 残留，反复导入 web 壁纸会累积监听器/内存泄漏（用户实测：
					// 导入星野后清除，再导其他壁纸导不进，疑似内存爆）。
					try { disposeWebFrame(bgElements().frame); } catch {}
					commit({
						webUrl: "host:?custom=1&folder=" + encodeURIComponent(name) + "&file=" + encodeURIComponent(media || "index.html")
							+ (mode === "compat" ? "" : "&shim=1"),   // ①(2026-09-16 I 项) 默认走 shim 通道
						source: name, mpkgKey: "custom|" + name, mpkgName: name,
						fromMpkg: false, converted: "web", slot: null,
						info: undefined, timeVideos: undefined, timeConfig: undefined, activeSlot: null,
						image: undefined
					}, true);
					setMpkgMeta({ name: name, key: "custom|" + name, info: null, entryName: media || "index.html", slot: null });
					setHint(t("lib.applied") + "：" + name);
					mpwWebDiag("mount", { key: "custom|" + name, entry: String(media || "index.html").slice(0, 120), mode: mode === "compat" ? "compat" : "shim" });
				} catch (err) { console.error("[dsh-mpkg-wallpaper] 应用网页壁纸失败:", err); showError(t("lib.fail") + String(err && err.message || err)); }
			};
			// ①(新) 应用自定义目录里的场景壁纸 → 静态帧提取（scene.pkg 主纹理；host 失败回退预览图）
			const applyCustomScenePreview = (w) => {
				try {
					try { if (typeof showSceneBusy === "function") showSceneBusy(t("scene.probing")); } catch {}
					// ①(RE-25) 目录里有 scene.pkg / *.mpkg 就先交给渲染器实时渲染（最接近官方观感）
					try {
						const cand = (w.media && /\.(pkg|mpkg)$/i.test(w.media)) ? w.media
							: ((w.files || []).find((f) => /\.(mpkg|pkg)$/i.test(f)) || "");
						if (cand) {
							const okR = applySceneViaRenderer({ rawFile: cand, folder: w.name, title: w.title, key: w.key });
							if (okR) { try { if (typeof hideBusy === "function") hideBusy() } catch {} return; }
						}
					} catch (e) {}
					const key = "custom|" + w.name;
					const staticImg = "host:?custom=1&folder=" + encodeURIComponent(w.name) + "&scene=1";
					// ①(新) scene-video 快路径优先：内嵌 MP4 → video 硬件解码（最顺滑）
					applySceneWallpaper({
						key, image: staticImg, source: w.title, mpkgKey: w.key,
						// ①(修正) applyVideo：有内嵌视频 → converted:"mp4" + sv=1（组件内持有 commit）
						applyVideo: (k2, img2, src2) => {
							try {
								const svImg = img2 + "&sv=1";
								commit({
									image: svImg, source: src2, mpkgKey: w.key, mpkgName: src2,
									fromMpkg: false, converted: "mp4", sceneKey: undefined, slot: null,
									info: undefined, timeVideos: undefined, timeConfig: undefined, activeSlot: null,
									webUrl: undefined, propEdits: undefined
								}, true);
								setMpkgMeta({ name: src2, key: w.key, info: null, entryName: "scene.pkg", slot: null });
								try { if (typeof hideBusy === "function") hideBusy(); } catch {}
								setHint(t("lib.applied") + "：" + src2);
							} catch (e) { console.error("[dsh-mpkg-wallpaper] scene-video 应用失败:", e); }
						},
						fallback: (k2, img2) => {
							// ①(新) 先试「mpkg 方式」：scene.pkg 与 mpkg 是同一 PKG 容器——
							// 时间变化壁纸（多时段视频纹理）用 mpkg 解析 → 自动切换时段（用户方案）
							(async () => {
								try {
									const r = await fetch(HOST_BASE + "/custom-mpkg?folder=" + encodeURIComponent(w.name) + "&file=scene.pkg");
									const d = await r.json();
									const vtex = (d.entries || []).filter((e) => /\.tex$/i.test(e.name) && e.size >= 1024 * 1024
										// ①(修正) 同 applyCustomMpkg：排除抠像层/入场动画（防止
										// 开场动画 tex 被当作场景壁纸的当前素材）
										&& !/蓝幕|绿幕|bluescreen|greenscreen|chroma|keying|抠像/i.test(e.name)
										&& !/入场|开场|intro|entry\s*animation|entryanimation/i.test(e.name));
									if (d.ok && d.selected && vtex.length) {
										const readEntry = async (entry, len, off) => {
											const url = HOST_BASE + "/media?token=" + encodeURIComponent(d.token) + "&index=" + entry.index;
											const headers = {};
											if (len !== void 0) {
												const s = off || 0;
												headers["Range"] = "bytes=" + s + "-" + (s + len - 1);
											}
											const rr = await fetch(url, { headers });
											if (!rr.ok) throw new Error("media " + rr.status);
											return new Uint8Array(await rr.arrayBuffer());
										};
										// ①(修正) 场景文件夹的 project.json 在容器外：单独抓取（时间属性在这里）
										let projJson = null;
										try {
											const pj = await fetch(HOST_BASE + "/custom-folder/" + encodeURIComponent(w.name) + "/project.json");
											if (pj.ok) projJson = await pj.json();
										} catch {}
										const ok = await handleVideoTexes({ entries: d.entries }, vtex, { name: w.title || w.name, size: 0 }, t, showError, readEntry, projJson, setHint, { kind: "host", token: d.token });
										if (ok === "stale") { try { console.warn("[dsh-mpkg-wallpaper] 时段导入已过期(壁纸已切换)，跳过后续链"); } catch {}; return; }
										if (ok) {
											setMpkgMeta({ name: w.title, key: key, info: null, entryName: "scene.pkg", slot: null });
											try { if (typeof hideBusy === "function") hideBusy(); } catch {}
											setHint(t("lib.applied") + "：" + w.title);
											return;
										}
									}
								} catch (err) { console.warn("[dsh-mpkg-wallpaper] scene.mpkg 方式失败，回退合成:", err); }
								// 回退：图层合成（canvas）→ 静态帧
								try { if (typeof showSceneBusy === "function") showSceneBusy(t("scene.extracting")); } catch {}
								fetchSceneComposite(key).then((man) => {
									commit({
										image: img2, source: w.title, mpkgKey: w.key, mpkgName: w.title,
										fromMpkg: false, converted: "scene", sceneKey: key, slot: null,
										info: undefined, timeVideos: undefined, timeConfig: undefined, activeSlot: null,
										webUrl: undefined
									}, true);
									setMpkgMeta({ name: w.title, key: w.key, info: null, entryName: "scene.pkg", slot: null });
									try { if (typeof hideBusy === "function") hideBusy(); } catch {}
									setHint(t("lib.applied") + "：" + w.title);
								}).catch(() => {
									commit({
										image: img2, source: w.title, mpkgKey: w.key, mpkgName: w.title,
										fromMpkg: false, converted: "gif", sceneKey: undefined, slot: null,
										info: undefined, timeVideos: undefined, timeConfig: undefined, activeSlot: null,
										webUrl: undefined
									}, true);
									setMpkgMeta({ name: w.title, key: w.key, info: null, entryName: "scene.pkg", slot: null });
									try { if (typeof hideBusy === "function") hideBusy(); } catch {}
									setHint(t("lib.applied") + "：" + w.title);
								});
							})();
						},
					});
				} catch (err) { console.error("[dsh-mpkg-wallpaper] 应用场景壁纸失败:", err); showError(t("lib.fail") + String(err && err.message || err)); }
			};
			// ②(新) 切换到下一个壁纸（本地库 + 自定义目录合并列表）
			// ⑳(新) 轮播候选：激活了列表 → 列表内的壁纸；否则全部
			const rotCandidates = () => {
				const all = wallList;
				if (!all.length) return [];
				const gid = section.rotGroupId;
				if (gid) {
					const g = (section.rotGroups || []).find((x) => x.id === gid);
					if (g && (g.keys || []).length) {
						const filtered = all.filter((w) => (g.keys || []).includes(w.key));
						if (filtered.length) return filtered;
					}
				}
				return all;
			};
			const nextWallpaper = () => {
				const list = rotCandidates();
				if (!list.length) { showError(t("lib.empty")); return; }
				let idx = list.findIndex((w) => w.key === (wallList[wallIdx] && wallList[wallIdx].key));
				if (idx < 0) idx = -1;
				idx = (idx + 1) % list.length;
				const target = list[idx];
				setWallIdx(wallList.findIndex((w) => w.key === target.key));
				applyWallFromList(target);
			};
			// 1(新) 切换到上一个壁纸
			const prevWallpaper = () => {
				const list = rotCandidates();
				if (!list.length) { showError(t("lib.empty")); return; }
				let idx = list.findIndex((w) => w.key === (wallList[wallIdx] && wallList[wallIdx].key));
				if (idx < 0) idx = 0;
				idx = (idx - 1 + list.length) % list.length;
				const target = list[idx];
				setWallIdx(wallList.findIndex((w) => w.key === target.key));
				applyWallFromList(target);
			};
			// ③(新) 壁纸轮换：定时自动切换（⑳(新) 随机顺序的列表打乱）
			// ①(修复) interval 只调用 window.__mpwGoNext（每次渲染重建的最新闭包），
			// 不再捕获 render 期的 wallList/wallIdx 快照 —— 否则切换后定时器永用旧基准，
			// 轮换"只切一次后每周期重复同一张"
			const startRotation = () => {
				try { if (window.__mpwRotTimer) clearInterval(window.__mpwRotTimer); } catch {}
				const gid = section.rotGroupId;
				const g = gid ? (section.rotGroups || []).find((x) => x.id === gid) : null;
				// ①(2026-09-17 对抗性审查) **周期必须钳制**：`rotGroups[].interval` 是**用户可导入**的
				//   复合字段（备份 JSON / 宿主 /settings 原样透传、导入端不做数值校验）⇒ 一个
				//   `interval: 0.001` 的坏存档就会变成 **60ms 轮换**：每拍 __mpwGoNext → commit →
				//   applyFromStorage 全量重建（iframe/CSS/token 全刷），弱机直接卡死，且只在用户
				//   手动关轮换时才 clear。钳到 [1, 120] 分钟（UI 滑杆范围之外的值一律按边界处理）。
				const __rotRaw = Number(g && g.interval > 0 ? g.interval : (section.rotateMin > 0 ? section.rotateMin : 5));
				const sec = mpwClampRotMin(__rotRaw);
				window.__mpwRotTimer = setInterval(() => {
					try {
						const f = window.__mpwGoNext;
						if (typeof f === "function") f();
					} catch (e) { mpwErr("壁纸轮换(__mpwGoNext)", e); }
				}, sec * 60 * 1000);
			};
			// ①(修复) 每次渲染后重建最新轮换闭包（含随机分支）；由 interval 统一调用
			react.useEffect(() => {
				window.__mpwGoNext = () => {
					try {
						if (!section) return;
						const gid = section.rotGroupId;
						const g = gid ? (section.rotGroups || []).find((x) => x.id === gid) : null;
						if (g && g.order === "random") {
							const list = rotCandidates();
							if (!list.length) { showError(t("lib.empty")); return; }
							if (list.length < 2) { nextWallpaper(); return; }
							const r = Math.floor(Math.random() * list.length);
							const target = list[r];
							setWallIdx(wallList.findIndex((w) => w.key === target.key));
							applyWallFromList(target);
						} else {
							nextWallpaper();
						}
					} catch (e) { try { console.warn("[dsh-mpkg-wallpaper] 轮换 tick 失败:", e); } catch {} }
				};
			});
			// ①(第13条 根因修复) 轮播勾选网格的滚动位置：旧实现是"点击时先记 scrollTop，
			//   再用 [rotEdit.keys, rotFilter, rotEditor] 依赖的 effect 事后写回"——
			//   与目录列表同一类病（补救式补偿、依赖数组里放 `rotEdit && rotEdit.keys` 这种
			//   每次新建的数组 ⇒ 何时触发不可预期）。现由组件顶层的 useMpwListScroll(rotGridRef,…)
			//   统一负责：滚动路径只写 ref，绘制前同步写回**用户最后一次的位置**，幂等、不需要时间窗。
			//   旧 effect / 旧 rotScrollRef / 三处 onClick 里的手工记录已全部删除。
			// ①(新) tab 高度自适应：跟随当前页最后一个按钮（否则矮 tab 下方大片空白）
			react.useEffect(() => {
				try {
					const body = tabBodyRef.current;
					if (!body) return;
					const col = body.querySelector('[data-mpw-tabkey="' + settingsTab + '"]');
					if (!col) return;
					const h = col.offsetHeight;
					if (body.style.height !== h + "px") body.style.height = h + "px";
				} catch {}
			});
			// ③(修正) 任一弹窗打开时给 body 打标记（背后设置面板禁虚化），关闭时移除
			react.useEffect(() => {
				const anyOpen = previewModal || errorModal || dirPick || updChoose || conflictModal;
				try {
					if (anyOpen) document.body.setAttribute("data-mpw-modal", "");
					else document.body.removeAttribute("data-mpw-modal");
				} catch {}
			}, [previewModal, errorModal, dirPick, updChoose, conflictModal]);
			// ③(新) 轮换开关变化时启停（①(修复) cleanup + rotGroupId 依赖：
			// 删除激活组/改间隔/换组时重建定时器，防止按旧组旧间隔继续轮换）
			react.useEffect(() => {
				const on = section.rotate !== void 0 ? !!section.rotate : DEFAULT_ROTATE;
				if (on) startRotation();
				else { try { if (window.__mpwRotTimer) clearInterval(window.__mpwRotTimer); window.__mpwRotTimer = null; } catch {} }
			// ①(修复) 不卸载清理：轮换应常驻（旧行为：关设置页继续轮换）；deps 变化时
			// startRotation 会先 clearInterval 再重建，天然覆盖
			}, [section.rotate, section.rotateMin, wallList.length, section.rotGroupId, section.rotGroups]);
			// ④(新) 选择本地壁纸库里的 video 壁纸播放
			const applyLibraryWallpaper = (wp) => {
				// ①(修正) try/catch：点击处理抛错会卡住按钮（用户实测）。
				try {
				// ①(新) Steam 库网页壁纸 → 先确认（实验性）
				if (wp.type === "web") {
					if (!wp.media) { showError(t("lib.sceneOnly")); return; }
					setWebConfirm({ title: wp.title || wp.ltoken, ltoken: wp.ltoken, media: wp.media, src: "library", webHeavy: !!wp.webHeavy, webExternal: !!wp.webExternal });
					return;
				}
				// ①(新) Steam 库场景壁纸 → scene-video 快路径优先（内嵌 MP4 硬件解码）；
				// 无内嵌视频 → 图层合成（canvas 动态）；失败回退静态帧
				if (wp.type === "scene") {
					const key = "library|" + wp.ltoken;
					const staticImg = "host:?ltoken=" + wp.ltoken + "&scene=1";
					try { if (typeof showSceneBusy === "function") showSceneBusy(t("scene.probing")); } catch {}
					applySceneWallpaper({
						key, image: staticImg, source: wp.title, mpkgKey: "library|" + wp.ltoken,
						// ①(修正) applyVideo：有内嵌视频 → converted:"mp4" + sv=1 走 video（组件内持有 commit）
						applyVideo: (k2, img2, src2) => {
							try {
								const svImg = img2 + "&sv=1";
								commit({
									image: svImg, source: src2, mpkgKey: "library|" + wp.ltoken, mpkgName: src2,
									fromMpkg: false, converted: "mp4", sceneKey: undefined, slot: null,
									info: undefined, timeVideos: undefined, timeConfig: undefined, activeSlot: null,
									webUrl: undefined, propEdits: undefined
								}, true);
								setMpkgMeta({ name: src2, key: "library|" + wp.ltoken, info: null, entryName: "scene.pkg", slot: null });
								try { if (typeof hideBusy === "function") hideBusy(); } catch {}
								setHint(t("lib.applied") + "：" + src2);
							} catch (e) { console.error("[dsh-mpkg-wallpaper] scene-video 应用失败:", e); }
						},
						fallback: (k2, img2) => {
							fetchSceneComposite(k2).then(() => {
								commit({
									image: img2, source: wp.title, mpkgKey: "library|" + wp.ltoken, mpkgName: wp.title,
									fromMpkg: false, converted: "scene", sceneKey: k2, slot: null,
									info: undefined, timeVideos: undefined, timeConfig: undefined, activeSlot: null,
									webUrl: undefined, propEdits: undefined
								}, true);
								setMpkgMeta({ name: wp.title, key: "library|" + wp.ltoken, info: null, entryName: "scene.pkg", slot: null });
								try { if (typeof hideBusy === "function") hideBusy(); } catch {}
								setHint(t("lib.applied") + "：" + wp.title);
							}).catch(() => {
								commit({
									image: img2, source: wp.title, mpkgKey: "library|" + wp.ltoken, mpkgName: wp.title,
									fromMpkg: false, converted: "gif", sceneKey: undefined, slot: null,
									info: undefined, timeVideos: undefined, timeConfig: undefined, activeSlot: null,
									webUrl: undefined, propEdits: undefined
								}, true);
								setMpkgMeta({ name: wp.title, key: "library|" + wp.ltoken, info: null, entryName: "scene.pkg", slot: null });
								try { if (typeof hideBusy === "function") hideBusy(); } catch {}
								setHint(t("lib.applied") + "：" + wp.title);
							});
						},
					});
					return;
				}
				if (wp.type !== "video" || !wp.media) { showError(t("lib.sceneOnly")); return; }
				const file = String(wp.media).split(/[\\/]/).pop();
				commit({
					image: "host:?ltoken=" + wp.ltoken + "&file=" + encodeURIComponent(file),
					source: wp.title, mpkgKey: "library|" + wp.ltoken, mpkgName: wp.title,
					fromMpkg: false, converted: "mp4", slot: null,
					info: undefined, timeVideos: undefined, timeConfig: undefined, activeSlot: null,
					webUrl: undefined, propEdits: undefined
				}, true);
				setMpkgMeta({ name: wp.title, key: "library|" + wp.ltoken, info: null, entryName: file, slot: null });
				setHint(t("lib.applied") + "：" + wp.title);
				} catch (err) { console.error("[dsh-mpkg-wallpaper] 应用本地库壁纸失败:", err); showError(t("lib.fail") + String(err && err.message || err)); }
			};
			// ①(新) 应用本地库网页壁纸（iframe；确认弹窗确认后调用）
			// ①(2026-09-16 I 项) mode 同 applyCustomWebReal：默认 shim 通道，compat = 同源兼容模式
			const applyLibraryWebReal = (wc, mode) => {
				try {
					const file = String(wc.media).split(/[\\/]/).join("/");
					commit({
						webUrl: "host:?ltoken=" + wc.ltoken + "&web=1&file=" + encodeURIComponent(file)
							+ (mode === "compat" ? "" : "&shim=1"),
						source: wc.title, mpkgKey: "library|" + wc.ltoken, mpkgName: wc.title,
						fromMpkg: false, converted: "web", slot: null,
						info: undefined, timeVideos: undefined, timeConfig: undefined, activeSlot: null,
						image: undefined, propEdits: undefined
					}, true);
					setMpkgMeta({ name: wc.title, key: "library|" + wc.ltoken, info: null, entryName: file, slot: null });
					setHint(t("lib.applied") + "：" + wc.title);
					mpwWebDiag("mount", { key: "library|" + wc.ltoken, entry: String(file).slice(0, 120), mode: mode === "compat" ? "compat" : "shim" });
				} catch (err) { console.error("[dsh-mpkg-wallpaper] 应用网页壁纸失败:", err); showError(t("lib.fail") + String(err && err.message || err)); }
			};

			// ① 恢复默认：只重置外观数值，不清除已导入的壁纸
			const resetSettings = () => {
				const s = readSection();
				const keep = {
					image: s.image, source: s.source, mpkgKey: s.mpkgKey, mpkgName: s.mpkgName,
					info: s.info, slot: s.slot, fromMpkg: s.fromMpkg, converted: s.converted,
					propEdits: s.propEdits, forceEnabled: s.forceEnabled
				};
				writeSection(Object.assign({}, keep, {
					opacity: DEFAULT_OPACITY, blur: DEFAULT_BLUR, zoom: DEFAULT_ZOOM,
					sidebar: DEFAULT_SIDEBAR, sharp: DEFAULT_SHARP,
					headerBlur: DEFAULT_HEADER, headerBg: DEFAULT_HEADER_BG, headerBlurAmount: DEFAULT_HEADER_BLUR_AMOUNT,
					headerFrostOwn: DEFAULT_HEADER_FROST_OWN, headerFrostAmount: DEFAULT_HEADER_FROST_AMOUNT,
					sceneReport: DEFAULT_SCENE_REPORT,
					sceneWatchdog: true, sceneWatchdogSecs: MPW_SCENE_WD_DEFAULT_SEC, sceneDebugParams: "", // ①(批次15 B1/B3) 四处接线①：重置默认
					dialogBlur: DEFAULT_DIALOG_BLUR, dialogAmount: DEFAULT_DIALOG_AMOUNT,
					popoverBlur: DEFAULT_POPOVER_BLUR, popoverAmount: DEFAULT_POPOVER_AMOUNT,
					maskBlur: DEFAULT_MASK_BLUR, maskAmount: DEFAULT_MASK_AMOUNT,
					unifyTint: DEFAULT_UNIFY_TINT, unifyAmount: DEFAULT_UNIFY_AMOUNT, sidebarAlpha: DEFAULT_SIDEBAR_ALPHA, chatFollow: DEFAULT_CHAT_FOLLOW, sessionFollow: DEFAULT_SESSION_FOLLOW,
					aquaMask: DEFAULT_AQUA_MASK, aquaTint: DEFAULT_AQUA_TINT, aquaInk: DEFAULT_AQUA_INK, aquaColor: "", aquaInkColor: "", aquaTextEnhance: DEFAULT_AQUA_TEXT_ENHANCE, todoBlur: DEFAULT_TODO_BLUR, aquaMaskAlpha: DEFAULT_AQUA_MASK_ALPHA, aquaTintStrength: DEFAULT_AQUA_TINT_STRENGTH, themeColor: DEFAULT_THEME_COLOR,
					hybrid: DEFAULT_HYBRID, roundCompat: DEFAULT_ROUND_COMPAT,
					rotate: DEFAULT_ROTATE, rotateMin: 5, customDirPath: "", brightness: DEFAULT_BRIGHTNESS, float: DEFAULT_FLOAT,
					playbackRate: DEFAULT_PLAYBACK_RATE, rotGroups: [], rotGroupId: "", rotSeeded: false,
					glassColor: "", glassAlpha: 12, glassWindow: false, accent: "", newStyle: false, mute: true,
					thinkBg: DEFAULT_THINK_BG,
					bsCompat: false, bsFloat: false, bsFont: false, bsReveal: false, bsAlpha: false, bsAqua: false, bsBottomAvoid: false,
					enabled: DEFAULT_ENABLED
				}), true);
				setSection(readSection());
				applyFromStorage();
			};
			// ④(新) 备份与恢复：导出/导入外观类设置（外观/统一虚化/界面虚化/Aqua/其他）。
			// 不含当前壁纸选择、扫描目录等"环境"状态（用户要求）；导出 JSON 文件可分享，
			// 别人导入后得到相同外观（参考插件市场的备份/恢复思路，但只做本插件设置）。
			const BACKUP_FIELDS = [
				"opacity", "blur", "zoom", "sidebar", "sharp", "headerBlur", "headerBg", "headerBlurAmount",
				"headerFrostOwn", "headerFrostAmount", "popoverAlpha", "sceneReport",
				"sceneWatchdog", "sceneWatchdogSecs", "sceneDebugParams", // ①(批次15 B1/B3) 四处接线②：备份导出/导入
				"dialogBlur", "dialogAmount", "popoverBlur", "popoverAmount", "maskBlur", "maskAmount",
				"unifyTint", "unifyAmount", "sidebarAlpha", "chatFollow", "sessionFollow",
				"aquaMask", "aquaTint", "aquaInk", "aquaColor", "aquaInkColor", "aquaTextEnhance", "todoBlur",
				"aquaMaskAlpha", "aquaTintStrength", "themeColor", "accent", "glassColor", "glassAlpha", "glassWindow",
				"hybrid", "roundCompat", "rotate", "rotateMin", "rotGroups", "rotGroupId", "rotSeeded",
				"brightness", "float", "playbackRate", "newStyle", "mute", "thinkBg", "enabled",
				"forceEnabled", "propEdits", "clock", "clock24h", "clockSec", "clockDate", "clockPos", "clockSize",
				"fpsCap", "resMax", "bsCompat", "bsFloat", "bsFont", "bsReveal", "bsRevealAlpha", "bsAlpha", "bsAqua", "bsBottomAvoid"
			];
			const exportBackup = () => {
				try {
					const s = readSection();
					const data = {};
					for (const k of BACKUP_FIELDS) if (s[k] !== void 0) data[k] = s[k];
					const blob = new Blob([JSON.stringify({ app: "dsh-mpkg-wallpaper", version: 1, settings: data }, null, 2)], { type: "application/json" });
					const url = URL.createObjectURL(blob);
					const a = document.createElement("a");
					a.href = url;
					// ⑤(修正) 文件名带时间戳：重复导出不撞名（浏览器不再自动加 (1)），
					// 界面也显示实际文件名（用户实测导出多次后分不清哪个是哪个）。
					const d = new Date();
					const pad = (n) => String(n).padStart(2, "0");
					const fname = `dsh-mpkg-wallpaper-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`;
					a.download = fname;
					document.body.appendChild(a);
					a.click();
					a.remove();
					setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} }, 2000);
					setBackupFileName(fname);
					setHint(t("backup.exported"));
				} catch (err) { console.warn("[dsh-mpkg-wallpaper] 导出备份失败:", err); showError(t("backup.fail") + String(err && err.message || err)); }
			};
			const importBackup = (file) => {
				if (!file) return;
				const reader = new FileReader();
				reader.onload = () => {
					try {
						const obj = JSON.parse(String(reader.result));
						const settings = obj && obj.app === "dsh-mpkg-wallpaper" ? obj.settings : (obj && obj.settings ? obj.settings : obj);
						if (!settings || typeof settings !== "object") { showError(t("backup.bad")); return; }
						const s = readSection();
						const patch = {};
						// ①(修正) 类型校验（评审指出：原实现直接透传，`opacity:"abc"` 会污染设置）：
						// 数值类必须为有限数、布尔类必须为 boolean、字符串类必须为 string。
						const numFields = ["opacity", "blur", "zoom", "headerBlurAmount", "headerFrostAmount", "dialogAmount", "popoverAmount", "popoverAlpha", "maskAmount", "unifyAmount", "sidebarAlpha", "aquaMaskAlpha", "aquaTintStrength", "glassAlpha", "lgCssAmount", "rotateMin", "brightness", "playbackRate", "clockSize", "fpsCap", "resMax", "bsRevealAlpha", "sceneWatchdogSecs"]; // ①(批次15) 四处接线③：导入数值净化
						const boolFields = ["sidebar", "sharp", "headerBlur", "headerBg", "rightSidebarBlur", "dialogBlur", "popoverBlur", "maskBlur", "unifyTint", "chatFollow", "sessionFollow", "aquaMask", "aquaTint", "aquaInk", "aquaTextEnhance", "todoBlur", "hybrid", "roundCompat", "rotate", "float", "newStyle", "mute", "thinkBg", "enabled", "forceEnabled", "clock", "clock24h", "clockSec", "clockDate", "glassWindow", "bsCompat", "bsFloat", "bsFont", "bsReveal", "bsAlpha", "bsAqua", "bsBottomAvoid", "lgTest", "lgCss", "lgComposer", "lgSidebar", "lgHeader", "powPauseHidden", "powPauseBlur", "powPauseBattery", "sceneWatchdog"]; // ①(批次15) 四处接线④：导入布尔净化
						const strFields = ["aquaColor", "aquaInkColor", "themeColor", "accent", "glassColor", "clockPos", "fontColorGrayColor", "sceneDebugParams"]; // ①(批次15) sceneDebugParams 走字符串净化（非法键/值在写入端丢弃）
						for (const k of BACKUP_FIELDS) {
							const v = settings[k];
							if (v === void 0) continue;
							if (numFields.includes(k)) { if (typeof v === "number" && isFinite(v)) patch[k] = v; continue; }
							if (boolFields.includes(k)) { if (typeof v === "boolean") patch[k] = v; continue; }
							if (strFields.includes(k)) { if (typeof v === "string") patch[k] = v; continue; }
							patch[k] = v; // rotGroups/rotGroupId/rotSeeded/propEdits 等复合字段原样
						}
						if (!Object.keys(patch).length) { showError(t("backup.bad")); return; }
						writeSection(Object.assign({}, s, patch), true);
						setSection(readSection());
						applyFromStorage();
						setHint(t("backup.imported"));
					} catch (err) { console.warn("[dsh-mpkg-wallpaper] 导入备份失败:", err); showError(t("backup.bad")); }
				};
				reader.readAsText(file);
			};

			// ① 清除已导入的壁纸（保留外观数值）
			const clearBg = () => {
				idbDel("bg");
				// ①(修正) 清壁纸时断开 web iframe 的 observer（防内存累积/残留监听）
				try { disposeWebFrame(bgElements().frame); } catch {}
				// ②(修正) 清壁纸时同时清时间槽缓存（bg-morning 等）——否则旧槽缓存残留，
				// 清完再导入时间壁纸仍会串台显示上一张壁纸的时段视频（用户实测）。
				const cs = readSection();
				if (Array.isArray(cs.timeVideos)) {
					for (const l of cs.timeVideos) { try { idbDel("bg-" + l.key); } catch {} }
				}
				for (const k of ["morning", "day", "dusk", "night"]) { try { idbDel("bg-" + k); } catch {} }
				const s = readSection();
				writeSection(Object.assign({}, s, { image: "", source: "", fromMpkg: false, converted: "", mpkgKey: "", mpkgName: "", info: undefined, slot: null, timeVideos: undefined, timeConfig: undefined, activeSlot: null, timeSrc: null, timeOverride: null, webUrl: undefined, sceneKey: undefined }), true);
				setSection(readSection());
				setMpkgMeta(null);
				// ①(修正) 清壁纸后强制卸载 web iframe（否则 applyFromStorage 非 web 分支
				// 因 img.src===image=="" 跳过 showImageEl → iframe 永不卸载 → 内存泄漏/OOM，
				// 用户实测导星野后清除再导其他壁纸导不进）。
				try { teardownWebFrame(); } catch {}
				applyFromStorage();
			};
			// ⑩(新) 刷新壁纸：重新应用当前壁纸（web iframe 重载 / host 缓存击穿 /
			// 场景重拉清单 / 视频重缓冲）。不改变任何设置，仅重新拉取素材。
			const refreshBg = () => {
				try {
					const s = readSection();
					if (!s.image && !s.webUrl) return;
					if (s.webUrl && s.converted === "web") {
						// web：iframe 重新加载（换 URL 触发重载，走 showWebEl 重新挂 observer）
						try {
							const u = resolveHostUrl(s.webUrl);
							showWebEl(u + (u.indexOf("?") >= 0 ? "&" : "?") + "_t=" + Date.now());
						} catch {}
						setHint(t("refresh.done"));
						return;
					}
					if (s.converted === "scene" && s.sceneKey) {
						// scene：清除清单缓存，重新拉取合成（canvas 重绘）
						sceneComposite = null;
						if (sceneFetching) sceneFetching = null;
						applyFromStorage();
						setHint(t("refresh.done"));
						return;
					}
					if (typeof s.image === "string" && s.image.indexOf("host:") === 0) {
						// host 图/视频：缓存击穿（&_t=tick）→ applyFromStorage 用新 URL
						hostBustTick = Date.now();
						applyFromStorage();
						setHint(t("refresh.done"));
						return;
					}
					if (s.image === "idb:blob") {
						// idb 视频/动图：强制重建 ObjectURL 重缓冲
						// ①(修正) 内存：先 revoke 旧 blob URL 再清引用，防泄漏
						if (lastBgSig && lastBgSig.url) { try { URL.revokeObjectURL(lastBgSig.url); } catch {} }
						lastBgSig = null;
						applyFromStorage();
						setHint(t("refresh.done"));
						return;
					}
					applyFromStorage();
					setHint(t("refresh.done"));
				} catch (err) { console.warn("[dsh-mpkg-wallpaper] 刷新壁纸失败:", err); }
			};

			// ①(新) hybrid 模式导入：上传 mpkg 到宿主 → 用 HTTP Range URL 播放（大文件无限制）
			const importViaHost = async (file, t, showError, commit, setMpkgMeta, setHint, setBusy, setPreviewModal) => {
				const up = await fetch(HOST_BASE + "/upload", { method: "POST", body: file });
				const upj = await up.json();
				if (!upj.ok) { showError(t("mpkg.fail") + " upload: " + String(upj.error || "")); return; }
				const entries = upj.entries;
				const token = upj.token;
				const mediaUrl = (idx, offset) => HOST_BASE + "/media?token=" + encodeURIComponent(token) + "&index=" + idx + (offset ? "&offset=" + offset : "");
				const readHead = async (idx) => {
					const r = await fetch(mediaUrl(idx), { headers: { Range: "bytes=0-65535" } });
					return new Uint8Array(await r.arrayBuffer());
				};
				const readFull = async (idx) => new Uint8Array(await (await fetch(mediaUrl(idx))).arrayBuffer());
				// 视频纹理扫描（同纯 client 语义：抠像层/入场动画排除）
				const vtex = [];
				for (let i = 0; i < entries.length; i++) {
					const e = entries[i];
					if (e.name.endsWith(".tex") && e.size > 5 * 1024 * 1024
						&& !/蓝幕|绿幕|bluescreen|greenscreen|chroma|keying|抠像/i.test(e.name)
						&& !/入场|开场|intro|entry\s*animation|entryanimation/i.test(e.name)) {
						if (texHasVideo(await readHead(i))) vtex.push({ name: e.name, idx: i, size: e.size });
					}
				}
				let info = null;
				const projIdx = entries.findIndex((e) => e.name === "project.json");
				if (projIdx >= 0) { try { info = extractProjectInfo(new TextDecoder().decode(await readFull(projIdx))); } catch {} }
				const key = file.name + "|" + file.size;
				const meta = { name: file.name, key, info, entryName: "", slot: null };
				if (vtex.length) {
					let cfg = { enabled: true, morning: 4, day: 9, dusk: 17, night: 20 };
					if (projIdx >= 0) {
						try {
							const pj = JSON.parse(new TextDecoder().decode(await readFull(projIdx)));
							const pm = (pj.general && pj.general.properties) || null;
							if (pm) cfg = timeConfigFromProps(pm, {});
						} catch {}
					}
					const slot = slotForTime(cfg, new Date());
					const active = vtex.find((v) => slotFromName(v.name) === slot) || vtex[0];
					const head = await readHead(active.idx);
					const off = extractTexVideoOffset(head) || 0;
					meta.entryName = "视频纹理:" + active.name;
					commit({
						image: "host:" + mediaUrl(active.idx, off).replace(HOST_BASE + "/media", ""),
						source: "视频纹理:" + active.name, mpkgKey: key, mpkgName: file.name,
						info: { title: info ? info.title : "", properties: info ? info.properties : [] },
						slot: null, fromMpkg: true, converted: "mp4",
						timeVideos: undefined, timeConfig: undefined, activeSlot: null
					}, true);
					setHint(t("time.picked") + "：" + t("time." + (slot || "day")));
				} else {
					const { entry, slot } = pickBackgroundEntry(entries, new Date());
					if (!entry) { showError(t("mpkg.noAsset")); return; }
					const idx = entries.indexOf(entry);
					const isMp4 = /\.(mp4|webm|mov)$/i.test(entry.name);
					meta.entryName = entry.name;
					meta.slot = slot;
					commit({
						image: "host:" + mediaUrl(idx).replace(HOST_BASE + "/media", ""),
						source: entry.name, mpkgKey: key, mpkgName: file.name,
						info: { title: info ? info.title : "", properties: info ? info.properties : [] },
						slot: slot || null, fromMpkg: true, converted: isMp4 ? "mp4" : "gif",
						timeVideos: undefined, timeConfig: undefined, activeSlot: null
					}, true);
					if (isMp4) {
						setHint(slot ? t("time.picked") + "：" + t("time." + slot) : "");
					} else {
						setHint((slot ? t("time.picked") + "：" + t("time." + slot) + " · " : "") + t("mpkg.previewMode"));
						setPreviewModal(true);
					}
				}
				setMpkgMeta(meta);
			};

			const onMpkg = async (e) => {
				const file = e.target.files && e.target.files[0];
				e.target.value = "";
				if (!file) return;
				// ③ 安全：先嗅探真实类型，拒绝 SVG/HTML/任意可执行内容
				const type = await sniffFileType(file);
				if (!type) { showError(t("file.unsafe")); return; }
				// ② 选择器静默兼容 mp4/视频：直接作为视频背景，界面不宣传
				// ①(修正) 上限提到 600MB（与 onMedia 一致）：大 mp4 经 mpkg 入口选择
				// 也应能播；原 100MB（文案误写 50MB）导致用户大 mp4 被拒、视频不生效。
				if (type === "mp4" || type === "webm") {
					if (file.size > 600 * 1024 * 1024) { showError(t("mpkg.huge")); return; }
					setHint("");
					storeVideoBlob(file).then((marker) => commit({ image: marker, source: file.name }, true)).catch((e) => { try { console.error('[dsh-mpkg-wallpaper] 视频写入失败(配额?):', e); } catch {} try { showError(t('mpkg.quota') || '写入失败（存储配额）'); } catch {} });
					return;
				}
				if (type !== "mpkg") { showError(t("file.unsafe")); return; }
				// ①(新) hybrid 模式：检测宿主端。可用 → 上传 + Range 流式播放（无 600MB 限制）
				const hybridOn = section.hybrid !== void 0 ? !!section.hybrid : DEFAULT_HYBRID;
				let hostOk = false;
				if (hybridOn) {
					try { const r = await fetch(HOST_BASE + "/ping", { method: "GET" }); hostOk = !!r.ok; } catch { hostOk = false; }
				}
				if (hostOk) {
					setBusy(true);
					setHint("");
					try {
						await importViaHost(file, t, showError, commit, setMpkgMeta, setHint, setBusy, setPreviewModal);
					} catch (err) {
						console.error("[dsh-mpkg-wallpaper] hybrid 导入失败:", err);
						showError(t("mpkg.fail") + String(err && err.message || err));
					} finally {
						setBusy(false);
					}
					return;
				}
				// ⑨(新) 整体大小上限（纯浏览器模式）：超大 mpkg（>600MB）移动端浏览器几乎无法处理
				if (file.size > 600 * 1024 * 1024) { showError(t("mpkg.huge")); return; }
				setBusy(true);
				setHint("");
				try {
					// ③(重做) 按需读取：只读文件前部（头部+条目头，通常 <2MB）解析容器，
					// 条目数据（preview/视频纹理/project.json）用 file.slice 按需单独读。
					// 424MB 大包不再整体 arrayBuffer 进内存（移动端会 OOM 崩溃）。
					const HEAD_BYTES = 2 * 1024 * 1024;
					const headBuf = await file.slice(0, Math.min(file.size, HEAD_BYTES)).arrayBuffer();
					const mpkg = parseMpkg(headBuf);
					const readEntry = async (entry, limit, offset) => {
						const off = offset || 0;
						const len = limit ? Math.min(entry.size - off, limit) : entry.size - off;
						if (len <= 0) return new Uint8Array(0);
						return new Uint8Array(await file.slice(mpkg.dataStart + entry.index + off, mpkg.dataStart + entry.index + off + len).arrayBuffer());
					};
					const readEntryHead = (entry) => readEntry(entry, 65536);
					// 时间变化：扫描视频纹理（tex 内嵌 MP4），按壁纸时间设置选当前时段
					const vtex = [];
					for (const e of mpkg.entries) {
						// ①(修正) 视频纹理候选排除规则（基于语义，非特定壁纸）：
						// - 抠像层：蓝幕/绿幕/抠像（只有人物，透明背景，不能当主背景）
						// - 入场动画：入场/开场/intro/entry animation（短开场，循环主背景才是要的）
						// ② 只把大尺寸视频纹理当主背景
						if (e.name.endsWith(".tex") && e.size > 5 * 1024 * 1024
							&& !/蓝幕|绿幕|bluescreen|greenscreen|chroma|keying|抠像/i.test(e.name)
							&& !/入场|开场|intro|entry\s*animation|entryanimation/i.test(e.name)) {
							const head = await readEntryHead(e);
							if (texHasVideo(head)) vtex.push(e);
						}
					}
					if (vtex.length) {
						// ⑧(新) 纯浏览器路径：File 不可序列化 → 注册到会话级映射，懒加载换时段时引用
						sessionFiles[file.name + "|" + file.size] = { file, dataStart: mpkg.dataStart };
						const ok = await handleVideoTexes(mpkg, vtex, file, t, showError, readEntry, null, setHint, { kind: "file", key: file.name + "|" + file.size });
						if (ok === "stale") { try { console.warn("[dsh-mpkg-wallpaper] 时段导入已过期(壁纸已切换)，跳过后续链"); } catch {}; return; }
						if (ok) {
							// ③(修正) 视频纹理导入成功后也要更新名称/素材显示（原来 setMpkgMeta(null)
							// 导致导入后元数据不刷新，需清壁纸或重复导入才更新）
							const s2 = readSection();
							setMpkgMeta(s2.fromMpkg && s2.mpkgKey && s2.info
								? { name: s2.mpkgName, key: s2.mpkgKey, info: s2.info, entryName: s2.source || "preview.gif", slot: s2.slot }
								: null);
							setBusy(false);
							return;
						}
						// ⑨(新) 视频纹理无法提取 → 回退到 preview.gif（继续走下方图片路径）
					}
					let pick = pickBackgroundEntry(mpkg.entries, new Date());
					let entry = pick.entry, slot = pick.slot;
					if (!entry) { showError(t("mpkg.noAsset")); return; }
					let stored = null;
					let isVideo = false;
					const isMp4 = /\.(mp4|webm|mov)$/i.test(entry.name);
					// ② 修复：内嵌 mp4/mov（视频类壁纸）直接作为视频背景
					if (isMp4 && entry.size <= 600 * 1024 * 1024) {
						// ⑤(重做) 独立 mp4：file.slice 直接创建 Blob（懒引用，不读入 JS 内存）。
						// 洛茜系列是 260-445MB 的独立 mp4 壁纸，原 readEntry(arrayBuffer) 会 OOM；
						// Blob 引用文件区域，JS 内存峰值低，可尝试大视频（上限 600MB）
						const vblob = file.slice(mpkg.dataStart + entry.index, mpkg.dataStart + entry.index + entry.size, guessMime(entry.name));
						stored = await storeVideoBlob(vblob);
						isVideo = true;
					} else if (isMp4) {
						// ⑥(新) 超大独立视频（>600MB，如 zmd_01 的 747MB mp4）：
						// 存储配额/播放内存都不可行 → 自动回退 preview 图片（至少能用上壁纸）
						const imgPick = pickBackgroundEntry(mpkg.entries.filter((e) => !/\.(mp4|webm|mov)$/i.test(e.name)), new Date());
						if (!imgPick || !imgPick.entry) { showError(t("mpkg.videoHuge")); return; }
						entry = imgPick.entry; slot = imgPick.slot;
						let bytes = await readEntry(entry);
						if (/\.gif$/i.test(entry.name)) bytes = ensureInfiniteGif(bytes.slice());
						const blob = new Blob([bytes], { type: guessMime(entry.name) });
						if (blob.size > 200 * 1024 * 1024) { showError(t("mpkg.tooLarge")); return; }
						stored = await storeImageBlob(blob);
						isVideo = false;
						setHint(t("mpkg.videoHuge"));
					} else {
						// 图片/GIF
						let bytes = await readEntry(entry);
						if (/\.gif$/i.test(entry.name)) bytes = ensureInfiniteGif(bytes.slice());
						const blob = new Blob([bytes], { type: guessMime(entry.name) });
						// ③(新) 大图片走 Blob 存储（idb:img），不走 dataURL（防膨胀爆内存）；
						// 上限 50MB → 200MB（大壁纸包预览图经常很大）
						if (blob.size > 200 * 1024 * 1024) { setHint(t("mpkg.tooLarge")); return; }
						stored = await storeImageBlob(blob);
					}
					const info = await extractProjectInfoAsync(mpkg.entries, readEntry);
					const key = file.name + "|" + file.size;
					const meta = { name: file.name, key, info, entryName: entry.name, slot };
					commit({
						image: stored, source: entry.name, mpkgKey: key, mpkgName: file.name,
						info: { title: info ? info.title : "", properties: info ? info.properties : [] },
						slot: slot || null, fromMpkg: true, converted: isVideo ? "mp4" : "gif",
						// ⑦(修正) 非视频纹理壁纸不带时间变化：清掉上一个壁纸残留的时段配置
						timeVideos: undefined, timeConfig: undefined, activeSlot: null
					}, true);
					setMpkgMeta(meta);
					// ①(修正) 视频→图片切换：强制清掉背景内容缓存，确保新壁纸立即显示
					// ①(修正) 内存：先 revoke 旧 blob URL 再清引用，防切换泄漏
					if (lastBgSig && lastBgSig.url) { try { URL.revokeObjectURL(lastBgSig.url); } catch {} }
					try { lastBgSig = null; } catch {}
					// ①(修正) 仅当最终显示的是图片/GIF（非 mp4）才提示预览模式；
					// 独立 mp4 视频壁纸（洛茜_01 等）不弹窗、不显示 GIF 提示
					if (isVideo) {
						setHint(slot ? t("time.picked") + "：" + t("time." + slot) : "");
					} else {
						setHint((slot ? t("time.picked") + "：" + t("time." + slot) + " · " : "") + t("mpkg.previewMode"));
						try { setPreviewModal(true); } catch {}
					}
				} catch (err) {
					console.error("[dsh-mpkg-wallpaper] onMpkg 失败:", err);
					// ⑨(新) 报错友好化：区分存储配额不足 / 内存不足 / 解析失败
					const en = err && err.name;
					const em = String(err && err.message || err);
					showError(en === "QuotaExceededError"
						? t("mpkg.quota")
						: /memory|allocat|out of|ArrayBuffer|too large/i.test(em)
							? t("mpkg.oom")
							: t("mpkg.fail") + em);
				} finally {
					setBusy(false);
				}
			};

			const onMedia = async (e) => {
				const file = e.target.files && e.target.files[0];
				e.target.value = "";
				if (!file) return;
				// ③ 安全：先嗅探真实类型，拒绝 SVG/HTML 等
				const type = await sniffFileType(file);
				if (!type || (type !== "png" && type !== "gif" && type !== "jpeg" && type !== "webp" && type !== "mp4" && type !== "webm")) {
					setHint(t("file.unsafe"));
					return;
				}
				// ①(修正) 视频上限提到 600MB（与 mpkg 入口一致）：本地 mp4/webm 走
				// IndexedDB 存 Blob + <video> 播放，无 base64 膨胀、无内存峰值，大文件安全。
				// 之前统一 100MB 且文案误写 50MB——用户选 200MB 的 mp4 被拒、误以为只能选 50MB
				// （Termux X11 Firefox 实测：大 mp4 导入被弹「不能选择大于 50」，视频根本不生效）。
				const isVid = type === "mp4" || type === "webm";
				if (file.size > (isVid ? 600 : 100) * 1024 * 1024) { setHint(t(isVid ? "mpkg.huge" : "file.tooLarge")); return; }
				setMpkgMeta(null);
				if (isVid) {
					// ① 视频背景：存入 IndexedDB，<video> 循环播放
					setHint("");
					storeVideoBlob(file).then((marker) => commit({ image: marker, source: file.name }, true)).catch((e) => { try { console.error('[dsh-mpkg-wallpaper] 视频写入失败(配额?):', e); } catch {} try { showError(t('mpkg.quota') || '写入失败（存储配额）'); } catch {} });
					return;
				}
				// ③(新) 图片：>2MB 直接存 Blob（idb:img，防 dataURL 膨胀）；小图走 dataURL
				setHint("");
				storeImageBlob(file).then((stored) => commit({ image: stored, source: file.name }, true)).catch((e) => { try { console.error("[dsh-mpkg-wallpaper] 图片写入失败(配额?):", e); } catch {} try { showError(t("mpkg.quota") || "写入失败（存储配额）"); } catch {} });
			};

			const applyUrl = () => {
				const safe = sanitizeImageUrl(url);
				if (!safe) { setHint(t("url.unsafe")); return; }
				setMpkgMeta(null);
				commit({ image: safe, source: "url", fromMpkg: false }, true);
			};


			const propEdits = (section.propEdits && section.propEdits[section.mpkgKey]) || {};
			const setProp = (key, value) => {
				const key2 = section.mpkgKey;
				if (!key2 || !safePropKey(key)) return;
				const edits = Object.assign({}, propEdits, { [key]: value });
				const propEditsAll = Object.assign({}, section.propEdits || {}, { [key2]: edits });
				commit({ propEdits: propEditsAll }, true);
				// ①(2026-09-16 I 项) 网页壁纸 shim 通道：编辑立刻下发到已挂载的帧（沙箱下父页读不到帧内 DOM，
				//   只能靠 postMessage；作者侧 applyUserProperties 会收到增量）。
				try {
					const frame = bgElements().frame;
					if (frame && mpwWebShimUrl(frame.getAttribute("src"))) webShimCall(frame, { op: "props", props: { [key]: { value } } });
				} catch {}
			};
			const allProps = mpkgMeta && mpkgMeta.info ? mpkgMeta.info.properties.slice() : [];
			// ④ 随现实时间变化关闭时，隐藏时间设置（清晨/白天/黄昏/夜晚开始时间 + 时间段选择）
			const tvProp = allProps.find((p) => /随现实时间|timevarying|real time/.test(p.label + " " + p.key));
			const tvEnabled = tvProp ? (propEdits[tvProp.key] !== void 0 ? !!propEdits[tvProp.key] : !!tvProp.value) : true;
			const TIME_KEYS = new Set(["morningtime", "daytime", "dusktime", "nighttime", "display"]);
			// ④(重做) 参数渲染暂不可用（浏览器显示的是预渲染素材，改了不生效）：
			// 默认全部折叠，只显示「展开全部」按钮；点击展开后只读展示全部参数。
			const propsShown = tvEnabled ? allProps : allProps.filter((p) => !TIME_KEYS.has(p.key));
			const propsToShow = propsExpanded ? propsShown : [];
			// ②(修正) web 壁纸选项项数（折叠按钮显示用）：分辨率+语言+音量+开关
			const webCfgCount = (() => {
				if (!webCfg || !webCfg.model) return 0;
				let n = 0;
				if (webCfg.model.resolution) n++;
				if (webCfg.languages && webCfg.languages.length) n++;
				if (typeof webCfg.model.bgmVolume === "number") n++;
				if (typeof webCfg.model.talkVolume === "number") n++;
				if (webCfg.model.showTouch !== void 0) n++;
				if (webCfg.model.showTalkDialog !== void 0) n++;
				return n;
			})();

			// ①(2026-09-12) 原 `const h` 声明在 1600 行之后（使用点之前）→ TDZ/未定义；
			//   已上移到函数开头（见 MpkgSectionImpl 首行），此处删除避免重复声明。
			// ①(修正) 弹窗遮罩 portal：渲染到 body，避开设置面板包含块/backdrop root 困局
			const MaskPortal = (props) => {
				const node = h("div", { className: "mpw_mask", onClick: props.onClick }, props.children);
				if (ReactDOM && ReactDOM.createPortal && typeof document !== "undefined" && document.body) {
					try { return ReactDOM.createPortal(node, document.body); } catch { /* 回退原位渲染 */ }
				}
				return node;
			};
			// ⑳(新) 自定义下拉（不调用原生 select——安卓原生太难看，用户实测）
			const [selectOpen, setSelectOpen] = react.useState("");
			const [selectDirUp, setSelectDirUp] = react.useState({}); // name → 是否向上展开
			const SelectBox = (props) => {
				const { value, options, onChange, placeholder } = props;
				const cur = options.find((o) => o.value === value);
				const dirUp = !!selectDirUp[props.name];
				const menuStyle = dirUp
					? { position: "absolute", left: 0, right: 0, bottom: "100%", marginBottom: 4, zIndex: 2600, maxHeight: 220, overflowY: "auto", overscrollBehavior: "contain", overflowAnchor: "none" }
					: { position: "absolute", left: 0, right: 0, top: "100%", marginTop: 4, zIndex: 2600, maxHeight: 220, overflowY: "auto", overscrollBehavior: "contain", overflowAnchor: "none" };
				return h("div", { className: "mpw_select", style: { position: "relative", flex: 1, minWidth: 0 } }, [
					h("button", { className: "mpw_input mpw_selectBtn", type: "button",
						onClick: (ev) => {
							if (selectOpen !== props.name) {
								// ①(修正) 下方空间不足时向上展开（用户实测列表底部被屏幕边缘截断）
								let up = false;
								try {
									const rect = ev.currentTarget.getBoundingClientRect();
									const est = Math.min(220, (options.length + 1) * 34);
									if (rect.bottom + est > (window.innerHeight || 600)) up = true;
								} catch {}
								setSelectDirUp((prev) => Object.assign({}, prev, { [props.name]: up }));
							}
							setSelectOpen(selectOpen === props.name ? "" : props.name);
						} },
						h("span", { style: { flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, cur ? cur.label : placeholder),
						h("span", { className: "mpw_hint" }, selectOpen === props.name ? (dirUp ? "▼" : "▲") : (dirUp ? "▲" : "▼"))
					),
					selectOpen === props.name
						? h("div", { className: "mpw_selectMenu", style: menuStyle },
							options.map((o) => h("button", { className: "mpw_selectOpt" + (o.value === value ? " mpw_on" : ""), type: "button", key: o.value,
								onClick: () => { setSelectOpen(""); onChange(o.value); } }, o.label)))
						: null
				]);
			};
			// ⑳(新) 视频倍速：6 档按钮（去掉进度条——条上点击/拖拽反复错档，用户要求改按钮）
			const SpeedBar = (props) => {
				const { value, onChange } = props;
				// ①(新) 新样式（radio）开关控制：其他 tab 的 newStyle
				let newStyle = false;
				try { newStyle = !!readSection().newStyle; } catch {}
				if (newStyle) {
					// ①(新) uiverse 液态滑块 radio（6 档）
					const li = Math.max(0, SPEED_LEVELS.indexOf(value));
					return h("div", { className: "mpw_liquidGroup" }, [
						// 液态滑块（translateX 0%..500%，相对滑块自身宽度）
						h("div", { className: "mpw_liquidSlider", style: { transform: "translateX(" + (li * 100) + "%)" } }),
						SPEED_LEVELS.map((rate) => h("button", { key: rate, type: "button",
							className: "mpw_liquidOpt" + (rate === value ? " mpw_on" : ""),
							onClick: () => onChange(rate) }, (rate === 1 ? "1" : rate) + "x"))
					]);
				}
				return h("div", { style: { display: "flex", gap: 4, marginTop: 4 } },
					SPEED_LEVELS.map((rate) => {
						const on = rate === value;
						return h("button", { key: rate, type: "button",
							style: { flex: "1 1 0", padding: "8px 0", fontSize: 12, borderRadius: 8, cursor: "pointer",
								border: "1px solid " + (on ? "var(--dsw-alias-brand-primary, #4f8cff)" : "var(--dsw-alias-border-l2, #444b5c)"),
								background: on ? "color-mix(in srgb, var(--dsw-alias-brand-primary, #4f8cff) 18%, transparent)" : "transparent",
								color: on ? "var(--dsw-alias-brand-primary, #4f8cff)" : "var(--dsw-alias-label-secondary)",
								fontWeight: on ? 700 : 400 },
							onClick: () => onChange(rate) }, (rate === 1 ? "1" : rate) + "x");
					}));
			};
			const sliderRow = (label, field, min, max, suffix, step, def) => {
				const val = section[field] !== void 0 ? section[field] : def;
				const rangeRef = react.useRef(null);
				const numRef = react.useRef(null);
				const timer = react.useRef(null);
				const rafRef = react.useRef(null);
				const dragging = react.useRef(false);
				const fmt = (v) => (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(2))));
				const apply = (v) => {
					let n = Number(v);
					if (isNaN(n)) return;
					n = Math.max(min, Math.min(max, n));
					if (rangeRef.current && String(rangeRef.current.value) !== String(n)) rangeRef.current.value = n;
					if (numRef.current && String(numRef.current.value) !== String(fmt(n))) numRef.current.value = fmt(n);
					previewCss(Object.assign({ [field]: n }, dragging.current ? { _noBlur: true } : {}));
					if (timer.current) clearTimeout(timer.current);
					timer.current = setTimeout(() => commit({ [field]: n }), 350);
				};
				// ⑤ 外部值变化（恢复默认等）时同步滑杆与数值框
				react.useEffect(() => {
					if (dragging.current) return;
					if (rangeRef.current && String(rangeRef.current.value) !== String(val)) rangeRef.current.value = val;
					if (numRef.current && String(numRef.current.value) !== String(fmt(val))) numRef.current.value = fmt(val);
				});
				const onRangeInput = (ev) => {
					dragging.current = true;
					const v = Number(ev.target.value);
					if (numRef.current) numRef.current.value = fmt(v);
					if (rafRef.current) cancelAnimationFrame(rafRef.current);
					rafRef.current = requestAnimationFrame(() => { previewCss(Object.assign({ [field]: v }, { _noBlur: true })); });
					if (timer.current) clearTimeout(timer.current);
					timer.current = setTimeout(() => { commit({ [field]: v }); }, 350);
				};
				const onNumInput = (ev) => {
					dragging.current = true;
					if (timer.current) clearTimeout(timer.current);
					// 清洗：只留数字和一个小数点；禁科学计数法(e/E/±)、限长 7 位、最多 2 位小数
					let raw = ev.target.value;
					raw = raw.replace(/[^0-9.]/g, "");
					const dot = raw.indexOf(".");
					if (dot >= 0) {
						raw = raw.slice(0, dot + 1) + raw.slice(dot + 1).replace(/\./g, "").slice(0, 2);
					}
					if (raw.length > 7) raw = raw.slice(0, 7);
					if (numRef.current && numRef.current.value !== raw) numRef.current.value = raw;
					// 空/非法输入：不提交，等失焦收敛
					if (raw === "" || raw === "." || isNaN(Number(raw))) return;
					const c = Math.max(min, Math.min(max, Number(raw)));
					if (rangeRef.current) rangeRef.current.value = c;
					previewCss(Object.assign({ [field]: c }, { _noBlur: true }));
					timer.current = setTimeout(() => commit({ [field]: c }), 500);
				};
				const onNumBlur = (ev) => {
					dragging.current = false;
					if (timer.current) { clearTimeout(timer.current); timer.current = null; }
					const raw = numRef.current ? numRef.current.value : "";
					let n = Number(raw);
					if (raw === "" || isNaN(n)) n = val;
					n = Math.max(min, Math.min(max, n));
					// 失焦时收敛并写回输入框
					if (numRef.current) numRef.current.value = fmt(n);
					apply(n);
				};
				const endDrag = () => {
					dragging.current = false;
					if (rafRef.current) cancelAnimationFrame(rafRef.current);
					previewCss({});
				};
				return h("div", { className: "mpw_field" }, [
					h("label", { className: "mpw_label" }, label),
					h("div", { className: "mpw_inline" }, [
						h("input", {
							ref: rangeRef,
							className: "mpw_slider", type: "range", min, max, step: step || 1,
							defaultValue: val, onInput: onRangeInput,
							onPointerDown: () => { dragging.current = true; },
							onPointerUp: endDrag,
							onPointerCancel: endDrag,
							onKeyUp: endDrag
						}),
						h("input", {
							ref: numRef,
							className: "mpw_numInput", type: "text", inputMode: "decimal", autoComplete: "off",
							defaultValue: fmt(val),
							onInput: onNumInput,
							onBlur: onNumBlur,
							onKeyDown: (ev) => {
								// 双保险：直接拦截 e/E/+/-（科学计数法键）
								if (ev.key === "e" || ev.key === "E" || ev.key === "+" || ev.key === "-") ev.preventDefault();
							}
						}),
						h("span", { className: "mpw_value" }, suffix),
						// ③(新) 「默认」按钮：一键恢复该滑条默认值
						def !== void 0
							? h("button", { className: "mpw_reset mpw_miniBtn", type: "button", onClick: () => apply(def) }, t("default"))
							: null
					])
				]);
			};
			const toggleRow = (label, desc, field, def, disabled, forceOn) => {
				const checked = forceOn ? true : (section[field] !== void 0 ? !!section[field] : def);
				return h("div", { className: "mpw_field" }, [
					h("label", { className: "mpw_label" }, label),
					h("div", { className: "mpw_inline" }, [
						h("div", { style: disabled ? { opacity: 0.45, pointerEvents: "none" } : {} }, [
							// deferApply=true：先让圆点动画跑起来，再重建 CSS（见 commit 注释）
							h(Toggle, { checked, onChange: (v) => { if (forceOn) return; commit({ [field]: v }, false, true); } })
						]),
						h("span", { className: "mpw_hint" }, desc)
					])
				]);
			};

			// ⑳(新) 壁纸设置 tab：计算激活的帧率上限值（缺省=0 无限制）与 ffmpeg 状态文本（渲染用）
			const fpsCapVal = section.fpsCap !== void 0 && section.fpsCap !== null ? section.fpsCap : 0;
			const resMaxVal = section.resMax !== void 0 && section.resMax !== null ? section.resMax : DEFAULT_RES_MAX;
			// ①(修正) 第5项：面板颜色匹配壁纸（aquaTint）开关状态 —— 开时「遮罩自定义色」
			// 取色盘禁用变灰（二选一：自动匹配 vs 手动取色）。
			const aquaTintOn = section.aquaTint !== void 0 ? !!section.aquaTint : DEFAULT_AQUA_TINT;
			let ffStatus = null;        // 状态区文本（null 不显示额外状态行）
			let ffShowDownload = false; // 是否显示下载按钮（missing / downloading 都显示）
			let ffShowUninstall = false; // ①(新) 是否显示卸载按钮（仅 cached 来源；不碰系统/env）
			if (!ffmpegState || ffmpegState.checking || ffmpegState.downloading || ffmpegState.busy) {
				ffStatus = ffmpegState && ffmpegState.downloading ? t("ffmpeg.downloading") : (ffmpegState && ffmpegState.busy ? t("ffmpeg.uninstalling") : "…");
				ffShowDownload = !!(ffmpegState && ffmpegState.downloading);
			} else if (ffmpegState.error) {
				ffStatus = ffmpegState.error;
			} else if (ffmpegState.ready) {
				// ①(修正) 区分来源：system=系统 PATH 已装 / cached=缓存已装 / env=环境变量指定
				const srcLabel = ffmpegState.source === "system" ? t("ffmpeg.srcSystem") : (ffmpegState.source === "env" ? t("ffmpeg.srcEnv") : t("ffmpeg.srcCached"));
				ffStatus = srcLabel + " · " + t("ffmpeg.ready") + (ffmpegState.path ? " (" + ffmpegState.path + (ffmpegState.version ? ": " + ffmpegState.version : "") + ")" : "");
				// 仅当用的是缓存下载的 ffmpeg 时提供卸载（系统/env 的不动）
				ffShowUninstall = ffmpegState.source === "cached";
			} else if (ffmpegState.missing) {
				ffStatus = t("ffmpeg.missing");
				ffShowDownload = true;
			}

			// ①(2026-09-12 诊断) 面板信标：进入渲染 → 上报一次；children 构建完成 → 再上报一次。
			//   两封信标之间若中断，就说明是 children 构建中抛错（被 DSH 错误边界吞掉 → 面板空白）。
			try {
				if (!window.__mpwBeaconEnter) {
					window.__mpwBeaconEnter = 1;
					fetch(HOST_BASE + '/diag', { method: 'POST', body: JSON.stringify({ kind: 'beacon', why: 'panel-enter', at: new Date().toISOString(), url: location.href, note: 'image=' + typeof section.image + ' enabled=' + enabled }) }).catch(() => {});
				}
			} catch {}
			let __panelChildren = null;
			try {
				__panelChildren = [
				// ①(修正) 标题/描述在 Tab 条上方
				h("div", { className: "mpw_titleRow" }, [
					h("span", { className: "mpw_title" }, t("title")),
					h("a", { className: "mpw_repoLink", href: "https://github.com/XHR666/dsh-mpkg-wallpaper", target: "_blank", rel: "noopener" }, "dsh-mpkg-wallpaper"),
					hostVersion ? h("span", { className: "mpw_version" }, "v" + hostVersion) : null,
					// ①(新) 自动检测更新徽标：有新版本时版本号旁显示红点，点击弹更新确认
					updState && updState.hasUpdate
						? h("button", { className: "mpw_updBadge", type: "button", title: t("update.found") + updState.localVersion + " → " + updState.remoteVersion,
							onClick: () => setUpdChoose(updState) }, "● " + t("update.badge"))
						: null
				]),
				h("p", { className: "mpw_desc" }, t("desc")),
				// ①(新) 活动进度条：转码 / scene 提取合成进行中显示（percent=null 时不确定动画）
				mpwBusy && mpwBusy.visible
					? h("div", { className: "mpw_busy" + (mpwBusy.percent == null ? " mpw_busyIndet" : ""), role: "status" }, [
						h("div", { className: "mpw_busyText" }, mpwBusy.label || "…"),
						mpwBusy.percent != null
							? h("div", { className: "mpw_busyBar" }, [
								h("div", { className: "mpw_busyFill", style: { width: Math.max(2, Math.min(100, mpwBusy.percent || 0)) + "%" } })
							])
							: h("div", { className: "mpw_busyBar" }, [
								h("div", { className: "mpw_busyFill mpw_busyIndetFill" })
							]),
						h("span", { className: "mpw_busyPct" }, mpwBusy.percent != null ? Math.round(mpwBusy.percent || 0) + "%" : "")
					])
					: null,
				// ②(修正) 圆角导航栏 + 内容真滑动（translateX）；下划线由激活 tab ::after 绘制
				h("div", { className: "mpw_tabBar", "data-mpw-tabbar": "" }, [
					h("button", { className: "mpw_tab" + (settingsTab === "source" ? " mpw_tabActive" : ""), type: "button", onClick: () => switchTab("source") }, t("sec.source")),
					h("button", { className: "mpw_tab" + (settingsTab === "wallpaper" ? " mpw_tabActive" : ""), type: "button", onClick: () => switchTab("wallpaper") }, t("sec.wallpaper")),
					h("button", { className: "mpw_tab" + (settingsTab === "appearance" ? " mpw_tabActive" : ""), type: "button", onClick: () => switchTab("appearance") }, t("sec.appearance")),
					h("button", { className: "mpw_tab" + (settingsTab === "unify" ? " mpw_tabActive" : ""), type: "button", onClick: () => switchTab("unify") }, t("sec.unify")),
					h("button", { className: "mpw_tab" + (settingsTab === "blur" ? " mpw_tabActive" : ""), type: "button", onClick: () => switchTab("blur") }, t("sec.blur")),
					h("button", { className: "mpw_tab" + (settingsTab === "other" ? " mpw_tabActive" : ""), type: "button", onClick: () => switchTab("other") }, t("sec.other")),
					h("button", { className: "mpw_tab" + (settingsTab === "liquid" ? " mpw_tabActive" : ""), type: "button", onClick: () => switchTab("liquid") }, t("sec.liquid")),
				]),
				// 内容区：flex 行 + translateX 滑动（真翻页；所有 tab 内容始终挂载，hooks 稳定）
				h("div", { className: "mpw_tabBody", ref: tabBodyRef }, [
				// 内层 flex 行：translateX 滑动（外层裁剪区固定，否则整体左移内容全空——用户实测）
				h("div", { className: "mpw_tabRow", style: { transform: "translateX(-" + Math.max(0, TAB_ORDER.indexOf(tabSafe)) * 100 + "%)" } }, [
				// source 组
				h("div", { "data-mpw-tabkey": "source", style: { flex: "0 0 100%", minWidth: "100%", boxSizing: "border-box", paddingRight: "4px" } }, [
				// ═══ 背景来源 ═══
				h("div", { className: "mpw_section" }, t("sec.source")),

				// ④ 总开关：开启/关闭整个功能
				h("div", { className: "mpw_field" }, [
					h("label", { className: "mpw_label" }, t("master")),
					h("div", { className: "mpw_inline" }, [
						h(Toggle, {
							checked: section.enabled !== void 0 ? !!section.enabled : DEFAULT_ENABLED,
							onChange: onMaster
						}),
						h("span", { className: "mpw_hint" }, section.enabled !== void 0 && !section.enabled ? t("master.off") : t("master.desc"))
					]),
					conflicts.length ? h("p", { className: "mpw_hint" }, `${t("conflict.detected")}：${conflicts.join(", ")}`) : null
				]),

				// ①(新) 大文件混合模式开关（背景来源组）
				toggleRow(t("hybrid"), t("hybrid.desc"), "hybrid", DEFAULT_HYBRID),
				// ③(#4 用户要求) 宿主端状态说明紧跟在"上传到 DSH 进程流式播放"开关的说明文字下面
				h("p", { className: "mpw_hint" },
					t("hybrid.status") + ": " + ((section.hybrid !== void 0 ? !!section.hybrid : DEFAULT_HYBRID)
						? (hostOk === true ? t("hybrid.status.ok")
							: hostOk === false ? t("hybrid.status.fallback")
							: t("hybrid.status.detecting"))
						: t("hybrid.status.browserOnly"))),

				// ═══ 当前壁纸展示（#7/#8/#10/#11/#12/#13 用户要求重做）═══
				//  [预览图]  小鸟游星野01_04.mpkg          ← 主名称（显示名，超长省略号）
				//            (bgcs_abydos03.mp4)            ← 次名称（容器内源文件）
				//            壁纸类型: mp4
				//            暂停壁纸 刷新壁纸 清除壁纸
				(() => { try {
					// ①(#1 修复) 重启后 mpkgMeta 为 null（custom 包无 info）→ **持久化字段优先**：
					//   section.source = 容器内实际文件（bgcs_abydos03.mp4）、section.mpkgName = 显示名。
					const srcName = section.source || section.entryName || (mpkgMeta && mpkgMeta.entryName) || "";
					const dispName = section.mpkgName || (mpkgMeta && mpkgMeta.name) || srcName || "";
					const innerName = section.source || section.entryName || (mpkgMeta && mpkgMeta.entryName) || "";
					const typeStr = section.converted === "mp4" ? "mp4"
						: section.converted === "web" ? "web"
						: section.converted === "scene" ? "scene"
						: section.converted === "gif" ? "gif"
						: (() => {
							const m = /\.([a-z0-9]+)(?:$|[?#])/i.exec(innerName || srcName || "");
							const ext = m ? m[1].toLowerCase() : "";
							if (ext === "mpkg" || ext === "pkg") return "scene";
							return ext || (section.image ? "image" : "");
						})();
					const has = !!(section.image || section.webUrl);
					// 预览图：mpkg 容器内预览（服务端 custom-mpkg-preview；容器内自带 preview.gif 或首帧）
					let prevSrc = "";
					try {
						const keyRaw = section.mpkgKey || (mpkgMeta && mpkgMeta.key) || "";
						const pf = keyRaw.indexOf("|") >= 0 ? keyRaw.split("|")[1] : keyRaw;
						const file = pf && pf.indexOf("/") >= 0 ? pf.split("/").pop() : (pf || srcName);
						const host = (typeof HOST_BASE !== "undefined" && HOST_BASE) ? HOST_BASE : "";
						if (file && /\.mpkg$/i.test(file)) prevSrc = host + "/custom-mpkg-preview?file=" + encodeURIComponent(file);
						else if (srcName && /\.(gif|png|jpe?g|webp)$/i.test(srcName)) prevSrc = host + "/custom-media?custom=1&file=" + encodeURIComponent(srcName);
					} catch (e) {}
					const ell = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" };
					return h("div", { className: "mpw_field" }, [
						h("div", { style: { display: "flex", alignItems: "center", gap: "10px", width: "100%" } }, [
							// ①(#7/#12) 左侧预览图：固定 16:9 缩略，垂直居中于文字块
							// ①(2026-09-12 用户定案) 直接照搬"自定义本地壁纸目录"列表里的预览元素（他确认那套显示正确）：
							//   mpkg → 容器内 preview 图（custom-mpkg-preview）；视频 → <video preload=metadata> 首帧；
							//   图片 → <img>。外框用 .mpw_wallThumb（94×52 = 列表 72×40 的 1.3 倍），内层仍用 .mpw_thumbImg。
							h("div", { className: "mpw_wallThumb" }, [
								!has ? h("span", { className: "mpw_hint", style: { margin: 0 } }, t("none"))
									: (() => {
										const keyRaw = section.mpkgKey || "";
										const rawFile = keyRaw.indexOf("|") >= 0 ? keyRaw.split("|")[1] : keyRaw;
										const folder = rawFile && rawFile.indexOf("/") >= 0 ? rawFile.split("/")[0] : "";
										const file = rawFile && rawFile.indexOf("/") >= 0 ? rawFile.split("/").pop() : rawFile;
										const isMpkg = file && /\.mpkg$/i.test(file);
										const srcName2 = innerName || "";
										const isVideo = section.converted === "mp4" || /\.(mp4|webm|mkv)$/i.test(srcName2);
										if (isMpkg) {
											const url = HOST_BASE + "/custom-mpkg-preview?" + (folder ? "folder=" + encodeURIComponent(folder) + "&" : "") + "file=" + encodeURIComponent(file);
											return h("img", { className: "mpw_thumbImg", src: url, alt: "", loading: "lazy", decoding: "async",
												onError: (ev) => { try { ev.target.style.display = "none" } catch {} } });
										}
										if (isVideo && section.image) {
											return h("video", { className: "mpw_thumbImg", src: resolveHostUrl(section.image), muted: true, playsInline: true, preload: "metadata",
												onLoadedMetadata: (ev) => { try { const v = ev.target; if (v.duration && v.duration > 0.1) v.currentTime = 0.05 } catch {} },
												onError: (ev) => { try { ev.target.style.display = "none" } catch {} } });
										}
										if (section.image) {
											return h("img", { className: "mpw_thumbImg", src: resolveHostUrl(section.image), alt: "", loading: "lazy", decoding: "async",
												onError: (ev) => { try { ev.target.style.display = "none" } catch {} } });
										}
										return h("span", { className: "mpw_hint", style: { margin: 0 } }, t("none"));
									})()
							]),
							// ②(#8/#10/#11/#13) 右侧文字块（整体垂直居中）
							h("div", { style: { flex: "1 1 auto", minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", gap: "2px" } }, [
								h("div", { title: dispName || t("none"), style: Object.assign({ fontWeight: 600 }, ell) }, dispName || t("none")),
								h("div", { title: innerName || "", className: "mpw_hint", style: Object.assign({ margin: 0 }, ell) }, "(" + (innerName || t("none")) + ")"),
								h("div", { className: "mpw_hint", style: { margin: 0 } }, t("wall.type") + ": " + (typeStr || t("none"))),
								h("div", { className: "mpw_inline", style: { marginTop: "4px" } }, [
									(section.converted === "mp4" || section.converted === "web") ? h("button", { className: "mpw_reset", type: "button", onClick: () => { toggleWallPause(); } }, wallPausedByUser ? t("pause.play") : t("pause.pause")) : null,
									h("button", { className: "mpw_reset", type: "button", onClick: refreshBg }, t("refresh.bg")),
									h("button", { className: "mpw_reset", type: "button", onClick: clearBg }, t("clear.bg"))
								])
							])
						])
					]);
				} catch (e) {
					try { console.warn("[dsh-mpkg-wallpaper] 当前壁纸展示区渲染失败:", e); } catch {}
					return h("p", { className: "mpw_hint" }, (section.mpkgName || section.source || t("none")));
				} })(),

				// ④(新) 时间变化壁纸：时段手动锁定/切换（Auto=按时间自动；点击槽位按钮手动固定）
				(section.timeConfig && section.timeConfig.enabled && section.timeVideos && section.timeVideos.length) ? h("div", { className: "mpw_field" }, [
					h("label", { className: "mpw_label" }, t("time.slot")),
					h("div", { className: "mpw_inline", style: { flexWrap: "wrap" } }, [
						h("button", {
							className: "mpw_reset" + (!section.timeOverride ? " mpw_timeActive" : ""),
							type: "button",
							onClick: () => swapTimeSlot(slotForTime(section.timeConfig, new Date()), false)
						}, t("time.auto")),
						["morning", "day", "dusk", "night"].filter((sl) => section.timeVideos.some((l) => l.slot === sl)).map((sl) => h("button", {
							className: "mpw_reset" + (section.timeOverride === sl ? " mpw_timeActive" : ""),
							type: "button",
							key: sl,
							onClick: () => swapTimeSlot(sl, true)
						}, t("time." + sl)))
					]),
					section.timeOverride ? h("p", { className: "mpw_hint" }, t("time.locked")) : null
				]) : null,

				// 静音开关已挪到「壁纸设置」tab（与当前壁纸直接相关）
				// ①(新) 自定义本地壁纸目录（任意文件夹，不限于 Wallpaper Engine）
				h("div", { className: "mpw_field" }, [
					h("label", { className: "mpw_label" }, t("lib.custom")),
					h("p", { className: "mpw_hint" }, t("lib.customHint")),
					h("div", { className: "mpw_inline" }, [
						h("input", { className: "mpw_input", type: "text", style: { flex: 1, minWidth: 0 },
							value: customDir,
							placeholder: t("lib.dirPlaceholder"),
							onInput: (ev) => setCustomDirState(ev.target.value) }),
						h("button", { className: "mpw_fileBtn", type: "button", onClick: () => openDirPicker(customDir || (section.customDirPath || "")) }, t("lib.browse")),
						h("button", { className: "mpw_fileBtn", type: "button", onClick: () => {
							// ①(修正) 扫描只持久化目录路径，不触发 applyFromStorage
							//（commit 会重应用当前壁纸 → web iframe/大视频重新加载，用户实测很慢）。
							// writeSection 持久化 + setSection 更新输入框状态，壁纸保持不动。
							const dir = customDir.trim();
							if (dir && dir !== (section.customDirPath || "")) {
								writeSection(Object.assign({}, readSection(), { customDirPath: dir }), true);
								setSection(readSection());
							}
							scanCustomDir();
						} }, t("lib.scanDir"))
					]),
					customFiles && customFiles.length ? h("p", { className: "mpw_hint" }, t("lib.dirFound") + customFiles.length + t("lib.dirFiles")) : null,
					wallList.length ? h("div", { className: "mpw_inline" }, [
						h("button", { className: "mpw_reset mpw_moreBtn", type: "button", onClick: () => setLibOpen(!libOpen) }, libOpen ? t("lib.collapse") : t("lib.expandAll") + `（${wallList.length}）`)
					]) : null,
					libOpen && wallList.length ? h("div", { className: "mpw_props mpw_wallGrid", ref: wallGridRef, onScroll: wallGridScroll.onScroll, style: { maxHeight: 260, overflowY: "auto", overscrollBehavior: wallGridScroll.overscrollBehavior, overflowAnchor: wallGridScroll.overflowAnchor } }, [
						wallList.slice(0, libShow).map((w, wi) => h("div", { className: "mpw_prop mpw_wallProp", key: w.key }, [
							h("div", { className: "mpw_inline", style: { alignItems: "flex-start", flexWrap: "nowrap" } }, [
								// ①(新) 扫描结果预览缩略图（借鉴 elysia395/dsh-wallpaper-engine 的 preview 样式）
								h("div", { className: "mpw_thumb" }, [
									// ①(修正) 视频/动图项用 <video> 首帧预览（muted + preload=metadata 显示第一帧）；
									// 图片项用 <img>（参照 elysia395 的 preview 显示）
									// ①(修正) mpkg 项用容器内 preview 图（custom-mpkg-preview 路由）；视频用首帧；图片直接用
									w.type === "mpkg"
										? h("img", { className: "mpw_thumbImg", src: HOST_BASE + "/custom-mpkg-preview?" + (w.folderMpkg ? "folder=" + encodeURIComponent(w.folderName) + "&" : "") + "file=" + encodeURIComponent(w.folderMpkg ? w.mpkgFile : w.name), alt: "", loading: "lazy", decoding: "async",
											onError: (ev) => { ev.target.style.display = "none"; } })
										: ((w.type === "video" || w.converted === "mp4")
											? h("video", { className: "mpw_thumbImg", src: resolveHostUrl(w.image), muted: true, playsInline: true, preload: "metadata",
												// ①(修正) 视频封面：loadedmetadata 后 seek 到 0.05s 触发首帧绘制（部分浏览器默认不显示首帧）
												onLoadedMetadata: (ev) => { try { const v = ev.target; if (v.duration && v.duration > 0.1) v.currentTime = 0.05; } catch {} },
												onError: (ev) => { ev.target.style.display = "none"; } })
											// ①(MERGED-3 1.1) scene 项缩略图走渲染器首帧缓存路由（cache→frame→preview 三级回退）
											: h("img", { className: "mpw_thumbImg", src: w.type === "scene" ? sceneThumbSrc(sceneThumbUrlCustom(w.name, w.media || "scene.pkg"), w.key) : resolveHostUrl(w.image), alt: "", loading: "lazy", decoding: "async",
												onError: (ev) => { ev.target.style.display = "none"; } }))
								]),
								h("div", { style: { flex: 1, minWidth: 0 } }, [
									h("div", { className: "mpw_propLabel" }, h("b", null, w.title)),
									h("div", { className: "mpw_inline" }, [
										h("span", { className: "mpw_hint" }, w.type),
										// ①(新) 网页壁纸风险预检徽标
										w.type === "web" && w.webHeavy ? h("span", { className: "mpw_hint", style: { color: "#e0a33c" } }, "⚠重动画") : null,
										w.type === "web" && w.webExternal ? h("span", { className: "mpw_hint", style: { color: "#e0735c" } }, "🌐外网") : null,
										h("button", { className: "mpw_reset mpw_moreBtn", type: "button", onClick: () => { setWallIdx(wallList.indexOf(w)); applyWallFromList(w); } }, t("lib.use"))
									])
								])
							])
						])),
						wallList.length > libShow
							? h("button", { className: "mpw_reset mpw_moreBtn", type: "button", onClick: () => setLibShow(libShow + 10) }, t("lib.more") + "（" + (wallList.length - libShow) + "）")
							: null
					]) : null
				]),

				// ④(新) 本地壁纸库（Steam 自动发现）
				h("div", { className: "mpw_field" }, [
					h("label", { className: "mpw_label" }, t("lib.title")),
					h("div", { className: "mpw_inline" }, [
						h("button", { className: "mpw_fileBtn", type: "button", onClick: scanLibrary }, libBusy ? t("mpkg.busy") : t("lib.scan")),
						h("span", { className: "mpw_hint" }, t("lib.desc"))
					]),
					libWalls && libWalls.length
						? h("div", { className: "mpw_inline" }, [
							h("button", { className: "mpw_reset mpw_moreBtn", type: "button", onClick: () => setLibOpen(!libOpen) }, libOpen ? t("lib.collapse") : t("lib.expandAll") + `（${libWalls.length}）`)
						])
						: null,
					libOpen && libWalls && libWalls.length
						? h("div", { className: "mpw_props mpw_wallGrid", ref: wallGridSteamRef, onScroll: steamGridScroll.onScroll, style: { maxHeight: 220, overflowY: "auto", overscrollBehavior: steamGridScroll.overscrollBehavior, overflowAnchor: steamGridScroll.overflowAnchor } }, [
							libWalls.slice(0, libShow).map((wp, wi) => h("div", { className: "mpw_prop mpw_wallProp", key: wp.ltoken }, [
								h("div", { className: "mpw_inline", style: { alignItems: "flex-start", flexWrap: "nowrap" } }, [
									// ①(新) Steam 库预览缩略图（preview 走 /library-web 目录内任意文件；视频用 media 首帧）
									h("div", { className: "mpw_thumb" }, [
										wp.type === "video" && wp.media
											? h("video", { className: "mpw_thumbImg", src: HOST_BASE + "/library-media?ltoken=" + encodeURIComponent(wp.ltoken) + "&file=" + encodeURIComponent(String(wp.media).split(/[\\/]/).pop()), muted: true, playsInline: true, preload: "metadata",
												onLoadedMetadata: (ev) => { try { const v = ev.target; if (v.duration && v.duration > 0.1) v.currentTime = 0.05; } catch {} },
												onError: (ev) => { ev.target.style.display = "none"; } })
											// ①(MERGED-3 1.1) scene 项缩略图走渲染器首帧缓存路由（未命中回退静态帧/预览，不再直连 preview 文件）
											: h("img", { className: "mpw_thumbImg", src: wp.type === "scene" ? sceneThumbSrc(sceneThumbUrlLibrary(wp.ltoken), "library|" + wp.ltoken) : HOST_BASE + "/library-web?ltoken=" + encodeURIComponent(wp.ltoken) + "&file=" + encodeURIComponent(String(wp.preview || "").split(/[\\/]/).pop() || "preview.jpg"), alt: "", loading: "lazy", decoding: "async",
												onError: (ev) => { ev.target.style.display = "none"; } })
									]),
									h("div", { style: { flex: 1, minWidth: 0 } }, [
										h("div", { className: "mpw_propLabel" }, h("b", null, wp.title || wp.ltoken)),
										h("div", { className: "mpw_inline" }, [
											h("span", { className: "mpw_hint" }, wp.type),
											h("button", { className: "mpw_reset mpw_moreBtn", type: "button", onClick: () => {
												// ②(修正) 用 wallList 中的索引对齐轮播（wallIdx 是 wallList 下标）
												const mi = wallList.findIndex((w) => w.key === "steam|" + wp.ltoken);
												if (mi >= 0) setWallIdx(mi);
												applyLibraryWallpaper(wp);
											} }, t("lib.use"))
										])
									])
								])
							])),
							libWalls.length > libShow
								? h("button", { className: "mpw_reset mpw_moreBtn", type: "button", onClick: () => setLibShow(libShow + 10) }, t("lib.more") + "（" + (libWalls.length - libShow) + "）")
								: null
						])
						: libWalls && !libWalls.length ? h("p", { className: "mpw_hint" }, t("lib.empty")) : null
				]),
				// ②③(新) 下一个壁纸 + 定时轮换 + ⑳(新) 轮播列表（WE 原生播放列表风格）
				h("div", { className: "mpw_field" }, [
					h("label", { className: "mpw_label" }, t("lib.rotate")),
					h("div", { className: "mpw_inline" }, [
						h("button", { className: "mpw_reset", type: "button", onClick: prevWallpaper }, t("lib.prev")),
						h("button", { className: "mpw_reset", type: "button", onClick: nextWallpaper }, t("lib.next")),
						h(Toggle, { checked: section.rotate !== void 0 ? !!section.rotate : DEFAULT_ROTATE, onChange: (v) => commit({ rotate: v }) }),
						h("span", { className: "mpw_hint" }, t("lib.rotateDesc"))
					]),
					// ⑳(新) 轮播列表：选择激活列表（自定义下拉）+ 管理 + 新建
					h("div", { className: "mpw_inline", style: { marginTop: 4 } }, [
						h(SelectBox, { name: "rotGroup", value: section.rotGroupId || "", placeholder: t("rot.all"),
							options: [{ value: "", label: t("rot.all") }].concat((section.rotGroups || []).map((g) => ({ value: g.id, label: g.name + "（" + (g.keys || []).length + "）" }))),
							onChange: (v) => commit({ rotGroupId: v }, true) }),
						h("button", { className: "mpw_reset mpw_moreBtn", type: "button", onClick: () => setRotModal(true) }, t("rot.manage")),
						h("button", { className: "mpw_reset mpw_moreBtn", type: "button", onClick: () => { setRotEdit({ id: "", name: "", interval: 5, order: "sequence", keys: [] }); setRotEditor(true); } }, t("rot.new"))
					]),
					h("div", { style: { display: (section.rotate !== void 0 ? !!section.rotate : DEFAULT_ROTATE) ? "" : "none" } },
						sliderRow(t("lib.rotateMin"), "rotateMin", 1, 120, t("lib.minutes"), 1, 5)),
					// ①(修正) 选中列表后：单独设置该列表的轮换间隔（用户要求，编辑弹窗不再设间隔）
					(section.rotGroupId && (section.rotGroups || []).find((g) => g.id === section.rotGroupId))
						? h("div", { className: "mpw_inline", style: { marginTop: 4 } }, [
							h("span", { className: "mpw_hint" }, t("rot.groupInterval")),
							h("input", { type: "range", min: 1, max: 120, step: 1, style: { flex: 1, minWidth: 0 },
								value: (section.rotGroups || []).find((g) => g.id === section.rotGroupId).interval || 5,
								onChange: (ev) => {
									const v = Math.max(1, parseInt(ev.target.value || "5", 10));
									const groups = (section.rotGroups || []).map((g) => g.id === section.rotGroupId ? Object.assign({}, g, { interval: v }) : g);
									commit({ rotGroups: groups }, true);
								} }),
							h("span", { className: "mpw_hint" }, ((section.rotGroups || []).find((g) => g.id === section.rotGroupId).interval || 5) + t("lib.minutes"))
						])
						: null
				]),
				// ⑳(新) 轮播列表管理弹窗（新建/编辑/删除）
				rotModal ? h(MaskPortal, { onClick: () => setRotModal(false) }, [
					h("div", { className: "mpw_dialog", style: { width: "min(560px, calc(100vw - 32px))" }, onClick: (ev) => ev.stopPropagation() }, [
						h("div", { className: "mpw_title" }, t("rot.title")),
						(section.rotGroups || []).length === 0
							? h("p", { className: "mpw_hint" }, t("rot.empty"))
							: h("div", { style: { maxHeight: 260, overflowY: "auto" } }, (section.rotGroups || []).map((g) => h("div", { className: "mpw_inline", key: g.id, style: { marginBottom: 6 } }, [
								h("span", { className: "mpw_propLabel", style: { flex: 1, minWidth: 0 } }, h("b", null, g.name)),
								h("span", { className: "mpw_hint" }, (g.keys || []).length + t("rot.items") + " · " + (g.interval || 5) + t("lib.minutes") + " · " + (g.order === "random" ? t("rot.random") : t("rot.seq"))),
								h("button", { className: "mpw_reset mpw_moreBtn", type: "button", onClick: () => { setRotEdit(JSON.parse(JSON.stringify(g))); setRotModal(false); setRotEditor(true); } }, t("rot.edit")),
								h("button", { className: "mpw_reset mpw_moreBtn", type: "button", onClick: () => {
									const next = (section.rotGroups || []).filter((x) => x.id !== g.id);
									commit({ rotGroups: next, rotGroupId: section.rotGroupId === g.id ? "" : section.rotGroupId }, true);
								} }, t("rot.del"))
							]))),
						h("div", { className: "mpw_inline", style: { marginTop: 8 } }, [
							h("button", { className: "mpw_button", type: "button", onClick: () => { setRotEdit({ id: "", name: "", interval: 5, order: "sequence", keys: [] }); setRotModal(false); setRotEditor(true); } }, t("rot.new")),
							h("button", { className: "mpw_reset", type: "button", onClick: () => setRotModal(false) }, t("conflict.cancel"))
						])
					])
				]) : null,
				// ⑳(新) 轮播列表编辑弹窗（命名 + 勾选壁纸 + 间隔 + 顺序）
				rotEditor && rotEdit ? h(MaskPortal, { onClick: () => setRotEditor(false) }, [
					h("div", { className: "mpw_dialog", style: { width: "min(560px, calc(100vw - 32px))" }, onClick: (ev) => ev.stopPropagation() }, [
						h("div", { className: "mpw_title" }, rotEdit.id ? t("rot.editTitle") : t("rot.newTitle")),
						// ①(修正) 名称输入框与「图片链接」输入框同款（mpw_input；dialog 是列布局，
						// flex:1 会纵向拉伸 → 显式 flex:none 恢复正常高度）
						h("input", { className: "mpw_input", type: "text", style: { width: "100%", boxSizing: "border-box", flex: "none", marginBottom: 10 }, placeholder: t("rot.namePh"), value: rotEdit.name, onChange: (ev) => setRotEdit(Object.assign({}, rotEdit, { name: ev.target.value })) }),
						// ①(修正) 播放顺序（顺序/随机）；间隔在列表选择下方单独设置
						h("div", { className: "mpw_inline", style: { marginBottom: 8 } }, [
							h("span", { className: "mpw_label", style: { fontSize: 13 } }, t("rot.order")),
							h("button", { className: "mpw_miniBtn" + (rotEdit.order !== "random" ? " mpw_on" : ""), type: "button", onClick: () => setRotEdit(Object.assign({}, rotEdit, { order: "sequence" })) }, t("rot.seq")),
							h("button", { className: "mpw_miniBtn" + (rotEdit.order === "random" ? " mpw_on" : ""), type: "button", onClick: () => setRotEdit(Object.assign({}, rotEdit, { order: "random" })) }, t("rot.random"))
						]),
						h("p", { className: "mpw_hint" }, t("rot.pickHint") + "（" + wallList.length + "）"),
						// ①(修正) 来源过滤 + 扫描入口：误扫自定义目录后也能切回 Steam 库（用户要求"返回"）
						h("div", { className: "mpw_inline", style: { marginBottom: 6 } }, [
							h("button", { className: "mpw_miniBtn" + (rotFilter === "all" ? " mpw_on" : ""), type: "button", onClick: () => setRotFilter("all") }, t("rot.all")),
							h("button", { className: "mpw_miniBtn" + (rotFilter === "custom" ? " mpw_on" : ""), type: "button", onClick: () => setRotFilter("custom") }, t("rot.filterCustom")),
							h("button", { className: "mpw_miniBtn" + (rotFilter === "steam" ? " mpw_on" : ""), type: "button", onClick: () => setRotFilter("steam") }, t("rot.filterSteam")),
							h("button", { className: "mpw_reset mpw_moreBtn", type: "button", onClick: () => { if (customDir) scanCustomDir(); else showError(t("lib.dirEmpty")); } }, t("rot.scanDir")),
							h("button", { className: "mpw_reset mpw_moreBtn", type: "button", onClick: scanLibrary }, t("rot.scanLib"))
						]),
						// ①(修正) 勾选改整行点击；壁纸列表为空时给扫描入口（wallList 是运行时状态，刷新后需重扫）
						wallList.length === 0
							? h("div", { style: { padding: "12px 0" } }, [
								h("p", { className: "mpw_hint", style: { marginBottom: 6 } }, t("rot.noWallpapers")),
								h("div", { className: "mpw_inline" }, [
									h("button", { className: "mpw_reset mpw_moreBtn", type: "button", onClick: () => { if (customDir) scanCustomDir(); else showError(t("lib.dirEmpty")); } }, t("rot.scanDir")),
									h("button", { className: "mpw_reset mpw_moreBtn", type: "button", onClick: scanLibrary }, t("rot.scanLib"))
								])
							])
							: h("div", { ref: rotGridRef, onScroll: rotGridScroll.onScroll, style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, maxHeight: 220, overflowY: "auto", overscrollBehavior: rotGridScroll.overscrollBehavior, overflowAnchor: rotGridScroll.overflowAnchor } }, wallList.filter((w) => rotFilter === "all" ? true : rotFilter === "steam" ? w.src === "steam" : !w.src || w.src !== "steam").map((w) => {
							const on = (rotEdit.keys || []).includes(w.key);
							// ①(修正) 缩略图：与扫描目录网格同款逻辑（mpkg preview / 视频首帧 / 静态图）
							let turl = "";
							try {
								if (w.type === "mpkg") turl = HOST_BASE + "/custom-mpkg-preview?" + (w.folderMpkg ? "folder=" + encodeURIComponent(w.folderName) + "&" : "") + "file=" + encodeURIComponent(w.folderMpkg ? w.mpkgFile : w.name);
								else if (w.image) turl = resolveHostUrl(w.image);
								else if (w.src === "steam" && w.ltoken) {
									if (w.type === "video" && w.media) turl = HOST_BASE + "/library-media?ltoken=" + encodeURIComponent(w.ltoken) + "&file=" + encodeURIComponent(String(w.media).split(/[\\/]/).pop());
									else turl = HOST_BASE + "/library-web?ltoken=" + encodeURIComponent(w.ltoken) + "&file=" + encodeURIComponent(String(w.preview || "").split(/[\\/]/).pop() || "preview.jpg");
								}
							} catch {}
							return h("div", { className: "mpw_pickCard" + (on ? " mpw_on" : ""), key: w.key,
								style: { position: "relative", borderRadius: 10, overflow: "hidden", cursor: "pointer", border: "1px solid " + (on ? "var(--dsw-alias-brand-primary, #4f8cff)" : "var(--dsw-alias-border-l2, #444b5c)"),
									background: on ? "color-mix(in srgb, var(--dsw-alias-brand-primary, #4f8cff) 12%, transparent)" : "var(--dsw-alias-bg-module-platform, #1c2230)" },
								onClick: () => {
									// ①(第13条) 不再手工记 scrollTop：useMpwListScroll 持续跟踪用户位置
									const keys = (rotEdit.keys || []).slice();
									const i = keys.indexOf(w.key);
									if (i >= 0) keys.splice(i, 1); else keys.push(w.key);
									setRotEdit(Object.assign({}, rotEdit, { keys }));
								} }, [
								// ①(修正) 固定 64px 高度容器：**只有真正的视频项**用首帧 <video>；
								// mpkg 项 converted 也是 "mp4" 但缩略 URL 是预览图（图片）——
								// 之前误用 <video> 加载图片 → 必然失败被隐藏 → 缩略图全空白
								h("div", { style: { width: "100%", height: 64, position: "relative", background: "color-mix(in srgb, var(--dsw-alias-interactive-bg-hover, #333a4a) 30%, transparent)" } }, [
									turl && w.type === "video"
										? h("video", { src: turl, muted: true, playsInline: true, preload: "metadata",
											style: { width: "100%", height: 64, objectFit: "cover", display: "block" },
											onLoadedMetadata: (ev) => { try { const v = ev.target; if (v.duration && v.duration > 0.1) v.currentTime = 0.05; } catch {} },
											onError: (ev) => { ev.target.style.display = "none"; } })
										: turl
											? h("img", { src: turl, alt: "", loading: "lazy", style: { width: "100%", height: 64, objectFit: "cover", display: "block" }, onError: (ev) => { ev.target.style.display = "none"; } })
											: null
								]),
								h("div", { style: { display: "flex", alignItems: "center", gap: 6, padding: "6px 8px" } }, [
									h("span", { style: { flex: "none", width: 16, height: 16, borderRadius: 5, border: "1px solid " + (on ? "var(--dsw-alias-brand-primary, #4f8cff)" : "var(--dsw-alias-border-l2, #444b5c)"), display: "flex", alignItems: "center", justifyContent: "center", color: on ? "var(--dsw-alias-brand-primary, #4f8cff)" : "transparent", fontSize: 12 } }, "✓"),
									h("span", { className: "mpw_hint", style: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--dsw-alias-label-primary)", fontSize: 12 } }, w.title)
								])
							]);
						})),
						h("div", { className: "mpw_inline", style: { marginTop: 10 } }, [
							h("button", { className: "mpw_button", type: "button", onClick: () => {
								const groups = (section.rotGroups || []).slice();
								const keys = (rotEdit.keys || []).filter((k) => wallList.some((w) => w.key === k));
								if (!keys.length) { showError(t("rot.emptyKeys")); return; }
								// ①(修正) 未命名列表自动加序号（未命名列表 N），避免两个未命名列表
								// 重名（用户实测：建两个未命名列表选 3 壁纸后名字一样分不清）。
								let gname = rotEdit.name.trim();
								if (!gname) {
									let n = groups.filter((x) => /未命名列表/.test(x.name || "")).length + 1;
									gname = t("rot.unnamed") + " " + n;
									// 防止与已有重名（删过序号后有空洞）
									while (groups.some((x) => x.name === gname)) { n++; gname = t("rot.unnamed") + " " + n; }
								}
								const g = { id: rotEdit.id || ("rot" + Date.now()), name: gname, interval: Math.max(1, rotEdit.interval || (section.rotateMin > 0 ? section.rotateMin : 5)), order: rotEdit.order === "random" ? "random" : "sequence", keys };
								const i = groups.findIndex((x) => x.id === g.id);
								if (i >= 0) groups[i] = g; else groups.push(g);
								commit({ rotGroups: groups, rotGroupId: section.rotGroupId || g.id }, true);
								setRotEditor(false);
							} }, t("rot.save")),
							h("button", { className: "mpw_reset", type: "button", onClick: () => setRotEditor(false) }, t("conflict.cancel"))
						])
					])
				]) : null,


				// 视频倍速 + 可调参数已挪到「壁纸设置」tab（与当前壁纸直接相关）

				// mpkg 文件
				h("div", { className: "mpw_field" }, [
					h("div", { className: "mpw_inline" }, [
						h("button", { className: "mpw_fileBtn", type: "button", onClick: () => mpkgRef.current && mpkgRef.current.click() },
							busy ? t("mpkg.busy") : t("mpkg.pick")),
						h("span", { className: "mpw_hint" }, t("mpkg.hint"))
					]),
					h("input", { ref: mpkgRef, type: "file", accept: ".mpkg,.mp4,.webm,.mkv,.mov", style: { display: "none" }, onChange: onMpkg })
				]),

				// 可调参数（mpkg 只读 / web 可改）已挪到「壁纸设置」tab

				// 图片链接
				h("div", { className: "mpw_field" }, [
					h("label", { className: "mpw_label" }, t("url.label")),
					h("div", { className: "mpw_inline" }, [
						h("input", {
							className: "mpw_input", type: "text", value: url,
							placeholder: t("url.placeholder"),
							onChange: (ev) => setUrl(ev.target.value),
							onKeyDown: (ev) => { if (ev.key === "Enter") applyUrl(); }
						}),
						h("button", { className: "mpw_button", type: "button", onClick: applyUrl }, t("url.apply"))
					])
				]),

				// 本地图片/动图
				h("div", { className: "mpw_field" }, [
					h("div", { className: "mpw_inline" }, [
						h("button", { className: "mpw_fileBtn", type: "button", onClick: () => imgRef.current && imgRef.current.click() }, t("file.pick")),
						h("span", { className: "mpw_hint" }, t("file.hint"))
					]),
					h("input", { ref: imgRef, type: "file", accept: "image/*,.gif,.mp4,.webm,.mkv,.mov", style: { display: "none" }, onChange: onMedia })
				]),

				]),
				// ═══ 壁纸设置 ═══
				h("div", { "data-mpw-tabkey": "wallpaper", style: { flex: "0 0 100%", minWidth: "100%", boxSizing: "border-box", paddingRight: "4px" } }, [
				h("div", { className: "mpw_section" }, t("sec.wallpaper")),

				// ①(新) 静音开关（web 壁纸声音；默认开启）
				toggleRow(t("mute"), t("mute.desc"), "mute", true),
				// ①(新) 壁纸镜像翻转（Wallpaper Engine 原生基础选项）
				h("div", { className: "mpw_inline" }, [
					toggleRow(t("flipX"), t("flipX.desc"), "flipX", false),
					toggleRow(t("flipY"), t("flipY.desc"), "flipY", false)
				]),

				// 解码帧率上限：源帧率超过上限的视频会被转码到上限（0=不限制）；保存到 section.fpsCap
				h("div", { className: "mpw_field" }, [
					h("label", { className: "mpw_label" }, t("fpsCap")),
					h("div", { className: "mpw_inline", style: { flexWrap: "wrap" } }, [
						{ v: 0, label: t("fpsCap.off") },
						{ v: 60, label: "60" },
						{ v: 48, label: "48" },
						{ v: 30, label: "30" },
						{ v: 24, label: "24" }
					].map((o) => h("button", {
						className: "mpw_reset" + (fpsCapVal === o.v ? " mpw_timeActive" : ""),
						type: "button",
						key: o.v,
						onClick: () => setFpsCap(o.v)
					}, o.label)))
				]),
				h("p", { className: "mpw_hint" }, t("fpsCap.hint")),

				// ①(新) 分辨率上限：视频壁纸源分辨率超过上限时，host ffmpeg 转码缩放（保持宽高比）
				h("div", { className: "mpw_field" }, [
					h("label", { className: "mpw_label" }, t("resMax")),
					h("div", { className: "mpw_inline", style: { flexWrap: "wrap" } }, [
						{ v: 0, label: t("resMax.off") },
						{ v: 1280, label: "720p" },
						{ v: 1920, label: "1080p" },
						{ v: 2560, label: "2K" }
					].map((o) => h("button", {
						className: "mpw_reset" + (resMaxVal === o.v ? " mpw_timeActive" : ""),
						type: "button",
						key: o.v,
						onClick: () => setResMax(o.v)
					}, o.label)))
				]),
				h("p", { className: "mpw_hint" }, t("resMax.hint")),

				// ⑳(新) 视频倍速分段条（当前壁纸的播放倍速；点击/拖拽定位档位）
				h("div", { className: "mpw_field" }, [
					h("label", { className: "mpw_label" }, t("speed") + " · " + (section.playbackRate !== void 0 ? section.playbackRate : DEFAULT_PLAYBACK_RATE) + "x"),
					h(SpeedBar, { value: section.playbackRate !== void 0 ? section.playbackRate : DEFAULT_PLAYBACK_RATE, onChange: (v) => {
						commit({ playbackRate: v }, true);
						// ⑳(新) web 壁纸：立即把倍速应用到 iframe 内视频（不重载 iframe）
						try { applyWebSpeed(bgElements().frame); } catch {}
					} }),
					h("p", { className: "mpw_hint" }, t("speed.hint"))
				]),

				// ffmpeg 状态：显示 系统已装/缓存已装/未安装；未安装时提供「下载 ffmpeg（安装到缓存）」，
				// 缓存已装时提供「卸载（只删缓存，不动系统）」。
				h("div", { className: "mpw_field" }, [
					h("label", { className: "mpw_label" }, t("ffmpeg.status")),
					ffStatus ? h("p", { className: "mpw_hint" + (ffmpegState && ffmpegState.error ? " mpw_err" : ""), style: { wordBreak: "break-all" } }, ffStatus) : null,
					ffShowDownload ? h("div", { className: "mpw_inline" }, [
						h("button", {
							className: "mpw_button",
							type: "button",
							disabled: !!(ffmpegState && ffmpegState.downloading),
							onClick: downloadFfmpeg
						}, ffmpegState && ffmpegState.downloading ? t("ffmpeg.downloading") : t("ffmpeg.download")),
						// ①(修正) 标明下载→安装到缓存；卸载只删缓存、绝不碰系统 PATH/env
						h("span", { className: "mpw_hint" }, t("ffmpeg.downloadHint"))
					]) : null,
					ffShowUninstall ? h("div", { className: "mpw_inline" }, [
						h("button", {
							className: "mpw_reset",
							type: "button",
							disabled: !!(ffmpegState && ffmpegState.busy),
							onClick: uninstallFfmpeg
						}, ffmpegState && ffmpegState.busy ? t("ffmpeg.uninstalling") : t("ffmpeg.uninstall")),
						h("span", { className: "mpw_hint" }, t("ffmpeg.uninstallHint"))
					]) : null
				]),

				// ⑥(修正) 壁纸画面（从「外观」挪入，独立分类）：磨砂模糊/镜头缩放/画面亮度/镜头位置
				h("div", { className: "mpw_section" }, t("sec.picture")),
					sliderRow(t("blur"), "blur", 0, 40, "px", 1, DEFAULT_BLUR),
					((section.unifyTint !== void 0 ? !!section.unifyTint : DEFAULT_UNIFY_TINT) && (section.chatFollow !== void 0 ? !!section.chatFollow : DEFAULT_CHAT_FOLLOW))
						? h("p", { className: "mpw_hint" }, t("blur.overridden"))
						: null,
					sliderRow(t("zoom"), "zoom", 10, 2000, "%", 5, DEFAULT_ZOOM),
					sliderRow(t("brightness"), "brightness", 50, 150, "%", 1, DEFAULT_BRIGHTNESS),
					h("div", { className: "mpw_field" }, [
						h("label", { className: "mpw_label" }, t("lens.pos")),
						h("div", { className: "mpw_inline" }, [
							h("input", {
								className: "mpw_numInput", type: "text", inputMode: "decimal", autoComplete: "off",
								defaultValue: section.lensX !== void 0 ? section.lensX : 0,
								onInput: (ev) => {
									let raw = ev.target.value;
									raw = raw.replace(/[^0-9.-]/g, "");
									const firstMinus = raw.indexOf("-");
									if (firstMinus > 0) raw = raw.slice(0, firstMinus) + raw.slice(firstMinus + 1);
									const minus = raw.startsWith("-") ? "-" : "";
									const body = minus ? raw.slice(1) : raw;
									const dot = body.indexOf(".");
									let clean = dot >= 0 ? body.slice(0, dot + 1) + body.slice(dot + 1).replace(/\./g, "").slice(0, 2) : body;
									if (clean.length > 7) clean = clean.slice(0, 7);
									raw = minus + clean;
									if (ev.target.value !== raw) ev.target.value = raw;
									if (raw === "" || raw === "-" || raw === "." || raw === "-." || isNaN(Number(raw))) return;
									const v = Number(raw);
									if (!isNaN(v)) commit({ lensX: Math.max(-2000, Math.min(2000, v)) });
								},
								onKeyDown: (ev) => {
									if (ev.key === "e" || ev.key === "E" || ev.key === "+") ev.preventDefault();
								}
							}),
							h("input", {
								className: "mpw_numInput", type: "text", inputMode: "decimal", autoComplete: "off",
								defaultValue: section.lensY !== void 0 ? section.lensY : 0,
								onInput: (ev) => {
									let raw = ev.target.value;
									raw = raw.replace(/[^0-9.-]/g, "");
									const firstMinus = raw.indexOf("-");
									if (firstMinus > 0) raw = raw.slice(0, firstMinus) + raw.slice(firstMinus + 1);
									const minus = raw.startsWith("-") ? "-" : "";
									const body = minus ? raw.slice(1) : raw;
									const dot = body.indexOf(".");
									let clean = dot >= 0 ? body.slice(0, dot + 1) + body.slice(dot + 1).replace(/\./g, "").slice(0, 2) : body;
									if (clean.length > 7) clean = clean.slice(0, 7);
									raw = minus + clean;
									if (ev.target.value !== raw) ev.target.value = raw;
									if (raw === "" || raw === "-" || raw === "." || raw === "-." || isNaN(Number(raw))) return;
									const v = Number(raw);
									if (!isNaN(v)) commit({ lensY: Math.max(-2000, Math.min(2000, v)) });
								},
								onKeyDown: (ev) => {
									if (ev.key === "e" || ev.key === "E" || ev.key === "+") ev.preventDefault();
								}
							}),
							h("span", { className: "mpw_hint" }, `${t("lens.x")} / ${t("lens.y")}`),
							h("button", { className: "mpw_reset mpw_miniBtn", type: "button", onClick: () => commit({ lensX: 0, lensY: 0 }, true) }, t("default"))
						])
					]),


				// 可调参数展示（④(重做)：默认折叠成「展开全部」按钮。
				// ②(修正) mpkg → 只读 + "暂不可用"（浏览器显示的是预渲染素材，改不了）；
				// web 壁纸（L2D 类 loadJson SettingModel）→ 同一折叠区，**可改**（分辨率/
				// 语言/音量写入 iframe 同源 localStorage）。两者共用 propsExpanded 折叠。
				((mpkgMeta && mpkgMeta.info && section.fromMpkg && allProps.length) || webCfg) ? h("div", { className: "mpw_field" }, [
					h("label", { className: "mpw_label" },
						`${t("props.title")}${webCfg ? "" : `（${t("props.unavailable")}）`}`),
					h("p", { className: "mpw_hint" }, webCfg ? t("webcfg.desc") : t("props.desc")),
					propsExpanded ? h("div", { className: "mpw_props" }, [
						// ── mpkg 只读参数列表 ──
						mpkgMeta && mpkgMeta.info && section.fromMpkg && allProps.length ? propsToShow.map((p) => {
							// 纯展示性条目（作者信息/说明）：不渲染输入框
							if (p.displayOnly) {
								return h("div", { className: "mpw_prop mpw_static", key: p.key },
									h("span", { className: "mpw_propLabel" }, p.label));
							}
							const edited = propEdits[p.key] !== void 0 ? propEdits[p.key] : p.value;
							const isBool = typeof p.value === "boolean";
							const fmt = (v) => {
								if (typeof v === "boolean") return v ? t("props.on") : t("props.off");
								if (Array.isArray(p.options) && p.options.length) {
									const o = p.options.find((x) => String(x.value) === String(v));
									return o ? cleanLabel(o.label) : String(v);
								}
								return String(v);
							};
							return h("div", { className: "mpw_prop", key: p.key }, [
								h("div", { className: "mpw_propLabel" }, h("b", null, p.label)),
								h("span", { className: "mpw_propValue" }, fmt(edited))
							]);
						}) : null,
						!tvEnabled ? h("p", { className: "mpw_hint" }, t("props.tvOff")) : null,
						// ── web 壁纸可改选项（分辨率/语言/音量，写入 iframe localStorage）──
						webCfg ? h("div", { className: "mpw_props" }, [
							webCfg.model && webCfg.model.resolution ? h("div", { className: "mpw_inline", style: { flexWrap: "wrap", marginTop: 4 } }, [
								["2k", "4k", "8k"].map((r) => h("button", {
									className: "mpw_reset" + (String(webCfg.model.resolution).toLowerCase() === r ? " mpw_timeActive" : ""),
									type: "button", key: r,
									onClick: () => applyWebCfg({ resolution: r })
								}, r + (r === "8k" ? "（重）" : "")))
							]) : null,
							webCfg.languages && webCfg.languages.length ? h("div", { className: "mpw_inline", style: { flexWrap: "wrap", marginTop: 4 } }, [
								webCfg.languages.map((lg) => h("button", {
									className: "mpw_reset" + (String(webCfg.model.language) === lg ? " mpw_timeActive" : ""),
									type: "button", key: lg,
									onClick: () => applyWebCfg({ language: lg })
								}, lg))
							]) : null,
							typeof webCfg.model.bgmVolume === "number" ? h("div", { className: "mpw_field" }, [
								h("label", { className: "mpw_label" }, t("webcfg.bgm") + " · " + Math.round((webCfg.model.bgmVolume || 0) * 100) + "%"),
								h("input", { className: "mpw_slider", type: "range", min: 0, max: 1, step: 0.01, value: webCfg.model.bgmVolume || 0,
									onChange: (ev) => applyWebCfg({ bgmVolume: Number(ev.target.value) }, true) })
							]) : null,
							typeof webCfg.model.talkVolume === "number" ? h("div", { className: "mpw_field" }, [
								h("label", { className: "mpw_label" }, t("webcfg.talk") + " · " + Math.round((webCfg.model.talkVolume || 0) * 100) + "%"),
								h("input", { className: "mpw_slider", type: "range", min: 0, max: 1, step: 0.01, value: webCfg.model.talkVolume || 0,
									onChange: (ev) => applyWebCfg({ talkVolume: Number(ev.target.value) }, true) })
							]) : null,
							webCfg.model.showTouch !== void 0 ? h("div", { className: "mpw_inline" }, [
								h(Toggle, { checked: !!webCfg.model.showTouch, onChange: (v) => applyWebCfg({ showTouch: v }) }),
								h("span", { className: "mpw_hint" }, t("webcfg.touch"))
							]) : null,
							webCfg.model.showTalkDialog !== void 0 ? h("div", { className: "mpw_inline" }, [
								h(Toggle, { checked: !!webCfg.model.showTalkDialog, onChange: (v) => applyWebCfg({ showTalkDialog: v }) }),
								h("span", { className: "mpw_hint" }, t("webcfg.talkbox"))
							]) : null
						]) : null,
						// ⑥(重做) 重置壁纸参数：放进折叠内容区（展开参数后显示在列表末尾）
						h("div", { className: "mpw_inline", style: { marginTop: 6 } }, [
							h("button", { className: "mpw_reset mpw_moreBtn", type: "button", onClick: () => {
								const s = readSection();
								if (!s.mpkgKey) { setHint(t("props.none")); return; }
								const pe = Object.assign({}, s.propEdits || {});
								delete pe[s.mpkgKey];
								const next = Object.assign({}, s, { propEdits: pe });
								writeSection(next, true);
								setSection(next);
								setHint(t("props.resetDone"));
							} }, t("props.resetWallpaper"))
						])
					]) : null,
					h("div", { className: "mpw_inline" }, [
						h("button", { className: "mpw_reset mpw_moreBtn", type: "button", onClick: () => setPropsExpanded(!propsExpanded) },
							propsExpanded ? t("props.collapse") : t("props.expand") + `（${webCfg ? webCfgCount : propsShown.length}）`)
					])
				]) : null,
				// ①(新) 省电（从「其他」tab 挪到壁纸设置最下面）：遮挡暂停三档（tab 内结尾）
				h("div", { className: "mpw_section" }, t("sec.power")),
				toggleRow(t("powPauseHidden"), t("powPauseHidden.desc"), "powPauseHidden", false),
				toggleRow(t("powPauseBlur"), t("powPauseBlur.desc"), "powPauseBlur", false),
				toggleRow(t("powPauseBattery"), t("powPauseBattery.desc"), "powPauseBattery", false),
				]),
				// ═══ 外观 ═══
				h("div", { "data-mpw-tabkey": "appearance", style: { flex: "0 0 100%", minWidth: "100%", boxSizing: "border-box", paddingRight: "4px" } }, [
				h("div", { className: "mpw_section" }, t("sec.appearance")),
				// ②(新) 外观组说明：各项作用一目了然
				h("p", { className: "mpw_hint" }, t("sec.appearance.desc")),

				toggleRow(t("float"), t("float.desc"), "float", DEFAULT_FLOAT),
				// ①(新) 主题颜色（accent）：按钮/滑条/选中/链接/发送键跟随（取色盘 + 预置）
				h("div", { className: "mpw_field" }, [
					h("label", { className: "mpw_label" }, t("themeColor")),
					h("div", { className: "mpw_inline" }, [
						h("button", {
							className: "mpw_colorSwatch", "data-mpw-picker-anchor": "themeColor", type: "button",
							style: { background: (section.themeColor && /^#[0-9a-fA-F]{6}$/.test(section.themeColor) ? section.themeColor : "#3964fe") },
							onClick: () => openPicker("themeColor", section.themeColor)
						}),
						...(AQUA_PRESETS.map((hex) => h("button", {
							className: "mpw_presetSwatch", type: "button", title: hex,
							style: { background: hex }, onClick: () => commit({ themeColor: hex }, true)
						}))),
						h("button", { className: "mpw_miniBtn", type: "button", onClick: () => commit({ themeColor: "" }, true) }, t("themeColorReset"))
					]),
					h("p", { className: "mpw_hint" }, t("themeColor.hint"))
				]),
				// ①(修正) 面板颜色匹配壁纸（第5项）：从 Aqua 实验挪到主题颜色区域，
				// 做成开关二选一——开 = 自动匹配壁纸主色（下方「遮罩自定义色」取色盘禁用变灰）；
				// 关 = 手动取色盘选色。默认关（保持原行为，不自动匹配）。
				toggleRow(t("aquaTint"), t("aquaTint.desc"), "aquaTint", DEFAULT_AQUA_TINT),
				// ①(新) 配色（accent）：品牌交互元素（按钮/滑条/选中/链接/发送键）——与主题颜色分工
				h("div", { className: "mpw_field" }, [
					h("label", { className: "mpw_label" }, t("glass.accent")),
					h("div", { className: "mpw_inline" }, [
						h("button", {
							className: "mpw_colorSwatch", "data-mpw-picker-anchor": "accent", type: "button",
							style: { background: (section.accent && /^#[0-9a-fA-F]{6}$/.test(section.accent) ? section.accent : "#3964fe") },
							onClick: () => openPicker("accent", section.accent)
						}),
						...(AQUA_PRESETS.map((hex) => h("button", {
							className: "mpw_presetSwatch", type: "button", title: hex,
							style: { background: hex }, onClick: () => commit({ accent: hex }, true)
						}))),
						h("button", { className: "mpw_miniBtn", type: "button", onClick: () => commit({ accent: "" }, true) }, t("glass.reset"))
					]),
					h("p", { className: "mpw_hint" }, t("glass.accent.hint"))
				]),
				// ①(新) 遮罩自定义色（取色盘，从 Aqua 挪到外观集中管理）
				// ①(修正) 第5项：「面板颜色匹配壁纸」开时自动匹配壁纸，取色盘禁用变灰
				// （二选一，避免手动色与自动采样互相打架）；关 = 取色盘可用。
				h("div", { className: "mpw_field", style: aquaTintOn ? { opacity: 0.45, pointerEvents: "none" } : {} }, [
					h("label", { className: "mpw_label" }, t("aquaColor")),
					h("div", { className: "mpw_inline" }, [
						h("button", {
							className: "mpw_colorSwatch", "data-mpw-picker-anchor": "aquaColor", type: "button",
							style: { background: (section.aquaColor && /^#[0-9a-fA-F]{6}$/.test(section.aquaColor) ? section.aquaColor : "#808080") },
							onClick: () => openPicker("aquaColor", section.aquaColor)
						}),
						...(AQUA_PRESETS.map((hex) => h("button", {
							className: "mpw_presetSwatch", type: "button", title: hex,
							style: { background: hex }, onClick: () => commit({ aquaColor: hex }, true)
						}))),
						h("button", { className: "mpw_miniBtn", type: "button", onClick: () => commit({ aquaColor: "" }, true) }, t("aquaColorReset"))
					]),
					h("p", { className: "mpw_hint" }, t("aquaColor.hint"))
				]),
				// ①(新) 自定义灰字颜色（取色盘，从 Aqua 挪到外观集中管理）
				toggleRow(t("fontColorGray"), t("fontColorGray.desc"), "fontColorGray", false),
				(section.fontColorGray !== void 0 ? !!section.fontColorGray : false)
					? h("div", { className: "mpw_field" }, [
						h("label", { className: "mpw_label" }, t("fontColorGray.color")),
						h("div", { className: "mpw_inline" }, [
							h("button", {
								className: "mpw_colorSwatch", "data-mpw-picker-anchor": "fontColorGrayColor", type: "button",
								style: { background: (section.fontColorGrayColor && /^#[0-9a-fA-F]{6}$/.test(section.fontColorGrayColor) ? section.fontColorGrayColor : "#9aa4b2") },
								onClick: () => openPicker("fontColorGrayColor", section.fontColorGrayColor || "#9aa4b2")
							}),
							...(AQUA_PRESETS.map((hex) => h("button", {
								className: "mpw_presetSwatch", type: "button", title: hex,
								style: { background: hex }, onClick: () => commit({ fontColorGrayColor: hex }, true)
							}))),
							h("button", { className: "mpw_miniBtn", type: "button", onClick: () => commit({ fontColorGrayColor: "" }, true) }, t("aquaColorReset"))
						]),
						h("p", { className: "mpw_hint" }, t("fontColorGray.hint"))
					])
					: null,
				// ①(修正) 面板不透明度已删除：统一虚化开启时它被 sidebarAlpha 取代且无效果，
				// 非统一虚化下也无独立意义 → 移除滑条，保留内部默认值逻辑。
				// ①(修正) 磨砂模糊条：仅当「统一虚化开 + 聊天区跟随开」时被整屏虚化接管 → 禁用并提示；
				// 聊天区跟随关 → 磨砂条恢复可调（聊天区壁纸由它控制，统一虚化只管侧边栏/标题栏）

				// ═══ 透出壁纸（从独立 tab 并入外观）═══
				h("div", { className: "mpw_section" }, t("sec.show")),
				h("p", { className: "mpw_hint" }, t("sec.show.desc")),

				// ⑥ 侧边栏透出开关
				toggleRow(t("sidebar"), t("sidebar.desc"), "sidebar", DEFAULT_SIDEBAR),
				(section.unifyTint !== void 0 ? !!section.unifyTint : DEFAULT_UNIFY_TINT)
					? h("p", { className: "mpw_hint" }, t("sidebar.unifyHint"))
					: null,

				// ①(新) 侧边栏磨砂（Aqua 方案）：与标题栏磨砂同类（区域自身玻璃化），
				// 弹窗打开时自动摘除（防弹窗被模糊层困住）；统一虚化开启时被整屏虚化接管
				// ①(修正) 受「侧边栏透出(sidebar)」控制：侧边栏未透出(或不透明)时禁用变灰，
				// 并注明受侧边栏透出控制（与标题栏透出控制标题栏磨砂同理）。
				// ①(修正 2026-09-13 第5项) 侧边栏磨砂与标题栏磨砂同款：**「侧边栏透出壁纸」关闭时整段收起**
				//   （此前只是禁用变灰 + 提示"需先开启侧边栏透出"，用户要求直接隐藏，与标题栏一致）。
				//   统一虚化开启时：开关+程度条被接管（禁用变灰），并在本项下方就地给接管说明（第6项）。
				h("div", { style: { display: (section.sidebar !== void 0 ? !!section.sidebar : DEFAULT_SIDEBAR) ? "" : "none" } }, [
					toggleRow(t("sidebarBlur"), t("sidebarBlur.desc"), "sidebarBlur", DEFAULT_SIDEBAR_BLUR,
						(section.unifyTint !== void 0 ? !!section.unifyTint : DEFAULT_UNIFY_TINT),
						(section.unifyTint !== void 0 ? !!section.unifyTint : DEFAULT_UNIFY_TINT)),
					h("div", { style: {
						display: (section.sidebarBlur !== void 0 ? !!section.sidebarBlur : DEFAULT_SIDEBAR_BLUR) ? "" : "none",
						opacity: (section.unifyTint !== void 0 ? !!section.unifyTint : DEFAULT_UNIFY_TINT) ? 0.45 : 1,
						pointerEvents: (section.unifyTint !== void 0 ? !!section.unifyTint : DEFAULT_UNIFY_TINT) ? "none" : "auto"
					} },
						sliderRow(t("sidebarBlurAmount"), "sidebarBlurAmount", 0, 40, "px", 1, DEFAULT_SIDEBAR_BLUR_AMOUNT)),
					(section.unifyTint !== void 0 ? !!section.unifyTint : DEFAULT_UNIFY_TINT)
						? h("p", { className: "mpw_hint" }, t("sidebarBlur.overridden"))
						: null,
				]),

				// ⑤ 标题栏透出壁纸（②：与侧边栏透出归一类）
				toggleRow(t("headerBg"), t("headerBg.desc"), "headerBg", DEFAULT_HEADER_BG),
				(section.unifyTint !== void 0 ? !!section.unifyTint : DEFAULT_UNIFY_TINT)
					? h("p", { className: "mpw_hint" }, t("headerBg.unifyHint"))
					: null,

				// ①(重做) 标题栏磨砂：归到「标题栏透出壁纸」下面，透出关闭时隐藏。
				// ①(修正) 统一虚化开启时**被整屏虚化接管**（与侧边栏磨砂一致）：标题栏
				// 磨砂开关禁用、程度条禁用，磨砂/白雾由 unifyAmount/sidebarAlpha 控制；
				// 关掉统一虚化才恢复自由调节（用户要求：统一虚化开时不该被此开关自由关掉）。
				// 开关（headerBg/headerBlur）仍独立：透出关 = 纯白背景。
				h("div", { style: { display: (section.headerBg !== void 0 ? !!section.headerBg : DEFAULT_HEADER_BG) ? "" : "none" } },
					toggleRow(t("headerBlur"), t("headerBlur.desc"), "headerBlur", DEFAULT_HEADER,
						(section.unifyTint !== void 0 ? !!section.unifyTint : DEFAULT_UNIFY_TINT),
						(section.unifyTint !== void 0 ? !!section.unifyTint : DEFAULT_UNIFY_TINT))),
				h("div", { style: {
					display: (section.headerBg !== void 0 ? !!section.headerBg : DEFAULT_HEADER_BG) && (section.headerBlur !== void 0 ? !!section.headerBlur : DEFAULT_HEADER) ? "" : "none",
					opacity: (section.unifyTint !== void 0 ? !!section.unifyTint : DEFAULT_UNIFY_TINT) ? 0.45 : 1,
					pointerEvents: (section.unifyTint !== void 0 ? !!section.unifyTint : DEFAULT_UNIFY_TINT) ? "none" : "auto"
				} },
					sliderRow(t("headerBlurAmount"), "headerBlurAmount", 0, 100, "%", 1, DEFAULT_HEADER_BLUR_AMOUNT)),
				(section.unifyTint !== void 0 ? !!section.unifyTint : DEFAULT_UNIFY_TINT)
					? h("p", { className: "mpw_hint" }, t("headerBlur.overridden"))
					: null,
				// ①(新 2026-09-13 用户要求) 「标题栏磨砂强度」独立滑条：
				//   默认关闭 = 跟随整屏虚化；开启后 **只** 改标题栏的模糊半径（不影响侧边栏/右栏）。
				h("div", { style: { display: (section.headerBg !== void 0 ? !!section.headerBg : DEFAULT_HEADER_BG) ? "" : "none" } },
					toggleRow(t("headerFrostOwn"), t("headerFrostOwn.desc"), "headerFrostOwn", DEFAULT_HEADER_FROST_OWN)),
				h("div", { style: {
					display: (section.headerBg !== void 0 ? !!section.headerBg : DEFAULT_HEADER_BG) && (section.headerFrostOwn !== void 0 ? !!section.headerFrostOwn : DEFAULT_HEADER_FROST_OWN) ? "" : "none"
				} },
					sliderRow(t("headerFrostAmount"), "headerFrostAmount", 0, 60, "px", 1, DEFAULT_HEADER_FROST_AMOUNT)),

				// ①(修正 2026-09-13 第1项) 右侧边栏/dock 虚化：纳入统一虚化接管（与侧边栏/标题栏同款提示）
				toggleRow(t("rightSidebarBlur"), t("rightSidebarBlur.desc"), "rightSidebarBlur", DEFAULT_RIGHT_SIDEBAR_BLUR,
					(section.unifyTint !== void 0 ? !!section.unifyTint : DEFAULT_UNIFY_TINT),
					(section.unifyTint !== void 0 ? !!section.unifyTint : DEFAULT_UNIFY_TINT)),
				h("div", { style: {
					display: (section.rightSidebarBlur !== void 0 ? !!section.rightSidebarBlur : DEFAULT_RIGHT_SIDEBAR_BLUR) ? "" : "none",
					opacity: (section.unifyTint !== void 0 ? !!section.unifyTint : DEFAULT_UNIFY_TINT) ? 0.45 : 1,
					pointerEvents: (section.unifyTint !== void 0 ? !!section.unifyTint : DEFAULT_UNIFY_TINT) ? "none" : "auto"
				} },
					sliderRow(t("rightSidebarBlurAmount"), "rightSidebarBlurAmount", 0, 40, "px", 1, DEFAULT_RIGHT_SIDEBAR_AMOUNT),
					sliderRow(t("rightSidebarAlpha"), "rightSidebarAlpha", 0, 100, "%", 1, DEFAULT_RIGHT_SIDEBAR_ALPHA)),
				(section.unifyTint !== void 0 ? !!section.unifyTint : DEFAULT_UNIFY_TINT)
					? h("p", { className: "mpw_hint" }, t("rightSidebarBlur.overridden"))
					: null,


				]),
				// ═══ 统一虚化（独立大标题分组）═══
				h("div", { "data-mpw-tabkey": "unify", style: { flex: "0 0 100%", minWidth: "100%", boxSizing: "border-box", paddingRight: "4px" } }, [
				h("div", { className: "mpw_section" }, t("sec.unify")),
				h("p", { className: "mpw_hint" }, t("sec.unify.desc")),

				// ①(重做) 统一虚化：开关 + 独立条（0 = 不虚化，40 = 强毛玻璃模糊）。
				// 开时其他虚化设置全部作废，只按这个条；设置界面/聊天框除外（按各自设置）。
				toggleRow(t("unifyTint"), t("unifyTint.desc"), "unifyTint", DEFAULT_UNIFY_TINT),
				// ⑥ 条件显示滑条：⚠️ sliderRow 内含 hooks，绝不能条件渲染（React 会因
				// hooks 数量变化崩溃导致整页空白）——始终渲染，用 wrapper display 隐藏。
				h("div", { style: { display: (section.unifyTint !== void 0 ? !!section.unifyTint : DEFAULT_UNIFY_TINT) ? "" : "none" } },
					sliderRow(t("unifyAmount"), "unifyAmount", 0, 40, "px", 1, DEFAULT_UNIFY_AMOUNT)),
				// ①(新) 侧边栏/标题栏透明度（统一虚化开启时显示）：白雾厚度独立可调，
				// 与虚化程度解耦（低 = 透出更多模糊壁纸，高 = 更实心）
				h("div", { style: { display: (section.unifyTint !== void 0 ? !!section.unifyTint : DEFAULT_UNIFY_TINT) ? "" : "none" } },
					sliderRow(t("sidebarAlpha"), "sidebarAlpha", 0, 100, "%", 1, DEFAULT_SIDEBAR_ALPHA)),
				// ①(新) 统一虚化是否接管聊天区壁纸（统一虚化开启时显示）：
				// 开 = 聊天区也跟随整屏虚化（磨砂条被接管禁用）；
				// 关 = 磨砂条恢复可调（聊天区壁纸由磨砂条控制），统一虚化只管侧边栏/标题栏
				h("div", { style: { display: (section.unifyTint !== void 0 ? !!section.unifyTint : DEFAULT_UNIFY_TINT) ? "" : "none" } },
					toggleRow(t("chatFollow"), t("chatFollow.desc"), "chatFollow", DEFAULT_CHAT_FOLLOW)),
				// ④(新) 新会话按钮是否随面板不透明度（统一虚化开启时显示）；关 = 保持原按钮色
				h("div", { style: { display: (section.unifyTint !== void 0 ? !!section.unifyTint : DEFAULT_UNIFY_TINT) ? "" : "none" } },
					toggleRow(t("sessionFollow"), t("sessionFollow.desc"), "sessionFollow", DEFAULT_SESSION_FOLLOW)),

				// ── 第2类：统一雾（全屏遮罩，原 Aqua 实验项挪来）──
				// ①(修正) 用户要求：统一雾从 aqua 实验 tab 挪到本 tab 作为第 2 类。
				// 统一雾 = 全屏纯色雾罩（所有表面共享一种雾色/透明度），与统一虚化
				// （壁纸模糊）互补：统一虚化模糊壁纸，统一雾控制整体色调浓度。
				h("div", { className: "mpw_section", style: { marginTop: 18 } }, t("sec.unifyFog")),
				h("p", { className: "mpw_hint" }, t("sec.unifyFog.desc")),
				toggleRow(t("aquaMask"), t("aquaMask.desc"), "aquaMask", DEFAULT_AQUA_MASK),
				// ⑲(新) 统一雾强度：独立滑条
				h("div", { style: { display: (section.aquaMask !== void 0 ? !!section.aquaMask : DEFAULT_AQUA_MASK) ? "" : "none" } },
					sliderRow(t("aquaMaskAlpha"), "aquaMaskAlpha", 0, 100, "%", 1, DEFAULT_AQUA_MASK_ALPHA)),

				]),
				// ═══ 界面虚化 ═══
				h("div", { "data-mpw-tabkey": "blur", style: { flex: "0 0 100%", minWidth: "100%", boxSizing: "border-box", paddingRight: "4px" } }, [
				h("div", { className: "mpw_section" }, t("sec.blur")),
				h("p", { className: "mpw_hint" }, t("sec.blur.desc")),

				// ── 虚化对话框（通用居中窗口 + 聊天输入框跟随）──
				toggleRow(t("dialogBlur"), t("dialogBlur.desc"), "dialogBlur", DEFAULT_DIALOG_BLUR),
				h("div", { style: { display: (section.dialogBlur !== void 0 ? !!section.dialogBlur : DEFAULT_DIALOG_BLUR) ? "" : "none" } },
					sliderRow(t("dialogBlurAmount"), "dialogAmount", 0, 40, "px", 1, DEFAULT_DIALOG_AMOUNT)),

				// ── 虚化设置面板 ──
				toggleRow(t("settingsBlur"), t("settingsBlur.desc"), "settingsBlur", DEFAULT_SETTINGS_BLUR),
				h("div", { style: { display: (section.settingsBlur !== void 0 ? !!section.settingsBlur : DEFAULT_SETTINGS_BLUR) ? "" : "none" } },
					sliderRow(t("settingsBlurAmount"), "settingsAmount", 0, 40, "px", 1, DEFAULT_SETTINGS_AMOUNT)),

				// ── 虚化下载/确认弹窗 ──
				toggleRow(t("confirmBlur"), t("confirmBlur.desc"), "confirmBlur", DEFAULT_CONFIRM_BLUR),
				h("div", { style: { display: (section.confirmBlur !== void 0 ? !!section.confirmBlur : DEFAULT_CONFIRM_BLUR) ? "" : "none" } },
					sliderRow(t("confirmBlurAmount"), "confirmAmount", 0, 40, "px", 1, DEFAULT_CONFIRM_AMOUNT)),

				// ⑮(新) 浏览器虚化支持提示（Via/WebView 常声明支持但不渲染真模糊）
				window.__mpwBackdropRendered === false
					? h("p", { className: "mpw_hint" }, t("blur.unsupported"))
					: null,

				// ── 弹层虚化（菜单/提示/下拉，独立于对话框）──
				toggleRow(t("popoverBlur"), t("popoverBlur.desc"), "popoverBlur", DEFAULT_POPOVER_BLUR),
				h("div", { style: { display: (section.popoverBlur !== void 0 ? !!section.popoverBlur : DEFAULT_POPOVER_BLUR) ? "" : "none" } },
					sliderRow(t("popoverBlurAmount"), "popoverAmount", 0, 40, "px", 1, DEFAULT_POPOVER_AMOUNT)),
				// ④(新 2026-09-13) 弹层不透明度：浮层"看得穿"的根治旋钮。
				//   模糊生效时调低（~80）→ 玻璃感；环境不模糊时保持 94+ → 保证可读。
				sliderRow(t("popoverAlpha"), "popoverAlpha", 50, 100, "%", 1, DEFAULT_POPOVER_ALPHA),
				h("p", { className: "mpw_hint" }, t("popoverAlpha.desc")),

				// ── 遮罩虚化（设置/弹层打开时的全屏背景遮罩）──
				toggleRow(t("maskBlur"), t("maskBlur.desc"), "maskBlur", DEFAULT_MASK_BLUR),
				h("div", { style: { display: (section.maskBlur !== void 0 ? !!section.maskBlur : DEFAULT_MASK_BLUR) ? "" : "none" } },
					sliderRow(t("maskBlurAmount"), "maskAmount", 0, 40, "px", 1, DEFAULT_MASK_AMOUNT)),

				]),
				// ═══ 其他 ═══
				h("div", { "data-mpw-tabkey": "other", style: { flex: "0 0 100%", minWidth: "100%", boxSizing: "border-box", paddingRight: "4px" } }, [
				h("div", { className: "mpw_section" }, t("sec.other")),

				// ⑦ 轻度锐化（可能影响 GIF 流畅度）
				toggleRow(t("sharp"), t("sharp.desc"), "sharp", DEFAULT_SHARP),

				// ②(新) Deep diving 背景方框开关（移到"其他"组）
				toggleRow(t("thinkBg"), t("thinkBg.desc"), "thinkBg", DEFAULT_THINK_BG),

				// ①(新) 第三方 UI 圆角兼容开关（其他组）
				toggleRow(t("roundCompat"), t("roundCompat.desc"), "roundCompat", DEFAULT_ROUND_COMPAT),

				// ①(新) dsh-better-sidebar 适配分类（总开关 + 子开关）。⚠️ 滑块/开关都要
				// **始终挂载、display 隐藏**——sliderRow/toggleRow 含 hooks（useRef/useEffect），
				// 条件渲染会在 betterSidebar/bsCompat 运行时变化时 hooks 数量改变 → React 崩溃
				// → 设置整页空白（用户实测：重启后 betterSidebar 异步检测返回 true，bs 分类
				// 第一次渲染新增 sliderRow hooks 而崩溃）。以下结构恒定，仅 display 切显隐。
				h("div", { style: { display: betterSidebar ? "" : "none" } }, [
					h("div", { className: "mpw_section" }, t("bs.title")),
					h("p", { className: "mpw_hint" }, t("bs.desc")),
					toggleRow(t("bs.master"), t("bs.master.desc"), "bsCompat", false),
					h("div", { className: "mpw_props", style: { marginTop: 6, display: (section.bsCompat !== void 0 ? !!section.bsCompat : false) ? "" : "none" } }, [
						// 子开关：悬浮适配 / 字体增强 / 透出壁纸 / 透明度（细粒度分区）
						toggleRow(t("bs.float"), t("bs.float.desc"), "bsFloat", false),
						toggleRow(t("bs.font"), t("bs.font.desc"), "bsFont", false),
						toggleRow(t("bs.reveal"), t("bs.reveal.desc"), "bsReveal", false),
						h("div", { style: { display: (section.bsReveal !== void 0 ? !!section.bsReveal : false) ? "" : "none" } },
							sliderRow(t("bs.revealAlpha"), "bsRevealAlpha", 10, 95, "%", 5, 62)),
						// ①(新) 跟随 Aqua：开 = better-sidebar 面板应用 aqua 实验效果（统一雾/
						// 面板取色/自适应文字，与「其他」里的总开关形成「双开关」：本开关 +
						// aqua 对应开关都开才生效）
						toggleRow(t("bs.aqua"), t("bs.aqua.desc"), "bsAqua", false),
					])
				]),

				// ④(新) 备份与恢复（导出 JSON 文件 / 导入他人文件；只含外观类设置）
				h("div", { className: "mpw_section" }, t("backup.title")),
				h("p", { className: "mpw_hint" }, t("backup.desc")),
				h("div", { className: "mpw_field" }, [
					h("div", { className: "mpw_inline" }, [
						h("button", { className: "mpw_fileBtn", type: "button", onClick: exportBackup }, t("backup.export")),
						h("button", { className: "mpw_fileBtn", type: "button", onClick: () => backupRef.current && backupRef.current.click() }, t("backup.import")),
						h("input", { ref: backupRef, type: "file", accept: ".json,application/json", style: { display: "none" }, onChange: (ev) => { importBackup(ev.target.files && ev.target.files[0]); ev.target.value = ""; } })
					]),
					h("p", { className: "mpw_hint" }, backupFileName ? t("backup.fileName") + backupFileName : t("backup.desc"))
				]),

				// ① 恢复所有默认设置（重置外观数值，不清除已导入壁纸）——挪进备份与恢复组
				h("div", { className: "mpw_field" }, [
					h("div", { className: "mpw_inline" }, [
						h("button", { className: "mpw_reset", type: "button", onClick: resetSettings }, t("reset")),
						// ①(新) 前往反馈：跳转插件 GitHub 的 issues 页
						h("a", { className: "mpw_reset", href: "https://github.com/XHR666/dsh-mpkg-wallpaper/issues", target: "_blank", rel: "noopener", style: { textDecoration: "none", display: "inline-flex", alignItems: "center" } }, t("feedback"))
					])
				]),

				// ①(新) 检测更新 / 一键热更新（挪到「其他」最下面）
				h("div", { className: "mpw_field" }, [
					h("label", { className: "mpw_label" }, t("update.title")),
					h("div", { className: "mpw_inline" }, [
						h("button", { className: "mpw_fileBtn", type: "button", onClick: checkUpdate },
							updState && updState.checking ? t("update.checking") : t("update.check")),
						updState && updState.hasUpdate
							? h("button", { className: "mpw_button", type: "button", onClick: () => {
								// ①(修正) 推荐去插件市场更新（semver 检测与市场一致，不被内置哈希打架）。
								// 内置更新作为备选：先弹确认窗（推荐市场），确认才走内置 update-apply。
								setUpdChoose(updState);
							} }, updState && updState.applying ? t("update.applying") : t("update.apply"))
							: null,
						updState && updState.hasUpdate
							? h("button", { className: "mpw_fileBtn", type: "button", onClick: () => {
								// ①(新) 直接去插件市场更新（最推荐，避免与市场 semver 检测冲突）
								setHint(t("update.gotoMarket"));
							} }, t("update.market"))
							: null
					]),
					updState && updState.error ? h("p", { className: "mpw_hint mpw_err" }, t("update.fail") + updState.error) : null,
					updState && updState.hasUpdate
						? h("p", { className: "mpw_hint" }, t("update.found") + updState.localVersion + " → " + updState.remoteVersion)
						: (updState && updState.hasUpdate === false && updState.contentDiff
							? h("p", { className: "mpw_hint mpw_err" }, t("update.diff"))
							: null),
					updState && updState.applied ? h("p", { className: "mpw_hint" }, t("update.applied")) : null,
					updState && updState.hasUpdate === false ? h("p", { className: "mpw_hint" }, t("update.latest")) : null
				]),
				hint ? h("p", { className: "mpw_hint" + (/^(解析失败|文件过大|背景素材过大|存储空间|内存不足|此壁纸的视频纹理|不支持)/.test(hint) ? " mpw_err" : "") }, hint) : null,
				// ①(2026-09-17 持久化轮) 持久化状态一行（**降级可见**）：大图存进了 IndexedDB（刷新仍能恢复）
				//   或上一次没存下（此时上面的弹窗/hint 也会说同一件事）。详见 docs/PERSISTENCE.md。
				persistWarn
					? h("p", { className: "mpw_hint mpw_err", title: persistWarn }, "\u26a0 " + persistWarn)
					: (mpwPersistState.usedIdb
						? h("p", { className: "mpw_hint" }, t("persist.idb") + "（" + Math.round(MPW_LS_SPILL_BYTES / 1048576) + "MB/" + Math.round(MPW_LS_MAX_BYTES / 1024) + "KB）")
						: null),

				// ①(新) 更新方式确认弹窗：内置更新作为备选，推荐去插件市场
				updChoose ? h(MaskPortal, { onClick: () => setUpdChoose(null) }, [
					h("div", { className: "mpw_dialog", onClick: (ev) => ev.stopPropagation() }, [
						h("div", { className: "mpw_title" }, t("update.chooseTitle")),
						h("p", { className: "mpw_desc" }, t("update.chooseBody") + updChoose.localVersion + " → " + updChoose.remoteVersion + "）"),
						h("div", { className: "mpw_inline" }, [
							h("button", { className: "mpw_button", type: "button", onClick: () => { const d = updChoose; setUpdChoose(null); applyUpdate(); } }, t("update.confirmSelf")),
							h("button", { className: "mpw_reset", type: "button", onClick: () => { setUpdChoose(null); setHint(t("update.gotoMarket")); } }, t("update.gotoMarket")),
							h("button", { className: "mpw_reset", type: "button", onClick: () => setUpdChoose(null) }, t("conflict.cancel"))
						])
					])
				]) : null,

				// ①(新) 目录选择弹窗（文件夹选择器，跨平台）
				// ①(第13条) **key 固定**：本元素所在数组是宿主侧的大 children 数组（无 key 兄弟多），
				//   兄弟增删会让 React 按下标重新对齐；给弹窗一个稳定 key ⇒ 不会被"顺移"重建，
				//   容器的 scrollTop 也就不会被新节点归零（第二道保险是 useMpwListScroll 的同步恢复）。
				dirPick ? h(MaskPortal, { key: "mpw-dirpick", onClick: () => setDirPick(false) }, [
					h("div", { className: "mpw_dialog", onClick: (ev) => ev.stopPropagation() }, [
						h("div", { className: "mpw_title" }, t("lib.pickDir")),
						h("p", { className: "mpw_hint", style: { wordBreak: "break-all" } }, t("lib.curDir") + "：" + (dirPath || "(默认)")),
						// ③(修正) 常用位置快捷入口（平台适配：Windows 盘符反斜杠，非 Windows 去 /sdcard）
						h("div", { className: "mpw_inline" }, [
							dirHome ? h("button", { className: "mpw_reset mpw_moreBtn", type: "button", onClick: () => openDirPicker(dirHome) }, "🏠 " + t("lib.home")) : null,
							dirPlatform === "win32"
								? h("button", { className: "mpw_reset mpw_moreBtn", type: "button", onClick: () => openDirPicker("C:\\") }, "💿 C:\\")
								: h("button", { className: "mpw_reset mpw_moreBtn", type: "button", onClick: () => openDirPicker("/") }, "🗂 /"),
						]),
						// ①(第13条) 列表本体 = MPW-DIRPICK 块里的 MpwDirList（滚动主权/键盘导航/不抢焦点）。
						//   行 key = 完整路径；行点击用 pointerdown 锁（1.5s 过期）防触摸滑动误选。
						h(MpwDirList, {
							path: dirPath,
							subs: dirSubs,
							platform: dirPlatform,
							active: true,
							canUp: !!dirPath,
							labelUp: t("lib.up"),
							labelEmpty: t("lib.noSub"),
							onUp: () => openDirPicker(mpwDirParentPath(dirPath, dirPlatform)),
							onOpen: (child) => {
								// pointerdown 锁：按下与抬起必须是**同一行**（触摸滑动时不误进）。
								// ①(第13条) 锁超过 1.5s 视为**过期 ⇒ 过期不阻止点击**，
								//   否则"按住一会儿再松手"会静默无效（比误选更糟）。
								const lock = dirClickLockRef.current;
								const name = String(child || "").split(dirPath.indexOf("\\") >= 0 ? "\\" : "/").pop();
								const fresh = !!(lock && (Date.now() - lock.at) < 1500);
								const ok = !fresh || lock.name === name;
								dirClickLockRef.current = null;
								if (ok) openDirPicker(child);
							},
							onChoose: () => {
								const chosen = dirPath;
								setCustomDirState(chosen);
								setDirPick(false);
								commit({ customDirPath: chosen }, true);
								scanCustomDir(chosen);
							},
							onClose: () => setDirPick(false),
							onPress: (name, i) => { dirClickLockRef.current = { name: name, idx: i, at: Date.now() }; }
						}),
						h("p", { className: "mpw_hint" }, t("lib.kbdHint")),
						h("div", { className: "mpw_inline" }, [
							h("button", { className: "mpw_button", type: "button", onClick: () => {
								const chosen = dirPath;
								setCustomDirState(chosen);
								setDirPick(false);
								commit({ customDirPath: chosen }, true);
								scanCustomDir(chosen);
							} }, t("lib.chooseHere")),
							h("button", { className: "mpw_reset", type: "button", onClick: () => setDirPick(false) }, t("conflict.cancel"))
						])
					])
				]) : null,

				// ①(新) 通用错误弹窗（文件过大 / 无法使用 / 解析失败等）
				errorModal ? h(MaskPortal, { onClick: () => setErrorModal(false) }, [
					h("div", { className: "mpw_dialog", onClick: (ev) => ev.stopPropagation() }, [
						h("div", { className: "mpw_title" }, t("error.title")),
						h("p", { className: "mpw_desc" }, errorMsg),
						h("div", { className: "mpw_inline" }, [
							h("button", { className: "mpw_button", type: "button", onClick: () => setErrorModal(false) }, t("preview.ok"))
						])
					])
				]) : null,

				// ⑤(新) 预览模式弹窗（导入后最终用 GIF/图片时提示）
				previewModal ? h(MaskPortal, { onClick: () => setPreviewModal(false) }, [
					h("div", { className: "mpw_dialog", onClick: (ev) => ev.stopPropagation() }, [
						h("div", { className: "mpw_title" }, t("preview.title")),
						h("p", { className: "mpw_desc" }, t("preview.desc")),
						h("div", { className: "mpw_inline" }, [
							h("button", { className: "mpw_button", type: "button", onClick: () => setPreviewModal(false) }, t("preview.ok"))
						])
					])
				]) : null,

				// ④ 冲突确认弹窗（自绘覆盖层）
				// ①(新) 网页壁纸确认弹窗（实验性警告：可能卡顿或无法加载；预检标注风险）
				webConfirm ? h(MaskPortal, { onClick: () => setWebConfirm(null) }, [
					h("div", { className: "mpw_dialog", onClick: (ev) => ev.stopPropagation() }, [
						h("div", { className: "mpw_title" }, t("web.confirmTitle")),
						h("p", { className: "mpw_desc" }, `${t("web.confirmBody")}（${webConfirm.title || ""}）`),
						webConfirm.webHeavy
							? h("p", { className: "mpw_hint", style: { color: "#e0a33c" } }, t("web.riskHeavy"))
							: null,
						webConfirm.webExternal
							? h("p", { className: "mpw_hint", style: { color: "#e0735c" } }, t("web.riskExternal"))
							: null,
						h("p", { className: "mpw_hint" }, t("web.confirmHint")),
						h("p", { className: "mpw_hint" }, t("web.modeHint")),
						h("div", { className: "mpw_inline" }, [
							h("button", { className: "mpw_button", type: "button", onClick: () => {
								const wc = webConfirm;
								setWebConfirm(null);
								if (wc.src === "library") applyLibraryWebReal(wc, "shim");
								else applyCustomWebReal(wc.name, wc.media, "shim");
							} }, t("web.confirmShim")),
							h("button", { className: "mpw_reset", type: "button", onClick: () => {
								const wc = webConfirm;
								setWebConfirm(null);
								if (wc.src === "library") applyLibraryWebReal(wc, "compat");
								else applyCustomWebReal(wc.name, wc.media, "compat");
							} }, t("web.confirmCompat")),
							h("button", { className: "mpw_reset", type: "button", onClick: () => setWebConfirm(null) }, t("conflict.cancel"))
						])
					])
				]) : null,
				conflictModal ? h(MaskPortal, { onClick: () => setConflictModal(false) }, [
					h("div", { className: "mpw_dialog", onClick: (ev) => ev.stopPropagation() }, [
						h("div", { className: "mpw_title" }, t("conflict.title")),
						h("p", { className: "mpw_desc" }, `${t("conflict.body")}：${conflicts.join(", ")}`),
						h("div", { className: "mpw_inline" }, [
							h("button", { className: "mpw_button", type: "button", onClick: confirmEnable }, t("conflict.confirm")),
							h("button", { className: "mpw_reset", type: "button", onClick: () => setConflictModal(false) }, t("conflict.cancel"))
						])
					])
				]) : null
				]),
				// ═══ 液态玻璃(测试) ═══
				h("div", { "data-mpw-tabkey": "liquid", style: { flex: "0 0 100%", minWidth: "100%", boxSizing: "border-box", paddingRight: "4px" } }, [
				// ①(#14 用户要求) 原「Aqua 实验」tab 的内容并入本 tab（测试项）
				h("div", { className: "mpw_section", style: { marginTop: 18 } }, t("sec.aqua")),
				h("p", { className: "mpw_hint" }, t("sec.aqua.desc")),
				h("div", { className: "mpw_inline", style: { marginBottom: 4 } }, [
					h("a", { className: "mpw_link", href: "https://github.com/XHR666/dsh-mpkg-wallpaper/pull/2", target: "_blank", rel: "noopener" }, "→ " + t("aqua.credit"))
				]),
				toggleRow(t("aquaInk"), t("aquaInk.desc"), "aquaInk", DEFAULT_AQUA_INK),
				toggleRow(t("aquaTextEnhance"), t("aquaTextEnhance.desc"), "aquaTextEnhance", DEFAULT_AQUA_TEXT_ENHANCE),
				toggleRow(t("todoBlur"), t("todoBlur.desc"), "todoBlur", DEFAULT_TODO_BLUR),
					h("div", { className: "mpw_section" }, t("scnRender.title")),
					h("p", { className: "mpw_hint" }, t("scnRender.desc")),
					h("div", { className: "mpw_field" }, [
						h("label", { className: "mpw_label" }, t("scnRender.mode")),
						h("div", { className: "mpw_inline" }, [
							["webgl", "scnRender.webgl"], ["static", "scnRender.static"], ["elysia", "scnRender.elysia"]
						].map(([v, lk]) => {
							const on = (section.sceneRender || "static") === v;
							return h("button", { className: "mpw_button" + (on ? " mpw_tabActive" : ""), type: "button", onClick: () => commit({ sceneRender: v }, true) }, t(lk));
						}))
					]),
					h("p", { className: "mpw_hint" }, t("scnRender.hint")),
					// ①(新 2026-09-12) 场景渲染上报：壁纸画面排障用（默认关）
					toggleRow(t("scnRender.report"), t("scnRender.report.desc"), "sceneReport", DEFAULT_SCENE_REPORT),
					// ①(批次15 B1) 首帧看门狗（默认开）：渲染器没出画 → 自动回退静态帧 + 提示；iframe 保留可重试
					toggleRow(t("scnRender.watchdog"), t("scnRender.watchdog.desc"), "sceneWatchdog", true),
					h("div", { className: "mpw_field" }, [
						h("label", { className: "mpw_label" }, t("scnRender.watchdog.secs")),
						h("div", { className: "mpw_inline" }, [5, 8, 12, 20, 30].map((v) => {
							const cur = (typeof section.sceneWatchdogSecs === "number" && isFinite(section.sceneWatchdogSecs)) ? Math.max(3, Math.min(30, Math.round(section.sceneWatchdogSecs))) : 8;
							return h("button", { key: v, className: "mpw_button" + (cur === v ? " mpw_tabActive" : ""), type: "button", onClick: () => commit({ sceneWatchdogSecs: v }, true) }, v + "s");
						})),
						h("p", { className: "mpw_hint" }, t("scnRender.watchdog.secs.desc")),
					]),
					// ①(批次15 B1/B2) 手动"再试一次渲染器"（兜底状态下也可用；每次强制重载 iframe + 重启看门狗）
					h("div", { className: "mpw_field" }, [
						h("label", { className: "mpw_label" }, t("scnRender.retry")),
						h("div", { className: "mpw_inline" }, [
							h("button", { className: "mpw_button", type: "button", onClick: () => { try { if (window.__mpwSceneRetryRenderer) window.__mpwSceneRetryRenderer(); else setHint(t("scnRender.retry.noScene")); } catch (e) {} } }, t("scnRender.retry.btn")),
						]),
						h("p", { className: "mpw_hint" }, t("scnRender.retry.desc")),
					]),
					// ①(批次15 B3) 渲染器调试参数（白名单透传）：逐个校验后拼进壁纸 URL；保存/清空即时生效
					h("div", { className: "mpw_field" }, [
						h("label", { className: "mpw_label" }, t("scnRender.debug")),
						h("div", { className: "mpw_inline" }, [
							h("input", { className: "mpw_input", type: "text", value: dbgDraft,
								placeholder: t("scnRender.debug.ph"), style: { flex: 1, minWidth: 0 },
								onInput: (ev) => setDbgDraft(ev.target.value) }),
							h("button", { className: "mpw_button", type: "button", onClick: () => {
								// 保存：净化 → 写设置 → 当前壁纸是渲染器场景则立即重挂（清空后恢复）
								const clean = mpwSanitizeSceneDebugParams(dbgDraft);
								try {
									commit({ sceneDebugParams: clean }, true);
									setDbgDraft(clean);
									const reapplied = mpwSceneDebugReapply(clean);
									setHint(clean ? t("scnRender.debug.saved") + "：" + clean + (reapplied ? t("scnRender.reapplied") : "") : t("scnRender.debug.cleared"));
								} catch (e) { setHint(t("scnRender.extUrl.fail") + String(e && e.message || e)); }
							} }, t("scnRender.debug.save")),
							h("button", { className: "mpw_reset", type: "button", onClick: () => {
								// 一键清空：清设置 + 清输入 + 立即按无参数重挂
								try {
									commit({ sceneDebugParams: "" }, true);
									setDbgDraft("");
									const reapplied = mpwSceneDebugReapply("");
									setHint(t("scnRender.debug.cleared") + (reapplied ? t("scnRender.reapplied") : ""));
								} catch (e) {}
							} }, t("scnRender.debug.clear")),
						]),
						h("p", { className: "mpw_hint" }, t("scnRender.debug.hint")),
					]),
					// ①(MERGED-3 1.2) sceneExtUrl 输入框 + 测试按钮（预留接口可视化）
					h("div", { className: "mpw_field" }, [
						h("label", { className: "mpw_label" }, t("scnRender.extUrl")),
						h("div", { className: "mpw_inline" }, [
							h("input", { className: "mpw_input", type: "text", value: extUrlDraft,
								placeholder: t("scnRender.extUrl.ph"), style: { flex: 1, minWidth: 0 },
								onInput: (ev) => setExtUrlDraft(ev.target.value) }),
							h("button", { className: "mpw_button", type: "button", onClick: () => {
								// 保存：空值=清除该设置项（回到渲染器默认行为）
								const v = String(extUrlDraft || "").trim();
								try {
									writeSection(Object.assign({}, readSection(), { sceneExtUrl: v }), true);
									setSection(readSection());
									setHint(v ? t("scnRender.extUrl.saved") : t("scnRender.extUrl.cleared"));
								} catch (e) { setHint(t("scnRender.extUrl.fail") + String(e && e.message || e)); }
							} }, t("scnRender.extUrl.save")),
							h("button", { className: "mpw_reset", type: "button", onClick: () => {
								// 测试：fetch <url>/ 索引（/ext 约定返回 {slots, hooks}）→ 成功显示 hooks 数量，失败显示错误码
								const v = String(extUrlDraft || "").trim();
								if (!v) { setExtTest("⚠ " + t("scnRender.extUrl.empty")); return; }
								setExtTest("…");
								try {
									const u = v + (v.endsWith("/") ? "" : "/");
									const ctl = new AbortController();
									const tid = setTimeout(() => { try { ctl.abort(); } catch {} }, 3000);
									fetch(u, { signal: ctl.signal, cache: "no-store" })
										.then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
										.then((d) => {
											clearTimeout(tid);
											const slots = (d && d.slots) || [];
											const hooks = (d && d.hooks) || {};
											setExtTest("✓ hooks=" + Object.keys(hooks).length + " slots=[" + slots.join(",") + "]");
										})
										.catch((e) => { clearTimeout(tid); setExtTest("✗ " + String((e && e.message) || e)); });
								} catch (e) { setExtTest("✗ " + String((e && e.message) || e)); }
							} }, t("scnRender.extUrl.test")),
						]),
						h("p", { className: "mpw_hint" }, t("scnRender.extUrl.hint")),
						extTest ? h("p", { className: "mpw_hint", style: { color: extTest.indexOf("✗") >= 0 ? "#f1717f" : "#7bd88f" } }, extTest) : null,
					]),
					// ①(MERGED-3 1.3/2.3) 诊断开关速查区（只读帮助 + 一键复制；集合由 diag-flag-check.mjs 保证与代码一致）
					h("div", { className: "mpw_field" }, [
						h("label", { className: "mpw_label" }, t("diag.sec")),
						h("p", { className: "mpw_hint" }, t("diag.sec.desc")),
						h("div", { className: "mpw_inline" }, [
							h("button", { className: "mpw_reset mpw_moreBtn", type: "button", onClick: () => setDiagOpen(!diagOpen) },
								diagOpen ? t("diag.fold") : t("diag.expand") + `（${diagFlagList.length}）`)
						]),
						diagOpen ? h("div", { className: "mpw_props" }, diagFlagList.map((f) => h("div", { className: "mpw_prop", key: f.name }, [
							h("div", { className: "mpw_propLabel" }, h("b", null, "?" + f.name)),
							h("p", { className: "mpw_hint" }, t("diagflag." + f.name)),
							h("p", { className: "mpw_hint" }, t("diagflag." + f.name + ".d")),
							h("div", { className: "mpw_inline" }, [
								h("button", { className: "mpw_reset mpw_moreBtn", type: "button",
									onClick: () => { const frag = "?" + String(f.usage || (f.name + "=1")); mpwCopyText(frag, () => { try { setHint(t("diag.copied") + " " + frag); } catch (e) {} }); } },
									t("diag.copy")),
								h("span", { className: "mpw_hint" }, "?" + String(f.usage || (f.name + "=1")))
							])
						]))) : null,
						h("p", { className: "mpw_hint" }, t("diag.more")),
						// ①(批次15 B4.6) 上报新字段速查：与 README-DIAGNOSTICS 的上报字段对齐（layerHealth 随 mpw-health 规划中）
						h("p", { className: "mpw_hint" }, t("diag.fields")),
					]),
					h("div", { className: "mpw_section" }, t("sec.liquid")),
					h("p", { className: "mpw_hint" }, t("sec.liquid.desc")),
					h("div", { className: "mpw_field" }, [
						h("label", { className: "mpw_label" }, t("lg.test")),
						h("p", { className: "mpw_hint" }, t("lg.test.desc")),
						h("div", { className: "mpw_inline" }, [
							h("button", { className: "mpw_button" + ((section.lgTest !== void 0 ? !!section.lgTest : false) ? " mpw_tabActive" : ""), type: "button", onClick: () => commit({ lgTest: !(section.lgTest !== void 0 ? !!section.lgTest : false) }, true) },
								(section.lgTest !== void 0 ? !!section.lgTest : false) ? t("lg.test.on") : t("lg.test.off")),
						])
					]),
					// ①(新 2026-09-13 第15项) 纯 CSS/SVG 液态玻璃（不占 WebGL）：默认关，可与 scene 壁纸共存
					h("div", { className: "mpw_field" }, [
						h("label", { className: "mpw_label" }, t("lgCss")),
						h("p", { className: "mpw_hint" }, t("lgCss.desc")),
						h("div", { className: "mpw_inline" }, [
							h("button", { className: "mpw_button" + ((section.lgCss !== void 0 ? !!section.lgCss : DEFAULT_LG_CSS) ? " mpw_tabActive" : ""), type: "button", onClick: () => commit({ lgCss: !(section.lgCss !== void 0 ? !!section.lgCss : DEFAULT_LG_CSS) }, true) },
								(section.lgCss !== void 0 ? !!section.lgCss : DEFAULT_LG_CSS) ? t("lg.glassOn") : t("lg.glassOff")),
						])
					]),
					h("div", { style: { display: (section.lgCss !== void 0 ? !!section.lgCss : DEFAULT_LG_CSS) ? "" : "none" } },
						sliderRow(t("lgCssAmount"), "lgCssAmount", 0, 40, "px", 1, DEFAULT_LG_CSS_AMOUNT)),
					h("p", { className: "mpw_hint" }, t("lg.glassTitle")),
					// ①(新) 液态玻璃作用开关：输入框 / 侧边栏 / 标题栏
					[["lgComposer", "lg.composer"], ["lgSidebar", "lg.sidebar"], ["lgHeader", "lg.header"]]
						.map(([key, labelKey]) => h("div", { className: "mpw_field", key: key }, [
							h("label", { className: "mpw_label" }, t(labelKey)),
							h("div", { className: "mpw_inline" }, [
								h("button", { className: "mpw_button" + ((section[key] !== void 0 ? !!section[key] : false) ? " mpw_tabActive" : ""), type: "button", onClick: () => commit({ [key]: !(section[key] !== void 0 ? !!section[key] : false) }, true) },
									(section[key] !== void 0 ? !!section[key] : false) ? t("lg.glassOn") : t("lg.glassOff")),
							])
						])),
					h("div", { className: "mpw_field" }, [
						h("label", { className: "mpw_label" }, t("lg.demo")),
						h("p", { className: "mpw_hint" }, t("lg.demo.desc")),
						h("div", { className: "mpw_inline" }, [
							h("button", { className: "mpw_fileBtn", type: "button", onClick: () => { try { window.open("http://127.0.0.1:3081/", "_blank"); } catch {} } }, t("lg.demo.open")),
						])
					]),
					h("p", { className: "mpw_hint" }, t("lg.note")),
					lgStatus ? h("p", { className: "mpw_hint", style: { color: lgStatus.indexOf("✗") >= 0 ? "#f1717f" : "#7bd88f" } }, lgStatus) : null,
				]),
				]),
				]),
			];
			} catch (e) {
				try { console.warn('[dsh-mpkg-wallpaper] 设置区构建失败:', e); } catch {}
				try { fetch(HOST_BASE + '/diag', { method: 'POST', body: JSON.stringify({ kind: 'js-error', why: 'panel-build', message: String(e && e.message || e), stack: String(e && e.stack || '').slice(0, 1500), at: new Date().toISOString() }) }).catch(() => {}); } catch {}
				__panelChildren = [h('p', { className: 'mpw_hint' }, '壁纸引擎面板渲染失败：' + String(e && e.message || e))];
			}
			try { mpwTrace('section:built', { children: Array.isArray(__panelChildren) ? __panelChildren.length : -1 }) } catch {}
			return h("div", { className: "mpw_row mpw_glassHost", ref: __panelRootRef }, __panelChildren);
		} catch (err) {
			// 渲染错误边界：任何渲染异常只显示错误信息，绝不整页空白
			console.error("[dsh-mpkg-wallpaper] 设置页渲染失败:", err);
			// ①(P-66 真 bug 修复) `h` 是本函数**外层 try 块内**的 const → 这个 catch 块看不见它，
			//   边界自身会抛 `h is not defined`；外层 MpkgSection 的兜底于是显示
			//   「壁纸引擎设置区渲染异常：h is not defined」——**真实错误信息被吞掉**（排障被误导）。
			//   改用 react.createElement，边界显示真实错误内容。
			return react.createElement("div", { className: "mpw_field" }, [
				react.createElement("p", { className: "mpw_hint" }, "壁纸引擎设置渲染出错: " + String(err && err.message || err))
			]);
		}
	}

		// ═══════════════════════════════════════════════════════════════════
		//  多语言
		// ═══════════════════════════════════════════════════════════════════
		const zh = {
			"nav": "壁纸引擎背景",
			"master": "启用壁纸引擎背景功能",
			"clear.bg": "清除壁纸",
			"wall.type": "壁纸类型",
			"none": "无",
			"pause.pause": "暂停壁纸",
			"pause.play": "播放壁纸",
			"pause.pause": "暂停壁纸",
			"pause.play": "播放壁纸",
			"refresh.bg": "刷新壁纸",
			"refresh.done": "壁纸已刷新",
			"master.desc": "开启后应用所选背景",
			"master.off": "已关闭（检测到其他壁纸/主题插件或手动关闭）",
			"hybrid": "上传到 dsh 进程流式播放",
			"lib.title": "本地壁纸库（Steam 自动发现）",
			"lib.scan": "扫描本地壁纸库",
			"lib.desc": "Windows + 壁纸引擎安装时自动发现视频/网页壁纸",
			"lib.use": "使用",
			"lib.empty": "未发现可用的壁纸（或不是 Windows 环境）",
			"lib.noHost": "宿主端不可用，无法扫描本地壁纸库",
			"lib.noInstall": "未检测到壁纸引擎安装（需 Windows + Steam 版 Wallpaper Engine）",
			"lib.fail": "扫描失败：",
			"lib.sceneOnly": "场景类壁纸无法在浏览器渲染（仅预览图）",
			"lib.webPending": "Web（HTML）壁纸支持开发中，请先使用 mpkg 导入",
			"lib.applied": "已应用壁纸",
			"scene.extracting": "场景静态帧提取中…",
			"scene.probing": "场景解析中…",
			"busy.transcoding": "转码中（降低分辨率/帧率）…",
			"web.confirmTitle": "应用网页壁纸？（实验性）",
			"web.confirmBody": "网页壁纸可能卡顿或无法加载",
			"web.riskHeavy": "⚠ 预检：Spine/L2D 骨骼动画壁纸，低性能设备上可能卡住界面",
			"web.riskExternal": "⚠ 预检：依赖外网资源（SDK/CDN），加载可能失败",
			"web.confirmBody": "网页壁纸可能卡顿或无法加载",
			"web.confirmHint": "部分网页壁纸（事件页/动效重）会在低性能设备上卡住界面；卡住时刷新页面即可恢复（不会自动重新加载）。若加载失败，壁纸会显示黑底并出现刷新按钮——那是壁纸自身的内容，属正常现象。",
			"web.confirmShim": "沙箱模式（推荐）",
			"web.confirmCompat": "兼容模式（同源）",
			"web.modeHint": "沙箱模式：宿主在作者脚本之前注入 WE API（wallpaperPropertyListener / 音频 / 媒体），属性与静音/倍速/暂停由插件接管；该帧是不透明源，壁纸脚本无法访问 DSH 界面与本地存储。兼容模式：同源加载（等价于旧行为），Live2D 类壁纸的「网页壁纸选项」（分辨率/语言/音量）需要它。",
			"lib.custom": "自定义本地壁纸目录",
			"mute": "静音（网页壁纸）",
			"mute.desc": "网页壁纸常带声音，默认静音；关 = 播放壁纸声音",
			"lib.customHint": "可直接选择 Steam 创意工坊主目录（workshop/content/431960）：目录下每个子文件夹自动识别为一张壁纸（scene.pkg 场景 / mp4 视频 / index.html 网页）；也可选任意文件夹，mpkg 文件与文件夹混合放置都能识别",
			"lib.dirPlaceholder": "例如 C:\\壁纸 或 /home/壁纸",
			"lib.browse": "浏览…",
			"lib.pickDir": "选择文件夹",
			"lib.curDir": "当前路径",
			"lib.up": "上级",
			"lib.noSub": "（无子目录）",
			"lib.chooseHere": "选择此文件夹",
			// ①(第13条) 选择器快捷键提示（行为契约：点一下列表或 Tab 进入后 ↑↓ 生效）
			"lib.kbdHint": "提示：点一下列表（或用 Tab 进入）后，↑↓ 选择目录 · Home/End 到首/末 · Enter 进入（未选行时 = 选择此文件夹）· Backspace 上一级 · Esc 关闭；弹窗打开时**不移动你的焦点、不改变滚动位置**。",
			"lib.home": "主目录",
			"lib.scanDir": "扫描该目录",
			"lib.dirEmpty": "请先输入壁纸文件夹路径",
			"lib.dirFail": "目录无效或无法读取：",
			"lib.dirFound": "发现 ",
			"lib.dirFiles": " 个媒体文件（图片/视频）",
			"lib.rotate": "壁纸切换与轮换",
			"lib.next": "下一个壁纸",
			"lib.prev": "上一个壁纸",
			"lib.more": "继续展开",
			"lib.collapse": "收起列表",
			"lib.expandAll": "展开壁纸",
			"lib.rotateDesc": "定时自动切换到下一个壁纸（范围：自定义目录 + 本地库 + Steam 自动发现的视频壁纸）",
			"lib.rotMerged": "已把 Steam 库中可播放的视频壁纸并入轮播：",
			"lib.rotateMin": "轮换间隔",
			"lib.minutes": "分钟",
			"hybrid.desc": "开：mpkg 上传到 DSH 宿主流式播放，支持 >600MB 大文件（需重启 dsh web 使宿主端生效）；关：所有文件在本机浏览器播放（600MB 上限）",
			"hybrid.status.ok": "宿主端可用（大文件无 600MB 限制）",
			"hybrid.status.fallback": "宿主端不可用（已回退纯浏览器模式，600MB 上限）",
			"hybrid.status.detecting": "检测宿主端中…",
			"hybrid.status.browserOnly": "纯浏览器模式（600MB 上限）",
			"conflict.detected": "检测到可能冲突的插件",
			"conflict.title": "检测到插件冲突",
			"conflict.body": "以下插件可能与本功能冲突（都会改动界面背景/外观）。仍要开启吗？",
			"conflict.confirm": "仍然开启",
			"conflict.cancel": "取消",
			"title": "壁纸引擎 mpkg 背景",
			"desc": "直接加载 Wallpaper Engine 的 .mpkg 文件作为页面背景：视频类壁纸自动播放内嵌 mp4，场景类壁纸取 preview.gif。支持时间变化、时钟、镜头缩放与界面虚化。设置保存在当前浏览器。",
			"sec.source": "背景来源",
			"sec.appearance": "外观",
			"sec.appearance.desc": "面板不透明度=所有区域白雾厚度；磨砂模糊=整张壁纸的模糊程度（0=清晰）；镜头缩放/位置=背景画面的放大与平移（缩小可看到画面边缘的组件）",
			"sec.blur": "界面虚化",
			"sec.blur.desc": "各类弹层/面板打开时的背景虚化：对话框（通用居中窗口+聊天输入框）、设置面板、下载确认弹窗各自独立；弹层=菜单/下拉/提示；遮罩=弹层背后的全屏背景；左侧边栏磨砂=左侧边栏自身玻璃化",
			"sec.unify": "界面统一",
			"sec.unify.desc": "整屏界面外观统一管理，两类效果互不干扰：①统一虚化=壁纸模糊度+白雾厚度（左侧边栏/标题栏整体毛玻璃）；②统一雾=全屏色调雾罩（所有表面共享一种雾色/浓度）。开启后「界面虚化」里的左侧边栏磨砂被接管",
			"sec.unifyFog": "统一雾（色调）",
			"sec.unifyFog.desc": "全屏纯色雾罩：所有表面（左侧边栏/标题栏/聊天区/按钮）共享一种雾色与浓度，让整屏色调统一；关 = 保持原有分区配色",
			"sec.show": "透出壁纸",
			"sec.show.desc": "控制对应区域是否显示壁纸：关=纯色不透明",
			"sec.picture": "壁纸画面",
			"sec.power": "省电",
			"sec.other": "其他",
			"sec.liquid": "测试项",
			"scnRender.title": "纯 Scene 壁纸渲染方式",
			"scnRender.desc": "调整纯场景壁纸的渲染路径（不影响视频/图片/web 壁纸）。",
			"scnRender.mode": "渲染方式：",
			"scnRender.webgl": "WebGL 实时（当前）",
			"scnRender.static": "静态帧（原合成）",
			"scnRender.elysia": "Elysia 兼容（预留）",
			"scnRender.hint": "说明：WebGL 实时=最新 we-scene 引擎（效果/动画/锚点完整）；静态帧=2D canvas 图层合成（轻量）；Elysia=参考实现路径（尚在移植）。切换立即生效并持久保存。",
			"scnRender.extUrl": "渲染器扩展钩子地址（sceneExtUrl，可选）",
			"scnRender.report": "场景渲染上报（排障）",
			"scnRender.report.desc": "开启后壁纸每 10 秒把渲染器现场（截图 + 逐层绘制台账 + 纹理统计）写到渲染器的 reports/ 目录，用于定位“坐标/可见性”问题。仅排障时开，默认关（有磁盘写入）",
			"scnRender.extUrl.ph": "http://127.0.0.1:8899/ext",
			"scnRender.extUrl.hint": "留空=不启用。填写后按 extbase 拼进场景渲染 iframe（见 we-scene-demo/EXTENSION-HOOKS.md）；点「测试」验证索引可达并显示钩子数量。",
			"scnRender.extUrl.save": "保存",
			"scnRender.extUrl.saved": "扩展钩子地址已保存，下次应用场景壁纸生效",
			"scnRender.extUrl.cleared": "已清除扩展钩子地址",
			"scnRender.extUrl.test": "测试",
			"scnRender.extUrl.empty": "请先填写扩展钩子地址",
				"scnRender.extUrl.fail": "保存失败：",
				// ①(批次15 B1/B2/B3/B5) 场景渲染器：看门狗 / 重试 / 调试参数 / 大纹理提示
				"scnRender.watchdog": "场景首帧看门狗（自动兜底）",
				"scnRender.watchdog.desc": "应用场景后 N 秒内渲染器没有出画（首帧缩略图未上报）→ 自动回退静态帧并在提示条说明；iframe 保留，可手动重试。渲染器恢复出画会自动切回实时渲染。全局回退口：localStorage 设 mpwwatch=0",
				"scnRender.watchdog.secs": "看门狗等待时长：",
				"scnRender.watchdog.secs.desc": "低配设备首帧慢可调大（范围 3–30 秒，默认 8 秒）。判定依据=渲染器首帧缩略图上报（宿主信标），与渲染器是否在线无关。",
				"scnRender.retry": "重试渲染器",
				"scnRender.retry.btn": "重新挂载渲染器",
				"scnRender.retry.desc": "当前壁纸是场景时：强制重载渲染器 iframe 并重启首帧看门狗（兜底状态下也可用；每场景自动重建限一次，手动不限）。",
				"scnRender.retry.noScene": "当前壁纸不是场景渲染器壁纸",
				"scnRender.retry.ok": "已重新挂载渲染器，等待首帧…",
				"scnRender.debug": "渲染器调试参数（白名单透传）",
				"scnRender.debug.ph": "如 ln=12 或 isolate=长发,nofx",
				"scnRender.debug.save": "保存",
				"scnRender.debug.clear": "一键清空",
				"scnRender.debug.saved": "调试参数已保存并净化",
				"scnRender.debug.cleared": "已清空调试参数，恢复默认渲染",
				"scnRender.debug.hint": "只接受白名单开关：ln|eyehack|novideo|audit|ownsize|att|hier|nofx|np|whitefallback|skiny|trace|isolate|parallax|qflip。逐个校验后拼进壁纸 URL，非法项自动丢弃（skin0 等危险开关永远带不进去）。保存后立即对当前场景生效，清空即恢复。",
				"scnRender.wd.fallback": "场景渲染器未按时出画，已回退静态帧；渲染器已保留，可稍后在 设置→场景渲染 里点“重新挂载渲染器”",
				"scnRender.wd.recovered": "场景渲染器已出画，自动恢复实时渲染",
				"scnRender.back": "渲染器已恢复在线，正在重新挂载场景…",
				"scnRender.bigTex": "该场景纹理总量较大，低配设备可能自动降采样",
				"scnRender.bigPkg": "该场景包体积较大，首帧可能较慢",
			// ①(MERGED-3 1.3/2.3) 诊断开关速查区（集合 == diag-flags.json common，panel-smoke 断言）
			"diag.sec": "诊断开关速查（渲染器）",
			"diag.sec.desc": "拼到渲染器地址后面用，如 http://127.0.0.1:8899/?id=3719111841&audit=3；常用开关如下，点「复制」拿 URL 片段。",
			"diag.expand": "展开开关",
			"diag.fold": "收起开关",
			"diag.copy": "复制",
			"diag.copied": "已复制",
				"diag.more": "全部开关见 we-scene-demo/README-DIAGNOSTICS.md（node diag-flag-check.mjs 校验代码与文档一致）。",
				"diag.fields": "上报新字段：ctxLost=WebGL 上下文丢失计数、maxTextureSize=设备纹理上限（超限黑层取证）、layerHealth=逐层健康（随 mpw-health 消息上报，规划中）。逐层调试 ln/eyehack/novideo/ownsize 等开关可经上方「渲染器调试参数」白名单透传进壁纸。",
			"diagflag.att": "附件锚点旧路径",
			"diagflag.att.d": "?att=legacy：锚点偏移走旧自算路径（对照 elysia 移植实现，位置误差大，仅 A/B）。",
			"diagflag.mcc": "网格中心补偿",
			"diagflag.mcc.d": "?mcc=1：强制开启网格包围盒中心补偿（旧自造行为，官方无此步，位置 A/B 用）。",
			"diagflag.piv": "子网格 pivot",
			"diagflag.piv.d": "?piv=1 全开 / ?piv=0 全关子网格中心补偿；默认只对眼睛组合生效。",
			"diagflag.align": "对齐旧行为",
			"diagflag.align.d": "?align=0：复现旧对齐（origin 恒几何中心），用于对齐语义 A/B。",
			"diagflag.parallax": "视差旧公式",
			"diagflag.parallax.d": "?parallax=legacy：鼠标视差退回旧 lwe 近似式；默认官方公式。",
			"diagflag.audio": "开启声音",
			"diagflag.audio.d": "?audio=1：播放场景 sound 层（每层一条流；浏览器策略可能需要先点一下页面）。",
			"diagflag.whitefallback": "缺纹理回退",
			"diagflag.whitefallback.d": "?whitefallback=0：缺纹理层改透明；默认与官方一致的白块。",
			"diagflag.hier": "父链合成回退",
			"diagflag.hier.d": "?hier=0：放弃父链合成，回退 refrender 绝对定位兜底。",
			"diagflag.isolate": "只画指定层",
			"diagflag.isolate.d": "?isolate=<层名>：只保留名字含关键词的层可见（逗号分隔多个），判定某层是否真的画了。",
			"diagflag.audit": "首帧逐层审计",
			"diagflag.audit.d": "?audit=N：首帧逐层审计 N 帧，日志定位渲染卡在哪一层。",
			"sec.liquid.desc": "Apple 液态玻璃效果测试区。总开关开启后禁用虚化/模糊/雾/主题色/时钟等外观类（壁纸+悬浮+布局保留），用于在纯净环境里测试玻璃效果。",
			"lg.test": "测试模式总开关",
			"lg.test.desc": "开启：只保留壁纸+悬浮+布局，外观类全部禁用",
			"lg.test.on": "✔ 测试模式已开启",
			"lg.glassTitle": "玻璃作用开关（叠加到 DSH 界面，需配合测试模式或独立使用）",
			"lgCss": "液态玻璃（CSS 版）",
			"lgCssAmount": "折射强度",
			"lgCss.desc": "纯 CSS/SVG 液态玻璃：左侧边栏/标题栏/输入框边缘产生折射与高光（Chromium 支持）。不占 WebGL 上下文，可与 scene 壁纸同时使用；不支持的环境自动回退为纯模糊",
			"lg.composer": "输入框液态玻璃",
			"lg.sidebar": "左侧边栏液态玻璃",
			"lg.header": "标题栏液态玻璃",
			"lg.glassOn": "✔ 已开启",
			"lg.glassOff": "开启玻璃",
			"lg.test.off": "开启测试模式",
			"lg.demo": "独立演示页（端口 3081）",
			"lg.demo.desc": "WebGL2 液态玻璃演示：内置渐变壁纸 + 可上传视频，拖动参数滑条实时看折射/磨砂/色散效果",
			"lg.demo.open": "打开演示页",
			"lg.note": "⚠ 演示页是独立服务（tools/liquid-demo/server.mjs），不影响主插件；玻璃层叠加到 DSH 界面的功能还在开发中。",
			"sec.wallpaper": "壁纸设置",
			"fpsCap": "解码帧率上限",
			"fpsCap.off": "无限制",
			"fpsCap.hint": "视频壁纸源帧率超过上限时，宿主端 ffmpeg 抽帧转码后播放（需 ffmpeg；web 壁纸不适用）",
			"resMax": "分辨率上限",
			"resMax.off": "原始分辨率",
			"resMax.hint": "视频壁纸源分辨率超上限时，ffmpeg 转码缩放（保持宽高比），降低解码/GPU 占用（需 ffmpeg）",
			"ffmpeg.status": "ffmpeg 状态",
			"ffmpeg.ready": "已就绪",
			"ffmpeg.missing": "未安装",
			"ffmpeg.download": "下载 ffmpeg",
			"ffmpeg.downloading": "下载中…",
			"ffmpeg.downloadOk": "已下载到缓存",
			"transcode.fallback": "转码失败（可能是 ffmpeg 未安装或分辨率/帧率设置过高），已回退播放原片。可装 ffmpeg 或把 分辨率上限/帧率上限 设为 无限制",
			"transcode.directRetry": "探测到该视频浏览器可直读 → 未启动转码（避免后台 ffmpeg 占用内存/CPU）；已改为直读原片重试一次",
			"ffmpeg.downloadHint": "下载会安装到插件缓存目录（不影响系统/环境已装的 ffmpeg）",
			"ffmpeg.uninstall": "卸载缓存 ffmpeg",
			"ffmpeg.uninstalling": "卸载中…",
			"ffmpeg.uninstallOk": "已卸载缓存 ffmpeg",
			"ffmpeg.uninstallHint": "只删除缓存目录的 ffmpeg，绝不碰系统 PATH / 环境变量指定的",
			"ffmpeg.srcCached": "缓存",
			"ffmpeg.srcSystem": "系统",
			"ffmpeg.srcEnv": "环境变量",
			"backup.title": "备份与恢复",
			"bs.title": "dsh-better-sidebar 适配",
			"bs.desc": "检测到 dsh-better-sidebar 已安装。总开关关闭 = 不启用任何适配（better-sidebar 保持原生外观）；开启后可逐个启用下方适配项",
			"bs.master": "启用 better-sidebar 适配",
			"bs.master.desc": "总开关：关 = 全部适配不生效",
			"bs.float": "悬浮效果适配",
			"bs.float.desc": "左侧边栏悬浮卡片同样作用于 better-sidebar 面板（圆角/边距；防切掉内容）",
			"bs.font": "字体颜色增强",
			"bs.font.desc": "better-sidebar 面板文字跟随自定义灰色字/深底可读增强",
			"bs.reveal": "透出壁纸",
			"bs.revealAlpha": "透出程度",
			"bs.reveal.desc": "better-sidebar 面板背景半透明透出壁纸（跟随透明度条）",
			"bs.aqua": "跟随 Aqua 实验效果",
			"bs.aqua.desc": "双开关：本开关 + Aqua 实验里对应开关（统一雾/面板取色/自适应文字）都开启时，better-sidebar 面板才应用对应效果",
			"backup.desc": "导出/导入外观设置（外观·统一虚化·界面虚化·Aqua·其他；不含当前壁纸与扫描目录）。导出的文件可分享给他人导入",
			"backup.export": "导出备份",
			"backup.import": "导入备份",
			"backup.exported": "备份已导出",
			"backup.imported": "备份已导入并应用",
			"backup.bad": "备份文件无效或不含本插件设置",
			"backup.fail": "导出失败：",
			"backup.fileName": "最近导出：",
			"sec.aqua": "Aqua 实验",
			"sec.aqua.desc": "外观方案来自 Bil812（PR #2）的构想，已采用并全部做成独立开关（默认全关，不影响原功能）：自适应文字 = 文字色随背景亮度变化 + 蓝色清理。（统一雾开关已移到「界面统一」tab 第 2 类；面板取色开关已移到「外观」tab 的主题颜色区域）",
			"aqua.credit": "Bil812 的 PR #2（方案来源）",
			"aquaMask": "统一雾（全屏遮罩）",
			"aquaMask.desc": "所有表面（左侧边栏/标题栏/聊天区/按钮）共享一种雾色（强度由下方「统一雾强度」条控制），不再分区白雾；关 = 保持现有分区雾",
			"aquaMaskAlpha": "统一雾强度",
			"aquaTint": "面板颜色匹配壁纸",
			"aquaTint.desc": "开 = 自动采样壁纸主色作为面板底色（视频/GIF 每 2 秒刷新），此时下方「遮罩自定义色」取色盘禁用；关 = 手动用取色盘选色",
			"aquaInk": "自适应文字色 + 蓝色清理",
			"aquaColor": "遮罩自定义色（取色盘）",
			"aquaColor.hint": "设置后优先于壁纸取色；点「默认」恢复自动（面板颜色匹配壁纸开启时此取色盘禁用）",
			"aquaColorReset": "默认",
			"aquaInkColor": "品牌/发送键自定义色（取色盘）",
			"aquaInkColor.hint": "发送键/主按钮/插件文字用它（默认 = 自适应墨色）；设深色可让发送键箭头清晰",
			"aquaTextEnhance": "深底文字可读增强",
			"aquaTextEnhance.desc": "给聊天区文字加双色描边，黑色/深色背景上也能看清（近似方案：无法精确到'只变经过深色处的字'；默认关）",
			"todoBlur": "任务列表磨砂",
			"glass.title": "液态玻璃（elysia395 方案）",
			"glass.desc": "设置卡片/弹窗玻璃化：玻璃底色 + 白叠层强度 + 总开关（与 Aqua 其他功能独立，默认关）",
			"glassWindow": "设置窗口液态玻璃",
			"glassWindow.desc": "整个设置卡片/弹窗玻璃化（半透明 + 模糊 + 底色 tint）",
			"glass.accent": "配色（accent）",
			"glass.accent.hint": "驱动按钮/滑条/选中/链接/发送键等品牌交互元素（与主题颜色分工：它管整体底色）",
			"glass.color": "玻璃颜色",
			"glass.color.hint": "玻璃底色 tint（默认亮=白/暗=深夜蓝；两主题统一用所选色）",
			"glass.alpha": "玻璃透明度",
			"glass.reset": "默认",
			"todoBlur.desc": "对话中列出的任务（todo 卡片）背景模糊，收纳/展开状态统一（类似标题栏/左侧边栏磨砂；默认关）",
			"fontColorGray": "自定义灰字颜色",
			"fontColorGray.desc": "开但未选色时跟随主题灰（与关闭一致）；选一个颜色后，所有次级/三级/弱化灰字与分隔线/边框灰都变成该颜色",
			"fontColorGray.color": "灰字颜色",
			"fontColorGray.hint": "选色后覆盖 label-secondary/tertiary/caption/dimmed/quaternary/primary-bluish 及分隔线/边框/警告灰（约 17 个灰色 token）；未选区时保持主题灰（=关闭态）",
			"aquaInk.desc": "文字颜色随遮罩亮度自适应（亮底深字/暗底浅字），并把品牌蓝等硬编码色统一为墨色衍生色",
			"mpkg.pick": "选择 .mpkg 文件",
			"mpkg.busy": "解析中…",
			"mpkg.hint": "支持 Wallpaper Engine 的 .mpkg 包；此位置也可直接选择 mp4/webm 视频文件；视频类壁纸自动播放内嵌 mp4",
			"mpkg.noAsset": "该 mpkg 内未找到图片/GIF 素材",
			"mpkg.previewMode": "预览模式：当前以预览图显示；该壁纸的完整动态内容（Live2D 场景/高清视频）需壁纸引擎 App 渲染",
			"mpkg.tooLarge": "背景素材过大（视频>600MB / 图片>200MB），浏览器无法处理，请换一个 mpkg",
			"mpkg.huge": "文件过大（>600MB），移动端浏览器无法处理，请换小一点的 mpkg",
			"mpkg.videoHuge": "视频文件过大（>600MB），浏览器无法播放，已自动回退使用预览图",
			"mpkg.quota": "浏览器存储空间不足，无法保存此壁纸素材（可清除其他壁纸后再试）",
			"mpkg.oom": "文件过大导致内存不足，解析失败。请换小于 300MB 的壁纸，或用壁纸引擎 App 查看",
			"mpkg.vtexBig": "此壁纸的视频纹理超过 250MB，浏览器无法播放（请用壁纸引擎 App 查看）",
			"mpkg.fail": "解析失败：",
			"mpkg.using": "当前背景素材",
			"props.title": "可调参数",
			"webcfg.title": "网页壁纸选项",
			"webcfg.desc": "此壁纸自带设置（分辨率/语言/音量），已隐藏其内置面板，改这里生效",
			"webcfg.bgm": "背景音乐音量",
			"webcfg.talk": "语音音量",
			"webcfg.touch": "显示触摸区域框",
			"webcfg.talkbox": "显示文本框",
			"webcfg.applied": "网页壁纸选项已应用（重载中）",
			"webcfg.sandboxHint": "当前是沙箱模式（帧与插件不同源），无法读写壁纸自身的 localStorage。要改这些选项，请用「兼容模式（同源）」重新应用该壁纸。",
			"webcfg.noFrame": "壁纸尚未加载完成，请稍候",
			"webcfg.saveFail": "保存失败：",
			"webcfg.fail": "应用失败：",
			"props.desc": "浏览器显示的是壁纸引擎预渲染的素材，修改参数不会改变画面。以下为壁纸自带的参数及当前值，供对照：如需修改，请在壁纸引擎 App 中调整",
			"props.unavailable": "暂不可用",
			"props.on": "开",
			"props.off": "关",
			"props.expand": "展开全部",
			"props.important": "★ 关键开关",
			"props.resetWallpaper": "重置壁纸参数",
			"props.resetDone": "壁纸参数已恢复默认",
			"props.tvOff": "随现实时间变化已关闭，时间设置已隐藏（打开开关后显示）",
			"roundCompat": "第三方 UI 圆角兼容",
			"update.title": "检查更新",
			"update.check": "检测更新",
			"update.badge": "有新版本",
			"update.checking": "检测中…",
			"update.apply": "一键更新",
			"update.applying": "更新中…",
			"update.found": "发现新版本：",
			"update.latest": "已是最新版本",
			"update.diff": "本地与 GitHub 代码存在内容差异（版本号相同，可能是本地有未推送的改动）——推送后即一致",
			"update.applied": "更新完成！请重启 dsh web 并 Ctrl+F5 生效",
			"update.fail": "检查失败：",
			"update.market": "去插件市场更新",
			"update.gotoMarket": "已提示：请到插件市场（dshmarket）更新此插件（推荐，避免与市场版本检测冲突）",
			"update.readonly": "当前为市场安装（插件目录只读），无法内置更新——请到插件市场或 dsh plugin update 更新",
			"update.chooseTitle": "更新方式确认",
			"update.chooseBody": "推荐先到插件市场更新（semver 检测与市场一致）。确认仍用本插件的直接更新（拉取 GitHub 代码写回本地）吗？版本 ",
			"update.confirmSelf": "直接用本插件更新",
			"roundCompat.desc": "给其他插件注入界面的矩形容器补圆角（不覆盖插件自己的样式）；如与某插件冲突可关闭",
			"powPauseHidden": "省电·页面隐藏/切页暂停",
			"powPauseHidden.desc": "最小化/切页时暂停壁纸视频（解码归零），回来自动继续",
			"powPauseBlur": "省电·失焦暂停",
			"powPauseBlur.desc": "窗口失去焦点（切到其他窗口）时暂停壁纸，回来继续",
			"powPauseBattery": "省电·电池供电暂停",
			"powPauseBattery.desc": "使用电池供电时不播放壁纸（省电），接通电源自动恢复",
			"error.title": "导入失败",
			"preview.title": "预览模式",
			"preview.desc": "该壁纸当前以预览图（GIF/图片）显示，浏览器无法播放其动态内容（Live2D 场景/高清视频需壁纸引擎 App 渲染）。",
			"preview.ok": "知道了",
			"props.none": "请先导入壁纸",
			"props.collapse": "收起",
			"url.label": "图片链接（支持 data:image 的 GIF）",
			"url.placeholder": "https://… 或 data:image/…",
			"url.apply": "应用",
			"url.unsafe": "仅支持 http/https 或 data:image 链接",
			"file.unsafe": "不支持的文件类型（已拒绝）",
			"file.pick": "选择本地图片/动图",
			"file.hint": "支持图片/动图（大文件自动存本地，刷新不丢）",
			"file.tooLarge": "文件超过 100MB，请换一张或使用链接。",
			// ①(2026-09-17 持久化轮) 大图落 IndexedDB 的**状态可见**文案（刷新后仍能恢复）
			"persist.idb": "当前壁纸较大，已存入 IndexedDB（刷新/重启后自动恢复）",
			"brightness": "画面亮度",
			"float": "悬浮效果",
			"float.desc": "左侧边栏/标题栏变为悬浮卡片（圆角+阴影+透出模糊壁纸）；默认关，开启后原有的透明/虚化功能不受影响",
			"flipX": "水平翻转（镜像）",
			"flipX.desc": "壁纸左右镜像（scaleX -1）",
			"flipY": "垂直翻转（镜像）",
			"flipY.desc": "壁纸上下镜像（scaleY -1）",
			"themeColor": "主题颜色",
			"newStyle": "新样式开关（uiverse 风格）",
			"newStyle.desc": "开关与倍速按钮换成新样式（轨道开关 + radio 圆点）；关 = 旧样式",
			"themeColor.hint": "控制左侧边栏 / 标题栏 / 新会话按钮 / 设置弹窗的整体底色 tint（取色盘 + 预置）；品牌交互元素（按钮/选中/链接）由 Aqua 区的「配色」控制；空 = 不启用",
			"speed": "视频倍速",
			"speed.hint": "视频壁纸播放速度（0.5x–2x，原生播放器变速，即时生效不重载）",
			"rot.title": "轮播列表管理",
			"rot.all": "全部壁纸（不限定列表）",
			"rot.manage": "管理列表",
			"rot.empty": "还没有轮播列表。点「新建列表」从壁纸中挑选，或扫描 Steam 库自动导入 WE 播放列表。",
			"rot.new": "新建列表",
			"rot.newTitle": "新建轮播列表",
			"rot.edit": "编辑",
			"rot.editTitle": "编辑轮播列表",
			"rot.del": "删除",
			"rot.save": "保存",
			"rot.items": " 个壁纸",
			"rot.seq": "顺序",
			"rot.random": "随机",
			"rot.namePh": "列表名称",
			"rot.unnamed": "未命名列表",
			"rot.pickHint": "勾选参与轮播的壁纸",
			"rot.emptyKeys": "请至少勾选一个壁纸",
			"rot.wePlaylist": "WE 播放列表",
			"rot.seeded": "已导入 WE 原生播放列表",
			"rot.groupInterval": "该列表轮换间隔",
			"rot.order": "播放顺序",
			"rot.noWallpapers": "没有可选的壁纸（先扫描壁纸库）",
			"rot.scanDir": "扫描自定义目录",
			"rot.filterCustom": "自定义",
			"rot.filterSteam": "Steam库",
			"rot.scanLib": "扫描本地库",
			"rot.intervalHint": "间隔在选中列表后下方单独设置",
			"themeColorReset": "默认",
			"blur": "磨砂模糊",
			"blur.overridden": "统一虚化 + 聊天区跟随均开启：壁纸模糊由「整屏虚化程度」接管，磨砂条暂不可调；关闭「聊天区跟随整屏虚化」后磨砂条恢复可调（此时统一虚化只管左侧边栏/标题栏）",
			"zoom": "镜头缩放",
			"lens.pos": "镜头位置（平移）",
			"lens.x": "X",
			"lens.y": "Y",
			"sidebar": "左侧边栏透出壁纸",
			"sidebar.unifyHint": "统一虚化开启中：左侧边栏的透出程度由「透明度」条控制（关掉本开关 = 完全不透明）",
			"sidebar.desc": "关闭后左侧边栏恢复不透明，避免左右透明度不一致",
			"headerBlur": "标题栏磨砂",
			"headerBg": "标题栏透出壁纸",
			"headerBg.unifyHint": "统一虚化开启中：标题栏的透出程度由「透明度」条控制（关掉本开关 = 完全不透明）",
			"headerBg.desc": "关闭后标题栏为纯白（暗色主题为纯深色）不透明，不再显示壁纸",
			"headerBlur.desc": "标题栏透出壁纸，磨砂程度由下方滑条控制（默认 0 = 透明，session log 等按钮不会被白色矩形框包住；拉高可加白雾保证文字可读）。需先开启「标题栏透出壁纸」",
			"headerBlurAmount": "标题栏磨砂程度",
			"headerFrostOwn": "单独调节标题栏磨砂",
			"headerFrostOwn.desc": "默认关闭：标题栏磨砂跟随「整屏虚化程度」（统一虚化开时不能被单独关掉，否则会露出壁纸）。开启后由下面的滑条单独指定半径",
			"headerFrostAmount": "标题栏磨砂强度",
			
			"unifyTint": "统一虚化",
			"unifyTint.desc": "开启后，左侧边栏获得类似聊天框的毛玻璃虚化（整块模糊、无缝隙），强度由「整屏虚化程度」条控制；左侧边栏表面白雾厚度由「左侧边栏透明度」条控制；标题栏始终按自己的磨砂条（默认透明）。关闭后各区域单独调节",
			"unifyAmount": "整屏虚化程度",
			"sidebarAlpha": "左侧边栏/标题栏透明度",
			"sidebarAlpha.desc": "统一虚化开启时：左侧边栏表面的白雾厚度（0 = 全透明透出模糊壁纸，100 = 实心）。与「整屏虚化程度」解耦，可单独调；标题栏不再跟随（按自己的磨砂条）",
			"chatFollow": "聊天区跟随整屏虚化",
			"chatFollow.desc": "统一虚化开启时：开 = 聊天区壁纸模糊也随「整屏虚化程度」（磨砂条被接管禁用）；关 = 磨砂条恢复可调，聊天区壁纸由磨砂条控制（统一虚化只虚化左侧边栏/标题栏）",
			"sessionFollow": "新会话按钮跟随面板不透明度",
			"sessionFollow.desc": "统一虚化开启时：「添加新会话」按钮是否随「不透明度」条。关 = 保持原按钮色",
			"dialogBlur": "虚化对话框",
			"dialogBlur.desc": "屏幕中央的通用居中窗口（非设置面板/非本插件弹窗）和聊天输入框的背景虚化；滚动经过输入框的文字会变朦胧。设置面板与下载确认弹窗各有独立开关",
			"dialogBlurAmount": "对话框虚化程度",
			"settingsBlur": "虚化设置面板",
			"settingsBlur.desc": "DSH 设置面板（本插件的设置界面所在的面板）的背景虚化，程度独立于通用对话框",
			"settingsBlurAmount": "设置面板虚化程度",
			"confirmBlur": "虚化下载/确认弹窗",
			"confirmBlur.desc": "本插件的下载确认、冲突检测、错误提示等弹窗的背景虚化；关闭则弹窗不透明",
			"confirmBlurAmount": "下载/确认弹窗虚化程度",
			"popoverBlur": "虚化弹层",
			"popoverBlur.desc": "从界面某处弹出的面板：右键菜单、下拉选择、提示气泡等",
			"popoverBlurAmount": "弹层虚化程度",
			"popoverAlpha": "弹层不透明度",
			"popoverAlpha.desc": "弹层表面的底色浓度。虚化生效时调到 80 左右就有玻璃感；如果环境不支持虚化（Via/WebView），请保持 94 以上避免看穿背后文字",
			"maskBlur": "虚化遮罩（全屏背景）",
			"maskBlur.desc": "打开设置面板或弹层时，窗口后面那层半透明背景的朦胧程度",
			"maskBlurAmount": "遮罩虚化程度",
			"sidebarBlur": "左侧边栏磨砂",
			"rightSidebarBlur": "右侧边栏/dock 虚化",
			"rightSidebarBlurAmount": "虚化程度",
			"rightSidebarAlpha": "表面透明度",
			"rightSidebarBlur.desc": "适配 DSH 0.1.5 自带的右侧边栏与底部 dock 浮层（补打旧类名使其命中同一套虚化规则）。",
			"sidebarBlur.desc": "左侧边栏自身玻璃化（backdrop-filter 模糊其背后的壁纸），开启后左侧边栏有类似 Aqua 的磨砂玻璃质感；打开弹窗时自动摘除以防弹窗被左侧边栏模糊层困住",
			"sidebarBlurAmount": "左侧边栏磨砂程度",
			"sidebarBlur.overridden": "统一虚化开启中：左侧边栏磨砂由「整屏虚化程度」+「透明度」接管；关闭统一虚化后此开关恢复可调",
			"rightSidebarBlur.overridden": "Unified blur is on: right sidebar / dock frost is taken over by the screen blur amount + surface opacity; turn Unified blur off to adjust this switch again",
			"rightSidebarBlur.overridden": "统一虚化开启中：右侧边栏/dock 虚化由「整屏虚化程度」+「透明度」接管；关闭统一虚化后此开关恢复可调",
			"sidebarBlur.needReveal": "需先开启「左侧边栏透出壁纸」才能使用左侧边栏磨砂（受左侧边栏透出控制）",
			"headerBlur.overridden": "统一虚化开启中：标题栏磨砂由「整屏虚化程度」+「透明度」接管；关闭统一虚化后此开关恢复可调",
			"thinkBg": "Deep diving 背景方框",
			"thinkBg.desc": "开：显示思考状态（Deep diving）的模糊背景方框；关（默认）：背景透明，文字直接显示在壁纸上",
			"blur.unsupported": "⚠️ 当前浏览器（Via/WebView）不真正渲染背景模糊，虚化仅显示半透明。建议用 Chrome/Firefox 浏览器获得完整磨砂效果",
			"sharp": "轻度锐化",
			"sharp.desc": "提升低清 GIF 观感；若动画卡顿请关闭",
			"time.picked": "已按当前时间选择素材",
			"time.now": "当前时段",
			"time.slot": "时段",
			"time.auto": "自动",
			"time.locked": "已手动锁定时段，将不再随时间自动切换（点「自动」恢复）",
			"time.morning": "清晨",
			"time.day": "白天",
			"time.dusk": "黄昏",
			"time.night": "夜晚",
			"reset": "恢复所有默认设置",
			"feedback": "前往反馈",
			"default": "默认",
			// ①(P-66 真 bug 修复) 键集合对齐：clock.* 原来只躺在 en 里（切英文正常、切中文反而出英文）
			"clock.title": "显示时间（时钟）",
			"clock.desc": "在背景上叠加实时时钟，并替换 DSH 自带的时钟组件",
			"clock.24h": "24 小时制",
			"clock.sec": "显示秒",
			"clock.date": "显示日期",
			"clock.pos": "位置",
			"clock.tl": "左上",
			"clock.tr": "右上",
			"clock.bl": "左下",
			"clock.br": "右下",
			// ①(P-66 真 bug 修复) 原来硬编码在 JSX 里的中文（英文界面会漏中文）
			"hybrid.status": "当前状态",
			"scnRender.reapplied": "（已重挂）",
		};
		const en = {
			"nav": "MPKG Wallpaper",
			"master": "Enable mpkg background",
			"clear.bg": "Clear wallpaper",
			"wall.type": "Wallpaper type",
			"none": "None",
			"pause.pause": "Pause wallpaper",
			"pause.play": "Play wallpaper",
			"refresh.bg": "Refresh wallpaper",
			"refresh.done": "Wallpaper refreshed",
			"master.desc": "On applies the chosen background",
			"master.off": "Disabled (conflicting wallpaper/theme plugins detected or manually off)",
			"hybrid": "Upload to dsh for streaming playback",
			"lib.title": "Local wallpaper library (Steam discovery)",
			"lib.scan": "Scan local library",
			"lib.desc": "On Windows with Wallpaper Engine installed, discovers video/web wallpapers",
			"lib.use": "Use",
			"lib.empty": "No usable wallpapers found (or not a Windows environment)",
			"lib.noHost": "Host unavailable — cannot scan the local library",
			"lib.noInstall": "Wallpaper Engine install not found (requires Windows + Steam Wallpaper Engine)",
			"lib.fail": "Scan failed: ",
			"lib.sceneOnly": "Scene wallpapers cannot be rendered in the browser (preview only)",
			"lib.webPending": "Web (HTML) wallpaper support is in development; use mpkg import for now",
			"lib.applied": "Applied wallpaper",
			"scene.extracting": "Extracting scene static frame…",
			"scene.probing": "Analyzing scene…",
			"busy.transcoding": "Transcoding (res/fps cap)…",
			"web.confirmTitle": "Apply web wallpaper? (experimental)",
			"web.riskHeavy": "⚠ Preflight: Spine/L2D skeletal-animation wallpaper — may freeze the UI on low-end devices",
			"web.riskExternal": "⚠ Preflight: depends on external resources (SDK/CDN) — may fail to load",
			"web.confirmBody": "Web wallpapers may freeze or fail to load",
			"web.confirmHint": "Some web wallpapers (event pages / heavy animations) can freeze the UI on low-end devices; if frozen, refresh the page to recover (it will not auto-reload). If loading fails, the wallpaper shows a black screen with a refresh button — that is the wallpaper's own content, not a bug.",
			"web.confirmShim": "Sandbox mode (recommended)",
			"web.confirmCompat": "Compatibility mode (same-origin)",
			"web.modeHint": "Sandbox mode: the host injects the WE API (wallpaperPropertyListener / audio / media) before author scripts, and the plugin drives properties plus mute/speed/pause; the frame is an opaque origin, so wallpaper scripts cannot reach the DSH UI or local storage. Compatibility mode: same-origin (the old behaviour) — required by the \"Web wallpaper options\" (resolution / language / volume) of Live2D-style wallpapers.",
			"lib.custom": "Custom local wallpaper folder",
			"mute": "Mute (web wallpapers)",
			"mute.desc": "Web wallpapers often have audio; muted by default. Off = play wallpaper sound",
			"lib.customHint": "You can point directly at the Steam Workshop root (workshop/content/431960): every subfolder is auto-detected as a wallpaper (scene.pkg scene / mp4 video / index.html web); any folder works too — .mpkg files and workshop folders can be mixed freely",
			"lib.dirPlaceholder": "e.g. C:\\壁纸 or /home/user/壁纸",
			"lib.browse": "Browse…",
			"lib.pickDir": "Choose folder",
			"lib.curDir": "Current path",
			"lib.up": "Up",
			"lib.noSub": "(no subfolders)",
			"lib.chooseHere": "Choose this folder",
			// ①(item 13) selector shortcut hint (contract: click the list or Tab into it, then ↑↓)
			"lib.kbdHint": "Tip: click the list (or Tab into it) to use ↑↓ to move, Home/End for first/last, Enter to open (with no row selected it chooses this folder), Backspace for parent, Esc to close. Opening the dialog never moves your focus or your scroll position.",
			"lib.home": "Home",
			"lib.scanDir": "Scan folder",
			"lib.dirEmpty": "Enter a wallpaper folder path first",
			"lib.dirFail": "Invalid or unreadable folder: ",
			"lib.dirFound": "Found ",
			"lib.dirFiles": " media files (images/videos)",
			"lib.rotate": "Wallpaper switching & rotation",
			"lib.next": "Next wallpaper",
			"lib.prev": "Previous wallpaper",
			"lib.more": "Expand more",
			"lib.collapse": "Collapse list",
			"lib.expandAll": "Expand wallpapers",
			"lib.rotateDesc": "Automatically switch to the next wallpaper on a timer (range: custom folder + local library + Steam-discovered video wallpapers)",
			"lib.rotMerged": "Playable Steam-library videos merged into the rotation: ",
			"lib.rotateMin": "Rotation interval",
			"speed": "Video speed",
			"speed.hint": "Video wallpaper playback speed (0.5x–2x, native player rate, instant, no reload)",
			"rot.title": "Carousel list management",
			"rot.all": "All wallpapers (no list)",
			"rot.manage": "Manage lists",
			"rot.empty": "No carousel lists yet. Click \"New list\" to pick wallpapers, or scan the Steam library to auto-import WE playlists.",
			"rot.new": "New list",
			"rot.newTitle": "New carousel list",
			"rot.edit": "Edit",
			"rot.editTitle": "Edit carousel list",
			"rot.del": "Delete",
			"rot.save": "Save",
			"rot.items": " wallpapers",
			"rot.seq": "Sequence",
			"rot.random": "Random",
			"rot.namePh": "List name",
			"rot.unnamed": "Unnamed list",
			"rot.pickHint": "Check wallpapers to include in rotation",
			"rot.emptyKeys": "Select at least one wallpaper",
			"rot.wePlaylist": "WE playlist",
			"rot.seeded": "Imported WE native playlist",
			"rot.groupInterval": "This list rotation interval",
			"rot.order": "Play order",
			"rot.noWallpapers": "No wallpapers to pick (scan a wallpaper library first)",
			"rot.scanDir": "Scan custom folder",
			"rot.filterCustom": "Custom",
			"rot.filterSteam": "Steam library",
			"rot.scanLib": "Scan local library",
			"rot.intervalHint": "Interval is set separately below after selecting a list",
			"lib.minutes": "min",
			"hybrid.desc": "On: mpkg is uploaded to the DSH host and streamed (>600MB supported; restart dsh web for the host half). Off: all files play in the local browser (600MB cap)",
			"hybrid.status.ok": "Host side available (no 600MB limit for large files)",
			"hybrid.status.fallback": "Host side unavailable (fell back to browser-only, 600MB cap)",
			"hybrid.status.detecting": "Detecting host side…",
			"hybrid.status.browserOnly": "Browser-only mode (600MB cap)",
			"conflict.detected": "Potentially conflicting plugins detected",
			"conflict.title": "Plugin conflict detected",
			"conflict.body": "These plugins may conflict with this feature (both alter the UI background/appearance). Enable anyway?",
			"conflict.confirm": "Enable anyway",
			"conflict.cancel": "Cancel",
			"title": "Wallpaper Engine mpkg background",
			"desc": "Load Wallpaper Engine .mpkg files as the page background: video wallpapers play their embedded mp4, scene wallpapers use their preview.gif. Supports time-of-day switching, a clock, lens zoom, and UI frosted blur. Settings persist in this browser.",
			"sec.source": "Background source",
			"sec.appearance": "Appearance",
			"sec.appearance.desc": "Panel opacity = frosted tint thickness of all areas; Frosted blur = how blurred the wallpaper itself is (0 = sharp); Lens zoom/position = zoom and pan of the background image (zoom out to see components at the picture edges)",
			"sec.blur": "UI blur",
			"sec.blur.desc": "Backdrop blur when each popup layer opens: dialogs (generic center windows + chat input), the settings panel, and download/confirm popups each have their own switch; popovers = menus/dropdowns/tooltips; mask = the full-screen dim behind popups; sidebar frost = the sidebar itself becomes glass",
			"sec.unify": "Surface unify",
			"sec.unify.desc": "One place manages the whole-surface look with two independent groups: ①Unified frost = wallpaper blur + fog thickness (sidebar/title-bar frosted glass); ②Unified fog = full-screen color mist shared by every surface. When on, the sidebar frost below is taken over",
			"sec.unifyFog": "Unified fog (tint)",
			"sec.unifyFog.desc": "Full-screen solid-color mist: every surface (sidebar/title bar/chat/buttons) shares one fog color and density for a unified tint; off = keep per-area colors",
			"sec.show": "Show wallpaper",
			"sec.show.desc": "Whether the corresponding area shows the wallpaper: off = solid color, opaque",
			"sec.picture": "Wallpaper picture",
			"sec.power": "Power saving",
			"sec.other": "Other",
			"sec.liquid": "Liquid Glass (test)",
			"sec.liquid.desc": "Apple Liquid Glass effect test area. The master switch disables appearance features (blur/fog/theme/clock) while keeping wallpaper + float + layout, for testing the glass effect in a clean environment.",
			"lg.test": "Test mode master switch",
			"lg.test.desc": "ON: only wallpaper + float + layout; appearance features disabled",
			"lg.test.on": "✔ Test mode ON",
			"lg.glassTitle": "Glass layer switches (overlay onto the DSH UI)",
			"lgCss": "Liquid glass (CSS)",
			"lgCssAmount": "Refraction",
			"lgCss.desc": "Pure CSS/SVG liquid glass: refraction + specular edges on sidebar / title bar / composer (Chromium). Uses no WebGL context, so it can run alongside a scene wallpaper; falls back to plain blur when unsupported",
			"lg.composer": "Liquid glass on input box",
			"lg.sidebar": "Liquid glass on sidebar",
			"lg.header": "Liquid glass on header",
			"lg.glassOn": "✔ ON",
			"lg.glassOff": "Enable glass",
			"lg.test.off": "Enable test mode",
			"lg.demo": "Standalone demo page (port 3081)",
			"lg.demo.desc": "WebGL2 liquid glass demo: built-in gradient + upload your own video; drag sliders to see refraction/frost/dispersion live",
			"lg.demo.open": "Open demo page",
			"lg.note": "⚠ The demo page is a standalone service (tools/liquid-demo/server.mjs), independent of the main plugin; overlaying the glass layer onto the DSH UI is still in progress.",
			"sec.wallpaper": "Wallpaper",
			"fpsCap": "Decode fps cap",
			"fpsCap.off": "Unlimited",
			"fpsCap.hint": "When the source fps exceeds the cap, the video is transcoded via host ffmpeg before playback (ffmpeg required; not applicable to web wallpapers)",
			"resMax": "Resolution cap",
			"resMax.off": "Original",
			"resMax.hint": "When the source resolution exceeds the cap, ffmpeg scales it down (aspect kept) to cut decode/GPU load (ffmpeg required)",
			"ffmpeg.status": "ffmpeg status",
			"ffmpeg.ready": "Ready",
			"ffmpeg.missing": "Not installed",
			"ffmpeg.download": "Download ffmpeg",
			"ffmpeg.downloading": "Downloading…",
			"ffmpeg.downloadOk": "Downloaded to cache",
			"transcode.fallback": "Transcode failed (ffmpeg missing or resolution/fps cap too high); playing the original. Install ffmpeg or set Resolution/FPS caps to Unlimited",
			"transcode.directRetry": "This video is directly playable in the browser — transcoding was NOT started (avoids a background ffmpeg hogging RAM/CPU); retrying the original once",
			"ffmpeg.downloadHint": "Download installs into the plugin's cache dir (does not touch system/env ffmpeg)",
			"ffmpeg.uninstall": "Uninstall cached ffmpeg",
			"ffmpeg.uninstalling": "Uninstalling…",
			"ffmpeg.uninstallOk": "Cached ffmpeg removed",
			"ffmpeg.uninstallHint": "Only removes the cached binary; never touches system PATH / env ffmpeg",
			"ffmpeg.srcCached": "cache",
			"ffmpeg.srcSystem": "system",
			"ffmpeg.srcEnv": "env",
			"backup.title": "Backup & Restore",
			"bs.title": "dsh-better-sidebar compatibility",
			"bs.desc": "dsh-better-sidebar detected. Master off = no adaptation (sidebar keeps its native look); turn it on to enable the individual items below",
			"bs.master": "Enable better-sidebar adaptation",
			"bs.master.desc": "Master switch: off disables every adaptation below",
			"bs.float": "Floating-card adaptation",
			"bs.float.desc": "Apply the floating-card look (rounded corners/margins) to better-sidebar panels too (without clipping content)",
			"bs.font": "Font color enhancement",
			"bs.font.desc": "better-sidebar text follows the custom gray-text / dark-background readability settings",
			"bs.reveal": "Reveal wallpaper",
			"bs.revealAlpha": "Reveal amount",
			"bs.reveal.desc": "better-sidebar panel backgrounds become translucent so the wallpaper shows through (follows the transparency sliders)",
			"bs.aqua": "Follow Aqua experiment effects",
			"bs.aqua.desc": "Double switch: this + the matching Aqua experiment toggle (unified fog / panel tint / adaptive ink) both on = the effect applies to better-sidebar panels",
			"backup.desc": "Export/import appearance settings (Appearance · Unified Blur · UI Blur · Aqua · Other; not the current wallpaper or scanned dirs). Exported file can be shared",
			"backup.export": "Export backup",
			"backup.import": "Import backup",
			"backup.exported": "Backup exported",
			"backup.imported": "Backup imported and applied",
			"backup.bad": "Invalid backup file or no plugin settings inside",
			"backup.fail": "Export failed: ",
			"backup.fileName": "Latest export: ",
			"newStyle": "New-style switches (uiverse look)",
			"newStyle.desc": "Toggles and the speed selector use the new style (track switch + radio dots); off = old style",
			"sec.aqua": "Aqua experiment",
			"sec.aqua.desc": "Appearance ideas from Bil812 (PR #2), adopted and made into independent toggles (all OFF by default, original features untouched): adaptive ink = text follows background brightness + blue cleanup. (The unified-fog toggle moved to the Surface-unify tab, group ②; the panel-tint toggle moved to the Appearance tab, Theme-color area)",
			"aqua.credit": "Bil812 PR #2 (idea source)",
			"aquaMask": "Unified fog (full-screen mask)",
			"aquaMask.desc": "Every surface (sidebar/title bar/chat/buttons) shares one fog color (strength by the Unified-fog-strength slider below) instead of per-area fog; off = keep the current per-area fog",
			"aquaMaskAlpha": "Unified fog strength",
			"aquaTint": "Panel colors match wallpaper",
			"aquaTint.desc": "On = auto-sample the wallpaper's dominant color as the panel base (videos/GIFs refresh every 2s), the Custom mask color picker below is disabled; Off = pick a color manually with the picker",
			"aquaInk": "Adaptive text color + blue cleanup",
			"aquaColor": "Custom mask color (picker)",
			"aquaColor.hint": "When set, takes priority over wallpaper tint; Default restores auto (this picker is disabled while Panel-colors-match-wallpaper is on)",
			"aquaColorReset": "Default",
			"aquaInkColor": "Custom brand / send-button color (picker)",
			"aquaInkColor.hint": "Send button / primary buttons / plugin text use it (default = adaptive ink); a dark color keeps the send arrow visible",
			"aquaTextEnhance": "Dark-background text readability",
			"aquaTextEnhance.desc": "Adds a dual-color text outline to chat text so it stays readable over black/dark backgrounds (approximation - cannot limit to text passing over dark areas only; off by default)",
			"todoBlur": "Task list frost",
			"todoBlur.desc": "Frosted background for the task (todo) cards in the conversation, collapsed and expanded alike (like the title-bar/sidebar frost; off by default)",
			"fontColorGray": "Custom gray text color",
			"fontColorGray.desc": "On without a color keeps the theme gray (same as off); pick a color to tint all secondary/tertiary/dimmed gray text and separator/border grays",
			"fontColorGray.color": "Gray text color",
			"fontColorGray.hint": "After picking a color, overrides label-secondary/tertiary/caption/dimmed/quaternary/primary-bluish and separator/border/warning grays (~17 gray tokens); no color = theme gray (=off state)",
			"aquaInk.desc": "Text color adapts to mask brightness (dark text on light / light on dark) and hard-coded brand blues are unified to ink-derived colors",
			"mpkg.pick": "Choose .mpkg file",
			"mpkg.busy": "Parsing…",
			"mpkg.hint": "Wallpaper Engine .mpkg packages; you can also pick an mp4/webm video file here; video wallpapers play their embedded mp4",
			"mpkg.noAsset": "No image/GIF asset found in this mpkg",
			"mpkg.previewMode": "Preview mode: showing the preview image; the wallpaper's full dynamic content (Live2D scene/HD video) requires the Wallpaper Engine app",
			"mpkg.tooLarge": "Background asset too large (video >600MB / image >200MB) — the browser cannot handle it",
			"mpkg.huge": "File too large (>600MB) — mobile browsers cannot handle it; pick a smaller mpkg",
			"mpkg.videoHuge": "Video too large (>600MB) — the browser cannot play it; automatically fell back to the preview image",
			"mpkg.quota": "Browser storage quota exceeded; free up space (clear other wallpapers) and retry",
			"mpkg.oom": "File too large — out of memory while parsing. Use a wallpaper under 300MB or view it in the Wallpaper Engine app",
			"mpkg.vtexBig": "This wallpaper's video texture exceeds 250MB — the browser cannot play it (view it in the Wallpaper Engine app)",
			"mpkg.fail": "Parse failed: ",
			"mpkg.using": "Current background asset",
			"props.title": "Adjustable options",
			"webcfg.title": "Web wallpaper options",
			"webcfg.desc": "This wallpaper has built-in options (resolution/language/volume); its built-in panel is hidden, adjust here",
			"webcfg.bgm": "BGM volume",
			"webcfg.talk": "Voice volume",
			"webcfg.touch": "Show touch-area boxes",
			"webcfg.talkbox": "Show text box",
			"webcfg.applied": "Web wallpaper option applied (reloading)",
			"webcfg.sandboxHint": "The wallpaper currently runs in sandbox mode (its frame is not same-origin), so its own localStorage cannot be read or written. Re-apply this wallpaper with \"Compatibility mode (same-origin)\" to change these options.",
			"webcfg.noFrame": "Wallpaper not loaded yet, wait a moment",
			"webcfg.saveFail": "Save failed: ",
			"webcfg.fail": "Apply failed: ",
			"props.desc": "The browser shows pre-rendered wallpaper assets, so editing these options cannot change the picture. Listed below are the wallpaper's own parameters and their current values for reference; change them in the Wallpaper Engine app instead",
			"props.unavailable": "unavailable",
			"props.on": "On",
			"props.off": "Off",
			"props.expand": "Show all",
			"props.important": "★ Key switch",
			"props.resetWallpaper": "Reset wallpaper options",
			"props.resetDone": "Wallpaper options restored to defaults",
			"props.tvOff": "Real-time variation is off — time settings hidden (enable it to show them)",
			"roundCompat": "Third-party UI radius compat",
			"update.title": "Check for updates",
			"update.check": "Check updates",
			"update.badge": "Update available",
			"update.checking": "Checking…",
			"update.apply": "Update now",
			"update.applying": "Updating…",
			"update.found": "New version found: ",
			"update.latest": "Already up to date",
			"update.diff": "Local code differs from GitHub (same version — probably un-pushed local changes); push to align",
			"update.applied": "Update done! Restart dsh web and Ctrl+F5",
			"update.fail": "Check failed: ",
			"update.market": "Update from plugin market",
			"update.gotoMarket": "Go update it in the plugin market (dshmarket) instead (recommended, matches the market version check)",
			"update.readonly": "Installed via the market (plugin dir is read-only), so in-place update is unavailable — update from the plugin market or via dsh plugin update",
			"update.chooseTitle": "Choose update method",
			"update.chooseBody": "Prefer updating from the plugin market (semver check matches the market). Still update directly via this plugin (pull GitHub code and write it back locally)? v",
			"update.confirmSelf": "Update via this plugin",
			"roundCompat.desc": "Adds border-radius to rectangular containers injected by other plugins (does not override their own styles); turn off if it conflicts",
			"powPauseHidden": "Power save · pause when hidden",
			"powPauseHidden.desc": "Pause the wallpaper video when the page is hidden/in a background tab (decoder to zero), resume on return",
			"powPauseBlur": "Power save · pause on blur",
			"powPauseBlur.desc": "Pause the wallpaper when the window loses focus, resume when refocused",
			"powPauseBattery": "Power save · pause on battery",
			"powPauseBattery.desc": "Do not play the wallpaper when on battery power; resume when plugged in",
			"error.title": "Import failed",
			"preview.title": "Preview mode",
			"preview.desc": "This wallpaper is currently shown as a preview image (GIF/picture); the browser cannot play its dynamic content (Live2D scene / HD video requires the Wallpaper Engine app).",
			"preview.ok": "Got it",
			"props.none": "Import a wallpaper first",
			"props.collapse": "Collapse",
			"url.label": "Image URL (GIF data: URLs work too)",
			"url.placeholder": "https://… or data:image/…",
			"url.apply": "Apply",
			"url.unsafe": "Only http/https or data:image URLs are allowed",
			"file.unsafe": "Unsupported file type (rejected)",
			"file.pick": "Choose local image/GIF",
			"file.hint": "Images/GIF supported (large files auto-saved locally, persist on refresh)",
			"file.tooLarge": "File exceeds 100MB — pick another or use a URL.",
			// ①(2026-09-17 persistence round) large-image IndexedDB **state is visible**
			"persist.idb": "This wallpaper is large — stored in IndexedDB (auto-restored after refresh/restart)",
			"brightness": "Brightness",
			"float": "Floating cards",
			"float.desc": "Sidebar/title bar become floating cards (rounded + shadow + see-through frosted wallpaper); off by default, existing transparency/blur features stay intact",
			"blur": "Frosted blur",
			"blur.overridden": "Unified blur + Chat-follows are both on: wallpaper blur is taken over by the Full-screen blur degree slider, so this frosted slider is disabled; turn off \"Chat follows full-screen blur\" to restore it (unified blur then only controls sidebar/title-bar fog)",
			"zoom": "Lens zoom (wallpaper camera)",
			"lens.pos": "Lens position (pan)",
			"lens.x": "X",
			"lens.y": "Y",
			"sidebar": "Show wallpaper in left sidebar",
			"sidebar.unifyHint": "Unified blur is on: left sidebar translucency follows the Surface opacity slider (turn this switch off for a fully opaque left sidebar)",
			"sidebar.desc": "Off keeps the left sidebar opaque so left/right translucency stays consistent",
			"headerBlur": "Frost the title bar",
			"headerBg": "Show wallpaper behind the title bar",
			"headerBg.unifyHint": "Unified blur is on: title bar translucency follows the Surface opacity slider (turn this switch off for a fully opaque title bar)",
			"headerBg.desc": "Off makes the title bar solid white (solid dark in dark theme), no wallpaper behind it",
			"headerBlur.desc": "Title bar shows the wallpaper; frosted amount via the slider below (default 0 = transparent, so the session-log button is not wrapped in a white rectangle; raise it for a readable fog). Needs \"Show wallpaper behind the title bar\" on",
			"headerBlurAmount": "Title bar frost amount",
			"headerFrostOwn": "Set title bar frost separately",
			"headerFrostOwn.desc": "Off by default: title bar frost follows the global blur amount (it cannot be switched off on its own while global blur is on, or the wallpaper shows through). Turn on to set the radius with the slider below",
			"headerFrostAmount": "Title bar frost strength",
			
			"unifyTint": "Unify blur",
			"unifyTint.desc": "On: the sidebar gets a chat-box-like frosted blur (one seamless layer, no seams); strength by the Full-screen blur degree; sidebar white-fog thickness by the Sidebar opacity slider; the title bar always follows its own frost slider (transparent by default). Off = per-area control",
			"unifyAmount": "Full-screen blur degree",
			"sidebarAlpha": "Left sidebar / title-bar opacity",
			"sidebarAlpha.desc": "When unified blur is on: white-fog thickness on the sidebar and title bar (0 = fully transparent showing blurred wallpaper, 100 = solid). Decoupled from the blur degree, adjustable independently",
			"chatFollow": "Chat follows full-screen blur",
			"chatFollow.desc": "When unified blur is on: On = the chat area wallpaper blur also follows the Full-screen blur degree (frosted slider taken over & disabled); Off = the frosted slider becomes adjustable again, the chat area wallpaper follows it (unified blur only frosts the sidebar/title bar)",
			"sessionFollow": "New-chat button follows panel opacity",
			"sessionFollow.desc": "When unified blur is on: whether the New chat button follows the Opacity slider. Off = keeps its original button color",
			"dialogBlur": "Blur dialogs",
			"dialogBlur.desc": "Generic center-screen windows (not the settings panel / not this plugin's popups) and the chat input box get a blurred backdrop; text scrolling under the input box turns hazy. The settings panel and download/confirm popups have their own switches",
			"dialogBlurAmount": "Dialog blur amount",
			"settingsBlur": "Blur settings panel",
			"settingsBlur.desc": "Backdrop blur of the DSH settings panel (the panel hosting this plugin's settings), with its own strength independent of generic dialogs",
			"settingsBlurAmount": "Settings panel blur amount",
			"confirmBlur": "Blur download/confirm popups",
			"confirmBlur.desc": "Backdrop blur of this plugin's download-confirm, conflict-detection and error popups; off = opaque popups",
			"confirmBlurAmount": "Download/confirm popup blur amount",
			"popoverBlur": "Blur popovers/mask",
			"popoverBlur.desc": "Panels popping out from somewhere: context menus, dropdowns, tooltip bubbles",
			"popoverBlurAmount": "Popover blur amount",
			"popoverAlpha": "Popover opacity",
			"popoverAlpha.desc": "How solid popover surfaces are. With blur working, ~80 still looks like glass; on engines without backdrop blur (Via/WebView) keep it above 94 so text behind stays unreadable",
			"maskBlur": "Blur mask (full-screen backdrop)",
			"maskBlur.desc": "Haziness of the translucent backdrop layer behind a window when settings/popovers open",
			"maskBlurAmount": "Mask blur amount",
			"sidebarBlur": "Left sidebar frost",
			"rightSidebarBlur": "Right sidebar / dock blur",
			"rightSidebarBlurAmount": "Blur amount",
			"rightSidebarAlpha": "Surface opacity",
			"rightSidebarBlur.desc": "Adapts DSH 0.1.5 built-in right sidebar and bottom dock overlays to the same frost rules.",
			"sidebarBlur.desc": "The sidebar itself becomes glass (backdrop-filter blurs the wallpaper behind it, Aqua-style); automatically lifted while a dialog is open so the blur layer cannot trap fixed popups",
			"sidebarBlurAmount": "Left sidebar frost amount",
			"sidebarBlur.overridden": "Unified blur is on: left sidebar frost is taken over by the Full-screen blur degree + Surface opacity; turn unified blur off to adjust this switch",
			"sidebarBlur.needReveal": "Turn on the sidebar wallpaper reveal first to use sidebar frost (controlled by the sidebar reveal)",
			"headerBlur.overridden": "Unified blur is on: title-bar frost is taken over by Full-screen blur degree + transparency; turn unified blur off to adjust this switch",
			"thinkBg": "Deep diving background box",
			"thinkBg.desc": "On: show a blurred background box behind the Deep diving thinking status; Off (default): transparent, text sits directly on the wallpaper",
			"blur.unsupported": "⚠️ This browser (Via/WebView) does not truly render backdrop blur; blur appears as translucency only. Use Chrome/Firefox for the full frosted effect",
			"sharp": "Light sharpen",
			"clock.title": "Show time (clock)",
			"clock.desc": "Overlay a live clock on the background, replacing the built-in time component",
			"clock.24h": "24-hour format",
			"clock.sec": "Show seconds",
			"clock.date": "Show date",
			"clock.pos": "Position",
			"clock.tl": "Top-left",
			"clock.tr": "Top-right",
			"clock.bl": "Bottom-left",
			"clock.br": "Bottom-right",
			"sharp.desc": "Improves low-res GIF look; disable if animation stutters",
			"time.picked": "Asset picked by current time",
			"time.now": "Current period",
			"time.slot": "Time slot",
			"time.auto": "Auto",
			"time.locked": "Slot locked manually; auto-switching paused (press Auto to resume)",
			// ①(MERGED-3 1.2) scnRender 组（此前 en 缺失，顺带补全）+ sceneExtUrl 新键
			"scnRender.title": "Pure scene wallpaper renderer",
			"scnRender.desc": "Choose the render path for pure scene wallpapers (does not affect video/image/web wallpapers).",
			"scnRender.mode": "Renderer:",
			"scnRender.webgl": "WebGL realtime (current)",
			"scnRender.static": "Static frame (original composite)",
			"scnRender.elysia": "Elysia compatible (reserved)",
			"scnRender.hint": "WebGL realtime = latest we-scene engine (full effects/animation/anchors); static frame = 2D canvas layer composite (lightweight); Elysia = reference implementation path (porting). Changes apply immediately and persist.",
			"scnRender.extUrl": "Renderer extension hooks URL (sceneExtUrl, optional)",
			"scnRender.report": "Scene render reporting (debug)",
			"scnRender.report.desc": "When on, the wallpaper sends the renderer's live state (screenshot + per-layer draw ledger + texture stats) to the renderer's reports/ folder every 10s, to diagnose position/visibility bugs. Debug only; off by default (writes to disk)",
			"scnRender.extUrl.ph": "http://127.0.0.1:8899/ext",
			"scnRender.extUrl.hint": "Empty = disabled. When set, it is passed to the scene iframe as extbase (see we-scene-demo/EXTENSION-HOOKS.md); press Test to verify the index and show the hook count.",
			"scnRender.extUrl.save": "Save",
			"scnRender.extUrl.saved": "Extension hooks URL saved; takes effect the next time a scene wallpaper is applied",
			"scnRender.extUrl.cleared": "Extension hooks URL cleared",
			"scnRender.extUrl.test": "Test",
			"scnRender.extUrl.empty": "Enter the extension hooks URL first",
			"scnRender.extUrl.fail": "Save failed: ",
			// ①(批次15 B1/B2/B3/B5) scene renderer: watchdog / retry / debug params / big-texture hints
			"scnRender.watchdog": "First-frame watchdog (auto fallback)",
			"scnRender.watchdog.desc": "If the renderer produces no frame within N seconds after applying a scene (no first-frame thumbnail posted), fall back to the static frame and explain in the hint bar; the iframe is kept and can be retried. Switches back automatically once the renderer delivers. Global escape: set localStorage mpwwatch=0",
			"scnRender.watchdog.secs": "Watchdog timeout:",
			"scnRender.watchdog.secs.desc": "Increase on slow devices (3-30s, default 8s). The signal is the renderer's first-frame thumbnail beacon, independent of renderer reachability.",
			"scnRender.retry": "Retry renderer",
			"scnRender.retry.btn": "Remount renderer",
			"scnRender.retry.desc": "When the current wallpaper is a scene: force-reload the renderer iframe and restart the first-frame watchdog (also works while fallen back; auto-rebuild is once per scene, manual is unlimited).",
			"scnRender.retry.noScene": "The current wallpaper is not a scene-renderer wallpaper",
			"scnRender.retry.ok": "Renderer remounted, waiting for the first frame…",
			"scnRender.debug": "Renderer debug params (whitelisted)",
			"scnRender.debug.ph": "e.g. ln=12 or isolate=hair,nofx",
			"scnRender.debug.save": "Save",
			"scnRender.debug.clear": "Clear",
			"scnRender.debug.saved": "Debug params saved (sanitized)",
			"scnRender.debug.cleared": "Debug params cleared; default rendering restored",
			"scnRender.debug.hint": "Whitelist only: ln|eyehack|novideo|audit|ownsize|att|hier|nofx|np|whitefallback|skiny|trace|isolate|parallax|qflip. Each pair is validated before being appended to the wallpaper URL; invalid entries are dropped (dangerous flags like skin0 can never get in). Applies to the current scene immediately; clearing restores.",
			"scnRender.wd.fallback": "Scene renderer did not produce a frame in time; fallen back to the static frame. The renderer is kept — press “Remount renderer” in Settings → Scene rendering to retry.",
			"scnRender.wd.recovered": "Scene renderer delivered its first frame; live rendering restored",
			"scnRender.back": "Renderer is back online; remounting the scene…",
			"scnRender.bigTex": "This scene uses a large amount of textures; low-end devices may downsample automatically",
			"scnRender.bigPkg": "This scene package is large; the first frame may be slow",
			// ①(MERGED-3 1.3/2.3) Diagnostic flags quick reference (set == diag-flags.json common)
			"diag.sec": "Diagnostic flags (renderer)",
			"diag.sec.desc": "Append to the renderer URL, e.g. http://127.0.0.1:8899/?id=3719111841&audit=3. Common flags below; press Copy to grab the URL fragment.",
			"diag.expand": "Show flags",
			"diag.fold": "Hide flags",
			"diag.copy": "Copy",
			"diag.copied": "Copied",
			"diag.more": "Full list: we-scene-demo/README-DIAGNOSTICS.md (node diag-flag-check.mjs verifies code/doc consistency).",
			"diag.fields": "New report fields: ctxLost=WebGL context-loss counter, maxTextureSize=device texture limit (for oversized-black-layer evidence), layerHealth=per-layer health (reported via mpw-health, planned). Per-layer debug flags ln/eyehack/novideo/ownsize can be passed into the wallpaper via “Renderer debug params” above.",
			"diagflag.att": "Legacy attachment anchors",
			"diagflag.att.d": "?att=legacy: old self-computed anchor offsets (vs the ported elysia implementation; large error, A/B only).",
			"diagflag.mcc": "Mesh center compensation",
			"diagflag.mcc.d": "?mcc=1: force mesh-bbox center compensation (legacy behavior; the official has none).",
			"diagflag.piv": "Submesh pivot",
			"diagflag.piv.d": "?piv=1 all on / ?piv=0 all off; default applies to the eye group only.",
			"diagflag.align": "Legacy alignment",
			"diagflag.align.d": "?align=0: legacy alignment (origin always geometric center) for A/B.",
			"diagflag.parallax": "Legacy parallax",
			"diagflag.parallax.d": "?parallax=legacy: old lwe-approx mouse parallax; the official formula is default.",
			"diagflag.audio": "Enable audio",
			"diagflag.audio.d": "?audio=1: play scene sound layers (one stream per layer; may need a user gesture).",
			"diagflag.whitefallback": "Missing-texture fallback",
			"diagflag.whitefallback.d": "?whitefallback=0: missing textures turn transparent instead of the official white block.",
			"diagflag.hier": "Parent-chain fallback",
			"diagflag.hier.d": "?hier=0: drop parent-chain composition, fall back to refrender absolute positioning.",
			"diagflag.isolate": "Isolate layers",
			"diagflag.isolate.d": "?isolate=<name>: keep only layers whose name contains the keyword(s) visible.",
			"diagflag.audit": "First-frame audit",
			"diagflag.audit.d": "?audit=N: audit the first N frames layer by layer to locate a stuck render.",
			"time.morning": "Morning",
			"time.day": "Day",
			"time.dusk": "Dusk",
			"time.night": "Night",
			"reset": "Restore all defaults",
			"feedback": "Report issue",
			"default": "Default",
			// ①(P-66 真 bug 修复) 补齐 zh 有、en 缺的 18 个键（缺键 → 英文界面直接显示 key 原文）
			"glass.title": "Liquid glass (elysia395 approach)",
			"glass.desc": "Glassmorphism for the settings card/dialog: glass tint + white overlay strength + master switch (independent of the other Aqua features; off by default)",
			"glassWindow": "Liquid glass on the settings window",
			"glassWindow.desc": "Turn the whole settings card/dialog into glass (translucent + blur + background tint)",
			"glass.accent": "Accent color",
			"glass.accent.hint": "Drives brand interactive elements (buttons/sliders/selection/links/send button); the theme color owns the overall background tint",
			"glass.color": "Glass color",
			"glass.color.hint": "Glass background tint (default: white in light / deep night blue in dark; both themes use the picked color)",
			"glass.alpha": "Glass opacity",
			"glass.reset": "Default",
			"flipX": "Flip horizontally (mirror)",
			"flipX.desc": "Mirror the wallpaper left/right (scaleX -1)",
			"flipY": "Flip vertically (mirror)",
			"flipY.desc": "Mirror the wallpaper top/bottom (scaleY -1)",
			"themeColor": "Theme color",
			"themeColor.hint": "Tints the left sidebar / title bar / new-session button / settings dialog background (picker + presets); brand interactive elements (buttons/selection/links) are controlled by the Aqua “Accent color”; empty = disabled",
			"themeColorReset": "Default",
			"rightSidebarBlur.overridden": "Unified blur is on: right sidebar/dock blur is handled by “Global blur amount” + “Opacity”; turn unified blur off to make this switch adjustable again",
			// ①(P-66 真 bug 修复) 原来硬编码在 JSX 里的中文（英文界面会漏中文）
			"hybrid.status": "Status",
			"scnRender.reapplied": " (remounted)",
		};

		// ═══════════════════════════════════════════════════════════════════
		//  插件主体
		// ═══════════════════════════════════════════════════════════════════
		const inject = ["slots", "locale", "theme"];

		/** ①(2026-09-13 新增诊断) 浮层层叠上报：标题栏里的菜单/面板一出现，就把它的祖先链
		 *  （position / z-index / opacity / transform / filter / backdrop-filter / contain / isolation）
		 *  发到 /diag。用途：像"后台任务展开被文字压住"这类问题，只有拿到真实层叠链才能一次修对。 */
		function setupLayerDiag() {
			if (window.__mpwLayerDiag) return;
			window.__mpwLayerDiag = 1;
			const seen = new Set();
			const snap = (el) => {
				try {
					const cs = getComputedStyle(el);
					const r = el.getBoundingClientRect();
					return { tag: el.tagName, cls: String(el.className || '').slice(0, 90),
						rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
						pos: cs.position, z: cs.zIndex, opacity: cs.opacity,
						transform: cs.transform === 'none' ? 'none' : 'set', filter: cs.filter === 'none' ? 'none' : 'set',
						bdf: cs.backdropFilter === 'none' ? 'none' : 'set', contain: cs.contain, isolation: cs.isolation };
				} catch { return null }
			};
			const report = (el, why) => {
				try {
					const key = String(el.className || '') + '|' + why;
					if (seen.has(key) || seen.size > 12) return;
					seen.add(key);
					const chain = [];
					let cur = el, i = 0;
					while (cur && cur !== document.documentElement && i < 8) {
						const s2 = snap(cur)
						if (s2) {
							try { s2.overflow = getComputedStyle(cur).overflow + '/' + getComputedStyle(cur).overflowX + '/' + getComputedStyle(cur).overflowY } catch {}
							try { s2.clipPath = getComputedStyle(cur).clipPath } catch {}
							chain.push(s2)
						}
						cur = cur.parentElement; i++
					}
					// 关键：浮层中心点"最上层"是谁？若是标题文字 → 层叠问题；若是浮层本身 → 不是层压而是裁剪/透明
					let topAtCenter = null
					try {
						const r = el.getBoundingClientRect()
						const t = document.elementFromPoint(Math.round(r.x + r.width / 2), Math.round(r.y + Math.min(24, r.height / 2)))
						if (t) topAtCenter = { tag: t.tagName, cls: String(t.className || '').slice(0, 80), isSelf: t === el || el.contains(t) }
					} catch {}
					fetch(HOST_BASE + '/diag', { method: 'POST', body: JSON.stringify({
						kind: 'layer-diag', why: why, at: new Date().toISOString(), url: location.href,
						// ①(B6) 沙箱/token 现状（模式、iframe sandbox 属性、token 缓存、渲染器 mpw-cap 上报）
						sandbox: mpwSandboxDiag(),
						headerZ: (() => { try { const h = document.querySelector('.wSkVaW_header, [class*="wSkVaW_header"]'); return h ? { z: getComputedStyle(h).zIndex, pos: getComputedStyle(h).position, bdf: getComputedStyle(h).backdropFilter === 'none' ? 'none' : 'set', ovf: getComputedStyle(h).overflow } : null } catch { return null } })(),
						// ①(2026-09-13) 标题栏磨砂层实证：真实注入元素是否存在、computed backdrop-filter 是否真的生效、
						//   注入值/尺寸/层级，以及伪元素方案（对照模式）的 computed 值 → 一次上报即可判定"没生效"卡在哪一环。
						// ①(2026-09-16) 补齐"看不见的链路"：hostHasHeader / headerTranslucent /
						//   computed{headerBg,headerBackdrop,frostElBackdrop} / state（JS 侧快照，含 reason）。
						//   字段表见 docs/HEADER-FROST.md「诊断字段」一节。
						// ①(2026-09-16 根治) 与手动/自动界面诊断共用同一份快照（mpwHeaderFrostDiag），
						//   保证两条上报路径字段一致；字段表见 docs/HEADER-FROST.md。
						headerFrost: mpwHeaderFrostDiag(),
						topAtCenter: topAtCenter, chain: chain }) }).catch(() => {});
				} catch {}
			};
			try {
				const obs = new MutationObserver(() => {
					try {
						document.querySelectorAll('header [class*="_menu"], header [class*="_popover"], header [class*="_panel"], header [role="menu"]').forEach((el) => {
							if (el.getBoundingClientRect().height > 40) report(el, 'menu-open');
						});
					} catch {}
				});
				obs.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
			} catch {}
		}

		/** 当前 ctx（apply 时保存，供 applyFromStorage 里 overrideTokens 用）。 */
		let pluginCtx = null;
		/** 上一次 token override 的 disposer。 */
		let tokenDisposer = null;

		let styleEl = null;
		function getStyleEl() {
			// ①(修正) 同源 web 壁纸 iframe 的 JS 可能操作父页面 document.head（星野类壁纸
			// 假设独占页面），把我们的 <style> 清掉 → 插件 UI 全部失去样式（开关文字堆叠、
			// 导航图标错位显示默认图标——用户实测：导入 web 地址后出现，Chrome/Firefox 都有）。
			// 每次取用时检查 isConnected，脱离 DOM 就重建重挂，样式自愈。
			if (!styleEl || !styleEl.isConnected) {
				styleEl = document.createElement("style");
				styleEl.setAttribute("data-plugin", "dsh-mpkg-wallpaper");
				(document.head || document.documentElement).appendChild(styleEl);
			}
			return styleEl;
		}

		function apply(ctx) {
			// ①(2026-09-12 根治) apply 幂等：宿主对 dsh-mpkg-wallpaper / @local/dsh-mpkg-wallpaper
			//   两个 id 可能各 apply 一次 → 双份 CSS/观察器/定时器（用户实测一次加载出现 3 个面板窗口）。
			mpwTrace('apply:start', { hasReact: !!react, hasReactDOM: !!ReactDOM, hasClient: !!ReactDOMClient });
			if (globalThis.__mpwAppliedOnce) { try { console.warn("[dsh-mpkg-wallpaper] apply 重复调用已忽略"); } catch {} ; mpwTrace('apply:skip', { reason: 'already applied' }); return }
			globalThis.__mpwAppliedOnce = 1;
			try {
				pluginCtx = ctx;
				applyInner(ctx);
			} catch (err) {
				// 防护：任何运行时错误只影响本插件，绝不拖垮 harness 启动
				console.error("[dsh-mpkg-wallpaper] apply failed:", err);
			}
		}

		// ①(新) 侧边栏磨砂摘除：监听居中弹窗出现/消失，body 打 data-mpw-sblur-off。
		// backdrop-filter 会把 sidebarCol 变成 fixed 弹窗的 containing block（困住弹窗），
		// 弹窗打开时摘除侧边栏模糊、关闭即恢复。不用 :has()（Firefox 层叠 bug，见 E 块注释）。
		// ②(修正) 只摘除 **sidebarCol 内** 的弹窗：backdrop-filter 只困住 sidebarCol 的后代弹窗。
		// 用户实测：打开「上下文占用」小弹窗（不在 sidebarCol 内）也被摘除，导致统一虚化的
		// 侧边栏/标题栏模糊失效（session log 框随之消失）——已修正为只匹配 sidebarCol 内的
		// role=dialog（如设置面板，它在侧边栏 footArea 里）。
		let sblurObserver = null;
		function setupSblurObserver() {
			if (sblurObserver !== null) return;
			const check = () => {
				try {
					// ②(2026-09-11 修复#4) 只把"近全屏弹窗"当真弹窗摘除模糊；
					// 下拉菜单/三点菜单（小面板）不再触发摘除（用户实测：展开后侧栏虚化消失）。
					const isFullDlg = (el) => {
						try {
							const r = el.getBoundingClientRect();
							const vw = window.innerWidth || 1, vh = window.innerHeight || 1;
							return r.width >= vw * 0.6 && r.height >= vh * 0.5;
						} catch { return false }
					};
					// ②(2026-09-11 根因修复) 新版设置弹窗=VOzbGW_overlay(position:fixed,z=1000)+VOzbGW_panel，
					// 尺寸小且无 role="dialog" → 旧的"近全屏"判定永不触发 → sidebarCol 的 backdrop-filter
					// 把它变成 fixed 弹窗的 containing block → 设置面板被压缩进左栏（诊断数据实锤）。
					// 现在：只要存在"fixed 定位的 overlay/modal 层"即摘除磨砂（backdrop-filter 是罪魁时优先保弹窗）。
					// ②(2026-09-11) 判定必须"看得见"才算弹窗：DOM 里常有常驻/隐藏 overlay 容器，
					// 仅凭类名/position 存在会把开关恒置为真（→ 虚化永远消失，即"两个 bug 来回"的根源）。
					// 用 fixed + display/visibility + 高度≥70%vh（宽度可能因包含块被压缩，不可作判据）。
					const isOpenOverlay = (el) => {
						try {
							const cs = getComputedStyle(el);
							if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
							const r = el.getBoundingClientRect();
							const vh1 = window.innerHeight || 1;
							return r.height >= vh1 * 0.7 && r.width > 0;
						} catch { return false }
					};
					const hasDlg = Array.from(document.querySelectorAll('[class*="_overlay"], [class*="_modal"], [role="dialog"], [role="alertdialog"]')).some(isOpenOverlay)
						|| Array.from(document.querySelectorAll('[class*="sidebarCol"] [role="dialog"], [class*="sidebarCol"] [role="alertdialog"]')).some(isFullDlg);
					if (hasDlg) {
						document.body.setAttribute("data-mpw-sblur-off", "");
						// ②(修正) 设置面板打开时悬浮外壳一并让位：悬浮给 sidebarCol 加
						// margin/圆角/overflow，设置面板（full-viewport fixed overlay）渲染在
						// sidebarCol 内，悬浮外壳会让 overlay 布局错乱 → 输入框/todo 浮到
						// 设置面上（用户实测：侧边栏收起 + 设置页开关悬浮后出现）。打
						// data-mpw-float-off，悬浮 CSS 让位（见 buildUiCss float-off 规则）。
						document.body.setAttribute("data-mpw-float-off", "");
					} else {
						document.body.removeAttribute("data-mpw-sblur-off");
						document.body.removeAttribute("data-mpw-float-off");
					}
				} catch {}
			};
			try {
				sblurObserver = new MutationObserver(check);
				sblurObserver.observe(document.body, { childList: true, subtree: true });
			} catch { sblurObserver = null; }
			check();
		}

		// ①(新) 标题栏 backdrop blur 摘除：G 块给 header 加 blur(unifyAmount)（聊天区
		// 不跟随时的标题栏虚化），但 header 内有 absolute 展开面板（子代理/后台任务，
		// JObwrW_panel），backdrop-filter 会变成它们的 containing block → 面板定位错乱
		// ①(2026-09-13 用户第1项后) 磨砂已移到 header 的 ::before 层（伪元素不是面板的祖先，不会
		//   困住 fixed 面板）→ **不再需要**"展开面板时摘除模糊"这套逻辑；观察器保留但只做空转检查。
		//（历史背景：磨砂曾在 header 本体上，展开面板时打 data-mpw-header-blur-off
		// 摘除 header 的 backdrop-filter，面板关闭即恢复。只作用于 header 内面板，
		// 不动侧边栏（sidebarCol 无此问题）。
		let headerBlurWatch = null;
		function setupHeaderBlurWatch() {
			if (headerBlurWatch !== null) return;
			const check = () => {
				try {
					// ②(修复#4) 只对"占满标题栏高度以上的大面板"摘除标题栏模糊；
					// 普通下拉/菜单（小面板）保持标题栏虚化（用户实测痛点）。
					const isBigPanel = (el) => {
						try {
							const r = el.getBoundingClientRect();
							const vh = window.innerHeight || 1;
							return r.height >= vh * 0.45 || r.width >= (window.innerWidth || 1) * 0.5;
						} catch { return false }
					};
					const hasPanel = Array.from(document.querySelectorAll(
						'[class*="wSkVaW_header"] [class*="panel"], [class*="wSkVaW_header"] [class*="menu"], [class*="wSkVaW_header"] [role="menu"], header [class*="panel"], header [class*="menu"]'
					)).some(isBigPanel);
					// ①(2026-09-13) 不再摘除标题栏模糊（见上）；这里只确保历史遗留属性被清掉
					if (document.body.hasAttribute("data-mpw-header-blur-off")) document.body.removeAttribute("data-mpw-header-blur-off");
				} catch {}
			};
			try {
				headerBlurWatch = new MutationObserver(check);
				headerBlurWatch.observe(document.body, { childList: true, subtree: true });
			} catch { headerBlurWatch = null; }
			check();
		}

		// ⑲(修正) Aqua 主题切换监听：深色/浅色切换时重算遮罩色与自适应文字色
		//（用户实测：aquaInk 开时切换主题，文字色卡在旧主题——黑字黑底/白字白底看不清）。
		let aquaThemeWatch = null;
		// ①(修正) 防重入环：onTheme → applyTokenOverrides → ctx.theme.overrideTokens →
		// DSH theme/change → 可能重变 data-ds-dark-theme → 又进 onTheme（深色 + 统一雾时
		// 尤其明显；这是"属性监听"路径, 绕过了 applyFromStorage 的 __mpwApplying 屏障）。
		// 用独立 __mpwAquaApplying 标志（同步重入直接跳过）+ 40ms 尾沿去抖
		//（合并连续主题翻转, 只在停稳后算一次）, 杜绝死循环。
		let aquaDebounce = null;
		const applyAquaTheme = () => {
			if (window.__mpwAquaApplying) return;
			window.__mpwAquaApplying = true;
			try {
				refreshAqua();
				try { refreshRailInk(); } catch {}   // ①(2026-09-16 bug①) 主题翻转后 rail 对比色要跟着变
				const s = readSection();
				if (aquaOn(s)) applyTokenOverrides(pluginCtx, s);
			} catch {}
			finally { window.__mpwAquaApplying = false; }
		};
		function setupAquaThemeWatch() {
			if (aquaThemeWatch !== null) return;
			const onTheme = () => {
				// 尾沿去抖：连变只跑一次（sync 重入已被 __mpwAquaApplying 挡住）。
				if (aquaDebounce) { clearTimeout(aquaDebounce); }
				aquaDebounce = setTimeout(() => { aquaDebounce = null; applyAquaTheme(); }, 40);
			};
			try {
				aquaThemeWatch = new MutationObserver(onTheme);
				aquaThemeWatch.observe(document.body, { attributes: true, attributeFilter: ["data-ds-dark-theme"] });
			} catch { aquaThemeWatch = null; }
		}

		function applyInner(ctx) {
			// 背景 DOM 常驻
			ensureBgDom();
			// ⑭ 内联虚化 watcher：持续应用 dialog/fade 内联样式
			applyDialogInline(readSection());
			if (window.__mpwInlineWatcher === void 0) {
				window.__mpwInlineWatcher = startInlineWatcher();
			}
			// ⑪(新) 与其他壁纸/主题插件冲突 → 自动关闭本功能（用户要求）。
			// 检测范围：已装插件 ID（data-plugin）+ 运行时背景检测（body/html 背景图、
			// 其他全屏背景层）。forceEnabled=true（用户手动强开）时豁免，避免反复关闭。
			try {
				const cf = detectConflicts();
				if (cf.length) {
					const s = readSection();
					if (s.enabled !== false && !s.forceEnabled) {
						console.warn("[dsh-mpkg-wallpaper] 检测到可能冲突的壁纸/主题插件，已自动关闭本功能:", cf.join(", "));
						writeSection(Object.assign({}, s, { enabled: false }), true);
					}
				}
			} catch (e) { mpwErr("detectConflicts(冲突检测/自动关闭)", e); }
			// ①(修正) boot 兜底：任何状态都不能让插件加载失败（否则设置页永久崩）。
			// ①(修正2) 移除「刷新后清 webUrl 不自动重载」逻辑——它每次 apply() 清 webUrl，
			// 导致 web 壁纸 webUrl 不持久：导入星野后一旦 apply 重入/刷新/RTC 重连就把
			// webUrl 抹掉，留下 converted:"web" 半残状态 → applyFromStorage 走 img 路径 →
			// iframe 空白（用户实测多次）。web 壁纸刷新后即使重载也只是 iframe 重载，
			// 不该丢 webUrl。故让 webUrl 持久（刷新后正常恢复，卡了手动刷新即可）。
			// 若确需"刷新后不自动重载"，可改成只标记、不清 persisted webUrl。（此处保持持久）
			try { applyFromStorage(); } catch (err) { console.warn("[dsh-mpkg-wallpaper] boot 应用背景失败:", err); }
			// ①(修正) 样式自愈：同源 web 壁纸 iframe 的 JS 可能清掉父页面 <head> 里的
			// 本插件 <style>（星野类壁纸假设独占页面）→ 插件 UI 全部失样式（开关文字堆叠、
			// 导航图标错位）。监听 head 子节点移除：检测到我们的 style 消失立即重建并重写。
			try {
				if (!window.__mpwStyleWatch) {
					window.__mpwStyleWatch = new MutationObserver((muts) => {
						try {
							// 只看 removedNodes 是否含我们的 style（或整个 head 被清空重建）
							let oursGone = false;
							for (const m of muts) {
								const rn = m.removedNodes || [];
								for (let i = 0; i < rn.length; i++) {
									const n = rn[i];
									if (!n || n.nodeType !== 1) continue;
									if (n.getAttribute && n.getAttribute("data-plugin") === "dsh-mpkg-wallpaper") { oursGone = true; break; }
									if (n.querySelector && n.querySelector('[data-plugin="dsh-mpkg-wallpaper"]')) { oursGone = true; break; }
								}
								if (oursGone) break;
							}
							if (!oursGone) return; // 其他 style 增删不重写（避免无谓全量重建）
							const el = getStyleEl(); // isConnected 检查：脱离则重建重挂
							if (el) {
								const s = readSection();
								el.textContent = buildCss(s.enabled === false ? Object.assign({}, s, { image: "" }) : s);
							}
						} catch (e) { mpwErr("样式自愈重建(style 被 iframe 清掉)", e); }
					});
					const head = document.head || document.documentElement;
					if (head) window.__mpwStyleWatch.observe(head, { childList: true, subtree: true });
				}
			} catch {}
			// ⑤(新) 宿主端设置持久化：异步拉取 host /settings（优先于 localStorage），
			// 拉到后重应用（配置跨端口/清浏览器数据不丢；host 不可用时回退 localStorage）。
			try { initHostSettings(); } catch {}
			// ①(修正 2026-09-17) better-sidebar 版本门控的**页面加载期**探测（不依赖用户打开
			//   插件设置页）；探测结果写 body[data-mpw-bs-version]，CSS 里的版本门控规则随即生效。
			try { refreshBetterSidebarVersion(); } catch {}
			// ①(修正) applyInner 每次 apply()（含 RTC 重连/重注入）都会重跑——若不判重，
			// 这里的 storage 监听 + 60s interval 每跑一次就多挂一份 → 越积越多（CPU+内存）。
			// 与 __mpwInlineWatcher/__mpwStyleWatch 一样，用 window 级标记只注册一次。
			if (!window.__mpwGlobalWired) {
				window.__mpwGlobalWired = true;
				window.addEventListener("storage", (e) => {
					if (e.key === STORE_KEY) {
						try {
							// ①(修复) storage=他处已改：先强制重读缓存再应用（否则用陈旧 sectionCache 白跑）
							try { sectionCache = null; } catch {}
							try { loadSection(); } catch {}
							applyFromStorage();
						} catch {}
					}
				});
				// 时间变化：每分钟检查时段，跨时段自动切换视频（⑧(新) 懒加载：槽位 blob 未缓存时
				// 按 timeSrc 按需提取，单槽峰值 ~50MB；④(新) timeOverride 手动锁定时暂停自动切换）
				try {
					setInterval(() => {
						try {
							const s = readSection();
							if (!s.timeVideos || !s.timeConfig || !s.timeConfig.enabled) return;
							// ④(新) 手动锁定时段：不再随时间自动切换，直到点「自动」
							if (s.timeOverride) return;
							const slot = slotForTime(s.timeConfig, new Date());
							if (slot === s.activeSlot) return;
							swapTimeSlot(slot);
						} catch (e) { mpwErr("时段自动切换(60s 定时)", e); }
					}, 60000);
				} catch (e) { mpwErr("时段自动切换(定时器安装)", e); }
				try { setupLayerDiag(); } catch (e) { mpwErr("setupLayerDiag", e); }
			// ①(新) 省电（遮挡暂停三档）：页面隐藏/失焦/电池供电时暂停壁纸，回来自动继续
				try { setupPowerSave(); } catch (e) { mpwErr("setupPowerSave", e); }
			}
			const sectionInjected = () => ({
				commit: () => { applyFromStorage(); }
			});
			// ⑤ 注册为设置左侧导航的独立页面
			// ①(2026-09-12 用户要求) **不再自挂载、不再有浮窗**：
			//   宿主现在会正常渲染我们的组件（trace 已证 section:enter + section:built；此前的空白
			//   是组件内 `h` 未声明导致的抛错，已修）。任何"自挂载/兜底浮层"都会干扰使用，故整段移除，
			//   只保留 trace + 外壳 try/catch（出错时面板内显示错误而不是空白）。
			ctx.slots.inject("settings.section", () => { mpwTrace('inject:cb', { id: ROW_ID }); const __r = ctx.slots.register({
				name: "settings.section",
				id: ROW_ID,
				// ①(修正) order:39 固定在「插件市场」(order:40) 前面 —— 两者原都是 40，
				// 同 order 时位置不稳定会互换（用户实测）。39 保证壁纸设置恒在插件市场前。
				order: 39,
				label: () => react.createElement(react.Fragment, null,
					// ①(2026-09-13) 用户指定的图片图标（内联 SVG，跟随主题）；?navicon=old 回退旧 base64 图
					(() => { try { return new URLSearchParams(location.search).get("navicon") === "old" ? react.createElement("img", { src: NAV_ICON, alt: "", className: "mpw_navIconImg" }) : NAV_ICON_SVG(16) } catch { return NAV_ICON_SVG(16) } })(),
					" " + ctx.locale.bind(NS)("nav")),
				locale: NS,
				inject: sectionInjected
			}, MpkgSection); mpwTrace('register:ok', { id: ROW_ID, result: __r ? Object.keys(__r).slice(0, 6) : null }); return __r });
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "ui-mpkg-wallpaper: settings section dictionaries");
		}

		exports.inject = inject;
		exports.apply = apply;
		globalThis.__mpwClientLoaded = module.exports;
		return module.exports;
};
// 双 id 注册同一 factory（幂等）：新版 dsh 期望包名，旧版期望 @local/ 前缀名
// ①(2026-09-12 根因修复) 双 ID 注册必须**幂等**：
	//   本文件可能被宿主加载两次（两个 plugin id 各一次），第二次求值会因顶层 `const __mpwFactory`
	//   重复声明抛 SyntaxError → 该次注册链断裂（实测：面板组件被渲染过但从未挂载、DOM 里没有面板元素）。
	//   修法：factory 改用 var（允许重复声明）+ 注册循环加全局去重。
	try {
		if (!globalThis.__mpwRegistered) {
			globalThis.__mpwRegistered = 1;
			for (const __mpwId of ["dsh-mpkg-wallpaper", "@local/dsh-mpkg-wallpaper"]) {
				try { window.__ModuleLoader__.load({ id: __mpwId, factory: __mpwFactory }); } catch (e) {}
			}
		}
	} catch (e) {}
