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
//
// ①(WP-2 2026-09-19) **触摸与多键补齐**：上游 webwallgl 全文没有 touch 支持（`renderer/src/web.ts`
// 与 `web-shim.js` 里 0 处 `touch*`），而本机真语料 8 张 web 壁纸里 **5 张**注册了
// `touchstart/touchmove/touchend/touchcancel`（与 `mousedown/mouseup` 同频，见 tools/web-interaction-test.mjs
// 的对照表），所以触摸这条链只能自写：
//   · 父页侧：`touchMsg()` 把 DOM TouchEvent 整形为 `op:'touch'`（多指 `identifier` + 逐点坐标换算）；
//   · 帧内：`WEB_TOUCH_FRAME_SOURCE` 把 `op:'touch'` 还原成**真** `TouchEvent`（三级构造阶梯，
//     因为 Chromium 里 `new TouchEvent()` 非法、且各引擎能力不同）。
// 同时把指针消息从"只有左键 0/1"补成 DOM 口径的 `button`/`buttons`/`pointerType`/`pressure`
// （`buttons` 仍是位掩码 bit0=左 —— 帧内旧 shim 只消费 bit0，高位是**向后兼容的加法**）。

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
  POINTER: 'pointer',   // {x,y,inside,buttons,mods,button,pointerType,pointerId,isPrimary,pressure,phase,cancel}
  TOUCH: 'touch',       // {phase,touches[],changed[],x,y,inside,mods,count}   ①(WP-2) 新增
  WHEEL: 'wheel',       // {x,y,dx,dy,mode,mods}
  KEY: 'key',           // {down,key,code,keyCode,mods,text,repeat,composing}
  BLUR: 'blur',         // 失焦：抬起全部按键 + 取消拖拽
  STATE: 'interact',    // {on} 交互模式开关（供 shim 自报/诊断）
};

/** 修饰键位掩码：bit0 ctrl / bit1 shift / bit2 alt / bit3 meta（与上游同口径） */
export const WEB_MOD_BITS = { ctrlKey: 1, shiftKey: 2, altKey: 4, metaKey: 8 };

/**
 * `MouseEvent.buttons` **位掩码**（UI Events 规范）：bit0 左 / bit1 右 / bit2 中。
 * 与 `MouseEvent.button`（序号：0 左 / 1 中 / 2 右）**不是**一回事 —— 混用是本领域最常见的错。
 * 帧内现有 shim 只消费 bit0（照抄上游：桌面右键属于宿主语义），高位原样透传 ⇒ 加法不破坏旧行为。
 */
export const WEB_BUTTON = { LEFT: 1, RIGHT: 2, MIDDLE: 4 };

/** 按键掩码：bit0 左键（兼容旧名；右/中位由 WEB_BUTTON 给出） */
export const WEB_BUTTON_LEFT = WEB_BUTTON.LEFT;

/** `MouseEvent.button` 序号 → `buttons` 位掩码（0→左 1→中 2→右；3/4 侧键 → 0） */
export function buttonBitOf(button) {
  const b = Number(button);
  if (b === 0) return WEB_BUTTON.LEFT;
  if (b === 1) return WEB_BUTTON.MIDDLE;
  if (b === 2) return WEB_BUTTON.RIGHT;
  return 0;
}

/** 触摸消息的 phase（与 DOM TouchEvent 类型一一对应；协议里用短名） */
export const WEB_TOUCH_PHASE = { START: 'start', MOVE: 'move', END: 'end', CANCEL: 'cancel' };

/** DOM 事件类型 → 协议 phase（`touchMsg` 未显式给 phase 时按它推断） */
export const WEB_TOUCH_PHASE_OF = {
  touchstart: WEB_TOUCH_PHASE.START,
  touchmove: WEB_TOUCH_PHASE.MOVE,
  touchend: WEB_TOUCH_PHASE.END,
  touchcancel: WEB_TOUCH_PHASE.CANCEL,
};

/** 协议里触点列表的上限（浏览器典型上限是 5~10；有界化防止一条消息无限大） */
export const WEB_TOUCH_LIMIT = 5;

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
 *
 * ①(WP-2) 补齐的字段（全部是**加法**，旧帧内 shim 忽略未知字段 ⇒ 不破坏旧行为）：
 *   · `button`：`MouseEvent.button` 序号（0 左 / 1 中 / 2 右）；**移动/悬停类必须是 -1**
 *     （W3C「无按键变化」哨兵；填 0 会让 GameMaker 一类运行时把"移过去"记成"左键一直按着"）；
 *   · `buttons`：DOM 位掩码（1 左 / 2 右 / 4 中）。帧内旧 shim 只消费 bit0 ⇒ 左键语义逐字节不变；
 *   · `pointerType`（mouse/touch/pen）、`pointerId`、`isPrimary`、`pressure`：触屏/笔的作者脚本会读；
 *   · `phase`（down/up/move/cancel）+ `cancel`：指针取消（`pointercancel`）也能表达，
 *     否则触屏"浏览器接管手势"会让作者卡在按下态（真机常见）。
 *
 * @param {object} ev 指针事件（任意含 clientX/clientY 的对象；也接受 Touch 对象）
 * @param {{left:number,top:number,width:number,height:number}} frameRect iframe 的视口矩形
 * @param {{width:number,height:number}} clientSize iframe 内部视口
 * @param {{kind?:'move'|'button'|'cancel',down?:boolean,buttons?:number,button?:number,prevButtons?:number,
 *          lastX?:number,lastY?:number,pointerType?:string,pointerId?:number,isPrimary?:boolean,pressure?:number}} [opts]
 */
export function pointerMsg(ev, frameRect, clientSize, opts = {}) {
  const pt = clientPointInFrame(ev, frameRect, clientSize);
  if (!pt) return null;
  const kind = opts.kind === 'button' || opts.kind === 'cancel' ? opts.kind : 'move';
  const prevButtons = Number(opts.prevButtons) || 0;
  // 掩码：显式给 buttons 就用它（DOM 位掩码）；否则按"左键按下=1 / 抬起=0"（旧调用口径）
  const buttons = kind === 'cancel'
    ? 0
    : (opts.buttons === undefined || opts.buttons === null
      ? (opts.down ? WEB_BUTTON.LEFT : 0)
      : (Number(opts.buttons) || 0));
  if (kind === 'button' && buttons === prevButtons) return null;   // 掩码没变 → 不发
  if (kind === 'move'
    && Number.isFinite(Number(opts.lastX)) && Number.isFinite(Number(opts.lastY))
    && Number(opts.lastX) === pt.x && Number(opts.lastY) === pt.y) {
    return null;
  }
  const msg = {
    op: WEB_INTERACT_OPS.POINTER,
    x: pt.x, y: pt.y, inside: pt.inside,
    buttons, mods: modsOf(ev),
    // 移动/悬停 = -1（哨兵）；按下/抬起用事件自报的序号，缺省 -1（由帧内自己判）
    button: kind === 'move' ? -1 : (Number.isFinite(Number(opts.button)) ? Number(opts.button) | 0 : -1),
    phase: kind === 'cancel' ? 'cancel' : (kind === 'move' ? 'move' : ((buttons & WEB_BUTTON.LEFT) ? 'down' : 'up')),
  };
  // 触摸/笔的附带信息只在父页确实知道时下发（鼠标不给，帧内按默认 mouse 处理）。
  // 取值优先 opts（父页整形后的显式值），回落到事件自身（真 PointerEvent 上本就有这些字段）。
  const pType = opts.pointerType !== undefined ? opts.pointerType : ev.pointerType;
  const pId = opts.pointerId !== undefined ? opts.pointerId : ev.pointerId;
  const pPrimary = opts.isPrimary !== undefined ? opts.isPrimary : ev.isPrimary;
  const pPressure = opts.pressure !== undefined ? opts.pressure : ev.pressure;
  if (typeof pType === 'string' && pType) msg.pointerType = pType.slice(0, 16);
  if (Number.isFinite(Number(pId))) msg.pointerId = Number(pId) | 0;
  if (pPrimary !== undefined) msg.isPrimary = !!pPrimary;
  if (pPressure !== undefined && Number.isFinite(Number(pPressure))) msg.pressure = Math.max(0, Math.min(1, Number(pPressure)));
  if (kind === 'cancel') msg.cancel = true;
  return msg;
}

/**
 * 触点 → 帧内 client 像素坐标点。与 `clientPointInFrame` 同一套几何（**唯一口径**），
 * 只是把 `Touch` 的字段（identifier/radiusX/radiusY/force）一并带上。
 * 坐标不可用（非有限值/几何为 0）→ null（该触点丢弃，不让 NaN 进作者的状态机）。
 */
export function touchPointInFrame(touch, frameRect, clientSize) {
  const pt = clientPointInFrame(touch, frameRect, clientSize);
  if (!pt) return null;
  const id = Number(touch && touch.identifier);
  const rx = Number(touch && touch.radiusX), ry = Number(touch && touch.radiusY);
  const force = Number(touch && touch.force);
  return {
    id: Number.isFinite(id) ? id | 0 : 0,
    x: pt.x, y: pt.y, inside: pt.inside,
    rx: Number.isFinite(rx) && rx > 0 ? rx : 1,
    ry: Number.isFinite(ry) && ry > 0 ? ry : 1,
    force: Number.isFinite(force) ? Math.max(0, Math.min(1, force)) : 0.5,
  };
}

/**
 * DOM TouchEvent → `touch` 消息体（①WP-2）；null = 该事件不该注入。
 *
 * 为什么要独立一条 op（而不是复用 pointer）：真机上**触摸不是鼠标**——
 *   · 作者脚本里 `touchstart/touchmove/touchend/touchcancel` 是独立监听器（本机 8 张 web 语料里 5 张有，
 *     与 mousedown/mouseup 同频；如 spine-webgl 只认 `changedTouches.item(0)`，
 *     pixi 要 `changedTouches[i].identifier/radiusX/force`，element-plus 滑块要 `touches` 列表）；
 *   · 多指（`identifier`）与 `touches`/`changedTouches` 两个列表在 pointer 通道里表达不了。
 * 两个列表的语义照 DOM：`touches` = 仍在屏上的**全部**触点，`changed` = **本条消息涉及**的触点。
 * `x/y` 取"主触点"（changed 的第一个，退化为 touches 的第一个）——帧内据此决定派发目标。
 *
 * @param {{touches?:ArrayLike<any>,changedTouches?:ArrayLike<any>,type?:string}} ev
 * @param {{left:number,top:number,width:number,height:number}} frameRect
 * @param {{width:number,height:number}} clientSize
 * @param {{phase?:'start'|'move'|'end'|'cancel'}} [opts]
 */
export function touchMsg(ev, frameRect, clientSize, opts = {}) {
  if (!ev) return null;
  const phase = WEB_TOUCH_PHASE_OF[String(opts.phase || ev.type || '').toLowerCase()]
    || String(opts.phase || '').toLowerCase();
  if (!phase || (phase !== 'start' && phase !== 'move' && phase !== 'end' && phase !== 'cancel')) return null;
  const list = (arr) => {
    const out = [];
    const n = Math.min(Number(arr && arr.length) || 0, WEB_TOUCH_LIMIT);
    for (let i = 0; i < n; i++) {
      const p = touchPointInFrame(arr[i], frameRect, clientSize);
      if (p) out.push(p);   // 坐标坏掉的触点直接丢（不污染整条消息）
    }
    return out;
  };
  const touches = list(ev.touches);
  const changed = list(ev.changedTouches);
  // 抬起/取消后 touches 为空是正常的（changed 必非空）；start/move 两个列表都空 ⇒ 无信息，不发
  if (!touches.length && !changed.length && phase !== 'end' && phase !== 'cancel') return null;
  const primary = changed[0] || touches[0] || null;
  const msg = {
    op: WEB_INTERACT_OPS.TOUCH,
    phase,
    x: primary ? primary.x : null,
    y: primary ? primary.y : null,
    inside: primary ? primary.inside : false,
    touches,
    changed,
    count: touches.length,
    mods: modsOf(ev),
    // 触摸语义下"有手指在屏上"= 主键按下（DOM 对触摸的 buttons 口径），供帧内兼容鼠标路径使用
    button: phase === 'move' ? -1 : 0,
    buttons: touches.length ? WEB_BUTTON.LEFT : 0,
    pointerType: 'touch',
  };
  return msg;
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
  // 舞台本身固定铺满视口：交互期间它就是"输入面"，因此必须 pointer-events:auto。
  // ①(WP-2) `touch-action:none` 是触屏可用性的**前提**：不写它时，单指拖动会被浏览器当成
  // 宿主页面滚动/缩放手势接管 ⇒ 中途收到 pointercancel、作者脚本只看到"按下就没了"，
  // 滑块/拖拽类壁纸在真机上完全不可用（桌面鼠标无此问题，所以只能在触屏上暴露）。
  // `user-select:none` 同理：拖动会被当成文字选择（长按还会弹选择菜单）。
  '.mpw-webInteract{position:fixed;inset:0;z-index:1;display:none;background:transparent;cursor:crosshair;'
  + 'touch-action:none;user-select:none;-webkit-user-select:none;}',
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
  // 帧内只需要"左键位"（旧 shim 的消费口径）与触点上限；右/中位是父页算好的**位掩码**，原样透传
  L.push('    var BTN = ' + WEB_BUTTON.LEFT + ', TOUCH_LIMIT = ' + WEB_TOUCH_LIMIT + ';');
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
  L.push('      var buttons = 0, lastX = null, lastY = null, touchSig = "";');
  L.push('      function nowMs() { try { return Date.now() } catch (e) { return 0 } }');
  L.push('      var api = {');
  L.push('        isOn: function () { return on },');
  L.push('        mode: function () { return on ? mode : "off" },');
  L.push('        buttons: function () { return buttons },');
  L.push('        arm: function (m) {');
  L.push('          var t = nowMs();');
  L.push('          if (on) { last = t; return false; }');
  L.push('          on = true; started = t; last = t; buttons = 0; lastX = null; lastY = null; touchSig = "";');
  L.push('          if (m === "full" || m === "pointer") mode = m;');
  L.push('          return true;');
  L.push('        },');
  L.push('        disarm: function () {');
  L.push('          if (!on) return false;');
  L.push('          on = false; started = 0; last = 0; buttons = 0; lastX = null; lastY = null; touchSig = "";');
  L.push('          return true;');
  L.push('        },');
  L.push('        /* 有一次真实注入（指针/滚轮/键盘/触摸）→ 续期。注意与 touchEvent 不是一回事 */');
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
  L.push('        /* 指针：buttons 是 DOM 位掩码（1 左/2 右/4 中）的**边缘**；位置没变就不发（父页按事件频率推送）。\n'
    + '           info 里的 button/pointerType/pointerId/isPrimary/pressure 都是**加法**：旧帧内 shim\n'
    + '           只读 x/y/buttons/mods（bit0=左），所以左键点击链逐字节不变。 */');
  L.push('        pointer: function (ev, rect, iw, ih, down, info) {');
  L.push('          if (!on) return null;');
  L.push('          var p = point(ev, rect, iw, ih);');
  L.push('          if (!p) return null;');
  L.push('          var o = info || {};');
  L.push('          var kind = o.kind === "button" || o.kind === "cancel" ? o.kind : "move";');
  L.push('          var next = kind === "cancel" ? 0 : (o.buttons === undefined || o.buttons === null ? (down ? BTN : 0) : (num(o.buttons, 0) | 0));');
  L.push('          if (kind === "button" && next === buttons) return null;');
  L.push('          if (kind === "move" && lastX !== null && lastX === p.x && lastY === p.y) return null;');
  L.push('          buttons = next; lastX = p.x; lastY = p.y; last = nowMs();');
  L.push('          var msg = { mpw: MSG, op: "pointer", x: p.x, y: p.y, inside: p.inside, buttons: next, mods: mods(ev),');
  L.push('            button: kind === "move" ? -1 : (isFinite(Number(o.button)) ? Number(o.button) | 0 : -1),');
  L.push('            phase: kind === "cancel" ? "cancel" : (kind === "move" ? "move" : ((next & BTN) ? "down" : "up")) };');
  L.push('          var pm = o.pointerType !== undefined ? o.pointerType : ev.pointerType;');
  L.push('          var pi = o.pointerId !== undefined ? o.pointerId : ev.pointerId;');
  L.push('          var pp = o.isPrimary !== undefined ? o.isPrimary : ev.isPrimary;');
  L.push('          var pf = o.pressure !== undefined ? o.pressure : ev.pressure;');
  L.push('          if (typeof pm === "string" && pm) msg.pointerType = pm.slice(0, 16);');
  L.push('          if (isFinite(Number(pi))) msg.pointerId = Number(pi) | 0;');
  L.push('          if (pp !== undefined) msg.isPrimary = !!pp;');
  L.push('          if (pf !== undefined && isFinite(Number(pf))) msg.pressure = Math.max(0, Math.min(1, Number(pf)));');
  L.push('          if (kind === "cancel") msg.cancel = true;');
  L.push('          return msg;');
  L.push('        },');
  L.push('        /* 触摸（①WP-2 新增）：touches = 屏上全部触点 / changed = 本条消息涉及的触点。\n'
    + '           坐标逐点换算（与 pointer 同一口径）；move 且两个列表逐字节相同就不发（静止 ≠ 在动）。 */');
  L.push('        touchEvent: function (ev, rect, iw, ih, phase) {');
  L.push('          if (!on || !ev) return null;');
  L.push('          var ph = (phase === "start" || phase === "move" || phase === "end" || phase === "cancel") ? phase : "";');
  L.push('          if (!ph) return null;');
  L.push('          function conv(list) {');
  L.push('            var out = [], n = Math.min(num(list && list.length, 0), TOUCH_LIMIT);');
  L.push('            for (var i = 0; i < n; i++) {');
  L.push('              var t = list[i], p = point(t, rect, iw, ih);');
  L.push('              if (!p) continue;   /* 坐标坏掉的触点丢掉，不污染整条消息 */');
  L.push('              out.push({ id: num(t && t.identifier, 0) | 0, x: p.x, y: p.y, inside: p.inside,');
  L.push('                rx: num(t && t.radiusX, 1) || 1, ry: num(t && t.radiusY, 1) || 1,');
  L.push('                force: Math.max(0, Math.min(1, num(t && t.force, 0.5))) });');
  L.push('            }');
  L.push('            return out;');
  L.push('          }');
  L.push('          var touches = conv(ev.touches), changed = conv(ev.changedTouches);');
  L.push('          if (!touches.length && !changed.length && ph !== "end" && ph !== "cancel") return null;');
  L.push('          /* 去重按**坐标签名**（与 phase 无关）：start 之后坐标没动的 touchmove 一律不发 */');
  L.push('          var sig = JSON.stringify(changed) + "|" + JSON.stringify(touches);');
  L.push('          var same = sig === touchSig;');
  L.push('          touchSig = sig;');
  L.push('          if (ph === "move" && same) return null;');
  L.push('          var primary = changed[0] || touches[0] || null;');
  L.push('          last = nowMs();');
  L.push('          return { mpw: MSG, op: "touch", phase: ph,');
  L.push('            x: primary ? primary.x : null, y: primary ? primary.y : null, inside: primary ? primary.inside : false,');
  L.push('            touches: touches, changed: changed, count: touches.length, mods: mods(ev),');
  L.push('            button: ph === "move" ? -1 : 0, buttons: touches.length ? BTN : 0, pointerType: "touch" };');
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

/** 协议 phase → 帧内 DOM 事件类型（反向映射由 WEB_TOUCH_PHASE_OF 给出，测试断言两者互为逆） */
export const WEB_TOUCH_TYPE_OF = {
  start: 'touchstart',
  move: 'touchmove',
  end: 'touchend',
  cancel: 'touchcancel',
};

/** 帧内触摸代理的版本（进诊断；帧内自检用 `window.__mpwTouchAgentVersion` 上报）。 */
export const WEB_TOUCH_AGENT_VERSION = 1;

/**
 * 帧内**触摸代理**源码（自执行 IIFE；①WP-2 自写，上游无照抄对象 —— `oneincase/webwallgl` 的
 * `renderer/src/web.ts` 与 `web-shim.js` 全文 0 处 `touch*`）。
 *
 * 职责：把父页 `op:'touch'` 消息还原成**真** TouchEvent 并在隐式捕获目标上派发。
 * 三条与浏览器对齐的语义（写错就是"看着有事件、作者却不响应"）：
 *   ① **隐式捕获**：`touchmove/touchend` 必须派发到 `touchstart` 时命中的那个元素 ——
 *      滑块类控件（element-plus 的 `Vt(H,"touchmove",…)`）靠这条才能在手指移出控件后继续拖动；
 *   ② `touches`（屏上全部）/ `changedTouches`（本条消息涉及）/ `targetTouches`（同目标）三个列表
 *      都必须是**可索引 + 有 `.item(i)` + 有 `.length`** 的类数组（语料实测：spine 用 `.item(0)`，
 *      pixi 用 `[i]` + `.length`，两个都得支持）；
 *   ③ 事件必须 `cancelable`：语料里作者普遍 `ev.preventDefault()`（spine 的 autoPreventDefault、
 *      element-plus 滑块），不可取消会让作者以为"手势没生效"。
 *
 * 为什么需要**三级构造阶梯**：`new TouchEvent(...)` 在 Chromium 里是 `Illegal constructor`（抛），
 * 而 `document.createEvent("TouchEvent")` + `initTouchEvent` 在老 WebKit/Blink 是**位置参数**签名、
 * 新 Blink 只剩**字典**签名（且字典签名不带 type）—— 三级依次尝试，任一级成功即用：
 *   1) `new W.TouchEvent(type, init)`（Firefox/Safari，产出真 TouchEvent）
 *   2) `D.createEvent("TouchEvent")` → `initTouchEvent(位置签名)` →（失败再试）`initTouchEvent(字典)`，
 *      并校验 `changedTouches.length` 真的进去了；type 不对就用自有属性补上（产出真 TouchEvent
 *      ⇒ 帧内 `e instanceof TouchEvent` 为真，pixi 一类按 `instanceof` 分流的库能走触摸分支）
 *   3) 普通 `Event` + 自有属性补 `touches/targetTouches/changedTouches`（任何引擎都能用；
 *      `instanceof TouchEvent` 为假 —— 这是**已知保真度边界**，写在 docs/WEB-WALLPAPER.md §11）
 * 三级都由 tools/web-interaction-test.mjs 用假 DOM 分别驱动断言（无浏览器、无网络）。
 *
 * 安全边界：本段只在**本插件路由的文档**里被求值（宿主注入 shim 的同一处），只读消息、只派发合成事件；
 * 不碰父页（不透明源下也碰不到）、不 eval 任何消息内容、不开新通道、不写存储。
 * 不抛异常：整段 try/catch，绝不让作者脚本/宿主消息把 shim 的控制面带崩。
 */
function buildTouchFrameSource() {
  const L = [];
  L.push('(function () {');
  L.push('    "use strict";');
  L.push('    var W = typeof window !== "undefined" ? window : null;');
  L.push('    if (!W || W.__mpwTouchAgentVersion) return;   /* 幂等：重复注入只装一次 */');
  L.push('    var D = W.document || null;');
  L.push('    if (!D) return;');
  L.push('    W.__mpwTouchAgentVersion = ' + WEB_TOUCH_AGENT_VERSION + ';');
  L.push('    var TYPE_OF = ' + JSON.stringify({
    start: WEB_TOUCH_TYPE_OF.start, move: WEB_TOUCH_TYPE_OF.move, end: WEB_TOUCH_TYPE_OF.end, cancel: WEB_TOUCH_TYPE_OF.cancel,
  }) + ';');
  L.push('    var targets = {}, lastTarget = null;');
  L.push('    function num(v, d) { var n = Number(v); return isFinite(n) ? n : d; }');
  L.push('    function isArr(a) { return a && typeof a === "object" && typeof a.length === "number"; }');
  L.push('    function root() { try { return (D.body || D.documentElement) || null } catch (e) { return null } }');
  L.push('    function hit(x, y) {');
  L.push('      try { if (D.elementFromPoint && isFinite(x) && isFinite(y)) { var el = D.elementFromPoint(x, y); if (el) return el; } } catch (e) {}');
  L.push('      return root();');
  L.push('    }');
  L.push('    /* 自有属性写入：真实事件对象上的 clientX/type 等可能是原型 getter（只读），必须用 defineProperty */');
  L.push('    function define(obj, key, value) {');
  L.push('      try { Object.defineProperty(obj, key, { configurable: true, get: function () { return value; } }); return true; }');
  L.push('      catch (e) { try { obj[key] = value; return true } catch (e2) { return false } }');
  L.push('    }');
  L.push('    function modFlags(m) { return { ctrlKey: (m & 1) !== 0, shiftKey: (m & 2) !== 0, altKey: (m & 4) !== 0, metaKey: (m & 8) !== 0 }; }');
  L.push('    /* 类数组：可索引 + length + item(i)（spine 用 item()，pixi 用 [i]） */');
  L.push('    function mkList(arr) {');
  L.push('      var out = []; for (var i = 0; i < arr.length; i++) out.push(arr[i]);');
  L.push('      define(out, "item", function (i) { return out[i] === undefined ? null : out[i] });');
  L.push('      return out;');
  L.push('    }');
  L.push('    var scrollX = 0, scrollY = 0;');
  L.push('    function readScroll() {');
  L.push('      try { scrollX = num(W.scrollX, num(D.documentElement && D.documentElement.scrollLeft, 0)); scrollY = num(W.scrollY, num(D.documentElement && D.documentElement.scrollTop, 0)); } catch (e) { scrollX = 0; scrollY = 0; }');
  L.push('    }');
  L.push('    function mkTouch(p, target) {');
  L.push('      var id = num(p && p.id, 0) | 0, x = num(p && p.x, 0), y = num(p && p.y, 0);');
  L.push('      var init = { identifier: id, target: target, clientX: x, clientY: y,');
  L.push('        screenX: x + num(W.screenX, 0), screenY: y + num(W.screenY, 0), pageX: x + scrollX, pageY: y + scrollY,');
  L.push('        radiusX: num(p && p.rx, 1) || 1, radiusY: num(p && p.ry, 1) || 1, rotationAngle: 0, force: num(p && p.force, 0.5) };');
  L.push('      if (typeof W.Touch === "function") {');
  L.push('        try { var t = new W.Touch(init); if (t && num(t.identifier, NaN) === id && isFinite(num(t.clientX, NaN))) return t; } catch (e) {}');
  L.push('      }');
  L.push('      return init;   /* 无 Touch 构造器：退化成普通对象（梯级 3 仍可用；梯级 2 会自己失败落到 3） */');
  L.push('    }');
  L.push('    function mkTouchEvent(type, touches, targetTouches, changed, cx, cy) {');
  L.push('      var mf = modFlags(stateMods);');
  L.push('      var init = { bubbles: true, cancelable: true, composed: true, view: W,');
  L.push('        touches: touches, targetTouches: targetTouches, changedTouches: changed,');
  L.push('        ctrlKey: mf.ctrlKey, shiftKey: mf.shiftKey, altKey: mf.altKey, metaKey: mf.metaKey };');
  L.push('      var ev = null;');
  L.push('      /* 梯级 1：标准构造器 */');
  L.push('      try { if (typeof W.TouchEvent === "function") ev = new W.TouchEvent(type, init); } catch (e) { ev = null; }');
  L.push('      if (ev && ev.type !== type) ev = null;   /* 构造器没吃 type（未初始化对象）⇒ 弃用 */');
  L.push('      /* 梯级 2：createEvent + initTouchEvent（Chromium 走这条） */');
  L.push('      if (!ev) {');
  L.push('        var te = null;');
  L.push('        try { te = D.createEvent("TouchEvent"); } catch (e) { te = null; }');
  L.push('        if (te && typeof te.initTouchEvent === "function") {');
  L.push('          try {');
  L.push('            te.initTouchEvent(type, true, true, W, 0, cx + num(W.screenX, 0), cy + num(W.screenY, 0), cx, cy,');
  L.push('              mf.ctrlKey, mf.altKey, mf.shiftKey, mf.metaKey, touches, targetTouches, changed, 1, 0);');
  L.push('          } catch (e) {');
  L.push('            try { te.initTouchEvent({ touches: touches, targetTouches: targetTouches, changedTouches: changed }); } catch (e2) {}');
  L.push('          }');
  L.push('          if (te.type !== type) define(te, "type", type);   /* 字典签名不带 type */');
  L.push('          if (te.changedTouches && te.changedTouches.length === changed.length) ev = te;');
  L.push('        }');
  L.push('      }');
  L.push('      /* 梯级 3：普通 Event + 补列表（最广兼容；instanceof TouchEvent 为假） */');
  L.push('      if (!ev) {');
  L.push('        try { ev = D.createEvent("Event"); ev.initEvent(type, true, true); } catch (e) { ev = null; }');
  L.push('        if (!ev) { try { ev = new W.Event(type, { bubbles: true, cancelable: true }); } catch (e) { ev = null; } }');
  L.push('      }');
  L.push('      if (!ev) return null;');
  L.push('      if (!ev.touches) define(ev, "touches", touches);');
  L.push('      if (!ev.targetTouches) define(ev, "targetTouches", targetTouches);');
  L.push('      if (!ev.changedTouches) define(ev, "changedTouches", changed);');
  L.push('      if (!isFinite(cx)) { cx = 0; cy = 0; }');
  L.push('      define(ev, "clientX", cx); define(ev, "clientY", cy);');
  L.push('      define(ev, "pageX", cx + scrollX); define(ev, "pageY", cy + scrollY);');
  L.push('      define(ev, "screenX", cx + num(W.screenX, 0)); define(ev, "screenY", cy + num(W.screenY, 0));');
  L.push('      return ev;');
  L.push('    }');
  L.push('    /* 目标：touchstart 记下命中元素（隐式捕获），move/end/cancel 沿用；没有记录时现算 */');
  L.push('    function targetOf(p, type) {');
  L.push('      var id = num(p && p.id, 0) | 0;');
  L.push('      var t = targets[id] || null;');
  L.push('      if (!t) { t = hit(num(p && p.x, NaN), num(p && p.y, NaN)); if (type === TYPE_OF.start) targets[id] = t; }');
  L.push('      return t || root();');
  L.push('    }');
  L.push('    var stateMods = 0;');
  L.push('    /** 父页 op="touch" 的唯一入口。@returns {boolean} 是否真的派发了一个 TouchEvent */');
  L.push('    function push(m) {');
  L.push('      try {');
  L.push('        if (!m || typeof m !== "object") return false;');
  L.push('        var type = TYPE_OF[String(m.phase || "")];');
  L.push('        if (!type) return false;');
  L.push('        stateMods = num(m.mods, 0) | 0;');
  L.push('        readScroll();');
  L.push('        var changedPts = isArr(m.changed) ? m.changed : [];');
  L.push('        var touchPts = isArr(m.touches) ? m.touches : [];');
  L.push('        var isUp = (type === TYPE_OF.end || type === TYPE_OF.cancel);');
  L.push('        if (!changedPts.length && !touchPts.length && !isUp) return false;');
  L.push('        var i, p, tl = [], cl = [], primary = null;');
  L.push('        for (i = 0; i < touchPts.length; i++) { p = touchPts[i]; tl.push(mkTouch(p, targetOf(p, type))); }');
  L.push('        for (i = 0; i < changedPts.length; i++) {');
  L.push('          p = changedPts[i];');
  L.push('          var tg = targetOf(p, type);');
  L.push('          cl.push(mkTouch(p, tg));');
  L.push('          if (!primary) primary = tg;');
  L.push('        }');
  L.push('        if (!primary) primary = lastTarget || root();');
  L.push('        if (!primary || typeof primary.dispatchEvent !== "function") return false;');
  L.push('        var tt = [], j;');
  L.push('        for (j = 0; j < tl.length; j++) if (tl[j].target === primary) tt.push(tl[j]);');
  L.push('        if (!tt.length) tt = tl;   /* 同目标为空时退回全部：宁可多给也不让作者拿到空 targetTouches */');
  L.push('        var cx = num(m.x, NaN), cy = num(m.y, NaN);');
  L.push('        if (!isFinite(cx) && cl.length) { cx = num(cl[0].clientX, 0); cy = num(cl[0].clientY, 0); }');
  L.push('        var ev = mkTouchEvent(type, mkList(tl), mkList(tt), mkList(cl), cx, cy);');
  L.push('        if (!ev) return false;');
  L.push('        lastTarget = primary;');
  L.push('        if (isUp) for (i = 0; i < changedPts.length; i++) { try { delete targets[num(changedPts[i] && changedPts[i].id, 0) | 0] } catch (e) {} }');
  L.push('        primary.dispatchEvent(ev);   /* 作者 listener 抛错由浏览器上抛 → 帧内 shim 的 error 通道上报父页（不在这里吞） */');
  L.push('        return true;');
  L.push('      } catch (e) { return false; }   /* 代理不许把异常抛回 shim 控制面 */');
  L.push('    }');
  L.push('    W.__mpwTouchPush = push;');
  L.push('    W.__mpwTouchAgentReset = function () { targets = {}; lastTarget = null; return true; };');
  L.push('  })();');
  return L.join('\n');
}

/** 帧内触摸代理源码（宿主在注入 WE shim 的**同一处**追加求值一次即可，见 THIRD-PARTY/文档台账） */
export const WEB_TOUCH_FRAME_SOURCE = buildTouchFrameSource();
