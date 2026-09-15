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

step "1/8 语法检查 lib/*.js"
for f in lib/*.js; do
  if node --check "$f"; then echo "  ✓ $f"; else echo "  ✗ $f 语法错误"; fail=1; fi
done

step "2/8 面板冒烟（含 CSS 模板闭合 / h 声明 / 花括号配平 / 渲染）+ P-66 面板健壮性/语言回归"
node tools/panel-smoke.mjs || fail=1
# P-66（2026-09-15）：①渲染错误边界（catch 里引用 try 块内 const h → 真因被吞）②zh/en 字典键对齐
node tools/panel-fixes-test.mjs || fail=1

if [ "${1:-}" != "--quick" ]; then
  step "3/8 CSS 组合矩阵（512 全组合 + 600 随机 + 边界；8 类历史回归断言）"
  node tools/css-matrix.mjs || fail=1
else
  step "3/8 组合矩阵（已按 --quick 跳过）"
fi

step "4/8 场景看门狗/调试参数回归（批次15：B1/B3/B5 + 作用域修复 P0）"
node tools/scene-watchdog-test.mjs || fail=1

# 批次18 / B6：渲染器沙箱（去 allow-same-origin）+ 场景级短期 token
# 契约 we-scene-demo/RENDERER-SANDBOX-CONTRACT.md；两侧各自回归，宿主侧只走拒绝路径（不落盘）。
step "5/8 B6 沙箱与场景 token（客户端模式/回退 + 宿主签发与 Origin:null 闸门）"
node tools/scene-sandbox-test.mjs || fail=1
node tools/host-sandbox-token-test.mjs || fail=1

# ①(第16项) 发布前完整性自检：必需文件/package.json 字段/files 白名单/个人路径/凭据形态/图标/门禁脚本在位
step "6/8 发布完整性自检（第16项：文件齐全、元数据、白名单、无个人路径与凭据）"
node tools/integrity-check.mjs || fail=1

# ①(2026-09-15 用户第 1 条反馈「扫描音频的速度能否快些」)
#   惰性音频索引（只读目录表 + 仅候选条目 16 字节头，带 mtime+size 缓存）+
#   宿主侧 /raw 的 Range/206 与 /custom-scene-audio 探测路由。
#   audio-scan-test：**规格断言**（docs/AUDIO-TRACK-SPEC.md：后缀表 / 容器规则表 R1–R7 /
#                    收集去重 / 读取约束 / 返回结构 / 边界：无·多音轨、同名不同目录、损坏头…）
#                    + 真包与**规格字面量参考实现**逐项比对。
#                    （2026-09-16 洁净室重写 P-89：不再读取/切片渲染器文件，详见 THIRD-PARTY.md）
#   scene-audio-route-test：真 index.js 路由桩（206 只回 64KB / 预检 / 探测 JSON / 安全）。
step "7/8 音频扫描提速（惰性索引 + Range/探测路由；真包与规格参考实现逐项一致）"
node tools/audio-scan-test.mjs || fail=1
node tools/scene-audio-route-test.mjs || fail=1

# ①(2026-09-15 用户第 1 条反馈 ⑥c) ensureSceneVideo 改「索引先行」：只读目录表 + 仅候选条目前缀，
#   不再整包 readFileSync、也不再把每个 .tex 的 mipmap 全解压（它在"应用壁纸"关键路径上）。
#   语义门禁：四类（独立视频 / TEX 内嵌 / 无视频 / 多视频）+ mip0 LZ4 / 条目级 LZ4 / 前缀不可判定
#   全部与**旧实现**逐项比 ref 与 sha256；语料每个 .tex 的"前缀判定"不许说谎；缓存 O(1)；
#   落盘缓存文件名（hash 公式）与内容 sha256 与改前一致（升级后不重抽）。
step "8/8 scene 视频索引（应用壁纸关键路径；旧实现逐项一致 + 缓存 + 缓存文件同名同内容）"
node tools/scene-video-test.mjs || fail=1

echo
if [ "$fail" = 0 ]; then
  echo "全部通过 ✓  下一步：bash /root/Desktop/DSHarea/update-plugin.sh 然后刷新浏览器"
else
  echo "存在失败项 ✗  修好再同步（不要带着失败项让用户刷新）"
fi
exit "$fail"
