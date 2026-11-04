/* ①(P-138 2026-09-19 移植) mount.tsx —— 把 NowPlaying 挂到某个容器的**薄壳**。
   这里不做任何别的事：不读 URL、不查 localStorage、不建全局单例、不注册样式
   —— 组件本身已经自带全部状态，壳只负责"React 需要一个根"这一件事。
   独立演示页（index.html）走它；将来要往测试台里嵌，也走它（先不嵌，见 README）。

   旋钮走 update()：组件里那条 spring/tween 从**当前值**续上（原件注释里
   "It reads its start from wherever it currently IS"），所以拖动滑杆是接着动，
   而不是跳一下。 */
import { createRoot, type Root } from "react-dom/client";
import { NowPlaying } from "./NowPlaying";
import type { NowPlayingData, NowPlayingOp } from "./NowPlaying";

export { NowPlaying } from "./NowPlaying";
export type { NowPlayingData, NowPlayingOp } from "./NowPlaying";
export type NowPlayingOptions = {
  /** 形状变化多快，0..100（50 = 原件调好的 460ms） */
  morph?: number;
  /** 卡片上封面的圆角，0..32（盒子的角由它推出来，见 now-playing-math.mjs） */
  corner?: number;
  /** 盒子的发丝线（取代 Bencho 的全局 [data-stroke="on"]） */
  stroke?: boolean;
  /** ①(P-161) 受控数据面：给了它就是"真控件"（显示真实媒体 + 派发 op）；不给 = 原件那套装饰态 */
  data?: NowPlayingData | null;
  /** ①(P-161) 传输回调：op ∈ play|pause|prev|next|restart|mute|seek|volume|link */
  onTransport?: ((op: NowPlayingOp, value?: number) => void) | null;
};

export function mountNowPlaying(el: Element | null, opts: NowPlayingOptions = {}) {
  if (!el) throw new Error("mountNowPlaying(el): 需要一个容器元素");
  const root: Root = createRoot(el);
  let cur: NowPlayingOptions = { ...opts };
  //  ①(P-161) 注意 `data` 是**每次整份替换**（宿主每拍给一个新对象）：`update({data})` 走的是
  //  `{...cur, ...next}` ⇒ data 取最新那份；其余旋钮（morph/corner/stroke）仍是"续上当前值"。
  const draw = () => root.render(<NowPlaying {...cur} />);
  draw();
  return {
    /** 改旋钮/推数据：只重画，不重建根（组件状态与动画因此不会被冲掉 ⇒ 换壁纸不必 remount） */
    update(next: NowPlayingOptions = {}) {
      cur = { ...cur, ...next };
      draw();
    },
    unmount() {
      root.unmount();
    },
  };
}
