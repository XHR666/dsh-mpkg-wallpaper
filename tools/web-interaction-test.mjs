// tools/web-interaction-test.mjs — 网页壁纸**交互注入**回归（用户第 11 条）
//
// 覆盖（每条断言对应一个真实失败模式或安全边界，不是"跑一遍不报错"）：
//   A 坐标归一化：窗口 client 坐标 → iframe 内 client 像素（含滚动/祖先缩放/帧小于舞台/非有限值）
//   B 事件整形：pointer/wheel/key/touch 的消息形状 + 按下抬起边缘 + button:-1 哨兵语义 + 去重
//   C 注入开关：关闭时**一个消息都不发**；开启才发；超时/Esc/卸载都能关
//   D 沙箱边界：交互**不改 sandbox**（仍只要 allow-scripts，无 allow-same-origin/pointer-lock）
//   E 舞台 CSS/DOM 契约：默认不可见（不挡宿主）、交互期间只有舞台与退出按钮可点
//   F 源码同源：lib/web-interaction.js 的父页源码 与 client.js 内嵌的那段**逐字段对拍**
//
// ①(WP-2 2026-09-19) 新增（用户点名"点击特定区域触发动作" + 触屏）：
//   G **帧内端到端**（无浏览器、无网络：假 DOM 里装**真的**生产 shim + 真的帧内触摸代理，
//     消息由父页**真实现**产生 ⇒ 断言帧内收到了什么事件）：
//       G1 单击 ⇒ 帧内 click（坐标/按键/detail）      G2 双击 ⇒ click(detail=2)+dblclick
//       G3 右键/中键掩码原样（不伪造成左键）          G4 拖拽 ⇒ 不产生 click、且首帧 move 不产生 up
//       G5 触摸序列 ⇒ 帧内真 TouchEvent（changedTouches/touches/identifier）+ 点按等效 click
//       G6 多指 ⇒ touches.length=2 且 identifier 各自保留
//       G7 TouchEvent 三级构造阶梯（构造器 / createEvent+位置签名 / 仅字典签名 / 无 TouchEvent）
//       G8 隐式捕获：手指移出起始元素后 move/end 仍派发到起始元素（滑块类控件的生命线）
//       G9 祖先缩放 + DPR≠1 下坐标仍正确        G10 关闭交互 ⇒ 零注入（负面对照）
//       G11 触摸取消 ⇒ touchcancel 且不产生 click
//   H **变异自证**（把实现改坏到 /tmp 真文件副本上 ⇒ 对应断言必须变红；防"假绿"）
//   I 生产接线自检：`op:'touch'` 必须在**生产 shim** 里真的被路由（接线前 WARN，接线后硬断言）
//
// 运行：node tools/web-interaction-test.mjs   （全过输出"结果: N 通过, 0 失败"，退出码 0）
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  WEB_INTERACT_MSG, WEB_INTERACT_OPS, WEB_INTERACT_MODE, WEB_INTERACT_IDLE_MS, WEB_INTERACT_MAX_MS,
  WEB_INTERACT_STAGE_CSS, WEB_INTERACT_ATTR, WEB_INTERACT_STAGE_CLASS, WEB_INTERACT_BTN_CLASS,
  WEB_INTERACT_EXIT_CLASS, WEB_INTERACT_WRAP_CLASS, WEB_INTERACT_CLIENT_SOURCE,
  WEB_TOUCH_FRAME_SOURCE, WEB_TOUCH_AGENT_VERSION, WEB_TOUCH_PHASE_OF, WEB_TOUCH_TYPE_OF,
  WEB_BUTTON, WEB_TOUCH_LIMIT, buttonBitOf,
  clientPointInFrame, pointerMsg, touchMsg, wheelMsg, keyMsg, shouldPreventDefault, normalizeInteractMode,
  createInteractSession, modsOf,
} from '../lib/web-interaction.js'
import { WEB_SANDBOX_ATTR, WEB_SANDBOX_COMPAT_ATTR, SHIM_MSG, SHIM_CONTROL_OPS, WEB_SHIM_SOURCE } from '../lib/web-wallpaper.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0, fail = 0
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✓ ' + name) } else { fail++; console.error('  ✗ ' + name) } }
const eq = (a, b, name) => ok(a === b, name + (a === b ? '' : `（got=${JSON.stringify(a)} want=${JSON.stringify(b)}）`))
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

/* ══════════════════ A. 坐标归一化 ══════════════════ */
console.log('\n== A. 坐标归一化：窗口 client 坐标 → iframe 内 client 像素 ==')
{
  const rect = { left: 100, top: 50, width: 800, height: 600 }
  const size = { width: 800, height: 600 }
  const p = clientPointInFrame({ clientX: 300, clientY: 150 }, rect, size)
  ok(!!p && p.x === 200 && p.y === 100 && p.inside === true, 'A1 帧与窗口 1:1 对齐：clientX/frame.left 差值即帧内坐标')
  eq(p.sx, 1, 'A1 缩放系数 sx=1')

  // 宿主页面滚动过（视口坐标 vs 页面坐标）：clientX/clientY 是视口坐标，与 getBoundingClientRect 同空间
  const scrolled = clientPointInFrame({ clientX: 300, clientY: 150, pageX: 300, pageY: 2150 }, rect, size)
  ok(!!scrolled && scrolled.x === 200, 'A2 传入 pageX/pageY 时**只看 clientX/clientY**（混用会导致整体偏移一个滚动量）')

  // 祖先 CSS transform 缩放（上游同款：帧显示 400px 宽但内部视口 800px ⇒ 系数 0.5）
  const scaled = clientPointInFrame({ clientX: 300, clientY: 150 }, { left: 100, top: 50, width: 400, height: 300 }, size)
  ok(!!scaled && scaled.x === 400 && scaled.y === 200, 'A3 祖先缩放：x 除以 sx（400/800=0.5）后得到帧内真实像素')
  eq(scaled.sx, 0.5, 'A3 sx 上报正确（便于诊断）')

  // 帧比舞台大且左移（cover 式视口）：坐标仍按帧自身原点算
  const cover = clientPointInFrame({ clientX: 0, clientY: 0 }, { left: -50, top: 0, width: 900, height: 600 }, { width: 900, height: 600 })
  ok(!!cover && cover.x === 50 && cover.inside === true, 'A4 帧左移（-50px）时窗口原点落在帧内 50px 处')

  // 边界：帧外/越界
  const out = clientPointInFrame({ clientX: 2000, clientY: 900 }, rect, size)
  ok(!!out && out.inside === false, 'A5 帧外坐标仍返回（inside=false 由 shim 记录 hover 状态），但数值有效')

  // 非有限值/尺寸为 0 一律 null（否则 NaN 会污染作者状态且不报错）
  eq(clientPointInFrame({ clientX: NaN, clientY: 1 }, rect, size), null, 'A6 NaN 坐标 → null（必须丢弃）')
  eq(clientPointInFrame({ clientX: 'x', clientY: 1 }, rect, size), null, 'A6 非数值坐标 → null')
  eq(clientPointInFrame({ clientX: 1, clientY: 1 }, { left: 0, top: 0, width: 0, height: 0 }, size), null, 'A6 帧宽高为 0 → null')
  eq(clientPointInFrame({ clientX: 1, clientY: 1 }, rect, { width: 0, height: 0 }), null, 'A6 帧内视口为 0 → null（未布局完）')
  eq(clientPointInFrame(null, rect, size), null, 'A6 无事件 → null')
}

/* ══════════════════ B. 事件整形（协议形状 + 边缘语义） ══════════════════ */
console.log('\n== B. 事件整形：pointer / wheel / key 的消息形状与边缘语义 ==')
{
  const rect = { left: 10, top: 20, width: 800, height: 600 }
  const size = { width: 800, height: 600 }

  // 移动：buttons=0，带修饰键掩码（move 事件按**位置**去重）
  const mv = pointerMsg({ clientX: 110, clientY: 120, buttons: 0, ctrlKey: true }, rect, size, { lastX: 0, lastY: 0 })
  ok(!!mv && mv.op === WEB_INTERACT_OPS.POINTER && mv.mpw === undefined, 'B1 消息体（不含 mpw 标记，标记由发送方补）op=pointer')
  eq(mv.x, 100, 'B1 移动坐标 x=100')
  eq(mv.y, 100, 'B1 移动坐标 y=100')
  eq(mv.buttons, 0, 'B1 未按下时 buttons=0')
  eq(mv.mods, 1, 'B1 ctrl 位掩码 = bit0')
  eq(pointerMsg({ clientX: 110, clientY: 120 }, rect, size, { lastX: 100, lastY: 100 }), null,
    'B1 位置没变 → 不发（静止不等于在动：宿主按事件频率推送）')
  ok(pointerMsg({ clientX: 110, clientY: 120 }, rect, size, {}) !== null,
    'B1 位置未知（父页第一次推送）→ 照发，不因去重把首次移动吞掉')

  // 按下/抬起：**buttons 掩码边缘**（button 类事件按掩码去重）
  const dn = pointerMsg({ clientX: 110, clientY: 120 }, rect, size, { kind: 'button', down: true, prevButtons: 0 })
  eq(dn.buttons, 1, 'B2 按下 buttons=1（左键位）')
  const up = pointerMsg({ clientX: 110, clientY: 120 }, rect, size, { kind: 'button', down: false, prevButtons: 1 })
  eq(up.buttons, 0, 'B2 抬起 buttons 位被清掉（否则作者永远认为按着）')
  eq(pointerMsg({ clientX: 110, clientY: 120 }, rect, size, { kind: 'button', down: true, prevButtons: 1 }), null, 'B2 重复按下（掩码没变）→ 不发')
  eq(pointerMsg({ clientX: 110, clientY: 120 }, rect, size, { kind: 'button', down: false, prevButtons: 0 }), null, 'B2 重复抬起（掩码没变）→ 不发')
  ok(pointerMsg({ clientX: 110, clientY: 120 }, rect, size, { kind: 'button', down: true, prevButtons: 0, buttons: 2 }) !== null,
    'B2 掩码从 0 变 2 是**边缘** ⇒ 发（帧内旧 shim 忽略高位；不发会丢掉"右键按下过"这个事实）')

  // ①(WP-2) 多键 / 哨兵 / 触摸来源字段：DOM 口径（button 是序号，buttons 是位掩码）
  const rd = pointerMsg({ clientX: 110, clientY: 120, pointerType: 'mouse' }, rect, size, { kind: 'button', buttons: WEB_BUTTON.RIGHT, button: 2 })
  eq(rd.buttons, 2, 'B2+ 右键：buttons 位掩码 bit1 = 2')
  eq(rd.button, 2, 'B2+ 右键：button 序号 = 2（与 buttons 位掩码不是一回事）')
  eq(rd.phase, 'up', 'B2+ 不在左键位 ⇒ phase=up（帧内可据此区分左右键）')
  const md = pointerMsg({ clientX: 110, clientY: 120 }, rect, size, { kind: 'button', buttons: WEB_BUTTON.MIDDLE, button: 1 })
  eq(md.buttons, 4, 'B2+ 中键：buttons 位掩码 bit2 = 4')
  eq(pointerMsg({ clientX: 110, clientY: 120 }, rect, size, { kind: 'move' }).button, -1, 'B2+ 移动事件 button=-1（W3C 哨兵；填 0 会让作者认为左键一直按着）')
  ok(pointerMsg({ clientX: 110, clientY: 120 }, rect, size, { kind: 'move', buttons: 1 }).buttons === 1,
    'B2+ 移动事件**必须带当前掩码**：不带时帧内看到"1→0 跳变"⇒ 拖拽第一帧就派发 pointerup+click（历史 bug）')
  const tp = pointerMsg({ clientX: 110, clientY: 120, pointerType: 'touch', pointerId: 7, isPrimary: true, pressure: 0.42 }, rect, size, { kind: 'button', buttons: 1, button: 0 })
  ok(tp.pointerType === 'touch' && tp.pointerId === 7 && tp.isPrimary === true && tp.pressure === 0.42,
    'B2+ 触屏/笔的 pointerType/pointerId/isPrimary/pressure 原样下发（作者脚本按 pointerType 分流）')
  eq(pointerMsg({ clientX: 110, clientY: 120 }, rect, size, { kind: 'cancel' }).cancel, true, 'B2+ 取消消息带 cancel 标记')
  eq(buttonBitOf(0) | buttonBitOf(1) | buttonBitOf(2), 7, 'B2+ button 序号 → 掩码：0/1/2 分别落 1/4/2，三键合起来 7')

  // 修饰键掩码全集
  eq(modsOf({ ctrlKey: true, shiftKey: true, altKey: true, metaKey: true }), 15, 'B3 修饰键掩码 ctrl|shift|alt|meta = 15')
  eq(modsOf(null), 0, 'B3 无事件 → 0')

  // 滚轮：delta 原样（不按缩放换算）、零增量丢弃、坐标可缺省
  const wh = wheelMsg({ clientX: 110, clientY: 120, deltaX: 0, deltaY: 120, deltaMode: 0 }, rect, size)
  ok(!!wh && wh.op === WEB_INTERACT_OPS.WHEEL && wh.dy === 120 && wh.mode === 0, 'B4 滚轮 deltaY 原样透传（不做缩放换算）')
  eq(wh.x, 100, 'B4 滚轮带坐标')
  eq(wheelMsg({ clientX: 110, clientY: 120, deltaX: 0, deltaY: 0 }, rect, size), null, 'B4 零增量（惯性尾声）→ 不发')
  eq(wheelMsg({ deltaX: 1, deltaY: 2 }, rect, size).x, null, 'B4 无坐标的滚轮事件 → x=null（由 shim 用最后已知位置）')
  eq(wheelMsg({ clientX: 1, clientY: 1, deltaX: NaN, deltaY: 3 }, rect, size), null, 'B4 NaN 增量 → 丢弃（不是静默变 0）')
  eq(wheelMsg({ clientX: 1, clientY: 1, deltaX: 3, deltaY: 4, deltaMode: 7 }, rect, size).mode, 0, 'B4 非法 deltaMode → 归 0（像素）')

  // 键盘：文本只在 keydown 且无 ctrl/meta/alt 时给；方向键不带 text
  const kd = keyMsg({ key: 'a', code: 'KeyA', keyCode: 65 }, true)
  ok(!!kd && kd.op === WEB_INTERACT_OPS.KEY && kd.down === true && kd.text === 'a' && kd.keyCode === 65, 'B5 keydown 字母键 → text=a + keyCode')
  eq(keyMsg({ key: 'a' }, false).text, '', 'B5 keyup 不带 text（不会重复输入字符）')
  eq(keyMsg({ key: 'a', ctrlKey: true }, true).text, '', 'B5 Ctrl+A 不带 text（快捷键不是文本输入）')
  eq(keyMsg({ key: 'ArrowLeft' }, true).text, '', 'B5 方向键不带 text')
  eq(keyMsg({ key: 'Enter', repeat: true }, true).repeat, true, 'B5 repeat 透传（作者可区分长按）')
  eq(keyMsg({}, true), null, 'B5 无 key 的事件 → null')
  eq(keyMsg({ key: 'x'.repeat(100) }, true).key.length, 32, 'B5 超长 key 被截断（协议有界）')

  // 键盘默认行为白名单：必须拦的只有"会离开宿主页面"的那类
  ok(shouldPreventDefault({ key: 'r', ctrlKey: true }) === true, 'B6 Ctrl+R 必须拦（否则刷新掉用户会话）')
  ok(shouldPreventDefault({ key: 'w', metaKey: true }) === true, 'B6 Cmd+W 必须拦（关标签页）')
  ok(shouldPreventDefault({ key: 'F5' }) === true, 'B6 F5 必须拦')
  ok(shouldPreventDefault({ key: 'Tab' }) === true, 'B6 Tab 拦（焦点跑出交互舞台后键盘注入会静默失效）')
  ok(shouldPreventDefault({ key: 'Backspace' }) === true, 'B6 Backspace 拦（浏览器返回上一页）')
  ok(shouldPreventDefault({ key: 'ArrowLeft' }) === false, 'B6 方向键**不拦**（作者消费了就没事；没消费时仍能滚宿主）')
  ok(shouldPreventDefault({ key: ' ' }) === false, 'B6 空格不拦')
  ok(shouldPreventDefault({ key: 'a', ctrlKey: true }) === false, 'B6 Ctrl+A 不拦（留在页面内的选择/复制类快捷键不越权）')
  ok(shouldPreventDefault(null) === false, 'B6 无事件 → 不拦')

  // ①(WP-2) 触摸事件整形（`touchMsg`）：协议形状、两个列表语义、多指、坏坐标、上限
  const tRect = { left: 10, top: 20, width: 800, height: 600 }
  const tSize = { width: 800, height: 600 }
  const mkTouch = (id, cx, cy, extra) => Object.assign({ identifier: id, clientX: cx, clientY: cy }, extra || {})
  const t1 = touchMsg({ type: 'touchstart', touches: [mkTouch(3, 110, 120, { radiusX: 4, radiusY: 5, force: 0.6 })], changedTouches: [mkTouch(3, 110, 120, { radiusX: 4, radiusY: 5, force: 0.6 })] }, tRect, tSize)
  ok(!!t1 && t1.op === WEB_INTERACT_OPS.TOUCH && t1.phase === 'start', 'B7 触摸消息 op=touch / phase=start')
  eq(t1.x, 100, 'B7 主触点坐标换算（与指针同一口径：clientX - frame.left）')
  eq(t1.y, 100, 'B7 主触点坐标换算 y')
  eq(t1.touches.length, 1, 'B7 touches = 屏上全部触点')
  eq(t1.changed.length, 1, 'B7 changed = 本条消息涉及的触点')
  eq(t1.changed[0].id, 3, 'B7 identifier 原样带上（多指必需）')
  eq(t1.changed[0].rx, 4, 'B7 radiusX 透传（力/面积类作者脚本用）')
  eq(t1.changed[0].force, 0.6, 'B7 force 透传')
  eq(t1.buttons, 1, 'B7 有手指在屏上 ⇒ buttons 位=左（DOM 对触摸的口径）')
  eq(t1.count, 1, 'B7 count = 屏上触点数')
  const tEnd = touchMsg({ type: 'touchend', touches: [], changedTouches: [mkTouch(3, 110, 120)] }, tRect, tSize)
  ok(!!tEnd && tEnd.phase === 'end' && tEnd.touches.length === 0 && tEnd.changed.length === 1,
    'B7 touchend：touches 空但 changed 有值（这是判断"哪根手指抬起了"的唯一依据）')
  eq(tEnd.buttons, 0, 'B7 手指全部离开 ⇒ buttons=0')
  eq(tEnd.changed[0].inside, true, 'B7 inside 标记（帧内据此决定是否派发到命中元素）')
  const tMulti = touchMsg({ type: 'touchstart', touches: [mkTouch(1, 110, 120), mkTouch(2, 210, 220)], changedTouches: [mkTouch(2, 210, 220)] }, tRect, tSize)
  eq(tMulti.touches.length, 2, 'B7 多指：touches 两条都在')
  eq(tMulti.changed.length, 1, 'B7 多指：changed 只含本次新增的那根')
  eq(tMulti.x, 200, 'B7 多指：主触点取 changed 的第一根（不是 touches 的第一根）')
  const tBad = touchMsg({ type: 'touchmove', touches: [mkTouch(1, NaN, 120), mkTouch(2, 210, 220)], changedTouches: [mkTouch(1, NaN, 120)] }, tRect, tSize)
  ok(!!tBad && tBad.touches.length === 1 && tBad.changed.length === 0, 'B7 坐标坏掉的触点被丢掉（NaN 不进作者状态机），其余触点照常')
  eq(touchMsg({ type: 'touchmove', touches: [], changedTouches: [] }, tRect, tSize), null, 'B7 空消息 → 不发（否则作者"在动"判定恒真）')
  eq(touchMsg({ type: 'touchend', touches: [], changedTouches: [] }, tRect, tSize).phase, 'end',
    'B7 touchend 无触点信息也发（帧内据此收尾，不能把"手指抬起"这个边缘丢掉）')
  eq(touchMsg({ type: 'pointerdown' }, tRect, tSize, { phase: '瞎写' }), null, 'B7 非法 phase → null（协议有界）')
  eq(touchMsg(null, tRect, tSize), null, 'B7 无事件 → null')
  eq(touchMsg({ type: 'touchstart', touches: [mkTouch(1, 110, 120), mkTouch(2, 111, 120), mkTouch(3, 112, 120), mkTouch(4, 113, 120), mkTouch(5, 114, 120), mkTouch(6, 115, 120)], changedTouches: [] }, tRect, tSize).touches.length,
    WEB_TOUCH_LIMIT, 'B7 触点列表有上限（一条消息不能无限大）')
  ok(Object.keys(WEB_TOUCH_TYPE_OF).every((p) => WEB_TOUCH_PHASE_OF[WEB_TOUCH_TYPE_OF[p]] === p),
    'B7 phase ↔ DOM 事件类型两个映射互为逆（协议与帧内不会漂移）')
}

/* ══════════════════ C. 注入开关（会话状态机） ══════════════════ */
console.log('\n== C. 注入开关：关闭不发 / 超时自动关 / Esc 关 / 卸载关 ==')
{
  let t = 1000
  const s = createInteractSession({ now: () => t, idleMs: 1000, maxMs: 5000 })
  eq(s.isOn(), false, 'C1 初始关闭（默认不动任何事件）')
  eq(s.mode(), WEB_INTERACT_MODE.OFF, 'C1 关闭时 mode=off')
  ok(s.arm('pointer') === true && s.isOn() === true, 'C1 arm 打开')
  ok(s.arm('pointer') === false, 'C1 重复 arm 幂等（返回 false = 无状态变化）')
  eq(s.mode(), WEB_INTERACT_MODE.POINTER, 'C1 pointer 档')
  t += 900; ok(s.tick() === false, 'C2 未到 idle 不关')
  t += 200; ok(s.tick() === true && s.isOn() === false, 'C2 超过 idle（60s 语义，这里按参数 1s）自动关闭')
  ok(s.disarm() === false, 'C2 已经关了再 disarm 幂等')

  s.arm('full'); t += 500; s.touch(); t += 900
  ok(s.tick() === false, 'C3 有真实注入（touch）时续期：idle 从最后一次活动算')
  t += 300; ok(s.tick() === true, 'C3 再次超时关闭')

  // maxAge：一直在动也必须到点关（不允许无限期占着宿主输入面）
  s.arm('full')
  for (let i = 0; i < 10; i++) { t += 500; s.touch(); s.tick() }   // 步长 < idle(1000)，但累计 > maxAge(5000)
  ok(s.isOn() === false, 'C4 即使持续活动，超过 maxAge 也强制关闭（防永久劫持）')
  ok(WEB_INTERACT_MAX_MS >= WEB_INTERACT_IDLE_MS, 'C4 maxAge ≥ idle（两档超时语义自洽）')

  const snap = createInteractSession({ now: () => 0 }).snapshot()
  ok(snap && snap.on === false && snap.idleMs === WEB_INTERACT_IDLE_MS, 'C5 诊断快照含 on/mode/remainMs/idleMs')

  eq(normalizeInteractMode('off'), 'off', 'C6 设置项 off 关')
  eq(normalizeInteractMode('full'), 'full', 'C6 设置项 full = 含键盘')
  eq(normalizeInteractMode(undefined), 'pointer', 'C6 缺省 pointer（点/滚可用，不注入键盘）')
  eq(normalizeInteractMode('乱写'), 'pointer', 'C6 非法值回落 pointer（不是 off，也不是 full）')
}

/* ══════════════════ D. 沙箱边界（交互不得放宽 sandbox） ══════════════════ */
console.log('\n== D. 沙箱边界：交互不改 sandbox 属性 ==')
{
  const c = read('lib/client.js')
  eq(WEB_SANDBOX_ATTR, 'allow-scripts', 'D1 交互模式的帧沙箱仍只有 allow-scripts（不透明源）')
  ok(!/allow-same-origin/.test(WEB_SANDBOX_ATTR), 'D1 不含 allow-same-origin（沙箱可摘自身的经典风险）')
  ok(!/allow-pointer-lock/.test(WEB_SANDBOX_ATTR), 'D1 不含 allow-pointer-lock（合成事件不需要指针锁）')
  ok(SHIM_CONTROL_OPS.indexOf('pointer') >= 0 && SHIM_CONTROL_OPS.indexOf('wheel') >= 0
    && SHIM_CONTROL_OPS.indexOf('key') >= 0 && SHIM_CONTROL_OPS.indexOf('blur') >= 0
    && SHIM_CONTROL_OPS.indexOf('interact') >= 0, 'D2 交互 op 在控制白名单内（帧内 handle 才认）')
  eq(SHIM_MSG, WEB_INTERACT_MSG, 'D2 两侧协议标记一致（mpw:web）')
  // 舞台/事件接线不得顺手加沙箱属性
  // 块边界用**函数名**定位（不用"到下一个函数为止"的区间切法：`showWebEl` 里本来就有
  // sandbox=strict 与 contentDocument 的既有代码，按区间切会把无关代码算进来）。
  const ixStart = c.indexOf('function mpwWebIxMode()')
  const ixEnd = c.indexOf('function mpwWebIxState', ixStart)
  ok(ixStart > 0 && ixEnd > ixStart, 'D3 定位到交互实现块（两条函数边界都在）')
  // 内嵌源码那段模板字符串里的 allow-same-origin 是**注释文字**（说明为什么不给该权限）⇒ 先剥模板串
  const ixBlock = c.slice(ixStart, ixEnd).replace(/`[\s\S]*?`/g, ' ')
  ok(ixBlock.length > 1500, 'D3 交互实现块非空（' + ixBlock.length + ' 字节；防下面的断言落空）')
  ok(!/setAttribute\(\s*["']sandbox["']/.test(ixBlock), 'D3 交互实现块**没有**改 sandbox 属性（只推消息）')
  ok(!/allow-same-origin/.test(ixBlock), 'D3 交互实现块不出现 allow-same-origin')
  ok(!/contentDocument|contentWindow\.document/.test(ixBlock), 'D3 交互实现块不读帧内 DOM（不透明源下也读不到；读了就是设计泄漏）')
  // 帧内 shim：只认父窗口消息 + 事件只由父页推来的消息触发
  const shim = read('lib/web-wallpaper.js')
  ok(/ev\.source !== parentWin/.test(shim), 'D4 帧内 shim 只接受父窗口来源的消息（任意页面不能控制壁纸）')
  ok(/ptrPushPointer|ptrPushWheel|ptrPushKey/.test(shim), 'D4 帧内合成事件的入口只由控制消息驱动')
}

/* ══════════════════ E. 舞台 CSS/DOM 契约 ══════════════════ */
console.log('\n== E. 舞台契约：默认不挡宿主；交互期间只有舞台与退出按钮可点 ==')
{
  const css = WEB_INTERACT_STAGE_CSS
  ok(css.indexOf('.' + WEB_INTERACT_STAGE_CLASS) >= 0, 'E1 舞台类名出现在 CSS 契约里')
  ok(/\.mpw-webInteract\{[^}]*display:none/.test(css), 'E1 舞台默认 display:none（未进入交互模式时不可见）')
  ok(/\.mpw-webInteract\{[^}]*pointer-events:auto/.test(css), 'E1 舞台自身 pointer-events:auto（壁纸层是 pointer-events:none 的背景层）')
  ok(/mpw-webInteract-on .mpw-webInteract\{display:block/.test(css), 'E2 只有 wrap 带 mpw-webInteract-on 时才显示')
  eq(WEB_INTERACT_WRAP_CLASS, 'mpw-webInteract-on', 'E2 开启类名 = mpw-webInteract-on')
  eq(WEB_INTERACT_ATTR, 'data-mpw-interact', 'E3 宿主界面让位标记 = data-mpw-interact')
  ok(css.indexOf('html[data-mpw-interact="on"] body{pointer-events:none') >= 0, 'E3 交互期间宿主界面整体让位（防"顺手点到壁纸底下的按钮"）')
  ok(css.indexOf('html[data-mpw-interact="on"] .mpw-webInteract{pointer-events:auto') >= 0, 'E3 让位规则里显式把舞台排除（否则舞台也不可点）')
  ok(css.indexOf('.' + WEB_INTERACT_EXIT_CLASS) >= 0 && /mpw-webInteractExit\{[^}]*display:block/.test(css), 'E4 退出按钮在交互期间显示')
  ok(/mpw-webInteractBtn\{[^}]*display:none/.test(css) && /\.mpw-bgWrap\.mpw-web \.mpw-webInteractBtn\{display:block/.test(css), 'E4 入口按钮只在 web 壁纸时出现')
  const c = read('lib/client.js')
  for (const cls of [WEB_INTERACT_STAGE_CLASS, WEB_INTERACT_BTN_CLASS, WEB_INTERACT_EXIT_CLASS, WEB_INTERACT_WRAP_CLASS]) {
    ok(c.indexOf(cls) >= 0, 'E5 client.js 使用契约类名 ' + cls)
  }
  ok(/setAttribute\("data-mpw-interact", "on"\)/.test(c) && /removeAttribute\("data-mpw-interact"\)/.test(c), 'E5 client.js 只在开/关时增删宿主让位标记')
  ok(/classList\.toggle\("mpw-webInteract-on", on\)/.test(c), 'E5 wrap 上的开启类由状态机驱动（不是写死）')
}

/* ══════════════════ F. 源码同源：lib 模块 ↔ client.js 内嵌段 逐字段对拍 ══════════════════ */
console.log('\n== F. 源码同源：父页舞台逻辑（lib/web-interaction.js）与 client.js 内嵌段对拍 ==')
{
  // 提取 client.js 里的内嵌源码（模板字符串），在 vm 里跑真实现
  const c = read('lib/client.js')
  const m = /const MPW_WEB_INTERACT_SOURCE = `([\s\S]*?)`;\n/.exec(c)
  ok(!!m, 'F1 从 client.js 提取到内嵌舞台源码')
  const embedded = m ? m[1] : ''
  const evSeq = [
    { kind: 'move', ev: { clientX: 110, clientY: 120, buttons: 0 } },
    { kind: 'move', ev: { clientX: 140, clientY: 130, buttons: 0, ctrlKey: true } },
    { kind: 'move', ev: { clientX: NaN, clientY: 130, buttons: 0 } },   // 非有限值 → 必须丢弃
    { kind: 'down', ev: { clientX: 140, clientY: 130, buttons: 1, button: 0, pointerType: 'mouse' } },
    { kind: 'move', ev: { clientX: 150, clientY: 130, buttons: 1 } },   // 拖拽中的移动：必须带掩码 1
    { kind: 'up', ev: { clientX: 150, clientY: 130, buttons: 0, button: 0 } },
    { kind: 'wheel', ev: { clientX: 150, clientY: 130, deltaY: 120, deltaMode: 0 } },
    { kind: 'wheel', ev: { clientX: 150, clientY: 130, deltaY: 0, deltaX: 0 } },   // 空事件 → 丢弃
    { kind: 'key', down: true, ev: { key: 'a', code: 'KeyA', keyCode: 65 } },      // pointer 档 → 不发
    // ①(WP-2) 触摸序列：与客户端接线同一条路径（touchstart→touchmove→touchend）
    { kind: 'touch', phase: 'start', ev: { type: 'touchstart', touches: [{ identifier: 1, clientX: 110, clientY: 120 }], changedTouches: [{ identifier: 1, clientX: 110, clientY: 120 }] } },
    { kind: 'touch', phase: 'move', ev: { type: 'touchmove', touches: [{ identifier: 1, clientX: 110, clientY: 120 }], changedTouches: [{ identifier: 1, clientX: 110, clientY: 120 }] } },  // 坐标没变 → 必须不发
    { kind: 'touch', phase: 'move', ev: { type: 'touchmove', touches: [{ identifier: 1, clientX: 116, clientY: 124 }], changedTouches: [{ identifier: 1, clientX: 116, clientY: 124 }] } },
    { kind: 'touch', phase: 'end', ev: { type: 'touchend', touches: [], changedTouches: [{ identifier: 1, clientX: 116, clientY: 124 }] } },
  ]
  const run = (source) => {
    const sandbox = { setInterval: () => 1, clearInterval: () => {}, Date, Math, Number, String, isFinite, console }
    sandbox.window = sandbox
    vm.createContext(sandbox)
    // 源码是 IIFE 表达式：求值一次即挂 window.__mpwInteraction（与 client.js 的 new Function 同路径）
    const factory = vm.runInContext('(' + source + ')', sandbox, { filename: 'ix.js' })
    const api = factory(sandbox)
    const out = []
    api.arm('pointer')
    const rect = { left: 10, top: 20, width: 800, height: 600 }
    for (const s of evSeq) {
      if (s.kind === 'move') out.push(api.pointer(s.ev, rect, 800, 600, false, { kind: 'move', buttons: s.ev.buttons, button: -1 }))
      else if (s.kind === 'down') out.push(api.pointer(s.ev, rect, 800, 600, true, { kind: 'button', buttons: 1, button: 0, pointerType: s.ev.pointerType }))
      else if (s.kind === 'up') out.push(api.pointer(s.ev, rect, 800, 600, false, { kind: 'button', buttons: 0, button: 0 }))
      else if (s.kind === 'wheel') out.push(api.wheel(s.ev, rect, 800, 600))
      else if (s.kind === 'key') out.push(api.key(s.ev, !!s.down))
      else if (s.kind === 'touch') out.push(api.touchEvent(s.ev, rect, 800, 600, s.phase))
    }
    // full 档再跑一遍键盘（含拦截判定）
    api.arm('full')
    out.push(api.key({ key: 'a', code: 'KeyA', keyCode: 65 }, true))
    out.push(api.key({ key: 'ArrowLeft' }, true))
    out.push(api.preventDefault({ key: 'r', ctrlKey: true }))
    out.push(api.preventDefault({ key: 'ArrowLeft' }))
    out.push(api.snapshot())
    api.disarm()
    out.push(api.snapshot())
    return { api: api, out: out }
  }
  const a = run(WEB_INTERACT_CLIENT_SOURCE)
  const b = run(embedded)
  eq(a.out.length, b.out.length, 'F2 两实现的输出条数一致')
  const norm = (x) => JSON.stringify(x).replace(/"remainMs":\d+/, '"remainMs":<clock>')
  for (let i = 0; i < Math.min(a.out.length, b.out.length); i++) {
    eq(norm(a.out[i]), norm(b.out[i]), 'F2 第 ' + (i + 1) + ' 条消息逐字段相同')
  }
  // 内嵌段必须是完整源码（含两档模式与看护器），否则上面"跑通"没有意义
  ok(/win\.__mpwInteraction/.test(embedded) && /function make\(\)/.test(embedded), 'F3 内嵌段是完整 IIFE（含 make/挂载点）')
  ok(embedded.indexOf('allow-same-origin') < 0, 'F3 内嵌段不含 allow-same-origin')
  // ①(WP-2) 更强的一条：**逐字节相同**（模块改了而 client.js 忘了同步 ⇒ 直接红，不依赖"跑一遍碰巧一样"）
  eq(embedded.replace(/^\n/, '').replace(/\n$/, ''), WEB_INTERACT_CLIENT_SOURCE,
    'F4 client.js 内嵌段与 lib/web-interaction.js 的生成源码**逐字节相同**')
  // 触摸与指针消息必须真的出现在这段序列里（否则上面的对拍可能是"两边都空"）
  ok(a.out.some((m) => m && m.op === 'touch' && m.phase === 'start') && a.out.some((m) => m && m.op === 'touch' && m.phase === 'end'),
    'F4 序列里确实产出了 touch[start] 与 touch[end]（对拍不是空对空）')
  ok(a.out.some((m) => m && m.op === 'pointer' && m.buttons === 1 && m.phase === 'move'), 'F4 拖拽移动带掩码 1（拖拽不被当成"松开"）')
  ok(a.out.filter((m) => m && m.op === 'touch').length === 3, 'F4 四个触摸输入 → 3 条消息（坐标没变的 touchmove 被去重）')
}

/* ══════════════════ 帧内假 DOM（G/H/I 共用；无浏览器、无 jsdom、无网络） ══════════════════ */
// 所有"落盘的副本"都只进系统临时目录（仓库与工作树一字不改）。
const TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-wp2-frames-'))
// 建模的每一条都是为了"让断言有分辨力"，不是随手糊一个对象：
//   · 捕获/目标/冒泡三段 + 非冒泡事件（pointerleave/mouseleave 这类靠它才能验到"发给了谁"）；
//   · Chromium 的 `new MouseEvent("x",{button:-1}).button === 0` 规范化（上游 web-shim.js 注释里实测过，
//     shim 为此专门在构造后把 -1 盖回去）——假 DOM 不建模这一步，"button:-1 哨兵"断言就是空的；
//   · `new TouchEvent()` 在 Chromium 是 `Illegal constructor`、且 `initTouchEvent` 的签名各引擎不同
//     ⇒ 用 ladder 参数分别建模四种环境，把帧内代理的三级阶梯**每一级都跑到**。
function makeFrameDom(opts = {}) {
  const ladder = opts.ladder || 'dict'      // ctor | legacy | dict | none
  const dpr = Number(opts.dpr) || 1
  // 可控时钟：shim 的双击判定用 `Date.now()`，夹具要能"把两次点击隔开 40ms / 900ms"
  // ——否则两次点击落在同一毫秒里，`PTR_DBLCLICK_MS = 0` 这类变异照样能过（假绿）。
  const clock = opts.clock || { t: 1700000000000 }
  const RealDate = Date
  class FakeDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [clock.t])) }
    static now() { return clock.t }
  }
  const layers = []                          // { el, left, top, right, bottom }；后加的在上面
  const events = []                          // 帧内收到的所有事件（断言用）
  class Ev {
    constructor(type, init = {}) {
      this.type = String(type)
      this.bubbles = !!init.bubbles
      this.cancelable = !!init.cancelable
      this.composed = !!init.composed
      this.detail = init.detail || 0
      this.defaultPrevented = false
      this._stop = false
      this._stopImmediate = false
      this.target = null
      this.currentTarget = null
      for (const k of Object.keys(init)) {
        if (k === 'button') continue
        try { this[k] = init[k] } catch { /* 只读字段忽略 */ }
      }
    }
    preventDefault() { this.defaultPrevented = true }
    stopPropagation() { this._stop = true }
    stopImmediatePropagation() { this._stop = true; this._stopImmediate = true }
    composedPath() { return this._path || [] }
  }
  class ME extends Ev {
    constructor(type, init = {}) {
      super(type, init)
      this.clientX = Number(init.clientX) || 0
      this.clientY = Number(init.clientY) || 0
      this.screenX = Number(init.screenX) || 0
      this.screenY = Number(init.screenY) || 0
      this.movementX = Number(init.movementX) || 0
      this.movementY = Number(init.movementY) || 0
      this.ctrlKey = !!init.ctrlKey; this.shiftKey = !!init.shiftKey
      this.altKey = !!init.altKey; this.metaKey = !!init.metaKey
      this.buttons = init.buttons === undefined ? 0 : Number(init.buttons)
      this.relatedTarget = init.relatedTarget === undefined ? null : init.relatedTarget
      const b = init.button === undefined ? 0 : Number(init.button)
      this.button = b === -1 ? 0 : b          // Chromium 对 -1 的规范化（-2 原样通过）
    }
  }
  class PE extends ME {
    constructor(type, init = {}) {
      super(type, init)
      this.pointerId = init.pointerId === undefined ? 1 : init.pointerId
      this.pointerType = init.pointerType === undefined ? 'mouse' : init.pointerType
      this.isPrimary = init.isPrimary === undefined ? true : !!init.isPrimary
      this.width = init.width === undefined ? 1 : init.width
      this.height = init.height === undefined ? 1 : init.height
      this.pressure = init.pressure === undefined ? 0 : init.pressure
      this.tiltX = 0; this.tiltY = 0; this.twist = 0
    }
  }
  class Touch {
    constructor(init = {}) {
      this.identifier = init.identifier === undefined ? 0 : init.identifier
      this.target = init.target || null
      this.clientX = Number(init.clientX) || 0
      this.clientY = Number(init.clientY) || 0
      this.screenX = Number(init.screenX) || 0
      this.screenY = Number(init.screenY) || 0
      this.pageX = Number(init.pageX) || this.clientX
      this.pageY = Number(init.pageY) || this.clientY
      this.radiusX = init.radiusX === undefined ? 1 : init.radiusX
      this.radiusY = init.radiusY === undefined ? 1 : init.radiusY
      this.rotationAngle = 0
      this.force = init.force === undefined ? 0.5 : init.force
    }
  }
  const listOf = (arr) => {
    const out = Array.isArray(arr) ? arr.slice() : []
    out.item = function (i) { return this[i] === undefined ? null : this[i] }
    return out
  }
  class TE extends Ev {
    constructor(type, init = {}) {
      if (ladder !== 'ctor') throw new TypeError('Illegal constructor')
      super(type, init)
      this.touches = listOf(init.touches)
      this.targetTouches = listOf(init.targetTouches || init.touches)
      this.changedTouches = listOf(init.changedTouches)
      this.view = init.view || null
      this.ctrlKey = !!init.ctrlKey; this.shiftKey = !!init.shiftKey
      this.altKey = !!init.altKey; this.metaKey = !!init.metaKey
      this.scale = 1; this.rotation = 0
    }
  }
  if (ladder === 'legacy' || ladder === 'dict') {
    TE.prototype.initTouchEvent = function (...args) {
      const positional = typeof args[0] === 'string'
      if (positional && ladder === 'dict') throw new TypeError('initTouchEvent: 只支持字典签名')
      if (!positional) {
        if (ladder === 'legacy') throw new TypeError('initTouchEvent: 只支持位置签名')
        const init = args[0] || {}
        this.touches = listOf(init.touches); this.targetTouches = listOf(init.targetTouches || init.touches)
        this.changedTouches = listOf(init.changedTouches)      // 注意：字典签名**不带 type**
        return
      }
      const [type, bubbles, cancelable, view, , sx, sy, cx, cy, ctrl, alt, shift, meta, touches, targetTouches, changed] = args
      this.type = String(type)
      this.bubbles = !!bubbles; this.cancelable = !!cancelable; this.view = view || null
      this.screenX = sx; this.screenY = sy; this.clientX = cx; this.clientY = cy
      this.ctrlKey = !!ctrl; this.altKey = !!alt; this.shiftKey = !!shift; this.metaKey = !!meta
      this.touches = listOf(touches); this.targetTouches = listOf(targetTouches); this.changedTouches = listOf(changed)
      return this
    }
  }
  function mkListeners() { return new Map() }
  let rootDoc = null
  class Node {
    constructor(tag) {
      this.tagName = String(tag || '').toUpperCase()
      this.nodeName = this.tagName
      this.parentNode = null
      this.childNodes = []
      this.style = {}
      this._ls = mkListeners()
      const cls = new Set()
      this.classList = {
        add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c),
        toggle: (c, on) => { if (on === undefined) { cls.has(c) ? cls.delete(c) : cls.add(c) } else if (on) cls.add(c); else cls.delete(c) },
      }
    }
    addEventListener(type, fn, opt) {
      const cap = !!(opt === true || (opt && opt.capture))
      if (!this._ls.has(type)) this._ls.set(type, [])
      this._ls.get(type).push({ fn, capture: cap, once: !!(opt && opt.once) })
    }
    removeEventListener(type, fn, opt) {
      const arr = this._ls.get(type); if (!arr) return
      const cap = !!(opt === true || (opt && opt.capture))
      const i = arr.findIndex((l) => l.fn === fn && l.capture === cap)
      if (i >= 0) arr.splice(i, 1)
    }
    appendChild(c) { c.parentNode = this; this.childNodes.push(c); return c }
    setAttribute(k, v) { this['attr_' + k] = String(v) }
    getAttribute(k) { return this['attr_' + k] === undefined ? null : this['attr_' + k] }
    getBoundingClientRect() { return { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 } }
    dispatchEvent(ev) {
      const p = []
      let n = this
      while (n) { p.push(n); n = n.parentNode }
      if (rootDoc && !p.includes(rootDoc)) p.push(rootDoc)
      const w = rootDoc && rootDoc.defaultView
      if (w && !p.includes(w)) p.push(w)
      ev._path = p.slice()
      const fire = (node, phase) => {
        const arr = node._ls && node._ls.get(ev.type)
        if (!arr) return
        for (const l of arr.slice()) {
          if (ev._stopImmediate) return
          if (phase === 1 && !l.capture) continue
          if (phase === 3 && l.capture) continue
          ev.currentTarget = node
          ev.target = this
          if (l.once) node.removeEventListener(ev.type, l.fn, { capture: l.capture })
          try { if (typeof l.fn === 'function') l.fn.call(node, ev); else if (l.fn && l.fn.handleEvent) l.fn.handleEvent(ev) } catch { /* 作者 listener 抛错不打断派发链（与浏览器一致） */ }
        }
      }
      for (let i = p.length - 1; i >= 0 && !ev._stop; i--) fire(p[i], 1)
      if (!ev._stop) fire(this, 2)
      if (ev.bubbles) for (let i = 1; i < p.length && !ev._stop; i++) fire(p[i], 3)
      return !ev.defaultPrevented
    }
  }
  const doc = new Node('#document')
  doc.documentElement = new Node('html')
  doc.body = new Node('body')
  doc.documentElement.parentNode = doc
  doc.body.parentNode = doc.documentElement
  doc.documentElement.childNodes.push(doc.body)
  rootDoc = doc
  doc.createElement = (t) => new Node(t)
  doc.createEvent = (kind) => {
    if (/^TouchEvent$/i.test(kind)) {
      if (ladder === 'none') throw new Error('NotSupportedError')
      // 注意：不能走 `new TE()`（那条路在非 ctor 环境故意抛 Illegal constructor）
      const ev = Object.create(TE.prototype)
      ev.type = ''; ev.bubbles = false; ev.cancelable = false; ev.composed = false; ev.detail = 0
      ev.defaultPrevented = false; ev._stop = false; ev._stopImmediate = false
      ev.target = null; ev.currentTarget = null
      ev.touches = listOf([]); ev.targetTouches = listOf([]); ev.changedTouches = listOf([])
      return ev
    }
    if (/^(Event|Events|HTMLEvents)$/i.test(kind)) return new Ev('')
    if (/^MouseEvent/i.test(kind)) return new ME('')
    throw new Error('NotSupportedError')
  }
  doc.elementFromPoint = (x, y) => {
    for (let i = layers.length - 1; i >= 0; i--) {
      const L = layers[i]
      if (x >= L.left && x <= L.right && y >= L.top && y <= L.bottom) return L.el
    }
    return doc.body
  }
  const win = new Node('#window')
  const storeStub = () => ({ getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, clear: () => {}, length: 0 })
  Object.assign(win, {
    document: doc, PointerEvent: PE, MouseEvent: ME, Event: Ev, KeyboardEvent: Ev, WheelEvent: ME,
    TouchEvent: ladder === 'none' ? undefined : TE, Touch: ladder === 'none' ? undefined : Touch,
    innerWidth: 800, innerHeight: 600, screenX: 0, screenY: 0, devicePixelRatio: dpr,
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {}, queueMicrotask,
    Date: FakeDate, Math, Number, String, isFinite, JSON, Object, Array, RegExp, Error, TypeError,
    performance: { now: () => 0 }, console,
    navigator: { userAgent: 'node-harness', maxTouchPoints: opts.maxTouchPoints || 0 },
    location: { href: 'http://127.0.0.1:8899/api/mpkg-wallpaper/library-web/tok/index.html?mpwshim=1' },
    localStorage: storeStub(), sessionStorage: storeStub(),
    URL, WeakRef, Proxy, fetch: () => Promise.reject(new Error('no-network-in-test')),
    addEventListener: Node.prototype.addEventListener, removeEventListener: Node.prototype.removeEventListener,
  })
  doc.defaultView = win
  win.window = win
  return { win, doc, Node, PE, ME, TE, Touch, Ev, layers, events, storeStub, clock }
}

/** 在假 DOM 里装**真的**帧内实现（生产 shim + 触摸代理），挂两块"作者脚本"区域与监听器。
 *  @returns {{ dom, parentWin, push, events, listeners }} */
function installFrame(env, opts = {}) {
  const dom = makeFrameDom({ ladder: opts.ladder, dpr: opts.dpr, clock: opts.clock })
  const { win, doc, Node, layers } = dom
  const a = new Node('canvas'); a.id = 'a'
  const b = new Node('div'); b.id = 'b'
  doc.body.appendChild(a); doc.body.appendChild(b)
  layers.push({ el: a, left: 0, top: 0, right: 400, bottom: 600 })
  layers.push({ el: b, left: 400, top: 0, right: 800, bottom: 600 })
  const listeners = []
  const TYPES = ['pointerdown', 'pointerup', 'pointermove', 'pointercancel', 'mousedown', 'mouseup', 'mousemove',
    'click', 'dblclick', 'contextmenu', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave',
    'touchstart', 'touchmove', 'touchend', 'touchcancel']
  for (const el of [a, b, doc, win]) {
    for (const t of TYPES) {
      el.addEventListener(t, (ev) => {
        listeners.push({
          node: el === win ? '#window' : (el.id || el.nodeName), type: ev.type,
          x: ev.clientX, y: ev.clientY, button: ev.button, buttons: ev.buttons, detail: ev.detail,
          target: ev.target && (ev.target.id || ev.target.nodeName),
          touches: ev.touches ? ev.touches.length : undefined,
          changed: ev.changedTouches ? ev.changedTouches.length : undefined,
          isTrusted: ev.isTrusted === true,
        })
      })
    }
  }
  const parentWin = { postMessage: () => {} }
  win.parent = parentWin
  const sandbox = win
  vm.createContext(sandbox)
  vm.runInContext(env.shimSource, sandbox, { filename: path.join(TMPDIR, 'shim.js') })
  if (env.agentSource) vm.runInContext(env.agentSource, sandbox, { filename: path.join(TMPDIR, 'touch-agent.js') })
  // 接线：生产 shim 若已认 `op:'touch'` 就**不**再包一层（避免掩盖"根本没接线"这件事）
  const shimWired = /op === "touch"/.test(env.shimSource) || /__mpwTouchPush/.test(env.shimSource)
  if (!shimWired && env.agentSource && opts.bridgeIfUnwired !== false) {
    const real = win.__mpwWebControl
    win.__mpwWebControl = (m) => ((m && m.op === 'touch' && typeof win.__mpwTouchPush === 'function')
      ? win.__mpwTouchPush(m) : real(m))
  }
  const posted = []
  // 与 client.js 同一条路径：父页 frame.contentWindow.postMessage(msg, "*") → 帧内 message 监听器。
  // shim 还没接线时，`op:'touch'` 由这里补上**将来要写进 shim 的那一行**（只影响未接线状态；
  // 接线后 shimWired=true，全部消息都走真实 message 通道，测试不再有旁路）。
  const frame = {
    contentWindow: {
      postMessage: (msg) => {
        posted.push(msg)
        if (!shimWired && msg && msg.op === 'touch') {
          if (typeof win.__mpwTouchPush === 'function') win.__mpwTouchPush(msg)
          return
        }
        const ev = new dom.Ev('message')
        ev.source = parentWin; ev.data = msg
        doc.dispatchEvent(ev)
      },
    },
  }
  return {
    dom, frame, parentWin, posted, events: dom.events, listeners, shimWired, a, b,
    isOnShim: typeof win.__mpwWebControl === 'function',
    agentInstalled: typeof win.__mpwTouchPush === 'function',
  }
}

/** 父页侧驱动：用**真**的生成源码（WEB_INTERACT_CLIENT_SOURCE 或它的变异副本）产生消息，
 *  每条消息走 frame.contentWindow.postMessage —— 与 client.js 的 send() 同一形状。 */
function makeParentDriver(source, opts = {}) {
  const sandbox = { setInterval: () => 1, clearInterval: () => {}, Date, Math, Number, String, isFinite, console }
  sandbox.window = sandbox
  vm.createContext(sandbox)
  const factory = vm.runInContext('(' + source + ')', sandbox, { filename: opts.filename || 'parent.js' })
  const api = factory(sandbox)
  if (opts.arm !== false) api.arm(opts.mode || 'pointer')
  return api
}
const ixInfo = (ev, kind) => ({
  kind: kind,
  buttons: kind === 'cancel' ? 0 : (Number(ev.buttons) || 0),
  button: kind === 'move' ? -1 : (Number.isFinite(Number(ev.button)) ? Number(ev.button) : -1),
  pointerType: typeof ev.pointerType === 'string' ? ev.pointerType : '',
  pointerId: ev.pointerId, isPrimary: ev.isPrimary, pressure: ev.pressure,
})
const PHASE_OF_TYPE = { touchstart: 'start', touchmove: 'move', touchend: 'end', touchcancel: 'cancel' }
/** 高层动作 → 父页消息（与 client.js 的接线逐一对应：pointerdown/move/up/cancel + touch*） */
const ACTIONS = {
  move: (api, f, rect, iw, ih, ev) => { const m = api.pointer(ev, rect, iw, ih, false, ixInfo(ev, 'move')); if (m) f.contentWindow.postMessage(m, '*') },
  down: (api, f, rect, iw, ih, ev) => { const m = api.pointer(ev, rect, iw, ih, true, ixInfo(ev, 'button')); if (m) f.contentWindow.postMessage(m, '*') },
  up: (api, f, rect, iw, ih, ev) => { const m = api.pointer(ev, rect, iw, ih, false, ixInfo(ev, 'button')); if (m) f.contentWindow.postMessage(m, '*') },
  cancel: (api, f, rect, iw, ih, ev) => { if (api.isOn()) api.blur(f); const m = api.pointer(ev, rect, iw, ih, false, ixInfo(ev, 'cancel')); if (m) f.contentWindow.postMessage(m, '*') },
  // phase 与 client.js 一样来自监听器种类；这里也接受事件自带的 type（两种都支持便于写夹具）
  touch: (api, f, rect, iw, ih, ev, phase) => {
    const m = api.touchEvent(ev, rect, iw, ih, phase || PHASE_OF_TYPE[String(ev && ev.type || '')])
    if (m) f.contentWindow.postMessage(m, '*')
  },
  touchcancel: (api, f, rect, iw, ih, ev) => { const m = api.touchEvent(ev, rect, iw, ih, 'cancel'); if (m) f.contentWindow.postMessage(m, '*'); if (api.isOn()) api.blur(f) },
  wheel: (api, f, rect, iw, ih, ev) => { const m = api.wheel(ev, rect, iw, ih); if (m) f.contentWindow.postMessage(m, '*') },
}
const GEOM = { rect: { left: 0, top: 0, width: 800, height: 600 }, iw: 800, ih: 600 }
const T = (id, x, y, extra) => Object.assign({ identifier: id, clientX: x, clientY: y }, extra || {})
const TEV = (type, touches, changed) => ({ type: type, touches: touches, changedTouches: changed })
/** 一根手指的完整"点按"：真机上浏览器同时发 pointer*（喂 click）与 touch*（喂 TouchEvent） */
function tap(api, f, x, y, geom = GEOM, id = 1) {
  const g = geom
  const p = (ev, k) => ACTIONS[k](api, f, g.rect, g.iw, g.ih, ev)
  p({ clientX: x, clientY: y, buttons: 0, button: -1, pointerType: 'touch', pointerId: id, isPrimary: true }, 'move')
  p({ clientX: x, clientY: y, buttons: 1, button: 0, pointerType: 'touch', pointerId: id, isPrimary: true, pressure: 0.5 }, 'down')
  p(TEV('touchstart', [T(id, x, y)], [T(id, x, y)]), 'touch')
  p({ clientX: x, clientY: y, buttons: 0, button: 0, pointerType: 'touch', pointerId: id, isPrimary: true }, 'up')
  p(TEV('touchend', [], [T(id, x, y)]), 'touch')
}
function mouseTap(api, f, x, y, geom = GEOM) {
  const g = geom
  const p = (ev, k) => ACTIONS[k](api, f, g.rect, g.iw, g.ih, ev)
  p({ clientX: x, clientY: y, buttons: 0, button: -1, pointerType: 'mouse' }, 'move')
  p({ clientX: x, clientY: y, buttons: 1, button: 0, pointerType: 'mouse' }, 'down')
  p({ clientX: x, clientY: y, buttons: 0, button: 0, pointerType: 'mouse' }, 'up')
}
const pick = (listeners, type, node) => listeners.filter((l) => l.type === type && (!node || l.node === node))
const firstOf = (listeners, type, node) => pick(listeners, type, node)[0] || null

/* ══════════════════ G/H. 端到端检查（每条都能被变异打红；G 跑真实现，H 跑变异副本） ══════════════════ */
// 每个检查只依赖 env（源码字符串 + 纯函数），因此同一段代码既能验真实现、也能验 /tmp 里的变异副本。
const CHECKS = {
  /* G1 单击：左键按下+抬起落在同一元素 ⇒ 帧内必须收到 click（用户点名的"点特定区域触发动作"） */
  click: {
    name: 'G1 单击 ⇒ 帧内 click（坐标/按键/detail）',
    run: (env) => {
      const fr = installFrame(env)
      const api = makeParentDriver(env.parentSource)
      mouseTap(api, fr.frame, 120, 140)
      const click = firstOf(fr.listeners, 'click', 'a')
      const down = firstOf(fr.listeners, 'pointerdown', 'a')
      const up = firstOf(fr.listeners, 'pointerup', 'a')
      return !!click && click.x === 120 && click.y === 140 && click.button === 0 && click.detail === 1
        && !!down && down.buttons === 1 && !!up && up.buttons === 0
        && fr.posted.every((m) => m.mpw === 'mpw:web') && !pick(fr.listeners, 'click', 'b').length
    },
  },
  /* G2 双击：两次点按在同一元素、**间隔在判定窗口内** ⇒ click(detail=2) + dblclick；
   *    再验反向：间隔远超窗口 ⇒ 不得合成 dblclick（组件库会把两次独立点击当两次提交）。
   *    时钟是夹具给的（`Date.now()` 可控），否则两次点击落在同一毫秒，`窗口=0` 这类变异也能蒙过去。 */
  dblclick: {
    name: 'G2 双击 ⇒ 帧内 click(detail=2) + dblclick；间隔过大 ⇒ 不合成 dblclick',
    run: (env) => {
      const clock = { t: 1700000000000 }
      const fr = installFrame(env, { clock })
      const api = makeParentDriver(env.parentSource)
      mouseTap(api, fr.frame, 200, 200)
      clock.t += 40                                   // 同一次双击（< 500ms）
      mouseTap(api, fr.frame, 200, 200)
      const clicks = pick(fr.listeners, 'click', 'a')
      const dbl = pick(fr.listeners, 'dblclick', 'a')
      clock.t += 900                                  // 隔了 900ms：这是两次独立点击
      mouseTap(api, fr.frame, 200, 200)
      const clicks2 = pick(fr.listeners, 'click', 'a')
      const dbl2 = pick(fr.listeners, 'dblclick', 'a')
      return clicks.length === 2 && clicks[1].detail === 2 && dbl.length === 1
        && clicks2.length === 3 && clicks2[2].detail === 1 && dbl2.length === 1
    },
  },
  /* G3 右键/中键：掩码与序号**原样**下发；旧 shim 不消费高位 ⇒ 绝不能伪造成左键按下 */
  rightMiddle: {
    name: 'G3 右键/中键 ⇒ 掩码原样、不伪造成左键（不产生 mousedown/click）',
    run: (env) => {
      const fr = installFrame(env)
      const api = makeParentDriver(env.parentSource)
      const g = GEOM
      ACTIONS.down(api, fr.frame, g.rect, g.iw, g.ih, { clientX: 100, clientY: 100, buttons: 2, button: 2 })
      ACTIONS.up(api, fr.frame, g.rect, g.iw, g.ih, { clientX: 100, clientY: 100, buttons: 0, button: 2 })
      ACTIONS.down(api, fr.frame, g.rect, g.iw, g.ih, { clientX: 120, clientY: 100, buttons: 4, button: 1 })
      ACTIONS.up(api, fr.frame, g.rect, g.iw, g.ih, { clientX: 120, clientY: 100, buttons: 0, button: 1 })
      const masks = fr.posted.filter((m) => m.op === 'pointer').map((m) => [m.buttons, m.button])
      const noLeft = pick(fr.listeners, 'mousedown', 'a').length === 0 && pick(fr.listeners, 'click', 'a').length === 0
      return noLeft && masks.some(([b, i]) => b === 2 && i === 2) && masks.some(([b, i]) => b === 4 && i === 1)
    },
  },
  /* G4 拖拽：按下→移动→抬起。两件事都要对：
   *   ① 拖拽**不产生 click**；② 拖拽中的第一个 move **不能**被当成"松开"（历史 bug：move 不带掩码 ⇒
   *   帧内看到 1→0 跳变 ⇒ 立刻 pointerup+click，真机表现为"拖不动/一拖就点"）。 */
  drag: {
    name: 'G4 拖拽 ⇒ 无 click、仅一次 pointerup、且首个 move 不产生 up（拖拽不被当成点击）',
    run: (env) => {
      const fr = installFrame(env)
      const api = makeParentDriver(env.parentSource)
      const g = GEOM
      const p = (ev, k) => ACTIONS[k](api, fr.frame, g.rect, g.iw, g.ih, ev)
      p({ clientX: 100, clientY: 100, buttons: 0, button: -1 }, 'move')
      p({ clientX: 100, clientY: 100, buttons: 1, button: 0 }, 'down')
      p({ clientX: 200, clientY: 150, buttons: 1 }, 'move')          // 拖拽中的第一帧
      const afterFirstMove = pick(fr.listeners, 'pointerup').length
      p({ clientX: 500, clientY: 300, buttons: 1 }, 'move')          // 移到另一块元素上
      p({ clientX: 500, clientY: 300, buttons: 0, button: 0 }, 'up')
      const ups = pick(fr.listeners, 'pointerup', 'b')
      return afterFirstMove === 0 && ups.length === 1 && pick(fr.listeners, 'pointerup').length === 3
        && pick(fr.listeners, 'click').length === 0
    },
  },
  /* G5 触摸：真 TouchEvent（5/8 语料用到）+ 同一次点按的 click 等效 */
  touchTap: {
    name: 'G5 触摸点按 ⇒ 帧内真 TouchEvent（changedTouches/identifier/坐标）+ 等效 click',
    run: (env) => {
      // 两种引擎环境都验：dict（Chromium：真 TouchEvent，引擎自己包 TouchList）
      //                 none（无 TouchEvent ⇒ 走普通 Event + 帧内自己的类数组，item() 由我们提供）
      const probeIn = (ladder) => {
        const fr = installFrame(env, { ladder })
        const api = makeParentDriver(env.parentSource)
        const probe = { ok: false, id: null, item: false, touched: 0 }
        fr.a.addEventListener('touchstart', (ev) => {
          probe.ok = !!(ev.touches && ev.changedTouches && ev.targetTouches)
          probe.touched = ev.touches.length
          probe.id = ev.changedTouches[0] && ev.changedTouches[0].identifier
          try { probe.item = !!(ev.changedTouches.item && ev.changedTouches.item(0) && ev.changedTouches.item(0).identifier === 9) } catch { probe.item = false }
        })
        tap(api, fr.frame, 150, 160, GEOM, 9)
        return { fr, probe }
      }
      const a = probeIn('dict')
      const b = probeIn('none')
      const ts = firstOf(a.fr.listeners, 'touchstart', 'a')
      const te = firstOf(a.fr.listeners, 'touchend', 'a')
      const click = firstOf(a.fr.listeners, 'click', 'a')
      return !!ts && ts.x === 150 && ts.y === 160 && ts.changed === 1 && ts.touches === 1
        && !!te && te.changed === 1 && te.touches === 0 && !!click && click.x === 150
        && a.probe.ok && a.probe.id === 9 && a.probe.item && a.probe.touched === 1
        && b.probe.ok && b.probe.id === 9 && b.probe.item
    },
  },
  /* G6 多指：两根手指各自 identifier，touches 两条；抬起一根后 changed 只含那一根 */
  multiTouch: {
    name: 'G6 多指 ⇒ touches.length=2、identifier 各自保留、changed 只含变化的那根',
    run: (env) => {
      const fr = installFrame(env)
      const api = makeParentDriver(env.parentSource)
      const g = GEOM
      const p = (ev, k) => ACTIONS[k](api, fr.frame, g.rect, g.iw, g.ih, ev)
      let twoStart = null, endInfo = null
      fr.a.addEventListener('touchstart', (ev) => { if (ev.touches.length === 2) twoStart = [ev.touches[0].identifier, ev.touches[1].identifier] })
      fr.a.addEventListener('touchend', (ev) => { endInfo = [ev.changedTouches.length, ev.changedTouches[0].identifier, ev.touches.length] })
      p(TEV('touchstart', [T(11, 100, 100)], [T(11, 100, 100)]), 'touch')
      p(TEV('touchstart', [T(11, 100, 100), T(22, 300, 200)], [T(22, 300, 200)]), 'touch')
      p(TEV('touchend', [T(22, 300, 200)], [T(11, 100, 100)]), 'touch')
      const msg = fr.posted.filter((m) => m.op === 'touch')
      return !!twoStart && twoStart[0] === 11 && twoStart[1] === 22
        && !!endInfo && endInfo[0] === 1 && endInfo[1] === 11 && endInfo[2] === 1
        && msg.length === 3 && msg[1].touches.length === 2 && msg[1].changed.length === 1
    },
  },
  /* G7 TouchEvent 三级构造阶梯：四种引擎环境都要产出带列表的事件 */
  ladder: {
    name: 'G7 TouchEvent 构造阶梯（构造器 / createEvent+位置签名 / 仅字典签名 / 无 TouchEvent）全部可用',
    run: (env) => {
      const out = []
      for (const mode of ['ctor', 'legacy', 'dict', 'none']) {
        const fr = installFrame(env, { ladder: mode })
        const api = makeParentDriver(env.parentSource)
        let got = null
        fr.a.addEventListener('touchstart', (ev) => {
          got = { type: ev.type, changed: ev.changedTouches.length, id: ev.changedTouches[0].identifier, x: ev.clientX, ctor: false }
          try { got.ctor = ev instanceof fr.dom.win.TouchEvent } catch { got.ctor = false }
        })
        tap(api, fr.frame, 150, 160, GEOM, 4)
        out.push([mode, got])
      }
      const okAll = out.every(([, g]) => g && g.type === 'touchstart' && g.changed === 1 && g.id === 4 && g.x === 150)
      const ctorModes = out.filter(([m]) => m === 'ctor' || m === 'legacy' || m === 'dict').every(([, g]) => g.ctor === true)
      const noneMode = out.find(([m]) => m === 'none')
      return okAll && ctorModes && noneMode[1].ctor === false
    },
  },
  /* G8 隐式捕获：手指移出起始元素后，move/end 仍派发到起始元素（滑块类控件的生命线） */
  implicitCapture: {
    name: 'G8 隐式捕获 ⇒ touchmove/touchend 仍派发到 touchstart 命中的元素',
    run: (env) => {
      const fr = installFrame(env)
      const api = makeParentDriver(env.parentSource)
      const g = GEOM
      const p = (ev, k) => ACTIONS[k](api, fr.frame, g.rect, g.iw, g.ih, ev)
      p(TEV('touchstart', [T(50, 100, 100)], [T(50, 100, 100)]), 'touch')
      p(TEV('touchmove', [T(50, 500, 300)], [T(50, 500, 300)]), 'touch')
      p(TEV('touchend', [], [T(50, 500, 300)]), 'touch')
      const mv = firstOf(fr.listeners, 'touchmove')
      const en = firstOf(fr.listeners, 'touchend')
      return !!mv && mv.node === 'a' && !!en && en.node === 'a' && pick(fr.listeners, 'touchmove', 'b').length === 0
    },
  },
  /* G9 坐标：祖先缩放（sx=0.5）+ DPR=2 下仍落在正确位置（CSS 像素口径，与 DPR 无关） */
  scaledCoords: {
    name: 'G9 祖先缩放 + DPR≠1 ⇒ 帧内坐标仍正确（CSS 像素，不受 DPR 影响）',
    run: (env) => {
      const fr = installFrame(env, { dpr: 2 })
      const api = makeParentDriver(env.parentSource)
      // 帧显示 400×300 而内部视口 800×600 ⇒ sx=sy=0.5；窗口点 (250,175) ⇒ 帧内 (300,250)
      const geom = { rect: { left: 100, top: 50, width: 400, height: 300 }, iw: 800, ih: 600 }
      mouseTap(api, fr.frame, 250, 175, geom)
      const click = firstOf(fr.listeners, 'click', 'a')
      return !!click && click.x === 300 && click.y === 250
    },
  },
  /* G10 负面对照：**没开交互模式**时一个消息都不发、帧内一个事件都不产生（逐字节回旧行为） */
  offNoInjection: {
    name: 'G10 关闭交互 ⇒ 零消息、帧内零事件（负面对照）',
    run: (env) => {
      const fr = installFrame(env)
      const api = makeParentDriver(env.parentSource, { arm: false })
      mouseTap(api, fr.frame, 120, 140)
      tap(api, fr.frame, 120, 140)
      ACTIONS.wheel(api, fr.frame, GEOM.rect, 800, 600, { clientX: 120, clientY: 140, deltaY: 120 })
      return fr.posted.length === 0 && fr.listeners.length === 0 && api.isOn() === false
    },
  },
  /* G11 触摸取消：touchcancel ⇒ 帧内 touchcancel（不是 touchend）、且不产生 click */
  touchCancel: {
    name: 'G11 触摸取消 ⇒ 帧内 touchcancel、不产生 click（手势被系统/浏览器接管时不误点）',
    run: (env) => {
      const fr = installFrame(env)
      const api = makeParentDriver(env.parentSource)
      const g = GEOM
      const p = (ev, k) => ACTIONS[k](api, fr.frame, g.rect, g.iw, g.ih, ev)
      p({ clientX: 150, clientY: 160, buttons: 1, button: 0, pointerType: 'touch', pointerId: 1 }, 'down')
      p(TEV('touchstart', [T(1, 150, 160)], [T(1, 150, 160)]), 'touch')
      p({ clientX: 150, clientY: 160, buttons: 0, button: 0, pointerType: 'touch', pointerId: 1 }, 'cancel')
      p(TEV('touchcancel', [], [T(1, 150, 160)]), 'touchcancel')
      const tc = firstOf(fr.listeners, 'touchcancel')
      return !!tc && tc.node === 'a' && pick(fr.listeners, 'touchend').length === 0
        && pick(fr.listeners, 'click').length === 0
    },
  },
  /* G12 三向对拍：模块导出的纯函数 与 生成源码（client.js 里跑的那份）在同一输入上逐字段一致 */
  shaperAgreement: {
    name: 'G12 纯函数（pointerMsg/touchMsg）与生成源码在同一输入上逐字段一致',
    run: (env) => {
      const rect = { left: 10, top: 20, width: 800, height: 600 }
      const api = makeParentDriver(env.parentSource)
      const cases = [
        ['pointer', { clientX: 110, clientY: 120, buttons: 0, button: -1, pointerType: 'mouse' }, { kind: 'move' }],
        ['pointer', { clientX: 110, clientY: 120, buttons: 2, button: 2, pointerType: 'mouse' }, { kind: 'button', buttons: 2, button: 2 }],
        ['pointer', { clientX: 110, clientY: 120, buttons: 0, button: -1 }, { kind: 'cancel' }],
      ]
      const strip = (m) => { if (!m) return m; const c = Object.assign({}, m); delete c.mpw; return JSON.stringify(c) }
      const size = { width: 800, height: 600 }          // 纯函数吃 {width,height}；生成源码吃 iw/ih 两个数
      for (const [kind, ev, opts] of cases) {
        const a = strip(env.fn.pointerMsg(ev, rect, size, opts))
        const down = opts.kind === 'button' ? (opts.buttons & 1) !== 0 : false
        const b = strip(api.pointer(ev, rect, size.width, size.height, down, opts))
        if (!a || a !== b) return false
      }
      const tev = { type: 'touchstart', touches: [T(6, 110, 120)], changedTouches: [T(6, 110, 120)] }
      const a2 = strip(env.fn.touchMsg(tev, rect, size))
      const api3 = makeParentDriver(env.parentSource)
      const b2 = strip(api3.touchEvent(tev, rect, size.width, size.height, 'start'))
      return !!a2 && a2 === b2
    },
  },
  /* G13 坐标口径里**不许**出现 devicePixelRatio（DPR 只能影響位图，不能影響事件坐标） */
  noDprInGeometry: {
    name: 'G13 换算口径里没有 devicePixelRatio（DPR≠1 不改事件坐标）',
    run: (env) => {
      /* 真实现读仓库文件；变异副本读 env.moduleText（否则变异永远打不红这条） */
      const src = env.moduleText === undefined ? read('lib/web-interaction.js') : env.moduleText
      const at = src.indexOf('export function clientPointInFrame')
      const end = src.indexOf('\n}', at)
      const body = src.slice(at, end)
      const p = env.fn.clientPointInFrame({ clientX: 300, clientY: 150 }, { left: 100, top: 50, width: 400, height: 300 }, { width: 800, height: 600 })
      return body.length > 100 && !/devicePixelRatio/.test(body) && !!p && p.x === 400 && p.y === 200
    },
  },
}

/* ══════════════════ H. 变异自证（每条检查都必须能被"改坏的实现"打红） ══════════════════ */
// 变异只作用在 **/tmp 的真文件副本**上（源码字符串先落盘再求值），仓库文件一字不改。
const MUT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mpw-wp2-mut-'))
const realParent = WEB_INTERACT_CLIENT_SOURCE
const realShim = WEB_SHIM_SOURCE
const realAgent = WEB_TOUCH_FRAME_SOURCE
const realClient = read('lib/client.js')
const realModule = read('lib/web-interaction.js')
/** 文本替换：**必须命中且真的改动了**，否则报错（防"变异没生效但断言照样绿"的假自证）。
 *  @param {boolean} [all] 是否替换**全部**命中（同一常量在源码里可能出现多处，只替一处等于没改） */
function sub(text, re, to, id, all) {
  const r = all ? new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g') : re
  if (!r.test(text)) throw new Error('变异 ' + id + ' 的锚点没命中：' + String(re))
  const out = text.replace(r, to)
  if (out === text) throw new Error('变异 ' + id + ' 没产生任何改动')
  return out
}
const MUTATIONS = [
  { id: 'move-buttons-dropped', check: 'drag', why: '移动消息不带掩码 ⇒ 帧内把拖拽第一帧当成"松开"',
    apply: () => ({ parentSource: sub(realParent, /\(num\(o\.buttons, 0\) \| 0\)/, '0', 'move-buttons-dropped') }) },
  { id: 'click-target-check-dropped', check: 'drag', why: 'click 不再要求 down/up 同元素 ⇒ 拖拽也发 click',
    apply: () => ({ shimSource: sub(realShim, /if \(ptrDownTarget && ptrDownTarget === target\) \{/, 'if (ptrDownTarget) {', 'click-target-check-dropped') }) },
  { id: 'touch-changed-misused', check: 'touchTap', why: 'changed 列表取成 touches ⇒ touchend 的 changedTouches 为空（语料靠它判断"哪根手指抬起了"）',
    apply: () => ({ agentSource: sub(realAgent, /var changedPts = isArr\(m\.changed\) \? m\.changed : \[\];/, 'var changedPts = isArr(m.touches) ? m.touches : [];', 'touch-changed-misused') }) },
  { id: 'touch-implicit-capture-dropped', check: 'implicitCapture', why: '不再记住 touchstart 的目标 ⇒ 手指移出后事件发给别的元素',
    apply: () => ({ agentSource: sub(realAgent, /var t = targets\[id\] \|\| null;/, 'var t = null;', 'touch-implicit-capture-dropped') }) },
  { id: 'touch-list-item-dropped', check: 'touchTap', why: '类数组少了 item() ⇒ spine 一类作者脚本读不到触点',
    apply: () => ({ agentSource: sub(realAgent, /define\(out, "item", function \(i\) \{ return out\[i\] === undefined \? null : out\[i\] \}\);/, '', 'touch-list-item-dropped') }) },
  { id: 'coord-scale-dropped', check: 'scaledCoords', why: '换算不除祖先缩放系数 ⇒ 缩放后坐标整体偏移',
    apply: () => ({ parentSource: sub(realParent, /var x = \(cx - num\(rect\.left, 0\)\) \/ \(sx \|\| 1\);/, 'var x = (cx - num(rect.left, 0));', 'coord-scale-dropped') }) },
  { id: 'interact-gate-removed', check: 'offNoInjection', why: '去掉"没开交互就不发"的门 ⇒ 关闭时仍在注入（默认零回归被破坏）',
    apply: () => ({ parentSource: sub(realParent, /if \(!on\) return null;/, 'if (false) return null;', 'interact-gate-removed') }) },
  { id: 'dblclick-window-zeroed', check: 'dblclick', why: '双击判定窗口归零 ⇒ 双击退化成两次单击',
    apply: () => ({ shimSource: sub(realShim, /PTR_DBLCLICK_MS = 500/, 'PTR_DBLCLICK_MS = 0', 'dblclick-window-zeroed') }) },
  { id: 'touch-agent-missing', check: 'touchTap', why: '帧内代理不存在 ⇒ 真 TouchEvent 一条都收不到',
    apply: () => ({ agentSource: '' }) },
  { id: 'touch-phase-mapping-broken', check: 'touchCancel', why: 'cancel 映射成 end ⇒ 取消被当成"正常抬起"',
    apply: () => ({ agentSource: sub(realAgent, /"cancel"\s*:\s*"touchcancel"/, '"cancel":"touchend"', 'touch-phase-mapping-broken') }) },
  { id: 'client-embedded-drift', check: 'clientEmbedded', why: 'client.js 内嵌段与模块漂移（宿主跑的是旧逻辑）',
    apply: () => ({ clientText: sub(realClient, /var IDLE_MS = 60000, MAX_MS = 180000;/, 'var IDLE_MS = 60001, MAX_MS = 180000;', 'client-embedded-drift') }) },
  { id: 'geometry-dpr-mixed', check: 'noDprInGeometry', why: '换算里掺进 devicePixelRatio（DPR≠1 时坐标整体错）',
    apply: () => ({ moduleText: sub(realModule, /const x = \(cx - \(Number\(frameRect\.left\) \|\| 0\)\) \/ \(sx \|\| 1\);/,
      'const x = (cx - (Number(frameRect.left) || 0)) / (sx || 1) / (typeof devicePixelRatio === "number" ? devicePixelRatio : 1);', 'geometry-dpr-mixed') }) },
]
// 变异用的"client 半边对拍"检查（依赖文件文本，单独列在这里以免 G 段被文件读污染）
CHECKS.clientEmbedded = {
  name: 'G14 client.js 内嵌段与模块导出逐字节一致（宿主跑的就是这份）',
  run: (env) => {
    const c = env.clientText === undefined ? read('lib/client.js') : env.clientText
    const m = /const MPW_WEB_INTERACT_SOURCE = `([\s\S]*?)`;\n/.exec(c)
    return !!m && m[1].replace(/^\n/, '').replace(/\n$/, '') === env.parentSource
  },
}
let mutCounter = 0
/** 把变异后的源码落到 /tmp 真文件副本上，再按需动态 import 变异模块（仓库文件不动）。 */
async function mutateEnv(mut) {
  const patch = mut.apply()
  const env = { parentSource: realParent, shimSource: realShim, agentSource: realAgent, fn: MODULE_FNS, clientText: undefined, moduleText: undefined }
  const dir = path.join(MUT_DIR, mut.id)
  fs.mkdirSync(dir, { recursive: true })
  if (patch.parentSource) {
    if (patch.parentSource === realParent) throw new Error('变异没生效（' + mut.id + '）')
    fs.writeFileSync(path.join(dir, 'parent-source.js'), patch.parentSource)
    env.parentSource = fs.readFileSync(path.join(dir, 'parent-source.js'), 'utf8')
  }
  if (patch.shimSource) {
    if (patch.shimSource === realShim) throw new Error('变异没生效（' + mut.id + '）')
    fs.writeFileSync(path.join(dir, 'shim.js'), patch.shimSource)
    env.shimSource = fs.readFileSync(path.join(dir, 'shim.js'), 'utf8')
  }
  if (patch.agentSource !== undefined) {
    fs.writeFileSync(path.join(dir, 'touch-agent.js'), patch.agentSource)
    env.agentSource = patch.agentSource
    // 生产 shim **内嵌**了代理原文（WEB_SHIM_SOURCE 里 `${WEB_TOUCH_FRAME_SOURCE}`），所以改代理
    // 必须同时替换 shim 里的那段文本；否则"改坏了代理"根本进不到帧内 ⇒ 变异打不红（假自证）。
    if (realShim.indexOf(realAgent) < 0) throw new Error('生产 shim 里找不到代理原文（接线方式变了，请更新变异夹具）')
    env.shimSource = realShim.split(realAgent).join(patch.agentSource)
  }
  if (patch.clientText) env.clientText = patch.clientText
  if (patch.moduleText) {
    if (patch.moduleText === realModule) throw new Error('变异没生效（' + mut.id + '）')
    const p = path.join(dir, 'web-interaction.js')
    fs.writeFileSync(p, patch.moduleText)
    env.moduleText = patch.moduleText
    mutCounter++
    const m = await import(pathToFileURL(p).href + '?v=' + mutCounter)
    env.fn = { clientPointInFrame: m.clientPointInFrame, pointerMsg: m.pointerMsg, touchMsg: m.touchMsg }
  }
  return env
}
const MODULE_FNS = { clientPointInFrame, pointerMsg, touchMsg }
const runCheck = (id, env) => {
  try { return CHECKS[id].run(env) === true } catch { return false }
}

/* ══════════════════ G. 跑真实现 ══════════════════ */
console.log('\n== G. 帧内端到端：父页真实现 → 协议 → 生产 shim / 帧内触摸代理 → 真 DOM 事件 ==')
{
  const realEnv = { parentSource: realParent, shimSource: realShim, agentSource: realAgent, fn: MODULE_FNS }
  const ids = ['click', 'dblclick', 'rightMiddle', 'drag', 'touchTap', 'multiTouch', 'ladder',
    'implicitCapture', 'scaledCoords', 'offNoInjection', 'touchCancel', 'shaperAgreement', 'noDprInGeometry', 'clientEmbedded']
  for (const id of ids) ok(runCheck(id, realEnv), CHECKS[id].name)
  // 夹具自检：假 DOM + 真 shim 真的装起来了（否则上面的"全绿"可能是"两边都空"）
  const fr = installFrame(realEnv)
  ok(fr.isOnShim === true, 'G0 生产 shim 在假 DOM 里安装成功（__mpwWebControl 存在）')
  ok(realAgent.length > 2000 && /__mpwTouchPush/.test(realAgent), 'G0 帧内触摸代理源码存在且自报挂载点')
}

/* ══════════════════ H. 变异自证 ══════════════════ */
console.log('\n== H. 变异自证：把实现改坏（只在 /tmp 副本上）⇒ 对应检查必须变红 ==')
for (const mut of MUTATIONS) {
  const env = await mutateEnv(mut)
  ok(runCheck(mut.check, env) === false,
    'H ' + mut.id + ' ⇒ ' + mut.check + ' 变红（' + mut.why + '）')
}
ok(MUT_DIR.startsWith(os.tmpdir()), 'H 变异目录在系统临时目录内（仓库与工作树一字未改）')

/* ══════════════════ I. 生产接线自检（接好后是硬断言） ══════════════════ */
console.log('\n== I. 生产接线：`op:\'touch\'` 必须由生产 shim 真的路由到帧内触摸代理 ==')
{
  const wired = /op === "touch"/.test(realShim) && /__mpwTouchPush/.test(read('lib/web-wallpaper.js'))
  ok(wired, 'I1 生产 shim 已接线 op:"touch" → window.__mpwTouchPush（硬断言；未接线时这一条会红）')
  const fr = installFrame({ parentSource: realParent, shimSource: realShim, agentSource: realAgent })
  const api = makeParentDriver(realParent)
  let seen = null
  fr.a.addEventListener('touchend', (ev) => { seen = ev.type })
  tap(api, fr.frame, 150, 160)
  ok(fr.shimWired === true, 'I2 真 shim 自己认 op:"touch"（不是测试自己包了一层桥）')
  ok(seen === 'touchend', 'I3 端到端：父协议 → 生产 shim → 帧内 touchend')
  ok(SHIM_CONTROL_OPS.indexOf('touch') >= 0,
    'I4 op:"touch" 在控制指令白名单里（SHIM_CONTROL_OPS 是文档化的 op 契约，漏登记 = 文档与实现对不上）')
  ok(WEB_TOUCH_AGENT_VERSION >= 1 && fr.dom.win.__mpwTouchAgentVersion === WEB_TOUCH_AGENT_VERSION,
    'I4 帧内代理自报版本与模块常量一致（诊断/握手用）')
  ok(realShim.indexOf(realAgent) >= 0,
    'I5 生产 shim 源码里内嵌的是代理**原文**（同一份，不是第二份副本 ⇒ 不存在两处漂移）')
}

/* ══════════════════ 结果 ══════════════════ */
console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败')
process.exit(fail ? 1 : 0)
