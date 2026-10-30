# AUDIT.md — we-scene-demo 渲染器深度审计（2026-09-10）

> 审计范围：`core/we-scene-bundle.js`（3697 行，parseScene / renderScene / 效果链 / 粒子 / MDLA / autofit）+ `demo.html`（981 行）。
> 对照基准：
> - `<工作区>/docs/reverse/`（附件矩阵/相机/合成顺序与 blend 枚举）、`<工作区>/docs/reverse/`（autofit 正交窗口 / CreateBlendState 二进制提取表 / MDLA 帧布局）、`<工作区>/docs/reverse/`（效果链 FBO / clear / copybackground / a=max 公式）；
> - 官方着色器与材质：`wallpaper_engine/assets/shaders/common_{composite,blending,fragment,vertex,perspective,blur}.h`、`composelayer.frag`、`assets/materials/util/{composelayer,solidlayer,fullscreenlayer}.json`；
> - 真实数据回归：`allwallpaper/dd/*` 11 个场景 307 条效果链的结构扫描（fbos/bind/target/multi-pass 统计）。
> 方法：逐段通读 + 官方语义逐条比对 + pkg 实测数据验证。每条给出：问题 / 位置 / 证据 / 建议改法 / 风险。
> 结论分级：**确定**（代码+数据双证）/ **高**（代码+官方文档）/ **推测**（需真机回归）。

---

## 总览

| # | 优先级 | 问题 | 位置 | 状态 |
|---|---|---|---|---|
| 1 | **P0** | 效果链 bind 覆盖从未生效（`eff.binds` 应为 `mp.binds`） | bundle:3420 | 确定已修 |
| 2 | **P0** | 效果 pass 劫持共享 VAO 顶点指针 → 其后所有绘制用错顶点缓冲 | bundle:2849-2879/3395/3408 | 确定已修 |
| 3 | **P0** | 对象级视差永不生效（`const parEnabled` 遮蔽外层 `let`） | bundle:3037 vs 2752/2995 | 确定已修 |
| 4 | **P0** | additive 混合 alpha 通道与官方 BlendState 表不符 | bundle:2937 | 确定已修 |
| 5 | **P0** | bind 修复后同 pass 读+写同一 FBO 的反馈环风险（现仅有断言日志，无阻止） | bundle:3431 区域 | 确定已修 |
| 6 | **P0** | 粒子 alpha/颜色被丢弃（`u_Color`/`u_Alpha` 恒 1，逐粒子计算结果不入顶点） | bundle:2507-2517/3521-3571 | **alpha 半** P-59 已修；**RGB 半** P-126 才真正修（P-59 只在 `u_Color` 上留了恒 `(1,1,1)`，旧 `mix(color1,color2,·)` 的 `color1/color2` 也是硬编码白 ⇒ 逐粒子 RGB 恒 1，萤火虫 authored 紫色整条不上屏） |
| 7 | P1 | MDLA 动画硬编码 90 帧 / pingpong 178，frameCount/framerate 应从 MDLA 块读 | demo.html:454,577-583,941-947 | 未修（?anim 默认关） |
| 8 | P1 | 相机无官方 cover/contain 取景（设计比例≠画布比例时拉伸而非裁边） | bundle:939-952 | 未修 |
| 9 | P1 | hideUI 正则过宽，跨场景误伤（`UI` 子串命中 guide 等） | bundle:765 | 未修 |
| 10 | P1 | FBO 未实现官方 `clear:"r g b a"` / `fit` / `width` / `height` / `unique` 字段 | bundle:802,3337-3341 | 未修 |
| 11 | P1 | 材质多 pass 只取 `passes[0]` | bundle:822 | 未修 |
| 12 | P2 | `hlsl2glsl` 缺 `mul(M, v)`（矩阵在前）分支 | bundle:1918-1927 | 未修 |
| 13 | P2 | `g_ModelViewProjectionMatrixInverse` 恒单位阵 | bundle:2801 | 未修 |
| 14 | P2 | `g_PointerPosition` 恒 (0,0)（鼠标交互效果无输入） | bundle:2811 | 未修 |
| 15 | P2 | 效果 FBO 用 RGBA8，官方 rgba16161616f（16F） | bundle:2620 | 未修 |
| 16 | P2 | `animValueAt` 循环时长=最后关键帧时刻，非动画总时长；帧率固定 30 | bundle:547-560,521 | 未修 |
| 17 | P2 | GIF/WEBP 纹理静默失败（`m.image` 非 JPEG 返回 null） | demo.html:214 | 未修 |
| 18 | P2 | 纹理超限降采样硬编码 4096（未查设备 MAX_TEXTURE_SIZE） | demo.html:167 | 未修 |
| 19 | P2 | 内置 fullscreenlayer 材质用 `flat`，官方为 `passthrough`+`_rt_FullFrameBuffer` | bundle:854-857 | 未修 |
| 20 | P2 | `drawQuad` 死代码；效果 pass 每帧重复 bufferData PASS_QUAD | bundle:2942-2953 | 未修 |
| 21 | P2 | 粒子系统每帧重建+从 0 模拟到 t（O(t/0.05)，2000 步封顶后漂移） | bundle:3500-3508 | 未修 |
| 22 | P2 | applyRenderConfig 校准性硬规则（clearBgFx 阈值/hideUI）无场景白名单 | bundle:721-776 | 未修（有意决策） |

对照官方**确认一致**的项（免复核）：`translucent`=(SRC_ALPHA,ONE_MINUS_SRC_ALPHA,ONE,ONE_MINUS_SRC_ALPHA)=BlendState idx1；画家算法按 scene.layers 数组序；层内先 base 后 effects；composite `a=max(eff.a*saturate(g_CompositeAlpha), base.a)`（转译自官方 shader 原文）；`g_TextureNResolution=(w,h,w,h)` 与官方 `(paddedW,paddedH,unpaddedW,unpaddedH)` 在无 padding 时等价；内置 solidlayer 材质与官方逐字段一致；CPU 侧 blendRgbByMode 的 1..32 按公开混合定义实现（含 id 5/10 不加权、id 31 权重内置的特例），与 GPU 侧逐模式一致；效果链"缺省不清屏"与 FINDINGS-3 一致。

---

## P0（阻断级：确定的功能损坏，修复风险低）

### 1. 效果链 bind 覆盖从未生效【确定，数据实证】
- **问题**：`effect.json` 每条 pass 的 `bind` 数组（官方语义：强制把纹理槽 index 绑到指定资源，`previous`=链输入、`_rt_*`=命名 FBO）被解析存入 `materialPasses[i].binds`（bundle:806/819/827），但 pass 循环读取的是 **`eff.binds`**（scene.json 效果条目——该对象从未有 `bind` 字段，恒 undefined）。bind 覆盖在实际渲染中**从未生效过一次**。
- **位置**：`core/we-scene-bundle.js:3420`（`for (const b of eff.binds || [])`）；存储侧 bundle:806-831。
- **证据**：全库扫描 11 场景 307 条效果：**104 条带 bind、93 条带 target、61 条多 pass**。典型如 `3326873240 blurprecise`：pass0 写 `_rt_FullCompoBuffer1`（横向高斯），pass1 `bind=[{index:0,name:"_rt_FullCompoBuffer1"},{index:1,name:"previous"}]`（纵向高斯+原像混合）。bind 丢失 → slot0 错绑 seqInput、slot1 绑到透明纹理 → 模糊类/多 pass 效果输出错误（这是"效果路径一直不绿"的根因之一）。
- **建议改法**：改为读取 pass 级 binds 并允许 scene 端覆盖：`const binds = ((ov && ov.bind) || mp.binds || [])`。优先级保持 official 顺序：material textures < scene 端 textures 覆盖 < bind 强制覆盖（现循环顺序已满足后者）。
- **风险**：低。只影响此前从未生效的路径；单 pass 无 bind 效果（如凯尔希 waterwaves，占绝大多数）行为零变化。

### 2. 效果 pass 劫持共享 VAO 的顶点指针，其后所有绘制读错顶点缓冲【确定】
- **问题**：`bindVAOFor` 在**共享主 `vao`** 上把 attribute 0/1 指针重指到 `quadVBO`（`vertexAttribPointer` 在设置时刻捕获 ARRAY_BUFFER 绑定，成为 VAO 持久状态）。此后 `compositeLayer`/copy pass 仍 `bindVertexArray(vao)` 并只向 `vbuf` 传数据（`uploadQuad`→`bufferData(vbuf)`），但绘制实际读取 quadVBO——内容是上一效果 pass 的 `PASS_QUAD`（NDC 全屏 quad）。
- **后果链**：效果层的最终合成 `compositeLayer(compProg, curInput.tex, …)` 以 MVP=viewProj×model 变换 NDC quad → 在设计像素空间中缩成 ~2×2px 的角落小点（层近乎不可见=**"灰层 fx=1 全部透明"之谜的候选根因**）；同帧其后所有直绘层同样损坏。
- **位置**：`core/we-scene-bundle.js:2849-2879`（bindVAOFor）、3395（调用）、3408（pass 循环再次绑 vao）、3006-3016（compositeLayer）、3310（copy pass）。
- **证据**：代码路径唯一性——全文件仅 3395 一处调用 bindVAOFor；主 vao 指针只在创建时（2600-2607）指向 vbuf，之后无任何代码恢复。
- **建议改法**：效果 pass 使用独立 `fxVao`（createRenderer 内新建），bindVAOFor 只配置/绑定 fxVao；pass 循环内 `gl.bindVertexArray(fxVao)`。顺带修复：按 `cfg.key` 变化重设指针（现实现首个 prog 缓存后，vec2/vec3 a_Position 混用时指针不更新）。
- **风险**：低。GREEN 路径（附件/眼睛/背景直绘/粒子）不经 bindVAOFor，主 vao 指针保持 vbuf 不变，行为严格不变；效果路径现状本就是坏的，只可能变好。

### 3. 对象级视差永不生效：renderScene 内 `const parEnabled` 遮蔽外层 `let parEnabled`【确定】
- **问题**：`createRenderer` 闭包声明 `let parEnabled = false`（2752），`compositeLayer` 在 2995 读取它做每层位移；而 `renderScene` 在 3037 又声明了**同名 `const parEnabled`**（块级遮蔽）——外层变量永不为 true，2995 分支死亡。
- **位置**：`core/we-scene-bundle.js:2752 / 2995 / 3037`；`parallaxDepth` 解析在 bundle:696。
- **证据**：JS 词法作用域规则；grep 全文件仅此三处。
- **建议改法**：3037 去掉 `const`（直接赋值外层变量）。
- **风险**：极低。默认场景无 `cameraparallax`/`parallaxDepth` 时 `parDispX/Y=0`，行为不变；凯尔希 GREEN 回归无差异（其无视差层）。

### 4. additive 混合的 alpha 通道与官方 BlendState 二进制表不符【确定（表=二进制提取）】
- **问题**：`setBlend('additive')` 写 `blendFuncSeparate(SRC_ALPHA, ONE, ONE, ONE)`——alpha 通道用 (ONE, ONE)；REVERSE-FINDINGS-2 §2 从 `CreateBlendState` 静态构造表提取的 **idx2：RGB 与 Alpha 均为 SRC_ALPHA(5)/ONE(2)**。
- **位置**：`core/we-scene-bundle.js:2935-2937`。
- **证据**：官方表 idx2"SrcBlend=5 SRC_ALPHA / DestBlend=2 ONE / ADD，Alpha 同左"。
- **建议改法**：`gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.SRC_ALPHA, gl.ONE)`。
- **风险**：低。additive 仅光效/粒子路径；多层 additive 叠加处画布 alpha 更贴近官方（此前偏大）。

### 5. 同 pass 读+写同一 FBO（反馈环）只有断言日志、没有阻止【确定（修复 #1 后风险上升）】
- **问题**：pass 循环末尾有"反馈断言"（3446-3456）检测 `inTex === outTex` 只打日志。修复 #1 后，bind 把槽指到 `_rt_*` 命名 FBO 的场景增多；若某效果 target 与 bind 同名（官方结构不出现，但防御必须有），即构成 sampling-drawing feedback loop → 桌面 GL 静默未定义、Adreno 抛 0x502 → 触发整层回退（现网 0x502 之历史根因）。
- **位置**：`core/we-scene-bundle.js:3416-3437`（纹理解析/绑定）、3446-3456（仅日志的断言）。
- **建议改法**：绑定前守卫：`if (entry && entry.fbo && outFBO && entry.fbo === outFBO.fbo) entry = passInput`（passInput∈{fboA,fboB}，与命名 FBO 恒不同，已验证 ping/pong 轮换只发生在无 target pass）。记一次日志。
- **风险**：低。仅在原本必然 UB 的场景生效。

### 6. 粒子逐粒子 alpha/颜色被丢弃：`u_Color`/`u_Alpha` 恒 (1,1,1)/1【确定】
- **问题**：`renderParticleLayer` 逐粒子计算 `a/colorR/G/B`（3521-3533），但顶点格式只有 pos3+uv2（5 float），shader 亦无 v_Color；绘制时 `uniform3f(u_Color,1,1,1)`、`uniform1f(u_Alpha,1)`（3568-3570）——**全部粒子以全白、全不透明绘制**。对照官方 genericparticle 语义（代码自注释 2496：`alpha = v_Color.a`），alphafade/alpharandom/oscillatealpha 等全部失效。
- **位置**：`core/we-scene-bundle.js:2498-2517`（PARTICLE_VS/FS）、3521-3533（vis 计算）、3538-3571（顶点组装与绘制）。
- **建议改法**：顶点扩为 6 float（pos3+uv2+alpha1），新增专用 partVao（stride 24：attr0 pos3/attr1 uv2/attr2 a_Alpha），VS 透传 `v_Alpha`，FS `alpha = u_Alpha * v_Alpha * texR`。（color1=color2=[1,1,1] 恒白，rgb 选择器暂无观感差异， AUDIT 仅记录。）
  - **①(P-126 2026-09-19 更正)**：上面那句"rgb 暂无观感差异"**不成立**。逐粒子 RGB 来源是 `p.color`
    （`colorrandom` / `colorchange` / `instanceoverride.colorn|color`），旧 `mix(color1,color2,·)` 的 `color1/color2`
    被硬编码成 `[1,1,1]` ⇒ 三分量恒 1；语料里的萤火虫（hina 3554161528 id 4569/6271）本该是**紫色**，实际是白点。
    P-126 把颜色源改成 `p.color`、新增独立顶点缓冲 `a_Color`（几何 36B 布局不动）、整批同色时上提到 `u_Color`，
    并对"层 4569 `u_Color == instanceoverride.colorn`"加了门禁断言。
- **风险**：低-中。粒子默认隐藏（GREEN 约束"粒子关"），默认路径不执行该函数；?np 开启路径由坏变好。partVao 与主 vao/fxVao 互不影响。

---

## P1（应修：功能缺口明确，修复面较大或有回归风险）

### 7. MDLA 动画帧窗硬编码 90 帧，与文件 frameCount/framerate 脱节
- **位置**：demo.html:454（frameCount 实际读到，u16）、577-583（`for (f=0; f<90; f++)` 预计算）、941-947（`%90` / pingpong `%178`）。
- **证据**：REVERSE-FINDINGS-2 §3（MDLA 布局：framerate f32@+0x178、frameCount u32@+0x17c；帧序=fmod(t*framerate, frameCount)）；真实样本 frameCount=900（30s@30fps）。90 帧窗是 900 帧的前 10%，pingpong 178 为手工补丁（代码注释自认"90 帧窗截断 180 帧呼吸半周期所致回绕阶跃"）。另外 framerate 用字节扫描 `0xF0 0x41` 硬找 30.0f，非 30fps 动画将错位。
- **建议改法**：anchorsOf 把 framerate/frameCount 挂到 anchors；attachAnim 预计算 `min(frameCount, 1800)` 帧；回绕 `f % frameCount`、pingpong 周期 `2*(frameCount-1)`；?anim 默认关，不触 GREEN。
- **风险**：中。demo.html 动画链路绕（预计算数组+增量覆盖），需逐帧对照官方预览回归。

### 8. 相机缺官方 cover/contain 取景（正交窗口未做纵横比适配）
- **位置**：`core/we-scene-bundle.js:939-952`（buildCamera：ortho 直接映射设计 W×H→画布）。
- **证据**：REVERSE-FINDINGS-2 §1：官方 `0x1400dbc70` 以 viewAspect 与设计 aspect 比较，默认分支 **cover（裁掉超出量、两侧对称）**，输出四边距→归一化裁剪窗；我们恒全投影=stretch。demo 画布固定 16:9、凯尔希设计 3840×2160 亦 16:9 → 当前 GREEN 场景恰无差异；4096×2296 等场景会轻微拉伸。
- **建议改法**：buildCamera 按 `min`/cover 公式取正交窗口（宽或高一边取设计值、另一边按 viewAspect 扩）；16:9 对 16:9 数值不变（天然保 GREEN）。
- **风险**：中。改投影矩阵影响所有层；必须以两份官图回归（4096×2296、3840×2160）验证后再落地。

### 9. hideUI 正则过宽，跨场景误伤
- **位置**：`core/we-scene-bundle.js:765`（`uiRe` 含 `UI|Day|music|Round L` 等宽泛子串）。
- **证据**：`UI` 无词边界（命中 "Guide"/"Build"、中文层名混排英文）；`Day` 命中 "Day/Night" 主题层。对凯尔希已校准无碍，但 applyRenderConfig 对**所有**场景默认生效。
- **建议改法**：改词边界+显式清单（`(^|[^a-z])ui([^a-z]|$)` 类），或按场景 id 启用校准规则。
- **风险**：中。放宽会改变其他场景现有画面（可能重新露出此前被正确隐藏的 UI 层）。

### 10. 效果 FBO 的官方字段未实现：`clear` / `fit` / `width` / `height` / `unique`
- **位置**：`core/we-scene-bundle.js:802`（只存 `ej.fbos || []`）、3337-3341（只消费 `name`/`scale`）。
- **证据**：REVERSE-FINDINGS-3 §1：键集 `{conditions,name,format,scale,fit,width,height,unique,clear}`；clear="r g b a" 四浮点、缺省**不清屏**（我们恰好不清 ✓）；fit=1=适配屏幕尺寸（我们按层尺寸）。
- **建议改法**：解析 clear 并在链首对目标 FBO 执行（flags bit1 语义）；fit=1 时 FBO 尺寸取画布；`unique` 时禁用跨帧缓存复用。
- **风险**：中。改动 FBO 生命周期/尺寸，需逐场景对照。

### 11. 效果材质多 pass 只取 `passes[0]`
- **位置**：`core/we-scene-bundle.js:822`（`const mp = (mj.passes && mj.passes[0]) || {}`）。
- **证据**：官方 material 可含多 pass（prepass+main，如带 depth/法线变体）；扫描显示 61 条多 pass 效果中部分依赖 material 级第二 pass。
- **建议改法**：materialPasses 展平 material 的全部 passes（combos/textures/blending 逐 pass）。
- **风险**：中。pass 数量变化影响乒乓轮换与 bind 对位，需数据回归。

---

## P2（记录在案：不影响主路径正确性/性能与健壮性）

### 12. `hlsl2glsl` 缺 `mul(M, v)`（矩阵在前）分支
- 位置 bundle:1918-1927。`isMat(a)&&isMat(b)` 与 `isMat(b)`（v×M）已处理；`isMat(a)` 且 b 为向量时落入 `(a*b)`——HLSL mul(M,v) 语义应为 `transpose` 变换。当前效果 pass 的 MVP=单位阵时等价，但 3D/透视 shader 转译会错。建议补 `if (isMat(a)) return '(v…)'` 分支：`(' + b + ' * transpose(' + a + '))'`。

### 13. `g_ModelViewProjectionMatrixInverse` 恒单位阵（bundle:2801）
官方为 MVP 逆矩阵；依赖屏幕空间反投影的效果（parallax 位移类）会错。建议在 JS 端求 4×4 逆（已有 mat4 工具，可一次性求逆缓存）。

### 14. `g_PointerPosition`/`g_PointerPositionLast` 恒 (0,0)（bundle:2811）
鼠标交互效果（mouse-follow 光斑等）无输入。建议接入 demo.html 已有的 parallaxState 鼠标监听，归一化后传入。

### 15. 效果 FBO 为 RGBA8，官方 rgba16161616f（bundle:2620）
8bit 中间缓冲在高频叠加（辉光/拖尾）有带状伪影与 alpha 精度损失。WebGL2 可用 `EXT_color_buffer_float`+RGBA16F（有回退判断）。风险：移动端扩展可用性。

### 16. `animValueAt` 循环时长=最后关键帧时刻（bundle:547-560）；`extractAnimKf` 帧率硬编码 30（bundle:521）
关键帧前段循环会提前回绕；建议从 project.json/动画轨读总时长与 fps。

### 17. GIF/WEBP 纹理静默失败（demo.html:214 `if (m.image !== undefined) return null`）
层 textureName 不设置→透明直绘。建议至少打一条缺格式日志（现完全无声）。

### 18. 纹理超限降采样硬编码 4096（demo.html:167）
低端设备 MAX_TEXTURE_SIZE 可能 2048（再抛 0x501）；建议 `gl.getParameter(gl.MAX_TEXTURE_SIZE)` 动态取。

### 19. 内置 fullscreenlayer 材质用 `flat`，官方为 `passthrough`+`_rt_FullFrameBuffer`（bundle:854-857）
当前"容器不渲染+内容透明"策略下无实害；若未来做整屏后处理层（volumetrics）需对齐官方。

### 20. 死代码与冗余上传
`drawQuad`（bundle:2942-2953）无调用者；效果 pass 每帧每 pass 对 quadVBO bufferData PASS_QUAD（bindVAOFor）+ uploadQuad('pass') 双写。建议清理（留意与 #2 修复的联动：uploadQuad('pass') 保留可维持 currentQuadKey 状态一致性）。

### 21. 粒子系统每帧重建+从 0 模拟到 t（bundle:3500-3508）
O(t/0.05) 步、2000 步封顶后时间轴漂移（100s 后与真实时间脱钩）。建议 sys 按 layer 缓存、增量模拟。

### 22. applyRenderConfig 校准性硬规则无场景白名单（bundle:721-776）
`clearBgFx`（≥3800×2000 停效果链）、长条眼窗（按层名"眼睛组合"）、refrender 实绘定位是凯尔希/Hina 校准决策；对全部场景默认生效（clearBgFx 会把其他 4K 背景的合法效果链一并停掉）。属**有意决策**（灰/白块根治），建议文档化并提供 `?bgfx`/`?showui` 旁路（已有）+ 按场景 id 启用的白名单机制。

---

## 修复顺序与验证协议（本次执行 P0 共 6 条）

1. P0-1 binds（mp.binds）→ P0-5 反馈守卫（同处纹理绑定逻辑，一并验证）
2. P0-2 fxVao 隔离
3. P0-3 parEnabled 遮蔽
4. P0-4 additive alpha
5. P0-6 粒子 alpha 顶点化

**每步验证**：`node --check core/we-scene-bundle.js` → 全部完成后 `node glsl-validate.mjs`（基线 128/128 必须保持）→ `node preview.mjs 3719111841` 出图与基线像素对比（CPU 预览不经 WebGL 效果路径，预期与基线一致=GREEN 未破坏的证明）→ demo.html 路径按服务器读盘生效（无需重启）。
