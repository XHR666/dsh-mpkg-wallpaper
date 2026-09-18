#!/usr/bin/env bash
# tools/pre-commit.sh —— 秒级 pre-commit 门禁（建议 S-8 的落地；**不碰** check.sh 的重活）
#
# 为什么只跑这两个（2026-09-19 多次实测合计 **2.8–3.9 s**，**串行**；其中 switch-wiring 含 7 条分辨力变异自证）：
#   · tools/panel-smoke.mjs        面板能渲染（CSS 模板闭合 / h 声明 / 花括号配平 / 语言字典 / 选择器回归）
#   · tools/switch-wiring-test.mjs 每个开关必须真的改变产物 + 已退役开关 0 悬空引用
#     这一类"开关加了没接线"在本仓**真实发生过 3 次**（accent/aquaTextEnhance、lgCss、sessionFollow）
#     ⇒ 数秒成本换掉一整类静默失效，是本仓库最高杠杆的一条。
# 为什么不把 `tools/check.sh` 整个塞进来：它 12 步，第 3 步是 1115 组 CSS 矩阵、第 9 步起要无头 Firefox
#   ⇒ 分钟级。它一旦进 pre-commit 就会变成"改一行不敢提交"，反而降低门禁使用率。组合矩阵 / 作用域护栏 /
#   bundle 等价性 / token 命名空间仍由 `bash tools/check.sh`（或 CI）跑。
#
# 不阻塞开发的四个口子：
#   ① **装载是显式的**：`git config core.hooksPath .githooks` 才生效（不装 = 对任何人零影响）
#   ② 暂存区里没有 `lib/` `tools/` `package.json` 的改动 ⇒ 直接跳过（纯文档/注释提交零成本）
#   ③ 随时可绕：`git commit --no-verify`，或 `MPW_SKIP_PRECOMMIT=1 git commit …`
#   ④ 失败只**原样打印红行**（不改文件、不吞输出、不自动 fix）
#
# 用法：
#   bash tools/pre-commit.sh                              # 跑仓库自己的 lib/client.js
#   bash tools/pre-commit.sh --client /tmp/mut-client.js  # 跑副本（护栏自证用；真树一个字节都不动）
#   MPW_SKIP_PRECOMMIT=1 bash tools/pre-commit.sh         # 强制跳过（恒 exit 0）

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 0

say() { printf '%s\n' "$*"; }

CLIENT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --client) CLIENT="${2:-}"; shift 2 ;;
    --client=*) CLIENT="${1#*=}"; shift ;;
    -h | --help) sed -n '2,28p' "$0"; exit 0 ;;
    *) say "✗ 未知参数：$1（支持 --client <path>）"; exit 2 ;;
  esac
done

# ③ 显式跳过口（在 node 探测之前：没装 node 的机器也想提交）
if [ "${MPW_SKIP_PRECOMMIT:-}" = "1" ]; then
  say "… MPW_SKIP_PRECOMMIT=1 ⇒ 跳过 pre-commit 秒级门禁（完整门禁：bash tools/check.sh）"
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  say "… 找不到 node ⇒ 跳过 pre-commit 秒级门禁"
  exit 0
fi

for f in tools/panel-smoke.mjs tools/switch-wiring-test.mjs; do
  if [ ! -f "$ROOT/$f" ]; then
    say "… 缺 $f ⇒ 跳过（别让门禁本身变成阻塞）"
    exit 0
  fi
done

# ② 纯文档提交零成本：**只有作为 hook 跑**（暂存区非空）时才做路径过滤；
#    手动 `bash tools/pre-commit.sh` 没有暂存内容 ⇒ 照跑（手跑就是要跑）。
if [ -z "$CLIENT" ]; then
  staged="$(git -C "$ROOT" diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)"
  if [ -n "$staged" ] && ! printf '%s\n' "$staged" | grep -Eq '^(lib/|tools/|package\.json$)'; then
    say "… 暂存区只动了非产物路径（无 lib/ · tools/ · package.json）⇒ 跳过 pre-commit 秒级门禁"
    exit 0
  fi
fi

declare -a ARGS=()
if [ -n "$CLIENT" ]; then
  if [ ! -f "$CLIENT" ]; then say "✗ --client 指向的文件不存在：$CLIENT"; exit 2; fi
  ARGS=(--client "$CLIENT")
fi

say "══ pre-commit 秒级门禁（panel-smoke + switch-wiring；完整 12 步：bash tools/check.sh）══"
[ -n "$CLIENT" ] && say "   被测产物：$CLIENT（副本模式）"

fail=0
T0=$(date +%s%N)
run() {
  local name="$1" script="$2" note="$3"
  local t0 t1 rc out ms
  say ""
  say "── $name  ${note}"
  t0=$(date +%s%N)
  out="$(node "tools/$script" ${ARGS[@]+"${ARGS[@]}"} 2>&1)"
  rc=$?
  t1=$(date +%s%N)
  ms=$(((t1 - t0) / 1000000))
  if [ "$rc" -eq 0 ]; then
    say "   ✓ $name 通过（${ms} ms）"
    printf '%s\n' "$out" | grep -E '通过 ✓|结果:|全部接线' | tail -2 | sed 's/^/     · /'
  else
    fail=1
    say "   ✗ $name **失败**（rc=$rc，${ms} ms）—— 变红的行："
    printf '%s\n' "$out" | grep -E '✗' | head -8 | sed 's/^/     /'
  fi
}

run "panel-smoke（面板渲染 + 语言字典）" panel-smoke.mjs "秒级"
run "switch-wiring（开关必须真接线 / 退役开关 0 悬空）" switch-wiring-test.mjs "秒级"
T1=$(date +%s%N)

TOTAL=$(((T1 - T0) / 1000000))
say ""
if [ "$fail" -ne 0 ]; then
  say "✗ pre-commit 未通过（${TOTAL} ms）。上面每一条红行都是**真事故**的形状：开关点了没效果 / 面板渲染坏了。"
  say "  · 看全量输出：node tools/panel-smoke.mjs   /   node tools/switch-wiring-test.mjs"
  say "  · 本次确实要跳过：git commit --no-verify   或   MPW_SKIP_PRECOMMIT=1 git commit …"
  say "  · 跳过 = 把风险推给 bash tools/check.sh / CI；这两条只在改了 lib/ 或 tools/ 时才可能红"
  exit 1
fi
say "✓ pre-commit 秒级门禁通过（${TOTAL} ms）：面板能渲染 + 每个开关都真的接线（含退役开关 0 悬空引用）"
say "  完整门禁（1115 组 CSS 矩阵 / 作用域护栏 / bundle 等价性 / 样式命名空间，含无头 Firefox 步骤）：bash tools/check.sh"
exit 0
