/* ══════════════════════════════════════════════════════════════════════════════
   lib/now-playing-math.js —— "Now playing" 组件的**纯数学**（零 DOM、零 React）

   ①(NP-1 2026-09-19 「now playing 挂载到 dsh 设置上面 …」) 本文件是
   `lib/now-playing.js`（组件）与 `tools/now-playing-test.mjs`（假 DOM 测试）**共用**的
   唯一数学源，也是 `lib/client.js` 生成区的输入之一。

   ── 许可（必须保留） ────────────────────────────────────────────────────────
   这段数学来自 **Bencho** 的 "Now playing" 组件（`Sound.tsx` + 其随附样式表），
   上游作者 Bencho，许可 **MIT**（bencho.dev/licence）。用户已确认该来源与许可。
   移植方式：**逐行移植、注释原文保留**（用户原话："它们解释了这些数字为什么是这个值，
   也是这份代码值得照抄而不是重写的主要原因"）。归属与台账见 `THIRD-PARTY.md` §13（本仓）
   与 `../docs/COPYING-RULES.md` §4 台账（工作区根）。
   ⚠ 本文件**不含**任何来自 `we-scene-demo`（GPL-3.0-or-later）的代码：那条方向是
   "GPL 永不进插件"（`../docs/COPYING-RULES.md` §2.2）。

   ── 为什么数学要单独一个文件 ────────────────────────────────────────────────
   原组件的每一个位置/尺寸/圆角/字号都是**算出来的**（两个端点之间 `mix()`），
   样式表里没有一条 transition 管这些（见下方 "ONE NUMBER IS THE STATE"）。
   ⇒ 要验证它，必须先能**脱离 DOM** 调用这些函数。这就是本文件存在的全部理由：
   它没有 `document`、没有 `window`、没有 `react`，因此可以被 Node 直接 require。

   导出面见文件末尾 `module.exports`。
   ══════════════════════════════════════════════════════════════════════════════ */
"use strict";

/* ══ Sound ════════════════════════════════════════════════
   A now-playing pill that opens into a player.

   ONE NUMBER IS THE STATE. There is a single spring running
   0 → 100, and every position, size, radius and type size
   below is read off it. Nothing has a transition of its own
   and nothing is on a clock — which is the whole reason the
   transformation reads as one object changing rather than as
   several elements that were told to move at the same time.
   With eight CSS transitions there are eight chances for one
   of them to arrive early; with one spring there are none.

   THE COVER IS THE HINGE. It is the only thing on the pill
   big enough to be recognised, so it is the thing the eye
   tracks, and it never disappears or crossfades — it travels
   from a 44px square at the left of a bar to a 220px square
   at the top of a card. Everything else takes its lead from
   where the cover went.

   The width never changes. A pill that also got wider would
   be growing in two directions at once, and the second one
   adds nothing: what a player does when it opens is show you
   more, downward. Holding the width still also means the
   right-hand controls only have to travel, not resize and
   travel — they slide in from the end of the bar and settle
   into a row under the art. */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mix = (a, b, t) => a + (b - a) * t;

/* ── eased, NOT sprung ─────────────────────────────────────
   The bench's shared useSpring is the wrong tool for this one
   thing, and the reason is the corner. A spring past its
   target takes every value derived from it along — measured
   at the tuned default it reached 492 against a target of
   404, and the radius went with it, dipping under 26 and
   coming back. That is a wobble, not a bounce, and it is the
   same mistake the create menu made and had removed.

   So: a curve that is quick off the mark and lands without
   ever passing the number it is going to. Quart-out is
   cubic-bezier(0.22, 1, 0.36, 1) in all but name, which is
   what every other one-shot morph on this bench uses.

   It reads its start from wherever it currently IS, so
   pressing again mid-flight turns the object around rather
   than snapping it to an end it never reached. */
const BASE = 460;

const QUART = (t) => 1 - (1 - t) ** 4;
/* the swell's clock — see the note where it is used */
const FLAT = (t) => t;
/* in AND out, for the one thing here that is a round trip
   between two shapes rather than an arrival at one */
const SWING = (t) =>
  t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;

/* One width for both states, and the frame's width too. */
const W = 260;
/* the bar, and the card. The frame is sized to the CARD —
   the wall fits a component by its bounding box, so a frame
   that grew would rescale the whole card mid-morph. */
/* 78, not 70. The track needs a band of its own at the foot —
   at 70 it cleared the sleeve by seven pixels, which reads as
   crowding it rather than as a line of its own. */
const SHUT = 78;

/* ── the card is the bar, grown ────────────────────────────
   It used to put a 232px sleeve across the top with the words
   underneath — a different LAYOUT at the far end of the morph,
   which meant the words had to travel from beside the cover to
   below it while the cover itself moved and quadrupled. Three
   things rearranging at once is a transition you watch rather
   than an object you opened.

   So the arrangement is the same at both ends: sleeve left,
   words beside it, and the only thing that MOVES between the
   two is the transport — from the end of the row down to the
   middle, which is the one change worth reading. Everything
   else simply gets bigger.

   398 to 218 as a side effect, and that is not a small one:
   the wall fits a component by its bounding box, so the frame
   is what decided how small the bar was drawn. At 260x398 the
   longest side was the height and everything rendered at 0.64.
   At 260x218 the width wins and it draws at full size.

   Its HEIGHT is declared under the stack it falls out of. */

/* ── ONE margin, both states ───────────────────────────────
   Not one per state. It was 10 on the bar and 16 on the card,
   which meant the sleeve, the track and the transport all
   slid inward as the thing opened — a fourth motion nobody
   asked for, on top of the three that are the point. The
   object grows; its frame does not move.

   Everything answers to it: the sleeve's inset, the rail's
   inset, where the transport row ends, and the room under it.
   These used to be four numbers agreeing by luck — 8 here, 10
   there, 16 for the vertical — which is also why nothing
   looked tight.

   The sleeve is square, so one number is its width and its
   height at each end — and on the card it is the number the
   whole stack below is measured from. */
const PAD = 10;
const ART = { s: [40, 64] };

/* ── the two corners, and they are CONCENTRIC ──────────────
   The box's radius is the sleeve's plus the margin between
   them. That is not a preference, it is what makes a corner
   hug what is inside it: two curves offset by a constant
   distance stay parallel, and any other pair pinches at 45°.

   32 was picked by eye and it was 6 too many — the card's
   curve swept wider than the sleeve's and left the artwork's
   top-left sitting inside a bend that had already turned.
   26 = 16 + 10 hugs it, and the bar's 20 = 10 + 10 does the
   same at its own size.

   ── AND THAT IS WHY IT CAN BE A KNOB AGAIN ────────────────
   It was a control once and it was removed, because what it
   set was the BOX's corner on its own: turn it down and the
   card squared off around a sleeve that had not, turn it up
   and the card's curve swept wide of the picture inside it.
   Every setting but one was wrong, so the honest fix was to
   delete the knob and keep the one.

   What the knob sets now is the SLEEVE, and the box is
   derived from it — `sleeve + PAD`, the same rule as before.
   So the two corners stay concentric at every value, and
   there is no setting that pinches. The knob moves a
   relationship rather than one of its two halves.

   It runs to 32 and stops there because that is where the
   64px sleeve becomes a circle; there is nothing past it but
   the same shape with a bigger number. The bar's sleeve
   scales by the ratio of the two squares, so it reaches its
   own circle at exactly the same setting. Square at one end
   of the slider, pill at the other, and the default sits
   where it always was. */
const CORNER = 16;
const CORNER_MAX = 32;

/* ── the card's stack, measured from the sleeve down ───────
   Each gap is the distance from the thing above it, and the
   card's HEIGHT falls out of the sum rather than being a
   number somebody kept in step by hand. Change the sleeve and
   the rail, the times, the transport and the foot all follow.

   The bar needs none of this: it is one row and a track, and
   both are placed off the same margin. */
const RAIL_GAP = 22;
const CLOCK_GAP = 8;   /* also .snd-bar's own gap */
const OPS_GAP = 16;
const RAIL_H = 3;
const CLOCK_H = 10;
const LEAD = 46;       /* the play button, opened */

const RAIL_Y = PAD + ART.s[1] + RAIL_GAP;
const OPS_Y = RAIL_Y + RAIL_H + CLOCK_GAP + CLOCK_H + OPS_GAP + LEAD / 2;
/* the transport's own bottom, and one more margin under it */
const OPEN = Math.round(OPS_Y + LEAD / 2 + PAD);

const TOTAL = 214;

/* ── the play mark is DRAWN, not swapped ───────────────────
   Two icons exchanged is a cut, however short you make the
   crossfade, and a transport button is the one control here
   you press more than once — a cut you see forty times is the
   thing you end up looking at.

   So both marks are the SAME two quadrilaterals, and the
   difference between them is where eight points are. The
   pause is a pair of bars; the play is that pair with the
   inner edges pulled to the middle and collapsed to a point,
   which is a triangle split down its own axis. Nothing
   appears and nothing leaves — the shapes are continuous the
   whole way, so there is no frame where the button is
   ambiguous about what it does.

   The points are lucide's own, so it sits at the same weight
   as the skip glyphs beside it: bars at x 6..10 and 14..18,
   a triangle from 6.5 to 20, stroked 2 with a round join,
   which is where the softened corners come from.

   Wound the same way in both — top-left, top-right,
   bottom-right, bottom-left — or the halves would turn
   inside out on the way across. The play's right half is a
   triangle written as a quad with its two right points on
   top of each other. */
const PAUSE_L = [6, 4, 10, 4, 10, 20, 6, 20];
const PLAY_L = [6.5, 4, 13.25, 8, 13.25, 16, 6.5, 20];
const PAUSE_R = [14, 4, 18, 4, 18, 20, 14, 20];
const PLAY_R = [13.25, 8, 20, 12, 20, 12, 13.25, 16];

const quad = (a, b, t) => {
  let d = "";
  for (let i = 0; i < 8; i += 2)
    d += `${i ? "L" : "M"}${mix(a[i], b[i], t).toFixed(2)} ${mix(
      a[i + 1],
      b[i + 1],
      t,
    ).toFixed(2)}`;
  return `${d}Z`;
};

/* the heart's box, and the room the words give up for it */
const LIKE = 30;

const clock = (s) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/* ── inlined from ./motion ──────────────────────── */
/* ── elastic, as numbers a person can hold ─────────────────
   Several blocks here are the same idea in different clothes:
   something travels, stretches on the way, and overshoots
   when it lands. Their character lives in a duration and in
   one control point of a bezier — which is exactly the kind
   of thing nobody should have to name in order to tune.

   So the outside of every elastic knob is 0..100 and the
   inside is real units, and **50 is always what the component
   was already tuned to**. Turn every knob on the bench to the
   middle and nothing has changed. That is what makes these
   safe to expose: the default is not a number somebody has to
   remember, it is the middle of the slider.

   Both ends have to be shippable, which is the constraint
   that actually shapes these curves. The ranges below stop
   where the effect stops being the thing it is — a bar that
   moves in 40ms still reads as a bar snapping to a slot; one
   that moves in 20ms reads as broken. */

/* How long it takes, slower to faster, as a multiplier on
   whatever the component's own tuned duration is. 0 is a
   little over half again as slow, 100 is two and a half times
   as fast, 50 is exactly 1. */
const rate = (speed) => 1.6 - (speed / 100) * 1.2;

/* How hard it lands.

   In a cubic-bezier the second control point's y is the whole
   of an overshoot: at 1 the thing stops dead on its target,
   and past 1 it travels beyond and comes back. Everything
   else in the curve is the approach and stays put.

   `tuned` is the y this component was drawn with, so 50
   returns it unchanged and the slider is centred on the
   design rather than on some shared average. */
const overshoot = (bounce, tuned) =>
  Number((1 + (bounce / 100) * (tuned - 1) * 2).toFixed(3));

/* the same, ready to drop into a transition */
const curve = (bounce, tuned, x1 = 0.28, x2 = 0.36) =>
  `cubic-bezier(${x1}, ${overshoot(bounce, tuned)}, ${x2}, 1)`;

/* ── inlined from ./spring ──────────────────────── */
/* ── one spring, for everything that settles ───────────────
   The maths was already on this bench twice, copied by hand:
   Humidity's wheel and Brightness's column both accumulate
   velocity toward a target, damp it, and snap when both the
   delta and the velocity fall under 0.02. Two copies is a
   coincidence; five would be a policy, so it comes out here
   before the elastic blocks are written against it.

   The two shipped copies are deliberately NOT refactored onto
   this. They work, they are tuned, and rewriting the innards
   of two live components to prove a point about duplication
   is how a good afternoon becomes a bad one. This is the one
   new code uses.

   Frames, not milliseconds. `dt` is expressed in sixtieths of
   a second and the damping is RAISED to it rather than
   multiplied by it, so a dropped frame decays the same amount
   of energy as the two frames it replaced. Multiplying is the
   version that makes a spring behave differently on a busy
   page, which is the hardest kind of bug to see.

   The loop parks itself the moment the value has settled.
   CLAUDE.md is not complimentary about the one permanent
   requestAnimationFrame already on this bench and there is no
   case for five more. */

/* 0..100 into the two numbers a spring actually has.

   50 is what Humidity and Brightness were tuned at, which is
   the rule every elastic knob on this bench follows — see
   lab/motion. Turn the panel to the middle and nothing has
   changed.

   Both ends have to be usable, which is what fixes the range:
   at 0 it is slow and heavy and still arrives, at 100 it is
   quick with a visible overshoot, and nowhere in between does
   it ring for longer than it takes to read. */
/* The pair is chosen by DAMPING RATIO and then written back
   as stiffness and decay, because the ratio is the thing a
   person is actually setting and the two numbers on their own
   do not say what they add up to.

     zeta = -ln(d) / (2 * sqrt(k))

   The first version of this ran 0.06..0.26 stiffness against
   0.93..0.74 decay, which reads as a sensible spread and is
   not one: it puts zeta between 0.15 and 0.16 across the
   WHOLE range, so every setting overshot by about sixty per
   cent and the knob only changed how fast it did it. Pull's
   return went 130px past its own resting position and lifted
   the content off the top of the card.

    0   → zeta ~0.85, heavy, arrives without a ring
    50  → zeta ~0.41, near where Humidity and Brightness sit
    100 → zeta ~0.20, lively, two visible rebounds

   Both ends shippable, which is the constraint that fixed the
   numbers rather than taste. */
const springOf = (tune) => ({
  /* stiffness: how hard it is pulled toward the target */
  k: 0.08 + (tune / 100) * 0.16,
  /* decay, per frame: how much of the velocity survives */
  d: 0.62 + (tune / 100) * 0.2,
});

/* The snap threshold is absolute, so a caller works in pixels
   or in 0..100 — a spring driven over 0..1 would be "settled"
   before it had visibly moved. ①(NP-1) 原 TSX 把它写在
   useSpring 的注释里；本文件把这条阈值提成具名常量，
   因为 useSpring 本身留在组件侧（它碰 React），
   而"多大算停"是纯数字判据，属于本文件。 */
const SPRING_SNAP = 0.02;

/* ── 缓动 + 形状：从端点求值（组件每帧调用，纯函数） ─────────────────────────
   下面这些在原 TSX 里是写在 `Sound()` 组件体内的 `const`（因为要读 props），
   但每一个都只依赖入参、不依赖 React 状态 ⇒ 提到本文件后组件只剩"读值 + 写 style"。
   ①(NP-1) 抽出的判据：函数体里不出现 `useState/useRef/window/document`。 */

/** 组件自己的时长：BASE 460ms × morph(0..100) 的倍率。 */
const durationOf = (morph) => BASE * rate(clamp(morph, 0, 100));

/* the sleeve's corner at each end, and the box's from it.
   The bar's sleeve is the smaller square, so it takes the
   same fraction of its own side — a 16 on a 64 and a 10 on
   a 40 are the same corner at two sizes. */
/** 两个端点上的封面圆角 [bar, card]。 */
const artRadius = (corner) => {
  const cr = clamp(corner, 0, CORNER_MAX);
  return [(cr * ART.s[0]) / ART.s[1], cr];
};

/* ── the offset FADES IN, it is not a constant ───────────
   `outer = inner + margin` is the right rule for a corner
   hugging what is inside it, and it was applied flat: ten
   pixels of offset at every setting, including zero. Which
   meant the bottom of the slider drew a perfectly sharp
   picture inside a card that was still visibly rounded —
   geometrically concentric and, to look at, two different
   decisions in the same object. The rule was answering a
   question nobody had asked there: at radius zero there is
   no curve to stay parallel to.

   So the offset is scaled by how far up the slider you are,
   and reaches its full ten by the default. Below that the
   two corners converge until they are both square together;
   above it the rule takes over, which is where it earns its
   keep — a mismatch at 32 pinches, a mismatch at 2 is just
   a card that did not follow.

   The default and the top of the range are untouched: at
   16 the offset is exactly 10 and at 32 it is capped there,
   so the shipping shape is the shape it always was. */
const cornerOffset = (corner) => PAD * Math.min(1, clamp(corner, 0, CORNER_MAX) / CORNER);

/** 盒子（卡片）的圆角两端点 = 封面圆角 + 渐入的间距（同心圆角规则）。 */
const boxRadius = (corner) => {
  const artR = artRadius(corner);
  const off = cornerOffset(corner);
  return [artR[0] + off, artR[1] + off];
};

/* ── the swell, and why it is a SECOND number ────────────
   The bench had this as a spring once and it was removed,
   for the reason written at the top of this file: a value
   past its target takes everything derived from it along,
   and what is derived here is the corner. The radius dipped
   under its own end value and came back — the box arrived,
   and then its corner arrived. That is a wobble.

   So the bounce is not put back into `p`. `p` stays
   monotonic and the composition stays internally consistent
   at every frame — the sleeve, the box and the margin
   between them are always in the ratio that makes the
   corners concentric.

   What bounces is the whole object, uniformly. A scale
   takes the box, the sleeve, the corners and the type
   together, so nothing can get out of step with anything
   else: it is the same picture, briefly larger. All the
   life, none of the wobble.

   It rides its own LINEAR clock rather than `p`, because
   `p` is quart-out and near its end for most of the move —
   a swell read off it would spike in the first two frames
   and be flat for the rest. And the peak is pushed late
   (^1.5 puts it at 0.63) so the object gathers on the way
   out and releases as it lands, which is what reads as a
   bounce rather than as a pulse.

   Zero at BOTH ends by construction, so it costs the
   resting shape nothing — sin(0) and sin(π) are the same
   number.

   ── ON THE CLOSE ONLY ────────────────────────────────────
   It grew on the way out too, and that was one motion too
   many. Opening already HAS its event: the box goes from 78
   to 189 and that is the whole thing you are meant to
   watch. A scale on top of it is a second size change
   running at the same time in the same direction, and two
   of those do not add up to more life — they read as the
   card being unsure how big it is.

   Closing is the opposite problem. The card collapses into
   a bar and most of it simply stops existing, so there is
   nothing to watch except the disappearance. The dip gives
   it a gather to go with it — the object pulls in on itself
   before it lands — and because it is subtractive it is
   working WITH the shrink rather than against it.

   An object coming towards you and one folding away are not
   the same move run backwards. */
const swellOf = (u) => Math.sin(Math.PI * clamp(u, 0, 1) ** 1.5);
/** 打开时不动（1），合上时整体缩一点点（1 − 0.035·swell）。 */
const zoomOf = (open, swell) => (open ? 1 : 1 - 0.035 * swell);

/* ── the goo ─────────────────────────────────────────────
   Zero at both ends and one in the middle, so everything
   below is a bulge on the way rather than a difference
   between the two states — press twice and it lands on
   exactly what it started as.

   Three things ride it, and they are all the same idea:
   the mark squashes across as it stretches up, the two
   halves lean into each other until they touch, and the
   whole thing tips a few degrees and comes back level. A
   shape that changes size without ever changing volume is
   what makes something read as soft rather than as
   redrawn. The tilt swaps sign with the direction, so
   pausing is not just playing run backwards. */
const gooOf = (t) => Math.sin(clamp(t, 0, 1) * Math.PI);
/** 两半互相靠拢的距离（px）。 */
const gooPull = (goo) => 1.6 * goo;
/** 整块倾斜的度数（带方向：暂停与播放不是同一条反向动画）。 */
const gooTip = (playing, goo) => (playing ? -9 : 9) * goo;
/** 挤压：横向压扁 + 纵向拉高（体积感）。 */
const gooScale = (goo) => [1 - 0.13 * goo, 1 + 0.11 * goo];

/* ── 从进度 p（0 关 1 开）读出的几何 ──────────────────────────────────────────
   组件里 "Everything below is derived, never stored"：
   下面每一个都只吃 p，不持有状态。 */

/** 封面的边长（bar 40 → card 64）。 */
const artSize = (p) => mix(ART.s[0], ART.s[1], p);
/** 封面位置：两个端点都在同一个 margin 上（所以它只长大、不移动）。 */
const artX = () => PAD;
const artY = () => PAD;

/** 盒子的高度（bar 78 → card OPEN）。宽度永不变化。 */
const boxHeight = (p) => mix(SHUT, OPEN, p);

/* ── the transport, at both ends ─────────────────────────
   All three buttons exist in both states now. Shut they are
   smaller and almost touching — 24, 30, 24 with a single
   pixel between — and the row is pinned to the right so the
   play button lands where a thumb goes without looking.
   Open they spread and the play grows.

   Placed by the row's CENTRE, because the row's own width
   changes: an edge would move even in the frames where the
   middle of it did not. 212 is the box less 8 of margin and
   half of the 80 the row is when shut. */
const transportSide = (p) => mix(24, 34, p);
const transportLead = (p) => mix(30, LEAD, p);
/* 1 was three controls touching, which reads as one object
   with three parts rather than as three things you press */
const transportGap = (p) => mix(5, 14, p);
/* the box, less its margin and half of the 88 the row is
   when shut */
const opsX = (p) => mix(W - PAD - 44, W / 2, p);

/* the type grows with the sleeve rather than on its own */
const titleSize = (p) => mix(13, 15.5, p);
const bylineSize = (p) => mix(11, 12, p);
const opIconSize = (p) => mix(13, 16, p);
const markSize = (p) => mix(14, 18, p);

/* level with the sleeve on the bar, and under everything on
   the card */
/* 360, and it is measured rather than picked: the times sit
   under the rail and the row has to clear them. At 358 with
   the clock at its natural line height the two overlapped by
   7px — the buttons sat BESIDE the numbers rather than under
   them, which only reads as intentional if you never look at
   the left end of the row. */
const opsY = (p) => mix(PAD + ART.s[0] / 2, OPS_Y, p);

/* the deep half of the morph, for the things that only
   exist in the card. Held back to the last 40% so they
   arrive into a shape that has stopped growing rather than
   sliding about inside one that has not. */
const lateOf = (p) => clamp((p - 0.6) / 0.4, 0, 1);

/** 文字块：紧挨封面（两个端点都是），高度 = 封面高度（所以两行字靠盒子居中）。 */
const sayLeft = (p) => mix(PAD + ART.s[0] + 10, PAD + ART.s[1] + 10, p);
/* what is left between the sleeve and the row */
/* what the smaller sleeve gives back */
/* less the heart, which lives in the corner the
   words would otherwise run into. On the bar
   there is no heart and nothing to give up. */
const sayWidth = (p) => mix(94, W - PAD - (PAD + ART.s[1] + 10) - (LIKE + 10), p);

/* ── the track ─────────────────────────────────────
   Only in the card, and it says so by not being
   there: opacity AND height, so it cannot leave a
   gap in the bar that nothing occupies. */
/* ── the track ─────────────────────────────────────
   It is on the bar too, along the foot, edge to edge
   — a bar with no sense of how far through it is is
   missing the one thing a bar is for. Full bleed
   rather than tucked under the words: at 60px tall
   there is no room for a fourth line, and the pill's
   own corner clips the ends for free.

   The TIMES are the part that only belongs to the
   card. They fade with the deep half of the move and
   are clipped by the box until then, so they cost the
   bar no room at all. */
/* OFF the edge on the bar too. It sat flush at the
   foot, which is a different object — a loading
   line belongs to the box's edge, and a track
   belongs to the thing playing. Inset by the same
   margin as everything else, it reads as part of
   the composition rather than as the box's own
   bottom border. */
const barTop = (p) => mix(SHUT - PAD - RAIL_H, RAIL_Y, p);
/** 轨道的左右端点（一个 margin，所以两端永不移动）。 */
const barLeft = () => PAD;
const barWidth = () => W - PAD * 2;
/** 播放进度百分比（0..TOTAL 的时钟 → 0..100）。 */
const runPct = (at) => (clamp(at, 0, TOTAL) / TOTAL) * 100;
/** 剩余时间（负号由组件加，保证两段数字等宽）。 */
const remain = (at) => TOTAL - clamp(at, 0, TOTAL);

/* ── the one thing you press to change shape ───────
   Invisible, and it is the WHOLE bar when shut — the
   track's band at the foot is part of the object, and
   a bar that only answers along the row its sleeve is
   in has a dead third nobody can see the edge of.

   Opened, it is the sleeve and the words only, so a
   player you have opened does not collapse because
   you reached for the title.

   Declared BEFORE the transport on purpose: both are
   positioned, so the later one paints on top, and the
   buttons have to win a press that lands on both. */
const tapLeft = (p) => mix(0, PAD, p);
const tapTop = (p) => mix(0, PAD, p);
const tapWidth = (p) => mix(W, W - PAD * 2, p);
/* every pixel of the bar, and the sleeve's own
   height once it is a card */
const tapHeight = (p) => mix(SHUT, ART.s[1], p);
const tapRadius = (p, corner) => {
  const boxR = boxRadius(corner);
  const artR = artRadius(corner);
  return mix(boxR[0], artR[1], p);
};

/** 心形按钮：只在卡片里（骑 late），左上角固定。 */
const likeLeft = () => W - PAD - LIKE;
const likeTop = () => PAD;
/** 进度条到 TOTAL 就回 0（原 `s >= TOTAL ? 0 : s + 1`）。 */
const tickClock = (s) => (s >= TOTAL ? 0 : s + 1);

module.exports = {
  /* 通用 */
  clamp, mix,
  /* 时钟 / 缓动 */
  BASE, QUART, FLAT, SWING,
  rate, overshoot, curve, springOf, SPRING_SNAP,
  /* 常量（对外可见，供组件与测试引用；原 TSX 里它们是模块级 const） */
  W, SHUT, PAD, ART, CORNER, CORNER_MAX,
  RAIL_GAP, CLOCK_GAP, OPS_GAP, RAIL_H, CLOCK_H, LEAD,
  RAIL_Y, OPS_Y, OPEN, TOTAL, LIKE,
  /* 两个八点四边形 */
  PAUSE_L, PLAY_L, PAUSE_R, PLAY_R, quad,
  /* 时间 */
  clock, tickClock,
  /* 端点/派生形状 */
  durationOf, artRadius, cornerOffset, boxRadius,
  swellOf, zoomOf, gooOf, gooPull, gooTip, gooScale,
  artSize, artX, artY, boxHeight,
  transportSide, transportLead, transportGap, opsX, opsY,
  titleSize, bylineSize, opIconSize, markSize,
  lateOf, sayLeft, sayWidth,
  barTop, barLeft, barWidth, runPct, remain,
  tapLeft, tapTop, tapWidth, tapHeight, tapRadius,
  likeLeft, likeTop,
};
