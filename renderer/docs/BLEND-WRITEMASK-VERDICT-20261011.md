# BLEND-WRITEMASK-VERDICT —— 链内 alpha 写掩码（D3D11 blend idx8–11 / idx12）中立判决

> **对象**：台账 §1.1 第 5 项（"链内 alpha 写掩码（D3D11 blend idx8–11 / idx12）"，依据 `docs/reverse/WE-FULL-REV.md` §5-P1-9）。
> **日期**：2026-10-11 · **方法**：只读引用逆向结论 + 递归全量语料扫描 + 只读代码走查。**性质**：证据页，附翻案判据。

## 1. 逆向依据（原文）

`docs/reverse/WE-FULL-REV.md:221`（§5 blend 状态表缺口）：

> 9. **blend 状态表缺口**：未实现 **idx8–11（RGBA 写掩码 0xF 变体）**、**idx12（仅写 alpha 0x8）**、
>    idx3（AlphaToCoverage）、idx4（强制复位路径 `[ctx+0x24]==0…`）。

读法：官方 D3D11 混合状态表里，idx8–11 是 **`RenderTargetWriteMask` 0xF 的若干变体**，idx12 是 **只写 alpha（0x8）**；
本仓没有为这些索引建对应的 `colorMask` 分支。

## 2. 语料实测（递归、全量）

```bash
$ python3  # glob('allwallpaper/**/*.mpkg', recursive=True) → 逐包解析 PKGM → materials/*.json / scene.json
```

| 指标 | 值 |
|---|---|
| `*.mpkg`（递归） | **154**（全部解析成功） |
| `materials/*.json` | **202** |
| 材质 pass `blending` 取值 | `translucent` 98 ／ `normal` 74 ／ `additive` 30（**全为字符串名**，无 idx 形态） |
| 层 `colorBlendMode` 分布 | 0×15、1×5、4×1、6×10、7×1、**11×34**、21/22/23/24×1~2、25×2、31×11 |
| **写掩码类键（`alphawriting`/`writemask`/`colormask`）** | 仅 **`alphawriting` 7 处，取值全为 `"default"`** |

## 3. 代码路径（只读走查）

- **`colorBlendMode` 已实现**（走专用 shader 程序，RE-18：A=绘制前的屏幕拷贝、B=本层、`u_Mode=colorBlendMode`）：
  `:11348` 程序、`:13614` 绑定、`:9852` `if (m == 11) …bOverlay…`、`:9909` `else if (u_BlendMode == 11) …`
  ⇒ **语料里出现最多的 11 = Overlay，已有实现**（34 处不会退化）。
- **写掩码的真正入口 = 材质 pass 的 `alphawriting`**：解析在 `:4031/4034`（`__alphawriting`），消费在 `:16060-16064`
  （映射到 `colorMask` 的 alpha 位：`enabled`/`default` 缺省全开、`disabled` 关 alpha 位），并在 `:16221` 立即恢复全开
  ⇒ `default`/`enabled`/`disabled` 三态**已落地**；语料 7 处全为 `default`（走缺省路径）。

## 4. 结论

**维持现状**：不为 blend 表 idx8–11 / idx12 新增 `colorMask` 分支。

理由：
1. **无触发样本**：递归全量语料里没有任何档以 idx 形态请求写掩码（材质 `blending` 全是字符串名；`alphawriting` 7 处全 `default`）；
2. **真正的入口已实现**：`alphawriting` 的 `default`/`enabled`/`disabled` 已映射到 `colorMask` 并在 pass 后恢复；
3. **无证据改造风险**：在"哪个字段能请求 idx8–11/12"未定时实现分支，等于猜语义（本会话已多次因"无证据改造"折返）。

### 4.1 翻案判据（任一满足即重开）

| # | 触发条件 | 动作 |
|---|---|---|
| **A** | 语料/新档出现 `alphawriting` 取值超出 `default|enabled|disabled`（或出现 `writemask`/`colormask` 键） | 按该取值补 `colorMask` 分支 + 回退口 + 判据 |
| **B** | 真机对照出现"**某层只该改 alpha 却改了颜色**（或反之）"且该层/材质命中写掩码路径 | 按 `WE-FULL-REV.md` 的 idx12=0x8 / idx8–11=0xF 语义实现 |
| **C** | 上游行为证据表明写掩码由 **blend 索引**（而非 `alphawriting`）选择 | 先补"索引→字段"映射，再实现 |

## 5. 本页没有证明的东西

- 没有证明"官方 blend 表 idx8–11/12 在语料里**永远不会**被用到"——只证明**当前 154 包不请求它们**；
- 没有证明 `alphawriting` 就是官方唯一的写掩码入口（只是当前语料里唯一出现的形态）。
