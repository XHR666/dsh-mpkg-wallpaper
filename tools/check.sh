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

step "1/11 语法检查 lib/*.js"
for f in lib/*.js; do
  if node --check "$f"; then echo "  ✓ $f"; else echo "  ✗ $f 语法错误"; fail=1; fi
done

step "2/11 面板冒烟（含 CSS 模板闭合 / h 声明 / 花括号配平 / 渲染）+ P-66 面板健壮性/语言回归 + 选择器（第13条）回归 + 壁纸层可见性（.mpw-bgWrap）回归 + 壁纸持久化（刷新不丢）回归"
node tools/panel-smoke.mjs || fail=1
# ①(第13条 用户点名"长期没修好"的 bug) 选择文件夹/选择文件的选择器：
#   滚动位置（重渲染/容器被重建后不跳顶）、不抢焦点、键盘导航、500 项大目录、滚轮不串联宿主。
#   A 组源码级（**同一套断言对 `git show HEAD:lib/client.js` 必须变红** ⇒ 证明用例有分辨力）
#   B 组假 DOM + 迷你 React（切 lib/client.js 的 MPW-DIRPICK 块，跑生产实现）
#   规格/根因/行为契约：docs/DIR-PICKER-SCROLL.md
node tools/dir-picker-test.mjs || fail=1
# P-66（2026-09-15）：①渲染错误边界（catch 里引用 try 块内 const h → 真因被吞）②zh/en 字典键对齐
node tools/panel-fixes-test.mjs || fail=1
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

if [ "${1:-}" != "--quick" ]; then
  step "3/11 CSS 组合矩阵（512 全组合 + 600 随机 + 边界；8 类历史回归断言）"
  node tools/css-matrix.mjs || fail=1
else
  step "3/11 组合矩阵（已按 --quick 跳过）"
fi

step "4/11 场景看门狗/调试参数回归（批次15：B1/B3/B5 + 作用域修复 P0）"
node tools/scene-watchdog-test.mjs || fail=1

# 批次18 / B6：渲染器沙箱（去 allow-same-origin）+ 场景级短期 token
# 契约 we-scene-demo/RENDERER-SANDBOX-CONTRACT.md；两侧各自回归，宿主侧只走拒绝路径（不落盘）。
# ①(2026-09-16 I 项) 网页（web）壁纸：类型判定（内容优先）/ sandbox 最小必要集 /
#   shim 注入顺序 / shim API 与参考实现的差异 / 作者脚本抛错兜底 / 无 GPL 代码 —— 见 docs/WEB-WALLPAPER.md
step "5/11 B6 沙箱与场景 token + 网页壁纸 shim 沙箱（客户端模式/回退 + 宿主签发与 Origin:null 闸门）"
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

# ①(第16项) 发布前完整性自检：必需文件/package.json 字段/files 白名单/个人路径/凭据形态/图标/门禁脚本在位
step "6/11 发布完整性自检（第16项：文件齐全、元数据、白名单、无个人路径与凭据）"
node tools/integrity-check.mjs || fail=1

# ①(2026-09-15 用户第 1 条反馈「扫描音频的速度能否快些」)
#   惰性音频索引（只读目录表 + 仅候选条目 16 字节头，带 mtime+size 缓存）+
#   宿主侧 /raw 的 Range/206 与 /custom-scene-audio 探测路由。
#   audio-scan-test：**规格断言**（docs/AUDIO-TRACK-SPEC.md：后缀表 / 容器规则表 R1–R7 /
#                    收集去重 / 读取约束 / 返回结构 / 边界：无·多音轨、同名不同目录、损坏头…）
#                    + 真包与**规格字面量参考实现**逐项比对。
#                    （2026-09-16 洁净室重写 P-89：不再读取/切片渲染器文件，详见 THIRD-PARTY.md）
#   scene-audio-route-test：真 index.js 路由桩（206 只回 64KB / 预检 / 探测 JSON / 安全）。
step "7/11 音频扫描提速（惰性索引 + Range/探测路由；真包与规格参考实现逐项一致）"
node tools/audio-scan-test.mjs || fail=1
node tools/scene-audio-route-test.mjs || fail=1

# ①(2026-09-15 用户第 1 条反馈 ⑥c) ensureSceneVideo 改「索引先行」：只读目录表 + 仅候选条目前缀，
#   不再整包 readFileSync、也不再把每个 .tex 的 mipmap 全解压（它在"应用壁纸"关键路径上）。
#   语义门禁：四类（独立视频 / TEX 内嵌 / 无视频 / 多视频）+ mip0 LZ4 / 条目级 LZ4 / 前缀不可判定
#   全部与**旧实现**逐项比 ref 与 sha256；语料每个 .tex 的"前缀判定"不许说谎；缓存 O(1)；
#   落盘缓存文件名（hash 公式）与内容 sha256 与改前一致（升级后不重抽）。
step "8/11 scene 视频索引（应用壁纸关键路径；旧实现逐项一致 + 缓存 + 缓存文件同名同内容）"
node tools/scene-video-test.mjs || fail=1

# ①(2026-09-16 第三个视觉 bug 定案轮) 「顶栏磨砂 / 顶栏描边 / 时间线条」的**真机复刻 A/B**：
#   宿主 CSS（真产物）+ 我们的 buildCss 产物 + 无头 Firefox 取 computed 值。
#   为什么需要它：本机无 GPU ⇒ 无头 Firefox **不合成** backdrop-filter（blur 0/10/30px 的截图逐像素
#   相同，见 docs/HEADER-FROST.md「像素判据的边界」），所以像素差在本机是**假阴性**；
#   本步改用结构性判据（z-index 正负 / 层可见性 / 描边 alpha / rail 晕），并强制
#   "before 变体必须测到旧 bug、after 变体必须测到已修复" ⇒ 探针自身有分辨力（防"假绿"）。
#   证据落盘：tools/probe-out/replica-ab.txt 与 replica-{before,after}/{measure.json,shot.png}
step "9/11 真机复刻 A/B（磨砂层叠 / 描边恢复 / rail 反色晕；before↔after 双向断言）"
node tools/header-rail-replica.mjs --both || fail=1

# ①(2026-09-17 第 1 项「壁纸插件对 better-sidebar 的适配」) 两段链路都曾**静默失效**：
#   ① host /ping 的 betterSidebarVersion 恒 null（局部变量遮蔽同名函数，见 lib/index.js:70 注释）；
#   ② 客户端只在"设置页组件"的 effect 里探测版本 ⇒ 不打开设置页时 body 上永远没有
#      data-mpw-bs-version ⇒ 版本门控 CSS 一条都不生效。
#   本步断言：/ping 返回磁盘上真实版本（含"多 profile 里只有一个装了"的场景）/ 把函数名改回
#   同名后同断言必须变红（变异用例，防假绿）/ apply() 页面加载路径即写 body 属性（桩 DOM 属性表）/
#   浮窗规则必须带 0.16 版本门控 / 已装版本的产物里我们依赖的 DOM 锚点仍在（金丝雀）。
#   真机 DOM 证据（0.19.1 真页面）：node tools/bs-compat-probe.mjs（见 docs/BETTER-SIDEBAR-COMPAT.md）
step "10/11 better-sidebar 适配（/ping 版本链路 + 页面加载期版本门控 + 锚点金丝雀）"
node tools/better-sidebar-compat-test.mjs || fail=1

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
step "11/11 单文件 bundle 等价性（构建可复现 + 源码↔bundle 路由逐字段对拍 + 装载布局 + 变异对照）"
node tools/bundle-equivalence-test.mjs || fail=1


echo
if [ "$fail" = 0 ]; then
  echo "全部通过 ✓  下一步：bash /root/Desktop/DSHarea/update-plugin.sh 然后刷新浏览器"
else
  echo "存在失败项 ✗  修好再同步（不要带着失败项让用户刷新）"
fi
exit "$fail"
