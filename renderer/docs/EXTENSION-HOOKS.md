# EXTENSION-HOOKS.md — 预留的可插拔接口（2026-09-13）

> 目的：把"现在还没用上、但将来可能用得上"的能力**先留出入口**，以后接入时不用改渲染器本体、
> 也不用改插件协议。所有钩子都是**可选、默认无操作**，任何异常都不会影响画面。

## 1. 总览

```
插件面板（DSH :3080）                       渲染器页面（:8899）
┌──────────────────────────┐   iframe      ┌───────────────────────────────────────┐
│ /raw 暴露容器字节         │──────────────▶│ demo.html?pkgurl=…&extbase=/ext       │
│ settings.sceneExtUrl ────┼── extbase ───▶│  import(<extbase>/<hook>.js)          │
└──────────────────────────┘               │        ↓ registerMpwHook(slot, fn)    │
                                           │  core/we-scene-bundle.js  runMpwHook(slot) │
                                           └───────────────────────────────────────┘
```

- **渲染器侧**：`core/we-scene-bundle.js` 导出 `registerMpwHook(slot, fn)` / `runMpwHook(slot, args)` / `MPW_HOOK_SLOTS`。
- **页面侧**：`demo.html` 支持 `?exthooks=<url[,url]>`（直接列模块）与 `?extbase=<base>`（先取 `<base>/` 索引再加载）。
- **服务器侧（已预留）**：`GET /ext`（索引 JSON）、`GET /ext/<name>`（模块，CORS `*`）；文件放 `we-scene-demo/extensions/`。
- **插件侧**：设置项 `sceneExtUrl`（可选）会自动作为 `extbase` 拼进 iframe URL，无需改代码。

## 2. 槽位定义

| 槽位 | 签名 | 调用时机（代码位置） | 返回 |
|---|---|---|---|
| `resolveTexture` | `(name, ctx) → texObj \| null` | 层声明了纹理名但 `textures` 里没有（`renderLayer` 内，白块回退之前） | `{ glTex, width, height, rg88?, sprite? }` |
| `layerRect` | `(layer, rect, ctx) → [x,y,w,h] \| null` | 预留（外部标定表覆盖层矩形） | 设计空间 y-down 矩形 |
| `shaderSource` | `(rel, ctx) → string \| null` | 预留（替代/补充内置 `shaderResolver`） | GLSL 源 |
| `postFrame` | `(stats) → void` | 每帧合成（含 bloom）之后 | 无 |
| `stats` | `(stats) → void` | 同 `postFrame`（性能埋点用，便于将来分开节流） | 无 |

`ctx` 目前包含：`{ layer, textures }`（resolveTexture）、`{ frame, w, h, layers, tex }`（postFrame/stats）。

## 3. 两种接入方式

```js
// A. 直接挂全局对象（插件/用户脚本最简）
globalThis.__mpwHooks = {
  resolveTexture(name) { /* 返回纹理对象或 null */ },
}

// B. 模块（推荐，可热插拔）
// extensions/my-hook.mjs
export default {
  resolveTexture(name, ctx) { return null },
  postFrame(stats) { console.log(stats) },
}
// 页面：?extbase=http://127.0.0.1:8899/ext  或  ?exthooks=<该文件 URL>
```

## 4. 设计约束（为什么这样留）

1. **零侵入**：核心路径只多一次 `runMpwHook`（无钩子时是一次属性查找）；返回 null 即走原逻辑。
2. **可回退**：钩子抛错被 try/catch 吞掉并继续，绝不会让画面变黑/变白。
3. **可远程**：`extbase` 允许指向任意主机（服务器路由已带 CORS），将来可以把"资源服务/标定服务"
   放到独立进程，而不必塞进渲染器。
4. **可观测**：`postFrame/stats` 让外部拿到帧统计（帧号、尺寸、层数、纹理数），便于接性能面板。

## 5. 尚未启用但已预留的典型用途

| 用途 | 用哪个槽位 | 说明 |
|---|---|---|
| 远程/程序化纹理（如官方资产服务、缺失纹理补全） | `resolveTexture` | 现在的回退是"1×1 白"（RE-41 官方行为） |
| 逐壁纸实绘矩形标定表（替代 `refrender-*.json` 硬编码） | `layerRect` | 位置校正可以做成外部数据，不动渲染器 |
| 外部 shader 库 / 自定义后处理 | `shaderSource` + `postFrame` | 例如用户自定义泛光、色调映射 |
| 截图/录屏/性能面板 | `postFrame` / `stats` | 面板侧可开一个"开发者"开关读取 |
| A/B 诊断（如 `?mcc`、`?piv`、`?whitefallback`） | 直接用 URL 参数 | 已内建，见 `<工作区>/docs/status/` |
