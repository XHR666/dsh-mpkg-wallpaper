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

step "1/9 语法检查 lib/*.js"
for f in lib/*.js; do
  if node --check "$f"; then echo "  ✓ $f"; else echo "  ✗ $f 语法错误"; fail=1; fi
done

step "2/9 面板冒烟（含 CSS 模板闭合 / h 声明 / 花括号配平 / 渲染）+ P-66 面板健壮性/语言回归 + 选择器（第13条）回归"
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

if [ "${1:-}" != "--quick" ]; then
  step "3/9 CSS 组合矩阵（512 全组合 + 600 随机 + 边界；8 类历史回归断言）"
  node tools/css-matrix.mjs || fail=1
else
  step "3/9 组合矩阵（已按 --quick 跳过）"
fi

step "4/9 场景看门狗/调试参数回归（批次15：B1/B3/B5 + 作用域修复 P0）"
node tools/scene-watchdog-test.mjs || fail=1

# 批次18 / B6：渲染器沙箱（去 allow-same-origin）+ 场景级短期 token
# 契约 we-scene-demo/RENDERER-SANDBOX-CONTRACT.md；两侧各自回归，宿主侧只走拒绝路径（不落盘）。
# ①(2026-09-16 I 项) 网页（web）壁纸：类型判定（内容优先）/ sandbox 最小必要集 /
#   shim 注入顺序 / shim API 与参考实现的差异 / 作者脚本抛错兜底 / 无 GPL 代码 —— 见 docs/WEB-WALLPAPER.md
step "5/9 B6 沙箱与场景 token + 网页壁纸 shim 沙箱（客户端模式/回退 + 宿主签发与 Origin:null 闸门）"
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
step "6/9 发布完整性自检（第16项：文件齐全、元数据、白名单、无个人路径与凭据）"
node tools/integrity-check.mjs || fail=1

# ①(2026-09-15 用户第 1 条反馈「扫描音频的速度能否快些」)
#   惰性音频索引（只读目录表 + 仅候选条目 16 字节头，带 mtime+size 缓存）+
#   宿主侧 /raw 的 Range/206 与 /custom-scene-audio 探测路由。
#   audio-scan-test：**规格断言**（docs/AUDIO-TRACK-SPEC.md：后缀表 / 容器规则表 R1–R7 /
#                    收集去重 / 读取约束 / 返回结构 / 边界：无·多音轨、同名不同目录、损坏头…）
#                    + 真包与**规格字面量参考实现**逐项比对。
#                    （2026-09-16 洁净室重写 P-89：不再读取/切片渲染器文件，详见 THIRD-PARTY.md）
#   scene-audio-route-test：真 index.js 路由桩（206 只回 64KB / 预检 / 探测 JSON / 安全）。
step "7/9 音频扫描提速（惰性索引 + Range/探测路由；真包与规格参考实现逐项一致）"
node tools/audio-scan-test.mjs || fail=1
node tools/scene-audio-route-test.mjs || fail=1

# ①(2026-09-15 用户第 1 条反馈 ⑥c) ensureSceneVideo 改「索引先行」：只读目录表 + 仅候选条目前缀，
#   不再整包 readFileSync、也不再把每个 .tex 的 mipmap 全解压（它在"应用壁纸"关键路径上）。
#   语义门禁：四类（独立视频 / TEX 内嵌 / 无视频 / 多视频）+ mip0 LZ4 / 条目级 LZ4 / 前缀不可判定
#   全部与**旧实现**逐项比 ref 与 sha256；语料每个 .tex 的"前缀判定"不许说谎；缓存 O(1)；
#   落盘缓存文件名（hash 公式）与内容 sha256 与改前一致（升级后不重抽）。
step "8/9 scene 视频索引（应用壁纸关键路径；旧实现逐项一致 + 缓存 + 缓存文件同名同内容）"
node tools/scene-video-test.mjs || fail=1

# ①(2026-09-16 第三个视觉 bug 定案轮) 「顶栏磨砂 / 顶栏描边 / 时间线条」的**真机复刻 A/B**：
#   宿主 CSS（真产物）+ 我们的 buildCss 产物 + 无头 Firefox 取 computed 值。
#   为什么需要它：本机无 GPU ⇒ 无头 Firefox **不合成** backdrop-filter（blur 0/10/30px 的截图逐像素
#   相同，见 docs/HEADER-FROST.md「像素判据的边界」），所以像素差在本机是**假阴性**；
#   本步改用结构性判据（z-index 正负 / 层可见性 / 描边 alpha / rail 晕），并强制
#   "before 变体必须测到旧 bug、after 变体必须测到已修复" ⇒ 探针自身有分辨力（防"假绿"）。
#   证据落盘：tools/probe-out/replica-ab.txt 与 replica-{before,after}/{measure.json,shot.png}
step "9/9 真机复刻 A/B（磨砂层叠 / 描边恢复 / rail 反色晕；before↔after 双向断言）"
node tools/header-rail-replica.mjs --both || fail=1

echo
if [ "$fail" = 0 ]; then
  echo "全部通过 ✓  下一步：bash /root/Desktop/DSHarea/update-plugin.sh 然后刷新浏览器"
else
  echo "存在失败项 ✗  修好再同步（不要带着失败项让用户刷新）"
fi
exit "$fail"
