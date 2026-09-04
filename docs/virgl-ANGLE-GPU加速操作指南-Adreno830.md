# Termux + proot XFCE4 桌面 GPU 加速操作指南（Adreno 830 免 root）

> 2026-09-04。针对你的环境实测确认：
> - 手机：**Adreno 830**（骁龙 8 Elite），**无 root**，Termux app 沙箱（uid 10325）
> - 架构：arm64；Termux + proot-distro Ubuntu 24.04（手动，非 DSHA）
> - proot 已带 `--shared-tmp` ✓（virgl 必需）
> - Android 系统自带 `vulkan.adreno.so`（已 bind 进 proot，可见）
>
> **为什么必须走 ANGLE**：Adreno 830 属于 a8xx 新架构，Mesa 的 turnip/freedreno
> 直连驱动**要到 Mesa 26 才支持**（实测报 `unknown UBWC version 0x5`）。所以
> 方案 = virgl（转发）→ **ANGLE**（把 GLES 转 Vulkan）→ **Android 系统 Vulkan**
> （`vulkan.adreno.so`，无需 root、绕开 mesa turnip 对 a8xx 的支持缺口）。

---

## 一、Termux 侧（proot 外面，在 Termux 终端执行）

### 1. 加仓库 + 装包

```bash
pkg update
pkg install x11-repo tur-repo -y
pkg install virglrenderer-android angle-android -y
```

> `angle-android` 提供 ANGLE（GLES→Vulkan 转译），`virglrenderer-android` 提供
> virgl 服务器。这两个在 tur-repo 里，是国内镜像同步的稳定版。
> 若 pkg 装的是旧版 virgl（1.0.x），可选升级到 1.1.0（更稳，android 10+）：
> ```bash
> cd && wget https://github.com/ar37-rs/virgl-angle-termux/releases/download/latest/virglrenderer_1.1.0-11_aarch64.deb
> dpkg -i ~/virglrenderer_1.1.0-11_aarch64.deb
> ```

### 2. 下载 vgl 辅助脚本（管理 virgl 后端开关）

```bash
cd && rm -rf ~/vgl && wget https://github.com/ar37-rs/virgl-angle-termux/releases/download/latest/vgl && chmod +x ~/vgl
```

### 3. 启动顺序（每次开机）

**先开 termux-x11**（你已有）：
```bash
termux-x11 :0 -ac &
```

**再选 ANGLE 后端并启动 virgl 服务器**：
```bash
~/vgl use-angle        # 用 ANGLE→Vulkan（Adreno 830 走这个）
# 或 ~/vgl angle=vulkan-null   # 无显示器直出的 Vulkan（默认）
# 若 ANGLE vulkan 有问题，试 ~/vgl use-android（纯 Android GLES 后端）
```

`~/vgl use-angle` 会在后台拉起 `virgl_test_server`（监听 Unix socket），
并设置好环境变量。验证在跑：
```bash
pgrep -af virgl_test_server
```

> 把 `~/vgl use-angle` 加进 Termux 的 `~/.bashrc` 可开机自动起（可选）。

---

## 二、proot 侧（Ubuntu 内）

### 4. 登录 proot 时确保 --shared-tmp（你已是）
你现有的 `proot-distro login ubuntu` 命令已带 `--shared-tmp`（我实测到进程
参数里有），virgl socket 才能两边互通。**确认**：每次 login 命令里都有
`--shared-tmp`，没有就补上。

### 5. Ubuntu 里装 virgl 客户端驱动（mesa virgl / zink）

```bash
apt update
apt install -y mesa-utils libgl1-mesa-dri libgl1-mesa-glx
# virgl 客户端 = mesa 的 virgl 驱动（在 libgl1-mesa-dri 里）
ls /usr/lib/aarch64-linux-gnu/dri/ | grep -i virgl   # 应有 virgl_dri.so
```

> 若没有 virgl_dri.so（Ubuntu 22.04 mesa 23.2 应该有），换装新 mesa 或直接
> 用 `GALLIUM_DRIVER=zink`（zink 也在 dri 目录里，需 mesa ≥23.2 + turnip；
> **但 turnip 不支持 a8xx** → 别用 zink，用 virgl + ANGLE 后端才是对的）。

### 6. 在 proot 里以 virgl 环境启动 XFCE / 应用

```bash
export DISPLAY=:0
export GALLIUM_DRIVER=virgl
startxfce4 &
```

**验证 GPU 是否真的通了**（关键一步）：
```bash
export DISPLAY=:0
export GALLIUM_DRIVER=virgl
glxinfo | grep -E "OpenGL renderer|OpenGL version|direct rendering"
```
期望看到：
```
direct rendering: Yes
OpenGL renderer string: virgl (ANGLE Vulkan 1.x.x ...)   # 或 virgl (ANGLE ...)
OpenGL version string: 4.5 (Compatibility Profile) ...
```
> 若 `OpenGL renderer` 是 `llvmpipe` / `softpipe` → 还在 CPU 软渲染，virgl
> socket 没连上（查第 3 步 virgl_test_server 是否在跑、DISPLAY 是否对）。
> 若是 `virgl` → **成功，GPU 加速已生效**。

---

## 三、让 dsh 浏览器也用上（可选，若你在 xfce4 里开 Firefox/Chromium）

在 xfce4 里启动浏览器前导出同样的变量，或写进 xfce 的会话启动：
```bash
export DISPLAY=:0
export GALLIUM_DRIVER=virgl
firefox http://127.0.0.1:3080   # 例：在 GPU 加速的浏览器里开 dsh
```

> ⚠️ 注意：Via/Edge（Android 原生 app 打开 localhost）不走 xfce4 的 X11，
> 不受此影响——它们本来就用 Android 自己的图形栈。virgl 加速的是 **xfce4
> 桌面里的 Linux GUI 程序**（Firefox Linux 版、glxgears 等）。

---

## 四、验证工具 & 常见问题

```bash
# 综合验证（Termux 侧跑 vgl 后，proot 里）
glxinfo | head -20                  # GL 渲染器/版本
glxgears                           # 帧率（CPU 软渲染个位数，GPU 加速数百）
vulkaninfo --summary 2>/dev/null | head   # 直接看 Android Vulkan
```

| 现象 | 原因 | 解决 |
|---|---|---|
| `llvmpipe`/`softpipe` | virgl socket 没连上 | ① Termux 里 `~/vgl use-angle` 起 server ② 确认 proot login 带 `--shared-tmp` ③ 两边 DISPLAY 一致 |
| `unknown UBWC version` / `vkEnumeratePhysicalDevices failed` | 直连 mesa turnip 不支持 a8xx | **别用 turnip/zink 直连**，走 ANGLE 后端（第 3 步 `~/vgl use-angle`） |
| ANGLE vulkan 初始化失败 | 个别设备 ANGLE→Vulkan 问题 | 试 `~/vgl use-android`（纯 Android GLES 后端）或 `~/vgl angle=gl` |
| glxinfo 报 EGL/GLX 版本低 | Ubuntu mesa 太老 | 升级 mesa 或用 virgl 4.3COMPAT 覆盖：`MESA_GL_VERSION_OVERRIDE=4.3COMPAT` |

---

## 参考链接
- [heavylildude/virgl-angle-termux](https://github.com/heavylildude/virgl-angle-termux)（aarch64 免 root，ANGLE 后端）
- [Willie169/termux-x11-virgl-gpu-acceleration](https://github.com/Willie169/termux-x11-virgl-gpu-acceleration)（proot 版步骤）
- [termux-desktop issue #244](https://github.com/sabamdarif/termux-desktop/issues/244)（Adreno 830：mesa turnip 要等 26）
- [LinuxDroidMaster/Termux-Desktops HardwareAcceleration](https://raw.githubusercontent.com/LinuxDroidMaster/Termux-Desktops/refs/heads/main/Documentation/HardwareAcceleration.md)
- [termux-packages angle-android](https://github.com/termux/termux-packages/pull/17418)
