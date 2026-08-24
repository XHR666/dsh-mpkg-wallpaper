window.__ModuleLoader__.load({
	id: "dsh-mpkg-wallpaper",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		let react = require("react");
		// ①(修正) react-dom portal：弹窗遮罩提到 document.body。
		// 设置面板/backdrop-filter 容器会创建包含块/backdrop root，把 fixed 遮罩
		// 困在面板内 → 遮罩只盖住右侧设置区（用户实测）；portal 后盖全屏且模糊全屏。
		let ReactDOM = null;
		try { ReactDOM = require("react-dom"); } catch {}



		// ═══════════════════════════════════════════════════════════════════
		//  常量
		// ═══════════════════════════════════════════════════════════════════
		const ROW_ID = "mpkg-wallpaper";
		const NS = "ui-mpkg-wallpaper";
		const STORE_KEY = "dsh.mpkg-wallpaper.v2";
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
		const DEFAULT_SIDEBAR_BLUR_AMOUNT = 14; // 侧边栏磨砂程度
		const DEFAULT_POPOVER_BLUR = true;   // 弹层虚化（菜单/提示/遮罩）开关
		const DEFAULT_POPOVER_AMOUNT = 10;   // 弹层虚化程度
		const DEFAULT_MASK_BLUR = true;   // 遮罩虚化（设置/弹层打开时全屏背景遮罩）
		const DEFAULT_MASK_AMOUNT = 8;    // 遮罩虚化程度
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
		const NAV_ICON = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCIgdmlld0JveD0iMCAwIDIwIDIwIj4KPGRlZnM+CjxsaW5lYXJHcmFkaWVudCBpZD0ic2t5IiB4MT0iMCIgeTE9IjAiIHgyPSIwIiB5Mj0iMSI+CjxzdG9wIG9mZnNldD0iMCUiIHN0b3AtY29sb3I9IiM3YWEyZmYiLz48c3RvcCBvZmZzZXQ9IjEwMCUiIHN0b3AtY29sb3I9IiM0YjZmZDQiLz4KPC9saW5lYXJHcmFkaWVudD4KPC9kZWZzPgo8cmVjdCB4PSIyIiB5PSIyIiB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHJ4PSIzIiBmaWxsPSJ1cmwoI3NreSkiLz4KPGNpcmNsZSBjeD0iMTQiIGN5PSI2LjUiIHI9IjEuOCIgZmlsbD0iI2ZmZDc2ZSIvPgo8cGF0aCBkPSJNMiAxNCBMNyA5IEwxMC41IDEyLjUgTDEzIDEwIEwxOCAxNC41IEwxOCAxNSBRMTggMTYgMTcgMTYgTDMgMTYgUTIgMTYgMiAxNSBaIiBmaWxsPSIjMmYzZDU3Ii8+CjxwYXRoIGQ9Ik03IDkgTDUuNSA3LjUgTDQgOSBaIiBmaWxsPSIjM2U1ZjRmIi8+CjxyZWN0IHg9IjIiIHk9IjIiIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiIgcng9IjMiIGZpbGw9Im5vbmUiIHN0cm9rZT0iI2ZmZmZmZjY2IiBzdHJva2Utd2lkdGg9IjEiLz4KPC9zdmc+";

		// ═══════════════════════════════════════════════════════════════════
		//  localStorage 持久化（⑤：读写带缓存 + 防抖，滑杆不卡顿）
		// ═══════════════════════════════════════════════════════════════════
		let sectionCache = null;
		let persistTimer = null;
		let hostSettingsOk = false; // ⑤(新) host /settings 是否可用（持久化到宿主端文件）
		let sectionDirty = false;   // ⑤(修正) 本次启动后用户是否已改过设置（防 host GET 竞态覆盖）
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
					try { localStorage.setItem(STORE_KEY, JSON.stringify(merged)); } catch {}
					applyFromStorage();
				}).catch(() => { hostSettingsOk = false; });
			} catch { hostSettingsOk = false; }
		}
		/** 带缓存的读取：避免每次滑杆事件都解析大 JSON（背景图 data URL 有 1MB+）。 */
		function readSection() {
			if (sectionCache) return sectionCache;
			sectionCache = loadSection();
			return sectionCache;
		}
		/** 写入内存缓存 + 防抖落盘。instant=true 立即写（文件选择/复位）。
		 *  ⑤(新) host 可用时同时 PUT 到宿主端文件（跨端口/清浏览器数据不丢）。
		 *  ①(修正) PUT 失败不再永久禁用：hostSettingsOk 只做乐观标记，
		 *  下次写仍会重试（GET 失败一次 ≠ 整个会话失去持久化）。 */
		function writeSection(next, instant) {
			sectionCache = next;
			sectionDirty = true;
			if (persistTimer) clearTimeout(persistTimer);
			persistTimer = setTimeout(() => {
				try {
					localStorage.setItem(STORE_KEY, JSON.stringify(sectionCache));
				} catch {
					/* 存储满时静默失败 */
				}
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
		/** dataUrl 太大时写入 IndexedDB，返回 "idb:bg" 标记；否则原样返回。 */
		function storeImage(dataUrl) {
			if (dataUrl.length <= 2 * 1024 * 1024) return Promise.resolve(dataUrl);
			return idbPut("bg", dataUrl).then(() => "idb:bg").catch(() => dataUrl);
		}
		/** 视频 Blob 存入 IndexedDB（①：外部渲染成视频后作为动态背景）。 */
		function storeVideoBlob(blob) {
			return idbPut("bg", blob).then(() => "idb:blob");
		}
		/** ③(新) 大图片 Blob 直接存 IndexedDB（不走 dataURL，避免 base64 膨胀 1.37 倍爆内存），
		 *  返回 "idb:img" 标记；小图走 dataURL 直接内联。 */
		function storeImageBlob(blob) {
			if (blob.size <= 2 * 1024 * 1024) {
				return blobToDataUrl(blob).then((d) => (d.length > 2 * 1024 * 1024 ? idbPut("bg", d).then(() => "idb:img") : d));
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
			ensureSlotBlob({ item, timeSrc: s.timeSrc }).then((v) => {
				if (gen !== swapGen) return; // 过期请求：已有更新的切换
				if (!v) return;
				idbPut("bg", v).then(() => {
					if (gen !== swapGen) return;
					writeSection(Object.assign({}, readSection(), {
						activeSlot: item.slot || item.key,
						timeOverride: manual === void 0 ? s.timeOverride : (manual ? slot : null)
					}), true);
					applyFromStorage();
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
				video.autoplay = true;
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
				wrap.appendChild(img);
				wrap.appendChild(video);
				// ①(新) 网页壁纸 iframe（web wallpaper）：独立沙箱层，覆盖整屏。
				// ①(修正) 去掉 allow-same-origin：壁纸是外部内容，不得访问 DSH 应用数据；
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
		 *  scene=1 → 场景静态帧提取（/custom-scene-frame 或 /library-scene-frame）。 */
		function resolveHostUrl(image) {
			try {
				if (typeof image === "string" && image.indexOf("host:") === 0) {
					const q = image.slice(5);
					if (q.indexOf("ltoken=") >= 0) {
						if (q.indexOf("web=1") >= 0) {
							const p = new URLSearchParams(q.slice(1));
							return HOST_BASE + "/library-web/" + encodeURIComponent(p.get("ltoken") || "") + "/" + encodeURIComponent(p.get("file") || "");
						}
						if (q.indexOf("scene=1") >= 0) return HOST_BASE + "/library-scene-frame" + q.replace("scene=1&", "");
						return HOST_BASE + "/library-media" + q;
					}
					if (q.indexOf("custom=") >= 0) {
						if (q.indexOf("scene=1") >= 0) return HOST_BASE + "/custom-scene-frame" + q.replace("custom=1&", "").replace("scene=1&", "");
						if (q.indexOf("folder=") >= 0) {
							const p = new URLSearchParams(q.slice(1));
							return HOST_BASE + "/custom-folder/" + encodeURIComponent(p.get("folder") || "") + "/" + encodeURIComponent(p.get("file") || "");
						}
						return HOST_BASE + "/custom-media" + q.replace("custom=1&", "");
					}
					return HOST_BASE + "/media" + q;
				}
			} catch {}
			return image;
		}
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
			try { if (video.src !== url) video.src = url; } catch {}
			video.playbackRate = (typeof readSection().playbackRate === "number" && readSection().playbackRate >= 0.5 && readSection().playbackRate <= 2) ? readSection().playbackRate : 1;
			edgeDrawFrame();
			try { const p = video.play(); if (p && p.catch) p.catch(() => {}); } catch {}
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
			try { if (video.src !== url) video.src = url; } catch {}
			// ⑳(新) 视频倍速：原生 playbackRate（0.5-2x，即时生效，不重载）
			try {
				const rate = readSection().playbackRate;
				if (typeof rate === "number" && rate >= 0.5 && rate <= 2 && video.playbackRate !== rate) video.playbackRate = rate;
			} catch {}
			video.style.display = "";
			try { const p = video.play(); if (p && p.catch) p.catch(() => {}); } catch {}
		}
		/** ①(新) 网页壁纸：iframe 全屏显示（隐藏 img/video）。 */
		function showWebEl(url) {
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
			};
			wrap.classList.remove("mpw-img");
			wrap.classList.remove("mpw-video");
			wrap.classList.remove("mpw-scene");
			wrap.classList.add("mpw-web");
			img.style.display = "none";
			video.style.display = "none";
			try { if (frame.src !== url) frame.src = url; } catch {}
			// ①(修正) 同 URL 重入（如调 opacity 滑块 → applyFromStorage → showWebEl 同 URL）：
			// src 未变 → onload 不触发 → observer 不会重挂（评审发现的回归：旧 observer 已
			// 被上面 disposeWebFrame 断开）。此时手动补挂，面板/媒体保障不丢。
			try {
				if (frame.getAttribute("src") === url) {
					webMediaObserve(frame);
					hideWebPanel(frame);
				}
			} catch {}
			// ①(修正) 静音开关（默认开）：web 壁纸有声音时用。
			// ①(修正) frame.muted 逻辑曾写反（!(mute) → 默认反而出声）；现在正向。
			applyWebMute(frame);
			frame.style.display = "";
			// ⑳(新) web 壁纸倍速：iframe 内 <video> 的 playbackRate（同源可访问；
			// 部分 web 壁纸用 canvas/WebGL 渲染无 <video>，静默跳过）
			try { applyWebSpeed(frame); } catch {}
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
				const rate = readSection().playbackRate;
				if (typeof rate !== "number" || rate < 0.5 || rate > 2) return;
				const doc = frame && frame.contentDocument;
				if (!doc) return;
				const vids = doc.querySelectorAll("video");
				for (let i = 0; i < vids.length; i++) {
					try { vids[i].playbackRate = rate; } catch {}
				}
			} catch {}
		}
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
		/** canvas 精确静态合成：按清单 cover 适配一次性绘制全部图层。
		 *  ①(修正) 移除自造的呼吸/视差摆动动画——那不是源文件里的动画
		 *  （用户实测反感假动画；真实动画需要 WE 运行时重实现，见路线说明）。
		 *  时间帧切换（伊蕾娜白天/夜晚）是真实来源，保留。 */
		function showSceneEl(manifest) {
			const { img, video, frame, canvas, wrap } = bgElements();
			if (!canvas || !wrap) return;
			stopSceneAnim();
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
				const img = "host:?token=" + d.token + "&index=" + sel.index + (sel.offset ? "&offset=" + sel.offset : "");
				writeSection(Object.assign({}, readSection(), { image: img, source: sel.name, converted: sel.isMp4 ? "mp4" : "gif" }), true);
				applyFromStorage();
				return true;
			} catch { return false; }
		}

		/** 从 localStorage 状态渲染背景 DOM + 样式。 */
		function applyFromStorage() {
			// ①(修正) 防重入环：applyFromStorage → applyTokenOverrides → overrideTokens →
			// DSH theme/change 重渲染 → 可能重入 applyFromStorage（深色 + 统一雾时尤其
			// 明显，用户实测 web 端卡死/主线程冻结）。加 __mpwApplying 标志，重入直接
			// 跳过，杜绝同步重入环。
			if (window.__mpwApplying) return;
			window.__mpwApplying = true;
			try {
				applyFromStorageInner();
			} finally {
				window.__mpwApplying = false;
			}
		}
		function applyFromStorageInner() {
			bgGen++;
			const gen = bgGen;
			// ⑭ backdrop-filter 支持：用 CSS.supports 判断即可（用户实测 Via/Firefox 都支持）。
			// 之前用"屏幕外测试元素 + getComputedStyle"检测会误判 false（屏幕外/透明
			// 元素 computed backdropFilter 可能为空），导致 blur 被跳过只剩半透明=白纱。
			try {
				window.__mpwBackdropRendered = !!(typeof CSS !== "undefined" && !!CSS.supports && CSS.supports("backdrop-filter", "blur(1px)"));
			} catch { window.__mpwBackdropRendered = true; }
			const sectionRaw = readSection();
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
					try { showWebEl(resolveHostUrl(section.webUrl)); } catch {}
				} else {
					try { const f = bgElements().frame; if (f) f.style.display = "none"; } catch {}
				}
				// ①(修正) 刷新 buildCss（hasImage 已含 webUrl）→ .mpw-bgWrap.mpw-web iframe 可见
				try { const se = getStyleEl(); if (se) se.textContent = buildCss(section); } catch {}
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
							if (gen !== bgGen) return;
							const s2 = readSection();
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
					const fpsCapN = section.fpsCap !== void 0 && section.fpsCap !== null ? Number(section.fpsCap) : 0;
					const resMaxN = section.resMax !== void 0 && section.resMax !== null ? Number(section.resMax) : 0;
					const useTranscode = (fpsCapN > 0 || resMaxN > 0) && typeof image === "string" && image.indexOf("host:") === 0;
					const playUrl = useTranscode
						? HOST_BASE + "/transcode?src=" + encodeURIComponent(image)
							+ "&fps=" + (ALLOWED_FPS.includes(fpsCapN) ? fpsCapN : 0)
							+ (resMaxN > 0 ? "&maxW=" + resMaxN : "")
						: hostUrl;
					if (useTranscode) console.log("[dsh-mpkg-wallpaper] 转码播放:", playUrl);
					// ①(修正) 重启竞态兜底：video 也要 404 重试（否则 host 晚就绪 → 视频壁纸永久空白）
					const vid = bgElements().video;
					if (vid && !vid.__mpwHostRetryVideo) {
						vid.__mpwHostTries = 0;
						vid.__mpwAutoTranscoded = false; // ①(新) 编码不支持 → 自动转码降级（只做一次）
						vid.addEventListener("error", () => {
							if (gen !== bgGen) return;
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
							if ((errCode === 3 || errCode === 4) && !useTranscode && !vid.__mpwAutoTranscoded) {
								vid.__mpwAutoTranscoded = true;
								try {
									const tcUrl = HOST_BASE + "/transcode?src=" + encodeURIComponent(image) + "&fps=24";
									console.log("[dsh-mpkg-wallpaper] 编码不支持 → 自动转码播放:", tcUrl);
									vid.removeAttribute("src");
									vid.src = tcUrl;
									vid.load();
									try { const pp = vid.play(); if (pp && pp.catch) pp.catch(() => {}); } catch {}
								} catch {}
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
								if (gen !== bgGen) return;
								console.log("[dsh-mpkg-wallpaper] host video 404 → 重试", vid.__mpwHostTries);
								const cur = vid.src;
								vid.removeAttribute("src");
								vid.src = cur;
								vid.load();
								try { const pp = vid.play(); if (pp && pp.catch) pp.catch(() => {}); } catch {}
							}, 800 * vid.__mpwHostTries);
						});
					}
					// ⑤(新) Edge 兼容：Edge 上画到 canvas（视频元素不可见，避开悬浮工具栏）
					if (IS_EDGE) { try { showVideoEdge(playUrl, bgElements().video); } catch { showVideoEl(playUrl); } }
					else showVideoEl(playUrl);
				} else {
					// ①(修正) 重启竞态兜底：dsh 重启后浏览器可能先于 host 就绪请求 media → 404；
					// 挂 onerror 自动重试（最多 5 次、间隔递增），host 恢复后壁纸自动回来。
					if (img.__mpwHostRetry) { try { clearTimeout(img.__mpwHostRetry); } catch {} }
					img.__mpwHostTries = 0;
					img.onerror = () => {
						if (gen !== bgGen) return;
						if ((img.__mpwHostTries || 0) >= 5) { img.__mpwHostTries = 0; return; }
						img.__mpwHostTries = (img.__mpwHostTries || 0) + 1;
						img.__mpwHostRetry = setTimeout(() => {
							if (gen !== bgGen) return;
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
					if (gen !== bgGen) return; // 过期回调（已有更新的应用）
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
				idbGet("bg").then((v) => {
					if (gen !== bgGen) return; // 过期回调
					if (!(v instanceof Blob)) return;
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
				}).catch(() => {});
			} else if (typeof image === "string" && image.indexOf("idb:") === 0) {
				idbGet("bg").then((v) => { if (gen !== bgGen) return; if (v && img.src !== v) { img.src = v; showImageEl(); } }).catch(() => {});
			} else {
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
					img.src = image;
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
				else document.body.removeAttribute("data-mpw-sblur");
			} catch {}
			try { setupSblurObserver(); } catch {}
			try { setupHeaderBlurWatch(); } catch {}
			try { setupAquaThemeWatch(); } catch {}
			// ①(新) 主题颜色：body 门控 + CSS 变量（控制侧边栏/标题栏/新会话/设置弹窗底色）
			try {
				const tc = section.themeColor || "";
				if (tc && /^#[0-9a-fA-F]{6}$/.test(tc)) {
					document.body.setAttribute("data-mpw-theme", "");
					document.documentElement.style.setProperty("--mpw-theme-color", tc);
				} else {
					document.body.removeAttribute("data-mpw-theme");
					document.documentElement.style.removeProperty("--mpw-theme-color");
				}
				// ①(新) 配色（accent）：品牌交互元素（按钮/滑条/选中/链接/发送键）
				const ac = section.accent || "";
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
				// ①(新) 配色（accent，品牌交互元素）：与主题颜色分工
				if (section.accent && /^#[0-9a-fA-F]{6}$/.test(section.accent))
					document.body.setAttribute("data-mpw-accent", "");
				else document.body.removeAttribute("data-mpw-accent");
				if (section.aquaTextEnhance !== void 0 ? !!section.aquaTextEnhance : DEFAULT_AQUA_TEXT_ENHANCE)
					document.body.setAttribute("data-mpw-aqua-text", "");
				else document.body.removeAttribute("data-mpw-aqua-text");
				if (section.todoBlur !== void 0 ? !!section.todoBlur : DEFAULT_TODO_BLUR)
					document.body.setAttribute("data-mpw-todo-blur", "");
				else document.body.removeAttribute("data-mpw-todo-blur");
				refreshAqua();
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
			}
			// ⑭ token override：弹层/主画布/侧边栏半透明（对话框虚化核心）
			try { applyTokenOverrides(pluginCtx, section); } catch {}
			try { applyDialogInline(section); } catch {}
			try { updateClock(); } catch {}
			// ①(新) 液态玻璃叠加层（lgComposer/lgSidebar/lgHeader 任一开启时启动）
			try { applyLiquidGlass(section); } catch {}
		}

		// ═══════════════════════════════════════════════════════════════════
		//  🧪(新) 液态玻璃叠加层（测试模式）：把 WebGL2 液态玻璃渲染到 DSH 界面。
		//  渲染器源码由 host 静态托管（/api/mpkg-wallpaper/lg/*.js），浏览器动态 import。
		//  稳定安全优先：任何异常都 catch，不影响主功能；开关关闭即销毁。
		//  ═══════════════════════════════════════════════════════════════════
		let lgModule = null;          // { LiquidGlassWebGLV2 }
		let lgStatus = "";           // 调试状态（显示在 tab 里）
		function setLgStatus(s) { lgStatus = s; try { notifySectionChanged(); } catch {} }
		let lgGlass = null;          // 实例
		let lgCanvas = null;         // 全屏玻璃 canvas
		let lgResizeObs = null;
		let lgBgVideoHooked = false;
		const LG_EL_KEYS = [['lgComposer', '.wSkVaW_scrollBody, [data-slot*="composer"] [class*="card"], [data-composer-card]'], ['lgSidebar', '[class*="sidebarCol"], [data-dsh-better-sidebar] [class*="_panel"], [data-dsh-better-sidebar] [class*="_bottomPanel"]'], ['lgHeader', '.wSkVaW_header, [class*="wSkVaW_header"]']];
		// ①(重做) 液态玻璃 bundle 用 **base64 内联**（LG_BUNDLE_B64 由 tools/inline-lg-b64.mjs
		// 生成）。base64 纯 ASCII（无引号/反引号/${），DSH client-modules 打包器对纯字符串
		// 常量完全安全——不像内联原始 JS 那样触发打包异常崩溃（用户实测 dsh 启动崩溃 +
		// loadSection is not defined）。运行时 atob 解码 + Blob import，不依赖 host /lg 路由、
		// 无需重启 dsh、跨 Windows/macOS/WSL/Linux 任何安装方式都可用。
		const LG_BUNDLE_B64 = "Ly8g6Ieq5Yqo55Sf5oiQ77ya5ray5oCB546755KD5Y2V5LiAIGJ1bmRsZe+8iGJ1aWxkLWxnLWJ1bmRsZS5tanPvvInvvIzli7/miYvmlLkKCi8vID09PT09IHNoYWRlcnMuanMgPT09PT0KLy8gR0xTTCBzb3VyY2VzIGZvciB0aGUgTGlxdWlkIEdsYXNzIHJlcGxpY2EuCgpjb25zdCBWU19GVUxMU0NSRUVOID0gYCN2ZXJzaW9uIDMwMCBlcwppbiB2ZWMyIGFQb3M7Cm91dCB2ZWMyIHZVVjsKdm9pZCBtYWluKCkgewogIHZVViA9IGFQb3M7CiAgZ2xfUG9zaXRpb24gPSB2ZWM0KGFQb3MgKiAyLjAgLSAxLjAsIDAuMCwgMS4wKTsKfWA7CgovLyBWZXJ0ZXggc2hhZGVyIGZvciBvbmUgZ2xhc3MgZWxlbWVudDogZXhwYW5kcyB0aGUgdW5pdCBxdWFkIHRvIHRoZSBlbGVtZW50J3MKLy8gYm91bmRpbmcgYm94IChwbHVzIHBhZGRpbmcgZm9yIHRoZSBkcm9wIHNoYWRvdykgaW4gcGl4ZWwgc3BhY2UuCmNvbnN0IFZTX0dMQVNTID0gYCN2ZXJzaW9uIDMwMCBlcwppbiB2ZWMyIGFQb3M7CnVuaWZvcm0gdmVjMiB1UmVzOwp1bmlmb3JtIHZlYzIgdUNlbnRlcjsKdW5pZm9ybSB2ZWMyIHVIYWxmOwp1bmlmb3JtIGZsb2F0IHVQYWQ7Cm91dCB2ZWMyIHZVVjsKdm9pZCBtYWluKCkgewogIHZlYzIgaGFsZjIgPSB1SGFsZiArIHVQYWQ7CiAgdmVjMiBweCA9IHVDZW50ZXIgKyAoYVBvcyAqIDIuMCAtIDEuMCkgKiBoYWxmMjsKICB2VVYgPSBweCAvIHVSZXM7CiAgZ2xfUG9zaXRpb24gPSB2ZWM0KHB4IC8gdVJlcyAqIDIuMCAtIDEuMCwgMC4wLCAxLjApOwp9YDsKCmNvbnN0IEZTX0JMSVQgPSBgI3ZlcnNpb24gMzAwIGVzCnByZWNpc2lvbiBoaWdocCBmbG9hdDsKaW4gdmVjMiB2VVY7CnVuaWZvcm0gc2FtcGxlcjJEIHVUZXg7Cm91dCB2ZWM0IG91dENvbG9yOwp2ZWMzIGxpbmVhclRvU3JnYih2ZWMzIGMpIHsKICBjID0gbWF4KGMsIDAuMCk7CiAgcmV0dXJuIG1peCgxLjA1NSAqIHBvdyhjLCB2ZWMzKDEuMCAvIDIuNCkpIC0gMC4wNTUsCiAgICAgICAgICAgICAxMi45MiAqIGMsCiAgICAgICAgICAgICBsZXNzVGhhbkVxdWFsKGMsIHZlYzMoMC4wMDMxMzA4KSkpOwp9CnZvaWQgbWFpbigpIHsgb3V0Q29sb3IgPSB2ZWM0KGxpbmVhclRvU3JnYih0ZXh0dXJlKHVUZXgsIHZVVikucmdiKSwgMS4wKTsgfWA7CgovLyBEdWFsLWZpbHRlciBkb3duc2FtcGxlICgxMyB0YXApIHVzZWQgdG8gYnVpbGQgYSBwcm9ncmVzc2l2ZWx5IGJsdXJyZWQgbWlwCi8vIGNoYWluLiBTYW1wbGluZyB0aGF0IGNoYWluIHdpdGggdGV4dHVyZUxvZCgpIGdpdmVzIGEgY2hlYXAgdmFyaWFibGUgYmx1ciwKLy8gd2hpY2ggaXMgdGhlICJmcm9zdGVkIi9zY2F0dGVyaW5nIHBhcnQgb2YgdGhlIG1hdGVyaWFsLgpjb25zdCBGU19ET1dOID0gYCN2ZXJzaW9uIDMwMCBlcwpwcmVjaXNpb24gaGlnaHAgZmxvYXQ7CmluIHZlYzIgdlVWOwp1bmlmb3JtIHNhbXBsZXIyRCB1VGV4Owp1bmlmb3JtIHZlYzIgdVRleGVsOyAgIC8vIHRleGVsIHNpemUgb2YgdGhlIFNPVVJDRSBsZXZlbApvdXQgdmVjNCBvdXRDb2xvcjsKdm9pZCBtYWluKCkgewogIHZlYzIgdCA9IHVUZXhlbDsKICB2ZWM0IGEgPSB0ZXh0dXJlKHVUZXgsIHZVVikgKiAwLjEyNTsKICB2ZWM0IGIgPSAodGV4dHVyZSh1VGV4LCB2VVYgKyB2ZWMyKC10LngsIC10LnkpKSArCiAgICAgICAgICAgIHRleHR1cmUodVRleCwgdlVWICsgdmVjMiggdC54LCAtdC55KSkgKwogICAgICAgICAgICB0ZXh0dXJlKHVUZXgsIHZVViArIHZlYzIoLXQueCwgIHQueSkpICsKICAgICAgICAgICAgdGV4dHVyZSh1VGV4LCB2VVYgKyB2ZWMyKCB0LngsICB0LnkpKSkgKiAwLjEyNTsKICB2ZWM0IGMgPSAodGV4dHVyZSh1VGV4LCB2VVYgKyB2ZWMyKC0yLjAgKiB0LngsIDAuMCkpICsKICAgICAgICAgICAgdGV4dHVyZSh1VGV4LCB2VVYgKyB2ZWMyKCAyLjAgKiB0LngsIDAuMCkpICsKICAgICAgICAgICAgdGV4dHVyZSh1VGV4LCB2VVYgKyB2ZWMyKDAuMCwgLTIuMCAqIHQueSkpICsKICAgICAgICAgICAgdGV4dHVyZSh1VGV4LCB2VVYgKyB2ZWMyKDAuMCwgIDIuMCAqIHQueSkpKSAqIDAuMDYyNTsKICB2ZWM0IGQgPSAodGV4dHVyZSh1VGV4LCB2VVYgKyB2ZWMyKC0yLjAgKiB0LngsIC0yLjAgKiB0LnkpKSArCiAgICAgICAgICAgIHRleHR1cmUodVRleCwgdlVWICsgdmVjMiggMi4wICogdC54LCAtMi4wICogdC55KSkgKwogICAgICAgICAgICB0ZXh0dXJlKHVUZXgsIHZVViArIHZlYzIoLTIuMCAqIHQueCwgIDIuMCAqIHQueSkpICsKICAgICAgICAgICAgdGV4dHVyZSh1VGV4LCB2VVYgKyB2ZWMyKCAyLjAgKiB0LngsICAyLjAgKiB0LnkpKSkgKiAwLjAzMTI1OwogIC8vIFJHQiBzdG9yZXMgcmFkaWFuY2UuIEFscGhhIHN0b3JlcyBub3JtYWxpemVkIG9wdGljYWwgZGVuc2l0eSwgc28gdGhlIG1pcAogIC8vIGNoYWluIGNhbiBibHVyIGJvdGggcmVwcmVzZW50YXRpb25zIHdpdGggZXhhY3RseSB0aGUgc2FtZSBmb290cHJpbnQuCiAgb3V0Q29sb3IgPSBhICsgYiArIGMgKyBkOwp9YDsKCi8vIEJsb29tLXN0eWxlIHRlbnQgcmVjb25zdHJ1Y3Rpb24uIEVhY2ggbGV2ZWwgY29tYmluZXMgaXRzIG93biBkb3duc2FtcGxlZAovLyBkZXRhaWwgd2l0aCBhIHRlbnQtZmlsdGVyZWQgdmVyc2lvbiBvZiB0aGUgbmV4dCBjb2Fyc2VyIHJlY29uc3RydWN0ZWQgbGV2ZWwuCi8vIFRoZSByZXN1bHRpbmcgY2hhaW4gcmVtb3ZlcyB0aGUgYmxvY2sgYm91bmRhcmllcyB0aGF0IGEgZG93bnNhbXBsZS1vbmx5IG1pcAovLyBweXJhbWlkIGV4cG9zZXMgd2hlbiB3aWRlIGJsdXIgbW92ZXMgb3ZlciBoaWdoLWNvbnRyYXN0IGNvbnRlbnQuCmNvbnN0IEZTX1VQID0gYCN2ZXJzaW9uIDMwMCBlcwpwcmVjaXNpb24gaGlnaHAgZmxvYXQ7CmluIHZlYzIgdlVWOwp1bmlmb3JtIHNhbXBsZXIyRCB1TG93Owp1bmlmb3JtIHNhbXBsZXIyRCB1SGlnaDsKdW5pZm9ybSB2ZWMyIHVMb3dUZXhlbDsKb3V0IHZlYzQgb3V0Q29sb3I7CnZvaWQgbWFpbigpIHsKICB2ZWMyIHQgPSB1TG93VGV4ZWw7CiAgdmVjNCBsb3cgPSB0ZXh0dXJlKHVMb3csIHZVVikgKiA0LjA7CiAgbG93ICs9ICh0ZXh0dXJlKHVMb3csIHZVViArIHZlYzIoIHQueCwgMC4wKSkgKwogICAgICAgICAgdGV4dHVyZSh1TG93LCB2VVYgKyB2ZWMyKC10LngsIDAuMCkpICsKICAgICAgICAgIHRleHR1cmUodUxvdywgdlVWICsgdmVjMigwLjAsICB0LnkpKSArCiAgICAgICAgICB0ZXh0dXJlKHVMb3csIHZVViArIHZlYzIoMC4wLCAtdC55KSkpICogMi4wOwogIGxvdyArPSB0ZXh0dXJlKHVMb3csIHZVViArIHZlYzIoIHQueCwgIHQueSkpICsKICAgICAgICAgdGV4dHVyZSh1TG93LCB2VVYgKyB2ZWMyKC10LngsICB0LnkpKSArCiAgICAgICAgIHRleHR1cmUodUxvdywgdlVWICsgdmVjMiggdC54LCAtdC55KSkgKwogICAgICAgICB0ZXh0dXJlKHVMb3csIHZVViArIHZlYzIoLXQueCwgLXQueSkpOwogIGxvdyAqPSAxLjAgLyAxNi4wOwogIHZlYzQgaGlnaCA9IHRleHR1cmUodUhpZ2gsIHZVVik7CiAgb3V0Q29sb3IgPSBtaXgoaGlnaCwgbG93LCAwLjY1KTsKfWA7CgovLyBQcm9jZWR1cmFsIHdhbGxwYXBlcnMuIFRoZXkgb25seSBleGlzdCB0byBnaXZlIHRoZSBnbGFzcyBzb21ldGhpbmcgd2l0aCBoYXJkLAovLyBoaWdoIGNvbnRyYXN0IGVkZ2VzIHRvIGJlbmQgLS0gZXhhY3RseSB3aGF0IHRoZSByZWZlcmVuY2Ugc2NyZWVuc2hvdHMgaGF2ZS4KY29uc3QgRlNfV0FMTFBBUEVSID0gYCN2ZXJzaW9uIDMwMCBlcwpwcmVjaXNpb24gaGlnaHAgZmxvYXQ7CmluIHZlYzIgdlVWOwp1bmlmb3JtIHZlYzIgdVJlczsKdW5pZm9ybSBpbnQgdVNjZW5lOwp1bmlmb3JtIGZsb2F0IHVab29tOwp1bmlmb3JtIHNhbXBsZXIyRCB1V2FsbHBhcGVyOwp1bmlmb3JtIGludCB1VXNlSW1hZ2U7Cm91dCB2ZWM0IG91dENvbG9yOwoKZmxvYXQgaGFzaCh2ZWMyIHApIHsgcmV0dXJuIGZyYWN0KHNpbihkb3QocCwgdmVjMigxMjcuMSwgMzExLjcpKSkgKiA0Mzc1OC41NDUzKTsgfQp2ZWMzIHNyZ2JUb0xpbmVhcih2ZWMzIGMpIHsKICBidmVjMyBjdXRvZmYgPSBsZXNzVGhhbkVxdWFsKGMsIHZlYzMoMC4wNDA0NSkpOwogIHZlYzMgbG93ID0gYyAvIDEyLjkyOwogIHZlYzMgaGlnaCA9IHBvdygoYyArIDAuMDU1KSAvIDEuMDU1LCB2ZWMzKDIuNCkpOwogIHJldHVybiBtaXgoaGlnaCwgbG93LCBjdXRvZmYpOwp9CmZsb2F0IG5vaXNlKHZlYzIgcCkgewogIHZlYzIgaSA9IGZsb29yKHApLCBmID0gZnJhY3QocCk7CiAgZiA9IGYgKiBmICogKDMuMCAtIDIuMCAqIGYpOwogIHJldHVybiBtaXgobWl4KGhhc2goaSksIGhhc2goaSArIHZlYzIoMSwgMCkpLCBmLngpLAogICAgICAgICAgICAgbWl4KGhhc2goaSArIHZlYzIoMCwgMSkpLCBoYXNoKGkgKyB2ZWMyKDEsIDEpKSwgZi54KSwgZi55KTsKfQpmbG9hdCBmYm0odmVjMiBwKSB7CiAgZmxvYXQgcyA9IDAuMCwgYSA9IDAuNTsKICBmb3IgKGludCBpID0gMDsgaSA8IDU7IGkrKykgeyBzICs9IGEgKiBub2lzZShwKTsgcCAqPSAyLjAyOyBhICo9IDAuNTsgfQogIHJldHVybiBzOwp9Ci8vIGRpc3RhbmNlIHRvIGEgcXVhZHJhdGljIGJlemllciAoaXRlcmF0aXZlLCBnb29kIGVub3VnaCBmb3IgYSBiYWNrZHJvcCkKZmxvYXQgc2RCZXppZXIodmVjMiBwLCB2ZWMyIGEsIHZlYzIgYiwgdmVjMiBjKSB7CiAgZmxvYXQgYmVzdCA9IDFlOTsKICB2ZWMyIHByZXYgPSBhOwogIGZvciAoaW50IGkgPSAxOyBpIDw9IDQwOyBpKyspIHsKICAgIGZsb2F0IHQgPSBmbG9hdChpKSAvIDQwLjA7CiAgICB2ZWMyIHEgPSBtaXgobWl4KGEsIGIsIHQpLCBtaXgoYiwgYywgdCksIHQpOwogICAgdmVjMiBwYSA9IHAgLSBwcmV2LCBiYSA9IHEgLSBwcmV2OwogICAgZmxvYXQgdSA9IGNsYW1wKGRvdChwYSwgYmEpIC8gbWF4KGRvdChiYSwgYmEpLCAxZS05KSwgMC4wLCAxLjApOwogICAgYmVzdCA9IG1pbihiZXN0LCBsZW5ndGgocGEgLSBiYSAqIHUpKTsKICAgIHByZXYgPSBxOwogIH0KICByZXR1cm4gYmVzdDsKfQoKdmVjMyBzdW5zZXRCcmFuY2hlcyh2ZWMyIHV2KSB7CiAgLy8gZHVzayBncmFkaWVudDogY29vbCBncmV5LW1hdXZlIGF0IHRoZSB0b3AsIHdhcm0gYW1iZXIgbmVhciB0aGUgaG9yaXpvbgogIHZlYzMgdG9wID0gdmVjMygwLjYyLCAwLjU1LCAwLjU1KTsKICB2ZWMzIG1pZCA9IHZlYzMoMC44NSwgMC42MywgMC41Myk7CiAgdmVjMyBsb3cgPSB2ZWMzKDAuOTQsIDAuNzAsIDAuNTIpOwogIHZlYzMgY29sID0gbWl4KG1pZCwgdG9wLCBzbW9vdGhzdGVwKDAuNDUsIDEuMCwgdXYueSkpOwogIGNvbCA9IG1peChjb2wsIGxvdywgc21vb3Roc3RlcCgwLjQ1LCAwLjAsIHV2LnkpKTsKICBjb2wgKz0gKGZibSh1diAqIDMuMCkgLSAwLjUpICogMC4wNTsKCiAgdmVjMiBwID0gdXYgKiB2ZWMyKHVSZXMueCAvIHVSZXMueSwgMS4wKTsKICBmbG9hdCBzYyA9IHVSZXMueCAvIHVSZXMueTsKICB2ZWMzIGJhcmsgPSB2ZWMzKDAuMTcsIDAuMTAsIDAuMDkpOwogIC8vIG1haW4gdHJ1bmsgKyBhIGZldyBicmFuY2hlcywgdGhpY2sgYW5kIGRhcmsgbGlrZSB0aGUgcmVmZXJlbmNlIHBob3RvCiAgZmxvYXQgZCA9IHNkQmV6aWVyKHAsIHZlYzIoMC40MiAqIHNjLCAtMC4xKSwgdmVjMigwLjUyICogc2MsIDAuNDUpLCB2ZWMyKDAuMzYgKiBzYywgMS4xKSk7CiAgZmxvYXQgbSA9IHNtb290aHN0ZXAoMC4wNjAsIDAuMDQwLCBkKTsKICBkID0gc2RCZXppZXIocCwgdmVjMigwLjQwICogc2MsIDAuMzApLCB2ZWMyKDAuNjIgKiBzYywgMC40NCksIHZlYzIoMC45NSAqIHNjLCAwLjI2KSk7CiAgbSA9IG1heChtLCBzbW9vdGhzdGVwKDAuMDM0LCAwLjAyMCwgZCkpOwogIGQgPSBzZEJlemllcihwLCB2ZWMyKDAuNDQgKiBzYywgMC42MiksIHZlYzIoMC4yNSAqIHNjLCAwLjgwKSwgdmVjMigwLjA1ICogc2MsIDAuNzIpKTsKICBtID0gbWF4KG0sIHNtb290aHN0ZXAoMC4wMjIsIDAuMDEwLCBkKSk7CiAgZCA9IHNkQmV6aWVyKHAsIHZlYzIoMC40NiAqIHNjLCAwLjgwKSwgdmVjMigwLjcyICogc2MsIDAuOTUpLCB2ZWMyKDEuMDUgKiBzYywgMC43OCkpOwogIG0gPSBtYXgobSwgc21vb3Roc3RlcCgwLjAxNiwgMC4wMDcsIGQpKTsKICBkID0gc2RCZXppZXIocCwgdmVjMigwLjEyICogc2MsIC0wLjA1KSwgdmVjMigwLjE4ICogc2MsIDAuNSksIHZlYzIoMC4wNiAqIHNjLCAxLjA1KSk7CiAgbSA9IG1heChtLCBzbW9vdGhzdGVwKDAuMDM4LCAwLjAyMiwgZCkpOwogIC8vIHNlZWQgcG9kcwogIGZvciAoaW50IGkgPSAwOyBpIDwgMzsgaSsrKSB7CiAgICBmbG9hdCBmaSA9IGZsb2F0KGkpOwogICAgdmVjMiBjID0gdmVjMigoMC4xNCArIDAuMDIgKiBmaSkgKiBzYywgMC4zMCArIDAuMjYgKiBmaSk7CiAgICBtID0gbWF4KG0sIHNtb290aHN0ZXAoMC4wMzUsIDAuMDIyLCBsZW5ndGgoKHAgLSBjKSAqIHZlYzIoMS4wLCAwLjgpKSkpOwogIH0KICByZXR1cm4gbWl4KGNvbCwgYmFyaywgbSAqIDAuOTQpOwp9Cgp2ZWMzIGRlZXBCbHVlQ2l0eSh2ZWMyIHV2KSB7CiAgdmVjMyBjb2wgPSBtaXgodmVjMygwLjA2LCAwLjE0LCAwLjU1KSwgdmVjMygwLjAyLCAwLjA2LCAwLjM0KSwgc21vb3Roc3RlcCgwLjAsIDEuMCwgdXYueSkpOwogIGNvbCArPSAoZmJtKHV2ICogdmVjMig5MC4wLCA5MC4wKSkgLSAwLjUpICogMC4wNTsgICAvLyBmYWJyaWMtbGlrZSBkaXRoZXIKICAvLyBicmlnaHQgdmVydGljYWwgdG93ZXIgc3RyaXAKICBmbG9hdCB4ID0gYWJzKHV2LnggLSAwLjUpOwogIGZsb2F0IHRvd2VyID0gc21vb3Roc3RlcCgwLjAzNSwgMC4wMTIsIHgpICogc21vb3Roc3RlcCgwLjAyLCAwLjI1LCB1di55KTsKICBjb2wgPSBtaXgoY29sLCB2ZWMzKDAuNzIsIDAuNTgsIDAuNTIpLCB0b3dlciAqIDAuODUpOwogIGZsb2F0IGdsb3cgPSBzbW9vdGhzdGVwKDAuMTYsIDAuMCwgeCkgKiBzbW9vdGhzdGVwKDAuMCwgMC41LCB1di55KSAqIDAuMTg7CiAgY29sICs9IHZlYzMoMC41LCAwLjQyLCAwLjM2KSAqIGdsb3c7CiAgY29sID0gbWl4KGNvbCwgdmVjMygwLjEwLCAwLjE0LCAwLjI2KSwgc21vb3Roc3RlcCgwLjE2LCAwLjAyLCB1di55KSk7CiAgcmV0dXJuIGNvbDsKfQoKdmVjMyBpc2xhbmRPY2Vhbih2ZWMyIHV2KSB7CiAgZmxvYXQgYXIgPSB1UmVzLnggLyB1UmVzLnk7CiAgdmVjMyBkZWVwID0gdmVjMygwLjAzLCAwLjI2LCAwLjUyKTsKICB2ZWMzIHNoYWxsb3cgPSB2ZWMzKDAuMjAsIDAuNzQsIDAuODIpOwogIGZsb2F0IHdhdmVzID0gZmJtKHZlYzIodXYueCAqIGFyICogNi4wLCB1di55ICogMjIuMCkgKyAzLjApOwogIHZlYzMgY29sID0gbWl4KGRlZXAsIHNoYWxsb3csIHNtb290aHN0ZXAoMC4zMCwgMC43OCwgd2F2ZXMgKiAwLjcgKyB1di55ICogMC41KSk7CgogIHZlYzIgcCA9ICh1diAtIHZlYzIoMC41LCAwLjQwKSkgKiB2ZWMyKGFyLCAxLjApOwogIGZsb2F0IGlzbCA9IChmYm0ocCAqIDIuMiArIDExLjApIC0gMC41KSAqIDAuMzQ7CiAgZmxvYXQgZCA9IGxlbmd0aChwICogdmVjMigwLjYyLCAxLjI1KSkgLSAoMC40MiArIGlzbCk7CiAgLy8gc2hhbGxvdyByZWVmIHJpbmcgYXJvdW5kIHRoZSBsYW5kCiAgY29sID0gbWl4KGNvbCwgdmVjMygwLjQyLCAwLjg2LCAwLjg2KSwgc21vb3Roc3RlcCgwLjE0LCAwLjAzLCBkKSAqIDAuNzUpOwogIGNvbCA9IG1peChjb2wsIHZlYzMoMC45NCwgMC45MCwgMC43MiksIHNtb290aHN0ZXAoMC4wMzUsIDAuMCwgZCkpOyAgICAgICAgLy8gYmVhY2gKICB2ZWMzIGp1bmdsZSA9IG1peCh2ZWMzKDAuMDQsIDAuMjYsIDAuMDkpLCB2ZWMzKDAuMjQsIDAuNTUsIDAuMjApLAogICAgICAgICAgICAgICAgICAgIGZibShwICogOS4wICsgNS4wKSk7CiAgY29sID0gbWl4KGNvbCwganVuZ2xlLCBzbW9vdGhzdGVwKDAuMDA1LCAtMC4wMiwgZCkpOyAgICAgICAgICAgICAgICAgICAgICAvLyBqdW5nbGUKICByZXR1cm4gY29sOwp9Cgp2ZWMyIGNvdmVyVVYodmVjMiB1dikgewogIHZlYzIgaW1hZ2VTaXplID0gdmVjMih0ZXh0dXJlU2l6ZSh1V2FsbHBhcGVyLCAwKSk7CiAgZmxvYXQgaW1hZ2VBc3BlY3QgPSBpbWFnZVNpemUueCAvIG1heChpbWFnZVNpemUueSwgMS4wKTsKICBmbG9hdCB2aWV3cG9ydEFzcGVjdCA9IHVSZXMueCAvIG1heCh1UmVzLnksIDEuMCk7CiAgdmVjMiBwID0gdXY7CiAgaWYgKGltYWdlQXNwZWN0ID4gdmlld3BvcnRBc3BlY3QpIHsKICAgIGZsb2F0IGNyb3AgPSAoaW1hZ2VBc3BlY3QgLyB2aWV3cG9ydEFzcGVjdCAtIDEuMCkgKiAwLjU7CiAgICBwLnggPSBwLnggKiAoMS4wIC0gMi4wICogY3JvcCkgKyBjcm9wOwogIH0gZWxzZSB7CiAgICBmbG9hdCBjcm9wID0gKHZpZXdwb3J0QXNwZWN0IC8gaW1hZ2VBc3BlY3QgLSAxLjApICogMC41OwogICAgcC55ID0gcC55ICogKDEuMCAtIDIuMCAqIGNyb3ApICsgY3JvcDsKICB9CiAgcmV0dXJuIGNsYW1wKHAsIHZlYzIoMC4wMDEpLCB2ZWMyKDAuOTk5KSk7Cn0KCnZvaWQgbWFpbigpIHsKICB2ZWMyIHV2ID0gKHZVViAtIDAuNSkgLyBtYXgodVpvb20sIDAuMDEpICsgMC41OwogIHZlYzMgY29sOwogIGlmICh1VXNlSW1hZ2UgPT0gMSkgewogICAgLy8gV2FsbHBhcGVyIHRleHR1cmVzIHVzZSBTUkdCOF9BTFBIQTgsIHNvIHRleHR1cmUoKSBhbHJlYWR5IHJldHVybnMgbGluZWFyCiAgICAvLyByYWRpYW5jZSBoZXJlLgogICAgY29sID0gdGV4dHVyZSh1V2FsbHBhcGVyLCBjb3ZlclVWKHV2KSkucmdiOwogIH0gZWxzZSB7CiAgICAvLyBQcm9jZWR1cmFsIHBhbGV0dGUgY29uc3RhbnRzIGFyZSBhdXRob3JlZCBhcyBkaXNwbGF5L3NSR0IgY29sb3Vycy4gVGhlCiAgICAvLyBTUkdCIHJlbmRlciB0YXJnZXQgZXhwZWN0cyBsaW5lYXIgc2hhZGVyIG91dHB1dCBhbmQgZW5jb2RlcyBpdCBvbiB3cml0ZS4KICAgIGNvbCA9IHNyZ2JUb0xpbmVhcih1U2NlbmUgPT0gMCA/IHN1bnNldEJyYW5jaGVzKHV2KQogICAgICAgICAgICAgICAgICAgICAgIDogdVNjZW5lID09IDEgPyBkZWVwQmx1ZUNpdHkodXYpCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA6IGlzbGFuZE9jZWFuKHV2KSk7CiAgfQogIC8vIEJlZXItTGFtYmVydCByZXByZXNlbnRhdGlvbiBvZiBiYWNrZHJvcCBkYXJrbmVzcy4gQSB2YWx1ZSBvZiA0IG9wdGljYWwKICAvLyBkZW5zaXR5IHVuaXRzIGFscmVhZHkgY29ycmVzcG9uZHMgdG8gfjEuOCUgdHJhbnNtaXNzaW9uLCBlbm91Z2ggZm9yIHRoZQogIC8vIG5lYXItYmxhY2sgYnJhbmNoZXMgd2hpbGUgcmV0YWluaW5nIHVzZWZ1bCBwcmVjaXNpb24gaW4gUkdCQTguCiAgZmxvYXQgbHVtID0gbWF4KGRvdChjb2wsIHZlYzMoMC4yMTI2LCAwLjcxNTIsIDAuMDcyMikpLCAwLjAxOCk7CiAgZmxvYXQgZGVuc2l0eSA9IGNsYW1wKC1sb2cobHVtKSAvIDQuMCwgMC4wLCAxLjApOwogIG91dENvbG9yID0gdmVjNChjb2wsIGRlbnNpdHkpOwp9YDsKCi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQovLyBUaGUgbWF0ZXJpYWwgaXRzZWxmLgovLwovLyAxLiBzaGFwZSAgICAgICAgICA6IHNxdWFyZS9yZWN0IGZvbGRlciAvIGV4YWN0IGNhcHN1bGUgLyBleGFjdCBjaXJjbGUgU0RGCi8vIDIuIHRoaWNrbmVzcyAgICAgIDogdCA9IGNsYW1wKC1kIC8gYmV2ZWwpLCBoZWlnaHQgaCh0KSA9IGEgY29udmV4IGJldmVsCi8vICAgICAgICAgICAgICAgICAgICAgcHJvZmlsZSAtPiBmbGF0IHBsYXRlYXUgaW4gdGhlIG1pZGRsZSwgc3RlZXAgcmltCi8vIDMuIG5vcm1hbCAgICAgICAgIDogbiA9IG5vcm1hbGl6ZSh2ZWMzKHMgKiBIL2JldmVsICogZGgvZHQgKiBncmFkKGQpLCAxKSkKLy8gICAgICAgICAgICAgICAgICAgICBzID0gLTEgLT4gTUVOSVNDVVMgcmltIChjb25jYXZlLCBsaWtlIGEgbGlxdWlkIGNsaW1iaW5nCi8vICAgICAgICAgICAgICAgICAgICAgdGhlIHdhbGwgb2YgYSBnbGFzcyk6IG5vcm1hbHMgbGVhbiBpbndhcmQsIHJlZnJhY3Rpb24KLy8gICAgICAgICAgICAgICAgICAgICBwdXNoZXMgdGhlIHNhbXBsZSBwb2ludCBPVVRXQVJELCBzbyB0aGUgc3Vycm91bmRpbmdzIGdldAovLyAgICAgICAgICAgICAgICAgICAgIHNxdWVlemVkIGludG8gdGhlIHJpbS4gVGhpcyBpcyB0aGUgQXBwbGUgc2lnbmF0dXJlLgovLyAgICAgICAgICAgICAgICAgICAgIHMgPSArMSAtPiBjb252ZXggbGVucyByaW06IG1hZ25pZmllcyB0aGUgaW50ZXJpb3IgaW5zdGVhZC4KLy8gNC4gcmVmcmFjdGlvbiAgICAgOiBTbmVsbCAocmVmcmFjdCgpKSB0aHJvdWdoIHRoYXQgc3VyZmFjZSwgc2NyZWVuLXNwYWNlCi8vICAgICAgICAgICAgICAgICAgICAgZGlzcGxhY2VtZW50ID0gUi54eSAvIC1SLnogKiBvcHRpY2FsIHBhdGggbGVuZ3RoCi8vIDUuIGRpc3BlcnNpb24gICAgIDogUi9HL0IgcmVmcmFjdGVkIHdpdGggc2xpZ2h0bHkgZGlmZmVyZW50IElPUgovLyA2LiBzY2F0dGVyaW5nICAgICA6IHZhcmlhYmxlLXJhZGl1cyBibHVyIChtdWx0aS10YXAgZGlzYyBvbiB0aGUgYmx1cnJlZCBtaXAKLy8gICAgICAgICAgICAgICAgICAgICBjaGFpbiksIHN0cm9uZyBvbiB0aGUgcGxhdGVhdSwgd2VhayBvbiB0aGUgcmltCi8vIDcuIHJlZmxlY3Rpb24gICAgIDogU2NobGljay1GcmVzbmVsIGVudmlyb25tZW50ICsgMiBzcGVjdWxhciBsb2JlcyBvbiB0aGUKLy8gICAgICAgICAgICAgICAgICAgICBiZXZlbCAtPiB0aGUgYnJpZ2h0IGdsYXNzIHJpbQovLyA4LiBzaGFkaW5nICAgICAgICA6IHNhdHVyYXRpb24gYm9vc3QgLyB0aW50IC8gc29mdCBjb250YWN0IHNoYWRvdwovLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0KY29uc3QgRlNfR0xBU1MgPSBgI3ZlcnNpb24gMzAwIGVzCnByZWNpc2lvbiBoaWdocCBmbG9hdDsKaW4gdmVjMiB2VVY7Cm91dCB2ZWM0IG91dENvbG9yOwoKdW5pZm9ybSBzYW1wbGVyMkQgdVNyYzsgICAgICAvLyBibHVycmVkIG1pcCBjaGFpbiBvZiB0aGUgYmFja2Ryb3AKdW5pZm9ybSBzYW1wbGVyMkQgdUJsdXJTcmM7ICAvLyB0ZW50LXVwc2FtcGxlZCByZWNvbnN0cnVjdGlvbiBjaGFpbgp1bmlmb3JtIHZlYzIgIHVSZXM7CnVuaWZvcm0gdmVjMiAgdUNlbnRlcjsgICAgICAgLy8gZHJhdy1ncm91cCBib3VuZHMgY2VudHJlLCBweCAodmVydGV4IHF1YWQgb25seSkKdW5pZm9ybSB2ZWMyICB1SGFsZjsgICAgICAgICAvLyBlbGVtZW50IGhhbGYgc2l6ZSwgcHgKY29uc3QgaW50IE1BWF9TSEFQRVMgPSAxNjsKdW5pZm9ybSBpbnQgICB1U2hhcGVDb3VudDsKdW5pZm9ybSB2ZWMyICB1U2hhcGVDZW50ZXJzW01BWF9TSEFQRVNdOwp1bmlmb3JtIHZlYzIgIHVTaGFwZUhhbHZlc1tNQVhfU0hBUEVTXTsKdW5pZm9ybSBpbnQgICB1U2hhcGVUeXBlc1tNQVhfU0hBUEVTXTsgLy8gMCBzcXVhcmUvcmVjdCwgMSBjYXBzdWxlLCAyIGNpcmNsZQp1bmlmb3JtIGZsb2F0IHVTaGFwZVJhZGlpW01BWF9TSEFQRVNdOwp1bmlmb3JtIGZsb2F0IHVNZXJnZVJhZGl1czsgIC8vIHNtb290aC11bmlvbiByZWFjaCwgcHgKdW5pZm9ybSBmbG9hdCB1U3F1aXJjbGU7ICAgICAvLyBzdXBlcmVsbGlwc2UgZXhwb25lbnQgKDIgPSBjaXJjdWxhciBjb3JuZXJzKQp1bmlmb3JtIGZsb2F0IHVCZXZlbDsgICAgICAgIC8vIG1heCB3aWR0aCBvZiB0aGUgcmVmcmFjdGluZyByaW0sIHB4CnVuaWZvcm0gZmxvYXQgdUhlaWdodDsgICAgICAgLy8gbWF4IGdsYXNzIGhlaWdodCAvIG9wdGljYWwgdGhpY2tuZXNzLCBweAp1bmlmb3JtIGZsb2F0IHVTaXplQWRhcHRhdGlvbjsvLyAwID0gYWJzb2x1dGUgbWF0ZXJpYWwgbGVuZ3RocywgMSA9IGZpdCBzbWFsbCBVSQp1bmlmb3JtIGZsb2F0IHVJT1I7CnVuaWZvcm0gZmxvYXQgdURpc3BlcnNpb247CnVuaWZvcm0gZmxvYXQgdUJsdXJQbGF0ZWF1OyAgLy8gYmx1ciByYWRpdXMgaW4gdGhlIG1pZGRsZSwgcHgKdW5pZm9ybSBmbG9hdCB1Qmx1clJpbTsgICAgICAvLyBibHVyIHJhZGl1cyBhdCB0aGUgcmltLCBweAp1bmlmb3JtIGZsb2F0IHVPcHRpY2FsRGVuc2l0eTsvLyBkYXJrLWRldGFpbCBwcmVzZXJ2YXRpb247IDAgPSBsaW5lYXIgcmFkaWFuY2UKdW5pZm9ybSBmbG9hdCB1TWlwczsgICAgICAgICAvLyBudW1iZXIgb2YgbGV2ZWxzIGluIHRoZSBibHVycmVkIGNoYWluCnVuaWZvcm0gZmxvYXQgdVNwZWN1bGFyOwp1bmlmb3JtIGZsb2F0IHVTcGVjUG93ZXI7CnVuaWZvcm0gZmxvYXQgdUhpZ2hsaWdodEFkYXB0Owp1bmlmb3JtIGZsb2F0IHVIaWdobGlnaHRXaWR0aDsKdW5pZm9ybSBmbG9hdCB1SGlnaGxpZ2h0U2hhcnBuZXNzOwp1bmlmb3JtIGZsb2F0IHVIaWdobGlnaHRCYXNlOwp1bmlmb3JtIGZsb2F0IHVGcmVzbmVsOwp1bmlmb3JtIGZsb2F0IHVTYXQ7CnVuaWZvcm0gZmxvYXQgdUJyaWdodDsKdW5pZm9ybSBmbG9hdCB1VGludEFtb3VudDsKdW5pZm9ybSB2ZWMzICB1VGludENvbG9yOwp1bmlmb3JtIGZsb2F0IHVUaW50QWRhcHQ7ICAgIC8vIGNvbnRlbnQtYXdhcmUgbGlnaHQvZGFyayBtYXRlcmlhbCBwb2xhcml0eQp1bmlmb3JtIGZsb2F0IHVTaGFkb3c7CnVuaWZvcm0gZmxvYXQgdVNoYWRvd1NpemU7CnVuaWZvcm0gZmxvYXQgdVNoYWRvd09mZnNldDsKdW5pZm9ybSB2ZWMyICB1TGlnaHREaXI7CnVuaWZvcm0gZmxvYXQgdUVkZ2VMaW5lOwp1bmlmb3JtIGZsb2F0IHVFZGdlV2lkdGg7CnVuaWZvcm0gZmxvYXQgdUVkZ2VEYXJrOwp1bmlmb3JtIGZsb2F0IHVSZWZyYWN0U2NhbGU7CnVuaWZvcm0gZmxvYXQgdU1lbmlzY3VzOyAgICAgLy8gMSA9IGNvbmNhdmUgbWVuaXNjdXMgcmltLCAwID0gY29udmV4IGxlbnMgcmltCnVuaWZvcm0gaW50ICAgdURlYnVnOyAgICAgICAgLy8gMCBmaW5hbCwgMSB0aGlja25lc3MsIDIgbm9ybWFscywgMyBkaXNwbGFjZW1lbnQKCmZsb2F0IHNkU3F1aXJjbGUodmVjMiBwLCB2ZWMyIGIsIGZsb2F0IHIsIGZsb2F0IG4pIHsKICB2ZWMyIHEgPSBhYnMocCkgLSBiICsgcjsKICB2ZWMyIG0gPSBtYXgocSwgMC4wKSArIDFlLTU7CiAgZmxvYXQgZSA9IHBvdyhwb3cobS54LCBuKSArIHBvdyhtLnksIG4pLCAxLjAgLyBuKTsKICByZXR1cm4gbWluKG1heChxLngsIHEueSksIDAuMCkgKyBlIC0gcjsKfQoKZmxvYXQgc2RQcmltaXRpdmUodmVjMiBwLCB2ZWMyIGhhbGZTaXplLCBpbnQgc2hhcGVUeXBlLCBmbG9hdCByYWRpdXMpIHsKICBpZiAoc2hhcGVUeXBlID09IDIpIHsKICAgIC8vIENpcmNsZSBpcyBpbnZhcmlhbnQ6IGxheW91dCBjYW5ub3QgdHVybiBpdCBpbnRvIGFuIGVsbGlwc2UuCiAgICByZXR1cm4gbGVuZ3RoKHApIC0gbWluKGhhbGZTaXplLngsIGhhbGZTaXplLnkpOwogIH0KICBpZiAoc2hhcGVUeXBlID09IDEpIHsKICAgIC8vIEFwcGxlJ3MgY2Fwc3VsZSBydWxlOiBlbmQtY2FwIHJhZGl1cyBpcyBleGFjdGx5IGhhbGYgdGhlIHNob3J0IHNpZGUuCiAgICByZXR1cm4gc2RTcXVpcmNsZShwLCBoYWxmU2l6ZSwgbWluKGhhbGZTaXplLngsIGhhbGZTaXplLnkpLCAyLjApOwogIH0KICAvLyBTcXVhcmUgYW5kIHJlY3Rhbmd1bGFyIGZvbGRlcnMgc2hhcmUgdGhlIHNhbWUgZml4ZWQtcmFkaXVzIGNvcm5lciBtb2RlbDsKICAvLyBvbmx5IHRoZWlyIGJvdW5kaW5nIGJveGVzIGRpZmZlci4gVGhlIGRlZmF1bHQgZXhwb25lbnQgaXMgMiBwZXIgcmVmZXJlbmNlLgogIHJldHVybiBzZFNxdWlyY2xlKHAsIGhhbGZTaXplLCByYWRpdXMsIG1heCh1U3F1aXJjbGUsIDIuMCkpOwp9CgovLyBPbmUgZGlzdGFuY2UgZmllbGQgcmVwcmVzZW50cyB0aGUgY29tcGxldGUgY29tcG9uZW50IGdyb3VwLiBCZWNhdXNlIHRoZQovLyBub3JtYWwgaXMgZGVyaXZlZCBmcm9tIHRoaXMgc2FtZSBmaWVsZCBiZWxvdywgdGhlIG1lbmlzY3VzLCByZWZyYWN0aW9uIGFuZAovLyBoaWdobGlnaHQgYmVuZCBjb250aW51b3VzbHkgdGhyb3VnaCB0aGUgYnJpZGdlIGluc3RlYWQgb2YgZXhwb3NpbmcgdHdvCi8vIGNvbXBvc2l0ZWQgZ2xhc3MgbGF5ZXJzLgpmbG9hdCBzZEFwcGxlU2hhcGUodmVjMiBweCkgewogIGZsb2F0IG5lYXJlc3QgPSAxZTg7CiAgZm9yIChpbnQgaSA9IDA7IGkgPCBNQVhfU0hBUEVTOyBpKyspIHsKICAgIGlmIChpID49IHVTaGFwZUNvdW50KSBicmVhazsKICAgIGZsb2F0IG5leHQgPSBzZFByaW1pdGl2ZShweCAtIHVTaGFwZUNlbnRlcnNbaV0sIHVTaGFwZUhhbHZlc1tpXSwKICAgICAgICAgICAgICAgICAgICAgICAgICAgICB1U2hhcGVUeXBlc1tpXSwgdVNoYXBlUmFkaWlbaV0pOwogICAgbmVhcmVzdCA9IG1pbihuZWFyZXN0LCBuZXh0KTsKICB9CgogIGlmICh1TWVyZ2VSYWRpdXMgPCAwLjAxKSByZXR1cm4gbmVhcmVzdDsKCiAgLy8gR2xvYmFsIGV4cG9uZW50aWFsIHNtb290aC1taW4gaXMgYXNzb2NpYXRpdmUgYW5kIEMtaW5maW5pdHkuIFBhaXJ3aXNlCiAgLy8gcG9seW5vbWlhbCB1bmlvbnMgYXJlIG9ubHkgQzEgYW5kIGJlY29tZSBvcmRlci1kZXBlbmRlbnQgd2l0aCAzKyBzaGFwZXM7CiAgLy8gdGhlaXIgY3VydmF0dXJlIGJvdW5kYXJpZXMgc2hvdyB1cCBhcyBkaWFnb25hbCB0ZWFycyB1bmRlciBzaGFycCBnbGFzcwogIC8vIGhpZ2hsaWdodHMuIDAuMzYgbWF0Y2hlcyB0aGUgcG9seW5vbWlhbCB1bmlvbidzIGRlcHRoIGF0IGVxdWFsIGRpc3RhbmNlcy4KICBmbG9hdCBzY2FsZSA9IG1heCh1TWVyZ2VSYWRpdXMgKiAwLjM2LCAwLjAxKTsKICBmbG9hdCBzdW0gPSAwLjA7CiAgZm9yIChpbnQgaSA9IDA7IGkgPCBNQVhfU0hBUEVTOyBpKyspIHsKICAgIGlmIChpID49IHVTaGFwZUNvdW50KSBicmVhazsKICAgIGZsb2F0IG5leHQgPSBzZFByaW1pdGl2ZShweCAtIHVTaGFwZUNlbnRlcnNbaV0sIHVTaGFwZUhhbHZlc1tpXSwKICAgICAgICAgICAgICAgICAgICAgICAgICAgICB1U2hhcGVUeXBlc1tpXSwgdVNoYXBlUmFkaWlbaV0pOwogICAgc3VtICs9IGV4cCgtKG5leHQgLSBuZWFyZXN0KSAvIHNjYWxlKTsKICB9CiAgcmV0dXJuIG5lYXJlc3QgLSBzY2FsZSAqIGxvZyhtYXgoc3VtLCAxZS02KSk7Cn0KCi8vIFF1aW50aWMgdGFuZ2VudCB0cmFuc2l0aW9uLiBCZXNpZGVzIHZhbHVlIGFuZCBzbG9wZSwgaXRzIHNlY29uZCBkZXJpdmF0aXZlCi8vIG1hdGNoZXMgYXQgYm90aCBlbmRzOiBmKDAvMSk9MC8xLCBmJygwLzEpPTAvMSwgZicnKDAvMSk9MC4gVGhpcyBsZXRzIGEKLy8gY2lyY3VsYXIgY29ybmVyIGxlYXZlIGEgc3RyYWlnaHQgc2lkZSB3aXRoIHplcm8gY3VydmF0dXJlIGluc3RlYWQgb2YgdGhlCi8vIHJvdW5kZWQtYm94IFNERidzIGFicnVwdCAwIC0+IDEvciBjdXJ2YXR1cmUganVtcC4KZmxvYXQgdGFuZ2VudFRyYW5zaXRpb24oZmxvYXQgdSkgewogIHJldHVybiB1ICogdSAqIHUgKiAoNi4wIC0gOC4wICogdSArIDMuMCAqIHUgKiB1KTsKfQoKdmVjMiBwcmltaXRpdmVPcHRpY2FsR3JhZGllbnQodmVjMiBwLCB2ZWMyIGhhbGZTaXplLAogICAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbnQgc2hhcGVUeXBlLCBmbG9hdCByYWRpdXMpIHsKICBpZiAoc2hhcGVUeXBlID09IDIpIHJldHVybiBub3JtYWxpemUocCArIDFlLTYpOwoKICBmbG9hdCBleHBvbmVudCA9IHNoYXBlVHlwZSA9PSAxID8gMi4wIDogbWF4KHVTcXVpcmNsZSwgMi4wKTsKICBmbG9hdCByZXNvbHZlZFJhZGl1cyA9IHNoYXBlVHlwZSA9PSAxCiAgICAgICAgICAgICAgICAgICAgICAgPyBtaW4oaGFsZlNpemUueCwgaGFsZlNpemUueSkgOiByYWRpdXM7CiAgdmVjMiBxID0gYWJzKHApIC0gaGFsZlNpemUgKyByZXNvbHZlZFJhZGl1czsKICB2ZWMyIGRpcmVjdGlvbjsKCiAgaWYgKHEueCA+IDAuMCAmJiBxLnkgPiAwLjApIHsKICAgIC8vIEFuYWx5dGljIExwLWNvcm5lciBub3JtYWwuIEV4cG9uZW50cyBhYm92ZSAyIGFscmVhZHkgYXBwcm9hY2ggdGhlIHNpZGUKICAgIC8vIHdpdGggemVybyBjdXJ2YXR1cmU7IGJsZW5kIG91dCB0aGUgY2lyY3VsYXItY29ybmVyIGNvcnJlY3Rpb24gYnkgbj0zLgogICAgdmVjMiBscCA9IG5vcm1hbGl6ZShwb3cocSwgdmVjMihleHBvbmVudCAtIDEuMCkpICsgMWUtNik7CiAgICBjb25zdCBmbG9hdCBIQUxGX1BJID0gMS41NzA3OTYzMjY3OTsKICAgIGNvbnN0IGZsb2F0IFRSQU5TSVRJT05fQU5HTEUgPSAwLjQzNjMzMjMxMjk5OyAvLyAyNSBkZWdyZWVzIGF0IGVhY2ggdGFuZ2VudAogICAgZmxvYXQgYW5nbGUgPSBhdGFuKHEueSwgcS54KTsKICAgIGZsb2F0IGVhc2VkQW5nbGUgPSBhbmdsZTsKICAgIGlmIChhbmdsZSA8IFRSQU5TSVRJT05fQU5HTEUpIHsKICAgICAgZWFzZWRBbmdsZSA9IFRSQU5TSVRJT05fQU5HTEUgKgogICAgICAgICAgICAgICAgICAgdGFuZ2VudFRyYW5zaXRpb24oYW5nbGUgLyBUUkFOU0lUSU9OX0FOR0xFKTsKICAgIH0gZWxzZSBpZiAoYW5nbGUgPiBIQUxGX1BJIC0gVFJBTlNJVElPTl9BTkdMRSkgewogICAgICBmbG9hdCBmcm9tVG9wID0gKEhBTEZfUEkgLSBhbmdsZSkgLyBUUkFOU0lUSU9OX0FOR0xFOwogICAgICBlYXNlZEFuZ2xlID0gSEFMRl9QSSAtIFRSQU5TSVRJT05fQU5HTEUgKgogICAgICAgICAgICAgICAgICAgdGFuZ2VudFRyYW5zaXRpb24oZnJvbVRvcCk7CiAgICB9CiAgICB2ZWMyIGNvbnRpbnVvdXNDb3JuZXIgPSB2ZWMyKGNvcyhlYXNlZEFuZ2xlKSwgc2luKGVhc2VkQW5nbGUpKTsKICAgIGZsb2F0IGNpcmN1bGFyQ29ybmVyID0gMS4wIC0gc21vb3Roc3RlcCgyLjAsIDMuMCwgZXhwb25lbnQpOwogICAgZGlyZWN0aW9uID0gbm9ybWFsaXplKG1peChscCwgY29udGludW91c0Nvcm5lciwgY2lyY3VsYXJDb3JuZXIpKTsKICB9IGVsc2UgaWYgKHEueCA+IHEueSkgewogICAgZGlyZWN0aW9uID0gdmVjMigxLjAsIDAuMCk7CiAgfSBlbHNlIHsKICAgIGRpcmVjdGlvbiA9IHZlYzIoMC4wLCAxLjApOwogIH0KCiAgcmV0dXJuIGRpcmVjdGlvbiAqIHNpZ24ocCk7Cn0KCnZlYzIgb3B0aWNhbEdyYWRpZW50KHZlYzIgcHgpIHsKICBmbG9hdCBuZWFyZXN0ID0gMWU4OwogIGludCBuZWFyZXN0SW5kZXggPSAwOwogIGZvciAoaW50IGkgPSAwOyBpIDwgTUFYX1NIQVBFUzsgaSsrKSB7CiAgICBpZiAoaSA+PSB1U2hhcGVDb3VudCkgYnJlYWs7CiAgICBmbG9hdCBuZXh0ID0gc2RQcmltaXRpdmUocHggLSB1U2hhcGVDZW50ZXJzW2ldLCB1U2hhcGVIYWx2ZXNbaV0sCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdVNoYXBlVHlwZXNbaV0sIHVTaGFwZVJhZGlpW2ldKTsKICAgIGlmIChuZXh0IDwgbmVhcmVzdCkgewogICAgICBuZWFyZXN0ID0gbmV4dDsKICAgICAgbmVhcmVzdEluZGV4ID0gaTsKICAgIH0KICB9CgogIGlmICh1TWVyZ2VSYWRpdXMgPCAwLjAxIHx8IHVTaGFwZUNvdW50ID09IDEpIHsKICAgIHJldHVybiBwcmltaXRpdmVPcHRpY2FsR3JhZGllbnQoCiAgICAgIHB4IC0gdVNoYXBlQ2VudGVyc1tuZWFyZXN0SW5kZXhdLCB1U2hhcGVIYWx2ZXNbbmVhcmVzdEluZGV4XSwKICAgICAgdVNoYXBlVHlwZXNbbmVhcmVzdEluZGV4XSwgdVNoYXBlUmFkaWlbbmVhcmVzdEluZGV4XQogICAgKTsKICB9CgogIC8vIFRoZSBkZXJpdmF0aXZlIG9mIGV4cG9uZW50aWFsIHNtb290aC1taW4gaXMgdGhlIHNhbWUgd2VpZ2h0ZWQgYXZlcmFnZSBvZgogIC8vIHRoZSBwcmltaXRpdmUgZGVyaXZhdGl2ZXMuIFJldXNpbmcgdGhvc2Ugd2VpZ2h0cyBrZWVwcyBmdXNlZCBub3JtYWxzIEMyCiAgLy8gdGhyb3VnaCBib3RoIGEgcHJpbWl0aXZlJ3MgdGFuZ2VudCBhbmQgdGhlIHVuaW9uIGJyaWRnZS4KICBmbG9hdCBzY2FsZSA9IG1heCh1TWVyZ2VSYWRpdXMgKiAwLjM2LCAwLjAxKTsKICB2ZWMyIGdyYWRpZW50U3VtID0gdmVjMigwLjApOwogIGZsb2F0IHdlaWdodFN1bSA9IDAuMDsKICBmb3IgKGludCBpID0gMDsgaSA8IE1BWF9TSEFQRVM7IGkrKykgewogICAgaWYgKGkgPj0gdVNoYXBlQ291bnQpIGJyZWFrOwogICAgdmVjMiBsb2NhbCA9IHB4IC0gdVNoYXBlQ2VudGVyc1tpXTsKICAgIGZsb2F0IG5leHQgPSBzZFByaW1pdGl2ZShsb2NhbCwgdVNoYXBlSGFsdmVzW2ldLAogICAgICAgICAgICAgICAgICAgICAgICAgICAgIHVTaGFwZVR5cGVzW2ldLCB1U2hhcGVSYWRpaVtpXSk7CiAgICBmbG9hdCB3ZWlnaHQgPSBleHAoLShuZXh0IC0gbmVhcmVzdCkgLyBzY2FsZSk7CiAgICBncmFkaWVudFN1bSArPSBwcmltaXRpdmVPcHRpY2FsR3JhZGllbnQoCiAgICAgIGxvY2FsLCB1U2hhcGVIYWx2ZXNbaV0sIHVTaGFwZVR5cGVzW2ldLCB1U2hhcGVSYWRpaVtpXQogICAgKSAqIHdlaWdodDsKICAgIHdlaWdodFN1bSArPSB3ZWlnaHQ7CiAgfQogIHJldHVybiBncmFkaWVudFN1bSAvIG1heCh3ZWlnaHRTdW0sIDFlLTYpOwp9CgovLyBTaGFkaW5nIGFkYXB0YXRpb24gYmVsb25ncyB0byB0aGUgcHJpbWl0aXZlIHVuZGVyIHRoaXMgZnJhZ21lbnQsIG5vdCB0byB0aGUKLy8gYm91bmRzIG9mIHRoZSB3aG9sZSBkcmF3IGdyb3VwLiBUaGUgbGF0dGVyIGNoYW5nZXMgd2hlbmV2ZXIgYW55IGNvbXBvbmVudCBpbgovLyBhIGNvbm5lY3RlZCBmdXNpb24gZ3JvdXAgbW92ZXMsIG1ha2luZyBldmVyeSBoaWdobGlnaHQgcHVsc2UgaW4gc3ltcGF0aHkuCi8vCi8vIEFyb3VuZCBhIGdlbnVpbmUgc21vb3RoLXVuaW9uIGJyaWRnZSwgdXNlIHRoZSBzYW1lIGV4cG9uZW50aWFsIGluZmx1ZW5jZSBhcwovLyB0aGUgZGlzdGFuY2UgZmllbGQgc28gdGhlIG1hdGVyaWFsIGNlbnRyZSBjcm9zc2VzIGNvbnRpbnVvdXNseSBmcm9tIG9uZQovLyBwcmltaXRpdmUgdG8gdGhlIG5leHQuIENvbnRyaWJ1dGlvbnMgdG9vIHdlYWsgdG8gYWZmZWN0IHRoZSB2aXNpYmxlIGJyaWRnZQovLyBhcmUgc21vb3RobHkgZGlzY2FyZGVkOyBhIG5lYXJieS1idXQtc2VwYXJhdGUgY29tcG9uZW50IHRoZW4gaGFzIGV4YWN0bHkgbm8KLy8gaW5mbHVlbmNlIG9uIHRoaXMgY29tcG9uZW50J3MgaGlnaGxpZ2h0IG9yIGxpZ2h0L2RhcmsgdGludC4Kdm9pZCBsb2NhbENvbXBvbmVudE1ldHJpY3ModmVjMiBweCwgb3V0IHZlYzIgY29tcG9uZW50Q2VudGVyLAogICAgICAgICAgICAgICAgICAgICAgICAgICBvdXQgZmxvYXQgY29tcG9uZW50U2hvcnRTaWRlKSB7CiAgZmxvYXQgbmVhcmVzdCA9IDFlODsKICB2ZWMyIG5lYXJlc3RDZW50ZXIgPSB1U2hhcGVDZW50ZXJzWzBdOwogIGZsb2F0IG5lYXJlc3RTaG9ydFNpZGUgPSAxLjA7CiAgZm9yIChpbnQgaSA9IDA7IGkgPCBNQVhfU0hBUEVTOyBpKyspIHsKICAgIGlmIChpID49IHVTaGFwZUNvdW50KSBicmVhazsKICAgIGZsb2F0IG5leHQgPSBzZFByaW1pdGl2ZShweCAtIHVTaGFwZUNlbnRlcnNbaV0sIHVTaGFwZUhhbHZlc1tpXSwKICAgICAgICAgICAgICAgICAgICAgICAgICAgICB1U2hhcGVUeXBlc1tpXSwgdVNoYXBlUmFkaWlbaV0pOwogICAgaWYgKG5leHQgPCBuZWFyZXN0KSB7CiAgICAgIG5lYXJlc3QgPSBuZXh0OwogICAgICBuZWFyZXN0Q2VudGVyID0gdVNoYXBlQ2VudGVyc1tpXTsKICAgICAgbmVhcmVzdFNob3J0U2lkZSA9IDIuMCAqIG1pbih1U2hhcGVIYWx2ZXNbaV0ueCwgdVNoYXBlSGFsdmVzW2ldLnkpOwogICAgfQogIH0KCiAgY29tcG9uZW50Q2VudGVyID0gbmVhcmVzdENlbnRlcjsKICBjb21wb25lbnRTaG9ydFNpZGUgPSBuZWFyZXN0U2hvcnRTaWRlOwogIGlmICh1TWVyZ2VSYWRpdXMgPCAwLjAxIHx8IHVTaGFwZUNvdW50ID09IDEpIHJldHVybjsKCiAgZmxvYXQgc2NhbGUgPSBtYXgodU1lcmdlUmFkaXVzICogMC4zNiwgMC4wMSk7CiAgdmVjMiBjZW50cmVTdW0gPSB2ZWMyKDAuMCk7CiAgZmxvYXQgc2hvcnRTaWRlU3VtID0gMC4wOwogIGZsb2F0IHdlaWdodFN1bSA9IDAuMDsKICBmb3IgKGludCBpID0gMDsgaSA8IE1BWF9TSEFQRVM7IGkrKykgewogICAgaWYgKGkgPj0gdVNoYXBlQ291bnQpIGJyZWFrOwogICAgZmxvYXQgbmV4dCA9IHNkUHJpbWl0aXZlKHB4IC0gdVNoYXBlQ2VudGVyc1tpXSwgdVNoYXBlSGFsdmVzW2ldLAogICAgICAgICAgICAgICAgICAgICAgICAgICAgIHVTaGFwZVR5cGVzW2ldLCB1U2hhcGVSYWRpaVtpXSk7CiAgICBmbG9hdCB3ZWlnaHQgPSBleHAoLShuZXh0IC0gbmVhcmVzdCkgLyBzY2FsZSk7CiAgICB3ZWlnaHQgKj0gc21vb3Roc3RlcCgwLjA0LCAwLjIwLCB3ZWlnaHQpOwogICAgY2VudHJlU3VtICs9IHVTaGFwZUNlbnRlcnNbaV0gKiB3ZWlnaHQ7CiAgICBzaG9ydFNpZGVTdW0gKz0gMi4wICogbWluKHVTaGFwZUhhbHZlc1tpXS54LCB1U2hhcGVIYWx2ZXNbaV0ueSkgKiB3ZWlnaHQ7CiAgICB3ZWlnaHRTdW0gKz0gd2VpZ2h0OwogIH0KICBpZiAod2VpZ2h0U3VtID4gMC4wKSB7CiAgICBjb21wb25lbnRDZW50ZXIgPSBjZW50cmVTdW0gLyB3ZWlnaHRTdW07CiAgICBjb21wb25lbnRTaG9ydFNpZGUgPSBzaG9ydFNpZGVTdW0gLyB3ZWlnaHRTdW07CiAgfQp9Cgp2ZWM0IHNhbXBsZUJnKHZlYzIgcHgsIGZsb2F0IGxvZCkgewogIHZlYzIgdXYgPSBjbGFtcChweCAvIHVSZXMsIHZlYzIoMC4wMDEpLCB2ZWMyKDAuOTk5KSk7CiAgcmV0dXJuIHRleHR1cmVMb2QodVNyYywgdXYsIGxvZCk7Cn0KCnZlYzQgc2FtcGxlUmVjb25zdHJ1Y3RlZEJnKHZlYzIgcHgsIGZsb2F0IGxvZCkgewogIHZlYzIgdXYgPSBjbGFtcChweCAvIHVSZXMsIHZlYzIoMC4wMDEpLCB2ZWMyKDAuOTk5KSk7CiAgcmV0dXJuIHRleHR1cmVMb2QodUJsdXJTcmMsIHV2LCBsb2QpOwp9CgpmbG9hdCBsdW1pbmFuY2UodmVjMyBjKSB7CiAgcmV0dXJuIGRvdChjLCB2ZWMzKDAuMjEyNiwgMC43MTUyLCAwLjA3MjIpKTsKfQoKZmxvYXQgaGFzaDEyKHZlYzIgcCkgewogIHZlYzMgcDMgPSBmcmFjdCh2ZWMzKHAueHl4KSAqIDAuMTAzMSk7CiAgcDMgKz0gZG90KHAzLCBwMy55enggKyAzMy4zMyk7CiAgcmV0dXJuIGZyYWN0KChwMy54ICsgcDMueSkgKiBwMy56KTsKfQoKdmVjMyBsaW5lYXJUb1NyZ2IodmVjMyBjKSB7CiAgYyA9IG1heChjLCAwLjApOwogIHJldHVybiBtaXgoMS4wNTUgKiBwb3coYywgdmVjMygxLjAgLyAyLjQpKSAtIDAuMDU1LAogICAgICAgICAgICAgMTIuOTIgKiBjLAogICAgICAgICAgICAgbGVzc1RoYW5FcXVhbChjLCB2ZWMzKDAuMDAzMTMwOCkpKTsKfQoKdmVjMiBzb2Z0TGltaXRPZmZzZXQodmVjMiBvZmZzZXQsIGZsb2F0IGxpbWl0KSB7CiAgZmxvYXQgbWFnbml0dWRlID0gbGVuZ3RoKG9mZnNldCk7CiAgaWYgKG1hZ25pdHVkZSA8IDFlLTQpIHJldHVybiBvZmZzZXQ7CiAgZmxvYXQgbGltaXRlZCA9IHRhbmgobWFnbml0dWRlIC8gbWF4KGxpbWl0LCAxLjApKSAqIGxpbWl0OwogIHJldHVybiBvZmZzZXQgKiAobGltaXRlZCAvIG1hZ25pdHVkZSk7Cn0KCi8vIFZhcmlhYmxlLXJhZGl1cyBibHVyLCByYWRpdXMgaW4gZGV2aWNlIHB4LgovLwovLyBBIHNpbmdsZSB0ZXh0dXJlTG9kKCkgdGFwIG9uIHRoZSBtaXAgY2hhaW4gaXMgbm90IGVub3VnaC4gVGhlIGNoYWluIG9ubHkKLy8gb2ZmZXJzIHJhZGlpIGluIHBvd2VycyBvZiB0d28sIGFuZCBvbiB0aGUgdG9wIGxldmVscyBvbmUgdGV4ZWwgaXMgdGVucyBvZgovLyBwaXhlbHMgd2lkZSwgc28gYSBsb25lIGJpbGluZWFyIHRhcCAoYSkgYXZlcmFnZXMgaW4gYSBodWdlIHNsYWIgb2YgdGhlCi8vIHNjcmVlbiwgd2hpY2ggZHJhZ3MgdGhlIGNvbG91ciB0b3dhcmQgdGhlIGZyYW1lIG1lYW4gLT4gd2FzaGVkIG91dCwgYW5kCi8vIChiKSByZWNvbnN0cnVjdHMgYXMgYSBoYW5kZnVsIG9mIGJpZyBkaWFtb25kcyAtPiB0aGUgInRvbyBmZXcgc2FtcGxlcyIgbXVzaC4KLy8gSW5zdGVhZCB0YWtlIHRoZSBsZXZlbCB3aG9zZSBvd24gcmFkaXVzIGlzIGFib3V0IGEgdGhpcmQgb2Ygd2hhdCB3ZSB3YW50IGFuZAovLyBzcHJlYWQgVEFQUyBzYW1wbGVzIG92ZXIgdGhlIHJlbWFpbmRlciBvbiBhIGdvbGRlbi1hbmdsZSBzcGlyYWwuIE5laWdoYm91cmluZwovLyB0YXBzIHRoZW4gbGFuZCByb3VnaGx5IG9uZSB0ZXhlbCBhcGFydCBhdCB0aGF0IGxldmVsLCB3aGljaCBpcyBleGFjdGx5IHRoZQovLyBzcGFjaW5nIGF0IHdoaWNoIHRoZSBsZXZlbCdzIG93biBmaWx0ZXJpbmcgbWFrZXMgdGhlIGRpc2MgY29udGludW91cywgc28gdGhlCi8vIHJlc3VsdCBpcyBhIHJlYWwgd2lkZSBHYXVzc2lhbiB0aGF0IGtlZXBzIGl0cyBsb2NhbCBjb2xvdXIuCmNvbnN0IGludCBUQVBTID0gMTI7CmNvbnN0IGZsb2F0IEdPTERFTl9BTkdMRSA9IDIuMzk5OTYzMjM7Cgp2ZWMzIGJsdXJCZyh2ZWMyIHB4LCBmbG9hdCByYWRpdXMpIHsKICBpZiAocmFkaXVzIDwgMS4wKSByZXR1cm4gc2FtcGxlQmcocHgsIDAuMCkucmdiOwogIGZsb2F0IGxvZCA9IGNsYW1wKGxvZzIocmFkaXVzKSAtIDEuNTg1LCAwLjAsIHVNaXBzIC0gMS4wKTsgICAvLyAyXmxvZCB+IHIvMwogIHZlYzMgYWNjID0gdmVjMygwLjApOwogIGZsb2F0IGRlbnNpdHlBY2MgPSAwLjA7CiAgZmxvYXQgd3N1bSA9IDAuMDsKICBmb3IgKGludCBpID0gMDsgaSA8IFRBUFM7IGkrKykgewogICAgZmxvYXQgZmkgPSBmbG9hdChpKSArIDAuNTsKICAgIGZsb2F0IHIgID0gc3FydChmaSAvIGZsb2F0KFRBUFMpKTsgICAgICAgLy8gZXF1YWwtYXJlYSBzcGFjaW5nIG92ZXIgdGhlIGRpc2MKICAgIGZsb2F0IGEgID0gZmkgKiBHT0xERU5fQU5HTEU7CiAgICBmbG9hdCB3ICA9IGV4cCgtMS44ICogciAqIHIpOwogICAgdmVjMiBzYW1wbGVQeCA9IHB4ICsgdmVjMihjb3MoYSksIHNpbihhKSkgKiByICogcmFkaXVzOwogICAgLy8gS2VlcCBuYXJyb3cgYmx1ciBmYWl0aGZ1bCB0byB0aGUgb3JpZ2luYWwgZG93bnNhbXBsZSBjaGFpbiwgdGhlbiBsZWFuIG9uCiAgICAvLyB0aGUgcmVjb25zdHJ1Y3RlZCBjaGFpbiB3aGVyZSBjb2Fyc2UgbWlwIGJsb2NrcyBhbmQgdGVtcG9yYWwgYnJlYXRoaW5nCiAgICAvLyBiZWNvbWUgdmlzaWJsZS4gQm90aCBzYW1wbGVycyByZXR1cm4gbGluZWFyIHJhZGlhbmNlIGZyb20gc1JHQiB0ZXh0dXJlcy4KICAgIGZsb2F0IHJlY29uc3RydWN0aW9uID0gMC43OCAqIHNtb290aHN0ZXAoMTAuMCwgNTIuMCwgcmFkaXVzKTsKICAgIHZlYzQgcyA9IG1peChzYW1wbGVCZyhzYW1wbGVQeCwgbG9kKSwKICAgICAgICAgICAgICAgICBzYW1wbGVSZWNvbnN0cnVjdGVkQmcoc2FtcGxlUHgsIGxvZCksIHJlY29uc3RydWN0aW9uKTsKICAgIGFjYyArPSBzLnJnYiAqIHc7CiAgICBkZW5zaXR5QWNjICs9IHMuYSAqIHc7CiAgICB3c3VtICs9IHc7CiAgfQogIHZlYzMgbGluZWFyQ29sID0gYWNjIC8gd3N1bTsKCiAgLy8gQSBwdXJlIHJhZGlhbmNlIGF2ZXJhZ2Ugc3ByZWFkcyBhIGRhcmsgYnJhbmNoIGJ1dCBhbHNvIGRpbHV0ZXMgaXQgdG93YXJkCiAgLy8gdGhlIHBhbGUgc2t5LiBUaGUgZGVuc2l0eSBjaGFubmVsIGF2ZXJhZ2VzIC1sb2cobHVtaW5hbmNlKSwgZXF1aXZhbGVudCB0bwogIC8vIGdlb21ldHJpY2FsbHkgYXZlcmFnaW5nIHRyYW5zbWlzc2lvbi4gVGhhdCBwcmVzZXJ2ZXMgdGhlIHZpc3VhbCB3ZWlnaHQgb2YKICAvLyBkYXJrIG9jY2x1ZGVycyB3aGlsZSBrZWVwaW5nIHVuaWZvcm0gbGlnaHQgcmVnaW9ucyB1bmNoYW5nZWQuIFdlIHJldGFpbgogIC8vIHRoZSBsaW5lYXIgUkdCIGh1ZSBhbmQgb25seSByZXN0b3JlIHRoZSBtaXNzaW5nIGx1bWluYW5jZSBjb250cmFzdC4KICBmbG9hdCBsaW5lYXJMdW0gPSBtYXgoZG90KGxpbmVhckNvbCwgdmVjMygwLjIxMjYsIDAuNzE1MiwgMC4wNzIyKSksIDAuMDAxKTsKICBmbG9hdCBkZW5zaXR5THVtID0gZXhwKC00LjAgKiBkZW5zaXR5QWNjIC8gd3N1bSk7CiAgZmxvYXQgZGVuc2l0eUdhcCA9IG1heChsaW5lYXJMdW0gLSBkZW5zaXR5THVtLCAwLjApOwogIGZsb2F0IHJhZGl1c0dhdGUgPSBzbW9vdGhzdGVwKDEuMCwgOC4wLCByYWRpdXMpOwogIGZsb2F0IHRhcmdldEx1bSA9IG1heChsaW5lYXJMdW0gKiAwLjIyLAogICAgICAgICAgICAgICAgICAgICAgICBsaW5lYXJMdW0gLSBkZW5zaXR5R2FwICogdU9wdGljYWxEZW5zaXR5ICogcmFkaXVzR2F0ZSk7CiAgcmV0dXJuIGxpbmVhckNvbCAqICh0YXJnZXRMdW0gLyBsaW5lYXJMdW0pOwp9Cgp2b2lkIG1haW4oKSB7CiAgdmVjMiBweCA9IHZVViAqIHVSZXM7CgogIGZsb2F0IGQgPSBzZEFwcGxlU2hhcGUocHgpOwogIGZsb2F0IGFhID0gc21vb3Roc3RlcCgwLjgsIC0wLjgsIGQpOwogIHZlYzIgYWRhcHRDZW50ZXI7CiAgZmxvYXQgbG9jYWxTaG9ydFNpZGU7CiAgbG9jYWxDb21wb25lbnRNZXRyaWNzKHB4LCBhZGFwdENlbnRlciwgbG9jYWxTaG9ydFNpZGUpOwogIC8vIE1hdGVyaWFsIGxlbmd0aHMgYXJlIGF1dGhvcmVkIGFnYWluc3QgdGhlIGxhcmdlIGRlbW8gY29tcG9uZW50cy4gVHJlYXQKICAvLyB0aGVtIGFzIG1heGltYSBhbmQgZml0IHRoZSBjb21wbGV0ZSBvcHRpY2FsIHN5c3RlbSB0byAzMCUgb2YgYSBzbWFsbGVyCiAgLy8gcHJpbWl0aXZlJ3Mgc2hvcnQgc2lkZS4gVGhlIHNoYXJlZCBtZXRyaWMgY2FsbCBhYm92ZSBhbHNvIGtlZXBzIHRoaXMgc2NhbGUKICAvLyBjb250aW51b3VzIHdoZW4gZGlmZmVyZW50bHkgc2l6ZWQgcHJpbWl0aXZlcyBmb3JtIG9uZSBmdXNlZCBzdXJmYWNlLgogIGZsb2F0IGZpdHRlZFNjYWxlID0gY2xhbXAoMC4zMCAqIGxvY2FsU2hvcnRTaWRlIC8gbWF4KHVCZXZlbCwgMS4wKSwgMC4wNSwgMS4wKTsKICBmbG9hdCBvcHRpY2FsU2NhbGUgPSBtaXgoMS4wLCBmaXR0ZWRTY2FsZSwKICAgICAgICAgICAgICAgICAgICAgICAgICAgY2xhbXAodVNpemVBZGFwdGF0aW9uLCAwLjAsIDEuMCkpOwogIGZsb2F0IGJldmVsID0gbWF4KHVCZXZlbCAqIG9wdGljYWxTY2FsZSwgMS4wKTsKICBmbG9hdCBvcHRpY2FsSGVpZ2h0ID0gdUhlaWdodCAqIG9wdGljYWxTY2FsZTsKCiAgLy8gLS0tLSBncmFkaWVudCBvZiB0aGUgU0RGID0gb3V0d2FyZCBkaXJlY3Rpb24gb2YgdGhlIHN1cmZhY2UgLS0tLS0tLS0tLS0tLQogIHZlYzIgZyA9IG5vcm1hbGl6ZShvcHRpY2FsR3JhZGllbnQocHgpICsgMWUtNik7CgogIC8vIC0tLS0gdGhpY2tuZXNzIGZpZWxkIC8gYmV2ZWwgcHJvZmlsZSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQogIGZsb2F0IHQgID0gY2xhbXAoLWQgLyBiZXZlbCwgMC4wLCAxLjApOyAgICAvLyAwIGF0IHRoZSBlZGdlLCAxIG9uIHRoZSBwbGF0ZWF1CiAgZmxvYXQgY3QgPSAxLjAgLSB0OwogIGZsb2F0IGggID0gc3FydChtYXgoMS4wIC0gY3QgKiBjdCwgMC4wKSk7ICAvLyBjb252ZXggKGNpcmN1bGFyKSBiZXZlbAogIGZsb2F0IGRoZHQgPSBjdCAvIG1heChoLCAwLjEwKTsgICAgICAgICAgICAvLyBzbG9wZSwgY2xhbXBlZCBhdCB0aGUgc2lsaG91ZXR0ZQogIGZsb2F0IHNsb3BlID0gKG9wdGljYWxIZWlnaHQgLyBiZXZlbCkgKiBkaGR0OwoKICAvLyAwID0gY29udmV4IGxlbnMsIDEgPSB0aGUgZGVmYXVsdCBBcHBsZS1saWtlIGNvbmNhdmUgcmltLiBWYWx1ZXMgYWJvdmUgMQogIC8vIGRlbGliZXJhdGVseSBleGFnZ2VyYXRlIHRoZSBpbndhcmQgbm9ybWFsIGZvciBleHBsb3JhdG9yeSB0dW5pbmcuCiAgZmxvYXQgY3VydmVTaWduID0gMS4wIC0gMi4wICogdU1lbmlzY3VzOwogIHZlYzMgbiA9IG5vcm1hbGl6ZSh2ZWMzKGN1cnZlU2lnbiAqIGcgKiBzbG9wZSwgMS4wKSk7CiAgdmVjMyBJID0gdmVjMygwLjAsIDAuMCwgLTEuMCk7CgogIC8vIC0tLS0gcmVmcmFjdGlvbiAoU25lbGwpICsgZGlzcGVyc2lvbiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLQogIGZsb2F0IHBhdGggPSBvcHRpY2FsSGVpZ2h0ICogbWl4KDAuMjUsIDEuMCwgaCkgKiB1UmVmcmFjdFNjYWxlOwogIHZlYzIgZFIsIGRHLCBkQjsKICB7CiAgICBmbG9hdCBlID0gMS4wIC8gbWF4KHVJT1IgLSB1RGlzcGVyc2lvbiwgMS4wKTsKICAgIHZlYzMgUiA9IHJlZnJhY3QoSSwgbiwgZSk7CiAgICBkUiA9IChSID09IHZlYzMoMC4wKSkgPyB2ZWMyKDAuMCkgOiBSLnh5IC8gbWF4KC1SLnosIDAuMjUpICogcGF0aDsKICAgIGUgPSAxLjAgLyBtYXgodUlPUiwgMS4wKTsKICAgIFIgPSByZWZyYWN0KEksIG4sIGUpOwogICAgZEcgPSAoUiA9PSB2ZWMzKDAuMCkpID8gdmVjMigwLjApIDogUi54eSAvIG1heCgtUi56LCAwLjI1KSAqIHBhdGg7CiAgICBlID0gMS4wIC8gbWF4KHVJT1IgKyB1RGlzcGVyc2lvbiwgMS4wKTsKICAgIFIgPSByZWZyYWN0KEksIG4sIGUpOwogICAgZEIgPSAoUiA9PSB2ZWMzKDAuMCkpID8gdmVjMigwLjApIDogUi54eSAvIG1heCgtUi56LCAwLjI1KSAqIHBhdGg7CiAgfQoKICAvLyBTdHJvbmcgY29uY2F2ZSBtZW5pc2N1cyBub3JtYWxzIGNhbiBtYWtlIHRoZSBzY3JlZW4tc3BhY2UgbWFwcGluZyBmb2xkCiAgLy8gb3ZlciBpdHNlbGYgYXQgbXVsdGktc2hhcGUganVuY3Rpb25zLiBPbiBoYXJkLWVkZ2VkIHdhbGxwYXBlcnMgdGhhdCByZWFkcwogIC8vIGFzIHRyaWFuZ3VsYXIgdGVhcmluZyByYXRoZXIgdGhhbiByZWZyYWN0aW9uLiBDb21wcmVzcyBvbmx5IHRoZSBleHRyZW1lCiAgLy8gdGFpbDsgb3JkaW5hcnkgb2Zmc2V0cyByZW1haW4gYWxtb3N0IGxpbmVhciB3aGlsZSBjYXVzdGljIHNwaWtlcyBzdGF5CiAgLy8gd2l0aGluIGEgYmV2ZWwtc2l6ZWQgb3B0aWNhbCBmb290cHJpbnQuCiAgZmxvYXQgbWF4RGlzcGxhY2VtZW50ID0gbWF4KDEuMTUgKiBiZXZlbCwgbWF4KDEyLjAgKiBvcHRpY2FsU2NhbGUsIDMuMCkpOwogIGRSID0gc29mdExpbWl0T2Zmc2V0KGRSLCBtYXhEaXNwbGFjZW1lbnQpOwogIGRHID0gc29mdExpbWl0T2Zmc2V0KGRHLCBtYXhEaXNwbGFjZW1lbnQpOwogIGRCID0gc29mdExpbWl0T2Zmc2V0KGRCLCBtYXhEaXNwbGFjZW1lbnQpOwoKICAvLyAtLS0tIHNjYXR0ZXJpbmc6IHJpbSBzdGF5cyByZWFkYWJsZSwgcGxhdGVhdSBpcyBmcm9zdGVkIC0tLS0tLS0tLS0tLS0tLS0KICBmbG9hdCByYWRpdXMgPSBtaXgodUJsdXJSaW0sIHVCbHVyUGxhdGVhdSwgc21vb3Roc3RlcCgwLjAsIDAuODUsIHQpKQogICAgICAgICAgICAgICAqIG9wdGljYWxTY2FsZTsKCiAgdmVjMyBjb2w7CiAgY29sLnIgPSBibHVyQmcocHggKyBkUiwgcmFkaXVzKS5yOwogIGNvbC5nID0gYmx1ckJnKHB4ICsgZEcsIHJhZGl1cykuZzsKICBjb2wuYiA9IGJsdXJCZyhweCArIGRCLCByYWRpdXMpLmI7CgogIC8vIFNhdHVyYXRpb24gaXMgYm9vc3RlZCBvbiB0aGUgVFJBTlNNSVRURUQgYmFja2Ryb3Agb25seSAodGhpcyBpcyB3aGF0CiAgLy8gVUlWaXN1YWxFZmZlY3RWaWV3J3Mgc2F0dXJhdGlvbkRlbHRhRmFjdG9yIGRvZXMpLiBBbnkgd2lkZSBibHVyIGF2ZXJhZ2VzCiAgLy8gY29sb3VycyB0b3dhcmQgZ3JleTsgd2l0aG91dCB0aGlzIHRoZSBmcm9zdGVkIHBhbmVsIHJlYWRzIHBhbGUgZXZlbiB0aG91Z2gKICAvLyB0aGUgd2FsbHBhcGVyIGJlaGluZCBpdCBpcyBzYXR1cmF0ZWQuIERvaW5nIGl0IGJlZm9yZSB0aGUgcmVmbGVjdGlvbnMga2VlcHMKICAvLyB0aGUgc3BlY3VsYXIvRnJlc25lbCBoaWdobGlnaHRzIG5ldXRyYWwuCiAgY29sID0gbWl4KHZlYzMoZG90KGNvbCwgdmVjMygwLjIxMjYsIDAuNzE1MiwgMC4wNzIyKSkpLCBjb2wsIHVTYXQpOwoKICAvLyAtLS0tIHJlZmxlY3Rpb246IGJhY2tkcm9wIGVudmlyb25tZW50ICsgbmFycm93IHNwZWN1bGFyIGxvYmVzIC0tLS0tLS0tLS0tCiAgLy8gU2NobGljazogRjAgZm9yIGdsYXNzIGlzIH40JSwgYW5kIHRoZSAoMS1jb3MpXjUgZmFsbG9mZiBrZWVwcyB0aGUgbWlycm9yCiAgLy8gdGVybSBjb25maW5lZCB0byB0aGUgc3RlZXBlc3QgcGFydCBvZiB0aGUgYmV2ZWwuIEEgc29mdGVyIGV4cG9uZW50IHNtZWFycwogIC8vIGEgZ3JleSB3YXNoIGFjcm9zcyB0aGUgd2hvbGUgcmltIGFuZCBibGVhY2hlcyB0aGUgcmVmcmFjdGVkIGltYWdlIHRoZXJlLgogIGZsb2F0IGZyZXMgPSAwLjA0ICsgMC45NiAqIHBvdygxLjAgLSBuLnosIDUuMCk7CiAgdmVjMiBubiA9IG5vcm1hbGl6ZShuLnh5ICsgMWUtNik7CgogIC8vIEtlZXAgdGhlIHJlZmxlY3RlZCBlbnZpcm9ubWVudCBsb2NhbCB0byB0aGUgZnJhZ21lbnQuIFN0YWJpbGlzZSB0aGUgbG9iZQogIC8vIGNvbnRyb2xzIGFyb3VuZCB0aGUgb3duaW5nIHByaW1pdGl2ZSBiZWxvdyBzbyBoYXJkIHdhbGxwYXBlciBlZGdlcyBkbyBub3QKICAvLyBjaG9wIG9uZSByaW0gaW50byB1bnJlbGF0ZWQgYnJpZ2h0IGFuZCBkYXJrIHBpZWNlcy4KICBmbG9hdCBwcm9iZUxvZCA9IGNsYW1wKDMuNSArIGxvZzIobWF4KG9wdGljYWxTY2FsZSwgMC4wNSkpLAogICAgICAgICAgICAgICAgICAgICAgICAgMC4wLCB1TWlwcyAtIDEuMCk7CiAgZmxvYXQgcHJvYmVSYWRpdXMgPSBtYXgoMS4zNSAqIGJldmVsLCBtYXgoMTguMCAqIG9wdGljYWxTY2FsZSwgMy4wKSk7CiAgdmVjMyBlbnZMID0gc2FtcGxlQmcocHggKyB2ZWMyKC1wcm9iZVJhZGl1cywgMC4wKSwgcHJvYmVMb2QpLnJnYjsKICB2ZWMzIGVudlIgPSBzYW1wbGVCZyhweCArIHZlYzIoIHByb2JlUmFkaXVzLCAwLjApLCBwcm9iZUxvZCkucmdiOwogIHZlYzMgZW52QiA9IHNhbXBsZUJnKHB4ICsgdmVjMigwLjAsIC1wcm9iZVJhZGl1cyksIHByb2JlTG9kKS5yZ2I7CiAgdmVjMyBlbnZUID0gc2FtcGxlQmcocHggKyB2ZWMyKDAuMCwgIHByb2JlUmFkaXVzKSwgcHJvYmVMb2QpLnJnYjsKICB2ZWMyIGZhbGxiYWNrTGlnaHQgPSBub3JtYWxpemUodUxpZ2h0RGlyICsgdmVjMigxZS01KSk7CiAgLy8gSGlnaGxpZ2h0IGFkYXB0YXRpb24gbXVzdCBiZSBzdGFibGUgYWNyb3NzIG9uZSBjb21wb25lbnQuIERyaXZpbmcgaXRzCiAgLy8gc3RyZW5ndGggYW5kIGNvbG91ciBmcm9tIGVhY2ggZnJhZ21lbnQncyBwcm9iZSBtYWtlcyBhIG1vdW50YWluIHJpZGdlIG9yCiAgLy8gdHJlZSBsaW5lIGN1dCB0aGUgcmltIGludG8gYnJpZ2h0IGFuZCBkYXJrIHBpZWNlcy4gUHJvYmUgYXJvdW5kIHRoZSBsb2NhbAogIC8vIGNvbXBvbmVudCBjZW50cmUgd2hpbGUgcmV0YWluaW5nIHBlci1mcmFnbWVudCBlbnZpcm9ubWVudCByZWZsZWN0aW9uLgogIHZlYzMgYWRhcHRMID0gc2FtcGxlQmcoYWRhcHRDZW50ZXIgKyB2ZWMyKC1wcm9iZVJhZGl1cywgMC4wKSwgcHJvYmVMb2QpLnJnYjsKICB2ZWMzIGFkYXB0UiA9IHNhbXBsZUJnKGFkYXB0Q2VudGVyICsgdmVjMiggcHJvYmVSYWRpdXMsIDAuMCksIHByb2JlTG9kKS5yZ2I7CiAgdmVjMyBhZGFwdEIgPSBzYW1wbGVCZyhhZGFwdENlbnRlciArIHZlYzIoMC4wLCAtcHJvYmVSYWRpdXMpLCBwcm9iZUxvZCkucmdiOwogIHZlYzMgYWRhcHRUID0gc2FtcGxlQmcoYWRhcHRDZW50ZXIgKyB2ZWMyKDAuMCwgIHByb2JlUmFkaXVzKSwgcHJvYmVMb2QpLnJnYjsKICB2ZWMyIGFkYXB0R3JhZGllbnQgPSB2ZWMyKGx1bWluYW5jZShhZGFwdFIpIC0gbHVtaW5hbmNlKGFkYXB0TCksCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBsdW1pbmFuY2UoYWRhcHRUKSAtIGx1bWluYW5jZShhZGFwdEIpKTsKICBmbG9hdCBzdGFibGVDb250cmFzdCA9IGxlbmd0aChhZGFwdEdyYWRpZW50KTsKICBmbG9hdCBsaWdodEFkYXB0ID0gY2xhbXAodUhpZ2hsaWdodEFkYXB0LCAwLjAsIDEuMCkgKgogICAgICAgICAgICAgICAgICAgICBzbW9vdGhzdGVwKDAuMDI1LCAwLjIyLCBzdGFibGVDb250cmFzdCk7CiAgLy8gS2VlcCB0aGUgbG9iZSBkaXJlY3Rpb24gbWF0ZXJpYWwtbG9jYWwuIFN0ZWVyaW5nIGl0IHdpdGggdGhlIHdhbGxwYXBlcgogIC8vIGdyYWRpZW50IGNyZWF0ZXMgYSByYXBpZGx5IHJvdGF0aW5nIGRpcmVjdGlvbiBmaWVsZCBhcm91bmQgaGFyZCBjb2xvdXIKICAvLyBlZGdlcywgd2hpY2ggYXBwZWFycyBhcyBkaWFnb25hbCB0ZWFycyBhbmQgbGV0cyB1bnJlbGF0ZWQgY29tcG9uZW50cyBhbHRlcgogIC8vIGVhY2ggb3RoZXIncyBoaWdobGlnaHRzLiBUaGUgZW52aXJvbm1lbnQgc3RpbGwgYWRhcHRzIHN0cmVuZ3RoIGFuZCBjb2xvdXIuCiAgdmVjMiBsaWdodERpciA9IGZhbGxiYWNrTGlnaHQ7CgogIC8vIFJlZmxlY3QgdGhlIGNvbG91ciBzZWVuIGluIHRoZSBzdXJmYWNlLW5vcm1hbCBkaXJlY3Rpb24uIEEgbG9jYWwgc2FtcGxlCiAgLy8ga2VlcHMgc21hbGwgYnJpZ2h0IHN0cnVjdHVyZXMgKHRvd2VyIGxpZ2h0cywgY2xvdWRzLCBjb2FzdGxpbmVzKSBhdHRhY2hlZAogIC8vIHRvIHRoZSBuZWFyYnkgcmltIGluc3RlYWQgb2YgdHVybmluZyBldmVyeSBmcmFtZSBpbnRvIHRoZSBzYW1lIHdoaXRlIHJpbmcuCiAgZmxvYXQgd3ggPSBjbGFtcCgwLjUgKyAwLjUgKiBubi54LCAwLjAsIDEuMCk7CiAgZmxvYXQgd3kgPSBjbGFtcCgwLjUgKyAwLjUgKiBubi55LCAwLjAsIDEuMCk7CiAgdmVjMyBlbnZYID0gbWl4KGVudkwsIGVudlIsIHd4KTsKICB2ZWMzIGVudlkgPSBtaXgoZW52QiwgZW52VCwgd3kpOwogIHZlYzMgcmluZ0VudiA9IChlbnZYICogYWJzKG5uLngpICsgZW52WSAqIGFicyhubi55KSkgLwogICAgICAgICAgICAgICAgIG1heChhYnMobm4ueCkgKyBhYnMobm4ueSksIDFlLTMpOwogIGZsb2F0IGxvY2FsUHJvYmVMb2QgPSBjbGFtcCgyLjAgKyBsb2cyKG1heChvcHRpY2FsU2NhbGUsIDAuMDUpKSwKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgMC4wLCB1TWlwcyAtIDEuMCk7CiAgdmVjMyBsb2NhbEVudiA9IHNhbXBsZUJnKHB4ICsgZyAqIG1heCgwLjU1ICogYmV2ZWwsCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXgoNi4wICogb3B0aWNhbFNjYWxlLCAyLjApKSwKICAgICAgICAgICAgICAgICAgICAgICAgICAgbG9jYWxQcm9iZUxvZCkucmdiOwogIHZlYzMgZW52ID0gbWl4KHJpbmdFbnYsIGxvY2FsRW52LCAwLjU4KTsKICBmbG9hdCBlbnZMdW0gPSBsdW1pbmFuY2UoZW52KTsKICBlbnYgPSBtaXgoZW52LCB2ZWMzKGVudkx1bSksIDAuMTApOyAvLyByZXRhaW4gd2FsbHBhcGVyIGh1ZSwgdGFtZSBuZW9uIHNwaWtlcwogIGZsb2F0IGVudlN0cmVuZ3RoID0gbWl4KDAuNTgsIDEuMCwgc21vb3Roc3RlcCgwLjA4LCAwLjc1LCBlbnZMdW0pKTsKICBjb2wgPSBtaXgoY29sLCBlbnYsIGNsYW1wKGZyZXMgKiB1RnJlc25lbCAqIGVudlN0cmVuZ3RoLCAwLjAsIDAuODIpKTsKCiAgdmVjMyBMMSA9IG5vcm1hbGl6ZSh2ZWMzKGxpZ2h0RGlyLCAwLjU4KSk7CiAgdmVjMyBMMiA9IG5vcm1hbGl6ZSh2ZWMzKC1saWdodERpciwgMC40OCkpOwogIGZsb2F0IHNoYXJwbmVzcyA9IG1heCh1SGlnaGxpZ2h0U2hhcnBuZXNzLCAwLjEpOwogIGZsb2F0IHMxID0gcG93KG1heChkb3QobiwgTDEpLCAwLjApLAogICAgICAgICAgICAgICAgIG1heCh1U3BlY1Bvd2VyICogc2hhcnBuZXNzLCAxLjApKTsKICBmbG9hdCBzMiA9IHBvdyhtYXgoZG90KG4sIEwyKSwgMC4wKSwKICAgICAgICAgICAgICAgICBtYXgodVNwZWNQb3dlciAqIHNoYXJwbmVzcyAqIDAuNzgsIDEuMCkpICogMC4xODsKICBmbG9hdCBoaWdobGlnaHRXaWR0aCA9IGNsYW1wKHVIaWdobGlnaHRXaWR0aCwgMC4xNiwgMS4wKTsKICBmbG9hdCByaXNlRW5kID0gbWluKDAuMTAsIDAuMjUgKiBoaWdobGlnaHRXaWR0aCk7CiAgZmxvYXQgc3BlY0JhbmQgPSBzbW9vdGhzdGVwKDAuMDE1LCByaXNlRW5kLCB0KSAqCiAgICAgICAgICAgICAgICAgICAoMS4wIC0gc21vb3Roc3RlcCgwLjYxICogaGlnaGxpZ2h0V2lkdGgsCiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBoaWdobGlnaHRXaWR0aCwgdCkpOwogIGZsb2F0IGJhc2VIaWdobGlnaHQgPSBjbGFtcCh1SGlnaGxpZ2h0QmFzZSwgMC4wLCAxLjApOwogIGZsb2F0IHNvdXJjZVN0cmVuZ3RoID0gYmFzZUhpZ2hsaWdodCArICgxLjAgLSBiYXNlSGlnaGxpZ2h0KSAqIGxpZ2h0QWRhcHQ7CiAgdmVjMyBzb3VyY2VFbnYgPSBtaXgobWl4KGFkYXB0TCwgYWRhcHRSLCAwLjUgKyAwLjUgKiBsaWdodERpci54KSwKICAgICAgICAgICAgICAgICAgICAgICBtaXgoYWRhcHRCLCBhZGFwdFQsIDAuNSArIDAuNSAqIGxpZ2h0RGlyLnkpLCAwLjUpOwogIGZsb2F0IHNvdXJjZUx1bSA9IG1heChsdW1pbmFuY2Uoc291cmNlRW52KSwgMC4wOCk7CiAgdmVjMyBzcGVjQ29sb3IgPSBjbGFtcChtaXgodmVjMygxLjApLCBzb3VyY2VFbnYgLyBzb3VyY2VMdW0sIDAuNDIpLAogICAgICAgICAgICAgICAgICAgICAgICAgdmVjMygwLjQ1KSwgdmVjMygyLjIpKTsKICBjb2wgKz0gdVNwZWN1bGFyICogKHMxICsgczIpICogc3BlY0JhbmQgKiBzb3VyY2VTdHJlbmd0aCAqIHNwZWNDb2xvcjsKCiAgLy8gRGFyayBjb250b3VyIHJpZ2h0IGF0IHRoZSBzaWxob3VldHRlOiBhdCBncmF6aW5nIGFuZ2xlcyB0aGUgcmltIHJlZmxlY3RzCiAgLy8gdGhlIHN1cnJvdW5kaW5ncyBpbnN0ZWFkIG9mIHRyYW5zbWl0dGluZywgc28gcmVhbCBnbGFzcyBlZGdlcyByZWFkIGRhcmsuCiAgZmxvYXQgdyA9IG1heCh1RWRnZVdpZHRoLCAwLjUpOwogIGZsb2F0IGNvbnRvdXIgPSBzbW9vdGhzdGVwKHcsIDAuMCwgYWJzKGQgKyAwLjU1ICogdykpOwogIGNvbCAqPSAxLjAgLSB1RWRnZURhcmsgKiBjb250b3VyOwoKICAvLyBDcmlzcCBpbm5lciBoaWdobGlnaHQgbGluZTsgZGlyZWN0aW9uIGFuZCBjb2xvdXIgZm9sbG93IHRoZSBsb2NhbCBwcm9iZS4KICBmbG9hdCBsaW5lID0gc21vb3Roc3RlcCgxLjM1ICogdywgMC4wLCBhYnMoZCArIDIuMiAqIHcpKTsKICBmbG9hdCBsaXQgPSAwLjI2ICsgMC43NCAqIG1heChkb3QoZywgbGlnaHREaXIpLCAwLjApOwogIHZlYzMgc3RhYmxlRW52ID0gKGFkYXB0TCArIGFkYXB0UiArIGFkYXB0QiArIGFkYXB0VCkgKiAwLjI1OwogIGZsb2F0IHN0YWJsZUVudkx1bSA9IG1heChsdW1pbmFuY2Uoc3RhYmxlRW52KSwgMC4xMik7CiAgdmVjMyBsaW5lQ29sb3IgPSBtaXgodmVjMygxLjApLCBzdGFibGVFbnYgLyBzdGFibGVFbnZMdW0sIDAuMjgpOwogIGNvbCArPSB1RWRnZUxpbmUgKiBsaW5lICogbGl0ICogbGluZUNvbG9yOwoKICAvLyAtLS0tIHRpbnQgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0KICAvLyBUaW50IHBvbGFyaXR5IGFkYXB0cyBvbmNlIHBlciBsb2NhbCBjb21wb25lbnQsIG5vdCBwZXIgZHJhdyBncm91cC4KICAvLyBUaGlzIGNhcHR1cmVzIHRoZSBzeXN0ZW0tbWF0ZXJpYWwgbGlnaHQvZGFyayBzd2l0Y2ggd2l0aG91dCBsZXR0aW5nIGEgaGFyZAogIC8vIGJhY2tncm91bmQgZWRnZSBzcGxpdCBvbmUgc3VyZmFjZSBpbnRvIHZpc2libHkgZGlmZmVyZW50IG1hdGVyaWFscy4KICBmbG9hdCBtYXRlcmlhbEx1bSA9IGx1bWluYW5jZShzYW1wbGVCZyhhZGFwdENlbnRlciwgdU1pcHMgLSAxLjApLnJnYik7CiAgZmxvYXQgdXNlRGFya01hdGVyaWFsID0gc21vb3Roc3RlcCgwLjM4LCAwLjY4LCBtYXRlcmlhbEx1bSk7CiAgdmVjMyBhdXRvbWF0aWNUaW50ID0gbWl4KHZlYzMoMC45NywgMC45ODUsIDEuMCksCiAgICAgICAgICAgICAgICAgICAgICAgICAgIHZlYzMoMC4wMzUsIDAuMDU1LCAwLjA4MCksIHVzZURhcmtNYXRlcmlhbCk7CiAgdmVjMyByZXNvbHZlZFRpbnQgPSBtaXgodVRpbnRDb2xvciwgYXV0b21hdGljVGludCwgY2xhbXAodVRpbnRBZGFwdCwgMC4wLCAxLjApKTsKICBmbG9hdCBhZGFwdGl2ZUFtb3VudCA9IHVUaW50QW1vdW50ICogbWl4KDEuMTAsIDAuOTIsIHVzZURhcmtNYXRlcmlhbCk7CiAgY29sID0gbWl4KGNvbCwgcmVzb2x2ZWRUaW50LCBjbGFtcChhZGFwdGl2ZUFtb3VudCwgMC4wLCAxLjApKTsKICBjb2wgKz0gdUJyaWdodDsKCiAgLy8gLS0tLSBzb2Z0IGNvbnRhY3Qgc2hhZG93IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0KICBmbG9hdCBkcyA9IHNkQXBwbGVTaGFwZShweCArIHZlYzIoMC4wLCB1U2hhZG93T2Zmc2V0KSk7CiAgZmxvYXQgc2ggPSBleHAoLW1heChkcywgMC4wKSAvIG1heCh1U2hhZG93U2l6ZSwgMC41KSkgKiB1U2hhZG93OwoKICBpZiAodURlYnVnID09IDEpIGNvbCA9IHZlYzMoaCk7CiAgaWYgKHVEZWJ1ZyA9PSAyKSBjb2wgPSB2ZWMzKDAuNSArIDAuNSAqIG4ueHksIG4ueik7CiAgaWYgKHVEZWJ1ZyA9PSAzKSBjb2wgPSB2ZWMzKGxlbmd0aChkRykgLyBtYXgob3B0aWNhbEhlaWdodCwgMS4wKSwKICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbGVuZ3RoKGRSIC0gZEIpIC8gbWF4KG9wdGljYWxIZWlnaHQsIDEuMCkgKiA2LjAsIDAuMCk7CgogIC8vIFRoZSBicm93c2VyIGRyYXdpbmcgYnVmZmVyIHN0b3JlcyBkaXNwbGF5L3NSR0IgdmFsdWVzLCB1bmxpa2UgdGhlIGV4cGxpY2l0CiAgLy8gU1JHQjhfQUxQSEE4IG9mZnNjcmVlbiBhdHRhY2htZW50cy4gRW5jb2RlIHRoZSBmaW5hbCBsaW5lYXIgbWF0ZXJpYWwgaGVyZSwKICAvLyB0aGVuIGFkZCB0cmlhbmd1bGFyLWRpc3RyaWJ1dGlvbiBub2lzZSBzbWFsbGVyIHRoYW4gb25lIGRpc3BsYXktc3BhY2UgTFNCLgogIGlmICh1RGVidWcgPT0gMCkgewogICAgZmxvYXQgbjAgPSBoYXNoMTIoZ2xfRnJhZ0Nvb3JkLnh5ICsgdmVjMigxNy4wLCA1OS4wKSk7CiAgICBmbG9hdCBuMSA9IGhhc2gxMihnbF9GcmFnQ29vcmQueXggKyB2ZWMyKDgzLjAsIDExLjApKTsKICAgIGZsb2F0IG5vaXNlID0gKG4wIC0gbjEpICogKDAuODUgLyAyNTUuMCk7CiAgICBjb2wgPSBjbGFtcChsaW5lYXJUb1NyZ2IoY29sKSArIG5vaXNlLCAwLjAsIDEuMCk7CiAgfQoKICBmbG9hdCBhID0gYWEgKyBzaCAqICgxLjAgLSBhYSk7CiAgb3V0Q29sb3IgPSB2ZWM0KGNvbCAqIGFhLCBhKTsgICAvLyBwcmVtdWx0aXBsaWVkOyBzaGFkb3cgY29udHJpYnV0ZXMgYmxhY2sKfWA7CgoKLy8gPT09PT0gdjItc2hhZGVycy5qcyA9PT09PQovLyBUaGUgVjIgY2xlYXIvdHJhbnNwYXJlbnQgb3B0aWNhbCBtb2RlbC4gVGhpcyBpcyBpbnRlbnRpb25hbGx5IGEgc2VwYXJhdGUKLy8gc2hhZGVyIHJhdGhlciB0aGFuIGEgYnJhbmNoIGluc2lkZSBGU19HTEFTUzogaXRzIGNvbnRyb2xzIGhhdmUgZGlmZmVyZW50Ci8vIHVuaXRzLCBwcm9maWxlcyBhbmQgY29tcG9zaXRpbmcgcnVsZXMgZXZlbiB3aGVyZSBhIHB1YmxpYyBuYW1lIGxvb2tzIGFsaWtlLgpjb25zdCBGU19HTEFTU19WMiA9IGAjdmVyc2lvbiAzMDAgZXMKcHJlY2lzaW9uIGhpZ2hwIGZsb2F0OwppbiB2ZWMyIHZVVjsKb3V0IHZlYzQgb3V0Q29sb3I7Cgp1bmlmb3JtIHNhbXBsZXIyRCB1U3JjOwp1bmlmb3JtIHZlYzIgdVJlczsKdW5pZm9ybSBmbG9hdCB1RHByOwp1bmlmb3JtIGZsb2F0IHVNaXBzOwpjb25zdCBpbnQgTUFYX1NIQVBFUyA9IDE2Owp1bmlmb3JtIGludCB1U2hhcGVDb3VudDsKdW5pZm9ybSB2ZWMyIHVTaGFwZUNlbnRlcnNbTUFYX1NIQVBFU107CnVuaWZvcm0gdmVjMiB1U2hhcGVIYWx2ZXNbTUFYX1NIQVBFU107CnVuaWZvcm0gaW50IHVTaGFwZVR5cGVzW01BWF9TSEFQRVNdOwp1bmlmb3JtIGZsb2F0IHVTaGFwZVJhZGlpW01BWF9TSEFQRVNdOwp1bmlmb3JtIGZsb2F0IHVTaGFwZVRpbnRzW01BWF9TSEFQRVNdOwp1bmlmb3JtIGZsb2F0IHVTaGFwZVRpbnRMaWdodHNbTUFYX1NIQVBFU107CnVuaWZvcm0gZmxvYXQgdVNoYXBlRnJvc3RzW01BWF9TSEFQRVNdOwp1bmlmb3JtIGZsb2F0IHVTaGFwZU9wYWNpdGllc1tNQVhfU0hBUEVTXTsKdW5pZm9ybSB2ZWMyIHVMaWdodERpcnNbTUFYX1NIQVBFU107CnVuaWZvcm0gZmxvYXQgdVJlZnJhY3Rpb247CnVuaWZvcm0gZmxvYXQgdUVkZ2VSZWFjaDsKdW5pZm9ybSBmbG9hdCB1RWRnZVdpZHRoOwp1bmlmb3JtIGZsb2F0IHVEaXNwZXJzaW9uOwp1bmlmb3JtIGZsb2F0IHVCb2R5Owp1bmlmb3JtIGZsb2F0IHVBYnNvcnB0aW9uOwp1bmlmb3JtIGZsb2F0IHVSaW07CnVuaWZvcm0gZmxvYXQgdVJlZmxlY3Rpb247CnVuaWZvcm0gZmxvYXQgdUhpZ2hsaWdodDsKdW5pZm9ybSBmbG9hdCB1RWNobzsKdW5pZm9ybSBmbG9hdCB1SGFpcmxpbmU7CnVuaWZvcm0gZmxvYXQgdUhhaXJXaWR0aDsKCnZlYzMgbGluZWFyVG9TcmdiKHZlYzMgYykgewogIGMgPSBtYXgoYywgMC4wKTsKICByZXR1cm4gbWl4KDEuMDU1ICogcG93KGMsIHZlYzMoMS4wIC8gMi40KSkgLSAwLjA1NSwKICAgICAgICAgICAgIDEyLjkyICogYywKICAgICAgICAgICAgIGxlc3NUaGFuRXF1YWwoYywgdmVjMygwLjAwMzEzMDgpKSk7Cn0KCmZsb2F0IHNkUm91bmRCb3godmVjMiBwLCB2ZWMyIGIsIGZsb2F0IHIpIHsKICB2ZWMyIHEgPSBhYnMocCkgLSBiICsgcjsKICByZXR1cm4gbWluKG1heChxLngsIHEueSksIDAuMCkgKyBsZW5ndGgobWF4KHEsIDAuMCkpIC0gcjsKfQoKZmxvYXQgc21vb3RoVW5pb24oZmxvYXQgZDEsIGZsb2F0IGQyLCBmbG9hdCBrKSB7CiAgZmxvYXQgaCA9IGNsYW1wKDAuNSArIDAuNSAqIChkMiAtIGQxKSAvIGssIDAuMCwgMS4wKTsKICByZXR1cm4gbWl4KGQyLCBkMSwgaCkgLSBrICogaCAqICgxLjAgLSBoKTsKfQoKZmxvYXQgc2hhcGVTZGYoaW50IGluZGV4LCB2ZWMyIHBvaW50KSB7CiAgdmVjMiBwID0gcG9pbnQgLSB1U2hhcGVDZW50ZXJzW2luZGV4XTsKICB2ZWMyIGhhbGZTaXplID0gdVNoYXBlSGFsdmVzW2luZGV4XTsKICBpbnQga2luZCA9IHVTaGFwZVR5cGVzW2luZGV4XTsKICBmbG9hdCByYWRpdXMgPSBtaW4odVNoYXBlUmFkaWlbaW5kZXhdLCBtaW4oaGFsZlNpemUueCwgaGFsZlNpemUueSkpOwogIGlmIChraW5kID09IDApIHJldHVybiBzZFJvdW5kQm94KHAsIGhhbGZTaXplLCByYWRpdXMpOwogIGlmIChraW5kID09IDEpIHJldHVybiBzZFJvdW5kQm94KHAsIGhhbGZTaXplLCBtaW4oaGFsZlNpemUueCwgaGFsZlNpemUueSkpOwogIHJldHVybiBsZW5ndGgocCkgLSBtaW4oaGFsZlNpemUueCwgaGFsZlNpemUueSk7Cn0KCnZlYzIgb3B0aWNhbE5vcm1hbChpbnQgaW5kZXgsIHZlYzIgcG9pbnQsIHZlYzIgc2RmTm9ybWFsKSB7CiAgdmVjMiBwID0gcG9pbnQgLSB1U2hhcGVDZW50ZXJzW2luZGV4XTsKICB2ZWMyIGhhbGZTaXplID0gbWF4KHVTaGFwZUhhbHZlc1tpbmRleF0sIHZlYzIoMS4wKSk7CiAgaW50IGtpbmQgPSB1U2hhcGVUeXBlc1tpbmRleF07CgogIGlmIChraW5kID09IDApIHsKICAgIC8vIFRoZSBzaXh0aC1vcmRlciBzdXBlcmVsbGlwc2UgaXMgdGhlIG9wdGljYWwgZmllbGQsIHdoaWxlIHJvdW5kbmVzcyBvbmx5CiAgICAvLyBjb250cm9scyB0aGUgc2lsaG91ZXR0ZS4gVGhpcyBzZXBhcmF0aW9uIGlzIHBhcnQgb2YgdGhlIFYyIG1vZGVsLgogICAgdmVjMiBxID0gcCAvIGhhbGZTaXplOwogICAgdmVjMiBnID0gdmVjMihzaWduKHEueCkgKiBwb3coYWJzKHEueCksIDUuMCkgLyBoYWxmU2l6ZS54LAogICAgICAgICAgICAgICAgICBzaWduKHEueSkgKiBwb3coYWJzKHEueSksIDUuMCkgLyBoYWxmU2l6ZS55KTsKICAgIHJldHVybiBub3JtYWxpemUoZyArIHNkZk5vcm1hbCAqIDAuMDAwMSk7CiAgfQogIGlmIChraW5kID09IDEpIHsKICAgIHZlYzIgY2xvc2VzdDsKICAgIGlmIChoYWxmU2l6ZS54ID49IGhhbGZTaXplLnkpIHsKICAgICAgZmxvYXQgc2VnbWVudCA9IG1heChoYWxmU2l6ZS54IC0gaGFsZlNpemUueSwgMC4wKTsKICAgICAgY2xvc2VzdCA9IHZlYzIoY2xhbXAocC54LCAtc2VnbWVudCwgc2VnbWVudCksIDAuMCk7CiAgICB9IGVsc2UgewogICAgICBmbG9hdCBzZWdtZW50ID0gbWF4KGhhbGZTaXplLnkgLSBoYWxmU2l6ZS54LCAwLjApOwogICAgICBjbG9zZXN0ID0gdmVjMigwLjAsIGNsYW1wKHAueSwgLXNlZ21lbnQsIHNlZ21lbnQpKTsKICAgIH0KICAgIHJldHVybiBub3JtYWxpemUocCAtIGNsb3Nlc3QgKyBzZGZOb3JtYWwgKiAwLjAwMDEpOwogIH0KICByZXR1cm4gbm9ybWFsaXplKHAgKyBzZGZOb3JtYWwgKiAwLjAwMDEpOwp9Cgp2ZWMzIGJhY2tkcm9wKHZlYzIgdXYpIHsKICAvLyBUaGUgc2hhcmVkIGJhY2tkcm9wIHBpcGVsaW5lIHN0b3JlcyBsaW5lYXIgcmFkaWFuY2UgaW4gU1JHQjhfQUxQSEE4LgogIC8vIFYyJ3Mgb3B0aWNhbCBjb25zdGFudHMgd2VyZSBhdXRob3JlZCBpbiBkaXNwbGF5IHNwYWNlLCBzbyBjb252ZXJ0IGVhY2gKICAvLyBzYW1wbGUgYmFjayBiZWZvcmUgYXBwbHlpbmcgdGhlIFYyIGVxdWF0aW9ucy4KICByZXR1cm4gbGluZWFyVG9TcmdiKHRleHR1cmUodVNyYywgY2xhbXAodXYsIHZlYzIoMC4wMDEpLCB2ZWMyKDAuOTk5KSkpLnJnYik7Cn0KCnZlYzMgc29mdEJhY2tkcm9wKHZlYzIgdXYsIGZsb2F0IHJhZGl1cykgewogIGZsb2F0IGxvZCA9IGNsYW1wKGxvZzIobWF4KHJhZGl1cyAqIDAuOSwgMS4wKSksIDAuMCwgbWF4KHVNaXBzIC0gMS4wLCAwLjApKTsKICB2ZWMyIHIgPSB2ZWMyKG1heChyYWRpdXMgKiAwLjQyLCAwLjM1KSkgLyB1UmVzOwogIHZlYzIgY2VudGVyID0gY2xhbXAodXYsIHZlYzIoMC4wMDEpLCB2ZWMyKDAuOTk5KSk7CiAgdmVjMyBjID0gbGluZWFyVG9TcmdiKHRleHR1cmVMb2QodVNyYywgY2VudGVyLCBsb2QpLnJnYikgKiAwLjQ0OwogIGMgKz0gbGluZWFyVG9TcmdiKHRleHR1cmVMb2QodVNyYywgY2xhbXAoY2VudGVyICsgdmVjMihyLngsIDAuMCksIHZlYzIoMC4wMDEpLCB2ZWMyKDAuOTk5KSksIGxvZCkucmdiKSAqIDAuMTQ7CiAgYyArPSBsaW5lYXJUb1NyZ2IodGV4dHVyZUxvZCh1U3JjLCBjbGFtcChjZW50ZXIgLSB2ZWMyKHIueCwgMC4wKSwgdmVjMigwLjAwMSksIHZlYzIoMC45OTkpKSwgbG9kKS5yZ2IpICogMC4xNDsKICBjICs9IGxpbmVhclRvU3JnYih0ZXh0dXJlTG9kKHVTcmMsIGNsYW1wKGNlbnRlciArIHZlYzIoMC4wLCByLnkpLCB2ZWMyKDAuMDAxKSwgdmVjMigwLjk5OSkpLCBsb2QpLnJnYikgKiAwLjE0OwogIGMgKz0gbGluZWFyVG9TcmdiKHRleHR1cmVMb2QodVNyYywgY2xhbXAoY2VudGVyIC0gdmVjMigwLjAsIHIueSksIHZlYzIoMC4wMDEpLCB2ZWMyKDAuOTk5KSksIGxvZCkucmdiKSAqIDAuMTQ7CiAgcmV0dXJuIGM7Cn0KCmZsb2F0IGx1bWluYW5jZSh2ZWMzIGMpIHsgcmV0dXJuIGRvdChjLCB2ZWMzKDAuMjEyNiwgMC43MTUyLCAwLjA3MjIpKTsgfQoKdmVjMyBpbnRlcmZhY2VDb2xvcih2ZWMyIHBvaW50LCB2ZWMyIG5vcm1hbCkgewogIHZlYzMgb3V0c2lkZUNvbG9yID0gc29mdEJhY2tkcm9wKChwb2ludCArIG5vcm1hbCAqIDEuOCkgLyB1UmVzLCAyLjApOwogIHZlYzMgaW5zaWRlQ29sb3IgPSBzb2Z0QmFja2Ryb3AoKHBvaW50IC0gbm9ybWFsICogMS44KSAvIHVSZXMsIDIuMCk7CiAgLy8gQXBwbGUncyBvdXRlciBpbnRlcmZhY2UgaXMgYSBuZXV0cmFsIGNvbnRyYXN0IGxpbmUgcmF0aGVyIHRoYW4gYSBjb3B5IG9mCiAgLy8gdGhlIHdhbGxwYXBlciBjb2xvdXIuIEluY2x1ZGUgZGlzcGxheS1zcGFjZSB2YWx1ZSBhcyB3ZWxsIGFzIGx1bWluYW5jZSBzbwogIC8vIHNhdHVyYXRlZCBibHVlL3B1cnBsZSBmaWVsZHMgc2VsZWN0IGEgZGFyayBsaW5lIGV2ZW4gdGhvdWdoIHRoZWlyIGZvcm1hbAogIC8vIGx1bWluYW5jZSBpcyBtb2Rlc3QuIFRoZSBvdXRzaWRlIGNhcnJpZXMgbW9yZSB3ZWlnaHQgYmVjYXVzZSB0aGF0IGlzIHRoZQogIC8vIGZpZWxkIHRoZSBzaWxob3VldHRlIG11c3QgcmVtYWluIGxlZ2libGUgYWdhaW5zdC4KICBmbG9hdCBvdXRzaWRlVmFsdWUgPSBtYXgob3V0c2lkZUNvbG9yLnIsIG1heChvdXRzaWRlQ29sb3IuZywgb3V0c2lkZUNvbG9yLmIpKTsKICBmbG9hdCBpbnNpZGVWYWx1ZSA9IG1heChpbnNpZGVDb2xvci5yLCBtYXgoaW5zaWRlQ29sb3IuZywgaW5zaWRlQ29sb3IuYikpOwogIGZsb2F0IG91dHNpZGVMaWdodCA9IG1heChsdW1pbmFuY2Uob3V0c2lkZUNvbG9yKSwgb3V0c2lkZVZhbHVlICogMC43Mik7CiAgZmxvYXQgaW5zaWRlTGlnaHQgPSBtYXgobHVtaW5hbmNlKGluc2lkZUNvbG9yKSwgaW5zaWRlVmFsdWUgKiAwLjcyKTsKICBmbG9hdCBpbnRlcmZhY2VMaWdodCA9IG91dHNpZGVMaWdodCAqIDAuNjggKyBpbnNpZGVMaWdodCAqIDAuMzI7CiAgZmxvYXQgZGFya0xpbmUgPSBzbW9vdGhzdGVwKDAuNDAsIDAuNjEsIGludGVyZmFjZUxpZ2h0KTsKICByZXR1cm4gbWl4KHZlYzMoMC45MiwgMC45MywgMC45NiksIHZlYzMoMC4wMTQsIDAuMDEzLCAwLjAxOCksIGRhcmtMaW5lKTsKfQoKdm9pZCBtYWluKCkgewogIHZlYzIgcG9pbnQgPSB2VVYgKiB1UmVzOwogIGludCBjaG9zZW4gPSAtMTsKICBmbG9hdCBjaG9zZW5EID0gMWU2OwogIGZvciAoaW50IGkgPSAwOyBpIDwgTUFYX1NIQVBFUzsgaSsrKSB7CiAgICBpZiAoaSA+PSB1U2hhcGVDb3VudCkgYnJlYWs7CiAgICBmbG9hdCBkID0gc2hhcGVTZGYoaSwgcG9pbnQpOwogICAgaWYgKGQgPD0gMi4xKSB7IGNob3NlbiA9IGk7IGNob3NlbkQgPSBkOyB9CiAgfQoKICBpZiAoY2hvc2VuIDwgMCkgewogICAgb3V0Q29sb3IgPSB2ZWM0KDAuMCk7CiAgICByZXR1cm47CiAgfQoKICB2ZWMyIGNlbnRlciA9IHVTaGFwZUNlbnRlcnNbY2hvc2VuXTsKICB2ZWMyIGhhbGZTaXplID0gdVNoYXBlSGFsdmVzW2Nob3Nlbl07CiAgZmxvYXQgbWluSGFsZiA9IG1pbihoYWxmU2l6ZS54LCBoYWxmU2l6ZS55KTsKICBmbG9hdCBlID0gMS4zNTsKICBmbG9hdCBkeCA9IHNoYXBlU2RmKGNob3NlbiwgcG9pbnQgKyB2ZWMyKGUsIDAuMCkpIC0gc2hhcGVTZGYoY2hvc2VuLCBwb2ludCAtIHZlYzIoZSwgMC4wKSk7CiAgZmxvYXQgZHkgPSBzaGFwZVNkZihjaG9zZW4sIHBvaW50ICsgdmVjMigwLjAsIGUpKSAtIHNoYXBlU2RmKGNob3NlbiwgcG9pbnQgLSB2ZWMyKDAuMCwgZSkpOwogIHZlYzIgbm9ybWFsID0gbm9ybWFsaXplKHZlYzIoZHgsIGR5KSArIHZlYzIoMC4wMDAxKSk7CiAgZmxvYXQgZGVwdGggPSBjbGFtcCgtY2hvc2VuRCAvIG1heCgxMi4wLCBtaW5IYWxmICogMC42MiksIDAuMCwgMS4wKTsKICBmbG9hdCByZWZyYWN0aW9uU3VwcG9ydCA9IG1heCgxNC4wLCBtaW5IYWxmICogMC41MCk7CiAgZmxvYXQgZWRnZUN1cnZlID0gcG93KDEuMCAtIHNtb290aHN0ZXAoMC4wLCByZWZyYWN0aW9uU3VwcG9ydCwgLWNob3NlbkQpLCAyLjIpOwogIHZlYzIgbG9jYWwgPSAocG9pbnQgLSBjZW50ZXIpIC8gbWF4KGhhbGZTaXplLCB2ZWMyKDEuMCkpOwoKICBmbG9hdCBlZGdlRGVwdGggPSBtYXgoLWNob3NlbkQsIDAuMCk7CiAgZmxvYXQgY2F1c3RpY1N1cHBvcnQgPSBtYXgoOC4wLCBtaW5IYWxmICogdUVkZ2VXaWR0aCk7CiAgZmxvYXQgY2FwdHVyZVggPSBjbGFtcChlZGdlRGVwdGggLyBjYXVzdGljU3VwcG9ydCwgMC4wLCAxLjApOwogIGZsb2F0IGNhdXN0aWNUID0gMS4wIC0gc21vb3Roc3RlcCgwLjAsIGNhdXN0aWNTdXBwb3J0LCBlZGdlRGVwdGgpOwogIGZsb2F0IGNhdXN0aWNTaGFkZSA9IGNhdXN0aWNUICogY2F1c3RpY1QgKiAoMy4wIC0gMi4wICogY2F1c3RpY1QpOwogIC8vIFRoZSBvbGQgZG91YmxlLXNtb290aHN0ZXAgZGlzcGxhY2VtZW50IGZsYXR0ZW5lZCBhdCB0aGUgdmlzaWJsZSBjb250b3VyLgogIC8vIEl0cyBzb3VyY2UtY29vcmRpbmF0ZSBkZXJpdmF0aXZlIHRoZXJlZm9yZSBjaGFuZ2VkIHNpZ24gdHdpY2UsIG1ha2luZyBhCiAgLy8gY2FwdHVyZWQgbGluZSB0dXJuIGJhY2sganVzdCBiZWZvcmUgaXQgdG91Y2hlZCB0aGUgZWRnZS4gQSBvbmUtc2lkZWQgZXhpdAogIC8vIHByb2ZpbGUga2VlcHMgYSBmaW5pdGUgc2xvcGUgYXQgdGhlIGNvbnRvdXIgYW5kIHJlbGF4ZXMgdG8gemVybyBvbmx5IG9uCiAgLy8gdGhlIGlubmVyIHNpZGUgb2YgdGhlIGNhcHR1cmUgYmFuZCwgbGVhdmluZyBhIHNpbmdsZSBvcHRpY2FsIGZvbGQuCiAgZmxvYXQgY2FwdHVyZVByb2ZpbGUgPSBwb3coMS4wIC0gY2FwdHVyZVgsIDEuNjQpOwogIGZsb2F0IHJlZnJhY3Rpb25YID0gY2xhbXAoZWRnZURlcHRoIC8gcmVmcmFjdGlvblN1cHBvcnQsIDAuMCwgMS4wKTsKICBmbG9hdCByZWZyYWN0aW9uUHJvZmlsZSA9IHBvdygxLjAgLSByZWZyYWN0aW9uWCwgMi4yKTsKICAvLyBUaGUgc2lsaG91ZXR0ZSBhbmQgb3B0aWNhbCBzdXBlcmVsbGlwc2UgZGVsaWJlcmF0ZWx5IGRpZmZlciBpbiBWMiwgYnV0CiAgLy8gdGhlIHZpc2libGUgY29udG91ciBtdXN0IHN0aWxsIGV4aXQgYWxvbmcgdGhlIHNpbGhvdWV0dGUgbm9ybWFsLiBCbGVuZCB0bwogIC8vIHRoZSBicm9hZGVyIG9wdGljYWwgZmllbGQgb25seSBhZnRlciBsZWF2aW5nIHRoZSBvdXRlciBlZGdlIHBpeGVscy4KICBmbG9hdCBvcHRpY2FsTm9ybWFsTWl4ID0gc21vb3Roc3RlcCgwLjEyLCAwLjU1LCBjYXB0dXJlWCk7CiAgdmVjMiBiZW5kTm9ybWFsID0gbm9ybWFsaXplKG1peChub3JtYWwsIG9wdGljYWxOb3JtYWwoY2hvc2VuLCBwb2ludCwgbm9ybWFsKSwgb3B0aWNhbE5vcm1hbE1peCkpOwogIHZlYzIgaW53YXJkID0gLWJlbmROb3JtYWw7CiAgLy8gRWRnZSBwdWxsIHVzZWQgdG8gbXVsdGlwbHkgQ2FwdHVyZSByZWFjaCBhcyBhIHNlY29uZCBwdWJsaWMgY29udHJvbC4gS2VlcAogIC8vIGl0cyBvcmlnaW5hbCBkZWZhdWx0IGFzIGFuIGludGVybmFsIGNhbGlicmF0aW9uIHNvIHRoZSBkZWZhdWx0IG1hdGVyaWFsCiAgLy8gcmV0YWlucyB0aGUgc2FtZSBkaXNwbGFjZW1lbnQgd2l0aCBvbmUgdW5hbWJpZ3VvdXMgY2FwdHVyZSBwYXJhbWV0ZXIuCiAgY29uc3QgZmxvYXQgQ0FQVFVSRV9SRUFDSF9TQ0FMRSA9IDEuMjQ7CiAgZmxvYXQgY2FwdHVyZURpc3RhbmNlID0gdUVkZ2VSZWFjaCAqIENBUFRVUkVfUkVBQ0hfU0NBTEUgKiBjYXB0dXJlUHJvZmlsZTsKICBmbG9hdCBzaGFsbG93UmVmcmFjdGlvbiA9IHVSZWZyYWN0aW9uICogcmVmcmFjdGlvblByb2ZpbGUgKiAwLjMyOwogIHZlYzIgbGVuc1NoaWZ0ID0gaW53YXJkICogKHNoYWxsb3dSZWZyYWN0aW9uICsgY2FwdHVyZURpc3RhbmNlKTsKICBsZW5zU2hpZnQgKz0gLWxvY2FsICogKHVSZWZyYWN0aW9uICogMC4wMzUpICogc21vb3Roc3RlcCgwLjE2LCAwLjkyLCBkZXB0aCk7CiAgdmVjMiBjaHJvbWFTaGlmdCA9IGJlbmROb3JtYWwgKiB1RGlzcGVyc2lvbiAqICgwLjMyICsgZWRnZUN1cnZlICogMC45NSk7CiAgdmVjMiB1dlIgPSAocG9pbnQgKyBsZW5zU2hpZnQgKiAoMS4wICsgdURpc3BlcnNpb24gKiAwLjAwOSkgKyBjaHJvbWFTaGlmdCkgLyB1UmVzOwogIHZlYzIgdXZHID0gKHBvaW50ICsgbGVuc1NoaWZ0KSAvIHVSZXM7CiAgdmVjMiB1dkIgPSAocG9pbnQgKyBsZW5zU2hpZnQgKiAoMS4wIC0gdURpc3BlcnNpb24gKiAwLjAxMSkgLSBjaHJvbWFTaGlmdCkgLyB1UmVzOwogIC8vIFJlYWNoIGNvbnRyb2xzIHdoZXJlIHRoZSBzYW1wbGUgY29tZXMgZnJvbSwgbm90IGhvdyBmYXQgYSBjYXB0dXJlZCBsaW5lCiAgLy8gYmVjb21lcy4gUHJlc2VydmUgdGhlIHR1bmVkIHJlYWNoPTM1IHNvZnRuZXNzIHdoaWxlIHByZXZlbnRpbmcgbGFyZ2VyCiAgLy8gcmVhY2hlcyBmcm9tIHNpbGVudGx5IGRvdWJsaW5nIHRoZSBibHVyIHJhZGl1cy4KICBmbG9hdCBjYXVzdGljQmx1ciA9IG1pbigwLjcgKyAxLjEzICogdURwciwgMC43ICsgY2FwdHVyZURpc3RhbmNlICogMC4wMjYpOwogIC8vIEZyb3N0IGlzIGEgcmF0aW8sIG5vdCBhIGZpeGVkIHBpeGVsIHJhZGl1cy4gUmVzb2x2ZSBpdCBhZ2FpbnN0IHRoZQogIC8vIGNvbXBvbmVudCdzIHNob3J0IHNpZGUgc28gYSBzbWFsbCBpY29uIHN0YXlzIGNsZWFyIHdoaWxlIGEgbGFyZ2VyIGNhcmQKICAvLyBuYXR1cmFsbHkgYmVjb21lcyBkZW5zZXIgYW5kIG1vcmUgb3BhcXVlIGF0IHRoZSBzYW1lIG1hdGVyaWFsIHNldHRpbmcuCiAgZmxvYXQgc2hhcGVGcm9zdCA9IGNsYW1wKHVTaGFwZUZyb3N0c1tjaG9zZW5dLCAwLjAsIDEuMCk7CiAgZmxvYXQgc2hvcnRTaWRlQ3NzID0gbWluSGFsZiAqIDIuMCAvIG1heCh1RHByLCAxLjApOwogIGZsb2F0IHNpemVSYXRpbyA9IGNsYW1wKHNob3J0U2lkZUNzcyAvIDk2LjAsIDAuMjgsIDIuMjUpOwogIGZsb2F0IGJsdXJSYWRpdXMgPSBtYXgoc2hhcGVGcm9zdCAqIHNob3J0U2lkZUNzcwogICAgICAgICAgICAgICAgICAgICAgICAgKiAoMC4yMiArIGRlcHRoICogMC41NSkgKiB1RHByLAogICAgICAgICAgICAgICAgICAgICAgICAgY2F1c3RpY0JsdXIpOwogIGZsb2F0IGJsdXJNaXggPSBjbGFtcChzaGFwZUZyb3N0ICogKDAuNTYgKyBzaXplUmF0aW8gKiAwLjM0KQogICAgICAgICAgICAgICAgICAgICAgICArIGNhdXN0aWNTaGFkZSAqIDAuMTgsIDAuMCwgMC44OCk7CiAgdmVjMyBzciA9IG1peChiYWNrZHJvcCh1dlIpLCBzb2Z0QmFja2Ryb3AodXZSLCBibHVyUmFkaXVzKSwgYmx1ck1peCk7CiAgdmVjMyBzZyA9IG1peChiYWNrZHJvcCh1dkcpLCBzb2Z0QmFja2Ryb3AodXZHLCBibHVyUmFkaXVzKSwgYmx1ck1peCk7CiAgdmVjMyBzYiA9IG1peChiYWNrZHJvcCh1dkIpLCBzb2Z0QmFja2Ryb3AodXZCLCBibHVyUmFkaXVzKSwgYmx1ck1peCk7CiAgdmVjMyB0cmFuc21pdHRlZCA9IHZlYzMoc3Iuciwgc2cuZywgc2IuYik7CgogIGZsb2F0IHRyYW5zbWl0dGVkTHVtID0gbHVtaW5hbmNlKHRyYW5zbWl0dGVkKTsKICB2ZWMzIGJvZHlUYXJnZXQgPSBtaXgodmVjMygwLjAzMCwgMC4wMzEsIDAuMDM4KSwgdmVjMygwLjk0LCAwLjk1LCAwLjk3KSwKICAgICAgICAgICAgICAgICAgICAgICAgc21vb3Roc3RlcCgwLjU4LCAwLjgyLCB0cmFuc21pdHRlZEx1bSkpOwogIHRyYW5zbWl0dGVkID0gbWl4KHRyYW5zbWl0dGVkLCBib2R5VGFyZ2V0LAogICAgICAgICAgICAgICAgICAgIGNsYW1wKHVCb2R5ICogKDAuMDM0ICsgZWRnZUN1cnZlICogMC4wMTIpLCAwLjAsIDAuMTEpKTsKICB0cmFuc21pdHRlZCA9IG1peCh2ZWMzKGx1bWluYW5jZSh0cmFuc21pdHRlZCkpLCB0cmFuc21pdHRlZCwgMS4wIC0gdUJvZHkgKiAwLjA0NSk7CgogIGZsb2F0IG9wdGljYWxQYXRoID0gMC4yNiArIHNxcnQoZGVwdGgpICogMC43NDsKICB0cmFuc21pdHRlZCAqPSBleHAoLXZlYzMoMC4wMTgsIDAuMDExLCAwLjAwNCkgKiBvcHRpY2FsUGF0aCAqIDIuNCAqIHVBYnNvcnB0aW9uKTsKICAvLyBUaW50ZWQgTGlxdWlkIEdsYXNzIGNob29zZXMgb25lIGxpZ2h0L2RhcmsgbWF0ZXJpYWwgZm9yIHRoZSB3aG9sZQogIC8vIGNvbXBvbmVudC4gQ2hvb3NpbmcgcGVyIGZyYWdtZW50IGxldHMgaGlnaC1jb250cmFzdCBjb250ZW50IHB1bmNoIGEKICAvLyBjaGVja2VyYm9hcmQgdGhyb3VnaCB0aGUgc3VyZmFjZSBpbnN0ZWFkIG9mIHByb2R1Y2luZyB0aGUgY29oZXJlbnQgbWlsa3kKICAvLyB2ZWlsIHVzZWQgYnkgbm90aWZpY2F0aW9ucyBhbmQgb3RoZXIgbGVnaWJpbGl0eS1maXJzdCBjb250cm9scy4KICB2ZWMzIHRpbnRUYXJnZXQgPSBtaXgodmVjMygwLjA1NSwgMC4wNTcsIDAuMDY2KSwgdmVjMygwLjk3NSwgMC45NzAsIDAuOTU1KSwKICAgICAgICAgICAgICAgICAgICAgICAgY2xhbXAodVNoYXBlVGludExpZ2h0c1tjaG9zZW5dLCAwLjAsIDEuMCkpOwogIGZsb2F0IHRpbnRPcGFjaXR5ID0gc21vb3Roc3RlcCgwLjAsIDEuNSwgdVNoYXBlVGludHNbY2hvc2VuXSkgKiAwLjc4OwogIHRyYW5zbWl0dGVkID0gbWl4KHRyYW5zbWl0dGVkLCB0aW50VGFyZ2V0LCB0aW50T3BhY2l0eSAqICgwLjg4ICsgZGVwdGggKiAwLjEyKSk7CgogIGZsb2F0IG1hc2sgPSAxLjAgLSBzbW9vdGhzdGVwKDAuMCwgMS4zNSwgY2hvc2VuRCk7CiAgZmxvYXQgdGhpblJpbSA9IGV4cCgtcG93KChjaG9zZW5EICsgMC42NSkgLyAxLjQsIDIuMCkpOwogIGZsb2F0IGlubmVyUmltID0gZXhwKC1wb3coKGNob3NlbkQgKyA2LjIpIC8gMy44LCAyLjApKTsKICBmbG9hdCBmcmVzbmVsID0gcG93KGNsYW1wKGVkZ2VDdXJ2ZSwgMC4wLCAxLjApLCAwLjcyKTsKICAvLyBBIHNvZnRlbmVkIGVudmlyb25tZW50IHByb2JlIGtlZXBzIG1vdmluZyB2aWRlby9mZWVkIGVkZ2VzIGZyb20gdHVybmluZwogIC8vIGludG8gb25lLWZyYW1lIHdoaXRlIGZsYXNoZXMgd2hpbGUgcHJlc2VydmluZyB0aGUgbG9jYWwgY29sb3VyIHJlc3BvbnNlLgogIHZlYzMgcmVmbGVjdGVkID0gc29mdEJhY2tkcm9wKChwb2ludCArIG5vcm1hbCAqICg4LjAgKyB1UmVmcmFjdGlvbiAqIDAuMTcpKSAvIHVSZXMsIDUuMik7CiAgdmVjMyBhZGFwdGl2ZVJpbSA9IHJlZmxlY3RlZCAqIDEuNDUgKyB2ZWMzKDAuMDYsIDAuMDM1LCAwLjA4KTsKICBhZGFwdGl2ZVJpbSA9IG1peChhZGFwdGl2ZVJpbSwgdmVjMygwLjk2LCAwLjk3LCAxLjApLCAwLjI0KTsKICBhZGFwdGl2ZVJpbSA9IG1peChhZGFwdGl2ZVJpbSwgdmVjMygwLjAzNSwgMC4wMjUsIDAuMDQ1KSwKICAgICAgICAgICAgICAgICAgICBzbW9vdGhzdGVwKDAuNzgsIDAuOTgsIGx1bWluYW5jZShyZWZsZWN0ZWQpKSAqIDAuNDgpOwoKICB2ZWMyIGxpZ2h0RGlyID0gbm9ybWFsaXplKHVMaWdodERpcnNbY2hvc2VuXSArIHZlYzIoMC4wMDAxKSk7CiAgZmxvYXQga2V5ID0gcG93KG1heChkb3Qobm9ybWFsLCBsaWdodERpciksIDAuMCksIDcuMCkgKiBmcmVzbmVsOwogIGZsb2F0IG9wcG9zaXRlID0gcG93KG1heChkb3Qobm9ybWFsLCAtbGlnaHREaXIpLCAwLjApLCA1LjApICogaW5uZXJSaW07CiAgdmVjMyBjb2xvciA9IHRyYW5zbWl0dGVkOwogIGNvbG9yID0gbWl4KGNvbG9yLCBhZGFwdGl2ZVJpbSwKICAgICAgICAgICAgICBjbGFtcCgodGhpblJpbSAqIDAuNDIgKyBpbm5lclJpbSAqIDAuMTggKyBmcmVzbmVsICogMC4xMCkKICAgICAgICAgICAgICAgICAgICAqIHVSaW0gKiB1UmVmbGVjdGlvbiwgMC4wLCAwLjcyKSk7CiAgY29sb3IgKz0gdmVjMygxLjAsIDAuODIsIDAuOTIpICoga2V5ICogMC4zMCAqIHVSaW0gKiB1SGlnaGxpZ2h0OwogIGNvbG9yICo9IDEuMCAtIG9wcG9zaXRlICogMC4xMiAqIHVSaW07CiAgZmxvYXQgZWNobyA9IGV4cCgtcG93KChjaG9zZW5EICsgMTEuMCkgLyA1LjUsIDIuMCkpOwogIHZlYzMgZWNob0NvbG9yID0gYmFja2Ryb3AoKHBvaW50IC0gbm9ybWFsICogMTEuMCkgLyB1UmVzKTsKICBjb2xvciA9IG1peChjb2xvciwgZWNob0NvbG9yICogMS4xMiwgZWNobyAqIDAuMDc1ICogdVJpbSAqIHVFY2hvKTsKCiAgZmxvYXQgZWRnZUFBID0gbWF4KGZ3aWR0aChjaG9zZW5EKSwgMC43Mik7CiAgZmxvYXQgbGluZVdpZHRoID0gbWl4KDAuMzQsIDEuMDgsIGNsYW1wKHVIYWlyV2lkdGgsIDAuMCwgMS4wKSk7CiAgZmxvYXQgc3Ryb2tlRGlzdGFuY2UgPSBhYnMoY2hvc2VuRCArIDAuMTApIC0gbGluZVdpZHRoICogMC41OwogIGZsb2F0IGhhaXJsaW5lID0gMS4wIC0gc21vb3Roc3RlcCgtZWRnZUFBICogMC43MiwgZWRnZUFBICogMC43Miwgc3Ryb2tlRGlzdGFuY2UpOwogIHZlYzMgaGFpckNvbG9yID0gaW50ZXJmYWNlQ29sb3IocG9pbnQsIG5vcm1hbCk7CiAgLy8gVGhlIGNvbnRyYXN0IGxpbmUgaXMgdGhlIGRlZmF1bHQgaW50ZXJmYWNlLiBPbiB0aGUgbGlnaHQtZmFjaW5nIGFyYyB0aGUKICAvLyBzcGVjdWxhciBrZXkgcmVwbGFjZXMgaXQgd2l0aCB0aGUgdGhpbiB3aGl0ZSBoaWdobGlnaHQgdmlzaWJsZSBpbiB0aGUKICAvLyBuYXRpdmUgbWF0ZXJpYWwgaW5zdGVhZCBvZiBtZXJlbHkgYnJpZ2h0ZW5pbmcgdGhlIGJsYWNrIGxpbmUgdW5kZXJuZWF0aC4KICBmbG9hdCBoYWlySGlnaGxpZ2h0ID0gY2xhbXAoa2V5ICogdUhpZ2hsaWdodCAqIDIuNSAqICgwLjY1ICsgdVJpbSAqIDAuNjApLCAwLjAsIDAuOTYpOwogIGhhaXJDb2xvciA9IG1peChoYWlyQ29sb3IsIHZlYzMoMC45ODUsIDAuOTksIDEuMCksIGhhaXJIaWdobGlnaHQpOwoKICAvLyBQcmVtdWx0aXBsaWVkIGxheWVyIGNvbXBvc2l0aW9uIGV4YWN0bHkgcmVwcm9kdWNlcyB0aGUgcHJvdG90eXBlJ3MgdHdvCiAgLy8gc2VxdWVudGlhbCBtaXhlcyB3aGVuIGRyYXduIG92ZXIgdGhlIHN1cHBsaWVkIGJhY2tkcm9wLCBhbmQgYWxzbyBhbGxvd3MKICAvLyB0aGUgc2FtZSBzaGFkZXIgdG8gd29yayBpbiBvdmVybGF5IG1vZGUgb3ZlciBhIERPTS9jYW52YXMgYmFja2Ryb3AuCiAgZmxvYXQgaGFpckFscGhhID0gY2xhbXAoaGFpcmxpbmUgKiB1SGFpcmxpbmUgKiAoMC4yMiArIHVSaW0gKiAwLjIwKSwgMC4wLCAxLjApOwogIGZsb2F0IGFscGhhID0gaGFpckFscGhhICsgbWFzayAqICgxLjAgLSBoYWlyQWxwaGEpOwogIHZlYzMgcHJlbXVsdGlwbGllZCA9IGhhaXJDb2xvciAqIGhhaXJBbHBoYSArIGNvbG9yICogbWFzayAqICgxLjAgLSBoYWlyQWxwaGEpOwogIGZsb2F0IHN1cmZhY2VPcGFjaXR5ID0gY2xhbXAodVNoYXBlT3BhY2l0aWVzW2Nob3Nlbl0sIDAuMCwgMS4wKTsKICBvdXRDb2xvciA9IHZlYzQocHJlbXVsdGlwbGllZCAqIHN1cmZhY2VPcGFjaXR5LCBhbHBoYSAqIHN1cmZhY2VPcGFjaXR5KTsKfWA7CgoKLy8gPT09PT0gZ2VvbWV0cnkuanMgPT09PT0KLy8gQ1BVIG1pcnJvciBvZiB0aGUgc2hhcGUgbWF0aHMgaW4gRlNfR0xBU1MuCi8vCi8vIFRoZSBzaGFkZXIgaXMgdGhlIHNvdXJjZSBvZiB0cnV0aCBmb3Igd2hhdCB0aGUgZ2xhc3MgbG9va3MgbGlrZSwgYnV0IGNhbGxlcnMKLy8gYWxzbyBuZWVkIHRoZSBzYW1lIGdlb21ldHJ5IG9uIHRoZSBDUFU6IHRvIGtub3cgd2hpY2ggY29tcG9uZW50IHRoZSBwb2ludGVyCi8vIGlzIG92ZXIsIGFuZCB0byBzcGxpdCBhIGxhcmdlIGVsZW1lbnQgbGlzdCBpbnRvIGdyb3VwcyB0aGF0IGNhbm5vdCBpbmZsdWVuY2UKLy8gZWFjaCBvdGhlci4gS2VlcGluZyBib3RoIGluIHRoaXMgbW9kdWxlIC0gZnJlZSBvZiBhbnkgV2ViR0wgb3IgRE9NCi8vIGRlcGVuZGVuY3kgLSBpcyB3aGF0IG1ha2VzIHRob3NlIHJ1bGVzIHVuaXQtdGVzdGFibGUuCi8vCi8vIEV2ZXJ5IGxlbmd0aCBoZXJlIGlzIGluIHRoZSBzYW1lIHVuaXQgYXMgdGhlIGVsZW1lbnQgY29vcmRpbmF0ZXMgKENTUyBwaXhlbHMKLy8gZm9yIHRoZSBwdWJsaWMgQVBJKS4gVGhlIHJlbmRlcmVyIGFwcGxpZXMgYGRwcmAgc2VwYXJhdGVseS4KCi8vIFRoZSBnbGFzcyBzaGFkZXIgY2FycmllcyB0aGUgZ3JvdXAgaW4gdW5pZm9ybSBhcnJheXMgb2YgdGhpcyBsZW5ndGguCmNvbnN0IE1BWF9HTEFTU19TSEFQRVMgPSAxNjsKCi8vIGBzZEdyb3VwYCB3ZWlnaHRzIGVhY2ggc2hhcGUgYnkgZXhwKC0oZCAtIG5lYXJlc3QpIC8gc2NhbGUpLiBQYXN0IHRoaXMgbWFueQovLyBtdWx0aXBsZXMgb2YgYHNjYWxlYCB0aGUgY29udHJpYnV0aW9uIGlzIGJlbG93IDEvMzAwMCBvZiBhIHBpeGVsIG9mIGRpc3RhbmNlLAovLyB3aGljaCBpcyBmYXIgdW5kZXIgdGhlIHF1YW50aXNhdGlvbiBvZiB0aGUgUkdCQTggb3V0cHV0LiBTaGFwZXMgc2VwYXJhdGVkIGJ5Ci8vIG1vcmUgdGhhbiB0aGF0IGNhbiBiZSBzaGFkZWQgaW4gZGlmZmVyZW50IGRyYXcgY2FsbHMgd2l0aG91dCBhIHZpc2libGUgc2VhbS4KY29uc3QgTUVSR0VfSU5GTFVFTkNFX1NDQUxFUyA9IDg7CgovLyBNYXRjaGVzIHRoZSBzaGFkZXI6IHNjYWxlID0gbWF4KG1lcmdlUmFkaXVzICogMC4zNiwgMC4wMSkuCmNvbnN0IE1FUkdFX1NDQUxFX1JBVElPID0gMC4zNjsKCi8vIEFwcGxlJ3MgZm9sZGVyIGNvcm5lciBpcyBjYXBwZWQgYXQgMjMuNSUgb2YgdGhlIHNob3J0IHNpZGUuCmNvbnN0IE1BWF9DT1JORVJfUkFUSU8gPSAwLjIzNTsKCmNvbnN0IFNIQVBFX1RZUEVTID0gT2JqZWN0LmZyZWV6ZSh7IHJlY3Q6IDAsIGZvbGRlcjogMCwgcGlsbDogMSwgY2lyY2xlOiAyIH0pOwoKZnVuY3Rpb24gc2hhcGVUeXBlT2Yoc2hhcGUpIHsKICByZXR1cm4gU0hBUEVfVFlQRVNbc2hhcGVdID8/IDA7Cn0KCi8qKiBDb3JuZXIgcmFkaXVzIHRoZSByZW5kZXJlciB3aWxsIHVzZSBmb3IgYW4gZWxlbWVudCwgYmVmb3JlIGBkcHJgLiAqLwpmdW5jdGlvbiBjb3JuZXJSYWRpdXNPZihlbGVtZW50LCBtYXRlcmlhbFJhZGl1cyA9IDApIHsKICBjb25zdCBzaG9ydCA9IE1hdGgubWluKGVsZW1lbnQudyA/PyBlbGVtZW50LndpZHRoID8/IDAsIGVsZW1lbnQuaCA/PyBlbGVtZW50LmhlaWdodCA/PyAwKTsKICByZXR1cm4gTWF0aC5taW4oZWxlbWVudC5yYWRpdXMgPz8gbWF0ZXJpYWxSYWRpdXMsIHNob3J0ICogTUFYX0NPUk5FUl9SQVRJTyk7Cn0KCi8qKiBTdXBlcmVsbGlwc2Ugcm91bmRlZCBib3gsIG1pcnJvcmluZyBgc2RTcXVpcmNsZWAgaW4gdGhlIGdsYXNzIHNoYWRlci4gKi8KZnVuY3Rpb24gc2RTcXVpcmNsZShweCwgcHksIGhhbGZYLCBoYWxmWSwgcmFkaXVzLCBleHBvbmVudCkgewogIGNvbnN0IHF4ID0gTWF0aC5hYnMocHgpIC0gaGFsZlggKyByYWRpdXM7CiAgY29uc3QgcXkgPSBNYXRoLmFicyhweSkgLSBoYWxmWSArIHJhZGl1czsKICBjb25zdCBteCA9IE1hdGgubWF4KHF4LCAwKSArIDFlLTU7CiAgY29uc3QgbXkgPSBNYXRoLm1heChxeSwgMCkgKyAxZS01OwogIGNvbnN0IGUgPSAobXggKiogZXhwb25lbnQgKyBteSAqKiBleHBvbmVudCkgKiogKDEgLyBleHBvbmVudCk7CiAgcmV0dXJuIE1hdGgubWluKE1hdGgubWF4KHF4LCBxeSksIDApICsgZSAtIHJhZGl1czsKfQoKLyoqIE1pcnJvcnMgYHNkUHJpbWl0aXZlYDogZXhhY3QgY2lyY2xlLCBleGFjdCBjYXBzdWxlLCBvciBzcXVpcmNsZSBmb2xkZXIuICovCmZ1bmN0aW9uIHNkUHJpbWl0aXZlKHB4LCBweSwgaGFsZlgsIGhhbGZZLCBzaGFwZVR5cGUsIHJhZGl1cywgc3F1aXJjbGUgPSAyKSB7CiAgaWYgKHNoYXBlVHlwZSA9PT0gMikgcmV0dXJuIE1hdGguaHlwb3QocHgsIHB5KSAtIE1hdGgubWluKGhhbGZYLCBoYWxmWSk7CiAgaWYgKHNoYXBlVHlwZSA9PT0gMSkgcmV0dXJuIHNkU3F1aXJjbGUocHgsIHB5LCBoYWxmWCwgaGFsZlksIE1hdGgubWluKGhhbGZYLCBoYWxmWSksIDIpOwogIHJldHVybiBzZFNxdWlyY2xlKHB4LCBweSwgaGFsZlgsIGhhbGZZLCByYWRpdXMsIE1hdGgubWF4KHNxdWlyY2xlLCAyKSk7Cn0KCmZ1bmN0aW9uIHRvU2hhcGUoZWxlbWVudCwgbWF0ZXJpYWwpIHsKICBjb25zdCB3ID0gZWxlbWVudC53ID8/IGVsZW1lbnQud2lkdGggPz8gZWxlbWVudC5zaXplID8/IDA7CiAgY29uc3QgaCA9IGVsZW1lbnQuaCA/PyBlbGVtZW50LmhlaWdodCA/PyBlbGVtZW50LnNpemUgPz8gdzsKICByZXR1cm4gewogICAgY3g6IChlbGVtZW50LnggPz8gMCkgKyB3IC8gMiwKICAgIGN5OiAoZWxlbWVudC55ID8/IDApICsgaCAvIDIsCiAgICBoYWxmWDogdyAvIDIsCiAgICBoYWxmWTogaCAvIDIsCiAgICB0eXBlOiBzaGFwZVR5cGVPZihlbGVtZW50LnNoYXBlKSwKICAgIHJhZGl1czogY29ybmVyUmFkaXVzT2YoeyAuLi5lbGVtZW50LCB3LCBoIH0sIG1hdGVyaWFsLnJhZGl1cyA/PyAwKSwKICB9Owp9CgovKioKICogU2lnbmVkIGRpc3RhbmNlIHRvIHRoZSBmdXNlZCBzaWxob3VldHRlIG9mIGBlbGVtZW50c2AsIGluIGVsZW1lbnQKICogY29vcmRpbmF0ZXMuIE1pcnJvcnMgYHNkQXBwbGVTaGFwZWAsIGluY2x1ZGluZyB0aGUgZ2xvYmFsIGV4cG9uZW50aWFsCiAqIHNtb290aC1taW4sIHNvIGEgaGl0IHRlc3QgYWdyZWVzIHdpdGggdGhlIHBpeGVscyB0aGUgc2hhZGVyIHByb2R1Y2VkLgogKgogKiBUaGUgc21vb3RoLW1pbiBwdWxscyB0aGUgc3VyZmFjZSBpbndhcmQgYnkgYXQgbW9zdCBgc2NhbGUgKiBsbigyKWAsIHdoaWNoIGlzCiAqIGEgcXVhcnRlciBvZiBgbWVyZ2VSYWRpdXNgLiBBIGdhcCBiZXR3ZWVuIHR3byBjb21wb25lbnRzIHRoZXJlZm9yZSBvbmx5CiAqIGNsb3NlcyBpbnRvIGEgYnJpZGdlIHdoaWxlIGl0IGlzIG5hcnJvd2VyIHRoYW4gYWJvdXQgYG1lcmdlUmFkaXVzIC8gMmA7CiAqIGJleW9uZCB0aGF0IHRoZSBmdXNpb24gZGlzdGFuY2Ugb25seSBzb2Z0ZW5zIHRoZSBhcHByb2FjaC4KICovCmZ1bmN0aW9uIHNkR3JvdXAoeCwgeSwgZWxlbWVudHMsIG1hdGVyaWFsID0ge30sIG1lcmdlUmFkaXVzID0gbWF0ZXJpYWwubWVyZ2VSYWRpdXMgPz8gMCkgewogIGlmICghZWxlbWVudHMubGVuZ3RoKSByZXR1cm4gSW5maW5pdHk7CiAgY29uc3Qgc2hhcGVzID0gZWxlbWVudHMubWFwKChlbGVtZW50KSA9PiB0b1NoYXBlKGVsZW1lbnQsIG1hdGVyaWFsKSk7CiAgY29uc3Qgc3F1aXJjbGUgPSBtYXRlcmlhbC5zcXVpcmNsZSA/PyAyOwoKICBsZXQgbmVhcmVzdCA9IEluZmluaXR5OwogIGNvbnN0IGRpc3RhbmNlcyA9IHNoYXBlcy5tYXAoKHNoYXBlKSA9PiB7CiAgICBjb25zdCBkID0gc2RQcmltaXRpdmUoeCAtIHNoYXBlLmN4LCB5IC0gc2hhcGUuY3ksIHNoYXBlLmhhbGZYLCBzaGFwZS5oYWxmWSwKICAgICAgICAgICAgICAgICAgICAgICAgICBzaGFwZS50eXBlLCBzaGFwZS5yYWRpdXMsIHNxdWlyY2xlKTsKICAgIGlmIChkIDwgbmVhcmVzdCkgbmVhcmVzdCA9IGQ7CiAgICByZXR1cm4gZDsKICB9KTsKCiAgaWYgKCEobWVyZ2VSYWRpdXMgPj0gMC4wMSkgfHwgc2hhcGVzLmxlbmd0aCA9PT0gMSkgcmV0dXJuIG5lYXJlc3Q7CgogIGNvbnN0IHNjYWxlID0gTWF0aC5tYXgobWVyZ2VSYWRpdXMgKiBNRVJHRV9TQ0FMRV9SQVRJTywgMC4wMSk7CiAgbGV0IHN1bSA9IDA7CiAgZm9yIChjb25zdCBkIG9mIGRpc3RhbmNlcykgc3VtICs9IE1hdGguZXhwKC0oZCAtIG5lYXJlc3QpIC8gc2NhbGUpOwogIHJldHVybiBuZWFyZXN0IC0gc2NhbGUgKiBNYXRoLmxvZyhNYXRoLm1heChzdW0sIDFlLTYpKTsKfQoKLyoqCiAqIFRoZSBlbGVtZW50IHdob3NlIG93biBwcmltaXRpdmUgaXMgbmVhcmVzdCB0byB0aGUgcG9pbnQsIG9yIGBudWxsYCB3aGVuIHRoZQogKiBwb2ludCBpcyBvdXRzaWRlIHRoZSBmdXNlZCBzdXJmYWNlLiBgdG9sZXJhbmNlYCBncm93cyB0aGUgaGl0IGFyZWEsIHdoaWNoIGlzCiAqIHdoYXQgYSBjb2Fyc2UgcG9pbnRlciAodG91Y2gpIHdhbnRzLgogKi8KZnVuY3Rpb24gaGl0VGVzdEVsZW1lbnRzKHgsIHksIGVsZW1lbnRzLCBtYXRlcmlhbCA9IHt9LCBvcHRpb25zID0ge30pIHsKICBjb25zdCBtZXJnZVJhZGl1cyA9IG9wdGlvbnMuZnVzaW9uID09PSBmYWxzZQogICAgPyAwCiAgICA6IChvcHRpb25zLm1lcmdlUmFkaXVzID8/IG1hdGVyaWFsLm1lcmdlUmFkaXVzID8/IDApOwogIGNvbnN0IHRvbGVyYW5jZSA9IG9wdGlvbnMudG9sZXJhbmNlID8/IDA7CiAgY29uc3Qgc3F1aXJjbGUgPSBtYXRlcmlhbC5zcXVpcmNsZSA/PyAyOwoKICAvLyBTZXBhcmF0ZSBlbGVtZW50cyBhcmUgc2VwYXJhdGUgZHJhdyBjYWxscy4gVGhlIGxhc3Qgb25lIHBhaW50ZWQgb3ducyBldmVyeQogIC8vIG92ZXJsYXBwaW5nIHBpeGVsLCByZWdhcmRsZXNzIG9mIGhvdyBkZWVwbHkgdGhlIHBvaW50IGxpZXMgaW5zaWRlIGFuIG9sZGVyCiAgLy8gZWxlbWVudC4gUGlja2luZyB0aGUgbW9zdC1uZWdhdGl2ZSBkaXN0YW5jZSBoZXJlIHdvdWxkIG1ha2UgYSBsYXJnZSBjYXJkCiAgLy8gc3RlYWwgY2xpY2tzIGZyb20gYSBzbWFsbGVyIGJ1dHRvbiBkcmF3biBvbiB0b3Agb2YgaXQuCiAgaWYgKG9wdGlvbnMuZnVzaW9uID09PSBmYWxzZSkgewogICAgZm9yIChsZXQgaSA9IGVsZW1lbnRzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7CiAgICAgIGNvbnN0IHNoYXBlID0gdG9TaGFwZShlbGVtZW50c1tpXSwgbWF0ZXJpYWwpOwogICAgICBjb25zdCBkID0gc2RQcmltaXRpdmUoeCAtIHNoYXBlLmN4LCB5IC0gc2hhcGUuY3ksIHNoYXBlLmhhbGZYLCBzaGFwZS5oYWxmWSwKICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNoYXBlLnR5cGUsIHNoYXBlLnJhZGl1cywgc3F1aXJjbGUpOwogICAgICBpZiAoZCA8PSB0b2xlcmFuY2UpIHJldHVybiBlbGVtZW50c1tpXTsKICAgIH0KICAgIHJldHVybiBudWxsOwogIH0KCiAgLy8gTWlycm9yIHRoZSByZW5kZXJlcidzIGNvbm5lY3RlZC1jb21wb25lbnQgc3BsaXR0aW5nIGFuZCAxNi1zaGFwZSBjaHVua3MuCiAgLy8gSW4gcGFydGljdWxhciwgZG8gbm90IGludmVudCBhIHNtb290aC11bmlvbiBicmlkZ2UgYWNyb3NzIGEgY2h1bmsgYm91bmRhcnkKICAvLyB0aGF0IHRoZSBHUFUgY2Fubm90IGRyYXcuIEl0ZXJhdGUgYmFja3dhcmRzIGJlY2F1c2UgbGF0ZXIgcGFzc2VzIGNvbXBvc2l0ZQogIC8vIG92ZXIgZWFybGllciBvbmVzIHdoZW4gc2VwYXJhdGVseSByZW5kZXJlZCBncm91cHMgb3ZlcmxhcC4KICBjb25zdCBncm91cHMgPSBncm91cEVsZW1lbnRzKGVsZW1lbnRzLCBtZXJnZVJhZGl1cywgTUFYX0dMQVNTX1NIQVBFUykuZ3JvdXBzOwogIGZvciAobGV0IGdyb3VwSW5kZXggPSBncm91cHMubGVuZ3RoIC0gMTsgZ3JvdXBJbmRleCA+PSAwOyBncm91cEluZGV4LS0pIHsKICAgIGNvbnN0IGdyb3VwID0gZ3JvdXBzW2dyb3VwSW5kZXhdOwogICAgaWYgKHNkR3JvdXAoeCwgeSwgZ3JvdXAsIG1hdGVyaWFsLCBtZXJnZVJhZGl1cykgPiB0b2xlcmFuY2UpIGNvbnRpbnVlOwoKICAgIGxldCBiZXN0ID0gbnVsbDsKICAgIGxldCBiZXN0RGlzdGFuY2UgPSBJbmZpbml0eTsKICAgIGZvciAobGV0IGkgPSBncm91cC5sZW5ndGggLSAxOyBpID49IDA7IGktLSkgewogICAgICBjb25zdCBzaGFwZSA9IHRvU2hhcGUoZ3JvdXBbaV0sIG1hdGVyaWFsKTsKICAgICAgY29uc3QgZCA9IHNkUHJpbWl0aXZlKHggLSBzaGFwZS5jeCwgeSAtIHNoYXBlLmN5LCBzaGFwZS5oYWxmWCwgc2hhcGUuaGFsZlksCiAgICAgICAgICAgICAgICAgICAgICAgICAgICBzaGFwZS50eXBlLCBzaGFwZS5yYWRpdXMsIHNxdWlyY2xlKTsKICAgICAgaWYgKGQgPCBiZXN0RGlzdGFuY2UpIHsKICAgICAgICBiZXN0RGlzdGFuY2UgPSBkOwogICAgICAgIGJlc3QgPSBncm91cFtpXTsKICAgICAgfQogICAgfQogICAgcmV0dXJuIGJlc3Q7CiAgfQogIHJldHVybiBudWxsOwp9CgovKiogU2lnbmVkIGRpc3RhbmNlIHRvIHRoZSBleGFjdCBzaWxob3VldHRlIHByb2R1Y2VkIGJ5IHRoZSByZW5kZXJlcidzIHBhc3Nlcy4gKi8KZnVuY3Rpb24gc2RSZW5kZXJlZEdyb3VwcygKICB4LCB5LCBlbGVtZW50cywgbWF0ZXJpYWwgPSB7fSwgbWVyZ2VSYWRpdXMgPSBtYXRlcmlhbC5tZXJnZVJhZGl1cyA/PyAwLAopIHsKICBjb25zdCBncm91cHMgPSBncm91cEVsZW1lbnRzKGVsZW1lbnRzLCBtZXJnZVJhZGl1cywgTUFYX0dMQVNTX1NIQVBFUykuZ3JvdXBzOwogIGlmICghZ3JvdXBzLmxlbmd0aCkgcmV0dXJuIEluZmluaXR5OwogIGxldCBiZXN0RGlzdGFuY2UgPSBJbmZpbml0eTsKICBmb3IgKGNvbnN0IGdyb3VwIG9mIGdyb3VwcykgewogICAgY29uc3QgZCA9IHNkR3JvdXAoeCwgeSwgZ3JvdXAsIG1hdGVyaWFsLCBtZXJnZVJhZGl1cyk7CiAgICBpZiAoZCA8IGJlc3REaXN0YW5jZSkgYmVzdERpc3RhbmNlID0gZDsKICB9CiAgcmV0dXJuIGJlc3REaXN0YW5jZTsKfQoKLyoqIEF4aXMtYWxpZ25lZCBnYXAgYmV0d2VlbiB0d28gZWxlbWVudCBib3hlczsgMCB3aGVuIHRoZXkgb3ZlcmxhcC4gKi8KZnVuY3Rpb24gYm94R2FwKGEsIGIpIHsKICBjb25zdCBib3ggPSAoZWxlbWVudCkgPT4gewogICAgY29uc3QgdyA9IE51bWJlcihlbGVtZW50LncgPz8gZWxlbWVudC53aWR0aCA/PyBlbGVtZW50LnNpemUgPz8gMCk7CiAgICBjb25zdCBoID0gTnVtYmVyKGVsZW1lbnQuaCA/PyBlbGVtZW50LmhlaWdodCA/PyBlbGVtZW50LnNpemUgPz8gdyk7CiAgICByZXR1cm4geyB4OiBOdW1iZXIoZWxlbWVudC54ID8/IDApLCB5OiBOdW1iZXIoZWxlbWVudC55ID8/IDApLCB3LCBoIH07CiAgfTsKICBjb25zdCBhYSA9IGJveChhKTsKICBjb25zdCBiYiA9IGJveChiKTsKICBjb25zdCBkeCA9IE1hdGgubWF4KDAsIE1hdGgubWF4KGFhLnggLSAoYmIueCArIGJiLncpLCBiYi54IC0gKGFhLnggKyBhYS53KSkpOwogIGNvbnN0IGR5ID0gTWF0aC5tYXgoMCwgTWF0aC5tYXgoYWEueSAtIChiYi55ICsgYmIuaCksIGJiLnkgLSAoYWEueSArIGFhLmgpKSk7CiAgcmV0dXJuIE1hdGguaHlwb3QoZHgsIGR5KTsKfQoKLyoqCiAqIFNwbGl0IGVsZW1lbnRzIGludG8gc2V0cyB0aGF0IGNhbiBiZSBzaGFkZWQgaW5kZXBlbmRlbnRseS4KICoKICogVHdvIGVsZW1lbnRzIGxhbmQgaW4gdGhlIHNhbWUgc2V0IHdoZW4gdGhlaXIgYm94ZXMgYXJlIGNsb3NlIGVub3VnaCBmb3IgdGhlCiAqIHNtb290aC1taW4gdG8gYnJpZGdlIHRoZW0uIEVsZW1lbnRzIGZ1cnRoZXIgYXBhcnQgdGhhbiB0aGUgaW5mbHVlbmNlIHJhZGl1cwogKiBjb250cmlidXRlIG5vdGhpbmcgbWVhc3VyYWJsZSB0byBlYWNoIG90aGVyJ3MgZGlzdGFuY2UgZmllbGQsIHNvIGRyYXdpbmcKICogdGhlbSBpbiBzZXBhcmF0ZSBwYXNzZXMgaXMgdmlzdWFsbHkgaWRlbnRpY2FsIHRvIG9uZSBmdXNlZCBwYXNzLgogKi8KZnVuY3Rpb24gY29ubmVjdGVkRWxlbWVudEdyb3VwcyhlbGVtZW50cywgbWVyZ2VSYWRpdXMgPSAwKSB7CiAgaWYgKGVsZW1lbnRzLmxlbmd0aCA8PSAxKSByZXR1cm4gZWxlbWVudHMubGVuZ3RoID8gW2VsZW1lbnRzLnNsaWNlKCldIDogW107CiAgY29uc3QgcmVhY2ggPSBNYXRoLm1heCgwLCBtZXJnZVJhZGl1cykgKiBNRVJHRV9TQ0FMRV9SQVRJTyAqIE1FUkdFX0lORkxVRU5DRV9TQ0FMRVM7CgogIGNvbnN0IHBhcmVudCA9IGVsZW1lbnRzLm1hcCgoXywgaSkgPT4gaSk7CiAgY29uc3QgZmluZCA9IChpKSA9PiB7CiAgICB3aGlsZSAocGFyZW50W2ldICE9PSBpKSB7IHBhcmVudFtpXSA9IHBhcmVudFtwYXJlbnRbaV1dOyBpID0gcGFyZW50W2ldOyB9CiAgICByZXR1cm4gaTsKICB9OwogIGZvciAobGV0IGkgPSAwOyBpIDwgZWxlbWVudHMubGVuZ3RoOyBpKyspIHsKICAgIGZvciAobGV0IGogPSBpICsgMTsgaiA8IGVsZW1lbnRzLmxlbmd0aDsgaisrKSB7CiAgICAgIGlmIChib3hHYXAoZWxlbWVudHNbaV0sIGVsZW1lbnRzW2pdKSA8PSByZWFjaCkgcGFyZW50W2ZpbmQoaSldID0gZmluZChqKTsKICAgIH0KICB9CgogIGNvbnN0IGJ5Um9vdCA9IG5ldyBNYXAoKTsKICBlbGVtZW50cy5mb3JFYWNoKChlbGVtZW50LCBpKSA9PiB7CiAgICBjb25zdCByb290ID0gZmluZChpKTsKICAgIGlmICghYnlSb290Lmhhcyhyb290KSkgYnlSb290LnNldChyb290LCBbXSk7CiAgICBieVJvb3QuZ2V0KHJvb3QpLnB1c2goZWxlbWVudCk7CiAgfSk7CgogIHJldHVybiBbLi4uYnlSb290LnZhbHVlcygpXTsKfQoKLyoqCiAqIENvbm5lY3RlZCBzZXRzLCBmdXJ0aGVyIGNodW5rZWQgc28gbm8gZ3JvdXAgZXhjZWVkcyB0aGUgc2hhZGVyJ3MgdW5pZm9ybQogKiBhcnJheXMuIEEgY2h1bmtlZCBzZXQgaXMgdGhlIG9ubHkgbG9zc3kgY2FzZTogc2hhcGVzIHRoYXQgcmVhbGx5IGRvIGluZmx1ZW5jZQogKiBlYWNoIG90aGVyIGVuZCB1cCBpbiBkaWZmZXJlbnQgcGFzc2VzLCBzbyBjYWxsZXJzIHNob3VsZCBzdXJmYWNlIGEgd2FybmluZwogKiB3aGVuIGBncm91cEVsZW1lbnRzYCByZXBvcnRzIGl0LgogKi8KZnVuY3Rpb24gZ3JvdXBFbGVtZW50cyhlbGVtZW50cywgbWVyZ2VSYWRpdXMgPSAwLCBtYXhQZXJHcm91cCA9IE1BWF9HTEFTU19TSEFQRVMpIHsKICBjb25zdCBjb25uZWN0ZWQgPSBjb25uZWN0ZWRFbGVtZW50R3JvdXBzKGVsZW1lbnRzLCBtZXJnZVJhZGl1cyk7CiAgY29uc3QgZ3JvdXBzID0gW107CiAgbGV0IHRydW5jYXRlZCA9IGZhbHNlOwogIGZvciAoY29uc3QgZ3JvdXAgb2YgY29ubmVjdGVkKSB7CiAgICBpZiAoZ3JvdXAubGVuZ3RoID4gbWF4UGVyR3JvdXApIHRydW5jYXRlZCA9IHRydWU7CiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGdyb3VwLmxlbmd0aDsgaSArPSBtYXhQZXJHcm91cCkgewogICAgICBncm91cHMucHVzaChncm91cC5zbGljZShpLCBpICsgbWF4UGVyR3JvdXApKTsKICAgIH0KICB9CiAgcmV0dXJuIHsgZ3JvdXBzLCB0cnVuY2F0ZWQgfTsKfQoKCi8vID09PT09IHYyLWdlb21ldHJ5LmpzID09PT09Ci8vIENQVSBtaXJyb3Igb2YgdGhlIFYyIHRyYW5zcGFyZW50IHNoYWRlcidzIGdlb21ldHJ5LiBWMiBrZWVwcyBpdHMgaW5kZXBlbmRlbnQKLy8gb3B0aWNhbCBtYXRlcmlhbCBhbmQgbm9uLWZ1c2luZyBwYXNzZXMsIGJ1dCB1c2VzIHRoZSBzYW1lIHRocmVlIHZpc3VhbAovLyBwcmltaXRpdmVzIGFzIFYxOiBmb2xkZXIvcmVjdCwgY2Fwc3VsZSBhbmQgY2lyY2xlLgoKY29uc3QgU0hBUEVfVFlQRVNfVjIgPSBPYmplY3QuZnJlZXplKHsgcmVjdDogMCwgZm9sZGVyOiAwLCBwaWxsOiAxLCBjaXJjbGU6IDIgfSk7CgpmdW5jdGlvbiBzaGFwZVR5cGVPZlYyKHNoYXBlKSB7CiAgcmV0dXJuIFNIQVBFX1RZUEVTX1YyW3NoYXBlXSA/PyAwOwp9CgpmdW5jdGlvbiBzZFJvdW5kQm94VjIocHgsIHB5LCBoYWxmWCwgaGFsZlksIHJhZGl1cykgewogIGNvbnN0IHIgPSBNYXRoLm1pbihyYWRpdXMsIGhhbGZYLCBoYWxmWSk7CiAgY29uc3QgcXggPSBNYXRoLmFicyhweCkgLSBoYWxmWCArIHI7CiAgY29uc3QgcXkgPSBNYXRoLmFicyhweSkgLSBoYWxmWSArIHI7CiAgcmV0dXJuIE1hdGgubWluKE1hdGgubWF4KHF4LCBxeSksIDApICsgTWF0aC5oeXBvdChNYXRoLm1heChxeCwgMCksIE1hdGgubWF4KHF5LCAwKSkgLSByOwp9CgpmdW5jdGlvbiBzbW9vdGhVbmlvblYyKGQxLCBkMiwgcmFkaXVzKSB7CiAgaWYgKCEocmFkaXVzID4gMCkpIHJldHVybiBNYXRoLm1pbihkMSwgZDIpOwogIGNvbnN0IGggPSBNYXRoLm1heCgwLCBNYXRoLm1pbigxLCAwLjUgKyAwLjUgKiAoZDIgLSBkMSkgLyByYWRpdXMpKTsKICByZXR1cm4gZDIgKiAoMSAtIGgpICsgZDEgKiBoIC0gcmFkaXVzICogaCAqICgxIC0gaCk7Cn0KCmZ1bmN0aW9uIGNvcm5lclJhZGl1c1YyKGVsZW1lbnQsIHJvdW5kbmVzcyA9IDAuNDcpIHsKICBjb25zdCB3aWR0aCA9IE51bWJlcihlbGVtZW50LncgPz8gZWxlbWVudC53aWR0aCA/PyBlbGVtZW50LnNpemUgPz8gMCk7CiAgY29uc3QgaGVpZ2h0ID0gTnVtYmVyKGVsZW1lbnQuaCA/PyBlbGVtZW50LmhlaWdodCA/PyBlbGVtZW50LnNpemUgPz8gd2lkdGgpOwogIC8vIEEgY2FsbGVyIG1heSBwcm92aWRlIGEgQ1NTLXBpeGVsIHJhZGl1cyBmb3Igc3VyZmFjZXMgdGhhdCBtdXN0IHJlZ2lzdGVyCiAgLy8gdG8gYW4gZXh0ZXJuYWwgZnJhbWUgKGZvciBleGFtcGxlIHRoZSBpUGhvbmUgc2NyZWVuIG1hc2spLiAgS2VlcCB0aGUgVjIKICAvLyBtYXRlcmlhbCByYXRpbyBhcyB0aGUgZGVmYXVsdCBmb3IgYXV0aG9yZWQgY29tcG9uZW50cywgYnV0IGhvbm91ciBhbgogIC8vIGV4cGxpY2l0IHJhZGl1cyB3aGVuIGV4YWN0IGdlb21ldHJ5IG1hdHRlcnMuCiAgaWYgKE51bWJlci5pc0Zpbml0ZShlbGVtZW50LnJhZGl1cykpIHsKICAgIHJldHVybiBNYXRoLm1heCgwLCBNYXRoLm1pbihOdW1iZXIoZWxlbWVudC5yYWRpdXMpLCBNYXRoLm1pbih3aWR0aCwgaGVpZ2h0KSAqIDAuNSkpOwogIH0KICByZXR1cm4gTWF0aC5taW4od2lkdGgsIGhlaWdodCkgKiAwLjUgKiByb3VuZG5lc3M7Cn0KCmZ1bmN0aW9uIHNkRWxlbWVudFYyKHgsIHksIGVsZW1lbnQsIG1hdGVyaWFsID0ge30pIHsKICBjb25zdCB3aWR0aCA9IE51bWJlcihlbGVtZW50LncgPz8gZWxlbWVudC53aWR0aCA/PyBlbGVtZW50LnNpemUgPz8gMCk7CiAgY29uc3QgaGVpZ2h0ID0gTnVtYmVyKGVsZW1lbnQuaCA/PyBlbGVtZW50LmhlaWdodCA/PyBlbGVtZW50LnNpemUgPz8gd2lkdGgpOwogIGNvbnN0IGhhbGZYID0gd2lkdGggLyAyOwogIGNvbnN0IGhhbGZZID0gaGVpZ2h0IC8gMjsKICBjb25zdCBweCA9IHggLSBOdW1iZXIoZWxlbWVudC54ID8/IDApIC0gaGFsZlg7CiAgY29uc3QgcHkgPSB5IC0gTnVtYmVyKGVsZW1lbnQueSA/PyAwKSAtIGhhbGZZOwogIGNvbnN0IGtpbmQgPSBzaGFwZVR5cGVPZlYyKGVsZW1lbnQuc2hhcGUpOwogIGNvbnN0IHJhZGl1cyA9IGNvcm5lclJhZGl1c1YyKHsgLi4uZWxlbWVudCwgdzogd2lkdGgsIGg6IGhlaWdodCB9LCBtYXRlcmlhbC5yb3VuZG5lc3MgPz8gMC40Nyk7CgogIGlmIChraW5kID09PSAxKSByZXR1cm4gc2RSb3VuZEJveFYyKHB4LCBweSwgaGFsZlgsIGhhbGZZLCBNYXRoLm1pbihoYWxmWCwgaGFsZlkpKTsKICBpZiAoa2luZCA9PT0gMikgcmV0dXJuIE1hdGguaHlwb3QocHgsIHB5KSAtIE1hdGgubWluKGhhbGZYLCBoYWxmWSk7CiAgcmV0dXJuIHNkUm91bmRCb3hWMihweCwgcHksIGhhbGZYLCBoYWxmWSwgcmFkaXVzKTsKfQoKZnVuY3Rpb24gZGlzdGFuY2VUb0VsZW1lbnRzVjIoeCwgeSwgZWxlbWVudHMsIG1hdGVyaWFsID0ge30pIHsKICBsZXQgbmVhcmVzdCA9IEluZmluaXR5OwogIGZvciAoY29uc3QgZWxlbWVudCBvZiBlbGVtZW50cykgbmVhcmVzdCA9IE1hdGgubWluKG5lYXJlc3QsIHNkRWxlbWVudFYyKHgsIHksIGVsZW1lbnQsIG1hdGVyaWFsKSk7CiAgcmV0dXJuIG5lYXJlc3Q7Cn0KCmZ1bmN0aW9uIGhpdFRlc3RFbGVtZW50c1YyKHgsIHksIGVsZW1lbnRzLCBtYXRlcmlhbCA9IHt9LCBvcHRpb25zID0ge30pIHsKICBjb25zdCB0b2xlcmFuY2UgPSBvcHRpb25zLnRvbGVyYW5jZSA/PyAwOwogIC8vIFRoZSBWMiBzaGFkZXIgcmVzb2x2ZXMgb3ZlcmxhcCBieSB0YWtpbmcgdGhlIGxhc3QgbWF0Y2hpbmcgc3VyZmFjZS4KICBmb3IgKGxldCBpID0gZWxlbWVudHMubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHsKICAgIGlmIChzZEVsZW1lbnRWMih4LCB5LCBlbGVtZW50c1tpXSwgbWF0ZXJpYWwpIDw9IHRvbGVyYW5jZSkgcmV0dXJuIGVsZW1lbnRzW2ldOwogIH0KICByZXR1cm4gbnVsbDsKfQoKCi8vID09PT09IHYyLW1hdGVyaWFsLmpzID09PT09Ci8vIFYyIGlzIHRoZSBjbGVhciBvcHRpY2FsIG1hdGVyaWFsIGZyb20gdGhlIHRyYW5zcGFyZW50IHJlbmRlcmVyLiBUaGVzZQovLyB2YWx1ZXMgZGVsaWJlcmF0ZWx5IGxpdmUgb3V0c2lkZSBtYXRlcmlhbC5qczogc2ltaWxhcmx5IG5hbWVkIFYxIGNvbnRyb2xzCi8vIChub3RhYmx5IGRpc3BlcnNpb24gYW5kIGVkZ2VXaWR0aCkgdXNlIGRpZmZlcmVudCB1bml0cyBhbmQgc2hhZGVyIG1hdGhzLgpjb25zdCBERUZBVUxUX01BVEVSSUFMX1YyID0gT2JqZWN0LmZyZWV6ZSh7CiAgcmVmcmFjdGlvbjogOTAsCiAgZWRnZVJlYWNoOiAwLAogIGVkZ2VXaWR0aDogMCwKICBkaXNwZXJzaW9uOiAyLjAsCiAgLy8gRGltZW5zaW9ubGVzcyBzb2Z0bmVzcyByYXRpby4gVGhlIHNoYWRlciBtdWx0aXBsaWVzIHRoaXMgYnkgZWFjaAogIC8vIGNvbXBvbmVudCdzIHNob3J0IHNpZGUsIHNvIHRoZSBzYW1lIHZhbHVlIHN0YXlzIGRlbGljYXRlIG9uIHNtYWxsIGljb25zCiAgLy8gYW5kIGJlY29tZXMgZGVuc2VyIG9uIGxhcmdlciBjYXJkcy4KICBmcm9zdDogMC4xOCwKICBib2R5OiAwLjcyLAogIGFic29ycHRpb246IDAuNTgsCiAgdGludDogMCwKICByaW06IDAuNzIsCiAgcmVmbGVjdGlvbjogMC42OCwKICBoaWdobGlnaHQ6IDAuMzgsCiAgbGlnaHRBbmdsZTogMTM2LAogIGVjaG86IDAuMjgsCiAgaGFpcmxpbmU6IDAuOTIsCiAgaGFpcldpZHRoOiAwLjUyLAogIHJvdW5kbmVzczogMC40NywKfSk7Cgpjb25zdCBSRURVQ0VEX1RSQU5TUEFSRU5DWV9NQVRFUklBTF9WMiA9IE9iamVjdC5mcmVlemUoewogIHJlZnJhY3Rpb246IDAsCiAgZWRnZVJlYWNoOiAwLAogIGRpc3BlcnNpb246IDAsCiAgZnJvc3Q6IDAsCiAgYm9keTogMS41LAogIHRpbnQ6IDEuMzUsCiAgcmVmbGVjdGlvbjogMC4xOCwKICBoaWdobGlnaHQ6IDAuMTIsCiAgZWNobzogMCwKfSk7Cgpjb25zdCBTTElERVJTX1YyID0gT2JqZWN0LmZyZWV6ZShbCiAgWydyZWZyYWN0aW9uJywgMCwgMTEwLCAxXSwKICBbJ2VkZ2VSZWFjaCcsIDAsIDE2MCwgMV0sCiAgWydlZGdlV2lkdGgnLCAwLCAwLjU1LCAwLjAxXSwKICBbJ2Rpc3BlcnNpb24nLCAwLCA3LCAwLjFdLAogIFsnZnJvc3QnLCAwLCAxLCAwLjAxXSwKICBbJ2JvZHknLCAwLCAxLjUsIDAuMDFdLAogIFsnYWJzb3JwdGlvbicsIDAsIDIsIDAuMDFdLAogIFsndGludCcsIDAsIDEuNSwgMC4wMV0sCiAgWydyaW0nLCAwLCAxLCAwLjAxXSwKICBbJ3JlZmxlY3Rpb24nLCAwLCAxLjUsIDAuMDFdLAogIFsnaGlnaGxpZ2h0JywgMCwgMS41LCAwLjAxXSwKICBbJ2xpZ2h0QW5nbGUnLCAtMTgwLCAxODAsIDFdLAogIFsnZWNobycsIDAsIDEuNSwgMC4wMV0sCiAgWydoYWlybGluZScsIDAsIDEuNSwgMC4wMV0sCiAgWydoYWlyV2lkdGgnLCAwLCAxLCAwLjAxXSwKICBbJ3JvdW5kbmVzcycsIDAuMDUsIDAuNiwgMC4wMV0sCl0pOwoKLyoqIFJldHVybiBhIGZyZXNoIFYyIG1hdGVyaWFsLiBObyBWMSBwcmVzZXQgb3IgcGFyYW1ldGVyIGNvbnZlcnNpb24gaXMgdXNlZC4gKi8KZnVuY3Rpb24gZ2V0RGVmYXVsdE1hdGVyaWFsVjIoKSB7CiAgcmV0dXJuIHsgLi4uREVGQVVMVF9NQVRFUklBTF9WMiB9Owp9CgpmdW5jdGlvbiBtYWtlTWF0ZXJpYWxWMihvdmVycmlkZXMgPSB7fSkgewogIGlmICh0eXBlb2Ygb3ZlcnJpZGVzID09PSAnc3RyaW5nJykgewogICAgdGhyb3cgbmV3IFR5cGVFcnJvcignTGlxdWlkIEdsYXNzIFYyIGRvZXMgbm90IHVzZSBWMSBwcmVzZXQgbmFtZXMuJyk7CiAgfQogIGNvbnN0IHVua25vd24gPSBPYmplY3Qua2V5cyhvdmVycmlkZXMgfHwge30pLmZpbHRlcigoa2V5KSA9PiAhKGtleSBpbiBERUZBVUxUX01BVEVSSUFMX1YyKSk7CiAgaWYgKHVua25vd24ubGVuZ3RoKSB7CiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBVbmtub3duIExpcXVpZCBHbGFzcyBWMiBtYXRlcmlhbCBwYXJhbWV0ZXIke3Vua25vd24ubGVuZ3RoID09PSAxID8gJycgOiAncyd9OiAke3Vua25vd24uam9pbignLCAnKX1gKTsKICB9CiAgcmV0dXJuIHsgLi4uZ2V0RGVmYXVsdE1hdGVyaWFsVjIoKSwgLi4uKG92ZXJyaWRlcyB8fCB7fSkgfTsKfQoKCi8vID09PT09IHJlbmRlcmVyLmpzID09PT09CgoKCgpmdW5jdGlvbiBjb21waWxlKGdsLCB0eXBlLCBzcmMpIHsKICBjb25zdCBzID0gZ2wuY3JlYXRlU2hhZGVyKHR5cGUpOwogIGdsLnNoYWRlclNvdXJjZShzLCBzcmMpOwogIGdsLmNvbXBpbGVTaGFkZXIocyk7CiAgaWYgKCFnbC5nZXRTaGFkZXJQYXJhbWV0ZXIocywgZ2wuQ09NUElMRV9TVEFUVVMpKSB7CiAgICBjb25zdCBsb2cgPSBnbC5nZXRTaGFkZXJJbmZvTG9nKHMpOwogICAgZ2wuZGVsZXRlU2hhZGVyKHMpOwogICAgdGhyb3cgbmV3IEVycm9yKGxvZyArICdcbicgKyBzcmMpOwogIH0KICByZXR1cm4gczsKfQoKZnVuY3Rpb24gcHJvZ3JhbShnbCwgdnMsIGZzKSB7CiAgY29uc3QgcCA9IGdsLmNyZWF0ZVByb2dyYW0oKTsKICBjb25zdCB2ZXJ0ZXggPSBjb21waWxlKGdsLCBnbC5WRVJURVhfU0hBREVSLCB2cyk7CiAgbGV0IGZyYWdtZW50OwogIHRyeSB7CiAgICBmcmFnbWVudCA9IGNvbXBpbGUoZ2wsIGdsLkZSQUdNRU5UX1NIQURFUiwgZnMpOwogIH0gY2F0Y2ggKGVycm9yKSB7CiAgICBnbC5kZWxldGVTaGFkZXIodmVydGV4KTsKICAgIGdsLmRlbGV0ZVByb2dyYW0ocCk7CiAgICB0aHJvdyBlcnJvcjsKICB9CiAgZ2wuYXR0YWNoU2hhZGVyKHAsIHZlcnRleCk7CiAgZ2wuYXR0YWNoU2hhZGVyKHAsIGZyYWdtZW50KTsKICBnbC5saW5rUHJvZ3JhbShwKTsKICAvLyBUaGUgc2hhZGVyIG9iamVjdHMgb25seSBleGlzdCB0byBidWlsZCB0aGUgcHJvZ3JhbTsga2VlcGluZyB0aGVtIGFsaXZlCiAgLy8gaG9sZHMgb24gdG8gZHJpdmVyIG1lbW9yeSBmb3IgdGhlIGxpZmV0aW1lIG9mIHRoZSByZW5kZXJlci4KICBnbC5kZXRhY2hTaGFkZXIocCwgdmVydGV4KTsKICBnbC5kZXRhY2hTaGFkZXIocCwgZnJhZ21lbnQpOwogIGdsLmRlbGV0ZVNoYWRlcih2ZXJ0ZXgpOwogIGdsLmRlbGV0ZVNoYWRlcihmcmFnbWVudCk7CiAgaWYgKCFnbC5nZXRQcm9ncmFtUGFyYW1ldGVyKHAsIGdsLkxJTktfU1RBVFVTKSkgewogICAgY29uc3QgbG9nID0gZ2wuZ2V0UHJvZ3JhbUluZm9Mb2cocCk7CiAgICBnbC5kZWxldGVQcm9ncmFtKHApOwogICAgdGhyb3cgbmV3IEVycm9yKGxvZyk7CiAgfQogIGNvbnN0IGxvYyA9IHt9OwogIGNvbnN0IG4gPSBnbC5nZXRQcm9ncmFtUGFyYW1ldGVyKHAsIGdsLkFDVElWRV9VTklGT1JNUyk7CiAgZm9yIChsZXQgaSA9IDA7IGkgPCBuOyBpKyspIHsKICAgIGNvbnN0IG5hbWUgPSBnbC5nZXRBY3RpdmVVbmlmb3JtKHAsIGkpLm5hbWUucmVwbGFjZSgnWzBdJywgJycpOwogICAgbG9jW25hbWVdID0gZ2wuZ2V0VW5pZm9ybUxvY2F0aW9uKHAsIG5hbWUpOwogIH0KICByZXR1cm4geyBwLCBsb2MgfTsKfQoKY29uc3QgTUlQUyA9IDc7CgpjbGFzcyBHbGFzc1JlbmRlcmVyIHsKICBjb25zdHJ1Y3RvcihjYW52YXMsIG9wdGlvbnMgPSB7fSkgewogICAgY29uc3QgZ2wgPSBjYW52YXMuZ2V0Q29udGV4dCgnd2ViZ2wyJywgewogICAgICBhbHBoYTogQm9vbGVhbihvcHRpb25zLmFscGhhKSwgYW50aWFsaWFzOiBmYWxzZSwgcHJlbXVsdGlwbGllZEFscGhhOiB0cnVlLAogICAgICAvLyBSZWFkaW5nIHRoZSBjYW52YXMgYmFjayAoc2NyZWVuc2hvdHMsIHRvRGF0YVVSTCkgbmVlZHMgdGhlIGRyYXdpbmcKICAgICAgLy8gYnVmZmVyIHByZXNlcnZlZCwgYnV0IGl0IGFsc28gc3RvcHMgdGhlIGRyaXZlciBmcm9tIGRpc2NhcmRpbmcgaXQKICAgICAgLy8gYmV0d2VlbiBmcmFtZXMuIE9mZiBieSBkZWZhdWx0OyB0aGUgdG9vbGluZyB0dXJucyBpdCBvbiBleHBsaWNpdGx5LgogICAgICBwcmVzZXJ2ZURyYXdpbmdCdWZmZXI6IEJvb2xlYW4ob3B0aW9ucy5wcmVzZXJ2ZURyYXdpbmdCdWZmZXIpLAogICAgfSk7CiAgICBpZiAoIWdsKSB0aHJvdyBuZXcgRXJyb3IoJ1dlYkdMMiB1bmF2YWlsYWJsZScpOwogICAgdGhpcy5nbCA9IGdsOwogICAgdGhpcy5jYW52YXMgPSBjYW52YXM7CiAgICB0aGlzLm1hdGVyaWFsVmVyc2lvbiA9IG9wdGlvbnMubWF0ZXJpYWxWZXJzaW9uID09PSAyID8gMiA6IDE7CiAgICAvLyBTZXQgd2hpbGUgdGhlIEdQVSBjb250ZXh0IGlzIGdvbmUuIEV2ZXJ5IEdMIGNhbGwgaW4gdGhpcyBjbGFzcyBpcyBhIG5vLW9wCiAgICAvLyB1bnRpbCBgcmVzdG9yZSgpYCByZWJ1aWxkcyB0aGUgcmVzb3VyY2VzLCBzbyBhIGxvc3QgY29udGV4dCBkZWdyYWRlcyB0byBhCiAgICAvLyBmcm96ZW4gc3VyZmFjZSBpbnN0ZWFkIG9mIGFuIGV4Y2VwdGlvbiBzdG9ybS4KICAgIHRoaXMubG9zdCA9IGZhbHNlOwoKICAgIHRoaXMudGV4ID0gbnVsbDsKICAgIHRoaXMuYmx1clRleCA9IG51bGw7CiAgICB0aGlzLndhbGxwYXBlcnMgPSBbXTsKICAgIHRoaXMuZmJvcyA9IFtdOwogICAgdGhpcy5ibHVyRmJvcyA9IFtdOwogICAgdGhpcy5taXBMZXZlbHMgPSAwOwogICAgdGhpcy53ID0gMDsKICAgIHRoaXMuaCA9IDA7CiAgICB0aGlzLmNyZWF0ZVJlc291cmNlcygpOwogIH0KCiAgY3JlYXRlUmVzb3VyY2VzKCkgewogICAgY29uc3QgZ2wgPSB0aGlzLmdsOwogICAgdGhpcy5xdWFkID0gZ2wuY3JlYXRlVmVydGV4QXJyYXkoKTsKICAgIGdsLmJpbmRWZXJ0ZXhBcnJheSh0aGlzLnF1YWQpOwogICAgdGhpcy5xdWFkQnVmZmVyID0gZ2wuY3JlYXRlQnVmZmVyKCk7CiAgICBnbC5iaW5kQnVmZmVyKGdsLkFSUkFZX0JVRkZFUiwgdGhpcy5xdWFkQnVmZmVyKTsKICAgIGdsLmJ1ZmZlckRhdGEoZ2wuQVJSQVlfQlVGRkVSLAogICAgICBuZXcgRmxvYXQzMkFycmF5KFswLCAwLCAxLCAwLCAwLCAxLCAxLCAxXSksIGdsLlNUQVRJQ19EUkFXKTsKICAgIGdsLmVuYWJsZVZlcnRleEF0dHJpYkFycmF5KDApOwogICAgZ2wudmVydGV4QXR0cmliUG9pbnRlcigwLCAyLCBnbC5GTE9BVCwgZmFsc2UsIDAsIDApOwogICAgZ2wuYmluZFZlcnRleEFycmF5KG51bGwpOwoKICAgIHRoaXMucHJvZ1dhbGwgPSBwcm9ncmFtKGdsLCBWU19GVUxMU0NSRUVOLCBGU19XQUxMUEFQRVIpOwogICAgdGhpcy5wcm9nRG93biA9IHByb2dyYW0oZ2wsIFZTX0ZVTExTQ1JFRU4sIEZTX0RPV04pOwogICAgdGhpcy5wcm9nVXAgPSBwcm9ncmFtKGdsLCBWU19GVUxMU0NSRUVOLCBGU19VUCk7CiAgICB0aGlzLnByb2dCbGl0ID0gcHJvZ3JhbShnbCwgVlNfRlVMTFNDUkVFTiwgRlNfQkxJVCk7CiAgICB0aGlzLnByb2dHbGFzcyA9IHByb2dyYW0oZ2wsIFZTX0dMQVNTLAogICAgICB0aGlzLm1hdGVyaWFsVmVyc2lvbiA9PT0gMiA/IEZTX0dMQVNTX1YyIDogRlNfR0xBU1MpOwoKICAgIC8vIEZTX1dBTExQQVBFUiBhbHdheXMgaGFzIGEgc2FtcGxlciwgZXZlbiBmb3IgaXRzIHByb2NlZHVyYWwgcGF0aC4gQmluZGluZwogICAgLy8gdGhlIGJhY2tkcm9wIG1pcCB0ZXh0dXJlIHdoaWxlIHJlbmRlcmluZyBpbnRvIHRoYXQgc2FtZSB0ZXh0dXJlIGlzIGFuCiAgICAvLyBpbGxlZ2FsIGZlZWRiYWNrIGxvb3AsIHNvIGtlZXAgYSBjb21wbGV0ZSBpbmVydCB0ZXh0dXJlIGZvciB1VXNlSW1hZ2U9MC4KICAgIHRoaXMuZmFsbGJhY2tUZXh0dXJlID0gZ2wuY3JlYXRlVGV4dHVyZSgpOwogICAgZ2wuYmluZFRleHR1cmUoZ2wuVEVYVFVSRV8yRCwgdGhpcy5mYWxsYmFja1RleHR1cmUpOwogICAgZ2wudGV4SW1hZ2UyRCgKICAgICAgZ2wuVEVYVFVSRV8yRCwgMCwgZ2wuU1JHQjhfQUxQSEE4LCAxLCAxLCAwLCBnbC5SR0JBLCBnbC5VTlNJR05FRF9CWVRFLAogICAgICBuZXcgVWludDhBcnJheShbMCwgMCwgMCwgMjU1XSksCiAgICApOwogICAgZ2wudGV4UGFyYW1ldGVyaShnbC5URVhUVVJFXzJELCBnbC5URVhUVVJFX01JTl9GSUxURVIsIGdsLk5FQVJFU1QpOwogICAgZ2wudGV4UGFyYW1ldGVyaShnbC5URVhUVVJFXzJELCBnbC5URVhUVVJFX01BR19GSUxURVIsIGdsLk5FQVJFU1QpOwogICAgZ2wuYmluZFRleHR1cmUoZ2wuVEVYVFVSRV8yRCwgbnVsbCk7CiAgfQoKICByZWxlYXNlUmVzb3VyY2VzKCkgewogICAgY29uc3QgZ2wgPSB0aGlzLmdsOwogICAgZm9yIChjb25zdCBlbnRyeSBvZiBbCiAgICAgIHRoaXMucHJvZ1dhbGwsIHRoaXMucHJvZ0Rvd24sIHRoaXMucHJvZ1VwLCB0aGlzLnByb2dCbGl0LCB0aGlzLnByb2dHbGFzcywKICAgIF0pIHsKICAgICAgaWYgKGVudHJ5KSBnbC5kZWxldGVQcm9ncmFtKGVudHJ5LnApOwogICAgfQogICAgdGhpcy5wcm9nV2FsbCA9IG51bGw7CiAgICB0aGlzLnByb2dEb3duID0gbnVsbDsKICAgIHRoaXMucHJvZ1VwID0gbnVsbDsKICAgIHRoaXMucHJvZ0JsaXQgPSBudWxsOwogICAgdGhpcy5wcm9nR2xhc3MgPSBudWxsOwogICAgaWYgKHRoaXMucXVhZCkgZ2wuZGVsZXRlVmVydGV4QXJyYXkodGhpcy5xdWFkKTsKICAgIGlmICh0aGlzLnF1YWRCdWZmZXIpIGdsLmRlbGV0ZUJ1ZmZlcih0aGlzLnF1YWRCdWZmZXIpOwogICAgaWYgKHRoaXMuZmFsbGJhY2tUZXh0dXJlKSBnbC5kZWxldGVUZXh0dXJlKHRoaXMuZmFsbGJhY2tUZXh0dXJlKTsKICAgIHRoaXMucXVhZCA9IG51bGw7CiAgICB0aGlzLnF1YWRCdWZmZXIgPSBudWxsOwogICAgdGhpcy5mYWxsYmFja1RleHR1cmUgPSBudWxsOwogIH0KCiAgcmVsZWFzZVRhcmdldHMoKSB7CiAgICBjb25zdCBnbCA9IHRoaXMuZ2w7CiAgICBpZiAodGhpcy50ZXgpIGdsLmRlbGV0ZVRleHR1cmUodGhpcy50ZXgpOwogICAgaWYgKHRoaXMuYmx1clRleCkgZ2wuZGVsZXRlVGV4dHVyZSh0aGlzLmJsdXJUZXgpOwogICAgdGhpcy5mYm9zLmZvckVhY2goKGZyYW1lYnVmZmVyKSA9PiBnbC5kZWxldGVGcmFtZWJ1ZmZlcihmcmFtZWJ1ZmZlcikpOwogICAgdGhpcy5ibHVyRmJvcy5mb3JFYWNoKChmcmFtZWJ1ZmZlcikgPT4gZ2wuZGVsZXRlRnJhbWVidWZmZXIoZnJhbWVidWZmZXIpKTsKICAgIHRoaXMudGV4ID0gbnVsbDsKICAgIHRoaXMuYmx1clRleCA9IG51bGw7CiAgICB0aGlzLmZib3MgPSBbXTsKICAgIHRoaXMuYmx1ckZib3MgPSBbXTsKICAgIHRoaXMubWlwTGV2ZWxzID0gMDsKICB9CgogIC8vIERyb3BzIGV2ZXJ5IGhhbmRsZSB3aXRob3V0IHRvdWNoaW5nIHRoZSBHUFU6IGFmdGVyIGEgY29udGV4dCBsb3NzIHRoZSBpZHMKICAvLyBhcmUgYWxyZWFkeSBpbnZhbGlkIGFuZCBkZWxldGluZyB0aGVtIGlzIG1lYW5pbmdsZXNzLgogIGhhbmRsZUNvbnRleHRMb3N0KCkgewogICAgdGhpcy5sb3N0ID0gdHJ1ZTsKICAgIHRoaXMucHJvZ1dhbGwgPSBudWxsOwogICAgdGhpcy5wcm9nRG93biA9IG51bGw7CiAgICB0aGlzLnByb2dVcCA9IG51bGw7CiAgICB0aGlzLnByb2dCbGl0ID0gbnVsbDsKICAgIHRoaXMucHJvZ0dsYXNzID0gbnVsbDsKICAgIHRoaXMucXVhZCA9IG51bGw7CiAgICB0aGlzLnF1YWRCdWZmZXIgPSBudWxsOwogICAgdGhpcy5mYWxsYmFja1RleHR1cmUgPSBudWxsOwogICAgdGhpcy50ZXggPSBudWxsOwogICAgdGhpcy5ibHVyVGV4ID0gbnVsbDsKICAgIHRoaXMuZmJvcyA9IFtdOwogICAgdGhpcy5ibHVyRmJvcyA9IFtdOwogICAgZm9yIChjb25zdCBlbnRyeSBvZiB0aGlzLndhbGxwYXBlcnMpIHsKICAgICAgZW50cnkudGV4dHVyZSA9IG51bGw7CiAgICAgIGVudHJ5LnJlYWR5ID0gZmFsc2U7CiAgICAgIGVudHJ5LndpZHRoID0gMDsKICAgICAgZW50cnkuaGVpZ2h0ID0gMDsKICAgIH0KICB9CgogIC8vIFJlYnVpbGRzIHByb2dyYW1zLCByZW5kZXIgdGFyZ2V0cyBhbmQgYmFja2Ryb3AgdGV4dHVyZXMgYWZ0ZXIgdGhlIGJyb3dzZXIKICAvLyByZXN0b3JlcyB0aGUgY29udGV4dC4gVGhlIFdlYkdMMiBjb250ZXh0IG9iamVjdCBpdHNlbGYgaXMgcmV1c2VkIHBlciBzcGVjLAogIC8vIHNvIG9ubHkgdGhlIHJlc291cmNlcyBoYXZlIHRvIGJlIHJlY3JlYXRlZC4KICByZXN0b3JlKCkgewogICAgaWYgKCF0aGlzLmxvc3QpIHJldHVybiB0aGlzOwogICAgdGhpcy5sb3N0ID0gZmFsc2U7CiAgICB0aGlzLmNyZWF0ZVJlc291cmNlcygpOwogICAgY29uc3QgeyB3LCBoIH0gPSB0aGlzOwogICAgdGhpcy53ID0gMDsKICAgIHRoaXMuaCA9IDA7CiAgICBpZiAodyA+IDAgJiYgaCA+IDApIHRoaXMucmVzaXplKHcsIGgpOwogICAgdGhpcy5jcmVhdGVXYWxscGFwZXJUZXh0dXJlcygpOwogICAgcmV0dXJuIHRoaXM7CiAgfQoKICBoYXNMaXZlQmFja2Ryb3AoKSB7CiAgICByZXR1cm4gdGhpcy53YWxscGFwZXJzLnNvbWUoKGVudHJ5KSA9PiBlbnRyeS51cGRhdGUgPT09ICdsaXZlJyk7CiAgfQoKICBzb3VyY2VTaXplKHNvdXJjZSkgewogICAgcmV0dXJuIFsKICAgICAgTnVtYmVyKHNvdXJjZT8udmlkZW9XaWR0aCB8fCBzb3VyY2U/Lm5hdHVyYWxXaWR0aCB8fCBzb3VyY2U/LndpZHRoIHx8IDApLAogICAgICBOdW1iZXIoc291cmNlPy52aWRlb0hlaWdodCB8fCBzb3VyY2U/Lm5hdHVyYWxIZWlnaHQgfHwgc291cmNlPy5oZWlnaHQgfHwgMCksCiAgICBdOwogIH0KCiAgdXBsb2FkV2FsbHBhcGVyKGVudHJ5LCBmb3JjZUFsbG9jYXRpb24gPSBmYWxzZSkgewogICAgaWYgKHRoaXMubG9zdCB8fCAhZW50cnkudGV4dHVyZSkgcmV0dXJuIGZhbHNlOwogICAgY29uc3QgW3dpZHRoLCBoZWlnaHRdID0gdGhpcy5zb3VyY2VTaXplKGVudHJ5LnNvdXJjZSk7CiAgICBpZiAoISh3aWR0aCA+IDApIHx8ICEoaGVpZ2h0ID4gMCkpIHJldHVybiBmYWxzZTsKCiAgICBjb25zdCBnbCA9IHRoaXMuZ2w7CiAgICBnbC5iaW5kVGV4dHVyZShnbC5URVhUVVJFXzJELCBlbnRyeS50ZXh0dXJlKTsKICAgIGdsLnBpeGVsU3RvcmVpKGdsLlVOUEFDS19GTElQX1lfV0VCR0wsIHRydWUpOwogICAgaWYgKCFmb3JjZUFsbG9jYXRpb24gJiYgZW50cnkucmVhZHkgJiYgZW50cnkud2lkdGggPT09IHdpZHRoICYmIGVudHJ5LmhlaWdodCA9PT0gaGVpZ2h0KSB7CiAgICAgIGdsLnRleFN1YkltYWdlMkQoZ2wuVEVYVFVSRV8yRCwgMCwgMCwgMCwgZ2wuUkdCQSwgZ2wuVU5TSUdORURfQllURSwgZW50cnkuc291cmNlKTsKICAgIH0gZWxzZSB7CiAgICAgIGdsLnRleEltYWdlMkQoCiAgICAgICAgZ2wuVEVYVFVSRV8yRCwgMCwgZ2wuU1JHQjhfQUxQSEE4LCBnbC5SR0JBLCBnbC5VTlNJR05FRF9CWVRFLCBlbnRyeS5zb3VyY2UsCiAgICAgICk7CiAgICB9CiAgICBnbC5waXhlbFN0b3JlaShnbC5VTlBBQ0tfRkxJUF9ZX1dFQkdMLCBmYWxzZSk7CiAgICBlbnRyeS53aWR0aCA9IHdpZHRoOwogICAgZW50cnkuaGVpZ2h0ID0gaGVpZ2h0OwogICAgZW50cnkucmVhZHkgPSB0cnVlOwogICAgcmV0dXJuIHRydWU7CiAgfQoKICByZXNpemUodywgaCkgewogICAgdyA9IE1hdGgubWF4KDEsIE1hdGgucm91bmQodykpOwogICAgaCA9IE1hdGgubWF4KDEsIE1hdGgucm91bmQoaCkpOwogICAgaWYgKHRoaXMubG9zdCkgeyB0aGlzLncgPSB3OyB0aGlzLmggPSBoOyByZXR1cm47IH0KICAgIGlmICh3ID09PSB0aGlzLncgJiYgaCA9PT0gdGhpcy5oKSByZXR1cm47CiAgICBjb25zdCBnbCA9IHRoaXMuZ2w7CiAgICB0aGlzLncgPSB3OyB0aGlzLmggPSBoOwogICAgdGhpcy5jYW52YXMud2lkdGggPSB3OyB0aGlzLmNhbnZhcy5oZWlnaHQgPSBoOwoKICAgIHRoaXMucmVsZWFzZVRhcmdldHMoKTsKCiAgICAvLyB0ZXhTdG9yYWdlMkQgcmVqZWN0cyBhIGxldmVsIGNvdW50IGxhcmdlciB0aGFuIHRoZSBzaXplIGNhbiByZXByZXNlbnQuCiAgICAvLyBTZXZlbiBsZXZlbHMgYXJlIHVzZWZ1bCBvbiBhIGZ1bGwtc2NyZWVuIHN1cmZhY2UsIGJ1dCBhIDMycHggaWNvbiBvbmx5CiAgICAvLyBoYXMgc2l4ICgzMiwgMTYsIDgsIDQsIDIsIDEpLgogICAgdGhpcy5taXBMZXZlbHMgPSBNYXRoLm1pbihNSVBTLCBNYXRoLmZsb29yKE1hdGgubG9nMihNYXRoLm1heCh3LCBoKSkpICsgMSk7CgogICAgY29uc3QgY3JlYXRlTWlwVGV4dHVyZSA9ICgpID0+IHsKICAgICAgY29uc3QgdGV4dHVyZSA9IGdsLmNyZWF0ZVRleHR1cmUoKTsKICAgICAgZ2wuYmluZFRleHR1cmUoZ2wuVEVYVFVSRV8yRCwgdGV4dHVyZSk7CiAgICAgIC8vIFNhbXBsaW5nIGFuIHNSR0IgdGV4dHVyZSBkZWNvZGVzIFJHQiB0byBsaW5lYXI7IHdyaXRpbmcgdG8gdGhlIHNSR0IKICAgICAgLy8gYXR0YWNobWVudCBlbmNvZGVzIGl0IGFnYWluLiBBbHBoYSByZW1haW5zIGxpbmVhciwgcHJlc2VydmluZyB0aGUKICAgICAgLy8gb3B0aWNhbC1kZW5zaXR5IHNpZGUgY2hhbm5lbC4KICAgICAgZ2wudGV4U3RvcmFnZTJEKGdsLlRFWFRVUkVfMkQsIHRoaXMubWlwTGV2ZWxzLCBnbC5TUkdCOF9BTFBIQTgsIHcsIGgpOwogICAgICBnbC50ZXhQYXJhbWV0ZXJpKGdsLlRFWFRVUkVfMkQsIGdsLlRFWFRVUkVfTUlOX0ZJTFRFUiwgZ2wuTElORUFSX01JUE1BUF9MSU5FQVIpOwogICAgICBnbC50ZXhQYXJhbWV0ZXJpKGdsLlRFWFRVUkVfMkQsIGdsLlRFWFRVUkVfTUFHX0ZJTFRFUiwgZ2wuTElORUFSKTsKICAgICAgZ2wudGV4UGFyYW1ldGVyaShnbC5URVhUVVJFXzJELCBnbC5URVhUVVJFX1dSQVBfUywgZ2wuQ0xBTVBfVE9fRURHRSk7CiAgICAgIGdsLnRleFBhcmFtZXRlcmkoZ2wuVEVYVFVSRV8yRCwgZ2wuVEVYVFVSRV9XUkFQX1QsIGdsLkNMQU1QX1RPX0VER0UpOwogICAgICByZXR1cm4gdGV4dHVyZTsKICAgIH07CgogICAgdGhpcy50ZXggPSBjcmVhdGVNaXBUZXh0dXJlKCk7CiAgICB0aGlzLmJsdXJUZXggPSBjcmVhdGVNaXBUZXh0dXJlKCk7CiAgICB0aGlzLmZib3MgPSBbXTsKICAgIHRoaXMuYmx1ckZib3MgPSBbXTsKICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGhpcy5taXBMZXZlbHM7IGkrKykgewogICAgICBjb25zdCBmID0gZ2wuY3JlYXRlRnJhbWVidWZmZXIoKTsKICAgICAgZ2wuYmluZEZyYW1lYnVmZmVyKGdsLkZSQU1FQlVGRkVSLCBmKTsKICAgICAgZ2wuZnJhbWVidWZmZXJUZXh0dXJlMkQoZ2wuRlJBTUVCVUZGRVIsIGdsLkNPTE9SX0FUVEFDSE1FTlQwLCBnbC5URVhUVVJFXzJELCB0aGlzLnRleCwgaSk7CiAgICAgIHRoaXMuZmJvcy5wdXNoKGYpOwoKICAgICAgY29uc3QgYmx1ckZibyA9IGdsLmNyZWF0ZUZyYW1lYnVmZmVyKCk7CiAgICAgIGdsLmJpbmRGcmFtZWJ1ZmZlcihnbC5GUkFNRUJVRkZFUiwgYmx1ckZibyk7CiAgICAgIGdsLmZyYW1lYnVmZmVyVGV4dHVyZTJEKAogICAgICAgIGdsLkZSQU1FQlVGRkVSLCBnbC5DT0xPUl9BVFRBQ0hNRU5UMCwgZ2wuVEVYVFVSRV8yRCwgdGhpcy5ibHVyVGV4LCBpLAogICAgICApOwogICAgICB0aGlzLmJsdXJGYm9zLnB1c2goYmx1ckZibyk7CiAgICB9CiAgICBnbC5iaW5kRnJhbWVidWZmZXIoZ2wuRlJBTUVCVUZGRVIsIG51bGwpOwogIH0KCiAgLy8gKFJlKWFsbG9jYXRlcyBhIEdMIHRleHR1cmUgcGVyIGJhY2tkcm9wIGVudHJ5IGFuZCB1cGxvYWRzIGl0cyBmaXJzdCBmcmFtZS4KICBjcmVhdGVXYWxscGFwZXJUZXh0dXJlcygpIHsKICAgIGlmICh0aGlzLmxvc3QpIHJldHVybjsKICAgIGNvbnN0IGdsID0gdGhpcy5nbDsKICAgIGZvciAoY29uc3QgZW50cnkgb2YgdGhpcy53YWxscGFwZXJzKSB7CiAgICAgIGlmIChlbnRyeS50ZXh0dXJlKSBnbC5kZWxldGVUZXh0dXJlKGVudHJ5LnRleHR1cmUpOwogICAgICBlbnRyeS50ZXh0dXJlID0gZ2wuY3JlYXRlVGV4dHVyZSgpOwogICAgICBlbnRyeS5yZWFkeSA9IGZhbHNlOwogICAgICBlbnRyeS53aWR0aCA9IDA7CiAgICAgIGVudHJ5LmhlaWdodCA9IDA7CiAgICAgIGdsLmJpbmRUZXh0dXJlKGdsLlRFWFRVUkVfMkQsIGVudHJ5LnRleHR1cmUpOwogICAgICBnbC50ZXhQYXJhbWV0ZXJpKGdsLlRFWFRVUkVfMkQsIGdsLlRFWFRVUkVfTUlOX0ZJTFRFUiwgZ2wuTElORUFSKTsKICAgICAgZ2wudGV4UGFyYW1ldGVyaShnbC5URVhUVVJFXzJELCBnbC5URVhUVVJFX01BR19GSUxURVIsIGdsLkxJTkVBUik7CiAgICAgIGdsLnRleFBhcmFtZXRlcmkoZ2wuVEVYVFVSRV8yRCwgZ2wuVEVYVFVSRV9XUkFQX1MsIGdsLkNMQU1QX1RPX0VER0UpOwogICAgICBnbC50ZXhQYXJhbWV0ZXJpKGdsLlRFWFRVUkVfMkQsIGdsLlRFWFRVUkVfV1JBUF9ULCBnbC5DTEFNUF9UT19FREdFKTsKICAgICAgdGhpcy51cGxvYWRXYWxscGFwZXIoZW50cnksIHRydWUpOwogICAgfQogICAgZ2wuYmluZFRleHR1cmUoZ2wuVEVYVFVSRV8yRCwgbnVsbCk7CiAgfQoKICBzZXRXYWxscGFwZXJzKGltYWdlcywgb3B0aW9ucyA9IHt9KSB7CiAgICBjb25zdCBnbCA9IHRoaXMuZ2w7CiAgICBjb25zdCB1cGRhdGUgPSBvcHRpb25zLnVwZGF0ZSA9PT0gJ2xpdmUnID8gJ2xpdmUnIDogJ3N0YXRpYyc7CiAgICBpZiAoIXRoaXMubG9zdCkgdGhpcy53YWxscGFwZXJzLmZvckVhY2goKGVudHJ5KSA9PiBnbC5kZWxldGVUZXh0dXJlKGVudHJ5LnRleHR1cmUpKTsKICAgIHRoaXMud2FsbHBhcGVycyA9IGltYWdlcy5tYXAoKHNvdXJjZSkgPT4gKHsKICAgICAgdGV4dHVyZTogbnVsbCwKICAgICAgc291cmNlLAogICAgICB1cGRhdGUsCiAgICAgIHJlYWR5OiBmYWxzZSwKICAgICAgd2lkdGg6IDAsCiAgICAgIGhlaWdodDogMCwKICAgIH0pKTsKICAgIHRoaXMuY3JlYXRlV2FsbHBhcGVyVGV4dHVyZXMoKTsKICB9CgogIHJlZnJlc2hXYWxscGFwZXJzKGZvcmNlID0gZmFsc2UpIHsKICAgIGlmICh0aGlzLmxvc3QpIHJldHVybjsKICAgIGZvciAoY29uc3QgZW50cnkgb2YgdGhpcy53YWxscGFwZXJzKSB7CiAgICAgIGlmIChmb3JjZSB8fCBlbnRyeS51cGRhdGUgPT09ICdsaXZlJykgdGhpcy51cGxvYWRXYWxscGFwZXIoZW50cnkpOwogICAgfQogICAgdGhpcy5nbC5iaW5kVGV4dHVyZSh0aGlzLmdsLlRFWFRVUkVfMkQsIG51bGwpOwogIH0KCiAgbWlwU2l6ZShsZXZlbCkgewogICAgcmV0dXJuIFtNYXRoLm1heCgxLCB0aGlzLncgPj4gbGV2ZWwpLCBNYXRoLm1heCgxLCB0aGlzLmggPj4gbGV2ZWwpXTsKICB9CgogIC8vIFJlbmRlcnMgdGhlIGJhY2tkcm9wIGludG8gbWlwIDAgYW5kIGJ1aWxkcyB0aGUgcHJvZ3Jlc3NpdmVseSBibHVycmVkIGNoYWluLgogIGJ1aWxkQmFja2Ryb3Aoc2NlbmUsIHpvb20gPSAxKSB7CiAgICBpZiAodGhpcy5sb3N0IHx8ICF0aGlzLmZib3MubGVuZ3RoKSByZXR1cm47CiAgICBjb25zdCBnbCA9IHRoaXMuZ2w7CiAgICB0aGlzLnJlZnJlc2hXYWxscGFwZXJzKCk7CiAgICBnbC5iaW5kVmVydGV4QXJyYXkodGhpcy5xdWFkKTsKICAgIGdsLmRpc2FibGUoZ2wuQkxFTkQpOwoKICAgIGdsLmJpbmRGcmFtZWJ1ZmZlcihnbC5GUkFNRUJVRkZFUiwgdGhpcy5mYm9zWzBdKTsKICAgIGdsLnZpZXdwb3J0KDAsIDAsIHRoaXMudywgdGhpcy5oKTsKICAgIGdsLnVzZVByb2dyYW0odGhpcy5wcm9nV2FsbC5wKTsKICAgIGdsLnVuaWZvcm0yZih0aGlzLnByb2dXYWxsLmxvYy51UmVzLCB0aGlzLncsIHRoaXMuaCk7CiAgICBnbC51bmlmb3JtMWkodGhpcy5wcm9nV2FsbC5sb2MudVNjZW5lLCBzY2VuZSk7CiAgICBnbC51bmlmb3JtMWYodGhpcy5wcm9nV2FsbC5sb2MudVpvb20sIHpvb20pOwogICAgY29uc3Qgd2FsbHBhcGVyID0gdGhpcy53YWxscGFwZXJzW3NjZW5lXTsKICAgIGdsLmFjdGl2ZVRleHR1cmUoZ2wuVEVYVFVSRTEpOwogICAgZ2wuYmluZFRleHR1cmUoZ2wuVEVYVFVSRV8yRCwgd2FsbHBhcGVyPy5yZWFkeSA/IHdhbGxwYXBlci50ZXh0dXJlIDogdGhpcy5mYWxsYmFja1RleHR1cmUpOwogICAgZ2wudW5pZm9ybTFpKHRoaXMucHJvZ1dhbGwubG9jLnVXYWxscGFwZXIsIDEpOwogICAgZ2wudW5pZm9ybTFpKHRoaXMucHJvZ1dhbGwubG9jLnVVc2VJbWFnZSwgd2FsbHBhcGVyPy5yZWFkeSA/IDEgOiAwKTsKICAgIGdsLmRyYXdBcnJheXMoZ2wuVFJJQU5HTEVfU1RSSVAsIDAsIDQpOwoKICAgIGdsLnVzZVByb2dyYW0odGhpcy5wcm9nRG93bi5wKTsKICAgIGdsLnVuaWZvcm0xaSh0aGlzLnByb2dEb3duLmxvYy51VGV4LCAwKTsKICAgIGdsLmFjdGl2ZVRleHR1cmUoZ2wuVEVYVFVSRTApOwogICAgZ2wuYmluZFRleHR1cmUoZ2wuVEVYVFVSRV8yRCwgdGhpcy50ZXgpOwogICAgZm9yIChsZXQgaSA9IDE7IGkgPCB0aGlzLm1pcExldmVsczsgaSsrKSB7CiAgICAgIGNvbnN0IFtzdywgc2hdID0gdGhpcy5taXBTaXplKGkgLSAxKTsKICAgICAgY29uc3QgW2R3LCBkaF0gPSB0aGlzLm1pcFNpemUoaSk7CiAgICAgIGdsLnRleFBhcmFtZXRlcmkoZ2wuVEVYVFVSRV8yRCwgZ2wuVEVYVFVSRV9CQVNFX0xFVkVMLCBpIC0gMSk7CiAgICAgIGdsLnRleFBhcmFtZXRlcmkoZ2wuVEVYVFVSRV8yRCwgZ2wuVEVYVFVSRV9NQVhfTEVWRUwsIGkgLSAxKTsKICAgICAgZ2wuYmluZEZyYW1lYnVmZmVyKGdsLkZSQU1FQlVGRkVSLCB0aGlzLmZib3NbaV0pOwogICAgICBnbC52aWV3cG9ydCgwLCAwLCBkdywgZGgpOwogICAgICBnbC51bmlmb3JtMmYodGhpcy5wcm9nRG93bi5sb2MudVRleGVsLCAxIC8gc3csIDEgLyBzaCk7CiAgICAgIGdsLmRyYXdBcnJheXMoZ2wuVFJJQU5HTEVfU1RSSVAsIDAsIDQpOwogICAgfQogICAgZ2wudGV4UGFyYW1ldGVyaShnbC5URVhUVVJFXzJELCBnbC5URVhUVVJFX0JBU0VfTEVWRUwsIDApOwogICAgZ2wudGV4UGFyYW1ldGVyaShnbC5URVhUVVJFXzJELCBnbC5URVhUVVJFX01BWF9MRVZFTCwgdGhpcy5taXBMZXZlbHMgLSAxKTsKCiAgICAvLyBTZWVkIHRoZSBjb2Fyc2VzdCByZWNvbnN0cnVjdGVkIGxldmVsLCB0aGVuIHdhbGsgYmFjayB0b3dhcmQgZnVsbAogICAgLy8gcmVzb2x1dGlvbiB3aXRoIGEgdGVudCBmaWx0ZXIuIFJlc3RyaWN0aW5nIEJBU0UvTUFYX0xFVkVMIGtlZXBzIHNhbXBsaW5nCiAgICAvLyBhIGRpZmZlcmVudCBtaXAgaW1hZ2UgZnJvbSB0aGUgb25lIGF0dGFjaGVkIGZvciBkcmF3aW5nLCBhdm9pZGluZyBhCiAgICAvLyBmcmFtZWJ1ZmZlciBmZWVkYmFjayBsb29wIHdoaWxlIHJldGFpbmluZyBvbmUgZmlsdGVyYWJsZSB0ZXh0dXJlIGNoYWluLgogICAgY29uc3QgbGFzdCA9IHRoaXMubWlwTGV2ZWxzIC0gMTsKICAgIGNvbnN0IFtsYXN0VywgbGFzdEhdID0gdGhpcy5taXBTaXplKGxhc3QpOwogICAgZ2wuYmluZEZyYW1lYnVmZmVyKGdsLlJFQURfRlJBTUVCVUZGRVIsIHRoaXMuZmJvc1tsYXN0XSk7CiAgICBnbC5iaW5kRnJhbWVidWZmZXIoZ2wuRFJBV19GUkFNRUJVRkZFUiwgdGhpcy5ibHVyRmJvc1tsYXN0XSk7CiAgICBnbC5ibGl0RnJhbWVidWZmZXIoCiAgICAgIDAsIDAsIGxhc3RXLCBsYXN0SCwgMCwgMCwgbGFzdFcsIGxhc3RILCBnbC5DT0xPUl9CVUZGRVJfQklULCBnbC5ORUFSRVNULAogICAgKTsKCiAgICBnbC5iaW5kVmVydGV4QXJyYXkodGhpcy5xdWFkKTsKICAgIGdsLnVzZVByb2dyYW0odGhpcy5wcm9nVXAucCk7CiAgICBnbC51bmlmb3JtMWkodGhpcy5wcm9nVXAubG9jLnVMb3csIDApOwogICAgZ2wudW5pZm9ybTFpKHRoaXMucHJvZ1VwLmxvYy51SGlnaCwgMSk7CiAgICBmb3IgKGxldCBpID0gbGFzdCAtIDE7IGkgPj0gMDsgaS0tKSB7CiAgICAgIGNvbnN0IFtsb3dXLCBsb3dIXSA9IHRoaXMubWlwU2l6ZShpICsgMSk7CiAgICAgIGNvbnN0IFtkdywgZGhdID0gdGhpcy5taXBTaXplKGkpOwoKICAgICAgZ2wuYWN0aXZlVGV4dHVyZShnbC5URVhUVVJFMCk7CiAgICAgIGdsLmJpbmRUZXh0dXJlKGdsLlRFWFRVUkVfMkQsIHRoaXMuYmx1clRleCk7CiAgICAgIGdsLnRleFBhcmFtZXRlcmkoZ2wuVEVYVFVSRV8yRCwgZ2wuVEVYVFVSRV9CQVNFX0xFVkVMLCBpICsgMSk7CiAgICAgIGdsLnRleFBhcmFtZXRlcmkoZ2wuVEVYVFVSRV8yRCwgZ2wuVEVYVFVSRV9NQVhfTEVWRUwsIGkgKyAxKTsKCiAgICAgIGdsLmFjdGl2ZVRleHR1cmUoZ2wuVEVYVFVSRTEpOwogICAgICBnbC5iaW5kVGV4dHVyZShnbC5URVhUVVJFXzJELCB0aGlzLnRleCk7CiAgICAgIGdsLnRleFBhcmFtZXRlcmkoZ2wuVEVYVFVSRV8yRCwgZ2wuVEVYVFVSRV9CQVNFX0xFVkVMLCBpKTsKICAgICAgZ2wudGV4UGFyYW1ldGVyaShnbC5URVhUVVJFXzJELCBnbC5URVhUVVJFX01BWF9MRVZFTCwgaSk7CgogICAgICBnbC5iaW5kRnJhbWVidWZmZXIoZ2wuRlJBTUVCVUZGRVIsIHRoaXMuYmx1ckZib3NbaV0pOwogICAgICBnbC52aWV3cG9ydCgwLCAwLCBkdywgZGgpOwogICAgICBnbC51bmlmb3JtMmYodGhpcy5wcm9nVXAubG9jLnVMb3dUZXhlbCwgMSAvIGxvd1csIDEgLyBsb3dIKTsKICAgICAgZ2wuZHJhd0FycmF5cyhnbC5UUklBTkdMRV9TVFJJUCwgMCwgNCk7CiAgICB9CgogICAgZ2wuYWN0aXZlVGV4dHVyZShnbC5URVhUVVJFMCk7CiAgICBnbC5iaW5kVGV4dHVyZShnbC5URVhUVVJFXzJELCB0aGlzLmJsdXJUZXgpOwogICAgZ2wudGV4UGFyYW1ldGVyaShnbC5URVhUVVJFXzJELCBnbC5URVhUVVJFX0JBU0VfTEVWRUwsIDApOwogICAgZ2wudGV4UGFyYW1ldGVyaShnbC5URVhUVVJFXzJELCBnbC5URVhUVVJFX01BWF9MRVZFTCwgdGhpcy5taXBMZXZlbHMgLSAxKTsKICAgIGdsLmFjdGl2ZVRleHR1cmUoZ2wuVEVYVFVSRTEpOwogICAgZ2wuYmluZFRleHR1cmUoZ2wuVEVYVFVSRV8yRCwgdGhpcy50ZXgpOwogICAgZ2wudGV4UGFyYW1ldGVyaShnbC5URVhUVVJFXzJELCBnbC5URVhUVVJFX0JBU0VfTEVWRUwsIDApOwogICAgZ2wudGV4UGFyYW1ldGVyaShnbC5URVhUVVJFXzJELCBnbC5URVhUVVJFX01BWF9MRVZFTCwgdGhpcy5taXBMZXZlbHMgLSAxKTsKICB9CgogIC8vIERyYXdzIHRoZSBzaGFycCBiYWNrZHJvcCB0byB0aGUgc2NyZWVuLgogIGRyYXdCYWNrZHJvcCgpIHsKICAgIGlmICh0aGlzLmxvc3QgfHwgIXRoaXMudGV4KSByZXR1cm47CiAgICBjb25zdCBnbCA9IHRoaXMuZ2w7CiAgICBnbC5iaW5kRnJhbWVidWZmZXIoZ2wuRlJBTUVCVUZGRVIsIG51bGwpOwogICAgZ2wudmlld3BvcnQoMCwgMCwgdGhpcy53LCB0aGlzLmgpOwogICAgZ2wuZGlzYWJsZShnbC5CTEVORCk7CiAgICBnbC5iaW5kVmVydGV4QXJyYXkodGhpcy5xdWFkKTsKICAgIGdsLnVzZVByb2dyYW0odGhpcy5wcm9nQmxpdC5wKTsKICAgIGdsLmFjdGl2ZVRleHR1cmUoZ2wuVEVYVFVSRTApOwogICAgZ2wuYmluZFRleHR1cmUoZ2wuVEVYVFVSRV8yRCwgdGhpcy50ZXgpOwogICAgZ2wudW5pZm9ybTFpKHRoaXMucHJvZ0JsaXQubG9jLnVUZXgsIDApOwogICAgZ2wuZHJhd0FycmF5cyhnbC5UUklBTkdMRV9TVFJJUCwgMCwgNCk7CiAgfQoKICAvLyBDbGVhcnMgdGhlIHZpc2libGUgZnJhbWVidWZmZXIgd2hpbGUgcHJlc2VydmluZyB0aGUgb2Zmc2NyZWVuIGJhY2tkcm9wCiAgLy8gdGV4dHVyZS4gVXNlZCB3aGVuIHRoZSBjYW52YXMgb3ZlcmxheXMgYW4gZXhpc3RpbmcgRE9NL2NhbnZhcyBiYWNrZHJvcC4KICBjbGVhck91dHB1dCgpIHsKICAgIGlmICh0aGlzLmxvc3QpIHJldHVybjsKICAgIGNvbnN0IGdsID0gdGhpcy5nbDsKICAgIGdsLmJpbmRGcmFtZWJ1ZmZlcihnbC5GUkFNRUJVRkZFUiwgbnVsbCk7CiAgICBnbC52aWV3cG9ydCgwLCAwLCB0aGlzLncsIHRoaXMuaCk7CiAgICBnbC5kaXNhYmxlKGdsLkJMRU5EKTsKICAgIGdsLmNsZWFyQ29sb3IoMCwgMCwgMCwgMCk7CiAgICBnbC5jbGVhcihnbC5DT0xPUl9CVUZGRVJfQklUKTsKICB9CgogIC8vIGVsZW1lbnRzOiB7eCwgeSwgdywgaCwgc2hhcGV9IGluIENTUyBwaXhlbHMsIHkgbWVhc3VyZWQgZnJvbSB0aGUgVE9QLgogIC8vIFRoZSBncm91cCBpcyBldmFsdWF0ZWQgYXMgYSBzaW5nbGUgc21vb3RoLXVuaW9uIFNERi4gVGhpcyBpcyBpbXBvcnRhbnQ6CiAgLy8gY29tcG9zaXRpbmcgaW5kZXBlbmRlbnQgZ2xhc3MgZHJhd3MgY2FuIG92ZXJsYXAsIGJ1dCBjYW4gbmV2ZXIgcHJvZHVjZSB0aGUKICAvLyBzaGFyZWQgc2lsaG91ZXR0ZSBhbmQgY29udGludW91cyBub3JtYWxzIG9mIG9uZSBmdXNlZCBsaXF1aWQgc3VyZmFjZS4KICBkcmF3R2xhc3NHcm91cChlbGVtZW50cywgbSwgZHByLCBtZXJnZVJhZGl1cyA9IG0ubWVyZ2VSYWRpdXMgPz8gMCkgewogICAgaWYgKCFlbGVtZW50cy5sZW5ndGggfHwgdGhpcy5sb3N0IHx8ICF0aGlzLnRleCkgcmV0dXJuOwoKICAgIGNvbnN0IGdsID0gdGhpcy5nbDsKICAgIGNvbnN0IHsgbG9jLCBwIH0gPSB0aGlzLnByb2dHbGFzczsKICAgIGNvbnN0IHNoYXBlcyA9IGVsZW1lbnRzLnNsaWNlKDAsIE1BWF9HTEFTU19TSEFQRVMpOwoKICAgIGNvbnN0IG1pblggPSBNYXRoLm1pbiguLi5zaGFwZXMubWFwKChlbGVtZW50KSA9PiBlbGVtZW50LngpKTsKICAgIGNvbnN0IG1pblkgPSBNYXRoLm1pbiguLi5zaGFwZXMubWFwKChlbGVtZW50KSA9PiBlbGVtZW50LnkpKTsKICAgIGNvbnN0IG1heFggPSBNYXRoLm1heCguLi5zaGFwZXMubWFwKChlbGVtZW50KSA9PiBlbGVtZW50LnggKyBlbGVtZW50LncpKTsKICAgIGNvbnN0IG1heFkgPSBNYXRoLm1heCguLi5zaGFwZXMubWFwKChlbGVtZW50KSA9PiBlbGVtZW50LnkgKyBlbGVtZW50LmgpKTsKICAgIGNvbnN0IGdyb3VwV2lkdGggPSBtYXhYIC0gbWluWDsKICAgIGNvbnN0IGdyb3VwSGVpZ2h0ID0gbWF4WSAtIG1pblk7CgogICAgZ2wuYmluZEZyYW1lYnVmZmVyKGdsLkZSQU1FQlVGRkVSLCBudWxsKTsKICAgIGdsLnZpZXdwb3J0KDAsIDAsIHRoaXMudywgdGhpcy5oKTsKICAgIGdsLmVuYWJsZShnbC5CTEVORCk7CiAgICBnbC5ibGVuZEZ1bmMoZ2wuT05FLCBnbC5PTkVfTUlOVVNfU1JDX0FMUEhBKTsKICAgIGdsLmJpbmRWZXJ0ZXhBcnJheSh0aGlzLnF1YWQpOwogICAgZ2wudXNlUHJvZ3JhbShwKTsKCiAgICBjb25zdCBjeCA9IChtaW5YICsgZ3JvdXBXaWR0aCAvIDIpICogZHByOwogICAgY29uc3QgY3kgPSB0aGlzLmggLSAobWluWSArIGdyb3VwSGVpZ2h0IC8gMikgKiBkcHI7CiAgICBjb25zdCBodyA9IChncm91cFdpZHRoIC8gMikgKiBkcHI7CiAgICBjb25zdCBoaCA9IChncm91cEhlaWdodCAvIDIpICogZHByOwogICAgY29uc3QgY2VudGVycyA9IG5ldyBGbG9hdDMyQXJyYXkoTUFYX0dMQVNTX1NIQVBFUyAqIDIpOwogICAgY29uc3QgaGFsdmVzID0gbmV3IEZsb2F0MzJBcnJheShNQVhfR0xBU1NfU0hBUEVTICogMik7CiAgICBjb25zdCByYWRpaSA9IG5ldyBGbG9hdDMyQXJyYXkoTUFYX0dMQVNTX1NIQVBFUyk7CiAgICBjb25zdCB0eXBlcyA9IG5ldyBJbnQzMkFycmF5KE1BWF9HTEFTU19TSEFQRVMpOwoKICAgIHNoYXBlcy5mb3JFYWNoKChlbGVtZW50LCBpKSA9PiB7CiAgICAgIGNvbnN0IHNob3J0ID0gTWF0aC5taW4oZWxlbWVudC53LCBlbGVtZW50LmgpOwogICAgICBjZW50ZXJzW2kgKiAyXSA9IChlbGVtZW50LnggKyBlbGVtZW50LncgLyAyKSAqIGRwcjsKICAgICAgY2VudGVyc1tpICogMiArIDFdID0gdGhpcy5oIC0gKGVsZW1lbnQueSArIGVsZW1lbnQuaCAvIDIpICogZHByOwogICAgICBoYWx2ZXNbaSAqIDJdID0gZWxlbWVudC53IC8gMiAqIGRwcjsKICAgICAgaGFsdmVzW2kgKiAyICsgMV0gPSBlbGVtZW50LmggLyAyICogZHByOwogICAgICByYWRpaVtpXSA9IE1hdGgubWluKGVsZW1lbnQucmFkaXVzID8/IG0ucmFkaXVzLCBzaG9ydCAqIDAuMjM1KSAqIGRwcjsKICAgICAgdHlwZXNbaV0gPSBlbGVtZW50LnNoYXBlID09PSAncGlsbCcgPyAxIDogZWxlbWVudC5zaGFwZSA9PT0gJ2NpcmNsZScgPyAyIDogMDsKICAgIH0pOwoKICAgIGdsLmFjdGl2ZVRleHR1cmUoZ2wuVEVYVFVSRTApOwogICAgZ2wuYmluZFRleHR1cmUoZ2wuVEVYVFVSRV8yRCwgdGhpcy50ZXgpOwogICAgZ2wudW5pZm9ybTFpKGxvYy51U3JjLCAwKTsKICAgIGdsLmFjdGl2ZVRleHR1cmUoZ2wuVEVYVFVSRTIpOwogICAgZ2wuYmluZFRleHR1cmUoZ2wuVEVYVFVSRV8yRCwgdGhpcy5ibHVyVGV4KTsKICAgIGdsLnVuaWZvcm0xaShsb2MudUJsdXJTcmMsIDIpOwogICAgZ2wudW5pZm9ybTJmKGxvYy51UmVzLCB0aGlzLncsIHRoaXMuaCk7CiAgICBnbC51bmlmb3JtMmYobG9jLnVDZW50ZXIsIGN4LCBjeSk7CiAgICBnbC51bmlmb3JtMmYobG9jLnVIYWxmLCBodywgaGgpOwogICAgZ2wudW5pZm9ybTFpKGxvYy51U2hhcGVDb3VudCwgc2hhcGVzLmxlbmd0aCk7CiAgICBnbC51bmlmb3JtMmZ2KGxvYy51U2hhcGVDZW50ZXJzLCBjZW50ZXJzKTsKICAgIGdsLnVuaWZvcm0yZnYobG9jLnVTaGFwZUhhbHZlcywgaGFsdmVzKTsKICAgIGdsLnVuaWZvcm0xaXYobG9jLnVTaGFwZVR5cGVzLCB0eXBlcyk7CiAgICBnbC51bmlmb3JtMWZ2KGxvYy51U2hhcGVSYWRpaSwgcmFkaWkpOwogICAgZ2wudW5pZm9ybTFmKGxvYy51TWVyZ2VSYWRpdXMsIE1hdGgubWF4KDAsIG1lcmdlUmFkaXVzKSAqIGRwcik7CiAgICBnbC51bmlmb3JtMWYobG9jLnVQYWQsIChtLnNoYWRvd1NpemUgKiA0ICsgTWF0aC5tYXgobWVyZ2VSYWRpdXMsIDApICogMC4zICsgOCkgKiBkcHIpOwogICAgZ2wudW5pZm9ybTFmKGxvYy51U3F1aXJjbGUsIG0uc3F1aXJjbGUpOwogICAgZ2wudW5pZm9ybTFmKGxvYy51QmV2ZWwsIG0uYmV2ZWwgKiBkcHIpOwogICAgZ2wudW5pZm9ybTFmKGxvYy51SGVpZ2h0LCBtLmhlaWdodCAqIGRwcik7CiAgICBnbC51bmlmb3JtMWYobG9jLnVTaXplQWRhcHRhdGlvbiwgbS5zaXplQWRhcHRhdGlvbiA/PyAxKTsKICAgIGdsLnVuaWZvcm0xZihsb2MudUlPUiwgbS5pb3IpOwogICAgZ2wudW5pZm9ybTFmKGxvYy51RGlzcGVyc2lvbiwgbS5kaXNwZXJzaW9uKTsKICAgIGdsLnVuaWZvcm0xZihsb2MudUJsdXJQbGF0ZWF1LCBtLmJsdXJQbGF0ZWF1ICogZHByKTsKICAgIGdsLnVuaWZvcm0xZihsb2MudUJsdXJSaW0sIG0uYmx1clJpbSAqIGRwcik7CiAgICBnbC51bmlmb3JtMWYobG9jLnVPcHRpY2FsRGVuc2l0eSwgbS5vcHRpY2FsRGVuc2l0eSk7CiAgICBnbC51bmlmb3JtMWYobG9jLnVNaXBzLCB0aGlzLm1pcExldmVscyk7CiAgICBnbC51bmlmb3JtMWYobG9jLnVTcGVjdWxhciwgbS5zcGVjdWxhcik7CiAgICBnbC51bmlmb3JtMWYobG9jLnVTcGVjUG93ZXIsIG0uc3BlY1Bvd2VyKTsKICAgIGdsLnVuaWZvcm0xZihsb2MudUhpZ2hsaWdodEFkYXB0LCBtLmhpZ2hsaWdodEFkYXB0KTsKICAgIGdsLnVuaWZvcm0xZihsb2MudUhpZ2hsaWdodFdpZHRoLCBtLmhpZ2hsaWdodFdpZHRoKTsKICAgIGdsLnVuaWZvcm0xZihsb2MudUhpZ2hsaWdodFNoYXJwbmVzcywgbS5oaWdobGlnaHRTaGFycG5lc3MpOwogICAgZ2wudW5pZm9ybTFmKGxvYy51SGlnaGxpZ2h0QmFzZSwgbS5oaWdobGlnaHRCYXNlKTsKICAgIGdsLnVuaWZvcm0xZihsb2MudUZyZXNuZWwsIG0uZnJlc25lbCk7CiAgICBnbC51bmlmb3JtMWYobG9jLnVTYXQsIG0uc2F0dXJhdGlvbik7CiAgICBnbC51bmlmb3JtMWYobG9jLnVCcmlnaHQsIG0uYnJpZ2h0bmVzcyk7CiAgICBnbC51bmlmb3JtMWYobG9jLnVUaW50QW1vdW50LCBtLnRpbnRBbW91bnQpOwogICAgZ2wudW5pZm9ybTNmKGxvYy51VGludENvbG9yLCAuLi5tLnRpbnRDb2xvcik7CiAgICBnbC51bmlmb3JtMWYobG9jLnVUaW50QWRhcHQsIG0udGludEFkYXB0ID8/IDApOwogICAgZ2wudW5pZm9ybTFmKGxvYy51U2hhZG93LCBtLnNoYWRvdyk7CiAgICBnbC51bmlmb3JtMWYobG9jLnVTaGFkb3dTaXplLCBtLnNoYWRvd1NpemUgKiBkcHIpOwogICAgZ2wudW5pZm9ybTFmKGxvYy51U2hhZG93T2Zmc2V0LCBtLnNoYWRvd09mZnNldCAqIGRwcik7CiAgICBnbC51bmlmb3JtMmYobG9jLnVMaWdodERpciwgbS5saWdodFgsIG0ubGlnaHRZKTsKICAgIGdsLnVuaWZvcm0xZihsb2MudUVkZ2VMaW5lLCBtLmVkZ2VMaW5lKTsKICAgIGdsLnVuaWZvcm0xZihsb2MudUVkZ2VXaWR0aCwgbS5lZGdlV2lkdGggKiBkcHIpOwogICAgZ2wudW5pZm9ybTFmKGxvYy51RWRnZURhcmssIG0uZWRnZURhcmspOwogICAgZ2wudW5pZm9ybTFmKGxvYy51UmVmcmFjdFNjYWxlLCBtLnJlZnJhY3RTY2FsZSk7CiAgICBnbC51bmlmb3JtMWYobG9jLnVNZW5pc2N1cywgbS5tZW5pc2N1cyk7CiAgICBnbC51bmlmb3JtMWkobG9jLnVEZWJ1ZywgbS5kZWJ1ZyB8IDApOwoKICAgIGdsLmRyYXdBcnJheXMoZ2wuVFJJQU5HTEVfU1RSSVAsIDAsIDQpOwogICAgZ2wuZGlzYWJsZShnbC5CTEVORCk7CiAgfQoKICBkcmF3R2xhc3MoZWxlbWVudCwgbSwgZHByKSB7CiAgICB0aGlzLmRyYXdHbGFzc0dyb3VwKFtlbGVtZW50XSwgbSwgZHByLCAwKTsKICB9CgogIC8vIFYyIHN1cmZhY2VzIHNoYXJlIFYxJ3MgcHVibGljIHNpbGhvdWV0dGVzIGFuZCBiYWNrZHJvcC9taXAgcGlwZWxpbmUsIGJ1dAogIC8vIG5vdGhpbmcgZnJvbSB0aGUgbWF0ZXJpYWwgY2FsY3VsYXRpb24uIEluIHBhcnRpY3VsYXIsIHNpbWlsYXJseSBuYW1lZAogIC8vIHVuaWZvcm1zIGFyZSBmaWxsZWQgdXNpbmcgVjIncyBvd24gdW5pdHM6IGVkZ2VXaWR0aCBpcyBhIGZyYWN0aW9uLAogIC8vIGRpc3BlcnNpb24gaXMgYSBwaXhlbCBzcGxpdCwgYW5kIHJvdW5kbmVzcyBpcyBhIHNob3J0LWhhbGYgcmF0aW8uCiAgZHJhd0dsYXNzVjJHcm91cChlbGVtZW50cywgbSwgZHByLCBsaWdodERpcmVjdGlvbnMgPSBbXSwgdGludExpZ2h0cyA9IFtdKSB7CiAgICBpZiAoIWVsZW1lbnRzLmxlbmd0aCB8fCB0aGlzLmxvc3QgfHwgIXRoaXMudGV4KSByZXR1cm47CgogICAgY29uc3QgZ2wgPSB0aGlzLmdsOwogICAgY29uc3QgeyBsb2MsIHAgfSA9IHRoaXMucHJvZ0dsYXNzOwogICAgY29uc3Qgc2hhcGVzID0gZWxlbWVudHMuc2xpY2UoMCwgTUFYX0dMQVNTX1NIQVBFUyk7CiAgICBjb25zdCBtaW5YID0gTWF0aC5taW4oLi4uc2hhcGVzLm1hcCgoZWxlbWVudCkgPT4gZWxlbWVudC54KSk7CiAgICBjb25zdCBtaW5ZID0gTWF0aC5taW4oLi4uc2hhcGVzLm1hcCgoZWxlbWVudCkgPT4gZWxlbWVudC55KSk7CiAgICBjb25zdCBtYXhYID0gTWF0aC5tYXgoLi4uc2hhcGVzLm1hcCgoZWxlbWVudCkgPT4gZWxlbWVudC54ICsgZWxlbWVudC53KSk7CiAgICBjb25zdCBtYXhZID0gTWF0aC5tYXgoLi4uc2hhcGVzLm1hcCgoZWxlbWVudCkgPT4gZWxlbWVudC55ICsgZWxlbWVudC5oKSk7CiAgICBjb25zdCBncm91cFdpZHRoID0gbWF4WCAtIG1pblg7CiAgICBjb25zdCBncm91cEhlaWdodCA9IG1heFkgLSBtaW5ZOwoKICAgIGNvbnN0IGNlbnRlcnMgPSBuZXcgRmxvYXQzMkFycmF5KE1BWF9HTEFTU19TSEFQRVMgKiAyKTsKICAgIGNvbnN0IGhhbHZlcyA9IG5ldyBGbG9hdDMyQXJyYXkoTUFYX0dMQVNTX1NIQVBFUyAqIDIpOwogICAgY29uc3QgcmFkaWkgPSBuZXcgRmxvYXQzMkFycmF5KE1BWF9HTEFTU19TSEFQRVMpOwogICAgY29uc3QgdHlwZXMgPSBuZXcgSW50MzJBcnJheShNQVhfR0xBU1NfU0hBUEVTKTsKICAgIGNvbnN0IGxpZ2h0cyA9IG5ldyBGbG9hdDMyQXJyYXkoTUFYX0dMQVNTX1NIQVBFUyAqIDIpOwogICAgY29uc3QgdGludHMgPSBuZXcgRmxvYXQzMkFycmF5KE1BWF9HTEFTU19TSEFQRVMpOwogICAgY29uc3QgdGludFRvbmVzID0gbmV3IEZsb2F0MzJBcnJheShNQVhfR0xBU1NfU0hBUEVTKTsKICAgIGNvbnN0IGZyb3N0cyA9IG5ldyBGbG9hdDMyQXJyYXkoTUFYX0dMQVNTX1NIQVBFUyk7CiAgICBjb25zdCBvcGFjaXRpZXMgPSBuZXcgRmxvYXQzMkFycmF5KE1BWF9HTEFTU19TSEFQRVMpOwogICAgc2hhcGVzLmZvckVhY2goKGVsZW1lbnQsIGkpID0+IHsKICAgICAgY29uc3Qgc2hvcnQgPSBNYXRoLm1pbihlbGVtZW50LncsIGVsZW1lbnQuaCk7CiAgICAgIGNlbnRlcnNbaSAqIDJdID0gKGVsZW1lbnQueCArIGVsZW1lbnQudyAvIDIpICogZHByOwogICAgICBjZW50ZXJzW2kgKiAyICsgMV0gPSB0aGlzLmggLSAoZWxlbWVudC55ICsgZWxlbWVudC5oIC8gMikgKiBkcHI7CiAgICAgIGhhbHZlc1tpICogMl0gPSBlbGVtZW50LncgLyAyICogZHByOwogICAgICBoYWx2ZXNbaSAqIDIgKyAxXSA9IGVsZW1lbnQuaCAvIDIgKiBkcHI7CiAgICAgIC8vIFYyIG5vcm1hbGx5IGRlcml2ZXMgdGhlIGNvcm5lciBmcm9tIGl0cyBkaW1lbnNpb25sZXNzIHJvdW5kbmVzcwogICAgICAvLyByYXRpby4gQW4gZXhwbGljaXQgZWxlbWVudCByYWRpdXMga2VlcHMgc3VyZmFjZXMgc3VjaCBhcyBhIHBob25lCiAgICAgIC8vIHNjcmVlbiBleGFjdGx5IGFsaWduZWQgd2l0aCB0aGVpciBleHRlcm5hbCBjbGlwIHBhdGguCiAgICAgIHJhZGlpW2ldID0gTWF0aC5taW4oCiAgICAgICAgZWxlbWVudC5yYWRpdXMgPz8gc2hvcnQgKiAwLjUgKiBtLnJvdW5kbmVzcywKICAgICAgICBzaG9ydCAqIDAuNSwKICAgICAgKSAqIGRwcjsKICAgICAgdHlwZXNbaV0gPSBlbGVtZW50LnNoYXBlID09PSAncGlsbCcgPyAxCiAgICAgICAgOiBlbGVtZW50LnNoYXBlID09PSAnY2lyY2xlJyA/IDIgOiAwOwogICAgICBjb25zdCBkaXJlY3Rpb24gPSBsaWdodERpcmVjdGlvbnNbaV0gPz8gW01hdGguU1FSVDFfMiwgTWF0aC5TUVJUMV8yXTsKICAgICAgbGlnaHRzW2kgKiAyXSA9IGRpcmVjdGlvblswXTsKICAgICAgbGlnaHRzW2kgKiAyICsgMV0gPSBkaXJlY3Rpb25bMV07CiAgICAgIHRpbnRzW2ldID0gZWxlbWVudC50aW50ID8/IG0udGludDsKICAgICAgdGludFRvbmVzW2ldID0gdGludExpZ2h0c1tpXSA/PyAxOwogICAgICAvLyBWMiBmcm9zdCBpcyBhIGRpbWVuc2lvbmxlc3MgcmF0aW8gcmVzb2x2ZWQgaW4gdGhlIHNoYWRlciBhZ2FpbnN0IHRoZQogICAgICAvLyBjb21wb25lbnQgc2hvcnQgc2lkZS4gVjEga2VlcHMgaXRzIGF1dGhvcmVkIENTUy1waXhlbCBibHVyIGxlbmd0aHMuCiAgICAgIGZyb3N0c1tpXSA9IGVsZW1lbnQuZnJvc3QgPz8gbS5mcm9zdDsKICAgICAgb3BhY2l0aWVzW2ldID0gZWxlbWVudC5vcGFjaXR5ID8/IDE7CiAgICB9KTsKCiAgICBnbC5iaW5kRnJhbWVidWZmZXIoZ2wuRlJBTUVCVUZGRVIsIG51bGwpOwogICAgZ2wudmlld3BvcnQoMCwgMCwgdGhpcy53LCB0aGlzLmgpOwogICAgZ2wuZW5hYmxlKGdsLkJMRU5EKTsKICAgIGdsLmJsZW5kRnVuYyhnbC5PTkUsIGdsLk9ORV9NSU5VU19TUkNfQUxQSEEpOwogICAgZ2wuYmluZFZlcnRleEFycmF5KHRoaXMucXVhZCk7CiAgICBnbC51c2VQcm9ncmFtKHApOwoKICAgIGdsLmFjdGl2ZVRleHR1cmUoZ2wuVEVYVFVSRTApOwogICAgZ2wuYmluZFRleHR1cmUoZ2wuVEVYVFVSRV8yRCwgdGhpcy50ZXgpOwogICAgZ2wudW5pZm9ybTFpKGxvYy51U3JjLCAwKTsKICAgIGdsLnVuaWZvcm0yZihsb2MudVJlcywgdGhpcy53LCB0aGlzLmgpOwogICAgZ2wudW5pZm9ybTFmKGxvYy51RHByLCBkcHIpOwogICAgZ2wudW5pZm9ybTJmKGxvYy51Q2VudGVyLAogICAgICAobWluWCArIGdyb3VwV2lkdGggLyAyKSAqIGRwciwKICAgICAgdGhpcy5oIC0gKG1pblkgKyBncm91cEhlaWdodCAvIDIpICogZHByKTsKICAgIGdsLnVuaWZvcm0yZihsb2MudUhhbGYsIGdyb3VwV2lkdGggLyAyICogZHByLCBncm91cEhlaWdodCAvIDIgKiBkcHIpOwogICAgZ2wudW5pZm9ybTFmKGxvYy51UGFkLCA0ICogZHByKTsKICAgIGdsLnVuaWZvcm0xZihsb2MudU1pcHMsIHRoaXMubWlwTGV2ZWxzKTsKICAgIGdsLnVuaWZvcm0xaShsb2MudVNoYXBlQ291bnQsIHNoYXBlcy5sZW5ndGgpOwogICAgZ2wudW5pZm9ybTJmdihsb2MudVNoYXBlQ2VudGVycywgY2VudGVycyk7CiAgICBnbC51bmlmb3JtMmZ2KGxvYy51U2hhcGVIYWx2ZXMsIGhhbHZlcyk7CiAgICBnbC51bmlmb3JtMWl2KGxvYy51U2hhcGVUeXBlcywgdHlwZXMpOwogICAgZ2wudW5pZm9ybTFmdihsb2MudVNoYXBlUmFkaWksIHJhZGlpKTsKICAgIGdsLnVuaWZvcm0xZnYobG9jLnVTaGFwZVRpbnRzLCB0aW50cyk7CiAgICBnbC51bmlmb3JtMWZ2KGxvYy51U2hhcGVUaW50TGlnaHRzLCB0aW50VG9uZXMpOwogICAgZ2wudW5pZm9ybTFmdihsb2MudVNoYXBlRnJvc3RzLCBmcm9zdHMpOwogICAgZ2wudW5pZm9ybTFmdihsb2MudVNoYXBlT3BhY2l0aWVzLCBvcGFjaXRpZXMpOwogICAgZ2wudW5pZm9ybTJmdihsb2MudUxpZ2h0RGlycywgbGlnaHRzKTsKICAgIGdsLnVuaWZvcm0xZihsb2MudVJlZnJhY3Rpb24sIG0ucmVmcmFjdGlvbiAqIGRwcik7CiAgICBnbC51bmlmb3JtMWYobG9jLnVFZGdlUmVhY2gsIG0uZWRnZVJlYWNoICogZHByKTsKICAgIGdsLnVuaWZvcm0xZihsb2MudUVkZ2VXaWR0aCwgbS5lZGdlV2lkdGgpOwogICAgZ2wudW5pZm9ybTFmKGxvYy51RGlzcGVyc2lvbiwgbS5kaXNwZXJzaW9uKTsKICAgIGdsLnVuaWZvcm0xZihsb2MudUJvZHksIG0uYm9keSk7CiAgICBnbC51bmlmb3JtMWYobG9jLnVBYnNvcnB0aW9uLCBtLmFic29ycHRpb24pOwogICAgZ2wudW5pZm9ybTFmKGxvYy51UmltLCBtLnJpbSk7CiAgICBnbC51bmlmb3JtMWYobG9jLnVSZWZsZWN0aW9uLCBtLnJlZmxlY3Rpb24pOwogICAgZ2wudW5pZm9ybTFmKGxvYy51SGlnaGxpZ2h0LCBtLmhpZ2hsaWdodCk7CiAgICBnbC51bmlmb3JtMWYobG9jLnVFY2hvLCBtLmVjaG8pOwogICAgZ2wudW5pZm9ybTFmKGxvYy51SGFpcmxpbmUsIG0uaGFpcmxpbmUpOwogICAgZ2wudW5pZm9ybTFmKGxvYy51SGFpcldpZHRoLCBtLmhhaXJXaWR0aCk7CgogICAgZ2wuZHJhd0FycmF5cyhnbC5UUklBTkdMRV9TVFJJUCwgMCwgNCk7CiAgICBnbC5kaXNhYmxlKGdsLkJMRU5EKTsKICB9CgogIGRlc3Ryb3koKSB7CiAgICBpZiAodGhpcy5sb3N0KSB7CiAgICAgIHRoaXMud2FsbHBhcGVycyA9IFtdOwogICAgICByZXR1cm47CiAgICB9CiAgICBjb25zdCBnbCA9IHRoaXMuZ2w7CiAgICB0aGlzLnJlbGVhc2VUYXJnZXRzKCk7CiAgICB0aGlzLnJlbGVhc2VSZXNvdXJjZXMoKTsKICAgIHRoaXMud2FsbHBhcGVycy5mb3JFYWNoKChlbnRyeSkgPT4gZ2wuZGVsZXRlVGV4dHVyZShlbnRyeS50ZXh0dXJlKSk7CiAgICB0aGlzLndhbGxwYXBlcnMgPSBbXTsKICB9Cn0KCgovLyA9PT09PSB2Mi5qcyA9PT09PQoKCgoKCmNvbnN0IFNIQVBFU19WMiA9IG5ldyBTZXQoWydmb2xkZXInLCAncmVjdCcsICdwaWxsJywgJ2NpcmNsZSddKTsKY29uc3QgQ09NUE9TSVRFX01PREVTID0gbmV3IFNldChbJ3JlcGxhY2UnLCAnb3ZlcmxheSddKTsKY29uc3QgQkFDS0RST1BfVVBEQVRFUyA9IG5ldyBTZXQoWydhdXRvJywgJ3N0YXRpYycsICdsaXZlJ10pOwpjb25zdCBSRURVQ0VEX1RSQU5TUEFSRU5DWV9RVUVSWSA9ICcocHJlZmVycy1yZWR1Y2VkLXRyYW5zcGFyZW5jeTogcmVkdWNlKSc7CgpmdW5jdGlvbiBub3JtYWxpemVDb21wb3NpdGVNb2RlKG1vZGUpIHsKICBpZiAoIUNPTVBPU0lURV9NT0RFUy5oYXMobW9kZSkpIHRocm93IG5ldyBUeXBlRXJyb3IoYFVua25vd24gbGlxdWlkIGdsYXNzIFYyIGNvbXBvc2l0ZSBtb2RlOiAke21vZGV9YCk7CiAgcmV0dXJuIG1vZGU7Cn0KCmZ1bmN0aW9uIG5vcm1hbGl6ZVNoYXBlKHNoYXBlKSB7CiAgY29uc3Qgbm9ybWFsaXplZCA9IHNoYXBlID09PSAnZm9sZGVyUmVjdCcgPyAncmVjdCcgOiBzaGFwZTsKICBpZiAoIVNIQVBFU19WMi5oYXMobm9ybWFsaXplZCkpIHRocm93IG5ldyBUeXBlRXJyb3IoYFVua25vd24gbGlxdWlkIGdsYXNzIFYyIHNoYXBlOiAke3NoYXBlfWApOwogIHJldHVybiBub3JtYWxpemVkOwp9CgpmdW5jdGlvbiBub3JtYWxpemVFbGVtZW50KGlucHV0LCBpbmRleCkgewogIGNvbnN0IHdpZHRoID0gTnVtYmVyKGlucHV0LncgPz8gaW5wdXQud2lkdGggPz8gaW5wdXQuc2l6ZSA/PyAwKTsKICBjb25zdCBoZWlnaHQgPSBOdW1iZXIoaW5wdXQuaCA/PyBpbnB1dC5oZWlnaHQgPz8gaW5wdXQuc2l6ZSA/PyB3aWR0aCk7CiAgaWYgKCEod2lkdGggPiAwKSB8fCAhKGhlaWdodCA+IDApKSB7CiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdMaXF1aWQgZ2xhc3MgVjIgZWxlbWVudHMgbmVlZCBhIHBvc2l0aXZlIHdpZHRoIGFuZCBoZWlnaHQuJyk7CiAgfQogIGNvbnN0IHRpbnQgPSBpbnB1dC50aW50ID09IG51bGwgPyB1bmRlZmluZWQgOiBOdW1iZXIoaW5wdXQudGludCk7CiAgaWYgKHRpbnQgIT09IHVuZGVmaW5lZCAmJiAhTnVtYmVyLmlzRmluaXRlKHRpbnQpKSB7CiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdMaXF1aWQgZ2xhc3MgVjIgZWxlbWVudCB0aW50IG11c3QgYmUgYSBmaW5pdGUgbnVtYmVyLicpOwogIH0KICBjb25zdCBmcm9zdCA9IGlucHV0LmZyb3N0ID09IG51bGwgPyB1bmRlZmluZWQgOiBOdW1iZXIoaW5wdXQuZnJvc3QpOwogIGlmIChmcm9zdCAhPT0gdW5kZWZpbmVkICYmICFOdW1iZXIuaXNGaW5pdGUoZnJvc3QpKSB7CiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdMaXF1aWQgZ2xhc3MgVjIgZWxlbWVudCBmcm9zdCBtdXN0IGJlIGEgZmluaXRlIG51bWJlci4nKTsKICB9CiAgY29uc3Qgb3BhY2l0eSA9IGlucHV0Lm9wYWNpdHkgPT0gbnVsbCA/IHVuZGVmaW5lZCA6IE51bWJlcihpbnB1dC5vcGFjaXR5KTsKICBpZiAob3BhY2l0eSAhPT0gdW5kZWZpbmVkICYmICFOdW1iZXIuaXNGaW5pdGUob3BhY2l0eSkpIHsKICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0xpcXVpZCBnbGFzcyBWMiBlbGVtZW50IG9wYWNpdHkgbXVzdCBiZSBhIGZpbml0ZSBudW1iZXIuJyk7CiAgfQogIGNvbnN0IHRpbnRUb25lID0gaW5wdXQudGludFRvbmUgPz8gJ2F1dG8nOwogIGlmICghWydhdXRvJywgJ2xpZ2h0JywgJ2RhcmsnXS5pbmNsdWRlcyh0aW50VG9uZSkpIHsKICAgIHRocm93IG5ldyBUeXBlRXJyb3IoYFVua25vd24gbGlxdWlkIGdsYXNzIFYyIHRpbnQgdG9uZTogJHt0aW50VG9uZX1gKTsKICB9CiAgcmV0dXJuIHsKICAgIC4uLmlucHV0LAogICAgaWQ6IGlucHV0LmlkID8/IGBnbGFzcy12Mi0ke2luZGV4ICsgMX1gLAogICAgc2hhcGU6IG5vcm1hbGl6ZVNoYXBlKGlucHV0LnNoYXBlID8/ICdyZWN0JyksCiAgICB4OiBOdW1iZXIoaW5wdXQueCA/PyAwKSwKICAgIHk6IE51bWJlcihpbnB1dC55ID8/IDApLAogICAgdzogd2lkdGgsCiAgICBoOiBoZWlnaHQsCiAgICAuLi4odGludCA9PT0gdW5kZWZpbmVkID8ge30gOiB7IHRpbnQgfSksCiAgICAuLi4oZnJvc3QgPT09IHVuZGVmaW5lZCA/IHt9IDogeyBmcm9zdCB9KSwKICAgIC4uLihvcGFjaXR5ID09PSB1bmRlZmluZWQgPyB7fSA6IHsgb3BhY2l0eSB9KSwKICAgIC4uLihpbnB1dC50aW50VG9uZSA9PSBudWxsID8ge30gOiB7IHRpbnRUb25lIH0pLAogIH07Cn0KCmZ1bmN0aW9uIHJlc29sdmVJbWFnZShzb3VyY2UpIHsKICBpZiAodHlwZW9mIHNvdXJjZSAhPT0gJ3N0cmluZycpIHJldHVybiBQcm9taXNlLnJlc29sdmUoc291cmNlKTsKICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4gewogICAgY29uc3QgaW1hZ2UgPSBuZXcgSW1hZ2UoKTsKICAgIGltYWdlLm9ubG9hZCA9ICgpID0+IHJlc29sdmUoaW1hZ2UpOwogICAgaW1hZ2Uub25lcnJvciA9ICgpID0+IHJlamVjdChuZXcgRXJyb3IoYFVuYWJsZSB0byBsb2FkIGxpcXVpZCBnbGFzcyBWMiB3YWxscGFwZXI6ICR7c291cmNlfWApKTsKICAgIGltYWdlLnNyYyA9IHNvdXJjZTsKICB9KTsKfQoKZnVuY3Rpb24gaXNMaXZlQmFja2Ryb3BTb3VyY2Uoc291cmNlKSB7CiAgY29uc3QgdGFnTmFtZSA9IHNvdXJjZT8udGFnTmFtZT8udG9VcHBlckNhc2UoKTsKICByZXR1cm4gdGFnTmFtZSA9PT0gJ0NBTlZBUycgfHwgdGFnTmFtZSA9PT0gJ1ZJREVPJwogICAgfHwgc291cmNlPy5jb25zdHJ1Y3Rvcj8ubmFtZSA9PT0gJ09mZnNjcmVlbkNhbnZhcycKICAgIHx8IHNvdXJjZT8uY29uc3RydWN0b3I/Lm5hbWUgPT09ICdWaWRlb0ZyYW1lJzsKfQoKZnVuY3Rpb24gcmVzb2x2ZUJhY2tkcm9wVXBkYXRlKHNvdXJjZSwgdXBkYXRlID0gJ2F1dG8nKSB7CiAgaWYgKCFCQUNLRFJPUF9VUERBVEVTLmhhcyh1cGRhdGUpKSB7CiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKGBVbmtub3duIGxpcXVpZCBnbGFzcyBWMiBiYWNrZHJvcCB1cGRhdGUgbW9kZTogJHt1cGRhdGV9YCk7CiAgfQogIHJldHVybiB1cGRhdGUgPT09ICdhdXRvJyA/IChpc0xpdmVCYWNrZHJvcFNvdXJjZShzb3VyY2UpID8gJ2xpdmUnIDogJ3N0YXRpYycpIDogdXBkYXRlOwp9CgpmdW5jdGlvbiBtYXRjaE1lZGlhU2FmZShxdWVyeSkgewogIHJldHVybiB0eXBlb2YgZ2xvYmFsVGhpcy5tYXRjaE1lZGlhID09PSAnZnVuY3Rpb24nID8gZ2xvYmFsVGhpcy5tYXRjaE1lZGlhKHF1ZXJ5KSA6IG51bGw7Cn0KCi8qKgogKiBDbGVhciBvcHRpY2FsIExpcXVpZCBHbGFzcyBWMi4KICoKICogVGhpcyBpcyBhIHNlcGFyYXRlIHB1YmxpYyBjbGFzcywgbm90IGEgbW9kZSBvbiBMaXF1aWRHbGFzc1dlYkdMLiBJdHMgbWF0ZXJpYWwKICogdmFsdWVzIGFyZSBuZXZlciBjb252ZXJ0ZWQgZnJvbSBWMS4gSXQgaW50ZW50aW9uYWxseSBzaGFyZXMgVjEncyBwdWJsaWMKICogc2hhcGUgc2lsaG91ZXR0ZXMgd2hpbGUgcmVmcmFjdGlvbiwgY2hyb21hdGljIHNwbGl0LCB0aW50IGFuZCBpbnRlcmZhY2UKICogbGlnaHRpbmcgY29udGludWUgdG8gZm9sbG93IHRoZSBpbmRlcGVuZGVudCBWMiBlcXVhdGlvbnMuCiAqLwpjbGFzcyBMaXF1aWRHbGFzc1dlYkdMVjIgewogIHN0YXRpYyBpc1N1cHBvcnRlZCgpIHsKICAgIGlmICh0eXBlb2YgZG9jdW1lbnQgPT09ICd1bmRlZmluZWQnKSByZXR1cm4gZmFsc2U7CiAgICB0cnkgewogICAgICBjb25zdCBwcm9iZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpOwogICAgICBjb25zdCBnbCA9IHByb2JlLmdldENvbnRleHQoJ3dlYmdsMicpOwogICAgICBpZiAoIWdsKSByZXR1cm4gZmFsc2U7CiAgICAgIGdsLmdldEV4dGVuc2lvbignV0VCR0xfbG9zZV9jb250ZXh0Jyk/Lmxvc2VDb250ZXh0KCk7CiAgICAgIHJldHVybiB0cnVlOwogICAgfSBjYXRjaCB7CiAgICAgIHJldHVybiBmYWxzZTsKICAgIH0KICB9CgogIGNvbnN0cnVjdG9yKGNhbnZhcywgb3B0aW9ucyA9IHt9KSB7CiAgICBpZiAoIWNhbnZhcyB8fCB0eXBlb2YgY2FudmFzLmdldENvbnRleHQgIT09ICdmdW5jdGlvbicpIHsKICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignTGlxdWlkR2xhc3NXZWJHTFYyIG5lZWRzIGFuIEhUTUxDYW52YXNFbGVtZW50LicpOwogICAgfQogICAgdGhpcy5jYW52YXMgPSBjYW52YXM7CiAgICB0aGlzLnZlcnNpb24gPSAndjInOwogICAgdGhpcy5jb21wb3NpdGVNb2RlID0gbm9ybWFsaXplQ29tcG9zaXRlTW9kZShvcHRpb25zLmNvbXBvc2l0ZU1vZGUgPz8gJ3JlcGxhY2UnKTsKICAgIHRoaXMucmVuZGVyZXIgPSBuZXcgR2xhc3NSZW5kZXJlcihjYW52YXMsIHsKICAgICAgYWxwaGE6IHRoaXMuY29tcG9zaXRlTW9kZSA9PT0gJ292ZXJsYXknLAogICAgICBwcmVzZXJ2ZURyYXdpbmdCdWZmZXI6IEJvb2xlYW4ob3B0aW9ucy5wcmVzZXJ2ZURyYXdpbmdCdWZmZXIpLAogICAgICBtYXRlcmlhbFZlcnNpb246IDIsCiAgICB9KTsKICAgIHRoaXMubWF0ZXJpYWwgPSBtYWtlTWF0ZXJpYWxWMihvcHRpb25zLm1hdGVyaWFsKTsKICAgIHRoaXMuZWxlbWVudHMgPSBbXTsKICAgIHRoaXMuYmFja2Ryb3BzID0gW107CiAgICB0aGlzLndhbGxwYXBlckluZGV4ID0gMDsKICAgIHRoaXMud2FsbHBhcGVyWm9vbSA9IG9wdGlvbnMud2FsbHBhcGVyWm9vbSA/PyAxOwogICAgdGhpcy5ydW5uaW5nID0gZmFsc2U7CiAgICB0aGlzLmFuaW1hdGlvbkZyYW1lID0gMDsKICAgIHRoaXMuZGlydHkgPSB0cnVlOwogICAgdGhpcy5iYWNrZHJvcERpcnR5ID0gdHJ1ZTsKICAgIHRoaXMubGlnaHRGaWVsZERpcnR5ID0gdHJ1ZTsKICAgIHRoaXMubGFzdEZyYW1lID0geyB3aWR0aDogMCwgaGVpZ2h0OiAwLCBkcHI6IDAgfTsKICAgIHRoaXMud2FybmVkU2hhcGVMaW1pdCA9IGZhbHNlOwogICAgdGhpcy5saWdodENhbnZhcyA9IG51bGw7CiAgICB0aGlzLmxpZ2h0UGl4ZWxzID0gbnVsbDsKICAgIHRoaXMubGlnaHRTYW1wbGVTaXplID0gNjQ7CiAgICB0aGlzLnNtb290aGVkTGlnaHREaXJlY3Rpb25zID0gbmV3IE1hcCgpOwogICAgdGhpcy5sYXN0TGlnaHRGaWVsZFVwZGF0ZSA9IDA7CiAgICB0aGlzLmxhc3RMaWdodEJsZW5kVGltZSA9IDA7CiAgICB0aGlzLm9uQ29udGV4dExvc3QgPSBvcHRpb25zLm9uQ29udGV4dExvc3QgPz8gbnVsbDsKICAgIHRoaXMub25Db250ZXh0UmVzdG9yZWQgPSBvcHRpb25zLm9uQ29udGV4dFJlc3RvcmVkID8/IG51bGw7CgogICAgdGhpcy5yZXNwZWN0UmVkdWNlZFRyYW5zcGFyZW5jeSA9IG9wdGlvbnMucmVzcGVjdFJlZHVjZWRUcmFuc3BhcmVuY3kgPz8gdHJ1ZTsKICAgIHRoaXMucmVkdWNlZFRyYW5zcGFyZW5jeVF1ZXJ5ID0gdGhpcy5yZXNwZWN0UmVkdWNlZFRyYW5zcGFyZW5jeQogICAgICA/IG1hdGNoTWVkaWFTYWZlKFJFRFVDRURfVFJBTlNQQVJFTkNZX1FVRVJZKSA6IG51bGw7CiAgICB0aGlzLmhhbmRsZVJlZHVjZWRUcmFuc3BhcmVuY3lDaGFuZ2UgPSAoKSA9PiB7CiAgICAgIHRoaXMubWFya0RpcnR5KCk7CiAgICAgIHRoaXMucmVuZGVyKCk7CiAgICB9OwogICAgdGhpcy5yZWR1Y2VkVHJhbnNwYXJlbmN5UXVlcnk/LmFkZEV2ZW50TGlzdGVuZXI/LignY2hhbmdlJywgdGhpcy5oYW5kbGVSZWR1Y2VkVHJhbnNwYXJlbmN5Q2hhbmdlKTsKCiAgICB0aGlzLmhhbmRsZUNvbnRleHRMb3N0ID0gKGV2ZW50KSA9PiB7CiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7CiAgICAgIHRoaXMucmVuZGVyZXIuaGFuZGxlQ29udGV4dExvc3QoKTsKICAgICAgdGhpcy5tYXJrQmFja2Ryb3BEaXJ0eSgpOwogICAgICB0aGlzLm9uQ29udGV4dExvc3Q/LihldmVudCk7CiAgICB9OwogICAgdGhpcy5oYW5kbGVDb250ZXh0UmVzdG9yZWQgPSAoZXZlbnQpID0+IHsKICAgICAgdGhpcy5yZW5kZXJlci5yZXN0b3JlKCk7CiAgICAgIHRoaXMubWFya0JhY2tkcm9wRGlydHkoKTsKICAgICAgdGhpcy5sYXN0RnJhbWUgPSB7IHdpZHRoOiAwLCBoZWlnaHQ6IDAsIGRwcjogMCB9OwogICAgICB0aGlzLm9uQ29udGV4dFJlc3RvcmVkPy4oZXZlbnQpOwogICAgICB0aGlzLnJlbmRlcigpOwogICAgfTsKICAgIGNhbnZhcy5hZGRFdmVudExpc3RlbmVyKCd3ZWJnbGNvbnRleHRsb3N0JywgdGhpcy5oYW5kbGVDb250ZXh0TG9zdCwgZmFsc2UpOwogICAgY2FudmFzLmFkZEV2ZW50TGlzdGVuZXIoJ3dlYmdsY29udGV4dHJlc3RvcmVkJywgdGhpcy5oYW5kbGVDb250ZXh0UmVzdG9yZWQsIGZhbHNlKTsKCiAgICB0aGlzLnJlc2l6ZU9ic2VydmVyID0gbnVsbDsKICAgIGlmICgob3B0aW9ucy5hdXRvUmVzaXplID8/IHRydWUpICYmIHR5cGVvZiBnbG9iYWxUaGlzLlJlc2l6ZU9ic2VydmVyID09PSAnZnVuY3Rpb24nKSB7CiAgICAgIHRoaXMucmVzaXplT2JzZXJ2ZXIgPSBuZXcgZ2xvYmFsVGhpcy5SZXNpemVPYnNlcnZlcigoKSA9PiB7CiAgICAgICAgdGhpcy5saWdodEZpZWxkRGlydHkgPSB0cnVlOwogICAgICAgIHRoaXMubWFya0RpcnR5KCk7CiAgICAgICAgdGhpcy5yZW5kZXIoKTsKICAgICAgfSk7CiAgICAgIHRoaXMucmVzaXplT2JzZXJ2ZXIub2JzZXJ2ZShjYW52YXMpOwogICAgfQoKICAgIGlmIChvcHRpb25zLmVsZW1lbnRzKSB0aGlzLnNldEVsZW1lbnRzKG9wdGlvbnMuZWxlbWVudHMsIGZhbHNlKTsKICAgIGlmIChvcHRpb25zLndhbGxwYXBlcnMpIHRoaXMuc2V0V2FsbHBhcGVycyhvcHRpb25zLndhbGxwYXBlcnMsIGZhbHNlKTsKICAgIGlmIChvcHRpb25zLmJhY2tkcm9wKSB7CiAgICAgIHRoaXMuc2V0QmFja2Ryb3Aob3B0aW9ucy5iYWNrZHJvcCwgewogICAgICAgIHVwZGF0ZTogb3B0aW9ucy5iYWNrZHJvcFVwZGF0ZSwKICAgICAgICBhdXRvU3RhcnQ6IG9wdGlvbnMuYXV0b1N0YXJ0LAogICAgICAgIHNob3VsZFJlbmRlcjogZmFsc2UsCiAgICAgIH0pOwogICAgfQogIH0KCiAgZ2V0IGNvbnRleHRMb3N0KCkgeyByZXR1cm4gdGhpcy5yZW5kZXJlci5sb3N0OyB9CiAgZ2V0IHJlZHVjZWRUcmFuc3BhcmVuY3koKSB7IHJldHVybiBCb29sZWFuKHRoaXMucmVkdWNlZFRyYW5zcGFyZW5jeVF1ZXJ5Py5tYXRjaGVzKTsgfQogIGdldCBlZmZlY3RpdmVNYXRlcmlhbCgpIHsKICAgIHJldHVybiB0aGlzLnJlZHVjZWRUcmFuc3BhcmVuY3kKICAgICAgPyB7IC4uLnRoaXMubWF0ZXJpYWwsIC4uLlJFRFVDRURfVFJBTlNQQVJFTkNZX01BVEVSSUFMX1YyIH0KICAgICAgOiB0aGlzLm1hdGVyaWFsOwogIH0KCiAgbWFya0RpcnR5KCkgewogICAgdGhpcy5kaXJ0eSA9IHRydWU7CiAgICByZXR1cm4gdGhpczsKICB9CgogIG1hcmtCYWNrZHJvcERpcnR5KCkgewogICAgdGhpcy5iYWNrZHJvcERpcnR5ID0gdHJ1ZTsKICAgIHRoaXMubGlnaHRGaWVsZERpcnR5ID0gdHJ1ZTsKICAgIHRoaXMubGFzdExpZ2h0RmllbGRVcGRhdGUgPSAwOwogICAgdGhpcy5zbW9vdGhlZExpZ2h0RGlyZWN0aW9ucy5jbGVhcigpOwogICAgcmV0dXJuIHRoaXMubWFya0RpcnR5KCk7CiAgfQoKICBzZXRFbGVtZW50cyhlbGVtZW50cywgc2hvdWxkUmVuZGVyID0gdHJ1ZSkgewogICAgdGhpcy5lbGVtZW50cyA9IGVsZW1lbnRzLm1hcCgoZWxlbWVudCwgaW5kZXgpID0+IG5vcm1hbGl6ZUVsZW1lbnQoZWxlbWVudCwgaW5kZXgpKTsKICAgIHRoaXMubWFya0RpcnR5KCk7CiAgICBpZiAoc2hvdWxkUmVuZGVyKSB0aGlzLnJlbmRlcigpOwogICAgcmV0dXJuIHRoaXM7CiAgfQoKICBhZGRFbGVtZW50KGVsZW1lbnQsIHNob3VsZFJlbmRlciA9IHRydWUpIHsKICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVFbGVtZW50KGVsZW1lbnQsIHRoaXMuZWxlbWVudHMubGVuZ3RoKTsKICAgIHRoaXMuZWxlbWVudHMucHVzaChub3JtYWxpemVkKTsKICAgIHRoaXMubWFya0RpcnR5KCk7CiAgICBpZiAoc2hvdWxkUmVuZGVyKSB0aGlzLnJlbmRlcigpOwogICAgcmV0dXJuIG5vcm1hbGl6ZWQuaWQ7CiAgfQoKICB1cGRhdGVFbGVtZW50KGlkLCBwYXRjaCwgc2hvdWxkUmVuZGVyID0gdHJ1ZSkgewogICAgY29uc3QgaW5kZXggPSB0aGlzLmVsZW1lbnRzLmZpbmRJbmRleCgoZWxlbWVudCkgPT4gZWxlbWVudC5pZCA9PT0gaWQpOwogICAgaWYgKGluZGV4ID09PSAtMSkgcmV0dXJuIHRoaXM7CiAgICB0aGlzLmVsZW1lbnRzW2luZGV4XSA9IG5vcm1hbGl6ZUVsZW1lbnQoeyAuLi50aGlzLmVsZW1lbnRzW2luZGV4XSwgLi4ucGF0Y2ggfSwgaW5kZXgpOwogICAgdGhpcy5tYXJrRGlydHkoKTsKICAgIGlmIChzaG91bGRSZW5kZXIpIHRoaXMucmVuZGVyKCk7CiAgICByZXR1cm4gdGhpczsKICB9CgogIHJlbW92ZUVsZW1lbnQoaWQsIHNob3VsZFJlbmRlciA9IHRydWUpIHsKICAgIHRoaXMuZWxlbWVudHMgPSB0aGlzLmVsZW1lbnRzLmZpbHRlcigoZWxlbWVudCkgPT4gZWxlbWVudC5pZCAhPT0gaWQpOwogICAgdGhpcy5tYXJrRGlydHkoKTsKICAgIGlmIChzaG91bGRSZW5kZXIpIHRoaXMucmVuZGVyKCk7CiAgICByZXR1cm4gdGhpczsKICB9CgogIHNldE1hdGVyaWFsKG1hdGVyaWFsLCBzaG91bGRSZW5kZXIgPSB0cnVlKSB7CiAgICBpZiAodHlwZW9mIG1hdGVyaWFsID09PSAnc3RyaW5nJykgewogICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdMaXF1aWQgR2xhc3MgVjIgZG9lcyBub3QgY29udmVydCBWMSBwcmVzZXQgbmFtZXMuIFBhc3MgYSBWMiBtYXRlcmlhbCBvYmplY3QuJyk7CiAgICB9CiAgICB0aGlzLm1hdGVyaWFsID0gbWFrZU1hdGVyaWFsVjIoeyAuLi50aGlzLm1hdGVyaWFsLCAuLi4obWF0ZXJpYWwgfHwge30pIH0pOwogICAgdGhpcy5tYXJrRGlydHkoKTsKICAgIGlmIChzaG91bGRSZW5kZXIpIHRoaXMucmVuZGVyKCk7CiAgICByZXR1cm4gdGhpczsKICB9CgogIHNldFdhbGxwYXBlcnMoaW1hZ2VzLCBzaG91bGRSZW5kZXIgPSB0cnVlKSB7CiAgICB0aGlzLmJhY2tkcm9wcyA9IGltYWdlcy5zbGljZSgpOwogICAgdGhpcy5yZW5kZXJlci5zZXRXYWxscGFwZXJzKGltYWdlcywgeyB1cGRhdGU6ICdzdGF0aWMnIH0pOwogICAgdGhpcy5tYXJrQmFja2Ryb3BEaXJ0eSgpOwogICAgaWYgKHNob3VsZFJlbmRlcikgdGhpcy5yZW5kZXIoKTsKICAgIHJldHVybiB0aGlzOwogIH0KCiAgYXN5bmMgbG9hZFdhbGxwYXBlcnMoc291cmNlcywgc2hvdWxkUmVuZGVyID0gdHJ1ZSkgewogICAgY29uc3QgaW1hZ2VzID0gYXdhaXQgUHJvbWlzZS5hbGwoc291cmNlcy5tYXAocmVzb2x2ZUltYWdlKSk7CiAgICByZXR1cm4gdGhpcy5zZXRXYWxscGFwZXJzKGltYWdlcywgc2hvdWxkUmVuZGVyKTsKICB9CgogIGFzeW5jIHNldFdhbGxwYXBlcihzb3VyY2UsIHNob3VsZFJlbmRlciA9IHRydWUpIHsKICAgIHJldHVybiB0aGlzLmxvYWRXYWxscGFwZXJzKFtzb3VyY2VdLCBzaG91bGRSZW5kZXIpOwogIH0KCiAgc2V0QmFja2Ryb3Aoc291cmNlLCBvcHRpb25zID0ge30pIHsKICAgIGlmICghc291cmNlIHx8IHR5cGVvZiBzb3VyY2UgPT09ICdzdHJpbmcnKSB7CiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3NldEJhY2tkcm9wIG5lZWRzIGEgQ2FudmFzSW1hZ2VTb3VyY2UuIFVzZSBsb2FkQmFja2Ryb3AgZm9yIGEgVVJMLicpOwogICAgfQogICAgY29uc3QgdXBkYXRlID0gcmVzb2x2ZUJhY2tkcm9wVXBkYXRlKHNvdXJjZSwgb3B0aW9ucy51cGRhdGUpOwogICAgdGhpcy5iYWNrZHJvcHMgPSBbc291cmNlXTsKICAgIHRoaXMucmVuZGVyZXIuc2V0V2FsbHBhcGVycyhbc291cmNlXSwgeyB1cGRhdGUgfSk7CiAgICB0aGlzLndhbGxwYXBlckluZGV4ID0gMDsKICAgIHRoaXMubWFya0JhY2tkcm9wRGlydHkoKTsKICAgIGlmIChvcHRpb25zLmF1dG9TdGFydCA/PyB1cGRhdGUgPT09ICdsaXZlJykgdGhpcy5zdGFydCgpOwogICAgaWYgKG9wdGlvbnMuc2hvdWxkUmVuZGVyID8/IHRydWUpIHRoaXMucmVuZGVyKCk7CiAgICByZXR1cm4gdGhpczsKICB9CgogIGFzeW5jIGxvYWRCYWNrZHJvcChzb3VyY2UsIG9wdGlvbnMgPSB7fSkgewogICAgY29uc3QgaW1hZ2UgPSBhd2FpdCByZXNvbHZlSW1hZ2Uoc291cmNlKTsKICAgIHJldHVybiB0aGlzLnNldEJhY2tkcm9wKGltYWdlLCB7IC4uLm9wdGlvbnMsIHVwZGF0ZTogb3B0aW9ucy51cGRhdGUgPz8gJ3N0YXRpYycgfSk7CiAgfQoKICB1cGRhdGVCYWNrZHJvcChzaG91bGRSZW5kZXIgPSB0cnVlKSB7CiAgICB0aGlzLnJlbmRlcmVyLnJlZnJlc2hXYWxscGFwZXJzKHRydWUpOwogICAgdGhpcy5tYXJrQmFja2Ryb3BEaXJ0eSgpOwogICAgaWYgKHNob3VsZFJlbmRlcikgdGhpcy5yZW5kZXIoKTsKICAgIHJldHVybiB0aGlzOwogIH0KCiAgc2V0V2FsbHBhcGVySW5kZXgoaW5kZXgsIHNob3VsZFJlbmRlciA9IHRydWUpIHsKICAgIHRoaXMud2FsbHBhcGVySW5kZXggPSBNYXRoLm1heCgwLCBNYXRoLmZsb29yKGluZGV4KSk7CiAgICB0aGlzLm1hcmtCYWNrZHJvcERpcnR5KCk7CiAgICBpZiAoc2hvdWxkUmVuZGVyKSB0aGlzLnJlbmRlcigpOwogICAgcmV0dXJuIHRoaXM7CiAgfQoKICBkaXN0YW5jZUF0KHgsIHkpIHsKICAgIHJldHVybiBkaXN0YW5jZVRvRWxlbWVudHNWMih4LCB5LCB0aGlzLmVsZW1lbnRzLCB0aGlzLm1hdGVyaWFsKTsKICB9CgogIGhpdFRlc3QoeCwgeSwgb3B0aW9ucyA9IHt9KSB7CiAgICByZXR1cm4gaGl0VGVzdEVsZW1lbnRzVjIoeCwgeSwgdGhpcy5lbGVtZW50cywgdGhpcy5tYXRlcmlhbCwgb3B0aW9ucyk7CiAgfQoKICBwb2ludGVyUG9zaXRpb24oZXZlbnQpIHsKICAgIGNvbnN0IHJlY3QgPSB0aGlzLmNhbnZhcy5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKTsKICAgIGNvbnN0IHNvdXJjZSA9IGV2ZW50LnRvdWNoZXM/LlswXSA/PyBldmVudC5jaGFuZ2VkVG91Y2hlcz8uWzBdID8/IGV2ZW50OwogICAgcmV0dXJuIHsgeDogc291cmNlLmNsaWVudFggLSByZWN0LmxlZnQsIHk6IHNvdXJjZS5jbGllbnRZIC0gcmVjdC50b3AgfTsKICB9CgogIGhpdFRlc3RFdmVudChldmVudCwgb3B0aW9ucyA9IHt9KSB7CiAgICBjb25zdCB7IHgsIHkgfSA9IHRoaXMucG9pbnRlclBvc2l0aW9uKGV2ZW50KTsKICAgIGNvbnN0IHRvbGVyYW5jZSA9IG9wdGlvbnMudG9sZXJhbmNlCiAgICAgID8/IChldmVudC5wb2ludGVyVHlwZSAmJiBldmVudC5wb2ludGVyVHlwZSAhPT0gJ21vdXNlJyA/IDggOiAwKTsKICAgIHJldHVybiB0aGlzLmhpdFRlc3QoeCwgeSwgeyAuLi5vcHRpb25zLCB0b2xlcmFuY2UgfSk7CiAgfQoKICBzdGFydCgpIHsKICAgIGlmICh0aGlzLnJ1bm5pbmcpIHJldHVybiB0aGlzOwogICAgaWYgKHR5cGVvZiBnbG9iYWxUaGlzLnJlcXVlc3RBbmltYXRpb25GcmFtZSAhPT0gJ2Z1bmN0aW9uJykgewogICAgICB0aHJvdyBuZXcgRXJyb3IoJ0xpcXVpZEdsYXNzV2ViR0xWMi5zdGFydCgpIHJlcXVpcmVzIHJlcXVlc3RBbmltYXRpb25GcmFtZS4nKTsKICAgIH0KICAgIHRoaXMucnVubmluZyA9IHRydWU7CiAgICBjb25zdCB0aWNrID0gKCkgPT4gewogICAgICBpZiAoIXRoaXMucnVubmluZykgcmV0dXJuOwogICAgICB0aGlzLnJlbmRlcigpOwogICAgICB0aGlzLmFuaW1hdGlvbkZyYW1lID0gZ2xvYmFsVGhpcy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUodGljayk7CiAgICB9OwogICAgdGhpcy5hbmltYXRpb25GcmFtZSA9IGdsb2JhbFRoaXMucmVxdWVzdEFuaW1hdGlvbkZyYW1lKHRpY2spOwogICAgcmV0dXJuIHRoaXM7CiAgfQoKICBzdG9wKCkgewogICAgdGhpcy5ydW5uaW5nID0gZmFsc2U7CiAgICBpZiAodGhpcy5hbmltYXRpb25GcmFtZSAmJiB0eXBlb2YgZ2xvYmFsVGhpcy5jYW5jZWxBbmltYXRpb25GcmFtZSA9PT0gJ2Z1bmN0aW9uJykgewogICAgICBnbG9iYWxUaGlzLmNhbmNlbEFuaW1hdGlvbkZyYW1lKHRoaXMuYW5pbWF0aW9uRnJhbWUpOwogICAgfQogICAgdGhpcy5hbmltYXRpb25GcmFtZSA9IDA7CiAgICByZXR1cm4gdGhpczsKICB9CgogIHJlc2l6ZSh3aWR0aCA9IHRoaXMuY2FudmFzLmNsaWVudFdpZHRoIHx8IHRoaXMuY2FudmFzLndpZHRoIHx8IDEsCiAgICAgICAgIGhlaWdodCA9IHRoaXMuY2FudmFzLmNsaWVudEhlaWdodCB8fCB0aGlzLmNhbnZhcy5oZWlnaHQgfHwgMSwKICAgICAgICAgZHByID0gTWF0aC5taW4oZ2xvYmFsVGhpcy5kZXZpY2VQaXhlbFJhdGlvIHx8IDEsIDIpKSB7CiAgICB0aGlzLnJlbmRlcmVyLnJlc2l6ZShNYXRoLnJvdW5kKHdpZHRoICogZHByKSwgTWF0aC5yb3VuZChoZWlnaHQgKiBkcHIpKTsKICAgIHJldHVybiB7IHdpZHRoLCBoZWlnaHQsIGRwciB9OwogIH0KCiAgdXBkYXRlTGlnaHRGaWVsZCgpIHsKICAgIHRoaXMubGlnaHRGaWVsZERpcnR5ID0gZmFsc2U7CiAgICBjb25zdCBzb3VyY2UgPSB0aGlzLmJhY2tkcm9wc1t0aGlzLndhbGxwYXBlckluZGV4XTsKICAgIGNvbnN0IHNvdXJjZVdpZHRoID0gTnVtYmVyKHNvdXJjZT8udmlkZW9XaWR0aCB8fCBzb3VyY2U/Lm5hdHVyYWxXaWR0aCB8fCBzb3VyY2U/LndpZHRoIHx8IDApOwogICAgY29uc3Qgc291cmNlSGVpZ2h0ID0gTnVtYmVyKHNvdXJjZT8udmlkZW9IZWlnaHQgfHwgc291cmNlPy5uYXR1cmFsSGVpZ2h0IHx8IHNvdXJjZT8uaGVpZ2h0IHx8IDApOwogICAgaWYgKCEoc291cmNlV2lkdGggPiAwKSB8fCAhKHNvdXJjZUhlaWdodCA+IDApIHx8IHR5cGVvZiBkb2N1bWVudCA9PT0gJ3VuZGVmaW5lZCcpIHsKICAgICAgdGhpcy5saWdodFBpeGVscyA9IG51bGw7CiAgICAgIHJldHVybjsKICAgIH0KICAgIGlmICghdGhpcy5saWdodENhbnZhcykgdGhpcy5saWdodENhbnZhcyA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2NhbnZhcycpOwogICAgY29uc3Qgc2l6ZSA9IHRoaXMubGlnaHRTYW1wbGVTaXplOwogICAgdGhpcy5saWdodENhbnZhcy53aWR0aCA9IHNpemU7CiAgICB0aGlzLmxpZ2h0Q2FudmFzLmhlaWdodCA9IHNpemU7CiAgICBjb25zdCBjb250ZXh0ID0gdGhpcy5saWdodENhbnZhcy5nZXRDb250ZXh0KCcyZCcsIHsgd2lsbFJlYWRGcmVxdWVudGx5OiB0cnVlIH0pOwogICAgaWYgKCFjb250ZXh0KSB7IHRoaXMubGlnaHRQaXhlbHMgPSBudWxsOyByZXR1cm47IH0KICAgIGNvbnRleHQuY2xlYXJSZWN0KDAsIDAsIHNpemUsIHNpemUpOwogICAgY29uc3Qgc2NhbGUgPSBNYXRoLm1heChzaXplIC8gc291cmNlV2lkdGgsIHNpemUgLyBzb3VyY2VIZWlnaHQpICogdGhpcy53YWxscGFwZXJab29tOwogICAgY29uc3QgZHJhd1dpZHRoID0gc291cmNlV2lkdGggKiBzY2FsZTsKICAgIGNvbnN0IGRyYXdIZWlnaHQgPSBzb3VyY2VIZWlnaHQgKiBzY2FsZTsKICAgIHRyeSB7CiAgICAgIGNvbnRleHQuZHJhd0ltYWdlKHNvdXJjZSwgKHNpemUgLSBkcmF3V2lkdGgpIC8gMiwgKHNpemUgLSBkcmF3SGVpZ2h0KSAvIDIsCiAgICAgICAgZHJhd1dpZHRoLCBkcmF3SGVpZ2h0KTsKICAgICAgdGhpcy5saWdodFBpeGVscyA9IGNvbnRleHQuZ2V0SW1hZ2VEYXRhKDAsIDAsIHNpemUsIHNpemUpLmRhdGE7CiAgICB9IGNhdGNoIHsKICAgICAgLy8gQSBjcm9zcy1vcmlnaW4gc291cmNlIGNhbiBzdGlsbCBiZSBXZWJHTC1zYW1wbGVhYmxlIHdpdGggQ09SUyB3aGlsZSBhCiAgICAgIC8vIGJyb3dzZXIgcmVmdXNlcyBDYW52YXMyRCByZWFkYmFjay4gVGhlIGRldGVybWluaXN0aWMgYW5nbGUgcmVtYWlucyBhCiAgICAgIC8vIGNvbXBsZXRlIGZhbGxiYWNrIGluIHRoYXQgY2FzZS4KICAgICAgdGhpcy5saWdodFBpeGVscyA9IG51bGw7CiAgICB9CiAgfQoKICBzYW1wbGVMdW1pbmFuY2UoeCwgeSkgewogICAgaWYgKCF0aGlzLmxpZ2h0UGl4ZWxzKSByZXR1cm4gMC41OwogICAgY29uc3Qgc2l6ZSA9IHRoaXMubGlnaHRTYW1wbGVTaXplOwogICAgY29uc3QgcHggPSBNYXRoLm1heCgwLCBNYXRoLm1pbihzaXplIC0gMSwgTWF0aC5yb3VuZCh4ICogKHNpemUgLSAxKSkpKTsKICAgIGNvbnN0IHB5ID0gTWF0aC5tYXgoMCwgTWF0aC5taW4oc2l6ZSAtIDEsIE1hdGgucm91bmQoeSAqIChzaXplIC0gMSkpKSk7CiAgICBjb25zdCBpbmRleCA9IChweSAqIHNpemUgKyBweCkgKiA0OwogICAgcmV0dXJuICh0aGlzLmxpZ2h0UGl4ZWxzW2luZGV4XSAqIDAuMjEyNgogICAgICArIHRoaXMubGlnaHRQaXhlbHNbaW5kZXggKyAxXSAqIDAuNzE1MgogICAgICArIHRoaXMubGlnaHRQaXhlbHNbaW5kZXggKyAyXSAqIDAuMDcyMikgLyAyNTU7CiAgfQoKICBsaWdodERpcmVjdGlvbihlbGVtZW50LCB3aWR0aCwgaGVpZ2h0LCBmYWxsYmFja0FuZ2xlKSB7CiAgICBjb25zdCBwb3NpdGlvbnMgPSBbLTAuMzQsIDAsIDAuMzRdOwogICAgbGV0IGdyYWRpZW50WCA9IDA7CiAgICBsZXQgZ3JhZGllbnRZID0gMDsKICAgIGZvciAoY29uc3Qgc2FtcGxlWSBvZiBwb3NpdGlvbnMpIHsKICAgICAgZm9yIChjb25zdCBzYW1wbGVYIG9mIHBvc2l0aW9ucykgewogICAgICAgIGNvbnN0IHggPSAoZWxlbWVudC54ICsgZWxlbWVudC53ICogKDAuNSArIHNhbXBsZVgpKSAvIE1hdGgubWF4KHdpZHRoLCAxKTsKICAgICAgICBjb25zdCB5ID0gKGVsZW1lbnQueSArIGVsZW1lbnQuaCAqICgwLjUgKyBzYW1wbGVZKSkgLyBNYXRoLm1heChoZWlnaHQsIDEpOwogICAgICAgIGNvbnN0IGxpZ2h0ID0gdGhpcy5zYW1wbGVMdW1pbmFuY2UoeCwgeSk7CiAgICAgICAgZ3JhZGllbnRYICs9IHNhbXBsZVggKiBsaWdodDsKICAgICAgICBncmFkaWVudFkgKz0gc2FtcGxlWSAqIGxpZ2h0OwogICAgICB9CiAgICB9CiAgICBjb25zdCByYWRpYW5zID0gZmFsbGJhY2tBbmdsZSAqIE1hdGguUEkgLyAxODA7CiAgICBjb25zdCBmYWxsYmFja1ggPSBNYXRoLmNvcyhyYWRpYW5zKTsKICAgIGNvbnN0IGZhbGxiYWNrWSA9IE1hdGguc2luKHJhZGlhbnMpOwogICAgY29uc3QgY29udHJhc3QgPSBNYXRoLmh5cG90KGdyYWRpZW50WCwgZ3JhZGllbnRZKSAvIHBvc2l0aW9ucy5sZW5ndGg7CiAgICBpZiAoY29udHJhc3QgPCAwLjAwOCkgcmV0dXJuIFtmYWxsYmFja1gsIGZhbGxiYWNrWV07CgogICAgY29uc3QgbGVuZ3RoID0gTWF0aC5oeXBvdChncmFkaWVudFgsIGdyYWRpZW50WSkgfHwgMTsKICAgIGNvbnN0IGF1dG9YID0gLWdyYWRpZW50WCAvIGxlbmd0aDsKICAgIGNvbnN0IGF1dG9ZID0gZ3JhZGllbnRZIC8gbGVuZ3RoOwogICAgY29uc3QgcmF3U3RyZW5ndGggPSBNYXRoLm1heCgwLCBNYXRoLm1pbigxLCAoY29udHJhc3QgLSAwLjAxNSkgLyAwLjEzKSk7CiAgICAvLyBLZWVwIHRoZSBlbnZpcm9ubWVudCBpbmZsdWVudGlhbCB3aXRob3V0IGFsbG93aW5nIGEgbW92aW5nIGhpZ2gtY29udHJhc3QKICAgIC8vIGVkZ2UgdG8gcm90YXRlIHRoZSBrZXkgbGlnaHQgYWxtb3N0IDE4MCBkZWdyZWVzIGZyb20gb25lIHNhbXBsZSB0byB0aGUgbmV4dC4KICAgIGNvbnN0IHN0cmVuZ3RoID0gcmF3U3RyZW5ndGggKiByYXdTdHJlbmd0aCAqICgzIC0gMiAqIHJhd1N0cmVuZ3RoKSAqIDAuNTg7CiAgICBjb25zdCBtaXhlZFggPSBmYWxsYmFja1ggKiAoMSAtIHN0cmVuZ3RoKSArIGF1dG9YICogc3RyZW5ndGg7CiAgICBjb25zdCBtaXhlZFkgPSBmYWxsYmFja1kgKiAoMSAtIHN0cmVuZ3RoKSArIGF1dG9ZICogc3RyZW5ndGg7CiAgICBjb25zdCBtaXhlZExlbmd0aCA9IE1hdGguaHlwb3QobWl4ZWRYLCBtaXhlZFkpIHx8IDE7CiAgICByZXR1cm4gW21peGVkWCAvIG1peGVkTGVuZ3RoLCBtaXhlZFkgLyBtaXhlZExlbmd0aF07CiAgfQoKICB0aW50TGlnaHRGb3JFbGVtZW50KGVsZW1lbnQsIHdpZHRoLCBoZWlnaHQpIHsKICAgIGlmIChlbGVtZW50LnRpbnRUb25lID09PSAnbGlnaHQnKSByZXR1cm4gMTsKICAgIGlmIChlbGVtZW50LnRpbnRUb25lID09PSAnZGFyaycpIHJldHVybiAwOwogICAgY29uc3QgcG9zaXRpb25zID0gWy0wLjM0LCAwLCAwLjM0XTsKICAgIGxldCBsdW1pbmFuY2UgPSAwOwogICAgZm9yIChjb25zdCBzYW1wbGVZIG9mIHBvc2l0aW9ucykgewogICAgICBmb3IgKGNvbnN0IHNhbXBsZVggb2YgcG9zaXRpb25zKSB7CiAgICAgICAgY29uc3QgeCA9IChlbGVtZW50LnggKyBlbGVtZW50LncgKiAoMC41ICsgc2FtcGxlWCkpIC8gTWF0aC5tYXgod2lkdGgsIDEpOwogICAgICAgIGNvbnN0IHkgPSAoZWxlbWVudC55ICsgZWxlbWVudC5oICogKDAuNSArIHNhbXBsZVkpKSAvIE1hdGgubWF4KGhlaWdodCwgMSk7CiAgICAgICAgbHVtaW5hbmNlICs9IHRoaXMuc2FtcGxlTHVtaW5hbmNlKHgsIHkpOwogICAgICB9CiAgICB9CiAgICBjb25zdCBhdmVyYWdlID0gbHVtaW5hbmNlIC8gKHBvc2l0aW9ucy5sZW5ndGggKiBwb3NpdGlvbnMubGVuZ3RoKTsKICAgIGNvbnN0IHQgPSBNYXRoLm1heCgwLCBNYXRoLm1pbigxLCAoYXZlcmFnZSAtIDAuMjIpIC8gKDAuNTAgLSAwLjIyKSkpOwogICAgcmV0dXJuIHQgKiB0ICogKDMgLSAyICogdCk7CiAgfQoKICByZW5kZXIob3B0aW9ucyA9IHt9KSB7CiAgICBpZiAodGhpcy5yZW5kZXJlci5sb3N0KSByZXR1cm4gdGhpczsKICAgIGNvbnN0IHdpZHRoID0gdGhpcy5jYW52YXMuY2xpZW50V2lkdGggfHwgdGhpcy5jYW52YXMud2lkdGggfHwgMTsKICAgIGNvbnN0IGhlaWdodCA9IHRoaXMuY2FudmFzLmNsaWVudEhlaWdodCB8fCB0aGlzLmNhbnZhcy5oZWlnaHQgfHwgMTsKICAgIGNvbnN0IGRwciA9IE1hdGgubWluKGdsb2JhbFRoaXMuZGV2aWNlUGl4ZWxSYXRpbyB8fCAxLCAyKTsKICAgIGNvbnN0IHJlc2l6ZWQgPSB3aWR0aCAhPT0gdGhpcy5sYXN0RnJhbWUud2lkdGggfHwgaGVpZ2h0ICE9PSB0aGlzLmxhc3RGcmFtZS5oZWlnaHQKICAgICAgfHwgZHByICE9PSB0aGlzLmxhc3RGcmFtZS5kcHI7CiAgICBjb25zdCBsaXZlQmFja2Ryb3AgPSB0aGlzLnJlbmRlcmVyLmhhc0xpdmVCYWNrZHJvcCgpOwogICAgaWYgKCFvcHRpb25zLmZvcmNlICYmICF0aGlzLmRpcnR5ICYmICFyZXNpemVkICYmICFsaXZlQmFja2Ryb3ApIHJldHVybiB0aGlzOwoKICAgIHRoaXMucmVzaXplKHdpZHRoLCBoZWlnaHQsIGRwcik7CiAgICBjb25zdCBub3cgPSBnbG9iYWxUaGlzLnBlcmZvcm1hbmNlPy5ub3c/LigpID8/IERhdGUubm93KCk7CiAgICBpZiAodGhpcy5iYWNrZHJvcERpcnR5IHx8IHJlc2l6ZWQgfHwgbGl2ZUJhY2tkcm9wKSB7CiAgICAgIHRoaXMucmVuZGVyZXIuYnVpbGRCYWNrZHJvcCh0aGlzLndhbGxwYXBlckluZGV4LCB0aGlzLndhbGxwYXBlclpvb20pOwogICAgICAvLyBUaGUgb3B0aWNhbCBiYWNrZHJvcCByZW1haW5zIGZ1bGx5IGxpdmUsIGJ1dCB0aGUgbG93LXJlc29sdXRpb24gbGlnaHQKICAgICAgLy8gcHJvYmUgcnVucyBhdCBhIHN0ZWFkaWVyIGNhZGVuY2UuIFRoaXMgZGVjb3VwbGVzIG1vdmluZyBjb250ZW50IGZyb20gdGhlCiAgICAgIC8vIHdoaXRlIGtleSBoaWdobGlnaHQgYW5kIHJlbW92ZXMgc2luZ2xlLWZyYW1lIGRpcmVjdGlvbiBzcGlrZXMuCiAgICAgIGNvbnN0IHJlZnJlc2hMaXZlTGlnaHQgPSBsaXZlQmFja2Ryb3AgJiYgbm93IC0gdGhpcy5sYXN0TGlnaHRGaWVsZFVwZGF0ZSA+PSA4NDsKICAgICAgaWYgKHRoaXMubGlnaHRGaWVsZERpcnR5IHx8IHJlc2l6ZWQgfHwgcmVmcmVzaExpdmVMaWdodCkgewogICAgICAgIHRoaXMudXBkYXRlTGlnaHRGaWVsZCgpOwogICAgICAgIHRoaXMubGFzdExpZ2h0RmllbGRVcGRhdGUgPSBub3c7CiAgICAgIH0KICAgICAgdGhpcy5iYWNrZHJvcERpcnR5ID0gZmFsc2U7CiAgICB9CiAgICBpZiAodGhpcy5jb21wb3NpdGVNb2RlID09PSAnb3ZlcmxheScpIHRoaXMucmVuZGVyZXIuY2xlYXJPdXRwdXQoKTsKICAgIGVsc2UgdGhpcy5yZW5kZXJlci5kcmF3QmFja2Ryb3AoKTsKCiAgICBjb25zdCBtYXRlcmlhbCA9IHRoaXMuZWZmZWN0aXZlTWF0ZXJpYWw7CiAgICBjb25zdCBlbGFwc2VkID0gdGhpcy5sYXN0TGlnaHRCbGVuZFRpbWUgPyBNYXRoLm1pbigxMDAsIG5vdyAtIHRoaXMubGFzdExpZ2h0QmxlbmRUaW1lKSA6IDEwMDsKICAgIGNvbnN0IGJsZW5kID0gbGl2ZUJhY2tkcm9wID8gMSAtIE1hdGguZXhwKC1lbGFwc2VkIC8gMjgwKSA6IDE7CiAgICBjb25zdCBhY3RpdmVMaWdodElkcyA9IG5ldyBTZXQodGhpcy5lbGVtZW50cy5tYXAoKGVsZW1lbnQpID0+IGVsZW1lbnQuaWQpKTsKICAgIGZvciAoY29uc3QgaWQgb2YgdGhpcy5zbW9vdGhlZExpZ2h0RGlyZWN0aW9ucy5rZXlzKCkpIHsKICAgICAgaWYgKCFhY3RpdmVMaWdodElkcy5oYXMoaWQpKSB0aGlzLnNtb290aGVkTGlnaHREaXJlY3Rpb25zLmRlbGV0ZShpZCk7CiAgICB9CiAgICBjb25zdCBsaWdodERpcmVjdGlvbnMgPSB0aGlzLmVsZW1lbnRzLm1hcCgoZWxlbWVudCkgPT4gewogICAgICBjb25zdCB0YXJnZXQgPSB0aGlzLmxpZ2h0RGlyZWN0aW9uKGVsZW1lbnQsIHdpZHRoLCBoZWlnaHQsIG1hdGVyaWFsLmxpZ2h0QW5nbGUpOwogICAgICBjb25zdCBwcmV2aW91cyA9IHRoaXMuc21vb3RoZWRMaWdodERpcmVjdGlvbnMuZ2V0KGVsZW1lbnQuaWQpOwogICAgICBpZiAoIXByZXZpb3VzIHx8IGJsZW5kID49IDEpIHsKICAgICAgICB0aGlzLnNtb290aGVkTGlnaHREaXJlY3Rpb25zLnNldChlbGVtZW50LmlkLCB0YXJnZXQpOwogICAgICAgIHJldHVybiB0YXJnZXQ7CiAgICAgIH0KICAgICAgY29uc3QgbWl4ZWRYID0gcHJldmlvdXNbMF0gKiAoMSAtIGJsZW5kKSArIHRhcmdldFswXSAqIGJsZW5kOwogICAgICBjb25zdCBtaXhlZFkgPSBwcmV2aW91c1sxXSAqICgxIC0gYmxlbmQpICsgdGFyZ2V0WzFdICogYmxlbmQ7CiAgICAgIGNvbnN0IGxlbmd0aCA9IE1hdGguaHlwb3QobWl4ZWRYLCBtaXhlZFkpIHx8IDE7CiAgICAgIGNvbnN0IGRpcmVjdGlvbiA9IFttaXhlZFggLyBsZW5ndGgsIG1peGVkWSAvIGxlbmd0aF07CiAgICAgIHRoaXMuc21vb3RoZWRMaWdodERpcmVjdGlvbnMuc2V0KGVsZW1lbnQuaWQsIGRpcmVjdGlvbik7CiAgICAgIHJldHVybiBkaXJlY3Rpb247CiAgICB9KTsKICAgIGNvbnN0IHRpbnRMaWdodHMgPSB0aGlzLmVsZW1lbnRzLm1hcCgoZWxlbWVudCkgPT4gKAogICAgICB0aGlzLnRpbnRMaWdodEZvckVsZW1lbnQoZWxlbWVudCwgd2lkdGgsIGhlaWdodCkKICAgICkpOwogICAgdGhpcy5sYXN0TGlnaHRCbGVuZFRpbWUgPSBub3c7CiAgICBpZiAodGhpcy5lbGVtZW50cy5sZW5ndGggPiBNQVhfR0xBU1NfU0hBUEVTICYmICF0aGlzLndhcm5lZFNoYXBlTGltaXQpIHsKICAgICAgdGhpcy53YXJuZWRTaGFwZUxpbWl0ID0gdHJ1ZTsKICAgICAgY29uc29sZS53YXJuKGBMaXF1aWRHbGFzc1dlYkdMVjI6IG1vcmUgdGhhbiAke01BWF9HTEFTU19TSEFQRVN9IHNoYXBlcyByZXF1aXJlIG11bHRpcGxlIHBhc3Nlczsgb3ZlcmxhcHBpbmcgc2hhcGVzIGFjcm9zcyBhIHBhc3MgYm91bmRhcnkgbWF5IGNvbXBvc2l0ZSBkaWZmZXJlbnRseS5gKTsKICAgIH0KICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGhpcy5lbGVtZW50cy5sZW5ndGg7IGkgKz0gTUFYX0dMQVNTX1NIQVBFUykgewogICAgICB0aGlzLnJlbmRlcmVyLmRyYXdHbGFzc1YyR3JvdXAoCiAgICAgICAgdGhpcy5lbGVtZW50cy5zbGljZShpLCBpICsgTUFYX0dMQVNTX1NIQVBFUyksCiAgICAgICAgbWF0ZXJpYWwsCiAgICAgICAgZHByLAogICAgICAgIGxpZ2h0RGlyZWN0aW9ucy5zbGljZShpLCBpICsgTUFYX0dMQVNTX1NIQVBFUyksCiAgICAgICAgdGludExpZ2h0cy5zbGljZShpLCBpICsgTUFYX0dMQVNTX1NIQVBFUyksCiAgICAgICk7CiAgICB9CgogICAgdGhpcy5kaXJ0eSA9IGZhbHNlOwogICAgdGhpcy5sYXN0RnJhbWUgPSB7IHdpZHRoLCBoZWlnaHQsIGRwciB9OwogICAgcmV0dXJuIHRoaXM7CiAgfQoKICBkZXN0cm95KCkgewogICAgdGhpcy5zdG9wKCk7CiAgICB0aGlzLmNhbnZhcy5yZW1vdmVFdmVudExpc3RlbmVyKCd3ZWJnbGNvbnRleHRsb3N0JywgdGhpcy5oYW5kbGVDb250ZXh0TG9zdCwgZmFsc2UpOwogICAgdGhpcy5jYW52YXMucmVtb3ZlRXZlbnRMaXN0ZW5lcignd2ViZ2xjb250ZXh0cmVzdG9yZWQnLCB0aGlzLmhhbmRsZUNvbnRleHRSZXN0b3JlZCwgZmFsc2UpOwogICAgdGhpcy5yZWR1Y2VkVHJhbnNwYXJlbmN5UXVlcnk/LnJlbW92ZUV2ZW50TGlzdGVuZXI/LignY2hhbmdlJywgdGhpcy5oYW5kbGVSZWR1Y2VkVHJhbnNwYXJlbmN5Q2hhbmdlKTsKICAgIHRoaXMucmVzaXplT2JzZXJ2ZXI/LmRpc2Nvbm5lY3QoKTsKICAgIHRoaXMucmVzaXplT2JzZXJ2ZXIgPSBudWxsOwogICAgdGhpcy5yZW5kZXJlci5kZXN0cm95KCk7CiAgICB0aGlzLmVsZW1lbnRzID0gW107CiAgICB0aGlzLmJhY2tkcm9wcyA9IFtdOwogICAgdGhpcy5saWdodFBpeGVscyA9IG51bGw7CiAgICB0aGlzLmxpZ2h0Q2FudmFzID0gbnVsbDsKICAgIHRoaXMuc21vb3RoZWRMaWdodERpcmVjdGlvbnMuY2xlYXIoKTsKICB9Cn0KCgoKZXhwb3J0IHsgVlNfRlVMTFNDUkVFTiwgVlNfR0xBU1MsIEZTX0JMSVQsIEZTX0RPV04sIEZTX1VQLCBGU19XQUxMUEFQRVIsIEZTX0dMQVNTLCBGU19HTEFTU19WMiwgTUFYX0dMQVNTX1NIQVBFUywgU0hBUEVfVFlQRVMsIHNoYXBlVHlwZU9mLCBjb3JuZXJSYWRpdXNPZiwgc2RTcXVpcmNsZSwgc2RQcmltaXRpdmUsIHNkR3JvdXAsIGhpdFRlc3RFbGVtZW50cywgc2RSZW5kZXJlZEdyb3VwcywgY29ubmVjdGVkRWxlbWVudEdyb3VwcywgZ3JvdXBFbGVtZW50cywgU0hBUEVfVFlQRVNfVjIsIHNoYXBlVHlwZU9mVjIsIHNkUm91bmRCb3hWMiwgc21vb3RoVW5pb25WMiwgY29ybmVyUmFkaXVzVjIsIHNkRWxlbWVudFYyLCBkaXN0YW5jZVRvRWxlbWVudHNWMiwgaGl0VGVzdEVsZW1lbnRzVjIsIERFRkFVTFRfTUFURVJJQUxfVjIsIFJFRFVDRURfVFJBTlNQQVJFTkNZX01BVEVSSUFMX1YyLCBTTElERVJTX1YyLCBnZXREZWZhdWx0TWF0ZXJpYWxWMiwgbWFrZU1hdGVyaWFsVjIsIE1JUFMsIEdsYXNzUmVuZGVyZXIsIExpcXVpZEdsYXNzV2ViR0xWMiB9Owo=";
		// LG_BUNDLE_B64_END
		async function ensureLgModule() {
			if (lgModule) return lgModule;
			try {
				const b64 = LG_BUNDLE_B64 || "";
				if (!b64) { setLgStatus("✗ 内联 bundle 为空"); return null; }
				const src = decodeURIComponent(escape(atob(b64))); // base64 → UTF-8 字符串
				const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
				const mod = await import(url);
				setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} }, 30000);
				lgModule = mod;
				setLgStatus("✓ 模块加载成功（内联）");
				return mod;
			} catch (err) { console.warn("[dsh-mpkg-wallpaper] 液态玻璃模块加载失败:", err); setLgStatus("✗ 模块加载失败: " + (err && err.message || err)); return null; }
		}
		function lgEnabled(section) {
			return !!(section && ((section.lgComposer !== void 0 ? !!section.lgComposer : false)
				|| (section.lgSidebar !== void 0 ? !!section.lgSidebar : false)
				|| (section.lgHeader !== void 0 ? !!section.lgHeader : false)));
		}
		function destroyLiquidGlass() {
			try { if (lgResizeObs) { lgResizeObs.disconnect(); lgResizeObs = null; } } catch {}
			try { if (lgGlass && typeof lgGlass.stop === "function") lgGlass.stop(); } catch {}
			lgGlass = null;
			try { if (lgCanvas) { lgCanvas.remove(); } } catch {}
			lgCanvas = null;
			lgBgVideoHooked = false;
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
		async function applyLiquidGlass(section) {
			try {
				if (!lgEnabled(section)) { destroyLiquidGlass(); return; }
				const mod = await ensureLgModule();
				if (!mod || !mod.LiquidGlassWebGLV2) { setLgStatus("✗ 模块加载失败（检查 /lg 路由）"); return; }
				setLgStatus("✓ 模块加载成功");
				const targets = lgTargets(section);
				if (!targets.length) { setLgStatus("✗ 未匹配到玻璃目标元素（检查开关与 DSH 元素）"); destroyLiquidGlass(); return; }
				setLgStatus("✓ 匹配 " + targets.length + " 个元素");
				if (!lgCanvas) {
					lgCanvas = document.createElement("canvas");
					lgCanvas.id = "mpw-lg-canvas";
					// ①(修正) 层级：z-index:0（壁纸 -1 之上、DSH 内容之下）——原 9999 盖过设置面板
					// （z-index:1000），用户实测玻璃叠在最上面、优先级比设置还大。overlay 模式
					// 非玻璃区域透明，玻璃作为目标元素的背景层显示在内容之下。
					lgCanvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:0;pointer-events:none;";
					(document.body || document.documentElement).appendChild(lgCanvas);
					lgGlass = new mod.LiquidGlassWebGLV2(lgCanvas, { preserveDrawingBuffer: true, compositeMode: "overlay" });
					// 背景：优先当前壁纸 video（live），否则静态渐变
					try {
						const vid = bgElements().video;
						if (vid && vid.readyState >= 2 && vid.videoWidth > 0) {
							lgGlass.setBackdrop(vid, { update: "live", autoStart: true });
							lgBgVideoHooked = true;
						} else {
							lgGlass.setBackdrop(makeLgFallback(), { update: "static" });
						}
					} catch { try { lgGlass.setBackdrop(makeLgFallback(), { update: "static" }); } catch {} }
				}
				// 元素几何对齐
				const els = targets.map((t, i) => {
					const r = t.el.getBoundingClientRect();
					return { id: "lg" + i, shape: "rect", x: r.left, y: r.top, width: r.width, height: r.height };
				});
				try { lgGlass.setElements(els); } catch {}
				if (!lgResizeObs) {
					try {
						lgResizeObs = new ResizeObserver(() => {
							try {
								if (!lgGlass) return;
								// 元素可能移动/缩放：重算几何后重渲染
								const els2 = targets.map((t, i) => {
									const r = t.el.getBoundingClientRect();
									return { id: "lg" + i, shape: "rect", x: r.left, y: r.top, width: r.width, height: r.height };
								});
								lgGlass.setElements(els2);
								lgGlass.render();
							} catch {}
						});
						targets.forEach((t) => { try { lgResizeObs.observe(t.el); } catch {} });
					} catch {}
				} else {
					// 已有 observer：确保覆盖新目标
					try { targets.forEach((t) => { try { lgResizeObs.observe(t.el); } catch {} }); } catch {}
				}
				// 视频就绪后切换 live 背景
				if (!lgBgVideoHooked) {
					try {
						const vid = bgElements().video;
						if (vid) {
							vid.addEventListener("loadeddata", () => {
								try { if (lgGlass && vid.videoWidth > 0) { lgGlass.setBackdrop(vid, { update: "live", autoStart: true }); lgBgVideoHooked = true; } } catch {}
							}, { once: true });
						}
					} catch {}
				}
			} catch (err) { console.warn("[dsh-mpkg-wallpaper] 液态玻璃叠加失败:", err); }
		}
		/** 静态渐变兜底背景（视频不可用时）。 */
		function makeLgFallback() {
			try {
				const c = document.createElement("canvas");
				c.width = 800; c.height = 600;
				const g = c.getContext("2d");
				if (!g) return c;
				const grad = g.createRadialGradient(300, 200, 50, 400, 300, 600);
				grad.addColorStop(0, "#4a6cf7"); grad.addColorStop(0.5, "#8a4ad8"); grad.addColorStop(1, "#123456");
				g.fillStyle = grad; g.fillRect(0, 0, 800, 600);
				for (let i = 0; i < 8; i++) { g.beginPath(); g.arc(Math.random() * 800, Math.random() * 600, 20 + Math.random() * 50, 0, Math.PI * 2); g.fillStyle = "rgba(255,255,255," + (0.05 + Math.random() * 0.1) + ")"; g.fill(); }
				return c;
			} catch { return null; }
		}

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
		function pauseWallpaperVideo() {
			try {
				const { video } = bgElements();
				if (video && !video.paused) video.pause();
			} catch {}
			// web 壁纸：暂停 iframe 里的大致做法是停掉其 CSS 动画不可行，随浏览器切页节流即可
		}
		/** 当前壁纸视频恢复播放。 */
		function resumeWallpaperVideo() {
			try {
				const s = readSection();
				if (!(s.enabled !== void 0 ? !!s.enabled : true)) return;
				const { video } = bgElements();
				if (video && video.paused && video.src) {
					try { const p = video.play(); if (p && p.catch) p.catch(() => {}); } catch {}
				}
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
		/** ①(新) 用户手动暂停/播放壁纸（停住画面）。wallPausedByUser 由设置页 state 驱动。 */
		let wallUserPaused = false;
		function toggleWallPause() {
			try {
				wallUserPaused = !wallUserPaused;
				if (wallUserPaused) pauseWallpaperVideo();
				else resumeWallpaperVideo();
				// 通知设置页刷新按钮状态
				try { notifySectionChanged(); } catch {}
			} catch {}
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
		/** 遮罩有效色：自定义色 > 壁纸主色（亮主题掺 35%、暗主题掺 55%）> 主题中性色。 */
		function aquaEffectiveColor(section) {
			const darkTheme = !!(document.body && document.body.hasAttribute("data-ds-dark-theme"));
			const custom = section.aquaColor && /^#[0-9a-fA-F]{3,8}$/.test(section.aquaColor) ? aquaParseHex(section.aquaColor) : null;
			if (custom) return custom;
			const tintOn = section.aquaTint !== void 0 ? !!section.aquaTint : DEFAULT_AQUA_TINT;
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
		/** 从当前壁纸抽主色（48×48 平均色）→ --mpw-panel-tint。 */
		function applyAquaTint() {
			try {
				const s = readSection();
				if (!(s.aquaTint !== void 0 ? !!s.aquaTint : DEFAULT_AQUA_TINT)) return;
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
				refreshAqua();
			} catch {}
		}
		/** 监听壁纸加载/播放，周期刷新取色（视频/GIF 节流 2s）。 */
		function scheduleAquaTint() {
			try {
				const { img, video } = bgElements();
				if (!img && !video) return;
				const doTint = () => { try { applyAquaTint(); } catch {} };
				if (img && !aquaTintHooked.has(img)) {
					aquaTintHooked.add(img);
					img.addEventListener("load", doTint, { passive: true });
				}
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
					"--dsw-specific-menu": { light: tinted(0.86), dark: tinted(0.86) },
					"--dsw-specific-selector": { light: tinted(0.78), dark: tinted(0.78) },
					"--dsw-specific-tip": { light: tinted(0.85), dark: tinted(0.85) },
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
			document.querySelectorAll('[class*="fade"]').forEach((el) => {
				if (!el.className || el.className.indexOf("fade") < 0) return;
				// 优先匹配 workspace/session 列表区域；否则匹配绝对定位在底部的渐变 fade
				const p = el.closest('[data-slot*="workspaces"], [data-slot*="session"], [class*="regionArea"], [class*="sidebarCol"]');
				let isListFade = !!p;
				if (!isListFade) {
					// ①(修正) 已隐藏的直接跳过（避免对每个 fade 都 getComputedStyle 强制布局——
					//   弱 WebView 上每 120ms 一次的整文档扫描 + 强制布局=持续卡顿）。
					if (el.style.display === "none") return;
					try {
						const cs = getComputedStyle(el);
						isListFade = cs.position === "absolute" && (cs.bottom === "0px" || parseFloat(cs.bottom) <= 1);
					} catch {}
				}
				if (isListFade) {
					el.style.display = "none";
				}
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
					// ①(修正) 侧边栏保持透出壁纸（sidebar:true）：lgTest 是纯净环境测玻璃，
					// 玻璃折射需要侧边栏透明透出壁纸才有意义；原 sidebar:false 让侧边栏
					// 变不透明 → 用户实测"侧边栏不变透明、没玻璃效果"。
					sidebar: true, sharp: false,
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
	--dsw-alias-line-secondary: ${gcGray} !important;
	--dsw-alias-separator-primary: ${gcGray} !important;
	--dsw-alias-border-secondary: ${gcGray} !important;
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
.hHd-Xa_root { background-color: var(--dsw-specific-sidebar-fill) !important; }
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
	background: var(--dsw-static-neutral-bluish-950) !important;
}
body:not([data-ds-dark-theme]) .mpw_dialog {
	background: var(--dsw-static-neutral-bluish-00) !important;
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
				return css + buildUiCss(section, false);
			}
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
${sidebar ? `.pI_x6G_sidebarCol,
.hHd-Xa_root {
	background-color: ${unifyTint
		? `color-mix(in srgb, var(--dsw-static-neutral-bluish-950) ${U(panel)}%, transparent)`
		: `color-mix(in srgb, var(--dsw-specific-sidebar-fill) ${Math.min(40, panel)}%, transparent)`} !important;
}` : `.pI_x6G_sidebarCol,
.hHd-Xa_root {
	background-color: color-mix(in srgb, var(--dsw-specific-sidebar-fill) ${panel}%, transparent) !important;
}`}
${unifyTint ? `body:not([data-ds-dark-theme]) .pI_x6G_sidebarCol,
body:not([data-ds-dark-theme]) .hHd-Xa_root {
	background-color: color-mix(in srgb, var(--dsw-static-neutral-bluish-00) ${U(panel)}%, transparent) !important;
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
[data-slot*="session"] [class*="fade"] {
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
	background-color: ${unifyTint
		? `color-mix(in srgb, var(--dsw-static-neutral-bluish-950) ${U(details)}%, transparent)`
		: `color-mix(in srgb, var(--dsw-alias-bg-base) ${U(details)}%, transparent)`} !important;
}
${unifyTint ? `body:not([data-ds-dark-theme]) .ydkMvW_root {
	background-color: color-mix(in srgb, var(--dsw-static-neutral-bluish-00) ${U(details)}%, transparent) !important;
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
   兜底 45% 雾底保证在壁纸上可读；不加 !important → 插件自己的背景样式优先 */
[data-slot="sidebar"] [data-plugin] {
	background-color: color-mix(in srgb, var(--dsw-alias-bg-base) 45%, transparent);
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
				const hdrBg = `color-mix(in srgb, var(--dsw-static-neutral-bluish-950) ${hdrAlpha}%, transparent)`;
				css += `
.wSkVaW_header {
	background-color: ${hdrBg} !important;
	backdrop-filter: none !important;
	border-bottom: 1px solid transparent !important;
}
body:not([data-ds-dark-theme]) .wSkVaW_header {
	background-color: color-mix(in srgb, var(--dsw-static-neutral-bluish-00) ${hdrAlpha}%, transparent) !important;
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
				// ①(新) 标题栏透出壁纸但不磨砂：实心主题色（无 backdrop-filter）
				css += `
.wSkVaW_header {
	background-color: var(--dsw-static-neutral-bluish-00) !important;
	backdrop-filter: none !important;
}
body[data-ds-dark-theme] .wSkVaW_header {
	background-color: var(--dsw-static-neutral-bluish-950) !important;
}
`;
			}
			if (!headerBg) {
				// ①④(修正) 标题栏不透出壁纸：白色不透明（用户要求"关=一片白色的不透明状态"）。
				// 不能用 var(--dsw-alias-bg-base)——它已被 token override 成半透明会透出壁纸。
				// 用主题静态色：亮色=白、暗色=深色（跟随 data-ds-dark-theme）。
				css += `
.wSkVaW_header {
	background-color: var(--dsw-static-neutral-bluish-00) !important;
	backdrop-filter: none !important;
}
body[data-ds-dark-theme] .wSkVaW_header {
	background-color: var(--dsw-static-neutral-bluish-950) !important;
}
`;
			}
			if (!sidebar) {
				// ⑥ 侧边栏不透出壁纸：恢复为不透明，保持与聊天区区分
				css += `
.pI_x6G_sidebarCol,
.hHd-Xa_root {
	background-color: var(--dsw-specific-sidebar-fill) !important;
}
.hHd-Xa_newSession {
	background-color: var(--dsw-alias-button-elevated-fill) !important;
}
.hHd-Xa_regionArea { backdrop-filter: none !important; }
.hHd-Xa_regionArea [class*="fade"],
[data-slot*="workspaces"] [class*="fade"],
[data-slot*="session"] [class*="fade"] {
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
	background-color: var(--dsw-static-neutral-bluish-00) !important;
}
body[data-ds-dark-theme] [role="dialog"],
body[data-ds-dark-theme] [role="alertdialog"] {
	background-color: var(--dsw-static-neutral-bluish-950) !important;
}
`;
			if (!settingsFrosted) css += `
/* 设置面板虚化关 → 设置面板不透明兜底（防透出） */
[class*="settingsArea"] [role="dialog"] {
	background-color: var(--dsw-static-neutral-bluish-00) !important;
}
body[data-ds-dark-theme] [class*="settingsArea"] [role="dialog"] {
	background-color: var(--dsw-static-neutral-bluish-950) !important;
}
`;
			// ①(修正) 弹窗实心底：虚化关 **或无壁纸** 时都必须实心（无壁纸时 dialogBlur 不生效
			// → 弹窗完全透明 → 字和背景字叠一起（用户多次实测：选择文件夹/新建列表/管理列表）。
			// 有壁纸 + 虚化开 → 走 frosted 半透明。
			if (!confirmFrosted || !hasImage) css += `
/* 下载/确认弹窗兜底：弹窗不透明（防透出/防字叠字） */
.mpw_dialog {
	background: var(--dsw-static-neutral-bluish-950) !important;
}
body:not([data-ds-dark-theme]) .mpw_dialog {
	background: var(--dsw-static-neutral-bluish-00) !important;
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
	background-color: color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 80%, transparent) !important;
}
body[data-ds-dark-theme] [class*="overlay"] [role="dialog"],
body[data-ds-dark-theme] [class*="overlay"] [role="alertdialog"] {
	background-color: color-mix(in srgb, var(--dsw-static-neutral-bluish-950) 80%, transparent) !important;
}
[role="dialog"] [class*="card"] {
	backdrop-filter: none !important;
}
/* 提问输入框（composer）：跟随「虚化对话框」开关（聊天框不随统一虚化）。
   虚化开 = 半透明背景，透出模糊壁纸/经过的字。 */
[data-composer-card] {
	background-color: color-mix(in srgb, #1b2233 42%, transparent) !important;
}
body:not([data-ds-dark-theme]) [data-composer-card] {
	background-color: color-mix(in srgb, #dde3ee 55%, transparent) !important;
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
	background-color: color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 80%, transparent) !important;
}
body[data-ds-dark-theme] [class*="settingsArea"] [role="dialog"] {
	background-color: color-mix(in srgb, var(--dsw-static-neutral-bluish-950) 80%, transparent) !important;
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
	background: color-mix(in srgb, var(--dsw-static-neutral-bluish-950) 80%, transparent) !important;
}
body:not([data-ds-dark-theme]) .mpw_dialog {
	background: color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 80%, transparent) !important;
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
			if (unifyTint && !chatFollowInCss && unifyAmount > 0 && bdSupported) {
				css += `
/* ── 统一虚化 + 聊天区不跟随：侧边栏/标题栏背后叠加整屏虚化度（标题栏展开面板
   出现时由 data-mpw-header-blur-off 摘除，防困住面板） ── */
html body:not([data-mpw-sblur-off]):not([data-mpw-header-blur-off]) .pI_x6G_sidebarCol,
html body:not([data-mpw-sblur-off]):not([data-mpw-header-blur-off]) [class*="sidebarCol"],
html body:not([data-mpw-sblur-off]):not([data-mpw-header-blur-off]) .wSkVaW_header {
	backdrop-filter: blur(${unifyAmount}px) !important;
	-webkit-backdrop-filter: blur(${unifyAmount}px) !important;
}
`;
			}
			// ②(新) 弹层虚化（菜单/提示/data-surface，独立于对话框）
			if (popoverBlur && popoverAmount > 0 && bdSupported) {
				const popFilter = `blur(${popoverAmount}px)`;
				css += `
/* ── 弹层虚化（菜单/下拉/提示/列表/悬浮面板，非居中窗口） ── */
[role="menu"],
[role="tooltip"],
[role="alert"],
[role="listbox"],
[role="combobox"],
[data-dsh-surface] {
	backdrop-filter: ${popFilter} !important;
	-webkit-backdrop-filter: ${popFilter} !important;
}
[role="menu"] [class*="card"],
[role="tooltip"] [class*="card"] {
	backdrop-filter: none !important;
}
`;
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
	background-color: ${unifyTint
		? `color-mix(in srgb, var(--dsw-static-neutral-bluish-950) ${U(62)}%, transparent)`
		: `color-mix(in srgb, var(--dsw-alias-bg-base) ${U(62)}%, transparent)`} !important;
}
${unifyTint ? `body:not([data-ds-dark-theme]) [data-cordis-panel] {
	background-color: color-mix(in srgb, var(--dsw-static-neutral-bluish-00) ${U(62)}%, transparent) !important;
}` : ""}
[data-cordis-panel] [class*="row"] {
	background-color: ${unifyTint
		? `color-mix(in srgb, var(--dsw-static-neutral-bluish-950) ${U(55)}%, transparent)`
		: `color-mix(in srgb, var(--dsw-alias-bg-base) ${U(55)}%, transparent)`} !important;
}
${unifyTint ? `body:not([data-ds-dark-theme]) [data-cordis-panel] [class*="row"] {
	background-color: color-mix(in srgb, var(--dsw-static-neutral-bluish-00) ${U(55)}%, transparent) !important;
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
/* ── Aqua 实验模式：自适应文字色 + 蓝色清理（可开关，默认关） ── */
body[data-mpw-aqua] {
	--dsw-alias-label-primary: var(--mpw-aqua-ink, inherit);
	--dsw-alias-label-secondary: var(--mpw-aqua-ink-secondary, inherit);
	--dsw-alias-label-tertiary: var(--mpw-aqua-ink-tertiary, inherit);
	--dsw-alias-label-caption: var(--mpw-aqua-ink-tertiary, inherit);
	--dsw-alias-label-dimmed: var(--mpw-aqua-ink-tertiary, inherit);
	--dsw-alias-brand-primary: var(--mpw-aqua-ink, inherit);
	--dsw-alias-brand-text: var(--mpw-aqua-ink, inherit);
	--dsw-alias-state-business-primary: var(--mpw-aqua-ink-secondary, inherit);
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
body[data-mpw-aqua-text] .wSkVaW_scrollBody,
body[data-mpw-aqua-text] [data-slot*="message"],
body[data-mpw-aqua-text] [data-slot*="conversation"] [class*="message"] {
	text-shadow: 0 1px 2px rgba(0,0,0,0.85), 0 -1px 1px rgba(255,255,255,0.18);
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
/* ── 任务列表磨砂（实验，默认关）：todo 卡片纯模糊，无白色底条 ── */
body[data-mpw-todo-blur] [data-tool="todo_write"] {
	backdrop-filter: blur(16px) !important;
	-webkit-backdrop-filter: blur(16px) !important;
	background-color: transparent !important;
}
body[data-mpw-todo-blur] [data-tool="todo_write"] * {
	background-color: transparent !important;
}
`;
			}
			return css + buildUiCss(section, dlgFrosted);
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
	background: color-mix(in srgb, var(--dsw-static-neutral-bluish-00) 62%, transparent) !important;
	border-radius: 14px; padding: 10px 12px;
}
body[data-ds-dark-theme] .mpw_glassHost {
	background: color-mix(in srgb, var(--dsw-static-neutral-bluish-950) 62%, transparent) !important;
}
.mpw_title { font-size: 16px; line-height: 24px; font-weight: 600; color: var(--dsw-alias-label-primary); }
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
	border-color: var(--dsw-alias-brand-600, var(--dsw-alias-interactive-active, #4f8cff)) !important;
	color: var(--dsw-alias-brand-600, var(--dsw-alias-interactive-active, #4f8cff)) !important;
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
.mpw_thumbImg { width: 100%; height: 100%; object-fit: cover; display: block; }
/* ①(新) 壁纸列表两列网格（一排两个） */
.mpw_props.mpw_wallGrid { display: grid !important; grid-template-columns: 1fr 1fr; gap: 8px; align-items: start; }
.mpw_wallGrid .mpw_wallProp { min-width: 0; }
/* ④(新) 导入失败/错误提示：红色醒目，不再一闪而过看不清 */
.mpw_hint.mpw_err { color: #ff6b6b; font-weight: 500; }
.mpw_info { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); margin: 0; }
.mpw_props { display: flex; flex-direction: column; gap: 6px; padding: 8px; border-radius: 8px; background: var(--dsw-alias-bg-module-platform); overflow-anchor: none; /* 防 Firefox 滚动锚定跳顶（目录/轮播列表滚动时内容高度变化把 scrollTop 锚走，松手后/滑到底再滑自动跳顶，用户实测；同轮播 3ea2d96 根因） */ }
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
.mpw_switch::after {
	content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
	border-radius: 50%; background: var(--dsw-alias-label-primary);
	box-shadow: 0 1px 2px rgba(0,0,0,0.35); transition: left .15s ease;
}
.mpw_switch.mpw_on { background: var(--dsw-alias-brand-primary, #3964fe); border-color: transparent; }
.mpw_switch.mpw_on::after { left: 20px; background: #fff; }
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
}
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
   data-dsh-better-sidebar）。 */
${(section.bsFloat !== void 0 ? !!section.bsFloat : false) ? `
/* 1) 悬浮适配：面板圆角 + 边距 + 内部直角子元素处理。
   根因：bsFloat 只给 _panel/_bottomPanel 加圆角，但内部 .pane（bg-base）与
   .tabBar（bg-layer-1）是**两个不同 token 的直角背景**，铺满面板 → "圆角外框
   里套直角矩形、两层透明度不同"（用户实测）。修：_panel 设 overflow:hidden
   裁掉内层直角；pane/tabBar 背景改透明（继承面板 bg-layer-1 的圆角外壳），
   或统一跟随 bsAlpha/bsReveal。 */
[data-dsh-better-sidebar] [class*="_panel"],
[data-dsh-better-sidebar] [class*="_bottomPanel"] {
	border-radius: 14px;
	overflow: hidden;
}
[data-dsh-better-sidebar] [class*="_panel"] { margin: 6px 8px 8px 0; }
[data-dsh-better-sidebar] [class*="_bottomPanel"] { margin: 0 8px 8px; }
/* 内层直角背景改透明，让面板外壳圆角+背景统一透出（消除双层冲突）；
   bsReveal/bsAlpha/bsAqua 单独控制时此规则让位（下面各块后写优先）。 */
[data-dsh-better-sidebar] [class*="_pane"]:not([class*="_panel"]),
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
[data-dsh-better-sidebar] [class*="_panel"],
[data-dsh-better-sidebar] [class*="_bottomPanel"] {
	background-color: color-mix(in srgb, var(--dsw-alias-bg-base) ${section.bsRevealAlpha !== void 0 ? Math.max(10, Math.min(95, Number(section.bsRevealAlpha))) : 62}%, transparent) !important;
}
` : ""}
${(section.bsAlpha !== void 0 ? !!section.bsAlpha : false) ? `
/* 3) 透明度细粒度：面板根较实、内层 chrome（tab/编辑区/终端）较透、
   添加栏（+ 按钮区）单独处理——better-sidebar 的这些区域透明度本就不一致 */
[data-dsh-better-sidebar] [class*="_panel"],
[data-dsh-better-sidebar] [class*="_bottomPanel"] {
	background-color: color-mix(in srgb, var(--dsw-alias-bg-base) 68%, transparent) !important;
}
[data-dsh-better-sidebar] [class*="_pane"]:not([class*="_panel"]),
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
body[data-ds-dark-theme] [data-dsh-better-sidebar] [class*="_panel"],
body[data-ds-dark-theme] [data-dsh-better-sidebar] [class*="_bottomPanel"] {
	background-color: color-mix(in srgb, var(--dsw-static-neutral-bluish-950) 40%, transparent) !important;
}
body[data-ds-dark-theme] [data-dsh-better-sidebar] [class*="_pane"]:not([class*="_panel"]),
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
[data-dsh-better-sidebar] [class*="_panel"],
[data-dsh-better-sidebar] [class*="_bottomPanel"] {
	background-color: var(--dsw-alias-bg-base) !important;
}
[data-dsh-better-sidebar] [class*="_pane"]:not([class*="_panel"]),
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
		const TAB_ORDER = ["source", "wallpaper", "appearance", "unify", "blur", "aqua", "other", "liquid"];
		// ①(新) 取色盘预置色（借鉴 elysia395/dsh-wallpaper-engine）：点击即用
		const AQUA_PRESETS = ["#4f8cff", "#67DCE7", "#DD8FAC", "#F3B75F", "#F1717F", "#CBE77D"];

		function MpkgSection(props) {
			try {
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
			// ⑳(新) 设置页顶部 Tab（来源/外观/统一虚化/界面虚化/透出/Aqua/其他），减少滚动。
			// Tab 切换只改 display，控件始终挂载（hooks 稳定，不能条件卸载 sliderRow/toggleRow）。
			const [settingsTab, setSettingsTab] = react.useState("source");
			// ②(修正) Tab 切换：内容区 translateX 滑动（TAB_ORDER 顺序）
			const switchTab = (id) => {
				if (id === settingsTab) return;
				setSettingsTab(id);
			};
			const [mpkgMeta, setMpkgMeta] = react.useState(initMeta); // { name, key, info, entryName, slot }
			const [wallPausedByUser, setWallPausedByUser] = react.useState(false); // ①(新) 用户手动暂停壁纸
			const [busy, setBusy] = react.useState(false);
			// ①(修正) hint 自动超时清空（5 秒）：用户反馈「恢复所有默认设置」下方一直挂着
			// 「已应用壁纸：xxx」——hint 是操作结果提示，常驻会让用户误以为是与恢复默认相关
			// 的残留。用 ref 存原始 setter，包装成带超时的 setHint。
			const [hint, _setHintRaw] = react.useState("");
			const hintTimerRef = react.useRef(null);
			// ①(修正) 卸载时清理 hint 计时器（防对已卸载组件 setState）
			react.useEffect(() => () => { try { if (hintTimerRef.current) clearTimeout(hintTimerRef.current); } catch {} }, []);
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
			const rotScrollRef = react.useRef(null); // ①(新) { ratio } 勾选/过滤变化前的滚动比例
			const tabBodyRef = react.useRef(null); // ①(新) tab 高度自适应（跟随当前页最后按钮）
			const [wallList, setWallList] = react.useState([]); // ② 合并后的可选壁纸列表
			const [wallIdx, setWallIdx] = react.useState(-1);   // 当前在列表中的索引
			const [libShow, setLibShow] = react.useState(10);   // 1(新) 列表单次展示数量（可展开）
			const [libOpen, setLibOpen] = react.useState(true);  // 2(新) 壁纸列表展开/收起
			// ①(新) 统一错误弹窗：导入失败/文件过大/无法使用等提示全部弹窗体现
			const showError = (msg) => { setErrorMsg(String(msg)); setErrorModal(true); setHint(String(msg)); };
			const mpkgRef = react.useRef(null);
			const imgRef = react.useRef(null);
			const backupRef = react.useRef(null); // ④(新) 备份导入文件输入（其他 tab）
			// ⑤(新) 最近一次导出的实际文件名（界面显示，防重复导出分不清）
			const [backupFileName, setBackupFileName] = react.useState("");
			// ③(新) web 壁纸选项：当前 L2D 类壁纸的 loadJson.json SettingModel（可改项）
			const [webCfg, setWebCfg] = react.useState(null); // { skel, model, languages, customUrl } | null
			// ①(修正) 目录选择器滚动位置：进入子目录后列表高度变化时浏览器会把
			// scrollTop 强制归零（内容变短 → 跳顶），用户实测「滑到一半往上跳、选错目录」。
			// 记住打开时的滚动比例（0~1），dirSubs 更新后按比例恢复；比例存 ref 避免触发重渲染。
			const dirScrollRef = react.useRef(null);    // { ratio } 打开子目录前的滚动比例
			const dirListRef = react.useRef(null);      // 目录列表滚动容器
			// ⑳(新) 壁纸设置 tab：ffmpeg 跨平台转码的安装状态
			//（null=未查 / {checking} / {ready,path,version} / {missing} / {downloading} / {error}）
			const [ffmpegState, setFfmpegState] = react.useState(null);
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
				// ①(新) 同时取 betterSidebar 检测标志（host /ping 附带）
				try {
					fetch(HOST_BASE + "/ping", { method: "GET" }).then(async (p) => {
						if (p.ok) { const pd = await p.json(); if (pd && pd.version) setHostVersion(pd.version); if (pd && typeof pd.betterSidebar === "boolean") setBetterSidebar(pd.betterSidebar); }
					}).catch(() => {});
				} catch {}
				// ③(新) 检测宿主端可用性（大文件混合模式是否生效）
				fetch(HOST_BASE + "/ping", { method: "GET" }).then(async (r) => {
					setHostOk(!!r.ok);
					if (r.ok) { try { const d = await r.json(); if (d && d.version) setHostVersion(d.version); if (d && typeof d.betterSidebar === "boolean") setBetterSidebar(d.betterSidebar); } catch {} }
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

			const commit = (patch, instant) => {
				const next = Object.assign({}, readSection(), patch);
				writeSection(next, instant);
				setSection(next);
				applyFromStorage();
				return next;
			};
			// ⑳(新) 保存解码帧率上限到 section.fpsCap（持久化走 /settings）；改的同时刷新 ffmpeg 状态
			const setFpsCap = (v) => { commit({ fpsCap: v }, true); checkFfmpeg(); };
			// ①(新) 保存分辨率上限到 section.resMax（持久化走 /settings）；改完重放当前视频
			const setResMax = (v) => { commit({ resMax: v }, true); try { applyFromStorage(); } catch {} };
			// ⑲(新) 内置取色盘（自绘 HSV，无外部依赖/无加载副作用）：
			// 曾内联 vanilla-picker，但其 UMD 在模块加载时立即操作 DOM 且覆盖 module.exports，
			// 导致 dsh 加载插件崩溃（cannot get property "onChange" without inject）——已改为
			// 点击时创建 DOM 的自绘取色器（色相条 + 饱和/亮度面板 + hex 输入）。
			let pickerInst = null;
			const openPicker = (key, currentColor) => {
				try {
					if (pickerInst) { pickerInst.remove(); pickerInst = null; }
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
			const openDirPicker = async (path) => {
				// ①(修正) 记录当前列表滚动比例（进入子目录后列表高度变化会强制归零跳顶）
				try {
					if (dirListRef.current) {
						const el = dirListRef.current;
						const max = el.scrollHeight - el.clientHeight;
						dirScrollRef.current = { ratio: max > 0 ? el.scrollTop / max : 0 };
					}
				} catch {}
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
			// ①(修正) 目录列表更新后按记录的滚动比例恢复（防浏览器把 scrollTop 归零跳顶）。
			// ①(修正2) 用 requestAnimationFrame 确保新列表 DOM 已渲染后再恢复（否则
			// scrollTop 拿到的是旧高度/0）——原 effect 在渲染完成前读 scrollHeight 导致
			// 恢复失败仍跳顶（用户实测滑到底仍回顶）。依赖加 dirPath，进入子目录必触发。
			react.useEffect(() => {
				if (!dirPick || !dirSubs) return;
				const ratio = dirScrollRef.current && dirScrollRef.current.ratio;
				if (ratio === void 0 || ratio === null) return;
				requestAnimationFrame(() => {
					requestAnimationFrame(() => {
						try {
							const el = dirListRef.current;
							if (!el) return;
							const max = el.scrollHeight - el.clientHeight;
							el.scrollTop = max > 0 ? Math.round(ratio * max) : 0;
						} catch {}
						dirScrollRef.current = null;
					});
				});
			}, [dirPick, dirSubs, dirPath]);
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
								const url = HOST_BASE + "/media?token=" + d.token + "&index=" + entry.index;
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
							if (ok) { setLibBusy(false); return; }
						} catch (err) {
							console.warn("[dsh-mpkg-wallpaper] 时间变化提取失败，回退单素材:", err);
						}
					}
					const sel = d.selected;
					commit({
						image: "host:?token=" + d.token + "&index=" + sel.index + (sel.offset ? "&offset=" + sel.offset : ""),
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
			const applyCustomWebReal = (name, media) => {
				try {
					// ①(修正) 切换新 web 壁纸前，先彻底断开旧 iframe 上的 observer
					//（webMediaObserve / hideWebPanel 的 MutationObserver）——否则旧壁纸的
					// observer 残留，反复导入 web 壁纸会累积监听器/内存泄漏（用户实测：
					// 导入星野后清除，再导其他壁纸导不进，疑似内存爆）。
					try { disposeWebFrame(bgElements().frame); } catch {}
					commit({
						webUrl: "host:?custom=1&folder=" + encodeURIComponent(name) + "&file=" + encodeURIComponent(media || "index.html"),
						source: name, mpkgKey: "custom|" + name, mpkgName: name,
						fromMpkg: false, converted: "web", slot: null,
						info: undefined, timeVideos: undefined, timeConfig: undefined, activeSlot: null,
						image: undefined
					}, true);
					setMpkgMeta({ name: name, key: "custom|" + name, info: null, entryName: media || "index.html", slot: null });
					setHint(t("lib.applied") + "：" + name);
				} catch (err) { console.error("[dsh-mpkg-wallpaper] 应用网页壁纸失败:", err); showError(t("lib.fail") + String(err && err.message || err)); }
			};
			// ①(新) 应用自定义目录里的场景壁纸 → 静态帧提取（scene.pkg 主纹理；host 失败回退预览图）
			const applyCustomScenePreview = (w) => {
				try {
					setHint(t("scene.extracting"));
					const key = "custom|" + w.name;
					const staticImg = "host:?custom=1&folder=" + encodeURIComponent(w.name) + "&scene=1";
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
									const url = HOST_BASE + "/media?token=" + d.token + "&index=" + entry.index;
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
								if (ok) {
									setMpkgMeta({ name: w.title, key: key, info: null, entryName: "scene.pkg", slot: null });
									setHint(t("lib.applied") + "：" + w.title);
									return;
								}
							}
						} catch (err) { console.warn("[dsh-mpkg-wallpaper] scene.mpkg 方式失败，回退合成:", err); }
						// 回退：图层合成（canvas）→ 静态帧
						fetchSceneComposite(key).then((man) => {
							commit({
								image: staticImg, source: w.title, mpkgKey: w.key, mpkgName: w.title,
								fromMpkg: false, converted: "scene", sceneKey: key, slot: null,
								info: undefined, timeVideos: undefined, timeConfig: undefined, activeSlot: null,
								webUrl: undefined
							}, true);
							setMpkgMeta({ name: w.title, key: w.key, info: null, entryName: "scene.pkg", slot: null });
							setHint(t("lib.applied") + "：" + w.title);
						}).catch(() => {
							commit({
								image: staticImg, source: w.title, mpkgKey: w.key, mpkgName: w.title,
								fromMpkg: false, converted: "gif", sceneKey: undefined, slot: null,
								info: undefined, timeVideos: undefined, timeConfig: undefined, activeSlot: null,
								webUrl: undefined
							}, true);
							setMpkgMeta({ name: w.title, key: w.key, info: null, entryName: "scene.pkg", slot: null });
							setHint(t("lib.applied") + "：" + w.title);
						});
					})();
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
			const startRotation = () => {
				try { if (window.__mpwRotTimer) clearInterval(window.__mpwRotTimer); } catch {}
				const gid = section.rotGroupId;
				const g = gid ? (section.rotGroups || []).find((x) => x.id === gid) : null;
				const sec = g && g.interval > 0 ? g.interval : (section.rotateMin > 0 ? section.rotateMin : 5);
				if (g && g.order === "random") {
					// 随机顺序：每轮洗牌后顺序播放（先随机跳一次）
					window.__mpwRotTimer = setInterval(() => {
						const list = rotCandidates();
						if (list.length < 2) { nextWallpaper(); return; }
						const r = Math.floor(Math.random() * list.length);
						const target = list[r];
						setWallIdx(wallList.findIndex((w) => w.key === target.key));
						applyWallFromList(target);
					}, sec * 60 * 1000);
				} else {
					window.__mpwRotTimer = setInterval(nextWallpaper, sec * 60 * 1000);
				}
			};
			// ①(新) 轮播勾选网格滚动保持：勾选/切换过滤/其他重渲染都会让浏览器把
			// scrollTop 归零跳顶（用户实测：新建轮播列表勾选壁纸/滑动/停下都跳顶、锁定住）。
			// 根治：**useLayoutEffect 同步恢复**（渲染瞬间补回滚动，防被后续覆盖），
			// 记录**绝对 scrollTop**（勾选不改条目数、内容高度稳定，绝对位置更准）。
			// ①(修正) 用 (useLayoutEffect || useEffect) 守卫——测试环境的 react mock 无
			// useLayoutEffect，回退 useEffect。
			((react.useLayoutEffect || react.useEffect))(() => {
				if (!rotEditor) return;
				const pos = rotScrollRef.current && rotScrollRef.current.scrollTop;
				if (pos === void 0 || pos === null) return;
				try {
					const el = rotGridRef.current;
					if (!el) return;
					const max = el.scrollHeight - el.clientHeight;
					if (max > 0) {
						el.scrollTop = Math.min(pos, max);
						rotScrollRef.current = { scrollTop: el.scrollTop };
					}
				} catch {}
			}, [rotEdit && rotEdit.keys, rotFilter, rotEditor]);
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
			// ③(新) 轮换开关变化时启停
			react.useEffect(() => {
				const on = section.rotate !== void 0 ? !!section.rotate : DEFAULT_ROTATE;
				if (on) startRotation();
				else { try { if (window.__mpwRotTimer) clearInterval(window.__mpwRotTimer); window.__mpwRotTimer = null; } catch {} }
			}, [section.rotate, section.rotateMin, wallList.length]);
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
				// ①(新) Steam 库场景壁纸 → 图层合成（canvas 动态）；失败回退静态帧
				if (wp.type === "scene") {
					const key = "library|" + wp.ltoken;
					const staticImg = "host:?ltoken=" + wp.ltoken + "&scene=1";
					fetchSceneComposite(key).then(() => {
						commit({
							image: staticImg, source: wp.title, mpkgKey: "library|" + wp.ltoken, mpkgName: wp.title,
							fromMpkg: false, converted: "scene", sceneKey: key, slot: null,
							info: undefined, timeVideos: undefined, timeConfig: undefined, activeSlot: null,
							webUrl: undefined, propEdits: undefined
						}, true);
						setMpkgMeta({ name: wp.title, key: "library|" + wp.ltoken, info: null, entryName: "scene.pkg", slot: null });
						setHint(t("lib.applied") + "：" + wp.title);
					}).catch(() => {
						commit({
							image: staticImg, source: wp.title, mpkgKey: "library|" + wp.ltoken, mpkgName: wp.title,
							fromMpkg: false, converted: "gif", sceneKey: undefined, slot: null,
							info: undefined, timeVideos: undefined, timeConfig: undefined, activeSlot: null,
							webUrl: undefined, propEdits: undefined
						}, true);
						setMpkgMeta({ name: wp.title, key: "library|" + wp.ltoken, info: null, entryName: "scene.pkg", slot: null });
						setHint(t("lib.applied") + "：" + wp.title);
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
			const applyLibraryWebReal = (wc) => {
				try {
					const file = String(wc.media).split(/[\\/]/).pop();
					commit({
						webUrl: "host:?ltoken=" + wc.ltoken + "&web=1&file=" + encodeURIComponent(file),
						source: wc.title, mpkgKey: "library|" + wc.ltoken, mpkgName: wc.title,
						fromMpkg: false, converted: "web", slot: null,
						info: undefined, timeVideos: undefined, timeConfig: undefined, activeSlot: null,
						image: undefined, propEdits: undefined
					}, true);
					setMpkgMeta({ name: wc.title, key: "library|" + wc.ltoken, info: null, entryName: file, slot: null });
					setHint(t("lib.applied") + "：" + wc.title);
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
						const numFields = ["opacity", "blur", "zoom", "headerBlurAmount", "dialogAmount", "popoverAmount", "maskAmount", "unifyAmount", "sidebarAlpha", "aquaMaskAlpha", "aquaTintStrength", "glassAlpha", "rotateMin", "brightness", "playbackRate", "clockSize", "fpsCap", "resMax", "bsRevealAlpha"];
						const boolFields = ["sidebar", "sharp", "headerBlur", "headerBg", "dialogBlur", "popoverBlur", "maskBlur", "unifyTint", "chatFollow", "sessionFollow", "aquaMask", "aquaTint", "aquaInk", "aquaTextEnhance", "todoBlur", "hybrid", "roundCompat", "rotate", "float", "newStyle", "mute", "thinkBg", "enabled", "forceEnabled", "clock", "clock24h", "clockSec", "clockDate", "glassWindow", "bsCompat", "bsFloat", "bsFont", "bsReveal", "bsAlpha", "bsAqua", "bsBottomAvoid", "lgTest", "lgComposer", "lgSidebar", "lgHeader", "powPauseHidden", "powPauseBlur", "powPauseBattery"];
						const strFields = ["aquaColor", "aquaInkColor", "themeColor", "accent", "glassColor", "clockPos", "fontColorGrayColor"];
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
				const mediaUrl = (idx, offset) => HOST_BASE + "/media?token=" + token + "&index=" + idx + (offset ? "&offset=" + offset : "");
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
					storeVideoBlob(file).then((marker) => commit({ image: marker, source: file.name }, true));
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
					storeVideoBlob(file).then((marker) => commit({ image: marker, source: file.name }, true));
					return;
				}
				// ③(新) 图片：>2MB 直接存 Blob（idb:img，防 dataURL 膨胀）；小图走 dataURL
				setHint("");
				storeImageBlob(file).then((stored) => commit({ image: stored, source: file.name }, true));
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

			const h = react.createElement;
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
					? { position: "absolute", left: 0, right: 0, bottom: "100%", marginBottom: 4, zIndex: 2600, maxHeight: 220, overflowY: "auto" }
					: { position: "absolute", left: 0, right: 0, top: "100%", marginTop: 4, zIndex: 2600, maxHeight: 220, overflowY: "auto" };
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
							h(Toggle, { checked, onChange: (v) => { if (forceOn) return; commit({ [field]: v }); } })
						]),
						h("span", { className: "mpw_hint" }, desc)
					])
				]);
			};

			// ⑳(新) 壁纸设置 tab：计算激活的帧率上限值（缺省=0 无限制）与 ffmpeg 状态文本（渲染用）
			const fpsCapVal = section.fpsCap !== void 0 && section.fpsCap !== null ? section.fpsCap : 0;
			const resMaxVal = section.resMax !== void 0 && section.resMax !== null ? section.resMax : DEFAULT_RES_MAX;
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

			return h("div", { className: "mpw_row mpw_glassHost" }, [
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
				// ②(修正) 圆角导航栏 + 内容真滑动（translateX）；下划线由激活 tab ::after 绘制
				h("div", { className: "mpw_tabBar", "data-mpw-tabbar": "" }, [
					h("button", { className: "mpw_tab" + (settingsTab === "source" ? " mpw_tabActive" : ""), type: "button", onClick: () => switchTab("source") }, t("sec.source")),
					h("button", { className: "mpw_tab" + (settingsTab === "wallpaper" ? " mpw_tabActive" : ""), type: "button", onClick: () => switchTab("wallpaper") }, t("sec.wallpaper")),
					h("button", { className: "mpw_tab" + (settingsTab === "appearance" ? " mpw_tabActive" : ""), type: "button", onClick: () => switchTab("appearance") }, t("sec.appearance")),
					h("button", { className: "mpw_tab" + (settingsTab === "unify" ? " mpw_tabActive" : ""), type: "button", onClick: () => switchTab("unify") }, t("sec.unify")),
					h("button", { className: "mpw_tab" + (settingsTab === "blur" ? " mpw_tabActive" : ""), type: "button", onClick: () => switchTab("blur") }, t("sec.blur")),
					h("button", { className: "mpw_tab" + (settingsTab === "aqua" ? " mpw_tabActive" : ""), type: "button", onClick: () => switchTab("aqua") }, t("sec.aqua")),
					h("button", { className: "mpw_tab" + (settingsTab === "other" ? " mpw_tabActive" : ""), type: "button", onClick: () => switchTab("other") }, t("sec.other")),
					h("button", { className: "mpw_tab" + (settingsTab === "liquid" ? " mpw_tabActive" : ""), type: "button", onClick: () => switchTab("liquid") }, t("sec.liquid")),
				]),
				// 内容区：flex 行 + translateX 滑动（真翻页；所有 tab 内容始终挂载，hooks 稳定）
				h("div", { className: "mpw_tabBody", ref: tabBodyRef }, [
				// 内层 flex 行：translateX 滑动（外层裁剪区固定，否则整体左移内容全空——用户实测）
				h("div", { className: "mpw_tabRow", style: { transform: "translateX(-" + TAB_ORDER.indexOf(settingsTab) * 100 + "%)" } }, [
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

				// ①(修正) 清除背景按钮：挪到自定义本地壁纸目录上方（用户要求；不重置外观数值）
				// ①(新) 上方显示当前壁纸内容提示（含时段/web 适配）
				(section.image || section.webUrl) ? h("div", { className: "mpw_field" }, [
					mpkgMeta && mpkgMeta.name
						? h("p", { className: "mpw_hint" }, [
							mpkgMeta.name,
							mpkgMeta.entryName ? " · " + t("mpkg.using") + "：" + mpkgMeta.entryName
								+ (section.converted === "mp4" ? "（视频）" : section.converted === "web" ? "（网页）" : "") : null,
							section.timeConfig && section.timeConfig.enabled && section.timeVideos && section.timeVideos.length
								? " · " + t("time.now") + "：" + t("time." + slotForTime(section.timeConfig, new Date())) : null
						])
						: null,
					h("div", { className: "mpw_inline" }, [
						// ①(新) 暂停/播放：视频/web 类壁纸可暂停（停住画面），再点恢复
						(section.converted === "mp4" || section.converted === "web") ? h("button", { className: "mpw_reset", type: "button", onClick: () => { toggleWallPause(); setWallPausedByUser(!wallPausedByUser); } }, wallPausedByUser ? t("pause.play") : t("pause.pause")) : null,
						h("button", { className: "mpw_reset", type: "button", onClick: refreshBg }, t("refresh.bg")),
						h("button", { className: "mpw_reset", type: "button", onClick: clearBg }, t("clear.bg"))
					])
				]) : null,

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
					libOpen && wallList.length ? h("div", { className: "mpw_props mpw_wallGrid", style: { maxHeight: 260, overflowY: "auto" } }, [
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
											: h("img", { className: "mpw_thumbImg", src: resolveHostUrl(w.image), alt: "", loading: "lazy", decoding: "async",
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
						? h("div", { className: "mpw_props mpw_wallGrid", style: { maxHeight: 220, overflowY: "auto" } }, [
							libWalls.slice(0, libShow).map((wp, wi) => h("div", { className: "mpw_prop mpw_wallProp", key: wp.ltoken }, [
								h("div", { className: "mpw_inline", style: { alignItems: "flex-start", flexWrap: "nowrap" } }, [
									// ①(新) Steam 库预览缩略图（preview 走 /library-web 目录内任意文件；视频用 media 首帧）
									h("div", { className: "mpw_thumb" }, [
										wp.type === "video" && wp.media
											? h("video", { className: "mpw_thumbImg", src: HOST_BASE + "/library-media?ltoken=" + encodeURIComponent(wp.ltoken) + "&file=" + encodeURIComponent(String(wp.media).split(/[\\/]/).pop()), muted: true, playsInline: true, preload: "metadata",
												onLoadedMetadata: (ev) => { try { const v = ev.target; if (v.duration && v.duration > 0.1) v.currentTime = 0.05; } catch {} },
												onError: (ev) => { ev.target.style.display = "none"; } })
											: h("img", { className: "mpw_thumbImg", src: HOST_BASE + "/library-web?ltoken=" + encodeURIComponent(wp.ltoken) + "&file=" + encodeURIComponent(String(wp.preview || "").split(/[\\/]/).pop() || "preview.jpg"), alt: "", loading: "lazy", decoding: "async",
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
							h("button", { className: "mpw_miniBtn" + (rotFilter === "all" ? " mpw_on" : ""), type: "button", onClick: () => { try { const el = rotGridRef.current; if (el) { const max = el.scrollHeight - el.clientHeight; rotScrollRef.current = { scrollTop: el.scrollTop }; } } catch {} setRotFilter("all"); } }, t("rot.all")),
							h("button", { className: "mpw_miniBtn" + (rotFilter === "custom" ? " mpw_on" : ""), type: "button", onClick: () => { try { const el = rotGridRef.current; if (el) { const max = el.scrollHeight - el.clientHeight; rotScrollRef.current = { scrollTop: el.scrollTop }; } } catch {} setRotFilter("custom"); } }, t("rot.filterCustom")),
							h("button", { className: "mpw_miniBtn" + (rotFilter === "steam" ? " mpw_on" : ""), type: "button", onClick: () => { try { const el = rotGridRef.current; if (el) { const max = el.scrollHeight - el.clientHeight; rotScrollRef.current = { scrollTop: el.scrollTop }; } } catch {} setRotFilter("steam"); } }, t("rot.filterSteam")),
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
							: h("div", { ref: rotGridRef, style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, maxHeight: 220, overflowY: "auto" } }, wallList.filter((w) => rotFilter === "all" ? true : rotFilter === "steam" ? w.src === "steam" : !w.src || w.src !== "steam").map((w) => {
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
									// ①(新) 记录勾选前滚动比例（keys 变化重建列表会跳顶）
									try {
										const el = rotGridRef.current;
										if (el) {
											const max = el.scrollHeight - el.clientHeight;
											rotScrollRef.current = { scrollTop: el.scrollTop };
										}
									} catch {}
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

				// ③(新) 宿主端状态（proot/本机测试方法：可用 = 大文件无限制生效）
				h("p", { className: "mpw_hint" },
					(section.hybrid !== void 0 ? !!section.hybrid : DEFAULT_HYBRID)
						? (hostOk === true ? "混合模式：宿主端可用（大文件无 600MB 限制）"
							: hostOk === false ? "混合模式：宿主端不可用（已回退纯浏览器模式，600MB 上限）"
							: "混合模式：检测宿主端中…")
						: "纯浏览器模式（600MB 上限）"),

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
				// ①(修正) 面板不透明度已删除：统一虚化开启时它被 sidebarAlpha 取代且无效果，
				// 非统一虚化下也无独立意义 → 移除滑条，保留内部默认值逻辑。
				// ①(修正) 磨砂模糊条：仅当「统一虚化开 + 聊天区跟随开」时被整屏虚化接管 → 禁用并提示；
				// 聊天区跟随关 → 磨砂条恢复可调（聊天区壁纸由它控制，统一虚化只管侧边栏/标题栏）
				h("div", { style: ((section.unifyTint !== void 0 ? !!section.unifyTint : DEFAULT_UNIFY_TINT) && (section.chatFollow !== void 0 ? !!section.chatFollow : DEFAULT_CHAT_FOLLOW)) ? { opacity: 0.45, pointerEvents: "none" } : {} },
					sliderRow(t("blur"), "blur", 0, 40, "px", 1, DEFAULT_BLUR)),
				// 仅当被接管时提示
				((section.unifyTint !== void 0 ? !!section.unifyTint : DEFAULT_UNIFY_TINT) && (section.chatFollow !== void 0 ? !!section.chatFollow : DEFAULT_CHAT_FOLLOW))
					? h("p", { className: "mpw_hint" }, t("blur.overridden"))
					: null,
				sliderRow(t("zoom"), "zoom", 10, 2000, "%", 5, DEFAULT_ZOOM),
				sliderRow(t("brightness"), "brightness", 50, 150, "%", 1, DEFAULT_BRIGHTNESS),
				// ⑥ 镜头位置（平移）
				h("div", { className: "mpw_field" }, [
					h("label", { className: "mpw_label" }, t("lens.pos")),
					h("div", { className: "mpw_inline" }, [
						h("input", {
							className: "mpw_numInput", type: "text", inputMode: "decimal", autoComplete: "off",
							defaultValue: section.lensX !== void 0 ? section.lensX : 0,
							onInput: (ev) => {
								// 清洗：只留数字和一个小数点；禁科学计数法、限长 7 位、最多 2 位小数
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
						// ③(新) 镜头位置「默认」按钮：恢复 0/0
						h("button", { className: "mpw_reset mpw_miniBtn", type: "button", onClick: () => commit({ lensX: 0, lensY: 0 }, true) }, t("default"))
					])
				]),

				// ═══ 透出壁纸（从独立 tab 并入外观）═══
				h("div", { className: "mpw_section" }, t("sec.show")),
				h("p", { className: "mpw_hint" }, t("sec.show.desc")),

				// ⑥ 侧边栏透出开关
				toggleRow(t("sidebar"), t("sidebar.desc"), "sidebar", DEFAULT_SIDEBAR),

				// ⑤ 标题栏透出壁纸（②：与侧边栏透出归一类）
				toggleRow(t("headerBg"), t("headerBg.desc"), "headerBg", DEFAULT_HEADER_BG),

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

				// ①(新) 侧边栏磨砂（Aqua 方案）：与标题栏磨砂同类（区域自身玻璃化），
				// 弹窗打开时自动摘除（防弹窗被模糊层困住）；统一虚化开启时被整屏虚化接管
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

				// ── 遮罩虚化（设置/弹层打开时的全屏背景遮罩）──
				toggleRow(t("maskBlur"), t("maskBlur.desc"), "maskBlur", DEFAULT_MASK_BLUR),
				h("div", { style: { display: (section.maskBlur !== void 0 ? !!section.maskBlur : DEFAULT_MASK_BLUR) ? "" : "none" } },
					sliderRow(t("maskBlurAmount"), "maskAmount", 0, 40, "px", 1, DEFAULT_MASK_AMOUNT)),

				]),
				// ═══ Aqua 实验（默认全关，不影响原功能）═══
				h("div", { "data-mpw-tabkey": "aqua", style: { flex: "0 0 100%", minWidth: "100%", boxSizing: "border-box", paddingRight: "4px" } }, [
				h("div", { className: "mpw_section" }, t("sec.aqua")),
				h("p", { className: "mpw_hint" }, t("sec.aqua.desc")),
				// ①(修正) Aqua 方案来源：跳转 Bil812 的 PR #2（致谢可视化）
				h("div", { className: "mpw_inline", style: { marginBottom: 4 } }, [
					h("a", { className: "mpw_link", href: "https://github.com/XHR666/dsh-mpkg-wallpaper/pull/2", target: "_blank", rel: "noopener" }, "→ " + t("aqua.credit"))
				]),
				toggleRow(t("aquaMask"), t("aquaMask.desc"), "aquaMask", DEFAULT_AQUA_MASK),
				// ⑲(新) 统一雾强度：独立滑条（用户实测没有单独控制条，mask 透明度只能靠「面板不透明度」但该条不存在）
				h("div", { style: { display: (section.aquaMask !== void 0 ? !!section.aquaMask : DEFAULT_AQUA_MASK) ? "" : "none" } },
					sliderRow(t("aquaMaskAlpha"), "aquaMaskAlpha", 0, 100, "%", 1, DEFAULT_AQUA_MASK_ALPHA)),
				toggleRow(t("aquaTint"), t("aquaTint.desc"), "aquaTint", DEFAULT_AQUA_TINT),
				h("div", { style: { display: (section.aquaTint !== void 0 ? !!section.aquaTint : DEFAULT_AQUA_TINT) ? "" : "none" } },
					sliderRow(t("aquaTintStrength"), "aquaTintStrength", 0, 100, "%", 1, DEFAULT_AQUA_TINT_STRENGTH)),
				toggleRow(t("aquaInk"), t("aquaInk.desc"), "aquaInk", DEFAULT_AQUA_INK),
				// ⑲(新) 取色器：遮罩自定义色 / 品牌（发送键等主色）自定义色
				h("div", { className: "mpw_field" }, [
					h("label", { className: "mpw_label" }, t("aquaColor")),
					h("div", { className: "mpw_inline" }, [
						h("button", {
							className: "mpw_colorSwatch", "data-mpw-picker-anchor": "aquaColor", type: "button",
							style: { background: (section.aquaColor && /^#[0-9a-fA-F]{6}$/.test(section.aquaColor) ? section.aquaColor : "#808080") },
							onClick: () => openPicker("aquaColor", section.aquaColor)
						}),
						// ①(新) 预置色 swatch（点击即用，借鉴 elysia395 项目）
						...(AQUA_PRESETS.map((hex) => h("button", {
							className: "mpw_presetSwatch", type: "button", title: hex,
							style: { background: hex }, onClick: () => commit({ aquaColor: hex }, true)
						}))),
						h("button", { className: "mpw_miniBtn", type: "button", onClick: () => commit({ aquaColor: "" }, true) }, t("aquaColorReset"))
					]),
					// ①(修正) 说明换行到下方（旁边放预置色）
					h("p", { className: "mpw_hint" }, t("aquaColor.hint"))
				]),
				h("div", { className: "mpw_field" }, [
					h("label", { className: "mpw_label" }, t("aquaInkColor")),
					h("div", { className: "mpw_inline" }, [
						h("button", {
							className: "mpw_colorSwatch", "data-mpw-picker-anchor": "aquaInkColor", type: "button",
							style: { background: (section.aquaInkColor && /^#[0-9a-fA-F]{6}$/.test(section.aquaInkColor) ? section.aquaInkColor : "#808080") },
							onClick: () => openPicker("aquaInkColor", section.aquaInkColor)
						}),
						...(AQUA_PRESETS.map((hex) => h("button", {
							className: "mpw_presetSwatch", type: "button", title: hex,
							style: { background: hex }, onClick: () => commit({ aquaInkColor: hex }, true)
						}))),
						h("button", { className: "mpw_miniBtn", type: "button", onClick: () => commit({ aquaInkColor: "" }, true) }, t("aquaColorReset"))
					]),
					h("p", { className: "mpw_hint" }, t("aquaInkColor.hint"))
				]),
				// ⑲(新) 深底文字可读增强（近似方案：全局双色描边）
				toggleRow(t("aquaTextEnhance"), t("aquaTextEnhance.desc"), "aquaTextEnhance", DEFAULT_AQUA_TEXT_ENHANCE),
				// ⑲(新) 任务列表磨砂（收纳/展开统一模糊）
				toggleRow(t("todoBlur"), t("todoBlur.desc"), "todoBlur", DEFAULT_TODO_BLUR),
				// ①(新) PR3：自定义灰色字颜色（fontColorGray + 全覆盖）——开关 + 取色器。
				// 开：所有次级/三级/弱化灰字跟随自定义颜色（label-secondary/tertiary/caption/
				// dimmed/quaternary/分隔线/边框灰等），默认给一个暖灰示例，可自选。
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
				]),
				// ═══ 其他 ═══
				h("div", { "data-mpw-tabkey": "other", style: { flex: "0 0 100%", minWidth: "100%", boxSizing: "border-box", paddingRight: "4px" } }, [
				h("div", { className: "mpw_section" }, t("sec.other")),

				// ①(新) 新样式开关（uiverse 风格：轨道开关 + 倍速 radio）
				toggleRow(t("newStyle"), t("newStyle.desc"), "newStyle", false),
				// ⑦ 轻度锐化（可能影响 GIF 流畅度）
				toggleRow(t("sharp"), t("sharp.desc"), "sharp", DEFAULT_SHARP),

				// ②(新) Deep diving 背景方框开关（移到"其他"组）
				toggleRow(t("thinkBg"), t("thinkBg.desc"), "thinkBg", DEFAULT_THINK_BG),

				// ①(新) 第三方 UI 圆角兼容开关（其他组）
				toggleRow(t("roundCompat"), t("roundCompat.desc"), "roundCompat", DEFAULT_ROUND_COMPAT),

				// ①(新) 省电（遮挡暂停三档，借鉴 elysia395）：页面隐藏/失焦/电池供电时暂停壁纸
				toggleRow(t("powPauseHidden"), t("powPauseHidden.desc"), "powPauseHidden", false),
				toggleRow(t("powPauseBlur"), t("powPauseBlur.desc"), "powPauseBlur", false),
				toggleRow(t("powPauseBattery"), t("powPauseBattery.desc"), "powPauseBattery", false),

				// ①(新) 检测更新 / 一键热更新
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
						toggleRow(t("bs.alpha"), t("bs.alpha.desc"), "bsAlpha", false),
						// ①(新) 跟随 Aqua：开 = better-sidebar 面板应用 aqua 实验效果（统一雾/
						// 面板取色/自适应文字，与「其他」里的总开关形成「双开关」：本开关 +
						// aqua 对应开关都开才生效）
						toggleRow(t("bs.aqua"), t("bs.aqua.desc"), "bsAqua", false),
						toggleRow(t("bs.bottomAvoid"), t("bs.bottomAvoid.desc"), "bsBottomAvoid", false),
						h("p", { className: "mpw_hint" }, t("bs.alphaHint"))
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
				hint ? h("p", { className: "mpw_hint" + (/^(解析失败|文件过大|背景素材过大|存储空间|内存不足|此壁纸的视频纹理|不支持)/.test(hint) ? " mpw_err" : "") }, hint) : null,

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
				dirPick ? h(MaskPortal, { onClick: () => setDirPick(false) }, [
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
						h("div", { className: "mpw_props", ref: dirListRef, style: { maxHeight: 240, overflowY: "auto" } }, [
							dirPath ? h("div", { className: "mpw_prop", key: "__up" }, [
								h("button", { className: "mpw_reset mpw_moreBtn", type: "button", onClick: () => {
									// 1(修正) 上级路径：保留根斜杠（之前丢了 / → 相对路径 → 显示空）
									if (dirPlatform === "win32" && /^[A-Za-z]:\\/.test(dirPath)) {
										const rest = dirPath.slice(3);
										const up = rest ? dirPath.slice(0, 3) + rest.split("\\").slice(0, -1).join("\\") : "C:\\";
										openDirPicker(up || "C:\\");
									} else {
										const parts = dirPath.split("/").filter(Boolean);
										const up = parts.length > 1 ? "/" + parts.slice(0, -1).join("/") : "/";
										openDirPicker(up);
									}
								} }, "⬆ " + t("lib.up"))
							]) : null,
							dirSubs.length ? dirSubs.map((sd) => h("div", { className: "mpw_prop", key: sd }, [
								h("button", { className: "mpw_reset mpw_moreBtn", type: "button", onClick: () => {
									const sep = dirPath.includes("\\") ? "\\" : "/";
									openDirPicker((dirPath ? dirPath + sep : "") + sd);
								} }, "📁 " + sd)
							])) : h("p", { className: "mpw_hint" }, t("lib.noSub"))
						]),
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
						h("div", { className: "mpw_inline" }, [
							h("button", { className: "mpw_button", type: "button", onClick: () => {
								const wc = webConfirm;
								setWebConfirm(null);
								if (wc.src === "library") applyLibraryWebReal(wc);
								else applyCustomWebReal(wc.name, wc.media);
							} }, t("conflict.confirm")),
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
			]);
		} catch (err) {
			// 渲染错误边界：任何渲染异常只显示错误信息，绝不整页空白
			console.error("[dsh-mpkg-wallpaper] 设置页渲染失败:", err);
			return h("div", { className: "mpw_field" }, [
				h("p", { className: "mpw_hint" }, "壁纸引擎设置渲染出错: " + String(err && err.message || err))
			]);
		}
	}

		// ═══════════════════════════════════════════════════════════════════
		//  多语言
		// ═══════════════════════════════════════════════════════════════════
		const zh = {
			"nav": "壁纸引擎背景",
			"master": "启用壁纸引擎背景功能",
			"clear.bg": "清除背景",
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
			"web.confirmTitle": "应用网页壁纸？（实验性）",
			"web.confirmBody": "网页壁纸可能卡顿或无法加载",
			"web.riskHeavy": "⚠ 预检：Spine/L2D 骨骼动画壁纸，低性能设备上可能卡住界面",
			"web.riskExternal": "⚠ 预检：依赖外网资源（SDK/CDN），加载可能失败",
			"web.confirmBody": "网页壁纸可能卡顿或无法加载",
			"web.confirmHint": "部分网页壁纸（事件页/动效重）会在低性能设备上卡住界面；卡住时刷新页面即可恢复（不会自动重新加载）。若加载失败，壁纸会显示黑底并出现刷新按钮——那是壁纸自身的内容，属正常现象。",
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
			"sec.blur.desc": "各类弹层/面板打开时的背景虚化：对话框（通用居中窗口+聊天输入框）、设置面板、下载确认弹窗各自独立；弹层=菜单/下拉/提示；遮罩=弹层背后的全屏背景；侧边栏磨砂=侧边栏自身玻璃化",
			"sec.unify": "统一虚化",
			"sec.unify.desc": "整屏所有控件的模糊感由一组设置统一管理：虚化程度=壁纸模糊度，透明度=侧边栏/标题栏白雾厚度（标题栏也跟随，不再单独调节）；开启后「界面虚化」里的侧边栏磨砂被接管。关闭则各区域单独调节",
			"sec.show": "透出壁纸",
			"sec.show.desc": "控制对应区域是否显示壁纸：关=纯色不透明",
			"sec.other": "其他",
			"sec.liquid": "液态玻璃(测试)",
			"sec.liquid.desc": "Apple 液态玻璃效果测试区。总开关开启后禁用虚化/模糊/雾/主题色/时钟等外观类（壁纸+悬浮+布局保留），用于在纯净环境里测试玻璃效果。",
			"lg.test": "测试模式总开关",
			"lg.test.desc": "开启：只保留壁纸+悬浮+布局，外观类全部禁用",
			"lg.test.on": "✔ 测试模式已开启",
			"lg.glassTitle": "玻璃作用开关（叠加到 DSH 界面，需配合测试模式或独立使用）",
			"lg.composer": "输入框液态玻璃",
			"lg.sidebar": "侧边栏液态玻璃",
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
			"bs.float.desc": "侧边栏悬浮卡片同样作用于 better-sidebar 面板（圆角/边距；防切掉内容）",
			"bs.font": "字体颜色增强",
			"bs.font.desc": "better-sidebar 面板文字跟随自定义灰色字/深底可读增强",
			"bs.reveal": "透出壁纸",
			"bs.revealAlpha": "透出程度",
			"bs.reveal.desc": "better-sidebar 面板背景半透明透出壁纸（跟随透明度条）",
			"bs.alpha": "透明度细粒度控制",
			"bs.alpha.desc": "区分面板根/内层 chrome/添加栏等不同透明度（更精细）",
			"bs.alphaHint": "注意：better-sidebar 的「添加位置」（终端/浏览器/代码管理）与面板主体透明度不同，细粒度控制会分别处理",
			"bs.aqua": "跟随 Aqua 实验效果",
			"bs.aqua.desc": "双开关：本开关 + Aqua 实验里对应开关（统一雾/面板取色/自适应文字）都开启时，better-sidebar 面板才应用对应效果",
			"bs.bottomAvoid": "底部面板避开左侧栏",
			"bs.bottomAvoid.desc": "让 better-sidebar 底部面板左移，避开 DSH 左侧（收起）栏——防止悬浮+收起时面板盖住侧边栏（用户实测重叠）",
			"backup.desc": "导出/导入外观设置（外观·统一虚化·界面虚化·Aqua·其他；不含当前壁纸与扫描目录）。导出的文件可分享给他人导入",
			"backup.export": "导出备份",
			"backup.import": "导入备份",
			"backup.exported": "备份已导出",
			"backup.imported": "备份已导入并应用",
			"backup.bad": "备份文件无效或不含本插件设置",
			"backup.fail": "导出失败：",
			"backup.fileName": "最近导出：",
			"sec.aqua": "Aqua 实验",
			"sec.aqua.desc": "外观方案来自 Bil812（PR #2）的构想，已采用并全部做成独立开关（默认全关，不影响原功能）：统一雾 = 全屏遮罩让所有表面共享一种雾色；面板取色 = 颜色跟随壁纸主色；自适应文字 = 文字色随背景亮度变化 + 蓝色清理",
			"aqua.credit": "Bil812 的 PR #2（方案来源）",
			"aquaMask": "统一雾（全屏遮罩）",
			"aquaMask.desc": "所有表面（侧边栏/标题栏/聊天区/按钮）共享一种雾色（强度由下方「统一雾强度」条控制），不再分区白雾；关 = 保持现有分区雾",
			"aquaMaskAlpha": "统一雾强度",
			"aquaTint": "面板颜色匹配壁纸",
			"aquaTint.desc": "自动采样壁纸主色作为面板底色（视频/GIF 每 2 秒刷新）；强度由下方滑条控制；关 = 使用主题中性色",
			"aquaTintStrength": "面板取色强度",
			"aquaInk": "自适应文字色 + 蓝色清理",
			"aquaColor": "遮罩自定义色（取色盘）",
			"aquaColor.hint": "设置后优先于壁纸取色；点「默认」恢复自动",
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
			"todoBlur.desc": "对话中列出的任务（todo 卡片）背景模糊，收纳/展开状态统一（类似标题栏/侧边栏磨砂；默认关）",
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
			"brightness": "画面亮度",
			"float": "悬浮效果",
			"float.desc": "侧边栏/标题栏变为悬浮卡片（圆角+阴影+透出模糊壁纸）；默认关，开启后原有的透明/虚化功能不受影响",
			"flipX": "水平翻转（镜像）",
			"flipX.desc": "壁纸左右镜像（scaleX -1，Wallpaper Engine 原生基础选项）",
			"flipY": "垂直翻转（镜像）",
			"flipY.desc": "壁纸上下镜像（scaleY -1）",
			"themeColor": "主题颜色",
			"newStyle": "新样式开关（uiverse 风格）",
			"newStyle.desc": "开关与倍速按钮换成新样式（轨道开关 + radio 圆点）；关 = 旧样式",
			"themeColor.hint": "控制侧边栏 / 标题栏 / 新会话按钮 / 设置弹窗的整体底色 tint（取色盘 + 预置）；品牌交互元素（按钮/选中/链接）由 Aqua 区的「配色」控制；空 = 不启用",
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
			"blur.overridden": "统一虚化 + 聊天区跟随均开启：壁纸模糊由「整屏虚化程度」接管，磨砂条暂不可调；关闭「聊天区跟随整屏虚化」后磨砂条恢复可调（此时统一虚化只管侧边栏/标题栏）",
			"zoom": "镜头缩放",
			"lens.pos": "镜头位置（平移）",
			"lens.x": "X",
			"lens.y": "Y",
			"sidebar": "侧边栏透出壁纸",
			"sidebar.desc": "关闭后侧边栏恢复不透明，避免左右透明度不一致",
			"headerBlur": "标题栏磨砂",
			"headerBg": "标题栏透出壁纸",
			"headerBg.desc": "关闭后标题栏为纯白（暗色主题为纯深色）不透明，不再显示壁纸",
			"headerBlur.desc": "标题栏透出壁纸，磨砂程度由下方滑条控制（默认 0 = 透明，session log 等按钮不会被白色矩形框包住；拉高可加白雾保证文字可读）。需先开启「标题栏透出壁纸」",
			"headerBlurAmount": "标题栏磨砂程度",
			
			"unifyTint": "统一虚化",
			"unifyTint.desc": "开启后，侧边栏获得类似聊天框的毛玻璃虚化（整块模糊、无缝隙），强度由「整屏虚化程度」条控制；侧边栏表面白雾厚度由「侧边栏透明度」条控制；标题栏始终按自己的磨砂条（默认透明）。关闭后各区域单独调节",
			"unifyAmount": "整屏虚化程度",
			"sidebarAlpha": "侧边栏/标题栏透明度",
			"sidebarAlpha.desc": "统一虚化开启时：侧边栏表面的白雾厚度（0 = 全透明透出模糊壁纸，100 = 实心）。与「整屏虚化程度」解耦，可单独调；标题栏不再跟随（按自己的磨砂条）",
			"chatFollow": "聊天区跟随整屏虚化",
			"chatFollow.desc": "统一虚化开启时：开 = 聊天区壁纸模糊也随「整屏虚化程度」（磨砂条被接管禁用）；关 = 磨砂条恢复可调，聊天区壁纸由磨砂条控制（统一虚化只虚化侧边栏/标题栏）",
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
			"maskBlur": "虚化遮罩（全屏背景）",
			"maskBlur.desc": "打开设置面板或弹层时，窗口后面那层半透明背景的朦胧程度",
			"maskBlurAmount": "遮罩虚化程度",
			"sidebarBlur": "侧边栏磨砂",
			"sidebarBlur.desc": "侧边栏自身玻璃化（backdrop-filter 模糊其背后的壁纸），开启后侧边栏有类似 Aqua 的磨砂玻璃质感；打开弹窗时自动摘除以防弹窗被侧边栏模糊层困住",
			"sidebarBlurAmount": "侧边栏磨砂程度",
			"sidebarBlur.overridden": "统一虚化开启中：侧边栏磨砂由「整屏虚化程度」接管（壁纸层统一模糊）；关闭统一虚化后此条恢复可调",
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
		};
		const en = {
			"nav": "MPKG Wallpaper",
			"master": "Enable mpkg background",
			"clear.bg": "Clear background",
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
			"web.confirmTitle": "Apply web wallpaper? (experimental)",
			"web.riskHeavy": "⚠ Preflight: Spine/L2D skeletal-animation wallpaper — may freeze the UI on low-end devices",
			"web.riskExternal": "⚠ Preflight: depends on external resources (SDK/CDN) — may fail to load",
			"web.confirmBody": "Web wallpapers may freeze or fail to load",
			"web.confirmHint": "Some web wallpapers (event pages / heavy animations) can freeze the UI on low-end devices; if frozen, refresh the page to recover (it will not auto-reload). If loading fails, the wallpaper shows a black screen with a refresh button — that is the wallpaper's own content, not a bug.",
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
			"sec.unify": "Unified blur",
			"sec.unify.desc": "One set of controls rules the frosted feel of every surface: blur degree = wallpaper blur, transparency = sidebar/title-bar fog thickness (the title bar follows it too). When on, the sidebar frost below is taken over. Off = each area adjusts separately",
			"sec.show": "Show wallpaper",
			"sec.show.desc": "Whether the corresponding area shows the wallpaper: off = solid color, opaque",
			"sec.other": "Other",
			"sec.liquid": "Liquid Glass (test)",
			"sec.liquid.desc": "Apple Liquid Glass effect test area. The master switch disables appearance features (blur/fog/theme/clock) while keeping wallpaper + float + layout, for testing the glass effect in a clean environment.",
			"lg.test": "Test mode master switch",
			"lg.test.desc": "ON: only wallpaper + float + layout; appearance features disabled",
			"lg.test.on": "✔ Test mode ON",
			"lg.glassTitle": "Glass layer switches (overlay onto the DSH UI)",
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
			"bs.alpha": "Fine-grained transparency",
			"bs.alpha.desc": "Distinguish panel root / inner chrome / add-bar with different transparencies",
			"bs.alphaHint": "Note: better-sidebar's \"add\" area (terminal/browser/code) differs from the panel body — fine-grained control handles them separately",
			"bs.aqua": "Follow Aqua experiment effects",
			"bs.aqua.desc": "Double switch: this + the matching Aqua experiment toggle (unified fog / panel tint / adaptive ink) both on = the effect applies to better-sidebar panels",
			"bs.bottomAvoid": "Bottom panel avoids the left rail",
			"bs.bottomAvoid.desc": "Shift the better-sidebar bottom panel right so it clears the DSH left (collapsed) rail — fixes it covering the sidebar when floating + collapsed",
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
			"sec.aqua.desc": "Appearance ideas from Bil812 (PR #2), adopted and made into independent toggles (all OFF by default, original features untouched): unified fog = full-screen mask, every surface shares one fog color; panel tint = colors follow the wallpaper dominant color; adaptive ink = text follows background brightness + blue cleanup",
			"aqua.credit": "Bil812 PR #2 (idea source)",
			"aquaMask": "Unified fog (full-screen mask)",
			"aquaMask.desc": "Every surface (sidebar/title bar/chat/buttons) shares one fog color (strength by the Unified-fog-strength slider below) instead of per-area fog; off = keep the current per-area fog",
			"aquaMaskAlpha": "Unified fog strength",
			"aquaTint": "Panel colors match wallpaper",
			"aquaTint.desc": "Auto-samples the wallpaper's dominant color as the panel base (videos/GIFs refresh every 2s); strength by the slider below; off = theme neutral colors",
			"aquaTintStrength": "Panel tint strength",
			"aquaInk": "Adaptive text color + blue cleanup",
			"aquaColor": "Custom mask color (picker)",
			"aquaColor.hint": "When set, takes priority over wallpaper tint; Default restores auto",
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
			"brightness": "Brightness",
			"float": "Floating cards",
			"float.desc": "Sidebar/title bar become floating cards (rounded + shadow + see-through frosted wallpaper); off by default, existing transparency/blur features stay intact",
			"blur": "Frosted blur",
			"blur.overridden": "Unified blur + Chat-follows are both on: wallpaper blur is taken over by the Full-screen blur degree slider, so this frosted slider is disabled; turn off \"Chat follows full-screen blur\" to restore it (unified blur then only controls sidebar/title-bar fog)",
			"zoom": "Lens zoom (wallpaper camera)",
			"lens.pos": "Lens position (pan)",
			"lens.x": "X",
			"lens.y": "Y",
			"sidebar": "Show wallpaper in sidebar",
			"sidebar.desc": "Off keeps the sidebar opaque so left/right translucency stays consistent",
			"headerBlur": "Frost the title bar",
			"headerBg": "Show wallpaper behind the title bar",
			"headerBg.desc": "Off makes the title bar solid white (solid dark in dark theme), no wallpaper behind it",
			"headerBlur.desc": "Title bar shows the wallpaper; frosted amount via the slider below (default 0 = transparent, so the session-log button is not wrapped in a white rectangle; raise it for a readable fog). Needs \"Show wallpaper behind the title bar\" on",
			"headerBlurAmount": "Title bar frost amount",
			
			"unifyTint": "Unify blur",
			"unifyTint.desc": "On: the sidebar gets a chat-box-like frosted blur (one seamless layer, no seams); strength by the Full-screen blur degree; sidebar white-fog thickness by the Sidebar opacity slider; the title bar always follows its own frost slider (transparent by default). Off = per-area control",
			"unifyAmount": "Full-screen blur degree",
			"sidebarAlpha": "Sidebar / title-bar opacity",
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
			"maskBlur": "Blur mask (full-screen backdrop)",
			"maskBlur.desc": "Haziness of the translucent backdrop layer behind a window when settings/popovers open",
			"maskBlurAmount": "Mask blur amount",
			"sidebarBlur": "Sidebar frost",
			"sidebarBlur.desc": "The sidebar itself becomes glass (backdrop-filter blurs the wallpaper behind it, Aqua-style); automatically lifted while a dialog is open so the blur layer cannot trap fixed popups",
			"sidebarBlurAmount": "Sidebar frost amount",
			"sidebarBlur.overridden": "Unified blur is on: sidebar frost is taken over by the Full-screen blur degree (wallpaper-layer blur); turn unified blur off to adjust this slider",
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
			"time.morning": "Morning",
			"time.day": "Day",
			"time.dusk": "Dusk",
			"time.night": "Night",
			"reset": "Restore all defaults",
			"feedback": "Report issue",
			"default": "Default",
		};

		// ═══════════════════════════════════════════════════════════════════
		//  插件主体
		// ═══════════════════════════════════════════════════════════════════
		const inject = ["slots", "locale", "theme"];

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
					const hasDlg = !!document.querySelector(
						'[class*="sidebarCol"] [role="dialog"], [class*="sidebarCol"] [role="alertdialog"]'
					);
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
		//（之前用户实测 bug）。展开面板出现在 header 内时打 data-mpw-header-blur-off
		// 摘除 header 的 backdrop-filter，面板关闭即恢复。只作用于 header 内面板，
		// 不动侧边栏（sidebarCol 无此问题）。
		let headerBlurWatch = null;
		function setupHeaderBlurWatch() {
			if (headerBlurWatch !== null) return;
			const check = () => {
				try {
					const hasPanel = !!document.querySelector(
						'[class*="wSkVaW_header"] [class*="panel"], [class*="wSkVaW_header"] [class*="menu"], [class*="wSkVaW_header"] [role="menu"], [class*="wSkVaW_header"] [data-surface]'
					);
					if (hasPanel) document.body.setAttribute("data-mpw-header-blur-off", "");
					else document.body.removeAttribute("data-mpw-header-blur-off");
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
			} catch {}
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
						} catch {}
					});
					const head = document.head || document.documentElement;
					if (head) window.__mpwStyleWatch.observe(head, { childList: true, subtree: true });
				}
			} catch {}
			// ⑤(新) 宿主端设置持久化：异步拉取 host /settings（优先于 localStorage），
			// 拉到后重应用（配置跨端口/清浏览器数据不丢；host 不可用时回退 localStorage）。
			try { initHostSettings(); } catch {}
			// ①(修正) applyInner 每次 apply()（含 RTC 重连/重注入）都会重跑——若不判重，
			// 这里的 storage 监听 + 60s interval 每跑一次就多挂一份 → 越积越多（CPU+内存）。
			// 与 __mpwInlineWatcher/__mpwStyleWatch 一样，用 window 级标记只注册一次。
			if (!window.__mpwGlobalWired) {
				window.__mpwGlobalWired = true;
				window.addEventListener("storage", (e) => {
					if (e.key === STORE_KEY) {
						try { applyFromStorage(); } catch {}
					}
				});
				// 时间变化：每分钟检查时段，跨时段自动切换视频（⑧(新) 懒加载：槽位 blob 未缓存时
				// 按 timeSrc 按需提取，单槽峰值 ~50MB；④(新) timeOverride 手动锁定时暂停自动切换）
				try {
					setInterval(() => {
						const s = readSection();
						if (!s.timeVideos || !s.timeConfig || !s.timeConfig.enabled) return;
						// ④(新) 手动锁定时段：不再随时间自动切换，直到点「自动」
						if (s.timeOverride) return;
						const slot = slotForTime(s.timeConfig, new Date());
						if (slot === s.activeSlot) return;
						swapTimeSlot(slot);
					}, 60000);
				} catch {}
				// ①(新) 省电（遮挡暂停三档）：页面隐藏/失焦/电池供电时暂停壁纸，回来自动继续
				try { setupPowerSave(); } catch {}
			}
			const sectionInjected = () => ({
				commit: () => { applyFromStorage(); }
			});
			// ⑤ 注册为设置左侧导航的独立页面
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: ROW_ID,
				// ①(修正) order:39 固定在「插件市场」(order:40) 前面 —— 两者原都是 40，
				// 同 order 时位置不稳定会互换（用户实测）。39 保证壁纸设置恒在插件市场前。
				order: 39,
				label: () => react.createElement(react.Fragment, null,
					react.createElement("img", { src: NAV_ICON, alt: "", className: "mpw_navIconImg" }),
					" " + ctx.locale.bind(NS)("nav")),
				locale: NS,
				inject: sectionInjected
			}, MpkgSection));
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "ui-mpkg-wallpaper: settings section dictionaries");
		}

		exports.inject = inject;
		exports.apply = apply;
		return module.exports;
	}
});
