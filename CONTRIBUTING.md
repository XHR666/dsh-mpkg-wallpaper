# 贡献说明

[中文](CONTRIBUTING.md) | [English](CONTRIBUTING.en.md)

谢谢你愿意改这个插件。提交前先看清两件事：仓库是双许可，以及哪些文件可以手改。

## 许可边界

| 部分 | 许可证 | 改动时 |
|---|---|---|
| 插件本体 `lib/**`、图标、README、本文件、`SECURITY.md` | **MIT** | 保留根目录 `LICENSE` 与 `NOTICE` |
| 内置渲染器 `renderer/**` | **GPL-3.0-or-later** | 保留 `LICENSE-render`、`renderer/LICENSE` 与修改声明 |

`lib/**` 只通过 iframe 和 `postMessage` 使用渲染器，不要 `import` / `require` 它的源码。渲染器里的修改要留在 `renderer/**`，并按 GPLv3 写明改了什么。第三方素材同步更新 `THIRD-PARTY.md`。

## 可以改什么

- 缺陷修复、设置项、壁纸加载、外观与诊断。
- 判据：改了行为就补或更新对应的 `tools/*-test.mjs`，不要为了变绿删掉断言。
- 用户能看见的说明保持中英两份：`README.md` / `README.en.md`，以及本文件和 `SECURITY.md` 的英文版。

这些位置不要手改：

- `lib/client.js` 里由构建脚本内联的 Now Playing / audio bus 生成区。
- `dist/` 构建产物。
- 版本号。发版由维护者统一改。

## 本地检查

需要 Node.js ≥ 20。与改动相关的判据先跑；不要为了一小处改动反复跑全量。

```bash
node --check lib/client.js
node tools/integrity-check.mjs
node tools/secret-scan-test.mjs
node tools/style-scope-guard.mjs
```

样式、发布面或装机文件有改动时，再跑：

```bash
bash tools/check.sh
```

全量门禁里有无头浏览器步骤。机器内存紧、或者本机 DSH 正在使用时，先跑上面的离线判据，不要并行开多个浏览器。

## 拉取请求

一个拉取请求只做一件事。说明里写：

1. 改了什么、为什么改。
2. 跑过哪些判据，通过数和失败数。
3. 没在真实浏览器里看过的部分。

不要放进提交：

- 令牌、密钥、诊断导出里的真实地址。
- 本机绝对路径、个人目录。
- `node_modules/`、`dist/`、探针输出和截图。

问题反馈见 [README 的反馈一节](README.md#反馈)。安全漏洞不要开公开 issue，按 [SECURITY.md](SECURITY.md) 私下报告。
