# PROVENANCE · 渲染器组件与插件的边界声明

> 本文件随渲染器目录（`renderer/**`）一起分发。它声明渲染器与宿主插件
> （`dsh-mpkg-wallpaper`，MIT）之间的集成形态，以及"无代码互相复制"的边界事实。
> 本文是工程与合规声明，不是法律意见。

## 1. 两部分的许可

| 目录 | 许可 | 说明 |
|---|---|---|
| `lib/**`（插件本体，本目录之外） | **MIT**（全文见插件包 `LICENSES/MIT.txt`） | 插件源码、host 路由、设置面板 |
| `renderer/**`（本目录） | **GPL-3.0-or-later**（全文见本目录 `LICENSE`） | 浏览器端 Wallpaper Engine 渲染器 |

渲染器自身的第三方组件台账见本目录 `THIRD-PARTY.md`（MIT / ISC / OFL-1.1 / Apache-2.0 / CC-BY-4.0 等）。

## 2. 集成方式：只有 iframe + postMessage（进程边界）

- 插件 host 侧把本目录作为**只读静态资源**托管在同源路径 `/webloader/**` 下
  （只做"发文件"：GET/HEAD + 扩展名白名单 + 路径穿越防护，不含本目录 `server/**` 的任何业务端点）。
- 渲染器页运行在插件的**沙箱 iframe** 里（`sandbox` 属性，默认 strict 档无 `allow-same-origin`），
  与插件页之间只通过 **`postMessage` 消息 op** 通信（属性下发 `mpw-user-props`、
  属性描述/恢复默认 `mpw-props-*`、逐层开关 `mpw-layers-*`、UI 开关 `mpw-ui-set` 等）。
- 场景包字节由插件经 `/raw` 路由以 URL 形式交给渲染器（首帧必需参数走 URL；
  运行期能力一律走 postMessage，不改 URL）。

## 3. 无代码互相复制

- **插件（MIT 侧）没有复制、改写或内联本目录的任何源码**；插件的构建产物（bundle）不含渲染器代码。
- **渲染器（GPL 侧）没有复制插件 `lib/**` 的源码**。渲染器内的 Now Playing 组件
  （`demo/now-playing/**`）与插件内的 `lib/now-playing.js` 是**各自独立**的两份移植，
  同源于 Bencho 的 "Now playing"（MIT）设计，二者互不复制（两侧各有机器断言钉住这一点）。
- 两部分之间没有共享数据结构、没有编译进同一产物、没有同作用域内部调用 ——
  关系是**独立程序的同处分发（聚合）与公开接口调用**，不是结合作品。

## 4. 再分发提示

拿到本插件包的再分发者：`renderer/**` 部分按 **GPL-3.0-or-later** 及其源码要求履行义务
（本包已随附其完整源码与许可全文）；`lib/**` 部分按 **MIT**。两部分许可各自独立适用。
