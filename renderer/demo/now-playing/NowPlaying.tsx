import { useEffect, useRef, useState } from "react";
import { Heart, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";

/* ①(P-138 2026-09-19 移植 · Bencho「Now playing」→ 本仓库)
   本文件是原件的移植副本，注释逐字保留。与原件的差异只有四处，逐条写在
   demo/now-playing/README.md：
     ① 导出名 `Sound` → `NowPlaying`（本仓库对外的名字，任务书口径）；
     ② 纯数学与几何常量抽到 ./now-playing-math.mjs —— 原件里它们就在本文件
        顶部；那些数字的论证注释跟着数字一起搬，一条没删；
     ③ COVER 指向本仓库自己的图（原件是 Bencho 不随许可出行的封面）；
     ④ 可选属性 `stroke` 取代 Bencho 的全局 `[data-stroke="on"]`（本项目没有
        那个全局属性）。
   除此之外 `Mark` / `useTween` / `useSpring` / 组件本体一行未改。 */
import {
  ART,
  BASE,
  CORNER,
  CORNER_MAX,
  FLAT,
  LEAD,
  LIKE,
  OPEN,
  OPS_Y,
  PAD,
  PAUSE_L,
  PAUSE_R,
  PLAY_L,
  PLAY_R,
  QUART,
  RAIL_H,
  RAIL_Y,
  SHUT,
  SWING,
  TOTAL,
  W,
  artRadius,
  boxRadius,
  clamp,
  clock,
  goo as gooAt,
  mix,
  quad,
  rate,
  seekRatio,
  springOf,
  swell as swellAt,
} from "./now-playing-math.mjs";


/* COVER was Bencho's own pictures, which are not licensed
   to travel. Point this at yours. */
/* ①(P-138 移植) 指向本仓库自己的图：demo/assets/brand/brand-512.png（512×512，
   ①(P-164) 起换成**仓库所有者提供的**品牌图，随仓库分发；来源说明见 docs/PATCHES.md P-164）。
   路径**相对页面**写，
   所以 /demo/now-playing/ 与 /WEwebLoader/now-playing/ 两个挂载点都成立；
   本仓库不出行任何第三方美术资源，所以这里只能用自家的图 —— 详见
   demo/now-playing/README.md 的「COVER」一节。 */
const COVER: string = "../assets/brand/brand-512.png";

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



function useTween(to: number, ms: number, instant = false, ease = QUART) {
  const [at, setAt] = useState(to);
  const cur = useRef(to);
  const raf = useRef(0);

  useEffect(() => {
    if (instant) {
      cur.current = to;
      setAt(to);
      return;
    }
    const from = cur.current;
    if (from === to) return;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      cur.current = from + (to - from) * ease(t);
      setAt(cur.current);
      raf.current = t < 1 ? requestAnimationFrame(step) : 0;
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
  }, [to, ms, instant, ease]);

  return at;
}

function Mark({
  playing,
  size,
  still,
}: {
  playing: boolean;
  size: number;
  still: boolean;
}) {
  /* 0 is the pause, 1 is the play. Eased both ends, unlike
     the box's own move: this one leaves a shape as well as
     arriving at one, and a curve that only softens the
     landing snaps out of the shape it was. */
  const t = useTween(playing ? 0 : 1, 300, still, SWING);

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
  /* ①(P-138 移植) 算式搬进 ./now-playing-math.mjs 的 goo()，一字未改。 */
  const goo = gooAt(t);
  const pull = 1.6 * goo;
  const tip = (playing ? -9 : 9) * goo;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinejoin="round"
      strokeLinecap="round"
      /* per cent, not pixels: this is the element's own box
         and the box is whatever size the morph is at. */
      style={{
        transformOrigin: "50% 50%",
        transform: `rotate(${tip}deg) scale(${1 - 0.13 * goo}, ${1 + 0.11 * goo})`,
      }}
    >
      <path d={quad(PAUSE_L, PLAY_L, t)} transform={`translate(${pull} 0)`} />
      <path d={quad(PAUSE_R, PLAY_R, t)} transform={`translate(${-pull} 0)`} />
    </svg>
  );
}


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

/* Units matter. The snap threshold is absolute, so a caller
   works in pixels or in 0..100 — a spring driven over 0..1
   would be "settled" before it had visibly moved. */
function useSpring(target: number, tune = 50, instant = false) {
  const [at, setAt] = useState(target);
  const cur = useRef(target);
  const vel = useRef(0);
  const raf = useRef(0);

  useEffect(() => {
    if (instant) {
      cur.current = target;
      vel.current = 0;
      setAt(target);
      return;
    }
    const { k, d } = springOf(tune);
    let prev = 0;
    const tick = (t: number) => {
      const dt = prev ? clamp((t - prev) / 16.67, 0, 2.5) : 1;
      prev = t;
      vel.current += (target - cur.current) * k * dt;
      vel.current *= Math.pow(d, dt);
      cur.current += vel.current * dt;
      if (Math.abs(target - cur.current) < 0.02 && Math.abs(vel.current) < 0.02) {
        cur.current = target;
        vel.current = 0;
        setAt(target);
        raf.current = 0;
        return;
      }
      setAt(cur.current);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
    /* `tune` sits here beside `target` for the reason
       Brightness spells out: the loop closes over it, so
       without it a knob turned mid-flight would do nothing
       until something else restarted the effect. Restarting
       picks up from the refs, so it continues rather than
       snapping. */
  }, [target, tune, instant]);

  return at;
}

/* Read once, the way the wheel and the pill nav do. A
   preference, not a live input. */
const stillness = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/* ①(P-161 2026-09-19 测试台适配) 受控数据面 / 传输面。
   与插件仓 `dsh-mpkg-wallpaper/lib/now-playing.js` 的控制器**同一套词汇**（跨仓一致，
   见 P-161 台账 §「为什么用同一套 op 名」）：
     op: play | pause | prev | next | restart | mute | seek(0..1) | volume(0..1) | link(0|1)
     data 里的 canXxx 决定对应键**可不可按**（不可按 ⇒ `disabled` + 视觉降权，不假装可点）。
   ⚠ 不传 `data` 时组件走**原件那套装饰态**（本地 `going`/`liked`/`at`），SSR 产物逐字不变 ——
   独立演示页 `demo/now-playing/index.html` 与既有门禁的基线断言都靠这条。 */
export type NowPlayingOp = "play" | "pause" | "prev" | "next" | "restart" | "mute" | "seek" | "volume" | "link";
export type NowPlayingData = {
  kind?: string;
  title?: string;
  byline?: string;
  /** 进度（秒）与总长（秒）；total ≤ 0 ⇒ 进度条画成 0（不是 NaN） */
  progress?: number;
  total?: number;
  /* ①(2026-09-23 第 8② 条) **时间轴是否可证实**。false = 宿主只找到"看起来像媒体、但不是当前
     能听见的那条"的元素（实测 3326873240：帧里 5 个 loop 视频层全 muted，进度条却拿其中一个
     19.98s 的时间轴当"当前播放" ⇒ 每 20 秒绕一圈，而用户听到的音频根本没循环）。
     语义：false ⇒ 两个时间位都写 `--:--`、进度条 0%、不可拖 —— 宁可说"不知道"，不许编一个时间轴。 */
  timelineKnown?: boolean;
  playing?: boolean;
  muted?: boolean;
  volume?: number;
  canPlay?: boolean;
  canPrev?: boolean;
  canNext?: boolean;
  canSeek?: boolean;
  canVolume?: boolean;
  /** 联动：true = 卡片跟随/控制当前壁纸的媒体；false = 脱开（只显示最后一次快照） */
  link?: boolean;
  source?: string;
};

export function NowPlaying({
  /* how quickly the shape changes, 0..100 — 50 is the tuned
     460ms, and neither end is broken: 736 reads as deliberate
     and 184 as brisk. */
  morph = 50,
  /* the sleeve's corner on the card, 0..32, and the box's
     corner follows it — see the note above */
  corner = CORNER,
  /* ①(P-138 移植) 取代 Bencho 的全局 `[data-stroke="on"]`（本项目没有
     那个属性）：盒子那圈发丝线只由这个开关给，默认关 —— 与原件口径
     一致（见 CSS 里 "NO BORDER of its own" 那段）。 */
  stroke = false,
  /* ①(P-161) 受控面：不传 = 装饰态（原件行为）；传了 = 卡片显示真实媒体并派发 op */
  data = null,
  onTransport = null,
}: { morph?: number; corner?: number; stroke?: boolean; data?: NowPlayingData | null; onTransport?: ((op: NowPlayingOp, value?: number) => void) | null } = {}) {
  const skin = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [going, setGoing] = useState(false);
  const [liked, setLiked] = useState(false);
  const [at, setAt] = useState(52);
  const [hoverZoom, setHoverZoom] = useState(false);   // ①(P-161) 受控模式的悬浮放大（挂在根上，不加新类）
  const still = stillness();

  /* ①(P-161) 受控模式下的一切读数都来自 `data`（缺省回落到原件那套装饰值）。
     `controlled` 一旦为真，本地 `going`/`liked`/`at` 就不再参与显示 —— 状态只有一个来源。 */
  const controlled = !!data;
  const shownPlaying = controlled ? !!data?.playing : going;
  const shownLiked = controlled ? !!data?.link : liked;
  const totalSec = controlled ? Math.max(0, Number(data?.total) || 0) : TOTAL;
  const atSec = controlled ? Math.max(0, Math.min(totalSec || Number(data?.progress) || 0, Number(data?.progress) || 0)) : at;
  /* ①(2026-09-23 第 8② 条) 时间轴不可证实 ⇒ 两个时间位都写 `--:--`（`timelineKnown` 缺省 = true，
     兼容既有调用方：只有**显式** false 才改显示，别的装饰档/受控档逐字不变）。 */
  const timelineKnown = controlled ? data?.timelineKnown !== false : true;
  const railPct = (timelineKnown && totalSec > 0) ? (atSec / totalSec) * 100 : 0;
  const shownTitle = controlled ? String(data?.title || "") : "Cabra Field";
  const shownBy = controlled ? String(data?.byline || "") : "Side B";
  const canPlay = controlled ? data?.canPlay !== false : true;
  const canPrev = controlled ? data?.canPrev !== false : true;
  const canNext = controlled ? data?.canNext !== false : true;
  const canSeek = controlled ? data?.canSeek !== false && totalSec > 0 && timelineKnown : true;
  /** 派发一个传输 op：受控模式交给宿主；装饰态自己吃掉（原件行为）。 */
  const send = (op: NowPlayingOp, value?: number) => {
    if (controlled) {
      try { onTransport?.(op, value); } catch { /* 宿主抛错不影响卡片自己的状态机 */ }
    }
  };

  /*  ③(2026-09-25 issue0924a2 用户第 3 条) **音量控件进卡片内部**（用户原话："我说的把音量的按钮
      集成到 NP 的卡片里面，你还是没有做好"）。
      口径照 DSH 插件（`dsh-mpkg-wallpaper/lib/now-playing.js` 的 `showVolume = late > 0`）：
        · 卡片**展开态**才存在（`late` 是"深半程"的补间值，与时钟/传输行同一条约定）—— 收起成胶囊时
          一个像素都不占（用户原话里的"不要再多一条独立的条"就是这条）；
        · 一条**音量轨**在时钟行的中间（左时刻 / 音量 / 右剩余），**不是**卡片下面再加一行；
        · 传输行里多一个**第四键**（音量/静音），与播放/上一首/下一首同形同尺寸；
        · 能不能动跟 `data.canVolume` 走（联动关/没有媒体 ⇒ 明确 disabled，不假装可点）。
      读数：`data-mpw-np-vol` / `data-mpw-np-vol-range`（轨道）+ `data-mpw-np-mute`（第四键）。 */
  const volPct = Math.round(clamp(controlled ? (Number(data?.volume) || 0) : 0, 0, 1) * 100);
  const shownMuted = controlled ? (!!data?.muted || !(Number(data?.volume) > 0)) : false;
  const canVolume = controlled ? data?.canVolume !== false : false;

  const dur = BASE * rate(clamp(morph, 0, 100));

  /* the sleeve's corner at each end, and the box's from it.
     The bar's sleeve is the smaller square, so it takes the
     same fraction of its own side — a 16 on a 64 and a 10 on
     a 40 are the same corner at two sizes. */
  /* ①(P-138 移植) 这两行原来的内联算式（`[(cr * 40) / 64, cr]` 与
     `+ off` 的合成）搬进了 ./now-playing-math.mjs 的 artRadius /
     boxRadius，算式一字未改；下面 "the offset FADES IN" 那段仍是这条
     规则的出处。 */
  const cr = clamp(corner, 0, CORNER_MAX);
  const artR = artRadius(cr);

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
  const boxR = boxRadius(cr);

  /* 0 shut, 1 open. Tweened once, read everywhere. */
  const p = useTween(open ? 1 : 0, dur, still);

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
  const u = useTween(open ? 1 : 0, dur, still, FLAT);
  /* ①(P-138 移植) 算式搬进 ./now-playing-math.mjs 的 swell()，一字未改
     （^1.5 与峰值 0.63 的论证就是上面那段）。 */
  const swell = swellAt(u);
  const zoom = open ? 1 : 1 - 0.035 * swell;

  /* ── the clock ───────────────────────────────────────────
     Nothing moves until somebody presses play, which is the
     difference between a component and a screensaver. It is
     also why the wall can hold twenty of these: at rest this
     component has no timer at all. */
  useEffect(() => {
    if (!going) return;
    const id = window.setInterval(
      () => setAt((s) => (s >= TOTAL ? 0 : s + 1)),
      1000,
    );
    return () => window.clearInterval(id);
  }, [going]);

  /* ── outside closes it ───────────────────────────────────
     Only while it is open, and only for a press that started
     outside the box. `pointerdown` rather than click: a press
     that begins outside and drifts in is still somebody
     reaching past this component, and waiting for the click
     lets it land on whatever is underneath first.

     Bound on the document because the thing being dismissed
     has no idea what is around it — the wall, the canvas and
     the detail overlay all show this block and none of them
     should have to know it can be open. */
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      /* ── isTrusted, or the demonstrations close it ────────
         Every card on the wall that carries a `demo` drives a
         scripted pointer at its own component, and those
         events bubble to the document like any other. Without
         this guard, a rehearsal anywhere on the page — this
         block's own included — read as somebody reaching past
         this player and shut it a frame after it opened.
         Measured: it climbed to 403 and then turned around on
         its own.

         The same guard Orbit's ring carries, for the same
         reason. Only a real hand dismisses this. */
      if (!e.isTrusted) return;
      const el = skin.current;
      if (el && !el.contains(e.target as Node)) setOpen(false);
    };
    /* the next tick, or the press that opened it closes it */
    const id = window.setTimeout(
      () => document.addEventListener("pointerdown", away),
      0,
    );
    return () => {
      window.clearTimeout(id);
      document.removeEventListener("pointerdown", away);
    };
  }, [open]);

  const art = {
    x: PAD,
    /* At the margin in both states, and NOT centred in the bar
       any more: the bar is not symmetric top to bottom, because
       the track has a band of its own down there. The sleeve,
       the words and the transport are one row against the top
       margin; everything below them belongs to the track. */
    y: PAD,
    s: mix(ART.s[0], ART.s[1], p),
  };

  /* Everything below is derived, never stored. A second piece
     of state describing the same transformation is a second
     thing that can be out of step with the first. */
  const h = mix(SHUT, OPEN, p);

  /* the transport: at the end of the bar, then centred under
     the art. The row's own width changes, so it is placed by
     its centre rather than by an edge. */
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
  const side = mix(24, 34, p);
  const lead = mix(30, LEAD, p);
  /* 1 was three controls touching, which reads as one object
     with three parts rather than as three things you press */
  const gap = mix(5, 14, p);
  /* the box, less its margin and half of the 88 the row is
     when shut */
  const opsX = mix(W - PAD - 44, W / 2, p);
  /* the type grows with the sleeve rather than on its own */
  /* level with the sleeve on the bar, and under everything on
     the card */
  /* 360, and it is measured rather than picked: the times sit
     under the rail and the row has to clear them. At 358 with
     the clock at its natural line height the two overlapped by
     7px — the buttons sat BESIDE the numbers rather than under
     them, which only reads as intentional if you never look at
     the left end of the row. */
  const opsY = mix(PAD + ART.s[0] / 2, OPS_Y, p);

  /* the deep half of the morph, for the things that only
     exist in the card. Held back to the last 40% so they
     arrive into a shape that has stopped growing rather than
     sliding about inside one that has not. */
  const late = clamp((p - 0.6) / 0.4, 0, 1);

  /*  ③(用户第 3 条) 音量行/第四键的**存在条件**：受控档 + 卡片已展开（`late > 0`，与 DSH 插件逐字同款）。
      为什么带 `controlled`：装饰态（不传 `data`）是"原件那套装饰态"，一个字节都不该多
      （独立演示页与既有 SSR 基线断言都靠这条）—— 音量控件属于**受控数据面**。 */
  const showVolume = controlled && late > 0;

  const flip = () => {
    setOpen((v) => !v);
  };

  return (
    <div
      className="snd"
      data-stroke={stroke ? "on" : undefined}
      data-mpw-now-playing={controlled ? (data?.source || "1") : undefined}
      onMouseEnter={controlled ? () => setHoverZoom(true) : undefined}
      onMouseLeave={controlled ? () => setHoverZoom(false) : undefined}
      style={{
        width: W,
        height: OPEN,
        /* ①(P-161) 受控模式的"悬浮态放大"：只动**整体** scale，不动任何布局数字
           （原件那条"一个数字即状态"的纪律照旧）；装饰态不挂这个监听 ⇒ SSR 产物逐字不变。 */
        transform: controlled && hoverZoom ? "scale(1.02)" : undefined,
        transformOrigin: "50% 50%",
        transition: controlled ? "transform 160ms cubic-bezier(0.28, 0.36, 1, 1)" : undefined,
      }}
    >
      <div
        className="snd-box"
        ref={skin}
        data-open={open || undefined}
        style={{
          width: W,
          height: h,
          borderRadius: mix(boxR[0], boxR[1], p),
          scale: zoom,
        }}
      >
        {/* the hinge. The sleeve is inlined rather than linked
            — see scripts/cover.sh — because the bundle is one
            file and a linked image is a dead square the moment
            it leaves this machine. */}
        {/* ①(P-138 移植) 上面那段是**原件**的口径（Bencho 把封面内联进单文件
            产物，它有自己的 scripts/cover.sh）。本仓库没有那套内联管线，也不
            出行第三方美术资源 ⇒ 这里改成相对页面的链接图（demo/assets/brand/brand-512.png，
            见文件顶部的 COVER）。注释保留是因为它解释了"封面为什么是这个
            尺寸的方块、为什么必须有图"；差异记录在 README 的「照抄 / 我们改的」一节。 */}
        <span
          className="snd-art"
          aria-hidden="true"
          style={{
            backgroundImage: `url(${COVER})`,
            left: art.x,
            top: art.y,
            width: art.s,
            height: art.s,
            /* Squared, and near enough constant: the sleeve
               belongs to the same family as the box around it,
               and a disc inside a rounded rectangle is a
               different object. */
            borderRadius: mix(artR[0], artR[1], p),
          }}
        />

        <span
          className="snd-say"
          style={{
            /* beside the sleeve at BOTH ends — the gap grows
               with everything else and nothing reflows */
            left: mix(PAD + ART.s[0] + 10, PAD + ART.s[1] + 10, p),
            /* Level with the sleeve, and centred BY it: same
               top, same height, and the words centre
               themselves inside that. It was a top edge
               placed against a guess at how tall two lines
               are, which held until the type sizes changed —
               see the note in the stylesheet. */
            top: PAD,
            height: art.s,
            /* what is left between the sleeve and the row */
            /* what the smaller sleeve gives back */
            /* less the heart, which lives in the corner the
               words would otherwise run into. On the bar
               there is no heart and nothing to give up. */
            width: mix(94, W - PAD - (PAD + ART.s[1] + 10) - (LIKE + 10), p),
          }}
        >
          <span className="snd-title" style={{ fontSize: mix(13, 15.5, p) }}>
            {shownTitle}
          </span>
          <span className="snd-by" style={{ fontSize: mix(11, 12, p) }}>
            {shownBy}
          </span>
        </span>

        {/* ── the track ─────────────────────────────────────
            Only in the card, and it says so by not being
            there: opacity AND height, so it cannot leave a
            gap in the bar that nothing occupies. */}
        {/* ── the track ─────────────────────────────────────
            It is on the bar too, along the foot, edge to edge
            — a bar with no sense of how far through it is is
            missing the one thing a bar is for. Full bleed
            rather than tucked under the words: at 60px tall
            there is no room for a fourth line, and the pill's
            own corner clips the ends for free.

            The TIMES are the part that only belongs to the
            card. They fade with the deep half of the move and
            are clipped by the box until then, so they cost the
            bar no room at all. */}
        <span
          className="snd-bar"
          style={{
            /* OFF the edge on the bar too. It sat flush at the
               foot, which is a different object — a loading
               line belongs to the box's edge, and a track
               belongs to the thing playing. Inset by the same
               margin as everything else, it reads as part of
               the composition rather than as the box's own
               bottom border. */
            top: mix(SHUT - PAD - RAIL_H, RAIL_Y, p),
            /* one margin, so the track's ends never move */
            left: PAD,
            width: W - PAD * 2,
          }}
        >
          <span
            className="snd-rail"
            data-mpw-np-scrub={controlled ? "1" : undefined}
            data-mpw-np-noseek={controlled && !canSeek ? "1" : undefined}
            role={controlled ? "slider" : undefined}
            aria-valuemin={controlled ? 0 : undefined}
            aria-valuemax={controlled ? Math.round(totalSec) : undefined}
            aria-valuenow={controlled ? Math.round(atSec) : undefined}
            onPointerDown={controlled ? (e) => {
              if (!canSeek) return;
              const r = e.currentTarget.getBoundingClientRect();
              const v = seekRatio(e.clientX, r);
              if (v === null) return;
              try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* 老浏览器 */ }
              send("seek", v);
            } : undefined}
            onPointerMove={controlled ? (e) => {
              if (!canSeek) return;
              if (e.buttons === 0) return;                    // 只有按住才拖
              const v = seekRatio(e.clientX, e.currentTarget.getBoundingClientRect());
              if (v !== null) send("seek", v);
            } : undefined}
            style={controlled ? { cursor: canSeek ? "pointer" : "default", pointerEvents: canSeek ? "auto" : "none" } : undefined}
          >
            <span className="snd-run" style={{ width: `${railPct}%` }} />
          </span>
          <span className="snd-clock" style={{ opacity: late }}>
            <span>{timelineKnown ? clock(atSec) : "--:--"}</span>
            {/*  ③ 音量轨：**卡片内部**时钟行的中间那一段（与 DSH 插件同构）。
                收起态整行随 `late` 淡出，`late === 0` 时这一整块**根本不渲染** ⇒ 胶囊不多一行。 */}
            {showVolume ? (
              <>
                {/*  ⚠**不加新类名**：样式落在 `.snd-clock input[type="range"][data-mpw-np-vol-range]`
                    与 `.snd-clock [data-mpw-np-volnum]`（都是既有类 + 属性选择器）。理由有两条：
                      ① 组件的 CSS↔DOM「一一对应」判据（tests/now-playing-test.mjs 第 ⑦ 组）拿的是
                         **装饰档**的 SSR 产物 —— 音量行只在受控档展开时存在，新类名在那边必然算"孤儿规则"；
                      ② 这个组件本来就用 `data-mpw-np-*` 标记受控面（scrub/link/noseek 都是），
                         音量沿用同一套词汇，不发明第二套。 */}
                <input
                  id="np-volume"
                  data-mpw-np-vol="1"
                  data-mpw-np-vol-range="1"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={controlled ? clamp(Number(data?.volume) || 0, 0, 1) : 0}
                  disabled={!canVolume}
                  onChange={(e) => { if (canVolume) send("volume", Number(e.currentTarget.value)); }}
                  aria-label="Wallpaper volume"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={volPct}
                  title={`Volume ${volPct}%`}
                />
                <span data-mpw-np-volnum="1">{volPct}%</span>
              </>
            ) : null}
            <span>{timelineKnown ? "−" + clock(Math.max(0, totalSec - atSec)) : "--:--"}</span>
          </span>
        </span>

        {/* ── the one thing you press to change shape ───────
            Invisible, and it is the WHOLE bar when shut — the
            track's band at the foot is part of the object, and
            a bar that only answers along the row its sleeve is
            in has a dead third nobody can see the edge of.

            Opened, it is the sleeve and the words only, so a
            player you have opened does not collapse because
            you reached for the title.

            Declared BEFORE the transport on purpose: both are
            positioned, so the later one paints on top, and the
            buttons have to win a press that lands on both. */}
        <button
          className="snd-tap"
          onClick={flip}
          aria-expanded={open}
          aria-label={open ? "Collapse the player" : "Open the player"}
          style={{
            left: mix(0, PAD, p),
            top: mix(0, PAD, p),
            width: mix(W, W - PAD * 2, p),
            /* every pixel of the bar, and the sleeve's own
               height once it is a card */
            height: mix(SHUT, ART.s[1], p),
            borderRadius: mix(boxR[0], artR[1], p),
          }}
        />

        {/* ── the heart ─────────────────────────────────────
            The card's one control that is not transport, and
            the only reason the card has a top-right corner
            worth anything: everything else here is a row.

            It belongs to the card alone. On the bar there is
            no room for a fourth control beside three that are
            already touching, and a heart is not what a pill
            is for — so it rides `late`, arriving after the
            box has stopped growing, and takes its hit area
            with it rather than sitting invisible over the
            words.

            After the tap, like the transport, so a press in
            the corner reaches the heart rather than closing
            the player underneath it. */}
        <button
          className="snd-like"
          data-on={shownLiked || undefined}
          data-mpw-np-link={controlled ? (shownLiked ? "1" : "0") : undefined}
          onClick={() => {
            if (controlled) send("link", shownLiked ? 0 : 1);
            else setLiked((v) => !v);
          }}
          aria-label={controlled ? (shownLiked ? "Unlink the card from the media" : "Link the card to the media") : (liked ? "Remove from liked songs" : "Add to liked songs")}
          aria-pressed={shownLiked}
          tabIndex={open ? 0 : -1}
          style={{
            left: W - PAD - LIKE,
            top: PAD,
            width: LIKE,
            height: LIKE,
            opacity: late,
            pointerEvents: late > 0.9 ? "auto" : "none",
          }}
        >
          <Heart size={16} strokeWidth={2} fill={liked ? "currentColor" : "none"} />
        </button>

        <span
          className="snd-ops"
          style={{ left: opsX, top: opsY, gap }}
        >
          {/* DRAWN, not filled — unlike the play. Three solid
              marks in a row of eighty pixels is a lot of ink
              for two controls you press rarely, and the
              difference in weight is what says which one is
              the button and which two are beside it. */}
          <button
            className="snd-op"
            data-mpw-np-prev={controlled ? "1" : undefined}
            disabled={!canPrev}
            style={{ width: side, height: side, opacity: canPrev ? 1 : 0.4 }}
            onClick={() => { if (!canPrev) return; if (controlled) send("prev"); else setAt(0); }}
            aria-label="Restart"
          >
            <SkipBack size={mix(13, 16, p)} strokeWidth={2} />
          </button>

          <button
            className="snd-op"
            data-lead
            disabled={!canPlay}
            style={{ width: lead, height: lead, opacity: canPlay ? 1 : 0.4 }}
            onClick={() => {
              if (!canPlay) return;
              if (controlled) send(shownPlaying ? "pause" : "play");
              else setGoing((v) => !v);
            }}
            aria-label={shownPlaying ? "Pause" : "Play"}
            aria-pressed={shownPlaying}
          >
            {/* ── FILLED, not drawn ─────────────────────────
                Transport marks are solid everywhere a person
                has met them, and an outlined triangle reads as
                a diagram of play rather than as play. The skip
                glyphs keep their stroke for a different
                reason: the bar beside each triangle is a line
                with no area, and dropping the stroke would
                drop the bar.

                This one is not a lucide icon at all — see
                Mark, above — because it is the only mark here
                that changes into another one. */}
            <Mark playing={shownPlaying} size={mix(14, 18, p)} still={still} />
          </button>

          <button
            className="snd-op"
            data-mpw-np-next={controlled ? "1" : undefined}
            disabled={!canNext}
            style={{ width: side, height: side, opacity: canNext ? 1 : 0.4 }}
            onClick={() => { if (!canNext) return; if (controlled) send("next"); else setAt(0); }}
            aria-label="Next"
          >
            <SkipForward size={mix(13, 16, p)} strokeWidth={2} />
          </button>

          {/*  ③(用户第 3 条) **音量的按钮在卡片里**：传输行第四键（音量/静音），与另外三个键同形同尺寸。
              照 DSH 插件的做法：它**只在卡片里**存在（`showVolume`）—— 收起态的行宽仍按三键算，
              所以胶囊的几何一个像素都不动。 */}
          {showVolume ? (
            <button
              className="snd-op"
              type="button"
              data-mpw-np-mute={controlled ? (shownMuted ? "1" : "0") : undefined}
              disabled={!canVolume}
              style={{ width: side, height: side, opacity: canVolume ? 1 : 0.4 }}
              onClick={() => { if (!canVolume) return; if (controlled) send("mute"); }}
              aria-label={shownMuted ? "Unmute the wallpaper" : "Mute the wallpaper"}
              aria-pressed={!shownMuted}
            >
              {shownMuted
                ? <VolumeX size={mix(13, 16, p)} strokeWidth={2} />
                : <Volume2 size={mix(13, 16, p)} strokeWidth={2} />}
            </button>
          ) : null}
        </span>

      </div>
    </div>
  );
}
