# ANIMATION-PERF —— 左栏收起动画卡顿：测量 → 修复 → 判据（P1A/P1B，2026-10-03）

> 症状：点击左栏收起按钮，动画只跳 3 下就到位。此前一次临时测量（未入仓）：插件生效时 rAF 峰值
> ≈650–684ms，中性化后 ≈267ms。本页把整条链（测量工具 → 读数 → 修复 → 判据 → 回退）钉住。

## 1. 测量（P1A，`tools/sidebar-anim-probe.mjs`）

- 真页 :3080，收起按钮（先 dump 候选再锁定，`--scan`）；点击后 1.5s 窗口采 rAF p50/p95/max、
  >50ms 空档、longtask；`MutationObserver` 构造器包装**按族**记批次耗时（构造栈帧定位归属）。
- 对照组 = 页内中性化（摘 `style[data-plugin]` + 插件常驻 DOM + 按 needle→组合 bundle 行号映射
  断开插件 8 个 observer；needle 映射 12/12 并自证组合响应逐字含 client.js）。
  现在也有官方开关 `?mpwperf=off`（见 §4）。
- **读数（两组 × 3 次，中位）**：插件开 **p95=66.5ms、max≈100ms、>50ms 空档 6 个**（p95 波动 0.5%）
  vs 中性化 **p95=32.6ms、max=34ms、空档 0**（off#2 一例 166ms 离群 ⇒ 组内不稳如实记）⇒ **2.04×**。
- **关键归因**：MO 回调自身仅 1–6ms ⇒ 卡顿主体不在回调执行，而在观察器**调度的后续全文档扫描 +
  强制布局**（sblur 的 `check()` 同步跑每批突变、popTag 的 `prun` / headerBlur 的 `hrun`
  `querySelectorAll` + `getBoundingClientRect`，旧实现只在拖拽属性位时跳过、收起动画不打这些属性位）。

## 2. 修复（P1B，`lib/client.js`）

- **共享闸门 `mpwHeavyGate(name, fn)`**：`document.getAnimations()` 有 running ⇒ 本轮重活跳过并登记；
  400ms 定时器统一**补跑一次**（不会漏收尾状态）。`getAnimations` 只读动画表、不触发布局，闸门本身廉价。
- **三个工人接闸门**：`sblur`（原写法每批突变**同步** `check()`，另改 rAF 帧内合并）、`popTag`、`hdrBlur`。
  动画期间（收起/展开过渡 ≈250ms）这三个全文档扫描为零；结束后补跑一次收尾状态。
- **回退口径**：闸门只影响"动画在跑"的窗口；`?mpwperf=off` 是整体对照档（§4）。没有行为开关翻转
  修复本身——按读数它是纯减负，不动判定逻辑（check/prun/hrun 的业务语义逐字保留）。

## 3. 判据（`tools/anim-guard-test.mjs`，挂 check.sh 第 3 步）

- A 组 静态：闸门定义 / 三工人调用点 / mpwperf=off 位置（幂等守卫之后）/ DIAGNOSTICS 登记。
- B 组 行为（桩世界 + `__mpwHeavyTest` 出口）：动画在跑 ⇒ gate 拦下、**重活零执行**（零
  getBoundingClientRect）、登记 + 定时器就位；动画停 ⇒ flushNow 与真实 400ms 定时器两条路都补跑、账目清空。
- C 组 行为：`?mpwperf=off` ⇒ applyInner 未执行（`__mpwGlobalWired/__mpwNowPlaying/__mpwStyleWatch` 全缺席）；
  默认 ⇒ 全部就位。
- D 组 变异自证：闸门改"恒放行"（mkdtemp 副本、真源零改动）⇒ B1 的"动画期间零重活"必红。
- **真机验收（P1B 验收线）**：修复后的 `sidebar-anim-probe` 两组对比里，插件开的 p95/max 与中性化组
  相差 ≤1.3×、>50ms 空档为 0（本轮修复后读数见 STATUS 22g 行）。

## 4. `?mpwperf=off`（测量对照档，登记 `docs/DIAGNOSTICS.md` §5）

任务书 P1A 要求的对照开关；当时 `lib/client.js` 冻结（3.15.5 归属约束）未实现，3.15.6 起就位：
`apply()` 幂等守卫之后直接 return —— 本次页面加载**完全不装** CSS / observer / 壁纸。

## 5. 未验证边界

- 本机无头 Firefox 不合成 backdrop-filter，收起动画的"观感顺滑"仍需真机人眼确认；
  探针读数（rAF 间隔/空档）是主线程节奏的客观量，不是像素证据。
- 闸门覆盖的是三个全文档扫描工人；插件其余 1s/2s/3s 级定时器（场景看门狗、hdrFrost 3s 守卫等）
  不在动画路径上，未动。
- `document.getAnimations()` 在宿主页面上还有**别的**动画（非侧栏）在跑时也会短暂跳过重活
  ——补跑定时器保证收尾；若宿主页面存在常驻动画（呼吸灯类），重活会持续顺延（每 400ms 补跑
  一次节奏不变），这是设计取舍而非缺陷，但记录在案。
