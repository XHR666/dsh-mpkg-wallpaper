#!/bin/bash
# check.sh —— P-91：**发布/自检的唯一入口**（一条命令 = 四项机器闸门 + 全量门禁）
#
# 用法:
#   bash check.sh              # 全量：docs-check → publish-check → diag-flag-check → run-all-tests.sh
# ①(2026-09-16 目录整理) 三个闸门脚本与回归器都在 tests/，本文件留在根 = 唯一入口（`bash check.sh` 不变）。
#   bash check.sh --fast       # 门禁跳最慢项（等价 run-all-tests.sh --fast）
#   bash check.sh --no-gate    # 只跑三项静态自检（秒级；提交前用）
#   bash check.sh --json       # 末尾追加机读汇总
#
# 为什么收敛成一条（用户第 3 项"CI/自检入口"）：
#   这四项此前散在四份文档/四段习惯里，**没有单一命令能回答"现在能不能发"**：
#     · `docs-check.mjs`      —— 15+ 文档里反引号引用的文件是否都存在 + P-编号健康 + 开关双向一致
#     · `publish-check.mjs`   —— 隐私/体积/专有文件（**发布前唯一必须 0 阻塞**的一项）
#     · `diag-flag-check.mjs` —— 代码开关 ↔ docs/README-DIAGNOSTICS.md 主表双向 0 差异
#     · `run-all-tests.sh`    —— 全量回归（项数会变，当前见 `bash run-all-tests.sh --list` 首行）
#   本脚本**不改变**任何一项的语义与退出码，只做"依次跑 + 汇总 + 一条退出码"，便于本地与 CI 同源。
#
# 退出码：0 全部通过（含条件项 SKIP）；1 有失败；2 用法错误
cd "$(dirname "$0")" || exit 2

FAST=0; JSON=0; GATE=1
while [ $# -gt 0 ]; do
  case "$1" in
    --fast) FAST=1;;
    --json) JSON=1;;
    --no-gate) GATE=0;;
    -h|--help) sed -n '2,18p' "$0"; exit 0;;
    *) echo "未知参数 $1（用法见 bash check.sh --help）" >&2; exit 2;;
  esac
  shift
done

declare -a SNAMES SSTATUS SMS
PASS=0; FAIL=0; SKIP=0
stage() { # stage <name> <必须先存在的文件，空=不检查> <cmd...>
  local name="$1" guard="$2"; shift 2
  local t0 t1 ms rc=0
  t0=$(date +%s.%N)
  echo "── $name"
  if [ -n "$guard" ] && [ ! -f "$guard" ]; then
    echo "SKIP $name（缺少 $guard，该文件只随 git 仓库分发；见 docs/PACKAGING.md §5）"
    SNAMES+=("$name"); SSTATUS+=("SKIP"); SMS+=("0"); SKIP=$((SKIP+1)); return
  fi
  "$@" || rc=$?
  t1=$(date +%s.%N); ms=$(echo "($t1-$t0)*1000" | bc 2>/dev/null | cut -d. -f1)
  if [ "$rc" -eq 0 ]; then echo "PASS $name (${ms}ms)"; SSTATUS+=("PASS"); PASS=$((PASS+1))
  else echo "FAIL $name (${ms}ms) — 退出码 $rc"; SSTATUS+=("FAIL"); FAIL=$((FAIL+1)); fi
  SNAMES+=("$name"); SMS+=("$ms")
}

stage "docs-check"      tests/docs-check.mjs      node tests/docs-check.mjs
stage "publish-check"   tests/publish-check.mjs   node tests/publish-check.mjs
stage "diag-flag-check" tests/diag-flag-check.mjs node tests/diag-flag-check.mjs
if [ "$GATE" = 1 ]; then
  if [ "$FAST" = 1 ]; then stage "run-all-tests" tests/run-all-tests.sh bash tests/run-all-tests.sh --fast
  else stage "run-all-tests" tests/run-all-tests.sh bash tests/run-all-tests.sh; fi
else
  echo "SKIP run-all-tests（--no-gate）"; SNAMES+=("run-all-tests"); SSTATUS+=("SKIP"); SMS+=("0"); SKIP=$((SKIP+1))
fi

echo "══ 自检汇总：PASS=$PASS FAIL=$FAIL SKIP=$SKIP / 总 ${#SNAMES[@]} 阶段"
if [ "$FAIL" -gt 0 ]; then
  echo "失败阶段："
  for i in "${!SNAMES[@]}"; do [ "${SSTATUS[$i]}" = "FAIL" ] && echo "  ✗ ${SNAMES[$i]}"; done
fi
if [ "$JSON" = 1 ]; then
  printf '{"pass":%d,"fail":%d,"skip":%d,"stages":[' "$PASS" "$FAIL" "$SKIP"
  for i in "${!SNAMES[@]}"; do
    printf '%s{"name":"%s","status":"%s","ms":%s}' "$([ "$i" -gt 0 ] && echo ,)" "${SNAMES[$i]}" "${SSTATUS[$i]}" "${SMS[$i]:-0}"
  done
  printf ']}\n'
fi
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
