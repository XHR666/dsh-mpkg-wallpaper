# 安全策略

[中文](SECURITY.md) | [English](SECURITY.en.md)

## 支持范围

安全修复以本仓库默认分支，以及 npm 上 `dsh-mpkg-wallpaper` 的当前版本为准。更早的版本不单独回溯，除非维护者在修复说明里另写。

## 怎样报告漏洞

请使用 GitHub 的私下漏洞报告：

<https://github.com/XHR666/dsh-mpkg-wallpaper/security/advisories/new>

不要在公开 issue、讨论或拉取请求里粘贴令牌、密钥、未公开的利用步骤，或带真实地址的诊断导出。公开 issue 只用于不含这些内容的普通缺陷：

<https://github.com/XHR666/dsh-mpkg-wallpaper/issues>

报告里请写：

1. 插件版本，以及 DSH 版本、浏览器引擎和版本。
2. 复现步骤。令牌和本机路径用占位符代替。
3. 实际结果和预期结果。
4. 你是否已经有人可以读到本机壁纸文件、设置或诊断内容。

维护者确认问题后，会在修复进入默认分支时说明影响和改法。这里不承诺固定回复时限。

## 哪些问题算在内

- 宿主路由的来源校验、目录读取和跨站请求。
- 壁纸地址、场景令牌、设置或诊断导出里泄露不该公开的数据。
- 网页壁纸 iframe 的来源校验和消息校验被绕过。
- 发布包或仓库里出现密钥、令牌或本机路径。

## 哪些问题不在这里处理

- DeepSeek Harness 本体的缺陷。请报到 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)。
- 其他 DSH 插件、Wallpaper Engine 官方客户端，以及用户主动把令牌交给不受信页面。

## 这个插件实际怎么处理数据

壁纸解析、转码和存储都在本机完成，不会自动上传。网页壁纸默认在沙箱 iframe 里运行。自定义目录拒绝路径穿越和敏感目录。诊断与错误日志只写在本机；导出时可以选脱敏或完整日志。完整行为见 [README 的安全与隐私](README.md#安全与隐私)。
