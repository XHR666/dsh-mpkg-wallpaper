# Wallpaper Engine .mdl 格式分析笔记（Phase 1：结构侦察）

> 日期：2026-08-16
> 样本：7 个移动版木偶（红鸾樱落/夜莺）+ 3 个桌面版真值模型（camera/bars/pistols）
> 状态：**容器与网格布局已破解；骨骼/权重/动画曲线编码待 Phase 2（Ghidra）**

## 1. 容器结构

```
.mdl = 块序列（块标签 8 字节 + 版本）
```

| 块 | 含义 | 版本范围 | 说明 |
|---|---|---|---|
| `MDLV00xx` | 网格（Mesh） | 0004–0023 | 头部 + 顶点数据；必有 |
| `MDLS000x` | 骨架/权重（Skeleton） | 0002–0004 | 每部件 [next][count][骨骼/权重数据] |
| `MDLA000x` | 动画（Animation） | 0005–0006 | [next][count][动画ID][名称][loop][曲线数据] |
| `MDLE0002` | 新增块（最新版 Rella） | 0002 | 用途待定（可能表达式/效果） |

版本演化：桌面版老 → 移动版新：MDLV0004(bars) → 0014(pistols) → 0017(camera) → 0019(刀/挂饰/朱鹤/龙) → 0021(头) → 0023(Rella)。格式同构，只是字段增多。

## 2. 头部（MDLV 块）

```
magic[8] = "MDLV0019"
u16 ×2    = 0x0009 0x0080（版本子号/标志；各版本不同）
u32       = 0x0101（刀/挂饰）或 0x0100（camera）
u32       = 0x0100（疑为网格维度相关）
u8  0x00
char[]    = "materials/刀.json"（材质引用，UTF-8，含中文）
```

## 3. 网格（已破解）

- **顶点 = 8 × float32 = 32 字节**：位置(3) + UV(2) + 法线(3)（结构化评分在 bars/pistols/刀 三个样本上一致命中 stride=8）
- 顶点数：刀 565、挂饰1 355、挂饰2 353、朱鹤 2717、头 2847、龙 23049、Rella 450；桌面 bars 420、pistols 17816
- 网格区 = 顶点连续数组，无显式索引（疑为规则网格/四边形，三角形隐式）
- 桌面版模型侧车 `models/xxx.json` 只有导入选项（normals/tangentspace/seconduvchannel），不含网格数据

## 4. 骨架/权重（MDLS0002，已定位未破解）

```
tag "MDLS0002" \0
u32 next       = 下一块绝对偏移（如 0x4784）
u32 count      = 部件数（刀=1, 挂饰=3, 朱鹤=9, 龙=21 —— 与模型复杂度吻合）
数据           = 256, -256, 0x40FF, 0x80000000...（骨架/权重编码，待解）
```

## 5. 动画（MDLA0005/0006，结构已确认）

```
tag "MDLA0005" \0
u32 next       = 文件尾偏移
u32 count      = 1
u32 anim_id    = 673 ← 与 scene.json animationlayers[].animation 完全一致！
u32 0
char[]         = "动画 1" ← 与 scene.json animationlayers[].name 一致！
char[]         = "loop"（循环模式）
u32 112...
曲线数据        = 关键帧时间/值浮点序列（编码待解）
```

动画块大小：刀 32KB(565顶点)、挂饰 16KB、朱鹤 292KB、头 649KB、龙 681KB——随动画复杂度增长。

## 6. scene.json 关联链（全可读，已打通）

```
scene.json → objects[i]（含 animationlayers: animation ID + name）
  → models/头.json  → { material: "materials/头.json", puppet: "models/头_puppet.mdl" }
    → materials/头.json（材质）
    → 头_puppet.mdl（本格式）
```

## 7. 待办（Phase 2 计划）

1. **Ghidra 反汇编 wallpaper64.exe**（7z 里，含 MDLV0019/MDLA0005/MDLS0002/MDLVT001 全部标签的读写两端）→ 确认骨骼/权重/曲线字段语义
2. 差分：34 个样本（27 官方 + 7 移动）跨 6 个版本 → 字段表
3. 实现：.mdl 解析 → 静态网格渲染（3a）→ 骨骼蒙皮（3b）→ 动画（3c）

## 8. 文件清单

- 移动版：`<工作区根>/mpkg_work/mdl/*.mdl`（7 个）
- 桌面版真值：`<工作区根>/mpkg_work/winbin/wallpaper_engine/...`（camera/bars/pistols 已提取，其余在 7z 里共 27 个）
- 分析脚本：~~`tools/mdl_explorer.py`~~ —— **已删除（GPL 血缘存疑，2026-09-16 P-89；见 `../../docs/COPYING-RULES.md` §6）**。
  本文档只保留当时的格式观察结论；仓库外的旧副本 `<工作区根>/mpkg_work/mdl_explorer.py` 不随本仓库分发。

## 9. Phase 1.5 新增发现（2026-08-16 第二轮）

### 9.1 骨骼数据 = 内嵌 JSON（MDLS0003/0004 版本）
头(20个)/Rella(17个)/龙(20个) 的 MDLS 块内含可读 JSON 姿态：
```json
{"a":null,"lamax":null,"lamin":null,"rax":null,"ray":null,"raz":null,"s":null,"tm":100.0,"tp":"233.53432 0.00000 0.00000"}
```
- `tp` = 骨骼锚点位移（纹理空间坐标）
- `a` = 角度；`lamax/lamin` = 角度约束（官方文档 boneconstraints）
- `rax/ray/raz` = 旋转轴；`s` = 缩放；`tm:100.0` = 时间标记
- **新版本格式的骨骼骨架可直接 JSON 解析**

### 9.2 桌面解析器入口已定位（capstone 反汇编 wallpaper64.exe）
- `MDLV0019` 字符串 @ VA 0x140375A78
- 唯一 xref @ 0x1401E871F（LEA），所属魔法检查函数 @ 0x1401E885A
- 函数按 UTF-16 宽字符读入文件头并与 "MDLV0019" 比较（长度检查 `cmp ...,7`）
- 下一步：从该函数调用图追踪网格/骨骼/动画读取函数

### 9.3 视频纹理格式 id=34（重大）
customize 壁纸的 tex 内嵌完整 MP4（伊蕾娜 4K 60fps 24s 等，已提取 10 段到 壁纸素材/高清/视频/）
