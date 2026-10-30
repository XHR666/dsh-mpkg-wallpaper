#!/bin/bash
# run-all-tests.sh — we-scene-demo 全量门禁一键回归（MERGED-2 第 4 项 I；任务书 C5.1 条件项机制）
# 用法: bash run-all-tests.sh [--fast] [--json] [--list] [--only <name> ...]
#   --fast        跳过最慢项（package-matrix --check、perf-profile 冒烟、layer-rect-check、parity-check）
#   --json        末尾追加机读 JSON 汇总
#   --list        列出全部测试项（标注 slow/条件项）后退出
#   --only <name> 只跑指定项（名字见 --list；未知名字报错退出 2）
#   ITEM_TIMEOUT  环境变量：单项超时秒数（默认 600）。超时按 FAIL 计并回收该项进程组，
#                 避免单项挂死把整条门禁静默拖住（曾发生：runner 阻塞在 pipe_read 20 分钟无输出）。
# 条件项（无数据自动 SKIP，不红）：工具自身输出 "SKIP <name>" 且退出 0 时按 SKIP 计（如 parity-check
#   在 reports/ 无含 layerLedger 的上报时）。本地无真机数据时门禁仍应全绿。
# 退出码：全绿/SKIP 0；有失败 1；用法错误 2（失败项最后 20 行见 /tmp/run-all-tests-last.log）
# ①(2026-09-16 目录整理) 本脚本住在 tests/，但**所有测试项的名称都相对仓库根**：
#   `cd` 到仓库根（不是脚本目录）⇒ 子进程拿到的相对路径与收拢前逐字一致，69 个测试项无需改命令。
cd "$(dirname "$0")/.." || exit 2
# ①(第16项 去个人化) 供子进程使用的根目录/测试包路径：环境变量可覆盖，默认值等价旧行为
export MPW_REPO_ROOT="${MPW_REPO_ROOT:-$PWD}"   # ②(2026-09-16) 仓库根（cd 已在此）
# ③(2026-09-16 修回归) **MPW_ROOT 的语义是"工作区根"**（本仓库既有口径）：`$MPW_ROOT/allwallpaper`、
#   `$MPW_ROOT/wallpaper_engine/assets` 都从它解析 ⇒ 它是**仓库的上一级**，不是仓库本身。
#   我在目录整理时曾把它写成 `$PWD`（仓库根）⇒ 所有依赖语料/WE 资产的用例集体变红（真包类 30+ 项）。
#   现已恢复原语义（与收拢前 `$(cd .. && pwd)` 逐字等价）。
export MPW_ROOT="${MPW_ROOT:-$(cd .. && pwd)}"
# ④(P-180 2026-09-24 可移植性审计 PA-36) **不再把某个容器的内容哈希当默认值**：旧默认是
#   `$HOME/.dsh-mpkg-wallpaper/d5007a52…….mpkg` —— 那是作者机上一份具体容器的**内容指纹**
#   （审计 PA-34/KI-7 里同一个哈希），换台机器必然不存在（本机实测该目录里只有 2aeac838…/
#   5a85a54b…/aef86642…/f643f908…，根本没有 d5007a52…）⇒ 依赖它的性能项静默走"0 个包"分支。
#   现在的口径：① 显式 `MPW_PERF_PKG` 优先（存在就用并打印读数/大小；不存在 ⇒ 明确打印
#   **SKIP** 与原因，绝不静默降级）；② 否则扫 `${MPW_PLUGIN_CACHE:-$HOME/.dsh-mpkg-wallpaper}`
#   里的 `*.mpkg`，取**最大的那个**（最大合集包覆盖路径最广；`ls -S` 口径可复现，与目录顺序无关），
#   并打印"采用了哪个 / 为什么"；③ 目录不存在或没有 `*.mpkg` ⇒ 打印 **SKIP** 读数，置空哨兵值
#   （哨兵 = 明确不存在的一条路径，让子进程走"找不到包"的既有分支，而不是回落成全量扫描）。
MPW_PERF_PKG_FROM=''
if [ -n "${MPW_PERF_PKG:-}" ]; then
  if [ -f "$MPW_PERF_PKG" ]; then
    MPW_PERF_PKG_FROM="显式指定（存在）"
    echo "[gate] MPW_PERF_PKG = $MPW_PERF_PKG（$MPW_PERF_PKG_FROM，$(wc -c <"$MPW_PERF_PKG" 2>/dev/null || echo '?') B）"
  else
    MPW_PERF_PKG_FROM="显式指定但**不存在**"
    echo "[gate] SKIP perf 包：MPW_PERF_PKG 显式指定但**不存在** = $MPW_PERF_PKG ⇒ 依赖它的项（perf-profile-smoke）拿不到输入，按条件项跳过（不静默降级、不回落成全量扫描）"
    MPW_PERF_PKG="$MPW_ROOT/.no-perf-pkg-SKIP"
  fi
else
  MPW_PERF_DIR="${MPW_PLUGIN_CACHE:-$HOME/.dsh-mpkg-wallpaper}"
  MPW_PERF_PICK="$(ls -S -- "$MPW_PERF_DIR"/*.mpkg 2>/dev/null | head -1)"
  if [ -n "$MPW_PERF_PICK" ]; then
    MPW_PERF_PKG="$MPW_PERF_PICK"
    MPW_PERF_PKG_FROM="扫描 $MPW_PERF_DIR/*.mpkg 取最大者"
    echo "[gate] MPW_PERF_PKG = $MPW_PERF_PKG（$MPW_PERF_PKG_FROM：$(wc -c <"$MPW_PERF_PKG" 2>/dev/null || echo '?') B；可用 MPW_PERF_PKG= 显式覆盖）"
  else
    MPW_PERF_PKG_FROM="无候选"
    echo "[gate] SKIP perf 包：$MPW_PERF_DIR 不存在或没有 *.mpkg（也没有显式 MPW_PERF_PKG）⇒ 依赖它的项（perf-profile-smoke）按条件项跳过；这不是通过，是缺数据"
    MPW_PERF_PKG="$MPW_ROOT/.no-perf-pkg-SKIP"
  fi
fi
export MPW_PERF_PKG

FAST=0; JSON=0; LIST=0; ONLY=()
while [ $# -gt 0 ]; do
  case "$1" in
    --fast) FAST=1;;
    --json) JSON=1;;
    --list) LIST=1;;
    --only) shift; while [ $# -gt 0 ] && ! [[ "$1" == --* ]]; do ONLY+=("$1"); shift; done; continue;;
    *) echo "未知参数 $1（用法见文件头）"; exit 2;;
  esac
  shift
done

declare -a NAMES CMDS SLOWPAT SKIPPAT
# add <name> <cmd> [slow] [skip-pattern]
#   slow=slow       → --fast 跳过
#   skip-pattern    → 退出 0 且输出匹配该模式时按 SKIP 计（条件项"无数据不红"）
add() { NAMES+=("$1"); CMDS+=("$2"); SLOWPAT+=("${3:-}"); SKIPPAT+=("${4:-}"); }
#  ③(2026-09-25 门禁隔离) 测试台的**库根**（`:8902` 的运行期状态）是**跨测试项共享**的宿主状态：
#    实测有项会把它切走而后续项因此假红（`bench-ui-headless` / `bench-renderer-source` 单独跑都绿，
#    在套件里连跑就红；现象同"面板一行属性都没有 / 预览 iframe 里那个包不在当前库"）。
#    对策：**每项跑前尽力复位**一次 + 把前后库根写进该项日志 ⇒ 既免疫又**可归因**。
#    服务没起时 curl 两次都快速失败，不阻塞门禁。
bench_lib_root() {
  curl -s --max-time 2 "http://127.0.0.1:${MPW_BENCH_PORT:-8902}/api/library-source" 2>/dev/null \
    | sed -n 's/.*"dir": *"\([^"]*\)".*/\1/p' | head -1
}
bench_lib_reset() {
  curl -s --max-time 2 -X POST "http://127.0.0.1:${MPW_BENCH_PORT:-8902}/api/library-dir" \
    -H 'content-type: application/json' -d '{"reset":true}' >/dev/null 2>&1 || true
}

# —— 语法/静态 ——
add "bundle-syntax"      "node --check core/we-scene-bundle.js"
add "demo-syntax"        "node tests/demo-syntax-check.mjs"
add "demo-check"         "node tests/demo-check.mjs"   # ①E(2026-09-24) 补登记（132 断言：首屏静态外壳 CSS 与补丁 SITE_LAYOUT_CSS 逐条等价 D8 / 品牌钉子 D10 / 显示选项 D11 / 新窗口改写 D12 …）。此前只在文档与手工命令里被引用（`--only demo-check` 会报"未知测试项"exit 2），本表一直没有它 ⇒ 默认门禁不会跑；纯 Node、~5s、无浏览器/网络。
add "web-precheck"       "node tests/web-precheck-test.mjs"   # ③(P-228g) Web 壁纸**挂载前预检**（服务端 /api/web-probe + 补丁侧消费）：纯函数逐值对账 + 接线钉 + 真语料扫描 + 两个变异自证。需要测试台在跑（不在则 B4/B5 如实 SKIP）。
# ①(P-360 2026-10-16 用户口径「把上游渲染器移除，留一个可扩展的接口」) **渲染器适配器契约**：
#   A 契约/注册表（重复 id 与残缺适配器必须拒绝）· B 选择开关（?renderer=/config/env/外部来源/回落要写在话里）·
#   C 生命周期顺序（probe 不过 ⇒ 一次都不 create）· D 反向（全树 renderer-*.js **0 份**；缺产物 ⇒ **明确 SKIP**）·
#   E 端到端（本仓档在真服务上可取 + 首帧握手标记；缺服务 ⇒ 如实 SKIP）· F **5 组变异自证**「期望红集 == 实际红集」·
#   G 真机首帧（有 WebGL2 才跑，否则 SKIP）。纯 Node、~3s（F 段要 import 5 份变异副本）、G 段缺 GL 时不启浏览器。
add "renderer-adapter"   "node tests/renderer-adapter-test.mjs" "" "^SKIP renderer-adapter"
# ①(P-70b 2026-09-15) **把它排到重项之前**：单独跑 4.9s，但排在 `tex-fmt5`(45s)/`package-matrix`(38–52s)
#   之后时会因内存压力（本机 15G、free 0）换页抖动到 >600s 被超时中止 —— 实测 120× 慢、
#   单独复跑永远绿、`--out` 换新目录也绿（所以**不是** P-70 的唯一临时目录导致的）。
#   排到最前面 = 在最干净的内存状态下跑，flake 消失；顺序变化不影响任何判定。
add "visual-diff-kal"    "node tests/visual-diff-kal.mjs"   # P-79：包一层"以成功标记为判定"的包装器 —— 直接跑 visual-diff 时本机约 1/6 次
#   在打印 `✓ --check：与基线一致` 之后**不退出**（进程停在 futex，无子进程；已排除磁盘/内存/线程池/退出钩子），
#   被 timeout 判 rc=124 → 假红。包装器只在**见到显式成功标记**时按成功收尾并打印 ⚠，未见标记一律如实上报子进程 rc。
add "script-origin-sync" "node tests/script-origin-sync-test.mjs"
add "text-script-props"  "node tests/text-script-props-test.mjs"
# ①(2026-09-22) `tex-container-variant`：`.tex` 容器魔数**两种版式** —— 语料 231 张里有 30 张（全在
#   `materials/lut/`，flags=0x42）在 TEXI 头之后多一个 u32 ⇒ TEXB 在偏移 **50** 而不是 46；旧实现按固定
#   偏移读 ⇒ 那 30 张必然抛错（LUT 拿不到贴图）。判据：合成夹具（正常版式插入 4 字节）两版式**同摘要**、
#   语料全量 0 失败、解析决定性、坏魔数仍按原口径报错、以及"改回固定偏移必红"的源码级分辨力。11 断言，~1s。
add "tex-container-variant" "node tests/tex-container-variant-test.mjs"
add "script-owner-live"  "node tests/script-owner-live-test.mjs"  # P-60：脚本宿主 thisLayer/thisObject 错绑回归（首属性捕获"编译那一刻"的 ref.current = 上一个脚本节点的层；真机 3554161528 时钟层 id398 origin 被 id1592 改写 2833,1379；11 断言；~0.5s）
add "script-api-corpus"  "node tests/script-corpus-audit.mjs --strict"
add "media-host"         "node tests/media-host-test.mjs" "" "^SKIP media-host"  # P-62：媒体集成 + 音频响应宿主（官方 5 个 media*Changed 回调 / registerAudioBuffers 同一对象原地更新 / 封面 URL+字节两形态 / 歌词 LRC 解析+二分 / dispatchScriptEvent 多条目广播且 thisLayer 不串层＝P-60 防回归；真包 3554161528+3544152633+3660962877；109 断言；~0.9s）。①(P-87) 真包只从本机语料取（仓库内 samples/wallpapers 已因版权整体移除）⇒ 缺语料时**整体 SKIP**，门禁不红
add "internal-shaders"   "node tests/internal-shader-validate.mjs"
add "glsl-validate"      "node tests/glsl-validate.mjs"
# —— 渲染器语义套件（mock-GL / 纯 JS）——
add "mock-gl"            "node tests/mock-gl-test.mjs"
# ①(MPKG-SWEEP 2026-09-23 §3/§4 两条产品缺陷的常驻门禁 2026-09-23) 纯 Node / mock-GL / 合成夹具，不开浏览器、不加载真包：
#   · video-base-order：`demo.html` 的 `__videoBase`（视频作最底层）块**位置**判据 + 按源码序执行原文
#     （层数 2→3、视频层在最前、几何取自 scene.general）+ mock-GL 首帧绘制序；变异 = 把块搬回 parseScene
#     之前（＝缺陷原状）⇒ 期望 6 条必红（子进程在 /tmp 隔离副本上真改 demo.html）。
#   · solidlayer-fallback：`[TRANSPARENT_FALLBACK] 纯色` 的窄口径缺陷（显式 `models/util/solidlayer*`
#     层 + 无 color ⇒ 白，不是透明兜底）+ 作者占位层仍透明等 4 条对照；变异 2 组（删新分支 / 放宽成
#     所有 solid）⇒ 期望红集各为 {A0,A1} / {B0}。合计 26 断言 + 3 组真变异；~4s
add "video-base-order"   "node tests/demo-videobase-order-test.mjs"
add "solidlayer-fallback" "node tests/solidlayer-fallback-test.mjs"
add "blob-media-retry"   "node tests/blob-media-retry-test.mjs"
# ①(WEBWALLGL #4/#5 P0 2026-09-23) 效果链指针/视差/帧时间 uniform 接线（含 ?ptrfx=legacy 逐位回退）：
#   官方 cursorripple/depthparallax/xray/fluidsimulation 的 7 个输入 uniform 真的被写、值随指针/时间变化、
#   legacy 档逐键回到改动前；3 条变异自证（改回 (0,0) / legacy 也写 / 不推快照 ⇒ 对应断言必红）；41 断言；~2s
add "ptrfx-uniform"      "node tests/ptrfx-uniform-test.mjs"
add "parallax-live"       "node tests/parallax-live-test.mjs --offline"   # 真机档（有头浏览器）由人工单独跑：去掉 --offline
add "official-parallax-formula" "node tests/official-parallax-formula-test.mjs"  # RE-24 官方鼠标视差静态逆向对齐（A3/A4/C1/C2）：官方算式逐条对照（含 influence min(·,1)、桌面平滑闭式、顶层祖先 depth、cameraparallax=false 冻结）+ 4 组反例钉死 + `?parallax=legacy` 与改前构建**逐位**对拍 + 6 组变异自证（期望红集==实际红集，含"#4 机械删项"反证）；23 断言；~4s
# ①(P-338 2026-10-12) 视差链 + xray 族的**指针接线**（用户报「开了指针注入移动鼠标，视差 / x-ray 仍毫无反应」）：
#   改前实测同一场景同一指针：DOM 派发 Δx=−864.0000px、注入通道 Δx=0.0000px（视差链只认 window.mousemove）；
#   xray 族 `g_PointerState.y` 被包内 shader 当 `1/因子` 除 ⇒ 开窗面积随光标高度 6.50%→0.01%（官方桌面版无该因子）。
#   本档钉：注入通道必须给出与官方算式**同值**的位移、`g_ParallaxPosition` 必须跟随、非 xray 族 `.y` 逐位不变、
#   开窗面积数值断言、`?ptrwiring=legacy` 逐位回旧档 + 5 组变异自证（期望红集==实际红集）；27 断言；~6s（含 2 个真包）
add "parallax-xray"      "node tests/parallax-xray-test.mjs"
# ⑦(P-342 2026-10-12 用户 :8902 第 4/6 条) 页面侧（demo/index.html + demo/bench-patch.js）：
#   ④「壁纸标签第 1 位的叉号超出自己的框 / 大框串到第 2 个壁纸里」—— 根因是 `#current` 的 `×` 是**兄弟节点**
#     （flex 条上的独立一项，落在框外且与第 2 格零间距）；修法 = 宿主格预留宽度 + 负外边距挪回框内 +
#     把产物 `.tab{display:flex}` 在宿主态改成 `block`（否则裸文本是匿名 flex item、`text-overflow:ellipsis`
#     不生效，长标题会画到 `×` 底下）。判据含**真浏览器几何夹具**（短/长标题两条路 + 3 个"修前形态"必红）。
#   ⑥「图层开关加恢复默认」= 回到**壁纸文件默认态**（清隐藏集 + 强制显示集 + 删 URL 的 `?hide=` ⇒ 刷新一致）。
#   15 断言（A 结构 / B 行为真切片 / C 真浏览器几何）+ 10 组变异自证（期望红集==实际红集）；~25s（含无头 Firefox）
add "layer-panel-restore" "node tests/layer-panel-restore-test.mjs"
# ⑦(P-342) 同一页的**视差档接线**（用户第 2/3 条的页面侧根因 C）：渲染器 `?parallax=` 缺省**关**
#   （demo.html:8905），而测试台此前从**不写**这个参数 ⇒ 相机视差 + 对象级 `parallaxDepth` 在默认档整体停用。
#   本档钉：结构（工具条「视差」档 4 个既有取值 + 三处接线 + DOM 位置不顶掉 LS1 相邻兄弟）/ 行为
#   （`rendererSourceUrl()` 真切片逐值带参、缺省一个字符都不写、幂等、本仓⇄上游往返）/ **真页面 E2E**
#   （预览 URL 实际取值 + 真点自绘控件四档 + 本页 `?parallax=legacy` 优先 + 浮层选完即关）+ 7 组变异自证；
#   `:8902` 不可达时 E2E 段打印 SKIP（不计通过）；~30s
add "bench-parallax-flag" "node tests/bench-parallax-flag-test.mjs"
add "sprite-sheet"       "node tests/sprite-sheet-test.mjs"
add "particle-sprite"    "node tests/particle-sprite-verify.mjs"
add "text-layout"        "node tests/text-layout-test.mjs"
add "canvas-fit-csz"     "node tests/canvas-fit-and-csz-test.mjs"   # ①-A(P-339) 画布盒比例跟随设计画布 + ⑤-1(P-340) engine.canvasSize 翻正交口径：切片直测真函数 + 真实 buildCamera 几何对拍 + 双档反向读数 + 变异自证（期望红集==实际红集）；18 断言；~1s
add "script-origin-recompose" "node tests/script-origin-recompose-test.mjs"   # ⑤-2(P-341) 脚本 origin 官方语义（局部 origin + 重新父链合成 + 级联）：裁判 = 解析期合成 oracle；改动前 3P/4F（主断言 100px / 级联 100px），改动后 7P/0F；变异自证（父链恒等⇒同值、父 scale=2⇒两口径恰差 (100,50)）；`MPW_BUNDLE=<备份>` 可跨实现跑同一判据；~2s；缺真包时 T6 SKIP
add "clock-coords-all"   "node tests/clock-coords-all-test.mjs"   # ③(P-349) 一个壁纸里**所有**时钟/日期控件的坐标：靶子 = 用户实时包 `窗畔弦歌`（按脚本筛出 63 个时间控件）；P1b 逐个断言 56 个声明型控件 == 作者声明（±0.5px）、V1 可见性级联后同时可见 == 手算 4 个（无级联 13）、V4 `?viscascade=legacy` 行为化回退、5 组变异自证（期望红集==实际红集）；改动前 10P/5F → 15P/0F；~40s（7 趟真包管线）；缺真包 SKIP
add "bloom"              "node tests/bloom-verify.mjs"
add "script-tolerance"   "node tests/script-tolerance-test.mjs"
# ①(2026-09-22 上游 9e287ea) `script-frametime-cap`：**脚本单帧 dt 封顶 0.05s** —— 一次卡顿（切档重挂/
#   GC/后台恢复）会把 frameDt 变成几百毫秒，脚本拿它做平滑/积分时部件"甩出画面再荡回来"。判据顺序是
#   "先证正常帧逐位不变（含首帧 0 原样保留）、再证异常帧被夹住、最后证两个真实喂入点都接上了"，
#   并含分辨力自证（把封顶去掉 ⇒ 必红；真树 sha 不变）。13 断言，~0.05s，无浏览器。
add "script-frametime-cap" "node tests/script-frametime-cap-test.mjs"
add "frame-map"          "node tests/frame-map-verify.mjs"
add "tex-fmt5"           "node tests/tex-fmt5-test.mjs"
add "tex-format5-etc2"    "node tests/tex-format5-etc2-test.mjs"      # format 5 = ETC2+EAC（官方 0x9278 ✓）；修彩色乱点（P-328）
add "video-quality"      "node tests/video-quality-test.mjs"     # P-68：用户第20项 MP4 画质（?res= 档位 720p/1080p/1440p/2160p 默认 1080p、?res=720p|legacy 与改动前逐值对拍、视频上传上限/直传/imageSmoothingQuality=high/可配节流、videoStats 台账、?perf=auto 高分辨率档抑制 fboCap、脚本 __videoPlay 读取点；148 断言；~2.5s）
add "jpeg-decode"        "node tests/jpeg-decode-test.mjs" "" "^SKIP jpeg-decode"  # P-67：自带 baseline JPEG 解码器（FF00 填充丢数据字节=根因 / DRI+RSTn 跳过并复位 DC 预测器 / 4:2:0·4:2:2·4:4:4 / 截断必须抛错不许静默半张图）；3 份真机截图（ffmpeg 对照常量）+ 6 个内嵌合成向量 + 2 张真 FIF=JPEG 贴图；104 断言；~3s；真机截图缺失时 SKIP
add "scene-intro-black"  "node tests/scene-intro-black-test.mjs" "" "^SKIP scene-intro-black"  # P-163：壁纸 3669681034（ATRI 8K）"渲染全黑"回归 —— A 段用真包否证"黑幕层/intro 时间轴"假设（2 对象=1 整屏底图+1 sound、零脚本、零 intro 字段、mock-GL 真顶点流×u_MVP 证明四边形铺满 ±1 NDC）；B 段钉住"大贴图先选 mip 级再解码"与"坏纹理不上屏"（真源码 loadTex 切片 + 真包：交给解码的 blob 33,288,714B→9,107,059B、上传仍 2048×1152、上传报错 ⇒ 返回 null 不登记）；C 段 2 组**真变异**自证；D 段语料同类计数（free-image >2048 共 10 张/5 包、>4096 共 2 张）；29 断言；~4s；缺真包语料时 SKIP
add "alignment"          "node tests/alignment-test.mjs"
# ①(P-91 2026-09-16) 洁净室重写验收：alpha 量纲归一化 + alignment token→偏移 两个 helper 在
#   `docs/WER-REF-LICENSE-AUDIT.md` §3.4 被判「逐行翻译 / 同源改写」，已按行为规格
#   `docs/IMAGE-ALPHA-ALIGN-SPEC.md` 重写（命名/结构/常量表达/返回风格全改，行为逐位不变）。
#   四层断言：冻结真值表（期望值=改前实现实测输出）/ 边界与幂等 / 与改前实现逐位对拍（Object.is）
#   + 源码守卫（旧标识符与 `/= 100` 已消失）/ 6 个真包全部原始输入与 parseScene 接线。
#   **1008 断言**；~2.4s；缺真包语料时整体 SKIP 不红。
add "clean-room-alpha"   "node tests/clean-room-alpha-align-test.mjs" "" "^SKIP clean-room-alpha"
# ①(P-100-R1 2026-09-16) 洁净室重写验收：**R1** = `src/render/effects.js` 节（CPU 效果链：混合模式/HSL/
#   像素颜色效果/位移/waterflow）。改前自述「逐行翻译自 WE shader 原文」（另有 3 处自认 + 12 处上游
#   `文件:行号` 引注；原件是 **WE 专有**资产，与 P-95 的 wer-ref 轴无关），已按行为规格
#   `docs/EFFECTS-COMPUTE-SPEC.md` 重写（命名/控制流/常量表达/注释全改，行为**逐位不变**）。
#   六层断言：冻结真值 digest（5 个函数的改前实测输出，FNV-1a 64 over IEEE-754 位模式）/
#   207 条冻结抽样值 Object.is 逐值对拍（含"调用后入参状态"，锁住原地改写契约）/ 规格性质（同义 id、
#   交换操作数、opacity 无关族、区间界、HSL 往返恒等）/ 契约（返回数组身份、未知 type 跳过、
#   非可迭代输入抛 TypeError）/ 源码守卫（旧名·上游同名回响·引注·自认措辞归零）/ 血缘复测阈值。
#   **312 断言**；实测 ~3.6s（门禁内 ~5.9s，含血缘指标的全量 LCS；缺 WE 资产时该层 SKIP）。
#   语料见 `tests/effects-corpus.mjs`（全自造合成贴图，无真机壁纸数据）。
add "clean-room-effects-blend" "node tests/clean-room-effects-blend-test.mjs" "" "^SKIP clean-room-effects-blend"
add "attach-transform"   "node tests/attach-transform-test.mjs"
#  P-251：「层解剖」工具的冻结值门禁 —— 3 个真包（3463520581 / 3448290956 / 2887099508）的关键字段
#  与冻结值逐位对账；语料缺失时按既有纪律如实 SKIP（第 4 参 = SKIP 行首模式）。
add "layer-anatomy"       "node tests/layer-anatomy-test.mjs" "" "^SKIP layer-anatomy"
add "multi-sprite"       "node tests/multi-sprite-test.mjs"
#  ①(2026-09-25 去重口径) 库重复项改成"移入 `allwallpaper/delete/<原相对路径>` + 写清单"之后的对账门禁：
#   磁盘 ↔ `delete/MANIFEST.json` **双向一致** + 逐对 sha256 与"库内保留的孪生副本"相同 + 6 组变异自证
#   （篡改 sha / 换孪生 / 少登记 / 多登记 / 改大小 / 删 kept 字段）。缺语料时整项 SKIP（语料属本机资产），
#   但夹具段照跑 ⇒ 覆盖率不因"这台机器没语料"变成零。~10-20s（默认含 1.7GB 哈希；`--no-hash` 可秒级快跑）。
add "library-delete-manifest" "node tests/library-delete-manifest-test.mjs" "" "^SKIP library-delete-manifest"
add "audio-semantics"    "node tests/audio-semantics-test.mjs"
add "camera-fillmode"    "node tests/camera-fillmode-test.mjs"
add "camera-node"        "node tests/camera-node-test.mjs"
add "blink-phase"        "node tests/blink-phase-test.mjs"
add "hdr-bloom"          "node tests/hdr-bloom-test.mjs"
add "render-closeout"    "node tests/render-closeout-test.mjs"
add "tex-upload-guard"   "node tests/tex-upload-guard-test.mjs"
add "mesh-badframe"      "node tests/mesh-badframe-test.mjs"      # A 会话新增（W6 帧采样守卫），C 注册
add "sandbox-cors"       "node tests/sandbox-cors-test.mjs"       # B6：:8899 的 CORS/预检（不透明源下渲染器自身 fetch 也变跨源）
# ⓪③(2026-09-27 P-204 安全审计 F7/F8) 渲染器侧**目标闸门**：:8899 的 CORS 白名单（改前无条件 ACAO:* ⇒ 任意网页
#   跨源读回）+ `/pkgurl?u=` 只许回环/白名单（改前只判 ^https?:// ⇒ SSRF 取回器）+ 不跟随重定向 + 默认只绑回环
#   （MPW_BIND 回退口）+ demo.html 的 `?thumbpost=`/`?extbase=` 闸门与"跨源不带凭据" + :8902 上游代理剥凭据头。
#   判据含**改前读数复现**（MPW_CORS=legacy ⇒ ACAO:* / MPW_PKGURL_ANY=1 ⇒ 不再 403）与 3 组源码级变异必红。
#   73 断言；~20s（真起 8899/8902 子进程，全部 127.0.0.1 + 临时目录，无浏览器、不读语料）。规格见 docs/PATCHES.md P-204。
add "sec-route-guard"    "node tests/sec-route-guard-test.mjs"
# ①(P-88 2026-09-15 用户点名「一键连拍上报截图」)：真子进程服务收**原始图片字节**（真 JPEG 向量往返：字节逐字节相同
#   /index.jsonl 台账字段/415·413·400 三条反面用例 + shots 每 id 400 帧滚动与 /report 60 份互不影响）+
#   📸 连拍按钮/j·J 快捷键源码守卫（挂 #bar、__mpwSafeDataURL 读回、原分辨率仅 >1920 缩、进度文案、
#   帧末取样且无 setInterval 调用、无新增 ?flag 开关）+ shotScale·shotDue 纯函数边界；**51 断言**；~0.5s
add "shot-upload"        "node tests/shot-upload-test.mjs"
add "time-variation"     "node tests/time-variation-test.mjs"     # P-55：日月循环（属性转发/getVideoTexture/day 豁免/?time/?hour/mpw-ln-key；~0.6s，TZ 子进程钉死）
add "particle-presets"   "node tests/particle-preset-fallback-test.mjs"  # P-56 Q5：粒子默认开 + 官方预设 basename 兜底（118 条索引同步/25 ref 候选链/真实 bundle 建系+模拟；~1.2s）
add "p74-particles"      "node tests/p74-instanceoverride-test.mjs"  # P-74：instanceoverride 9 字段（size 倍率/count→发射率/rate→仿真时钟/colorn 替换/color 字节色）+ quad 边长=size/2（真顶点流 official:legacy = 2.0000）+ velocityrandom y 与 gravity 同口径（下落层平均 y 位移方向 ±75px/帧）+ 效果链 FBO 尺寸 0×0 哨兵回归（cat 603×389）；60 断言；~7s
add "log-panel"          "node tests/log-panel-collapse-test.mjs"  # P-56 Q8：8899 底部日志区收纳（假 DOM 驱动真实内联脚本；~0.2s）
add "p76-parallax-eye"   "node tests/p76-parallax-eye-test.mjs"  # P-76：①对象级视差位移被 mat4Scale 后乘放大（0.386px→1639.4px ⇒ 真机台账 rd x0=1430 应 −209、每帧【帧N】左缘=页面灰、背景整层被推下屏）+ parallaxOff 不门控对象级项；②?eyehack 在蒙皮路径覆写 layer.scale（0.693→1 ⇒ 眼睛网格 1.4431 倍、右移 260.6px）；追加A ③?bones= 逐骨探针补 det/镜像通道（角度分不出镜像）；追加B ④volume 无落点不接 + zoom 绑定接通（?props=newproperty30=1.6 ⇒ 投影 ×1.6000，默认逐位不变）；P-80 ⑤?bones= 会话累计极值 ext/dty/dang + 眨眼事件 blinks(±5 帧片段)/summary + ?blinkty= 阈值。mock-GL 走真实 renderScene/compositeLayer 六态对拍 + 官方标定 refrender 对账；111 断言；~5s
add "camera-pose"        "node tests/camera-pose-test.mjs"  # P-81：相机层姿态完整接（`camPose` 过去从未交给 `buildCamera` ⇒ origin/zoom 关键帧动画在真实路径从未生效）。三档真值表（full 缺省 / legacy = P-76 行为 / off = 逐位回到 P-76 前，非法值→full）；hina 3554161528 是语料里唯一有相机层动画的包：t=0 人物 w=4215（×3.00 镜头）、t=1 w=3705（×2.64）；legacy/off 逐位相同且复现改动前取景；凯尔希（无相机对象）三档逐位相同；砂狼白子脚本 origin 的快照默认不施加（`?cam=node` 才是那个 A/B，实测 −2434px）；fov 在正交渲染器无落点（逐位回归）。26 断言；~2s
add "scene-zoom"       "node tests/scene-zoom-test.mjs"  # P-226：场景级 `general.zoom` 的对象形态（{value}/{value,animation}）此前被 `typeof === 'number'` 整条忽略（真机 2887099508 的「开场三倍镜 10s → 10–15s 拉远到 1×」从没播过）。口径：数字照旧；对象在 `campose=full`（缺省）下接（有动画逐帧求值、无动画用 .value）；legacy/off 逐位回到改动前。真包实绘矩形比 t=0.5/5 : t=20 = 3.0005、t=12 = 2.2014；变异自证：去掉 full 门控 ⇒ legacy 也被三倍镜带走。15 断言；~40s
add "charfit-camera"    "node tests/charfit-camera-test.mjs"  # P-100：用户真机实测「入场动画把人物固定在屏幕中间、去移动背景」 —— 根因 = ①真机默认路径的**蒙皮层不接相机**（旧 `MESH_VS` 只按设计画布 1:1 映射 ⇒ 相机层 origin/zoom 关键帧带不动 puppet，背景/钢琴/花朵却跟着镜头走）+ ②`?skin0`/无蒙皮路径的「角色层自动适配」把超屏角色 origin 改写成画布中心。修：`MESH_VS` 新增 `u_View/u_Framed`（**以画布中心为缩放基准**，与四边形层 `viewProj` 同式，配准实测 ≤6.4e-4px）+ 适配收窄为「有相机层 ⇒ 不适配，无相机层且超屏才兜底」；回退 `?charfit=auto|off|legacy`（legacy = 逐位回到改动前）。真包 hina 5 时间点矩形 × 三档 + 凯尔希兜底保留 + uniform 级 + 源码守卫；46 断言；~1.5s
add "quality-tiers"      "node tests/quality-tiers-test.mjs"  # P-90：质量档位 `?q`（内部渲染 0.5/0.75/1×，off=关闭离屏路径）+ `?aa`（off/fxaa/msaa2/msaa4；MSAA 不可用或 q!=off 时**回落 FXAA 并记日志**）+ `?pp`（off/low/medium/high，照上游 POST_FBO_CAP；off 门控图层效果链+Bloom），FXAA 片元着色器借自 oneincase/webwallgl（MIT，已署名）。六组断言：真值表（非法/空值/大小写/共存/pp=0 旧义）/ 默认档逐位相同（GL 调用序列与显式默认逐项相等、零额外 FBO·纹理·draw、逐层 rect·mvp 一致）/ 各档确有差异（q=low 内部 1280×720→640×360、pp=off 51→25 draw）/ FXAA 真在链里（帧末 1 次全屏 draw、懒编译、帧内幂等）/ 热更（setQuality 不重挂载、下一帧生效、msaa 档如实报"需刷新"）/ 与 `?res`·`?nofx`·`?perf` 组合不冲突。90 断言；~4s；缺夹具整体 SKIP 不红
add "fullscreen-recenter" "node tests/fullscreen-recenter-test.mjs"  # P-57 N1+N2：近整屏层兜底按 alignment 判据/放锚点（3660962877 真实值；~0.1s）
add "animation-badframe" "node tests/animation-badframe-test.mjs" "" "^SKIP animation-badframe"  # P-57 N3：多 additive 层按动画好帧表+跨坏帧插值（真包 3544152633 复刻合成+蒙皮，位移 ≤50；~0.3s；缺包 SKIP）
add "mdla-walk"          "node tests/mdla-walk-test.mjs" "" "^SKIP mdla-walk"  # P-57 N4：MDLA 记录游走修 id/name + fps 解析（帧数据新旧逐位一致；~0.2s；缺包 SKIP）
add "text-switches"      "node tests/text-switches-test.mjs" "" "^SKIP text-switches"  # P-57 N5：四类文本开关（showclock/showdate/showweekday/showfps 默认口径 + showui 优先 + 时段层豁免 + 真包 6→17 计数）+ embed=1 收起日志（~0.2s）
add "script-tick"        "node tests/script-tick-test.mjs"       # P-57 N7：真实 frametime + 文本/时钟/帧率脚本 ≥30Hz（语料真实 FPS 脚本实测 60Hz→"fps: 60" / 4Hz→"fps: 4"；~3.4s）
add "audio-panel"        "node tests/audio-panel-test.mjs"       # P-57 N6：🔊 音频面板（切真实区块 + 假 DOM/假包：枚举去重/magic MIME/播放暂停/下载/localStorage/__mpwAudio 预留位；~0.1s）
add "audio-real-pkg"     "node tests/audio-panel-real-test.mjs" "" "^SKIP audio-real-pkg"  # P-57 N6：真实包音轨枚举（凯尔希 3719111841 的 4 条 MP3；~1.2s；缺包 SKIP）
add "hdr-predicate"      "node tests/hdr-predicate-test.mjs"    # P-58 H0：自动 HDR 判据真值表（hdr×bloom×?hdr=0/1×会话熔断）+ hina/3778592720 真实 general（~0.3s）
add "meshsize"           "node tests/meshsize-test.mjs"          # P-58 H1：?meshsize 网格 scale/origin 算术（真包 3719111841 + 官方标定 refrender 对账 + crop 位移；~1.5s）
# —— 真实包审计 ——
add "render-audit-kal"   "node tests/render-audit.mjs 3719111841"
add "skin-order-kal"     "node tests/skin-order-verify.mjs 3719111841 主体"
add "layer-rect-kal"     "node tests/layer-rect-check.mjs 3719111841 --refrender" "slow"
# —— 质量门禁 / 矩阵 ——
add "package-matrix"     "node tests/package-matrix.mjs --check" "slow"
add "panel-smoke"        "node \"$MPW_ROOT/dsh-mpkg-wallpaper/tools/panel-smoke.mjs\""
add "props-panel"        "node tests/props-panel-test.mjs" "" "^SKIP props-panel"  # P-61：官方属性面板（真包 hina 3554161528 的 35 条 general.properties 通用渲染：计数+order/condition 门控与"不生效"/绑定生效/combo 脚本属性/持久化/URL ?props= 优先/N5 不打架/装载块真源码切片；106 断言；~0.25s）。①(P-87) 真包只从本机语料取（仓库内 samples/wallpapers 已因版权整体移除）⇒ 缺语料时**整体 SKIP**，门禁不红
add "project-json"       "node tests/project-json-test.mjs"        # P-85：官方 project.json 查找链（core/scene-project-json.mjs）+ 服务端契约：5 档顺序/逐档降级/坏 JSON 不致命（10）+ 6 真包非空与 we-workshop 隔离可达（18）+ 白子 4 个 Clock 变体默认属性下恰 1 个可见（id639）与"秒"可见、缺失全可见对照（6）+ hina 绑定引用完整性（2）+ 优雅降级（2）+ 子进程起服务验 /project 200+x-project-source+404（5）；43 断言；~0.7s
add "perf-profile-smoke" "node tests/perf-profile.mjs --pkg \"$MPW_PERF_PKG\"" "slow"
add "projection-y"       "node tests/projection-y-test.mjs"       # P-69：相机投影 y 轴口径（真值表 世界y0→NDC+1 / fix↔legacy 互镜 / 真包 3554161528 花朵落点 1640.55 vs legacy 519.45 + 钢琴对照 54px）+ 粒子 incr 缓存不变量（首帧与 replay 逐位同、第二帧粒子更新次数 ≥20× 下降）；34 断言；~2s
add "multi-instance"     "node tests/multi-instance-test.mjs"    # P-77 用户第 4 项「一页多实例」：无 ?ids= 时单实例逐位不变（红线）/ ids 解析(非法·去重·顺序) / maxinst 超出不建上下文+占位原因 / 同一时刻仅一个 active 且未选中 0 帧(桩 rAF) / dispose→loseContext+摘除(桩上下文计数回落) / 一帧至多 1 active / 报告 instances 键（单实例无·多实例全）/ 预算降档 / 布局与 instlog + **真接线动态跑**（切 demo.html 的多实例接线块 + 桩 bootInstance）；87 断言；~0.3s（纯 Node：桩 DOM+rAF+boot）
add "canvas-size"        "node tests/canvas-size-test.mjs" "" "^SKIP canvas-size"  # P-78 追加任务 + ①(P-340 契约变更)：engine.canvasSize 口径（**缺省 = 正交/场景尺寸**＝官方 .d.ts "full wallpaper in pixels"；`?csz=render` 逐位回改动前的渲染分辨率；`?csz=ortho` 显式同缺省）。真包 3327063360+真机 userProps 复现：**两种口径都在画布内** ⇒ 证伪"口径导致 12 层不上屏"；T1b 两条都断言 + 源级变异自证（缺省改回 render／拆掉回退 ⇒ 必红，期望红集==实际红集）；12 断言；~0.9s；缺真包 SKIP
add "text-font-fallback" "node tests/text-font-fallback-test.mjs" "" "^SKIP text-font-fallback"  # P-81 用户第 1 项最后缺口：文本字体**三级来源链**（①包内 → ②本机 WE 安装目录 /weassist/fonts/<basename> → ③sans-serif）。纯函数节选 + 桩 fetch/Blob/FontFace：包内有⇒fetch 0 次（绝不走第二级）/ 空格·CJK basename 编码 / 404·reject·空体都不抛异常且落第三级 / missing 去重 + **调用点也认 missing**（否则缺字体的层永不渲染）；真包 3554161528 时钟层 id398（包内无 Monofur）复现 + 千图马克层走第一级；45 断言；~0.2s；缺真包 SKIP
# ①(P-102 2026-09-16 第 10 条·移植项) 帧几何：宿主 iframe 形态下的"窗口坐标 → 帧内 client 像素"与
#   "内容比例 ≠ 舞台比例时的覆盖式视口"。**规格先行**（docs/WEB-FRAME-GEOMETRY-SPEC.md，只写公开契约）
#   → 按规格新写 core/web-frame-geometry.mjs（参照 oneincase/webwallgl MIT 的 renderer/src/web.ts 的
#   **行为契约**，未复制代码；差异清单见规格 §6，台账 docs/COPYING-RULES.md §4 #9）。50 断言；~0.05s
add "web-frame-geometry" "node tests/web-frame-geometry-test.mjs"
# ①(P-103 2026-09-16 第 10 条·移植项) 音频频段契约：128 元数组（左 0..63 + 右 64..127）/ 0..1 钳位 /
#   γ 对比扩展曲线（"频谱要尖"）/ 确定性纯函数模拟源 / bandStats 诊断。规格先行（docs/AUDIO-BAND-SPEC.md）
#   → 按规格新写 core/audio-band-array.mjs（参照 oneincase/webwallgl MIT 的 renderer/src/web.ts 的
#   **行为契约**，未复制代码；差异见规格 §5，台账 docs/COPYING-RULES.md §4 #10）。35 断言；~0.05s
add "audio-band-array"   "node tests/audio-band-array-test.mjs"
add "diag-flags"         "node tests/diag-flag-check.mjs"
# —— C 会话新增：文档一致性 + 平价基线（条件项）——
add "docs-check"         "node tests/docs-check.mjs"
add "parity-check"       "node tests/parity-check.mjs" "slow" "^SKIP parity-check"
# —— ①(P-91/P-92/P-93 分发与可见性线) 分发形态 / 离线 PWA / hlsl2glsl 覆盖率 ——
#   `docs/SIMILAR-PROJECTS-RESEARCH.md` §6.1 第 1、3 条 + §6.3 的 P0/P1 完成判据落地后的回归项。
add "mount"              "node tests/mount-test.mjs"     # P-91：库入口 `mount(container, opts)` 的对外契约（容器/画布口径/帧序=demo.html 逐条一致/生命周期/DI 注入点/健壮性）；40 断言；~0.3s（桩 renderer+rAF，不需要真 GL）
add "pwa"                "node tests/pwa-test.mjs"       # P-92：离线 PWA —— 缓存判据**绝不缓存用户壁纸**（正面 16/反面 21/响应 10 条）+ manifest 与图标尺寸自洽 + sw.js 预缓存清单无用户端点 + 注入开关默认关/幂等/缺 </head> 不吞页面 + 真子进程服务验 6 条静态路由与首页注入是纯增量；107 断言；~1s
add "packaging"          "node tests/packaging-test.mjs" # P-91：可分发形态自证 —— package.json 契约（license 与 LICENSE 一致、exports 每条存在）+ files 白名单（运行所需全覆盖/本机数据全排除）+ `npm pack --dry-run` 体积 + **真打包解包后 grep 个人绝对路径 0 命中** + start-demo.sh 真起服务 200 + check.sh 汇总口径；122 断言；~9s（两次 npm pack）
# ①(P-166.6 2026-09-20) `pack-closure`：**发布面闭合性** —— 0.2.0 出过一次真实事故：`files` 白名单漏了三个
#   新增模块（`core/we-pointer-source.mjs` / `core/we-particle-pointer.mjs` / `server/pkg-entry-index.mjs`）
#   ⇒ 装下来的包一 `import` 就 MODULE_NOT_FOUND（`packaging-test` 查的是反方向："白名单里的路径存在"）。
#   本条**真打 tarball、解开、把入口真的 import 一次**（消费者视角），再静态核对 import/URL 引用与死文件；
#   复现力自证：从包里删掉一条被 import 的模块 ⇒ 真装载必须失败。~15s（一次 npm pack + 两次解包）
add "pack-closure"       "node tests/pack-closure-test.mjs"
# ①(用户 2026-09-20 第 34 条 安全策略) `upload-policy`：导入文件的**白名单 + 内容嗅探**门禁 ——
#   文件名（防穿越）/ 扩展名白名单（脚本·可执行·归档·主动内容一律拒）/ 内容与扩展名**同类**
#   （PE·ELF·`#!`·`<script>` 改名 `.png` 也拒）/ 音频格式适配（`.flac .opus .m4a .aac .oga` 的 magic 与 MIME）/
#   文本类上限 + UTF-8 + 无 NUL / 服务端**真的接线**（含一条真 HTTP 415）/ 变异自证。~2s
add "upload-policy"      "node tests/upload-policy-test.mjs"
# ①(P-168 2026-09-20) `tex-wrap-repeat`：上游 1.3.18 的 **REPEAT 采样契约**（云/神光类贴图的 uv 随 g_Time
#   无界增长 ⇒ 必须平铺，CLAMP 会把天空拉成静止伪影）。判据：名单语义（只有可平铺的那几张）/ 回退开关
#   （`?texwrap=clamp|repeat`）/ 真写进 GL（假 GL 记录 WRAP_S+WRAP_T）/ demo.html 三个创建点都接线 /
#   缺省仍是 CLAMP（无全局行为变化）/ 变异自证（删掉 REPEAT 分支必须红）。~0.4s
add "tex-wrap-repeat"    "node tests/tex-wrap-repeat-test.mjs"
# ①(2026-09-25 用户「把所有没接线的东西都接上」) `host-api-wiring`：宿主 API 的**真送达**判据 ——
#   `updateWebProps`/`setSceneFps`/`pushWheel` 接到实现（不再有"被忽略"的桩）、帧率抽稀的真行为
#   （legacy 恒不跳 / 30fps 跳帧窗口 / 只降不升 / 上限钳制 / 非法值不生效 / 提交帧率记账）、
#   帧循环接线位置（跳帧在 fps 计数前、记账在渲染后）、web 帧盒走唯一换算点且量不到就丢弃、
#   其余降级项必须写清"不支持 + 替代"、变异自证（换回桩 ⇒ A 组必红）。~0.5s
add "host-api-wiring"    "node tests/host-api-wiring-test.mjs"
# ①(2026-09-25 P-203) `prop-push`：**场景帧属性下发通道**（跨源 3080 → 8902 那一跳）—— 渲染器侧认
#   `{type:'mpw-user-props'}` ⇒ 真写用户属性表 + 走面板同一条应用链 + **回执** `mpw-props-applied`；
#   只认父页/自己的来源纪律、空表【零改动但如实回执】、"根本没到"与"到了但空"分得开、`?proppush=legacy`
#   回退口、`window.__mpwPropsApplyHost` 那个"读了却从没人写"的契约点（+ 时段键按数组判）。
#   行为用真源码切片驱动（不靠浏览器）；变异自证 6 组（删回执/删来源纪律/空表提前返回/legacy 失效/
#   删 applyHost 赋值/删数组键时段判定 ⇒ 各自必红）。~0.4s
add "prop-push"          "node tests/prop-push-test.mjs"
# ①(2026-09-25 P-195/P-196) `fx-desc-meta`：include 头里的 material 注解要进 matMeta（否则
#   `g_CompositeAlpha` 停在 0 ⇒ `COMPOSITE==1` 的 pass 成 no-op）+ fbo 描述符的 format/width/height/uvs
#   真落地（`effects/glitter` 真用例）+ 两个回退口 + 真语料证据 + 变异自证（删 includeBodies / 删 R8 分支必红）。~0.6s
add "fx-desc-meta"       "node tests/fx-desc-meta-test.mjs"
# ①(2026-09-25 P-199) `copybg-input`：`copybackground` 层的**效果链输入**契约 —— 有自己纹理的层不许被背景
#   顶掉（官方语义：背景走 COPYBG 独立纹理槽）；`?copybginput=legacy` 回退；语料读数（2887099508 有 64 层
#   copybg）；变异自证（改回"总是换"⇒ B 组必红）。~0.3s
add "copybg-input"       "node tests/copybg-input-test.mjs"
add "hlsl2glsl-coverage" "node tests/hlsl2glsl-coverage-test.mjs" "" "^SKIP hlsl2glsl-coverage"  # P-93：把 `docs/HLSL2GLSL-COVERAGE.md` §0 的 98.2% 变成**会变红的断言**（vendored 上游 MIT 转译器逐文件过语料：0 抛错 + 覆盖率下限 + 每个"可疑"都带原因；本机实测 45/46=97.8%，语料被裁剪时按子集下限并在输出里标明；`MPW_H2G_MIN_RATIO=0.999` 可自证会红）；~3s；无语料/无包解析器时 SKIP，门禁不红

# ——— ①(P-104 2026-09-17 发布纪律①②：**自动上报默认关** + 一切"自动落盘"都要有上限） ———
# 用户原话："像你这种测试用的自动上报的功能，这种你在上传仓库的时候要把它默认给关掉。"
#          "这种自动上报、自动把什么存储到本地的类型的东西，这种需要设置上限的，这上限别忘记了。"
# 38 断言 / 4 段：默认关真值表 + 真源码守卫（两条定时器只在 `if (autoReport)` 里）+ 手动按钮不被连坐
#   + 真服务空跑 3s reports/ 零新增；服务端上限（reports 60 份/64MB、selfcheck 40 份、shots 每 id 400 帧
#   /200MB + 全局 500MB，超限最旧先删 + 清理日志 + 启动清理一次 + 别人的产物不误删）；
#   渲染器 localStorage（键数/单值/总量 + LRU + 日志）；插件 diag-*.json（50 个/32MB + 客户端默认关）。
# ~6s（起 4 个真服务子进程；上限用 env 压到很小才能秒级验完清理路径）。上限唯一来源：docs/DATA-LIMITS.md
add "data-limits"        "node tests/data-limits-test.mjs"

# ——— ①(P-103 2026-09-17 粒子渲染正确性 · 用户第 12 条："你有一些粒子效果的渲染是有问题的，开源仓库里有方案"）———
# 注册位置：**追加在 `add` 列表末尾**（既有 74 项的 `add` 行号一字未动，只在其后顺延 2 行；
#   仓内 `run-all-tests.sh:91`/`:98-99` 两处历史引用都在本行之前，不受影响）。
# 33 断言 / 5 组：四档 official↔legacy **双向**（quad 图层变换 / 粒子自转 / exponent 非线性分布 /
#   发射器 speedmin-speedmax 初速）+ 真包语料（凯尔希 3719111841 Glass Shards·Bokeh Hex·尘埃、
#   hina 3554161528 落花、orb 3660962877 cherry blossoms）+ 仿真代价不回归（两档 simSteps/simUpdates 相等）。
#   真包缺失时内部 SKIP-视作-PASS（不红），与其余真包类条件项同口径。~30s。
add "particle-render-correctness" "node tests/particle-render-correctness-test.mjs"
add "camera-persp"       "node tests/camera-persp-test.mjs"       # P-107：**透视相机（fov）**落地 + `?projmode=persp|ortho|auto` 回退（UNTOUCHED-AREAS J 项"无样本"结案）。语料唯一非正交包 3509243656（3D 场景，`orthogonalprojection=null`，相机 origin "0 0 6"、fov 是"视场"滑块 newproperty71∈[40,65]）：auto ⇒ 节点锚定透视（fov50/相机 z=6）；透视律实测（Custom BG z=−50 与 Sun png z=−30 屏宽比 3.1072 = 预测值）；近层/远层同世界偏移屏距比 62.2×；fov 40→65 屏宽 ×1.519；面板滑块真的驱动 fov；**正交路径逐位不变**（冻结实现对拍 3 真包 × 3 档 + 合成包 5 档，全 `===`）；正交包强制透视时 z=0 平面 maxΔ=1.74e-4px（Float32 舍入）；mock-GL 真实 renderScene 里 mvp 的 w 行 = [0,0,−1,距离] 且三层 z 屏宽 6:3:2。57 断言；~6s

# ——— ①(P-109 2026-09-17 任务书 P1-4 · UNTOUCHED-AREAS D 项）———
# 注册位置：**追加在 `add` 列表末尾**（既有 add 行一字未动，只在其后顺延 1 行）。
# 56 断言 / 5 组：默认关逐位不变（把源码**反向变异成"去掉探针的旧写法"**再跑同一帧 ⇒ GL 调用序列逐条
#   相同）+ 分组正确性（探针台账 vs 独立复算：主影响骨/bbox/质心/影响骨表/父链；含"blendIndices[0]
#   分组会得到 13 组 ≠ 29 组"的区分力对照）+ 筛选语义（单骨/闭区间/`*` 后代/all 四种规格的**实绘索引集**
#   与独立期望逐位一致；三档 `?subtri=` 条数一致；空集筛选 0 次 draw）+ 台账字段与真动画判别力
#   （hina 三条 additive 层：位移时程/三角形变号计数非平凡）。真包缺失时内部 SKIP-视作-PASS。~40s。
add "submesh-probe"      "node tests/submesh-probe-test.mjs"

# ——— ①(P-109-BASELINE 2026-09-17 §5-⑨ 真机基线快照：FPS / 分位 / 启动 / 切换 / 显存代理）———
# 注册位置：**追加在 `add` 列表末尾**（既有 add 行号一字未动；仓内 `run-all-tests.sh:91`/`:98-99`/`:170`
#   三处历史引用都在本行之前，不受影响）。编号带 `-BASELINE` 后缀：并行会话的 P-109 已用在
#   `?submesh=` 子网格探针上（`docs/PATCHES.md` 的编号健康检查只要求"唯一 + 非降"，后缀与
#   `P-75b`/`P-100-R1` 是同一套写法 ⇒ 两节谁先写进 PATCHES 都不会让 docs-check 红）。
# 覆盖：分位/滚动窗口径逐值钉死 + 快照字段齐全与校验 + GL 代理计数（假 gl）+ 开关解析/三阶段切换/合并
#   + `tools/baseline-diff.mjs` 的阈值与环境变量覆盖与退出码 0/1/2 + 真子进程服务 `POST /baseline`
#   落盘与 400/405/上限滚动 + **默认关时零行为变化**（把 demo.html 的采集块真源码切出来，用桩 DOM/桩 gl
#   跑：不开参数 ⇒ 不包装 GL / 零日志 / 零请求；开了 ⇒ 真跑到点并把快照 POST 出去）。
#   ~2s（含一次真服务子进程）。**本机没有 GPU/WebGL2 ⇒ 本项只验工具链，不产出任何真机数字**。
add "baseline"           "node tests/baseline-test.mjs"

# ——— ①(2026-09-17 参考资料隔离护栏，依律师意见）———
# 断言对象：工作区根的 6 个第三方参考副本（归一后唯一内容落点 = `../references/**`）与取证归档
#   `../Delete/**`（如 `Delete/we-official-shaders/`）。律师要的不是"我们说过没引用"，而是
#   **可机器复核的"从未被引用 / 未进构建"**；本项把它变成 44 条断言（每条都带判别力自检）：
#   ① ref-import-free      全仓源码/测试/脚本中 import/require/readFile/fetch 的**实参位置**
#                          指向参考副本或归档目录 = **0 处**（注释/文档引注 **允许**，那是行为对照的写法）；
#   ② pack-and-site-clean  `npm pack --dry-run` 清单（144 个文件）与真跑 `build-pages.mjs --out <tmp>`
#                          的站点产物（189 个文件）中 = **0 个**来自上述目录；
#   ③ ignore-and-whitelist `.gitignore` 显式覆盖 `references/`、`Delete/` 与 6 个旧路径名，
#                          且 `package.json` 的 `files` 白名单一旦收录它们 → 立即变红；
#   ④ legacy-path-shim     工作区根的同名旧路径**只允许是符号链接**（解析到 `references/**`）——
#                          换回真实目录（内容回流）立即变红。旧路径必须保留可解析：历史取证命令
#                          `git -C …/wer-ref remote -v` 与 `docs-check` 的引用存在性校验都按旧路径走。
# 注册位置：**追加在 `add` 列表末尾**。~3s（含一次 npm pack 与一次站点构建，产物写 os.tmpdir()）。
# 详细口径与"若权利人联系"的处置指向：`docs/REFERENCE-ISOLATION.md`（工作区根 `docs/`）。
add "reference-isolation" "node tests/reference-isolation-check.mjs"

# ——— ①(P-110 2026-09-17 bind 世界链乘法顺序修正：UNTOUCHED-AREAS A 项"眉毛翻转"数值根因）———
# 注册位置：**追加在 `add` 列表末尾**（既有 add 行一字未动）。覆盖：TN1 链序恒等式（组成律 + 数据，
#   5 个蒙皮包逐骨）+ TN2 静止帧逐位不变（gBones=I 且蒙皮后顶点=原始顶点；改前/改后逐顶点对拍）
#   + TN3 `gBones` 组装顺序判据（`bindInv × m` 保枢轴距 / `m × bindInv` 不保；含 elysia 反例）
#   + TN4 全语料回归（hina/girl/凯尔希/0917×2 + 伊蕾娜无 puppet 对照：几何 bbox、层矩形、`?bones=`
#   台账、`?submesh=` 分组位移与翻转计数，改前 legacy vs 改后 default 逐包表）+ TN5 `?bindorder=legacy`
#   回退语义 + TN6 反向变异（把默认序改回父先乘 ⇒ 本测试必红）。mock-GL 驱动真 `renderMeshLayer`。~2s。
add "bind-order"         "node tests/bind-order-test.mjs"

# ——— ①(P-112-BANDGEOM 2026-09-17 任务书 §5 第 4 条 / P1-5：两个"写完但没接线"的模块接线验收）———
# 注册位置：**追加在 `add` 列表末尾**（既有 add 行一字未动，只在其后顺延 2 行）。
# 模块契约另有既有两项（`web-frame-geometry` 50 断言 / `audio-band-array` 35 断言）；这两项只验**接线**：
#   切 `demo.html` 的 MPW-BANDFEED / MPW-AUDIOBUFFERS / MPW-FRAMEGEOM 三个真源码块 + 内核的真导出，
#   注入桩（假 analyser / 假 video 元素 / 假 window.parent）跑真实分支；不碰 DOM/GPU/网络，~0.2s。
#   口径：`?bandfeed=`（128 元数组 → 场景层 `registerAudioBuffers` + 宿主消息）、
#   `?framegeom=`（帧盒三态 + 指针口径的祖先 transform 补偿）；**两项都缺省关**，且
#   "关 = 逐位不变"与"开 = 真的到达消费点"各自有独立断言（含 NaN 透传、零 postMessage 等边界）。
#   每项自带 **RED-IF-REVERTED**：把真源码切片改回旧行为 ⇒ 对应结论必须变红（绿色运行也打印 RED 行）。
#   接线说明/开关/实测数字/未定清单：`docs/AUDIO-BAND-WIRING.md`。
add "audio-band-wiring"  "node tests/audio-band-wiring-test.mjs"
# ①(P-132 批D 2026-09-19 主对话补登记) **音频驱动发射 + AudioBuffers 活视图**：语料 16 段字段直方图 vs
#   `parseAudioResponse` 解析、`registerAudioBuffers(n)` 长期持有的活视图（同一引用 / 内容逐帧变化 /
#   `average` 逐段 =(L+R)/2）、`?audioemit=` 档位表、以及"改回每次新建数组必红"的反向变异。
#   该文件由音频线交付时**未**登记（它按纪律不碰本脚本），主对话在此补上；~1.5s，无浏览器/无网络。
add "audio-emit-live"    "node tests/audio-emit-live-test.mjs"
# ①(2026-09-21 音频美术层 + 逐层基线) `scene-layer-baseline`：两件事一起钉 ——
#   ①**逐层基线夹具** `tests/fixtures/scene-layer-baseline.json`：`3544152633`（用户点名的音频条包）、
#     `3326873240`（`Audio Bars`，实体遮罩层）、`3719111841`（`音频线…Spectrum Visualizer`）与仓库自带
#     样例的**逐层事实**（总层/可见层/带纹理的可见层/蒙皮命中/每帧 draw 数/音频美术层/外壳可见数）逐项相等；
#     读数来自 `tests/render-audit.mjs` 的机读契约 `MPW-AUDIT-JSON`（不复制第二份 mock-GL harness）；
#     B 段证明读数确定性（两次独立运行逐字段相同）；语料不在本机时**明确 SKIP**（不假装通过）。
#   ②**音频美术层可见性契约**：`Audio bar(s)` / `…Spectrum Visualizer` 曾被**自家**两条隐藏启发式吞掉
#     （hideUI 名字正则含 `Audio|Spectrum|音量`；hideBars 关掉"父组纯色遮罩条"，而可视化条自己就是
#     `models/util/solidlayer.json`）⇒ 现在按"名字 + 特效/粒子/作者绑定"豁免；C 段纯函数正反例 + 真包上
#     "美术层 vis=1 而外壳（Song Title/.mp3/MUSIC PLAYER）仍 vis=0"；D 段分辨力自证（`hideAudioArt:true`
#     ⇒ 美术层重新隐藏；夹具改一个数字 ⇒ 比较器报红）。~3s，无浏览器。
add "scene-layer-baseline" "node tests/scene-layer-baseline-test.mjs"
add "frame-geometry-wiring" "node tests/web-frame-geometry-wiring-test.mjs"

# ——— ①(§5-⑧ 2026-09-17 回归自动化：真机验证里"能自动化的部分"全自动化）———
# 注册位置：**追加在 `add` 列表末尾**（既有 add 行一字未动，只在其后顺延 2 行；计数/汇总逻辑未动）。
# 为什么要有这一项：在这之前**门禁里没有任何一项真的用浏览器加载过 8899 的页面** ——
#   实证：P-110 给 `core/we-scene-bundle.js:6` 加了 `import './puppet-skin.js'`，产物根映射
#   （build-pages.mjs:60）与 PWA 预缓存（web/sw.js:24）都登记了，**唯独 8899 缺路由** ⇒ 浏览器把 404
#   当"模块 MIME 非法"拒绝加载，整页停在 `loading…`、`__mpwModuleStarted` 永远 false，
#   而当时 80 项门禁**全绿**。本项就是那条缺掉的"真的打开一次页面"的断言（53 断言 / ~15s）。
#   ⚠ 任务书里的 `http://127.0.0.1:8899/demo.html` 实测 404（server:366-371 只登记 `/` 与 `/index.html`，
#   两者都读 demo.html 字节流）⇒ 本项打 `/`；无浏览器/无服务时按条件项 SKIP（jpeg-decode 同口径）。
add "real-machine-check" "node tests/real-machine-check.mjs" "" "^SKIP real-machine-check"
# ①(§5-⑨ 真机基线快照 · 趋势视图) `reports/baselines/*.json` + `reports/real-machine/*.json` ⇒
#   按 (kind,id) 分组打趋势表（启动/首帧/FPS/切换/VRAM 代理），相邻两份的判定直接调
#   `tools/baseline-diff.mjs` 的 `compareSnapshots()`（**阈值不复制**）。两份来源都没有 ⇒ SKIP。
#   默认只告警不红（历史退化不该把门禁钉死）；要硬闸门用 `--strict`。~0.2s。
add "baseline-trend"     "node tests/baseline-trend.mjs" "" "^SKIP baseline-trend"

# ——— ①(P-113 2026-09-17 壁纸显示选项 · 能力对齐线：水平翻转 / 播放速度 0.5–2× / 颜色选项四项）———
# 注册位置：**追加在 `add` 列表末尾**（既有 add 行一字未动，只在其后顺延 2 行）。
# 契约与口径：`docs/DISPLAY-OPTIONS.md`（机制 = CSS filter/transform 写在**拥有渲染输出的元素**上，
#   与 `?fx=` 同一套机制；纯逻辑在 `core/we-scene-bundle.js` 的「显示选项」节，接线在 demo.html 的
#   `MPW-DISPLAY` 块）。71 断言 / 12 组：
#   ① 纯函数真值表（倍率 / 四项钳位 / filter 串逐字 / 与既有 filter 串的合成与还原）；
#   ② **缺省零行为变化**（参数全缺省 ⇒ 画布 style 一个字符不写、时钟与 frametime 逐位不变）；
#   ③ flipH 下的 client→帧内换算（legacy 与 `?framegeom=cover` 两档都镜像**恰好一次**，并端到端
#      映射到设计坐标；注入通道 `__mpwPointer` 是设计坐标 ⇒ 不镜像）；
#   ④ 播放速度：16 帧同一批时间戳 ⇒ rate=2 的推进 `===` 2×rate=1，且**被求值的动画值**
#      （`evalPropAnimation`）等于时间翻倍处的独立求值；video.playbackRate 双向同步；
#   ⑤ `__wp.setDisplay/setPlaybackRate/displayState` 幂等 / 钳位 / `?display=legacy` 连 API 只读；
#   ⑥ 持久化（`mpw-display` 单键 + 512B 上限 + URL 逐键覆盖）；⑦ RED-IF-REVERTED 三条（指针镜像 /
#      时钟倍率 / 颜色串：把真源码改回旧写法 ⇒ 对应断言必须变红）。~0.3s，纯 Node（不依赖 DOM/GPU）。
add "display-options"    "node tests/display-options-test.mjs"

# ——— ①(P-114 2026-09-18 任务书 P0-5：hlsl2glsl「只 vendored 未接线」的**诚实收口**）———
# 注册位置：**追加在 `add` 列表末尾**（既有 add 行一字未动，只在其后顺延 2 行）。
# 结论（证据见 docs/PATCHES.md P-114）：**不接 vendored**，门禁改为守**在跑的那份**（自研，`core/we-scene-bundle.js:4106`）。
#   取证：真渲染路径口径（11 包 128 个 effect-chain 作业、真 combos）自研 **128/128** 真编译通过、
#   vendored **120/128**（8 个作业 vendored 编不过而自研全过，反方向 0 个）。根因：我们的 `common*.h`
#   自研头表要求"uniform 声明提前"（`:4358`）等自有修复，vendored 那份是按上游 headers.ts 写的。
# 两项回归：
#   · `hlsl2glsl-coverage` 已改测**在跑的实现** + 新增"接线身份"断言（bundle 0 处引用 vendor / 调用点在位 /
#     被测实现 ≡ bundle 导出）+ A/B 对照断言（vendored 不存在"自研编不过而它编得过"的文件）；
#   · `hlsl2glsl-wiring`（本行）**仪器化真渲染路径**：mock-GL 捕获 `gl.shaderSource()` 收到的 GLSL，
#     与两份实现逐字节对拍（探针给出渲染器真实 combos），并带 RED-IF-REVERTED（把真源码变异成"接 vendored"
#     ⇒ 判定必须翻转）。13 断言；~0.6s；缺语料/缺 glslangValidator 时内部 SKIP 视作 PASS，不红。
add "hlsl2glsl-wiring"   "node tests/hlsl2glsl-wiring-test.mjs"

# ①(P-117 2026-09-18) `submesh-mirror`：把"眉毛整组翻转 180°"变成**组级方向判据**（bind→蒙皮最小二乘仿射的
#   2×2 行列式 det<0 = 该组被镜像），并把 `?submesh=` 台账里"三角形有向面积变号"的**基线**从"探针看到的
#   第一个采样帧"改成"bind 姿态"（旧口径在会话起点落在翻转窗口内时会**整个漏报**：实测 `?bindorder=legacy`
#   下只取 f8..f11 四帧，b17 明明 8/8 全翻，旧口径报 0/8）。38 断言；~0.9s；全部读数走 mock-GL 真渲染路径 +
#   真包真动画。自带 RED-IF-REVERTED（legacy 链序 ⇒ 判据必须变红）与判据灵敏度反证（合成镜像必须被抓到）；
#   缺语料时真包段 SKIP 视作 PASS，不红。回退开关 `?subbase=legacy`（只改台账口径，GL 调用逐条不变）。
add "submesh-mirror"     "node tests/submesh-mirror-test.mjs"

# ①(P-118 2026-09-18 §7-H)《指针离开画布后不再发射》回归：假 DOM（真 addEventListener 记录）+ mock-GL +
#   真 createRenderer + 真包（3554161528 id389）⇒ 45 断言 + 2 条**仍存缺口**（pointerout / blur·visibilitychange）
#   以 XFAIL 记账。同时修掉的根因：`__hookPointer()` 只在"已有指针"时才装 ⇒ 出货页面里 lockToPointer 发射器
#   **一次都不发射**（自举死锁）。带 4 条内置变异自证（改回旧写法必红）；~1.5s；无浏览器、无 GPU。
add "pointer-leave"      "node tests/pointer-leave-test.mjs"
# ①(P1-1 2026-09-18) 相机 `origin.script` **离线取证**（只读渲染器、不接渲染路径）：扫全语料（98 个包容器 +
#   171 个散装 scene.json）列出每个带 origin.script 的相机对象，用 `elysia/scene-scripts.js` 求值出"应有的
#   origin"，与渲染器今天读到的静态快照对拍。实测 **14 个包命中**（同一段 781 字符脚本）。语料里一个都没有 ⇒
#   SKIP。~1.3s、RSS ~110MB、只读表头 64KB（不整包读入）。
add "camera-script-origin" "node tests/camera-script-origin-probe.mjs" "" "^SKIP camera-script-origin"
# ①(P-120 2026-09-18 任务书 P1-1) 相机 `origin.script` **接线**：那 14 个包的相机取景不再用静态快照
#   （静态 `2434.38 725.25 500` vs 脚本求值 `0 0 500`，Δx −2434.38），改为**每帧按输入签名**（脚本源 /
#   scriptproperties 解析值 / userProps 指纹 / canvasSize / origin 原文）决定是否重算，走**既有脚本宿主**
#   `elysia/scene-scripts.js`；失败回退冻结静态快照且不外抛。78 断言 / 1.6s / 峰值 ~300MB。
#   判据含：14 包求值==独立参考求值≠静态；无脚本包**逐位不变**；userProps/canvasSize 变 ⇒ 取景跟着变；
#   坏脚本/坏宿主不抛。带红-if-reverted（把接线分支置 false ⇒ a 组 42/42 红）。
add "camera-origin-script" "node tests/camera-origin-script-test.mjs" "" "^SKIP camera-origin-script"
# ①(敏感信息加固 2026-09-18) `secret-scan`：**tracked 全量**跑两组判据 ——
#   A 段 12 条密钥模式（npm/gh/sk/AKIA/私钥/xox/AIza/JWT/Bearer/赋值式窄档+宽档；命中只打前 6 字符）；
#   B 段 本机绝对路径（host-workspace-path / device-shared-storage / termux-private-dir）。
#   带**白名单腐烂检测**（被豁免的命中若消失 ⇒ 判红，防白名单变遮羞布）；退出码 0/1/2。~0.5s，无网络无浏览器。
add "secret-scan"        "node tests/secret-scan-test.mjs"
# ①(2026-09-21 跨平台门禁) `cross-platform`：**静态**判"有没有写成 Linux 独占"（换平台才炸的那一类）——
#   A/B 代码里的本机绝对路径必须当场可覆盖（env/家目录/tmpdir）、写死的 `'/tmp/…'` 判红（白名单 6 条，逐条带理由 +
#   **防腐烂反查**）；C "找打开器"的文件必须同时有 Linux(`xdg-open`)/macOS(`open`)/Windows(`explorer`) 三条分支 + 覆盖口；
#   D `.sh` 不许用 bash 4+ 独有特性（macOS 自带 3.2）且 shebang 与语法匹配；E 文件名（大小写冲突/Windows 非法字符/
#   保留设备名/结尾空格点/超长路径）；F 文本卫生（BOM/CRLF）。G 段 11 条分辨力自证（合成样本逐类必须报红 + 干净样本零发现）。
#   本轮由它揪出并修掉 20 处真问题（`server/we-scene-demo-server.mjs` 11 处 `/tmp` 字面量、tests 里 13 处、
#   `:8902` 打开器缺 Windows 分支）。~0.3s，无网络无浏览器。
add "cross-platform"     "node tests/cross-platform-gate-test.mjs"
add "gate-audio-mute"    "node tests/gate-audio-mute-test.mjs"   # ①(2026-09-29 用户报"幽灵声音") 所有 firefox.launch 必须带静音 prefs（_audio-mute.mjs）：无头门禁跑测试台/渲染器页时真的会出声（Volume Control 里可见 Nightly: WEwebLoader / we-scene 验证 / 壁纸名，最多 5 路）
# ①(P2-2 2026-09-18) `bench-8902`：一站式测试台服务（`server/we-scene-demo-server-8902.mjs`）的端到端自证 ——
#   临时端口 + 夹具库真起服务：8 个 `/api/*` 的状态码与 JSON 形状、静态面 no-store、`/media/dev/**` Range 206、
#   **路径逃逸**（`..`/绝对/符号链接）400/403、删除**默认 dryRun 不移文件**、`?confirm=1` 才进可回滚 trash、
#   属性覆盖只落 `reports/`。63 断言 + 2 组变异自证。~2s，无浏览器。
add "bench-8902"         "node tests/bench-server-test.mjs"
# ①(P-146 2026-09-19 主对话) `bench-ui-headless`：测试台 UI 的**无 X11**浏览器判定 —— 资源管理器收纳键
#   （收起/复原/`#main` 真变宽/刷新保持）、声音控件（78→189→78 开关）、遮挡几何（两态 `unreachableCount=0`、
#   `scrollKnown=true`、展开 cover ≥ 收起）、工具条自绘下拉（恰好 1 个列表 + `data-flip` + 再点即关）、整轮 0 pageerror。
#   92 断言（N/S/F/T/W/M/X/Y/Z 各组），headless firefox（**不需要 X 显示**，本机 ~2min）。无 :8902 / 无 Playwright / 无 firefox ⇒ 自我 SKIP。
#   与 `tests/x11-e2e/bench-click-test.mjs` 的分工：那条是**真 X11 指针**门禁（证明"用户点得到"，需 X、5–8 分钟、不常驻）；
#   这条只做功能判定，可常驻。为什么要有它：宿主机重启会带走 X 显示（2026-09-19 实测），没有它 P-142 的判定就无从复跑。
add "bench-ui-headless"  "node tests/bench-ui-headless-test.mjs" "" "^SKIP bench-ui-headless"
# ①(2026-09-21) `bench-renderer-source`：「预览用哪个渲染器」两档（上游产物 / 本仓渲染器）——
#   A 纯函数（档位归一 / URL 改写**完整保留原有 query** / DPR 上限只在显式改过时生效 / src 包装层幂等）、
#   B core 的画布活档位 `?res=dpr|dpr1..dpr5`（显示尺寸 × DPR + 上限，既有档位语义一位不动）、
#   C HTML/补丁/服务端静态纪律（含"`/diag`、`/media|web/dev`、`/api` **不许**进反代名单"）、
#   D **真机读数**（**有头优先 + 无 GL 时 SKIP**）：同一块面板同一张包下，上游画布 = CSS×1、本仓 = CSS×设备DPR。
#     默认起**有头** Firefox（`DISPLAY=:0`，`MPW_X11_DISPLAY` 可换；本机唯一能出 WebGL2 的组合，无头连 WebGL1
#     都建不了），起不来才回落无头；拿不到 WebGL2（能力前置探针**真去问一次浏览器**）⇒ D3–D5 打 SKIP 并打印
#     原样读数（不谎报成红、也不静默通过）；`MPW_BENCH_HEADLESS=1` 强制无头。
#   无 :8902 / 无 Playwright / 无 firefox ⇒ **只有 D 段 SKIP**（A/B/C 段照跑，门禁不红）。
add "bench-renderer-source" "node tests/bench-renderer-source-test.mjs" "" "^SKIP bench-renderer-source"
add "bench-upstream-handoff" "node tests/bench-upstream-handoff-test.mjs" "" "^SKIP bench-upstream-handoff"   # P-228c：8902「上游产物」档的包交接（mediaBase+src）。纯函数段（往返改写：恰好一次/缺则补/不变式/非 scene 不加）+ 变异自证（删守卫必红）+ 真机段（页面改写链 + 直挂后 200 取到 scene.pkg/project.json、iframe 出画布）；缺 GL/测试台 ⇒ SKIP 不假红。11/0。
# ①(2026-09-21) `scene-texanim`：官方 `ITextureAnimation` 面（真机语料 3544152633 逐字用到
#   `getTextureAnimation().rate / getFrame() / frameCount`）——旧实现缺 `rate/frameCount/duration/
#   isPlaying/join` ⇒ **静默错分支**（`getFrame()==frameCount-1` 恒假、`rate=9` 没人读）。
#   19 断言：真源码面 / 元数据回填与 rate 前推的接线钉子 / 精灵帧 UV 回绕。纯 Node，~0.2s。
add "scene-texanim"      "node tests/scene-texanim-api-test.mjs"
# ①(P-158 2026-09-19) `bench-shell-fixes`：测试台外壳**一批 UI/交互修复**的无浏览器门禁 ——
#   下拉贴合（含上翻）/包含块偏移、一个 select 一个自绘控件（工具条 0 个 `.mpw_select`）、
#   `.bench-rd-native` 视觉隐藏、已选/常用计划、库来源四态、诊断流一行模型、类型标签归一、
#   库目录对话框降级、指针"离开不再归中"（P-159）、品牌图标（P-164）、标签关闭/幂等/移动即转发/调试模式（P-164）。
#   183 断言（A 纯函数 / B 两文件静态纪律 / H 图标 / I 标签+调试 / C **13 组**变异自证），~0.3s。
add "bench-shell-fixes"   "node tests/bench-shell-fixes-test.mjs"
# ①(2026-09-19「结合 X11 自己做简单测试」) `x11-pointer`：**真 X11 指针链路对拍** —— xdotool 用真 X 事件
#   把指针移进/移出/移到画布另一端，页面里自己的监听记录 clientX/Y，断言：事件真到达、**鼠标下移 ⇒ cy 增大**
#   （垂直反了必红）、移远仍到达、移出窗口有 leave/out。7 断言 + 5 张截图（落 `$MPW_ROOT/reports/x11-shots/`）。
#   **无 X 显示/无 scrot/无 8899 时自我 SKIP**（`^SKIP pointer-live`）⇒ 无头机器上不红、不拖慢门禁。
#   为什么进门禁：`page.mouse.*` 是合成事件，绕过 X 服务器；这条链（X → 浏览器 → 画布）此前**没有任何自动化**。
#   说明与"必须人眼看"的边界：`tests/x11-e2e/README.md`。~1.5min，需要 headed firefox（本机软件 WebGL ~1fps）。
add "x11-pointer"        "node tests/x11-e2e/pointer-live-test.mjs" "" "^SKIP pointer-live"
# ①(P-133 2026-09-19 主对话补登记) `particle-frame-uv-and-pointer`：**精灵帧 UV 尺寸**（13 帧图集被压成
#   4.2px 竖条 = 落花"一条空开一条"/雾 2 整张图集挤进一颗）+ **粒子 CPU NDC 的 y 跟随 P-69 投影修正**
#   （鼠标尾迹"上下相反"）+ `mapsequencearoundcontrolpoint` / `vortex` / `FadeValueChange(size|alpha)`。
#   36 断言 + 5 组变异自证；~0.5s，无浏览器/无网络（交付出处见 `docs/PATCHES.md` P-133）。
add "particle-frame-uv-and-pointer" "node tests/particle-frame-uv-and-pointer-test.mjs"
# ①(P-134 2026-09-19 主对话补登记) `effects-degenerate-fbo`：**无纹理层（纯色/文本）的效果链 FBO 恒 1×1**
#   ⇒ `degenerateFbo` 短路 ⇒ 效果链从不执行 ⇒ 用户第 ⑥ 项"视频壁纸左侧 1/4 颜色反相"（`colorBlendMode:23`
#   的 Phoenix ≈ 反相，整块铺上去）。同时钉住两件同批事：效果频谱 uniform（`g_AudioSpectrum*`）有源才写、
#   无源一个都不写（`?bandfeed=off` 逐位不变），以及同一材质 vert/frag 的 `[COMBO]` 默认值**取并集**。
#   36 断言 + 3 组变异自证；~2.7s，无浏览器/无网络（真包缺失 SKIP+exit 0）。
add "effects-degenerate-fbo" "node tests/effects-degenerate-fbo-test.mjs"
# ①(P-205 2026-09-25 缺口 1/2 补登记) 两条（离线真包判据，无浏览器；需要 `$MPW_ROOT/allwallpaper` 语料）：
#   `effect-json-fallback` —— `effects/**/effect.json` 的 `/weassist` 候选链（包内 → `/weassist/<rel>`
#     → 官方效果自带子树 `<效果目录>/materials|shaders/effects/…`）：45 包 / 427 个层-效果实例此前**静默丢弃**。
#     26 断言 + 3 组变异自证；含"7 个含包内效果的真包 × 732 实例的链摘要与改动前逐位相同"的冻结回归；~40s。
#   `model-key` —— 层级 `model` 键（老式模型层）：3 包 / 105 层此前整层消失、且被 `solid` 口径吞成"纯色层"。
#     16 断言 + 3 组变异自证；含"真·纯色层数两档相同、model 层单列"的口径分离读数、以及"新台账与
#     package-baseline.json 的独立读数逐位相同"；~30s（读 3 个大包的 MDL 头）。
add "effect-json-fallback" "node tests/effect-json-fallback-test.mjs"
add "model-key"           "node tests/model-key-fallback-test.mjs"
# ①(P-206 2026-09-28 补登记) `weassist-prefetch`：P-205 的**宿主侧接线**（`demo.html` 的效果资产预取 +
#   同步 `setWeAssetReader` 注册 + `?weassist=legacy` 回退）：3 个 PKGM0014 真包挂上的效果实例 0 → 22/37/25
#   （pass 30/47/25）。32 断言（S1 结构 / S2 合成行为含三档触顶 + 失败不阻塞 / S3 真语料含链摘要冻结）
#   + 4 组变异自证（删注册调用 ⇒ S1+S2+S3 红）；~50s，无浏览器（真包 + 真 core，纯 Node）。
add "weassist-prefetch"   "node tests/weassist-prefetch-test.mjs"
add "clearfx-narrow"      "node tests/clearfx-narrow-test.mjs"
# ①(P-135 2026-09-19 主对话补登记) 两条：
#   `load-timeout` —— 用户第 ④ 项（"整面板只有 loading…" = module 从未执行）：看门狗必须把失败原因**写进 `#log`**、
#     全链路 await 收进统一超时（`NET_TIMEOUT_MS`/`DECODE_TIMEOUT_MS = 8000`，模块常量，**0 新开关**）、
#     单资源失败不再打断整包装载。68 断言 + 4 组变异（含"摘掉写日志那行 ⇒ 9 条红"）。~6.3s，无网络/无浏览器。
#   `pkg-entry-index` —— 服务端两处热点（`/noise` 657.9MiB/次、`/shader` 整包/请求）改成"目录表只读一次 + 只读命中条目"，
#     响应与旧实现**逐字节相同**；27 断言 + 1 组变异（`PKG_HEAD_BYTES→1GB` ⇒ 读量断言必红）。~1.1s，缺语料 SKIP。
add "load-timeout"      "node tests/load-timeout-test.mjs"
add "pkg-entry-index"   "node tests/server-pkg-index-test.mjs" "" "^SKIP pkg-index"
# ①(P-137 2026-09-19 主对话补登记) `script-runtime-errors`：用户第 ⑧ 项「视频壁纸下面总是报一堆的错」=
#   沙箱 `thisLayer.size` / `thisObject.size` **从未实现** ⇒ 作者脚本 `update()` 每帧同一个 TypeError
#   （上报实测 ×511 / ×72 → 0；全语料同类 **11 包 / 61 个脚本节点**清零，有脚本错的包 18 → 8）。
#   22 断言 + 2 组变异自证（删 size 访问器 ⇒ 511 次重现）；~2.0s，无浏览器/无网络，缺语料 SKIP+exit 0。
add "script-runtime-errors" "node tests/script-runtime-errors-test.mjs" "" "^SKIP script-runtime-errors"
add "script-phase-order" "node tests/script-phase-order-test.mjs"   # 脚本 prepare/init/update 三趟跑序 + 四类成员缺口（37 断言 + 4 组变异）
# ①(P-143 2026-09-23 主对话补登记) `script-member-gaps`：上一批登记的**静默缺口**（不抛错但值错）——
#   `ITextLayer.pointsize/font/horizontalalign/verticalalign`（真包 `佩丽卡1_03` 的 `objects[5].origin.y`
#   因 `pointsize` undefined 参与算术后变 NaN："2925.104490 NaN 0.000000" → 2952.965060）、
#   `originalOrigin`（NSL 拖动库"恢复初始位置"静默 no-op）、`IEffectLayer.getEffect`（3122339805/2887099508
#   的效果开关）、`thisLayer.debug`（3662790108 作者调试分支）+ `Vec3/Vec2` 单参数构造的有限缺省。
#   判据：38 断言（含 6 个真包的改前/改后读数）+ 全语料静默 NaN 扫描（17 包 → 7 包，白名单只留另案）
#   + 6 组变异自证；~40s（--quick 只跳全语料扫描），无浏览器/无网络，缺语料 SKIP+exit 0。
add "script-member-gaps" "node tests/script-member-gaps-test.mjs" "" "^SKIP script-member-gaps"
# ①(P-138 2026-09-19 主对话补登记) `now-playing`：用户第 2 项给的 Bencho「Now playing」组件（改名 `NowPlaying`）
#   落到 `demo/now-playing/`（组件源码照抄 + 保留全部注释 / 纯函数数学 / CSS 全在 `.snd` 子树内 / 14 个 token 只本地定义 /
#   构建产物 `dist/now-playing.js` 自足入库）。**216 断言 + 6 组变异**（boxRadius 丢一轴 off、swell 指数、
#   删一个 token、选择器漏出 `.snd` 子树；P-161 新增两组：seekRatio 去钳位、seekRatio 删 width≤0 守卫）；
#   另含 P-161 的受控数据面（data/onTransport、op 词汇、DOM 标记、受控/脱开两态 SSR 渲染）；
#   ~1.5s，无浏览器/无网络（无 node_modules 时 SSR 探针明确 SKIP）。
add "now-playing"       "node tests/now-playing-test.mjs"
# ①(P-136 2026-09-19 主对话补登记) `pointer-trail-copy`：用户第 4 项「直接照抄 oneincase 跟鼠标尾迹有关的代码」——
#   ①`core/we-pointer-source.mjs` 与上游 pointer.js **逐字节相同**（门禁断言 `tail === up`）；
#   ②根因修复：指针坐标原先进了粒子缓存签名 ⇒ 指针一动**每帧**从 t=0 重放 400 步 ⇒ 尾迹永远被抹平；
#     照抄上游"指针是每帧推进的活输入、不进构造"后：顶点流 x 跨度 **67.4 → 1175.2px**、距指针最远 **39.6 → 1164.3px**、
#     每帧仿真步数 **400 → 1**、30 帧内重建 **29 → 0**（上游同参 1112px，±25% 内）。
#   44 断言 + RED-IF-REVERTED（指针写回签名 ⇒ 子进程 rc=1 且数字回到旧口径）；~1s，无浏览器/无网络，缺真包 SKIP。
add "pointer-trail-copy" "node tests/pointer-trail-copy-test.mjs" "" "^SKIP pointer-trail-copy"
# ①(P-141 2026-09-19 主对话补登记) `scene-script-api-gaps`：P-137 之后**残余 8 类** SceneScript API 缺口收口
#   （`getAnimation` / `getParticleSystem` / `isPlaying` / `play/pause/stop` / `createLayer` / `sortLayer` /
#   `getLayerIndex` / `getInitialLayerConfig` / `engine.setInterval` / `input.cursor*` / `engine.screenResolution`）。
#   判据：全语料 98 容器 / 37 个带 scripts 的包 / 1953 节点逐包第 1 帧 —— **有脚本错的包 8 → 0**，
#   `KNOWN_GAPS` 白名单**缩空**（并留 S5d"白名单为空时断言 0 包"）。37 断言 + 3 组变异自证；~2.8s，无浏览器/无网络。
add "scene-script-api-gaps" "node tests/scene-script-api-gaps-test.mjs" "" "^SKIP scene-script-api-gaps"
# ①(P-139 2026-09-19 主对话补登记) `kaltsit-puppet-anchor`：用户第 5 项（凯尔希头不动 + 眨眼穿到下眼皮下面）——
#   ①附件锚点**冻在 t=0** ⇒ 14 个挂头附件相对父网格漂移 **70.55u** → 0；②渲染采样器**轨尾回绕** ⇒ 头骨单帧
#   **699.38u → 1.55u**、全周期位移 699.38u → **67.33u（= 官方）**；③睑/眼球绘制顺序错配（睑层延后到眼球之后）。
#   同族扫描：有 puppet 8 个包里 **6 个**渲染路径会取到错帧（838.5u / 480.6u / 365.7u / 350.6u / 311.0u）
#   ⇒ 同一修法同时生效。50 断言 + 6 组变异自证；~4.3s，无浏览器/无网络/无 GL，缺语料 SKIP+exit 0。
add "kaltsit-puppet-anchor" "node tests/kaltsit-puppet-anchor-test.mjs" "" "^SKIP kaltsit-puppet-anchor"
# ①(P-140 2026-09-19 主对话补登记) `particle-turbulence-field`：用户第 7 项（vapor 层"发散的线条"）——
#   `turbulentvelocityrandom` 原实现是**每颗粒子一个独立随机角**（取 `p.random`），官方是**按位置采样的相干场**
#   ⇒ 同地出生的粒子四散、`rope` 再把它们连成细线。改成位置场后真包 `dd/3544152633 ln=25`：
#   段长中位 **172.3 → 12.8px**、ribbon 总长 **7000 → 708px**、>60px 的段 **27 → 0**；全语料同族判据 **13 → 0**
#   （影响面 28 层 = rope 13 / sprite 14 / spritetrail 1，`?pturb=legacy` 逐位回退，开关已登记 154 == 154）。
#   33 断言 + RED-IF-REVERTED（含"legacy 顶点流 sha256 == 换回旧算式的变异体"逐位证明）；~2.4s，无浏览器/无网络。
add "particle-turbulence-field" "node tests/particle-turbulence-field-test.mjs" "" "^SKIP particle-turbulence-field"
# ①(P-143 2026-09-19 主对话) `core-module-wiring`：**首屏 module 图的三处接线守卫**（P0 事故防复发）——
#   浏览器按**相对说明符**取的内核文件必须同时有：①8899 服务器路由 ②Pages 产物映射（或 KEEP_DIRS 目录）③sw.js 预缓存。
#   事故：P-136 新增 `core/we-pointer-source.mjs`/`we-particle-pointer.mjs` + P-139 让 puppet.js 以 `../../core/…` 取模块，
#   三处**同时**漏登记 ⇒ `/we-pointer-source.mjs` 404 ⇒ 浏览器按"模块 MIME 不合法"拒绝 ⇒ **整条 module 图断掉**、
#   页面停在 `loading…`（而所有 Node 门禁全绿 —— 它们按文件系统解析，看不见 404）。64 断言，~0.2s。
add "core-module-wiring"  "node tests/core-module-wiring-test.mjs"
# ①(用户第 6 项 2026-09-19 主对话) `mpw-select`：自绘下拉的**纯逻辑 + 实现纪律**门禁（58 断言，~0.1s）——
#   自动上下翻转的边界（往下够/只够往上/两边都紧/空列表）、键盘索引、单开注册表、再点即关、
#   监听器配对装卸（无常驻监听）、CSS 全在 `.mpw_select` 子树且零自定义属性、RED-IF-REVERTED。
add "mpw-select"         "node tests/mpw-select-test.mjs"
# ①(P-142 2026-09-19 主对话补登记) `p142-nav-sound`：用户第 4/5/6 项（资源管理器**收纳键** + 声音控件挂进
#   "壁纸配置"下半部 + **video 声音接入**）—— 92 断言（静态 28 / 假 DOM 44 / 读数 1 / 变异 19），
#   9 条变异全部变红；含"收起/展开各遮挡多少属性项 + 两态都滚得到（unreachable=0）"的实测数字。~1.1s，无浏览器。
add "p142-nav-sound"     "node tests/p142-nav-sound-test.mjs"
# ①(P-143 主对话) `select-live`：自绘下拉（用户第 6 项）的**真机门禁** —— 同时是渲染器页的**真机冒烟**
#   （S0：module 启动 + 场景装载成功 + 真出帧；2026-09-19 的 `objById` 作用域 P0 就是"页面白屏而 Node 门禁全绿"）。
#   S1～S7：真 X11 点击开/再点关/点选项写值派发 change/点空白关/键盘选/`data-flip` 与实测空间一致。
#   无 X 显示/无 scrot/无 8899/无 Playwright ⇒ 自我 SKIP。（实测 5–8 分钟 ⇒ 见下方为何不进默认门禁。）
# ⚠ ①(P-143 2026-09-19 **不进默认门禁**：实测单跑 **5–8 分钟**，而门禁单项超时是 600s（`ITEM_TIMEOUT`），
#   在机器忙时必然超时误红。它的核心判据已被这三项覆盖：`mpw-select`（58 断言、无浏览器，管翻转/单开/再点即关的边界）、
#   `bench-click`（25 断言、真 X11 点击、~2min）、`x11-pointer`（7 断言、真指针、60s）；本项额外提供的是
#   "**渲染器页真机冒烟**（module 启动 + 场景装载 + 出帧）+ 属性面板里那个 combo 的真机点击"。
#   要跑：`node tests/x11-e2e/select-live-test.mjs [--flips]`（`--flips` 才做贴底上翻探测）。
# add "select-live"      "node tests/x11-e2e/select-live-test.mjs" "slow" "^SKIP select-live"
# ①(P-121 2026-09-18 沙箱隔离) 壁纸**作者脚本能静音宿主进程的 console**（`console.log = () => {}` 写穿宿主：
#   宿主与脚本共享真 console 对象；实测真包 `0917/3462491575` 的脚本里就有这一行）。修法 = 每沙箱一个 Proxy
#   门面（set 只落门面 ⇒ 作者静音意图在它自己沙箱内照常生效；get 转发到*当前*宿主同名方法 ⇒ 日志照进 stdout /
#   页面 #log 桥）+ 把 process/require/module/exports/Buffer/global 显式 shadow 成 undefined。
#   31 断言：①跑过静音脚本后宿主 5 个 console 方法逐个 `===` 同一引用且仍真的输出；②正常脚本日志仍可见；
#   ③globalThis/进程句柄/localStorage/engine.setTimeout 的隔离面钉死。带两个变异自证。
add "script-sandbox-globals" "node tests/script-sandbox-globals-test.mjs" "" "^SKIP script-sandbox-globals"
# ①(P2-1 2026-09-18 任务书 C1) `we-core`（MIT 独立实现包，`packages/we-core/`）与 `core/**` 的**黑盒对拍**：
#   真语料 2 个真包（3.9MB / 7.1MB）⇒ PKG 头部字段 + 42 个条目载荷 sha256 **全等**；6 个 .tex 头部 + 32 个 mip
#   的 {宽,高,压缩} 与 **LZ4 解压后字节**逐字节相同；矩阵 576 组 multiply + 16 轮参数 + 96 组 TransformPoint
#   `Object.is` 零差异。缺语料 ⇒ SKIP。带 3 处单字节变异自证（格式表 / lz4 匹配长度 / mat4Ortho ⇒ 必红）。
#   包内自带"零外部 import"红线断言（不许 import core/**、不许 node_modules、连 node: 内置都不用）。
add "we-core-parity" "node tests/we-core-parity-test.mjs" "" "^SKIP we-core-parity"
# ①(P-144 2026-09-19 主对话补登记) `particle-children`：粒子 `children`（子系 / 拖尾）**全家族** ——
#   语料最大单项（**76 个父层 / 21 个包 / 149 条子系**：`eventfollow` 37 / `static` 34 / `eventdeath` 30 /
#   `eventspawn` 8 / `type` 缺失 40 = 官方缺省 `static`；其中 **83 条子系贴图在包外**，走 `/weassist` 回退链）。
#   6 组：①字段面（官方缺省 `maxcount 20`/`probability 1.0`/`controlpointstartindex 0`、未知 type 回落 `static`、
#   非法项跳过、边界钳位）②四种 type 的行为（`static` 锚点 / `eventfollow` 跟 leader 且父粒子死则清空 /
#   `eventspawn`/`eventdeath` 只在事件那一帧吐、且**不做持续发射** / `probability` 门 / `maxcount` 并发实例上限）
#   ③RNG 纪律（父系 RNG 流与粒子位置**逐位不因 children 改变**、子系吃自己的 RNG）
#   ④真包 `dd/3554161528` ln=22 id=4569「萤火虫」+ mock-GL：子系 quad **0 → 7**、子系存活 **0 → 7**、
#     每帧更新 **5 → 12**，且**父系顶点流两档 sha256 相同**（子系只多一批 draw）
#   ⑤`?children=legacy` **逐位回退证明**（legacy 顶点流 sha256 ≡ "源码级换回旧实现"变异体的 sha256）
#   ⑥全语料同族扫描（149 条里 **139 条真的产出粒子**：static 74/74、eventfollow 37/37、eventspawn 8/8、
#     eventdeath 20/30；剩下 10 条**全是作者写了 `probability: 0`**，不产出才是对的）
#   ⑦**6 组** RED-IF-REVERTED（R1 死亡事件关掉 / R2 概率门绕过 / R3 legacy 早退失效 / R4 出生事件关掉 /
#     R5 eventfollow 不跟 leader / R6 实例上限取消），每组都实测让**指定那一组**变红。
#   ⑧**照抄登记**不许被静默删掉：`THIRD-PARTY.md` §15（上游 webwallgl MIT，三块照抄的 `file:line`
#     与 G-1/H-1/I-1/I-2 适配表）+ `docs/COPYING-RULES.md` §4 台账 entry #13。
#   **61 断言**；实测 ~6.4s、主进程 PeakRSS **~215MB**（进程树瞬时 ~430–460MB：父进程与 firefly 探针子进程重叠）、
#   无浏览器 / 无网络 / 无 X11。真包缺失时各组 SKIP 视作 PASS（不红），与其余真包类条件项同口径。
add "particle-children" "node tests/particle-children-test.mjs"

# ①(P-152 2026-09-19 / **P-152b 2026-09-23**) `mdl-bone-layout`：**MDLS 骨骼布局校验 + 变长布局重扫救回**。
#   依据 `docs/UPSTREAM-PORT-PLAN-20260919.md` §4（上游 `be3c246` 的**判据**：先按布局 A 整体解析并校验，
#   任一骨非法才判定变长布局；重扫拿全才采用，绝不返回残缺骨架）。P-152 落了"校验 + 明确失败路径"，
#   但**有意不落重扫** ⇒ 真语料 3 个**非 A 变长布局**包被拒收（`bones=[]` = 丢蒙皮），而 legacy 路径在
#   那 3 个包上本来就只产**残缺骨架**（`asuna body bottom` 声明 7 得 1 / `人物` 声明 55 得 3 /
#   `deimos.fbx` 声明 2 得 0）。**P-152b** 补上"骨名前置变长布局"的**可判定**重扫（判据合取：
#   固定起点 / `len==64` / 骨名槽可打印且有界 / `parent<骨序号` / 三行正交矩阵 / 不越段界 /
#   带槽与不带槽两种读法只允许一种成立或结果逐位相同），**解析不出仍如实拒绝**；A 路径逐位不变。
#   本项锁五件事：① 合成样本逐类判定（合法 A / parent 越界 / 材质索引越界 / 记录截断 / 骨名槽超长 /
#   骨名槽非法字节 / 旋转非单位长 / 平移非有限 / 声明骨数越界 / 10 字节头变体）；①b 变长布局（骨名前置）
#   合成夹具：布局 B/C ⇒ **救回**且 type/parent 与构造值逐位相同；父前向引用 / `len≠64` / 记录截断 /
#   矩阵非正交 / 越过段界 ⇒ **仍拒绝**且 `mdlDiag.rescan.reason` 可见；② 全语料回归（布局 A 文件默认档
#   == `?mdls=legacy` 档**逐字段**相同；3 个变长布局包**只在此处**允许差异，且必须当场满足"骨数==声明 +
#   legacy 残缺且是逐位前缀"）；③ `?mdls=legacy` 逐位回退（判定式 + 逐样本 + 全语料；legacy **不救回**）；
#   ④ **6 组变异自证**（真跑：复制 `core/` 到临时目录做字符串变异再 import —— R1 去掉校验 ⇒ 非法样本不再
#   被拒必红；R2 布局判定恒 A ⇒ 拒绝档 `layout` 必红；R3 骨名槽判据弱化 ⇒ 本门禁仍全绿 = 没有靠它做
#   过度拒绝；R4 关掉重扫 ⇒ 4 个变长夹具退回拒绝必红；R5 重扫在矩阵截断处 `break`（接受残缺）⇒
#   "绝不残缺"必红；R6 去掉"父必须先声明" ⇒ 前向引用夹具被误救回必红）；⑤ 两侧可观测面（core 的
#   `mdlDiag` ⇔ elysia 现状：局部变量未随 return ⇒ 只留 "warn + bones=[]"，如实登记不对称）。
#   **139 断言**；实测（2026-09-23，当前语料 172 `.mdl` / 86 MDLS / 885 骨）~46s、单进程 PeakRSS ≈ 1.4GB
#   —— 峰值**几乎全在全语料通读**（335k 顶点的模型要实例化 `positions/uvs/blend*` 数组：单独跑"只解析
#   全语料"的探针也要 ≈0.77GB），①②④⑤ 组（合成夹具 + 变异自证）是 60MB 级；**无浏览器 / 无网络 / 无 X11**。
#   ⚠ **语料敏感**：③ 组的计数/文件名清单随本机语料走（`$MPW_ROOT/allwallpaper` + `~/.dsh-mpkg-wallpaper`），
#     基线自导出、只增不减；真语料缺失 ⇒ 该组红（**不** SKIP：语料是本项判据的可信来源）。
#   ✅ **不渲染敏感**：①②④⑤ 组是纯字节解析 + 合成夹具，与语料/GPU 无关。
add "mdl-bone-layout" "node tests/mdl-bone-layout-test.mjs"
# ①(P-153 2026-09-19 · 派单 B) 脚本 `localStorage` 的**共享持久**档 `?scriptstore=persist`（方案
#   `docs/UPSTREAM-PORT-PLAN-20260919.md` §5）：**缺省逐位保持 legacy**（逐沙箱 `new Map()`、不共享、
#   不持久 —— 本仓"脚本沙箱不碰宿主存储"的纪律不变），显式开关才走"同一壁纸全部脚本共享一份 +
#   跨会话持久"，后端 = 宿主 `window.localStorage`，键只落我们自己的 `mpw.<包id>.` 命名空间。
#   覆盖：G0 开关判定式与导出面 / G1 legacy 档（同沙箱可见、**跨沙箱不可见**、门面逐沙箱一份、
#   **0 次 setItem / 宿主 storage 一个键都不落**）/ G2 persist 档（跨沙箱可见、真落盘、键名实例、
#   Vec3 对象 round-trip、remove、**重建 store 模拟刷新后仍在**、命名空间隔离、`LOCATION_GLOBAL`、
#   完整 API 面、`clear()` 只清本命名空间）/ G2r 真语料真作者脚本（`dd/3326873240`：legacy 复位 vs
#   persist 记住拖拽位置）/ G3 异常兜底（配额·getItem 抛·不透明源·无后端 ⇒ 不崩、退回内存、
#   **恰好 1 行 warn**）/ G4 语料口径（8 包 / 66 次 / 只有 get-set-remove / `LOCATION_*`+`resizeScreen` = 0）。
#   **113 断言 + 6 组 RED-IF-REVERTED**（R1 默认档改成 persist / R2 去键前缀 / R3 去 try/catch /
#   R4 忽略 opts.scriptStore / R5 去写穿透 / R6 `clear()` 清整个后端；变异只在 /tmp 副本上做，真树不动）。
#   无浏览器 / 无网络；实测 ~1.5s、进程树 PeakRSS **~180MB**（单 node 进程）。缺语料时 G4/G2r 标 SKIP 不红。
add "script-storage" "node tests/script-storage-test.mjs" "" "^SKIP script-storage"
# ①(P-149 2026-09-19 · 派单 A) 粒子材质常量 `ui_editor_properties_overbright`（缺省 **1**，乘在精灵实例
#   RGB 上、**不动 alpha**）：语料 **38 条材质带该键 / 15 个包 / 54 个粒子层**，其中 **非 1 的层 25 个**
#   （最大 `5×`、最小 `0.17×`；`dd/3719111841` 的 Bokeh Hex/Cir = **0.25** ⇒ 今天亮 4 倍糊屏）——
#   此前整块随 `constantshadervalues` 被静默丢弃（全仓 0 实现）。
#   8 组：①取值契约（键缺失/脏值 ⇒ **1**、负数 ⇒ 0、**不设上界**）②合成场景两条色路（uniform 上提 +
#   逐顶点 `a_Color`；`0.25/0.17/1.33/2/5` 逐顶点 ≡ 基色 × 因子、因子 1 ≡ legacy 档全字节相同）
#   ③真包四层修前→修后（Bokeh Hex/Cir 0.25、reactive Stars 5、new_particle_system 0.17；几何流逐位不变）
#   ④子系路径（真包 `dd/3544152633` 的子系材质 `star_shine-2` = **2**：子系吃自己的因子、父层逐字节不变）
#   ⑤值 = 1 的层（`dd/3554161528` ln=22 萤火虫）两档整条 sha256 相同 + `?overbright=legacy` 稳定可复现
#   ⑥语料扫描计数（材质 38 / 包 15 / 层 54 / 非 1 层 25 / 值=1 层 29 + 取值直方图逐键相等）
#   ⑦接线（`demo.html` 父层 + 子系两处）与登记（README 主表 / 本文件 / PATCHES P-149 / §16 / 台账 #14）
#   ⑧**5 组** RED-IF-REVERTED（去掉判空 / 钳到乘之后 / 功能拿掉 / 子系不带因子 / legacy 档失效），
#     每组都**另跑一次探针**并记录实际变红的断言。
#   回退开关 `?overbright=legacy`（恒 1 = 逐位回到"键被忽略"的旧画面），已登记进 README-DIAGNOSTICS 主表。
#   真包一律走 PKG **entry 流式读**（最大 158MB 的 `0917/3509243656` 不整包读入）；断言 **91**
#   （功能 80 + 变异自证 11）、实测 ~3.5s、单 node 进程 PeakRSS ~190MB、无浏览器 / 无网络 / 无 X11。
#   真包缺失时各组 SKIP 视作 PASS（不红）。
add "particle-overbright" "node tests/particle-overbright-test.mjs"

# ①(尾迹离开 2026-09-19) `trail-leave`：**鼠标尾迹在指针离开窗口时的行为**（用户实测项）
#   · 根因：无指针时涡流圆心退化成 `sys.origin`（= 图层原点；全屏尾迹层就是**画面中心**）、
#     吸附目标退化成 authored `cp.offset` 当世界坐标用（= 左上角）——上游同形（`particles.js:1011`
#     的 `this._cpPos(v.cp) || [0, 0, 0]`）；本仓库 P-118/P-121 的语义是"离开 ⇒ 无指针" ⇒ 必须自己兜住。
#   · 修法：块 F 追加"最后已知指针"影子 + `shadowCpWorld()`（力中心冻结在最后离开点）+
#     `finishTrailInPlace()`（有界衰减收尾）；离开后不再发射、第 `TRAIL_FINISH_FRAMES` 帧归零、回来重建。
#   · 判据：合成 0.8/0.2 → 离开事件 → 逐帧力中心/质心/粒子数 + 真包 dd/3554161528 ln=389（缺失则 SKIP）。
#     **54 条正断言 + 4 组变异自证（16 条）**，实测 ~25s、单 node 进程、无浏览器 / 无网络 / 无 X11。
add "trail-leave" "node tests/trail-leave-test.mjs"

# ①(2026-09-23 上游分诊 P0) `hlsl2glsl-3351179520`：把 vendored 转译器补到上游 `9531aaf`（MIT）后，
#   上游 patch 批 `3351179520` 那两条**纯函数**判据（依据 `docs/UPSTREAM-TRIAGE-20260923.md` §4 第 1 条）：
#     · 9-3) **复合赋值的向量截断**：`vec2 s; s *= 500.0 / <vec4>;` ⇒ 右值补 `.xy`（HLSL 按左值宽度截断，
#       GLSL ES 报 `'=' : cannot convert from 'vec4' to 'vec2'` ⇒ 整条 pass 编译失败被静默跳过）；
#     · **vertConflicts**：同名 varying 出现在兄弟原文的 `#if/#else` 两分支且宽度不同 ⇒ 片元侧既不加宽
#       也不收窄（旧口径被死分支覆盖 ⇒ `calWaveData(vec4)` 调用报废）。
#   ＋ `shaders/common.h` 的 `rotateVec2(vec4,float)` 重载（GLOBAL_ROTATION=1 的飘带/头发整类）
#   与 `shaders/common_blending.h` 的 `ApplyBlending(float,…)` 保险重载：两者都做**真编译**判据
#   （glslangValidator）＋"把重载拿掉必编不过"的必要性对照。
#   分辨力自证：把 vendored 源码的两段补丁**切片删掉**再 import ⇒ T1/T2 的判定必须翻转（内建，不依赖改文件）。
#   19 断言（含 2 组变异）、实测 ~0.3s、无浏览器 / 无网络 / 无 GPU；glslangValidator 缺席时真编译一节 SKIP 不红。
add "hlsl2glsl-3351179520" "node tests/hlsl2glsl-3351179520-test.mjs"

# ①(2026-09-23 上游分诊 P1) `particle-sphere-dim`：`sphererandom` 发射器的**方向维度 + 半径分布**
#   （上游 `78718843` `particles.js` `@@ -1068`；依据 `docs/UPSTREAM-TRIAGE-20260923.md` §4 第 2 条）。
#   official（默认）＝ 方向维度由 `directions` 的激活轴数决定（`|dir[2]|≤1e-6 ⇒ pz=0`、`(nx,ny)` 严格单位圆）
#   ＋半径幂次分布 `r=(lo^d+u·(hi^d−lo^d))^(1/d)`（d=2 面积均匀、d=3 体积均匀）；`?psph=legacy` 逐位回退。
#   判据分四类：A `|pz|<1e-6` 且 `hypot∈[254,258]`（legacy 对照读数 |pz|≡256 ⇒ 有分辨力）、
#   B `"1 1 1"` 允许投影缩短但 z 不得恒 0（防"强制 2D"过度修正）、
#   C 2D 半径中位数 ≈ 256/√2 ≈ 181.0（legacy ≈ 128）、
#   D **legacy 逐位不变**：把改动前那 6 行算式**源码切片变异**回 bundle、同种子逐颗粒子 `Object.is` 比 `pos`。
#   17 断言（含 3 组逐位对拍 + 1 组"新默认必须不同"）、实测 ~0.2s、无浏览器 / 无网络 / 无 GPU。
add "particle-sphere-dim" "node tests/particle-sphere-dim-test.mjs"

# ①(2026-09-23 涡旋手性取证) `particle-vortex-chirality`：`vortex` 算子**切向手性**的回归门禁。
#   official（**本批新默认**）= `(dy,−dx)` = `radial × axis`；`?pvortex=legacy` = `(−dy,+dx)` = `axis × radial`。
#   ⚠ 依据是**第三方多实现共识 + 上游带理由的单向翻转**（`docs/VORTEX-CHIRALITY-RE-20260923.md`）；
#   **本机没有 WE 官方反编译产物、官方资产也没有方向定义** ⇒ 注释与门禁措辞都**不许**写成"对齐官方"。
#   判据：V1 纯函数（圆心 (0,0)、粒子 (r,0) ⇒ official `(0,−speed·dt)` / legacy `(0,+speed·dt)`）、
#   V2 端到端用**官方元素预览场景**的 vortex def（该层涡旋是主导力）⇒ 轨迹手性 L = ∓0.3218、
#   V3 真包语料读数逐条留档（5 处 vortex；**只有 1 处干净可分辨**，其余被该层主导力盖住 —— 已如实写进
#   文件头，判据定位是"佐证 + 回归"而非"方向仲裁"）、V4 调用点符号**源码切片变异** ⇒ V2 必红。
#   18 断言（含 1 组变异）、实测 ~0.7s、无浏览器 / 无网络 / 无 GPU；语料/官方资产缺席时对应段 SKIP 不红。
add "particle-vortex-chirality" "node tests/particle-vortex-chirality-test.mjs"
add "particle-op-census"  "node tests/particle-op-census-test.mjs"

# ①(2026-09-21 · 台账 `../docs/USER-ITEMS-20260920-B.md` §5.3) `bench-bandfeed-switch`：测试台工具条
#   「音条源」四档（壁纸 / 麦克风 / 模拟 / 关 → 渲染器 `?bandfeed=auto|mic|sim|off`）的**接线门禁**。
#   判据原文四条：①静音 / 无源档 ⇒ 渲染器 `source='silent'` 且音条层顶点色的**输入**（128 元数组 +
#   交给渲染器的 16 段活视图）全 0（如实）；②`?bandfeed=sim` ⇒ 非 0（形态可见）；③`?bandfeed=mic`
#   且拒绝授权 ⇒ 仍 silent 且**不弹第二次**（`getUserMedia` 恰好一次）；④任何档都**不许**为音条
#   自动播放包内音频（不"莫名出声"）。
#   A 段把 `demo.html` 的 MPW-BANDFEED 块**真源码切片**出来 + 桩 analyser / 麦克风 / 计数用媒体元素跑
#   真实分支（与既有 `audio-band-wiring` 同一手法）；B 段钉接线：四档 → URL 映射（真纯函数
#   `bandFeedUrl`）、默认档 = `auto`（**不许** mic）、`mic` 档没被任何自动路径打开（本批不调
#   `getUserMedia` / 不代勾 `#mic-enable`、auto 档在"未决定"时 0 次请求）、状态行在静音与非静音
#   两态下文案不同（真纯函数 `bandFeedStatusPlan` + `#status-bandfeed` 的 `data-mpw-*` 挂点 + 三处
#   既有重画路径；静音 / 非静音 / **"渲染器已就绪但不回报"** 三态互不相同 —— 最后一态是本轮实测
#   发现的：测试台嵌入的是产物页 `demo/renderer/index.html`，它不认 `?bandfeed=`，不许一直写
#   "等待渲染器回报"），以及接线是**行为级**的（用假原型驱动真 `installBandFeedSrcHook`：换档后每次
#   写入 src 都带当时档位、只有一个 `bandfeed` 参数、非渲染器 URL 一字不改）；C 段 **6 组**变异自证
#   （默认档改 mic / auto 拼成 off / 删掉静音原因 / 插一次 `play()` / 摘掉 src 拼接 / 短路"不回报"分支
#   ⇒ 对应断言必红）——变异只落内存切片与 os.tmpdir() 副本，真树跑前跑后同哈希。
#   54 断言、实测 ~0.2s、无浏览器 / 无网络。诚实边界（文件头也写着）：真机权限框弹几次与屏幕上的
#   真实像素**不在本项**；那部分只做到"喂给顶点色的数据 + 请求次数"这一层。
add "bench-bandfeed-switch" "node tests/bench-bandfeed-switch-test.mjs"
# ①(2026-09-22 用户第 25/29/12 条) `bench-dropdown-theme`：三条"静态可判"的真机报障 ——
#   25 叉贴后卡住（`setTypeFilter` 从未定义 ⇒ 改用产物自己的 `driveBundleType`；按**剥注释后的代码**扫全文）、
#   29 分辨率下拉里滚轮一滚就关（捕获监听仍在、非内部滚动仍收起，但**浮层内部的滚动要跳过**）、
#   12 一进页面就是深色（主题规范化：**没存过 ⇒ light**、显式照办、历史 'auto' 仍按系统迁移）。
#   17 断言（含纯函数口径与三条分辨力自证），~0.1s，无浏览器。
add "bench-dropdown-theme" "node tests/bench-dropdown-theme-test.mjs"
# ①(2026-09-22 第 13/14 条) `bench-dbg-dpr-probe`：**调试逐层隔离**与 **DPR 切换**的真机自上报判据 ——
#   进调试（先切 `#tab-debug` 再点 `#dbg-mode`）后栏里有层号；**按右方向键隔离层真的换了一个**
#   （实测 `from:0 → to:2` 且始终恰好一层可见）、退出后全层恢复；DPR 改档 + 重挂载后画布像素真的跟着变、
#   iframe 不白屏、且可逆。纯判据 `--selftest` 5 条常驻（`--live` 那半需要 :8902，缺 playwright 如实 SKIP）。
#   ⚠ 断言口径已按实测校准：**进调试只显示层信息、隔离在步进时应用**（不是"一进就隔离"）。
add "bench-dbg-dpr-probe" "node tests/bench-dbg-dpr-probe.mjs --selftest"
# ①(2026-09-22 用户第 5/6/7 条) `bench-props-text`：属性面板富文本三条 —— 图片按**解析后 URL** 去重
#   （同一张只画一遍）、`&nbsp;` 收口（**双重编码** `&amp;nbsp;` + **无分号** `&nbsp`；后面紧跟字母数字时
#   **不猜**；其它实体不过度解码）、文案里的 `BVxxxxxxxxxx` 转 `https://b23.tv/<BV>` 并**走既有 link 白名单通道**。
#   16 断言（纯函数口径 + 源码级接线 + 分辨力自证），~0.1s，无浏览器。
add "bench-props-text" "node tests/bench-props-text-test.mjs"
# ①(2026-09-23 第 23 条) `bench-log-clip-probe`：输出区/调试区**行首时间永远可见** —— 用户报"调试输出前面的
#   时间被左侧边栏切掉，清空/重挂载后又好了"。真机制是**长行**：`#logbody` 是产物的 `<pre>`（默认
#   `white-space:pre`）⇒ 一行比容器宽就长出横向滚动区，行首那段时间只能靠横滚才看得见（内容一换短
#   `scrollWidth` 缩回 ⇒ "又好了"）。修法是 `white-space:pre-wrap;overflow-wrap:anywhere`（补丁 SITE_LAYOUT_CSS
#   + 静态表 + 调试区三处 + `:8899` 渲染器页 `#log`），让折行成为**结构保证**。判据四档 × 四条：行左缘 ≥
#   侧栏右缘−1px、容器 `scrollLeft==0`、行首时间戳不被任何不透明面板压住、**插一条 4000 字符无空格行后
#   `scrollWidth ≤ clientWidth+2`**（修前实测 `#dbg-log` 23020/1094 ⇒ 这条会红）。
#   纯判据 `--selftest` 5 条常驻（含 S5 静态契约：5 处日志规则缺一处即红），`--live` 那半需要 :8902。
add "bench-log-clip-probe" "node tests/bench-log-clip-probe.mjs --selftest"
# ②(2026-09-23 第 ⑤ 条) `scene-fit-view`：场景档 `?fit=` 的上游语义（"画面偏小右移"的根因）。
#   修前本仓只判 `has('fit')` —— 宿主预览 URL 恒带 `fit=cover`（上游 fit 模式）⇒ 被当成"本页自动适应取景"，
#   对全体层做 k≈0.78 缩放 + 一次 `origin=(origin−c)/k`（居中除反）⇒ 同 640×360 取景框下上游铺满、
#   本仓只占中右一块（真机 A/B 读数 dx=+47.7 / cover 0.69 vs 0.85）。现在按取值分流：`1|auto` = 自动取景、
#   `cover|contain|stretch|fill|fit` = 上游三态取景（按画布比例算视口 + 居中偏移 + 元素 object-fit）。
#   26 条断言（归一表 / 整比例视口 / 三态与偏移 / object-fit / 源码接线 / 分辨力自证），纯函数、无浏览器。
add "scene-fit-view" "node tests/scene-fit-view-test.mjs"
# ②(2026-09-23 第 ⑤ 条) `cover-ab-probe`：两个渲染器**同一取景框**的像素级 A/B（内容包围盒/质心/尺度比）。
#   纯判据 `--selftest` 6 条常驻；`--live`（`--direct` 或测试台模式）需要 :8899/:8902。
add "cover-ab-probe" "node tests/cover-ab-probe.mjs --selftest"
# ③(2026-09-23 第 ⑥ 条) `web-frame-host`：web 壁纸**宿主契约**（`core/web-frame-host.mjs` +
#   `core/we-web-shim.mjs` + `server/web-store.mjs`）。三块：档位/入口/降档/失败态（纯函数，含三条硬规则：
#   同源绝不 blob、被嵌入绝不自动升 compat、显式档位永不自动换档）；注入五条规则（幂等/转义/无 head 自造/
#   超限跳过/CSP 跳过）；**真 shim 在 node:vm 里跑**的语义（回调延后到微任务、晚挂 listener 拿全量快照、
#   暂停期不下发音频、媒体 listener 回放最近一帧、不透明源才装 storage facade、上限抛 QuotaExceededError、
#   种子懒回灌）+ 存储落盘（wallId 受限字符集/合并/最旧淘汰/不透明源 CORS）。73 条，纯函数无浏览器。
add "web-frame-host" "node tests/web-frame-host-test.mjs"
# ①(2026-09-23 第 11 条取证) `text-box-invariant-probe`：文本层「绘制四边形 == 光栅化位图盒」不变量。
#   起因：`3326873240` 报「星期文字的 M/Y 被切一半、秒数区只露 1/5」。逐层读数 + 现场裁图显示字形是完整的，
#   于是把真正该守的那条钉住：`layer.size` 必须等于**这次**光栅化的 `boxW/boxH`（不一致 = 字被拉伸/像被切，
#   不报错、不白屏，只在某些壁纸某些字号下"看起来怪"）。页面侧读数由 `__mpwTextBoxWant` 开关控制。
#   纯判据 `--selftest` 6 条常驻（含"位图 193 画在 265 上 ⇒ 必须违反"的分辨力自证）；真机模式需 :8902，
#   支持 `--viewport WxH`（小视口最容易出问题 —— 实测 1280×720 / 960×540 / 624×351 各 29/67/47 条读数、0 违反）。
add "text-box-invariant" "node tests/text-box-invariant-probe.mjs --selftest"
# ①(2026-09-23 第 18/19 条取证) `minification-quality-probe`：**缩采样质量**读数 —— 同场景分别按大画布与
#   小画布渲染，把大画布那张用浏览器高质量滤波降到小尺寸当参照，量 MAE（0..255）。
#   诚实边界（写进探针头注释）：只对**准静态**场景有意义 —— 实测动场景同尺寸自比的"地板"就有 4.33
#   （粒子/时钟在走），静场景 0.29~0.38；探针默认只报读数，阈值等拿到多张基线再写死。
#   已用它在 `3554161528` 上对拍过 `?texmip=tri`（三线性 mip）：默认 LIN 1.755 vs tri 3.440（地板 0.379）
#   ⇒ **默认不翻**，该档保持显式开关（并带 Adreno 大 NPOT generateMipmap 静默失败的已知风险）。
add "minification-quality" "node tests/minification-quality-probe.mjs --selftest"
# ①(第 19 条取证) `video-downscale-flicker-probe`：**非全屏（缩小显示）黑线闪烁**的可量读数 ——
#   用浏览器自己的缩放器把原生帧逐帧画到目标尺寸，量「高通层的时间方差」（闪烁）与「细节能量」。
#   内存纪律写进探针头（帧不进 Node 内存 / 页内只解一张 / 指标边算边累加）：本机 15GB、曾 OOM 重启。
#   实测（`3588989102` 2558×1438@60，16 帧）：非全屏尺寸上「一次直降」的闪烁是「逐级减半」的
#   **1.6~2.7×**（细节低 1.4~1.9× ⇒ 取舍而非纯赢）；`imageSmoothingQuality` low↔high 在 Firefox
#   上**逐位无效果**。缺帧目录 ⇒ SKIP；纯判据 7 条常驻。
add "video-downscale-flicker" "node tests/video-downscale-flicker-probe.mjs --selftest"
# ①(TypeScript 只当**类型检查器**) `types-check`：`tsc --noEmit`（allowJs + checkJs）扫**纯逻辑小模块**
#   （core/web-frame-host.mjs / core/web-frame-geometry.mjs / server/web-store.mjs）。
#   为什么不重写成 TS：插件半边必须单文件下发（integrity-check ⑩）、渲染器半边必须直出源码
#   （/bundle.js 就是本体，多处门禁按源码行守卫、server 里按字面量 path.join 抽路由）⇒ 都不能引构建步骤。
#   落地即抓到 3 处真实不一致（返回联合类型 / 防御式取值却标必填 / 默认 {} 与必填参数冲突），已修实。
#   含判别力自证（临时真错误文件必须变红）；未装 typescript ⇒ SKIP（不假装通过）。
add "types-check"        "node tests/types-check.mjs"
# ①(第 18 条续：LDR bloom / FXAA **整屏黑**) `canvas-capture-test`：画布回读契约。
#   根因实锤：`alpha:false` 的默认帧缓冲上 `copyTexSubImage2D` 报 0x502 **且纹理保持全零**
#   （Firefox 实测；`alpha:true` 同场景拷贝成功；antialias/premultipliedAlpha/preserveDrawingBuffer
#   三项无关）⇒ 老实现把全零纹理当场景色 compose 写满屏 = 整屏黑（同包 `?pp=off` 画面正常即判据）。
#   契约：copy 快路径 → readPixels 兜底 → 两级都失败**整链跳过（0 draw）**；compose 只在链干净时才画。
add "canvas-capture"     "node tests/canvas-capture-test.mjs"
# ①(第 18 条续) 同一条 Bug 的**活体**闸门：真画布像素（`#sc` 元素截图，外壳先藏掉 —— 整页截图会把
#   日志面板文字算成亮度，那是假绿）。基线 / `?pp=off` / `?bloomcap=skip` / `?aa=fxaa` 四档都必须不黑；
#   需要语料 `3778592720` + playwright + :8902，缺任一 ⇒ SKIP；纯判据 7 条常驻。
add "bloom-ldr-black"    "node tests/bloom-ldr-black-probe.mjs --selftest"

# ③(P-173 2026-09-24) `mdlv0016`：**`MDLV0016` 紧凑网格容器变体（顶点块签名 `0x01800009` + 顶点步长 52）**。
#   背景：`0923/2887099508` 的 5 个 `.mdl` 在**顶点块扫描**这一步就 `return null`（`core/attach-transform.mjs::parseMdl`
#   与 `elysia/we-renderer/puppet.js::_parseMdl` 都在解析 MDLS **之前**退出）⇒ 蒙皮/骨架整块丢失（P-172 末段
#   点名的"未救回"项）。它们的 MDLS 逐骨记录本身**合法**（A 定步读齐声明骨数、0 结构错、0 逐骨错）⇒ 缺的只是
#   "怎么读懂这个容器变体"。逐字节取证（5/5）：头 `MDLV0016` / 13B 固定头 / `21` 起 `materials/…` cstr /
#   4 个 0 填充 / 块签名 `0x01800009` / **`vertexBytes / 52 === maxIndex + 1`**（8684/52=167、33488/52=644、
#   16900/52=325、152776/52=2938）/ 索引数据写到 MDLS 起点。
#   新分支 = **可判定的合取**（签名 / 步长 / 顶点块与索引块界内且不越 MDLS / 顶点数与索引域互证 /
#   全量索引界内 / 全量逐顶点：pos 有限且 |v|≤1e6（**同一个闸门，没放宽**）· uv 有限 · 权重和 |Σ−1|<1e-3 ·
#   混合索引 < 声明骨数）；任一不满足 ⇒ `parseMdl` 仍返回 `null` + 一行 `[P-173]` warn + 机器可判
#   `mdlDiag.reason`（`opts.diag` 出口），**绝不返回残缺/错位网格**。旧 80 步长扫描**逐字保留** ⇒ 今天能解析的
#   166 个非 v16 文件一个字节都不经过新分支。
#   本项锁六件事：① 逐字节取证 + 判据复算（读数直接打印）② **全语料 172 行改前/改后逐字段对拍**（"改前" =
#   新分支关掉的副本；除这 5 个之外逐字段不变）③ 5/5 骨数 == 声明（2/5/2/2/3）+ 台账 + `?mdls=legacy` 两档
#   逐字段相同 + core⇔elysia 逐位相同 ④ 16 条合成边界夹具（签名/起点/步长/索引/权重/混合索引/pos·uv/越界/
#   越 MDLS/骨数/锚点/伪造 magic/截断）**必须仍被拒** ⑤ **8 组变异自证**（关分支 / 逐条去掉判据 / 起点错位，
#   每组打印 `MUTANT-RED-OK` 且**期望红集 == 实际红集**）⑥ `run-all-tests.sh` 登记。
#   **不新增 URL 开关**（新增开关要求同批登记 `docs/README-DIAGNOSTICS.md` 主表，本批禁碰 `docs/**`；
#   回退 = `git revert` `findMdlVertexBlock` 里那一行调用）。语料里第 6 个 `MDLV0016`（无 MDLS，块签名
#   `0x0000000f`、步长 48）**有意不接**（本分支只服务"要骨架"的网格），门禁断言它仍是 `null`。
#   纯 Node、无浏览器 / 无网络 / 无 X11 / 无 GPU；真语料缺失 ⇒ 红（不 SKIP，与兄弟项 `mdl-bone-layout` 同口径）。
add "mdlv0016"           "node tests/mdlv0016-test.mjs"

# ①(P-172.6 2026-09-24 主对话补登记) 没有 `scene.json` 的容器：有视频 ⇒ 按纯视频壁纸播（blob 源 + blob 媒体看门狗）、
#   连视频也没有 ⇒ 如实报错并列条目名（此前一律 `TextDecoder.decode(undefined)` 整页启动失败）；另有 256MiB 上限与多实例守卫。
#   判据：源码序 + 切真源码跑 8 个场景 + 3 组变异自证。纯 Node、不读语料、<1s。
add "mpkg-noscene"       "node tests/mpkg-noscene-test.mjs"

# ①(P-208 A11 2026-09-29) 老式布局读取：场景定义不在 scene.json 时按 project.json.file 取（大小写不敏感）。
#   依据 REVERSE-FINDINGS-7 RE-61"老式布局"行（官方 APK 样例 techno/fantastic_car 无 scene.json）；
#   旧实现会把它们判成"纯视频壁纸"（甚至把 JSON 条目按 video/mp4 建 blob）。
#   判据：真包三件套（APK 官方样例，不进仓库）+ parseScene 出层 + 单元口径（大小写/缺失/legacy 回退）+ 2 变异。
add "mpkg-oldschool-scene" "node tests/mpkg-oldschool-scene-test.mjs"

# ①(P-210 A7 2026-09-29) 层级 clampuvs ⇒ 内容纹理采样器（RE-47：官方是采样器侧配置；
#   语料 48 包 1261 层 true 1258/false 3 此前被忽略 ⇒ 视差/缩放越界时 REPEAT 花边）。
#   判据：真包三态解析 + mock-GL 运行时（CLAMP/REPEAT/legacy/快路径）+ A13 冲突台账 + 与 P-194 共存 + 2 变异。
add "clampuvs-wrap"       "node tests/clampuvs-wrap-test.mjs"

# ①(P-211 A10 2026-09-29) 精灵帧自动推进（RE-55：官方 Texture::AdvanceSpriteSheet 在 Texture 层自动推进，
#   脚本只读写状态；旧实现只在脚本驱动时接管 ⇒ 无脚本 sprite 层静止）。
#   判据：纯函数（含回绕/rate=0 冻结）+ 官方 fog1 真表三点读数（周期闭合 1.0s）+ 结构锚点 + 2 变异。
add "spritesheet-advance" "node tests/spritesheet-advance-test.mjs"

# ①(P-212 A2 2026-09-29) usertextures 三形态解析 + textures[i] 回落（RE-44：两数组按 index 对应同一
#   g_TextureN 槽，usertextures[i] 是运行时覆盖声明；无源回落 textures[i] ⇒ 不画错底色）。
#   判据：三形态纯函数表 + 真包三件（场景级/字符串形态/system 形态）+ 合成包 resolveEffectChain + legacy + 2 变异。
add "usertextures-fallback" "node tests/usertextures-fallback-test.mjs"

# ①(P-244 2026-10-07) `$` 保留名（官方**系统纹理槽** `$mediaThumbnail` / `$mediaPreviousThumbnail`）的宿主解析：
#   P-212 A2 只做完了槽位声明链，系统名的像素解析此前落到 `textures.get(name) || null` ⇒ 槽恒空；
#   P-244 补 `$` 名 ⇒ `resolveTexture` 钩子（命中即用、**不缓存**：封面会换），回退口 `?mediaslot=legacy`。
#   判据：源码 6 条 + mock-GL 端到端 8 条（无源回落 / 有源绑上封面 / 换封面即换 / 宿主撤源不抛 / legacy 不问钩子）。
add "system-texture-slot" "node tests/system-texture-slot-test.mjs"

# ①(P-246 2026-10-07) 合成源命名捕获（上游接入 P2 第 3 项 / 计划书 P-151）：`_rt_imageLayerComposite_<id>_<后缀>`
#   此前恒返回引用方自己的链输入 ⇒ 引用"某层 z 序成品"的材质（0917/3509243656 的天空盒/罗盘）拿到错内容。
#   判据 = 源码/离线 8 条（真包 2 材质 / 源层 589·433 不可见 / 引用方排在源之前）+ mock-GL 两帧 9 条
#   （源层不可见也捕获 / 引用方命中捕获 RT / legacy 逐位回旧 / 无引用零开销）。
add "composite-zorder" "node tests/composite-zorder-test.mjs"

# ①(P-248 2026-10-07) 模型来源**区间读**：`registerModelSource` 只为读 `.mdl` 头部 512 B 的 material 路径，
#   旧路径 `getEntry()` 整条拷贝 ⇒ 245 MB 包里 156 MB/51 MB 的 mdl 一步就拷 212 MB（浏览器 OOM 直接原因之一）。
#   判据：合成包（2 MB 假 mdl）整条读=0 / 区间读=512 B；只有整条读的老宿主契约逐位不变；真包 8 mdls 共 4096 B。
add "model-source-range" "node tests/model-source-range-test.mjs"

# ①(P-250 2026-10-07) MDL 变体判别：语料 158 个 .mdl 里 **86 个是 48B 静态 PBR 布局**（pos3/nrm3/tangent4/uv2），
#   修前 42 个完全解析不了、40 个被误判成 80B 步长（垃圾网格）。判据：合成夹具（48 判定/蒙皮优先/不误报）
#   + 真语料全量对账（154/4、分支分布 80:74 / 48:75 / 52:5、"有 MDLS 绝不走 48"）。
add "mdl-variant-dispatch" "node tests/mdl-variant-dispatch-test.mjs"

# ①(P-257 2026-10-07) **3D 场景的真 4×4 通路**（官方相机 + 图层模型矩阵 + 天空盒跟随相机）：
#   `?modellayer=mesh` 此前在 3D 包（0923/3662790108：无正交矩形 + fov 50 + 73 个 mdl 层）上画黑 —— 本仓
#   mesh 程序是 puppet 的 2D 映射（P-255 只补了标量 camZ）。判据：纯函数（官方旋转/相机层优先/y 还原/
#   天空盒跟随/稳定排序）+ 真包（相机 = 相机层 #705 而非 scene.camera 快照 / 71 层原点在视锥内 / P-255 档反证）
#   + 源码接线（u_MVP3D 默认关、深度 depthMask(!skybox)、天空盒优先、?sky3d/?skyfirst 回退口）+ mock-GL 4 条。
add "mesh3d-camera" "node tests/mesh3d-camera-test.mjs"

# ①(P-261 2026-10-07) 测试台两条 MPKG 链路：①**扫描**（库根顶层散落 `.mpkg` —— 服务端那一半由
#   `bench-mpkg-items` 的 A1m + 变异 M4 端到端判；这里判纯前端 `planLocalScan`/`detectWallpaperKind`
add "pkg-id-encoding"    "node tests/pkg-id-encoding-test.mjs"   # P-262：`/pkg/<id>` 的 `+`/`%20`/非 ASCII 三形态兜底（`+` 形态曾恒 404 ⇒ 页面 `pkg HTTP 404` + 7s 无首帧）
add "pkg-root-fallback" "node tests/pkg-root-fallback-test.mjs"   # 真机 16:37：:8902 生效根 0923 / 包在 1004 ⇒ 库根不匹配也会 404；判候选库根回落（A1-A4）
add "shots-prune-complexity" "node tests/shots-prune-complexity-test.mjs"   # 台账 §1.1#20：shots 全局清理 O(n²)→O(n log n)（readdir 计数验证，策略不变）
add "elysia-firstframe"    "node tests/elysia-firstframe-test.mjs"   # 台账 §1.1#22：CPU 路(elysia)首帧上报（putImageData 之后 · 只报一次 · 出错不误报）
add "autoreport-toggle"   "node tests/autoreport-toggle-test.mjs"   # 台账 §1.1#19：?report=auto 的面板开关（运行时启停 + 读数 + 缺省不建定时器，F1-F7）
add "verdict-docs"        "node tests/verdict-docs-test.mjs"   # 判决书/核验文档存在性 + 关键结论（使"判决"受门禁保护）
add "pkg-name-corpus"     "node tests/pkg-name-corpus-test.mjs"   # ① 语料级：205 个真实包名分段编码往返无损（含空格 3 个、含 + 0 个）
add "camerashake-binding"  "node tests/scene-camerashake-binding-test.mjs"   # camerashake* 属性绑定形态 {user,value}（205 容器 8 处 enabled）
add "parallax-root-position" "node tests/parallax-root-position-test.mjs"   # 视差参考点取顶层祖先位置（官方 A4 同一 x22；语料 650 层/31 容器）；P-352 起**行为级**：内嵌子进程跑 parallax-root-ref 并要求它 17/0 + ≥3 组 MUTANT-RED-OK（原先那条"名字存在"的正则断言已删）
# ①(P-352 2026-10-12) 参考点**口径 + 两个"死回退位"**：P-309 的 `__parPosLegacy` 三元错位 ⇒ `?parpos=legacy`
#   从来没生效、反而 `?paroff=legacy` 会悄悄把参考点退回本层；`__parOffLegacy` 又只判"传没传"。
#   本档是**行为级**（真跑 renderScene + mock-GL 读层心位移）：静态参考项手算到 0.1px（−1232.0/+1168.0/+1408.0）、
#   幅度与参考点无关且严格正比 depth、门控回退位、真包逐层峰峰值 + 静态位移对照 + 4 组变异自证；17 断言；~2.5s
add "parallax-root-ref"     "node tests/parallax-root-ref-test.mjs"
add "mdla-attach-rhythm"     "node tests/mdla-attach-rhythm-test.mjs"   # 附件动画帧长来自 MDLA length（90 仅兜底；语料 104/107 条 length≠90）
add "bench-layer-panel"     "node tests/bench-layer-panel-test.mjs"   # 8902 图层开关：面板自适应 + 勾选态=文件语义 + __lnShown 强制显示（P-317）
add "pkg-parse-local"      "node tests/pkg-parse-local-test.mjs"     # 本仓自带包解析器 pkg-parse.mjs（克隆即可跑，不再依赖姊妹插件）
add "mip-rt-slot-default" "node tests/mip-rt-slot-default-test.mjs"   # _rt_MipMappedFrameBuffer 槽默认值绑定（官方 8 处声明；回退 ?miprt=legacy）
add "builtin-asset-tex"  "node tests/builtin-asset-texture-test.mjs"   # 官方包外内置素材（particle/halo*、util/white、beam_1）的程序化像素源：语义 RGB255/形状在 alpha + resolveTextureName 回落接线
add "tex-split-plane"    "node tests/tex-split-plane-test.mjs"   # P-264：format 5（DXT5 半分辨率）载荷是**平面分离**（前半全部 alpha 块、后半全部 color 块）⇒ 重排后天空 MAD 103.6→4.9、树丛1 114.6→13.8
add "fbo-format-vocab"   "node tests/fbo-format-vocabulary-test.mjs"   # §A #6：FBO `format` 词表现状基线（r8/rg88 真映射；其余只 declaredFormat 不改分配）+ ?fbodesc=legacy 回退口
add "material-pass-sem"  "node tests/material-pass-semantics-test.mjs"   # §A #7 改判证据：effect 级 passes 逐个构造（已执行）+ material 级保持 passes[0]
add "stage-varying"      "node tests/stage-varying-reconcile-test.mjs"   # §A #8：跨阶段 varying 对账（普通档一致 / legacy 档保持不一致 / 回退口有效）
add "parallax-clamp"     "node tests/parallax-clamp-test.mjs"   # §B #15：指针归一化夹取时机（缺省不夹=官方 §5.3；?parclamp=legacy 回旧 clamp）
add "scene-fov-override" "node tests/scene-fov-override-test.mjs"   # 官方 assets 对照：scene.json general.perspectiveoverridefov（妃咲 95.0）置 fovPick 链头；?fovoverride=legacy 回退
add "overlay-base-hint" "node tests/overlay-base-hint-test.mjs"   # 只读：「图片层全 copybackground + 有 preview」档判定（丛雨/逆流茶会命中；妃咲不命中）
add "overlay-base-inject" "node tests/overlay-base-inject-test.mjs"   # 语义修复：全叠加层档以包内 preview 作基底层；?overlaybase=legacy 回退（B1-B8）
add "overlay-base-host-wiring" "node tests/overlay-base-host-wiring-test.mjs"   # 宿主接线源码序：parseScene→段→__sceneLayers，回退位/封顶/纹理注册（C1-C7）
#   的"只含容器的目录逐容器成条"与"浏览器选文件也接受 .mpkg"）；②**装载**（`__wp.loadSceneFile(blob)`
#   从"明确降级的 no-op"变成真实现：IndexedDB 交接 + `?scenefile=1` 重载 + 取回即删；含假 IDB 往返判据）。
add "bench-local-mpkg-scan" "node tests/bench-local-mpkg-scan-test.mjs"

# ①(P-213 B1 2026-09-29) 2D 光照模型（RE-43 路径A）：light 层 schema 解析（不参与 draw）+ 纯函数
#   ComputeLightSpecular2D 分支表（衰减平方/intensity²/g_Light 混合/rim）+ 四灯 uniform 组（声明才上传）。
#   判据：真包+官方样例 schema 逐项 + 分支表 + 无灯零视觉差 + legacy + 2 变异。
add "scene-light-2d"      "node tests/scene-light-2d-test.mjs"

# ①(P-214 B2 2026-09-29) 场景雾（RE-51）：10 字段 → 2×vec4 + 2×vec3（声明才上传；无雾场景零视觉差）。
#   判据：逐分量（z/w 对调 ⇒ 红）+ ApplyFog/Alpha 数值 + 洁净室 common_fog.h + legacy + 2 变异。
add "scene-fog"           "node tests/scene-fog-test.mjs"

# ①(P-215 A3 2026-09-29) effect.json 的 command:"swap" 进枚举（RE-56；官方 fluidsimulation 尾部 swap×2）：
#   mid = 交换效果乒乓方向；尾部（afterpos≥pass 数）在最后一 pass 后生效（旧实现永不触发）；未知命令记日志。
#   判据：mock-GL 行为级（pass1 读 pass0 刚写出的缓冲 / 合成读 copy 缓冲 / 未知命令告警）+ 2 变异。
add "effect-command-swap" "node tests/effect-command-swap-test.mjs"

# ①(P-216 A5 2026-09-29) alphawriting ⇒ colorMask alpha 位（RE-45：enabled/default 写 alpha=现状逐位一致、
#   disabled 关 alpha 位=词表补齐；default 457 pass 不动是红线）。判据：mock-GL 行为级（disabled 关+恢复、
#   其余零 colorMask）+ 语料 cursorripple enabled 解析 + 2 变异（default 被改坏必红）。
add "alphawriting-mask"   "node tests/alphawriting-mask-test.mjs"

# ①(P-217 A8/A9 2026-09-29) 层级元数据按官方口径对齐（RE-49：nointerpolation⇒NEAREST、dependencies 排序
#   +环检测、locktransforms/spacing/ledsource 解析保留不丢字段）+ instanceoverride.brightness 乘子（RE-59，
#   0 与缺省区分）。判据：真包四件 + 合成排序/环 + mock-GL（NEAREST/乘子走效果链路径）+ 2 变异。
add "layer-metadata"      "node tests/layer-metadata-test.mjs"

# ①(P-218 F1 2026-09-29) g_MVPI / g_ModelViewProjectionMatrixInverse 按官方语义实现（RE-50"声明才赋值"；
#   旧实现恒单位阵）。判据：mat4Invert 纯函数（M·M⁻¹=I/奇异 null）+ mock-GL 声明即上传（自洽 INV·MVP=I、
#   真名+别名同值）+ legacy + 接线锚点 + 2 变异。
add "matrix-uniform-inverse" "node tests/matrix-uniform-inverse-test.mjs"

# ①(P-219 F2 2026-09-29) 文本 spacing：解析保留（P-217）+ 行为默认关（?spacing=on 才启用"字距/行距"，
#   官方语义未定案 RE-49）。判据：真包描述符 + 默认路径同形 + on 档逐字符推进（切片执行）+ 台账 + 1 变异。
add "text-spacing"        "node tests/text-spacing-test.mjs"

# ①(P-220 C1 2026-09-29) 脚本 API 最小集补齐（RE-57；规则 A：官方明文存在的 API 至少留接口，
#   别让作者脚本因 API 缺失整段崩）：addText(223 次)/changedUserProperties(233)/openUserShortcut(190)/
#   isObjectValid/isLandscape/isPortrait/playSingleAnimation。判据：真沙箱行为级 10 条 + 变异。
add "script-api-minimal-set" "node tests/script-api-minimal-set-test.mjs"

# ①(P-221 A6 2026-09-29) g_TextureNMipMapInfo(逐槽)/g_TextureReductionScale "声明即上传"（RE-52；规则 A）。
#   判据：纯公式（log2(max) 边界）+ mock-GL 声明即上传 + mipChainMissing 台账 + 官方 skew 声明面 + 变异。
add "fx-uniform-values"   "node tests/fx-uniform-values-test.mjs"

# ①(P-222 A12/A4/F5/F8/F9/B3① 2026-09-29) P2 接口/记账类合集：PKGM0012 魔数显式用例（mpkg-oldschool-scene
#   内）、FBO 同层同名碰撞台账、shape 层解析保留+?shape=on 提示档、controlpoint 位表视图、conditions
#   三态求值接口（unknown 不剔除）、级联换算+阴影分辨率纯函数。
add "p208-p2-interfaces"  "node tests/p208-p2-interfaces-test.mjs"

# ①(P-223 2026-09-30) g_TextureNResolution.zw = 内容（unpadded）尺寸（规则 A：官方 shader 明文消费
#   common_particles.h:69 `unpaddedWidth = .z/.x` 等 3 处；旧实现恒 (w,h,w,h)）。判据：官方数学读数
#   （format5 比率≈2.0）+ mock-GL 真值（4f 上传）+ 台账 paddedSlots + legacy 回退 + 逐位快照 + 变异。
add "texture-resolution-zw" "node tests/texture-resolution-zw-test.mjs"

# ①(P-224 2026-09-30) camerashake* 接口 + 默认关（规则 B：RE-36 更正版——噪声公式未解析，
#   valueNoise2D 只是近似建议）。判据：解析面台账 + 默认逐位快照（MVP hash）+ approx 档抖动非零 +
#   noiseModel='approx-not-official' 强制标注 + enabled 门控 + 变异（默认翻成开必红）。
add "camerashake-iface"   "node tests/camerashake-iface-test.mjs"

# ①(P-225 2026-09-30) 行为级"幽灵声音"收口（可 SKIP：无 pactl/Pulse 桥不建流 ⇒ 打印原因以 0 退出）：
#   无头 Firefox+真包（库通道 /pkg/<id>，gesture 轮询解锁）跑起来后 pactl sink-inputs 里 Nightly
#   的流必须不存在或全 0%/mute；反例臂（无三件套+同手势）有可听流 ⇒ 证判据分辨力，反例也无流 ⇒ SKIP。
add "gate-audio-silence"  "node tests/gate-audio-silence-test.mjs"

# ①(S1 2026-10-01) STATUS-ALL-ITEMS 唯一索引一致性（纯 Node <1s）：V1 每个 P-2xx 引用都有台账头
#   （插件侧编号按行内提交号判定）· V2 ✅ 行必须带判据文件/提交号 · V3 同物两态行 = 0 · V0 基线数字对仓。
add "status-consistency"  "node tests/status-consistency-test.mjs"

# ①(S3 2026-10-01) .tex-json 侧车字段支持（RE-47；规则 A）：clampuvs/nointerpolation 生效
#   （优先级 层>侧车>头，`?texjson=legacy` 忽略），nomip/forcerawcompression/format 解析+台账。
#   判据：官方 14 份侧车逐字段 + 优先级三组 case + format 词表 + legacy/零变化 + 变异（侧车盖层必红）。
add "tex-json-sidecar"    "node tests/tex-json-sidecar-test.mjs"

# ①(S4 2026-10-01) B3② 阴影矩阵接口（规则 B：接口先行默认关）：castshadow 层 ⇒ 点光 6/方向 3 矩阵
#   数组 + uniform 名表 + _rt_shadowAtlas RT 描述 + 级联换算/分辨率档；?shadows=force 走通路
#   （投影/采样未做，notImplemented 台账）。判据：真包 3589454154 双灯 + legacy null + 变异。
add "shadow-interface"    "node tests/shadow-interface-test.mjs"

# ①(S5 2026-10-01) F9 过滤接线：conditions 求值 false ⇒ 剔除 pass（官方宏求值器语义）、
#   unknown ⇒ 保留 + conditionsUnknown 台账（不猜）；无 conditions ⇒ 逐位 = 改动前（语料 0 命中）。
#   判据：合成包 3 pass（true/false/unknown）+ 台账 + 零变化快照 + 变异（unknown 当 false 必红）。
add "fx-conditions-filter" "node tests/fx-conditions-filter-test.mjs"

# ①(P-174 2026-09-24 主对话补登记) 层引用成员 × 五个面全表普查（官方 d.ts 60 成员 × 5 面 × 三档；缺一项点名成员+面）
#   + `ISoundLayer.volume`（落点 soundprops.volume、保作者节点、非有限值不落盘、五面同源=函数身份相等）+ byId/getParent 修复。
add "script-layer-ref-audit" "node tests/script-layer-ref-audit-test.mjs" "" "^SKIP script-layer-ref-audit"
add "hlsl2glsl-width-table" "node tests/hlsl2glsl-width-table-test.mjs"  # ①(P-115 2026-09-23) 上游**宽度表整族**（`vendor/hlsl2glsl/hlsl2glsl.js` 的 9 :644-673 / 9-3 :674-697 / 9a-2 :699-779，MIT）移植到**在跑的内联实现**（`core/we-scene-bundle.js:5687-5888`）的判据：A 10 组夹具（三条规则真阳性 + 缺 resolution uniform / 多内建 / 非采样器上下文 / 同名 float / 等宽边界 / **sibling 缺失**；真阳性都过 glslangValidator）+ B **真语料逐 shader sha256 对拍**（全语料 199 包 / 276 去重 shader；before 参考实现 = 单切片关掉宽度表的副本，并与 `git show HEAD:` 的移植前真源码**逐字节自证等价**；变化集 == 预期 4 条、0 回归、2 条新可编译）+ C 3 组变异自证（`MUTANT-RED-OK`，"期望红集 == 实际红集"）；43 断言、实测 ~34s、PeakRSS ~1.4GB（单包上限默认 1024MB，可用 `MPW_W9_MAX_MB` 收窄）、无浏览器 / 无网络 / 无 GPU；无语料 / 无包解析器时只有 B 段 SKIP、A+C 照判
# ①(P-198 2026-09-25 转译线) `hlsl2glsl-passfix`：差距矩阵 §6.2 四条"有画但整条效果 pass 被静默跳过"的缺口
#   （① color_grading varying 链接、② Simple_Audio_Bars `#define` 行尾注释、③ glitter_prepare 同①、④ phantomtransitionfx
#   文件级 const + `float == int`）。A 合成夹具（四条规则各自 legacy 报文复现 / 缺省 0 error + 5 条反向护栏）、
#   B 五个真包逐条对拍、C 语料对拍（**0 回归** + legacy 能编过的产物剥注释逐字节不变）、
#   D 变异自证（4 个回退口 + 4 组真源码切片变异 `MUTANT-RED-OK` 4/4）、E mock-GL 证明**渲染路径**真的对过账。
#   42 断言、实测 ~12s、无浏览器 / 无网络 / 无 GPU；无语料/无 glslangValidator 时对应段 SKIP 不红。
add "hlsl2glsl-passfix" "node tests/hlsl2glsl-passfix-test.mjs"
# ⑤(P-333 2026-10-12 转译线) `hlsl2glsl-intpromo`：**P-198 之后仍在跳的 pass**（同一族残余）——
#   "整数字面量在左的 `+ - * /`"（`1 - t` / `1 - pow(…)`：HLSL 有 int→float 隐式提升，GLSL ES 3.0 没有）。
#   A 合成夹具（legacy 报文复现 / 缺省 0 error + 9 条反向护栏：int 变量右操作数 / `int a, b;` 多声明符 /
#   注释正文 / 用户函数遮蔽内建名 / 幂等 / 计数 / **右操作数名字的前缀不许命中**（A8，宽度表判据当场抓出的 bug））、
#   B 两个真包（`0917/3299228616` perspective 全绿；`0917/3462491575` auto_sway 本族报文消失、**残余别的族如实打印**）、
#   C 语料对拍（**0 回归** + legacy 能编过的产物剥注释逐字节不变）、D 变异自证（回退口 + 真源码切片 `RED-IF-REVERTED` +
#   真树 sha256 不变）、E mock-GL 证明**渲染路径**送进 GL 的 frag 真的被浮点化、F 把源码里的内建名单整条抠出来
#   **逐名真编译**自证"无 int 重载"（对照组 abs/sign/min/max/clamp 有 int 重载）。
#   27 断言、实测 ~7s、无浏览器 / 无网络 / 无 GPU；无语料 / 无 glslangValidator 时对应段 SKIP 不红。
add "hlsl2glsl-intpromo" "node tests/hlsl2glsl-intpromo-test.mjs"
# ①(2026-10-12 内置效果线) `cuiliuti-builtin-fx`：上游 `oneincase/webwallgl`（**MIT**）的**编辑器内置效果**
#   「磁流体（cuiliuti）」移植（原作者 **Hope麻匪（HopeMafei）**、**0ran 收录**）—— 该效果不在任何包里（官方内置素材），
#   本仓把它内置进 core 的素材表（效果链**第三级**，`?cuiliuti=off` 可整条关掉）。
#   A `demo.html` 的 `MPW-FX-PANEL`/`MPW-FX-MOUNT` **真源码切片** + 静态锚点（三个读点同源 / `?cuiliuti=off` 两侧一致）；
#   B 面板（真切片 + **假 DOM**）：署名行（作者/收录者）/ 许可行 / 滑杆**数量·名字·范围·步长·缺省**逐条 == core 参数面
#     + **合成参数面**单一来源自证（手抄必红）+ 拖滑杆/取色回调 + `refresh()` 只改读数；
#   C **离线数值**（`tests/_glsl-cpu.mjs` 跑仓库里真实那份 frag 源）：上游 sha256 冻结回归锁（可选
#     `MPW_WWGL_EDITOR=<上游产物>` 逐字节对拍，缺产物 SKIP 不红）/ uniform↔参数面同源 / 默认档统计量区间 /
#     `alpha` 只缩 alpha 通道 / `liquid` 通道隔离 / `blobs` 单调 + `int()` 截断 / `speed` 时标 / 10 个滑杆逐个有落点；
#   D 接线（真 core + 合成 pkg）：三级链 **包内 → /weassist → 内置表**（前两级命中时不抢）+ `?cuiliuti=off` 逐位回退
#     + 实例形状 == scene.json + `key→material→uniform` 闭合 + **署名三处**（面板行 / effect.json description / 源码注释）；
#   E **10 组** `MUTANT-RED-OK`（空实现 shader / 参数写死 ×2 / **逻辑取反** / **core 参数面改 min-max·删一条** / 面板滑杆手抄成死表 / 范围写死 / 署名丢收录者 / README 行删掉）。
#   53 断言、实测 ~22s、无浏览器 / 无网络 / 无 GPU（`_glsl-cpu.mjs` 的离线数值是主要开销）。
add "cuiliuti-builtin-fx"  "node tests/cuiliuti-builtin-fx-test.mjs"
add "gyro-parallax"        "node tests/gyro-parallax-test.mjs"  # ①(用户 2026-09-24「移动端以陀螺仪实现鼠标视差」) demo.html 的 MPW-GYRO 段**真源码切片** + mock `window/deviceorientation` + 真 bundle/mock-GL 的视差读数（姿态 Δu=0.4 ⇒ 正深度层 Δx=−204.288px = 官方公式）+ 4 组变异自证 `MUTANT-RED-OK`；30 断言、实测 ~0.4s、无浏览器 / 无网络 / 无 GPU

# ①(P-179 2026-09-24 主对话补登记) issue #2/#3/#4 的根因判据（官方定义 + 合成场景，不等样本）：
#   fluidsimulation 官方 effect.json 的尾逗号 / clearBgFx 收窄是否够 / shake·foliageswag 位移量级 / 时钟 combo 可见性。
add "issue-fluidsim-3840" "node tests/issue-fluidsim-3840-test.mjs"
add "clock-combo-visible"  "node tests/clock-combo-visible-test.mjs"

# ①(P-177 2026-09-24 主对话登记) 官方随包 JSON 的宽容解析（尾逗号/注释）：官方 fluidsimulation/effect.json
#   自带尾逗号 ⇒ 严格 JSON.parse 会静默丢掉整条效果链（20 pass / 9 FBO）；页面与 bundle 的"读条目文本"解析点必须全走 parseWeJson。
add "we-json-tolerance"   "node tests/we-json-tolerance-test.mjs"
# ①(2026-09-24 收口线) 同一口径的**服务端 + elysia 入口**残留收口：`:8902` 的库项目录 project.json（包旁）与容器条目
#   project.json（包内）走 parseWeJson；elysia `makePkg().readJson`（pkg 条目）走 lib.parseWeJson；HTTP 请求体与宿主自有状态
#   （bench-props / web-store / web-replace）**保持严格**并带 `[we-json:strict|分类]` 标记（逐类计数反查）。真 HTTP 端到端 +
#   6 组变异自证（M1/M2/M6 改回去必红；M3/M4/M5 反向放宽必红，期望红集 == 实际红集）；21 断言、~9s、无浏览器/无网络。
add "we-json-tolerance-server" "node tests/we-json-tolerance-server-test.mjs"

# ①(2026-09-24 用户五条 + 追加 A1/A2/E) 8902 测试台的自证判据（纯 Node + 真 HTTP 为主，浏览器段 GL 前置可 SKIP）：
#   第1条 快捷根**全部推导**（库根/父目录/home/cwd/挂载点或盘符）且源码里 0 处本机绝对路径、第2条 选文件与选文件夹
#   同一棵服务端浏览树（同一份允许根，越界如实 403）、第3条① `paintLibSource` 真定义在模块作用域、② 切根**同页**
#   立刻生效（列表/来源/缩略图缓存击穿）、第4条 所有按 itemId 解析的路由走**唯一真源**（切根前后 /pkg 状态码+字节数）、
#   第5条 渲染器面**本地直供**（死上游照常出画 + X-Bench-Served 标记）、第6条 预览 `?shell=0` 无外壳 + 首帧黑幕、
#   A1 WE 自带项折叠分组、A2 音量条不越容器（含改前复现对照）、E 富文本同图跨行只画一遍（真语料 33→1）；
#   7 个**变异自证**（MUTANT-RED-OK：改回去必红，且红的正是被变异掉的那条）。
add "bench-dsh-libroot"  "node tests/bench-dsh-libroot-test.mjs"
add "bench-8901-sync"     "node tests/bench-8901-sync-test.mjs"        # :8901 部署树漂移检测的门禁化判据（索引 §1.2 #39 ✓）

# ①(2026-09-24 `.mpkg` 一等库项) 用户"壁纸都启动失败 / PKG HTTP404"的**根因那一半**：旧口径一个**目录**一条
#   （真实库布局 `wallpaperE/<角色>/<角色>_NN.mpkg` ⇒ 148 个 `.mpkg` 只看得见 20 条目录、`/pkg/<中文 id>` 连路由都进不去）。
#   判据：逐文件成项（嵌套 itemId = `<目录>/<文件名>`）+ 容器内类型判定（scene.json/video/index.html）+ **目录条不重复计数**
#   + `/pkg/<嵌套 id>` 200 且与 `stat` 等长 + `/api/mpkg`/缩略图/`/media/dev/**` 两种读法 + 越界仍被拒（`..`/绝对路径/软链逃逸）
#   + 超限如实 413（流式，不整包入内存）+ 真语料条件项（148 个 `.mpkg` 全成条、dd 22 条零回归）+ 4 组 MUTANT-RED-OK 变异自证。
add "bench-mpkg-items"   "node tests/bench-mpkg-items-test.mjs"

# ①(2026-09-24 可移植性审计修复线：`docs/PORTABILITY-AUDIT-20260924.md` 的**服务器文件之外**那一半) PA-52/34/36/44/45/09/37/31 的常驻判据：
#   候选表+存在性探测（core/scene-project-json）· KI 台账防腐烂（known-ledger-audit）· 门禁默认输入不许写死
#   内容哈希 · 发布面死豁免分支已删+写死本机路径必抓 · walk() 少扫必记账 · 裸 `/tmp/` 判据（8/8 存量站点读数）
#   · J13 断言语义化 · EYE_HACK 依据强度登记+可注入+记账。**每条都有 MUTANT-RED-OK 变异自证**（回退用
#   `git show HEAD:` 的真版本，不是手搓近似）；46 断言、~15s、纯 Node（无浏览器/无网络/无 GPU），不写仓库文件。
add "portability-fix"    "node tests/portability-audit-fix-test.mjs"
# ①(C0 批次3 2026-10-04) **层归因基建**：离线工具（合成桩件 + 真 parseScene/renderScene + mock GL，
#   schema 固定 + skipReason 枚举 + 设计/实绘矩形自洽 + 变异自证）20 断言、~3s、无浏览器/网络/GPU。
add "layer-attribution"  "node tests/layer-attribution.mjs --selftest"
# ①(C0 批次3 2026-10-04) **?ln=N 第二量法一致性**：真机 __mpwLayerLedger（实绘矩形台账）× 离线 mock-GL
#   归因，3 包对账（P1 台账⊆归因含 script-state 解释 / P1b composite 条目存在（C0 修复回归守卫：
#   mpwLedgerYDown 作用域错位曾让 composite 全灭）/ P2 矩形失配逐条归类 text-metrics|anim-phase|
#   mesh-pose|camera-scale|transparent-content，未解释才红 / P3 隔离=清屏色签名）。18 断言；
#   实测 ~3.5min、需 headed firefox（llvmpipe ~1fps，台账窗口 4s）；无 GL ⇒ 整档 SKIP + 原样读数。
#   产物读数落 reports/layer-attribution-consistency.json（§8 基线腿另用 --baseline，手动跑）。
add "ln-consistency"     "node tests/layer-attribution-consistency.mjs" "" "^SKIP "
# ①(C1 批次3 2026-10-04) **非 ASCII/非 UTF-8 资产名"引用↔索引"一致性**：A 段合成容器（生产 parsePkg/getEntry，
#   条目名含非法 UTF-8 字节走 decodeName 的 Latin-1 兜底）同形引用必命中、NFKC/大小写/U+FFFD 变体必不命中
#   （查找零规范化）+ demo 侧"缺 model/缺纹理"日志原文钉死；B 段四根语料对账（非 ASCII 引用 ~1418 条，
#   探针包 2887099508 的 24 条非 ASCII 条目必须全绿；miss/字体引用落 reports/nonascii-names-audit.json 登记）；
#   C 段变异自证（getEntry 改 NFKC 双侧规范化 ⇒ 变体被错误命中）。12 断言、实测 ~30s、纯 Node 无浏览器。
add "nonascii-names"     "node tests/nonascii-name-consistency-test.mjs"
# ①(C2 批次3 2026-10-04) **copybackground 语义**（P-230）：合成容器 + 真 parseScene/renderScene + mock GL +
#   真效果链——fx=0 的 copybg 层不换入（bind=solidcolor 纯色卡，官方 helper 语义只对有效果链的层存在）；
#   fx>0 换入喂链保留；探针包 #3 Solid rtcopy→solidcolor 交叉验证；变异自证（去掉 fx 门 ⇒ 必红）。
#   6 断言、~1s、纯 Node 无浏览器。真机 A/B 读数落 reports/copybg-ab.json。
add "copybg-semantics"   "node tests/copybg-semantics-test.mjs"
# ①(C3 批次3 2026-10-04) **内置 models/util/* 层语义**（P-231）：composelayer+fx = 效果载体（参与渲染，
#   `?composfx=legacy` 回退）；无 fx 的 composelayer/projectlayer/fullscreenlayer = 逻辑 helper（不画，
#   官方 RegisterLogicalImageLayer）。A 段桩件 4 类 + B 段四根语料扫描（594 个内置层，154 个受益面，
#   读数落 reports/builtin-models-audit.json）+ C 段变异自证。9 断言、~10s、纯 Node 无浏览器。
add "builtin-model-semantics" "node tests/builtin-model-semantics-test.mjs"
# ①(C10 批次3 2026-10-04) **上游产物直挂契约**（读数=直挂 mediaBase+src，非工具条档）：A 段静态契约
#   （产物 index.html 引用 renderer-*.js + bundle 含 11 个公开参数名 + /media/dev 双 200）+ B 段真机
#   参数表（fit x renderDpr => 画布口径/getQuality()/媒体请求，读数落 reports/upstream-params-2.1.0.json，
#   产物 = webwallgl 2.1.0 renderer-n-Rw_ZVc.js）+ C 段变异自证（URL 缺 mediaBase => 画布不出）。
#   13 断言、~40s、需 headed firefox。
add "upstream-direct-mount" "node tests/upstream-direct-mount-test.mjs"
# ①(C5 批次3 2026-10-04) **MDLA 坏帧审计**：生产解析+生产检测器的**独立重实现**逐位复现坏帧集合
#   （尾切∪精修 = detectBadAnimFrames 的分布规则：尾切 maxStep>30 连续尾缀 ≤17 帧 = 官方"结尾导出垃圾"；
#   精修 = sig 二阶差分 dev>max(10×dev中位,5) 的分布阈值——"阈值 5.0" 是下限档求值结果不是常量）。
#   探针包定案（左下1 bad=[0,1,2,3,25,26,27,28,29]、thr=5.00、回绕 184.7 vs 内部 12.3）+ fps 全 30
#   + 桩件（合成尾部垃圾+孤立尖峰仍被识别）+ 变异自证（中性化检测器 ⇒ 空）。10 断言、~5s、纯 Node。
add "mdla-corpus-audit" "node tests/mdla-corpus-audit-test.mjs"
# ①(C6 批次3 2026-10-04) **指针事件管线**（P-233）：官方 cursorHitTest → Enter/Leave/Move/Click/Down/Up
#   的落地——elysia dispatchScriptEvent 增 ownerFilter（只投命中层）；demo MPW-CURSOR 管线（canvas
#   pointerdown/up/click → 设计坐标 → 层矩形命中 → Vec3 事件 {worldPosition,localPosition,hitBox} →
#   派发；台账 __mpwCursorDispatch）。A 桩件（ownerFilter 单投 + 事件值流经 Vec3.subtract + 无过滤全体投递）
#   + B 探针包真机点击（命中含耳朵 + 脚本调用 ≥1）+ C 变异自证。6 断言、~1.5min、需 headed firefox。
add "cursor-dispatch" "node tests/cursor-dispatch-test.mjs"
# ①(C7 批次3 2026-10-04) **场景级 {user:…} 绑定落点**（P-234）：general.bloom={user:名,value:缺省}
#   ⇒ 用户属性直控后处理开关（此前 applyUserProperties 只走层绑定，场景级绑定无落点：面板/插件改属性
#   bloom 纹丝不动——真包 0923/2887099508 的 4 处场景级绑定之一）。A 桩件 5 断言（翻转/幂等/缺名/gated/
#   非对象形态）+ B 语料扫描（general 层级 {user:…} 绑定 28 处，落 reports/scene-user-bindings.json）
#   + B2 真机（属性翻 false ⇒ __mpwBloomInfo 变关闭态 offBecause=value-false）+ C 变异自证。
#   8 断言、~1.5min（真机腿需 headed firefox）、离线段纯 Node。
add "scene-user-bindings" "node tests/scene-user-bindings-test.mjs"
# ①(C9 批次3 2026-10-04) **音频面钉死**：场景音频 opt-in（?audio=1）+ 手势门控 + 0 尺寸层不剪枝 +
#   volume 三形态取值序——真机探针（探针包 13 个 sound 层）：A 缺省 ⇒ 播放器 0（opt-in）；E ?audio=1
#   无手势 ⇒ silent=true 元素全暂停（门控承重）；B 手势后 elsCreated=13/attaches=13/<audio> 13 个全
#   出声中（13/13，含 11 个 scale=0 的"只出声不出画"层）；D 音量全合法。6 断言、~2.5min、需 headed
#   firefox。C9④ 音频条属性响应（帧差=动画噪声，需读层可见性状态的精确量法）登记下批。
add "audio-scene-players" "node tests/audio-scene-players-test.mjs"

# ②(P-228l 2026-10-05) **属性动画语义**：`core/we-animation.mjs`（唯一实现处）+ 渲染写回 + 脚本门面。
#   改动前只有"半套"语义：`extractAnimKf(fps=30)` 帧率硬编码 + `animValueAt()` 恒定循环，且只接了
#   origin/scale/visible —— `alpha`（语料最常见载体）一格没接（带 alpha 动画的层一律按静态 1 画 =
#   永久可见）。现按官方语义：options.{fps,length,mode,startpaused} + relative + 联动组 + alpha 载体；
#   `?anim=legacy` 逐位回退。语料读数：213 条轨道（startpaused 90、fps≠30 56；65 条 alpha 里 46 条
#   挂载瞬间的值会变）。72 断言、~25s、纯 Node（真包/语料缺席时对应组 SKIP）。
add "anim-semantics" "node tests/anim-semantics-test.mjs"
add "empty-state-no-black" "node tests/empty-state-no-black-test.mjs"   # ②(P-345 2026-10-13 语义纠正) 「没有壁纸」= 合法空态（不提示/不全屏黑/不吞指针/底中性或透明）+ 只有「选了但取不到」才显示可关闭的诊断卡片 + 旧 :8899 渲染器落点迁移（回退位 sceneBaseLegacy=true）：30 断言 + 12 组变异自证，纯 Node ~1s
add "clear-wallpaper-clean" "node tests/clear-wallpaper-clean-test.mjs"   # ②(P-346 2026-10-13) 「清除壁纸」必须清干净：15 个身份字段两处存储全清 + 持久墓碑防"另一处残留旧源被搬回来" + 清除后不再探/不再加载渲染器页 + 无关设置逐字节不变 + 清空后还能选上（墓碑不压新壁纸）：24 断言 + 5 组变异自证，纯 Node（真 lib/client.js 在桩 DOM 里跑）~3s
add "pause-refresh-preserve" "node tests/pause-refresh-preserve-test.mjs"   # ②(P-347 2026-10-13) video 档「暂停 + 刷新」必须保住壁纸（task-22 归因：task-21 的墓碑作废判据只看 image/webUrl，而视频 MPKG 是"先写身份、后补 image" ⇒ 身份被吃）：身份逐字节保留 / converted 仍 mp4 / 暂停意图仍持久化 / 过期墓碑不算数 / 绝不写空 img.src：17 断言 + 5 组变异自证，纯 Node ~5s

# —— --list ——
if [ "$LIST" = 1 ]; then
  echo "共 ${#NAMES[@]} 项（slow=--fast 跳过；条件项=无数据自动 SKIP）："
  for i in "${!NAMES[@]}"; do
    tag=""
    [ -n "${SLOWPAT[$i]}" ] && tag="$tag slow"
    [ -n "${SKIPPAT[$i]}" ] && tag="$tag 条件项"
    echo "  ${NAMES[$i]}$tag"
  done
  exit 0
fi

# —— --only 过滤（保留选中项的 slow/条件项属性）——
if [ "${#ONLY[@]}" -gt 0 ]; then
  declare -a FNAMES FCMDS FSLOWPAT FSKIPPAT
  for want in "${ONLY[@]}"; do
    hit=-1
    for i in "${!NAMES[@]}"; do [ "${NAMES[$i]}" = "$want" ] && hit=$i; done
    if [ "$hit" = -1 ]; then echo "未知测试项：$want（可用项见 --list）"; exit 2; fi
    FNAMES+=("${NAMES[$hit]}"); FCMDS+=("${CMDS[$hit]}"); FSLOWPAT+=("${SLOWPAT[$hit]}"); FSKIPPAT+=("${SKIPPAT[$hit]}")
  done
  NAMES=("${FNAMES[@]}"); CMDS=("${FCMDS[@]}"); SLOWPAT=("${FSLOWPAT[@]}"); SKIPPAT=("${FSKIPPAT[@]}")
fi

PASS=0; FAIL=0; SKIP=0
declare -a RESULTS FAILNAMES
# ①(P-70 2026-09-15) **门禁互斥锁**：两个 run-all-tests 并发跑会互相抢 CPU/swap，把
#   `visual-diff-kal`（整条门禁里偶发挂到 600s 超时、单独跑 1.1s）、`time-variation`、
#   `package-matrix` 拖成**假红**，并共享 /tmp 临时产物互相踩。实证：本轮 P-64/P-65/P-67/P-68
#   四个会话各遇到一次，每次单独复跑都绿。
#
# ②(2026-09-18 **统一锁协议**) 这里原来用 `mkdir /tmp/.mpw-gate.lock`，而同一天定下的"重活互斥"
#   协议是 `exec 9>/tmp/.mpw-gate.lock; flock 9` —— **同一路径两种语义**：路径上只要留了一个普通文件
#   （flock 留下的），mkdir 永远失败，而陈旧回收只认目录 ⇒ 门禁白等 20 分钟然后 exit 1
#   （真机两次：两个并行 agent 各撞一次，其中一次把本脚本的等待进程卡死）。
#   现在统一成 **flock 同一个锁文件**：拿不到就等（最多 20 分钟），空文件/陈旧文件都不会再造成死锁；
#   本脚本自己持锁 ⇒ 调用方**不要**再在外面套一层 flock（否则会自己等自己）。
LOCKFILE=/tmp/.mpw-gate.lock
if [ "${MPW_GATE_NOLOCK:-0}" != "1" ]; then
  exec 9>"$LOCKFILE" || { echo "✗ 无法打开锁文件 $LOCKFILE" >&2; exit 1; }
  if ! flock -n 9; then
    echo "⏳ 另一个重活在跑（flock $LOCKFILE）—— 等待它结束（最多 20 分钟；MPW_GATE_NOLOCK=1 可跳过）"
    if ! flock -w 1200 9; then echo "✗ 等待超时（20 分钟），另一个重活仍未结束" >&2; exit 1; fi
    echo "✓ 拿到锁，开始跑门禁"
  fi
fi
LASTLOG=/tmp/run-all-tests-last.log
# ①(P-70) 每次运行一个**唯一**的临时目录：`visual-diff-kal` 等的 --out 不再写死 /tmp/vd，
#   避免并发时互相覆盖产物（即便有锁，手工跑单项也可能并发）。
RUNID="$$-$(date +%s)"
RUNTMP="${TMPDIR:-/tmp}/mpw-gate-$RUNID"
mkdir -p "$RUNTMP"
# ①(P-70 修正) **必须真的导出**：`add` 里写的是 `${MPW_VD_OUT:-/tmp/vd}`，若这里不导出，
#   展开就永远回落到共享的 /tmp/vd —— 即"唯一临时目录"形同虚设（我第一版漏了这行，已补）。
export MPW_VD_OUT="$RUNTMP/vd"
LASTLOG_RUN="$RUNTMP/last.log"
ITEM_TIMEOUT="${ITEM_TIMEOUT:-600}"
: > "$LASTLOG"; : > "$LASTLOG_RUN"

for i in "${!NAMES[@]}"; do
  name="${NAMES[$i]}"; cmd="${CMDS[$i]}"
  # --fast：跳过标记为 slow 的项
  if [ "$FAST" = 1 ] && [ -n "${SLOWPAT[$i]}" ]; then
    RESULTS+=("SKIP"); SKIP=$((SKIP+1)); continue
  fi
  t0=$(date +%s.%N)
  # 输出写临时文件而不是 out=$(...)：$(...) 要求读到 EOF 才返回，若某项泄漏了继承管道写端的子进程，
  # runner 会永远阻塞在 pipe_read（整条门禁静默挂死，无任何输出）。写文件只等直接子进程，泄漏不影响。
  # 同时给单项加超时（timeout 默认按进程组回收），把"挂死"降级为"该项 FAIL + 明确报超时"。
  ITEMLOG=$(mktemp)
  rc=0
  LIBROOT_BEFORE="$(bench_lib_root)"; bench_lib_reset
  timeout -k 5 "$ITEM_TIMEOUT" bash -c "$cmd" > "$ITEMLOG" 2>&1 || rc=$?
  LIBROOT_AFTER="$(bench_lib_root)"
  if [ -n "$LIBROOT_BEFORE" ] && [ "$LIBROOT_BEFORE" != "$LIBROOT_AFTER" ]; then
    echo "[gate] ⚠ 库根被本项改动：${LIBROOT_BEFORE:-?} → ${LIBROOT_AFTER:-?}（已在下项跑前复位）" >> "$ITEMLOG"
  fi
  t1=$(date +%s.%N); ms=$(echo "($t1-$t0)*1000" | bc 2>/dev/null | cut -d. -f1)
  if [ "$rc" -eq 0 ]; then
    # 条件项：退出 0 但输出匹配 SKIP 模式 → 计 SKIP（无数据不红）
    #  ②(2026-09-25 门禁完整性) 加一条**通用口径**（本文件第 10 行早就承诺的那条）：工具自己打印
    #    `SKIP <本项名>` 且退出 0 ⇒ 按 SKIP 计。此前只认**注册过的** SKIPPAT ⇒ 11 个没登记模式的项
    #    自跳时被记成 PASS（实证：`/tmp/mpw-gate-23305-*/last.log` 里同一项同时有
    #    `== PASS multi-sprite` 与 `SKIP multi-sprite —— 回归资产定位不到`）—— 覆盖悄悄消失而门禁全绿。
    #    只认"行首 SKIP + **本项名**"，不认子段跳过（`logGLSkip` 打的是 `SKIP <段名>`）⇒ 不误伤。
    if { [ -n "${SKIPPAT[$i]}" ] && head -3 "$ITEMLOG" | grep -qE "${SKIPPAT[$i]}"; } \
       || head -3 "$ITEMLOG" | grep -qE "^SKIP[[:space:]]+${name}([[:space:]]|$)"; then
      echo "SKIP $name (无数据，条件项)"
      RESULTS+=("SKIP"); SKIP=$((SKIP+1))
      echo "== SKIP $name" >> "$LASTLOG"; tail -3 "$ITEMLOG" >> "$LASTLOG"
    else
      echo "PASS $name (${ms}ms)"
      RESULTS+=("PASS"); PASS=$((PASS+1))
      echo "== PASS $name" >> "$LASTLOG"; tail -3 "$ITEMLOG" >> "$LASTLOG"
    fi
  else
    if [ "$rc" -eq 124 ]; then
      echo "FAIL $name (${ms}ms) — 超时 ${ITEM_TIMEOUT}s 被中止（可用 ITEM_TIMEOUT=<秒> 放宽）"
    else
      echo "FAIL $name (${ms}ms) — 退出码 $rc"
    fi
    RESULTS+=("FAIL"); FAIL=$((FAIL+1)); FAILNAMES+=("$name")
    echo "== FAIL $name (rc=$rc)" >> "$LASTLOG"; tail -20 "$ITEMLOG" >> "$LASTLOG"
    # ①(2026-09-21) 失败项留**完整**输出到本次运行目录：只留 tail -20 时，失败断言若不在末尾
    #   （例如 T 组在 P/G/N 组之前）就会被裁掉，事后只能猜"哪一条红的"（本轮实测踩到）。
    cp -f "$ITEMLOG" "$RUNTMP/fail-$name.log" 2>/dev/null || true
  fi
  rm -f "$ITEMLOG"
done

echo "══ 汇总：PASS=$PASS FAIL=$FAIL SKIP=$SKIP / 总 ${#NAMES[@]} 项"
# ①(P-70) 本次运行的独立日志副本（并发行排障用；共享 LASTLOG 仍保留给既有习惯/文档）
cp -f "$LASTLOG" "$LASTLOG_RUN" 2>/dev/null || true
echo "（本次运行产物：$RUNTMP ；日志副本：$LASTLOG_RUN）"
if [ "$FAIL" -gt 0 ]; then
  echo "失败项（最后 20 行见 $LASTLOG）："
  for n in "${FAILNAMES[@]}"; do echo "  ✗ $n（完整输出：$RUNTMP/fail-$n.log）"; done
fi
if [ "$JSON" = 1 ]; then
  printf '{"pass":%d,"fail":%d,"skip":%d,"results":[' "$PASS" "$FAIL" "$SKIP"
  for i in "${!NAMES[@]}"; do
    printf '%s{"name":"%s","status":"%s"}' "$([ $i -gt 0 ] && echo ,)" "${NAMES[$i]}" "${RESULTS[$i]}"
  done
  printf ']}\n'
fi
[ "$FAIL" -eq 0 ] && exit 0 || exit 1

# 参照来源许可声明：本文件提到的 wer-ref/ 是第三方参考实现
# （Aromatic05/wallpaper-engine-renderer，GPL-2.0-only，非 WE 官方代码、非"真值源"），
# 与本项目（GPL-3.0-or-later）许可不兼容 —— 仅用于行为对照，不得复制代码/注释/常量组织。
# we-layerd-ref/（Aromatic05/we-layerd）无任何许可（保留所有权利），同样仅行为对照。
# 血缘自查结论见 docs/WER-REF-LICENSE-AUDIT.md。
