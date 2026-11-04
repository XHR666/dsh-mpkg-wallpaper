# extensions/ —— 外部扩展钩子（预留接口）

这个目录是**预留的可插拔入口**：现在没有功能依赖它，将来需要"外挂逻辑/远程资源/额外后处理/标定表"
时，把 `*.js`（或 `*.mjs`）模块丢进来即可，不必修改渲染器本体。

## 用法（浏览器）

```
http://127.0.0.1:8899/?pkgpath=<包>&extbase=http://127.0.0.1:8899/ext
http://127.0.0.1:8899/?pkgpath=<包>&exthooks=http://host/hookA.js,http://host/hookB.js
```

- `extbase` → 页面先取 `<base>/`（本服务器 `/ext` 索引 JSON），把 `hooks[]` 里的文件全部 `import` 并注册。
- `exthooks` → 直接列出模块绝对 URL。
- 模块导出 `default`（或 `hooks`）对象，键名 = 槽位名。

## 槽位（slot）

| 槽位 | 签名 | 作用 |
|---|---|---|
| `resolveTexture` | `(name, ctx) → {glTex,width,height,rg88?,sprite?} \| null` | 纹理缺失时接管（远程资源服务、程序化纹理、占位图） |
| `layerRect` | `(layer, rect, ctx) → [x,y,w,h] \| null` | 覆盖层的设计空间实绘矩形（外部标定表 / 校正） |
| `shaderSource` | `(rel, ctx) → string \| null` | 提供 GLSL 源（外部 shader 库） |
| `postFrame` | `(stats) → void` | 每帧合成后调用（额外后处理 / 埋点 / 截图） |
| `stats` | `(stats) → void` | 帧统计回调（性能监控） |

约定：**任何钩子抛错、返回 null/undefined 都等于"没接管"**，渲染继续走默认路径；因此钩子不可能把画面搞坏。

## 服务器路由（已保留）

| 路由 | 说明 |
|---|---|
| `GET /ext` | 扩展索引 JSON：`{ok, slots, hooks[]}` |
| `GET /ext/<name>` | 返回该扩展模块（`text/javascript`，CORS `*`）；不存在时 404 + 明确错误 |

## 例子

见同目录 `example-hook.mjs`：它把 `resolveTexture` 用于缺失纹理（返回 1×1 洋红以便一眼看出哪些层缺纹理），
并把 `postFrame` 用于统计打印。默认**不会被加载**（文件名以下划线开头的会被索引忽略；示例用 `_example` 前缀时
请自行改名或显式用 `?exthooks=` 指定）。
