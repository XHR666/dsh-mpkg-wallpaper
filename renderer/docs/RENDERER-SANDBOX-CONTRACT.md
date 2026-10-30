# 渲染器沙箱契约（B6）— 插件侧 ↔ 渲染器侧接口冻结

> 背景（事实核实于 2026-09-13，见 `PLUGIN-BUGS-TRACKER.md` 批次 17）：壁纸 iframe 目前带
> `sandbox="allow-scripts allow-same-origin allow-pointer-lock"`。渲染器文档自身源是 `http://127.0.0.1:8899`，
> 但它 **可以从文档内 `fetch()` 调用插件宿主路由**（`thumbpost` 是插件通过 iframe URL 传进来的
> `location.origin + HOST_BASE + "/custom-scene-thumb"`）——场景脚本与渲染器同域执行，等于把
> "能带宿主 cookie 的写接口"暴露给第三方 mpkg 脚本（混淆代理面；cookie 是 `HttpOnly` 所以偷不走）。
>
> B6 的目标（本契约冻结的接口）：**去掉 `allow-same-origin`（iframe 变不透明源）+ 宿主签发场景级短期 token**。
> 不透明源带来的必然副作用必须同时处理，否则渲染器会整体失效：**它自己的 `fetch('/…')` 也变成跨源**。

## 1. 三种模式（插件侧决定，渲染器只读信号）

| 模式 | sandbox 属性 | 生效条件 |
|---|---|---|
| `strict`（目标态） | `allow-scripts allow-pointer-lock` | 插件拿到宿主签发的场景 token（`GET /scene-thumb-token` 成功） |
| `legacy`（兼容态） | `allow-scripts allow-same-origin allow-pointer-lock` | token 路由不可用（宿主未重启 → 404/401）、用户显式 `?mpwsandbox=legacy`、或**自动回退**触发 |
| `legacy-fallback` | 同 legacy | strict 启动后 8s 内未收到 `mpw-cap{ok:true}`，或收到 `{ok:false}` → 插件**重建一次** iframe 并置 `data-mpw-sandbox="legacy-fallback"` |

- 渲染器**无需**知道自己在哪种模式：它只看 URL 参数（第 2 节）是否给了 token、以及浏览器是否给了
  不透明源（可自行探测：`try { localStorage } catch {}` 或 `document.origin === 'null'`）。
- 插件 diag 必须暴露：`sandbox: { mode, reason, fallback, tokenOk, cap }`（`cap` = 渲染器上报的能力对象）。

## 2. 参数与消息契约（渲染器侧实现面）

### 2.1 iframe URL（插件 → 渲染器，均为可选、缺省即旧行为）

- `thumbpost=<绝对 URL>`：**已有**，缩略图上传目标（宿主路由）。
- `thumbtoken=<token>`：**新增**。仅 strict 模式注入；值是宿主 `GET /scene-thumb-token?scene=<identity>`
  返回的 `token`。
  **传输方式（2026-09-13 修正，勿改为请求头）**：token 必须放进**简单请求**里 ——
  上传 POST 走 body 字段 `sceneToken`（现有 body 已是 `text/plain` 的 JSON 字符串），
  `/raw` 的包地址由插件拼 `&st=<token>`。**不要**用 `X-MPW-Scene-Token` 之类的自定义头：
  自定义头会触发 CORS 预检，而预检不带 cookie、会被 dsh 的鉴权墙 401 掉（宿主路由无法自行回答预检）。
- `sandbox=strict`：**新增**，提示渲染器"当前是不透明源"。渲染器据此给纹理/视频加载加
  `crossOrigin='anonymous'`（否则 canvas 被污染、`toDataURL` 抛错）。

### 2.2 渲染器 → 插件：`mpw-cap`（新消息，v1）

```js
parent.postMessage({ type: 'mpw-cap', v: 1,
  ok: true,              // 渲染管线是否可用（false 触发插件回退）
  opaque: true,          // document.origin === 'null'（不透明源）
  sceneId: '...',        // 渲染器已知的场景身份（可空字符串）
  firstFrame: true,      // 首帧是否已出画
  tainted: false,        // canvas 是否被污染（toDataURL 试写失败 = true）
  thumbToken: true,      // URL 是否带了 thumbtoken
  errs: []               // 最多 3 条致命错误短字符串
}, '*')
```

- **发送时机**：脚本初始化完成（`ok` 未知时发 `firstFrame:false`）→ 首帧出画后（`firstFrame:true`）→
  能力变化时（如 canvas 变污染）各一次；同内容不重复发。
- 插件侧一律校验 `event.source === frame.contentWindow`，否则丢弃（B 已有该模式，`mpw-ln-mode` 同理）。
- **兼容**：旧渲染器不发这条消息 → 插件 8s 后回退 legacy（即可用），不会白屏。

### 2.3 宿主路由（插件侧实现面，渲染器只需按 2.1 带 token）

- `GET /scene-thumb-token?scene=<identity>`：**宿主**签发 `{ token, exp }`；HMAC-SHA256(secret, `scene|exp`)，TTL 30 分钟。
- `POST /custom-scene-thumb`：接受**两者之一** —— ① 现有 cookie 会话（旧插件兼容）；
  ② body 字段 `sceneToken` 合法且 token 内 scene 与 body 解析出的 identity **一致**。
- `GET /raw?...`：插件在 strict 模式下追加 `&st=<token>`；宿主规则 ——
  **请求头 `Origin: null`（= 不透明源）时必须有合法 `st` 且 identity 匹配，否则 403**；
  无 `Origin: null`（旧插件 / 同源调用）时保持今天的行为不变。
  这条是 B6 的执行点：第三方场景脚本虽与渲染器同域，但它是**不透明源**，没有 token 就调不动 `/raw`，
  也就读不到别的场景/目录文件；token 只授权它自己那一个场景，30 分钟后失效。
- 需要 CORS 回显的只有 `/raw` 与 `/custom-scene-thumb` 两条（渲染器要用）；插件其余路由
  （`/list-dirs`、`/media`、`/settings`、`/upload`、`/update-*`）**不得**回显跨源许可 —— 它们只服务插件 UI。

## 3. 渲染器服务器（`:8899`）必须补的 CORS

不透明源下渲染器**自己的** `fetch('/report'|'/pkg/'|'/noise'|'/weassist/…')` 全部变成跨源请求，
服务器必须对所有响应（含 `206 Partial Content`、`OPTIONS`）带：

```
access-control-allow-origin: *
access-control-allow-headers: content-type
access-control-allow-methods: GET, HEAD, POST, OPTIONS
```

本地渲染器服务器只服务渲染器自身的静态资源与包数据，无凭据、无秘密，`*` 是本机开发场景的合理口径；
**不要**给插件宿主路由加 `*`（那是带 cookie 的会话面）。

## 4. 兼容与验收硬约束

1. **旧行为不变**：URL 不带 `sandbox=strict`/`thumbtoken` 时，渲染器输出与今天**逐像素一致**
   （`?att=legacy`、CPU 预览、静态帧提取路径都不受影响）。
2. **渲染器门禁保持全绿**：`bash we-scene-demo/run-all-tests.sh`（36 项，0 FAIL）。
3. 新增测试：渲染器侧 `sandbox-cors-test.mjs`（断言 `:8899` 各路由的 CORS 头 + 预检响应）；
   插件侧 `tools/scene-sandbox-test.mjs`（sandbox 属性/模式选择/token 校验/diag 字段）。
4. 新增调试开关必须写进 `README-DIAGNOSTICS.md`（`diag-flags` 门禁项会校验数量一致）。
5. 任何改动都要在 `PATCHES.md` 追加条目（编号唯一且递增），插件侧另记 `PLUGIN-BUGS-TRACKER.md` 批次。
