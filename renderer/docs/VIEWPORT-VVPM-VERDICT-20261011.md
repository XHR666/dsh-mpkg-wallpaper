# VIEWPORT-VVPM-VERDICT —— `g_ViewportViewProjectionMatrices` 缺口中立判决

> **对象**：台账 §1.1 第 12 项的 ❌ 半（`ViewportViewProjectionMatrices`；✅ 半 = `g_TextureNMipMapInfo` /
> `g_TextureReductionScale` 已"声明即上传"，见 P-221 A6）。
> **日期**：2026-10-11 · **方法**：递归全量语料扫描 + 只读代码走查。**性质**：证据页，附翻案判据。

## 1. 语料实测（递归、全量）

```bash
$ python3  # glob('allwallpaper/**/*.mpkg', recursive=True) → 逐包全文搜索 'ViewportViewProjection'
```

| 指标 | 值 |
|---|---|
| `*.mpkg`（递归） | **154**（全部解析成功） |
| 命中 `ViewportViewProjection` 的条目 | **0** |

> 读法：当前语料里**没有任何档**（材质、着色器源码、场景 JSON、脚本）引用该 uniform。
> 该 uniform 属官方"多视口/子视口投影矩阵"族（效果链里给需要**跨视口投影**的 pass 用），
> 我们的语料 0 引用 ⇒ 未上传不会造成任何可见差异。

## 2. 代码路径（只读）

- 与它同族的另两项（`g_TextureNMipMapInfo` / `g_TextureReductionScale`）已实现"**声明即上传**"（P-221 A6），
  并带台账 `__mpwMip.mipChainMissing` ⇒ 说明"按声明上传 uniform"的通路**已经存在**；
- `g_ViewportViewProjectionMatrices` 目前既**没有被声明**（语料 0 命中）也**没有实现**（无上传点）。

## 3. 结论

**维持现状**：不实现 `g_ViewportViewProjectionMatrices` 上传。

理由：① **语料 0 命中**（递归全量 154 包）⇒ 无可见影响；② 其语义（视口矩阵数组的**数量/来源/更新时机**）
在没有样本的情况下无法验证 ⇒ 现在实现属"无证据改造"；③ 一旦出现真实档，可**复用已存在的"声明即上传"通路**
（P-221 A6）实现，成本低。

### 3.1 翻案判据（任一满足即重开）

| # | 触发条件 | 动作 |
|---|---|---|
| **A** | 语料/新档出现 `g_ViewportViewProjectionMatrices`（着色器 uniform 或 JSON 注解） | 按 P-221 A6 的"声明即上传"通路实现，并加读数台账 |
| **B** | 真机出现"某效果 pass 的投影错位/黑块"且该 pass 着色器引用该 uniform | 先补语义（矩阵数量、来源视口、更新时机）再实现 |
| **C** | 上游证据表明该 uniform 由引擎**无条件**提供（非按声明） | 改为常备上传（带 `?vvpm=legacy` 回退） |

## 4. 本页没有证明的东西

- 没有证明官方在**所有**效果链里都不用该 uniform——只证明**当前 154 包**的素材不引用它；
- 没有纳入 `scene.pkg`（PKGV）容器的内部素材（本次仅 PKGM；见 `MATERIAL-PASS-VERDICT.md` §3.3 同款边界说明）。
