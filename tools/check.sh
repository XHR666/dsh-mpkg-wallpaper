#!/usr/bin/env bash
# tools/check.sh —— 插件改动后的"一条命令全量自检"
# 为什么需要：外观 CSS 是现场拼装的字符串，历史上出过两次"整个界面错乱"
# （buildCss 抛错 → <style> 为空 / 花括号不配平 → 大批规则被吞）。
# 这里的每一步都对应一次真实事故，改完代码先跑它，再同步给用户刷新。
#
# 用法: bash tools/check.sh [--quick]
#   --quick  跳过组合矩阵（只跑语法 + 面板冒烟）

set -uo pipefail
cd "$(dirname "$0")/.."
fail=0
step() { printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

step "1/12 语法检查 lib/*.js"
for f in lib/*.js; do
  if node --check "$f"; then echo "  ✓ $f"; else echo "  ✗ $f 语法错误"; fail=1; fi
done

step "2/12 面板冒烟（含 CSS 模板闭合 / h 声明 / 花括号配平 / 渲染）+ P-66 面板健壮性/语言回归 + 选择器（第13条）回归 + 壁纸层可见性（.mpw-bgWrap）回归 + 壁纸持久化（刷新不丢）回归"
node tools/panel-smoke.mjs || fail=1
# ①(2026-09-21 真机第12/13条) 预览框：**媒体不裁切 + 与占位不并排 + 同框可见 ≤ 1**。
#   真机现场：暂停键左边的预览图被切掉一块、右边约 1/4 是白块写着 `mp4`（换目录后同形，白块不走）。
#   根因：`.mpw_wallThumb` 是 flex 行，`<img>/<video>`（width:100% + object-fit:cover）与类型占位
#   是**兄弟** ⇒ 占位一露出来就把图压到 3/4、占位吃满剩下 1/4，cover 再裁掉一块。
#   判据（契约，不是本机读数）：A 组拿**真 CSS 产物**（panel-smoke --css）算几何 —— 媒体
#   `object-fit:contain` + `position:absolute`、占位 `inset:0` 铺满、`[hidden]` 必不显示；并把
#   **旧 CSS** 喂给同一模型做对照（旧产物必须判成"并排 + 裁切"，占位占框 ≈32% = 真机那块白）；
#   B 组切片 lib/client.js 的 MPW-THUMB 块跑生产状态机。①(2026-09-21 真机第 1/2 条) 状态机改成
#   **单一事实源**（谁可见 = 由"真的画出来了 + 候选优先级"推导，事件只触发不写显隐）：
#   三条失败路径同框可见 ≤ 1、"先目录 preview.*、后首帧兜底"、**可见即有画面**（媒体一律先藏着，
#   出画才显示 —— 旧写法在换候选时显示未加载完的 `<img>` = 真机"一块白底"）、**优先级固定**
#   （图能画时视频的 loadedmetadata 迟到不许抢镜头 = "扫描一次翻一次面"）、换目录 key/URL 全换、
#   缓存键含目录身份+纪元、**内容没变则纪元不动**（同一份清单重复扫描 ⇒ 键不变 ⇒ 不重挂载不重发请求）、
#   **容器（.mpkg/.pkg）不给 `<video>` 候选**（真机读数：给了会去拉 130MB~830MB 字节，
#   `/custom-media` 206 ×20，还把宿主解析占满）、出画时把 `--mpw-thumb-cover` 写成**同一个元素**的
#   URL（留白由模糊铺满层兜底 ⇒ 不裁切也没有"左右各 1/5 白块"）。
#   C 组单一落点判据（占位显隐只有 mpwThumbSync 里的 3 处写入；事件入口只许"收起"）+ 旧实现对照。
#   39 通过 / 0 失败。真机读数与两条真机探针见 docs/RELEASE.md。
node tools/thumb-chain-test.mjs || fail=1
# ①(2026-09-23 用户第 4 项「支持导入 pkg 单文件和 mpkg 文件」) 导入链回归 —— 依据核验报告
#   `../docs/PKG-IMPORT-VERIFICATION-20260923.md`（12 条缺口 G1~G12）。原状（本机可复现）：
#   单文件 `.pkg`（真机 magic `PKGV0022`）**没有任何入口**（accept 不含 .pkg、嗅探只认 PKGM
#   ⇒ 0 次宿主调用 + `file.unsafe`）；渲染器自带 `pack-dir.mjs` 产出的 `.mpkg` 恰好也是 PKGV
#   ⇒ 自家产物进不来；全仓 `grep onDrop|dataTransfer` 0 命中；库目录**根**下的单文件 `.pkg`
#   不进清单；无素材容器**先整包上传**再报错；`.pkg` 拿不到容器内预览图（200→404）；目录表
#   >2MiB ⇒ `/upload` 500（Node 原生 RangeError）+ 未登记残骸；上传的容器副本**永不回收**；
#   mpkg 路径不解压（压缩条目 = 构造性缺口，本机 508 条 0 压缩）；文案只承诺 `.mpkg`。
#   判据（65 条，~1.5s，无浏览器/无 ffmpeg/不读语料）：
#     A 客户端切片真跑：`sniffFileType` 认 `PKG[VM]`（PNG/MP4/HTML/畸形头分辨力对照）、
#       拖拽与选择器**同一条落点**（importPickedFile）、accept 含 `.pkg`、预检在 fetch `/upload`
#       **之前**、头部读取 2→8→32MiB 倍增 + 可读错误、压缩条目识别、中英文案同时承诺两后缀；
#     B 真 HTTP 打真路由：`.pkg`/PKGM/PKGV 都能 `/upload`+`/media`、2.8MiB 目录表**能解析**（/upload 与
#       /custom-mpkg 都是）、超限档 413+可读 code+无残骸、
#       压缩条目 415+`code=entry-compressed`（同容器正常条目不受影响）、根下 `.pkg` 进清单、
#       `/custom-mpkg-preview` 收 `.pkg`、任意名容器的 kindReason=scene-container；
#     C 回收：连导 5 次 ≤ 上限、最旧先删、**正在播放**（/media 读过）与 settings.json 引用的
#       绝不删、用户自己的文件一个不动；
#     D 用户原话硬语义：预检只吃条目表（**不依赖 preview / project.json**——上游 oneincase
#       的包这两者一般是缺失的）；
#     E 变异自证 6 组（accept / 嗅探 / preview 路由 / 失败清理 / 回收 / reason 两处各自承重）。
node tools/pkg-import-test.mjs || fail=1
# 真机探针的**纯判据**（--selftest）常驻在这里：探针本身不进门禁（要用户 :3080 在跑），
# 但"探针的判据还有没有分辨力"是秒级的 —— 不常驻的话探针会悄悄退化成恒绿。
node tools/scan-switch-live-probe.mjs --selftest || fail=1
node tools/np-axis-live-probe.mjs --selftest || fail=1
# ①(2026-09-21 用户第 11 条) 网页壁纸风险预检（重动画 / 需外网）**单查接口**：
#   来历：预检本来只藏在两次目录扫描的返回值里（形状各不相同、导入前没法单查）⇒ 测试台要显示
#   两个标记只能自己再解析一遍目录。现在判定只有一处实现（模块级 probeWebWallpaper），
#   扫描（/custom-dir、/steam-inventory）与 `GET /web-probe?folder=|ltoken=` 共用它。
#   判据：路由存在性 / 响应形状逐字段（ok,target,probe{heavy,external,heavyHits,externalRefs,
#   htmlFile,scannedBytes,reasons,limits}）/ 正负例（骨骼动画 + 外链 vs 干净目录 vs 只引回环）/
#   参数闸门（400/403/404）/ 扫描条目与单查结论逐项一致 / 递归只有一份定义（源码级）。
#   形状契约：docs/WEB-WALLPAPER.md §3.4。26 通过 / 0 失败。
node tools/web-probe-test.mjs || fail=1
# ①(2026-09-22 漏音：总线级静音) `audio-bus-test`：内核 `lib/audio-bus.js` 的**离线**判据 37 条 ——
#   直连 `ctx.destination` 必须被改接到每 ctx 懒建的 masterGain（挂 `AudioNode.prototype`，不是 AudioContext.prototype）、
#   master 自己那一下走原始 connect（无递归）、`connect` 返回值按真 API 语义返回**调用方传进来的 dest**、
#   `OfflineAudioContext` 放行、**安装前就存在的 ctx 采用后进静音名单**、静音 = `cancelScheduledValues + setValueAtTime(0)`
#   且**不 suspend**、被 `createMediaElementSource` 接管的元素只总线归零**不 pause**（否则 analyser 恒 0）、
#   静音期 `play()` 压制且返回**已 resolve** 的 Promise、`start(when)` 迟到分 burst/jitter 且**只记录不阻止**、
#   `new Audio()`/Shadow DOM/`speechSynthesis`/WebRTC track/跨域"不可控清单"归因、档位 `off|report|redirect|1|all` 与跨 realm 幂等。
#   ~0.1s，无浏览器无网络。真机那半由 `tools/audio-bus-live-probe.mjs` 负责（**待接线后启用**）。
node tools/audio-bus-test.mjs || fail=1
# ①(2026-09-22 接线) `audio-bus-wiring-test`：`lib/client.js` 里的 MPW-AUDIO-BUS 内联块是**生成产物**
#   （client.js 是单文件产物，页面没有模块图 ⇒ 只能内联，与 now-playing 同款）。判据：块必须**逐字**包含
#   `lib/audio-bus.js` 的当前源码（改源不重跑生成器 ⇒ 红）、顶层真的调用了安装入口且幂等、模式纯函数口径
#   （顶层缺省 `redirect` 只归因 / 帧内缺省 `1` 真压 / 显式档照办 / 帧内不接受 `redirect`）、静音跟随设置
#   `mute` 同步（800ms 轮询 + 走模块 API）、三条分辨力自证。20 断言，~0.1s，无浏览器。
node tools/audio-bus-wiring-test.mjs || fail=1
# ①(第13条 用户点名"长期没修好"的 bug) 选择文件夹/选择文件的选择器：
#   滚动位置（重渲染/容器被重建后不跳顶）、不抢焦点、键盘导航、500 项大目录、滚轮不串联宿主。
#   A 组源码级（**同一套断言对 `git show HEAD:lib/client.js` 必须变红** ⇒ 证明用例有分辨力）
#   B 组假 DOM + 迷你 React（切 lib/client.js 的 MPW-DIRPICK 块，跑生产实现）
#   规格/根因/行为契约：docs/DIR-PICKER-SCROLL.md
node tools/dir-picker-test.mjs || fail=1
# P-66（2026-09-15）：①渲染错误边界（catch 里引用 try 块内 const h → 真因被吞）②zh/en 字典键对齐
node tools/panel-fixes-test.mjs || fail=1
# ①(NP-1 2026-09-19 用户第 1 条「now playing 挂载到 dsh 设置上面 有一个开关启用是否挂载
#   左边栏收起就隐藏」) Now playing：
#   · 形态：源 lib/now-playing.js + lib/now-playing-math.js **逐字节内联**进 lib/client.js 的生成区
#     （宿主只下发 exports["./client"] 一个文件 ⇒ 相对 require 线上必挂；形态依据
#      docs/CLIENT-JS-SPLIT-ASSESSMENT.md §3(A)，该文档要求必须配"生成物与源一致"的门禁）；
#   · 判据：生成区无漂移 / 开关**默认关**⇒零注入零观察者且产物逐字节纯追加 /
#     挂载点在「设置」入口之前（宿主 slot 优先 + 两级降级锚点，兜底必须留日志）/
#     左侧栏宽度 < 96px（宿主收起轨道恰好 56px、展开下限 264px）⇒ data-mpw-np-hidden；
#   · 分辨力自证：阈值判据 / 开关默认值 / 单实例守卫 / 生成区漂移 / **物理宽度优先（真机 bug 的判据）** /
#     一次性补判 —— 六组变异各自必红。
#   ①(NP-2 2026-09-19 真机复核)：真机探针（tools/np-sidebar-live-probe.mjs，主对话跑）抓到
#     「刷新后控件自己消失」：宿主 slot 出口晚几秒才渲染，组件重锚进 slot 的那一帧，宿主交下来的
#     wide=false 把 **256px 展开**的侧栏判成收起 ⇒ 自己写 hidden 且粘住。修法=**物理宽度优先**
#     （量到 ≥96px 就不许隐藏；宿主信号只在量不到宽度时兜底）+ 锚点搬动后**一次性**补判。
#     时间线/根因/改了语义的既有断言（D3/D8/D10/E1c）：docs/NOW-PLAYING-DSH.md §7.6。
#   设计与"做不到"清单：docs/NOW-PLAYING-DSH.md
#   生成区漂移门禁有**两条独立实现**，都常驻在这一步里：下面这条是生成器自己复算整块生成区并核对；
#   紧跟的那份是从产物里把两份源的正文抠出来逐字节比（A2/A3/A4/A5）。两条都要 ——
#   前者防"生成器与产物不一致"，后者防"产物里的正文被人手改过"。
node tools/build-now-playing.mjs --check || fail=1
node tools/now-playing-test.mjs || fail=1
# ①(NP-3 2026-09-19) Now playing 的**声音接线**（数据源判定 / 音轨清单路由 / 播放落点 / 静音落点 /
#   让位）：数据源只认"当前真的在放"的那个媒体（页面里那个隐藏空壳 #mpw-bgVideo 不算）；
#   清单作用域认 mpkgKey="custom|<folder>"（自定义目录的 web 壁纸没有 folderName —— 旧写法拼成
#   library 路由 ⇒ 404 ⇒ 目录里的音频永远接不上）；上一首/下一首按清单顺序（不是"回到开头"）；
#   静音写设置**并且**落到 video/audio/帧内元素；宿主同一位置已有别的插件的元素 ⇒ 不挂/撤下且不重建
#   （data-mpw-np-yield）。12 组变异自证各自必红。设计与根因：docs/NOW-PLAYING-DSH.md §7.7
node tools/np-media-test.mjs || fail=1
# ①(NP-4 2026-09-19 真机修复) Now playing 的**控制面**（电平 / 起播顺序 / 拖动 seek / ② 联动开关 /
#   ④ 清单可播性 / ⑤ 借宽放大 / ⑥ 对外的接口面）：真机六条各自"修前读数 → 修后读数"的可复现判据。
#   为什么单开一条：这六件事里五件是"**同一个动作落到谁身上**"（静音 vs 音量、起播用了哪个 muted、
#   拖动影响壁纸还是只影响声音、清单能不能真取到字节、借宽借谁的像素）—— 界面看着对是判不出来的，
#   必须对着真实元素 / 真实 URL / 真实矩形断言。11 组变异各自必红。根因/读数：docs/NOW-PLAYING-DSH.md §7.8
node tools/np-control-test.mjs || fail=1
# ②①③④⑤⑥(2026-09-20 真机修复轮) 壁纸**生命周期**门禁：换档成套重写（残留 webUrl 不许抢先武装）/
#   挂载裁决 / URL 形状跟着条目来源（custom|library|container 三类唯一形状）/"当前壁纸"预览候选链
#   （web 档不再空白）/ 弹层容器不得被我们打成侧栏（设置面板被压缩进左栏那条，真机读数 800→254px）/
#   「清除壁纸」真的清空且不复活（驱动**真 clearBg**）/ 武装前验活（宿主明确 {ok:false} ⇒ 不给 iframe
#   渲染错误页）/ 沙箱档被浏览器策略挡住时一次性降级兼容档 / 卡片暂停真的压住帧内音频 /
#   切页静音（powPauseHidden 新默认 + 迁移）/ 交互音与角色语音不进播放器清单（纯分类器 + 依据）/
#   联动开关关闭的语义（关＝不碰壁纸、开＝按卡片状态对齐）。13 组变异各自必红。
#   真机读数与同类审计：docs/WALLPAPER-LIFECYCLE.md
node tools/wallpaper-lifecycle-test.mjs || fail=1
# ①(2026-09-18) 「开关必须真的接线」审计（功能静默无效这一类的通用判据）：
#   来历是真事故：「配色」(accent) 与「深底文字可读增强」(aquaTextEnhance) 两段 CSS 被一起
#   包在 `if (aquaOn(section))` 里 ⇒ 只开这两个开关时规则根本不生成（开关能点、没效果、不报错）。
#   判据：每个布尔开关都必须在"默认档/富上下文/其它全开"三个上下文之一里改变 buildCss 产物；
#   只影响运行时的开关必须登记 reason；**已证实失效未修的**进 KNOWN_DEAD 并在每次运行时显式列出
#   （修好则必须从表里删，双向断言防"遮羞布"—— 2026-09-19 该表**已清空**：lgCss/sessionFollow 已修好，
#   glassWindow 按用户"不留看得见却点不动的死文案"政策**退役删除**，转由 A0 段看住
#   "源码 0 悬空引用 + 两套字典 0 孤儿文案"，并配常驻变异 `retired-glasswindow-copy-restored`）。
node tools/switch-wiring-test.mjs || fail=1
# ①(2026-09-23 静默失败审计，../docs/SILENT-FAILURE-AUDIT-20260923.md §A-1/§A-2/§A-10 + 资源审计 §2.1 #2)
#   上面那条管"开关有没有接线"，这一条管**同一类事故的另一半：失败有没有留下痕迹**。四条修的都是
#   "把失败当成正常值"，各自的既有门禁只覆盖主路径，没有一处钉住"失败要报/要计数/要拒绝写回"：
#   ① 注册入口（lib/client.js 尾部的双 id 注册）：修前两个 `catch (e) {}` 把"插件整个没注册上"
#      完全吞掉（无 console、无 trace、无全局标记）⇒ 失败必须留痕：console.error + `globalThis.__mpwRegisterErr`
#      （真机控制台/探针一眼可见）+ 成功路径记 `__mpwRegisteredIds` 便于对拍；**重试/idempotency 语义不变**。
#   ② 帧内 shim 通道（父页→帧内唯一控制通道）：`webShimCall` 一直有可判定返回值，修前 13 个调用点全部
#      忽略 ⇒ 沙箱档下"暂停/静音/倍速/属性下发"静默失效而面板显示"已生效"。现在统一走
#      `webShimCallChecked`（返回值 + `window.__mpwShimCallFails` ≤32 条台账 + `…FailN` 累计 + 首次 warn），
#      且 `pauseWebFrame` 失败**不**记 `webFramePausedByUs`（否则恢复时会 play() 作者自己停着的媒体）；
#      原始 `webShimCall` 的签名/语义一字未动（既有调用方零影响）。
#   ③ 磨砂同步/样式自愈的 8 处 catch（4 函数尾 + 4 调用点）：全在文件 61-62 自述的"致命路径必须报"
#      白名单里，修前全静默 ⇒ 现在一律走 `mpwErr`（观察器没起来 = 永远不自愈，这条必须看得见）。
#   ④ 帧内 localStorage：修前"读失败"被吞成"没存过"，随后把默认值整串写回，覆盖用户在帧内改过的
#      真实设置 ⇒ 现在三态（ok/empty/error），error 时 `showError("webcfg.readFail")` + **拒绝写回**。
#   ⑤ 结构性护栏：np 播放器 blob 兜底 URL 的每一处清 src 都必须伴随 `npBlobUrlSet("")`
#      （资源审计 #2：修前该 URL 从不 revoke，自动连播每曲钉一支 ≤32MiB 的 Blob 到页面卸载）。
#   判据：34 通过 / 0 失败，纯自造桩环境（无浏览器/网络/ffmpeg/语料，约 8s）+ **7 组变异各自必红**。
node tools/silent-failure-guards-test.mjs || fail=1
# ①(2026-09-18 §5 第3项)「诊断自证闭环」：payload 补齐关键子系统（磨砂/侧栏/时间线是否被影响、
#   壁纸类型与路径、shim 是否注入、视频解码、表面 token、场景健康），**每个字段带来源（provenance）**，
#   读不到 ⇒ 字段仍在 + value:null + degraded.reason（部分子来源缺 ⇒ degraded.partial）——绝不静默省略；
#   一键发送 POST /diag 拿宿主落点，宿主不可用 ⇒ 下载 JSON（离线可用）；
#   客户端单份字节上限 + 宿主 diag 目录"数量 + 合计字节"双上限、最旧先删（都直接调真实现断言）。
#   字段表/怎么发/落在哪/上限：docs/DIAGNOSTICS.md
node tools/diag-subsystem-test.mjs || fail=1
# ①(2026-09-20 同类缺陷一并修) 宿主两个 POST 接收端的**超限语义**（真 HTTP + 变异自证）：
#   超限 ⇒ **413 + JSON 说明**（旧实现 `req.destroy()` ⇒ 客户端只看到 ECONNRESET）、超限**不落盘**、
#   跨源（`Origin: null`）也带 CORS 头能读到原因；判据有没有分辨力由"改回 req.destroy() 必红"自证。
node tools/host-body-limit-test.mjs || fail=1
# ①(MEDIA-1 接线 2026-09-20) 系统媒体会话**接线**：宿主三路由（21 键透传 / op 白名单 / 封面只服务当前快照的
#   玩家）+ 客户端补充路径（同步 npResolveMedia 不动 / 自适应轮询 2s↔30s / available:false 不接管 /
#   封面走代理 / 传输改道带能力位）+ 本机诚实降级（无会话总线 ⇒ available:false + reason）。
node tools/media-session-wiring-test.mjs || fail=1
# ⓪(2026-09-16 两个真机 bug 的回归门禁)：
#   bug① 右侧「轮次导航条」(.eGxaPq_*/--dsw-alias-border-l4) 不被我们的样式/token 覆盖弄透明；
#   bug② 标题栏磨砂注入链（假 DOM：注入 + 内联样式 + 半透明底 + 宿主标记 + 诊断 reason + 回退开关）。
#   详见 docs/HEADER-FROST.md、docs/TIMELINE-RAIL-TOKEN.md
node tools/frost-rail-test.mjs || fail=1
# ①(2026-09-17 壁纸层可见性轮) `.mpw-bgWrap`：有壁纸源时**不得** display:none（且两种 none 正常语义
#   ——"无源" vs "面板不透明度 100" ——必须可判别）；有源时 `img.src` 必须留下（旧写法 showImageEl 里
#   无条件清 src ⇒ "图层在但没有画面"，真机表现为刷新后图片/GIF 壁纸不显示）；`?bgwrapfix=legacy` 回退开关接线。
#   判据/证据/复测方法：docs/BGWRAP-VISIBILITY.md；真机测量器 tools/bgwrap-display-probe.mjs。
node tools/bgwrap-visible-test.mjs || fail=1
# ①(2026-09-17 独立成线) 壁纸**刷新不丢**（持久化）：壁纸 dataURL 常内联在 STORE_KEY 的整串 JSON 里，
#   而 localStorage 单值硬顶 256KB（超限**拒写**）、宿主 /settings 又明确跳过 image ⇒ 落在
#   (256KB, 2MB] 的壁纸（本机语料实测 **34/34 全部命中**，量法见 tools/persist-size-scan.mjs）
#   两边都不落 ⇒ 刷新回默认壁纸。本步断言：阈值一处定义且与文档逐字一致 / 大 dataURL 落 IDB 并在
#   "重载"（同一份 localStorage+IDB 再跑一次 apply）后恢复 / IDB 不可用时留痕+告警（不静默）/
#   小图原路径不变 / `?mpwpersist=legacy` 与"删掉读侧 dataURL 分支"的变异必须变红。
#   判据与阈值表：docs/PERSISTENCE.md。
node tools/persist-test.mjs || fail=1
# ①(2026-09-19 设置持久化轮 · 真机"壁纸选择字段会丢")：真机两处存储都成了**半残档**
#   （`mpkgKey:"custom|3582362359"` 还在、`image`/`webUrl` 都没）⇒ buildCss 的 hasImage=false
#   ⇒ `.mpw-bgWrap{display:none}` ⇒ **用户的壁纸不显示**（tools/settings-persist-live-probe.mjs 实测）。
#   本步（假 DOM + 假宿主，驱动**真** lib/client.js 的设置路径）钉四条：
#     · 一次"无关开关"保存 ⇒ 逐字段 diff 只差这一次改的键（字段集合与每个值都不许动）；
#     · 两处存储（localStorage / 宿主 settings.json）的新旧裁决：4 种组合各自可判（内嵌时间戳 + 补空缺不覆盖）；
#     · 半残档自愈：能按包/目录元数据推出来就推并**恢复壁纸层**，推不出就**明确提示**（不静默隐藏）；
#     · 用户主动"清空壁纸"**仍然**能被清空（自愈不是"删不掉"）。
#   宿主侧同一条契约（PUT 合并不替换）另有源码守卫 + 行为断言；6 组变异各自必红。
#   根因链/修法/判据/诚实清单：docs/SETTINGS-PERSIST.md
node tools/settings-persist-test.mjs || fail=1

if [ "${1:-}" != "--quick" ]; then
  step "3/12 CSS 组合矩阵（512 全组合 + 600 随机 + 边界；8 类历史回归断言）"
  node tools/css-matrix.mjs || fail=1
else
  step "3/12 组合矩阵（已按 --quick 跳过）"
fi

step "4/12 场景看门狗/调试参数回归（批次15：B1/B3/B5 + 作用域修复 P0）"
node tools/scene-watchdog-test.mjs || fail=1

# 批次18 / B6：渲染器沙箱（去 allow-same-origin）+ 场景级短期 token
# 契约 we-scene-demo/RENDERER-SANDBOX-CONTRACT.md；两侧各自回归，宿主侧只走拒绝路径（不落盘）。
# ①(2026-09-16 I 项) 网页（web）壁纸：类型判定（内容优先）/ sandbox 最小必要集 /
#   shim 注入顺序 / shim API 与参考实现的差异 / 作者脚本抛错兜底 / 无 GPL 代码 —— 见 docs/WEB-WALLPAPER.md
step "5/12 B6 沙箱与场景 token + 网页壁纸 shim 沙箱（客户端模式/回退 + 宿主签发与 Origin:null 闸门）"
node tools/scene-sandbox-test.mjs || fail=1
node tools/host-sandbox-token-test.mjs || fail=1
node tools/web-wallpaper-test.mjs || fail=1
# ①(2026-09-16 第 11 条) 网页壁纸**交互注入**：坐标换算 / 事件整形（button:-1 哨兵、click 边缘合成）/
#   注入开关状态机（60s idle + 180s maxAge + Esc/失焦/卸载都能关）/ 沙箱边界（交互不放宽 sandbox、
#   不读帧内 DOM）/ 舞台契约（默认不挡宿主）/ 与 client.js 内嵌段逐字段对拍。见 docs/WEB-WALLPAPER.md §11
node tools/web-interaction-test.mjs || fail=1
# ⓪(2026-09-17 用户第 1 条) 视频壁纸**转码资源占用 / 误判转码**回归：
#   可播性闸门（可直读就不起 ffmpeg）/ 缓存复用（键不含时间戳）/ 并发上限 1 /
#   产物数量+字节双上限与最旧先删 / 启动清理 / 取消即 kill 且不重试 / 内存准入 /
#   客户端三态可见与 ?mpwtranscode 回退开关 / 磁盘卫生（夹具 ≤1MB + 必删 + 上限断言）。
#   详见 docs/TRANSCODE-RESOURCE.md
node tools/transcode-limit-test.mjs || fail=1
# ①(2026-09-23 用户第 1 项 B) 视频「按屏幕物理尺寸预缩（ffmpeg lanczos）」档 —— **默认关**：
#   依据 ../docs/USER-ITEMS-20260921.md 第 19 条实测（`3588989102` 2558×1438@60）：非全屏尺寸上
#   「一次直降」的**闪烁**是「逐级减半」的 1.6~2.7×，代价是细节低 1.4~1.9× ⇒ 取舍，默认不翻。
#   复用**既有** `/transcode` 通道（不新起一套）：档 = `section.preScale`（0=关 / 1=按屏幕物理尺寸）；
#   开了只多两件事：`maxW=<屏幕物理宽>` + `scale=lanczos`。宿主新增 `scale` 参数（**白名单**，非法 400），
#   `-vf` 链由 `buildScaleFilter` 唯一构造；缓存键只在真给了 flags 时追加 `|s:<flag>`
#   ⇒ **不传 flags 的键与改动前逐字节相同**（既有产物继续命中、升级不重转）。
#   判据（38 条，~1s，**不真跑 ffmpeg**：`DSH_WE_FFMPEG` 指向记录 argv 的桩）：
#     A 纯函数：白名单（注入串 ⇒ null）/ vf 链 / 缓存键与**独立复算的旧公式**逐字节相同；
#     B 真路由端到端：桩 argv 里 `-vf …:flags=lanczos,fps=…`、落盘产物名 == transcodeKey(...)|s:lanczos、
#       默认档 argv 无 flags 且产物名 == 旧公式、`scale=evil`⇒400、既有 1920 降采样收口仍在、
#       进度键含 flags（用"失败任务顶替 lastTranscodeProgress"做分辨力）、同参第二次命中缓存；
#     C 客户端：默认关 / 物理宽纯函数（×dpr、夹 [640,3840]）/ 目标宽（关⇒0）/ 四处接线 / 文案 / 登记；
#     D 变异自证 6 组（vf 去 flags / 键去 `|s:` / 白名单照单全收 / 默认档翻成开 / URL 不传 scale / 闸门拆掉）。
#   档位登记：docs/TRANSCODE-RESOURCE.md §3 一行（档名/默认关/依据）+ 代码内 /probe limits.scaleFlags。
node tools/transcode-prescale-test.mjs || fail=1

# ①(第16项) 发布前完整性自检：必需文件/package.json 字段/files 白名单/个人路径/凭据形态/图标/门禁脚本在位
step "6/12 发布完整性自检（第16项：文件齐全、元数据、白名单、无个人路径与凭据）"
node tools/integrity-check.mjs || fail=1
# ①(2026-09-19 敏感信息加固) 密钥/本机绝对路径**常驻扫描**（tracked 全量；秒级，无网络/无浏览器）：
#   与上面一条**故意并列**而不是并进去，因为覆盖面不同 —— integrity-check ④⑤ 只扫**发布面**（lib/**），
#   而密钥与本机路径最容易从 docs/tools/CI 配置漏出去（那些目录不进 npm 包、却进公开仓库）。
#   判据/白名单/退出码见 tools/secret-scan-test.mjs 文件头（白名单逐条写理由，且断言"每条都仍然命中"，
#   防止白名单腐烂成遮羞布）。**不新增步骤**：integrity-check ⑨b 断言 "N/M" 编号自洽，加一步要全表改分母。
node tools/secret-scan-test.mjs || fail=1
# ①(2026-09-21 跨平台轮) 跨平台**静态**门禁（秒级 / 无浏览器 / 无网络）：上面 12 步几乎全是"在 Linux
#   本机跑一遍看行为"，**没有一条**钉住"平台分支真的齐全、不许写成 Linux 独占"—— WSL 只写死 /mnt/c 就是
#   这类漏网（Steam 装在 D:/E:/… 的 WSL 用户永远扫不到，而本机跑什么都绿）。判据：steamProbeDirs() 纯函数
#   契约（WSL 盘符枚举可在**非 WSL 机器**上断言 + 三平台各自成根 + 与改前候选逐字节等价）+ tracked 静态卫生
#   （写死的临时目录/宿主绝对路径台账、shell 可移植、文件名、BOM/CRLF）+ 每类合成反例自证 + 两条"改回去必红"变异。
#   实测：63 通过 / 0 失败（tracked 127 文件；账本 25 条全部反查命中）。不新增步骤编号（integrity-check ⑨b 断言编号自洽）。
node tools/cross-platform-test.mjs || fail=1

# ①(2026-09-15 用户第 1 条反馈「扫描音频的速度能否快些」)
#   惰性音频索引（只读目录表 + 仅候选条目 16 字节头，带 mtime+size 缓存）+
#   宿主侧 /raw 的 Range/206 与 /custom-scene-audio 探测路由。
#   audio-scan-test：**规格断言**（docs/AUDIO-TRACK-SPEC.md：后缀表 / 容器规则表 R1–R7 /
#                    收集去重 / 读取约束 / 返回结构 / 边界：无·多音轨、同名不同目录、损坏头…）
#                    + 真包与**规格字面量参考实现**逐项比对。
#                    （2026-09-16 洁净室重写 P-89：不再读取/切片渲染器文件，详见 THIRD-PARTY.md）
#   scene-audio-route-test：真 index.js 路由桩（206 只回 64KB / 预检 / 探测 JSON / 安全）。
step "7/12 音频扫描提速（惰性索引 + Range/探测路由；真包与规格参考实现逐项一致）"
node tools/audio-scan-test.mjs || fail=1
node tools/scene-audio-route-test.mjs || fail=1

# ①(2026-09-15 用户第 1 条反馈 ⑥c) ensureSceneVideo 改「索引先行」：只读目录表 + 仅候选条目前缀，
#   不再整包 readFileSync、也不再把每个 .tex 的 mipmap 全解压（它在"应用壁纸"关键路径上）。
#   语义门禁：四类（独立视频 / TEX 内嵌 / 无视频 / 多视频）+ mip0 LZ4 / 条目级 LZ4 / 前缀不可判定
#   全部与**旧实现**逐项比 ref 与 sha256；语料每个 .tex 的"前缀判定"不许说谎；缓存 O(1)；
#   落盘缓存文件名（hash 公式）与内容 sha256 与改前一致（升级后不重抽）。
step "8/12 scene 视频索引（应用壁纸关键路径；旧实现逐项一致 + 缓存 + 缓存文件同名同内容）"
node tools/scene-video-test.mjs || fail=1
# ①(2026-09-23 资源审计 #1，docs/RESOURCE-AUDIT-20260923.md §2.1) 上一条用的是"真机语料"
#   （本机 ../allwallpaper/dd 2.3GB，B/C 段会整包读）—— 本机可用内存只有 ~4GB，常驻门禁不能只靠它。
#   于是**同一个 step** 下再挂一条纯自造夹具的测试（夹具合计 3.71MiB、峰值堆 <64MB、
#   无浏览器/无网络/不读语料，实测 297ms），钉住 `sceneVideoScanCache`（`lib/pkg-extract.js`）的
#   **字节预算 / 逐出 / 回收 / 接线**：
#   那个缓存里存的是**整段视频字节**，审计时只有"条数 64"一道闸门（最坏 64 × 单条体积常驻），
#   且 `clearSceneVideoScanCache()` 全仓零调用。
#   判据：默认闸门（64MB / 单条 32MB / 64 条 / TTL 10min）/ 预算内小条目行为逐键不变（回归）/
#   6×300KiB 写进 1MB 预算 ⇒ 逐出且总字节 ≤ 预算 / 逐出后旧 `video` 引用不再被缓存持有（快照身份比对）/
#   单条超上限不入缓存但仍完整返回 / 整条读**之前**腾位置（preReadEvictions）/ TTL 过期与"命中刷新"/
#   `lib/index.js` 换 scene 目录时真的调了清理 —— 并配**四个变异体各自必红**（去掉字节闸门 /
#   去掉读前腾位置 / 去掉 TTL sweep / 删掉 index.js 的清理调用）。40 通过 / 0 失败。
node tools/scene-video-cache-test.mjs || fail=1
# ①(2026-09-23 静默失败审计 #3，../docs/SILENT-FAILURE-AUDIT-20260923.md §A-3 表 #3/#4) 上面两条门禁测的是
#   "探测得对 / 缓存得对"，这一条测"探测或落盘**失败时不许说谎**"：`ensureSceneVideo` 改前把三种状态
#   压成一个 `null` —— ② 两级探测都抛也写 `{hash:null}` 负缓存（/custom-scene-video-check 永久回
#   200 has:false，错误答案粘死）；③ 落盘失败静默吞掉、照写索引 + 照返回 path（客户端拿到必然 404
#   的 <video>）。判据：A 真·无视频仍 200 has:false 且第二次走负缓存（不重探）/ B 两级都抛 ⇒ 两次都
#   500 且不留负缓存 / C DATA_DIR/scene-videos 被普通文件占位 ⇒ check 与 /custom-scene-video 都 500、
#   落盘产物确实不存在 / D 回归（正常可写 ⇒ 200 has:true + 文件真的在 + 字节一致）+ "目录不在"仍是
#   200 has:false 与 404 —— 并配**两个变异体各自必红**（删探测失败的抛错 ⇒ B 红；删落盘失败的抛错
#   ⇒ C 红）。纯自造夹具（<8KiB、无浏览器/网络/ffmpeg、不读语料），实测 20 通过 / 0 失败、512ms。
node tools/scene-video-probe-fail-test.mjs || fail=1

# ①(2026-09-16 第三个视觉 bug 定案轮) 「顶栏磨砂 / 顶栏描边 / 时间线条」的**真机复刻 A/B**：
#   宿主 CSS（真产物）+ 我们的 buildCss 产物 + 无头 Firefox 取 computed 值。
#   为什么需要它：本机无 GPU ⇒ 无头 Firefox **不合成** backdrop-filter（blur 0/10/30px 的截图逐像素
#   相同，见 docs/HEADER-FROST.md「像素判据的边界」），所以像素差在本机是**假阴性**；
#   本步改用结构性判据（z-index 正负 / 层可见性 / 描边 alpha / rail 晕），并强制
#   "before 变体必须测到旧 bug、after 变体必须测到已修复" ⇒ 探针自身有分辨力（防"假绿"）。
#   证据落盘：tools/probe-out/replica-ab.txt 与 replica-{before,after}/{measure.json,shot.png}
step "9/12 真机复刻 A/B（磨砂层叠 / 描边恢复 / rail 反色晕；before↔after 双向断言）"
node tools/header-rail-replica.mjs --both || fail=1

# ①(2026-09-17 第 1 项「壁纸插件对 better-sidebar 的适配」) 两段链路都曾**静默失效**：
#   ① host /ping 的 betterSidebarVersion 恒 null（局部变量遮蔽同名函数，见 lib/index.js:70 注释）；
#   ② 客户端只在"设置页组件"的 effect 里探测版本 ⇒ 不打开设置页时 body 上永远没有
#      data-mpw-bs-version ⇒ 版本门控 CSS 一条都不生效。
#   本步断言：/ping 返回磁盘上真实版本（含"多 profile 里只有一个装了"的场景）/ 把函数名改回
#   同名后同断言必须变红（变异用例，防假绿）/ apply() 页面加载路径即写 body 属性（桩 DOM 属性表）/
#   浮窗规则必须带 0.16 版本门控 / 已装版本的产物里我们依赖的 DOM 锚点仍在（金丝雀）。
#   真机 DOM 证据（0.19.1 真页面）：node tools/bs-compat-probe.mjs（见 docs/BETTER-SIDEBAR-COMPAT.md）
step "10/12 better-sidebar 适配（/ping 版本链路 + 页面加载期版本门控 + 锚点金丝雀）"
node tools/better-sidebar-compat-test.mjs || fail=1
# ①(2026-09-18 用户裁定) bsCompat 总开关**默认改为开**（底部面板悬浮适配已真机定案，默认关 = 没人看得见），
#   并且**只迁移"从没显式设过"的存量用户**、用户手动关过的绝不覆盖（写入口打 bsCompatUserSet 标记；
#   迁移不打标记）。判据双向：默认档生效 / 显式关过不生效且迁移不发生 / 迁移后手动关持久生效（含"重启"重放）；
#   变异自证：删掉"用户设过就不迁移"、把默认值改回 false、写入口不打标记 ⇒ 三组各自变红。
node tools/bs-compat-default-test.mjs || fail=1

# ①(2026-09-17 单文件 bundle 轮 / MASTER-TODO §5 第 6 项)「npm + 单文件 bundle 两种装载」的机器门禁：
#   单文件装载（README 方式四）是**只装宿主端**的降级通道；产物一旦与 lib/*.js 漂移（少一条路由、
#   Range/206 语义变了、ping 键变了、导出面变了），用户侧就是"静默半坏"。本步：
#   ① 重新构建 dist/dsh-mpkg-wallpaper.bundle.mjs 并核对 manifest（sha256 + 字节数 + 模块表）；
#   ② 两次构建**字节级一致**（产物可复现 ⇒ release 页能公布哈希让人复算）；
#   ③ 同一套路由断言分别打源码与 bundle（各自独立子进程 + 独立 DSH_HOME 夹具；235MB 的真 scene.pkg
#      用**符号链接**引入，夹具每份 <1MB）⇒ 路由表与 11 组路由行为逐字段一致；
#   ④ 两种真实装载布局的降级边界：隔离目录（ping.version=null、/lg/* 404）↔ 伴生目录（版本一致、
#      /lg/* 与源码逐字节相同）；
#   ⑤ 变异对照（/raw 路由改名 / ping 载荷改 / 少一个导出）必须让门禁变红 —— 防假绿。
#   产物与摘要：dist/dsh-mpkg-wallpaper.bundle.mjs、tools/probe-out/bundle-manifest.json（都不入库）；
#   设计与装载边界见 README「方式四」、发布流程见 docs/RELEASE.md
step "11/12 单文件 bundle 等价性（构建可复现 + 源码↔bundle 路由逐字段对拍 + 装载布局 + 变异对照）"
node tools/bundle-equivalence-test.mjs || fail=1

# ⓪(2026-09-17 MASTER-TODO §5 第 2 项「样式作用域护栏（自动的）」) 两次真实事故（右侧轮次导航条被弄透明、
#   顶栏下描边被抹掉）都不是"某一行写错"，而是**选择器作用域没人管**。本步把这件事变成会变红的判据：
#   我们注入的每条 CSS 规则的选择器都必须命中我们自己的标记（.mpw* / [data-mpw*] / #mpw-*），
#   或命中**已登记**的宿主/第三方作用域（bsCompat 打 [data-dsh-better-sidebar] 那一块也在其列，
#   必须登记 reason + docs/*.md:行号 指针，指针运行时校验；未登记 = REVIEW = 判红）。
#   裸元素/裸 *、:root 上覆盖宿主 token、宿主 token 的 transparent/inherit/未登记 !important、
#   未门控碰宿主 rail 家族、[data-dsh-panel-host]、顶栏描边透明化 ⇒ 直接 RED。
#   判据/账本/怎么加登记项：docs/STYLE-SCOPE-GUARD.md；机器可读产物：tools/probe-out/style-scope.json
#   自证（变异必须有分辨力）：node tools/style-scope-guard.mjs --selftest（10 条变异 + 1 条阴性对照）
# ①(2026-09-18 §5 第1项 / P0-3「磨砂·主题一致性」) 表面 token 命名空间：
#   · 宿主 token 覆盖登记表（产物里 39 处覆盖全部登记命中；未登记判红；登记项的"生效条件"
#     在功能关闭的组合里必须一次都不出现 ⇒ 机器证明覆盖没漏进默认档）；
#   · 四个表面（顶栏/侧栏/面板/时间线条）只读共享 --mpw-surface-*，表面规则里再出现 var(--dsw-*) 判红；
#   · token-namespace-test：以 git HEAD 的 lib/client.js 为 before，606 组设置 × 亮/暗 × 默认/门控
#     两态比对四表面**生效值**（极小层叠模型 + var() 递归代换）⇒ 重构前后逐键相等；
#     SSOT 定义点必须唯一且是 body（宿主 --dsw-* 定义在 body，写 :root 会 guaranteed-invalid 继承）；
#     变异自证：改 SSOT 取值 / 把 SSOT 挪回 :root / 表面换字面量 都必须变红。
#   账本与清单：docs/TOKEN-NAMESPACE.md
step "12/12 样式作用域护栏（真实产物 615 组设置全枚举；裸元素/裸 */:root 覆盖/宿主 token/禁止锚点判红）+ 表面 token 命名空间（宿主覆盖登记表 + 四表面共享 --mpw-* + 取值等价）"
node tools/style-scope-guard.mjs || fail=1
node tools/token-namespace-test.mjs || fail=1

echo
if [ "$fail" = 0 ]; then
  echo "全部通过 ✓  下一步：bash $(cd .. && pwd)/update-plugin.sh 然后刷新浏览器"   # ①(2026-09-19 敏感信息加固) 工作区根按脚本位置推导，不写本机绝对路径
else
  echo "存在失败项 ✗  修好再同步（不要带着失败项让用户刷新）"
fi
exit "$fail"
