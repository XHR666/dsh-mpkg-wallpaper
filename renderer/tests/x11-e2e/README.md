# tests/x11-e2e —— 真 X11 自动化（"能自己做的简单测试"边界）

> ①2026-09-19 用户：「你有一个 Linux computer use 的插件，看看能不能结合 X11 自己做一些简单的测试，
> 但是一些需要细节的观看的任务就告诉我」。这个目录就是那条线的落点。
>
> **一句话**：能在**数字上判定**的都自动化（事件到没到、方向对不对、开关关掉有没有变化、像素差多少），
> **要看画面好不好看/像不像原版**的一律交给人眼 —— 并把图放在一个固定目录里给你看，
> 而不是让模型"描述"一张它没真正看清的图。

---

## 1. 环境（本机实测，`DISPLAY=:0`，1920×1200，**无窗口管理器、无 GNOME、无 AT-SPI**）

| 组件 | 状态 | 用途 |
|---|---|---|
| X 服务器 `:0` | ✅ `xdotool getdisplaygeometry` → `1920 1200` | 真窗口 + 真指针事件 |
| `xdotool` | ✅ | **纯移动**指针（`mousemove --sync`）与读回位置 |
| `scrot` | ✅ | 桌面截图（唯一像素证据来源） |
| `python3` + PIL 12.3.0 | ✅ | 像素分析（`analyze.py`） |
| Playwright + firefox-1538 | ✅ 在**姊妹仓** `dsh-mpkg-wallpaper/node_modules` | headed 起浏览器（本机唯一能出 WebGL2 的组合：软件 llvmpipe，~1 fps） |
| `computer-use-linux` | ❌ **本机跑不起来**（见 §4） | 原本想用它做 click/type/screenshot |

> ⚠ 起浏览器一律**主对话串行、单实例、`try/finally` 关闭**（本仓库老规矩：并行开两个 headed 浏览器会把
> 软件 WebGL 拖死，且残留进程会占着 X）。跑完自查：`ps -eo args | grep [f]irefox` 应为空。

## 2. 现在自动化了什么

| 脚本 | 断言 | 耗时（本机） |
|---|---|---|
| `bench-click-test.mjs` | **真 X11 点击**测统一测试台（`:8902`）：①目标在视口内且 `elementFromPoint` 命中它自己（**未被遮挡**）；②真点击壁纸标签 ⇒ 换壁纸（活动标签/iframe `src` 变了、日志出现 `mountScene`/`pkg body`）；③`Mouse trail` 默认**被门控**（`disabled + data-gated`，提示先开 `Pointer inject`）⇒ 勾上注入后解锁、可翻转、再点回原状；④舞台区桌面像素真的变了；⑤整轮 0 pageerror | ~2 min（**22 断言**） |
| `pointer-live-test.mjs` | **指针链路真机对拍**：①X11 真事件到达画布；②鼠标下移 ⇒ 画布 `cy` 增大、上移 ⇒ 减小（**垂直反了就会红**）；③移到画布最远端仍收得到；④移出窗口有 leave/out 或边界如实记录 | ~1.5 min（含起浏览器 + 5 张截图） |
| `cua.mjs` | 底座（不是测试）：`shot()` / `pointerTo()` / `pointerGlide()` / `pointerNow()` + 一个**最小 MCP 客户端**（给 `computer-use-linux` 用，本机跑不起来但代码留在位） | — |
| `analyze.py` | 像素取证：`info` / `count`（亮度阈值计数）/ `centroid`（亮斑质心）/ `mask`（**颜色规则**计数+质心：warm/pinkish/redish/bright/notblue）/ `diff`（两图差异数、变化质心、包围盒）/ `profile`（沿轴直方图，找竖条纹/缝隙用） | 每张 ~0.3–2 s |

运行：

```bash
cd <repo>
node tests/x11-e2e/pointer-live-test.mjs                 # 默认 dd/3326873240（"Trails 2" 层 = pointer 锁定拖尾）
node tests/x11-e2e/pointer-live-test.mjs --cursor=off    # 对照档（指针类发射器整体关）
MPW_X11_SHOTS=/tmp/shots node tests/x11-e2e/pointer-live-test.mjs
```

**截图落在** `$MPW_ROOT/reports/x11-shots/<时间戳>-id<id>/`（`MPW_X11_SHOTS` 可覆盖）——
01…05 五张对应五个阶段：窗口外 / 画布中心 / 下移 120px / 上移 240px / 最远角 / 移出窗口。

## 3. **需要你（人）看的**，以及为什么不能自动判

| 要看的东西 | 为什么自动化判不了 | 你去哪看 |
|---|---|---|
| **鼠标拖尾**像不像原版（有没有该有的彗尾、是不是"只有一个小球"、抖不抖、移远了会不会断） | "像不像"没有可判定的真值；能量出来的只有"画布上亮像素多了/少了"（本机软件渲染 ~1 fps，粒子的**时序**根本跑不足帧） | `reports/x11-shots/*/01…05*.png`（就是我跑测试留下的图） |
| **层 21「落花」竖条纹/缝隙** | 条纹间距、有没有缝是**形态**问题；`analyze.py profile` 能给出"每列亮像素计数"这种数字，但"这算不算缝"要你看 | 同上；需要时我用 `profile` 出一份列直方图给你 |
| **层 18「雾2」** | 同上（雾是低频噪声，肉眼比数字敏感） | 同上 |
| **Kaltsit 眨眼遮挡**（下眼睑是不是一条带、眼睛有没有在下面又冒出来） | 需要"看动画的连续几帧"；本机 1 fps 抓不到眨眼那 100ms | 真机（你自己的设备）——本机只能给静止截图 |
| **视频壁纸左侧 1/4 反相**（第 6 个壁纸） | 这条**可以**做数字判据（跟源视频同帧比相关性），但需要先确认是哪个包 + 有时间轴对齐的视频源 | 见 §5 待办 |

> 我不"描述"截图内容：那样等于编。要判断画面，我把图放到上表那个固定目录，你直接看。

## 4. `computer-use-linux` 为什么没用上（结论 + 证据）

用户指的插件：`https://github.com/agent-sh/computer-use-linux`（Rust MCP server + CLI，MIT）。

装了三遍，都卡在同一处：

```
$ npm install -g @agent-sh/computer-use-linux        # 0.7.0：wrapper 装上了，但 postinstall 被 npm 的
                                                     # allow-scripts 策略拦住 ⇒ **二进制没下载**
$ curl -L .../releases/latest/download/computer-use-linux-aarch64-unknown-linux-gnu   # 7.3 MB，sha256 校验"成功"
$ ~/.local/bin/computer-use-linux --version
~/.local/bin/computer-use-linux: /lib/aarch64-linux-gnu/libc.so.6:
  version `GLIBC_2.39' not found (required by ~/.local/bin/computer-use-linux)
$ ldd --version | head -1
ldd (Ubuntu GLIBC 2.35-0ubuntu3.13) 2.35
```

- 上游 release 只有 `*-unknown-linux-gnu`（**没有 musl 静态构建**），CI 是拿 glibc ≥2.39 的 runner 编的；
- 往回试到 **v0.3.1（2026-07-03）** 仍是 `GLIBC_2.39` ⇒ 不是版本问题；
- 从源码 `cargo install` 需要 Rust（本机没有）+ 一堆桌面 dev 头文件，而且**即使编出来**，本机是"裸 X、无 WM、无 AT-SPI、无 portal"，
  `list_windows` / `activate_window` / AT-SPI 语义选择器这些主力工具都会降级不可用。

⇒ 所以本目录走**它自己也走的那条 X11 路**：`xdotool`（插件的 X11 坐标点击本来就是
`xdotool mousemove -- X Y click --repeat N BUTTON`，见其 README「Native X11 coordinate clicks」）。
`cua.mjs` 里那个最小 MCP 客户端保留着：等哪天有 glibc ≥2.39 或上游出 musl 构建，`openCua()` 就能直接接上。

## 5. 待办（明确没做，别当做了）

0. **"花瓣跟不跟手"的像素判据 —— 试过了，暂不可靠（实测记录，省得下一个人重踩）**：
   在 `?id=3326873240`（尾迹层 = `trail_1.json`）的五张截图上用 `mask` 的四种颜色规则量过：
   `warm`/`pinkish`/`redish` 三档在**整个画布**上给出的匹配数在"指针在窗口外"与"指针在画布中心"两张图上**完全相同**
   （1316 / 1451 / 2741，质心也一样）⇒ 这个壁纸的尾迹花瓣**不是暖色**，那三档量到的是**别的东西**；
   而唯一随指针变化的一处是 `04-moved-far-corner` 里光标框内的 **984 像素**（三种规则都命中、质心 (282.5,312.5) 恰好一个矩形）
   —— 那是**属性面板控件的 hover 高亮**，不是粒子（984 = 41×24）。
   ⇒ 结论：① 像素矩形必须**避开左侧属性面板**（1280 宽时面板占 x<~460；用命中测试挑可用区）；
   ② 要自动判"跟手"，正确做法是 **`?cursor=off` 同路径 A/B + 扣掉视频运动基线**，不是找颜色。
   在那之前，这条归"人眼看"。
1. **`computer-use-linux` 的 MCP 客户端未经真机联调**（本机起不来）—— 只做过协议层书写，没有一次成功握手。
2. **视频壁纸反相的自动对拍**：思路已定（同一时刻截图 vs `ffmpeg` 从源 mp4 抽帧，比较左 1/4 与其余区域的相关性，
   反相区会出现负相关），但要先确认是哪个包、时间轴怎么对齐；`analyze.py` 目前只到"亮度/差异/直方图"。
3. **眨眼/动画细节**：1 fps 抓不到，需要真机或"逐帧喂时间"的离线渲染（`elysia` 侧可注入 `time`，那是另一条线）。
4. 只跑过 `:8899` 的渲染器页；`demo/index.html`（测试台）与 `:8902` 统一台还没接进来。

## 6. 真机点击这条线顺手挖出来的两件事（都不是测试自身的问题）

1. **测试台 `:8902` 的 `Mouse trail` 不是"点不动"，是"故意门控"**：`#trail-box` 默认
   `disabled` + `data-gated` + `title="Enable “Pointer injection” first"`；必须先勾 `Pointer inject`
   （`#pointer-push`）它才解锁，之后才可勾选；关掉注入它立刻回到置灰。测试把这条**行为契约**钉成了断言
   （点两次回到原状，防止"点几次能重复打开"那类 bug）。
   —— 这也是排查"用户说鼠标尾迹没反应"时必须先问的一句：**注入开关开了没有**。
2. **真点击会被"忙"吞掉一次**：紧跟 62 MB 包挂载之后的第一次真点击（事件到了）状态没变，重试一次即生效。
   所以本目录的点击一律走 `clickUntil()`：**点后轮询到状态真变**为止，轮询超时才判失败——不 sleep 一下就当成功。

## 7. `select-live` 为什么不在默认门禁里（2026-09-19 实测）

`select-live-test.mjs`（自绘下拉的真机验证 + **渲染器页真机冒烟**）单跑 **5–8 分钟**（渲染器页在软件 WebGL 下约 1fps，
每次 `page.evaluate` 都要等主线程空出来；scrot 截图与真点击重试又各占几秒），而门禁的单项超时是 **600s**（`ITEM_TIMEOUT`）
⇒ 机器一忙就超时误红（实测发生过一次：`FAIL select-live (600440ms) — 超时`）。所以它**登记在案但不进默认 `add` 列表**：

```bash
node tests/x11-e2e/select-live-test.mjs            # 默认：S0 冒烟 + S1~S6/S8（跳过贴底上翻探测）
node tests/x11-e2e/select-live-test.mjs --flips    # 额外做 S7（每次开合很贵，只探前两个下拉）
```

它额外提供的是"**整页白屏**会红"（S0：module 启动 + `__mpwCap().ok` + 真出帧）与"属性面板里那个 combo 真机可点"；
前者在 2026-09-19 抓到过一个真实 P0（`objById` 作用域 ⇒ `ReferenceError` ⇒ 白屏），后者在工具条那条链之外补了面板那一面。
日常默认门禁由 `mpw-select`（58 断言、无浏览器）、`bench-click`（25 断言、真点击、~2min）、`x11-pointer`（7 断言、60s）覆盖同类判据。
