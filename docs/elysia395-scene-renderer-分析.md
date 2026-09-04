# elysia395 Scene 壁纸渲染方案分析（2026-09-03）

> 调研对象：[elysia395/dsh-wallpaper-engine](https://github.com/elysia395/dsh-wallpaper-engine) v0.7.0（`dsh-plugin-wallpaper-engine`）
> 目的：了解其 Scene 完整渲染的实现方式，供 dsh-mpkg-wallpaper 后续决策。
> 结论先行：elysia395 在 **v0.6 起实现了纯 JS 的 WE 场景完整渲染器**（不再只是静态帧），
> MIT 许可可移植；我们目前是「静态帧提取 + 图层合成」折中方案，README 曾断言
> "场景无法在 Web 端完整还原"——elysia395 证明了可以，只是工程量很大（约 8200 行）。

---

## 一、整体架构

```
lib/scene-renderer.js        ← 兼容入口（re-export）
lib/scene-render-worker.mjs  ← worker 线程渲染（不阻塞主进程）
lib/we-renderer/             ← 渲染引擎核心（~5100 行）
├── core.js      SceneRenderer 主体（783 行）：对象树 resolve / 动画烘焙 / 相机 /
│                脚本执行 / 按 renderType 分发渲染 / Bloom 后处理
├── math.js      向量/矩阵（mat4 TRS/透视/正交/变换）+ 颜色工具
├── canvas.js    自研 CPU Canvas（encodePng/decodePngBuffer）
├── textures.js  scene.pkg（PKGV 容器）/ 松散目录访问器 + 纹理加载
├── image.js     2D 图像对象渲染（454 行）
├── text.js      文本对象渲染（含字体解析 font-render.js）
├── mdl.js       MDL 网格解析（puppet 80B + 静态 MDLV0004/0014）
├── model.js     3D 模型对象渲染（705 行，顶点/UV/索引/纹理）
├── puppet.js    木偶骨架蒙皮（648 行）
├── particles.js 粒子系统（531 行：发射器/初始化器/运算符/精灵）
├── bloom.js     辉光后处理（250 行）
├── camera.js    相机（293 行：正交/透视/视差/路径）
├── effects.js   + effects/ 目录（23 个 shader 效果 CPU 实现：
│                waterwaves/waterripple/waterflow/clouds/godrays/shake/
│                bloom/glitter/foliagesway/lightshafts/...）
├── jpeg.js      JPEG 解码（自研，458 行）
├── glsl/        GLSL 着色器转译/执行（transpile/runtime/executor）
└── apng-encode.js  APNG 多帧编码（scene-anim 用）
```

辅助模块：`scene-scripts.js`（NSL 脚本运行时）、`scene-manifest.js`、
`scene-player.js`、`font-render.js`、`pkg-extract.js`（TEX 纹理解析，与我们同源借鉴）。

---

## 二、两条渲染路径

### 1. scene-frame（静态帧，缓存到磁盘）
- 路由 `GET /wallpaper-engine/scene-frame/<token>`
- 缓存 key `sf33_<abs base64url>_<mtime>`，输出 PNG/JPG 落盘（`.tmp`+rename 原子写）
- 优先用 **SceneRenderer 完整渲染**（worker 线程，3840×2160，尺寸按场景 ortho 比例修正）
- 空帧门禁：渲染结果与 clearcolor 差异 < 0.05% 视为空白 → 判失败走回退链
- 失败回退 → 旧的主纹理提取（`extractSceneMainImage`）
- inflight 去重：同一 key 并发请求共享一次渲染

### 2. scene-anim（动画，APNG / MP4）
- 路由 `GET /wallpaper-engine/scene-anim/<token>?fps=..&sec=..&fmt=apng|mp4`
- worker 里**复用单个 SceneRenderer 实例**，每帧只换 `time`（避免逐帧重读 pkg/重解码纹理，
  336MB 场景逐帧重建会内存爆炸）
- 逐帧压缩 IDAT → APNG 编码；进度经 `parentPort` 上报（前端进度条）
- 多帧动画启用效果降采样加速（sf38）；静态帧全分辨率（sf33）
- `?fmt=mp4`：首次渲染分钟级，完成后无缝切 `<video>` 硬件解码播放（有落盘缓存）
- 有内嵌 MP4（sceneVideo）的场景直接用硬件解码，不再触发 CPU scene-anim

---

## 三、SceneRenderer 核心（core.js，783 行）

```js
constructor(pkgPath, opts):
  pkg = readPkg(pkgPath) | readPkgDir(dir)   // scene.pkg 或松散 scene.json 目录
  scene = pkg.readJson('scene.json')
  canvas = new Canvas(W=3840, H=2160)
  读取 userProps（project.json general.properties，脚本默认值依赖它）
  _resolveObjects()   // 对象树拓扑排序

render():
  _resolveAnimations(t)   // 属性动画 {animation:{c0:[{frame,value}],options}} 烘焙
  _setupCamera()
  _backupScriptValues / _restoreScriptValues   // 多帧防脚本值污染
  applySceneScripts(...)  // NSL 脚本：{script,value} 动态值、canvasSize、userProps
  clear(clearcolor)
  for (o of renderOrder):   // 按 _renderType 分发
    renderImage / renderModel / renderParticleSystem / renderTextObject
  _applyBloom(gen)   // bloom 后处理
```

- **属性动画**：alpha/scale/origin/angles/visible/color/size/brightness/parallaxDepth/zoom
  逐通道（c0/c1/c2）插值；loop/reverse 播放模式；多帧复用先备份再恢复
- **对象类型**：image / model / particle / text；顶层还有 live component（脚本 UI，跳过）
- **相机**：正交（orthogonalprojection.width/height 定场景尺寸）或透视，视差鼠标

---

## 四、关键逆向点（我们 pkg-extract.js 已有部分）

| 组件 | elysia395 做法 | 我们现状 |
|---|---|---|
| PKGV 容器 | 双格式头（PKGV 旧/新），u32 条目表 | ✅ 同源（mpkg 方式） |
| TEX 纹理 | parseTex/decodeTex（与我们同源） | ✅ 已有 |
| 内嵌 PNG 纹理 | 直接解码 | ✅ 已有 |
| JPEG | 自研 decodeJpeg | ❌ 无（可 npm jpeg-js） |
| MDL 骨架 | parseMdlPuppet（80B stride）+ 静态 MDLV | ❌ 无 |
| 3D 模型 | model.js 705 行 | ❌ 无 |
| 木偶蒙皮 | puppet.js 648 行 | ❌ 无 |
| 粒子系统 | particles.js 531 行 | ❌ 无 |
| shader 效果 | effects/ 23 个 CPU 实现 + glsl/ 转译 | ❌ 无 |
| NSL 脚本 | scene-scripts.js + scene-script-apis.js | ❌ 无 |
| Bloom | bloom.js | ❌ 无 |
| 动画烘焙 | core._resolveAnimations | ❌ 无（我们只取静态帧） |
| APNG/MP4 动画 | apng-encode + scene-anim 路由 | ❌ 无 |

---

## 五、运行位置与依赖

- **纯 Node/host 端渲染**：SceneRenderer 是同步 CPU 渲染，放 worker 线程避免阻塞事件循环
  （scene-render-worker.mjs 用 `node:worker_threads`）
- npm 依赖仅 2 个：`jpeg-js`、`@shaderfrog/glsl-parser`（都可替代或内联）
- MIT 许可（2026 elysia395），可移植，注明出处即可
- 我们已有可复用的地基：PKGV/TEX 解析、scene.json 图层清单、manifest/layer 磁盘+内存缓存、
  `/custom-scene-frame` `/library-scene-frame` 路由、`scene-frame` 静态帧内存缓存

---

## 六、移植到 dsh-mpkg-wallpaper 的评估

### 可行路径
1. **拷贝 we-renderer 全套 + scene-scripts/font-render/apng-encode**（约 8200 行 + 3 个辅助模块）
2. host 端加 `/scene-frame/<key>` 完整渲染路由（worker 线程），失败回退现有静态帧
3. 复用现有 scene 素材发现（customDir/Steam library/workshop）
4. 前端 scene 壁纸从「显示静态帧」升级为「显示渲染帧 + 可选动画」

### 风险点
- 体积：+~200KB 代码（client 不打包，host 端 node 加载，影响小）
- 兼容：需实测覆盖我们遇到的各类 scene.pkg（含 122MB 视频纹理大包）
- 性能：4K 渲染单帧秒级、动画分钟级（Android 上更慢）——与 elysia395 同样受限于设备
- 维护：we-renderer 独立子目录，升级靠 git 拉取对比

### 最小借鉴（不做全量移植时）
- MDL 静态网格/木偶静态帧 → 让「人物立绘类」场景从空白升级为可显示
- 空帧门禁 + ortho 比例修正（sceneframe 已按 16:9 裁切，非 16:9 会裁坏）

---

## 参考

- elysia395/dsh-wallpaper-engine: https://github.com/elysia395/dsh-wallpaper-engine
- README 中 Scene 章节：「Scene（场景）由纯 JS 场景渲染器完整重放（对象树/纹理/粒子/
  shader 效果），解析 scene.pkg 对象树，渲染全部 image 层（含 waterwaves/waterripple/
  shake 等 CPU 实现）、puppet 骨骼网格、粒子系统」
- 本地调研副本：/tmp/elysia-dsw（v0.7.0 全量 clone）
