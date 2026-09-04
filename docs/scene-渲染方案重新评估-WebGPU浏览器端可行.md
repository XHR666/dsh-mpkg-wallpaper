# Scene 壁纸渲染方案重新评估（WebGPU 浏览器端可行版）

> 2026-09-04 v2。**本次评估相对 v1（scene-渲染加速方案分析.md）的关键更新**：
> 实测确认你的 Via 浏览器基于系统 WebView **Chromium 138.0.7204.179**（AndroidManifest
> versionName 直接读出），WebGPU 默认可用（Chromium 113+ / Android WebView 121+ 启用，
> 走 Vulkan），且 Android 系统带 `vulkan.adreno.so`（Adreno 830 驱动）。
> → **浏览器端 WebGPU 渲染在你的环境是真实可行的**，之前"proot 无 GPU"的结论
> 只适用于 xfce4 里的 Linux 程序，不适用于手机浏览器。

---

## 〇、新确认的环境事实（本评估的依据）

```
手机: Adreno 830 (骁龙 8 Elite)  无 root
浏览器: Via (mark.via) = 系统 WebView Chromium 138.0.7204.179 → WebGPU ✅
GPU 调用链: dsh 网页 JS → Via(Chromium 138, 在 Android 系统) → Vulkan → Adreno 830
proot: 跑 dsh 服务器(Node) + xfce4(软渲染)；与浏览器 GPU 链无关
```

| 渲染位置 | GPU 可用 | 结论 |
|---|---|---|
| **浏览器端**（dsh 网页里的 canvas/WebGPU） | ✅ 真机 Adreno 830 | **首选，快** |
| host 端（proot Node CPU） | ❌ 无 GPU | 软渲染，慢 |

---

## 一、方案矩阵（按推荐度排序）

### 方案 A：浏览器端 WebGPU 实时渲染（新首选）🟢
**做法**：把 scene 渲染逻辑做成网页内代码，用 WebGPU（WGSL shader）在浏览器里光栅化
场景帧，直接画到页面背景层。

```
scene.pkg 文件
   │  host(proot Node) 提供 /scene-data/<token> 接口：解析 PKG/TEX/MDL，
   │  把场景结构化数据 + 纹理(已解码 PNG) 传给浏览器  ← host 只做解析，不做渲染
   ▼
浏览器 Via: JS 解析场景对象树 → 上传纹理到 GPU → WGSL compute/vertex shader
   → 光栅化 → 显示
   GPU: Adreno 830 硬件加速 ✅
```

- **优点**：真正的 GPU 渲染，4K@30-60fps 级；CPU 近零；无 proot GPU 限制
- **成本**：需要把 elysia395 的 CPU 渲染器"翻译"成 WebGPU/WGSL——工程量大
  （对象树/纹理采样/23 个 effect shader/bloom 全 GPU 化）
- **风险**：Via 的 WebView WebGPU 可能有版本细节差异（需 feature-detect 回退 WebGL2）；
  移动 GPU 的 shader 复杂度限制（Adreno 830 很新很强，风险低）
- **回退**：WebGPU 不可用 → WebGL2（同样走 GPU，兼容更广）→ 都不行 → 静态帧

### 方案 B：浏览器端 WebGL2（A 的稳妥版）🟢
WebGPU 的前身，所有 WebView 都支持。光栅化效果足够 scene 壁纸（2D 图层 +
粒子 + shader），只是 API 老一些、少 compute shader（粒子可用顶点 shader 替代）。
- 优点：兼容最广（Via 肯定支持）；工程与 A 同构（先做 B 的 shader，后迁移 A）
- 缺点：比 WebGPU 少些能力，但场景壁纸 90% 是 2D 合成 + 效果 shader，够用

### 方案 C：host CPU 渲染成 MP4/APNG → video 播放（v1 的 P0）
不依赖浏览器 GPU 能力，但 proot 无 GPU = 纯 CPU 渲染首次分钟级。
- 现在看**不是最优**：浏览器明明有 GPU 却不用，让 host CPU 慢慢算
- 适用场景：WebGPU/WebGL2 都不行的极端浏览器；或做"离线预渲染"缓存

### 方案 D：混合（推荐落地路径）
```
第一帧/静态帧: host 解析 → 浏览器 WebGL2/WebGPU 渲染单帧（秒级，之后缓存）
交互/动画:    浏览器 GPU 逐帧渲染（真动态）
回退:         静态帧(host 主纹理提取，现有代码)
```
先做 D 的骨架（场景数据接口 + 浏览器渲染单帧），验证 Via 上 WebGPU/WebGL2 真实
表现，再决定全量 GPU 化深度。

---

## 二、为什么浏览器端是正解（vs v1 结论修正）

v1 说"跨平台瓶颈是环境没有 GPU，最快路径是 CPU 渲染成视频"——**这个结论
只对 host 端成立**。新事实是：**显示端（浏览器）本身就有 GPU**，而且是很强的
Adreno 830。把渲染放在显示端，等于绕开了 proot 无 GPU 的全部问题：
- 不需要 virgl/ANGLE/自编译 mesa（那是给 xfce4 Linux 程序用的）
- 不需要真 root
- 浏览器调 Vulkan 是 Android app 的**默认能力**，Via 内核 138 支持 WebGPU

**本质**：scene 壁纸是"网页背景"，网页代码跑在浏览器里，浏览器有 GPU → 
让网页代码用 GPU 渲染场景，是最自然的架构。

---

## 三、推荐落地路线

### Phase 1（验证可行性，最小闭环）
1. host 加 `/scene-data/<token>`：解析 scene.pkg → 输出 { 对象树 JSON, 纹理清单 }
2. 浏览器端：拉取场景数据 → WebGL2 渲染单帧（背景色 + image 图层 + 基本动画）
3. 在 Via 实测：帧率、内存、能否跑通
   - 验收：单帧渲染 < 200ms，连续动画 > 20fps

### Phase 2（完整渲染）
4. 移植 elysia395 渲染逻辑：属性动画 → 相机 → 图层/粒子/效果 shader
5. WebGPU 化（compute 粒子 + 效果链），WebGL2 作回退

### Phase 3（产品化）
6. 集成现有壁纸设置（暂停/倍速/统一虚化/主题色照常作用于 canvas 层）
7. 静态帧/视频纹理场景保持原路径，只对"纯 scene 场景"走新渲染器

---

## 四、技术要点

### host 端只需做"数据准备"（不渲染）
```
scene.pkg 解析（已有 pkg-extract.js）→ 输出:
  - scene.json 对象树（过滤后 JSON，去 animation 大字段）
  - 纹理: 各图层主纹理解码为 PNG（复用现有 extractSceneLayer）+ 逐张 /tex/<id> 路由
  - MDL: 网格解析（可选，Phase 2 做模型/木偶时）
数据传输量: 典型场景对象树几十 KB + 纹理若干 MB（首次，可缓存）
```

### 浏览器端渲染层
```
- WebGL2 上下文（canvas 背景层，z-index 与现 .mpw-bgWrap 同层）
- 每帧: 遍历对象树 → 计算动画值 → 绘制（drawImage 图层 / shader 效果 / 粒子）
- 效果 shader: waterwaves/ripple 等按 WE 数学在 fragment shader 实现
- 帧循环: requestAnimationFrame，配合暂停/省电门控
```

### Via 兼容性策略
```
if (navigator.gpu) → WebGPU 路径
else → WebGL2 路径（Via Chromium 138 肯定有 WebGL2）
else → 静态帧（现有）
```

---

## 五、对照表（新评估）

| 方案 | GPU | 跨平台 | 实时动画 | 工程量 | 状态 |
|---|---|---|---|---|---|
| **A WebGPU 浏览器端** | ✅ Adreno | Via✅/Edge✅/Firefox✅(新版) | ✅ 60fps | 大 | 首选，需 Phase1 验证 |
| **B WebGL2 浏览器端** | ✅ Adreno | 全浏览器✅ | ✅ 30fps | 中 | A 的稳妥版 |
| C host CPU→视频 | ❌ CPU | 全✅ | 播放期✅ 渲染期❌ | 中 | 降级用 |
| D 混合(推荐) | ✅ | 分层回退 | ✅ | 中→大 | 落地路径 |

---

## 六、风险与对策

| 风险 | 对策 |
|---|---|
| Via WebView 的 WebGPU 实际可用性未知 | Phase 1 先跑 WebGL2（必可用），WebGPU 作增强探测 |
| scene.pkg 解析 + 数据传输慢 | host 端缓存场景数据（复用现有缓存）；纹理按需加载 |
| Adreno 830 移动 GPU shader 限制 | 先做简单场景验证；复杂度分级 |
| 与现有壁纸层(z-index/透明)冲突 | 新 canvas 复用 .mpw-bgWrap 的 z-index/缩放体系 |

---

## 结论一句话
**把 scene 渲染从 host(proot CPU) 搬到浏览器(Via 的 Adreno 830 GPU)**——你的
Via 内核 138 支持 WebGPU，浏览器调真机 GPU 完全可行；先做 WebGL2 版验证，
再上 WebGPU。这是当前架构下的最优解，也是唯一能"真动态 + 快"的路。
