# 上游 `oneincase/webwallgl` 1.3.17 → 1.3.23（11 个提交）逐条比对

> **本文是只读调研的产出**：写作期间**没有修改任何代码**，没有 `git add/commit/push`，没有跑门禁
> （未运行 `tests/run-all-tests.sh`）。唯一新增文件就是本文。

## 取证环境与口径（先读，否则本文的行号会误导你）

| 项 | 值 |
|---|---|
| 上游 | `oneincase/webwallgl`，**MIT © 2026 oneincase**；本地 git 检出记作 `<UP>` = `references/vendor-ref/webwallgl/`（工作区相对；即任务书里的 `vendor-ref/webwallgl`），remote `https://github.com/oneincase/webwallgl.git` |
| 上游范围 | `b61e891..origin/HEAD` 的 11 个提交（`origin/HEAD` = `fdfc578`，= 1.3.23） |
| 上游引用方式 | 行号用 `git show <sha>:<path> \| grep -n` 在**该提交之后**的树里取值（`<UP>/…:<line>`）；跨提交未变的文件（如 `pointer.js`）按检出工作树取值 |
| 我们的仓库 | `we-scene-demo`，**仓库相对路径** |
| 我们主渲染器 | `core/we-scene-bundle.js`（根 `we-scene-bundle.js` 是指向它的符号链接；`demo.html:952` 以 `./bundle.js` 引入） |
| **行号会漂移** | 写作期间 `core/we-scene-bundle.js` 正被**另一个写入者实时改写**：11492 → 11538 → 11684 行，md5 连续变化。**本文所有 `core/we-scene-bundle.js` 行号锚定 md5 `596713d6be04295e6a243f5695bc2d18`（11684 行，2026-09-19 00:36）**；同时给出**可 grep 的锚点串**，行号漂移时按锚点重新定位 |
| 稳定文件 | `demo.html` md5 `a2aa014ad3301a92e521270efad8226c`（6538 行）、`elysia/media-host.js` md5 `b3ea5d618b178469a92da70dd3970d10`、`elysia/we-renderer/core.js` md5 `4dd4d608c1a730b0a2bc1c4a4e658134`（稳定） |

**上游引用纪律**（任务书要求）：本文对上游代码只做**行为描述**，必要时**最多引 3–5 行**并标注 `file:line`；
不复制注释/文案。**本文不产生任何可移植代码**，§3 只列"若要移植，需要登记什么"。

---

## §0 一句话结论

这 11 个提交里，**只有 4 条是我们当前真实缺口且可移植**（`19c5fab` 的 `overbright`、`fdfc578` 的
`_rt_FullFrameBuffer` 懒捕获三修、`6ea9d14` 的 copybackground 合成源 z 序捕获、`8ea8214` 的封面
mip 链 + 三级优先级契约）；用户 6 个未修 bug 里 **bug#1「落花」竖条纹**在写作时**已由另一条工作线
（未提交的 P-133）修掉主因**，上游 `6c324bf` 讲的"软形状封边"**不是**同一类问题（它明确把
`rosetepal` 图集列入**豁免**名单）——真正对口的上游契约在 `particles.js` 的
"UV 分母必须等于实际上传的贴图尺寸"那一段；**bug#3 鼠标拖尾**上游根本没有"拖尾模块"，
它是**指针锁定粒子发射器 + particle trail 渲染器**的组合，可移植的是**坐标契约**（u/v 原点左上、
Y 朝下、v 不翻转；世界像素与 origin 空间 `projH − wy` 两个空间**分开**供给不同消费方；last 快照
按**帧**推进而不是按事件）；**bug#4 视频当场景左侧 1/4 反相**在这 11 个提交里**没有任何对应做法**，
且我们可读代码里**没有任何"对子区域做反相"的路径**（`invert` 只存在于不可重建的 vendored
artifact 的 CSS 滤镜里）——见 §4。

---

## §1 逐提交表

> 列①：sha / 版本　列②：上游改了什么（`file:line`）　列③：行为契约　列④：**我们的对应位置**（grep 所得）　列⑤：可移植性判定
> "可直接移植" = 契约本身与实现语言/架构弱耦合，按规格重写即可；"只可参考行为" = 契约成立但我们的架构差异大，需先做语义映射；"不适用" = 前提在我们这边不成立。

| ① sha / 1.3.x | ② 上游文件（file:line） | ③ 行为契约 | ④ 我们的对应位置 | ⑤ 判定 |
|---|---|---|---|---|
| `19c5fab`<br>1.3.17<br>光斑过亮糊屏 + 歌曲元数据不显示 | `renderer/vendor/we-scene/render/particles.js:593-599`（解析）、`:1300`（乘进实例亮度）<br>`renderer/vendor/we-scene/render/media.js:407-421`（层名→曲名）、`:423-520`（壁纸音频媒体源）<br>`renderer/vendor/we-scene/render/renderer.js:1083-1104`（rec 预建）<br>`renderer/src/scene-mount.ts`（驱动优先级 / `markPlayed` / 长标题扩边）<br>`scripts/particle-raster.mjs:63`（CPU 参考光栅同构） | ①材质常量 `ui_editor_properties_overbright` 乘在精灵 **RGB**（不动 alpha），**缺省 1**，且必须用**显式判空**取值（`Number(null)===0` 会把缺键当 0 全黑）；CPU 参考光栅必须与 GPU 实例装配同构。<br>②壁纸自带音频接成媒体快照：**只有脚本显式 `play()`** 算"正在播放"（装配期自动开播的环境音不算）；曲名回落层名，剥扩展名 **+** 曲号前缀；快照字段是 **getter 视图**且颜色必须是带链式方法的 Vec3；`ended→STOPPED`、`paused→PAUSED`；`duration` 非有限落 0。<br>③媒体驱动优先级：`liveSystem > mediaSource > 壁纸音频 > 模拟源`。<br>④**常量动画控制器必须先于常量脚本沙箱预建**（沙箱创建即同步补发媒体事件 → `getAnimation().play()` 否则拿到中性哑对象、淡入永远 alpha 0）。<br>⑤右对齐长标题：画布边距**只增不减**地对称扩，同步 `it.margin`，跳过 tint 蒙版层，锚点限 `none/center`。 | `overbright`：**全仓（排 `node_modules` 与 vendored artifact `demo/assets/*.js`）grep = 0 命中** ⇒ **完全未实现**。<br>媒体：`elysia/media-host.js:165-542`（快照）、`demo.html:6338-6387`（`mpwMediaTick`，唯一仲裁点）、`:6357`（真源歌名 = 文件名去扩展名）、`:6283-6293`（`artist/album/cover` 只来自注入）。<br>动画控制器：`elysia/scene-scripts.js` 是脚本宿主（`demo.html:955` 引入）。<br>粒子 CPU 参考：我们的对应物是 `tests/particle-render-correctness-test.mjs` / `tests/particle-sprite-verify.mjs`（非 `scripts/particle-raster.mjs`）。 | ① **可直接移植**（纯数值契约，隔离度高；风险：必须同时覆盖 CPU/离线判据，否则"改一边"）。<br>② **只可参考行为**（我们无 `simMedia/createSimulatedMedia/currentMediaDriver`，见 §4；真源是 `demo.html` 的音频面板）。<br>③ **可直接移植**（写成 `media-host`/`demo.html` 的显式优先级函数）。<br>④ **只可参考行为**（我们的沙箱/动画控制器在 `elysia/scene-scripts.js`，需先定位同序竞争）。<br>⑤ **只可参考行为**（我们的文字画布实现在 `elysia/we-renderer/text.js`，无同等 media-placeholder 机制）。 |
| `4b7b07e`<br>1.3.18<br>下雨场景云层静止 | `renderer/vendor/we-scene/render/particle-textures.js:1269`（`cloudDensityTexture`）、`:1304`（`buildBuiltinUtilTexture`）、`:1233-1265`（周期值噪声）<br>`renderer/vendor/we-scene/render/gl-util.js:45`（`wrap` 参数）<br>`renderer/src/scene-mount.ts`（注册 `util/clouds_256` 用 REPEAT） | ①效果链引用的 **WE 安装目录公共 util 贴图**（`util/clouds_256` 全库 36 处/20 张；`util/black` 8 处）不在 `scene.pkg` 里；缺了会让云密度恒等 → 天空是一层**静止伪影**。<br>②云 shader 的 uv 随 `g_Time` **无界增长** ⇒ 采样必须 **REPEAT**，且贴图必须**可平铺**（接缝列差不显著大于内部列差）。<br>③`util/black` = 1×1 不透明纯黑。<br>④非内置名必须返回 `null`，**不能吞掉** pkg/其它来源。 | 效果链侧：`elysia/we-renderer/effects/clouds.js:34`（`loadTexture('util/clouds_256')`）、`godrays.js:14`（同）。<br>资产侧：`$MPW_ROOT/wallpaper_engine/assets/materials/util/clouds_256.tex` **本机存在**（同目录亦有 `black.tex`），经 `/weassist/materials/util/clouds_256.tex` 取出（`demo.html:1510`；服务端路由 `server/we-scene-demo-server.mjs:948-951`）。<br>但 `demo.html:4699` 的**显式全局 util 安装清单只有 3 个名**（`util/noise|util/noflow|util/white`），不含 `clouds_256/black`；`elysia/demo-elysia.js:34` 的 `utilNames` 白名单 5 个名，同样不含。<br>**wrap 硬编码 CLAMP**：`core/we-scene-bundle.js:7633-7634`、`:7726-7727`、`:7775-7776`、`:7942-7943`、`:11323-11324` 六处 `TEXTURE_WRAP_* = CLAMP_TO_EDGE`，无 REPEAT 分支。 | ①**只可参考行为**（我们是"读用户本机 WE 资产"，不是"库自带程序化生成"；且本仓库红线是**不含任何 WE 素材**，把程序化云图当**兜底**才可移植）。<br>②**可直接移植**（若我们把云/神光类 util 贴图按 REPEAT 上传；一行级契约，风险是"哪些名字该 REPEAT"需要一个名单而不是全局改）。 |
| `8ea8214`<br>1.3.19<br>歌曲封面不显示 | `renderer/src/scene-mount.ts`（两处 `gl.generateMipmap`）、`renderer/vendor/we-scene/render/renderer.js:2698-2709`（保留名回落）<br>`renderer/vendor/we-scene/scene/parse.js:480-499`（`textureFallbacks`） | ①封面纹理用 `LINEAR_MIPMAP_LINEAR` 建，**只写 level 0 而不重建 mip 链**时，缩小的封面 quad 会三线性采到**旧占位封面的 mip** —— 真封面已上传、画面却永远显示占位。**上传后必须 `generateMipmap`**。<br>②封面/元数据**三级优先级**：外部真实封面 > 模拟/测试封面 > 壁纸内置封面。<br>③外部源按 `hasMedia` **门控**（播放器停着就不占驱动位，否则面板显示一场空）。<br>④模拟/测试封面只在媒体启用时注册，否则保留名解析不到内容 → 才能落到第三级。<br>⑤parse 合并 `usertextures` 时把**被覆盖的原槽名**另存 `textureFallbacks` 并预载；渲染端仅在保留名（`$` 开头）**查不到条目**时回落到它（有测试封面属第二级，**不**回落）。 | 封面写进 GL：**未实现**。`elysia/media-host.js:357-361` 的 `getCoverForTexture()` 只返回描述符，唯一消费点 `demo.html:6433`；**全仓无 `textures.set('$mediaThumbnail', …)`**；`core/we-scene-bundle.js` 内 `media|thumbnail|usertextures` 命中数为 **0**。<br>`usertextures`：可读源码里**只出现一次，且是 `demo.html:6241` 的注释**（该注释称"解析在 `core/we-scene-bundle.js` 里"——**与事实不符**）。<br>保留名：`core/we-scene-bundle.js:8190-8195` 的 `resolveTextureName` **只有** `_rt_imageLayerComposite*` 一条分支（`:8193`），无 `$` 前缀/保留名分支；查不到即返回 `null`。<br>mip：`core/we-scene-bundle.js:11279` `makeTexture` 用 `MIN_FILTER=LINEAR`、**从不** `generateMipmap`；`makeTextureMip` 只在 POT 时才 `generateMipmap`。`LINEAR_MIPMAP*` 在可读源码 **0 命中**。 | ①**只可参考行为**（我们当前没有封面纹理；一旦实现，这就是必须遵守的契约）。<br>②**可直接移植**（写成显式优先级函数；风险低，收益直接服务于正在做的 Now playing）。<br>③**可直接移植**（`hasMedia` 门控）。<br>④⑤**可直接移植为 parse 侧契约**，但**前置依赖是我们先支持 `usertextures` 合并**（当前为 0）——所以要按"先补 ④ 的保留名机制、再落 ⑤ 的回落"的顺序做。 |
| `6c324bf`<br>1.3.20<br>排气/呼气粒子露透明方块 | `renderer/vendor/we-scene/render/particle-textures.js:680-682`（高斯径向窗 + 低 alpha 截断）、`:1246-1266`（`RIM_SEALED` + `sealRim`）、`:1113-1119`（各档峰值抬高） | ①"按精灵画"的**软形状**内置贴图（烟/雾/火/光斑/气泡/光柱/星芒），**外圈 alpha 必须严格 0**：否则放大成几百~几千像素的 quad 后每个方块的**直边**肉眼可见（几十个叠加成带直边的灰幕）。<br>②必须在**出贴图时**统一加一道 C1 连续的宽 S 形边窗（默认 18% 边带，`drop` 8%），比逐生成器改更安全、可离线审计。<br>③**图集与法线必须豁免**：`RIM_SEALED` 的豁免名单是 `/normal|leaves|lightning|rain1|rain2|rain_drops|rosetepal/` —— 图集的格子边是**帧边界不是精灵边**；法线的 alpha 是折射蒙版。<br>④烟/雾另用**紧凑径向窗**：半径 0.75 外严格 0，且平均 alpha 落在 0.3~12（不能稀到看不见）。 | 我们**不在前端生成内置粒子贴图**：`demo.html:1505-1513` `loadTex` 先在 pkg 找 `materials/<name>.tex`，再 `/weassist/materials/<name>.tex`（服务端映射用户本机 WE 资产），两次都缺就返回 `null`；渲染端 `core/we-scene-bundle.js` 的粒子层**直接跳过**（`[粒子] 跳过无贴图层`，`:10419` 附近）。<br>本机 WE 资产里软形状贴图与**图集都在**：`$MPW_ROOT/wallpaper_engine/assets/materials/particle/{fog/fog1..3,smoke,nature/rosepetals,nature/leaves1..10,…}`（`ls` 实测）。<br>漂移锚点：`export function makeTexture`（`:11279`）。 | **不适用**（我们没有"内置粒子贴图生成器"可封边；贴图直接来自本机 WE 资产，**不得**改写用户素材）。<br>但本条的**豁免名单对 bug#1 是反向证据**：上游明确把 `rosetepal`（落花图集）**排除**在封边之外 —— 说明"落花竖条纹"**不是** `6c324bf` 那一类。 |
| `6ea9d14`<br>1.3.21<br>流光光带缺失 | `renderer/vendor/we-scene/render/renderer.js:1647`（`zOrderComposePersist`）、`:1893-1927`（`captureEmptyComposeAtZOrder`：带效果链 + `await` + 传 `time`）、`:2254`（上一帧成品回填）、`:2286-2291`（GC）、`:2314-2320`（`needsZOrderBackdrop = !!src.copybackground` 路由） | ①**内容 = 身后已渲染画面**的合成源（`copybackground`）**不能在预渲染阶段做**：预渲染跑在主循环之前、画布只有 clearcolor，做出来是**空图** ⇒ 依赖它的中间层拿到空盘带 ⇒ 整段流光消失（只剩静态剪影）。<br>②正解：登记 `pendingEmptyCompose`，主循环走到它的 **z 序**再捕获。<br>③带**可见效果链**的源必须走 `renderLayer` + `groupTarget`（在回读内容上**跑效果链**），否则只有静止副本没有"流动"。<br>④捕获必须 `await` 且把**场景时间**传进去（`g_Time=0` 时 scroll 不流动）。<br>⑤引用方可能排在源之前绘制 ⇒ 源成品**留一帧**给下一帧的预渲染阶段补位。<br>影响面：全库 **44 处** copybackground 合成源引用。 | `copybackground` 解析：`core/we-scene-bundle.js:1525`。<br>我们的**合成源解析**：`resolveTextureName`（`:8190`）里 `if (name.startsWith('_rt_imageLayerComposite')) return inputFBO`（`:8193`）——**返回的是引用层自己的输入 FBO**，正是上游改动**之前**的行为；`:8195` 其余 `_rt_*` 落到命名 FBO 或直接 `textures.get(name)` → `null`。<br>未命中即 `null` ⇒ 后续按透明/白兜底（`:10280` 附近）。<br>我们**没有** `renderCompositeSources` / `compositeFBOs` / `pendingEmptyCompose` / `groupTarget` 这一整套（grep 0 命中，排 vendored artifact）。<br>我们的层自身 copybackground 链输入：`:10016-10260`（RE-08）。 | **可直接移植（行为契约层）**：z 序捕获 + 跑效果链 + `await` + 传时间 + 留一帧。**风险**：我们的渲染循环是单文件 bundle、**没有 `groupTarget` 概念**，需要先补一个"合成源 → FBO"的捕获/缓存结构；改动落在 `resolveTextureName`/`renderLayer` 主干，回归面大（建议先做 `?flag` 档位与逐层 A/B）。 |
| `be3c246`<br>（无版本号，1.3.21 同批）<br>变长骨名 MDLS 记录解析错位 | `renderer/vendor/we-scene/render/mdl-parse.js:309-410`（`parseFixed` / `findHeader` / 顺序重扫 / 回退）、`renderer/vendor/we-scene/render/mdl-skin.js:173-181`、`:302-304`（`identityEarlyOut`） | ①骨骼记录有**三种布局**（A 固定 78B；B 骨名前置变长；C 骨名前置 + 矩阵后变长 JSON 元数据）；固定步进在**第一个命名骨之后永久失步**（`parent` 读成 `0x3F800000`/负值、矩阵退化成垃圾或全零）。<br>②策略：**先按固定布局整体校验**（parent 全合法 + 每矩阵两列单位长度 + 平移有限），通过就逐位采用（旧模型零回归）；任一骨非法才判为变长布局并**顺序重解析**（严格合取定位记录头：`id` 有界 + `parent` 合法 + `len==64` + 矩阵正交有限 + 头前一字节是名字终止 `00`）；重扫必须**拿全所有骨且全合法**才采用，否则回退固定解析，**绝不返回残缺骨架**。<br>③**零动画且无覆写的 puppet 不能再提前 return**：早退会让 `_world` 停在未填充的零矩阵 → 附着点 `cur=(0,0)` → `followAttachments` 算出 `delta = 0 − 绑定偏移`，把挂在"无动画中间 puppet"上的挂件**整组反向拽飞**（表现为"头顶浮出第二个人/身体"）。正确做法：**仍跑完骨骼循环把 `_local/_world` 填成绑定姿势**，但返回值语义不变（仍 `null`，让 draw 走 identitySkin），从而 `cur ≡ bind`。 | 骨架解析：`core/puppet-skin.js:52`（`indexOfBytes(buf,'MDLS',9)`）、`core/attach-transform.mjs:152`、`elysia/we-renderer/puppet.js:114/332/377-387`（有严格帧头校验的同类思路）。<br>附着/follow：`core/attach-transform.mjs:288-335`（`puppetBoneFinal`）、`:339-362`（`selectAnimLayers`）、**`:366-402`（`attachmentOffset`，即"follow"）**、`:406-465`。<br>**高度可疑的对应点**：`core/attach-transform.mjs:301` —— `if (!layers \|\| !layers.length) layers = [{ animIdx: 0, blend: 1, rate: 1, additive: false }]`，即**没有 authored `animationlayers` 的 puppet 会被强行套上 animation[0]**（含头/身体骨），而不是绑定姿势；同一写法在 `elysia/we-renderer/puppet.js:98` 重复一次。<br>另：`demo.html:2519` 的 attach 上下文用 **`time: 0` 静态快照**（`core/attach-transform.mjs:395` 吃 `ctx.time \|\| 0`）⇒ 父网格在动时子件不会逐帧重跟。 | ①**只可参考行为**（我们的 MDLS 解析是另一套实现；须先**自证**是否也失步 —— 见 §4"未证实"）。<br>②**可直接移植为判据契约**（"先校验后重扫、拿不全就回退、绝不返回残缺骨架"这套**校验思路**与代码无关）。<br>③**可直接移植**（"无动画 puppet 必须填充绑定姿势、禁止早退"是纯行为契约；我们的 `core/attach-transform.mjs:301` 正是它的反面）。 |
| `2c717be`<br>（无版本号）<br>点开关圆片不滑动 | `renderer/vendor/we-scene/render/text.js:1659`（`LOCAL_VEC_SLOT = { origin: 'localOrigin', scale: 'localScale' }`）、`:1666`/`:1676`（getter 读 local、setter 写 local）、`renderer/src/scene-mount.ts`（`sceneApi.markTransformDirty` + 每帧 recompose 前并入脏集） | ①脚本经 `thisLayer` / `thisScene.getLayer(x)` 写 `origin`/`scale`/`angles` 时必须落 **local 槽**（与对象脚本 `update` 返回值的写回空间一致，作者坐标是父级相对空间）。<br>②**顶层**层 `local === world`，立即同步 world（本帧渲染 / hit-test / 脚本读回都拿新值）。<br>③**子层** world 含父变换、不能直接填 local ⇒ 必须**标脏**，由宿主在**本帧 recompose 阶段**从父链合成。<br>④getter 读 local 优先。<br>⑤若只写 world，而该字段又绑了脚本（哪怕脚本整段被注释）⇒ `collectTransformDirty` 会把它收进脏集 ⇒ **同一帧稍后的 recompose 用未变的 local 覆盖 world**，位移被逐帧冲掉（"脚本在跑但画面不动"）。 | 我们**没有 local/world 三件套 + 每帧 recompose** 这条流水线：`grep -rn "recomposeWorld" core elysia demo.html` = **0 命中**；`localOrigin` 只有 `core/we-scene-bundle.js:1449/2209-2217` 的 props 面板簿记（`__localOrigin`/`__authOriginWorld`）与 `tests/props-panel-test.mjs:314`，**不是**每帧 recompose 的输入。<br>我们的 SceneScript 宿主是 `elysia/scene-scripts.js`（`demo.html:955` 引入），层引用见 `elysia/scene-scripts.js:144/160/208/239`。 | **不适用**（前提不成立：我们没有"每帧从 local 重算 world"这一步，脚本写 world 不会被同帧冲掉）。<br>**但**：若日后引入 local/world 分离（例如为了修 Kaltsit 的附着/父子变换），本条的**③④两条契约必须在同一批里实现**，否则会**新造**出这一类"写了被冲掉"的 bug。 |
| `9beb420`<br>（1.3.22 的实现部分）<br>生命周期/存储/粒子挂点 + BGM 频谱 + 环境光 | `renderer/vendor/we-scene/render/storage.js:34-102`（`makeSandboxStorage`）<br>`renderer/vendor/we-scene/render/text.js:930-960`、`:2094-2118`（`callResize`）<br>`renderer/vendor/we-scene/render/renderer.js:244-249`（`layerColorAmbient`）、（`renderScene` 每帧读 `general.ambientcolor`）、（`renderLayer` 的 `color4` 乘 ambient）<br>`renderer/vendor/we-scene/scene/parse.js:279-292`（`particleOverrideScripts`）、`:398-402`（`playing/paused/play/pause/stop`） | ①`localStorage` 语义：**同一张壁纸的全部脚本（五个 eval 点）共享一份**、**跨会话持久**；`LOCATION_SCREEN` / `LOCATION_GLOBAL` 两级；WE 文档方法名是 `delete`（`removeItem` 是 DOM 名，语料还有 `get/set/remove` 别名）；约 100KB。<br>②`resizeScreen(size)` 是官方生命周期事件，签名是**单个 Vec2**（脚本读 `size.x/size.y`），宿主在**画布尺寸变化（含首帧）**时以 **CSS 像素**派发，并同步 `engine.screenResolution`；纯 `resizeScreen`/纯 `init` 脚本也必须过沙箱闸门（否则事件到了没人接）。<br>③`engine.timeOfDay` 必须**随真实时间刷新**（秒级），不能挂载时取一次就冻结。<br>④自带 BGM 的频谱要**并入**音频快照（逐频段取 max，**在副本上**合并，绝不就地改模拟器内部数组），且在 `fillAudioBuffers` **之前**完成。<br>⑤材质开 `LIGHTING` combo 时基色乘 `max(0.001, general.ambientcolor)`。<br>⑥`instanceoverride` 带 `{script}` 的键逐帧求值：`rate/count/size/alpha` 是轻量写口（不重建 pool）；`colorn` **只影响之后出生的粒子**（WE 语义）。<br>⑦`animationlayers` 的 `playing===false` 该层不参与蒙皮；`getAnimationLayer(name)` 返回 **MDL clip** 控制器。 | `localStorage`：`elysia/scene-scripts.js:462-469` —— 每个沙箱一个**进程内 `Map`**，**既不跨脚本共享也不跨会话持久**（注释明说"不碰宿主页面的存储"）⇒ 与①**正面冲突**。<br>`resizeScreen`：`grep -n resizeScreen elysia/scene-scripts.js elysia/scene-script-apis.js` = **0 命中**。<br>`timeOfDay`：上述两文件 **0 命中**。<br>`ambientcolor`：上述两文件 **0 命中**（`core/we-scene-bundle.js` 亦无）。<br>`instanceoverride`：上述两文件 **0 命中**。<br>引擎对象在场字段：`elysia/scene-scripts.js:495-497`（`canvasSize` / `frametime`）、`:443`（`cursorWorldPosition`）；`getAnimationLayer` 存在（`:144/160/208`）但**不返回 MDL clip**；`getMaterial` 是空实现（`:239`）。 | ①**可直接移植**（契约清晰、与实现解耦；风险：需要"按壁纸命名空间 + 可选持久后端"的宿主接线，和我们"不碰宿主存储"的现有纪律要重新定调）。<br>②**可直接移植**（新增一个生命周期钩子族；风险：CSS 像素 vs backing 像素的口径必须一次说清，否则 DPR 会进比较）。<br>③**可直接移植**（秒级刷新，改动小）。<br>④**可直接移植**（我们已有 BGM/音频面板，合并口径明确）。<br>⑤**不适用/低优先**（我们可读渲染路径未跑完整 PBR，且 `LIGHTING` combo 命中面极小）。<br>⑥⑦**只可参考行为**（前置：我们的粒子 override 脚本挂点与 MDL clip 控制器尚未对齐到这套语义）。 |
| `3dbe3fd`<br>1.3.22 版本号提交 | `package.json`、`README.md`、`README.en.md`（**仅文档与版本号**，`git show --stat` 3 文件） | 无行为契约（纯版本标记）。 | —— | **不适用**。 |
| `9215467`<br>（1.3.22 后续）<br>Retina/HiDPI 渲染分辨率 | `renderer/src/shell.ts:25-42`（`MAX_BACKING_EDGE = 4096` + `effectiveDpr`）、`renderer/src/api/types.ts:286-296`、`renderer/src/api/mount.ts`（默认 0）、`renderer/src/media.ts` / `video-loop.ts:73-84` / `video-webcodecs.ts:79-89`（**视频解码仍以设备 DPR 为上限**） | ①`renderDpr` 语义改为 **0/缺省 = 自动跟随设备 DPR**；**正数 = 目标 DPR，允许高于设备上报值**（宿主 WKWebView 误报 1 时仍能超采样到物理分辨率）；旧 `min(设备DPR, renderDpr)` 会把高清档钉死在逻辑像素。<br>②物理**最长边封顶 4096**（超采样超出部分等比回收）。<br>③**视频解码缓冲例外**：仍取 `min(设备DPR, 显式上限)` —— 超采样解码只费内存、CSS 放大不会更清晰。 | 我们的 DPR 相关：`core/we-scene-bundle.js:6353` `parseResTier` 的 `auto` 分支（`:6258` 附近 `dpr = max(1, min(2, devicePixelRatio||1))`）——**这是"画布分辨率档位"，不是 backing DPR**；`:6369` 的注释已经写明"上游 1.3.23 **没有**这一档 —— 它的画布尺寸由 `shell.ts` 的 `renderDpr` 管"。<br>画布尺寸来源：`demo.html:4774` `cv.width = __resTier.width`。 | **只可参考行为**（两套机制不同名不同义：我们是 `?res=` 固定档 + `?q=` 内部渲染比例；上游是 backing = CSS × DPR）。**对 bug#4 无直接关系**（见 §2）。 |
| `fdfc578`<br>1.3.23<br>质量档位 + 透视层 + **背景纹理合成三修** | `renderer/vendor/we-scene/render/renderer.js:1345-1377`（`_rt_FullFrameBuffer` 懒捕获 + 保存/恢复 `FRAMEBUFFER_BINDING` 与 `TEXTURE_BINDING_2D`）、`:52-60`（`chainAlphaMeaningful`）、（`pp=off` 三处门控）<br>`renderer/vendor/we-scene/render/math.js:376`（`buildLayerPerspectiveVP`）、`renderer/vendor/we-scene/render/hittest.js`（`perspLayerLocal` 射线–平面求交）<br>`renderer/vendor/we-scene/render/renderer-glsl.js`（`FXAA_FRAG`）、`renderer/src/quality.ts` | **（a）背景纹理合成三修**：<br>①`_rt_FullFrameBuffer`（`backgroundTexture` 隐藏槽，全库 45 张）= **本层绘制之前的画布内容**；此前落空成白纹理 ⇒ `mix(bg, albedo, a≈0)` 在空容器上退化成整屏纯白。正解：**懒捕获**（每帧最多一次）。<br>②**懒捕获的回归教训（必须保存/恢复两处 GL 状态）**：捕获会把帧缓冲绑回画布、把 backdrop 纹理绑到**当前活动纹理单元**，从而**覆盖**同一 pass 里先前绑好的槽（combine 的 `previous`）⇒ 整屏只剩 clearcolor；不恢复 `FRAMEBUFFER` 还会把本次 pass 画进画布。<br>③`g_EffectModelViewProjectionMatrix`（pass 顶点 → **画布 NDC**）此前从未绑定（零矩阵）⇒ `xy/z = NaN`；须按 `compositeLayer` 同一映射转置上传。<br>④容器效果链输出的 alpha 是否"携带形状"的判据：写 `float alpha = <非 scene.a>` 或调用 `BlendTransparency(` 的家族（7 个 shader）**必须**判为携带形状 → 按 `SRC_ALPHA` 合成；误判成"无信息 → 加法"会把已含背景的链输出在画布上叠两遍 → 整屏泛白。<br>**（b）透视层**：`thisLayer.perspective` 的层改用"相机架在可见窗口正前方、`z=0` 平面与正交逐像素重合"的透视 VP，旋转序 `M = T·Rz·Ry·Rx`（符号 X+ / Y− / Z−）；hit-test 配套改成射线–平面求交。<br>**（c）质量档位**：AA `off/fxaa/msaa2/msaa4`、粒子倍率、后处理 `off/low/medium/high`，**热更不重挂载**；MSAA→默认帧缓冲的 blit 在 WebKit 上静默失败，必须经纹理 FBO 中转。 | **（a）** `resolveTextureName`：`core/we-scene-bundle.js:8190`（锚点 `function resolveTextureName`）——只有 `_rt_imageLayerComposite*`（`:8193`）一条特殊分支；**无** `_rt_FullFrameBuffer`/`backgroundTexture` 概念（grep 0 命中）。<br>合成：`compositeLayer`（锚点 `function compositeLayer`，约 `:8365`）+ `setBlend`（约 `:8312`）；我们**没有** `u_Viewport`/`gl_FragCoord` 之外的"按屏幕重采样"通路，`gl.viewport` 全为整帧。<br>混合家族实现：`:5877-5898`（`bNegation`/`bColorDodge`/…）；容器 alpha 语义判定我们另有实现（无 `chainAlphaMeaningful` 同名函数）。<br>**（b）** `perspective`：`grep -n perspective core/we-scene-bundle.js` 有 `buildLayerPerspectiveVP` 同类语义吗 —— 未见同名实现（我们的 `?projmode=` 是**整场景**投影档，`elysia/scene-scripts.js` 的层代理无 `perspective` 读写）。<br>**（c）** 质量档位**我们已经移植过**：`core/we-scene-bundle.js:6338-6396` 整段就是 P-90 对上游 `quality.ts` 的转写（含 `DEFAULT_QUALITY` / `PARTICLE_QUALITY_SCALE` / `POST_FBO_CAP` / `MSAA_SAMPLES` 的逐条出处标注）。 | （a）①**可直接移植**（`_rt_FullFrameBuffer` 语义 = "本层之前的画布内容"；风险：与 `copybackground` 通路重叠，必须一次理清谁负责回读）。<br>（a）②**可直接移植且必须与①同批**（否则重演"整屏灰"回归）。<br>（a）③**可直接移植**（一个 uniform 的绑定契约）。<br>（a）④**只可参考行为**（我们的容器/效果链结构不同）。<br>（b）**只可参考行为**（若我们不做逐层透视；`math.js:376` 的"z=0 与正交逐像素重合"这一条是**可移植的判据**）。<br>（c）**已完成**（P-90），无需再动。 |

---

## §1b 关键契约的原文级证据（按需展开）

> 只列 §2 里要用的、以及"判断依据容易被质疑"的几条。上游引用**每次 ≤5 行**。

**B-1 `6c324bf` 的封边**豁免名单把落花图集排除在外（`<UP>/renderer/vendor/we-scene/render/particle-textures.js:1246-1252`，`6c324bf` 之后）：

```
const RIM_SEALED = [
  { re: /^particle\/(light|beam|fire)\//, band: 0.18 },
  { re: /^particle\/bubbles\/(?!.*normal)/, band: 0.18 },
```
（完整名单另有 `misc|shape`、`star|sickle`、`drop`、`@star|sparkle|trail`；**`nature/rosepetals` 不在名单内**，
且同提交的判据脚本把 `/normal|leaves|lightning|rain1|rain2|rain_drops|rosetepal/` 显式 `continue` 跳过。）

**B-2 真正对口 bug#1 的上游契约**：归一化分母必须等于**实际上传的贴图尺寸**（`<UP>/renderer/vendor/we-scene/render/particles.js:609-616`）：

```
    // 归一化分母：优先用帧表自带的图集尺寸（texture.js 从 mip0 取），退回贴图尺寸。
    // 不能用 .tex 头部的 textureWidth —— 1444077782 那里它是**单帧**尺寸 316x214，
    // 真实图集是 2048x1024。
    // UV 分母必须等于实际上传的贴图尺寸。atlasWidth 来自 mip0，但 decodeMip0
    // 过去会把 POT 填充裁成 TEXI 声明尺寸（matrix 72：512→450），两者不一致
    // 时采样跨到邻帧，掉落代码变成一团碎字（2974757317）。
```
→ **"分母不一致 ⇒ 采样跨到邻帧"** 就是任务书给 bug#1 的假设（"图集取样跨到了相邻帧"）在上游的**等价表述**。

**B-3 我们这边的分母**：`core/we-scene-bundle.js:599-612`（锚点 `export function spriteInfo`）用
`tex.textureWidth || tex.width` 归一 —— 与我们 `spriteFrameImageRects`（`:682`）/`computeSpriteFrameUV`（`:727`）
的帧矩形分母口径**必须逐字一致**；这条**需要一次自证**（见 §4 未证实 U-3）。

**B-4 指针坐标契约**（上游 `pointer.js` 在 11 个提交间**逐字节未变**，`git diff --stat b61e891 fdfc578` 可证）
的核心三行（`<UP>/renderer/vendor/we-scene/render/pointer.js:171-176`）：

```
  function applyMove(x, y) {
    const u = x / state.screenW
    const v = y / state.screenH
```
即 **u/v ∈[0,1]、原点左上、v 与 DOM `clientY` 同号（Y 朝下）**；**不 clamp**；**不插值/不滤波**。
世界像素由 `cam` 换算（同文件 `:286-292`）：

```
    state.wx = cam.offX + state.u * cam.viewW - parOffX
    state.wy = cam.offY + state.v * cam.viewH - parOffY
    state.originY = Number.isFinite(projH) ? projH - state.wy : state.wy
```
→ **两个空间分开供给**：`wx/wy`（渲染世界像素，Y 朝下）给 hit-test 与粒子；`originY = projH − wy`（origin 空间，Y 朝上）
给脚本 `input.cursorWorldPosition`。**粒子拿到的是 `originY ?? wy`**（`<UP>/renderer/src/scene-mount.ts:1669-1676`）——
这一点是"垂直方向反了"最可能的分岔口。

**B-5 "last" 必须按帧推进，不能在事件里推进**（同文件 `:302-306`）：

```
    normalizedDelta() {
      const dx = state.u - state.lastU
      const dy = state.v - state.lastV
```
若在事件回调里推进 last（宿主推送 ~90Hz > 帧率），帧间位移恒接近 0 ⇒ 涟漪类效果**完全不起波且无报错**。

**B-6 拖尾的真实模型**：上游**没有**"鼠标拖尾模块"。拖尾 = ①`controlpoint.locktopointer`（或 `flags` bit0）
的**指针锁定发射器**（`<UP>/renderer/vendor/we-scene/render/particles.js:188-190`）+ ②粒子自己的
`spritetrail` / `ropetrail` 渲染器；③`ropetrail` 才有**逐粒子历史环**（`segments` 夹 2..32、**缺省 8**；
`length` 是**秒**、缺省 0.2；采样间隔 `length/(segments-1)`）。粒子保留自己的坐标 ⇒ 指针"拖出一串过去的出生点"，
而不是一个跟着的球。

**B-7 `4b7b07e` 的 REPEAT 契约**（`<UP>/renderer/vendor/we-scene/render/gl-util.js:41-45`）：

```
  const wrap = opts && opts.wrap === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE
```

---

## §2 与用户 bug 清单的对照表

| # | 用户 bug | 这 11 个提交里有没有对应做法 | 我们的对应位置（含证据） | 建议动作与优先级 |
|---|---|---|---|---|
| **1** | 层 21「落花」渲染成**竖条纹、有条缝/间隙** | **部分有，但不是 `6c324bf`**。<br>①**主因（竖条纹）**：上游没有直接提交，但 `<UP>/renderer/vendor/we-scene/render/particles.js:609-616` 的"UV 分母 = 实际上传尺寸，否则采样跨到邻帧"是同一类契约；<br>②`6c324bf` 的封边**明确豁免**图集（B-1）⇒ **不是**同一问题；<br>③**缝隙/接缝**：上游**没有**半纹素内缩（`halfTexel/inset/bleed/padding` 在 UV 计算里 0 命中），也**没有** NEAREST —— 上游 atlas 同样 LINEAR+CLAMP。 | **主因已由另一条工作线修掉主因**：`core/we-scene-bundle.js:727`（锚点 `export function computeSpriteFrameUV`）新增 `su/sv`；`:754`（锚点 `export function frameRectUVFn`）把 quad `[0,1]²` 映到 cur/nxt 帧矩形；代码注释自述"P-133 之前单图路写的是 `u + cu.u0`（只加原点、**不乘帧尺寸**）⇒ 每颗粒子 u 跨度恒 1.0 = 整张图集宽度（如落花 13 帧 = 1/13）"。<br>**状态**：`git status` 显示 `core/we-scene-bundle.js` **已修改未提交**；`grep -c "P-133" docs/PATCHES.md` = **0**（代码注释引用的文档段**尚不存在**）。<br>图集来源：`$MPW_ROOT/wallpaper_engine/assets/materials/particle/nature/rosepetals.tex`（`ls` 实测存在）；`demo.html:1505-1513` `loadTex`；采样器 `core/we-scene-bundle.js:11279` `makeTexture`（LINEAR/LINEAR + CLAMP_TO_EDGE）。 | **P0（先确认再动）**：①与 P-133 工作线**对表**，不要重复修；②若用户看到的**缝隙**仍在，才做"半纹素内缩 / 图集边缘 padding 感知"这一档 —— 上游**没有**现成参考，属于我们要**自己定标**的部分（列入队列，优先级 P1）；③补齐 `docs/PATCHES.md` 的 P-133 段（**该文档段缺失本身就是风险**）。 |
| **2** | 层 18「雾2」渲染不对（疑 noise 场 / 合成源 / util 贴图缺失） | **有两个候选，但都不是"雾2"的直接对应**。<br>①`4b7b07e`（util 贴图缺失 → 云静止）针对的是**效果链**的 `util/clouds_256`，不是粒子；<br>②`6ea9d14`（copybackground 合成源 z 序捕获）针对的是**跨层合成链**，与"雾2"这种单层粒子无直接关系。 | 「雾 2」= **粒子层**，不是 quad/效果层：`docs/PATCHES.md:2695` 明确 `雾 2（3554161528） \| particle/fog/fog3 \| 8 RG88`；`docs/PATCHES.md:8780/8820` 记录过它的**精灵表帧时序**（`PFRAME_MODE`，`core/we-scene-bundle.js:7001`）。<br>链路：材质 `pass.textures[0]`（`demo.html:1769-1776`）→ `loadTex`（`:1505`，两次 miss 就 `null`，`:1513`）→ 渲染端**跳过该层**（锚点 `[粒子] 跳过无贴图层`）。<br>贴图本机**存在**：`$MPW_ROOT/wallpaper_engine/assets/materials/particle/fog/fog3.tex`（`ls` 实测）。<br>**可疑不一致**：`demo.html:1770` 用 `pass.textures[0]` **原样**做 key，而另一条链 `demo.html:4754-4755` 会 `replace(/^materials\//,'')` —— 两处对同一个 `textures` map 的键口径可能不一致（`materials/` 前缀会被二次前缀化成 `materials/materials/...` 双双 404）。<br>R8/RG88 形状通道：`PARTICLE_FS` 的 `weTexFmt()`（`u_TexFmt`）分支（锚点 `u_TexFmt`）。 | **P0**：**先落判据**——用 `?ln=17` 单独看该层，区分三种失败：**(a)** 层被跳过（日志有 `[粒子] 跳过无贴图层`）⇒ 查 `pass.textures[0]` 的键口径（上文"可疑不一致"）；**(b)** 层在画但是实心矩形 ⇒ 查 `u_TexFmt` 的 R8 分支；**(c)** 帧时序/形状不对 ⇒ 查 `PFRAME_MODE`。<br>**P1（顺手）**：把 `4b7b07e` 的 **REPEAT** 契约移植到云/神光类 util 贴图（一行级，见 §3 移植项 #4）——这修的是**别的**壁纸（有 `clouds`/`godrays` 效果的）而不是雾2。 |
| **3** | **鼠标拖尾**坏掉：只有一个小球、抖动、**垂直方向反了**、移远了就消失 | **有，且是全套**——但上游的"拖尾"不是模块而是**指针锁定粒子发射器 + particle trail 渲染器**（B-6）。可移植的是**坐标契约**（B-4/B-5/B-6）与**发射器无指针时不得发射**的语义。 | 我们的实现是一个**单一入口的正交设计**：`core/we-scene-bundle.js:3570`（锚点 `const __P = em.__ptrLocked`）—— 指针直接当**发射器基准点**：`wx = __P[0] + rpx*scale`、`wy = __P[1] + rpy*scale`，**与作者 origin 的 y 取负约定不同**（作者路径是 `sys.origin[1] − em.origin[1]*scale[1]`）。<br>指针源：`:7001` 同区段的 `__pointerDesign`（锚点 `function __pointerDesign`）——优先 `window.__mpwPointer`（**设计坐标**），否则画布归一化 `__pointerN` 经 `__pointerDesignFromNorm` 换算；y 方向**不做翻转**（设计坐标 y 向下）。<br>`leave`：`__pointerLeave`（锚点 `const __pointerLeave = (why)`）会**清掉** `__pointerN` 并置 `__pointerGone`；页面级 `blur/visibilitychange` 走**挂起**（`__pointerSuspended`，保留坐标）。<br>累计模型：粒子自带位置（同上游）；`ropetrail` 历史见 `core/we-scene-bundle.js` 的 `sys.trail` 段（锚点 `if (sys.trail)`，该锚点在本快照里位于 `:3474`；`p.trail` 数组 + `sys.trail.dt/n`）。 | **P0**：按契约**逐条对表**（不要照抄代码）：<br>① **"移远了就消失"** → 上游 `pushExternal` 只丢弃**非有限值**，**从不 clamp**；我们的 `__pointerDesign` 在"注入缺 `x/y`"时回落 `__pointerN`，而 `leave` 后又清空 ⇒ 请核对"注入坐标超出 0..1/设计尺寸"这条路径是否被某个 clamp 或 `framePointerMap` 判掉（`framePointerMap` 见 `core/web-frame-geometry.mjs`）。<br>② **"垂直方向反了"** → 上游把 `wy`（Y 朝下）与 `originY = projH − wy`（Y 朝上）**分给不同消费方**，粒子拿 `originY ?? wy`；我们的 `em.__ptrLocked` 直接用 `__P[1]` 且**不翻**，而作者 origin 路径**翻了** —— 两条路径的 y 约定不一致是首要嫌疑（需一次真机 A/B 确认"反"的是整条拖尾还是只有偏移）。<br>③ **"抖动"** → 上游把 `last` 快照按**帧**推进（`beginFrame`），绝不在事件里推进；并**不做**插值/EMA。若我们的抖动来自"事件频率 > 帧率"，可移植"按帧推进 last"这一条。<br>④ **"只有一个小球"** → 上游拖尾长度 = 粒子寿命 × maxcount × 发射率；若发射率被音频门控/预算压到 1，或 `spritetrail` 的 `length` 被当 0，就只剩一个精灵。请核对 `em.__ptrLocked` 分支的**发射率**是否被 `?cursor`/预算/音频门控削掉。 |
| **4** | 第 6 个壁纸（视频当场景）**左侧 1/4 画面颜色反相** | **没有对应做法**。<br>①`fdfc578` 的"背景纹理合成三修"里只有 `_rt_FullFrameBuffer`（= 本层之前的画布内容）与 `g_EffectModelViewProjectionMatrix` 可能**间接**相关（都属于"背景/合成源取错"）；<br>②`9215467` 的 DPR 修复**上游自己就把它与指针/合成分开**（`git show 9215467` 的 diff 无 pointer/cursor/composite 行），且我们的画布尺寸走 `?res=` 档（`core/we-scene-bundle.js:6353` `parseResTier`），**不是** backing DPR。 | **壁纸身份**（两候选，见 §4 U-1）：<br>· `WALLPAPER-INDEX.md`（工作区根）"第 N 项"约定下 **#6 = 3660962877**（伊蕾娜相框/春色果园，视频口径、127 层）；我们有专门代码：`core/we-scene-bundle.js:1721`（锚点 `①(N2 2026-09-14 第6项`，"脚本驱动 origin 的近整屏层兜底"）、`demo.html:3011`、`demo.html:4444`。<br>· `tests/known-issues.json:120-124`（KI-7）/`docs/PATCHES.md:1063-1069`（P-33）另记一个"`project.json` 写 `type=scene`、实际是 `wallpaper.mp4`"的包（砂狼白子02_08）。<br>**视频当场景**的通路：`demo.html:1948-1976`（`__videoBase`：blob → 隐藏 `<video>` → entry **硬编码 3840×2160** → `scene.layers.unshift`，`size:[PW,PH]` 取自 `orthogonalprojection`）→ `core/we-scene-bundle.js:9778` 附近 video 分支 → 上传 `gl.texImage2D`。<br>**反相**：可读源码里**唯一**的 `invert` 是 vendored、**不可重建**的 `demo/assets/renderer-BOSoB05I.js:2325`（CSS `invert(1)`，接在 bench 的 `#fx` 下拉，`demo/index.html:457`），它作用在**整个 wrap 元素**上，**解释不了"左侧 1/4"**。可读的颜色选项 `core/we-scene-bundle.js:220` `buildDisplayFilter`（brightness/contrast/saturate/hue-rotate）**没有 invert**。<br>"部分区域"候选：`compositeLayer` 的 screen-blend 分支（唯一按 `gl_FragCoord/u_Viewport` 归一化重采样屏幕的通路）与 `__videoBase` 的 **3840×2160 硬编码 vs `size:[PW,PH]` vs 实时 `videoWidth`** 三者不一致。 | **P1（先定性，不要直接改渲染）**：<br>①**确认壁纸 id**（§4 U-1）；<br>②在该壁纸上做**单变量复现**：加 `?novideo=1`（`demo.html:1949` 的逃生口）看反相是否消失 ⇒ 区分"视频纹理本身"与"场景合成"；<br>③若指向合成源：移植 `fdfc578` 的 `_rt_FullFrameBuffer` 语义 + **保存/恢复两处 GL 状态**（§3 移植项 #5）是一致性动作；<br>④**明确不要**把 `9215467` 当作本 bug 的解（upstream 语义与我们的 `?res=` 档不同源）。 |
| **5** | Kaltsit：**头/身体应当静止、只有头发动**，我们的头也在动；**眨眼遮挡错**（下眼睑是一条带，眼睛又在它下面冒出来） | **`be3c246` 是 D1 的高相关候选**（"变长骨骼名 MDLS 解析错位致人物模型错乱"→ 绑定姿势错 ⇒ 无动画 puppet 的附着点 `cur=(0,0)` ⇒ 挂件被反向拽飞，"头顶浮出第二个人/身体"）。<br>**D2（眨眼）没有任何对应做法**：上游 11 个提交里没有眼睑/遮挡/眨眼相关改动。 | **D1**：`core/attach-transform.mjs:301`（锚点 `if (!layers \|\| !layers.length) layers = [{ animIdx: 0`）——**没有 authored `animationlayers` 的 puppet 被强行套 animation[0]**（含头/身体骨），而不是绑定姿势；同一写法在 `elysia/we-renderer/puppet.js:98` 重复。另有 `demo.html:2519` 的 attach 上下文 **`time: 0`**（`core/attach-transform.mjs:395` 吃 `ctx.time \|\| 0`）。<br>`selectAnimLayers`：`core/attach-transform.mjs:339-362`（仅"多动画 + 有 animationlayers"才做层合成；`docs/ELYSIA-ATTACH-SEMANTICS.md:9` 把它记为**有意**行为）。<br>**D2**：`core/we-scene-bundle.js:1613`（锚点 `const EYE_HACK_SCENES`）= `['3719111841']`；`:2412` `l.uvRect = [0.04, 0.30, 0.96, 0.70]`（把 `眼睛组合` 压成 405×120 横条）、`:2433` `左眼皮`/`右眼上眼睑` 的 `uvRect`；`localQuadVertsUV`（`:6302`）、消费点 `:8507-8508`。<br>**关键不对称**：`眼睛组合` 走的是**蒙皮网格**路径（`renderMeshLayer` **不读** `uvRect`/`size`，只用 `layer.scale` 当 `u_Scale`），而眼皮走 **quad** 路径 —— 长条眼窗只对眼皮生效 ⇒ 两者不再对齐（"眼皮是一条带、眼睛在它下面冒出来"）。<br>已知问题登记：`tests/known-issues.json:96`（KI-6，`3719111841`，层 `眼睛组合\|左眼皮\|右眼上眼睑`，kind `hack`）；`docs/UNTOUCHED-AREAS.md:9/21` 自述"是经验补丁不是原理性修复"。 | **D1 = P0**：移植 `be3c246` 的**行为契约**（§3 移植项 #6）：**无动画/无覆写的 puppet 必须填满绑定姿势、禁止早退**，使 `cur ≡ bind`（`follow` 增量 0）；同时审 `core/attach-transform.mjs:301` 的"强行 animation[0]"与 `demo.html:2519` 的静态 `time:0`。**风险**：改的是**全部角色共用**的蒙皮/附着主干（`docs/UNTOUCHED-AREAS.md:9` 自己标"高：一旦方向错，全部角色一起坏"）⇒ 必须有**逐骨判据 + A/B 档位**再翻默认。<br>**D2 = P1**：这是**我们自造的 hack**（`?eyehack`/`?eyedy`），上游**没有参考**；正确路线是让 `uvRect` 在**蒙皮层也生效**（或在蒙皮层显式禁用并恢复 size 口径），并补"眼皮遮挡"的判定 —— 属于自研，不应记成上游移植。 |
| **6** | 歌曲封面/元数据（正在做的 "Now playing" 组件） | **有，而且是两条完整契约**：`19c5fab`（壁纸自带音频→媒体快照、曲名剥曲号、驱动优先级、常量动画预建）+ `8ea8214`（**封面 mip 链重建** + **三级封面优先级**）。 | 快照：`elysia/media-host.js:165-542`（`state` 对象 `:172-198`：`hasMedia/title/artist/albumTitle/coverUrl/colors/duration/position/lyrics…`）；事件 `:217-240`；`getCoverForTexture():357-361`。<br>仲裁：`demo.html:6338-6387`（`mpwMediaTick`，**唯一**仲裁点）；真源 = 音频面板在播曲目（`:6349-6373`），**歌名 = 文件名去扩展名**（`:6357`），`artist/album/cover` **只来自注入**（`:6283-6293`）；**没有** `simMedia/createSimulatedMedia/currentMediaDriver`（0 命中）。<br>封面进 GL：**未实现**（无 `textures.set('$mediaThumbnail', …)`；`usertextures` 只存在于 `demo.html:6241` 的**注释**里，且该注释与事实不符）。<br>mip：`makeTexture`（`:11279`）`MIN_FILTER=LINEAR`、从不 `generateMipmap`。 | **P0**（本组件正在做，契约现成、风险最低）：<br>①实现封面纹理时**必须**在每次 level-0 上传后 `generateMipmap`（§3 移植项 #2）—— 否则会精确复现上游那个"真封面已上传、画面永远是占位"的坑；<br>②把**三级优先级 + `hasMedia` 门控**写成 `media-host`/`mpwMediaTick` 里的**显式函数**（而不是靠调用顺序涌现）——这是当前 `demo.html` 的实现弱点；<br>③`title` 回落层名时**照上游的剥法**（扩展名 + 曲号前缀，且 `"7 clouds"` 这类**不能**被误剥）；<br>④`duration` 非有限落 0（否则进度条/差分被 NaN 毒化）。 |

---

## §3 许可与移植清单（若移植，需要登记什么）

### 3.1 许可纪律（本文写作时已核对）

* 上游 `oneincase/webwallgl` 是 **MIT © 2026 oneincase**：**可以移植**，但**必须**：
  1. 在 `THIRD-PARTY.md` **登记**（现有同源条目：§6 `P-90` FXAA shader、§9 `P-93` HLSL→GLSL 转译器 vendored、§11 `P-102` 帧几何、§12 `P-103` 128 元频段数组）；
  2. 在 `docs/PATCHES.md` 记一条 **P 编号**（含"官方语义出处 / 我们的实现 / 判据 / 未证实项"四段）。
* `THIRD-PARTY.md:611-612` 已写明上游源码检出 `vendor-ref/webwallgl/` **在仓库外**、不入发布物；
  `THIRD-PARTY.md:639` 写明 `publish-check.mjs` 检查 ④ 会对任何含 `webwallgl` 的路径强制 MIT 声明随行。
  ⇒ **本次不引入任何代码**，因此**现在不需要**改 `THIRD-PARTY.md`；一旦按下面移植，**必须同批**更新。
* 引用纪律：上游代码**单处最多引 3–5 行**并标 `file:line`；**不抄注释/文案**（本仓库对"照抄"有门禁）。

### 3.2 P 编号建议：**从 P-134 起**（不是任务书说的 P-133）

> **P-133 已被占用。** 证据：`core/we-scene-bundle.js:720`、`:725`、`:747`（以及同文件尾部 `①(P-133 #2)`）
> 的代码注释已使用 `P-133 #1` / `P-133 #2`（精灵序列帧 UV 修复）；`grep -n "P-133" docs/PATCHES.md` = **0 命中**
> ⇒ 该编号的工作**已写进代码但尚未写进文档**（写作时 `core/we-scene-bundle.js` 处于 `M`（已修改未提交）状态）。
> **动作**：P-133 这条文档债应由那条工作线补；本文的移植项建议 **P-134 ~ P-138**。

### 3.3 移植项清单（按建议顺序；每项 = 一条 P 编号 + `THIRD-PARTY.md` 追加一段）

| # | 建议编号 | 移植内容（**行为契约**，不含代码） | 上游出处 | 风险 / 前置 | 判据（建议） |
|---|---|---|---|---|---|
| 1 | **P-134** | 材质常量 `ui_editor_properties_overbright`：缺省 1、乘精灵 RGB、**显式判空**取值；CPU/离线判据同构 | `19c5fab` `<UP>/…/render/particles.js:593-599`、`:1300`；`<UP>/scripts/particle-raster.mjs:63` | 低。前置：确认我们的粒子材质常量解析点（`elysia/we-renderer/particles.js` 与 `core/we-scene-bundle.js` 的粒子装配）。**必须**同时覆盖两条路径，否则"改一边" | 单测：有键 0.25 / 缺键 = 1 / 非数值 = 1 / 无材质 = 1；真实语料端到端亮度比 ≈0.25 |
| 2 | **P-135** | 封面纹理：**每次 level-0 上传后重建 mip 链**（纹理以 mipmap min filter 建立时）；元数据/封面**三级优先级**（外部真实 > 测试/模拟 > 壁纸内置）+ 外部源 `hasMedia` 门控 + 曲名回落剥法 + `duration` 非有限落 0 | `8ea8214`（两处 `generateMipmap`、`renderer.js:2698-2709`、`parse.js:480-499`）；`19c5fab` `media.js:407-421` | 低-中。前置：`$mediaThumbnail` 保留名机制（**当前 0 实现**，需先做 parse 侧 `usertextures` 合并 + `textureFallbacks`） | 纹理级：上传后 `LOD≈0.5` 采样到的是**新**封面；优先级：三级各自可达且第三级需预载才能命中 |
| 3 | **P-136** | 合成源（`copybackground` / `_rt_imageLayerComposite*`）**不能在预渲染阶段做**：登记待捕获 → 主循环走到 **z 序**再捕获 → 带可见效果链的源走完整 `renderLayer` → `await` 且传场景时间 → 成品**留一帧**给排在源之前的引用方 | `6ea9d14` `<UP>/…/render/renderer.js:1647`、`:1893-1927`、`:2254`、`:2286-2291`、`:2314-2320` | **高**。前置：我们的 bundle **没有** `groupTarget`/`compositeFBOs` 结构；改动落在 `resolveTextureName`（`:8190`）与 `renderLayer` 主干 | 跨层合成：合成源中心像素非零 + 时间差分非零（否则是空图/静止副本）；建议先给 `?composite=` 档位做逐层 A/B |
| 4 | **P-137** | 无界 UV 的 util 贴图（云/神光类）**必须 REPEAT 上传**，且贴图需可平铺；非内置名解析失败**不得**被兜底吞掉 | `4b7b07e` `<UP>/…/gl-util.js:45`；`<UP>/…/particle-textures.js:1269/1304` | 低。前置：需要一个**名字名单**（不能全局改 `wrap`）；我们现有 6 处硬编码 CLAMP（`core/we-scene-bundle.js:7633/7726/7775/7942/11323`） | 采样越界 1 个周期后画面等于平移一个周期（不被拉成边缘行）；接缝列差 < 内部列差均值 ×1.6 |
| 5 | **P-138** | `_rt_FullFrameBuffer` = **本层绘制之前的画布内容**，每帧最多懒捕获一次，且**必须保存/恢复 `FRAMEBUFFER_BINDING` 与 `TEXTURE_BINDING_2D`**；`g_EffectModelViewProjectionMatrix`（pass 顶点 → 画布 NDC）必须绑定 | `fdfc578` `<UP>/…/render/renderer.js:1345-1377`、`:52-60` | 中-高。与移植项 #3 通路重叠，**建议 #3 与 #5 同批**做（否则容易出现"回读职责不清"） | 空容器的 `mix(bg, albedo, a≈0)` 不再整屏纯白；combine 的 `previous` 槽不被 backdrop 覆盖；无 `FRAMEBUFFER` 泄漏 |
| 6 | **P-139**（候选） | 无动画/无覆写的 puppet：**禁止早退**，仍填满 `_local/_world` 为绑定姿势（返回值语义不变），使 `attach` 的 `cur ≡ bind` | `be3c246` `<UP>/…/render/mdl-skin.js:173-181`、`:302-304` | **高**。改的是全角色共用的蒙皮/附着主干（`docs/UNTOUCHED-AREAS.md:9` 自标"高"） | 逐骨：无动画 puppet 的附着点 `bind` 与 `cur` 距离 < 0.5px；端到端：挂件自身 follow 增量 = 0 |

> **不建议移植**（避免无谓的许可与回归成本）：`6c324bf` 的软形状封边（**不适用**：我们不生成内置粒子贴图，且它豁免图集）、
> `2c717be` 的 local 槽（**不适用**：我们没有每帧 recompose）、`3dbe3fd`（纯版本号）、
> `fdfc578` 的质量档位（**已完成**，P-90 已在 `core/we-scene-bundle.js:6338-6396` 逐条登记）。

---

## §4 未能证实的部分

> 本节只列**没验证**的，不作推测。每条给出"为什么没证实"。

* **U-1（bug#4 的壁纸身份）**："第 6 个壁纸"有两个互斥读法，**均未证实**：
  · 工作区根 `WALLPAPER-INDEX.md` 的用户口径表里 **#6 = 3660962877**（伊蕾娜相框/春色果园，"视频（用户口径）/ 场景 127 层"），
    但该表登记的**已知问题**是"视频只渲染到屏幕最右下角"，与本次的"**左侧 1/4 颜色反相**"**不同症状**；
  · `tests/known-issues.json:113-124`（KI-7：`"id": "KI-7"` 在 `:113`，`"reason"` 在 `:121`）/`docs/PATCHES.md:1063-1069`（P-33）另记一个"`project.json` 写 `type=scene`、
    实际是 `wallpaper.mp4`"的包。**我没有用户给的壁纸清单原文**，无法二选一。
  · ⇒ 在确认 id 之前，bug#4 的任何改动都**不应**开始。
* **U-2（bug#4 的反相成因）**：**没找到**可读源码里任何"对子区域做反相"的路径。
  `grep` 结论：`pixelStorei` / `UNPACK_FLIP_Y_WEBGL` / `UNPACK_PREMULTIPLY_ALPHA_WEBGL` / `scissor(` /
  非整帧 `gl.viewport` / `requestVideoFrameCallback` / `renderDpr` **全部 0 命中**；
  唯一的 `invert` 是 vendored 且**不可重建**的 `demo/assets/renderer-BOSoB05I.js`（CSS `invert(1)`，作用于整个元素）。
  ⇒ **"左侧 1/4"目前是无解释的**。仅有两个**未验证的候选**：screen-blend 的 `gl_FragCoord/u_Viewport` 通路、
  以及 `__videoBase` 的"硬编码 3840×2160 vs `size:[PW,PH]` vs 实时 `videoWidth`"三者不一致。
  **需要在真机/有头浏览器上用 `?novideo=1` 做单变量复现**（该逃生口在 `demo.html:1949`）。
* **U-3（bug#1 的"分母一致性"自证）**：上游契约（B-2）要求"UV 分母 = **实际上传的贴图尺寸**"。
  我们 `spriteInfo`（`core/we-scene-bundle.js:599-612`）用 `tex.textureWidth || tex.width`，
  而 `spriteFrameImageRects`（`:682`）/`computeSpriteFrameUV`（`:727`）用各图槽自身尺寸。
  **我没有验证**这两套口径对 `particle/nature/rosepetals` 是否恒等（POT 填充 / TEXS0003 多图槽 / 解码降采样三条路径都可能让它们不等）。
  ⇒ bug#1 的"缝隙"是否需要"分母统一 + 半纹素内缩"，**未证实**。
* **U-4（bug#1 的"缝隙"归属）**：用户描述的"竖条纹"与"条缝/间隙"可能是**两个**原因（帧跨采样 vs 线性过滤的纹素渗色）。
  P-133 只覆盖前者；后者在**上游也没有对应做法**（`halfTexel/inset/bleed/padding` 在 UV 计算里 0 命中，采样器恒 LINEAR+CLAMP）。
  ⇒ "缝隙"是否会在 P-133 落地后自动消失，**未证实**（需要一次真机 A/B）。
* **U-5（bug#2 的根因）**：我只做了**代码考古与资产盘点**，**没有**在真机上区分"层被跳过 / 实心矩形 / 帧时序不对"三种失败模式；
  `$MPW_ROOT/wallpaper_engine/assets/materials/particle/fog/fog3.tex` **存在**（`ls` 实测）这一点**只能**排除"资产缺失"，
  **不能**证明"解析/上传/采样"链路正确。
* **U-6（bug#3 的"抖动/反相"归因）**：我给出了**契约层面的对表项**（B-4/B-5/B-6）与嫌疑点（`em.__ptrLocked` 的 y 约定与作者路径不同），
  **没有**在真机上确认"反的是整条拖尾还是只有偏移"、"抖动来自事件频率还是来自每次重建发射器"。
  ⇒ 建议按 §2 bug#3 的①②③④ 逐条做**单变量**验证，而不是一次性改代码。
* **U-7（bug#5 D1 的根因）**：`be3c246` 与 D1 的**症状学**高度一致，但**我没有验证**我们的 MDLS 解析在
  Kaltsit（`3719111841`）的骨名上是否**也**失步；`core/attach-transform.mjs:301` 的"强行 animation[0]"是**读代码得到的嫌疑**，
  **未**用逐骨数据证实。⇒ 需要"逐骨位姿探针"（仓库已有 `?bones=` 这类探针的先例）先出数。
* **U-8（行号稳定性）**：`core/we-scene-bundle.js` 在写作期间被**另一个工作线持续改写**（11492 → 11684 行，md5 多次变化，
  `git status` = `M`）。本文该文件的行号锚定 md5 `596713d6be04295e6a243f5695bc2d18`（00:36）；
  **行号可能已经漂移**，请以文中给出的**锚点串**重新定位。其余文件（`demo.html`、`elysia/*`）在写作期间未变。
* **U-9（上游侧未读到的部分）**：上游 11 个提交里 `scripts/verify-*.mjs` 的新增判据（约 2000 行）我**只读了与行为契约相关的部分**，
  没有逐行读完；`bench/*`、`host/*`、`index.html` 的 UI 接线**未读**（与本任务无关）。
* **U-10**：`docs/WEBWALLGL-UPSTREAM-STUDY.md` 在多个文件中被引用（`THIRD-PARTY.md`、`docs/PATCHES.md`、
  `docs/README-DIAGNOSTICS.md`、`README.md`），但**该文件不在本仓库内**（`ls docs/WEBWALLGL*` = 不存在）⇒
  若它记录过 1.3.17–1.3.23 的结论，我**没有**读到，本文可能与它重复或冲突（**未核实**）。

---

## 附：复现本文结论的命令（只读）

```bash
# 上游：11 个提交的清单与逐提交 diffstat
git -C references/vendor-ref/webwallgl log --oneline b61e891..origin/HEAD
git -C references/vendor-ref/webwallgl show --stat <sha>

# 上游：某提交之后某文件的精确行号（本文所有 <UP>/…:<line> 都这样取）
git -C references/vendor-ref/webwallgl show <sha>:<path> | grep -nE '<锚点>'

# 上游：指针模块在 11 个提交间是否变过（结论：逐字节未变）
git -C references/vendor-ref/webwallgl diff --stat b61e891 fdfc578 -- renderer/vendor/we-scene/render/pointer.js

# 我们：行号锚定快照
md5sum we-scene-demo/core/we-scene-bundle.js && wc -l we-scene-demo/core/we-scene-bundle.js

# 我们：P-133 占用证据
grep -n "P-133" we-scene-demo/core/we-scene-bundle.js | head
grep -c "P-133" we-scene-demo/docs/PATCHES.md        # => 0（文档段缺失）

# 我们：本机 WE 资产是否含云图/雾图/落花图集
ls "$MPW_ROOT/wallpaper_engine/assets/materials/util/" | grep -E 'clouds_256|black'
ls "$MPW_ROOT/wallpaper_engine/assets/materials/particle/fog/"
ls "$MPW_ROOT/wallpaper_engine/assets/materials/particle/nature/" | grep -i rosepetal
```
