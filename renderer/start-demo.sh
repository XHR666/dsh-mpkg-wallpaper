#!/bin/bash
# start-demo.sh —— P-91：**一条命令**把渲染器跑起来（"打开即玩"的本地入口）
#
# 用法:
#   bash start-demo.sh                 # 起服务器并前台运行（默认 8899）
#   bash start-demo.sh --port 9000     # 换端口（等价 PORT=9000）
#   bash start-demo.sh --check         # **只做预检**，不起服务（退出码即结论；CI 用）
#   bash start-demo.sh --quiet         # 少打印（只留 URL 行；供脚本/测试解析）
#   bash start-demo.sh --open          # 起来后用 xdg-open/open 打开浏览器
#
# 为什么要有它（而不是让下载者读 README 抄 `node server/we-scene-demo-server.mjs`）：
#   ① 默认端口被占是最常见的第一次失败 —— 这里**先探测**再回退，且把最终 URL 明确打出来；
#   ② 渲染器**自带**包解析器 `pkg-parse.mjs`（MIT 薄封装 `packages/we-core/src/pkg.js`）⇒ 克隆本仓即可跑 ✓；
#      只有需要**场景/纹理抽取**（插件 `lib/pkg-extract.js` 的 extractScene*/extractTex*）时才用 MPW_PKG_EXTRACT 指向它（可选）；
#   ③ 没语料时页面会降级到合成样例，但**没人知道为什么**——预检把"能渲染什么"提前说清。
#
# 退出码：0 正常（--check 时=预检通过）；2 用法错误；3 预检失败（--check）；4 端口不可用
cd "$(dirname "$0")" || exit 2

PORT="${PORT:-8899}"
MODE=serve; QUIET=0; OPEN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --port) shift; PORT="${1:-}";;
    --check) MODE=check;;
    --quiet) QUIET=1;;
    --open) OPEN=1;;
    -h|--help) sed -n '2,20p' "$0"; exit 0;;
    *) echo "未知参数 $1（用法见 bash start-demo.sh --help）" >&2; exit 2;;
  esac
  shift
done
case "$PORT" in ''|*[!0-9]*) echo "端口非法：$PORT" >&2; exit 2;; esac
# ①(P-91 自证发现的真 bug) **必须 export**：服务器读的是 `process.env.PORT`，
#   只赋值不导出时子进程收不到 ⇒ `--port 9000` 会静默起在 8899（packaging-test 的 E 组抓到的）。
export PORT

say() { [ "$QUIET" = 1 ] || echo "$@"; }
bad() { echo "✗ $@" >&2; }
ok()  { say "✓ $@"; }

PREFLIGHT_FAIL=0

# ── ① Node 版本（package.json engines: >=20；bundle 用了 `??`/可选链/顶层 await） ──
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "${NODE_MAJOR:-0}" -ge 20 ] 2>/dev/null; then ok "node $(node -v)（要求 >=20）"
else bad "node 版本过低或未安装（当前 ${NODE_MAJOR:-无}，要求 >=20）"; PREFLIGHT_FAIL=1; fi

# ── ② 包解析器落点（与 server/we-scene-demo-server.mjs 的解析链**逐条同序**，避免"预检绿、起服务红"） ──
PE_LOCAL="$PWD/pkg-parse.mjs"          # 本仓自带（MIT）
PE_LEGACY="$PWD/pkg-extract.mjs"      # legacy 名（自己放的副本）
PE_PLUGIN="${MPW_ROOT:-$(cd .. && pwd)}/dsh-mpkg-wallpaper/lib/pkg-extract.js"
PE_RESOLVED=""
if [ -n "${MPW_PKG_EXTRACT:-}" ]; then
  if [ -f "$MPW_PKG_EXTRACT" ]; then PE_RESOLVED="$MPW_PKG_EXTRACT"; ok "包解析器：MPW_PKG_EXTRACT=$MPW_PKG_EXTRACT"
  else bad "MPW_PKG_EXTRACT 指向的文件不存在：$MPW_PKG_EXTRACT"; PREFLIGHT_FAIL=1; fi
elif [ -f "$PE_LOCAL" ]; then PE_RESOLVED="$PE_LOCAL"; ok "包解析器：本仓自带 pkg-parse.mjs ✓（克隆即可跑，无需外部仓库）"
elif [ -f "$PE_LEGACY" ]; then PE_RESOLVED="$PE_LEGACY"; ok "包解析器：同目录 pkg-extract.mjs（legacy 名）"
elif [ -f "$PE_PLUGIN" ]; then PE_RESOLVED="$PE_PLUGIN"; ok "包解析器：$PE_PLUGIN（MIT 插件，见 THIRD-PARTY.md §7）"
else
  bad "找不到包解析器（pkg-extract）。三条修法任选："
  echo "     1) 把 MIT 插件与渲染器放在同一父目录：<父>/dsh-mpkg-wallpaper/lib/pkg-extract.js" >&2
  echo "     2) 设置环境变量 MPW_PKG_EXTRACT=/绝对路径/pkg-extract.js" >&2
  echo "     3) 把插件产物复制成同目录的 pkg-extract.mjs（保留其 MIT 声明）" >&2
  PREFLIGHT_FAIL=1
fi

# ── ③ 语料（没有也能起：页面降级到自带合成样例，但要说清） ──
CORPUS_ROOT="${MPW_SCENE_ROOT:-${MPW_ROOT:-$(cd .. && pwd)}/allwallpaper/dd}"
N_PKG=0
[ -d "$CORPUS_ROOT" ] && N_PKG="$(find "$CORPUS_ROOT" -maxdepth 2 -name 'scene.pkg' 2>/dev/null | wc -l | tr -d ' ')"
if [ "${N_PKG:-0}" -gt 0 ]; then ok "语料：$CORPUS_ROOT（$N_PKG 个 scene.pkg）"
else say "ℹ 没找到本机语料（$CORPUS_ROOT）—— 页面会用自带合成样例 samples/sample-synthetic（无第三方素材）"; fi

# ── ④ 自带样例必须在位（"打开即玩"的兜底；缺了就不是降级而是白屏） ──
if [ -f samples/sample-synthetic/scene.pkg ] && [ -f demo.html ]; then ok "自带样例与 demo.html 在位"
else bad "缺 samples/sample-synthetic/scene.pkg 或 demo.html —— 无法'打开即玩'"; PREFLIGHT_FAIL=1; fi

# ── ⑤ 端口可用性（--check 时只报告不占用） ──
port_busy() {
  if command -v ss >/dev/null 2>&1; then ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$1\$"
  else node -e 'const n=require("net");const s=n.createServer();s.once("error",()=>process.exit(0));s.listen(+process.argv[1],"127.0.0.1",()=>{s.close(()=>process.exit(1))})' "$1" >/dev/null 2>&1 && return 1 || return 0
  fi
}
if port_busy "$PORT"; then
  bad "端口 $PORT 已被占用（换一个：bash start-demo.sh --port 9000）"; PREFLIGHT_FAIL=1
else ok "端口 $PORT 可用"; fi

if [ "$MODE" = check ]; then
  [ "$PREFLIGHT_FAIL" = 0 ] && { say "✓ 预检通过（bash start-demo.sh 即可打开 http://127.0.0.1:$PORT/）"; exit 0; }
  exit 3
fi
[ "$PREFLIGHT_FAIL" = 0 ] || { bad "预检未通过，已中止（修好上面几条后重试；只想看预检：bash start-demo.sh --check）"; exit 3; }

URL="http://127.0.0.1:$PORT/"
say ""
say "════════════════════════════════════════════════════════════"
say "  WEwebLoader 渲染器已启动"
say "  打开即可玩（不装 WE、不克隆别的仓库）：$URL"
say "  自带合成样例直达：${URL}?id=sample-synthetic"
say "  逐层调试面板：${URL}?ln=1   诊断页：${URL%/}/diag"
say "  停止：Ctrl-C"
say "════════════════════════════════════════════════════════════"

# 稳定的一行输出（--quiet 也打印）：供 demo-launcher-test.mjs / 脚本解析
echo "URL: $URL"

if [ "$OPEN" = 1 ]; then
  ( command -v xdg-open >/dev/null 2>&1 && xdg-open "$URL" >/dev/null 2>&1 ) || \
  ( command -v open >/dev/null 2>&1 && open "$URL" >/dev/null 2>&1 ) || \
  say "ℹ 未找到 xdg-open/open，请手动打开上面的 URL"
fi

exec node server/we-scene-demo-server.mjs
