// bench-patch.js — :8901 测试台（WebWallGL 静态构建产物）的运行期补丁
//
// ①(用户第 6 项 2026-09-19) **原生 `<select>` → 自绘下拉**：工具条那 6 个下拉（语言/分辨率/fit/DPR/FPS/滤镜）与
//   上游产物渲染的"壁纸配置"面板里的 combo，全部换成同一个实现（`./mpw-select.js`，8899 渲染器页也在用）。
//   做法与 8899 那边同构：**增强而不是替换**（原生 select 留在 DOM 里当值容器 ⇒ 上游 bundle 读 `.value`、
//   监听 `change` 的既有链路一行不改），并在控件进 DOM 之后才增强（`enhanceSelect()` 要往父节点插控件）。
//
// 为什么存在：本机/离线环境装不上依赖（`pnpm install --offline` 缺 mediabunny，
// 见 ww-pages/PATCH-NOTES.md §0），无法 `vite build` 重新出包，所以行为改动集中在
// **这一个** 文件里，由 index.html 末尾以 `type="module"` 引入。它**不改 minified 产物**
// （只被动读 DOM / 读写 #resolution 的 value 并派发 change，沿用 bundle 既有链路）。
//
// 纯函数（Node 可直接 import 测试，见同目录 bench-patch.test.mjs）：
//   makeT / buildValueIndex / translateRendered / collectSlots / sweepRendered
//   hasResidualLang / applyTitle / applyStaticI18n / diagOfflineState / trailPointAt
//   第五批：readPatchFlags / pointerParkAction / ownTextOf / timeLayerPlan /
//           brandingFromProject / sniffItemId / dragPropsToDisable / mediaBrandPlan
//   第八批：appBrandPlan / applySiteBrand（站点品牌运行期覆盖，见文末「第八批」段）
//   第九批：openUrlPlan / installOpenRemap（「新窗口」按钮的 window.open 前缀改写，P-129）
//   第十批：bandFeedMode / bandFeedLabel / bandFeedUrl / bandFeedStatusPlan（「音条源」四档 =
//           `?bandfeed=auto|mic|sim|off` 的档位归一 / URL 拼接 / 状态行文案；判据见
//           ../docs/USER-ITEMS-20260920-B.md §5.3 与 tests/bench-bandfeed-switch-test.mjs）
// 浏览器初始化只在 `typeof document !== 'undefined'` 时执行。
//
// 第五批开关（写 0/false/off/no 即回退到上游原行为；默认全开）：
//   ?ppark=0      鼠标移出舞台/视口后**什么都不做**（连 pointerLeave 都不发；彻底回到"上游原行为"）
//   ?ppark=center 显式要求"归中"：移出后发 pointerLeave **并把活指针推到画面正中**（旧默认行为，逃生口）
//                 ⚠ 默认（不写）= 只发 pointerLeave、**保留最后位置**：推一个正中活坐标会把尾迹/涡流/视差的
//                   力中心拽到画面中心再消失（真机 bug）；上游 pointer.js `pushExternalLeave` 的语义就是"只清按键" 
//   ?clocklock=0  **不**给注入到页面里的 DOM 时间层加 pointer-events:none/不可拖拽
//   ?clockdrag=0  **不**关闭壁纸自带的「可拖动」布尔用户属性
//   ?brand=0      **不**把媒体组件的名称/图标换成壁纸自己的 project.json title/preview
//
// ⚠ 重建纪律：本文件里 ③④（i18n 全量切换、诊断离线态）已在源码 bench/i18n.ts + bench/bench.ts
//   里用正规写法实现，**重建后可删对应 init 段**；②（自绘紧凑下拉）与 ⑨（鼠标尾迹）尚未回写
//   源码（产物版无 TS 编译校验，直接改 TS 有不可验证风险），搬迁清单见 PATCH-NOTES.md §2/§4。
//
// 第六批（**P-96 在线 demo**，见 we-scene-demo/PATCHES.md P-96 与 docs/ONLINE-DEMO.md）：
//   本文件现在是**唯一真源**（物理文件在 we-scene-demo/demo/，两条软链指过来）：
//     vendor-ref/ww-pages/WEwebLoader/bench-patch.js              → 真源（P-127 站点路径改名后的新名）
//     vendor-ref/ww-pages/wallpaper-engine-webgl/bench-patch.js   → 同上（旧名软链，**有意保留**，见 P-127.4）
//     vendor-ref 下的 webwallgl 检出里的 bench-patch.js            → 上一条（链式）
//   ① 线上形态判定 onlineDemoEnv()：GitHub Pages 这类"设计上就没有本机后端"的部署换一套文案；
//   ② 产物里写死的绝对前缀（旧名 `/wallpaper-engine-webgl/`，P-127 起新名 `/WEwebLoader/` 同样认）
//      在运行期改写成相对本页（iframe src / SW 脚本）；
//   ③ 默认壁纸 = 本仓库自造的合成样例 samples/sample-synthetic/scene.pkg（`?sample=0` 关、`?sample=<url>` 换）；
//   ④ 页面上把"在线版没有本机后端"写清楚（静态横幅 + 运行期同源同义文案）。
//   开关：?online=0 强制本机口径；?sample=0 不自动载入合成样例。
//   ⚠ 将来产物能重建时，①②③④ 都应回写源码 bench/ 再删掉本文件对应段。
//
// 第八批（**2026-09-18 用户改名**：产品名 WebWallGL → **WEwebLoader**，大小写严格）：
//   用户看得见的品牌位改在**运行期呈现层**：测试台头部品牌名（`#site-brand` 里那个 `data-i18n="app.title"`）
//   与 `document.title` 显示 `WEwebLoader`；版本号 `#app-version`（产物写的 `v1.3.16`）照旧跟在后面。
//   回退口：`?appname=upstream`（或 `?brand=upstream`）⇒ 还原上游名 `wallpaper-engine-webgl`。
//   **刻意不碰**三处被钉住的静态值：`index.html` 的 `<title>` 与 `data-i18n="app.title"` 兜底文本
//   （门禁 T8）、DICT 的 `app.title`（T1：词典必须逐条等于上游 bench/i18n.ts）、`assets/*.js`
//   （许可口径：minified 产物一个字节都不改）。上游归属位（设置弹层 credit、两份 LICENSE-webwallgl、
//   许可区说明）一律原样保留。
//
// 第九批（**P-129 2026-09-19**：线上点工具栏「新窗口」⇒ 404）：
//   产物里唯一**没被** ①-a 那条路覆盖的硬编码绝对旧路径 —— `#open` 的处理器
//   `l("#open").onclick=()=>{w&&window.open(`/wallpaper-engine-webgl/renderer/index.html?${wt(w)}`,"_blank")}`。
//   同一段产物里 `/…/renderer/index.html` 共 3 处，其中 **2 处**是 iframe 的 `k.src=`（①-a 的
//   `HTMLIFrameElement.prototype.src` 包装拦得到），第 3 处就是这个 `window.open`（那条包装**永远**拦不到）。
//   改法：**包 `window.open`**（产物一个字节不改），与 iframe 同一套口径 —— 同一个真源别名表
//   `SITE_PATH_ALIASES` + 同一份 `demoAssetUrl` 改写 + 同一个"只在线上形态改写"守卫；
//   只动指向本站旧/新前缀的 URL，其余（外链 / `blob:` / `data:` / `about:blank` / 相对路径 / 空串）
//   原样透传，`target`/`features` **三参 + 参数个数**照传（装不上就静默跳过，绝不把按钮弄坏）。
//   回退口：`?openrewrite=off` ⇒ 一个字都不改（回到上游原行为 = 打开那条绝对旧路径）。

/* ============================ 词典（由 bench/i18n.ts 机械生成，勿手改） ============================ */
// 生成方式：node -e "…解析 bench/i18n.ts 的 DICT…"（见 PATCH-NOTES.md §3）；bench-patch.test.mjs
// 的 T1 会把本块与源码 DICT 逐键比对，任何漂移都会红。
// ①(用户第 6 项 2026-09-19) 自绘下拉（与 8899 渲染器页**同一个实现**）：增强而不是替换，
//   原生 select 留在 DOM 里当值容器 ⇒ 上游 bundle 读 `.value` / 监听 `change` 的链路一行不改。
import { enhanceSelect, layerFixedOffset, scrollAffectsAnchor } from './mpw-select.js'

export const DICT = {"zh":{"app.title":"wallpaper-engine-webgl","picker.title":"自定义颜色","picker.hex":"十六进制","picker.hint":"拖动色相条与面板，或直接输入 #rrggbb","picker.ok":"确定","picker.cancel":"取消","copy.logs":"复制输出","copy.url":"复制链接","copy.ok":"已复制到剪贴板","copy.manual":"剪贴板不可用（file:// 或未授权）：请手动复制下面选中的文本","copy.fail":"复制失败：{msg}","error.title":"页面脚本出错（已兜底）","error.dismiss":"关闭","error.logged":"详情已写入输出区","fs.enter":"全屏","fs.enterTitle":"全屏预览（退出按钮在全屏内右上角）","fs.exit":"退出全屏","fs.exitTitle":"退出全屏（也可按 Esc）","fs.unsupported":"当前浏览器不支持全屏 API","local.pickTitle":"选择本地壁纸文件夹（纯前端读取，文件不离开浏览器）","local.unsupported":"当前浏览器不支持目录选择（webkitdirectory / showDirectoryPicker）—— 无法加载本地壁纸，请改用桌面版 Chrome / Edge / Firefox","local.reading":"正在读取文件夹…","local.none":"该文件夹里没有找到壁纸（壁纸目录需要 scene.pkg 或 project.json）","local.count":"本地文件夹：{n} 个壁纸","local.sceneOnly":"静态托管下仅支持 scene 包预览（web/video 需本机 Node 后端）","local.preview":"本地预览：{name}","local.clear":"清空","local.clearTitle":"清空本地库与当前选择","local.cleared":"已清空本地库与选择","local.notDir":"这不是文件夹选择：浏览器只回传了一个文件。请点「选择文件夹」并选择目录（不要选单个文件）","local.kindTitle":"扫描时自动识别的类型：{k}","btn.pickFile":"选择文件","pick.dirTitle":"浏览文件夹","pick.fileTitle":"浏览文件","pick.curDir":"当前目录","pick.up":"上一级","pick.home":"回到最上层","pick.here":"就选这个文件夹","pick.thisFile":"就选这个文件","pick.empty":"这里没有子文件夹","pick.noFile":"这里没有符合条件的文件","pick.filterPh":"筛选名称","pick.grant":"打开系统选择器","pick.needGrant":"浏览器安全限制：网页必须先由你在系统对话框里授权一个文件夹，之后才能在这里浏览（文件不离开浏览器）","pick.readNote":"纯前端读取：目录与文件都来自你授权的那棵树，不上传、不离开浏览器","pick.granted":"已授权：{name}（{n} 个文件 / {d} 个目录）","pick.cancelled":"已取消选择","pick.count":"{n} 项","local.grantScan":"从选择器载入：{name}","local.filePicked":"已选择文件：{name}","docs.readmeTitle":"本页 README · 使用说明速查","status.dpr":"DPR（设备像素比） {n}","status.dprTitle":"窗口 devicePixelRatio —— 影响渲染分辨率与性能","offline.tag":"离线","offline.diagReason":"静态托管无 /diag 后端：渲染器诊断流不可用（需本地 Node host 或 pnpm dev）","offline.diagTitle":"诊断流不可用（静态托管）","backend.node":"本机 Node 后端已连接","backend.static":"静态托管（无 /api 后端）","backend.staticTitle":"静态托管：本页由静态服务器提供，/api/* 与 /diag 全部 404 —— 壁纸库列表、属性保存、删除、打开所在文件夹、渲染器诊断流都不可用","backend.needBackend":"需要本机 Node 后端（静态托管下不可用）","backend.alt":"可用替代：点「选择文件夹」做纯前端扫描（scene 包可直接预览，文件不离开浏览器）","backend.online":"上线方法：在 WEwebLoader 源码目录运行 pnpm dev，打开它打印的地址（默认 http://localhost:1430/）—— 那是带 Node host 的完整测试台","backend.offline":"当前浏览器离线（navigator.onLine=false）：本页功能不依赖网络，缺的是本机 Node 后端","backend.blocked":"本机暂时无法启动 Node host：离线环境下依赖不全（pnpm install --offline 报 ERR_PNPM_NO_OFFLINE_TARBALL）","res.pick":"选择分辨率","res.native":"（弹层列表限高可滚动）","trail.on":"鼠标尾迹","trail.needInjection":"需先开启「指针注入」","trail.len":"长度","trail.width":"粗细","trail.color":"颜色","trail.tip":"仅在开启「指针注入」后可用：尾迹取自注入遮罩的坐标，不接管真实鼠标事件","act.explorer":"资源管理器","act.docs":"使用说明","theme.auto":"主题：跟随系统","theme.dark":"主题：深色","theme.light":"主题：浅色","lang.title":"切换语言","backend.demoNoBackend":"在线演示版（GitHub Pages）没有本机 Node 后端 —— 这不是故障，是**设计如此**：线上只有静态文件，/api/* 与 /diag 一律 404。完整测试台（壁纸库列表 / 属性保存 / 删除 / 诊断流）需要在源码目录跑 pnpm dev。","demo.onlineTitle":"在线演示版","demo.onlineBody":"本页是**在线静态演示**：没有本机 Node 后端，壁纸库列表 / 属性保存 / 删除 / 打开所在文件夹 / 渲染器诊断流（/api/* 与 /diag）在线上全部不可用 —— 这不是故障，是纯静态托管的必然结果。「选择文件夹」纯前端扫描仍然可用，默认载入的是本仓库自造的**合成样例**（不含任何真实壁纸）。","demo.onlineSample":"默认壁纸：合成样例 scene.pkg（由 tools/make-sample.mjs 生成，33 299 B，无第三方内容）—— 本仓库**不分发**任何真实壁纸包。","offline.diagReasonOnline":"在线演示版没有 /diag 后端：线上是纯静态托管，渲染器诊断流不可用（这是设计如此，不是断线）","demo.sampleMissing":"合成样例载入失败：{msg}","demo.sampleLoaded":"已载入合成样例：{name}（本仓库自造，无第三方内容）","credit.title":"渲染核心原作者","credit.link":"WebWallGL · oneincase（MIT 许可）","brand.generic":"壁纸","static.notice":"在线静态版：壁纸库列表 / 属性保存 / 删除 / 诊断流需要本机后端；可用「选择文件夹」纯前端扫描本地壁纸（scene 包可预览），完整功能请在源码目录运行 pnpm dev。","static.libPath":"静态托管 · 无本机后端","static.pickTitle":"静态托管下不可用 —— 请在本地运行（pnpm dev）","log.filePreview":"本地预览：{name}","err.filePreview":"本地预览失败：{msg}","sidebar.title":"资源管理器","sidebar.libCount":"壁纸库","sidebar.pickLib":"选择文件夹（也可继续用 WE_LIBRARY）","btn.pickLib":"选择文件夹","ph.filter":"过滤标题 / itemId","ph.propsFilter":"过滤属性名 / 文案","reveal.open":"打开所在文件夹","ctx.delete":"删除壁纸","confirm.delete":"确定删除壁纸「{title}」吗？整个目录将移入废纸篓（{id}）。","ok.delete":"已删除：{id}","err.delete":"删除失败：{msg}","tab.wallpaper":"未选择壁纸","toolbar.resolution":"分辨率","toolbar.resolutionTip":"舞台逻辑分辨率（iframe 视口）","toolbar.volume":"音量","toolbar.live":"系统实况","toolbar.liveTip":"歌名/进度：Node 读 media-control；音频条：麦克风（无系统声卡环回）。换壁纸或勾选后会重挂载","toolbar.mic":"启用麦克风","toolbar.micTip":"默认关：关着时页面一次都不会请求麦克风（getUserMedia 不调用），「系统实况」只保留歌名与进度；开着时才在壁纸/功能声明需要时请求，不在页面加载时预请求","dbg.switch":"开启调试模式","dbg.switchTip":"逐层查看（左右键）+ 隔离图层；只在调试视图打开期间接管键盘，Alt 退出","logs.cleared":"已清空（{view}）","log.micOn":"已启用麦克风：壁纸/功能声明需要时才会请求（不再有页面加载时的预请求）","log.micOff":"已关闭麦克风：不再发出任何 mic 请求","log.micNeeded":"「系统实况」的麦克风部分需要先勾「启用麦克风」—— 现在只保留歌名/进度","toolbar.pointerPush":"指针注入","toolbar.pointerPushTip":"模拟桌面壁纸窗口：遮罩挡住原生鼠标事件，坐标改经 __wp.pushPointer 推送 —— 与宿主对接的是同一条通道","toolbar.pause":"暂停","toolbar.resume":"恢复","toolbar.reload":"重挂载","toolbar.release":"释放","toolbar.open":"新窗口","toolbar.props":"壁纸配置","toolbar.filter":"滤镜","toolbar.filterTip":"滤镜（beta）：以 CSS filter 应用到渲染输出","toolbar.introSkip":"去除开屏动画","toolbar.introSkipTip":"跳过壁纸的开屏动画（开头那段放大 / 运镜），直接从开屏之后开始播放（渲染器档位 ?skipintro=1）","toolbar.webMode":"Web 渲染","toolbar.webModeTip":"Web 壁纸的执行方式：沙箱 = 隔离作用域（更安全，个别壁纸跑不起来）；兼容 = 同页直跑（兼容性最好）。换档重挂载渲染器（?webmode=）","webMode.sandbox":"沙箱","webMode.compat":"兼容","webMode.auto":"自动","toolbar.hybrid":"流式播放","toolbar.hybridTip":"DSH 进程流式播放（hybrid）：边取边播，不等整包落盘；关掉则先取完整包再播（渲染器档位 ?hybrid=）。默认开","toolbar.parallax":"视差","toolbar.parallaxTip":"视差（相机层 + 对象级 parallaxDepth）—— 渲染器档位 ?parallax=：勾上 = 层跟鼠标位移（官方公式，写 ?parallax=1）；取消 = 层不跟鼠标（写 ?parallax=0，截图 / 验收要固定位置时用）。另两个 A/B 档由本页 URL 走：?parallax=legacy（旧 lwe 近似式）/ ?parallax=official（与 1 同义），URL 值优先于勾选态。缺省「勾上」：测试台是作者本意的预览面","toolbar.layerSwitch":"图层开关","toolbar.layerSwitchTip":"取消勾选 = 该层不参与渲染（逐层排查用）；隐藏集写进本页 URL 的 ?hide=，重挂载/带参打开都会恢复。只在「本仓渲染器」档生效","layers.all":"全选","layers.none":"全不选","layers.onlyCurrent":"只留当前层","layers.keepCurrentTip":"把调试模式当前正看的这一层之外全部取消勾选（先在调试模式里翻层）","layers.needDebug":"没有「当前层」：先在调试模式里左右翻层，这里才可用","layers.copyState":"复制当前状态","layers.reset":"恢复默认","layers.resetTip":"回到**壁纸文件默认态**（本仓唯一口径：默认勾选 = 文件语义：scene.json 里 visible 的层勾上、visible:false 的不勾）：清空用户取消勾选与「强制显示」，并删掉 URL 里的 ?hide= ⇒ 刷新页面得到同一张图","log.lswReset":"图层开关：恢复默认 —— 回到壁纸文件默认态（勾选 {n}/{m} 层；隐藏集与强制显示已清空，?hide= 已从 URL 删除）","layers.hiddenCount":"隐藏 {n}/{m} 层","layers.container":"容器层：只承载父子链/定位，不参与绘制（不可隐藏）","layers.keepRow":"只留","layers.keepOne":"只留这一层（= 只勾选它，其余取消勾选）","layers.disabledUpstream":"上游产物档不认 __lnHidden（逐层隐藏只在「本仓渲染器」档生效）—— 把「渲染器」切到「本仓渲染器」后可用","layers.disabledNoMount":"还没有挂载壁纸（没有 __sceneLayers 可列）：先从左侧选一张壁纸","layers.dbgDeferred":"调试隔离生效中：勾选改动已记录，退出调试模式后生效","layers.fileHidden":"这一层在 scene.json 里是 visible:false（当前不参与渲染）：勾上 = 强制显示它","layers.forced":"已强制显示：文件里 visible:false，勾选覆盖了它（取消勾选 = 回到文件状态）","layers.noSource":"不可显示：这一层没有可绘制的源（音频/音效层、纯数据层）—— 勾选也不会让画面出现它","layers.allTip":"全部勾上：含文件里 visible:false 的层（= 强制显示它们）","log.lswForceShow":"图层开关：强制显示 #{n} {name}（文件里 visible:false）","log.lswKeepOnly":"图层开关：只留 #{n} {name}（其余取消勾选）","log.lswCopied":"已复制当前状态（可直接贴给别人复现）：{text}","log.lswRematch":"图层开关：壁纸重挂载 —— 按「下标+层名」对账，保留 {n} 层隐藏、放弃 {m} 层（下标/层名对不上）","bar.collapseTip":"收起参数栏（只收第 1~3 行的参数，动作按钮与档位保持可用）","bar.expandTip":"展开参数栏","webProbe.heavy":"重动画","webProbe.external":"需外网","webProbe.badge":"预检：{flags}","log.webProbeOk":"预检（Web 壁纸）：{id} 无风险标记","log.webProbeWarn":"预检（Web 壁纸）：{id} {flags} —— {reasons}","filter.none":"无","filter.blur":"高斯模糊","filter.grayscale":"黑白","filter.sepia":"怀旧","filter.vivid":"鲜艳","filter.warm":"暖色","filter.cool":"冷色","filter.invert":"反色","filter.brighten":"提亮","filter.darken":"压暗","filter.contrast":"高对比","res.fit":"自适应 16:9","stage.empty":"从左侧选择一个壁纸开始渲染","logs.head":"输出","logs.diag":"渲染器诊断（/diag）","logs.clear":"清空","logs.collapse":"折叠输出","logs.expand":"展开输出","bar.collapse":"收起参数栏","bar.expand":"展开参数栏","bar.hintOn":"分辨率 / 滤镜 / 帧率等；收起后只留这一行","bar.hintOff":"参数栏已收起（点左侧按钮展开）","status.adaptive":"自适应 16:9","status.cap":"上限 {n}","status.uncapped":"无上限","fps.uncapped":"无上限","fps.uncappedTitle":"不加帧率上限（按显示器刷新率出帧）","status.capTitle":"帧率上限（工具条 FPS）","status.liveTitle":"壁纸实测帧率（渲染循环最近 500ms）","status.items":"{n} 项","props.title":"壁纸配置","props.weGroup":"渲染器设置（WE 自带）","props.we.flipH":"水平翻转","props.we.colorOptions":"显示颜色选项（总开关）","props.we.brightness":"亮度","props.we.contrast":"对比度","props.we.saturation":"饱和度","props.we.hue":"色调偏移","props.we.playbackRate":"播放速度","props.we.volume":"音量","props.we.flipV":"垂直翻转","props.we.alignment":"对齐方式 / 缩放","props.we.parallaxReaction":"对动作做出反应（视差 / 陀螺仪）","props.we.recording":"录音（WE 录屏 / 录音音量）","props.we.perMonitor":"按显示器（每屏各自设置）","props.we.status.other":"本页已实现（在别处）","props.we.status.no":"未实现","props.we.status.we":"WE 自带","props.we.why.flipV":"本仓渲染器没有 `flipV`（`__wp.setDisplay` 只有 `flipH`）⇒ 不做；要垂直镜像得宿主自己写 CSS `scaleY(-1)`。","props.we.why.alignment":"本页已实现，落点在工具条「适应方式」（`#fit` / `?fit=`），不在渲染器 API 上。","props.we.why.parallaxReaction":"用户口径不做（本机没有陀螺仪）；将来若做走既有的 `__wp.pushPointer(x,y)`。","props.we.why.recording":"Wallpaper Engine 客户端自带（录屏 / 录音音量），页面内没有实现面。","props.we.why.perMonitor":"WE 客户端自带（壁纸与音量按显示器分别保存）；本页是单实例预览，没有这个概念。","props.we.notReady":"渲染器还没发布 `__wp`（换壁纸 / 重挂载期间会短暂如此）：这一组会在渲染器就绪后自动可用，控件先置灰。","props.we.legacy":"渲染器当前跑在 `?display=legacy` 总回退档：显示选项整组被忽略（`__wp.setDisplay` 只读）⇒ 控件已置灰。","props.we.hint":"这几项每一张壁纸都有（WE 自带），直接驱动渲染器 API、改完立刻生效；壁纸自己的可调项在下面。","props.imgDedup":"图片去重","props.imgDedupOnce":"一次（整面板）","props.imgDedupRow":"每行一次","props.imgDedupAll":"全部（不去重）","props.imgDedupNote":"已压掉 {n} 张重复图","props.imgDedupForced":"本次由 URL 档 {flag} 决定","props.imgDedupTip":"同一张画面只画一次（强制）：① 逐字节相同的 URL 只画一遍；② 只差尺寸/格式/水印类参数与后缀（wx_fmt、bo、rf、@100w、800x600、_!web-…、x-oss-process=…）或 http/https、www. 前缀的，算同一张画面 ⇒ 无条件归并（不再要求载入尺寸一致）；③ 面板里两个来源（渲染器自己解析出的图 + 属性文案里的图）共用同一本账；④ 已经画成图的那条链接、以及被压掉后变成空壳的链接都不再单独显示。「全部」= 完全不去重（对照/排障）；「每行一次」= 只在单行内去重。带 ?propimg= 的链接优先","props.imgDedupLog":"图片去重档：{mode}","props.imgDedupForcedNote":"（其中 {m} 张是靠「同一张画面」的身份键**强制归并**的：尺寸不同 {diff} 张 / 尺寸未知 {unk} 张 —— 已按用户口径「只显示一次」）","props.imgDedupForcedLog":"（URL 参数 {flag} 优先：这次改面板开关只记下偏好，要去掉 URL 参数才由它生效）","wpset.done":"已实现","props.reset":"恢复默认","props.collapse":"收起","props.showHidden":"显示条件隐藏项","props.reading":"读取中…","props.none":"该壁纸未声明可自定义项","props.count":"{n} 项","props.countOverridden":"{n} 项（{m} 项已改）","props.readFail":"读取失败：{msg}","props.saving":"保存中…","props.savedOverridden":"已保存（{n} 项已改）","props.savedAll":"已保存（全部默认）","props.saveFail":"保存失败：{msg}","props.pending":"待保存…","props.logSaved":"属性保存：{id} {n} 项覆盖","props.empty":"project.json 未声明 general.properties，无可自定义项。","props.noMatch":"无匹配属性","props.allHidden":"全部属性都被 condition 隐藏（可勾选上方开关查看）","props.filePh":"相对壁纸根的路径（{kind}）","props.dirPh":"目录绝对路径","props.pickFile":"选择文件…","props.pickDir":"选择目录…","props.fileUnset":"未设置","props.fileUploading":"正在导入…","err.wpNotReady":"__wp 尚未就绪（先选一个壁纸并等页面加载完）","err.diagStream":"诊断流断开（dev server 重启？）","err.pickLib":"选择文件夹失败：{msg}","err.pickFile":"选择文件失败：{msg}","err.pickDir":"选择目录失败：{msg}","err.reveal":"打开文件夹失败：{msg}","err.selectFirst":"先选一个壁纸再打开自定义配置","ok.reveal":"已打开文件夹：{id}","log.libLoaded":"壁纸库载入：{n} 项（scene {s} / web {w} / video {v}）","log.mount":"挂载 {id}：?{q}","log.liveOn":"已开启系统实况（麦克风频谱 + Music/Spotify + 前台窗口）","log.liveOff":"已关闭系统实况，恢复模拟源","log.pointerPushOn":"已开启指针注入：遮罩屏蔽原生鼠标事件，坐标改经 __wp.pushPointer 推送（模拟桌面壁纸窗口）","log.pointerPushOff":"已关闭指针注入，恢复原生鼠标事件","prompt.libDir":"壁纸库目录","nav.console":"控制台","nav.docs":"说明","nav.wpset":"对应API","nav.settings":"设置","nav.settingsTip":"语言 / 主题 / 归属与许可","nav.lang":"语言","nav.theme":"主题","nav.backend":"后台","nav.backendUnknown":"未知","nav.backendNote":"静态托管（GitHub Pages）没有本机 Node 后端：壁纸库列表 / 属性保存 / 删除 / 诊断流在线上不可用 —— 这是设计如此，不是故障；「选择文件夹」纯前端扫描仍可用。","wp.add":"＋","wp.addTitle":"添加 / 切换壁纸：打开左侧列表并过滤掉当前壁纸","logs.expandTip":"展开输出（控制台）","logs.collapseTip":"收起输出（控制台）","props.emptyState":"还没有选择壁纸","props.emptyHint":"从左侧「选择壁纸」里点一张，这里就会显示它 project.json 声明的可调项。",
"libsrc.default":"库来源：本机默认目录（服务端内置，你还没有选择）","libsrc.default.hint":"这个目录是服务端启动时的默认值，不代表你已经选过；点「选择文件夹」在应用内浏览并指定一个目录","libsrc.default.path":"（默认库目录不可用）",
"libsrc.user":"库来源：你选择的目录","libsrc.user.hint":"由你通过「选择文件夹」指定（服务端 /api/library-dir 已接受并落库）","libsrc.user.path":"（已选目录为空）",
"libsrc.empty":"库来源：空（服务端没有返回库目录）","libsrc.empty.hint":"服务端返回的库目录为空；点「选择文件夹」选一个装壁纸的目录","libsrc.empty.path":"（空）",
"libsrc.none":"库来源：不可用（静态托管 / 无本机后端）","libsrc.none.hint":"静态托管没有 /api/*：壁纸库列表与诊断流不可用；「选择文件夹」的纯前端扫描仍可用","libsrc.none.path":"（无后端）",
"wp.pinned":"已选 / 常用","wp.lib":"壁纸库","wp.libOpen":"展开壁纸库列表","wp.libClose":"收起壁纸库列表",
"wp.pin":"固定到「已选」","wp.unpin":"从「已选」移除","wp.pinnedCount":"已选 {n} 项","wp.libCount":"库 {n} 项",
"wp.libEmpty":"壁纸库为空：先选一个库目录，或用左侧「选择文件夹」纯前端扫描","wp.switchHint":"点标签切换壁纸；★ = 固定 / 取消固定",
"wp.close":"关闭壁纸标签","wp.closeTip":"关闭这个壁纸（卸掉标签；关的是当前项就回落到相邻项）","wp.closed":"已关闭壁纸标签：{id}","wp.closedFallback":"已关闭当前壁纸 {id} ⇒ 回落到 {next}","wp.closedRelease":"已关闭当前壁纸 {id}，没有其它打开项 ⇒ 释放舞台","wp.type.all":"全部","wp.type.scene":"场景","wp.type.web":"Web","wp.type.video":"视频","wp.typeTitle":"壁纸类型过滤（场景 / Web / 视频由产物自己的类型开关驱动，「全部」由本补丁合并三档）",
"diag.empty":"（还没有渲染器诊断消息：选中一张壁纸后，渲染器会把挂载日志发到 /diag ⇒ 这里出现）","diag.count":"{n} 条","diag.tabTitle":"渲染器诊断流（/api/diag-stream，含渲染器经 /diag 上报的消息）","diag.lost":"诊断流断开：{msg}","diag.wait":"正在连接 /api/diag-stream…",
"logs.tabLogs":"输出","logs.tabDiag":"渲染器诊断（/diag）","logs.tabHint":"切换「输出」/「渲染器诊断流」","logs.debug":"调试模式","logs.debugOn":"调试模式·ON","logs.debugOff":"调试模式·OFF","logs.tabDebugHint":"调试模式：左右键逐层查看 + 立即上报 + 截图",
"dbg.report":"立即上报","dbg.reportTip":"把当前诊断内容立即上报（优先 /report，退 /baseline，再退 /diag）","dbg.shot":"截图","dbg.shotTip":"把预览画布截成 JPEG 下载","dbg.reporting":"正在上报…","dbg.reported":"已上报：{where}（{bytes} B）","dbg.reportFail":"上报失败：{msg}","dbg.shotOk":"已保存截图：{name}（{kb} KB）","dbg.shotFail":"截图失败：{why}","dbg.on":"调试模式：开（左右键逐层查看；Alt 退出）","dbg.off":"调试模式：关","dbg.layerNone":"没有可逐层查看的场景","dbg.layerLine":"图层 {i}/{n} · {name}","dbg.noScene":"当前没有场景图层（未挂载 / 加载失败）",
"pickd.title":"选择壁纸库目录（应用内浏览）","pickd.note":"服务端只读浏览：路径不会越出服务端给出的根",
"pickd.noRoute":"服务端还没有 /api/fs/* 这条路由（GET /api/fs/roots 返回 404）⇒ 应用内浏览不可用；请用下面的兜底按钮",
"pickd.noBackend":"静态托管没有本机后端 ⇒ 应用内浏览不可用；用「纯前端扫描」选目录（文件不离开浏览器）",
"pickd.here":"就选这个目录","pickd.up":"上一级","pickd.roots":"快捷根","pickd.loading":"读取中…","pickd.empty":"（这个目录没有子目录）",
"pickd.selected":"已选择：{path}","pickd.applying":"正在切换库目录…","pickd.done":"库目录已切换：{path}（重新载入中…）","pickd.fail":"切换失败：{msg}","pickd.relisted":"已重新拉取壁纸库列表（{n} 项）","log.listRefreshDone":"换库后重画侧栏：{n} 项（当前壁纸 {id}）","log.releaseQuiet":"已释放：渲染器已停（{why}）—— iframe 已清空、轮询已停，不会再自己重挂","log.listRefreshDropped":"换库后重画侧栏：当前壁纸 {id} 在新库里没有 ⇒ 如实切回「未选择壁纸」（不假装还在渲染）","pickd.noStart":"服务端没有给出可浏览的快捷根（GET /api/fs/roots 的 roots 为空）","pickd.listFail":"读取目录失败：{path} —— {msg}",
"pickd.frontend":"纯前端扫描（文件不离开浏览器）","pickd.system":"系统选择器（可能选不到环境内目录）","pickd.systemHint":"服务端打开的原生对话框；容器/安卓环境下常常看不到或选不到环境内目录 ⇒ 仅作兜底",
"pickd.dirTag":"目录","pickd.fileTag":"文件","pickd.rootLocked":"服务端默认不允许列出这个根（只读边界）；可用 MPW_PICK_ROOT 放宽",
"credit.link":"README · 许可与归属（GPL-3.0-or-later + 上游 MIT）","props.hiddenNote":"已隐藏 {n} 项内部/占位属性（在地址后加 {flag} 显示全部原始项）","props.placeholderNote":"占位属性（文案里没有可读内容）⇒ 不显示控件","props.emptyShownNote":"该壁纸没有可显示的可调项","props.ext.title":"打开外部链接？","props.ext.host":"目标域名：{host}","props.ext.warn":"这条链接来自壁纸作者的属性文案，不是本页生成的。确认域名可信再继续：只会以新标签打开，并带 noopener / noreferrer。","props.ext.cancel":"取消","props.ext.open":"打开","props.ext.wait":"请稍候（{n}s）","props.ext.opening":"已打开外部链接：{host}","props.ext.cancelled":"已取消：没有打开外部链接","props.linkBlocked":"已拒绝该链接：只放行 http(s)","props.num.invalid":"非法输入（{why}）：未写回，已恢复原值","props.num.clamped":"已按属性范围调整：{v}（{why}）","num.why.empty":"空值","num.why.too-long":"位数过多","num.why.not-finite":"不是有限数（Infinity / NaN）","num.why.radix-prefix":"不支持十六/八/二进制前缀","num.why.exponent":"不支持科学计数法（1e9）","num.why.not-a-number":"不是数字","num.why.too-many-decimals":"小数位过多","num.why.min":"低于下界","num.why.max":"高于上界","num.why.step":"按步长对齐","num.why.precision":"按精度取整","toolbar.bandfeed":"音条源","toolbar.bandfeedTip":"音条（音频条）的数据源：壁纸 = 只用包内音轨，没有就如实全 0；麦克风 = 显式请求麦克风（还要勾「启用麦克风」）；模拟 = 确定性模拟源（只看形态）；关 = 不接任何源。换档会重挂载渲染器","bandfeed.wallpaper":"壁纸","bandfeed.mic":"麦克风","bandfeed.sim":"模拟","bandfeed.off":"关","bandfeed.idle":"音条状态：等待渲染器回报…","bandfeed.notInUrl":"音条状态：档位**没写进预览 URL**（改写链把它丢了）—— 渲染器收不到这个参数，切档自然没效果；这是本页自己的问题，不是渲染器不认。模式：{mode}","bandfeed.noReport":"音条状态：这个渲染器没有回报音条数据源（该版本不认「?bandfeed=」）—— 档位已写进 URL：{mode}（这个渲染器档不认「?bandfeed=」：档位已写进 URL，切到「本仓渲染器」档即生效 —— 它由 :8902 **自己直供** /webloader/，不依赖 :8899）","bandfeed.srcWallpaper":"音条数据源：包内音轨（?audio=1 的 sound 层）","bandfeed.srcMic":"音条数据源：麦克风","bandfeed.srcSim":"音条数据源：模拟（形态可见，不是真实频谱）","bandfeed.silent":"音条无数据：该壁纸没有音源或已静音 —— 可切「麦克风」或「模拟」看形态","bandfeed.offNote":"音条源：关 —— 渲染器不接任何数据源（脚本侧退回旧 audioBuffers 路径）","bandfeed.whyNoSource":"没有数据源：?audio=1 的包内音轨与麦克风都没有","bandfeed.whyNoTrack":"包内没有可用的音轨分析器（需要 ?audio=1 且包里真有 sound 层在播）","bandfeed.whyMicGate":"测试台「启用麦克风」没勾：不会请求麦克风（getUserMedia 一次都不调）","bandfeed.whyMicDenied":"麦克风授权被拒绝或未启用（不会再请求第二次）","bandfeed.whyMicWait":"麦克风还在等待授权 / 初始化","bandfeed.whyMicUnsupported":"这个浏览器没有 navigator.mediaDevices（拿不到麦克风）","bandfeed.whyMicError":"麦克风初始化失败","bandfeed.whyMicGeneric":"麦克风不可用","log.bandfeedSwitch":"音条源：{mode} —— {status}","log.bandfeedMicGated":"音条源选了「麦克风」，但「启用麦克风」没勾：不会请求麦克风（getUserMedia 一次都不调）⇒ 音条保持全 0；要真接麦克风请先勾「启用麦克风」（勾上会自动重挂载一次）","log.bandfeedNoMount":"「重挂载」这次没有重设渲染器（当前没有已挂载的壁纸，或走的是合成样例那条路径）⇒ 音条档位在**下次挂载**时生效；换一张壁纸或点一次「重挂载」即可","toolbar.rendererSrc":"渲染器","toolbar.rendererSrcTip":"预览用哪个渲染器：上游产物 = demo/renderer/index.html（不可重建的 minified 包，画布乘数被「DPR」档上限夹住、上下文 alpha:false）；本仓渲染器 = 同源 /webloader/（:8902 自己直供的 demo.html + 本仓 core，**不需要 :8899 在跑**，含 ?res=dpr 画布活档位与透明/粒子修复）。换档会重挂载预览","rendererSrc.upstream":"上游产物","rendererSrc.repo":"本仓渲染器","rendererSrc.loading":"渲染器来源：本仓渲染器正在加载…","rendererSrc.repoOn":"渲染器来源：本仓渲染器（{label}）· 画布 {res} · {note}","rendererSrc.repoDegraded":"渲染器来源：本仓渲染器（{label}）· 画布 {res} —— 明确降级的能力：{caps}","rendererSrc.notRepo":"渲染器来源：本仓渲染器 —— ⚠ 但当前文档看着不像本仓渲染器（{url}）","rendererSrc.unreachable":"渲染器来源：本仓渲染器 —— ⚠ 打不开（{why}）：同源 /webloader/ 没起来（这条路由由 :8902 自己直供，不需要 :8899）？回退请选「上游产物」","rendererSrc.upstreamOn":"渲染器来源：上游产物（{label}）—— {note}","log.rendererSrcSwitch":"渲染器来源：{mode}（{detail}）","log.rendererSrcNoMount":"「重挂载」这次没有重设渲染器（当前没有已挂载的壁纸，或走的是合成样例那条路径）⇒ 渲染器来源在**下次挂载**时生效；换一张壁纸或点一次「重挂载」即可","log.rendererSrcEmpty":"渲染器来源：{mode} —— 当前**未选择壁纸**：预览保持空态，这次**不挂载任何壁纸**（档位已记住，下次挂载生效）","log.rendererSrcRewrote":"「重挂载」这次没有重设渲染器（没有已挂载的壁纸 / 走的是合成样例那条路径）⇒ 已把**当前预览 URL 按新档位重写一次**（同一条改写链），立即生效","log.rendererSrcSampleSkipped":"合成样例：本仓渲染器档不载它（本仓按 ?id= 取包挂载；那条 __wp.loadSceneFile 契约本仓明确降级）—— 上游产物档行为不变","log.rendererSrcSampleRepo":"合成样例：本仓渲染器档按 `?id=sample-synthetic` 挂载（与产物档同一个样例、同一份字节；取包走本仓 `/pkg/<id>`）：{url}","log.rendererSrcSampleExplicit":"合成样例：本仓渲染器档不认 `?sample=<url>`（那是产物页 `loadSceneFile(blob)` 的调试档）—— 已忽略，仍用自带样例"},"en":{"app.title":"wallpaper-engine-webgl","picker.title":"Custom color","picker.hex":"Hex","picker.hint":"Drag the hue bar and panel, or type #rrggbb","picker.ok":"OK","picker.cancel":"Cancel","copy.logs":"Copy output","copy.url":"Copy link","copy.ok":"Copied to clipboard","copy.manual":"Clipboard unavailable (file:// or not permitted): copy the selected text below manually","copy.fail":"Copy failed: {msg}","error.title":"Page script error (contained)","error.dismiss":"Dismiss","error.logged":"Details were written to the output panel","fs.enter":"Fullscreen","fs.enterTitle":"Fullscreen preview (the exit button is at the top-right inside fullscreen)","fs.exit":"Exit fullscreen","fs.exitTitle":"Exit fullscreen (Esc also works)","fs.unsupported":"This browser does not support the Fullscreen API","local.pickTitle":"Pick a local wallpaper folder (read in-browser; files never leave it)","local.unsupported":"This browser cannot pick directories (webkitdirectory / showDirectoryPicker) — local wallpapers cannot be loaded here; use desktop Chrome / Edge / Firefox","local.reading":"Reading folder…","local.none":"No wallpapers found in that folder (a wallpaper folder needs scene.pkg or project.json)","local.count":"Local folder: {n} wallpapers","local.sceneOnly":"Static hosting previews scene packages only (web/video need the local Node backend)","local.preview":"Local preview: {name}","local.clear":"Clear","local.clearTitle":"Clear the local library and the current selection","local.cleared":"Cleared the local library and selection","local.notDir":"That was not a folder selection: the browser returned a single file. Click “Choose folder” and pick a directory (not a single file)","local.kindTitle":"Type auto-detected while scanning: {k}","btn.pickFile":"Choose file","pick.dirTitle":"Browse folders","pick.fileTitle":"Browse files","pick.curDir":"Current folder","pick.up":"Up one level","pick.home":"Back to top","pick.here":"Use this folder","pick.thisFile":"Use this file","pick.empty":"No subfolders here","pick.noFile":"No matching files here","pick.filterPh":"Filter by name","pick.grant":"Open system picker","pick.needGrant":"Browser security: a page can only list a folder you grant through the system dialog — pick one first (files never leave the browser)","pick.readNote":"Read in-browser: folders and files come from the tree you granted; nothing is uploaded or leaves the browser","pick.granted":"Granted: {name} ({n} files / {d} folders)","pick.cancelled":"Selection cancelled","pick.count":"{n} items","local.grantScan":"Loaded from the picker: {name}","local.filePicked":"File picked: {name}","docs.readmeTitle":"This page README · quick reference","status.dpr":"DPR (devicePixelRatio) {n}","status.dprTitle":"Window devicePixelRatio — affects render resolution and performance","offline.tag":"Offline","offline.diagReason":"Static hosting has no /diag backend: the renderer diagnostics stream is unavailable (run the local Node host or pnpm dev)","offline.diagTitle":"Diagnostics stream unavailable (static hosting)","backend.node":"Local Node backend connected","backend.static":"Static hosting (no /api backend)","backend.staticTitle":"Static hosting: this page is served statically, so /api/* and /diag are all 404 — the library listing, property saving, deleting, reveal-in-folder and the diagnostics stream are unavailable","backend.needBackend":"Needs the local Node backend (unavailable under static hosting)","backend.alt":"Working alternative: “Choose folder” scans in-browser (scene packages preview directly; files never leave the browser)","backend.online":"To go online: run pnpm dev in the WEwebLoader source tree and open the address it prints (default http://localhost:1430/) — that is the full bench with the Node host","backend.offline":"The browser is offline (navigator.onLine=false): nothing here needs the network; what is missing is the local Node backend","backend.blocked":"The Node host cannot be started on this machine right now: dependencies are incomplete offline (pnpm install --offline fails with ERR_PNPM_NO_OFFLINE_TARBALL)","res.pick":"Pick resolution","res.native":"(popup list is height-limited and scrollable)","trail.on":"Mouse trail","trail.needInjection":"Enable “Pointer injection” first","trail.len":"Length","trail.width":"Width","trail.color":"Color","trail.tip":"Only available after enabling “Pointer injection”: the trail uses the injection veil coordinates and never takes over real mouse events","act.explorer":"Explorer","act.docs":"User guide","theme.auto":"Theme: system","theme.dark":"Theme: dark","theme.light":"Theme: light","lang.title":"Switch language","backend.demoNoBackend":"The online demo (GitHub Pages) has no local Node backend — this is **by design**, not a failure: online there are only static files, so /api/* and /diag are 404. The full bench (library listing, property saving, deleting, diagnostics stream) needs pnpm dev in the source tree.","demo.onlineTitle":"Online demo","demo.onlineBody":"This page is an **online static demo**: there is no local Node backend, so the library listing, property saving, deleting, reveal-in-folder and the renderer diagnostics stream (/api/* and /diag) are unavailable online — by design under plain static hosting, not a failure. “Choose folder” (fully client-side scanning) still works, and the default wallpaper is the **synthetic sample** generated by this repository (no real wallpaper is bundled).","demo.onlineSample":"Default wallpaper: the synthetic sample scene.pkg (generated by tools/make-sample.mjs, 33 299 B, no third-party content) — this repository **does not redistribute** any real wallpaper package.","offline.diagReasonOnline":"The online demo has no /diag backend: online is plain static hosting, so the renderer diagnostics stream is unavailable (by design, not a dropped connection)","demo.sampleMissing":"Loading the synthetic sample failed: {msg}","demo.sampleLoaded":"Loaded the synthetic sample: {name} (generated by this repository, no third-party content)","credit.title":"Original renderer author","credit.link":"WebWallGL · oneincase (MIT license)","brand.generic":"Wallpaper","static.notice":"Static demo: the library listing, property saving, deleting and the diagnostics stream need a local backend. Use “Choose folder” to scan local wallpapers in-browser (scene packages preview), or run pnpm dev in the source tree for the full bench.","static.libPath":"Static hosting · no local backend","static.pickTitle":"Unavailable on static hosting — run locally (pnpm dev)","log.filePreview":"Local preview: {name}","err.filePreview":"Local preview failed: {msg}","sidebar.title":"Explorer","sidebar.libCount":"Library","sidebar.pickLib":"Pick folder (or keep using WE_LIBRARY)","btn.pickLib":"Pick folder","ph.filter":"Filter title / itemId","ph.propsFilter":"Filter property name / label","reveal.open":"Open containing folder","ctx.delete":"Delete wallpaper","confirm.delete":"Delete wallpaper “{title}”? Its whole folder will be moved to the Trash ({id}).","ok.delete":"Deleted: {id}","err.delete":"Delete failed: {msg}","tab.wallpaper":"No wallpaper","toolbar.resolution":"Resolution","toolbar.resolutionTip":"Stage logical resolution (iframe viewport)","toolbar.volume":"Volume","toolbar.live":"Live system","toolbar.liveTip":"Title/progress via Node media-control; audio bars via mic (no system loopback). Remounts on toggle","toolbar.mic":"Enable microphone","toolbar.micTip":"Off by default: while off the page never requests the microphone (getUserMedia is not called) and “Live system” keeps title/progress only; when on it is requested only if a wallpaper/feature declares the need, never pre-requested at load","dbg.switch":"Enable debug mode","dbg.switchTip":"Step through layers (left/right) and isolate them; the keyboard is captured only while the debug view is open, Alt exits","logs.cleared":"Cleared ({view})","log.micOn":"Microphone enabled: requested only when a wallpaper/feature declares the need (no pre-request at load)","log.micOff":"Microphone disabled: no mic request is issued at all","log.micNeeded":"The microphone half of “Live system” needs “Enable microphone” first — title/progress only for now","toolbar.pointerPush":"Pointer inject","toolbar.pointerPushTip":"Simulates a desktop wallpaper window: a veil blocks native mouse events and coordinates are pushed via __wp.pushPointer — the same channel the native host uses","toolbar.pause":"Pause","toolbar.resume":"Resume","toolbar.reload":"Remount","toolbar.release":"Release","toolbar.open":"New window","toolbar.props":"Wallpaper config","toolbar.filter":"Filter","toolbar.filterTip":"Filter (beta): CSS filter applied to the rendered output","toolbar.introSkip":"Skip intro","toolbar.introSkipTip":"Skip the wallpaper intro (the opening zoom / camera move) and start right after it (renderer flag ?skipintro=1)","toolbar.webMode":"Web render","toolbar.webModeTip":"How web wallpapers run: sandbox = isolated scope (safer, a few wallpapers fail); compat = run in-page (best compatibility). Switching remounts the renderer (?webmode=)","webMode.sandbox":"Sandbox","webMode.compat":"Compat","webMode.auto":"Auto","toolbar.hybrid":"Streaming","toolbar.hybridTip":"DSH process streaming (hybrid): play while fetching, without waiting for the whole package; off = fetch fully first (renderer flag ?hybrid=). On by default","toolbar.parallax":"Parallax","toolbar.parallaxTip":"Parallax (camera layer + per-object parallaxDepth) — renderer flag ?parallax=: ticked = layers follow the pointer (official formula, writes ?parallax=1); unticked = they do not (writes ?parallax=0; use when screenshots must be positionally stable). Two A/B values come from this page\u2019s URL: ?parallax=legacy (old lwe approximation) / ?parallax=official (same as 1); a URL value wins over the checkbox. Ticked by default: the bench is the author-intent preview surface","toolbar.layerSwitch":"Layers","toolbar.layerSwitchTip":"Unchecking hides that layer from rendering (per-layer triage); the hidden set is written into this page's URL as ?hide= and restored on remount or when opened with the parameter. Works with the “This repo” renderer only","layers.all":"All","layers.none":"None","layers.onlyCurrent":"Keep current only","layers.keepCurrentTip":"Uncheck every layer except the one debug mode is currently on (step layers in debug mode first)","layers.needDebug":"No current layer yet: step layers in debug mode first — this button needs a current layer","layers.copyState":"Copy state","layers.reset":"Restore defaults","layers.resetTip":"Back to the **wallpaper file's default state** (this repo's single rule: checked by default = file semantics: layers with visible in scene.json are ticked, visible:false ones are not): clears your unchecks and any forced-visible layers, and removes ?hide= from the URL, so a page reload yields the same image","log.lswReset":"Layer switch: restore defaults — back to the wallpaper file's default state ({n}/{m} layers ticked; hidden set and forced-visible cleared, ?hide= removed from the URL)","layers.hiddenCount":"{n}/{m} layers hidden","layers.container":"Container layer: carries parenting/positioning only, never drawn (cannot be hidden)","layers.keepRow":"Solo","layers.keepOne":"Keep only this layer (= check only it, uncheck the rest)","layers.disabledUpstream":"The upstream build has no __lnHidden convention (per-layer hiding works with the “This repo” renderer only) — switch “Renderer” to “This repo” first","layers.disabledNoMount":"No wallpaper mounted (no __sceneLayers to list): pick a wallpaper on the left first","layers.dbgDeferred":"Debug isolation is active: checkbox changes are recorded and applied when debug mode exits","layers.fileHidden":"This layer is visible:false in scene.json (not rendered right now): tick to force it visible","layers.forced":"Forced visible: the file says visible:false and this tick overrides it (untick to go back to the file state)","layers.noSource":"Not drawable: this layer has no pixel source (audio/sound or data-only layer) - ticking it will not make it appear","layers.allTip":"Tick everything, including layers that are visible:false in the file (= force them visible)","log.lswForceShow":"Layer switch: forcing #{n} {name} visible (visible:false in the file)","log.lswKeepOnly":"Layer switch: keep only #{n} {name} (the rest unchecked)","log.lswCopied":"Copied the current state (paste it to someone else to reproduce): {text}","log.lswRematch":"Layer switch: wallpaper remounted — re-matched by index+name, kept {n} hidden, dropped {m} (index/name no longer matching)","bar.collapseTip":"Collapse the options bar (hides rows 1-3; action buttons and flags stay available)","bar.expandTip":"Expand the options bar","webProbe.heavy":"Heavy animation","webProbe.external":"Needs network","webProbe.badge":"Precheck: {flags}","log.webProbeOk":"Precheck (web wallpaper): {id} - no risk flags","log.webProbeWarn":"Precheck (web wallpaper): {id} {flags} - {reasons}","filter.none":"None","filter.blur":"Blur","filter.grayscale":"Grayscale","filter.sepia":"Sepia","filter.vivid":"Vivid","filter.warm":"Warm","filter.cool":"Cool","filter.invert":"Invert","filter.brighten":"Brighten","filter.darken":"Darken","filter.contrast":"Contrast","res.fit":"Adaptive 16:9","stage.empty":"Pick a wallpaper on the left to start rendering","logs.head":"Output","logs.diag":"Renderer diagnostics (/diag)","logs.clear":"Clear","logs.collapse":"Collapse output","logs.expand":"Expand output","bar.collapse":"Collapse options","bar.expand":"Expand options","bar.hintOn":"Resolution / filter / fps …; collapsing keeps only this row","bar.hintOff":"Options collapsed (use the button on the left)","logs.debug":"Debug mode","logs.debugOn":"Debug mode·ON","logs.debugOff":"Debug mode·OFF","logs.tabDebugHint":"Debug mode: left/right steps layers, plus report & screenshot",
"dbg.report":"Report now","dbg.reportTip":"Post the current diagnostics immediately (/report, then /baseline, then /diag)","dbg.shot":"Screenshot","dbg.shotTip":"Download the preview canvas as JPEG","dbg.reporting":"Reporting…","dbg.reported":"Reported: {where} ({bytes} B)","dbg.reportFail":"Report failed: {msg}","dbg.shotOk":"Screenshot saved: {name} ({kb} KB)","dbg.shotFail":"Screenshot failed: {why}","dbg.on":"Debug mode: on (left/right steps layers; Alt exits)","dbg.off":"Debug mode: off","dbg.layerNone":"No scene to inspect layer by layer","dbg.layerLine":"Layer {i}/{n} · {name}","dbg.noScene":"No scene layers right now (not mounted / failed to load)","status.adaptive":"Adaptive 16:9","status.cap":"Cap {n}","status.uncapped":"Uncapped","fps.uncapped":"Uncapped","fps.uncappedTitle":"No frame-rate cap (renders as fast as the display allows)","status.capTitle":"FPS cap (toolbar FPS)","status.liveTitle":"Measured wallpaper FPS (render loop, last 500ms)","status.items":"{n} items","props.title":"Wallpaper config","props.weGroup":"Renderer settings (built into WE)","props.we.flipH":"Flip (horizontal)","props.we.colorOptions":"Show colour options (master)","props.we.brightness":"Brightness","props.we.contrast":"Contrast","props.we.saturation":"Saturation","props.we.hue":"Hue shift","props.we.playbackRate":"Playback rate","props.we.volume":"Volume","props.we.flipV":"Flip (vertical)","props.we.alignment":"Alignment / zoom","props.we.parallaxReaction":"React to motion (parallax / gyro)","props.we.recording":"Recording (WE capture / recording volume)","props.we.perMonitor":"Per monitor (per-display settings)","props.we.status.other":"implemented elsewhere","props.we.status.no":"not implemented","props.we.status.we":"built into WE","props.we.why.flipV":"No `flipV` in this repo's renderer (`__wp.setDisplay` only takes `flipH`) — not done; a vertical mirror would be the host's own CSS `scaleY(-1)`.","props.we.why.alignment":"Implemented here, but on the toolbar fit control (`#fit` / `?fit=`), not on a renderer API.","props.we.why.parallaxReaction":"Out of scope by the user's own call (no gyroscope); if ever added it uses `__wp.pushPointer(x,y)`.","props.we.why.recording":"Built into the Wallpaper Engine client (capture / recording volume); no in-page surface.","props.we.why.perMonitor":"Built into the WE client (wallpaper and volume are stored per monitor); this page is a single-instance preview.","props.we.notReady":"The renderer has not published `__wp` yet (briefly true while switching wallpaper or remounting): this group becomes usable once the renderer is up — the controls stay greyed out until then.","props.we.legacy":"The renderer is running the `?display=legacy` master fallback: the whole display-options group is ignored (`__wp.setDisplay` is read-only), so the controls are greyed out.","props.we.hint":"These items exist on every wallpaper (built into WE) and drive the renderer API directly, taking effect immediately; the wallpaper's own items are below.","props.imgDedup":"Image dedup","props.imgDedupOnce":"Once (whole panel)","props.imgDedupRow":"Once per row","props.imgDedupAll":"All (no dedup)","props.imgDedupNote":"{n} duplicate image(s) suppressed","props.imgDedupForced":"Decided by the URL gear {flag}","props.imgDedupTip":"Draw each picture once per panel (enforced): (1) a byte-identical URL is drawn once; (2) URLs differing only in size/format/watermark params or suffixes (wx_fmt, bo, rf, @100w, 800x600, _!web-…, x-oss-process=…) or in an http/https or www. prefix count as the SAME picture and are merged unconditionally (no size match required any more); (3) both sources in the panel — the images the renderer parsed and those in the property text — share one ledger; (4) a link to an already-drawn picture, and a link left empty after its image was suppressed, are no longer drawn on their own. “All” = no dedup (A/B); “Once per row” = per-row dedup only. A link carrying ?propimg= wins","props.imgDedupLog":"Image dedup gear: {mode}","props.imgDedupForcedNote":"({m} of them were **force-merged** by picture identity: {diff} with a different size, {unk} with unknown size — “show it once” is enforced as requested)","props.imgDedupForcedLog":"(the URL param {flag} wins: this click only stores the preference; drop the param for it to take effect)","wpset.done":"Implemented","props.reset":"Reset defaults","props.collapse":"Collapse","props.showHidden":"Show condition-hidden items","props.reading":"Reading…","props.none":"This wallpaper declares no custom properties","props.count":"{n} items","props.countOverridden":"{n} items ({m} overridden)","props.readFail":"Read failed: {msg}","props.saving":"Saving…","props.savedOverridden":"Saved ({n} overridden)","props.savedAll":"Saved (all defaults)","props.saveFail":"Save failed: {msg}","props.pending":"Pending save…","props.logSaved":"Properties saved: {id} ({n} overrides)","props.empty":"project.json declares no general.properties — nothing to customize.","props.noMatch":"No matching properties","props.allHidden":"All properties hidden by condition (tick the switch above to view)","props.filePh":"Path relative to wallpaper root ({kind})","props.dirPh":"Absolute directory path","props.pickFile":"Choose file…","props.pickDir":"Choose folder…","props.fileUnset":"Not set","props.fileUploading":"Importing…","err.wpNotReady":"__wp not ready (pick a wallpaper and wait for it to load)","err.diagStream":"Diagnostics stream lost (dev server restarted?)","err.pickLib":"Picking folder failed: {msg}","err.pickFile":"Choosing file failed: {msg}","err.pickDir":"Choosing folder failed: {msg}","err.reveal":"Opening folder failed: {msg}","err.selectFirst":"Pick a wallpaper before opening Properties","ok.reveal":"Opened folder: {id}","log.libLoaded":"Library loaded: {n} items (scene {s} / web {w} / video {v})","log.mount":"Mount {id}: ?{q}","log.liveOn":"Live system on (mic spectrum + Music/Spotify + front window)","log.liveOff":"Live system off; back to simulated sources","log.pointerPushOn":"Pointer injection on: veil blocks native mouse events; coordinates now pushed via __wp.pushPointer (simulates desktop wallpaper window)","log.pointerPushOff":"Pointer injection off; native mouse events restored","prompt.libDir":"Wallpaper library directory","nav.console":"Console","nav.docs":"Guide","nav.wpset":"API mapping","nav.settings":"Settings","nav.settingsTip":"Language / theme / attribution & licences","nav.lang":"Language","nav.theme":"Theme","nav.backend":"Backend","nav.backendUnknown":"unknown","nav.backendNote":"Static hosting (GitHub Pages) has no local Node backend: library listing / property saving / deleting / the diagnostics stream are unavailable online — by design, not a failure. “Choose folder” (in-browser scan) still works.","wp.add":"＋","wp.addTitle":"Add / switch wallpaper: open the left list filtered to hide the current one","logs.expandTip":"Expand the output (console)","logs.collapseTip":"Collapse the output (console)","props.emptyState":"No wallpaper picked yet","props.emptyHint":"Pick one in “Choose wallpaper” on the left; the options declared in its project.json show up here.",
"libsrc.default":"Library source: machine default directory (server built-in — you have not chosen one)","libsrc.default.hint":"This is the server's start-up default, not a choice you made; click “Choose folder” to browse in-app and pick one","libsrc.default.path":"(default library directory unavailable)",
"libsrc.user":"Library source: the directory you chose","libsrc.user.hint":"Chosen by you via “Choose folder” (accepted by the server's /api/library-dir)","libsrc.user.path":"(chosen directory is empty)",
"libsrc.empty":"Library source: empty (the server returned no library directory)","libsrc.empty.hint":"The server reports an empty library; click “Choose folder” and pick a directory holding wallpapers","libsrc.empty.path":"(empty)",
"libsrc.none":"Library source: unavailable (static hosting / no local backend)","libsrc.none.hint":"Static hosting has no /api/*: the library listing and diagnostics stream are unavailable; the in-browser scan behind “Choose folder” still works","libsrc.none.path":"(no backend)",
"wp.pinned":"Pinned / recent","wp.lib":"Wallpaper library","wp.libOpen":"Expand the wallpaper library","wp.libClose":"Collapse the wallpaper library",
"wp.pin":"Pin to “Pinned”","wp.unpin":"Unpin from “Pinned”","wp.pinnedCount":"{n} pinned","wp.libCount":"{n} in library",
"wp.libEmpty":"The library is empty: pick a library directory first, or scan one with “Choose folder” on the left","wp.switchHint":"Click a tab to switch wallpaper; ★ = pin / unpin",
"wp.close":"Close the wallpaper tab","wp.closeTip":"Close this wallpaper (drops the tab; closing the current one falls back to a neighbour)","wp.closed":"Closed wallpaper tab: {id}","wp.closedFallback":"Closed the current wallpaper {id} ⇒ fell back to {next}","wp.closedRelease":"Closed the current wallpaper {id}; nothing else open ⇒ stage released","wp.type.all":"All","wp.type.scene":"Scene","wp.type.web":"Web","wp.type.video":"Video","wp.typeTitle":"Wallpaper type filter (scene / web / video are driven by the bundle's own type switch; “All” merges the three here)",
"diag.empty":"(no renderer diagnostics yet: pick a wallpaper and the renderer reports its mount log to /diag — it shows up here)","diag.count":"{n} lines","diag.tabTitle":"Renderer diagnostics stream (/api/diag-stream, including what the renderer reports via /diag)","diag.lost":"Diagnostics stream lost: {msg}","diag.wait":"Connecting to /api/diag-stream…",
"logs.tabLogs":"Output","logs.tabDiag":"Renderer diagnostics (/diag)","logs.tabHint":"Switch between “Output” and the renderer diagnostics stream",
"pickd.title":"Choose the wallpaper library directory (in-app browsing)","pickd.note":"Read-only server browsing: paths never escape the roots the server exposes",
"pickd.noRoute":"The server does not have the /api/fs/* routes yet (GET /api/fs/roots returns 404), so in-app browsing is unavailable; use a fallback button below",
"pickd.noBackend":"Static hosting has no local backend, so in-app browsing is unavailable; use “in-browser scan” (files never leave the browser)",
"pickd.here":"Use this directory","pickd.up":"Up one level","pickd.roots":"Shortcuts","pickd.loading":"Reading…","pickd.empty":"(no subdirectories here)",
"pickd.selected":"Selected: {path}","pickd.applying":"Switching the library directory…","pickd.done":"Library directory switched: {path} (reloading…)","pickd.fail":"Switch failed: {msg}","pickd.relisted":"library list re-fetched ({n} items)","log.listRefreshDone":"Sidebar re-rendered after the library switch: {n} items (current wallpaper {id})","log.releaseQuiet":"Released: the renderer is stopped ({why}) — iframe cleared, polling stopped, no self-healing remount","log.listRefreshDropped":"Sidebar re-rendered after the library switch: the previous wallpaper {id} does not exist in the new library, so it was released honestly","pickd.noStart":"The server exposed no browsable root (GET /api/fs/roots returned an empty roots array)","pickd.listFail":"Listing failed: {path} — {msg}",
"pickd.frontend":"In-browser scan (files never leave the browser)","pickd.system":"System picker (may not reach directories inside this environment)","pickd.systemHint":"The native dialog opened by the server; in containers/Android it is often invisible or cannot reach the environment's directories — fallback only",
"pickd.dirTag":"dir","pickd.fileTag":"file","pickd.rootLocked":"The server does not allow listing this root by default (read-only boundary); relax it with MPW_PICK_ROOT",
"credit.link":"README · License & credits (GPL-3.0-or-later + upstream MIT)","props.hiddenNote":"Hid {n} internal/placeholder item(s) (append {flag} to show every raw item)","props.placeholderNote":"Placeholder property (no readable text) — colour control hidden","props.emptyShownNote":"This wallpaper has no adjustable items to show","props.ext.title":"Open external link?","props.ext.host":"Target domain: {host}","props.ext.warn":"This link comes from the wallpaper author\u2019s property text, not from this page. Continue only if you trust the domain: it opens in a new tab with noopener / noreferrer.","props.ext.cancel":"Cancel","props.ext.open":"Open","props.ext.wait":"Wait ({n}s)","props.ext.opening":"Opened external link: {host}","props.ext.cancelled":"Cancelled: no external link opened","props.linkBlocked":"Link refused: only http(s) is allowed","props.num.invalid":"Invalid input ({why}): not saved, original value restored","props.num.clamped":"Adjusted to the property range: {v} ({why})","num.why.empty":"empty","num.why.too-long":"too many characters","num.why.not-finite":"not a finite number (Infinity / NaN)","num.why.radix-prefix":"hex/octal/binary prefixes are unsupported","num.why.exponent":"scientific notation (1e9) is unsupported","num.why.not-a-number":"not a number","num.why.too-many-decimals":"too many decimals","num.why.min":"below the minimum","num.why.max":"above the maximum","num.why.step":"snapped to the step","num.why.precision":"rounded to the precision","toolbar.bandfeed":"Audio bar source","toolbar.bandfeedTip":"Audio bar (visualizer) data source: Wallpaper = the in-package track only (honestly all-zero when there is none); Microphone = explicitly request the mic (also needs “Enable microphone”); Simulated = deterministic simulated source (shape only); Off = no source at all. Switching remounts the renderer","bandfeed.wallpaper":"Wallpaper","bandfeed.mic":"Microphone","bandfeed.sim":"Simulated","bandfeed.off":"Off","bandfeed.idle":"Audio bar: waiting for the renderer to report…","bandfeed.notInUrl":"Audio bar: the mode was **not written into the preview URL** (the rewrite chain dropped it) — the renderer never receives it, so switching has no effect; this is a page-side bug, not an unsupported renderer. Mode: {mode}","bandfeed.noReport":"Audio bar: this renderer reports no audio-bar source (this build ignores “?bandfeed=”) — the mode is in the URL: {mode} (this renderer build ignores “?bandfeed=”: the mode is in the URL — switch to the “This repo” renderer tier to make it take effect, since it is served by :8902 itself at /webloader/ and needs no :8899)","bandfeed.srcWallpaper":"Audio bar source: in-package track (the ?audio=1 sound layer)","bandfeed.srcMic":"Audio bar source: microphone","bandfeed.srcSim":"Audio bar source: simulated (shape only, not a real spectrum)","bandfeed.silent":"No audio-bar data: this wallpaper has no audio source or is muted — switch to “Microphone” or “Simulated” to see the shape","bandfeed.offNote":"Audio bar source: Off — the renderer takes no data source (the script side falls back to the legacy audioBuffers path)","bandfeed.whyNoSource":"No data source: neither the ?audio=1 in-package track nor the microphone is available","bandfeed.whyNoTrack":"No usable track analyser in the package (needs ?audio=1 with a sound layer actually playing)","bandfeed.whyMicGate":"“Enable microphone” is off in the bench: no mic request is issued (getUserMedia is never called)","bandfeed.whyMicDenied":"Microphone permission was denied or not enabled (it will not be requested a second time)","bandfeed.whyMicWait":"The microphone is still waiting for permission / initialisation","bandfeed.whyMicUnsupported":"This browser has no navigator.mediaDevices (the microphone is unavailable)","bandfeed.whyMicError":"Microphone initialisation failed","bandfeed.whyMicGeneric":"The microphone is unavailable","log.bandfeedSwitch":"Audio bar source: {mode} — {status}","log.bandfeedMicGated":"Audio bar source set to “Microphone” but “Enable microphone” is off: no mic request is issued (getUserMedia is never called), so the bars stay all-zero; tick “Enable microphone” first to really attach the mic (ticking it remounts once)","log.bandfeedNoMount":"“Remount” did not reset the renderer this time (no wallpaper is mounted, or the synthetic-sample path is active), so the audio-bar mode takes effect on the **next mount**; switch wallpaper or press “Remount” once","toolbar.rendererSrc":"Renderer","toolbar.rendererSrcTip":"Which renderer the preview uses: Upstream product = demo/renderer/index.html (the unrebuildable minified bundle: its canvas multiplier is capped by the toolbar DPR value and its context is alpha:false); This repo = same-origin /webloader/ (demo.html served by :8902 itself + this repo’s core — no :8899 required — with the ?res=dpr live canvas tier and the transparency/particle fixes). Switching remounts the preview","rendererSrc.upstream":"Upstream product","rendererSrc.repo":"This repo","rendererSrc.loading":"Renderer source: this repo’s renderer is loading…","rendererSrc.repoOn":"Renderer source: this repo’s renderer ({label}) · canvas {res} · {note}","rendererSrc.repoDegraded":"Renderer source: this repo’s renderer ({label}) · canvas {res} — explicitly degraded: {caps}","rendererSrc.notRepo":"Renderer source: this repo’s renderer — ⚠ but the current document does not look like this repo’s renderer ({url})","rendererSrc.unreachable":"Renderer source: this repo’s renderer — ⚠ cannot open ({why}): is the same-origin /webloader/ route up (served by :8902 itself, no :8899 required)? Pick “Upstream product” to fall back","rendererSrc.upstreamOn":"Renderer source: upstream product ({label}) — {note}","log.rendererSrcSwitch":"Renderer source: {mode} ({detail})","log.rendererSrcNoMount":"“Remount” did not reset the renderer this time (no wallpaper is mounted, or the synthetic-sample path is active), so the renderer source takes effect on the **next mount**; switch wallpaper or press “Remount” once","log.rendererSrcEmpty":"Renderer source: {mode} — **no wallpaper is selected**: the preview stays empty and nothing is mounted this time (the tier is remembered and applies on the next mount)","log.rendererSrcRewrote":"“Remount” did not reset the renderer this time (no mounted wallpaper / synthetic-sample path) — the current preview URL was rewritten for the new source through the same rewrite chain, so it takes effect immediately","log.rendererSrcSampleSkipped":"Synthetic sample: not loaded in this-repo mode (this repo mounts by ?id=; the __wp.loadSceneFile contract is explicitly degraded here) — upstream mode is unchanged","log.rendererSrcSampleRepo":"Synthetic sample: mounted in this-repo mode via `?id=sample-synthetic` (same sample, same bytes; the package is fetched through this repo’s `/pkg/<id>`): {url}","log.rendererSrcSampleExplicit":"Synthetic sample: this-repo mode does not accept `?sample=<url>` (that is the product page’s loadSceneFile(blob) debug hook) — ignored, the bundled sample is used"}}

/* ============================ 纯函数层 ============================ */
export const LANGS = ['zh', 'en']
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

export function t(lang, key, params) {
  const raw = (DICT[lang] && DICT[lang][key]) || (DICT.en && DICT.en[key]) || key
  if (!params) return raw
  return raw.replace(/\{(\w+)\}/g, (_, k) => (params[k] === undefined ? '{' + k + '}' : String(params[k])))
}

function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

/**
 * 把一种语言的**已渲染文本**映射回词典条目，从而算出另一种语言的文本。
 * - 精确值：`"资源管理器"` → key → `"Explorer"`
 * - 带参模板：`"上限 60"` ← `"上限 {n}"` ⇒ 捕获 `n=60` → `"Cap 60"`
 * 返回 { key, params } 或 null（不是可翻译文本）。
 */
export function buildValueIndex(lang, toLang) {
  const cand = []
  for (const key of Object.keys(DICT[lang] || {})) {
    const val = DICT[lang][key]
    if (!val) continue
    if (val.indexOf('{') >= 0) {
      const rx = new RegExp('^' + esc(val).replace(/\\\{(\w+)\\\}/g, '(.+?)') + '$')
      cand.push({ key, val, rx, names: (val.match(/\{(\w+)\}/g) || []).map((x) => x.slice(1, -1)) })
    } else {
      cand.push({ key, val, rx: null, names: [] })
    }
  }
  // 同值多键（例如 zh 的 "资源管理器" = act.explorer + sidebar.title）：
  //   候选键在**目标语言**里同值 ⇒ 无害，保留其一；
  //   目标值不一致（曾实测 en "Color" = picker.title + trail.color）⇒ 判为歧义**不译**：
  //   宁可不译也不译错；未命中会进 sweepRendered 的 missed 清单，便于发现词典撞车。
  const byVal = new Map()
  for (const c of cand) { if (!byVal.has(c.val)) byVal.set(c.val, []); byVal.get(c.val).push(c) }
  const out = []
  for (const [, list] of byVal) {
    if (list.length === 1) { out.push(list[0]); continue }
    if (toLang && DICT[toLang]) {
      const targets = new Set(list.map((c) => DICT[toLang][c.key]))
      if (targets.size > 1) continue
    }
    out.push(list[0])
  }
  // 长串优先，避免短串抢先匹配（例如 "音量" 与 "音量 "）
  out.sort((a, b) => b.val.length - a.val.length)
  return out
}

/** 一段已渲染文本 → 目标语言文本；命中不了就原样返回（并标记 hit=false）。 */
export function translateRendered(str, fromLang, toLang, index) {
  const idx = index || buildValueIndex(fromLang, toLang)
  const s = String(str == null ? '' : str)
  const trimmed = s.trim()
  if (!trimmed) return { text: s, hit: false }
  for (const e of idx) {
    let params = null
    if (e.rx) {
      const m = e.rx.exec(trimmed)
      if (!m) continue
      params = {}
      e.names.forEach((n, i) => { params[n] = m[i + 1] })
    } else if (e.val !== trimmed) continue
    const next = t(toLang, e.key, params)
    if (next === e.key) continue // 目标语言没这条键 → 不要写回 key 字面量
    // 保留原有前后空白
    const lead = s.slice(0, s.indexOf(trimmed))
    const tail = s.slice(lead.length + trimmed.length)
    return { text: lead + next + tail, hit: true, key: e.key }
  }
  return { text: s, hit: false }
}

/** 英文残留 = 文本恰好是 en 词典的值（且不是 zh 词典的值）。 */
export function hasResidualLang(strings, lang) {
  const other = lang === 'en' ? 'zh' : 'en'
  const otherVals = new Set(Object.values(DICT[other] || {}).filter((v) => v && v.indexOf('{') < 0))
  const selfVals = new Set(Object.values(DICT[lang] || {}).filter((v) => v && v.indexOf('{') < 0))
  const bad = []
  for (const raw of strings || []) {
    const s = String(raw == null ? '' : raw).trim()
    if (!s) continue
    if (lang === 'en') { if (CJK.test(s)) bad.push(s); continue }
    if (otherVals.has(s) && !selfVals.has(s)) bad.push(s)
  }
  return bad
}

/**
 * 采集"可翻译文本槽"。真实 DOM 走 TreeWalker + [placeholder] + [title] + <title>；
 * 测试用假 DOM 可在 root 上挂 `__slots`（[{read,write,kind}]）作为注入缝。
 */
export function collectSlots(root, doc) {
  if (root && Array.isArray(root.__slots)) return root.__slots.slice()
  const slots = []
  const d = doc || (root && root.ownerDocument) || (typeof document !== 'undefined' ? document : null)
  if (!d) return slots
  const walker = d.createTreeWalker(root, 0x4 /* SHOW_TEXT */, null)
  let n = walker.nextNode()
  while (n) {
    const p = n.parentNode
    const tag = p && p.nodeName ? String(p.nodeName).toLowerCase() : ''
    if (tag !== 'script' && tag !== 'style') slots.push({ kind: 'text', read: () => n.nodeValue, write: (v) => { n.nodeValue = v } })
    n = walker.nextNode()
  }
  for (const el of root.querySelectorAll('[placeholder]')) slots.push({ kind: 'placeholder', read: () => el.placeholder, write: (v) => { el.placeholder = v } })
  for (const el of root.querySelectorAll('[title]')) slots.push({ kind: 'title', read: () => el.getAttribute('title'), write: (v) => { el.setAttribute('title', v) } })
  for (const el of root.querySelectorAll('svg title, svg > title')) slots.push({ kind: 'svgtitle', read: () => el.textContent, write: (v) => { el.textContent = v } })
  return slots
}

/**
 * 把 root 里**所有已渲染文本**从 fromLang 切到 toLang。
 * 覆盖 data-i18n 静态节点之外的一切：动态拼的日志/诊断流、属性面板、状态栏。
 * 返回 { changed, scanned, missed }（missed = 看起来是 fromLang 但没命中的串，供诊断）。
 */
export function sweepRendered(root, fromLang, toLang, doc) {
  const idx = buildValueIndex(fromLang, toLang)
  const slots = collectSlots(root, doc)
  const missed = []
  let changed = 0
  for (const s of slots) {
    let cur
    try { cur = s.read() } catch { continue }
    if (cur == null || !String(cur).trim()) continue
    const r = translateRendered(cur, fromLang, toLang, idx)
    if (r.hit) { if (r.text !== cur) { s.write(r.text); changed++ } }
    else if (CJK.test(String(cur)) && fromLang === 'zh') missed.push(String(cur).trim().slice(0, 40))
  }
  return { changed, scanned: slots.length, missed }
}

/** <title> 与标题栏都要用同一个名字（用户拍板 wallpaper-engine-webgl）。
 *  ⚠ ⑧(2026-09-18 品牌改名)：这里的**静态值不动** —— 它是门禁 T5/T8 的钉子（产物 JS 的两处 app.title 同理，
 *  且 DICT 还必须逐条等于上游 bench/i18n.ts 的 T1）；页面上要让用户看到的产品名走 applySiteBrand。 */
export function applyTitle(doc, lang) {
  const name = t(lang, 'app.title')
  try { doc.title = name } catch { /* 无 document（测试） */ }
  return name
}

/** ⑧(2026-09-18 品牌改名) 站点品牌决策（纯函数，便于 Node 断言）。
 *  产品现名 **WEwebLoader**（用户 2026-09-18 亲自给的名字，大小写严格照抄）；
 *  回退时（`?appname=upstream` / `?brand=upstream`）用**上游名**（= DICT 的 `app.title`）。
 *  为什么不直接改静态 HTML 的 `<title>`/DICT/minified 产物：那三处分别被门禁 T5/T8、T1（词典零漂移）与
 *  许可口径（`demo/LICENSE-webwallgl`：minified 产物一个字节不改）钉住 ⇒ 产品名只做**运行期呈现层**覆盖。 */
export function appBrandPlan(env) {
  const e = env || {}
  const upstream = String(e.upstreamTitle == null ? '' : e.upstreamTitle)
  if (e.override === false) return { name: upstream, overridden: false, reason: 'flag-off' }
  const name = String(e.productName == null || e.productName === '' ? 'WEwebLoader' : e.productName)
  return { name, overridden: true, reason: 'product-name' }
}

/** 把站点品牌写进 DOM：只写**品牌名元素**与 `document.title`。
 *  `#app-version`（`v1.3.16`，产物启动时写一次）刻意**不碰** ⇒ 头部仍是「WEwebLoader v1.3.16」。 */
export function applySiteBrand(env) {
  const e = env || {}
  const plan = appBrandPlan(e)
  try { if (e.brandEl) e.brandEl.textContent = plan.name } catch { /* 桩 DOM */ }
  try { if (e.doc) e.doc.title = plan.name } catch { /* 无 document（测试） */ }
  return plan
}

/** data-i18n / data-i18n-ph / data-i18n-title 三类的静态刷新（与源码 applyStatic 等价）。 */
export function applyStaticI18n(root, lang) {
  let n = 0
  for (const el of root.querySelectorAll('[data-i18n]')) { el.textContent = t(lang, el.dataset.i18n); n++ }
  for (const el of root.querySelectorAll('[data-i18n-ph]')) { el.placeholder = t(lang, el.dataset.i18nPh); n++ }
  for (const el of root.querySelectorAll('[data-i18n-title]')) { el.setAttribute('title', t(lang, el.dataset.i18nTitle)); n++ }
  return n
}

/* ══════════ ④(2026-09-24 用户第 4 条)「有范围的显示」通用溢出自检：纯判定层 ══════════════════
   用户原话口径：「凡是"有范围的显示"（面板/下拉/工具条）都要检测是否溢出，并修掉」。
   这一层只做**判定**（Node 可直接喂读数），DOM 侧的取数在 `panelOverflowProbe()`。
   判定规则（逐条可机读，避免"scrollWidth 大了就报红"这种假阳性）：
     · `overflowX/overflowY` = `scrollWidth/scrollHeight` 比 `clientWidth/clientHeight` 大 ≥ 阈值；
     · **可滚动**（computed overflow-x/y 是 auto|scroll）的容器"内容比盒子大"是**设计如此**
       （`#list` / `.bench-dirbox-list` / `#props-body` / `#diag-body` 都是滚动区）⇒ 不算溢出；
     · 不可滚动（hidden/clip/visible）却又超出 ⇒ **裁剪/顶出** ⇒ 必须修（`bad` 里逐条给出）；
     · 直接子元素盒超出容器盒（左右越界 > 0.5px）⇒ 也算（"后面几个选项被顶出屏幕"就是这一类）。 */
export const OVERFLOW_PROBE_SELECTORS = [
  '#bench-fs-dialog', '.bench-dirbox-win', '.bench-dirbox-tools', '.bench-dirbox-roots', '.bench-dirbox-list', '.bench-dirbox-foot',
  '#props', '#props-body', '.props-row', '#np-host', '#np-volbar', '#np-audio',
  '#toolbar', '#editor-chrome', '#editor-tabs', '#wp-panel', '#logs', '#logs .logs-head', '#settings-pop', '#sidebar',
]
/** 一行读数 ⇒ 判定（纯函数；`rows` 的形状见 `panelOverflowProbe()`）。
 *
 *  ⚠口径（第一版实测踩过的两个假阳性，逐条收口；两处都是**更准确**而不是更宽）：
 *   ① **`overflow:visible` 的"溢出"不是裁剪**：内容会画到盒子外面（难看但看得见）。真正的用户痛点
 *      （"后面几个选项根本没显示出来"）只发生在 `hidden`/`clip` 上 ⇒ 只有这两者算 `clipped`（红），
 *      `visible` 的溢出如实记成 `spill`（读数、不红）。
 *   ② **绝对/固定定位的子节点是"浮层"，天然出流**：`#np-host`（NP 卡片+音量条+传输条）就是
 *      `position:absolute;bottom:0` 贴在属性面板底部的（设计如此，见 demo/index.html 的注释）——
 *      拿它的盒去比容器的盒必然"越界"。`overflowRows()` 已经跳过这类子节点（`position` 判据）。
 *    判据：`clipped`（不可滚 + hidden/clip）**必须为 0**；`spill` / `child-out` 原样打印供人读。 */
export function overflowVerdict(rows, opts) {
  const o = opts || {}
  const tol = Number(o.tolerance) >= 0 ? Number(o.tolerance) : 1
  const HIDING = /hidden|clip/
  const bad = []
  const spill = []
  for (const r of (Array.isArray(rows) ? rows : [])) {
    if (!r || !r.present) continue
    const xOver = Number(r.scrollW || 0) - Number(r.clientW || 0) > tol
    const yOver = Number(r.scrollH || 0) - Number(r.clientH || 0) > tol
    const xStyle = String(r.overflowXStyle || '')
    const yStyle = String(r.overflowYStyle || '')
    const xScroll = /auto|scroll/.test(xStyle)
    const yScroll = /auto|scroll/.test(yStyle)
    if (xOver) (HIDING.test(xStyle) ? bad : spill).push({ sel: r.sel, axis: 'x', kind: HIDING.test(xStyle) ? 'clipped' : 'spill', scrollW: r.scrollW, clientW: r.clientW, overflow: xStyle })
    if (yOver) (HIDING.test(yStyle) ? bad : spill).push({ sel: r.sel, axis: 'y', kind: HIDING.test(yStyle) ? 'clipped' : 'spill', scrollH: r.scrollH, clientH: r.clientH, overflow: yStyle })
    for (const off of (r.offenders || [])) {
      const axis = String(off.axis || 'x')
      const hides = HIDING.test(axis === 'x' ? xStyle : yStyle)
      const rec = { sel: r.sel, axis, kind: hides ? 'child-out' : 'spill-out', child: off.sel, right: off.right, boxRight: off.boxRight, overflow: axis === 'x' ? xStyle : yStyle }
      ;(hides ? bad : spill).push(rec)
    }
    void xScroll; void yScroll
  }
  return { bad, spill, ok: bad.length === 0, count: bad.length, spillCount: spill.length }
}

/** 诊断面板状态：静态托管下 /api/diag-stream 404 ⇒ 置灰 + 写明原因（不是只往日志写一行）。 */export function diagOfflineState(httpStatus) {
  const offline = !(httpStatus >= 200 && httpStatus < 300)
  return {
    offline,
    reasonKey: offline ? 'offline.diagReason' : null,
    tagKey: offline ? 'offline.tag' : null,
    disableDiag: offline,
  }
}

/** 尾迹：把 0..1 的注入坐标折线按"越旧越淡越细"算出一段绘制参数（纯函数，便于测试）。 */
export function trailSegments(points, opt) {
  const o = Object.assign({ width: 2, color: '#7dd3fc', max: 24 }, opt || {})
  const pts = (points || []).slice(-o.max)
  const out = []
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]
    const k = i / Math.max(1, pts.length - 1)         // 0=最旧 1=最新
    out.push({ x0: a[0], y0: a[1], x1: b[0], y1: b[1], alpha: 0.08 + 0.72 * k, width: Math.max(0.5, o.width * (0.35 + 0.65 * k)), color: o.color })
  }
  return out
}



/* ============================ C 组：插件实现移植（纯函数层，Node 可测） ============================ */
// 来源：dsh-mpkg-wallpaper/lib/client.js:6654-6760 的 hexToHsv/hsvToHex（同一套数学，逐相位照搬），
//       :929-941 的剪贴板降级思路。只搬思路与视觉，无对插件的运行时依赖。

/** 归一化 hex：接受 #rgb / #rrggbb / 裸 6 位；非法返回 null */
export function normalizeHex(v) {
  const t = String(v == null ? '' : v).trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{3}$/.test(t)) return '#' + t.split('').map((c) => c + c).join('').toLowerCase()
  if (/^[0-9a-fA-F]{6}$/.test(t)) return '#' + t.toLowerCase()
  return null
}

/** #rrggbb → {h:0..360, s:0..1, v:0..1}（与插件 client.js:6673 逐行一致） */
export function hexToHsv(hex) {
  const nx = normalizeHex(hex) || '#808080'
  const n = parseInt(nx.slice(1), 16)
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), dlt = mx - mn
  let hh = 0
  if (dlt !== 0) {
    if (mx === r) hh = ((g - b) / dlt) % 6
    else if (mx === g) hh = (b - r) / dlt + 2
    else hh = (r - g) / dlt + 4
    hh *= 60
    if (hh < 0) hh += 360
  }
  return { h: hh, s: mx === 0 ? 0 : dlt / mx, v: mx }
}

/** {h,s,v} → #rrggbb（与插件 client.js:6679 逐行一致） */
export function hsvToHex(hh, ss, vv) {
  const c = vv * ss, x = c * (1 - Math.abs(((hh / 60) % 2) - 1)), m = vv - c
  let r = 0, g = 0, b = 0
  if (hh < 60) { r = c; g = x } else if (hh < 120) { r = x; g = c } else if (hh < 180) { g = c; b = x }
  else if (hh < 240) { g = x; b = c } else if (hh < 300) { r = x; b = c } else { r = c; b = x }
  const to = (q) => Math.round((q + m) * 255).toString(16).padStart(2, '0')
  return '#' + to(r) + to(g) + to(b)
}

/** 色相条 x∈[0,1] → h、SV 面板 (x,y)∈[0,1]² → (s,v)。纯函数，供指针事件换算与测试。 */
export function pickerFromPointer(hueX, svX, svY) {
  const h = Math.max(0, Math.min(1, hueX)) * 360
  const s = Math.max(0, Math.min(1, svX))
  const v = 1 - Math.max(0, Math.min(1, svY))
  return { h, s, v }
}

/**
 * 剪贴板降级决策（C 组硬要求：http 与 file:// 两种协议都要能用）。
 * 优先级：navigator.clipboard.writeText（需安全上下文）→ document.execCommand('copy')
 *        → 手动兜底（弹出可选中输入框）。
 */
export function clipboardPlan(env) {
  const e = env || {}
  const hasApi = !!e.hasClipboardApi
  const secure = e.isSecureContext !== false        // file:// 下 Chrome 视作 secure，但 clipboard 常缺失
  const canExec = e.hasExecCommand !== false
  if (hasApi && secure) return 'api'
  if (canExec) return 'execCommand'
  return 'manual'
}

/** 错误兜底条要显示的文本（可见性断言用） */
export function errorBannerModel(lang, msg) {
  return { title: t(lang, 'error.title'), message: String(msg == null ? '' : msg).slice(0, 300), note: t(lang, 'error.logged') }
}

/** AbortController 包装：中止后 promise **不 reject**（返回 {aborted:true}），避免未捕获拒绝 */
export function abortable(promise, signal) {
  const st = { aborted: false }
  const p2 = new Promise((resolve) => {
    if (signal && signal.aborted) { st.aborted = true; resolve({ aborted: true }); return }
    const onAbort = () => { st.aborted = true; resolve({ aborted: true }) }
    if (signal) signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve(promise).then(
      (value) => { if (!st.aborted) resolve({ aborted: false, value }) },
      (error) => { if (!st.aborted) resolve({ aborted: false, error }) },
    )
  })
  return { promise: p2, state: st }
}

/* ============================ 第四批纯函数层（主题 / 类型识别 / 无上限 FPS / 本地扫描 / 后端状态） ============================ */

/** ⑫c(2026-09-19 用户要求：「切换深色暗色的地方，你就留两个开关，一个是深色，一个是暗色，不要跟随系统」)
 *  主题**两态**：dark ↔ light。`auto` 不再是可停留的模式，只作为**历史存储值的迁移输入**
 *  （旧版本可能把 'auto' 写进 localStorage）由 normalizeThemeMode 解析成具体一态。
 *  ⚠ `theme.auto` 这个 i18n 键**仍留在 DICT 里**（值不动）：它是上游 `bench/i18n.ts` 的逐键镜像，
 *  `references/vendor-ref/ww-pages/bench-patch.test.mjs` 的 T1 会比对键集与取值 —— 删键即红。
 *  也就是说：**键保留、UI 不再有第三态**（见本文件 init() 里的 applyThemeMode 与 index.html 的两个开关）。 */
export function nextThemeMode(mode) {
  return mode === 'dark' ? 'light' : 'dark'
}

/** auto 解析成实际生效的主题（prefers-color-scheme）—— 现在只服务于**历史 'auto' 的一次性迁移** */
export function resolveTheme(mode, prefersDark) {
  if (mode === 'auto') return prefersDark ? 'dark' : 'light'
  return mode === 'light' ? 'light' : 'dark'
}

/** 主题模式规范化：只允许 dark/light 两态；'auto'/非法值按系统偏好**一次性**落到具体一态（不锁死、不留第三态） */
export function normalizeThemeMode(saved, prefersDark) {
  const raw = String(saved == null ? '' : saved)
  if (raw === 'dark' || raw === 'light') return raw                 // 用户显式选过 ⇒ 照办
  if (raw === 'auto') return resolveTheme('auto', prefersDark)      // 历史值 ⇒ 按系统偏好迁移一次（旧行为）
  /* ①(2026-09-22 用户第 12 条) **从没设过** ⇒ 默认浅色（此前回落到 dark：一进页面就是深色）。
     注意只改"没存过"这一支：显式 dark/light 与历史 'auto' 的语义都逐位不变。 */
  return 'light'
}

/** 从 localStorage 的原始值算出 {mode, theme} —— 两态；非法值 = 按系统偏好迁移一次 */
export function themePlan(saved, prefersDark) {
  const mode = normalizeThemeMode(saved, prefersDark)
  return { mode, theme: resolveTheme(mode, prefersDark) }
}

/** 工具条标签大小写：只在**文本内容与目标仅差大小写**时改写，否则不动（绝不吃掉别的文案） */
export function uppercaseLabel(current, want) {
  const c = String(current == null ? '' : current).trim()
  if (!c) return null
  return c.toLowerCase() === String(want).toLowerCase() ? want : null
}

/** 无上限 FPS 的协议值：渲染器的帧率门是 `now - lastRender >= 1000/fps`（renderer/src/scene-mount.ts:2933），
 *  fps=1000 ⇒ 间隔 1ms，比任何真实 rAF 间隔都小 ⇒ 等价"不跳帧"。
 *  之所以不用 0：渲染器读参数是 `Number(params.get("sceneFps")) || 60`（renderer/src/main.ts:432），
 *  0 会被折回 60 ⇒ 0 表达不了"无上限"。 */
export const FPS_UNCAPPED = '1000'
const FPS_UNCAPPED_MIN = 600

/** 一个 <select id="fps"> 的 value → 上限/无上限的判定与状态栏文案键（纯函数，便于测试） */
export function fpsPlan(value) {
  const n = Number(String(value == null ? '' : value).trim())
  const bad = !isFinite(n) || n <= 0
  const uncapped = !bad && n >= FPS_UNCAPPED_MIN
  const cap = bad ? 60 : n
  return {
    cap,
    uncapped,
    statusKey: uncapped ? 'status.uncapped' : 'status.cap',
    statusParams: uncapped ? null : { n: cap },
    titleKey: uncapped ? 'fps.uncappedTitle' : 'status.capTitle',
  }
}

/** 扫描时自动识别壁纸类型（⑶ 用户要求：不再让用户手选 scene/web/video）。
 *  meta = project.json 解析结果；names = 该目录下的文件名。
 *  优先级：显式 type → 文件证据（scene.pkg / *.html / 视频扩展名）。识别不出返回 null（调用方显示 unknown）。 */
export function detectWallpaperKind(meta, names) {
  const declared = String((meta && meta.type) || '').trim().toLowerCase()
  if (declared === 'gif') return 'video'
  if (declared === 'scene' || declared === 'web' || declared === 'video') return declared
  const list = (names || []).map((x) => String(x).toLowerCase())
  const has = (rx) => list.some((x) => rx.test(x))
  if (has(/^scene\.pkg$/)) return 'scene'
  /* ①(P-261 2026-10-07) **`.mpkg`/`.pkg` 容器族 ⇒ 'scene'**：容器里可能是 scene.json（场景）也可能是
     纯视频（PKGM0014），客户端**不读容器目录表**（那要 ArrayBuffer + 解压），所以这里给"交给渲染器按内容判"
     的档位 —— 渲染器侧 `demo.html` 对 PKG/PKGM 都有原生路径（scene.json → 场景；没有则 MPW-NOSCENE 纯视频）。
     修前：容器名不在任何证据里 ⇒ `unknown`，`planLocalScan` 还会把只含容器的目录**整目录跳过**。 */
  if (has(/\.(mpkg|pkg)$/)) return 'scene'
  if (has(/\.html?$/)) return 'web'
  if (has(/\.(mp4|webm|mov|mkv|gif)$/)) return 'video'
  return declared || null
}

/**
 * 把一次「选择文件夹」拿到的文件列表折成壁纸条目（纯函数，Node 可测；不读文件内容）。
 * entries: [{ path, file?, text? }]，path = webkitRelativePath（目录选择）或 name（单文件）。
 * 返回 { selection, items }：
 *   selection='empty'  没选任何东西（用户取消）
 *   selection='notdir' 浏览器只回传了散文件（**不是目录选择**）⇒ ⑹ 必须给明确提示，不能说"正在读取文件夹"
 *   selection='dir'    确实是目录选择（items 可能为空 = 该目录下没有壁纸）
 * 与旧实现的关键差别：目录按「文件的父目录」分组 ⇒ 同时支持 <根>/<壁纸>/scene.pkg 与 <根>/scene.pkg（浅层）。
 */
export function planLocalScan(entries, opt) {
  const o = Object.assign({ maxItems: 500 }, opt || {})
  const list = (entries || []).filter((e) => e && e.path)
  if (!list.length) return { selection: 'empty', items: [] }
  const dirs = new Map()
  let withDir = 0
  for (const e of list) {
    const parts = String(e.path).split('/').filter(Boolean)
    if (parts.length < 2) continue                 // 根目录下的散文件：不构成壁纸目录
    withDir++
    const dir = parts.slice(0, -1).join('/')
    if (!dirs.has(dir)) dirs.set(dir, [])
    dirs.get(dir).push({ name: parts[parts.length - 1], file: e.file, text: e.text })
  }
  if (!withDir) return { selection: 'notdir', items: [] }
  const items = []
  for (const [dir, files] of dirs) {
    const pkg = files.find((f) => /^scene\.pkg$/i.test(f.name))
    const proj = files.find((f) => /^project\.json$/i.test(f.name))
    /* ①(P-261 2026-10-07) **容器目录逐文件成条**（与 :8902 服务端 `libraryEntriesForDir` 的逐文件成项同口径）：
       真机复现：`选择文件夹` 指向 `<角色>/<角色>_NN.mpkg` 这种布局（或"workshop 目录 + 容器"混合）时，
       旧判据 `!pkg && !proj ⇒ continue` 把**每个只含容器的目录整目录丢掉** ⇒ 用户看到的就是
       "扫描不到 MPKG 文件（包括与 workshop 混合形态下）"。这里按容器逐条成项（`pkg` = 该容器 File，
       `previewLocal()` 会走 `__wp.loadSceneFile(blob)` 直接挂载；本仓渲染器自 P-261 起支持该契约）。
       目录里同时有 `scene.pkg` 时维持旧口径（目录一条），不做重复计数。 */
    const containers = pkg ? [] : files.filter((f) => /\.(mpkg|pkg)$/i.test(f.name))
    if (containers.length) {
      for (const c of containers) {
        const base = c.name.replace(/\.[^.]+$/, '')
        items.push({
          dir: dir + '/' + c.name, dirName: base, container: true,
          pkg: c, proj: proj || null, prev: null,
          names: [c.name], files: [{ name: c.name, file: c.file || null }],
        })
        if (items.length >= o.maxItems) break
      }
      continue
    }
    if (!pkg && !proj) continue                    // 不是壁纸目录（例如 materials/、shaders/）
    // 第五批③：把 preview 图也带上（品牌修复要用它当媒体组件的图标；优先 project.json 里声明的名字）
    const prev = files.find((f) => /^preview\.(gif|png|jpe?g|webp)$/i.test(f.name)) || null
    items.push({
      dir, dirName: dir.split('/').pop(), pkg: pkg || null, proj: proj || null,
      names: files.map((f) => f.name),
      files: files.map((f) => ({ name: f.name, file: f.file || null })),
      prev,
    })
    if (items.length >= o.maxItems) break
  }
  items.sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0))
  return { selection: 'dir', items }
}

/** 后端状态判定（⑦ 用户问"是不是离线导致的"）：把**静态托管**与**离线**分成两件事。
 *  env = { apiStatus, onLine, hostBlocked, online }；apiStatus = /api/library 的 HTTP 状态码（0=网络失败）。
 *  online = 本页是否跑在**线上静态托管**（GitHub Pages 这类不可达的本机后端，见 P-93）；
 *  它只在 static 分支里换文案，node 分支（本机 Node 宿主在）行为一字不变。 */
export function backendMode(env) {
  const e = env || {}
  const onLine = e.onLine !== false
  const api = Number(e.apiStatus)
  const node = isFinite(api) && api >= 200 && api < 300
  if (node) return { mode: 'node', online: onLine, labelKey: 'backend.node', reasonKey: null, howKey: null, blocked: false, deployed: false }
  const deployed = !!e.online
  if (deployed) {
    return {
      mode: 'static',
      online: onLine,
      labelKey: onLine ? 'backend.static' : 'offline.tag',
      reasonKey: onLine ? 'backend.staticTitle' : 'backend.offline',
      howKey: 'backend.demoNoBackend',
      blocked: false,        // 在线版不是"本机被阻断"，而是**设计如此**：不要说"依赖不全"
      deployed: true,
    }
  }
  return {
    mode: 'static',
    online: onLine,
    labelKey: onLine ? 'backend.static' : 'offline.tag',
    reasonKey: onLine ? 'backend.staticTitle' : 'backend.offline',
    howKey: 'backend.online',
    blocked: !!e.hostBlocked,
    deployed: false,
  }
}

/** 侧栏「能不能用 / 为什么不能 / 怎么办」的文案模型（可见性可断言，见 T21） */
export function backendNotice(lang, env) {
  const m = backendMode(env)
  if (m.mode === 'node') return { hidden: true, mode: 'node', label: t(lang, 'backend.node'), lines: [] }
  const lines = [t(lang, m.reasonKey), t(lang, 'backend.alt'), t(lang, m.howKey)]
  if (m.blocked) lines.push(t(lang, 'backend.blocked'))
  return { hidden: false, mode: 'static', label: t(lang, m.labelKey), lines, deployed: m.deployed }
}

/** 诊断区的离线原因行：静态托管 / 离线 两件事分开写清楚（⑺ 用户就是问这个） */
export function diagReasonText(lang, env) {
  const m = backendMode(env)
  if (m.mode === 'node') return ''
  const base = m.deployed ? t(lang, 'offline.diagReasonOnline') : t(lang, 'offline.diagReason')
  return m.online ? base : base + ' · ' + t(lang, 'backend.offline')
}

/* ============================ P-93 在线 demo 纯函数层（线上形态判定 / 路径改写 / 合成样例 / 横幅） ============================ */
/** 站点路径名（P-127：URL 路径 `/wallpaper-engine-webgl/` → `/WEwebLoader/`，用户裁定地址栏也要换）。
 *  ⚠ 这两个常量与 `tools/site-paths.mjs` 的 `SITE_MOUNT` / `SITE_MOUNT_LEGACY` 必须**逐字一致** ——
 *  本文件在产物里独立存在（`tools/` 不进站点），不能 import 那边；一致性由 tests/demo-check.mjs 的 D12 钉住。 */
export const SITE_MOUNT = 'WEwebLoader'
export const SITE_MOUNT_LEGACY = 'wallpaper-engine-webgl'
/** 产物里**不可重建**的 minified 包写死的绝对前缀（`/…/renderer/index.html` 3 处、
 *  `/…/default-wallpaper/index.html`、`/…/sw.js`）：旧名与新名**两种都要认** ——
 *  旧名是产物里实际写着的（改不了），新名是改名后手写/新产物会用的。 */
export const SITE_PATH_ALIASES = ['/' + SITE_MOUNT + '/', '/' + SITE_MOUNT_LEGACY + '/']
/** URL 命中的站点路径前缀（不命中 ⇒ 返回 ''）。 */
export function sitePathAliasOf(url) {
  const s = String(url == null ? '' : url)
  for (const p of SITE_PATH_ALIASES) if (s.indexOf(p) === 0) return p
  return ''
}
/** 合成样例在仓库里的位置（相对**站点根**；demo/ 与 Pages 产物里的 /WEwebLoader/ 都一样）。 */
export const DEMO_SAMPLE_REL = 'samples/sample-synthetic/'
/** 本页相对站点根的层级：demo/、WEwebLoader/（以及旧名软链 wallpaper-engine-webgl/）都是 1 层。 */
export function assetBaseOf(href) {
  const s = String(href == null ? '' : href)
  const m = s.match(/^(https?:\/\/[^/]+)?(\/[^\s?#]*)?/)
  const path = (m && m[2]) || '/'
  const dir = path.endsWith('/') ? path : path.replace(/[^/]*$/, '/')
  return dir
}

/** demo 子路径前缀（相对当前页，带尾斜杠；Pages 与 :8901 都是 './'；根目录时退化成 './'）。
 *  挂载点有三个（`demo/` 规范入口、`WEwebLoader/` 站点路径名、旧名 `wallpaper-engine-webgl/` 软链/重定向页）⇒ 三个都吃掉。 */
export function demoPrefixFor(basePath) {
  const parts = String(basePath || '/').split('/').filter(Boolean)
  const last = parts.length ? parts[parts.length - 1] : ''
  if (last === 'demo' || last === SITE_MOUNT || last === SITE_MOUNT_LEGACY) parts.pop()
  return parts.length ? './' : './'
}

/** 线上静态托管判定（探针/测试同源）：pages 域名 / 非本机 host 两者取或，`?online=0` 可强制关掉。
 *  本机（127.0.0.1 / localhost / ::1 / 0.0.0.0 / *.local / 局域网 IP）一律**不**算在线版 ——
 *  本机静态台 :8901 与 vite 宿主 :1430 仍走老文案（"去跑 pnpm dev"对它们是有意义的）。 */
export function onlineDemoEnv(href, opt) {
  const o = opt || {}
  let location = null
  if (o.location) location = o.location
  else if (typeof window !== 'undefined' && window.location) location = window.location
  const raw = location && location.href ? String(location.href) : String(href == null ? '' : href)
  let host = ''
  try { host = new URL(raw, 'http://127.0.0.1/').hostname } catch { host = '' }
  const forced = String(o.force == null ? '1' : o.force)
  const forcedOff = /^(0|false|off|no)$/i.test(forced)
  const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0' ||
    /\.localhost$/i.test(host) || /\.local$/i.test(host) || /^10\./.test(host) ||
    /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  const pagesHost = /(^|\.)github\.io$/i.test(host)
  const basePath = assetBaseOf(raw)
  return {
    online: !forcedOff && !isLocalHost && host !== '',   // file:// ⇒ host 为空 ⇒ 不算在线版
    host,
    basePath,
    isLocalHost,
    pagesHost,
    demoPrefix: demoPrefixFor(basePath),
  }
}

/** 产物里的几条硬编码绝对路径 → 相对本站的路径。
 *  为什么需要：产物是 minified、**不可重建**的（离线装不上依赖），而它写死了
 *  `/wallpaper-engine-webgl/renderer/index.html`（iframe src，3 处）、
 *  `/wallpaper-engine-webgl/default-wallpaper/index.html`（渲染器页内兜底壁纸）与 `/wallpaper-engine-webgl/sw.js`。
 *  本地静态台恰好在同名路径下（旧名软链仍在，见 docs/ONLINE-DEMO.md §5）⇒ 原样可用；
 *  线上落在 `/demo/` 或 `/WEwebLoader/` ⇒ 必须改写。
 *  ①(P-127 2026-09-19 站点路径改名) 认**旧名与新名两种前缀**（`SITE_PATH_ALIASES`）：产物里写着旧名，
 *  改名后新写的代码用新名 —— 只认一个就会让另一半在线上 404。
 *  本函数只做**一次前缀替换**，其余路径一律返回原文（不认识的 URL 不动）。 */
export function demoAssetUrl(url, prefix) {
  const s = String(url == null ? '' : url)
  const p = String(prefix == null ? './' : prefix)
  const alias = sitePathAliasOf(s)
  if (!alias) return s
  return p.replace(/\/+$/, '') + '/' + s.slice(alias.length)
}

/** 「新窗口」按钮的 URL 改写计划（纯函数；第九批 P-129，Node 可断言，见 tests/open-rewrite-check.mjs）。
 *
 *  为什么需要它：产物（minified、**不可重建**）里 `#open` 的处理器是
 *  `l("#open").onclick=()=>{w&&window.open(`/wallpaper-engine-webgl/renderer/index.html?${wt(w)}`,"_blank")}`
 *  —— 绝对旧路径走 `window.open`。①(P-127) 的 iframe 包装只能拦 `HTMLIFrameElement.prototype.src`，
 *  拦不到这个调用 ⇒ 线上（Pages 是从仓库根发布的**子路径**站点）点「新窗口」指到**域名根** ⇒ 404。
 *
 *  口径（与 iframe 那条**同一套**）：
 *   · 只认本站前缀（`sitePathAliasOf` = 同一张 `SITE_PATH_ALIASES` 真源表，旧名 + 新名两种）
 *     ⇒ 外链 / `blob:` / `data:` / `about:blank` / 相对路径 / 空串一律 `rewritten:false`，
 *     调用方**原样透传**（一个字节都不碰）；
 *   · 命中 ⇒ 走**同一个** `demoAssetUrl`（相对本页；Pages 子路径部署下也对 —— 绝对 `/WEwebLoader/`
 *     才会指到域名根）；改完是相对路径 ⇒ 再跑一次不命中 ⇒ **幂等**；
 *   · `online:false`（本机 :8901）⇒ 不改写：那里的旧路径是**软链**、原样可用（与 ①-a 同口径，
 *     本机行为与上游逐位一致）。
 *  返回 `{url, rewritten, reason}`；未命中时 `url` = 输入的字符串化形式（调用方该传原值，见 installOpenRemap）。 */
export function openUrlPlan(url, opt) {
  const o = opt || {}
  const s = String(url == null ? '' : url)
  const alias = sitePathAliasOf(s)
  if (!alias) return { url: s, rewritten: false, reason: 'not-site-path' }
  if (o.online === false) return { url: s, rewritten: false, reason: 'local-bench' }
  const next = demoAssetUrl(s, String(o.prefix == null ? './' : o.prefix))
  return next === s ? { url: s, rewritten: false, reason: 'unchanged' } : { url: next, rewritten: true, reason: 'site-path' }
}

/** 把「新窗口」那条路包起来（运行期安装；Node 里用**假 window** 直接断言，见 tests/open-rewrite-check.mjs）。
 *
 *  · `window.open(url, target, features)` 三参照传，**参数个数**也照传（按 `arguments.length` 分派）：
 *    规范里三个形参都是"可选 + 有默认值"（`""` / `"_blank"` / `""`），显式传 `undefined` 虽等价，
 *    但把 0 参调用写成 3 参调用只能靠规范推"还是 about:blank"—— 不如原样透传；`length` 属性
 *    也钉回原生值（`window.open.length` 在 Chrome/Firefox 里是 0）。
 *  · `enabled:false`（`?openrewrite=off`）⇒ **不装**（回退口）；已装过（`__benchDemoRemapOpen` 标记）⇒ 不重复包。
 *  · 任何一步失败都只反映在 `{installed, reason}` 里（调用点 console.warn），绝不让"改个 URL"
 *    把新窗口按钮弄坏。 */
export function installOpenRemap(win, opt) {
  const o = opt || {}
  const w = win || (typeof window !== 'undefined' ? window : null)
  if (o.enabled === false) return { installed: false, reason: 'flag-off' }
  if (!w || typeof w.open !== 'function') return { installed: false, reason: 'no-window' }
  if (w.__benchDemoRemapOpen) return { installed: false, reason: 'already' }
  const nativeOpen = w.open.bind(w)
  const online = o.online !== false
  const prefix = String(o.prefix == null ? './' : o.prefix)
  const wrapped = function open(url, target, features) {
    let out = url                       // 未命中 ⇒ 连"字符串化"都不做，原值透传
    try {
      const plan = openUrlPlan(url, { online, prefix })
      if (plan.rewritten) out = plan.url
    } catch { /* 计划算不出来 ⇒ 原样透传（改写失败不许把按钮弄坏） */ }
    switch (arguments.length) {
      case 0: return nativeOpen()
      case 1: return nativeOpen(out)
      case 2: return nativeOpen(out, target)
      default: return nativeOpen(out, target, features)
    }
  }
  try { Object.defineProperty(wrapped, 'length', { value: Number(nativeOpen.length) || 0, configurable: true }) } catch { /* 冻结的宿主：忽略 */ }
  try { w.open = wrapped } catch { return { installed: false, reason: 'readonly' } }
  try { Object.defineProperty(w, '__benchDemoRemapOpen', { value: 1, configurable: true }) } catch {
    try { w.__benchDemoRemapOpen = 1 } catch { /* Object.freeze(window) 这类极端宿主：只影响"重复 init 会不会再包一层" */ }
  }
  return { installed: true, reason: 'ok' }
}

/** 默认壁纸计划：`sample` = 合成样例 URL（相对本页），`auto` = 是否自动挂载。
 *  仓库**不分发任何真实壁纸** ⇒ 默认壁纸只能是自造的合成样例（samples/sample-synthetic/scene.pkg，33 299 B）。
 *  关掉：`?sample=0`（或 false/off/no）。 */
export function defaultSamplePlan(opt) {
  const o = opt || {}
  if (o.force !== undefined && /^(0|false|off|no)$/i.test(String(o.force))) return { auto: false, sample: '', reason: 'disabled' }
  const prefix = String(o.prefix == null ? './' : o.prefix)
  const rel = String(o.rel == null ? DEMO_SAMPLE_REL : o.rel)
  return { auto: true, sample: prefix.replace(/\/+$/, '') + '/' + rel + 'scene.pkg', reason: 'synthetic-sample' }
}

/** 在线版横幅（落地页/测试台共用同一份文案；静态标记与运行期注入都用它，保证同源同义）。 */
export function onlineDemoNotice(lang) {
  return { title: t(lang, 'demo.onlineTitle'), body: t(lang, 'demo.onlineBody'), sample: t(lang, 'demo.onlineSample') }
}

/* ============================ A5/A6 统一下拉工厂（导出以便 Node 测试直接驱动） ============================ */
/** ⑬(2026-09-19 用户要求) 下拉浮层定位计划（纯函数，Node 可断言；输入/输出全是**视口坐标**）。
 *
 *  为什么需要它：`.bench-rd-list` 原来是 `position:absolute`，包含块 = `.bench-rd`（就在 `#toolbar` 里）
 *  ⇒ 被 `#toolbar{overflow-y:auto}`（以及 `#main{overflow:hidden}` / `#props-body{overflow-y:auto}`）
 *  **裁成一块**：展开时菜单不是浮在壁纸上，而是把工具栏撑出一段可滚区域，还能被划到空白处
 *  （真机原话：「不是悬浮在下面看壁纸的地方的，而是单独的一块，我可以给上面这一块划到空白的地方去」）。
 *  改法：`position:fixed` —— `#toolbar` 上没有 transform/filter/contain ⇒ 它不是固定定位后代的包含块，
 *  浮层因此**脱离那些裁剪盒与滚动条**；代价是坐标要自己算，就是本函数。
 *
 *  仍会裁剪固定定位后代的**只剩** `#pages-track{contain:paint}`（它是 header 以下整块区域的包含块），
 *  所以 clip 传 `#pages-track` 的 rect，并把结果夹在它里面。
 *  返回 {left, top, width, maxHeight, placement}：默认贴下方；下方放不下就翻到上方；再不够按可用高度压缩。
 *  参数：btn=触发器 rect；clip=裁剪盒 rect（`#pages-track`，缺省退化成视口）；vp={width,height} 视口；
 *        listH=浮层想占的高度（取 scrollHeight，量不到时用 280 兜底）。 */
export function dropdownLayerPlan(btn, clip, vp, listH) {
  const b = btn || {}
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d)
  const bx = num(b.left, 0), by = num(b.top, 0)
  const bw = Math.max(0, num(b.width, num(b.right, bx) - bx))
  const bh = Math.max(0, num(b.height, num(b.bottom, by) - by))
  const vw = num(vp && vp.width, 0), vh = num(vp && vp.height, 0)
  const cx0 = Math.max(0, num(clip && clip.left, 0)), cy0 = Math.max(0, num(clip && clip.top, 0))
  const cx1 = num(clip && clip.right, vw || cx0 + bw), cy1 = num(clip && clip.bottom, vh || cy0)
  // ⚠ 缝宽 2px（原来是 4px）：用户点名的判据是"列表上/下边缘与触发框的间距 ≤ 2px"。
  //   4px 在缩放 125% 的屏幕上肉眼就是一条"没接上"的缝（真机原话：「与上面的框之间露出后面的画面」）。
  const gap = 2
  const want = Math.max(80, Math.min(320, Math.round(num(listH, 280))))
  const bottom = by + bh
  const below = Math.max(0, Math.floor(Math.min(cy1, vh || cy1) - (bottom + gap)))
  const above = Math.max(0, Math.floor((by - gap) - cy0))
  const placement = below >= Math.min(want, above) ? 'below' : 'above'
  // 下方/上方都不够时也要给一个**可看几行**的高度（80px ≈ 4 行）：宁可溢出裁剪盒，也不要塌成一条缝
  const maxHeight = Math.max(80, Math.min(want, placement === 'below' ? below : above))
  const left = Math.min(Math.max(cx0, bx), Math.max(cx0, Math.min(cx1, vw || cx1) - bw))
  const top = placement === 'below' ? bottom + gap : Math.max(cy0, by - gap - maxHeight)
  // anchorTop/anchorBottom = **贴边锚点**（视口坐标）：below ⇒ 上边缘贴 bottom+gap；above ⇒ 下边缘贴 by-gap。
  //   为什么把两个锚点都返回：上翻时列表的**实测高度**可能小于 maxHeight（选项少 ⇒ 内容比上限矮），
  //   只用 `by - gap - maxHeight` 会留下 (maxHeight - 实测高) 的缝 —— 调用方按 anchorBottom 回锚一次即可。
  // ⚠ `anchorTop`/`anchorBottom` **不取整**：它们是"贴合锚点"，调用方要按视口实际像素对齐
  //   （取整后遇上小数 rect 会做出 2.2px 的缝，正好越过"≤2px"判据 —— 无头实测踩到过）。
  //   `left/top` 仍取整（纯函数几何断言用它们）。
  return {
    left: Math.round(left), top: Math.round(top), width: Math.round(bw), maxHeight: Math.round(maxHeight), placement,
    anchorTop: bottom + gap, anchorBottom: by - gap, minTop: Math.round(cy0),
  }
}

/* `layerFixedOffset()`（fixed 后代的包含块原点）现在的**唯一实现**在 `./mpw-select.js` ——
   本仓两套自绘下拉（`.bench-rd` 与 `mpw_select`）共用同一份，避免两处各写一遍漂移。
   这里 re-export 保持既有的调用面（探针/门禁读 `__benchPatch` 与 `P.layerFixedOffset`）。 */
export { layerFixedOffset }

/* ============================ P-158 外壳 UI 一批（②③⑤⑥⑦⑨⑩ + 类型/库来源）纯函数层 ============================
   用户原话（逐条对应）：
     ②「下拉菜单与触发框之间有缝」                                   → layerFixedOffset（上面）
     ⑤「输出栏收起时把预览切坏 / 预览区本身左右过长」                 → 由 CSS 的容器查询那条承担（无纯函数）
     ⑥「输出这一行最后面没有清空/复制按钮（只有收起后才冒出复制输出）」→ logsViewPlan + 两态可见性断言
     ⑦「渲染器诊断打不开 —— 应该显示 8899 页面下面那个日志」          → parseDiagEvent / diagEntryLine
     ⑨「扫描出来的壁纸一次性全导入（加号前后点不动、触控位置不明）」    → pinnedPlan / trackPin / wpPanelRows
     ⑩「未选目录却默认在 …/allwallpaper/dd」                          → librarySourcePlan
   全部是零 DOM 的纯决策函数 ⇒ `tests/bench-shell-fixes-test.mjs` 可以不进浏览器就把边界钉住。 */

/** 从产物列表项的 `.sub` 文案里取**真实类型**（`${type}${props?` · n 属性`:''} · ${itemId}`）。
 *  为什么要有它：服务端返回的 `type` 大小写不统一（`scene` / `Scene` / `web` / `Web`），
 *  产物把原样字符串写进 `.sub`；用户要求"类型标签要如实显示，不要一律写 scene" ⇒ 统一成小写三档。
 *  返回 'scene' | 'web' | 'video' | 'unknown'。 */
export function kindOfSub(sub) {
  const head = String(sub == null ? '' : sub).split('·')[0].trim().toLowerCase()
  if (head === 'scene' || head === 'web' || head === 'video') return head
  if (head === 'gif' || head === 'mp4') return 'video'
  return 'unknown'
}

/** 规范化 `GET /api/fs/list` 的返回（②⑤ 的库目录对话框用）：目录在前、各自按名字排；纯函数可测。 */
export function fsEntriesPlan(payload) {
  const p = payload && typeof payload === 'object' ? payload : {}
  const rows = []
  for (const e of (Array.isArray(p.entries) ? p.entries : [])) {
    const name = String((e && e.name) || '')
    if (!name) continue
    rows.push({
      name,
      path: String((e && e.path) || ''),
      type: (e && e.type === 'file') ? 'file' : 'dir',
      size: Number(e && e.size) || 0,
      kind: String((e && e.kind) || ''),
    })
  }
  const byName = (a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN')
  const dirs = rows.filter((r) => r.type === 'dir').sort(byName)
  const files = rows.filter((r) => r.type === 'file').sort(byName)
  return { ok: p.ok !== false, path: String(p.path || ''), parent: p.parent == null ? null : String(p.parent), dirs, files, rows: dirs.concat(files) }
}

/** 规范化 `GET /api/fs/roots` 的返回（快捷根）。
 *  服务端契约（`aa2fbd2`）：`{ok,roots:[{label,labels,path,listable}]}`，**home 默认 `listable:false`**
 *  （只读边界默认 = 库根，避免把 `~/.ssh` 之类列出来）⇒ 前端要**灰显 + 给原因**，而不是让用户点了没反应。 */
export function fsRootsPlan(payload) {
  const p = payload && typeof payload === 'object' ? payload : {}
  const roots = []
  for (const r of (Array.isArray(p.roots) ? p.roots : [])) {
    const path = String((r && r.path) || '')
    if (!path) continue
    const listable = !(r && r.listable === false)
    roots.push({
      label: String((r && r.label) || path), path, listable,
      reason: String((r && (r.reason || r.enableHint)) || ''),
    })
  }
  return { ok: p.ok !== false && roots.length > 0, roots }
}

/** ①(P-164) 关闭一个已打开标签的决策（纯函数）：返回**新的固定集合**、是否关的是当前项、以及回落目标。
 *  回落顺序：关闭位置**之后**的第一项；没有就取**最后一项**（位置稳定、不重排）；都没有 ⇒ `fallback:null`
 *  （调用方据此释放舞台）。`closed` 不在集合里时原样返回（幂等：重复点 × 不会误伤别的项）。 */
export function closeTabPlan(pinned, currentId, closedId) {
  const list = (Array.isArray(pinned) ? pinned : []).map((x) => String(x == null ? '' : x)).filter(Boolean)
  const closed = String(closedId == null ? '' : closedId)
  const cur = String(currentId == null ? '' : currentId)
  const at = list.indexOf(closed)
  const rest = list.filter((x) => x !== closed)
  let fallback = null
  if (rest.length) {
    if (at < 0) fallback = rest[0]
    else {
      fallback = null
      for (let i = at + 1; i < list.length; i++) if (list[i] !== closed) { fallback = list[i]; break }
      if (!fallback) fallback = rest[rest.length - 1]
    }
  }
  return { pinned: rest, wasCurrent: !!closed && closed === cur, fallback, closed }
}

/** ③(P-164) "点一个壁纸"的**幂等决策**（纯函数）。跳过是必须的：产物那条 `li.onclick` 会把同一个壁纸
 *  重挂一次（重新取包、进度归零、日志多一条 `Mount`），用户看到的就是"点一下闪一下"。
 *  `targetInList`/`targetIsActive` 由调用方从 `#list li` 上读（列表里没有该项时**不能**跳过 —— 那时要走
 *  "先切类型档、等产物重渲染再点"那条路）。 */
export function switchDecision(currentId, targetId, targetInList, targetIsActive) {
  const want = String(targetId == null ? '' : targetId)
  const cur = String(currentId == null ? '' : currentId)
  const isCurrent = !!want && !!cur && cur === want
  return { id: want, inList: !!targetInList, isCurrent, skip: !!want && !!targetInList && (!!targetIsActive || isCurrent) }
}

/** ④(P-164) "这次移动要不要转发给渲染器"（纯函数）：四条边界一次说清 —— 开关、渲染器入口可用、
 *  舞台上是 **web 档**（渲染器文档里还有一层 iframe，壁纸页自己收原生事件 ⇒ 再注入就是双投递）、
 *  坐标落在舞台矩形内且舞台有非零尺寸。`why` 只为人读/上报。 */
export function pointerForwardPlan(o) {
  const s = o || {}
  //  `enabled` 缺省按**关**（fail-closed）：这个函数的唯一职责就是"要不要动作"，缺参不许当成"要"。
  const f = { enabled: s.enabled === true, hasApi: !!s.hasApi, nested: !!s.nested, inStage: !!s.inStage, hasRect: !!s.hasRect }
  const forward = f.enabled && f.hasApi && !f.nested && f.inStage && f.hasRect
  const why = forward ? 'ok' : (!f.enabled ? 'off' : (!f.hasApi ? 'no-api' : (f.nested ? 'nested-frame' : (f.inStage ? 'no-rect' : 'outside-stage'))))
  return { enabled: f.enabled, hasApi: f.hasApi, nested: f.nested, inStage: f.inStage, hasRect: f.hasRect, forward, why }
}

/** ①(P-164) 关闭标签时"当前那一格"该写什么标题（纯函数）：**列表优先 → 缓存兜底 → 最后才退回 id**。
 *  缓存这一档不能省：回落那一刻 `#list` 可能正好因为切类型档在重渲染（`switchToWallpaper` 会先切档），
 *  只查现列表会拿到空，然后把 id 当标题写进"当前壁纸"那一格（自证 Y7 抓到的就是 `curText = "3327063360"`）。 */
export function titleForId(list, cacheGet, id) {
  const want = String(id == null ? '' : id)
  const it = (Array.isArray(list) ? list : []).find((x) => x && String(x.id) === want)
  const cached = (typeof cacheGet === 'function') ? String(cacheGet(want) || '') : ''
  return (it && it.title) || cached || want
}

/** 「已选/常用」壁纸条的计划（用户第 9 条）：
 *  · `pinned` 是**用户显式固定过**的 id 列表（顺序 = 固定顺序，位置稳定，不再像旧实现那样
 *    "当前项永远排第一 + 加号跟着当前项跑"）；
 *  · 当前项一定算在"已选"里（否则切过去以后就从条上消失），但它由产物自己的 `#current` 呈现 ⇒
 *    不再重复出一个 tab（旧实现会出现两个"当前"）；
 *  · 超出 `max` 的旧项被丢掉（`dropped` 报数，调用方据此回写 localStorage）。
 *  items: [{id, title, sub}]（来自 `#list li[data-id]`）。 */
export function pinnedPlan(pinned, items, currentId, max = 8) {
  const cap = Math.max(1, Number(max) || 8)
  const list = Array.isArray(items) ? items : []
  const byId = new Map(list.filter(Boolean).map((it) => [String(it.id), it]))
  const order = []
  for (const raw of (Array.isArray(pinned) ? pinned : [])) {
    const id = String(raw == null ? '' : raw)
    if (id && !order.includes(id)) order.push(id)
  }
  const cur = String(currentId == null ? '' : currentId)
  if (cur && !order.includes(cur)) order.push(cur)
  const ids = order.slice(0, cap)
  const tabs = ids.filter((id) => id !== cur).map((id) => {
    const it = byId.get(id) || {}
    return { id, title: String(it.title || id), kind: kindOfSub(it.sub), active: false }
  })
  return { ids, tabs, dropped: Math.max(0, order.length - ids.length), current: cur || null }
}

/** 固定/取消固定一条（返回**新数组**，调用方负责持久化）。已固定的保持原位（位置稳定）。 */
export function trackPin(pinned, id, on, max = 8) {
  const cap = Math.max(1, Number(max) || 8)
  const want = String(id == null ? '' : id)
  const cur = (Array.isArray(pinned) ? pinned : []).map((x) => String(x == null ? '' : x)).filter(Boolean)
  if (!want) return cur
  const rest = cur.filter((x) => x !== want)
  if (!on) return rest
  rest.push(want)
  return rest.length > cap ? rest.slice(rest.length - cap) : rest
}

/** 库列表面板（显式展开）的行计划：真实类型标签 + 是否已固定。 */
export function wpPanelRows(items, pinned) {
  const pin = new Set((Array.isArray(pinned) ? pinned : []).map((x) => String(x == null ? '' : x)))
  return (Array.isArray(items) ? items : []).filter(Boolean).map((it) => {
    const id = String(it.id == null ? '' : it.id)
    const kind = kindOfSub(it.sub)
    return { id, title: String(it.title || id), kind, pinned: pin.has(id), tag: kind === 'unknown' ? '?' : kind }
  })
}

/** 输出面板的两个视图（用户第 6/7 条）：返回该显示谁、复制按哪个取文本。
 *  `view`: 'logs'（补丁日志 + 产物日志，默认）| 'diag'（渲染器诊断流 `/api/diag-stream`）。 */
export function logsViewPlan(view) {
  const v = (view === 'diag' || view === 'debug') ? view : 'logs'
  return {
    view: v,
    isDiag: v === 'diag',
    isLogs: v === 'logs',
    isDebug: v === 'debug',
    copySelector: v === 'diag' ? '#diag-body' : (v === 'debug' ? '#dbg-log' : '#logbody'),
    clearSelector: v === 'diag' ? '#diag-body' : (v === 'debug' ? '#dbg-log' : '#logbody'),
  }
}

/** 一条 `/api/diag-stream`（SSE）事件的展示模型。容错：非 JSON 的 `data:` 原样当消息。
 *  服务端形状（`server/we-scene-demo-server-8902.mjs`）：`data: {"seq","ts","msg","level","source"}`。 */
export function diagEntryLine(evt) {
  const e = (evt && typeof evt === 'object') ? evt : {}
  const msg = String(e.msg == null ? '' : e.msg)
  const tsNum = Number(e.ts)
  let clock = ''
  if (Number.isFinite(tsNum) && tsNum > 0) {
    const d = new Date(tsNum)
    const p2 = (n) => String(n).padStart(2, '0')
    clock = p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds())
  }
  const seqNum = Number(e.seq)
  const seq = Number.isFinite(seqNum) && seqNum > 0 ? '#' + seqNum : ''
  const level = String(e.level || (/fail|error|ERROR|失败/.test(msg) ? 'error' : 'info'))
  const source = String(e.source || 'renderer')
  return {
    clock, seq, level, source, msg,
    line: [clock, seq, '[' + source + ']'].filter(Boolean).join(' ') + ' ' + msg,
  }
}

/** 解析一条 SSE `data:` 载荷（服务端只在 `data:` 里放 JSON；坏数据不抛，退化成纯文本一行）。 */
export function parseDiagEvent(raw) {
  const s = String(raw == null ? '' : raw).trim()
  if (!s) return null
  try {
    const j = JSON.parse(s)
    return diagEntryLine((j && typeof j === 'object') ? j : { msg: s })
  } catch { return diagEntryLine({ msg: s }) }
}

/** 「当前库来源」的展示计划（用户第 10 条）。**不许假装已选**：
 *   · `backend=false`（静态托管 / 无 /api）      → 'none'    ：库不可用，来源未知
 *   · `source==='user'` 或 localStorage 里有用户选过的目录 → 'user'   ：用户选的目录
 *   · 服务端给了 dir 但**没有任何用户选择记录**    → 'default'：**本机默认目录**（服务端内置）
 *   · dir 为空                                   → 'empty'  ：库为空
 *  `path` 是"要显示出来的那份路径"；`labelKey` 交给词典。 */
export function librarySourcePlan(lang, o) {
  const x = (o && typeof o === 'object') ? o : {}
  const dir = String(x.dir || '')
  const chosen = String(x.chosen || '')
  const source = String(x.source || '')
  const backend = !!x.backend
  let kind = 'none'
  // 服务端五档（`/api/library-source`）：user = 用户选的；env/cli/default = **不是用户选的**（本机默认口径）；
  //  none = 没有库；空 dir 也算空。`chosen`（localStorage 里有用户选择记录）只在服务端没给 source 时兜底。
  if (backend) {
    if (source === 'none') kind = 'empty'
    else if (source === 'user') kind = 'user'
    else kind = (dir ? (chosen && !source ? 'user' : 'default') : 'empty')
  }
  const path = kind === 'user' ? (chosen || dir) : dir
  const key = 'libsrc.' + kind
  return { kind, key, path, label: t(lang, key), hint: t(lang, key + '.hint'), pathShown: path || t(lang, key + '.path') }
}

/* ============================ P-160 web 壁纸 WE shim（纯函数层） ============================
   背景（真机实测）：`/api/library` 里的 web 档挂到舞台上时，渲染器打印
   「网页壁纸：同源入口未检测到 WE shim（host 未注入？）」 —— 因为 minified 渲染器对**同源**入口走的是
   "直接 frame，等宿主注入 shim"那条路（`cw(src)` 为真 ⇒ `bo(..., {injected:true})`），而宿主（本测试台）
   从来没注入过。渲染器自己在**跨源**那条路上有一份完整 shim（模块内字符串常量，44.8 KB），
   并且会在注入时打 `<script data-we-shim-src="1">` 标记。
   ⇒ 本批的做法：**把渲染器自带的那份 shim 从它自己的产物里取出来**（不抄第三方代码、契约天然一致），
   在 web 档挂载时把入口 HTML 改写成"shim 在最前"的 blob 文档（= 渲染器跨源那条路的等价物）。
   下面四个纯函数把"取 shim / 判要不要注入 / 怎么注入"从 DOM 里剥出来，Node 可直接断言。 */

/** 产物注入 shim 时打的标记（与渲染器 `L1()` 里的 `Bu` 同字）——也用作"已注入过"的幂等判据。 */
export const WEB_SHIM_MARK = 'data-we-shim-src'
/** 渲染器产物里那份 shim 字符串常量的开头（用来在 minified 文本里定位它）。 */
export const WEB_SHIM_HEAD = 'WE 网页壁纸兼容 shim（注入到 iframe'

/** 还原一个**模板字符串字面量**里的转义（`\n` / `\t` / ``\` `` / `\\` / `\uXXXX` …）。
 *  为什么需要：shim 在产物里是 ``const XX=`…` `` 形态，直接拿到的文本带着转义序列，
 *  必须还原成真实字符才能当源码注入（`new Function` 也能算，但那要 eval 一段外部文本 —— 这里不 eval）。 */
export function decodeTemplateLiteral(raw) {
  const map = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0', '`': '`', $: '$', '\\': '\\' }
  return String(raw == null ? '' : raw).replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (m, esc) => {
    if (esc[0] === 'u' || esc[0] === 'x') { try { return JSON.parse('"' + m + '"') } catch { return esc } }
    return Object.prototype.hasOwnProperty.call(map, esc) ? map[esc] : esc
  })
}

/** 从渲染器产物文本里取出**它自带的** WE shim 源码（找不到 ⇒ null，调用方走"如实报做不到"）。
 *  定位方式：先找注释头 `WEB_SHIM_HEAD`，再向左找包裹它的反引号（跳过转义），向右找未转义的反引号。 */
export function shimFromRendererSource(src) {
  const s = String(src == null ? '' : src)
  const mi = s.indexOf(WEB_SHIM_HEAD)
  if (mi < 0) return null
  const start = s.lastIndexOf('`', mi)
  if (start < 0) return null
  let i = start + 1
  let end = -1
  while (i < s.length) {
    const c = s[i]
    if (c === '\\') { i += 2; continue }
    if (c === '`') { end = i; break }
    i++
  }
  if (end < 0) return null
  const shim = decodeTemplateLiteral(s.slice(start + 1, end))
  // 契约钉子：shim 必须真的提供父页控制面（少一个就说明取错了东西）
  return (shim && shim.indexOf('__weSetPaused') >= 0 && shim.indexOf('wallpaperPropertyListener') >= 0) ? shim : null
}

/** 一个 iframe 的 `src` 要不要注入 shim（纯决策）。
 *   · 跨源 ⇒ **不做**（做不到就如实说，`reason:'cross-origin'`；不静默假装成功）
 *   · `about:`/`blob:`/`data:` ⇒ 不碰
 *   · 同源且路径像 web 入口（`/web/**` 或 `*.html`）⇒ 注入，并给出 `<base href>`（blob 文档相对路径要靠它）
 *  @returns {{needsShim:boolean, reason:string, entryUrl?:string, baseHref?:string, dir?:string}} */
export function webShimPlan(url, opt) {
  const o = opt || {}
  const raw = String(url == null ? '' : url)
  if (!raw) return { needsShim: false, reason: 'empty' }
  if (/^(about:|blob:|data:|javascript:|mailto:|#)/i.test(raw)) return { needsShim: false, reason: 'non-http' }
  let u = null
  try { u = new URL(raw, o.base || 'http://placeholder.invalid/') } catch { return { needsShim: false, reason: 'bad-url' } }
  if (o.origin && u.origin !== o.origin) return { needsShim: false, reason: 'cross-origin' }
  /* ⑥(2026-09-23) **宿主让位**：渲染器页自己声明了会挂 web 帧且 shim 由服务端注入
     （`window.__mpwWebPath.serverInjects`）⇒ 这里一个字节都不动，交给它自己走原始 URL。
     为什么要让：旧的 blob 通路会把服务端已注入的入口再包一层（双重 shim），真机实测还会计一次注入失败。 */
  if (o.hostInjects) return { needsShim: false, reason: 'host-injects' }
  const isWebPath = /\/web\//i.test(u.pathname)
  const isHtml = /\.html?$/i.test(u.pathname)
  if (!isWebPath && !isHtml) return { needsShim: false, reason: 'not-web-entry' }
  const dir = u.pathname.replace(/[^/]*$/, '')
  return { needsShim: true, reason: 'web-entry', entryUrl: u.href, baseHref: u.origin + dir, dir }
}

/** 一段文本像不像 HTML（取回来的可能是 JSON/二进制 ⇒ 那就别注入，退回裸 iframe）。 */
export function looksLikeHtml(text) {
  const t = String(text == null ? '' : text).replace(/^\uFEFF/, '').trimStart().slice(0, 400).toLowerCase()
  return t.startsWith('<!doctype') || t.startsWith('<html') || t.startsWith('<head') || t.startsWith('<body') || t.startsWith('<!--') || t.startsWith('<')
}

/** 把 shim（+ `<base>`）插进入口 HTML 的**最前面**（`<head>` 之后；没有 head 就补一个）。
 *  幂等：文本里已有 `data-we-shim-src` / `data-we-shim` 标记 ⇒ 原样返回（`injected:false`）。
 *  `</script` 一律转义成 `<\/script`（与渲染器 `Ru()` 同口径）—— 否则 shim 里出现的该串会提前闭合标签。 */
export function injectShimIntoHtml(html, opt) {
  const o = opt || {}
  const src = String(html == null ? '' : html)
  const shim = String(o.shim || '')
  const mark = String(o.mark || WEB_SHIM_MARK)
  if (!shim) return { ok: false, reason: 'no-shim', html: src, injected: false }
  if (src.indexOf(mark) >= 0 || src.indexOf('data-we-shim=') >= 0) return { ok: true, reason: 'already', html: src, injected: false }
  if (!looksLikeHtml(src)) return { ok: false, reason: 'not-html', html: src, injected: false }
  const esc2 = (t) => String(t).replace(/<\/script/gi, '<\\/script')
  const base = (o.baseHref && !/<base\b/i.test(src)) ? '<base href="' + String(o.baseHref).replace(/"/g, '&quot;') + '">' : ''
  const tag = '<script ' + mark + '="1">\n' + esc2(shim) + '\n<\/script>'
  const add = base + tag
  const head = /<head(\s[^>]*)?>/i.exec(src)
  if (head) { const at = head.index + head[0].length; return { ok: true, reason: 'head', html: src.slice(0, at) + add + src.slice(at), injected: true } }
  const htmlTag = /<html(\s[^>]*)?>/i.exec(src)
  if (htmlTag) { const at = htmlTag.index + htmlTag[0].length; return { ok: true, reason: 'html', html: src.slice(0, at) + '<head>' + add + '</head>' + src.slice(at), injected: true } }
  return { ok: true, reason: 'wrap', html: '<!DOCTYPE html><html><head>' + add + '</head><body>' + src + '</body></html>', injected: true }
}

/* ── P-164 调试模式（纯函数层）────────────────────────────────────────────────────────
   三件事都抽成纯函数 ⇒ 键位路由、图层步进、上报载荷的形状都能在 Node 里钉死（无需浏览器）；
   运行期那层只负责"装/卸监听 + 读写 DOM + 发请求"。 */

/** 「调试模式」的键位路由：只有**激活期间**才接管，且接管的那几个键必须被吞掉（用户明确要求）。 */
export function debugKeyPlan(key, state) {
  const s = state || {}
  const on = s.active !== false
  const k = String(key == null ? '' : key)
  //  未激活 ⇒ 一个键都不碰（退出调试要**恢复默认行为**：不许留全局拦截）
  if (!on) return { capture: false, op: null, key: k }
  const map = {
    ArrowRight: 'next', ArrowLeft: 'prev', ArrowUp: 'next10', ArrowDown: 'prev10',
    Control: 'toggleGroup', Alt: 'exit', Home: 'reset', Escape: 'exit',
  }
  const op = map[k]
  if (!op) return { capture: false, op: null, key: k }
  //  Alt/Ctrl 是**组合键修饰位**：调试期间连它们自己按下也要吞（否则浏览器的默认行为会漏出去）
  return { capture: true, op, key: k, swallowModifier: k === 'Alt' || k === 'Control' }
}

/** 组合层树：由渲染器层表的 `children`（下标数组）或 `parent`（对象 id）推出"父下标 → 孩子下标[]"。
 *  两种口径都兼容（WE scene.json 原生是 `parent`）；推不出层级 ⇒ 空树（Ctrl 只会如实提示"没有子层"）。 */
export function layerTreeOf(layers) {
  const L = Array.isArray(layers) ? layers : []
  const kids = new Map()
  const byId = new Map()
  for (let i = 0; i < L.length; i++) { const id = L[i] && L[i].id; if (id !== undefined && id !== null) byId.set(String(id), i) }
  for (let i = 0; i < L.length; i++) {
    const l = L[i] || {}
    if (Array.isArray(l.children) && l.children.length) {
      const arr = l.children
        .map((c) => (typeof c === 'number' ? c : (c && c.id !== undefined ? byId.get(String(c.id)) : null)))
        .filter((x) => Number.isInteger(x) && x >= 0 && x < L.length && x !== i)
      if (arr.length) { kids.set(i, arr); continue }
    }
    const p = l.parent
    if (p === undefined || p === null || p === -1) continue
    let pi = -1
    if (byId.has(String(p))) pi = byId.get(String(p))
    else if (Number.isInteger(p) && p >= 0 && p < L.length) pi = p
    if (pi >= 0 && pi !== i) { if (!kids.has(pi)) kids.set(pi, []); kids.get(pi).push(i) }
  }
  return kids
}
/** 当前层级上下文：path 空 ⇒ 顶层（不属于任何父层）；否则 ⇒ path 末端那层的子层。 */
export function layerLevelOf(layers, path) {
  const L = Array.isArray(layers) ? layers : []
  const kids = layerTreeOf(L)
  const child = new Set()
  for (const arr of kids.values()) for (const i of arr) child.add(i)
  if (!Array.isArray(path) || !path.length) {
    const list = []
    for (let i = 0; i < L.length; i++) if (!child.has(i)) list.push(i)
    return { kids, list, group: -1 }
  }
  const g = path[path.length - 1]
  return { kids, list: (kids.get(g) || []).slice(), group: g }
}
/** Ctrl 的**唯一**判定：进入（当前层有子层）还是退出（在组内）还是不动。纯函数，可 Node 断言。 */
export function debugGroupPlan(layers, index, path) {
  const L = Array.isArray(layers) ? layers : []
  const p = Array.isArray(path) ? path.slice() : []
  const lv = layerLevelOf(L, p)
  const inner = index >= 0 && lv.list.indexOf(index) >= 0
  if (inner && (lv.kids.get(index) || []).length) {
    return { op: 'enter', path: p.concat([index]), index: (lv.kids.get(index) || [])[0] }
  }
  if (p.length) return { op: 'exit', path: p.slice(0, -1), index: p[p.length - 1] }
  return { op: 'none', path: p, index }
}

/** 图层步进：只返回**新索引**（数组长度与当前索引都越界安全）；`null` = 没有图层可切。 */
export function layerStepPlan(count, cur, dir) {
  const n = Math.max(0, Math.floor(Number(count) || 0))
  if (n <= 0) return { index: -1, count: 0, wrapped: false }
  const step = Math.trunc(Number(dir) || 0)
  const c = Number.isFinite(Number(cur)) ? Math.trunc(Number(cur)) : -1
  if (c < 0) return { index: step >= 0 ? 0 : n - 1, count: n, wrapped: false }
  let i = c + step
  let wrapped = false
  if (i >= n) { i %= n; wrapped = true }
  while (i < 0) { i += n; wrapped = true }
  return { index: i, count: n, wrapped }
}

/** 当前图层的一行摘要（层号/层名/类型/可见性）；拿不到就给出**为什么**（不编造）。 */
export function layerInfoPlan(layers, index) {
  const list = Array.isArray(layers) ? layers : null
  if (!list) return { ok: false, count: 0, index: -1, text: '没有可逐层查看的场景（未挂载 / 场景加载中 / WebGL 不可用）' }
  if (!list.length) return { ok: false, count: 0, index: -1, text: '场景已挂载，但没有图层' }
  const i = Math.max(0, Math.min(list.length - 1, Math.trunc(Number(index) || 0)))
  const l = list[i] || {}
  const name = String((l && (l.name || l.id)) == null ? '' : (l.name || l.id))
  const type = String((l && (l.type || l.kind)) == null ? '' : (l.type || l.kind))
  const vis = !(l && l.visible === false)
  return {
    ok: true, count: list.length, index: i,
    id: l && l.id != null ? String(l.id) : '', name, type, visible: vis,
    text: '图层 ' + (i + 1) + '/' + list.length + ' · ' + name + (type ? ' · ' + type : '') + (vis ? '' : ' · 已隐藏'),
  }
}

/* ── P-240（2026-10-06 任务书 §2）图层开关：纯函数 ─────────────────────────────────
   「图层开关」下拉把"这一层要不要参与合成"落到渲染层的 `__lnHidden`（与 `?ln=` 逐层调试
   同一条约定：core 的绘制循环每帧 `if (layer.__lnHidden) continue`，没有任何一帧会重算它 ⇒
   宿主写进去就稳定生效）。这一组纯函数只做状态换算（URL ⇄ 隐藏集、重挂载对账、行数据、
   复制文案），碰不到 DOM/iframe ⇒ Node 门禁直接跑真代码。 */

/** 层的显示名：`name` 优先，空则 `id`，再空 `#下标`（与 `layerInfoPlan` 的 `name||id` 兜底同序）。 */
export function layerDisplayName(layer, i) {
  const name = layer && layer.name != null ? String(layer.name).trim() : ''
  if (name) return name
  const id = layer && layer.id != null ? String(layer.id).trim() : ''
  return id || ('#' + i)
}

/** `?hide=1,4,7` 的**值** → 升序去重的下标数组。只收非负整数 token，垃圾丢弃；
 *  上限 4096 个 token（防病态 URL 撑爆正则/集合）；`null`/空 ⇒ `[]`（= 全显示）。 */
export function parseHideParam(v) {
  if (v == null) return []
  const out = new Set()
  const parts = String(v).split(',')
  for (const p of parts.slice(0, 4096)) {
    const s = p.trim()
    if (!/^\d{1,7}$/.test(s)) continue
    const n = Number(s)
    if (Number.isSafeInteger(n)) out.add(n)
  }
  return [...out].sort((a, b) => a - b)
}

/** 隐藏集 → URL 值（`parseHideParam` 的逆）；空集 ⇒ `''`（调用方据此**删除**参数，不写空值）。 */
export function formatHideParam(indices) {
  return [...new Set((Array.isArray(indices) ? indices : [])
    .map((n) => Math.trunc(Number(n)))
    .filter((n) => Number.isSafeInteger(n) && n >= 0))]
    .sort((a, b) => a - b).join(',')
}

/** 下拉的行数据：`[{i, name, isContainer}]`。容器层照样列出（逐层排查时要知道它存在），
 *  但它的 checkbox 置灰 —— 容器只承载父子链/定位，不参与绘制，`__lnHidden` 对它无意义。
 *  ①(2026-10-11 用户第 2 条) 实现**收敛到唯一口径 `layerSwitchState()`**（P-240 台账点名过本函数；
 *  留作兼容壳，避免"两套行数据"漂移：可显示性/文件语义都以后者为准）。 */
export function layerSwitchEntries(layers) {
  return layerSwitchState(layers, [], []).rows.map((r) => ({ i: r.i, name: r.name, isContainer: r.isContainer }))
}

/** 重挂载对账（任务书 §2.1：重挂载后 `__sceneLayers` 是**新数组** ⇒ 按"下标 + 层名"重新对上，
 *  保留用户的勾选状态）。口径：旧隐藏集里的下标 i，只有当新数组**确实有**第 i 层、且它的显示名
 *  与隐藏时记下的名字**一致**才保留；否则放弃 —— 宁可少隐藏，不能把无关层藏掉。 */
export function rematchHiddenIndices(prevIndices, prevNames, layers) {
  const list = Array.isArray(layers) ? layers : []
  const names = (prevNames instanceof Map)
    ? prevNames
    : new Map(Object.entries(prevNames || {}).map(([k, v]) => [Number(k), String(v)]))
  const kept = []
  for (const raw of (prevIndices || [])) {
    const i = Math.trunc(Number(raw))
    if (!Number.isSafeInteger(i) || i < 0 || i >= list.length) continue
    if (names.has(i) && layerDisplayName(list[i], i) !== names.get(i)) continue
    kept.push(i)
  }
  return [...new Set(kept)].sort((a, b) => a - b)
}

/** 隐藏集 → 逐层 `__lnHidden` 写入计划（**兼容壳**：容器层永远 `hidden:false`，绘制判据本来就不认它）。
 *  ①(2026-10-11 用户第 2 条) 实现**收敛到唯一口径 `layerSwitchState()`** —— 旧写法只看 `isContainer`，
 *  与"可显示性（容器/光源/无绘制源）"那套判据会各说各话；现在两者共用一份计划（P-240 台账点名过本函数）。 */
export function layerHidePlan(layers, hiddenSet) {
  return layerSwitchState(layers, hiddenSet, []).plan.map((p) => ({ i: p.i, hidden: p.hidden }))
}

/** 「复制当前状态」的文案：第一行 = 带 `?hide=` 的完整 URL（别人直接打开就能复现），
 *  第二行 = 隐藏层清单（下标 + 层名）。`url` 缺失时退化为裸 `?hide=…` 片段（判据好断言）。
 *  ①(2026-10-11 用户第 2 条) 追加第三行：**强制显示**清单（`__lnShown` 的层）—— 它们由"文件里
 *  `visible:false` + 用户勾上"产生，**写不进 URL** ⇒ 不写出来对方就复现不出同一张图（可复现承诺的
 *  最后一块）。`forcedIndices` 缺省 = 空 ⇒ 第三行不出现，旧调用方的文案逐字不变。 */
export function layerSwitchCopyPlan(url, hiddenIndices, names, totalLayers, forcedIndices, forcedNames) {
  const idx = [...new Set((Array.isArray(hiddenIndices) ? hiddenIndices : [])
    .map((n) => Math.trunc(Number(n)))
    .filter((n) => Number.isSafeInteger(n) && n >= 0))].sort((a, b) => a - b)
  const v = idx.join(',')
  const base = String(url || '')
  let line1
  if (!base) {
    line1 = v ? ('?hide=' + v) : '(no hide param)'
  } else {
    const qAt = base.indexOf('?')
    const head = qAt >= 0 ? base.slice(0, qAt) : base
    const kept = (qAt >= 0 ? base.slice(qAt + 1) : '').split('&').filter((s) => s && s.split('=')[0].toLowerCase() !== 'hide')
    line1 = head + (kept.length || v ? '?' + kept.concat(v ? ['hide=' + v] : []).join('&') : '')
  }
  const namesMap = (names instanceof Map)
    ? names
    : new Map(Object.entries(names || {}).map(([k, w]) => [Number(k), String(w)]))
  const items = idx.map((i) => '#' + i + ' ' + (namesMap.get(i) != null ? namesMap.get(i) : '?'))
  const total = Math.max(0, Math.trunc(Number(totalLayers)) || 0)
  const line2 = 'hide=' + v + '（隐藏 ' + idx.length + '/' + total + ' 层）: ' + (items.join('; ') || '（无）')
  const fIdx = [...new Set((Array.isArray(forcedIndices) ? forcedIndices : [])
    .map((n) => Math.trunc(Number(n)))
    .filter((n) => Number.isSafeInteger(n) && n >= 0))].sort((a, b) => a - b)
  const fMap = (forcedNames instanceof Map)
    ? forcedNames
    : new Map(Object.entries(forcedNames || {}).map(([k, w]) => [Number(k), String(w)]))
  const fItems = fIdx.map((i) => '#' + i + ' ' + (fMap.get(i) != null ? fMap.get(i) : '?'))
  const line3 = 'shown=' + fIdx.join(',') + '（强制显示 ' + fIdx.length + ' 层，**不在 URL 里**）: ' + (fItems.join('; ') || '（无）')
  const text = fIdx.length ? (line1 + '\n' + line2 + '\n' + line3) : (line1 + '\n' + line2)
  return { param: v, url: line1, list: line2, shown: fIdx.join(','), shownList: line3, text }
}

/* ── ①(2026-10-11 用户第 1/2 条) 图层开关两处修复的纯函数（Node 门禁直跑真代码）──────────────
   背景（用户 :8902 实测）：① 勾选面板右侧有一部分**超出屏幕**；② 除 mp3 等不可显示项外**所有层都被
   勾上**（含 `scene.json` 里 `visible:false` 的），但**勾上之后该层并没有真的显示**。
   两条根因：勾选态**从不读** `visible`（只跟 `?hide=` 走）＋ 写入通道只有"隐藏"（`__lnHidden`）而
   **没有"强制显示"**（新增 `__lnShown`，与 `__lnHidden` 同一处的绘制期判据）。
   本组纯函数把"勾选态 ⇄ 渲染写入"收成**一份**口径：`layerSwitchState()` 同时产出 UI 行数据与
   `__lnHidden`/`__lnShown` 写入计划 ⇒ 勾选态与画面不可能再各说各话。 */

/** 一层的**绘制源类别**（与 core 的 `__srcStats` 分类同序：`core/we-scene-bundle.js:1873-1878`、`:2002`）：
 *  `container` = composelayer（无效果链时不绘制；**带效果链时是效果载体、要画**，P-231）/
 *  `particle` / `text` / `image`（含 model/solid：`__imageKey` 与 `image` 同源）/ `light`（只喂光照
 *  uniform，**不画像素**，"light 层不进 draw"）/ `effect`（只有效果链）/ `none`。
 *  「不可显示」= `container` / `light` / `none`。语料里的 **sound 层**（`o.sound != null`，无 image/model/
 *  particle/text）正落在这里：`parseScene` 不把 `sound` 字段带进 `__sceneLayers` ⇒ 它在页面上表现为
 *  "无任何绘制源"，就是用户说的「mp3 等不可显示项」。 */
export function layerDrawKind(layer) {
  const l = layer || {}
  const fx = !!(l.effects && l.effects.length)
  if (l.isContainer) return fx ? 'container-fx' : 'container'
  if (l.particle) return 'particle'
  if (l.__text) return 'text'
  if (l.__imageKey || l.image) return 'image'
  if (l.light || l.__light) return 'light'
  if (fx) return 'effect'
  return 'none'
}

/** 该层在当前渲染器里**可能画出像素**吗（不可显示的层：缺省不勾 + checkbox 置灰）。 */
export function layerDrawable(layer) {
  const k = layerDrawKind(layer)
  return k !== 'container' && k !== 'light' && k !== 'none'
}

const lswIdxSet = (v) => (v instanceof Set ? new Set(v) : new Set(Array.isArray(v) ? v : []))

/** **唯一口径**：层数组 + 用户隐藏集（= `?hide=` 那一个）+ 用户强制显示集 → 行数据 + 渲染写入计划 + 计数。
 *   · `fileVisible` 读的是**渲染器自己算好的** `layer.visible`（core 装载时 `evalVisibleOutcome` 的落盘值，
 *     `core/we-scene-bundle.js:3606-3625`）—— 这里**不重写**第二套可见性口径，只做 `!== false` 的读；
 *   · `checked = 可显示 && !hidden && (fileVisible || shown)` ⇒ **缺省勾选态 = 文件语义**（文件里 false 的不勾）；
 *   · `plan[i] = {hidden, shown}`：`hidden` 写 `__lnHidden`（绘制期跳过）、`shown` 写 `__lnShown`
 *     （绘制期**强制显示**，覆盖 `visible:false`）。两个标记**每层都显式赋值**（不适用时写 `false`），
 *     否则"取消勾选后标记残留"会让层永远亮着（幽灵显示）—— `lswApply()` 的消费点靠这条；
 *   · `hiddenCount` / `drawableCount` 只数**可显示**的层（状态行的"隐藏 n/m 层"读这条）。 */
export function layerSwitchState(layers, hiddenIndices, shownIndices) {
  const list = Array.isArray(layers) ? layers : []
  const hidden = lswIdxSet(hiddenIndices)
  const shown = lswIdxSet(shownIndices)
  const rows = []
  const plan = []
  let checkedCount = 0, hiddenCount = 0, forcedCount = 0, fileHiddenCount = 0, undrawableCount = 0
  for (let i = 0; i < list.length; i++) {
    const l = list[i] || {}
    const kind = layerDrawKind(l)
    const drawable = kind !== 'container' && kind !== 'light' && kind !== 'none'
    const fileVisible = l.visible !== false
    if (!drawable) undrawableCount++
    if (drawable && !fileVisible) fileHiddenCount++
    const isHidden = drawable && hidden.has(i)
    const isForced = drawable && !fileVisible && shown.has(i)
    const checked = drawable && !isHidden && (fileVisible || isForced)
    if (checked) checkedCount++
    if (drawable && !checked) hiddenCount++
    if (isForced) forcedCount++
    rows.push({
      i, name: layerDisplayName(l, i), kind,
      isContainer: !!l.isContainer, drawable,
      fileVisible, fileHidden: drawable && !fileVisible,
      forced: isForced, hidden: isHidden, checked,
    })
    plan.push({ i, hidden: isHidden, shown: isForced })
  }
  return {
    rows, plan, total: list.length, drawableCount: list.length - undrawableCount,
    checkedCount, hiddenCount, forcedCount, fileHiddenCount, undrawableCount,
  }
}

/** 「图层开关」弹层的**响应式定位**（纯函数 ⇒ Node 门禁直接对 800×600 / 1280×720 / 1920×1080 断言不越界）。
 *  口径：面板**右对齐到按钮右缘**（按钮在参数栏最右端 ⇒ 向左展开，右边界天然不越界），
 *  宽度/高度再按**视口**夹取（各留 `margin`，缺省 8px）：
 *   · `width ≤ 按钮右缘 − margin` ⇒ 左边界不会跑到视口外；
 *   · 下方空间不足且上方更宽裕 ⇒ 翻到按钮**上方**展开（`placement:'above'`）；
 *   · 返回 **视口坐标**的 `{left,right,top,bottom,width,maxHeight,placement}`，调用方据此写行内样式；
 *   · 纯算式、不读 DOM ⇒ 任何输入都不会产生 NaN/负尺寸（`viewport` 缺失也能返回一个合法的兜底矩形）。 */
export function layerPanelFit(btnRect, panel, viewport, margin = 8) {
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d)
  const m = Math.max(0, Math.trunc(num(margin, 8)))
  const vw = Math.max(1, Math.trunc(num(viewport && viewport.w, 0)))
  const vh = Math.max(1, Math.trunc(num(viewport && viewport.h, 0)))
  const prefW = Math.max(120, Math.trunc(num(panel && panel.prefW, 360)))
  const minW = Math.max(120, Math.min(prefW, Math.trunc(num(panel && panel.minW, 220))))
  const btRight = num(btnRect && btnRect.right, vw - m)
  const btBottom = num(btnRect && btnRect.bottom, m)
  const btTop = num(btnRect && btnRect.top, Math.max(m, btBottom - 24))
  const right = Math.min(Math.max(m + 1, btRight), Math.max(m + 1, vw - m))
  let width = Math.min(prefW, Math.max(minW, right - m))
  width = Math.min(width, Math.max(1, vw - 2 * m))
  const left = Math.max(m, right - width)
  const belowTop = Math.min(Math.max(m, btBottom + 4), Math.max(m, vh - m - 1))
  const belowAvail = Math.max(0, vh - m - belowTop)
  const aboveBottom = Math.max(m, Math.min(btTop - 4, vh - m))
  const aboveAvail = Math.max(0, aboveBottom - m)
  let placement = 'below'
  let avail = belowAvail
  if (belowAvail < Math.min(200, vh * 0.35) && aboveAvail > belowAvail) { placement = 'above'; avail = aboveAvail }
  const maxHeight = Math.max(1, Math.min(avail, vh - 2 * m))
  const top = (placement === 'above') ? Math.max(m, aboveBottom - maxHeight) : belowTop
  const bottom = top + maxHeight
  return {
    placement,
    left: Math.floor(left), right: Math.floor(left + width),
    top: Math.floor(top), bottom: Math.floor(bottom),
    width: Math.floor(width), maxHeight: Math.floor(maxHeight),
  }
}

/** 「立即上报」的载荷（与 :8899 同一份诊断内容 + 调试模式自己的读数）。
 *  `diag` 是诊断流的最后若干行（字符串数组）；`layers` 是 {count,index,name,type}；形状固定 ⇒ 服务端/工具可解析。 */
export function debugReportPlan(input) {
  const x = (input && typeof input === 'object') ? input : {}
  const layers = (x.layers && typeof x.layers === 'object') ? x.layers : {}
  const diag = Array.isArray(x.diag) ? x.diag.map((l) => String(l == null ? '' : l)).filter(Boolean).slice(-100) : []
  const media = (x.media && typeof x.media === 'object') ? x.media : {}
  return {
    schema: 'bench-debug/1',
    kind: 'bench-debug',
    ts: Number(x.ts) || 0,
    id: String(x.id == null ? '' : x.id),
    url: String(x.url == null ? '' : x.url),
    ua: String(x.ua == null ? '' : x.ua),
    debugMode: !!x.debugMode,
    layers: {
      count: Number(layers.count) || 0,
      index: Number.isFinite(Number(layers.index)) ? Number(layers.index) : -1,
      name: String(layers.name == null ? '' : layers.name),
      type: String(layers.type == null ? '' : layers.type),
    },
    media: { videos: Number(media.videos) || 0, audios: Number(media.audios) || 0 },
    diag,
    diagLines: diag.length,
  }
}

/** 「立即上报」的落点顺序（`:8899` 的同一套约定）：`/report` ⇒ `r<ts>.json`；`/baseline` ⇒ `baselines/<ts>.json`；
 *  :8902 目前没有这两条路由（只有 `/diag` 的环形缓冲） ⇒ 依次退，并把**实际落点**如实写进日志。 */
export const DEBUG_REPORT_ROUTES = ['/report', '/baseline', '/diag']

/* ── P-161 播放卡片的受控快照（纯函数）────────────────────────────────────────────────
   卡片（`demo/now-playing/`，本仓自己的 GPL 组件）在受控模式下只认这一份快照；本函数把它算出来
   ⇒ Node 里可以直接把"有视频/没视频/只有音频/链路断开"四类边界钉死，不必进浏览器。
   字段口径与插件仓 `dsh-mpkg-wallpaper/lib/now-playing.js` 的控制器**同一套词汇**（见 P-161 台账）。 */
export function npSnapshotPlan(input) {
  const x = (input && typeof input === 'object') ? input : {}
  const m = (x.media && typeof x.media === 'object') ? x.media : {}
  const item = (x.item && typeof x.item === 'object') ? x.item : {}
  const link = x.link !== false
  const kind = String(item.kind || (m.hasVideo ? 'video' : (m.hasAudio ? 'audio' : 'none')))
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  const total = Math.max(0, num(m.total))
  const progress = Math.max(0, Math.min(total > 0 ? total : num(m.progress), num(m.progress)))
  const hasMedia = !!(m.hasVideo || m.hasAudio)
  /* ①(2026-09-23 第 8② 条) **时间轴可证实**：默认判据只有一条 —— **真的有一个总长 > 0 的时间轴**。
     ⚠ 试过更严的"必须不静音"，被真机否掉：web 壁纸的视频层常常 muted，但那条时间轴是真的
     （T1 要求 `canSeek` 为真、T4 要求点轨道能定位）。"静音 ⇒ 不可证实"是把**视觉层**和**可听源**混为一谈。
     现在是**显式契约**：宿主知道这条时间轴与用户听到的不是一回事时，才传 `timelineKnown:false`
     ⇒ 卡片写 `--:--`、不可拖（组件侧能力已就位，见 demo/now-playing 的 `NowPlayingData.timelineKnown`）。 */
  const timelineKnown = (m.timelineKnown !== undefined)
    ? !!m.timelineKnown
    : (m.hasTimelineElement === undefined ? true : (!!m.hasTimelineElement && total > 0))
  const linked = link && hasMedia
  const clamp01v = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0 }
  const title = String(item.title || m.title || (hasMedia ? '' : '未连接媒体 / no media'))
  //  联动关时**先说脱开**（哪怕有媒体）：卡片此刻确实不跟随、也不可控，标题行必须如实说这件事；
  //  联动开但没有媒体 ⇒ 说"没有可播放的媒体"。两者都不是装饰文本。
  const mediaNote = [kind, m.count > 1 ? ('×' + m.count) : '', m.muted ? 'muted' : ('音量 ' + Math.round(clamp01v(m.volume) * 100) + '%')].filter(Boolean).join(' · ')
  const byline = String(item.byline || (!link
    ? ('卡片已脱开（联动关闭）' + (hasMedia ? ' · ' + mediaNote : ''))
    : (hasMedia ? mediaNote : '当前壁纸没有可播放的媒体')))
  return {
    //  —— 卡片显示面 ——
    kind, title, byline,
    progress, total,
    timelineKnown,
    playing: !!m.playing,
    muted: !!m.muted,
    volume: clamp01v(m.volume),
    //  —— 可控面：联动关 / 没有媒体 ⇒ 全部不可按（不假装可点）——
    canPlay: linked,
    canPrev: link && !!x.hasPrev,
    canNext: link && !!x.hasNext,
    canSeek: linked && total > 0 && timelineKnown,
    canVolume: linked,
    link,
    source: String(x.source || (hasMedia ? 'stage-media' : 'none')),
  }
}

/**
 * 「就选这个目录」**成功之后的动作契约**（纯函数，门禁直接断言；不含任何本机路径/目录名/平台行为）：
 *   · 立刻重新拉壁纸库列表 = 同页 `GET /api/library`（`reloadPage:false` ⇒ **不刷整页**，
 *     所以不存在"要用户手动刷新"这一步）；
 *   · `closeDialogOnSuccess:true` ⇒ 自动关闭对话框；
 *   · `touchSelection:false` ⇒ **不碰当前选中的壁纸**（既不切换也不释放 —— 用户明确要求）；
 *   · 失败侧相反：`closeDialogOnFailure:false` + `showReasonOnFailure:true`（不关窗、写原因）。
 */
export function libDirCommitPlan() {
  return {
    listRequest: { method: 'GET', path: '/api/library' },
    reloadPage: false,
    closeDialogOnSuccess: true,
    closeDialogOnFailure: false,
    showReasonOnFailure: true,
    touchSelection: false,
  }
}

/** 库目录对话框（②⑤ 的"选环境内文件夹"）计划：服务端路由在不在、用什么兜底。
 *  routesOk=false（`GET /api/fs/roots` 404/网络错）⇒ 明确提示"服务端还没这条路由"，
 *  并给出两个兜底按钮（纯前端选文件夹 / **明确标注**的系统选择器）。 */
export function dirDialogPlan(routesOk, backend) {
  const ok = !!routesOk && !!backend
  return {
    ok,
    mode: ok ? 'server' : 'fallback',
    noticeKey: ok ? 'pickd.note' : (backend ? 'pickd.noRoute' : 'pickd.noBackend'),
    confirmKey: ok ? 'pickd.here' : null,
    showSystem: true,                                  // 系统选择器永远只是**兜底按钮**（显式标注）
  }
}

/* ============================ ⑩ 音条源（bandfeed）四档：纯函数层 ============================
   任务书：`../docs/USER-ITEMS-20260920-B.md` §5.3（四条判据）。为什么要有这一层：
     · 渲染器（`demo.html` 的 `MPW-BANDFEED` 块）只有**两个真实源** —— 包内音轨的 AnalyserNode
       （`?audio=1` 且包里真有 sound 层在播）与麦克风；浏览器**拿不到系统声卡环回** ⇒ 两者都没有时
       **如实全 0**（`source='silent'`，可查 `window.__mpwAudioBandSource` / `__mpwAudioBandStats().silent`）；
     · 所以工具条给的是**显式**四档，缺省必须等于渲染器现有诚实缺省 `auto`（**不是** `mic`）；
     · 状态行要把渲染器回报的 `source/reason` 翻成人话：非静音写源类型，静音写**明确原因**，
       并把"可切麦克风 / 模拟"这条出路一起说出来（判据要能读到这一行）。
   本层是纯函数 ⇒ `tests/bench-bandfeed-switch-test.mjs` 在 Node 里直接钉住映射与两态文案。 */

/** 工具条四档（顺序 = DOM 顺序）。`auto` = 「壁纸」= 渲染器缺省档（有真实源才动，没有就全 0）。 */
export const BAND_FEED_MODES = ['auto', 'mic', 'sim', 'off']
/** 缺省档：**必须**等于渲染器缺省（`demo.html` 的 `BANDFEED` 把空值与非法值都回落 `auto`）。 */
export const BAND_FEED_DEFAULT = 'auto'
/** 档位 → i18n 键（选项文案与"换档日志"共用同一份，避免两处漂移）。 */
export const BAND_FEED_LABEL_KEYS = { auto: 'bandfeed.wallpaper', mic: 'bandfeed.mic', sim: 'bandfeed.sim', off: 'bandfeed.off' }
/** 渲染器回报的麦克风状态 → 人话原因键（`demo.html` 的 `bandMic.status`：idle/pending/on/denied/error/unsupported）。 */
export const BAND_FEED_MIC_REASON_KEYS = {
  denied: 'bandfeed.whyMicDenied', unsupported: 'bandfeed.whyMicUnsupported', error: 'bandfeed.whyMicError',
  pending: 'bandfeed.whyMicWait', idle: 'bandfeed.whyMicWait',
}

/** 档位归一：只认四档，其余（`null`/空串/大小写混写/垃圾值）一律回落缺省档 —— **不落 `off`**，
 *  与渲染器"非法值不静默关"同一口径（打错一个字母不该把音频响应静默丢掉）。 */
export function bandFeedMode(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase()
  return BAND_FEED_MODES.indexOf(s) >= 0 ? s : BAND_FEED_DEFAULT
}

/** 档位 → 选项文案（i18n）。 */
export function bandFeedLabel(lang, mode) {
  return t(lang, BAND_FEED_LABEL_KEYS[bandFeedMode(mode)])
}

/** 把档位拼进**渲染器入口 URL**（iframe `src`）。边界与理由：
 *   · 只认含 `renderer/index.html` 的 URL；其余（壁纸页、外链、`blob:`、`data:`、空串）**原样返回**
 *     ⇒ 这条改写不可能把别的 URL 弄坏；
 *   · 同名旧参数先删再写（换档不叠加）；**默认档也显式写** `bandfeed=auto`
 *     ⇒ 读 iframe 的 src 就能看出当前是哪一个档位，且与渲染器缺省口径一致；
 *   · 判据④（任何档都不许自动播放包内音频）在接线层的落点：本函数**只写 `bandfeed=` 一个参数**，
 *     永远不加 `audio=1`，也不碰 `volume` / `muted` —— 换音条源不会让包内音频"莫名出声"。 */
export function bandFeedUrl(url, mode) {
  const raw = String(url == null ? '' : url)
  // 路径段边界：必须是 `/renderer/index.html` 或整串就是这个相对路径 —— 不然 `not-renderer/index.html`
  // 这种同名尾巴也会被改写（段边界写清楚，改写面才收得住）。
  /* ⑧(P-228f 2026-10-05) **两种入口都要认**：产物页（`…/renderer/index.html`）与本仓档（`/webloader/`）。
     旧判据只认前者，而工具条缺省就是本仓档 ⇒ 那条改写链在缺省档下**一个参数都不加**（真机读数：
     预览 URL 里没有 `bandfeed=`、音条状态只能报「这个渲染器不回报」、切音条源看不出效果）。 */
  if (!/(^|\/)(renderer\/index\.html|webloader\/?)([?#]|$)/.test(raw)) return raw
  const hashAt = raw.indexOf('#')
  const head = hashAt >= 0 ? raw.slice(0, hashAt) : raw
  const hash = hashAt >= 0 ? raw.slice(hashAt) : ''
  const qAt = head.indexOf('?')
  const base = qAt >= 0 ? head.slice(0, qAt) : head
  const kept = (qAt >= 0 ? head.slice(qAt + 1) : '').split('&').filter((p) => p !== '' && !/^bandfeed=/i.test(p))
  kept.push('bandfeed=' + bandFeedMode(mode))
  return base + '?' + kept.join('&') + hash
}

/* ============================ ⑪ 渲染器来源（renderer source）两档：纯函数层 ============================
   背景（真机读数，不是推测）：测试台预览 iframe 一直跑**上游产物页** `demo/renderer/index.html`
   （`demo/assets/renderer-BOSoB05I.js`，minified、不可重建）。它的场景路径把画布尺寸算成
   `clientWidth × min(devicePixelRatio, renderDpr)` 且工具条「DPR」档缺省就是 `1`
   ⇒ 实测面板 624×351 CSS px 时画布也是 624×351，DPR>1 的屏幕上**永远 1× CSS 像素出图**（全屏同理）；
   并且它建 WebGL 上下文用的是 `alpha:false`（上游产物独有）⇒ 该透的地方是不透明黑。
   本仓渲染器（`:8899` 的 `demo.html` + `core/we-scene-bundle.js`）没有这两条：上下文 `alpha:true`，
   画布尺寸有 `?res=dpr` 活档位（显示尺寸 × 设备 DPR，随尺寸/DPR 重算）。
   ⇒ 工具条给一个**显式**两档，让预览能在**同源**下用本仓渲染器（`:8902` 有 `/webloader/**` 反代）。
   本层是纯函数 ⇒ `tests/bench-renderer-source-test.mjs` 在 Node 里直接钉住映射与 URL 改写。 */

/* ══════════ P-158 ⑩ 「当前库来源」绘制器：**模块级唯一一份定义**（用户第 3 条①的真修） ══════════
   真机症状：点「改选到其它目录」→ 对话框里写 `切换失败：paintLibSource is not defined`；**刷新页面后其实成功了**。
   根因（`tsc --checkJs` 的 TS2304 逐字读数：`demo/bench-patch.js(6748,7): Cannot find name 'paintLibSource'`）：
   旧定义写在 `initSiteShell()`（:3932）里，而调用点在**另一个函数** `init()` 的 `applyLibDir()`（:6748）——
   两个函数各是各的作用域 ⇒ 那是一次**真的 ReferenceError**（不是"偶尔未就绪"）。另外两处调用
   （`initSiteShell` 内部的 :4877、:3969）都在同一个作用域里，所以只有"切库根"这条路会炸，
   恰好也是唯一**没有** try/catch 包着的那一处（`applyLibDir` 的 catch 把它当"切换失败"显示出来）。
   修法：把状态与绘制器搬到**模块作用域**（两个函数都能引用同一个定义），宿主侧只注入"后端状态/语言"两个取值器：
     · `initSiteShell()` 启动时 `libSourceBridge.backendStatus = …; libSourceBridge.lang = …`；
     · `init()` 切根成功后直接 `paintLibSource()` —— 引用得到、也真的画得出（不再靠 try/catch 掩盖）。
   纪律：这里**不**吞异常；`paintLibSource()` 明确返回 plan（拿不到 DOM 时返回 null，不当成成功）。 */
const libSourceBridge = {
  api: null,                 // `/api/library-source`（失败再退 `/api/library`）的**权威**字段
  asked: false,              // 只请求一次（与旧实现同口径）
  backendStatus: () => 0,    // 由外壳注入：`/api/library` 的 HTTP 状态
  lang: () => 'zh',          // 由外壳注入：当前语言
}
/** 「当前库来源」行：显式写出 `source`（default/user/env/cli/none）+ 实际路径，**不假装已选**。 */
export function paintLibSource() {
  const D = (typeof document !== 'undefined') ? document : null
  const libSourceEl = D && D.querySelector ? D.querySelector('#lib-source') : null
  if (!libSourceEl) return null
  const backendStatus = libSourceBridge.backendStatus
  if (backendStatus() === 200) askLibSourceOnce()      // 懒取一次 `/api/library`（拿 dir/configuredDir/source）
  const pathEl = D.querySelector('#libpath')
  let chosen = ''
  try { chosen = String((typeof localStorage !== 'undefined' && localStorage.getItem('we-bench-library-dir')) || '') } catch { /* 隐私模式 */ }
  const plan = librarySourcePlan(libSourceBridge.lang(), {
    dir: (libSourceBridge.api && libSourceBridge.api.dir) || ((pathEl && pathEl.textContent) || '').trim(),
    chosen,
    backend: backendStatus() === 200,
    source: (libSourceBridge.api && libSourceBridge.api.source) || '',
  })
  const text = plan.label + '：' + plan.pathShown
  if (libSourceEl.textContent !== text) libSourceEl.textContent = text
  libSourceEl.title = plan.hint
  try {
    libSourceEl.dataset.kind = plan.kind
    libSourceEl.dataset.path = plan.path || ''
    libSourceEl.dataset.benchSource = String((libSourceBridge.api && libSourceBridge.api.source) || (plan.kind === 'user' ? 'user' : 'default'))
  } catch { /* 桩 DOM */ }
  return plan
}
/** 拿"库来源"的**权威**字段：先 `/api/library-source`（服务端契约：`source:'env'|'cli'|'user'|'default'|'none'`
 *  + `selected/dir/configuredFrom/exists/readable/reason`），失败再退 `/api/library`（它的顶层也有 source）。
 *  只请求一次；静态托管/离线时保持按 localStorage 推断（并明确写成"无后端"）。
 *  ⚠`force`（2026-09-24 用户第 3 条②）：切库根之后必须**重新取一次** —— 旧的"只请求一次"会让来源行
 *  永远停在切根之前的 source/dir（真机表现："列表变了、来源行还是旧的"）。 */
export function askLibSourceOnce(force) {
  if (libSourceBridge.asked && !force) return
  libSourceBridge.asked = true
  const take = (j) => { if (j && typeof j === 'object') { libSourceBridge.api = Object.assign({}, libSourceBridge.api || {}, j); paintLibSource() } }
  try {
    fetch('/api/library-source', { headers: { accept: 'application/json' } })
      .then((r) => (r && r.ok ? r.json() : null))
      .then((j) => (j && typeof j === 'object' && j.source ? take(j) : fetch('/api/library', { headers: { accept: 'application/json' } }).then((r2) => (r2 && r2.ok ? r2.json() : null)).then(take)))
      .catch(() => { /* 静态托管/离线：保持按 localStorage 推断 */ })
  } catch { /* 无 fetch */ }
}
/** 探针/门禁读数：绘制器是否"真的定义在模块作用域"（`typeof` 在顶层永不抛）。 */
export function libSourceProbe() {
  return { defined: typeof paintLibSource === 'function', api: libSourceBridge.api, asked: libSourceBridge.asked }
}

/* ══════════ ①E(2026-09-24 用户第 2 次提「图片展示了两遍」) 富文本图片去重：**纯函数层** ══════════
   为什么放在模块顶层（而不是像上一版那样藏在 `propRichFragment` 里）：
     · 判据要能在 **Node 里直接测**（`tests/bench-props-text-test.mjs`）——真语料 33/9 次重复的读数都能在这一层复现；
     · 旧版把 `seenSrc` 建在**每次调用**里 ⇒ 去重只在单行内生效、跨属性行完全失效（就是这次的 bug 根因）。
   规则（**可判定**，真值表/真实例/反例见 `tests/bench-props-text-test.mjs` §5 与 `reports/bench-propimg-dedup-20260924.md`）：
     ⓐ **逐字节同一资源**（`normalizeRichImageUrl` 相同）⇒ **无条件**只画一遍。同一条 URL 就是同一份资源，
        不存在"两张图"可比 ⇒ 不需要尺寸证据。（真语料 `dd/3660962877` 里那条 URL 出现 **33** 次 = 这一档。）
     ⓑ **处理类后缀不同**（`richImageKey` 相同：只去掉下面白名单里的"尺寸/格式/水印"参数与后缀，
        图片 id 部分**一个字节都不动**）⇒ 只是**候选**，不是结论。
     ⓒ 候选要**尺寸证据**：两张都 load 成功且 `naturalWidth`/`naturalHeight` 完全相同 ⇒ 归并；
        尺寸不同 ⇒ **一定不归并**；证据拿不到（加载失败 / 本趟超时）⇒ **不归并**（保守）。
   反例护栏（上一轮实测，已成判据）：按 `host+path` 归并会把 `m.qpic.cn/psc` 一个 path 下**4 张不同**的图
   （身份在 query 的第一个无名段 `?/V54…/TmE…!/mnull` 里）压成 1 张 ⇒ 绝对不许。所以 `richImageKey`
   **只删白名单里的具名参数**：不认识的参数（尤其**无名段**）一律逐字节保留。
   有意重复（作者拿**不同 URL** 的图当分隔/装饰）⇒ 三条规则都不会动它们（留）。 */
/** 图片 URL 归一化：只做**无争议**的规范化（小写 scheme/host、去 fragment、去默认端口、去空 query 尾巴）。
 *  刻意**不动** query 的内容/顺序 —— 那些字节常常就是"这是哪张图"的身份。⇒ 规则 ⓐ 的键（"同一份资源"）。 */
export function normalizeRichImageUrl(u) {
  const s = String(u == null ? '' : u).trim()
  if (!s) return ''
  try {
    const x = new URL(s)
    x.hash = ''
    if ((x.protocol === 'http:' && x.port === '80') || (x.protocol === 'https:' && x.port === '443')) x.port = ''
    const q = x.search === '?' ? '' : x.search
    return x.protocol.toLowerCase() + '//' + x.host.toLowerCase() + x.pathname + q
  } catch { return s }     // 非绝对 URL：原样（外部图只放行 http(s)，解析失败的自然进不来）
}
/** ⓑ 的**处理类参数白名单**（小写比较）。只放"改了它不改变**是哪张图**、只改变怎么渲染"的名字：
 *  · `wx_fmt`/`wxfrom`/`wx_lazy`/`wx_co`/`tp` —— 微信 CDN：格式、来源渠道、懒加载、压缩标记；
 *  · `bo`/`rf` —— qpic（QQ 空间/照片）：`bo` 是尺寸编码、`rf` 是展示形态（`viewer_4`/`photolist`）；
 *  · `x-oss-process`/`imageView2`/`imageMogr2`/`imageView` —— 阿里 OSS / 七牛的服务端图像处理指令。
 *  ⚠ **不在名单里的一律保留**（含 `t=`、`from=` 这类语义未确认的）：把它们删掉会把不同图压成一张。
 *  收录依据：`reports/bench-propimg-dedup-20260924.md` §3（本地语料 20 个含图包 × 逐条 URL 核对）。 */
export const RICH_IMAGE_DROP_PARAMS = [
  /* 原白名单（真语料逐条核对过，见 reports/bench-propimg-dedup-20260924.md §3） */
  'wx_fmt', 'wxfrom', 'wx_lazy', 'wx_co', 'tp', 'bo', 'rf', 'x-oss-process', 'imageview2', 'imagemogr2', 'imageview',
  /* ②(2026-09-25 issue0924a2 用户第 2 条「强制只显示一次」) **尺寸/质量/格式类**参数一并去掉：
     用户的判据是"同一张画面只显示一次"，而作者重传/换 CDN 时最常见的就是**同一张图换一组渲染参数**
     （`?w=800` vs `?w=1600`、`?q=90` vs 默认、`?format=webp` vs `jpg`）。这些名字在 HTTP 语义上
     只描述"怎么给我"、不描述"是哪张"；留着它们就等于把同一张画面算成两张（用户复测时看到的就是这个）。
     ⚠ 仍然**不吃无名段**（`?/V54…/TmE…!/mnull` 那种身份段）—— 反例护栏（4 张同 path 真图）继续成立。 */
  'w', 'h', 'width', 'height', 'size', 'quality', 'q', 'format', 'fmt', 'resize', 'crop', 'scale',
  'thumb', 'thumbnail', 'preview', 'imageslim', 'watermark', 'dpi', 'dpr', 'interlace', 'strip', 'fit', 'compress', 'sharp', 'blur',
]
/** ⓑ 的**处理类后缀**（只作用于 path 末尾；每条都能举出真实形态，且删除后仍留着图片 id）。 */
export const RICH_IMAGE_DROP_SUFFIX_RES = [
  /_!web-[A-Za-z0-9._-]*$/i,                              // 微信文章图水印后缀（`_!web-article-pic` 等）
  /@[0-9]+[wh](?:[0-9]+[wh])?(?:_[0-9a-z]+)*$/i,          // 淘宝/阿里 CDN 尺寸后缀（`@100w`、`@200w_200h_1e_1c`）
  /* ②(2026-09-25 用户第 2 条) **文件名里的尺寸标记**：作者重传同一张图时最常见的形态是
     `pic.jpg` / `pic_800x600.jpg` / `pic-1600x1200.jpg`（去掉尺寸段剩下的仍是同一个名字 = 同一张）。
     只吃"下划线/短横 + 两位数以上 × 两位数以上"这一段，且**必须在扩展名之前**（`_2x.png` 这种
     "二倍图"也一并归并：它就是同一张画面的另一份导出）。 */
  /[_-]\d{2,4}x\d{2,4}(?=\.[A-Za-z0-9]{2,5}$)/,
  /[_-](?:thumb|thumbnail|small|big|large|preview|compressed)(?=\.[A-Za-z0-9]{2,5}$)/i,
  /!\d{2,4}x\d{2,4}$/,                                    // `pic.jpg!800x600`（部分 CDN 的尺寸后缀）
]
/** 去重**候选**键（规则 ⓑ）：归一化 URL 再去掉处理类参数/后缀。单独成函数是为了让"改判据"只有一处。
 *  ⚠ 这个键**只用于筛候选**：真归并还要过 `makeRichImagePass` 的尺寸证据（规则 ⓒ）。 */
export function richImageKey(u) {
  const s = String(u == null ? '' : u).trim()
  if (!s) return ''
  let x
  try { x = new URL(s) } catch { return s }
  /*  ②(2026-09-25 用户第 2 条) `http` 与 `https` 指向同一份资源（作者换站/换 CDN 的常见形态）：
      身份键里把协议一起归一掉；`normalizeRichImageUrl`（严格档）**不动** —— 它仍然是"逐字节同一资源"的键。 */
  let path = x.pathname
  for (const re of RICH_IMAGE_DROP_SUFFIX_RES) path = path.replace(re, '')
  const raw = x.search === '?' ? '' : x.search
  const kept = []
  if (raw) for (const seg of raw.slice(1).split('&')) {
    const eq = seg.indexOf('=')
    const name = (eq < 0 ? seg : seg.slice(0, eq)).toLowerCase()
    if (RICH_IMAGE_DROP_PARAMS.indexOf(name) >= 0) continue       // 白名单内 ⇒ 删
    kept.push(seg)                                                // 其余（含无名段）逐字节保留
  }
  const host = x.host.toLowerCase().replace(/^www\./, '')     // `www.` 不是身份（同一站点同一 path）
  return 'http//' + host + path + (kept.length ? '?' + kept.join('&') : '')
}
/** 两张图的关系（判据直接用，避免测试里手抄规则）：
 *  `'same-resource'`（规则 ⓐ，无条件归并）| `'variant-candidate'`（规则 ⓑ，**也归并** ——
 *  ②(2026-09-25 用户第 2 条)「强制只显示一次」：键相等就是同一张画面，不再要尺寸证据）| `'different'`。 */
export function richImageRelation(a, b) {
  const ea = normalizeRichImageUrl(a), eb = normalizeRichImageUrl(b)
  if (!ea || !eb) return 'different'
  if (ea === eb) return 'same-resource'
  return richImageKey(a) === richImageKey(b) ? 'variant-candidate' : 'different'
}
export const RICH_IMAGE_MODES = ['once', 'row', 'all']
export const RICH_IMAGE_MODE_DEFAULT = 'once'
/** 档位归一：只认 `once`/`row`/`all`（未写/写错 ⇒ `''` = "没这一档"，交给上层落缺省）。 */
export function normalizeRichImageMode(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase()
  return RICH_IMAGE_MODES.indexOf(s) >= 0 ? s : ''
}
/** **URL 档 vs UI 档谁优先**的唯一解析点：`?propimg=` > 面板开关（localStorage）> 缺省 `once`。
 *  为什么 URL 优先：`?propimg=` 是排障/对照入口（登记在诊断文档的补丁层区），必须**可复现** ——
 *  带参数的链接在任何机器、任何本地偏好下都得到同一档；面板开关只决定"链接不带参数时"的档
 *  （改 UI 只是在同一次会话里立刻换档 + 记下偏好，带 `?propimg=` 时它改不动本次生效档，
 *  URL 档会在 `propsImages().modeSource === 'url'` 上如实写出来）。
 *  ③(2026-09-24 用户第 3 条) 面板上那个可见开关已删 ⇒ **缺省即 `once`（整面板去重）**。 */
export function planRichImageMode(input) {
  const i = input || {}
  const url = normalizeRichImageMode(i.url)
  const stored = normalizeRichImageMode(i.stored)
  if (url) return { mode: url, source: 'url', forced: true }
  if (stored) return { mode: stored, source: 'stored', forced: false }
  return { mode: RICH_IMAGE_MODE_DEFAULT, source: 'default', forced: false }
}
/** 一趟渲染的图片去重账本（纯逻辑，不碰 DOM ⇒ Node 可测；DOM 侧只负责"照账本画/藏"）。
 *  `mode='all'`（`?propimg=all`）⇒ 完全不去重（回到改动前的行为，用于对照/排障）；
 *  `mode='row'` ⇒ 只在单行内按**逐字节 URL**去重（第一版 `seenSrc` 的语义，回退档）；
 *  `mode='once'`（缺省）⇒ **同一张画面在整个面板里只出现一次**（用户第 2 条要的"强制只显示一次"）：
 *    ⓐ 逐字节同一资源 ⇒ 只画第一张；
 *    ⓑ 身份键（`richImageKey`）相同 = **同一张画面的不同参数/尺寸/格式/重传** ⇒ **无条件归并**
 *       （②2026-09-25：旧版要求"两张都.load 成功且 naturalWidth/Height 完全相同"才归并，
 *        作者重传的图尺寸不同、或图片没加载完/被墙 ⇒ 就画两张 —— 用户复测看到的"还是有重复的图片"
 *        正是这一档。现在改成"键相等就归并"：判据从"证据"退回"身份"，因为身份键本身就是
 *        "同一张画面"的定义，尺寸只说明导出规格不同）。
 *  `opts.sizes`：`{url: {w,h,ok}}` 预置尺寸证据 —— **只进台账**（用来如实说明"N 张变体的尺寸当时
 *  相同/不同/未知"），不再参与判定；DOM 侧同样走 `sizeEvidence()`。
 *  不变量（门禁 B7 依赖）：`once` 档下 `report().rendered === report().groups.length`。 */
export function makeRichImagePass(opts) {
  const o = opts || {}
  const mode = (o.mode === 'all' || o.mode === 'row') ? o.mode : 'once'
  const groups = new Map()      // 身份组（只有真的画了才建）→ {id,key,url,exact,count,kept,variants,reason}
  const ident = new Map()       // 身份键 → 组 id
  const sizes = new Map()       // exactUrl → {w,h,ok}（**只进台账**，不参与判定）
  const notes = []
  let requests = 0, mergedCount = 0, unmergedCount = 0
  const nUrl = (u) => normalizeRichImageUrl(u)
  const sizeOf = (exact) => sizes.get(exact) || null
  const known = (s) => !!(s && s.ok && s.w > 0 && s.h > 0)
  const mk = (id, key, exact) => { const g = { id, key, url: exact, exact, count: 0, kept: 0, variants: [], reason: '' }; groups.set(id, g); ident.set(id, id); return g }
  const scoped = (k, scope) => (mode === 'row') ? (String(scope == null ? '' : scope) + '\u0000' + k) : k
  /** 变体的**尺寸证据台账**（只用于 report：`equal`/`different`/`unknown` 三个计数 + 逐条明细）。
   *  ② 为什么保留它：用户要"把放弃归并的原因如实计数进台账/提示，不许静默" —— 现在**没有放弃**，
   *  但"这一张是靠键相等强行归并的，它当时的尺寸与参考图不同/还未知"这件事必须看得见。 */
  function evidenceOf(refExact, exact) {
    const a = sizeOf(refExact), b = sizeOf(exact)
    if (!known(a) || !known(b)) return 'unknown'
    return (a.w === b.w && a.h === b.h) ? 'equal' : 'different'
  }
  const pass = {
    mode,
    /** 这张图该不该画？`{draw, key, exact, reason}`（`once` 档下键相等 ⇒ `draw:false` 且 `merged:true`）。
     *  `scope`：`mode='row'` 时把去重限制在**同一条属性行**内（第一版 `seenSrc` 的语义）；`once` 忽略它。 */
    take(url, scope) {
      const exact = nUrl(url)
      if (!exact) return { draw: false, key: '', exact, reason: 'empty' }
      requests++
      if (mode === 'all') {
        const id = 'all\u0000' + scoped(exact, scope)
        const g = groups.get(id) || mk(id, exact, exact)
        g.count++; g.kept++
        return { draw: true, key: exact, exact, reason: 'all' }
      }
      if (mode === 'row') {
        const id = 'row\u0000' + scoped(exact, scope)
        const g = groups.get(id)
        if (g) { g.count++; return { draw: false, key: exact, exact, duplicate: true, reason: 'row-duplicate' } }
        const ng = mk(id, exact, exact); ng.count++; ng.kept++
        return { draw: true, key: exact, exact, first: true, reason: 'row-first' }
      }
      const key = richImageKey(url)
      const refId = ident.get(key)
      if (!refId) {                                              // 这个身份第一次出现 ⇒ 画（参考图）
        const g = mk(key, key, exact); g.count++; g.kept++
        return { draw: true, key, exact, first: true, reason: 'first' }
      }
      const ref = groups.get(refId)
      if (ref && ref.exact === exact) {                           // ⓐ 逐字节同一资源 ⇒ 只画第一张
        ref.count++
        return { draw: false, key, exact, duplicate: true, reason: 'same-url' }
      }
      /*  ⓑ **同身份 = 同一张画面**（②2026-09-25 强制档）：无条件归并，不再看尺寸证据。
          证据只写进台账（`g.variantEvidence`）—— "尺寸不同/未知还是归并了"这件事在 report 里看得见。 */
      const ev = evidenceOf((ref && ref.exact) || exact, exact)
      if (ref) { ref.count++; ref.variants.push(exact); ref.variantEvidence = ref.variantEvidence || []; ref.variantEvidence.push({ url: exact, evidence: ev }) }
      mergedCount++
      return { draw: false, key, exact, duplicate: true, variant: true, merged: true, evidence: ev, reason: 'variant-key-equal' }
    },
    /** 记一条尺寸证据（DOM 侧在 `load`/`error`/首画时调）—— **只进台账**，返回值恒为空清单
     *  （旧契约里它是"结算挂起项"的入口；② 起不再有挂起项，保留方法是为了调用面与既有判据不炸）。 */
    sizeEvidence(url, size) {
      const exact = nUrl(url)
      if (!exact) return { merged: [], release: [] }
      const w = Number(size && size.w) || 0, h = Number(size && size.h) || 0
      const ok = !!(size && size.ok) && w > 0 && h > 0
      sizes.set(exact, { w, h, ok })
      return { merged: [], release: [] }
    },
    /** 旧契约的"超时兜底"：② 起没有任何挂起项 ⇒ 恒返回空清单（调用方不用改）。 */
    releasePending() { return { merged: [], release: [] } },
    pendingCount() { return 0 },
    /** 这条链接是不是"已经画成图的那张图"？是 ⇒ 压掉（只在 `once` 档生效）。 */
    shouldSuppressLink(href) {
      if (mode !== 'once') return false
      const key = richImageKey(href)
      return !!key && ident.has(key)
    },
    note(why, url) { notes.push({ why, url: nUrl(url) }); if (notes.length > 60) notes.shift() },
    reset() { groups.clear(); ident.clear(); sizes.clear(); notes.length = 0; requests = 0; mergedCount = 0; unmergedCount = 0 },
    report() {
      const all = [...groups.values()]
      const rendered = all.reduce((n, g) => n + g.kept, 0)
      const dup = all.filter((g) => g.count > g.kept)
      /*  变体证据台账（**如实计数**）：合并了多少张、其中"尺寸不同/未知"各多少。 */
      const evCount = { equal: 0, different: 0, unknown: 0 }
      const evList = []
      for (const g of all) for (const v of (g.variantEvidence || [])) { evCount[v.evidence] = (evCount[v.evidence] || 0) + 1; evList.push({ ref: g.url, url: v.url, evidence: v.evidence }) }
      return {
        mode, images: requests, rendered, duplicatesSkipped: Math.max(0, requests - rendered),
        linksSuppressed: notes.filter((n) => n.why === 'link-suppressed').length,
        linksEmpty: notes.filter((n) => n.why === 'link-empty').length,
        groups: all.map((g) => ({ url: g.url, count: g.count, kept: g.kept })),
        duplicateGroups: dup.map((g) => ({ url: g.url, count: g.count, kept: g.kept })),
        variants: {
          merged: mergedCount, unmerged: unmergedCount, held: 0,
          evidence: evCount, list: evList.slice(0, 40),
          /*  ⚠ 兼容旧读数：旧字段名（merged/unmerged/held）保留，另外把"合并时尺寸不同/未知"的
              条数单独写出来 —— 门禁与报告直接断言这三个数，不需要再从 DOM 反推。 */
          mergedWithDifferentSize: evCount.different, mergedWithUnknownSize: evCount.unknown,
        },
        sizes: [...sizes.entries()].map(([url, s]) => ({ url, w: s.w, h: s.h, ok: s.ok })),
        suppressed: notes.filter((n) => n.why === 'img-duplicate').length,
      }
    },
  }
  if (o.sizes && typeof o.sizes === 'object') for (const [u, s] of Object.entries(o.sizes)) { const e = nUrl(u); if (e) sizes.set(e, { w: Number(s && s.w) || 0, h: Number(s && s.h) || 0, ok: !!(s && s.ok) }) }
  return pass
}
/** 单条文本的去重（纯函数；`propRichFragment` 的通行做法在 DOM 层，这一条给 Node 判据用）：
 *  返回 `{tokens, report}` —— tokens 是**去掉重复 img 与被压掉的 img-链接**之后的新树（不改入参）。
 *  ⚠ 纯 token 遍历**没有 DOM/图片加载** ⇒ 拿不到规则 ⓒ 的尺寸证据 ⇒ 变体候选一律**不归并**（保守，
 *  与 DOM 侧"证据拿不到就不归并"同口径）；要判"变体真的归并"必须走 `opts.sizes` 预置证据。 */
export function dedupeRichImages(tokens, opts) {
  const pass = makeRichImagePass(opts)
  const held = []
  const walk = (list) => (list || []).map((tok) => {
    if (!tok) return tok
    if (tok.k === 'img') {
      const v = pass.take(tok.src, 0)
      if (v.hold) held.push(tok.src)
      return v.draw ? tok : (v.hold ? tok : null)
    }
    if (tok.k === 'link') { if (pass.shouldSuppressLink(tok.href)) { pass.note('link-suppressed', tok.href); return null } return tok }
    if (tok.kids) return Object.assign({}, tok, { kids: walk(tok.kids) })
    return tok
  }).filter(Boolean)
  const out = walk(tokens)
  if (held.length) {
    pass.releasePending('no-size-evidence')
    for (const u of held) pass.note('variant-unproven', u)
  }
  return { tokens: out, report: pass.report() }
}

/** 工具条两档（顺序 = DOM 顺序）。`upstream` = 保持原来的行为；`repo` = 同源 `/webloader/` 走本仓渲染器。 */
export const RENDERER_SOURCES = ['upstream', 'repo']
// 默认档：**本仓渲染器**（`/webloader/**` 同源反代 → `:8899` 的 `demo.html` + 本仓 core）。
// 为什么不默认上游产物（2026-09-21 真机读数）：上游产物页的画布 = `clientWidth × min(devicePixelRatio,
//   renderDpr)`，而工具条「DPR」档缺省就是 `1` ⇒ DPR>1 的屏幕上**永远 1× CSS 像素出图**（实测同面板同包：
//   上游 529×297、本仓 1056×594 @DPR2），且它的上下文是 `alpha:false`。预览默认跑它 = 默认给用户看
//   "糊 + 该透的地方黑"的那一份。⇒ 默认翻转成**一个**渲染器表面（本仓），上游产物只作**对照/排障档**保留。
// 翻转默认带来的一次性断言改动（**旧契约 → 新契约**，逐条写在提交信息与 `docs/PATCHES.md` P-171.6 里）：
//   · `bench-ui-headless` S4a/S4b：旧"静态台在 1.2s 用产物页的 `__wp.loadSceneFile(blob)` 挂合成样例"
//     → 新"本仓档按 `?id=sample-synthetic` 导航预览"（同样"打开就有画面"，判据口径不动）；
//   · 同文件 T1–T5 / W1–W6（web 档 11 条）：旧"默认 iframe 就是产物页" → 新"这两组**显式切到上游档**再测，
//     断言口径一条不动"。⚠ 更正（P1 2026-10-05）：这两组以产物档为夹具是**历史夹具选择**，不是能力缺失 ——
//     本仓渲染器页自己的 web 路径后来已落地（`demo.html` 的 `?type=web` + 原始 URL + 服务端注入 shim，
//     判据 `bench-ui-headless` 的 R3/R3b/R3c），"本仓没有 web 路径"这句旧口径与实测相反。
/* ══════════ P1（RENDERER-UNIFY-PLAN §3 P1）**两档能力表**：数据 = 唯一真源 ══════════
   为什么要有它：两档的差异此前散在状态行文案、注释与测试断言三处（"手写文案"），改一处就会与实测漂移。
   这里把差异写成**数据**（每项带一句为什么 + 证据指向），差异集合由 `rendererCapDifferences()` 现算 ——
   测试断言的正是这张表本身（新增差异必须进表、表的差异必须被断言点名）。
   `same: true` = 两档口径相同（写出来是为了防止"以为不同"的错觉被反复讨论）。
   取值只写**可复核的口径**，不写评价词。 */
export const RENDERER_SOURCE_CAPS = {
  upstream: {
    entry: '/wallpaper-engine-webgl/renderer/index.html',
    liveRes: false,              // 无 ?res=dpr 活档位
    canvasFormula: 'clientWidth*min(devicePixelRatio,renderDpr)',
    dprCap: 'renderDpr（工具条 DPR 档；缺省 1 ⇒ 1× CSS 像素出图）',
    contextAlpha: false,
    msaa: '离屏多重采样 FBO/RBO + 帧末 resolve（其 antialias 恒 false）',
    bandfeed: false,             // 不认 ?bandfeed=
    diagFlags: 11,               // type/src/fit/renderDpr/sceneFps/muted/loop/filter/mediaBase/liveSystem/opaque
    hostApi: '__wp（14 个方法，无几何 setter）+ __we* 家族',
    webPath: true,               // 产物自己的 video|gif|image|scene|web|canvas 分派
    scenePackHandoff: 'mediaBase+src 同时给（否则 canvases: []）',
    msaaTierFlag: false,
  },
  repo: {
    entry: '/webloader/',
    liveRes: true,               // ?res=dpr：显示尺寸 × 设备 DPR，带上限与重算
    canvasFormula: 'displaySize*devicePixelRatio（?res=dpr 活档位，上限 3840*2160 / 单边 4096）',
    dprCap: '无（DPR 档只决定?res=dprN 的上限）',
    contextAlpha: false,         // premultipliedAlpha:false + alpha:false（glCanvasAttrs 唯一来源）
    msaa: '原生 antialias（msaa 档与 q!=off 不能并用）',
    bandfeed: true,              // ?bandfeed=wallpaper|mic|sim|off + __mpwAudioBand*
    diagFlags: 215,              // 本仓 URL 开关数（diag-flag-check 双向 0 差异）
    hostApi: '__wp + __mpw*（LiveRes/WebFrame/Pointer/Audio…）',
    webPath: true,               // ?type=web + 原始 URL + 服务端注入 shim（R3/R3b/R3c）
    scenePackHandoff: '按 ?id= 取包（同源 /pkg/<id>）',
    msaaTierFlag: true,
  },
}
/** 两档差异集合（现算：键序稳定、只列 `same` 之外的项）。`keys` = 差异键；`table` = 每键的 `{upstream,repo}`。 */
export function rendererCapDifferences(caps) {
  const t = caps || RENDERER_SOURCE_CAPS
  const up = t.upstream || {}, rp = t.repo || {}
  const keys = Object.keys(up).filter((k) => JSON.stringify(up[k]) !== JSON.stringify(rp[k])).sort()
  const table = {}
  for (const k of keys) table[k] = { upstream: up[k], repo: rp[k] }
  return { keys, table }
}
export const RENDERER_SOURCE_DEFAULT = 'repo'
/** 档位 → i18n 键（选项文案、换档日志、状态行共用一份，避免三处漂移）。 */
export const RENDERER_SOURCE_LABEL_KEYS = { upstream: 'rendererSrc.upstream', repo: 'rendererSrc.repo' }
/** 本仓渲染器的同源入口（`:8902` 的反代路由，见 `server/we-scene-demo-server-8902.mjs` 的 `/webloader/**`）。 */
export const RENDERER_SOURCE_REPO_PATH = '/webloader/'

/** 档位归一：只认两档，其余（`null`/空串/大小写混写/垃圾值）一律回落缺省档 —— 与音条源同一口径
 *  （打错一个字母不该把预览悄悄弄成另一种渲染器）。 */
/** P1（RENDERER-UNIFY-PLAN §3）：**档位注记按表渲染**（不再手写"minified 包，画质与透明按上游口径"这类话）。
 *  取的是 `RENDERER_SOURCE_CAPS` 的字段值 ⇒ 表改了文案自然跟着改；`caps` 参数只为判据能喂自定义表（缺省用真表）。
 *  ⚠ 与运行时 `__mpwHostCaps` 的**降级名单**是两件事：这里写的是"档位静态口径"，那一条写的是"这次挂载真实降级了什么"。 */
export function rendererTierNote(mode, caps) {
  const t2 = caps || RENDERER_SOURCE_CAPS
  const m = rendererSourceMode(mode)
  const c = (t2 && t2[m]) || {}
  const canvas = String(c.canvasFormula == null ? '' : c.canvasFormula)
  const cap = String(c.dprCap == null ? '' : c.dprCap)
  const msaa = String(c.msaa == null ? '' : c.msaa)
  if (m === 'upstream') {
    return '画布 = ' + canvas + '（' + cap + '）；不认 ?bandfeed=（音条档只在 URL 里）'
  }
  return '口径 = ' + canvas + '；' + msaa
}
export function rendererSourceMode(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase()
  return RENDERER_SOURCES.indexOf(s) >= 0 ? s : RENDERER_SOURCE_DEFAULT
}
/** 档位 → 选项文案（i18n）。 */
export function rendererSourceLabel(lang, mode) {
  return t(lang, RENDERER_SOURCE_LABEL_KEYS[rendererSourceMode(mode)])
}
/** 工具条「DPR」档 → 本仓渲染器的 **DPR 上限**（`?res=dprN`）；`null` = 不设上限（用设备 DPR）。
 *  为什么需要 `touched`：那个 `<select>` 的**缺省值就是 1**（产物 HTML 的第一个 option，没有 `selected`
 *  也没有 localStorage 回填），而 `1` 在上游语义里是"画布 = 1× CSS 像素"的**上限**。用户从没碰过它时
 *  把 1 传下去 = 把本仓的画质修复原地抵消（实测就是这么糊的）⇒ 只有**显式改过**才当上限。
 *  `dpr` 允许 1..5（与产物 HTML 的取值域同）；越界/非数字 ⇒ 当作没改过（如实回落到设备 DPR）。 */
export function rendererDprCap(opts) {
  const o = opts || {}
  if (o.dprTouched !== true) return null
  const n = Number(o.dpr)
  if (!Number.isFinite(n) || n < 1) return null
  return Math.min(5, Math.round(n))
}
/** 把「渲染器来源」档应用到**渲染器入口 URL**。边界与理由：
 *  · `upstream` 档 ⇒ **原样返回**（"上游 = 现在的行为"是硬要求，一个字符都不改）；
 *  · `repo` 档 ⇒ 只认两种入口：产物写死的 `…/renderer/index.html`（3 处绝对路径里的 iframe 那两处）
 *    与已经是 `/webloader/…` 的 URL；其余（web 壁纸页、`blob:`、外链、空串）**原样返回**
 *    ⇒ 这条改写不可能把别的 URL 弄坏；
 *  · **完整保留原有 query**：`type/src/fit/renderDpr/sceneFps/filter/muted/loop/mediaBase/_t/liveSystem`
 *    以及测试台自己加的 `bandfeed`、以及别人手工加的调试档 —— 一个参数都不删（只在缺 `id`/`res` 时**补**）；
 *  · 补 `id=<itemId>`：本仓渲染器按 `?id=` 取包（`demo.html` 的 `/pkg/<id>`）；scene 档 `src` 就是 itemId，
 *    web/video 档 `src` 是路径 ⇒ 从 `${mediaBase}/<id>/…` / `${webBase}/<id>/…` 那段取回同一个 id
 *    （取不到就**不补**，让渲染器自己按 `src` 报错，而不是编一个 id）；
 *  · 补 `res=dpr`（或显式 DPR 档下的 `res=dprN`）：本仓渲染器的活档位。若 URL 里**已经有** `res=`，
 *    那是别人显式的调试档 ⇒ **不覆盖**（"保留原有 query"优先于我们的缺省）；
 *  · hash 原样带着（本仓库没有任何带 hash 的渲染器入口，但改写不该吞掉它）。 */
export function rendererSourceUrl(url, mode, opts) {
  const raw = String(url == null ? '' : url)
  const isProduct = /(^|\/)renderer\/index\.html([?#]|$)/.test(raw)
  const isLoader = /(^|\/)webloader\/?([?#]|$)/.test(raw)
  const itemIdOf = (q) => {
    const get = (k) => { const hit = q.split('&').find((x) => x.split('=')[0].toLowerCase() === k); return hit === undefined ? null : decodeURIComponent(hit.slice(hit.indexOf('=') + 1)) }
    const src = get('src') || ''
    const type = String(get('type') || 'scene').toLowerCase()
    /* ①(2026-09-24 `.mpkg` 一等项) scene 档的 `src` 过去要求**不带任何斜杠**（那是"单段 itemId"的旧口径）。
       库根 = `wallpaperE/**` 这种"一个目录里多份 `.mpkg`"的布局下，itemId 是**相对库根的嵌套路径**
       （`卡提希娅/卡提希娅_01.mpkg`）⇒ 旧判据返回空 ⇒ 预览 URL 不写 `id=` ⇒ 测试台点了没反应（挂成合成样例）。
       新判据 = "**相对路径**"：不吃绝对路径（`/`、`\\`、盘符）、不吃 `..`、不吃协议头；其余（含嵌套）都放行。
       服务端侧对嵌套 itemId 的越界校验在 `assertItemPath()/safeJoin()`（本轮已加判据：`..` ⇒ 400、软链逃逸 ⇒ 403）。 */
    if (type === 'scene' && src && !/^[\/\\]/.test(src) && !src.includes('..') && !/^[a-z]+:\/\//i.test(src)) return src
    const m = /(?:^|\/)(?:media|web)\/dev\/([^/?#]+)/.exec(src)
    return (m && m[1]) || ''
  }
  //  `upstream` 档：
  //    · 产物入口 URL（本来就指向产物页）⇒ **逐字返回**（"上游 = 现在的行为"，A5 钉住）；
  //    · `/webloader/` 的 URL ⇒ 这是**本仓档写进去的**，切回上游必须把路径换回去（否则换档之后
  //      iframe 还是本仓渲染器 —— 真机实测：没有已挂载壁纸时产物自己的「重挂载」`Ae()` 会直接返回，
  //      src 不会重设 ⇒ 需要这条反向映射兜底）。查询串原样带走（多出来的 `id`/`res` 对产物页是无害的
  //      未知参数：它只读 type/src/fit/renderDpr/sceneFps/muted/loop/filter/mediaBase/liveSystem/opaque）。
  if (rendererSourceMode(mode) !== 'repo') {
    /* ①(2026-10-04 P-228c) 上游档：**保证 scene 档带 `mediaBase`**（同上面本仓档的理由）。
       分三种输入：① 已是产物页 URL（`Ae()` 建的，本来就带 mediaBase）⇒ 原样返回；
       ② 本仓 URL ⇒ 换回产物页路径，并按需补 `mediaBase`；③ 其它 ⇒ 原样返回。 */
    if (!isLoader) return raw
    const hashAt = raw.indexOf('#')
    const head = hashAt >= 0 ? raw.slice(0, hashAt) : raw
    const hash = hashAt >= 0 ? raw.slice(hashAt) : ''
    const qAt = head.indexOf('?')
    const originPrefix = (/^https?:\/\/[^/]+/i.exec(raw) || [''])[0]
    let query = qAt >= 0 ? head.slice(qAt + 1) : ''
    const qget = (k) => {
      const hit = query.split('&').find((s) => s.split('=')[0].toLowerCase() === k)
      if (hit === undefined) return null
      try { return decodeURIComponent(hit.slice(hit.indexOf('=') + 1)) } catch (e) { return hit.slice(hit.indexOf('=') + 1) }
    }
    const qhasCI = (name) => query.split('&').some((x) => x && x.split('=')[0].toLowerCase() === name.toLowerCase())
    if (String(qget('type') || 'scene').toLowerCase() === 'scene' && qget('src') && !qhasCI('mediaBase')) {
      const originNow = originPrefix || (typeof location !== 'undefined' ? location.origin : '')
      const mb = 'mediaBase=' + encodeURIComponent(originNow + '/media/dev')
      query = query ? (query + '&' + mb) : mb
    }
    return originPrefix + '/wallpaper-engine-webgl/renderer/index.html' + (query ? '?' + query : '') + hash
  }
  if (!isProduct && !isLoader) return raw
  const originPrefix = (/^https?:\/\/[^/]+/i.exec(raw) || [''])[0]
  const hashAt = raw.indexOf('#')
  const head = hashAt >= 0 ? raw.slice(0, hashAt) : raw
  const hash = hashAt >= 0 ? raw.slice(hashAt) : ''
  const qAt = head.indexOf('?')
  const kept = (qAt >= 0 ? head.slice(qAt + 1) : '').split('&').filter((s) => s !== '')
  const get = (k) => {
    const hit = kept.find((s) => s.split('=')[0].toLowerCase() === k)
    if (hit === undefined) return null
    try { return decodeURIComponent(hit.slice(hit.indexOf('=') + 1)) } catch (e) { return hit.slice(hit.indexOf('=') + 1) }
  }
  const upsert = (k, v) => {
    const i = kept.findIndex((s) => s.split('=')[0].toLowerCase() === k)
    if (i >= 0) kept[i] = k + '=' + v
    else kept.push(k + '=' + v)
  }
  //  scene：`src` 就是 itemId；web/video：`src` 是路径 ⇒ 从 `${mediaBase|webBase}/<id>/…` 段取回同一个 id
  //  （取不到就不补，让渲染器自己按 `src` 报错，而不是编一个 id）
  const itemId = get('id') || itemIdOf(kept.join('&'))
  if (itemId) upsert('id', encodeURIComponent(itemId))
  if (get('res') === null) {
    const cap = rendererDprCap(opts)
    upsert('res', cap == null ? 'dpr' : ('dpr' + cap))
  }
  /* ④(2026-09-24 用户第 6 条「预览闪一下 8899 整页」) **无外壳形态**：本仓渲染器页在 iframe 里只该出画，
     不该先画一遍"带顶栏/日志面板的整页"。服务端（两个入口共用同一份实现）只在 `?shell=0` 时注入
     隐藏外壳的样式 + 首帧握手脚本；这里把它写进 URL ⇒ 预览从**第一帧**起就是黑底画布。
     纪律：只在**本仓档**补（上游产物页没有这条约定，一个字符都不动它）；已有 `shell=` 的显式调试档不覆盖。 */
  if (get('shell') === null) upsert('shell', '0')
  /* ①(2026-10-04 P-228c) **`mediaBase` 不许在本仓档被洗掉**：上游产物页的 scene 档要求
     `mediaBase` 与 `src` **同时存在**（内部拼 `${mediaBase}/${src}` 再取 `${base}/scene.pkg`
     + `${base}/project.json`，缺失时抛「场景壁纸缺少 mediaBase/src」）。本仓档不需要它，但
     `rendererSourceUrl()` 是**往返**改写：本仓 URL 被再切回上游档时会带回同一条查询串 ⇒ 这里若
     丢掉它，工具条上游档就会挂成空（实测 `canvases: []`、无任何包请求）。
     值 = 站点同款 `${origin}/media/dev`（scenepkg/project.json 就在该目录下，服务端已实测 200）。 */
  const srcParam = get('src')
  const typeParam = String(get('type') || 'scene').toLowerCase()
  const hasCI = (name) => kept.some((x) => x.split('=')[0].toLowerCase() === name.toLowerCase())
  const upsertCI = (name, v) => {
    const i = kept.findIndex((x) => x.split('=')[0].toLowerCase() === name.toLowerCase())
    if (i >= 0) kept[i] = name + '=' + v
    else kept.push(name + '=' + v)
  }
  if (typeParam === 'scene' && srcParam && !hasCI('mediaBase')) {
    upsertCI('mediaBase', encodeURIComponent((originPrefix || (typeof location !== 'undefined' ? location.origin : '')) + '/media/dev'))
  }
  /*  ②③(P-228f 2026-10-05) 三个新档位写进同一条查询串：`skipintro`（去除开屏动画）、
      `webmode`（Web 壁纸渲染模式：sandbox/compat）、`hybrid`（DSH 进程流式播放）。
      **只在 opts 明确给出时才写**（缺省 undefined ⇒ 一个字符都不动）⇒ 既有 A 组判据与产物档行为不变。 */
  const optBool = (v) => (v === true ? '1' : (v === false ? '0' : (v === undefined || v === null || v === '' ? null : String(v))))
  /*  `skipintro`：开 ⇒ `auto`（渲染器按开场动画长度自动前推），关 ⇒ `0`；缺省不写。 */
  const optIntro = (opts && opts.skipIntro === true) ? 'auto' : ((opts && opts.skipIntro === false) ? '0' : null)
  if (optIntro !== null) upsertCI('skipintro', optIntro)
  /*  ②(P-228f) Web 壁纸执行方式用的是**渲染器自己的档位名** `?webframe=auto|compat|sandbox`
      （`core/web-frame-host.mjs` 的 `resolveWebFrameMode`）：被宿主嵌入时 `auto` 解析成 **sandbox**
      ⇒ 真机上"沙箱档加载不出来"的 web 壁纸，工具条切「兼容」即可。 */
  if (opts && opts.webFrame) upsertCI('webframe', encodeURIComponent(String(opts.webFrame)))
  const optHybrid = optBool(opts && opts.hybrid)
  if (optHybrid !== null) upsertCI('hybrid', optHybrid)
  /*  ⑦(2026-10-12 用户 :8902 第 2/3 条「视差 / x-ray 没生效」的**页面侧根因 C**) 视差档位：
      `demo.html:8905` 的 `parallaxOff = !/^(1|official|legacy)$/.test(?parallax)` ⇒ **缺省关**；
      测试台此前从不写这个参数 ⇒ 相机视差 + 对象级 `parallaxDepth` 在默认档整体停用（用户看不到视差）。
      这里只把**渲染器已有的取值**原样带进预览 URL（`1` / `official` / `legacy` / `0`），
      **不动 core/demo.html 的判定** ✗；缺省（控件不在 / opts 没给）⇒ 一个字符都不写，行为与以前逐字一致。
      上游产物档也照写：它不认这个参数（无害），但**往返改写**（本仓 ⇄ 上游档来回切）因此不丢档位。 */
  if (opts && opts.parallax) upsertCI('parallax', encodeURIComponent(String(opts.parallax)))
  return originPrefix + RENDERER_SOURCE_REPO_PATH + '?' + kept.join('&') + hash
}
/** ⑨(P-228f 2026-10-05) 滤镜档 → CSS filter：**唯一映射处**（纯函数，判据直接对它逐值对账）。
 *  为什么要有它：`#fx` 这个下拉以前只有选项、**没有任何消费者** —— 真机读数"改滤镜不生效"。
 *  落点 = 预览舞台 `#stage` 的 CSS filter（只作用于预览画面，不动渲染器页、不改包内容）。 */
export function filterPlan(value) {
  const v = String(value == null ? '' : value).toLowerCase()
  const table = {
    none: '',
    blur: 'blur(6px)',
    grayscale: 'grayscale(1)',
    sepia: 'sepia(1)',
    vivid: 'saturate(1.6) contrast(1.08)',
    warm: 'sepia(.35) saturate(1.25) hue-rotate(-12deg)',
    cool: 'hue-rotate(18deg) saturate(1.12)',
    invert: 'invert(1)',
    brighten: 'brightness(1.25)',
    darken: 'brightness(.75)',
    contrast: 'contrast(1.5)',
  }
  return { value: Object.prototype.hasOwnProperty.call(table, v) ? v : 'none', css: table[v] === undefined ? '' : table[v] }
}
/** 在 `HTMLIFrameElement.prototype` 的 `src` 访问器上**再包一层**（与 `installBandFeedSrcHook` 同构、
 *  同一条链）：写入 URL 时按**当前**来源档改写路径/补参数。三层包装（P-93 前缀 → bandfeed 查询 →
 *  本层来源）作用在不同部分 ⇒ 谁先谁后结果一致，全仓仍只有一条 URL 改写链。
 *  幂等：`proto.__benchRendererSrc` 标记；没有可包装的访问器 ⇒ 静默降级（返回 false，不弄坏页面）。 */
export function installRendererSourceSrcHook(proto, modeOf, optsOf) {
  try {
    if (!proto) return false
    const desc = Object.getOwnPropertyDescriptor(proto, 'src')
    if (!desc || typeof desc.set !== 'function' || typeof desc.get !== 'function') return false
    if (proto.__benchRendererSrc) return true
    const setter = desc.set
    const getter = desc.get
    const modeNow = (typeof modeOf === 'function') ? modeOf : (() => RENDERER_SOURCE_DEFAULT)
    const optsNow = (typeof optsOf === 'function') ? optsOf : (() => ({}))
    Object.defineProperty(proto, 'src', {
      configurable: true,
      enumerable: true,
      get() { return getter.call(this) },
      set(v) { setter.call(this, rendererSourceUrl(v, modeNow(), optsNow())) },
    })
    Object.defineProperty(proto, '__benchRendererSrc', { value: 1, configurable: true })
    return true
  } catch (e) { return false }
}
/** 状态行计划（纯函数）：把"当前档位 + 渲染器回报的能力"翻成一行。
 *  `probe` = 渲染器 iframe 里读到的东西（读不到传 null，**不谎报**）：
 *    · `probe.src`       = iframe 当前 src（用来判"到底跑的是哪条路径"）
 *    · `probe.loaded`    = 文档是否已就绪
 *    · `probe.hasWp`     = 是否发布了 `window.__wp`
 *    · `probe.caps`      = `window.__mpwHostCaps`（`false` 的键 = 该能力**明确降级**）
 *    · `probe.repoRenderer` = 是否认出了本仓渲染器（`__mpwHostApiReady` / `__mpwResTier`）
 *    · `probe.res`       = `window.__mpwLiveRes || window.__mpwResTier`（画布/DPR 读数）
 *    · `probe.error`     = 未能加载的原因（502/404 等，来自 iframe 的 load/错误探针）
 *  返回 `{ kind, text, attrs }`：kind ∈ upstream|repo|repo-degraded|loading|unreachable。 */
export function rendererSourceStatusPlan(lang, mode, probe) {
  const m = rendererSourceMode(mode)
  const p = probe || null
  const label = rendererSourceLabel(lang, m)
  if (m === 'upstream') {
    return { kind: 'upstream', text: t(lang, 'rendererSrc.upstreamOn', { label, note: rendererTierNote('upstream') }), attrs: { src: 'upstream', ready: p && p.loaded ? '1' : '0' } }
  }
  if (p && p.error) {
    return { kind: 'unreachable', text: t(lang, 'rendererSrc.unreachable', { why: p.error }), attrs: { src: 'repo', ready: '0' } }
  }
  if (!p || !p.loaded) {
    return { kind: 'loading', text: t(lang, 'rendererSrc.loading', { why: '' }), attrs: { src: 'repo', ready: '0' } }
  }
  const caps = (p && p.caps) || {}
  const degraded = Object.keys(caps).filter((k) => caps[k] === false)
  if (!p.repoRenderer) {
    /* ⑧(P-228f) 刚挂载的文档还没发布 `__mpwHostApiReady` ⇒ 先如实说"正在加载"，别下"不像本仓渲染器"的结论。 */
    const young = typeof p.docAgeMs === 'number' && p.docAgeMs >= 0 && p.docAgeMs < 4000
    if (young) return { kind: 'loading', text: t(lang, 'rendererSrc.loading', { why: '' }), attrs: { src: 'repo', ready: '0' } }
    return { kind: 'repo-degraded', text: t(lang, 'rendererSrc.notRepo', { url: String((p && p.src) || '').slice(0, 80) || '—' }), attrs: { src: 'repo', ready: '1' } }
  }
  const res = p.res || null
  return {
    kind: degraded.length ? 'repo-degraded' : 'repo',
    text: t(lang, degraded.length ? 'rendererSrc.repoDegraded' : 'rendererSrc.repoOn', {
      //  `__mpwResTier`（固定档位）**没有** `dpr` 字段，只有 `__mpwLiveRes`（活档位）才有
      //  ⇒ 缺字段时只写尺寸，不许渲染成 `DPRundefined`（那是把"没有这个读数"写成假读数）。
      label,
      res: res ? (res.width + '×' + res.height + (typeof res.dpr === 'number' ? ' @DPR' + res.dpr : '')) : '—',
      caps: degraded.join('/') || '—',
      note: rendererTierNote('repo'),
    }),
    attrs: { src: 'repo', ready: '1' },
  }
}

/** 在 `HTMLIFrameElement.prototype` 的 `src` 访问器上**再包一层**（导出 ⇒ Node 用假原型就能驱动
 *  真接线，不必进浏览器）：写入 URL 时把**当前**档位拼进去（`bandFeedUrl` 的边界照旧）。
 *  为什么包在属性上而不是自己重设一次 src：产物 2 处 `k.src = '/…/renderer/index.html?…'` 是它
 *  自己的挂载链，包装属性 = 与 P-93 ①-a 的前缀改写**同一条链**（那层管路径前缀、这层管查询串，
 *  作用在不同部分 ⇒ 谁先谁后结果一致），不需要第二套挂载/重挂载逻辑。
 *  `modeOf()` 每次现读当前档位 ⇒ 换档后产物下一次重设 src 自然带上新值。
 *  幂等：`proto.__benchBandFeedSrc` 标记防重复包装（重复 init 不会套两层 ⇒ 不会出现两个参数）。
 *  返回 true = 已装/本来就在；false = 没有可包装的访问器（桩环境 / 冻结原型）—— **静默降级**，
 *  绝不把页面弄坏。 */
/** ②(P-228f 2026-10-05) **包内音轨 opt-in**：渲染器只在 `?audio=1` 时给 sound 层建 `<audio>` 元素
 *  （见 `demo.html` 的 `AUDIO_ENABLED`）。而工具条「音条源 = 壁纸」的语义就是"用包内音轨"
 *  ⇒ 这条参数得跟着一起写，否则真机永远是"当前壁纸没有可播放的媒体"（媒体元素根本不存在，
 *  测试台的媒体扫描自然扫不到，NP 卡片也就没有进度/时长可接）。
 *  只对 **scene** 档生效（web/video 档自己的 `<video>`/`<audio>` 不归这条管）。
 *  `want=false` ⇒ 把已有的 `audio=` 去掉（切「关」/「麦克风」/「模拟」时不建元素、不漏音）。 */
export function audioOptInUrl(url, want) {
  const raw = String(url == null ? '' : url)
  if (!/(^|\/)(renderer\/index\.html|webloader\/?)([?#]|$)/.test(raw)) return raw
  const hashAt = raw.indexOf('#')
  const head = hashAt >= 0 ? raw.slice(0, hashAt) : raw
  const hash = hashAt >= 0 ? raw.slice(hashAt) : ''
  const qAt = head.indexOf('?')
  if (qAt < 0) return raw
  const base = head.slice(0, qAt)
  const kept = head.slice(qAt + 1).split('&').filter((x) => x !== '' && !/^audio=/i.test(x))
  const get = (k) => { const hit = kept.find((x) => x.split('=')[0].toLowerCase() === k); return hit === undefined ? null : decodeURIComponent(hit.slice(hit.indexOf('=') + 1)) }
  if (String(get('type') || 'scene').toLowerCase() !== 'scene') return raw
  if (want && !kept.some((x) => /^audio=/i.test(x))) kept.push('audio=1')
  return base + '?' + kept.join('&') + hash
}
/** 「当前音条档」是否要用包内音轨：壁纸档（auto / real）要；麦克风 / 模拟 / 关都不要。 */
export function bandFeedWantsPackageAudio(mode) {
  const m = bandFeedMode(mode)
  return m === 'auto' || m === 'real'
}
export function installBandFeedSrcHook(proto, modeOf) {
  try {
    if (!proto) return false
    const desc = Object.getOwnPropertyDescriptor(proto, 'src')
    if (!desc || typeof desc.set !== 'function' || typeof desc.get !== 'function') return false
    if (proto.__benchBandFeedSrc) return true
    const setter = desc.set
    const getter = desc.get
    const modeOfNow = (typeof modeOf === 'function') ? modeOf : (() => BAND_FEED_DEFAULT)
    Object.defineProperty(proto, 'src', {
      configurable: true,
      enumerable: true,
      get() { return getter.call(this) },
      set(v) { setter.call(this, audioOptInUrl(bandFeedUrl(v, modeOfNow()), bandFeedWantsPackageAudio(modeOfNow()))) },
    })
    Object.defineProperty(proto, '__benchBandFeedSrc', { value: 1, configurable: true })
    return true
  } catch (e) { return false }
}

/** 渲染器回报 → 状态行计划（纯函数）。`info` = 渲染器 `window.__mpwAudioBandInfo()` 的形状
 *  （`{ feed, source, reason, mic }`）；渲染器还没起来 / 还没出过帧 ⇒ 传 `null`（**不谎报**静音，
 *  也不假装有源）。`opt.micGateOpen` = 测试台「启用麦克风」闸门状态（mic 档静音时用来区分
 *  "闸门没开所以一次都没请求"与"浏览器拒绝了授权"）。
 *  返回 `{ kind, i18n, why, text, source, reason, silent }`：kind ∈ idle|live|silent|off|unsupported，
 *  `i18n` = 命中的文案键（**刻意不叫 `key`**：`key: '<20+ 字符>'` 这种形态会被
 *  `tests/secret-scan-test.mjs` 的 `assigned-credential-ext` 规则当成疑似凭据 —— 那条规则刻意把
 *  "长键名"也算进来，代价由白名单逐条豁免；这里换个更准确的名字，不去加白名单），
 *  `text` 就是写进状态行的那一行；`reason` 原样带出（不吞证据）。 */
export function bandFeedStatusPlan(lang, info, opt) {
  const o = opt || {}
  if (!info || (!info.source && !info.reason)) {
    // ③**第三种状态（诚实）**：渲染器文档已就绪却什么都没有回报 ⇒ 这个渲染器不认识 `?bandfeed=`
    //   （测试台今天嵌入的是产物页 `demo/renderer/index.html`；本仓自己的渲染器页在 :8899，
    //   `:8902` 上有同源 `/webloader/**` 代理）。这时**不许**写"等待渲染器回报"装作还在路上 ——
    //   要说清"档位只写进了 URL、这个渲染器不回报也不消费它"，否则用户会一直等一个永不到来的状态。
    if (o.rendererReady) {
      /* ⑧(P-228f) 刚挂载的文档（<4s）里频段模块还没跑到发布点 ⇒ 保持"等待渲染器回报"，
         不把"还没跑到"写成"这个渲染器不认 ?bandfeed="。 */
      if (typeof o.docAgeMs === 'number' && o.docAgeMs >= 0 && o.docAgeMs < 4000) {
        return { kind: 'idle', i18n: 'bandfeed.idle', why: null, text: t(lang, 'bandfeed.idle'), source: null, reason: null, silent: false }
      }
      /* ⑧(P-228f 2026-10-05) 先分清「档位没送到」与「渲染器不认」：URL 里根本没有 `bandfeed=` 时，
         「这个渲染器不回报」是**误诊**（真机根因就是改写链在 `/webloader/` 路径上丢了参数）。 */
      if (o.urlHasFeedParam === false) {
        return {
          kind: 'not-in-url', i18n: 'bandfeed.notInUrl', why: null, silent: false, source: null, reason: null,
          text: t(lang, 'bandfeed.notInUrl', { mode: bandFeedLabel(lang, bandFeedMode(o.feed)) }),
        }
      }
      return {
        kind: 'unsupported', i18n: 'bandfeed.noReport', why: null, silent: false, source: null, reason: null,
        text: t(lang, 'bandfeed.noReport', { mode: bandFeedLabel(lang, bandFeedMode(o.feed)) }),
      }
    }
    return { kind: 'idle', i18n: 'bandfeed.idle', why: null, text: t(lang, 'bandfeed.idle'), source: null, reason: null, silent: false }
  }
  const source = String(info.source || '')
  const reason = info.reason ? String(info.reason) : null
  if (source === 'analyser') return { kind: 'live', i18n: 'bandfeed.srcWallpaper', why: null, text: t(lang, 'bandfeed.srcWallpaper'), source, reason, silent: false }
  if (source === 'mic') return { kind: 'live', i18n: 'bandfeed.srcMic', why: null, text: t(lang, 'bandfeed.srcMic'), source, reason, silent: false }
  if (source === 'simulated') return { kind: 'live', i18n: 'bandfeed.srcSim', why: null, text: t(lang, 'bandfeed.srcSim'), source, reason, silent: false }
  if (source === 'off') return { kind: 'off', i18n: 'bandfeed.offNote', why: null, text: t(lang, 'bandfeed.offNote'), source, reason, silent: false }
  const r = String(reason || '')
  let why = null
  if (r.indexOf('mic-') === 0) {
    // 闸门（「启用麦克风」）关着时浏览器那侧**一次都不会被调用** ⇒ 说清是闸门，而不是"权限被拒"。
    why = (o.micGateOpen === false && info.feed === 'mic')
      ? 'bandfeed.whyMicGate'
      : (BAND_FEED_MIC_REASON_KEYS[r.slice(4)] || 'bandfeed.whyMicGeneric')
  } else if (r === 'no-analyser') why = 'bandfeed.whyNoTrack'
  else if (r.indexOf('no-source') === 0) why = 'bandfeed.whyNoSource'
  // 映射不到的原因**原样带出渲染器的 reason**（不吞证据），映射得到时也保留 reason 字段供探针读。
  const text = t(lang, 'bandfeed.silent') + (why ? '（' + t(lang, why) + '）' : (r ? '（' + r + '）' : ''))
  return { kind: 'silent', i18n: 'bandfeed.silent', why, text, source: source || 'silent', reason, silent: true }
}

/**
 * 把一个原生 <select> 换成同一个自绘紧凑组件：
 *  - 原生 select 视觉隐藏（select.bench-rd-native），**保留 value/options/onchange 契约**
 *  - 列表限高可滚动（CSS .bench-rd-list{position:fixed;max-height:min(280px,42vh);overflow-y:auto}）
 *  - 展开时按 dropdownLayerPlan 算 left/top（浮在页面上层、不占布局、不会被工具栏滚走）
 *  - 收起：点触发器（toggle）/ 点空白（调用方挂全局 click）/ Esc / 滚动（调用方挂全局 scroll）
 *  - 选中：写回 sel.value 并派发 change → bundle 侧逻辑一行不改
 * 返回 { sel, wrap, btn, list, label, open, close, position, isOpen }（isOpen 供测试断言）
 */
export function bindDropdown(doc, sel, registry) {
  if (!sel || !sel.parentNode) return null
  let wrap = sel.parentNode.classList && sel.parentNode.classList.contains('bench-rd') ? sel.parentNode : null
  let btn, list
  if (wrap) {
    btn = wrap.querySelector('.bench-rd-btn'); list = wrap.querySelector('.bench-rd-list')
  } else {
    wrap = doc.createElement('span'); wrap.className = 'bench-rd'
    btn = doc.createElement('button'); btn.type = 'button'; btn.className = 'bench-rd-btn'
    btn.setAttribute('aria-haspopup', 'listbox')
    list = doc.createElement('ul'); list.className = 'bench-rd-list'; list.setAttribute('role', 'listbox')
    sel.parentNode.insertBefore(wrap, sel)
    wrap.appendChild(btn); wrap.appendChild(list); wrap.appendChild(sel)
  }
  if (!btn || !list) return null
  sel.classList.add('bench-rd-native')
  const label = () => {
    const o = sel.options[sel.selectedIndex]
    btn.textContent = o ? o.textContent : sel.value
    btn.disabled = !!sel.disabled
  }
  const close = () => { wrap.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); anchorRect = null }
  /** ⑦(2026-09-25) 展开那一刻的触发框 rect + "自那以后真的动过没有"。
   *  为什么要 rect 而不是只看滚动源：滚动事件是**异步派发**的（改 `scrollTop` 之后下一帧才收到），
   *  "先滚动、后展开"会让**已经滚完**的那次滚动在展开之后才到达 ⇒ 只看源的话，刚打开的下拉会被一次
   *  其实已经过去的滚动收掉。浮层坐标本来就是按这张 rect 算的 ⇒ 只有 rect 变了才真的脱开。
   *  返回 `true`/`false`；**无法判定**（没量到 rect / 桩 DOM 无布局）返回 `null`，由调用方退回事件源判据。 */
  let anchorRect = null
  const anchorMoved = () => {
    if (!anchorRect || typeof btn.getBoundingClientRect !== 'function') return null
    try {
      const r = btn.getBoundingClientRect()
      return Math.abs(r.left - anchorRect.left) > 0.5 || Math.abs(r.top - anchorRect.top) > 0.5
        || Math.abs(r.width - anchorRect.width) > 0.5 || Math.abs(r.height - anchorRect.height) > 0.5
    } catch { return null }
  }
  /** 浮层坐标（fixed 坐标系 = 视口）—— 只在展开时算一次；滚动/改尺寸由调用方关掉重开。
   *  ⚠ 写内联坐标时**必须减掉包含块原点**：`#pages-track{contain:paint}` 是这些 fixed 后代的包含块，
   *    不减就会整体下移一个 header 的高度（正是"下拉与触发框之间有缝"的真因，见 layerFixedOffset）。 */
  const position = () => {
    try {
      if (typeof btn.getBoundingClientRect !== 'function') return null
      const rect = btn.getBoundingClientRect()
      anchorRect = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }   // ⑦浮层坐标的锚定依据
      const clipEl = (typeof document !== 'undefined' && doc.querySelector) ? doc.querySelector('#pages-track') : null
      const clip = (clipEl && typeof clipEl.getBoundingClientRect === 'function') ? clipEl.getBoundingClientRect() : null
      const inside = !!(clipEl && typeof clipEl.contains === 'function' && clipEl.contains(btn))
      const vp = { width: (typeof innerWidth === 'number' ? innerWidth : 0), height: (typeof innerHeight === 'number' ? innerHeight : 0) }
      const plan = dropdownLayerPlan(rect, clip, vp, list.scrollHeight || 280)
      const off = layerFixedOffset(clip, inside)
      try { list.style.left = (plan.left - off.dx) + 'px' } catch {}
      try { list.style.top = (plan.top - off.dy) + 'px' } catch {}
      try { list.style.minWidth = plan.width + 'px' } catch {}
      try { list.style.maxHeight = plan.maxHeight + 'px' } catch {}
      try { list.setAttribute('data-placement', plan.placement) } catch {}
      // 贴合校正（一次）：按**实测几何**把列表的贴合边对齐到锚点 ——
      //   · below：列表**上边缘** = 触发框下边缘 + gap；
      //   · above：列表**下边缘** = 触发框上边缘 − gap（内容比 max-height 矮时尤其需要，否则留一条缝）。
      //   `≤2px` 判据要在小数 rect 下也成立，所以这一步不做任何取整。
      if (typeof list.getBoundingClientRect === 'function') {
        try {
          const r2 = list.getBoundingClientRect()
          if (r2.height > 0) {
            const wantTop = plan.placement === 'below' ? plan.anchorTop : Math.max(plan.minTop, plan.anchorBottom - r2.height)
            const delta = wantTop - r2.top
            if (Math.abs(delta) > 0.05) list.style.top = (r2.top + delta - off.dy) + 'px'
          }
        } catch { /* 桩 DOM */ }
      }
      return plan
    } catch { return null }   // 桩 DOM 无布局：CSS 里的 fixed 默认值仍然成立
  }
  const open = () => {
    for (const d of registry || []) if (d !== api) d.close()
    list.innerHTML = ''
    for (const o of sel.options) {
      const li = doc.createElement('li')
      li.textContent = o.textContent
      li.dataset.value = o.value
      li.setAttribute('role', 'option')
      if (o.value === sel.value) li.setAttribute('aria-selected', 'true')
      li.addEventListener('click', () => {
        if (sel.value !== o.value) { sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true })) }
        label(); close()
      })
      list.appendChild(li)
    }
    wrap.classList.add('open'); btn.setAttribute('aria-expanded', 'true')
    // 必须在加 .open **之后**量：display:none 时 scrollHeight=0，量出来会退化成 80px 的缺省高度
    position()
  }
  btn.addEventListener('click', (e) => {
    if (e && e.preventDefault) e.preventDefault()
    if (e && e.stopPropagation) e.stopPropagation()
    wrap.classList.contains('open') ? close() : open()      // A6 点触发器可收回
  })
  sel.addEventListener('change', label)
  const api = { sel, wrap, btn, list, label, open, close, position, anchorMoved, isOpen: () => wrap.classList.contains('open') }
  if (registry) registry.push(api)
  label()
  return api
}

/* ============================ 第五批纯函数层（指针归中 / 时间层锁 / 壁纸品牌 / 拖动开关） ============================ */
// 用户实测三条（2026-09-15 第五批）：
//  ①鼠标移出画面后壁纸在最后位置「原地转圈」——上游**没有**离开语义：pointer.js 的
//    onLeaveWindow / pushExternalLeave 都只清按键、**刻意保留位置与 has**（且被文档与测试当契约守着）。
//    我们的补丁层在**舞台外**这一点上补一条「离开」语义：**只清按键、保留最后位置**（= 上游 pushExternalLeave），
//    `?ppark=center` 可显式要旧的"归中"，`?ppark=0` 则连这条都不加（彻底上游原样）。
//  ②壁纸自身的时钟/日期组件能被鼠标拖走——上游把「可拖动」交给壁纸自己的用户属性（如 hina
//    3554161528 的 newproperty21「可拖动/Dragable」）；我们按属性标签识别并置 false（?clockdrag=0 回退），
//    另对**注入到页面里的 DOM 时间层**做 pointer-events/选中/拖拽三件套（?clocklock=0 回退）。
//  ③媒体组件显示的是上游库品牌（WebWallGL / oneincase / 库 logo，硬编码在
//    renderer/vendor/we-scene/render/media.js:63-123）——改为壁纸自己的 project.json title + preview（?brand=0 回退）。

/**
 * 补丁层的 URL 开关（与渲染器侧 `?res=`/`?cursor=` 同形，一律 `new URLSearchParams(location.search)`）。
 * 各开关默认**全开**（= 新行为）；写成 0/false/off/no 表示回退到上游原行为。
 *   ppark     鼠标离开舞台/视口 → 指针回到中性位置（中心）
 *   clocklock 注入到页面里的 DOM 时间层 → pointer-events:none / 不可选中 / 不可拖拽
 *   clockdrag 壁纸自带「可拖动」用户属性 → 关掉（时钟/日期组件拖不走）
 *   brand     媒体组件的名称/图标 → 用壁纸自己的 project.json title / preview
 *   appname   ⑧站点品牌（测试台头部品牌名 + document.title）→ 显示产品现名 **WEwebLoader**；
 *             `?appname=upstream`（或 `=0/false/off/no`，或 `?brand=upstream`）⇒ **还原上游名**
 *             `wallpaper-engine-webgl`（版本号 `#app-version` 两种情况都不动）。
 *   openrewrite ⑨(P-129)「新窗口」按钮的 `window.open` 前缀改写（产物写死的旧绝对路径 → 相对本页）；
 *             `?openrewrite=off` ⇒ 不装包装（回到上游原行为：打开那条绝对旧路径，线上会 404）。
 */
export function readPatchFlags(search) {
  const q = new URLSearchParams(String(search == null ? '' : search))
  const on = (name, def) => {
    const v = q.get(name)
    if (v == null || v === '') return def
    return !/^(0|false|off|no)$/i.test(String(v))
  }
  // ⑧(2026-09-18 品牌改名) 站点品牌覆盖 = 默认开（显示 WEwebLoader）；`?appname=upstream|0|off|false|no`
  //   或 `?brand=upstream` ⇒ 关（还原上游名）。注意 `?brand=0` 只关**媒体组件**品牌，不影响站点品牌。
  const rawApp = String(q.get('appname') == null ? '' : q.get('appname'))
  const rawBrand = String(q.get('brand') == null ? '' : q.get('brand'))
  const appname = !(/^(upstream|0|false|off|no)$/i.test(rawApp) || /^upstream$/i.test(rawBrand))
  // ①(P-159) `?ppark=center` = 显式要旧的"归中"行为；其余任何"开"的写法都按新默认（只 leave、保位置）
  const pparkMode = /^center$/i.test(String(q.get('ppark') == null ? '' : q.get('ppark'))) ? 'center' : 'leave'
  /* ①E(2026-09-24) `?propimg=once|row|all` —— 属性面板富文本图片的去重档位（默认 once = 同一张图只展示一遍）。
     它不是布尔开关（on/off 语义不清），所以按**字符串取值**原样带出去，由 `richImageMode()` 归一。 */
  const propimg = String(q.get('propimg') == null ? '' : q.get('propimg')).toLowerCase()
  return { ppark: on('ppark', true), pparkMode, pushfwd: on('pushfwd', true), clocklock: on('clocklock', true), clockdrag: on('clockdrag', true), brand: on('brand', true), appname, openrewrite: on('openrewrite', true), propimg }
}

/** 鼠标离开后的处置决策（纯函数，便于 Node 断言）。
 *
 *  ⚠ ①(P-159 尾迹线实测转来的真机 bug) **默认不再"归中"**：
 *  旧实现返回 `{u:0.5, v:0.5, leave:true}`，调用点紧接着 `api.pushPointer(0.5, 0.5, 0, 0)` —— 等于
 *  "鼠标一离开就推一个画面正中的**活**指针" ⇒ 尾迹/涡流/吸附的力中心被拽到中心再消失（用户报的现象，
 *  核心线已在 `cb9acb8` 修掉"无指针时退化到层原点"的另一半）。上游 `pointer.js` 的 `pushExternalLeave`
 *  语义本来就是"**只清按键、保留最后位置**" ⇒ 默认跟随上游：`push:false`，只发 `pointerLeave()`。
 *  想要旧行为（归中）用 `?ppark=center` 显式打开；`?ppark=0` 连 `pointerLeave` 都不发（彻底回上游原样）。
 *  @returns {{park:boolean, reason:string, leave?:boolean, push?:boolean, u?:number, v?:number, buttons?:number}} */
export function pointerParkAction(env) {
  const e = env || {}
  if (e.enabled === false) return { park: false, reason: 'flag-off' }
  if (!e.hasApi) return { park: false, reason: 'no-renderer-api' }
  if (e.parked) return { park: false, reason: 'already-parked' }
  if (e.mode === 'center') return { park: true, reason: 'leave-center', leave: true, push: true, u: 0.5, v: 0.5, buttons: 0 }
  return { park: true, reason: 'leave', leave: true, push: false, buttons: 0 }
}

/** 元素自身文本（不含后代），时间层判定只看它，避免容器把整页文本聚合进来 */
export function ownTextOf(el) {
  if (!el || !el.childNodes) return ''
  let s = ''
  for (const n of el.childNodes) if (n && (n.nodeType === 3 || n.nodeName === '#text')) s += String(n.nodeValue == null ? '' : n.nodeValue)
  return s.trim()
}

const TIME_ONLY = [
  /^\d{1,2}:\d{2}(:\d{2})?(\s*(am|pm))?$/i,                       // 10:59 / 22:59:07 / 10:59 pm
  /^\d{4}\s*[年/.-]\s*\d{1,2}\s*[月/.-]\s*\d{1,2}\s*日?$/,        // 2026/09/14 · 2026-09-14 · 2026年9月14日
  /^\d{1,2}\s*[月/.-]\s*\d{1,2}\s*日?$/,                          // 9/14 · 9月14日
  /^(星期|周|週)[一二三四五六日天]$/,                                // 星期一 / 周日
  /^(mon|tue|wed|thu|fri|sat|sun)(day)?$/i,
]
const CLOCK_NAME = /(^|[-_.])(clock|time|date|weekday|calendar|时钟|时间|日期|星期)([-_.]|$)/i

/** 时间/日期**浮层**识别（纯函数）。
 *  只认「浮层（fixed/absolute）+ 时间样文本」或「浮层 + 时钟样类名/id」——
 *  文档流里的表格日期单元格（使用说明页的版本表）**不受影响**（position:static、无时钟类名）。
 *  img/svg 之类没有文本的装饰元素也放过（本函数不看它们）。 */
export function timeLayerPlan(desc) {
  const d = desc || {}
  const tag = String(d.tag || '').toUpperCase()
  if (['CANVAS', 'IFRAME', 'VIDEO', 'AUDIO', 'BODY', 'HTML', 'SCRIPT', 'STYLE', 'LINK'].indexOf(tag) >= 0) return { lock: false, reason: 'structural' }
  const pos = String(d.position || '').toLowerCase()
  const overlay = pos === 'fixed' || pos === 'absolute'
  const named = CLOCK_NAME.test(String(d.id || '')) || CLOCK_NAME.test(String(d.cls || ''))
  if (!overlay && !named) return { lock: false, reason: 'not-overlay' }
  const text = String(d.text == null ? '' : d.text).trim()
  const timeText = !!text && TIME_ONLY.some((rx) => rx.test(text))
  if (named && overlay) return { lock: true, reason: 'overlay+named' }
  if (timeText && overlay) return { lock: true, reason: 'overlay+time-text' }
  return { lock: false, reason: named ? 'named-not-overlay' : 'no-time-text' }
}

/** 壁纸品牌：名称取 project.json 的 title、图标取 preview（数据 URL 或 URL 字符串）。
 *  拿不到就给**中性文案**（generic），绝不回落到上游项目名/图标。 */
export function brandingFromProject(meta, opt) {
  const o = opt || {}
  const m = meta || {}
  const title = String(m.title == null ? '' : m.title).trim()
  const generic = String(o.generic == null ? '壁纸' : o.generic)
  if (!title) return { title: generic, artist: 'XHR666', hasThumbnail: false, thumbnail: '', source: 'neutral' }
  const thumb = String(o.thumbnail == null ? '' : o.thumbnail)
  return { title, artist: String(o.artist == null ? 'XHR666' : o.artist), hasThumbnail: !!thumb, thumbnail: thumb, source: 'project' }
}

/** 从渲染器收到的 src / cfg 里嗅出工坊 itemId（`/media/dev/<id>/scene.pkg`、`<id>/scene.pkg` 都能认） */
export function sniffItemId(text) {
  const s = String(text == null ? '' : text)
  const m = s.match(/(?:^|[/\\])(\d{6,12})(?:[/\\]|$)/)
  return m ? m[1] : ''
}

/** 壁纸自带的「可拖动」类布尔属性（要置 false 的键）。
 *  依据：hina 3554161528 的 project.json 里 `newproperty21` = text「可拖动/Dragable」type=bool value=true，
 *  它绑到 scene.json 时钟层 origin.script 的 scriptproperties.isMovable（见 docs/HINA-CLOCK-AND-PROPERTIES.md §1）。 */
export function dragPropsToDisable(properties) {
  const out = []
  for (const [key, v] of Object.entries(properties || {})) {
    if (!v || typeof v !== 'object') continue
    if (String(v.type || '').toLowerCase() !== 'bool') continue
    const label = String(v.text == null ? '' : v.text).replace(/<[^>]*>/g, '')
    if (/可拖动|可移动|拖动|拖拽|drag|movable/i.test(label + ' ' + key)) out.push(key)
  }
  return out
}

/** 媒体接管决策：真实 Now Playing（live）在播 ⇒ 不接管（尊重真实媒体，优先级见
 *  renderer/src/scene-mount.ts:526-534）；没有壁纸品牌 ⇒ 不动。 */
export function mediaBrandPlan(brand, stats) {
  if (!brand || !brand.title) return { take: false, reason: 'no-brand' }
  if (stats && stats.live) return { take: false, reason: 'live-media' }
  return { take: true, reason: 'simulated-media' }
}

/* ============================ 第七批纯函数层（插件同款目录/文件选择器 + 滚动位置稳定 + 文档视图轨道） ============================
   用户原话两条：
     ①「去引用我的上游的 DSH 插件那样同款的选择文件夹的功能，包括选择文件也是的」
       「选择文件夹时，鼠标上下滑动，画面有时候会自动弹跳到最顶上，有时候会自动锁定到最顶上」
     ②「README 界面下方约 1/5 区域无法显示内容（像被切掉）」
   这一层只有纯函数（Node 可直接 import 断言，无 DOM）；DOM 壳子在 init() 的「第七批」段落里。
   参考实现（**只借鉴"锚点 + 偏移"这一条滚动稳定技巧与选择器交互契约**，未复制任何代码；
   Lucide 图标见 docs/ICONS-NEEDED.md，台账见 docs/COPYING-RULES.md §4）：
     · TanStack Virtual（MIT）—— measureElement/scrollToOffset：滚动位置由"锚定条目 + 偏移"表达，
       条目高度变化时按锚点回推 scrollTop，而不是按比例（本层的 pickerRestoreScroll 就是这条）；
     · Firefox/Blink 的 CSS Scroll Anchoring（overflow-anchor）—— 浏览器自己也会"调 scrollTop"，
       这正是"有时候自动弹跳"的来源 ⇒ 列表容器必须 overflow-anchor:none（CSS 侧，见产物 CSS 追加段）；
     · DSH 插件 dsh-mpkg-wallpaper/lib/client.js:7014-7022/7464-7511 的目录选择器
       —— 交互契约（当前目录 + 上级 + 子目录列表 + "选择此文件夹"）与我们这层一一对应；
       它那里的两道补丁（按比例恢复 / 600ms 内让位）是被同一个根因逼出来的绕路，
       本层换成"锚点 + 偏移 + 写回期间不认自己的 scroll 事件"，见 pickerScrollGuard。 */

/** 归一化浏览器给的选择器路径：统一 '/'、去掉空段与 './'、保留大小写（纯函数） */
export function pickerPath(raw) {
  return String(raw == null ? '' : raw).replace(/\\/g, '/').split('/').filter((s) => s && s !== '.').join('/')
}

/** 索引的根名：取"带层级的第一条路径"的第一段（webkitdirectory 的 webkitRelativePath 必带根目录名）。
 *  只有散文件（单文件选择）⇒ 返回 ''（调用方按"这不是文件夹选择"处理）。 */
export function pickerRootOf(dirs, files) {
  const cand = []
  for (const d of (dirs || [])) if (String(d.path).indexOf('/') >= 0) { cand.push(String(d.path)); break }
  for (const f of (files || [])) if (String(f.path).indexOf('/') >= 0) { cand.push(String(f.path)); break }
  return cand.length ? cand[0].split('/')[0] : ''
}

/**
 * 把一次「授权选择」拿到的东西折成**可浏览的索引**（纯函数）：
 *   entries: [{ path, file?, getFile? }]（webkitdirectory 的 File / showDirectoryPicker 的 handle 包装）
 * 返回 { root, dirs:[{path,name,depth}], files:[{path,name,dir,ext,file,getFile}], truncated }
 * 说明：浏览器里**没有**"列任意目录"的能力，唯一合法来源就是用户授权过的那棵树
 *   —— 这正是本选择器与插件（Node 侧 /list-dirs）的差别：插件的宿主能直接读盘，网页不能。
 */
export function buildPickerIndex(entries, opt) {
  const o = Object.assign({ maxFiles: 6000, maxDepth: 8 }, opt || {})
  const dirMap = new Map()
  const files = []
  let truncated = false
  for (const e of (entries || [])) {
    const p = pickerPath(e && (e.path || e.name))
    if (!p) continue
    const parts = p.split('/')
    if (parts.length > o.maxDepth) { truncated = true; continue }
    if (files.length >= o.maxFiles) { truncated = true; break }
    for (let i = 1; i < parts.length; i++) {
      const dp = parts.slice(0, i).join('/')
      if (!dirMap.has(dp)) dirMap.set(dp, { path: dp, name: parts[i - 1], depth: i - 1 })
    }
    const name = parts[parts.length - 1]
    files.push({
      path: p, name, dir: parts.slice(0, -1).join('/'),
      ext: (name.indexOf('.') > 0 ? name.split('.').pop() : '').toLowerCase(),
      file: (e && e.file) || null, getFile: (e && e.getFile) || null,
    })
  }
  const dirs = [...dirMap.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { root: pickerRootOf(dirs, files), dirs, files, truncated: truncated || files.length >= o.maxFiles }
}

/** 当前目录名归一化：'' / 根名 / 已存在目录名 都接受；非法值一律折回根（纯函数） */
export function pickerResolveDir(index, cwd) {
  if (!index) return ''
  const root = String(index.root || '')
  const want = pickerPath(cwd)
  if (!want || want === '.' || want === root) return root
  const rel = want.indexOf(root + '/') === 0 ? want.slice(root.length + 1) : want
  const full = root ? root + '/' + rel : rel
  for (const d of index.dirs) if (d.path === full) return full
  return root
}

/** 上级目录（根 ⇒ 根自己；纯函数） */
export function pickerParentOf(cwd, root) {
  const cur = pickerPath(cwd)
  const r = String(root || '')
  if (!cur || cur === r) return r
  const parts = cur.split('/')
  parts.pop()
  const up = parts.join('/')
  return (r && (up === r || up.indexOf(r + '/') === 0)) ? up : r
}

/** 目录视图（纯函数）：子目录 + 当前目录下的文件 + 上级。
 *  列表行的形状统一成 {name, path, kind:'dir'|'file', ext}，方便过滤/锚点/增量渲染共用。 */
export function pickerView(index, cwd) {
  if (!index) return null
  const cur = pickerResolveDir(index, cwd)
  const prefix = cur ? cur + '/' : ''
  const dirs = []
  for (const d of index.dirs) {
    if (d.path.indexOf(prefix) !== 0) continue
    if (d.path.slice(prefix.length).indexOf('/') >= 0) continue
    dirs.push({ name: d.name, path: d.path, kind: 'dir', ext: '' })
  }
  const files = []
  for (const f of index.files) {
    if (f.dir !== cur) continue
    files.push({ name: f.name, path: f.path, kind: 'file', ext: f.ext, file: f.file, getFile: f.getFile })
  }
  return { cwd: cur, root: String(index.root || ''), parent: pickerParentOf(cur, index.root), isRoot: cur === String(index.root || ''), dirs, files }
}

/** 导航（纯函数）：target = '..' 上级 / '/' 最上层 / 子目录名或路径。
 *  返回 { cwd, moved, reason }——非法目标不动（reason 说明原因），调用方据此决定是否重绘。 */
export function pickerNavigate(index, cwd, target) {
  if (!index) return { cwd: '', moved: false, reason: 'no-index' }
  const cur = pickerResolveDir(index, cwd)
  const t = pickerPath(target)
  if (t === '..') {
    const up = pickerParentOf(cur, index.root)
    return { cwd: up, moved: up !== cur, reason: up !== cur ? 'up' : 'at-root' }
  }
  if (t === '/' || t === '' || t === '.') {
    return { cwd: String(index.root || ''), moved: cur !== String(index.root || ''), reason: 'home' }
  }
  const base = cur ? cur + '/' : ''
  const full = t.indexOf(String(index.root || '') + '/') === 0 ? t : base + t
  for (const d of index.dirs) if (d.path === full) return { cwd: full, moved: full !== cur, reason: 'enter' }
  return { cwd: cur, moved: false, reason: 'not-a-dir' }
}

/** 名称过滤（纯函数；大小写不敏感的子串）。空查询 ⇒ 原样返回（不重排、不新建数组语义）。
 *  ⚠ 过滤只改"行集合"，**不碰滚动位置**——滚动由锚点逻辑负责（这正是"过滤后不跳顶"的断言点）。 */
export function filterPickerRows(rows, query) {
  const list = rows || []
  const q = String(query == null ? '' : query).trim().toLowerCase()
  if (!q) return list.slice()
  return list.filter((r) => String(r && r.name ? r.name : '').toLowerCase().indexOf(q) >= 0)
}

/**
 * 滚动锚点：找出"第一个可见行"及其相对滚动容器顶边的偏移（纯函数，只吃矩形）。
 *   rects: [{top,bottom}] 行矩形（视口坐标）；containerRect: {top,bottom}
 * 为什么用锚点而不是比例：行高不一致（名字 + 类型两行）时比例恢复会漂；锚点 + 偏移是精确解。
 */
export function pickerAnchor(rects, containerRect) {
  const list = rects || []
  const ct = Number(containerRect && containerRect.top)
  if (!isFinite(ct)) return null
  for (let i = 0; i < list.length; i++) {
    const r = list[i]
    if (!r) continue
    if (Number(r.bottom) > ct + 1) return { index: i, offset: Number(r.top) - ct }
  }
  return null
}

/**
 * 重绘后的 scrollTop（纯函数）：锚点行回到原偏移；锚点行没了 ⇒ **夹住原 scrollTop**，
 * 绝不回 0。返回 { scrollTop, reason }：
 *   'anchor'  锚点行还在 → 精确回位（内容整体上移/下移都不跳）
 *   'clamp'   锚点行被过滤掉/删了 → 保留原有位置（夹到 [0, max]）——这是"跳顶/锁顶"的正面防线
 *   'noop'    非有限输入 ⇒ 不动
 */
export function pickerRestoreScroll(plan) {
  const p = plan || {}
  const max = Math.max(0, Number(p.scrollHeight || 0) - Number(p.clientHeight || 0))
  const prev = Number(p.prevScrollTop)
  const keep = isFinite(prev) ? Math.min(Math.max(0, prev), max) : 0
  // ①(第七批 修，2026-09-17 无头 Firefox 探针实测)「锚点行已被过滤/删除」时调用方传的是 **null**，
  //   必须当成"没有锚点"。原写法 `Number(null)` = 0 且 isFinite(0) = true ⇒ 被当成有效锚点算 top−off，
  //   结果为负再夹到 0，表现正是用户报的「鼠标上下滑动时画面自动弹跳到最顶上」（探针：真弹窗
  //   setPickerFilter 后 scrollTop 300 → 0，reason 还被记成 'anchor'）；"锁在最顶上"则是同一个 0 被
  //   后面的恢复逻辑反复写回。⇒ 这一条同时挡住两种症状。
  const top = (p.anchorContentTop == null || p.anchorContentTop === '') ? NaN : Number(p.anchorContentTop)
  const off = (p.anchorOffset == null || p.anchorOffset === '') ? NaN : Number(p.anchorOffset)
  if (!isFinite(top) || !isFinite(off)) return { scrollTop: keep, reason: isFinite(prev) ? 'clamp' : 'noop' }
  return { scrollTop: Math.min(Math.max(0, top - off), max), reason: 'anchor' }
}

/** 程序化恢复要不要让位给用户（纯函数）。用户刚滚过（默认 700ms 内）⇒ 一个字都不许写 scrollTop。
 *  插件侧的绕路是"按比例恢复 + 600ms 内让位"（client.js:7019-7022）；让位这条是对的，比例那条不要。 */
export function pickerScrollGuard(env) {
  const e = env || {}
  const win = e.windowMs == null ? 700 : Number(e.windowMs)
  const last = Number(e.lastUserScrollAt)
  const now = Number(e.now)
  if (!isFinite(last) || last <= 0) return { skip: false, reason: 'no-user-scroll' }
  if (!isFinite(now)) return { skip: false, reason: 'no-clock' }
  return (now - last) < win ? { skip: true, reason: 'user-scrolling' } : { skip: false, reason: 'idle' }
}

/**
 * 键盘导航决策（纯函数）—— 与插件侧同一行为契约（Esc 关 / ↑↓ 移动 / Enter 激活或确认）。
 * env: { key, rows, index }（index = 当前游标，-1 = 还没选任何行）
 * 返回 { action, index }：
 *   'close'    Esc —— 关弹窗（不写任何状态）
 *   'next'/'prev'  ↑↓ —— 在行集合内移动，到头就停（不绕圈；行集合为空 ⇒ 'none'）
 *   'activate' Enter 且游标在某行 ⇒ 激活那一行（目录=进入 / 文件=选中）
 *   'confirm'  Enter 但没游标 ⇒ 等同底部按钮（目录模式=就选这个文件夹）
 *   'none'     其它键一律不接管（过滤框照常输入）
 */
export function pickerKeyAction(env) {
  const e = env || {}
  const key = String(e.key || '')
  const rows = Math.max(0, Number(e.rows) || 0)
  const cur = Number(e.index)
  const idx = isFinite(cur) ? cur : -1
  if (key === 'Escape' || key === 'Esc') return { action: 'close', index: idx }
  if (key === 'ArrowDown') return rows ? { action: 'next', index: Math.min(rows - 1, idx + 1) } : { action: 'none', index: idx }
  if (key === 'ArrowUp') return rows ? { action: 'prev', index: Math.max(0, idx - 1) } : { action: 'none', index: idx }
  if (key === 'Enter') return (idx >= 0 && idx < rows) ? { action: 'activate', index: idx } : { action: 'confirm', index: idx }
  return { action: 'none', index: idx }
}

/** 增量渲染的键差（纯函数）：只为证明"重绘不等于清空容器"。
 *  返回 { add, remove, keep, order }——DOM 侧按 add 建新节点、remove 删旧节点、keep 复用并原地移动。 */
export function pickerRowDiff(prevKeys, nextKeys) {
  const prev = (prevKeys || []).map(String)
  const next = (nextKeys || []).map(String)
  const pset = new Set(prev), nset = new Set(next)
  return {
    add: next.filter((k) => !pset.has(k)),
    remove: prev.filter((k) => !nset.has(k)),
    keep: next.filter((k) => pset.has(k)),
    order: next.slice(),
  }
}

/** input.accept → 扩展名集合（纯函数）。'image/*,.png' ⇒ {any:['image/'], ext:['png']} */
export function pickerAcceptKinds(accept) {
  const out = { any: [], ext: [] }
  for (const raw of String(accept == null ? '' : accept).split(',')) {
    const s = raw.trim().toLowerCase()
    if (!s) continue
    if (s.indexOf('/') >= 0) out.any.push(s)
    else if (s.indexOf('.') === 0) out.ext.push(s.slice(1))
  }
  return out
}

/** 文件名是否符合 accept（纯函数）。kinds 为空 ⇒ 全通过（"选择文件"的默认口径）。 */
export function pickerAcceptMatch(name, kinds) {
  const n = String(name == null ? '' : name).toLowerCase()
  const k = kinds || { any: [], ext: [] }
  if (!k.any.length && !k.ext.length) return true
  const ext = n.indexOf('.') > 0 ? n.split('.').pop() : ''
  if (k.ext.indexOf(ext) >= 0) return true
  for (const a of k.any) {
    const head = a.split('/')[0]
    if (head === '*') return true
    if (head === 'image' && ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg'].indexOf(ext) >= 0) return true
    if (head === 'audio' && ['mp3', 'ogg', 'wav', 'flac', 'm4a', 'aac', 'opus'].indexOf(ext) >= 0) return true
    if (head === 'video' && ['mp4', 'webm', 'mov', 'm4v', 'mkv'].indexOf(ext) >= 0) return true
  }
  return false
}

/**
 * ②「README 面板下方约 1/5 被切」的**布局决策**（纯函数）。
 * 根因：`#main{display:grid;grid-template-rows:auto minmax(0,1fr) 200px}` 是三条**显式轨道**。
 *   文档视图下 bundle 把 `#editor-chrome` 与 `#logs` 都设成 `hidden`（display:none）⇒
 *   ① `#workspace` 被自动放置顶到第 1 条（`auto`）轨道，第 2 条 `minmax(0,1fr)` 空着；
 *   ② 第 3 条 `200px` 是固定轨道：**没有条目也照样占 200px**。
 *   ⇒ 面板高度 = main − 200px，底部整整 200px 死区（800px 视口 = 25%，常见窗口高 ≈1/5）。
 * 修法：CSS 把三个子元素**钉死**在 1/2/3 轨道（`grid-row`），并给"只剩文档视图"的 #main 挂一个类，
 *   把两条空轨道收成 0；轨道值本身仍由 CSS 决定（JS 不写内联 grid-template-rows，免得
 *   把 bundle 自己的 `#main.logs-collapsed{…35px}` 压掉）。
 */
export function mainViewPlan(env) {
  const e = env || {}
  const chrome = e.chromeVisible !== false
  const logs = e.logsVisible !== false
  const docsOnly = !chrome && !logs
  return { docsOnly, cls: docsOnly ? 'bench-view-docs' : '', reason: docsOnly ? 'docs-only' : (chrome ? 'stage' : 'chrome-hidden') }
}

/* ═══════════════ ⑭(P-142 2026-09-19 用户第 1/2/3 项) 资源管理器收纳 + 声音控件（NowPlaying）+ video 壁纸声音接线 ═══════════════
   用户原话：
     ①「8901 最左边的资源管理器，也要设置一个可以将它收纳起来的按键」
     ②「把调整它这个声音的这一项放到**壁纸配置的下面**（壁纸配置这一栏的下半部分做成声音控件），
        声音控件可以被展开，按它当前的范围大小算它后面被挡住的选项」
     ③「有一些 video 壁纸它也是有声音的，但是默认给他静音掉了 —— Video 壁纸的声音也要接入我这个声音的控件」

   三条落点（本文件只做 JS；样式/标记在 demo/index.html 的静态表里，见那里的 ⑭ 段）：
     ① `#sidebar-toggle`（`demo/index.html` 里 `.sidebar-title` 行右侧那个把手）两态开关：
        状态类挂在 **`<body>`** 上（`bench-nav-collapsed`）而不是 `<html>` 上 —— 理由：
        `tests/demo-check.mjs` 的 D8 会把 `SITE_LAYOUT_CSS` 的每条选择器自动前缀成 `html.bench-shell <选择器>`，
        只有**后代选择器**能被那条判据表达；类挂 body ⇒ 规则仍进 SITE_LAYOUT_CSS，D8 照样逐条守。
        首帧由 `<body>` 开头的同步脚本从 localStorage 加类（不闪一下展开态），本函数只做"对齐 aria + 兜底补类"。
        舞台跟着重算：收起 = 网格第 1 列只剩导轨宽（`--mpw-lib-w:26px`），`#workbench` 是
        `grid-template-columns:var(--mpw-lib-w,300px) auto minmax(0,1fr)` ⇒ `#main`/`#stage` 自动多出那 274px，
        不留空白占位（有几何断言）。
     ② `#np-host`（`#props` 里的浮层，见 index.html）：上半部是组件（React 独占 `#np-mount`），
        下半部是本补丁自己的传输条（音量/静音/进度 —— **组件没有这些入口**，见 `now-playing/README.md` 与
        `mount.tsx`：`mountNowPlaying(el, {morph,corner,stroke})` 只有三个旋钮，没有回调/受控属性）。
        遮挡几何由 `npOcclusionPlan()` 算（纯函数）：收起态 = 那一条窄条（78px 的 `.snd-box`）+ 传输条，
        展开态 = 189px 的卡片 + 传输条；`#props-body` 的 `padding-bottom` 把**展开态**的高度也算进去
        ⇒ 两个状态下每一个属性项都滚得到（"不许永久遮住"是可断言的不变量）。
     ③ video 壁纸的 `<video>` 在**同源 iframe**（`#frame` → renderer）里。播放/暂停走组件播放键的
        `aria-pressed`（React 的离散事件在它自己的根监听器里同步 flush，我们的监听器挂在它的父节点 `#np-host`
        并再等一个微任务 ⇒ 读到的一定是新状态），音量走 `__wp.setVolume()`（renderer 自己的契约：
        `setVolume(t){…ue.video.volume=…;ue.video.muted=t<=0…}`，见 `demo/assets/renderer-BOSoB05I.js`）
        **并且**直接写 `<video>` 元素（API 缺席/漂移时的落点）；进度按 `timeupdate`/`durationchange` 同步。
        默认仍是静音（用户抱怨的是"没接进控件"，不是"必须自动出声"）。

   本段全部**无浏览器可测**：纯函数 + `initNavSound({doc, win, …})` 依赖注入（假 DOM 驱动真代码），
   见 `tests/p142-nav-sound-test.mjs`。 */

/** ⑭a 资源管理器收纳：状态 → 视图计划（纯函数；门禁逐值断言）。 */
export const NAV_COLLAPSED_STORE = 'bench-sidebar-collapsed'
export const NAV_RAIL_W = 26
export function sidebarCollapsePlan(collapsed) {
  const on = !!collapsed
  return {
    collapsed: on,
    bodyClass: 'bench-nav-collapsed',
    railWidth: NAV_RAIL_W,
    store: on ? '1' : '0',
    ariaExpanded: on ? 'false' : 'true',
    // 文案：**不进 DICT**（T1 把词典逐键钉在上游 bench/i18n.ts 上）⇒ 双语静态串
    title: on ? '展开资源管理器 / Expand explorer' : '收起资源管理器 / Collapse explorer',
    // 首帧脚本与运行期开关读的是同一个键/同一个值域：'1' = 收起，其余 = 展开
    readCollapsed: (raw) => raw === '1',
  }
}

/** ⑭b 声音控件的遮挡计划（纯函数）：给定几何 → 展开/收起各遮挡**哪些**属性项 + 是否有滚不到的项。
 *  几何全部来自真实 `getBoundingClientRect()`（浏览器里就是实测；测试里由假 DOM 提供）。
 *  · `cover` = 从 `#props-body` 底边往上、到**最高遮挡矩形上边**的距离（属性表要预留这么多底高）；
 *  · `covered` = 与**可见遮挡矩形**（卡片 / 传输条）相交的属性项 —— 透明空隙不算遮挡；
 *  · `unreachable` = 即便滚到底也露不出来的项（判据：项底(内容坐标) > scrollHeight − cover）。
 *    ⚠ `body` 必须带**元素自己的**滚动口径（`scrollTop`/`scrollHeight`，它们**不是** rect 的字段）；
 *    给不出这两个数时不猜（`scrollKnown:false` + `unreachable` 空）—— 否则会静默变成"全都够不着"
 *    或"全都够得着"的假结论。`measure()` 就是这么传的，门禁断言 `scrollKnown === true`。 */
export function npOcclusionPlan(input) {
  const i = input || {}
  const items = Array.isArray(i.items) ? i.items.filter((x) => x && x.rect) : []
  const occluders = []
  if (i.card) occluders.push({ name: 'card', rect: i.card })
  if (i.strip) occluders.push({ name: 'strip', rect: i.strip })
  const hit = (a, b) => !!a && !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  const covered = items.filter((x) => occluders.some((o) => hit(x.rect, o.rect))).map((x) => x.id)
  const body = i.body || null
  const cover = body && occluders.length ? Math.max(0, Math.round(body.bottom - Math.min(...occluders.map((o) => o.rect.top)))) : 0
  const sh = Number(body && body.scrollHeight), st = Number(body && body.scrollTop)
  const scrollKnown = !!(body && isFinite(sh) && sh > 0)
  const unreachable = scrollKnown
    ? items.filter((x) => (x.rect.bottom - body.top) + (isFinite(st) ? st : 0) > sh - cover + 0.5).map((x) => x.id)
    : []
  return { cover, covered, coveredCount: covered.length, unreachable, unreachableCount: unreachable.length, scrollKnown: scrollKnown, occluders: occluders.map((o) => o.name), items: items.length }
}

/** 秒 → m:ss（传输条读数；与组件自己的 `clock()` 同形状，但**不 import 组件**以免页面多拉一个模块）。 */
export function npClock(sec) {
  const s = Number(sec)
  if (!isFinite(s) || s < 0) return '0:00'
  return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0')
}

/**
 * ⑭c 收纳 + 声音控件 + video 声音接线的运行期实现。依赖注入 ⇒ 假 DOM 可驱动**真代码**。
 * deps = { doc, win, loadNowPlaying?, setTimeout?/clearTimeout?/setInterval?/clearInterval? }
 * 返回的对象是本段的全部可观察面（X11 真机读它，门禁也读它）。
 */

// ═══ MPW-SELECT-WIRING（①用户第 6 项 2026-09-19；③(P-158) 去重）════════════════════════
// 分工（一条纪律：**一个原生 `<select>` 只允许一个看得见的自绘控件**）：
//   · 测试台外壳（设置弹层的 `#lang` + 工具条的 5 个）⇒ `bindDropdown()`（本文件 A5/A6 工厂，DOM 是 `.bench-rd`）；
//   · 壁纸自己的属性面板 `#props-body` 里的 combo ⇒ `mpw-select.js`（用户第 6 项点名的那个面）。
// 为什么外壳那 5 个必须从 mpw 摘掉（用户第 3 条的真因，实测复现）：
//   `init()` 里 `for (const sel of doc.querySelectorAll('select')) bindDropdown(...)` 已经给**每个** select
//   建好了 `.bench-rd`（按钮 + 列表 + 隐藏的原生 select）；随后 `enhanceBenchSelects()` 又对其中 5 个调
//   `enhanceSelect()`，它把 `.mpw_select` 插在 select 的**下一个兄弟位**（= `.bench-rd` 里面）⇒
//   每个选项后面多出一个「（空）」的控件；分辨率那一处还有 `.bench-rd-btn`（写「自适应 16:9」）与
//   `.mpw_select_btn` 两个按钮，点开 mpw 那个黑色列表选一次「自适应 16:9」后它的 label 才被填上
//   ⇒ 工具条上出现**两个**「自适应 16:9」。⇒ 外壳侧一律只留 `.bench-rd`。
export const BENCH_SELECT_IDS = []                       // 外壳里不再用 mpw 增强任何 select（导出名保留：门禁/文档引用过）
/** 外壳里**该由 `.bench-rd` 独占**的 select（一个 select 一个看得见的控件；顺序 = 工具条 DOM 顺序）。 */
export const BENCH_BAR_SELECT_IDS = ['lang', 'resolution', 'fit', 'dpr', 'fps', 'fx']

/** 清掉「历史遗留的第二套自绘控件」：`#toolbar` / `#site-actions` 里 select 后面的 `.mpw_select`。
 *  优先走 mpw 自己的 `destroy()`（会把原生 select 放回来、卸监听），句柄丢了就直接摘节点。
 *  幂等：清干净之后再调用恒返回 0。返回本次清掉的个数（探针/门禁读它）。 */
export function dropToolbarMpwSelects(doc = (typeof document !== 'undefined' ? document : null)) {
  if (!doc || !doc.querySelector) return 0
  let n = 0
  for (const host of ['#toolbar', '#site-actions']) {
    const box = doc.querySelector(host)
    if (!box) continue
    for (const sel of box.querySelectorAll('select')) {
      const h = sel.__mpwSelectHandle
      if (h && typeof h.destroy === 'function') { try { h.destroy(); n++ } catch { /* 单个失败留着也无害 */ } ; continue }
      let sib = sel.nextElementSibling
      while (sib && sib.classList && sib.classList.contains('mpw_select')) {
        const next = sib.nextElementSibling
        try { sib.remove(); n++ } catch { /* ignore */ }
        sib = next
      }
    }
  }
  return n
}

/** mpw 控件按钮上的文案同步（**呈现层兜底**，不改 `mpw-select.js` 的行为）。
 *  为什么需要：`mpw-select.js` 的 `paintButton()` 读的是**闭包里的 `model`**，而 `model` 只在 `open()` 里
 *  才被赋值 ⇒ 首次展开之前，按钮一直写「（空）」（选项明明在 select 里）；用户看到的"空的下拉框"就是它。
 *  这里按同一口径（`String(o.textContent).trim()`）把 label 写成真实选中项；`mpw-select.js` 一旦把
 *  `paintButton` 改成每次现读 options（根治），本函数写的就是同一个字符串 ⇒ 自然变成无副作用的幂等操作。 */
export function syncMpwLabels(root = (typeof document !== 'undefined' ? document : null)) {
  if (!root || !root.querySelectorAll) return 0
  let n = 0
  for (const sel of root.querySelectorAll('select[data-mpw-select-native]')) {
    const h = sel.__mpwSelectHandle
    if (!h || !h.root || !h.root.querySelector) continue
    const lab = h.root.querySelector('.mpw_select_label')
    if (!lab) continue
    const o = sel.options && sel.options[sel.selectedIndex]
    const want = (o && o.textContent != null) ? String(o.textContent).trim() : '（空）'
    if (lab.textContent !== want) { try { lab.textContent = want; n++ } catch { /* ignore */ } }
    if (h.root.setAttribute) { try { h.root.setAttribute('data-bench-label', want) } catch { /* ignore */ } }
  }
  return n
}

/** 增强工具条那 6 个下拉；返回本次真正增强的数量（外壳侧现为 0：`.bench-rd` 已独占，见上面的分工）。 */
export function enhanceBenchSelects(doc = (typeof document !== 'undefined' ? document : null)) {
  if (!doc || !doc.getElementById) return 0
  dropToolbarMpwSelects(doc)                 // ③(P-158) 先清掉历史遗留的第二套控件（幂等）
  let n = 0
  for (const id of BENCH_SELECT_IDS) {
    const sel = doc.getElementById(id)
    if (!sel) continue
    if (sel.hasAttribute('data-mpw-select-native')) {
      //  ①**幂等 + 自愈**：判据是"句柄还活着"（`enhanceSelect` 把 handle 挂在 select 上），
      //    **不是**看 `nextElementSibling` —— 后者会被别的节点插进来而误判，从而造出第二个控件
      //    （实测：误判版跑出 15 个 `.mpw_select` / 6 个原生 select ⇒ 越补越多）。
      const h = sel.__mpwSelectHandle
      if (h && h.root && h.root.isConnected) {
        //  顺手清掉历史遗留的重复控件（只保留句柄那一个），保证"一个 select 一个控件"。
        let n2 = sel.nextElementSibling
        while (n2 && n2.classList && n2.classList.contains('mpw_select')) {
          const next = n2.nextElementSibling
          if (n2 !== h.root) { try { n2.remove() } catch (e) { /* ignore */ } }
          n2 = next
        }
        continue
      }
      sel.removeAttribute('data-mpw-select-native')
      sel.hidden = false
    }
    try { enhanceSelect(sel, { doc }); n++ } catch (e) { /* 单个失败 ⇒ 保留原生 */ }
  }
  return n
}

/**
 * 多跑几遍（工具条选项是**上游 bundle 在运行期填**的：module 执行那一刻 `<option>` 还没进来 ⇒
 * 自绘按钮会显示"（空）"）。`enhanceSelect` 自己会观察 select 的子节点变化并重画按钮，但**节点被整体换掉**
 * 的情况要这里自愈，所以 init 之后错开补几遍（不常驻定时器，跑完就结束）。
 */
export function scheduleBenchSelects(doc = (typeof document !== 'undefined' ? document : null), delays = [300, 1200, 3000]) {
  if (!doc || typeof setTimeout !== 'function') return 0
  let n = 0
  for (const ms of delays) { setTimeout(() => { try { n += enhanceBenchSelects(doc); watchBenchPropsSelects(doc) } catch (e) { /* ignore */ } }, ms); n++ }
  return n
}

/** 「壁纸配置」面板里**所有**下拉栏都必须是本仓自绘（`mpw-select.js` 的 `.mpw_select`），
 *  不许有裸的原生 `<select>` 露在外面。
 *
 *  ⑰(2026-09-24 用户第 17 条)「图片去重那个下拉栏是原生 `<select>` 而不是本仓自绘下拉 ⇒ 检查壁纸配置里
 *  所有下拉栏，凡原生 select 一律换成自绘」：改前的两个口子都在这里收口 ——
 *    ① 观察面只有 `#props-body`（`#props` 里的**头部那一行** `.props-row` 不在观察范围内；
 *       本补丁自己往那儿插的 `#bench-imgmode` 就是这么漏掉的）；
 *    ② 面板被重画（产物克隆/条件隐藏）之后新长出来的 select 没有第二次增强的机会。
 *  改后：观察 `#props` 整棵子树（含 `.props-row` / `.props-head-actions`），并且在
 *  `panelSelectProbe()` 里给出**可机读的读数**（原生 select 数 / 已增强数 / 泄漏清单）。
 *  `#bench-imgmode` 那条原生 select 已按用户第 3 条**整块删除**（见 `paintImgModeControl` 上面的注释）。 */
export function watchBenchPropsSelects(doc = (typeof document !== 'undefined' ? document : null)) {
  if (!doc || typeof MutationObserver !== 'function') return null
  const pass = () => {
    let n = 0
    for (const sel of doc.querySelectorAll('#props select:not([data-mpw-select-native]), #props-body select:not([data-mpw-select-native]), div#props select:not([data-mpw-select-native])')) {
      try { enhanceSelect(sel, { doc }); n++ } catch (e) { /* 保留原生 */ }
    }
    // ③(P-158) 每次补挂之后同步一次按钮文案：mpw 自己的 `paintButton()` 在首次展开前只会写「（空）」
    //   （`model` 只在 `open()` 里赋值），这里按同一口径补上真实选中项 ⇒ 页面上不再有"空 label"的控件。
    try { syncMpwLabels(doc) } catch { /* ignore */ }
    return n
  }
  pass()                                     // 首帧兜底（面板若已渲染）
  const host = doc.getElementById('props') || doc.getElementById('props-body')
  if (!host) return null
  const mo = new MutationObserver(() => pass())
  mo.observe(host, { childList: true, subtree: true })
  return mo
}

/** ⑰(2026-09-24 用户第 17 条) 「壁纸配置」面板下拉栏读数（门禁与真机同一入口）：
 *  `native` = 面板里还没被增强的原生 select 数（**必须为 0**）；
 *  `enhanced` = 已带 `data-mpw-select-native` 的 select 数；`leaked` = 前者的选择器清单。 */
export function panelSelectProbe(root = (typeof document !== 'undefined' ? document : null)) {
  if (!root || !root.querySelectorAll) return { panel: false, native: -1, enhanced: -1, leaked: [] }
  const panel = (root.getElementById && root.getElementById('props')) || (root.querySelector ? root.querySelector('#props') : null)
  if (!panel) return { panel: false, native: -1, enhanced: -1, leaked: [] }
  const sels = [...panel.querySelectorAll('select')]
  const leaked = sels.filter((s) => !s.hasAttribute('data-mpw-select-native'))
  return {
    panel: true, native: leaked.length, enhanced: sels.length - leaked.length,
    total: sels.length,
    leaked: leaked.map((s) => (s.id || s.className || 'select')),
    mpw: panel.querySelectorAll('.mpw_select').length,
  }
}
// ═══ MPW-SELECT-WIRING-END ═══

/* ①(2026-09-22 用户第 9 条) 音量**唯一落点**的模块级持有者：`applyAudio` 定义在 `initNavSound` 闭包内，
   而"改壁纸配置 ⇒ 产物重挂载渲染器"发生在 `init()` 的 iframe load 处理器里（跨闭包）⇒ 用它把落点引出去。
   只做引用转发，音量逻辑仍然只有 `applyAudio` 一份（不复制落点）。 */
let MPW_APPLY_AUDIO = null
export function initNavSound(deps = {}) {
  const D = deps.doc || (typeof document !== 'undefined' ? document : null)
  if (!D || !D.body || typeof D.querySelector !== 'function') return null
  const W = deps.win || (typeof window !== 'undefined' ? window : null) || {}
  const q = (sel) => { try { return D.querySelector(sel) } catch { return null } }
  const later = typeof deps.setTimeout === 'function' ? deps.setTimeout : (typeof setTimeout === 'function' ? setTimeout : null)
  const every = typeof deps.setInterval === 'function' ? deps.setInterval : (typeof setInterval === 'function' ? setInterval : null)
  const stopEvery = typeof deps.clearInterval === 'function' ? deps.clearInterval : (typeof clearInterval === 'function' ? clearInterval : null)
  const clamp01 = (v) => { const n = Number(v); return isFinite(n) ? Math.max(0, Math.min(1, n)) : 0 }
  const rectOf = (el) => { try { return el && el.getBoundingClientRect ? el.getBoundingClientRect() : null } catch { return null } }

  /* ── ① 资源管理器收纳（`#sidebar-toggle` 两态开关） ───────────────────────────── */
  const sidebar = q('#sidebar'), navBtn = q('#sidebar-toggle')
  const store = (() => {
    const own = W && W.localStorage
    return {
      get(k) { try { return own ? own.getItem(k) : null } catch { return null } },
      set(k, v) { try { if (own) own.setItem(k, v) } catch { /* 隐私模式/不透明源：忽略 */ } },
    }
  })()
  const navNow = () => { try { return !!(D.body.classList && D.body.classList.contains('bench-nav-collapsed')) } catch { return false } }
  function paintNav() {
    const p = sidebarCollapsePlan(navNow())
    if (navBtn) {
      // aria-expanded 说的是**这块面板**是否展开（收起 = false），与 <button> 的"可用性"无关
      try { navBtn.setAttribute('aria-expanded', p.ariaExpanded) } catch {}
      try { navBtn.setAttribute('title', p.title) } catch {}
      try { navBtn.setAttribute('aria-label', p.title) } catch {}
    }
    return p
  }
  function setNavCollapsed(v, persist = true) {
    const p = sidebarCollapsePlan(v)
    // 绝对写法（classList.toggle(cls, want)）而不是"翻转"：连点 N 次的结果只由 N 的奇偶决定，
    // 不存在"按当前状态反推"的竞态（用户点名的"点几次就重复开/关"就是这类 bug）
    try { D.body.classList.toggle(p.bodyClass, p.collapsed) } catch {}
    paintNav()
    if (persist) store.set(NAV_COLLAPSED_STORE, p.store)
    measure()
    return p.collapsed
  }
  // 一个按钮 = 一个监听器。重复 init（或将来有人再调一次）不许变成"一次点击翻两下"：
  // 元素上留标记，第二次直接跳过绑定。
  if (navBtn && !navBtn.__benchNavBound) {
    navBtn.__benchNavBound = true
    // 原生 <button>：Tab 可达、Enter/Space 由浏览器派发 click ⇒ **不再补 keydown**
    //（补了就会"键盘触发一次 + click 再一次" = 双重翻转，正是上面那条 bug）
    navBtn.addEventListener('click', (e) => {
      try { e && e.preventDefault && e.preventDefault() } catch {}
      setNavCollapsed(!navNow())
    })
  }
  // 首帧类由 <body> 开头的同步脚本加；这里按同一个键对齐一次（storage 不可用时 = 展开）
  try { D.body.classList.toggle('bench-nav-collapsed', sidebarCollapsePlan(false).readCollapsed(store.get(NAV_COLLAPSED_STORE))) } catch {}
  paintNav()

  /* ── 遮挡几何（`#props` 下半部的声音控件 vs 上半部的属性表） ──────────────────── */
  const propsEl = q('#props'), hostEl = q('#np-host'), mountEl = q('#np-mount')
  const propsBody = q('#props-body'), stripEl = q('#np-audio'), stageEl = q('#frame')
  const propsItems = () => {
    if (!propsBody || !propsBody.children) return []
    // 属性项 = #props-body 的直接子元素，滤掉补丁自己插的空态（与 paintPropsEmpty 同一口径）
    return [...propsBody.children].filter((el) => el && el.id !== 'props-empty' && el.id !== 'np-host')
  }
  const itemsWithRect = () => propsItems().map((el, i) => ({
    id: String((el.dataset && el.dataset.propId) || el.id || 'prop#' + i),
    rect: rectOf(el),
  })).filter((x) => x.rect)
  function measure() {
    // `body` 除了 rect 还要带**元素自己的**滚动口径（scrollTop/scrollHeight 不在 rect 上）：
    // 少了它们，"有没有滚不到的项"这条判据会静默失效（真机 2026-09-19 自测抓到过一次）
    const bodyRect = rectOf(propsBody)
    const body = bodyRect ? {
      left: bodyRect.left, right: bodyRect.right, top: bodyRect.top, bottom: bodyRect.bottom,
      scrollTop: propsBody ? Number(propsBody.scrollTop) || 0 : 0,
      scrollHeight: propsBody ? Number(propsBody.scrollHeight) || 0 : 0,
    } : null
    const plan = npOcclusionPlan({
      body: body,
      card: rectOf(q('#np-mount .snd-box')),      // 组件的可视盒：收起 78 / 展开 189（由组件自己 morph）
      strip: rectOf(stripEl),
      items: itemsWithRect(),
    })
    if (hostEl) {
      try {
        hostEl.setAttribute('data-cover', String(plan.cover))
        hostEl.setAttribute('data-covered', String(plan.coveredCount))
        hostEl.setAttribute('data-unreachable', String(plan.unreachableCount))
        hostEl.setAttribute('data-items', String(plan.items))
        hostEl.setAttribute('data-scroll', String(propsBody ? Number(propsBody.scrollTop) || 0 : 0))
        hostEl.setAttribute('data-covered-ids', plan.covered.join(','))   // 滚一滚换的是"哪几项"（计数可能不变）
      } catch {}
    }
    return plan
  }
  // 属性表滚动 ⇒ 被浮层压住的是**哪几项**会变（浮层固定在下半部）⇒ 去抖 120ms 重算一次。
  // 只读几何 + 写 4 个 data-*（不碰任何布局），与 refreshSwitcher 的 60ms 去抖同一套写法。
  if (propsBody && !propsBody.__benchNpScrollBound) {
    propsBody.__benchNpScrollBound = true
    let st = null
    propsBody.addEventListener('scroll', () => {
      if (st) return
      st = later(() => { st = null; measure() }, 120)
    })
  }

  /* ── ② 声音控件：挂载（React 独占 #np-mount；本补丁不碰它的子树） ─────────────── */
  let npApp = null, npState = 'idle'
  const npLoad = typeof deps.loadNowPlaying === 'function'
    ? deps.loadNowPlaying
    // 相对本模块 ⇒ /demo/ 与 /WEwebLoader/ 两个挂载点都成立（8902 的 /demo/** 与 /WEwebLoader/** 同一份树）
    : () => import('./now-playing/dist/now-playing.js')

  /* ── ③ video 壁纸的声音接线（同源 iframe 里的 <video>） ─────────────────────── */
  const frameDoc = () => { try { return stageEl && stageEl.contentDocument ? stageEl.contentDocument : null } catch { return null } }
  /** ①(P-161) 媒体扫描要**再下一层**：web 档的入口 HTML 跑在渲染器文档里的那个 sandbox iframe 里
   *  （`#frame` → `.//iframe`），它的 `<video>`/`<audio>` 才是"当前媒体"。同一源 ⇒ 直接可达；
   *  跨源时 `contentDocument` 取不到（catch 掉），扫描结果自然只剩外层 —— 不假装拿到了。 */
  const mediaDocs = () => {
    const out = []
    const d0 = frameDoc()
    if (d0) out.push(d0)
    try {
      const nested = d0 && d0.querySelectorAll ? [...d0.querySelectorAll('iframe')] : []
      for (const f of nested) {
        try { if (f && f.contentDocument) out.push(f.contentDocument) } catch { /* 跨源：跳过 */ }
      }
    } catch { /* 桩 DOM */ }
    return out
  }
  const stageVideos = () => {
    const out = []
    for (const d of mediaDocs()) { try { if (d.querySelectorAll) out.push(...d.querySelectorAll('video')) } catch { /* ignore */ } }
    return out
  }
  /** ①(P-161) 音频元素（web 档常见：只有 BGM 没有画面视频；scene 档的音轨不在此列）。 */
  const stageAudios = () => {
    const out = []
    for (const d of mediaDocs()) { try { if (d.querySelectorAll) out.push(...d.querySelectorAll('audio')) } catch { /* ignore */ } }
    return out
  }
  const stageApi = () => {
    try {
      const a = stageEl && stageEl.contentWindow && stageEl.contentWindow.__wp
      return a && typeof a.setVolume === 'function' ? a : null
    } catch { return null }
  }
  /** 在播的那一个（videoPairs 双缓冲时选它）；没有在播的取第一个有元数据的。 */
  const activeVideo = () => {
    const vids = stageVideos()
    return vids.find((v) => v && v.paused === false) || vids.find((v) => v && Number(v.duration) > 0) || vids[0] || null
  }
  /*  ③(2026-09-25 issue0924a2 用户第 3 条) `#np-volume` 现在由**组件**渲染（卡片内部的音量轨）⇒ 不再在
      挂载时缓存它的引用（那一刻它还不存在 —— 组件只在卡片展开时才渲染它），也不由本补丁直接写 `.value`
      （React 受控；直接写会被下一次 render 覆盖）。音量唯一真源仍是下面的 `vol`：`applyAudio()` 把它
      经 `pumpNp()` 推给组件，滑条自己派发的 `onChange` 又回到 `npTransport('volume', v)` ⇒ 一个环、一个源。 */
  const muteBtn = q('#np-mute'), seekEl = q('#np-seek')
  const runEl = q('#np-run'), timeEl = q('#np-time'), stageNote = q('#np-stage'), toolbarVol = q('#volume')
  /** 组件渲染出来的那个音量滑条（懒查；卡片收起/组件没挂 ⇒ null）。 */
  const volRangeEl = () => q('#np-volume')
  let vol = toolbarVol ? clamp01(toolbarVol.value) : 0    // 初始 = 工具条那支（挂载参数同一来源），默认 0 = 静音
  let muted = !(vol > 0)
  const paintMute = () => {
    if (!muteBtn) return
    const on = muted || !(vol > 0)
    try { muteBtn.setAttribute('aria-pressed', on ? 'true' : 'false') } catch {}
    try { muteBtn.setAttribute('title', on ? '取消静音 / Unmute' : '静音 / Mute') } catch {}
    for (const [id, hide] of [['#np-mute-slash', !on], ['#np-mute-wave', on]]) {
      const p = q(id); if (!p) continue
      try { if (hide) p.setAttribute('hidden', ''); else p.removeAttribute('hidden') } catch {}
      // SVG 子元素上的 `hidden` 属性在不同引擎里可靠性不一 ⇒ 同时写 style（两条都写，互为兜底）
      try { if (p.style) p.style.display = hide ? 'none' : '' } catch {}
    }
  }
  /** 唯一的音量落点：`__wp.setVolume()`（renderer 契约 → `<video>.volume/.muted` + 场景音轨）+
   *  直接写每个 `<video>`（API 不在时也**真的**作用到元素上）。`el.volume` 始终保滑块值，muted 另算。 */
  function applyAudio() {
    const eff = (muted || !(vol > 0)) ? 0 : vol
    const api = stageApi()
    if (api) { try { api.setVolume(eff) } catch { /* 渲染器拒绝/未就绪：下面的元素直写仍然生效 */ } }
    for (const el of stageVideos()) {
      try { el.volume = clamp01(vol); el.muted = !(eff > 0) } catch {}
    }
    /*  ③ 组件的滑条/百分数是**受控**的：这里不再直接写 DOM，改由 `pumpNp()` 把 `npSnapshot()` 推过去
        （`data.volume`/`data.muted` ⇒ React 重画滑条与第四键）。直接写 `.value` 会被下一次 render 覆盖，
        而且会让"谁是真源"变成两处。`#volume`（工具条，本补丁自己的元素）仍直接同步。 */
    if (toolbarVol) { try { if (String(toolbarVol.value) !== String(vol)) toolbarVol.value = String(vol) } catch {} }   // 只写值、不派发事件 ⇒ 不触发重挂载、不成环
    paintMute()
    try { pumpNp() } catch { /* 卡片还没挂上：下一次 paintProgress 会补 */ }
    return { vol, muted, effective: eff, slider: (() => { const el = volRangeEl(); return el ? String(el.value) : null })() }
  }
  const setVideoVolume = (v) => { vol = clamp01(v); muted = !(vol > 0); applyAudio(); return vol }
  const setVideoMuted = (m) => { muted = !!m; applyAudio(); return muted }
  const toggleMute = () => setVideoMuted(!(muted || !(vol > 0)))
  /** 播放/暂停：优先 `__wp.resume()/pause()`（它自己处理 videoPairs 与场景音轨，契约见文件头），
   *  然后**核实**元素状态；API 缺席或没做到 ⇒ 直接落到在播的那一个元素上（只碰一个）。 */
  function applyPlayPause(want) {
    const api = stageApi()
    if (api) {
      try { want ? api.resume() : api.pause() } catch { /* 落到下面的直写 */ }
      const a = activeVideo()
      if (a && want !== !a.paused) { try { want ? a.play() : a.pause() } catch {} }
    } else {
      const a = activeVideo()
      if (a) { try { want ? a.play() : a.pause() } catch {} }
    }
    paintProgress()
    return want
  }
  function paintProgress() {
    const a = activeVideo()
    const dur = a && isFinite(Number(a.duration)) && Number(a.duration) > 0 ? Number(a.duration) : 0
    const cur = a && isFinite(Number(a.currentTime)) ? Math.max(0, Number(a.currentTime)) : 0
    const pct = dur > 0 ? Math.max(0, Math.min(100, (cur / dur) * 100)) : 0
    if (runEl && runEl.style) runEl.style.width = pct.toFixed(2) + '%'
    /* 传输条与卡片同一条口径：有时间轴就写时间；没有（元数据没到）就如实写 `--:--`，不写 0:00。 */
    if (timeEl) timeEl.textContent = (a && dur > 0) ? (npClock(cur) + ' / ' + npClock(dur)) : '--:-- / --:--'
    if (hostEl) { try { hostEl.setAttribute('data-state', !a ? 'no-video' : (a.paused ? 'paused' : 'playing')) } catch {} }
    try { pumpNp() } catch { /* 卡片还没挂上：忽略 */ }        // ①(P-161) 卡片与传输条吃同一份读数
    return { cur, dur, pct }
  }
  /* ── ②″(P-161) 播放卡片的受控数据面：把真实媒体读数推给组件，并把组件派发的 op 落回媒体 ──────
     背景：组件（`demo/now-playing/`，本仓 GPL）原本只有 morph/corner/stroke 三个旋钮、没有数据面
     ⇒ 卡片上的标题/进度/时间全是**装饰值**（"Cabra Field"/"Side B"/52s），进度条也不可点。
     现在组件多了 `data`/`onTransport` 两个可选入口（见 NowPlaying.tsx 的 `NowPlayingData`），
     这里负责：
       · `npLink`（联动，默认开）：开 = 卡片跟随当前壁纸的媒体并可控制它；关 = 卡片只显示最后一次快照、
         所有键不可按（`can* = false`），宿主也**停止推新数据** —— 这是用户能按的"联动开关"。
       · `pumpNp()`：把 `npSnapshotPlan()` 的结果 `update({data})` 推过去（**只 update，不 remount** ⇒
         换壁纸不会重建 React 根、更不会重挂壁纸）。
       · `npTransport(op, value)`：play/pause/restart/prev/next/seek/volume/mute/link 的真实落点
         （复用本段已有的 applyPlayPause / seekStage / nextStage / setVideoVolume / toggleMute）。 */
  let npLink = true
  let npLastSig = ''
  let npLastPump = 0
  let npPumpTimer = null
  let npControlled = false
  let npTitle = '', npKind = ''
  const mediaList = () => {
    const vids = stageVideos()
    const auds = stageAudios()
    return { vids, auds, all: vids.concat(auds) }
  }
  /* ①(2026-09-23 第 8② 条) 媒体选择口径：**维持原样**。
     本轮试过改成"先挑没静音的"，被两条真机断言否掉（`bench-ui-headless` T1 `canSeek` / T4 点轨道定位）：
     web 壁纸的**视频层本来就常常 muted**（它们只是画面层），按静音筛会把卡片指向 `<audio>`，而传输条
     仍按 `activeVideo()` 走 ⇒ **卡片与传输条指向不同元素**（T4 实测点 75% 落到 0.52）。判据是"两处必须
     同一口径"，所以顺序保持：没暂停 → 有时间 → 第一个。 */
  const activeMedia = () => {
    const { vids, auds } = mediaList()
    const pick = (list) => list.find((v) => v && v.paused === false) || list.find((v) => v && Number(v.duration) > 0) || list[0] || null
    return pick(vids) || pick(auds) || null
  }
  /** 当前壁纸的身份（标题/类型）：优先左侧列表里 active 的那一项，否则用 `#current` 的标题。 */
  //  ⚠ 作用域纪律（本文件踩过两次）：`initNavSound` 是**模块级函数**，拿不到 `initSiteShell` 里的
  //  局部量（`listEl`/`curId`/`kindCache`）⇒ 一律现查 DOM（`q()` 是本函数自己的）。
  function currentWallpaperMeta() {
    try {
      const listEl2 = q('#list')
      const li = listEl2 && listEl2.querySelector ? listEl2.querySelector('li[data-id].active') : null
      if (li) {
        const title = (li.querySelector('.title') || {}).textContent || ''
        const sub = (li.querySelector('.sub') || {}).textContent || ''
        return { id: String(li.dataset.id || ''), title: String(title).trim(), kind: kindOfSub(sub) }
      }
    } catch { /* 桩 DOM */ }
    const cur = q('#current')
    return { id: '', title: String((cur && cur.textContent) || '').trim(), kind: npKind || 'unknown' }
  }
  function npSnapshot() {
    const all = mediaList().all
    const a = activeMedia()
    const total = a && Number.isFinite(Number(a.duration)) && Number(a.duration) > 0 ? Number(a.duration) : 0
    const progress = a && Number.isFinite(Number(a.currentTime)) ? Math.max(0, Number(a.currentTime)) : 0
    const meta = currentWallpaperMeta()
    return npSnapshotPlan({
      media: {
        hasVideo: stageVideos().length > 0,
        hasAudio: stageAudios().length > 0,
        count: all.length,
        total, progress,
        hasTimelineElement: !!a,
        audible: a ? a.muted === false : false,
        playing: !!(a && a.paused === false),
        muted: !!muted || !!(a && a.muted),
        volume: vol,
        title: meta.title,
      },
      item: { title: meta.title, kind: meta.kind === 'unknown' ? '' : meta.kind },
      hasPrev: npStepTarget(-1) !== null,
      hasNext: npStepTarget(1) !== null,
      link: npLink,
      source: a ? (stageVideos().indexOf(a) >= 0 ? 'stage-video' : 'stage-audio') : 'none',
    })
  }
  /** 相邻壁纸（"上一首/下一首"= 库列表里前后一项）；返回要点的 `li` 或 null。
   *  当前项定位有**两道**判据：产物打的 `.active`；产物没打（列表被重排/重渲染时可能丢）就按
   *  `#current` 的标题回退匹配 —— 两道都认不出时返回 null（按键置灰，不瞎跳）。 */
  function npStepTarget(dir) {
    try {
      const listEl2 = q('#list')
      const lis = listEl2 && listEl2.querySelectorAll ? [...listEl2.querySelectorAll('li[data-id]')] : []
      if (!lis.length) return null
      let active = lis.findIndex((li) => li.classList.contains('active'))
      if (active < 0) {
        const cur = String((q('#current') || {}).textContent || '').trim()
        if (cur) {
          active = lis.findIndex((li) => {
            const t = String(((li.querySelector('.title') || {}).textContent) || '').trim()
            return t && (t === cur || cur.indexOf(t) >= 0 || t.indexOf(cur) >= 0)
          })
        }
      }
      const from = active >= 0 ? active : (dir > 0 ? -1 : 0)
      if (active >= 0) {
        const i = active + dir
        if (i < 0 || i >= lis.length) return null
        return lis[i]
      }
      return lis[dir > 0 ? 0 : lis.length - 1]
    } catch { return null }
  }
  /** 组件派发的 op 落点（词汇与插件仓控制器一致）。 */
  function npTransport(op, value) {
    const o = String(op || '')
    try {
      if (o === 'play') { applyPlayPause(true); return 'play' }
      if (o === 'pause') { applyPlayPause(false); return 'pause' }
      if (o === 'restart') { seekStage(0); return 'restart' }
      if (o === 'seek') {
        const a = activeMedia()
        const total = a && Number.isFinite(Number(a.duration)) ? Number(a.duration) : 0
        const r = Number(value)
        if (!(total > 0) || !Number.isFinite(r)) return null
        seekStage(Math.max(0, Math.min(1, r)) * total)
        return 'seek'
      }
      if (o === 'volume') { setVideoVolume(clamp01(value)); return 'volume' }
      if (o === 'mute') { setVideoMuted(value === undefined ? !(muted || !(vol > 0)) : !!value); return 'mute' }
      if (o === 'prev') { return stepWallpaper(-1) ? 'prev' : null }
      if (o === 'next') { return stepWallpaper(1) ? 'next' : null }
      if (o === 'link') { npLink = value === undefined ? !npLink : !!value; npLastSig = ''; pumpNp(); return 'link' }
    } catch { /* 单个 op 失败不拖垮卡片 */ }
    return null
  }
  /** 上一首/下一首 = 切到库里相邻的壁纸（走产物自己的 `li.onclick` ⇒ #current/属性面板一起更新）。 */
  function stepWallpaper(dir) {
    const li = npStepTarget(dir)
    if (!li) return false
    try { li.click() } catch { return false }
    return true
  }
  /** 把快照推给组件（**update 而不是重挂**）；签名守卫避免同一份数据反复触发 React 重画。 */
  function pumpNp(force) {
    if (!npApp || typeof npApp.update !== 'function') return null
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()
    if (!force && (now - npLastPump) < 200) {
      //  ≤5Hz 的**尾随**节流：被挡下的那一拍必须补一次，否则"暂停/seek 之后没有后续媒体事件"
      //  就会把卡片永远留在旧状态（实测：暂停后 aria-pressed 一直不翻）。
      if (!npPumpTimer && later) npPumpTimer = later(() => { npPumpTimer = null; try { pumpNp(true) } catch { /* ignore */ } }, 220)
      return null
    }
    const data = npSnapshot()
    const sig = JSON.stringify(data)
    if (!force && sig === npLastSig) return data
    npLastSig = sig
    npLastPump = now
    lastPlaying = data.playing                                   // 受控模式下播放态由**数据**说了算（aria 桥不再二次动作）
    try { npApp.update({ data }); npControlled = true } catch { /* 组件重画失败不影响媒体 */ }
    if (hostEl) {
      try {
        hostEl.setAttribute('data-np-link', npLink ? '1' : '0')
        hostEl.setAttribute('data-np-kind', data.kind || '')
        hostEl.setAttribute('data-np-canplay', data.canPlay ? '1' : '0')
        hostEl.setAttribute('data-np-canseek', data.canSeek ? '1' : '0')
        hostEl.setAttribute('data-np-source', data.source || '')
        hostEl.setAttribute('data-np-title', data.title || '')
      } catch { /* 桩 DOM */ }
    }
    return data
  }
  function seekStage(sec) {
    const a = activeVideo()
    if (!a) return false
    try { a.currentTime = Math.max(0, Number(sec) || 0) } catch { return false }
    paintProgress()
    return true
  }
  /** 「下一个」：多视频（或多个 media 元素）时切到下一个；只有一个时与「重播」同义（= 回到 0）。 */
  function nextStage() {
    const vids = stageVideos()
    if (vids.length < 2) return seekStage(0)
    const a = activeVideo()
    const i = Math.max(0, vids.indexOf(a))
    const nxt = vids[(i + 1) % vids.length]
    for (const v of vids) if (v !== nxt) { try { v.pause() } catch {} }
    try { nxt.currentTime = 0; const r = nxt.play(); if (r && typeof r.catch === 'function') r.catch(() => {}) } catch {}
    paintProgress()
    return true
  }
  const VIDEO_EVENTS = ['timeupdate', 'durationchange', 'loadedmetadata', 'play', 'pause', 'ended', 'seeking', 'seeked', 'volumechange']
  function bindVideoEvents() {
    // ①(P-161) 扫的是 video + audio（web 档常常只有 <audio> 背景乐），两者绑同一套事件
    for (const el of mediaList().all) {
      if (!el || el.__benchNpBound) continue
      el.__benchNpBound = true                       // 幂等：重挂载/重复探测不会叠加监听器
      /* ②(P-228f) 拿到媒体元素时**主动要一次元数据**：渲染器建的 `<audio>` 缺省 preload 可能是 none，
         而自动播放策略下（还没有手势）元素不会自己加载 ⇒ `duration` 一直是 NaN、NP 卡片只能显示
         `--:-- / --:--`。这里只补 preload=metadata + load()（不 play、不破坏"不自动出声"的纪律）。 */
      try {
        if (!(typeof el.duration === 'number' && isFinite(el.duration) && el.duration > 0)) {
          el.preload = 'metadata'
          if (typeof el.load === 'function') el.load()
        }
      } catch (e) { /* 桩/跨源 */ }
      // 需求③：进度与 <video> 的 currentTime/duration 同步（订阅 timeupdate/durationchange…）
      for (const ev of VIDEO_EVENTS) el.addEventListener(ev, () => paintProgress())
    }
  }
  let probeTimer = null, probeTries = 0
  function stopProbe() { if (probeTimer && stopEvery) { stopEvery(probeTimer); probeTimer = null } }
  function probeStage() {
    const n = mediaList().all.length
    if (n) {
      bindVideoEvents()
      applyAudio()
      try { MPW_APPLY_AUDIO = applyAudio } catch (e) { /* 桩环境忽略 */ }   // ①(第 9 条) 引出唯一落点
      paintProgress()
      stopProbe()                                                             // 找到就自停（不留常驻定时器）
    }
    if (stageNote) {
      try {
        stageNote.textContent = n
          ? (n > 1 ? '媒体 ×' + n + ' / media' : '媒体已连接 / media linked')
          : '未发现视频壁纸 / no video'
      } catch {}
    }
    if (hostEl) { try { hostEl.setAttribute('data-stage', String(n)) } catch {} }
    return n
  }
  /** 挂载/重挂载后短时间反复探测（自停：找到 <video> 或试完 40 次）。 */
  function armProbe() {
    if (probeStage()) return null
    if (probeTimer || !every) return probeTimer
    probeTries = 0
    probeTimer = every(() => {
      probeTries++
      if (probeStage() || probeTries >= 40) stopProbe()
    }, 500)
    return probeTimer
  }
  function onFrameLoad() {
    stopProbe(); probeTries = 0; armProbe(); measure()
    //  ①(P-161) 换了壁纸/重挂载之后：重新扫描媒体 + **只 update 卡片数据**（既不 remount 组件、
    //  也不碰壁纸 iframe 的 src）⇒ 与 `#frame` 的挂载/卸载不打架。
    npLastSig = ''
    try { pumpNp(true) } catch { /* 卡片还没挂 */ }
  }
  if (stageEl && !stageEl.__benchNpFrameBound) {
    stageEl.__benchNpFrameBound = true
    stageEl.addEventListener('load', onFrameLoad)
  }

  /* ── ②′ 组件（React）与 video 之间的桥 ───────────────────────────────────────── */
  const readComp = () => {
    const lead = mountEl && mountEl.querySelector ? mountEl.querySelector('.snd-op[data-lead]') : null
    const tap = mountEl && mountEl.querySelector ? mountEl.querySelector('.snd-tap') : null
    return {
      present: !!lead,
      playing: !!lead && lead.getAttribute('aria-pressed') === 'true',
      open: !!tap && tap.getAttribute('aria-expanded') === 'true',
    }
  }
  let lastPlaying = null
  /** 组件状态 → video（只在**变化**时动作 ⇒ 幂等；挂载那一刻不动作，避免一上来就 play/pause 一次）。 */
  function syncFromComponent() {
    const st = readComp()
    if (st.present && lastPlaying !== null && st.playing !== lastPlaying) applyPlayPause(st.playing)
    if (st.present) lastPlaying = st.playing
    if (hostEl) { try { hostEl.setAttribute('data-open', st.open ? '1' : '0') } catch {} }
    return st
  }
  /** 组件里点了哪个键：从 e.target 往上走到 #np-host（不依赖 Element.closest，桩 DOM 也能跑）。 */
  function hitLabel(target) {
    let n = target
    while (n && n !== hostEl) {
      const c = n.classList
      if (c && typeof c.contains === 'function') {
        if (c.contains('snd-op')) return String((n.getAttribute && n.getAttribute('aria-label')) || 'Op')
        if (c.contains('snd-tap')) return 'Tap'
      }
      n = n.parentNode
    }
    return null
  }
  function onHostClick(e) {
    //  ①(P-161) 受控模式下组件自己派发 op（`onTransport`）⇒ 这里那套"读 aria 再猜意图"的兜底必须让位，
    //  否则同一个 Next 会被两条链各做一次（组件切壁纸 + 这里切媒体）。
    if (npControlled) return null
    const label = hitLabel(e && e.target)
    if (!label || label === 'Tap') return null
    // React 的离散事件在它自己的根监听器（挂在 #np-mount）里同步 flush，我们的监听器在它的**父节点**
    // ⇒ 事件冒到这里时 DOM 已是新状态；再等一个微任务只是为了将来 React 改成异步 flush 时也成立。
    const run = () => {
      const st = syncFromComponent()
      if (/Restart|重播|重新播放/i.test(label)) { seekStage(0); return st }
      if (/Next|下一个/i.test(label)) { nextStage(); return st }
      return st
    }
    if (typeof Promise === 'function') { Promise.resolve().then(run); return null }
    return run()
  }
  if (hostEl && !hostEl.__benchNpHostBound) {
    hostEl.__benchNpHostBound = true
    hostEl.addEventListener('click', onHostClick)
  }
  // 兜底通道：万一 React 的 flush 晚于微任务（版本漂移），属性变化也能把状态推过去
  if (mountEl && typeof W.MutationObserver === 'function' && !mountEl.__benchNpObserved) {
    mountEl.__benchNpObserved = true
    try { new W.MutationObserver(() => { syncFromComponent() }).observe(mountEl, { attributes: true, attributeFilter: ['aria-pressed'], subtree: true }) } catch {}
  }
  async function mountSound() {
    if (!mountEl || npApp) return npState
    if (propsEl) { try { propsEl.setAttribute('data-np', 'loading') } catch {} }
    try {
      const mod = await npLoad()
      if (!mod || typeof mod.mountNowPlaying !== 'function') throw new Error('now-playing 产物没有 mountNowPlaying')
      //  ①(P-161) 除了 P-138 的两个旋钮，再把**受控面**交进去：data = 真实媒体快照，onTransport = op 落点
      //  ⇒ 卡片从"装饰"变成"真控件"（标题/进度/时间是真的，键按下去真的作用到当前媒体）。
      npApp = mod.mountNowPlaying(mountEl, { corner: 16, stroke: false, data: npSnapshot(), onTransport: npTransport })
      npState = 'mounted'
      if (propsEl) { try { propsEl.setAttribute('data-np', 'mounted') } catch {} }
      syncFromComponent()
      if (hostEl) { try { hostEl.setAttribute('data-np-ready', '1') } catch {} }
    } catch (e) {
      npState = 'missing'
      if (propsEl) { try { propsEl.setAttribute('data-np', 'missing') } catch {} }   // CSS 去掉底高预留 + 隐藏浮层
      if (stageNote) { try { stageNote.textContent = '声音控件不可用 / sound control unavailable' } catch {} }
    }
    measure()
    return npState
  }

  /* ── 控件事件（音量/静音/进度/跳转） ───────────────────────────────────────────
     ③(用户第 3 条)：音量滑条**不再由本补丁绑事件** —— 它长在组件里，拖动走组件的 `onChange`
     ⇒ `send('volume', v)` ⇒ `npTransport('volume', v)` ⇒ `setVideoVolume()`。这里一条都不重复绑：
     两处绑同一个控件就会变成"一次拖动写两次"，而且组件重挂载后旧节点上的监听会静默失效。 */
  if (muteBtn && !muteBtn.__benchNpMuteBound) {
    muteBtn.__benchNpMuteBound = true
    muteBtn.addEventListener('click', () => { toggleMute() })
  }
  if (seekEl && !seekEl.__benchNpSeekBound) {
    seekEl.__benchNpSeekBound = true
    seekEl.addEventListener('click', (e) => {
      const a = activeVideo()
      const dur = a && isFinite(Number(a.duration)) ? Number(a.duration) : 0
      if (!(dur > 0)) return
      const r = rectOf(seekEl), x = Number(e && e.clientX)
      const ratio = r && r.width > 0 && isFinite(x) ? Math.max(0, Math.min(1, (x - r.left) / r.width)) : 0
      seekStage(ratio * dur)
    })
  }
  // 工具条那支音量：挂载时是壁纸的挂载参数，之后用户改它 ⇒ 同步到控件与 <video>（只写值、不派发事件 ⇒ 不成环）
  if (toolbarVol && !toolbarVol.__benchNpMirrorBound) {
    toolbarVol.__benchNpMirrorBound = true
    toolbarVol.addEventListener('change', () => { setVideoVolume(toolbarVol.value) })
  }
  paintMute()
  paintProgress()

  const api = {
    /* ① 收纳 */
    navCollapsed: navNow,
    navPlan: () => sidebarCollapsePlan(navNow()),
    setNavCollapsed,
    navButton: () => navBtn,
    sidebarEl: () => sidebar,
    /* ② 声音控件 */
    mountSound,
    npState: () => npState,
    npApp: () => npApp,
    measure,
    npOcclusion: measure,
    npGeometry: () => {
      /* ②A2(用户「调节音量的那个条超出了壁纸配置的宽度」) 读数契约：
         `overflow` = 传输条里**任何**可见子元素的右缘是否越过传输条右缘（或左缘越左缘）。
         改前：窄视口（≤420px）下 `#np-volume`/`#np-seek` 是固定宽 ⇒ `overflow:true`；
         改后：恒 `false`（门禁 `bench-shell-fixes` 与 `bench-dsh-libroot` B 段都断言这一条）。 */
      const strip = rectOf(stripEl)
      const parts = {}
      let overflow = false
      const worst = []
      try {
        const D0 = (typeof document !== 'undefined') ? document : null
        const host = (stripEl && stripEl.children) ? [...stripEl.children] : []
        for (const el of host) {
          const r = rectOf(el)
          if (!r || r.width === 0) continue
          const key = (el.id || el.className || 'node').toString().split(/\s+/)[0]
          parts[key] = r
          if (strip && (r.right > strip.right + 0.5 || r.left < strip.left - 0.5)) { overflow = true; worst.push(key) }
        }
        void D0
      } catch { /* 桩 DOM */ }
      /*  ③(2026-09-25 issue0924a2 用户第 3 条) 音量控件的**落点**读数（新契约）：
          · `volumeInCard`：滑条（`#np-volume`）的矩形**完全落在卡片（`.snd-box`）内部**（±0.5px）——
            这是用户那句"集成到 NP 的卡片里面"的可机读判据（改前：卡片下面那条独立条 ⇒ false）；
          · `volumeInCardX`：只判水平方向（卡片横向不越界），窄容器下也有分辨力；
          · `volumeOverflow`：滑条越出卡片任一边（有范围的显示不许溢出，见第 4 条自检）；
          · `volumeInStrip` / `stripHasVolume`：`#np-audio`（配置栏最下面那条）里**没有**音量控件
            —— 用户第 2 条与第 3 条都要它不在那儿（两个布尔量一正一反互为佐证）；
          · `volumeInNpBar`：**已撤**（`#np-volbar` 那条独立行整块删除）。老门禁若还引用它会读到
            `undefined` ⇒ 必须按新契约更新（见 tests/bench-issue0924a-line-A-test.mjs A2*）。
          · `volumeVisible`：滑条当前是否真的可见（`late === 0` 时组件不渲染它 ⇒ 收起态量不到，属预期）。 */
      const card = rectOf(q('#np-mount .snd-box'))
      const vol = rectOf(q('#np-volume'))
      const volR = vol || null
      const inside = (a, b) => !!(a && b && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5 && a.left >= b.left - 0.5 && a.right <= b.right + 0.5)
      const insideX = (a, b) => !!(a && b && a.left >= b.left - 0.5 && a.right <= b.right + 0.5)
      let volumeOverflow = false
      try { if (volR && card && !inside(volR, card)) volumeOverflow = true } catch { /* 桩 DOM */ }
      return {
        body: rectOf(propsBody), card, strip, parts, overflow, overflowParts: worst,
        slider: volR,
        /* 兼容读数：老门禁的 `slider` 语义不变（就是 `#np-volume` 的盒）；`volbar` 恒 null（那条行没了）。 */
        volbar: null,
        volumeVisible: !!volR,
        volumeInCard: inside(volR, card),
        volumeInCardX: insideX(volR, card),
        volumeOverflow,
        volumeInStrip: !!(volR && strip && volR.top >= strip.top - 0.5 && volR.bottom <= strip.bottom + 0.5),
        stripHasVolume: (() => { try { return !!(stripEl && stripEl.querySelector && stripEl.querySelector('#np-volume')) } catch { return false } })(),
        /*  第四键（音量/静音）也必须在卡片里 —— 它和滑条一起构成"音量的按钮在卡片内部"。
            选它用 `[data-mpw-np-mute]`（组件受控面的既有词汇），不用新类名：组件那边有一条
            "CSS 类名与 DOM 一一对应"的判据，而音量行只在卡片展开时存在（见 NowPlaying.tsx 的注释）。 */
        muteInCard: inside(rectOf(q('#np-mount [data-mpw-np-mute]')), card),
        volKeyPresent: !!q('#np-mount [data-mpw-np-mute]'),
        cardOpen: (() => { try { const b = q('#np-mount .snd-box'); return !!(b && b.getAttribute && b.getAttribute('data-open')) } catch { return false } })(),
      }
    },
    propsGroups: () => ((typeof W !== 'undefined' && W && W.__benchShell && W.__benchShell.propsGroups) ? W.__benchShell.propsGroups() : null),
    propsItems,
    /* ③ video 声音 */
    stageVideos,
    stageApi,
    activeVideo,
    probeStage,
    armProbe,
    onFrameLoad,
    component: readComp,
    syncFromComponent,
    handleHostClick: onHostClick,
    hitLabel,
    applyPlayPause,
    npSnapshot,
    npTransport,
    pumpNp,
    npLinkState: () => npLink,
    npControlled: () => npControlled,
    mediaList,
    activeMedia,
    stepWallpaper,
    npStepTarget,
    seekStage,
    nextStage,
    paintProgress,
    setVideoVolume,
    setVideoMuted,
    toggleMute,
    audio: () => ({ vol, muted, effective: (muted || !(vol > 0)) ? 0 : vol }),
    applyAudio,
    /*  ③(用户第 3 条) 读数：组件滑条的当前值 / 在不在卡片里 / 第四键的静音态（门禁同一入口）。 */
    volumeSlider: () => {
      const el = volRangeEl()
      if (!el) return { present: false }
      const card = q('#np-mount .snd-box')
      return { present: true, id: String(el.id || ''), value: String(el.value), disabled: !!el.disabled, inCard: !!(card && el.closest && el.closest('#np-mount .snd-box') === card), pct: String((q('#np-mount [data-mpw-np-volnum]') || {}).textContent || '') }
    },
    muteKey: () => {
      const b = q('#np-mount [data-mpw-np-mute]')
      if (!b) return { present: false }
      return { present: true, pressed: String(b.getAttribute('aria-pressed') || ''), muted: String(b.getAttribute('data-mpw-np-mute') || ''), disabled: !!b.disabled }
    },
  }
  return api
}

/* ============================ 浏览器初始化 ============================ */
// 对外钩子：源码侧 bench/bench.ts 在语言切换 / 分辨率变更 / 指针注入开关变化时调用
// （window.__benchPatch?.xxx）。三个钩子都是幂等的，重复调用无害。
/* ═══════════════════ ⑩ 站点外壳（site header tab / 设置弹层 / 壁纸切换栏 / 控制台拖动） ═══════════════════
   用户 2026-09-17 新样式（docs/newstyle.md 的 ASCII 稿）：
     顶部 tab：控制台 / 说明 / 壁纸设置                       设置 ▾   ☀/🌙
     左：选择壁纸 │ 壁纸参数      右：切换栏+设置1（上） / 壁纸（中） / 控制台（下）
   原则：外壳只碰 DOM 与 class —— 壁纸切换走 bundle 自己的 `li.onclick`，语言走 `#lang`，
   主题走 `#theme-toggle`，属性面板走 bundle 的 `#props` 链路；本层不重实现任何渲染逻辑。
   切页只平移整条 track（不动宽度 ⇒ iframe 不重排、WebGL 不重挂）。 */

/** 纯函数：页面索引 ↔ 平移百分比（越界钳位；count 缺省 3）。 */
export function sitePagePlan(active, count = 3) {
  const c = Math.max(1, Number(count) || 3)
  let i = Number(active)
  if (!Number.isFinite(i)) i = 0
  i = Math.max(0, Math.min(c - 1, Math.round(i)))
  // ①(修正 2026-09-17) 轨道宽度 = count × 视口（CSS `width:300%`），每页 = 100/count %
  //   ⇒ 每页平移 = -(100/count)% 的**轨道宽** = 正好一个视口。
  //   早先写成 -100*i（把一页宽当成整个轨道宽）：轨道只有一页宽 ⇒ overflow/contain 的**裁剪窗口**
  //   跟着轨道一起被移出屏幕 ⇒ 第 2/3 页整页被裁掉（真机：切到「说明/壁纸设置」只看到空白）。
  return { index: i, offsetPercent: -(100 / c) * i, pagePercent: 100 / c }
}

/** 纯函数：从当前列表项算出切换栏计划（当前项置前、其余按库序、上限 limit、过滤掉重复 id）。 */
export function switcherPlan(items, currentId, limit = 12) {
  const list = Array.isArray(items) ? items : []
  const seen = new Set()
  const out = []
  const push = (it) => {
    if (!it || !it.id || seen.has(it.id)) return
    seen.add(it.id); out.push({ ...it, active: it.id === currentId })
  }
  for (const it of list) if (it && it.id === currentId) push(it)
  for (const it of list) push(it)
  return { tabs: out.slice(0, Math.max(1, Number(limit) || 12)), total: out.length, currentId: currentId || null }
}

/** 纯函数：控制台高度钳位（px；<24 视为收起 ⇒ 0）。 */
export function clampLogsHeight(px, viewportH, min = 80, maxFrac = 0.72) {
  const vh = Number(viewportH) > 0 ? Number(viewportH) : 800
  const hi = Math.max(min, Math.round(vh * maxFrac))
  let v = Math.round(Number(px))
  if (!Number.isFinite(v)) v = 220
  if (v < 24) return 0
  return Math.max(min, Math.min(hi, v))
}

/* ══════════════════ 属性面板：纯函数层（#18 #23 #25 #26 #27 #28 #30 #34）════════════════════════════
   为什么先做成纯函数：属性文案（`project.json → general.properties[].text`）**全部来自壁纸作者**，
   属于不可信输入；而面板 DOM 由 minified 产物渲染（本仓许可口径：产物一个字节都不改）。于是把
   "作者的标签文本 → 安全节点"、"哪些项不该给用户看"、"数字怎么解析"、"外链能不能点"做成**无 DOM
   依赖**的纯函数：Node 里可逐值对账（tests/bench-shell-fixes-test.mjs），浏览器层只负责用
   `createElement` / `textContent` 把结果建成节点 —— **永远不 innerHTML**，结构上不可能 XSS。
   ⚠ `?rawprops=1` 只改"显示哪些项"（排障），**不绕过**转义与外链确认：原始项走同一套渲染。 */

/** 内置隐藏名单 = `ui_` 前缀 + 明确集合。这些是 **Wallpaper Engine 编辑器内部属性**：属性名/文案里
 *  直接写 `ui_browse_properties_*`，壁纸作者在编辑器里看不到、用户改它也没有意义 —— 让它出现在
 *  "壁纸配置"就是"未选择壁纸时一直占着面板的那个 scheme color"。
 *  真实数据里产物的描述子把内部键放在 `text` 上（例：`{name:"schemecolor", text:"ui_browse_properties_scheme_color"}`），
 *  所以判据**同时看 name 与显示文案**；只看 name 会在换成别的壁纸时漏出来（用户第 18/25 条实测）。 */
export const PROPS_HIDDEN_PREFIXES = ['ui_']
export const PROPS_HIDDEN_NAMES = ['schemecolor', 'ui_browse_properties_scheme_color', 'ui_browse_properties_show_color_options']

/** `?rawprops=1` = 排障档：显示全部原始项（隐藏名单与占位控件抑制一并停用）。`0/false/off/no` 关。 */
export function propsRawMode(search) {
  const p = new URLSearchParams(String(search == null ? '' : search))
  const v = String(p.get('rawprops') == null ? '' : p.get('rawprops')).trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'on' || v === 'yes'
}

/** 属性是否属于"内置/编辑器内部"⇒ 面板不显示。返回原因串（空串 = 显示）。 */
export function propsHiddenReason(spec) {
  const s = spec || {}
  const name = String(s.name == null ? '' : s.name).trim().toLowerCase()
  if (name) {
    for (const p of PROPS_HIDDEN_PREFIXES) if (name.indexOf(p) === 0) return 'internal-prefix'
    if (PROPS_HIDDEN_NAMES.indexOf(name) >= 0) return 'internal-name'
  }
  //  文案那一半只认"整段就是那个内部键"的形态（短、且以 `ui_` 开头 / 等于名单）——
  //  正常文案里出现 `ui_`（比如一句说明）不该被误伤。
  const plain = propPlainText(s.text).trim().toLowerCase()
  if (plain && plain.length <= 64) {
    for (const p of PROPS_HIDDEN_PREFIXES) if (plain.indexOf(p) === 0) return 'internal-text'
    if (PROPS_HIDDEN_NAMES.indexOf(plain) >= 0) return 'internal-text'
  }
  return ''
}

/* ══════════ 「渲染器设置（WE 自带）」的**固定清单**（P-201；纯数据 + 纯函数，Node 侧可逐项对账）══════════
   用户口径（2026-09-25 复述）：「WE 自带选项 = 我提的那几个（Flip / Show color options / 亮度对比度饱和度
   色调偏移 / 播放速度……），**针对每一张壁纸都有**；壁纸自己的项在 `project.json` 里」。

   为什么是**固定清单**而不是从属性行里"分类"（P-201 修的就是这条）：
   WE 自带项**根本不在** `project.json → general.properties` 里（真语料 22/22 包实测只有 `schemecolor`
   一条会被旧谓词命中），而它们在渲染器侧的落点是 `demo.html` 的 MPW-DISPLAY 段（`__wp.setDisplay` /
   `__wp.setPlaybackRate`）。从属性行"猜"WE 自带项这条路**结构上列不出**用户说的那几项
   （改前真机读数 `{"weCount":1,"weNames":["schemecolor"],"collapsed":false}` —— 表头报 1 项、
   点开是空的：唯一被收进来的那行同时在 `PROPS_HIDDEN_NAMES` 里）。
   ⇒ 这一组由补丁**自己画**：`kind` 决定控件、`api` 决定驱动哪个渲染器 API，与壁纸无关。

   映射表权威出处：`demo/index.html` 的 `#page-wpset` §1「WE 自带选项 ↔ 本页 API」
   + `docs/DISPLAY-OPTIONS.md` + `docs/README-DIAGNOSTICS.md` ⑦。
   `status`：
     · `impl`  = 本页已实现，这一组**直接驱动**渲染器 API（`api` 字段给出落点）；
     · `other` = 本页已实现，但落点不在渲染器（工具条/URL）—— **照实写一行**，不静默少项；
     · `no`    = 本仓不做/未实现（给出原因）；
     · `we`    = Wallpaper Engine **客户端自带**（页面内没有实现面）。
   ⚠ 清单里的 `id` 是判据面（门禁逐项对账）：**不许**为了少画一行而删项 —— 删了就是"静默少项"。 */
export const WE_RENDERER_ITEMS = [
  { id: 'flipH', kind: 'bool', status: 'impl', api: 'setDisplay', arg: 'flipH' },
  { id: 'colorOptions', kind: 'bool', status: 'impl', api: 'setDisplay', arg: 'colorOptions' },
  { id: 'brightness', kind: 'range', status: 'impl', api: 'setDisplay', arg: 'brightness', min: 0, max: 2, step: 0.05, neutral: 1 },
  { id: 'contrast', kind: 'range', status: 'impl', api: 'setDisplay', arg: 'contrast', min: 0, max: 2, step: 0.05, neutral: 1 },
  { id: 'saturation', kind: 'range', status: 'impl', api: 'setDisplay', arg: 'saturation', min: 0, max: 2, step: 0.05, neutral: 1 },
  { id: 'hue', kind: 'range', status: 'impl', api: 'setDisplay', arg: 'hue', min: -180, max: 180, step: 1, neutral: 0, suffix: '°' },
  { id: 'playbackRate', kind: 'range', status: 'impl', api: 'setPlaybackRate', min: 0.5, max: 2, step: 0.05, neutral: 1, suffix: '×' },
  { id: 'volume', kind: 'range', status: 'impl', api: 'setVolume', min: 0, max: 1, step: 0.01, neutral: 0 },
  { id: 'flipV', kind: 'note', status: 'no' },
  { id: 'alignment', kind: 'note', status: 'other' },
  { id: 'parallaxReaction', kind: 'note', status: 'no' },
  { id: 'recording', kind: 'note', status: 'we' },
  { id: 'perMonitor', kind: 'note', status: 'we' },
]

/** 纯函数：清单里**本组直接驱动渲染器 API** 的那几项（`status:'impl'`）。判据：项数/顺序/落点逐项相等。 */
export function weRendererImplItems(list) {
  return (Array.isArray(list) ? list : WE_RENDERER_ITEMS).filter((it) => it && it.status === 'impl')
}

/** 纯函数：把清单折成"项 id → 该项要调的渲染器 API 名"（`setDisplay` 项带 `arg`）。 */
export function weRendererApiRoute(item) {
  const it = item || {}
  if (it.status !== 'impl') return ''
  if (it.api === 'setDisplay') return '__wp.setDisplay({' + String(it.arg || '') + '})'
  if (it.api === 'setPlaybackRate') return '__wp.setPlaybackRate(r)'
  if (it.api === 'setVolume') return '__wp.setVolume(v)'
  return ''
}

/** 命名实体表（只收常见的一小撮；其余保持原样，宁可显示 `&foo;` 也不猜）。 */
const PROP_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', ensp: '\u2002', emsp: '\u2003',
  thinsp: '\u2009', middot: '\u00b7', hellip: '\u2026', mdash: '\u2014', ndash: '\u2013', copy: '\u00a9',
  reg: '\u00ae', trade: '\u2122', laquo: '\u00ab', raquo: '\u00bb', times: '\u00d7', deg: '\u00b0',
  bull: '\u2022', rarr: '\u2192', larr: '\u2190', harr: '\u2194',
}

/** 解 HTML 实体（数字实体取 `&#NN;` / `&#xNN;`，越界一律原样保留）。 */
export function decodePropEntities(s) {
  const one = (t) => String(t == null ? '' : t).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, body) => {
    if (body.charAt(0) === '#') {
      const hex = body.charAt(1) === 'x' || body.charAt(1) === 'X'
      const n = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10)
      if (!Number.isFinite(n) || n <= 0 || n > 0x10ffff) return m
      try { return String.fromCodePoint(n) } catch { return m }
    }
    const k = body.toLowerCase()
    return Object.prototype.hasOwnProperty.call(PROP_ENTITIES, k) ? PROP_ENTITIES[k] : m
  })
  /* ①(2026-09-22 用户第 6 条) 面板文案里残留字面量 `&nbsp;` 的两种来源，都在这条收口：
     ① **双重编码**（`&amp;nbsp;` 先解成 `&nbsp;` 就停了）；② **无分号形态**（`&nbsp`）。
     只对**空白类**实体多解一轮/收无分号 —— 其它实体保持"只解一遍"的标准语义（`&amp;lt;` 这类
     作者本意是显示字面量，过度解码会把它改掉）。 */
  const WS_ENT = { nbsp: '\u00a0', ensp: '\u2002', emsp: '\u2003', thinsp: '\u2009' }
  return one(s).replace(/&(nbsp|ensp|emsp|thinsp)\b;?/gi, (m, name) => WS_ENT[String(name).toLowerCase()])
}

/** 颜色白名单（只有这些形态会被写进 `style.color`；其余一律当作"没写颜色"：
 *  `expression(...)` / `url(...)` / `var(...)` 这类东西进不了样式表）。 */
const PROP_CSS_COLOR_NAMES = ['black', 'silver', 'gray', 'grey', 'white', 'maroon', 'red', 'purple', 'fuchsia',
  'magenta', 'green', 'lime', 'olive', 'yellow', 'navy', 'blue', 'teal', 'aqua', 'cyan', 'orange', 'pink',
  'gold', 'brown', 'violet', 'indigo', 'darkgray', 'darkgrey', 'lightgray', 'lightgrey', 'transparent']
export function safeCssColor(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase()
  if (!s) return ''
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(s)) return s
  if (/^rgba?\(\s*[0-9.]+%?\s*(?:,\s*[0-9.]+%?\s*){2}(?:,\s*[0-9.]+%?\s*)?\)$/.test(s)) return s
  if (PROP_CSS_COLOR_NAMES.indexOf(s) >= 0) return s
  return ''
}

/** 外链白名单（用户第 30 条）：**只**放行 http(s) 绝对地址 —— `javascript:` / `data:` / 相对路径
 *  （会解析成"本页所在源"）一律拒绝。返回 `{ok:true, href, host}` 或 `{ok:false, reason}`。 */
export function externalLinkInfo(href) {
  const s = String(href == null ? '' : href).trim()
  if (!s) return { ok: false, reason: 'empty' }
  if (!/^https?:\/\//i.test(s)) return { ok: false, reason: 'scheme' }
  let u = null
  try { u = new URL(s) } catch { return { ok: false, reason: 'unparsable' } }
  const proto = String(u.protocol || '').toLowerCase()
  if (proto !== 'http:' && proto !== 'https:') return { ok: false, reason: 'scheme' }
  if (!u.hostname) return { ok: false, reason: 'no-host' }
  return { ok: true, href: u.href, host: u.hostname }
}

const PROP_VOID_TAGS = ['img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'area', 'base', 'col', 'embed', 'param', 'track', 'wbr']
/* `<!--` / `-->` 两个字面量**故意拆开拼**（下面两行）：门禁 `tests/bench-shell-fixes-test.mjs` 的
   注释剥除器用的是**跨全文**配对的正则 `/<!--[\s\S]*?-->/g` —— 源码里只要同时出现这两个字面量，
   它就会把中间几万字节代码整段当 HTML 注释吃掉。本轮实测：`-->` 出现在这里、`<!--` 出现在
   1083 行的 `startsWith('<!--')`，于是 60 587 字节被吞（I20–I25 / G8–G13 集体变红，真代码一行没坏）。 */
const PROP_HTML_COMMENT_OPEN = '<' + '!--'
const PROP_HTML_COMMENT_CLOSE = '--' + '>'
function propAttrOf(attrs, name) {
  const m = new RegExp('(?:^|[\\s/])' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s"\'>]+))', 'i')
    .exec(String(attrs == null ? '' : attrs))
  if (!m) return ''
  const raw = m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : (m[3] || ''))
  return decodePropEntities(raw).trim()
}

/** 属性文案 → 安全 token 数组（**纯函数、无 DOM**）。只保留三样语义（用户第 26/28 条口径）：
 *    · `<br>`（含 `<br/>`）      → `{k:'br'}` 换行
 *    · `<font color=…>`          → `{k:'font',color}` 文本色（**不改字号/粗细**：`<big>`/`<b>` 一律不建节点）
 *    · `<img src=…>`             → `{k:'img',src}` **只渲染图**，不把标签当文字显示
 *    · `<a href=http(s)://…>`    → `{k:'link',href,host}` 可点（点击走第 30 条的二次确认）；
 *                                  非 http(s) 的 `<a>`（`javascript:`、垃圾串）→ 剥标签留文字
 *  其余标签（`<big>`/`<b>`/`<center>`/`<hr>`/`<p>`/未知）**剥掉标签只留内部文字**；
 *  `<!-- -->` 注释整段丢弃；未闭合的 `<` 当普通文字（不吞后面的内容）。 */
export function parsePropRichText(text) {
  const src = String(text == null ? '' : text)
  const root = []
  const stack = [{ name: '', kids: root }]
  const top = () => stack[stack.length - 1]
  /* ①(2026-09-22 用户第 7 条) 文案里的 `BVxxxxxxxxxx`（B 站视频号，常见写法 `BV…(点击跳转)`）转成**可点链接**
     `https://b23.tv/<BV>`。刻意走既有的 `link` token 渲染路径 ⇒ 自动继承"只放行 http(s) + 目标域名确认弹层 +
     noopener/noreferrer"，**不新开第二条外链通道**（新通道就等于新的绕过点）。BV 号按 B 站现行格式 10 位
     `[0-9A-Za-z]` 严格匹配，不做模糊猜测。 */
  const BV_RE = /(BV[0-9A-Za-z]{10})/g
  const addText = (raw) => {
    const v = decodePropEntities(raw)
    if (!v) return
    let last = 0
    for (const m of v.matchAll(BV_RE)) {
      if (m.index > last) top().kids.push({ k: 'text', v: v.slice(last, m.index) })
      const bv = m[1]
      top().kids.push({ k: 'link', href: 'https://b23.tv/' + bv, host: 'b23.tv', kids: [{ k: 'text', v: bv }] })
      last = m.index + bv.length
    }
    if (last < v.length) top().kids.push({ k: 'text', v: v.slice(last) })
  }
  let i = 0
  while (i < src.length) {
    const lt = src.indexOf('<', i)
    if (lt < 0) { addText(src.slice(i)); break }
    if (lt > i) addText(src.slice(i, lt))
    if (src.slice(lt, lt + 4) === PROP_HTML_COMMENT_OPEN) {
      const end = src.indexOf(PROP_HTML_COMMENT_CLOSE, lt + 4)
      i = end < 0 ? src.length : end + 3
      continue
    }
    const gt = src.indexOf('>', lt + 1)
    if (gt < 0) { addText(src.slice(lt)); break }
    const inner = src.slice(lt + 1, gt)
    i = gt + 1
    const m = /^\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9:_-]*)([\s\S]*)$/.exec(inner)
    if (!m) { addText(src.slice(lt, gt + 1)); continue }
    const closing = m[1] === '/'
    const tag = m[2].toLowerCase()
    const attrs = m[3] || ''
    if (closing) {
      for (let d = stack.length - 1; d >= 1; d--) if (stack[d].name === tag) { stack.length = d; break }
      continue
    }
    if (tag === 'br') { top().kids.push({ k: 'br' }); continue }
    if (tag === 'img') { const s = propAttrOf(attrs, 'src'); if (s) top().kids.push({ k: 'img', src: s }); continue }
    if (PROP_VOID_TAGS.indexOf(tag) >= 0) continue                  // hr/input/meta… 剥掉（它们没有内部文字）
    if (/\/\s*$/.test(attrs)) continue                              // 自闭合的非空元素：没有内容
    if (tag === 'font') {
      const c = safeCssColor(propAttrOf(attrs, 'color'))
      const kids = []
      if (c) top().kids.push({ k: 'font', color: c, kids: kids })
      stack.push({ name: 'font', kids: c ? kids : top().kids })
      continue
    }
    if (tag === 'a') {
      const info = externalLinkInfo(propAttrOf(attrs, 'href'))
      if (info.ok) {
        const kids = []
        top().kids.push({ k: 'link', href: info.href, host: info.host, kids: kids })
        stack.push({ name: 'a', kids: kids })
      } else stack.push({ name: 'a', kids: top().kids })             // 非 http(s)：剥标签留文字
      continue
    }
    stack.push({ name: tag, kids: top().kids })                      // 未知标签：剥标签留文字（不建节点、不改样式）
  }
  return root
}

/** token → 纯文本（`<br>` 变成 `\n`）。 */
export function propRichTextPlain(tokens) {
  const out = []
  const walk = (list) => {
    for (const t of list || []) {
      if (!t) continue
      if (t.k === 'text') out.push(t.v)
      else if (t.k === 'br') out.push('\n')
      else if (t.kids) walk(t.kids)
    }
  }
  walk(tokens)
  return out.join('')
}
/** 属性文案 → 纯文本（剥标签 + 解实体）。 */
export function propPlainText(text) { return propRichTextPlain(parsePropRichText(text)) }

/** "有没有实义文字"：剥掉标签/实体/空白后还剩字母或数字才算有（`<img>`/`<big>`/`&nbsp;` 不算）。 */
export function propsHasRealText(plain) {
  const s = String(plain == null ? '' : plain)
  try { return /[\p{L}\p{N}]/u.test(s) } catch { return /[0-9A-Za-z\u00c0-\uffff]/.test(s) }
}

/** 占位颜色属性（用户第 27 条）：值类型是 color，但文案里**没有可读内容**（只有 `<img>`/`<big>`/空白）
 *  ⇒ 那个取色框只是占位/给图片让位，对用户没有意义 ⇒ 不渲染控件（`?rawprops=1` 回退显示）。 */
export function propsPlaceholderColor(spec) {
  const s = spec || {}
  if (String(s.ptype || '') !== 'color') return false
  return !propsHasRealText(propPlainText(s.text))
}

/** 数字输入的**唯一**解析入口（用户第 34 条"数字输入"半条）：拒科学计数法（`1e9`）/十六·八·二进制
 *  前缀/`Infinity`/`NaN`/非数字/超长（>24 字符）/小数位过多（>12），再按属性的 min/max/step/precision 钳制。
 *  非法 ⇒ `{ok:false, reason}`，调用方**必须不写回**并报错；合法但被调整 ⇒ `notes` 说明动了哪一项。 */
export const NUM_MAX_LEN = 24
export const NUM_MAX_DECIMALS = 12
function numDecimalsOf(x) {
  const m = /\.(\d+)$/.exec(String(x))
  return m ? m[1].length : 0
}
function numSnapToStep(v, base, step) {
  const d = Math.min(NUM_MAX_DECIMALS, numDecimalsOf(step) + 2)
  return Number((base + Math.round((v - base) / step) * step).toFixed(d))
}
export function parseNumberSafe(raw, spec) {
  const s = String(raw == null ? '' : raw).trim()
  const bad = (reason) => ({ ok: false, value: null, clamped: false, notes: [], reason: reason })
  if (!s) return bad('empty')
  if (s.length > NUM_MAX_LEN) return bad('too-long')
  if (/^[+-]?(infinity|nan)$/i.test(s)) return bad('not-finite')
  if (/^[+-]?0[xbo]/i.test(s)) return bad('radix-prefix')
  if (/[eE]/.test(s)) return bad('exponent')
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(s)) return bad('not-a-number')
  if (numDecimalsOf(s) > NUM_MAX_DECIMALS) return bad('too-many-decimals')
  let v = Number(s)
  if (!Number.isFinite(v)) return bad('not-finite')
  const o = spec || {}
  const min = Number(o.min)
  const max = Number(o.max)
  const step = Number(o.step)
  const prec = Number(o.precision)
  const hasMin = Number.isFinite(min)
  const hasMax = Number.isFinite(max)
  const notes = []
  if (hasMin && v < min) { v = min; notes.push('min') }
  if (hasMax && v > max) { v = max; notes.push('max') }
  if (Number.isFinite(step) && step > 0 && notes.length === 0) {
    const snapped = numSnapToStep(v, hasMin ? min : 0, step)
    if (snapped !== v) { v = snapped; notes.push('step') }
    if (hasMin && v < min) { v = min; notes.push('min') }
    if (hasMax && v > max) { v = max; notes.push('max') }
  }
  if (Number.isInteger(prec) && prec >= 0 && prec <= NUM_MAX_DECIMALS) {
    const r = Number(v.toFixed(prec))
    if (r !== v) { v = r; notes.push('precision') }
  }
  return { ok: true, value: v, clamped: notes.length > 0, notes: notes, reason: '' }
}

/** 站点外壳初始化。ctx = { t, lang, log }（都是可选；缺省安全降级）。 */
export function initSiteShell(ctx = {}) {
  // ①(修正 2026-09-18 门禁抓到) 版本/新 DOM 两个值由**调用方注入**（ctx），不要直接引用模块作用域常量：
  //   它们在浏览器初始化区里声明，而本函数定义在更前面 ⇒ 直接引用会 ReferenceError，被外层 catch 吞掉后
  //   表现为"外壳初始化失败"（静态 CSS 仍在 ⇒ 页面看着还行，但切页/切换栏/拖动全部失效 —— 典型的假绿）。
  const VER = ctx.shellVersion || (typeof window !== 'undefined' && window.__benchShellVersion) || 'bench-shell (unknown)'
  const DOM_NEW = ctx.domIsNew !== undefined ? !!ctx.domIsNew : !!(typeof document !== 'undefined' && document.querySelector && document.querySelector('#pages-track'))
  const tr = typeof ctx.t === 'function' ? ctx.t : ((l, k) => k)
  const curLang = typeof ctx.lang === 'function' ? ctx.lang : (() => 'zh')
  const D = typeof document !== 'undefined' ? document : null
  if (!D) return null
  const q = (sel) => D.querySelector(sel)
  //  ①(scope 纪律，本文件踩过三次)：`initNavSound` 的局部量（hostEl/logLine/curId…）在这里**不存在**。
  //  这里现查 DOM、日志走注入进来的 `ctx.log`（`log` 由 init() 传进来，缺省空实现 ⇒ 桩 DOM 安全）。
  const npHostEl = () => q('#np-host')
  const log = typeof ctx.log === 'function' ? ctx.log : (() => {})
  const PAGE_KEY = 'bench-site-page'
  const LOGS_KEY = 'bench-logs-h'
  const PAGES = ['console', 'docs', 'wpset']
  const track = q('#pages-track')
  const tabs = PAGES.map((n) => q('#tab-' + n))
  const ink = q('#site-tab-ink')

  function pageFromName(name) {
    const i = PAGES.indexOf(String(name))
    return sitePagePlan(i < 0 ? 0 : i, PAGES.length)
  }
  function getPage() { return PAGES[pageFromName(readKey(PAGE_KEY) || 'console').index] }
  function readKey(k) { try { return localStorage.getItem(k) } catch { return null } }
  function writeKey(k, v) { try { localStorage.setItem(k, v) } catch { /* 沙箱/隐私模式：忽略 */ } }

  function paintInk(index) {
    if (!ink || !tabs[index]) return
    const el = tabs[index]
    try {
      ink.style.width = el.offsetWidth + 'px'
      ink.style.transform = 'translateX(' + el.offsetLeft + 'px)'
    } catch { /* 桩 DOM 无布局：忽略 */ }
  }
  function pagesEls() { return PAGES.map((n) => q('#page-' + n)) }
  function hideInactive(activeIdx) {
    pagesEls().forEach((el, i) => { if (el) { try { el.style.display = i === activeIdx ? '' : 'none' } catch {} } })
  }
  function setPage(name, persist = true) {
    const plan = pageFromName(name)
    const active = PAGES[plan.index]
    // ①(2026-09-18 用户要求：「左右切换的效果去掉 变成一个个页面(不要加载过程)」)
    //   页签改成**互斥的独立页面**：不再有 300% 宽的轨道、不再有 translateX 动画、也**不再有 340ms 的
    //   "先全部可见、动画结束再隐藏"的定时器**（那 340ms 就是用户说的"加载过程"：切页时另外两页会短暂
    //   跟着动、iframe 还可能盖在上面）。现在切页 = 立刻只显示目标页、其余页 display:none。
    //   为什么用 display 而不是 visibility：用户要的就是"一个个页面"（不在布局里占位）；
    //   画布/iframe 不重建 ⇒ 没有加载过程，切回来时浏览器会给 iframe 发 resize，渲染器自行按新尺寸重算。
    hideInactive(plan.index)
    pagesEls().forEach((el, i) => { if (el) { try { el.setAttribute('aria-hidden', i === plan.index ? 'false' : 'true') } catch {} } })
    if (track) {
      try {
        track.style.transform = ''                    // 清掉历史内联量（旧版补丁可能写过）
        track.setAttribute('data-active', active)
      } catch {}
    }
    tabs.forEach((el, i) => {
      if (!el) return
      const on = i === plan.index
      el.classList.toggle('active', on)
      try { el.setAttribute('aria-selected', on ? 'true' : 'false') } catch {}
    })
    paintInk(plan.index)
    // 切页后给一次布局"唤醒"：目标页里若含 iframe/画布，其视口尺寸从 0 变回真实值，
    // 主动 dispatch 一次 resize 让宿主侧监听器（舞台自适应等）立刻重算，而不是等下一次用户操作。
    try { if (typeof window !== 'undefined' && window.dispatchEvent) window.dispatchEvent(new Event('resize')) } catch {}
    if (persist) writeKey(PAGE_KEY, active)
    return active
  }

  /* ── 顶部 tab：点击 / 左右方向键（ARIA tablist 惯例） ── */
  tabs.forEach((el, i) => {
    if (!el) return
    el.addEventListener('click', () => setPage(PAGES[i]))
    el.addEventListener('keydown', (e) => {
      const k = e && e.key
      if (k !== 'ArrowRight' && k !== 'ArrowLeft') return
      const next = (i + (k === 'ArrowRight' ? 1 : PAGES.length - 1)) % PAGES.length
      setPage(PAGES[next])
      try { tabs[next].focus() } catch {}
      try { e.preventDefault() } catch {}
    })
  })

  /* ── 设置弹层（语言 / 主题状态 / 后端状态 / 归属与许可） ── */
  const popBtn = q('#settings-btn'), pop = q('#settings-pop')
  let catcher = null
  function popOpen(open) {
    if (!pop || !popBtn) return false
    const on = open === undefined ? pop.hasAttribute('hidden') : !!open
    if (on) pop.removeAttribute('hidden'); else pop.setAttribute('hidden', '')
    try { popBtn.setAttribute('aria-expanded', on ? 'true' : 'false') } catch {}
    // ①(修正 2026-09-18) 弹层打开时铺一层透明"点击捕手"（z-index 低于弹层、高于页面其余部分，**包括同源 iframe**）：
    //   点页面任何地方（含壁纸舞台 iframe 区域）都先命中它 ⇒ 关闭弹层。不依赖焦点/blur（合成事件下 blur 不可靠，
    //   真机上点 iframe 也不一定触发主窗 blur）。
    try {
      if (on) {
        if (!catcher) {
          catcher = D.createElement('div')
          catcher.id = 'settings-catcher'
          catcher.addEventListener('pointerdown', () => popOpen(false))
          catcher.addEventListener('click', () => popOpen(false))
        }
        if (catcher.parentNode !== D.body) D.body.appendChild(catcher)
      } else if (catcher && catcher.parentNode) catcher.parentNode.removeChild(catcher)
    } catch { /* 桩 DOM */ }
    return on
  }
  /* ①(用户 2026-09-20 第 5 条「设置里的超链接点不动」) 显式接管：原生 `<a target=_blank>` 在**合成事件/被覆盖层
     命中**时可能不导航（真机实测点不动）。这里给这条链接补一个点击动作（`window.open` + `noopener`），
     并且**只对 http(s) 放行**（`javascript:` 之类一律拒绝 —— 同批的安全策略要求）。 */
  try {
    const creditA = q('#credit-link-footer')
    if (creditA) {
      creditA.style.pointerEvents = 'auto'
      creditA.addEventListener('click', (e) => {
        try { e.stopPropagation() } catch {}
        try {
          const href = String(creditA.getAttribute('href') || '')
          if (!/^https?:\/\//i.test(href)) return
          e.preventDefault()
          const w = window.open(href, '_blank', 'noopener,noreferrer')
          try { if (w) w.opener = null } catch {}
        } catch { /* 弹窗被拦：保留原生 href 行为 */ }
      })
    }
  } catch { /* 桩 DOM */ }
  if (popBtn) popBtn.addEventListener('click', (e) => { try { e.stopPropagation() } catch {}; popOpen() })
  if (pop) pop.addEventListener('click', (e) => { try { e.stopPropagation() } catch {} })
  D.addEventListener('click', () => popOpen(false))
  D.addEventListener('keydown', (e) => { if (e && e.key === 'Escape') popOpen(false) })
  // ①(修正 2026-09-18 独立验证员发现) 点**壁纸舞台**（同源 iframe 内）不会冒泡到主文档 ⇒ 弹层不关。
  //   同源 iframe 获得焦点时主窗口会 blur ⇒ 用它兜底关闭（切到别的窗口/标签也同样关，符合"点外面就关"的直觉）。
  try {
    if (typeof addEventListener === 'function') addEventListener('blur', () => { if (pop && !pop.hasAttribute('hidden')) popOpen(false) })
  } catch {}

  /* 主题 / 后端状态文字：主题看 #theme-toggle 的 data-mode（bundle 写），后端看 #bench-backend-note（bundle 写） */
  const themeBtn = q('#theme-toggle'), themeState = q('#theme-state'), backendState = q('#backend-state'), backendNote = q('#bench-backend-note')
  // ⑫c(2026-09-19 用户要求) 设置弹层里的主题从"一行跟随系统文字"改成**两个明确开关**（#theme-dark / #theme-light）。
  //   `#theme-state` 只作为**旧缓存 HTML**（新 HTML 里已删）的兜底，不再参与新 DOM。
  const themeDarkBtn = q('#theme-dark'), themeLightBtn = q('#theme-light')
  /** 当前主题**两态**（dark/light）—— 缺省/非法/历史 'auto' 一律按具体一态呈现，UI 不再有第三态 */
  function currentThemeMode() {
    const raw = (themeBtn && themeBtn.dataset && themeBtn.dataset.mode) || ''
    return raw === 'light' ? 'light' : 'dark'
  }
  function paintThemeButtons(mode) {
    const m = mode === 'light' ? 'light' : 'dark'
    for (const [btn, mine] of [[themeDarkBtn, 'dark'], [themeLightBtn, 'light']]) {
      if (!btn) continue
      try { btn.setAttribute('aria-pressed', m === mine ? 'true' : 'false') } catch {}
      try { btn.classList.toggle('active', m === mine) } catch {}
    }
    if (themeState) themeState.textContent = tr(curLang(), 'theme.' + m)     // 旧缓存 HTML 的兜底
    if (themeBtn) { try { themeBtn.title = tr(curLang(), 'theme.' + m) } catch {} }
  }
  function paintStatus() {
    paintThemeButtons(currentThemeMode())
    if (backendState) {
      const note = backendNote ? String(backendNote.textContent || '').trim() : ''
      backendState.textContent = note ? note.split('\n')[0] : tr(curLang(), 'nav.backendUnknown')
    }
  }
  for (const btn of [themeDarkBtn, themeLightBtn]) {
    if (!btn) continue
    btn.addEventListener('click', () => {
      // 两个开关 = 两条明确指令；真正的落盘/DOM 应用在 init() 的 applyThemeMode()（同一份两态逻辑）
      try { if (typeof window !== 'undefined' && typeof window.__benchThemeSet === 'function') window.__benchThemeSet(btn.id === 'theme-light' ? 'light' : 'dark') } catch {}
      try { paintStatus() } catch {}
    })
  }
  try {
    if (themeBtn && typeof MutationObserver === 'function') {
      new MutationObserver(paintStatus).observe(themeBtn, { attributes: true, attributeFilter: ['data-mode'] })
    }
    if (backendNote && typeof MutationObserver === 'function') {
      new MutationObserver(paintStatus).observe(backendNote, { childList: true, characterData: true, subtree: true, attributes: true })
    }
  } catch {}

  /* ── ④(P-158 重做) 壁纸切换栏：**已选/常用**（固定、可点、位置固定）+ **库列表**（显式展开才显示）─────
     用户原话：「扫描出来的壁纸一次性全导入（我选过 2 张，后面还跟着一大堆库里所有壁纸；加号前后点不动、
     触控位置不明）」。旧实现的三条根因（都能在代码里指出来）：
       ① `switcherPlan(items, curId, 12)` 把**库里前 12 项**全部变成 tab ⇒ "一次性全导入"；
       ② 它永远把**当前项排到第一位** ⇒ 每切一次壁纸，所有 tab 都换位置（"点不动/位置不明"的一半）；
       ③ `#wp-add` 被 `insertBefore(addBtn, activeTab.nextSibling)` **跟着当前项跑** ⇒ 加号在栏里跳来跳去，
          触控目标不确定（另一半）。
     新结构：
       · `#editor-tabs` 里只有"当前壁纸"（产物自己的 `#current`）+ **用户固定过的** tab（顺序 = 固定顺序，
         位置稳定，当前项不重复出现在条上）；
       · `#wp-add` 移到 `#wp-switch` 的**最右端固定位**（静态 HTML 里就是 `#editor-tabs` 的兄弟），
         点它 = **显式展开/收起**库列表面板 `#wp-panel`（`aria-expanded` 跟着走）；
       · 面板里才是完整库列表：每行 = 类型标签（真实类型，小写三档）+ 标题 + 固定/取消固定（★）+ 点击切换。
     固定集合持久化在 `bench-pinned-wallpapers`（最多 8 条，超出丢最旧）。 */
  const listEl = q('#list'), tabsBox = q('#editor-tabs'), addBtn = q('#wp-add')
  const wpPanel = q('#wp-panel'), wpPanelList = q('#wp-panel-list'), wpPanelHead = q('#wp-panel-head')
  const PIN_STORE = 'bench-pinned-wallpapers'      // localStorage 键（命名避开 secret-scan 的 *KEY= 长串误报）
  const PIN_MAX = 8
  let curId = null
  function listItems() {
    if (!listEl) return []
    return [...listEl.querySelectorAll('li[data-id]')].map((li) => ({
      id: String(li.dataset.id || ''),
      title: (li.querySelector('.title')?.textContent || li.textContent || '').trim(),
      sub: (li.querySelector('.sub')?.textContent || '').trim(),
      active: li.classList.contains('active'),
      el: li,
    }))
  }
  function readPinned() {
    try {
      const raw = JSON.parse(readKey(PIN_STORE) || '[]')
      return Array.isArray(raw) ? raw.map((x) => String(x == null ? '' : x)).filter(Boolean) : []
    } catch { return [] }
  }
  let pinned = readPinned()
  function writePinned(next) { pinned = next; try { writeKey(PIN_STORE, JSON.stringify(next)) } catch {} }
  /** 挂到"已选"（幂等；已固定保持原位 ⇒ 位置固定）。 */
  function pinWallpaper(id) {
    const next = trackPin(pinned, id, true, PIN_MAX)
    if (JSON.stringify(next) !== JSON.stringify(pinned)) writePinned(next)
    return next
  }
  function unpinWallpaper(id) {
    const next = trackPin(pinned, id, false, PIN_MAX)
    writePinned(next)
    return next
  }
  /** 点一个 id 切换壁纸：优先用它自己的 `li.onclick`（产物那条挂载链一行不改）；
   *  该 id 当前不在列表里（被类型过滤挡掉）⇒ 先把它那一档的类型开关切过去，等产物重渲染后再点。
   *  ③(P-164) **幂等**：目标已经是"当前项"（列表里带 `.active`，或 id === curId）⇒ 直接返回，
   *  不再 `click()` —— 否则同一个壁纸会被重挂一次（重新取包、进度归零、日志多一条 Mount）。 */
  function switchToWallpaper(id) {
    /* ⑲(用户第 19 条) 用户**显式**再选一张壁纸 = 释放态结束：复位门闩并重启被停掉的那条轮询
       （`init()` 里 `window.__benchRelease.resume()`；拿不到就什么都不做，不抛）。 */
    try { if (typeof window !== 'undefined' && window.__benchRelease && typeof window.__benchRelease.resume === 'function') window.__benchRelease.resume() } catch { /* 桩环境 */ }
    const want = String(id || '')
    if (!want) return false
    const hit = () => [...(listEl ? listEl.querySelectorAll('li[data-id]') : [])].find((li) => String(li.dataset.id || '') === want)
    const first = hit()
    //  ③(P-164) 决策走纯函数（可单测、可变异）：已经是当前项 ⇒ 不点（见 `switchDecision` 的注释）。
    if (switchDecision(curId, want, !!first, !!(first && first.classList.contains('active'))).skip) { curId = want; return false }
    if (first) { try { first.click() } catch { /* ignore */ } ; return true }
    const kind = kindOfWallpaperId(want)
    // ①(2026-09-22 用户第 25 条) 旧写法调用的 `setTypeFilter` **从未定义** ⇒ 叉掉几张贴后 ReferenceError 卡住；
    //   改用产物自己的类型档驱动函数（同作用域函数声明，会提升；它按 `.seg-btn[data-type]` 的委托处理器切档）。
    if (kind && kind !== bundleType) { driveBundleType(kind); setTimeout(() => { const li2 = hit(); if (li2) { try { li2.click() } catch {} } }, 60); return true }
    return false
  }
  /** id ⇒ 类型：优先查当前列表里的 `.sub`，查不到就查我们缓存过的 id→kind 表（切类型前也认得）。 */
  const kindCache = new Map()
  const titleCache = new Map()
  function rememberKinds(items) {
    for (const it of items) {
      const k = kindOfSub(it.sub); if (k !== 'unknown') kindCache.set(it.id, k)
      if (it.id && it.title) titleCache.set(it.id, it.title)
    }
  }
  function kindOfWallpaperId(id) { return kindCache.get(String(id)) || null }
  /** id ⇒ 列表里显示过的标题（关掉当前项时要立刻把这一格换成回落项的名字，见 `closeWallpaperTab`）。
   *  必须先查缓存再退回 id：回落那一刻列表可能**正好被类型过滤重渲染**（`switchToWallpaper` 切档时
   *  `#list` 会换一批节点）⇒ 只查现列表会拿到空，然后把 id 当标题写进"当前壁纸"那一格（真机自证抓到过）。 */
  function titleOfWallpaperId(id) {
    return titleForId(listItems(), (k) => titleCache.get(k), id)
  }
  let switcherSig = null
  function refreshSwitcher(force = false) {
    if (!tabsBox || !listEl) return { tabs: 0 }
    const items = listItems()
    rememberKinds(items)
    //  ①(本轮 #14) 列表行布局：标题与 ID 分行（产物 `T()` 每次重画都会重建这些节点 ⇒ 这里每次都过一遍，幂等）
    decorateListRows(listEl)
    const activeItem = items.find((it) => it.active)
    if (activeItem) { curId = activeItem.id; pinWallpaper(curId) }      // 选过就进"已选"（位置固定，不重排）
    //  ①(用户第 9 条「未选择壁纸时出现幽灵叉号」) `curId` 的**唯一事实源 = 列表里真的有一项 `.active`**：
    //  产物释放舞台/关掉最后一项之后列表里没有任何 active 项，这里必须把 curId 清成 null，
    //  否则它会一直留着上一个 id ⇒ `#current` 那一格挂着"点了没反应"的 ×。
    else curId = null
    const plan = pinnedPlan(pinned, items, curId, PIN_MAX)
    if (plan.dropped > 0) writePinned(plan.ids)
    // ①(修正 2026-09-17) **签名守卫**：内容没变就一个 DOM 写都不做。
    //   真机事故：补丁往 #editor-tabs 插 tab → #editor-chrome 变高 → 产物的 stage ResizeObserver 重算 →
    //   又触发 #list 变更事件 → 再插一遍 …… 两个观察者互激成忙循环，页面 load 卡死（探针超时）。
    const sig = JSON.stringify(plan.tabs.map((t) => [t.id, t.title, t.kind])) + '|' + String(curId) + '|' + pinned.join(',')
    if (!force && sig === switcherSig) { paintWpPanel(); return { tabs: plan.tabs.length, total: plan.ids.length, unchanged: true } }
    switcherSig = sig
    for (const el of [...tabsBox.querySelectorAll('.wp-tab')]) el.remove()
    for (const el of [...tabsBox.querySelectorAll('.wp-x-cur')]) el.remove()
    for (const it of plan.tabs) {
      const b = D.createElement('button')
      b.type = 'button'; b.className = 'wp-tab'
      b.dataset.id = it.id; b.dataset.kind = it.kind
      //  ①(P-164) 标题**只在一段可省略的 span 里**（`text-overflow:ellipsis`），右侧 `×` 永远在标签右端
      //  —— 用户原话："名称过于长就不要显示全 … 不然那个 X 要在很后面了"。
      const name = D.createElement('span')
      name.className = 'wp-name'
      name.textContent = it.title || it.id
      const x = D.createElement('button')
      x.type = 'button'; x.className = 'wp-x'; x.dataset.id = it.id
      x.textContent = '×'
      x.title = t(curLang(), 'wp.closeTip'); x.setAttribute('aria-label', t(curLang(), 'wp.close') + ' ' + (it.title || it.id))
      x.addEventListener('click', (e) => { try { e.stopPropagation() } catch { /* 合成事件 */ } ; closeWallpaperTab(it.id) })
      b.appendChild(name); b.appendChild(x)
      b.title = (it.title ? it.title + '（' + it.id + '） · ' : '') + it.kind + ' · ' + t(curLang(), 'wp.switchHint')
      b.setAttribute('aria-label', b.title)
      b.addEventListener('click', () => { switchToWallpaper(it.id) })
      tabsBox.appendChild(b)
    }
    const cur = q('#current')
    if (cur && activeItem) cur.classList.toggle('active', true)
    //  ①(P-164) 当前壁纸那一格也带 `×`：`#current` 的文本由产物写（写 textContent 会冲掉子节点），
    //  所以 × 做成它的**兄弟节点**、紧贴右缘（视觉上仍是同一格）。关掉当前壁纸 ⇒ 回落到下一个打开项，
    //  没有其它项就释放舞台（见 closeWallpaperTab）。
    try {
      //  `curId` 为空（刚释放完）就不画这一格的 `×`：否则"未选择壁纸"旁边挂着一个点了没反应的叉。”
      if (cur && curId && activeItem && cur.parentNode === tabsBox) {
        const cx = D.createElement('button')
        cx.type = 'button'; cx.className = 'wp-x wp-x-cur'
        cx.dataset.id = String(curId || '')
        cx.textContent = '×'
        cx.title = t(curLang(), 'wp.closeTip')
        cx.setAttribute('aria-label', t(curLang(), 'wp.close'))
        cx.addEventListener('click', (e) => { try { e.stopPropagation() } catch { /* 合成事件 */ } ; closeWallpaperTab(cx.dataset.id || curId) })
        if (cur.nextSibling) tabsBox.insertBefore(cx, cur.nextSibling); else tabsBox.appendChild(cx)
        /*  ⑦(2026-10-12 用户 :8902 实测第 4 条) **与 `×` 同生共死**的宿主格标记：`#current` 拿到
            `wp-cur-has-x` ⇒ CSS 给它预留 `×` 的宽度，`×` 再用负左外边距挪回框内（静态表与
            SITE_LAYOUT_CSS 里那对规则；无标记时 `#current` 的 padding 逐字回到产物的 `0 16px`）。
            为什么不由 CSS 自己判（`:has(+ .wp-x-cur)`）：老浏览器没有 `:has()`，而"画没画这个 `×`"
            本来就只有这里知道 —— 一处判、一处画，不引第二套口径。 */
        cur.classList.add('wp-cur-has-x')
      } else if (cur) {
        //  没画 `×`（未选壁纸 / 已释放 / `#current` 不在条上）⇒ 标记必须摘掉，否则 `#current` 白留 32px 内边距
        cur.classList.remove('wp-cur-has-x')
      }
    } catch { /* 桩 DOM */ }
    paintWpPanel()
    return { tabs: plan.tabs.length, total: plan.ids.length }
  }
  /** ①(P-164) 关掉一个已打开的壁纸标签（= 取消固定；若关的是当前项要**确定**回落并刷新预览）。
   *  回落顺序：剩下的已选项里离它最近的那个（先看它后面、再看它前面）⇒ 都没有就点产物的「释放」
   *  （`#release`，与用户手点同一个落点）把舞台清干净 —— 不留一个"标签没了但画面还在"的中间态。 */
  function closeWallpaperTab(id) {
    const want = String(id == null ? '' : id)
    if (!want) return false
    /* ①(用户第 9 条) **幂等且不写误导日志**：`want` 既不在已打开集合里、也不是当前项 ⇒
       这一次点击什么都没关掉。旧写法会一路走到"没有其它打开项 ⇒ 释放舞台"那条分支，
       于是空态下点幽灵叉号也会写一行"已关闭当前壁纸 … 释放舞台"（用户点名的假日志）。 */
    const isOpen = (Array.isArray(pinned) && pinned.indexOf(want) >= 0) || String(curId || '') === want
    if (!isOpen) return false
    const plan = closeTabPlan(pinned, curId, want)
    const wasCurrent = plan.wasCurrent
    const fallback = plan.fallback
    writePinned(plan.pinned)              // 决策走纯函数（可单测），落盘/重画在这里
    /* ①(2026-09-22 用户第 27 条) **全叉光之后配置面板必须清空**：旧写法只在"切档/未选中"时清，
       于是把所有页签都关掉后面板仍留着上一张壁纸的属性表（看起来像"还在配置它"）。 */
    try {
      /* ⚠ 必须**延迟一拍再判定**：切档时"旧页签刚关、新项还没设成当前"会出现一瞬间的"一个都不剩"，
         立刻清空会把新壁纸的面板一起清掉（真机门禁 `bench-ui-headless` 的 P1 就是这么红的：
         切过去那张 A 的 rows=0）。延迟后重新判一次：真的还是空 ⇒ 才清。 */
      /* 条件再加一道：**列表里还有 `.active` 当前项**（产物按它标当前壁纸）⇒ 绝不清 ——
         切档时"旧页签刚关、新项还没设成当前"这一瞬间 curId/pinned 都可能是空的，
         但 `#list li.active` 已经指向新那张（真机门禁 P1：A 声明 237 项却被清成 0 行）。 */
      const noneLeft = () => !(Array.isArray(pinned) && pinned.length) && !curId
        && !(typeof document !== 'undefined' && document.querySelector && document.querySelector('#list li.active'))
      if (noneLeft()) setTimeout(() => { try { if (noneLeft()) { clearPropsBody(); paintPropsEmpty() } } catch (e) {} }, 0)
    } catch (e) {}
    switcherSig = null
    if (wasCurrent) {
      if (fallback) {
        switchToWallpaper(fallback)
        //  **同一格立刻换成回落项的标题**：`switchToWallpaper` 只是把点击交给产物，产物要重新取包/挂载
        //  才会改写 `#current` 的文本 —— 那之前这一格会一直显示一个**已经关掉的**标签的名字（门禁 Y7b
        //  抓到的"旧标题挂在没有标签的项上"）。标题从当前列表里查（查不到就退回 id），产物稍后用同一个
        //  名字覆盖，两次写的是同一份数据、不会闪。
        try {
          const cur = q('#current')
          const ttl = titleOfWallpaperId(fallback)
          if (cur && ttl) { cur.textContent = ttl; cur.setAttribute('title', ttl) }
        } catch { /* 桩 DOM */ }
        log(t(curLang(), 'wp.closedFallback', { id: want, next: fallback }))
      } else {
        //  没有其它打开项 ⇒ 释放舞台。顺序：先把"当前壁纸"这一格清成未选择态（产物只在它自己那条
        //  `ht()` 清除链里做这件事，补丁层用同样两个字面量写一次：与 `#empty` 的显隐口径一致），
        //  再点产物自己的 `#release`（= 用户手点"释放"的同一个落点，`__wp.release()`），
        //  最后取消剩余固定项并重画 —— 不留"标签没了、画面还在"的中间态。
        try {
          const cur = q('#current')
          if (cur) { cur.textContent = t(curLang(), 'tab.wallpaper'); cur.removeAttribute('title') }
          const rel = q('#release'); if (rel) rel.click()
          const emptyEl = q('#empty'); if (emptyEl) emptyEl.style.display = ''
          //  列表里的选中态也要撤掉：`refreshSwitcher` 把"列表里带 `.active` 的那一项"当成当前项并
          //  **自动固定**它 ⇒ 留着选中态就等于刚清空的固定集合立刻被写回一条（自证 Y0/Y8 抓到的
          //  "空态了但 `bench-pinned-wallpapers` 还有一条"）。
          for (const li of (listEl ? listEl.querySelectorAll('li[data-id].active') : [])) li.classList.remove('active')
          curId = null
        } catch { /* 桩 DOM */ }
        writePinned([])
        log(t(curLang(), 'wp.closedRelease', { id: want }))
        /*  ⑦(2026-09-25 用户第 7 条) **把产物那侧的当前项也清掉**：上面点的 `#release` 只释放舞台，
            产物的 `w`（"最后一次挂载的那张"）还在 ⇒ 之后任何一次"重挂载"（切渲染器档/音条源/产物自己的
            「重挂载」按钮）都会把**已经叉掉的**那张又挂回来（改前真机读数：`#frame.src` 从 `about:blank`
            变回 `…&src=2887099508…`）。这里借产物自己的 `ht()` 清一次 —— 它是唯一会写 `w=null` 的入口。
            异步（产物那条链要先 await 一次 fetch，垫片就地答掉）⇒ 不阻塞关闭流程，读数走
            `artifactClearProbe()`；失败/拿不到链 ⇒ 只记读数，不假装清干净了。 */
        try {
          const clearFn = (typeof window !== 'undefined' && typeof window.__benchClearArtifactSelection === 'function') ? window.__benchClearArtifactSelection : null
          if (clearFn) clearFn('close-last')
        } catch { /* 清理失败不致命：还有换档那道守卫 */ }
      }
    } else {
      log(t(curLang(), 'wp.closed', { id: want }))
    }
    refreshSwitcher(true)
    //  ①(本轮 #25) 上面这条"没有其它打开项 ⇒ 释放舞台"的路只`classList.remove('active')`，不产生
    //  childList 变更 ⇒ 列表观察者不会响。这里显式让属性面板对一次账：面板必须落到"未选择"空态、
    //  旧那张壁纸的行（`ui_browse_properties_scheme_color` 等）一个都不留。
    try { refreshPropsPanel('list') } catch { /* 单次失败不影响关闭流程 */ }
    return true
  }

  /* 库列表面板：显式展开（`#wp-add`）才显示；行 = 真实类型 + 标题 + ★。 */
  function panelOpen() { return !!(wpPanel && !wpPanel.hasAttribute('hidden')) }
  function setPanelOpen(open) {
    if (!wpPanel) return false
    const want = !!open
    if (want) { wpPanel.removeAttribute('hidden'); renderWpPanel() } else wpPanel.setAttribute('hidden', '')
    if (addBtn) {
      try { addBtn.setAttribute('aria-expanded', want ? 'true' : 'false') } catch {}
      try { addBtn.setAttribute('title', t(curLang(), want ? 'wp.libClose' : 'wp.libOpen')) } catch {}
      try { addBtn.setAttribute('aria-label', t(curLang(), want ? 'wp.libClose' : 'wp.libOpen')) } catch {}
    }
    return want
  }
  function paintWpPanel() { if (panelOpen()) renderWpPanel() }
  function renderWpPanel() {
    if (!wpPanelList) return 0
    const rows = wpPanelRows(listItems(), pinned)
    if (wpPanelHead) {
      wpPanelHead.textContent = rows.length
        ? t(curLang(), 'wp.pinnedCount', { n: pinned.length }) + ' · ' + t(curLang(), 'wp.libCount', { n: rows.length })
        : t(curLang(), 'wp.libEmpty')
    }
    wpPanelList.textContent = ''
    for (const r of rows) {
      const row = D.createElement('div')
      row.className = 'wp-row'; row.dataset.id = r.id; row.dataset.kind = r.kind
      const go = D.createElement('button')
      go.type = 'button'; go.className = 'wp-row-go'; go.dataset.id = r.id
      const kind = D.createElement('span'); kind.className = 'wp-kind'; kind.textContent = r.tag
      const name = D.createElement('span'); name.className = 'wp-name'; name.textContent = r.title || r.id
      go.appendChild(kind); go.appendChild(name)
      go.title = (r.title || r.id) + '（' + r.id + '） · ' + r.kind
      go.setAttribute('aria-label', go.title)
      go.addEventListener('click', () => { if (switchToWallpaper(r.id)) setPanelOpen(false) })
      const star = D.createElement('button')
      star.type = 'button'; star.className = 'wp-pin' + (r.pinned ? ' on' : '')
      star.dataset.id = r.id
      star.textContent = r.pinned ? '★' : '☆'
      star.title = t(curLang(), r.pinned ? 'wp.unpin' : 'wp.pin')
      star.setAttribute('aria-label', star.title)
      star.setAttribute('aria-pressed', r.pinned ? 'true' : 'false')
      star.addEventListener('click', () => {
        if (r.pinned) unpinWallpaper(r.id); else pinWallpaper(r.id)
        switcherSig = null                       // 固定集合变了 ⇒ 强制重画 tab 条
        refreshSwitcher(true)
      })
      row.appendChild(go); row.appendChild(star)
      wpPanelList.appendChild(row)
    }
    return rows.length
  }
  try {
    if (listEl && typeof MutationObserver === 'function') {
      let timer = null
      new MutationObserver(() => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          timer = null
          try { syncAllIfNeeded() } catch { /* 单次失败不影响其它链路 */ }
          //  ⑧「高亮与过滤同一个变量」：产物重画列表之后（它会把自己的 `.active` 写回 'video' 那档）
          //  按 uiType 再对一次账 —— 否则就是用户看到的"高亮在视频、内容是全部分"。
          try { paintTypeSegs() } catch { /* 桩 DOM */ }
          refreshSwitcher()
          //  ①(本轮 #23/#25) 列表被重画 ⇒ 属性面板跟着"当前 item"对账：释放舞台后这里会落到"未选择"空态
          try { refreshPropsPanel('list') } catch { /* 单次失败不影响切换栏 */ }
        }, 60)
      }).observe(listEl, { childList: true })
    }
  } catch {}
  /* ③(P-164) 左侧列表里**已选中**的那一项：重复点击不再重新渲染。
     产物给当前项打了 `.active`（`T()` 里按 `w?.itemId` 加），它自己的 `li.onclick` 会走整条重挂链
     ⇒ 这里在**捕获阶段**拦下（`stopPropagation` 阻止产物的处理器），并记一条可断言的读数。
     为什么不用 `preventDefault`：li 不是表单控件，没有默认行为要拦。 */
  try {
    if (listEl && !listEl.__benchNpIdemBound) {
      listEl.__benchNpIdemBound = true
      listEl.addEventListener('click', (e) => {
        let n = e && e.target
        while (n && n !== listEl && !(n.dataset && n.dataset.id)) n = n.parentNode
        if (!n || n === listEl || !n.dataset) return
        const id = String(n.dataset.id || '')
        const isActive = !!(n.classList && n.classList.contains('active'))
        if (!(isActive || id === String(curId || ''))) return
        try { e.stopPropagation() } catch { /* 合成事件 */ }
        idemHits++
        try { const h = npHostEl(); if (h) h.setAttribute('data-np-idem', String(idemHits)) } catch { /* 桩 DOM */ }
      }, true)
    }
  } catch { /* 桩 DOM */ }

  /* ＋：展开/收起**库列表面板**（位置固定在切换栏右端，不再跟着当前项跑）；
     面板里的每一行才是"完整库列表" —— 用户要的"要显式展开才显示"。 */
  if (addBtn) addBtn.addEventListener('click', (e) => {
    try { e && e.stopPropagation && e.stopPropagation() } catch {}
    setPage('console')
    setPanelOpen(!panelOpen())
  })
  /* 点面板外 / Esc ⇒ 收起（面板是浮层，别让它一直挂着）。
     ⚠(2026-09-24 同类根因·顺手真修) 这里原先写的是 `doc` —— 而 `doc` 是 **init()**（另一个函数作用域）里的量，
     本函数（initSiteShell）里只有 `D` ⇒ 这两条监听器**从来没装上过**（`ReferenceError` 被外层 try 吞掉），
     真机表现"点面板外不收起"。现在用本作用域真正存在的 `D`。 */
  try {
    D.addEventListener('click', (e) => {
      if (!panelOpen()) return
      const tgt = e && e.target
      if (wpPanel && (wpPanel.contains(tgt) || tgt === addBtn)) return
      setPanelOpen(false)
    })
    D.addEventListener('keydown', (e) => { if (e && e.key === 'Escape' && panelOpen()) setPanelOpen(false) })
  } catch { /* 桩 DOM */ }

  /* ── ④b(P-158) **类型过滤**要可见可用（用户补充要求：「应该 MPKG 各类包括 Web 壁纸都可以」）──────
     真因：产物自己的类型开关宿主 `#type-filter` 被上一批塞进了 `#bench-legacy-anchors[hidden]`
     且**一个 `.seg-btn` 都没有** ⇒ 产物 `Pe` 永远停在初始值 `'scene'`（`rt(item)!==Pe` 直接 continue）
     ⇒ 左侧列表永远只有 scene 那几项，web/video 明明在 `/api/library` 的返回里却一个都看不到。
     修法：
       · `#type-filter` 移到左侧边栏 `.sidebar-tools`（可见），由本补丁生成 **4** 个 `.seg-btn`
         （全部 / 场景 / Web / 视频）—— scene/web/video 三个直接走产物自己的委托处理器（`Xe.onclick`）
         ⇒ 列表、localStorage `we-bench-type-filter`、`.active` 全由产物维护，一行不改它的逻辑；
       · 「全部」产物没有这一档（`it()` 只认三档）⇒ 由本补丁**合并三档**：依次把三档渲染出来的 `li`
         节点搬进一个 fragment 再一起放回（节点搬移保住了 `li.onclick` 闭包 ⇒ 每个条目照样点得动）。
     读法：`bundleType` 是"产物现在停在哪一档"，`uiType` 是"用户看到哪一档被点亮"（'all' 是补丁档）。 */
  const TYPE_SEGS = ['all', 'scene', 'web', 'video']
  const typeHost = q('#type-filter')
  let uiType = 'all'
  let idemHits = 0                      // ③(P-164) "重复点击已选中项被拦下"的计数（可断言）
  let bundleType = 'scene'
  /* ⑧(2026-09-20 用户第 8 条 · 用户实测「默认高亮在视频、内容却是全部分」)
     单一事实源 = `uiType`（**只**由这里读写）。产物自己也会给它那几个 seg 写 `.active`
     （它记的是 `we-bench-type-filter`，合并「全部」时最后一次驱动到的是 'video'）⇒
     列表被它重画之后高亮就会漂到"视频"，而内容仍是合并结果。
     修法：① 只在值真的变时才写 DOM（写同样的值不产生 mutation ⇒ 不会与观察者自激）；
           ② 列表每次变动（含产物重画）之后都调一次 `paintTypeSegs()`，高亮永远跟着 `uiType` 走。 */
  function setSegActive(b, on) {
    if (!b) return 0
    let changed = 0
    try { if (b.classList.contains('active') !== !!on) { b.classList.toggle('active', !!on); changed++ } } catch { /* 桩 DOM */ }
    try { if (b.getAttribute('aria-checked') !== (on ? 'true' : 'false')) b.setAttribute('aria-checked', on ? 'true' : 'false') } catch { /* 桩 DOM */ }
    return changed
  }
  function paintTypeSegs() {
    if (!typeHost) return 0
    for (const b of [...typeHost.querySelectorAll('.seg-btn')]) setSegActive(b, b.dataset.type === uiType)
    const mirror = q('#wp-type-mirror')
    if (mirror) for (const b of [...mirror.querySelectorAll('.seg-btn')]) setSegActive(b, b.dataset.type === uiType)
    return 1
  }
  function segBtn(host, type) {
    const b = D.createElement('button')
    b.type = 'button'; b.className = 'seg-btn'; b.dataset.type = type
    b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', 'false')
    b.textContent = t(curLang(), 'wp.type.' + type)
    b.title = t(curLang(), 'wp.typeTitle')
    return b
  }
  function buildTypeSegs() {
    if (!typeHost) return 0
    if (typeHost.querySelectorAll('.seg-btn').length === TYPE_SEGS.length) return 0
    typeHost.textContent = ''
    for (const ty of TYPE_SEGS) typeHost.appendChild(segBtn(typeHost, ty))
    typeHost.setAttribute('role', 'radiogroup')
    typeHost.setAttribute('aria-label', t(curLang(), 'wp.typeTitle'))
    const mirror = q('#wp-type-mirror')
    if (mirror && !mirror.querySelectorAll('.seg-btn').length) {
      mirror.textContent = ''
      for (const ty of TYPE_SEGS) {
        const b = segBtn(mirror, ty)
        b.addEventListener('click', () => { const src = typeHost.querySelector('.seg-btn[data-type="' + ty + '"]'); if (src) src.click() })
        mirror.appendChild(b)
      }
      mirror.setAttribute('role', 'radiogroup')
    }
    paintTypeSegs()
    return TYPE_SEGS.length
  }
  /** 让产物**按它自己的那条链**渲染某一档：`Xe.onclick` 是产物挂在 `#type-filter` 上的委托处理器
   *  （`e.target.closest('.seg-btn').dataset.type` ⇒ `it(type)`），直接以等价事件对象调它即可
   *  —— 不复制它的过滤逻辑，也不依赖"捕获/冒泡的先后"。
   *  `it()` 有 `n !== Pe` 守卫：同档重复点不会重渲染 ⇒ 此时改用 `#filter` 的 input 事件逼它重画
   *  （`Je.oninput = T`，T 用当前 Pe 重排列表）。 */
  function driveBundleType(type) {
    if (!typeHost || !listEl) return false
    const btn = typeHost.querySelector('.seg-btn[data-type="' + type + '"]')
    if (!btn) return false
    const f = typeHost.onclick
    if (typeof f === 'function') { try { f.call(typeHost, { target: btn }) } catch { /* 产物没接上 */ } }
    if (bundleType !== type) bundleType = type
    else { const inp = q('#filter'); if (inp) { try { inp.dispatchEvent(new Event('input', { bubbles: true })) } catch {} } }
    return true
  }
  /** 列表当前内容的签名（id 序列 + 过滤框文本）：用来判断"要不要再合并一次"。 */
  function listSig() {
    if (!listEl) return ''
    const ids = [...listEl.querySelectorAll('li[data-id]')].map((li) => String(li.dataset.id || '')).join(',')
    const f = q('#filter')
    return ids + '|' + String((f && f.value) || '')
  }
  let mergedSig = null            // 上一次「全部」合并完成时的签名
  /** 「全部」= 依次渲染三档并把 `li` 搬到一个 fragment 里，最后一起放回（节点搬移保住 `li.onclick` 闭包）。
   *  ⚠ 产物会在**它自己的时机**重渲染列表（库加载完成、`#filter` 输入、切档），那之后列表只剩一档
   *  ⇒ 每次列表变动后由观察者按签名决定"要不要再合并一次"（`syncAllIfNeeded`）。 */
  function mergeAllTypes() {
    if (!listEl) return 0
    const bag = []
    for (const ty of ['scene', 'web', 'video']) {
      driveBundleType(ty)
      for (const li of [...listEl.querySelectorAll('li[data-id]')]) { li.remove(); bag.push(li) }
    }
    for (const li of bag) listEl.appendChild(li)
    try { writeKey('we-bench-type-filter', bundleType) } catch { /* 隐私模式 */ }
    mergedSig = listSig()
    return bag.length
  }
  /** 列表被（产物）重渲染后：若用户选的是「全部」而当前内容不是合并结果 ⇒ 再合并一次。
   *  签名相等 ⇒ 什么都不做（我们的合并自身也会触发观察者，靠这条收敛，不会自激）。 */
  function syncAllIfNeeded() {
    if (uiType !== 'all' || !listEl) return false
    if (listSig() === mergedSig) return false
    mergeAllTypes()
    return true
  }
  /** 用户点了某一档：**拦住产物的委托处理器**（否则 'all' 会被它当成一个真档位 ⇒ 列表清空），
   *  再由我们显式驱动它渲染。 */
  function applyTypeChoice(type) {
    uiType = (TYPE_SEGS.indexOf(type) >= 0) ? type : 'all'
    try { writeKey('bench-lib-type', uiType) } catch { /* 隐私模式 */ }
    if (uiType === 'all') mergeAllTypes()
    else { driveBundleType(uiType); try { writeKey('we-bench-type-filter', uiType) } catch {} }
    paintTypeSegs()
    paintWpPanel()
    return uiType
  }
  if (typeHost) {
    try {
      bundleType = (() => { const v = readKey('we-bench-type-filter'); return (v === 'scene' || v === 'web' || v === 'video') ? v : 'scene' })()
    } catch { bundleType = 'scene' }
    buildTypeSegs()
    /* 产物的委托处理器挂在 `#type-filter` 上（冒泡期）。我们要在它之前把点击接管掉：
       捕获阶段 `stopPropagation()` ⇒ 它一个字节都不会跑，随后由 `applyTypeChoice()` **显式**调它。 */
    typeHost.addEventListener('click', (e) => {
      const b = e && e.target && e.target.closest ? e.target.closest('.seg-btn') : null
      const ty = b && b.dataset ? b.dataset.type : ''
      if (!ty) return
      try { e.preventDefault() } catch {}
      try { e.stopPropagation() } catch {}
      applyTypeChoice(ty)
      setTimeout(() => { try { refreshSwitcher(true) } catch {} }, 0)     // 产物同步重渲染后再对一次账
    }, true)
    /* 默认档 = 「全部」（用户要的就是"各类壁纸都能看到"）；`?type=scene|web|video` 与上次的选择都可回退。 */
    const wantType = (() => {
      try {
        const m = String(location.search || '').match(/[?&]type=(all|scene|web|video)/)
        if (m) return m[1]
        const saved = readKey('bench-lib-type')
        return (saved === 'all' || saved === 'scene' || saved === 'web' || saved === 'video') ? saved : 'all'
      } catch { return 'all' }
    })()
    const applyDefault = () => { try { applyTypeChoice(wantType); refreshSwitcher(true) } catch { /* 库没就绪：下一次 #list 变更时会重试 */ } }
    applyDefault()
    setTimeout(applyDefault, 1000)          // 产物在 boot 里可能又按 localStorage 重排一次 ⇒ 再对一次账
  }
  /* 列表里**每条**都挂真实类型标签（用户补充要求③：类型要如实显示，不要一律写 scene）。 */
  try {
    const tagKind = () => {
      if (!listEl) return 0
      let n = 0
      for (const li of listEl.querySelectorAll('li[data-id]')) {
        const k = kindOfSub((li.querySelector('.sub') || {}).textContent || '')
        if (k === 'unknown') continue
        let tag = li.querySelector('.bench-kind')
        if (!tag) { tag = D.createElement('span'); tag.className = 'bench-kind'; li.appendChild(tag); n++ }
        if (tag.textContent !== k) tag.textContent = k
        tag.dataset.kind = k
      }
      return n
    }
    tagKind()
    if (listEl && typeof MutationObserver === 'function') new MutationObserver(() => { try { tagKind() } catch {} }).observe(listEl, { childList: true, subtree: true })
  } catch { /* 桩 DOM */ }

  /* ── ⑩(P-158) 「当前库来源」要**显式**写出来（用户原话：「未选目录却默认在 …/allwallpaper/dd」）────────
     前端侧能确定的只有三件事：
       · `#libpath` 里那个路径是**产物**按 `/api/library` 的 `dir` 写的（用户没选过也一样有值）；
       · `localStorage['we-bench-library-dir']` 只在**用户选过**（产物 `ut()` 成功）之后才有值；
       · `apiStatus`（`/api/library` 的 HTTP 状态）说明后端到底在不在。
     ⇒ 因此：没有用户选择记录时**必须写"本机默认目录（服务端内置，你还没有选择）"**，不许只甩一个路径
       让人以为"已经选好了"。服务端若在 `/api/library` 里加 `source: 'default'|'user'|'env'|'flag'`，
       这里优先用它的值（`librarySourcePlan` 已经按这个契约写好）。
     ⚠①(2026-09-24 用户第 3 条①) 绘制器与它的状态**已经搬到模块作用域**（`paintLibSource`/`askLibSourceOnce`
       /`libSourceBridge`）：旧写法把它定义在本函数里，而切库根的调用点在 `init()` 里 ⇒
       `ReferenceError: paintLibSource is not defined`（tsc TS2304 实证）。这里只**注入**两个取值器，
       不再重新定义（重新定义会把它又关回这个作用域，同样的 bug 会再长出来）。 */
  libSourceBridge.backendStatus = typeof ctx.backendStatus === 'function' ? ctx.backendStatus : (() => 0)
  libSourceBridge.lang = curLang
  try {
    const pathEl = q('#libpath')
    if (pathEl && typeof MutationObserver === 'function') {
      new MutationObserver(() => { paintLibSource() }).observe(pathEl, { childList: true, characterData: true, subtree: true })
    }
  } catch { /* 桩 DOM */ }

  /* ── ③(用户补充要求) 状态栏 / 列表里的**类型**如实显示（不要一律写 scene）────────────────────
     `#status-item` 由产物写成裸 itemId；这里在后面补一个真实类型徽标（`.bench-status-kind`），
     签名守卫防观察者互激（写一次就不再写）。 */
  try {
    const statusItem = q('#status-item')
    if (statusItem && typeof MutationObserver === 'function') {
      const paintKind = () => {
        const id = String((statusItem.textContent || '')).trim()
        const badge = q('#status-item-kind')
        if (!id) { if (badge) badge.textContent = ''; return }
        const kind = kindCache.get(id) || (() => {
          const li = listEl ? [...listEl.querySelectorAll('li[data-id]')].find((x) => String(x.dataset.id || '') === id) : null
          return li ? kindOfSub((li.querySelector('.sub') || {}).textContent || '') : 'unknown'
        })()
        const want = kind === 'unknown' ? '' : kind
        if (!badge) {
          const b = D.createElement('span')
          b.id = 'status-item-kind'; b.className = 'bench-status-kind'
          statusItem.parentNode ? statusItem.parentNode.insertBefore(b, statusItem.nextSibling) : null
          if (b.textContent !== want) b.textContent = want
          return
        }
        if (badge.textContent !== want) badge.textContent = want
      }
      new MutationObserver(paintKind).observe(statusItem, { childList: true, characterData: true, subtree: true })
      paintKind()
    }
  } catch { /* 桩 DOM */ }

  /* ══════════ 壁纸参数栏：#23/#25 的"跟着当前壁纸重挂载"状态机 + #18/#26/#27/#28/#30/#34 装饰 ══════════
     真因（无头探针实测，不是猜）：
       · 产物 `Ue(item)`（点列表项）只在 `Le.hidden === false` 时才 `yt(item.itemId)` 重读属性表；
         而 `#props-close` 会（走产物自己的 `ue(!1)`）把 `#props` 打上 `hidden` ⇒ **面板收起期间切壁纸
         一次 `/api/props` 都不发**，再展开时行还是上一张壁纸的（读数：切到 B 之后仍是 A 的 5 行、
         `/api/props` 请求数 0）—— 用户第 23 条"配置窗口开着时切壁纸，面板不刷新"的真实路径。
       · 产物 `ht()`（释放舞台 / 关掉自带壁纸）只把面板 hidden 掉、**不清行** ⇒ 未选择壁纸时上一张的
         `ui_browse_properties_scheme_color` 等行仍然占着面板 —— 用户第 25 条。
     修法：面板内容 = f(当前 item)，状态机归本层（`unselected | reading | ok | none | error`，
     落在 `#props[data-bench-props-state]`，探针可读）：
       ① 点列表项时在**捕获阶段**（先于产物 `li.onclick` 的挂载链）清空上一张的行 + 写 reading
          + 保证 `hidden` 已摘（产物才会自己重读）⇒ 产物读完画回来的必然是新那张，不会互相覆盖；
       ② 收起期间切过壁纸 ⇒ 展开时清空 + 调**产物自己的** `#toggle-props` 处理器强制重读（唯一重读入口）；
       ③ 释放舞台 ⇒ `unselected`：零残留行 + "还没有选择壁纸"空态；
       ④ 拿到回执（行/提示出现，或 `#props-state` 变红 = 读失败）⇒ 落 ok / none / error 并跑装饰。
     "正在读 / 读失败 / 无属性"三态的**文案**仍由产物自己的 `#props-state` 负责（读取中… / 读取失败：…
     / 该壁纸未声明可自定义项）；本层只保证"读到之前面板里没有上一张的行"。
     ⚠ 观察者纪律（本文件踩过两次自激）：所有写 DOM 的路径都先比状态/签名，同值不写。 */
  const propsEl = q('#props'), propsBody = q('#props-body')
  const PROPS_RAW = propsRawMode((typeof location !== 'undefined' && location.search) || '')
  const PROPS_STATE_ATTR = 'data-bench-props-state'
  let propsState = 'unselected'
  let propsShownItem = null            // 面板当前**内容**属于哪个 item（产物那套 readId 是本模块私有的，读不到）
  let propsReadSeq = 0
  let propsPoll = null, propsDeadline = null, propsUnselectTimer = null
  let propsForced = false
  /* 目标与"粘性当前项"（实测：点列表项后 t+6ms 列表被产物重画成**4 项且一个 `.active` 都没有**，
     t+70ms 才画回 22 项 + `.active`）—— 只看 DOM 会在那个窗口里把面板误判成"未选择"。 */
  let propsPendingItem = null          // 刚点了、还没落地的目标
  let propsStickyItem = null           // 最近一次真的看到过的 `.active`（重画瞬间兜底）

  function propsActiveItemId() {
    const li = listEl ? listEl.querySelector('li[data-id].active') : null
    return li ? String(li.dataset.id || '') : null
  }
  /** 面板该显示的 item：目标 > DOM 里的 active > 粘性值。 */
  function propsResolvedItem() { return propsPendingItem || propsActiveItemId() || propsStickyItem || null }
  function notePropsActive(domActive) {
    if (!domActive) return
    propsStickyItem = domActive
    if (propsPendingItem && domActive === propsPendingItem) propsPendingItem = null    // 目标落地
  }
  function cancelPropsUnselect() {
    if (propsUnselectTimer) { clearTimeout(propsUnselectTimer); propsUnselectTimer = null }
  }
  function propsUnselect() {
    cancelPropsUnselect()
    propsPendingItem = null
    propsStickyItem = null
    clearPropsBody()
    propsShownItem = null
    /*  ①(P-228f 2026-10-05) **项数也要清**：`#props-state` 由产物在"读属性"时写成「47 项」，
        叉掉壁纸这条路没人回头清它 ⇒ 面板空了、右上角还挂着上一张的项数（真机读数）。 */
    const st = q('#props-state')
    if (st) { try { st.textContent = '' } catch (e) { /* 桩 DOM */ } }
    setPropsState('unselected')
    paintPropsEmpty()
    return propsState
  }
  /** 属性行 = **任意深度**的 `.prop` / `.prop-group` / `.prop-text`。
   *  ⚠ 不能只看 `#props-body` 的直接子节点：产物把 `ptype:"group"` 声明的项装进
   *  `<details class="prop-group"><div class="prop-group-body">…` ⇒ 绝大多数行都在组里，
   *  只遍历顶层会漏掉它们（实测：15 个取色行里只装饰到 1 个）。 */
  function propsRows() {
    if (!propsBody) return []
    return [...propsBody.querySelectorAll('.prop, .prop-group, .prop-text')]
  }
  /** "看得见"= 自己没被隐藏名单收掉、祖先组也没被收掉（不用几何：面板收起时几何恒 0）。 */
  function propsVisibleRows() {
    return propsRows().filter((el) => {
      if (el.hidden) return false
      const g = el.closest ? el.closest('.prop-group') : null
      return !(g && g !== el && g.hidden)
    })
  }
  function propsHasNote() { return !!(propsBody && propsBody.querySelector('.prop-hint')) }
  /** 读失败的唯一信号：产物 `L(msg, true)` 会把 `#props-state` 染成内联红色（文案随语言变，颜色不变）。 */
  function propsReadFailed() {
    const el = q('#props-state')
    return !!(el && el.style && el.style.color)
  }
  function setPropsState(s) {
    if (propsState === s) return s
    propsState = s
    try { if (propsEl) propsEl.setAttribute(PROPS_STATE_ATTR, s) } catch {}
    return s
  }
  /* ④(P-228f 2026-10-05) **勾选框关→开会把面板滚回顶部**：产物在属性变化后会整块重画
     `#props-body`（`innerHTML` 一换 `scrollTop` 就归零），所以有的行看着跳、有的不跳
     （取决于那次变化有没有触发重画 / 重画时列表高度差多少）。这里在 change 那一拍记下滚动位置，
     并在随后 ~600ms 内把位置写回（产物的重画可能延后一到几拍）。不碰选择/换壁纸那条路。 */
  {
    const host = q('#props'), body = propsBody
    if (host && body && host.addEventListener && typeof requestAnimationFrame === 'function') {
      let keep = null, deadline = 0
      const step = () => {
        if (keep === null || Date.now() > deadline) { keep = null; return }
        try { if (Math.abs(body.scrollTop - keep) > 0.5) body.scrollTop = keep } catch (e) { /* 桩 DOM */ }
        try { requestAnimationFrame(step) } catch (e) { keep = null }
      }
      host.addEventListener('change', () => {
        keep = body.scrollTop
        deadline = Date.now() + 600
        try { requestAnimationFrame(step) } catch (e) { keep = null }
      }, true)
    }
  }
  function clearPropsBody() {
    if (!propsBody) return 0
    let n = 0
    while (propsBody.firstChild) { propsBody.removeChild(propsBody.firstChild); n++ }
    return n
  }
  /** `hidden` 只当"产物眼里的收起标志"用（视觉收起是我们自己的类）：面板可见时必须为 false，
   *  否则产物在下次切换时跳过重读 —— 那正是第 23 条的根因。 */
  function syncPropsHidden() {
    if (!propsEl) return
    try {
      if (propsCollapsedNow()) propsEl.setAttribute('hidden', '')
      else propsEl.removeAttribute('hidden')
    } catch { /* 桩 DOM */ }
  }
  function paintPropsEmpty() {
    if (!propsEl || !propsBody) return
    // ①(修正 2026-09-17) **必须先排除我们自己插的空态节点**再判断"有没有内容"：
    //   否则 空态 = 子节点 → 判成"有内容" → 删掉空态 → 又变空 → 再插…… MutationObserver 自激成死循环
    //   （真机表现：页面 load 卡死、探针超时）。空态节点不算内容，判据里直接滤掉。
    const kids = [...propsBody.children].filter((el) => el.id !== 'props-empty')
    const has = kids.length > 0
    syncPropsHidden()
    let empty = propsBody.querySelector('#props-empty')
    //  ①(修正 2026-09-17) 状态一致就不写 DOM（同样的观察者互激问题：写 → 观察者 → 再写）
    if (has || propsState !== 'unselected') { if (empty) empty.remove(); return }
    if (empty && empty.dataset.state === curLang()) return
    if (!empty) {
      empty = D.createElement('div'); empty.id = 'props-empty'; empty.className = 'props-empty'
      empty.innerHTML = ''
      const a = D.createElement('strong'); a.textContent = tr(curLang(), 'props.emptyState')
      const b = D.createElement('span'); b.textContent = tr(curLang(), 'props.emptyHint')
      empty.appendChild(a); empty.appendChild(b); propsBody.appendChild(empty)
    } else {
      if (empty.firstChild) empty.firstChild.textContent = tr(curLang(), 'props.emptyState')
      if (empty.lastChild) empty.lastChild.textContent = tr(curLang(), 'props.emptyHint')
    }
    try { empty.dataset.state = curLang() } catch {}
  }

  /* ── 装饰：隐藏名单（#18）/ 富文本（#26 #28）/ 占位颜色（#27）/ 数值（#34）/ 外链（#30） ───────── */
  function propRowMeta(row) {
    const title = String((row && row.getAttribute && row.getAttribute('title')) || '')
    const i = title.lastIndexOf(' · ')
    return i > 0 ? { name: title.slice(0, i), ptype: title.slice(i + 3) } : { name: '', ptype: '' }
  }
  /* ①B(P-201) **内部/编辑器自带行**的谓词（不再是"这一组的内容"）。
     改前它决定"哪些**属性行**属于渲染器设置组"⇒ 真语料只能命中 `schemecolor` 一条，用户要的那几项
     （Flip / 颜色选项 / 亮度…）**根本不在 `project.json` 里** ⇒ 结构上列不出来（见 `WE_RENDERER_ITEMS`
     上面那段）。现在它的唯一用途：认出"WE 编辑器自动加、与作者内容无关"的行（今天实测只有 `schemecolor`：
     `allwallpaper` 22/22 张壁纸都有它，名字与 `ui_browse_properties_scheme_color` 对得上），
     好让它们**继续按隐藏名单藏起来**（`weAdoptHiddenRows` 把它们搬到组体尾部）并**不进**这一组的计数。
     判据（数据驱动，不猜）：
       · 属性名是 WE 编辑器自动加的那几个（`schemecolor`）；或
       · 属性名是 WE 的"视觉条/音频条"族（`visual_bar_*` / `audio_bar_*`：WE 编辑器生成，不是作者手写）；或
       · 该行渲染出来的**文案就是 WE 的 UI 键**（`ui_browse_properties_*` / `ui_settings_*`）。
     反例（必须**不**进）：`newproperty12`、`bgm`、`time`、作者自定的任何名字 —— 它们是这张壁纸自己的项。 */
  const WE_BUILTIN_PROP_NAMES = new Set(['schemecolor'])
  const WE_BUILTIN_PROP_RE = /^(visual_bar|audio_bar|bar_visualizer)/i
  const WE_BUILTIN_TEXT_RE = /ui_(browse_properties|settings)_[a-z0-9_]+/i
  function isWeBuiltinPropRow(row) {
    if (!row) return false
    const n = propRowMeta(row).name || ''
    if (n && WE_BUILTIN_PROP_NAMES.has(n.toLowerCase())) return true
    if (n && WE_BUILTIN_PROP_RE.test(n)) return true
    try { if (WE_BUILTIN_TEXT_RE.test(String(row.textContent || ''))) return true } catch { /* 桩 DOM */ }
    return false
  }
  /** 「渲染器设置」分组的折叠状态（localStorage；缺省**展开** —— 用户要的是"能折起来"，不是默认藏掉）。
   *  ⚠ 常量名**不许**带 `key`/`token` 这类词 + ≥20 字符的字符串字面量：`tests/secret-scan-test.mjs` 的
   *  `assigned-credential-ext` 规则会把它当"赋值的凭据"抓红（它只是 localStorage 的**键名**）。
   *  这里与文件里其余 localStorage 常量统一用 `_LS` 后缀。 */
  const WE_GROUP_COLLAPSED_LS = 'bench-props-we-collapsed'
  function weGroupCollapsed() {
    try { return String(localStorage.getItem(WE_GROUP_COLLAPSED_LS) || '') === '1' } catch { return false }
  }
  /* ── ①E(用户第 3 档：**任何一张图在整个面板里只画一次**) 面板侧接线 ──────────────────────────────
     两层回退（优先级从高到低，判据在 `tests/bench-issue0924a-line-A-test.mjs` 与 `bench-props-text-test.mjs`）：
       ① `?propimg=once|row|all`（URL 档，**最高**：排障/对照必须可复现，见 `planRichImageMode`）；
       ② 缺省 `once` = **整面板去重**（用户第 3 条：「图片去重默认全部都去重」）。
       ⚠ ③(2026-09-24 用户第 3 条) 原来夹在中间的那层"面板可见开关 + localStorage 偏好"**已删**
       （控件连同描述文字一起从面板上删掉了）—— 详见 `richImageModePlan()` 上面那段。
     归并只发生在**渲染期**（tokenizer 语义不动）：账本 `richImagePass` 一整趟渲染共用一份。 */
  let richImagePass = makeRichImagePass({})
  /** 当前正在装饰的属性行序号（`mode='row'` 时作为去重 scope；由 `decoratePropsBody` 逐行推进）。 */
  let richImageScope = 0
  /** 账本对应的壁纸 id（换壁纸才重建；同一张壁纸的重画共用同一份账本，探针读到的 report 才是完整的）。 */
  let richImagePassItem = null
  /** 作者原文（富文本被我们换成节点后，原始字符串只在这里有一份 ⇒ 换档时能**原地重画**，立刻生效）。 */
  const RICH_TEXT_SRC = new WeakMap()
  /** ②(2026-09-25 用户第 2 条) 尺寸证据**只进台账**：DOM 侧在首画/load/error 时把
   *  `naturalWidth/naturalHeight` 记进账本（`report().variants.evidence`），**不再决定画不画**。 */
  function recordImageSize(url, im) {
    if (!richImagePass) return null
    const w = Number(im && im.naturalWidth) || 0
    const h = Number(im && im.naturalHeight) || 0
    return richImagePass.sizeEvidence(url, { w, h, ok: !!(im && im.complete) && w > 0 && h > 0 })
  }
  /** 档位解析（**唯一权威点**）：URL 档 > **缺省 `once`（= 整面板去重，也就是"全部都去重"）**。
   *  ⚠③(2026-09-24 用户第 3 条「图片去重默认**全部都去重**，并把壁纸配置页面上方那个图片去重下拉栏
   *  连同描述文字一起删掉」)：**第二层"面板开关 + localStorage 偏好"整层删掉** ——
   *    · 控件（`#bench-imgmode` 三档 + `#bench-imgmode-note` 那行描述）已从面板上删掉，
   *      没有写入者 ⇒ 再读 `localStorage` 只会让"上个版本点过 `全部（不去重）`"的陈旧偏好
   *      继续压过缺省，用户看到的就不是"默认全部都去重"；
   *    · URL 档（`?propimg=once|row|all`）**原样保留**：它是排障/对照口，也是既有门禁 B7 的对照档。
   *  URL 读点必须是这一串 `new URLSearchParams(location.search).get('propimg')`
   *  （`?propimg=` 登记在 `docs/README-DIAGNOSTICS.md` 的「补丁层开关」区）。 */
  function richImageModePlan() {
    let url = ''
    try { url = String(new URLSearchParams(location.search).get('propimg') || '') } catch { /* 无 location */ }
    return planRichImageMode({ url })
  }
  function richImageMode() { return richImageModePlan().mode }
  /** 新账本（换壁纸/换档/整面板重画时）：整面板重新算一遍"这张画面第一次出现在哪一行"。 */
  function newRichImagePassFor(mode, item) {
    richImagePass = makeRichImagePass({ mode })
    richImagePassItem = item
    return richImagePass
  }
  /** 一行**是不是可见行**（`#props-body` 里被我们按内部项名单藏掉的行、以及被 condition 藏掉的行）。
   *  去重账本只吃可见行：不可见行里的图不该"占掉"这一张画面的第一次出现（否则可见行会被压掉、
   *  用户反而看不到图 —— 真机边界，见 `sweepPanelImages()`）。 */
  function rowVisible(row) {
    if (!row) return false
    if (row.hidden) return false
    let p = row.parentNode
    while (p && p !== propsBody) { if (p.hidden) return false; p = p.parentNode }
    return true
  }
  /** ②(2026-09-25 用户第 2 条) 面板图片账的**唯一权威**：按 **DOM 顺序**扫一遍面板里所有 `<img>`
      （两个来源：产物自己渲染的 `div.prop-media img` + 从属性文案 tokenize 出来的 `img.bench-prop-img`），
      每张画面**只留第一份**、其余藏掉；随后处理链接（已经画成图的那条、以及被压掉后变成空壳的那条）。
      ── 为什么是"扫一遍"而不是"边渲染边判"（真机踩过） ────────────────────────────────────
      产物会**局部重画**面板（部分行被换掉、部分行还在）。逐行 `take()` 的账本在这种情况下会失真：
      留"第一份"的那个节点随着旧行一起消失了，而新行里的副本按旧账被当成重复藏掉 ⇒ 面板上一张图都没有
      （真机读数 `imgs: [] / dupSuppressed: 13`，就是 `bench-ui-headless` P5c 抓到的）。
      ⇒ 改成：**先全部恢复可见、再按 DOM 顺序重算**。它是幂等的（可以随便重跑），
      而且账本永远与 DOM 一致（`propsImages()` 不会再报"report 全 0 而 DOM 有图"）。
      ── 顺带把"画面身份"放宽到用户要的程度 ────────────────────────────────────────────────
      同一身份键（只差处理类参数/后缀/尺寸标记/http-https/www.）⇒ 无条件归并（见 `makeRichImagePass`）。 */
  function sweepPanelImages() {
    if (!propsBody) return { seen: 0, kept: 0, hiddenImgs: 0, hiddenLinks: 0 }
    /*  ⓪ 账本重建（**从 DOM 重算**，不继承上一趟的任何判断）。 */
    newRichImagePassFor(richImageMode(), propsActiveItemId() || richImagePassItem)
    /*  ① 恢复：上一趟藏掉的图片与链接先全部放出来（幂等的前提；同一拍内完成 ⇒ 不会闪）。 */
    for (const im of propsBody.querySelectorAll('img[data-bench-img-dup]')) {
      try { im.hidden = false; delete im.dataset.benchImgDup; delete im.dataset.benchImgDupReason } catch { /* 桩 DOM */ }
    }
    for (const a of propsBody.querySelectorAll('a[data-bench-link-dup], a[data-bench-link-empty]')) {
      try { a.hidden = false; delete a.dataset.benchLinkDup; delete a.dataset.benchLinkEmpty } catch { /* 桩 DOM */ }
    }
    /*  ② 图片：DOM 顺序 = 优先级（先到的那一份留下；产物的 `.prop-media` 通常排在文案前 ⇒ 留它，
        它自带 `<a href>` 包裹）。只吃**可见行**里的图（隐藏行不参与 —— 否则"第一份"会留在看不见的行里）。 */
    const imgs = [...propsBody.querySelectorAll('img')].filter((im) => {
      const row = im.closest ? (im.closest('.prop, .prop-text') || im.parentNode) : null
      return !im.hidden && rowVisible(row)
    })
    let hiddenImgs = 0
    for (const im of imgs) {
      const src = String(im.getAttribute('src') || '')
      if (!src) continue
      /*  尺寸证据（只进台账）：已经加载完的当场记；没加载完的挂 load/error 补记。 */
      if (im.complete) recordImageSize(src, im)
      else if (typeof im.addEventListener === 'function' && !im.dataset.benchImgWatch) {
        try { im.dataset.benchImgWatch = '1'; im.addEventListener('load', () => recordImageSize(src, im)); im.addEventListener('error', () => recordImageSize(src, im)) } catch { /* 桩 DOM */ }
      }
      const v = richImagePass.take(src, 0)
      if (v.draw) continue
      try { im.hidden = true; im.dataset.benchImgDup = '1'; im.dataset.benchImgDupReason = v.reason || 'duplicate' } catch { /* 桩 DOM */ }
      hiddenImgs++
      richImagePass.note('img-duplicate', src)
    }
    /*  ③ 链接：① 目标就是"已经画成图的那张画面" ⇒ 压掉（重复展示）；
        ② 图片被压掉之后锚内**没有别的可见内容** ⇒ 整条空壳链接也不画
        （用户原话："那个链接已经显示出来过一遍了……不用再把那个链接展示出来了，把链接也去掉"）。 */
    let hiddenLinks = 0
    const anchors = [...propsBody.querySelectorAll('a')]
    for (const a of anchors) {
      const href = String(a.getAttribute('href') || '')
      if (!href) continue
      if (a.hidden) continue
      if (richImagePass.shouldSuppressLink(href)) {
        try { a.hidden = true; a.dataset.benchLinkDup = '1' } catch { /* 桩 DOM */ }
        richImagePass.note('link-suppressed', href); hiddenLinks++
        continue
      }
      const hasImg = [...a.querySelectorAll('img')].some((im) => !im.hidden)
      const text = String(a.textContent || '').replace(/\s+/g, '')
      if (!hasImg && !text) {
        try { a.hidden = true; a.dataset.benchLinkEmpty = '1' } catch { /* 桩 DOM */ }
        richImagePass.note('link-empty', href); hiddenLinks++
      }
    }
    return { seen: imgs.length, kept: imgs.length - hiddenImgs, hiddenImgs, hiddenLinks }
  }
  /** 探针：真面板上的图片渲染读数（**两个来源都算**）。
   *  · `rendered` = 面板里**看得见**的 `<img>` 总数（产物 `prop-media` + 本补丁 `bench-prop-img`）；
   *  · `ours` / `media` = 两个来源各自的**可见**张数；`hiddenDup` = 被本账压掉的张数（两来源合计）；
   *  · `links` = 看得见的 `a.bench-prop-link`；`linksHiddenDup` = 因空壳被藏掉的链接数；
   *  · `report` = 账本（`variants.evidence` 是"合并时尺寸相同/不同/未知"的如实计数）。
   *  不变量（门禁 B7）：`once` 档下 `rendered === report.groups.length`。 */
  function propsImages() {
    const all = propsBody ? [...propsBody.querySelectorAll('img')] : []
    const ours = all.filter((im) => im.classList && im.classList.contains('bench-prop-img'))
    const media = all.filter((im) => im.closest && im.closest('div.prop-media'))
    const inVisibleRow = (im) => { try { return rowVisible(im.closest('.prop, .prop-text') || im.parentNode) } catch { return false } }
    const visible = all.filter((im) => !im.hidden && inVisibleRow(im))
    return {
      mode: richImageMode(),
      modeSource: richImageModePlan().source,
      modeForced: richImageModePlan().forced,
      rendered: visible.length,
      ours: ours.filter((im) => !im.hidden).length,
      media: media.filter((im) => !im.hidden).length,
      hiddenDup: all.filter((im) => im.dataset && im.dataset.benchImgDup === '1').length,
      probes: 0,
      unmerged: all.filter((im) => im.dataset && im.dataset.benchImgUnmerged === '1').length,
      srcs: visible.map((im) => String(im.getAttribute('src') || '')),
      natural: all.map((im) => ({ w: Number(im.naturalWidth) || 0, h: Number(im.naturalHeight) || 0, complete: !!im.complete, hidden: !!im.hidden })),
      report: richImagePass ? richImagePass.report() : null,
      links: propsBody ? [...propsBody.querySelectorAll('a.bench-prop-link')].filter((a) => !a.hidden).length : 0,
      linksHiddenDup: propsBody ? [...propsBody.querySelectorAll('a[data-bench-link-dup], a[data-bench-link-empty]')].filter((a) => a.hidden).length : 0,
    }
  }
  /* ── ③(2026-09-24 用户第 3 条) **面板上的图片去重控件已整块删除** ────────────────────────────────
     删掉的是：`#bench-imgmode-wrap`（标题「图片去重」+ 三档原生 `<select>`）+ `#bench-imgmode-note`
     （那行描述文字本身也超出去了）+ 它的 `change` 处理（写 localStorage 偏好 + 立刻重画 + 写日志）。
     保留的是：缺省档（`once` = 整面板去重 = 用户要的"全部都去重"）、URL 对照档（`?propimg=`）、
     账本读数（`propsImages()` 的 `mode/modeSource/duplicatesSkipped`，门禁 B7 仍在断言它）。
     判据：`tests/bench-issue0924a-line-A-test.mjs` 的 A3（源码里 0 个 `#bench-imgmode`；
     DOM 里 0 个该节点；缺省 `propsImages().mode === 'once'` 且 `duplicatesSkipped > 0`）。 */
  function paintImgModeControl() { return richImageModePlan() }     // 名字保留：调用面（换壁纸/重画）不动，但不再有 DOM 写入

  /** 换档/换语言后**原地重画**面板里的富文本（作者原文存在 `RICH_TEXT_SRC`，不重挂壁纸）。
   *  返回重画了几个标签元素。 */
  function redrawPropsRich() {
    if (!propsBody) return 0
    const plan = richImageModePlan()
    newRichImagePassFor(plan.mode, richImagePassItem)
    let n = 0, rowIdx = 0
    for (const row of propsRows()) {
      richImageScope = rowIdx++
      for (const el of propLabelEls(row)) {
        const raw = RICH_TEXT_SRC.get(el)
        if (raw == null) continue
        const frag = propRichFragment(parsePropRichText(raw))
        el.textContent = ''
        if (frag) el.appendChild(frag)
        n++
      }
    }
    try { armRichImageProbeTimer() } catch { /* 桩 */ }
    paintImgModeControl()
    return n
  }
  /* ── ①B(P-201 2026-09-25 用户「WE 自带选项只显示有一项，而且展不开」) **固定清单 + 真驱动** ──────────
     改前（P-201 之前）：这一组是把**当前壁纸的属性行**里"像 WE 内置项"的挑出来收进一个可折叠壳
     （谓词 `isWeBuiltinPropRow`，采集 `propsRows().filter(...)`）。真语料 22/22 包只有 `schemecolor`
     一条会被命中，而它同时又在 `PROPS_HIDDEN_NAMES` 里 ⇒ 表头报「1 项」、点开一行都看不见
     （真机读数 `{"weCount":1,"weNames":["schemecolor"],"collapsed":false}`）。更根本的是：用户说的
     Flip / Show color options / 亮度·对比度·饱和度·色调偏移 / 播放速度**根本不在 `project.json` 里**
     ⇒ 从属性行里"分类"这条路结构上列不出它们。

     改后：这一组由补丁**自己画** `WE_RENDERER_ITEMS`（模块级固定清单，每张壁纸一样），
     `status:'impl'` 的每一项直接调渲染器 API（`__wp.setDisplay` / `setPlaybackRate` / `setVolume`），
     其余项**照实写一行**（未实现 / WE 客户端自带 / 本页实现在别处）—— 不静默少项。
     `.prop`/`.prop-text` 这些**产物行**一个都不再搬进来（`data-we-item` 才是本组的项）：
     于是 `propsRows()` / `propsPanelState()` / 门禁 P3-P4 的口径逐字不变。 */

  /** 预览 iframe 里的渲染器 API（`__wp`）。
   *  ⚠ 作用域纪律：`initNavSound` 的 `stageEl`/`stageApi()` 在这里**不存在**（两个函数，跨作用域就是
   *  一次被 try/catch 吞掉的 ReferenceError）⇒ 现查 `#frame`。跨源 / 未挂载 / 还没发布 `__wp` ⇒ null
   *  （调用方如实说"渲染器未就绪"，绝不假装可用）。 */
  function rendererWp() {
    try {
      const fr = q('#frame')
      const w = fr && fr.contentWindow
      return (w && w.__wp) || null
    } catch { return null }            // 跨源 iframe 读 contentWindow 会抛 ⇒ 如实降级
  }
  /** `navSound` 的 API（音量的**唯一真源**：它落到 `__wp.setVolume` + 工具条 `#volume` + NP 卡片）。
   *  ⚠ `const navSound` 在本函数体**后段**才创建（同一作用域）⇒ 这里用 try 兜住 TDZ 的 ReferenceError；
   *  取不到就退回直连 `__wp.setVolume`（见 `weSetVolume`），绝不抛。 */
  function navSoundApi() { try { return navSound || null } catch { return null } }

  /** 这一组的**可用性**读数（渲染器侧真值；每项一条）。
   *  `ready` = `__wp` 已发布；`legacy` = 渲染器跑在 `?display=legacy`（显示选项整组只读）；
   *  `volume` = 音量落点可用（navSound 或 `__wp.setVolume` 任一在）。 */
  function weRendererState() {
    const wp = rendererWp()
    let st = null
    try { st = (wp && typeof wp.displayState === 'function') ? wp.displayState() : null } catch { st = null }
    const ns = navSoundApi()
    let audio = null
    try { audio = (ns && typeof ns.audio === 'function') ? ns.audio() : null } catch { audio = null }
    const avail = {
      setDisplay: !!(wp && typeof wp.setDisplay === 'function'),
      setPlaybackRate: !!(wp && typeof wp.setPlaybackRate === 'function'),
      setVolume: !!((ns && typeof ns.setVideoVolume === 'function') || (wp && typeof wp.setVolume === 'function')),
    }
    const values = {
      flipH: !!(st && st.flipH),
      colorOptions: !(st && st.colorOptions === false),
      brightness: st && Number.isFinite(Number(st.brightness)) ? Number(st.brightness) : 1,
      contrast: st && Number.isFinite(Number(st.contrast)) ? Number(st.contrast) : 1,
      saturation: st && Number.isFinite(Number(st.saturation)) ? Number(st.saturation) : 1,
      hue: st && Number.isFinite(Number(st.hue)) ? Number(st.hue) : 0,
      playbackRate: st && Number.isFinite(Number(st.playbackRate)) ? Number(st.playbackRate) : 1,
      volume: audio && Number.isFinite(Number(audio.vol)) ? Number(audio.vol) : 0,
    }
    return { ready: !!(wp && avail.setDisplay), legacy: !!(st && st.legacy === true), avail, values, hasState: !!st }
  }
  /** 数值控件的显示文本（`1.5×` / `20°` / `0.25`）——只保留有效小数位，避免 `1.0000000000000002`。 */
  function weValueText(item, v) {
    const n = Number(v)
    const step = Number(item && item.step) || 0
    const dec = step > 0 && step < 1 ? String(step).split('.')[1].length : 0
    const txt = Number.isFinite(n) ? String(Number(n.toFixed(dec))) : String(v)
    return txt + String((item && item.suffix) || '')
  }
  /** 把一个清单项的值写进渲染器（**唯一驱动点**）。返回 `{ ok, api, sent }`；不可用 ⇒ `ok:false` + 原因。 */
  function weApplyItem(item, raw) {
    const it = item || {}
    if (it.status !== 'impl') return { ok: false, reason: 'not-impl', api: '' }
    const wp = rendererWp()
    if (it.api === 'setVolume') {
      const v = Math.max(0, Math.min(1, Number(raw)))
      const ns = navSoundApi()
      if (ns && typeof ns.setVideoVolume === 'function') return { ok: true, api: 'setVolume', sent: ns.setVideoVolume(v) }
      if (wp && typeof wp.setVolume === 'function') { try { wp.setVolume(v); return { ok: true, api: 'setVolume', sent: v } } catch (e) { return { ok: false, reason: 'throw', api: 'setVolume' } } }
      return { ok: false, reason: 'no-renderer', api: 'setVolume' }
    }
    if (!wp) return { ok: false, reason: 'no-renderer', api: String(it.api || '') }
    try {
      if (it.api === 'setDisplay') {
        if (typeof wp.setDisplay !== 'function') return { ok: false, reason: 'no-cap', api: 'setDisplay' }
        const val = it.kind === 'bool' ? !!raw : Number(raw)
        wp.setDisplay({ [it.arg]: val })
        return { ok: true, api: 'setDisplay', sent: val }
      }
      if (it.api === 'setPlaybackRate') {
        if (typeof wp.setPlaybackRate !== 'function') return { ok: false, reason: 'no-cap', api: 'setPlaybackRate' }
        const val = Number(raw)
        wp.setPlaybackRate(val)
        return { ok: true, api: 'setPlaybackRate', sent: val }
      }
    } catch (e) { return { ok: false, reason: 'throw', api: String(it.api || '') } }
    return { ok: false, reason: 'unknown-api', api: '' }
  }
  /** 组里的**可见项**元素 = 固定清单画出来的行（`[data-we-item]`）里**没被隐藏**的那些。
   *  ⚠ 这就是用户那条"表头报 1 项、点开是空的"的判据面：**计数与"看得见的行"必须是同一个集合**。
   *  被隐藏的内部行（见 `weAdoptHiddenRows`）与不可用项**绝不**计数 —— 把它们算进来就会重演那个 bug。
   *  折叠（`display:none` 由组壳决定）是另一条轴：收起来时行还在，只是整组不显示。 */
  function weVisibleItems(group) {
    if (!group || !group.querySelectorAll) return []
    return [...group.querySelectorAll('[data-we-item]')].filter((el) => !el.hidden)
  }
  /** 内部/编辑器自带行（`schemecolor` 这类，见 `isWeBuiltinPropRow`）的落点：它们**不进**这一组，
   *  仍然按隐藏名单藏起来，只是搬进组体的尾部 —— 这样"隐藏行"这一事实有唯一读数面
   *  （`propsGroups().weHiddenAdopted`），而它们不占作者项列表的一行。`hidden` 行**不计数**。 */
  function weAdoptHiddenRows(group, body) {
    let n = 0
    for (const el of propsRows()) {
      if (!el || !el.classList || !(el.classList.contains('prop') || el.classList.contains('prop-text'))) continue
      if (el.parentNode === body) { if (el.hidden) n++; continue }
      if (!el.hidden || !isWeBuiltinPropRow(el)) continue
      try { body.appendChild(el); n++ } catch { /* 桩 DOM */ }
    }
    return n
  }
  /** 把 `weAdoptHiddenRows` 收进来的**产物行**放回 `#props-body`（组要重建/撤掉时**先**调它）。
   *  ⚠ 不这么做就是"组一重建就连带把它删掉"——那是**丢作者的行**（产物的元素引用会指向游离节点），
   *  哪怕它是隐藏行也不行。返回搬回去的条数。 */
  function weReleaseAdopted(group, to) {
    if (!group) return 0
    const dest = to || propsBody
    let n = 0
    for (const el of [...group.querySelectorAll('.prop, .prop-text')]) {
      try { dest.appendChild(el); n++ } catch { /* 桩 DOM */ }
    }
    return n
  }
  /** 建组壳 + 固定清单的行（只在"项集/语言/可用性"变了或首次时调；值同步走 `weGroupSync`）。 */
  function weGroupBuild(group, state, sig) {
    const rebuild = !!group
    if (group) { weReleaseAdopted(group); if (group.parentNode) group.parentNode.removeChild(group) }
    group = D.createElement('div')
    group.className = 'bench-props-group bench-we-group'
    group.dataset.group = 'we'
    group.dataset.collapsed = weGroupCollapsed() ? '1' : '0'
    const head = D.createElement('div')
    head.className = 'bench-props-group-head'
    head.setAttribute('role', 'button')
    head.setAttribute('tabindex', '0')
    head.setAttribute('aria-expanded', weGroupCollapsed() ? 'false' : 'true')
    const caret = D.createElement('span')
    caret.className = 'bench-props-group-caret'; caret.textContent = '▾'
    const label = D.createElement('span')
    label.className = 'bench-props-group-label'; label.textContent = tr(curLang(), 'props.weGroup')
    const count = D.createElement('span')
    count.className = 'bench-props-group-count'
    head.appendChild(caret); head.appendChild(label); head.appendChild(count)
    const body = D.createElement('div')
    body.className = 'bench-props-group-body'
    /*  ①B(P-201) **状态行**（只读）：渲染器还没就绪 / 跑在 `?display=legacy` 总回退档时，如实写一句原因
        （用户看得到"为什么这些控件是灰的"，不是一排点不动的死控件）。⚠ 它**不是** `[data-we-item]`
        ⇒ 不进 `weCount`/`weNames`（项数判据不受影响）。 */
    const status = D.createElement('div')
    status.className = 'bench-we-status'
    status.hidden = true
    body.appendChild(status)
    for (const item of WE_RENDERER_ITEMS) body.appendChild(weGroupRow(item, state))
    const hint = D.createElement('div')
    hint.className = 'bench-we-hint'
    hint.textContent = tr(curLang(), 'props.we.hint')
    body.appendChild(hint)
    const toggle = () => {
      const next = !(group.dataset.collapsed === '1')
      group.dataset.collapsed = next ? '1' : '0'
      head.setAttribute('aria-expanded', next ? 'false' : 'true')
      try { localStorage.setItem(WE_GROUP_COLLAPSED_LS, next ? '1' : '0') } catch { /* 隐私模式 */ }
    }
    head.addEventListener('click', toggle)
    head.addEventListener('keydown', (e) => { if (e && (e.key === 'Enter' || e.key === ' ')) { try { e.preventDefault() } catch {} ; toggle() } })
    group.appendChild(head); group.appendChild(body)
    propsBody.insertBefore(group, propsBody.firstChild)     // **排在最前**：WE 自带项在作者项之前
    if (rebuild) group.dataset.weRebuilt = '1'              // 只作诊断（"重画过"与"新建"分开看）
    group.dataset.weSig = sig
    return group
  }
  /** 清单里的一行（bool = 勾选框；range = 滑条 + 数值；note = 只读的一行"照实说明"）。
   *  控件只用 `checkbox` / `range`：面板里**不许**出现未增强的原生 `<select>`（用户第 17 条，门禁 IA7）。 */
  function weGroupRow(item, state) {
    const row = D.createElement('div')
    row.className = 'bench-we-row'
    row.dataset.weItem = String(item.id)
    row.dataset.weStatus = String(item.status)
    row.dataset.weApi = weRendererApiRoute(item)
    const label = D.createElement('span')
    label.className = 'bench-we-label'
    label.textContent = tr(curLang(), 'props.we.' + item.id)
    if (item.kind === 'note') {
      const tag = D.createElement('span')
      tag.className = 'bench-we-tag bench-we-tag-' + String(item.status)
      tag.textContent = tr(curLang(), 'props.we.status.' + (item.status === 'impl' ? 'other' : item.status))
      const why = D.createElement('span')
      why.className = 'bench-we-why'
      why.textContent = tr(curLang(), 'props.we.why.' + item.id)
      row.appendChild(label); row.appendChild(tag); row.appendChild(why)
      row.dataset.weAvail = '0'
      //  行级 tooltip：状态 + 原因（窄面板下 `.bench-we-why` 会省略号，悬停看全）
      try { row.setAttribute('title', label.textContent + ' · ' + tag.textContent + ' · ' + why.textContent) } catch { /* 桩 DOM */ }
      return row
    }
    const ctl = D.createElement('span')
    ctl.className = 'bench-we-ctl'
    let input = null
    if (item.kind === 'bool') {
      input = D.createElement('input')
      input.type = 'checkbox'
      input.id = 'bench-we-' + item.id
      input.addEventListener('change', () => { weItemChanged(item, !!input.checked) })
    } else {
      input = D.createElement('input')
      input.type = 'range'
      input.id = 'bench-we-' + item.id
      input.min = String(item.min); input.max = String(item.max); input.step = String(item.step)
      input.addEventListener('input', () => { weItemChanged(item, Number(input.value)) })
    }
    const val = D.createElement('span')
    val.className = 'bench-we-val'
    ctl.appendChild(input)
    if (item.kind === 'range') ctl.appendChild(val)
    const api = D.createElement('span')
    api.className = 'bench-we-api'
    api.textContent = weRendererApiRoute(item)
    row.appendChild(label); row.appendChild(ctl); row.appendChild(api)
    row.dataset.weAvail = state.avail[item.api] ? '1' : '0'
    /*  行级 tooltip = **完整驱动落点**（窄面板下 API chip 会省略号；`data-we-api` 是同一份的机读面）：
        「名称 · __wp.setDisplay({flipH})」/「音量 · __wp.setVolume(v)」… */
    try { row.setAttribute('title', label.textContent + ' · ' + weRendererApiRoute(item)) } catch { /* 桩 DOM */ }
    return row
  }
  /** 用户改了某一项：**立即**驱动渲染器（唯一驱动点 `weApplyItem`），随后把值/可用性对账一次。
   *  失败（渲染器没就绪 / 该档不认这个 API）⇒ 如实记在行上（`data-we-err`）并写一行日志，不静默。 */
  function weItemChanged(item, value) {
    const r = weApplyItem(item, value)
    const st = weRendererState()
    if (!r.ok) {
      try { log(t(curLang(), 'props.we.notReady')) } catch { /* 日志不可用 */ }
    }
    try { groupWeBuiltinProps() } catch { /* 下一拍会补 */ }
    return { item: String(item.id), ok: !!r.ok, api: r.api, sent: r.sent === undefined ? null : r.sent, value: value, state: st }
  }
  /** 把渲染器侧的值/可用性对账进已有的行（**幂等**：值没变一个字节都不写 —— 与 `paintPropsEmpty`
   *  同一条防互激纪律；`propsBody` 上有 childList 观察者，写多了会自激）。 */
  function weGroupSync(group, state) {
    const n = weVisibleItems(group).length
    /*  状态行：`legacy`（总回退）> 未就绪 > 无（正常时**必须**藏起来且清空 —— 不许对正常状态误报）。 */
    const stEl = group.querySelector('.bench-we-status')
    if (stEl) {
      const key = state.legacy ? 'props.we.legacy' : (!state.ready ? 'props.we.notReady' : '')
      const txt = key ? tr(curLang(), key) : ''
      if (stEl.hidden !== !key) stEl.hidden = !key
      if (stEl.textContent !== txt) stEl.textContent = txt
    }
    const cnt = group.querySelector('.bench-props-group-count')
    const want = t(curLang(), 'props.count', { n })
    if (cnt && cnt.textContent !== want) cnt.textContent = want
    for (const row of group.querySelectorAll('[data-we-item]')) {
      const item = WE_RENDERER_ITEMS.find((x) => x.id === row.dataset.weItem)
      if (!item || item.kind === 'note') continue
      const avail = state.avail[item.api] ? '1' : '0'
      if (row.dataset.weAvail !== avail) row.dataset.weAvail = avail
      const reason = state.legacy ? 'props.we.legacy' : (avail === '0' ? 'props.we.notReady' : '')
      const cur = row.dataset.weWhy || ''
      if (cur !== reason) {
        if (reason) row.dataset.weWhy = reason; else delete row.dataset.weWhy
      }
      const input = row.querySelector('input')
      if (!input) continue
      const v = state.values[item.id]
      if (item.kind === 'bool') {
        const on = !!v
        if (input.checked !== on) input.checked = on
        if (input.disabled !== (avail === '0')) input.disabled = (avail === '0')
      } else {
        const sv = String(v)
        if (input.value !== sv) input.value = sv
        if (input.disabled !== (avail === '0')) input.disabled = (avail === '0')
        const val = row.querySelector('.bench-we-val')
        const txt = weValueText(item, v)
        if (val && val.textContent !== txt) val.textContent = txt
      }
      /*  ⚠ 属性写也要**先比后写**：`propsBody` 上挂着 childList 观察者（80ms 防抖 → `propsSettle`），
          每个属性写都是一条变更记录 ⇒ 无条件写就是一条 12.5Hz 的自激环（实测 2.5s 内 100 条）。 */
      const ev = item.kind === 'bool' ? (v ? '1' : '0') : String(v)
      if (row.dataset.weValue !== ev) row.dataset.weValue = ev
    }
    return n
  }
  /** 渲染器还没就绪时的**自停重试**（与 `armProbe` 同款纪律：有上限、就绪即停、绝不自激）。 */
  let weReadyTries = 0, weReadyTimer = null
  function weArmReadyRetry() {
    if (weReadyTimer || typeof setInterval !== 'function') return weReadyTimer
    weReadyTries = 0
    weReadyTimer = setInterval(() => {
      weReadyTries++
      let ready = false
      try { ready = weRendererState().ready } catch { /* 下一拍再试 */ }
      if (ready || weReadyTries >= 40) { clearInterval(weReadyTimer); weReadyTimer = null; return }
      try { propsSettle() } catch { /* 面板还没就绪 */ }
    }, 500)
    return weReadyTimer
  }
  /** 「渲染器设置（WE 自带）」= **固定清单**画出来的可折叠分组，**放在 `#props-body` 最前**
   *  （用户原话"它上面永远有这几个选项"）。幂等：项集/语言/可用性没变就只对账值，不重建 DOM。 */
  function groupWeBuiltinProps() {
    if (!propsBody) return null
    let group = propsBody.querySelector('.bench-props-group[data-group="we"]')
    /*  什么时候该有这一组：**选了壁纸就有**（用户口径"针对每一张壁纸都有"）——
        判据 = 面板有目标项 / 有产物行 / 有产物自己写的提示行；"未选择壁纸"的空态里**不**画它
        （那时没有渲染器可控，画上去就是一块点不动的死控件；门禁 P3 也要求空态干净）。 */
    const want = !!propsResolvedItem() || propsRows().length > 0 || propsHasNote()
    if (!want) {
      if (group) { weReleaseAdopted(group); group.remove() }
      return { present: false, count: 0, names: [], collapsed: false }
    }
    const state = weRendererState()
    const sig = WE_RENDERER_ITEMS.map((it) => it.id).join('|') + '#' + (weGroupCollapsed() ? 'c' : 'o') + '#' + curLang() +
      '#' + (state.ready ? '1' : '0') + '#' + (state.legacy ? '1' : '0') + '#' + (state.avail.setVolume ? '1' : '0')
    if (!group || group.dataset.weSig !== sig) group = weGroupBuild(group, state, sig)
    const body = group.querySelector('.bench-props-group-body')
    group.dataset.collapsed = weGroupCollapsed() ? '1' : '0'
    const head = group.querySelector('.bench-props-group-head')
    if (head) head.setAttribute('aria-expanded', weGroupCollapsed() ? 'false' : 'true')
    if (body) { try { weAdoptHiddenRows(group, body) } catch { /* 桩 DOM */ } }
    const count = weGroupSync(group, state)
    if (!state.ready) weArmReadyRetry()
    if (group.dataset.weCount !== String(count)) group.dataset.weCount = String(count)
    return { present: true, count, names: weVisibleItems(group).map((el) => String(el.dataset.weItem || '')), collapsed: weGroupCollapsed() }
  }
  /** 探针：面板里"渲染器设置（WE 自带）"分组与作者项的可判据快照（门禁/真机排查同一入口）。
   *  `weCount`/`weNames` **只算可见项**（`weVisibleItems`）—— 改前那个"未过滤 `we.length` +
   *  `body.querySelectorAll('.prop, .prop-text')`"就是用户报的"报 1 项、点开是空的"的读数面。 */
  function propsGroups() {
    const group = propsBody ? propsBody.querySelector('.bench-props-group[data-group="we"]') : null
    const body = group ? group.querySelector('.bench-props-group-body') : null
    const rows = propsRows().filter((el) => el && el.classList && (el.classList.contains('prop') || el.classList.contains('prop-text')))
    const items = weVisibleItems(group)
    const h = (el) => { try { return el.getBoundingClientRect().height > 0 } catch { return false } }
    const cntEl = group ? group.querySelector('.bench-props-group-count') : null
    const st = group ? weRendererState() : null
    return {
      wePresent: !!group, weCount: items.length,
      weNames: items.map((el) => String(el.dataset.weItem || '')),
      weStatus: items.map((el) => String(el.dataset.weStatus || '')),
      weApi: items.map((el) => String(el.dataset.weApi || '')),
      weAvail: items.map((el) => el.dataset.weAvail === '1'),
      weValues: items.reduce((a, el) => { a[String(el.dataset.weItem || '')] = String(el.dataset.weValue == null ? '' : el.dataset.weValue); return a }, {}),
      //  "看得见"的**几何**读数：折叠时整组 `display:none` ⇒ 0（这是"点开是不是空的"的判据面）
      weDrawn: group ? items.filter(h).length : 0,
      weHiddenAdopted: body ? [...body.querySelectorAll('.prop, .prop-text')].filter((el) => el.hidden).length : 0,
      weHeaderCount: cntEl ? String(cntEl.textContent || '') : '',
      weReady: !!(st && st.ready), weLegacy: !!(st && st.legacy),
      collapsed: !!(group && group.dataset && group.dataset.collapsed === '1'),
      firstChildIsWeGroup: !!(propsBody && propsBody.firstChild && propsBody.firstChild === group),
      authorRows: rows.filter((el) => !isWeBuiltinPropRow(el)).length,
      totalRows: rows.length,
    }
  }
  /** 一行的"承载富文本的标签元素"（组容器只认它自己的 `summary`：`querySelectorAll` 会把组内每一项的
   *  文案也串进来 ⇒ 判据会被污染）。`decoratePropRow` 与 `redrawPropsRich`（换档原地重画）共用这一份。 */
  function propLabelEls(row) {
    if (!row) return []
    const isGroup = !!(row.classList && row.classList.contains('prop-group'))
    const summary = isGroup ? [...row.children].find((c) => c.tagName === 'SUMMARY') || null : row.querySelector('summary')
    return isGroup ? (summary ? [summary] : []) : [...row.querySelectorAll('.prop-name, .prop-text-cap')]
  }
  /** token → 节点（只用 createElement/textContent：**结构上**不可能把作者文本变成 HTML/脚本）。 */
  function propRichFragment(tokens) {
    /* ①E(2026-09-24 用户第 2 次提「上面已经展示过的图片，其实就是那张图片链接，再展示一遍」)
       + ②(2026-09-25 issue0924a2 用户第 2 条复测「还是有重复的图片」)
       ── 账本口径（见模块顶部的 `richImageKey` / `makeRichImagePass`）──────────────────────
         ⓐ 逐字节同一资源 ⇒ 只画第一张；
         ⓑ **身份键相同**（只差处理类参数/尺寸/格式/后缀/重传的尺寸标记）⇒ **无条件归并**（强制档）；
         ⓒ 尺寸证据只进台账（`report().variants.evidence`），不再决定画不画。
       ── 这里还做两件"用户点名"的事 ─────────────────────────────────────────────────────
         · **同一个 URL 已经画成图了 ⇒ 那条链接不再单画一遍**（`shouldSuppressLink`，记账可核对）；
         · **空壳链接**：一条 `<a>` 里的图被压掉、且锚内没有别的可见内容 ⇒ 整条链接不画
           （用户原话："那个链接已经显示出来过一遍了……不用再把那个链接展示出来了，把链接也去掉"）。
           判据：先把 kids 走成临时 fragment，**有可见内容（文字/图/换行）才建 `<a>`**。 */
    if (!tokens || !tokens.length) return null
    /*  ⚠(2026-09-25) 这里**不做**去重判定：一律先画出来，可见性由 `sweepPanelImages()` 按 DOM 顺序统一裁定。
        为什么（真机踩过）：产物会**局部重画**面板，边渲染边判的账本会与 DOM 失配（留下"第一份"的节点
        随旧行消失、新行的副本又被当成重复藏掉 ⇒ 一张图都没有）。sweep 是幂等的，账本永远 == DOM。 */
    const frag = D.createDocumentFragment()
    const walk = (list, host) => {
      for (const tok of list || []) {
        if (!tok) continue
        if (tok.k === 'text') { host.appendChild(D.createTextNode(tok.v)); continue }
        if (tok.k === 'br') { host.appendChild(D.createElement('br')); continue }
        if (tok.k === 'font') {
          const sp = D.createElement('span'); sp.className = 'bench-prop-fg'
          try { sp.style.color = tok.color } catch { /* 白名单外的颜色进不来 */ }
          walk(tok.kids, sp); host.appendChild(sp); continue
        }
        if (tok.k === 'link') {
          /*  链接一律先画出来：①"目标就是已经画成图的那张画面"与 ②"锚内没有可见内容（空壳）"
              两种情形都由 `sweepPanelImages()` 事后裁定并藏掉（它能看到全面板的图片归属）。 */
          const a = D.createElement('a')
          a.className = 'bench-prop-link'
          a.href = tok.href; a.target = '_blank'; a.rel = 'noopener noreferrer'
          a.dataset.benchExt = tok.host; a.title = tok.host
          walk(tok.kids, a); host.appendChild(a); continue
        }
        if (tok.k === 'img') {
          const info = externalLinkInfo(tok.src)      // 只渲染 http(s) 图：面板里没有可靠的相对基址
          if (!info.ok) continue
          /* ② 去重判定走账本（键相等 = 同一张画面；**不再**按 `host+path` 归并 —— 真语料
             `dd/3660962877`/`dd/3326873240` 里 `m.qpic.cn/psc` 一个 path 下挂着 4 张**不同**的图，
             身份在 query 的无名段里 ⇒ 那个反例护栏继续成立）。 */
          const wrap = D.createElement('span'); wrap.className = 'bench-prop-imgwrap'
          const im = D.createElement('img'); im.className = 'bench-prop-img'
          im.src = info.href; im.alt = ''; im.referrerPolicy = 'no-referrer'
          im.loading = 'lazy'
          try { im.dataset.benchImgKey = richImageKey(info.href) } catch { /* 桩 DOM */ }
          wrap.appendChild(im); host.appendChild(wrap)
          continue
        }
      }
    }
    walk(tokens, frag)
    return frag.childNodes.length ? frag : null
  }
  function decoratePropRow(row) {
    if (!row || !row.dataset) return false
    const isGroup = !!(row.classList && row.classList.contains('prop-group'))
    const meta = propRowMeta(row)
    //  组容器：只认它自己的 `summary`（`querySelectorAll` 会把组内每一项的文案也串进来 ⇒ 判据会被污染）
    const summary = isGroup ? [...row.children].find((c) => c.tagName === 'SUMMARY') || null : row.querySelector('summary')
    const labelEls = propLabelEls(row)
    const plain = labelEls.map((e) => e.textContent).join('\n')
    const groupName = summary ? String(summary.getAttribute('title') || '') : ''
    /*  ① #18 内置/编辑器内部属性：数据驱动隐藏（`ui_` 前缀 + 明确集合；`?rawprops=1` 全显）
        ⚠(2026-09-25 真机踩到)**必须先判隐藏、再做图片账**：被隐藏的行如果先"抢"走某张画面的
        第一次出现，那张图就留在一个看不见的行里，而所有可见行的同名副本都被压掉 ⇒ 面板上一张图都没有
        （真机读数：`imgs: []` 而 `dupSuppressed: 13`）。隐藏行不参与账本（见 `sweepPanelImages()`
        里的 `rowVisible()`）。 */
    if (!PROPS_RAW) {
      const why = propsHiddenReason({ name: meta.name || groupName, text: plain })
      if (why) { row.hidden = true; row.dataset.benchPropsRow = 'hidden-' + why; return true }
    }
    if (row.dataset.benchPropsRow === 'done') return false
    //  ② #26/#28 富文本：`<img>` 只渲染图、`<font color>` 只给颜色、`<br>` 换行，其余标签剥掉留文字
    for (const el of labelEls) {
      if (el.dataset.benchRich === '1') continue
      const raw = el.textContent                              // 作者原文（换档原地重画要用）
      /* ⚠ K39（`tests/bench-shell-fixes-test.mjs`）钉住：tokenizer 的输入**只能**是 DOM 文本
         `el.textContent`，永远不是 innerHTML —— 作者的标签文本在结构上就没有变成 HTML 的机会。
         所以这里刻意把 `parsePropRichText(el.textContent)` 写在同一行（`raw` 只做记账与判空）。 */
      const toks = parsePropRichText(el.textContent)
      const frag = propRichFragment(toks)
      try { RICH_TEXT_SRC.set(el, raw) } catch { /* 桩 DOM */ }
      /* ①E(2026-09-24 用户第 2/3 条图片去重)**回归**：`propRichFragment` 现在**可能返回 null 而不是空
         fragment** —— 当整行的 token 都被去重压掉时（真语料同一张图 33 次；这一行恰好是"重复的那几行"），
         旧写法 `if (frag)` 会**什么都不做** ⇒ 作者原文里的 `<img src=… width=… height=…>` 原样留在
         DOM 里当文字显示（用户第 26 条的 bug 又回来了）。实测：bench-ui-headless P5a/P11 各命中 7 行裸标签。
         ⇒ 有 token、或原文里本来就有标签时，原文必须清掉（图片去重只决定"画不画节点"，不决定"留不留原文"）。 */
      if (frag || toks.length || /</.test(raw)) el.textContent = ''
      if (frag) el.appendChild(frag)
      el.dataset.benchRich = '1'
    }
    //  ③ #27 占位颜色属性：不渲染那个没有意义的取色框（`?rawprops=1` 回退）
    if (!PROPS_RAW && propsPlaceholderColor({ name: meta.name, ptype: meta.ptype, text: plain })) {
      const ctl = row.querySelector('.prop-ctl')
      if (ctl && !ctl.hidden) {
        ctl.hidden = true; ctl.dataset.benchPropsCtl = 'placeholder'
        if (!row.querySelector('.bench-prop-note')) {
          const note = D.createElement('div'); note.className = 'bench-prop-note'
          note.textContent = tr(curLang(), 'props.placeholderNote')
          row.appendChild(note)
        }
      }
    }
    row.dataset.benchPropsRow = 'done'
    if (PROPS_RAW) row.dataset.benchPropsRaw = '1'
    return true
  }
  /** 被隐藏名单挡下的项数 + 面板末尾那条说明（不抢产物自己的 `.prop-hint` 行）。 */
  function paintPropsHiddenNote() {
    if (!propsBody) return 0
    const hidden = propsRows().filter((el) => el.hidden && String(el.dataset.benchPropsRow || '').indexOf('hidden-') === 0)
    const n = PROPS_RAW ? 0 : hidden.length
    let note = propsBody.querySelector('#props-hidden-note')
    if (!n) { if (note) note.remove(); return 0 }
    if (!note) {
      note = D.createElement('div'); note.id = 'props-hidden-note'
      note.className = 'prop-hint bench-props-hidden-note'
      propsBody.appendChild(note)                     // 追加在末尾：不动产物已经画好的顺序
    }
    const txt = tr(curLang(), 'props.hiddenNote').replace('{n}', String(n)).replace('{flag}', '?rawprops=1')
    if (note.textContent !== txt) note.textContent = txt
    return n
  }
  /** 全被隐藏（或本来就是"没有可显示项"）时也要说人话，而不是留一块空白。 */
  function paintPropsShownNote() {
    if (!propsBody) return 0
    const need = propsRows().length > 0 && propsVisibleRows().length === 0
    let note = propsBody.querySelector('#props-shown-note')
    if (!need) { if (note) note.remove(); return 0 }
    if (!note) {
      note = D.createElement('div'); note.id = 'props-shown-note'
      note.className = 'prop-hint bench-props-hidden-note'
      propsBody.appendChild(note)
    }
    const txt = tr(curLang(), 'props.emptyShownNote')
    if (note.textContent !== txt) note.textContent = txt
    return 1
  }
  /** ②(2026-09-25 用户第 2 条) 图片去重的**台账提示行**（面板末尾，人读与机读同一份数据）。
   *  读的是真账本 `propsImages().report`；`rendered`/`duplicatesSkipped`/`variants.evidence` 三个数
   *  与门禁断言的是同一份。文案两语都从词典来（键数对称由 A20c 守着）。 */
  function paintImgDedupNote() {
    if (!propsBody) return 0
    const rep = richImagePass ? richImagePass.report() : null
    /*  只在**真的压掉过**东西时出现（没重复就不占地方）；`all` 对照档自然不出现（压掉 0 张）。 */
    const n = rep ? rep.duplicatesSkipped : 0
    let note = propsBody.querySelector('#props-imgdedup-note')
    if (!n) { if (note) note.remove(); return 0 }
    if (!note) {
      note = D.createElement('div'); note.id = 'props-imgdedup-note'
      note.className = 'prop-hint bench-props-imgdedup-note'
      propsBody.appendChild(note)
    }
    const ev = (rep.variants && rep.variants.evidence) || { equal: 0, different: 0, unknown: 0 }
    const forced = (rep.variants && rep.variants.merged) || 0
    /*  ⚠`tr(lang,key)` 只取两条参数（本作用域的约定，见 `paintPropsHiddenNote`）⇒ 占位在这里替换。 */
    const txt = tr(curLang(), 'props.imgDedupNote').replace('{n}', String(n)) + ' ' +
      tr(curLang(), 'props.imgDedupForcedNote')
        .replace('{m}', String(forced)).replace('{diff}', String(ev.different || 0)).replace('{unk}', String(ev.unknown || 0))
    if (note.textContent !== txt) note.textContent = txt
    try { note.setAttribute('data-mpw-imgdedup', JSON.stringify({ n, forced, evidence: ev })) } catch { /* 桩 DOM */ }
    return n
  }
  function decoratePropsBody() {
    if (!propsBody) return 0
    /* ①E 一趟装饰 = 一次"整面板只画一遍同一张图"的作用域（跨属性行生效；换壁纸/重渲染时自然重来）。
       档位（三层回退，见 `richImageModePlan`）：`?propimg=all` 完全不去重（对照/排障）、`=row` 退回旧语义
       （只在行内去重）、面板开关三档、缺省 `once` = 用户要的"同一张画面只画一次"。 */
    /*  ② 账本由 `sweepPanelImages()` **从 DOM 重建**（幂等、永远与 DOM 一致）⇒ 这里不再预判"要不要换账本"。 */
    let n = 0
    let rowIdx = 0
    for (const row of propsRows()) { richImageScope = rowIdx++; try { if (decoratePropRow(row)) n++ } catch { /* 单行失败不影响别的行 */ } }
    //  组壳：组内每一项都被隐藏名单收掉时，别留一个只有标题的空组（可回退：rawprops 档不收）
    for (const g of propsBody.querySelectorAll('.prop-group')) {
      try {
        if (g.hidden) continue
        const inner = [...g.querySelectorAll('.prop, .prop-text')]
        const allHidden = inner.length > 0 && inner.every((el) => el.hidden || String(el.dataset.benchPropsRow || '').indexOf('hidden-') === 0)
        if (allHidden) { g.hidden = true; g.dataset.benchPropsRow = 'hidden-empty-group' }
        else if (String(g.dataset.benchPropsRow || '') === 'hidden-empty-group') { g.hidden = false; g.dataset.benchPropsRow = 'done' }
      } catch { /* ignore */ }
    }
    /*  ② 图片账的**唯一权威**：按 DOM 顺序扫一遍（两个来源一起算）—— 必须在所有行都画完之后跑。 */
    try { sweepPanelImages() } catch { /* 单次失败不影响面板 */ }
    try { paintImgModeControl() } catch { /* 控件失败不影响面板 */ }
    /*  ②(2026-09-25 用户第 2 条) **把账本写成人看得见的一行**（"已压掉 N 张重复图，其中 M 张靠键相等
        强制归并、当时尺寸不同/未知 x 张"）：用户明确要求"把放弃归并的原因如实计数进台账/提示，不许静默"。
        位置与另外两条 note 同款（面板末尾，不抢产物自己的行）。 */
    try { paintImgDedupNote() } catch { /* 提示失败不影响面板 */ }
    paintPropsHiddenNote()
    paintPropsShownNote()
    /* ①A1(2026-09-24 用户「WE 自带的那几个选项永远在壁纸配置最上面 ⇒ 做成可折叠」)：
       装饰完各行之后把它们收进可折叠分组（幂等；签名没变时一个字节都不写）。 */
    try { groupWeBuiltinProps() } catch { /* 分组失败不影响单行装饰 */ }
    return n
  }
  /** 落状态：error（读失败）> ok（有可见行）> none（有提示/行但没可显示项）> unselected（没选壁纸）。 */
  /** 落状态：error（读失败）> ok（有可见行）> none（有提示/行但没可显示项）> reading（有目标、行还没到）
   *  > unselected（确实没有当前壁纸）。**只有**这里写 `propsState`，别的路径一律不写（单一事实源）。 */
  function propsSettle() {
    if (!propsBody) return propsState
    notePropsActive(propsActiveItemId())
    const item = propsResolvedItem()
    decoratePropsBody()
    const failed = propsReadFailed()
    let next
    if (failed) next = 'error'
    else if (propsVisibleRows().length > 0) next = 'ok'
    else if (propsRows().length > 0 || propsHasNote()) next = 'none'
    else if (item) next = 'reading'          // 有目标而面板还空 ⇒ 还在读（由催读/期限收口，不在这里猜）
    else next = 'unselected'
    if (next !== 'reading') propsPendingItem = null
    syncPropsHidden()
    setPropsState(next)
    if (next === 'unselected') paintPropsEmpty()
    return next
  }
  /** 让**产物自己**重读属性表：把面板临时当作"收起着"（`hidden`）+ 调它自己的 `#toggle-props` 处理器
   *  ⇒ 走 `ue(true)` + `S !== w.itemId` 时的 `yt(w.itemId)`。这是产物里唯一的重读入口。
   *  ⚠ 必须在产物 `Ue(item)` 已经跑过之后调（`w` 才是新项）——所以收起态那次催读交给 watcher 的 900ms 重试。 */
  function forceArtifactPropsRead() {
    if (!propsEl || !propsToggleBtn || typeof artifactPropsToggle !== 'function') return false
    try {
      propsEl.hidden = true
      artifactPropsToggle.call(propsToggleBtn)
      const ws = q('#workspace'); if (ws) ws.classList.remove('props-open')
      if (propsToggleBtn) propsToggleBtn.classList.add('checked')
      syncPropsHidden()
      return true
    } catch { return false }
  }
  /** 等回执：轮询到"状态不再是 reading"为止；900ms 还没动静就催一次产物重读；超时落 error。
   *  收起态切换时这是**唯一**的读入口（产物 `Ue` 因 `hidden` 短路不读，见文件头注释）。 */
  function watchPropsOutcome(item, ms) {
    const seq = ++propsReadSeq
    if (propsPoll) { clearInterval(propsPoll); propsPoll = null }
    if (propsDeadline) { clearTimeout(propsDeadline); propsDeadline = null }
    const started = Date.now()
    const stop = () => {
      if (propsPoll) { clearInterval(propsPoll); propsPoll = null }
      if (propsDeadline) { clearTimeout(propsDeadline); propsDeadline = null }
    }
    const tick = () => {
      if (seq !== propsReadSeq) return
      const st = propsSettle()
      const waited = Date.now() - started
      if (st !== 'reading' && waited >= 120) { stop(); return }
      if (!propsForced && waited >= 900) { propsForced = true; forceArtifactPropsRead() }
    }
    propsPoll = setInterval(tick, 60)
    propsDeadline = setTimeout(() => {
      if (seq !== propsReadSeq) return
      stop(); propsSettle()
      if (propsState === 'reading') setPropsState('error')
    }, Number(ms) > 0 ? Number(ms) : 9000)
    tick()
  }
  function beginPropsRead(item, why) {
    cancelPropsUnselect()
    propsForced = false
    clearPropsBody()
    propsShownItem = item || null
    if (!item) return propsUnselect()
    setPropsState('reading')
    syncPropsHidden()
    //  可见态：产物自己的 `li.onclick`（`Ue`）马上会重读（前提是 `hidden` 已摘）；展开/收起态：它不会再读，
    //  由 watcher 在 900ms 后（那时 `w` 已是新项）替它调重读入口 —— 捕获阶段当场调只会读到**旧** `w`。
    if (why === 'expand') forceArtifactPropsRead()
    watchPropsOutcome(item)
    return propsState
  }
  /** 面板重挂载入口。`why`：switch（点列表项，捕获阶段）/ expand（由收起转展开）/ list（列表变更后）/
   *  probe（探针显式调用）。`itemHint` 给"即将切到"的 id（列表里还没打 `.active` 时也对得上）。 */
  function refreshPropsPanel(why, itemHint) {
    if (!propsBody) return propsState
    if (why === 'switch' || why === 'expand' || why === 'probe') {
      const item = itemHint !== undefined ? (itemHint ? String(itemHint) : null) : propsResolvedItem()
      propsPendingItem = item
      return beginPropsRead(item, why)
    }
    //  list：列表被重画过（产物 `T()` 会先画一小批过滤结果、再画全量）——**绝不**清行，只对账；
    //  "没有 .active" 要等它稳定下来才算数（否则那 60ms 窗口会把面板打成"未选择"）。
    notePropsActive(propsActiveItemId())
    if (!propsActiveItemId() && !propsPendingItem) {
      cancelPropsUnselect()
      if (propsState === 'reading') return propsState
      propsUnselectTimer = setTimeout(() => {
        propsUnselectTimer = null
        if (propsPendingItem || propsActiveItemId()) return
        propsUnselect()
      }, 320)
      return propsState
    }
    cancelPropsUnselect()
    propsSettle()
    return propsState
  }

  /* ── #34 数字输入：所有数值框统一走 `parseNumberSafe`（非法 ⇒ 行内报错 + **不写回**）────────────
     产物自己那条 `g.onchange` 只做 `Number.isFinite(Number(v))` ⇒ `1e9`、`0x10` 都会被当成合法数字写回，
     `Infinity` 则被**静默忽略**（用户看不到任何提示）。这里在**捕获阶段**接管：
       · 非法（科学计数法/进制前缀/非有限数/非数字/超长/小数位过多）⇒ 恢复原值 + 行内 `.bench-num-err` 说明；
       · 合法但越界/不合步长/超精度 ⇒ 钳制后**走产物自己的链路**（给滑条赋值 + 派发 `input`
         ⇒ 它的 `m.oninput` 更新模型、重画面板、并按它自己的精度格式化数值框 —— 我们不复制它的格式化逻辑）；
       · 写回推迟到本次事件之后：产物 `x()` 会整块重画面板，当场写注释会挂到已被丢弃的节点上。 */
  const PROP_NUM_ERR = 'bench-num-err'
  function propNumIsNumeric(el) {
    if (!el || el.tagName !== 'INPUT') return false
    return !!(el.classList && el.classList.contains('prop-num')) || el.type === 'number'
  }
  function propRowOf(el) { return el && el.closest ? el.closest('.prop') : null }
  function findPropRowByName(name) {
    if (!propsBody || !name) return null
    for (const el of propsBody.querySelectorAll('.prop')) if (propRowMeta(el).name === name) return el
    return null
  }
  function numErrEl(input, create) {
    const row = propRowOf(input)
    if (!row) return null
    let el = null
    for (const c of [...row.children]) if (c.classList && c.classList.contains(PROP_NUM_ERR)) { el = c; break }
    if (!el && create) {
      el = D.createElement('div'); el.className = PROP_NUM_ERR; el.setAttribute('role', 'alert')
      row.appendChild(el)
    }
    return el
  }
  function setNumErr(input, text) {
    const el = numErrEl(input, !!text)
    if (!el) return null
    const want = String(text || '')
    if (el.textContent !== want) el.textContent = want
    el.hidden = !want
    try { if (want) el.setAttribute('data-bench-num-err', '1'); else el.removeAttribute('data-bench-num-err') } catch {}
    return el
  }
  /** 数值规格：min/max/step 优先取输入框自己的属性，缺了就看同行的滑条；precision 取数值框**当前显示**的
   *  小数位（产物就是按它的 precision 格式化的 ⇒ 用它，不自己另定一套）。 */
  function propNumSpec(input) {
    const row = propRowOf(input)
    const range = row ? row.querySelector('input[type="range"]') : null
    const pick = (attr) => {
      const own = String((input.getAttribute && input.getAttribute(attr)) || '')
      if (own !== '') return Number(own)
      const fromRange = String((range && range.getAttribute && range.getAttribute(attr)) || '')
      return fromRange !== '' ? Number(fromRange) : NaN
    }
    const shown = String(input.dataset.benchNumPrev || input.value || '')
    const dm = /\.(\d+)$/.exec(shown)
    return { min: pick('min'), max: pick('max'), step: pick('step'), precision: dm ? dm[1].length : NaN }
  }
  function applyPropNumber(name, fallbackInput, res) {
    const row = findPropRowByName(name)
    const range = row ? row.querySelector('input[type="range"]') : null
    if (range) {
      const want = String(res.value)
      try { range.value = want } catch { /* 越界会被浏览器钳回，下面照旧派发 */ }
      try { range.dispatchEvent(new Event('input', { bubbles: true })) } catch { /* 老浏览器没有 Event 构造器 */ }
    }
    const after = findPropRowByName(name) || row
    const afterInput = after ? after.querySelector('input.prop-num, input[type="number"]') : null
    if (afterInput) {
      if (!range) afterInput.value = String(res.value)
      afterInput.dataset.benchNumPrev = String(afterInput.value || '')
      setNumErr(afterInput, res.clamped
        ? tr(curLang(), 'props.num.clamped', { v: String(res.value), why: res.notes.map((n) => tr(curLang(), 'num.why.' + n)).join(' / ') })
        : '')
    } else setNumErr(fallbackInput, '')
  }
  function onPropNumChange(ev) {
    const input = ev && ev.target
    if (!propNumIsNumeric(input)) return undefined
    const row = propRowOf(input)
    const name = row ? propRowMeta(row).name : ''
    const res = parseNumberSafe(input.value, propNumSpec(input))
    //  拦下产物那条只认 `Number.isFinite` 的处理器：它会把 `1e9` / `0x10` 写回模型
    try { ev.stopPropagation() } catch { /* 合成事件 */ }
    try { ev.stopImmediatePropagation() } catch { /* 合成事件 */ }
    if (!res.ok) {
      const prev = String(input.dataset.benchNumPrev || '')
      if (prev) input.value = prev
      setNumErr(input, tr(curLang(), 'props.num.invalid', { why: tr(curLang(), 'num.why.' + res.reason) }))
      return false
    }
    setTimeout(() => { try { applyPropNumber(name, input, res) } catch { /* 面板可能刚被重画 */ } }, 0)
    return true
  }

  /* ── #30 外链二次确认：写明**域名** + 3 秒倒计时，确认后 `window.open(url,'_blank','noopener,noreferrer')` ── */
  let extDlg = null, extTimer = null
  function closeExternalConfirm() {
    if (extTimer) { clearInterval(extTimer); extTimer = null }
    if (extDlg) { try { extDlg.remove() } catch { /* 已被移除 */ } ; extDlg = null }
  }
  function openExternalConfirm(url) {
    const info = externalLinkInfo(url)                      // 只放行 http(s)：`javascript:` 等一律拒绝
    if (!info.ok) { log(tr(curLang(), 'props.linkBlocked')); return null }
    closeExternalConfirm()
    const wrap = D.createElement('div'); wrap.className = 'bench-ext'; wrap.id = 'bench-ext-confirm'
    wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true')
    const box = D.createElement('div'); box.className = 'bench-ext-box'
    const title = D.createElement('div'); title.className = 'bench-ext-title'; title.textContent = tr(curLang(), 'props.ext.title')
    const host = D.createElement('div'); host.className = 'bench-ext-host'; host.id = 'bench-ext-host'
    host.textContent = tr(curLang(), 'props.ext.host', { host: info.host })
    const full = D.createElement('code'); full.className = 'bench-ext-url'; full.textContent = info.href
    const warn = D.createElement('div'); warn.className = 'bench-ext-warn'; warn.textContent = tr(curLang(), 'props.ext.warn')
    const row = D.createElement('div'); row.className = 'bench-ext-row'
    const cancel = D.createElement('button')
    cancel.type = 'button'; cancel.className = 'bench-ext-cancel'; cancel.textContent = tr(curLang(), 'props.ext.cancel')
    const go = D.createElement('button')
    go.type = 'button'; go.className = 'bench-ext-open'; go.id = 'bench-ext-open'; go.disabled = true
    let left = 3
    const paintGo = () => { go.textContent = left > 0 ? tr(curLang(), 'props.ext.wait', { n: left }) : tr(curLang(), 'props.ext.open') }
    paintGo()
    cancel.addEventListener('click', () => { closeExternalConfirm(); log(tr(curLang(), 'props.ext.cancelled')) })
    go.addEventListener('click', () => {
      if (go.disabled) return
      const target = info.href
      closeExternalConfirm()
      try { window.open(target, '_blank', 'noopener,noreferrer') } catch { /* 被弹窗拦截：浏览器自己会提示 */ }
      log(tr(curLang(), 'props.ext.opening', { host: info.host }))
    })
    extTimer = setInterval(() => {
      left -= 1
      if (left <= 0) {
        left = 0
        if (extTimer) { clearInterval(extTimer); extTimer = null }
        go.disabled = false
      }
      paintGo()
    }, 1000)
    row.appendChild(cancel); row.appendChild(go)
    box.appendChild(title); box.appendChild(host); box.appendChild(full); box.appendChild(warn); box.appendChild(row)
    wrap.appendChild(box)
    wrap.addEventListener('click', (e) => { if (e.target === wrap) closeExternalConfirm() })
    wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeExternalConfirm() })
    D.body.appendChild(wrap)
    extDlg = wrap
    try { cancel.focus() } catch { /* 无焦点环境 */ }
    return { host: info.host, href: info.href }
  }
  function extConfirmState() {
    if (!extDlg) return { open: false }
    const go = extDlg.querySelector('.bench-ext-open')
    const host = extDlg.querySelector('.bench-ext-host')
    return {
      open: true, disabled: !!(go && go.disabled), label: go ? String(go.textContent || '') : '',
      host: host ? String(host.textContent || '') : '',
      href: String((extDlg.querySelector('.bench-ext-url') || {}).textContent || ''),
      buttons: extDlg.querySelectorAll('button').length,
    }
  }

  if (propsBody) {
    try {
      propsBody.addEventListener('focusin', (ev) => {
        const el = ev && ev.target
        if (propNumIsNumeric(el)) el.dataset.benchNumPrev = String(el.value == null ? '' : el.value)
      }, true)
      propsBody.addEventListener('change', onPropNumChange, true)
      propsBody.addEventListener('click', (ev) => {
        const t0 = ev && ev.target
        /* ③(P-228f 2026-10-05) **产物自己渲染的图片链接也要过确认窗**：产物面板把带 `href` 的图片包成
           `<a href target=_blank>`（`prop-media` 那条渲染路径），点它浏览器直接开新标签、
           我们的确认弹层（`#bench-ext-confirm`，倒计时 3s + 明确目标域名）完全被绕开。
           这里把口径从"只认我们自己的 `a.bench-prop-link`"放宽到"`#props-body` 里**任何** `a[href]`"：
           两类链接走同一条确认链，`javascript:`/`data:` 仍被 `externalLinkInfo` 拒掉。 */
        const a = t0 && t0.closest ? (t0.closest('a.bench-prop-link') || t0.closest('#props-body a[href]')) : null
        if (!a) return
        try { ev.preventDefault() } catch { /* 合成事件 */ }
        try { ev.stopImmediatePropagation() } catch { /* 合成事件 */ }
        openExternalConfirm(String(a.getAttribute('href') || a.dataset.benchExt || ''))
      }, true)
    } catch { /* 桩 DOM */ }
  }
  function propsPanelState() {
    const rows = propsRows()
    if (!propsBody) return { state: propsState, item: propsShownItem, rows: 0, raw: PROPS_RAW }
    return {
      state: propsState, item: propsShownItem, active: propsActiveItemId(), raw: PROPS_RAW,
      rows: rows.length, visible: propsVisibleRows().length,
      topLevel: propsBody.children.length, groups: propsBody.querySelectorAll('.prop-group').length,
      hiddenNames: rows.filter((el) => el.hidden).map((el) => propRowMeta(el).name || '[text-row]'),
      names: propsVisibleRows().map((el) => propRowMeta(el).name),
      texts: propsVisibleRows().map((el) => {
        const n = el.querySelector('.prop-name, .prop-text-cap, summary')
        return n ? String(n.textContent || '') : ''
      }),
      links: [...propsBody.querySelectorAll('a.bench-prop-link')].map((a) => String(a.getAttribute('href') || '')),
      numInputs: propsBody.querySelectorAll('input.prop-num, input[type="number"]').length,
      notes: propsBody.querySelectorAll('.bench-num-err:not([hidden])').length,
      stateText: String(((q('#props-state') || {}).textContent) || ''),
      empty: !!propsBody.querySelector('#props-empty'),
    }
  }

  /* ── #14 资源管理器列表行布局：标题与 ID **分行**、ID 等宽 + 单行省略号 + `title` 完整值 ─────────────
     产物把 `类型 · N 属性 · itemId` 全塞进**一行** `.sub`（`white-space:nowrap`）⇒ 属性数一多，
     ID 就被省略号吃掉（用户第 14 条"属性太多导致 ID 显示不全"）。这里只动 `.sub` 的内部结构，
     不碰产物的 `li.onclick`（列表项照样点得动）。 */
  function decorateListRow(li) {
    if (!li || !li.dataset || li.dataset.benchRowLayout === '1') return false
    const id = String(li.dataset.id || '')
    const sub = li.querySelector('.meta > .sub') || li.querySelector('.sub')
    if (!sub || !id) return false
    const text = String(sub.textContent || '')
    const tail = ' · ' + id
    let head = null
    if (text === id) head = ''
    else if (text.slice(-tail.length) === tail) head = text.slice(0, text.length - tail.length)
    if (head === null) return false                 // 产物格式漂移：宁可不拆，也不把别的文字当 ID
    sub.textContent = ''
    if (head) {
      const kind = D.createElement('span'); kind.className = 'bench-row-kind'; kind.textContent = head
      sub.appendChild(kind)
    }
    const idEl = D.createElement('span')
    idEl.className = 'bench-row-id'; idEl.textContent = id; idEl.title = id
    sub.appendChild(idEl)
    li.dataset.benchRowLayout = '1'
    return true
  }
  function decorateListRows(scope) {
    const root = scope || listEl
    if (!root || !root.querySelectorAll) return 0
    let n = 0
    for (const li of root.querySelectorAll('li[data-id]')) { try { if (decorateListRow(li)) n++ } catch { /* 单行失败不影响别的行 */ } }
    return n
  }

  try {
    if (propsEl && typeof MutationObserver === 'function') {
      let t2 = null
      new MutationObserver(() => { if (t2) clearTimeout(t2); t2 = setTimeout(() => { t2 = null; propsSettle() }, 80) })
        .observe(propsBody || propsEl, { childList: true, subtree: true })
    }
  } catch {}
  /* ①B(P-201) 预览 iframe 挂载 / 重挂载 ⇒ 渲染器那侧可能刚发布 `__wp`（显示选项在 GL 之前就发了）
     ⇒ 让"渲染器设置"这一组重新对账一次可用性与真值（挂载期那一拍它必然是"未就绪"）。
     只挂一次（幂等标记）；`load` 在 iframe 换 src 时每次都来。 */
  try {
    const fr = q('#frame')
    if (fr && !fr.__benchWeFrameBound) {
      fr.__benchWeFrameBound = true
      fr.addEventListener('load', () => { try { groupWeBuiltinProps() } catch { /* 面板还没就绪 */ } })
    }
  } catch { /* 桩 DOM：没有 #frame 就不是浏览器形态 */ }
  /* ①E(用户第 3 档「留回退空间」) 面板里的**可见开关**（第二层回退）：外壳一起来就挂上，
     不依赖"有没有选壁纸/有没有属性行" —— 用户在任何时候都看得见、点得动。 */
  try { paintImgModeControl() } catch { /* 控件失败不影响面板 */ }
  /* 点列表项（捕获阶段，先于产物 `li.onclick` 的整条挂载链）⇒ 面板按"新那张"重挂载。 */
  try {
    if (listEl && !listEl.__benchPropsClickBound) {
      listEl.__benchPropsClickBound = true
      listEl.addEventListener('click', (ev) => {
        const t0 = ev && ev.target
        const li = t0 && t0.closest ? t0.closest('li[data-id]') : null
        if (!li) return
        const id = String(li.dataset.id || '')
        if (!id || li.classList.contains('active')) return    // 点当前项：产物自己幂等（P-164），面板不用动
        try { refreshPropsPanel('switch', id) } catch { /* 单次失败不阻断产物那条点击链 */ }
      }, true)
    }
  } catch {}
  /* 列表侧的**第二道**观察（与 `#list` 那条 childList 观察分开）：`class` 属性变化也要能叫醒面板 ——
     "没有其它打开项 ⇒ 释放舞台"那条路只摘 `.active`，不产生 childList 变更（本轮实测：面板会停在
     上一张壁纸的 17 行上）。`decorateListRows` 只写 `dataset`/子节点、不写 `class` ⇒ 不会自激。 */
  try {
    if (listEl && typeof MutationObserver === 'function') {
      let t3 = null
      new MutationObserver(() => {
        if (t3) clearTimeout(t3)
        t3 = setTimeout(() => { t3 = null; try { refreshPropsPanel('list') } catch { /* ignore */ } }, 80)
      }).observe(listEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
    }
  } catch {}
  let artifactPropsToggle = null                            // 产物 `#toggle-props` 的原始处理器（重读入口）

  /* ── ⑫a(2026-09-19 用户要求)「壁纸配置」要能**收起** ────────────────────────────────────────
     真因（两条都在我们自己的代码里，产物那条 `#props-close.onclick = () => ue(!1)` 其实一直在跑）：
       ① `#props[hidden]{display:flex!important}`（静态表 + SITE_LAYOUT_CSS 各一份）—— 2026-09-17 为
          "产物切 docs 视图时把常驻区一起 hidden"上的锁，把 `hidden` 变成了**空操作**；
       ② `paintPropsEmpty()` 见 `hidden` 就 `removeAttribute('hidden')` —— 同一把锁的 JS 侧。
     修法：收起状态改用我们自己的类 `#props.bench-props-collapsed{display:none!important}`（同特异度、
     源序在后 ⇒ 压得住 `#props[hidden]`；`!important` 同时压掉产物 CSS 的 `[hidden]{display:none!important}`）。
     `#toggle-props` 用 `onclick = null` 摘掉产物那个"没选壁纸就弹错"的处理器（面板现在是常驻列 + 空态，
     不需要它），再挂我们自己的**两态**开关；顺带把产物会加到 `#workspace` 上的 `props-open` 去掉 ——
     产物 CSS 里 `#workspace.props-open{grid-template-columns:minmax(0,1fr) 360px}` 会让舞台白丢 360px 宽。 */
  const PROPS_COLLAPSED_KEY = 'bench-props-collapsed'
  const propsCloseBtn = q('#props-close'), propsToggleBtn = q('#toggle-props')
  function propsCollapsedNow() { try { return !!(propsEl && propsEl.classList.contains('bench-props-collapsed')) } catch { return false } }
  function setPropsCollapsed(collapsed, persist = true) {
    if (!propsEl) return false
    const want = !!collapsed
    try { propsEl.classList.toggle('bench-props-collapsed', want) } catch {}
    try { if (want) propsEl.setAttribute('data-bench-props', 'collapsed'); else propsEl.removeAttribute('data-bench-props') } catch {}
    if (propsToggleBtn) {
      /* ①(2026-09-22 用户第 26 条) "选中态"必须等于**真的展开且有内容**：新加载一张壁纸时按钮会亮蓝底
         但面板是空的（旧写法只看 `want`）。判据 = 未收起 **且** 属性表里真有行（我们插的空态不算行）。 */
      let hasRows = false
      try { hasRows = !!(propsBody && [...propsBody.children].some((c) => !(c.dataset && c.dataset.benchPropsEmpty))) } catch {}
      const on = !want && hasRows
      try { propsToggleBtn.classList.toggle('checked', on) } catch {}
      try { propsToggleBtn.setAttribute('aria-pressed', on ? 'true' : 'false') } catch {}
    }
    try { const ws = q('#workspace'); if (ws) ws.classList.remove('props-open') } catch {}
    //  ①(本轮 #23) `hidden` 是**产物眼里的收起标志**（视觉收起走我们自己的类）：可见时必须为 false，
    //  否则产物在切壁纸时跳过属性重读（`Le.hidden || yt(...)` 短路）—— 那正是第 23 条的根因。
    syncPropsHidden()
    if (persist) writeKey(PROPS_COLLAPSED_KEY, want ? '1' : '0')
    if (!want) {
      //  ②(本轮 #23) 收起期间切过壁纸 ⇒ 面板里是上一张的行：展开时清空 + 让产物重读一次。
      const item = propsActiveItemId()
      if (item && (String(item) !== String(propsShownItem || '') || (!propsRows().length && !propsHasNote()))) refreshPropsPanel('expand', item)
      else propsSettle()
    }
    return want
  }
  if (propsCloseBtn) propsCloseBtn.addEventListener('click', (e) => { try { e && e.preventDefault && e.preventDefault() } catch {}; setPropsCollapsed(true) })
  if (propsToggleBtn) {
    //  ①(本轮) 先把产物自己的处理器**存下来**再摘：它是"强制重读属性表"的唯一入口
    //  （`forceArtifactPropsRead()` 用它；不存的话收起期间切壁纸就再也刷不出来了）。
    try { artifactPropsToggle = typeof propsToggleBtn.onclick === 'function' ? propsToggleBtn.onclick : null } catch { artifactPropsToggle = null }
    try { propsToggleBtn.onclick = null } catch { /* 桩 DOM 允许覆盖 */ }
    propsToggleBtn.addEventListener('click', (e) => {
      try { e && e.preventDefault && e.preventDefault() } catch {}
      setPropsCollapsed(!propsCollapsedNow())
    })
    try { propsToggleBtn.setAttribute('aria-controls', 'props') } catch {}
  }
  setPropsCollapsed(readKey(PROPS_COLLAPSED_KEY) === '1', false)   // 首次上电：默认**展开**（空态），尊重用户上次的收起

  /* ── 控制台：拖动上沿调高度（⑥ 与 8899 demo.html 的日志条同一套手感）+ 双击复位 ── */
  const mainEl = q('#main'), splitter = q('#logs-splitter'), logsEl = q('#logs')
  function logsHeight() {
    const raw = readKey(LOGS_KEY)
    if (raw === 'collapsed') return 0
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : 220
  }
  function stageFloorPx() { return 140 }   // 舞台保底高度（窄视口下不许被工具栏/控制台吃光）
  function maxLogsForLayout() {
    if (!mainEl) return 220
    // ①(2026-09-18) 窄屏布局是"文档流堆叠 + 页面内滚动"，舞台不再和 1fr 争高度 ⇒ 不钳制。
    //   判据用**同一个闸门**（`html.bench-narrow`，由 index.html 的 head 同步脚本按视口宽度加），
    //   这里不再重复写一遍宽度阈值：2026-09-18 平板修复把阈值从 860 提到 1180，两处各写一份必然漂移。
    try { if (document && document.documentElement && document.documentElement.classList.contains('bench-narrow')) return 100000 } catch {}
    try {
      const mainH = mainEl.getBoundingClientRect().height
      const chromeH = (q('#editor-chrome') || { getBoundingClientRect: () => ({ height: 0 }) }).getBoundingClientRect().height
      const rest = mainH - chromeH - 6 - stageFloorPx()
      // ⑪(2026-09-19 用户要求「输出区至少能看几行」) 原来这里是 `Math.max(60, …)`：窗口一矮就把控制台钳成
      //   60px（≈2 行）。120px ≈ 5 行，且 stageFloorPx()=140 已经把舞台保底留出来了 ⇒ 不会反过来把舞台挤没。
      return Math.max(120, Math.round(rest))
    } catch { return 220 }
  }
  function setLogsHeight(px, persist = true) {
    if (!mainEl) return 0
    // ①(修正 2026-09-18 窄视口塌陷) 上限同时受"给舞台留 140px"约束：真机在 ≤900×620 且控制台展开时
    //   #toolbar 换行长到 337px，把 1fr 吃光 ⇒ 舞台高度 0、壁纸缩到左上角。这里按真实几何钳制。
    const v0 = clampLogsHeight(px, (typeof innerHeight === 'number' ? innerHeight : 800))
    const v = Math.min(v0, maxLogsForLayout())
    mainEl.style.setProperty('--mpw-logs-h', v + 'px')
    const collapsed = v === 0
    try { mainEl.classList.toggle('logs-collapsed', collapsed) } catch {}
    if (logsEl) { try { logsEl.classList.toggle('bench-logs-collapsed-tag', collapsed) } catch {} }
    if (persist) writeKey(LOGS_KEY, collapsed ? 'collapsed' : String(v))
    paintLogsArrow(collapsed)
    return v
  }
  /* ⑦ 箭头语义（用户口径）：**收起后**按钮表示"展开" ⇒ 箭头朝上；展开态表示"收起" ⇒ 箭头朝下。
     这里同时给按钮加文字标签（收起时显示"展开"），避免只有一个箭头时的歧义。 */
  // ⑦ 真机根因（子代理定位，产物 minified `pt()`）：折叠开关被写成
  //   `#toggle-logs.textContent = collapsed ? '▸' : '▾'` —— 写 textContent 会**删掉我们的两个 svg**，
  //   `▸` 是个朝右的三角（用户看到的"向右的箭头"）。用户口径：收起后该按钮表示"展开"，箭头应朝上。
  //   修法：按状态把按钮内容统一成文本字形 —— 收起 = `▴`（点它展开）、展开 = `▾`（点它收起），
  //   与同仓 `demo.html` 的日志条一致（tests/log-panel-collapse-test.mjs:79 同口径）；只在需要时才写，避免观察者自激。
  function paintLogsGlyph(collapsed) {
    const btn = q('#toggle-logs')
    if (!btn) return
    const want = collapsed ? '▴' : '▾'
    try {
      const svg = btn.querySelector && btn.querySelector('svg')
      const cur = (btn.textContent || '').trim()
      if (svg) { btn.textContent = want }            // 产物替换过/还在：统一成文字字形
      else if (cur !== want) btn.textContent = want
    } catch { /* 桩 DOM */ }
  }
  let logsArrowState = null
  function paintLogsArrow(collapsed) {
    const key = (collapsed ? 'c' : 'e') + '|' + curLang() + '|' + (typeof document !== 'undefined' && document.querySelector('#toggle-logs') ? (document.querySelector('#toggle-logs').textContent || '').trim() : '')
    if (key === logsArrowState) return
    logsArrowState = key
    const up = q('#ico-logs-up'), down = q('#ico-logs-down'), btn = q('#toggle-logs')
    if (up && down) {
      if (collapsed) { up.removeAttribute('hidden'); down.setAttribute('hidden', '') }
      else { down.removeAttribute('hidden'); up.setAttribute('hidden', '') }
    }
    if (btn) {
      try { btn.dataset.tag = tr(curLang(), collapsed ? 'logs.expand' : 'logs.collapse') } catch {}
      try { btn.setAttribute('title', tr(curLang(), collapsed ? 'logs.expandTip' : 'logs.collapseTip')) } catch {}
    }
    try { paintLogsGlyph(collapsed) } catch {}
  }
  if (splitter && mainEl) {
    let dragging = false
    const onMove = (e) => {
      if (!dragging) return
      const rect = mainEl.getBoundingClientRect()
      setLogsHeight(rect.bottom - e.clientY)
      try { e.preventDefault() } catch {}
    }
    const stop = () => {
      if (!dragging) return
      dragging = false
      try { splitter.classList.remove('dragging') } catch {}
      D.removeEventListener('pointermove', onMove)
      D.removeEventListener('pointerup', stop)
    }
    splitter.addEventListener('pointerdown', (e) => {
      dragging = true
      try { splitter.classList.add('dragging') } catch {}
      D.addEventListener('pointermove', onMove)
      D.addEventListener('pointerup', stop)
      try { e.preventDefault() } catch {}
    })
    splitter.addEventListener('dblclick', () => setLogsHeight(220))
  }
  /* 收起按钮：bundle 负责切 class，这里在 class 变化后重画箭头（两种路径都覆盖）；
     另外盯按钮自身的内容改写（产物会写 textContent ⇒ 我们的 svg 被删、变成朝右的 ▸）。 */
  try {
    if (mainEl && typeof MutationObserver === 'function') {
      new MutationObserver(() => paintLogsArrow(mainEl.classList.contains('logs-collapsed')))
        .observe(mainEl, { attributes: true, attributeFilter: ['class'] })
      const btnEl = q('#toggle-logs')
      if (btnEl) {
        let gt = null
        new MutationObserver(() => {
          if (gt) clearTimeout(gt)
          gt = setTimeout(() => { gt = null; paintLogsGlyph(mainEl.classList.contains('logs-collapsed')) }, 40)
        }).observe(btnEl, { childList: true, characterData: true, subtree: true })
      }
    }
  } catch {}

  /* ⑪ 新布局里"设置1"（#editor-chrome）与"控制台"（#logs）是常驻区：产物在未选壁纸/文档视图时
     会给它们加 `hidden`（display:none）——外壳模式下统一摘掉，并在产物再次加上时立刻摘掉。 */
  // ①(2026-09-18) 把产物的"活动视图"置成它自己认的 explorer：它的启动恢复读 localStorage['we-bench-view']，
  //   只有**恰好等于 'explorer'** 才走非 docs 分支（见 assets/bench-*.js 的 `O(e)`），否则一律切到 docs（README）。
  try { localStorage.setItem('we-bench-view', 'explorer') } catch {}
  const FORCE_SHOWN = ['#editor-chrome', '#logs', '#sidebar', '#stage-slot', '#stage']
  const FORCE_HIDDEN = ['#docs-view']   // 产物自带的文档视图（原作者 README）：新布局里由「说明」页取代
  function forceChromeVisible() {
    for (const sel of FORCE_SHOWN) {
      const el = q(sel)
      if (el && el.hasAttribute('hidden')) { try { el.removeAttribute('hidden') } catch {} }
    }
    for (const sel of FORCE_HIDDEN) {
      const el = q(sel)
      if (el && !el.hasAttribute('hidden')) {
        try { el.setAttribute('hidden', '') } catch {}
        // 产物刚把视图切到 docs ⇒ 把它的持久化值改回 explorer，避免下一次启动又落 docs
        try { localStorage.setItem('we-bench-view', 'explorer') } catch {}
      }
    }
  }
  forceChromeVisible()
  // 产物的异步恢复可能在补丁初始化之后才跑（真机"一帧后跳 README"就是它）⇒ 稍后再归一化一次视图键，
  // 让它的内部状态（act-docs/act-explorer 高亮、下次启动分支）也回到 explorer。CSS 锁是主修复，这里只是收尾。
  try { setTimeout(() => { try { localStorage.setItem('we-bench-view', 'explorer') } catch {} }, 0) } catch {}
  try { setTimeout(() => { try { localStorage.setItem('we-bench-view', 'explorer') } catch {} }, 800) } catch {}
  try {
    if (typeof MutationObserver === 'function') {
      const mo2 = new MutationObserver(() => forceChromeVisible())
      for (const sel of FORCE_SHOWN.concat(FORCE_HIDDEN)) { const el = q(sel); if (el) mo2.observe(el, { attributes: true, attributeFilter: ['hidden'] }) }
    }
  } catch {}

  /* ①(2026-09-18) 窗口尺寸变化 ⇒ 重新按几何钳制控制台高度（窄窗口下把舞台让出来）。
     用 rAF 去抖，避免拖动窗口时抖动；只在需要变小时改，不会把用户手动调高的值顶回去。 */
  try {
    if (typeof addEventListener === 'function') {
      let rt = null
      addEventListener('resize', () => {
        if (rt) return
        rt = setTimeout(() => {
          rt = null
          try {
            const cur = logsHeight()
            const cap = maxLogsForLayout()
            if (cur > cap) setLogsHeight(cap)
          } catch { /* 忽略 */ }
        }, 120)
      })
    }
  } catch {}

  /* ①(2026-09-18) 版本标记：唯一权威判据是 `<html data-bench-shell-version>` 与 `window.__benchShellVersion`
     （都在模块作用域写入，已验证生效）。这里再把它挂进 api，便于测试与用户核对；不再往状态栏插节点
     ——那一版在真机上静默失败（原因未查明，属非必要装饰，按"宁缺勿假"去掉）。 */

  /* ①(2026-09-18 修正) 这里曾用 JS 算舞台尺寸并写内联；真机实测被后续写入/元素替换吃掉（内联只剩后两条，
     舞台塌成 16px）⇒ 改为**纯 CSS 定高不变量**（见 index.html `.bench-narrow` 块的 `#stage-scale{height:46vh}`），
     少一处失败面。窗口尺寸变化由 CSS 自动跟随，无需 JS。 */

  /* ── ⑭(P-142 2026-09-19 用户第 1/2/3 项) 资源管理器收纳 + 声音控件 + video 声音接线 ──
     与外壳同一生命周期：`?shell=off` 时不初始化（旧行为），DOM 不是新外壳时也不做
     （两个元素都不存在 ⇒ initNavSound 自己会安全降级，但少跑一遍更干净）。 */
  const navSound = initNavSound({
    doc: D,
    win: (typeof window !== 'undefined' ? window : null),
    // 语言切换只影响我们自己的双语静态文案与 aria，重建不必要；这里把文案刷新挂出去（语言切换时调用）
  })
  if (navSound) {
    try { navSound.mountSound() } catch (e) { if (typeof ctx.log === 'function') ctx.log('声音控件挂载失败：' + ((e && e.message) || e)) }
    try { navSound.armProbe() } catch { /* 渲染器还没挂：自停探测已排好 */ }
  }

  /* 首次上电 */
  setPage(getPage(), false)
  setLogsHeight(logsHeight(), false)
  paintStatus()
  paintPropsEmpty()
  refreshSwitcher()
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => paintInk(pageFromName(getPage()).index))

  /** ⑨⑩(P-158) 本批新增呈现面的**统一重画入口**（语言切换 / 列表变更后由 init 的
   *  `__benchShellRefresh` 调一次）：类型开关文案 + 库列表面板 + 库来源行。 */
  function paintLangExtras() {
    try { buildTypeSegs(); paintTypeSegs() } catch { /* 桩 DOM */ }
    try { refreshSwitcher(true) } catch { /* 列表未就绪：下一次 #list 变更会补 */ }
    try { paintLibSource() } catch { /* 桩 DOM */ }
    /* ①B(P-201)：换语言后这一组自己的文案（标签 / 状态 / 原因 / 提示）也要跟着换 —— 它是补丁画的，
       产物那条 i18n 链管不到它（签里带 `curLang()` ⇒ 这里一调就重建/改写文案）。 */
    try { groupWeBuiltinProps() } catch { /* 面板还没就绪 */ }
    return true
  }

  return {
    setPage, getPage, popOpen, refreshSwitcher, listItems,
    //  ①(2026-09-20 用户第 9 条) 关标签的**幂等**入口与"当前打开了什么"的读数（门禁判"幽灵叉号/假日志"）：
    //  不存在的 id ⇒ 返回 false 且**不写日志**；什么都没打开时 `current` 为 null、`currentCellX` 为 false。
    closeTab: (id) => closeWallpaperTab(id),
    openTabs: () => ({
      current: curId, pinned: (Array.isArray(pinned) ? pinned.slice() : []),
      currentCellX: !!(D && D.querySelector && D.querySelector('.wp-x-cur')),
      tabs: (D && D.querySelectorAll) ? D.querySelectorAll('#editor-tabs .wp-tab').length : -1,
      currentText: String(((D && D.querySelector('#current')) || {}).textContent || ''),
    }),
    paintLangExtras,
    /* ⑤(2026-09-24 用户第 5 条) 换库之后要把侧栏`#list`重画（由 `init()` 里的
       `refreshSidebarList()` 借产物自己的重载链跑）：它需要**本作用域**的两个入口 ——
       `switchToWallpaper`（按 id 复原当前壁纸）与 `currentId`（刷新前记下是谁）。
       为什么必须经 `window.__benchShell`：`initSiteShell` 与 `init()` 是两个作用域，
       直接写裸标识符就是 A7 那组判据抓过的 `ReferenceError`（被 try/catch 吞掉 ⇒ "点了没反应"）。 */
    switchToWallpaper: (id) => switchToWallpaper(id),
    currentId: () => curId,
    logsHeight, setLogsHeight, paintLogsArrow, paintPropsEmpty, paintStatus,
    shellVersion: VER, domIsNew: DOM_NEW, maxLogsForLayout,
    // ⑫a / ⑫c（探针与测试用同一入口）
    setPropsCollapsed, propsCollapsed: propsCollapsedNow, themeMode: currentThemeMode,
    // ①(本轮 #18/#23/#25/#26/#27/#28/#30/#34) 属性面板状态机 / 装饰 / 外链确认（探针与门禁读同一批入口）
    propsPanel: propsPanelState, propsRefresh: refreshPropsPanel, propsDecorate: decoratePropsBody,
    propsExtConfirm: openExternalConfirm, propsExtState: extConfirmState, propsExtClose: closeExternalConfirm,
    propsDecorateList: decorateListRows, propsRaw: PROPS_RAW,
    // ①E(用户第 2 次提「图片展示了两遍」) 面板图片渲染读数（渲染了几个 <img> / src / naturalWidth / 去重账本）
    propsImages: () => propsImages(),
    // ①A1(2026-09-24 用户：「WE 自带的那几个选项永远在壁纸配置最上面，做成可折叠」) 分组读数
    propsGroups: () => propsGroups(),
    propsGroupNow: () => groupWeBuiltinProps(),
    //  ⑰(2026-09-24 用户第 17 条) 「壁纸配置」面板里的下拉栏读数（原生 select 必须为 0、自绘控件在位）
    propsSelectProbe: () => panelSelectProbe(D),
    // ⑭(P-142) 收纳 / 声音控件 / video 声音（X11 真机与门禁读同一批入口）
    navSound: navSound,
    setNavCollapsed: (v) => (navSound ? navSound.setNavCollapsed(v) : null),
    navCollapsed: () => (navSound ? navSound.navCollapsed() : null),
    npOcclusion: () => (navSound ? navSound.npOcclusion() : null),
    /* ②A2(用户：「音量条超出壁纸配置宽度」) 传输条逐元素盒宽（含 `overflow` 判据）—— 探针与门禁同一入口 */
    npGeometry: () => (navSound ? navSound.npGeometry() : null),
    npAudio: () => (navSound ? navSound.audio() : null),
    setVideoVolume: (v) => (navSound ? navSound.setVideoVolume(v) : null),
    videoStage: () => (navSound ? { videos: navSound.stageVideos().length, api: !!navSound.stageApi(), state: navSound.paintProgress() } : null),
    /*  ③(用户第 3 条) 音量控件的落点/状态读数（门禁与真机同一入口）：
        `npVolumeSlider()` = 组件渲染的 `#np-volume`（值/禁用/在不在卡片里/百分数）；
        `npMuteKey()` = 传输行第四键（音量/静音）的 `aria-pressed` / `data-mpw-np-mute`。 */
    npVolumeSlider: () => (navSound && typeof navSound.volumeSlider === 'function' ? navSound.volumeSlider() : null),
    npMuteKey: () => (navSound && typeof navSound.muteKey === 'function' ? navSound.muteKey() : null),
  }
}

export function init() {
  const doc = (typeof document !== 'undefined') ? document : null
  if (!doc) return { ok: false, reason: 'no document' }
  const $ = (sel) => doc.querySelector(sel)
  const langOf = () => (String(doc.documentElement.lang || '').toLowerCase().startsWith('zh') ? 'zh' : 'en')
  let curLang = langOf()

  /* ⑯(2026-09-24 用户第 16 条；⑯b 2026-09-25 **用户复测：还是被往下拽**)
     ── 用户原话（本轮）────────────────────────────────────────────────────────────
     「我说的输出里面输出新消息的时候，不要把我默认跳到最新的消息的地方，这个还是没有实现。下面如果有新消息，
       还是会把我往下面跳。我需要的是**我鼠标滚轮滑到哪里，它就停到哪里**，无论下面刷不刷新都是一样的，
       都是我滑到哪里，他停到哪里，而不是出现一条新消息就往最下面跳。」
     ── 上一版为什么不管用（**真机机制证据**，不是推测）────────────────────────────
     `#logbody` 有**两个写入者**：本补丁的 `logLine()`，以及**上游产物自己**那条日志函数
     `demo/assets/bench-DSKWIqmS.js:87276` 里的 `X.appendChild(a),X.scrollTop=X.scrollHeight`
     —— 它挂在产物自己的 `/api/diag-stream`（EventSource）上，**每一行都无条件跳到最底**。
     上一版只把**本补丁**那条改成"贴底才跟随"，所以渲染器诊断/挂载日志一来（走产物那条路），
     `scrollTop` 照样被写成 `scrollHeight`。改前真机读数（tests 探针，POST /diag 走真实路径）：
     `scrollTop 0 → 2980`（slack 2459 → 0）—— 用户报的"还是会往下跳"就是这一行。
     ── 本版口径（**用户滚到哪就永远停在哪**）────────────────────────────────────
     1) **位置归用户**：只要用户把视口停在不贴底的地方（滚轮/拖动/键盘/显式定位），
        此后**任何**追加都不许改变 `scrollTop` —— 包括产物那条无条件写（在 `#logbody` 实例上
        影子掉 `scrollTop` 访问器：非本补丁写的"跳到底"一律丢弃，并计数）。
     2) **贴底才跟随**：视口真的贴着底（`slack ≤ LOG_STICK_PX`，本轮从 24px **收紧到 2px** ——
        24px 容差内仍会把用户往下拽）时，新行继续跟随。
     3) **只有用户能重新开启跟随**：追加之后紧接着的那次"跳到底"是**自动写**（同一拍里刚 append 过）
        ⇒ 在用户自己滚回底部之前一律丢掉；用户自己滚回底部（`wheel`/拖动/键盘 ⇒ scroll 事件）才恢复跟随。
        测试要模拟"用户滚回底部"时派发一次真实 `wheel` 再定位（见 tests 的 IA5b）。
     4) 判据只看容器自己的三个数（scrollTop/scrollHeight/clientHeight）+ 追加序号，可机读、可复现。
     读数：`__benchPatch.logScrollState()`（`follow/anchor/droppedWrites/guard/appendSeq/lines`）。 */
  const LOG_STICK_PX = 2
  const LOG_GESTURE_MS = 600          // 用户手势（wheel/拖动/键盘）后这段时间内的定位算"用户自己的位置"
  /*  "刚追加完的那一下跳到底"最多算到多久：产物是 `appendChild(a); scrollTop = scrollHeight` **同一拍**，
      所以 50ms 足够识别它；再晚的显式定位（探针/其它代码/用户拖滚动条）就算"有人要把视图放到底"。
      为什么需要这个时间窗：只按"append 序号"判会把**追加之后隔了一拍**的显式写底也当成自动跟随丢掉
      （本轮真机实测：门禁里"用户滚回底部再跟随"那条就是这样被丢的）。 */
  const LOG_AUTO_WRITE_MS = 50
  /** 一个滚动容器的"位置归谁"状态机（`#logbody` 走影子访问器；`#diag-body`/`#dbg-log` 只由本补丁写）。 */
  function makeScrollKeeper(el, key) {
    const k = {
      el, key, follow: true, anchor: 0, dropped: 0, gestures: 0, appends: 0, consumed: 0,
      gestureAt: -1e9, lastAppendAt: -1e9, guardDisabled: false, guard: false, watcher: false, appendHook: false, droppedLines: 0, dropFilter: null,
      nativeSet: null, nativeGet: null, nativeAppend: null, lastReason: 'init',
    }
    const geom = () => {
      const st = Number(el.scrollTop) || 0
      const sh = Number(el.scrollHeight) || 0
      const ch = Number(el.clientHeight) || 0
      return { scrollTop: st, scrollHeight: sh, clientHeight: ch, slack: Math.max(0, sh - ch - st) }
    }
    k.geom = geom
    const bottom = () => { const g = geom(); return g.slack <= LOG_STICK_PX }
    /** 我们自己的写（跟随/定位）：走原生 setter，绕过影子守卫。 */
    const write = (v) => {
      try {
        if (k.nativeSet) k.nativeSet.call(el, v)
        else el.scrollTop = v
      } catch { /* 桩 DOM */ }
    }
    k.write = write
    /** 跟随（贴底时）—— 本补丁自己的追加都走它；不贴底 ⇒ 一个字都不写。 */
    k.followNow = () => {
      if (!k.follow) { k.lastReason = 'user-owned'; return false }
      write(Number(el.scrollHeight) || 0)
      k.lastReason = 'follow'
      return true
    }
    /** 内容被**清空**（清空按钮/换页签）⇒ 旧位置不再有意义：跟随复位（否则清完就永远不跟随了）。 */
    k.resetFollow = () => { k.follow = true; k.anchor = 0; k.consumed = k.appends; k.lastReason = 'reset' }
    /** 追加一拍：记 append 序号与**时刻**（"紧接着的那次跳到底"= 自动写；见 `LOG_AUTO_WRITE_MS`）。 */
    k.noteAppend = () => {
      k.appends++
      k.lastAppendAt = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now())
    }
    /** 影子 `appendChild`：① 记 append 序号（**产物的追加也要记**，否则"追加后自动跳到底"识别不出来）；
     *  ② 给上层一个"这一行要不要写进去"的过滤器（⑦ 用它拦掉产物那句假的"挂载 X"日志）。
     *  返回 true = 已按过滤器丢弃。 */
    k.installAppendHook = () => {
      if (k.appendHook) return true
      try {
        let proto = el
        while (proto && typeof proto.appendChild !== 'function') proto = Object.getPrototypeOf(proto)
        if (!proto) return false
        const native = proto.appendChild
        k.nativeAppend = native
        Object.defineProperty(el, 'appendChild', {
          configurable: true, writable: true,
          value(node) {
            try { if (typeof k.dropFilter === 'function' && k.dropFilter(node)) { k.droppedLines++; return node } } catch { /* 过滤器自己坏 ⇒ 照常追加 */ }
            k.noteAppend()
            return native.call(el, node)
          },
        })
        k.appendHook = true
        return true
      } catch (e) { k.appendHook = false; return false }
    }
    /** 位置观察者：手势计数 + scroll 事件判定"位置归谁"（`#diag-body`/`#dbg-log` 只装这一层）。 */
    k.installWatcher = () => {
      if (k.watcher) return true
      const now = () => ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now())
      const mark = () => { k.gestureAt = now(); k.gestures++ }
      const opts = { passive: true }
      try {
        for (const ev of ['wheel', 'mousewheel', 'pointerdown', 'mousedown', 'touchstart', 'touchmove', 'keydown']) {
          try { el.addEventListener(ev, mark, opts) } catch { /* 桩 DOM */ }
        }
        /* 原生滚动（用户拖动滚动条/滚轮）不会走 setter ⇒ 位置变化只在这里被看见。 */
        el.addEventListener('scroll', () => {
          const g2 = geom()
          if (g2.slack <= LOG_STICK_PX) { k.follow = true; k.anchor = g2.scrollTop; k.lastReason = 'scroll-bottom' }
          else { k.follow = false; k.anchor = g2.scrollTop; k.lastReason = 'scroll-user' }
        }, opts)
        k.watcher = true
        return true
      } catch (e) { k.watcher = false; return false }
    }
    /** 影子 `scrollTop`：只有"合法"的写才落到原生 setter。 */
    k.installGuard = () => {
      if (k.guard) return true
      k.installWatcher()
      k.installAppendHook()
      try {
        let proto = el
        while (proto && !Object.getOwnPropertyDescriptor(proto, 'scrollTop')) proto = Object.getPrototypeOf(proto)
        const desc = proto ? Object.getOwnPropertyDescriptor(proto, 'scrollTop') : null
        if (!desc || typeof desc.set !== 'function' || typeof desc.get !== 'function') return false
        k.nativeSet = desc.set
        k.nativeGet = desc.get
        const now = () => ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now())
        Object.defineProperty(el, 'scrollTop', {
          configurable: true, enumerable: true,
          get() { return desc.get.call(el) },
          set(v) {
            const want = Number(v) || 0
            const g = geom()
            const isBottomWrite = want >= (g.scrollHeight - g.clientHeight) - 0.5
            const afterAppend = k.appends > k.consumed
            /*  "自动跟随"的判据 = 追加之后**紧接着（同一拍内）**的跳到底；只按序号判会把隔了一拍的
                显式写底也算进来（真机踩过：门禁"用户滚回底部"那条被丢掉）。 */
            const autoFollow = afterAppend && ((now() - k.lastAppendAt) <= LOG_AUTO_WRITE_MS)
            const userish = (now() - k.gestureAt) <= LOG_GESTURE_MS
            k.consumed = k.appends
            if (isBottomWrite) {
              /* 追加之后紧接着的"跳到底" = 写入者（产物/别人）想自动跟随：
                 位置在用户手里时**丢掉这一写**（这就是用户报的那一跳）。 */
              if (!userish && autoFollow && !k.follow) { k.dropped++; k.lastReason = 'dropped-auto-bottom'; return }
              if (userish) { k.follow = true; k.anchor = want }
              write(v)                                  // `k.write` 走原生 setter（不经过本影子访问器 ⇒ 不递归）
              k.lastReason = userish ? 'user-bottom' : 'explicit-bottom'
              return
            }
            /* 非底部的定位（滚轮拖动之外的显式定位：探针/代码）⇒ 这个位置归用户，之后不再动。 */
            k.follow = false; k.anchor = want; k.lastReason = 'explicit-position'
            desc.set.call(el, v)
          },
        })
        k.guard = true
        return true
      } catch (e) { k.guard = false; return false }
    }
    k.state = () => {
      const g = geom()
      return {
        container: key, guard: k.guard, appendHook: !!k.appendHook, follow: k.follow, anchor: Math.round(k.anchor),
        droppedWrites: k.dropped, droppedLines: k.droppedLines, gestures: k.gestures, appendSeq: k.appends,
        stickThreshold: LOG_STICK_PX, atBottom: g.slack <= LOG_STICK_PX, lastReason: k.lastReason,
        scrollTop: g.scrollTop, scrollHeight: g.scrollHeight, clientHeight: g.clientHeight, slack: g.slack,
      }
    }
    return k
  }
  const scrollKeepers = new Map()      // key → keeper（`#logbody` 装影子守卫；另两个只借"贴底才跟随"）
  function scrollKeeper(sel, key) {
    const el = $(sel)
    if (!el) return null
    let k = scrollKeepers.get(key)
    if (k && k.el === el) { if (!k.watcher) k.installWatcher(); return k }
    k = makeScrollKeeper(el, key)
    k.installWatcher()
    scrollKeepers.set(key, k)
    return k
  }
  /** ⑯ 输出区：容器 + 影子守卫（幂等；`#logbody` 是产物与本补丁共用元素，必须装）。 */
  function logKeeper() {
    const k = scrollKeeper('#logbody', 'logbody')
    if (!k) return null
    /*  自愈式补装；但**用户显式关掉**（`logScrollGuardSet(false)`，门禁 A/B 用）时不补装。 */
    if (!k.guard && !k.guardDisabled) k.installGuard()
    return k
  }
  const logScrollNow = () => {
    const k = logKeeper()
    if (k) return k.state()
    const body = $('#logbody')
    if (!body) return null
    const st = Number(body.scrollTop) || 0
    const sh = Number(body.scrollHeight) || 0
    const ch = Number(body.clientHeight) || 0
    return { scrollTop: st, scrollHeight: sh, clientHeight: ch, atBottom: (sh - ch - st) <= LOG_STICK_PX, slack: sh - ch - st }
  }
  function logScrollState() {
    const g = logScrollNow()
    const body = $('#logbody')
    return Object.assign({ stickThreshold: LOG_STICK_PX, lines: body && body.children ? body.children.length : -1, autoScrolls: !!(g && g.atBottom) }, g || {})
  }
  /** ⑯b 供门禁做 A/B：临时关掉影子守卫（= 回到"产物无条件跳到底"的改前行为）⇒ 复现那一跳。 */
  function logScrollGuardSet(on) {
    const k = logKeeper()
    if (!k) return null
    const want = on !== false
    if (want === k.guard && want !== false) return k.state()
    if (!want) {
      /*  关掉守卫必须**留住**这个状态：`logKeeper()` 每次调用都会补装（元素被换掉时自愈），
          所以另设一个"用户显式关掉"的闩 —— 否则探针下一次读数就把守卫装回来，
          A/B 对照量到的还是"守卫在位"（本轮真机实测踩到，IA5e 假绿）。 */
      k.guardDisabled = true
      try { delete k.el.scrollTop } catch { /* 桩 DOM */ }
      k.guard = false
      k.lastReason = 'guard-off'
    } else { k.guardDisabled = false; k.installGuard() }
    return k.state()
  }
  /** ⑯b 产物那条"自动跳到底"的计数器（门禁断言"拦下的正是产物那一写"）。 */
  function logScrollProbe() {
    const k = logKeeper()
    return k ? k.state() : null
  }
  function logLine(msg, isErr) {
    const body = $('#logbody')
    if (!body) { console.log('[bench-patch] ' + msg); return }
    const k = logKeeper()
    if (k) k.noteAppend()
    const line = doc.createElement('div')
    if (isErr) line.className = 'err'
    line.textContent = msg
    body.appendChild(line)
    if (k) k.followNow()
    else { try { body.scrollTop = body.scrollHeight } catch { /* 桩 DOM */ } }
  }

  // ①(用户第 6 项 2026-09-19) 工具条 6 个下拉 + 属性面板里的 combo：统一换自绘下拉（幂等；失败逐个退回原生）
  try { enhanceBenchSelects(document); watchBenchPropsSelects(document); scheduleBenchSelects(document) } catch (e) { /* 补丁层不让整页崩 */ }
  // ── 各控件的重绘函数（先定义，applyLang 统一调用）──
  const dprSel = $('#dpr'), dprStatus = $('#status-dpr')
  const paintDpr = () => {
    if (dprStatus) dprStatus.textContent = t(curLang, 'status.dpr', { n: dprSel ? dprSel.value : '1' })
  }
  // ⑸ dpr/fps 一律大写（HTML 已改；这里再兜一次：旧 HTML 缓存 / bundle 重渲染都不会让小写回来）
  const paintUppercaseLabels = () => {
    for (const pair of [['#lab-dpr', 'DPR'], ['#lab-fps', 'FPS']]) {
      const el = $(pair[0])
      if (!el || !el.firstChild || el.firstChild.nodeType !== 3) continue
      const next = uppercaseLabel(el.firstChild.nodeValue, pair[1])
      if (next) el.firstChild.nodeValue = next
    }
  }
  // ⑷ 无上限 FPS：状态栏文案 + tooltip（bundle 的 syncStatusChrome 只会写"上限 N"，所以这里必须最后写）
  const fpsSel = $('#fps'), fpsStatus = $('#status-fps')
  const paintFps = () => {
    if (!fpsStatus) return
    const plan = fpsPlan(fpsSel ? fpsSel.value : '60')
    fpsStatus.textContent = plan.uncapped ? t(curLang, plan.statusKey) : t(curLang, plan.statusKey, plan.statusParams)
    fpsStatus.title = t(curLang, plan.titleKey)
  }
  if (fpsSel) fpsSel.addEventListener('change', () => { paintFps(); setTimeout(paintFps, 0) })
  // ⚠ bundle 的 syncStatusChrome（产物里是 `_t.textContent = \`DPR ${ie.value}\``：硬编码、没有词典键）
  //   被 #dpr / #fps 的 change 直接调用 ⇒ 动这两个下拉会把状态栏**两格一起**改回旧文案。
  //   所以两条链都要重画（实测：只重画 fps，`DPR（设备像素比） 1` 会退回 `DPR 1`）。
  const paintStatusChrome = () => { paintDpr(); paintFps(); paintUppercaseLabels() }
  for (const el of [dprSel, fpsSel]) {
    if (el) el.addEventListener('change', () => { paintStatusChrome(); setTimeout(paintStatusChrome, 0) })
  }
  const toggleLogs = $('#toggle-logs')
  const upIco = $('#ico-logs-up'), downIco = $('#ico-logs-down')
  const paintLogsIcon = () => {
    if (!toggleLogs || !upIco || !downIco) return
    const open = toggleLogs.getAttribute('aria-expanded') !== 'false'
    // A7 用户口径：「输出旁边的箭头应该是**向下**的，点了把输出栏收纳起来」
    //   ⇒ 展开态显示 ArrowDown（点它收纳），折叠态显示 ArrowUp（点它展开）
    if (open) { downIco.removeAttribute('hidden'); upIco.setAttribute('hidden', '') }
    else { upIco.removeAttribute('hidden'); downIco.setAttribute('hidden', '') }
    toggleLogs.setAttribute('title', t(curLang, open ? 'logs.collapse' : 'logs.expand'))
  }
  const diagBox = $('#logs'), offlineTag = $('#offline-tag'), diagReason = $('#diag-offline')
  let diagState = diagOfflineState(200)
  const paintDiag = () => {
    if (offlineTag) {
      if (diagState.offline) { offlineTag.removeAttribute('hidden'); offlineTag.textContent = t(curLang, 'offline.tag'); offlineTag.title = t(curLang, 'offline.diagTitle') }
      else offlineTag.setAttribute('hidden', '')
    }
    if (diagReason) {
      if (diagState.offline) { diagReason.removeAttribute('hidden'); diagReason.textContent = diagReasonText(curLang, backendEnv()) }
      else { diagReason.setAttribute('hidden', ''); diagReason.textContent = '' }
    }
    if (diagBox) diagBox.classList.toggle('bench-diag-off', !!diagState.offline)
  }

  /* ── ⑦(P-158) 「渲染器诊断（/diag）」从**一行死标签**变成**真的页签**：订阅 `/api/diag-stream`（SSE）────
     用户原话：「渲染器诊断打不开（应该显示 8899 页面下面那个日志）」。真因（前端接线，不是服务端）：
       · `#logs .logs-head` 里那个 `<strong>渲染器诊断（/diag）</strong>` 只是**静态文本**，没有处理器；
       · 页面确实收着诊断流 —— 产物自己的 `Jt()` 会 `new EventSource('/api/diag-stream')` 并把 `msg`
         混进 `#logbody`（与补丁日志、渲染器日志混在一起，看不出"哪一条是诊断流"）。
     本段做的事：
       · 两个页签（`#tab-logs` / `#tab-diag`）+ `#logs[data-view="diag"]` 只显示 `#diag-body`；
       · 自己订阅 `/api/diag-stream`（**懒加载**：第一次打开诊断页签才连，省一条常驻 SSE 连接），
         `JSON.parse(e.data)` 取 `{seq,ts,msg,level,source}` 逐条渲染（`parseDiagEvent` 容错）；
       · 环形上限 400 行（本机是 15GB 安卓环境，长跑不能无限涨）；断流/不可用写明确原因（复用 `diagReasonText`）。 */
  const logsPanel = $('#logs'), diagBody = $('#diag-body'), tabLogsBtn = $('#tab-logs'), tabDiagBtn = $('#tab-diag')
  const DIAG_MAX_LINES = 400
  let logsView = 'logs'
  let diagCount = 0
  let diagSource = null
  let diagErrored = false
  function paintLogsTabs() {
    const plan = logsViewPlan(logsView)
    if (logsPanel && logsPanel.setAttribute) logsPanel.setAttribute('data-view', plan.view)
    //  ⚠ 产物 CSS 里有一条 `[hidden]{display:none!important}` ⇒ 光靠 `#logs[data-view="debug"] #debug-body{display:flex}`
    //  压不住 `hidden` 属性（实测计算值仍是 none）。视图切换**同时**把属性摘/挂 —— 显隐只有一个真源。
    try { if (dbgBody) { if (plan.isDebug) dbgBody.removeAttribute('hidden'); else dbgBody.setAttribute('hidden', '') } } catch { /* 桩 DOM */ }
    /* ⑦(2026-09-24 用户第 7 条「调试模式被选中时没有灰色选中框」)：改前这里只对
       `#tab-logs` / `#tab-diag` 切 `active`/`panel-tab` —— 调试页签**从来**拿不到那个灰底
       （`#logs .logs-tab[aria-selected="true"]` 的 `background:color-mix(...14%)`），
       所以点开调试页签只有 `aria-selected` 变了、**看不出被选中**。现在三个页签走同一条循环：
       选中态 = `aria-selected="true"` + `.active`（灰框/灰底的唯一来源）。 */
    for (const [btn, on] of [[tabLogsBtn, plan.isLogs], [tabDiagBtn, plan.isDiag], [tabDebugBtn, plan.isDebug]]) {
      if (!btn) continue
      try { btn.setAttribute('aria-selected', on ? 'true' : 'false') } catch {}
      try { btn.classList.toggle('panel-tab', on) } catch {}
      try { btn.classList.toggle('active', on) } catch {}
    }
    if (tabDiagBtn) {
      const n = t(curLang, 'diag.count', { n: diagCount })
      const label = t(curLang, 'logs.tabDiag') + ' · ' + n
      if (tabDiagBtn.textContent !== label) tabDiagBtn.textContent = label
      tabDiagBtn.title = t(curLang, 'diag.tabTitle')
    }
    if (tabDebugBtn) {
      //  ②(用户第 3 条) 页签标签上的 `· on` 读的是**模式**（开关状态），不是"当前在不在这一页" ——
      //  页签只切视图，模式只由页签内部那个开关改。
      const label = t(curLang, 'logs.debug') + (dbgActive ? ' · on' : '')
      if (tabDebugBtn.textContent !== label) tabDebugBtn.textContent = label
      tabDebugBtn.title = t(curLang, 'logs.tabDebugHint')
    }
    if (dbgModeBox) {
      try { dbgModeBox.checked = !!dbgActive } catch { /* 桩 DOM */ }
      try { dbgModeBox.setAttribute('aria-checked', dbgActive ? 'true' : 'false') } catch { /* 桩 DOM */ }
    }
    if (tabLogsBtn) { tabLogsBtn.textContent = t(curLang, 'logs.tabLogs'); tabLogsBtn.title = t(curLang, 'logs.tabHint') }
    return plan
  }
  function paintDiagBody() {
    if (!diagBody) return 0
    if (diagCount > 0) return diagCount
    const reason = diagErrored
      ? t(curLang, 'diag.lost', { msg: diagErrored === true ? 'error' : String(diagErrored) })
      : (diagState && diagState.offline ? diagReasonText(curLang, backendEnv()) : t(curLang, 'diag.wait'))
    if (diagBody.textContent !== reason) diagBody.textContent = reason
    try { diagBody.setAttribute('data-state', diagCount > 0 ? 'has' : (diagErrored ? 'error' : (diagState && diagState.offline ? 'offline' : 'waiting'))) } catch {}
    return 0
  }
  /** ⑧(2026-09-20 用户第 4 条) 调试页签要能看到**与 :8899 同一份**内容。
   *  `:8899` 的 `#log` 与这里的诊断页签读的是**同一条** `/api/diag-stream`（层信息 / 脚本错误 /
   *  加载日志 / mip 选级都在里面，服务端 `diagEntryLine` 一行模型相同）⇒ 把每一条**原样**
   *  追加进 `#dbg-log`（带 `data-src="diag"` 标记，文本与诊断页签逐字相同），调试页签里就不再
   *  只有"层号 + 层名"。8902 自己的「立即上报 / 截图」按钮保留（在 `pushDiagEntry` 之外，互不影响）。 */
  function dbgMirrorDiagLine(entry) {
    if (!dbgLog || !entry) return null
    const div = doc.createElement('div')
    div.className = 'dbg-line' + (entry.level === 'error' ? ' dbg-err' : '')
    div.dataset.src = 'diag'
    div.dataset.source = entry.source
    div.dataset.seq = entry.seq || ''
    div.textContent = entry.line
    dbgLog.appendChild(div)
    while (dbgLog.children.length > DBG_MAX_LINES) dbgLog.removeChild(dbgLog.firstChild)
    { const k = scrollKeeper('#dbg-log', 'dbg'); if (k) { k.noteAppend(); k.followNow() } }
    return entry
  }
  function pushDiagEntry(raw) {
    const entry = parseDiagEvent(raw)
    if (!entry || !diagBody) return null
    try { dbgMirrorDiagLine(entry) } catch { /* 调试页签没就绪不影响诊断页签 */ }
    if (diagCount === 0) diagBody.textContent = ''          // 第一条消息把占位提示清掉
    const line = doc.createElement('div')
    line.className = 'diag-line' + (entry.level === 'error' ? ' err' : '')
    line.dataset.seq = entry.seq || ''
    line.dataset.level = entry.level
    line.dataset.source = entry.source
    line.textContent = entry.line
    diagBody.appendChild(line)
    diagCount++
    while (diagBody.children.length > DIAG_MAX_LINES) diagBody.removeChild(diagBody.firstChild)
    /* ⑯b 同一条口径：诊断栏也**只在贴底时**跟随（用户滚上去看上面那几条时，新消息不许把它拽回来）。 */
    { const k = scrollKeeper('#diag-body', 'diag'); if (k) { k.noteAppend(); k.followNow() } }
    try { diagBody.setAttribute('data-count', String(diagCount)) } catch {}
    try { diagBody.setAttribute('data-state', 'has') } catch {}
    paintLogsTabs()
    return entry
  }
  /** 懒连接：只在第一次打开诊断页签时建一条 SSE（产物自己那条是它的事，两条互不影响）。 */
  function ensureDiagStream() {
    if (diagSource || typeof EventSource !== 'function') return diagSource
    try {
      diagSource = new EventSource('/api/diag-stream')
      diagSource.onmessage = (ev) => { try { pushDiagEntry(ev && ev.data) } catch { /* 单条坏数据不拖垮流 */ } }
      diagSource.onerror = () => {
        diagErrored = diagErrored || 'error'
        try { diagBody && diagBody.setAttribute('data-state', 'error') } catch {}
        if (diagCount === 0) paintDiagBody()
        // 服务端把 EventSource 的自动重连交给浏览器；这里不 close（close 会让重连永不发生）
      }
    } catch (e) { diagErrored = (e && e.message) || 'throw' }
    return diagSource
  }
  function setLogsView(view) {
    const plan = logsViewPlan(view)
    const prev = logsView
    logsView = plan.view
    paintLogsTabs()
    /* ②(2026-09-20 用户第 3 条 · 用户实测"点渲染器日志那一页会把调试模式关掉")：
       切页签**永不改变调试模式状态** —— 这里不再调 `setDebugMode(plan.isDebug)`。
       页签只管"看哪一页"；调试模式只由调试页签内部那个开关（或 Alt 退出）改。
       键盘纪律照旧：`←/→/Ctrl/Alt` 只在**调试视图可见且模式开着**时被接管（`dbgSyncKeys()`）。
       catch 里仍然留痕：真机事故（自证 Z4）就是这里把 ReferenceError 吞了 ⇒ 门禁断言它为空串。 */
    try { dbgSyncKeys() } catch (e) {
      try { if (typeof window !== 'undefined') window.__benchDebugBootErr = String((e && e.message) || e) } catch { /* 无 window */ }
    }
    void prev
    if (plan.isDiag) {
      ensureDiagStream()
      if (diagCount === 0) paintDiagBody()
      try { if (diagBody && diagBody.focus) diagBody.focus({ preventScroll: true }) } catch {}
    }
    return plan.view
  }
  /* ── ②(P-164) 调试模式：逐层查看（左右键）+ 立即上报 + 截图 + 当前层信息/日志 ───────────────────
     与 :8899 的逐层调试**同一效果**（切到某一层就把它单独留下、其余隐藏），但落点不同：
     :8899 跑的是本仓 core（认 `layer.__lnOnly` 那套约定），:8902 的 iframe 跑的是 minified 上游产物，
     它**没有** `__lnOnly` —— 它有 `window.__sceneLayers`（= `scene.layers`，每层带 `visible` setter，
     写它会顺带 `recomputeVisibility()`）⇒ 这里用 `layer.visible` 做隔离，退出时全部恢复可见。
     键盘纪律（用户明确要求）：**只在本页签激活期间**装 keydown（capture），退出**立刻卸掉** ——
     ←/→/↑/↓/Ctrl/Alt 在调试模式外一个都不拦。 */
  const dbgBody = $('#debug-body'), dbgLayer = $('#dbg-layer'), dbgLog = $('#dbg-log'), dbgState = $('#dbg-state')
  const dbgReportBtn = $('#dbg-report'), dbgShotBtn = $('#dbg-shot'), tabDebugBtn = $('#tab-debug')
  const dbgModeBox = $('#dbg-mode')       // ②(用户第 3 条) 页签内部那个**唯一**的模式开关
  let dbgActive = false
  let dbgKeyHandler = null
  let dbgTimer = null
  let dbgIndex = -1
  let dbgPath = []   // ①(2026-10-04) Ctrl 进/出组合层的层级栈（存父层下标）
  let dbgLines = []
  const DBG_MAX_LINES = 300
  //  ⚠ 定时器必须**自带一份**：`every`/`stopEvery` 只存在于 `initSiteShell(deps)` 的作用域（本函数的兄弟），
  //  在这里引用它们是未声明标识符 ⇒ 抛 ReferenceError（见下 `dbgStartPoll` 的事故注释）。
  const dbgEvery = (typeof setInterval === 'function') ? setInterval : null
  const dbgStopEvery = (typeof clearInterval === 'function') ? clearInterval : null
  const sceneLayerList = () => {
    try {
      const w = frameEl && frameEl.contentWindow
      const L = w && w.__sceneLayers
      return Array.isArray(L) && L.length ? L : null
    } catch { return null }
  }
  function dbgPush(msg, isErr) {
    const line = '[' + new Date().toLocaleTimeString('zh-CN', { hour12: false }) + '] ' + String(msg)
    dbgLines.push({ line, isErr: !!isErr })
    while (dbgLines.length > DBG_MAX_LINES) dbgLines.shift()
    if (!dbgLog) return
    const div = doc.createElement('div')
    if (isErr) div.className = 'dbg-err'
    div.textContent = line
    dbgLog.appendChild(div)
    while (dbgLog.children.length > DBG_MAX_LINES) dbgLog.removeChild(dbgLog.firstChild)
    { const k = scrollKeeper('#dbg-log', 'dbg'); if (k) { k.noteAppend(); k.followNow() } }
  }
  /** 把"只留第 i 层可见"落到渲染器（数组为空 ⇒ 全部恢复）。
      ⚠ **必须走 `__lnHidden`**（真机取证 2026-09-23，无头 Firefox + WebGL2 预置项）：本仓 core 每帧按自己的
      状态重算 `visible`（`recomputeVisibility()` 与"脚本 raw 对象 → scene.layers"的同步回写都会改它）。
      直接测：宿主把 5 层写成 `[F,F,T,F,F]`，**1.6s 后读回是 `[T,T,T,T,F]`** —— 隔离被渲染器自己冲掉，
      表现出来就是"步进只换了层号文字、画面没隔离"。
      `__lnHidden` 是**绘制期**判据（core 的 draw 循环每帧 `if (layer.__lnHidden) continue`，与 `:8899` 的
      `?ln=N` 逐层调试同一条约定），没有任何一帧会去重算它 ⇒ 宿主写进去就稳定生效。容器层不隐藏（与
      `?ln=` 同语义：容器只承载父子链/定位，本来就不参与绘制）。`visible` 仍然一并写：对只认这套的渲染器
      （上游产物档）保持原行为。
      ①(2026-10-11 用户第 2 条) 再补 `__lnShown`：**被隔离出来的那一层如果是文件里 `visible:false`
      的层，也得真的显示**（否则"逐层查看"翻到这些层时画面永远是空的 —— 与勾选面板同一个病根）。
      退出隔离（`index < 0`）时**显式写 false**（不 delete）：不残留"幽灵显示"。 */
  function dbgApplyIsolation(list, index) {
    const L = list || sceneLayerList()
    if (!L) return 0
    let n = 0
    for (let i = 0; i < L.length; i++) {
      const hide = (index >= 0) && (i !== index)
      try { L[i].__lnHidden = hide && !L[i].isContainer; n++ } catch { /* 单层失败不影响其它层 */ }
      try { L[i].__lnShown = (index >= 0) && (i === index) } catch { /* 老渲染器不认：忽略 */ }
      try { L[i].visible = (index < 0) ? true : (i === index) } catch { /* 只认一种约定的渲染器 */ }
    }
    return n
  }
  function dbgPaint() {
    const plan = layerInfoPlan(sceneLayerList(), dbgIndex)
    if (dbgLayer && dbgLayer.textContent !== plan.text) dbgLayer.textContent = plan.text
    if (dbgState) {
      const st = dbgActive ? t(curLang, 'dbg.on') : t(curLang, 'dbg.off')
      if (dbgState.textContent !== st) dbgState.textContent = st
    }
    try { if (dbgBody) dbgBody.setAttribute('data-dbg', dbgActive ? 'on' : 'off') } catch { /* 桩 DOM */ }
    try { if (dbgBody) dbgBody.setAttribute('data-layers', String(plan.count)) } catch { /* 桩 DOM */ }
    try { lswPaintHighlight() } catch { /* P-240 面板未就绪（桩 DOM）——高亮不是主链路，吞掉 */ }
    paintDbgTab()                                // ⑧ 页签文案 ON/OFF 与 dbgActive **同一次**更新
    return plan
  }
  /* ⑧(2026-09-24 用户第 8 条)「调试模式」页签的文案随**唯一依据** —— 页签里那个复选框
     (`#dbg-mode.checked`) —— 显示 `调试模式·ON` / `调试模式·OFF`，ON 用正常绿、OFF 用正常红
     （不刺眼：走 `--bench-dbg-on/off` 两个变量，暗/亮主题各一份）。
     为什么必须显式重写文案：`#tab-debug` 上挂着 `data-i18n="logs.debug"`，`applyStaticI18n()`
     会在首屏与每次切语言时把 `textContent` 写回"调试模式"⇒ 任何一次语言切换都会把 `·ON` 抹掉。
     所以：① 语言链（`applyLang`）里在 `applyStaticI18n` **之后**补一次本函数；② 复选框
     `change` 与探针 `setDebugMode()` 两条路都汇到 `setDebugMode()` ⇒ 那里也补一次。
     幂等：同值不写 DOM（与 `paintPropsEmpty` 同一条防互激纪律）。 */
  function paintDbgTab() {
    if (!tabDebugBtn) return null
    const on = !!dbgActive                                   // 唯一依据：模式状态（= 复选框勾选态，见 setDebugMode）
    const text = t(curLang, on ? 'logs.debugOn' : 'logs.debugOff')
    try {
      if (tabDebugBtn.textContent !== text) tabDebugBtn.textContent = text
      tabDebugBtn.setAttribute('data-dbg', on ? 'on' : 'off')
      tabDebugBtn.setAttribute('title', t(curLang, 'dbg.switchTip'))
      tabDebugBtn.setAttribute('data-bench-dbg-label', text)
    } catch { /* 桩 DOM */ }
    return { on, text }
  }
  /*  ⚠(真机实测) `#tab-debug` 上挂着 `data-i18n="logs.debug"`，**产物自己那趟 i18n 重放**会把它写回
      "调试模式 / Debug mode"（实测：首屏补丁写对了 `·OFF`，随后被写回去 ⇒ `dbgTabState().text` 少了后缀）。
      修法：给它挂一个只盯**这个按钮文案**的 MutationObserver（同值不写 ⇒ 不自激），谁写回去就补一次。
      为什么不用轮询：这条链在"释放"之后必须**彻底安静**（用户第 19 条），不能常驻定时器。 */
  try {
    if (tabDebugBtn && typeof MutationObserver === 'function') {
      let t0 = null
      new MutationObserver(() => {
        if (t0) clearTimeout(t0)
        t0 = setTimeout(() => { t0 = null; try { paintDbgTab() } catch { /* 桩 DOM */ } }, 0)
      }).observe(tabDebugBtn, { childList: true, characterData: true, subtree: true })
    }
  } catch { /* 桩 DOM */ }
  /** 页签状态的可判据快照（门禁读它：文案 / 灰框 / 颜色 / 选中依据）。 */
  function dbgTabState() {
    const btn = tabDebugBtn
    const box = dbgModeBox
    let cs = null
    try { cs = btn && btn.ownerDocument && btn.ownerDocument.defaultView ? btn.ownerDocument.defaultView.getComputedStyle(btn) : null } catch { cs = null }
    const cls = (() => { try { return btn ? String(btn.className || '') : '' } catch { return '' } })()
    return {
      checked: !!(box && box.checked),                       // 唯一依据（checkbox）
      mode: !!dbgActive,
      text: (() => { try { return btn ? String(btn.textContent || '') : '' } catch { return '' } })(),
      ariaSelected: (() => { try { return btn ? String(btn.getAttribute('aria-selected') || '') : '' } catch { return '' } })(),
      cls,
      /* "灰框"判据：① `.active` + `aria-selected=true`；② 背景不是全透明（Firefox 对 `color-mix()`
         回的是 `color(srgb r g b / a)`，所以**不能**只认 `rgba(` —— 实测第一版就是这么假红的）；
         ③ 那条 `inset 0 0 0 1px var(--border)` 的灰框（选中态唯一来源，见 SITE_LAYOUT_CSS）。 */
      boxGray: /active/.test(cls) && (() => {
        const bgc = String((cs && cs.backgroundColor) || '')
        const transparent = !bgc || /^transparent$/i.test(bgc) || /rgba?\(0,\s*0,\s*0,\s*0\)/.test(bgc) || /\/\s*0\s*\)/.test(bgc)
        const ring = /inset/.test(String((cs && cs.boxShadow) || ''))
        return !transparent || ring
      })(),
      bg: cs ? String(cs.backgroundColor) : null,
      boxShadow: cs ? String(cs.boxShadow || '') : null,
      color: cs ? String(cs.color) : null,
      minW: cs ? String(cs.minWidth || '') : null,
      rect: (() => { try { const r = btn && btn.getBoundingClientRect ? btn.getBoundingClientRect() : null; return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null } catch { return null } })(),
    }
  }
  /** 一层一层看：dir=±1 步进、±10 跳、0 表示"恢复全部可见"（index=-1）。
   *  ①(2026-10-04) **在"当前层级"内步进**：顶层 = 无父层的层；进了组合层（Ctrl）后 = 那一层的子层，
   *  与 :8899 的 `?ln=` 逐层调试同语义（`demo.html` 的 `←/→ ±1、↑/↓ ±10、Ctrl 进/出组合`）。 */
  function dbgStep(dir) {
    const L = sceneLayerList()
    if (!L) { dbgPush(t(curLang, 'dbg.noScene'), true); dbgIndex = -1; dbgPath = []; dbgPaint(); return null }
    if (dir === 0) { dbgPath = []; dbgIndex = -1 }
    const level = layerLevelOf(L, dbgPath).list
    const pos = level.indexOf(dbgIndex)
    const next = (dir === 0) ? { index: -1 } : layerStepPlan(level.length, pos, dir)
    dbgIndex = (next.index < 0) ? -1 : level[next.index]
    const n = dbgApplyIsolation(L, dbgIndex)
    const info = layerInfoPlan(L, dbgIndex)
    dbgPush(dbgIndex < 0 ? ('恢复全部图层可见（' + n + ' 层）') : (info.text + (dbgPath.length ? '   [组内 ' + dbgPath.length + ' 级，Ctrl 退出]' : '')))
    dbgPaint()
    return { index: dbgIndex, count: level.length, applied: n, path: dbgPath.slice() }
  }
  /** ①(2026-10-04) **Ctrl = 进/出组合层**：当前层有子层 ⇒ 下钻（子层内继续用 ←/→）；在组内 ⇒ 上浮。 */
  function dbgToggleGroup() {
    const L = sceneLayerList()
    if (!L) { dbgPush(t(curLang, 'dbg.noScene'), true); return null }
    const plan = debugGroupPlan(L, dbgIndex, dbgPath)
    dbgPath = plan.path
    dbgIndex = plan.index
    const n = plan.op === 'none' ? 0 : dbgApplyIsolation(L, dbgIndex)
    dbgPaint()
    dbgPush(plan.op === 'enter'
      ? ('进入组合层 #' + dbgIndex + '（子层 ' + layerLevelOf(L, dbgPath).list.length + ' 个：←/→ 组内步进，Ctrl 退出）')
      : (plan.op === 'exit' ? ('退出组合层（回到 ' + (dbgPath.length ? '上一级' : '顶层') + '）') : '这一层没有子层（Ctrl 只对组合层生效）'))
    return { op: plan.op, index: dbgIndex, path: dbgPath.slice(), applied: n }
  }
  function dbgOnKey(ev) {
    const plan = debugKeyPlan(ev && ev.key, { active: dbgActive })
    if (!plan.capture) return
    try { if (ev.preventDefault) ev.preventDefault() } catch { /* 合成事件 */ }
    try { if (ev.stopPropagation) ev.stopPropagation() } catch { /* 合成事件 */ }
    try { if (plan.swallowModifier && ev.stopImmediatePropagation) ev.stopImmediatePropagation() } catch { /* 合成事件 */ }
    if (plan.op === 'next') return dbgStep(1)
    if (plan.op === 'prev') return dbgStep(-1)
    if (plan.op === 'next10') return dbgStep(10)
    if (plan.op === 'prev10') return dbgStep(-10)
    if (plan.op === 'reset') return dbgStep(0)
    if (plan.op === 'toggleGroup') return dbgToggleGroup()
    //  Alt = **显式退出调试模式**（用户动作，不是"切页签"）：模式关 + 视图回输出一起收尾。
    if (plan.op === 'exit') { setDebugMode(false); setLogsView('logs'); return null }
    return null
  }
  function dbgInstallKeys() {
    if (dbgKeyHandler || typeof addEventListener !== 'function') return false
    dbgKeyHandler = dbgOnKey
    addEventListener('keydown', dbgKeyHandler, true)
    return true
  }
  function dbgRemoveKeys() {
    if (!dbgKeyHandler) return false
    try { removeEventListener('keydown', dbgKeyHandler, true) } catch { /* ignore */ }
    dbgKeyHandler = null
    return true
  }
  /** 键盘路由的**唯一**判据：模式开着 **且** 调试视图正显示着。
   *  两件事各自独立（模式由开关改、视图由页签改），但"接管键盘"必须两者同时成立 ——
   *  这样既满足"切页签不改模式"，也保持 P-164 的键盘纪律（离开这一页就不再吞 ←/→/Ctrl/Alt）。 */
  function dbgKeysWanted() { return !!dbgActive && logsView === 'debug' }
  function dbgSyncKeys() {
    const want = dbgKeysWanted()
    if (want) return dbgInstallKeys()
    return dbgRemoveKeys()
  }
  function dbgStartPoll() {
    //  真机事故（P-164 自证 Z4 抓到）：这里原本写的是 `every`（另一个作用域的局部名）⇒ ReferenceError 被
    //  `setLogsView` 的 try/catch 吞掉 ⇒ 调试页签"键盘装上了、激活标记也是 true，日志却一行没有"。
    if (dbgTimer || !dbgEvery) return dbgTimer
    dbgTimer = dbgEvery(() => { try { dbgPaint() } catch { /* ignore */ } }, 800)
    return dbgTimer
  }
  function dbgStopPoll() {
    if (dbgTimer && dbgStopEvery) { dbgStopEvery(dbgTimer); dbgTimer = null }
  }
  /** 调试模式开/关（进出页签都走这里 ⇒ 键盘与图层状态只有一处收尾）。 */
  function setDebugMode(on) {
    const want = !!on
    if (want === dbgActive) { dbgPaint(); return dbgActive }
    dbgActive = want
    if (want) {
      dbgSyncKeys()                              // 模式开 ≠ 一定接管键盘：还要调试视图正显示着
      dbgStartPoll()
      const L = sceneLayerList()
      dbgPush(t(curLang, 'dbg.on') + (L ? ('（' + L.length + ' 层）') : ''))
      dbgStep(0)
    } else {
      dbgRemoveKeys()                            // 关模式一定卸干净（无论当前在哪一页）
      dbgStopPoll()
      dbgApplyIsolation(null, -1)                 // 退出必须把图层全部恢复可见
      lswApply()                                  // P-240：再把用户自己的隐藏集补回去 —— 调试退出**不清**勾选状态（任务书 §2.2）
      dbgIndex = -1
      dbgPush(t(curLang, 'dbg.off'))
      dbgPaint()
    }
    return dbgActive
  }
  /** 「立即上报」：载荷与 :8899 同一份诊断内容；落点依次 /report → /baseline → /diag（把实际落点写进日志）。 */
  async function dbgReport() {
    const diagLines = (() => {
      try {
        return [...document.querySelectorAll('#diag-body .diag-line')].map((l) => String(l.textContent || ''))
      } catch { return [] }
    })()
    const plan = debugReportPlan({
      ts: Date.now(), id: (() => { try { return String((doc.querySelector('#current') || {}).textContent || '') } catch { return '' } })(),
      url: String(location.href), ua: String(navigator.userAgent || ''),
      debugMode: dbgActive,
      layers: (() => { const i = layerInfoPlan(sceneLayerList(), dbgIndex); return { count: i.count, index: i.index, name: i.name, type: i.type } })(),
      media: (() => { try { const a = window.__benchShell && window.__benchShell.navSound; const m = a ? a.mediaList() : null; return { videos: m ? m.vids.length : 0, audios: m ? m.auds.length : 0 } } catch { return { videos: 0, audios: 0 } } })(),
      diag: diagLines,
    })
    const body = JSON.stringify(plan)
    try { localStorage.setItem('bench-debug-report', body) } catch { /* 隐私模式 */ }
    dbgPush(t(curLang, 'dbg.reporting'))
    let done = null
    for (const route of DEBUG_REPORT_ROUTES) {
      try {
        const r = await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
        if (r && r.ok) { done = { route, bytes: body.length }; break }
        done = done || { route, bytes: body.length, status: r ? r.status : 0 }
      } catch (e) { done = done || { route, bytes: body.length, err: (e && e.message) || String(e) } }
    }
    const where = done && done.route ? (done.route + (done.status ? (' → HTTP ' + done.status) : '')) : '(none)'
    if (done && !done.status) dbgPush(t(curLang, 'dbg.reported', { where, bytes: body.length }))
    else dbgPush(t(curLang, 'dbg.reportFail', { msg: where + '（服务端未提供 /report 与 /baseline 时只能进 /diag 环形缓冲）' }), true)
    try { if (dbgState) dbgState.setAttribute('data-report', where) } catch { /* 桩 DOM */ }
    return { ...done, plan }
  }
  /** 「截图」：走渲染器自己的 `__wp.capture()`（JPEG data URL），失败给明确原因（画布不可用/被污染）。 */
  function dbgShot() {
    let data = null
    let why = ''
    try {
      const w = frameEl && frameEl.contentWindow
      const api = w && w.__wp
      if (api && typeof api.capture === 'function') data = api.capture(0)
      else why = '__wp.capture 不可用（渲染器未就绪）'
    } catch (e) { why = String((e && e.message) || e) }
    if (!data) {
      dbgPush(t(curLang, 'dbg.shotFail', { why: why || 'capture() 返回空（画布不可用或被跨源内容污染）' }), true)
      return null
    }
    const name = 'bench-shot-' + Date.now() + '.jpg'
    try {
      const a = doc.createElement('a')
      a.href = data; a.download = name
      doc.body.appendChild(a); a.click(); a.remove()
    } catch { /* 桩 DOM */ }
    dbgPush(t(curLang, 'dbg.shotOk', { name, kb: Math.round(data.length / 1024) }))
    return { name, bytes: data.length }
  }
  if (dbgReportBtn) dbgReportBtn.addEventListener('click', () => { dbgReport() })
  if (dbgShotBtn) dbgShotBtn.addEventListener('click', () => { dbgShot() })
  /* ②(用户第 3 条) 模式开关**只在这里**：点它才改模式；点页签只切视图。
     外部（探针/门禁）走的也是同一个入口：`__benchPatch.setDebugMode(v)`。 */
  if (dbgModeBox) {
    try { dbgModeBox.checked = !!dbgActive } catch { /* 桩 DOM */ }
    dbgModeBox.addEventListener('change', () => { try { setDebugMode(!!dbgModeBox.checked) } catch (e) { try { if (typeof window !== 'undefined') window.__benchDebugBootErr = String((e && e.message) || e) } catch {} } })
  }
  //  页签 = **纯切页**（不再有任何模式副作用）
  if (tabDebugBtn) tabDebugBtn.addEventListener('click', () => setLogsView('debug'))

  if (tabLogsBtn) tabLogsBtn.addEventListener('click', () => setLogsView('logs'))
  if (tabDiagBtn) tabDiagBtn.addEventListener('click', () => setLogsView('diag'))
  paintLogsTabs()
  paintDiagBody()
  paintDbgTab()                                // ⑧ 首屏就把页签写成 `调试模式·ON/OFF`（此时 dbgActive=false ⇒ OFF）

  /* ══════ P-240（2026-10-06 任务书 §2）图层开关：逐层诊断台 ══════
     目标（任务书原话）：不开控制台、不改代码，就能在页面上逐层开关、单层隔离、把状态一键复制出来
     贴给别人 —— 用来判断"到底哪个图层渲染有问题"。
     · 落点：tb-row4「流式播放」之后（bench-ui-headless LS1 用相邻兄弟钉住 DOM 位置）。
     · 写入通道：`layer.__lnHidden`（绘制期判据：core 每帧 `if (layer.__lnHidden) continue`，与
       `?ln=` 同一条约定）+ ①(2026-10-11 用户第 2 条) `layer.__lnShown`（**强制显示**，绘制期判据：
       core `if (layer.__lnShown) __layerVis = true`，与 `__lnHidden` 同一处）。
       ⚠ 不写 `layer.visible` —— 那会被逐帧 raw→layer 同步扳回去（P-164 取证）。
     · 生效范围：只在「本仓渲染器」档（上游产物不认 `__lnHidden`/`__lnShown`）⇒ 那一档整控件禁用并写明原因。
     · ①(2026-10-11 用户第 2 条「勾选态与壁纸文件不一致」) 两处修复：
       (a) **勾选态来源 = 文件语义**：缺省勾选 = `layer.visible !== false`（= 渲染器装载时按
           `evalVisibleOutcome` 算好并落盘的值）⇒ 文件里 `visible:false` 的层缺省**不勾**；
           容器层 / 光源层 / **无绘制源的层（语料里的 sound/mp3 层）**一律判"不可显示"⇒ 不勾且置灰
           （`layerDrawKind()`，判据与 core 的 `__srcStats` 同序）。
       (b) **勾上就必须真的显示**：文件里 false 的层被勾上 ⇒ 写 `layer.__lnShown = true` ⇒ 绘制期
           强制显示。这是**唯一**能覆盖字面 `visible:false` 的通道：属性覆盖链（`POST /api/props`）
           只覆盖带 `{user:…}` 绑定的层（`evalVisibleOutcome` 对无绑定直接 `reason:'static'`），
           而写 `layer.visible` 会被逐帧 raw→layer 同步扳回（P-164）。
     · 状态：`lswHidden`（用户取消勾选，**进 `?hide=`**）+ `lswShown`（文件里 false 但被用户勾上 =
       强制显示，**不进 URL**：那一层本来就没画，写进 `?hide=` 只会把参数撑长）；两者各带"下标 → 层名"
       凭据，重挂载后走同一套对账（`rematchHiddenIndices`）⇒ 不残留"幽灵显示"。
     · 与调试模式（任务书 §2.2）：调试隔离临时覆盖 `__lnHidden`/`__lnShown`；面板行高亮跟随
       `dbgIndex`，行上可一键「只留这一层」（= 只勾选它，同时把隔离跳过去，立即见效）；调试退出后
       **恢复用户自己的勾选集**（`lswApply`），绝不顺手清掉。勾选改动在隔离生效期间只记账、退出调试
       时统一落层 ⇒ 不出现两套状态打架。
     · 定时器纪律（P-164 用户第 19 条：外壳不能留常驻定时器）：重挂载探测**不用 interval** ——
       订阅 iframe `load` + 渲染器的 `mpw-first-frame` 消息，各带一串**有界**的迟到检查
       （`__sceneLayers` 在 parseScene 后、首帧前发布 ⇒ 首帧消息到达时必然已在；超时链只为兜住
       消息丢失的老产物档），跑完即静默。 */
  const lswRoot = $('#layer-switch'), lswBtn = $('#layer-switch-btn'), lswPanel = $('#layer-switch-panel')
  const lswListEl = $('#layer-switch-list'), lswStatusEl = $('#layer-switch-status')
  const lswAllBtn = $('#layer-all'), lswNoneBtn = $('#layer-none'), lswOnlyCurBtn = $('#layer-only-cur')
  const lswCopyBtn = $('#layer-copy-state')
  let lswHidden = new Set()      // 用户取消勾选的层（__sceneLayers 下标）；**进 ?hide=**
  let lswNames = new Map()       // 下标 → 隐藏时记下的显示名（重挂载对账凭据）
  let lswShown = new Set()       // ①(2026-10-11) 文件里 visible:false 但被用户勾上 = 强制显示（不进 URL）
  let lswShownNames = new Map()  // 同上：强制显示时记下的显示名（重挂载对账凭据）
  let lswSeenArr = null          // 上次应用过的 __sceneLayers 数组本体（换成新数组 = 重挂载/新挂载）
  let lswOpen = false
  //  首屏 URL：?hide=1,4,7（diag-flag-check 对账的**读点**必须走 new URLSearchParams(location.search)）
  const lswUrlHide = (() => { try { return new URLSearchParams(location.search).get('hide') } catch { return null } })()
  if (lswUrlHide != null && lswUrlHide !== '') lswHidden = new Set(parseHideParam(lswUrlHide))
  /** 控件此刻是否可用；不可用时给出**为什么**（写进 title，任务书：禁用并在标题里说明原因）。 */
  function lswEnabledNow() {
    try { if (rendererSrcNow() !== 'repo') return { ok: false, why: 'upstream' } } catch { /* 探针缺失按可用算 */ }
    return sceneLayerList() ? { ok: true, why: '' } : { ok: false, why: 'nomount' }
  }
  /** 当前状态（行数据 + 渲染写入计划 + 计数）：**唯一口径** = 纯函数 `layerSwitchState()`。 */
  function lswStateNow(L) {
    return layerSwitchState(L || sceneLayerList() || [], lswHidden, lswShown)
  }
  /** 把勾选态落到渲染层：`__lnHidden`（隐藏）/ `__lnShown`（强制显示）**每层都显式赋值** ——
      不适用时写 `false`（**不 delete**：读数看得见，且"取消勾选后标记残留"这条幽灵显示从根上不可能）。 */
  function lswApply(list) {
    const L = list || sceneLayerList()
    if (!L) return 0
    let n = 0
    for (const { i, hidden, shown } of layerSwitchState(L, lswHidden, lswShown).plan) {
      try {
        L[i].__lnHidden = hidden
        L[i].__lnShown = shown
        if (hidden) n++
      } catch { /* 单层失败不影响其它层 */ }
    }
    return n
  }
  function lswCaptureNamesIn(L, set) {
    const m = new Map()
    for (const i of set) { if (i < L.length) { try { m.set(i, layerDisplayName(L[i], i)) } catch { /* 桩 */ } } }
    return m
  }
  function lswCaptureNames(L) { return lswCaptureNamesIn(L, lswHidden) }
  /** 隐藏集 ⇄ 本页 URL 的 `?hide=`（空集 = 删除参数）。`history.replaceState` 不留历史项。 */
  function lswSyncUrl() {
    const v = formatHideParam([...lswHidden])
    let href = null
    try {
      const u = new URL(location.href)
      if (v) u.searchParams.set('hide', v)
      else u.searchParams.delete('hide')
      href = String(u.href)
    } catch { return false }
    if (href === String(location.href)) return false
    try { history.replaceState(null, '', href); return true } catch { return false }
  }
  function lswRowEl(i) {
    try { return lswListEl ? lswListEl.querySelector('.lsw-row[data-ln="' + Number(i) + '"]') : null } catch { return null }
  }
  /** 行状态对账（**集合/文件语义是唯一依据**；「只留这层」「全选」「重挂载」这类批量操作后把行刷回来）。
   *  ①(2026-10-11 用户第 2 条) 勾选态改由 `lswStateNow()` 给（= 文件语义 + 用户覆盖），
   *  并把 `data-file-hidden` / `data-forced` / `data-drawable` 与 title 一起同步 —— 行是**呈现**，
   *  不是第二份状态。顺带写 title：调试隔离期间如实说"改动已记录、退出后生效"（§2.2 不打架）。 */
  function lswSyncChecks() {
    if (!lswListEl) return
    const L = sceneLayerList()
    const st = L ? lswStateNow(L) : null
    for (const row of lswListEl.querySelectorAll('.lsw-row')) {
      const i = Number(row.getAttribute('data-ln'))
      const cb = row.querySelector('input[type="checkbox"]')
      if (!cb) continue
      const r = (st && st.rows[i]) || null
      const want = !!(r && r.checked)
      if (cb.checked !== want) cb.checked = want
      if (r) {
        const set = (k, on) => { if (on) { if (row.getAttribute(k) !== '1') row.setAttribute(k, '1') } else if (row.hasAttribute(k)) row.removeAttribute(k) }
        set('data-drawable', !!r.drawable)
        set('data-file-hidden', !!r.fileHidden)
        set('data-forced', !!r.forced)
        cb.disabled = !r.drawable
      }
      const title = !r || !r.drawable ? (r && r.isContainer ? t(curLang, 'layers.container') : t(curLang, 'layers.noSource'))
        : (dbgActive ? t(curLang, 'layers.dbgDeferred')
          : (r.forced ? t(curLang, 'layers.forced') : (r.fileHidden ? t(curLang, 'layers.fileHidden') : '')))
      if (cb.getAttribute('title') !== title) cb.setAttribute('title', title)
    }
  }
  /** 调试模式当前层 → 行高亮（dbgPaint 每次都会调到这里；任务书 §2.2）。 */
  function lswPaintHighlight() {
    if (!lswListEl) return 0
    const cur = dbgActive ? dbgIndex : -1
    let n = 0
    for (const row of lswListEl.querySelectorAll('.lsw-row')) {
      const on = cur >= 0 && Number(row.getAttribute('data-ln')) === cur
      if (on) { row.setAttribute('data-dbg-current', '1'); n++ }
      else row.removeAttribute('data-dbg-current')
    }
    return n
  }
  function lswPaintChrome() {
    const en = lswEnabledNow()
    if (lswBtn) {
      if (en.ok) lswBtn.removeAttribute('disabled')
      else lswBtn.setAttribute('disabled', '')
      const title = en.ok ? t(curLang, 'toolbar.layerSwitchTip')
        : t(curLang, en.why === 'upstream' ? 'layers.disabledUpstream' : 'layers.disabledNoMount')
      if (lswBtn.getAttribute('title') !== title) lswBtn.setAttribute('title', title)
      const expanded = (lswOpen && en.ok) ? 'true' : 'false'
      if (lswBtn.getAttribute('aria-expanded') !== expanded) lswBtn.setAttribute('aria-expanded', expanded)
    }
    if (lswPanel) {
      if (lswOpen && en.ok) lswPanel.removeAttribute('hidden')
      else lswPanel.setAttribute('hidden', '')
    }
    const L = sceneLayerList()
    const st = (en.ok && L) ? lswStateNow(L) : null
    if (lswStatusEl) {
      /*  ①(2026-10-11 用户第 2 条) 计数只数**可显示**的层：`n` = 未勾选的可显示层（含文件里
          `visible:false` 的那些），`m` = 可显示层总数 —— 不可显示的层（容器/光源/无绘制源）点了也不会
          画，计进分母会让这一行读不出意思。 */
      const txt = st ? t(curLang, 'layers.hiddenCount', { n: st.hiddenCount, m: st.drawableCount }) : ''
      if (lswStatusEl.textContent !== txt) lswStatusEl.textContent = txt
    }
    if (lswOnlyCurBtn) {
      const cur = !!dbgActive && dbgIndex >= 0
      if (cur) lswOnlyCurBtn.removeAttribute('disabled')
      else lswOnlyCurBtn.setAttribute('disabled', '')
      lswOnlyCurBtn.setAttribute('title', t(curLang, cur ? 'layers.keepCurrentTip' : 'layers.needDebug'))
    }
    if (lswCopyBtn) {
      if (en.ok && L) lswCopyBtn.removeAttribute('disabled')
      else lswCopyBtn.setAttribute('disabled', '')
    }
    /*  ①(2026-10-11 用户第 2 条) 「全选」现在含"强制显示文件里 false 的层" ⇒ title 如实说明
        （字面语义变了，不能只靠 `layers.all` 三个字）。 */
    if (lswAllBtn) {
      const tip = t(curLang, 'layers.allTip')
      if (lswAllBtn.getAttribute('title') !== tip) lswAllBtn.setAttribute('title', tip)
    }
  }
  function lswPaintRows() {
    if (!lswListEl) return
    const L = sceneLayerList()
    if (!L) { lswListEl.textContent = ''; lswListEl.__lswSig = ''; return }
    const st = lswStateNow(L)
    //  幂等重建：层数/名字/可显示性没变就不重建（防悬停态丢失与每秒闪烁；与 paintDbgTab 同一条纪律）
    const sig = st.rows.map((r) => r.i + ':' + (r.drawable ? 'D' : 'x') + ':' + r.name).join('|')
    if (lswListEl.__lswSig === sig) { lswSyncChecks(); lswPaintHighlight(); return }
    lswListEl.__lswSig = sig
    lswListEl.textContent = ''
    for (const r of st.rows) {
      const row = doc.createElement('div')
      row.className = 'lsw-row'
      row.setAttribute('data-ln', String(r.i))
      if (r.isContainer) row.setAttribute('data-container', '1')
      const cb = doc.createElement('input')
      cb.type = 'checkbox'; cb.checked = r.checked
      /*  ①(2026-10-11 用户第 2 条) 置灰判据从"是不是容器"扩到"**可不可显示**"：容器 / 光源 /
          无绘制源的层（语料里的 sound/mp3 层）勾了也不会画 ⇒ 不勾 + 置灰（title 写明是哪一种）。 */
      if (!r.drawable) cb.disabled = true
      cb.addEventListener('change', () => { try { lswSetHidden(r.i, !cb.checked) } catch { /* 桩 DOM */ } })
      const idx = doc.createElement('span'); idx.className = 'lsw-idx'; idx.textContent = '#' + r.i
      const nm = doc.createElement('span'); nm.className = 'lsw-name'; nm.textContent = r.name; nm.title = r.name
      const keep = doc.createElement('button')
      keep.type = 'button'; keep.className = 'lsw-keep'
      keep.textContent = t(curLang, 'layers.keepRow'); keep.setAttribute('title', t(curLang, 'layers.keepOne'))
      keep.addEventListener('click', () => { try { lswKeepOnly(r.i) } catch { /* 桩 DOM */ } })
      row.appendChild(cb); row.appendChild(idx); row.appendChild(nm); row.appendChild(keep)
      lswListEl.appendChild(row)
    }
    lswSyncChecks()
    lswPaintHighlight()
    if (lswOpen) lswPlacePanel()
  }
  /** 勾/取消第 i 层（**唯一动作链**，探针 `__benchPatch.layerSwitchSet` 与真点击同一条）。
      · 勾上：清掉该层的用户隐藏；若它在**文件里** `visible:false`（且可显示）⇒ 进 `lswShown`
        （渲染期写 `__lnShown` = 强制显示）—— 这就是用户第 2 条要的"勾上就必须真的显示"。
      · 取消：清掉强制显示；只有**文件里本来可见**的层才进 `lswHidden`（进 `?hide=`）—— 文件里本就
        false 的层不必再"隐藏一次"（它已经在隐藏态），URL 因此保持短、语义也不混。
      · 不可显示的层：直接拒绝（checkbox 也置灰）。
      调试隔离生效期间：**只记账**（改动在退出调试时统一落层）—— 两套状态打架的口子堵在这里（§2.2）。 */
  function lswSetHidden(i, hidden) {
    const L = sceneLayerList()
    if (!L) return false
    const idx = Math.trunc(Number(i))
    if (!Number.isSafeInteger(idx) || idx < 0 || idx >= L.length) return false
    const r = lswStateNow(L).rows[idx]
    if (!r || !r.drawable) return false
    const name = layerDisplayName(L[idx], idx)
    if (hidden) {
      lswShown.delete(idx); lswShownNames.delete(idx)
      if (r.fileVisible) { lswHidden.add(idx); lswNames.set(idx, name) }
      else { lswHidden.delete(idx); lswNames.delete(idx) }
    } else {
      lswHidden.delete(idx); lswNames.delete(idx)
      if (!r.fileVisible) {
        lswShown.add(idx); lswShownNames.set(idx, name)
        logLine(t(curLang, 'log.lswForceShow', { n: idx, name }))
      } else { lswShown.delete(idx); lswShownNames.delete(idx) }
    }
    lswSyncUrl()
    if (!dbgActive) lswApply(L)
    lswPaintChrome(); lswPaintRows()
    return true
  }
  /** 「只留这一层」（行内小按钮）/「只留当前层」（顶栏按钮，作用对象 = 调试模式正看的那层）：
       隐藏集 = 除它以外全部**可显示**层；它自己在文件里 `visible:false` ⇒ 同时进强制显示集
       （①2026-10-11：否则"只留这一层"在一张全部 `visible:false` 的图上会留出一块空白）。
       调试开着 ⇒ 同时把隔离跳到这一层（立即见效）；关着 ⇒ 直接落 `__lnHidden`/`__lnShown`。 */
  function lswKeepOnly(i) {
    const L = sceneLayerList()
    if (!L) return 0
    const idx = Math.trunc(Number(i))
    if (!Number.isSafeInteger(idx) || idx < 0 || idx >= L.length) return 0
    const st = lswStateNow(L)
    lswHidden = new Set()
    lswNames = new Map()
    lswShown = new Set()
    lswShownNames = new Map()
    for (const r of st.rows) {
      if (r.i === idx || !r.drawable) continue
      lswHidden.add(r.i)
      lswNames.set(r.i, r.name)
    }
    const tgt = st.rows[idx]
    if (tgt && tgt.drawable && !tgt.fileVisible) {
      lswShown.add(idx)
      lswShownNames.set(idx, tgt.name)
    }
    lswSyncUrl()
    if (dbgActive) {
      dbgIndex = idx
      dbgApplyIsolation(L, idx)
      dbgPush(t(curLang, 'log.lswKeepOnly', { n: idx, name: layerDisplayName(L[idx], idx) }))
      dbgPaint()
    } else {
      lswApply(L)
    }
    lswPaintChrome(); lswPaintRows()
    return lswHidden.size
  }
  /** 「复制当前状态」：剪贴板 = 带 `?hide=` 的完整 URL + 隐藏层清单（下标+层名）+ ①2026-10-11 起
      追加"强制显示"清单（`__lnShown` 那几层**进不了 URL**，不写出来对方就复现不出同一张图）。 */
  function lswCopyState() {
    const L = sceneLayerList()
    if (!L) return null
    const idx = [...lswHidden].filter((i) => i < L.length).sort((a, b) => a - b)
    const forced = [...lswShown].filter((i) => i < L.length).sort((a, b) => a - b)
    const plan = layerSwitchCopyPlan(String(location.href), idx, lswCaptureNames(L), L.length, forced, lswShownNames)
    copyText(plan.text, 'layerSwitch')
    logLine(t(curLang, 'log.lswCopied', { text: plan.text.replace(/\n/g, ' ｜ ') }))
    return plan
  }
  /** 重挂载/新挂载探测（有界，无常驻定时器）：`__sceneLayers` 换了新数组 ⇒ 按"下标+层名"对账
       并重新落 `__lnHidden`/`__lnShown`（调试隔离生效期间跳过 —— 隔离拥有图层，退出时统一恢复）。
      ①2026-10-11：**强制显示集也要对账**，且额外要求"新数组里这一层确实还是 `visible:false`"
      —— 否则换一张壁纸后可能出现"名字碰巧对上"的幽灵显示。 */
  function lswPoll() {
    const L = sceneLayerList()
    if (L && L !== lswSeenArr) {
      const prevCount = lswHidden.size
      const prevShown = lswShown.size
      const kept = rematchHiddenIndices([...lswHidden], lswNames, L)
      const keptShown = rematchHiddenIndices([...lswShown], lswShownNames, L).filter((i) => L[i] && L[i].visible === false)
      const dropped = prevCount - kept.length
      const droppedShown = prevShown - keptShown.length
      lswHidden = new Set(kept)
      lswShown = new Set(keptShown)
      lswSeenArr = L
      lswNames = lswCaptureNamesIn(L, lswHidden)
      lswShownNames = lswCaptureNamesIn(L, lswShown)
      const applied = dbgActive ? 0 : lswApply(L)
      if (prevCount > 0 && (kept.length > 0 || dropped > 0)) {
        logLine(t(curLang, 'log.lswRematch', { n: kept.length, m: dropped }))
      }
      if (lswListEl) lswListEl.__lswSig = null       // 行数据按新数组重建
      lswPaintChrome()
      if (lswOpen) lswPaintRows()
      return { remounted: true, total: L.length, kept: kept.length, dropped, applied, keptShown: keptShown.length, droppedShown }
    }
    lswPaintChrome()
    if (lswOpen) lswPaintRows()
    return { remounted: false, total: L ? L.length : 0 }
  }
  /** 有界的迟到检查链（毫秒刻度）；跑完即静默 —— 释放后不留任何活动定时器。 */
  function lswCheckSoon(delays) {
    if (typeof setTimeout !== 'function') return
    for (const d of delays) setTimeout(() => { try { lswPoll() } catch { /* 单次失败不影响其它 */ } }, d)
  }
  /* ── ①(2026-10-11 用户第 1 条「面板右侧有一部分超出屏幕」) 响应式定位 ────────────────────────
     面板 CSS 已改成**右对齐**按钮右缘（`demo/index.html` 的 `<style id="layer-switch-css">`）⇒
     右边界不会再越过视口；这里再按**视口**夹取宽度与高度（算式 = 纯函数 `layerPanelFit()`，
     Node 门禁对 800×600 / 1280×720 / 1920×1080 断言"面板矩形完全落在视口内"）。
     时机：打开、行重建后、窗口 resize —— 都是**事件驱动**，不加常驻定时器（P-164 用户第 19 条纪律）。 */
  const LSW_PANEL_PREF_W = 360
  function lswPlacePanel() {
    if (!lswPanel || !lswBtn) return null
    let r = null
    try { r = lswBtn.getBoundingClientRect() } catch { r = null }
    if (!r) return null
    let vw = 0, vh = 0
    try { vw = (typeof innerWidth === 'number' && innerWidth) || (doc.documentElement && doc.documentElement.clientWidth) || 0 } catch { vw = 0 }
    try { vh = (typeof innerHeight === 'number' && innerHeight) || (doc.documentElement && doc.documentElement.clientHeight) || 0 } catch { vh = 0 }
    const fit = layerPanelFit({ right: r.right, bottom: r.bottom, top: r.top, left: r.left }, { prefW: LSW_PANEL_PREF_W }, { w: vw, h: vh }, 8)
    try {
      lswPanel.style.width = fit.width + 'px'
      lswPanel.style.maxHeight = fit.maxHeight + 'px'
      lswPanel.setAttribute('data-lsw-placement', fit.placement)
    } catch { /* 桩 DOM */ }
    return fit
  }
  function lswSetOpen(open) {
    lswOpen = !!open
    lswPoll()                       // 打开前先对一次账（拿最近挂载的层数组）
    lswPaintChrome()
    if (lswOpen) { lswPaintRows(); lswPlacePanel() }
    return lswOpen
  }
  if (lswBtn) lswBtn.addEventListener('click', () => { try { if (!lswBtn.disabled) lswSetOpen(!lswOpen) } catch { /* 桩 DOM */ } })
  //  点外面关（捕手语义同 #settings-pop；面板 DOM 就在 #layer-switch 里 ⇒ contains 一处就够）
  try {
    if (typeof doc.addEventListener === 'function') {
      doc.addEventListener('pointerdown', (ev) => {
        try {
          if (!lswOpen) return
          const t2 = ev && ev.target
          if (t2 && lswRoot && lswRoot.contains(t2)) return
          lswSetOpen(false)
        } catch { /* 桩 DOM */ }
      }, true)
    }
  } catch { /* 桩 DOM */ }
  /* 「全选」= **全部勾上**：清空用户隐藏，并把文件里 `visible:false` 的可显示层一并放进强制显示集
     （①2026-10-11：否则"全选"在一张全 false 的图上与"什么都没做"没区别 —— 按勾选框的字面语义走）。 */
  if (lswAllBtn) lswAllBtn.addEventListener('click', () => {
    try {
      const L = sceneLayerList()
      lswHidden = new Set(); lswNames = new Map()
      lswShown = new Set(); lswShownNames = new Map()
      if (L) for (const r of layerSwitchState(L, new Set(), new Set()).rows) {
        if (r.drawable && !r.fileVisible) { lswShown.add(r.i); lswShownNames.set(r.i, r.name) }
      }
      lswSyncUrl(); if (!dbgActive) lswApply(L); lswPaintChrome(); lswPaintRows()
    } catch { /* 桩 DOM */ }
  })
  /* 「全不选」= 全部取消：可显示层全进用户隐藏集（进 `?hide=`），强制显示清空。 */
  if (lswNoneBtn) lswNoneBtn.addEventListener('click', () => {
    try {
      const L = sceneLayerList()
      lswHidden = new Set(); lswNames = new Map()
      lswShown = new Set(); lswShownNames = new Map()
      if (L) for (const r of layerSwitchState(L, new Set(), new Set()).rows) {
        if (!r.drawable) continue
        lswHidden.add(r.i); lswNames.set(r.i, r.name)
      }
      lswSyncUrl(); if (!dbgActive) lswApply(L); lswPaintChrome(); lswPaintRows()
    } catch { /* 桩 DOM */ }
  })
  if (lswOnlyCurBtn) lswOnlyCurBtn.addEventListener('click', () => { try { if (dbgActive && dbgIndex >= 0) lswKeepOnly(dbgIndex) } catch { /* 桩 DOM */ } })
  if (lswCopyBtn) lswCopyBtn.addEventListener('click', () => { try { lswCopyState() } catch { /* 桩 DOM */ } })
  /* ═══ MPW-LSW-RESET-BEGIN ⑦(2026-10-12 用户 :8902 第 6 条「在图层开关里面加一个恢复默认的功能」) ═══
     「恢复默认」= 回到**壁纸文件默认态**：本仓**唯一**那套默认口径就是 `layerSwitchState()` 的
     `checked = 可显示 && !hidden && (fileVisible || shown)`（= "默认勾选 = 文件语义"）⇒ 本按钮**只清掉
     用户的两份覆盖**（隐藏集 `lswHidden` / 强制显示集 `lswShown`），**不新引第二套默认** ✓。
     · 与「全选」的区别：全选把文件里 `visible:false` 的层也勾上（= 强制显示）；本按钮**不动**文件语义；
     · 与「全不选」的区别：全不选把可显示层全隐藏；本按钮回到文件里可见的那些；
     · **立即生效**：`lswApply()` 把 `__lnHidden`/`__lnShown` 逐层写回（与真勾选**同一条**通道）；
     · **与刷新页面一致**：`lswSyncUrl()` 在空集时把 `?hide=` 从 URL **删掉** ⇒ 刷新后 `lswUrlHide`
       读到 null ⇒ 状态与刚点完这一下逐位相同（这是"刷新一致"成立的唯一原因：不删参数就会被 URL 复原）；
     · 调试隔离生效期间与「全选/全不选」同一条纪律（§2.2）：只记账、不落层 —— 隔离拥有图层，
       退出调试时由 `lswApply()` 统一写；行 title 已如实写明"改动已记录、退出后生效"。 */
  function lswResetDefaults() {
    const L = sceneLayerList()
    const before = L ? lswStateNow(L) : null
    lswHidden = new Set(); lswNames = new Map()
    lswShown = new Set(); lswShownNames = new Map()
    lswSyncUrl()
    const applied = dbgActive ? 0 : lswApply(L)
    lswPaintChrome(); lswPaintRows()
    const after = L ? lswStateNow(L) : null
    if (after) logLine(t(curLang, 'log.lswReset', { n: after.checkedCount, m: after.drawableCount }))
    return {
      ok: !!L, applied,
      checked: after ? after.checkedCount : 0, drawable: after ? after.drawableCount : 0,
      wasHidden: before ? before.hiddenCount : 0, wasForced: before ? before.forcedCount : 0,
    }
  }
  const lswResetBtn = $('#layer-reset')
  if (lswResetBtn) lswResetBtn.addEventListener('click', () => { try { lswResetDefaults() } catch { /* 桩 DOM */ } })
  /* ═══ MPW-LSW-RESET-END ═══ */
  //  挂载探测的两条入口：iframe `load`（每次换 src/换档都会触发）+ 渲染器首帧消息（__sceneLayers 在
  //  首帧前发布 ⇒ 消息到达时必然可取；500ms 那一下兜"消息比首屏补丁先发"的时序）。
  //  ⚠(run3 实测) 这里**不能用本作用域后面的 `const frameEl`**（:9849 才初始化 ⇒ 此刻 TDZ，
  //  addEventListener 抛 ReferenceError 被 try/catch 吞掉 ⇒ load 监听从未装上、切渲染器档后无人重画）
  //  —— 事件挂载时现查 DOM（#frame 在静态 HTML 里，此刻必已存在）。
  try {
    const frNow = (doc && doc.getElementById) ? doc.getElementById('frame') : null
    if (frNow && frNow.addEventListener) frNow.addEventListener('load', () => lswCheckSoon([400, 1600, 4000, 8000]))
  } catch { /* 桩 DOM */ }
  try {
    addEventListener('message', (ev) => {
      try {
        if (!ev || !ev.data || ev.data.type !== 'mpw-first-frame') return
        if (frameEl && ev.source && frameEl.contentWindow && ev.source !== frameEl.contentWindow) return
        lswCheckSoon([0, 500])
      } catch { /* 异常载荷：忽略 */ }
    })
  } catch { /* 无 window（桩） */ }
  /*  ①(2026-10-11 用户第 1 条) 视口 / 滚动变化 ⇒ 重算面板尺寸与位置（只在面板开着时做事；事件驱动，无定时器）。
      为什么还要管滚动：窄屏下 `#main` 是"文档流 + 页面内滚动"，绝对定位的面板跟着按钮走，
      可用高度会变 ⇒ 滚动时也重算一次。`capture:true` 是必需的：**scroll 事件不冒泡**，而
      `#toolbar`（窄屏 `max-height:30vh`）自己就是个滚动容器 ⇒ 只有捕获阶段才收得到它的滚动。
      两个监听都 `{passive:true}`，不拦任何事件。 */
  try {
    addEventListener('resize', () => { try { if (lswOpen) lswPlacePanel() } catch { /* 桩 */ } })
  } catch { /* 无 window（桩） */ }
  try {
    addEventListener('scroll', () => { try { if (lswOpen) lswPlacePanel() } catch { /* 桩 */ } }, { passive: true, capture: true })
  } catch { /* 无 window（桩） */ }
  lswPaintChrome()
  /** 门禁/调试探针：与真点击同一条入口（`__benchPatch.layerSwitch*`）。 */
  function lswSnapshot() {
    const L = sceneLayerList()
    const en = lswEnabledNow()
    const names = {}
    for (const [k, v] of lswNames) names[k] = v
    const shownNames = {}
    for (const [k, v] of lswShownNames) shownNames[k] = v
    const st = L ? lswStateNow(L) : null
    return {
      enabled: en.ok, why: en.why, open: !!lswOpen,
      renderer: (() => { try { return rendererSrcNow() } catch { return null } })(),
      total: L ? L.length : 0,
      hidden: [...lswHidden].sort((a, b) => a - b),
      names,
      /*  ①(2026-10-11 用户第 2 条) 新增读数：强制显示集 + 每行的"文件语义/可显示性/勾选态"。
          门禁（bench-ui-headless LS 组）与真机排查读的是**同一份** `layerSwitchState()` 口径。 */
      shown: [...lswShown].sort((a, b) => a - b),
      shownNames,
      drawable: st ? st.drawableCount : 0,
      checkedCount: st ? st.checkedCount : 0,
      unchecked: st ? st.hiddenCount : 0,
      forcedCount: st ? st.forcedCount : 0,
      fileHidden: st ? st.rows.filter((r) => r.fileHidden).map((r) => r.i) : [],
      rows: st ? st.rows.map((r) => ({ i: r.i, name: r.name, kind: r.kind, drawable: r.drawable, fileVisible: r.fileVisible, fileHidden: r.fileHidden, forced: r.forced, checked: r.checked })) : [],
      urlHide: (() => { try { return new URLSearchParams(location.search).get('hide') } catch { return null } })(),
      dbgCurrent: dbgActive ? dbgIndex : -1,
    }
  }

  // ── ① 主题：bundle 正常时**绝不重复接管**（否则一次点击走两格）；只在 bundle 没跑起来时兜底 ──
  //   线上事故：产物缺 assets/modulepreload-polyfill-*.js ⇒ bundle 整体不执行 ⇒ 主题按钮永远没反应。
  //   补齐文件是根治；这里再加一层"bundle 死了也能切主题"的兜底（判据 = <html> 上还没有 data-theme）。
  //   ⑫c(2026-09-19 用户要求)：**两态**（深色 / 浅色）——产物 `#theme-toggle.onclick` 那条
  //   `auto → dark → light → auto` 的三态循环被我们**换掉**（属性赋值 ⇒ 后者胜，见下）；
  //   点击只走 dark ↔ light，历史 'auto'（或非法值）**一次性迁移**成具体一态。
  const THEME_KEY = 'webwallgl-theme'
  const themeBtn = $('#theme-toggle')
  function prefersDarkNow() {
    try { return !!(typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches) } catch { return false }
  }
  /** 把两态主题真正落到 DOM/存储（与产物 ze() 同语义，但永远不落 'auto'）。返回 {mode,theme}。 */
  function applyThemeMode(mode) {
    if (!themeBtn) return null
    const plan = themePlan(mode, prefersDarkNow())
    try { doc.documentElement.dataset.theme = plan.theme } catch { /* 无 dataset（测试） */ }
    try { themeBtn.dataset.mode = plan.mode } catch { /* 同上 */ }
    try { themeBtn.setAttribute('title', t(curLang, 'theme.' + plan.mode)) } catch {}
    try {
      for (const ic of themeBtn.querySelectorAll('.ic')) {
        if (ic.classList.contains('ic-' + plan.mode)) ic.removeAttribute('hidden')
        else ic.setAttribute('hidden', '')
      }
    } catch {}
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(THEME_KEY, plan.mode) } catch { /* 隐私模式 */ }
    // 设置弹层那两个开关的按下态（外壳自己的重绘；桩 DOM/无外壳时静默）
    try { if (typeof window !== 'undefined' && typeof window.__benchShellRefresh === 'function') window.__benchShellRefresh() } catch {}
    return { mode: plan.mode, theme: plan.theme }
  }
  /** 当前**两态**模式（用于点击循环与"系统主题变化后把我们的模式钉回去"） */
  function currentThemeMode() {
    const raw = (themeBtn && themeBtn.dataset && themeBtn.dataset.mode) || ''
    if (raw === 'dark' || raw === 'light') return raw
    try { const saved = (typeof localStorage !== 'undefined') ? localStorage.getItem(THEME_KEY) : null; if (saved === 'dark' || saved === 'light') return saved } catch {}
    return 'light'   // ①(2026-09-22 第12条) 没存过 ⇒ 浅色（与 normalizeThemeMode 的缺省支一致）
  }
  function ensureThemeFallback() {
    if (!themeBtn) return false
    try { if (doc.documentElement.dataset && doc.documentElement.dataset.theme) return false } catch { return false }
    let saved = null
    try { saved = (typeof localStorage !== 'undefined') ? localStorage.getItem(THEME_KEY) : null } catch { saved = null }
    // 两态：老的 'auto'（或任何非法值）在这里按系统偏好**迁移**成具体一态；此后只有 dark/light
    applyThemeMode(themePlan(saved, prefersDarkNow()).mode)
    themeBtn.addEventListener('click', () => applyThemeMode(nextThemeMode(currentThemeMode())))
    return true
  }

  // ── ⑦ 后端状态：把「静态托管」与「离线」分开讲清楚（用户问：是不是我离线导致的？）──
  //   本 checkout 的 Node host 起不来（离线 + 依赖不全，见 PATCH-NOTES 第四批 §7），故 hostBlocked=true。
  const HOST_BLOCKED_HERE = true
  let apiStatus = 0
  // P-93：在线形态判定（GitHub Pages 这类**设计上就没有本机后端**的部署）。
  //   在线 ⇒ 不再说"去跑 pnpm dev"（对访客无意义），改说"在线版就是没有后端"，
  //   并且**不**打"本机依赖不全"那行（那是作者本机的状态，不是线上访客的）。
  //   开关：`?online=0` 强制按本机口径渲染（探针/对照用）。
  const onlineFlag = (() => {
    try {
      const m = String((typeof location !== 'undefined' && location.search) || '').match(/[?&]online=([^&]*)/)
      return m ? decodeURIComponent(m[1]) : '1'
    } catch { return '1' }
  })()
  const demoEnv = onlineDemoEnv(null, { force: onlineFlag })
  const backendEnv = () => ({
    apiStatus,
    onLine: (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') ? navigator.onLine : true,
    hostBlocked: HOST_BLOCKED_HERE,
    online: demoEnv.online,
  })
  const backendNoteEl = $('#bench-backend-note')
  // 后端专有控件（静态托管下点不动/点了没内容）：统一挂"为什么不可用"的 title
  const BACKEND_ONLY_CONTROLS = ['#filter', '#toggle-props', '#props-reset', '#props-close', '#props-filter', '#props-all']
  const paintBackendNote = () => {
    const note = backendNotice(curLang, backendEnv())
    if (!backendNoteEl) return note
    if (note.hidden) { backendNoteEl.hidden = true; backendNoteEl.textContent = ''; return note }
    backendNoteEl.hidden = false
    backendNoteEl.textContent = ''
    const head = doc.createElement('div'); head.className = 'bench-backend-head'; head.textContent = note.label
    backendNoteEl.appendChild(head)
    for (const line of note.lines) {
      const p2 = doc.createElement('div'); p2.className = 'bench-backend-line'; p2.textContent = line
      backendNoteEl.appendChild(p2)
    }
    backendNoteEl.title = note.lines[0] || ''
    const reason = t(curLang, 'backend.needBackend')
    for (const sel of BACKEND_ONLY_CONTROLS) { const el = $(sel); if (el) el.setAttribute('title', reason) }
    return note
  }

  // ── A5/A6 所有原生 <select> → 同一个自绘紧凑组件（工厂见模块级 bindDropdown）──
  const dropdowns = []
  const closeAll = (except) => { for (const d of dropdowns) if (d !== except) d.close() }
  for (const sel of doc.querySelectorAll('select')) bindDropdown(doc, sel, dropdowns)
  /*  ④(2026-10-04 六改 · 根因) 「点这一行的文字」必须算**这一行内部**：`<label>` 会把这次点击
      **原生激活**到控件上，而那次激活发生在本次事件冒泡**结束之后** ⇒ 这里先把浮层收掉的话，
      随后那次激活又把它打开，净效果正是用户报的"文字上点一下能开、再点一下关不掉"。
      判据从"点是否落在 wrap 里"放成"点是否落在 wrap 或它所在的 label 里"：文字与触发框同一热区，
      开/关才对得上（hover 时给触发框加灰底的那条样式，本来也是按整行做的）。 */
  doc.addEventListener('click', (e) => {
    for (const d of dropdowns) {
      const t = e.target
      if (d.wrap.contains(t)) continue
      let lab = null
      try { lab = (d.wrap.closest && d.wrap.closest('label')) || null } catch { /* 桩 DOM */ }
      if (lab && lab.contains && lab.contains(t)) continue
      d.close()
    }
  })
  doc.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(null) })
  // ⑬(2026-09-19) 浮层坐标是**展开那一刻**算的（fixed 坐标系）：一旦页面/面板滚动或窗口改尺寸，
  //   它就跟锚点脱开了 —— 与其追着改坐标，不如直接收起（"不会被滚走"的最简可靠实现）。
  //   捕获阶段监听：`#pages-track` 里的滚动不冒泡到 window，必须 capture 才收得到。
  try {
    if (typeof addEventListener === 'function') {
      addEventListener('scroll', (e) => {
        /* ①(2026-09-22 用户第 29 条) 浮层**自己内部**的滚动不该把它关掉：分辨率下拉/目录选择器的列表是
           `overflow-y:auto` 可滚的，而这里是**捕获阶段**监听（连 `#pages-track` 里不冒泡的滚动都要收）
           ⇒ 连列表自身的滚动也收到、一滚滚轮浮层就关。判据 = "在打开的下拉里滚轮：列表真的滚动且浮层不关"。
           用已登记的 dropdown 句柄判包含关系（不写死类名，目录选择器/其它浮层一并受益）。 */
        const t = e && e.target
        if (t) { for (const d of dropdowns) { try { if (d.wrap && d.wrap.contains(t)) return } catch { /* 桩 DOM */ } } }
        /* ⑦(2026-09-25) 与 `mpw_select` 同一类问题（同一份判据 `scrollAffectsAnchor`）：滚动源**与锚点无关**
           时不该收起 —— 改前这里是 `closeAll(null)`，于是日志窗 `#logbody` 自己往下跟、库列表自动滚到选中项
           这类滚动会把刚展开的下拉收掉（用户看到的是"点开就没了"；测试台实测 250ms 内日志窗滚了 4 次）。
           两道判据先严后宽：① **锚点 rect 真的变了**（浮层坐标就是按它算的，最准，且吃掉"先滚动后展开"的
           异步时序坑）⇒ 收；② 拿不到 rect（桩 DOM）⇒ 退回"视口/文档滚动、或锚点祖先滚动" ⇒ 收。 */
        for (const d of dropdowns) {
          let moved = null
          try { moved = typeof d.anchorMoved === 'function' ? d.anchorMoved() : null } catch { moved = null }
          if (moved === null) {
            let affected = false
            try { affected = scrollAffectsAnchor(t, d.btn, doc) } catch { affected = false }
            if (affected) d.close()
          } else if (moved) d.close()
        }
      }, true)
      addEventListener('resize', () => closeAll(null))
    }
  } catch { /* 桩 DOM：忽略 */ }
  // ── A8 预览全屏 + 全屏内可见的"退出全屏"（用户键盘上没有 F12，不能依赖快捷键）──
  const stageSlot = $('#stage-slot'), fsEnter = $('#fs-enter'), fsExit = $('#fs-exit')
  const fsSupported = !!(stageSlot && stageSlot.requestFullscreen)
  if (fsEnter) {
    if (!fsSupported) { fsEnter.disabled = true; fsEnter.title = t(curLang, 'fs.unsupported') }
    fsEnter.addEventListener('click', () => {
      if (!fsSupported) return
      Promise.resolve(stageSlot.requestFullscreen()).catch((err) => console.warn('[bench-patch] 全屏失败:', err && err.message))
    })
  }
  if (fsExit) fsExit.addEventListener('click', () => { if (doc.fullscreenElement) doc.exitFullscreen() })
  const paintFs = () => {
    const on = !!doc.fullscreenElement
    if (fsEnter) fsEnter.textContent = t(curLang, 'fs.enter')
    if (fsExit) fsExit.textContent = t(curLang, 'fs.exit')
    if (fsEnter) fsEnter.title = t(curLang, 'fs.enterTitle')
    if (fsExit) fsExit.title = t(curLang, 'fs.exitTitle')
    // #stage-slot 变尺寸后 bundle 的 ResizeObserver(stageFrameEl) 会自己重排；这里再兜一次
    if (on) requestAnimationFrame(() => dispatchEvent(new Event('resize')))
  }
  doc.addEventListener('fullscreenchange', paintFs)

  // ── A1 本页 README：bundle 的 renderDocs 每次重渲染 #docs-body，所以每次语言同步后补挂一份 ──
  const README = {
    zh: [
      ['h', '本页 README · 使用说明速查'],
      ['p', '这个页面是 WEwebLoader（浏览器端 Wallpaper Engine 场景壁纸渲染器，npm 包名 wallpaper-engine-web-loader）的测试台。静态托管（python3 -m http.server）下没有本机 Node 后端，所以「壁纸库列表 / 属性保存 / 渲染器诊断流」不可用；下面这些能力**纯前端**可用。'],
      ['h2', '1. 怎么把壁纸放进来'],
      ['ul', [
        '「选择文件夹」：**唯一**的本地载入方式（第四批已删掉「打开本地 .pkg」）。选一个装了壁纸的文件夹，测试台纯前端扫描：每个含 scene.pkg 或 project.json 的目录算一个壁纸，类型（scene/web/video）由扫描自动识别并显示在名字下面。',
        '扫描不区分层级：<根>/<壁纸>/scene.pkg 与直接把某个壁纸目录当作根来选（<壁纸>/scene.pkg）都能识别。',
        '「清空」：清掉已扫描的本地库、列表条目与当前选择（舞台回到"从左侧选择一个壁纸"）。',
        '带本机后端时（在本仓库源码目录跑 pnpm dev）：左侧会直接列出壁纸库，支持搜索、右键删除、属性保存。',
      ]],
      ['h2', '2. 地址栏参数（渲染器侧）'],
      ['ul', [
        '?res=1920x1080 —— 强制舞台逻辑分辨率（等价于工具条「分辨率」下拉；自适应时按 16:9 撑满）。',
        '?psim=1 —— 模拟/固定随机，粒子等随机系统可复现（调参对照用）。',
        '?cursor=0 / 1 —— 关/开鼠标指针驱动的效果（部分壁纸的视差、跟着鼠标的粒子依赖它）。',
        '?projy=1 —— 强制投影/透视相机路径（透视类粒子层用）。',
        '?bones=1 —— 打开骨骼（木偶 mesh 层）蒙皮路径；关掉可看未蒙皮 quad 的对照画面。',
        '多个参数用 & 连接，例如：?res=2560x1440&cursor=1&bones=1',
      ]],
      ['h2', '3. 逐层调试键位 / 开关'],
      ['ul', [
        '工具条「滤镜」：以 CSS filter 作用于渲染输出，用来区分"画面本身错"还是"输出后处理错"。',
        '「指针注入」：模拟桌面壁纸窗口（遮罩挡住原生鼠标事件，坐标改由 __wp.pushPointer 推送）；下面hint的「鼠标尾迹」必须先在它开启后才可用。',
        '「鼠标尾迹」：勾选后在舞台内画出跟随指针的渐隐尾迹，只看注入通道收到的坐标。',
        '分辨率下拉是**自绘**的：点触发器展开、再点触发器 / 点空白 / Esc 都能收回；列表限高可滚动。',
      ]],
      ['h2', '4. 已知限制'],
      ['ul', [
        '静态托管无 /api/* 与 /diag：壁纸库列表、属性保存、删除、打开所在文件夹、渲染器诊断流不可用（诊断区会置灰并写明原因，左侧栏给出「为什么不可用 + 怎么办」）。注意：**这不是因为本机离线** —— 静态托管与离线是两件事，离线只影响外网，本页缺的是本机 Node 后端。',
        'web / video 两类壁纸在静态托管下无法预览（需要本机 Node 后端做目录与转码）；scene 包可直接预览。',
        '本页无法替代真实桌面壁纸环境：多显示器、系统音频环回、桌面右键菜单等宿主能力不在测试台范围内。',
      ]],
    ],
    en: [
      ['h', 'This page README · quick reference'],
      ['p', 'This is the bench for WEwebLoader (a browser-side Wallpaper Engine scene-wallpaper renderer; npm package name wallpaper-engine-web-loader). Under static hosting (python3 -m http.server) there is no local Node backend, so the library listing, property saving and the renderer diagnostics stream are unavailable. Everything below works fully client-side.'],
      ['h2', '1. Getting a wallpaper in'],
      ['ul', [
        '“Choose folder” is the **only** way to load local content (“Open local .pkg” was removed in batch 4). Pick a folder holding wallpapers: the bench scans it fully client-side — every directory containing scene.pkg or project.json becomes one wallpaper, and its type (scene/web/video) is auto-detected while scanning and shown under the name.',
        'No depth requirement: both <root>/<wallpaper>/scene.pkg and picking a single wallpaper directory as the root (<wallpaper>/scene.pkg) are recognised.',
        '“Clear”: drops the scanned library, the list entries and the current selection (the stage goes back to “Pick a wallpaper on the left”).',
        'With the local backend (run pnpm dev inside this repository’s source tree) the library is listed directly, with search, right-click delete and property saving.',
      ]],
      ['h2', '2. URL parameters (renderer side)'],
      ['ul', [
        '?res=1920x1080 — force the stage logical resolution (same as the toolbar dropdown; adaptive fits 16:9).',
        '?psim=1 — fixed/simulated randomness so particle systems reproduce (useful for A/B tuning).',
        '?cursor=0 / 1 — disable/enable pointer-driven effects (parallax and cursor-following particles rely on it).',
        '?projy=1 — force the projection/perspective camera path (used by perspective particle layers).',
        '?bones=1 — enable the skinned puppet mesh path; turn it off to compare against unskinned quads.',
        'Join parameters with &, e.g. ?res=2560x1440&cursor=1&bones=1',
      ]],
      ['h2', '3. Debug switches'],
      ['ul', [
        'Toolbar “Filter”: applies a CSS filter to the rendered output — use it to tell a broken picture from broken post-processing.',
        '“Pointer inject”: simulates a desktop wallpaper window (a veil blocks native mouse events; coordinates are pushed via __wp.pushPointer). “Mouse trail” only becomes available after enabling it.',
        '“Mouse trail”: draws a fading trail following the pointer inside the stage, fed only by the injection channel.',
        'The resolution dropdown is custom-drawn: click the trigger to open, then click the trigger again / click empty space / press Esc to close; the list is height-limited and scrollable.',
      ]],
      ['h2', '4. Known limitations'],
      ['ul', [
        'Static hosting has no /api/* or /diag: library listing, property saving, deleting, reveal-in-folder and the diagnostics stream are unavailable (the diagnostics area is greyed out with the reason, and the sidebar explains why and what to do). Note this is **not** caused by being offline — static hosting and offline are two different things; nothing here needs the network, what is missing is the local Node backend.',
        'web / video wallpapers cannot be previewed under static hosting (they need the local Node backend for directory access and transcoding); scene packages preview directly.',
        'This page cannot replace a real desktop wallpaper environment: multi-monitor, system audio loopback and desktop context menus are out of scope.',
      ]],
    ],
  }
  function injectReadme() {
    const body = $('#docs-body')
    if (!body) return
    const old = body.querySelector('#bench-readme')
    if (old) old.remove()
    const sec = doc.createElement('section')
    sec.id = 'bench-readme'
    sec.className = 'doc-section bench-readme'
    for (const [k, v] of README[curLang] || README.zh) {
      if (k === 'h') { const h = doc.createElement('h1'); h.textContent = v; sec.appendChild(h) }
      else if (k === 'h2') { const h = doc.createElement('h2'); h.textContent = v; sec.appendChild(h) }
      else if (k === 'p') { const p2 = doc.createElement('p'); p2.textContent = v; sec.appendChild(p2) }
      else if (k === 'ul') { const ul = doc.createElement('ul'); for (const it of v) { const li = doc.createElement('li'); li.textContent = it; ul.appendChild(li) } sec.appendChild(ul) }
    }
    body.insertBefore(sec, body.firstChild)   // 放在文档最前面，第一眼就能看到
  }
  // 文档视图打开时补挂（bundle 的 setView("docs") 会重渲染 #docs-body，所以监听点击 + 语言同步各挂一次）
  const actDocsBtn = $('#act-docs')
  if (actDocsBtn) actDocsBtn.addEventListener('click', () => setTimeout(injectReadme, 0))
  injectReadme()

  /* ── ①A3(2026-09-24 用户「8902 页面怎么这么多东西都是半成品」) 「壁纸设置」页签里的**过期结论**修正 ──
     真读数（改前）：`demo/index.html` 的 `#page-wpset` 表里，「翻转 / 播放速度 0.5–2× / 显示颜色选项（总开关）/
     亮度·对比度·饱和度·色调偏移」四行仍标着 <span class="tag tag-todo">需实现</span>，
     而它们**已经实现**（`demo.html` 的 MPW-DISPLAY 段：`#mpw-flip-h` / `#mpw-rate` / `#mpw-coloropts` /
     `#mpw-bright|contrast|satur|hue` + `__wp.setDisplay({...})`，见 demo.html:1872-1912 `mpwDisplaySet`）。
     文档说"没做"、代码里做了 ⇒ 用户眼里就是"半成品"。修法（只动**这一页的文字事实**，不碰功能）：
     按下面这张表把状态改成「已实现」并补一句"在哪儿改"，每一条都给出可核对的落点。
     幂等：同一行只改一次（打 `data-bench-wpset="fixed"`）。 */
  /* ⚠⑪(2026-09-24 用户第 11 条) 这四条**中英两语都要认、都要写**：
     改前只按中文标签 `match` ⇒ 只有中文表的末列被改成「已实现（…）」，英文表还留着 `to implement`
     —— 用户原话「中英状态不同步（中文先更新了英文没有）」就是这一处。
     现在：`match` 同时认中文标签与英文标签，`note` 按当前语言取（**两语的 note 提及同一批代码符号**，
     所以浏览器侧 `docBilingualProbe().wpset.sameRows` 也能成立）。 */
  const WPSET_DONE = [
    {
      match: /^翻转（水平翻转）|^Flip \(horizontal\)/,
      zh: '「壁纸配置 → 渲染器设置（WE 自带）」的「水平翻转」勾选，或渲染器页顶栏「显示选项」的「翻转」（`#mpw-flip-h`）；API `__wp.setDisplay({flipH:true})`；渲染输出上加 `transform:scaleX(-1)`（demo.html 的 MPW-DISPLAY 段）',
      en: '“Wallpaper config → Renderer settings (built into WE)” → “Flip (horizontal)”, or the renderer top bar → “Display options” → “Flip” (`#mpw-flip-h`); API `__wp.setDisplay({flipH:true})`; `transform:scaleX(-1)` is applied to the whole output (the MPW-DISPLAY block in demo.html)',
    },
    {
      match: /^播放速度\s*0\.5|^Playback rate\s*0\.5/,
      zh: '「壁纸配置 → 渲染器设置（WE 自带）」的「播放速度」滑条（0.5–2×），或渲染器页顶栏「显示选项」的「速」下拉（`#mpw-rate`）；API `__wp.setPlaybackRate(r)`；同时乘到场景时钟与 `video.playbackRate`',
      en: '“Wallpaper config → Renderer settings (built into WE)” → “Playback rate” (0.5–2×), or the renderer top bar → “Display options” → the “Speed” dropdown (`#mpw-rate`); API `__wp.setPlaybackRate(r)`; it multiplies the scene clock and `video.playbackRate`',
    },
    {
      match: /^显示颜色选项（总开关）|^Show colour options \(master\)|^Show color options \(master\)/,
      zh: '「壁纸配置 → 渲染器设置（WE 自带）」的「显示颜色选项（总开关）」，或渲染器页顶栏「显示选项」的「颜色」勾选（`#mpw-coloropts`）；API `__wp.setDisplay({colorOptions:false})`',
      en: '“Wallpaper config → Renderer settings (built into WE)” → “Show colour options (master)”, or the renderer top bar → “Display options” → the “Colour” checkbox (`#mpw-coloropts`); API `__wp.setDisplay({colorOptions:false})`',
    },
    {
      match: /^亮度\s*\/\s*对比度|^Brightness\s*\/\s*contrast/,
      zh: '「壁纸配置 → 渲染器设置（WE 自带）」的「亮度/对比度/饱和度/色调偏移」四个滑条，或渲染器页顶栏「显示选项」的同样四个（`#mpw-bright`/`#mpw-contrast`/`#mpw-satur`/`#mpw-hue`）；API `__wp.setDisplay({brightness,contrast,saturation,hue})`',
      en: '“Wallpaper config → Renderer settings (built into WE)” → the four sliders (brightness / contrast / saturation / hue shift), or the renderer top bar → “Display options” → the same four (`#mpw-bright`/`#mpw-contrast`/`#mpw-satur`/`#mpw-hue`); API `__wp.setDisplay({brightness,contrast,saturation,hue})`',
    },
  ]
  /* ── ⑪(2026-09-24 用户第 11 条)「说明 与 壁纸设置 里中英**同时显示** ⇒ 应跟随当前语言只显示一种；
     且壁纸设置里的 API 列表不全、中英状态不同步 ⇒ 补齐并让中英同源」──────────────────────────────
     两半各有落点：
      ① **只显示一种**：CSS（`html[lang]:not([lang="en"]) .lang-en{display:none}`，静态表 + 本补丁的
         `SITE_LAYOUT_CSS` 各一份）。改前那条被 D8 自动加前缀成 `html.bench-shell html:not(...)` ——
         自己是自己的后代 ⇒ 死规则 ⇒ 中文档下两语一起显示。
      ② **API 列表补齐 + 中英同源**：`demo/index.html` 的 `#page-wpset` 两张表逐行同键（改前英文表
         少了亮度/对比度那行的 WE 内部键，且两张表都漏了 7 个已实现的运行参数面）。
     本探针把两件事都变成**可机读读数**（门禁与真机同一个入口）：`displayOf` 是每块的语言过滤结果
     （不依赖当前在哪个页签），`sameRows` 是两语表格逐行"键集合"的一致判定。 */
  function docBilingualProbe() {
    const lang = (() => { try { return String(doc.documentElement.lang || '') } catch { return '' } })()
    const blocks = []
    let els = []
    try { els = doc.querySelectorAll ? [...doc.querySelectorAll('.doc-wrap')] : [] } catch { els = [] }
    for (const el of els) {
      let cs = null
      try { cs = doc.defaultView && doc.defaultView.getComputedStyle ? doc.defaultView.getComputedStyle(el) : null } catch { cs = null }
      const page = (() => { try { const p = el.closest ? el.closest('.page') : null; return p ? String(p.id || '') : '' } catch { return '' } })()
      blocks.push({
        page, cls: String(el.className || ''), lang: (() => { try { return String(el.getAttribute('lang') || '') } catch { return '' } })(),
        display: cs ? String(cs.display || '') : '',
        filtered: !!(cs && cs.display === 'none'),
        rendered: (() => { try { return el.getClientRects().length > 0 } catch { return false } })(),
      })
    }
    const keyRows = (block) => {
      if (!block) return []
      let tables = []
      try { tables = [...block.querySelectorAll('table')] } catch { tables = [] }
      return tables.map((tb) => {
        let trs = []
        try { trs = [...tb.querySelectorAll('tr')] } catch { trs = [] }
        return trs.map((tr) => {
          let tds = []
          try { tds = [...tr.querySelectorAll('td')] } catch { tds = [] }
          return tds.map((td) => String((String(td.textContent || '').match(/ui_[a-z_]+|#[a-z-]+|__wp\.[a-zA-Z]+/g) || []).join(','))).join('|')
        })
      })
    }
    const zh = (() => { try { return doc.querySelector('#page-wpset .doc-wrap.lang-zh') } catch { return null } })()
    const en = (() => { try { return doc.querySelector('#page-wpset .doc-wrap.lang-en') } catch { return null } })()
    const zhRows = keyRows(zh), enRows = keyRows(en)
    const countRows = (r) => r.reduce((n, t) => n + t.length, 0)
    const isEn = /^en/i.test(lang)
    return {
      lang, isEn,
      blocks,
      visibleBlocks: blocks.filter((b) => !b.filtered).map((b) => b.page + ':' + (/(^|\s)lang-en(\s|$)/.test(b.cls) ? 'en' : 'zh')),
      hiddenBlocks: blocks.filter((b) => b.filtered).length,
      //  ② 中英同源：两语表格的"逐表逐行键集合"必须逐字相同
      wpset: {
        zhTables: zhRows.length, enTables: enRows.length,
        zhRows: countRows(zhRows), enRows: countRows(enRows),
        sameRows: JSON.stringify(zhRows) === JSON.stringify(enRows),
        //  排障读数（不改判定）：第一处不同的表/行 + 两侧的键串
        //  排障用：两语第 1 张表第 2 行的**原始格子文本**（看清运行时到底谁多了/少了什么）
        rawSample: (() => {
          const cells = (block) => {
            try {
              const tr = block && block.querySelectorAll('table')[0] ? block.querySelectorAll('table')[0].querySelectorAll('tr')[1] : null
              return tr ? [...tr.querySelectorAll('td')].map((td) => String(td.textContent || '').trim().slice(0, 70)) : null
            } catch { return null }
          }
          return { zh: cells(zh), en: cells(en) }
        })(),
        firstDiff: (() => {
          for (let t = 0; t < Math.max(zhRows.length, enRows.length); t++) {
            const a = zhRows[t] || [], b = enRows[t] || []
            for (let r = 0; r < Math.max(a.length, b.length); r++) {
              if ((a[r] || '') !== (b[r] || '')) return { table: t, row: r, zh: String(a[r] || '').slice(0, 120), en: String(b[r] || '').slice(0, 120) }
            }
          }
          return null
        })(),
      },
      //  ① 语言过滤：中文档下所有 .lang-en 必须 display:none，英文档下所有 .lang-zh 必须 display:none
      langFilterOk: (() => {
        const zhOk = blocks.filter((b) => /(^|\s)lang-zh(\s|$)/.test(b.cls)).every((b) => (isEn ? b.filtered : !b.filtered))
        const enOk = blocks.filter((b) => /(^|\s)lang-en(\s|$)/.test(b.cls)).every((b) => (isEn ? !b.filtered : b.filtered))
        return !!(zhOk && enOk)
      })(),
    }
  }
  function fixWpsetDoc() {
    /* ⚠ 本块在 `init()` 里：作用域里是 `doc`（`q`/`D` 属于 initSiteShell ⇒ 写错就是一次被吞掉的 ReferenceError）。
       ⚠ 扫描**整份文档**（不限定某个容器）：这张表在产物里可能被克隆出多份（真机读数：`.tag-todo` 有 12 个
       = 同一份 4 行 × 3 处），只改 `#page-wpset` 那一份会漏掉另外两份。判据：**末列真的写着"需实现"**。 */
    if (!doc || !doc.querySelectorAll) return 0
    let n = 0
    for (const tr of doc.querySelectorAll('tbody tr')) {
      try {
        /* 幂等标记带**语言**：同一行在切语言后要按新语言重写一次（否则中英又不同步了）。 */
        const mark = 'fixed-' + curLang
        if (tr.dataset && tr.dataset.benchWpset === mark) continue
        const first = tr.querySelector('td')
        const label = String((first && first.textContent) || '').trim()
        const hit = WPSET_DONE.find((w) => w.match.test(label))
        if (!hit) continue
        const cells = tr.querySelectorAll('td')
        const last = cells[cells.length - 1]
        if (!last) continue
        if (!last.querySelector('.tag-todo')) continue      // 只改"声明了需实现"的行（已实现/不做/自带的都不动）
        last.textContent = ''
        const tag = doc.createElement('span')
        tag.className = 'tag tag-ok'
        tag.textContent = t(curLang, 'wpset.done')     // ⚠ init() 里的 `curLang` 是**字符串**（`let curLang = langOf()`），不是函数
        const note = doc.createElement('span')
        note.className = 'bench-wpset-note'
        note.textContent = '（' + (curLang === 'zh' ? hit.zh : hit.en) + '）'
        last.appendChild(tag); last.appendChild(note)
        tr.dataset.benchWpset = mark
        n++
      } catch { /* 单行失败不影响别的行 */ }
    }
    return n
  }
  try { fixWpsetDoc() } catch (e) { console.warn('[bench-patch] fixWpsetDoc 失败（文档页文案修正，非功能）：' + String((e && e.message) || e)) }
  //  切到「壁纸设置」页签时再修一次（产物可能重渲染页面；`fixWpsetDoc` 自带 `data-bench-wpset` 幂等标记）
  try {
    const tabWpsetEl = doc.querySelector('#tab-wpset')
    if (tabWpsetEl) tabWpsetEl.addEventListener('click', () => setTimeout(() => { try { fixWpsetDoc() } catch { /* 同上 */ } }, 0))
  } catch { /* 桩 DOM */ }

  // ── A2/A3 + ⑶⑹ 本地文件夹库：静态托管下「选择文件夹」是**唯一**的本地载入方式 ──
  //   ⑶ 分类切换器已删除：不再按 scene/web/video 过滤，改为扫描时**自动识别类型**并显示在每个条目的名字下面。
  //   ⑹ 只认真正的目录选择（webkitRelativePath 含 '/'）：单文件选择给明确提示，绝不假装"正在读取文件夹"。
  //   渲染到**独立容器** #bench-local（挂在 #list 之后），不碰 bundle 的 #list。
  const pickLibBtn = $('#pick-lib')
  let localItems = []
  let localInput = null
  const localBox = doc.createElement('div')
  localBox.id = 'bench-local'
  localBox.className = 'bench-local'
  localBox.hidden = true
  const listHost = $('#list')
  if (listHost && listHost.parentNode) listHost.parentNode.insertBefore(localBox, listHost.nextSibling)
  function renderLocal() {
    if (!localBox) return
    if (!localItems.length) { localBox.hidden = true; return }
    localBox.hidden = false
    localBox.innerHTML = ''
    const h = doc.createElement('div'); h.className = 'bench-local-head'
    h.textContent = t(curLang, 'local.count', { n: localItems.length })
    const hint = doc.createElement('div'); hint.className = 'bench-local-hint'
    hint.textContent = t(curLang, 'local.sceneOnly')
    localBox.appendChild(h); localBox.appendChild(hint)
    const ul = doc.createElement('ul'); ul.className = 'bench-local-list'
    for (const it of localItems) {
      const kind = it.kind || 'unknown'
      const li = doc.createElement('li')
      li.dataset.kind = kind
      const name = doc.createElement('span'); name.className = 'bench-local-name'
      name.textContent = it.title || it.dir
      // ⑶ 类型小标签（在名字下面一行）：扫描时自动识别，不再需要用户手选分类
      const meta = doc.createElement('span'); meta.className = 'bench-local-meta'
      const tag = doc.createElement('span'); tag.className = 'bench-kind'; tag.textContent = kind
      tag.title = t(curLang, 'local.kindTitle', { k: kind })
      const dirEl = doc.createElement('span'); dirEl.className = 'bench-local-dir'; dirEl.textContent = it.dir
      meta.appendChild(tag); meta.appendChild(dirEl)
      li.appendChild(name); li.appendChild(meta)
      li.title = it.dir
      if (it.pkg) li.addEventListener('click', () => previewLocal(it))
      else { li.classList.add('disabled'); li.title = it.dir + ' — ' + t(curLang, 'local.sceneOnly') }
      ul.appendChild(li)
    }
    localBox.appendChild(ul)
  }
  async function previewLocal(it) {
    if (!it.pkg) return
    const fr = $('#frame')
    if (!fr) return
    try {
      const api = await ensureRendererFrame(fr)
      api.loadSceneFile(it.pkg)
      onWallpaperOpened(it.id || it.dir)          // 第五批③④：本地路径直接知道是哪张壁纸（品牌 + 拖动开关）
      const cur = $('#current')
      if (cur) { cur.textContent = it.title || it.pkg.name; cur.title = cur.textContent }
      const em = $('#empty'); if (em) em.style.display = 'none'
      fr.classList.add('on')
      logLine(t(curLang, 'local.preview', { name: it.title || it.pkg.name }))
    } catch (e) { logLine('❌ ' + (e && e.message), true) }
  }
  // ⑹ 「清空」按钮：清掉本地库 + 列表 + 选择/舞台状态（用户报"点清空也清空不了"）
  function clearLocalLibrary(silent) {
    localItems = []
    if (localInput) { try { localInput.value = '' } catch { /* 隐私模式 */ } }
    if (localBox) { localBox.hidden = true; localBox.innerHTML = '' }
    const cur = $('#current')
    if (cur) { cur.textContent = t(curLang, 'tab.wallpaper'); cur.title = '' }
    const fr = $('#frame')
    if (fr) { fr.removeAttribute('src'); fr.classList.remove('on') }
    const em = $('#empty'); if (em) em.style.display = ''
    for (const li of doc.querySelectorAll('#list li')) li.classList.remove('active')
    renderLocal()
    if (!silent) logLine(t(curLang, 'local.cleared'))
  }
  // 复用 bundle 自己的渲染器页契约（同一个 URL、同一个 __wp 接口），只是由我们发起
  function ensureRendererFrame(fr) {
    return new Promise((resolve, reject) => {
      const w = fr.contentWindow
      if (w && w.__wp) return resolve(w.__wp)
      const onLoad = () => {
        const w2 = fr.contentWindow
        if (w2 && w2.__wp) resolve(w2.__wp)
        else reject(new Error('renderer page loaded but __wp missing'))
      }
      fr.addEventListener('load', onLoad, { once: true })
      // ①(P-127) 自己发起的那次挂载用**新站点路径**（旧名只作为 minified 产物里的遗留前缀被兼容，
      //   见 SITE_PATH_ALIASES）：本机两个挂载点都能解析，线上由下面的 src 前缀改写转成相对本页。
      fr.src = '/' + SITE_MOUNT + '/renderer/index.html?_t=' + Date.now()
    })
  }
  // ⑹ 目录选择能力：webkitdirectory 是唯一跨 Chrome/Edge/Firefox/Safari 的目录 API（且可被自动化验证）；
  //    只有在它缺席时才退回新的 showDirectoryPicker（Chromium 系）。两者都没有 ⇒ 明确置灰 + 说明原因。
  const canPickViaInput = () => {
    try { return 'webkitdirectory' in doc.createElement('input') } catch { return false }
  }
  const canShowDirPicker = () => {
    try { return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function' } catch { return false }
  }
  // 第七批：把「拿到一棵授权树」抽成独立步骤（onEntries 回调），因为选择器需要**整棵树**
  //   （目录 + 文件）才能浏览；旧入口（bundle enterStaticMode / 探针 / 测试）走 loadLocalEntries 不变。
  let localInputCb = null
  function ensureLocalInput() {
    if (localInput) return localInput
    localInput = doc.createElement('input')
    localInput.type = 'file'; localInput.multiple = true
    localInput.setAttribute('webkitdirectory', ''); localInput.setAttribute('directory', '')
    localInput.style.display = 'none'
    localInput.addEventListener('change', () => {
      const fs2 = Array.from(localInput.files || [])
      localInput.value = ''                                      // 允许重复选择同一目录
      const cb = localInputCb; localInputCb = null
      if (!fs2.length) { if (cb) cb(null); return }               // 用户取消：不打印、不清空
      const entries = fs2.map((f) => ({ path: f.webkitRelativePath || f.name, file: f }))
      if (cb) cb(entries)
      else loadLocalEntries(entries)
    })
    doc.body.appendChild(localInput)
    return localInput
  }
  /**
   * 「选择文件夹」（系统对话框）——`onEntries(entries|null)`：entries = [{path,file}]（取消 ⇒ null）。
   * 不传 onEntries 时保持历史行为（直接扫描进本地库）。
   */
  function pickLocalFolder(opt) {
    const cb = (opt && typeof opt.onEntries === 'function') ? opt.onEntries : null
    if (canPickViaInput()) { localInputCb = cb; ensureLocalInput().click(); return true }
    if (canShowDirPicker()) { pickLocalFolderViaHandle(cb); return true }
    logLine(t(curLang, 'local.unsupported'), true)
    if (cb) cb(null)
    return false
  }
  /** showDirectoryPicker（Chromium）：递归取回 {path,getFile}（惰性，不读内容），与 webkitdirectory 同一条链。
   *  onlyWallpaper=true 时只收 scene.pkg/project.json（旧行为：直接扫描）。 */
  async function walkHandle(root, opt) {
    const o = Object.assign({ maxDepth: 6, maxFiles: 4000, onlyWallpaper: false }, opt || {})
    const out = []
    const walk = async (dir, prefix, depth) => {
      if (depth > o.maxDepth || out.length > o.maxFiles) return
      for await (const handle of dir.values()) {
        const path = prefix ? prefix + '/' + handle.name : handle.name
        if (handle.kind === 'directory') await walk(handle, path, depth + 1)
        else if (handle.kind === 'file') {
          const hit = !o.onlyWallpaper || /^(scene\.pkg|project\.json)$/i.test(handle.name)
          if (hit) out.push({ path: root.name + '/' + path, getFile: () => handle.getFile() })
        }
      }
    }
    await walk(root, '', 0)
    return out
  }
  /** showDirectoryPicker 兜底（Chromium）：递归取回 {path,file}，与 webkitdirectory 走同一条扫描链 */
  async function pickLocalFolderViaHandle(cb) {
    try {
      const root = await window.showDirectoryPicker()
      const entries = await walkHandle(root, { onlyWallpaper: true })
      // 旧链路要 File（loadLocalEntries 直接读 project.json 文本）⇒ 这里当场取回
      for (const e of entries) { try { e.file = await e.getFile() } catch { e.file = null } }
      if (cb) cb(entries)
      else loadLocalEntries(entries)
    } catch (e) {
      if (e && (e.name === 'AbortError')) { if (cb) cb(null); return }   // 用户取消
      logLine(t(curLang, 'local.unsupported') + ' — ' + String(e && e.message), true)
      if (cb) cb(null)
    }
  }
  /**
   * ⑹ 扫描入口（也是探针/测试的驱动接口）：entries = [{path, file}]
   * 关键修复：只有**确实是目录选择**（path 里带 '/'）才说「正在读取文件夹」；
   * 只回传散文件（浏览器把目录选择当单文件 / 用户选了单个文件）⇒ 给明确提示，且**不动**已有本地库。
   */
  async function loadLocalEntries(entries) {
    const plan = planLocalScan(entries)
    if (plan.selection === 'empty') return
    if (plan.selection === 'notdir') { logLine(t(curLang, 'local.notDir'), true); return }
    logLine(t(curLang, 'local.reading'))
    const items = []
    for (const it of plan.items) {
      let meta = {}
      if (it.proj && it.proj.file && typeof it.proj.file.text === 'function') {
        try { meta = JSON.parse(await it.proj.file.text()) || {} } catch { /* 坏 project.json 忽略 */ }
      }
      // 第五批③：图标优先取 project.json 里 preview 字段指向的那张图（同名文件才认）
      const want = String(meta.preview == null ? '' : meta.preview).trim().toLowerCase()
      const hit = want ? (it.files || []).find((f) => String(f.name).toLowerCase() === want) : null
      const previewFile = (hit && hit.file) ? hit.file : (it.prev ? it.prev.file : null)
      items.push({
        dir: it.dir,
        id: it.dirName,                                             // 工坊 itemId 形态（目录名），品牌/拖动开关按它查
        title: String(meta.title || it.dirName),
        kind: detectWallpaperKind(meta, it.names) || 'unknown',     // ⑶ 扫描时自动识别类型
        pkg: it.pkg ? it.pkg.file : null,
        proj: it.proj ? it.proj.file : null,
        preview: previewFile,                                       // 第五批③：媒体组件图标（preview.gif）
        properties: (meta.general && meta.general.properties) || null,   // 第五批④：找「可拖动」类布尔属性
      })
    }
    localItems = items
    if (!items.length) { logLine(t(curLang, 'local.none'), true); renderLocal(); return }
    logLine(t(curLang, 'local.count', { n: items.length }))
    renderLocal()
  }
  // ⑤(P-158) 「系统选择器」**只作为兜底按钮**：对话框里那个按钮置位后转发给产物自己那条原生路径
  //   （`POST /api/library-dir {pick:true}`）；默认入口永远是**应用内**对话框。
  let sysPassthrough = false
  /** 摘下产物自己的 `#pick-lib.onclick`（见下面那段根因注释）；返回是否摘到了。 */
  function detachArtifactPickChain() {
    try {
      if (pickLibBtn && typeof pickLibBtn.onclick === 'function') {
        artifactPickChain = pickLibBtn.onclick
        pickLibBtn.onclick = null
        return true
      }
    } catch { /* 桩 DOM */ }
    return false
  }
  let artifactPickChain = null
  /** 用户显式选了「系统选择器」兜底 ⇒ 临时把产物那条原生链装回来跑一次，跑完立刻再摘。 */
  function callArtifactPickChain() {
    const fn = artifactPickChain
    if (!pickLibBtn || typeof fn !== 'function') return false
    try { fn.call(pickLibBtn) } catch { /* 产物没接上：下面照样摘干净 */ }
    detachArtifactPickChain()
    return true
  }
  if (pickLibBtn) {
    // 静态托管下 bundle 会 disable 它（bench.ts enterStaticMode）；我们的本地库让它重新可用
    const reenable = () => {
      if (pickLibBtn.disabled && localItems.length === 0) {
        pickLibBtn.disabled = false
        pickLibBtn.title = t(curLang, 'local.pickTitle')
      }
    }
    reenable(); setTimeout(reenable, 800); setTimeout(reenable, 2500)
    /* ①(用户第 1 条 · 2026-09-20 **本批根因**)：产物自己的 `#pick-lib.onclick` 必须**摘掉**。
       为什么"捕获阶段抢在它之前"这句话不成立：产物是**同一个元素**上的 `onclick`（IDL 属性处理器），
       按 DOM 规范它在 AT_TARGET 阶段与 `addEventListener(..., true)` **按注册顺序**跑，而产物先注册
       （`bench-DSKWIqmS.js` 在 head 里先于本补丁执行）⇒ 捕获拦不住它。它会：
         POST /api/library-dir {pick:true} ⇒ 服务端明确降级 `{cancelled:true,unsupported:true}` ⇒
         `window.prompt('壁纸库目录')`（产物那条"手输目录"回退）—— **模态**对话框把主线程按住，
         本补丁对话框 `/api/fs/list` 的响应只能在它被关掉之后才排得上队。
       真机/门禁读数就是这个：`{status:200, rows:0, dirs:0, path:"Reading…"}` —— 后端 200 却一行不落。
       修法：接管入口时把产物的处理器摘下来存着（`detachArtifactPickChain()`），只在用户**显式**
       点「系统选择器」兜底时临时装回（`callArtifactPickChain()`），跑完立刻再摘一次。
       判据：门禁 `bench-ui-headless` F0 断言 `#pick-lib.onclick === null`，且整轮 `window.prompt`
       调用计数为 0（在 addInitScript 里计数）。 */
    detachArtifactPickChain()
    // 产物在 boot 里可能晚一步才挂上（或将来改挂法）⇒ 几个时刻各摘一次（摘不到返回 false，不报错）
    setTimeout(detachArtifactPickChain, 600); setTimeout(detachArtifactPickChain, 2000)
    pickLibBtn.addEventListener('click', (e) => {
      if (pickLibBtn.disabled) return
      // 兜底路径：用户**显式**点了对话框里的「系统选择器」⇒ 临时放行给产物（跑完立刻再摘），随后复位标记
      if (sysPassthrough) { sysPassthrough = false; callArtifactPickChain(); return }
      e.preventDefault(); e.stopImmediatePropagation()
      try { openLibDirDialog() } catch (err) { openLibraryPicker() }     // 对话框自身出错仍留一条纯前端活路
    }, true)   // 捕获阶段：产物将来若改成祖先上的冒泡监听，这里也能先手
  }
  const clearLocalBtn = $('#clear-local')
  if (clearLocalBtn) clearLocalBtn.addEventListener('click', () => clearLocalLibrary(false))

  /* ==================== 第七批：插件同款选择器（文件夹 / 文件）+ 滚动位置稳定 ====================
     同款交互（对照 dsh-mpkg-wallpaper/lib/client.js:9856-9906 的目录选择弹窗）：
       标题 + 当前目录 + 「回到最上层 / 上一级」+ 子目录列表 + 底部「就选这个文件夹 / 取消」；
       列表限高可滚动；单击目录进入；过滤框筛名字。
     数据来源的**唯一**差别：插件跑在 DSH 宿主里，宿主能直接读盘（/list-dirs?path=…）；
       网页没有这个能力 —— 只能浏览**用户自己授权过的那棵树**
       （webkitdirectory 全选 或 showDirectoryPicker；两者都没有 ⇒ 按老规矩明说不可用）。
     滚动为什么以前会跳顶/锁顶（三条根因，逐条都有对应修法）：
       ① 旧代码 `localBox.innerHTML = ''` 整块重建列表 ⇒ 容器内容瞬间变空，浏览器把 scrollTop
          夹到 0（异步扫描返回后再重建一次 ⇒ 用户滑到一半就被"弹回顶上"）；
          ⇒ 现在**只做按键增量更新**（pickerRowDiff：复用节点、只增删差集，appendChild 原地排序），
            并保证"列表里内容高度突变"这件事本身不再发生。
       ② 重绘后没有任何"回位"逻辑；而浏览器自带的 CSS 滚动锚定（overflow-anchor）会按**它自己的**
          启发式改 scrollTop —— 它挑的锚点与用户的视线不一致时就表现为"有时候自动弹跳"；
          ⇒ 容器 `overflow-anchor:none` 让浏览器退场，改成我们自己的"锚点行 + 偏移"精确回位
            （pickerRestoreScroll；锚点行没了就夹住原位置，**绝不回 0**）。
       ③ 插件那条老路（按比例恢复 + 恢复逻辑与用户滚轮打架）会把"用户正在滚"当成"该恢复"，
          表现为"锁在最顶上"；⇒ 用户刚滚过 700ms 内一个字都不写 scrollTop（pickerScrollGuard），
          并且程序化写入期间的 scroll 事件不计入"用户在滚"（否则自己把自己锁住）。
       另外两条小纪律：行**不**调用 focus()（打字机式的 focus 会把滚动容器滚到顶）、
       弹窗自身 focus({preventScroll:true})；点行用 pointerdown 锁定目标、click 时用锁定值
       （列表重排时不会点错行 —— 插件 client.js:9883-9891 的同款教训）。 */
  const BENCH_PICK_CSS = [
    '/* 第七批：选择器（单源在 bench-patch.js，运行期注入 —— :8902 宿主的产物 CSS 实际取不到，',
    '   只往产物 CSS 里追加的话那边就没样式） */',
    '.bench-dirbox{position:fixed;inset:0;z-index:9000;display:flex;align-items:center;justify-content:center;',
    'background:rgba(0,0,0,.45);font-family:var(--ui-font,-apple-system,"Segoe UI","Noto Sans CJK SC",sans-serif);color:var(--fg,#ccc)}',
    '.bench-dirbox-win{width:min(580px,92vw);max-height:min(80vh,660px);display:flex;flex-direction:column;overflow:hidden;',
    'border:1px solid var(--widget-border,#3c3c3c);border-radius:6px;background:var(--panel,#1b1b1b);box-shadow:0 18px 48px rgba(0,0,0,.55)}',
    '.bench-dirbox-head{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--hairline,#2b2b2b)}',
    '.bench-dirbox-title{flex:1;min-width:0;font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.bench-dirbox-x{width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;',
    'border:1px solid var(--widget-border,#3c3c3c);border-radius:3px;background:var(--input,#313131);color:inherit}',
    '.bench-dirbox-path{padding:6px 12px 0;font-family:var(--mono,monospace);font-size:11px;color:var(--fg-dim,#9d9d9d);word-break:break-all}',
    '.bench-dirbox-tools{display:flex;align-items:center;gap:6px;padding:7px 12px}',
    /* ①(2026-09-24 用户第 1 条「快捷根太多 ⇒ 溢出，且"当前库目录"被竖排成一字一行；后面几个选项同样问题；
       有的快捷根根本没显示出来」)。改前：这一行与 `.bench-dirbox-tools` 同款 `display:flex` **不换行**、
       chip 又不限制换行 ⇒ 窄窗格里 flex 收缩把按钮压成一条竖线（"一字一行"），再加上
       `.bench-dirbox-win{overflow:hidden}` ⇒ 后面的根直接看不见。
       改后：`flex-wrap:wrap` + chip `white-space:nowrap`（文字永不逐字折断）+ 超长标签用省略号 +
       整行 `max-height` 自带纵向滚动（根再多也点得到）。服务端侧同时把候选从 8–9 条减到 ≤6 条。 */
    '.bench-dirbox-roots{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:7px 12px;max-height:112px;overflow:auto}',
    '.bench-dirbox-roots button{flex:0 1 auto;min-width:0;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.bench-dirbox-tools button{height:24px;padding:0 8px;display:inline-flex;align-items:center;gap:4px;cursor:pointer;',
    'border:1px solid var(--widget-border,#3c3c3c);border-radius:3px;background:var(--input,#313131);color:inherit;font-size:11px}',
    '.bench-dirbox-tools button:disabled{opacity:.45;cursor:default}',
    '.bench-dirbox-filter{flex:1;min-width:0;height:24px;padding:0 8px;border:1px solid var(--widget-border,#3c3c3c);border-radius:3px;',
    'background:var(--input,#313131);color:inherit;font-size:11.5px}',
    '.bench-dirbox-filter:focus{border-color:var(--fg,#ccc);outline:none}',
    '/* overflow-anchor:none = 让浏览器自带的滚动锚定退场（"有时候自动弹跳"的另一半根因） */',
    '.bench-dirbox-list{flex:1 1 auto;min-height:132px;max-height:46vh;overflow-y:auto;overflow-anchor:none;padding:4px 6px;',
    'border-top:1px solid var(--hairline,#2b2b2b);border-bottom:1px solid var(--hairline,#2b2b2b)}',
    '.bench-dirbox-row{display:flex;align-items:center;gap:6px;padding:4px 7px;border-radius:3px;font-size:12px;cursor:pointer;',
    'user-select:none;-webkit-user-select:none}',
    '.bench-dirbox-row:hover{background:var(--hover,rgba(255,255,255,.07))}',
    '.bench-dirbox-row.on{background:var(--accent,#0078d4);color:#fff}',
    '.bench-dirbox-row svg{flex:none;opacity:.85}',
    '.bench-dirbox-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.bench-dirbox-sub{flex:none;font-size:10px;opacity:.6}',
    '.bench-dirbox-empty{padding:10px 8px;font-size:11.5px;line-height:1.6;opacity:.7}',
    '.bench-dirbox-note{padding:6px 12px 0;font-size:10.5px;line-height:1.6;color:var(--fg-mute,#6e6e6e)}',
    '.bench-dirbox-foot{display:flex;align-items:center;gap:8px;padding:8px 12px}',
    '.bench-dirbox-count{flex:1;font-size:11px;color:var(--fg-dim,#9d9d9d)}',
    '.bench-dirbox-go{height:26px;padding:0 12px;display:inline-flex;align-items:center;gap:5px;cursor:pointer;',
    'border:1px solid var(--widget-border,#3c3c3c);border-radius:3px;background:var(--accent,#0078d4);color:#fff;font-size:11.5px}',
    '.bench-dirbox-go:disabled{opacity:.45;cursor:default}',
    '.bench-dirbox-go2{background:var(--input,#313131);color:inherit}',
    '/* ② README 面板被切：三条显式轨道与三个子元素钉死（顺序不再随 display:none 漂移）；',
    '   只剩文档视图时把两条空轨道收成 0px（改动前的 200px 死区就是这么来的） */',
    '#main > #editor-chrome{grid-row:1}',
    '#main > #workspace{grid-row:2}',
    '#main > #logs{grid-row:3}',
    '#main.bench-view-docs{grid-template-rows:0px minmax(0,1fr) 0px}',
    /* ③(2026-09-24 用户第 3 条) 面板上的图片去重控件（`#bench-imgmode-wrap` / `#bench-imgmode` /
       `#bench-imgmode-note`）**连同它的 CSS 一起删除** —— 缺省就是"全部都去重"（`once`），
       对照/排障走 URL 档 `?propimg=`。下面这条是**保留项**：未归并的变体图给一条虚线框（排查用）。 */
    '.bench-prop-img[data-bench-img-unmerged="1"]{outline:1px dashed var(--border)}',
  ].join('')
  function injectBenchPickerStyle() {
    try {
      if (!doc.head || $('#bench-pick-style')) return false
      const st = doc.createElement('style')
      st.id = 'bench-pick-style'
      st.textContent = BENCH_PICK_CSS
      doc.head.appendChild(st)
      return true
    } catch { return false }
  }
  const BENCH_STYLE_INJECTED = injectBenchPickerStyle()

  /* ═══════════ ⑩ 站点外壳（2026-09-17 新样式 docs/newstyle.md） ═══════════
     顶部 site header（tab：控制台/说明/壁纸设置 + 设置弹层 + 深色浅色切换）
     中部三列：选择壁纸 │ 壁纸参数 │ 右侧（切换栏+设置1 / 壁纸 / 控制台）
     底部状态栏。切页 = 整条 track 平移（只 transform，不改宽度 ⇒ iframe 不重排）。 */
  // ①(2026-09-18) 窄屏/手机自适应的 @media 规则**只放在 index.html 的静态表里**（`#bench-shell-static`）：
  //   静态表是首屏权威、且 D8 比对会跳过 @media 条目；这里不再重复，避免两处漂移。
  const SITE_LAYOUT_CSS = [
    /* 外壳 */
    'body{display:flex!important;flex-direction:column;grid-template-rows:none!important}',
    '#site-header{flex:none;height:44px;display:flex;align-items:center;gap:14px;padding:0 12px;background:var(--titlebar);border-bottom:1px solid var(--border);position:relative;z-index:30}',
    '#site-brand{display:flex;align-items:center;gap:8px;font-weight:600;font-size:13px;color:var(--fg);white-space:nowrap}',
    '.brand-dot{width:10px;height:10px;border-radius:50%;background:linear-gradient(135deg,var(--accent,#0078d4),#7dd3fc)}',
    '#app-version{font-size:11px;color:var(--fg-mute);font-weight:400}',
    '#site-tabs{position:relative;display:flex;align-items:stretch;height:100%}',
    '.site-tab{appearance:none;border:0;background:transparent;color:var(--fg-dim);font:inherit;font-size:13px;padding:0 14px;cursor:pointer;border-bottom:2px solid transparent}',
    '.site-tab:hover{color:var(--fg)}',
    '.site-tab.active{color:var(--fg);border-bottom-color:transparent}',
    '#site-tab-ink{position:absolute;bottom:0;left:0;height:2px;width:0;background:var(--accent,#0078d4);transition:none;pointer-events:none}',
    '#site-actions{margin-left:auto;display:flex;align-items:center;gap:8px;position:relative}',
    '#settings-btn{appearance:none;font:inherit;font-size:12.5px;color:var(--fg);background:transparent;border:1px solid var(--border);border-radius:6px;padding:4px 10px;cursor:pointer}',
    '#settings-btn:hover,#settings-btn[aria-expanded="true"]{background:var(--accent,#0078d4);border-color:var(--accent,#0078d4);color:#fff}',
    '#site-actions .theme-btn{width:30px;height:26px;border:0;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;place-items:center;padding:0;line-height:1;box-sizing:border-box}',
    '#theme-toggle .ic{display:block;flex:none}',
    /* ⑥(用户第 6 条) 图标几何居中的第三件事：内联 svg 走基线对齐会带 line-box 降部留白 ⇒ 块级化。 */
    '#theme-toggle svg.ic{display:block;line-height:1;margin:0;vertical-align:middle}',
    '.theme-seg{display:inline-flex;align-items:center;border:1px solid var(--border);border-radius:6px;overflow:hidden}',
    '.theme-opt{appearance:none;font:inherit;font-size:12px;color:var(--fg-dim);background:transparent;border:0;padding:3px 9px;cursor:pointer}',
    '.theme-opt + .theme-opt{border-left:1px solid var(--border)}',
    '.theme-opt:hover{color:var(--fg)}',
    '.theme-opt[aria-pressed="true"]{background:var(--accent,#0078d4);color:#fff}',
    '#settings-pop{position:absolute;right:0;top:calc(100% + 6px);width:330px;background:var(--panel);border:1px solid var(--border);border-radius:8px;box-shadow:0 14px 40px rgba(0,0,0,.38);padding:10px 12px;z-index:40;display:flex;flex-direction:column;gap:8px;font-size:12.5px}',
    /* ⑫b(2026-09-19 用户要求) 捕手必须**低于** #site-header：header 是 `position:relative;z-index:30` 的
       层叠上下文，弹层自己在里面 z-index:40 —— 但整个上下文在根级只有 30。捕手原来是 35（根级），
       ⇒ 它盖在**整个 header 之上**（弹层也不例外）：点「语言」命中的是捕手 ⇒ pointerdown 直接关弹层，
       语言永远切不了。改成 29（根级：高于内容层 #pages-track 的 auto、低于 header 的 30）⇒
       弹层收得到点击，点页面其它地方仍然是"先命中捕手 ⇒ 关"。 */
    '#settings-catcher{position:fixed;inset:0;z-index:29;background:transparent}',
'#settings-pop[hidden]{display:none!important}',
    '.pop-row,.lang-box{display:flex;align-items:center;gap:8px}',
    '.pop-k{color:var(--fg-mute);min-width:44px}',
    '.pop-val{color:var(--fg)}',
    '.pop-note{margin:2px 0 0;color:var(--fg-mute);font-size:11.5px;line-height:1.6}',
    '.pop-credit{margin-top:2px;padding-top:8px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:3px;font-size:11.5px;color:var(--fg-mute)}',
    '.pop-credit a{color:var(--link,var(--accent,#58a6ff));pointer-events:auto;cursor:pointer;text-decoration:underline;text-underline-offset:2px}',
    /* 三页滑动轨道 */
    '#pages-track{flex:1 1 auto;width:auto;display:flex;flex-direction:column;min-height:0;min-width:0;overflow:hidden;contain:paint;transform:none!important;transition:none!important}',
    '.page{flex:1 1 auto;width:100%;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden}',
    '#page-docs,#page-wpset{overflow-y:auto;background:var(--editor)}',
    /* 工作台三列 */
    '#workbench{flex:1;grid-template-columns:var(--mpw-lib-w,300px) auto minmax(0,1fr)!important;min-height:0;overflow:hidden}',
    '#activitybar{display:none!important}',
    '#sidebar{grid-column:1;width:auto!important;max-width:none!important;min-width:0!important;resize:none!important}',
    /* ⑭(P-142 2026-09-19 用户第 1 项)「资源管理器」收纳：状态类在 <body>（见 index.html ⑭ 段的长注释：
       D8 只会给选择器前缀 `html.bench-shell ` ⇒ 挂 <html> 的复合选择器写不进这张表，挂 <body> 的后代选择器可以）。
       收起 = 网格第 1 列 26px（`--mpw-lib-w`）⇒ #main/#workspace/#stage 真的跟着变宽（不是盖住、不留空占位）。 */
    '#sidebar{position:relative}',
    '#sidebar-toggle{position:absolute;top:0;right:0;width:26px;height:35px;display:flex;align-items:center;justify-content:center;padding:0;border:0;background:transparent;color:var(--fg-dim);cursor:pointer;z-index:3}',
    '#sidebar-toggle:hover{background:var(--hover,rgba(255,255,255,.07));color:var(--fg)}',
    '#sidebar-toggle svg{display:block}',
    'body.bench-nav-collapsed{--mpw-lib-w:26px}',
    'body.bench-nav-collapsed #sidebar{border-right:1px solid var(--border)}',
    'body.bench-nav-collapsed #sidebar > :not(#sidebar-toggle){display:none!important}',
    'body.bench-nav-collapsed #sidebar-toggle{position:static;flex:1 1 auto;width:100%;height:auto}',
    'body.bench-nav-collapsed #sidebar-toggle svg{transform:rotate(180deg)}',
    '#props{grid-column:2;width:var(--mpw-props-w,320px);min-width:0;border-left:1px solid var(--border);border-right:1px solid var(--border)}',
    /* ⑭(P-142 2026-09-19 用户第 2/3 项) 声音控件挂点：`#props` 下半部浮层（组件卡片 + 本补丁的传输条）。
       `--mpw-np-cover` = **展开态**遮住的高度（卡片 189 + 传输条 30，189 由 P-138 的
       `now-playing-math.mjs` 的 `OPEN` 给出，门禁逐值对账）⇒ `#props-body` 的 padding-bottom 把它算进去，
       两个状态下每个属性项都滚得到（"永久遮住"在门禁里是不变量）。 */
    /* ⑦(P-228f 2026-10-05) 「壁纸配置」栏底部那条播放进度条（`#np-audio`：静音/进度/时间/曲目名）去掉 ——
       已有 NP 卡片，它是多余的。只留卡片高度（`--mpw-np-cover` = 卡片），不再为传输条预留 `--mpw-np-strip`。 */
    '#props{position:relative;--mpw-np-card:189px;--mpw-np-strip:0px;--mpw-np-cover:var(--mpw-np-card)}',
    '#np-audio{display:none!important}',
    '#np-host{position:absolute;left:0;right:0;bottom:0;height:var(--mpw-np-cover);display:flex;flex-direction:column;justify-content:flex-end;pointer-events:none;z-index:5}',
    /* ③(2026-09-25 issue0924a2 用户第 3 条「我说的把音量的按钮集成到 NP 的卡片里面，你还是没有做好」)
       上一轮的做法（`#np-volbar` = 卡片**下面**再加一条独立行）已**整块撤掉**：真源不再是"补丁在卡片外
       造一条"，而是**组件自己**在卡片内部画一条音量轨（时钟行中间）+ 传输行第四键（音量/静音）
       —— 与下游 DSH 插件 `dsh-mpkg-wallpaper/lib/now-playing.js` 的 `showVolume = late > 0` 同一套。
       所以这里的 CSS 只留两件事：① 让 `#np-mount` 那圈透明区照旧不吃点击；② 把**音量轨**放行
       （`#np-mount > *{pointer-events:none}` 会让整棵子树都不吃事件）。滑条自身的形状/颜色在
       `demo/now-playing/now-playing.css` 的 `.snd-clock input[type="range"][data-mpw-np-vol-range]`
       （组件自己的作用域、只用既有类 + 属性选择器，与本表零重叠）。 */
    '#np-host > *{pointer-events:auto}',
    '#np-mount{height:var(--mpw-np-card);display:flex;justify-content:center;align-items:flex-start;pointer-events:none}',
    '#np-mount > *{pointer-events:none}',
    /* 卡片四周那圈透明区不吃点击（收起时上下各 55.5px），只有真控件吃 ⇒ 后面的属性项照常点得到 */
    '#np-mount .snd button{pointer-events:auto}',
    '#np-mount .snd [data-mpw-np-vol-range], #np-mount .snd [data-mpw-np-volnum]{pointer-events:auto}',
    '#props-body{padding-bottom:calc(20px + var(--mpw-np-cover))}',
    /* ⑤(P-228f 2026-10-05) 滚动条适配：`#props-body` 右侧原来吃的是**浏览器默认滚动条**（深色主题下
       就是一条纯黑矩形）。这里按面板主题色做细滚动条：Firefox 走 `scrollbar-width/scrollbar-color`，
       WebKit/Chromium 走 `::-webkit-scrollbar*`（滑块用 `--widget-border`、悬停用 `--accent`）。 */
    '#props,#props-body{scrollbar-width:thin;scrollbar-color:var(--widget-border,#3c3c3c) transparent}',
    '#props-body::-webkit-scrollbar{width:10px;height:10px}',
    '#props-body::-webkit-scrollbar-track{background:transparent}',
    '#props-body::-webkit-scrollbar-thumb{background:var(--widget-border,#3c3c3c);border-radius:6px;border:2px solid transparent;background-clip:content-box}',
    '#props-body::-webkit-scrollbar-thumb:hover{background:var(--accent,#0078d4);background-clip:content-box}',
    '#props[data-np="missing"] #props-body{padding-bottom:20px}',
    '#props[data-np="missing"] #np-host{display:none}',
    '#np-audio{height:var(--mpw-np-strip);display:flex;align-items:center;gap:6px;padding:0 8px;background:color-mix(in srgb,var(--panel) 86%,transparent);border-top:1px solid var(--border);font-size:11px;color:var(--fg-dim);min-width:0;max-width:100%;box-sizing:border-box;overflow:hidden}',
    '#np-mute{flex:none;width:22px;height:22px;display:flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:4px;background:transparent;color:var(--fg);cursor:pointer}',
    '#np-mute:hover{background:var(--hover,rgba(255,255,255,.07))}',
    /* ②A2(2026-09-24 用户「调节音量的那个条超出了壁纸配置的宽度」)
       改前：`#np-volume{flex:none;width:64px}` + `#np-seek{flex:1;min-width:40px}` + `#np-time` + `#np-stage{max-width:110px}`
       全是**不可压**的固定宽 ⇒ 传输条最小内容宽 ≈ 22+64+40+24(gap)+~50(time)+110(stage)+16(padding) ≈ 326px；
       「壁纸配置」栏在窄视口/移动端只有 ~240–300px（`--mpw-props-w` 默认 320px，窄档更小）⇒ 音量条被挤出容器右缘。
       改后：整条 `overflow:hidden` + 可压项 `min-width:0`，**滑条**改成可伸缩（`flex:1 1 48px;width:auto` ——
       `input[type=range]` 固有宽度 129px，必须显式压掉），进度条/曲目名让位 ⇒ 任何宽度下滑条都在容器内。
       读数（改前/改后）由 `__benchPatch.npGeometry()` 给出：`slider.right <= strip.right`。 */
    '#np-seek{position:relative;flex:2 1 32px;min-width:24px;height:14px;padding:0;border:0;background:transparent;cursor:pointer}',
    '#np-seek::before{content:"";position:absolute;left:0;right:0;top:6px;height:3px;border-radius:2px;background:var(--input)}',
    '#np-run{position:absolute;left:0;top:6px;height:3px;width:0;border-radius:2px;background:var(--accent,#0078d4)}',
    '#np-time{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--fg-mute)}',
    '#np-stage{flex:0 1 auto;min-width:0;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--fg-mute)}',
    /* 更窄的档位：连时间/曲目名都放不下时只留「静音 + 音量 + 进度」，一个像素都不越界 */
    '@media (max-width:420px){#np-time,#np-stage{display:none}}',
    /* ── ①A1(2026-09-24 用户「WE 渲染器自带的几个设置永远在壁纸配置最上面 ⇒ 做成可折叠」) ──────────
       壁纸自己的 `project.json` 可调项每张都不一样，而 WE 渲染器自带的几项（`schemecolor`，见
       `WE_BUILTIN_PROP_RE`）在任何壁纸上都在 ⇒ 堆在最上面把作者选项压下去。补丁把它们收进一个
       `.bench-props-group`（标题行可点，折叠状态记 localStorage），并**排在作者项之前**。 */
    '.bench-props-group{margin:0 0 8px;border:1px solid var(--border);border-radius:6px;overflow:hidden}',
    '.bench-props-group > .bench-props-group-head{display:flex;align-items:center;gap:6px;padding:5px 8px;cursor:pointer;background:color-mix(in srgb,var(--panel) 70%,transparent);font-size:12px;color:var(--fg-dim);user-select:none}',
    '.bench-props-group > .bench-props-group-head:hover{background:var(--hover,rgba(255,255,255,.06))}',
    '.bench-props-group > .bench-props-group-head .bench-props-group-caret{flex:none;transition:transform .12s linear}',
    '.bench-props-group[data-collapsed="1"] > .bench-props-group-head .bench-props-group-caret{transform:rotate(-90deg)}',
    '.bench-props-group[data-collapsed="1"] > .bench-props-group-body{display:none}',
    '.bench-props-group > .bench-props-group-body{padding:2px 6px 4px}',
    '.bench-props-group .prop,.bench-props-group .prop-text{margin-top:2px}',
    /* ①B(P-201 2026-09-25 用户「WE 自带选项只显示有一项，而且展不开」) 这一组现在是补丁**自己画的
       固定清单**（`WE_RENDERER_ITEMS`）：每行 = `[data-we-item]`（`bool` = 勾选框 / `range` = 滑条 + 数值 /
       `note` = 只读的"WE 自带 / 未实现"说明）。行**两段式**（第二段是 API 落点或原因）⇒ 窄面板下不挤：
       第一段 label 可省略号收缩，第二段整体换行。控件只用 `checkbox`/`range`（面板里不许有裸 `<select>`）。 */
    '.bench-we-group > .bench-props-group-body{padding:4px 8px 6px}',
    '.bench-we-row{display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px;padding:3px 0;font-size:12.5px;color:var(--fg);min-width:0}',
    '.bench-we-status{margin:0 0 4px;padding:4px 6px;border:1px solid var(--border);border-radius:4px;color:var(--fg-mute);font-size:11.5px;line-height:1.6;background:color-mix(in srgb,var(--panel) 60%,transparent)}',
    '.bench-we-row > .bench-we-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.bench-we-row > .bench-we-ctl{flex:none;display:flex;align-items:center;gap:6px;min-width:0}',
    '.bench-we-row > .bench-we-ctl input[type="range"]{width:104px;min-width:0;max-width:100%}',
    '.bench-we-row > .bench-we-ctl input[type="checkbox"]{margin:0}',
    '.bench-we-row > .bench-we-val{flex:none;min-width:36px;text-align:right;font-variant-numeric:tabular-nums;color:var(--fg-dim)}',
    '.bench-we-row > .bench-we-api{flex:1 1 100%;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--mono,ui-monospace,SFMono-Regular,monospace);font-size:10.5px;color:var(--fg-mute)}',
    '.bench-we-row > .bench-we-why{flex:1 1 100%;min-width:0;color:var(--fg-mute);font-size:11.5px;line-height:1.6}',
    '.bench-we-row > .bench-we-tag{flex:none;padding:1px 6px;border:1px solid var(--border);border-radius:999px;font-size:10.5px;color:var(--fg-dim)}',
    '.bench-we-row[data-we-avail="0"] > .bench-we-ctl{opacity:.55}',
    '.bench-we-row[data-we-avail="0"] > .bench-we-val{opacity:.55}',
    '.bench-we-hint{margin-top:4px;padding-top:4px;border-top:1px dashed var(--border);color:var(--fg-mute);font-size:11.5px;line-height:1.6}',
    '#props[hidden]{display:flex!important}',
    /* ⑫a(2026-09-19 用户要求)「壁纸配置」要能收起。上面那条 `[hidden]{display:flex!important}`（为 docs 视图
       上的锁）+ `paintPropsEmpty()` 见到 hidden 就摘掉 ⇒ 产物 `#props-close.onclick = ue(!1)` 点了没效果。
       收起状态改用**我们自己的类**：规则排在 `#props[hidden]` 之后、与它**同特异度**（1 个 id + 2 个 class
       + 1 个元素）⇒ 源序后者胜；`!important` 同时压掉产物 CSS 里的 `[hidden]{display:none!important}`。 */
    '#props.bench-props-collapsed{display:none!important}',
    '.props-empty{padding:14px 12px;color:var(--fg-mute);font-size:12.5px;line-height:1.75}',
    '.props-empty strong{display:block;color:var(--fg-dim);margin-bottom:4px}',
    '#toolbar{max-height:30vh;overflow-y:auto;flex-wrap:wrap;max-width:100%;overflow-x:hidden}',
    /* ⑩(2026-09-21 台账 §5.3) 「音条源」状态行（静态表里那条的镜像，同文；见 demo/index.html 的同名规则）：
       诚实原因是一整句 ⇒ 换行而不是截断（截断会把"可切麦克风/模拟"这条出路吃掉）。 */
    '#status-bandfeed{flex:0 1 auto;min-width:0;max-width:100%;color:var(--fg-dim);font-size:12px;line-height:1.35;overflow-wrap:anywhere}',
    /* ⑬(2026-09-19 用户要求) 下拉浮层浮在页面上层：`position:fixed` 让它脱离 `#toolbar` / `#main` /
       `#props-body` 的 overflow 裁剪（这些祖先都没有 transform/contain ⇒ 不是固定定位的包含块），
       坐标由 `dropdownLayerPlan()` 在展开时写内联 left/top/min-width/max-height。
       `min-width:0` 必需：产物那条 `min-width:100%` 在 fixed 下会对齐**视口宽**。 */
    '.bench-rd-list{position:fixed;z-index:70;top:auto;left:auto;min-width:0;max-height:min(280px,42vh);overflow-y:auto}',
    '#main{grid-column:3;grid-template-columns:minmax(0,1fr)!important;grid-template-rows:auto minmax(140px,1fr) 6px minmax(60px,var(--mpw-logs-h,220px))!important}',
    '#main.logs-collapsed{grid-template-rows:auto minmax(0,1fr) 6px 34px!important}',
    /* ⑥(P-158) 收起态也保留「清空」：产物的 `#main.logs-collapsed #clear-logs{display:none}` 被这条压回来 */
    '#main.logs-collapsed #clear-logs{display:inline-flex!important}',
    '#editor-chrome{grid-row:1}',
    '#workspace{grid-row:2}',
    '#main > #logs-splitter{grid-row:3;cursor:row-resize;background:var(--border);opacity:.55}',
    '#logs-splitter:hover,#logs-splitter.dragging{background:var(--accent,#0078d4);opacity:1}',
    '#main > #logs{grid-row:4}',
    /* ④ 壁纸切换栏（设置1 上方） */
    '#wp-switch{display:flex;align-items:stretch;background:var(--sidebar);border-bottom:1px solid var(--border)}',
    '#editor-tabs{flex:1;min-width:0;overflow-x:auto;overflow-y:hidden;height:32px;border-bottom:0;scrollbar-width:thin}',
    '#editor-tabs .tab{height:32px;font-size:12.5px}',
    '.wp-tab{max-width:200px;display:flex;align-items:center;gap:6px;padding:0 10px;font:inherit;font-size:12.5px;color:var(--fg-dim);background:transparent;border:0;border-right:1px solid var(--border);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer}',
    '.wp-tab:hover{background:var(--hover,rgba(255,255,255,.07));color:var(--fg)}',
    '.wp-tab.active{background:var(--editor);color:var(--fg);box-shadow:inset 0 -2px 0 var(--accent,#0078d4)}',
    '.wp-tab.wp-cur{opacity:.45}',
    '#wp-add{flex:none;width:34px;border:0;border-left:1px solid var(--border);background:transparent;color:var(--fg-dim);font-size:16px;line-height:1;cursor:pointer}',
    '#wp-add:hover{background:var(--accent,#0078d4);color:#fff}',
    /* ⑦ 输出按钮：折叠态给文字标签，箭头朝上（展开）/朝下（收起） */
    '#toggle-logs{gap:4px;width:auto!important;padding:0 6px!important}',
    '#logs.bench-logs-collapsed-tag #toggle-logs::after{content:attr(data-tag);font-size:11px;color:var(--fg-dim)}',
    /* ── P-158：切换栏 / 库列表面板 / 类型开关 / 库来源 / 输出页签 / 诊断视图（与静态表逐条同文） ── */
    '与 demo/bench-patch.js 的 SITE_LAYOUT_CSS 逐条等价（tests/demo-check.mjs D8 会逐条比对）。 */',
    '#editor-tabs .tab{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.wp-tab{padding:0 4px 0 10px}',
    '.wp-tab .wp-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.wp-x{flex:none;width:22px;min-width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:4px;background:transparent;color:var(--fg-dim);font-size:14px;line-height:1;cursor:pointer}',
    '.wp-x:hover{background:var(--accent,#0078d4);color:#fff}',
    /* ①(2026-09-22 用户第 20 条) **当前那张**的 `×` 曾被拉成整条（`align-self:stretch;height:auto;border-radius:0`）
       —— 用户看到的就是"第一个壁纸的叉号是长条、后面的是方框"。现在与其它 `×` **同形**（22×22、圆角 4）。 */
    '.wp-x-cur{align-self:center;height:22px;min-height:22px;border-radius:4px}',
    '.wp-x-cur:hover{background:var(--accent,#0078d4);color:#fff}',
    /* ⑦(2026-10-12 用户 :8902 实测第 4 条) 第 1 位标签的 `×` 落在 `#current` 的框**之外**（它是兄弟节点
       ⇒ flex 条上的独立一项）、且与第 2 个标签零间距贴死 ⇒ "叉号超出自己的框 / 大框串到第 2 个壁纸里"。
       宿主格预留宽度（`#current.wp-cur-has-x`，由 refreshSwitcher 与 `×` **同生共死**地加/摘）+ 负左
       外边距把 `×` 挪回框内 + 正右外边距把外边距盒补回 0（`-26+22+4=0`）⇒ 第 2 个标签从 `#current`
       的右缘开始、不重叠不多留空隙；`-26/4` 是**逐像素镜像** `.wp-tab{gap:6px;padding:0 4px 0 10px}`
       （标题↔`×` 6px、`×` 右缘距格子右边 4px）。宿主态还要把产物的 `display:flex` 改成 `block`：
       `#current` 的标题是**裸文本** ⇒ flex 容器会把它变成匿名 flex item，`text-overflow:ellipsis`
       管不到它（真页面实测：长标题布局右缘 796 会画到 `×` 盒 [774,796] 底下）⇒ 改块容器后省略号才真生效。
       实测读数与完整推导见 demo/index.html 同一对规则上方的注释（静态表与 SITE_LAYOUT_CSS 同文，D8 守）。 */
    '#editor-tabs #current.wp-cur-has-x{display:block;line-height:32px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:32px}',
    '.wp-x-cur{margin-left:-26px;margin-right:4px}',
    /* ①(2026-09-22 用户第 10 条) 属性面板里的**滑动条**此前没有样式（还是产物默认外观）：
       轨道 4px 圆角 + 14px 圆形滑块 + accent 色；`appearance:none` 才能同时管住 WebKit 与 Firefox 的默认皮肤。
       同文镜像在 demo/index.html 的 SITE_LAYOUT_CSS（`demo-check` D8 逐条比对会看住两处一致）。 */
    '#props-body input[type=range],#props input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:4px;border-radius:999px;background:var(--border);outline:none;cursor:pointer}',
    '#props-body input[type=range]::-webkit-slider-thumb,#props input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:14px;height:14px;border:0;border-radius:50%;background:var(--accent,#0078d4);cursor:pointer}',
    '#props-body input[type=range]::-moz-range-thumb,#props input[type=range]::-moz-range-thumb{width:14px;height:14px;border:0;border-radius:50%;background:var(--accent,#0078d4);cursor:pointer}',
    '#debug-body{display:none}',
    '#logs[data-view="debug"] #debug-body{display:flex;flex-direction:column;flex:1;min-height:0;overflow:auto}',
    '#logs[data-view="debug"] #logbody{display:none}',
    '#logs[data-view="debug"] #diag-body{display:none}',
    '.dbg-actions{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--border);flex-wrap:wrap}',
    '.dbg-actions button{appearance:none;font:inherit;font-size:12px;color:var(--fg);background:var(--input);border:1px solid var(--border);border-radius:6px;padding:3px 10px;cursor:pointer}',
    '.dbg-actions button:hover{background:var(--accent,#0078d4);border-color:var(--accent,#0078d4);color:#fff}',
    '.dbg-state{color:var(--fg-mute);font-size:11.5px}',
    '.dbg-layer{padding:6px 10px;font:11.5px/1.6 ui-monospace,Menlo,Consolas,monospace;color:var(--fg);border-bottom:1px solid var(--border);white-space:pre-wrap;overflow-wrap:anywhere}',
    '.dbg-log{flex:1;min-height:0;margin:0;padding:6px 10px;overflow:auto;font:11.5px/1.55 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere}',
    '.dbg-log .dbg-err{color:#f85149}',
    /* ②(2026-09-20 用户第 3 条) 调试模式开关搬进页签内部后的那一行（页签只切视图，开关只在这里）。 */
    '.dbg-mode-row{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--border)}',
    /* ⑦(用户第 7 条) 滚动条：**定义只有一处**（`--bench-sb-*` 变量在静态表的 `html.bench-shell` 上），
       **引用两处**（资源管理器列表 / 输出区）共用这一份选择器清单 —— 下面每条都与
       `<style id="bench-shell-static">` 里那一行逐字同文（tests/demo-check.mjs D8 逐条比对）。 */
    /* ②(P-166 第 23 条) 输出区行首**永远可见**：`#logbody` 是产物的 `<pre>`（默认 `white-space:pre`）⇒
       一行比容器宽就长出横向滚动区，行首那段时间只能靠横滚才看得见（用户报的"时间被切"）。
       台账症状「清空/重挂载后又好了」也吻合：内容一换短，`scrollWidth` 缩回、横滚归零。
       这里把折行变成**结构保证**，而不是靠"没人去设 scrollLeft"的巧合。 */
    '#logbody{white-space:pre-wrap;overflow-wrap:anywhere}',
    '#list, .bench-dirbox-list, #logbody, #diag-body, .dbg-log{scrollbar-width:thin;scrollbar-color:var(--bench-sb-thumb) var(--bench-sb-track)}',
    '#list::-webkit-scrollbar, .bench-dirbox-list::-webkit-scrollbar, #logbody::-webkit-scrollbar, #diag-body::-webkit-scrollbar, .dbg-log::-webkit-scrollbar{width:var(--bench-sb-size);height:var(--bench-sb-size)}',
    '#list::-webkit-scrollbar-track, .bench-dirbox-list::-webkit-scrollbar-track, #logbody::-webkit-scrollbar-track, #diag-body::-webkit-scrollbar-track, .dbg-log::-webkit-scrollbar-track{background:var(--bench-sb-track)}',
    '#list::-webkit-scrollbar-thumb, .bench-dirbox-list::-webkit-scrollbar-thumb, #logbody::-webkit-scrollbar-thumb, #diag-body::-webkit-scrollbar-thumb, .dbg-log::-webkit-scrollbar-thumb{background:var(--bench-sb-thumb);border-radius:999px}',
    '#list::-webkit-scrollbar-thumb:hover, .bench-dirbox-list::-webkit-scrollbar-thumb:hover, #logbody::-webkit-scrollbar-thumb:hover, #diag-body::-webkit-scrollbar-thumb:hover, .dbg-log::-webkit-scrollbar-thumb:hover{background:var(--bench-sb-thumb-hover)}',
    '#list::-webkit-scrollbar-button, .bench-dirbox-list::-webkit-scrollbar-button, #logbody::-webkit-scrollbar-button, #diag-body::-webkit-scrollbar-button, .dbg-log::-webkit-scrollbar-button{display:none;width:0;height:0}',
    '#list::-webkit-scrollbar-corner, .bench-dirbox-list::-webkit-scrollbar-corner, #logbody::-webkit-scrollbar-corner, #diag-body::-webkit-scrollbar-corner, .dbg-log::-webkit-scrollbar-corner{background:transparent}',
    /* ⑨(用户第 10 条) 输入框：平时灰边、聚焦黑边（暗色模式聚焦白边）—— 颜色变量在静态表里一处定义。 */
    'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]), textarea{border:1px solid var(--bench-input-border)!important}',
    'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]):not([type="file"]):focus, textarea:focus{outline:none;border-color:var(--bench-input-focus)!important}',
    '/*  —— 本轮（用户第 14/18/23/25/26/27/28/30/34 条）——*/',
    /* ①(本轮 #14) 行布局：标题一行、ID 自己一行（等宽 + 单行省略号 + `title` 给完整值）——
   产物把 `类型 · N 属性 · itemId` 塞进同一行 `.sub`（nowrap）⇒ 属性一多 ID 就被省略号吃掉。 */
    '#list .meta{min-width:0}',
    '#list .sub .bench-row-id{display:block;max-width:100%;font-family:var(--mono);font-size:10.5px;color:var(--fg-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#list li.active .sub .bench-row-id{color:#b4d0e8}',
    '#list .sub .bench-row-kind{display:block;overflow:hidden;text-overflow:ellipsis}',
    '.bench-prop-note{padding:2px 0 0;color:var(--fg-mute);font-size:11px;line-height:1.5}',
    '.bench-prop-imgwrap{display:block;margin:4px 0}',
    '.bench-prop-img{display:block;max-width:100%;height:auto;border-radius:2px}',
    '.bench-prop-link{color:var(--link);text-decoration:underline;cursor:pointer}',
    '.bench-num-err{margin-top:4px;color:var(--danger);font-size:11px;line-height:1.5}',
    '.bench-props-hidden-note{font-size:11px;line-height:1.6}',
    /* ①(本轮 #30) 外链二次确认：弹层里写明域名、只放行 http(s)、确认按钮 3 秒倒计时后才可点。 */
    '.bench-ext{position:fixed;inset:0;z-index:1200;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.5)}',
    '.bench-ext-box{width:min(520px,92vw);padding:16px 18px;border:1px solid var(--widget-border);border-radius:8px;background:var(--panel);color:var(--fg);box-shadow:var(--shadow)}',
    '.bench-ext-title{font-size:14px;font-weight:600;margin-bottom:6px}',
    '.bench-ext-host{font-size:13px;color:var(--fg);word-break:break-all}',
    '.bench-ext-url{display:block;margin:6px 0;padding:6px 8px;border:1px solid var(--border);border-radius:4px;background:var(--input);color:var(--fg-dim);font:11px/1.5 var(--mono);word-break:break-all}',
    '.bench-ext-warn{margin:6px 0 12px;color:var(--fg-mute);font-size:12px;line-height:1.6}',
    '.bench-ext-row{display:flex;justify-content:flex-end;gap:8px}',
    '.bench-ext-row button{height:26px;padding:0 12px;border:1px solid var(--widget-border);border-radius:4px;background:var(--input);color:var(--fg);cursor:pointer}',
    '.bench-ext-open:not(:disabled){background:var(--accent,#0078d4);border-color:var(--accent,#0078d4);color:#fff}',
    '.bench-ext-open:disabled{opacity:.55;cursor:default}',
    'select.bench-rd-native{display:none!important}',
    '#wp-switch{position:relative}',
    '#wp-add{flex:none;width:34px;min-width:34px;height:auto;border:0;border-left:1px solid var(--border);background:transparent;color:var(--fg-dim);font-size:16px;line-height:1;cursor:pointer}',
    '#wp-add[aria-expanded="true"]{background:var(--accent,#0078d4);color:#fff}',
    '#wp-panel{position:absolute;left:0;top:100%;z-index:60;width:min(560px,100%);max-height:min(62vh,460px);overflow:auto;background:var(--panel);border:1px solid var(--border);border-radius:0 0 8px 8px;box-shadow:0 14px 40px rgba(0,0,0,.38);padding:8px}',
    '#wp-panel[hidden]{display:none!important}',
    '.wp-panel-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:2px 4px 6px}',
    '#wp-panel-head{padding:0 6px 8px;color:var(--fg-mute);font-size:11.5px}',
    '.wp-seg{display:inline-flex;align-items:center;border:1px solid var(--border);border-radius:6px;overflow:hidden}',
    '.wp-seg .seg-btn{appearance:none;font:inherit;font-size:12px;color:var(--fg-dim);background:transparent;border:0;padding:3px 10px;cursor:pointer}',
    '.wp-seg .seg-btn + .seg-btn{border-left:1px solid var(--border)}',
    '.wp-seg .seg-btn.active{background:var(--accent,#0078d4);color:#fff}',
    '.wp-row{display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--border)}',
    '.wp-row-go{flex:1;min-width:0;display:flex;align-items:center;gap:8px;min-height:32px;padding:4px 8px;border:0;background:transparent;color:var(--fg);font:inherit;font-size:12.5px;text-align:left;cursor:pointer}',
    '.wp-row-go:hover{background:var(--hover,rgba(255,255,255,.07))}',
    '.wp-row .wp-kind{flex:none;font-size:11px;padding:1px 6px;border:1px solid var(--border);border-radius:999px;color:var(--fg-mute)}',
    '.wp-row .wp-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.wp-row .wp-pin{flex:none;width:32px;min-height:32px;border:0;background:transparent;color:var(--fg-mute);font-size:14px;cursor:pointer}',
    '.wp-row .wp-pin.on{color:#e3b341}',
    '.bench-kind{display:inline-block;margin-left:6px;padding:0 5px;border:1px solid var(--border);border-radius:999px;font-size:10px;color:var(--fg-mute)}',
    '.bench-status-kind{margin-left:6px;padding:0 5px;border:1px solid var(--border);border-radius:999px;font-size:10px;color:var(--fg-mute)}',
    '#lib-source{display:block;padding:2px 10px 6px;color:var(--fg-mute);font-size:11.5px;line-height:1.5;word-break:break-all}',
    '#lib-source[data-kind="default"]{color:#d29922}',
    '#logs .logs-tab{appearance:none;font:inherit;font-size:12.5px;color:var(--fg-dim);background:transparent;border:0;border-radius:4px;padding:0 8px;height:24px;cursor:pointer}',
    '#logs .logs-tab.active[aria-selected="true"]{box-shadow:inset 0 0 0 1px var(--border)}',
    '#logs .logs-tab[aria-selected="true"]{color:var(--fg);background:color-mix(in srgb,var(--fg) 14%,transparent)}',
    /* ⑧(2026-09-24 用户第 8 条) 调试页签文案随勾选态 `调试模式·ON / OFF`：ON 正常绿、OFF 正常红（不刺眼）。
       特异性 211 > 上面那条 111 ⇒ 选中（灰底）时颜色仍是绿/红，字也照样看得清。 */
    '#logs #tab-debug[data-dbg="on"]{color:var(--bench-dbg-on,#3fb950)}',
    '#logs #tab-debug[data-dbg="off"]{color:var(--bench-dbg-off,#e5534b)}',
    /* ⑨(2026-09-24 用户第 9 条「输出面板里的字是淡灰色看不清」)：产物 CSS 把 `#logbody` 的颜色写死成
       `#ccc` —— 暗色主题下勉强能看，**浅色主题**（`--panel:#f3f3f3`）下几乎看不见。诊断栏 `#diag-body`
       一直是继承 `var(--fg)` ⇒ 这里把输出区对齐到同一条可读配色（`.err` 仍是 `--danger`，见产物那条 110 特异性规则）。 */
    '#logbody{color:var(--fg)}',
    '#diag-body{display:none;margin:0;padding:6px 10px;font:11.5px/1.55 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;overflow:auto}',
    '#logs[data-view="diag"] #diag-body{display:block;flex:1;min-height:0}',
    '#logs[data-view="diag"] #logbody{display:none}',
    '#main.logs-collapsed #diag-body{display:none!important}',
    '#diag-body .diag-line.err{color:#f85149}',
    '#diag-body .diag-line[data-source="renderer"]{color:var(--fg-dim)}',
    /* ⑧ 全屏按钮在浅色主题下也必须看得见（原先只定义了 :hover，浅色下是黑底黑字） */
    '.stage-tools button{color:var(--fg)!important;background:color-mix(in srgb,var(--panel) 86%,transparent);border:1px solid var(--border);border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer}',
    '.stage-tools button:hover{background:var(--accent,#0078d4)!important;border-color:var(--accent,#0078d4);color:#fff!important}',
    /* 文档页排版（说明 / 壁纸设置） */
    '.doc-wrap{max-width:1020px;margin:0 auto;padding:22px 28px 64px;font-size:13.5px;line-height:1.75;color:var(--fg)}',
    '.doc-wrap h1{font-size:20px;margin:6px 0 10px}',
    '.doc-wrap h2{font-size:14.5px;margin:22px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--border)}',
    '.doc-lede{color:var(--fg-dim);font-size:13px}',
    '.doc-wrap table{width:100%;border-collapse:collapse;font-size:12.5px;margin:8px 0 4px}',
    '.doc-wrap th,.doc-wrap td{text-align:left;vertical-align:top;padding:6px 9px;border-bottom:1px solid var(--border)}',
    '.doc-wrap th{color:var(--fg-mute);font-weight:500}',
    '.doc-wrap code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;background:color-mix(in srgb,var(--fg) 10%,transparent);border-radius:4px;padding:1px 5px}',
    '.doc-wrap pre{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:10px 12px;overflow:auto}',
    '.doc-wrap pre code{background:none;padding:0}',
    '.doc-wrap ul,.doc-wrap ol{padding-left:22px}',
    '.doc-note{color:var(--fg-mute);font-size:12.5px}',
    '.tag{display:inline-block;font-size:11px;padding:1px 6px;border-radius:999px;border:1px solid var(--border);white-space:nowrap}',
    '.tag-ok{color:#3fb950;border-color:rgba(63,185,80,.45);background:rgba(63,185,80,.12)}',
    '.tag-todo{color:#d29922;border-color:rgba(210,153,34,.45);background:rgba(210,153,34,.12)}',
    '.tag-we{color:var(--fg-dim)}',
    /* ①(修正 2026-09-18 真机"一帧正确然后跳 README") 产物把"活动视图"持久化在 localStorage['we-bench-view']，
       启动时 `O(存的值 === 'explorer' ? 'explorer' : 'docs')` —— **任何非 'explorer' 的值都落到 docs**，
       而它切换视图时会 `#sidebar/#logs/#editor-chrome/#stage-slot.hidden = true; #docs-view.hidden = false`。
       补丁的外壳初始化早于它那条异步恢复 ⇒ 用户看到"一帧控制台、随后跳 README"。这里用 CSS 把状态钉死：
       docs 视图永不显示，那 5 个常驻区即使被加 hidden 也照旧显示（不依赖任何竞态）。 */
    '#docs-view{display:none!important}',
    '#sidebar[hidden]{display:flex!important}',
    '#logs[hidden]{display:flex!important}',
    '#editor-chrome[hidden]{display:block!important}',
    '#stage-slot[hidden]{display:flex!important}',
    'html[lang="en"] .lang-zh{display:none}',
    /* ⑪(2026-09-24 用户第 11 条「说明 与 壁纸设置 里中英同时显示」)：改前这条是
       `html:not([lang="en"]) .lang-en{display:none}` —— 经 D8 的自动加前缀后变成
       `html.bench-shell html:not([lang="en"]) .lang-en`，**`html` 不可能是自己的后代** ⇒ 死规则 ⇒
       中文档下 `.lang-en` 整块照常显示（中英堆在一起）。现在写成 `html[lang]:not([lang="en"])`
       （以 `html[` 开头 ⇒ D8 不会再加前缀；页面**始终**带 `lang`：静态 `lang="zh-CN"`，产物切语言时写 `zh-CN`/`en`）。 */
    'html[lang]:not([lang="en"]) .lang-en{display:none}',
    '@media (prefers-reduced-motion: reduce){#pages-track,#site-tab-ink{transition:none!important}}',   // 现在本来就无动画；保留只为兼容旧文档/旧断言
  ].join('')
  function injectSiteLayoutStyle() {
    try {
      if (!doc.head || $('#bench-site-style')) return false
      const st = doc.createElement('style')
      st.id = 'bench-site-style'
      // ①(修正 2026-09-18) **不再在这里注入布局规则**：运行期注入的表在 `<style id="bench-shell-static">`（index.html）
      //   **之后**，同为 `!important` 时后者胜 ⇒ 会把静态表里的窄屏 @media 覆盖掉（真机：手机视口下舞台仍爆到 1683px）。
      //   现在静态表是唯一权威（首屏即生效、含窄屏自适应）；这里只留一个标记元素 + 说明，便于测试与排障。
      //   上面那份 SITE_LAYOUT_CSS 数组保留，作为"静态表必须覆盖这些规则"的对照（tests/demo-check.mjs 的 D8 逐条比对）。
      st.textContent = '/* bench-site-style: layout rules live in <style id="bench-shell-static"> (index.html) */'
      doc.head.appendChild(st)
      return true
    } catch { return false }
  }
  // `?shell=off` = 新样式总回退：既不注入站点外壳 CSS、也不初始化外壳（旧行为，一行 URL 复原）
  const SHELL_OFF = (() => { try { return /[?&]shell=(off|0|false|no)\b/.test(String((typeof location !== 'undefined' && location.search) || '')) } catch { return false } })()
  // ①(修正 2026-09-18 第二起真机事故) 浏览器**缓存里的旧 HTML** + 新补丁：旧 DOM 没有 #pages-track，
  //   而补丁的站点布局 CSS 只管新结构 ⇒ 套在旧 DOM 上就是"控制台缩到左上角、右边闪出 README"。
  //   这里先认 DOM 版本：不是新 DOM 就**不注入**布局 CSS，并用带 cache-buster 的规范 URL 重新取一次文档
  //   （URL 变了 ⇒ 浏览器必须走网络，绕开启发式缓存与 SW 缓存；sessionStorage 守卫只重取一次，不打转）。
  /** 当前文档是否是「新样式外壳」的 DOM（静态 CSS + #pages-track）。 */
  const shellDomIsNew = (doc0) => !!(doc0 && doc0.querySelector && doc0.querySelector('#pages-track'))
  const DOM_IS_NEW = shellDomIsNew(typeof document !== 'undefined' ? document : null)
  if (!SHELL_OFF && !DOM_IS_NEW && typeof location !== 'undefined') {
    try {
      const GUARD = 'bench-stale-html-renew'
      if (!sessionStorage.getItem(GUARD)) {
        sessionStorage.setItem(GUARD, '1')
        const u = new URL(location.href)
        u.searchParams.set('benchrenew', String(Date.now()))
        location.replace(u.href)
      }
    } catch { /* 无 storage/无 URL：静默降级（至少不注入不匹配的布局 CSS） */ }
  }
  const SITE_STYLE_INJECTED = (SHELL_OFF || !DOM_IS_NEW) ? false : injectSiteLayoutStyle()
  // ①(2026-09-18) 版本标记：把"当前页面到底是哪一版"变成可核对的事实（控制台/属性/状态栏都能看）——
  //   用户报"还是不行"时，第一件事就是核对它（旧缓存会让 `window.__benchShellVersion` 整个不存在）。
  const BENCH_SHELL_VERSION = 'bench-shell 2026-09-18a (static first-paint CSS; dom=' + (DOM_IS_NEW ? 'new' : 'old') + (SHELL_OFF ? '; shell=off' : '') + ')'
  try {
    if (typeof window !== 'undefined') {
      window.__benchShellVersion = BENCH_SHELL_VERSION
      if (document && document.documentElement) document.documentElement.setAttribute('data-bench-shell-version', BENCH_SHELL_VERSION)
    }
  } catch { /* 桩 DOM */ }

  // 图标：Lucide v0.545.0（ISC，© Lucide Contributors / Feather 部分 MIT）——
  //   用户给的 docs/SVG-ICONS.md 里已有 arrow-up / search，其余按同风格取 Lucide 同名条目；
  //   许可与出处逐条记在 we-scene-demo/docs/ICONS-NEEDED.md 与 docs/COPYING-RULES.md §4。
  const DIR_ICONS = {
    folder: ['M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'],
    file: ['M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z', 'M14 2v4a2 2 0 0 0 2 2h4'],
    house: ['M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8', 'M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
    up: ['m5 12 7-7 7 7', 'M12 19V5'],
    search: ['m21 21-4.34-4.34', 'c:11:11:8'],
    check: ['M20 6 9 17l-5-5'],
    x: ['M18 6 6 18', 'm6 6 12 12'],
  }
  const DIR_SVG_NS = 'http://www.w3.org/2000/svg'
  const dirIcon = (name, size) => {
    const spec = DIR_ICONS[name]
    if (!spec) return null
    let svg = null
    try { svg = doc.createElementNS(DIR_SVG_NS, 'svg') } catch { svg = null }
    if (!svg) { try { svg = doc.createElement('svg') } catch { return null } }
    if (!svg.setAttribute) return null
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', String(size || 13)); svg.setAttribute('height', String(size || 13))
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2')
    svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true')
    for (const d of spec) {
      let node = null
      if (d.indexOf('c:') === 0) {
        const p = d.split(':')
        try { node = doc.createElementNS(DIR_SVG_NS, 'circle') } catch { node = doc.createElement('circle') }
        if (node && node.setAttribute) { node.setAttribute('cx', p[1]); node.setAttribute('cy', p[2]); node.setAttribute('r', p[3]) }
      } else {
        try { node = doc.createElementNS(DIR_SVG_NS, 'path') } catch { node = doc.createElement('path') }
        if (node && node.setAttribute) node.setAttribute('d', d)
      }
      if (node && svg.appendChild) svg.appendChild(node)
    }
    return svg
  }
  const dirMk = (tag, cls, text) => {
    const el = doc.createElement(tag)
    if (cls) el.className = cls
    if (text != null) el.textContent = String(text)
    return el
  }
  const dirBtn = (cls, label, title, iconName) => {
    const b = dirMk('button', cls)
    b.type = 'button'
    const ic = iconName ? dirIcon(iconName, 12) : null
    if (ic) b.appendChild(ic)
    if (label != null && label !== '') b.appendChild(dirMk('span', '', label))
    if (title) b.setAttribute('title', title)
    return b
  }

  // ── ② README 面板：#main 的轨道决策（纯函数 mainViewPlan）+ 观察者（视图切回来也能收回死区）──
  const mainEl = $('#main')
  const dirShown = (el) => {
    if (!el) return false
    if (el.hidden === true) return false
    try { if (el.style && el.style.display === 'none') return false } catch { /* 无 style（极简假 DOM） */ }
    try {
      if (typeof getComputedStyle === 'function') {
        const cs = getComputedStyle(el)
        if (cs && cs.display === 'none') return false
      }
    } catch { /* 假 DOM 没有 getComputedStyle ⇒ 只看 hidden */ }
    return true
  }
  // ①(修正 2026-09-17，真机事故) 这里曾经**自激成死循环**：观察者同时盯 `#main`（写入目标）
  //   与它的输入节点，`paintMainView()` 又去 add/remove `#main` 的 class ⇒ 每次写入都重新触发自己；
  //   当 docsOnly 判定在两次调用间来回翻转时（新布局里 `#main` 有 4 个子元素、0px 轨道映射不同），
  //   循环以微任务速度跑满主线程 ⇒ **页面 load 永不完成**（无头探针 45s 超时、真机浏览器卡死）。
  //   instrument 证据：MutationObserver on DIV#main.bench-view-docs attr=class 被调用 10000+ 次/6s。
  //   修法两条：①写入幂等（状态没变就不碰 DOM）②**不观察写入目标本身**，只看输入节点。
  const MAIN_VIEW_ON = !SHELL_OFF   // 新样式（站点外壳）下 #main 的轨道由 SITE_LAYOUT_CSS 钉死，本机制整体让位
  function paintMainView() {
    if (!mainEl) return null
    const plan = mainViewPlan({ chromeVisible: dirShown($('#editor-chrome')), logsVisible: dirShown($('#logs')) })
    if (MAIN_VIEW_ON) return plan   // 外壳模式下不改 class（避免与外壳布局互相触发）
    try {
      const on = mainEl.classList.contains('bench-view-docs')
      if (plan.docsOnly !== on) mainEl.classList.toggle('bench-view-docs', plan.docsOnly)
    } catch { /* 无 classList */ }
    return plan
  }
  let mainViewPlanNow = paintMainView()
  if (!MAIN_VIEW_ON && mainEl && typeof MutationObserver === 'function') {
    try {
      const mo = new MutationObserver(() => { mainViewPlanNow = paintMainView() })
      for (const sel of ['#editor-chrome', '#workspace', '#logs']) {   // ← 不含 #main（写入目标，自激源）
        const el = $(sel)
        if (el) mo.observe(el, { attributes: true, attributeFilter: ['hidden', 'class', 'style'] })
      }
    } catch { /* 观察者挂了也不影响功能（下次语言同步还会重算） */ }
  }

  // ── ① 授权树（选择器的数据源）──
  let pickIndex = null
  let pickGrantFrom = ''
  function grantPickerIndex(entries, opt) {
    const o = opt || {}
    const index = buildPickerIndex(entries || [], o)
    if (!index.root) { logLine(t(curLang, 'local.notDir'), true); return null }
    pickIndex = index
    pickGrantFrom = String(o.from || 'system-picker')
    logLine(t(curLang, 'pick.granted', { n: index.files.length, d: index.dirs.length, name: index.root }))
    return index
  }
  const dirFileOf = async (entry) => {
    if (!entry) return null
    if (entry.file) return entry.file
    if (typeof entry.getFile === 'function') { try { return await entry.getFile() } catch { return null } }
    return null
  }
  /** 授权树里 cwd 子树下的全部文件（惰性 getFile 的也要取回：扫描要读 project.json 文本） */
  async function dirEntriesUnder(cwd) {
    if (!pickIndex) return []
    const out = []
    for (const f of pickIndex.files) {
      if (f.dir !== cwd && f.dir.indexOf(cwd + '/') !== 0) continue
      const file = await dirFileOf(f)
      if (file) out.push({ path: f.path, file })
    }
    return out
  }

  // ── ② 弹窗本体 ──
  let dirBoxEl = null
  let dirState = null
  let dirKeyHandler = null
  const dirRowNodes = new Map()
  let dirLastUserScrollAt = 0
  let dirSelfScroll = 0
  let dirClickLock = null
  const dirMarkUserScroll = () => {
    if (dirSelfScroll > 0) return                       // 程序化写入造成的事件不算"用户在滚"
    dirLastUserScrollAt = Date.now()
  }
  function dirSetScrollTop(list, v) {
    if (!list) return
    dirSelfScroll++
    try { list.scrollTop = Number(v) || 0 } finally { setTimeout(() => { dirSelfScroll-- }, 0) }
  }
  function closeDirPicker() {
    if (dirKeyHandler) { try { doc.removeEventListener('keydown', dirKeyHandler) } catch { /* 假 DOM */ } }
    dirKeyHandler = null
    if (dirBoxEl && dirBoxEl.parentNode) { try { dirBoxEl.parentNode.removeChild(dirBoxEl) } catch { /* 已移除 */ } }
    dirBoxEl = null; dirState = null
    dirRowNodes.clear()
  }
  function dirRowsFor(st) {
    const view = pickerView(pickIndex, st.cwd)
    if (!view) return { rows: [], view: null }
    const q = st.query
    const dirs = filterPickerRows(view.dirs, q)
    const files = st.mode === 'file' ? filterPickerRows(view.files.filter((f) => pickerAcceptMatch(f.name, st.kinds)), q) : []
    return { rows: dirs.concat(files), view }
  }
  function dirAnchorOf(list, nodes) {
    if (!list || !nodes || !nodes.length) return null
    const rects = []
    for (const n of nodes) { const r = n.getBoundingClientRect ? n.getBoundingClientRect() : null; rects.push(r ? { top: r.top, bottom: r.bottom } : null) }
    return pickerAnchor(rects, list.getBoundingClientRect ? list.getBoundingClientRect() : null)
  }
  function dirAnchorContentTop(key, list) {
    const n = dirRowNodes.get(key)
    if (!n || !n.getBoundingClientRect || !list.getBoundingClientRect) return null
    const r = n.getBoundingClientRect(), lr = list.getBoundingClientRect()
    return (Number(r.top) - Number(lr.top)) + (Number(list.scrollTop) || 0)
  }
  /** 重绘前后：锚点行 + 偏移 → 精确回位（锚点没了 ⇒ 夹住原位置；用户刚滚过 ⇒ 让位） */
  function dirRestoreScroll(anchor, prevTop) {
    const list = dirState && dirState.listEl
    if (!list) return null
    const guard = pickerScrollGuard({ lastUserScrollAt: dirLastUserScrollAt, now: Date.now(), windowMs: 700 })
    if (guard.skip) { dirState.lastRestore = { reason: 'user-scrolling', to: Number(list.scrollTop) || 0 }; return dirState.lastRestore }
    const plan = pickerRestoreScroll({
      anchorContentTop: anchor ? dirAnchorContentTop(anchor.key, list) : null,
      anchorOffset: anchor ? anchor.offset : null,
      prevScrollTop: prevTop,
      scrollHeight: list.scrollHeight, clientHeight: list.clientHeight,
    })
    if (Math.abs((Number(list.scrollTop) || 0) - plan.scrollTop) >= 1) dirSetScrollTop(list, plan.scrollTop)
    dirState.lastRestore = { reason: plan.reason, from: Math.round(Number(prevTop) || 0), to: Math.round(plan.scrollTop) }
    return dirState.lastRestore
  }
  function dirPaintRows() {
    const st = dirState
    const list = st && st.listEl
    if (!list) return
    const anchorPlan = dirAnchorOf(list, st.rowNodes)
    const anchorKey = (anchorPlan && st.rowNodes[anchorPlan.index]) ? st.rowNodes[anchorPlan.index].__rowKey : null
    const anchor = (anchorPlan && anchorKey) ? { key: anchorKey, offset: anchorPlan.offset } : null
    const prevTop = Number(list.scrollTop) || 0
    const plan = dirRowsFor(st)
    st.rows = plan.rows
    const keys = plan.rows.map((r) => r.kind + ':' + r.path)
    const diff = pickerRowDiff(st.rowNodes.map((n) => n.__rowKey), keys)
    for (const k of diff.remove) {
      const n = dirRowNodes.get(k)
      if (n && n.parentNode) n.parentNode.removeChild(n)
      dirRowNodes.delete(k)
    }
    st.rowNodes = []
    for (const r of plan.rows) {
      const key = r.kind + ':' + r.path
      let n = dirRowNodes.get(key)
      if (!n) { n = dirMakeRow(r); dirRowNodes.set(key, n) }
      n.__row = r
      n.className = 'bench-dirbox-row' + (r.kind === 'file' ? ' is-file' : ' is-dir') + (st.sel === r.path ? ' on' : '')
      list.appendChild(n)                              // 复用节点 ⇒ 只是原地移动，容器内容从不清空
      st.rowNodes.push(n)
    }
    st.diff = diff
    // 行集合变了（过滤词改了 / 换目录了）⇒ 键盘游标失效：绝不让它指向"另一行"
    if (diff.add.length || diff.remove.length) st.cursor = -1
    if (!plan.rows.length) {
      let empty = dirRowNodes.get('__empty')
      if (!empty) { empty = dirMk('div', 'bench-dirbox-empty'); empty.__rowKey = '__empty'; dirRowNodes.set('__empty', empty) }
      empty.textContent = st.mode === 'file' ? t(curLang, 'pick.noFile') : t(curLang, 'pick.empty')
      list.appendChild(empty)
    } else {
      const empty = dirRowNodes.get('__empty')
      if (empty && empty.parentNode) empty.parentNode.removeChild(empty)
      if (empty) dirRowNodes.delete('__empty')
    }
    if (st.pendingReset) { st.pendingReset = false; dirState.lastRestore = { reason: 'enter', to: 0 }; dirSetScrollTop(list, 0) }
    else dirRestoreScroll(anchor, prevTop)
  }
  function dirPaintChrome() {
    const st = dirState
    if (!st) return
    const view = st.view
    if (st.pathEl) st.pathEl.textContent = t(curLang, 'pick.curDir') + '：' + (st.cwd || '')
    if (st.listEl) st.listEl.setAttribute('aria-label', st.cwd || '')
    if (st.countEl) st.countEl.textContent = t(curLang, 'pick.count', { n: st.rows.length })
    if (st.upBtn) st.upBtn.disabled = !!(view && view.isRoot)
    if (st.homeBtn) st.homeBtn.disabled = !!(view && view.isRoot)
    if (st.confirmBtn) {
      const ready = st.mode === 'dir' ? !!st.cwd : !!st.sel
      st.confirmBtn.disabled = !ready
      st.confirmLabel.textContent = t(curLang, st.mode === 'file' ? 'pick.thisFile' : 'pick.here')
    }
    if (st.noteEl) st.noteEl.textContent = t(curLang, 'pick.readNote')
  }
  function dirPaint(opt) {
    const st = dirState
    if (!st) return
    const o = opt || {}
    if (o.reset) st.pendingReset = true
    const plan = dirRowsFor(st)
    st.view = plan.view
    dirPaintRows()
    dirPaintChrome()
    return { rows: st.rows.length, diff: st.diff, restore: st.lastRestore }
  }
  function dirMakeRow(r) {
    const n = dirMk('div', 'bench-dirbox-row ' + (r.kind === 'file' ? 'is-file' : 'is-dir'))
    n.setAttribute('role', 'button')
    n.setAttribute('tabindex', '-1')                 // 行不进 Tab 序：避免浏览器/辅助技术把焦点带进来顺带滚顶
    const ic = dirIcon(r.kind === 'file' ? 'file' : 'folder', 13)
    if (ic) n.appendChild(ic)
    n.appendChild(dirMk('span', 'bench-dirbox-name', r.name))
    n.appendChild(dirMk('span', 'bench-dirbox-sub', r.kind === 'file' ? (r.ext ? '.' + r.ext : '') : '›'))
    n.__rowKey = r.kind + ':' + r.path
    n.__row = r
    n.addEventListener('mousedown', (ev) => {
      // 不 focus()（focus 会把滚动容器滚到顶）；挡掉默认的聚焦/选区，并按 pointerdown 锁定目标行
      try { if (ev && ev.preventDefault) ev.preventDefault() } catch { /* 合成事件 */ }
      dirClickLock = { key: n.__rowKey, at: Date.now() }
    })
    n.addEventListener('click', () => dirActivateRow(n.__rowKey))
    return n
  }
  /** 键盘游标移动（↑↓）：只改高亮 + 必要时把那一行滚进可视区。
   *  两条纪律：① 不 focus()（focus 会把滚动容器滚到顶，用户实测过）；② 行已在可视区里就一个字都不写 scrollTop。 */
  function dirMoveCursor(i) {
    const st = dirState
    if (!st || !st.rows.length) return null
    const idx = Math.max(0, Math.min(st.rows.length - 1, Number(i) || 0))
    st.cursor = idx
    st.sel = st.rows[idx].path
    dirPaint()
    dirEnsureVisible(idx)
    return st.rows[idx]
  }
  function dirEnsureVisible(i) {
    const st = dirState
    const list = st && st.listEl
    const n = st && st.rowNodes[i]
    if (!list || !n || !n.getBoundingClientRect || !list.getBoundingClientRect) return
    const r = n.getBoundingClientRect(), lr = list.getBoundingClientRect()
    const top = Number(list.scrollTop) || 0
    if (r.bottom > lr.bottom) dirSetScrollTop(list, top + (r.bottom - lr.bottom))
    else if (r.top < lr.top) dirSetScrollTop(list, Math.max(0, top - (lr.top - r.top)))
    else return
    st.lastRestore = { reason: 'keyboard', to: Math.round(Number(list.scrollTop) || 0) }
  }
  function dirFindRow(key) {
    const st = dirState
    if (!st) return null
    for (const r of st.rows) if ((r.kind + ':' + r.path) === key) return r
    return null
  }
  function dirActivateRow(key) {
    const st = dirState
    if (!st) return
    const lock = dirClickLock
    dirClickLock = null
    // 重排/重绘后 click 落在别的行上：用 pointerdown 时锁定的那一行（插件 client.js:9885-9889 的同款修法）
    const use = (lock && lock.key === key && (Date.now() - lock.at) < 2000) ? lock.key : key
    const row = dirFindRow(use)
    if (!row) return
    if (row.kind === 'dir') {
      const nav = pickerNavigate(pickIndex, st.cwd, row.path)
      if (!nav.moved) return
      st.cwd = nav.cwd
      st.sel = null
      dirPaint({ reset: true })
      return
    }
    st.sel = st.sel === row.path ? null : row.path
    dirPaint()
  }
  function dirSetFilter(q) {
    const st = dirState
    if (!st) return null
    st.query = String(q == null ? '' : q)
    return dirPaint()                                  // 过滤 = 行集合变化 + 锚点回位（断言点：scrollTop 不许跳 0）
  }
  function dirConfirm() {
    const st = dirState
    if (!st) return
    const cb = st.onPick
    if (st.mode === 'dir') {
      const cwd = st.cwd
      closeDirPicker()
      const entriesPromise = Promise.resolve().then(() => dirEntriesUnder(cwd))
      if (cb) entriesPromise.then((entries) => cb({ kind: 'dir', path: cwd, entries: entries }))
      return
    }
    const row = st.rows.filter((r) => r.kind === 'file' && r.path === st.sel)[0]
    if (!row) return
    closeDirPicker()
    if (cb) cb({ kind: 'file', path: row.path, name: row.name, ext: row.ext, dir: row.path.split('/').slice(0, -1).join('/'), file: row.file, getFile: row.getFile })
  }
  /** 打开选择器（mode='dir'|'file'）。onPick({kind, path, name?, entries?})；无授权树时给"先授权"空态。 */
  function openDirPicker(opt) {
    const o = opt || {}
    const mode = o.mode === 'file' ? 'file' : 'dir'
    closeDirPicker()
    const st = dirState = {
      mode, kinds: o.kinds || pickerAcceptKinds(''), onPick: o.onPick || null,
      cwd: pickerResolveDir(pickIndex, o.cwd || (pickIndex ? pickIndex.root : '')),
      query: '', sel: null, cursor: -1, rows: [], rowNodes: [], view: null, diff: null,
      listEl: null, pathEl: null, countEl: null, confirmBtn: null, confirmLabel: null, noteEl: null,
      upBtn: null, homeBtn: null, lastRestore: null, pendingReset: true,
    }
    const box = dirBoxEl = dirMk('div', 'bench-dirbox')
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true')
    const win = dirMk('div', 'bench-dirbox-win')
    const head = dirMk('div', 'bench-dirbox-head')
    const title = dirMk('strong', 'bench-dirbox-title', t(curLang, mode === 'file' ? 'pick.fileTitle' : 'pick.dirTitle'))
    const xBtn = dirBtn('bench-dirbox-x', '', t(curLang, 'picker.cancel'), 'x')
    xBtn.addEventListener('click', () => closeDirPicker())
    head.appendChild(title); head.appendChild(xBtn)
    const pathEl = dirMk('div', 'bench-dirbox-path')
    const tools = dirMk('div', 'bench-dirbox-tools')
    const homeBtn = dirBtn('', t(curLang, 'pick.home'), t(curLang, 'pick.home'), 'house')
    const upBtn = dirBtn('', t(curLang, 'pick.up'), t(curLang, 'pick.up'), 'up')
    const grantBtn = dirBtn('', t(curLang, 'pick.grant'), t(curLang, 'pick.grant'), 'folder')
    const filter = dirMk('input', 'bench-dirbox-filter')
    filter.setAttribute('type', 'search'); filter.setAttribute('placeholder', t(curLang, 'pick.filterPh'))
    homeBtn.addEventListener('click', () => { const nav = pickerNavigate(pickIndex, st.cwd, '/'); if (nav.moved) { st.cwd = nav.cwd; st.sel = null; st.query = ''; filter.value = ''; dirPaint({ reset: true }) } })
    upBtn.addEventListener('click', () => { const nav = pickerNavigate(pickIndex, st.cwd, '..'); if (nav.moved) { st.cwd = nav.cwd; st.sel = null; st.query = ''; filter.value = ''; dirPaint({ reset: true }) } })
    grantBtn.addEventListener('click', () => pickLocalFolder({ onEntries: (entries) => { if (entries) { grantPickerIndex(entries); const root = pickIndex ? pickIndex.root : ''; st.cwd = pickerResolveDir(pickIndex, root); st.sel = null; dirPaint({ reset: true }) } else if (st.needGrantNote) st.needGrantNote.textContent = t(curLang, 'pick.needGrant') } }))
    filter.addEventListener('input', () => dirSetFilter(filter.value))
    tools.appendChild(homeBtn); tools.appendChild(upBtn); tools.appendChild(grantBtn); tools.appendChild(filter)
    const noteEl = dirMk('div', 'bench-dirbox-note')
    const list = dirMk('div', 'bench-dirbox-list')
    list.setAttribute('tabindex', '0')
    list.addEventListener('wheel', dirMarkUserScroll, { passive: true })
    list.addEventListener('touchmove', dirMarkUserScroll, { passive: true })
    list.addEventListener('scroll', dirMarkUserScroll, { passive: true })
    const foot = dirMk('div', 'bench-dirbox-foot')
    const countEl = dirMk('span', 'bench-dirbox-count')
    const confirmBtn = dirBtn('bench-dirbox-go', '', '', 'check')
    const confirmLabel = dirMk('span', '', t(curLang, mode === 'file' ? 'pick.thisFile' : 'pick.here'))
    confirmBtn.appendChild(confirmLabel)
    const cancelBtn = dirBtn('bench-dirbox-go bench-dirbox-go2', t(curLang, 'picker.cancel'))
    confirmBtn.addEventListener('click', () => dirConfirm())
    cancelBtn.addEventListener('click', () => closeDirPicker())
    foot.appendChild(countEl); foot.appendChild(cancelBtn); foot.appendChild(confirmBtn)
    win.appendChild(head); win.appendChild(pathEl)
    if (!pickIndex) {
      const need = dirMk('div', 'bench-dirbox-note', t(curLang, 'pick.needGrant'))
      st.needGrantNote = need
      win.appendChild(need)
    }
    win.appendChild(tools); win.appendChild(list); win.appendChild(noteEl); win.appendChild(foot)
    box.appendChild(win)
    box.addEventListener('mousedown', (ev) => { if (ev && ev.target === box) closeDirPicker() })
    doc.body.appendChild(box)
    st.listEl = list; st.pathEl = pathEl; st.countEl = countEl; st.confirmBtn = confirmBtn
    st.filterEl = filter                                  // 第七批②：换目录时连带清空过滤框（与「上一级/回到最上层」一致）
    st.confirmLabel = confirmLabel; st.noteEl = noteEl; st.upBtn = upBtn; st.homeBtn = homeBtn
    // 第七批②：键盘导航走纯函数决策（Esc 关 / ↑↓ 移动 / Enter 激活或确认）——
    // 与插件侧同一行为契约；方向键与 Enter 一律 preventDefault（不冒泡去滚宿主页面）。
    dirKeyHandler = (ev) => {
      const st = dirState
      if (!ev || !st) return
      const key = ev.key || (ev.keyCode === 27 ? 'Escape' : '')
      const k = pickerKeyAction({ key: key, rows: st.rows.length, index: st.cursor == null ? -1 : st.cursor })
      if (k.action === 'none') return
      try { if (ev.preventDefault) ev.preventDefault() } catch { /* 合成事件 */ }
      if (k.action === 'close') { closeDirPicker(); return }
      if (k.action === 'next' || k.action === 'prev') { dirMoveCursor(k.index); return }
      if (k.action === 'activate') { const r = st.rows[k.index]; if (r) dirActivateRow(r.kind + ':' + r.path); return }
      dirConfirm()
    }
    try { doc.addEventListener('keydown', dirKeyHandler) } catch { /* 假 DOM */ }
    try { if (box.focus) box.focus({ preventScroll: true }) } catch { /* 老浏览器：不带参数也不影响滚动 */ }
    dirPaint({ reset: true })
    return { mode: mode, cwd: st.cwd, rows: st.rows.length, granted: !!pickIndex }
  }

  // ── ③ 三个入口：壁纸库「选择文件夹」/ 侧栏「选择文件」/ 属性面板的行内「选择文件…」──
  async function useSubtreeAsLibrary(res) {
    if (!res) return
    logLine(t(curLang, 'local.grantScan', { name: res.path }))
    const entries = (res.entries || []).filter((e) => e && e.file)
    if (!entries.length) { logLine(t(curLang, 'local.none'), true); return }
    await loadLocalEntries(entries)
  }
  function openLibraryPicker() {
    // 第七批②：入口**一律先开插件同款弹窗**（与 dsh-mpkg-wallpaper/lib/client.js 的目录选择弹窗同款交互）。
    // 还没授权过也开：弹窗里给「浏览器安全限制」说明 + 「打开系统选择器」按钮，授权完**原地**继续浏览。
    // 老写法是没授权就直接弹系统对话框 —— 用户看不到"两个入口用的是同一个选择器"，也没有说明。
    if (!canPickViaInput() && !canShowDirPicker()) { logLine(t(curLang, 'local.unsupported'), true); return false }
    openDirPicker({ mode: 'dir', onPick: useSubtreeAsLibrary })
    return true
  }

  /* ── ⑤(P-158 · 主对话指定契约) 「选择文件夹」= **应用内**目录对话框（服务端只读浏览）──────────────
     为什么换掉原来的入口：原入口直接吃系统对话框（bundle 的 `POST /api/library-dir {pick:true}` → 服务端开原生
     对话框，或在 `unsupported` 时 `window.prompt`）—— 在容器/安卓环境下这个原生对话框**看不到、也常选不到
     环境内目录**。新做法：应用内对话框，数据来自主对话钉死的两条只读路由
       GET /api/fs/roots            ⇒ {ok, roots:[{label,path}]}
       GET /api/fs/list?path=<abs>  ⇒ {ok, path, parent, entries:[{name,type,size,kind}]}
     选中后调**既有**库接口 `POST /api/library-dir {dir}`（服务端返回里带 `source:'user'` 时前端直接采信），
     然后写 localStorage 的 `we-bench-library-dir`。
     成功之后的三条契约（2026-09-20 用户第 1 条，纯函数 `libDirCommitPlan()` 可断言）：
       · **立刻重新拉壁纸库列表**：同页 `GET /api/library`（`refreshLibrarySoft()`）—— 不用手动刷新页面；
       · **自动关闭对话框**：`closeFsDialog()`；
       · **不碰当前选中的壁纸**：既不 `switchToWallpaper` 也不点 `#release`（用户明确要求）。
       失败 ⇒ **不关窗**，把原因写在对话框里（`pickd.fail`），并把对话框状态标成 `error`。
     优雅降级：路由还没落地（404）/ 没有后端 ⇒ 弹同一个对话框但**明确写"服务端还没有 /api/fs/* 这条路由"**，
     并把两个兜底按钮摆出来（纯前端扫描 / **显式标注**的系统选择器），绝不静默失败。
     ── 状态机纪律（同一条的根因收口）────────────────────────────────────────────────
     故障读数 `{status:200, rows:0, dirs:0, path:"Reading…"}`：后端 200、形状正确，前端一行没落
     ⇒ "永远停在 Reading…"这条路径必须从构造上不存在。做法：
       · 每一步都写成**可见状态**（`#bench-fs-dialog[data-state]` = loading/ok/error）；
       · 每个请求都有**超时**（`FS_TIMEOUT_MS`）与**代际号**（`ui.gen`）：关窗/重开后回来的过期响应一律丢弃；
       · 加载中就把"正在读哪个目录"写进列表（`data-path` 先落请求目标），不再只留一句 Reading…；
       · 「就选这个目录」只在列表真的读成功之后才可点（`ui.loaded`）。 */
  const FS_TIMEOUT_MS = 9000
  let fsDialog = null
  let fsSeq = 0
  let fsLastResult = null                     // 探针读数（__benchPatch.fsState()）
  /** 把状态机的一步写成**可见状态**（`#bench-fs-dialog[data-state]`）：loading / ok / error / applying。
   *  门禁与探针读的就是这个属性 —— "到底卡在哪一步"必须能从 DOM 上直接读出来，而不是靠猜。 */
  function fsSetState(ui, state, extra) {
    if (!ui || !ui.box) return state
    try { ui.box.dataset.state = String(state) } catch { /* 桩 DOM */ }
    try { ui.box.dataset.gen = String(ui.gen) } catch { /* 桩 DOM */ }
    if (extra && extra.message != null && ui.pathEl) ui.pathEl.textContent = String(extra.message)
    if (extra && extra.path != null && ui.pathEl && ui.pathEl.dataset) ui.pathEl.dataset.path = String(extra.path)
    return state
  }
  /** 库目录对话框的**可判据快照**（门禁/探针同一入口，与 npOcclusion/getPointerPark 同一写法）。 */
  function fsState() {
    const ui = fsDialog
    return {
      open: !!ui, gen: ui ? ui.gen : fsSeq, state: (ui && ui.box && ui.box.dataset) ? String(ui.box.dataset.state || '') : '',
      path: ui ? String(ui.path || '') : '', loaded: !!(ui && ui.loaded), pending: !!(ui && ui.pending),
      rows: ui ? (ui.rows || []).length : 0, dirs: ui ? (ui.rows || []).filter((r) => r.type === 'dir').length : 0,
      listed: ui && ui.list ? ui.list.querySelectorAll('.bench-dirbox-row').length : 0,
      hasConfirm: !!(ui && ui.confirmBtn), confirmDisabled: !!(ui && ui.confirmBtn && ui.confirmBtn.disabled),
      dialogs: doc.querySelectorAll ? doc.querySelectorAll('.bench-dirbox').length : -1,     // 单例不变式：同时只许一个
      lastErr: ui ? String(ui.lastErr || '') : '', loadMs: ui ? Number(ui.loadMs || -1) : -1, last: fsLastResult,
      commit: libDirCommitPlan(),                       // 成功/失败两侧的动作契约（纯函数，门禁直接断言）
    }
  }
  /* ── ④(2026-09-24 用户第 4 条)「有范围的显示」通用溢出自检：DOM 取数层 ───────────────────────────
     与纯判定 `overflowVerdict()` 分工：这里只**量**（每行给出 client/scroll/computed overflow/越界子元素），
     判定全在上面那个可 Node 直测的纯函数里。`__benchPatch.panelOverflowProbe()` 是门禁与真机同一个入口。 */
  const boxRect = (el) => { try { return el && el.getBoundingClientRect ? el.getBoundingClientRect() : null } catch { return null } }
  function overflowRows() {
    const rows = []
    for (const sel of OVERFLOW_PROBE_SELECTORS) {
      let el = null
      try { el = doc.querySelector ? doc.querySelector(sel) : null } catch { el = null }
      if (!el) { rows.push({ sel, present: false }); continue }
      const r = boxRect(el)
      let cs = null
      try { cs = doc.defaultView && doc.defaultView.getComputedStyle ? doc.defaultView.getComputedStyle(el) : null } catch { cs = null }
      const scrollableX = !!(cs && /auto|scroll/.test(String(cs.overflowX || '')))
      const scrollableY = !!(cs && /auto|scroll/.test(String(cs.overflowY || '')))
      const offenders = []
      try {
        for (const child of (el.children || [])) {
          const cr = boxRect(child)
          if (!cr || !cr.width) continue
          /* ②(实测收口) 绝对/固定定位的子节点是**浮层**（`#np-host` 这类），天然出流 —— 不计入越界。 */
          let cpos = ''
          try { cpos = doc.defaultView && doc.defaultView.getComputedStyle ? String(doc.defaultView.getComputedStyle(child).position || '') : '' } catch { cpos = '' }
          if (cpos === 'absolute' || cpos === 'fixed') continue
          let axis = ''
          if (r && cr.right > r.right + 0.5) axis = 'x'
          else if (r && cr.left < r.left - 0.5) axis = 'x'
          if (r && (cr.bottom > r.bottom + 0.5 || cr.top < r.top - 0.5)) axis = axis || 'y'
          if (axis) offenders.push({ sel: sel + ' > ' + String(child.id || child.className || child.tagName || 'node').split(/\s+/)[0], axis, left: Math.round(cr.left), right: Math.round(cr.right), boxLeft: r ? Math.round(r.left) : null, boxRight: r ? Math.round(r.right) : null })
        }
      } catch { /* 桩 DOM */ }
      rows.push({
        sel, present: true,
        clientW: Number(el.clientWidth) || 0, scrollW: Number(el.scrollWidth) || 0,
        clientH: Number(el.clientHeight) || 0, scrollH: Number(el.scrollHeight) || 0,
        overflowXStyle: cs ? String(cs.overflowX || '') : '', overflowYStyle: cs ? String(cs.overflowY || '') : '',
        scrollableX, scrollableY,
        rect: r ? { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right) } : null,
        offenders,
      })
    }
    return rows
  }
  /** 「有范围的显示」溢出自检读数（面板/下拉/工具条/对话框一次量完 + 已判定的 `bad` 清单）。 */
  function panelOverflowProbe(opts) {
    const rows = overflowRows()
    const v = overflowVerdict(rows, opts)
    return { viewport: { w: (typeof window !== 'undefined' && window.innerWidth) || 0, h: (typeof window !== 'undefined' && window.innerHeight) || 0 }, rows, bad: v.bad, ok: v.ok, count: v.count }
  }
  /** ①(2026-09-24 用户第 1 条) 库目录对话框里**快捷根那一行**的几何读数（"显示不下/一字一行"的判据）。 */
  function dirboxGeometry() {
    const chips = (() => { try { return doc.querySelectorAll('.bench-dirbox-roots button') } catch { return [] } })()
    const row = (() => { try { return doc.querySelector('.bench-dirbox-roots') } catch { return null } })()
    const rr = boxRect(row)
    const out = { open: !!row, count: chips.length, chips: [], overflow: false, worst: [], wrapped: false, lineChars: [] }
    let tops = new Set()
    for (const b of chips) {
      const r = boxRect(b)
      if (!r) continue
      out.chips.push({ label: String(b.textContent || ''), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), disabled: !!b.disabled, listable: b.dataset ? String(b.dataset.listable || '') : '' })
      tops.add(Math.round(r.top))
      //  "一字一行"判据：按钮高度远大于一行（>2 行高度）或宽度小于最窄可读宽（<40px）
      if (r.height > 30 || r.width < 40) out.lineChars.push(String(b.textContent || ''))
      if (rr && (r.right > rr.right + 0.5 || r.left < rr.left - 0.5)) { out.overflow = true; out.worst.push(String(b.textContent || '')) }
    }
    out.wrapped = tops.size > 1
    out.viewport = { w: (typeof window !== 'undefined' && window.innerWidth) || 0 }
    return out
  }
  function closeFsDialog(why) {
    const ui = fsDialog
    fsSeq++                                   // 关掉之后回来的在途响应一律过期
    if (ui && ui.box && ui.box.parentNode) { try { ui.box.parentNode.removeChild(ui.box) } catch {} }
    if (ui && ui.onKey) { try { doc.removeEventListener('keydown', ui.onKey) } catch {} }
    if (ui) fsLastResult = { closed: true, why: String(why || 'close'), path: ui.path || '', rows: (ui.rows || []).length }
    fsDialog = null
  }
  /** 带**超时**的取数：fetch 挂了/服务端不回，都不许让对话框停在"八字没一撇"的状态。 */
  async function fsJson(url, init, ms) {
    const to = Number(ms) > 0 ? Number(ms) : FS_TIMEOUT_MS
    let ctl = null
    try { ctl = (typeof AbortController === 'function') ? new AbortController() : null } catch { ctl = null }
    const timer = (ctl && typeof setTimeout === 'function') ? setTimeout(() => { try { ctl.abort() } catch { /* 已结束 */ } }, to) : null
    try {
      const o = Object.assign({}, init || {})
      if (ctl) o.signal = ctl.signal
      const r = await fetch(url, o)
      let body = null
      try { body = await r.json() } catch { body = null }
      return { status: r.status, ok: r.ok, body }
    } finally { if (timer) { try { clearTimeout(timer) } catch { /* ignore */ } } }
  }
  /** 成功切换库根之后的**软刷新**（用户第 3 条②：切完必须**立刻**跟着变，不许等刷新页面）：
   *   ① 丢掉进程内缓存并重新 `GET /api/library`（= 重新拉壁纸库列表）；
   *   ② **重新取一次** `/api/library-source`（`askLibSourceOnce(true)`）—— 否则"来源"行永远停在旧根；
   *   ③ 让外壳重画面（类型开关文案 + 库列表面板 + 库来源行 + 切换栏）—— 走 `window.__benchShellRefresh()`；
   *   ④ 缩略图/预览的**缓存击穿**：给所有 `/api/thumb` / `/media/dev` / `/web/dev` 的 `img` 补 `_r=<新根签名>`
   *      （服务端按 id 解析的根变了 ⇒ 同一 itemId 的缩略图字节也可能变，不换 URL 浏览器会拿缓存当新图）；
   *   ⑤ **不刷整页、不碰当前选中的壁纸**（用户第 1 条第三条：既不 `switchToWallpaper` 也不点 `#release`）。 */
  async function refreshLibrarySoft() {
    hostLibCache = null
    let ids = null
    try {
      const r = await fsJson('/api/library', { headers: { accept: 'application/json' } }, 6000)
      const j = (r.body && typeof r.body === 'object') ? r.body : null
      if (j && Array.isArray(j.items)) ids = j.items.map((it) => String((it && it.itemId) || '')).filter(Boolean)
      if (j && j.dir) libRootSignature = String(j.dir)
    } catch { ids = null }
    //  ③ 外壳重画（`refreshSwitcher` **定义在 initSiteShell 里**：这里必须经 `window.__benchShell` 拿，
    //     旧写法直接写 `refreshSwitcher(true)` ⇒ `ReferenceError: refreshSwitcher is not defined`（tsc TS2304），
    //     又被 try/catch 吞掉 ⇒ 真机表现"切完列表没变"。现在：拿不到外壳就**如实记进读数**，不假装刷过。）
    const shell = (typeof window !== 'undefined' && window.__benchShell) ? window.__benchShell : null
    let switcher = null
    try { if (shell && typeof shell.refreshSwitcher === 'function') switcher = shell.refreshSwitcher(true) } catch (e) { switcher = { error: String((e && e.message) || e) } }
    try { if (typeof window !== 'undefined' && typeof window.__benchShellRefresh === 'function') window.__benchShellRefresh() } catch { /* 外壳未就绪 */ }
    askLibSourceOnce(true)                       // ② 重新取权威来源（doc 里的 `dir` 必须是新根）
    paintLibSource()
    bustRootSensitiveCaches()                    // ④ 缩略图/预览的缓存击穿
    //  ⑤(2026-09-24 用户第 5 条) **侧栏行也要跟着换库**（见 refreshSidebarList 的根因注释）
    let sidebar = null
    try { sidebar = await refreshSidebarList({ reason: 'lib-dir' }) } catch (e) { sidebar = { error: String((e && e.message) || e) } }
    return { ok: !!ids, count: ids ? ids.length : null, ids: ids || [], rootSignature: libRootSignature, switcher, sidebar }
  }
  /* ── ⑤(2026-09-24 用户第 5 条)「选完文件夹后预览不实时刷新：列表还留着上一次选择的内容」──────────────
     真因（可复现）：侧栏 `#list` 是**产物**渲染的，它的库数据 `ne` 只在产物自己的 `#pick-lib.onclick`
     链尾重新拉一次 —— `j.onclick = async () => { …; ht(); await Te() }`，而 `Te()` 就是
     `fetch('/api/library')` + 重画 `#list`。本补丁按用户第 1 条把那个入口接管了（F0 判据），
     于是**没有任何人再调用 `Te()`** ⇒ 「选择文件夹」成功后：
       · `GET /api/library`（我们的 `refreshLibrarySoft`）确实拉到了新库；
       · 但侧栏 DOM 还是旧库的行 —— 行的 itemId 在新库里不存在 ⇒ `/api/thumb?item=<旧 id>` 404
         ⇒ 用户看到的正是"列表还留着上一次选择的内容、缩略图加载不出来"。
     修法（**不重写产物的挂载链**，只借它自己那条重载链跑一次）：
       · `artifactPickChain` 是我们接管 `#pick-lib` 时存下来的原处理器（见 detachArtifactPickChain），
         它内部就是"切目录 ⇒ `Te()` 重拉重画"；
       · 链上唯一不能真跑的一步是 `POST /api/library-dir {pick:true}`（服务端会开原生对话框，
         真机/门禁都禁掉它）⇒ 用**一次性 fetch 垫片**把这一次请求就地答成
         `{ok:true, dir:<新根>, source:'user'}`（其余请求逐字节透传，绝不碰别的东西）。
       · 那条链末尾的 `ht()` 会释放舞台（产物的写法，改不了）⇒ 刷新完**按 id 复原**：
         新库里还有同一个 id 就重新挂它；没有就如实留在"未选择壁纸"并写一行日志（不假装还在渲染）。
     读数（探针 `libRefreshProbe()`）：`{ ran, rootDir, rows, restored, released, lines, error }`。 */
  let libRefreshLast = null
  /** 本作用域够得着的外壳入口（`switchToWallpaper`/`curId` 都在 `initSiteShell` 里，见那里的导出）。 */
  const shellApi = () => ((typeof window !== 'undefined' && window.__benchShell) ? window.__benchShell : null)
  async function refreshSidebarList(opts) {
    const o = opts || {}
    const sh0 = shellApi()
    const before = (() => {
      try { if (sh0 && typeof sh0.currentId === 'function') return String(sh0.currentId() || '') } catch { /* 桩 */ }
      try { return String((doc.querySelector('#current') || {}).textContent || '') } catch { return '' }
    })()
    const rowsBefore = (() => { try { return doc.querySelectorAll('#list li[data-id]').length } catch { return -1 } })()
    const nativeFetch = (typeof window !== 'undefined' && typeof window.fetch === 'function') ? window.fetch : (typeof fetch === 'function' ? fetch : null)
    const fn = artifactPickChain
    const read = { ran: false, reason: String(o.reason || ''), rootDir: String(libRootSignature || ''), rowsBefore, rows: -1, restored: false, released: false, lines: -1, error: '' }
    if (typeof fn !== 'function' || !pickLibBtn) { read.error = 'no-artifact-chain'; libRefreshLast = read; return read }
    if (typeof nativeFetch !== 'function') { read.error = 'no-fetch'; libRefreshLast = read; return read }
    const target = String(libRootSignature || '')
    const stub = async function (url, init) {
      try {
        const u = String((url && url.url) || url || '')
        const method = String((init && init.method) || (url && url.method) || 'GET').toUpperCase()
        if (method === 'POST' && /\/api\/library-dir(\?|$)/.test(u)) {
          //  只拦"开原生对话框"这一种请求体；带 {dir} 的请求照常透传（那条是真正切根的那一次）
          const body = String((init && init.body) || '')
          if (!body || !/"dir"\s*:/.test(body)) {
            return { ok: true, status: 200, json: async () => ({ ok: true, dir: target, source: 'user', stub: 'bench-pick-shim' }), text: async () => '' }
          }
        }
      } catch { /* 垫片自己出错 ⇒ 走真 fetch */ }
      return nativeFetch.apply(this, arguments)
    }
    const countRows = () => { try { return doc.querySelectorAll('#list li[data-id]').length } catch { return -1 } }
    try { if (typeof window !== 'undefined') window.fetch = stub } catch { /* 桩环境 */ }
    try {
      fn.call(pickLibBtn)                        // 产物那条链：切目录 ⇒ ht() ⇒ Te()（重拉 + 重画 #list）
      read.ran = true
      /*  `Te()` 是异步的（fetch + 重画），而且产物重画是"先清空、后逐行 append" ⇒ 只等"行数变了"会抓到
         中间态（实测真机读数：`rows:0` 而 DOM 随后是 2 行 —— 探针与日志都会记成"0 项"）。
          所以判据改成：行集合**变了**且**连续两次采样稳定**（或超时）。 */
      const deadline = Date.now() + 8000
      let last = countRows(), stable = 0
      for (;;) {
        await new Promise((r) => setTimeout(r, 120))
        const n = countRows()
        if (n === last) stable++
        else { stable = 0; last = n }
        if (n !== rowsBefore && n >= 0 && stable >= 2) break
        if (Date.now() > deadline) break
      }
    } catch (e) { read.error = String((e && e.message) || e) } finally {
      try { if (typeof window !== 'undefined' && window.fetch === stub) window.fetch = nativeFetch } catch { /* 桩环境 */ }
      detachArtifactPickChain()                  // 垫片撤了 ⇒ 立刻再摘一次（F0 的"只有一个主人"不变量）
    }
    try { read.rows = countRows() } catch { read.rows = -1 }
    try { read.lines = doc.querySelectorAll('#logbody > *').length } catch { read.lines = -1 }
    if (read.ran && !read.error) { try { logLine(t(curLang, 'log.listRefreshDone', { n: read.rows, id: before || '—' })) } catch { /* 桩 DOM */ } }
    //  复原当前壁纸（`ht()` 已经把它释放了）：新列表里还有同 id ⇒ 重新挂上；没有 ⇒ 如实留空态 + 写日志
    const want = String(before || '')
    const stillThere = !!want && (() => { try { return [...doc.querySelectorAll('#list li[data-id]')].some((li) => String(li.dataset.id || '') === want) } catch { return false } })()
    if (want && stillThere) {
      try { read.restored = !!(shellApi() && typeof shellApi().switchToWallpaper === 'function' && shellApi().switchToWallpaper(want)) } catch { read.restored = false }
    } else if (want) {
      read.released = true
      try { logLine(t(curLang, 'log.listRefreshDropped', { id: want })) } catch { /* 桩 DOM */ }
    }
    libRefreshLast = read
    return read
  }
  /* ⑦(2026-09-25 issue0924a2 用户第 7 条) 把**产物那侧**的"当前壁纸"也清掉（`w = null`）。
     ── 用户原话 ─────────────────────────────────────────────────────────────────────
     「渲染器使用我的渲染器的时候（这时候我已经把上面选过的所有壁纸都叉掉了，是未选择壁纸的状态）
       我把渲染器切成上游产物，它就加载了一个我最后加载的一个壁纸……这个 bug 你修一下，
       为什么切渲染器会突然加载出来壁纸。」
     ── 真因（minified 产物，源码级 + 真机读数双向取证）──────────────────────────────
     产物的"当前壁纸"是它模块作用域里的 `w`：`demo/assets/bench-DSKWIqmS.js:94129` 的
     `function Ue(e){w=e,…}` 写入、`:94186` 的 `function Ae(){if(!w)return;…k.src=…}` **读它重挂载**、
     只有 `:88075` 的 `function ht(){w=null,…}` 会清它。而产物自己那个「释放」按钮是
     `l("#release").onclick=()=>E()?.release()`（:95493）—— **只释放舞台，不动 `w`**。
     ⇒ 用户「叉掉已选壁纸」之后（我们这条关闭链也点过 `#release`），`w` 仍指着最后挂载的那张；
     切渲染器档会点产物的「重挂载」（`#reload` → `Ae()`），`Ae()` 的 `if(!w)` 判真 ⇒ **又挂回来**。
     改前真机读数：`#frame.src` 从 `about:blank` 变回 `…&src=2887099508…`，`#current` 也从
     "未选择壁纸/No wallpaper"变回那张壁纸的标题，`#empty` 又被藏起来（= 用户看到的"凭空加载"）。
     ── 改法 ─────────────────────────────────────────────────────────────────────────
     借产物**自己的**清理入口：`#pick-lib` 原处理器（我们接管时摘下来存的 `artifactPickChain`，
     A5「换库后重画侧栏」已经在用同一条链）里，`ut()` 拿到目录后会调 `ht(), await Te()` ——
     `ht()` 就是那个"把 `w` 置空 + 清 `#current` + 摘掉 `#frame.src` + 显示空态"的唯一入口。
     这里用一次性 fetch 垫片把"开原生对话框"那一问就地答掉（与 `refreshSidebarList` 同一个办法），
     清完**不复原**任何壁纸（本轮的目标就是"未选择壁纸"状态）。
     读数：`__benchPatch.artifactClearProbe()`。 */
  let artifactClearLast = null
  /*  ⚠作用域纪律（本文件踩过两次同类事故）：关闭链在**模块级** `initSiteShell()` 里，
      够不着 `init()` 内部的这个函数 —— 所以走一个显式的 window 桥（与 `window.__benchShell`
      同一套做法），调用方一律用 `typeof === 'function'` 判存在，不许裸引用（裸引用 = ReferenceError
      被 try/catch 吞掉 ⇒ 看起来"改了但没生效"，本轮第一次实现就是这么假绿的）。 */
  try { if (typeof window !== 'undefined') window.__benchClearArtifactSelection = clearArtifactSelection } catch { /* 桩环境 */ }
  async function clearArtifactSelection(reason) {
    const read = { ran: false, reason: String(reason || ''), srcBefore: '', srcAfter: '', curAfter: '', cleared: false, error: '' }
    const fn = artifactPickChain
    const frameOf = () => { try { return doc.getElementById('frame') } catch { return null } }
    const srcOf = () => { try { const f = frameOf(); return f ? String(f.getAttribute('src') || '') : '' } catch { return '' } }
    read.srcBefore = srcOf()
    if (typeof fn !== 'function' || !pickLibBtn) { read.error = 'no-artifact-chain'; artifactClearLast = read; return read }
    const nativeFetch = (typeof window !== 'undefined' && typeof window.fetch === 'function') ? window.fetch : (typeof fetch === 'function' ? fetch : null)
    if (typeof nativeFetch !== 'function') { read.error = 'no-fetch'; artifactClearLast = read; return read }
    const target = String(libRootSignature || '')
    const stub = async function (url, init) {
      try {
        const u = String((url && url.url) || url || '')
        const method = String((init && init.method) || (url && url.method) || 'GET').toUpperCase()
        if (method === 'POST' && /\/api\/library-dir(\?|$)/.test(u)) {
          const body = String((init && init.body) || '')
          if (!body || !/"dir"\s*:/.test(body)) {
            return { ok: true, status: 200, json: async () => ({ ok: true, dir: target, source: 'user', stub: 'bench-clear-shim' }), text: async () => '' }
          }
        }
      } catch { /* 垫片自己出错 ⇒ 走真 fetch */ }
      return nativeFetch.apply(this, arguments)
    }
    try { if (typeof window !== 'undefined') window.fetch = stub } catch { /* 桩环境 */ }
    try {
      fn.call(pickLibBtn)                       // 产物那条链：切目录 ⇒ ht()（w=null）⇒ Te()（重画 #list）
      read.ran = true
      /*  `ht()` 在 `await fetch(...)` 之后同步跑 ⇒ 等几拍再看读数（这里是"清干净了没有"，不涉及列表内容）。 */
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 100))
        if (!srcOf()) break
      }
    } catch (e) { read.error = String((e && e.message) || e) } finally {
      try { if (typeof window !== 'undefined' && window.fetch === stub) window.fetch = nativeFetch } catch { /* 桩环境 */ }
      detachArtifactPickChain()
    }
    read.srcAfter = srcOf()
    try { read.curAfter = String((doc.querySelector('#current') || {}).textContent || '') } catch { read.curAfter = '' }
    try { read.emptyShown = !!(doc.querySelector('#empty') && doc.querySelector('#empty').style && doc.querySelector('#empty').style.display !== 'none') } catch { read.emptyShown = null }
    /*  "清干净"的判据 = `#frame` 不再挂着任何 URL（产物 `ht()` 写的就是 `removeAttribute('src')`）。 */
    read.cleared = !read.srcAfter
    artifactClearLast = read
    return read
  }
  const artifactClearProbe = () => artifactClearLast
  /** ④ 缩略图/预览**缓存击穿**：凡是"按 itemId 从服务端取字节"的 URL，换根之后加一个 `_r=` 版本号。
   *  为什么必须有：`<img src="/api/thumb?item=X&w=320">` 在切根前后**逐字相同**，浏览器会直接拿旧根的图
   *  （服务端 no-store 也救不了"URL 没变"这条），用户看到的就是"缩略图还是老根的那几张"。
   *  实现：`libRootSignature`（= `/api/library` 返回的新 `dir`）参与 URL；只在签名变化时改写，幂等。 */
  function bustRootSensitiveCaches() {
    const sig = String(libRootSignature || '')
    if (!sig || sig === bustedSignature) return 0
    bustedSignature = sig
    let n = 0
    try {
      const D = (typeof document !== 'undefined') ? document : null
      const imgs = D && D.querySelectorAll ? D.querySelectorAll('img[src*="/api/thumb"],img[src*="/media/dev/"],img[src*="/web/dev/"]') : []
      for (const img of imgs) {
        const cur = String(img.getAttribute('src') || '')
        if (!cur || /[?&]_r=/.test(cur)) continue
        img.setAttribute('src', cur + (cur.indexOf('?') >= 0 ? '&' : '?') + '_r=' + encodeURIComponent(sig))
        n++
      }
    } catch { /* 桩 DOM */ }
    return n
  }
  async function applyLibDir(dir, ui) {
    const target = String(dir || '')
    if (!target) return null
    if (ui && ui.note) ui.note.textContent = t(curLang, 'pickd.applying')
    if (ui) fsSetState(ui, 'applying', {})
    try {
      const res = await fsJson('/api/library-dir', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dir: target }),
      })
      const j = res.body && typeof res.body === 'object' ? res.body : {}
      if (!res.ok || j.error) throw new Error(j.error || ('HTTP ' + res.status))
      const chosen = String(j.dir || target)
      try { localStorage.setItem('we-bench-library-dir', chosen) } catch { /* 隐私模式 */ }
      const src = String(j.source || 'user')                     // 服务端带 source 就采信它（契约：'user'）
      libRootSignature = chosen                                  // ② 先按切根响应记签名（即便下面 `/api/library` 失败也照样击穿缓存）
      paintLibSource()
      //  ① 立刻重新拉壁纸库列表（软刷新：同页 GET /api/library，不 reload 整页、不碰当前选中）
      const fresh = await refreshLibrarySoft()
      //  ② 自动关闭对话框（关掉之后在途的响应由代际号丢弃）
      closeFsDialog('committed')
      //  ③ 不碰当前选中的壁纸：这里没有 switchToWallpaper / #release 的任何调用
      fsLastResult = {
        committed: true, path: chosen, source: src, listCount: fresh.count, reloadPage: false, touchedSelection: false,
        rootSignature: fresh.rootSignature, switcher: fresh.switcher === undefined ? null : fresh.switcher,   // ② 同页刷新的读数（探针/门禁直接断言）
      }
      logLine(t(curLang, 'pickd.selected', { path: chosen }) + ' · source=' + src +
        (fresh.ok ? (' · ' + t(curLang, 'pickd.relisted', { n: fresh.count })) : ''))
      return chosen
    } catch (e) {
      //  失败：**不关窗**，把原因写在对话框里（用户第 1 条的第三条）
      const msg = (e && e.message) || String(e)
      fsLastResult = { committed: false, path: target, error: msg, closed: false }
      if (ui && ui.note) ui.note.textContent = t(curLang, 'pickd.fail', { msg })
      if (ui) fsSetState(ui, 'error', {})
      logLine(t(curLang, 'pickd.fail', { msg }), true)
      return null
    }
  }
  function fsFallbackButtons(ui) {
    const wrap = dirMk('div', 'bench-dirbox-tools')
    const front = dirBtn('', t(curLang, 'pickd.frontend'), t(curLang, 'pickd.frontend'), 'folder')
    front.addEventListener('click', () => { closeFsDialog(); openLibraryPicker() })
    const sys = dirBtn('', t(curLang, 'pickd.system'), t(curLang, 'pickd.systemHint'), 'folder')
    sys.addEventListener('click', () => { sysPassthrough = true; closeFsDialog(); try { pickLibBtn.click() } catch {} })
    wrap.appendChild(front); wrap.appendChild(sys)
    return wrap
  }
  /** 打开库目录对话框：先探 `/api/fs/roots`，据此选 server 模式还是 fallback 模式。 */
  async function openLibDirDialog() {
    closeFsDialog('reopen')                  // 单例不变式：同时只许一个 `.bench-dirbox`
    try { closeDirPicker() } catch { /* 另一套选择器没开 */ }
    const gen = fsSeq + 1                    // 本次打开的代际（下面的响应只许画这一代）
    let roots = { ok: false, roots: [] }
    let routesOk = false
    if (apiStatus === 200) {
      try {
        const r = await fsJson('/api/fs/roots', { headers: { accept: 'application/json' } })
        routesOk = r.ok && !!(r.body && r.body.ok !== false && Array.isArray(r.body.roots))
        roots = fsRootsPlan(r.body)
      } catch { routesOk = false }
    }
    const plan = dirDialogPlan(routesOk, apiStatus === 200)
    if (gen !== fsSeq + 1 && fsDialog) return plan      // 期间又被打开/关掉了 ⇒ 本次作废（不留第二个框）
    buildFsDialog(plan, roots)
    if (plan.ok) {
      const start = (roots.roots[0] && roots.roots[0].path) || ''
      if (start) navigateFs(start)
      else fsSetState(fsDialog, 'error', { message: t(curLang, 'pickd.noStart') })
    }
    return plan
  }
  function buildFsDialog(plan, roots, opts) {
    /* ②(2026-09-24 用户第 2 条) 同一个对话框两种模式：`dir`（选库根，旧行为）与 `file`（选服务端文件）。
       两种模式**用同一棵浏览树、同一批路由**（`/api/fs/roots` + `/api/fs/list` + `/api/fs/file`）。 */
    const pickFileMode = !!(opts && opts.mode === 'file')
    const pickFileCb = (opts && typeof opts.onPick === 'function') ? opts.onPick : null
    const box = dirMk('div', 'bench-dirbox'); box.id = 'bench-fs-dialog'
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true')
    box.dataset.mode = pickFileMode ? 'file' : 'dir'
    const win = dirMk('div', 'bench-dirbox-win')
    const head = dirMk('div', 'bench-dirbox-head')
    const title = dirMk('strong', 'bench-dirbox-title', t(curLang, pickFileMode ? 'pick.fileTitle' : 'pickd.title'))
    const xBtn = dirBtn('bench-dirbox-x', '', t(curLang, 'picker.cancel'), 'x')
    xBtn.addEventListener('click', closeFsDialog)
    head.appendChild(title); head.appendChild(xBtn)
    const pathEl = dirMk('div', 'bench-dirbox-path', t(curLang, 'pickd.loading'))
    const note = dirMk('div', 'bench-dirbox-note', t(curLang, plan.noticeKey))
    note.id = 'bench-fs-note'
    const tools = dirMk('div', 'bench-dirbox-tools')
    const up = dirBtn('', t(curLang, 'pickd.up'), t(curLang, 'pickd.up'), 'up')
    const filter = dirMk('input', 'bench-dirbox-filter')
    filter.setAttribute('type', 'search'); filter.setAttribute('placeholder', t(curLang, 'pick.filterPh'))
    tools.appendChild(up); tools.appendChild(filter)
    if (plan.ok && roots.roots.length) {
      const chips = dirMk('div', 'bench-dirbox-tools bench-dirbox-roots')   // ① 可折行 + 可滚（见 BENCH_PICK_CSS）
      const lab = dirMk('span', 'bench-dirbox-count', t(curLang, 'pickd.roots'))
      chips.appendChild(lab)
      for (const r of roots.roots) {
        const b = dirBtn('', r.label, r.path, 'folder')
        b.dataset.path = r.path
        if (!r.listable) {
          // 服务端明确说这个根**不可列**（默认 home）⇒ 灰显 + 把原因写进 title/notes，别让用户点了没反应
          b.disabled = true
          b.dataset.listable = '0'
          b.title = r.reason || t(curLang, 'pickd.rootLocked')
          b.setAttribute('aria-disabled', 'true')
        } else b.dataset.listable = '1'
        b.addEventListener('click', () => { if (r.listable) navigateFs(r.path) })
        chips.appendChild(b)
      }
      win.appendChild(head); win.appendChild(pathEl); win.appendChild(note); win.appendChild(chips)
    } else {
      win.appendChild(head); win.appendChild(pathEl); win.appendChild(note)
    }
    const list = dirMk('div', 'bench-dirbox-list'); list.id = 'bench-fs-list'
    list.setAttribute('tabindex', '0')
    /* ②(2026-09-24 用户第 2 条) 行点击：目录 ⇒ 进目录（两种模式都一样）；**文件** ⇒ 只在 file 模式可选中。 */
    list.addEventListener('click', (ev) => {
      const row = ev && ev.target && ev.target.closest ? ev.target.closest('.bench-dirbox-row') : null
      if (!row || !row.dataset) return
      if (row.dataset.type === 'dir') { navigateFs(row.dataset.path); return }
      if (row.dataset.type !== 'file' || !pickFileMode) return
      fsSelectFile(row.dataset.path, row.dataset.name, row)
    })
    list.addEventListener('dblclick', (ev) => {
      const row = ev && ev.target && ev.target.closest ? ev.target.closest('.bench-dirbox-row') : null
      if (!row || !row.dataset || row.dataset.type !== 'file' || !pickFileMode) return
      fsSelectFile(row.dataset.path, row.dataset.name, row)
      fsConfirm()                                   // 双击 = 直接选用
    })
    const foot = dirMk('div', 'bench-dirbox-foot')
    const count = dirMk('span', 'bench-dirbox-count', '')
    count.id = 'bench-fs-count'
    foot.appendChild(count)
    let confirmBtn = null
    if (plan.ok) {
      confirmBtn = dirBtn('bench-dirbox-go', '', '', 'check')
      const lab = dirMk('span', '', t(curLang, pickFileMode ? 'pick.thisFile' : 'pickd.here'))
      confirmBtn.appendChild(lab)
      confirmBtn.id = 'bench-fs-confirm'
      confirmBtn.disabled = true          // 列表读成功之前不可点（"就选这个目录"只对**读到的**目录生效）
      confirmBtn.addEventListener('click', () => fsConfirm())
      foot.appendChild(confirmBtn)
    }
    const cancelBtn = dirBtn('bench-dirbox-go bench-dirbox-go2', t(curLang, 'picker.cancel'))
    cancelBtn.addEventListener('click', () => closeFsDialog('cancel'))
    foot.appendChild(cancelBtn)
    win.appendChild(tools); win.appendChild(list); win.appendChild(fsFallbackButtons()); win.appendChild(foot)
    box.appendChild(win)
    box.addEventListener('mousedown', (ev) => { if (ev && ev.target === box) closeFsDialog('backdrop') })
    doc.body.appendChild(box)
    const onKey = (ev) => {
      if (!ev) return
      if (ev.key === 'Escape') { try { ev.preventDefault() } catch {} ; closeFsDialog('escape') }
      if (ev.key === 'Enter' && plan.ok && confirmBtn && !confirmBtn.disabled) { try { ev.preventDefault() } catch {} ; confirmBtn.click() }
    }
    try { doc.addEventListener('keydown', onKey) } catch {}
    fsDialog = { box, pathEl, list, count, note, filter, confirmBtn, onKey, roots: roots.roots, rows: [], gen: ++fsSeq, loaded: false, pending: false, path: '', lastErr: '', loadMs: -1, mode: pickFileMode ? 'file' : 'dir', pickedPath: '', pickedName: '', onPickFile: pickFileCb }
    fsSetState(fsDialog, plan.ok ? 'idle' : 'degraded', {})
    filter.addEventListener('input', () => paintFsRows())
    up.addEventListener('click', () => { const p = pathEl.dataset.parent || ''; if (p) navigateFs(p) })
    try { if (box.focus) box.focus({ preventScroll: true }) } catch {}
    return fsDialog
  }
  /** ②(2026-09-24 用户第 2 条) 选中一个**服务端文件**（file 模式）：写 UI 状态 + 刷新确认键可用性。
   *  权限由服务端把关（`/api/fs/file`/`/api/fs/list` 同一套 `assertBrowsePath`）：这里不做任何本地推断。 */
  function fsSelectFile(path, name, row) {
    const ui = fsDialog
    if (!ui || ui.mode !== 'file') return null
    ui.pickedPath = String(path || '')
    ui.pickedName = String(name || '')
    try {
      for (const el of ui.list.querySelectorAll('.bench-dirbox-row')) {
        if (el && el.classList) el.classList.toggle('sel', el === row || String(el.dataset.path || '') === ui.pickedPath)
      }
    } catch { /* 桩 DOM */ }
    if (ui.confirmBtn) ui.confirmBtn.disabled = !ui.pickedPath
    if (ui.note) ui.note.textContent = t(curLang, 'pickd.selected', { path: ui.pickedPath })
    fsLastResult = { pickedFile: ui.pickedPath, name: ui.pickedName, dir: ui.path, readOnly: true }
    return ui.pickedPath
  }
  /** 确认键：dir 模式 ⇒ 选当前目录为库根（旧行为）；file 模式 ⇒ 把选中的服务端文件交给调用方。 */
  function fsConfirm() {
    const ui = fsDialog
    if (!ui || !ui.loaded) return null
    if (ui.mode === 'file') {
      if (!ui.pickedPath) return null
      const res = { path: ui.pickedPath, name: ui.pickedName, dir: ui.path, mode: 'server' }
      const cb = ui.onPickFile
      try { closeFsDialog('picked-file') } catch { /* 桩 DOM */ }
      if (typeof cb === 'function') { try { return cb(res) } catch (e) { logLine(String((e && e.message) || e), true) } }
      return res
    }
    const cur = (ui.loaded && ui.pathEl.dataset.path) || ''
    if (cur) applyLibDir(cur, { note: ui.note })
    return cur
  }
  /** 画列表。加载中就把"正在读哪个目录"写出来（不再只留一句 Reading… —— 读不出结果时也要看得见目标）。 */
  function paintFsRows() {
    const ui = fsDialog
    if (!ui) return 0
    const q2 = String((ui.filter && ui.filter.value) || '').trim().toLowerCase()
    const all = ui.rows || []
    const rows = all.filter((r) => !q2 || r.name.toLowerCase().includes(q2))
    ui.list.textContent = ''
    if (ui.pending) {
      const e = dirMk('div', 'bench-dirbox-empty', t(curLang, 'pickd.loading') + ' ' + String((ui.pathEl.dataset && ui.pathEl.dataset.path) || ''))
      e.dataset.state = 'loading'
      ui.list.appendChild(e)
      ui.count.textContent = t(curLang, 'pick.count', { n: 0 })
      return 0
    }
    if (!rows.length) {
      const e = dirMk('div', 'bench-dirbox-empty', t(curLang, 'pickd.empty'))
      e.dataset.state = 'empty'
      ui.list.appendChild(e)
      ui.count.textContent = t(curLang, 'pick.count', { n: 0 })
      return 0
    }
    for (const r of rows) {
      const row = dirMk('div', 'bench-dirbox-row')
      row.dataset.path = r.path; row.dataset.type = r.type
      row.dataset.name = r.name
      if (ui.mode === 'file' && r.type === 'file') {
        row.dataset.pickable = '1'                 // ② file 模式：文件行**可选**（dir 模式仍然只看目录）
        if (ui.pickedPath && r.path === ui.pickedPath && row.classList) row.classList.add('sel')
      }
      const name = dirMk('span', 'bench-dirbox-name', r.name)
      const sub = dirMk('span', 'bench-dirbox-sub', r.type === 'dir' ? t(curLang, 'pickd.dirTag') : t(curLang, 'pickd.fileTag'))
      row.appendChild(name); row.appendChild(sub)
      ui.list.appendChild(row)
    }
    ui.count.textContent = t(curLang, 'pick.count', { n: rows.length })
    return rows.length
  }
  /** 列一个目录。**代际号 + 超时 + 每步可见状态**：关窗/重开之后回来的响应一律丢弃，
   *  任何失败都落成 `pickd.fail` 的可见文案（绝不留在"Reading…"）。 */
  async function navigateFs(path) {
    const ui = fsDialog
    if (!ui) return null
    const gen = ui.gen
    const want = String(path || '')
    const t0 = (typeof Date !== 'undefined' && Date.now) ? Date.now() : 0
    ui.pending = true; ui.loaded = false; ui.lastErr = ''
    fsSetState(ui, 'loading', { message: t(curLang, 'pickd.loading'), path: want })
    try { if (ui.confirmBtn) ui.confirmBtn.disabled = true } catch { /* 桩 DOM */ }
    paintFsRows()
    let r = null
    try {
      r = await fsJson('/api/fs/list?path=' + encodeURIComponent(want), { headers: { accept: 'application/json' } })
    } catch (e) { r = { status: 0, ok: false, body: null, err: String((e && e.message) || e) } }
    //  过期响应（对话框被关掉/换了一个）⇒ 直接丢弃，既不画也不写日志
    if (!fsDialog || fsDialog !== ui || ui.gen !== gen) return null
    ui.pending = false
    ui.loadMs = t0 ? (Date.now() - t0) : -1
    const j = (r.body && typeof r.body === 'object') ? r.body : {}
    if (!r.ok || j.error) {
      const msg = String(j.error || r.err || ('HTTP ' + r.status))
      ui.lastErr = msg
      ui.rows = []
      fsSetState(ui, 'error', { message: t(curLang, 'pickd.fail', { msg }), path: want })
      paintFsRows()
      logLine(t(curLang, 'pickd.listFail', { path: want, msg }), true)
      return null
    }
    // 只读浏览：文件行也显示（dir 模式灰、不可进入；**file 模式可选**）——用户要看得到"这个目录里有什么"
    const plan2 = fsEntriesPlan({ ok: true, path: j.path || want, parent: j.parent, entries: (j.entries || []).concat(j.files || []) })
    ui.rows = plan2.rows
    ui.path = plan2.path || want
    ui.pathEl.dataset.path = ui.path
    ui.pathEl.dataset.parent = plan2.parent || ''
    ui.loaded = true
    fsSetState(ui, 'ok', { message: ui.path })
    //  换目录 ⇒ 清掉上一次的文件选择（file 模式），确认键回到"要你先选一个文件"
    if (ui.mode === 'file') { ui.pickedPath = ''; ui.pickedName = '' }
    try { if (ui.confirmBtn) ui.confirmBtn.disabled = ui.mode === 'file' ? true : false } catch { /* 桩 DOM */ }
    paintFsRows()
    return plan2
  }
  /** ②(用户第 2 条) 从**服务端**取一个文件的字节（同一个浏览树/同一份白名单：越界由服务端如实 403）。
   *  返回浏览器 `File` 对象（与 `<input type=file>` 那条路同形 ⇒ 预览链一行不改）。
   *  **单次**请求（大包只下载一遍）：先看状态码，非 2xx 就读服务端的错误体当原因，绝不把错误页当文件。 */
  async function serverFileAsFile(path) {
    const r = await fetch('/api/fs/file?path=' + encodeURIComponent(path))
    if (!r || !r.ok) {
      let msg = 'HTTP ' + ((r && r.status) || 0)
      try { const j = await r.json(); if (j && j.error) msg = String(j.error) } catch { /* 非 JSON */ }
      throw new Error(msg)
    }
    const blob = await r.blob()
    const name = String(path || '').split(/[\\/]/).pop() || 'file.bin'
    const FileCtor = (typeof File === 'function') ? File : null
    if (FileCtor) return new FileCtor([blob], name, { type: blob.type || 'application/octet-stream' })
    try { blob.name = name } catch { /* 只读属性 */ }
    return blob
  }
  async function previewPickedFile(res) {
    const dir = res.dir || ''
    const find = (rx) => (pickIndex ? pickIndex.files.filter((f) => f.dir === dir && rx.test(f.name))[0] : null)
    /* ①(P-261 2026-10-07) 浏览器「选择文件」**也接受 `.mpkg`/`.pkg` 容器**（此前只认 `scene.pkg` ⇒
       选一个 mpkg 直接落到 `local.sceneOnly`"仅支持 scene 包预览"的报错文案）。容器交给渲染器的
       `loadSceneFile(blob)` 按内容判（scene.json → 场景；PKGM0014 → 纯视频）。 */
    const pkgEntry = (/^scene\.pkg$/i.test(res.name) || /\.(mpkg|pkg)$/i.test(res.name)) ? res : find(/^scene\.pkg$/i)
    const projEntry = /^project\.json$/i.test(res.name) ? res : find(/^project\.json$/i)
    const pkg = await dirFileOf(pkgEntry)
    if (!pkg) { logLine(t(curLang, 'local.sceneOnly'), true); return false }
    let meta = {}
    const proj = await dirFileOf(projEntry)
    if (proj && typeof proj.text === 'function') { try { meta = JSON.parse(await proj.text()) || {} } catch { /* 坏 project.json 忽略 */ } }
    const dirName = dir ? dir.split('/').pop() : res.name
    previewLocal({
      dir: dir || res.path, id: dir || res.path, title: String(meta.title || dirName),
      kind: detectWallpaperKind(meta, [pkg.name || res.name]) || 'unknown',
      pkg: pkg, proj: proj, preview: null,
      properties: (meta.general && meta.general.properties) || null,
    })
    return true
  }
  async function onSidebarFilePicked(res) {
    if (!res) return
    logLine(t(curLang, 'local.filePicked', { name: res.path }))
    const ok = await previewPickedFile(res)
    if (!ok) logLine(t(curLang, 'local.sceneOnly'), true)
  }
  /* ②(2026-09-24 用户第 2 条) **服务端**文件选择：'选择文件' 与 '选择文件夹' 走**同一个**浏览 API/同一个弹窗，
     文件字节由 `GET /api/fs/file` 取回（服务端同一份允许根清单把关，越界如实 403）。
     选中的文件按"它所在的壁纸目录"预览 —— 与浏览器那条路（`previewPickedFile`）**同一个预览链** `previewLocal`。 */
  async function previewServerPickedFile(res) {
    const full = String((res && res.path) || '')
    const name = String((res && res.name) || full.split('/').pop() || '')
    const dir = full.replace(/[\\/][^\\/]*$/, '')
    const isPkg = /^(scene\.pkg|gifscene\.pkg)$/i.test(name) || /\.(pkg|mpkg)$/i.test(name)
    const isProj = /^project\.json$/i.test(name)
    //  同目录里补齐另一半（scene.pkg ↔ project.json）：只读列目录（同一个 /api/fs/list）
    let sib = null
    try {
      const r = await fsJson('/api/fs/list?path=' + encodeURIComponent(dir), { headers: { accept: 'application/json' } })
      if (r.ok && r.body && Array.isArray(r.body.entries)) sib = r.body.entries
    } catch { sib = null }
    const sibPath = (rx) => { const hit = (sib || []).find((e) => e && e.type === 'file' && rx.test(String(e.name || ''))); return hit ? String(hit.path) : '' }
    const pkgPath = isPkg ? full : sibPath(/^(scene\.pkg|gifscene\.pkg)$/i)
    const projPath = isProj ? full : sibPath(/^project\.json$/i)
    if (!pkgPath) { logLine(t(curLang, 'local.sceneOnly'), true); return false }
    let pkg = null, proj = null
    try { pkg = await serverFileAsFile(pkgPath) } catch (e) { logLine(t(curLang, 'err.pickFile', { msg: String((e && e.message) || e) }), true); return false }
    if (projPath) { try { proj = await serverFileAsFile(projPath) } catch { proj = null } }
    let meta = {}
    if (proj && typeof proj.text === 'function') { try { meta = JSON.parse(await proj.text()) || {} } catch { /* 坏 project.json 忽略 */ } }
    const dirName = dir.split(/[\\/]/).pop() || name
    previewLocal({
      dir, id: dir, title: String(meta.title || dirName),
      kind: detectWallpaperKind(meta, [pkg.name || name]) || 'unknown',
      pkg, proj, preview: null,
      properties: (meta.general && meta.general.properties) || null,
    })
    fsLastResult = { pickedFile: full, name, dir, previewed: true, pkgBytes: Number(pkg.size) || null, readOnly: true }
    return true
  }
  /** ② 打开"服务端文件浏览"对话框（与选文件夹同一个 `#bench-fs-dialog`，模式 = file）。 */
  async function openFsFileDialog(opts) {
    const o = opts || {}
    closeFsDialog('reopen')
    try { closeDirPicker() } catch { /* 另一套选择器没开 */ }
    let roots = { ok: false, roots: [] }
    let routesOk = false
    if (apiStatus === 200) {
      try {
        const r = await fsJson('/api/fs/roots', { headers: { accept: 'application/json' } })
        routesOk = r.ok && !!(r.body && r.body.ok !== false && Array.isArray(r.body.roots))
        roots = fsRootsPlan(r.body)
      } catch { routesOk = false }
    }
    const plan = dirDialogPlan(routesOk, apiStatus === 200)
    if (!plan.ok) return null                      // 没有后端 ⇒ 调用方退回纯前端选择器（并如实写日志）
    buildFsDialog(plan, roots, { mode: 'file', onPick: o.onPick })
    const start = (roots.roots[0] && roots.roots[0].path) || ''
    if (start) navigateFs(start)
    return plan
  }
  function openFilePickerFlow() {
    // ②(用户第 2 条) **有后端就用服务端浏览**：与「选择文件夹」同一个弹窗、同一批 `/api/fs/*` 路由，
    //   选的是**这台机器上**的文件（不再受浏览器"必须先授权目录"的限制）。
    //   没有后端（静态托管）才退回纯前端选择器 —— 并在日志里说清是哪一种，不假装。
    if (apiStatus === 200) {
      openFsFileDialog({ onPick: (res) => previewServerPickedFile(res) })
        .then((plan) => { if (!plan) { logLine(t(curLang, 'pickd.noRoute'), true); clientFilePickerFlow() } })
        .catch((e) => logLine(t(curLang, 'err.pickFile', { msg: String((e && e.message) || e) }), true))
      return true
    }
    return clientFilePickerFlow()
  }
  function clientFilePickerFlow() {
    const kinds = pickerAcceptKinds('')
    // 第七批②：与「选择文件夹」同一个选择器（同款弹窗、文件模式），入口一律先开弹窗；
    // 未授权时同样给说明 + 「打开系统选择器」。
    if (!canPickViaInput() && !canShowDirPicker()) { logLine(t(curLang, 'local.unsupported'), true); return false }
    openDirPicker({ mode: 'file', kinds: kinds, onPick: onSidebarFilePicked })
    return true
  }
  const pickFileBtn = $('#pick-file')
  if (pickFileBtn) {
    pickFileBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopImmediatePropagation(); openFilePickerFlow()
    }, true)
  }
  async function handFileToInput(res) {
    const f = await dirFileOf(res)
    return f
  }
  function openPropsFilePicker(input) {
    const kinds = pickerAcceptKinds(input && input.getAttribute ? input.getAttribute('accept') : '')
    const handToInput = (file) => {
      try {
        // 沿用 bundle 自己的上传链：它给隐藏 input 挂了 onchange（bench.ts:1288 uploadPropFile）
        const DT = (typeof window !== 'undefined') ? window.DataTransfer : null
        if (!DT) throw new Error('DataTransfer unavailable')
        const dt = new DT()
        dt.items.add(file)
        input.files = dt.files
        input.dispatchEvent(new Event('change'))
      } catch (e) {
        logLine(t(curLang, 'err.pickFile', { msg: String((e && e.message) || e) }), true)
      }
    }
    const onPick = async (res) => {
      const file = await handFileToInput(res)
      if (!file) { logLine(t(curLang, 'err.pickFile', { msg: 'no-file-handle' }), true); return }
      handToInput(file)
    }
    //  ②(用户第 2 条) 有后端 ⇒ 服务端浏览（同一棵浏览树）；文件由 `/api/fs/file` 取回再喂给隐藏 input。
    if (apiStatus === 200) {
      openFsFileDialog({
        onPick: async (res) => {
          try { handToInput(await serverFileAsFile(res.path)) } catch (e) { logLine(t(curLang, 'err.pickFile', { msg: String((e && e.message) || e) }), true) }
        },
      }).then((plan) => { if (!plan) clientPropsFilePicker(kinds, onPick) })
      return true
    }
    return clientPropsFilePicker(kinds, onPick)
  }
  /** ② 没有后端（静态托管）时的**兜底**：纯前端选择器 / 浏览器目录授权（旧路径，一字不改）。 */
  function clientPropsFilePicker(kinds, onPick) {
    if (pickIndex) { openDirPicker({ mode: 'file', kinds: kinds, onPick: onPick }); return true }
    if (!canPickViaInput() && !canShowDirPicker()) return false
    return pickLocalFolder({ onEntries: (entries) => {
      if (!entries) return
      grantPickerIndex(entries)
      openDirPicker({ mode: 'file', kinds: kinds, onPick: onPick })
    } })
  }
  const propsBodyEl = $('#props-body')
  if (propsBodyEl) {
    // 捕获阶段：抢在 bundle 的 `pick.onclick = () => file.click()` 之前把手写选择器换上。
    // 目录型属性（.prop-file 里没有 input.prop-file-input）不拦：它的值必须是绝对路径，
    // 只有宿主侧流程（/api/props-dir）能给，网页里的相对路径写进去反而更坏。
    propsBodyEl.addEventListener('click', (ev) => {
      const target = ev && ev.target
      const btn = (target && typeof target.closest === 'function') ? target.closest('.prop-pick') : null
      if (!btn) return
      const row = (typeof btn.closest === 'function') ? btn.closest('.prop-file') : null
      const input = row ? row.querySelector('input.prop-file-input') : null
      if (!input) return
      try { ev.preventDefault(); ev.stopImmediatePropagation() } catch { /* 合成事件 */ }
      openPropsFilePicker(input)
    }, true)
  }

  // ── C 组 1/4：自绘 HSV 取色盘（移植 client.js:6654-6760 的结构与数学）──
  //   挂载点：① 工具条 `#trail-color`（静态托管下**当场可见可验**）② 属性面板的颜色项
  //   （bundle bench.ts:1519 `input[type=color]`，需本机后端才有内容 —— MutationObserver 自动接管）。
  let pickerEl = null, pickerCleanup = null
  const closePicker = () => {
    if (typeof pickerCleanup === 'function') { try { pickerCleanup() } catch {} }
    if (pickerEl) { try { pickerEl.remove() } catch {} }
    pickerEl = null; pickerCleanup = null
  }
  function openColorPicker(anchor, currentHex, onPick) {
    closePicker()                                    // 先清理旧实例的全局监听（插件同款纪律）
    const start = normalizeHex(currentHex) || '#7dd3fc'
    let { h, s: sat, v } = hexToHsv(start)
    const wrap = doc.createElement('div')
    wrap.className = 'bench-picker glass'
    wrap.setAttribute('role', 'dialog')
    const title = doc.createElement('div'); title.className = 'bench-picker-title'; title.textContent = t(curLang, 'picker.title')
    const hue = doc.createElement('div'); hue.className = 'bench-picker-hue'
    const hueDot = doc.createElement('div'); hueDot.className = 'bench-picker-dot'; hue.appendChild(hueDot)
    const sv = doc.createElement('div'); sv.className = 'bench-picker-sv'
    const svDot = doc.createElement('div'); svDot.className = 'bench-picker-dot'; sv.appendChild(svDot)
    const row = doc.createElement('div'); row.className = 'bench-picker-row'
    const prev = doc.createElement('div'); prev.className = 'bench-picker-preview'
    const hexIn = doc.createElement('input'); hexIn.className = 'bench-picker-hex'; hexIn.value = start
    const hint = doc.createElement('div'); hint.className = 'bench-picker-hint'; hint.textContent = t(curLang, 'picker.hint')
    const actions = doc.createElement('div'); actions.className = 'bench-picker-actions'
    const okBtn = doc.createElement('button'); okBtn.type = 'button'; okBtn.className = 'primary'; okBtn.textContent = t(curLang, 'picker.ok')
    const cancelBtn = doc.createElement('button'); cancelBtn.type = 'button'; cancelBtn.textContent = t(curLang, 'picker.cancel')
    row.appendChild(prev); row.appendChild(hexIn)
    actions.appendChild(okBtn); actions.appendChild(cancelBtn)
    wrap.appendChild(title); wrap.appendChild(hue); wrap.appendChild(sv); wrap.appendChild(row); wrap.appendChild(hint); wrap.appendChild(actions)
    doc.body.appendChild(wrap)
    // 定位到锚点下方（越界则上移）
    const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: 20, top: 60, bottom: 84 }
    wrap.style.left = Math.max(8, Math.min(r.left, innerWidth - 224)) + 'px'
    wrap.style.top = Math.max(8, Math.min(r.bottom + 6, innerHeight - 260)) + 'px'
    const curHex = () => hsvToHex(h, sat, v)
    const paint = () => {
      wrap.style.setProperty('--bench-hue', hsvToHex(h, 1, 1))
      const hx = curHex()
      prev.style.background = hx
      if (doc.activeElement !== hexIn) hexIn.value = hx
      hueDot.style.left = (h / 360 * 100) + '%'; hueDot.style.top = '50%'
      svDot.style.left = (sat * 100) + '%'; svDot.style.top = ((1 - v) * 100) + '%'
    }
    const drag = (el, fn) => {
      const at = (ev) => { const b = el.getBoundingClientRect(); fn((ev.clientX - b.left) / Math.max(1, b.width), (ev.clientY - b.top) / Math.max(1, b.height)) }
      const down = (ev) => { ev.preventDefault(); at(ev); const mv = (e2) => at(e2), up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up) }; addEventListener('mousemove', mv); addEventListener('mouseup', up) }
      el.addEventListener('mousedown', down)
      return down
    }
    drag(hue, (x) => { h = pickerFromPointer(x, sat, 1 - v).h; paint() })
    drag(sv, (x, y) => { const q = pickerFromPointer(0, x, y); sat = q.s; v = q.v; paint() })
    hexIn.addEventListener('input', () => { const nx = normalizeHex(hexIn.value); if (nx) { const q = hexToHsv(nx); h = q.h; sat = q.s; v = q.v; paint() } })
    const commit = () => { const hx = curHex(); closePicker(); try { onPick(hx) } catch (e) { logLine(String(e && e.message), true) } }
    okBtn.addEventListener('click', commit)
    cancelBtn.addEventListener('click', closePicker)
    hexIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') closePicker() })
    const onDocDown = (e) => { if (!wrap.contains(e.target) && e.target !== anchor) closePicker() }   // 点空白收回（A6 同款交互）
    const onKey = (e) => { if (e.key === 'Escape') closePicker() }
    doc.addEventListener('mousedown', onDocDown, true)
    doc.addEventListener('keydown', onKey)
    pickerCleanup = () => { doc.removeEventListener('mousedown', onDocDown, true); doc.removeEventListener('keydown', onKey) }
    pickerEl = wrap
    paint()
    return wrap
  }
  // 让一个 input[type=color] 改用自绘取色盘（原生仍保留语义，只被我们的浮窗替代交互）
  function attachPicker(input) {
    if (!input || input.dataset.benchPicker === '1') return
    input.dataset.benchPicker = '1'
    if (input.parentNode) input.parentNode.classList.add('bench-color-host')
    const fire = (hx) => {
      input.value = hx
      input.dispatchEvent(new Event('input', { bubbles: true }))    // bundle 的 oninput → changeProp / 尾迹颜色
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }
    input.addEventListener('click', (e) => {
      e.preventDefault()
      openColorPicker(input, input.value, fire)
    })
  }
  attachPicker($('#trail-color'))
  const propsBody = $('#props-body')
  if (propsBody) {
    const scan = () => { for (const el of propsBody.querySelectorAll('input[type="color"]')) attachPicker(el) }
    scan()
    new MutationObserver(scan).observe(propsBody, { childList: true, subtree: true })   // 属性面板颜色项（需后端）
  }

  // ── C 组 2/4：剪贴板（http 与 file:// 都能用：API → execCommand → 手动兜底）──
  function copyText(text, label) {
    const plan = clipboardPlan({
      hasClipboardApi: !!(navigator.clipboard && navigator.clipboard.writeText),
      isSecureContext: typeof isSecureContext === 'boolean' ? isSecureContext : true,
      hasExecCommand: typeof doc.execCommand === 'function',
    })
    const manual = () => {
      const box = doc.createElement('div'); box.className = 'bench-copy-fallback glass'
      const inp = doc.createElement('input'); inp.value = String(text)
      const note = doc.createElement('div'); note.textContent = t(curLang, 'copy.manual')
      box.appendChild(inp); box.appendChild(note); doc.body.appendChild(box)
      inp.focus(); inp.select()
      setTimeout(() => box.remove(), 12000)
      logLine(t(curLang, 'copy.manual'))
    }
    try {
      if (plan === 'api') { navigator.clipboard.writeText(String(text)).then(() => logLine(t(curLang, 'copy.ok')), manual); return plan }
      if (plan === 'execCommand') {
        const ta = doc.createElement('textarea'); ta.value = String(text)
        ta.style.cssText = 'position:fixed;left:-9999px;top:0'
        doc.body.appendChild(ta); ta.select()
        const ok = doc.execCommand('copy'); ta.remove()
        if (ok) { logLine(t(curLang, 'copy.ok')); return plan }
      }
      manual(); return 'manual'
    } catch (e) { logLine(t(curLang, 'copy.fail', { msg: String(e && e.message) }), true); manual(); return 'manual' }
  }
  const copyLogsBtn = $('#copy-logs')
  // ⑥(P-158) 复制/清空按**当前页签**取文本：输出页签 = `#logbody`，诊断页签 = `#diag-body`。
  //   复制失败仍然走 `copyText()` 的三级兜底（clipboard API → execCommand → 「手动复制」提示，
  //   文案就是本仓既有的 `copy.manual`），两种态都在。
  if (copyLogsBtn) copyLogsBtn.addEventListener('click', () => {
    const plan = logsViewPlan(logsView)
    const el = $(plan.copySelector)
    copyText((el && el.textContent) || '', plan.view)
  })
  /* ②(2026-09-20 用户第 2 条 · 用户实测「清空按钮清不掉调试模式日志」)
     真因（一行判据）：原来是 `if (el && (plan.isDiag || !el.textContent)) el.textContent = ''` ——
     调试视图下 `plan.isDiag === false`，于是只有当 `#dbg-log` **本来就是空的**才清
     ⇒ 非空的调试日志**永远清不掉**（判据自己把自己锁死）。输出视图那条是产物自己清的，与它无关。
     修法：按**当前视图**清该视图那块文本 + 它自己的行缓冲，并各写一条"已清空"系统行：
       · 输出视图 `#logbody`
       · 诊断视图 `#diag-body` + `diagCount` 归零（页签计数跟着走）
       · 调试视图 `#dbg-log` + `dbgLines` 环形缓冲一起清（否则下一次重画会"复活"旧行）
     三个视图是三个存储位置，清完各自留一行"已清空" ⇒ 门禁可判"清空之后只剩这一行"。 */
  function clearNoticeText() { return t(curLang, 'logs.cleared', { view: t(curLang, logsView === 'diag' ? 'logs.tabDiag' : (logsView === 'debug' ? 'logs.debug' : 'logs.head')) }) }
  function clearLogsView() {
    const view = logsView
    if (view === 'diag') {
      if (diagBody) diagBody.textContent = ''
      diagCount = 0
      if (diagBody) {
        const line = doc.createElement('div')
        line.className = 'diag-line'
        line.dataset.source = 'bench'
        line.dataset.sys = 'cleared'
        line.textContent = clearNoticeText()
        diagBody.appendChild(line)
        diagCount = 1
      }
      paintLogsTabs()
      return diagCount
    }
    if (view === 'debug') {
      dbgLines = []                                    // 环形缓冲一起清（只清 DOM 会被下一次重画复活）
      if (dbgLog) dbgLog.textContent = ''
      dbgPush(clearNoticeText())
      try { if (dbgLog && dbgLog.lastElementChild && dbgLog.lastElementChild.dataset) dbgLog.lastElementChild.dataset.sys = 'cleared' } catch { /* 桩 DOM */ }
      return dbgLines.length
    }
    const body = $('#logbody')
    if (body) {
      body.textContent = ''
      const line = doc.createElement('div')
      line.className = 'sys'
      line.dataset.sys = 'cleared'
      line.textContent = clearNoticeText()
      body.appendChild(line)
      /* ⑯b 清空 = 内容重来 ⇒ 跟随复位（不然清完那一刻的"不跟随"会一直留着，新消息全在视野外）。 */
      const k = logKeeper(); if (k) k.resetFollow()
      body.scrollTop = body.scrollHeight
    }
    return body ? body.children.length : 0
  }
  const clearLogsBtn = $('#clear-logs')
  if (clearLogsBtn) clearLogsBtn.addEventListener('click', () => {
    // 产物自己那个处理器清的是 `#logbody`（它先跑，AT_TARGET 按注册顺序）⇒ 这里再按当前视图清一遍。
    try { clearLogsView() } catch { /* 单次失败不影响其它链路 */ }
  })
  const copyUrlBtn = $('#copy-url')
  if (copyUrlBtn) copyUrlBtn.addEventListener('click', () => copyText(location.href, 'url'))

  // ── C 组 3/4：AbortController —— 切语言/关页时取消在途请求 + 过期响应不覆盖新状态 ──
  let reqAbort = null
  const abortInflight = () => { if (reqAbort) { try { reqAbort.abort() } catch {} } reqAbort = null }
  const fetchAbortable = (url, init) => {
    abortInflight()
    reqAbort = typeof AbortController === 'function' ? new AbortController() : null
    const o = Object.assign({}, init || {})
    if (reqAbort) o.signal = reqAbort.signal
    const { promise, state } = abortable(fetch(url, o).then((r) => r.status).catch(() => 0), reqAbort && reqAbort.signal)
    return { promise, state }
  }
  // 用可中止版本重探一次诊断端点（原来的裸 fetch 已取消不了）；取消不报错，见 T15
  fetchAbortable('/api/diag-stream', { headers: { Accept: 'text/event-stream' } }).promise.then((r) => {
    if (r.aborted) return
    diagState = diagOfflineState(r.value)
    paintDiag()
  })
  // ⑦ 再问一次 /api/library：200+JSON ⇒ 本机 Node host 在（完整功能）；404/HTML ⇒ 静态托管。
  //    据此决定侧栏"为什么不可用 + 怎么办"的说明。
  //    ⚠ **不能**复用上面的 fetchAbortable：它每次调用都 abort 上一个在途请求，
  //      串起来用会把**诊断探测**掐掉 ⇒ 离线标记永远不出现（本批实测踩到过）。
  //      这里给启动探测一个独立的中止槽（切语言/关页时一起取消即可）。
  let bootCtl = null
  try { bootCtl = typeof AbortController === 'function' ? new AbortController() : null } catch { bootCtl = null }
  const probeStatus = (url, init) => {
    const o = Object.assign({}, init || {})
    if (bootCtl) o.signal = bootCtl.signal
    return abortable(fetch(url, o).then((r) => r.status).catch(() => 0), bootCtl && bootCtl.signal).promise
  }
  probeStatus('/api/library', { headers: { Accept: 'application/json' } }).then((r) => {
    if (r.aborted) return
    apiStatus = Number(r.value) || 0
    paintBackendNote()
    paintDiag()
    // ⑩(P-158) 后端状态刚确定 ⇒ 让外壳重画「当前库来源」那一行（default / user / empty / none 四态）
    try { if (typeof window !== 'undefined' && typeof window.__benchShellRefresh === 'function') window.__benchShellRefresh() } catch { /* 外壳未就绪 */ }
  })

  // ── C 组 4/4（可选）：最小错误兜底 —— error / unhandledrejection → 可见条 + 写输出区 ──
  //   插件里没有现成实现（ErrorBoundary/componentDidCatch 0 命中），这是自写的最小版：
  //   每条错误只报一次，条上显示消息本身（可见性可断言，见 T16）。
  const errBar = $('#bench-errorbar'), errMsg = $('#bench-error-msg'), errClose = $('#bench-error-close')
  const errSeen = new Set()
  function showError(msg) {
    const m = String(msg == null ? '' : msg).slice(0, 300)
    if (errSeen.has(m)) return false
    errSeen.add(m)
    if (errBar && errMsg) {
      const model = errorBannerModel(curLang, m)
      const tEl = $('#bench-error-title'); const nEl = $('#bench-error-note')
      if (tEl) tEl.textContent = model.title
      if (nEl) nEl.textContent = model.note
      errMsg.textContent = model.message
      errBar.removeAttribute('hidden')
    }
    logLine('❌ ' + m, true)
    return true
  }
  if (errClose) errClose.addEventListener('click', () => { if (errBar) errBar.setAttribute('hidden', '') })
  addEventListener('error', (e) => { showError(e && (e.message || (e.error && e.error.message))) })
  addEventListener('unhandledrejection', (e) => { showError(e && e.reason && (e.reason.message || e.reason)) })
  window.__benchPatchShowError = showError     // 自检/断言入口

  // ── ⑨ 鼠标尾迹（最小可用版：只在"指针注入"开启后可用；不抢真实鼠标事件）──
  //   ⚠ 这段与下面的 applyLang/syncAllLabels 曾在一次批量替换里被整段删掉（线上事故），
  //     现在由 bench-patch.test.mjs 的 T17（定义↔调用差集）+ T18（冷启动 smoke）双保险看住。
  const pushEl = $('#pointer-push'), trailOn = $('#trail-on'), veil = $('#pointer-veil'), cv = $('#trail-canvas')
  const lenEl = $('#trail-len'), widEl = $('#trail-w'), colEl = $('#trail-color')
  const trailBox = $('#trail-box')
  let trailPts = [], trailAttached = false, trailCtx = null
  const sizeCanvas = () => {
    if (!cv) return
    const host = veil && veil.parentElement ? veil : cv.parentElement
    if (!host) return
    const r = host.getBoundingClientRect()
    cv.width = Math.max(1, Math.round(r.width)); cv.height = Math.max(1, Math.round(r.height))
    trailCtx = cv.getContext('2d')
  }
  const drawTrail = () => {
    if (!trailCtx || !cv) return
    trailCtx.clearRect(0, 0, cv.width, cv.height)
    const segs = trailSegments(trailPts, { width: widEl ? Number(widEl.value) || 2 : 2, color: colEl ? colEl.value : '#7dd3fc' })
    trailCtx.lineCap = 'round'
    for (const sg of segs) {
      trailCtx.globalAlpha = sg.alpha; trailCtx.strokeStyle = sg.color; trailCtx.lineWidth = sg.width
      trailCtx.beginPath(); trailCtx.moveTo(sg.x0, sg.y0); trailCtx.lineTo(sg.x1, sg.y1); trailCtx.stroke()
    }
    trailCtx.globalAlpha = 1
  }
  // 只挂在**注入遮罩**上（该遮罩仅在指针注入开启时接收事件）；passive 且不阻止传播/不拦截，
  // bundle 自己的 pointermove 监听照常执行 —— 不抢真实鼠标事件（用户要求）。
  const onVeilMove = (e) => {
    if (!cv || !veil) return
    const r = veil.getBoundingClientRect()
    trailPts.push([e.clientX - r.left, e.clientY - r.top])
    const max = lenEl ? Math.max(2, Math.min(120, Number(lenEl.value) || 24)) : 24
    if (trailPts.length > max) trailPts.splice(0, trailPts.length - max)
    drawTrail()
  }
  const onVeilLeave = () => { trailPts = []; drawTrail() }
  const setTrailAttached = (on) => {
    if (!veil) return
    if (on && !trailAttached) {
      veil.addEventListener('pointermove', onVeilMove, { passive: true })
      veil.addEventListener('pointerleave', onVeilLeave, { passive: true })
      trailAttached = true; sizeCanvas(); drawTrail()
    } else if (!on && trailAttached) {
      veil.removeEventListener('pointermove', onVeilMove)
      veil.removeEventListener('pointerleave', onVeilLeave)
      trailAttached = false; trailPts = []; drawTrail()
    }
  }
  const trailGate = () => {
    const injection = !!(pushEl && pushEl.checked)
    const canTrail = injection && !!(trailOn && trailOn.checked)
    if (trailOn) {
      trailOn.disabled = !injection                      // 未开启注入 → 置灰
      if (trailBox) {
        if (injection) trailBox.removeAttribute('data-gated'); else trailBox.setAttribute('data-gated', '')
        trailBox.title = injection ? t(curLang, 'trail.tip') : t(curLang, 'trail.needInjection')
      }
    }
    for (const el of [lenEl, widEl, colEl]) if (el) el.disabled = !canTrail
    if (cv) { if (canTrail) cv.removeAttribute('hidden'); else cv.setAttribute('hidden', '') }
    setTrailAttached(canTrail)
  }
  if (pushEl) pushEl.addEventListener('change', () => setTimeout(trailGate, 0))
  if (trailOn) trailOn.addEventListener('change', trailGate)
  for (const el of [lenEl, widEl, colEl]) if (el) el.addEventListener('input', drawTrail)
  addEventListener('resize', () => { if (trailAttached) { sizeCanvas(); drawTrail() } })

  // ── 第五批 ①~④：指针归中 / 时间层锁 / 壁纸品牌 / 拖动开关（开关见 readPatchFlags）──
  //   共同前提：渲染器是**同源 iframe**（#frame → /WEwebLoader/renderer/index.html；P-127 前的
  //   minified 产物里写着旧名 /wallpaper-engine-webgl/renderer/index.html，运行期改写两个前缀都认），
  //   所以父页能拿到它的 window（跨源时下面每个 try 都会安全失败，功能静默关闭而不是抛错）。
  const FLAGS = readPatchFlags(typeof location !== 'undefined' ? location.search : '')
  const frameEl = $('#frame')
  const stageEl = $('#stage') || $('#stage-slot')
  const rendererWin = () => { try { const w = frameEl && frameEl.contentWindow; return w && w.__wp ? w : null } catch { return null } }
  const rendererApi = () => { const w = rendererWin(); return w ? w.__wp : null }

  /* ══ ⑥(2026-09-24 用户第 6 条) 预览框**首帧之前不显示**（"切壁纸时先闪一下 8899 整页"的收口）════════
     真机序列：切壁纸 → 右侧预览框出现"带控制台的整页样式"约 1 秒 → 黑屏 → 才出壁纸。
     两道防线（缺一不可，互为兜底）：
       ① **服务端**：本仓档的渲染器 URL 带 `?shell=0` ⇒ 服务端注入"藏掉页面外壳 + 转黑底"的样式
          （见 server/we-scene-demo-server.mjs 的 `injectShellShim`）——页面外壳**根本不会画出来**；
       ② **客户端（本块）**：只要这次挂载是"带 `shell=0` 的本仓入口"，就在画布上盖一层**黑幕**
          （`#bench-frame-veil`），等渲染器把**首帧**报上来（`postMessage {type:'mpw-first-frame'}`，
          或同源读 `documentElement.dataset.mpwFrame === '1'`）才揭开。
     读数（`__benchPatch.frameProbe()`）：armed / veilVisible / firstFrameAt / 时间线 events[]，
     探针在切换过程中按固定时间点采样就能证明"外壳可见期一帧都没有"。
     纪律：上游档（产物页）**不加** `shell=0` 也不挂黑幕 —— 那条路一个字节都不动。 */
  const frameGate = (() => {
    const st = { armed: false, veil: null, firstFrameAt: 0, events: [], timeouts: 0, shellUrl: false, lastSrc: '' }
    const nowMs = () => (typeof Date !== 'undefined' && Date.now) ? Date.now() : 0
    const push = (ev, extra) => { st.events.push(Object.assign({ at: nowMs(), ev }, extra || {})); if (st.events.length > 40) st.events.shift() }
    function ensureVeil() {
      if (st.veil && st.veil.parentNode) return st.veil
      const D = (typeof document !== 'undefined') ? document : null
      const host = (frameEl && frameEl.parentNode) || stageEl
      if (!D || !host) return null
      try { if (host.style && !host.style.position) host.style.position = 'relative' } catch { /* 桩 DOM */ }
      const v = D.createElement('div')
      v.id = 'bench-frame-veil'
      v.setAttribute('aria-hidden', 'true')
      try {
        v.style.cssText = 'position:absolute;inset:0;z-index:6;background:#000;pointer-events:none;'
          + 'transition:opacity .08s linear;opacity:1'
      } catch { /* 桩 DOM */ }
      host.appendChild(v)
      st.veil = v
      return v
    }
    function show() { const v = ensureVeil(); if (!v) return false; try { v.style.opacity = '1'; v.style.visibility = 'visible' } catch { /* 桩 DOM */ } return true }
    function hide() { const v = st.veil; if (!v) return false; try { v.style.opacity = '0' } catch { /* 桩 DOM */ } ; return true }
    /** 武装：`src` 是**带 shell=0 的本仓入口**才挂黑幕（其它档一律不动）。 */
    function arm(src) {
      const s = String(src || '')
      st.lastSrc = s
      const isShell = /[?&]shell=0(&|$)/.test(s) && /(^|\/)webloader\//.test(s)
      st.shellUrl = isShell
      if (!isShell) { st.armed = false; push('skip-not-shell-url'); return false }
      st.armed = true; st.firstFrameAt = 0
      show(); push('arm')
      /*  ⑥ 客户端兜底：新一次挂载**当场**把开发外壳的 CSS 注入进去（不等 `__wp`、不等 load）。
          服务端 `?shell=0` 已经把外壳藏了；这一条是"服务端没跟上（旧页面/被缓存/上游档）"时的第二道防线。 */
      try { if (typeof applyRepoChromeHide === 'function') { const ok = applyRepoChromeHide(); push(ok ? 'chrome-hide-injected' : 'chrome-hide-pending') } } catch { push('chrome-hide-failed') }
      try { if (frameEl && frameEl.contentDocument) frameEl.contentDocument.addEventListener('DOMContentLoaded', () => { try { applyRepoChromeHide() } catch { /* 已注入 */ } }, { once: true }) } catch { /* 跨源/桩 */ }
      return true
    }
    /** 收到首帧：揭开并记时刻（幂等）。 */
    function firstFrame(from) {
      if (!st.armed) return false
      if (st.firstFrameAt) return false
      st.firstFrameAt = nowMs()
      hide(); push('first-frame', { from: String(from || 'message') })
      return true
    }
    function probe() {
      const vis = (() => { try { return st.veil ? String(st.veil.style.opacity) !== '0' && String(st.veil.style.visibility) !== 'hidden' : false } catch { return false } })()
      let docFlag = null
      try { docFlag = (frameEl && frameEl.contentDocument && frameEl.contentDocument.documentElement) ? String(frameEl.contentDocument.documentElement.getAttribute('data-mpw-frame') || '') : null } catch { docFlag = 'cross-origin' }
      return {
        armed: st.armed, veilVisible: vis, veilPresent: !!(st.veil && st.veil.parentNode), firstFrameAt: st.firstFrameAt,
        shellUrl: st.shellUrl, src: st.lastSrc, rendererDocFlag: docFlag, timeouts: st.timeouts, events: st.events.slice(),
      }
    }
    return { st, arm, firstFrame, probe, show, hide, ensureVeil, push }
  })()
  //  首帧消息（同源 iframe 的渲染器页发来；`shell=0` 时才装这段脚本，上游产物页永远不会发）
  try {
    addEventListener('message', (ev) => {
      try {
        if (!ev || !ev.data || ev.data.type !== 'mpw-first-frame') return
        if (frameEl && ev.source && frameEl.contentWindow && ev.source !== frameEl.contentWindow) return
        frameGate.firstFrame('message')
      } catch { /* 跨源/异常载荷：忽略 */ }
    })
  } catch { /* 无 window（桩） */ }
  //  `src` 变化 = 一次新的挂载 ⇒ 重新武装；`load` 兜底（消息可能在监听器之前就发过）
  try {
    if (frameEl && frameEl.addEventListener) {
      const onSrcMaybe = () => {
        const s = String((frameEl.getAttribute && frameEl.getAttribute('src')) || '')
        if (s !== frameGate.st.lastSrc) frameGate.arm(s)
      }
      frameEl.addEventListener('load', () => {
        onSrcMaybe()
        try {
          const d = frameEl.contentDocument
          const flag = d && d.documentElement ? String(d.documentElement.getAttribute('data-mpw-frame') || '') : ''
          if (flag === '1') frameGate.firstFrame('load-flag')
        } catch { /* 跨源 */ }
      })
      if (typeof MutationObserver === 'function') {
        new MutationObserver(onSrcMaybe).observe(frameEl, { attributes: true, attributeFilter: ['src'] })
      }
      frameGate.arm(String(frameEl.getAttribute('src') || ''))     // 页面加载时已经挂好的那次
    }
  } catch { /* 桩 DOM */ }
  /* 兜底：渲染器始终没报首帧（老版本页面 / 脚本被 CSP 拦下）时，最多 12s 后揭开并**如实记数**
     （`timeouts`）；不无限盖着 —— 宁可让用户看到画布，也不让预览永远黑着当"没问题"。 */
  try {
    if (typeof setTimeout === 'function') {
      setTimeout(() => {
        if (frameGate.st.armed && !frameGate.st.firstFrameAt) { frameGate.st.timeouts++; frameGate.hide(); frameGate.push('timeout-reveal') }
      }, 12000)
    }
  } catch { /* 无定时器 */ }

  /* ④(P-164) **移动即转发**：指针注入关掉时，舞台上的鼠标事件落在渲染器 iframe 自己的文档里
     （它自己会收原生事件），但鼠标尾迹这类由注入坐标驱动的东西在 :8902 上只有在按着键时才动 ——
     真机口径是「按住任意键才出尾迹」。这里按「注入遮罩同一条通道」把**普通移动**也推给渲染器
     （`__wp.pushPointer(u, v, e.buttons, mods)`，buttons=0 就是「没按键」），与 :8899 的「移动即触发」对齐。
     两条边界：
       · 舞台上是 **web 档**（渲染器文档里还有一层 iframe，壁纸页自己收原生事件）⇒ **不转发**，
         否则同一份坐标会被投递两次（原生 + 注入），壁纸页会抖；
       · `?pushfwd=0` 一键关掉（与其它补丁开关同形）。 */
  let pushFwdCount = 0
  let pushFwdWhy = ''                    // 最近一次**没转发**的原因（人读/上报用；成功时是 'ok'）
  const pushFwdOn = () => FLAGS.pushfwd !== false
  function stageHasNestedFrame() {
    /* ⚠(2026-09-24 同类根因·顺手真修) 原先调 `frameDoc()` —— 那个常量定义在**另一个函数**里（:2436），
       本函数（init）里拿到的是 `undefined` ⇒ `ReferenceError` 被 catch 吞掉 ⇒ 永远返回 false
       ⇒ 舞台上是 web 档时**照样**转发指针（同一份坐标投递两次，壁纸页会抖）。
       现在用本作用域真正存在的 `frameEl`（init 的 :7357）。 */
    try { const d = (frameEl && frameEl.contentDocument) ? frameEl.contentDocument : null; return !!(d && d.querySelector && d.querySelector('iframe')) } catch { return false }
  }
  function forwardPointerMove(e) {
    if (!e) return false
    const api = rendererApi()
    const r0 = stageEl && stageEl.getBoundingClientRect ? stageEl.getBoundingClientRect() : null
    const plan = pointerForwardPlan({
      enabled: pushFwdOn(),
      hasApi: !!(api && typeof api.pushPointer === 'function'),
      nested: stageHasNestedFrame(),
      inStage: stageHasPoint(e.clientX, e.clientY),
      hasRect: !!(r0 && r0.width > 0 && r0.height > 0),
    })
    if (!plan.forward) return false
    const r = r0
    const u = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))
    const v = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    const mods = (e.ctrlKey ? 1 : 0) | (e.shiftKey ? 2 : 0) | (e.altKey ? 4 : 0) | (e.metaKey ? 8 : 0)
    try { api.pushPointer(u, v, Number(e.buttons) || 0, mods); pushFwdCount++; pushFwdWhy = plan.why; return true } catch { return false }
  }

  // ① 鼠标离开舞台/视口 → 指针回中性位置（中心）+ 清按键；回到画面里自动恢复（真实 mousemove 本来就是唯一坐标源）
  let parked = false
  let parkCount = 0
  let parkPushed = 0                  // ①(P-159) 因"离开"而推活坐标的次数（默认应为 0：只 leave）
  let parkLastPush = null
  function parkPointerNow() {
    const api = rendererApi()
    const act = pointerParkAction({ enabled: FLAGS.ppark, hasApi: !!api, parked, mode: FLAGS.pparkMode })
    if (!act.park) return false
    parked = true
    parkCount++
    // 只清按键、保留最后位置（上游语义）。**默认不推活坐标**：`act.push` 只有 `?ppark=center` 才为真。
    try { if (act.leave && typeof api.pointerLeave === 'function') api.pointerLeave() } catch { /* 旧 bundle 无此方法 */ }
    if (act.push) { parkPushed++; parkLastPush = [act.u, act.v] }
    try { if (act.push && typeof api.pushPointer === 'function') api.pushPointer(act.u, act.v, act.buttons, 0) } catch { /* 同上 */ }
    return true
  }
  const unparkPointer = () => { parked = false }
  const stageHasPoint = (x, y) => {
    if (!stageEl || typeof stageEl.getBoundingClientRect !== 'function') return false
    try { const r = stageEl.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom } catch { return false }
  }
  // 父页：鼠标离开窗口（relatedTarget=null）／在舞台矩形之外移动（从 iframe 移到父页时最先命中这条）
  doc.addEventListener('mouseout', (e) => { if (!e.relatedTarget) parkPointerNow() }, { passive: true })
  if (typeof doc.addEventListener === 'function') doc.addEventListener('pointermove', (e) => {
    if (stageHasPoint(e.clientX, e.clientY)) { unparkPointer(); try { forwardPointerMove(e) } catch { /* 转发失败不影响其它链 */ } ; return }
    parkPointerNow()
  }, { passive: true })
  if (stageEl && stageEl.addEventListener) stageEl.addEventListener('mouseleave', () => parkPointerNow(), { passive: true })
  // 渲染器 iframe 内部（同源）：鼠标离开该文档 / 窗口失焦；回到文档内则解锁（允许下一次离开再归中）
  function bindRendererPointerLeave() {
    const w = rendererWin()
    if (!w || !w.document || !w.document.addEventListener) return false
    const rdoc = w.document
    try { if (rdoc.__benchParkBound === '1') return true; rdoc.__benchParkBound = '1' } catch { return false }
    rdoc.addEventListener('mouseleave', () => parkPointerNow(), { passive: true })
    rdoc.addEventListener('mouseout', (e) => { if (!e.relatedTarget) parkPointerNow() }, { passive: true })
    rdoc.addEventListener('mousemove', () => unparkPointer(), { passive: true })
    try { w.addEventListener('blur', () => parkPointerNow(), { passive: true }) } catch { /* 跨源/已卸载 */ }
    return true
  }
  try { doc.addEventListener('visibilitychange', () => { if (doc.hidden) parkPointerNow() }, { passive: true }) } catch { /* 无 document.hidden */ }

  // ② 注入到页面里的 DOM 时间层：不可交互 / 不可选中 / 不可拖拽（只动元素自身，绝不碰 canvas / iframe / 遮罩 ⇒ 跟随链不受影响）
  let clockLockCount = 0
  const LOCK_STYLE = [
    ['pointer-events', 'none'],
    ['user-select', 'none'],
    ['-webkit-user-select', 'none'],
    ['-webkit-user-drag', 'none'],
  ]
  function applyTimeLayerLock(el) {
    if (!el || !el.setAttribute) return false
    try { el.setAttribute('draggable', 'false') } catch { /* 只读元素 */ }
    try { el.draggable = false } catch { /* 同上 */ }
    try { if (el.dataset) el.dataset.benchClockLock = '1' } catch { /* 同上 */ }
    try {
      if (el.style && typeof el.style.setProperty === 'function') {
        for (const [k, v] of LOCK_STYLE) el.style.setProperty(k, v, 'important')
      }
    } catch { /* 同上 */ }
    return true
  }
  function computedPosition(el, win) {
    try { if (el.style && el.style.position) return el.style.position } catch { /* 无 style */ }
    try { if (win && typeof win.getComputedStyle === 'function') return win.getComputedStyle(el).position || '' } catch { /* 假 DOM / 已脱离 */ }
    return ''
  }
  function lockTimeLayers(root, win) {
    if (!FLAGS.clocklock || !root || typeof root.querySelectorAll !== 'function') return 0
    let list = []
    try { list = Array.from(root.querySelectorAll('*')) } catch { return 0 }
    let n = 0
    for (const el of list) {
      const plan = timeLayerPlan({
        tag: el.tagName, id: el.id, cls: el.className,
        text: ownTextOf(el), position: computedPosition(el, win),
      })
      if (!plan.lock) continue
      if (applyTimeLayerLock(el)) n++
    }
    return n
  }
  function lockTimeLayersEverywhere() {
    let n = 0
    const slot = $('#stage-slot')
    if (slot) n += lockTimeLayers(slot, typeof window !== 'undefined' ? window : null)
    const w = rendererWin()
    if (w && w.document) n += lockTimeLayers(w.document, w)
    clockLockCount = n
    return n
  }

  // ③ 壁纸品牌：媒体组件显示壁纸自己的 project.json title + preview（拿不到 → 中性文案，绝不回落到上游品牌）
  let mediaBrand = null
  let mediaShim = null            // { snap, saved: {k: descriptor} } —— 用过就还原得回去
  let hostLibCache = null
  /* ②(2026-09-24 用户第 3 条②) 切库根之后的**同页刷新**要用到两个"版本号"：
     · `libRootSignature` = 当前生效的库根（`/api/library` 的 `dir`，切根响应兜底）；
     · `bustedSignature`  = 已经做过缓存击穿的那个签名（防重复改写同一批 URL）。
     都是 `init()` 作用域的量（`refreshLibrarySoft`/`bustRootSensitiveCaches` 与它们同一个函数作用域）。 */
  let libRootSignature = ''
  let bustedSignature = ''
  function readFileAsDataUrl(file) {
    return new Promise((resolve) => {
      try {
        const FR = (typeof FileReader !== 'undefined') ? FileReader : null
        if (!FR || !file) { resolve(''); return }
        const r = new FR()
        r.onload = () => resolve(String(r.result || ''))
        r.onerror = () => resolve('')
        r.readAsDataURL(file)
      } catch { resolve('') }
    })
  }
  function restoreMediaShim() {
    if (!mediaShim) return false
    const { snap, saved } = mediaShim
    mediaShim = null
    for (const k of Object.keys(saved)) {
      try {
        const d = saved[k]
        if (d && d.get) Object.defineProperty(snap, k, d)
        else { delete snap[k]; snap[k] = d && 'value' in d ? d.value : '' }
      } catch { /* 还原失败不致命 */ }
    }
    return true
  }
  function applyMediaBranding() {
    const w = rendererWin()
    if (!w || !mediaBrand) return false
    let stats = null
    try { stats = typeof w.__mediaStats === 'function' ? w.__mediaStats() : null } catch { stats = null }
    const plan = mediaBrandPlan(mediaBrand, stats)
    if (!plan.take) { restoreMediaShim(); return false }
    const patch = {
      title: mediaBrand.title, artist: mediaBrand.artist,
      hasThumbnail: !!mediaBrand.hasThumbnail, thumbnail: mediaBrand.thumbnail || '',
      /* ①(2026-09-23 品牌清理) 上游**模拟**媒体源的品牌不止曲名/歌手：那份内置播放列表里
         `albumArtist:"oneincase"`、歌词行里也有 "WebWallGL"（minified 产物
         `demo/assets/renderer-BOSoB05I.js` 内；许可口径 = 产物一个字节不改）。
         作者脚本能通过媒体 API 读到 `albumArtist` / `lyricLine` ⇒ 一并钉成中性值（有壁纸标题就
         用壁纸的，没有就空串），**绝不回落上游名**；真实系统媒体（`stats.live`）仍走上面那条
         `take:false` 还原分支，真歌词不受影响。 */
      albumArtist: mediaBrand.artist, lyricLine: '',
    }
    try { if (typeof w.__mediaSet === 'function') w.__mediaSet(patch) } catch { /* 场景未挂载时没有它 */ }
    // 模拟媒体源每帧 applyAt() 都会把 title/artist/thumbnail 写回品牌（media.js:135-272）⇒
    // 只有把它写回的那几个字段改成**只读访问器**才能真正钉住（否则下一帧就变回 WebWallGL）。
    let ctl = null
    try { ctl = w.__mediaControl } catch { ctl = null }
    const snap = ctl && ctl.snapshot
    if (snap) {
      if (!mediaShim || mediaShim.snap !== snap) {
        restoreMediaShim()
        const saved = {}
        for (const k of Object.keys(patch)) {
          try { saved[k] = Object.getOwnPropertyDescriptor(snap, k) || { value: snap[k], writable: true, configurable: true, enumerable: true } } catch { /* 取不到就不还原 */ }
        }
        mediaShim = { snap, saved }
      }
      for (const k of Object.keys(patch)) {
        const v = patch[k]
        try { Object.defineProperty(snap, k, { configurable: true, enumerable: true, get: () => v, set: () => {} }) } catch { /* 冻结失败：退化为一次性 __mediaSet */ }
      }
      try { if (typeof w.__mediaSet === 'function') w.__mediaSet(patch) } catch { /* 广播失败不影响画面字段 */ }
    }
    return true
  }
  async function setBrandingFromProject(meta, opt) {
    const o = opt || {}
    const thumb = o.previewFile ? await readFileAsDataUrl(o.previewFile) : String(o.thumbnail || '')
    mediaBrand = brandingFromProject(meta, { thumbnail: thumb, generic: t(curLang, 'brand.generic') })
    applyMediaBranding()
    return mediaBrand
  }
  function hostLibrary() {
    if (hostLibCache) return hostLibCache
    hostLibCache = (typeof fetch === 'function')
      ? fetch('/api/library', { headers: { Accept: 'application/json' } })
        .then((r) => (r && r.ok ? r.json() : null))
        .then((j) => (j && Array.isArray(j.items)) ? j.items : [])
        .catch(() => [])
      : Promise.resolve([])
    return hostLibCache
  }
  async function brandingForItemId(itemId) {
    if (!itemId) return null
    const local = localItems.find((it) => it.id === itemId || it.dir === itemId || String(it.dir).endsWith('/' + itemId))
    if (local) return setBrandingFromProject({ title: local.title }, { previewFile: local.preview })
    const items = await hostLibrary()
    const hit = (items || []).find((it) => String(it.itemId) === String(itemId))
    if (!hit) { mediaBrand = brandingFromProject(null, { generic: t(curLang, 'brand.generic') }); applyMediaBranding(); return mediaBrand }
    const thumb = hit.preview ? ('/media/dev/' + hit.itemId + '/' + hit.preview) : ''
    return setBrandingFromProject(hit, { thumbnail: thumb })
  }
  // ④ 壁纸自带「可拖动」类用户属性 → 关掉（hina 3554161528 的 newproperty21；详见 docs/HINA-CLOCK-AND-PROPERTIES.md）
  let dragDisabled = []
  function disableWallpaperDrag(properties) {
    if (!FLAGS.clockdrag) return []
    const keys = dragPropsToDisable(properties)
    if (!keys.length) return []
    const api = rendererApi()
    if (!api || typeof api.updateWebProps !== 'function') return []
    const wire = {}
    for (const k of keys) wire[k] = { value: false }
    try { api.updateWebProps(wire) } catch { return [] }
    dragDisabled = keys
    return keys
  }
  async function propertiesForItemId(itemId) {
    if (!itemId) return null
    const local = localItems.find((it) => it.id === itemId || it.dir === itemId || String(it.dir).endsWith('/' + itemId))
    if (local && local.properties) return local.properties
    const items = await hostLibrary()
    const hit = (items || []).find((it) => String(it.itemId) === String(itemId))
    return hit ? hit.properties : null
  }
  /** 打开壁纸后统一接线：itemId → 品牌 + 拖动开关。
   *  场景挂载是异步的（__mediaControl 要挂载后才在），所以**不在这里等**：
   *  下面的 batch5Timer 每 1.2s 重放一次 applyMediaBranding()，挂载一完成就自动生效。 */
  async function onWallpaperOpened(itemId) {
    const props = await propertiesForItemId(itemId)
    disableWallpaperDrag(props)
    await brandingForItemId(itemId)
    applyMediaBranding()
  }
  /* ═══════════════ P-160 web 壁纸：把渲染器**自带**的 WE shim 注入壁纸文档 ═══════════════
     真机症状（挂 web 档时渲染器自己的日志）：
       「scene <入口URL>: 网页壁纸：同源入口未检测到 WE shim（host 未注入？）；Spine 类壁纸请确认 /web/ HTML 改写」
     成因（minified 产物里逐行可查）：渲染器对 **同源** 入口走 `cw(src)===true` 那条短路 ——
     它直接 `<iframe src=入口>`，然后 `load` 时检查 `typeof frameWindow.__weSetPaused === 'function'`，
     期望**宿主**（WE 客户端 / 本测试台）在作者脚本之前把 shim 注入进去。宿主不注入 ⇒ 作者的 WE 脚本
     （`wallpaperPropertyListener` / `RegisterAudioListener` …）全部拿不到 API，壁纸等于"只挂了个网页"。
     渲染器在**跨源**那条路上其实自带一份完整 shim（模块内 44.8 KB 字符串常量，注入时打
     `<script data-we-shim-src="1">`）⇒ 本批不抄第三方代码，而是：
       1. 从渲染器自己的产物文本里把那份 shim **取出来**（`shimFromRendererSource`，纯函数、可测）；
       2. 挂 web 档时拦下壁纸 iframe 的 `src`（在**渲染器窗口**里包 `HTMLIFrameElement.prototype.src`），
          把入口 HTML 取回来、把 shim（+ `<base href>`）插到最前、用 blob 文档导航过去
          ⇒ 与渲染器"跨源路径"逐字等价；渲染器 `load` 时那条检查随即通过，告警消失。
     跨源入口**做不到**（拿不到文档）⇒ 记 `reason:'cross-origin'` 并在日志里如实说，**不假装成功**。 */
  const webShimState = { installed: false, injected: 0, failed: 0, lastEntry: '', shimBytes: 0, shimFrom: '', reason: '', crossOrigin: 0, skipped: '' }
  let webShimSource = null
  const webBlobUrls = new Set()
  function rendererScriptUrl(win) {
    try {
      const d = win.document
      const el = d.querySelector('script[src*="renderer-"], script[src*="assets/renderer"]')
      const raw = el && el.getAttribute('src')
      return raw ? new URL(raw, d.baseURI || win.location.href).href : ''
    } catch { return '' }
  }
  /** 取（并缓存）渲染器产物里那份 shim 源码。失败 ⇒ null + 写明 reason。 */
  async function ensureWebShim(win) {
    if (webShimSource) return webShimSource
    const url = rendererScriptUrl(win)
    if (!url) { webShimState.reason = 'no-renderer-script'; return null }
    try {
      const text = await fetch(url, { credentials: 'same-origin' }).then((r) => (r.ok ? r.text() : ''))
      const shim = shimFromRendererSource(text)
      if (!shim) { webShimState.reason = 'shim-not-in-asset'; return null }
      webShimSource = shim
      webShimState.shimBytes = shim.length
      webShimState.shimFrom = url
      webShimState.reason = ''
      return shim
    } catch (e) { webShimState.reason = 'fetch-failed:' + ((e && e.message) || e); return null }
  }
  /** 拼一个"shim 在最前"的 blob 文档 URL（失败 ⇒ null，调用方退回裸 iframe 并写日志）。 */
  async function buildShimmedWebDoc(win, plan) {
    const shim = await ensureWebShim(win)
    if (!shim) return null
    let html = ''
    try { html = await fetch(plan.entryUrl, { credentials: 'same-origin' }).then((r) => (r.ok ? r.text() : '')) } catch { html = '' }
    if (!html) { webShimState.reason = 'entry-fetch-failed'; return null }
    const out = injectShimIntoHtml(html, { shim, baseHref: plan.baseHref })
    if (!out.ok) { webShimState.reason = out.reason; return null }
    try {
      const blob = new win.Blob([out.html], { type: 'text/html;charset=utf-8' })
      return win.URL.createObjectURL(blob)
    } catch (e) { webShimState.reason = 'blob-failed:' + ((e && e.message) || e); return null }
  }
  /** ⑥(2026-09-24 R3 读数) **给"在我们装包装之前就已经挂好的帧"补一次账**。
      为什么需要：渲染器页是在**自己的文档脚本里**就把 web 帧挂上的 —— 测试台把 `?type=web&src=…`
      直接重写进渲染器 iframe 的 URL ⇒ 帧的 `src` 在宿主拿到这个 realm **之前**就写好了，而我们那条
      `HTMLIFrameElement.prototype.src` 包装只能在 realm 出现之后（1200ms 轮询 / `load` 事件）才装得上
      ⇒ 这一次赋值**永远看不到**，`skipped` 就一直是空串（实测：`injected:0`、帧 `ready=true`、
      嵌套帧的 `src` 是原始 `/web/…` URL，而 `skipped:''`）。状态面那句"让位还是没让位"就读不出来。
      这里按**同一条决策函数**（`webShimPlan`）对既有 iframe 补账：只记 `host-injects` 这一条
      （宿主让位、shim 由服务端注入）。**不改 DOM、不重设 src**（帧已经在跑，动它等于双重挂载）。 */
  function accountStoodDownFrames(win) {
    if (!win || !win.document || typeof win.document.querySelectorAll !== 'function') return 0
    if (!(win.__mpwWebPath && win.__mpwWebPath.serverInjects)) return 0
    const origin = (win.location && win.location.origin) || ''
    let n = 0
    for (const f of win.document.querySelectorAll('iframe')) {
      let raw = ''
      try { raw = String(f.getAttribute('src') || '') } catch { continue }
      if (!raw) continue
      /* 与 setter 里逐字同一条判据：`host-injects` 只可能来自"同源 + 渲染器页声明 serverInjects"；
         已经注入过的帧 `src` 是 `blob:` ⇒ 这里会走 `non-http`，不会被误记。 */
      if (webShimPlan(raw, { origin, hostInjects: true }).reason === 'host-injects') { webShimState.skipped = 'host-injects'; n++ }
    }
    return n
  }
  /** 在渲染器窗口里包一层 `HTMLIFrameElement.prototype.src`（幂等）。 */
  function installWebShim(win) {
    if (!win || !win.HTMLIFrameElement || !win.HTMLIFrameElement.prototype) return false
    const proto = win.HTMLIFrameElement.prototype
    try { if (proto.__benchWebShim === '1') { webShimState.installed = true; accountStoodDownFrames(win); return true } } catch { return false }
    const desc = Object.getOwnPropertyDescriptor(proto, 'src')
    if (!desc || typeof desc.set !== 'function') { webShimState.reason = 'no-src-setter'; return false }
    const origin = (win.location && win.location.origin) || ''
    Object.defineProperty(proto, 'src', {
      configurable: true,
      enumerable: true,
      get() { return desc.get.call(this) },
      set(v) {
        const plan = webShimPlan(v, { origin, hostInjects: !!(win && win.__mpwWebPath && win.__mpwWebPath.serverInjects) })
        if (!plan.needsShim) {
          /* 如实记账：跨源注入做不到；宿主自己会挂 web 帧时我们让位（`host-injects`）。
             ⚠ 只记这两条"值得读出来"的原因：渲染器页还会建别的 iframe（`not-web-entry` 会刷屏），
             把最后一条原因覆盖掉就没法从状态面判"到底为什么没注入"。 */
          if (plan.reason === 'cross-origin') webShimState.crossOrigin++
          if (plan.reason === 'cross-origin' || plan.reason === 'host-injects') webShimState.skipped = plan.reason
          desc.set.call(this, v)
          return
        }
        // web 入口：**先不导航**（导航会让渲染器那条 load 检查提前跑一次），等 shim 文档拼好再一次性导航。
        const frame = this
        webShimState.lastEntry = plan.entryUrl
        buildShimmedWebDoc(win, plan).then((blobUrl) => {
          if (!blobUrl) {
            webShimState.failed++
            logLine('web 壁纸 shim 注入失败（' + webShimState.reason + '）⇒ 退回裸 iframe（作者脚本拿不到 WE API）', true)
            try { desc.set.call(frame, plan.entryUrl) } catch { /* 元素已摘 */ }
            return
          }
          webBlobUrls.add(blobUrl)
          try {
            desc.set.call(frame, blobUrl)
            webShimState.injected++
          } catch (e) {
            webShimState.failed++
            webShimState.reason = 'assign-failed:' + ((e && e.message) || e)
            try { desc.set.call(frame, plan.entryUrl) } catch { /* ignore */ }
          }
          try {
            frame.addEventListener('load', () => setTimeout(() => { try { win.URL.revokeObjectURL(blobUrl); webBlobUrls.delete(blobUrl) } catch { /* ignore */ } }, 5000), { once: true })
          } catch { /* 桩 DOM */ }
        })
      },
    })
    try { Object.defineProperty(proto, '__benchWebShim', { value: '1', configurable: true }) } catch { /* 冻结的原型 */ }
    webShimState.installed = true
    accountStoodDownFrames(win)          // ⑥ 包装装好之前就挂上的帧（渲染器页自己挂的那条）补一次账
    return true
  }
  window.__benchWebShim = () => Object.assign({}, webShimState, { cached: !!webShimSource })

  // 同源 iframe 里挂一层薄包装：跟住「换了哪张壁纸」（本地路径我们直接知道；后端路径从 src 里嗅 itemId）
  function wrapRendererApi() {
    const w = rendererWin()
    if (!w || w.__benchWrapped === '1') return false
    const api = w.__wp
    if (!api) return false
    try { w.__benchWrapped = '1' } catch { return false }
    for (const name of ['setWallpaper', 'loadSceneFile']) {
      const orig = api[name]
      if (typeof orig !== 'function') continue
      api[name] = function (a, b) {
        const r = orig.apply(this, arguments)
        try {
          const id = sniffItemId((a && (a.src || a.source)) || b || '')
          if (id) onWallpaperOpened(id)
        } catch { /* 嗅探失败不影响加载 */ }
        return r
      }
    }
    installRendererApiFallbacks(api, w)
    bindRendererPointerLeave()
    return true
  }
  /* ⑲(2026-09-24 用户第 19 条 · **真机读数就是这条链**)：产物页（minified、不可改）里有几处
     **无条件**调用渲染器 API：`#release` 的处理器是 `E()?.release()`、指针离开舞台是 `D().pointerLeave()`。
     默认档（本仓渲染器 `/webloader/`）的 `__wp` 目前**没有**这两个方法 ⇒ 每次触发都抛
     `TypeError: … is not a function` ⇒ ① 用户那一下等于什么都没做（"点了释放，日志还在跑"）；
     ② 未捕获异常弹出全局错误条 `#bench-errorbar` 盖住页签条（实测把整条浏览器门禁挡在半路：
     点不到「关标签的 ×」，Playwright 重试 30s 后超时）。
     这里给**缺失**的方法装一个**如实登记**的降级实现（不是把缺口藏起来）：
       · 只在 `typeof api[name] !== 'function'` 时才装（渲染器线一旦补上真实实现，这段自动不生效）；
       · 装上了就写进 `w.__benchApiFallbacks`，探针 `__benchPatch.apiFallbacks()` 原样读得到；
       · 语义与宿主实际做的事一致：`release` = 停渲染器（`#release` 的四件套真做，见 releaseQuietNow）；
         `pointerLeave` = 指针已离开（宿主自己的 `pointerParkAction` 那条路照旧，本仓 core 里
         `pointerLeave` 是"只清按键、保留最后位置"，缺这个方法的档位本来就无事可做）。 */
  function installRendererApiFallbacks(api, w) {
    const MISSING = ['release', 'pointerLeave']
    const installed = []
    for (const name of MISSING) {
      if (typeof api[name] === 'function') continue
      try {
        api[name] = function () { return null }
        installed.push(name)
      } catch { /* API 被冻结：不动它（门禁会在读数里看到缺方法） */ }
    }
    try { w.__benchApiFallbacks = installed } catch { /* 桩环境 */ }
    return installed
  }
  // iframe 每次换 src（换壁纸/重挂载）都会换一个内部 window ⇒ 包装与监听要周期性重挂
  // （廉价：只读 __wp 上的一个标记位）。时间层扫描更贵，隔几拍跑一次。
  let pollTick = 0
  const batch5Tick = () => {
    /* ⑲(2026-09-24 用户第 19 条) **释放之后这条轮询一个字都不许跑**：它会周期性
       `wrapRendererApi()` / `installWebShim()` / `applyRepoChromeHide()` —— 那正是"自愈重挂"
       （把刚被释放掉的渲染器又接回去）。`releaseQuietNow()` 会 `clearInterval` + 把这个门闩置位；
       用户**显式**再选一张壁纸时由 `__benchRelease.resume()` 复位并重启（见下）。 */
    if (releasedQuiet) return
    pollTick++
    wrapRendererApi()
    try { installWebShim(rendererWin()) } catch { /* 渲染器窗口还没起来 */ }
    bindRendererPointerLeave()
    if (FLAGS.brand) applyMediaBranding()
    if (FLAGS.clocklock && pollTick % 3 === 0) lockTimeLayersEverywhere()
    // ⑩(2026-09-21 §5.3) 音条源状态行：复用这条既有轮询（**不另起定时器**）——
    //   渲染器的 `__mpwAudioBandSource` 是逐帧写的，父页只能靠轮询跟上；失败不影响渲染。
    try { paintBandFeedStatus() } catch { /* 状态行是只读呈现 */ }
    try { paintRendererSrcStatus() } catch { /* 同上：渲染器来源状态行 */ }
    //  ①A3 文档页那份"需实现"文案的修正也挂在这条既有轮询上（产物可能晚于 init 才克隆出表格副本；
    //     `fixWpsetDoc` 幂等（`data-bench-wpset=fixed`）且只扫 tbody 行，代价可忽略）
    try { fixWpsetDoc() } catch { /* 文档页不在这个产物里 */ }
    try { if (rendererSrcNow() === 'repo') applyRepoChromeHide() } catch { /* 同上：只隐开发外壳 */ }
  }
  let batch5Timer = setInterval(batch5Tick, 1200)
  /* ── ⑲(2026-09-24 用户第 19 条)「释放」要**真的停干净** ─────────────────────────────────────────
     现象（用户原话）：「清空导航栏全部壁纸（当前未选择壁纸状态）后点了释放按钮，但下面日志仍在跑、
     一直刷"无 web GL2"」。真因：`#release` 上只有**产物**那条 `E()?.release()` —— 没选中壁纸时
     `E()` 返回空 ⇒ 这一点击**什么都没做**；而预览 iframe 仍挂着渲染器文档（它的取上下文/重试循环
     继续往输出区刷日志），上面那条 1.2s 轮询还会周期性把产物 API/ shim 重新接上去（"自愈重挂"）。
     修法（`releaseQuietNow()`，四件事都做，可机读）：
       ① 真的停渲染器：`__wp.release()` + `__wp.setPaused(true)`（拿不到 API 就跳过，如实记 `apiCalled`）；
       ② 清 iframe：`src` 换成 `about:blank`（把渲染器文档导航走 —— 它的循环与日志一起停）+ 撤黑幕；
       ③ 停轮询：`clearInterval(batch5Timer)` 且门闩 `releasedQuiet=true`（轮询体第一行就返回）；
       ④ 不再自愈重挂：合成样例的自动挂载（`loadRepoDefaultSample`）看到门闩直接返回
          `reason:'released-quiet'`；用户**显式**点一张壁纸（`switchToWallpaper`）才 `resume()`。
     读数：`__benchPatch.releaseQuietProbe()`（`{quiet, pollRunning, frameSrc, frameBlank, apiCalled,
     linesAtRelease, lines, quietMs}`）—— 门禁在释放后等一段时间再读一次 `lines` 断言**不再增长**。 */
  let releasedQuiet = false
  let releasedAt = 0
  let releasedApiCalled = false
  let releaseLogsAt = -1
  let releaseTimes = 0
  const logLinesNow = () => { try { const b = $('#logbody'); return b && b.children ? b.children.length : -1 } catch { return -1 } }
  function releaseQuietProbe() {
    let src = ''
    try { src = String((frameEl && frameEl.getAttribute && frameEl.getAttribute('src')) || '') } catch { src = '' }
    let api = null
    try { const w = frameEl && frameEl.contentWindow; api = (w && w.__wp) || null } catch { api = null }
    return {
      quiet: !!releasedQuiet, count: releaseTimes, at: releasedAt,
      quietMs: releasedQuiet ? (Date.now() - releasedAt) : 0,
      pollRunning: !!batch5Timer, apiCalled: releasedApiCalled,
      frameSrc: src, frameBlank: /^about:blank$/i.test(src) || src === '',
      artifactChainDetached: (() => { try { return !!releaseBtn && releaseBtn.onclick === null } catch { return false } })(),
      artifactChainSaved: typeof artifactReleaseChain === 'function',
      rendererApiPresent: !!api,
      linesAtRelease: releaseLogsAt, lines: logLinesNow(),
      grewAfterRelease: releaseLogsAt >= 0 ? (logLinesNow() - releaseLogsAt) : -1,
    }
  }
  function releaseQuietNow(why) {
    releasedQuiet = true
    releasedAt = Date.now()
    releaseTimes++
    releaseLogsAt = logLinesNow()
    let apiCalled = false
    try {
      const w = frameEl && frameEl.contentWindow
      const api = w && w.__wp
      if (api) {
        if (typeof api.release === 'function') { try { api.release() } catch { /* 渲染器拒绝 */ } ; apiCalled = true }
        if (typeof api.setPaused === 'function') { try { api.setPaused(true) } catch { /* 同上 */ } ; apiCalled = true }
      }
    } catch { /* 跨源/已卸载 */ }
    releasedApiCalled = apiCalled
    try { if (batch5Timer) { clearInterval(batch5Timer); batch5Timer = null } } catch { /* 桩环境 */ }
    try {
      if (frameEl) {
        frameEl.classList.remove('on')
        frameEl.removeAttribute('src')
        frameEl.setAttribute('src', 'about:blank')          // 真停：把渲染器文档导航走
      }
    } catch { /* 桩 DOM */ }
    try { frameGate.hide() } catch { /* 桩 DOM */ }
    try { const em = $('#empty'); if (em) em.style.display = '' } catch { /* 桩 DOM */ }
    try { logLine(t(curLang, 'log.releaseQuiet', { why: String(why || 'button') })) } catch { /* 桩 DOM */ }
    return releaseQuietProbe()
  }
  /** 用户显式再挂一张壁纸 ⇒ 复位门闩并重启那条轮询（幂等）。 */
  function releaseResume() {
    releasedQuiet = false
    releasedApiCalled = false
    releaseLogsAt = -1
    if (!batch5Timer && typeof setInterval === 'function') batch5Timer = setInterval(batch5Tick, 1200)
    return true
  }
  try { if (typeof window !== 'undefined') window.__benchRelease = { quiet: () => releasedQuiet, resume: releaseResume, probe: releaseQuietProbe, release: releaseQuietNow } } catch { /* 桩环境 */ }
  /* ⑲(2026-09-24 用户第 19 条 · **改前读数就是这条**)：产物挂在 `#release` 上的处理器是
     `E()?.release()`，而它默认档（本仓渲染器 `/webloader/`）拿到的 `__wp` **没有 `release` 方法**
     ⇒ 每次点击都抛 `TypeError: E().release is not a function`：
       · 这一下等于**什么都没做**（渲染器没停、日志继续刷 —— 用户报的就是它）；
       · 未捕获异常还会弹出全局错误条 `#bench-errorbar`（`glass` 层）**盖住页签条**，
         连"关标签的 ×"都点不到（门禁 `bench-ui-headless` 的 Y3/Y4 命中判据实测就是被它挡红的）。
     修法：与 `#pick-lib` 同款 —— 把产物处理器摘下来存着，换成我们自己的入口：
     先在 try/catch 里礼貌地跑一次产物那条链（在**有** `release()` 的上游档它才是正路），
     再无条件执行 `releaseQuietNow()` 的四件套（停渲染器 / 清 iframe / 停轮询 / 不再自愈重挂）。
     摘链 ⇒ 不再抛错 ⇒ 不再弹错误条；"释放"从此在**两个档位**上都真的停干净。 */
  let artifactReleaseChain = null
  function detachArtifactReleaseChain() {
    try {
      if (releaseBtn && typeof releaseBtn.onclick === 'function') {
        artifactReleaseChain = releaseBtn.onclick
        releaseBtn.onclick = null
        return true
      }
    } catch { /* 桩 DOM */ }
    return false
  }
  const releaseBtn = $('#release')
  if (releaseBtn && releaseBtn.addEventListener) {
    detachArtifactReleaseChain()
    //  产物在 boot 里可能晚一步才挂上（或将来改挂法）⇒ 几个时刻各摘一次（摘不到返回 false，不报错）
    try { setTimeout(detachArtifactReleaseChain, 600); setTimeout(detachArtifactReleaseChain, 2000) } catch { /* 桩环境 */ }
    releaseBtn.addEventListener('click', () => {
      try { if (typeof artifactReleaseChain === 'function') artifactReleaseChain.call(releaseBtn) } catch { /* 产物那条链在缺 API 的档位会抛（见上）：吞掉，继续做真停 */ }
      try { releaseQuietNow('button') } catch { /* 单次失败不影响页面 */ }
    })
  }
  if (frameEl && frameEl.addEventListener) frameEl.addEventListener('load', () => {
    setTimeout(() => { wrapRendererApi(); try { installWebShim(rendererWin()) } catch { /* ignore */ } ; bindRendererPointerLeave(); syncMicGate(); paintBandFeedStatus(); paintRendererSrcStatus(); applyRepoChromeHide() }, 0)
    setTimeout(() => { lockTimeLayersEverywhere() }, 800)
    /* ①(2026-09-22 用户第 9 条) **重挂载后把当前音量重新落一遍**：改壁纸配置会让产物重挂载渲染器，
       新渲染器的媒体是新建的（音量回到默认 1）⇒ 用户看到"改完配置音量变 100%（界面还显示 20%）"。
       唯一落点仍是 `initNavSound` 的 `applyAudio`（这里只按当前档位重放）；渲染器建媒体是异步的 ⇒ 补两次。 */
    setTimeout(() => { try { if (MPW_APPLY_AUDIO) MPW_APPLY_AUDIO() } catch (e) {} }, 300)
    setTimeout(() => { try { if (MPW_APPLY_AUDIO) MPW_APPLY_AUDIO() } catch (e) {} }, 1200)
  })

  /* ── ⑤(2026-09-20 用户第 5 条) 「启用麦克风」闸门：默认关 ⇒ `getUserMedia` **一次都不调** ──────────
     用户原话要点：工具条新增「启用麦克风」复选框、**默认关**；关着时**任何** mic 请求都不发
     （`getUserMedia` 一次都不许调，"系统实况"只保留歌名/进度）；开着且**壁纸/功能声明需要**时才请求；
     **不许页面加载时预请求**。
     实现分三层（三层都做，任一层单独失效都还有兜底）：
       ① 页面这一侧"谁声明需要麦克风" = 「系统实况」（`#live-system`）。麦克风关着时它被强制关掉并置灰
          ⇒ 产物 `ve.onchange → Ae()` 重挂渲染器时**不会**带上 `liveSystem=1`（mic 的页面入口就断了）；
          用户此前的勾选状态记在 `micLiveWanted`，打开麦克风时原样还给他。
       ② 闸门本体：把 `navigator.mediaDevices.getUserMedia` 换成"关了就直接拒绝、连原函数都不调"的版本，
          顶层窗口与**同源渲染器 iframe** 各装一道（web 壁纸文档与渲染器都在这一棵树里）。
          被拦下的次数记在 `__benchPatch.micGate().blocked`（可断言）。
       ③ 探针：`micGate()` 给出 `enabled/blocked/allowed/requests/installed`，门禁在 addInitScript 里
          再包一层计数器数**真实调用**（关了必须是 0）。
     为什么默认必须是"关"：产物在挂载壁纸时会把 `liveSystem=1` 写进渲染器 URL，渲染器据此
     `getUserMedia`（浏览器会弹权限框）—— 用户没勾过任何东西就被要麦克风，正是他要挡掉的行为。 */
  const micEl = $('#mic-enable'), liveEl = $('#live-system')
  let micBlocked = 0, micPermitted = 0, micInstalled = 0
  let micLiveWanted = !!(liveEl && liveEl.checked)          // 产物默认勾着"系统实况" ⇒ 记住这个默认
  const micGateOpen = () => !!(micEl && micEl.checked)
  function micDeny(win) {
    try {
      const D = (win && win.DOMException) || (typeof DOMException === 'function' ? DOMException : null)
      if (D) return new D('麦克风未启用（测试台工具条的「启用麦克风」默认关）', 'NotAllowedError')
    } catch { /* 无 DOMException 的环境 */ }
    const e = new Error('microphone disabled by bench switch'); e.name = 'NotAllowedError'; return e
  }
  /** 在某个 window 的 `navigator.mediaDevices.getUserMedia` 上装闸门（幂等）。 */
  function installMicGateOn(win) {
    try {
      const md = win && win.navigator && win.navigator.mediaDevices
      if (!md || typeof md.getUserMedia !== 'function') return false
      if (md.__benchMicGated) return true
      const orig = md.getUserMedia.bind(md)
      const gated = function () {
        if (!micGateOpen()) { micBlocked++; return Promise.reject(micDeny(win)) }   // **连原函数都不调**
        micPermitted++
        return orig.apply(null, arguments)
      }
      try { Object.defineProperty(md, '__benchMicGated', { value: true, configurable: true }) } catch { /* 冻结 */ }
      md.getUserMedia = gated
      micInstalled++
      return true
    } catch { return false }
  }
  /** 把闸门状态同步到三个面：顶层窗口 / 渲染器 iframe / 「系统实况」复选框。 */
  function syncMicGate() {
    installMicGateOn(typeof window !== 'undefined' ? window : null)
    try { installMicGateOn(rendererWin()) } catch { /* 渲染器还没起来 */ }
    if (liveEl) {
      if (!micGateOpen()) {
        if (liveEl.checked) { micLiveWanted = true; liveEl.checked = false }      // 关着 ⇒ 强制不带 liveSystem=1
        try { liveEl.disabled = true } catch { /* 桩 DOM */ }
        try { liveEl.title = t(curLang, 'toolbar.micTip') } catch { /* 桩 DOM */ }
      } else {
        try { liveEl.disabled = false } catch { /* 桩 DOM */ }
        try { liveEl.checked = !!micLiveWanted } catch { /* 桩 DOM */ }
        try { liveEl.title = t(curLang, 'toolbar.liveTip') } catch { /* 桩 DOM */ }
      }
    }
    return micGateState()
  }
  function micGateState() {
    return {
      enabled: micGateOpen(), installed: micInstalled, blocked: micBlocked, permitted: micPermitted,
      liveSystemChecked: !!(liveEl && liveEl.checked), liveSystemDisabled: !!(liveEl && liveEl.disabled),
      wanted: micLiveWanted, rendererLive: (() => { try { const src = frameEl ? String(frameEl.getAttribute('src') || '') : ''; return /[?&]liveSystem=1/.test(src) } catch { return null } })(),
    }
  }
  if (micEl) {
    try { micEl.checked = false } catch { /* 桩 DOM */ }        // **默认关**（HTML 里也没写 checked）
    micEl.addEventListener('change', () => {
      if (!micGateOpen() && liveEl) { micLiveWanted = false }   // 主动关掉 ⇒ 连"想要的"也清掉
      syncMicGate()
      logLine(t(curLang, micGateOpen() ? 'log.micOn' : 'log.micOff'))
    })
  }
  if (liveEl) {
    // 麦关着时点「系统实况」：不改 URL（不请求），把"想要"记下来，并在输出区写明原因
    liveEl.addEventListener('click', (e) => {
      if (!micGateOpen()) { try { e.preventDefault() } catch {} ; micLiveWanted = true; logLine(t(curLang, 'log.micNeeded'), true) }
    }, true)
  }
  syncMicGate()

  /* ── ⑩(2026-09-21 · 台账 ../docs/USER-ITEMS-20260920-B.md §5.3) **音条源四档** ─────────────────────
     工具条 `<select id="bandfeed">`（壁纸 = `auto` / 麦克风 = `mic` / 模拟 = `sim` / 关 = `off`）
     → 渲染器 iframe URL 的 `?bandfeed=`；状态行 `#status-bandfeed` 写出渲染器回报的源类型 / 静音原因。
     四条判据（门禁 `tests/bench-bandfeed-switch-test.mjs`）：
       ① 静音 / 无源档 ⇒ 渲染器 `source='silent'` 且 128 元全 0（渲染器既有口径，本段只**如实显示**）；
       ② `sim` 档 ⇒ 非 0（形态可见）；
       ③ `mic` 档拒绝授权 ⇒ 仍 silent 且**不弹第二次**；
       ④ 任何档都不许为音条自动播放包内音频（不"莫名出声"）。
     接线纪律（为什么这样写）：
       · 档位拼进 URL 用**已有的** `HTMLIFrameElement.prototype.src` 包装链（见下面 `installBandFeedSrcHook`）：
         P-93 ①-a 那层管路径前缀改写、这层管查询串，两者作用在不同部分 ⇒ 谁先谁后结果一致，
         全仓仍只有一条 URL 改写链、没有第二套 src 设定逻辑；
       · 换档重挂载**不自己写第二套**：直接点产物自己的「重挂载」按钮 `#reload`（`onclick = Ae()`，
         它重算 `wt(w)` 并重设 iframe src ⇒ 新 URL 自然带上新档位）；
       · 麦克风**只**由「启用麦克风」闸门开（`initMicGate`，本段只**读**它的状态）：选 mic 档而闸门关着时，
         渲染器那次 `getUserMedia` 会被闸门直接拒绝（连原函数都不调 ⇒ **不弹权限框**），音条保持全 0；
         本段**不替用户勾**「启用麦克风」、也不自己调 `getUserMedia`；闸门从"开"变"关"**不重挂载**、
         不请求任何东西（已被闸门挡住）。 */
  const bandFeedSelect = () => { try { return $('#bandfeed') } catch (e) { return null } }
  const bandStatusSelect = () => { try { return $('#status-bandfeed') } catch (e) { return null } }
  let bandStatusLast = null
  /** 当前档位（读真控件；控件缺失 ⇒ 回落缺省档 —— 本函数**永不**返回 `mic`）。 */
  function bandFeedNow() {
    try { const el = bandFeedSelect(); return bandFeedMode(el && el.value) } catch (e) { return BAND_FEED_DEFAULT }
  }
  /** 渲染器侧回报（同源 iframe 直接读；未挂载 / 还没出过帧 / 跨源 ⇒ null = 如实"还没有回报"）。 */
  function bandFeedRendererInfo() {
    try {
      const w = frameEl && frameEl.contentWindow
      if (!w) return null
      const info = (typeof w.__mpwAudioBandInfo === 'function') ? w.__mpwAudioBandInfo() : null
      if (info && (info.source || info.reason)) return info
      if (w.__mpwAudioBandSource || w.__mpwAudioBandReason) {
        return { source: w.__mpwAudioBandSource || null, reason: w.__mpwAudioBandReason || null }
      }
      return null
    } catch (e) { return null }
  }
  /** 渲染器文档是否已就绪（区分"还没回报"与"这个渲染器根本不回报"；跨源读不到 ⇒ 当作已就绪）。 */
  function bandRendererReady() {
    try {
      const w = frameEl && frameEl.contentWindow
      if (!w) return false
      if (!String((frameEl.getAttribute && frameEl.getAttribute('src')) || '')) return false
      try { return !w.document || w.document.readyState === 'complete' } catch (e) { return true }
    } catch (e) { return false }
  }
  /** 把渲染器回报画到状态行（幂等；**三处**既有路径都会调它：iframe load / 周期轮询 / 语言与档位变化）。 */
  /** ⑧(P-228f) 预览文档的年龄（ms）：刚 (重新) 挂载的那一两秒里，渲染器侧还没发布任何读数，
     状态行据此保持"加载/等待"而不是下"不认这个参数"的结论。 */
  function bandDocAgeMs() {
    try {
      const w = (typeof frameEl !== 'undefined' && frameEl) ? frameEl.contentWindow : null
      if (!w || !w.performance || !w.performance.timeOrigin) return null
      return Date.now() - w.performance.timeOrigin
    } catch (e) { return null }
  }
  /** ⑧(P-228f) 预览 URL 里到底有没有 `bandfeed=`（「改写链丢参」与「渲染器不认」是两种诊断 ⇒ 分开探）。 */
  function bandFeedParamInUrl() {
    try {
      const el = (typeof frameEl !== 'undefined' && frameEl) ? frameEl : null
      const src = el ? String(el.getAttribute('src') || '') : ''
      if (!src) return null
      return /[?&]bandfeed=/i.test(src)
    } catch (e) { return null }
  }
  function paintBandFeedStatus() {
    const plan = bandFeedStatusPlan(curLang, bandFeedRendererInfo(),
      { micGateOpen: !!(micEl && micEl.checked), rendererReady: bandRendererReady(), feed: bandFeedNow(), urlHasFeedParam: bandFeedParamInUrl(), docAgeMs: bandDocAgeMs() })
    bandStatusLast = plan
    const el = bandStatusSelect()
    if (!el) return plan
    try {
      el.textContent = plan.text
      el.setAttribute('data-mpw-bandfeed-status', plan.kind)
      el.setAttribute('data-mpw-bandfeed-source', plan.source || 'none')
      el.setAttribute('data-mpw-bandfeed-mode', bandFeedNow())
    } catch (e) { /* 桩 DOM */ }
    return plan
  }
  /** 换档重挂载：**沿用**产物自己的「重挂载」（`#reload` 的 `onclick = Ae()`），不写第二套。
   *  返回值 = **iframe src 是否真的被重设**（`Ae()` 同步写 src）：没有选中壁纸 / 当前是合成样例那条
   *  路径时 `Ae()` 会直接返回 ⇒ 档位只在**下次挂载**时生效，这一点由调用方如实写进输出区。 */
  /** 「未选择壁纸」的**唯一判据**（⑦ 用来挡"重挂载把叉掉的那张挂回来"）：
   *  列表里没有 `.active`、外壳的 `curId` 为空、`#frame` 也没有挂任何 URL。三者都空才算"没选"，
   *  只有其一为空就**不挡**（宁可放过，也不许误挡用户真的在预览的那张）。 */
  function nothingSelectedNow() {
    try {
      const active = doc.querySelector('#list li[data-id].active')
      const sh = (typeof window !== 'undefined' && window.__benchShell) ? window.__benchShell : null
      const id = (sh && typeof sh.currentId === 'function') ? String(sh.currentId() || '') : ''
      const f = frameEl || $('#frame')
      const src = f ? String(f.getAttribute('src') || '') : ''
      /*  ⚠`#release` 这条链会把 iframe 导航到 `about:blank`（⑲ 的"停干净"），所以"没挂壁纸"的
          判据不是"src 为空"，而是"src 为空 **或** 已经停在 about:blank"（真机踩过：只判空串 ⇒
          释放之后 `empty` 恒 false ⇒ 守卫等于没装）。 */
      const blank = !src || /^about:blank([?#]|$)/i.test(src)
      return { empty: !active && !id && blank, active: !!active, id, src: src.slice(0, 60), blank }
    } catch (e) { return { empty: false, error: String((e && e.message) || e) } }
  }
  function remountRendererForBandFeed() {
    const btn = $('#reload')
    if (!btn || typeof btn.click !== 'function') return false
    /*  ⑦(2026-09-25 用户第 7 条) **未选择壁纸 ⇒ 一次都不点产物的「重挂载」**。
        为什么：产物的 `#reload` → `Ae()` 读的是它自己的 `w`（"最后一次挂载的那张"），
        用户叉掉壁纸之后 `w` 还挂着旧的 ⇒ 换档这一下就把叉掉的那张挂回来了（真机读数见
        `clearArtifactSelection` 的注释）。这里先从源头不触发；`clearArtifactSelection()` 再把 `w` 清成 null
        （两道互不依赖：一道挡入口，一道清状态）。 */
    const st = nothingSelectedNow()
    if (st.empty) return false
    const srcOf = () => { try { return String((frameEl && frameEl.getAttribute('src')) || '') } catch (e) { return '' } }
    const before = srcOf()
    try { btn.click() } catch (e) { return false }
    return srcOf() !== before
  }
  {
    const bandFeedEl = bandFeedSelect()
    if (bandFeedEl) {
      try { bandFeedEl.value = bandFeedNow() } catch (e) { /* 桩 DOM */ }   // 归一（HTML 缺省就是 auto）
      bandFeedEl.addEventListener('change', () => {
        const mode = bandFeedMode(bandFeedEl.value)
        try { if (bandFeedEl.value !== mode) bandFeedEl.value = mode } catch (e) { /* ignore */ }
        // 选「麦克风」而闸门关着：**如实说明**（写清"一次都不会请求"），但**不代勾**闸门、不自己请求。
        if (mode === 'mic' && micEl && !micEl.checked) logLine(t(curLang, 'log.bandfeedMicGated'), true)
        const remounted = remountRendererForBandFeed()
        const plan = paintBandFeedStatus()
        logLine(t(curLang, 'log.bandfeedSwitch', { mode: bandFeedLabel(curLang, mode), status: plan.text }))
        if (!remounted) logLine(t(curLang, 'log.bandfeedNoMount'), true)     // 档位在下次挂载时生效
      })
    }
    // 闸门从"关"变"开"且当前正是 mic 档 ⇒ 给**一次**重挂载，让麦克风真的接上（用户显式勾选触发的，
    //   不是自动请求）；从"开"变"关"不重挂载、不请求（渲染器那次 getUserMedia 已被闸门挡住）。
    if (micEl) {
      micEl.addEventListener('change', () => {
        if (micEl.checked && bandFeedNow() === 'mic') remountRendererForBandFeed()
        paintBandFeedStatus()
      })
    }
  }
  // 档位 → iframe URL：装在同一条 src 包装链上（幂等；没有 iframe 原型的环境静默降级）。
  installBandFeedSrcHook((typeof HTMLIFrameElement !== 'undefined') ? HTMLIFrameElement.prototype : null, bandFeedNow)
  paintBandFeedStatus()

  /* ── ⑪(2026-09-21) **渲染器来源两档**（上游产物 / 本仓渲染器）─────────────────────────────────
     工具条 `<select id="renderer-src">` → 预览 iframe 的**路径**：`upstream` 保持原样（一个字符都不改），
     `repo` 改成同源 `/webloader/?…`（`:8902` 的反代到 `:8899` 的 `demo.html` + 本仓 core）。
     接线纪律（与音条源**同构**，不写第二套）：
       · URL 改写装在同一条 `HTMLIFrameElement.prototype.src` 包装链上（`installRendererSourceSrcHook`，幂等）；
       · 换档重挂载**沿用**产物自己的「重挂载」`#reload`（同一个 `remountRendererForBandFeed()` ——
         它做的事与音条无关，就是"点 #reload 并回报 src 是否真被重设"）；
       · 状态行把三件事写成人话：**跑的是哪条路径**、**画布/DPR 真读数**（读 iframe 的
         `window.__mpwLiveRes`，本仓渲染器的 `?res=dpr` 活档位会写它）、**哪些能力被明确降级**
         （读 iframe 的 `window.__mpwHostCaps`，`false` 的键就是在预览里不生效的那几个）；
       · `#dpr` 档只在**用户显式改过**时当上限传下去（缺省 1 是产物页的"1× CSS 像素"口径，
         照传会把本仓的画质修复原地抵消 —— 见 `rendererDprCap` 的注释）。 */
  const rendererSrcSelect = () => { try { return $('#renderer-src') } catch (e) { return null } }
  const rendererSrcStatusEl = () => { try { return $('#status-renderer-src') } catch (e) { return null } }
  let rendererDprTouched = false
  /*  ⑦(2026-10-12 用户 :8902 第 2/3 条「视差 / x-ray 没生效」的**页面侧根因 C**) 视差档：
      渲染器 `demo.html:8905` 的 `parallaxOff = !/^(1|official|legacy)$/.test(?parallax)` ⇒ **缺省关**，
      而测试台此前从不写这个参数 ⇒ 相机视差 + 对象级 `parallaxDepth` 在默认档整体停用。
      取值 = 渲染器**既有**的那四个（`1` / `official` / `legacy` / `0`），**不改 core/demo.html 的判定** ✗。
      优先级：本页 URL 的 `?parallax=<值>`（主表登记的 A/B 用法）> localStorage(`bench-parallax`) > `1`（开）；
      控件不在 ⇒ `null` ⇒ `rendererSourceUrl()` 一个字符都不写（与其它档位同一条纪律）。 */
  const PARALLAX_MODES = ['1', 'official', 'legacy', '0']
  let parallaxMode = (() => {
    let el = null
    try { el = $('#parallax') } catch (e) { el = null }
    if (!el) return null
    try { const v = String(new URLSearchParams(location.search).get('parallax') || ''); if (PARALLAX_MODES.indexOf(v) >= 0) return v } catch (e) { /* 无 location */ }
    try { const st = String(localStorage.getItem('bench-parallax') || ''); if (PARALLAX_MODES.indexOf(st) >= 0) return st } catch (e) { /* 无存储 */ }
    return '1'
  })()
  function rendererSrcNow() {
    try { const el = rendererSrcSelect(); return rendererSourceMode(el && el.value) } catch (e) { return RENDERER_SOURCE_DEFAULT }
  }
  /** `#dpr` 档 → 上限（**只在用户显式改过时**；缺省值 1 不算"改过"）。 */
  function rendererDprOpts() {
    try {
      const el = $('#dpr')
      const webModeEl = $('#web-mode')
      const introEl = $('#intro-skip')
      const hybridEl = $('#hybrid')
      return {
        dpr: el ? el.value : null,
        dprTouched: rendererDprTouched,
        /* ②③(P-228f 2026-10-05) 三个新档位：控件不在 ⇒ null（= 不写进 URL，行为与以前逐字一致）。 */
        skipIntro: introEl ? !!introEl.checked : null,
        webFrame: webModeEl ? String(webModeEl.value || '') : null,
        hybrid: hybridEl ? !!hybridEl.checked : null,
        /* ⑦(2026-10-12 用户第 2/3 条页面侧根因 C) 视差档位：`1`/`official`/`legacy`/`0`（渲染器既有取值，
           由上面的 `parallaxMode` 统一给；控件不在 ⇒ null ⇒ `rendererSourceUrl()` 一个字符都不写）。 */
        parallax: parallaxMode,
      }
    } catch (e) { return { dpr: null, dprTouched: false, skipIntro: null, webFrame: null, hybrid: null, parallax: null } }
  }
  /** 读预览 iframe 的真实情况（同源可直接读；跨源/还没起来 ⇒ 逐项如实置空，不谎报）。 */
  function rendererSrcProbe() {
    try {
      const el = frameEl
      if (!el) return null
      const src = String(el.getAttribute('src') || '')
      if (!src) return null
      const w = el.contentWindow
      let loaded = false, hasWp = false, caps = null, res = null, repoRenderer = false, error = ''
      try { loaded = !!(w && w.document && w.document.readyState === 'complete') } catch (e) { loaded = true }
      try { hasWp = !!(w && w.__wp) } catch (e) { /* 跨源 */ }
      try { caps = (w && w.__mpwHostCaps) || null } catch (e) { /* 跨源 */ }
      try { res = (w && (w.__mpwLiveRes || w.__mpwResTier)) || null } catch (e) { /* 跨源 */ }
      try { repoRenderer = !!(w && (w.__mpwHostApiReady || w.__mpwResTier || typeof w.__mpwAudioBandInfo === 'function')) } catch (e) { /* 跨源 */ }
      // 反代上游没起来时本服务回的是 502 + JSON（iframe 会把它当文档渲染）⇒ 认出这具"尸体"，如实写原因
      try {
        const txt = (w && w.document && w.document.body) ? String(w.document.body.textContent || '').slice(0, 300) : ''
        if (/渲染器上游不可达|渲染器上游地址配错/.test(txt)) error = (txt.match(/"error"\s*:\s*"([^"]{0,120})"/) || [])[1] || 'upstream-502'
      } catch (e) { /* 跨源 */ }
      /* ⑧(P-228f 2026-10-05) **文档年龄**：刚 (重新) 挂载的那一两秒里 `__mpwHostApiReady` /
         `__mpwAudioBandSource` 本来就还没发布 ⇒ 状态行不许把"还没跑到"写成"这个渲染器不认"。 */
      let docAgeMs = null
      try { if (w && w.performance && w.performance.timeOrigin) docAgeMs = Date.now() - w.performance.timeOrigin } catch (e) { /* 跨源 */ }
      return { src, loaded, hasWp, caps, res, repoRenderer, error, docAgeMs }
    } catch (e) { return null }
  }
  function paintRendererSrcStatus() {
    const plan = rendererSourceStatusPlan(curLang, rendererSrcNow(), rendererSrcProbe())
    const el = rendererSrcStatusEl()
    if (el) {
      try {
        el.textContent = plan.text
        el.setAttribute('data-mpw-renderer-src', plan.attrs.src)
        el.setAttribute('data-mpw-renderer-ready', plan.attrs.ready)
      } catch (e) { /* 桩 DOM */ }
    }
    return plan
  }
  {
    const sel = rendererSrcSelect()
    if (sel) {
      try { sel.value = rendererSrcNow() } catch (e) { /* 桩 DOM */ }     // 归一（HTML 缺省已是 repo）
      sel.addEventListener('change', () => {
        const mode = rendererSourceMode(sel.value)
        try { if (sel.value !== mode) sel.value = mode } catch (e) { /* ignore */ }
        const remounted = remountRendererForBandFeed()
        let rewritten = false
        /*  ⑦(2026-09-25 用户第 7 条) 「未选择壁纸」这一档：**只切档位，不重挂任何壁纸**。
            改前这条链会走到产物「重挂载」(`Ae()`)，而 `Ae()` 读的是产物自己的 `w`（最后一次挂载的那张）
            ⇒ 把用户已经叉掉的那张又挂回来（`#frame.src` 从 `about:blank` 变回 `…&src=<id>…`）。
            现在：换档那一刻先判"是不是真的没选" —— 没选就一个字都不写进预览、也不谎报"已重写 URL"，
            只如实说"档位已记住，下次挂载生效"。 */
        const empty = nothingSelectedNow()
        if (!remounted && frameEl && !empty.empty) {
          //  产物自己的「重挂载」只在"已有已挂载壁纸"时重设 src；本仓档下预览可能是**导航到样例**
          //  （没有产物那侧的 `w`）⇒ 换档后 src 会停在旧渲染器上（真机实测：切回上游后 iframe 还是
          //  `/webloader/`）。这条兜底把**当前 URL 按新档位重写一次**，走的还是同一条改写链（幂等）。
          try {
            const cur = String(frameEl.getAttribute('src') || '')
            if (cur) { frameEl.src = rendererSourceUrl(cur, mode, rendererDprOpts()); rewritten = true }
          } catch (e) { /* 保持原样 */ }
        }
        const plan = paintRendererSrcStatus()
        logLine(t(curLang, 'log.rendererSrcSwitch', { mode: rendererSourceLabel(curLang, mode), detail: plan.text }))
        if (!remounted) {
          logLine(t(curLang,
            empty.empty ? 'log.rendererSrcEmpty' : (rewritten ? 'log.rendererSrcRewrote' : 'log.rendererSrcNoMount'),
            empty.empty ? { mode: rendererSourceLabel(curLang, mode) } : undefined), !empty.empty)
        }
      })
    }
    const dprEl = (() => { try { return $('#dpr') } catch (e) { return null } })()
    if (dprEl) dprEl.addEventListener('change', () => { rendererDprTouched = true; paintRendererSrcStatus() })
    /* ②③(P-228f 2026-10-05) 三个新档位：去除开屏动画 / Web 渲染模式 / 流式播放。
       行为与既有档位一致：**存 localStorage + 重挂载一次**（走产物自己的「重挂载」路径，
       同一条 URL 改写链把 ?skipintro= / ?webmode= / ?hybrid= 带进预览）。
       缺省值：开屏动画=不跳过（关）、Web 渲染=沙箱、流式播放=**开**（用户口径）。 */
    const flagDefs = [
      { id: 'intro-skip', store: 'bench-intro-skip', kind: 'check', def: false, label: () => t(curLang, 'toolbar.introSkip') },
      { id: 'web-mode', store: 'bench-web-mode', kind: 'select', def: 'compat', label: () => t(curLang, 'toolbar.webMode') },
      { id: 'hybrid', store: 'bench-hybrid', kind: 'check', def: true, label: () => t(curLang, 'toolbar.hybrid') },
    ]
    /* ③(P-228g 2026-10-05) **Web 壁纸预检**（插件 `probeWebWallpaper()` 的**消费侧那一半**：
       `dsh-mpkg-wallpaper/docs/WEB-WALLPAPER.md` §3.4 写明"直接读这两个布尔画标记即可"，本仓一直没接）。
       选中一张 web 壁纸时问一眼服务端 `/api/web-probe?item=`（判定核心 `core/web-precheck.mjs`），
       把两个标记画在舞台右下角的状态片 + 写输出区；机读读数 `window.__benchWebProbe = {item, probe}`。 */
    {
      const badge = (() => { try { return $('#stage-badge') } catch (e) { return null } })()
      const listBox = (() => { try { return $('#list') } catch (e) { return null } })()
      let lastProbed = null
      const paint = (item, probe) => {
        try { window.__benchWebProbe = { item, probe } } catch (e) { /* 无 window */ }
        const flags = []
        if (probe.heavy) flags.push(t(curLang, 'webProbe.heavy'))
        if (probe.external) flags.push(t(curLang, 'webProbe.external'))
        if (badge) {
          try {
            /* 属性用**稳定 token**（heavy/external/ok）供机读，人读文案进 text/title。 */
            badge.setAttribute('data-mpw-webprobe', [probe.heavy ? 'heavy' : '', probe.external ? 'external' : ''].filter(Boolean).join('+') || 'ok')
            if (flags.length) {
              badge.textContent = t(curLang, 'webProbe.badge', { flags: flags.join(' / ') })
              badge.title = (probe.reasons || []).join('\n')
              badge.hidden = false
            } else { badge.hidden = true; badge.textContent = ''; badge.removeAttribute('title') }
          } catch (e) { /* 桩 DOM */ }
        }
        const reasons = (probe.reasons || []).join('；')
        logLine(t(curLang, flags.length ? 'log.webProbeWarn' : 'log.webProbeOk',
          { id: item, flags: flags.join('+'), reasons }), flags.length > 0)
      }
      const run = (item) => {
        /* 类型判定在服务端（与 `/api/library` 同一套 `libraryItemFromDir`）：非 web 项回 `probe:null`
           ⇒ 这里只认 `d.probe`，客户端不再自己猜类型。 */
        if (!item || lastProbed === item) return
        lastProbed = item
        try {
          fetch('/api/web-probe?item=' + encodeURIComponent(item))
            .then((r) => (r && r.ok ? r.json() : null))
            .then((d) => { if (d && d.probe) paint(item, d.probe) })
            .catch(() => { /* 无后端（静态托管）⇒ 静默不报 */ })
        } catch (e) { /* 无 fetch */ }
      }
      const selectedId = () => {
        try {
          const li = listBox && listBox.querySelector ? listBox.querySelector('li.active') : null
          return li ? String(li.dataset.id || '') : ''
        } catch (e) { return '' }
      }
      /* 两条路径都要（真机踩到）：
         ① **捕获期** click —— 产物自己的列表委托在冒泡里可能 `stopImmediatePropagation`，冒泡监听收不到；
            捕获期还能在 `.active` 生效**之前**拿到被点的那一项（所以直接读 `closest('li[data-id]')`，
            不去读 `.active`）。
         ② MutationObserver 带 `childList` —— 产物换选中项时常是**重建 li**（新节点自带 active），
            只盯 `attributes:['class']` 会完全收不到。 */
      if (listBox && listBox.addEventListener) {
        listBox.addEventListener('click', (ev) => {
          try {
            const li = ev.target && ev.target.closest ? ev.target.closest('li[data-id]') : null
            if (li) run(String(li.dataset.id || ''))
          } catch (e) { /* 桩 DOM */ }
        }, true)
      }
      if (listBox && typeof MutationObserver === 'function') {
        try {
          const mo = new MutationObserver(() => { const id = selectedId(); if (id) run(id) })
          mo.observe(listBox, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
          try { window.__benchWebProbeObserver = mo } catch (e) { /* 无 window */ }
        } catch (e) { /* 桩 DOM */ }
      }
    }
    /*  ⑨(P-228f 2026-10-05) 滤镜：把 `#fx` 的档位落到预览舞台的 CSS filter 上。
        （原实现只有下拉选项、没有消费者 ⇒ 真机"改滤镜不生效"；映射表见模块级 `filterPlan()`。） */
    {
      const fxEl = (() => { try { return $('#fx') } catch (e) { return null } })()
      const stageEl = (() => { try { return $('#stage') } catch (e) { return null } })()
      const apply = (v, log) => {
        const plan = filterPlan(v)
        const css = plan.css
        try { if (stageEl) stageEl.style.filter = css } catch (e) { /* 桩 DOM */ }
        try { if (stageEl) stageEl.setAttribute('data-mpw-filter', plan.value) } catch (e) { /* 桩 DOM */ }
        if (log) logLine('滤镜：' + plan.value + (css ? '（CSS filter: ' + css + '）' : '（不套滤镜）'))
        return plan
      }
      if (fxEl) {
        let savedFx = null
        try { savedFx = localStorage.getItem('bench-filter') } catch (e) { /* 无存储 */ }
        if (savedFx) { try { fxEl.value = savedFx } catch (e) { /* 桩 DOM */ } }
        apply(fxEl.value, false)
        fxEl.addEventListener('change', () => {
          try { localStorage.setItem('bench-filter', String(fxEl.value || 'none')) } catch (e) { /* 无存储 */ }
          apply(fxEl.value, true)
        })
      }
    }
    for (const def of flagDefs) {
      const el = (() => { try { return $('#' + def.id) } catch (e) { return null } })()
      if (!el) continue
      let saved = null
      try { saved = localStorage.getItem(def.store) } catch (e) { /* 无存储 */ }
      try {
        if (def.kind === 'check') el.checked = saved === null ? !!def.def : saved === '1'
        else if (saved) el.value = saved
      } catch (e) { /* 桩 DOM */ }
      el.addEventListener('change', () => {
        const val = def.kind === 'check' ? (el.checked ? '1' : '0') : String(el.value || '')
        try { localStorage.setItem(def.store, val) } catch (e) { /* 无存储 */ }
        const remounted = remountRendererForBandFeed()
        if (!remounted && frameEl) {
          try {
            const cur = String(frameEl.getAttribute('src') || '')
            if (cur) frameEl.src = rendererSourceUrl(cur, rendererSrcNow(), rendererDprOpts())
          } catch (e) { /* 保持原样 */ }
        }
        logLine((def.label ? def.label() : def.id) + ' = ' + (def.kind === 'check' ? val : val) + (remounted ? '' : '（当前无已挂载壁纸：档位已记住，下次挂载生效）'), !remounted)
      })
    }
  }
  /* ═══ MPW-PARALLAX-WIRING-BEGIN ⑦(2026-10-12 用户 :8902 第 2/3 条页面侧根因 C) 视差档接线 ═══
     为什么单独一块、不走上面那条通用档位链：视差有**两个入口** —— 勾选框（`1`/`0`）与本页 URL 的
     A/B 值（`?parallax=legacy` / `official`，主表登记的用法），而通用链只认"控件值"。
     行为：勾选 = `1`（开·官方公式）/ 取消 = `0`（关 = 渲染器缺省）；载入时按 `parallaxMode`
     （URL > localStorage > `1`）回填勾选态；改动 ⇒ 存 localStorage + 重挂载（或按当前档重写预览 URL，
     与通用链同一条）；`?parallax=legacy|official` 到达时勾选态显示"开"、预览 URL 原样带那个值。
     缺省 **开** 的理由与回退：见 `demo/index.html` 的 MPW-PARALLAX-FLAG 段（一键可关）。 */
  {
    const parallaxEl = (() => { try { return $('#parallax') } catch (e) { return null } })()
    if (parallaxEl) {
      try { parallaxEl.checked = parallaxMode !== '0' } catch (e) { /* 桩 DOM */ }
      try {
        parallaxEl.addEventListener('change', () => {
          parallaxMode = parallaxEl.checked ? '1' : '0'
          try { localStorage.setItem('bench-parallax', parallaxMode) } catch (e) { /* 无存储 */ }
          const remounted = remountRendererForBandFeed()
          if (!remounted && frameEl) {
            try {
              const cur = String(frameEl.getAttribute('src') || '')
              if (cur) frameEl.src = rendererSourceUrl(cur, rendererSrcNow(), rendererDprOpts())
            } catch (e) { /* 保持原样 */ }
          }
          logLine(t(curLang, 'toolbar.parallax') + ' = ' + parallaxMode + (remounted ? '' : '（当前无已挂载壁纸：档位已记住，下次挂载生效）'), !remounted)
        })
      } catch (e) { /* 桩 DOM */ }
    }
  }
  /* ═══ MPW-PARALLAX-WIRING-END ═══ */
  /* ①(P-228e 2026-10-04) 参数栏两条 UI 纪律（都在 `#toolbar` 这一层，不改任何控件实现）：
     1) **可收起**：在工具条最前面插一行 `#bar-row`（收起/展开按钮 + 一句提示）；
        收起 = 给 `#toolbar` 加 `.bar-off`（只留这一行），档位存 localStorage（刷新保持）。
     2) **命中区对称化**：`<label>` 把文字与控件包在一起 ⇒ 点文字能展开（label 行为）、但点文字**收不起来**
        （收起只认控件本身）。这里在 `#toolbar` 上做一次捕获期 click：点在 label 的文字上（不是控件/按钮里）
        就转发给该 label 内增强控件自己的按钮 ⇒ 同一个热区开/关都成立。 */
  const barCollapseKey = 'mpw-bench-bar'
  function paintBarRow() {
    const tb = (() => { try { return $('#toolbar') } catch (e) { return null } })()
    const row = (() => { try { return $('#bar-row') } catch (e) { return null } })()
    if (!tb || !row) return null
    const off = tb.classList.contains('bar-off')
    const btn = row.querySelector('button')
    if (btn) {
      btn.textContent = off ? t(curLang, 'bar.expand') : t(curLang, 'bar.collapse')
      /* ⑩(P-228f) 提示文字不再占位（用户要求第 4 行"收起参数栏"旁不要文字）⇒ 只用按钮自身的 title。 */
      try { btn.setAttribute('title', off ? t(curLang, 'bar.expandTip') : t(curLang, 'bar.collapseTip')) } catch (e) { /* 桩 DOM */ }
    }
    try { row.setAttribute('data-bar', off ? 'off' : 'on') } catch (e) { /* 桩 DOM */ }
    return { off }
  }
  function setBarCollapsed(off) {
    const tb = (() => { try { return $('#toolbar') } catch (e) { return null } })()
    if (!tb) return false
    try { tb.classList.toggle('bar-off', !!off) } catch (e) { return false }
    try { localStorage.setItem(barCollapseKey, off ? 'off' : 'on') } catch (e) { /* 无存储 */ }
    paintBarRow()
    return true
  }
  {
    const tb = (() => { try { return $('#toolbar') } catch (e) { return null } })()
    if (tb) {
      let row = null
      try { row = $('#bar-row') } catch (e) { /* 桩 DOM */ }
      if (!row && doc && doc.createElement) {
        row = doc.createElement('div')
        row.id = 'bar-row'
        const btn = doc.createElement('button')
        btn.type = 'button'
        btn.textContent = t(curLang, 'bar.collapse')
        btn.addEventListener('click', () => setBarCollapsed(!tb.classList.contains('bar-off')))
        /* ⑩(P-228f 2026-10-05) 收起按钮属于**第 4 行**（动作行）的第一个控件；旁边那句提示文字已去掉
           （用户要求：不收文字、只收参数，提示留给按钮自身的 title）。 */
        try { btn.setAttribute('title', t(curLang, 'bar.collapseTip')) } catch (e) { /* 桩 DOM */ }
        row.appendChild(btn)
        const row4 = (() => { try { return $('#tb-row4') } catch (e) { return null } })()
        const host = row4 || tb
        try { host.insertBefore(row, host.firstChild) } catch (e) { try { host.appendChild(row) } catch (e2) { /* 桩 DOM */ } }
      }
      let saved = null
      try { saved = localStorage.getItem(barCollapseKey) } catch (e) { /* 无存储 */ }
      if (saved === 'off') setBarCollapsed(true); else paintBarRow()
      /* ④(2026-10-04) 先把工具条里的 `<select>` **逐个增强**（`mpw-select.js` 的 `enhanceSelect`：
         根 `span.mpw_select` + 可切换按钮 + `data-open`/`aria-expanded` 状态）。
         为什么必须增强：**原生 select 的下拉无法程序化关闭** ⇒ "点 label 文字能开、却关不掉"（只有点原框才行）；
         增强控件是普通 DOM + 可切换按钮 ⇒ 同一个热区开/关都成立。已经增强过的（有 `__mpwSelectHandle`）跳过。 */
      try {
        const sels = tb.querySelectorAll ? tb.querySelectorAll('select') : []
        for (const sel of sels) {
          if (!sel || sel.__mpwSelectHandle) continue
          /*  ④(2026-10-04 四改) **跳过"已经有可见按钮的自绘控件里的 select"**：测试台「分辨率」是
              `.bench-rd`（自己的 `button[aria-expanded]` + 浮层），里面的 `#resolution` 只是值容器。
              增强它只会多出一个隐藏 widget，并让 `__mpwSelectHandle` 在"点文字"这条路上抢走本该给
              可见按钮的点击 ⇒ 观感就是"文字能开、关不掉"。 */
          try { if (sel.closest && (sel.closest('.bench-rd') || sel.closest('.mpw_select'))) continue } catch (e) { /* 桩 DOM */ }
          try { enhanceSelect(sel) } catch (e) { /* 单只失败不影响其它 */ }
        }
      } catch (e) { /* 桩 DOM */ }
      tb.addEventListener('click', (ev) => {
        try {
          const el = ev.target
          if (!el || !el.closest) return
          if (el.closest('button, select, input, textarea')) return          // 控件自己处理
          /*  ⑦(2026-10-12 用户 :8902 第 2/3 条「视差看不到」的页面侧接线) **自绘下拉的浮层也是"控件自己的面"**：
              下面那条"带框控件旁边的文字不再是热区"的 `stopPropagation()` 会**连浮层里的选项一起杀掉**
              —— `.bench-rd-list li`（`bindDropdown` 的选项）与 `.mpw_select_list` 里的条目既不是 button
              也不是 input ⇒ 一路落到那一条上被 `preventDefault + stopPropagation`。
              实测（无头 Firefox，本仓工具条）：点 `li` 后 **select.value 不变、浮层不关**；对照实验
              `#web-mode` 同样如此 ⇒ **不是本轮引入**，是 2026-10-05 P-228f ⑥ 那条命中区规则的附带伤害
              （工具条里每个 label 内的自绘下拉都受影响）。修法只加一条早退：浮层里的点击放过，
              文字热区那条规则逐字不变（M7/M8 门禁照旧断言 `boxed` / `isCheckRow` 两行在位）。
              ⚠ 还要 `preventDefault()`：`<label>` 的**默认激活**会把这次点击再转发给它关联的控件
              （= 同一个 label 里第一个 labelable 元素 = `.bench-rd-btn`）⇒ 浮层被 `close()` 之后又被
              转发的那一下**重新打开**（实测：选完值浮层不关）。只拦默认动作、不拦传播 ⇒ 选项自己的
              `click` 处理器照常跑（`sel.value` 改写 + 派发 `change`），浮层选完即关。 */
          if (el.closest('.bench-rd-list, .mpw_select_list')) { try { ev.preventDefault() } catch (e) { /* 合成事件 */ } ; return }
          const label = el.closest('label')
          if (!label || !label.querySelector) return
          /* ⑥(P-228f 2026-10-05) **带框控件的"旁边文字"不再是热区**：
             `<label>` 的原生激活会把点在这行文字上的点击转发给行内的下拉/输入 ⇒ 鼠标放在
             「分辨率」这几个字上也能把下拉打开/关掉，并且那一拍触发框还会吃到灰底 —— 观感就是
             "我没点框，框却被选中了"。**勾选框行不在此列**（`.check` 的文字本来就是它的标准热区，
             那条命中区口径见 P-228e 四改）。
             所以：点在这行的文字（不是控件、不是勾选框行）上 ⇒ 取消原生激活，什么都不发生；
             控件自己的框（`.bench-rd-btn` / `select` / `input`）照旧由它自己处理（上面的早退）。 */
          const boxed = label.querySelector('.bench-rd, .mpw_select, select, input[type="text"], input[type="number"], input[type="search"], input[type="color"]')
          const isCheckRow = !!label.querySelector('input[type="checkbox"], input[type="radio"]')
          if (boxed && !isCheckRow) {
            try { ev.preventDefault() } catch (e) { /* 合成事件 */ }
            try { ev.stopPropagation() } catch (e) { /* 合成事件 */ }
            return
          }
          const ctl = label.querySelector('button, select, input, textarea')
          if (ctl) return                                   // 原生激活（disabled 控件即"这行本来就不可用"）
          const btn = label.querySelector('.bench-rd-btn, .mpw_select_btn, [aria-haspopup], [aria-expanded]')
          if (btn && btn !== el) { try { btn.click() } catch (e) { /* 合成事件 */ } }
        } catch (e) { /* 命中区转发失败不影响默认行为 */ }
      }, true)
    }
  }
  // 档位 → iframe URL：装在同一条 src 包装链上（幂等；没有 iframe 原型的环境静默降级）。
  installRendererSourceSrcHook((typeof HTMLIFrameElement !== 'undefined') ? HTMLIFrameElement.prototype : null, rendererSrcNow, rendererDprOpts)
  paintRendererSrcStatus()
  /** ⑪ 预览里隐掉**本仓渲染器页自己的开发用外壳**（顶栏/显示选项条、属性面板、日志面板、音频面板）。
   *  为什么需要：产物页是"一张裸画布"，本仓渲染器页是带面板的开发页 —— 直接嵌进来会在预览里套一层
   *  与本页重复的属性面板/日志，挤掉画面。这是**呈现层**处理（只注入一条 CSS），不改渲染器页；
   *  上游产物档下这些 id 根本不存在（注入是空操作，且不会重复注入：按 `<style id>` 判重）。
   *  用 `!important` 是因为那些面板自带内联 `display`（面板脚本会写 inline style）。
   *  ⚠⑥(2026-09-24 用户第 6 条「预览先闪一下整页」的**客户端侧根因**)：旧实现走 `rendererWin()`
   *    ——那个函数要求 `w.__wp` **已经存在**（渲染器脚本跑完才有的 API）⇒ 这条 CSS 最早也只能在
   *    "取包 + 首帧"之后才注入，而页面外壳在**首屏解析时**就画出来了 ⇒ 那 1 秒的外壳就是它。
   *    现在改成直接读 `frameEl.contentDocument`（同源就够，不等 `__wp`），并且：
   *      · 在 **arm()（换 src = 新一次挂载）时就注入**，与"首帧黑幕"同时生效；
   *      · 服务端 `?shell=0` 再兜一层（外壳从解析期就 `display:none`）——两道防线互不依赖。 */
  function applyRepoChromeHide() {
    try {
      const d = (() => { try { return (frameEl && frameEl.contentDocument) ? frameEl.contentDocument : null } catch { return null } })()
      if (!d || !d.head) return false
      try { if (d.getElementById('bench-repo-chrome-hide')) return true } catch (e) { return false }
      const st = d.createElement('style')
      st.id = 'bench-repo-chrome-hide'
      st.textContent = '#bar,#fps,#logbar,#log,#mpw-props-panel,#mpw-props-btn,#mpw-audio-panel,#mpw-audio-btn,#__mpwLnTag{display:none!important}'
      d.head.appendChild(st)
      return true
    } catch (e) { return false }
  }

  // ── ⑧(2026-09-18 品牌改名) 站点品牌运行期覆盖 ──
  //   目标：用户**看得见的地方**（头部品牌名 + document.title）显示产品现名 `WEwebLoader`，版本号 `v1.3.16`
  //   照旧跟在后面（`#app-version` 由产物启动时写一次，本函数不碰）。
  //   为什么是运行期覆盖：静态 HTML 的 `<title>` 与 DICT 的 `app.title` 分别是门禁 T8（产物接线）与
  //   T1（词典必须逐条等于上游 bench/i18n.ts）的钉子，`demo/assets/*.js` 又是"不改一个字节"的许可口径
  //   ⇒ 产品名只能在呈现层覆盖。回退口：`?appname=upstream`（或 `?brand=upstream`）还原上游名。
  //   必须在 `applyStaticI18n` **之后**跑：它会把带 `data-i18n="app.title"` 的品牌名写回上游名。
  function applySiteBrandNow() {
    const brandEl = (doc.querySelector && (doc.querySelector('[data-i18n="app.title"]') || doc.querySelector('#site-brand .brand-name'))) || null
    const plan = applySiteBrand({ override: FLAGS.appname, upstreamTitle: t(curLang, 'app.title'), brandEl, doc })
    try { if (typeof window !== 'undefined') window.__benchBrandPlan = plan } catch { /* 桩 DOM */ }
    return plan
  }

  // ── ③ 语言切换：把所有**已渲染文本**（含 bundle 覆盖不到的动态面板）并入切换链 ──
  //   ⚠ 顺序硬要求（父任务）：**先 sweep 已渲染文本，再 repaint**。反过来的话，刚被 repaint
  //     写好的新语言标签会被 sweep 当成"已渲染文本"再翻一次（T4 的零残留断言就是防这个）。
  function applyLang(next) {
    const to = next === 'zh' ? 'zh' : 'en'
    if (to !== curLang) {
      const from = curLang
      curLang = to
      const r = sweepRendered(doc.body, from, to, doc)          // 1) 先翻译"已渲染"的动态文本
      if (r && r.missed && r.missed.length) console.info('[bench-patch] 未命中的待翻译文本(' + r.missed.length + '):', r.missed.slice(0, 8))
    }
    applyStaticI18n(doc, curLang)                              // 幂等：补上 bundle 尚未重渲染的 data-i18n 节点
    applyTitle(doc, curLang)                                   // 窗口/标签页标题
    applySiteBrandNow()                                        // ⑧品牌名覆盖（必须在 applyStaticI18n 之后）
    paintDpr(); paintLogsIcon(); paintDiag(); paintFs(); trailGate()   // 2) 再 repaint（参数化/双态/离线态/门控）
    paintDbgTab()                                    // ⑧ 语言切了也要把 `调试模式·ON/OFF` 重写一遍
    try { lswPaintChrome(); if (lswOpen) lswPaintRows() } catch { /* P-240 图层开关：桩 DOM 时静默 */ }   // P-240：弹层文案/状态行/禁用原因随语言重画
    paintFps(); paintUppercaseLabels(); paintBackendNote()      // ⑷⑸⑺ 无上限状态、大小写、后端说明
    syncAllLabels()                                            // 3) 最后统一重写补丁注入控件的标签
    injectReadme(); renderLocal(); closePicker(); fixStaticNotice()
    if (typeof paintOnlineNotice === 'function') paintOnlineNotice()   // P-93：在线横幅随语言
    // 第五批：语言切换后补一次时间层锁文案/品牌中性文案（brand.generic 随语言变）+ 时间层锁重扫
    if (FLAGS && FLAGS.clocklock) lockTimeLayersEverywhere()
    if (mediaBrand && mediaBrand.source === 'neutral') { mediaBrand.title = t(curLang, 'brand.generic'); applyMediaBranding() }
  }

  // ── 补丁注入/接管控件的**标签同步清单**（改这里 = 改覆盖范围；T18 会核对清单里每个 id 都在 index.html 里）──
  const LABEL_SPEC = [
    ['#status-dpr', 'text', 'status.dpr', true],      // 带参 → 由 paintDpr 处理，这里只登记
    ['#status-fps', 'text', 'status.cap', true],      // 带参/无上限两态 → 由 paintFps 处理，这里只登记
    ['#copy-logs', 'text', 'copy.logs'],
    ['#copy-url', 'text', 'copy.url'],
    ['#fs-enter', 'text', 'fs.enter'],
    ['#fs-exit', 'text', 'fs.exit'],
    ['#offline-tag', 'text', 'offline.tag'],
    ['#bench-error-title', 'text', 'error.title'],
    ['#bench-error-note', 'text', 'error.logged'],
    ['#bench-error-close', 'text', 'error.dismiss'],
    ['#clear-local', 'text', 'local.clear'],
    ['#clear-local', 'title', 'local.clearTitle'],
    ['#pick-lib', 'title', 'local.pickTitle'],
    ['#pick-file', 'title', 'pick.fileTitle'],        // 第七批：插件同款「选择文件」入口（弹窗里的文案由 dirPaintChrome 随语言重画）
    ['#copy-logs', 'title', 'copy.logs'],
    ['#trail-len', 'title', 'trail.len'],
    ['#trail-w', 'title', 'trail.width'],
    ['#trail-color', 'title', 'trail.color'],
    ['#trail-box', 'title', 'trail.tip'],
    ['#bench-local', 'skip', null],                   // 由 renderLocal 渲染（带类型标签）
    ['#bench-rd-btn', 'skip', null],
    // 第五批④：文档页底部的**原作者归属外链**（赞赏卡片已删；这两个节点故意不挂 data-i18n ——
    // 旧 bundle 的词典里没有 credit.* 键，挂了会被它的 applyStatic 写成键名原文）
    // ①(第七批修，2026-09-17) 页脚 #bench-credit 里那对**曾经复用同样的 id**（同页两处同 id ⇒ querySelector
    // 只认文档视图那份，页脚永远不随语言切换）⇒ 页脚改成 *-footer 专名，两条一起同步（T31 通用唯一 id 断言盯着）。
    ['#credit-title-footer', 'text', 'credit.title'],
    ['#credit-link-footer', 'text', 'credit.link'],
    /* ①(用户第 5 条实测根因) **不要**对 `#credit-line-footer` 做 `text` 重放：`textContent = …` 会把
       容器里的 `<a>` 整个抹掉（实测 live DOM 里 `#credit-link-footer` 不存在 ⇒ 链接当然点不动）。
       链接自己的 `data-i18n="credit.link"` 由**静态 i18n 那一遍**负责，这里什么都不做。 */
  ]
  function syncAllLabels() {
    for (const [sel, kind, key, skip] of LABEL_SPEC) {
      if (skip || !key) continue
      const el = $(sel)
      if (!el) continue
      if (kind === 'text') el.textContent = t(curLang, key)
      else if (kind === 'title') el.setAttribute('title', trailOrPickTitle(sel, key))
    }
    for (const d of dropdowns) d.label()                        // 自绘下拉触发器（#lang/#resolution/#fit/#dpr/#fps/#fx）
    // ⑦(P-158) 输出页签 / 诊断视图要在 init 这一侧跟着语言重画（它们在 init 作用域里）
    try { paintLogsTabs(); paintDiagBody() } catch { /* 桩 DOM */ }
    // ③(P-158) 属性面板的 mpw 下拉按钮文案兜底（`paintButton` 在首次展开前只写「（空）」）
    try { syncMpwLabels(doc) } catch { /* 属性面板还没渲染 */ }
    // ⑨⑩ 类型开关 / 库列表面板 / 库来源在 initSiteShell 那一侧：由它自己的 refresh 钩子重画
    const themeBtn = $('#theme-toggle')                         // 主题按钮 title 随模式+语言
    // ⑫c 只认**两态**：万一旧缓存 HTML 里残着 'auto'，也不许把"主题：跟随系统"写回标题
    if (themeBtn && themeBtn.dataset && (themeBtn.dataset.mode === 'dark' || themeBtn.dataset.mode === 'light')) themeBtn.title = t(curLang, 'theme.' + themeBtn.dataset.mode)
    paintDpr(); paintLogsIcon(); paintFps(); paintUppercaseLabels()   // 状态栏两格：bundle 会写旧文案，必须最后覆盖
    // ⑩(2026-09-21 §5.3) 音条源状态行也按当前语言重画（它由 t() 拼出，sweepRendered 认不出整句）
    try { paintBandFeedStatus() } catch { /* 桩 DOM */ }
    try { if (typeof window !== 'undefined' && typeof window.__benchShellRefresh === 'function') window.__benchShellRefresh() } catch { /* 外壳未初始化（测试桩）：忽略 */ }
  }
  // #pick-lib 的 title 在静态托管下要显示"选择本地文件夹"的原因（gate 时显示 needInjection 同款逻辑）
  function trailOrPickTitle(sel, key) {
    if (sel === '#trail-box') {
      const injection = !!(pushEl && pushEl.checked)
      return t(curLang, injection ? 'trail.tip' : 'trail.needInjection')
    }
    if (sel === '#pick-lib') {
      return t(curLang, canPickViaInput() || canShowDirPicker() ? 'local.pickTitle' : 'local.unsupported')
    }
    return t(curLang, key)
  }
  // ⑵ bundle 自己 append 的静态提示文案仍写着「打开本地 .pkg」（它那份词典烘死在 minified 产物里）。
  //    这里把节点文本改回本补丁的新词典；bundle 每次 renderList 都会重建它，所以挂在 MutationObserver 上。
  function fixStaticNotice() {
    const listEl2 = $('#list')
    if (!listEl2) return
    for (const n of listEl2.querySelectorAll('.static-notice')) {
      if (n.textContent !== t(curLang, 'static.notice')) n.textContent = t(curLang, 'static.notice')
      if (n.dataset) n.dataset.i18n = 'static.notice'      // 让 applyStaticI18n/语言切换继续管它
    }
  }
  const listWatchEl = $('#list')
  if (listWatchEl && typeof MutationObserver === 'function') {
    new MutationObserver(() => fixStaticNotice()).observe(listWatchEl, { childList: true, subtree: true })
  }
  fixStaticNotice()

  // ⑵⑶⑻ 已删功能留下的「兼容锚点」：节点只是让旧 bundle 不 NPE，这里再把处理器摘掉，双保险。
  // ⚠ P-158（用户补充要求「MPKG 各类包括 Web 壁纸都可以」）**`#type-filter` 从这个清单里去掉了**：
  //   它不属于"已删功能" —— 恰恰相反，它是产物**唯一的**类型过滤入口（`Xe.onclick` 委托处理器 + `it()` 里的
  //   `Pe`）。旧清单把它一起摘掉并打上 `hidden`，等于把"只看得到 scene"焊死：实测 `#type-filter.onclick===null`
  //   + `hidden=true` ⇒ 列表永远只列 scene（`/api/library` 里的 web 7 / video 4 全被 `rt(n)!==Pe` 过滤掉）。
  //   现在它搬到左侧边栏 `.sidebar-tools` 里、由本补丁生成 4 个 `.seg-btn`（详见 ④b 段）。
  for (const pair of [['#open-pkg', 'onclick'], ['#pkg-file', 'onchange'], ['#sponsor-btn', 'onclick']]) {
    const el = $(pair[0])
    if (!el) continue
    try { el[pair[1]] = null } catch { /* 空元素也可以没有该属性 */ }
    try { el.setAttribute('hidden', ''); el.setAttribute('aria-hidden', 'true') } catch { /* 同上 */ }
    if (el.tagName === 'INPUT') { try { el.removeAttribute('accept'); el.disabled = true } catch { /* 同上 */ } }
  }
  const themeFallback = ensureThemeFallback()      // ① bundle 已接管时返回 false（绝不重复接管）
  /* ⑫c(2026-09-19 用户要求「不要跟随系统」) —— 两态主题的两条落地路径：
     · 兜底路径（bundle 死了）：ensureThemeFallback 里已挂 addEventListener（两态循环），这里不再挂第二条，
       否则真浏览器里一次点击会走两格（属性 onclick + addEventListener 都触发）。
     · bundle 活着：产物 `#theme-toggle.onclick` 是三态循环 ⇒ 这里**用属性赋值换掉它**（属性处理器只有一个，
       赋值即替换；不用 addEventListener 是为了不与兜底那条叠加），并在同一处把历史 'auto' 迁移成具体一态。 */
  try { if (typeof window !== 'undefined') window.__benchThemeSet = (m) => applyThemeMode(m) } catch {}
  if (themeBtn && !themeFallback) {
    // 历史 'auto' 一次性迁移：产物可能刚从 localStorage 读到 'auto' 并用 ze() 写了 data-mode='auto'。
    // ⚠ 只在**明确读到 'auto'** 时迁移：`data-mode` 缺失/异常时不动（否则会把产物已经画好的
    //   `data-theme` 按系统偏好改掉 —— T19 的"bundle 已接管 ⇒ 点击/初始化都不改 data-theme"就是这条）。
    try { if (themeBtn.dataset && themeBtn.dataset.mode === 'auto') applyThemeMode(themePlan('auto', prefersDarkNow()).mode) } catch {}
    themeBtn.onclick = () => applyThemeMode(nextThemeMode(currentThemeMode()))
    // 迁移前 bundle 内部还记着 'auto' ⇒ 系统主题一变它会 ze('auto') 把 data-theme 改回去。
    // 这里在系统主题变化时把我们自己的两态模式**重新钉一次**（迁移过一次后 localStorage 已是 dark/light）。
    try {
      const mq = (typeof matchMedia === 'function') ? matchMedia('(prefers-color-scheme: dark)') : null
      if (mq && typeof mq.addEventListener === 'function') mq.addEventListener('change', () => { applyThemeMode(currentThemeMode()) })
    } catch { /* 无 matchMedia：忽略 */ }
  } else if (themeBtn) {
    // 兜底路径也要把设置弹层两个开关的按下态画对（此时 data-mode 已由 applyThemeMode 写好）
    try { if (typeof window !== 'undefined' && typeof window.__benchShellRefresh === 'function') window.__benchShellRefresh() } catch {}
  }
  paintBackendNote()                              // ⑺ 先按"未探测"渲染一次，探测回来再刷新

  const langEl = $('#lang')
  if (langEl) langEl.addEventListener('change', () => applyLang(langEl.value))

  /* ==================== P-93：在线 demo（GitHub Pages）三件事 ====================
     ① 产物里的硬编码绝对路径 → 相对本页（线上挂在 /demo/ 下，绝对路径会 404）；
     ② 页面上把"在线版没有本机后端"写清楚（静态横幅 + 运行期同源文案）；
     ③ 默认壁纸 = 本仓库自造的**合成样例**（仓库不分发任何真实壁纸）。 */
  const demoPrefix = demoEnv.demoPrefix
  const remap = (u) => demoAssetUrl(u, demoPrefix)

  // ①-a 渲染器 iframe：产物里 3 处 `frame.src = '/wallpaper-engine-webgl/renderer/index.html…'`。
  //   产物是 minified 且**不可重建**（离线装不上依赖），改产物风险大于收益 ⇒ 在 iframe 的
  //   src 属性上做一次前缀改写（①P-127：旧名 `/wallpaper-engine-webgl/` 与新名 `/WEwebLoader/`
  //   两个前缀都认 —— 产物写着旧名，改名后新写的代码用新名；别的 URL 原样放行）。
  try {
    const fr = $('#frame')
    const proto = (typeof HTMLIFrameElement !== 'undefined') ? HTMLIFrameElement.prototype : null
    if (fr && proto) {
      const desc = Object.getOwnPropertyDescriptor(proto, 'src')
      const setter = desc && desc.set
      const getter = desc && desc.get
      if (setter && getter && !proto.__benchDemoRemap) {
        Object.defineProperty(proto, 'src', {
          configurable: true,
          enumerable: true,
          get() { return getter.call(this) },
          set(v) {
            const cur = typeof location !== 'undefined' ? location.href : ''
            if (sitePathAliasOf(v) && (onlineDemoEnv(cur, { force: '1' }).online || demoPrefix !== './')) {
              setter.call(this, remap(v))
            } else setter.call(this, v)
          },
        })
        // 标记打在原型上：重复 init（同一页多次调用）不重复包裹
        try { Object.defineProperty(proto, '__benchDemoRemap', { value: 1, configurable: true }) } catch { /* 冻结的原型（罕见） */ }
      }
    }
  } catch (e) { console.warn('[bench-patch] iframe src 前缀改写跳过：', e && e.message) }

  // ①-a-2 「新窗口」按钮（P-129）：产物里唯一的**非 iframe** 硬编码绝对旧路径 ——
  //   `l("#open").onclick=()=>{w&&window.open(`/wallpaper-engine-webgl/renderer/index.html?${wt(w)}`,"_blank")}`。
  //   同一段产物里 `/…/renderer/index.html` 共 3 处：**2 处**是 iframe 的 `k.src=`（上面 ①-a 拦得到），
  //   第 3 处就是这个 `window.open`（`HTMLIFrameElement.prototype.src` 的 setter **永远**拦不到它）
  //   ⇒ 线上（Pages 子路径站点）点「新窗口」指到域名根 ⇒ 404（P-129 的线上证据）。
  //   守卫与 ①-a **同一套口径**（同一个 `onlineDemoEnv` 判定 + 同一个 `demoPrefix`）：
  //   本机 :8901 的旧路径是软链、原样可用 ⇒ 不改写（与上游逐位同行为）。
  try {
    const openRes = installOpenRemap(typeof window !== 'undefined' ? window : null, {
      enabled: FLAGS.openrewrite,
      online: onlineDemoEnv(typeof location !== 'undefined' ? location.href : '', { force: '1' }).online || demoPrefix !== './',
      prefix: demoPrefix,
    })
    // 只在"本该装上却装不上"时出声：`flag-off`（用户显式 `?openrewrite=off`）、`no-window`（非浏览器 /
    // 假 DOM —— 测试里多次 `init()` 都走这条）、`already`（重复 init）都是**预期**，不打日志。
    if (!openRes.installed && openRes.reason === 'readonly') console.warn('[bench-patch] window.open 前缀改写跳过：' + openRes.reason)
  } catch (e) { console.warn('[bench-patch] window.open 前缀改写跳过：', e && e.message) }

  // ①-b Service Worker：产物末尾确实有 `navigator.serviceWorker.register("/wallpaper-engine-webgl/sw.js").catch(()=>{})`
  //   （P-127 起新名 `/WEwebLoader/sw.js` 同样认 —— 同一份 remap）。
  //   本补丁把脚本 URL 改写成相对本页，**并吞掉失败**：产物那条注册在 /demo/ 挂载下本来就注册不上
  //   （scope 与路径都不对），上游自己也是 `.catch(()=>{})` —— 我们不改这个行为，只求控制台不冒假红。
  //   不主动注册是有意的：线上不留 SW ⇒ 不会出现"旧版本被 SW 缓存住"的经典事故（见 docs/ONLINE-DEMO.md §6）。
  try {
    if (typeof navigator !== 'undefined' && navigator.serviceWorker && typeof navigator.serviceWorker.register === 'function') {
      const swContainer = navigator.serviceWorker
      const swReg = swContainer.register.bind(swContainer)
      swContainer.register = (url, opt) => {
        try { return Promise.resolve(swReg(remap(url), opt)).catch(() => null) } catch { return Promise.resolve(null) }
      }
    }
  } catch { /* 无 SW 支持（file:// / 隐私模式）：无关紧要 */ }

  // ② 在线版横幅：只在"线上形态"下注入；节点 id 固定 `#bench-online-notice`，落地页用同名区块。
  const demoNotice = onlineDemoNotice(curLang)
  const paintOnlineNotice = () => {
    let box = $('#bench-online-notice')
    if (!demoEnv.online) { if (box) box.hidden = true; return null }
    if (!box) {
      box = doc.createElement('section')
      box.id = 'bench-online-notice'
      box.className = 'bench-online-notice'
      const host = $('#statusbar') || doc.body
      host.parentNode ? host.parentNode.insertBefore(box, host) : doc.body.appendChild(box)
    }
    const n = onlineDemoNotice(curLang)
    box.hidden = false
    const strong = doc.createElement('strong'); strong.textContent = n.title
    const p1 = doc.createElement('div'); p1.textContent = n.body
    const p2 = doc.createElement('div'); p2.className = 'bench-online-sample'; p2.textContent = n.sample
    box.textContent = ''
    box.appendChild(strong); box.appendChild(p1); box.appendChild(p2)
    return n
  }
  paintOnlineNotice()

  // ③ 默认壁纸 = 合成样例（`?sample=0` 关掉；`?sample=<url>` 换成别的 URL）。
  //   走渲染器自己的公开契约 `__wp.loadSceneFile(blob, projectJson)`；
  //   project.json 一并喂进去，属性面板/品牌才有名字可用。
  async function loadDefaultSample(explicitUrl) {
    const fr = $('#frame')
    if (!fr) return { ok: false, reason: 'no-frame' }
    // explicitUrl 未给 ⇒ 读 `?sample=`：缺省 = 自动载入合成样例；`?sample=0` = 不载；`?sample=<url>` = 换来源
    let raw = explicitUrl
    if (raw === undefined || raw === null) {
      try {
        const m = String((typeof location !== 'undefined' && location.search) || '').match(/[?&]sample=([^&]*)/)
        raw = m ? decodeURIComponent(m[1]) : ''
      } catch { raw = '' }
    }
    raw = String(raw)
    const plan = defaultSamplePlan({ force: raw })
    if (!plan.auto) return { ok: false, reason: 'sample-flag-off' }
    const abs = (u) => {
      try { return new URL(u, (typeof location !== 'undefined' ? location.href : 'http://127.0.0.1/')).href } catch { return u }
    }
    const pkgUrl = abs(raw !== '' ? raw : plan.sample)
    const projUrl = String(pkgUrl).replace(/scene\.pkg(\?.*)?$/, 'project.json')
    try {
      const rendererApi = await ensureRendererFrame(fr)
      const rs = await fetch(pkgUrl, { cache: 'no-store' })
      if (!rs.ok) throw new Error('HTTP ' + rs.status)
      const buf = await rs.arrayBuffer()
      let project = null
      try { const rj = await fetch(projUrl, { cache: 'no-store' }); if (rj.ok) project = await rj.json() } catch { /* project.json 可选 */ }
      // 必须是带 arrayBuffer() 的对象：渲染器的 source 契约就是 `scenePkg: () => t.arrayBuffer()`
      // （真机实测：裸 ArrayBuffer 会 `t.arrayBuffer is not a function` ⇒ 场景挂载失败）。
      // 用 Blob 而**不是** File：T17 的"定义↔调用"审计会把裸 `new File(` 当成未定义标识符。
      rendererApi.loadSceneFile(new Blob([buf], { type: 'application/octet-stream' }), project)
      const cur = $('#current')
      if (cur) { cur.textContent = 'sample-synthetic'; cur.title = t(curLang, 'demo.onlineSample') }
      const em = $('#empty'); if (em) em.style.display = 'none'
      fr.classList.add('on')
      logLine(t(curLang, 'demo.sampleLoaded', { name: 'sample-synthetic/scene.pkg' }))
      return { ok: true, url: pkgUrl, bytes: buf.byteLength, hasProject: !!project }
    } catch (e) {
      logLine('❌ ' + t(curLang, 'demo.sampleMissing', { msg: String((e && e.message) || e) }), true)
      return { ok: false, reason: String((e && e.message) || e), url: pkgUrl }
    }
  }
  /** 默认 = 本仓渲染器时的"打开就有画面"（2026-09-21 默认翻转的配套）：
   *  把预览**导航**到 `?id=sample-synthetic` —— 与产物页那条 `loadSceneFile(blob)` 是**同一个样例**、
   *  同一份字节（`samples/sample-synthetic/scene.pkg`，本仓库自造、不含第三方内容），
   *  但取包走本仓渲染器的 `/pkg/<id>`（`:8899` 路由，`:8902` 由 `/webloader/pkg/**` 反代）。
   *  返回值形状与 `loadDefaultSample` 对齐（`{ok, url, reason?}`），调用方不必分叉。
   *  `?sample=0` 仍然关得掉（与上游档同一开关口径）；显式 `?sample=<url>` 是"换一个包源"的调试档，
   *  本仓档下**不支持**（那是产物页契约）⇒ 如实返回 `reason` 并写一行日志，不假装成功。 */
  function loadRepoDefaultSample(fr) {
    /* ⑲(2026-09-24 用户第 19 条) 释放之后**不再自愈重挂**：用户已经明确把舞台放掉了，
       这里（以及下面 `loadDefaultSample` 那条上游档路径）都不许再把样例挂回去。 */
    try { if (typeof window !== 'undefined' && window.__benchRelease && window.__benchRelease.quiet()) return Promise.resolve({ ok: false, reason: 'released-quiet' }) } catch { /* 桩环境 */ }
    let raw = ''
    try {
      const m = String((typeof location !== 'undefined' && location.search) || '').match(/[?&]sample=([^&]*)/)
      raw = m ? decodeURIComponent(m[1]) : ''
    } catch (e) { raw = '' }
    const plan = defaultSamplePlan({ force: raw })
    if (!plan.auto) return Promise.resolve({ ok: false, reason: 'sample-flag-off' })
    if (String(raw) !== '' && String(raw) !== plan.sample) {
      logLine(t(curLang, 'log.rendererSrcSampleExplicit'), true)
      return Promise.resolve({ ok: false, reason: 'explicit-url-unsupported-in-repo' })
    }
    //  URL 与产物页那条同形（`type/src/fit/renderDpr/sceneFps/filter/muted/loop`），
    //  再过一遍 `rendererSourceUrl` ⇒ 路径/`id`/`res` 由**同一条改写链**决定，不在这里手拼第二份。
    const q = 'type=scene&src=sample-synthetic&fit=' + encodeURIComponent('cover') + '&renderDpr=1&sceneFps=60&filter=none&muted=true&loop=true'
    const url = rendererSourceUrl('/wallpaper-engine-webgl/renderer/index.html?' + q + '&_t=' + Date.now(), 'repo', rendererDprOpts())
    try {
      if (fr) fr.src = url
      const cur = $('#current')
      if (cur) { cur.textContent = 'sample-synthetic'; cur.title = t(curLang, 'demo.onlineSample') }
      const em = $('#empty'); if (em) em.style.display = 'none'
      if (fr && fr.classList) fr.classList.add('on')
      logLine(t(curLang, 'log.rendererSrcSampleRepo', { url }))
      return Promise.resolve({ ok: true, url, bytes: null, hasProject: false, repo: true })
    } catch (e) {
      logLine('❌ ' + t(curLang, 'demo.sampleMissing', { msg: String((e && e.message) || e) }), true)
      return Promise.resolve({ ok: false, reason: String((e && e.message) || e), url })
    }
  }
  let defaultSample = null
  // 本机静态台（:8901，无 Node host）与线上都载一次 —— "打开就有画面"两边一致；
  // vite 宿主（:1430，hostBlocked=false，有真 Node 后端）不抢它自己的默认壁纸。
  if (HOST_BLOCKED_HERE || demoEnv.online) {
    setTimeout(() => {
      // ⑪(2026-09-21 渲染器来源) 本仓渲染器档下**不载合成样例**：它按 `?id=<itemId>` 取包挂载，
      //   而合成样例那条路走的是产物页的 `__wp.loadSceneFile(blob, projectJson)` 契约（本仓渲染器
      //   明确降级：`window.__mpwHostCaps.loadSceneFile === false`）。不跳过的话每次开页面都会在输出区
      //   留一条红字（"合成样例载入失败：rendererApi.loadSceneFile is not a function"），而那**不是**故障。
      //   上游产物档行为不变（照旧载样例 —— 静态台/线上"打开就有画面"那条口径原样保留）。
      if (rendererSrcNow() === 'repo') {
        // 新契约（默认 = 本仓渲染器）：合成样例在**本仓档**下同样"打开就有画面" —— 但走的是本仓自己的
        // 取包路径（`?id=sample-synthetic` → `/pkg/sample-synthetic`，`demo.html` 的 `/pkg/<id>` 路由，
        // 已实测 200 / 33 299 B），**不是**产物页那条 `__wp.loadSceneFile(blob)` 契约
        // （本仓对该契约明确降级：`window.__mpwHostCaps.loadSceneFile === false`）。
        // 实现方式照旧"不写第二套"：直接**导航预览**到样例 URL，且让它走同一条 src 包装链
        // ⇒ 来源档/`res=dpr`/DPR 上限/`bandfeed` 自动带上。
        defaultSample = loadRepoDefaultSample($('#frame'))   // ⚠ 这里没有 `fr` 绑定（那是 loadDefaultSample 的局部量）—— 实测漏写会 ReferenceError 冒到错误条、挡住整条工具条
        defaultSample.then((r) => { if (r && r.ok) wrapRendererApi() })
        return
      }
      defaultSample = loadDefaultSample()
      defaultSample.then((r) => { if (r && r.ok) wrapRendererApi() })
    }, 1200)
  }

  /* ⑪(用户第 11 条) 首屏"就绪"信号：静态表里 `html.bench-shell:not([data-bench-ready]) body{visibility:hidden}`
     把补丁接管之前的帧挡掉，这里在外壳/列表/日志都画完之后摘闸门（head 里那段脚本另有
     DOMContentLoaded 与 1.2s/3s 两个硬兜底 ⇒ 任何异常路径下都不会白屏）。 */
  function markBenchReady() {
    try { if (typeof window !== 'undefined' && typeof window.__benchReady === 'function') window.__benchReady() } catch { /* 无 head 脚本 */ }
  }

  // 首次同步
  applyLang(curLang)
  paintDiag()
  trailGate()
  paintFs()
  setTimeout(() => { const b = $('#pick-lib'); if (b && b.disabled && !localItems.length) { b.disabled = false; b.title = t(curLang, 'local.pickTitle') } }, 3000)

  syncAllLabels()

  // ── ⑩ 站点外壳（2026-09-17 新样式）：在 syncAllLabels 之后初始化 —— 它要读已本地化的按钮文案。
  //   句柄挂 window（供 syncAllLabels 在语言切换时刷新，不走 TDZ 风险的闭包变量）。 ──
  if (!SHELL_OFF) try {
    window.__benchShell = initSiteShell({
      t, lang: () => curLang, log: (m) => logLine(String(m)), shellVersion: BENCH_SHELL_VERSION, domIsNew: DOM_IS_NEW,
      backendStatus: () => apiStatus,          // ⑩(P-158)「当前库来源」要按后端的真实状态判定（静态托管 vs 本机后端）
    })
    window.__benchShellRefresh = () => {
      try {
        const sh = window.__benchShell
        if (!sh) return
        sh.paintStatus(); sh.paintPropsEmpty(); sh.refreshSwitcher()
        if (typeof sh.paintLangExtras === 'function') sh.paintLangExtras()
        sh.paintLogsArrow(window.__benchMainCollapsed ? window.__benchMainCollapsed() : false)
      } catch { /* 外壳刷新失败不影响页面 */ }
    }
  } catch (e) { logLine('站点外壳初始化失败：' + ((e && e.message) || e), true) }
  // ⑨⑩(P-158) 外壳刚建好 ⇒ 立刻补一次"语言附加面"首画（类型开关 / 库列表面板 / 库来源）：
  //   上面那次 `syncAllLabels()` 跑在外壳之前，那时 `window.__benchShellRefresh` 还不存在。
  try { if (typeof window !== 'undefined' && typeof window.__benchShellRefresh === 'function') window.__benchShellRefresh() } catch { /* 外壳未就绪 */ }

  // ⑪ 外壳与首画都跑完了 ⇒ 摘掉首屏闸门（幂等；head 里的兜底定时器不受影响）
  markBenchReady()
  setTimeout(markBenchReady, 600)

  // 源码侧钩子（bench/bench.ts 调用；重建后若源码自足可删）
  const api = {
    langChanged: (l) => applyLang(l),
    resolutionChanged: () => syncAllLabels(),
    pointerPushChanged: () => trailGate(),
    // A2 源码侧 enterStaticMode() 在支持 webkitdirectory 时把「选择文件夹」委托到这里
    pickLocalFolder: () => pickLocalFolder(),
    // ⑹ 扫描入口与清空（探针/测试用同一入口，浏览器里也能从控制台调用）
    loadLocalEntries: (entries) => loadLocalEntries(entries),
    clearLocalLibrary: (silent) => clearLocalLibrary(!!silent),
    getLocalItems: () => localItems.map((it) => ({ dir: it.dir, title: it.title, kind: it.kind, hasPkg: !!it.pkg })),
    // ⑺ 后端状态（静态托管 / 离线；探针断言用）
    getBackendMode: () => backendMode(backendEnv()).mode,
    getBackendNotice: () => backendNotice(curLang, backendEnv()),
    // ① 主题兜底是否被启用（bundle 活着时应为 false）
    themeFallbackApplied: () => themeFallback,
    showError: (m) => showError(m),
    openColorPicker: (el, hex, cb) => openColorPicker(el, hex, cb),
    syncAllLabels: () => syncAllLabels(),
    getLang: () => curLang,
    // 第五批（用户实测三条 + 归属外链）：开关状态与自检入口（探针/测试用同一入口）
    flags: () => Object.assign({}, FLAGS),
    pointerParkNow: () => parkPointerNow(),
    getPointerPark: () => ({ parked, count: parkCount, enabled: FLAGS.ppark, mode: FLAGS.pparkMode, pushed: parkPushed, lastPush: parkLastPush }),
    //  ④(P-164) 指针转发（注入关闭时的移动即触发）：次数可读 ⇒ 真机与门禁读同一入口
    pointerForward: () => ({ enabled: FLAGS.pushfwd !== false, forwarded: pushFwdCount, nested: stageHasNestedFrame(), why: pushFwdWhy }),
    forwardPointerMove,
    webShim: () => (typeof window !== 'undefined' && typeof window.__benchWebShim === 'function') ? window.__benchWebShim() : Object.assign({}, webShimState),
    //  ②(P-164) 调试模式（探针/门禁读同一批入口）
    setDebugMode: (v) => setDebugMode(v),
    //  ②(用户第 3 条) 调试模式的**两个状态分开读**：mode = 开关；view = 当前页签。切页签不改 mode。
    debugMode: () => dbgActive,
    logsView: () => logsView,
    //  ⑤(用户第 5 条) 麦克风闸门读数（enabled/blocked/installed + 「系统实况」是否被强制关掉）
    micGate: () => micGateState(),
    micSync: () => syncMicGate(),
    //  ⑩(2026-09-21 §5.3) 音条源四档：档位 / iframe 里的真实 URL / 状态行最近一次读数（探针与门禁读同一入口）
    bandFeed: () => ({
      mode: bandFeedNow(), modes: BAND_FEED_MODES.slice(), defaultMode: BAND_FEED_DEFAULT,
      micGateOpen: !!(micEl && micEl.checked),
      src: (() => { try { return String((frameEl && frameEl.getAttribute('src')) || '') } catch (e) { return '' } })(),
      status: bandStatusLast ? Object.assign({}, bandStatusLast) : null,
      text: (() => { try { const el = bandStatusSelect(); return el ? String(el.textContent || '') : '' } catch (e) { return '' } })(),
      attrs: (() => { try { const el = bandStatusSelect(); return el ? { kind: el.getAttribute('data-mpw-bandfeed-status'), source: el.getAttribute('data-mpw-bandfeed-source'), mode: el.getAttribute('data-mpw-bandfeed-mode') } : null } catch (e) { return null } })(),
    }),
    bandFeedPaint: () => paintBandFeedStatus(),
    bandFeedRemount: () => remountRendererForBandFeed(),
    //  ⑪(2026-09-21) 渲染器来源：档位 / 真读数 / 状态行（门禁与真机排查都读这三个）
    rendererSource: () => rendererSrcNow(),
    rendererSourceProbe: () => rendererSrcProbe(),
    rendererSourcePaint: () => paintRendererSrcStatus(),
    rendererDprOpts: () => rendererDprOpts(),
    //  ①(用户第 1 条) 库目录对话框状态机 + 「就选这个目录」成功后的动作契约
    fsState: () => fsState(),
    //  ①(用户第 1 条) 快捷根那一行的几何读数（溢出 / 一字一行）+ ④ 通用溢出自检
    dirboxGeometry: () => dirboxGeometry(),
    panelOverflowProbe: (o) => panelOverflowProbe(o),
    overflowSelectors: () => OVERFLOW_PROBE_SELECTORS.slice(),
    //  ⑤(用户第 5 条) 换库后侧栏重画的读数
    libRefreshProbe: () => libRefreshLast,
    //  ⑯(用户第 16 条) 输出面板的跟随式滚动读数 + ⑯b("我滑到哪就停在哪"的守卫读数) + ⑲ 释放"停干净"读数
    logScrollState: () => logScrollState(),
    logScrollProbe: () => logScrollProbe(),
    logScrollGuardSet: (on) => logScrollGuardSet(on),
    logAppend: (m, e) => { try { logLine(String(m), !!e); return logScrollState() } catch (err) { return { error: String((err && err.message) || err) } } },
    releaseQuietProbe: () => releaseQuietProbe(),
    //  ⑦(用户第 7 条) "产物那侧的当前项清掉了没有" + "现在是不是真的没选壁纸"（换档不许凭空挂壁纸的判据）
    artifactClearProbe: () => artifactClearProbe(),
    nothingSelected: () => nothingSelectedNow(),
    //  ⑲ 产物无条件调用、而当前渲染器档缺失的方法（如实登记；渲染器一旦补齐 ⇒ 这个数组自动变空）
    apiFallbacks: () => { try { const w = rendererWin(); return (w && Array.isArray(w.__benchApiFallbacks)) ? w.__benchApiFallbacks.slice() : [] } catch { return [] } },
    releaseQuietNow: (w) => releaseQuietNow(w || 'probe'),
    //  ④(用户第 6 条) 预览框"首帧之前不显示外壳"的读数（armed/可见/首帧时刻/时间线）
    frameProbe: () => frameGate.probe(),
    //  ①(用户第 3 条①) 库来源绘制器是否真的定义在**模块作用域**（+ 当前权威字段）
    libSourceProbe: () => libSourceProbe(),
    //  ①A1(用户：「WE 自带的那几个选项永远在壁纸配置最上面 ⇒ 做成可折叠」) 分组/折叠读数
    propsGroups: () => (window.__benchShell && window.__benchShell.propsGroups ? window.__benchShell.propsGroups() : null),
    //  ⑰(用户第 17 条) 壁纸配置面板下拉栏：原生 select 数 / 已增强数 / 泄漏清单（**必须 native === 0**）
    propsSelectProbe: () => (window.__benchShell && window.__benchShell.propsSelectProbe ? window.__benchShell.propsSelectProbe() : null),
    //  ⑪(用户第 11 条) 说明 / 壁纸设置两页的中英显示与「API 列表同源」读数
    docBilingualProbe: () => docBilingualProbe(),
    //  ⑦⑧(用户第 7/8 条) 调试页签读数（文案 / 灰框 / 颜色 / 勾选态 —— 门禁与真机同一入口）
    dbgTabState: () => dbgTabState(),
    //  ①E(用户第 2 次提「图片展示了两遍」) 真面板图片读数（探针/门禁同一入口）
    propsImages: () => (window.__benchShell && window.__benchShell.propsImages ? window.__benchShell.propsImages() : null),
    //  ①(P-184 issue #2「偶发两个时钟」) 渲染器帧内的**可见性台账**：`scene.__visStats`（= `window.__scene.__visStats`，
    //    bundle 同时发一份 `window.__mpwVisStats`）。五个契约字段：`kept / hidden / unknownNoTable / defaultsUsed / warns`
    //    —— 真机排查"这一层为什么可见"与门禁读的是同一份读数（`unknownNoTable` = 没有属性表按"未知 → 可见"，
    //    `defaultsUsed` = 表在但缺键 ⇒ 按作者默认值回落，`warns` = bool+多 condition 的警告行数）。
    visStats: () => { try { const w = frameEl && frameEl.contentWindow; return (w && ((w.__scene && w.__scene.__visStats) || w.__mpwVisStats)) || null } catch { return null } },
    //  ①A3(用户「怎么这么多半成品」) 「壁纸设置」页签过期文案的就地修正（可重放；返回改了几行或错误）
    wpsetDocFix: () => { try { return fixWpsetDoc() } catch (e) { return { error: String((e && e.message) || e) } } },   // 本函数就在 init() 作用域里 ⇒ 直接调本地定义（别再经 shell 转发：那边够不着它）
    //  ②A2(用户：「音量条超出壁纸配置宽度」) 传输条逐元素盒宽 + 越界判据
    npGeometry: () => (window.__benchShell && window.__benchShell.navSound && window.__benchShell.navSound.npGeometry
      ? window.__benchShell.navSound.npGeometry()
      : ((window.__benchShell && window.__benchShell.npGeometry) ? window.__benchShell.npGeometry() : null)),
    clearLogsView: () => clearLogsView(),
    benchReady: () => markBenchReady(),
    dbgLayers: () => { const L = sceneLayerList(); return L ? L.length : 0 },
    dbgIndex: () => dbgIndex,
    dbgStep: (dir) => dbgStep(dir),
    //  P-240 图层开关：探针与门禁走**同一条入口**（快照 + 与真点击同一条动作链）
    layerSwitch: () => lswSnapshot(),
    layerSwitchOpen: (v) => lswSetOpen(v == null ? !lswOpen : !!v),
    layerSwitchSet: (i, hidden) => lswSetHidden(i, !!hidden),
    layerSwitchOnly: (i) => lswKeepOnly(i),
    layerSwitchApply: () => lswApply(),
    /*  ①(2026-10-11 用户第 1 条) 面板定位读数（与真打开走同一条 `layerPanelFit()`）：门禁可断言
        "面板矩形完全落在视口内"，真机排查也能一眼看到算出来的宽/高与翻上/翻下。 */
    layerPanelFit: () => lswPlacePanel(),
    /*  ①(2026-10-11 用户第 3 条) 两个**状态片**从 UI 移除后，读数改由探针提供：
        `#status-renderer-src` / `#status-bandfeed` 的 `data-mpw-*` 与文案原样在这里（形状不变），
        `paint*Status()` 的**逻辑一行没删** —— 只是不再往 DOM 里写没有的东西。 */
    rendererSrcStatus: () => paintRendererSrcStatus(),
    bandFeedStatus: () => paintBandFeedStatus(),
    dbgInfo: () => layerInfoPlan(sceneLayerList(), dbgIndex),
    dbgReport,
    dbgShot,
    dbgKeysInstalled: () => !!dbgKeyHandler,
    //  进/出调试页签时被吞掉的启动错（正常恒为空串；门禁断言它为空，防止"看着切过去了、其实没生效"）
    dbgBootErr: () => { try { return String((typeof window !== 'undefined' && window.__benchDebugBootErr) || '') } catch { return '' } },
    lockTimeLayersNow: () => lockTimeLayersEverywhere(),
    getClockLock: () => ({ count: clockLockCount, enabled: FLAGS.clocklock }),
    applyMediaBranding: () => applyMediaBranding(),
    getBranding: () => (mediaBrand ? Object.assign({}, mediaBrand) : null),
    setBranding: (meta, opt) => setBrandingFromProject(meta, opt),
    onWallpaperOpened: (id) => onWallpaperOpened(id),
    disableWallpaperDrag: (props) => disableWallpaperDrag(props),
    getDragDisabled: () => dragDisabled.slice(),
    wrapRendererApi: () => wrapRendererApi(),
    labelIds: LABEL_SPEC.map((s2) => s2[0]),
    // ⑧(2026-09-18 品牌改名)：站点品牌覆盖的重放入口（探针/测试用；语言切换链里也会自动跑）
    siteBrandNow: () => applySiteBrandNow(),
    // P-93 在线 demo（线上形态 / 路径改写 / 合成样例 / 横幅）：探针与测试同一入口
    getDemoEnv: () => Object.assign({}, demoEnv),
    getOnlineNotice: () => paintOnlineNotice(),
    remapDemoUrl: (u) => remap(u),
    getDefaultSample: () => defaultSample,
    loadDefaultSample: (u) => loadDefaultSample(u),
    shell: { indexHtml: 'demo/index.html', singleSource: 'demo/bench-patch.js' },
    // ── 第七批：插件同款选择器（探针与测试同一入口；假授权树 + 滚动位置读数都在这里）──
    grantPickerEntries: (entries, opt) => grantPickerIndex(entries, opt),
    getPickerIndex: () => (pickIndex ? { root: pickIndex.root, dirs: pickIndex.dirs.length, files: pickIndex.files.length, truncated: pickIndex.truncated, from: pickGrantFrom } : null),
    openPicker: (opt) => openDirPicker(opt || {}),
    closePicker: () => closeDirPicker(),
    getPickerState: () => (dirState ? {
      mode: dirState.mode, cwd: dirState.cwd, query: dirState.query,
      rows: dirState.rows.map((r) => r.kind + ':' + r.path),
      sel: dirState.sel, cursor: dirState.cursor, diff: dirState.diff, restore: dirState.lastRestore,
      scrollTop: dirState.listEl ? Math.round(Number(dirState.listEl.scrollTop) || 0) : null,
      scrollHeight: dirState.listEl ? dirState.listEl.scrollHeight : null,
      clientHeight: dirState.listEl ? dirState.listEl.clientHeight : null,
    } : null),
    setPickerFilter: (q) => dirSetFilter(q),
    setPickerScroll: (v) => { if (dirState && dirState.listEl) { dirSetScrollTop(dirState.listEl, v); return true } return false },
    // 第七批②：导航（探针/脚本入口）与「上一级 / 回到最上层」按钮同款——换目录时清过滤词 + 关键盘游标
    pickerGo: (target) => {
      if (!dirState) return null
      const nav = pickerNavigate(pickIndex, dirState.cwd, target)
      if (nav.moved) {
        dirState.cwd = nav.cwd; dirState.sel = null; dirState.cursor = -1; dirState.query = ''
        if (dirState.filterEl) dirState.filterEl.value = ''
        dirPaint({ reset: true })
      }
      return nav
    },
    confirmPicker: () => { dirConfirm(); return true },
    // 键盘导航走**真处理器**（dirKeyHandler）而不是复制一份逻辑：探针按的就是用户按键那条路
    pickerKey: (key) => {
      if (!dirState || !dirKeyHandler) return null
      dirKeyHandler({ key: String(key), preventDefault: function () { /* 合成事件：不需要真的阻止默认行为 */ } })
      return dirState ? { cursor: dirState.cursor, sel: dirState.sel, rows: dirState.rows.length, cwd: dirState.cwd, open: !!dirBoxEl } : { open: false }
    },
    getMainViewPlan: () => paintMainView(),
    // ⑩ 站点外壳（2026-09-17 新样式）：切页 / 切换栏 / 控制台高度 / 参数栏空态
    getPage: () => (window.__benchShell ? window.__benchShell.getPage() : null),
    setPage: (n) => (window.__benchShell ? window.__benchShell.setPage(n) : null),
    switcher: () => (window.__benchShell ? { plan: window.__benchShell.refreshSwitcher(), items: window.__benchShell.listItems() } : null),
    logsHeight: () => (window.__benchShell ? window.__benchShell.logsHeight() : null),
    setLogsHeight: (v) => (window.__benchShell ? window.__benchShell.setLogsHeight(v) : null),
    // ⑫a / ⑫c（探针/测试入口；与用户点击走**同一条**代码路径）
    setPropsCollapsed: (v) => (window.__benchShell ? window.__benchShell.setPropsCollapsed(v) : null),
    propsCollapsed: () => (window.__benchShell ? window.__benchShell.propsCollapsed() : null),
    // ①(本轮 #18/#23/#25/#26/#27/#28/#30/#34)：属性面板（状态机读数 / 显式重挂载 / 外链确认）
    propsPanel: () => (window.__benchShell ? window.__benchShell.propsPanel() : null),
    propsRefresh: (why) => (window.__benchShell ? window.__benchShell.propsRefresh(why || 'probe') : null),
    propsDecorate: () => (window.__benchShell ? window.__benchShell.propsDecorate() : null),
    propsExtConfirm: (url) => (window.__benchShell ? window.__benchShell.propsExtConfirm(url) : null),
    propsExt: () => (window.__benchShell ? window.__benchShell.propsExtState() : null),
    propsExtClose: () => (window.__benchShell ? window.__benchShell.propsExtClose() : null),
    propsRaw: () => (window.__benchShell ? window.__benchShell.propsRaw : null),
    themeMode: () => (window.__benchShell ? window.__benchShell.themeMode() : null),
    // ⑭(P-142 2026-09-19 用户第 1/2/3 项)：收纳 / 声音控件遮挡 / video 声音（与用户点击同一条代码路径）
    setNavCollapsed: (v) => (window.__benchShell ? window.__benchShell.setNavCollapsed(v) : null),
    navCollapsed: () => (window.__benchShell ? window.__benchShell.navCollapsed() : null),
    npSound: () => (window.__benchShell ? window.__benchShell.navSound : null),
    // ①(P-161) 播放卡片：快照 / 联动开关 / op 派发（探针与门禁读同一批入口，与用户点击同一条代码路径）
    npCard: () => {
      const a = window.__benchShell ? window.__benchShell.navSound : null
      if (!a || typeof a.npSnapshot !== 'function') return null
      const m = a.mediaList()
      const card = document.querySelector('#np-mount .snd-box')
      return {
        snapshot: a.npSnapshot(),
        link: a.npLinkState(),
        controlled: a.npControlled(),
        media: { videos: m.vids.length, audios: m.auds.length },
        cardHeight: card ? Math.round(card.getBoundingClientRect().height) : null,
      }
    },
    npTransport: (op, v) => {
      const a = window.__benchShell ? window.__benchShell.navSound : null
      return (a && typeof a.npTransport === 'function') ? a.npTransport(op, v) : null
    },
    npOcclusion: () => (window.__benchShell ? window.__benchShell.npOcclusion() : null),
    npAudio: () => (window.__benchShell ? window.__benchShell.npAudio() : null),
    npVolumeSlider: () => (window.__benchShell && window.__benchShell.npVolumeSlider ? window.__benchShell.npVolumeSlider() : null),
    npMuteKey: () => (window.__benchShell && window.__benchShell.npMuteKey ? window.__benchShell.npMuteKey() : null),
    setVideoVolume: (v) => (window.__benchShell ? window.__benchShell.setVideoVolume(v) : null),
    videoStage: () => (window.__benchShell ? window.__benchShell.videoStage() : null),
    setThemeMode: (m) => applyThemeMode(m),
    siteStyleInjected: () => SITE_STYLE_INJECTED,
    shellVersion: () => BENCH_SHELL_VERSION,
    domIsNew: () => DOM_IS_NEW,
    pickerStyleInjected: () => BENCH_STYLE_INJECTED,
    // 清单里可能不存在的 id：① 由 bindDropdown 动态创建 ② 可选控件（如复制链接按钮将来才加）
    dynamicIds: ['#bench-rd-btn', '#copy-url', '#bench-local'],   // 由补丁动态创建（#bench-local = 本地库容器）
  }
  window.__benchPatch = api
  return api
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init)
  else init()
}
