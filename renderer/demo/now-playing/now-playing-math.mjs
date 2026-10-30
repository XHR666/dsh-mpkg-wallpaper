/* ①(P-138 2026-09-19 移植) now-playing-math.mjs —— NowPlaying 的**纯函数**半边。
   这里只有数字、算式和它们的论证注释：没有 React、没有 DOM、没有 window，
   所以测试可以直接 import 它（tests/now-playing-test.mjs）来断言
   "同心圆角""swell 的两端为 0、峰值在 0.63""QUART(0)=0 / QUART(1)=1"
   这类关系 —— 组件与测试读的是同一份算式，不存在两份会漂移的副本。

   来源：Bencho「Now playing」的 NowPlaying.tsx 顶部（原件里几何常量、
   曲线、弹簧参数换算与它们的长注释都在同一个文件里）。搬运时**只**剥掉
   TypeScript 标注（: number / as const），注释逐字保留 —— 它们解释了这
   些数字为什么是这个值，是这份代码值得照抄而不是重写的主要原因。
   派生量（artRadius / cornerOffset / boxRadius / swell / goo）是原件里
   写在组件体中的内联算式，抽出来只为可断言，算式本身没动。 */

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const mix = (a, b, t) => a + (b - a) * t;

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
export const BASE = 460;

export const QUART = (t) => 1 - (1 - t) ** 4;
/* the swell's clock — see the note where it is used */
export const FLAT = (t) => t;
/* in AND out, for the one thing here that is a round trip
   between two shapes rather than an arrival at one */
export const SWING = (t) =>
  t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;

/* One width for both states, and the frame's width too. */
export const W = 260;
/* the bar, and the card. The frame is sized to the CARD —
   the wall fits a component by its bounding box, so a frame
   that grew would rescale the whole card mid-morph. */
/* 78, not 70. The track needs a band of its own at the foot —
   at 70 it cleared the sleeve by seven pixels, which reads as
   crowding it rather than as a line of its own. */
export const SHUT = 78;
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
export const PAD = 10;
export const ART = { s: [40, 64] };

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
export const CORNER = 16;
export const CORNER_MAX = 32;

/* ── the card's stack, measured from the sleeve down ───────
   Each gap is the distance from the thing above it, and the
   card's HEIGHT falls out of the sum rather than being a
   number somebody kept in step by hand. Change the sleeve and
   the rail, the times, the transport and the foot all follow.

   The bar needs none of this: it is one row and a track, and
   both are placed off the same margin. */
export const RAIL_GAP = 22;
export const CLOCK_GAP = 8;   /* also .snd-bar's own gap */
export const OPS_GAP = 16;
export const RAIL_H = 3;
export const CLOCK_H = 10;
export const LEAD = 46;       /* the play button, opened */

export const RAIL_Y = PAD + ART.s[1] + RAIL_GAP;
export const OPS_Y = RAIL_Y + RAIL_H + CLOCK_GAP + CLOCK_H + OPS_GAP + LEAD / 2;
/* the transport's own bottom, and one more margin under it */
export const OPEN = Math.round(OPS_Y + LEAD / 2 + PAD);

export const TOTAL = 214;

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
export const PAUSE_L = [6, 4, 10, 4, 10, 20, 6, 20];
export const PLAY_L = [6.5, 4, 13.25, 8, 13.25, 16, 6.5, 20];
export const PAUSE_R = [14, 4, 18, 4, 18, 20, 14, 20];
export const PLAY_R = [13.25, 8, 20, 12, 20, 12, 13.25, 16];

export const quad = (a, b, t) => {
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
export const LIKE = 30;

export const clock = (s) =>
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
export const rate = (speed) => 1.6 - (speed / 100) * 1.2;

/* How hard it lands.

   In a cubic-bezier the second control point's y is the whole
   of an overshoot: at 1 the thing stops dead on its target,
   and past 1 it travels beyond and comes back. Everything
   else in the curve is the approach and stays put.

   `tuned` is the y this component was drawn with, so 50
   returns it unchanged and the slider is centred on the
   design rather than on some shared average. */
export const overshoot = (bounce, tuned) =>
  Number((1 + (bounce / 100) * (tuned - 1) * 2).toFixed(3));

/* the same, ready to drop into a transition */
export const curve = (bounce, tuned, x1 = 0.28, x2 = 0.36) =>
  `cubic-bezier(${x1}, ${overshoot(bounce, tuned)}, ${x2}, 1)`;

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
export const springOf = (tune) => ({
  /* stiffness: how hard it is pulled toward the target */
  k: 0.08 + (tune / 100) * 0.16,
  /* decay, per frame: how much of the velocity survives */
  d: 0.62 + (tune / 100) * 0.2,
});

/* ══ ①(P-138 移植) 派生量：原件里它们是 NowPlaying.tsx 组件体里的内联算式 ══
   抽成纯函数只为让"同心""两端为 0""峰值在 0.63"这类关系能被测试直接断言；
   对"为什么是这个数"的论证仍留在组件里那两个原位注释块（artR/boxR 一段、
   swell 一段），这里不再复述以免出现第二份说法。 */

/* 封面的角，两端各一个：bar 的小方块按比例取自己那一档 ——
   "a 16 on a 64 and a 10 on a 40 are the same corner at two sizes"。 */
export const artRadius = (corner) => [(corner * ART.s[0]) / ART.s[1], corner];

/* 盒子的角比封面多出来的 offset，**按滑杆位置淡入**（不是常数）：
   到默认值才满 PAD，往下两端一起变方 —— 见组件里 "the offset FADES IN" 那段。 */
export const cornerOffset = (corner) => PAD * Math.min(1, corner / CORNER);

/* 同心：box = art + off。两条曲线处处等距 ⇒ 45° 不夹紧；任何别的配对都会。 */
export const boxRadius = (corner) => {
  const [x, y] = artRadius(corner);
  const off = cornerOffset(corner);
  return [x + off, y + off];
};

/* 缩放的钟：走 LINEAR，峰值被 ^1.5 推到 u≈0.63（两端为 0，所以静止形状不付代价）。 */
export const swell = (u) => Math.sin(Math.PI * clamp(u, 0, 1) ** 1.5);

/* 播放/暂停记号的那口"软"：两端为 0、中间为 1 —— 按两次落回原样。 */
export const goo = (t) => Math.sin(clamp(t, 0, 1) * Math.PI);

/* ①(P-161 2026-09-19 测试台适配) 进度条命中：把一次指针事件的 clientX 换算成 0..1 的比例。
   纯函数（无 DOM 依赖）⇒ tests/now-playing-test.mjs 可以直接把边界钉住。
   - 传入的 rect 只要有 { left, width }；width ≤ 0 或坐标不是有限数 ⇒ 返回 null（调用方据此"不动作"，
     而不是把进度算成 0 或者 NaN 写进样式）。
   - 结果**钳位**在 0..1：拖动到条外不该给出负进度或 >100%。 */
export function seekRatio(clientX, rect) {
  const x = Number(clientX)
  const left = Number(rect && rect.left)
  const width = Number(rect && rect.width)
  if (!Number.isFinite(x) || !Number.isFinite(left) || !Number.isFinite(width) || width <= 0) return null
  return Math.max(0, Math.min(1, (x - left) / width))
}
