# Scene 渲染加速方案分析（跨平台 × 速度）

> 2026-09-03。问题：elysia395 用纯 JS CPU 逐像素渲染（4K 单帧 3-4s、动画分钟级），
> 有没有"既跨平台又快"的办法？用户列出：WebGPU / wgpu / Blender Cycles / V-Ray Hybrid /
> R2E2 / Mercury BuiltSAFE GS / SoftGLRender / SWR / darkedge-rasterizer /
> web workers + wasm + OffscreenCanvas。
>
> 先明确约束，再分类评估，最后给结论。

---

## 〇、约束（决定一切的前提）

我们的运行环境不是桌面：
- **宿主**：Android 手机里的 proot（Termux → Ubuntu），跑 dsh（Node），**容器内无 GPU 直通**
- **显示端**：手机浏览器（Via / Edge / Firefox Android）打开 DSH web 界面
- 壁纸要么在 **host(Node) 端**渲染成产物再给浏览器显示，要么在**浏览器端**渲染

这直接排除掉一半候选方案（见下）。

---

## 一、用户列的方案逐项归类

### 类别 A：GPU 标准 API（浏览器端渲染）
| 方案 | 本质 | 现状（移动端） |
|---|---|---|
| **WebGPU** | 浏览器现代 GPU API，WGSL shader | Android Chrome 121+（2024-01）默认启用，走 Vulkan；Edge(Chromium) 同；Firefox Android 较新版本支持；**Via 取决于系统 WebView 版本，不确定** |
| WebGL2 | 老一代 GPU API，GLSL | 所有移动浏览器都支持（Via 也肯定） |

**关键事实**：WebGPU 在 Android Chrome/Edge 已默认可用；Via（基于系统 WebView）需要 feature-detect。
GPU 渲染对"像素密集的 shader/合成"提速是 **100 倍级**（vs CPU 逐像素）。

### 类别 B：跨 API GPU 抽象（native 用途）
| 方案 | 本质 | 对我们的价值 |
|---|---|---|
| **wgpu** | Rust 的跨后端 GPU 抽象（Vulkan/Metal/DX12/WebGPU） | 若在**有 GPU 的 native** 写渲染器才有意义。我们 proot 无 GPU；编译 wasm 后它的后端仍是浏览器 WebGPU —— **等于绕一圈用回 WebGPU**。工程上徒增 Rust 工具链 |

结论：wgpu 不适合。它的价值"一次编写多后端"在我们只有一个真后端（浏览器）时体现不出来。

### 类别 C：离线 / 混合路径追踪（不对路）
| 方案 | 为什么不行 |
|---|---|
| **Blender Cycles** | 物理路径追踪，电影级但**每帧秒级~分钟级**；壁纸要持续动态背景，实时性不满足 |
| **V-Ray Hybrid** | 同上，偏建筑/影视离线渲染 |
| **R2E2** | 学术项目：用**数千云 CPU** 做低延迟路径追踪（Terabyte 场景）。硬件前提不符，纯学术 |

### 类别 D：高性能**软件**光栅器（CPU 参考系）
| 方案 | 说明 |
|---|---|
| **OpenSWR / SWR** | Intel 的多核 SIMD 软件光栅器（AVX512 优化，曾用于 ParaView 交互渲染）。证明"多核+SIMD 的软件光栅能到交互级"，但只跑 x86，手机 ARM 无意义 |
| **SoftGLRender** | 教学级 C++ 软渲染器（OpenGL/Vulkan 对照）。思路参考，无现成可用 |
| **darkedge/rasterizer** | 开源软光栅器项目（未大规模验证），可作 wasm 移植候选 |
| **Mercury BuiltSAFE GS** | **DO-178C 航空安全认证**的多核软件渲染器（军用航电/Zynq）。不开源、不适用、授权是商业军工 |

类别 D 的启示不是"用它们"，而是：**软渲染想快 = C++/Rust + SIMD + 多核**，对 JS 的直接出路是 **wasm**。

### 类别 E：Web 端软渲染并行（无 GPU 的跨平台提速）——最贴题
| 技术 | 作用 |
|---|---|
| **wasm（含 SIMD）** | 把像素热循环编译成 wasm + 128-bit SIMD → 纯 JS 的 **3~10×** |
| **SharedArrayBuffer + worker 分块** | 8 核手机把一帧分 8 块并行光栅 → 再 **~8×**（需 COOP/COEP 响应头，本地 host 可加） |
| **OffscreenCanvas** | worker 里直接画，主线程不卡 |

**组合收益估算**：elysia395 现 4K 单帧 3-4s → SIMD(5×) × 8 核 ≈ **0.1~0.2s/帧**，接近可用；
动画仍有压力但可配合降采样/抽帧。

---

## 二、三种务实路线

### 路线 1：渲染产物 = 视频/APNG，播放时靠硬件解码（最实用，推荐先做）
elysia395 的 `scene-anim?fmt=mp4` 其实已指出方向：
- **CPU 一次性/后台渲染**成 MP4（首次几分钟，可接受）→ 落盘缓存
- 播放时走 `<video>` **硬件解码**：任何浏览器都能播，播放期 CPU≈0、GPU 解码零压力
- 跨平台性 = mp4 的跨平台性（最强）；"快"体现在**播放期**，不是渲染期
- 我们插件已有 ffmpeg/转码/缓存全套基建，接 scene 渲染为视频是增量最小的路

### 路线 2：浏览器端 WebGPU 真·实时渲染（性能上限最高，工程最大）
- 把 elysia395 的 CPU 渲染器重写成 **WGSL compute/vertex shader**：纹理采样、光栅化、23 个 effect shader、bloom 全部 GPU 化
- 收益：4K@60fps 级真动态壁纸；CPU 近零
- 成本：工程巨大（一个渲染器重写为 GPU 管线 ≈ 数千行 shader）；**Via 兼容风险**；proot 中浏览器 GPU 可用性需实测
- 折中：先 WebGL2（兼容最广、GLSL 好写），后 WebGPU

### 路线 3：wasm + SIMD + worker 分块（无 GPU 的稳妥提速，推荐作为路线 1 的补充/替代）
- 把 elysia395 渲染器"机械翻译"到 C/Rust（或逐步把热循环 SIMD 化）→ wasm
- 不需要 GPU、不需要改浏览器、所有设备一致快
- 配合 SharedArrayBuffer 分块并行 + OffscreenCanvas
- 收益：软渲染本身快 10~80×；仍受 CPU 限制，动画不如路线 1/2 顺滑

---

## 三、结论（结合我们的项目）

| 优先级 | 方案 | 为什么 |
|---|---|---|
| **P0（先做）** | **路线 1：scene → CPU 渲染成 MP4/APNG 缓存 → video 硬件解码播放** | 跨平台最强、播放最流畅、复用现有 ffmpeg/缓存；首次慢但可接受（有进度条） |
| P1（增强） | 路线 1 的渲染端用 **wasm+SIMD+worker**（路线 3）提速首次生成 | 无需 GPU，全设备一致，把"分钟级首次"压到十几秒 |
| P2（远期/实验） | 浏览器端 **WebGL2 → WebGPU** 实时渲染（路线 2） | 上限最高；等 Via 兼容性确认 + 团队资源充足再做 |
| 不做 | wgpu / Cycles / V-Ray / R2E2 / BuiltSAFE / SWR / SoftGLRender | 环境不符（无 GPU、非 native）、实时性不符、不开源/军工授权 |

**一句话**：我们的"跨平台"瓶颈不是渲染 API 而是**环境没有 GPU**；最快的现实路径是
"CPU 渲染成标准视频 → 浏览器硬件解码播放"（跨平台交给 mp4，速度交给 GPU 解码），
渲染端用 wasm 并行提速首次生成；WebGPU 是远期上限，不是当前解。

---

## 附：参考链接
- WebGPU 移动端：Chrome 121 起 Android 默认启用（走 Vulkan）——https://developer.chrome.com/docs/web-platform/webgpu/overview
- wgpu（Rust，多后端）：https://github.com/gfx-rs/wgpu
- Intel OpenSWR（多核 SIMD 软光栅，x86）：https://www.openswr.org
- SoftGLRender（教学软渲染器）：https://github.com/ymynoon/SoftGLRender
- R2E2（云 CPU 路径追踪，学术）：https://par.nsf.gov/biblio/10346865
- Mercury BuiltSAFE GS（DO-178C 航空软渲染）：https://www.mrcy.com/legacy_assets/contentassets/c6e5da6ba679401794a62d686d4dd1ef/3330.01e-0917-ds-gs-mc-renderer.pdf
