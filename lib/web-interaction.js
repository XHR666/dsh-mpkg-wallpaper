// web-interaction.js —— 「网页（web）类壁纸」的交互注入（纯逻辑，宿主/客户端/测试共用）
//
// 为什么需要本模块：WE 的 web 壁纸是**一张网页**，作者脚本按浏览器的规矩挂
// `addEventListener('pointermove'|'click'|'wheel'|'keydown')`。本插件的壁纸层是
// `z-index:-1` + `pointer-events:none` 的**背景层**（见 client.js 的 .mpw-bgWrap），
// 指针事件一律穿过它落到 DSH 界面上 ⇒ 作者的交互脚本永远收不到事件（docs/WEB-WALLPAPER.md §11.4）。
//
// 本模块只做三件事（都是**纯函数/纯状态**，没有 DOM 依赖，便于在 Node 里断言）：
//   ① 几何：窗口坐标 → iframe 内 client 像素（docs 里叫"坐标归一化/换算"）
//   ② 事件 → 协议消息的整形（指针 / 滚轮 / 键盘 / 失焦 / 离开）
//   ③ 「交互模式」开关：谁有资格开启、什么时候自动关（防"永久劫持宿主界面"）
//
// 许可：MIT（本仓库自写）。**API 语义**（u/v → client 像素、事件白名单、按下/抬起边缘合成 click）
// 参照了 `oneincase/webwallgl`（MIT）的 `renderer/src/web.ts` / `renderer/src/web-shim.js`，
// **未复制其代码**：本文件是"纯几何 + 协议整形"的自写实现，台账见仓库根
// `../docs/COPYING-RULES.md` §4 与 `THIRD-PARTY.md`。
//
// 与渲染器（GPL-3.0-or-later）的关系：只走 postMessage 协议（协议形状不受版权保护），
// 不 import / 不内嵌 / 不转译渲染器任何代码。

/** 帧内 shim 的消息协议标记（与 lib/web-wallpaper.js 的 SHIM_MSG 必须一致） */
export const WEB_INTERACT_MSG = 'mpw:web';

/**
 * 交互舞台的 DOM 契约常量（`client.js` 建元素、测试断言、文档引用同一份字符串）。
 * 关键：舞台**只在交互模式存在**（wrap 带 `mpw-webInteract-on` + html 带 `data-mpw-interact="on"`），
 * 其余时刻 `.mpw-webInteract` 恒 `display:none` —— 宿主界面永远不被挡（本项的安全边界之一）。
 */
export const WEB_INTERACT_ATTR = 'data-mpw-interact';
export const WEB_INTERACT_STAGE_CLASS = 'mpw-webInteract';
export const WEB_INTERACT_BTN_CLASS = 'mpw-webInteractBtn';
export const WEB_INTERACT_EXIT_CLASS = 'mpw-webInteractExit';
export const WEB_INTERACT_WRAP_CLASS = 'mpw-webInteract-on';

/** 交互类控制指令（父页 → 帧内 shim 的 op） */
export const WEB_INTERACT_OPS = {
  POINTER: 'pointer',   // {x,y,inside,buttons,mods}
  WHEEL: 'wheel',       // {x,y,dx,dy,mode,mods}
  KEY: 'key',           // {down,key,code,keyCode,mods,text,repeat,composing}
  BLUR: 'blur',         // 失焦：抬起全部按键 + 取消拖拽
  STATE: 'interact',    // {on} 交互模式开关（供 shim 自报/诊断）
};

/** 修饰键位掩码：bit0 ctrl / bit1 shift / bit2 alt / bit3 meta（与上游同口径） */
export const WEB_MOD_BITS = { ctrlKey: 1, shiftKey: 2, altKey: 4, metaKey: 8 };

/** 按键掩码：bit0 左键（本插件只注入左键；右键属于宿主桌面/菜单语义，不劫持） */
export const WEB_BUTTON_LEFT = 1;

/** 交互模式自动关闭：最后一次注入事件之后静默多久自动退出（毫秒）。
 *  必须存在：交互模式下壁纸层会**接管**指针/键盘，若用户忘了退出，宿主界面就等于被冻住。 */
export const WEB_INTERACT_IDLE_MS = 60000;

/** 交互模式最长存活时间（毫秒）：即使一直在动，也不能无限期占着宿主输入面。 */
export const WEB_INTERACT_MAX_MS = 180000;

/** 交互模式的两档（由设置项互动方式 + 按下修饰键临时升级共同决定） */
export const WEB_INTERACT_MODE = { OFF: 'off', POINTER: 'pointer', FULL: 'full' };

/** 设置项 `webInteraction` 的取值（旧值/未知值一律按 pointer 处理，见 normalizeInteractMode） */
export function normalizeInteractMode(raw) {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (s === 'off' || s === '关' || s === '0' || s === 'false') return WEB_INTERACT_MODE.OFF;
  if (s === 'full' || s === '全' || s === 'all') return WEB_INTERACT_MODE.FULL;
  return WEB_INTERACT_MODE.POINTER;
}

/** 修饰键掩码（从任意 KeyboardEvent/MouseEvent 形态的普通对象取）。 */
export function modsOf(ev) {
  let m = 0;
  if (!ev || typeof ev !== 'object') return 0;
  if (ev.ctrlKey) m |= WEB_MOD_BITS.ctrlKey;
  if (ev.shiftKey) m |= WEB_MOD_BITS.shiftKey;
  if (ev.altKey) m |= WEB_MOD_BITS.altKey;
  if (ev.metaKey) m |= WEB_MOD_BITS.metaKey;
  return m;
}

/**
 * 窗口坐标 → **iframe 内 client 像素**（= 作者代码看到的 clientX/clientY 空间）。
 *
 * 为什么必须有这一步：iframe 的盒子未必与"窗口(0,0)"对齐，也不是 1:1 ——
 *   · 宿主页面可能整体滚动（frame.top 含滚动量）；祖先 CSS `transform` 缩放会让
 *     getBoundingClientRect() 含缩放，而帧内部视口不含（上游同款处理，见 web.ts 的 sx/sy）。
 * 传进来的坐标用 `clientX/clientY`（视口坐标，**不是** pageX/pageY：page 坐标含滚动，
 * 与 getBoundingClientRect() 的视口坐标不同空间，混用会让坐标整体偏移一个滚动量）。
 *
 * @param {{clientX:number, clientY:number}} ev 指针/滚轮事件的坐标来源（任意含这两个字段的对象）
 * @param {{left:number,top:number,width:number,height:number}} frameRect iframe 的视口矩形
 * @param {{width:number,height:number}} clientSize iframe 的内部视口（clientWidth/clientHeight）
 * @returns {{x:number,y:number,inside:boolean,sx:number,sy:number}|null}
 *   null = 无可用坐标（非有限值 / 尺寸为 0）→ 调用方**必须丢弃**（NaN 会污染作者的状态机）
 */
export function clientPointInFrame(ev, frameRect, clientSize) {
  if (!ev || !frameRect || !clientSize) return null;
  const cx = Number(ev.clientX), cy = Number(ev.clientY);
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  const fw = Number(frameRect.width) || 0, fh = Number(frameRect.height) || 0;
  if (!(fw > 0) || !(fh > 0)) return null;
  const iw = Number(clientSize.width) || 0, ih = Number(clientSize.height) || 0;
  if (!(iw > 0) || !(ih > 0)) return null;
  // 祖先 transform 缩放系数：帧的显示宽度 / 帧内部视口宽度（缺一不可，见上游注释）
  const sx = fw / iw, sy = fh / ih;
  const x = (cx - (Number(frameRect.left) || 0)) / (sx || 1);
  const y = (cy - (Number(frameRect.top) || 0)) / (sy || 1);
  return { x, y, inside: x >= 0 && y >= 0 && x <= iw && y <= ih, sx, sy };
}

/**
 * 指针事件 → `pointer` 消息体；null = 该事件不该注入。
 *
 * 两条去重规则（都是"不发"而不是"发个假的"）：
 *   · `opts.kind === 'move'`（默认）：**位置没变就不发** —— 宿主按事件频率推送，静止时重复派发
 *     mousemove 会让作者"有没有在动"的判定永远为真；
 *   · `opts.kind === 'button'`：**按键掩码没变就不发**（重复按下/重复抬起）。
 * 传入 `opts.lastX/lastY` 才能做位置去重；不传时按"位置未知 ⇒ 发"处理（父页第一次推送也要发出去）。
 */
export function pointerMsg(ev, frameRect, clientSize, opts = {}) {
  const pt = clientPointInFrame(ev, frameRect, clientSize);
  if (!pt) return null;
  const down = !!opts.down;
  const buttons = down ? (Number(opts.buttons) || WEB_BUTTON_LEFT) : 0;
  const prevButtons = Number(opts.prevButtons) || 0;
  const kind = opts.kind === 'button' ? 'button' : 'move';
  if (kind === 'button') {
    if (!!(prevButtons & WEB_BUTTON_LEFT) === !!(buttons & WEB_BUTTON_LEFT)) return null;
  } else if (Number.isFinite(Number(opts.lastX)) && Number.isFinite(Number(opts.lastY))
    && Number(opts.lastX) === pt.x && Number(opts.lastY) === pt.y) {
    return null;
  }
  return {
    op: WEB_INTERACT_OPS.POINTER,
    x: pt.x, y: pt.y, inside: pt.inside,
    buttons, mods: modsOf(ev),
  };
}

/** 滚轮事件 → `wheel` 消息体（delta 与 DOM deltaX/deltaY 同向，不做缩放换算）。
 *  位置可缺省（键盘/触控板手势事件可能不带坐标）→ x/y 为 null，由 shim 用最后已知位置。 */
export function wheelMsg(ev, frameRect, clientSize) {
  if (!ev) return null;
  // 先判有限**再**回落 0：写 `Number(v) || 0` 会把 NaN 静默变成 0，让"非有限值丢弃"形同虚设
  // （NaN 的 deltaY 一旦进了作者的缩放累加器，之后怎么滚都恢复不了，且没有任何报错）。
  const rx = Number(ev.deltaX === undefined ? 0 : ev.deltaX);
  const ry = Number(ev.deltaY === undefined ? 0 : ev.deltaY);
  if (!Number.isFinite(rx) || !Number.isFinite(ry)) return null;
  const dx = rx || 0;   // -0 归一
  const dy = ry || 0;
  if (dx === 0 && dy === 0) return null; // 惯性滚动尾声的空事件：不发（否则作者「在滚」判定恒真）
  const pt = clientPointInFrame(ev, frameRect, clientSize);
  const mode = Number(ev.deltaMode) || 0;
  return {
    op: WEB_INTERACT_OPS.WHEEL,
    x: pt ? pt.x : null, y: pt ? pt.y : null,
    dx, dy, mode: mode === 1 || mode === 2 ? mode : 0,
    mods: modsOf(ev),
  };
}

/** 必须拦下的按键（浏览器/宿主的全局快捷键）：拦下 = preventDefault，否则会导航/刷新/切标签，
 *  把用户的 DSH 会话整个带走。**只拦"会离开本页面"的这一类**，其余键一律放行（见 shouldPreventDefault）。 */
export const WEB_KEY_BLOCK = [
  'F5', 'F11', 'F12', 'BrowserBack', 'BrowserForward', 'BrowserRefresh',
];

/** 键盘事件 → `key` 消息体。`text` 仅 keydown 且非修饰键时给（供 shim 合成字符输入）。 */
export function keyMsg(ev, down) {
  if (!ev) return null;
  const key = typeof ev.key === 'string' ? ev.key : '';
  if (!key) return null;
  const mods = modsOf(ev);
  // 单字符键（含 shift 后的符号）才是"文本"：Enter/Backspace/方向键等由 shim 自己映射。
  let text = '';
  if (down && !ev.ctrlKey && !ev.metaKey && !ev.altKey && typeof key === 'string' && [...key].length === 1) text = key;
  return {
    op: WEB_INTERACT_OPS.KEY,
    down: !!down,
    key: key.slice(0, 32),
    code: typeof ev.code === 'string' ? ev.code.slice(0, 32) : '',
    keyCode: Number.isFinite(Number(ev.keyCode)) ? Number(ev.keyCode) | 0 : 0,
    mods,
    text,
    repeat: !!ev.repeat,
    composing: !!ev.isComposing,
  };
}

/**
 * 是否要 preventDefault。策略（安全边界的一部分，测试逐条断言）：
 *   · 浏览器级快捷键（Ctrl/Cmd + R/W/T/N/Q/L/P、F5/F11/F12、Backspace）**一律拦**——
 *     不拦就会在用户"玩壁纸"时刷新/关闭宿主页面；
 *   · Tab 拦（否则焦点跑出交互舞台，键盘注入失效且用户不知道焦点在哪）；
 *   · 其余（方向键/空格/字母/Enter/Esc…）**不拦**：作者若消费了它就没影响，
 *     作者没消费时方向键仍然滚宿主界面（不静默吞掉用户的滚动能力）。
 */
export function shouldPreventDefault(ev) {
  if (!ev) return false;
  const key = typeof ev.key === 'string' ? ev.key : '';
  if (WEB_KEY_BLOCK.indexOf(key) >= 0) return true;
  if (key === 'Tab') return true;
  if (key === 'Backspace') return true;
  if ((ev.ctrlKey || ev.metaKey) && typeof key === 'string' && /^[a-z]$/i.test(key)) {
    return /^[rwtnqlp]$/i.test(key);
  }
  return false;
}

/**
 * 交互模式的会话状态（纯状态机，无 DOM）。
 *
 * 为什么状态机要单独抽出来：这一段对应三个真实风险，且都能在 Node 里断言 ——
 *   ① 宿主界面被**永久劫持**（用户忘了退出）：idle/maxAge 双超时 + Esc/按钮退出；
 *   ② 指针离开画布后作者侧卡在 hover/按下态：leave 必须被合成（shim 负责），
 *      但"什么时候算离开"由这里决定（切窗口/失焦也是离开）；
 *   ③ 切壁纸/切页面后残留一个吃掉所有事件的舞台：disarm 必须幂等且复位计时。
 */
export function createInteractSession(opts = {}) {
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const idleMs = Number.isFinite(opts.idleMs) ? opts.idleMs : WEB_INTERACT_IDLE_MS;
  const maxMs = Number.isFinite(opts.maxMs) ? opts.maxMs : WEB_INTERACT_MAX_MS;
  let on = false, started = 0, last = 0;
  return {
    isOn: () => on,
    mode: () => (on ? (opts.mode || WEB_INTERACT_MODE.POINTER) : WEB_INTERACT_MODE.OFF),
    /** 开启（幂等：已开则只刷新活动时间）。@returns {boolean} 是否发生了状态变化 */
    arm(mode) {
      const t = now();
      if (on) { last = t; return false; }
      on = true; started = t; last = t;
      opts.mode = mode || opts.mode || WEB_INTERACT_MODE.POINTER;
      return true;
    },
    /** 关闭（幂等）。@returns {boolean} 是否发生了状态变化 */
    disarm() {
      if (!on) return false;
      on = false; started = 0; last = 0;
      return true;
    },
    /** 有一次真实注入（指针/滚轮/键盘）→ 续期 */
    touch() { if (on) last = now(); },
    /** 剩余毫秒（用于徽标倒计时/诊断；关闭时为 0） */
    remainMs() {
      if (!on) return 0;
      const t = now();
      return Math.max(0, Math.min(last + idleMs, started + maxMs) - t);
    },
    /** 是否该自动退出（idle 或 maxAge 到） */
    expired() {
      if (!on) return false;
      const t = now();
      return t - last >= idleMs || t - started >= maxMs;
    },
    /** 一次性推进：到期则关闭并返回 true（调用方据此隐藏舞台 + 通知 shim 失焦） */
    tick() {
      if (!on) return false;
      if (!this.expired()) return false;
      this.disarm();
      return true;
    },
    /** 诊断快照（进 /diag，便于真机判断"为什么没反应"） */
    snapshot() { return { on, mode: this.mode(), remainMs: Math.round(this.remainMs()), idleMs, maxMs }; },
  };
}

/**
 * 交互舞台的样式表（`client.js` 把这份字符串原样拼进它自己注入的 `<style>`；测试断言
 * "舞台默认不可见 + 交互期间只有舞台与退出按钮可点"这两条安全边界都有 CSS 依据）。
 *
 * 两条约束写在样式里（不是写在 JS 里）：
 *   · `.mpw-bgWrap` 自身是 `pointer-events:none` 的背景层（见 client.js 的 .mpw-bgWrap 规则），
 *     所以舞台/按钮必须显式 `pointer-events:auto` 才收得到事件；
 *   · 舞台只在交互模式显示（`.mpw-bgWrap` 带 `mpw-webInteract-on`）⇒ 其余时刻恒 `display:none`，
 *     宿主界面永远不被挡（零回归）。
 */
export const WEB_INTERACT_STAGE_CSS = [
  // 舞台本身固定铺满视口：交互期间它就是"输入面"，因此必须 pointer-events:auto
  '.mpw-webInteract{position:fixed;inset:0;z-index:1;display:none;background:transparent;cursor:crosshair;}',
  // 仅在交互模式显示；默认（未加 .mpw-webInteract-on）恒 display:none → 零回归
  '.mpw-bgWrap.mpw-webInteract-on .mpw-webInteract{display:block;}',
  // 交互期间宿主界面整体不吃指针（否则舞台之下的按钮会被抢 click）；消息/列表滚动仍可用滚轮
  // 之外的方式（键盘、点击舞台退出按钮）——见 docs/WEB-WALLPAPER.md「交互模式的安全边界」。
  'html[data-mpw-interact="on"] body{pointer-events:none !important;}',
  'html[data-mpw-interact="on"] .mpw-webInteract{pointer-events:auto !important;}',
  // 退出按钮：交互期间唯一的"按钮"（z-index 高于舞台），保证用户永远能一键退出
  '.mpw-webInteractExit{position:fixed;right:12px;top:12px;z-index:2;pointer-events:auto;cursor:pointer;'
  + 'font:12px/1.6 ui-sans-serif,system-ui,sans-serif;color:#fff;background:rgba(24,26,34,.82);'
  + 'border:1px solid rgba(255,255,255,.28);border-radius:8px;padding:6px 10px;display:none;}',
  'html[data-mpw-interact="on"] .mpw-webInteractExit{display:block;}',
  // 常驻小按钮（交互模式入口）：壁纸交互是"偶发需求"，给一个可见但极小的入口
  '.mpw-webInteractBtn{position:fixed;right:12px;bottom:12px;z-index:2;pointer-events:auto;cursor:pointer;'
  + 'font:12px/1.6 ui-sans-serif,system-ui,sans-serif;color:#fff;background:rgba(24,26,34,.72);'
  + 'border:1px solid rgba(255,255,255,.22);border-radius:8px;padding:6px 10px;display:none;}',
  '.mpw-bgWrap.mpw-web .mpw-webInteractBtn{display:block;}',
].join('\n');

/**
 * 父页侧舞台逻辑的源码（字符串形态）。
 *
 * 为什么用"源码字符串 + 生成器"而不是直接写函数：`lib/client.js` 在浏览器里是 **CommonJS
 * factory（`var __mpwFactory = (require) => …`）**，没有 ESM import 通道 —— 想共用一份实现
 * 就只能把源码当字符串带过去，在 client.js 里 `new Function` 求值一次。
 * 这样做的**测试收益**是决定性的：同一份源码可以在 Node 的 vm 里用**假 window/冒泡 DOM** 跑，
 * 直接断言"注入到帧内 shim 的消息长什么样"（而不是只断言源码里出现过某个字符串）。
 *
 * 约束：本字符串里**不许**出现反引号与美元花括号（会被外层模板吃掉），且必须是自包含 IIFE
 * （只依赖传入的 `win`），因为它要在插件客户端里独立求值。
 */
function buildInteractionClientSource() {
  const L = [];
  L.push('(function (win) {');
  L.push('    "use strict";');
  L.push('    var MSG = ' + JSON.stringify(WEB_INTERACT_MSG) + ';');
  L.push('    var IDLE_MS = ' + WEB_INTERACT_IDLE_MS + ', MAX_MS = ' + WEB_INTERACT_MAX_MS + ';');
  L.push('    var BLOCK = ' + JSON.stringify(WEB_KEY_BLOCK) + ';');
  L.push('    var BTN = ' + (1 << 0) + ';');
  L.push('    function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }');
  L.push('    function mods(ev) {');
  L.push('      var m = 0;');
  L.push('      if (ev && ev.ctrlKey) m |= 1;');
  L.push('      if (ev && ev.shiftKey) m |= 2;');
  L.push('      if (ev && ev.altKey) m |= 4;');
  L.push('      if (ev && ev.metaKey) m |= 8;');
  L.push('      return m;');
  L.push('    }');
  L.push('    function point(ev, rect, iw, ih) {');
  L.push('      var cx = num(ev && ev.clientX, NaN), cy = num(ev && ev.clientY, NaN);');
  L.push('      if (!isFinite(cx) || !isFinite(cy)) return null;');
  L.push('      var fw = num(rect && rect.width, 0), fh = num(rect && rect.height, 0);');
  L.push('      if (!(fw > 0) || !(fh > 0) || !(iw > 0) || !(ih > 0)) return null;');
  L.push('      var sx = fw / iw, sy = fh / ih;');
  L.push('      var x = (cx - num(rect.left, 0)) / (sx || 1);');
  L.push('      var y = (cy - num(rect.top, 0)) / (sy || 1);');
  L.push('      return { x: x, y: y, inside: x >= 0 && y >= 0 && x <= iw && y <= ih };');
  L.push('    }');
  L.push('    function make() {');
  L.push('      var on = false, mode = "pointer", started = 0, last = 0, timer = 0;');
  L.push('      var buttons = 0;');
  L.push('      function nowMs() { try { return Date.now() } catch (e) { return 0 } }');
  L.push('      var api = {');
  L.push('        isOn: function () { return on },');
  L.push('        mode: function () { return on ? mode : "off" },');
  L.push('        buttons: function () { return buttons },');
  L.push('        arm: function (m) {');
  L.push('          var t = nowMs();');
  L.push('          if (on) { last = t; return false; }');
  L.push('          on = true; started = t; last = t; buttons = 0;');
  L.push('          if (m === "full" || m === "pointer") mode = m;');
  L.push('          return true;');
  L.push('        },');
  L.push('        disarm: function () {');
  L.push('          if (!on) return false;');
  L.push('          on = false; started = 0; last = 0; buttons = 0;');
  L.push('          return true;');
  L.push('        },');
  L.push('        touch: function () { if (on) last = nowMs() },');
  L.push('        remainMs: function () {');
  L.push('          if (!on) return 0;');
  L.push('          var t = nowMs();');
  L.push('          return Math.max(0, Math.min(last + IDLE_MS, started + MAX_MS) - t);');
  L.push('        },');
  L.push('        tick: function () {');
  L.push('          if (!on) return false;');
  L.push('          var t = nowMs();');
  L.push('          if (t - last >= IDLE_MS || t - started >= MAX_MS) { api.disarm(); return true; }');
  L.push('          return false;');
  L.push('        },');
  L.push('        snapshot: function () { return { on: on, mode: api.mode(), remainMs: Math.round(api.remainMs()), idleMs: IDLE_MS, maxMs: MAX_MS } },');
  L.push('        /* 指针：buttons 走边缘（按下=1 / 抬起=0），位置与掩码都没变就不发（父页按事件频率推送） */');
  L.push('        pointer: function (ev, rect, iw, ih, down) {');
  L.push('          if (!on) return null;');
  L.push('          var p = point(ev, rect, iw, ih);');
  L.push('          if (!p) return null;');
  L.push('          var next = down ? BTN : 0;');
  L.push('          if (next === buttons && down !== true) { /* 移动事件：位置变了就发，掩码不变 */ }');
  L.push('          buttons = next;');
  L.push('          last = nowMs();');
  L.push('          return { mpw: MSG, op: "pointer", x: p.x, y: p.y, inside: p.inside, buttons: next, mods: mods(ev) };');
  L.push('        },');
  L.push('        /* 滚轮：delta 原样透传（与视口尺寸无关，不做缩放）；坐标可缺省（键盘/手势） */');
  L.push('        wheel: function (ev, rect, iw, ih) {');
  L.push('          if (!on) return null;');
  L.push('          var dx = num(ev && ev.deltaX, 0), dy = num(ev && ev.deltaY, 0);');
  L.push('          if (dx === 0 && dy === 0) return null;');
  L.push('          var p = point(ev, rect, iw, ih);');
  L.push('          last = nowMs();');
  L.push('          return { mpw: MSG, op: "wheel", x: p ? p.x : null, y: p ? p.y : null, dx: dx, dy: dy, mode: num(ev && ev.deltaMode, 0), mods: mods(ev) };');
  L.push('        },');
  L.push('        /* 键盘**只在 full 档**注入：pointer 档下作者收不到按键，也就不会误吞用户的输入 */');
  L.push('        key: function (ev, down) {');
  L.push('          if (!on || mode !== "full" || !ev) return null;');
  L.push('          var key = typeof ev.key === "string" ? ev.key : "";');
  L.push('          if (!key) return null;');
  L.push('          var text = "";');
  L.push('          if (down && !ev.ctrlKey && !ev.metaKey && !ev.altKey && key.length === 1) text = key;');
  L.push('          last = nowMs();');
  L.push('          return { mpw: MSG, op: "key", down: !!down, key: key.slice(0, 32), code: String(ev.code || "").slice(0, 32), keyCode: num(ev.keyCode, 0) | 0, mods: mods(ev), text: text, repeat: !!ev.repeat, composing: !!ev.isComposing };');
  L.push('        },');
  L.push('        blur: function (f) { if (!f) return false; try { f.contentWindow.postMessage({ mpw: MSG, op: "blur" }, "*"); return true } catch (e) { return false } },');
  L.push('        state: function (f) { if (!f) return false; try { f.contentWindow.postMessage({ mpw: MSG, op: "interact", on: on }, "*"); return true } catch (e) { return false } },');
  L.push('        /* 必须拦下的键：Ctrl/Cmd+R/W/T/N/Q/L/P、F5/F11/F12、Backspace、Tab（不拦会把宿主页面刷掉/导航走） */');
  L.push('        preventDefault: function (ev) {');
  L.push('          if (!ev || !on || mode !== "full") return false;');
  L.push('          var k = typeof ev.key === "string" ? ev.key : "";');
  L.push('          if (BLOCK.indexOf(k) >= 0 || k === "Tab" || k === "Backspace") return true;');
  L.push('          if ((ev.ctrlKey || ev.metaKey) && /^[a-z]$/i.test(k) && /^[rwtnqlp]$/i.test(k)) return true;');
  L.push('          return false;');
  L.push('        },');
  L.push('        /* 1s 心跳式看护：到期自动退出（防"用户忘了退出 → 宿主界面被永久劫持"） */');
  L.push('        watch: function (onExpire) {');
  L.push('          try { if (timer) win.clearInterval(timer) } catch (e) {}');
  L.push('          timer = win.setInterval(function () { try { if (api.tick()) onExpire() } catch (e) {} }, 1000);');
  L.push('          return timer;');
  L.push('        },');
  L.push('        unwatch: function () { try { if (timer) win.clearInterval(timer) } catch (e) {} timer = 0; }');
  L.push('      };');
  L.push('      return api;');
  L.push('    }');
  L.push('    var existing = null;');
  L.push('    try { existing = win.__mpwInteraction || null } catch (e) {}');
  L.push('    win.__mpwInteraction = existing || make();');
  L.push('    return win.__mpwInteraction;');
  L.push('  })');
  return L.join('\n');
}

/** 父页侧舞台逻辑源码（自包含 IIFE；`client.js` 求值后挂 `window.__mpwInteraction`）。 */
export const WEB_INTERACT_CLIENT_SOURCE = buildInteractionClientSource();
