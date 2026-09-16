// tools/web-interaction-test.mjs — 网页壁纸**交互注入**回归（用户第 11 条）
//
// 覆盖（每条断言对应一个真实失败模式或安全边界，不是"跑一遍不报错"）：
//   A 坐标归一化：窗口 client 坐标 → iframe 内 client 像素（含滚动/祖先缩放/帧小于舞台/非有限值）
//   B 事件整形：pointer/wheel/key 的消息形状 + 按下抬起边缘 + button:-1 哨兵语义 + 去重
//   C 注入开关：关闭时**一个消息都不发**；开启才发；超时/Esc/卸载都能关
//   D 沙箱边界：交互**不改 sandbox**（仍只要 allow-scripts，无 allow-same-origin/pointer-lock）
//   E 舞台 CSS/DOM 契约：默认不可见（不挡宿主）、交互期间只有舞台与退出按钮可点
//   F 源码同源：lib/web-interaction.js 的父页源码 与 client.js 内嵌的那段**逐字段对拍**
//
// 运行：node tools/web-interaction-test.mjs   （全过输出"结果: N 通过, 0 失败"，退出码 0）
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import {
  WEB_INTERACT_MSG, WEB_INTERACT_OPS, WEB_INTERACT_MODE, WEB_INTERACT_IDLE_MS, WEB_INTERACT_MAX_MS,
  WEB_INTERACT_STAGE_CSS, WEB_INTERACT_ATTR, WEB_INTERACT_STAGE_CLASS, WEB_INTERACT_BTN_CLASS,
  WEB_INTERACT_EXIT_CLASS, WEB_INTERACT_WRAP_CLASS, WEB_INTERACT_CLIENT_SOURCE,
  clientPointInFrame, pointerMsg, wheelMsg, keyMsg, shouldPreventDefault, normalizeInteractMode,
  createInteractSession, modsOf,
} from '../lib/web-interaction.js'
import { WEB_SANDBOX_ATTR, WEB_SANDBOX_COMPAT_ATTR, SHIM_MSG, SHIM_CONTROL_OPS } from '../lib/web-wallpaper.js'

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

  // 按下/抬起：**buttons 边缘**（button 类事件按掩码去重）
  const dn = pointerMsg({ clientX: 110, clientY: 120 }, rect, size, { kind: 'button', down: true, prevButtons: 0 })
  eq(dn.buttons, 1, 'B2 按下 buttons=1（左键位）')
  const up = pointerMsg({ clientX: 110, clientY: 120 }, rect, size, { kind: 'button', down: false, prevButtons: 1 })
  eq(up.buttons, 0, 'B2 抬起 buttons 位被清掉（否则作者永远认为按着）')
  eq(pointerMsg({ clientX: 110, clientY: 120 }, rect, size, { kind: 'button', down: true, prevButtons: 1 }), null, 'B2 重复按下（掩码没变）→ 不发')
  eq(pointerMsg({ clientX: 110, clientY: 120 }, rect, size, { kind: 'button', down: false, prevButtons: 0 }), null, 'B2 重复抬起（掩码没变）→ 不发')
  eq(pointerMsg({ clientX: 110, clientY: 120 }, rect, size, { kind: 'button', down: true, prevButtons: 0, buttons: 2 }), null, 'B2 只变不消费的位（右键）→ 不发')

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
    { kind: 'down', ev: { clientX: 140, clientY: 130, buttons: 1 } },
    { kind: 'move', ev: { clientX: 150, clientY: 130, buttons: 1 } },
    { kind: 'up', ev: { clientX: 150, clientY: 130, buttons: 0 } },
    { kind: 'wheel', ev: { clientX: 150, clientY: 130, deltaY: 120, deltaMode: 0 } },
    { kind: 'wheel', ev: { clientX: 150, clientY: 130, deltaY: 0, deltaX: 0 } },   // 空事件 → 丢弃
    { kind: 'key', down: true, ev: { key: 'a', code: 'KeyA', keyCode: 65 } },      // pointer 档 → 不发
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
      if (s.kind === 'move') out.push(api.pointer(s.ev, rect, 800, 600, false))
      else if (s.kind === 'down') out.push(api.pointer(s.ev, rect, 800, 600, true))
      else if (s.kind === 'up') out.push(api.pointer(s.ev, rect, 800, 600, false))
      else if (s.kind === 'wheel') out.push(api.wheel(s.ev, rect, 800, 600))
      else if (s.kind === 'key') out.push(api.key(s.ev, !!s.down))
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
}

/* ══════════════════ 结果 ══════════════════ */
console.log('\n结果: ' + pass + ' 通过, ' + fail + ' 失败')
process.exit(fail ? 1 : 0)
