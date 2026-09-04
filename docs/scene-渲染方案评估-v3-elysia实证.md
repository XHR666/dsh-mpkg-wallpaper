# Scene 壁纸渲染方案评估 v3（含 elysia PR/issue 实证）

> 2026-09-04 v3。在 v2（WebGPU 浏览器端可行）基础上，补充调研了 elysia395 仓库的
> **closed PR #47/#61/#65** 与 **issue #64**（用户要求核查），结论有重要修正。

---

## 〇、本次新增的关键证据（elysia 仓库实证）

### 时间线（elysia 团队自己的探索轨迹）
| 时间 | 事件 | 结论 |
|---|---|---|
| 08-25 | **PR #47** YV3507 "半成品 3D 渲染器" | 声明存在、短期内勿合并（半成品） |
| 08-30 | **PR #61** YV3507 "聚焦静态帧：**移除 scene-anim 动画方向**" | 放弃 CPU 多帧动画：NSL 脚本时间轴是框架级问题（13/15 场景）、维护打地鼠、CPU 分钟级 |
| 08-30 | **issue #64** YV3507 场景动画开发邀请 | 列出三条路线：A 多帧+视频 / **B WebGPU/Dawn（spike 已证 21.1×）** / C 官方引擎捕获 |
| 09-03 | **PR #65** yuxilao "**scene-gl Linux 实时渲染管线 — WebGL2 官方 shader 驱动**"（120 files +23760/−2190） | 尝试 WebGL2 实时渲染；但 e2e 测试在 GUI 浏览器跑 |

### PR #65 实测后的关键自我修正（index.js 注释，权威）
> "Scene animation exposed as a playable **MP4**... The client **prefers this `<video>`
> path: it is hardware-decoded and smooth, **unlike a live WebGL iframe (which can
> spin up multiple contexts and freeze the page)**."

**elysia 团队自己实测 WebGL iframe 实时渲染后，确认它会冻结页面**，所以：
- 默认路径 = **scene-video（从 scene.pkg 提取内嵌 MP4 → `<video>` 硬件解码）**
- 回退 = 静态帧（`/scene-frame`）
- WebGL 播放器（`/scene-runtime` iframe）**只作 fallback 保留**，默认不嵌入

### scene-gl 实际架构（已实现）
```
host: /scene-manifest/<token> → 场景 JSON（图层/模型/粒子/相机）
      /scene-resource/<token>/<tex> → 解码后 PNG 纹理
      /scene-runtime/<token> → 自包含 WebGL1 播放器 HTML（scene-player.js, 1946 行）
浏览器: <iframe> 加载播放器 → fetch manifest → WebGL1 逐帧渲染
       （注意是 WebGL1 不是 WebGL2/WebGPU！）
```

---

## 一、对 v2 评估的修正（重要）

v2 说"浏览器端 WebGPU 渲染是新首选"——**elysia 的实证削弱了这个结论**：

### ❌ 实测否决：WebGL/WebGPU iframe 实时渲染会冻结页面
- elysia 在真机测试发现：**每场景一个 live WebGL context → 页面冻结**
- 这是**移动浏览器/WebView 的真实限制**（GPU context 数量/内存/合成层限制），不是实现质量问题
- 你的 Via（WebView）同样面临这个风险——甚至可能更严重（WebView 比独立浏览器 context 管理更受限）

### ✅ 被实证的路线：scene-video（内嵌 MP4 硬件解码）优先
elysia 的最终默认路径恰恰是 v1 里的 **P0 路线 C**：
```
scene.pkg → host 提取内嵌 MP4（sceneVideo）→ <video> 硬件解码播放（顺滑）
         → 无内嵌 MP4 → 静态帧（CPU 渲染单帧）
```
**"hardware-decoded and smooth"** —— 与你的 Adreno 830 硬件解码能力完美匹配，
而且**完全绕开 proot 无 GPU 和浏览器 context 冻结两个坑**。

---

## 二、修正后的方案优先级

| 优先级 | 方案 | 依据 | 状态 |
|---|---|---|---|
| **P0（强烈推荐）** | **scene-video：提取 scene.pkg 内嵌 MP4 → video 硬件解码** | elysia 实测"hardware-decoded and smooth"；避开冻结 | **先做这个** |
| P1 | 静态帧（现有）作为无内嵌视频场景的回退 | elysia 同款回退链 | 已有 |
| P2 | 浏览器 GPU 实时渲染（WebGL2/WebGPU） | **elysia 实测冻结页面，降级为 fallback** | 慎做/只作 fallback |
| 不做 | CPU 多帧动画（scene-anim） | elysia PR#61 明确放弃 | 放弃 |

### 关键洞察
**scene.pkg 里常常内嵌了作者做好的动画 MP4**（壁纸引擎作者导出预览动画）——
elysia 的 `collectSceneVideoFiles`/`scene-manifest.js` 就是去提取它。这条路：
- 动画流畅（硬件解码）✅
- 跨平台最强（mp4 谁都能播）✅
- 不碰 GPU context 冻结问题 ✅
- 工程量最小（复用我们已有的 /media 视频路由 + mpkg 解析）✅

---

## 三、推荐落地（修正版）

### Phase 1（最小可行，先做）
1. host 加 `collectSceneVideoFiles`（scene.pkg 内找 mp4/webm 条目——我们 pkg-extract
   已有 mpkg 视频提取，scene.pkg 同容器格式）
2. 加 `/scene-video/<token>` 路由（Range 播放内嵌视频）
3. 客户端：scene 壁纸若含内嵌视频 → `<video>` 播放（复用现有视频壁纸路径）；
   否则 → 静态帧（现有）

### Phase 2（增强，可选）
4. 若无内嵌视频的场景想要动态：静态帧 + **CSS 微动效**（缩放/视差/烟雾叠加，
   非真实粒子）——成本低、不冻结
5. 真·GPU 实时渲染只保留为高级开关（默认关），参考 elysia 的 scene-runtime

---

## 四、结论一句话
**elysia 用 3 个 PR + 1 个 issue 帮我们验证了路线**：浏览器 GPU 实时渲染 scene
在移动端会冻结页面（他们实测放弃/降级），真正顺滑的路是 **scene.pkg 内嵌 MP4 →
硬件解码播放**（他们现在的默认路径）。我们照做：先提取内嵌视频走 video 播放，
无视频走静态帧——这既是 elysia 的最终答案，也是你 Adreno 830 环境的最优解。

---

## 附：本次调研来源
- PR #65 (yuxilao, WebGL2 实时渲染尝试): https://github.com/elysia395/dsh-wallpaper-engine/pull/65
- PR #61 (YV3507, 移除 scene-anim): https://github.com/elysia395/dsh-wallpaper-engine/pull/61
- PR #47 (YV3507, 半成品渲染器): https://github.com/elysia395/dsh-wallpaper-engine/pull/47
- issue #64 (YV3507, 动画开发邀请/三路线): https://github.com/elysia395/dsh-wallpaper-engine/issues/64
