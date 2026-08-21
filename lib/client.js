window.__ModuleLoader__.load({
	id: "@local/dsh-mpkg-wallpaper",
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
		const HOST_SKIP_KEYS = ["image", "info", "propEdits", "timeVideos", "timeConfig", "timeSrc", "activeSlot", "timeOverride", "webUrl"];
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
			wrap.classList.remove("mpw-img");
			wrap.classList.remove("mpw-video");
			wrap.classList.remove("mpw-scene");
			wrap.classList.add("mpw-web");
			img.style.display = "none";
			video.style.display = "none";
			try { if (frame.src !== url) frame.src = url; } catch {}
			// ①(修正) 静音开关（默认开）：web 壁纸有声音时用。
			// ①(修正) frame.muted 逻辑曾写反（!(mute) → 默认反而出声）；现在正向。
			applyWebMute(frame);
			// ①(新) 内容加载完成后补一次静音/倍速（壁纸音频元素常是 JS 动态创建的）
			// ③(新) 同时隐藏壁纸自带设置面板（L2D 类右上角「设置」按钮 + 面板）
			try { frame.onload = () => { applyWebMute(frame); applyWebSpeed(frame); hideWebPanel(frame); }; } catch {}
			// ①(修正) 动态创建的 audio/video 也要静音/倍速：挂 MutationObserver
			//（onload 之后才出现的元素，评审指出）；切离 web 时 disconnect 防泄漏。
			webMediaObserve(frame);
			frame.style.display = "";
			// ⑳(新) web 壁纸倍速：iframe 内 <video> 的 playbackRate（同源可访问；
			// 部分 web 壁纸用 canvas/WebGL 渲染无 <video>，静默跳过）
			applyWebSpeed(frame);
			hideWebPanel(frame);
		}
		/** ①(修正) 观察 web iframe 内新增的 audio/video：自动补静音 + 倍速。
		 *  挂到 frame 元素上（frame 被 showImageEl/showVideoEl 移除 src 或卸载时
		 *  一起被清理，避免观察器泄漏）。 */
		function webMediaObserve(frame) {
			try {
				if (frame.__mpwWebObs) return;
				const doc = frame && frame.contentDocument;
				if (!doc) return;
				const obs = new MutationObserver(() => {
					try { applyWebMute(frame); applyWebSpeed(frame); } catch {}
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
				const mute = readSection().mute !== void 0 ? !!readSection().mute : true;
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
		 *  ①(修正) 沿 DOM 向上藏外层容器时，**跳过包含壁纸画布的祖先**（#main /
		 *  canvas / 含 app 根容器）——用户实测：星野壁纸导入后整个壁纸消失，
		 *  因为 #basetting 的祖父链一路藏到了壁纸本体容器。面板与画布是兄弟节点，
		 *  只藏"不含画布"的那条链即可。 */
		function hideWebPanel(frame) {
			try {
				const doc = frame && frame.contentDocument;
				if (!doc) return;
				if (doc.getElementById("mpw-webPanelHide")) return;
				const st = doc.createElement("style");
				st.id = "mpw-webPanelHide";
				st.textContent = "#setting-button, #basetting { display: none !important; }";
				doc.head.appendChild(st);
				// ①(修正) 面板显示由壁纸代码切换 #basetting 的祖父元素 display（F() 函数），
				// 且面板外层有**半透明背景容器**——只藏 #basetting 不够，要把外层一起藏。
				// 壁纸 JS 会用 display:block 反复改回（panelDisplay 默认 true），
				// 所以用 setProperty(...,"important") 压住内联样式 + visibility:hidden 兜底，
				// 并挂 MutationObserver 持续保障（壁纸可能周期 toggle）。
				const containsCanvas = (el) => {
					try {
						if (el.id === "main" || el.id === "app" || el.tagName === "BODY" || el.tagName === "HTML") return true;
						return !!(el.querySelector && el.querySelector("canvas, #main"));
					} catch { return true; }
				};
				const hidePanelChain = () => {
					const b = doc.getElementById("basetting");
					if (b) {
						let el = b.parentElement && b.parentElement.parentElement;
						let d = 0;
						while (el && d < 4) {
							if (containsCanvas(el)) break; // 别动壁纸本体/画布容器
							el.style.setProperty("display", "none", "important");
							el.style.setProperty("visibility", "hidden", "important");
							el = el.parentElement;
							d++;
						}
					}
					const btn = doc.getElementById("setting-button");
					if (btn) { try { btn.style.setProperty("display", "none", "important"); } catch {} }
				};
				hidePanelChain();
				// 持续保障：壁纸 JS 可能周期性把面板 display/visibility 改回，observer 再藏回去
				try {
					if (frame.__mpwPanelObs) return;
					const obs = new MutationObserver(() => { try { hidePanelChain(); } catch {} });
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

		/** 从 localStorage 状态渲染背景 DOM + 样式。 */
		function applyFromStorage() {
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
			// converted === "web" 门控：防止切回图片/视频壁纸后旧 webUrl 残留导致 iframe 不消失。
			if (section.webUrl && section.converted === "web") {
				if (enabled) {
					try { showWebEl(resolveHostUrl(section.webUrl)); } catch {}
				} else {
					try { const f = bgElements().frame; if (f) f.style.display = "none"; } catch {}
				}
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
					// ①(修正) 重启竞态兜底：video 也要 404 重试（否则 host 晚就绪 → 视频壁纸永久空白）
					const vid = bgElements().video;
					if (vid && !vid.__mpwHostRetryVideo) {
						vid.__mpwHostTries = 0;
						vid.addEventListener("error", () => {
							if (gen !== bgGen) return;
							if ((vid.__mpwHostTries || 0) >= 5) { vid.__mpwHostTries = 0; return; }
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
					if (IS_EDGE) { try { showVideoEdge(hostUrl, bgElements().video); } catch { showVideoEl(hostUrl); } }
					else showVideoEl(hostUrl);
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
				// ①(修正) 壁纸 blur 归谁管：
				//  - 统一虚化开 + chatFollow 开 → unifyAmount 接管（整屏统一模糊）
				//  - 统一虚化开 + chatFollow 关 → 磨砂条控制壁纸 blur；侧边栏/标题栏毛玻璃
				//    由壁纸层 blur + 表面半透明提供（见 frostedLayers 注释）
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
			// ①(新) 侧边栏磨砂（Aqua 方案）：body 属性门控；弹窗打开时 JS 打 data-mpw-sblur-off 摘除
			try {
				const sidebarBlurOn = section.sidebarBlur !== void 0 ? !!section.sidebarBlur : DEFAULT_SIDEBAR_BLUR;
				if (sidebarBlurOn) document.body.setAttribute("data-mpw-sblur", "");
				else document.body.removeAttribute("data-mpw-sblur");
			} catch {}
			try { setupSblurObserver(); } catch {}
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
			const enabled = section.enabled !== void 0 ? !!section.enabled : DEFAULT_ENABLED;
			const hasImage = !!section.image;
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
				tokenDisposer = ctx.theme.overrideTokens("@local/dsh-mpkg-wallpaper-tokens", overrides);
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
			// ①(新) 悬浮效果开关（buildCss 内声明，之前误加在 applyFromStorage 里导致 ReferenceError）
			const floatOn = section.float !== void 0 ? !!section.float : DEFAULT_FLOAT;
			const hasImage = !!(section && section.image);
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
			// ②(修正) chatFollow（统一虚化开时聊天区是否跟随整屏虚化）：
			// 关 → 聊天区壁纸由磨砂条控制，侧边栏/标题栏背后仍需跟随整屏虚化度
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
			let css = `/* ── 背景插件 @local/dsh-mpkg-wallpaper v3 生成的样式 ── */\n`;
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
/* 遮罩虚化：无条件（无壁纸也要模糊，否则字叠字） */
[class*="mask"] {
	backdrop-filter: ${blurNoWall} !important;
	-webkit-backdrop-filter: ${blurNoWall} !important;
}
/* 遮罩背景加深（防字叠字） */
.mpw_mask { background: rgba(0,0,0,0.55) !important; }
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
   不再用 sidebar-fill 导致侧边栏与聊天区颜色不同、背景被"分裂"） */
.pI_x6G_sidebarCol,
.hHd-Xa_root {
	background-color: ${unifyTint
		? `color-mix(in srgb, var(--dsw-static-neutral-bluish-950) ${U(panel)}%, transparent)`
		: `color-mix(in srgb, var(--dsw-specific-sidebar-fill) ${panel}%, transparent)`} !important;
}
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
			if (headerBlur && headerBg) {
				// ①(修正) 标题栏磨砂。**绝不能给 header 本体加 backdrop-filter**——
				// header 有 fixed 子元素（子代理展开面板/后台任务条），backdrop-filter 会成为
				// 它们的 containing block，导致面板定位错乱（用户实测 bug）。
				// ①(修正) 标题栏雾底：unify 开 → **透明**（session log 按钮/标准模式标签
				// 后的白框 = 标题栏白底，用户两次要求去掉；标题栏直接透出模糊壁纸）；
				// unify 关 → 按「标题栏磨砂程度」条（默认 0=透明，需要雾底自行拉高）。
				// 侧边栏白雾由「侧边栏/标题栏透明度」条控制（仅侧边栏）。
				const hblurAmt = section.headerBlurAmount !== void 0 ? section.headerBlurAmount : DEFAULT_HEADER_BLUR_AMOUNT;
				const hdrAlpha = unifyTint ? 0 : Math.max(0, Math.min(100, hblurAmt));
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
			// ── F. 统一虚化 + 聊天区不跟随：侧边栏背后叠加整屏虚化度 ──
			// chatFollow 关 → 壁纸层 blur = 磨砂条（frostBlur）供聊天区；
			// 侧边栏背后再叠 backdrop blur(unifyAmt)，调整「整屏虚化程度」即可改变
			// 侧边栏背后的虚化（用户实测：当前关了 chatFollow 后 unifyAmount 失效）。
			// 弹窗打开时 body[data-mpw-sblur-off] 摘除（复用侧边栏磨砂的摘除机制，
			// backdrop-filter 会困住 fixed 弹窗）。unify 关时不输出。
			// ①(修正) **绝不把 header 放进这条规则**——header 内有 absolute 的
			// 子代理/后台任务展开面板（h8S2Va_menu / JObwrW_panel），backdrop-filter
			// 会成为它们的 containing block → 面板定位错乱、z-index 失效，
			// 被聊天文字盖住（用户实测：悬浮+统一虚化组合下标题栏展开的
			// 子代理/后台任务名称叠到对话框文字下面）。header 无 backdrop-filter。
			if (unifyTint && !chatFollowInCss && unifyAmount > 0 && bdSupported) {
				css += `
/* ── 统一虚化 + 聊天区不跟随：侧边栏背后叠加整屏虚化度（header 除外，
   见上：backdrop-filter 会困住标题栏展开面板） ── */
html body:not([data-mpw-sblur-off]) .pI_x6G_sidebarCol,
html body:not([data-mpw-sblur-off]) [class*="sidebarCol"] {
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
/* 区域5: 侧边栏收起后 rail 右缘 1px 接缝透明 */
[data-sidebar-collapsed] .pI_x6G_sidebarCol { border-right-color: transparent !important; }
[data-sidebar-collapsed] [class*="sidebarCol"] { border-right-color: transparent !important; }
/* 区域5b: 收起后 rail 内部面（logoRow/newSession/footArea）透出模糊壁纸：
   同样不加 backdrop-filter（root 是弹层祖先，会困住 fixed 弹层） */
[data-sidebar-collapsed] [class*="root"] {
	background-color: transparent !important;
}
`;
			}
			// ①(修正) 遮罩虚化无条件生效（不依赖是否有壁纸——无壁纸时弹窗遮罩也要模糊，
			// 否则遮罩只有灰底无模糊、弹窗边框透明（用户实测））
			css += `
/* ②(重做) 遮罩虚化独立（maskBlur/maskAmount）：设置/弹层打开时全屏背景遮罩的虚化 */
[class*="mask"] {
	backdrop-filter: ${(maskBlur && maskAmount > 0 && bdSupported) ? `blur(${maskAmount}px)` : "none"} !important;
	-webkit-backdrop-filter: ${(maskBlur && maskAmount > 0 && bdSupported) ? `blur(${maskAmount}px)` : "none"} !important;
}
/* ①(修正) 遮罩背景加深一点（防字叠字；:has 兼容性差不用） */
.mpw_mask { background: rgba(0,0,0,0.55) !important; }
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
	/* ①(修正) 与左侧设置栏同款：--dsw-specific-sidebar-fill 半透明灰（能透壁纸），
	   之前用 78% 模块色太实不透（用户反馈观感不一致） */
	background: var(--dsw-specific-sidebar-fill) !important;
	border-radius: 14px; padding: 10px 12px;
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
}
body[data-ds-dark-theme] .mpw_tabBar {
	background: color-mix(in srgb, var(--dsw-alias-bg-layer-2) 45%, transparent);
}
.mpw_tab {
	flex: none; font: inherit; color: var(--dsw-alias-label-secondary);
	cursor: pointer; white-space: nowrap; background: 0 0; border: none;
	padding: 6px 12px; font-size: 13px; border-radius: 8px;
}
.mpw_tab:hover { color: var(--dsw-alias-label-primary); background: color-mix(in srgb, var(--dsw-alias-interactive-bg-hover) 60%, transparent); }
.mpw_tabActive {
	color: var(--dsw-alias-brand-primary, #4f6ef7);
	font-weight: 600;
}
/* 下划线指示条：切换时 left/width 平滑平移（useEffect 测量激活 tab） */
.mpw_tabIndicator {
	position: absolute; bottom: 0; height: 2px; border-radius: 2px;
	background: var(--dsw-alias-brand-primary, #4f6ef7);
	transition: left .22s cubic-bezier(.4,0,.2,1), width .22s cubic-bezier(.4,0,.2,1);
	left: 0; width: 0; pointer-events: none;
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
.mpw_props { display: flex; flex-direction: column; gap: 6px; padding: 8px; border-radius: 8px; background: var(--dsw-alias-bg-module-platform); }
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
	margin: 12px -12px 12px 12px;
	padding: 0;
	border-radius: 12px;
	border: 1px solid rgba(19,45,83,0.26);
	overflow: visible;
	position: relative;
	z-index: 5;
	transition: margin 0.18s ease, padding 0.18s ease, border-radius 0.18s ease, border-color 0.18s ease;
}
body[data-mpw-float] body[data-ds-dark-theme] [data-sidebar-collapsed] .pI_x6G_sidebarCol,
body[data-mpw-float] body[data-ds-dark-theme] [data-sidebar-collapsed] [class*="sidebarCol"] {
	border-color: rgba(148,180,220,0.32);
}` : ""}
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
		const TAB_ORDER = ["source", "appearance", "unify", "blur", "show", "aqua", "other"];
		// ①(新) 取色盘预置色（借鉴 elysia395/dsh-wallpaper-engine）：点击即用
		const AQUA_PRESETS = ["#4f8cff", "#67DCE7", "#DD8FAC", "#F3B75F", "#F1717F", "#CBE77D"];

		function MpkgSection(props) {
			try {
			const { t } = props;
			const initMeta = (() => {
				const s = readSection();
				if (s.fromMpkg && s.mpkgKey && s.info) return { name: s.mpkgName, key: s.mpkgKey, info: s.info, entryName: s.source || "preview.gif", slot: s.slot };
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
			const [busy, setBusy] = react.useState(false);
			// ①(修正) hint 自动超时清空（5 秒）：用户反馈「恢复所有默认设置」下方一直挂着
			// 「已应用壁纸：xxx」——hint 是操作结果提示，常驻会让用户误以为是与恢复默认相关
			// 的残留。用 ref 存原始 setter，包装成带超时的 setHint。
			const [hint, _setHintRaw] = react.useState("");
			const hintTimerRef = react.useRef(null);
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
			const [updConfirm, setUpdConfirm] = react.useState(null); // ⑩(新) 新版本确认下载弹窗
			const [webConfirm, setWebConfirm] = react.useState(null); // ①(新) 网页壁纸确认弹窗（实验性警告）
			const [rotModal, setRotModal] = react.useState(false);   // ⑳(新) 轮播列表管理弹窗
			const [rotEditor, setRotEditor] = react.useState(false); // ⑳(新) 轮播列表编辑弹窗
			const [rotEdit, setRotEdit] = react.useState(null);      // ⑳(新) 正在编辑的列表草稿
			const [rotFilter, setRotFilter] = react.useState("all"); // ⑳(新) 勾选界面来源过滤：all/custom/steam
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

			// ④ 初始冲突检测（设置页打开时其他插件都已加载）
			react.useEffect(() => {
				setConflicts(detectConflicts());
				// ②(修正) 注册设置页状态刷新回调：导入时间壁纸/切换时段后
				// notifySectionChanged() → 重读 section，时段 UI 立即出现/高亮更新
				//（否则要关掉设置页重开才显示，用户实测）。
				mpwSectionNotify = () => { try { setSection(readSection()); } catch {} };
				// ①(修正) 版本号实时刷新：每次打开设置页/切 tab 都重新读本地安装版本
				//（host 从 package.json 读，文件更新了版本自然跟着变；插件市场式体验）
				try {
					fetch(HOST_BASE + "/ping", { method: "GET" }).then(async (p) => {
						if (p.ok) { const pd = await p.json(); if (pd && pd.version) setHostVersion(pd.version); }
					}).catch(() => {});
				} catch {}
				// ③(新) 检测宿主端可用性（大文件混合模式是否生效）
				fetch(HOST_BASE + "/ping", { method: "GET" }).then(async (r) => {
					setHostOk(!!r.ok);
					if (r.ok) { try { const d = await r.json(); if (d && d.version) setHostVersion(d.version); } catch {} }
				}).catch(() => setHostOk(false));
				return () => { if (mpwSectionNotify) mpwSectionNotify = null; };
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
					const ind = document.querySelector('[data-mpw-tabind]');
					const active = bar && bar.querySelector(".mpw_tabActive");
					if (bar && ind && active) {
						ind.style.left = active.offsetLeft + "px";
						ind.style.width = active.offsetWidth + "px";
					}
				} catch {}
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
					window.addEventListener("mousemove", (e) => {
						if (drag === "hue") { h = pickPos(e, hueBar, false) * 360; refresh(); }
						else if (drag === "sv") { s = pickPos(e, svPanel, false); v = 1 - pickPos(e, svPanel, true); refresh(); }
					});
					window.addEventListener("mouseup", () => { drag = null; });
					okBtn.addEventListener("click", () => { commit({ [key]: hexInput.value.trim() }, true); pickerInst = null; wrap.remove(); });
					// 定位在色块附近
					const pr = parent.getBoundingClientRect();
					wrap.style.left = Math.min(window.innerWidth - 240, pr.right + 8) + "px";
					wrap.style.top = Math.max(0, pr.top - 10) + "px";
					refresh();
					pickerInst = wrap;
					// 点击外部关闭
					const outside = (e) => { if (!wrap.contains(e.target) && e.target !== parent) { wrap.remove(); pickerInst = null; document.removeEventListener("mousedown", outside); } };
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
			// ①(新) 一键热更新（host 从 GitHub 下载最新代码写回）
			const applyUpdate = async () => {
				setUpdState({ applying: true });
				try {
					const r = await fetch(HOST_BASE + "/update-apply", { method: "POST" });
					const d = await r.json();
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
						frame.removeAttribute("src");
						frame.src = bustUrl(u);
					} catch {}
					setHint(t("webcfg.applied"));
				} catch (err) { console.warn("[dsh-mpkg-wallpaper] 应用 web 壁纸选项失败:", err); showError(t("webcfg.fail") + String(err && err.message || err)); }
			};
			const applyCustomWebReal = (name, media) => {
				try {
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
				const anyOpen = previewModal || errorModal || dirPick || updConfirm || conflictModal;
				try {
					if (anyOpen) document.body.setAttribute("data-mpw-modal", "");
					else document.body.removeAttribute("data-mpw-modal");
				} catch {}
			}, [previewModal, errorModal, dirPick, updConfirm, conflictModal]);
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
				"forceEnabled", "propEdits", "clock", "clock24h", "clockSec", "clockDate", "clockPos", "clockSize"
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
						const numFields = ["opacity", "blur", "zoom", "headerBlurAmount", "dialogAmount", "popoverAmount", "maskAmount", "unifyAmount", "sidebarAlpha", "aquaMaskAlpha", "aquaTintStrength", "glassAlpha", "rotateMin", "brightness", "playbackRate", "clockSize"];
						const boolFields = ["sidebar", "sharp", "headerBlur", "headerBg", "dialogBlur", "popoverBlur", "maskBlur", "unifyTint", "chatFollow", "sessionFollow", "aquaMask", "aquaTint", "aquaInk", "aquaTextEnhance", "todoBlur", "hybrid", "roundCompat", "rotate", "float", "newStyle", "mute", "thinkBg", "enabled", "forceEnabled", "clock", "clock24h", "clockSec", "clockDate", "glassWindow"];
						const strFields = ["aquaColor", "aquaInkColor", "themeColor", "accent", "glassColor", "clockPos"];
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
				// ②(修正) 清壁纸时同时清时间槽缓存（bg-morning 等）——否则旧槽缓存残留，
				// 清完再导入时间壁纸仍会串台显示上一张壁纸的时段视频（用户实测）。
				const cs = readSection();
				if (Array.isArray(cs.timeVideos)) {
					for (const l of cs.timeVideos) { try { idbDel("bg-" + l.key); } catch {} }
				}
				for (const k of ["morning", "day", "dusk", "night"]) { try { idbDel("bg-" + k); } catch {} }
				const s = readSection();
				writeSection(Object.assign({}, s, { image: "", source: "", fromMpkg: false, converted: "", mpkgKey: "", mpkgName: "", info: undefined, slot: null, timeVideos: undefined, timeConfig: undefined, activeSlot: null, timeSrc: null, timeOverride: null }), true);
				setSection(readSection());
				setMpkgMeta(null);
				applyFromStorage();
			};
			// ⑩(新) 刷新壁纸：重新应用当前壁纸（web iframe 重载 / host 缓存击穿 /
			// 场景重拉清单 / 视频重缓冲）。不改变任何设置，仅重新拉取素材。
			const refreshBg = () => {
				try {
					const s = readSection();
					if (!s.image && !s.webUrl) return;
					if (s.webUrl && s.converted === "web") {
						// web：iframe 重新加载（换 URL 触发重载）
						const f = bgElements().frame;
						if (f) {
							const u = resolveHostUrl(s.webUrl);
							try { f.removeAttribute("src"); } catch {}
							f.src = u + (u.indexOf("?") >= 0 ? "&" : "?") + "_t=" + Date.now();
							f.style.display = "";
						}
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
				if (type === "mp4" || type === "webm") {
					if (file.size > 100 * 1024 * 1024) { showError(t("file.tooLarge")); return; }
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
				if (file.size > 100 * 1024 * 1024) { setHint(t("file.tooLarge")); return; }
				setMpkgMeta(null);
				if (type === "mp4" || type === "webm") {
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
			const toggleRow = (label, desc, field, def) => {
				const checked = section[field] !== void 0 ? !!section[field] : def;
				return h("div", { className: "mpw_field" }, [
					h("label", { className: "mpw_label" }, label),
					h("div", { className: "mpw_inline" }, [
						h(Toggle, { checked, onChange: (v) => commit({ [field]: v }) }),
						h("span", { className: "mpw_hint" }, desc)
					])
				]);
			};

			return h("div", { className: "mpw_row mpw_glassHost" }, [
				// ①(修正) 标题/描述在 Tab 条上方
				h("div", { className: "mpw_titleRow" }, [
					h("span", { className: "mpw_title" }, t("title")),
					h("a", { className: "mpw_repoLink", href: "https://github.com/XHR666/dsh-mpkg-wallpaper", target: "_blank", rel: "noopener" }, "dsh-mpkg-wallpaper"),
					hostVersion ? h("span", { className: "mpw_version" }, "v" + hostVersion) : null
				]),
				h("p", { className: "mpw_desc" }, t("desc")),
				// ②(修正) 圆角导航栏 + 下划线平滑移动（indicator 平移）+ 内容真滑动（translateX）
				h("div", { className: "mpw_tabBar", "data-mpw-tabbar": "" }, [
					h("div", { className: "mpw_tabIndicator", "data-mpw-tabind": "" }),
					h("button", { className: "mpw_tab" + (settingsTab === "source" ? " mpw_tabActive" : ""), type: "button", onClick: () => switchTab("source") }, t("sec.source")),
					h("button", { className: "mpw_tab" + (settingsTab === "appearance" ? " mpw_tabActive" : ""), type: "button", onClick: () => switchTab("appearance") }, t("sec.appearance")),
					h("button", { className: "mpw_tab" + (settingsTab === "unify" ? " mpw_tabActive" : ""), type: "button", onClick: () => switchTab("unify") }, t("sec.unify")),
					h("button", { className: "mpw_tab" + (settingsTab === "blur" ? " mpw_tabActive" : ""), type: "button", onClick: () => switchTab("blur") }, t("sec.blur")),
					h("button", { className: "mpw_tab" + (settingsTab === "show" ? " mpw_tabActive" : ""), type: "button", onClick: () => switchTab("show") }, t("sec.show")),
					h("button", { className: "mpw_tab" + (settingsTab === "aqua" ? " mpw_tabActive" : ""), type: "button", onClick: () => switchTab("aqua") }, t("sec.aqua")),
					h("button", { className: "mpw_tab" + (settingsTab === "other" ? " mpw_tabActive" : ""), type: "button", onClick: () => switchTab("other") }, t("sec.other")),
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

				// ①(新) 静音开关（web 壁纸声音；默认开启）
				toggleRow(t("mute"), t("mute.desc"), "mute", true),
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
										? h("img", { className: "mpw_thumbImg", src: HOST_BASE + "/custom-mpkg-preview?" + (w.folderMpkg ? "folder=" + encodeURIComponent(w.folderName) + "&" : "") + "file=" + encodeURIComponent(w.folderMpkg ? w.mpkgFile : w.name), alt: "", loading: "lazy",
											onError: (ev) => { ev.target.style.display = "none"; } })
										: ((w.type === "video" || w.converted === "mp4")
											? h("video", { className: "mpw_thumbImg", src: resolveHostUrl(w.image), muted: true, playsInline: true, preload: "metadata",
												// ①(修正) 视频封面：loadedmetadata 后 seek 到 0.05s 触发首帧绘制（部分浏览器默认不显示首帧）
												onLoadedMetadata: (ev) => { try { const v = ev.target; if (v.duration && v.duration > 0.1) v.currentTime = 0.05; } catch {} },
												onError: (ev) => { ev.target.style.display = "none"; } })
											: h("img", { className: "mpw_thumbImg", src: resolveHostUrl(w.image), alt: "", loading: "lazy",
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
											: h("img", { className: "mpw_thumbImg", src: HOST_BASE + "/library-web?ltoken=" + encodeURIComponent(wp.ltoken) + "&file=" + encodeURIComponent(String(wp.preview || "").split(/[\\/]/).pop() || "preview.jpg"), alt: "", loading: "lazy",
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
							: h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, maxHeight: 220, overflowY: "auto" } }, wallList.filter((w) => rotFilter === "all" ? true : rotFilter === "steam" ? w.src === "steam" : !w.src || w.src !== "steam").map((w) => {
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
								// ①(修正) 新建列表默认间隔用全局 rotateMin（间隔在列表选择下方单独调）
								const g = { id: rotEdit.id || ("rot" + Date.now()), name: rotEdit.name.trim() || t("rot.unnamed"), interval: Math.max(1, rotEdit.interval || (section.rotateMin > 0 ? section.rotateMin : 5)), order: rotEdit.order === "random" ? "random" : "sequence", keys };
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

				// ⑳(新) 视频倍速分段条（放在 mpkg 选择上方；点击/拖拽定位档位）
				h("div", { className: "mpw_field" }, [
					h("label", { className: "mpw_label" }, t("speed") + " · " + (section.playbackRate !== void 0 ? section.playbackRate : DEFAULT_PLAYBACK_RATE) + "x"),
					h(SpeedBar, { value: section.playbackRate !== void 0 ? section.playbackRate : DEFAULT_PLAYBACK_RATE, onChange: (v) => {
						commit({ playbackRate: v }, true);
						// ⑳(新) web 壁纸：立即把倍速应用到 iframe 内视频（不重载 iframe）
						try { applyWebSpeed(bgElements().frame); } catch {}
					} }),
					h("p", { className: "mpw_hint" }, t("speed.hint"))
				]),

				// mpkg 文件
				h("div", { className: "mpw_field" }, [
					h("div", { className: "mpw_inline" }, [
						h("button", { className: "mpw_fileBtn", type: "button", onClick: () => mpkgRef.current && mpkgRef.current.click() },
							busy ? t("mpkg.busy") : t("mpkg.pick")),
						h("span", { className: "mpw_hint" }, t("mpkg.hint"))
					]),
					h("input", { ref: mpkgRef, type: "file", accept: ".mpkg,.mp4,.webm,.mkv,.mov", style: { display: "none" }, onChange: onMpkg })
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
				// ═══ 外观 ═══
				h("div", { "data-mpw-tabkey": "appearance", style: { flex: "0 0 100%", minWidth: "100%", boxSizing: "border-box", paddingRight: "4px" } }, [
				h("div", { className: "mpw_section" }, t("sec.appearance")),
				// ②(新) 外观组说明：各项作用一目了然
				h("p", { className: "mpw_hint" }, t("sec.appearance.desc")),

				toggleRow(t("float"), t("float.desc"), "float", DEFAULT_FLOAT),
				// ①(新) 壁纸镜像翻转（Wallpaper Engine 原生基础选项）
				h("div", { className: "mpw_inline" }, [
					toggleRow(t("flipX"), t("flipX.desc"), "flipX", false),
					toggleRow(t("flipY"), t("flipY.desc"), "flipY", false)
				]),
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
				// ═══ 透出壁纸 ═══
				h("div", { "data-mpw-tabkey": "show", style: { flex: "0 0 100%", minWidth: "100%", boxSizing: "border-box", paddingRight: "4px" } }, [
				h("div", { className: "mpw_section" }, t("sec.show")),
				h("p", { className: "mpw_hint" }, t("sec.show.desc")),

				// ⑥ 侧边栏透出开关
				toggleRow(t("sidebar"), t("sidebar.desc"), "sidebar", DEFAULT_SIDEBAR),

				// ⑤ 标题栏透出壁纸（②：与侧边栏透出归一类）
				toggleRow(t("headerBg"), t("headerBg.desc"), "headerBg", DEFAULT_HEADER_BG),

				// ①(重做) 标题栏磨砂：归到「标题栏透出壁纸」下面，透出关闭时隐藏。
				// ②(修正) 不再被统一虚化接管：磨砂程度条始终可调（默认 0=透明）。
				// 开关（headerBg/headerBlur）仍独立：开关关 = 纯白背景。
				h("div", { style: { display: (section.headerBg !== void 0 ? !!section.headerBg : DEFAULT_HEADER_BG) ? "" : "none" } },
					toggleRow(t("headerBlur"), t("headerBlur.desc"), "headerBlur", DEFAULT_HEADER)),
				h("div", { style: { display: (section.headerBg !== void 0 ? !!section.headerBg : DEFAULT_HEADER_BG) && (section.headerBlur !== void 0 ? !!section.headerBlur : DEFAULT_HEADER) ? "" : "none" } },
					sliderRow(t("headerBlurAmount"), "headerBlurAmount", 0, 100, "%", 1, DEFAULT_HEADER_BLUR_AMOUNT)),

				// ①(新) 侧边栏磨砂（Aqua 方案）：与标题栏磨砂同类（区域自身玻璃化），
				// 弹窗打开时自动摘除（防弹窗被模糊层困住）；统一虚化开启时被整屏虚化接管
				toggleRow(t("sidebarBlur"), t("sidebarBlur.desc"), "sidebarBlur", DEFAULT_SIDEBAR_BLUR),
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

				// ①(新) 检测更新 / 一键热更新
				h("div", { className: "mpw_field" }, [
					h("label", { className: "mpw_label" }, t("update.title")),
					h("div", { className: "mpw_inline" }, [
						h("button", { className: "mpw_fileBtn", type: "button", onClick: checkUpdate },
							updState && updState.checking ? t("update.checking") : t("update.check")),
						updState && updState.hasUpdate
							? h("button", { className: "mpw_button", type: "button", onClick: () => {
								if (updState.releaseAt && (Date.now() - new Date(updState.releaseAt).getTime()) < 24 * 3600 * 1000) {
									setUpdConfirm(updState); // ⑩ 新版本发布<24h → 先确认
								} else { applyUpdate(); }
							} }, updState && updState.applying ? t("update.applying") : t("update.apply"))
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
					h("button", { className: "mpw_reset", type: "button", onClick: resetSettings }, t("reset"))
				]),
				hint ? h("p", { className: "mpw_hint" + (/^(解析失败|文件过大|背景素材过大|存储空间|内存不足|此壁纸的视频纹理|不支持)/.test(hint) ? " mpw_err" : "") }, hint) : null,

				// ⑩(新) 新版本确认下载弹窗（发布<24h 提示）
				updConfirm ? h(MaskPortal, { onClick: () => setUpdConfirm(null) }, [
					h("div", { className: "mpw_dialog", onClick: (ev) => ev.stopPropagation() }, [
						h("div", { className: "mpw_title" }, t("update.warnTitle")),
						h("p", { className: "mpw_desc" }, t("update.warnBody") + updConfirm.localVersion + " → " + updConfirm.remoteVersion + "）"),
						h("div", { className: "mpw_inline" }, [
							h("button", { className: "mpw_button", type: "button", onClick: () => { const d = updConfirm; setUpdConfirm(null); applyUpdate(); } }, t("update.confirmDownload")),
							h("button", { className: "mpw_reset", type: "button", onClick: () => setUpdConfirm(null) }, t("conflict.cancel"))
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
			"sec.unify.desc": "整屏所有控件的模糊感由一组设置统一管理（一个条全管侧边栏/标题栏/聊天区）；开启后「界面虚化」里的侧边栏磨砂被接管（标题栏不再接管，按自己的磨砂条）。关闭则各区域单独调节",
			"sec.show": "透出壁纸",
			"sec.show.desc": "控制对应区域是否显示壁纸：关=纯色不透明",
			"sec.other": "其他",
			"backup.title": "备份与恢复",
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
			"update.checking": "检测中…",
			"update.apply": "一键更新",
			"update.applying": "更新中…",
			"update.found": "发现新版本：",
			"update.latest": "已是最新版本",
			"update.diff": "本地与 GitHub 代码存在内容差异（版本号相同，可能是本地有未推送的改动）——推送后即一致",
			"update.applied": "更新完成！请重启 dsh web 并 Ctrl+F5 生效",
			"update.fail": "检查失败：",
			"update.warnTitle": "新版本发布未满 24 小时",
			"update.warnBody": "新版本发布未满24h 可能存在未修复的bug，确认下载吗？（版本 ",
			"update.confirmDownload": "确认下载",
			"roundCompat.desc": "给其他插件注入界面的矩形容器补圆角（不覆盖插件自己的样式）；如与某插件冲突可关闭",
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
			"file.tooLarge": "文件超过 50MB，请换一张或使用链接。",
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
			"default": "默认",
		};
		const en = {
			"nav": "MPKG Wallpaper",
			"master": "Enable mpkg background",
			"clear.bg": "Clear background",
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
			"sec.unify.desc": "One set of controls rules the frosted feel of every surface (sidebar/titlebar/chat via one slider); when on, sidebar frost below is taken over (the title bar is not taken over - it follows its own frost slider). Off = each area adjusts separately",
			"sec.show": "Show wallpaper",
			"sec.show.desc": "Whether the corresponding area shows the wallpaper: off = solid color, opaque",
			"sec.other": "Other",
			"backup.title": "Backup & Restore",
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
			"update.checking": "Checking…",
			"update.apply": "Update now",
			"update.applying": "Updating…",
			"update.found": "New version found: ",
			"update.latest": "Already up to date",
			"update.diff": "Local code differs from GitHub (same version — probably un-pushed local changes); push to align",
			"update.applied": "Update done! Restart dsh web and Ctrl+F5",
			"update.fail": "Check failed: ",
			"update.warnTitle": "New version released <24h ago",
			"update.warnBody": "This version was published less than 24h ago and may contain unfixed bugs. Download anyway? (v",
			"update.confirmDownload": "Download",
			"roundCompat.desc": "Adds border-radius to rectangular containers injected by other plugins (does not override their own styles); turn off if it conflicts",
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
			"file.tooLarge": "File exceeds 50MB — pick another or use a URL.",
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
			if (!styleEl) {
				styleEl = document.createElement("style");
				styleEl.setAttribute("data-plugin", "@local/dsh-mpkg-wallpaper");
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
					if (hasDlg) document.body.setAttribute("data-mpw-sblur-off", "");
					else document.body.removeAttribute("data-mpw-sblur-off");
				} catch {}
			};
			try {
				sblurObserver = new MutationObserver(check);
				sblurObserver.observe(document.body, { childList: true, subtree: true });
			} catch { sblurObserver = null; }
			check();
		}

		// ⑲(修正) Aqua 主题切换监听：深色/浅色切换时重算遮罩色与自适应文字色
		//（用户实测：aquaInk 开时切换主题，文字色卡在旧主题——黑字黑底/白字白底看不清）。
		let aquaThemeWatch = null;
		function setupAquaThemeWatch() {
			if (aquaThemeWatch !== null) return;
			const onTheme = () => {
				try {
					refreshAqua();
					const s = readSection();
					if (aquaOn(s)) applyTokenOverrides(pluginCtx, s);
				} catch {}
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
			// 网页壁纸（webUrl）不随刷新自动重启——重 iframe 动画可能在加载时卡死
			// 界面（用户实测：刷新/重启 dsh 后仍崩 → webUrl 持久化导致每次加载都重启重壁纸）。
			// 刷新后网页壁纸需重新点「使用」；图片/视频壁纸照常自动恢复。
			try {
				const bootS = readSection();
				if (bootS && bootS.webUrl) {
					writeSection(Object.assign({}, bootS, { webUrl: undefined }), true);
				}
			} catch {}
			try { applyFromStorage(); } catch (err) { console.warn("[dsh-mpkg-wallpaper] boot 应用背景失败:", err); }
			// ⑤(新) 宿主端设置持久化：异步拉取 host /settings（优先于 localStorage），
			// 拉到后重应用（配置跨端口/清浏览器数据不丢；host 不可用时回退 localStorage）。
			try { initHostSettings(); } catch {}
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
