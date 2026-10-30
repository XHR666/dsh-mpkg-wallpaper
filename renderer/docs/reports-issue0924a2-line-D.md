# ISSUE0924A2 · 渲染器「效果链编译失败」线（D 线）报告

- 范围：`0.5.8` 渲染器（`core/we-scene-bundle.js`）+ 渲染器页装载层（`demo.html`）+ 判据（`tests/*`）
- 改前基线：**`a3bb009d2b567dcbd080c67f516432c783e196f3`**（下称 HEAD）
- 本机复现环境：`:8902/webloader/?id=…&audit=1`，Firefox + `llvmpipe`（WebGL2 ✓），真机同款页面/服务器路径
- 真编译器：`/usr/bin/glslangValidator`（本机可用 ⇒ 本报告的编译类判据是**真编译档**，不是纯文本档）
- 一句话结论：**官方效果 shader 的 `#include "common.h"` 从来没被拼进去过** —— 页面把 URL 拼成 `/common.h`（宿主静态面 404），
  取回的空串又被当成"取到了"缓存，`preprocess()` 于是把 include 展开成**空**，`M_PI_2`/`rotateVec2` 整批符号消失 ⇒
  编译期 `undeclared identifier` ⇒「跳过编译失败的 pass」⇒ 整条效果链 `break` ⇒ 该层退化。
  根因三处 + 顺带发现的 1 处 h2g 缺陷（HLSL 采样坐标隐式截断）都已修，并新增"改回去必红"的判据。

---

## 1. 现象与复现（本机，llvmpipe 也给编译错误 —— 编译期与驱动无关）

命令（**同一把文件锁**，跑完 `reset` 库根）：

```bash
curl -s -X POST http://127.0.0.1:8902/api/library-dir -H 'content-type: application/json' -d '{"dir":"<工作区>/allwallpaper/0923"}'
flock /tmp/.mpw-firefox.lock -c 'node /tmp/mpw-e2e-net.mjs 2887099508'      # 探针：请求台账 + #log 里的失败行
curl -s -X POST http://127.0.0.1:8902/api/library-dir -H 'content-type: application/json' -d '{"reset":true}'
```

**改前（把 HEAD 版 `demo.html`/`core/we-scene-bundle.js` 原样放回，其余不动）**：

```
请求台账:      404 /common.h        404 /common_perspective.h
#log: 跳过编译失败的 pass "effects/shake":        shader=effects/shake        着色器编译失败: ERROR: 0:42: 'M_PI_2' : undeclared identifier
#log: 跳过编译失败的 pass "effects/foliagesway":  shader=effects/foliagesway  着色器编译失败: ERROR: 0:50: 'rotateVec2' : no matching overloaded function found
#log: 跳过编译失败的 pass "effects/shake":        … ERROR: 0:36: 'M_PI_2' : undeclared identifier
#log: 跳过编译失败的 pass "effects/waterripple":  … ERROR: 0:46: 'rotateVec2' : no matching overloaded function found
```

与用户真机日志的**行号逐号一致**（`0:42` / `0:50`）。用户报的 4/5/8 三条同一根因；本机还多出 `waterripple` / `shake` 另一 combo 两条同类。

**改后（同一 URL、同一探针脚本）**：

```
请求台账:      200 /shaders/common.h        200 /shaders/common_perspective.h
#log: 跳过编译失败的 pass: 0 条（着色器编译失败 0 条、公共头文件告警 0 条）
fxStats: 19 个带效果的层里 16 个 passes ≥ 1 且 fallback=null（0 个 fxFail）
         余下 3 个的 passes=0 各有既有解释：Fern#163 是 degenerateFbo(1×1507)、
         支持 Tim#492/记事本#326 是 bypassAll（transparent / 3×3 空内容）
```

### 行号是怎么对上的（离线段，可复核）

对真包 `0923/2887099508/scene.pkg` 的 `shaders/effects/shake.frag`、`shaders/effects/foliagesway.vert`
走生产拼装，把 include 解析成空串后 `hlsl2glsl` 的产物里：`M_PI_2` 落在第 **42** 行、`rotateVec2` 落在第 **50** 行
（`tests/effect-prelude-common-test.mjs` E5/E6 与 `glslangValidator` 逐条打印）。
⇒ 真机那两条报文对应的就是"include 展开为空"这一个状态，**不是**别的源码形态。

---

## 2. 根因（逐条 file:line）

### 2.1 主因：取头文件的 URL 打到了 404 路径

- `demo.html:2101`（HEAD）：`const url = '/' + name.replace('shaders/', '');` ⇒ `shaders/common.h` 变成 **`/common.h`**。
- 宿主路由事实（本机实测，就在 `:8902`）：
  - `/common.h` → **404**（body：`{ "ok": false, "error": "静态文件不存在：/common.h"}`）——**静态面先命中**，请求根本到不了渲染器的 `HEADER_FILES` 分支；
  - `/shaders/common.h` → **200 / 4215B**（本仓自研头，`server/we-scene-demo-server.mjs:839-851` 那条 `p.startsWith('/shaders/')` 分支）；
  - `/weassist/shaders/common.h` → **200 / 945B**（官方头，与 `wallpaper_engine/assets/shaders/common.h` 逐字一致）；
  - `/common.h` 在**渲染器服务器自身**（`:8899`）是 200 ⇒ 这就是这条 bug 长期没被发现的原因（页面挂在 `:8899` 上时一切正常）。
- 头文件表的来源：`server/we-scene-demo-server.mjs:826-836`（`WE_SHADERS` 扫 `common*.h`，本仓 `shaders/` 自研头优先、WE 安装目录兜底）。
- 页面是怎么被 8902 服务的：`server/we-scene-demo-server-8902.mjs:1790-1813`（`rendererLocalServes` / `serveRendererLocal` ⇒ 同一份 `rendererRequestHandler`），
  但静态面优先 ⇒ 只有 `/shaders/…`、`/weassist/…` 这类前缀能到达渲染器处理器；`/common.h` 被静态面吃掉。

### 2.2 帮凶：取失败被当成功缓存 ⇒ include 静默变空

- `demo.html:2104`（HEAD）：`headerCache.set(name, txt || '')` —— 404/超时也把**空串永久记成"取到了"**，
  且 `catch {}` 一行日志都不留（真机日志里因此**看不到任何**线索）。
- `core/we-scene-bundle.js:10098`（HEAD）：`includeCache.set(f, (await shaderResolver('shaders/' + f)) || '')` —— 同一模式（空串 = "取过了"）。
- `core/we-scene-bundle.js:5719`（HEAD）：`if (inc !== null && inc !== undefined)` —— **空串走的是"包含成功"分支**，
  于是 `#include "common.h"` 被替换成**空**，连 `// [include 缺失: …]` 这条本该留下的痕迹都不写。
- 崩溃点：`core/we-scene-bundle.js:12798`（HEAD）`[we-scene] 跳过编译失败的 pass "…"` + `:12802` `if (progEntry === null) break`
  ⇒ 该层剩余效果链全部不执行 ⇒ 用户看到的"只有背景"（`COPYBG=1 + 链输入=背景拷贝` 只是"链没跑、只剩拷贝"的表现）。

### 2.3 `foliagesway` 的 `rotateVec2`"实参类型错"：**不是**独立缺陷

真编译对拍（三条状态，同一 shader 同一 combo）：

| include 状态 | `shaders/effects/foliagesway.vert` | `shaders/effects/shake.frag` |
|---|---|---|
| 空（= 改动前实况） | `0:50 'rotateVec2' : no matching overloaded function found` + `cannot convert from 'const float' to '2-component vector'` | `0:42 'M_PI_2' : undeclared identifier` |
| 真官方 `common.h`（945B） | **0 error** | **0 error** |
| 本仓自研 `shaders/common.h`（4215B） | **0 error** | **0 error** |

- 调用点 `rotateVec2(vec2(1.0/aspect, aspect), g_Direction)` / `rotateVec2(a_TexCoord.xy, g_Direction)` 的实参本来就是 `vec2`/`float`，
  与官方 `vec2 rotateVec2(vec2 v, float r)` **精确匹配**；
- 那句 `cannot convert from 'const mediump float' to 'highp 2-component vector of float'` 是"函数未声明"时编译器对表达式做的**错误恢复类型**（把调用当成 float），
  不是参数被 h2g 转成了 float。⇒ 修 include 即消失，`h2g` 的 `rotateVec2` 转译没有缺陷。

### 2.4 顺带发现的**真** h2g 缺陷（同一个"HLSL 隐式截断"家族）：采样坐标实参

`tests/effect-prelude-common-test.mjs` 与 `/0923` 全语料对拍暴露出来的**另一处**：`texSample2D(s, uv)` 的 `uv` 常是 `vec4`（WE 约定前两维才是 uv），
HLSL 允许实参隐式截断 `float4→float2`，GLSL ES 3.0 没有：

- 实例：`0923/2902406982` 的 `shaders/workshop/2800594362/effects/clipping_mask.frag:52`
  `vec4 albedo = texSample2D(g_Texture0, v_TexCoord);`（`varying vec4 v_TexCoord`，同文件 `:29`）
  ⇒ 转译产物 `:471` `texture(g_Texture0, v_TexCoord)` ⇒ `'texture' : no matching overloaded function found`。
- 已修：新增规则 **9-S**（`core/we-scene-bundle.js`，`hlsl2glsl` 宽度表块内，紧随规则 9 / 9-3 / 9a-2）
  —— 只在**宽度可确证 ≥3**（标识符 ∈ 宽度表、或已知宽度的 swizzle）时给采样坐标补 `.xy`，推不出来的一律原样保留；
  计数器独立成 `h2gWidthStats.ruleSample2D`，不动既有三条规则的 `unresolved` 口径。

---

## 3. 改法（4 处，逐条给理由）

| # | 文件 | 改动 | 理由 |
|---|---|---|---|
| ① | `demo.html`（`fetchHeader`） | 三候选 URL：`/shaders/<base>` → `/weassist/shaders/<base>` → 旧拼法兜底；**成功才缓存正文**，失败记时间戳 + **3s 退避重试**；取不到时**显式告警一次**（含试过的 URL） | 旧拼法在 8902/插件侧静态面必 404；失败被永久缓存 + 全程静默是这条 bug 藏住的直接原因。两处宿主实测：前两个候选都 200（自研头优先、官方头兜底、**没装 WE 也能编**） |
| ② | `core/we-scene-bundle.js` `WE_BUILTIN_SHADER_HEADERS` / `builtinShaderHeader()` / `resolveEffectInclude()` / `makeEffectIncludeResolver()` | 内置 `common.h` **等价实现**兜底 + include 三态解析（没取过 ⇒ 记 missing 去取；取过但空/404 ⇒ 内置头；非空 ⇒ 服务器正文**逐字**用） | ①**服务器正文优先** ⇒ 有头文件的宿主行为与改动前逐位一致；②宿主连 `/shaders/…` 都没有时（插件侧静态面/离线）效果链仍能编译；③数值与官方逐值一致，`M_PI_2 = 6.28318530718 = 2π`（**不是** π/2，`M_PI_HALF` 才是 π/2） |
| ③ | `core/we-scene-bundle.js` `preprocess()` | `inc` 为**空串/纯空白**时按"缺失"处理 ⇒ 一定留下 `// [include 缺失: xxx]` 痕迹 | 空串伪装成"包含成功"⇒ 静默产出缺符号的 GLSL、拖到 GL 编译期才炸。现在"缺失"在产物里可查 |
| ④ | `core/we-scene-bundle.js` `hlsl2glsl()` 规则 **9-S** | 采样坐标实参的 HLSL 隐式截断（见 2.4） | 这是"HLSL 隐式截断"家族里**可确证**的那一半（另一半是二元运算两侧宽度不同，见 §6 未验证边界） |

附带（只读暴露，不改渲染决策）：`demo.html` 在 `createRenderer` 之后挂 `window.__mpwFxStats = () => renderer.fxStats`
—— 浏览器侧此前**没有**"fx>0 的层到底跑没跑 pass"的入口，只能靠"日志里没报错"倒推（这也是本条 bug 藏久的条件之一）。

**没有改**（跨线/越界，仅点名）：

- `elysia/we-renderer/effects/shake.js:20` `const M_PI_2 = Math.PI / 2;` —— **错的**（官方 = 2π）。
  这条是 elysia（软件/兼容）重实现路径；真机走 WebGL 路径（日志里是 `[hdr] … RGBA16F FBO`、Adreno 830），**不在本次故障链上**。
- `elysia/we-renderer/glsl/integration.js:51-58` `_resolveGlslInclude()` 只读 `assets/shaders/<inc>`（weAssetsRead）⇒
  本机无 WE 资产时同属"include 取不到"这一类（同一根因家族，另一条通路）。
- 协议层：生产路径**故意**保留"两行 `hlsl2glsl(src.frag/vert, …, resolver)`"的源码形态
  —— `tests/hlsl2glsl-wiring-test.mjs`（按该两行原文注入探针）、`tests/hlsl2glsl-coverage-test.mjs`（接线原文断言）、
  `tests/effects-degenerate-fbo-test.mjs`（M3 变异锚点）三个门禁钉着它；拼装口径仍由 `assembleEffectShaderSources()`
  这份**纯函数镜像**供 Node 判据使用（`tests/effect-prelude-common-test.mjs` E7g 断言两处都在位）。

### 契约变更（显式更新，附理由，未放宽）

- `tests/hlsl2glsl-width-table-test.mjs` 的 `EXPECT_CHANGED`：**4 条 → 5 条**，新增
  `0923/2902406982 :: shaders/workshop/2800594362/effects/clipping_mask.frag`（规则 9-S：`texture(g_Texture0, v_TexCoord.xy)`，`compiles: false`）。
  这是新增规则造成的**唯一**一条变化，不是回归：B3 仍是"精确相等"（只是集合大了 1），B2「移植前能编译的 shader 输出逐位不变」仍为 **0 回归**。
  同时把 B3 的标题从写死的"4 条"改成按 `expectIds.length` 打印（原来标签与实际集合会脱节）。

---

## 4. 判据

新增：**`tests/effect-prelude-common-test.mjs`**（`node tests/effect-prelude-common-test.mjs`）
**改后读数：ALL PASS（92 项断言）**，`［真编译器档：glslangValidator］`。四层：

| 组 | 断言 | 改前读数 | 改后读数 |
|---|---|---|---|
| E1 口径 | 内置头与**官方** `wallpaper_engine/assets/shaders/common.h` 逐值一致（5 个宏 + `greyscale` 权重三元组 + 4 个函数名一个不缺） | 无此文件（红） | 全绿；`M_PI_2=6.28318530718=2π`，`≠ π/2` |
| E2 防漂移 | 内置头 ≡ 本仓 `shaders/common.h` 的 **token 级**序列（只比较 token，忽略注释/空白） | 无此文件（红） | 477 tokens 逐项相同 |
| E3 三态 | `makeEffectIncludeResolver()`：正文优先 / 空 ⇒ 内置兜底 / 没取过 ⇒ 记 missing；名字归一（`shaders/common.h`≡`common.h`≡`./common.h`）；未收录的头不兜底 | 无此函数（红） | 全绿 |
| E4 留痕 | 空串 include 必须在产物里留 `// [include 缺失: common.h]` | 静默无痕（红） | 留痕；兜底路径无痕且 `M_PI_2→6.28318530718` |
| E5 真拼装 | 官方资产 + **真包** `0923/2887099508` 的 `shake`/`foliagesway`（frag+vert）走生产拼装（模拟 404 宿主）⇒ 符号在位 + `glslangValidator` **0 error** | `0:42 undeclared` / `0:50 no matching overloaded` | 全绿（真编译 0 error） |
| E6 变异必红 | 同一拼装把 resolver 换回"恒空解析"（= 改动前的净效果）⇒ 符号必须丢、**必须**留缺失痕迹、真编译**必须**报 undeclared / no matching overloaded | —— | 6 个含 include 的 stage 全部按预期变红（`0:42`/`0:50`/`0:37` 逐号复现；`shake.vert` 本身没有 include ⇒ 该项 SKIP，不假绿） |
| E7 接线 | `demo.html` 第一候选 = `/shaders/<base>`、第二 = `/weassist/shaders/<base>`、旧单拼法不在主路径、失败不再永久缓存、有告警；渲染器侧 `makeEffectIncludeResolver(includeCache, missing)` 在位；两处宿主 HTTP 实测（在跑时） | 旧拼法为唯一路径（红） | 全绿（:8899/:8902 各 2/2 命中，内容含 `M_PI_2=6.28318530718`） |

**变异自证（"改回去必红"）**——两个变异都在临时改动后**已还原并 md5 校验**：

| 变异 | 期望 | 实测 |
|---|---|---|
| A：拿掉内置等价头（`resolveEffectInclude` 只回服务器正文） | E3b/E4c/E5*/E6* 一类变红 | **31 项失败 / 61 通过** |
| B：`headerUrls` 拼回唯一的旧写法 `/common.h` | E7a/E7b 变红 | **2 项失败 / 90 通过** |
| C：`tests/hlsl2glsl-width-table-test.mjs` 自带的三组源码变异 | 期望红集 == 实际红集 | **3/3 组通过**（no-table 18 / flip-9-3 7 / silent 3） |

**既有门禁（本线碰到的相关项，全绿）**：

```
tests/demo-syntax-check.mjs              demo 内联脚本语法：11/11 通过（扫 demo.html + demo/index.html）
tests/effect-prelude-common-test.mjs     ALL PASS（92 项断言）［真编译器档］
tests/hlsl2glsl-width-table-test.mjs     ALL PASS（44 项断言，变异自证 3/3）· B2 0 回归 · B3 变化集精确=5
tests/hlsl2glsl-wiring-test.mjs          ALL PASS（13 项）
tests/hlsl2glsl-coverage-test.mjs        ✓ 覆盖率回归通过（46/46 = 100.0%）
tests/glsl-validate.mjs                  结果: 128/128 通过（dd 语料真编译）
tests/effects-degenerate-fbo-test.mjs    40 通过 / 0 失败（M3 变异重新变红）
tests/clean-room-effects-blend-test.mjs  312 通过 / 0 失败
tests/hdr-predicate-test.mjs             21 通过 / 0 失败
tests/render-hdr-black-guard-test.mjs    PASS=16 FAIL=0
tests/video-quality-test.mjs             PASS=144 FAIL=0
tests/quality-tiers-test.mjs             42 通过 / 0 失败
```

---

## 5. 端到端 + `/0923` 同类抽样

`/0923` 五个包（真包、真渲染器页、`?id=…&audit=1`、llvmpipe）：

| 包 | 首帧 | 跳过编译失败的 pass | 着色器编译失败 | 公共头告警 | fx 层 / 真的跑了 pass 的层 | fxFail |
|---|---|---|---|---|---|---|
| **2887099508**（用户 4/5/8） | ✓ | **0**（改前 4 条：shake×2 / foliagesway / waterripple） | 0 | 0 | 19 / **16** | 0 |
| **2902406982**（用户 ④） | ✓ | 1（`clipping_mask`，见 §6） | 1 | 0 | 43 / 5 | 0 |
| 3278399262 | ✓ | 0 | 0 | 0 | 1 / 1 | 0 |
| 3648434762 | ✓ | 0 | 0 | 0 | 1 / 1 | 0 |
| 3668498439 | ✓ | 0 | 0 | 0 | 4 / 4 | 0 |

`/0923` **全语料离线真编译对拍**（含 include 的 shader stage；三档同一份语料/同一份 glslang）：

| 档 | 包数 | 编译失败的 include-依赖 stage |
|---|---|---|
| 改动前（include 展开成空 = 真机实况） | 23 / 30 | **151** |
| 只修 URL + 内置头（**未**加规则 9-S） | 9 / 30 | **11** |
| 再加规则 9-S（= 本次最终态） | 9 / 30 | **10** |

中间那一档里 `workshop/2423877731/effects/chromatic_aberration.frag` 报的正是 `'texture' : no matching overloaded function found`，
加上规则 9-S 后它在该包**实际 combo**（`AUDIOPROCESSING=1`，`fmod` 那一支被裁掉）下转为可编译 ⇒ 从名单里消失（11→10）。

余下 10 条**全部**是别的缺陷家族（不是 common.h）：二元运算两侧宽度不同（HLSL 隐式截断的另一半）4 条、`godrays_cast.frag` 的 `const` 初始化 4 条、
`shadow.vert` 的 `int + float` 1 条、`____________________.frag` 的 `vec2 / vec4` 1 条 —— 见 §6。

include 名清单（`/0923` 全语料）：`common.h` 22 包、`common_perspective.h` 19、`common_blending.h` 18、`common_blur.h` 11、
`common_fragment.h` 7、**`common_vertex.h` 5**、`common_composite.h` 2；前 6 个本仓 `shaders/` 有自研实现，
`common_vertex.h` **本仓没有**（只在 WE 安装目录里，526B）⇒ 见 §6。

---

## 6. 未验证边界 / 遗留（如实列出，未做就是未做）

1. **用户 ④ `2902406982` 的剩余根因（已定性，未修完）**：`三角1..6/12/13` 共 **10 个层**的效果链 = `clipping_mask` 单 pass，
   它仍编不过，报在**二元运算两侧宽度不同**：
   `clipping_mask.frag:53` `((v_TexCoord * 2.0 - 1.0 - texScaleCenter) / …)`（`v_TexCoord=vec4`、`texScaleCenter` 展开成 `vec2`）
   ⇒ 产物 `:472` `'-' : wrong operand types: vec4 … vec2`。HLSL 对向量二元运算做隐式截断（fxc 只告警），GLSL 不允许。
   修它需要**表达式级宽度推断**（比规则 9/9-3/9a-2/9-S 大一个量级，且要在 276 个语料 shader 上证明 0 回归）⇒ 本线**未做**，交转译线。
   同一文件在 `AUDIOPROCESSING=0` 时还会走到 `fmod()`（`chromatic_aberration.frag:42`）——h2g 没有 `fmod` 重写
   （GLSL 侧应等价成 `x - y * trunc(x / y)`，不能直接换 `mod`：负数语义不同）⇒ 也交转译线。
   `前景效果#410`（fx=4，只有 `chromatic_aberration` 可见）在**修好后仍读到 `passes=0`**、`inputKind=transparent`；
   它的编译失败（改前的 `texture` 越界）已经消失，但"为什么这一个 pass 不执行"本机**没有查到确证**（候选：空内容层的既有短路 / pass 纹理未绑定 / 该层可见性），如实标为未证实。
   本机**没有复现**用户说的"黑屏"：该包首帧 ✓、canvas 1920×1080、无 pageerror、像素日志左缘/中心非零。
   其 25 个 `弹幕*` 层（fx=3、`passes=0`）是**效果定义没解析出材质 pass**（`materialPasses` 为空），与编译无关，不属本线。
2. **`common_vertex.h` 自足性缺口**：本仓 `shaders/` 没有这个头（WE 安装目录里有 526B），`/0923` 有 5 个包引用它。
   有 WE 的机器上 `/shaders/common_vertex.h`、`/weassist/shaders/common_vertex.h` 都 200（实测），**没装 WE 的公开副本**上取不到 ⇒
   那 5 个包会退化成"缺失 + 痕迹"。是否补自研实现属"公共头替换"那条线（`docs/COMMON-HEADERS-REPLACEMENT.md` 的清单是 6 个）。
3. **规则 9-S 的收益边界**：它把 `clipping_mask` / `chromatic_aberration` 的 **`texture` 越界错误**消掉了；
   其中 `chromatic_aberration` 在该包**实际 combo**（`AUDIOPROCESSING=1`，`fmod` 分支被裁掉）下转为**可编译**（语料 11→10），
   `clipping_mask` 只是前进到同一条表达式里的下一处错误（二元运算截断），所以它在 `/0923` 上**没有**单独让任何 shader 变成"编过"。
   保留它的理由是"可确证、0 回归（B2 实测）、为下一族规则铺路"，不是为了刷绿。
4. **真机未验**：本机是 llvmpipe + 桌面 Firefox；用户真机是 Android Chromium + Adreno 830。编译期错误与驱动无关（已用 glslang 复现同一行号），
   但**贴图/合成层面**的观感差异本线无法覆盖；插件侧静态面的路由表（`dsh-mpkg-wallpaper` 仓）本线**只读未改**，
   其 `/shaders/…`、`/weassist/shaders/…` 是否都通**未实测**（内置头兜底就是为这种情况准备的，但它只覆盖 `common.h` 一个头）。
5. **未跑全量套件**（纪律：编排者统一跑）；本线只跑了 §4 列出的相关门禁 + 语料对拍。

---

## 7. 跑过的命令与汇总行

```bash
# 复现/端到端（全部在 flock 内，跑完 reset 库根）
curl -s -X POST http://127.0.0.1:8902/api/library-dir -H 'content-type: application/json' -d '{"dir":"<工作区>/allwallpaper/0923"}'
flock /tmp/.mpw-firefox.lock -c 'node /tmp/mpw-e2e-net.mjs 2887099508'        # 改前：404 /common.h + 4 条跳过；改后：200 /shaders/common.h + 0 条
flock /tmp/.mpw-firefox.lock -c 'node /tmp/mpw-e2e-fxchain.mjs 2887099508 2902406982 3278399262 3648434762 3668498439'
curl -s -X POST http://127.0.0.1:8902/api/library-dir -H 'content-type: application/json' -d '{"reset":true}'
# 离线判据
node tests/effect-prelude-common-test.mjs
node tests/hlsl2glsl-width-table-test.mjs
node tests/glsl-validate.mjs
node tests/demo-syntax-check.mjs
for t in video-quality quality-tiers hdr-predicate render-hdr-black-guard clean-room-effects-blend effects-degenerate-fbo hlsl2glsl-wiring hlsl2glsl-coverage; do node tests/$t-test.mjs; done
node /tmp/mpw-0923-include-scan.mjs        # 改前：151 条失败 / 23 包
node /tmp/mpw-0923-after-scan.mjs          # 改后：10 条失败 / 9 包
```

汇总：**根因 3 条已定死（URL 404 / 空串伪装成功 / 空 include 静默）· 修复 4 处 · 新增判据 92 条断言（含 2 组变异必红）·
既有门禁 10 项全绿（含 1 处契约显式更新且未放宽）· 真机报的 4/5/8 在本机 llvmpipe 上从"4 条跳过"变成"0 条"，`/0923` 语料编译失败 151→10**。
