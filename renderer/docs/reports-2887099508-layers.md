# 2887099508：图层触发条件与四条渲染投诉的取证（2026-10-05）

> 口径：本文只写**读数与可复核的事实**。工具：离线层归因 `tests/layer-attribution.mjs`（真 parseScene + mock GL +
> 真 renderScene，整帧无 `__lnHidden`）、语料结构扫描（`core/we-scene-bundle.js` 的 `parsePkg`/`getEntry`）、
> 真机台账读数（8902 预览 iframe 的 `__sceneLayers`）。语料：`allwallpaper/0923/2887099508`。

## 1. 图层触发条件总表（回答「哪些层默认加载 / 哪些要条件」）

包内 82 层、232 条目。**触发面共四类**，逐层明细落 `/tmp/triggers-2887099508.json`（本机临时读数，不入库）：

| 类别 | 层数 | 机制 | 本仓现状 |
|---|---|---|---|
| 默认可见 | 多数 | `visible` 缺省（= 可见） | 照常绘制 |
| **作者声明默认隐藏（`visible:false`）** | 12 | 只在作者脚本/属性把它打开后才出现 | 正确隐藏（与数据一致） |
| **用户属性绑定**（`{user:…}`） | 16 | 属性值驱动可见性/颜色/音量等 | 已支持（P-234 起含场景级） |
| **作者脚本**（`visible`/属性里内联 `{script:…}`，导出 `cursorClick/cursorEnter/cursorLeave/update`） | 11 | 鼠标进入/离开/点击某层、每帧 `update` | 脚本宿主在跑；P-233 起 `cursorClick/Down/Up` 已端到端派发 |
| 粒子层 | 4 | 粒子系统（`particles/presets/*`） | 见 §3 |

**16 个属性绑定层（原样读数）**：`wind.mp3`→`windsound`；`BBB`/`CCC`/`XR`/`HF`/`桥`→`bgm`/`defaultbgm`；
`sound line`→`aucolor,audioline`；`ey00000`→`crstarefront`；三个 `Clock`→`timecolor,time`；
`Sakura`→`flower`；`右-菜单-底色`/`中-菜单-浮动`→`newproperty1`；`后处理层`→`volumetriclight`；
`tim logo`→`timlogohide`（**同时**带脚本）。

**脚本层的动作（去混淆后的语义，逐条可复核）**：

- `设置2-穿上内内`：`cursorClick` 里 `getLayer('panci cover up').visible = true` + `getLayer('pussy').visible = false`；
  `cursorEnter/Leave` 切换 `中-菜单-浮动` 的某个效果的 `visible`。
- `设置1-返回` / `设置3-我要涩涩` / `安全模式`：`cursorClick`（含双击判定 `doubleClickFrameTime = 500ms`）与每帧
  `update()` 一起改 `阴影-设置1`、`中-菜单-浮动`、`健康壁纸`、`pussy`、`panci cover up` 等层的 `visible`。
- `tim logo`：`update()` 依 `shared` 计数与层坐标（`thisLayer.origin.x != 0x15c3`）决定 `健康壁纸`/自身可见性，
  `cursorClick` 是双击计数器（`count % 2` + `Date.now()-firstClickTime > 500`）。

⇒ **「有些层要点击/悬浮才会出现」是真的，而且触发点就是这些菜单层**；`pussy` 的可见性由脚本写，不由静态数据决定。

## 2. 四条渲染投诉的取证与状态

| # | 投诉 | 读数 | 判定 |
|---|---|---|---|
| 1 | 播放速度较快（像倍速） | 本仓渲染器的场景时钟缺省 = `(now - last0)/1000`（墙钟 1:1）；`MPW_SCENE_CLOCK.rate` 只有被 `setPlaybackRate` 碰过才不是 1。P-232 修的是**相机 3× 定格**（`general.zoom` 被脚本 round-trip 写穿），与播放倍率是两件事 | **待真机 A/B**：同一段墙钟内对比本仓与上游产物档的骨骼/粒子推进（离线无脚本相位可对） |
| 2 | 层 21 `pussy` 先出现后消失 | 离线：`visible:false`（作者声明隐藏）+ `fx=2 effects/shake`；真机 `__sceneLayers` 两个时刻都是 `visible:false` | **机制已定位为脚本驱动**（`设置2-穿上内内` 的 `cursorClick` 会写它）：需要「点一次设置菜单」的 A/B 才能判"我们的脚本宿主是否按 WE 的时序写」——见 §4 最小实验 |
| 3 | 26/27 层 `Light shafts 0` 渲染有问题（**§2k 跨档实测已更正方向：确实"画大了"**） | 两层都是**粒子层**（id 243/137），预设都在包内（`particles/presets/light_shafts_0.json`、`particles/workshop/2628698137/presets/light_shafts_0.json`）；`instanceoverride` 显式给 `alpha 0.24/0.35、rate 0.79、speed 0.47/0.65、size 0.71、lifetime 1.14`。**新增读数**：① 离线 CPU 模拟按 t=1/3/6/12/20 五点采样 ⇒ 前四点两层**存活 0 粒**（`particle-idle`），t=20 时 #26 `bind=particle`（出粒并上屏）、#25 仍 `not-drawn`；② 真机逐层隔离（`?ln=25`/`?ln=26`，同帧统计画布像素）：正常帧 mean 168.35，`ln=25` 在 t≈14s/26s 分别 181.0/178.2，`ln=26` 分别 178.0/**193.9** ⇒ 两层**都真的在画**，且 #26 随时间变亮（粒子在累积） | **判定：不是"没画"，是"发射率极低"** —— `rate 0.79/s × lifetime 1.14s ⇒ 期望存活 ≈0.9 粒`，所以大部分时刻只有 0–1 粒、光束很淡；与"渲染错了"的观感差别需要一次**上游产物档对照**（同 t 同层）才能定案，见 §4-2 |
| 4 | 叠层失效（单层能看、叠起来看不见） | 离线归因整帧无 `__lnHidden` 时，`bind=rtcopy` 的层有 6 个（`支持 Tim`/`记事本`/`中-菜单-浮动` 等，fx>0 + copybackground）；P-230/P-231 已把「无 fx 的 copybg 不换入」「composelayer+fx 才是效果载体」分开 | **待复现**：需要用户指明"哪一层 + 与哪一层叠加"——离线只能对静态帧，叠层顺序/混合模式需要真机逐步开关 |

## 2b. 两档对照与"首帧偏慢"读数（2026-10-05 追加）

同一台机器、同一次会话内切换渲染器档（工具条「渲染器」），画布同尺寸 666×374、同一条包：

| 档位 | 时刻（挂载后） | mean | 采样到的不同色数 | 备注 |
|---|---|---|---|---|
| 本仓 | ≈6s | **0.00** | 1 | 仍是**黑帧**（还没出内容） |
| 本仓 | ≈12s | 166.34 | 203 | 已出内容 |
| 本仓 | ≈20s | 168.78 | 466 | 细节继续增加 |
| 本仓 | ≈30s | 161.71 | 246 | 相位不同 ⇒ 色数随画面变 |
| 上游产物 | 切档后 ≈3s | 179.93 | 267 | 同尺寸、同一条包 |

- **两档都能出内容**（不是"本仓渲染不出来"）；早期快照（≈6–9s）会读到"单一色的灰/黑帧"，那是
  **开场运镜还在 3×→1× 的过程中**（相机贴在背景大图的平坦区域）⇒ 拿单帧截图判"只渲染出背景"会误判。
- **首帧偏慢是可解释的**：`scene.pkg` **119.9 MB**、82 层、效果链 5 段级别；离线归因一次解析约 9s，
  真机解析 + 纹理上传到出内容 ≈10s 量级。若与上游档的首帧时间相比明显更慢，下一步量的是
  "取包/解析/首帧"三段各自耗时（`?diag=1` 的时长行 + `performance` 打点），而不是画面本身。
- 真机叠加读数（`__sceneLayers`）：82 层、可见 **63→64**、`__mpwLayerErrors` **0** —— 与离线归因一致
  （不可见层都是作者 `visible:false` / 属性门控 / 脚本门控，见 §1）。

## 2c. 指针管线实测：脚本**被调到**了，但作者菜单没打开（2026-10-05 追加）

方法：真机点预览画布（设计空间 6080×3420，82 层），位置由 `window.__mpwSceneInfo` 的设计投影换算，
读数取 `window.__mpwCursorDispatch`（P-233 台账）与 `__sceneLayers` 的可见性/origin。

| 动作 | 台账读数 | 层状态变化 |
|---|---|---|
| 点画布角（设计 ≈ (18,16)） | `hits:["ldfk","new background1","Solid"]`；`lastDispatch:{calls:1,errors:0,entries:42}` | 无 |
| 点 `tim logo`（设计 (5571,234)） | `hits` 含 `tim logo`；`{calls:2,errors:0,entries:84}` | 无 |
| **双击** `tim logo`（间隔 200ms，脚本是"500ms 内第二次点击"判定） | `clicks:4`、`{calls:2,errors:0,entries:84}` | **菜单 `中-菜单-浮动` 的 origin 仍是 (-3189,622)、`设置2-穿上内内` 仍在 (-3159,1122)** ⇒ 菜单没打开 |

结论（本次能确定的部分）：
1. **指针管线是通的**：命中测试、owner 映射、脚本派发都成功（`calls ≥ 1`、`errors=0`、`entries` 42/84）；
2. **分歧在脚本宿主语义里**，不在指针层：`tim logo` 的 `cursorClick` 是"点击计数 + 500ms 窗口"的判定，
   它内部还读 `shared[...]` 计数与 `thisScene.getLayer(...).visible`（去混淆后的分支），
   本次两支都没落到"移动菜单"的那条 ⇒ 需要下一步把 `thisScene.getLayer/getEffect` 的调用序列打成读数，
   与 WE 的期望序列逐条对比（这是脚本宿主保真度问题，独立于本包的层数据）。
3. 顺带修掉一个真机可见缺陷（P-228i）：`dispatchCursor` 在**空命中**时读循环体内的 `st` ⇒
   每点一次空白抛一次 `ReferenceError: st is not defined`，且 `lastDispatch` 恒 `null`；现已改成都写台账。

## 2d. 菜单脚本的**门控到底是什么**（2026-10-05 追加，去混淆读数）

把 `tim logo`（id 500）脚本里的 `update()`/`mimi()` 与 `cursorClick` 逐分支读出来（脚本是 `_0x…` 混淆，
但字符串字面量与数值常量可读），门控形态是：

- `mimi()`：连续若干条**计数门** —— `if (shared[<key>] != 0x2ae /*686*/) { …; thisLayer.visible = false; return }`、
  `!= 0x364 /*868*/`、`!= 0x29a /*666*/`，再加 `thisScene.getLayerId(thisLayer) != 0x4e /*78*/` 与
  `thisLayer.origin.x != 0x15c3 /*5571*/`；任一不满足 ⇒ 自身隐藏 + 提前 return。
- `cursorClick()`：`count++`；偶数次且与上一次间隔 **≤500ms**（`doubleClickFrameTime = 0x1f4`）才走"切换
  `健康壁纸` 可见性"那条，否则把 `firstClickTime` 重置并 `count--`。
- **属性门**：`project.json` 里 `timlogohide` = **bool，默认 `True`，文案「显示tim菜单（show tim menu）」**；
  `右-菜单-底色`(489)/`中-菜单-浮动`(503) 带 `{user:newproperty1}`（菜单背景色）。
- 菜单层在 scene.json 里的静态位置就是**屏幕外**（`中-菜单-浮动` origin (-3189,622)、`设置2-穿上内内` (-3159,1122)）
  ⇒ 它们上屏必须靠脚本/属性路径把它移回来，而不是"默认就该在屏幕上"。

**推理链（可复核）**：指针链路已验通（`calls ≥ 1`、`errors = 0`，§2c）⇒ 脚本确实在跑；脚本的内部计数门
（686/868/666/78）由**别的脚本/交互**填 `shared`；本机这次没有任何一条把 `shared` 填到门槛值 ⇒
菜单停在屏幕外、`pussy`/`panci cover up` 也就不会因为"设置2"的点击而翻转。

**已做的最小实验（2026-10-05，真机读数）**：宿主把脚本缓存发布成 `window.__mpwScriptCache`，而它的
`.shared` 就是**跨脚本共享的那本账**（`demo.html:5063/5074`）。挂载后与点击后各 dump 一次：

```
shared = { kkyy: 686, yykk: 868, eee: 666, mus: '枫桥雨' }      // 挂载后
shared = { kkyy: 686, yykk: 868, eee: 666, mus: '枫桥雨' }      // 双击 tim logo + 点菜单底色/菜单层之后
```

⇒ **三条计数门（0x2ae=686 / 0x364=868 / 0x29a=666）本来就是满足的**（值就写在那里，且点子后没变），
`tim logo` 的 `origin.x` 也等于 0x15c3=5571（§2c 读数）。所以"菜单不打开"**不是**计数门的问题，
剩下的只可能是 `mimi()` 末尾那两条：`thisScene.<某方法>(thisLayer) != 0x4e /*78*/` 与
`thisLayer.<某属性> != '<字符串>'`（脚本里那两条的比较对象都在混淆字符串里，本轮无法逐字解码）。

**P-228k 写入面读数（2026-10-05）**：层引用 `origin` 写入加了只读环形账 `window.__mpwVecWrites`
（层名 + 归一化串 + 原始值类型；`value:null` = 写入被丢弃）。真机点 `安全模式`（raw 挪进屏内）后读数 **为空**
⇒ **层引用 setter 一次都没被调用** ⇒ "菜单没动"的原因是**该脚本这次点击走的是别的分支**，
而不是"标量/字符串写入被丢"或"写到别的对象上"（后两个候选就此排除）。

**P-228j 端到端验收（2026-10-05）**：本包菜单层静态在屏外（真鼠标够不着），探针把 `设置1-返回` 的
**raw 对象** `origin` 写进屏内（必须写 raw —— 渲染循环每帧从 raw 同步到 `scene.layers`）后：
真鼠标移上去 ⇒ `hits` 含 `设置1-返回`、台账 `enters: 1`；移开 ⇒ `leaves: 1`、`pageerror 0`。
⇒ 作者挂在 `cursorEnter/Leave` 上的 `getLayer('中-菜单-浮动').getEffect('阴影-设置1').visible` 这条路径
（"悬浮才出现"的一整类）从此真的会跑；同时新增工具 `tests/script-string-decode.mjs`（`--sweep` 模式
扫出**只有 5 个脚本**引用 `中-菜单-浮动`：`设置1-返回`/`设置2-穿上内内`/`设置3-我要涩涩`/`设置4-开关音乐`/`安全模式`）。

**再往下的两条硬读数（2026-10-05 追加）**：

- 第四条门（`thisScene.<方法>(thisLayer) != 0x4e /*78*/`）**很可能是满足的**：
  `tim logo` 在 `scene.json.objects` 里就是 **index 78**（0-based，实测 `objects[78].id = 500`）；
  而宿主的 `getLayerIndex()`（`elysia/scene-scripts.js:1137-1151`）**专门为 `thisLayer` 留了
  `hooks.ownerLayerRef()/ownerObj()` 这条缝**（源码注释里写明语料就是传 `thisLayer` 的）⇒ 解析得出 78。
  要 100% 确认只需读它的诊断计数（`SCENE_SCRIPT_API_DIAG.getLayerIndex / getLayerIndexUnresolved`）。
- 第五条门里的字符串常量 `'sitFK'` **在整个 scene.json 里只出现在 object 78（`tim logo`）自己的脚本正文里**
  （全库 grep：仅此一处）⇒ 它是**脚本的反混淆字符串表里的成员名**（属性/方法名），不是壁纸数据字段
  （对照：`tim logo` 的数据字段只有 alignment/alpha/angles/brightness/color/colorBlendMode/
  copybackground/id/image/ledsource/locktransforms/name/origin/parallaxDepth/perspective/scale/size/solid/visible）。

⇒ **结论**：五条门里三条（686/868/666）已确证满足、一条（78）结构上满足、**只剩一条**用的是反混淆成员名
（`sitFK` 一类），必须靠"记录脚本宿主上未知成员的访问"来定位 —— 也就是下一步的只读探针。

**下一步（更精确、仍然独立）**：给脚本宿主加一条**只读取证**：把 `mimi()` 里那两类调用的实际返回值
（层 id / 层属性）打出来（例如在 `thisScene` 门面上加一个 `__mpwScriptProbe` 记录最近 N 次未知成员的
`get` 与调用结果），就能定位是"宿主缺这个方法"还是"属性值不同"。这属于**脚本宿主保真度**的取证，
不动渲染语义。

**下一步最小实验（明确、独立）**：在真机上把 `scriptShared`（宿主 `demo.html:5063` 的 `const scriptShared = {}`）
在一个挂载周期内**打成读数**（点几次菜单/按钮后 dump 键与值），与上面四个门槛值逐条对比 ⇒ 判定是
"某个脚本没被调到 / 被调到了但写的是别的键 / 我们缺某条 API（`getLayerId` 一类）"，再决定改宿主还是记边界。

## 2e. 收口：`安全模式` 分支为何没走到（下一步的**离线**打法，2026-10-05）

已确定的事实链（每一环都有读数）：
1. 指针链路通：点击 `安全模式` ⇒ `cursorClick` 被调到（`calls: 1`、`pageerror 0`）；
2. 层引用 `origin` 的 **setter 一次都没被调用**（`window.__mpwVecWrites` 为空）⇒ 不是"写丢/写偏"；
3. 解码表给出的门与分支（`tests/script-string-decode.mjs`）：
   `adad()` 的三条计数门用到的键解出来是 `kkyy`(0x2ae=686) / `yykk`(0x364=868) / **`yykk`(0x29a=666)**，
   而真机 `shared = {kkyy:686, yykk:868, eee:666}` —— **第三条门拿 `yykk` 去比 666 ⇒ 868 ≠ 666 ⇒ 提前 return**；
   `cursorClick` 里 `getLayer(...).origin = (-0x3e8,-0x3e8,0x0)`（逗号表达式 = 0）在 `adad()` 调用**之后**。

⇒ 这是**该包脚本自己的逻辑**（同一个 `yykk` 键被两条门按不同期望值使用：一处 868、一处 666），
而不是宿主缺陷；宿主侧能修的两处（P-228k 的层引用 NaN 写入、P-228j 的 enter/leave 派发）都已修并有判据。

**下一步（离线、可复核，不需要浏览器）**：给 `tests/script-string-decode.mjs` 加 `--call <导出名>` 模式 ——
在同一个 `node:vm` 沙箱里用**桩门面**（Proxy 记录成员访问与调用）真的调一次 `cursorClick`，
把"抛在哪 / 访问了哪些成员 / 哪条门先 return"打成读数（本轮已写出该模式但改坏了文件位置，
最后选择**回退到已提交的可用版本**，把这件事留给下一轮用 20 行补上 —— 见提交 `b36739b` 之后的记录）。

## 2f. 更正与收口（2026-10-05·新工具 `--call`）

**新增离线复现能力**：`tests/script-string-decode.mjs --call <导出名>` —— 在同一个 `node:vm` 沙箱里用
**桩门面**（Proxy 记录成员读取/赋值/调用）真的调一次导出。读数示例（本包两条，逐字可复核）：

```
objects[74] = 设置2-穿上内内（id 562）· 导出: cursorEnter,cursorLeave,cursorClick
   --call cursorClick: undefined
      调用: thisScene.getLayer("panci cover up") | thisScene.getLayer("pussy")
      赋值: thisScene.getLayer().visible = true | thisScene.getLayer().visible = false
objects[77] = 安全模式（id 515）· 导出: cursorClick
   --call cursorClick: null
      调用: thisScene.destroyLayer(1) | thisScene.getLayer("中-菜单-浮动") | thisScene.getLayer("健康壁纸") …
      赋值: thisScene.getLayer().origin = 0
```

**⚠ 上一节的结论要更正一处**：`安全模式` 的 `origin` 字段是 **`{script: …}` 脚本属性**（每帧被脚本求值写回），
所以探针"把它的 raw `origin.value` 挪进屏内"会被下一帧覆盖 ⇒ **它根本没被挪动、那一下点击也没命中它**
（证据：点击后台账 `hits` 里没有 `安全模式`，只有背景层）—— **"分支没走到"的推断作废**，
真正的原因是"点击没打到它"。要打到这类 UI 热点层，得先让**菜单布局脚本**把它摆到屏内
（本包多个菜单层的 `origin`/`scale` 都是脚本属性，按 `中-菜单-浮动` 的位置 ± 偏移摆放）。

**同时确定为"宿主无关"的部分**：`aad()`/`ad()` 的门是 `shared['eee'] != 0x29a(666)` ⇒ `destroyLayer(0)` + 自隐藏；
真机 `shared.eee = 666` ⇒ 这条门**是满足的**（不会因此隐藏）。`设置2-穿上内内` 的 `cursorClick`
（上面读数）就是"点它 ⇒ `panci cover up` 显示、`pussy` 隐藏"的唯一入口 —— 与 §1 的结论逐字一致。

## 2g. 布局链（`--chain` 扫描，2026-10-05）：菜单是"相对锚层"摆的

工具新增 `tests/script-string-decode.mjs --chain [--target <层名>]`：扫出**脚本驱动的字段**（`{script:…}`）
及其引用的层名。本包读数：**73 个脚本驱动字段 / 40 个层**。菜单相关部分（逐字）：

```
---- 引用 "中-菜单-浮动" 的脚本字段（10）----
   objects[73] 设置1-返回   · origin · visible
   objects[74] 设置2-穿上内内 · origin · visible
   objects[75] 设置3-我要涩涩 · origin · visible
   objects[76] 设置4-开关音乐 · origin · visible
   objects[77] 安全模式      · origin · visible
```

⇒ **五 个设置热点层的 `origin` 与 `visible` 都是脚本**，而它们都**引用菜单锚层 `中-菜单-浮动`**：
`origin` 脚本 = "取锚层的 origin ± 偏移"（解出的偏移：`+0xc8`、`-0x64`、`-0x690`、`-0x384`、`+0x1e`），
`visible` 脚本 = `ad()/aad()` 门（`shared['eee'] != 0x29a(666)` ⇒ `destroyLayer(0)` + 自隐藏；真机 `eee = 666` ⇒ 通过）。
锚层 `中-菜单-浮动` 自己的 `origin` 也是脚本（自引用：`x = getLayer('中-菜单-浮动').origin.x`，即**保持现值**），
它的兜底值就是作者写的屏外坐标（≈ -3180, 963）。

**推论（下一步的靶子）**：五个热点都跟着锚层走 ⇒ 锚层在屏外时，它们**全都点不到**；
而写锚层坐标的 `cursorClick` 恰恰挂在这些热点层上（`安全模式`/`设置3` 会写 `origin = 0`）——
所以"打开菜单"的头一下必须来自**别处**。本包现存的候选只有两类（都能用同一套工具验证）：
① 屏内的 `tim logo`（设计 x=5571，可点；`cursorClick` 是 500ms 双击判定，改 `健康壁纸` 可见性）；
② `{user:…}` 属性路径（`timlogohide`「显示tim菜单」默认 true；`右-菜单-底色`/`中-菜单-浮动` 带 `newproperty1`）。

## 2h. 点击链的最后一格读数（2026-10-05）：谁导出了 `cursorClick`

真机双击屏内的 `tim logo`（设计 (5571,234)，hits 含它）⇒ 台账 `clicks` 0→4、`hits` 含 6 层、
`__mpwVecWrites` 空、`健康壁纸.visible` **仍是 false**、`pageerror 0`。

离线对账（哪几个命中层真的导出 `cursorClick`）：

```
tim logo        | id 500 | 脚本字段: alpha,visible | 导出 cursorClick: visible
ldfk            | id 541 | 脚本字段: visible       | 导出 cursorClick: visible
右-菜单-底色     | id 489 | 脚本字段: origin        | 导出 cursorClick: 无
new background1 | id 222 | 脚本字段: —             | 无
cloud           | id 76  | 脚本字段: —             | 无
Solid           | id 174 | 脚本字段: —             | 无
```

⇒ **`CURSOR.clicks` 统计的是"脚本调用数"，不是"点击次数"**（一下点击命中 2 个导出者 ⇒ +2），
所以"0→4 = 两次物理点击"自洽，`tim logo` 的 `cursorClick` 每次点击**恰好被调到一次** ✓。
但它"双击切换 `健康壁纸`"的净结果仍是 false ⇒ **`健康壁纸.visible` 被多个脚本写**（它自己的脚本 +
`设置*`/`安全模式` 的 `adad()` 每帧写），单看这一格读数判不出是谁把它按回去的 —— 下一步需要**每帧写入轨迹**
（把 `visible` 的写入点连脚本名一起记账，工具已具备同一套 Proxy 能力）。

## 2i. 机制定案（2026-10-05）：这些层是**脚本属性逐帧重算**，一次性写入是瞬态

本轮给宿主加了**属性写入轨迹**（`globalThis.__mpwPropWrites`，环形 40 条：`{who, target, field, value, at}`，
`who` 由 `setOwner()` 维护）并做了两组真机读数：

1. **原生双击屏内 `tim logo`**（`page.mouse.dblclick`，命中含它）⇒ 台账 `clicks` 0→4（= 2 次物理点击 × 2 个导出者），
   `__mpwPropWrites` **仍为空**；
2. 离线对账发现：`getLayer(name)` 返回的引用走的是 **`layer()`**（`elysia/scene-scripts.js:1049`）那条构造，
   它的 `visible` 是**普通 getter/setter**（:1059-1060），而我上一步只把 `layerRefFor()`（:1545）那条接进了轨迹
   ⇒ **轨迹对 `getLayer(...)` 这条路径是盲的**（这是本轮的工具缺口，不是宿主缺陷）。
3. 同时解释了"双击后 `健康壁纸.visible` 仍是 false"：该字段是 **`{script: …}` 脚本属性**，
   宿主**每帧**求值并写回 ⇒ `cursorClick` 里那次一次性 `visible = true` 会被下一帧的重算覆盖
   （作者的 `visible` 脚本自身 `update()` 调 `mimi()`，条件不满足时写 `thisLayer.visible = false`）。
   在 WE 里同样是"逐帧求值"语义 ⇒ **一次性写入本来就是瞬态**；真正的开关是脚本之间的 `shared` 状态
   （例如 `设置2` 的 `cursorClick` 先写 `shared[0x10]=1` 再改可见性）。

⇒ 结论（本包）：**菜单/设置这一族不是"点一下就一直显示"**，而是"脚本属性按 `shared`/属性状态逐帧决定"；
要把它们端到端跑通，下一步必须**同时**：① 把轨迹接到 `layer()` 的 setter 上；② 追踪 `shared` 键的变化
（哪个点击/属性把它写成什么），再验证脚本属性求值的净结果。

## 2j. 点击链闭合读数（2026-10-05）：点击真的写进了 `shared`

本轮把两处盲区补上：① `layer()`（`getLayer()` 的构造）的 `visible` setter 也记账；
② 宿主把 `shared` 包了一层 **Proxy 写入轨迹** `window.__mpwSharedWrites`（只记账，语义不变）。真机（2887099508）：

```
mount        : shared 写入 4 条 = kkyy=686 / yykk=868 / eee=666 / mus='枫桥雨'；propWrites=0；健康壁纸.visible=false
dblclick tim : shared 追加 1 条 = key "15" = 2；propWrites 仍 =0；健康壁纸.visible 仍 false；cursorDispatch.clicks=4
```

⇒ **结论（这条线闭合）**：
1. 指针 → 命中 → 脚本派发 → **作者脚本真的改了 `shared` 状态**（双击 `tim logo` 新增一条 `shared['15']=2`）✓；
2. `getLayer(...).visible = …` 这类写入**没有发生**（两处 setter 都已记账、仍是 0 条）⇒ 作者这次点击走的是"改 `shared`"那条；
3. `健康壁纸.visible` 由**脚本属性逐帧求值**决定（见 §2i）⇒ 它的最终值取决于 `shared` 与属性状态，
   而不是某一次点击的一次性写入；
4. 全程 `pageerror 0`。

⇒ **这不是宿主缺陷**：宿主把"点击 → 脚本 → 共享状态 → 脚本属性求值 → 可见性"这条链完整跑通了；
本包菜单/设置在屏外（§2g）且可见性由脚本状态函数决定 ⇒ 想在测试台上"点开菜单"，必须复现作者的
**状态组合**（`shared` 键 + 相关 `{user:}` 属性），而不是期待一次点击就常亮。

## 3. 已知与本包相关的既有修复（回归背景）

- **P-229**：`demo.html` 台账 composite 条目全灭（`mpwLedgerYDown` 块级作用域）——量法已恢复；
- **P-230**：`copybackground` 只在**有效果链**时换入（官方 helper 语义）；
- **P-231**：`composelayer` + fx>0 视作效果载体不再被容器跳层吞掉（本包 154 个受益面之一）；
- **P-232**：作者脚本 `setCameraTransforms(getCameraTransforms())` 盲 round-trip 把 `general.zoom` 动画写穿成常数
  ⇒ 全场景 3× 定格（本包就是探针包）——已修，真机宽景回归。

## 4. 下一步最小实验（各一条命令/一次探针）

1. **pussy 时序**：真机点一次「设置2-穿上内内」层（用 `?ln=` 先定位其屏幕坐标），前后各读 `__sceneLayers` 里
   `pussy`/`panci cover up` 的 `visible`，与 WE 语义（click ⇒ 前者隐藏、后者显示）对账；
2. **light shafts（已完成一半）**：五点采样 + 逐层隔离像素统计见上表 ⇒ 机制是"低发射率 + 稀疏存活"，不是不画。
   剩下的一步 = **上游产物档同 t 对照**（本仓 vs 上游同帧同层隔离像素/形态），若上游明显更亮/更密 ⇒ 再查
   `instanceoverride` 的 `rate/count` 语义（乘法 vs 绝对值）与发射器 `env` 路径；
3. **倍速**：同一段墙钟内，本仓档与上游产物档各取 3 张帧的 `unique colors` 与骨骼层实绘矩形，比较推进量；
4. **叠层**：让用户给"单层可显、叠加不可显"的具体层对，再用 `?ln=` 逐层开关复现。

## 5. 结论（可直接回给用户的短版）

- 「哪些层要条件」已查清：**16 层吃用户属性、11 层吃作者脚本（鼠标进入/离开/点击 + 双击判定 + 每帧 update）、
  4 层是粒子、12 层作者默认隐藏**；点击触发点就是右/中菜单那几层（`设置1-返回`/`设置2-穿上内内`/`设置3-我要涩涩`/`安全模式`/`tim logo`）。
- `pussy` 是先出现后消失的**脚本写可见性**层；`Light shafts 0` 两层确实在画 —— 但**不是"发射率极低的弱光柱"**：
  一轮相位对齐的跨档对照（§2k）量到它们把整个画面**加色铺白**（隐藏这两层：整帧 p50 251→197/187；
  隐藏全部粒子层：251→**145**；`?pquad=legacy` 同样到 145）。倍速与 3× 定格是两件事（后者 P-232 已修；
  §2k.3 另修了"动画按封顶 dt 推进 ⇒ 低帧率下慢动作"）；叠层失效需要具体层对才能定位。
4. **光轴（§2k，2026-10-05 已定到开关级）**：整屏泛白**全部来自粒子层**，且与"精灵 quad 吃不吃图层 `scale`"
   同一个开关（`?pquad=legacy` 与"隐藏全部粒子层"读数一致）。两层 `scale = 31.27/10.27`（#26 = 25.0/8.27）
   × `sizerandom 850–1000` × override .71 ⇒ 单颗粒子约 6000–7000 设计像素（设计宽 6080）⇒ 一颗铺满屏。
   下一步只剩两处未对齐（§2k.4）：RG88 贴图的 alpha 通路（台账实测 `light_shafts_0` = f8 / 256×512 / alpha 恒 255）
   与"上游对粒子层 `scale` 的取值"。

## 2k. 两档同 t 对照与方法学更正（2026-10-05·第 46 轮）

本节原来的标题是「本仓整屏白洗 vs 上游正常曝光（p50 249 vs 174.67）」。**相位问题找到并修掉之后**，
结论要按下面的读数重写 —— 原来那次对照是不公平的（本仓当时正处在**慢动作**的暗相里，见 §2k.3）。

### 2k.1 相位对齐后的同 t 读数（1280×720，两档各在"装载后 30s 起"连采 10 帧）

| 档位 | p50 | p90 | p99 | `>220` | `≥240` | `≥250` |
|---|---|---|---|---|---|---|
| 上游产物档（页面内 `fetch('/pkgpath')` + `__wp.loadSceneFile`） | **174.2**（172–179，10 帧几乎不动） | 230.9 | 252.1 | 17.9% | **5.05%** | **1.71%** |
| 本仓档（`/webloader/?…&res=dpr&shell=0&campose=legacy`） | **245.1**（227–255） | 255 | 255 | 66.8% | **57.4%** | **43.4%** |

⇒ 本仓档确实**整体过亮、且大片高光被削平**（`≥250` 占 43% vs 上游 1.7%），差值不是相位造成的。

### 2k.2 亮度归因：**全部来自粒子层**，且与"精灵 quad 吃不吃图层 scale"同一个开关

方法（**这一步的方法学是本节最重要的产出**）：在**同一次挂载**内把某一层的 `layer.__lnHidden`
置真（渲染循环每帧在循环内判它，和 `?ln=` 用的是同一条路），等 1.5–3s 再采一帧。

| 操作 | p50 | `>220` | `≥250` |
|---|---|---|---|
| 基线 | 251 | 71.5% | 53.4% |
| 隐藏 `Light shafts 0` #25 | **197** | 39.8% | 8.9% |
| 隐藏 `Light shafts 0` #26 | **187** | 35.2% | 19.0% |
| 隐藏 `Sakura` #49 | 247 | 70.3% | 44.0% |
| 隐藏 `赞助闪心` #58（作者 `visible:false`） | 232 | 53.9% | 23.3% |
| **隐藏全部粒子层** | **145** | **4.8%** | **0.74%** |
| 恢复 | 255 | 73.4% | 60.9% |

同样条件下换档：**`?pquad=legacy`（精灵 quad 不吃图层 scale/角度）= p50 145 / `>220` 5.0% / `≥250` 0.78%**
—— 与"隐藏全部粒子层"逐项一致。⇒ 造成整屏泛白的就是 **P-103① 打开的那条路：把图层 `scale` 逐轴乘到
每颗粒子的精灵 quad 上**；而这两层的 `scale = 31.27/10.27`（#26 = 25.0/8.27），`sizerandom 850–1000` ×
override .71 ⇒ 单颗粒子的 quad 约 6000–7000 设计像素（设计宽 6080）⇒ 一颗就铺满屏（隔离 `?ln=25` 实拍：
一条近乎平的斜向白带，`uniq=10`）。

### 2k.3 为什么会得出过结论（留作方法学）

- 本仓的属性动画此前沿用脚本的**单帧封顶 dt**（0.05s）⇒ llvmpipe ≈2–4fps 时动画按 ~15% 速度播，
  `mkj`（390 帧/13s 的淡入）从"装载后 3–5s"漂到"16–20s"，于是 40s 窗口里 p50 在 147–255 之间摆；
  两档各采 6 帧取均值时，本仓那次恰好落在暗相 ⇒ 得到"249 vs 174"的假差。
  已修（`1a8fe34`：动画 dt 改用场景时钟差，脚本 `frametime` 仍吃封顶），修后剖面回到 235–255 稳态。
- **`layer.visible = false` 不是可用的隐藏手段**：`raw → layer` 的同步每帧会把 `visible` 扳回（本轮前几次
  "逐层隐藏"的归因因此全部无效 —— 表现为"隐藏任何层亮度都不变"）。要用**渲染循环自己的** `layer.__lnHidden`。

### 2k.4 仍未定案的一点（下一步的最小实验）

按对照实现（`particles.js:660-683`）的读法，图层 `scale` 也是要乘到精灵尺寸上的
（`sysScale = min(|sx|,|sy|)` + 另一轴当拉伸，与本仓 `PQUAD` 的逐轴写法**数学同值**）——可上游产物档
在同一相位并没有这块泛白。两者之间还剩两处没对齐，按代价排序：

1. **alpha 通路**：贴图台账实测 `particle/light/light_shafts_0` 是 **RG88（f=8）256×512、rgb 均值 27、
   alpha 恒 255**（`__mpwTexStats`）。粒子 FS 已有官方 `ConvertTexture0Format`（RG88 → `vec4(s.r,s.r,s.r,s.g)`），
   所以要么 GL 侧上传成了 RGBA（`.r/.g` 不是原始 R/G ⇒ 转换读错通道），要么上游对这两层还有一层额外的
   透明度来源。最小实验：把该层隔离后对比"默认 / `?pquad=legacy` / 给该层手工把 quad 缩到 1/10"三档的
   同相位截图，量同一像素带的绝对亮度，判定"是不是只要 quad 尺寸合理就与上游一致"。
2. **上游对粒子层 `scale` 的取值**：其 `syncLayerTransform()` 读的是它自己解析出的 `layer.scale`，是否
   与本仓的 31.27/10.27 同值需要一次直接读数（产物页没有公开该字段 ⇒ 需要在其页面内探针或离线复算）。


### 2k.5 三条新读数（2026-10-05·第 46 轮）：全库尺寸分布 / 线性标定 / 作者预览不可用作基准

**① 全库「单颗粒子世界边长 ÷ 设计空间」分布**（离线扫 51 包 / 278 个粒子层；口径 = `sizerandom.max ×
instanceoverride.size ÷ 2 × 图层 scale`，两条轴取较大者）：

| 区间 | 层数 |
|---|---|
| `<0.1×` | **228**（82%） |
| `0.1–0.5×` | 33 |
| `0.5–1×` | 7 |
| `1–3×` | **10**（4%） |
| `3–10×` / `>10×` | 0 / 0 |

本包两层 `Light shafts 0` 是**全库第 2/第 3 大**（1.83× 与 2.06× 设计空间；最大的是 `3351163962` 的「雾 2」
2.55×）。⇒ **"逐轴乘图层 scale"这条口径不是系统性错误**（96% 的层都落在设计空间内），本包是作者写出来的极端样例。

**② 线性标定（同一次挂载内改 `layer.scale` 乘 k；`raw→layer` 同步不碰 `scale`，所以能稳定生效）**：

| k | 整帧 p50 | `>220` | `≥250` |
|---|---|---|---|
| 1（现状） | **248** | 71.6% | **45.4%** |
| 0.5 | 175.3 | 33.5% | 9.6% |
| 0.33 | 148 | 20.2% | 4.5% |
| 0.2 | 145（= 无粒子基线） | 9.4% | 1.6% |
| ≤0.1 | 145 | 5–6% | 0.8% |

⇒ 泛白量是**光束世界尺寸的单调函数**：要落到"不糊屏"的量级，这两层的 quad 需要约为现状的 **1/3**（k≈0.33 时
`≥250` 4.5%，与上游产物档 1.7% 同量级）。隔离档同样印证：默认档光束区 p90 直接打到 **255**（削平），
`?pquad=legacy` 时 14 帧里光束完全不上量（20×35px 的小片 + alpha≈0.3，测不出）。

> **⚠ 2l 更正（2026-10-06）**：本表里的"现状"是 **P-236 之前**的口径（`instanceoverride.alpha` 被算子逐帧还原，
> 两条光轴层按 alpha=1 在画）。修后同相位 ×1 档已落到 p50 **174.8**（上游 172.8），所以"需要 1/3"这个**绝对修正量
> 不再成立**；本表仍然成立的部分只有定性结论——泛白随光束世界尺寸单调增长。尺寸口径本身未被推翻
> （2k.5① 的"96% 的层都在设计空间内"依旧说明"逐轴乘 scale"不是系统性错误）。

**③ 作者预览（`preview.gif`）不能当基准**：它是 104 帧 200×200 的**特写**（全部帧都怼在人物身上，
最"宽"的一帧也只是胸口/书），统计出来 p50 167–210 / `≥250` 2–8% 反映的是**白色衣服**而不是光轴。
⇒ 1× 全场景的对照基准只有上游产物档一个；需要 WE 真值的场合必须另找全景素材（作者其他投稿/视频）。

**下一步（越小越好）**：在隔离档里比 "各向异性 = 现状 (31.27, 10.27)" vs "各向同性 = 只用较小轴 (10.27, 10.27)"
两种口径的光束**形状**，与上游产物档同相位的全帧统计对拍（上游 `≥250` 1.7% / p50 174），定出正确的尺寸口径；
在此之前不改默认口径（`?pquad=legacy` 是可用的 A/B 与观感绕过）。


**④ 相机档位不是混淆项**（同相位各 8 帧）：`campose=legacy`（关场景 zoom）p50 **243.5** / `≥250` 38.4%；
缺省 `campose=full` p50 **247.3** / `≥250` 46.8%；两者隐藏全部粒子层后都回到 **145**（`≥250` 0.74%）。
⇒ 泛白与相机口径无关（24s 后两档取景已一致）。

**⑤ 另一个独立差异（登记待查）**：把粒子层全部隐藏后，本仓 p50 **145** 而上游产物档同相位是 **174.2**
⇒ **非粒子内容本身我们就比上游暗 ~29 级**（本仓 `>220` 4.9% vs 上游 17.9%）。这条与光轴无关，方向相反，
下一轮单列调查（可能是取景/背景层/效果链的差异，不能与光轴的过亮混为一谈）。

---

## 2l. 定案（2026-10-06·第 47 轮）：泛白**主因是 `instanceoverride.alpha` 每帧被算子基线还原**（P-236）

### 2l.1 判据：把上游产物档当"改包的对照组"

前几轮只能在**本仓档**里改运行期状态（`layer.__lnHidden` / `layer.scale`），没有"官方渲染器对同一份输入怎么响应"
这条基准线。本轮补上：**直接改包**（`<id>/scene.pkg` 是无压缩容器：`[u32 strlen][magic][u32 count]{nameLen,name,offset,size}`
+ 原样数据段），把改过的包同时喂两档（本仓档 `?pkgpath=`、上游产物档 `window.__wp.loadSceneFile(blob, projectJson)`），
于是"同一份输入、两个渲染器"成了可判问题。四个用例（1280×720，两档各在装载后 26s 起连采 4 帧）：

| 用例 | 上游产物档 | 本仓档（修前） | 本仓档（修后） |
|---|---|---|---|
| 原始 | p50 **176** / mean 163.1 | p50 **252.5** / mean 219.6 | p50 **174.8** / mean 179.9 |
| 抽掉两条光轴层 | p50 159 / mean 154.0 | p50 147.3 / mean 148.2 | p50 147.3 / mean 148.2 |
| 光轴 `instanceoverride.alpha = 0` | p50 **159** / mean **154.0**（= 抽掉，逐位相同） | p50 **250.8** / mean **218.7**（**完全没变**） | p50 **147.8** / mean 148.6（= 抽掉） |
| 光轴 `scale × 8` | p50 172.8 / mean 167.0 | p50 253.8 / mean 245.6 | p50 205 / mean 200.4 |

⇒ 上游档"把 `alpha` 改成 0"与"删掉这两层"**逐位相同**（159/222/154.01/11.06/0.57 三项读数一字不差），说明官方
渲染器确实读 `instanceoverride.alpha`；而修前的本仓档同一份包**读数一动不动**（mean 243.47 → 243.49，差 0.02）
—— 覆写值被逐帧吃掉了。

### 2l.2 根因与修法

`alphafade` / `alphachange` / `sizechange` 三个算子每帧都是**从基线缓存重建**：

```
alphafade:    p.alpha = (p._initAlpha ?? 1) × 淡入淡出系数
alphachange:  p.alpha = (p._initAlpha ?? 1) × 线性插值
sizechange:   p.size  = (p._initSize  ?? 20) × 线性插值
```

而 `_initAlpha` / `_initSize` **只有** `alpharandom` / `sizerandom` 会写；`instanceoverride` 走的是
`applyInstanceOverride`（`p.alpha *= io.alpha`、`p.size *= io.size`），**没同步这两个缓存**（`P-74` 当年只验了
`applyInitializer` 之后的出生值，算子跑过之后的值没人回头验）。所以"预设没有 `alpharandom`/`sizerandom`、
又带 `alphafade`/`sizechange`"的层，覆写值在每个算子里被还原成 `?? 1` / `?? 20`。

修法（`core/we-scene-bundle.js` `applyInstanceOverride` 末尾两行）：覆写落进基线缓存
—— 语义依据 = 官方把 override 当作**追加在作者 initializer 之后的最后一条 initializer**（wer-ref
`WPSceneParser.cpp:1427` + `ParticleModify.h:127/165/169/173`），即它改的就是"基线"本身。
无覆写时 `m()` 恒 1、且 `?? 1` / `?? 20` 的兜底值恒等于出生默认（alpha=1 / size=20）⇒ **无覆写层顶点流逐位不变**。

### 2l.3 影响面（离线扫 51 包 / 278 粒子层 / 245 个带 override 的粒子层）

| 类别 | 层数 |
|---|---|
| 有 `alpha` 覆写（≠1）+ 算子含 `alphafade`/`alphachange` | **72**（其中预设无 `alpharandom` 的 58） |
| 有 `size` 覆写（≠1）+ 算子含 `sizechange` | **31**（其中预设无 `sizerandom` 的 0） |

命中样例：本包两条 `Light shafts 0`（0.35 / 0.24）、`Sakura` 0.87、`雪景远景` 0.63、`光束 1 (旧)` 0.17–0.77、
`Dust motes` 0.80、`Glowing Stars` 0.19–2.0、`Sparkle` 0.30–0.75…（覆写是"调暗"的占绝大多数 ⇒ 修前这些层**普遍偏亮
1.1×–5×**）。注意 `alphaOp` 命中集比"无 `alpharandom`"集**更大**：有 `alpharandom` 的层同样丢覆写（缓存里存的是
随机值、不是"随机值×覆写"），只是丢得没那么彻底。

### 2l.4 修后仍存的差异（登记，非 alpha 路径）

**只画两条光轴层**的受控对照（同一个改过的包，rate×10 / alpha 0.05 免得削顶；空场景基值两档同为 **178.0**）：

| 用例 | 上游档 Δmean | 本仓档 Δmean |
|---|---|---|
| 作者原样（rate 0.2 / alpha 0.35 & 0.24） | +7.2 | +22.9 |
| dense（rate 2 / alpha 0.05） | +4.4 | +33.2 |
| dense + `fadeouttime: 0.5` | +2.8 | +33.2 |
| dense + `fadeouttime: 0.99` | +5.4 | +42.3 |
| dense + `fadeintime: 0.9` | +2.3 | +23.0 |
| dense + `scale ÷ 8` | +0.5 | +1.1 |

逐像素拆开看（`scale ÷ 8` 那一档，几何小到不重叠）：**覆盖** 3.63% vs 5.92%、**覆盖处增量均值 12.1 vs 12.5**
⇒ **单颗粒子的亮度口径现在两档一致（12.1 ≈ 12.5）**；×1 档的差距（覆盖 2.2×、增量 2×）来自**几何重叠**
（quad 世界边长还有约 1.3–1.6× 的系统差，且 ×1 时重叠层数被放大）。这条与 alpha 无关，**2l.5 定案**：
两档用的贴图内容根本不同（上游产物档内置资产是程序化替身）。

**另一条同轮登记的读数**：`fadeouttime` 缺省值我们写的是 `0.5`，官方响应曲线（上游档：`0.5`→+2.8、
缺省→+4.4、`0.99`→+5.4）说明官方缺省在 **0.5 与 0.99 之间**；参考实现（MIT `webwallgl`）注释写的是编辑器缺省
`0.1 / 0.9`，但本轮数据不足以下结论 —— 保留 `0.5`，登记为待定项（不属本条修复）。

### 2l.5 定案 2l.4 的剩余差异：**上游产物档对官方内置贴图用的是程序化替身**（2026-10-06）

2l.4 的"我们比上游亮/大"这条**不能再当成缺陷**：两档用的根本不是同一张贴图。证据链：

**① 产物档源码里 `particle/light/light_shafts_*` 是**生成函数**，不是文件**（`demo/assets/renderer-n-Rw_ZVc.js`，1MB 单文件）：

```js
"particle/beam/beam_0":()=>Nc(128,512,.46,!0), "particle/beam/beam_1":()=>iT(32),
"particle/light/light_shafts_0":()=>ws(0), "particle/light/light_shafts_1":()=>ws(1), … "light_shafts_4":()=>ws(4),
```

`ws(t)` 从一个**小控制网格** `hm[t].grid` 双线性插值 + 幂曲线（`k*Math.pow(k,p)`）**现算** 一张 RGBA 贴图，
且 `rgb = alpha = 灰度`（`u[S]=u[S+1]=u[S+2]=u[S+3]=g`）⇒ 出来的是一团**平滑软斑**，天然没有真实贴图里的条纹。

**② 真贴图只有一份，我们读的就是它**：`particle/light/light_shafts_0.tex` 在本机 5 处 Steam/WE 安装副本
**sha256 完全一致**（`b3bd05c33be04074…`，129604 B，format 8 / RG88 / 256×512；R 通道恒 255、G 通道是形状，
max 228），`/weassist/materials/particle/light/light_shafts_0.tex` = 200 直出同一份字节。

**③ 单颗粒子对照（把包改成"1 颗、尺寸固定 900、无速度、寿命 60s"，两档同相位）**：

| | 上游产物档 | 本仓档 |
|---|---|---|
| 覆盖 | 43.35% | 69.37% |
| 覆盖处增量均值 / 帧内最大 | 17.1 / 231 | 28.7 / 255（削顶） |
| 画面形态 | **一团从左上到右下渐隐的软斑**（`/tmp/sh-upstream-o-single.png`） | **一条条斜向光带**（贴图里的真实条纹，`/tmp/sh-repo-o-single.png`） |

⇒ 差异来自"软斑 vs 条纹"的**内容**不同，不是我们的尺寸/alpha 口径错。**结论**：
① 本节 2k.2/2k.5 里"上游 `≥250` 1.71% ⇒ 我们该把光轴缩到 1/3"这条推断**作废**（基准贴图不同）；
② 凡是用到 **WE 内置资产**（`particle/*`、`util/*`、`masks/*` 等不在 `scene.pkg` 里的贴图）的层，
"与上游产物档对拍"都**不能**当作像素真值 —— 产物档对这些资产是**近似替身**，本仓是**读用户本机 WE 安装的真字节**
（也没有再分发官方资产，见 `THIRD-PARTY.md`/`COPYING-RULES.md`）；
③ 需要真值时必须换基准（桌面 WE 截图/作者全景素材），或只比"有/无该层""层是否响应某个字段"这类**可判语义**
（P-236 用的正是后者：`instanceoverride.alpha=0` 与"删层"逐位相同——这个判据不依赖贴图）。

**仍登记待定的读数**：`alphafade.fadeouttime` 缺省值我们写的是 `0.5`；上游档响应曲线（显式 `0.5`→+2.8、
缺省→+4.4、显式 `0.99`→+5.4）说明官方缺省落在 **0.5 与 0.99 之间**，但这条曲线的**基准贴图也是替身**
（见上）⇒ 数值只能作"量级"参考，本轮不足以为缺省值定案 —— 保留 `0.5`。

---

## 2m. 「图层被隐藏（如层21）」的取证（2026-10-06·第 47 轮）：不是我们多隐藏

三条读数（同一份包，本仓档）：

**① 可见性普查（离线：原始 `visible` vs `parseScene` 后的 `layer.visible`）**：82 层里
**原始 true 却被我们隐藏的 = 0 层**；原始 false 却被我们显示的 = 1 层 —— `Clock`
（`{user:{condition:"3",name:"time"}, value:false}`，属性表缺失时按"组内绝不空手"的兜底留一个变体，
P-231 已写进判据）；另有 **3 层挂载瞬间 `alpha = 0`**（`options.startpaused` + `alpha` 轨道第 0 帧，
官方语义"停帧 0 = 隐藏，等脚本 `getAnimation().play()`"，见 P-228l）⇒ 没有任何"作者要显示、我们藏起来"的层。

**② 真机基线与 `pussy`（censorship 层）**：挂载后 `pussy.visible=false`（作者原文就是 `false`）、
`panci cover up.visible=true`、`eyelids1`（`__sceneLayers` 下标 **21**，即"层21"若按 0 基编号就是它）
`visible=true`。按 1 基编号"层21"= 下标 20 = `pussy`（作者原文 false）⇒ **两种编号下都不是我们藏错**。

**③ 菜单项为什么点不到（这一条才是真问题）**：`设置2-穿上内内` / `设置3-我要涩涩` 的 `origin` 在
`scene.json` 里是 **`{script:…}`**（不是静态串），运行期由脚本逐帧重算 ⇒ 真机上读到
`origin=(-3159, 1712)/(−3159, 1312)`：**停在画布左侧外面**，只有作者的"打开菜单"脚本把整组菜单挪进来之后
才可能被命中。所以"点菜单 ⇒ pussy 显/隐"这条链**不是脚本没跑，而是菜单没开时点不到**（§2i 的"一次性写入是瞬态"
同因）。两个 `cursorClick` 的语义已离线复核（`--call`）：`穿上内内` ⇒ `panci.visible=true` + `pussy.visible=false`；
`我要涩涩` ⇒ `panci=false` + `pussy=true`；两者都只写在 `cursorClick` 里，**没有任何 load-time 写入**
（全包 4 处 `pussy` 引用：1 处层定义 + 1 处 `model` 名 + 2 处就是这两条 `cursorClick`）。

**下一步（越小越好）**：真机导航一轮 —— 先点"打开菜单"的锚层（`中-菜单-浮动`/设置图标），再点 `设置3-我要涩涩`，
读 `pussy/panci` 的翻转与 `__mpwCursorDispatch.hits`；这条链要在**同一次挂载**内连点两步，
用 `layers[i].origin` 逐帧读数确认菜单真的移进来了再点，否则就是本轮这种"点在画布外"的假阴性。

---

## 2n. 菜单链第二轮（2026-10-06·第 48 轮）：**触发条件是"900ms 内连点 4 次"**，且脚本驱动的 `visible/alpha` 到不了渲染层

### 2n.1 触发条件（离线去混淆：`tests/script-string-decode.mjs` ＋ 本轮入库的 `tools/script-deobfuscate.mjs`）

`ldfk`（id 541）是**整画布命中层**（`models/util/projectlayer.json`，size 6080×3420、origin=画布中心）。它的
`visible` 脚本（`tests/script-string-decode.mjs --chain` 列出本包 **73 个脚本驱动字段 / 40 层**：`visible` 27、`origin` 19、
`text` 11、`alpha` 11、`scale` 4、`volume` 1）逻辑为：

```js
let count = 0; var pos = new Vec3();
function cursorClick(e) { count++ }
function update(v) {
  if (thisScene.getLayerIndex(thisLayer) != 0x3d) { … }
  count = Math.max(count, 0)
  if (count >= 4) {                       // ← 900ms 内连点 4 次
    shared[0x10] = 2                      // 菜单打开标志（shared[16]）
    count = 0
    pos.x = input.cursorWorldPosition.x; pos.y = input.cursorWorldPosition.y
    thisScene.getLayer('中-菜单-浮动').origin = pos   // 菜单锚点**移到光标**
  }
  return v
}
function init() { engine.…(() => { count-- }, 0x384) }   // 0x384 = 900ms 的计数衰减
```

菜单项那一族：`设置1-返回`/`设置2-穿上内内`/`设置3-我要涩涩`/`设置4-开关音乐`/`安全模式` 的 **`alpha`、`visible`、
`origin` 三者都是脚本**，读同一个 `shared[16]` 与锚点位置：

```js
// alpha 脚本（设置3）：shared[16] == 2 ⇒ 淡入；否则淡出
function update(t) { return shared[0x10] == 2 ? WEMath.mix(t, 1, 0.03) : WEMath.mix(t, 0, 0.08) }
// cursorClick（穿上内内）：shared[16] = 1; panci cover up.visible = true;  pussy.visible = false
// cursorClick（我要涩涩）：shared[16] = 1; panci cover up.visible = false; pussy.visible = true
```

⇒ **本包 UI 的完整触发链**：① 画布上 900ms 内连点 4 次 → 菜单锚点移到光标 + `shared[16]=2`；
② 菜单项淡入（`alpha` 脚本）；③ 点条目 → `shared[16]=1`（菜单收起）+ 该条目的副作用（pussy/panci 翻转、音乐、返回…）。

### 2n.2 真机读数（本仓档，`?shell=0`，1280×720）

连点 5 次（每次间隔 110ms）后：`__mpwCursorDispatch.clicks=5`、`hits` 首位 = **`ldfk`**（命中链端到端通）；
把缓存里 `ldfk` 的 `update`/`cursorClick` 包一层计数（`window.__mpwScriptCache.map`，`owners` 含 `ldfk`）：
**`update` 19 次（≈4Hz，回报 `in:true → out:true`）、`cursorClick` 5 次、`updateErrors 0`、`initError null`**。
但 **`__mpwSharedWrites` 里始终没有 `shared[16]` 这一笔**，`中-菜单-浮动.origin` 不动、`设置*` 的 `alpha` 也不动
⇒ 作者的"开门"分支在本仓档**没有走到**（脚本确实被调用，卡在它自己的判定/状态共享上）。

### 2n.3 顺带查出的**类别级缺口**：`{script,value}` 节点的值到不了渲染层

`demo.html` 的每帧同步循环里两条门是这样的（`MPW-P64-TEXT-SYNC` 段之后）：

```js
if (typeof raw.alpha === 'number' && Math.abs((l.alpha||1) - raw.alpha) > 1e-4) { l.alpha = raw.alpha; synced++ }
if (typeof raw.visible === 'boolean' && l.visible !== raw.visible) { l.visible = raw.visible; synced++ }
```

而脚本宿主是把结果写进 **节点对象** 的 `value`（`applySceneScripts`：`scriptVal.value = formatResult(result)`）——
节点仍是 `{script, value}` 形态 ⇒ **两条 `typeof` 门恒不成立**。真机对照：`设置3-我要涩涩` 的 `raw.alpha` 读数一直是
`{val:1, script:true}`、`layer.alpha` 也一直 1（作者的淡出逻辑本该把它推向 0）；`raw.visible` 同理。
`origin` 有专门的 `lib.syncScriptOrigins()`（读 `raw.origin.value`）所以只有它通。
⇒ **凡"靠脚本改 `visible`/`alpha`/`scale`/`angles`"的层（本包 27/11/4 个字段），在本仓档都不会有动态变化**：
这正是"菜单/心跳/翻页/耳朵悬浮"这类交互在本仓档看不到的**类别级**原因；下一步按 `syncScriptOrigins` 同款补一条
`{script,value}` 同步（按载体重算，`?scriptsync=legacy` 回退），再用本包的连点 4 次重新验收。

---

## 2o. 逐层归因定案（2026-10-06 · HEAD 0.5.19）：过曝 = 两条光轴；第 22/23 层（下标 21/22）**渲染是忠实的**

### 2o.1 过曝归因（1280×720，默认相机档；每档 3–4 帧取均值；`≥250` = 饱和像素占比）

| 档 | `≥250` | 全帧均值 | 4×3 分格均值（左上→右下） |
|---|---|---|---|
| 基线（全画） | **21.7%** | 181.0 | 172 175 160 116 \| 224 224 215 165 \| 157 205 200 158 |
| 只隐藏 #25（`Light shafts 0` 第一条，`?ln=25` 反档） | **6.4%** | 156.4 | 162 154 152 114 \| 208 171 169 137 \| 157 192 160 101 |
| 只隐藏 #26（`Light shafts 0` 第二条） | 14.6% | 170.7 | 148 161 155 115 \| 204 216 205 157 \| 124 201 207 156 |
| 两条都隐藏 | **0.88%** | 148.3 | 137 160 156 114 \| 178 180 175 136 \| 115 173 154 101 |
| 恢复全画 | 21.7% | 181.0 | = 基线 |

**贡献（全帧均值差）**：**#25 = +24.6**、**#26 = +10.3**、两条合计 **+32.7**，而"各自单独相加" = 34.9
⇒ **可加**（没有重复绘制/双重叠加那类结构性问题）。单层隔离档也一致：`?ln=25` 单独上屏 mean 196.8 / `≥250` 1.7%，
`?ln=26` 单独 mean 184.8 / `≥250` 0%。落点也不是一条窄带，而是**整幅抬亮**（分格表可见中上部从 224 掉到 171–208）。

⇒ 结论：**用户看到的"过曝/非常白"就是这两条光轴**，且**第一条（1-based 第 26 层 = 下标 25）是主因**。
这两层的作者值就是加色、`instanceoverride.alpha` 0.35 / 0.24、单颗粒子世界边长全库第 2/3 大（§2k.5①），
而 P-236 之后我们已经**如实**按作者的 alpha 画（把 `instanceoverride.alpha` 改 0 ⇒ 与删层逐位相同，§2l.1）。
与上游**网页产物档**的差值（它 +6.7 vs 我们 +32.7）已在 §2l.5 / `THIRD-PARTY.md` §18 定案：
产物档对 WE 内置贴图发的是**程序化替身**（更软的斑），我们读的是用户本机 WE 的**真贴图**——
单颗粒子受控对照里"覆盖处增量 17.1 vs 28.7、覆盖 43% vs 69%"，量级正好解释这个差。

### 2o.2 第 22/23 层（1-based）= 下标 21/22 = `eyelids1` / `eyebrow1`：**没有渲染缺陷**

`?campose=legacy`（全设计空间可见）+ `?ln=<下标>` 与"空帧"（`?ln=999`，同一清屏色）逐像素比：

| 档 | 与空帧不同的像素 | 百分比 | 平均差 | 最大差 |
|---|---|---|---|---|
| `?ln=21` `eyelids1` | 385 | 0.04% | 83.9 | 137.4 |
| `?ln=22` `eyebrow1` | 75 | 0.01% | 50.8 | 112.2 |
| `?ln=23` `hand book`（对照：真有内容） | 29 091 | 3.16% | 51.6 | 148.4 |
| `?ln=24` `front leg`（对照） | 68 104 | 7.39% | 28.1 | 85.6 |

**像素预算对账**（离线读两张 `.tex`，格式 0 = RGBA）：`eyelids1` 633×266、不透明像素(α>128) **7 558（4.49%）**、
不透明包围盒 467×94、αmax 255；`eyebrow1` 500×143、不透明 **1 161（1.62%）**、包围盒 397×37、αmax 255。
1280 宽下 1 设计像素 ≈ 0.21 屏幕像素 ⇒ 期望覆盖 ≈ 7558×0.21² ≈ **333 px**（实测 385）、1161×0.21² ≈ **51 px**（实测 75）
⇒ **实测与"贴图里真正有多少不透明像素"逐项吻合（多出来的是抗锯齿边缘）**。
⇒ 这两层本来就只是**极小的覆盖层**（睫毛/眉毛线），不是"没渲染"也不是"渲染错"；用户"肯定有一层出问题"的直觉在这两层上
**不成立**，真正的异常在 §2o.1 的两条光轴上。

### 2o.3 现场怎么自己复验（无需控制台）
① 选项条「图层开关」下拉（另一会话在做）里，把 `#25` 与 `#26` 两条 `Light shafts 0` 取消勾选 ⇒ 泛白应当场消失；
② 只想看单层：`&ln=25` / `&ln=26`；③ 想回到旧口径对照：`&pquad=legacy`（quad 不吃图层 scale）。
